import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSportTime, parseSportTime, MAX_SPORT_MS } from '../../web/public/js/sport-time.js';

test('Zeit lesen: Minuten, Sekunden, Hundertstel', () => {
  assert.equal(parseSportTime('12:34:56'), 12 * 60000 + 34000 + 560);
  assert.equal(parseSportTime('00:00:00'), 0);
  assert.equal(parseSportTime(' 1:05:7 '), 65700);
  assert.equal(parseSportTime('01:05:007'), 65007);
  assert.equal(parseSportTime('01:05.25'), 65250);
  assert.equal(parseSportTime('01:05,25'), 65250);
  assert.equal(parseSportTime('90:00'), 90 * 60000);
  assert.equal(parseSportTime('1440:00:00'), MAX_SPORT_MS);
});

test('Zeit lesen: ungültige Eingaben', () => {
  for (const bad of ['', 'abc', '12', '12:60:00', '1:2:3:4', '12:34:5678', '-1:00:00', '1440:00:01', '12:3a:00']) {
    assert.throws(() => parseSportTime(bad), undefined, bad);
  }
});

test('Zeit anzeigen als MM:SS:hh', () => {
  assert.equal(formatSportTime(0), '00:00:00');
  assert.equal(formatSportTime(754560), '12:34:56');
  assert.equal(formatSportTime(65007), '01:05:007');
  assert.equal(formatSportTime(65700), '01:05:70');
  assert.equal(formatSportTime(125 * 60000), '125:00:00');
  assert.equal(formatSportTime(null), '–');
  for (const ms of [0, 1, 999, 754560, 65007, MAX_SPORT_MS]) assert.equal(parseSportTime(formatSportTime(ms)), ms);
});
