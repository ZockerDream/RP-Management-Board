import { one, many, q } from './db.js';
import { hmac, decrypt } from './security.js';

export const ymd = (d) => d.toISOString().slice(0, 10);
export const today = () => ymd(new Date());
const parse = (s) => new Date(`${s}T00:00:00Z`);

export function addInterval(dateStr, freq, interval = 1) {
  const d = parse(dateStr);
  const day = d.getUTCDate();
  if (freq === 'daily') d.setUTCDate(day + interval);
  else if (freq === 'weekly') d.setUTCDate(day + 7 * interval);
  else {
    const months = freq === 'yearly' ? 12 * interval : interval;
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return ymd(d);
}

// n-te Wiederholung relativ zum Startdatum (verhindert Tagesdrift 31. → 28. → 28.)
export function nthOccurrence(start, freq, interval, n) {
  const d = parse(start);
  if (freq === 'daily') d.setUTCDate(d.getUTCDate() + interval * n);
  else if (freq === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * interval * n);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (freq === 'yearly' ? 12 : 1) * interval * n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return ymd(d);
}

export function periodRange(b, ref = new Date()) {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  if (b.period_type === 'daily') {
    const date = ymd(ref);
    return [date, date];
  }
  if (b.period_type === 'weekly') {
    const start = new Date(Date.UTC(y, m, ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7)));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6));
    return [ymd(start), ymd(end)];
  }
  if (b.period_type === 'monthly') return [ymd(new Date(Date.UTC(y, m, 1))), ymd(new Date(Date.UTC(y, m + 1, 0)))];
  if (b.period_type === 'yearly') return [`${y}-01-01`, `${y}-12-31`];
  if (b.period_type === 'custom') return [b.period_start || '0001-01-01', b.period_end || '9999-12-31'];
  return ['0001-01-01', '9999-12-31'];
}

export async function budgetUsed(b) {
  const [from, to] = periodRange(b);
  const type = b.period_type === 'goal' ? 'deposit' : 'expense';
  const r = await one('SELECT COALESCE(sum(amount),0) s FROM transactions WHERE budget_id=$1 AND type=$2 AND booked_at BETWEEN $3 AND $4', [b.id, type, from, to]);
  return r.s;
}

async function recipients(budget) {
  if (budget.type === 'solo') return [budget.owner_user_id];
  return (await many('SELECT user_id FROM team_members WHERE team_id=$1 AND team_role IN (\'owner\',\'editor\')', [budget.team_id])).map((r) => r.user_id);
}

export async function notify(userId, kind, title, body, dedupe) {
  await q('INSERT INTO notifications(user_id, kind, title, body, dedupe_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [userId, kind, title, body, dedupe || null]);
}

export async function fireWebhooks(event, payload, log) {
  const hooks = await many('SELECT * FROM webhooks WHERE active AND $1 = ANY(events)', [event]);
  for (const h of hooks) {
    const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
    try {
      const secret = decrypt(h.secret_enc);
      await fetch(h.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bm-signature': `sha256=${hmac(secret, body)}` },
        body,
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
    } catch (e) {
      log?.warn?.(`Webhook ${h.url} fehlgeschlagen: ${e.message}`);
    }
  }
}

// 80 % / 100 %-Warnungen je Periode genau einmal
export async function budgetWatch(budgetId, log) {
  const b = await one('SELECT * FROM budgets WHERE id=$1', [budgetId]);
  if (!b || b.period_type === 'goal' || Number(b.limit_amount) <= 0) return;
  const used = Number(await budgetUsed(b));
  const pct = (used / Number(b.limit_amount)) * 100;
  const [from] = periodRange(b);
  for (const [level, kind] of [[100, 'budget_exceeded'], [80, 'budget_80']]) {
    if (pct < level) continue;
    const title = level === 100 ? `Budget „${b.name}“ überschritten` : `Budget „${b.name}“ zu ${Math.floor(pct)} % ausgeschöpft`;
    for (const uid of await recipients(b)) await notify(uid, kind, title, `${used.toFixed(2)} von ${b.limit_amount} ${b.currency}`, `${kind}:${b.id}:${from}`);
    await fireWebhooks(kind, { budget_id: b.id, name: b.name, used, limit: b.limit_amount }, log);
    break;
  }
}

export const csvEscape = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV-Injection verhindern
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows, cols) =>
  `\uFEFF${[cols.join(';'), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(';'))].join('\r\n')}\r\n`;
