import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookOk, discordPayload, clean } from '../src/discord.js';

test('webhookOk lässt nur Discord-Webhooks zu', () => {
  assert.ok(webhookOk('https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABCDEF'));
  assert.ok(webhookOk('https://canary.discordapp.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz'));
  for (const bad of ['http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz', 'https://evil.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
    'https://discord.com.evil.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz', 'https://discord.com/api/webhooks/123/abc', '']) assert.equal(webhookOk(bad), false, bad);
});

test('clean entschärft Erwähnungen', () => {
  assert.equal(clean('Hallo @everyone und <@123456> und <@&99>', 200), 'Hallo @​everyone und @… und @…');
  assert.equal(clean('x'.repeat(10), 3), 'xxx');
});

test('discordPayload baut ein Embed ohne Erwähnungen', () => {
  const p = discordPayload('LSPD', { title: 'Neue Ankündigung', description: 'Text', url: 'https://x/#/board', fields: [{ name: 'Von', value: 'Alice' }, { name: 'Leer', value: '' }] });
  assert.deepEqual(p.allowed_mentions, { parse: [] });
  assert.equal(p.username, 'LSPD');
  assert.equal(p.embeds[0].fields.length, 1);
  assert.equal(p.embeds[0].url, 'https://x/#/board');
});
