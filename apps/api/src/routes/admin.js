import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import { adminOnly, bad, notFound, forbidden, invalidatePermCache, ipAllowed, PERMISSION_CATALOG } from '../authz.js';
import { hashPassword, encrypt, randomToken } from '../security.js';
import { allSettings, setSettings, jobStatus, DEFAULTS } from '../settings.js';
import { createInvitation } from './teams.js';
import { checkPassword } from './auth.js';
import { toCsv } from '../lib.js';
import { verifyMail, mailConfigured } from '../mail.js';
import { audit } from '../audit.js';
import { runBackup } from '../backup.js';

const id = z.string().uuid();

export default async function routes(app) {
  const A = (...p) => adminOnly(...p);

  app.get('/admin/overview', A(), async () => {
    const stats = await one(
      `SELECT (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) users, (SELECT count(*)::int FROM users WHERE status='active' AND deleted_at IS NULL) active_users,
         (SELECT count(*)::int FROM users WHERE totp_enabled AND deleted_at IS NULL) users_2fa, (SELECT count(*)::int FROM teams) teams, (SELECT count(*)::int FROM budgets) budgets,
         (SELECT count(*)::int FROM transactions) transactions, (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at>now()) sessions,
         (SELECT count(*)::int FROM users WHERE last_login_at > now() - interval '24 hours') logins_24h,
         (SELECT count(*)::int FROM audit_log WHERE action='login.failed' AND created_at > now() - interval '24 hours') failed_24h`,
    );
    const activity = await many(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, (SELECT count(*)::int FROM audit_log a WHERE a.created_at::date = d::date) AS n FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`,
    );
    const roles = await many(`SELECT r.name, count(ur.user_id)::int n FROM roles r LEFT JOIN user_roles ur ON ur.role_id=r.id GROUP BY r.name ORDER BY n DESC`);
    const recent = await many('SELECT user_name, action, entity, created_at FROM audit_log ORDER BY id DESC LIMIT 8');
    return { stats, activity, roles, recent };
  });

  // ---- Benutzer
  app.get('/admin/users', A('user:read'), async (req) => {
    const f = z.object({ q: z.string().max(100).optional(), status: z.string().optional() }).parse(req.query);
    const p = [];
    const w = ['u.deleted_at IS NULL'];
    if (f.q) { p.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`); w.push(`(u.name ILIKE $${p.length} OR u.email::text ILIKE $${p.length})`); }
    if (f.status) { p.push(f.status); w.push(`u.status=$${p.length}`); }
    if (req.dataScope === 'own') { p.push(req.user.id); w.push(`u.id=$${p.length}`); }
    if (req.dataScope === 'groups') {
      p.push(req.user.id);
      w.push(`(u.id=$${p.length} OR u.id IN (SELECT gm.user_id FROM group_members gm WHERE gm.group_id IN (SELECT group_id FROM group_members WHERE user_id=$${p.length})))`);
    }
    return many(
      `SELECT u.id, u.name, u.email, u.status, u.totp_enabled, u.last_login_at, u.created_at, u.expires_at, u.force_2fa, u.max_budgets,
         COALESCE((SELECT json_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id),'[]') roles,
         COALESCE((SELECT json_agg(g.name ORDER BY g.name) FROM group_members gm JOIN groups g ON g.id=gm.group_id WHERE gm.user_id=u.id),'[]') groups
       FROM users u WHERE ${w.join(' AND ')} ORDER BY u.name`,
      p,
    );
  });

  const userBody = z.object({
    name: z.string().min(1).max(100), email: z.string().email().max(200), password: z.string().optional(), role_ids: z.array(id).default([]),
    group_ids: z.array(id).default([]), expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), max_budgets: z.number().int().min(0).nullish(), invite: z.boolean().default(false),
  });

  app.post('/admin/users', A('user:create'), async (req) => {
    const b = userBody.parse(req.body);
    if (await one('SELECT 1 FROM users WHERE email=$1 AND deleted_at IS NULL', [b.email])) throw bad('E-Mail existiert bereits');
    if (b.invite) {
      const out = await createInvitation({ email: b.email, roleId: b.role_ids[0], invitedBy: req.user.id, log: req.log });
      await audit(req, 'user.invited', 'user', null, { email: b.email });
      return { invited: true, ...out };
    }
    if (!b.password) throw bad('Passwort oder Einladung erforderlich');
    await checkPassword(b.password);
    const hash = await hashPassword(b.password);
    const u = await tx(async (c) => {
      const r = (await c.query('INSERT INTO users(email,password_hash,name,expires_at,max_budgets) VALUES ($1,$2,$3,$4,$5) RETURNING id', [b.email, hash, b.name, b.expires_at || null, b.max_budgets ?? null])).rows[0];
      const roles = b.role_ids.length ? b.role_ids : (await c.query('SELECT id FROM roles WHERE is_default')).rows.map((x) => x.id);
      for (const rid of roles) await c.query('INSERT INTO user_roles VALUES ($1,$2)', [r.id, rid]);
      for (const gid of b.group_ids) await c.query('INSERT INTO group_members(group_id,user_id) VALUES ($1,$2)', [gid, r.id]);
      return r;
    });
    await audit(req, 'user.created', 'user', u.id);
    return { id: u.id };
  });

  async function lastAdminGuard(userId, c = { query: q }) {
    const r = await c.query(
      `SELECT count(DISTINCT u.id)::int n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
       WHERE r.name='Admin' AND u.status='active' AND u.deleted_at IS NULL AND u.id<>$1`,
      [userId],
    );
    if (r.rows[0].n < 1) throw bad('Der letzte aktive Administrator kann nicht geändert werden');
  }
  const isAdmin = async (uid) => !!(await one("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.name='Admin'", [uid]));

  app.patch('/admin/users/:id', A('user:update'), async (req) => {
    const u = await one('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!u) throw notFound();
    const b = userBody.partial().extend({ status: z.enum(['active', 'locked', 'disabled']).optional(), force_2fa: z.boolean().optional() }).parse(req.body);
    if (((b.status && b.status !== 'active') || b.expires_at) && (await isAdmin(u.id))) await lastAdminGuard(u.id);
    await tx(async (c) => {
      for (const k of ['name', 'email', 'status', 'expires_at', 'max_budgets', 'force_2fa']) {
        if (k in b) await c.query(`UPDATE users SET ${k}=$2, updated_at=now() WHERE id=$1`, [u.id, b[k] ?? null]);
      }
      if (b.status === 'active') await c.query('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1', [u.id]);
      if (b.status && b.status !== 'active') await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
      if (b.role_ids) {
        const wasAdmin = (await c.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.name='Admin'", [u.id])).rowCount > 0;
        const willAdmin = b.role_ids.length ? (await c.query("SELECT 1 FROM roles WHERE id = ANY($1) AND name='Admin'", [b.role_ids])).rowCount > 0 : false;
        if (wasAdmin && !willAdmin) await lastAdminGuard(u.id, c);
        await c.query('DELETE FROM user_roles WHERE user_id=$1', [u.id]);
        for (const rid of b.role_ids) await c.query('INSERT INTO user_roles VALUES ($1,$2)', [u.id, rid]);
      }
      if (b.group_ids) {
        await c.query('DELETE FROM group_members WHERE user_id=$1', [u.id]);
        for (const gid of b.group_ids) await c.query('INSERT INTO group_members(group_id,user_id) VALUES ($1,$2)', [gid, u.id]);
      }
      if (b.password) {
        await checkPassword(b.password);
        await c.query('UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1', [u.id, await hashPassword(b.password)]);
        await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
      }
    });
    invalidatePermCache();
    await audit(req, 'user.updated', 'user', u.id, { fields: Object.keys(b).filter((k) => k !== 'password') });
    return { ok: true };
  });

  app.post('/admin/users/:id/reset-2fa', A('user:update'), async (req) => {
    await q('UPDATE users SET totp_enabled=false, totp_secret_enc=NULL WHERE id=$1', [req.params.id]);
    await q('DELETE FROM recovery_codes WHERE user_id=$1', [req.params.id]);
    await audit(req, 'user.2fa_reset', 'user', req.params.id);
    return { ok: true };
  });
  app.post('/admin/users/:id/revoke-sessions', A('user:update'), async (req) => {
    await q('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [req.params.id]);
    await audit(req, 'user.sessions_revoked', 'user', req.params.id);
    return { ok: true };
  });

  app.delete('/admin/users/:id', A('user:delete'), async (req) => {
    if (req.params.id === req.user.id) throw bad('Du kannst dich nicht selbst löschen');
    if (await isAdmin(req.params.id)) await lastAdminGuard(req.params.id);
    await tx(async (c) => {
      await c.query("UPDATE users SET deleted_at=now(), status='disabled', email=$2 WHERE id=$1", [req.params.id, `deleted-${req.params.id}@invalid`]);
      await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [req.params.id]);
      await c.query('UPDATE api_keys SET revoked_at=now() WHERE created_by=$1', [req.params.id]);
    });
    await audit(req, 'user.deleted', 'user', req.params.id);
    return { ok: true };
  });

  app.get('/admin/users/export.csv', A('user:export'), async (req, reply) => {
    const rows = await many(`SELECT name, email, status, totp_enabled, last_login_at, created_at FROM users WHERE deleted_at IS NULL ORDER BY name`);
    await audit(req, 'users.exported', 'user');
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="benutzer.csv"');
    return toCsv(rows, ['name', 'email', 'status', 'totp_enabled', 'last_login_at', 'created_at']);
  });

  // ---- Rollen
  app.get('/admin/roles', A('role:read'), async () => ({
    catalog: PERMISSION_CATALOG,
    roles: await many(
      `SELECT r.*, COALESCE((SELECT json_agg(p.key) FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id),'[]') permissions,
         (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id=r.id) users FROM roles r ORDER BY r.is_system DESC, r.name`,
    ),
  }));
  const roleBody = z.object({
    name: z.string().min(1).max(60), description: z.string().max(300).default(''), data_scope: z.enum(['all', 'groups', 'own']).default('all'),
    max_budgets: z.number().int().min(0).nullish(), is_default: z.boolean().default(false), permissions: z.array(z.string()).default([]),
  });
  async function writeRole(c, rid, b) {
    await c.query('DELETE FROM role_permissions WHERE role_id=$1', [rid]);
    await c.query("INSERT INTO role_permissions SELECT $1, id FROM permissions WHERE key = ANY($2) AND key <> 'admin:access'", [rid, b.permissions]);
  }
  app.post('/admin/roles', A('role:create'), async (req) => {
    const b = roleBody.parse(req.body);
    try {
      const r = await tx(async (c) => {
        if (b.is_default) await c.query('UPDATE roles SET is_default=false');
        const row = (await c.query('INSERT INTO roles(name,description,data_scope,max_budgets,is_default) VALUES ($1,$2,$3,$4,$5) RETURNING id', [b.name, b.description, b.data_scope, b.max_budgets ?? null, b.is_default])).rows[0];
        await writeRole(c, row.id, b);
        return row;
      });
      await audit(req, 'role.created', 'role', r.id);
      return r;
    } catch (e) {
      if (e.code === '23505') throw bad('Rolle existiert bereits');
      throw e;
    }
  });
  app.put('/admin/roles/:id', A('role:update'), async (req) => {
    const r = await one('SELECT * FROM roles WHERE id=$1', [req.params.id]);
    if (!r) throw notFound();
    if (r.is_system) throw forbidden('Systemrollen sind unveränderlich');
    const b = roleBody.parse(req.body);
    await tx(async (c) => {
      if (b.is_default) await c.query('UPDATE roles SET is_default=false');
      await c.query('UPDATE roles SET name=$2, description=$3, data_scope=$4, max_budgets=$5, is_default=$6 WHERE id=$1', [r.id, b.name, b.description, b.data_scope, b.max_budgets ?? null, b.is_default]);
      await writeRole(c, r.id, b);
    });
    invalidatePermCache();
    await audit(req, 'role.updated', 'role', r.id);
    return { ok: true };
  });
  app.delete('/admin/roles/:id', A('role:delete'), async (req) => {
    const r = await one('SELECT * FROM roles WHERE id=$1', [req.params.id]);
    if (!r) throw notFound();
    if (r.is_system) throw forbidden('Systemrollen können nicht gelöscht werden');
    await q('DELETE FROM roles WHERE id=$1', [r.id]);
    invalidatePermCache();
    await audit(req, 'role.deleted', 'role', r.id);
    return { ok: true };
  });

  // ---- Gruppen
  app.get('/admin/groups', A('group:read'), async () =>
    many(
      `SELECT g.*, COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'leader', gm.is_leader)) FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=g.id),'[]') members,
         COALESCE((SELECT json_agg(r.id) FROM group_roles gr JOIN roles r ON r.id=gr.role_id WHERE gr.group_id=g.id),'[]') role_ids FROM groups g ORDER BY g.name`,
    ));
  const groupBody = z.object({ name: z.string().min(1).max(80), description: z.string().max(300).default(''), auto_domain: z.string().max(100).nullish(), leader_can_manage: z.boolean().default(false), role_ids: z.array(id).default([]), member_ids: z.array(id).optional() });
  async function writeGroup(c, gid, b) {
    await c.query('DELETE FROM group_roles WHERE group_id=$1', [gid]);
    for (const r of b.role_ids) await c.query('INSERT INTO group_roles VALUES ($1,$2)', [gid, r]);
    if (b.member_ids) {
      await c.query('DELETE FROM group_members WHERE group_id=$1', [gid]);
      for (const u of b.member_ids) await c.query('INSERT INTO group_members(group_id,user_id) VALUES ($1,$2)', [gid, u]);
    }
  }
  app.post('/admin/groups', A('group:create'), async (req) => {
    const b = groupBody.parse(req.body);
    try {
      const g = await tx(async (c) => {
        const r = (await c.query('INSERT INTO groups(name,description,auto_domain,leader_can_manage) VALUES ($1,$2,$3,$4) RETURNING id', [b.name, b.description, b.auto_domain || null, b.leader_can_manage])).rows[0];
        await writeGroup(c, r.id, b);
        return r;
      });
      invalidatePermCache();
      return g;
    } catch (e) {
      if (e.code === '23505') throw bad('Gruppe existiert bereits');
      throw e;
    }
  });
  app.put('/admin/groups/:id', A('group:update'), async (req) => {
    const b = groupBody.parse(req.body);
    await tx(async (c) => {
      await c.query('UPDATE groups SET name=$2, description=$3, auto_domain=$4, leader_can_manage=$5 WHERE id=$1', [req.params.id, b.name, b.description, b.auto_domain || null, b.leader_can_manage]);
      await writeGroup(c, req.params.id, b);
    });
    invalidatePermCache();
    return { ok: true };
  });
  app.delete('/admin/groups/:id', A('group:delete'), async (req) => {
    await q('DELETE FROM groups WHERE id=$1', [req.params.id]);
    invalidatePermCache();
    return { ok: true };
  });

  // ---- Teams (Admin-Sicht)
  app.get('/admin/teams', A('team:read'), async () =>
    many(`SELECT t.id, t.name, t.status, u.name owner, (SELECT count(*)::int FROM team_members tm WHERE tm.team_id=t.id) members, (SELECT count(*)::int FROM budgets b WHERE b.team_id=t.id) budgets FROM teams t JOIN users u ON u.id=t.owner_id ORDER BY t.name`));

  // ---- Einstellungen
  app.get('/admin/settings', A('settings:read'), async () => ({
    values: await allSettings(),
    env: { smtp_configured: mailConfigured(), smtp_host: config.smtp.host, app_url: config.appUrl, hibp: config.hibpCheck, backup_encrypt: config.backupEncrypt, backup_retention_days: config.backupRetentionDays },
  }));
  app.put('/admin/settings', A('settings:update'), async (req) => {
    const b = z.record(z.union([z.string().max(500), z.number(), z.boolean()])).parse(req.body);
    const allowlist = b['security.admin_ip_allowlist'];
    if (typeof allowlist === 'string' && !ipAllowed(req.ip, allowlist)) throw bad(`Admin-IP-Allowlist muss deine aktuelle IP (${req.ip}) enthalten, sonst sperrst du dich aus`);
    await setSettings(b);
    await audit(req, 'settings.updated', 'settings', null, { keys: Object.keys(b).filter((k) => k in DEFAULTS) });
    return { ok: true };
  });
  app.post('/admin/settings/test-mail', A('settings:update'), async (req) => {
    try {
      await verifyMail();
      return { ok: true };
    } catch (e) {
      throw bad(`SMTP-Test fehlgeschlagen: ${e.message}`);
    }
  });

  // ---- Audit
  const auditQuery = async (req) => {
    const f = z.object({ q: z.string().max(100).optional(), action: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(1000).default(100), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const p = [];
    const w = ['true'];
    if (f.q) { p.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`); w.push(`(user_name ILIKE $${p.length} OR action ILIKE $${p.length} OR entity ILIKE $${p.length})`); }
    if (f.action) { p.push(`${f.action}%`); w.push(`action ILIKE $${p.length}`); }
    return many(`SELECT id, user_name, action, entity, entity_id, ip, details, created_at FROM audit_log WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ${f.limit} OFFSET ${f.offset}`, p);
  };
  app.get('/admin/audit', A('audit:read'), async (req) => auditQuery(req));
  app.get('/admin/audit/export.csv', A('audit:export'), async (req, reply) => {
    const rows = (await auditQuery({ query: { ...req.query, limit: 1000 } })).map((r) => ({ ...r, details: r.details ? JSON.stringify(r.details) : '' }));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="audit.csv"');
    return toCsv(rows, ['created_at', 'user_name', 'action', 'entity', 'entity_id', 'ip', 'details']);
  });

  // ---- System / Jobs
  app.get('/admin/system', A('settings:read'), async () => {
    const db = await one("SELECT version() v, pg_database_size(current_database()) size");
    return {
      version: process.env.APP_VERSION || '1.0.0', node: process.version, uptime_s: Math.round(process.uptime()), db_version: db.v.split(' ').slice(0, 2).join(' '), db_size: Number(db.size),
      jobs: await jobStatus(), memory_mb: Math.round(process.memoryUsage().rss / 1048576),
    };
  });

  // ---- Backups
  app.get('/admin/backups', A('backup:read'), async () => many('SELECT id, filename, size, status, error, created_at FROM backups ORDER BY created_at DESC LIMIT 100'));
  app.post('/admin/backups', A('backup:create'), async (req) => {
    const r = await runBackup(req.user.id, req.log);
    await audit(req, 'backup.created', 'backup', r.id);
    return r;
  });
  app.get('/admin/backups/:id/download', A('backup:read'), async (req, reply) => {
    const b = await one("SELECT * FROM backups WHERE id=$1 AND status='ok'", [req.params.id]);
    if (!b) throw notFound();
    const file = path.join(config.backupDir, path.basename(b.filename));
    if (!fs.existsSync(file)) throw notFound('Datei fehlt');
    await audit(req, 'backup.downloaded', 'backup', b.id);
    reply.header('content-disposition', `attachment; filename="${b.filename}"`).header('content-type', 'application/octet-stream');
    return fs.createReadStream(file);
  });
  app.delete('/admin/backups/:id', A('backup:delete'), async (req) => {
    const b = await one('SELECT * FROM backups WHERE id=$1', [req.params.id]);
    if (!b) throw notFound();
    fs.rmSync(path.join(config.backupDir, path.basename(b.filename)), { force: true });
    await q('DELETE FROM backups WHERE id=$1', [b.id]);
    await audit(req, 'backup.deleted', 'backup', b.id);
    return { ok: true };
  });

  // ---- Webhooks & API-Schlüssel (global)
  app.get('/admin/webhooks', A('settings:read'), async () => many('SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at'));
  app.post('/admin/webhooks', A('settings:update'), async (req) => {
    const b = z.object({ url: z.string().url().refine((u) => /^https?:\/\//.test(u)), events: z.array(z.enum(['budget_80', 'budget_exceeded'])).min(1) }).parse(req.body);
    const secret = randomToken(24);
    const r = await one('INSERT INTO webhooks(url,events,secret_enc) VALUES ($1,$2,$3) RETURNING id', [b.url, b.events, encrypt(secret)]);
    await audit(req, 'webhook.created', 'webhook', r.id);
    return { id: r.id, secret };
  });
  app.delete('/admin/webhooks/:id', A('settings:update'), async (req) => {
    await q('DELETE FROM webhooks WHERE id=$1', [req.params.id]);
    return { ok: true };
  });
  app.get('/admin/api-keys', A('apikey:read'), async () =>
    many('SELECT k.id, k.name, k.prefix, k.scope, k.last_used_at, k.created_at, u.name owner FROM api_keys k JOIN users u ON u.id=k.created_by WHERE k.revoked_at IS NULL ORDER BY k.created_at DESC'));
  app.delete('/admin/api-keys/:id', A('apikey:delete'), async (req) => {
    await q('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [req.params.id]);
    await audit(req, 'apikey.revoked', 'api_key', req.params.id);
    return { ok: true };
  });
}
