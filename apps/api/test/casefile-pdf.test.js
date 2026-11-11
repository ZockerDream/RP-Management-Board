import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfSections, PDF_PARTS } from '../src/casefile-pdf.js';

const detail = {
  people: [{ person_id: 'p1', name: 'Max', role: 'Zeuge' }],
  vehicles: [], links: [],
  entries: [
    { id: 'e2', entry_date: '2026-11-02', created_at: '2026-11-02T10:00:00Z', body: 'zwei' },
    { id: 'e1', entry_date: '2026-11-01', created_at: '2026-11-01T10:00:00Z', body: 'eins' },
  ],
  reports: [
    { id: 'r1', number: 1, status: 'approved', title: 'Frei' },
    { id: 'r2', number: 2, status: 'draft', title: 'Entwurf' },
    { id: 'r3', number: 3, status: 'submitted', title: 'Eingereicht' },
  ],
  charges: [{ id: 'c1' }], evidence: [], warrants: [{ id: 'w1' }],
  attachments: [
    { id: 'a1', mime: 'image/png', original_name: 'bild.png' },
    { id: 'a2', mime: 'application/pdf', original_name: 'doc.pdf' },
    { id: 'a3', mime: 'image/jpeg', original_name: 'foto.jpg' },
  ],
};
const allOn = { files: true, wanted: true, codes: true, charges: true, templates: true, types: true };
const keys = (sections) => sections.map((s) => s.key);

test('Teile in fester Reihenfolge', () => {
  assert.deepEqual(PDF_PARTS.map((p) => p.key), ['people', 'vehicles', 'links', 'entries', 'reports', 'charges', 'evidence', 'warrants', 'images', 'attachments']);
});

test('nur freigegebene Berichte', () => {
  const reports = pdfSections(detail, new Set(['reports']), allOn).find((s) => s.key === 'reports');
  assert.deepEqual(reports.items.map((r) => r.id), ['r1']);
});

test('nur gewählte Teile', () => {
  assert.deepEqual(keys(pdfSections(detail, new Set(['people', 'reports']), allOn)), ['people', 'reports']);
});

test('ausgeschaltete Teile fehlen trotz Auswahl', () => {
  const out = pdfSections(detail, new Set(['warrants', 'charges', 'people']), { ...allOn, wanted: false, charges: false });
  assert.deepEqual(keys(out), ['people']);
});

test('Bilder und übrige Anhänge getrennt', () => {
  const out = pdfSections(detail, new Set(['images', 'attachments']), allOn);
  assert.deepEqual(out.find((s) => s.key === 'images').items.map((a) => a.id), ['a1', 'a3']);
  assert.deepEqual(out.find((s) => s.key === 'attachments').items.map((a) => a.id), ['a2']);
});

test('Einträge chronologisch aufsteigend', () => {
  const entries = pdfSections(detail, new Set(['entries']), allOn)[0];
  assert.deepEqual(entries.items.map((e) => e.id), ['e1', 'e2']);
});

test('leere Teile bleiben als Abschnitt mit Hinweis erhalten', () => {
  const out = pdfSections(detail, new Set(['vehicles']), allOn);
  assert.deepEqual(out, [{ key: 'vehicles', title: 'Fahrzeuge', items: [] }]);
});
