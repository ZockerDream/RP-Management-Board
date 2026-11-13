// Lager & Ausrüstung (Wunsch des Auftraggebers vom 2026-11-13): Stücke (Waffen, Funkgeräte, Westen …) mit
// Seriennummer, Ausgabe an Mitglieder mit Rückgabe, ähnlich wie Schlüssel. Eigene Ausrüstung sieht jedes Mitglied.
// Funktion „equipment“: 2 Lager sehen, 3 anlegen, ausgeben, zurücknehmen, 4 löschen.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound } from '../authz.js';
import { LEVEL, isMember } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDate } from '../records.js';
import { patchSchema } from '../validation.js';
import { notify } from '../lib.js';
import { teamFor, loadTeamRow, teamName } from '../orgfeature.js';

export const ITEM_STATUS = { available: 'Im Lager', issued: 'Ausgegeben', maintenance: 'In Wartung', lost: 'Verloren', retired: 'Ausgemustert' };
const itemFields = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).default(''),
  serial: z.string().trim().max(60).default(''),
  status: z.enum(['available', 'maintenance', 'lost', 'retired']).default('available'),
  note: z.string().max(2000).default(''),
});
const serialTaken = (e) => {
  if (e.code === '23505' && /equipment_items_serial/.test(e.constraint || '')) throw bad('Diese Seriennummer gibt es im Lager schon');
  throw e;
};

export default async function routes(app) {
  app.get('/equipment', authz('equipment:read'), async (req) => {
    const f = z.object({ team_id: uuid }).parse(req.query);
    const level = await teamFor(req, f.team_id, 'equipment', 0);
    const items = await many(
      `SELECT i.*, x.id issue_id, x.user_id holder_id, u.name holder_name, x.issued_at, x.due_on, x.note issue_note
       FROM equipment_items i LEFT JOIN equipment_issues x ON x.item_id=i.id AND x.returned_at IS NULL LEFT JOIN users u ON u.id=x.user_id
       WHERE i.team_id=$1 AND ($2 OR x.user_id=$3)
       ORDER BY lower(i.category), lower(i.name), i.serial LIMIT 3000`,
      [f.team_id, level >= LEVEL.READ, req.user.id],
    );
    return { level, items };
  });

  app.get('/equipment/:id/history', authz('equipment:read'), async (req) => {
    const { row } = await loadTeamRow(req, 'equipment_items', uuid.parse(req.params.id), 'equipment', LEVEL.READ);
    return many(
      `SELECT x.*, u.name user_name, ib.name issued_by_name, rb.name returned_by_name FROM equipment_issues x JOIN users u ON u.id=x.user_id
       LEFT JOIN users ib ON ib.id=x.issued_by LEFT JOIN users rb ON rb.id=x.returned_by WHERE x.item_id=$1 ORDER BY x.issued_at DESC`, [row.id]);
  });

  // Anlegen; mit count entstehen mehrere gleiche Stücke, Seriennummern fortlaufend (Präfix + Nummer)
  app.post('/equipment', authz('equipment:create'), async (req) => {
    const b = itemFields.extend({ team_id: uuid, count: z.number().int().min(1).max(200).default(1) }).parse(req.body);
    await teamFor(req, b.team_id, 'equipment', LEVEL.WRITE);
    const ids = await tx(async (c) => {
      const out = [];
      for (let i = 1; i <= b.count; i++) {
        const serial = b.count > 1 && b.serial ? `${b.serial}${String(i).padStart(String(b.count).length, '0')}` : b.serial;
        out.push((await c.query('INSERT INTO equipment_items(team_id, name, category, serial, status, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [b.team_id, b.name, b.category, serial, b.status, b.note, req.user.id])).rows[0].id);
      }
      return out;
    }).catch(serialTaken);
    await audit(req, 'equipment.created', 'team', b.team_id, { name: b.name, count: ids.length });
    return { ids };
  });

  app.patch('/equipment/:id', authz('equipment:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'equipment_items', uuid.parse(req.params.id), 'equipment', LEVEL.WRITE);
    const b = { ...row, ...patchSchema(itemFields).parse(req.body) };
    if (row.status === 'issued' && b.status !== 'issued' && req.body.status) throw bad('Erst zurücknehmen, dann den Zustand ändern');
    await q('UPDATE equipment_items SET name=$2, category=$3, serial=$4, status=$5, note=$6 WHERE id=$1', [row.id, b.name, b.category, b.serial, b.status, b.note]).catch(serialTaken);
    return { ok: true };
  });

  app.delete('/equipment/:id', authz('equipment:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'equipment_items', uuid.parse(req.params.id), 'equipment', LEVEL.MANAGE);
    if (row.status === 'issued') throw bad('Ausgegebene Ausrüstung erst zurücknehmen');
    await q('DELETE FROM equipment_items WHERE id=$1', [row.id]);
    await audit(req, 'equipment.deleted', 'equipment', row.id, { name: row.name, serial: row.serial });
    return { ok: true };
  });

  // Ausgabe an ein Mitglied; ein Stück ist höchstens einmal gleichzeitig ausgegeben (Index equipment_issues_open)
  app.post('/equipment/:id/issue', authz('equipment:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'equipment_items', uuid.parse(req.params.id), 'equipment', LEVEL.WRITE);
    const b = z.object({ user_id: uuid, due_on: isoDate.nullish(), note: z.string().trim().max(500).default('') }).parse(req.body);
    if (row.status !== 'available') throw bad(`Nicht im Lager (${ITEM_STATUS[row.status]})`);
    if (!(await isMember(b.user_id, row.team_id))) throw bad('Die Person ist kein Mitglied dieser Organisation');
    await tx(async (c) => {
      const upd = await c.query("UPDATE equipment_items SET status='issued' WHERE id=$1 AND status='available'", [row.id]);
      if (!upd.rowCount) throw bad('Gerade schon ausgegeben');
      await c.query('INSERT INTO equipment_issues(item_id, team_id, user_id, issued_by, due_on, note) VALUES ($1,$2,$3,$4,$5,$6)',
        [row.id, row.team_id, b.user_id, req.user.id, b.due_on || null, b.note]);
    });
    if (b.user_id !== req.user.id) await notify(b.user_id, 'equipment', `${await teamName(row.team_id)}: Ausrüstung erhalten`, `${row.name}${row.serial ? ` (${row.serial})` : ''}${b.due_on ? `, zurück bis ${b.due_on.split('-').reverse().join('.')}` : ''}`, undefined, req.log);
    await audit(req, 'equipment.issued', 'equipment', row.id, { user: b.user_id });
    return { ok: true };
  });

  app.post('/equipment/:id/return', authz('equipment:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'equipment_items', uuid.parse(req.params.id), 'equipment', LEVEL.WRITE);
    const b = z.object({ status: z.enum(['available', 'maintenance', 'lost']).default('available'), note: z.string().trim().max(500).default('') }).parse(req.body);
    const issue = await one('SELECT * FROM equipment_issues WHERE item_id=$1 AND returned_at IS NULL', [row.id]);
    if (!issue) throw notFound('Nicht ausgegeben');
    await tx(async (c) => {
      await c.query('UPDATE equipment_issues SET returned_at=now(), returned_by=$2, return_note=$3 WHERE id=$1', [issue.id, req.user.id, b.note]);
      await c.query('UPDATE equipment_items SET status=$2 WHERE id=$1', [row.id, b.status]);
    });
    await audit(req, b.status === 'lost' ? 'equipment.lost' : 'equipment.returned', 'equipment', row.id, { user: issue.user_id });
    return { ok: true };
  });
}
