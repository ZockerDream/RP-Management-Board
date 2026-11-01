import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { encrypt } from './security.js';

// numeric/date als Strings belassen (Geld nie als float, Datum ohne Zeitzonen-Shift)
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1083, (v) => v.slice(0, 5));
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Datenbank nicht erreichbar');
}

export async function migrate(log = console) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727001)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      log.info(`Migration ${f}`);
      await c.query('BEGIN');
      try {
        await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    const pinColumns = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='properties' AND column_name IN ('door_pin','door_pin_enc')`,
    );
    const columns = new Set(pinColumns.rows.map((row) => row.column_name));
    if (columns.has('door_pin') && columns.has('door_pin_enc')) {
      await c.query('BEGIN');
      try {
        const legacyPins = await c.query('SELECT id, door_pin FROM properties WHERE door_pin_enc IS NULL AND door_pin <> \'\'');
        for (const property of legacyPins.rows) {
          await c.query('UPDATE properties SET door_pin_enc=$2 WHERE id=$1', [property.id, encrypt(property.door_pin)]);
        }
        await c.query('ALTER TABLE properties DROP COLUMN door_pin');
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}
