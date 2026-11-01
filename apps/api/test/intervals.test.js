import test from 'node:test';
import assert from 'node:assert/strict';
import { occursOn } from '../../web/public/js/recurrence.js';

test('calendar repeats every configured unit', () => {
  assert.equal(occursOn('2026-01-05', 'daily', 3, '2026-01-08'), true);
  assert.equal(occursOn('2026-01-05', 'weekly', 2, '2026-01-19'), true);
  assert.equal(occursOn('2026-01-05', 'weekly', 2, '2026-01-12'), false);
  assert.equal(occursOn('2026-01-05', 'monthly', 3, '2026-04-05'), true);
});

test('monthly and yearly repeats clamp to the final day of shorter periods', () => {
  assert.equal(occursOn('2026-01-31', 'monthly', 1, '2026-02-28'), true);
  assert.equal(occursOn('2026-01-31', 'monthly', 1, '2026-03-31'), true);
  assert.equal(occursOn('2024-02-29', 'yearly', 1, '2025-02-28'), true);
  assert.equal(occursOn('2024-02-29', 'yearly', 1, '2025-03-01'), false);
});

test('one-off and custom-day schedules only occur at their expected dates', () => {
  assert.equal(occursOn('2026-06-01', 'none', 1, '2026-06-01'), true);
  assert.equal(occursOn('2026-06-01', 'none', 1, '2026-06-02'), false);
  assert.equal(occursOn('2026-06-01', 'custom', 10, '2026-06-11'), true);
  assert.equal(occursOn('2026-06-01', 'custom', 10, '2026-06-12'), false);
});
