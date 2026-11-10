import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Die Daten laufen im Browser, kommen aber ohne DOM aus
import { CHANGELOG, UNRELEASED, CHANGE_TYPES } from '../../web/public/js/changelog.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const parts = (version) => version.split('.').map(Number);
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (parts(a)[i] !== parts(b)[i]) return parts(a)[i] > parts(b)[i];
  return false;
};

test('the newest changelog entry is the version in package.json', () => {
  // Vergisst ein Release den Changelog, zeigte die Seite eine falsche installierte Version
  assert.equal(CHANGELOG[0].version, pkg.version);
});

test('versions run from newest to 0.0.0 with dates that never go forward', () => {
  assert.equal(CHANGELOG.at(-1).version, '0.0.0');
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.ok(newer(CHANGELOG[i - 1].version, CHANGELOG[i].version), `${CHANGELOG[i - 1].version} vor ${CHANGELOG[i].version}`);
    assert.ok(CHANGELOG[i - 1].date >= CHANGELOG[i].date, `Datum von ${CHANGELOG[i - 1].version}`);
  }
  assert.equal(new Set(CHANGELOG.map((entry) => entry.version)).size, CHANGELOG.length);
});

test('every entry has a date, a title and only known kinds of change', () => {
  for (const entry of CHANGELOG) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.title.length > 0 && entry.changes.length > 0, entry.version);
  }
  for (const [type, text] of [...CHANGELOG.flatMap((entry) => entry.changes), ...UNRELEASED]) {
    assert.ok(CHANGE_TYPES[type], `Art ${type}`);
    assert.ok(text.length > 10 && !/<[a-z]/i.test(text), text);
  }
});
