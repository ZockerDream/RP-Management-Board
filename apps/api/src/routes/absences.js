// Abwesenheiten (Wunsch des Auftraggebers vom 2026-11-13): Urlaub, krank, inaktiv, sonstiges. Eigene meldet jedes
// Mitglied selbst; Funktion „absences“: 2 alle sehen, 3 für andere eintragen und ändern, 4 Fremdes löschen.
// Discord bekommt bei „krank“ nur „abwesend“ (Gesundheitsangaben gehören nicht in einen Chat).
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, forbidden } from '../authz.js';
import { LEVEL, isMember } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDate } from '../records.js';
import { patchSchema } from '../validation.js';
import { teamFor, loadTeamRow, notifyTeam, teamName } from '../orgfeature.js';
import { discord } from '../discord-send.js';
import { fdateDe } from '../lib-format.js';

export const ABSENCE_KINDS = { vacation: 'Urlaub', sick: 'Krank', inactive: 'Inaktiv', other: 'Sonstiges' };
const fields = z.object({
  kind: z.enum(['vacation', 'sick', 'inactive', 'other']),
  starts_on: isoDate,
  ends_on: isoDate,
  note: z.string().trim().max(1000).default(''),
});

export default async function routes(app) {
  app.get('/absences', authz('absence:read'), async (req) => {
    const f = z.object({ team_id: uuid, from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const level = await teamFor(req, f.team_id, 'absences', 0);
    const rows = await many(
      `SELECT a.*, u.name user_name, cu.name created_by_name FROM absences a JOIN users u ON u.id=a.user_id LEFT JOIN users cu ON cu.id=a.created_by
       WHERE a.team_id=$1 AND ($2::date IS NULL OR a.ends_on >= $2) AND ($3::date IS NULL OR a.starts_on <= $3)
         AND ($4 OR a.user_id=$5)
       ORDER BY a.starts_on DESC, u.name LIMIT 1000`,
      [f.team_id, f.from || null, f.to || null, level >= LEVEL.READ, req.user.id],
    );
    return { level, items: rows.map((a) => ({ ...a, can_edit: a.user_id === req.user.id || level >= LEVEL.WRITE, can_delete: a.user_id === req.user.id || level >= LEVEL.MANAGE })) };
  });

  app.post('/absences', authz('absence:create'), async (req) => {
    const b = fields.extend({ team_id: uuid, user_id: uuid.nullish() }).parse(req.body);
    if (b.ends_on < b.starts_on) throw bad('Das Ende liegt vor dem Beginn');
    const userId = b.user_id || req.user.id;
    await teamFor(req, b.team_id, 'absences', userId === req.user.id ? 0 : LEVEL.WRITE);
    if (!(await isMember(userId, b.team_id))) throw bad('Die Person ist kein Mitglied dieser Organisation');
    const row = await one(
      'INSERT INTO absences(team_id, user_id, kind, starts_on, ends_on, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [b.team_id, userId, b.kind, b.starts_on, b.ends_on, b.note, req.user.id],
    );
    const who = (await one('SELECT name FROM users WHERE id=$1', [userId])).name;
    const span = `${fdateDe(b.starts_on)} – ${fdateDe(b.ends_on)}`;
    await notifyTeam(b.team_id, 'absences', LEVEL.WRITE, 'absence', `${await teamName(b.team_id)}: ${who} abwesend`, `${ABSENCE_KINDS[b.kind]}, ${span}${b.note ? ` – ${b.note}` : ''}`, { except: req.user.id, dedupe: `absence:${row.id}`, log: req.log });
    discord(b.team_id, 'absence', { title: `${who} ist abwesend`, description: span, path: 'personnel?tab=absences', fields: [{ name: 'Art', value: b.kind === 'sick' ? 'Abwesend' : ABSENCE_KINDS[b.kind] }] }, req.log);
    await audit(req, 'absence.created', 'absence', row.id, { team: b.team_id, user: userId });
    return row;
  });

  app.patch('/absences/:id', authz('absence:update'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'absences', uuid.parse(req.params.id), 'absences', LEVEL.READ, 'user_id');
    if (row.user_id !== req.user.id && level < LEVEL.WRITE) throw forbidden('Fremde Abwesenheiten ändert nur, wer dafür „Lesen & Schreiben“ hat');
    const b = patchSchema(fields).parse(req.body);
    const next = { ...row, ...b };
    if (next.ends_on < next.starts_on) throw bad('Das Ende liegt vor dem Beginn');
    await q('UPDATE absences SET kind=$2, starts_on=$3, ends_on=$4, note=$5 WHERE id=$1', [row.id, next.kind, next.starts_on, next.ends_on, next.note]);
    await audit(req, 'absence.updated', 'absence', row.id, {});
    return { ok: true };
  });

  app.delete('/absences/:id', authz('absence:delete'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'absences', uuid.parse(req.params.id), 'absences', LEVEL.READ, 'user_id');
    if (row.user_id !== req.user.id && level < LEVEL.MANAGE) throw forbidden('Fremde Abwesenheiten löscht nur, wer Abwesenheiten verwaltet');
    await q('DELETE FROM absences WHERE id=$1', [row.id]);
    await audit(req, 'absence.deleted', 'absence', row.id, {});
    return { ok: true };
  });
}
