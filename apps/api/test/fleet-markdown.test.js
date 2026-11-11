import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetMarkdown } from '../src/fleet-markdown.js';

const item = (plate, km, service, kit, acc, note = '', model = '') => ({
  plate, model, odometer_km: km, last_service_on: service, first_aid_kit_until: kit, accessories_complete: acc, note,
});

test('fleetMarkdown reproduziert die Vorlage', () => {
  const md = fleetMarkdown({ checked_on: '2026-11-07', done: true }, [
    { name: 'Tailgater 2', show_model: false, items: [
      item('30 0V91M', 13394, '2026-11-08', '2026-11-25', true),
      item('30 PIVFH', 5546, '2026-10-17', '2026-11-25', true),
    ] },
    { name: 'Sonstige Fahrzeuge', show_model: true, items: [
      item('30 RQF0Y', 3450, '2026-10-24', '2026-11-25', false, 'fallschirme', 'Buzzard Heli'),
    ] },
  ]);
  assert.equal(md, `Stand: 07.11.2026

Erledigt?: ✔️

### Tailgater 2

|Kennzeichen|KM Stand|Letzte Wartung|Verbandkasten|Zubehör vollst.|Notizen|
|---|---|---|---|---|---|
|30 0V91M|13394|08.11.2026|25.11.26|✔️||
|30 PIVFH|5546|17.10.2026|25.11.26|✔️||

### Sonstige Fahrzeuge

|Kennzeichen|Fahrzeug|KM-Stand|Letzte Wartung|Verbandkasten|Zubehör vollst.|Notizen|
|---|---|---|---|---|---|---|
|30 RQF0Y|Buzzard Heli|3450|24.10.2026|25.11.26||fallschirme|
`);
});

test('fleetMarkdown: nicht erledigt lässt das Feld leer', () => {
  const md = fleetMarkdown({ checked_on: '2026-11-07', done: false }, []);
  assert.ok(md.split('\n').includes('Erledigt?:'));
});

test('fleetMarkdown maskiert Tabellenzeichen und Umbrüche in Notizen', () => {
  const md = fleetMarkdown({ checked_on: '2026-11-07', done: true }, [
    { name: 'A', show_model: false, items: [item('X 1', null, null, null, false, 'a|b\nc')] },
  ]);
  assert.ok(md.includes('|X 1|||||a\\|b c|'));
});

test('fleetMarkdown lässt leere Abschnitte weg', () => {
  const md = fleetMarkdown({ checked_on: '2026-11-07', done: true }, [{ name: 'Leer', show_model: false, items: [] }]);
  assert.ok(!md.includes('### Leer'));
});

test('fleetMarkdown: Backslash am Ende einer Notiz bricht die Zeile nicht', () => {
  const md = fleetMarkdown({ checked_on: '2026-11-07', done: true }, [
    { name: 'A', show_model: false, items: [item('X 1', 1, null, null, true, 'ende\\')] },
  ]);
  assert.ok(md.includes('|X 1|1|||✔️|ende\\\\|'), md);
});
