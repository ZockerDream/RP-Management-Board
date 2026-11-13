// Rechnungen und Angebote: Rechenregeln ohne Datenbank (Unit-Test test/invoices.test.js). Gerechnet wird in Cent.
const toCents = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(s)) throw new Error(`Ungültiger Betrag: ${v}`);
  const [i, f = ''] = s.replace('-', '').split('.');
  const c = BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
  return s.startsWith('-') ? -c : c;
};
const fromCents = (c) => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
};
// Menge darf Dezimalen haben (z. B. 1,5 Stunden); Zeile = Menge × Preis, kaufmännisch auf Cent gerundet
export function lineTotal(qty, price) {
  const q = String(qty ?? '').trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(q) || Number(q) <= 0) throw new Error(`Ungültige Menge: ${qty}`);
  const [qi, qf = ''] = q.split('.');
  const qHundred = BigInt(qi) * 100n + BigInt((qf + '00').slice(0, 2));
  const raw = qHundred * toCents(price);
  const rounded = (raw >= 0n ? raw + 50n : raw - 50n) / 100n;
  return rounded;
}
// Positionen prüfen und Summe bilden; Ergebnis: Positionen mit Zeilensumme als String und Gesamtsumme
export function invoiceTotals(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Mindestens eine Position');
  let sum = 0n;
  const out = items.map((it) => {
    const line = lineTotal(it.qty, it.price);
    if (line < 0n) throw new Error('Negative Positionen sind nicht erlaubt');
    sum += line;
    return { text: String(it.text || '').trim().slice(0, 300), qty: String(it.qty).replace(',', '.'), price: fromCents(toCents(it.price)), line: fromCents(line) };
  });
  if (out.some((i) => !i.text)) throw new Error('Jede Position braucht eine Bezeichnung');
  return { items: out, total: fromCents(sum) };
}
// Kassenabschluss: Differenz = gezählt − erwartet
export const cashDifference = (counted, expected) => fromCents(toCents(counted) - toCents(expected));
export { toCents, fromCents };
