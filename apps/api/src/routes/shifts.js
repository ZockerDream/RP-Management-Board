// Dienstplan (Wunsch des Auftraggebers vom 2026-11-13): Schichten je Organisation aus Vorlagen (Früh, Spät, Nacht),
// Plätze, Einteilung, selbst eintragen, Tausch anbieten und übernehmen, krank melden, „Wer ist im Dienst?“.
// Funktion „shifts“: 2 sehen und selbst handeln, 3 planen und einteilen, 4 Schichten und Vorlagen löschen.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden, notFound } from '../authz.js';
import { LEVEL, isMember } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDate, isoDateTime } from '../records.js';
import { patchSchema } from '../validation.js';
import { notify } from '../lib.js';
import { config } from '../config.js';
import { teamFor, loadTeamRow, notifyTeam, teamName } from '../orgfeature.js';
import { discord } from '../discord-send.js';
import { currentModules } from '../feature-guard.js';
import { shiftTimes, daysBetween, DEFAULT_TEMPLATES, taken } from '../shifts.js';

const COLORS = ['primary', 'ok', 'warn', 'bad', 'neutral'];
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'Uhrzeit im Format HH:MM');
const templateFields = z.object({
  name: z.string().trim().min(1).max(60), starts: clock, ends: clock,
  slots: z.number().int().min(1).max(100).default(2), color: z.enum(COLORS).default('primary'), sort: z.number().int().min(-1000).max(1000).default(0),
});
const shiftFields = z.object({
  title: z.string().trim().min(1).max(60), starts_at: isoDateTime, ends_at: isoDateTime,
  slots: z.number().int().min(1).max(100).default(1), color: z.enum(COLORS).default('primary'), note: z.string().max(1000).default(''),
});
const when = (iso) => new Date(iso).toLocaleString('de-DE', { timeZone: config.tz, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function shiftWithAssignments(id) {
  const shift = await one('SELECT * FROM shifts WHERE id=$1', [id]);
  if (!shift) throw notFound('Schicht nicht gefunden');
  shift.assignments = await many('SELECT * FROM shift_assignments WHERE shift_id=$1', [id]);
  return shift;
}
async function loadAssignment(req) {
  const a = await one('SELECT a.*, s.team_id, s.title, s.starts_at, s.ends_at FROM shift_assignments a JOIN shifts s ON s.id=a.shift_id WHERE a.id=$1', [uuid.parse(req.params.id)]);
  if (!a) throw notFound('Einteilung nicht gefunden');
  const level = await teamFor(req, a.team_id, 'shifts', LEVEL.READ);
  return { a, level };
}
const label = (s) => `${s.title} ${when(s.starts_at)}`;

export default async function routes(app) {
  // ---------- Vorlagen
  app.get('/shift-templates', authz('shift:read'), async (req) => {
    const { team_id: teamId } = z.object({ team_id: uuid }).parse(req.query);
    await teamFor(req, teamId, 'shifts', LEVEL.READ);
    let rows = await many('SELECT * FROM shift_templates WHERE team_id=$1 ORDER BY sort, name', [teamId]);
    if (!rows.length) {
      // Erste Nutzung: Früh, Spät, Nacht als Vorschlag
      for (const t of DEFAULT_TEMPLATES) {
        await q('INSERT INTO shift_templates(team_id, name, starts, ends, slots, color, sort) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [teamId, t.name, t.starts, t.ends, t.slots, t.color, t.sort]);
      }
      rows = await many('SELECT * FROM shift_templates WHERE team_id=$1 ORDER BY sort, name', [teamId]);
    }
    return rows;
  });
  const saveTemplate = async (sql, params) => {
    try { return await one(sql, params); } catch (e) { if (e.code === '23505') throw bad('Eine Vorlage mit diesem Namen gibt es schon'); throw e; }
  };
  app.post('/shift-templates', authz('shift:create'), async (req) => {
    const b = templateFields.extend({ team_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, 'shifts', LEVEL.WRITE);
    return saveTemplate('INSERT INTO shift_templates(team_id, name, starts, ends, slots, color, sort) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [b.team_id, b.name, b.starts, b.ends, b.slots, b.color, b.sort]);
  });
  app.patch('/shift-templates/:id', authz('shift:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'shift_templates', uuid.parse(req.params.id), 'shifts', LEVEL.WRITE);
    const b = { ...row, ...patchSchema(templateFields).parse(req.body) };
    await saveTemplate('UPDATE shift_templates SET name=$2, starts=$3, ends=$4, slots=$5, color=$6, sort=$7 WHERE id=$1 RETURNING id', [row.id, b.name, b.starts, b.ends, b.slots, b.color, b.sort]);
    return { ok: true };
  });
  app.delete('/shift-templates/:id', authz('shift:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'shift_templates', uuid.parse(req.params.id), 'shifts', LEVEL.MANAGE);
    await q('DELETE FROM shift_templates WHERE id=$1', [row.id]);
    return { ok: true };
  });

  // ---------- Schichten
  app.get('/shifts', authz('shift:read'), async (req) => {
    const f = z.object({ team_id: uuid, from: isoDate, to: isoDate }).parse(req.query);
    const level = await teamFor(req, f.team_id, 'shifts', LEVEL.READ);
    const shifts = await many(
      `SELECT s.* FROM shifts s WHERE s.team_id=$1 AND s.ends_at > ($2::date)::timestamp AT TIME ZONE $4 AND s.starts_at < ($3::date + 1)::timestamp AT TIME ZONE $4
       ORDER BY s.starts_at, s.title LIMIT 1000`, [f.team_id, f.from, f.to, config.tz]);
    const assignments = shifts.length ? await many(
      `SELECT a.id, a.shift_id, a.user_id, a.status, a.note, u.name FROM shift_assignments a JOIN users u ON u.id=a.user_id
       WHERE a.shift_id = ANY($1::uuid[]) ORDER BY u.name`, [shifts.map((s) => s.id)]) : [];
    // Abwesenheiten im Zeitraum, damit die Planung sie sieht (nur mit Leserecht bei Abwesenheiten)
    const absences = await many(
      `SELECT a.user_id, u.name, a.starts_on, a.ends_on FROM absences a JOIN users u ON u.id=a.user_id
       WHERE a.team_id=$1 AND a.ends_on >= $2 AND a.starts_on <= $3 AND team_level($1, $4, 'absences') >= 2 AND $5`, [f.team_id, f.from, f.to, req.user.id, (await currentModules()).absences]);
    const now = Date.now();
    return {
      level,
      absences,
      shifts: shifts.map((s) => {
        const list = assignments.filter((a) => a.shift_id === s.id);
        const mine = list.find((a) => a.user_id === req.user.id);
        return { ...s, assignments: list, free: Math.max(0, s.slots - taken(list)), mine: mine || null, past: new Date(s.ends_at).getTime() < now };
      }),
    };
  });

  // Einzelne Schicht oder viele aus Vorlagen (Zeitraum × Vorlagen)
  app.post('/shifts', authz('shift:create'), async (req) => {
    const b = z.union([
      shiftFields.extend({ team_id: uuid }),
      z.object({ team_id: uuid, from: isoDate, to: isoDate, template_ids: z.array(uuid).min(1).max(20), slots: z.number().int().min(1).max(100).nullish() }),
    ]).parse(req.body);
    await teamFor(req, b.team_id, 'shifts', LEVEL.WRITE);
    if (b.template_ids) {
      if (b.to < b.from) throw bad('Das Ende liegt vor dem Beginn');
      const days = daysBetween(b.from, b.to);
      if (days.length > 31) throw bad('Höchstens 31 Tage auf einmal');
      const templates = await many('SELECT * FROM shift_templates WHERE team_id=$1 AND id = ANY($2::uuid[]) ORDER BY sort', [b.team_id, b.template_ids]);
      if (templates.length !== new Set(b.template_ids).size) throw bad('Vorlage gehört nicht zu dieser Organisation');
      const created = await tx(async (c) => {
        let n = 0;
        for (const day of days) for (const t of templates) {
          const { starts_at: startsAt, ends_at: endsAt } = shiftTimes(day, t.starts, t.ends, config.tz);
          // Gleiche Vorlage zur gleichen Zeit nicht doppelt
          const dup = (await c.query('SELECT 1 FROM shifts WHERE team_id=$1 AND template_id=$2 AND starts_at=$3', [b.team_id, t.id, startsAt])).rowCount;
          if (dup) continue;
          await c.query('INSERT INTO shifts(team_id, title, starts_at, ends_at, slots, color, template_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [b.team_id, t.name, startsAt, endsAt, b.slots || t.slots, t.color, t.id, req.user.id]);
          n += 1;
        }
        return n;
      });
      await audit(req, 'shift.planned', 'team', b.team_id, { from: b.from, to: b.to, created });
      return { created };
    }
    if (new Date(b.ends_at) <= new Date(b.starts_at)) throw bad('Das Ende liegt vor dem Beginn');
    const row = await one('INSERT INTO shifts(team_id, title, starts_at, ends_at, slots, color, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [b.team_id, b.title, b.starts_at, b.ends_at, b.slots, b.color, b.note, req.user.id]);
    return { created: 1, id: row.id };
  });

  app.patch('/shifts/:id', authz('shift:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'shifts', uuid.parse(req.params.id), 'shifts', LEVEL.WRITE);
    const b = { ...row, ...patchSchema(shiftFields).parse(req.body) };
    if (new Date(b.ends_at) <= new Date(b.starts_at)) throw bad('Das Ende liegt vor dem Beginn');
    await q('UPDATE shifts SET title=$2, starts_at=$3, ends_at=$4, slots=$5, color=$6, note=$7 WHERE id=$1', [row.id, b.title, b.starts_at, b.ends_at, b.slots, b.color, b.note]);
    return { ok: true };
  });
  app.delete('/shifts/:id', authz('shift:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'shifts', uuid.parse(req.params.id), 'shifts', LEVEL.MANAGE);
    const people = await many("SELECT user_id FROM shift_assignments WHERE shift_id=$1 AND status <> 'sick' AND user_id <> $2", [row.id, req.user.id]);
    await q('DELETE FROM shifts WHERE id=$1', [row.id]);
    if (new Date(row.ends_at) > new Date()) {
      const team = await teamName(row.team_id);
      await Promise.all(people.map((p) => notify(p.user_id, 'shift', `${team}: Schicht abgesagt`, label(row), undefined, req.log)));
    }
    await audit(req, 'shift.deleted', 'shift', row.id, { title: row.title, starts_at: row.starts_at });
    return { ok: true };
  });

  // Einteilen (Planung) oder selbst eintragen
  async function join(req, shiftId, userId, byPlanner) {
    const shift = await shiftWithAssignments(shiftId);
    const level = await teamFor(req, shift.team_id, 'shifts', byPlanner ? LEVEL.WRITE : LEVEL.READ);
    if (!byPlanner && new Date(shift.ends_at) < new Date()) throw bad('Die Schicht ist vorbei');
    if (!(await isMember(userId, shift.team_id))) throw bad('Die Person ist kein Mitglied dieser Organisation');
    const existing = shift.assignments.find((a) => a.user_id === userId);
    if (existing && existing.status !== 'sick') throw bad('Schon eingeteilt');
    if (taken(shift.assignments) >= shift.slots && !byPlanner) throw bad('Alle Plätze sind belegt');
    await q(`INSERT INTO shift_assignments(shift_id, user_id) VALUES ($1,$2)
      ON CONFLICT (shift_id, user_id) DO UPDATE SET status='assigned', updated_at=now()`, [shift.id, userId]);
    return { shift, level };
  }
  app.post('/shifts/:id/join', authz('shift:read'), async (req) => {
    await join(req, uuid.parse(req.params.id), req.user.id, false);
    return { ok: true };
  });
  app.post('/shifts/:id/assign', authz('shift:update'), async (req) => {
    const { user_id: userId } = z.object({ user_id: uuid }).parse(req.body);
    const { shift } = await join(req, uuid.parse(req.params.id), userId, true);
    if (userId !== req.user.id) await notify(userId, 'shift', `${await teamName(shift.team_id)}: Du bist eingeteilt`, label(shift), undefined, req.log);
    await audit(req, 'shift.assigned', 'shift', shift.id, { user: userId });
    return { ok: true };
  });

  // Tausch anbieten: bleibt eingeteilt, bis jemand übernimmt
  app.post('/shift-assignments/:id/offer', authz('shift:read'), async (req) => {
    const { a } = await loadAssignment(req);
    if (a.user_id !== req.user.id) throw forbidden('Nur die eigene Schicht anbieten');
    if (a.status !== 'assigned') throw bad('Die Schicht ist schon angeboten oder abgesagt');
    if (new Date(a.starts_at) < new Date()) throw bad('Die Schicht hat schon begonnen');
    const b = z.object({ note: z.string().trim().max(500).default('') }).parse(req.body);
    await q("UPDATE shift_assignments SET status='offered', note=$2, updated_at=now() WHERE id=$1", [a.id, b.note]);
    await notifyTeam(a.team_id, 'shifts', LEVEL.READ, 'shift', `${await teamName(a.team_id)}: Schicht zum Tausch`, `${req.user.name} gibt ab: ${label(a)}${b.note ? ` – ${b.note}` : ''}`, { except: req.user.id, dedupe: `shift-offer:${a.id}:${Date.now()}`, log: req.log });
    discord(a.team_id, 'shift', { title: 'Schicht zum Tausch', description: label(a), path: 'shifts', fields: [{ name: 'Von', value: req.user.name }] }, req.log);
    return { ok: true };
  });
  app.post('/shift-assignments/:id/keep', authz('shift:read'), async (req) => {
    const { a } = await loadAssignment(req);
    if (a.user_id !== req.user.id || a.status !== 'offered') throw bad('Nur ein eigenes Angebot zurücknehmen');
    await q("UPDATE shift_assignments SET status='assigned', note='', updated_at=now() WHERE id=$1", [a.id]);
    return { ok: true };
  });
  // Übernehmen: genau einmal (WHERE status='offered'), die Person darf nicht schon in der Schicht sein
  app.post('/shift-assignments/:id/take', authz('shift:read'), async (req) => {
    const { a } = await loadAssignment(req);
    if (a.user_id === req.user.id) throw bad('Das ist deine eigene Schicht');
    if (a.status !== 'offered') throw bad('Die Schicht wird nicht (mehr) angeboten');
    if (await one("SELECT 1 FROM shift_assignments WHERE shift_id=$1 AND user_id=$2 AND status <> 'sick'", [a.shift_id, req.user.id])) throw bad('Du bist in dieser Schicht schon eingeteilt');
    const done = await tx(async (c) => {
      await c.query("DELETE FROM shift_assignments WHERE shift_id=$1 AND user_id=$2 AND status='sick'", [a.shift_id, req.user.id]);
      return (await c.query("UPDATE shift_assignments SET user_id=$2, status='assigned', note='', updated_at=now() WHERE id=$1 AND status='offered' RETURNING id", [a.id, req.user.id])).rowCount;
    });
    if (!done) throw bad('Die Schicht wurde gerade schon übernommen');
    const team = await teamName(a.team_id);
    await notify(a.user_id, 'shift', `${team}: Deine Schicht wurde übernommen`, `${req.user.name} übernimmt ${label(a)}`, undefined, req.log);
    await notifyTeam(a.team_id, 'shifts', LEVEL.WRITE, 'shift', `${team}: Schicht getauscht`, `${req.user.name} übernimmt ${label(a)}`, { except: req.user.id, log: req.log });
    discord(a.team_id, 'shift', { title: 'Schicht getauscht', description: label(a), path: 'shifts', fields: [{ name: 'Übernimmt', value: req.user.name }] }, req.log);
    await audit(req, 'shift.taken', 'shift', a.shift_id, { from: a.user_id, to: req.user.id });
    return { ok: true };
  });
  // Krank melden: selbst oder durch die Planung; der Platz wird frei, die Planung bekommt eine Glocke
  app.post('/shift-assignments/:id/sick', authz('shift:read'), async (req) => {
    const { a, level } = await loadAssignment(req);
    if (a.user_id !== req.user.id && level < LEVEL.WRITE) throw forbidden('Nur für dich selbst');
    if (a.status === 'sick') return { ok: true };
    await q("UPDATE shift_assignments SET status='sick', updated_at=now() WHERE id=$1", [a.id]);
    const who = (await one('SELECT name FROM users WHERE id=$1', [a.user_id])).name;
    await notifyTeam(a.team_id, 'shifts', LEVEL.WRITE, 'shift', `${await teamName(a.team_id)}: Krankmeldung`, `${who} fällt aus: ${label(a)} – ein Platz ist frei`, { except: req.user.id, log: req.log });
    // Discord: nur „Platz frei“, keine Gesundheitsangabe
    discord(a.team_id, 'shift', { title: 'Schicht: Platz frei', description: label(a), path: 'shifts' }, req.log);
    await audit(req, 'shift.sick', 'shift', a.shift_id, { user: a.user_id });
    return { ok: true };
  });
  // Austragen: selbst vor Beginn, die Planung jederzeit
  app.delete('/shift-assignments/:id', authz('shift:read'), async (req) => {
    const { a, level } = await loadAssignment(req);
    const own = a.user_id === req.user.id;
    if (!own && level < LEVEL.WRITE) throw forbidden('Nur die Planung trägt andere aus');
    if (own && level < LEVEL.WRITE && new Date(a.starts_at) < new Date()) throw bad('Die Schicht hat schon begonnen – melde dich krank oder biete sie zum Tausch an');
    await q('DELETE FROM shift_assignments WHERE id=$1', [a.id]);
    if (!own) await notify(a.user_id, 'shift', `${await teamName(a.team_id)}: Aus Schicht ausgetragen`, label(a), undefined, req.log);
    return { ok: true };
  });

  // Wer ist im Dienst? Laufende Schichten mit Einteilung und eingestempelte Mitglieder
  app.get('/shifts/now', authz('shift:read'), async (req) => {
    const { team_id: teamId } = z.object({ team_id: uuid }).parse(req.query);
    await teamFor(req, teamId, 'shifts', LEVEL.READ);
    const [current, clocked] = await Promise.all([
      many(`SELECT s.id, s.title, s.starts_at, s.ends_at, s.color,
          COALESCE(json_agg(json_build_object('user_id', a.user_id, 'name', u.name, 'status', a.status) ORDER BY u.name) FILTER (WHERE a.id IS NOT NULL AND a.status <> 'sick'), '[]') AS people
        FROM shifts s LEFT JOIN shift_assignments a ON a.shift_id=s.id LEFT JOIN users u ON u.id=a.user_id
        WHERE s.team_id=$1 AND s.starts_at <= now() AND s.ends_at > now() GROUP BY s.id ORDER BY s.starts_at`, [teamId]),
      many(`SELECT u.id user_id, u.name, w.started_at, w.paused_at, r.name rank_name FROM work_timers w
          JOIN team_members tm ON tm.user_id=w.user_id AND tm.team_id=$1 JOIN users u ON u.id=w.user_id
          LEFT JOIN team_ranks r ON r.id=tm.rank_id ORDER BY u.name`, [teamId]),
    ]);
    return { shifts: current, clocked };
  });
}
