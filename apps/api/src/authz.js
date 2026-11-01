import { one, many, q } from './db.js';
import { verifyJwt, sha256 } from './security.js';
import { getSetting } from './settings.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (m, code) => new HttpError(400, m, code);
export const forbidden = (m = 'Keine Berechtigung') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Nicht gefunden') => new HttpError(404, m, 'not_found');

const R = ['read', 'create', 'update', 'delete'];
export const PERMISSION_CATALOG = [
  { resource: 'user', label: 'Benutzer', actions: [...R, 'export'] },
  { resource: 'role', label: 'Rollen', actions: R },
  { resource: 'group', label: 'Gruppen', actions: R },
  { resource: 'team', label: 'Teams', actions: R },
  { resource: 'budget', label: 'Budgets', actions: [...R, 'export'] },
  { resource: 'transaction', label: 'Transaktionen', actions: [...R, 'export'] },
  { resource: 'recurring', label: 'Daueraufträge', actions: R },
  { resource: 'goal', label: 'Sparziele', actions: R },
  { resource: 'report', label: 'Berichte', actions: ['read', 'create', 'export'] },
  { resource: 'calendar', label: 'Kalender', actions: R },
  { resource: 'person', label: 'Personen', actions: R },
  { resource: 'property', label: 'Häuser', actions: R },
  { resource: 'vehicle', label: 'Fahrzeuge', actions: R },
  { resource: 'key', label: 'Schlüssel', actions: [...R, 'assign'] },
  { resource: 'apikey', label: 'API-Schlüssel', actions: ['read', 'create', 'delete'] },
  { resource: 'audit', label: 'Audit-Log', actions: ['read', 'export'] },
  { resource: 'settings', label: 'Einstellungen', actions: ['read', 'update'] },
  { resource: 'backup', label: 'Backups', actions: ['read', 'create', 'delete'] },
];
export const ALL_PERMISSIONS = [...PERMISSION_CATALOG.flatMap((c) => c.actions.map((a) => `${c.resource}:${a}`)), 'admin:access'];

const ADMIN_ONLY = /^(admin|user|role|group|audit|settings|backup):/;
export const USER_ROLE_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !ADMIN_ONLY.test(p));

const permCache = new Map();
export function invalidatePermCache(userId) {
  if (userId) permCache.delete(userId);
  else permCache.clear();
}

export async function loadAccess(userId) {
  const hit = permCache.get(userId);
  if (hit && Date.now() - hit.at < 15000) return hit.v;
  const rows = await many(
    `SELECT DISTINCT p.key FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
     WHERE rp.role_id IN (SELECT role_id FROM user_roles WHERE user_id=$1
       UNION SELECT gr.role_id FROM group_roles gr JOIN group_members gm ON gm.group_id=gr.group_id WHERE gm.user_id=$1)`,
    [userId],
  );
  const roles = await many(
    `SELECT DISTINCT r.id, r.name, r.data_scope, r.max_budgets FROM roles r
     WHERE r.id IN (SELECT role_id FROM user_roles WHERE user_id=$1
       UNION SELECT gr.role_id FROM group_roles gr JOIN group_members gm ON gm.group_id=gr.group_id WHERE gm.user_id=$1)`,
    [userId],
  );
  const scopeRank = { own: 0, groups: 1, all: 2 };
  const dataScope = roles.reduce((a, r) => (scopeRank[r.data_scope] > scopeRank[a] ? r.data_scope : a), 'own');
  const v = { perms: new Set(rows.map((r) => r.key)), roles, dataScope };
  permCache.set(userId, { at: Date.now(), v });
  return v;
}

function ipAllowed(ip, list) {
  const items = list.split(/[\s,]+/).filter(Boolean);
  if (!items.length) return true;
  return items.some((i) => i === ip || (i.endsWith('.*') && ip.startsWith(i.slice(0, -1))) || ip === `::ffff:${i}`);
}

export async function authenticate(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Nicht angemeldet', 'unauthenticated');
  const token = h.slice(7);
  let userRow;
  if (token.startsWith('bm_live_')) {
    const prefix = token.slice(0, 16);
    const k = await one('SELECT * FROM api_keys WHERE prefix=$1 AND revoked_at IS NULL', [prefix]);
    if (!k || k.key_hash !== sha256(token)) throw new HttpError(401, 'API-Schlüssel ungültig', 'unauthenticated');
    if (k.scope === 'read' && !['GET', 'HEAD'].includes(req.method)) throw forbidden('API-Schlüssel ist nur lesend');
    q('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [k.id]).catch(() => {});
    userRow = await one("SELECT * FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL", [k.created_by]);
    req.viaApiKey = true;
  } else {
    let p;
    try {
      p = verifyJwt(token, 'access');
    } catch {
      throw new HttpError(401, 'Sitzung abgelaufen', 'token_expired');
    }
    const s = await one('SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()', [p.sid, p.sub]);
    if (!s) throw new HttpError(401, 'Sitzung beendet', 'session_revoked');
    userRow = await one("SELECT * FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL", [p.sub]);
    req.sessionId = p.sid;
  }
  if (!userRow) throw new HttpError(401, 'Benutzer nicht aktiv', 'unauthenticated');
  const acc = await loadAccess(userRow.id);
  req.user = userRow;
  req.perms = acc.perms;
  req.dataScope = acc.dataScope;
  req.userRoles = acc.roles;

  if ((await getSetting('general.maintenance')) && !acc.perms.has('admin:access') && !['GET', 'HEAD'].includes(req.method)) {
    throw new HttpError(503, await getSetting('general.maintenance_message'), 'maintenance');
  }
}

export const requireAuth = { preHandler: async (req) => authenticate(req) };

export function can(req, perm) {
  return req.perms.has(perm);
}
export function need(req, perm) {
  if (!req.perms.has(perm)) throw forbidden();
}

export function authz(...perms) {
  return {
    preHandler: async (req) => {
      await authenticate(req);
      for (const p of perms) need(req, p);
      if (perms.some((p) => p.startsWith('admin:') || false)) {
        const list = await getSetting('security.admin_ip_allowlist');
        if (!ipAllowed(req.ip, list)) throw forbidden('IP nicht für Admin-Zugriff freigegeben');
      }
    },
  };
}

export function adminOnly(...perms) {
  return {
    preHandler: async (req) => {
      await authenticate(req);
      need(req, 'admin:access');
      for (const p of perms) need(req, p);
      const list = await getSetting('security.admin_ip_allowlist');
      if (!ipAllowed(req.ip, list)) throw forbidden('IP nicht für Admin-Zugriff freigegeben');
    },
  };
}

// Zugriff auf ein Budget: owner (solo) | owner/editor/viewer (Team)
export async function budgetAccess(userId, budgetId, write = false) {
  const b = await one(
    `SELECT b.*, tm.team_role FROM budgets b LEFT JOIN team_members tm ON tm.team_id=b.team_id AND tm.user_id=$2 WHERE b.id=$1`,
    [budgetId, userId],
  );
  if (!b) throw notFound('Budget nicht gefunden');
  const role = b.type === 'solo' ? (b.owner_user_id === userId ? 'owner' : null) : b.team_role;
  if (!role) throw notFound('Budget nicht gefunden');
  if (write && role === 'viewer') throw forbidden('Nur Leserechte auf diesem Budget');
  if (write && b.archived) throw bad('Budget ist archiviert');
  return { budget: b, role };
}

export const accessibleBudgetIds = async (userId) =>
  (
    await many(
      `SELECT b.id FROM budgets b WHERE (b.type='solo' AND b.owner_user_id=$1)
       OR (b.type='shared' AND b.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1))`,
      [userId],
    )
  ).map((r) => r.id);
