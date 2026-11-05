import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, notFound, budgetAccess, accessibleBudgetIds } from '../authz.js';
import { periodRange } from '../lib.js';

const id = z.string().uuid();
const body = z.object({
  name: z.string().trim().min(1).max(100),
  budget_id: id.nullish(),
  category_id: id.nullish(),
  limit_amount: z.number().positive().max(999999999999.99).multipleOf(0.01),
  period_type: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
});

async function resolveScope(userId, input) {
  let budgetId = input.budget_id || null;
  const categoryId = input.category_id || null;
  if (categoryId) {
    const category = await one('SELECT budget_id FROM categories WHERE id=$1', [categoryId]);
    if (!category) throw bad('Kategorie nicht gefunden');
    if (budgetId && budgetId !== category.budget_id) throw bad('Kategorie gehört nicht zum gewählten Konto');
    budgetId = category.budget_id;
  }
  if (budgetId) await budgetAccess(userId, budgetId);
  return { budgetId, categoryId };
}

export default async function routes(app) {
  app.get('/spending-budgets', authz('budget:read'), async (req) => {
    const ids = await accessibleBudgetIds(req.user.id);
    const rows = await many(
      `SELECT s.*, b.name account_name, c.name category_name
       FROM spending_budgets s LEFT JOIN budgets b ON b.id=s.budget_id LEFT JOIN categories c ON c.id=s.category_id
       WHERE s.owner_user_id=$1 ORDER BY s.created_at`,
      [req.user.id],
    );
    return Promise.all(rows.map(async (row) => {
      const [from, to] = periodRange(row);
      const used = (await one(
        `SELECT COALESCE(sum(amount),0) s FROM transactions
         WHERE type='expense' AND booked_at BETWEEN $1 AND $2
           AND budget_id = ANY($3::uuid[]) AND ($4::uuid IS NULL OR budget_id=$4)
           AND ($5::uuid IS NULL OR category_id=$5)`,
        [from, to, ids, row.budget_id, row.category_id],
      )).s;
      const limit = Number(row.limit_amount);
      return { ...row, used, remaining: (limit - Number(used)).toFixed(2), pct: Math.round((Number(used) / limit) * 1000) / 10, period_from: from, period_to: to };
    }));
  });

  app.post('/spending-budgets', authz('budget:update'), async (req) => {
    const b = body.parse(req.body);
    const { budgetId, categoryId } = await resolveScope(req.user.id, b);
    return one(
      'INSERT INTO spending_budgets(owner_user_id,name,budget_id,category_id,limit_amount,period_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [req.user.id, b.name, budgetId, categoryId, b.limit_amount, b.period_type],
    );
  });

  app.patch('/spending-budgets/:id', authz('budget:update'), async (req) => {
    const existing = await one('SELECT id FROM spending_budgets WHERE id=$1 AND owner_user_id=$2', [req.params.id, req.user.id]);
    if (!existing) throw notFound();
    const b = body.parse(req.body);
    const { budgetId, categoryId } = await resolveScope(req.user.id, b);
    await q('UPDATE spending_budgets SET name=$2,budget_id=$3,category_id=$4,limit_amount=$5,period_type=$6 WHERE id=$1',
      [existing.id, b.name, budgetId, categoryId, b.limit_amount, b.period_type]);
    return { ok: true };
  });

  app.delete('/spending-budgets/:id', authz('budget:update'), async (req) => {
    const result = await q('DELETE FROM spending_budgets WHERE id=$1 AND owner_user_id=$2', [req.params.id, req.user.id]);
    if (!result.rowCount) throw notFound();
    return { ok: true };
  });
}
