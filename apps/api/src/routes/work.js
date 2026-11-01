import { z } from 'zod';
import { many, one, q } from '../db.js';
import { requireAuth, notFound, bad } from '../authz.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const entryBody = z.object({
  work_date: date,
  hours: z.number().positive().max(24).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Maximal zwei Nachkommastellen'),
  note: z.string().max(500).default(''),
});

export default async function routes(app) {
  app.get('/work-hours', requireAuth, async (req) => {
    const filter = z.object({ from: date.optional(), to: date.optional() }).parse(req.query);
    if (filter.from && filter.to && filter.from > filter.to) throw bad('Zeitraum ungültig');
    const params = [req.user.id];
    const where = ['user_id=$1'];
    if (filter.from) {
      params.push(filter.from);
      where.push(`work_date >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`work_date <= $${params.length}`);
    }
    const [items, total] = await Promise.all([
      many(`SELECT id, work_date, hours, note FROM work_entries WHERE ${where.join(' AND ')} ORDER BY work_date DESC, created_at DESC`, params),
      one(`SELECT COALESCE(sum(hours), 0) total_hours FROM work_entries WHERE ${where.join(' AND ')}`, params),
    ]);
    return { items, total_hours: total.total_hours };
  });

  app.post('/work-hours', requireAuth, async (req) => {
    const entry = entryBody.parse(req.body);
    return one(
      'INSERT INTO work_entries(user_id, work_date, hours, note) VALUES ($1,$2,$3,$4) RETURNING id',
      [req.user.id, entry.work_date, entry.hours, entry.note],
    );
  });

  app.patch('/work-hours/:id', requireAuth, async (req) => {
    const entry = entryBody.partial().parse(req.body);
    const keys = Object.keys(entry);
    if (!keys.length) return { ok: true };
    const values = keys.map((key) => entry[key]);
    const result = await q(
      `UPDATE work_entries SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')}, updated_at=now() WHERE id=$1 AND user_id=$${keys.length + 2}`,
      [req.params.id, ...values, req.user.id],
    );
    if (!result.rowCount) throw notFound();
    return { ok: true };
  });

  app.delete('/work-hours/:id', requireAuth, async (req) => {
    const result = await q('DELETE FROM work_entries WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!result.rowCount) throw notFound();
    return { ok: true };
  });
}
