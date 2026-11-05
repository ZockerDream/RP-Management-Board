import { z } from 'zod';
import { one, many, q } from '../db.js';
import { requireAuth, notFound, forbidden, bad } from '../authz.js';

const id = z.string().uuid();
const sportType = z.enum(['run', 'swim', 'bike']);
const routeBody = z.object({
  team_id: id,
  sport_type: sportType,
  name: z.string().trim().min(1).max(100),
  checkpoints: z.number().int().min(0).max(1000).default(0),
  distance_km: z.number().min(0).max(99999).multipleOf(0.01).nullish(),
  notes: z.string().max(2000).default(''),
});
const scoreBody = z.object({
  score: z.number().min(0).max(99999999).multipleOf(0.01),
  duration_seconds: z.number().int().min(0).max(8640000).nullish(),
  checkpoints_reached: z.number().int().min(0).max(1000).nullish(),
  note: z.string().max(500).default(''),
  achieved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export default async function routes(app) {
  const teamRole = async (userId, teamId) => (await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId]))?.team_role;

  async function routeAccess(userId, routeId, write = false) {
    const route = await one('SELECT * FROM sport_routes WHERE id=$1', [routeId]);
    const role = route && await teamRole(userId, route.team_id);
    if (!role) throw notFound();
    if (write && role === 'viewer') throw forbidden('Nur Team-Owner und Editoren können Strecken verwalten');
    return { route, role };
  }

  app.get('/sport/routes', requireAuth, async (req) => {
    const { sport_type: type } = z.object({ sport_type: sportType.optional() }).parse(req.query);
    const routes = await many(
      `SELECT r.*, t.name team_name, tm.team_role role,
         (SELECT count(*)::int FROM sport_scores s WHERE s.route_id=r.id) attempts,
         (SELECT count(DISTINCT s.user_id)::int FROM sport_scores s WHERE s.route_id=r.id) participants,
         (SELECT max(s.score) FROM sport_scores s WHERE s.route_id=r.id) best_score
       FROM sport_routes r JOIN teams t ON t.id=r.team_id JOIN team_members tm ON tm.team_id=r.team_id AND tm.user_id=$1
       WHERE ($2::text IS NULL OR r.sport_type=$2)
       ORDER BY t.name, r.name`,
      [req.user.id, type ?? null],
    );
    if (!routes.length) return routes;
    const scores = await many(
      `SELECT s.id, s.route_id, s.user_id, u.name user_name, s.score, s.duration_seconds, s.checkpoints_reached, s.note, s.achieved_on
       FROM sport_scores s JOIN users u ON u.id=s.user_id WHERE s.route_id = ANY($1::uuid[])
       ORDER BY s.score DESC, s.duration_seconds NULLS LAST, s.created_at`,
      [routes.map((route) => route.id)],
    );
    return routes.map((route) => ({ ...route, scores: scores.filter((score) => score.route_id === route.id) }));
  });

  app.post('/sport/routes', requireAuth, async (req) => {
    const b = routeBody.parse(req.body);
    const role = await teamRole(req.user.id, b.team_id);
    if (!role) throw notFound('Team nicht gefunden');
    if (role === 'viewer') throw forbidden('Nur Team-Owner und Editoren können Strecken anlegen');
    return one('INSERT INTO sport_routes(team_id,sport_type,name,checkpoints,distance_km,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [b.team_id, b.sport_type, b.name, b.checkpoints, b.distance_km ?? null, b.notes, req.user.id]);
  });

  app.patch('/sport/routes/:id', requireAuth, async (req) => {
    const { route } = await routeAccess(req.user.id, req.params.id, true);
    const b = routeBody.omit({ team_id: true, sport_type: true }).parse(req.body);
    await q('UPDATE sport_routes SET name=$2,checkpoints=$3,distance_km=$4,notes=$5 WHERE id=$1', [route.id, b.name, b.checkpoints, b.distance_km ?? null, b.notes]);
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
    if (b.checkpoints_reached != null && b.checkpoints_reached > route.checkpoints) throw bad('Mehr Checkpoints als auf der Strecke vorhanden');
    return one(
      `INSERT INTO sport_scores(route_id,user_id,score,duration_seconds,checkpoints_reached,note,achieved_on)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date,CURRENT_DATE)) RETURNING id`,
      [route.id, req.user.id, b.score, b.duration_seconds ?? null, b.checkpoints_reached ?? null, b.note, b.achieved_on ?? null],
    );
  });

  app.delete('/sport/scores/:id', requireAuth, async (req) => {
    const score = await one('SELECT s.id, s.user_id, r.team_id FROM sport_scores s JOIN sport_routes r ON r.id=s.route_id WHERE s.id=$1', [req.params.id]);
    const role = score && await teamRole(req.user.id, score.team_id);
    if (!role) throw notFound();
    if (score.user_id !== req.user.id && role === 'viewer') throw forbidden();
    await q('DELETE FROM sport_scores WHERE id=$1', [score.id]);
    return { ok: true };
  });
}
