// Zeiten im Sport (Wunsch des Auftraggebers vom 2026-11-12): Format MM:SS:hh, also Minuten, Sekunden und Hundertstel.
// Gespeichert wird in Millisekunden; eine dritte Nachkommastelle ist erlaubt und erscheint nur, wenn sie gesetzt ist.
// Ohne DOM, damit apps/api/test/sport-time.test.js es prüfen kann.

export const MAX_SPORT_MS = 24 * 60 * 60 * 1000;
export const SPORT_TIME_HINT = 'Zeit im Format MM:SS:hh angeben (Minuten:Sekunden:Hundertstel), z. B. 12:34:56';

export function formatSportTime(ms) {
  if (ms == null || ms === '') return '–';
  const total = Number(ms);
  const minutes = Math.floor(total / 60000), seconds = Math.floor((total % 60000) / 1000), rest = total % 1000;
  const fraction = rest % 10 ? String(rest).padStart(3, '0') : String(rest / 10).padStart(2, '0');
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${fraction}`;
}

// „12:34:56“ = 12 min 34,56 s; die letzte Gruppe sind Nachkommastellen (1–3 Ziffern, „5“ = 0,5 s, „050“ = 0,05 s).
// Auch „12:34.56“ und „12:34,56“ gehen. Ohne dritte Gruppe („12:34“) zählen nur Minuten und Sekunden.
export function parseSportTime(text) {
  const value = String(text ?? '').trim();
  const match = /^(\d{1,4}):(\d{1,2})(?:[:.,](\d{1,3}))?$/.exec(value);
  if (!match) throw new Error(SPORT_TIME_HINT);
  const [, minutes, seconds, fraction = ''] = match;
  if (Number(seconds) > 59) throw new Error('Sekunden dürfen höchstens 59 sein');
  const ms = Number(minutes) * 60000 + Number(seconds) * 1000 + (fraction ? Number(fraction.padEnd(3, '0')) : 0);
  if (ms > MAX_SPORT_MS) throw new Error('Zeit darf höchstens 24 Stunden (1440:00:00) sein');
  return ms;
}
