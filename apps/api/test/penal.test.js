import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, readPenalCsv } from '../src/penal.js';

test('amounts as written in Excel', () => {
  assert.equal(parseAmount('1.500,00'), 1500);
  assert.equal(parseAmount('1500,5'), 1500.5);
  assert.equal(parseAmount('1500.50'), 1500.5);
  assert.equal(parseAmount('12.000'), 12000);
  assert.equal(parseAmount('250 €'), 250);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('viel'), null);
  assert.equal(parseAmount('1,234,5'), null);
});

test('penal code CSV: columns by name, units in jail, errors with line numbers', () => {
  const { entries, errors } = readPenalCsv('Paragraph;Bezeichnung;Kategorie;Geldstrafe;Haft;Punkte\n§ 242;Diebstahl;Vergehen;1.500,00;10 HE;\n§ 1 StVO;Rücksichtslosigkeit;Ordnungswidrigkeit;250;;1\n§ 242;Doppelt;;;;\n;Ohne Paragraph;;;;\n§ 3;Teuer;;viel;;\n§ 4;Haft;;;-1;');
  assert.deepEqual(entries.map((e) => [e.code, e.title, e.category, e.fine, e.jail, e.points]), [
    ['§ 242', 'Diebstahl', 'Vergehen', '1500.00', 10, 0],
    ['§ 1 StVO', 'Rücksichtslosigkeit', 'Ordnungswidrigkeit', '250.00', 0, 1],
  ]);
  assert.deepEqual(errors.map((e) => e.line), [4, 5, 6, 7]);
  assert.match(errors.map((e) => e.message).join(' | '), /mehrfach.*Pflicht.*kein Betrag.*keine ganze Zahl/);
});

test('penal code CSV needs code and title columns', () => {
  assert.throws(() => readPenalCsv('Name;Preis\nA;1'), /Paragraph/);
  assert.throws(() => readPenalCsv(''), /leer/);
  assert.equal(readPenalCsv('code,title,fine\nA1,Test,"1.000,50"').entries[0].fine, '1000.50');
});
