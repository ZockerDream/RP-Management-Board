import { one, many, q, tx } from './db.js';
import { config } from './config.js';
import { nthOccurrence, today, ymd, notify, budgetWatch, addInterval } from './lib.js';
import { sendMail } from './mail.js';
import { runBackup, pruneBackups } from './backup.js';
import { getSetting } from './settings.js';
import { calculateDailyPayroll } from './payroll.js';

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function previousDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return ymd(value);
}

function mondayOf(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return ymd(value);
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return ymd(value);
}

export async function payrollRun(log) {
  const yesterday = previousDate(localDate());
  const users = await many(
    `SELECT u.id, u.weekly_work_hours, u.hourly_rate, u.overtime_surcharge_percent,
            u.payroll_budget_id, u.payroll_start_date, b.currency
     FROM users u JOIN budgets b ON b.id=u.payroll_budget_id
     WHERE u.status='active' AND u.deleted_at IS NULL AND u.payroll_start_date <= $1
       AND b.type='solo' AND b.owner_user_id=u.id AND b.archived=false
     ORDER BY u.id`,
    [yesterday],
  );
  let processed = 0;
  for (const user of users) {
    const firstDate = String(user.payroll_start_date).slice(0, 10);
    const hoursFrom = mondayOf(firstDate);
    const workDays = await many(
      `SELECT work_date, sum(hours) hours FROM work_entries
       WHERE user_id=$1 AND work_date BETWEEN $2 AND $3
       GROUP BY work_date ORDER BY work_date`,
      [user.id, hoursFrom, yesterday],
    );
    const hoursByDate = new Map(workDays.map((row) => [String(row.work_date).slice(0, 10), Number(row.hours)]));
    const paidDays = new Set((await many(
      'SELECT payroll_date FROM payroll_payments WHERE user_id=$1 AND payroll_date BETWEEN $2 AND $3',
      [user.id, firstDate, yesterday],
    )).map((row) => String(row.payroll_date).slice(0, 10)));
    let weekHours = 0;
    let currentWeek = null;
    for (let date = hoursFrom; date <= yesterday; date = nextDate(date)) {
      const week = mondayOf(date);
      if (week !== currentWeek) {
        weekHours = 0;
        currentWeek = week;
      }
      const todayHours = hoursByDate.get(date) || 0;
      if (date >= firstDate && !paidDays.has(date)) {
        const payment = calculateDailyPayroll({
          date,
          weeklyTarget: Number(user.weekly_work_hours),
          hourlyRate: Number(user.hourly_rate),
          surchargePercent: Number(user.overtime_surcharge_percent),
          previousWeekHours: weekHours,
          todayHours,
        });
        await tx(async (client) => {
          const reservation = await client.query(
            `INSERT INTO payroll_payments(user_id,payroll_date,budget_id,base_amount,overtime_hours,overtime_pay)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,payroll_date) DO NOTHING RETURNING id`,
            [user.id, date, user.payroll_budget_id, payment.base_amount, payment.overtime_hours, payment.overtime_pay],
          );
          if (!reservation.rowCount) return;
          if (Number(payment.total_amount) > 0) {
            const transaction = await client.query(
              `INSERT INTO transactions(budget_id,created_by,type,amount,booked_at,title,note,source,income_kind)
               VALUES ($1,$2,'income',$3,$4,$5,$6,'payroll','salary') RETURNING id`,
              [
                user.payroll_budget_id, user.id, payment.total_amount, date,
                `Basisgehalt${Number(payment.overtime_pay) > 0 ? ' und Überstundenvergütung' : ''}`,
                Number(payment.overtime_pay) > 0
                  ? `${payment.base_amount} ${user.currency} Basisgehalt; ${payment.overtime_pay} ${user.currency} Überstundenvergütung für ${payment.overtime_hours} Stunden (Stundenlohn plus ${user.overtime_surcharge_percent} %)`
                  : `${payment.base_amount} ${user.currency} tägliches Basisgehalt`,
              ],
            );
            await client.query('UPDATE payroll_payments SET transaction_id=$2 WHERE id=$1', [reservation.rows[0].id, transaction.rows[0].id]);
          }
        });
        processed++;
      }
      weekHours += todayHours;
    }
  }
  log.info(`Gehaltsbuchungen für ${yesterday}: ${processed}`);
  return `${processed} tägliche Gehaltsbuchungen`;
}

export async function recurringRun(log) {
  const t = today();
  const rules = await many('SELECT * FROM recurring_rules WHERE active AND next_run <= $1', [t]);
  let booked = 0;
  const watch = new Set();
  for (const r of rules) {
    let n = 0;
    let d = r.start_date;
    while (d <= t && n < 2000) {
      if (r.end_date && d > r.end_date) break;
      if (d >= r.next_run) {
        const res = await q(
          `INSERT INTO transactions(budget_id,category_id,created_by,type,amount,booked_at,title,source,recurring_id,asset_type,asset_id,income_kind)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
          [r.budget_id, r.category_id, r.created_by, r.type, r.amount, d, r.name, r.source === 'asset' ? 'asset' : 'recurring', r.id, r.asset_type, r.asset_id, r.income_kind || 'other'],
        );
        booked += res.rowCount;
        if (r.type === 'expense') watch.add(r.budget_id);
        if (r.recipient_status === 'accepted' && r.recipient_budget_id) {
          const shared = await q(
            `INSERT INTO transactions(budget_id,category_id,created_by,type,amount,booked_at,title,source,recurring_id,income_kind)
             VALUES ($1,NULL,$2,$3,$4,$5,$6,'recurring',$7,$8) ON CONFLICT DO NOTHING`,
            [r.recipient_budget_id, r.created_by, r.type, r.amount, d, r.name, r.id, r.income_kind || 'other'],
          );
          booked += shared.rowCount;
          if (r.type === 'expense') watch.add(r.recipient_budget_id);
        }
      }
      n++;
      d = nthOccurrence(r.start_date, r.frequency, r.interval, n);
    }
    const finished = r.end_date && d > r.end_date;
    await q('UPDATE recurring_rules SET next_run=$2, active=$3 WHERE id=$1', [r.id, d, !finished]);
  }
  for (const b of watch) await budgetWatch(b, log);
  return `${booked} Buchungen`;
}

const REMIND_DAYS = { '1d': 1, '3d': 3, '7d': 7, '14d': 14 };
function nextOccurrence(e, from) {
  if (e.repeat === 'none') return e.date >= from ? e.date : null;
  let n = 0;
  let d = e.date;
  while (d < from && n < 5000) d = nthOccurrence(e.date, e.repeat, e.repeat_interval || 1, ++n);
  return d;
}

export async function reminders(log) {
  const t = today();
  let sent = 0;
  const events = await many("SELECT * FROM calendar_events WHERE remind <> 'none'");
  for (const e of events) {
    const occ = nextOccurrence(e, t);
    if (!occ || e.last_reminded === occ) continue;
    const days = Math.round((new Date(occ) - new Date(t)) / 86400000);
    if (days > REMIND_DAYS[e.remind]) continue;
    const users = e.type === 'team' ? (await many('SELECT user_id FROM team_members WHERE team_id=$1', [e.team_id])).map((r) => r.user_id) : [e.owner_id];
    for (const uid of users) {
      await notify(uid, 'calendar', `Termin: ${e.title}`, days === 0 ? 'Heute' : `In ${days} Tag(en) – ${occ}`, `cal:${e.id}:${occ}`);
      const u = await one('SELECT email, name FROM users WHERE id=$1', [uid]);
      const pref = await one("SELECT email FROM notification_prefs WHERE user_id=$1 AND kind='calendar'", [uid]);
      if (pref?.email) await sendMail({ to: u.email, subject: `Erinnerung: ${e.title}`, text: `${e.title} am ${occ}\n${e.note || ''}`, log });
    }
    await q('UPDATE calendar_events SET last_reminded=$2 WHERE id=$1', [e.id, occ]);
    sent++;
  }
  const soon = addInterval(t, 'daily', 14);
  const kitSoon = addInterval(t, 'daily', 30);
  for (const v of await many(`SELECT id, plate, make_model, service_due, odometer_km, service_due_km, first_aid_kit_expires_on, owner_user_id, team_id
    FROM vehicles WHERE (service_due IS NOT NULL AND service_due <= $2)
      OR (odometer_km IS NOT NULL AND service_due_km IS NOT NULL AND odometer_km >= service_due_km)
      OR (first_aid_kit_expires_on IS NOT NULL AND first_aid_kit_expires_on <= $3)`, [t, soon, kitSoon])) {
    const users = v.owner_user_id
      ? [v.owner_user_id]
      : (await many('SELECT user_id FROM team_members WHERE team_id=$1', [v.team_id])).map((member) => member.user_id);
    for (const userId of users) {
      const details = [
        v.service_due ? `Datum: ${v.service_due}` : null,
        v.service_due_km != null ? `Fällig bei ${Number(v.service_due_km).toLocaleString('de-DE')} km${v.odometer_km != null ? ` (aktuell ${Number(v.odometer_km).toLocaleString('de-DE')} km)` : ''}` : null,
      ].filter(Boolean).join(' · ');
      const key = v.service_due_km != null && v.odometer_km != null && v.odometer_km >= v.service_due_km
        ? `veh:${v.id}:km:${v.service_due_km}`
        : `veh:${v.id}:${v.service_due}`;
      if (v.service_due && v.service_due <= soon || (v.odometer_km != null && v.service_due_km != null && v.odometer_km >= v.service_due_km)) {
        await notify(userId, 'vehicle_service', `Service fällig: ${v.make_model}`, `${v.plate} – ${details}`, key);
      }
      if (v.first_aid_kit_expires_on && v.first_aid_kit_expires_on <= kitSoon) {
        const status = v.first_aid_kit_expires_on < t ? 'abgelaufen' : `läuft am ${v.first_aid_kit_expires_on} ab`;
        await notify(userId, 'first_aid_kit', `Verbandskasten: ${v.make_model}`, `${v.plate} – ${status}`, `veh:${v.id}:kit:${v.first_aid_kit_expires_on}`);
      }
    }
  }
  for (const a of await many(`SELECT a.id, k.label, k.owner_user_id, k.team_id, a.due_at FROM key_assignments a JOIN keys k ON k.id=a.key_id
    WHERE a.returned_at IS NULL AND a.lost_at IS NULL AND a.due_at IS NOT NULL AND a.due_at <= $2`, [t, soon])) {
    const users = a.owner_user_id
      ? [a.owner_user_id]
      : (await many('SELECT user_id FROM team_members WHERE team_id=$1', [a.team_id])).map((member) => member.user_id);
    for (const userId of users) {
      const body = a.due_at < t ? `Überfällig seit ${a.due_at}` : `Rückgabe bis ${a.due_at}`;
      await notify(userId, 'key_overdue', `Schlüssel-Rückgabe: ${a.label}`, body, `key:${a.id}:${userId}`);
    }
  }
  return `${sent} Erinnerungen`;
}

export async function reportsRun(log) {
  const t = today();
  let n = 0;
  for (const r of await many('SELECT r.*, u.email, u.name FROM saved_reports r JOIN users u ON u.id=r.owner_id WHERE r.active')) {
    const interval = r.rhythm_interval || 1;
    if (r.last_run && addInterval(String(r.last_run).slice(0, 10), r.rhythm, interval) > t) continue;
    const from = addInterval(t, r.rhythm, -interval);
    const rows = await many(
      `SELECT COALESCE(c.name,'Ohne Kategorie') name, sum(t.amount) total FROM transactions t JOIN budgets b ON b.id=t.budget_id LEFT JOIN categories c ON c.id=t.category_id
       WHERE t.type='expense' AND t.booked_at BETWEEN $2 AND $3 AND ((b.type='solo' AND b.owner_user_id=$1) OR b.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1))
       GROUP BY 1 ORDER BY 2 DESC`,
      [r.owner_id, from, t],
    );
    const text = `Bericht ${r.kind} (${from} – ${t})\n\n${rows.map((x) => `${x.name}: ${x.total} €`).join('\n') || 'Keine Ausgaben im Zeitraum.'}\n`;
    for (const to of new Set([r.email, ...r.recipients])) await sendMail({ to, subject: `Budget Manager – ${r.kind}-Bericht`, text, log });
    await q('UPDATE saved_reports SET last_run=$2 WHERE id=$1', [r.id, t]);
    n++;
  }
  return `${n} Berichte`;
}

export async function backupJob(log) {
  const b = await runBackup(null, log);
  const pruned = await pruneBackups();
  return `${b.filename}, ${pruned} alte gelöscht`;
}

export async function retention() {
  const [audit, notif, sess] = await Promise.all([getSetting('retention.audit_days'), getSetting('retention.notifications_days'), getSetting('retention.sessions_days')]);
  await q("DELETE FROM audit_log WHERE created_at < now() - ($1 || ' days')::interval", [String(audit)]);
  await q("DELETE FROM notifications WHERE created_at < now() - ($1 || ' days')::interval", [String(notif)]);
  await q("DELETE FROM sessions WHERE (revoked_at IS NOT NULL OR expires_at < now()) AND COALESCE(revoked_at, expires_at) < now() - ($1 || ' days')::interval", [String(sess)]);
  await q("DELETE FROM idempotency_keys WHERE created_at < now() - interval '2 days'");
  await q("DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'");
  await q("DELETE FROM invitations WHERE expires_at < now() - interval '30 days' AND accepted_at IS NULL");
  return 'ok';
}

export const JOBS = {
  'payroll.run': { cron: '45 3 * * *', fn: payrollRun },
  'recurring.run': { cron: '*/15 * * * *', fn: recurringRun },
  reminders: { cron: '0 7 * * *', fn: reminders },
  'reports.run': { cron: '0 6 * * *', fn: reportsRun },
  backup: { cron: `0 ${config.backupHour} * * *`, fn: backupJob },
  retention: { cron: '30 4 * * *', fn: retention },
};

export async function runJob(name, log) {
  const started = Date.now();
  try {
    const msg = await JOBS[name].fn(log);
    await q(
      `INSERT INTO job_runs(name,last_run,last_status,last_duration_ms,last_error) VALUES ($1,now(),'ok',$2,NULL)
       ON CONFLICT (name) DO UPDATE SET last_run=now(), last_status='ok', last_duration_ms=$2, last_error=NULL`,
      [name, Date.now() - started],
    );
    log.info(`Job ${name}: ${msg}`);
  } catch (e) {
    log.error({ err: e }, `Job ${name} fehlgeschlagen`);
    await q(
      `INSERT INTO job_runs(name,last_run,last_status,last_duration_ms,last_error) VALUES ($1,now(),'failed',$2,$3)
       ON CONFLICT (name) DO UPDATE SET last_run=now(), last_status='failed', last_duration_ms=$2, last_error=$3`,
      [name, Date.now() - started, String(e.message).slice(0, 500)],
    );
  }
}
