// Globale Personenliste: Schema, CSV-Export und CSV-Import. Ohne Datenbank testbar: readPeopleCsv liest die Datei,
// planPeopleImport entscheidet anhand der vorhandenen Personen, was angelegt, geändert oder übersprungen wird.
import { z } from 'zod';
import { patchSchema, validationMessage } from './validation.js';
import { parseCsv, csvUnguard, toCsv, CsvError } from './csv.js';

const str = (n) => z.string().trim().max(n);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Ungültiges Datum');
// Stammdaten sind wie die Person global; was ein Bereich über die Person führt, steht in ihrer Personenakte (person_files)
export const personSchema = z.object({
  name: z.string().trim().min(1).max(100), kind: z.enum(['employee', 'external', 'family']).default('employee'), function: str(100).default(''),
  phone: str(40).default(''), email: z.union([z.string().email(), z.literal('')]).default(''), active: z.boolean().default(true), note: z.string().max(2000).default(''),
  birth_date: isoDate.nullable().default(null), gender: str(30).default(''), address: str(300).default(''), nationality: str(60).default(''),
  height_cm: z.number().int().min(30).max(260).nullable().default(null), features: str(1000).default(''), aliases: str(300).default(''),
});
export const PERSON_FIELDS = ['name', 'kind', 'function', 'phone', 'email', 'active', 'note', 'birth_date', 'gender', 'address', 'nationality', 'height_cm', 'features', 'aliases'];
export const KIND_LABELS = { employee: 'Mitarbeiter', external: 'Extern', family: 'Familie' };
export const MAX_IMPORT_ROWS = 10000;
const MAX_PROBLEMS = 200;

// ---- Export: deutsche Überschriften und Werte, damit die Datei in Excel lesbar ist und unverändert wieder importiert werden kann
const COLUMNS = [['id', 'ID'], ['name', 'Name'], ['kind', 'Art'], ['function', 'Funktion'], ['phone', 'Telefon'], ['email', 'E-Mail'], ['active', 'Aktiv'], ['note', 'Notiz'],
  ['birth_date', 'Geburtsdatum'], ['gender', 'Geschlecht'], ['address', 'Adresse'], ['nationality', 'Staatsangehörigkeit'], ['height_cm', 'Größe'], ['features', 'Merkmale'], ['aliases', 'Alias']];
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
  birth_date: ['geburtsdatum', 'geboren', 'birthdate', 'birthday'], gender: ['geschlecht', 'gender'], address: ['adresse', 'anschrift', 'address'],
  nationality: ['staatsangehörigkeit', 'nationalität', 'nationality'], height_cm: ['größe', 'groesse', 'height', 'größecm'], features: ['merkmale', 'besonderemerkmale', 'features'],
  aliases: ['alias', 'aliase', 'aliasnamen', 'aliases'],
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
    } else if (key === 'birth_date') {
      // ISO wie im Export oder deutsch wie in Excel (31.12.1990)
      const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
      values.birth_date = !raw ? null : german ? `${german[3]}-${german[2].padStart(2, '0')}-${german[1].padStart(2, '0')}` : raw;
    } else if (key === 'height_cm') {
      const n = raw.replace(/\s*cm$/i, '');
      if (raw && !/^\d{2,3}$/.test(n)) return { id, name: at('name'), error: `Größe „${raw.slice(0, 20)}“ ist keine Zahl in Zentimetern` };
      values.height_cm = raw ? Number(n) : null;
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
