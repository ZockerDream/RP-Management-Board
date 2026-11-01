import { z } from 'zod';
import Holidays from 'date-holidays';
import { one, many, q } from '../db.js';
import { authz, bad, notFound, forbidden, accessibleBudgetIds } from '../authz.js';
import { nthOccurrence, addInterval, today } from '../lib.js';
import { config } from '../config.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const body = z.object({
  title: z.string().min(1).max(150), type: z.enum(['team', 'personal']), team_id: z.string().uuid().nullish(), date,
  start: time.nullish(), end: time.nullish(), allDay: z.boolean().default(false),
  repeat: z.enum(['none', 'weekly', 'monthly', 'yearly']).default('none'), remind: z.enum(['none', '1d', '3d', '7d', '14d']).default('none'),
  amount: z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined || v === '' ? null : String(v).replace(',', '.'))),
  note: z.string().max(2000).default(''),
});

const hd = new Holidays(process.env.HOLIDAY_COUNTRY || 'DE', process.env.HOLIDAY_REGION || undefined);

const shape = (e) => ({
  id: `own:${e.id}`, source: 'own', type: e.type, title: e.title, date: e.date, start: e.start_time, end: e.end_time, allDay: e.all_day,
  repeat: e.repeat, amount: e.amount, note: e.note, remind: e.remind, team_id: e.team_id, locked: false,
});
const ro = (id, type, title, d, extra = {}) => ({ id, source: type, type, title, date: d, start: null, end: null, allDay: true, repeat: 'none', amount: null, note: '', remind: 'none', locked: true, ...extra });

export async function buildFeed(userId, from, to) {
  const out = [];
  const own = await many(
    `SELECT * FROM calendar_events e WHERE (e.owner_id=$1 AND e.type='personal') OR (e.type='team' AND e.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1))`,
    [userId],
  );
  out.push(...own.map((e) => ({ ...shape(e), start: e.start_time, end: e.end_time })));

  const imported = await many(
    `SELECT provider, external_id, title, starts_at, ends_at, all_day FROM synced_calendar_events
     WHERE user_id=$1 AND (
       (all_day AND starts_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
         AND starts_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC'))
       OR (NOT all_day AND starts_at >= ($2::date::timestamp AT TIME ZONE $4)
         AND starts_at < (($3::date + 1)::timestamp AT TIME ZONE $4))
     )`,
    [userId, from, to, config.tz],
  );
  const dateInZone = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  out.push(...imported.map((event) => ({
    id: `sync:${event.provider}:${event.external_id}`, source: 'external', type: 'external',
    title: event.title, date: event.all_day ? new Date(event.starts_at).toISOString().slice(0, 10) : dateInZone(event.starts_at),
    start: event.all_day ? null : new Intl.DateTimeFormat('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(event.starts_at),
    end: event.ends_at && !event.all_day ? new Intl.DateTimeFormat('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(event.ends_at) : null,
    allDay: event.all_day, repeat: 'none', amount: null, note: event.provider === 'google' ? 'Google Kalender' : 'Outlook', remind: 'none', locked: true,
  })));

  const ids = await accessibleBudgetIds(userId);
  const rules = await many('SELECT * FROM recurring_rules WHERE active AND budget_id = ANY($1)', [ids]);
  for (const r of rules) {
    const simple = r.interval === 1 && ['weekly', 'monthly', 'yearly'].includes(r.frequency);
    const common = { amount: r.type === 'income' ? r.amount : `-${r.amount}`, note: '', locked: true, source: 'finance' };
    if (simple && !r.end_date) {
      out.push(ro(`rec:${r.id}`, 'finance', r.name, r.start_date, { ...common, repeat: r.frequency }));
    } else {
      for (let n = 0, d = r.start_date; d <= to && n < 800; n++, d = nthOccurrence(r.start_date, r.frequency, r.interval, n)) {
        if (r.end_date && d > r.end_date) break;
        if (d >= from) out.push(ro(`rec:${r.id}:${d}`, 'finance', r.name, d, common));
      }
    }
  }
  for (const v of await many(`SELECT id, plate, make_model, service_due, insurance_from FROM vehicles
    WHERE owner_user_id=$1 OR team_id IN (SELECT team_id FROM team_members WHERE user_id=$1)`, [userId])) {
    if (v.service_due) out.push(ro(`veh:${v.id}:service`, 'vehicle', `Service: ${v.make_model}`, v.service_due, { note: v.plate }));
    if (v.insurance_from) out.push(ro(`veh:${v.id}:ins`, 'vehicle', `Versicherung: ${v.make_model}`, v.insurance_from, { repeat: 'yearly', note: v.plate }));
  }
  for (const p of await many(`SELECT id, name, maintenance_due, maintenance_note FROM properties WHERE (owner_user_id=$1 OR team_id IN (SELECT team_id FROM team_members WHERE user_id=$1)) AND maintenance_due IS NOT NULL`, [userId])) {
    out.push(ro(`house:${p.id}`, 'house', `Wartung: ${p.name}`, p.maintenance_due, { note: p.maintenance_note }));
  }
  for (const a of await many(`SELECT a.id, a.due_at, k.label, pe.name person FROM key_assignments a JOIN keys k ON k.id=a.key_id
    LEFT JOIN people pe ON pe.id=a.person_id AND (pe.owner_user_id=$1 OR pe.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1))
    WHERE (k.owner_user_id=$1 OR k.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1)) AND a.returned_at IS NULL AND a.lost_at IS NULL AND a.due_at IS NOT NULL`, [userId])) {
    out.push(ro(`key:${a.id}`, 'key', `Rückgabe: ${a.label}`, a.due_at, { note: a.person || '' }));
  }
  for (const g of await many('SELECT id, name, target_date FROM goals WHERE target_date IS NOT NULL AND budget_id = ANY($1)', [ids])) {
    out.push(ro(`goal:${g.id}`, 'finance', `Sparziel: ${g.name}`, g.target_date));
  }
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const h of hd.getHolidays(y)) {
      if (!['public', 'bank'].includes(h.type)) continue;
      const d = h.date.slice(0, 10);
      if (d >= from && d <= to) out.push(ro(`hol:${d}`, 'holiday', h.name, d));
    }
  }
  return out;
}

const icsEsc = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

export default async function routes(app) {
  app.get('/calendar', authz('calendar:read'), async (req) => {
    const f = z.object({ from: date.optional(), to: date.optional() }).parse(req.query);
    const y = new Date().getUTCFullYear();
    return buildFeed(req.user.id, f.from || `${y - 1}-01-01`, f.to || `${y + 2}-12-31`);
  });

  async function resolveTeam(req, b) {
    if (b.type !== 'team') return null;
    const m = b.team_id
      ? await one('SELECT team_id, team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [b.team_id, req.user.id])
      : await one("SELECT team_id, team_role FROM team_members WHERE user_id=$1 AND team_role IN ('owner','editor') LIMIT 1", [req.user.id]);
    if (!m) throw bad('Kein Team für diesen Termin verfügbar');
    if (m.team_role === 'viewer') throw forbidden();
    return m.team_id;
  }

  app.post('/calendar/events', authz('calendar:create'), async (req) => {
    const b = body.parse(req.body);
    const teamId = await resolveTeam(req, b);
    const r = await one(
      `INSERT INTO calendar_events(owner_id,team_id,type,title,date,start_time,end_time,all_day,repeat,remind,amount,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [req.user.id, teamId, b.type, b.title, b.date, b.allDay ? null : b.start || null, b.allDay ? null : b.end || null, b.allDay, b.repeat, b.remind, b.amount, b.note],
    );
    return { id: `own:${r.id}` };
  });

  const getOwn = async (req) => {
    const raw = req.params.id.replace(/^own:/, '');
    if (!/^[0-9a-f-]{36}$/.test(raw)) throw notFound();
    const e = await one('SELECT * FROM calendar_events WHERE id=$1', [raw]);
    if (!e) throw notFound();
    if (e.type === 'personal' ? e.owner_id !== req.user.id : false) throw notFound();
    if (e.type === 'team') {
      const m = await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [e.team_id, req.user.id]);
      if (!m || (m.team_role === 'viewer' && e.owner_id !== req.user.id)) throw forbidden();
      if (m.team_role === 'viewer') throw forbidden();
    }
    return e;
  };

  app.put('/calendar/events/:id', authz('calendar:update'), async (req) => {
    const e = await getOwn(req);
    const b = body.parse(req.body);
    const teamId = b.type === 'team' ? (e.team_id ?? (await resolveTeam(req, b))) : null;
    await q(
      `UPDATE calendar_events SET type=$2,team_id=$3,title=$4,date=$5,start_time=$6,end_time=$7,all_day=$8,repeat=$9,remind=$10,amount=$11,note=$12,last_reminded=NULL WHERE id=$1`,
      [e.id, b.type, teamId, b.title, b.date, b.allDay ? null : b.start || null, b.allDay ? null : b.end || null, b.allDay, b.repeat, b.remind, b.amount, b.note],
    );
    return { ok: true };
  });

  app.delete('/calendar/events/:id', authz('calendar:delete'), async (req) => {
    const e = await getOwn(req);
    await q('DELETE FROM calendar_events WHERE id=$1', [e.id]);
    return { ok: true };
  });

  // Abo-Feed ohne Bearer: Zugriff über geheimen Token
  app.get('/calendar/ical/:token.ics', async (req, reply) => {
    const u = await one("SELECT id, name FROM users WHERE ical_token=$1 AND status='active' AND deleted_at IS NULL", [req.params.token]);
    if (!u) throw notFound();
    const from = addInterval(today(), 'monthly', -1);
    const to = addInterval(today(), 'yearly', 1);
    const feed = (await buildFeed(u.id, from, to)).filter((e) => e.type !== 'holiday');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Budget Manager//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:Budget Manager`];
    for (const e of feed) {
      const d = e.date.replaceAll('-', '');
      lines.push('BEGIN:VEVENT', `UID:${e.id}@budget-manager`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`);
      if (e.allDay || !e.start) lines.push(`DTSTART;VALUE=DATE:${d}`);
      else {
        lines.push(`DTSTART:${d}T${e.start.replace(':', '')}00`);
        if (e.end) lines.push(`DTEND:${d}T${e.end.replace(':', '')}00`);
      }
      if (e.repeat !== 'none') lines.push(`RRULE:FREQ=${e.repeat.toUpperCase()}`);
      lines.push(`SUMMARY:${icsEsc(e.title)}`);
      if (e.note) lines.push(`DESCRIPTION:${icsEsc(e.note)}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    reply.header('content-type', 'text/calendar; charset=utf-8').header('cache-control', 'private, max-age=300');
    return `${lines.join('\r\n')}\r\n`;
  });
}
