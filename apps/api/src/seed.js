import { one, q, tx } from './db.js';
import { config } from './config.js';
import { hashPassword, passwordProblem } from './security.js';
import { ALL_PERMISSIONS, USER_ROLE_PERMISSIONS } from './authz.js';

async function syncRole(c, name, description, perms, isDefault) {
  let r = (await c.query('SELECT id FROM roles WHERE name=$1', [name])).rows[0];
  if (!r) {
    r = (await c.query('INSERT INTO roles(name, description, is_system, is_default) VALUES ($1,$2,true,$3) RETURNING id', [name, description, isDefault])).rows[0];
  }
  await c.query('DELETE FROM role_permissions WHERE role_id=$1', [r.id]);
  await c.query(
    'INSERT INTO role_permissions(role_id, permission_id) SELECT $1, id FROM permissions WHERE key = ANY($2)',
    [r.id, perms],
  );
  return r.id;
}

export async function seed(log) {
  await tx(async (c) => {
    for (const p of ALL_PERMISSIONS) await c.query('INSERT INTO permissions(key) VALUES ($1) ON CONFLICT DO NOTHING', [p]);
    await syncRole(c, 'Admin', 'Voller Zugriff auf alle Funktionen', ALL_PERMISSIONS, false);
    await syncRole(c, 'User', 'Standardrolle: eigene Konten, Teams, Kalender, Objekte', USER_ROLE_PERMISSIONS, true);
  });

  const { email, password, name } = config.admin;
  const existing = await one("SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.name='Admin' LIMIT 1");
  if (existing) return;
  if (!email || !password) {
    log.warn('Kein Admin vorhanden und ADMIN_EMAIL/ADMIN_PASSWORD nicht gesetzt – kein Login möglich!');
    return;
  }
  const problem = passwordProblem(password);
  if (problem) throw new Error(`ADMIN_PASSWORD ungültig: ${problem}`);
  const hash = await hashPassword(password);
  await tx(async (c) => {
    const u = (
      await c.query(
        `INSERT INTO users(email, password_hash, name) VALUES ($1,$2,$3)
         ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, status='active', deleted_at=NULL RETURNING id`,
        [email, hash, name],
      )
    ).rows[0];
    await c.query("INSERT INTO user_roles SELECT $1, id FROM roles WHERE name IN ('Admin','User') ON CONFLICT DO NOTHING", [u.id]);
  });
  log.info(`Initialer Administrator ${email} angelegt`);
}

export const DEFAULT_CATEGORIES = [
  ['Wohnen', '#6366f1'], ['Lebensmittel', '#10b981'], ['Mobilität', '#0ea5e9'], ['Freizeit', '#f59e0b'],
  ['Versicherung', '#8b5cf6'], ['Gesundheit', '#ef4444'], ['Einkommen', '#14b8a6'], ['Sonstiges', '#64748b'],
];
export async function addDefaultCategories(c, budgetId) {
  for (const [n, col] of DEFAULT_CATEGORIES) {
    await c.query('INSERT INTO categories(budget_id, name, color) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [budgetId, n, col]);
  }
}
export { q };
