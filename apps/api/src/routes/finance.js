import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, budgetAccess, accessibleBudgetIds } from '../authz.js';
import { LEVEL, recordOwner, teamLevel } from '../org.js';
import { addDefaultCategories } from '../seed.js';
import { periodRange, budgetUsed, budgetWatch, toCsv, today, notify } from '../lib.js';
import { audit } from '../audit.js';
import { timelineWindow } from '../periods.js';
import { patchSchema } from '../validation.js';
import { config } from '../config.js';
import { dateInZone } from '../periods.js';
import { INTEREST_PERIODS, nextInterestDate } from '../interest.js';
import { isoDate } from '../records.js';
import { recognizeText } from '../ocr.js';
import { parseStatement } from '../scan.js';
import { HISTORY_WEEKS, weekOf, addDays, historyWeeks, ruleOccurrences, salaryDays, planForecast } from '../forecast.js';

const money = z.union([z.string(), z.number()]).transform((v) => String(v).replace(',', '.')).refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Ungültiger Betrag');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().uuid();

const budgetBody = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['solo', 'shared']),
  team_id: id.nullish(),
  currency: z.string().length(3).optional(),
  period_type: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom', 'goal']).default('monthly'),
  period_start: date.nullish(),
  period_end: date.nullish(),
  limit_amount: money.default('0'),
  // Zinsen (optional): Satz in Prozent je Zeitraum, gutgeschrieben am Ende jedes Zeitraums (interest.js)
  interest_rate: z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(',', '.'))
    .refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && Number(v) > 0 && Number(v) <= 100, 'muss größer als 0 und höchstens 100 sein (bis zu vier Nachkommastellen)').nullish(),
  interest_period: z.enum(INTEREST_PERIODS).nullish(),
});
const localToday = () => dateInZone(config.tz);

// Zinsfelder für INSERT/UPDATE. Beim Einschalten zählt der Saldo ab heute; ein geänderter Satz oder Zeitraum gilt für alles,
// was noch nicht gutgeschrieben ist. Ohne Satz ist der Zins aus.
function interestValues(b, current = null) {
  if (!('interest_rate' in b) && !('interest_period' in b)) return null;
  const rate = 'interest_rate' in b ? b.interest_rate || null : current?.interest_rate ?? null;
  const period = 'interest_period' in b ? b.interest_period || null : current?.interest_period ?? null;
  if (!rate) return { interest_rate: null, interest_period: null, interest_since: null };
  if (!period) throw bad('Zinsen brauchen einen Zeitraum');
  return { interest_rate: rate, interest_period: period, interest_since: current?.interest_since || localToday() };
}

async function decorate(b, level, teamName) {
  const used = await budgetUsed(b);
  const lim = Number(b.limit_amount);
  const cats = await many(
    `SELECT c.id, c.name, c.color, c.limit_amount,
       COALESCE((SELECT sum(amount) FROM transactions t WHERE t.category_id=c.id AND t.type='expense' AND t.booked_at BETWEEN $2 AND $3),0) used
     FROM categories c WHERE c.budget_id=$1 ORDER BY c.name`,
    [b.id, ...periodRange(b)],
  );
  const totals = await one(
    `SELECT COALESCE(sum(amount) FILTER (WHERE type='income'),0) income, COALESCE(sum(amount) FILTER (WHERE type='expense'),0) expenses
     FROM transactions WHERE budget_id=$1 AND booked_at <= $2`,
    [b.id, today()],
  );
  const interest = b.interest_rate
    ? await one("SELECT COALESCE(sum(amount),0) total, max(booked_at) last_on FROM transactions WHERE budget_id=$1 AND source='interest'", [b.id])
    : null;
  return {
    ...b, level, team_name: teamName || null, income: totals.income, expenses: totals.expenses, balance: (Number(totals.income) - Number(totals.expenses)).toFixed(2), used, pct: lim > 0 ? Math.round((Number(used) / lim) * 1000) / 10 : 0, categories: cats,
    interest_total: interest?.total ?? null, interest_last_on: interest?.last_on ?? null,
    interest_next_on: b.interest_rate ? nextInterestDate(localToday(), String(b.interest_since).slice(0, 10), b.interest_period) : null,
  };
}

export default async function routes(app) {
  // ---- Konten
  app.get('/budgets', authz('budget:read'), async (req) => {
    const rows = await many(
      `SELECT * FROM (
         SELECT b.*, t.name team_name, CASE WHEN b.type='solo' THEN 4 ELSE team_level(b.team_id, $1, 'budget') END AS level
         FROM budgets b LEFT JOIN teams t ON t.id=b.team_id
         WHERE (b.type='solo' AND b.owner_user_id=$1) OR b.type='shared'
       ) x WHERE x.level >= 2 ORDER BY x.archived, x.type <> 'solo', lower(x.name), x.name`,
      [req.user.id],
    );
    return Promise.all(rows.map(({ level, ...b }) => decorate(b, level, b.team_name)));
  });

  app.post('/budgets', authz('budget:create'), async (req) => {
    const b = budgetBody.parse(req.body);
    if (b.period_type === 'custom' && (!b.period_start || !b.period_end || b.period_end < b.period_start)) throw bad('Zeitraum ungültig');
    if (b.type === 'shared') {
      if (!b.team_id) throw bad('Organisation erforderlich');
      await recordOwner(req.user.id, b.team_id, 'budget', LEVEL.WRITE);
    } else {
      const max = req.user.max_budgets ?? Math.max(...req.userRoles.map((r) => r.max_budgets ?? 1e9), 0);
      const n = (await one("SELECT count(*)::int n FROM budgets WHERE owner_user_id=$1 AND NOT archived", [req.user.id])).n;
      if (n >= (max || 1e9)) throw bad(`Kontolimit erreicht (${max})`, 'limit');
    }
    const interest = interestValues(b) || { interest_rate: null, interest_period: null, interest_since: null };
    const id_ = await tx(async (c) => {
      const r = (
        await c.query(
          `INSERT INTO budgets(name,type,owner_user_id,team_id,currency,period_type,period_start,period_end,limit_amount,interest_rate,interest_period,interest_since)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          // Ohne Angabe gilt die Profilwährung, sonst wäre das Konto nicht als Gehaltskonto wählbar
          [b.name, b.type, b.type === 'solo' ? req.user.id : null, b.type === 'shared' ? b.team_id : null, b.currency || req.user.currency || 'EUR', b.period_type, b.period_start || null, b.period_end || null, b.limit_amount,
            interest.interest_rate, interest.interest_period, interest.interest_since],
        )
      ).rows[0].id;
      await addDefaultCategories(c, r);
      return r;
    });
    await audit(req, 'budget.created', 'budget', id_);
    return { id: id_ };
  });

  app.patch('/budgets/:id', authz('budget:update'), async (req) => {
    const { budget } = await budgetAccess(req.user.id, req.params.id, true);
    const b = patchSchema(budgetBody.pick({ name: true, currency: true, period_type: true, period_start: true, period_end: true, limit_amount: true, interest_rate: true, interest_period: true })).extend({ archived: z.boolean().optional() }).parse(req.body);
    if (b.currency && b.currency !== budget.currency && (await one('SELECT 1 FROM users WHERE payroll_budget_id=$1 AND currency<>$2', [budget.id, b.currency]))) {
      throw bad('Dieses Konto ist ein Gehaltskonto und muss in der Profilwährung bleiben');
    }
    const interest = interestValues(b, budget);
    const patch = { ...b, ...interest };
    const keys = Object.keys(patch);
    if (keys.length) await q(`UPDATE budgets SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1`, [budget.id, ...keys.map((k) => patch[k] ?? null)]);
    if (interest && (Number(interest.interest_rate ?? 0) !== Number(budget.interest_rate ?? 0) || interest.interest_period !== budget.interest_period)) {
      await audit(req, 'budget.interest_changed', 'budget', budget.id, { rate: interest.interest_rate, period: interest.interest_period });
    }
    return { ok: true };
  });

  app.delete('/budgets/:id', authz('budget:delete'), async (req) => {
    await budgetAccess(req.user.id, req.params.id, LEVEL.MANAGE);
    // Offene Umbuchungen von oder auf dieses Konto ziehen sich zurück, gebucht ist dabei noch nichts
    await q("UPDATE transfers SET status='revoked', decline_reason='Konto gelöscht', decided_at=now() WHERE status='pending' AND (from_budget_id=$1 OR to_budget_id=$1)", [req.params.id]);
    // Objektkosten, die dieses Konto nutzen, zurücksetzen (sonst verletzt SET NULL den Kosten-Check)
    for (const t of ['properties', 'vehicles', 'keys']) {
      await q(`UPDATE ${t} SET cost_amount=NULL, cost_interval=NULL, cost_category_id=NULL, cost_recurring_id=NULL WHERE cost_budget_id=$1`, [req.params.id]);
    }
    await q('DELETE FROM budgets WHERE id=$1', [req.params.id]);
    await audit(req, 'budget.deleted', 'budget', req.params.id);
    return { ok: true };
  });

  // ---- Kategorien
  app.post('/budgets/:id/categories', authz('budget:update'), async (req) => {
    await budgetAccess(req.user.id, req.params.id, true);
    const b = z.object({ name: z.string().min(1).max(60), limit_amount: money.nullish(), color: z.string().max(20).nullish() }).parse(req.body);
    try {
      return await one('INSERT INTO categories(budget_id,name,limit_amount,color) VALUES ($1,$2,$3,$4) RETURNING id', [req.params.id, b.name, b.limit_amount || null, b.color || null]);
    } catch (e) {
      if (e.code === '23505') throw bad('Kategorie existiert bereits');
      throw e;
    }
  });
  app.patch('/categories/:id', authz('budget:update'), async (req) => {
    const c = await one('SELECT budget_id FROM categories WHERE id=$1', [req.params.id]);
    if (!c) throw notFound();
    await budgetAccess(req.user.id, c.budget_id, true);
    const b = z.object({ name: z.string().min(1).max(60), limit_amount: money.nullish(), color: z.string().max(20).nullish() }).partial().parse(req.body);
    await q('UPDATE categories SET name=COALESCE($2,name), limit_amount=CASE WHEN $3 THEN $4 ELSE limit_amount END, color=COALESCE($5,color) WHERE id=$1',
      [req.params.id, b.name ?? null, 'limit_amount' in b, b.limit_amount || null, b.color ?? null]);
    return { ok: true };
  });
  app.delete('/categories/:id', authz('budget:update'), async (req) => {
    const c = await one('SELECT budget_id FROM categories WHERE id=$1', [req.params.id]);
    if (!c) throw notFound();
    await budgetAccess(req.user.id, c.budget_id, true);
    await q('DELETE FROM categories WHERE id=$1', [req.params.id]);
    return { ok: true };
  });

  // ---- Transaktionen
  const txFilter = async (req) => {
    const f = z.object({
      budget_id: id.optional(), type: z.enum(['income', 'expense', 'deposit']).optional(), income_kind: z.enum(['other', 'salary']).optional(), category_id: id.optional(),
      from: date.optional(), to: date.optional(), q: z.string().max(100).optional(), scope: z.enum(['solo', 'shared', 'all']).default('all'),
      limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    let ids = await accessibleBudgetIds(req.user.id);
    if (f.budget_id) ids = ids.filter((i) => i === f.budget_id);
    const p = [ids];
    const w = ['t.budget_id = ANY($1)'];
    const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
    if (f.scope !== 'all') add('b.type = ?', f.scope);
    if (f.type) add('t.type = ?', f.type);
    if (f.income_kind) add('t.income_kind = ?', f.income_kind);
    if (f.category_id) add('t.category_id = ?', f.category_id);
    if (f.from) add('t.booked_at >= ?', f.from);
    if (f.to) add('t.booked_at <= ?', f.to);
    if (f.q) {
      p.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
      const n = p.length;
      w.push(`(t.title ILIKE $${n} OR t.note ILIKE $${n} OR EXISTS (SELECT 1 FROM unnest(t.tags) g WHERE g ILIKE $${n}))`);
    }
    return { f, where: w.join(' AND '), params: p };
  };

  app.get('/transactions', authz('transaction:read'), async (req) => {
    const { f, where, params } = await txFilter(req);
    const rows = await many(
      `SELECT t.id, t.budget_id, b.name budget_name, b.type budget_type, t.category_id, c.name category_name, t.type, t.income_kind, t.amount, t.booked_at, t.title, t.note, t.tags, t.source, t.goal_id,
         (SELECT count(*)::int FROM attachments a WHERE a.transaction_id=t.id) attachments, u.name created_by_name
       FROM transactions t JOIN budgets b ON b.id=t.budget_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN users u ON u.id=t.created_by
       WHERE ${where} ORDER BY t.booked_at DESC, t.created_at DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
      params,
    );
    const tot = await one(
      `SELECT count(*)::int n, COALESCE(sum(amount) FILTER (WHERE t.type='income'),0) income,
         COALESCE(sum(amount) FILTER (WHERE t.type='income' AND t.income_kind='salary'),0) salary_income,
         COALESCE(sum(amount) FILTER (WHERE t.type='expense'),0) expense
       FROM transactions t JOIN budgets b ON b.id=t.budget_id WHERE ${where}`,
      params,
    );
    return { items: rows, total: tot.n, income: tot.income, salary_income: tot.salary_income, expense: tot.expense };
  });

  const txBody = z.object({
    budget_id: id, category_id: id.nullish(), type: z.enum(['income', 'expense', 'deposit']), amount: money.refine((v) => Number(v) > 0, 'Betrag muss > 0 sein'),
    booked_at: date, title: z.string().max(200).default(''), note: z.string().max(2000).default(''), tags: z.array(z.string().max(30)).max(10).default([]), goal_id: id.nullish(), income_kind: z.enum(['other', 'salary']).default('other'),
  });

  async function checkRefs(b, budget) {
    if (b.category_id && !(await one('SELECT 1 FROM categories WHERE id=$1 AND budget_id=$2', [b.category_id, budget.id]))) throw bad('Kategorie gehört nicht zum Konto');
    if (b.goal_id && !(await one('SELECT 1 FROM goals WHERE id=$1 AND budget_id=$2', [b.goal_id, budget.id]))) throw bad('Sparziel gehört nicht zum Konto');
  }

  app.post('/transactions', authz('transaction:create'), async (req) => {
    const b = txBody.parse(req.body);
    const idem = req.headers['idempotency-key'];
    if (idem) {
      const hit = await one('SELECT response FROM idempotency_keys WHERE user_id=$1 AND key=$2', [req.user.id, String(idem).slice(0, 100)]);
      if (hit) return hit.response;
    }
    const { budget } = await budgetAccess(req.user.id, b.budget_id, true);
    await checkRefs(b, budget);
    const r = await one(
      `INSERT INTO transactions(budget_id,category_id,created_by,type,amount,booked_at,title,note,tags,goal_id,income_kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [b.budget_id, b.category_id || null, req.user.id, b.type, b.amount, b.booked_at, b.title, b.note, b.tags, b.goal_id || null, b.type === 'income' ? b.income_kind : 'other'],
    );
    if (idem) await q('INSERT INTO idempotency_keys(key, user_id, response) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [String(idem).slice(0, 100), req.user.id, JSON.stringify(r)]);
    if (b.type === 'expense') await budgetWatch(b.budget_id, req.log);
    await audit(req, 'transaction.created', 'transaction', r.id);
    return r;
  });

  app.patch('/transactions/:id', authz('transaction:update'), async (req) => {
    const t = await one('SELECT * FROM transactions WHERE id=$1', [req.params.id]);
    if (!t) throw notFound();
    if (t.source === 'payroll') throw bad('Automatische Gehaltsbuchungen können nicht geändert werden');
    if (t.source === 'interest') throw bad('Zinsgutschriften lassen sich nicht ändern, nur löschen');
    if (t.source === 'transfer') throw bad('Umbuchungen lassen sich nicht ändern oder löschen – buche zurück');
    const { budget } = await budgetAccess(req.user.id, t.budget_id, true);
    const b = patchSchema(txBody.omit({ budget_id: true })).parse(req.body);
    await checkRefs(b, budget);
    const patch = { ...b };
    if (patch.type && patch.type !== 'income') patch.income_kind = 'other';
    const keys = Object.keys(patch);
    if (keys.length) await q(`UPDATE transactions SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [t.id, ...keys.map((k) => patch[k] ?? null)]);
    await budgetWatch(t.budget_id, req.log);
    return { ok: true };
  });

  app.delete('/transactions/:id', authz('transaction:delete'), async (req) => {
    const t = await one('SELECT budget_id,source FROM transactions WHERE id=$1', [req.params.id]);
    if (!t) throw notFound();
    if (t.source === 'payroll') throw bad('Automatische Gehaltsbuchungen können nicht gelöscht werden');
    if (t.source === 'transfer') throw bad('Umbuchungen lassen sich nicht ändern oder löschen – buche zurück');
    await budgetAccess(req.user.id, t.budget_id, true);
    await q('DELETE FROM transactions WHERE id=$1', [req.params.id]);
    await audit(req, 'transaction.deleted', 'transaction', req.params.id);
    return { ok: true };
  });

  // ---- Screenshot-Scanning (Wunsch des Auftraggebers vom 2026-11-10): Texterkennung lokal (ocr.js), Vorschläge aus
  // scan.js. Das Bild wird nur gelesen, nicht gespeichert; gebucht wird erst über /transactions/import nach Prüfung.
  app.post('/transactions/scan', authz('transaction:create'), async (req) => {
    const f = z.object({ today: isoDate.optional() }).parse(req.query);
    const part = await req.file();
    if (!part) throw bad('Bild fehlt');
    if (!['image/png', 'image/jpeg'].includes(part.mimetype)) throw bad('Nur PNG und JPEG erlaubt');
    let image;
    try {
      image = await part.toBuffer();
    } catch (e) {
      if (e.code === 'FST_REQ_FILE_TOO_LARGE') throw bad(`Bild größer als ${config.maxUploadBytes / 1048576} MB`);
      throw e;
    }
    const magic = part.mimetype === 'image/png' ? [0x89, 0x50, 0x4e, 0x47] : [0xff, 0xd8, 0xff];
    if (!magic.every((byte, i) => image[i] === byte)) throw bad('Dateiinhalt passt nicht zum Typ');
    const text = await recognizeText(image);
    return { ...parseStatement(text, { today: f.today || today() }), text: text.slice(0, 20000) };
  });

  // Geprüfte Vorschläge auf einmal buchen; Quelle „import“, sonst wie eine Buchung von Hand
  app.post('/transactions/import', authz('transaction:create'), async (req) => {
    const b = z.object({
      budget_id: id,
      items: z.array(z.object({
        type: z.enum(['income', 'expense']), amount: money.refine((v) => Number(v) > 0, 'Betrag muss > 0 sein'), booked_at: isoDate,
        title: z.string().trim().max(200).default(''), category_id: id.nullish(),
      })).min(1).max(100),
    }).parse(req.body);
    const { budget } = await budgetAccess(req.user.id, b.budget_id, true);
    for (const categoryId of new Set(b.items.map((x) => x.category_id).filter(Boolean))) await checkRefs({ category_id: categoryId }, budget);
    const created = await tx(async (client) => {
      let n = 0;
      for (const x of b.items) {
        await client.query(
          `INSERT INTO transactions(budget_id,category_id,created_by,type,amount,booked_at,title,source) VALUES ($1,$2,$3,$4,$5,$6,$7,'import')`,
          [budget.id, x.category_id || null, req.user.id, x.type, x.amount, x.booked_at, x.title],
        );
        n++;
      }
      return n;
    });
    if (b.items.some((x) => x.type === 'expense')) await budgetWatch(budget.id, req.log);
    await audit(req, 'transaction.imported', 'budget', budget.id, { count: created, source: 'screenshot' });
    return { created };
  });

  app.get('/transactions/export.csv', authz('transaction:export'), async (req, reply) => {
    const { where, params } = await txFilter(req);
    const rows = await many(
      `SELECT t.booked_at, b.name budget, c.name category, t.type, t.income_kind, t.amount, t.title, t.note, array_to_string(t.tags, ',') tags
       FROM transactions t JOIN budgets b ON b.id=t.budget_id LEFT JOIN categories c ON c.id=t.category_id WHERE ${where} ORDER BY t.booked_at DESC LIMIT 50000`,
      params,
    );
    await audit(req, 'transactions.exported', 'transaction', null, { rows: rows.length });
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="transaktionen.csv"');
    return toCsv(rows, ['booked_at', 'budget', 'category', 'type', 'income_kind', 'amount', 'title', 'note', 'tags']);
  });

  // ---- Daueraufträge
  const recBody = z.object({
    name: z.string().min(1).max(100), budget_id: id, category_id: id.nullish(), type: z.enum(['income', 'expense']), amount: money.refine((v) => Number(v) > 0),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']), interval: z.number().int().min(1).max(3650).default(1), income_kind: z.enum(['other', 'salary']).default('other'),
    start_date: date, end_date: date.nullish(), active: z.boolean().default(true),
  });
  const assetTables = { house: ['properties', 'property'], vehicle: ['vehicles', 'vehicle'], key: ['keys', 'key'] };
  async function assertAssetRecurringAccess(req, rule, write = false) {
    const [table, module] = assetTables[rule.asset_type] || [];
    if (!table || !rule.asset_id) throw notFound();
    const asset = await one(`SELECT owner_user_id,team_id FROM ${table} WHERE id=$1`, [rule.asset_id]);
    // Wie bisher: fehlendes Schreibrecht sieht von außen aus wie ein fremdes Objekt
    const level = asset ? (asset.owner_user_id ? (asset.owner_user_id === req.user.id ? LEVEL.MANAGE : 0) : await teamLevel(req.user.id, asset.team_id, module)) : 0;
    if (level < (write ? LEVEL.WRITE : LEVEL.READ)) throw notFound();
    return table;
  }
  app.get('/recurring/share-candidates', authz('recurring:create'), async (req) => many(
    `SELECT DISTINCT u.id, u.name FROM team_members mine
     JOIN team_members peer ON peer.team_id=mine.team_id AND peer.user_id<>mine.user_id
     JOIN users u ON u.id=peer.user_id
     WHERE mine.user_id=$1 AND u.status='active' AND u.deleted_at IS NULL
     ORDER BY u.name`,
    [req.user.id],
  ));
  app.get('/recurring', authz('recurring:read'), async (req) =>
    many(
      `SELECT r.*, b.name budget_name, b.currency budget_currency, c.name category_name, recipient.name recipient_name,
         creator.name creator_name, rb.name recipient_budget_name,
         (r.recipient_user_id=$2) is_share_recipient
       FROM recurring_rules r JOIN budgets b ON b.id=r.budget_id LEFT JOIN categories c ON c.id=r.category_id
       LEFT JOIN users recipient ON recipient.id=r.recipient_user_id LEFT JOIN users creator ON creator.id=r.created_by
       LEFT JOIN budgets rb ON rb.id=r.recipient_budget_id
       WHERE r.budget_id = ANY($1) OR r.recipient_user_id=$2 ORDER BY r.active DESC, r.next_run`,
      [await accessibleBudgetIds(req.user.id), req.user.id],
    ));
  app.get('/recurring/share-requests', authz('recurring:read'), async (req) => many(
    `SELECT r.id, r.name, r.type, r.amount, r.frequency, r.interval, r.start_date, r.end_date, r.next_run,
       b.name budget_name, b.currency, u.name sender_name
     FROM recurring_rules r JOIN budgets b ON b.id=r.budget_id JOIN users u ON u.id=r.created_by
     WHERE r.recipient_user_id=$1 AND r.recipient_status='pending' ORDER BY r.start_date DESC`,
    [req.user.id],
  ));
  app.post('/recurring', authz('recurring:create'), async (req) => {
    const b = recBody.extend({ recipient_user_id: id.nullish() }).parse(req.body);
    const { budget } = await budgetAccess(req.user.id, b.budget_id, true);
    await checkRefs(b, budget);
    if (b.recipient_user_id) {
      if (budget.type !== 'solo' || budget.owner_user_id !== req.user.id) throw bad('Geteilte Daueraufträge benötigen dein persönliches Konto');
      const peer = await one(
        `SELECT u.name FROM team_members mine JOIN team_members peer ON peer.team_id=mine.team_id
         JOIN users u ON u.id=peer.user_id
         WHERE mine.user_id=$1 AND peer.user_id=$2 AND u.status='active' AND u.deleted_at IS NULL`,
        [req.user.id, b.recipient_user_id],
      );
      if (!peer) throw bad('Der zweite Nutzer muss mit dir in einer Organisation sein');
    }
    const rule = await one(
      `INSERT INTO recurring_rules(name,budget_id,category_id,created_by,type,amount,frequency,interval,start_date,end_date,next_run,active,income_kind,recipient_user_id,recipient_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11,$12,$13,$14) RETURNING id`,
      [b.name, b.budget_id, b.category_id || null, req.user.id, b.type, b.amount, b.frequency, b.interval, b.start_date, b.end_date || null, b.active, b.type === 'income' ? b.income_kind : 'other', b.recipient_user_id || null, b.recipient_user_id ? 'pending' : null],
    );
    if (b.recipient_user_id) await notify(b.recipient_user_id, 'recurring_share', 'Dauerauftrag zur Bestätigung', `${req.user.name} möchte „${b.name}“ auch in deinem persönlichen Konto buchen.`, `recurring-share:${rule.id}`);
    return rule;
  });
  app.post('/recurring/:id/accept', authz('recurring:read'), async (req) => {
    const { budget_id } = z.object({ budget_id: id }).parse(req.body);
    const rule = await one('SELECT * FROM recurring_rules WHERE id=$1 AND recipient_user_id=$2 AND recipient_status=\'pending\'', [req.params.id, req.user.id]);
    if (!rule) throw notFound();
    const { budget } = await budgetAccess(req.user.id, budget_id, true);
    if (budget.type !== 'solo' || budget.owner_user_id !== req.user.id) throw bad('Wähle ein persönliches Konto');
    const sourceBudget = await one('SELECT currency FROM budgets WHERE id=$1', [rule.budget_id]);
    if (sourceBudget.currency !== budget.currency) throw bad('Beide persönlichen Konten müssen dieselbe Währung verwenden');
    const accepted = await tx(async (client) => {
      const result = await client.query(
        `UPDATE recurring_rules SET recipient_budget_id=$2, recipient_status='accepted'
         WHERE id=$1 AND recipient_user_id=$3 AND recipient_status='pending' RETURNING id`,
        [rule.id, budget.id, req.user.id],
      );
      if (!result.rowCount) throw notFound();
      await client.query(
        `INSERT INTO transactions(budget_id,category_id,created_by,type,amount,booked_at,title,note,tags,source,recurring_id,income_kind)
         SELECT $2,NULL,created_by,type,amount,booked_at,$4,'','{}'::text[],'recurring',recurring_id,income_kind
         FROM transactions WHERE recurring_id=$1 AND budget_id=$3 AND source='recurring'
         ON CONFLICT DO NOTHING`,
        [rule.id, budget.id, rule.budget_id, rule.name],
      );
      return result.rows[0];
    });
    await budgetWatch(budget.id, req.log);
    await notify(rule.created_by, 'recurring_share', 'Dauerauftrag angenommen', `${req.user.name} hat „${rule.name}“ für das persönliche Konto bestätigt.`, `recurring-accepted:${rule.id}`);
    return accepted;
  });
  app.post('/recurring/:id/decline', authz('recurring:read'), async (req) => {
    const rule = await one('UPDATE recurring_rules SET recipient_status=\'declined\' WHERE id=$1 AND recipient_user_id=$2 AND recipient_status=\'pending\' RETURNING created_by,name', [req.params.id, req.user.id]);
    if (!rule) throw notFound();
    await notify(rule.created_by, 'recurring_share', 'Dauerauftrag abgelehnt', `${req.user.name} hat „${rule.name}“ nicht angenommen.`, `recurring-declined:${req.params.id}`);
    return { ok: true };
  });
  app.post('/recurring/:id/revoke-share', authz('recurring:update'), async (req) => {
    const rule = await one('SELECT * FROM recurring_rules WHERE id=$1', [req.params.id]);
    if (!rule || rule.source === 'asset' || rule.created_by !== req.user.id || !rule.recipient_user_id) throw notFound();
    await budgetAccess(req.user.id, rule.budget_id, true);
    const revoked = await q(
      'UPDATE recurring_rules SET recipient_status=\'revoked\', recipient_budget_id=NULL WHERE id=$1 AND recipient_user_id IS NOT NULL AND recipient_status IN (\'pending\',\'accepted\') RETURNING id',
      [rule.id],
    );
    if (!revoked.rowCount) throw notFound();
    await notify(rule.recipient_user_id, 'recurring_share', 'Dauerauftrag geteilt', `Die gemeinsame Buchung von „${rule.name}“ wurde beendet.`, `recurring-revoked:${rule.id}`);
    return { ok: true };
  });
  app.patch('/recurring/:id', authz('recurring:update'), async (req) => {
    const r = await one('SELECT * FROM recurring_rules WHERE id=$1', [req.params.id]);
    if (!r) throw notFound();
    const assetTable = r.source === 'asset' ? await assertAssetRecurringAccess(req, r, true) : null;
    const b = patchSchema(recBody.omit({ budget_id: true })).parse(req.body);
    if (assetTable && b.type && b.type !== 'expense') throw bad('Objektkosten müssen Ausgaben sein');
    const { budget } = await budgetAccess(req.user.id, r.budget_id, true);
    await checkRefs(b, budget);
    const sharedTermsChanged = r.recipient_user_id && ['pending', 'accepted'].includes(r.recipient_status)
      && ['type', 'amount', 'frequency', 'interval', 'start_date', 'end_date'].some((key) => {
        if (!(key in b)) return false;
        return key === 'amount'
          ? Number(b[key]) !== Number(r[key])
          : String(b[key] ?? '') !== String(r[key] ?? '');
      });
    const patch = { ...b };
    if (patch.type && patch.type !== 'income') patch.income_kind = 'other';
    const keys = Object.keys(patch);
    if (keys.length) await tx(async (client) => {
      await client.query(`UPDATE recurring_rules SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [r.id, ...keys.map((k) => patch[k] ?? null)]);
      if (assetTable) {
        await client.query(
          `UPDATE ${assetTable} SET cost_amount=$2,cost_category_id=$3,cost_interval=$4,cost_interval_count=$5,cost_tracking=true WHERE id=$1`,
          [r.asset_id, patch.amount ?? r.amount, patch.category_id === undefined ? r.category_id : patch.category_id, patch.frequency ?? r.frequency, patch.interval ?? r.interval],
        );
      }
    });
    if (sharedTermsChanged) {
      await q('UPDATE recurring_rules SET recipient_status=\'pending\', recipient_budget_id=NULL WHERE id=$1', [r.id]);
      await notify(r.recipient_user_id, 'recurring_share', 'Dauerauftrag erneut bestätigen', `Die Bedingungen von „${r.name}“ wurden geändert. Bitte bestätige den Auftrag erneut.`, `recurring-share-update:${r.id}:${Date.now()}`);
    }
    return { ok: true };
  });
  app.delete('/recurring/:id', authz('recurring:delete'), async (req) => {
    const r = await one('SELECT * FROM recurring_rules WHERE id=$1', [req.params.id]);
    if (!r) throw notFound();
    const assetTable = r.source === 'asset' ? await assertAssetRecurringAccess(req, r, true) : null;
    await budgetAccess(req.user.id, r.budget_id, true);
    await tx(async (client) => {
      if (assetTable) {
        await client.query(`UPDATE ${assetTable} SET cost_tracking=false,cost_recurring_id=NULL WHERE id=$1`, [r.asset_id]);
      }
      await client.query('DELETE FROM recurring_rules WHERE id=$1', [r.id]);
    });
    return { ok: true };
  });

  // ---- Sparziele
  const goalBody = z.object({
    budget_id: id, name: z.string().min(1).max(100), target_amount: money.refine((v) => Number(v) > 0),
    target_date: date.nullish(), installment_amount: money.nullish().refine((v) => v == null || Number(v) > 0),
    installment_frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']).default('monthly'),
    installment_interval: z.number().int().min(1).max(3650).default(1),
  });
  app.get('/goals', authz('goal:read'), async (req) =>
    many(
      `SELECT g.*, b.name budget_name, COALESCE((SELECT sum(amount) FROM transactions t WHERE t.goal_id=g.id AND t.type='deposit'),0) saved
       FROM goals g JOIN budgets b ON b.id=g.budget_id WHERE g.budget_id = ANY($1) ORDER BY g.target_date NULLS LAST, g.name`,
      [await accessibleBudgetIds(req.user.id)],
    ));
  app.post('/goals', authz('goal:create'), async (req) => {
    const b = goalBody.parse(req.body);
    await budgetAccess(req.user.id, b.budget_id, true);
    return one('INSERT INTO goals(budget_id,name,target_amount,target_date,installment_amount,installment_frequency,installment_interval) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [b.budget_id, b.name, b.target_amount, b.target_date || null, b.installment_amount || null, b.installment_frequency, b.installment_interval]);
  });
  app.patch('/goals/:id', authz('goal:update'), async (req) => {
    const g = await one('SELECT * FROM goals WHERE id=$1', [req.params.id]);
    if (!g) throw notFound();
    await budgetAccess(req.user.id, g.budget_id, true);
    const b = patchSchema(goalBody.omit({ budget_id: true })).parse(req.body);
    const keys = Object.keys(b);
    if (keys.length) await q(`UPDATE goals SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [g.id, ...keys.map((k) => b[k] ?? null)]);
    return { ok: true };
  });
  app.delete('/goals/:id', authz('goal:delete'), async (req) => {
    const g = await one('SELECT * FROM goals WHERE id=$1', [req.params.id]);
    if (!g) throw notFound();
    await budgetAccess(req.user.id, g.budget_id, true);
    await q('DELETE FROM goals WHERE id=$1', [g.id]);
    return { ok: true };
  });

  // ---- Statistiken
  const statScope = async (req) => {
    const f = z.object({ scope: z.enum(['solo', 'shared', 'all']).default('all'), budget_id: id.optional(), from: date.optional(), to: date.optional(), months: z.coerce.number().int().min(1).max(36).default(6) }).parse(req.query);
    let ids = await accessibleBudgetIds(req.user.id);
    if (f.budget_id) ids = ids.filter((i) => i === f.budget_id);
    if (f.scope !== 'all') ids = (await many('SELECT id FROM budgets WHERE id = ANY($1) AND type=$2', [ids, f.scope])).map((r) => r.id);
    const now = new Date();
    const from = f.from || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const to = f.to || today();
    return { f, ids, from, to };
  };

  app.get('/stats/overview', authz('budget:read'), async (req) => {
    const { ids, from, to } = await statScope(req);
    const k = await one(
      `SELECT COALESCE(sum(amount) FILTER (WHERE type='income'),0) income, COALESCE(sum(amount) FILTER (WHERE type='expense'),0) expense,
         COALESCE(sum(amount) FILTER (WHERE type='deposit'),0) deposit FROM transactions WHERE budget_id = ANY($1) AND booked_at BETWEEN $2 AND $3`,
      [ids, from, to],
    );
    const saldo = await one(
      `SELECT COALESCE(sum(CASE type WHEN 'income' THEN amount WHEN 'expense' THEN -amount ELSE 0 END),0) s FROM transactions WHERE budget_id = ANY($1) AND booked_at <= $2`,
      [ids, today()],
    );
    return { from, to, income: k.income, expense: k.expense, deposit: k.deposit, balance: (Number(k.income) - Number(k.expense)).toFixed(2), saldo: saldo.s };
  });

  app.get('/stats/by-category', authz('budget:read'), async (req) => {
    const { ids, from, to } = await statScope(req);
    return many(
      `SELECT COALESCE(c.name,'Ohne Kategorie') name, COALESCE(c.color,'#94a3b8') color, sum(t.amount) total FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
       WHERE t.budget_id = ANY($1) AND t.type='expense' AND t.booked_at BETWEEN $2 AND $3 GROUP BY 1,2 ORDER BY total DESC`,
      [ids, from, to],
    );
  });

  app.get('/stats/timeline', authz('budget:read'), async (req) => {
    const { f, ids } = await statScope(req);
    const g = z.object({
      granularity: z.enum(['day', 'week', 'month']).default('month'),
      periods: z.coerce.number().int().min(1).max(60).optional(),
      week_start: z.coerce.number().int().min(0).max(1).default(1),
    }).parse(req.query);
    if (g.granularity !== 'month') {
      const anchor = f.to || today();
      const window = timelineWindow(g.granularity, anchor, g.periods, g.week_start);
      if (!window) throw bad('Datum ungültig');
      return many(
        `SELECT to_char(b, 'YYYY-MM-DD') AS bucket,
           COALESCE(sum(t.amount) FILTER (WHERE t.type='income'),0) income, COALESCE(sum(t.amount) FILTER (WHERE t.type='expense'),0) expense
         FROM generate_series($2::date::timestamp, $3::date::timestamp, make_interval(days => $4::int)) b
         LEFT JOIN transactions t ON t.budget_id = ANY($1) AND t.booked_at >= b::date AND t.booked_at < b::date + $4::int AND t.booked_at <= $5::date
         GROUP BY b ORDER BY b`,
        [ids, window.start, window.end, window.stepDays, anchor],
      );
    }
    return many(
      `SELECT to_char(m, 'YYYY-MM') AS month,
         COALESCE(sum(t.amount) FILTER (WHERE t.type='income'),0) income, COALESCE(sum(t.amount) FILTER (WHERE t.type='expense'),0) expense
       FROM generate_series(date_trunc('month', now()) - ($2 || ' months')::interval + interval '1 month', date_trunc('month', now()), interval '1 month') m
       LEFT JOIN transactions t ON t.budget_id = ANY($1) AND date_trunc('month', t.booked_at) = m AND ($3::date IS NULL OR t.booked_at <= $3) GROUP BY m ORDER BY m`,
      [ids, String(f.months), f.to ?? null],
    );
  });

  // ---- Prognose dieser und nächster Woche (Regeln in forecast.js): gleicher Kontenumfang wie das Dashboard
  app.get('/stats/forecast', authz('budget:read'), async (req) => {
    const { ids } = await statScope(req);
    const g = z.object({ week_start: z.coerce.number().int().min(0).max(1).default(1), today: isoDate.optional() }).parse(req.query);
    // „Heute“ des Browsers, damit die Prognose zum Dashboard passt (der Server rechnet sonst in UTC)
    const now = g.today || today();
    const current = weekOf(now, g.week_start);
    const last = addDays(current.end, 7);
    const [transactions, rules, payroll, first] = await Promise.all([
      many(`SELECT to_char(booked_at, 'YYYY-MM-DD') date, type, sum(amount) amount FROM transactions
        WHERE budget_id = ANY($1) AND type IN ('income','expense') AND booked_at BETWEEN $2 AND $3 GROUP BY 1, 2`, [ids, current.start, last]),
      // Geteilte Daueraufträge buchen den vollen Betrag auch beim Empfänger: jede sichtbare Seite zählt
      many(`SELECT r.start_date, r.next_run, r.end_date, r.frequency, r.interval, r.type, r.amount, r.active,
          (r.budget_id = ANY($1))::int + COALESCE((r.recipient_status = 'accepted' AND r.recipient_budget_id = ANY($1))::int, 0) copies
        FROM recurring_rules r WHERE r.active AND (r.budget_id = ANY($1) OR (r.recipient_status = 'accepted' AND r.recipient_budget_id = ANY($1)))`, [ids]),
      // Festgehalt nur auf ein gültiges Gehaltskonto im gewählten Umfang (wie payrollRun)
      one(`SELECT u.daily_salary, to_char(u.payroll_start_date, 'YYYY-MM-DD') start_date FROM users u JOIN budgets b ON b.id=u.payroll_budget_id
        WHERE u.id=$1 AND b.id = ANY($2) AND b.type='solo' AND b.owner_user_id=u.id AND NOT b.archived AND u.daily_salary > 0 AND u.payroll_start_date IS NOT NULL`, [req.user.id, ids]),
      one(`SELECT to_char(min(booked_at), 'YYYY-MM-DD') date FROM transactions WHERE budget_id = ANY($1) AND type IN ('income','expense') AND booked_at < $2`, [ids, current.start]),
    ]);
    const weeks = historyWeeks(first?.date, current.start, g.week_start);
    // Erfahrungswert ohne Daueraufträge und ohne Festgehalt; der Bonus aus dem Gehaltslauf zählt mit
    const history = await one(
      `SELECT COALESCE(sum(CASE WHEN t.source='payroll' THEN COALESCE(t.amount - pp.base_amount, 0) ELSE t.amount END) FILTER (WHERE t.type='income'), 0) income,
         COALESCE(sum(t.amount) FILTER (WHERE t.type='expense'), 0) expense
       FROM transactions t LEFT JOIN payroll_payments pp ON pp.transaction_id=t.id
       WHERE t.budget_id = ANY($1) AND t.type IN ('income','expense') AND t.recurring_id IS NULL AND t.booked_at BETWEEN $2 AND $3`,
      [ids, addDays(current.start, -7 * weeks), addDays(current.start, -1)],
    );
    const recurring = rules.flatMap((r) => ruleOccurrences(r, current.start, last).flatMap((d) => Array.from({ length: r.copies }, () => ({ date: d, type: r.type, amount: r.amount }))));
    let salary = [];
    if (payroll) {
      const paid = new Set((await many(
        "SELECT to_char(payroll_date, 'YYYY-MM-DD') d FROM payroll_payments WHERE user_id=$1 AND payroll_date BETWEEN $2 AND $3", [req.user.id, current.start, last],
      )).map((x) => x.d));
      salary = salaryDays({ from: current.start, to: last, startDate: payroll.start_date, paidDates: paid }).map((d) => ({ date: d, amount: payroll.daily_salary }));
    }
    return {
      today: now, history_weeks: weeks, history_from: weeks ? addDays(current.start, -7 * weeks) : null, max_history_weeks: HISTORY_WEEKS,
      weeks: planForecast({ today: now, weekStart: g.week_start, transactions, recurring, salary, history: { weeks, income: history.income, expense: history.expense } }),
    };
  });

  // ---- Berichte
  app.get('/reports/saved', authz('report:read'), async (req) => many('SELECT * FROM saved_reports WHERE owner_id=$1 ORDER BY kind', [req.user.id]));
  app.post('/reports/saved', authz('report:create'), async (req) => {
    const b = z.object({ kind: z.enum(['monthly', 'categories', 'costs']), rhythm: z.enum(['daily', 'weekly', 'monthly', 'yearly', 'custom']), rhythm_interval: z.number().int().min(1).max(3650).default(1), recipients: z.array(z.string().email()).max(10).default([]) }).parse(req.body);
    return one('INSERT INTO saved_reports(owner_id,kind,rhythm,rhythm_interval,recipients) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.user.id, b.kind, b.rhythm, b.rhythm_interval, b.recipients]);
  });
  app.delete('/reports/saved/:id', authz('report:create'), async (req) => {
    await q('DELETE FROM saved_reports WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    return { ok: true };
  });
  app.get('/reports/costs', authz('report:read'), async (req) => {
    const { ids, from, to } = await statScope(req);
    return many(
      `SELECT COALESCE(asset_type,'sonstige') asset_type, sum(amount) total, count(*)::int n FROM transactions
       WHERE budget_id = ANY($1) AND type='expense' AND booked_at BETWEEN $2 AND $3 AND source IN ('asset') GROUP BY 1 ORDER BY total DESC`,
      [ids, from, to],
    );
  });
}
