import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../web/public/js/markdown.js';
import { markdownBlocks } from '../src/md-pdf.js';

const blocks = (md) => markdownBlocks(renderMarkdown(md));

test('Überschrift wird zum Block mit Stufe', () => {
  assert.deepEqual(blocks('# Titel'), [{ type: 'heading', level: 2, runs: [{ text: 'Titel' }] }]);
});

test('Hervorhebungen werden zu Runs', () => {
  const [p] = blocks('**a** _b_ ~~c~~ `d`');
  assert.equal(p.type, 'paragraph');
  assert.deepEqual(p.runs.filter((r) => r.text.trim()), [
    { text: 'a', bold: true }, { text: 'b', italic: true }, { text: 'c', strike: true }, { text: 'd', code: true },
  ]);
});

test('Aufgabenliste behält den Haken', () => {
  const [list] = blocks('- [x] erledigt\n- [ ] offen');
  assert.equal(list.type, 'list');
  assert.equal(list.ordered, false);
  assert.equal(list.items[0].checked, true);
  assert.equal(list.items[1].checked, false);
  assert.equal(list.items[0].blocks[0].runs.map((r) => r.text).join('').trim(), 'erledigt');
});

test('Verschachtelte und nummerierte Listen', () => {
  const [list] = blocks('1. a\n2. b\n   - tief');
  assert.equal(list.ordered, true);
  assert.equal(list.items[1].blocks.at(-1).type, 'list');
});

test('Tabelle mit Kopf und Zeilen', () => {
  const [table] = blocks('| A | B |\n|---|---|\n| 1 | **2** |');
  assert.equal(table.type, 'table');
  assert.deepEqual(table.head.map((cell) => cell.map((r) => r.text).join('')), ['A', 'B']);
  assert.deepEqual(table.rows[0][1], [{ text: '2', bold: true }]);
});

test('Hinweis-Kasten wird zum Zitat mit Art', () => {
  const [quote] = blocks('> [!WARNING]\n> Achtung');
  assert.equal(quote.type, 'quote');
  assert.equal(quote.kind, 'warning');
  assert.equal(quote.blocks.map((b) => b.runs.map((r) => r.text).join('')).join(' '), 'Achtung');
});

test('Link behält die Adresse', () => {
  const [p] = blocks('[Link](https://example.com)');
  assert.deepEqual(p.runs, [{ text: 'Link', link: 'https://example.com' }]);
});

test('Entities werden dekodiert, Zeilenumbruch bleibt', () => {
  const [p] = blocks('a & b\nc');
  assert.equal(p.runs.map((r) => r.text).join(''), 'a & b\nc');
});

test('Codeblock und Trennlinie', () => {
  const out = blocks('```\nx<1\n```\n\n---');
  assert.deepEqual(out, [{ type: 'code', text: 'x<1' }, { type: 'rule' }]);
});

test('Fußnoten landen am Ende ohne Zurück-Knopf', () => {
  const out = blocks('Text[^1]\n\n[^1]: Fuß');
  const all = JSON.stringify(out);
  assert.ok(!all.includes('↩'));
  assert.ok(all.includes('Fuß'));
});
