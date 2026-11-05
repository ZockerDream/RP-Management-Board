import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../config.js';
import { pool } from '../db.js';
import { decryptBackup } from '../backup.js';

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'list') {
  for (const f of fs.readdirSync(config.backupDir).filter((x) => x.includes('.dump')).sort()) console.log(f);
} else if (cmd === 'decrypt' && arg) {
  const out = `${arg.replace(/\.enc$/, '')}`;
  decryptBackup(path.resolve(arg), out);
  console.log(`Entschlüsselt: ${out}`);
} else if (cmd === 'restore' && arg) {
  const src = fs.existsSync(arg) ? arg : path.join(config.backupDir, arg);
  const tmp = path.join(os.tmpdir(), `restore-${Date.now()}.dump`);
  const file = decryptBackup(src, tmp);
  // Die Job-Warteschlange (pgboss) bleibt unangetastet: Ihre partitionierten Tabellen und das Schema
  // lassen sich mit --clean nicht löschen, und --exclude-schema würde das Schema trotzdem droppen.
  const toc = `${tmp}.toc`;
  const list = spawnSync('pg_restore', ['--list', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (list.status !== 0) throw new Error(`pg_restore --list fehlgeschlagen: ${list.stderr}`);
  fs.writeFileSync(toc, list.stdout.split('\n').filter((line) => !/\bpgboss\b/.test(line)).join('\n'));
  const r = spawnSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--single-transaction', '--use-list', toc, '--dbname', config.databaseUrl, file], { stdio: 'inherit' });
  fs.rmSync(toc, { force: true });
  fs.rmSync(tmp, { force: true });
  console.log(r.status === 0 ? 'Wiederherstellung abgeschlossen.' : `pg_restore beendet mit Code ${r.status}`);
  process.exitCode = r.status ?? 1;
} else {
  console.log('Nutzung: node src/cli/backup.js list | decrypt <datei> | restore <datei>');
  process.exitCode = 2;
}
await pool.end();
