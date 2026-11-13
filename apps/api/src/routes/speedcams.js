// Blitzer (Wunsch des Auftraggebers vom 2026-11-13): systemweit, Rechte allein über die Rollenrechte speedcam:*.
// Standorte und Blitzer-Rechnungen; aus einer Rechnung entsteht ein Eintrag in der Personenakte des Halters
// (person_file_entries, Bereich frei wählbar wie in der Personenakte, braucht dort „Lesen & Schreiben“ bei Akten).
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden, notFound, can } from '../authz.js';
import { LEVEL, visibleSql } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDateTime } from '../records.js';
import { area } from '../casefile-access.js';
import { patchSchema } from '../validation.js';
import { config } from '../config.js';
import { overSpeed, ticketEntryBody, localParts } from '../speedcam.js';

const cameraFields = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().max(200).default(''),
  kind: z.enum(['fixed', 'mobile']).default('fixed'),
  speed_limit: z.number().int().min(1).max(400),
  active: z.boolean().default(true),
  note: z.string().max(2000).default(''),
});
const amount = z.union([z.number(), z.string()]).transform((v) => String(v).trim().replace(',', '.')).pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Betrag ungültig'));
const ticketFields = z.object({
  camera_id: uuid,
  measured_at: isoDateTime,
  plate: z.string().trim().min(1).max(20),
  person_id: uuid.nullish(),
  speed_limit: z.number().int().min(1).max(400).optional(),
  measured_kmh: z.number().int().min(1).max(1000),
  tolerance_kmh: z.number().int().min(0).max(100).default(0),
  amount: amount.default('0'),
  status: z.enum(['open', 'paid', 'cancelled']).default('open'),
  note: z.string().max(2000).default(''),
});

const TICKET_SELECT = `SELECT t.*, c.name camera_name, c.location camera_location, c.kind camera_kind, pe.name person_name,
    cu.name created_by_name, e.team_id entry_team_id, e.owner_user_id entry_owner_id,
    (e.id IS NOT NULL) has_entry
  FROM speed_tickets t JOIN speed_cameras c ON c.id=t.camera_id
  LEFT JOIN people pe ON pe.id=t.person_id
  LEFT JOIN users cu ON cu.id=t.created_by
  LEFT JOIN person_file_entries e ON e.id=t.person_file_entry_id`;

// Halter nur für Benutzer mit „Personen lesen“; die Akte nennt nur ihren Bereich, nicht ihren Inhalt
function present(req, t) {
  const showPerson = can(req, 'person:read');
  const { entry_owner_id: entryOwner, ...rest } = t;
  return {
    ...rest,
    person_id: showPerson ? t.person_id : null,
    person_name: showPerson ? t.person_name : null,
    has_person: Boolean(t.person_id),
    over_kmh: overSpeed(t),
    entry_area: t.has_entry ? (t.entry_team_id ? 'team' : entryOwner === req.user.id ? 'own' : 'other') : null,
  };
}

// Fahrzeug zum Kennzeichen unter den für mich sichtbaren, nicht ausgemusterten Fahrzeugen (Halter = Besitzer)
async function lookupPlate(userId, plate) {
  return one(
    `SELECT v.id, v.plate, v.make_model, v.owner_person_id, pe.name owner_person_name FROM vehicles v
     LEFT JOIN people pe ON pe.id=v.owner_person_id
     WHERE lower(v.plate)=lower($2) AND v.status <> 'retired' AND ${visibleSql('v', 'vehicle')}
     ORDER BY v.id LIMIT 1`,
    [userId, plate],
  );
}

async function loadTicket(req, id) {
  const t = await one(`${TICKET_SELECT} WHERE t.id=$1`, [uuid.parse(id)]);
  if (!t) throw notFound('Blitzer-Rechnung nicht gefunden');
  return t;
}

export default async function routes(app) {
  // ---------- Standorte
  app.get('/speed-cameras', authz('speedcam:read'), async () => many(
    `SELECT c.*, (SELECT count(*)::int FROM speed_tickets t WHERE t.camera_id=c.id) tickets
     FROM speed_cameras c ORDER BY c.active DESC, lower(c.name)`,
  ));

  const saveCamera = async (req, sql, params) => {
    try {
      return await one(sql, params);
    } catch (e) {
      if (e.code === '23505') throw bad('Einen Standort mit diesem Namen gibt es schon');
      throw e;
    }
  };

  app.post('/speed-cameras', authz('speedcam:create'), async (req) => {
    const b = cameraFields.parse(req.body);
    const row = await saveCamera(req,
      `INSERT INTO speed_cameras(name, location, kind, speed_limit, active, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.name, b.location, b.kind, b.speed_limit, b.active, b.note, req.user.id]);
    await audit(req, 'speedcam.camera_created', 'speed_camera', row.id, { name: b.name });
    return row;
  });

  app.patch('/speed-cameras/:id', authz('speedcam:update'), async (req) => {
    const id = uuid.parse(req.params.id);
    const patch = patchSchema(cameraFields).parse(req.body);
    const keys = Object.keys(patch);
    if (!keys.length) return { ok: true };
    const row = await saveCamera(req,
      `UPDATE speed_cameras SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1 RETURNING id`,
      [id, ...keys.map((k) => patch[k])]);
    if (!row) throw notFound('Standort nicht gefunden');
    await audit(req, 'speedcam.camera_updated', 'speed_camera', id, { fields: keys });
    return { ok: true };
  });

  app.delete('/speed-cameras/:id', authz('speedcam:delete'), async (req) => {
    const id = uuid.parse(req.params.id);
    const camera = await one('SELECT id, name FROM speed_cameras WHERE id=$1', [id]);
    if (!camera) throw notFound('Standort nicht gefunden');
    if (await one('SELECT 1 FROM speed_tickets WHERE camera_id=$1 LIMIT 1', [id])) throw bad('Der Standort hat Blitzer-Rechnungen – schalte ihn stattdessen ab');
    await q('DELETE FROM speed_cameras WHERE id=$1', [id]);
    await audit(req, 'speedcam.camera_deleted', 'speed_camera', id, { name: camera.name });
    return { ok: true };
  });

  // ---------- Rechnungen
  app.get('/speed-tickets', authz('speedcam:read'), async (req) => {
    const f = z.object({
      status: z.enum(['open', 'paid', 'cancelled']).optional(), camera_id: uuid.optional(), q: z.string().trim().max(100).optional(),
      person_id: uuid.optional(),
    }).parse(req.query);
    const showPerson = can(req, 'person:read');
    const rows = await many(
      `${TICKET_SELECT}
       WHERE ($1::text IS NULL OR t.status=$1) AND ($2::uuid IS NULL OR t.camera_id=$2)
         AND ($3::text IS NULL OR t.plate ILIKE $3 OR t.number ILIKE $3 OR c.name ILIKE $3 OR ($5 AND pe.name ILIKE $3))
         AND ($4::uuid IS NULL OR ($5 AND t.person_id=$4))
       ORDER BY t.measured_at DESC LIMIT 1000`,
      [f.status || null, f.camera_id || null, f.q ? `%${f.q}%` : null, f.person_id || null, showPerson],
    );
    return rows.map((t) => present(req, t));
  });

  // Vorschlag für das Formular: Fahrzeug und Halter zum Kennzeichen
  app.get('/speed-tickets/lookup', authz('speedcam:read'), async (req) => {
    const { plate } = z.object({ plate: z.string().trim().min(1).max(20) }).parse(req.query);
    const v = await lookupPlate(req.user.id, plate);
    if (!v) return { vehicle: null, person: null };
    return {
      vehicle: { id: v.id, plate: v.plate, make_model: v.make_model },
      person: v.owner_person_id && can(req, 'person:read') ? { id: v.owner_person_id, name: v.owner_person_name } : null,
    };
  });

  app.post('/speed-tickets', authz('speedcam:create'), async (req) => {
    const b = ticketFields.parse(req.body);
    const camera = await one('SELECT id, speed_limit FROM speed_cameras WHERE id=$1', [b.camera_id]);
    if (!camera) throw bad('Standort nicht gefunden');
    const vehicle = await lookupPlate(req.user.id, b.plate);
    // Halter: ausdrücklich gewählt (braucht „Personen lesen“) oder Besitzer des Fahrzeugs
    let personId = vehicle?.owner_person_id || null;
    if (b.person_id) {
      if (!can(req, 'person:read')) throw forbidden('Einen Halter wählen braucht das Recht „Personen lesen“');
      if (!(await one('SELECT 1 FROM people WHERE id=$1', [b.person_id]))) throw bad('Person nicht gefunden');
      personId = b.person_id;
    }
    const row = await one(
      `INSERT INTO speed_tickets(number, camera_id, measured_at, plate, vehicle_id, person_id, speed_limit, measured_kmh, tolerance_kmh, amount, status, note, created_by, updated_by)
       VALUES ('B-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('speed_ticket_seq')::text, 4, '0'), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id, number`,
      [camera.id, b.measured_at, b.plate, vehicle?.id || null, personId, b.speed_limit ?? camera.speed_limit, b.measured_kmh, b.tolerance_kmh, b.amount, b.status, b.note, req.user.id],
    );
    await audit(req, 'speedcam.ticket_created', 'speed_ticket', row.id, { number: row.number, plate: b.plate, person: personId });
    return row;
  });

  app.patch('/speed-tickets/:id', authz('speedcam:update'), async (req) => {
    const t = await loadTicket(req, req.params.id);
    const patch = patchSchema(ticketFields).parse(req.body);
    if ('person_id' in patch) {
      if (!can(req, 'person:read')) throw forbidden('Einen Halter wählen braucht das Recht „Personen lesen“');
      if (patch.person_id && !(await one('SELECT 1 FROM people WHERE id=$1', [patch.person_id]))) throw bad('Person nicht gefunden');
    }
    if (patch.camera_id && !(await one('SELECT 1 FROM speed_cameras WHERE id=$1', [patch.camera_id]))) throw bad('Standort nicht gefunden');
    const set = { ...patch };
    if (patch.plate && patch.plate.toLowerCase() !== t.plate.toLowerCase()) {
      const vehicle = await lookupPlate(req.user.id, patch.plate);
      set.vehicle_id = vehicle?.id || null;
      if (!('person_id' in patch)) set.person_id = vehicle?.owner_person_id || null;
    }
    const keys = Object.keys(set);
    if (!keys.length) return { ok: true };
    await q(`UPDATE speed_tickets SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_by=$${keys.length + 2}, updated_at=now() WHERE id=$1`,
      [t.id, ...keys.map((k) => set[k] ?? null), req.user.id]);
    await audit(req, 'speedcam.ticket_updated', 'speed_ticket', t.id, { number: t.number, fields: keys });
    return { ok: true };
  });

  app.delete('/speed-tickets/:id', authz('speedcam:delete'), async (req) => {
    const t = await loadTicket(req, req.params.id);
    await q('DELETE FROM speed_tickets WHERE id=$1', [t.id]);
    await audit(req, 'speedcam.ticket_deleted', 'speed_ticket', t.id, { number: t.number, plate: t.plate });
    return { ok: true };
  });

  // Akteneintrag aus der Rechnung: Eintrag in der Personenakte des Halters im gewählten Bereich, höchstens einmal
  app.post('/speed-tickets/:id/file-entry', authz('speedcam:read', 'casefile:update', 'person:read'), async (req) => {
    const b = z.object({ team_id: uuid.nullish() }).parse(req.body);
    const owner = await area(req, b.team_id, LEVEL.WRITE);
    const me = await one('SELECT currency FROM users WHERE id=$1', [req.user.id]);
    return tx(async (c) => {
      const t = (await c.query(`${TICKET_SELECT} WHERE t.id=$1 FOR UPDATE OF t`, [uuid.parse(req.params.id)])).rows[0];
      if (!t) throw notFound('Blitzer-Rechnung nicht gefunden');
      if (!t.person_id) throw bad('Die Rechnung hat keinen Halter. Trage zuerst eine Person ein.');
      if (t.person_file_entry_id) throw bad('Zu dieser Rechnung gibt es schon einen Akteneintrag');
      const body = ticketEntryBody(t, { timeZone: config.tz, currency: me?.currency });
      const entry = (await c.query(
        `INSERT INTO person_file_entries(person_id, owner_user_id, team_id, entry_date, kind, body, created_by, updated_by)
         VALUES ($1,$2,$3,$4,'Blitzer',$5,$6,$6) RETURNING id`,
        [t.person_id, owner.owner_user_id, owner.team_id, localParts(t.measured_at, config.tz).date, body, req.user.id],
      )).rows[0];
      await c.query('UPDATE speed_tickets SET person_file_entry_id=$2, updated_at=now() WHERE id=$1', [t.id, entry.id]);
      await audit(req, 'person_file.entry_added', 'person_file_entry', entry.id, { person: t.person_id, team: owner.team_id, speed_ticket: t.number });
      return { id: entry.id, person_id: t.person_id };
    });
  });
}
