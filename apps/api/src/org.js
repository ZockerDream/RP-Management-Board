// Organisationen (in Code und Datenbank "team"): Funktionen, Rechtestufen und die Prüfung für Datensätze.
// Die Stufe selbst rechnet die Datenbankfunktion team_level() aus (Migration 018), damit Listen und Einzelprüfungen
// dieselbe Regel nutzen.
import { one, many } from './db.js';
import { forbidden, notFound } from './authz.js';

export const LEVEL = { NONE: 0, PARTICIPATE: 1, READ: 2, WRITE: 3, MANAGE: 4 };
export const LEVEL_LABELS = ['Kein Zugriff', 'Teilnehmen', 'Lesen', 'Lesen & Schreiben', 'Verwalten'];

// Muss zu seed_team_ranks() in der neuesten Migration passen (zuletzt 019). Personen sind global und fehlen hier absichtlich.
// scope: Rechte zusätzlich pro Aktenart bzw. Doku-Kategorie
export const ORG_MODULES = [
  { key: 'members', label: 'Mitglieder & Ränge', levels: [0, 2, 3, 4], hints: { 2: 'Mitgliederliste sehen', 3: 'Mitglieder einladen, entfernen, Ränge und Gruppen zuweisen', 4: 'Ränge, Gruppen und Rechte verwalten' } },
  { key: 'budget', label: 'Konten & Buchungen', levels: [0, 2, 3, 4], hints: { 2: 'Konten und Buchungen sehen', 3: 'Buchen, Konten anlegen und ändern, Daueraufträge, Sparziele', 4: 'Konten löschen' } },
  { key: 'work', label: 'Stundenzettel', levels: [0, 1, 2, 3, 4], hints: { 1: 'Eigene Zeiten auf Projekte der Organisation buchen', 2: 'Zeiten aller Mitglieder sehen', 3: 'Zeiten und Gehalt der Mitglieder bearbeiten, Projekte anlegen', 4: 'Projekte löschen' } },
  { key: 'calendar', label: 'Kalender', levels: [0, 2, 3], hints: { 2: 'Termine sehen', 3: 'Termine anlegen, ändern, löschen' } },
  { key: 'notes', label: 'Notizblock', levels: [0, 2, 3], hints: { 2: 'Notizen lesen', 3: 'Notizen schreiben, ändern, löschen' } },
  { key: 'todos', label: 'ToDos', levels: [0, 2, 3], hints: { 2: 'ToDos sehen', 3: 'ToDos anlegen, abhaken, löschen' } },
  { key: 'sport', label: 'Sport', levels: [0, 2, 3], hints: { 2: 'Bestenliste sehen, eigene Ergebnisse eintragen', 3: 'Strecken verwalten, fremde Ergebnisse löschen' } },
  { key: 'vehicle', label: 'Fahrzeuge', levels: [0, 2, 3, 4], hints: { 2: 'Fahrzeuge sehen', 3: 'Fahrzeuge anlegen und ändern', 4: 'Fahrzeuge löschen' } },
  { key: 'property', label: 'Häuser', levels: [0, 2, 3, 4], hints: { 2: 'Häuser sehen, Tür-PIN nach Passwort', 3: 'Häuser und Tür-PINs anlegen und ändern', 4: 'Häuser löschen' } },
  { key: 'key', label: 'Schlüssel', levels: [0, 2, 3, 4], hints: { 2: 'Schlüssel sehen', 3: 'Schlüssel anlegen, ändern, ausgeben, zurücknehmen', 4: 'Schlüssel löschen' } },
  { key: 'casefile', label: 'Akten', scope: 'Aktenart', levels: [0, 2, 3, 4], hints: { 2: 'Akten lesen', 3: 'Akten anlegen, Einträge, Personen und Anhänge', 4: 'Akten löschen und beschränken, Aktenarten verwalten' } },
  { key: 'training', label: 'Schulungen', levels: [0, 1, 2, 3, 4], hints: { 1: 'Schulungen und Termine sehen, sich an- und abmelden', 2: 'Teilnehmer, Ergebnisse und Übersicht sehen', 3: 'Termine, Teilnehmer und Ergebnisse eintragen', 4: 'Schulungen anlegen, ändern, löschen' } },
  { key: 'license', label: 'Lizenzen', levels: [0, 2, 3, 4], hints: { 2: 'Lizenzen sehen', 3: 'Lizenzen ausstellen, ändern, verlängern, sperren', 4: 'Lizenzen löschen, Lizenzarten verwalten' } },
  { key: 'doc', label: 'Dokumentationen', scope: 'Kategorie', levels: [0, 2, 3, 4], hints: { 2: 'Seiten lesen', 3: 'Seiten schreiben und ändern', 4: 'Seiten löschen, Kategorien verwalten' } },
  { key: 'fleet', label: 'Fuhrpark', levels: [0, 2, 3, 4], hints: { 2: 'Fahrzeuge und Kontrollrunden sehen, Markdown', 3: 'Fahrzeuge und Gruppen pflegen, Runden erfassen und erledigt setzen', 4: 'Erledigte Runden ändern, löschen' } },
];
const MODULES = new Map(ORG_MODULES.map((m) => [m.key, m]));
export const MODULE_KEYS = ORG_MODULES.map((m) => m.key);

// Modulnamen landen im SQL-Text; nur bekannte zulassen
function moduleKey(key) {
  if (!MODULES.has(key)) throw new Error(`Unbekannte Funktion: ${key}`);
  return key;
}
export const moduleLabel = (key) => MODULES.get(key)?.label || key;
export const validLevel = (key, level) => MODULES.get(key)?.levels.includes(level) ?? false;
export const needMessage = (module, need) => `Dafür brauchst du in dieser Organisation bei „${moduleLabel(module)}“ mindestens „${LEVEL_LABELS[need]}“`;

// Stufe für einen Datensatz mit owner_user_id (privat) oder team_id (Organisation); privat hat der Besitzer alles
export const levelSql = (alias, module, n = '$1', scope = null) =>
  `(CASE WHEN ${alias}.owner_user_id=${n} THEN 4 WHEN ${alias}.team_id IS NULL THEN 0 ELSE team_level(${alias}.team_id, ${n}, '${moduleKey(module)}'${scope ? `, ${scope}` : ''}) END)`;
export const visibleSql = (alias, module, n = '$1', min = 2, scope = null) => `${levelSql(alias, module, n, scope)} >= ${min}`;
// Nur Organisationen, in denen die Person in der Funktion mindestens min hat (für team_id-Spalten ohne owner_user_id)
export const teamIdsSql = (module, n = '$1', min = 2) =>
  `(SELECT tm.team_id FROM team_members tm WHERE tm.user_id=${n} AND team_level(tm.team_id, tm.user_id, '${moduleKey(module)}') >= ${min})`;

export async function isMember(userId, teamId) {
  return !!teamId && !!(await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId]));
}

export async function teamLevel(userId, teamId, module, scopeId = null) {
  if (!teamId) return 0;
  return (await one('SELECT team_level($1,$2,$3,$4) AS level', [teamId, userId, moduleKey(module), scopeId])).level;
}

// Alle Stufen einer Person in einer Organisation, für die Oberfläche
export async function levelsFor(userId, teamId) {
  const rows = await many('SELECT m.key, team_level($1,$2,m.key) AS level FROM unnest($3::text[]) AS m(key)', [teamId, userId, MODULE_KEYS]);
  return Object.fromEntries(rows.map((r) => [r.key, r.level]));
}

// Prüft einen bestehenden Datensatz: unsichtbar → 404, sichtbar aber zu wenig Rechte → 403. Liefert die Stufe.
export async function recordLevel(userId, row, module, { need = LEVEL.READ, see = LEVEL.READ, scope = null } = {}) {
  if (!row) throw notFound();
  const level = row.owner_user_id ? (row.owner_user_id === userId ? LEVEL.MANAGE : 0) : await teamLevel(userId, row.team_id, module, scope);
  if (level < see) throw notFound();
  if (level < need) throw forbidden(needMessage(module, need));
  return level;
}

// Bereich eines neuen oder verschobenen Datensatzes: ohne Organisation gehört er der Person selbst
export async function recordOwner(userId, teamId, module, need = LEVEL.WRITE, scope = null) {
  if (!teamId) return { owner_user_id: userId, team_id: null };
  const level = await teamLevel(userId, teamId, module, scope);
  if (level < need) {
    if (!(await isMember(userId, teamId))) throw notFound('Organisation nicht gefunden');
    throw forbidden(needMessage(module, need));
  }
  return { owner_user_id: null, team_id: teamId };
}

// Mitglieder einer Organisation mit mindestens dieser Stufe, z. B. für Erinnerungen
export async function teamUsers(teamId, module, min = LEVEL.READ, scopeId = null) {
  const rows = await many(
    `SELECT tm.user_id FROM team_members tm JOIN users u ON u.id=tm.user_id AND u.status='active' AND u.deleted_at IS NULL
     WHERE tm.team_id=$1 AND team_level(tm.team_id, tm.user_id, $2, $4) >= $3`,
    [teamId, moduleKey(module), min, scopeId],
  );
  return rows.map((r) => r.user_id);
}
