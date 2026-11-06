import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineWindow, todoStage, dateInZone, accessExpired } from '../src/periods.js';

test('access stays valid through its expiry date', () => {
  assert.equal(accessExpired('2026-11-06', '2026-11-05'), false);
  assert.equal(accessExpired('2026-11-06', '2026-11-06'), false);
  assert.equal(accessExpired('2026-11-06', '2026-11-07'), true);
  assert.equal(accessExpired(null, '2026-11-07'), false);
});

test('the local date follows the server time zone', () => {
  assert.equal(dateInZone('Europe/Berlin', new Date('2026-11-06T23:30:00Z')), '2026-11-07');
  assert.equal(dateInZone('UTC', new Date('2026-11-06T23:30:00Z')), '2026-11-06');
});

test('daily window ends on the anchor and defaults to 14 days', () => {
  assert.deepEqual(timelineWindow('day', '2026-11-06'), { start: '2026-10-24', end: '2026-11-06', stepDays: 1 });
});

test('weekly window starts each bucket on the configured first weekday', () => {
  // 2026-11-06 ist ein Freitag
  assert.deepEqual(timelineWindow('week', '2026-11-06', 2, 1), { start: '2026-10-26', end: '2026-11-02', stepDays: 7 });
  assert.deepEqual(timelineWindow('week', '2026-11-06', 2, 0), { start: '2026-10-25', end: '2026-11-01', stepDays: 7 });
});

test('a week that starts on the anchor keeps the anchor as its bucket', () => {
  assert.equal(timelineWindow('week', '2026-11-02', 1, 1).end, '2026-11-02');
  assert.equal(timelineWindow('week', '2026-11-01', 1, 0).end, '2026-11-01');
});

test('windows cross month and year boundaries', () => {
  assert.deepEqual(timelineWindow('day', '2027-01-02', 3), { start: '2026-12-31', end: '2027-01-02', stepDays: 1 });
});

test('an invalid anchor yields no window instead of throwing', () => {
  assert.equal(timelineWindow('day', '2026-13-45'), null);
});

test('todos remind the day before, on the day and once overdue', () => {
  assert.equal(todoStage('2026-11-10', '2026-11-08'), null);
  assert.equal(todoStage('2026-11-09', '2026-11-08'), 'tomorrow');
  assert.equal(todoStage('2026-11-08', '2026-11-08'), 'today');
  assert.equal(todoStage('2026-11-07', '2026-11-08'), 'overdue');
  assert.equal(todoStage('2020-01-01', '2026-11-08'), 'overdue');
});

test('todo stages stay correct across a daylight saving change', () => {
  // Zeitumstellung in Deutschland am 25.10.2026
  assert.equal(todoStage('2026-10-26', '2026-10-25'), 'tomorrow');
  assert.equal(todoStage('2026-10-25', '2026-10-24'), 'tomorrow');
});
