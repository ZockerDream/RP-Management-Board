import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWorkCompensation } from '../src/work-hours.js';
import { calculateDailyPayroll, bonusHoursDue, planPayroll, mondayOf } from '../src/payroll.js';

// Das Beispiel des Auftraggebers: 1.669 pro Tag, 13 Stunden Wochen-Soll, 17 % vom Festgehalt je Stunde darüber
const SALARY = { weeklyTarget: 13, dailySalary: 1669, bonusPercent: 17 };
const BONUS_PER_HOUR = '283.73';
const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];

const plan = (hours, { paid = {}, firstDate = WEEK[0], lastDate = WEEK[6], ...rest } = {}) => planPayroll({
  ...SALARY, ...rest, firstDate, lastDate, hoursByDate: new Map(Object.entries(hours)), paidBonusHours: new Map(Object.entries(paid)),
});
const bonusByDate = (payments) => Object.fromEntries(payments.filter((p) => p.overtime_hours > 0).map((p) => [p.date, p.overtime_pay]));
const cents = (payments, key) => payments.reduce((sum, p) => sum + Math.round(Number(p[key]) * 100), 0);

test('the bonus per hour is the percentage of the fixed daily salary', () => {
  assert.deepEqual(calculateDailyPayroll({ dailySalary: 1669, bonusPercent: 17, bonusHours: 1 }), {
    base_amount: '1669.00', overtime_hours: 1, overtime_pay: BONUS_PER_HOUR, total_amount: '1952.73',
  });
  assert.equal(calculateDailyPayroll({ dailySalary: 1669, bonusPercent: 17, bonusHours: 2 }).overtime_pay, '567.46');
  assert.equal(calculateDailyPayroll({ dailySalary: 1669, bonusPercent: 17, bonusHours: 0.5 }).overtime_pay, '141.87');
});

test('the fixed salary is paid every day, also without any hours', () => {
  const payments = plan({});
  assert.equal(payments.length, 7);
  assert.ok(payments.every((p) => p.base_amount === '1669.00' && p.overtime_pay === '0.00'));
});

test('week 1: target missed, every day only the fixed salary', () => {
  const payments = plan({ [WEEK[0]]: 8, [WEEK[3]]: 4.5 });
  assert.deepEqual(bonusByDate(payments), {});
  assert.equal(cents(payments, 'total_amount'), 7 * 166900);
});

test('week with exactly the target earns no bonus', () => {
  assert.deepEqual(bonusByDate(plan({ [WEEK[0]]: 8, [WEEK[1]]: 5 })), {});
});

test('week 2: target reached on Tuesday, every further hour earns the bonus', () => {
  const payments = plan({ [WEEK[0]]: 8, [WEEK[1]]: 7, [WEEK[2]]: 1, [WEEK[4]]: 3 });
  assert.deepEqual(bonusByDate(payments), { [WEEK[1]]: '567.46', [WEEK[2]]: BONUS_PER_HOUR, [WEEK[4]]: '851.19' });
  assert.equal(cents(payments, 'base_amount'), 7 * 166900);
});

test('week 3: target reached on Saturday, only the rest of Saturday and Sunday count', () => {
  const payments = plan({ [WEEK[0]]: 2, [WEEK[1]]: 2, [WEEK[2]]: 2, [WEEK[3]]: 2, [WEEK[4]]: 2, [WEEK[5]]: 4, [WEEK[6]]: 2 });
  assert.deepEqual(bonusByDate(payments), { [WEEK[5]]: BONUS_PER_HOUR, [WEEK[6]]: '567.46' });
});

test('monday starts over: hours of the previous week do not carry into the next one', () => {
  const payments = plan({ [WEEK[0]]: 20, '2026-11-09': 5, '2026-11-10': 5 }, { lastDate: '2026-11-10' });
  assert.deepEqual(bonusByDate(payments), { [WEEK[0]]: '1986.11' });
});

test('hours added later for an already paid day of the same week are still paid', () => {
  // Montag und Dienstag sind schon bezahlt, die Stunden wurden erst danach eingetragen
  const payments = plan({ [WEEK[0]]: 8, [WEEK[1]]: 7, [WEEK[2]]: 1 }, { paid: { [WEEK[0]]: 0, [WEEK[1]]: 0 } });
  assert.deepEqual(bonusByDate(payments), { [WEEK[2]]: '851.19' });
});

test('bonus hours already paid are not paid twice', () => {
  const payments = plan({ [WEEK[0]]: 15, [WEEK[1]]: 1 }, { paid: { [WEEK[0]]: 2 } });
  assert.deepEqual(bonusByDate(payments), { [WEEK[1]]: BONUS_PER_HOUR });
});

test('a paid day is never paid again', () => {
  const payments = plan({}, { paid: { [WEEK[0]]: 0, [WEEK[1]]: 0 } });
  assert.deepEqual(payments.map((p) => p.date), WEEK.slice(2));
});

test('a closed week stays closed when hours are added later', () => {
  const paid = Object.fromEntries(WEEK.map((date) => [date, 0]));
  const payments = plan({ [WEEK[0]]: 20, '2026-11-09': 1 }, { paid, lastDate: '2026-11-09' });
  assert.deepEqual(payments.map((p) => [p.date, p.overtime_pay]), [['2026-11-09', '0.00']]);
});

test('a lower target cannot pay old weeks again', () => {
  const paid = Object.fromEntries(WEEK.map((date) => [date, 0]));
  const payments = plan({ [WEEK[0]]: 40 }, { paid, weeklyTarget: 1, lastDate: '2026-11-09' });
  assert.deepEqual(bonusByDate(payments), {});
});

test('starting mid-week: earlier hours count towards the target but are not paid', () => {
  const payments = plan({ [WEEK[0]]: 15, [WEEK[2]]: 1 }, { firstDate: WEEK[2] });
  assert.deepEqual(payments.map((p) => p.date), WEEK.slice(2));
  assert.deepEqual(bonusByDate(payments), { [WEEK[2]]: BONUS_PER_HOUR });
});

test('fractions of hours are exact', () => {
  assert.equal(bonusHoursDue({ weeklyTarget: 13, weekHours: 13.1 + 0.2, settledHours: 0 }), 0.3);
  assert.equal(bonusHoursDue({ weeklyTarget: 13, weekHours: 12.99, settledHours: 0 }), 0);
});

test('no salary means no booking', () => {
  assert.equal(plan({ [WEEK[0]]: 20 }, { dailySalary: 0 })[0].total_amount, '0.00');
});

test('weeks start on Monday', () => {
  assert.equal(mondayOf('2026-11-08'), '2026-11-02');
  assert.equal(mondayOf('2026-11-02'), '2026-11-02');
});

test('reports the amount actually credited during the month', () => {
  assert.deepEqual(calculateWorkCompensation('74.29', 1, '23.40'), {
    overtime_hours: 1,
    base_pay: '74.29',
    overtime_pay: '23.40',
    total_pay: '97.69',
  });
});
