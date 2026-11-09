// Globale Personenliste: Schema, CSV-Export und CSV-Import. Ohne Datenbank testbar: readPeopleCsv liest die Datei,
// planPeopleImport entscheidet anhand der vorhandenen Personen, was angelegt, geändert oder übersprungen wird.
import { z } from 'zod';
import { patchSchema, validationMessage } from './validation.js';
import { parseCsv, csvUnguard, toCsv, CsvError } from './csv.js';

const str = (n) => z.string().max(n);
export const personSchema = z.object({
  name: z.string().trim().min(1).max(100), kind: z.enum(['employee', 'external', 'family']).default('employee'), function: str(100).default(''),
  phone: str(40).default(''), email: z.union([z.string().email(), z.literal('')]).default(''), active: z.boolean().default(true), note: str(2000).default(''),
});
export const PERSON_FIELDS = ['name', 'kind', 'function', 'phone', 'email', 'active', 'note'];
export const KIND_LABELS = { employee: 'Mitarbeiter', external: 'Extern', family: 'Familie' };
export const MAX_IMPORT_ROWS = 10000;
const MAX_PROBLEMS = 200;

// ---- Export: deutsche Überschriften und Werte, damit die Datei in Excel lesbar ist und unverändert wieder importiert werden kann
const COLUMNS = [['id', 'ID'], ['name', 'Name'], ['kind', 'Art'], ['function', 'Funktion'], ['phone', 'Telefon'], ['email', 'E-Mail'], ['active', 'Aktiv'], ['note', 'Notiz']];
export function peopleCsv(people) {
  const rows = people.map((p) => Object.fromEntries(COLUMNS.map(([key, label]) => [label,
    key === 'kind' ? KIND_LABELS[p.kind] || p.kind : key === 'active' ? (p.active ? 'ja' : 'nein') : p[key]])));
  return toCsv(rows, COLUMNS.map(([, label]) => label));
}

// ---- Import
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
// Erkannte Überschriften je Feld (normalisiert: klein, ohne Leer- und Sonderzeichen)
const HEADERS = {
  id: ['id'], name: ['name'], kind: ['art', 'kind', 'typ'], function: ['funktion', 'function'], phone: ['telefon', 'phone', 'tel'],
  email: ['email', 'mail'], active: ['aktiv', 'active'], note: ['notiz', 'note', 'notizen', 'bemerkung'],
};
const KINDS = { mitarbeiter: 'employee', mitarbeiterin: 'employee', employee: 'employee', extern: 'external', externe: 'external', external: 'external', familie: 'family', family: 'family' };
const YES = new Set(['ja', 'j', 'yes', 'y', 'true', 'wahr', '1', 'x', 'aktiv', 'active']);
const NO = new Set(['nein', 'n', 'no', 'false', 'falsch', '0', 'inaktiv', 'inactive']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Eine Zeile in Feldwerte übersetzen. Leere Zellen bei Art und Aktiv heißen „Standard bzw. unverändert“,
// leere Textzellen leeren das Feld. Spalten, die in der Datei fehlen, bleiben bei vorhandenen Personen unverändert.
function readRow(cells, columns) {
  const values = {};
  const at = (key) => csvUnguard((cells[columns[key]] ?? '').trim());
  const id = 'id' in columns ? at('id') : '';
  if (id && !UUID.test(id)) return { id, error: `ID „${id.slice(0, 40)}“ ist ungültig` };
  for (const key of PERSON_FIELDS) {
    if (!(key in columns)) continue;
    const raw = at(key);
    if (key === 'kind') {
      if (!raw) continue;
      if (!KINDS[norm(raw)]) return { id, name: at('name'), error: `Art „${raw.slice(0, 40)}“ ist unbekannt (Mitarbeiter, Extern oder Familie)` };
      values.kind = KINDS[norm(raw)];
    } else if (key === 'active') {
      if (!raw) continue;
      const v = raw.toLowerCase();
      if (!YES.has(v) && !NO.has(v)) return { id, name: at('name'), error: `Aktiv „${raw.slice(0, 40)}“ ist weder ja noch nein` };
      values.active = YES.has(v);
    } else values[key] = raw;
  }
  return { id: id.toLowerCase(), name: values.name, values };
}

export function readPeopleCsv(text) {
  const { rows } = parseCsv(text);
  const header = rows.shift();
  if (!header || header.cells.every((c) => !c.trim())) throw new CsvError('Die Datei ist leer');
  const columns = {};
  const ignored = [];
  header.cells.forEach((cell, i) => {
    const key = Object.keys(HEADERS).find((k) => HEADERS[k].includes(norm(cell)));
    if (key && !(key in columns)) columns[key] = i;
    else if (cell.trim()) ignored.push(cell.trim());
  });
  if (!('name' in columns)) throw new CsvError('In der ersten Zeile fehlt die Spalte „Name“');
  const data = rows.filter((r) => r.cells.some((c) => c.trim()));
  if (data.length > MAX_IMPORT_ROWS) throw new CsvError(`Höchstens ${MAX_IMPORT_ROWS.toLocaleString('de-DE')} Personen pro Datei`);
  return { columns: Object.keys(columns), ignored, rows: data.map((r) => ({ line: r.line, ...readRow(r.cells, columns) })) };
}

const nameKey = (name) => name.trim().toLowerCase();

// existing: alle Personen mit id und PERSON_FIELDS. Ohne Recht zum Ändern (canUpdate) werden geänderte Zeilen mit ID abgelehnt.
export function planPeopleImport(rows, existing, { canUpdate }) {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const names = new Set(existing.map((p) => nameKey(p.name)));
  const seenIds = new Set();
  const seenNames = new Set();
  const plan = { create: [], update: [], unchanged: 0, skipped: 0, errors: 0, problems: [] };
  const problem = (row, kind, message) => {
    plan[kind === 'error' ? 'errors' : 'skipped']++;
    if (plan.problems.length < MAX_PROBLEMS) plan.problems.push({ line: row.line, name: row.name || '', kind, message });
  };
  for (const row of rows) {
    if (row.error) { problem(row, 'error', row.error); continue; }
    if (row.id) {
      const before = byId.get(row.id);
      if (!before) { problem(row, 'error', 'Keine Person mit dieser ID – für neue Personen die ID leer lassen'); continue; }
      if (seenIds.has(row.id)) { problem(row, 'error', 'Die ID steht mehrfach in der Datei'); continue; }
      seenIds.add(row.id);
      const parsed = patchSchema(personSchema).safeParse(row.values);
      if (!parsed.success) { problem(row, 'error', validationMessage(parsed.error.issues)); continue; }
      const changes = Object.fromEntries(Object.entries(parsed.data).filter(([key, value]) => before[key] !== value));
      if (!Object.keys(changes).length) { plan.unchanged++; continue; }
      if (!canUpdate) { problem(row, 'error', 'Vorhandene Personen ändern darfst du nicht'); continue; }
      plan.update.push({ line: row.line, id: row.id, changes });
    } else {
      const parsed = personSchema.safeParse(row.values);
      if (!parsed.success) { problem(row, 'error', validationMessage(parsed.error.issues)); continue; }
      const key = nameKey(parsed.data.name);
      if (names.has(key)) { problem(row, 'skipped', 'Eine Person mit diesem Namen gibt es schon'); continue; }
      if (seenNames.has(key)) { problem(row, 'skipped', 'Der Name steht mehrfach in der Datei'); continue; }
      seenNames.add(key);
      plan.create.push({ line: row.line, ...parsed.data });
    }
  }
  return plan;
}
