import { test } from 'node:test';
import assert from 'node:assert/strict';

// Port 1 ist zu: Verbindungsfehler ohne echte Datenbank
process.env.DATABASE_URL ||= 'postgres://budget-mgmt:geheim@127.0.0.1:1/budget';
process.env.JWT_SECRET ||= 'x'.repeat(64);
process.env.ENCRYPTION_KEY ||= '0'.repeat(64);
const { dbStartError, waitForDb, pool } = await import('../src/db.js');

const URL = 'postgres://budget-mgmt:geheim@db:5432/budget';
const pgError = (code, message) => Object.assign(new Error(message), { code });

test('rejected login explains that credentials only apply to an empty volume', () => {
  const e = dbStartError(pgError('28P01', 'password authentication failed for user "budget-mgmt"'), URL);
  assert.match(e.message, /lehnt die Anmeldung als „budget-mgmt“ ab/);
  assert.match(e.message, /nur beim allerersten Start/);
  assert.match(e.message, /budget-manager_db_data/);
  assert.match(e.message, /docker compose down -v/);
  assert.doesNotMatch(e.message, /geheim/, 'das Passwort gehört nicht ins Log');
});

test('missing database names the database', () => {
  const e = dbStartError(pgError('3D000', 'database "budget" does not exist'), URL);
  assert.match(e.message, /Die Datenbank „budget“ gibt es nicht/);
});

test('other errors keep the cause', () => {
  const e = dbStartError(Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:5432'), { code: 'ECONNREFUSED' }), URL);
  assert.equal(e.message, 'Datenbank nicht erreichbar (connect ECONNREFUSED 10.0.0.2:5432)');
});

test('waitForDb gives up with the cause after its retries', async () => {
  await assert.rejects(waitForDb(2, 10), /^Error: Datenbank nicht erreichbar \(.*ECONNREFUSED/);
  await pool.end();
});
