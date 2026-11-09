// Gemeinsame Regeln für Datensätze, die privat sind oder einer Organisation (team) gehören (Akten, Schulungen, Lizenzen, Dokumentationen)
import { z } from 'zod';
import { one } from './db.js';
import { bad } from './authz.js';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Ungültiges Datum');
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');

// Personen sind global (Migration 019): Jede vorhandene Person darf in jedem Bereich verwendet werden
export async function assertPerson(personId) {
  const person = await one('SELECT id, name, active FROM people WHERE id=$1', [personId]);
  if (!person) throw bad('Person nicht gefunden');
  return person;
}

// Benutzer als Teilnehmer: in einer Organisation jedes Mitglied, privat nur die Person selbst
export async function assertUserInScope(userId, scope) {
  const ok = scope.team_id
    ? await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2', [scope.team_id, userId])
    : userId === scope.owner_user_id;
  if (!ok) throw bad(scope.team_id ? 'Benutzer ist nicht Mitglied dieser Organisation' : 'Privat kann nur die eigene Teilnahme erfasst werden');
}

// Die Person, die ein Datensatz betrifft: Wer den Datensatz sieht, sieht auch ihren Namen
export const personJoin = (alias, column) => `LEFT JOIN people ${alias} ON ${alias}.id=${column}`;
