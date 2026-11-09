import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { patchSchema, validationMessage } from '../src/validation.js';

const message = (schema, input) => validationMessage(schema.safeParse(input).error.issues);

test('a patch keeps absent fields absent', () => {
  const schema = z.object({ note: z.string().default(''), tags: z.array(z.string()).default([]), kind: z.enum(['a', 'b']).default('a'), title: z.string() });
  assert.deepEqual(patchSchema(schema).parse({}), {});
  assert.deepEqual(patchSchema(schema).parse({ title: 'x' }), { title: 'x' });
  assert.deepEqual(patchSchema(schema).parse({ note: '' }), { note: '' });
});

test('a patch still validates the values it receives', () => {
  const schema = z.object({ hours: z.number().max(24).default(1) });
  assert.equal(patchSchema(schema).safeParse({ hours: 25 }).success, false);
});

test('messages name the field in German', () => {
  assert.equal(message(z.object({ title: z.string().min(1) }), { title: '' }), 'Titel darf nicht leer sein');
  assert.equal(message(z.object({ title: z.string().min(5) }), { title: 'abc' }), 'Titel muss mindestens 5 Zeichen lang sein');
  assert.equal(message(z.object({ title: z.string().max(3) }), { title: 'abcd' }), 'Titel darf höchstens 3 Zeichen lang sein');
  assert.equal(message(z.object({ hours: z.number().max(24) }), { hours: 25 }), 'Stunden darf höchstens 24 sein');
  assert.equal(message(z.object({ email: z.string().email() }), { email: 'x' }), 'E-Mail ist keine gültige E-Mail-Adresse');
  assert.equal(message(z.object({ title: z.string() }), {}), 'Titel fehlt');
  assert.equal(message(z.object({ team_id: z.string().uuid() }), { team_id: 'x' }), 'Organisation hat kein gültiges Format');
  assert.equal(message(z.object({ amount: z.number().multipleOf(0.01) }), { amount: 1.234 }), 'Betrag hat zu viele Nachkommastellen');
});

test('list positions count from one', () => {
  assert.equal(message(z.object({ recipients: z.array(z.string().email()) }), { recipients: ['a@b.de', 'x'] }), 'Empfänger 2 ist keine gültige E-Mail-Adresse');
});

test('own messages stay as written', () => {
  assert.equal(message(z.object({ amount: z.string().refine(() => false, 'Ungültiger Betrag') }), { amount: 'x' }), 'Betrag: Ungültiger Betrag');
  assert.equal(message(z.object({ a: z.string() }).refine(() => false, 'Haus oder Fahrzeug erforderlich'), { a: 'x' }), 'Haus oder Fahrzeug erforderlich');
});

test('unknown fields never show their technical key', () => {
  assert.equal(message(z.object({ geheimes_feld: z.string() }), { geheimes_feld: 1 }), 'Eingabe ist ungültig');
});

test('several problems are listed', () => {
  assert.equal(message(z.object({ title: z.string(), name: z.string() }), {}), 'Titel fehlt; Name fehlt');
});
