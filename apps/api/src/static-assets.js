import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Hash über alle statischen Dateien: Jede Änderung ergibt neue Asset-Adressen, sodass
// nach einem Update nie neues HTML mit altem JS oder CSS aus einem Cache zusammentrifft.
export function assetVersion(root) {
  const hash = crypto.createHash('sha256');
  const files = fs.readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => fs.statSync(path.join(root, file)).isFile())
    .sort();
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(root, file)));
  }
  return hash.digest('hex').slice(0, 12);
}

// Relative Imports der Module bleiben dadurch automatisch innerhalb derselben Version.
export function versionIndexHtml(html, version) {
  return html.replace(/\b(src|href)="((?:js|css)\/[^"]+|favicon\.svg)"/g, `$1="assets/${version}/$2"`);
}
