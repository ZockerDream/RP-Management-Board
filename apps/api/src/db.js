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

// Fehler, die durch Warten nicht verschwinden: Anmeldung abgelehnt (28P01, 28000), Datenbank fehlt (3D000)
const PERMANENT_DB_ERRORS = new Set(['28P01', '28000', '3D000']);

// Erklärt, warum die API nicht an die Datenbank kommt. Häufigster Fall bei einer neuen Installation: Das Volume
// db_data stammt aus einem früheren Start mit anderen DB_USER/DB_PASSWORD/DB_NAME; PostgreSQL übernimmt diese
// Werte nur, wenn das Volume beim Start noch leer ist.
export function dbStartError(e, databaseUrl = config.databaseUrl) {
  let user = '?';
  let name = '?';
  try {
    const url = new URL(databaseUrl);
    user = decodeURIComponent(url.username);
    name = decodeURIComponent(url.pathname.slice(1));
  } catch {
    // ungültige URL: Meldung ohne Namen
  }
  const reason = e?.message || String(e);
  const volume = [
    'PostgreSQL übernimmt DB_USER, DB_PASSWORD und DB_NAME aus .env nur beim allerersten Start, solange das',
    'Datenbank-Volume (bei Docker Compose: budget-manager_db_data) leer ist. Wurde es schon einmal mit anderen',
    'Werten gestartet, gelten weiter die alten. Das Volume gehört allen Installationen dieser App auf demselben',
    'Host, egal in welchem Verzeichnis.',
    'Lösung: die alten Werte wieder in .env eintragen. Nur wenn die Daten darin weg dürfen:',
    '"docker compose down -v" löscht Datenbank, Uploads und Backups, danach "docker compose up -d".',
    'Details: README.md, Abschnitt „Wenn die App nicht startet“.',
  ];
  if (e?.code === '28P01' || e?.code === '28000') {
    return new Error([`Die Datenbank lehnt die Anmeldung als „${user}“ ab (${reason}).`, ...volume].join('\n'));
  }
  if (e?.code === '3D000') {
    return new Error([`Die Datenbank „${name}“ gibt es nicht (${reason}).`, ...volume].join('\n'));
  }
  return new Error(`Datenbank nicht erreichbar (${reason})`);
}

export async function waitForDb(retries = 30, delayMs = 2000) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      last = e;
      if (PERMANENT_DB_ERRORS.has(e?.code)) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw dbStartError(last);
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
