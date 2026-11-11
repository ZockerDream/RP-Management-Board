import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, forbidden, can } from '../authz.js';
import { LEVEL, levelSql, visibleSql, recordLevel, recordOwner, needMessage } from '../org.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { today } from '../lib.js';
import { receiveUpload, sendUpload, removeUpload, uploadPath } from '../uploads.js';
import { uuid, isoDate, isoDateTime, assertPerson, personJoin } from '../records.js';
import { fileLevelSql, loadFile, assertInvolved } from '../casefile-access.js';
import { currentCaseFeatures, disabledError } from '../feature-guard.js';
import { loadCaseFileDetail } from '../casefile-detail.js';
import { caseFilePdf } from '../casefile-pdf.js';

const STATUS = ['open', 'dormant', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const fileFields = z.object({
  file_number: z.string().trim().max(40).default(''),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).default(''),
  status: z.enum(STATUS).default('open'),
  opened_on: isoDate.optional(),
  closed_on: isoDate.nullish(),
  priority: z.enum(PRIORITIES).default('normal'),
  location: z.string().trim().max(200).default(''),
  incident_at: isoDateTime.nullish(),
  lead_user_id: uuid.nullish(),
});
const createBody = fileFields.extend({
  team_id: uuid.nullish(),
  type_id: uuid.nullish(),
  people: z.array(z.object({ person_id: uuid, role: z.string().trim().max(60).default('') })).max(100).default([]),
});
const personBody = z.object({ person_id: uuid, role: z.string().trim().max(60).default('') });
const entryFields = z.object({
  entry_date: isoDate.optional(),
  kind: z.string().trim().max(60).default(''),
  body: z.string().trim().min(1).max(20000),
  person_id: uuid.nullish(),
});

// Aktenzeichen ohne Angabe: Jahr und laufende Nummer im Bereich, z. B. 2026-0007
async function nextFileNumber(client, scope) {
  const year = today().slice(0, 4);
  const column = scope.team_id ? 'team_id' : 'owner_user_id';
  const row = (await client.query(
    `SELECT COALESCE(max(substring(file_number FROM '^${year}-(\\d+)$')::int), 0) + 1 n FROM case_files WHERE ${column}=$1`,
    [scope.team_id || scope.owner_user_id],
  )).rows[0];
  return `${year}-${String(row.n).padStart(4, '0')}`;
}

const uniqueNumber = (e) => {
  if (e.code === '23505') throw bad('Dieses Aktenzeichen ist in diesem Bereich schon vergeben');
  throw e;
};

// Sachbearbeitung: ein Mitglied der Organisation, privat nur man selbst
async function checkLead(scope, userId) {
  if (!userId) return;
  const ok = scope.team_id
    ? await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2', [scope.team_id, userId])
    : userId === scope.owner_user_id;
  if (!ok) throw bad(scope.team_id ? 'Die Sachbearbeitung muss Mitglied der Organisation sein' : 'Privat kannst nur du die Akte bearbeiten');
}

// Aktenart im selben Bereich wie die Akte; ohne Art gelten die Rechte für Akten allgemein
async function typeInScope(typeId, scope) {
  if (!typeId) return null;
  const type = await one('SELECT * FROM case_file_types WHERE id=$1', [typeId]);
  const same = type && (scope.team_id ? type.team_id === scope.team_id : type.owner_user_id === scope.owner_user_id);
  if (!same) throw bad(scope.team_id ? 'Aktenart gehört nicht zu dieser Organisation' : 'Aktenart ist nicht deine private Aktenart');
  return type;
}

export default async function routes(app) {
  // Lesen ab 2, Einträge, Personen und Anhänge ab 3, Löschen, Aktenart wechseln und Beschränken mit 4 (loadFile in casefile-access.js)
  const write = LEVEL.WRITE;
  const checkDates = (opened, closed) => {
    if (closed && opened && closed < opened) throw bad('Abgeschlossen am liegt vor dem Eröffnungsdatum');
  };

  app.get('/case-files', authz('casefile:read'), async (req) => {
    const f = z.object({ status: z.enum(STATUS).optional(), type_id: uuid.optional(), priority: z.enum(PRIORITIES).optional(), q: z.string().max(100).optional() }).parse(req.query);
    const params = [req.user.id];
    const where = [`${fileLevelSql('c')} >= 2`];
    if (f.status) { params.push(f.status); where.push(`c.status=$${params.length}`); }
    if (f.type_id) { params.push(f.type_id); where.push(`c.type_id=$${params.length}`); }
    if (f.priority) { params.push(f.priority); where.push(`c.priority=$${params.length}`); }
    // Suche auch über Ort, Personen (mit Alias) und Kennzeichen beteiligter Fahrzeuge
    if (f.q) {
      params.push(`%${f.q}%`);
      where.push(`(c.title ILIKE $${params.length} OR c.file_number ILIKE $${params.length} OR c.description ILIKE $${params.length} OR c.location ILIKE $${params.length}
        OR EXISTS (SELECT 1 FROM case_file_people cp JOIN people pe ON pe.id=cp.person_id WHERE cp.case_file_id=c.id AND (pe.name ILIKE $${params.length} OR pe.aliases ILIKE $${params.length}))
        OR EXISTS (SELECT 1 FROM case_file_vehicles v WHERE v.case_file_id=c.id AND (v.plate ILIKE $${params.length} OR v.description ILIKE $${params.length})))`);
    }
    return many(
      `SELECT c.id, c.file_number, c.title, c.status, c.opened_on, c.closed_on, c.team_id, t.name team_name, c.updated_at, ${fileLevelSql('c')} AS level,
         c.type_id, ct.name type_name, c.restricted, c.priority, c.location, c.incident_at, lu.name lead_name,
         (SELECT count(*)::int FROM warrants w WHERE w.case_file_id=c.id AND w.status='active') active_warrants,
         (SELECT count(*)::int FROM case_file_reports r WHERE r.case_file_id=c.id AND r.status='submitted') reports_pending,
         (SELECT count(*)::int FROM case_file_entries e WHERE e.case_file_id=c.id) entries,
         (SELECT max(e.entry_date) FROM case_file_entries e WHERE e.case_file_id=c.id) last_entry,
         (SELECT COALESCE(json_agg(pe.name ORDER BY pe.name), '[]') FROM case_file_people cp JOIN people pe ON pe.id=cp.person_id WHERE cp.case_file_id=c.id) people
       FROM case_files c LEFT JOIN teams t ON t.id=c.team_id LEFT JOIN case_file_types ct ON ct.id=c.type_id LEFT JOIN users lu ON lu.id=c.lead_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.status='closed', array_position(ARRAY['urgent','high','normal','low'], c.priority), c.updated_at DESC LIMIT 500`,
      params,
    );
  });

  app.post('/case-files', authz('casefile:create'), async (req) => {
    const b = createBody.parse(req.body);
    if (b.type_id && !(await currentCaseFeatures()).types) throw disabledError('types');
    const scope = await recordOwner(req.user.id, b.team_id, 'casefile', LEVEL.WRITE, b.type_id || null);
    await typeInScope(b.type_id, scope);
    const openedOn = b.opened_on || today();
    const closedOn = b.status === 'closed' ? b.closed_on || today() : null;
    checkDates(openedOn, closedOn);
    for (const p of b.people) await assertPerson(p.person_id);
    if (new Set(b.people.map((p) => p.person_id)).size !== b.people.length) throw bad('Eine Person ist doppelt angegeben');
    await checkLead(scope, b.lead_user_id);
    const created = await tx(async (client) => {
      const number = b.file_number || await nextFileNumber(client, scope);
      const row = (await client.query(
        `INSERT INTO case_files(owner_user_id,team_id,file_number,title,description,status,opened_on,closed_on,created_by,type_id,priority,location,incident_at,lead_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, file_number`,
        [scope.owner_user_id, scope.team_id, number, b.title, b.description, b.status, openedOn, closedOn, req.user.id, b.type_id || null,
          b.priority, b.location, b.incident_at || null, b.lead_user_id || null],
      )).rows[0];
      for (const p of b.people) await client.query('INSERT INTO case_file_people(case_file_id,person_id,role) VALUES ($1,$2,$3)', [row.id, p.person_id, p.role]);
      return row;
    }).catch(uniqueNumber);
    await audit(req, 'casefile.created', 'case_file', created.id, { file_number: created.file_number });
    return created;
  });

  app.get('/case-files/:id', authz('casefile:read'), async (req) => {
    return loadCaseFileDetail(req, req.params.id);
  });

  // Ganze Akte als PDF (Wunsch des Auftraggebers vom 2026-11-11): Kopf immer, weitere Teile per ?parts=…
  app.get('/case-files/:id/pdf', authz('casefile:read'), async (req, reply) => {
    const { parts } = z.object({ parts: z.string().max(300).default('') }).parse(req.query);
    const detail = await loadCaseFileDetail(req, req.params.id);
    const chosen = new Set(parts.split(',').map((p) => p.trim()).filter(Boolean));
    const keys = chosen.has('images') ? await many('SELECT id, storage_key FROM case_file_attachments WHERE case_file_id=$1', [detail.id]) : [];
    const files = new Map(keys.map((k) => [k.id, uploadPath(k.storage_key)]));
    await audit(req, 'case_file.exported_pdf', 'case_file', detail.id, { parts: [...chosen] });
    const name = `akte-${String(detail.file_number).replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`;
    reply.type('application/pdf').header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(caseFilePdf(detail, { parts: chosen, features: await currentCaseFeatures(), exportedBy: req.user.name, files }));
  });

  app.patch('/case-files/:id', authz('casefile:update'), async (req) => {
    const { file, level } = await loadFile(req, req.params.id, write);
    const b = patchSchema(fileFields).extend({ type_id: uuid.nullish() }).parse(req.body);
    if ('lead_user_id' in b) await checkLead(file, b.lead_user_id);
    // Eine andere Aktenart ändert, wer die Akte sieht: dafür „Verwalten“ hier und Schreibrecht für die neue Art
    const typeChanged = 'type_id' in b && (b.type_id || null) !== file.type_id;
    // Ohne Aktenarten (ausgeschaltet) behält eine Akte ihre Art; ändern geht erst nach dem Einschalten
    if (typeChanged && !(await currentCaseFeatures()).types) throw disabledError('types');
    if (typeChanged) {
      if (level < LEVEL.MANAGE) throw forbidden(needMessage('casefile', LEVEL.MANAGE));
      await typeInScope(b.type_id, file);
      if (file.team_id) await recordOwner(req.user.id, file.team_id, 'casefile', LEVEL.WRITE, b.type_id || null);
    }
    const status = b.status ?? file.status;
    const openedOn = b.opened_on ?? file.opened_on;
    // Abschließen setzt das Datum, Wiedereröffnen löscht es
    const closedOn = status === 'closed' ? ('closed_on' in b ? b.closed_on : file.closed_on) || today() : null;
    checkDates(openedOn, closedOn);
    const keep = (key) => (key in b ? b[key] ?? null : file[key]);
    await q(
      `UPDATE case_files SET file_number=$2, title=$3, description=$4, status=$5, opened_on=$6, closed_on=$7, type_id=$8,
         priority=$9, location=$10, incident_at=$11, lead_user_id=$12, updated_at=now() WHERE id=$1`,
      [file.id, b.file_number || file.file_number, b.title ?? file.title, b.description ?? file.description, status, openedOn, closedOn, typeChanged ? b.type_id || null : file.type_id,
        b.priority ?? file.priority, b.location ?? file.location, keep('incident_at'), keep('lead_user_id')],
    ).catch(uniqueNumber);
    const changes = { ...(status !== file.status ? { status } : {}), ...(typeChanged ? { type: b.type_id || null } : {}) };
    await audit(req, 'casefile.updated', 'case_file', file.id, Object.keys(changes).length ? changes : undefined);
    return { ok: true };
  });

  app.delete('/case-files/:id', authz('casefile:delete'), async (req) => {
    const { file } = await loadFile(req, req.params.id, LEVEL.MANAGE);
    const files = await many('SELECT storage_key FROM case_file_attachments WHERE case_file_id=$1', [file.id]);
    await q('DELETE FROM case_files WHERE id=$1', [file.id]);
    for (const a of files) removeUpload(a.storage_key);
    await audit(req, 'casefile.deleted', 'case_file', file.id, { file_number: file.file_number });
    return { ok: true };
  });

  // ---- Beteiligte Personen
  app.post('/case-files/:id/people', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = personBody.parse(req.body);
    await assertPerson(b.person_id);
    await q(
      'INSERT INTO case_file_people(case_file_id,person_id,role) VALUES ($1,$2,$3) ON CONFLICT (case_file_id,person_id) DO UPDATE SET role=EXCLUDED.role',
      [file.id, b.person_id, b.role],
    );
    await q('UPDATE case_files SET updated_at=now() WHERE id=$1', [file.id]);
    await audit(req, 'casefile.person_added', 'case_file', file.id, { person: b.person_id });
    return { ok: true };
  });

  app.delete('/case-files/:id/people/:personId', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const personId = uuid.parse(req.params.personId);
    await tx(async (client) => {
      const removed = await client.query('DELETE FROM case_file_people WHERE case_file_id=$1 AND person_id=$2', [file.id, personId]);
      if (!removed.rowCount) throw notFound('Person ist nicht an dieser Akte beteiligt');
      // Einträge bleiben, verlieren aber den Bezug zur Person
      await client.query('UPDATE case_file_entries SET person_id=NULL WHERE case_file_id=$1 AND person_id=$2', [file.id, personId]);
      await client.query('UPDATE case_files SET updated_at=now() WHERE id=$1', [file.id]);
    });
    await audit(req, 'casefile.person_removed', 'case_file', file.id, { person: personId });
    return { ok: true };
  });

  // ---- Einträge (assertInvolved aus casefile-access.js)
  async function loadEntry(req) {
    const entry = await one('SELECT * FROM case_file_entries WHERE id=$1', [req.params.id]);
    if (!entry) throw notFound();
    const { file } = await loadFile(req, entry.case_file_id, write);
    return { entry, file };
  }

  app.post('/case-files/:id/entries', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = entryFields.parse(req.body);
    await assertInvolved(file.id, b.person_id);
    const row = await one(
      `INSERT INTO case_file_entries(case_file_id,entry_date,kind,body,person_id,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [file.id, b.entry_date || today(), b.kind, b.body, b.person_id || null, req.user.id],
    );
    await q('UPDATE case_files SET updated_at=now() WHERE id=$1', [file.id]);
    await audit(req, 'casefile.entry_added', 'case_file', file.id, { entry: row.id });
    return row;
  });

  app.patch('/case-file-entries/:id', authz('casefile:update'), async (req) => {
    const { entry, file } = await loadEntry(req);
    const b = patchSchema(entryFields).parse(req.body);
    const personId = 'person_id' in b ? b.person_id || null : entry.person_id;
    await assertInvolved(file.id, personId);
    await q(
      'UPDATE case_file_entries SET entry_date=$2, kind=$3, body=$4, person_id=$5, updated_by=$6, updated_at=now() WHERE id=$1',
      [entry.id, b.entry_date ?? entry.entry_date, b.kind ?? entry.kind, b.body ?? entry.body, personId, req.user.id],
    );
    await audit(req, 'casefile.entry_updated', 'case_file', file.id, { entry: entry.id });
    return { ok: true };
  });

  app.delete('/case-file-entries/:id', authz('casefile:update'), async (req) => {
    const { entry, file } = await loadEntry(req);
    await q('DELETE FROM case_file_entries WHERE id=$1', [entry.id]);
    await audit(req, 'casefile.entry_deleted', 'case_file', file.id, { entry: entry.id });
    return { ok: true };
  });

  // ---- Anhänge
  app.post('/case-files/:id/attachments', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    // ?images=1: nur PNG und JPEG (Bilder der Akte); Bilder sind Anhänge vom Typ PNG/JPEG mit Bildunterschrift
    const upload = await receiveUpload(req, { images: req.query?.images === '1' });
    const row = await one(
      'INSERT INTO case_file_attachments(case_file_id,storage_key,original_name,mime,size,sha256,uploaded_by,caption) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [file.id, upload.key, upload.name, upload.mime, upload.size, upload.sha256, req.user.id, upload.caption],
    );
    await audit(req, 'casefile.attachment_added', 'case_file', file.id, { name: upload.name });
    return row;
  });

  async function loadAttachment(req, need) {
    const attachment = await one('SELECT * FROM case_file_attachments WHERE id=$1', [req.params.id]);
    if (!attachment) throw notFound();
    await loadFile(req, attachment.case_file_id, need);
    return attachment;
  }
  app.get('/case-file-attachments/:id', authz('casefile:read'), async (req, reply) => sendUpload(reply, await loadAttachment(req, LEVEL.READ)));
  app.patch('/case-file-attachments/:id', authz('casefile:update'), async (req) => {
    const attachment = await loadAttachment(req, write);
    const b = z.object({ caption: z.string().trim().max(200) }).parse(req.body);
    await q('UPDATE case_file_attachments SET caption=$2 WHERE id=$1', [attachment.id, b.caption]);
    return { ok: true };
  });
  app.delete('/case-file-attachments/:id', authz('casefile:update'), async (req) => {
    const attachment = await loadAttachment(req, write);
    await q('DELETE FROM case_file_attachments WHERE id=$1', [attachment.id]);
    removeUpload(attachment.storage_key);
    await audit(req, 'casefile.attachment_deleted', 'case_file', attachment.case_file_id, { name: attachment.original_name });
    return { ok: true };
  });

  // ---- Beschränkung: nur bestimmte Ränge (und alle höheren), Gruppen und Mitglieder sehen die Akte
  // Auswahl für den Dialog; wer Akten verwaltet, braucht dafür kein Recht auf die Mitgliederliste
  app.get('/case-files/:id/access-options', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, LEVEL.MANAGE);
    if (!file.team_id) throw bad('Private Akten sieht ohnehin nur du');
    const [ranks, groups, members] = await Promise.all([
      many('SELECT id, name FROM team_ranks WHERE team_id=$1 ORDER BY position DESC', [file.team_id]),
      many('SELECT id, name FROM team_groups WHERE team_id=$1 ORDER BY name', [file.team_id]),
      many('SELECT u.id, u.name FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1 AND u.deleted_at IS NULL ORDER BY u.name', [file.team_id]),
    ]);
    return { ranks, groups, members };
  });

  app.put('/case-files/:id/access', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, LEVEL.MANAGE);
    if (!file.team_id) throw bad('Private Akten sieht ohnehin nur du');
    const b = z.object({
      restricted: z.boolean(),
      rank_ids: z.array(uuid).max(100).default([]),
      group_ids: z.array(uuid).max(100).default([]),
      user_ids: z.array(uuid).max(500).default([]),
    }).parse(req.body);
    const count = async (sql, ids) => (ids.length ? (await one(sql, [file.team_id, [...new Set(ids)]])).n : 0);
    if (await count('SELECT count(*)::int n FROM team_ranks WHERE team_id=$1 AND id = ANY($2::uuid[])', b.rank_ids) !== new Set(b.rank_ids).size) throw bad('Rang gehört nicht zu dieser Organisation');
    if (await count('SELECT count(*)::int n FROM team_groups WHERE team_id=$1 AND id = ANY($2::uuid[])', b.group_ids) !== new Set(b.group_ids).size) throw bad('Gruppe gehört nicht zu dieser Organisation');
    if (await count('SELECT count(*)::int n FROM team_members WHERE team_id=$1 AND user_id = ANY($2::uuid[])', b.user_ids) !== new Set(b.user_ids).size) throw bad('Benutzer ist nicht Mitglied dieser Organisation');
    if (b.restricted && !b.rank_ids.length && !b.group_ids.length && !b.user_ids.length) throw bad('Wähle mindestens einen Rang, eine Gruppe oder ein Mitglied');
    await tx(async (client) => {
      await client.query('DELETE FROM case_file_access WHERE case_file_id=$1', [file.id]);
      if (b.restricted) {
        for (const [column, ids] of [['rank_id', b.rank_ids], ['group_id', b.group_ids], ['user_id', b.user_ids]]) {
          for (const id of new Set(ids)) await client.query(`INSERT INTO case_file_access(case_file_id, ${column}) VALUES ($1,$2)`, [file.id, id]);
        }
      }
      await client.query('UPDATE case_files SET restricted=$2, updated_at=now() WHERE id=$1', [file.id, b.restricted]);
      // Wer beschränkt, muss die Akte danach noch verwalten können
      const after = (await client.query('SELECT case_file_level($1,$2) AS level', [file.id, req.user.id])).rows[0].level;
      if (after < LEVEL.MANAGE) throw bad('Damit würdest du dich selbst aussperren – nimm deinen Rang, eine deiner Gruppen oder dich selbst mit auf');
    });
    await audit(req, b.restricted ? 'casefile.restricted' : 'casefile.unrestricted', 'case_file', file.id,
      b.restricted ? { ranks: b.rank_ids, groups: b.group_ids, users: b.user_ids } : undefined);
    return { ok: true };
  });

  // ---- Aktenarten: eigene Rechte pro Art; anlegen mit „Verwalten“ für Akten, ändern und löschen mit „Verwalten“ für die Art
  app.get('/case-file-types', authz('casefile:read'), async (req) => many(
    `SELECT * FROM (
       SELECT ct.id, ct.name, ct.team_id, t.name team_name, ${levelSql('ct', 'casefile', '$1', 'ct.id')} AS level,
         (SELECT count(*)::int FROM case_files c WHERE c.type_id=ct.id) files
       FROM case_file_types ct LEFT JOIN teams t ON t.id=ct.team_id
       WHERE ct.owner_user_id=$1 OR ct.team_id IS NOT NULL
     ) x WHERE x.level >= 2 ORDER BY x.team_name NULLS FIRST, x.name`,
    [req.user.id],
  ));

  const typeName = z.object({ name: z.string().trim().min(1).max(100) });
  const uniqueType = (e) => {
    if (e.code === '23505') throw bad('Eine Aktenart mit diesem Namen gibt es hier schon');
    throw e;
  };
  app.post('/case-file-types', authz('casefile:create'), async (req) => {
    const b = typeName.extend({ team_id: uuid.nullish() }).parse(req.body);
    const scope = await recordOwner(req.user.id, b.team_id, 'casefile', LEVEL.MANAGE);
    const row = await one('INSERT INTO case_file_types(owner_user_id, team_id, name) VALUES ($1,$2,$3) RETURNING id', [scope.owner_user_id, scope.team_id, b.name]).catch(uniqueType);
    await audit(req, 'casefile.type_created', 'case_file_type', row.id, { name: b.name });
    return row;
  });
  async function loadType(req) {
    const type = await one('SELECT * FROM case_file_types WHERE id=$1', [req.params.id]);
    await recordLevel(req.user.id, type, 'casefile', { need: LEVEL.MANAGE, scope: type?.id });
    return type;
  }
  app.patch('/case-file-types/:id', authz('casefile:update'), async (req) => {
    const type = await loadType(req);
    const b = typeName.parse(req.body);
    await q('UPDATE case_file_types SET name=$2 WHERE id=$1', [type.id, b.name]).catch(uniqueType);
    return { ok: true };
  });
  app.delete('/case-file-types/:id', authz('casefile:delete'), async (req) => {
    const type = await loadType(req);
    const used = (await one('SELECT count(*)::int n FROM case_files WHERE type_id=$1', [type.id])).n;
    if (used) throw bad(`Die Aktenart wird von ${used === 1 ? 'einer Akte' : `${used} Akten`} genutzt – ordne sie zuerst einer anderen Art zu`);
    await tx(async (client) => {
      await client.query('DELETE FROM team_permissions WHERE scope_id=$1', [type.id]);
      await client.query('DELETE FROM case_file_types WHERE id=$1', [type.id]);
    });
    await audit(req, 'casefile.type_deleted', 'case_file_type', type.id, { name: type.name });
    return { ok: true };
  });

  // ---- Personenakte: alles zu einer Person, soweit die Rechte reichen
  app.get('/people/:id/record', authz('person:read'), async (req) => {
    const personId = uuid.parse(req.params.id);
    const person = await one('SELECT * FROM people WHERE id=$1', [personId]);
    if (!person) throw notFound();
    const result = { person, case_files: null, entries: null, licenses: null, trainings: null, vehicles: null };
    // Fahrzeuge, deren Besitzer die Person ist (Objektverwaltung), soweit sichtbar
    if (can(req, 'vehicle:read')) {
      result.vehicles = await many(
        `SELECT v.id, v.plate, v.make_model, v.status, t.name team_name FROM vehicles v LEFT JOIN teams t ON t.id=v.team_id
         WHERE v.owner_person_id=$1 AND ${visibleSql('v', 'vehicle', '$2')} ORDER BY v.status = 'retired', v.plate`, [personId, req.user.id],
      );
    }
    // Ohne Fallakten (Schalter in feature-guard.js) keine Akten und Einträge aus Akten
    if (can(req, 'casefile:read') && (await currentCaseFeatures()).files) {
      result.case_files = await many(
        `SELECT c.id, c.file_number, c.title, c.status, c.opened_on, c.closed_on, cp.role FROM case_file_people cp JOIN case_files c ON c.id=cp.case_file_id
         WHERE cp.person_id=$1 AND ${fileLevelSql('c', '$2')} >= 2 ORDER BY c.opened_on DESC`, [personId, req.user.id],
      );
      result.entries = await many(
        `SELECT e.id, e.entry_date, e.kind, e.body, c.id case_file_id, c.file_number, c.title FROM case_file_entries e JOIN case_files c ON c.id=e.case_file_id
         WHERE e.person_id=$1 AND ${fileLevelSql('c', '$2')} >= 2 ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 200`, [personId, req.user.id],
      );
    }
    if (can(req, 'license:read')) {
      result.licenses = await many(
        `SELECT l.id, lt.name type_name, l.number, l.issued_on, l.valid_until, l.status, l.status_reason FROM licenses l JOIN license_types lt ON lt.id=l.type_id
         WHERE l.person_id=$1 AND ${visibleSql('lt', 'license', '$2')} ORDER BY lt.name, l.issued_on DESC`, [personId, req.user.id],
      );
    }
    if (can(req, 'training:read')) {
      result.trainings = await many(
        `SELECT r.id, tr.name training_name, r.result, r.completed_on, r.valid_until, s.session_date FROM training_records r JOIN trainings tr ON tr.id=r.training_id
           LEFT JOIN training_sessions s ON s.id=r.session_id
         WHERE r.person_id=$1 AND ${visibleSql('tr', 'training', '$2')} ORDER BY COALESCE(r.completed_on, s.session_date) DESC NULLS LAST`, [personId, req.user.id],
      );
    }
    return result;
  });
}
