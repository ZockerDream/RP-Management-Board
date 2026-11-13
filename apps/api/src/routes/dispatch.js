// Einsätze & Funk (Wünsche des Auftraggebers vom 2026-11-13): Einheiten mit Status 1–6, Einsätze mit beteiligten
// Einheiten und Verlauf, Funkbuch, Übernahme in eine Fallakte. Funktion „dispatch“: 2 sehen, 3 Einsätze führen, Status
// setzen und Funkbuch schreiben, 4 Einheiten verwalten und Einsätze löschen. Die eigene Einheit (Besatzung) setzt ihren
// Status schon ab Stufe 2.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden, notFound } from '../authz.js';
import { LEVEL } from '../org.js';
import { audit } from '../audit.js';
import { uuid } from '../records.js';
import { patchSchema } from '../validation.js';
import { config } from '../config.js';
import { teamFor, loadTeamRow } from '../orgfeature.js';
import { loadFile } from '../casefile-access.js';
import { discord } from '../discord-send.js';

export const UNIT_STATUS = {
  1: 'Einsatzbereit über Funk', 2: 'Einsatzbereit auf Wache', 3: 'Einsatz übernommen', 4: 'Am Einsatzort', 5: 'Sprechwunsch', 6: 'Nicht einsatzbereit',
};
const PRIORITY = { low: 'Niedrig', normal: 'Normal', high: 'Hoch', critical: 'Kritisch' };
const unitFields = z.object({
  callsign: z.string().trim().min(1).max(40), kind: z.string().trim().max(40).default(''),
  fleet_vehicle_id: uuid.nullish(), crew: z.array(uuid).max(20).default([]), active: z.boolean().default(true), sort: z.number().int().min(-1000).max(1000).default(0),
});
const incidentFields = z.object({
  title: z.string().trim().min(1).max(200), kind: z.string().trim().max(60).default(''), priority: z.enum(Object.keys(PRIORITY)).default('normal'),
  location: z.string().trim().max(200).default(''), description: z.string().max(20000).default(''),
});
const time = (d) => new Date(d).toLocaleString('de-DE', { timeZone: config.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const saveUnit = async (sql, params) => {
  try { return await one(sql, params); } catch (e) { if (e.code === '23505') throw bad('Diesen Rufnamen gibt es schon'); throw e; }
};
async function checkUnitRefs(teamId, b) {
  if (b.fleet_vehicle_id && !(await one('SELECT 1 FROM fleet_vehicles WHERE id=$1 AND team_id=$2', [b.fleet_vehicle_id, teamId]))) throw bad('Fahrzeug gehört nicht zum Fuhrpark dieser Organisation');
  if (b.crew?.length) {
    const n = (await one('SELECT count(*)::int n FROM team_members WHERE team_id=$1 AND user_id = ANY($2::uuid[])', [teamId, b.crew])).n;
    if (n !== new Set(b.crew).size) throw bad('Besatzung muss aus Mitgliedern der Organisation bestehen');
  }
}
const log = (c, teamId, entry, userId) => c.query(
  'INSERT INTO dispatch_log(team_id, unit_id, incident_id, kind, status, text, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [teamId, entry.unit_id || null, entry.incident_id || null, entry.kind, entry.status || null, entry.text || '', userId],
);
async function setStatus(c, unit, status, note, userId, incidentId = null) {
  await c.query('UPDATE dispatch_units SET status=$2, status_note=$3, status_at=now() WHERE id=$1', [unit.id, status, note || '']);
  await log(c, unit.team_id, { unit_id: unit.id, incident_id: incidentId, kind: 'status', status, text: note }, userId);
}

async function loadIncident(req, need) {
  const { row, level } = await loadTeamRow(req, 'incidents', uuid.parse(req.params.id), 'dispatch', need);
  return { incident: row, level };
}

export default async function routes(app) {
  // Lage: Einheiten, laufende und letzte Einsätze
  app.get('/dispatch', authz('dispatch:read'), async (req) => {
    const { team_id: teamId } = z.object({ team_id: uuid }).parse(req.query);
    const level = await teamFor(req, teamId, 'dispatch', LEVEL.READ);
    const [units, incidents, members] = await Promise.all([
      many(`SELECT u.*, f.plate vehicle_plate, f.model vehicle_model, i.id incident_id, i.number incident_number, i.title incident_title
        FROM dispatch_units u LEFT JOIN fleet_vehicles f ON f.id=u.fleet_vehicle_id
        LEFT JOIN incident_units iu ON iu.unit_id=u.id AND iu.released_at IS NULL LEFT JOIN incidents i ON i.id=iu.incident_id
        WHERE u.team_id=$1 ORDER BY u.active DESC, u.sort, lower(u.callsign)`, [teamId]),
      many(`SELECT i.*, cf.file_number, (SELECT json_agg(json_build_object('unit_id', iu.unit_id, 'callsign', u.callsign, 'released_at', iu.released_at) ORDER BY u.callsign)
          FROM incident_units iu JOIN dispatch_units u ON u.id=iu.unit_id WHERE iu.incident_id=i.id) units
        FROM incidents i LEFT JOIN case_files cf ON cf.id=i.case_file_id
        WHERE i.team_id=$1 AND (i.status='active' OR i.closed_at > now() - interval '7 days') ORDER BY i.status, i.started_at DESC LIMIT 200`, [teamId]),
      many('SELECT tm.user_id, u.name FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1', [teamId]),
    ]);
    const names = new Map(members.map((m) => [m.user_id, m.name]));
    return {
      level, statuses: UNIT_STATUS, priorities: PRIORITY,
      units: units.map((u) => ({ ...u, crew_names: u.crew.map((id) => names.get(id)).filter(Boolean), mine: u.crew.includes(req.user.id) })),
      incidents: incidents.map((i) => ({ ...i, units: i.units || [] })),
    };
  });

  // ---------- Einheiten
  app.post('/dispatch-units', authz('dispatch:create'), async (req) => {
    const b = unitFields.extend({ team_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, 'dispatch', LEVEL.MANAGE);
    await checkUnitRefs(b.team_id, b);
    const row = await saveUnit('INSERT INTO dispatch_units(team_id, callsign, kind, fleet_vehicle_id, crew, active, sort) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [b.team_id, b.callsign, b.kind, b.fleet_vehicle_id || null, [...new Set(b.crew)], b.active, b.sort]);
    await audit(req, 'dispatch.unit_created', 'dispatch_unit', row.id, { callsign: b.callsign });
    return row;
  });
  app.patch('/dispatch-units/:id', authz('dispatch:update'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'dispatch_units', uuid.parse(req.params.id), 'dispatch', LEVEL.READ);
    const p = patchSchema(unitFields).parse(req.body);
    // Besatzung darf die eigene Einheit ab Stufe 3 umstellen, alles andere ab 4
    if (level < LEVEL.MANAGE && !(level >= LEVEL.WRITE && Object.keys(p).every((k) => k === 'crew'))) throw forbidden('Einheiten verwaltet, wer bei Einsätze & Funk „Verwalten“ hat');
    const b = { ...row, ...p };
    await checkUnitRefs(row.team_id, p);
    await saveUnit('UPDATE dispatch_units SET callsign=$2, kind=$3, fleet_vehicle_id=$4, crew=$5, active=$6, sort=$7 WHERE id=$1 RETURNING id',
      [row.id, b.callsign, b.kind, b.fleet_vehicle_id || null, [...new Set(b.crew)], b.active, b.sort]);
    return { ok: true };
  });
  app.delete('/dispatch-units/:id', authz('dispatch:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'dispatch_units', uuid.parse(req.params.id), 'dispatch', LEVEL.MANAGE);
    if (await one('SELECT 1 FROM incident_units WHERE unit_id=$1 AND released_at IS NULL', [row.id])) throw bad('Die Einheit ist in einem laufenden Einsatz');
    await q('DELETE FROM dispatch_units WHERE id=$1', [row.id]);
    await audit(req, 'dispatch.unit_deleted', 'dispatch_unit', row.id, { callsign: row.callsign });
    return { ok: true };
  });

  // Status setzen: Einsatzführung (3) oder die eigene Besatzung (2)
  app.put('/dispatch-units/:id/status', authz('dispatch:read'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'dispatch_units', uuid.parse(req.params.id), 'dispatch', LEVEL.READ);
    if (level < LEVEL.WRITE && !row.crew.includes(req.user.id)) throw forbidden('Den Status setzt die eigene Besatzung oder die Einsatzführung');
    const b = z.object({ status: z.number().int().min(1).max(6), note: z.string().trim().max(200).default('') }).parse(req.body);
    const current = await one('SELECT incident_id FROM incident_units WHERE unit_id=$1 AND released_at IS NULL', [row.id]);
    await tx((c) => setStatus(c, row, b.status, b.note, req.user.id, current?.incident_id));
    return { ok: true };
  });

  // ---------- Funkbuch
  app.get('/dispatch-log', authz('dispatch:read'), async (req) => {
    const f = z.object({ team_id: uuid, incident_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    await teamFor(req, f.team_id, 'dispatch', LEVEL.READ);
    return many(
      `SELECT l.*, u.callsign, i.number incident_number, cu.name created_by_name FROM dispatch_log l
       LEFT JOIN dispatch_units u ON u.id=l.unit_id LEFT JOIN incidents i ON i.id=l.incident_id LEFT JOIN users cu ON cu.id=l.created_by
       WHERE l.team_id=$1 AND ($2::uuid IS NULL OR l.incident_id=$2) ORDER BY l.created_at DESC LIMIT ${f.limit}`, [f.team_id, f.incident_id || null]);
  });
  app.post('/dispatch-log', authz('dispatch:update'), async (req) => {
    const b = z.object({ team_id: uuid, unit_id: uuid.nullish(), incident_id: uuid.nullish(), text: z.string().trim().min(1).max(2000) }).parse(req.body);
    await teamFor(req, b.team_id, 'dispatch', LEVEL.WRITE);
    if (b.unit_id && !(await one('SELECT 1 FROM dispatch_units WHERE id=$1 AND team_id=$2', [b.unit_id, b.team_id]))) throw bad('Einheit gehört nicht zu dieser Organisation');
    if (b.incident_id && !(await one('SELECT 1 FROM incidents WHERE id=$1 AND team_id=$2', [b.incident_id, b.team_id]))) throw bad('Einsatz gehört nicht zu dieser Organisation');
    await tx((c) => log(c, b.team_id, { unit_id: b.unit_id, incident_id: b.incident_id, kind: b.incident_id ? 'incident' : 'message', text: b.text }, req.user.id));
    return { ok: true };
  });

  // ---------- Einsätze
  async function assignUnits(c, incident, unitIds, userId) {
    for (const unitId of [...new Set(unitIds)]) {
      const unit = (await c.query('SELECT * FROM dispatch_units WHERE id=$1 AND team_id=$2', [unitId, incident.team_id])).rows[0];
      if (!unit) throw bad('Einheit gehört nicht zu dieser Organisation');
      const busy = (await c.query('SELECT i.number FROM incident_units iu JOIN incidents i ON i.id=iu.incident_id WHERE iu.unit_id=$1 AND iu.released_at IS NULL AND iu.incident_id<>$2', [unitId, incident.id])).rows[0];
      if (busy) throw bad(`${unit.callsign} ist schon im Einsatz ${busy.number}`);
      await c.query(`INSERT INTO incident_units(incident_id, unit_id) VALUES ($1,$2)
        ON CONFLICT (incident_id, unit_id) DO UPDATE SET released_at=NULL, assigned_at=now()`, [incident.id, unitId]);
      await setStatus(c, unit, 3, `Einsatz ${incident.number}`, userId, incident.id);
    }
  }

  app.get('/incidents/:id', authz('dispatch:read'), async (req) => {
    const { incident, level } = await loadIncident(req, LEVEL.READ);
    const [units, entries] = await Promise.all([
      many('SELECT iu.*, u.callsign, u.status FROM incident_units iu JOIN dispatch_units u ON u.id=iu.unit_id WHERE iu.incident_id=$1 ORDER BY iu.assigned_at', [incident.id]),
      many(`SELECT l.*, u.callsign, cu.name created_by_name FROM dispatch_log l LEFT JOIN dispatch_units u ON u.id=l.unit_id LEFT JOIN users cu ON cu.id=l.created_by
        WHERE l.incident_id=$1 ORDER BY l.created_at`, [incident.id]),
    ]);
    const file = incident.case_file_id ? await one('SELECT id, file_number, title FROM case_files WHERE id=$1 AND case_file_level(id, $2) >= 2', [incident.case_file_id, req.user.id]) : null;
    return { ...incident, level, units, entries, case_file: file };
  });

  app.post('/incidents', authz('dispatch:create'), async (req) => {
    const b = incidentFields.extend({ team_id: uuid, unit_ids: z.array(uuid).max(30).default([]) }).parse(req.body);
    await teamFor(req, b.team_id, 'dispatch', LEVEL.WRITE);
    const incident = await tx(async (c) => {
      const row = (await c.query(
        `INSERT INTO incidents(team_id, number, title, kind, priority, location, description, created_by)
         VALUES ($1, 'E-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('incident_seq')::text, 4, '0'), $2,$3,$4,$5,$6,$7) RETURNING *`,
        [b.team_id, b.title, b.kind, b.priority, b.location, b.description, req.user.id])).rows[0];
      await log(c, b.team_id, { incident_id: row.id, kind: 'incident', text: `Einsatz angelegt: ${b.title}${b.location ? ` – ${b.location}` : ''}` }, req.user.id);
      await assignUnits(c, row, b.unit_ids, req.user.id);
      return row;
    });
    discord(b.team_id, 'incident', { title: `Einsatz ${incident.number}: ${b.title}`, description: b.description.slice(0, 500), path: 'dispatch', fields: [{ name: 'Ort', value: b.location }, { name: 'Priorität', value: PRIORITY[b.priority] }] }, req.log);
    await audit(req, 'incident.created', 'incident', incident.id, { number: incident.number });
    return { id: incident.id, number: incident.number };
  });

  app.patch('/incidents/:id', authz('dispatch:update'), async (req) => {
    const { incident } = await loadIncident(req, LEVEL.WRITE);
    const b = { ...incident, ...patchSchema(incidentFields).parse(req.body) };
    await q('UPDATE incidents SET title=$2, kind=$3, priority=$4, location=$5, description=$6 WHERE id=$1', [incident.id, b.title, b.kind, b.priority, b.location, b.description]);
    return { ok: true };
  });

  app.post('/incidents/:id/units', authz('dispatch:update'), async (req) => {
    const { incident } = await loadIncident(req, LEVEL.WRITE);
    if (incident.status !== 'active') throw bad('Der Einsatz ist abgeschlossen');
    const { unit_ids: unitIds } = z.object({ unit_ids: z.array(uuid).min(1).max(30) }).parse(req.body);
    await tx((c) => assignUnits(c, incident, unitIds, req.user.id));
    return { ok: true };
  });
  // Einheit aus dem Einsatz lösen: Status 1 (frei über Funk)
  app.delete('/incidents/:id/units/:unitId', authz('dispatch:update'), async (req) => {
    const { incident } = await loadIncident(req, LEVEL.WRITE);
    const unit = await one('SELECT u.* FROM dispatch_units u JOIN incident_units iu ON iu.unit_id=u.id WHERE iu.incident_id=$1 AND u.id=$2 AND iu.released_at IS NULL', [incident.id, uuid.parse(req.params.unitId)]);
    if (!unit) throw notFound('Einheit nicht im Einsatz');
    await tx(async (c) => {
      await c.query('UPDATE incident_units SET released_at=now() WHERE incident_id=$1 AND unit_id=$2', [incident.id, unit.id]);
      await setStatus(c, unit, 1, `frei von ${incident.number}`, req.user.id, incident.id);
    });
    return { ok: true };
  });

  app.post('/incidents/:id/close', authz('dispatch:update'), async (req) => {
    const { incident } = await loadIncident(req, LEVEL.WRITE);
    if (incident.status !== 'active') throw bad('Der Einsatz ist schon abgeschlossen');
    const { note } = z.object({ note: z.string().trim().max(2000).default('') }).parse(req.body);
    await tx(async (c) => {
      const open = (await c.query('SELECT u.* FROM dispatch_units u JOIN incident_units iu ON iu.unit_id=u.id WHERE iu.incident_id=$1 AND iu.released_at IS NULL', [incident.id])).rows;
      await c.query('UPDATE incident_units SET released_at=now() WHERE incident_id=$1 AND released_at IS NULL', [incident.id]);
      for (const unit of open) await setStatus(c, unit, 1, `frei von ${incident.number}`, req.user.id, incident.id);
      await c.query("UPDATE incidents SET status='closed', closed_at=now(), closed_by=$2, close_note=$3 WHERE id=$1", [incident.id, req.user.id, note]);
      await log(c, incident.team_id, { incident_id: incident.id, kind: 'incident', text: `Einsatz abgeschlossen${note ? `: ${note}` : ''}` }, req.user.id);
    });
    discord(incident.team_id, 'incident', { title: `Einsatz ${incident.number} abgeschlossen`, description: note, path: 'dispatch' }, req.log);
    await audit(req, 'incident.closed', 'incident', incident.id, { number: incident.number });
    return { ok: true };
  });

  // In eine Fallakte übernehmen: Eintrag mit Verlauf in der gewählten Akte (Schreibrecht dort nötig), Verknüpfung am Einsatz
  app.post('/incidents/:id/case-file', authz('dispatch:update', 'casefile:update'), async (req) => {
    const { incident } = await loadIncident(req, LEVEL.WRITE);
    const { case_file_id: fileId } = z.object({ case_file_id: uuid }).parse(req.body);
    const { file } = await loadFile(req, fileId, LEVEL.WRITE);
    const [units, entries] = await Promise.all([
      many('SELECT u.callsign FROM incident_units iu JOIN dispatch_units u ON u.id=iu.unit_id WHERE iu.incident_id=$1 ORDER BY u.callsign', [incident.id]),
      many(`SELECT l.created_at, l.kind, l.status, l.text, u.callsign FROM dispatch_log l LEFT JOIN dispatch_units u ON u.id=l.unit_id
        WHERE l.incident_id=$1 ORDER BY l.created_at`, [incident.id]),
    ]);
    const esc = (s) => String(s ?? '').replace(/([\\`*_[\]|<>#])/g, '\\$1');
    const body = [
      `**Einsatz ${esc(incident.number)}: ${esc(incident.title)}**`, '',
      `Beginn: ${time(incident.started_at)}${incident.closed_at ? ` · Ende: ${time(incident.closed_at)}` : ''}${incident.location ? ` · Ort: ${esc(incident.location)}` : ''} · Priorität: ${PRIORITY[incident.priority]}`,
      units.length ? `Einheiten: ${units.map((u) => esc(u.callsign)).join(', ')}` : '',
      incident.description ? `\n${incident.description}` : '',
      entries.length ? '\n**Verlauf**\n' : '',
      ...entries.map((e) => `- ${time(e.created_at)}${e.callsign ? ` ${esc(e.callsign)}` : ''}: ${e.kind === 'status' ? `Status ${e.status} (${UNIT_STATUS[e.status]})${e.text ? ` – ${esc(e.text)}` : ''}` : esc(e.text)}`),
    ].filter((x) => x !== '').join('\n').slice(0, 20000);
    await tx(async (c) => {
      await c.query(`INSERT INTO case_file_entries(case_file_id, entry_date, kind, body, created_by, updated_by) VALUES ($1, (now() AT TIME ZONE $4)::date, 'Einsatz', $2, $3, $3)`,
        [file.id, body, req.user.id, config.tz]);
      await c.query('UPDATE case_files SET updated_at=now() WHERE id=$1', [file.id]);
      await c.query('UPDATE incidents SET case_file_id=$2 WHERE id=$1', [incident.id, file.id]);
    });
    await audit(req, 'incident.to_case_file', 'incident', incident.id, { case_file: file.id });
    return { ok: true, file_number: file.file_number };
  });

  app.delete('/incidents/:id', authz('dispatch:delete'), async (req) => {
    const { incident } = await loadIncident(req, LEVEL.MANAGE);
    if (incident.status === 'active') throw bad('Laufende Einsätze erst abschließen');
    await q('DELETE FROM incidents WHERE id=$1', [incident.id]);
    await audit(req, 'incident.deleted', 'incident', incident.id, { number: incident.number });
    return { ok: true };
  });
}
