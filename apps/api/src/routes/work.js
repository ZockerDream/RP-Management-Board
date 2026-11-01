import { z } from 'zod';
import { many, one, q, tx } from '../db.js';
import { requireAuth, notFound, bad, forbidden } from '../authz.js';
import { toCsv } from '../lib.js';
import { config } from '../config.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const entryBody = z.object({
  work_date: date,
  hours: z.number().positive().max(24).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Maximal zwei Nachkommastellen'),
  note: z.string().max(500).default(''),
  project_id: z.string().uuid().nullish(),
  started_at: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  ended_at: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
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
    const localParts = (value) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
      return Object.fromEntries(parts.map((part) => [part.type, part.value]));
    };
    const start = localParts(new Date(timer.started_at));
    const end = localParts(stoppedAt);
    const hours = Math.round(elapsed / 36) / 100;
    const entry = (await client.query(
      'INSERT INTO work_entries(user_id,project_id,work_date,hours,note,started_at,ended_at,break_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [req.user.id, timer.project_id, `${start.year}-${start.month}-${start.day}`, hours, timer.note, `${start.hour}:${start.minute}`, `${end.hour}:${end.minute}`, Math.round(pauseSeconds / 60)],
    )).rows[0];
    await client.query('DELETE FROM work_timers WHERE user_id=$1', [req.user.id]);
    return entry;
  }));

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
    return one(
      'INSERT INTO work_entries(user_id, work_date, hours, note, project_id, started_at, ended_at, break_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [req.user.id, entry.work_date, entry.hours, entry.note, entry.project_id || null, entry.started_at || null, entry.ended_at || null, entry.break_minutes],
    );
  });

  app.patch('/work-hours/:id', requireAuth, async (req) => {
    const entry = entryBody.partial().parse(req.body);
    if (entry.project_id) await projectAccess(req.user.id, entry.project_id, true);
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
