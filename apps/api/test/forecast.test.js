import test from 'node:test';
import assert from 'node:assert/strict';
import { weekOf, ruleOccurrences, salaryDays, historyWeeks, planForecast, HISTORY_WEEKS } from '../src/forecast.js';

test('weeks follow the week start from the profile', () => {
  // 2026-11-10 ist ein Dienstag
  assert.deepEqual(weekOf('2026-11-10', 1), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(weekOf('2026-11-15', 1), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(weekOf('2026-11-10', 0), { start: '2026-11-08', end: '2026-11-14' });
  assert.deepEqual(weekOf('2026-11-08', 0), { start: '2026-11-08', end: '2026-11-14' });
});

test('standing orders count only executions that are not booked yet', () => {
  const weekly = { start_date: '2026-10-05', next_run: '2026-11-16', frequency: 'weekly', interval: 1, active: true };
  assert.deepEqual(ruleOccurrences(weekly, '2026-11-09', '2026-11-22'), ['2026-11-16']);
  const daily = { start_date: '2026-11-01', next_run: '2026-11-11', end_date: '2026-11-13', frequency: 'daily', interval: 1 };
  assert.deepEqual(ruleOccurrences(daily, '2026-11-09', '2026-11-22'), ['2026-11-11', '2026-11-12', '2026-11-13']);
  const monthly = { start_date: '2026-01-31', next_run: '2026-11-30', frequency: 'monthly', interval: 1 };
  assert.deepEqual(ruleOccurrences(monthly, '2026-11-09', '2026-11-22'), []);
  assert.deepEqual(ruleOccurrences({ ...weekly, active: false }, '2026-11-09', '2026-11-22'), []);
  const custom = { start_date: '2026-11-09', next_run: '2026-11-09', frequency: 'custom', interval: 5 };
  assert.deepEqual(ruleOccurrences(custom, '2026-11-09', '2026-11-22'), ['2026-11-09', '2026-11-14', '2026-11-19']);
});

test('salary comes for every day without a payroll booking, from the start date on', () => {
  assert.deepEqual(salaryDays({ from: '2026-11-09', to: '2026-11-12', startDate: '2026-11-10', paidDates: new Set(['2026-11-10']) }), ['2026-11-11', '2026-11-12']);
  assert.deepEqual(salaryDays({ from: '2026-11-09', to: '2026-11-10', startDate: null }), []);
});

test('experience covers the weeks since the first booking, at most eight', () => {
  assert.equal(historyWeeks(null, '2026-11-09'), 0);
  assert.equal(historyWeeks('2026-11-09', '2026-11-09'), 0);
  assert.equal(historyWeeks('2026-11-08', '2026-11-09'), 1);
  assert.equal(historyWeeks('2026-10-28', '2026-11-09'), 2);
  assert.equal(historyWeeks('2025-01-01', '2026-11-09'), HISTORY_WEEKS);
});

test('forecast adds booked, planned, standing orders, salary and the average for the remaining days', () => {
  const [now, next] = planForecast({
    today: '2026-11-10',
    weekStart: 1,
    transactions: [
      { date: '2026-11-09', type: 'income', amount: '100.00' },
      { date: '2026-11-10', type: 'expense', amount: '40.50' },
      { date: '2026-11-12', type: 'expense', amount: '10.00' },
      { date: '2026-11-17', type: 'income', amount: '5.00' },
      { date: '2026-11-11', type: 'deposit', amount: '999.00' },
    ],
    recurring: [{ date: '2026-11-13', type: 'expense', amount: '20.00' }, { date: '2026-11-20', type: 'expense', amount: '20.00' }],
    salary: [{ date: '2026-11-09', amount: '1669.00' }, { date: '2026-11-10', amount: '1669.00' }, { date: '2026-11-16', amount: '1669.00' }],
    history: { weeks: 2, income: '1400.00', expense: '700.00' },
  });
  assert.equal(now.start, '2026-11-09');
  assert.equal(now.end, '2026-11-15');
  assert.equal(now.estimate_days, 5);
  // Schnitt pro Tag: 1400 / 14 = 100 Einnahmen, 700 / 14 = 50 Ausgaben
  assert.deepEqual(now.income, { booked: '100.00', planned: '0.00', recurring: '0.00', salary: '3338.00', estimate: '500.00', total: '3938.00' });
  assert.deepEqual(now.expense, { booked: '40.50', planned: '10.00', recurring: '20.00', salary: '0.00', estimate: '250.00', total: '320.50' });
  assert.equal(now.balance, '3617.50');
  assert.equal(next.start, '2026-11-16');
  assert.equal(next.estimate_days, 7);
  assert.deepEqual(next.income, { booked: '0.00', planned: '5.00', recurring: '0.00', salary: '1669.00', estimate: '700.00', total: '2374.00' });
  assert.deepEqual(next.expense, { booked: '0.00', planned: '0.00', recurring: '20.00', salary: '0.00', estimate: '350.00', total: '370.00' });
  assert.equal(next.balance, '2004.00');
});

test('no experience means no estimate; on the last day of the week nothing is estimated for it', () => {
  const [now, next] = planForecast({ today: '2026-11-15', weekStart: 1, history: { weeks: 0, income: '0', expense: '0' } });
  assert.equal(now.estimate_days, 0);
  assert.equal(now.income.estimate, '0.00');
  assert.equal(next.income.estimate, '0.00');
  assert.equal(next.balance, '0.00');
});

test('estimates round to whole cents without floats', () => {
  const [, next] = planForecast({ today: '2026-11-10', history: { weeks: 3, income: '100.00', expense: '0.01' } });
  // 100 € in 21 Tagen, 7 Tage: 33,333… → 33,33; 0,01 € → 0,00
  assert.equal(next.income.estimate, '33.33');
  assert.equal(next.expense.estimate, '0.00');
  const [, big] = planForecast({ today: '2026-11-10', history: { weeks: 8, income: '999999999999.99', expense: '0' } });
  assert.equal(big.income.estimate, '125000000000.00');
});
