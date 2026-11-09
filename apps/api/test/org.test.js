import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// org.js lädt über db.js die Konfiguration; eine Verbindung entsteht dabei nicht
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test';
process.env.JWT_SECRET ||= 'x'.repeat(64);
process.env.ENCRYPTION_KEY ||= '0'.repeat(64);
const { ORG_MODULES, MODULE_KEYS, LEVEL_LABELS, validLevel, levelSql, visibleSql } = await import('../src/org.js');

test('every module allows "no access" and only known levels', () => {
  for (const m of ORG_MODULES) {
    assert.ok(m.levels.includes(0), m.key);
    assert.ok(m.levels.every((level) => level >= 0 && level < LEVEL_LABELS.length), m.key);
    for (const level of m.levels.filter((l) => l > 0)) assert.ok(m.hints[level], `${m.key} ${level} needs a hint`);
  }
});

test('participate exists only for trainings and work time', () => {
  assert.deepEqual(ORG_MODULES.filter((m) => m.levels.includes(1)).map((m) => m.key).sort(), ['training', 'work']);
  assert.equal(validLevel('training', 1), true);
  assert.equal(validLevel('sport', 1), false);
  assert.equal(validLevel('unknown', 2), false);
});

// Die Standard-Ränge der Migration müssen jede Funktion mit einer erlaubten Stufe kennen
test('seed_team_ranks covers every module with valid levels', () => {
  const sql = readFileSync(new URL('../migrations/018_organisations_permissions.sql', import.meta.url), 'utf8');
  const block = sql.slice(sql.indexOf('CROSS JOIN (VALUES'), sql.indexOf(') d(module, lead, member, reader)'));
  const rows = [...block.matchAll(/\('(\w+)', (\d), (\d), (\d)\)/g)].map(([, key, ...levels]) => [key, levels.map(Number)]);
  assert.deepEqual(rows.map(([key]) => key).sort(), [...MODULE_KEYS].sort());
  for (const [key, levels] of rows) for (const level of levels) assert.ok(validLevel(key, level), `${key}: ${level}`);
});

test('SQL helpers reject unknown modules and keep the parameter', () => {
  assert.throws(() => levelSql('x', "budget'; DROP TABLE users; --"));
  assert.match(visibleSql('c', 'casefile', '$2', 3), /team_level\(c\.team_id, \$2, 'casefile'\) END\) >= 3$/);
  assert.match(levelSql('d', 'doc', '$1', 'd.id'), /team_level\(d\.team_id, \$1, 'doc', d\.id\)/);
});
