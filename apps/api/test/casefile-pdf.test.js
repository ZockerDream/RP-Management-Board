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

// ---------- Layout: nichts ragt über den Seitenrand (Funde der Schlussprüfung)
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caseFilePdf } from '../src/casefile-pdf.js';

function pngFile(w = 200, h = 120) {
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]));
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-')), 'bild.png');
  fs.writeFileSync(file, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
  return file;
}
const base = { file_number: '2026-1', title: 'T', status: 'open', priority: 'normal' };
const spy = (calls) => (doc) => {
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  for (const name of ['rect', 'image']) {
    const orig = doc[name].bind(doc);
    doc[name] = (...args) => { calls.push({ name, args, bottom: bottom(), top: doc.page.margins.top, y: doc.y }); return orig(...args); };
  }
};

test('Tabellenzeile höher als eine Seite ragt nicht über den Rand', () => {
  const calls = [];
  caseFilePdf({ ...base, warrants: [{ kind: 'arrest', person_name: 'Max', reason: 'Sehr langer Grund. '.repeat(110), issued_on: '2026-11-01', status: 'active' }] },
    { parts: new Set(['warrants']), features: {}, exportedBy: 'x', onDoc: spy(calls) });
  const rects = calls.filter((c) => c.name === 'rect');
  assert.ok(rects.length > 0);
  for (const r of rects) assert.ok(r.args[1] + r.args[3] <= r.bottom + 0.5, `Zelle endet bei ${r.args[1] + r.args[3]}, Seitenende ${r.bottom}`);
});

test('Bilder ragen nie in den unteren Rand', () => {
  const file = pngFile();
  for (let lines = 0; lines < 60; lines += 3) {
    const calls = [];
    caseFilePdf({ ...base, description: Array.from({ length: lines }, (_, i) => `Zeile ${i}`).join('\n\n'), attachments: [{ id: 'i', mime: 'image/png', original_name: 'b.png', caption: 'Bild' }] },
      { parts: new Set(['images']), features: {}, exportedBy: 'x', files: new Map([['i', file]]), onDoc: spy(calls) });
    for (const c of calls.filter((x) => x.name === 'image')) {
      const top = c.args[2];
      assert.ok(top + 300 + 14 <= c.bottom + 0.5, `${lines} Zeilen: Bild bei ${top} bis ${top + 300}, Seitenende ${c.bottom}`);
    }
  }
});
