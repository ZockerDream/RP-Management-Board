// Dienstplan: Regeln ohne Datenbank (Unit-Test test/shifts.test.js)

// Versatz der Zeitzone zu UTC in Minuten für einen Zeitpunkt
function offsetMinutes(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
// Ortszeit „JJJJ-MM-TT“ + „HH:MM“ in der Zone → ISO-Zeitpunkt (auch über die Zeitumstellung)
export function zonedIso(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - offsetMinutes(guess, timeZone) * 60000;
  ms = guess - offsetMinutes(ms, timeZone) * 60000;
  return new Date(ms).toISOString();
}
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Schicht aus Vorlage: endet sie vor oder zum Beginn (Nacht 22–06), liegt das Ende am Folgetag
export function shiftTimes(date, starts, ends, timeZone) {
  const s = starts.slice(0, 5);
  const e = ends.slice(0, 5);
  return { starts_at: zonedIso(date, s, timeZone), ends_at: zonedIso(e <= s ? addDays(date, 1) : date, e, timeZone) };
}
// Alle Tage von bis (höchstens 62)
export function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}
export const DEFAULT_TEMPLATES = [
  { name: 'Früh', starts: '06:00', ends: '14:00', slots: 2, color: 'ok', sort: 1 },
  { name: 'Spät', starts: '14:00', ends: '22:00', slots: 2, color: 'warn', sort: 2 },
  { name: 'Nacht', starts: '22:00', ends: '06:00', slots: 2, color: 'primary', sort: 3 },
];
// Belegte Plätze: eingeteilt und angeboten zählen, krank gibt den Platz frei
export const taken = (assignments) => assignments.filter((a) => a.status !== 'sick').length;
