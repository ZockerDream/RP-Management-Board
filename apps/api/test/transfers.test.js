import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTransfer } from '../src/transfers.js';

const me = 'u-me';
const from = { id: 'b-from', currency: 'EUR', archived: false };
const own = (extra = {}) => ({ id: 'b-own', currency: 'EUR', type: 'solo', owner_user_id: me, team_id: null, archived: false, level: 4, ...extra });
const teamBudget = (level, extra = {}) => ({ id: 'b-team', currency: 'EUR', type: 'shared', owner_user_id: null, team_id: 't1', archived: false, level, ...extra });
const fails = (input, message) => assert.throws(() => planTransfer(input), (e) => e.statusCode === 400 && e.message === message);

test('eigenes Konto: direkt', () => {
  assert.deepEqual(planTransfer({ me, from, target: { kind: 'own', budget: own() } }), { mode: 'direct' });
});
test('eigenes Konto: gleiches Konto abgelehnt', () => {
  fails({ me, from, target: { kind: 'own', budget: own({ id: 'b-from' }) } }, 'Quell- und Zielkonto sind gleich');
});
test('eigenes Konto: andere Währung abgelehnt', () => {
  fails({ me, from, target: { kind: 'own', budget: own({ currency: 'USD' }) } }, 'Beide Konten brauchen dieselbe Währung');
});
test('eigenes Konto: fremdes persönliches Konto abgelehnt', () => {
  fails({ me, from, target: { kind: 'own', budget: own({ owner_user_id: 'u-other' }) } }, 'Das ist nicht dein persönliches Konto');
});
test('eigenes Konto: archiviert abgelehnt', () => {
  fails({ me, from, target: { kind: 'own', budget: own({ archived: true }) } }, 'Zielkonto ist archiviert');
});
test('Organisation: mit Lesen & Schreiben direkt, sonst Annahme', () => {
  assert.deepEqual(planTransfer({ me, from, target: { kind: 'team', budget: teamBudget(3), isMember: true } }), { mode: 'direct' });
  assert.deepEqual(planTransfer({ me, from, target: { kind: 'team', budget: teamBudget(2), isMember: true } }), { mode: 'pending' });
  assert.deepEqual(planTransfer({ me, from, target: { kind: 'team', budget: teamBudget(0), isMember: true } }), { mode: 'pending' });
});
test('Organisation: nur als Mitglied', () => {
  fails({ me, from, target: { kind: 'team', budget: teamBudget(0), isMember: false } }, 'Du bist in dieser Organisation kein Mitglied');
});
test('Organisation: andere Währung abgelehnt', () => {
  fails({ me, from, target: { kind: 'team', budget: teamBudget(3, { currency: 'USD' }), isMember: true } }, 'Beide Konten brauchen dieselbe Währung');
});
test('Benutzer: immer Annahme', () => {
  assert.deepEqual(planTransfer({ me, from, target: { kind: 'user', user: { id: 'u-x', active: true } } }), { mode: 'pending' });
});
test('Benutzer: nicht an sich selbst', () => {
  fails({ me, from, target: { kind: 'user', user: { id: me, active: true } } }, 'An dich selbst bitte als eigenes Konto umbuchen');
});
test('Benutzer: unbekannt oder inaktiv', () => {
  fails({ me, from, target: { kind: 'user', user: null } }, 'Benutzer nicht gefunden');
  fails({ me, from, target: { kind: 'user', user: { id: 'u-x', active: false } } }, 'Benutzer nicht gefunden');
});
test('Quelle archiviert abgelehnt', () => {
  fails({ me, from: { ...from, archived: true }, target: { kind: 'own', budget: own() } }, 'Quellkonto ist archiviert');
});
