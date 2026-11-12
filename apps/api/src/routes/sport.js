import { z } from 'zod';
import { one, many, q } from '../db.js';
import { requireAuth, notFound, forbidden } from '../authz.js';
import { LEVEL, teamLevel, recordOwner, needMessage } from '../org.js';

const id = z.string().uuid();
const sportType = z.enum(['run', 'swim', 'bike']);
const routeBody = z.object({
  team_id: id,
  sport_type: sportType,
  name: z.string().trim().min(1).max(100),
  checkpoints: z.number().int().min(0).max(1000).default(0),
  laps: z.number().int().min(1).max(1000).default(1),
  notes: z.string().max(2000).default(''),
});
// Ergebnisse sind Zeiten (MM:SS:hh, in Millisekunden, höchstens 24 Stunden wie MAX_SPORT_MS in sport-time.js);
// Punkte gibt es seit Migration 029 nicht mehr
const scoreBody = z.object({
  duration_ms: z.number().int().min(0).max(86400000),
  note: z.string().max(500).default(''),
  achieved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export default async function routes(app) {
  // Strecken gehören immer einer Organisation: Bestenliste und eigene Ergebnisse ab „Lesen“, Strecken ab „Lesen & Schreiben“
  async function routeAccess(userId, routeId, write = false) {
    const route = await one('SELECT * FROM sport_routes WHERE id=$1', [routeId]);
    const level = route ? await teamLevel(userId, route.team_id, 'sport') : 0;
    if (level < LEVEL.READ) throw notFound();
    if (write && level < LEVEL.WRITE) throw forbidden(needMessage('sport', LEVEL.WRITE));
    return { route, level };
  }

  app.get('/sport/routes', requireAuth, async (req) => {
    const { sport_type: type } = z.object({ sport_type: sportType.optional() }).parse(req.query);
    const routes = await many(
      `SELECT * FROM (
         SELECT r.*, t.name team_name, team_level(r.team_id, $1, 'sport') AS level,
           (SELECT count(*)::int FROM sport_scores s WHERE s.route_id=r.id) attempts,
           (SELECT count(DISTINCT s.user_id)::int FROM sport_scores s WHERE s.route_id=r.id) participants
         FROM sport_routes r JOIN teams t ON t.id=r.team_id
         WHERE r.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1) AND ($2::text IS NULL OR r.sport_type=$2)
       ) x WHERE x.level >= 2 ORDER BY x.team_name, x.name`,
      [req.user.id, type ?? null],
    );
    if (!routes.length) return routes;
    const scores = await many(
      `SELECT s.id, s.route_id, s.user_id, u.name user_name, s.duration_ms, s.note, s.achieved_on
       FROM sport_scores s JOIN users u ON u.id=s.user_id WHERE s.route_id = ANY($1::uuid[])
       ORDER BY s.duration_ms NULLS LAST, s.created_at`,
      [routes.map((route) => route.id)],
    );
    // Eine Zeit gilt nur mit allen Checkpoints der Strecke; die Bestenliste sortiert allein nach der Zeit
    return routes.map((route) => {
      const list = scores.filter((score) => score.route_id === route.id);
      return { ...route, best_ms: list[0]?.duration_ms ?? null, scores: list };
    });
  });

  app.post('/sport/routes', requireAuth, async (req) => {
    const b = routeBody.parse(req.body);
    await recordOwner(req.user.id, b.team_id, 'sport', LEVEL.WRITE);
    return one('INSERT INTO sport_routes(team_id,sport_type,name,checkpoints,laps,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [b.team_id, b.sport_type, b.name, b.checkpoints, b.laps, b.notes, req.user.id]);
  });

  app.patch('/sport/routes/:id', requireAuth, async (req) => {
    const { route } = await routeAccess(req.user.id, req.params.id, true);
    const b = routeBody.omit({ team_id: true, sport_type: true }).parse(req.body);
    await q('UPDATE sport_routes SET name=$2,checkpoints=$3,laps=$4,notes=$5 WHERE id=$1', [route.id, b.name, b.checkpoints, b.laps, b.notes]);
    return { ok: true };
  });

  app.delete('/sport/routes/:id', requireAuth, async (req) => {
    const { route } = await routeAccess(req.user.id, req.params.id, true);
    await q('DELETE FROM sport_routes WHERE id=$1', [route.id]);
    return { ok: true };
  });

  app.post('/sport/routes/:id/scores', requireAuth, async (req) => {
    const { route } = await routeAccess(req.user.id, req.params.id);
    const b = scoreBody.parse(req.body);
    return one(
      `INSERT INTO sport_scores(route_id,user_id,duration_ms,note,achieved_on)
       VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE)) RETURNING id`,
      [route.id, req.user.id, b.duration_ms, b.note, b.achieved_on ?? null],
    );
  });

  app.delete('/sport/scores/:id', requireAuth, async (req) => {
    const score = await one('SELECT s.id, s.user_id, r.team_id FROM sport_scores s JOIN sport_routes r ON r.id=s.route_id WHERE s.id=$1', [req.params.id]);
    const level = score ? await teamLevel(req.user.id, score.team_id, 'sport') : 0;
    if (level < LEVEL.READ) throw notFound();
    if (score.user_id !== req.user.id && level < LEVEL.WRITE) throw forbidden(needMessage('sport', LEVEL.WRITE));
    await q('DELETE FROM sport_scores WHERE id=$1', [score.id]);
    return { ok: true };
  });
}
