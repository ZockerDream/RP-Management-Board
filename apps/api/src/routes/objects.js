import { z } from 'zod';
import QRCode from 'qrcode';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, budgetAccess, forbidden } from '../authz.js';
import { addInterval, today } from '../lib.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { decrypt, encrypt, totpValid, verifyPassword } from '../security.js';

const money = z.union([z.string(), z.number()]).transform((v) => String(v).replace(',', '.')).refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Ungültiger Betrag');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().uuid();
const str = (n = 200) => z.string().max(n);
const ownerFields = { scope: z.enum(['personal', 'team']).default('personal'), team_id: id.nullish() };
const ownerSql = (alias, n = '$1') => `(${alias}.owner_user_id=${n} OR ${alias}.team_id IN (SELECT team_id FROM team_members WHERE user_id=${n}))`;

async function assertOwner(req, row, write = false) {
  if (row.owner_user_id === req.user.id) return;
  const member = row.team_id && await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [row.team_id, req.user.id]);
  if (!member || (write && member.team_role === 'viewer')) throw notFound();
}

async function ownerValues(req, body) {
  if (body.scope !== 'team') return { owner_user_id: req.user.id, team_id: null };
  if (!body.team_id) throw bad('Team erforderlich');
  const member = await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [body.team_id, req.user.id]);
  if (!member || member.team_role === 'viewer') throw bad('Keine Berechtigung für dieses Team');
  return { owner_user_id: null, team_id: body.team_id };
}
async function assertVisible(req, table, recordId) {
  if (!recordId) return;
  const row = await one(`SELECT x.owner_user_id,x.team_id FROM ${table} x WHERE x.id=$1 AND ${ownerSql('x', '$2')}`, [recordId, req.user.id]);
  if (!row || (row.owner_user_id !== req.user.id && !(await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2', [row.team_id, req.user.id])))) throw bad('Verknüpftes Objekt ist nicht verfügbar');
}

const costFields = {
  cost_amount: money.nullish(),
  cost_interval: z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly', 'custom']).nullish(),
  cost_interval_count: z.number().int().min(1).max(3650).nullish(),
  cost_budget_id: id.nullish(),
  cost_category_id: id.nullish(),
  cost_tracking: z.boolean().optional(),
};

const KINDS = {
  properties: {
    perm: 'property', asset: 'house', label: (r) => r.name,
    schema: z.object({
      name: z.string().min(1).max(100), type: z.enum(['home', 'office', 'storage', 'holiday']).default('home'), address: str(300).default(''), ...ownerFields,
      responsible_person_id: id.nullish(), maintenance_due: date.nullish(), maintenance_note: str(500).default(''), note: str(2000).default(''), ...costFields,
    }),
    cols: ['name', 'type', 'address', 'responsible_person_id', 'maintenance_due', 'maintenance_note', 'note'],
  },
  vehicles: {
    perm: 'vehicle', asset: 'vehicle', label: (r) => `${r.make_model} (${r.plate})`,
    schema: z.object({
      plate: z.string().min(1).max(20), make_model: z.string().min(1).max(100), status: z.enum(['available', 'in_use', 'workshop', 'retired']).default('available'), ...ownerFields,
      registered_owner: str(100).default(''), service_due: date.nullish(), odometer_km: z.number().int().min(0).nullish(), service_interval_km: z.number().int().min(1).nullish(), service_due_km: z.number().int().min(0).nullish(), first_aid_kit_expires_on: date.nullish(), note: str(2000).default(''), ...costFields,
    }),
    cols: ['plate', 'make_model', 'status', 'registered_owner', 'service_due', 'odometer_km', 'service_interval_km', 'service_due_km', 'first_aid_kit_expires_on', 'note'],
  },
  keys: {
    perm: 'key', asset: 'key', label: (r) => r.label,
    schema: z.object({
      code: z.string().min(1).max(30), label: z.string().min(1).max(100), kind: str(40).default('Haustür'), property_id: id.nullish(), vehicle_id: id.nullish(), ...ownerFields,
      copies: z.number().int().min(1).max(99).default(1), note: str(2000).default(''), ...costFields,
    }).refine((v) => v.property_id || v.vehicle_id, 'Haus oder Fahrzeug erforderlich'),
    cols: ['code', 'label', 'kind', 'property_id', 'vehicle_id', 'copies', 'note'],
  },
};
const COST_COLS = ['cost_amount', 'cost_interval', 'cost_interval_count', 'cost_budget_id', 'cost_category_id', 'cost_tracking'];
const PER = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly', custom: 'custom' };

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
    const existing = await c.query(
      `SELECT id FROM transactions
       WHERE source='asset' AND recurring_id IS NULL AND asset_type=$1 AND asset_id=$2
       ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
      [type, after.id],
    );
    if (existing.rows.length) {
      const current = existing.rows[0];
      await c.query(
        `UPDATE transactions SET budget_id=$2, category_id=$3, created_by=$4, amount=$5, title=$6
         WHERE id=$1`,
        [current.id, after.cost_budget_id, after.cost_category_id || null, userId, after.cost_amount, `Kosten: ${label}`],
      );
    } else {
      await c.query(
        `INSERT INTO transactions(budget_id, category_id, created_by, type, amount, booked_at, title, source, asset_type, asset_id) VALUES ($1,$2,$3,'expense',$4,$5,$6,'asset',$7,$8)`,
        [after.cost_budget_id, after.cost_category_id || null, userId, after.cost_amount, today(), `Kosten: ${label}`, type, after.id],
      );
    }
    return;
  }
  const freq = PER[after.cost_interval];
  const interval = after.cost_interval_count || 1;
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
    (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'copy_no', a.copy_no, 'person_id', pe.id, 'person', pe.name, 'issued_at', a.issued_at, 'due_at', a.due_at, 'lost', a.lost_at IS NOT NULL, 'receipt_signed', a.receipt_signed) ORDER BY a.copy_no), '[]')
       FROM key_assignments a LEFT JOIN people pe ON pe.id=a.person_id AND (pe.owner_user_id=$1 OR pe.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1)) WHERE a.key_id=k.id AND a.returned_at IS NULL) holders
  FROM keys k LEFT JOIN properties p ON p.id=k.property_id AND (p.owner_user_id=$1 OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1))
  LEFT JOIN vehicles v ON v.id=k.vehicle_id AND (v.owner_user_id=$1 OR v.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1))`;
const withStatus = (k) => ({ ...k, status: k.lost > 0 ? 'lost' : k.overdue > 0 ? 'overdue' : k.issued > 0 ? 'out' : 'available' });

export default async function routes(app) {
  // ---- Personen
  const personSchema = z.object({
    name: z.string().min(1).max(100), kind: z.enum(['employee', 'external', 'family']).default('employee'), function: str(100).default(''),
    phone: str(40).default(''), email: z.union([z.string().email(), z.literal('')]).default(''),     active: z.boolean().default(true), note: str(2000).default(''), ...ownerFields,
  });
  app.get('/people', authz('person:read'), async (req) =>
    many(`SELECT pe.*, (SELECT count(*)::int FROM key_assignments a JOIN keys k ON k.id=a.key_id
        WHERE a.person_id=pe.id AND ${ownerSql('k')} AND a.returned_at IS NULL AND a.lost_at IS NULL) keys
      FROM people pe WHERE ${ownerSql('pe')} ORDER BY active DESC, name`, [req.user.id]));
  app.post('/people', authz('person:create'), async (req) => {
    const b = personSchema.parse(req.body);
    const owner = await ownerValues(req, b);
    return one('INSERT INTO people(name,kind,function,phone,email,active,note,owner_user_id,team_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [b.name, b.kind, b.function, b.phone, b.email, b.active, b.note, owner.owner_user_id, owner.team_id]);
  });
  app.patch('/people/:id', authz('person:update'), async (req) => {
    const before = await one('SELECT * FROM people WHERE id=$1', [req.params.id]);
    if (!before) throw notFound();
    await assertOwner(req, before, true);
    const b = personSchema.partial().parse(req.body);
    const patch = { ...b };
    if (patch.scope) Object.assign(patch, await ownerValues(req, { scope: patch.scope, team_id: patch.team_id }));
    delete patch.scope;
    delete patch.team_id;
    const keys = Object.keys(patch);
    if (keys.length) await q(`UPDATE people SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [req.params.id, ...keys.map((key) => patch[key])]);
    return { ok: true };
  });
  app.delete('/people/:id', authz('person:delete'), async (req) => {
    const person = await one('SELECT * FROM people WHERE id=$1', [req.params.id]);
    if (!person) throw notFound();
    await assertOwner(req, person, true);
    if (await one('SELECT 1 FROM key_assignments WHERE person_id=$1 AND returned_at IS NULL', [req.params.id])) throw bad('Person hat noch Schlüssel – zuerst zurücknehmen');
    await q('DELETE FROM people WHERE id=$1', [req.params.id]);
    return { ok: true };
  });

  // ---- Häuser / Fahrzeuge / Schlüssel
  for (const [path, K] of Object.entries(KINDS)) {
    const table = path;
    const kind = path;
    app.get(`/${path}`, authz(`${K.perm}:read`), async (req) => {
      if (path === 'keys') return (await many(`${keyStatusSql} WHERE ${ownerSql('k')} ORDER BY k.label`, [req.user.id])).map(withStatus);
      const rows = await many(`SELECT x.*, b.name cost_budget_name FROM ${table} x LEFT JOIN budgets b ON b.id=x.cost_budget_id WHERE ${ownerSql('x')} ORDER BY ${path === 'vehicles' ? 'x.plate' : 'x.name'}`, [req.user.id]);
      if (path === 'properties') return rows.map(({ door_pin_enc, ...property }) => property);
      return rows;
    });
    app.post(`/${path}`, authz(`${K.perm}:create`), async (req) => {
      const b = K.schema.parse(req.body);
      const owner = await ownerValues(req, b);
      if (b.property_id) await assertVisible(req, 'properties', b.property_id);
      if (b.vehicle_id) await assertVisible(req, 'vehicles', b.vehicle_id);
      if (b.responsible_person_id) await assertVisible(req, 'people', b.responsible_person_id);
      await checkCostBudget(req, b);
      const cols = [...K.cols, ...COST_COLS, 'owner_user_id', 'team_id'];
      try {
        const row = await tx(async (c) => {
          const r = (
            await c.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => k === 'owner_user_id' ? owner.owner_user_id : k === 'team_id' ? owner.team_id : b[k] ?? (k === 'cost_tracking' ? true : k === 'cost_interval_count' ? 1 : null))
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
      await assertOwner(req, before, true);
      const schema = K.schema._def?.schema ? K.schema._def.schema.partial() : K.schema.partial();
      const b = schema.parse(req.body);
      const merged = { ...before, ...b };
      if (merged.property_id) await assertVisible(req, 'properties', merged.property_id);
      if (merged.vehicle_id) await assertVisible(req, 'vehicles', merged.vehicle_id);
      if (merged.responsible_person_id) await assertVisible(req, 'people', merged.responsible_person_id);
      await checkCostBudget(req, merged);
      const patch = { ...b };
      if (patch.scope) Object.assign(patch, await ownerValues(req, { scope: patch.scope, team_id: patch.team_id }));
      delete patch.scope;
      delete patch.team_id;
      const keys = Object.keys(patch).filter((k) => [...K.cols, ...COST_COLS, 'owner_user_id', 'team_id'].includes(k));
      await tx(async (c) => {
        let after = before;
        if (keys.length) after = (await c.query(`UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [before.id, ...keys.map((k) => k === 'cost_interval_count' ? patch[k] ?? 1 : patch[k] ?? null)])).rows[0];
        await syncCost(c, table, kind, before, after, req.user.id);
      });
      await audit(req, `${path}.updated`, path, before.id);
      return { ok: true };
    });
    app.delete(`/${path}/:id`, authz(`${K.perm}:delete`), async (req) => {
      const before = await one(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
      if (!before) throw notFound();
      await assertOwner(req, before, true);
      if (before.cost_recurring_id) await q('DELETE FROM recurring_rules WHERE id=$1', [before.cost_recurring_id]);
      if (path === 'keys' && (await one('SELECT 1 FROM key_assignments WHERE key_id=$1 AND returned_at IS NULL', [before.id]))) throw bad('Schlüssel ist ausgegeben');
      await q(`DELETE FROM ${table} WHERE id=$1`, [before.id]);
      await audit(req, `${path}.deleted`, path, before.id);
      return { ok: true };
    });
  }

  async function reauthenticatePin(req, credentials) {
    if (req.viaApiKey) throw forbidden('Tür-PINs sind nur in einer angemeldeten Sitzung verfügbar');
    if (!req.user.password_hash || !(await verifyPassword(req.user.password_hash, credentials.password))) {
      throw bad('Passwort ist falsch', 'wrong_password');
    }
    if (req.user.totp_enabled && (!credentials.code || !req.user.totp_secret_enc || !totpValid(decrypt(req.user.totp_secret_enc), credentials.code))) {
      throw bad('2FA-Code ist ungültig', 'invalid_code');
    }
  }
  async function recordPinAccess(req, propertyId, action) {
    await q(
      'INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,ip,details) VALUES ($1,$2,$3,\'property\',$4,$5,$6)',
      [req.user.id, req.user.name, `property.pin.${action}`, propertyId, req.ip, JSON.stringify({ field: 'door_pin' })],
    );
  }
  app.post('/properties/:id/pin/reveal', {
    ...authz('property:read'),
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req) => {
    const credentials = z.object({ password: z.string().min(1), code: z.string().max(10).optional() }).parse(req.body);
    await reauthenticatePin(req, credentials);
    const property = await one(`SELECT * FROM properties p WHERE p.id=$1 AND ${ownerSql('p')}`, [req.params.id, req.user.id]);
    if (!property || !property.door_pin_enc) throw notFound('Kein Tür-PIN hinterlegt');
    await recordPinAccess(req, property.id, 'revealed');
    return { pin: decrypt(property.door_pin_enc) };
  });
  app.post('/properties/:id/pin', {
    ...authz('property:update'),
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req) => {
    const body = z.object({ pin: z.string().max(80), password: z.string().min(1), code: z.string().max(10).optional() }).parse(req.body);
    await reauthenticatePin(req, body);
    const property = await one('SELECT * FROM properties WHERE id=$1', [req.params.id]);
    if (!property) throw notFound();
    await assertOwner(req, property, true);
    await tx(async (client) => {
      await client.query('UPDATE properties SET door_pin_enc=$2 WHERE id=$1', [property.id, body.pin ? encrypt(body.pin) : null]);
      await client.query(
        'INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,ip,details) VALUES ($1,$2,$3,\'property\',$4,$5,$6)',
        [req.user.id, req.user.name, `property.pin.${body.pin ? 'updated' : 'removed'}`, property.id, req.ip, JSON.stringify({ field: 'door_pin' })],
      );
    });
    return { ok: true };
  });

  app.get('/keys/:id/qr', authz('key:read'), async (req) => {
    const key = await one(`SELECT k.id FROM keys k WHERE k.id=$1 AND ${ownerSql('k')}`, [req.params.id, req.user.id]);
    if (!key) throw notFound();
    const url = `${config.appUrl}/#/assets?tab=keys&key=${encodeURIComponent(key.id)}`;
    return { image: await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 320 }) };
  });

  // ---- Schlüsselausgabe
  app.post('/keys/:id/assign', authz('key:assign'), async (req) => {
    const b = z.object({ person_id: id, due_at: date.nullish(), receipt_signed: z.boolean().default(false) }).parse(req.body);
    return tx(async (c) => {
      const k = (await c.query('SELECT * FROM keys WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      if (!k) throw notFound();
      await assertOwner(req, k, true);
      const used = (await c.query('SELECT copy_no FROM key_assignments WHERE key_id=$1 AND returned_at IS NULL AND lost_at IS NULL', [k.id])).rows.map((r) => r.copy_no);
      const lost = (await c.query('SELECT copy_no FROM key_assignments WHERE key_id=$1 AND returned_at IS NULL AND lost_at IS NOT NULL', [k.id])).rows.map((r) => r.copy_no);
      let n = 1;
      while ((used.includes(n) || lost.includes(n)) && n <= k.copies) n++;
      if (n > k.copies) throw bad('Keine freie Kopie verfügbar');
      const person = (await c.query(`SELECT active FROM people pe WHERE pe.id=$1 AND ${ownerSql('pe', '$2')}`, [b.person_id, req.user.id])).rows[0];
      if (!person?.active) throw bad('Person ist nicht aktiv');
      const a = (await c.query('INSERT INTO key_assignments(key_id,person_id,copy_no,due_at,issued_by_user_id,receipt_signed) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [k.id, b.person_id, n, b.due_at || null, req.user.id, b.receipt_signed])).rows[0];
      await audit(req, 'key.issued', 'key', k.id, { person: b.person_id, copy: n });
      return { id: a.id, copy_no: n };
    });
  });
  for (const [action, set] of [['return', 'returned_at=now()'], ['lost', 'lost_at=now()']]) {
    app.post(`/assignments/:id/${action}`, authz('key:assign'), async (req) => {
      const r = await one(`UPDATE key_assignments a SET ${set} FROM keys k WHERE a.key_id=k.id AND a.id=$1 AND ${ownerSql('k', '$2')} AND a.returned_at IS NULL ${action === 'lost' ? 'AND a.lost_at IS NULL' : ''} RETURNING a.key_id`, [req.params.id, req.user.id]);
      if (!r) throw notFound();
      await audit(req, `key.${action}`, 'key', r.key_id);
      return { ok: true };
    });
  }

  // ---- Übersicht / Kosten / Protokoll
  app.get('/assets/overview', authz('property:read'), async (req) => {
    const soon = addInterval(today(), 'daily', 30);
    const [counts, service, maint, keys] = await Promise.all([
      one(`SELECT (SELECT count(*)::int FROM properties p WHERE ${ownerSql('p')}) properties,
            (SELECT count(*)::int FROM vehicles v WHERE ${ownerSql('v')}) vehicles, (SELECT count(*)::int FROM keys k WHERE ${ownerSql('k')}) keys,
            (SELECT count(*)::int FROM people pe WHERE pe.active AND ${ownerSql('pe')}) people,
            (SELECT count(*)::int FROM key_assignments a JOIN keys k ON k.id=a.key_id WHERE ${ownerSql('k')} AND a.returned_at IS NULL AND a.lost_at IS NULL) issued`, [req.user.id]),
      many(`SELECT id, plate, make_model, service_due, odometer_km, service_due_km FROM vehicles v
        WHERE ${ownerSql('v')} AND (
          (service_due IS NOT NULL AND service_due <= $2)
          OR (odometer_km IS NOT NULL AND service_due_km IS NOT NULL AND odometer_km >= service_due_km)
        ) ORDER BY service_due NULLS LAST, service_due_km`, [req.user.id, soon]),
      many(`SELECT id, name, maintenance_due, maintenance_note FROM properties p WHERE ${ownerSql('p')} AND maintenance_due IS NOT NULL AND maintenance_due <= $2 ORDER BY maintenance_due`, [req.user.id, soon]),
      many(`SELECT k.id, k.label, a.due_at, a.copy_no, pe.name person, a.lost_at FROM key_assignments a JOIN keys k ON k.id=a.key_id
            LEFT JOIN people pe ON pe.id=a.person_id AND ${ownerSql('pe', '$2')}
            WHERE ${ownerSql('k')} AND a.returned_at IS NULL AND (a.lost_at IS NOT NULL OR a.due_at < current_date) ORDER BY a.due_at`, [req.user.id, req.user.id]),
    ]);
    return { counts, vehicle_service: service, property_maintenance: maint, key_alerts: keys };
  });

  app.get('/assets/costs', authz('property:read'), async (req) => {
    const parts = ['properties:name:house', 'vehicles:make_model:vehicle', 'keys:label:key'].map((s) => s.split(':'));
    const items = [];
    for (const [t, col, type] of parts) {
      items.push(...(await many(`SELECT '${type}' type, x.id, x.${col} name, x.cost_amount amount, x.cost_interval interval, x.cost_interval_count interval_count, x.cost_tracking tracking, b.name budget_name FROM ${t} x LEFT JOIN budgets b ON b.id=x.cost_budget_id WHERE ${ownerSql('x')} AND x.cost_amount IS NOT NULL`, [req.user.id])));
    }
    const factor = { once: 0, daily: 365, weekly: 52, monthly: 12, yearly: 1 };
    for (const i of items) i.yearly = (Number(i.amount) * (i.interval === 'custom' ? 365 : factor[i.interval]) / Number(i.interval_count || 1)).toFixed(2);
    return { items, yearly_total: items.reduce((s, i) => s + Number(i.yearly), 0).toFixed(2) };
  });

  app.get('/assets/log', authz('key:read'), async (req) =>
    many(
      `SELECT * FROM (
         SELECT a.issued_at at, 'issued' event, k.label, pe.name person, a.copy_no FROM key_assignments a JOIN keys k ON k.id=a.key_id LEFT JOIN people pe ON pe.id=a.person_id AND ${ownerSql('pe', '$1')} WHERE ${ownerSql('k')}
         UNION ALL SELECT a.returned_at, 'returned', k.label, pe.name, a.copy_no FROM key_assignments a JOIN keys k ON k.id=a.key_id LEFT JOIN people pe ON pe.id=a.person_id AND ${ownerSql('pe', '$1')} WHERE ${ownerSql('k')} AND a.returned_at IS NOT NULL
         UNION ALL SELECT a.lost_at, 'lost', k.label, pe.name, a.copy_no FROM key_assignments a JOIN keys k ON k.id=a.key_id LEFT JOIN people pe ON pe.id=a.person_id AND ${ownerSql('pe', '$1')} WHERE ${ownerSql('k')} AND a.lost_at IS NOT NULL
       ) l ORDER BY at DESC LIMIT 200`, [req.user.id],
    ));
}
