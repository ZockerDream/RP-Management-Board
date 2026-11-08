import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { many, one, q, tx } from '../db.js';
import { requireAuth, notFound, bad, forbidden } from '../authz.js';
import { toCsv } from '../lib.js';
import { config } from '../config.js';
import { calculateWorkCompensation } from '../work-hours.js';
import { calculateDailyPayroll } from '../payroll.js';
import { patchSchema } from '../validation.js';
import { splitManualEntry, splitTimer, MAX_TIMER_SECONDS } from '../work-split.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const id = z.string().uuid();
const entryBody = z.object({
  work_date: date,
  hours: z.number().positive().max(24).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Maximal zwei Nachkommastellen'),
  note: z.string().max(500).default(''),
  project_id: z.string().uuid().nullish(),
  started_at: time.nullish(),
  ended_at: time.nullish(),
  break_minutes: z.number().int().min(0).max(1440).default(0),
});

export default async function routes(app) {
  async function projectAccess(userId, projectId, write = false) {
    if (!projectId) return null;
    const project = await one('SELECT * FROM work_projects WHERE id=$1', [projectId]);
    if (!project) throw bad('Projekt nicht gefunden');
    if (project.owner_user_id === userId) return project;
    const member = project.team_id && await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [project.team_id, userId]);
    if (!member || (write && member.team_role === 'viewer')) throw notFound();
    return project;
  }

  async function requireTeamEditor(userId, teamId) {
    const membership = await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId]);
    if (!membership) throw notFound('Team nicht gefunden');
    if (membership.team_role === 'viewer') throw forbidden('Nur Team-Owner und Editoren können Arbeitszeiten verwalten');
  }

  // Schichten über Mitternacht werden zu einem Eintrag je Kalendertag
  async function insertEntries(client, userId, entry) {
    const ids = [];
    for (const part of splitManualEntry(entry)) {
      ids.push((await client.query(
        'INSERT INTO work_entries(user_id, work_date, hours, note, project_id, started_at, ended_at, break_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [userId, part.work_date, part.hours, part.note, part.project_id || null, part.started_at || null, part.ended_at || null, part.break_minutes],
      )).rows[0].id);
    }
    return ids;
  }

  async function workEntryAccess(userId, entryId) {
    const entry = await one('SELECT id,user_id FROM work_entries WHERE id=$1', [entryId]);
    if (!entry || entry.user_id === userId) {
      if (!entry) throw notFound();
      return entry;
    }
    const membership = await one(
      `SELECT 1 FROM team_members editor
       JOIN team_members employee ON employee.team_id=editor.team_id
       WHERE editor.user_id=$1 AND employee.user_id=$2 AND editor.team_role IN ('owner','editor')`,
      [userId, entry.user_id],
    );
    if (!membership) throw notFound();
    return entry;
  }

  app.get('/work-projects', requireAuth, async (req) => many(
    `SELECT p.*, t.name team_name FROM work_projects p LEFT JOIN teams t ON t.id=p.team_id
     WHERE p.owner_user_id=$1 OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1)
     ORDER BY p.active DESC, p.name`,
    [req.user.id],
  ));

  app.post('/work-projects', requireAuth, async (req) => {
    const body = z.object({ name: z.string().trim().min(1).max(100), team_id: z.string().uuid().nullish() }).parse(req.body);
    if (body.team_id) {
      const member = await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [body.team_id, req.user.id]);
      if (!member || member.team_role === 'viewer') throw forbidden();
    }
    return one('INSERT INTO work_projects(name,owner_user_id,team_id) VALUES ($1,$2,$3) RETURNING id', [body.name, body.team_id ? null : req.user.id, body.team_id || null]);
  });

  app.patch('/work-projects/:id', requireAuth, async (req) => {
    const project = await projectAccess(req.user.id, req.params.id, true);
    const body = z.object({ name: z.string().trim().min(1).max(100), active: z.boolean() }).partial().parse(req.body);
    const keys = Object.keys(body);
    if (keys.length) await q(`UPDATE work_projects SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')} WHERE id=$1`, [project.id, ...keys.map((key) => body[key])]);
    return { ok: true };
  });

  app.delete('/work-projects/:id', requireAuth, async (req) => {
    const project = await projectAccess(req.user.id, req.params.id, true);
    if (project.owner_user_id !== req.user.id) {
      const membership = await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [project.team_id, req.user.id]);
      if (!membership || membership.team_role !== 'owner') throw forbidden('Nur Besitzer bzw. Team-Owner können das Projekt löschen');
    }
    await q('DELETE FROM work_projects WHERE id=$1', [project.id]);
    return { ok: true };
  });

  app.get('/work-hours/timer', requireAuth, async (req) => {
    const timer = await one(`SELECT w.*, p.name project_name FROM work_timers w LEFT JOIN work_projects p ON p.id=w.project_id
      AND (p.owner_user_id=w.user_id OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id=w.user_id)) WHERE w.user_id=$1`, [req.user.id]);
    return timer || null;
  });

  app.post('/work-hours/timer/start', requireAuth, async (req) => {
    const body = z.object({ project_id: z.string().uuid().nullish(), note: z.string().max(500).default('') }).parse(req.body);
    if (body.project_id) await projectAccess(req.user.id, body.project_id, true);
    try {
      return await one('INSERT INTO work_timers(user_id,project_id,started_at,note) VALUES ($1,$2,now(),$3) RETURNING *', [req.user.id, body.project_id || null, body.note]);
    } catch (error) {
      if (error.code === '23505') throw bad('Es läuft bereits eine Zeiterfassung');
      throw error;
    }
  });

  app.post('/work-hours/timer/pause', requireAuth, async (req) => {
    const result = await q('UPDATE work_timers SET paused_at=now() WHERE user_id=$1 AND paused_at IS NULL', [req.user.id]);
    if (!result.rowCount) throw bad('Es läuft kein aktiver Timer');
    return { ok: true };
  });

  app.post('/work-hours/timer/resume', requireAuth, async (req) => {
    const result = await q('UPDATE work_timers SET paused_seconds=paused_seconds+GREATEST(0,extract(epoch FROM (now()-paused_at))::int),paused_at=NULL WHERE user_id=$1 AND paused_at IS NOT NULL', [req.user.id]);
    if (!result.rowCount) throw bad('Es gibt keine aktive Pause');
    return { ok: true };
  });

  app.post('/work-hours/timer/stop', requireAuth, async (req) => tx(async (client) => {
    const timer = (await client.query('SELECT * FROM work_timers WHERE user_id=$1 FOR UPDATE', [req.user.id])).rows[0];
    if (!timer) throw bad('Es läuft kein Timer');
    const stoppedAt = new Date();
    const currentPause = timer.paused_at ? Math.floor((stoppedAt.getTime() - new Date(timer.paused_at).getTime()) / 1000) : 0;
    const pauseSeconds = timer.paused_seconds + currentPause;
    const elapsed = Math.floor((stoppedAt.getTime() - new Date(timer.started_at).getTime()) / 1000) - pauseSeconds;
    if (elapsed < 60) throw bad('Die erfasste Zeit muss mindestens eine Minute betragen');
    if (elapsed > MAX_TIMER_SECONDS) throw bad('Der Timer läuft seit mehr als 24 Stunden. Verwirf ihn und erfasse die Zeit manuell.');
    // Über Mitternacht: ein Eintrag je Kalendertag, damit die Stunden in der richtigen Woche zählen
    const parts = splitTimer({ startedAt: timer.started_at, stoppedAt, pausedSeconds: timer.paused_seconds, pausedAt: timer.paused_at, timeZone: config.tz });
    const ids = [];
    for (const part of parts) {
      ids.push((await client.query(
        'INSERT INTO work_entries(user_id,project_id,work_date,hours,note,started_at,ended_at,break_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [req.user.id, timer.project_id, part.work_date, part.hours, timer.note, part.started_at, part.ended_at, part.break_minutes],
      )).rows[0].id);
    }
    await client.query('DELETE FROM work_timers WHERE user_id=$1', [req.user.id]);
    return { id: ids[0], entries: ids.length };
  }));

  // Vergessener Timer: verwerfen, ohne einen Eintrag anzulegen
  app.delete('/work-hours/timer', requireAuth, async (req) => {
    const result = await q('DELETE FROM work_timers WHERE user_id=$1', [req.user.id]);
    if (!result.rowCount) throw bad('Es läuft kein Timer');
    return { ok: true };
  });

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
      many(`SELECT e.id, e.work_date, e.hours, e.note, e.project_id, e.started_at, e.ended_at, e.break_minutes, p.name project_name
        FROM work_entries e LEFT JOIN work_projects p ON p.id=e.project_id AND (p.owner_user_id=e.user_id OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id=e.user_id))
        WHERE ${where.map((part) => part.replaceAll('work_date', 'e.work_date').replaceAll('user_id', 'e.user_id')).join(' AND ')}
        ORDER BY e.work_date DESC, e.created_at DESC`, params),
      one(`SELECT COALESCE(sum(hours), 0) total_hours FROM work_entries WHERE ${where.join(' AND ')}`, params),
    ]);
    return { items, total_hours: total.total_hours };
  });

  async function monthlyReport(user) {
    const { id: userId, month, weekly_work_hours: weeklyHours, daily_salary: dailySalary, hourly_bonus_percent: bonusPercent, currency } = user;
    const [year, monthNumber] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    const items = await many(
      `SELECT e.id, e.work_date, e.hours, e.note, e.project_id, e.started_at, e.ended_at, e.break_minutes, p.name project_name
       FROM work_entries e LEFT JOIN work_projects p ON p.id=e.project_id
         AND (p.owner_user_id=e.user_id OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id=e.user_id))
       WHERE e.user_id=$1 AND e.work_date >= $2 AND e.work_date <= $3
       ORDER BY e.work_date, e.started_at NULLS LAST, e.created_at`,
      [userId, from, to],
    );
    const daily = new Map();
    for (const item of items) daily.set(item.work_date, (daily.get(item.work_date) || 0) + Number(item.hours));
    const calendarDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const totalHours = items.reduce((sum, item) => sum + Number(item.hours), 0);
    const targetHours = calendarDays * Number(weeklyHours) / 7;
    const payroll = await one(
      `SELECT COALESCE(sum(base_amount),0) base_pay,
              COALESCE(sum(overtime_hours),0) overtime_hours,
              COALESCE(sum(overtime_pay),0) overtime_pay
       FROM payroll_payments WHERE user_id=$1 AND payroll_date BETWEEN $2 AND $3`,
      [userId, from, to],
    );
    const compensation = calculateWorkCompensation(payroll.base_pay, payroll.overtime_hours, payroll.overtime_pay);
    return {
      month, items, daily: [...daily].map(([work_date, hours]) => ({ work_date, hours })),
      total_hours: totalHours, target_hours: targetHours, overtime_balance: totalHours - targetHours,
      weekly_target: Number(weeklyHours), calendar_days: calendarDays,
      daily_salary: Number(dailySalary || 0), hourly_bonus_percent: Number(bonusPercent || 0),
      bonus_per_hour: calculateDailyPayroll({ dailySalary: Number(dailySalary || 0), bonusPercent: Number(bonusPercent || 0), bonusHours: 1 }).overtime_pay,
      ...compensation, currency,
    };
  }

  const monthFilter = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
  app.get('/work-hours/monthly', requireAuth, async (req) => {
    const { month } = monthFilter.parse(req.query);
    return monthlyReport({ ...req.user, month });
  });

  app.get('/work-hours/team/monthly', requireAuth, async (req) => {
    const { team_id: teamId, month } = z.object({ team_id: id, month: monthFilter.shape.month }).parse(req.query);
    await requireTeamEditor(req.user.id, teamId);
    const members = await many(
      `SELECT u.id,u.name,u.weekly_work_hours,u.daily_salary,u.hourly_bonus_percent,u.currency
       FROM team_members tm JOIN users u ON u.id=tm.user_id
       WHERE tm.team_id=$1 AND u.status='active' AND u.deleted_at IS NULL
       ORDER BY u.name`,
      [teamId],
    );
    return {
      team_id: teamId,
      month,
      members: await Promise.all(members.map(async (member) => ({
        user_id: member.id,
        name: member.name,
        ...await monthlyReport({ ...member, month }),
      }))),
    };
  });

  app.patch('/work-hours/team/:teamId/members/:userId/settings', requireAuth, async (req) => {
    const teamId = id.parse(req.params.teamId);
    const userId = id.parse(req.params.userId);
    await requireTeamEditor(req.user.id, teamId);
    if (!(await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId]))) throw notFound();
    const settings = z.object({
      weekly_work_hours: z.number().min(1).max(168).multipleOf(0.25).optional(),
      daily_salary: z.number().min(0).max(9999999999.99).multipleOf(0.01).optional(),
      hourly_bonus_percent: z.number().min(0).max(1000).multipleOf(0.01).optional(),
    }).refine((value) => Object.keys(value).length > 0, 'Mindestens eine Einstellung erforderlich').parse(req.body);
    const keys = Object.keys(settings);
    await q(
      `UPDATE users SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')},updated_at=now() WHERE id=$1`,
      [userId, ...keys.map((key) => settings[key])],
    );
    return { ok: true };
  });

  app.get('/work-hours/monthly.pdf', requireAuth, async (req, reply) => {
    const { month } = monthFilter.parse(req.query);
    const report = await monthlyReport({ ...req.user, month });
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    reply.type('application/pdf').header('content-disposition', `attachment; filename="stundenzettel-${month}.pdf"`);
    doc.fontSize(20).text(`Stundenzettel ${month}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Wochen-Soll: ${report.weekly_target.toFixed(2)} Std.`);
    doc.text(`Arbeitszeit: ${report.total_hours.toFixed(2)} Std.`);
    doc.text(`Monats-Soll: ${report.target_hours.toFixed(2)} Std.`);
    doc.text(`Saldo: ${report.overtime_balance >= 0 ? '+' : ''}${report.overtime_balance.toFixed(2)} Std.`);
    const formatPay = (value) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: report.currency || 'EUR' }).format(Number(value));
    doc.text(`Festgehalt pro Tag: ${formatPay(report.daily_salary)} · Bonus je Stunde über dem Soll: ${report.hourly_bonus_percent} % = ${formatPay(report.bonus_per_hour)}`);
    doc.text(`Stunden über dem Wochen-Soll: ${report.overtime_hours.toFixed(2)} Std.`);
    doc.text(`Festgehalt: ${formatPay(report.base_pay)} · Bonus: ${formatPay(report.overtime_pay)} · Gesamt: ${formatPay(report.total_pay)}`);
    doc.moveDown();
    const drawHeader = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold');
      doc.text('Datum', 48, y, { width: 90, lineBreak: false });
      doc.text('Projekt', 138, y, { width: 180, lineBreak: false });
      doc.text('Zeitraum', 318, y, { width: 100, lineBreak: false });
      doc.text('Std.', 418, y, { width: 80, align: 'right', lineBreak: false });
      doc.y = y + 20;
      doc.font('Helvetica');
    };
    drawHeader();
    for (const item of report.items) {
      if (doc.y > 750) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      doc.text(String(item.work_date).split('-').reverse().join('.'), 48, y, { width: 90, lineBreak: false });
      doc.text(item.project_name || 'Allgemein', 138, y, { width: 180, lineBreak: false, ellipsis: true });
      doc.text(`${item.started_at || '-'}-${item.ended_at || '-'}`, 318, y, { width: 100, lineBreak: false });
      doc.text(Number(item.hours).toFixed(2), 418, y, { width: 80, align: 'right', lineBreak: false });
      doc.y = y + 18;
    }
    doc.end();
    return reply.send(doc);
  });

  app.get('/work-hours/export.csv', requireAuth, async (req, reply) => {
    const filter = z.object({ from: date.optional(), to: date.optional() }).parse(req.query);
    if (filter.from && filter.to && filter.from > filter.to) throw bad('Zeitraum ungültig');
    const params = [req.user.id];
    const clauses = ['e.user_id=$1'];
    if (filter.from) { params.push(filter.from); clauses.push(`e.work_date >= $${params.length}`); }
    if (filter.to) { params.push(filter.to); clauses.push(`e.work_date <= $${params.length}`); }
    const rows = await many(`SELECT e.work_date, p.name project, e.started_at, e.ended_at, e.break_minutes, e.hours, e.note
      FROM work_entries e LEFT JOIN work_projects p ON p.id=e.project_id AND (p.owner_user_id=e.user_id OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id=e.user_id))
      WHERE ${clauses.join(' AND ')} ORDER BY e.work_date`, params);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="arbeitszeiten.csv"');
    return toCsv(rows, ['work_date', 'project', 'started_at', 'ended_at', 'break_minutes', 'hours', 'note']);
  });

  app.post('/work-hours', requireAuth, async (req) => {
    const entry = entryBody.parse(req.body);
    if (entry.project_id) await projectAccess(req.user.id, entry.project_id, true);
    const ids = await tx((client) => insertEntries(client, req.user.id, entry));
    return { id: ids[0], entries: ids.length };
  });

  app.patch('/work-hours/:id', requireAuth, async (req) => {
    const existing = await workEntryAccess(req.user.id, req.params.id);
    const entry = patchSchema(entryBody).parse(req.body);
    if (entry.project_id) await projectAccess(existing.user_id, entry.project_id, existing.user_id === req.user.id);
    if (!Object.keys(entry).length) return { ok: true };
    return tx(async (client) => {
      const current = (await client.query('SELECT * FROM work_entries WHERE id=$1 AND user_id=$2 FOR UPDATE', [existing.id, existing.user_id])).rows[0];
      if (!current) throw notFound();
      const timing = {
        work_date: current.work_date, hours: Number(current.hours), break_minutes: current.break_minutes,
        started_at: current.started_at?.slice(0, 5) ?? null, ended_at: current.ended_at?.slice(0, 5) ?? null,
      };
      const merged = { ...current, ...timing, ...entry };
      // Geht der Eintrag jetzt über Mitternacht, bleibt dieser Eintrag beim ersten Tag; der Rest wird ein Eintrag am Folgetag.
      // Nur wenn sich Datum, Zeiten, Stunden oder Pause ändern: Ältere Einträge über Mitternacht bleiben beim Ändern der Notiz,
      // sonst rutschten Stunden still in eine andere, womöglich noch offene Woche.
      const timingChanged = Object.keys(timing).some((key) => key in entry && String(entry[key] ?? '') !== String(timing[key] ?? ''));
      const [first, ...rest] = timingChanged ? splitManualEntry(merged) : [merged];
      await client.query(
        `UPDATE work_entries SET work_date=$2, hours=$3, note=$4, project_id=$5, started_at=$6, ended_at=$7, break_minutes=$8, updated_at=now()
         WHERE id=$1`,
        [current.id, first.work_date, first.hours, first.note, first.project_id || null, first.started_at || null, first.ended_at || null, first.break_minutes],
      );
      for (const part of rest) await insertEntries(client, current.user_id, part);
      return { ok: true, entries: 1 + rest.length };
    });
  });

  app.delete('/work-hours/:id', requireAuth, async (req) => {
    const existing = await workEntryAccess(req.user.id, req.params.id);
    const result = await q('DELETE FROM work_entries WHERE id=$1 AND user_id=$2', [existing.id, existing.user_id]);
    if (!result.rowCount) throw notFound();
    return { ok: true };
  });
}
