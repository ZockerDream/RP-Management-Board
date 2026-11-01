import { q } from './db.js';

export async function audit(req, action, entity, entityId, details) {
  try {
    await q('INSERT INTO audit_log(user_id, user_name, action, entity, entity_id, ip, details) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      req?.user?.id || null,
      req?.user?.name || req?.user?.email || null,
      action,
      entity || null,
      entityId ? String(entityId) : null,
      req?.ip || null,
      details ? JSON.stringify(details) : null,
    ]);
  } catch (e) {
    req?.log?.error({ err: e }, 'audit failed');
  }
}
