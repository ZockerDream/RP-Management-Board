// Auswahl der Organisation für die Seiten ab 2026-11-13 (Pinnwand, Dienstplan, Einsätze, Personal, Lager, Rechnungen,
// Kasse). Die letzte Wahl merkt sich der Browser je Seite.
import { api } from '../api.js';
import { esc, empty } from '../ui.js';

export async function loadTeams(module, min = 2) {
  return api.get(`/org-teams?module=${module}&min=${min}`);
}
export function pickTeam(teams, storageKey, wanted) {
  let saved = null;
  try { saved = localStorage.getItem(`org.${storageKey}`); } catch { /* ohne Speicher */ }
  const id = [wanted, saved].find((x) => x && teams.some((t) => t.id === x)) || teams[0]?.id || null;
  return id;
}
export function rememberTeam(storageKey, id) {
  try { localStorage.setItem(`org.${storageKey}`, id); } catch { /* ohne Speicher */ }
}
export const teamSelect = (teams, sel, id = 'org-team') => (teams.length > 1
  ? `<select id="${id}" aria-label="Organisation">${teams.map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`
  : teams.length ? `<span class="tag shared">${esc(teams[0].name)}</span>` : '');
export const noTeam = (what) => `<div class="card">${empty(`Du bist in keiner Organisation, in der du ${what} siehst. Rechte dafür vergibt die Leitung unter „Organisationen → Rechte“.`)}</div>`;
