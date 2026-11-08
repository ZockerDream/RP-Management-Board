import { one, many, q, tx } from './db.js';
import { config } from './config.js';
import { nthOccurrence, today, ymd, notify, budgetWatch, addInterval } from './lib.js';
import { sendMail } from './mail.js';
import { runBackup, pruneBackups } from './backup.js';
import { getSetting } from './settings.js';
import { planPayroll, mondayOf, nextDate, payrollCutoff } from './payroll.js';
import { localDateTime } from './work-split.js';
import { todoStage, dateInZone } from './periods.js';

const localDate = (date = new Date()) => dateInZone(config.tz, date);

function previousDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return ymd(value);
}

export async function payrollRun(log) {
  const now = localDateTime(Date.now(), config.tz);
  const cutoff = payrollCutoff(now);
  // Offene Schicht: Timer, der vor weniger als 24 Stunden gestartet wurde. Ältere Timer gelten als vergessen und halten nichts auf.
  const users = await many(
    `SELECT u.id, u.weekly_work_hours, u.daily_salary, u.hourly_bonus_percent,
            u.payroll_budget_id, u.payroll_start_date, b.currency,
            CASE WHEN w.started_at > now() - interval '24 hours' THEN to_char(w.started_at AT TIME ZONE $2, 'YYYY-MM-DD') END open_shift_date
     FROM users u JOIN budgets b ON b.id=u.payroll_budget_id
       LEFT JOIN work_timers w ON w.user_id=u.id
     WHERE u.status='active' AND u.deleted_at IS NULL AND u.payroll_start_date <= $1
       AND b.type='solo' AND b.owner_user_id=u.id AND b.archived=false
     ORDER BY u.id`,
    [cutoff, config.tz],
  );
  let processed = 0;
  let waiting = 0;
  for (const user of users) {
    const lastDate = payrollCutoff({ ...now, openShiftDate: user.open_shift_date });
    if (lastDate < cutoff) waiting++;
    const firstDate = String(user.payroll_start_date).slice(0, 10);
    const hoursFrom = mondayOf(firstDate);
    const workDays = await many(
      `SELECT work_date, sum(hours) hours FROM work_entries
       WHERE user_id=$1 AND work_date BETWEEN $2 AND $3
       GROUP BY work_date ORDER BY work_date`,
      [user.id, hoursFrom, lastDate],
    );
    const hoursByDate = new Map(workDays.map((row) => [String(row.work_date).slice(0, 10), Number(row.hours)]));
    const paidBonusHours = new Map((await many(
      'SELECT payroll_date, overtime_hours FROM payroll_payments WHERE user_id=$1 AND payroll_date BETWEEN $2 AND $3',
      [user.id, firstDate, lastDate],
    )).map((row) => [String(row.payroll_date).slice(0, 10), Number(row.overtime_hours)]));
    const payments = planPayroll({
      firstDate,
      lastDate,
      weeklyTarget: Number(user.weekly_work_hours),
      dailySalary: Number(user.daily_salary),
      bonusPercent: Number(user.hourly_bonus_percent),
      hoursByDate,
      paidBonusHours,
    });
    for (const payment of payments) {
      const { date } = payment;
      await tx(async (client) => {
        const reservation = await client.query(
          `INSERT INTO payroll_payments(user_id,payroll_date,budget_id,base_amount,overtime_hours,overtime_pay)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,payroll_date) DO NOTHING RETURNING id`,
          [user.id, date, user.payroll_budget_id, payment.base_amount, payment.overtime_hours, payment.overtime_pay],
        );
        if (!reservation.rowCount) return;
        if (Number(payment.total_amount) > 0) {
          const withBonus = Number(payment.overtime_pay) > 0;
          const transaction = await client.query(
            `INSERT INTO transactions(budget_id,created_by,type,amount,booked_at,title,note,source,income_kind)
             VALUES ($1,$2,'income',$3,$4,$5,$6,'payroll','salary') RETURNING id`,
            [
              user.payroll_budget_id, user.id, payment.total_amount, date,
              `Festgehalt${withBonus ? ' und Bonus' : ''}`,
              withBonus
                ? `${payment.base_amount} ${user.currency} Festgehalt; ${payment.overtime_pay} ${user.currency} Bonus für ${payment.overtime_hours} Stunden über dem Wochen-Soll (${user.hourly_bonus_percent} % vom Festgehalt je Stunde)`
                : `${payment.base_amount} ${user.currency} Festgehalt`,
            ],
          );
          await client.query('UPDATE payroll_payments SET transaction_id=$2 WHERE id=$1', [reservation.rows[0].id, transaction.rows[0].id]);
        }
      });
      processed++;
    }
  }
  log.info(`Gehaltsbuchungen bis ${cutoff}: ${processed}${waiting ? `, ${waiting} warten auf das Ausstempeln` : ''}`);
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
      await notify(uid, 'calendar', `Termin: ${e.title}`, `${days === 0 ? 'Heute' : `In ${days} Tag(en) – ${occ}`}${e.note ? `\n${e.note}` : ''}`, `cal:${e.id}:${occ}`, log);
    }
    await q('UPDATE calendar_events SET last_reminded=$2 WHERE id=$1', [e.id, occ]);
    sent++;
  }
  const soon = addInterval(t, 'daily', 14);
  const kitSoon = addInterval(t, 'daily', 30);
  for (const v of await many(`SELECT id, plate, make_model, service_due, odometer_km, service_due_km, first_aid_kit_expires_on, owner_user_id, team_id
    FROM vehicles WHERE (service_due IS NOT NULL AND service_due <= $1)
      OR (odometer_km IS NOT NULL AND service_due_km IS NOT NULL AND odometer_km >= service_due_km)
      OR (first_aid_kit_expires_on IS NOT NULL AND first_aid_kit_expires_on <= $2)`, [soon, kitSoon])) {
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
    WHERE a.returned_at IS NULL AND a.lost_at IS NULL AND a.due_at IS NOT NULL AND a.due_at <= $1`, [soon])) {
    const users = a.owner_user_id
      ? [a.owner_user_id]
      : (await many('SELECT user_id FROM team_members WHERE team_id=$1', [a.team_id])).map((member) => member.user_id);
    for (const userId of users) {
      const body = a.due_at < t ? `Überfällig seit ${a.due_at}` : `Rückgabe bis ${a.due_at}`;
      await notify(userId, 'key_overdue', `Schlüssel-Rückgabe: ${a.label}`, body, `key:${a.id}:${userId}`);
    }
  }
  const scopeUsers = async (row) => (row.owner_user_id
    ? [row.owner_user_id]
    : (await many('SELECT user_id FROM team_members WHERE team_id=$1', [row.team_id])).map((member) => member.user_id));
  const expiryText = (date) => (date < t ? `abgelaufen am ${date}` : `läuft am ${date} ab`);
  // Lizenzen: 30 Tage vorher und noch einmal nach dem Ablauf
  for (const l of await many(`SELECT l.id, l.valid_until, lt.name type_name, lt.owner_user_id, lt.team_id, pe.name person
    FROM licenses l JOIN license_types lt ON lt.id=l.type_id JOIN people pe ON pe.id=l.person_id
    WHERE l.status='valid' AND l.valid_until IS NOT NULL AND l.valid_until <= $1`, [kitSoon])) {
    const stage = l.valid_until < t ? 'expired' : 'soon';
    for (const userId of await scopeUsers(l)) {
      await notify(userId, 'license_expiry', `Lizenz: ${l.type_name} von ${l.person}`, expiryText(l.valid_until), `lic:${l.id}:${l.valid_until}:${stage}`);
    }
  }
  // Schulungen: nur der neueste bestandene Nachweis je Teilnehmer zählt; eine Wiederholung beendet die Erinnerung
  for (const r of await many(`SELECT * FROM (
      SELECT DISTINCT ON (r.training_id, COALESCE(r.user_id, r.person_id)) r.id, r.valid_until, tr.name, tr.owner_user_id, tr.team_id,
        COALESCE(u.name, pe.name) participant
      FROM training_records r JOIN trainings tr ON tr.id=r.training_id
        LEFT JOIN users u ON u.id=r.user_id LEFT JOIN people pe ON pe.id=r.person_id
      WHERE r.result='passed' AND tr.active
      ORDER BY r.training_id, COALESCE(r.user_id, r.person_id), r.completed_on DESC NULLS LAST, r.created_at DESC
    ) latest WHERE valid_until IS NOT NULL AND valid_until <= $1`, [kitSoon])) {
    const stage = r.valid_until < t ? 'expired' : 'soon';
    for (const userId of await scopeUsers(r)) {
      await notify(userId, 'training_expiry', `Schulung: ${r.name} – ${r.participant}`, expiryText(r.valid_until), `training:${r.id}:${r.valid_until}:${stage}`);
    }
  }
  return `${sent} Erinnerungen`;
}

const TODO_TITLES = { tomorrow: 'ToDo morgen fällig', today: 'ToDo heute fällig', overdue: 'ToDo überfällig' };

export async function todoReminders(log) {
  const now = localDate();
  const todos = await many(
    `SELECT td.id, td.title, td.due_date, td.owner_user_id, td.team_id, td.last_reminder, t.name team_name
     FROM todos td LEFT JOIN teams t ON t.id=td.team_id
     WHERE td.done_at IS NULL AND td.due_date IS NOT NULL AND td.due_date <= $1`,
    [nextDate(now)],
  );
  let sent = 0;
  for (const todo of todos) {
    const due = String(todo.due_date).slice(0, 10);
    const stage = todoStage(due, now);
    const reminder = `${due}:${stage}`;
    if (!stage || todo.last_reminder === reminder) continue;
    const users = todo.team_id
      ? (await many(
        `SELECT tm.user_id FROM team_members tm JOIN users u ON u.id=tm.user_id
         WHERE tm.team_id=$1 AND u.status='active' AND u.deleted_at IS NULL`,
        [todo.team_id],
      )).map((row) => row.user_id)
      : [todo.owner_user_id];
    const deadline = `Deadline: ${due.split('-').reverse().join('.')}${todo.team_name ? ` · Team ${todo.team_name}` : ''}`;
    for (const userId of users) {
      await notify(userId, 'todo_due', `${TODO_TITLES[stage]}: ${todo.title}`, deadline, `todo:${todo.id}:${reminder}`, log);
    }
    await q('UPDATE todos SET last_reminder=$2 WHERE id=$1', [todo.id, reminder]);
    sent++;
  }
  return `${sent} ToDo-Erinnerungen`;
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
    for (const to of new Set([r.email, ...r.recipients])) await sendMail({ to, subject: `RP-Management-Board – ${r.kind}-Bericht`, text, log });
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
  // Stündlich: Gebucht wird der Vortag ab 03:45 Uhr; wartet ein Tag auf das Ausstempeln, folgt er spätestens eine Stunde danach
  'payroll.run': { cron: '45 * * * *', fn: payrollRun },
  'recurring.run': { cron: '*/15 * * * *', fn: recurringRun },
  reminders: { cron: '0 7 * * *', fn: reminders },
  // Stündlich, damit auch ein heute angelegtes ToDo noch erinnert; nachts bleibt es still
  'todos.remind': { cron: '5 7-20 * * *', fn: todoReminders },
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
