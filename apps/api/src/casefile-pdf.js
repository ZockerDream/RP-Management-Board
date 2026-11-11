// Akten und Berichte als PDF (Wunsch des Auftraggebers vom 2026-11-11). Der Kopf der Akte ist immer ganz enthalten,
// die übrigen Teile sind wählbar. Welche Inhalte hineinkommen, entscheidet allein pdfSections (Unit-Test); gesetzt
// wird mit pdfkit. Markdown-Texte kommen über renderMarkdown (markdown.js) und markdownBlocks (md-pdf.js) formatiert
// ins PDF. Ohne Datenbank: Rechte prüft die Route, bevor sie die Daten hierher gibt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import PDFDocument from 'pdfkit';
import { markdownBlocks } from './md-pdf.js';

const staticRoot = process.env.STATIC_DIR || fileURLToPath(new URL('../../web/public', import.meta.url));
const { renderMarkdown } = await import(pathToFileURL(path.join(staticRoot, 'js/markdown.js')).href);

export const PDF_PARTS = [
  { key: 'people', title: 'Beteiligte Personen' },
  { key: 'vehicles', title: 'Fahrzeuge' },
  { key: 'links', title: 'Verknüpfte Akten' },
  { key: 'entries', title: 'Einträge' },
  { key: 'reports', title: 'Berichte (freigegeben)' },
  { key: 'charges', title: 'Anklagepunkte', feature: 'charges' },
  { key: 'evidence', title: 'Beweismittel' },
  { key: 'warrants', title: 'Fahndungen', feature: 'wanted' },
  { key: 'images', title: 'Bilder' },
  { key: 'attachments', title: 'Anhänge' },
];
const isImage = (a) => /^image\/(png|jpeg)$/.test(a.mime || '');

export function pdfSections(detail, parts, features) {
  const pick = {
    people: () => detail.people || [],
    vehicles: () => detail.vehicles || [],
    links: () => detail.links || [],
    entries: () => [...(detail.entries || [])].sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)) || String(a.created_at).localeCompare(String(b.created_at))),
    reports: () => (detail.reports || []).filter((r) => r.status === 'approved'),
    charges: () => detail.charges || [],
    evidence: () => detail.evidence || [],
    warrants: () => detail.warrants || [],
    images: () => (detail.attachments || []).filter(isImage),
    attachments: () => (detail.attachments || []).filter((a) => !isImage(a)),
  };
  return PDF_PARTS.filter((p) => parts.has(p.key) && (!p.feature || features[p.feature] !== false) && features.files !== false)
    .map((p) => ({ key: p.key, title: p.title, items: pick[p.key]() }));
}

// ---------- Schrift: DejaVu (Umlaute, ✔, ☐) aus dem Image, sonst Helvetica mit WinAnsi-Zeichen
const FONT_DIR = process.env.PDF_FONT_DIR || '/usr/share/fonts/truetype/dejavu';
const FONT_FILES = { R: 'DejaVuSans.ttf', B: 'DejaVuSans-Bold.ttf', I: 'DejaVuSans-Oblique.ttf', BI: 'DejaVuSans-BoldOblique.ttf', M: 'DejaVuSansMono.ttf' };
const FALLBACK = { R: 'Helvetica', B: 'Helvetica-Bold', I: 'Helvetica-Oblique', BI: 'Helvetica-BoldOblique', M: 'Courier' };
const hasDejaVu = () => Object.values(FONT_FILES).every((f) => fs.existsSync(path.join(FONT_DIR, f)));
// Emoji und Variantenwähler kennt keine der Schriften
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const KEEP = new Set(['✔', '☐', '☑']);

function setup(title) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: title, Producer: 'RP-Management-Board' } });
  const unicode = hasDejaVu();
  if (unicode) for (const [k, f] of Object.entries(FONT_FILES)) doc.registerFont(k, path.join(FONT_DIR, f));
  const clean = (s) => {
    const t = String(s ?? '').replace(EMOJI, (c) => (KEEP.has(c) ? c : ''));
    // Helvetica kann nur Latin-1 (WinAnsi); anderes wird zu ?
    return unicode ? t : t.replace(/[✔☑]/g, '[x]').replace(/☐/g, '[ ]').replace(/[^\n\x20-\x7e\xa0-\xff€]/g, '?');
  };
  const font = (k) => doc.font(unicode ? k : FALLBACK[k]);
  font('R');
  return { doc, clean, font };
}

const DE_TZ = process.env.TZ || 'Europe/Berlin';
const fdate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '–');
const fdatetime = (d) => (d ? new Date(d).toLocaleString('de-DE', { timeZone: DE_TZ, dateStyle: 'short', timeStyle: 'short' }) : '–');
const STATUS = { open: 'Offen', dormant: 'Ruhend', closed: 'Abgeschlossen' };
const PRIORITY = { urgent: 'Dringend', high: 'Hoch', normal: 'Normal', low: 'Niedrig' };
const CHARGE_STATUS = { open: 'Offen', convicted: 'Verurteilt', dropped: 'Eingestellt', acquitted: 'Freigesprochen' };
const EVIDENCE_STATUS = { secured: 'Sichergestellt', analysis: 'In Untersuchung', stored: 'Eingelagert', released: 'Herausgegeben', destroyed: 'Vernichtet' };
const WARRANT_STATUS = { active: 'Aktiv', executed: 'Vollstreckt', revoked: 'Aufgehoben' };
const WARRANT_KIND = { arrest: 'Haftbefehl', search: 'Durchsuchungsbeschluss', wanted: 'Fahndung (Aufenthalt)', vehicle: 'Fahrzeugfahndung' };
const PERSON_KIND = { employee: 'Mitarbeiter', external: 'Extern', family: 'Familie' };
const REPORT_STATUS = { draft: 'Entwurf', submitted: 'Eingereicht', approved: 'Freigegeben' };
const ALERT = { note: 'Hinweis', tip: 'Tipp', important: 'Wichtig', warning: 'Warnung', caution: 'Achtung' };
const ALERT_COLOR = { note: '#2563eb', tip: '#16a34a', important: '#7c3aed', warning: '#d97706', caution: '#dc2626' };
const money = (v) => Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---------- Setzen
function writer(ctx) {
  const { doc, clean, font } = ctx;
  const left = doc.page.margins.left;
  const fullWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage(); };

  const runFont = (r) => (r.code ? 'M' : r.bold && r.italic ? 'BI' : r.bold ? 'B' : r.italic ? 'I' : 'R');
  function runsText(runs, { indent = 0, fontSize = 10.5, bold = false } = {}) {
    const list = runs.filter((r) => r.text);
    if (!list.length) return;
    ensure(fontSize * 1.6);
    const x = left + indent, width = fullWidth() - indent;
    list.forEach((r, i) => {
      font(runFont(bold ? { ...r, bold: true } : r)).fontSize(r.code ? fontSize - 1 : fontSize).fillColor(r.link ? '#1d4ed8' : '#111');
      const opts = { continued: i < list.length - 1, strike: !!r.strike, underline: !!r.link, link: r.link || null, lineGap: 2 };
      if (i === 0) doc.text(clean(r.text), x, doc.y, { ...opts, width });
      else doc.text(clean(r.text), opts);
    });
    font('R').fillColor('#111');
  }
  const plain = (cell) => cell.map((r) => r.text).join('');

  function blocks(list, indent = 0) {
    for (const b of list) {
      if (b.type === 'heading') { doc.moveDown(0.3); runsText(b.runs, { indent, fontSize: b.level <= 2 ? 13 : b.level === 3 ? 12 : 11, bold: true }); doc.moveDown(0.2); }
      else if (b.type === 'paragraph') { runsText(b.runs, { indent }); doc.moveDown(0.35); }
      else if (b.type === 'rule') { ensure(10); doc.moveTo(left + indent, doc.y + 3).lineTo(left + fullWidth(), doc.y + 3).strokeColor('#bbb').lineWidth(0.5).stroke(); doc.moveDown(0.6); }
      else if (b.type === 'code') {
        ensure(24);
        const y0 = doc.y;
        font('M').fontSize(9).fillColor('#222').text(clean(b.text), left + indent + 8, doc.y, { width: fullWidth() - indent - 8, lineGap: 1 });
        doc.moveTo(left + indent + 2, y0).lineTo(left + indent + 2, doc.y).strokeColor('#999').lineWidth(2).stroke();
        font('R').fontSize(10.5).fillColor('#111');
        doc.moveDown(0.4);
      } else if (b.type === 'list') {
        b.items.forEach((item, i) => {
          ensure(16);
          const mark = item.checked === true ? '☑' : item.checked === false ? '☐' : b.ordered ? `${i + 1}.` : '•';
          const y = doc.y;
          font('R').fontSize(10.5).text(clean(mark), left + indent, y, { width: 16 });
          doc.y = y;
          blocks(item.blocks.length ? item.blocks : [{ type: 'paragraph', runs: [{ text: ' ' }] }], indent + 18);
          if (doc.y < y + 13) doc.y = y + 13;
        });
        doc.moveDown(0.2);
      } else if (b.type === 'quote') {
        ensure(20);
        const y0 = doc.y, startPage = doc.bufferedPageRange().count;
        if (b.kind) { runsText([{ text: b.title || ALERT[b.kind] || 'Hinweis' }], { indent: indent + 12, bold: true }); }
        blocks(b.blocks, indent + 12);
        // Den Balken nur zeichnen, wenn der Block auf einer Seite geblieben ist
        if (doc.bufferedPageRange().count === startPage) doc.moveTo(left + indent + 3, y0).lineTo(left + indent + 3, doc.y - 4).strokeColor(ALERT_COLOR[b.kind] || '#999').lineWidth(2.5).stroke();
        doc.strokeColor('#111');
      } else if (b.type === 'table') table(b.head.map(plain), b.rows.map((row) => row.map(plain)), indent);
    }
  }

  function table(head, rows, indent = 0) {
    const cols = Math.max(head.length, ...rows.map((r) => r.length), 1);
    const w = (fullWidth() - indent) / cols;
    const rowHeight = (cells, bold) => {
      font(bold ? 'B' : 'R').fontSize(9.5);
      return Math.max(14, ...cells.map((c) => doc.heightOfString(clean(c) || ' ', { width: w - 8 }) + 6));
    };
    const drawRow = (cells, bold) => {
      const h = rowHeight(cells, bold);
      if (doc.y + h > bottom()) { doc.addPage(); if (!bold && head.length) drawRow(head, true); }
      const y = doc.y;
      font(bold ? 'B' : 'R').fontSize(9.5).fillColor('#111');
      for (let i = 0; i < cols; i++) {
        const x = left + indent + i * w;
        doc.rect(x, y, w, h).strokeColor('#ccc').lineWidth(0.5).stroke();
        doc.text(clean(cells[i] ?? ''), x + 4, y + 3, { width: w - 8 });
      }
      doc.x = left; doc.y = y + h;
    };
    if (head.length) drawRow(head, true);
    for (const r of rows) drawRow(r, false);
    font('R').fontSize(10.5);
    doc.x = left;
    doc.moveDown(0.5);
  }

  const markdown = (src, indent = 0) => { if (String(src ?? '').trim()) blocks(markdownBlocks(renderMarkdown(src)), indent); };
  const title = (text, sub) => {
    font('B').fontSize(18).fillColor('#111').text(clean(text), left, doc.y, { width: fullWidth() });
    if (sub) font('R').fontSize(12).fillColor('#444').text(clean(sub), { width: fullWidth() });
    font('R').fontSize(10.5).fillColor('#111');
    doc.moveDown(0.6);
  };
  const section = (text) => {
    ensure(40);
    doc.moveDown(0.6);
    font('B').fontSize(13.5).fillColor('#111').text(clean(text), left, doc.y, { width: fullWidth() });
    doc.moveTo(left, doc.y + 1).lineTo(left + fullWidth(), doc.y + 1).strokeColor('#999').lineWidth(0.7).stroke();
    font('R').fontSize(10.5);
    doc.moveDown(0.5);
  };
  const sub = (text, extra) => {
    ensure(30);
    font('B').fontSize(11).text(clean(text), left, doc.y, { width: fullWidth(), continued: !!extra });
    if (extra) font('R').fillColor('#555').text(clean(`  ${extra}`));
    font('R').fontSize(10.5).fillColor('#111');
  };
  const pairs = (list) => table([], list.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  const line = (text, opts = {}) => { ensure(14); font(opts.bold ? 'B' : 'R').fontSize(opts.size || 10.5).fillColor(opts.color || '#111').text(clean(text), left + (opts.indent || 0), doc.y, { width: fullWidth() - (opts.indent || 0) }); font('R').fillColor('#111'); };
  const empty = () => line('Keine Einträge.', { color: '#777' });
  const stamp = (text) => { font('B').fontSize(22).fillColor('#dc2626').text(clean(text), left, doc.y, { width: fullWidth(), align: 'center' }); font('R').fontSize(10.5).fillColor('#111'); doc.moveDown(0.4); };
  return { doc, blocks, table, markdown, title, section, sub, pairs, line, empty, stamp, ensure, fullWidth, left };
}

function footer(ctx, exportedBy) {
  const { doc, clean, font } = ctx;
  const range = doc.bufferedPageRange();
  const stampText = `Exportiert am ${fdatetime(new Date())} von ${exportedBy}`;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    font('R').fontSize(8).fillColor('#666')
      .text(clean(`${stampText} · Seite ${i + 1} von ${range.count}`), doc.page.margins.left, doc.page.height - 32, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
}

function reportBody(w, r) {
  w.pairs([
    ['Art', r.kind], ['Zeitpunkt', r.occurred_at ? fdatetime(r.occurred_at) : null], ['Verfasser', r.author_name], ['Status', REPORT_STATUS[r.status] || r.status],
    ['Freigabe', r.approved_by_name ? `${r.approved_by_name}, ${fdatetime(r.approved_at)}` : null], ['Ergänzt Bericht', r.amends_number ? `Nr. ${r.amends_number}` : null],
    ['Beteiligte', (r.people || []).map((p) => p.name).join(', ')],
  ]);
  w.markdown(r.body);
}

// ---------- Ganze Akte. files: Map Anhang-ID → Dateipfad für eingebettete Bilder
export function caseFilePdf(detail, { parts, features, exportedBy, files = new Map() }) {
  const ctx = setup(`Akte ${detail.file_number}`);
  const w = writer(ctx);
  w.title(`Akte ${detail.file_number}`, detail.title);
  w.pairs([
    ['Aktenzeichen', detail.file_number], ['Titel', detail.title], ['Aktenart', detail.type_name || '–'], ['Bereich', detail.team_name || 'Solo'],
    ['Status', STATUS[detail.status] || detail.status], ['Priorität', PRIORITY[detail.priority] || detail.priority], ['Ort', detail.location || '–'],
    ['Tatzeit', detail.incident_at ? fdatetime(detail.incident_at) : '–'], ['Eröffnet am', fdate(detail.opened_on)], ['Abgeschlossen am', detail.closed_on ? fdate(detail.closed_on) : '–'],
    ['Sachbearbeitung', detail.lead_name || '–'], ['Beschränkt', detail.restricted ? 'Ja' : 'Nein'],
  ]);
  w.section('Sachverhalt');
  if (String(detail.description || '').trim()) w.markdown(detail.description); else w.empty();

  for (const s of pdfSections(detail, parts, features)) {
    w.section(s.title);
    if (!s.items.length) { w.empty(); continue; }
    const render = {
      people: () => w.table(['Name', 'Rolle', 'Art'], s.items.map((p) => [p.name || '–', p.role || '', PERSON_KIND[p.kind] || p.kind || ''])),
      vehicles: () => w.table(['Kennzeichen', 'Beschreibung', 'Rolle', 'Halter', 'Notiz'], s.items.map((v) => [v.plate || '–', v.description || '', v.role || '', v.owner_name || '', v.note || ''])),
      links: () => w.table(['Aktenzeichen', 'Titel', 'Status', 'Notiz'], s.items.map((l) => [l.file_number, l.title, STATUS[l.status] || l.status, l.note || ''])),
      entries: () => s.items.forEach((e) => {
        w.sub(fdate(e.entry_date), [e.kind, e.person_name && `betrifft ${e.person_name}`, e.created_by_name && `von ${e.created_by_name}`].filter(Boolean).join(' · '));
        w.markdown(e.body, 0);
        ctx.doc.moveDown(0.3);
      }),
      reports: () => s.items.forEach((r) => { w.sub(`Bericht Nr. ${r.number}: ${r.title}`); reportBody(w, r); ctx.doc.moveDown(0.4); }),
      charges: () => w.table(['Person', 'Tatbestand', 'Anzahl', 'Geldstrafe', 'Haft (HE)', 'Status'], s.items.map((c) => [
        c.person_name || '–', `${c.code} ${c.title}`, String(c.count), money(Number(c.fine) * c.count), String(c.jail * c.count), `${CHARGE_STATUS[c.status] || c.status}${c.note ? `\n${c.note}` : ''}`,
      ])),
      evidence: () => s.items.forEach((ev) => {
        w.sub(`Nr. ${ev.number}: ${ev.description}`, EVIDENCE_STATUS[ev.status] || ev.status);
        w.pairs([['Art', ev.kind], ['Gefunden', [ev.found_at && fdatetime(ev.found_at), ev.found_where].filter(Boolean).join(', ')], ['Person', ev.person_name], ['Lagerort', ev.storage], ['Notiz', ev.note]]);
        const log = Array.isArray(ev.log) ? ev.log : [];
        if (log.length) w.table(['Zeit', 'Übergabe', 'Notiz', 'Durch'], log.map((l) => [fdatetime(l.at), l.action, l.note || '', l.user_name || '']));
      }),
      warrants: () => w.table(['Art', 'Gegen', 'Grund', 'Ausgestellt', 'Gültig bis', 'Status'], s.items.map((x) => [
        WARRANT_KIND[x.kind] || x.kind, x.person_name || x.plate || '–', x.reason, fdate(x.issued_on), x.valid_until ? fdate(x.valid_until) : '–', `${WARRANT_STATUS[x.status] || x.status}${x.close_note ? `\n${x.close_note}` : ''}`,
      ])),
      images: () => s.items.forEach((a) => {
        const file = files.get(a.id);
        w.ensure(220);
        try {
          if (!file || !fs.existsSync(file)) throw new Error('fehlt');
          ctx.doc.image(file, w.left, ctx.doc.y, { fit: [w.fullWidth(), 300] });
        } catch {
          w.line(`Bild nicht verfügbar: ${a.original_name}`, { color: '#b91c1c' });
        }
        w.line(a.caption || a.original_name, { size: 9.5, color: '#444' });
        ctx.doc.moveDown(0.6);
      }),
      attachments: () => w.table(['Datei', 'Größe', 'Hochgeladen'], s.items.map((a) => [a.original_name, size(a.size), `${fdatetime(a.created_at)}${a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}`])),
    };
    render[s.key]();
  }
  footer(ctx, exportedBy);
  ctx.doc.end();
  return ctx.doc;
}

// ---------- Einzelner Bericht
export function reportPdf(report, file, { exportedBy }) {
  const ctx = setup(`Bericht ${file.file_number}-${report.number}`);
  const w = writer(ctx);
  w.title(`Bericht Nr. ${report.number}: ${report.title}`, `Akte ${file.file_number} – ${file.title}`);
  if (report.status === 'draft') w.stamp('ENTWURF');
  else if (report.status !== 'approved') w.stamp('NICHT FREIGEGEBEN');
  reportBody(w, report);
  footer(ctx, exportedBy);
  ctx.doc.end();
  return ctx.doc;
}
