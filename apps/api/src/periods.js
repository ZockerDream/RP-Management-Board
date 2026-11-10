const DAY_MS = 86400000;
const parse = (value) => new Date(`${value}T00:00:00Z`);
const format = (date) => date.toISOString().slice(0, 10);

export function dateInZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Ein Zugang gilt bis einschließlich zu seinem Ablaufdatum
export const accessExpired = (expiresAt, today) => Boolean(expiresAt) && String(expiresAt).slice(0, 10) < today;

// Zeitfenster für den Cashflow nach Tagen oder Wochen. Das Ende ist der Ankertag bzw. der Beginn seiner Woche.
export function timelineWindow(granularity, anchor, periods, weekStart = 1) {
  const end = parse(anchor);
  if (Number.isNaN(end.getTime())) return null;
  const stepDays = granularity === 'week' ? 7 : 1;
  const count = periods ?? (granularity === 'week' ? 8 : 14);
  if (granularity === 'week') end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() - weekStart + 7) % 7));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (count - 1) * stepDays);
  return { start: format(start), end: format(end), stepDays };
}

// Wann ein ToDo erinnert: einen Tag vorher, am Fälligkeitstag und einmal, sobald es überfällig ist.
export function todoStage(due, today) {
  const days = Math.round((parse(due) - parse(today)) / DAY_MS);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days === 1 ? 'tomorrow' : null;
}

// Aus lib.js hierher verschoben, damit sie ohne Datenbank nutzbar sind (forecast.js); lib.js exportiert sie weiter
export function addInterval(dateStr, freq, interval = 1) {
  const d = parse(dateStr);
  const day = d.getUTCDate();
  if (freq === 'daily' || freq === 'custom') d.setUTCDate(day + interval);
  else if (freq === 'weekly') d.setUTCDate(day + 7 * interval);
  else {
    const months = freq === 'yearly' ? 12 * interval : interval;
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return format(d);
}

// n-te Wiederholung relativ zum Startdatum (verhindert Tagesdrift 31. → 28. → 28.)
export function nthOccurrence(start, freq, interval, n) {
  const d = parse(start);
  if (freq === 'daily' || freq === 'custom') d.setUTCDate(d.getUTCDate() + interval * n);
  else if (freq === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * interval * n);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (freq === 'yearly' ? 12 : 1) * interval * n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return format(d);
}
