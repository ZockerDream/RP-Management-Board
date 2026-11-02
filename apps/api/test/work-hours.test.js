import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWorkCompensation } from '../src/work-hours.js';
import { calculateDailyPayroll } from '../src/payroll.js';

test('pays the weekly base over all seven days even when no hours are logged', () => {
  const result = calculateDailyPayroll({
    date: '2026-11-04', weeklyTarget: 13, hourlyRate: 20,
    surchargePercent: 17, previousWeekHours: 13, todayHours: 0,
  });
  assert.deepEqual(result, {
    base_amount: '37.14',
    overtime_hours: 0,
    overtime_pay: '0.00',
    total_amount: '37.14',
  });
});

test('distributes the exact weekly base across the seven calendar days', () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const cents = dates.reduce((sum, date) => sum + Math.round(Number(calculateDailyPayroll({
    date, weeklyTarget: 13, hourlyRate: 20,
    surchargePercent: 17, previousWeekHours: 0, todayHours: 0,
  }).base_amount) * 100), 0);
  assert.equal(cents, 26000);
});

test('pays overtime hours at the hourly rate plus the surcharge', () => {
  const result = calculateDailyPayroll({
    date: '2026-11-05', weeklyTarget: 13, hourlyRate: 20,
    surchargePercent: 17, previousWeekHours: 13, todayHours: 1,
  });
  assert.deepEqual(result, {
    base_amount: '37.14',
    overtime_hours: 1,
    overtime_pay: '23.40',
    total_amount: '60.54',
  });
});

test('adds a surcharge only for the part of a shift that crosses the weekly target', () => {
  const result = calculateDailyPayroll({
    date: '2026-11-05', weeklyTarget: 13, hourlyRate: 20,
    surchargePercent: 17, previousWeekHours: 12.5, todayHours: 1,
  });
  assert.deepEqual(result, {
    base_amount: '37.14',
    overtime_hours: 0.5,
    overtime_pay: '11.70',
    total_amount: '48.84',
  });
});

test('reports the amount actually credited during the month', () => {
  assert.deepEqual(calculateWorkCompensation('74.29', 1, '23.40'), {
    overtime_hours: 1,
    base_pay: '74.29',
    overtime_pay: '23.40',
    total_pay: '97.69',
  });
});
