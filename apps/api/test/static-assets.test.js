import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assetVersion, versionIndexHtml } from '../src/static-assets.js';

function tempSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-assets-'));
  fs.mkdirSync(path.join(root, 'js'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'js', 'app.js'), 'export const a = 1;');
  return root;
}

test('asset version is stable while files stay the same', () => {
  const root = tempSite();
  assert.equal(assetVersion(root), assetVersion(root));
  assert.match(assetVersion(root), /^[0-9a-f]{12}$/);
});

test('asset version changes when a nested file changes', () => {
  const root = tempSite();
  const before = assetVersion(root);
  fs.writeFileSync(path.join(root, 'js', 'app.js'), 'export const a = 2;');
  assert.notEqual(assetVersion(root), before);
});

test('asset version changes when a file is added', () => {
  const root = tempSite();
  const before = assetVersion(root);
  fs.writeFileSync(path.join(root, 'js', 'neu.js'), '');
  assert.notEqual(assetVersion(root), before);
});

test('index html points scripts, styles and the icon to the versioned path', () => {
  const html = '<script src="js/theme.js"></script><link rel="icon" href="favicon.svg"><link rel="stylesheet" href="css/theme.css"><script type="module" src="js/app.js"></script>';
  assert.equal(
    versionIndexHtml(html, 'abc'),
    '<script src="assets/abc/js/theme.js"></script><link rel="icon" href="assets/abc/favicon.svg"><link rel="stylesheet" href="assets/abc/css/theme.css"><script type="module" src="assets/abc/js/app.js"></script>',
  );
});

test('index html keeps navigation links and inline references unchanged', () => {
  const html = '<a class="nav" href="#/dashboard">Dashboard</a><a href="#/js/x">x</a><rect fill="url(#bmg)"/>';
  assert.equal(versionIndexHtml(html, 'abc'), html);
});
