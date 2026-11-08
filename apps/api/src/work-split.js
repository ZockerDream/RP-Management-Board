// Schichten über Mitternacht: Stunden zählen an dem Kalendertag, an dem sie gearbeitet wurden.
// Ein Eintrag gehört immer zu genau einem Tag; eine Schicht von 22:00 bis 02:00 wird zu 22:00–00:00 und 00:00–02:00.
import { nextDate } from './payroll.js';

const DAY_MINUTES = 1440;
export const MAX_TIMER_SECONDS = 24 * 3600;

const toMinutes = (time) => {
  const [hours, minutes] = String(time).slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

// Verteilt eine Gesamtmenge anteilig auf Teile. Kumulativ gerundet, damit die Summe der Teile exakt die Gesamtmenge ergibt.
export function apportion(total, weights, scale) {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) return weights.map((_, index) => (index === 0 ? total : 0));
  let cumulative = 0;
  let previous = 0;
  return weights.map((weight) => {
    cumulative += weight;
    const current = Math.round((total * scale * cumulative) / sum);
    const part = current - previous;
    previous = current;
    return part / scale;
  });
}

// Manuelle Einträge: Ende vor Beginn heißt über Mitternacht. Stunden und Pause werden nach der Dauer vor und nach 0 Uhr aufgeteilt.
export function splitManualEntry(entry) {
  if (!entry.started_at || !entry.ended_at) return [entry];
  const start = toMinutes(entry.started_at);
  const end = toMinutes(entry.ended_at);
  // Ende 00:00 heißt „bis Mitternacht“: bleibt ein Eintrag am Starttag
  if (end >= start || end === 0) return [entry];
  const weights = [DAY_MINUTES - start, end];
  const [firstHours, secondHours] = apportion(Number(entry.hours), weights, 100);
  const [firstBreak, secondBreak] = apportion(Number(entry.break_minutes || 0), weights, 1);
  return [
    { ...entry, ended_at: '00:00', hours: firstHours, break_minutes: firstBreak },
    { ...entry, work_date: nextDate(entry.work_date), started_at: '00:00', hours: secondHours, break_minutes: secondBreak },
  ].filter((part) => part.hours > 0);
}

function zonedParts(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, parts };
}

// Zeitpunkt von 0:00 Uhr Ortszeit an einem Datum (zweimal angenähert, damit Sommer- und Winterzeit stimmen)
export function zonedMidnight(date, timeZone) {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offset = (ms) => {
    const { parts } = zonedParts(ms, timeZone);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

// Timer: Teilt die Zeit an jeder Mitternacht (Ortszeit). Eine noch laufende Pause wird genau dort abgezogen, wo sie lag;
// frühere Pausen kennen nur ihre Summe und werden anteilig verteilt.
export function splitTimer({ startedAt, stoppedAt, pausedSeconds = 0, pausedAt = null, timeZone }) {
  const start = new Date(startedAt).getTime();
  const stop = new Date(stoppedAt).getTime();
  const pauseStart = pausedAt ? Math.min(stop, Math.max(start, new Date(pausedAt).getTime())) : stop;
  const segments = [];
  let segmentStart = start;
  let day = zonedParts(start, timeZone).date;
  for (let guard = 0; guard < 400; guard++) {
    const midnight = zonedMidnight(nextDate(day), timeZone);
    if (midnight >= stop) break;
    segments.push([segmentStart, midnight]);
    segmentStart = midnight;
    day = nextDate(day);
  }
  segments.push([segmentStart, stop]);

  const overlap = (from, to) => Math.max(0, Math.min(to, stop) - Math.max(from, pauseStart)) / 1000;
  const available = segments.map(([from, to]) => (to - from) / 1000 - overlap(from, to));
  const earlierPause = apportion(Math.max(0, pausedSeconds), available, 1);
  const net = available.map((seconds, index) => Math.max(0, seconds - earlierPause[index]));
  const pause = segments.map(([from, to], index) => overlap(from, to) + earlierPause[index]);
  const hours = apportion(net.reduce((acc, seconds) => acc + seconds, 0) / 3600, net, 100);
  const breaks = apportion(pause.reduce((acc, seconds) => acc + seconds, 0) / 60, pause, 1);

  return segments.map(([from, to], index) => {
    const begin = zonedParts(from, timeZone);
    const end = zonedParts(to, timeZone);
    return { work_date: begin.date, started_at: begin.time, ended_at: end.time, hours: hours[index], break_minutes: breaks[index] };
  }).filter((part) => part.hours > 0);
}

export const localDateTime = (ms, timeZone) => {
  const { date, time } = zonedParts(ms, timeZone);
  return { date, time };
};
