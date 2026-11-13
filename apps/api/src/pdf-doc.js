// Einfache PDF-Dokumente (Rechnung, Lohnzettel) mit DejaVu aus dem Image, sonst Helvetica (nur Latin-1)
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const FONT_DIR = process.env.PDF_FONT_DIR || '/usr/share/fonts/truetype/dejavu';
const FILES = { R: 'DejaVuSans.ttf', B: 'DejaVuSans-Bold.ttf' };
export function pdfDoc(title) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title, Producer: 'RP-Management-Board' } });
  const unicode = Object.values(FILES).every((f) => fs.existsSync(path.join(FONT_DIR, f)));
  if (unicode) for (const [k, f] of Object.entries(FILES)) doc.registerFont(k, path.join(FONT_DIR, f));
  const F = unicode ? { R: 'R', B: 'B' } : { R: 'Helvetica', B: 'Helvetica-Bold' };
  const clean = (s) => (unicode ? String(s ?? '') : String(s ?? '').replace(/[^\n\x20-\x7e\xa0-\xff€]/g, '?'));
  doc.font(F.R);
  return { doc, F, clean };
}
// Tabelle mit festen Spalten; columns: [{ label, width, align }], rows: Arrays von Texten
export function table(doc, F, clean, columns, rows, { startX = 50 } = {}) {
  const header = () => {
    const y = doc.y;
    doc.font(F.B).fontSize(9);
    let x = startX;
    for (const c of columns) { doc.text(clean(c.label), x, y, { width: c.width, align: c.align || 'left', lineBreak: false }); x += c.width; }
    doc.moveTo(startX, y + 13).lineTo(startX + columns.reduce((a, c) => a + c.width, 0), y + 13).strokeColor('#999').stroke();
    doc.y = y + 18;
    doc.font(F.R).fontSize(9);
  };
  header();
  for (const r of rows) {
    if (doc.y > 760) { doc.addPage(); header(); }
    const y = doc.y;
    let x = startX;
    let h = 0;
    r.forEach((cell, i) => {
      const c = columns[i];
      h = Math.max(h, doc.heightOfString(clean(cell), { width: c.width - 4 }));
      doc.text(clean(cell), x, y, { width: c.width - 4, align: c.align || 'left' });
      x += c.width;
    });
    doc.y = y + h + 4;
  }
}
