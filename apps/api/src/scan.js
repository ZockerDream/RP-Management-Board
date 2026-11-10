// Screenshot-Scanning für Ein- und Ausgaben (Wunsch des Auftraggebers vom 2026-11-10, Texterkennung lokal mit
// Tesseract): macht aus dem erkannten Text Buchungsvorschläge. Gebucht wird erst, wenn der Benutzer sie geprüft hat.
// Ohne Datenbank testbar (test/scan.test.js). Beträge werden als Text in Cent umgerechnet, nie als Float.
import { toCents, centsText } from './interest.js';

const MAX_CENTS = 99999999999999n; // numeric(14, 2)
const MONTHS = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mär: 3, mar: 3, märz: 3, maerz: 3, march: 3, apr: 4, april: 4,
  mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

// Zeilen mit Kontostand oder Summen sind keine Buchungen
const BALANCE = /\b(kontostand|saldo|guthaben|verfügbar|verfuegbar|balance|available|gesamt|total|summe|kreditrahmen|limit)\b/i;
const INCOME = /(\beingang|gutschrift|erhalten|empfangen|\bvon\b|\bfrom\b|received|receive|deposit|einzahlung|gehalt|\blohn|salary|paycheck|payday|income|einnahme|refund|erstattung|rückzahlung|zinsen|interest|verkauf|verkauft|\bsold\b|\bsale\b|bonus|prämie|praemie|cashback|incoming|credit\b)/i;
const EXPENSE = /(ausgabe|zahlung|bezahlt|gezahlt|\bpaid\b|payment|\bkauf\b|gekauft|einkauf|purchase|bought|abbuchung|lastschrift|withdraw|abhebung|abgehoben|\ban\b|\bto\b|\bsent\b|gesendet|überwiesen|transfer to|rechnung|\bbill\b|invoice|\bfine\b|strafe|bußgeld|bussgeld|miete|\brent\b|tank|fuel|gebühr|gebuehr|\bfee\b|reparatur|repair|steuer|\btax\b|versicherung|insurance|outgoing|debit\b)/i;

const pad = (n) => String(n).padStart(2, '0');
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
function validDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999)) return null;
  const value = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
}
// Ohne Jahr: dieses Jahr, liegt das Datum dann in der Zukunft, das letzte
const withYear = (y, m, d, today) => {
  if (y !== undefined) return validDate(y < 100 ? 2000 + y : y, m, d);
  const year = Number(today.slice(0, 4));
  const date = validDate(year, m, d);
  return date && date > addDays(today, 1) ? validDate(year - 1, m, d) : date;
};

// Datumsangaben in einer Zeile; liefert das erste gültige Datum und den Text ohne Datum und Uhrzeit. Ungültige Treffer
// (z. B. "12.50." als Betrag) bleiben im Text.
export function findDate(line, today) {
  let date = null;
  const take = (whole, value) => {
    if (!value) return whole;
    if (!date) date = value;
    return ' ';
  };
  let rest = line
    .replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (w, y, m, d) => take(w, validDate(Number(y), Number(m), Number(d))))
    .replace(/\b(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2})\b/g, (w, a, sep, b, y) => {
      // Mit Punkt deutsch (Tag zuerst). Mit Schrägstrich kann es auch amerikanisch sein (Monat zuerst): passt beides,
      // gilt das Datum, das am nächsten vor heute liegt – Umsatzlisten zeigen die letzten Buchungen.
      const year = Number(y);
      const dayFirst = withYear(year, Number(b), Number(a), today);
      const monthFirst = withYear(year, Number(a), Number(b), today);
      if (sep === '.' || !monthFirst) return take(w, dayFirst || (sep === '.' ? null : monthFirst));
      if (!dayFirst) return take(w, monthFirst);
      const distance = (date) => (date > today ? Infinity : Date.parse(today) - Date.parse(date));
      return take(w, distance(monthFirst) < distance(dayFirst) ? monthFirst : dayFirst);
    })
    .replace(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?\\b`, 'gi'), (w, d, mon, y) => take(w, withYear(y ? Number(y) : undefined, MONTHS[mon.toLowerCase()], Number(d), today)))
    .replace(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?\\b`, 'gi'), (w, mon, d, y) => take(w, withYear(y ? Number(y) : undefined, MONTHS[mon.toLowerCase()], Number(d), today)))
    .replace(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g, (w, d, m) => take(w, withYear(undefined, Number(m), Number(d), today)))
    .replace(/\bvorgestern\b/gi, (w) => take(w, addDays(today, -2)))
    .replace(/\b(gestern|yesterday)\b/gi, (w) => take(w, addDays(today, -1)))
    .replace(/\b(heute|today|jetzt|now)\b/gi, (w) => take(w, today));
  // Uhrzeiten (14:32, 14:32:10, 2:30 PM, 14.32 Uhr) sind keine Beträge
  rest = rest.replace(/\b\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:uhr|am|pm|h)\b/gi, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
  return { date, rest };
}

// "1.234,56", "1,234.56", "1 234", "12,5", "1.234" → Cent; drei Ziffern nach einem einzelnen Trenner sind Tausender
export function parseAmount(raw) {
  const text = raw.replace(/[\s   ']/g, '');
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let integer = text;
  let fraction = '';
  const split = (at) => { integer = text.slice(0, at); fraction = text.slice(at + 1); };
  if (lastDot >= 0 && lastComma >= 0) split(Math.max(lastDot, lastComma));
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const at = Math.max(lastDot, lastComma);
    if (text.split(sep).length === 2 && text.length - at - 1 <= 2) split(at);
  }
  // Tausendertrenner nur zwischen Dreiergruppen ("1.234.567", nicht "1.2.3")
  if (/[.,]/.test(integer) && !/^\d{1,3}([.,]\d{3})+$/.test(integer)) return null;
  integer = integer.replace(/[.,]/g, '');
  if (!/^\d+$/.test(integer) || !/^\d{0,2}$/.test(fraction)) return null;
  const cents = toCents(`${integer}.${fraction || '0'}`);
  return cents > 0n && cents <= MAX_CENTS ? cents : null;
}

// Geldbeträge in einer Zeile: mit Währung, Vorzeichen oder genau zwei Nachkommastellen. Bloße Zahlen wie Hausnummern
// oder Stückzahlen zählen nicht.
const MONEY = /([+-]\s*)?((?:[$€£]|\b(?:usd|eur|euro)\b)\s*)?([+-]\s*)?(\d{1,3}(?:[.,\s  ']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:[$€£]|\b(?:usd|eur|euro|dollar)\b))?/gi;
export function findAmounts(text) {
  const found = [];
  for (const m of text.matchAll(MONEY)) {
    const [whole, sign1, cur1, sign2, number, cur2] = m;
    const rawSign = sign2 || sign1 || '';
    const sign = rawSign.trim();
    const currency = Boolean(cur1 || cur2);
    const decimals = /[.,]\d{2}$/.test(number);
    // Prozente sind keine Beträge
    if (/^\s*%/.test(text.slice(m.index + whole.length))) continue;
    if (!currency && !decimals) {
      // Ganze Zahl ohne Währung nur mit Vorzeichen direkt davor ("-500", "+5000"), nicht "Route 68 - 500" oder "555-1234"
      const attached = sign && !/\s/.test(rawSign);
      const before = m.index === 0 ? '' : text[m.index - 1];
      if (!attached || (before && !/[\s(]/.test(before))) continue;
    }
    const cents = parseAmount(number);
    if (cents === null) continue;
    found.push({ cents, sign, index: m.index, length: whole.length, currency });
  }
  return found;
}

// Typische Lesefehler der Texterkennung in Beträgen: O statt 0, l/I statt 1, Leerzeichen nach dem Vorzeichen
function cleanLine(line) {
  return line
    .replace(/[−‒–—]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/([$€£]\s*[-+]?\s*)([\dOoIl.,\s]+)/g, (_, cur, digits) => cur + digits.replace(/[Oo]/g, '0').replace(/[Il]/g, '1'))
    .replace(/([\dOoIl.,]+)(\s*[$€£])/g, (whole, digits, cur) => (/\d/.test(digits) ? digits.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') + cur : whole));
}

const tidy = (text) => text
  .replace(/[|•·→←»«]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^[\s\-–:,.;*+#]+|[\s\-–:,;*+#]+$/g, '')
  .trim();
const letters = (text) => (text.match(/\p{L}/gu) || []).length;
// Überschriften der Bank-App sind keine Verwendungszwecke
const HEADER = /^(transaktionen|umsätze|umsaetze|verlauf|historie|history|transactions|recent|letzte buchungen|kontoauszug|banking|bank|konto|account|übersicht|overview|einnahmen|ausgaben|alle|all)$/i;

// Text der Texterkennung → Buchungsvorschläge. today ist das heutige Datum (YYYY-MM-DD) des Benutzers.
export function parseStatement(text, { today }) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).map((l) => l.trim()).filter(Boolean).slice(0, 500);
  const info = lines.map((line) => {
    const { date, rest } = findDate(line, today);
    const balance = BALANCE.test(rest);
    const amounts = balance ? [] : findAmounts(rest);
    let label = rest;
    for (const a of [...amounts].reverse()) label = `${label.slice(0, a.index)} ${label.slice(a.index + a.length)}`;
    label = tidy(label);
    return { line, date, amounts, balance, label: !balance && letters(label) >= 2 && !HEADER.test(label) ? label : '' };
  });
  const dateOnly = (row) => Boolean(row && row.date && !row.amounts.length && !row.label && !row.balance);
  // Layout erkennen: steht das Datum unter der Buchung ("Heute, 14:32") oder als Überschrift über einer Gruppe?
  let below = 0;
  let above = 0;
  info.forEach((row, i) => {
    if (!row.amounts.length || row.date) return;
    if (dateOnly(info[i + 1])) below++;
    if (dateOnly(info[i - 1])) above++;
  });
  const items = [];
  const usedLabel = new Set();
  let headerDate = null;
  info.forEach((row, i) => {
    if (dateOnly(row)) headerDate = row.date;
    if (!row.amounts.length) return;
    // Mehrere Beträge in einer Zeile: der letzte ist meist die Buchung (davor stehen Menge, Einzelpreis o. Ä.)
    const amount = row.amounts.at(-1);
    let title = row.label;
    let source = [row.line];
    let date = row.date;
    if (!title) {
      // Verwendungszweck in der Zeile davor (oder danach), solange sie selbst keinen Betrag hat
      const usable = (n) => info[n] && !info[n].amounts.length && !info[n].balance && info[n].label && !usedLabel.has(n);
      const n = usable(i - 1) ? i - 1 : usable(i + 1) ? i + 1 : null;
      if (n !== null) {
        title = info[n].label;
        usedLabel.add(n);
        date ||= info[n].date;
        source = n < i ? [info[n].line, row.line] : [row.line, info[n].line];
      }
    }
    if (!date) date = below > above && dateOnly(info[i + 1]) ? info[i + 1].date : headerDate;
    const words = `${title} ${row.line}`;
    let type = amount.sign === '+' ? 'income' : amount.sign === '-' ? 'expense' : null;
    if (!type && INCOME.test(words) && !EXPENSE.test(words)) type = 'income';
    else if (!type && EXPENSE.test(words) && !INCOME.test(words)) type = 'expense';
    items.push({
      title: title.slice(0, 200),
      amount: centsText(amount.cents),
      type: type || 'expense',
      booked_at: date && date <= today ? date : today,
      guessed: { type: !type, date: !date || date > today },
      text: source.join(' / ').slice(0, 300),
    });
  });
  return { items: items.slice(0, 100), lines: lines.length };
}
