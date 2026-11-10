// Zinsen für Konten (Wunsch des Auftraggebers vom 2026-11-10, optional je Konto): Zinssatz in Prozent je Zeitraum
// (Tag, Woche Mo–So, Monat, Jahr). Gutgeschrieben wird am letzten Tag jedes abgeschlossenen Zeitraums, und zwar auf den
// durchschnittlichen Tagessaldo (Einnahmen minus Ausgaben, Sparziel-Einzahlungen bleiben wie beim Kontostand außen vor).
// Tage mit negativem Saldo zählen als 0, Tage vor dem Einschalten ebenso; gutgeschriebene Zinsen werden mitverzinst.
// Ohne Datenbank testbar (test/interest.test.js); gerechnet wird in ganzen Cent als BigInt, nie mit Float.
import { mondayOf, nextDate } from './payroll.js';

export const INTEREST_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];
export const PERIOD_TEXT = { daily: 'pro Tag', weekly: 'pro Woche', monthly: 'pro Monat', yearly: 'pro Jahr' };

const parse = (value) => new Date(`${value}T00:00:00Z`);
const format = (date) => date.toISOString().slice(0, 10);

// Zeitraum, in dem ein Tag liegt
export function interestPeriod(date, period) {
  const day = parse(date);
  const year = day.getUTCFullYear();
  if (period === 'daily') return { start: date, end: date };
  if (period === 'weekly') {
    const start = mondayOf(date);
    const end = parse(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start, end: format(end) };
  }
  if (period === 'monthly') {
    return { start: format(new Date(Date.UTC(year, day.getUTCMonth(), 1))), end: format(new Date(Date.UTC(year, day.getUTCMonth() + 1, 0))) };
  }
  if (period === 'yearly') return { start: `${year}-01-01`, end: `${year}-12-31` };
  throw new Error(`Unbekannter Zinszeitraum: ${period}`);
}

export const dayCount = (from, to) => Math.round((parse(to) - parse(from)) / 86400000) + 1;

// Betrag als String ("-12.5", "1234.56") in Cent; mehr als zwei Nachkommastellen werden kaufmännisch gerundet
export function toCents(value) {
  const text = String(value ?? '0').trim();
  const match = text.match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!match || (!match[2] && !match[3])) throw new Error(`Ungültiger Betrag: ${text}`);
  const digits = (match[3] || '').padEnd(3, '0');
  let cents = BigInt(match[2] || '0') * 100n + BigInt(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1n;
  return match[1] === '-' ? -cents : cents;
}

export function centsText(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// Zinssatz "1.5" in Zehntausendstel Prozent (15000n), höchstens vier Nachkommastellen
export function rateUnits(rate) {
  const match = String(rate).trim().match(/^(\d+)(?:\.(\d{0,4})\d*)?$/);
  if (!match) throw new Error(`Ungültiger Zinssatz: ${rate}`);
  return BigInt(match[1]) * 10000n + BigInt((match[2] || '').padEnd(4, '0'));
}

// Kaufmännisch gerundete Division für nicht negative Werte
const divRound = (numerator, denominator) => (2n * numerator + denominator) / (2n * denominator);

// Zinsen eines Zeitraums: Summe der Tagessalden (Cent) × Satz / Tage des ganzen Zeitraums
export function interestFor(balanceSum, rate, periodDays) {
  if (balanceSum <= 0n) return 0n;
  return divRound(balanceSum * rateUnits(rate), 1000000n * BigInt(periodDays));
}

/**
 * Plant alle fälligen Gutschriften eines Kontos.
 * since: erster Tag mit Zinsen; coveredUntil: Ende des zuletzt gutgeschriebenen Zeitraums (oder null);
 * lastDate: letzter abgeschlossener Tag (gestern); openingBalance: Saldo in Cent am Ende des Tages vor dem ersten offenen Tag;
 * deltas: Map Datum → Saldoänderung in Cent für die offenen Tage. Gebucht wird nur, was bis lastDate vollständig vorbei ist.
 */
export function planInterest({ since, coveredUntil = null, lastDate, period, rate, openingBalance = 0n, deltas = new Map(), maxPeriods = 4000 }) {
  let from = coveredUntil && coveredUntil >= since ? nextDate(coveredUntil) : since;
  let balance = openingBalance;
  const plan = [];
  while (plan.length < maxPeriods) {
    const range = interestPeriod(from, period);
    if (range.end > lastDate) break;
    let sum = 0n;
    for (let day = from; day <= range.end; day = nextDate(day)) {
      balance += deltas.get(day) || 0n;
      if (balance > 0n) sum += balance;
    }
    const days = dayCount(range.start, range.end);
    const amount = interestFor(sum, rate, days);
    plan.push({ period_start: from, period_end: range.end, days, average: sum > 0n ? divRound(sum, BigInt(days)) : 0n, amount });
    // Gebucht am letzten Tag des Zeitraums: zählt ab dem nächsten Zeitraum mit
    balance += amount;
    from = nextDate(range.end);
  }
  return plan;
}

// Nächste Gutschrift (Ende des laufenden Zeitraums) für die Anzeige
export const nextInterestDate = (today, since, period) => interestPeriod(since > today ? since : today, period).end;

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const german = (date) => date.split('-').reverse().join('.');
export function interestTitle({ period_start: start, period_end: end }, period) {
  if (period === 'daily') return `Zinsen ${german(end)}`;
  if (period === 'monthly') return `Zinsen ${MONTHS[Number(end.slice(5, 7)) - 1]} ${end.slice(0, 4)}`;
  if (period === 'yearly') return `Zinsen ${end.slice(0, 4)}`;
  return `Zinsen ${german(start).slice(0, 6)}–${german(end)}`;
}
