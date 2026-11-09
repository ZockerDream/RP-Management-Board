import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Update per „git pull“ und „docker compose up -d“: Das Image heißt nach der Code-Version und wird bei jedem „up“ gebaut.
// Vergisst ein Release die Version in docker-compose.yml, liefe die Instanz unter einem falschen Namen.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const pkg = JSON.parse(read('../package.json'));
const lock = JSON.parse(read('../package-lock.json'));
const compose = read('../../../docker-compose.yml');
const service = (name) => compose.slice(compose.indexOf(`\n  ${name}:\n`), compose.indexOf('\n\n', compose.indexOf(`\n  ${name}:\n`)));

test('package.json, package-lock.json and the compose image tag carry the same version', () => {
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  for (const name of ['api', 'worker']) {
    assert.match(service(name), new RegExp(`image: budget-manager-api:\\$\\{IMAGE_TAG:-${pkg.version.replace(/\./g, '\\.')}\\}`), name);
  }
});

test('docker compose up rebuilds the API image, and no .env value can pin an old image', () => {
  assert.match(service('api'), /pull_policy: build/);
  assert.match(service('api'), /build:/);
  assert.doesNotMatch(compose, /\$\{APP_VERSION/);
});
