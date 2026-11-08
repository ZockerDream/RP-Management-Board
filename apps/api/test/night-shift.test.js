import test from 'node:test';
import assert from 'node:assert/strict';
import { splitManualEntry, splitTimer, zonedMidnight, apportion } from '../src/work-split.js';
import { payrollCutoff, planPayroll } from '../src/payroll.js';

const TZ = 'Europe/Berlin';
const sum = (parts, key) => Math.round(parts.reduce((acc, part) => acc + Number(part[key]), 0) * 100) / 100;

test('apportion keeps the exact total', () => {
  assert.deepEqual(apportion(1, [1, 1, 1], 100), [0.33, 0.34, 0.33]);
  assert.deepEqual(apportion(4, [120, 120], 100), [2, 2]);
  assert.deepEqual(apportion(5, [0, 0], 1), [5, 0]);
});

test('a manual entry within one day stays one entry', () => {
  const entry = { work_date: '2026-11-08', hours: 8, started_at: '08:00', ended_at: '16:30', break_minutes: 30 };
  assert.deepEqual(splitManualEntry(entry), [entry]);
  assert.deepEqual(splitManualEntry({ work_date: '2026-11-08', hours: 2 }), [{ work_date: '2026-11-08', hours: 2 }]);
});

test('a manual entry until midnight stays on its day', () => {
  const entry = { work_date: '2026-11-08', hours: 2, started_at: '22:00', ended_at: '00:00', break_minutes: 0 };
  assert.deepEqual(splitManualEntry(entry), [entry]);
});

test('a manual night shift is split at midnight by duration', () => {
  const parts = splitManualEntry({ work_date: '2026-11-08', hours: 4, started_at: '22:00', ended_at: '02:00', break_minutes: 30, note: 'Nacht' });
  assert.deepEqual(parts, [
    { work_date: '2026-11-08', hours: 2, started_at: '22:00', ended_at: '00:00', break_minutes: 15, note: 'Nacht' },
    { work_date: '2026-11-09', hours: 2, started_at: '00:00', ended_at: '02:00', break_minutes: 15, note: 'Nacht' },
  ]);
  // Ungleiche Anteile: 1 Stunde vor, 3 Stunden nach Mitternacht
  const uneven = splitManualEntry({ work_date: '2026-11-30', hours: 3.5, started_at: '23:00', ended_at: '03:00', break_minutes: 0 });
  assert.deepEqual(uneven.map((p) => [p.work_date, p.hours]), [['2026-11-30', 0.88], ['2026-12-01', 2.62]]);
  assert.equal(sum(uneven, 'hours'), 3.5);
});

test('the timer splits a shift at local midnight', () => {
  // 22:00 bis 02:00 Ortszeit (Winterzeit, UTC+1)
  const parts = splitTimer({ startedAt: '2026-11-08T21:00:00Z', stoppedAt: '2026-11-09T01:00:00Z', timeZone: TZ });
  assert.deepEqual(parts, [
    { work_date: '2026-11-08', started_at: '22:00', ended_at: '00:00', hours: 2, break_minutes: 0 },
    { work_date: '2026-11-09', started_at: '00:00', ended_at: '02:00', hours: 2, break_minutes: 0 },
  ]);
});

test('the timer keeps a shift within one day as one entry', () => {
  const parts = splitTimer({ startedAt: '2026-11-08T07:00:00Z', stoppedAt: '2026-11-08T15:30:00Z', pausedSeconds: 1800, timeZone: TZ });
  assert.deepEqual(parts, [{ work_date: '2026-11-08', started_at: '08:00', ended_at: '16:30', hours: 8, break_minutes: 30 }]);
});

test('a running pause is subtracted where it happened, earlier pauses proportionally', () => {
  // 22:00 bis 06:00, Pause seit 23:30 bis zum Stopp: Gearbeitet wurde nur am Sonntag
  const paused = splitTimer({ startedAt: '2026-11-08T21:00:00Z', stoppedAt: '2026-11-09T05:00:00Z', pausedAt: '2026-11-08T22:30:00Z', timeZone: TZ });
  assert.deepEqual(paused.map((p) => [p.work_date, p.hours, p.break_minutes]), [['2026-11-08', 1.5, 30]]);
  // 22:00 bis 02:00 mit 60 Minuten früherer Pause: je 30 Minuten auf beide Tage
  const earlier = splitTimer({ startedAt: '2026-11-08T21:00:00Z', stoppedAt: '2026-11-09T01:00:00Z', pausedSeconds: 3600, timeZone: TZ });
  assert.deepEqual(earlier.map((p) => [p.work_date, p.hours, p.break_minutes]), [['2026-11-08', 1.5, 30], ['2026-11-09', 1.5, 30]]);
});

test('local midnight follows daylight saving time', () => {
  assert.equal(new Date(zonedMidnight('2026-07-01', TZ)).toISOString(), '2026-06-30T22:00:00.000Z');
  assert.equal(new Date(zonedMidnight('2026-11-09', TZ)).toISOString(), '2026-11-08T23:00:00.000Z');
  // Nacht der Zeitumstellung: 25. auf 26. Oktober 2026 hat 25 Stunden
  const parts = splitTimer({ startedAt: '2026-10-24T20:00:00Z', stoppedAt: '2026-10-25T23:00:00Z', timeZone: TZ });
  assert.deepEqual(parts.map((p) => [p.work_date, p.hours]), [['2026-10-24', 2], ['2026-10-25', 25]]);
});

test('payroll books yesterday from 03:45 and waits for an open shift', () => {
  assert.equal(payrollCutoff({ date: '2026-11-09', time: '03:44' }), '2026-11-07');
  assert.equal(payrollCutoff({ date: '2026-11-09', time: '03:45' }), '2026-11-08');
  // Timer seit Sonntagabend: Sonntag wartet, Samstag wird gebucht
  assert.equal(payrollCutoff({ date: '2026-11-09', time: '03:45', openShiftDate: '2026-11-08' }), '2026-11-07');
  // Timer erst heute gestartet: hält den Vortag nicht auf
  assert.equal(payrollCutoff({ date: '2026-11-09', time: '10:45', openShiftDate: '2026-11-09' }), '2026-11-08');
});

test('a Sunday night shift counts after midnight to the new week', () => {
  // Soll 13 Stunden in der Woche vom 2. bis 8. November erreicht; Schicht Sonntag 22:00 bis Montag 02:00
  const [sunday, monday] = splitManualEntry({ work_date: '2026-11-08', hours: 4, started_at: '22:00', ended_at: '02:00', break_minutes: 0 });
  const payments = planPayroll({
    weeklyTarget: 13, dailySalary: 1669, bonusPercent: 17,
    firstDate: '2026-11-02', lastDate: '2026-11-09',
    hoursByDate: new Map([['2026-11-02', 13], [sunday.work_date, sunday.hours], [monday.work_date, monday.hours]]),
    paidBonusHours: new Map(),
  });
  const bonus = Object.fromEntries(payments.map((p) => [p.date, p.overtime_hours]));
  assert.equal(bonus['2026-11-08'], 2);
  assert.equal(bonus['2026-11-09'], 0);
});
