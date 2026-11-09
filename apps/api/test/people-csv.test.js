import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, CsvError } from '../src/csv.js';
import { peopleCsv, readPeopleCsv, planPeopleImport, MAX_IMPORT_ROWS } from '../src/people.js';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const existing = [
  { id: ID1, name: 'Max Muster', kind: 'external', function: 'Zeuge', phone: '+49 170 1', email: 'max@example.com', active: true, note: 'Zeile 1\nZeile 2; mit "Zitat"' },
  { id: ID2, name: 'Erika Beispiel', kind: 'family', function: '', phone: '', email: '', active: false, note: '=SUMME(A1)' },
];
const plan = (text, list = existing, canUpdate = true) => planPeopleImport(readPeopleCsv(text).rows, list, { canUpdate });

test('parseCsv reads quotes, doubled quotes, line breaks in fields and all line endings', () => {
  const { delimiter, rows } = parseCsv('﻿a;b;c\r\n"x;1";"he said ""hi""";"zwei\nZeilen"\r3;;\n4;5;6');
  assert.equal(delimiter, ';');
  assert.deepEqual(rows.map((r) => r.cells), [['a', 'b', 'c'], ['x;1', 'he said "hi"', 'zwei\nZeilen'], ['3', '', ''], ['4', '5', '6']]);
  // Die Zeilennummer zählt Umbrüche in Feldern mit, damit Fehlermeldungen auf die richtige Zeile zeigen
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 4, 5]);
});

test('parseCsv detects comma and tab and rejects an open quote', () => {
  assert.equal(parseCsv('Name,Art\nA,B').delimiter, ',');
  assert.equal(parseCsv('Name\tArt\nA\tB').delimiter, '\t');
  assert.equal(parseCsv('"Name;Teil",Art\nA,B').delimiter, ',');
  assert.equal(parseCsv('Name\nA').delimiter, ';');
  assert.throws(() => parseCsv('Name\n"offen'), (e) => e instanceof CsvError && /Zeile 2/.test(e.message));
});

test('export and re-import is a no-op, including guarded formulas, quotes and line breaks', () => {
  const csv = peopleCsv(existing);
  assert.match(csv, /^﻿ID;Name;Art;Funktion;Telefon;E-Mail;Aktiv;Notiz\r\n/);
  assert.match(csv, /;Extern;/);
  assert.match(csv, /'\+49 170 1/, 'Telefonnummern mit + werden wie alle Exporte gegen Formeln geschützt');
  assert.match(csv, /'=SUMME/);
  const result = plan(csv);
  assert.equal(result.unchanged, 2, JSON.stringify(result.problems));
  assert.deepEqual([result.create.length, result.update.length, result.errors, result.skipped], [0, 0, 0, 0]);
});

test('rows with ID update only changed fields; rows without ID create, existing names are skipped', () => {
  const result = plan(`ID;Name;Funktion;Aktiv\n${ID1};Max Muster;Beschuldigter;ja\n${ID2};Erika Beispiel;;JA\n;Neu Person;Fahrer;nein\n;max muster;x;\n;Neu Person;y;`);
  assert.deepEqual(result.update, [{ line: 2, id: ID1, changes: { function: 'Beschuldigter' } }, { line: 3, id: ID2, changes: { active: true } }]);
  assert.equal(result.create.length, 1);
  assert.deepEqual(result.create[0], { line: 4, name: 'Neu Person', kind: 'employee', function: 'Fahrer', phone: '', email: '', active: false, note: '' });
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.problems.map((p) => [p.line, p.kind]), [[5, 'skipped'], [6, 'skipped']]);
});

test('missing columns stay unchanged, headers are matched loosely and unknown ones reported', () => {
  const read = readPeopleCsv(`id,NAME,e-mail,Lieblingsfarbe\n${ID1},Max Muster,neu@example.com,blau`);
  assert.deepEqual(read.columns, ['id', 'name', 'email']);
  assert.deepEqual(read.ignored, ['Lieblingsfarbe']);
  const result = planPeopleImport(read.rows, existing, { canUpdate: true });
  assert.deepEqual(result.update[0].changes, { email: 'neu@example.com' });
});

test('invalid rows become errors with line numbers and German messages', () => {
  const result = plan(`Name;Art;Aktiv;E-Mail;ID\n;Extern;;;\nA;Polizist;;;\nB;;vielleicht;;\nC;;;keine-mail;\nD;;;;nicht-uuid\nE;;;;${'3'.repeat(8)}-3333-4333-8333-333333333333\n${'x'.repeat(101)};;;;`);
  assert.equal(result.errors, 7);
  assert.deepEqual(result.problems.map((p) => p.line), [2, 3, 4, 5, 6, 7, 8]);
  const messages = result.problems.map((p) => p.message).join(' | ');
  for (const part of ['Name darf nicht leer sein', 'Art „Polizist“ ist unbekannt', 'Aktiv „vielleicht“', 'E-Mail ist keine gültige E-Mail-Adresse', 'ID „nicht-uuid“ ist ungültig', 'Keine Person mit dieser ID', 'Name darf höchstens 100 Zeichen']) {
    assert.ok(messages.includes(part), `${part} in ${messages}`);
  }
});

test('without update right only unchanged rows with ID pass', () => {
  const result = plan(`ID;Name;Funktion\n${ID1};Max Muster;Zeuge\n${ID2};Erika Beispiel;Neu\n;Ganz Neu;`, existing, false);
  assert.equal(result.unchanged, 1);
  assert.equal(result.update.length, 0);
  assert.equal(result.create.length, 1);
  assert.deepEqual(result.problems.map((p) => [p.line, p.kind]), [[3, 'error']]);
});

test('duplicate IDs, empty files, missing name column and too many rows are rejected', () => {
  assert.deepEqual(plan(`ID;Name\n${ID1};Max Muster\n${ID1};Max Muster`).problems.map((p) => p.line), [3]);
  assert.throws(() => readPeopleCsv(''), /leer/);
  assert.throws(() => readPeopleCsv('\n\n'), /leer/);
  assert.throws(() => readPeopleCsv('Vorname;Nachname\nA;B'), /Spalte „Name“/);
  const many = `Name\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i}`).join('\n')}`;
  assert.throws(() => readPeopleCsv(many), /Höchstens/);
  // Leerzeilen zählen nicht
  assert.equal(readPeopleCsv('Name\n\nA\n;\n').rows.length, 1);
});

test('toCsv still guards formulas for the other exports', () => {
  assert.equal(toCsv([{ a: '=1+1', b: 'x;y' }], ['a', 'b']), '﻿a;b\r\n\'=1+1;"x;y"\r\n');
});
