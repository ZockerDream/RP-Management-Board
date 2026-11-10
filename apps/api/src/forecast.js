// Prognose für Einnahmen und Ausgaben dieser und nächster Woche (Wunsch des Auftraggebers vom 2026-11-10, Basis
// „Geplantes + Erfahrungswert“). Je Woche zählen:
//   gebucht      Buchungen bis heute (wie der Kontostand)
//   geplant      Buchungen mit Datum nach heute (vorausdatiert)
//   Daueraufträge  noch nicht gebuchte Ausführungen in der Woche
//   Festgehalt   Tage ohne Gehaltsbuchung ab Beginn der Gehaltsbuchung (ohne Bonus)
//   Schätzung    Durchschnitt pro Tag der letzten (bis zu 8) Wochen ohne Daueraufträge und Festgehalt, mal die Tage
//                der Woche, die noch kommen (diese Woche: nach heute, nächste Woche: alle 7)
// Sparziel-Einzahlungen zählen wie beim Kontostand nicht. Ohne Datenbank testbar; gerechnet wird in Cent als BigInt.
import { nthOccurrence } from './periods.js';
import { toCents, centsText } from './interest.js';

export const HISTORY_WEEKS = 8;
const DAY_MS = 86400000;
const parse = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
const format = (date) => date.toISOString().slice(0, 10);
export const addDays = (value, days) => format(new Date(parse(value).getTime() + days * DAY_MS));
export const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / DAY_MS);

// Woche mit dem Wochenstart aus dem Profil: 1 = Montag, 0 = Sonntag
export function weekOf(date, weekStart = 1) {
  const day = parse(date);
  const start = addDays(date, -((day.getUTCDay() - weekStart + 7) % 7));
  return { start, end: addDays(start, 6) };
}

// Noch nicht gebuchte Ausführungen eines Dauerauftrags zwischen from und to (beide einschließlich).
// Gebucht ist alles vor next_run; der Job bucht höchstens bis heute.
export function ruleOccurrences(rule, from, to) {
  if (rule.active === false) return [];
  const start = String(rule.start_date).slice(0, 10);
  const next = String(rule.next_run).slice(0, 10);
  const end = rule.end_date ? String(rule.end_date).slice(0, 10) : null;
  const dates = [];
  for (let n = 0, d = start; d <= to && n < 5000; n++, d = nthOccurrence(start, rule.frequency, rule.interval || 1, n)) {
    if (end && d > end) break;
    if (d >= from && d >= next) dates.push(d);
  }
  return dates;
}

// Tage ohne Gehaltsbuchung, für die das Festgehalt noch kommt
export function salaryDays({ from, to, startDate, paidDates = new Set() }) {
  if (!startDate) return [];
  const days = [];
  for (let d = from > startDate ? from : String(startDate).slice(0, 10); d <= to; d = addDays(d, 1)) if (!paidDates.has(d)) days.push(d);
  return days;
}

// Wie viele der letzten Wochen als Erfahrung zählen: ab der Woche der ersten Buchung, höchstens HISTORY_WEEKS
export function historyWeeks(firstDate, currentWeekStart, weekStart = 1) {
  if (!firstDate) return 0;
  const first = weekOf(String(firstDate).slice(0, 10), weekStart).start;
  return Math.max(0, Math.min(HISTORY_WEEKS, Math.floor(daysBetween(first, currentWeekStart) / 7)));
}

const share = (sum, days, weeks) => {
  if (!weeks || !days || sum <= 0n) return 0n;
  const divisor = BigInt(weeks * 7);
  return (sum * BigInt(days) * 2n + divisor) / (2n * divisor); // kaufmännisch gerundet
};

// transactions: [{ date, type: 'income'|'expense', amount }] der beiden Wochen (andere Typen werden ignoriert)
// recurring:    [{ date, type, amount }] noch offene Ausführungen
// salary:       [{ date, amount }] noch offenes Festgehalt
// history:      { weeks, income, expense } Summen der Erfahrungswochen ohne Daueraufträge und Festgehalt
export function planForecast({ today, weekStart = 1, transactions = [], recurring = [], salary = [], history = { weeks: 0, income: '0', expense: '0' } }) {
  const current = weekOf(today, weekStart);
  const next = weekOf(addDays(current.end, 1), weekStart);
  const historyIncome = toCents(history.income);
  const historyExpense = toCents(history.expense);
  return [current, next].map((week, index) => {
    const inWeek = (date) => date >= week.start && date <= week.end;
    const parts = { income: {}, expense: {} };
    for (const type of ['income', 'expense']) {
      const sum = (list, test = () => true) => list.filter((x) => x.type === type && inWeek(String(x.date).slice(0, 10)) && test(String(x.date).slice(0, 10)))
        .reduce((total, x) => total + toCents(x.amount), 0n);
      parts[type] = {
        booked: sum(transactions, (date) => date <= today),
        planned: sum(transactions, (date) => date > today),
        recurring: sum(recurring),
        salary: type === 'income' ? salary.filter((x) => inWeek(String(x.date).slice(0, 10))).reduce((total, x) => total + toCents(x.amount), 0n) : 0n,
      };
    }
    // Tage, für die noch geschätzt wird: diese Woche die nach heute, nächste Woche alle
    const remaining = index === 0 ? Math.max(0, daysBetween(today, week.end)) : 7;
    parts.income.estimate = share(historyIncome, remaining, history.weeks);
    parts.expense.estimate = share(historyExpense, remaining, history.weeks);
    const total = (p) => p.booked + p.planned + p.recurring + p.salary + p.estimate;
    const text = (p) => Object.fromEntries([...Object.entries(p).map(([k, v]) => [k, centsText(v)]), ['total', centsText(total(p))]]);
    return {
      start: week.start, end: week.end, estimate_days: remaining,
      income: text(parts.income), expense: text(parts.expense), balance: centsText(total(parts.income) - total(parts.expense)),
    };
  });
}
