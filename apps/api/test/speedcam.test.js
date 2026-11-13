import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overSpeed, ticketEntryBody, localParts } from '../src/speedcam.js';

test('overSpeed zieht die Toleranz ab und wird nie negativ', () => {
  assert.equal(overSpeed({ measured_kmh: 80, tolerance_kmh: 3, speed_limit: 50 }), 27);
  assert.equal(overSpeed({ measured_kmh: 52, tolerance_kmh: 3, speed_limit: 50 }), 0);
});

test('localParts rechnet in die Zeitzone um', () => {
  assert.deepEqual(localParts('2026-11-12T23:30:00Z', 'Europe/Berlin'), { date: '2026-11-13', text: '13.11.2026 00:30' });
});

test('ticketEntryBody enthält die Eckdaten und entschärft Markdown', () => {
  const body = ticketEntryBody({
    number: 'B-2026-1', measured_at: '2026-11-12T10:00:00Z', camera_name: 'Highway | Nord', camera_location: '', plate: 'LS*1',
    measured_kmh: 130, speed_limit: 100, tolerance_kmh: 3, amount: '250.00', status: 'open', note: '',
  }, { timeZone: 'UTC' });
  assert.match(body, /\*\*Blitzer-Rechnung B-2026-1\*\*/);
  assert.match(body, /\|Standort\|Highway \\\| Nord\|/);
  assert.match(body, /\|Kennzeichen\|LS\\\*1\|/);
  assert.match(body, /\|Überschreitung\|27 km\/h\|/);
  assert.match(body, /\|Zeitpunkt\|12\.11\.2026 10:00\|/);
  assert.match(body, /250,00/);
});
