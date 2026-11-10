// Personenakten: alles, was ein Bereich (Organisation oder privat) über eine Person weiß. Stammdaten und Foto sind global
// wie die Person; Warnhinweise, Vermerke und medizinische Angaben gehören dem Bereich (person_files). Akten, Fahndungen,
// Anklagepunkte, Berichte, Beweismittel, Fahrzeuge, Lizenzen und Schulungen erscheinen nur, soweit man sie sehen darf.
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, forbidden, notFound, can } from '../authz.js';
import { LEVEL, teamLevel, visibleSql } from '../org.js';
import { audit } from '../audit.js';
import { uuid } from '../records.js';
import { area } from '../casefile-access.js';
import { receiveUpload, sendUpload, removeUpload } from '../uploads.js';

const str = (n) => z.string().trim().max(n).default('');
const fileFields = z.object({
  team_id: uuid.nullish(), warnings: z.array(z.string().trim().min(1).max(40)).max(20).default([]), notes: z.string().max(20000).default(''),
  blood_type: str(10), allergies: str(1000), conditions: str(2000), medications: str(1000), emergency_contact: str(200),
});
const PERSON_COLUMNS = 'id, name, kind, function, phone, email, active, note, birth_date, gender, address, nationality, height_cm, features, aliases, (photo_key IS NOT NULL) has_photo';

// Bedingung „Akte gehört zu diesem Bereich und ist für mich sichtbar“; $1 = Benutzer, $2 = Organisation oder eigene ID
const inArea = (owner, alias = 'c') => `${alias}.${owner.team_id ? 'team_id' : 'owner_user_id'}=$2 AND case_file_level(${alias}.id, $1) >= 2`;

export default async function routes(app) {
  const needPeople = (req) => {
    if (!can(req, 'person:read')) throw forbidden('Für Personenakten brauchst du zusätzlich das Recht „Personen lesen“');
  };

  app.get('/person-files', authz('casefile:read'), async (req) => {
    needPeople(req);
    const f = z.object({ team_id: uuid.optional(), q: z.string().trim().max(100).optional(), only: z.enum(['records', 'wanted', 'warnings']).optional() }).parse(req.query);
    const owner = await area(req, f.team_id);
    const areaId = owner.team_id || owner.owner_user_id;
    const filter = { records: 'x.files > 0 OR x.has_file', wanted: 'x.wanted > 0', warnings: 'cardinality(x.warnings) > 0' }[f.only] || 'true';
    return many(
      `SELECT * FROM (
         SELECT pe.id, pe.name, pe.aliases, pe.birth_date, pe.kind, pe.active, pe.function, (pe.photo_key IS NOT NULL) has_photo,
           COALESCE(pf.warnings, '{}') warnings, (pf.id IS NOT NULL) has_file,
           (SELECT count(*)::int FROM case_file_people cp JOIN case_files c ON c.id=cp.case_file_id WHERE cp.person_id=pe.id AND ${inArea(owner)}) files,
           (SELECT count(*)::int FROM warrants w JOIN case_files c ON c.id=w.case_file_id WHERE w.person_id=pe.id AND w.status='active' AND ${inArea(owner)}) wanted,
           (SELECT count(*)::int FROM case_file_charges ch JOIN case_files c ON c.id=ch.case_file_id WHERE ch.person_id=pe.id AND ch.status='convicted' AND ${inArea(owner)}) convictions
         FROM people pe LEFT JOIN person_files pf ON pf.person_id=pe.id AND pf.${owner.team_id ? 'team_id' : 'owner_user_id'}=$2
         WHERE ($3::text IS NULL OR pe.name ILIKE $3 OR pe.aliases ILIKE $3)
       ) x WHERE ${filter} ORDER BY x.wanted > 0 DESC, x.active DESC, x.name LIMIT 300`,
      [req.user.id, areaId, f.q ? `%${f.q}%` : null],
    );
  });

  app.get('/person-files/:personId', authz('casefile:read'), async (req) => {
    needPeople(req);
    const personId = uuid.parse(req.params.personId);
    const f = z.object({ team_id: uuid.optional() }).parse(req.query);
    const owner = await area(req, f.team_id);
    const person = await one(`SELECT ${PERSON_COLUMNS} FROM people WHERE id=$1`, [personId]);
    if (!person) throw notFound('Person nicht gefunden');
    const level = owner.team_id ? await teamLevel(req.user.id, owner.team_id, 'casefile') : LEVEL.MANAGE;
    const p = [req.user.id, owner.team_id || owner.owner_user_id, personId];
    const typeArea = (alias) => `${alias}.${owner.team_id ? 'team_id' : 'owner_user_id'}=$2`;
    const [file, caseFiles, warrants, charges, reports, evidence, vehicles, entries, licenses, trainings, ownedVehicles] = await Promise.all([
      one(`SELECT pf.*, u.name updated_by_name FROM person_files pf LEFT JOIN users u ON u.id=pf.updated_by
        WHERE pf.person_id=$2 AND pf.${owner.team_id ? 'team_id' : 'owner_user_id'}=$1`, [p[1], personId]),
      many(`SELECT c.id, c.file_number, c.title, c.status, c.priority, c.opened_on, c.closed_on, cp.role, ct.name type_name
        FROM case_file_people cp JOIN case_files c ON c.id=cp.case_file_id LEFT JOIN case_file_types ct ON ct.id=c.type_id
        WHERE cp.person_id=$3 AND ${inArea(owner)} ORDER BY c.opened_on DESC, c.file_number DESC`, p),
      many(`SELECT w.*, c.file_number, (w.status='active' AND w.valid_until IS NOT NULL AND w.valid_until < CURRENT_DATE) expired
        FROM warrants w JOIN case_files c ON c.id=w.case_file_id WHERE w.person_id=$3 AND ${inArea(owner)} ORDER BY w.status='active' DESC, w.issued_on DESC`, p),
      many(`SELECT ch.*, c.file_number FROM case_file_charges ch JOIN case_files c ON c.id=ch.case_file_id
        WHERE ch.person_id=$3 AND ${inArea(owner)} ORDER BY ch.created_at DESC`, p),
      many(`SELECT r.id, r.number, r.title, r.kind, r.status, r.occurred_at, r.created_at, c.id case_file_id, c.file_number
        FROM case_file_report_people rp JOIN case_file_reports r ON r.id=rp.report_id JOIN case_files c ON c.id=r.case_file_id
        WHERE rp.person_id=$3 AND ${inArea(owner)} AND (r.status <> 'draft' OR r.author_id=$1) ORDER BY COALESCE(r.occurred_at, r.created_at) DESC`, p),
      many(`SELECT ev.id, ev.number, ev.description, ev.kind, ev.status, c.id case_file_id, c.file_number FROM case_file_evidence ev JOIN case_files c ON c.id=ev.case_file_id
        WHERE ev.person_id=$3 AND ${inArea(owner)} ORDER BY ev.created_at DESC`, p),
      many(`SELECT v.id, v.plate, v.description, v.role, c.id case_file_id, c.file_number FROM case_file_vehicles v JOIN case_files c ON c.id=v.case_file_id
        WHERE v.owner_person_id=$3 AND ${inArea(owner)} ORDER BY v.created_at DESC`, p),
      many(`SELECT e.id, e.entry_date, e.kind, e.body, c.id case_file_id, c.file_number FROM case_file_entries e JOIN case_files c ON c.id=e.case_file_id
        WHERE e.person_id=$3 AND ${inArea(owner)} ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 100`, p),
      can(req, 'license:read') ? many(`SELECT l.id, lt.name type_name, l.number, l.issued_on, l.valid_until, l.status, l.status_reason FROM licenses l
        JOIN license_types lt ON lt.id=l.type_id WHERE l.person_id=$3 AND ${typeArea('lt')} AND ${visibleSql('lt', 'license')} ORDER BY lt.name, l.issued_on DESC`, p) : null,
      can(req, 'training:read') ? many(`SELECT r.id, tr.name training_name, r.result, r.completed_on, r.valid_until FROM training_records r
        JOIN trainings tr ON tr.id=r.training_id WHERE r.person_id=$3 AND ${typeArea('tr')} AND ${visibleSql('tr', 'training')}
        ORDER BY r.completed_on DESC NULLS LAST`, p) : null,
      // Fahrzeuge aus der Objektverwaltung mit der Person als Besitzer, im selben Bereich und soweit sichtbar
      can(req, 'vehicle:read') ? many(`SELECT v.id, v.plate, v.make_model, v.status FROM vehicles v
        WHERE v.owner_person_id=$3 AND ${typeArea('v')} AND ${visibleSql('v', 'vehicle')} ORDER BY v.status = 'retired', v.plate`, p) : null,
    ]);
    // Vorstrafen: Summe der verurteilten Anklagepunkte (Strafe je Punkt mal Anzahl)
    const convicted = charges.filter((c) => c.status === 'convicted');
    const totals = {
      convictions: convicted.length,
      fine: convicted.reduce((sum, c) => sum + Number(c.fine) * c.count, 0).toFixed(2),
      jail: convicted.reduce((sum, c) => sum + c.jail * c.count, 0),
      points: convicted.reduce((sum, c) => sum + c.points * c.count, 0),
    };
    return { person, area: owner, level, file, case_files: caseFiles, warrants, charges, totals, reports, evidence, vehicles, entries, licenses, trainings, owned_vehicles: ownedVehicles };
  });

  app.put('/person-files/:personId', authz('casefile:update'), async (req) => {
    needPeople(req);
    const personId = uuid.parse(req.params.personId);
    const b = fileFields.parse(req.body);
    const owner = await area(req, b.team_id, LEVEL.WRITE);
    if (!(await one('SELECT 1 FROM people WHERE id=$1', [personId]))) throw notFound('Person nicht gefunden');
    const warnings = [...new Set(b.warnings)];
    const column = owner.team_id ? 'team_id' : 'owner_user_id';
    const values = [personId, owner.team_id || owner.owner_user_id, warnings, b.notes, b.blood_type, b.allergies, b.conditions, b.medications, b.emergency_contact, req.user.id];
    const updated = await one(
      `UPDATE person_files SET warnings=$3, notes=$4, blood_type=$5, allergies=$6, conditions=$7, medications=$8, emergency_contact=$9, updated_by=$10, updated_at=now()
       WHERE person_id=$1 AND ${column}=$2 RETURNING id`, values);
    const row = updated || await one(
      `INSERT INTO person_files(person_id, ${column}, warnings, notes, blood_type, allergies, conditions, medications, emergency_contact, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, values);
    await audit(req, 'person_file.updated', 'person_file', row.id, { person: personId, team: owner.team_id, warnings });
    return row;
  });

  // ---------- Foto der Person (global wie die Stammdaten)
  async function loadPerson(id) {
    const person = await one('SELECT id, name, photo_key, photo_mime FROM people WHERE id=$1', [uuid.parse(id)]);
    if (!person) throw notFound('Person nicht gefunden');
    return person;
  }
  app.post('/people/:id/photo', authz('person:update'), async (req) => {
    const person = await loadPerson(req.params.id);
    const upload = await receiveUpload(req, { images: true });
    await q('UPDATE people SET photo_key=$2, photo_mime=$3 WHERE id=$1', [person.id, upload.key, upload.mime]);
    if (person.photo_key) removeUpload(person.photo_key);
    await audit(req, 'people.photo_set', 'people', person.id);
    return { ok: true };
  });
  app.get('/people/:id/photo', authz('person:read'), async (req, reply) => {
    const person = await loadPerson(req.params.id);
    if (!person.photo_key) throw notFound('Kein Foto hinterlegt');
    return sendUpload(reply, { storage_key: person.photo_key, mime: person.photo_mime, original_name: `foto-${person.id}.${person.photo_mime === 'image/png' ? 'png' : 'jpg'}` });
  });
  app.delete('/people/:id/photo', authz('person:update'), async (req) => {
    const person = await loadPerson(req.params.id);
    if (!person.photo_key) throw bad('Kein Foto hinterlegt');
    await q('UPDATE people SET photo_key=NULL, photo_mime=NULL WHERE id=$1', [person.id]);
    removeUpload(person.photo_key);
    await audit(req, 'people.photo_removed', 'people', person.id);
    return { ok: true };
  });
}
