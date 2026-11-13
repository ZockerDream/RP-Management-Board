// Kasse (Wunsch des Auftraggebers vom 2026-11-13): Eine Kasse ist ein Konto der Organisation. Kassenbuchungen sind
// normale Buchungen dort (Quelle „cash“), der Tagesabschluss vergleicht gezähltes Bargeld mit dem Kontostand und bucht
// eine Differenz als Kassenfehlbetrag oder -überschuss. Funktion „cash“: 2 sehen, 3 buchen und abschließen (auch ohne
// eigenes Buchungsrecht auf dem Konto – die Kasse gibt es weiter), 4 Kassen anlegen und löschen.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, budgetAccess } from '../authz.js';
import { LEVEL } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDate } from '../records.js';
import { today, budgetWatch } from '../lib.js';
import { teamFor, loadTeamRow } from '../orgfeature.js';
import { cashDifference } from '../invoices.js';

const amount = z.union([z.number(), z.string()]).transform((v) => String(v).trim().replace(',', '.')).pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Betrag ungültig'));
// Kontostand wie überall: Einnahmen minus Ausgaben bis heute, Sparziel-Einzahlungen zählen nicht
const balanceSql = `COALESCE(sum(CASE WHEN type='income' THEN amount WHEN type='expense' THEN -amount ELSE 0 END) FILTER (WHERE booked_at <= $2), 0)`;
const balanceOf = async (budgetId) => (await one(`SELECT ${balanceSql}::numeric(14,2)::text b FROM transactions WHERE budget_id=$1`, [budgetId, today()])).b;

export default async function routes(app) {
  app.get('/cash', authz('cash:read'), async (req) => {
    const { team_id: teamId } = z.object({ team_id: uuid }).parse(req.query);
    const level = await teamFor(req, teamId, 'cash', LEVEL.READ);
    const registers = await many(
      `SELECT r.*, b.name budget_name, b.currency,
         (SELECT ${balanceSql} FROM transactions t WHERE t.budget_id=r.budget_id)::numeric(14,2)::text balance,
         (SELECT row_to_json(x) FROM (SELECT c.closed_on, c.counted, c.difference, u.name by_name FROM cash_closings c LEFT JOIN users u ON u.id=c.created_by
            WHERE c.register_id=r.id ORDER BY c.created_at DESC LIMIT 1) x) last_closing
       FROM cash_registers r JOIN budgets b ON b.id=r.budget_id WHERE r.team_id=$1 ORDER BY r.name`, [teamId, today()]);
    return { level, registers };
  });

  app.post('/cash-registers', authz('cash:create'), async (req) => {
    const b = z.object({ team_id: uuid, name: z.string().trim().min(1).max(100), budget_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, 'cash', LEVEL.MANAGE);
    const { budget } = await budgetAccess(req.user.id, b.budget_id, true);
    if (budget.team_id !== b.team_id) throw bad('Eine Kasse braucht ein Konto dieser Organisation');
    try {
      const row = await one('INSERT INTO cash_registers(team_id, name, budget_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [b.team_id, b.name, budget.id, req.user.id]);
      await audit(req, 'cash.register_created', 'cash_register', row.id, { name: b.name });
      return row;
    } catch (e) {
      if (e.code === '23505') throw bad('Für dieses Konto gibt es schon eine Kasse');
      throw e;
    }
  });
  app.delete('/cash-registers/:id', authz('cash:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'cash_registers', uuid.parse(req.params.id), 'cash', LEVEL.MANAGE);
    await q('DELETE FROM cash_registers WHERE id=$1', [row.id]);
    await audit(req, 'cash.register_deleted', 'cash_register', row.id, { name: row.name });
    return { ok: true };
  });

  // Buchungen eines Tages (alle des Kontos, nicht nur aus der Kasse) und die Abschlüsse
  app.get('/cash-registers/:id', authz('cash:read'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'cash_registers', uuid.parse(req.params.id), 'cash', LEVEL.READ);
    const { date } = z.object({ date: isoDate.optional() }).parse(req.query);
    const day = date || today();
    const [entries, closings, balance] = await Promise.all([
      many(`SELECT t.id, t.type, t.amount, t.title, t.source, t.booked_at, t.created_at, u.name created_by_name FROM transactions t LEFT JOIN users u ON u.id=t.created_by
        WHERE t.budget_id=$1 AND t.booked_at=$2 AND t.type IN ('income','expense') ORDER BY t.created_at`, [row.budget_id, day]),
      many(`SELECT c.*, u.name created_by_name FROM cash_closings c LEFT JOIN users u ON u.id=c.created_by WHERE c.register_id=$1 ORDER BY c.created_at DESC LIMIT 60`, [row.id]),
      balanceOf(row.budget_id),
    ]);
    return { ...row, level, date: day, entries, closings, balance };
  });

  app.post('/cash-registers/:id/entries', authz('cash:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'cash_registers', uuid.parse(req.params.id), 'cash', LEVEL.WRITE);
    const b = z.object({ type: z.enum(['income', 'expense']), amount, title: z.string().trim().min(1).max(200) }).parse(req.body);
    if (Number(b.amount) <= 0) throw bad('Betrag muss größer als 0 sein');
    const t = await one(`INSERT INTO transactions(budget_id, created_by, type, amount, booked_at, title, source, income_kind) VALUES ($1,$2,$3,$4,$5,$6,'cash',$7) RETURNING id`,
      [row.budget_id, req.user.id, b.type, b.amount, today(), b.title, 'other']);
    if (b.type === 'expense') await budgetWatch(row.budget_id, req.log);
    return { id: t.id };
  });

  // Tagesabschluss: Differenz zum Kontostand wird gebucht, damit Konto und Kasse wieder übereinstimmen
  app.post('/cash-registers/:id/close', authz('cash:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'cash_registers', uuid.parse(req.params.id), 'cash', LEVEL.WRITE);
    const b = z.object({ counted: amount, note: z.string().trim().max(1000).default('') }).parse(req.body);
    const result = await tx(async (c) => {
      // Sperre je Kasse, damit zwei gleichzeitige Abschlüsse nicht doppelt buchen
      await c.query('SELECT id FROM cash_registers WHERE id=$1 FOR UPDATE', [row.id]);
      const expected = (await c.query(`SELECT ${balanceSql}::numeric(14,2)::text b FROM transactions WHERE budget_id=$1`, [row.budget_id, today()])).rows[0].b;
      const difference = cashDifference(b.counted, expected);
      let transactionId = null;
      if (Number(difference) !== 0) {
        const neg = difference.startsWith('-');
        transactionId = (await c.query(`INSERT INTO transactions(budget_id, created_by, type, amount, booked_at, title, source, income_kind) VALUES ($1,$2,$3,$4,$5,$6,'cash',$7) RETURNING id`,
          [row.budget_id, req.user.id, neg ? 'expense' : 'income', neg ? difference.slice(1) : difference, today(), neg ? 'Kassenfehlbetrag (Tagesabschluss)' : 'Kassenüberschuss (Tagesabschluss)', 'other'])).rows[0].id;
      }
      const closing = (await c.query(`INSERT INTO cash_closings(register_id, team_id, closed_on, expected, counted, difference, transaction_id, note, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [row.id, row.team_id, today(), expected, b.counted, difference, transactionId, b.note, req.user.id])).rows[0];
      return { id: closing.id, expected, counted: b.counted, difference };
    });
    await audit(req, 'cash.closed', 'cash_register', row.id, { difference: result.difference });
    return result;
  });
}
