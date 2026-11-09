// CSV schreiben und lesen, ohne Datenbank (unit-testbar). Export: Semikolon, BOM für Excel, Schutz vor CSV-Injection.

export const csvEscape = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV-Injection verhindern
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows, cols) =>
  `﻿${[cols.join(';'), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(';'))].join('\r\n')}\r\n`;

// Gegenstück zu csvEscape: Das vorangestellte ' vor =, +, -, @ stammt aus dem Export und fällt beim Import wieder weg
export const csvUnguard = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

// Trennzeichen aus der Kopfzeile: das häufigste von ; , und Tab außerhalb von Anführungszeichen, sonst ;
function detectDelimiter(text) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ';';
}

export class CsvError extends Error {}

// Liest CSV wie Excel und LibreOffice sie schreiben: Felder in "…" mit verdoppelten "" und Zeilenumbrüchen,
// Zeilenende \r\n, \n oder \r. Liefert je Zeile die Zellen und die Zeilennummer in der Datei (für Fehlermeldungen).
export function parseCsv(input) {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;
  const endRow = () => {
    row.push(field);
    rows.push({ line: rowLine, cells: row });
    row = [];
    field = '';
    fieldStarted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
        field += c;
      }
    } else if (c === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      quoteLine = line;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (quoted) throw new CsvError(`Zeile ${quoteLine}: Ein Anführungszeichen wird nicht geschlossen`);
  if (field !== '' || row.length) endRow();
  return { delimiter, rows };
}
