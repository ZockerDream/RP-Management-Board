// Strafkatalog per CSV: lesen ohne Datenbank (unit-testbar). Zeilen mit einem schon vorhandenen Paragraphen
// aktualisieren ihn, neue legen ihn an. Beträge wie in Excel: 1.500,00 oder 1500,5 oder 1500.50.
import { parseCsv, csvUnguard, CsvError } from './csv.js';

export const MAX_CODES = 2000;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
const HEADERS = {
  code: ['paragraph', 'code', 'nr', 'nummer', 'tatbestandsnummer'], title: ['bezeichnung', 'titel', 'tatbestand', 'straftat', 'title'],
  category: ['kategorie', 'art', 'category'], fine: ['geldstrafe', 'bußgeld', 'bussgeld', 'strafe', 'fine', 'betrag'],
  jail: ['haft', 'hafteinheiten', 'he', 'haftzeit', 'jail'], points: ['punkte', 'points'], description: ['beschreibung', 'hinweis', 'description'],
};

// „1.500,00“ → 1500.00, „1500,5“ → 1500.5, „1500.50“ → 1500.50; null bei Unsinn
export function parseAmount(raw) {
  let s = String(raw).replace(/[€\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return /^\d{1,10}(\.\d{1,2})?$/.test(s) ? Number(s) : null;
}

export function readPenalCsv(text) {
  const { rows } = parseCsv(text);
  const header = rows.shift();
  if (!header || header.cells.every((c) => !c.trim())) throw new CsvError('Die Datei ist leer');
  const columns = {};
  header.cells.forEach((cell, i) => {
    const key = Object.keys(HEADERS).find((k) => HEADERS[k].includes(norm(cell)));
    if (key && !(key in columns)) columns[key] = i;
  });
  if (!('code' in columns) || !('title' in columns)) throw new CsvError('In der ersten Zeile fehlen die Spalten „Paragraph“ und „Bezeichnung“');
  const data = rows.filter((r) => r.cells.some((c) => c.trim()));
  if (data.length > MAX_CODES) throw new CsvError(`Höchstens ${MAX_CODES.toLocaleString('de-DE')} Einträge pro Datei`);
  const seen = new Set();
  const entries = [];
  const errors = [];
  for (const row of data) {
    const at = (key) => (key in columns ? csvUnguard((row.cells[columns[key]] ?? '').trim()) : '');
    const code = at('code');
    const title = at('title');
    const fine = parseAmount(at('fine'));
    const jail = at('jail') ? Number(at('jail').replace(/\s*(he|hafteinheiten|monate?|min)\.?$/i, '')) : 0;
    const points = at('points') ? Number(at('points')) : 0;
    const problem = !code || !title ? 'Paragraph und Bezeichnung sind Pflicht'
      : code.length > 40 || title.length > 200 ? 'Paragraph (40) oder Bezeichnung (200) zu lang'
        : fine === null ? `Geldstrafe „${at('fine').slice(0, 20)}“ ist kein Betrag`
          : !Number.isInteger(jail) || jail < 0 || jail > 100000 ? `Haft „${at('jail').slice(0, 20)}“ ist keine ganze Zahl`
            : !Number.isInteger(points) || points < 0 || points > 100 ? `Punkte „${at('points').slice(0, 20)}“ sind keine Zahl von 0 bis 100`
              : seen.has(code.toLowerCase()) ? 'Der Paragraph steht mehrfach in der Datei' : null;
    if (problem) { errors.push({ line: row.line, code, message: problem }); continue; }
    seen.add(code.toLowerCase());
    entries.push({ line: row.line, code, title, category: at('category').slice(0, 60), fine: fine.toFixed(2), jail, points, description: at('description').slice(0, 2000) });
  }
  return { entries, errors };
}
