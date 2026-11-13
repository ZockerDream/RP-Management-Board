import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotals, lineTotal, cashDifference } from '../src/invoices.js';

test('invoiceTotals rechnet in Cent ohne Rundungsfehler', () => {
  const r = invoiceTotals([{ text: 'Reparatur', qty: '1', price: '199.99' }, { text: 'Arbeitszeit', qty: '1,5', price: '80' }, { text: 'Schrauben', qty: 3, price: '0.10' }]);
  assert.equal(r.total, '320.29');
  assert.deepEqual(r.items.map((i) => i.line), ['199.99', '120.00', '0.30']);
});

test('lineTotal rundet kaufmännisch', () => {
  assert.equal(lineTotal('0.5', '0.05'), 3n);
  assert.equal(lineTotal('1.25', '1.11'), 139n);
});

test('ungültige Positionen', () => {
  assert.throws(() => invoiceTotals([]), /Mindestens/);
  assert.throws(() => invoiceTotals([{ text: 'x', qty: '0', price: '1' }]), /Menge/);
  assert.throws(() => invoiceTotals([{ text: 'x', qty: '1', price: '1.234' }]), /Betrag/);
  assert.throws(() => invoiceTotals([{ text: 'x', qty: '1', price: '-5' }]), /Negative/);
  assert.throws(() => invoiceTotals([{ text: ' ', qty: '1', price: '5' }]), /Bezeichnung/);
});

test('cashDifference', () => {
  assert.equal(cashDifference('100.00', '102.50'), '-2.50');
  assert.equal(cashDifference('100', '100'), '0.00');
  assert.equal(cashDifference('150.1', '100'), '50.10');
});
