import { z } from 'zod';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, many, q, tx } from '../db.js';
import { requireAuth, authz, bad, notFound, need, invalidatePermCache } from '../authz.js';
import {
  verifyPassword, hashPassword, newTotpSecret, totpUri, totpValid, encrypt, decrypt, newRecoveryCodes, sha256, randomToken,
} from '../security.js';
import { checkPassword } from './auth.js';
import { getSetting } from '../settings.js';
import { audit } from '../audit.js';

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, locale: u.locale, currency: u.currency, timezone: u.timezone, week_start: u.week_start,
  theme: u.theme, accent: u.accent, gravatar_enabled: u.gravatar_enabled, totp_enabled: u.totp_enabled,
  has_ical: !!u.ical_token, last_login_at: u.last_login_at,
});

export default async function routes(app) {
  app.get('/me', requireAuth, async (req) => {
    const force = (await getSetting('security.force_2fa')) === true;
    return { user: publicUser(req.user), permissions: [...req.perms], roles: req.userRoles.map((r) => r.name), mfa_setup_required: force && !req.user.totp_enabled };
  });

  app.patch('/me', requireAuth, async (req) => {
    const b = z.object({
      name: z.string().min(1).max(100).optional(),
      locale: z.enum(['de', 'en']).optional(),
      currency: z.string().length(3).optional(),
      timezone: z.string().max(60).optional(),
      week_start: z.number().int().min(0).max(1).optional(),
      theme: z.enum(['system', 'light', 'dark']).optional(),
      accent: z.enum(['indigo', 'emerald', 'ocean', 'rose', 'amber', 'mono']).optional(),
      gravatar_enabled: z.boolean().optional(),
    }).parse(req.body);
    const keys = Object.keys(b);
    if (keys.length) {
      await q(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [req.user.id, ...keys.map((k) => b[k])]);
    }
    return publicUser(await one('SELECT * FROM users WHERE id=$1', [req.user.id]));
  });

  app.post('/me/password', requireAuth, async (req, reply) => {
    const { current, password } = z.object({ current: z.string(), password: z.string() }).parse(req.body);
    if (!(await verifyPassword(req.user.password_hash, current))) throw bad('Aktuelles Passwort ist falsch', 'wrong_password');
    await checkPassword(password);
    const hash = await hashPassword(password);
    await q('UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1', [req.user.id, hash]);
    await q('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL', [req.user.id, req.sessionId]);
    await audit(req, 'password.changed', 'user', req.user.id);
    return { ok: true };
  });

  app.get('/me/sessions', requireAuth, async (req) =>
    (await many('SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY last_seen_at DESC', [req.user.id]))
      .map((s) => ({ ...s, current: s.id === req.sessionId })));

  app.delete('/me/sessions/:id', requireAuth, async (req) => {
    await q('UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    return { ok: true };
  });
  app.delete('/me/sessions', requireAuth, async (req) => {
    await q('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL', [req.user.id, req.sessionId]);
    return { ok: true };
  });

  // 2FA
  app.post('/me/2fa/setup', requireAuth, async (req) => {
    if (req.user.totp_enabled) throw bad('2FA ist bereits aktiv');
    const secret = newTotpSecret();
    await q('UPDATE users SET totp_secret_enc=$2 WHERE id=$1', [req.user.id, encrypt(secret)]);
    const uri = totpUri(req.user.email, secret);
    return { secret, uri, qr_svg: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 200 }) };
  });
  app.post('/me/2fa/enable', requireAuth, async (req) => {
    const { code } = z.object({ code: z.string().min(6).max(10) }).parse(req.body);
    if (!req.user.totp_secret_enc) throw bad('Zuerst Einrichtung starten');
    if (!totpValid(decrypt(req.user.totp_secret_enc), code)) throw bad('Code ungültig', 'invalid_code');
    const codes = newRecoveryCodes();
    await tx(async (c) => {
      await c.query('UPDATE users SET totp_enabled=true WHERE id=$1', [req.user.id]);
      await c.query('DELETE FROM recovery_codes WHERE user_id=$1', [req.user.id]);
      for (const k of codes) await c.query('INSERT INTO recovery_codes(user_id, code_hash) VALUES ($1,$2)', [req.user.id, sha256(k)]);
    });
    await audit(req, '2fa.enabled', 'user', req.user.id);
    return { recovery_codes: codes };
  });
  app.post('/me/2fa/disable', requireAuth, async (req) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (!(await verifyPassword(req.user.password_hash, password))) throw bad('Passwort ist falsch', 'wrong_password');
    if (await getSetting('security.force_2fa')) throw bad('2FA ist für alle Konten verpflichtend');
    await q('UPDATE users SET totp_enabled=false, totp_secret_enc=NULL WHERE id=$1', [req.user.id]);
    await q('DELETE FROM recovery_codes WHERE user_id=$1', [req.user.id]);
    await audit(req, '2fa.disabled', 'user', req.user.id);
    return { ok: true };
  });
  app.post('/me/2fa/recovery', requireAuth, async (req) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (!req.user.totp_enabled) throw bad('2FA ist nicht aktiv');
    if (!(await verifyPassword(req.user.password_hash, password))) throw bad('Passwort ist falsch', 'wrong_password');
    const codes = newRecoveryCodes();
    await tx(async (c) => {
      await c.query('DELETE FROM recovery_codes WHERE user_id=$1', [req.user.id]);
      for (const k of codes) await c.query('INSERT INTO recovery_codes(user_id, code_hash) VALUES ($1,$2)', [req.user.id, sha256(k)]);
    });
    return { recovery_codes: codes };
  });

  // Benachrichtigungen
  app.get('/notifications', requireAuth, async (req) => ({
    items: await many('SELECT id, kind, title, body, read_at, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]),
    unread: (await one('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id])).n,
  }));
  app.post('/notifications/read', requireAuth, async (req) => {
    await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
    return { ok: true };
  });
  app.get('/me/notification-prefs', requireAuth, async (req) => many('SELECT kind, in_app, email FROM notification_prefs WHERE user_id=$1', [req.user.id]));
  app.put('/me/notification-prefs', requireAuth, async (req) => {
    const list = z.array(z.object({ kind: z.string().max(40), in_app: z.boolean(), email: z.boolean() })).parse(req.body);
    for (const p of list) {
      await q('INSERT INTO notification_prefs VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, kind) DO UPDATE SET in_app=$3, email=$4', [req.user.id, p.kind, p.in_app, p.email]);
    }
    return { ok: true };
  });

  // iCal-Abo
  app.post('/me/ical', requireAuth, async (req) => {
    const t = randomToken(24);
    await q('UPDATE users SET ical_token=$2 WHERE id=$1', [req.user.id, t]);
    return { url: `${config.appUrl}/api/calendar/ical/${t}.ics` };
  });
  app.delete('/me/ical', requireAuth, async (req) => {
    await q('UPDATE users SET ical_token=NULL WHERE id=$1', [req.user.id]);
    return { ok: true };
  });

  // API-Schlüssel
  app.get('/me/api-keys', authz('apikey:read'), async (req) =>
    many('SELECT id, name, prefix, scope, last_used_at, created_at FROM api_keys WHERE created_by=$1 AND revoked_at IS NULL ORDER BY created_at DESC', [req.user.id]));
  app.post('/me/api-keys', authz('apikey:create'), async (req) => {
    const { name, scope } = z.object({ name: z.string().min(1).max(80), scope: z.enum(['read', 'write']) }).parse(req.body);
    const token = `bm_live_${crypto.randomBytes(24).toString('base64url')}`;
    const prefix = token.slice(0, 16);
    await q('INSERT INTO api_keys(name, prefix, key_hash, scope, created_by) VALUES ($1,$2,$3,$4,$5)', [name, prefix, sha256(token), scope, req.user.id]);
    await audit(req, 'apikey.created', 'api_key', prefix);
    return { token, prefix };
  });
  app.delete('/me/api-keys/:id', authz('apikey:delete'), async (req) => {
    const r = await one('UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND created_by=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!r) throw notFound();
    return { ok: true };
  });

  // Nutzersuche für Einladungen/Teams (nur E-Mail-Vorschläge im eigenen Team-Kontext)
  app.get('/me/export', requireAuth, async (req) => {
    const u = publicUser(req.user);
    const budgets = await many(
      `SELECT * FROM budgets WHERE owner_user_id=$1`, [req.user.id]);
    const transactions = await many(
      `SELECT t.* FROM transactions t JOIN budgets b ON b.id=t.budget_id WHERE b.owner_user_id=$1 ORDER BY booked_at`, [req.user.id]);
    const work_entries = await many('SELECT * FROM work_entries WHERE user_id=$1 ORDER BY work_date', [req.user.id]);
    return { exported_at: new Date().toISOString(), user: u, budgets, transactions, work_entries };
  });
}

export { need, invalidatePermCache };
