import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedIso, shiftTimes, daysBetween, taken } from '../src/shifts.js';

test('zonedIso rechnet Ortszeit in UTC um, auch mit Sommerzeit', () => {
  assert.equal(zonedIso('2026-11-13', '06:00', 'Europe/Berlin'), '2026-11-13T05:00:00.000Z');
  assert.equal(zonedIso('2026-07-01', '06:00', 'Europe/Berlin'), '2026-07-01T04:00:00.000Z');
  assert.equal(zonedIso('2026-03-29', '04:00', 'Europe/Berlin'), '2026-03-29T02:00:00.000Z');
  assert.equal(zonedIso('2026-11-13', '06:00', 'UTC'), '2026-11-13T06:00:00.000Z');
});

test('Nachtschicht endet am Folgetag', () => {
  assert.deepEqual(shiftTimes('2026-11-13', '22:00', '06:00', 'Europe/Berlin'), { starts_at: '2026-11-13T21:00:00.000Z', ends_at: '2026-11-14T05:00:00.000Z' });
  assert.deepEqual(shiftTimes('2026-11-13', '06:00:00', '14:00:00', 'UTC'), { starts_at: '2026-11-13T06:00:00.000Z', ends_at: '2026-11-13T14:00:00.000Z' });
});

test('daysBetween und taken', () => {
  assert.deepEqual(daysBetween('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(daysBetween('2026-01-01', '2026-12-31').length, 62);
  assert.equal(taken([{ status: 'assigned' }, { status: 'offered' }, { status: 'sick' }]), 2);
});
