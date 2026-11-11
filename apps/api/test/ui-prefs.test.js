import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUiPrefs, uiPrefsSchema, UI_DEFAULTS, DASHBOARD_MODULES } from '../src/ui-prefs.js';

test('missing or broken preferences fall back to the defaults', () => {
  assert.deepEqual(normalizeUiPrefs({}), { ...UI_DEFAULTS });
  assert.deepEqual(normalizeUiPrefs(null), { ...UI_DEFAULTS });
  assert.deepEqual(normalizeUiPrefs({ background: 'beach', blur: 99, opacity: 5, dim: '30', lite: 'yes', dashboard: [] }), { ...UI_DEFAULTS });
});

test('valid values survive unchanged', () => {
  const prefs = { background: 'custom', blur: 0, opacity: 90, dim: 70, lite: false, dashboard: { order: ['cashflow', 'kpis'], hidden: ['fleet'], spans: { cashflow: 12 } } };
  assert.deepEqual(normalizeUiPrefs(prefs), prefs);
  assert.equal(uiPrefsSchema.safeParse(prefs).success, true);
});

test('unknown or duplicate dashboard modules are dropped when reading, hidden never repeats a shown module', () => {
  const read = normalizeUiPrefs({ dashboard: { order: ['kpis', 'removed', 'kpis', 'todos'], hidden: ['todos', 'fleet', 'gone'], spans: { kpis: 12, todos: 5, gone: 4 } } });
  assert.deepEqual(read.dashboard, { order: ['kpis', 'todos'], hidden: ['fleet'], spans: { kpis: 12 } });
});

test('the API rejects incomplete objects, unknown keys and out-of-range values', () => {
  const ok = { ...UI_DEFAULTS };
  assert.equal(uiPrefsSchema.safeParse(ok).success, true);
  assert.equal(uiPrefsSchema.safeParse({ ...ok, extra: 1 }).success, false);
  assert.equal(uiPrefsSchema.safeParse({ blur: 10 }).success, false);
  assert.equal(uiPrefsSchema.safeParse({ ...ok, blur: 41 }).success, false);
  assert.equal(uiPrefsSchema.safeParse({ ...ok, dashboard: { order: [], hidden: [], spans: { kpis: 5 } } }).success, false);
  assert.equal(uiPrefsSchema.safeParse({ ...ok, dashboard: { order: Array(DASHBOARD_MODULES.length + 1).fill('kpis'), hidden: [], spans: {} } }).success, false);
});
