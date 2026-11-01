import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, budgetAccess } from '../authz.js';
import { addInterval, today } from '../lib.js';
import { audit } from '../audit.js';

const money = z.union([z.string(), z.number()]).transform((v) => String(v).replace(',', '.')).refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Ungültiger Betrag');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().uuid();
const str = (n = 200) => z.string().max(n);

const costFields = {
  cost_amount: money.nullish(),
  cost_interval: z.enum(['once', 'monthly', 'quarterly', 'yearly']).nullish(),
  cost_budget_id: id.nullish(),
  cost_category_id: id.nullish(),
  cost_tracking: z.boolean().optional(),
};

const KINDS = {
  properties: {
    perm: 'property', asset: 'house', label: (r) => r.name,
    schema: z.object({
      name: z.string().min(1).max(100), type: z.enum(['home', 'office', 'storage', 'holiday']).default('home'), address: str(300).default(''),
      responsible_person_id: id.nullish(), maintenance_due: date.nullish(), maintenance_note: str(500).default(''), note: str(2000).default(''), ...costFields,
    }),
    cols: ['name', 'type', 'address', 'responsible_person_id', 'maintenance_due', 'maintenance_note', 'note'],
  },
  vehicles: {
    perm: 'vehicle', asset: 'vehicle', label: (r) => `${r.make_model} (${r.plate})`,
    schema: z.object({
      plate: z.string().min(1).max(20), make_model: z.string().min(1).max(100), status: z.enum(['available', 'in_use', 'workshop', 'retired']).default('available'),
      service_due: date.nullish(), insurance_from: date.nullish(), note: str(2000).default(''), ...costFields,
    }),
    cols: ['plate', 'make_model', 'status', 'service_due', 'insurance_from', 'note'],
  },
  keys: {
    perm: 'key', asset: 'key', label: (r) => r.label,
    schema: z.object({
      code: z.string().min(1).max(30), label: z.string().min(1).max(100), kind: str(40).default('Haustür'), property_id: id.nullish(), vehicle_id: id.nullish(),
      copies: z.number().int().min(1).max(99).default(1), note: str(2000).default(''), ...costFields,
    }).refine((v) => v.property_id || v.vehicle_id, 'Haus oder Fahrzeug erforderlich'),
    cols: ['code', 'label', 'kind', 'property_id', 'vehicle_id', 'copies', 'note'],
  },
};
const COST_COLS = ['cost_amount', 'cost_interval', 'cost_budget_id', 'cost_category_id', 'cost_tracking'];
const PER = { monthly: ['monthly', 1], quarterly: ['monthly', 3], yearly: ['yearly', 1] };

// Kosten eines Objekts mit Budget synchronisieren (§7.1): einmalig = Buchung, sonst Dauerauftrag
async function syncCost(c, table, kind, before, after, userId) {
  const changed = !before || COST_COLS.some((k) => String(before[k] ?? '') !== String(after[k] ?? ''));
  if (!changed) return;
  if (before?.cost_recurring_id) {
    await c.query('UPDATE recurring_rules SET active=false WHERE id=$1', [before.cost_recurring_id]);
    await c.query('UPDATE recurring_rules SET end_date=$2 WHERE id=$1', [before.cost_recurring_id, today()]);
    await c.query(`UPDATE ${table} SET cost_recurring_id=NULL WHERE id=$1`, [after.id]);
  }
  if (!after.cost_amount || !after.cost_budget_id || after.cost_tracking === false) return;
  const label = KINDS[kind].label(after);
  const type = KINDS[kind].asset;
  if (after.cost_interval === 'once') {
    await c.query(
      `INSERT INTO transactions(budget_id, category_id, created_by, type, amount, booked_at, title, source, asset_type, asset_id) VALUES ($1,$2,$3,'expense',$4,$5,$6,'asset',$7,$8)`,
      [after.cost_budget_id, after.cost_category_id || null, userId, after.cost_amount, today(), `Kosten: ${label}`, type, after.id],
    );
    return;
  }
  const [freq, interval] = PER[after.cost_interval];
  const r = (
    await c.query(
      `INSERT INTO recurring_rules(name,budget_id,category_id,created_by,type,amount,frequency,interval,start_date,next_run,source,asset_type,asset_id)
       VALUES ($1,$2,$3,$4,'expense',$5,$6,$7,$8,$8,'asset',$9,$10) RETURNING id`,
      [`Kosten: ${label}`, after.cost_budget_id, after.cost_category_id || null, userId, after.cost_amount, freq, interval, today(), type, after.id],
    )
  ).rows[0];
  await c.query(`UPDATE ${table} SET cost_recurring_id=$2 WHERE id=$1`, [after.id, r.id]);
}

async function checkCostBudget(req, b) {
  if (!b.cost_amount) return;
  if (!b.cost_interval || !b.cost_budget_id) throw bad('Kosten benötigen Intervall und Budget');
  const { budget } = await budgetAccess(req.user.id, b.cost_budget_id, true);
  if (b.cost_category_id && !(await one('SELECT 1 FROM categories WHERE id=$1 AND budget_id=$2', [b.cost_category_id, budget.id]))) throw bad('Kategorie gehört nicht zum Budget');
}

const keyStatusSql = `
  SELECT k.*, p.name property_name, v.plate vehicle_plate, v.make_model vehicle_name,
    (SELECT count(*)::int FROM key_assignments a WHERE a.key_id=k.id AND a.returned_at IS NULL AND a.lost_at IS NULL) issued,
    (SELECT count(*)::int FROM key_assignments a WHERE a.key_id=k.id AND a.returned_at IS NULL AND a.lost_at IS NULL AND a.due_at < current_date) overdue,
    (SELECT count(*)::int FROM key_assignments a WHERE a.key_id=k.id AND a.returned_at IS NULL AND a.lost_at IS NOT NULL) lost,
    (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'copy_no', a.copy_no, 'person_id', a.person_id, 'person', pe.name, 'issued_at', a.issued_at, 'due_at', a.due_at, 'lost', a.lost_at IS NOT NULL, 'receipt_signed', a.receipt_signed) ORDER BY a.copy_no), '[]')
       FROM key_assignments a LEFT JOIN people pe ON pe.id=a.person_id WHERE a.key_id=k.id AND a.returned_at IS NULL) holders
  FROM keys k LEFT JOIN properties p ON p.id=k.property_id LEFT JOIN vehicles v ON v.id=k.vehicle_id`;
const withStatus = (k) => ({ ...k, status: k.lost > 0 ? 'lost' : k.overdue > 0 ? 'overdue' : k.issued > 0 ? 'out' : 'available' });

export default async function routes(app) {
  // ---- Personen
  const personSchema = z.object({
    name: z.string().min(1).max(100), kind: z.enum(['employee', 'external', 'family']).default('employee'), function: str(100).default(''),
    phone: str(40).default(''), email: z.union([z.string().email(), z.literal('')]).default(''), active: z.boolean().default(true), note: str(2000).default(''),
  });
  app.get('/people', authz('person:read'), async () =>
    many(`SELECT pe.*, (SELECT count(*)::int FROM key_assignments a WHERE a.person_id=pe.id AND a.returned_at IS NULL AND a.lost_at IS NULL) keys FROM people pe ORDER BY active DESC, name`));
  app.post('/people', authz('person:create'), async (req) => {
    const b = personSchema.parse(req.body);
    return one('INSERT INTO people(name,kind,function,phone,email,active,note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [b.name, b.kind, b.function, b.phone, b.email, b.active, b.note]);
  });
  app.patch('/people/:id', authz('person:update'), async (req) => {
    const b = personSchema.partial().parse(req.body);
    const keys = Object.keys(b);
    if (keys.length) await q(`UPDATE people SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [req.params.id, ...keys.map((k) => b[k])]);
    return { ok: true };
  });
  app.delete('/people/:id', authz('person:delete'), async (req) => {
    if (await one('SELECT 1 FROM key_assignments WHERE person_id=$1 AND returned_at IS NULL', [req.params.id])) throw bad('Person hat noch Schlüssel – zuerst zurücknehmen');
    await q('DELETE FROM people WHERE id=$1', [req.params.id]);
    return { ok: true };
  });

  // ---- Häuser / Fahrzeuge / Schlüssel
  for (const [path, K] of Object.entries(KINDS)) {
    const table = path;
    const kind = path;
    app.get(`/${path}`, authz(`${K.perm}:read`), async () => {
      if (path === 'keys') return (await many(`${keyStatusSql} ORDER BY k.label`)).map(withStatus);
      const rows = await many(`SELECT x.*, b.name cost_budget_name FROM ${table} x LEFT JOIN budgets b ON b.id=x.cost_budget_id ORDER BY 1`.replace('ORDER BY 1', path === 'vehicles' ? 'ORDER BY x.plate' : 'ORDER BY x.name'));
      return rows;
    });
    app.post(`/${path}`, authz(`${K.perm}:create`), async (req) => {
      const b = K.schema.parse(req.body);
      await checkCostBudget(req, b);
      const cols = [...K.cols, ...COST_COLS];
      try {
        const row = await tx(async (c) => {
          const r = (
            await c.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => b[k] ?? (k === 'cost_tracking' ? true : null))
          )).rows[0];
          await syncCost(c, table, kind, null, r, req.user.id);
          return r;
        });
        await audit(req, `${path}.created`, path, row.id);
        return { id: row.id };
      } catch (e) {
        if (e.code === '23505') throw bad('Eintrag mit dieser Kennung existiert bereits');
        throw e;
      }
    });
    app.patch(`/${path}/:id`, authz(`${K.perm}:update`), async (req) => {
      const before = await one(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
      if (!before) throw notFound();
      const schema = K.schema._def?.schema ? K.schema._def.schema.partial() : K.schema.partial();
      const b = schema.parse(req.body);
      const merged = { ...before, ...b };
      await checkCostBudget(req, merged);
      const keys = Object.keys(b).filter((k) => [...K.cols, ...COST_COLS].includes(k));
      await tx(async (c) => {
        let after = before;
        if (keys.length) after = (await c.query(`UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [before.id, ...keys.map((k) => b[k] ?? null)])).rows[0];
        await syncCost(c, table, kind, before, after, req.user.id);
      });
      await audit(req, `${path}.updated`, path, before.id);
      return { ok: true };
    });
    app.delete(`/${path}/:id`, authz(`${K.perm}:delete`), async (req) => {
      const before = await one(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
      if (!before) throw notFound();
      if (before.cost_recurring_id) await q('DELETE FROM recurring_rules WHERE id=$1', [before.cost_recurring_id]);
      if (path === 'keys' && (await one('SELECT 1 FROM key_assignments WHERE key_id=$1 AND returned_at IS NULL', [before.id]))) throw bad('Schlüssel ist ausgegeben');
      await q(`DELETE FROM ${table} WHERE id=$1`, [before.id]);
      await audit(req, `${path}.deleted`, path, before.id);
      return { ok: true };
    });
  }

  // ---- Schlüsselausgabe
  app.post('/keys/:id/assign', authz('key:assign'), async (req) => {
    const b = z.object({ person_id: id, due_at: date.nullish(), receipt_signed: z.boolean().default(false) }).parse(req.body);
    return tx(async (c) => {
      const k = (await c.query('SELECT * FROM keys WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      if (!k) throw notFound();
      const used = (await c.query('SELECT copy_no FROM key_assignments WHERE key_id=$1 AND returned_at IS NULL AND lost_at IS NULL', [k.id])).rows.map((r) => r.copy_no);
      const lost = (await c.query('SELECT copy_no FROM key_assignments WHERE key_id=$1 AND returned_at IS NULL AND lost_at IS NOT NULL', [k.id])).rows.map((r) => r.copy_no);
      let n = 1;
      while ((used.includes(n) || lost.includes(n)) && n <= k.copies) n++;
      if (n > k.copies) throw bad('Keine freie Kopie verfügbar');
      const person = (await c.query('SELECT active FROM people WHERE id=$1', [b.person_id])).rows[0];
      if (!person?.active) throw bad('Person ist nicht aktiv');
      const a = (await c.query('INSERT INTO key_assignments(key_id,person_id,copy_no,due_at,issued_by_user_id,receipt_signed) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [k.id, b.person_id, n, b.due_at || null, req.user.id, b.receipt_signed])).rows[0];
      await audit(req, 'key.issued', 'key', k.id, { person: b.person_id, copy: n });
      return { id: a.id, copy_no: n };
    });
  });
  for (const [action, set] of [['return', 'returned_at=now()'], ['lost', 'lost_at=now()']]) {
    app.post(`/assignments/:id/${action}`, authz('key:assign'), async (req) => {
      const r = await one(`UPDATE key_assignments SET ${set} WHERE id=$1 AND returned_at IS NULL ${action === 'lost' ? 'AND lost_at IS NULL' : ''} RETURNING key_id`, [req.params.id]);
      if (!r) throw notFound();
      await audit(req, `key.${action}`, 'key', r.key_id);
      return { ok: true };
    });
  }

  // ---- Übersicht / Kosten / Protokoll
  app.get('/assets/overview', authz('property:read'), async () => {
    const soon = addInterval(today(), 'daily', 30);
    const [counts, service, maint, keys] = await Promise.all([
      one(`SELECT (SELECT count(*)::int FROM properties) properties, (SELECT count(*)::int FROM vehicles) vehicles, (SELECT count(*)::int FROM keys) keys,
            (SELECT count(*)::int FROM people WHERE active) people, (SELECT count(*)::int FROM key_assignments WHERE returned_at IS NULL AND lost_at IS NULL) issued`),
      many('SELECT id, plate, make_model, service_due FROM vehicles WHERE service_due IS NOT NULL AND service_due <= $1 ORDER BY service_due', [soon]),
      many('SELECT id, name, maintenance_due, maintenance_note FROM properties WHERE maintenance_due IS NOT NULL AND maintenance_due <= $1 ORDER BY maintenance_due', [soon]),
      many(`SELECT k.id, k.label, a.due_at, a.copy_no, pe.name person, a.lost_at FROM key_assignments a JOIN keys k ON k.id=a.key_id LEFT JOIN people pe ON pe.id=a.person_id
            WHERE a.returned_at IS NULL AND (a.lost_at IS NOT NULL OR a.due_at < current_date) ORDER BY a.due_at`),
    ]);
    return { counts, vehicle_service: service, property_maintenance: maint, key_alerts: keys };
  });

  app.get('/assets/costs', authz('property:read'), async () => {
    const parts = ['properties:name:house', 'vehicles:make_model:vehicle', 'keys:label:key'].map((s) => s.split(':'));
    const items = [];
    for (const [t, col, type] of parts) {
      items.push(...(await many(`SELECT '${type}' type, x.id, x.${col} name, x.cost_amount amount, x.cost_interval interval, x.cost_tracking tracking, b.name budget_name FROM ${t} x LEFT JOIN budgets b ON b.id=x.cost_budget_id WHERE x.cost_amount IS NOT NULL`)));
    }
    const factor = { once: 0, monthly: 12, quarterly: 4, yearly: 1 };
    for (const i of items) i.yearly = (Number(i.amount) * factor[i.interval]).toFixed(2);
    return { items, yearly_total: items.reduce((s, i) => s + Number(i.yearly), 0).toFixed(2) };
  });

  app.get('/assets/log', authz('key:read'), async () =>
    many(
      `SELECT * FROM (
         SELECT a.issued_at at, 'issued' event, k.label, pe.name person, a.copy_no FROM key_assignments a JOIN keys k ON k.id=a.key_id LEFT JOIN people pe ON pe.id=a.person_id
         UNION ALL SELECT a.returned_at, 'returned', k.label, pe.name, a.copy_no FROM key_assignments a JOIN keys k ON k.id=a.key_id LEFT JOIN people pe ON pe.id=a.person_id WHERE a.returned_at IS NOT NULL
         UNION ALL SELECT a.lost_at, 'lost', k.label, pe.name, a.copy_no FROM key_assignments a JOIN keys k ON k.id=a.key_id LEFT JOIN people pe ON pe.id=a.person_id WHERE a.lost_at IS NOT NULL
       ) l ORDER BY at DESC LIMIT 200`,
    ));
}
