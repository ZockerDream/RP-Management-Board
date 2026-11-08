import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { authz, bad, notFound, forbidden } from '../authz.js';
import { randomToken, sha256 } from '../security.js';
import { sendMail } from '../mail.js';
import { notify } from '../lib.js';
import { audit } from '../audit.js';

async function teamRole(userId, teamId) {
  const m = await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [teamId, userId]);
  if (!m) throw notFound('Team nicht gefunden');
  return m.team_role;
}
async function requireOwner(userId, teamId) {
  if ((await teamRole(userId, teamId)) !== 'owner') throw forbidden('Nur Team-Eigentümer dürfen das');
}

export async function createInvitation({ email, roleId, teamId, teamRole: tr, invitedBy, log }) {
  const token = randomToken(32);
  await q('DELETE FROM invitations WHERE email=$1 AND accepted_at IS NULL AND team_id IS NOT DISTINCT FROM $2', [email, teamId || null]);
  await q("INSERT INTO invitations(email, role_id, team_id, team_role, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')",
    [email, roleId || null, teamId || null, tr || 'viewer', sha256(token), invitedBy]);
  const link = `${config.appUrl}/#/invite?token=${token}`;
  const sent = await sendMail({ to: email, subject: 'Einladung zu RP-Management-Board', text: `Du wurdest zu RP-Management-Board eingeladen.\n\nKonto anlegen (7 Tage gültig):\n${link}\n`, log });
  return { link, mail_sent: sent };
}

export default async function routes(app) {
  app.get('/teams', authz('team:read'), async (req) => {
    const teams = await many(
      `SELECT t.id, t.name, t.status, t.owner_id, tm.team_role role, (SELECT count(*)::int FROM budgets b WHERE b.team_id=t.id) budgets
       FROM teams t JOIN team_members tm ON tm.team_id=t.id AND tm.user_id=$1 ORDER BY t.status, t.name`,
      [req.user.id],
    );
    for (const t of teams) {
      t.members = await many(
        `SELECT u.id, u.name, u.email, u.gravatar_enabled, tm.team_role role FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1 ORDER BY tm.team_role, u.name`,
        [t.id],
      );
      t.invitations = t.role === 'owner' ? await many('SELECT id, email, team_role, expires_at FROM invitations WHERE team_id=$1 AND accepted_at IS NULL AND expires_at>now()', [t.id]) : [];
    }
    return teams;
  });

  app.post('/teams', authz('team:create'), async (req) => {
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    const t = await tx(async (c) => {
      const r = (await c.query('INSERT INTO teams(name, owner_id) VALUES ($1,$2) RETURNING id', [name, req.user.id])).rows[0];
      await c.query("INSERT INTO team_members VALUES ($1,$2,'owner')", [r.id, req.user.id]);
      return r;
    });
    await audit(req, 'team.created', 'team', t.id);
    return t;
  });

  app.patch('/teams/:id', authz('team:update'), async (req) => {
    await requireOwner(req.user.id, req.params.id);
    const b = z.object({ name: z.string().min(1).max(100).optional(), status: z.enum(['active', 'archived']).optional() }).parse(req.body);
    await q('UPDATE teams SET name=COALESCE($2,name), status=COALESCE($3,status) WHERE id=$1', [req.params.id, b.name ?? null, b.status ?? null]);
    return { ok: true };
  });

  app.delete('/teams/:id', authz('team:delete'), async (req) => {
    await requireOwner(req.user.id, req.params.id);
    await q('DELETE FROM teams WHERE id=$1', [req.params.id]);
    await audit(req, 'team.deleted', 'team', req.params.id);
    return { ok: true };
  });

  app.post('/teams/:id/members', authz('team:update'), async (req) => {
    await requireOwner(req.user.id, req.params.id);
    const b = z.object({ email: z.string().email(), team_role: z.enum(['editor', 'viewer']).default('viewer') }).parse(req.body);
    const u = await one("SELECT id, name FROM users WHERE email=$1 AND status='active' AND deleted_at IS NULL", [b.email]);
    const team = await one('SELECT name FROM teams WHERE id=$1', [req.params.id]);
    if (u) {
      await q('INSERT INTO team_members VALUES ($1,$2,$3) ON CONFLICT (team_id, user_id) DO UPDATE SET team_role = CASE WHEN team_members.team_role = \'owner\' THEN \'owner\' ELSE EXCLUDED.team_role END', [req.params.id, u.id, b.team_role]);
      await notify(u.id, 'team_added', `Du wurdest zu „${team.name}“ hinzugefügt`, `Rolle: ${b.team_role}`);
      await audit(req, 'team.member_added', 'team', req.params.id, { user: u.id });
      return { added: true };
    }
    const inv = await createInvitation({ email: b.email, teamId: req.params.id, teamRole: b.team_role, invitedBy: req.user.id, log: req.log });
    await audit(req, 'team.invited', 'team', req.params.id, { email: b.email });
    return { added: false, invited: true, ...inv };
  });

  app.patch('/teams/:id/members/:uid', authz('team:update'), async (req) => {
    await requireOwner(req.user.id, req.params.id);
    const { team_role } = z.object({ team_role: z.enum(['owner', 'editor', 'viewer']) }).parse(req.body);
    if (req.params.uid === req.user.id && team_role !== 'owner') {
      const owners = (await one("SELECT count(*)::int n FROM team_members WHERE team_id=$1 AND team_role='owner'", [req.params.id])).n;
      if (owners < 2) throw bad('Das Team braucht mindestens einen Eigentümer');
    }
    await q('UPDATE team_members SET team_role=$3 WHERE team_id=$1 AND user_id=$2', [req.params.id, req.params.uid, team_role]);
    return { ok: true };
  });

  app.delete('/teams/:id/members/:uid', authz('team:read'), async (req) => {
    const self = req.params.uid === req.user.id;
    if (!self) await requireOwner(req.user.id, req.params.id);
    const target = await one('SELECT team_role FROM team_members WHERE team_id=$1 AND user_id=$2', [req.params.id, req.params.uid]);
    if (!target) throw notFound();
    if (target.team_role === 'owner') {
      const owners = (await one("SELECT count(*)::int n FROM team_members WHERE team_id=$1 AND team_role='owner'", [req.params.id])).n;
      if (owners < 2) throw bad('Der letzte Eigentümer kann das Team nicht verlassen');
    }
    await q('DELETE FROM team_members WHERE team_id=$1 AND user_id=$2', [req.params.id, req.params.uid]);
    return { ok: true };
  });

  app.delete('/teams/:id/invitations/:iid', authz('team:update'), async (req) => {
    await requireOwner(req.user.id, req.params.id);
    await q('DELETE FROM invitations WHERE id=$1 AND team_id=$2', [req.params.iid, req.params.id]);
    return { ok: true };
  });
}
