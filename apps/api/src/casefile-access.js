// Zugriff auf Akten und alles, was daran hängt (Berichte, Anklagepunkte, Beweismittel, Fahrzeuge, Fahndungen).
// Die Stufe einer Akte rechnet die Datenbankfunktion case_file_level() (Aktenart und Beschränkung, Migration 018);
// Strafkatalog, Vorlagen und Personenakten folgen dem Recht für Akten in ihrem Bereich (privat oder Organisation).
import { one } from './db.js';
import { bad, notFound, forbidden } from './authz.js';
import { LEVEL, needMessage, recordLevel, recordOwner } from './org.js';

export const fileLevelSql = (alias, n = '$1') => `case_file_level(${alias}.id, ${n})`;

// Unsichtbar → 404, sichtbar aber zu wenig Rechte → 403
export async function loadFile(req, id, need = LEVEL.READ) {
  const file = await one('SELECT c.*, case_file_level(c.id, $2) AS level FROM case_files c WHERE c.id=$1', [id, req.user.id]);
  if (!file || file.level < LEVEL.READ) throw notFound('Akte nicht gefunden');
  if (file.level < need) throw forbidden(needMessage('casefile', need));
  const { level, ...rest } = file;
  return { file: rest, level };
}

// Ein Datensatz, der über case_file_id an einer Akte hängt
export async function loadChild(req, table, id, need = LEVEL.READ) {
  const row = await one(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  if (!row) throw notFound();
  const { file, level } = await loadFile(req, row.case_file_id, need);
  return { row, file, level };
}

export async function assertInvolved(fileId, personId) {
  if (personId && !(await one('SELECT 1 FROM case_file_people WHERE case_file_id=$1 AND person_id=$2', [fileId, personId]))) {
    throw bad('Die Person ist an dieser Akte nicht beteiligt – zuerst unter „Beteiligte Personen“ hinzufügen');
  }
}

// Bereich (privat oder Organisation) aus dem Abfrage- oder Anfragewert team_id; ohne team_id der private Bereich
export async function area(req, teamId, need = LEVEL.READ) {
  if (!teamId) return { owner_user_id: req.user.id, team_id: null };
  return recordOwner(req.user.id, teamId, 'casefile', need);
}
// Bestehender Datensatz eines Bereichs (Strafkatalog, Vorlage, Personenakte)
export const areaRecord = (req, row, need = LEVEL.READ) => recordLevel(req.user.id, row, 'casefile', { need });
export const sameArea = (a, b) => (a.team_id ? a.team_id === b.team_id : !b.team_id && a.owner_user_id === b.owner_user_id);
