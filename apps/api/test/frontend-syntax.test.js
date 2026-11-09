import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Die Frontend-Module laufen ohne Build direkt im Browser. Ein Syntaxfehler (etwa ein fehlendes Anführungszeichen
// in einem Hilfetext) legt eine ganze Seite lahm. `node --check datei.js` prüft hier nicht als ES-Modul und übersieht
// solche Fehler, deshalb jede Datei als Modul über stdin prüfen.
const root = new URL('../../web/public/js/', import.meta.url).pathname;
const files = readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.js'));

test('every frontend module parses as an ES module', () => {
  assert.ok(files.length > 30, `nur ${files.length} Module gefunden`);
  const broken = files.flatMap((file) => {
    const run = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(join(root, file)) });
    return run.status === 0 ? [] : [`${file}: ${String(run.stderr).split('\n').find((l) => /Error/.test(l)) || run.status}`];
  });
  assert.deepEqual(broken, []);
});
