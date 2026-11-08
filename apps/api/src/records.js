// Gemeinsame Regeln für Datensätze, die privat sind oder einem Team gehören (Akten, Schulungen, Lizenzen, Dokumentationen)
import { z } from 'zod';
import { one } from './db.js';
import { bad } from './authz.js';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Ungültiges Datum');
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');

// Sichtbar: eigener Datensatz oder Team, in dem die Person Mitglied ist
export const visibleSql = (alias, n = '$1') => `(${alias}.owner_user_id=${n} OR ${alias}.team_id IN (SELECT team_id FROM team_members WHERE user_id=${n}))`;
// Rolle in Listen, damit die Oberfläche Aktionen für Viewer ausblendet
export const roleSql = (alias, n = '$1') => `CASE WHEN ${alias}.owner_user_id=${n} THEN 'owner' ELSE (SELECT tm.team_role FROM team_members tm WHERE tm.team_id=${alias}.team_id AND tm.user_id=${n}) END`;

// Eine Person gehört zum selben Bereich wie der Datensatz: dasselbe Team oder privat bei derselben Person
export async function assertPersonInScope(personId, scope) {
  const person = await one('SELECT id, owner_user_id, team_id, active FROM people WHERE id=$1', [personId]);
  const same = person && (scope.team_id ? person.team_id === scope.team_id : person.owner_user_id === scope.owner_user_id);
  if (!same) throw bad(scope.team_id ? 'Person gehört nicht zu diesem Team' : 'Person ist nicht deine private Person');
  return person;
}

// Benutzer als Teilnehmer: im Team jedes Mitglied, privat nur die Person selbst
export async function assertUserInScope(userId, scope) {
  const ok = scope.team_id
    ? await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2', [scope.team_id, userId])
    : userId === scope.owner_user_id;
  if (!ok) throw bad(scope.team_id ? 'Benutzer ist nicht Mitglied dieses Teams' : 'Privat kann nur die eigene Teilnahme erfasst werden');
}

// Die Person, die ein Datensatz betrifft, sehen nur Benutzer mit Zugriff auf diese Person; sonst bleibt der Name leer
export const personJoin = (alias, column, n = '$1') => `LEFT JOIN people ${alias} ON ${alias}.id=${column} AND ${visibleSql(alias, n)}`;
