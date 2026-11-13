// Rechnungen und Angebote (Wünsche des Auftraggebers vom 2026-11-13) für Firmen im RP: an Personen, Organisationen
// oder Freitext, Positionen, PDF. Rechnungen werden nur „bezahlt“ markiert: dann entsteht die Einnahme auf einem Konto
// der Organisation. Funktion „invoices“: 2 sehen, 3 schreiben und bezahlt markieren (dazu Buchen auf dem Konto),
// 4 stornieren und löschen.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, budgetAccess } from '../authz.js';
import { LEVEL } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDate } from '../records.js';
import { today } from '../lib.js';
import { teamFor, loadTeamRow, teamName } from '../orgfeature.js';
import { discord } from '../discord-send.js';
import { invoiceTotals } from '../invoices.js';
import { pdfDoc, table } from '../pdf-doc.js';
import { fdateDe, moneyDe } from '../lib-format.js';

export const INVOICE_STATUS = { draft: 'Entwurf', open: 'Offen', paid: 'Bezahlt', cancelled: 'Storniert', accepted: 'Angenommen', declined: 'Abgelehnt' };
const item = z.object({ text: z.string().trim().min(1).max(300), qty: z.union([z.number(), z.string()]), price: z.union([z.number(), z.string()]) });
const fields = z.object({
  recipient_kind: z.enum(['person', 'team', 'text']),
  recipient_person_id: uuid.nullish(), recipient_team_id: uuid.nullish(),
  recipient_name: z.string().trim().max(200).default(''), recipient_address: z.string().trim().max(500).default(''),
  items: z.array(item).min(1).max(100),
  issued_on: isoDate.optional(), due_on: isoDate.nullish(), note: z.string().max(2000).default(''),
});

// Empfänger auflösen: Name als Kopie vom Ausstellungstag
async function recipient(b) {
  if (b.recipient_kind === 'person') {
    const p = b.recipient_person_id && await one('SELECT name, address FROM people WHERE id=$1', [b.recipient_person_id]);
    if (!p) throw bad('Person nicht gefunden');
    return { person: b.recipient_person_id, team: null, name: p.name, address: b.recipient_address || p.address || '' };
  }
  if (b.recipient_kind === 'team') {
    const t = b.recipient_team_id && await one('SELECT name FROM teams WHERE id=$1', [b.recipient_team_id]);
    if (!t) throw bad('Organisation nicht gefunden');
    return { person: null, team: b.recipient_team_id, name: t.name, address: b.recipient_address };
  }
  if (!b.recipient_name) throw bad('Empfänger fehlt');
  return { person: null, team: null, name: b.recipient_name, address: b.recipient_address };
}
const totals = (items) => { try { return invoiceTotals(items); } catch (e) { throw bad(e.message); } };

export default async function routes(app) {
  app.get('/invoices', authz('invoice:read'), async (req) => {
    const f = z.object({ team_id: uuid, kind: z.enum(['invoice', 'offer']).optional(), status: z.enum(Object.keys(INVOICE_STATUS)).optional() }).parse(req.query);
    const level = await teamFor(req, f.team_id, 'invoices', LEVEL.READ);
    const items = await many(
      `SELECT i.id, i.kind, i.number, i.recipient_kind, i.recipient_name, i.total, i.currency, i.issued_on, i.due_on, i.status, i.paid_at, i.offer_id,
         (i.status='open' AND i.due_on IS NOT NULL AND i.due_on < CURRENT_DATE) overdue, b.name paid_budget_name, u.name created_by_name
       FROM invoices i LEFT JOIN budgets b ON b.id=i.paid_budget_id LEFT JOIN users u ON u.id=i.created_by
       WHERE i.team_id=$1 AND ($2::text IS NULL OR i.kind=$2) AND ($3::text IS NULL OR i.status=$3)
       ORDER BY i.issued_on DESC, i.number DESC LIMIT 1000`, [f.team_id, f.kind || null, f.status || null]);
    return { level, items };
  });

  app.get('/invoices/:id', authz('invoice:read'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'invoices', uuid.parse(req.params.id), 'invoices', LEVEL.READ);
    return { ...row, level };
  });

  app.post('/invoices', authz('invoice:create'), async (req) => {
    const b = fields.extend({ team_id: uuid, kind: z.enum(['invoice', 'offer']).default('invoice'), issue: z.boolean().default(false) }).parse(req.body);
    await teamFor(req, b.team_id, 'invoices', LEVEL.WRITE);
    const r = await recipient(b);
    const t = totals(b.items);
    const me = await one('SELECT currency FROM users WHERE id=$1', [req.user.id]);
    const prefix = b.kind === 'offer' ? 'A' : 'R';
    const row = await one(
      `INSERT INTO invoices(team_id, kind, number, recipient_kind, recipient_person_id, recipient_team_id, recipient_name, recipient_address, items, total, currency, issued_on, due_on, status, note, created_by)
       VALUES ($1,$2,$3 || '-' || to_char(now(), 'YYYY') || '-' || lpad(nextval($4::regclass)::text, 4, '0'),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id, number`,
      [b.team_id, b.kind, prefix, b.kind === 'offer' ? 'offer_seq' : 'invoice_seq', b.recipient_kind, r.person, r.team, r.name, r.address, JSON.stringify(t.items), t.total,
        me?.currency || 'EUR', b.issued_on || today(), b.due_on || null, b.issue ? 'open' : 'draft', b.note, req.user.id],
    );
    await audit(req, `${b.kind}.created`, 'invoice', row.id, { number: row.number, total: t.total });
    return row;
  });

  app.patch('/invoices/:id', authz('invoice:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'invoices', uuid.parse(req.params.id), 'invoices', LEVEL.WRITE);
    if (!['draft', 'open'].includes(row.status)) throw bad('Nur Entwürfe und offene Rechnungen oder Angebote lassen sich ändern');
    const b = fields.parse({ ...row, items: row.items, ...req.body });
    const r = await recipient(b);
    const t = totals(b.items);
    await q(`UPDATE invoices SET recipient_kind=$2, recipient_person_id=$3, recipient_team_id=$4, recipient_name=$5, recipient_address=$6, items=$7, total=$8,
      issued_on=$9, due_on=$10, note=$11, updated_at=now() WHERE id=$1`,
      [row.id, b.recipient_kind, r.person, r.team, r.name, r.address, JSON.stringify(t.items), t.total, b.issued_on || row.issued_on, b.due_on || null, b.note]);
    return { ok: true };
  });

  // Status: Entwurf → offen; Angebot angenommen/abgelehnt; stornieren (Verwalten)
  app.post('/invoices/:id/status', authz('invoice:update'), async (req) => {
    const { status } = z.object({ status: z.enum(['open', 'accepted', 'declined', 'cancelled']) }).parse(req.body);
    const { row } = await loadTeamRow(req, 'invoices', uuid.parse(req.params.id), 'invoices', status === 'cancelled' ? LEVEL.MANAGE : LEVEL.WRITE);
    const allowed = {
      open: row.status === 'draft',
      accepted: row.kind === 'offer' && row.status === 'open',
      declined: row.kind === 'offer' && row.status === 'open',
      cancelled: ['draft', 'open'].includes(row.status),
    };
    if (!allowed[status]) throw bad(`Von „${INVOICE_STATUS[row.status]}“ geht es nicht nach „${INVOICE_STATUS[status]}“`);
    await q('UPDATE invoices SET status=$2, updated_at=now() WHERE id=$1', [row.id, status]);
    await audit(req, `invoice.${status}`, 'invoice', row.id, { number: row.number });
    return { ok: true };
  });

  // Bezahlt markieren: Einnahme auf einem Konto dieser Organisation (Buchen dort nötig), genau einmal
  app.post('/invoices/:id/paid', authz('invoice:update', 'transaction:create'), async (req) => {
    const { row } = await loadTeamRow(req, 'invoices', uuid.parse(req.params.id), 'invoices', LEVEL.WRITE);
    if (row.kind !== 'invoice') throw bad('Nur Rechnungen werden bezahlt');
    if (!['open', 'draft'].includes(row.status)) throw bad(`Die Rechnung ist ${INVOICE_STATUS[row.status].toLowerCase()}`);
    const b = z.object({ budget_id: uuid, category_id: uuid.nullish(), paid_on: isoDate.optional() }).parse(req.body);
    const { budget } = await budgetAccess(req.user.id, b.budget_id, true);
    if (budget.team_id !== row.team_id) throw bad('Bitte ein Konto dieser Organisation wählen');
    if (b.category_id && !(await one('SELECT 1 FROM categories WHERE id=$1 AND budget_id=$2', [b.category_id, budget.id]))) throw bad('Kategorie gehört nicht zu diesem Konto');
    const done = await tx(async (c) => {
      const upd = await c.query("UPDATE invoices SET status='paid', paid_at=now(), paid_budget_id=$2, updated_at=now() WHERE id=$1 AND status IN ('open','draft') RETURNING id", [row.id, budget.id]);
      if (!upd.rowCount) return null;
      const t = (await c.query(
        `INSERT INTO transactions(budget_id, category_id, created_by, type, amount, booked_at, title, note, source, income_kind)
         VALUES ($1,$2,$3,'income',$4,$5,$6,$7,'invoice','other') RETURNING id`,
        [budget.id, b.category_id || null, req.user.id, row.total, b.paid_on || today(), `Rechnung ${row.number}: ${row.recipient_name}`.slice(0, 200), ''],
      )).rows[0];
      await c.query('UPDATE invoices SET transaction_id=$2 WHERE id=$1', [row.id, t.id]);
      return t;
    });
    if (!done) throw bad('Die Rechnung wurde gerade schon bezahlt');
    discord(row.team_id, 'invoice', { title: `Rechnung ${row.number} bezahlt`, description: `${row.recipient_name}: ${moneyDe(row.total, row.currency)}`, path: 'invoices' }, req.log);
    await audit(req, 'invoice.paid', 'invoice', row.id, { number: row.number, budget: budget.id });
    return { ok: true, transaction_id: done.id };
  });

  // Angebot → neue Rechnung mit denselben Positionen (Entwurf); das Angebot gilt als angenommen
  app.post('/invoices/:id/convert', authz('invoice:create'), async (req) => {
    const { row } = await loadTeamRow(req, 'invoices', uuid.parse(req.params.id), 'invoices', LEVEL.WRITE);
    if (row.kind !== 'offer' || !['open', 'accepted'].includes(row.status)) throw bad('Nur offene oder angenommene Angebote werden zur Rechnung');
    const created = await tx(async (c) => {
      const r = (await c.query(
        `INSERT INTO invoices(team_id, kind, number, recipient_kind, recipient_person_id, recipient_team_id, recipient_name, recipient_address, items, total, currency, issued_on, status, note, offer_id, created_by)
         SELECT team_id, 'invoice', 'R-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0'), recipient_kind, recipient_person_id, recipient_team_id,
           recipient_name, recipient_address, items, total, currency, CURRENT_DATE, 'draft', note, id, $2 FROM invoices WHERE id=$1 RETURNING id, number`, [row.id, req.user.id])).rows[0];
      await c.query("UPDATE invoices SET status='accepted', updated_at=now() WHERE id=$1", [row.id]);
      return r;
    });
    await audit(req, 'offer.converted', 'invoice', row.id, { invoice: created.number });
    return created;
  });

  app.delete('/invoices/:id', authz('invoice:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'invoices', uuid.parse(req.params.id), 'invoices', LEVEL.MANAGE);
    if (row.status === 'paid' || (row.kind === 'invoice' && row.status === 'open')) throw bad('Bezahlte und offene Rechnungen bleiben – storniere stattdessen');
    await q('DELETE FROM invoices WHERE id=$1', [row.id]);
    await audit(req, 'invoice.deleted', 'invoice', row.id, { number: row.number });
    return { ok: true };
  });

  app.get('/invoices/:id/pdf', authz('invoice:read'), async (req, reply) => {
    const { row } = await loadTeamRow(req, 'invoices', uuid.parse(req.params.id), 'invoices', LEVEL.READ);
    const issuer = await teamName(row.team_id);
    const offer = row.kind === 'offer';
    const { doc, F, clean } = pdfDoc(`${offer ? 'Angebot' : 'Rechnung'} ${row.number}`);
    const m = (v) => moneyDe(v, row.currency);
    doc.font(F.B).fontSize(16).text(clean(issuer));
    doc.font(F.R).fontSize(9).fillColor('#666').text(clean(`${offer ? 'Angebot' : 'Rechnung'} ${row.number}`)).fillColor('#000');
    doc.moveDown(1.5);
    doc.fontSize(10).text(clean(row.recipient_name));
    if (row.recipient_address) doc.text(clean(row.recipient_address));
    doc.moveDown(1.5);
    doc.font(F.B).fontSize(14).text(clean(`${offer ? 'Angebot' : 'Rechnung'} ${row.number}`));
    doc.font(F.R).fontSize(10).text(clean(`Datum: ${fdateDe(row.issued_on)}${row.due_on ? ` · ${offer ? 'gültig bis' : 'zahlbar bis'} ${fdateDe(row.due_on)}` : ''}${row.status === 'paid' ? ` · bezahlt am ${fdateDe(new Date(row.paid_at).toISOString())}` : ''}${row.status === 'cancelled' ? ' · STORNIERT' : ''}`));
    doc.moveDown();
    table(doc, F, clean, [{ label: 'Pos.', width: 35 }, { label: 'Bezeichnung', width: 250 }, { label: 'Menge', width: 55, align: 'right' }, { label: 'Einzelpreis', width: 80, align: 'right' }, { label: 'Summe', width: 75, align: 'right' }],
      row.items.map((it, i) => [String(i + 1), it.text, String(it.qty).replace('.', ','), m(it.price), m(it.line)]));
    doc.moveDown(0.5);
    doc.font(F.B).fontSize(11).text(clean(`Gesamt: ${m(row.total)}`), 50, doc.y, { width: 495, align: 'right' });
    if (row.note) { doc.moveDown(); doc.font(F.R).fontSize(10).text(clean(row.note), 50, doc.y, { width: 495 }); }
    doc.end();
    await audit(req, 'invoice.pdf', 'invoice', row.id, { number: row.number });
    reply.type('application/pdf').header('content-disposition', `attachment; filename="${row.number}.pdf"`);
    return doc;
  });
}
