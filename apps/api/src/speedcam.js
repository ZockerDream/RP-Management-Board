// Blitzer: Regeln ohne Datenbank (Unit-Test test/speedcam.test.js)

// Vorwerfbare Überschreitung in km/h: gemessen minus Toleranz minus erlaubt, nie unter 0
export const overSpeed = ({ measured_kmh, tolerance_kmh, speed_limit }) => Math.max(0, Number(measured_kmh) - Number(tolerance_kmh || 0) - Number(speed_limit));

const two = (n) => String(n).padStart(2, '0');
// Zeitpunkt in der Zeitzone des Servers als „TT.MM.JJJJ HH:MM“ und als Datum JJJJ-MM-TT
export function localParts(iso, timeZone) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, text: `${p.day}.${p.month}.${p.year} ${two(p.hour)}:${p.minute}` };
}

const STATUS = { open: 'offen', paid: 'bezahlt', cancelled: 'storniert' };
const money = (v, currency) => Number(v).toLocaleString('de-DE', { style: 'currency', currency: currency || 'EUR' });
// Markdown-Zeichen in Freitext entschärfen, damit Kennzeichen oder Ortsnamen die Tabelle nicht zerlegen
const md = (s) => String(s ?? '').replace(/([\\`*_[\]|<>#])/g, '\\$1').replace(/\r?\n/g, ' ');

// Text des Eintrags in der Personenakte aus einer Blitzer-Rechnung
export function ticketEntryBody(t, { timeZone = 'Europe/Berlin', currency = 'EUR' } = {}) {
  const when = localParts(t.measured_at, timeZone).text;
  const rows = [
    ['Rechnung', t.number],
    ['Zeitpunkt', when],
    ['Standort', [t.camera_name, t.camera_location].filter(Boolean).join(', ')],
    ['Kennzeichen', t.plate],
    ['Gemessen', `${t.measured_kmh} km/h`],
    ['Erlaubt', `${t.speed_limit} km/h`],
    ['Toleranz', `${t.tolerance_kmh} km/h`],
    ['Überschreitung', `${overSpeed(t)} km/h`],
    ['Betrag', money(t.amount, currency)],
    ['Status', STATUS[t.status] || t.status],
  ];
  const lines = [
    `**Blitzer-Rechnung ${md(t.number)}**`,
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `|${k}|${md(v)}|`),
  ];
  if (t.note) lines.push('', md(t.note));
  return lines.join('\n');
}
