import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, notFound, recordRole, recordOwner } from '../authz.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { addInterval, today } from '../lib.js';
import { uuid, isoDate, visibleSql, roleSql, assertPersonInScope, personJoin } from '../records.js';

export const EXPIRY_WARNING_DAYS = 30;

const typeFields = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(''),
  validity_months: z.number().int().min(1).max(1200).nullish(),
});
const licenseFields = z.object({
  number: z.string().trim().max(60).default(''),
  issued_on: isoDate.optional(),
  valid_until: isoDate.nullish(),
  issuer: z.string().trim().max(100).default(''),
  note: z.string().max(2000).default(''),
});
const statusFields = {
  status: z.enum(['valid', 'suspended', 'revoked']).optional(),
  status_reason: z.string().trim().max(500).optional(),
};

// Zustand für die Anzeige: gesperrt und entzogen gehen vor, sonst zählt das Ablaufdatum
export const licenseState = `CASE WHEN l.status<>'valid' THEN l.status
  WHEN l.valid_until IS NOT NULL AND l.valid_until < CURRENT_DATE THEN 'expired'
  WHEN l.valid_until IS NOT NULL AND l.valid_until <= CURRENT_DATE + ${EXPIRY_WARNING_DAYS} THEN 'expiring'
  ELSE 'valid' END`;

export default async function routes(app) {
  async function loadType(req, id, write = false) {
    const type = await one('SELECT * FROM license_types WHERE id=$1', [id]);
    const role = await recordRole(req.user.id, type, write);
    return { type, role };
  }
  async function loadLicense(req, write = false) {
    const license = await one('SELECT * FROM licenses WHERE id=$1', [req.params.id]);
    if (!license) throw notFound();
    const { type } = await loadType(req, license.type_id, write);
    return { license, type };
  }
  const checkDates = (issued, until) => {
    if (until && issued && until < issued) throw bad('Gültig bis liegt vor dem Ausstellungsdatum');
  };

  // ---- Lizenzarten
  app.get('/license-types', authz('license:read'), async (req) => many(
    `SELECT lt.*, t.name team_name, ${roleSql('lt')} AS role, (SELECT count(*)::int FROM licenses l WHERE l.type_id=lt.id) licenses
     FROM license_types lt LEFT JOIN teams t ON t.id=lt.team_id WHERE ${visibleSql('lt')} ORDER BY lt.name`,
    [req.user.id],
  ));

  app.post('/license-types', authz('license:create'), async (req) => {
    const b = typeFields.extend({ team_id: uuid.nullish() }).parse(req.body);
    const scope = await recordOwner(req.user.id, b.team_id);
    const row = await one(
      'INSERT INTO license_types(owner_user_id,team_id,name,description,validity_months) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [scope.owner_user_id, scope.team_id, b.name, b.description, b.validity_months ?? null],
    );
    await audit(req, 'license_type.created', 'license_type', row.id, { name: b.name });
    return row;
  });

  app.patch('/license-types/:id', authz('license:update'), async (req) => {
    const { type } = await loadType(req, req.params.id, true);
    const b = patchSchema(typeFields).parse(req.body);
    await q('UPDATE license_types SET name=$2, description=$3, validity_months=$4 WHERE id=$1', [
      type.id, b.name ?? type.name, b.description ?? type.description, 'validity_months' in b ? b.validity_months ?? null : type.validity_months,
    ]);
    await audit(req, 'license_type.updated', 'license_type', type.id);
    return { ok: true };
  });

  app.delete('/license-types/:id', authz('license:delete'), async (req) => {
    const { type } = await loadType(req, req.params.id, true);
    if (await one('SELECT 1 FROM licenses WHERE type_id=$1 LIMIT 1', [type.id])) throw bad('Es gibt noch Lizenzen dieser Art – zuerst löschen');
    await q('DELETE FROM license_types WHERE id=$1', [type.id]);
    await audit(req, 'license_type.deleted', 'license_type', type.id, { name: type.name });
    return { ok: true };
  });

  // ---- Lizenzen
  app.get('/licenses', authz('license:read'), async (req) => {
    const f = z.object({
      type_id: uuid.optional(), person_id: uuid.optional(), q: z.string().max(100).optional(),
      state: z.enum(['valid', 'expiring', 'expired', 'suspended', 'revoked']).optional(),
    }).parse(req.query);
    const params = [req.user.id];
    const where = [visibleSql('lt')];
    if (f.type_id) { params.push(f.type_id); where.push(`l.type_id=$${params.length}`); }
    if (f.person_id) { params.push(f.person_id); where.push(`l.person_id=$${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(pe.name ILIKE $${params.length} OR l.number ILIKE $${params.length} OR lt.name ILIKE $${params.length})`); }
    if (f.state) { params.push(f.state); where.push(`(${licenseState})=$${params.length}`); }
    return many(
      `SELECT l.*, lt.name type_name, lt.validity_months, lt.team_id, t.name team_name, pe.name person_name, ${roleSql('lt')} AS role, ${licenseState} AS state
       FROM licenses l JOIN license_types lt ON lt.id=l.type_id LEFT JOIN teams t ON t.id=lt.team_id ${personJoin('pe', 'l.person_id')}
       WHERE ${where.join(' AND ')}
       ORDER BY (${licenseState}) IN ('valid') , l.valid_until NULLS LAST, pe.name LIMIT 1000`,
      params,
    );
  });

  app.post('/licenses', authz('license:create'), async (req) => {
    const b = licenseFields.extend({ type_id: uuid, person_id: uuid }).parse(req.body);
    const { type } = await loadType(req, b.type_id, true);
    await assertPersonInScope(b.person_id, type);
    const issuedOn = b.issued_on || today();
    // Ohne Angabe gilt die Standard-Gültigkeit der Lizenzart; null heißt unbefristet
    const validUntil = 'valid_until' in b ? b.valid_until ?? null : type.validity_months ? addInterval(issuedOn, 'monthly', type.validity_months) : null;
    checkDates(issuedOn, validUntil);
    const row = await one(
      `INSERT INTO licenses(type_id,person_id,number,issued_on,valid_until,issuer,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, valid_until`,
      [type.id, b.person_id, b.number, issuedOn, validUntil, b.issuer, b.note, req.user.id],
    );
    await audit(req, 'license.issued', 'license', row.id, { type: type.name, person: b.person_id });
    return row;
  });

  app.patch('/licenses/:id', authz('license:update'), async (req) => {
    const { license } = await loadLicense(req, true);
    const b = patchSchema(licenseFields).extend(statusFields).parse(req.body);
    const issuedOn = b.issued_on ?? license.issued_on;
    const validUntil = 'valid_until' in b ? b.valid_until ?? null : license.valid_until;
    checkDates(issuedOn, validUntil);
    const status = b.status ?? license.status;
    // Zurück auf gültig: Begründung entfällt
    const reason = status === 'valid' ? '' : b.status_reason ?? license.status_reason;
    await q(
      `UPDATE licenses SET number=$2, issued_on=$3, valid_until=$4, issuer=$5, note=$6, status=$7, status_reason=$8, updated_at=now() WHERE id=$1`,
      [license.id, b.number ?? license.number, issuedOn, validUntil, b.issuer ?? license.issuer, b.note ?? license.note, status, reason],
    );
    await audit(req, status !== license.status ? `license.${status}` : 'license.updated', 'license', license.id, status !== license.status ? { reason } : undefined);
    return { ok: true };
  });

  // Verlängern um die Standard-Gültigkeit, ab heute oder ab dem bisherigen Ablauf, falls der noch in der Zukunft liegt
  app.post('/licenses/:id/renew', authz('license:update'), async (req) => {
    const { license, type } = await loadLicense(req, true);
    if (!type.validity_months) throw bad('Die Lizenzart hat keine Standard-Gültigkeit – trage das neue Ablaufdatum direkt ein');
    if (license.status === 'revoked') throw bad('Eine entzogene Lizenz lässt sich nicht verlängern');
    const from = license.valid_until && license.valid_until > today() ? license.valid_until : today();
    const validUntil = addInterval(from, 'monthly', type.validity_months);
    await q('UPDATE licenses SET valid_until=$2, updated_at=now() WHERE id=$1', [license.id, validUntil]);
    await audit(req, 'license.renewed', 'license', license.id, { valid_until: validUntil });
    return { valid_until: validUntil };
  });

  app.delete('/licenses/:id', authz('license:delete'), async (req) => {
    const { license } = await loadLicense(req, true);
    await q('DELETE FROM licenses WHERE id=$1', [license.id]);
    await audit(req, 'license.deleted', 'license', license.id);
    return { ok: true };
  });
}
