import test from 'node:test';
import assert from 'node:assert/strict';
import { interestPeriod, toCents, centsText, rateUnits, interestFor, planInterest, nextInterestDate, interestTitle } from '../src/interest.js';

test('periods: day, Monday to Sunday, calendar month, calendar year', () => {
  assert.deepEqual(interestPeriod('2026-11-10', 'daily'), { start: '2026-11-10', end: '2026-11-10' });
  assert.deepEqual(interestPeriod('2026-11-10', 'weekly'), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(interestPeriod('2026-11-15', 'weekly'), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(interestPeriod('2028-02-10', 'monthly'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(interestPeriod('2026-11-10', 'yearly'), { start: '2026-01-01', end: '2026-12-31' });
  assert.throws(() => interestPeriod('2026-11-10', 'hourly'));
});

test('amounts become exact cents without floats', () => {
  assert.equal(toCents('1234.56'), 123456n);
  assert.equal(toCents('-0.05'), -5n);
  assert.equal(toCents('100'), 10000n);
  assert.equal(toCents('0.1'), 10n);
  assert.equal(toCents('2.345'), 235n);
  assert.equal(toCents('999999999999.99'), 99999999999999n);
  assert.throws(() => toCents('abc'));
  assert.equal(centsText(123456n), '1234.56');
  assert.equal(centsText(-5n), '-0.05');
  assert.equal(centsText(0n), '0.00');
  assert.equal(rateUnits('1.5'), 15000n);
  assert.equal(rateUnits('0.0125'), 125n);
  assert.equal(rateUnits('100.0000'), 1000000n);
});

test('interest of one period rounds half up on the cent', () => {
  // 1.000,00 × 30 Tage, 1,5 % pro Monat mit 30 Tagen = 15,00
  assert.equal(interestFor(100000n * 30n, '1.5', 30), 1500n);
  // 10,00 × 1 Tag, 0,05 % = 0,005 → 0,01
  assert.equal(interestFor(1000n, '0.05', 1), 1n);
  assert.equal(interestFor(1000n, '0.04', 1), 0n);
  assert.equal(interestFor(0n, '5', 1), 0n);
  assert.equal(interestFor(-500n, '5', 1), 0n);
});

test('monthly interest uses the average daily balance', () => {
  // November 2026 (30 Tage): 1.000 ab dem 1., ab dem 16. 2.000 → Durchschnitt 1.500, 2 % = 30,00
  const deltas = new Map([['2026-11-01', 100000n], ['2026-11-16', 100000n]]);
  const plan = planInterest({ since: '2026-11-01', lastDate: '2026-11-30', period: 'monthly', rate: '2', deltas });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], { period_start: '2026-11-01', period_end: '2026-11-30', days: 30, average: 150000n, amount: 3000n });
});

test('nothing is credited before the period is over', () => {
  assert.deepEqual(planInterest({ since: '2026-11-01', lastDate: '2026-11-29', period: 'monthly', rate: '2', openingBalance: 100000n }), []);
  assert.deepEqual(planInterest({ since: '2026-11-10', lastDate: '2026-11-09', period: 'daily', rate: '2', openingBalance: 100000n }), []);
});

test('the first period counts only from the day interest was switched on', () => {
  // Eingeschaltet am 16.11.: 15 von 30 Tagen mit 1.000 → Durchschnitt 500, 2 % = 10,00
  const plan = planInterest({ since: '2026-11-16', lastDate: '2026-11-30', period: 'monthly', rate: '2', openingBalance: 100000n });
  assert.deepEqual(plan.map((p) => [p.period_start, p.period_end, p.amount]), [['2026-11-16', '2026-11-30', 1000n]]);
});

test('negative days count as zero and credited interest compounds', () => {
  const daily = planInterest({ since: '2026-11-01', lastDate: '2026-11-03', period: 'daily', rate: '10', openingBalance: 100000n });
  // 1.000 → +100 → 1.100 → +110 → 1.210 → +121
  assert.deepEqual(daily.map((p) => p.amount), [10000n, 11000n, 12100n]);
  const negative = planInterest({ since: '2026-11-01', lastDate: '2026-11-02', period: 'daily', rate: '10', openingBalance: -100000n, deltas: new Map([['2026-11-02', 150000n]]) });
  assert.deepEqual(negative.map((p) => p.amount), [0n, 5000n]);
});

test('already credited periods are skipped and missed ones caught up', () => {
  const plan = planInterest({ since: '2026-10-01', coveredUntil: '2026-10-11', lastDate: '2026-10-25', period: 'weekly', rate: '1', openingBalance: 70000n });
  assert.deepEqual(plan.map((p) => [p.period_start, p.period_end]), [['2026-10-12', '2026-10-18'], ['2026-10-19', '2026-10-25']]);
  assert.equal(plan[0].amount, 700n);
  // Nach einem Wechsel des Zeitraums zählt nur, was noch nicht gutgeschrieben ist
  const switched = planInterest({ since: '2026-10-01', coveredUntil: '2026-10-31', lastDate: '2026-11-09', period: 'weekly', rate: '7', openingBalance: 70000n });
  assert.deepEqual(switched.map((p) => [p.period_start, p.period_end, p.days]), [['2026-11-01', '2026-11-01', 7], ['2026-11-02', '2026-11-08', 7]]);
  assert.equal(switched[0].amount, 700n);
  assert.equal(planInterest({ since: '2020-01-01', lastDate: '2026-11-09', period: 'daily', rate: '1', maxPeriods: 5 }).length, 5);
});

test('next credit date and booking titles', () => {
  assert.equal(nextInterestDate('2026-11-10', '2026-11-01', 'monthly'), '2026-11-30');
  assert.equal(nextInterestDate('2026-11-10', '2026-12-05', 'weekly'), '2026-12-06');
  assert.equal(interestTitle({ period_start: '2026-11-01', period_end: '2026-11-30' }, 'monthly'), 'Zinsen November 2026');
  assert.equal(interestTitle({ period_start: '2026-11-10', period_end: '2026-11-10' }, 'daily'), 'Zinsen 10.11.2026');
  assert.equal(interestTitle({ period_start: '2026-11-09', period_end: '2026-11-15' }, 'weekly'), 'Zinsen 09.11.–15.11.2026');
  assert.equal(interestTitle({ period_start: '2026-01-01', period_end: '2026-12-31' }, 'yearly'), 'Zinsen 2026');
});
