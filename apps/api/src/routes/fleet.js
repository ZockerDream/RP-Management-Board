// Fuhrpark (Wunsch des Auftraggebers vom 2026-11-11): Fahrzeuge einer Organisation in Gruppen, Kontrollrunden mit
// „Erledigt“ und Markdown-Ausgabe. Unabhängig vom Objekt-Management. Rechte allein über die Funktion „fleet“:
// 2 sehen, 3 pflegen und Runden erfassen, 4 erledigte Runden ändern und löschen.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden, notFound } from '../authz.js';
import { LEVEL, recordLevel, teamIdsSql, teamLevel, isMember, needMessage } from '../org.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { uuid, isoDate } from '../records.js';
import { config } from '../config.js';
import { dateInZone } from '../periods.js';
import { fleetMarkdown } from '../fleet-markdown.js';
import { discord } from '../discord-send.js';
import { fdateDe } from '../lib-format.js';

const groupFields = z.object({
  name: z.string().trim().min(1).max(100),
  show_model: z.boolean().default(false),
  sort: z.number().int().min(-100000).max(100000).default(0),
});
const vehicleFields = z.object({
  group_id: uuid,
  plate: z.string().trim().min(1).max(20),
  model: z.string().trim().max(100).default(''),
  note: z.string().max(2000).default(''),
  sort: z.number().int().min(-100000).max(100000).default(0),
});
const itemFields = z.object({
  id: uuid,
  odometer_km: z.number().int().min(0).max(100000000).nullish(),
  last_service_on: isoDate.nullish(),
  first_aid_kit_until: isoDate.nullish(),
  accessories_complete: z.boolean().optional(),
  note: z.string().max(2000).optional(),
});
const checkPatch = z.object({
  checked_on: isoDate.optional(),
  done: z.boolean().optional(),
  items: z.array(itemFields).max(1000).optional(),
});

const PLATE_TAKEN = 'Dieses Kennzeichen gibt es in diesem Fuhrpark schon';
const plateTaken = (e) => {
  if (e.code === '23505' && /fleet_vehicles_team_plate/.test(e.constraint || '')) throw bad(PLATE_TAKEN);
  if (e.code === '23505' && /fleet_groups_team_name/.test(e.constraint || '')) throw bad('Diese Gruppe gibt es in diesem Fuhrpark schon');
  throw e;
};

// Neue Datensätze: Organisation muss sichtbar sein (sonst 404) und die Stufe reichen (sonst 403)
async function teamFor(req, teamId, need) {
  const level = await teamLevel(req.user.id, teamId, 'fleet');
  if (level < LEVEL.READ) {
    if (!(await isMember(req.user.id, teamId))) throw notFound('Organisation nicht gefunden');
    throw forbidden(needMessage('fleet', need));
  }
  if (level < need) throw forbidden(needMessage('fleet', need));
  return level;
}
async function load(req, table, id, need = LEVEL.READ) {
  const row = await one(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  const level = await recordLevel(req.user.id, row, 'fleet', { need });
  return { row, level };
}
const teamQuery = z.object({ team_id: uuid });

async function checkSections(checkId) {
  const items = await many(
    `SELECT * FROM fleet_check_items WHERE check_id=$1 ORDER BY group_sort, lower(group_name), vehicle_sort, lower(plate)`,
    [checkId],
  );
  const sections = [];
  for (const i of items) {
    let s = sections.at(-1);
    if (!s || s.name !== i.group_name) sections.push((s = { name: i.group_name, show_model: i.show_model, items: [] }));
    s.items.push(i);
  }
  return { items, sections };
}

export default async function routes(app) {
  app.get('/fleet/teams', authz('fleet:read'), async (req) => many(
    `SELECT t.id, t.name, team_level(t.id, $1, 'fleet') AS level FROM teams t
     WHERE t.id IN ${teamIdsSql('fleet')} ORDER BY t.name`,
    [req.user.id],
  ));

  // ---- Gruppen
  app.get('/fleet/groups', authz('fleet:read'), async (req) => {
    const { team_id } = teamQuery.parse(req.query);
    await teamFor(req, team_id, LEVEL.READ);
    return many(
      `SELECT g.*, (SELECT count(*)::int FROM fleet_vehicles v WHERE v.group_id=g.id AND v.active) vehicles
       FROM fleet_groups g WHERE g.team_id=$1 ORDER BY g.sort, lower(g.name)`,
      [team_id],
    );
  });
  app.post('/fleet/groups', authz('fleet:create'), async (req) => {
    const b = groupFields.extend({ team_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, LEVEL.WRITE);
    const row = await one('INSERT INTO fleet_groups(team_id,name,show_model,sort) VALUES ($1,$2,$3,$4) RETURNING id', [b.team_id, b.name, b.show_model, b.sort]).catch(plateTaken);
    await audit(req, 'fleet_group.created', 'fleet_group', row.id, { name: b.name });
    return row;
  });
  app.patch('/fleet/groups/:id', authz('fleet:update'), async (req) => {
    const { row: g } = await load(req, 'fleet_groups', req.params.id, LEVEL.WRITE);
    const b = patchSchema(groupFields).parse(req.body);
    await q('UPDATE fleet_groups SET name=$2, show_model=$3, sort=$4 WHERE id=$1', [g.id, b.name ?? g.name, b.show_model ?? g.show_model, b.sort ?? g.sort]).catch(plateTaken);
    await audit(req, 'fleet_group.updated', 'fleet_group', g.id);
    return { ok: true };
  });
  app.delete('/fleet/groups/:id', authz('fleet:delete'), async (req) => {
    const { row: g } = await load(req, 'fleet_groups', req.params.id, LEVEL.MANAGE);
    if (await one('SELECT 1 FROM fleet_vehicles WHERE group_id=$1 LIMIT 1', [g.id])) throw bad('Gruppe enthält noch Fahrzeuge');
    await q('DELETE FROM fleet_groups WHERE id=$1', [g.id]);
    await audit(req, 'fleet_group.deleted', 'fleet_group', g.id, { name: g.name });
    return { ok: true };
  });

  // ---- Fahrzeuge
  app.get('/fleet/vehicles', authz('fleet:read'), async (req) => {
    const { team_id, all } = teamQuery.extend({ all: z.string().optional() }).parse(req.query);
    await teamFor(req, team_id, LEVEL.READ);
    return many(
      `SELECT v.*, g.name group_name FROM fleet_vehicles v JOIN fleet_groups g ON g.id=v.group_id
       WHERE v.team_id=$1 ${all ? '' : 'AND v.active'} ORDER BY g.sort, lower(g.name), v.sort, lower(v.plate)`,
      [team_id],
    );
  });
  const assertGroup = async (groupId, teamId) => {
    if (!(await one('SELECT 1 FROM fleet_groups WHERE id=$1 AND team_id=$2', [groupId, teamId]))) throw bad('Gruppe nicht gefunden');
  };
  app.post('/fleet/vehicles', authz('fleet:create'), async (req) => {
    const b = vehicleFields.extend({ team_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, LEVEL.WRITE);
    await assertGroup(b.group_id, b.team_id);
    const row = await one(
      'INSERT INTO fleet_vehicles(team_id,group_id,plate,model,note,sort) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [b.team_id, b.group_id, b.plate, b.model, b.note, b.sort],
    ).catch(plateTaken);
    await audit(req, 'fleet_vehicle.created', 'fleet_vehicle', row.id, { plate: b.plate });
    return row;
  });
  app.patch('/fleet/vehicles/:id', authz('fleet:update'), async (req) => {
    const { row: v } = await load(req, 'fleet_vehicles', req.params.id, LEVEL.WRITE);
    const b = patchSchema(vehicleFields).extend({ active: z.boolean().optional() }).parse(req.body);
    if (b.group_id) await assertGroup(b.group_id, v.team_id);
    await q('UPDATE fleet_vehicles SET group_id=$2, plate=$3, model=$4, note=$5, sort=$6, active=$7 WHERE id=$1', [
      v.id, b.group_id ?? v.group_id, b.plate ?? v.plate, b.model ?? v.model, b.note ?? v.note, b.sort ?? v.sort, b.active ?? v.active,
    ]).catch(plateTaken);
    await audit(req, 'fleet_vehicle.updated', 'fleet_vehicle', v.id);
    return { ok: true };
  });
  app.put('/fleet/vehicles/order', authz('fleet:update'), async (req) => {
    const b = z.object({ team_id: uuid, ids: z.array(uuid).max(1000) }).parse(req.body);
    await teamFor(req, b.team_id, LEVEL.WRITE);
    await q('UPDATE fleet_vehicles v SET sort=o.ord FROM unnest($2::uuid[]) WITH ORDINALITY o(id, ord) WHERE v.id=o.id AND v.team_id=$1', [b.team_id, b.ids]);
    return { ok: true };
  });
  app.delete('/fleet/vehicles/:id', authz('fleet:delete'), async (req) => {
    const { row: v } = await load(req, 'fleet_vehicles', req.params.id, LEVEL.MANAGE);
    if (await one('SELECT 1 FROM fleet_check_items WHERE vehicle_id=$1 LIMIT 1', [v.id])) throw bad('Fahrzeug kommt in Kontrollrunden vor – bitte ausmustern');
    await q('DELETE FROM fleet_vehicles WHERE id=$1', [v.id]);
    await audit(req, 'fleet_vehicle.deleted', 'fleet_vehicle', v.id, { plate: v.plate });
    return { ok: true };
  });

  // ---- Kontrollrunden
  app.get('/fleet/checks', authz('fleet:read'), async (req) => {
    const { team_id } = teamQuery.parse(req.query);
    await teamFor(req, team_id, LEVEL.READ);
    return many(
      `SELECT c.id, c.checked_on, c.done, c.done_at, u.name done_by_name, (SELECT count(*)::int FROM fleet_check_items i WHERE i.check_id=c.id) items
       FROM fleet_checks c LEFT JOIN users u ON u.id=c.done_by WHERE c.team_id=$1 ORDER BY c.checked_on DESC, c.created_at DESC`,
      [team_id],
    );
  });
  app.post('/fleet/checks', authz('fleet:create'), async (req) => {
    const b = z.object({ team_id: uuid, checked_on: isoDate.optional() }).parse(req.body);
    await teamFor(req, b.team_id, LEVEL.WRITE);
    const id = await tx(async (c) => {
      const { rows: [row] } = await c.query(
        'INSERT INTO fleet_checks(team_id,checked_on,created_by) VALUES ($1,$2,$3) RETURNING id',
        [b.team_id, b.checked_on || dateInZone(config.tz), req.user.id],
      );
      // Werte der zuletzt angelegten Runde vorbelegen, Stammdaten vom heutigen Stand kopieren
      await c.query(
        `INSERT INTO fleet_check_items(check_id,vehicle_id,group_name,group_sort,show_model,plate,model,vehicle_sort,
           odometer_km,last_service_on,first_aid_kit_until,accessories_complete,note)
         SELECT $1, v.id, g.name, g.sort, g.show_model, v.plate, v.model, v.sort,
           p.odometer_km, p.last_service_on, p.first_aid_kit_until, COALESCE(p.accessories_complete, false), COALESCE(p.note, '')
         FROM fleet_vehicles v JOIN fleet_groups g ON g.id=v.group_id
         LEFT JOIN LATERAL (SELECT i.* FROM fleet_check_items i JOIN fleet_checks c ON c.id=i.check_id
           WHERE i.vehicle_id=v.id AND c.id<>$1 ORDER BY c.checked_on DESC, c.created_at DESC LIMIT 1) p ON true
         WHERE v.team_id=$2 AND v.active`,
        [row.id, b.team_id],
      );
      return row.id;
    });
    await audit(req, 'fleet_check.created', 'fleet_check', id);
    return { id };
  });
  app.get('/fleet/checks/:id', authz('fleet:read'), async (req) => {
    const { row, level } = await load(req, 'fleet_checks', req.params.id);
    const { items } = await checkSections(row.id);
    const by = row.done_by ? await one('SELECT name FROM users WHERE id=$1', [row.done_by]) : null;
    return { check: { ...row, done_by_name: by?.name ?? null, level }, items };
  });
  app.patch('/fleet/checks/:id', authz('fleet:update'), async (req) => {
    const { row: c, level } = await load(req, 'fleet_checks', req.params.id, LEVEL.WRITE);
    const b = checkPatch.parse(req.body);
    // Erledigte Runden und das Zurücknehmen von „Erledigt“ nur mit „Verwalten“
    if ((c.done || b.done === false) && level < LEVEL.MANAGE) throw forbidden(needMessage('fleet', LEVEL.MANAGE));
    await tx(async (client) => {
      for (const i of b.items || []) {
        const sets = [], vals = [i.id, c.id];
        for (const k of ['odometer_km', 'last_service_on', 'first_aid_kit_until', 'accessories_complete', 'note']) {
          if (k in i && i[k] !== undefined) { vals.push(i[k]); sets.push(`${k}=$${vals.length}`); }
        }
        if (!sets.length) continue;
        const r = await client.query(`UPDATE fleet_check_items SET ${sets.join(', ')} WHERE id=$1 AND check_id=$2`, vals);
        if (!r.rowCount) throw bad('Fahrzeug gehört nicht zu dieser Runde');
      }
      const done = b.done ?? c.done;
      await client.query(
        `UPDATE fleet_checks SET checked_on=$2, done=$3, done_at=CASE WHEN $3 THEN COALESCE(done_at, now()) END,
           done_by=CASE WHEN $3 THEN COALESCE(done_by, $4::uuid) END, updated_at=now() WHERE id=$1`,
        [c.id, b.checked_on ?? c.checked_on, done, req.user.id],
      );
    });
    if (c.done) await audit(req, 'fleet_check.updated_after_done', 'fleet_check', c.id, { done: b.done ?? true });
    else if (b.done) {
      await audit(req, 'fleet_check.done', 'fleet_check', c.id);
      discord(c.team_id, 'fleet', { title: `Fuhrpark-Runde vom ${fdateDe(b.checked_on ?? c.checked_on)} erledigt`, path: 'fleet', fields: [{ name: 'Von', value: req.user.name }] }, req.log);
    }
    return { ok: true };
  });
  app.delete('/fleet/checks/:id', authz('fleet:delete'), async (req) => {
    const { row: c } = await load(req, 'fleet_checks', req.params.id, LEVEL.MANAGE);
    await q('DELETE FROM fleet_checks WHERE id=$1', [c.id]);
    await audit(req, 'fleet_check.deleted', 'fleet_check', c.id, { checked_on: c.checked_on });
    return { ok: true };
  });
  app.get('/fleet/checks/:id/markdown', authz('fleet:read'), async (req, reply) => {
    const { row } = await load(req, 'fleet_checks', req.params.id);
    const { sections } = await checkSections(row.id);
    reply.type('text/markdown; charset=utf-8');
    return fleetMarkdown(row, sections);
  });
}
