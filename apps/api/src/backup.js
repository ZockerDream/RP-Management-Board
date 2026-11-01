import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { one, q, many } from './db.js';
import { config } from './config.js';

const key = crypto.createHash('sha256').update(`backup:${config.encryptionKey}`).digest();
const MAGIC = Buffer.from('BMB1');

export async function runBackup(userId, log = console) {
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `budget-manager-${stamp}.dump${config.backupEncrypt ? '.enc' : ''}`;
  const file = path.join(config.backupDir, filename);
  const rec = await one('INSERT INTO backups(filename, created_by) VALUES ($1,$2) RETURNING id', [filename, userId || null]);
  try {
    const dump = spawn('pg_dump', ['-Fc', '--no-owner', '--dbname', config.databaseUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    dump.stderr.on('data', (d) => (err += d));
    const exit = new Promise((res, rej) => {
      dump.on('error', rej);
      dump.on('close', (code) => (code === 0 ? res() : rej(new Error(`pg_dump Exit ${code}: ${err.slice(0, 300)}`))));
    });
    const out = fs.createWriteStream(file, { mode: 0o600 });
    if (config.backupEncrypt) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      out.write(Buffer.concat([MAGIC, iv]));
      const tagAppender = new Transform({
        transform(chunk, _e, cb) { cb(null, chunk); },
        flush(cb) { this.push(c.getAuthTag()); cb(); },
      });
      await Promise.all([pipeline(dump.stdout, c, tagAppender, out), exit]);
    } else {
      await Promise.all([pipeline(dump.stdout, out), exit]);
    }
    const size = fs.statSync(file).size;
    await q("UPDATE backups SET status='ok', size=$2 WHERE id=$1", [rec.id, size]);
    return { id: rec.id, filename, size };
  } catch (e) {
    fs.rmSync(file, { force: true });
    await q("UPDATE backups SET status='failed', error=$2 WHERE id=$1", [rec.id, String(e.message).slice(0, 500)]);
    log.error?.({ err: e }, 'Backup fehlgeschlagen');
    throw e;
  }
}

export async function pruneBackups(days = config.backupRetentionDays) {
  const old = await many("SELECT id, filename FROM backups WHERE created_at < now() - ($1 || ' days')::interval", [String(days)]);
  for (const b of old) {
    fs.rmSync(path.join(config.backupDir, path.basename(b.filename)), { force: true });
    await q('DELETE FROM backups WHERE id=$1', [b.id]);
  }
  return old.length;
}

// Entschlüsselt eine .enc-Datei nach outPath (oder liefert Pfad zurück, wenn unverschlüsselt)
export function decryptBackup(file, outPath) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 4).equals(MAGIC)) return file;
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(buf.length - 16));
  fs.writeFileSync(outPath, Buffer.concat([d.update(buf.subarray(16, buf.length - 16)), d.final()]), { mode: 0o600 });
  return outPath;
}
