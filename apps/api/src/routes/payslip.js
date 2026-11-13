// Lohnzettel als PDF (Wunsch des Auftraggebers vom 2026-11-13): Gehaltsbuchungen eines Monats (Festgehalt und Bonus)
// aus payroll_payments. Den eigenen bekommt jeder; den eines Mitglieds, wer in einer gemeinsamen Organisation beim
// Stundenzettel „Lesen & Schreiben“ hat (wie für Zeiten und Gehalt der Mitglieder).
import { z } from 'zod';
import { one, many } from '../db.js';
import { requireAuth, forbidden, notFound } from '../authz.js';
import { audit } from '../audit.js';
import { uuid } from '../records.js';
import { getSetting } from '../settings.js';
import { pdfDoc, table } from '../pdf-doc.js';
import { fdateDe, moneyDe } from '../lib-format.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export default async function routes(app) {
  app.get('/work-hours/payslip.pdf', requireAuth, async (req, reply) => {
    const f = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), user_id: uuid.optional() }).parse(req.query);
    const userId = f.user_id || req.user.id;
    if (userId !== req.user.id) {
      const shared = await one(
        `SELECT 1 FROM team_members a JOIN team_members b ON b.team_id=a.team_id AND b.user_id=$2
         WHERE a.user_id=$1 AND team_level(a.team_id, $1, 'work') >= 3 LIMIT 1`, [req.user.id, userId]);
      if (!shared) throw forbidden('Den Lohnzettel anderer sieht nur, wer ihre Zeiten bearbeiten darf');
    }
    const user = await one('SELECT id, name, currency, daily_salary, hourly_bonus_percent, weekly_work_hours FROM users WHERE id=$1', [userId]);
    if (!user) throw notFound('Benutzer nicht gefunden');
    const from = `${f.month}-01`;
    const rows = await many(
      `SELECT p.payroll_date::text d, p.base_amount, p.overtime_hours, p.overtime_pay, b.name budget_name
       FROM payroll_payments p LEFT JOIN budgets b ON b.id=p.budget_id
       WHERE p.user_id=$1 AND p.payroll_date >= $2::date AND p.payroll_date < ($2::date + interval '1 month') ORDER BY p.payroll_date`, [userId, from]);
    const sum = (k) => rows.reduce((a, r) => a + Math.round(Number(r[k]) * 100), 0) / 100;
    const base = sum('base_amount'), bonus = sum('overtime_pay'), hours = rows.reduce((a, r) => a + Number(r.overtime_hours), 0);
    const m = (v) => moneyDe(v, user.currency || 'EUR');
    const [y, mo] = f.month.split('-');
    const { doc, F, clean } = pdfDoc(`Lohnzettel ${f.month}`);
    doc.font(F.B).fontSize(16).text(clean(await getSetting('general.app_name') || 'RP-Management-Board'));
    doc.font(F.R).fontSize(9).fillColor('#666').text(clean(`Erstellt am ${fdateDe(new Date().toISOString())}`)).fillColor('#000');
    doc.moveDown(1.2);
    doc.font(F.B).fontSize(14).text(clean(`Lohnzettel ${MONTHS[Number(mo) - 1]} ${y}`));
    doc.font(F.R).fontSize(10).text(clean(user.name));
    doc.text(clean(`Festgehalt pro Tag: ${m(user.daily_salary)} · Wochen-Soll: ${Number(user.weekly_work_hours).toLocaleString('de-DE')} Std. · Bonus je Stunde über dem Soll: ${Number(user.hourly_bonus_percent).toLocaleString('de-DE')} %`));
    doc.moveDown();
    if (rows.length) {
      table(doc, F, clean, [{ label: 'Datum', width: 80 }, { label: 'Konto', width: 150 }, { label: 'Festgehalt', width: 85, align: 'right' }, { label: 'Bonus-Std.', width: 70, align: 'right' }, { label: 'Bonus', width: 55, align: 'right' }, { label: 'Summe', width: 55, align: 'right' }],
        rows.map((r) => [fdateDe(r.d), r.budget_name || '–', m(r.base_amount), Number(r.overtime_hours).toLocaleString('de-DE', { maximumFractionDigits: 2 }), m(r.overtime_pay), m(Number(r.base_amount) + Number(r.overtime_pay))]));
    } else doc.text(clean('In diesem Monat gab es keine Gehaltsbuchungen.'));
    doc.moveDown();
    doc.font(F.B).fontSize(11);
    doc.text(clean(`Festgehalt: ${m(base)}`), 50, doc.y, { width: 495, align: 'right' });
    doc.text(clean(`Bonus (${hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.): ${m(bonus)}`), 50, doc.y, { width: 495, align: 'right' });
    doc.text(clean(`Gesamt: ${m(base + bonus)}`), 50, doc.y, { width: 495, align: 'right' });
    doc.end();
    if (userId !== req.user.id) await audit(req, 'payslip.exported', 'user', userId, { month: f.month });
    reply.type('application/pdf').header('content-disposition', `attachment; filename="lohnzettel-${f.month}.pdf"`);
    return doc;
  });
}
