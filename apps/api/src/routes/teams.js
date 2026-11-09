// Organisationen (Code und API: team). Mitglieder haben einen Rang und beliebig viele Gruppen; Rechte hängen pro Funktion
// an Rang, Gruppe oder Benutzer (siehe org.js). Inhaber dürfen alles. Alle anderen verwalten nur Mitglieder und Ränge
// unter dem eigenen Rang und vergeben nie mehr, als sie selbst haben.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { authz, bad, notFound, forbidden } from '../authz.js';
import { randomToken, sha256 } from '../security.js';
import { sendMail } from '../mail.js';
import { notify } from '../lib.js';
import { audit } from '../audit.js';
import { ORG_MODULES, LEVEL_LABELS, LEVEL, MODULE_KEYS, levelsFor, validLevel, moduleLabel } from '../org.js';

const uuid = z.string().uuid();
const name60 = z.string().trim().min(1).max(60);
const SCOPE_TABLES = { casefile: 'case_file_types', doc: 'doc_categories' };

export async function createInvitation({ email, roleId, teamId, rankId, invitedBy, log }) {
  const token = randomToken(32);
  await q('DELETE FROM invitations WHERE email=$1 AND accepted_at IS NULL AND team_id IS NOT DISTINCT FROM $2', [email, teamId || null]);
  await q("INSERT INTO invitations(email, role_id, team_id, rank_id, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')",
    [email, roleId || null, teamId || null, rankId || null, sha256(token), invitedBy]);
  const link = `${config.appUrl}/#/invite?token=${token}`;
  const sent = await sendMail({ to: email, subject: 'Einladung zu RP-Management-Board', text: `Du wurdest zu RP-Management-Board eingeladen.\n\nKonto anlegen (7 Tage gültig):\n${link}\n`, log });
  return { link, mail_sent: sent };
}

// Wer handelt: Inhaber, Rangposition und Stufen in dieser Organisation
async function actorOf(userId, teamId) {
  const m = await one(
    `SELECT tm.is_owner, tm.rank_id, r.position FROM team_members tm LEFT JOIN team_ranks r ON r.id=tm.rank_id
     WHERE tm.team_id=$1 AND tm.user_id=$2`, [teamId, userId]);
  if (!m) throw notFound('Organisation nicht gefunden');
  return { userId, teamId, owner: m.is_owner, rankId: m.rank_id, position: m.position ?? -Infinity, levels: await levelsFor(userId, teamId) };
}
function needMembers(actor, level) {
  if (actor.owner || actor.levels.members >= level) return;
  throw forbidden(level >= LEVEL.MANAGE ? 'Ränge, Gruppen und Rechte darfst du in dieser Organisation nicht verwalten' : 'Mitglieder darfst du in dieser Organisation nicht verwalten');
}
const needOwner = (actor) => { if (!actor.owner) throw forbidden('Nur Inhaber der Organisation dürfen das'); };
const belowActor = (actor, position) => actor.owner || (position ?? -Infinity) < actor.position;

// Aktenarten und Doku-Kategorien der Organisation, für die es eigene Rechte geben kann
async function scopesOf(teamId) {
  const [casefile, doc] = await Promise.all([
    many('SELECT id, name FROM case_file_types WHERE team_id=$1 ORDER BY name', [teamId]),
    many('SELECT id, name FROM doc_categories WHERE team_id=$1 ORDER BY sort, name', [teamId]),
  ]);
  return { casefile, doc };
}

// Stufe eines Rangs oder einer Gruppe für jede Funktion und jeden Bereich: Bereichszeile vor Funktionszeile
function resolveRows(rows, scopes) {
  const out = {};
  for (const m of MODULE_KEYS) {
    const base = rows.find((r) => r.module === m && !r.scope_id)?.level ?? 0;
    out[m] = base;
    for (const s of scopes[m] || []) out[`${m}:${s.id}`] = rows.find((r) => r.module === m && r.scope_id === s.id)?.level ?? base;
  }
  return out;
}
async function actorScopeLevels(actor, scopes) {
  const out = { ...actor.levels };
  for (const [m, list] of Object.entries(scopes)) {
    for (const s of list) out[`${m}:${s.id}`] = (await one('SELECT team_level($1,$2,$3,$4) AS level', [actor.teamId, actor.userId, m, s.id])).level;
  }
  return out;
}
// Niemand gibt mehr, als er selbst hat: jede gestiegene Stufe muss innerhalb der eigenen liegen
function assertWithin(actor, actorLevels, before, after) {
  if (actor.owner) return;
  for (const [key, level] of Object.entries(after)) {
    if (level > (before?.[key] ?? 0) && level > (actorLevels[key] ?? 0)) {
      throw forbidden(`Du kannst bei „${moduleLabel(key.split(':')[0])}“ nicht mehr vergeben, als du selbst hast`);
    }
  }
}
const subjectRows = (column, id) => many(`SELECT module, scope_id, level FROM team_permissions WHERE ${column}=$1`, [id]);
// Rang oder Gruppe zuweisen: Sie dürfen nicht mehr Rechte bringen, als die handelnde Person selbst hat
async function assertSubjectWithin(actor, column, id) {
  if (actor.owner) return;
  const scopes = await scopesOf(actor.teamId);
  assertWithin(actor, await actorScopeLevels(actor, scopes), null, resolveRows(await subjectRows(column, id), scopes));
}

const rankOf = async (teamId, rankId) => {
  const r = await one('SELECT * FROM team_ranks WHERE id=$1 AND team_id=$2', [rankId, teamId]);
  if (!r) throw bad('Rang gehört nicht zu dieser Organisation');
  return r;
};
const memberOf = async (teamId, userId) => {
  const m = await one(
    'SELECT tm.*, r.position, r.name rank_name FROM team_members tm LEFT JOIN team_ranks r ON r.id=tm.rank_id WHERE tm.team_id=$1 AND tm.user_id=$2',
    [teamId, userId],
  );
  if (!m) throw notFound('Mitglied nicht gefunden');
  return m;
};
async function assertLastOwner(teamId, userId) {
  const owners = (await one('SELECT count(*)::int n FROM team_members WHERE team_id=$1 AND is_owner AND user_id<>$2', [teamId, userId])).n;
  if (!owners) throw bad('Die Organisation braucht mindestens einen Inhaber');
}
// Ein Mitglied verwalten: Inhaber jeden, sonst nur Nicht-Inhaber unter dem eigenen Rang
function assertManageable(actor, target) {
  if (actor.owner) return;
  if (target.user_id === actor.userId) throw forbidden('Deinen eigenen Rang und deine Gruppen ändert jemand über dir');
  if (target.is_owner || !belowActor(actor, target.position)) throw forbidden('Du kannst nur Mitglieder unter deinem Rang verwalten');
}

export default async function routes(app) {
  app.get('/teams/catalog', authz('team:read'), async () => ({ modules: ORG_MODULES, levels: LEVEL_LABELS }));

  app.get('/teams', authz('team:read'), async (req) => {
    const teams = await many(
      `SELECT t.id, t.name, t.status, t.owner_id, tm.is_owner, tm.rank_id, r.name rank_name, r.position rank_position,
         (SELECT count(*)::int FROM budgets b WHERE b.team_id=t.id) budgets
       FROM teams t JOIN team_members tm ON tm.team_id=t.id AND tm.user_id=$1 LEFT JOIN team_ranks r ON r.id=tm.rank_id
       ORDER BY t.status, t.name`,
      [req.user.id],
    );
    for (const t of teams) {
      const actor = { userId: req.user.id, owner: t.is_owner, position: t.rank_position ?? -Infinity };
      t.levels = await levelsFor(req.user.id, t.id);
      const see = t.is_owner || t.levels.members >= LEVEL.READ;
      const manage = t.is_owner || t.levels.members >= LEVEL.WRITE;
      t.group_ids = (await many('SELECT group_id FROM team_group_members WHERE team_id=$1 AND user_id=$2', [t.id, req.user.id])).map((g) => g.group_id);
      t.ranks = see ? (await many(
        'SELECT r.id, r.name, r.position, (SELECT count(*)::int FROM team_members tm WHERE tm.rank_id=r.id) members FROM team_ranks r WHERE r.team_id=$1 ORDER BY r.position DESC',
        [t.id],
      )).map((r) => ({ ...r, manageable: belowActor(actor, r.position) })) : [];
      t.groups = see ? await many(
        `SELECT g.id, g.name, g.description, COALESCE(array_agg(gm.user_id) FILTER (WHERE gm.user_id IS NOT NULL), '{}') member_ids
         FROM team_groups g LEFT JOIN team_group_members gm ON gm.group_id=g.id WHERE g.team_id=$1 GROUP BY g.id ORDER BY g.name`,
        [t.id],
      ) : [];
      t.members = see ? (await many(
        `SELECT u.id, u.name, u.email, u.gravatar_enabled, tm.is_owner, tm.rank_id, r.name rank_name, r.position rank_position,
           COALESCE((SELECT array_agg(gm.group_id) FROM team_group_members gm WHERE gm.team_id=tm.team_id AND gm.user_id=tm.user_id), '{}') group_ids
         FROM team_members tm JOIN users u ON u.id=tm.user_id LEFT JOIN team_ranks r ON r.id=tm.rank_id
         WHERE tm.team_id=$1 ORDER BY tm.is_owner DESC, r.position DESC NULLS LAST, u.name`,
        [t.id],
      )).map((m) => ({ ...m, manageable: manage && m.id !== req.user.id && (t.is_owner || (!m.is_owner && belowActor(actor, m.rank_position))) })) : [];
      t.invitations = manage ? await many(
        'SELECT i.id, i.email, i.rank_id, r.name rank_name, i.expires_at FROM invitations i LEFT JOIN team_ranks r ON r.id=i.rank_id WHERE i.team_id=$1 AND i.accepted_at IS NULL AND i.expires_at>now()',
        [t.id],
      ) : [];
    }
    return teams;
  });

  app.post('/teams', authz('team:create'), async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const t = await tx(async (c) => {
      const r = (await c.query('INSERT INTO teams(name, owner_id) VALUES ($1,$2) RETURNING id', [name, req.user.id])).rows[0];
      await c.query('SELECT seed_team_ranks($1)', [r.id]);
      await c.query(
        'INSERT INTO team_members(team_id, user_id, is_owner, rank_id) SELECT $1, $2, true, id FROM team_ranks WHERE team_id=$1 ORDER BY position DESC LIMIT 1',
        [r.id, req.user.id],
      );
      return r;
    });
    await audit(req, 'team.created', 'team', t.id);
    return t;
  });

  app.patch('/teams/:id', authz('team:update'), async (req) => {
    needOwner(await actorOf(req.user.id, req.params.id));
    const b = z.object({ name: z.string().trim().min(1).max(100).optional(), status: z.enum(['active', 'archived']).optional() }).parse(req.body);
    await q('UPDATE teams SET name=COALESCE($2,name), status=COALESCE($3,status) WHERE id=$1', [req.params.id, b.name ?? null, b.status ?? null]);
    return { ok: true };
  });

  app.delete('/teams/:id', authz('team:delete'), async (req) => {
    needOwner(await actorOf(req.user.id, req.params.id));
    await q('DELETE FROM teams WHERE id=$1', [req.params.id]);
    await audit(req, 'team.deleted', 'team', req.params.id);
    return { ok: true };
  });

  // ---- Mitglieder
  app.post('/teams/:id/members', authz('team:update'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    needMembers(actor, LEVEL.WRITE);
    const b = z.object({ email: z.string().email(), rank_id: uuid.nullish() }).parse(req.body);
    const rank = b.rank_id
      ? await rankOf(req.params.id, b.rank_id)
      : await one('SELECT * FROM team_ranks WHERE team_id=$1 ORDER BY position LIMIT 1', [req.params.id]);
    if (!rank) throw bad('Lege zuerst einen Rang an');
    if (!belowActor(actor, rank.position)) throw forbidden('Du kannst nur Ränge unter deinem eigenen vergeben');
    await assertSubjectWithin(actor, 'rank_id', rank.id);
    const u = await one("SELECT id, name FROM users WHERE email=$1 AND status='active' AND deleted_at IS NULL", [b.email]);
    const team = await one('SELECT name FROM teams WHERE id=$1', [req.params.id]);
    if (u) {
      const added = await one(
        'INSERT INTO team_members(team_id, user_id, rank_id) VALUES ($1,$2,$3) ON CONFLICT (team_id, user_id) DO NOTHING RETURNING user_id',
        [req.params.id, u.id, rank.id],
      );
      if (!added) throw bad('Die Person ist schon Mitglied – ändere stattdessen ihren Rang');
      await notify(u.id, 'team_added', `Du wurdest zu „${team.name}“ hinzugefügt`, `Rang: ${rank.name}`);
      await audit(req, 'team.member_added', 'team', req.params.id, { user: u.id, rank: rank.id });
      return { added: true };
    }
    const inv = await createInvitation({ email: b.email, teamId: req.params.id, rankId: rank.id, invitedBy: req.user.id, log: req.log });
    await audit(req, 'team.invited', 'team', req.params.id, { email: b.email });
    return { added: false, invited: true, ...inv };
  });

  app.patch('/teams/:id/members/:uid', authz('team:update'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    const b = z.object({ rank_id: uuid.optional(), is_owner: z.boolean().optional(), group_ids: z.array(uuid).max(100).optional() }).parse(req.body);
    const target = await memberOf(req.params.id, req.params.uid);
    if (b.is_owner !== undefined && b.is_owner !== target.is_owner) {
      needOwner(actor);
      if (!b.is_owner) await assertLastOwner(req.params.id, target.user_id);
      await q('UPDATE team_members SET is_owner=$3 WHERE team_id=$1 AND user_id=$2', [req.params.id, target.user_id, b.is_owner]);
      await audit(req, b.is_owner ? 'team.owner_added' : 'team.owner_removed', 'team', req.params.id, { user: target.user_id });
    }
    if (b.rank_id && b.rank_id !== target.rank_id) {
      needMembers(actor, LEVEL.WRITE);
      assertManageable(actor, target);
      const rank = await rankOf(req.params.id, b.rank_id);
      if (!belowActor(actor, rank.position)) throw forbidden('Du kannst nur Ränge unter deinem eigenen vergeben');
      await assertSubjectWithin(actor, 'rank_id', rank.id);
      await q('UPDATE team_members SET rank_id=$3 WHERE team_id=$1 AND user_id=$2', [req.params.id, target.user_id, rank.id]);
      await notify(target.user_id, 'team_added', `Neuer Rang in „${(await one('SELECT name FROM teams WHERE id=$1', [req.params.id])).name}“`, `Rang: ${rank.name}`);
      await audit(req, 'team.rank_assigned', 'team', req.params.id, { user: target.user_id, rank: rank.id });
    }
    if (b.group_ids) {
      needMembers(actor, LEVEL.WRITE);
      assertManageable(actor, target);
      const current = (await many('SELECT group_id FROM team_group_members WHERE team_id=$1 AND user_id=$2', [req.params.id, target.user_id])).map((g) => g.group_id);
      const wanted = [...new Set(b.group_ids)];
      const valid = (await many('SELECT id FROM team_groups WHERE team_id=$1 AND id = ANY($2::uuid[])', [req.params.id, wanted])).map((g) => g.id);
      if (valid.length !== wanted.length) throw bad('Gruppe gehört nicht zu dieser Organisation');
      for (const g of wanted.filter((x) => !current.includes(x))) await assertSubjectWithin(actor, 'group_id', g);
      for (const g of current.filter((x) => !wanted.includes(x))) await assertSubjectWithin(actor, 'group_id', g);
      await tx(async (c) => {
        await c.query('DELETE FROM team_group_members WHERE team_id=$1 AND user_id=$2', [req.params.id, target.user_id]);
        for (const g of wanted) await c.query('INSERT INTO team_group_members(group_id, team_id, user_id) VALUES ($1,$2,$3)', [g, req.params.id, target.user_id]);
      });
      await audit(req, 'team.groups_assigned', 'team', req.params.id, { user: target.user_id, groups: wanted });
    }
    return { ok: true };
  });

  app.delete('/teams/:id/members/:uid', authz('team:read'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    const target = await memberOf(req.params.id, req.params.uid);
    if (target.user_id !== req.user.id) {
      needMembers(actor, LEVEL.WRITE);
      assertManageable(actor, target);
    }
    if (target.is_owner) await assertLastOwner(req.params.id, target.user_id);
    await q('DELETE FROM team_members WHERE team_id=$1 AND user_id=$2', [req.params.id, target.user_id]);
    await audit(req, target.user_id === req.user.id ? 'team.left' : 'team.member_removed', 'team', req.params.id, { user: target.user_id });
    return { ok: true };
  });

  app.delete('/teams/:id/invitations/:iid', authz('team:update'), async (req) => {
    needMembers(await actorOf(req.user.id, req.params.id), LEVEL.WRITE);
    await q('DELETE FROM invitations WHERE id=$1 AND team_id=$2', [req.params.iid, req.params.id]);
    return { ok: true };
  });

  // ---- Ränge: neue Ränge kommen ganz nach unten und haben noch keine Rechte
  app.post('/teams/:id/ranks', authz('team:update'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    needMembers(actor, LEVEL.MANAGE);
    const { name } = z.object({ name: name60 }).parse(req.body);
    try {
      const r = await one(
        'INSERT INTO team_ranks(team_id, name, position) SELECT $1, $2, COALESCE(min(position), 20) - 10 FROM team_ranks WHERE team_id=$1 RETURNING id',
        [req.params.id, name],
      );
      await audit(req, 'team.rank_created', 'team', req.params.id, { rank: r.id });
      return r;
    } catch (e) {
      if (e.code === '23505') throw bad('Einen Rang mit diesem Namen gibt es schon');
      throw e;
    }
  });

  app.patch('/team-ranks/:id', authz('team:update'), async (req) => {
    const rank = await one('SELECT * FROM team_ranks WHERE id=$1', [req.params.id]);
    if (!rank) throw notFound();
    const actor = await actorOf(req.user.id, rank.team_id);
    needMembers(actor, LEVEL.MANAGE);
    if (!belowActor(actor, rank.position)) throw forbidden('Du kannst nur Ränge unter deinem eigenen ändern');
    const b = z.object({ name: name60.optional(), move: z.enum(['up', 'down']).optional() }).parse(req.body);
    try {
      await tx(async (c) => {
        if (b.name) await c.query('UPDATE team_ranks SET name=$2 WHERE id=$1', [rank.id, b.name]);
        if (b.move) {
          const other = (await c.query(
            `SELECT * FROM team_ranks WHERE team_id=$1 AND position ${b.move === 'up' ? '>' : '<'} $2 ORDER BY position ${b.move === 'up' ? 'ASC' : 'DESC'} LIMIT 1`,
            [rank.team_id, rank.position],
          )).rows[0];
          if (!other) throw bad(b.move === 'up' ? 'Das ist schon der höchste Rang' : 'Das ist schon der niedrigste Rang');
          if (!belowActor(actor, other.position)) throw forbidden('Ein Rang kann nicht auf oder über deinen eigenen steigen');
          await c.query('UPDATE team_ranks SET position=$2 WHERE id=$1', [rank.id, other.position]);
          await c.query('UPDATE team_ranks SET position=$2 WHERE id=$1', [other.id, rank.position]);
        }
      });
    } catch (e) {
      if (e.code === '23505') throw bad('Einen Rang mit diesem Namen gibt es schon');
      throw e;
    }
    await audit(req, 'team.rank_updated', 'team', rank.team_id, { rank: rank.id, ...b });
    return { ok: true };
  });

  app.delete('/team-ranks/:id', authz('team:update'), async (req) => {
    const rank = await one('SELECT * FROM team_ranks WHERE id=$1', [req.params.id]);
    if (!rank) throw notFound();
    const actor = await actorOf(req.user.id, rank.team_id);
    needMembers(actor, LEVEL.MANAGE);
    if (!belowActor(actor, rank.position)) throw forbidden('Du kannst nur Ränge unter deinem eigenen löschen');
    const used = (await one('SELECT count(*)::int n FROM team_members WHERE rank_id=$1', [rank.id])).n;
    if (used) throw bad(`Der Rang ist ${used === 1 ? 'einem Mitglied' : `${used} Mitgliedern`} zugewiesen – gib ${used === 1 ? 'ihm' : 'ihnen'} zuerst einen anderen Rang`);
    await q('DELETE FROM team_ranks WHERE id=$1', [rank.id]);
    await audit(req, 'team.rank_deleted', 'team', rank.team_id, { rank: rank.id, name: rank.name });
    return { ok: true };
  });

  // ---- Gruppen
  const groupSchema = z.object({ name: name60, description: z.string().max(500).default('') });
  app.post('/teams/:id/groups', authz('team:update'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    needMembers(actor, LEVEL.MANAGE);
    const b = groupSchema.parse(req.body);
    try {
      const g = await one('INSERT INTO team_groups(team_id, name, description) VALUES ($1,$2,$3) RETURNING id', [req.params.id, b.name, b.description]);
      await audit(req, 'team.group_created', 'team', req.params.id, { group: g.id });
      return g;
    } catch (e) {
      if (e.code === '23505') throw bad('Eine Gruppe mit diesem Namen gibt es schon');
      throw e;
    }
  });

  async function groupForManage(req) {
    const group = await one('SELECT * FROM team_groups WHERE id=$1', [req.params.id]);
    if (!group) throw notFound();
    const actor = await actorOf(req.user.id, group.team_id);
    needMembers(actor, LEVEL.MANAGE);
    await assertSubjectWithin(actor, 'group_id', group.id);
    return group;
  }
  app.patch('/team-groups/:id', authz('team:update'), async (req) => {
    const group = await groupForManage(req);
    const b = z.object({ name: name60.optional(), description: z.string().max(500).optional() }).parse(req.body);
    try {
      await q('UPDATE team_groups SET name=COALESCE($2,name), description=COALESCE($3,description) WHERE id=$1', [group.id, b.name ?? null, b.description ?? null]);
    } catch (e) {
      if (e.code === '23505') throw bad('Eine Gruppe mit diesem Namen gibt es schon');
      throw e;
    }
    return { ok: true };
  });
  app.delete('/team-groups/:id', authz('team:update'), async (req) => {
    const group = await groupForManage(req);
    await q('DELETE FROM team_groups WHERE id=$1', [group.id]);
    await audit(req, 'team.group_deleted', 'team', group.team_id, { group: group.id, name: group.name });
    return { ok: true };
  });

  // ---- Rechte
  app.get('/teams/:id/permissions', authz('team:read'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    needMembers(actor, LEVEL.MANAGE);
    const [rows, scopes] = await Promise.all([
      many('SELECT rank_id, group_id, user_id, module, scope_id, level FROM team_permissions WHERE team_id=$1', [req.params.id]),
      scopesOf(req.params.id),
    ]);
    return { rows, scopes, mine: await actorScopeLevels(actor, scopes), is_owner: actor.owner };
  });

  // Was ein Mitglied tatsächlich darf (Funktion und jeder Bereich), zur Anzeige neben persönlichen Rechten
  app.get('/teams/:id/members/:uid/levels', authz('team:read'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    if (req.params.uid !== req.user.id) needMembers(actor, LEVEL.MANAGE);
    await memberOf(req.params.id, req.params.uid);
    const scopes = await scopesOf(req.params.id);
    return actorScopeLevels({ ...actor, userId: req.params.uid, levels: await levelsFor(req.params.uid, req.params.id) }, scopes);
  });

  app.put('/teams/:id/permissions', authz('team:update'), async (req) => {
    const actor = await actorOf(req.user.id, req.params.id);
    needMembers(actor, LEVEL.MANAGE);
    const b = z.object({
      subject: z.enum(['rank', 'group', 'user']),
      subject_id: uuid,
      module: z.enum(MODULE_KEYS),
      scope_id: uuid.nullish(),
      level: z.number().int().min(0).max(4).nullable(),
    }).parse(req.body);
    if (b.level !== null && !validLevel(b.module, b.level)) throw bad(`„${LEVEL_LABELS[b.level]}“ gibt es bei „${moduleLabel(b.module)}“ nicht`);
    if (b.scope_id) {
      const table = SCOPE_TABLES[b.module];
      if (!table || !(await one(`SELECT 1 FROM ${table} WHERE id=$1 AND team_id=$2`, [b.scope_id, req.params.id]))) throw bad('Bereich gehört nicht zu dieser Organisation');
    }
    const column = `${b.subject}_id`;
    if (b.subject === 'rank') {
      const rank = await rankOf(req.params.id, b.subject_id);
      if (!belowActor(actor, rank.position)) throw forbidden('Du kannst nur Rechte für Ränge unter deinem eigenen ändern');
    } else if (b.subject === 'group') {
      if (!(await one('SELECT 1 FROM team_groups WHERE id=$1 AND team_id=$2', [b.subject_id, req.params.id]))) throw bad('Gruppe gehört nicht zu dieser Organisation');
    } else {
      assertManageable(actor, await memberOf(req.params.id, b.subject_id));
    }
    const scopes = await scopesOf(req.params.id);
    const mine = await actorScopeLevels(actor, scopes);
    const forSubject = async (c) => {
      if (b.subject !== 'user') {
        return resolveRows((await c.query(`SELECT module, scope_id, level FROM team_permissions WHERE ${column}=$1`, [b.subject_id])).rows, scopes);
      }
      const keys = [b.module, ...(scopes[b.module] || []).map((s) => s.id)];
      const out = {};
      for (const k of keys) {
        const scope = k === b.module ? null : k;
        out[scope ? `${b.module}:${scope}` : b.module] = (await c.query('SELECT team_level($1,$2,$3,$4) AS level', [req.params.id, b.subject_id, b.module, scope])).rows[0].level;
      }
      return out;
    };
    await tx(async (c) => {
      const before = await forSubject(c);
      await c.query(`DELETE FROM team_permissions WHERE team_id=$1 AND ${column}=$2 AND module=$3 AND scope_id IS NOT DISTINCT FROM $4`, [req.params.id, b.subject_id, b.module, b.scope_id || null]);
      if (b.level !== null) {
        await c.query(`INSERT INTO team_permissions(team_id, ${column}, module, scope_id, level) VALUES ($1,$2,$3,$4,$5)`, [req.params.id, b.subject_id, b.module, b.scope_id || null, b.level]);
      }
      const after = await forSubject(c);
      if (b.subject === 'group') assertWithin(actor, mine, null, after);
      else assertWithin(actor, mine, before, after);
    });
    await audit(req, 'team.permission_changed', 'team', req.params.id, b);
    return { ok: true };
  });
}
