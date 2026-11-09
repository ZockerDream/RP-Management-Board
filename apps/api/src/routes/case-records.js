// Was an einer Akte hängt: Fahrzeuge, verknüpfte Akten, Beweismittel mit Übergabekette, Anklagepunkte aus dem
// Strafkatalog und Fahndungen; dazu der Strafkatalog eines Bereichs und die Fahndungsliste über alle sichtbaren Akten.
// Rechte wie bei der Akte: lesen ab 2, erfassen ab 3; Entscheidungen über Anklagepunkte, Löschen von Beweismitteln und
// Fahndungen sowie der Strafkatalog brauchen „Verwalten“.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden } from '../authz.js';
import { LEVEL, levelSql, needMessage } from '../org.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { today } from '../lib.js';
import { uuid, isoDate, isoDateTime, assertPerson } from '../records.js';
import { fileLevelSql, loadFile, loadChild, assertInvolved, area, areaRecord, sameArea } from '../casefile-access.js';
import { readPenalCsv } from '../penal.js';
import { CsvError } from '../csv.js';

const str = (n) => z.string().trim().max(n).default('');
const amount = z.union([z.string(), z.number()]).transform((v) => String(v).replace(',', '.')).refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), 'Ungültiger Betrag');
const plate = (v) => v.trim().toUpperCase();
export const EVIDENCE_STATUS = { secured: 'Sichergestellt', analysis: 'In Untersuchung', stored: 'Eingelagert', released: 'Herausgegeben', destroyed: 'Vernichtet' };
export const WARRANT_KINDS = { arrest: 'Haftbefehl', search: 'Durchsuchungsbeschluss', wanted: 'Fahndung', vehicle: 'Fahrzeugfahndung' };
const touch = (client, fileId) => client.query('UPDATE case_files SET updated_at=now() WHERE id=$1', [fileId]);

export default async function routes(app) {
  const write = LEVEL.WRITE;
  const manage = LEVEL.MANAGE;

  // ---------- Fahrzeuge
  const vehicleFields = z.object({ plate: str(20), description: str(200), role: str(60), owner_person_id: uuid.nullish(), note: z.string().max(1000).default('') });
  async function checkVehicle(b) {
    if (b.plate !== undefined) b.plate = plate(b.plate);
    if (b.owner_person_id) await assertPerson(b.owner_person_id);
  }
  app.post('/case-files/:id/vehicles', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = vehicleFields.parse(req.body);
    await checkVehicle(b);
    if (!b.plate && !b.description) throw bad('Kennzeichen oder Beschreibung angeben');
    const row = await tx(async (client) => {
      const r = (await client.query('INSERT INTO case_file_vehicles(case_file_id,plate,description,role,owner_person_id,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [file.id, b.plate, b.description, b.role, b.owner_person_id || null, b.note])).rows[0];
      await touch(client, file.id);
      return r;
    });
    await audit(req, 'casefile.vehicle_added', 'case_file', file.id, { plate: b.plate });
    return row;
  });
  app.patch('/case-file-vehicles/:id', authz('casefile:update'), async (req) => {
    const { row, file } = await loadChild(req, 'case_file_vehicles', req.params.id, write);
    const b = patchSchema(vehicleFields).parse(req.body);
    await checkVehicle(b);
    const merged = { ...row, ...b };
    if (!merged.plate && !merged.description) throw bad('Kennzeichen oder Beschreibung angeben');
    await q('UPDATE case_file_vehicles SET plate=$2, description=$3, role=$4, owner_person_id=$5, note=$6 WHERE id=$1',
      [row.id, merged.plate, merged.description, merged.role, merged.owner_person_id || null, merged.note]);
    await audit(req, 'casefile.vehicle_updated', 'case_file', file.id, { vehicle: row.id });
    return { ok: true };
  });
  app.delete('/case-file-vehicles/:id', authz('casefile:update'), async (req) => {
    const { row, file } = await loadChild(req, 'case_file_vehicles', req.params.id, write);
    await q('DELETE FROM case_file_vehicles WHERE id=$1', [row.id]);
    await audit(req, 'casefile.vehicle_removed', 'case_file', file.id, { plate: row.plate });
    return { ok: true };
  });

  // ---------- Verknüpfte Akten: nur im selben Bereich und nur Akten, die man selbst sieht; je Richtung eine Zeile
  app.post('/case-files/:id/links', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = z.object({ linked_id: uuid, note: str(200) }).parse(req.body);
    if (b.linked_id === file.id) throw bad('Eine Akte lässt sich nicht mit sich selbst verknüpfen');
    const { file: other } = await loadFile(req, b.linked_id, LEVEL.READ).catch(() => { throw bad('Die andere Akte gibt es nicht oder du siehst sie nicht'); });
    if (!sameArea(file, other)) throw bad('Verknüpfen geht nur mit Akten desselben Bereichs');
    await tx(async (client) => {
      for (const [a, c] of [[file.id, other.id], [other.id, file.id]]) {
        await client.query('INSERT INTO case_file_links(case_file_id,linked_id,note) VALUES ($1,$2,$3) ON CONFLICT (case_file_id,linked_id) DO UPDATE SET note=EXCLUDED.note', [a, c, b.note]);
      }
      await touch(client, file.id);
    });
    await audit(req, 'casefile.linked', 'case_file', file.id, { linked: other.id });
    return { ok: true };
  });
  app.delete('/case-files/:id/links/:linkedId', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const linkedId = uuid.parse(req.params.linkedId);
    await q('DELETE FROM case_file_links WHERE (case_file_id=$1 AND linked_id=$2) OR (case_file_id=$2 AND linked_id=$1)', [file.id, linkedId]);
    await audit(req, 'casefile.unlinked', 'case_file', file.id, { linked: linkedId });
    return { ok: true };
  });

  // ---------- Beweismittel: laufende Nummer je Akte, jeder Statuswechsel und jede Übergabe ins Protokoll
  const evidenceFields = z.object({
    description: z.string().trim().min(1).max(500), kind: str(60), storage: str(200), found_at: isoDateTime.nullish(), found_where: str(200),
    person_id: uuid.nullish(), note: z.string().max(2000).default(''),
  });
  const log = (client, evidenceId, action, note, userId) => client.query('INSERT INTO case_file_evidence_log(evidence_id,action,note,user_id) VALUES ($1,$2,$3,$4)', [evidenceId, action, note.slice(0, 500), userId]);
  app.post('/case-files/:id/evidence', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = evidenceFields.parse(req.body);
    await assertInvolved(file.id, b.person_id);
    const row = await tx(async (client) => {
      // Sperre auf die Akte, damit zwei gleichzeitig erfasste Beweismittel nicht dieselbe Nummer bekommen
      await client.query('SELECT id FROM case_files WHERE id=$1 FOR UPDATE', [file.id]);
      const { n } = (await client.query('SELECT COALESCE(max(number), 0) + 1 n FROM case_file_evidence WHERE case_file_id=$1', [file.id])).rows[0];
      const r = (await client.query(
        `INSERT INTO case_file_evidence(case_file_id,number,description,kind,storage,found_at,found_where,person_id,note,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, number`,
        [file.id, n, b.description, b.kind, b.storage, b.found_at || null, b.found_where, b.person_id || null, b.note, req.user.id],
      )).rows[0];
      await log(client, r.id, 'Sichergestellt', [b.found_where && `Fundort: ${b.found_where}`, b.storage && `Lagerort: ${b.storage}`].filter(Boolean).join(' · '), req.user.id);
      await touch(client, file.id);
      return r;
    });
    await audit(req, 'casefile.evidence_added', 'case_file', file.id, { evidence: row.id, number: row.number });
    return row;
  });
  app.patch('/case-file-evidence/:id', authz('casefile:update'), async (req) => {
    const { row, file } = await loadChild(req, 'case_file_evidence', req.params.id, write);
    const b = patchSchema(evidenceFields).parse(req.body);
    if ('person_id' in b) await assertInvolved(file.id, b.person_id);
    const m = { ...row, ...b };
    await tx(async (client) => {
      await client.query('UPDATE case_file_evidence SET description=$2, kind=$3, storage=$4, found_at=$5, found_where=$6, person_id=$7, note=$8 WHERE id=$1',
        [row.id, m.description, m.kind, m.storage, m.found_at || null, m.found_where, m.person_id || null, m.note]);
      if (m.storage !== row.storage) await log(client, row.id, 'Lagerort geändert', `${row.storage || '–'} → ${m.storage || '–'}`, req.user.id);
    });
    await audit(req, 'casefile.evidence_updated', 'case_file', file.id, { evidence: row.id });
    return { ok: true };
  });
  // Status wechseln oder Übergabe festhalten; beides landet im Protokoll
  app.post('/case-file-evidence/:id/log', authz('casefile:update'), async (req) => {
    const { row, file } = await loadChild(req, 'case_file_evidence', req.params.id, write);
    const b = z.object({ status: z.enum(Object.keys(EVIDENCE_STATUS)).optional(), action: str(60), note: str(500) }).parse(req.body);
    if (!b.status && !b.action) throw bad('Neuen Status oder Vorgang angeben, z. B. „Übergabe an Labor“');
    await tx(async (client) => {
      if (b.status && b.status !== row.status) {
        await client.query('UPDATE case_file_evidence SET status=$2 WHERE id=$1', [row.id, b.status]);
        await log(client, row.id, `Status: ${EVIDENCE_STATUS[b.status]}`, b.action ? `${b.action}${b.note ? ` · ${b.note}` : ''}` : b.note, req.user.id);
      } else await log(client, row.id, b.action || 'Vermerk', b.note, req.user.id);
      await touch(client, file.id);
    });
    await audit(req, 'casefile.evidence_logged', 'case_file', file.id, { evidence: row.id, status: b.status });
    return { ok: true };
  });
  app.delete('/case-file-evidence/:id', authz('casefile:delete'), async (req) => {
    const { row, file } = await loadChild(req, 'case_file_evidence', req.params.id, manage);
    await q('DELETE FROM case_file_evidence WHERE id=$1', [row.id]);
    await audit(req, 'casefile.evidence_deleted', 'case_file', file.id, { number: row.number, description: row.description });
    return { ok: true };
  });

  // ---------- Strafkatalog eines Bereichs
  const codeFields = z.object({
    code: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(200), category: str(60), fine: amount.default('0'),
    jail: z.number().int().min(0).max(100000).default(0), points: z.number().int().min(0).max(100).default(0),
    description: z.string().max(2000).default(''), active: z.boolean().default(true),
  });
  const uniqueCode = (e) => {
    if (e.code === '23505') throw bad('Diesen Paragraphen gibt es im Strafkatalog schon');
    throw e;
  };
  app.get('/penal-codes', authz('casefile:read'), async (req) => {
    const f = z.object({ team_id: uuid.optional(), private: z.enum(['1']).optional() }).parse(req.query);
    const params = [req.user.id];
    const where = [`${levelSql('pc', 'casefile')} >= 2`];
    if (f.team_id) { params.push(f.team_id); where.push(`pc.team_id=$${params.length}`); }
    if (f.private) where.push('pc.owner_user_id=$1');
    return many(
      `SELECT pc.*, t.name team_name, ${levelSql('pc', 'casefile')} AS level,
         (SELECT count(*)::int FROM case_file_charges ch WHERE ch.penal_code_id=pc.id) used
       FROM penal_codes pc LEFT JOIN teams t ON t.id=pc.team_id WHERE ${where.join(' AND ')}
       ORDER BY t.name NULLS FIRST, pc.category, pc.code`, params,
    );
  });
  app.post('/penal-codes', authz('casefile:create'), async (req) => {
    const b = codeFields.extend({ team_id: uuid.nullish() }).parse(req.body);
    const owner = await area(req, b.team_id, manage);
    const row = await one(
      `INSERT INTO penal_codes(owner_user_id,team_id,code,title,category,fine,jail,points,description,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [owner.owner_user_id, owner.team_id, b.code, b.title, b.category, b.fine, b.jail, b.points, b.description, b.active],
    ).catch(uniqueCode);
    await audit(req, 'penal_code.created', 'penal_code', row.id, { code: b.code });
    return row;
  });
  async function loadCode(req, need) {
    const row = await one('SELECT * FROM penal_codes WHERE id=$1', [uuid.parse(req.params.id)]);
    await areaRecord(req, row, need);
    return row;
  }
  app.patch('/penal-codes/:id', authz('casefile:update'), async (req) => {
    const row = await loadCode(req, manage);
    const b = patchSchema(codeFields).parse(req.body);
    const m = { ...row, ...b };
    await q('UPDATE penal_codes SET code=$2, title=$3, category=$4, fine=$5, jail=$6, points=$7, description=$8, active=$9 WHERE id=$1',
      [row.id, m.code, m.title, m.category, m.fine, m.jail, m.points, m.description, m.active]).catch(uniqueCode);
    await audit(req, 'penal_code.updated', 'penal_code', row.id, { code: m.code });
    return { ok: true };
  });
  // Anklagepunkte behalten ihren Stand; der Katalogeintrag verschwindet nur aus der Auswahl
  app.delete('/penal-codes/:id', authz('casefile:delete'), async (req) => {
    const row = await loadCode(req, manage);
    await q('DELETE FROM penal_codes WHERE id=$1', [row.id]);
    await audit(req, 'penal_code.deleted', 'penal_code', row.id, { code: row.code });
    return { ok: true };
  });
  // CSV mit Paragraph, Bezeichnung, Kategorie, Geldstrafe, Haft, Punkte, Beschreibung; vorhandene Paragraphen werden aktualisiert
  app.post('/penal-codes/import', { ...authz('casefile:create'), bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const b = z.object({ team_id: uuid.nullish(), csv: z.string().min(1).max(2_000_000), preview: z.boolean().default(false) }).parse(req.body);
    const owner = await area(req, b.team_id, manage);
    let parsed;
    try { parsed = readPenalCsv(b.csv); } catch (e) {
      if (e instanceof CsvError) throw bad(e.message);
      throw e;
    }
    const column = owner.team_id ? 'team_id' : 'owner_user_id';
    const existing = new Map((await many(`SELECT id, lower(code) code FROM penal_codes WHERE ${column}=$1`, [owner.team_id || owner.owner_user_id])).map((r) => [r.code, r.id]));
    const updates = parsed.entries.filter((e) => existing.has(e.code.toLowerCase()));
    const result = { preview: b.preview, created: parsed.entries.length - updates.length, updated: updates.length, errors: parsed.errors.length, problems: parsed.errors.slice(0, 200) };
    if (b.preview || !parsed.entries.length) return result;
    await tx(async (client) => {
      for (const e of parsed.entries) {
        const id = existing.get(e.code.toLowerCase());
        if (id) await client.query('UPDATE penal_codes SET code=$2, title=$3, category=$4, fine=$5, jail=$6, points=$7, description=$8 WHERE id=$1', [id, e.code, e.title, e.category, e.fine, e.jail, e.points, e.description]);
        else await client.query('INSERT INTO penal_codes(owner_user_id,team_id,code,title,category,fine,jail,points,description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [owner.owner_user_id, owner.team_id, e.code, e.title, e.category, e.fine, e.jail, e.points, e.description]);
      }
    });
    await audit(req, 'penal_code.imported', 'penal_code', null, { team: owner.team_id, created: result.created, updated: result.updated });
    return result;
  });

  // ---------- Anklagepunkte: erfassen mit „Lesen & Schreiben“, entscheiden (verurteilt, eingestellt, freigesprochen) mit „Verwalten“
  const chargeFields = z.object({
    person_id: uuid, penal_code_id: uuid.nullish(), code: str(40), title: str(200), count: z.number().int().min(1).max(99).default(1),
    fine: amount.optional(), jail: z.number().int().min(0).max(100000).optional(), points: z.number().int().min(0).max(100).optional(), note: z.string().max(2000).default(''),
  });
  app.post('/case-files/:id/charges', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = chargeFields.parse(req.body);
    await assertInvolved(file.id, b.person_id);
    let base = { code: b.code, title: b.title, fine: '0', jail: 0, points: 0 };
    if (b.penal_code_id) {
      const code = await one('SELECT * FROM penal_codes WHERE id=$1', [b.penal_code_id]);
      if (!code || !sameArea(code, file)) throw bad('Den Tatbestand gibt es im Strafkatalog dieses Bereichs nicht');
      if (!code.active) throw bad('Der Tatbestand ist im Strafkatalog deaktiviert');
      base = { code: code.code, title: code.title, fine: code.fine, jail: code.jail, points: code.points };
    } else if (!b.code || !b.title) throw bad('Tatbestand aus dem Strafkatalog wählen oder Paragraph und Bezeichnung angeben');
    const row = await tx(async (client) => {
      const r = (await client.query(
        `INSERT INTO case_file_charges(case_file_id,person_id,penal_code_id,code,title,count,fine,jail,points,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [file.id, b.person_id, b.penal_code_id || null, base.code, base.title, b.count, b.fine ?? base.fine, b.jail ?? base.jail, b.points ?? base.points, b.note, req.user.id],
      )).rows[0];
      await touch(client, file.id);
      return r;
    });
    await audit(req, 'casefile.charge_added', 'case_file', file.id, { charge: row.id, code: base.code, person: b.person_id });
    return row;
  });
  app.patch('/case-file-charges/:id', authz('casefile:update'), async (req) => {
    const { row, file } = await loadChild(req, 'case_file_charges', req.params.id, write);
    if (row.status !== 'open') throw bad('Über diesen Anklagepunkt ist entschieden; zum Ändern erst wieder öffnen');
    const b = patchSchema(z.object({ count: z.number().int().min(1).max(99), fine: amount, jail: z.number().int().min(0).max(100000), points: z.number().int().min(0).max(100), note: z.string().max(2000) })).parse(req.body);
    const m = { ...row, ...b };
    await q('UPDATE case_file_charges SET count=$2, fine=$3, jail=$4, points=$5, note=$6 WHERE id=$1', [row.id, m.count, m.fine, m.jail, m.points, m.note]);
    await audit(req, 'casefile.charge_updated', 'case_file', file.id, { charge: row.id });
    return { ok: true };
  });
  app.post('/case-file-charges/:id/decision', authz('casefile:update'), async (req) => {
    const { row, file } = await loadChild(req, 'case_file_charges', req.params.id, manage);
    const b = z.object({ status: z.enum(['open', 'convicted', 'dropped', 'acquitted']), note: z.string().max(2000).optional() }).parse(req.body);
    const decided = b.status !== 'open';
    await tx(async (client) => {
      await client.query('UPDATE case_file_charges SET status=$2, decided_at=$3, decided_by=$4, note=COALESCE($5, note) WHERE id=$1',
        [row.id, b.status, decided ? new Date() : null, decided ? req.user.id : null, b.note ?? null]);
      await touch(client, file.id);
    });
    await audit(req, 'casefile.charge_decided', 'case_file', file.id, { charge: row.id, status: b.status });
    return { ok: true };
  });
  app.delete('/case-file-charges/:id', authz('casefile:update'), async (req) => {
    const { row, file, level } = await loadChild(req, 'case_file_charges', req.params.id, write);
    if (row.status !== 'open' && level < manage) throw forbidden(needMessage('casefile', manage));
    await q('DELETE FROM case_file_charges WHERE id=$1', [row.id]);
    await audit(req, 'casefile.charge_deleted', 'case_file', file.id, { code: row.code, person: row.person_id });
    return { ok: true };
  });

  // ---------- Fahndungen
  const warrantFields = z.object({
    kind: z.enum(Object.keys(WARRANT_KINDS)), person_id: uuid.nullish(), plate: str(20), reason: z.string().trim().min(1).max(2000),
    issued_on: isoDate.optional(), valid_until: isoDate.nullish(),
  });
  app.post('/case-files/:id/warrants', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = warrantFields.parse(req.body);
    b.plate = plate(b.plate);
    if (b.kind === 'vehicle' && !b.plate) throw bad('Für eine Fahrzeugfahndung das Kennzeichen angeben');
    if (b.kind !== 'vehicle' && !b.person_id) throw bad('Für diese Fahndung die gesuchte Person wählen');
    await assertInvolved(file.id, b.person_id);
    const issuedOn = b.issued_on || today();
    if (b.valid_until && b.valid_until < issuedOn) throw bad('Gültig bis liegt vor dem Ausstellungsdatum');
    const row = await tx(async (client) => {
      const r = (await client.query(
        'INSERT INTO warrants(case_file_id,kind,person_id,plate,reason,issued_on,valid_until,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [file.id, b.kind, b.person_id || null, b.plate, b.reason, issuedOn, b.valid_until || null, req.user.id],
      )).rows[0];
      await touch(client, file.id);
      return r;
    });
    await audit(req, 'warrant.issued', 'warrant', row.id, { kind: b.kind, case_file: file.id, person: b.person_id, plate: b.plate });
    return row;
  });
  app.post('/warrants/:id/close', authz('casefile:update'), async (req) => {
    const { row, file } = await loadChild(req, 'warrants', req.params.id, write);
    const b = z.object({ status: z.enum(['executed', 'revoked', 'active']), note: str(500) }).parse(req.body);
    const active = b.status === 'active';
    await tx(async (client) => {
      await client.query('UPDATE warrants SET status=$2, close_note=$3, closed_at=$4, closed_by=$5 WHERE id=$1',
        [row.id, b.status, active ? '' : b.note, active ? null : new Date(), active ? null : req.user.id]);
      await touch(client, file.id);
    });
    await audit(req, `warrant.${b.status === 'active' ? 'reopened' : b.status}`, 'warrant', row.id, { case_file: file.id });
    return { ok: true };
  });
  app.delete('/warrants/:id', authz('casefile:delete'), async (req) => {
    const { row, file } = await loadChild(req, 'warrants', req.params.id, manage);
    await q('DELETE FROM warrants WHERE id=$1', [row.id]);
    await audit(req, 'warrant.deleted', 'warrant', row.id, { case_file: file.id });
    return { ok: true };
  });
  // Fahndungsliste und schnelle Abfrage nach Name, Alias oder Kennzeichen über alle Akten, die man sehen darf
  app.get('/warrants', authz('casefile:read'), async (req) => {
    const f = z.object({ status: z.enum(['active', 'all']).default('active'), q: z.string().trim().max(100).optional(), team_id: uuid.optional() }).parse(req.query);
    const params = [req.user.id];
    const where = [`${fileLevelSql('c')} >= 2`];
    if (f.status === 'active') where.push("w.status='active'");
    if (f.team_id) { params.push(f.team_id); where.push(`c.team_id=$${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(pe.name ILIKE $${params.length} OR pe.aliases ILIKE $${params.length} OR w.plate ILIKE $${params.length} OR w.reason ILIKE $${params.length})`); }
    return many(
      `SELECT w.*, pe.name person_name, pe.aliases person_aliases, c.file_number, c.title file_title, c.team_id, t.name team_name,
         (w.status='active' AND w.valid_until IS NOT NULL AND w.valid_until < CURRENT_DATE) expired, ${fileLevelSql('c')} AS level
       FROM warrants w JOIN case_files c ON c.id=w.case_file_id LEFT JOIN teams t ON t.id=c.team_id LEFT JOIN people pe ON pe.id=w.person_id
       WHERE ${where.join(' AND ')}
       ORDER BY w.status='active' DESC, array_position(ARRAY['arrest','wanted','vehicle','search'], w.kind), w.issued_on DESC LIMIT 500`, params,
    );
  });
}
