import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, recordRole, recordOwner, can } from '../authz.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { today } from '../lib.js';
import { receiveUpload, sendUpload, removeUpload } from '../uploads.js';
import { uuid, isoDate, visibleSql, roleSql, assertPersonInScope, personJoin } from '../records.js';

const STATUS = ['open', 'dormant', 'closed'];
const fileFields = z.object({
  file_number: z.string().trim().max(40).default(''),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).default(''),
  status: z.enum(STATUS).default('open'),
  opened_on: isoDate.optional(),
  closed_on: isoDate.nullish(),
});
const createBody = fileFields.extend({
  team_id: uuid.nullish(),
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

export default async function routes(app) {
  async function loadFile(req, id, write = false) {
    const file = await one('SELECT * FROM case_files WHERE id=$1', [id]);
    const role = await recordRole(req.user.id, file, write);
    return { file, role };
  }
  const checkDates = (opened, closed) => {
    if (closed && opened && closed < opened) throw bad('Abgeschlossen am liegt vor dem Eröffnungsdatum');
  };

  app.get('/case-files', authz('casefile:read'), async (req) => {
    const f = z.object({ status: z.enum(STATUS).optional(), q: z.string().max(100).optional() }).parse(req.query);
    const params = [req.user.id];
    const where = [visibleSql('c')];
    if (f.status) { params.push(f.status); where.push(`c.status=$${params.length}`); }
    if (f.q) {
      params.push(`%${f.q}%`);
      where.push(`(c.title ILIKE $${params.length} OR c.file_number ILIKE $${params.length} OR c.description ILIKE $${params.length}
        OR EXISTS (SELECT 1 FROM case_file_people cp JOIN people pe ON pe.id=cp.person_id WHERE cp.case_file_id=c.id AND pe.name ILIKE $${params.length}))`);
    }
    return many(
      `SELECT c.id, c.file_number, c.title, c.status, c.opened_on, c.closed_on, c.team_id, t.name team_name, c.updated_at, ${roleSql('c')} AS role,
         (SELECT count(*)::int FROM case_file_entries e WHERE e.case_file_id=c.id) entries,
         (SELECT max(e.entry_date) FROM case_file_entries e WHERE e.case_file_id=c.id) last_entry,
         (SELECT COALESCE(json_agg(pe.name ORDER BY pe.name), '[]') FROM case_file_people cp JOIN people pe ON pe.id=cp.person_id WHERE cp.case_file_id=c.id) people
       FROM case_files c LEFT JOIN teams t ON t.id=c.team_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.status='closed', c.updated_at DESC LIMIT 500`,
      params,
    );
  });

  app.post('/case-files', authz('casefile:create'), async (req) => {
    const b = createBody.parse(req.body);
    const scope = await recordOwner(req.user.id, b.team_id);
    const openedOn = b.opened_on || today();
    const closedOn = b.status === 'closed' ? b.closed_on || today() : null;
    checkDates(openedOn, closedOn);
    for (const p of b.people) await assertPersonInScope(p.person_id, scope);
    if (new Set(b.people.map((p) => p.person_id)).size !== b.people.length) throw bad('Eine Person ist doppelt angegeben');
    const created = await tx(async (client) => {
      const number = b.file_number || await nextFileNumber(client, scope);
      const row = (await client.query(
        `INSERT INTO case_files(owner_user_id,team_id,file_number,title,description,status,opened_on,closed_on,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, file_number`,
        [scope.owner_user_id, scope.team_id, number, b.title, b.description, b.status, openedOn, closedOn, req.user.id],
      )).rows[0];
      for (const p of b.people) await client.query('INSERT INTO case_file_people(case_file_id,person_id,role) VALUES ($1,$2,$3)', [row.id, p.person_id, p.role]);
      return row;
    }).catch(uniqueNumber);
    await audit(req, 'casefile.created', 'case_file', created.id, { file_number: created.file_number });
    return created;
  });

  app.get('/case-files/:id', authz('casefile:read'), async (req) => {
    const { file, role } = await loadFile(req, req.params.id);
    const [team, people, entries, attachments] = await Promise.all([
      file.team_id ? one('SELECT name FROM teams WHERE id=$1', [file.team_id]) : null,
      many(`SELECT cp.person_id, cp.role, pe.name, pe.kind, pe.function, pe.active FROM case_file_people cp
        ${personJoin('pe', 'cp.person_id', '$2')} WHERE cp.case_file_id=$1 ORDER BY pe.name NULLS LAST`, [file.id, req.user.id]),
      many(`SELECT e.id, e.entry_date, e.kind, e.body, e.person_id, pe.name person_name, e.created_at, e.updated_at,
          cu.name created_by_name, uu.name updated_by_name
        FROM case_file_entries e ${personJoin('pe', 'e.person_id', '$2')}
          LEFT JOIN users cu ON cu.id=e.created_by LEFT JOIN users uu ON uu.id=e.updated_by
        WHERE e.case_file_id=$1 ORDER BY e.entry_date DESC, e.created_at DESC`, [file.id, req.user.id]),
      many(`SELECT a.id, a.original_name, a.mime, a.size, a.created_at, u.name uploaded_by_name FROM case_file_attachments a
        LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.case_file_id=$1 ORDER BY a.created_at`, [file.id]),
    ]);
    return { ...file, team_name: team?.name || null, role, people, entries, attachments };
  });

  app.patch('/case-files/:id', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, true);
    const b = patchSchema(fileFields).parse(req.body);
    const status = b.status ?? file.status;
    const openedOn = b.opened_on ?? file.opened_on;
    // Abschließen setzt das Datum, Wiedereröffnen löscht es
    const closedOn = status === 'closed' ? ('closed_on' in b ? b.closed_on : file.closed_on) || today() : null;
    checkDates(openedOn, closedOn);
    await q(
      `UPDATE case_files SET file_number=$2, title=$3, description=$4, status=$5, opened_on=$6, closed_on=$7, updated_at=now() WHERE id=$1`,
      [file.id, b.file_number || file.file_number, b.title ?? file.title, b.description ?? file.description, status, openedOn, closedOn],
    ).catch(uniqueNumber);
    await audit(req, 'casefile.updated', 'case_file', file.id, status !== file.status ? { status } : undefined);
    return { ok: true };
  });

  app.delete('/case-files/:id', authz('casefile:delete'), async (req) => {
    const { file } = await loadFile(req, req.params.id, true);
    const files = await many('SELECT storage_key FROM case_file_attachments WHERE case_file_id=$1', [file.id]);
    await q('DELETE FROM case_files WHERE id=$1', [file.id]);
    for (const a of files) removeUpload(a.storage_key);
    await audit(req, 'casefile.deleted', 'case_file', file.id, { file_number: file.file_number });
    return { ok: true };
  });

  // ---- Beteiligte Personen
  app.post('/case-files/:id/people', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, true);
    const b = personBody.parse(req.body);
    await assertPersonInScope(b.person_id, file);
    await q(
      'INSERT INTO case_file_people(case_file_id,person_id,role) VALUES ($1,$2,$3) ON CONFLICT (case_file_id,person_id) DO UPDATE SET role=EXCLUDED.role',
      [file.id, b.person_id, b.role],
    );
    await q('UPDATE case_files SET updated_at=now() WHERE id=$1', [file.id]);
    await audit(req, 'casefile.person_added', 'case_file', file.id, { person: b.person_id });
    return { ok: true };
  });

  app.delete('/case-files/:id/people/:personId', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, true);
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

  // ---- Einträge
  const assertInvolved = async (fileId, personId) => {
    if (personId && !(await one('SELECT 1 FROM case_file_people WHERE case_file_id=$1 AND person_id=$2', [fileId, personId]))) {
      throw bad('Person ist nicht an dieser Akte beteiligt');
    }
  };
  async function loadEntry(req) {
    const entry = await one('SELECT * FROM case_file_entries WHERE id=$1', [req.params.id]);
    if (!entry) throw notFound();
    const { file } = await loadFile(req, entry.case_file_id, true);
    return { entry, file };
  }

  app.post('/case-files/:id/entries', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, true);
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
    const { file } = await loadFile(req, req.params.id, true);
    const upload = await receiveUpload(req);
    const row = await one(
      'INSERT INTO case_file_attachments(case_file_id,storage_key,original_name,mime,size,sha256,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [file.id, upload.key, upload.name, upload.mime, upload.size, upload.sha256, req.user.id],
    );
    await audit(req, 'casefile.attachment_added', 'case_file', file.id, { name: upload.name });
    return row;
  });

  async function loadAttachment(req, write) {
    const attachment = await one('SELECT * FROM case_file_attachments WHERE id=$1', [req.params.id]);
    if (!attachment) throw notFound();
    await loadFile(req, attachment.case_file_id, write);
    return attachment;
  }
  app.get('/case-file-attachments/:id', authz('casefile:read'), async (req, reply) => sendUpload(reply, await loadAttachment(req, false)));
  app.delete('/case-file-attachments/:id', authz('casefile:update'), async (req) => {
    const attachment = await loadAttachment(req, true);
    await q('DELETE FROM case_file_attachments WHERE id=$1', [attachment.id]);
    removeUpload(attachment.storage_key);
    await audit(req, 'casefile.attachment_deleted', 'case_file', attachment.case_file_id, { name: attachment.original_name });
    return { ok: true };
  });

  // ---- Personenakte: alles zu einer Person, soweit die Rechte reichen
  app.get('/people/:id/record', authz('person:read'), async (req) => {
    const personId = uuid.parse(req.params.id);
    const person = await one(`SELECT pe.* FROM people pe WHERE pe.id=$1 AND ${visibleSql('pe', '$2')}`, [personId, req.user.id]);
    if (!person) throw notFound();
    const result = { person, case_files: null, entries: null, licenses: null, trainings: null };
    if (can(req, 'casefile:read')) {
      result.case_files = await many(
        `SELECT c.id, c.file_number, c.title, c.status, c.opened_on, c.closed_on, cp.role FROM case_file_people cp JOIN case_files c ON c.id=cp.case_file_id
         WHERE cp.person_id=$1 AND ${visibleSql('c', '$2')} ORDER BY c.opened_on DESC`, [personId, req.user.id],
      );
      result.entries = await many(
        `SELECT e.id, e.entry_date, e.kind, e.body, c.id case_file_id, c.file_number, c.title FROM case_file_entries e JOIN case_files c ON c.id=e.case_file_id
         WHERE e.person_id=$1 AND ${visibleSql('c', '$2')} ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 200`, [personId, req.user.id],
      );
    }
    if (can(req, 'license:read')) {
      result.licenses = await many(
        `SELECT l.id, lt.name type_name, l.number, l.issued_on, l.valid_until, l.status, l.status_reason FROM licenses l JOIN license_types lt ON lt.id=l.type_id
         WHERE l.person_id=$1 AND ${visibleSql('lt', '$2')} ORDER BY lt.name, l.issued_on DESC`, [personId, req.user.id],
      );
    }
    if (can(req, 'training:read')) {
      result.trainings = await many(
        `SELECT r.id, tr.name training_name, r.result, r.completed_on, r.valid_until, s.session_date FROM training_records r JOIN trainings tr ON tr.id=r.training_id
           LEFT JOIN training_sessions s ON s.id=r.session_id
         WHERE r.person_id=$1 AND ${visibleSql('tr', '$2')} ORDER BY COALESCE(r.completed_on, s.session_date) DESC NULLS LAST`, [personId, req.user.id],
      );
    }
    return result;
  });
}
