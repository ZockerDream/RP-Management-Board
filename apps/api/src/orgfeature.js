// Gemeinsame Bausteine der Funktionen einer Organisation ab 2026-11-13 (Pinnwand, Dienstplan, Einsätze, Personal,
// Lager, Rechnungen, Kasse): Organisation prüfen, Datensatz laden, Mitglieder benachrichtigen, Liste der Organisationen.
import { one, many } from './db.js';
import { forbidden, notFound } from './authz.js';
import { LEVEL, teamLevel, isMember, needMessage, recordLevel, teamUsers, teamIdsSql } from './org.js';
import { notify } from './lib.js';

// Organisation für eine Aktion: nicht Mitglied → 404, Stufe zu klein → 403. Liefert die Stufe.
// need = 0: reine Mitgliedschaft genügt (z. B. eigene Abwesenheit melden)
export async function teamFor(req, teamId, module, need = LEVEL.READ) {
  if (!teamId || !(await isMember(req.user.id, teamId))) throw notFound('Organisation nicht gefunden');
  const level = await teamLevel(req.user.id, teamId, module);
  if (level < need) throw forbidden(needMessage(module, need));
  return level;
}

// Datensatz mit team_id laden; ohne Leserecht 404, sonst Stufe prüfen. own: Spalte, mit der Eigenes immer sichtbar ist
export async function loadTeamRow(req, table, id, module, need = LEVEL.READ, own = null) {
  const row = await one(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  if (!row) throw notFound();
  if (own && row[own] === req.user.id && need <= LEVEL.READ) {
    if (!(await isMember(req.user.id, row.team_id))) throw notFound();
    return { row, level: await teamLevel(req.user.id, row.team_id, module) };
  }
  const level = await recordLevel(req.user.id, { team_id: row.team_id }, module, { need });
  return { row, level };
}

// Organisationen, in denen die Person Mitglied ist, mit ihrer Stufe für die Funktion (auch 0, wenn Eigenes reicht)
export const teamsFor = (userId, module, min = LEVEL.READ) => many(
  `SELECT t.id, t.name, team_level(t.id, $1, $2) AS level FROM teams t
   WHERE t.id IN (SELECT team_id FROM team_members WHERE user_id=$1) AND team_level(t.id, $1, $2) >= $3 ORDER BY t.name`,
  [userId, module, min],
);
export { teamIdsSql };

// Mitglieder mit Stufe benachrichtigen, außer except
export async function notifyTeam(teamId, module, min, kind, title, body, { dedupe, except, log } = {}) {
  const users = await teamUsers(teamId, module, min);
  await Promise.all(users.filter((u) => u !== except).map((u) => notify(u, kind, title, body, dedupe ? `${dedupe}:${u}` : undefined, log)));
}

export const teamName = async (teamId) => (await one('SELECT name FROM teams WHERE id=$1', [teamId]))?.name || '';
