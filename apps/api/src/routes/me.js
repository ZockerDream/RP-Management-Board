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
import { payrollRun } from '../jobs.js';
import { currentCaseFeatures, currentModules } from '../feature-guard.js';
import { uiPrefsSchema, normalizeUiPrefs, UI_VERSIONS } from '../ui-prefs.js';
import { receiveUpload, uploadPath, removeUpload } from '../uploads.js';
import fs from 'node:fs';

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, locale: u.locale, currency: u.currency, timezone: u.timezone, week_start: u.week_start,
  weekly_work_hours: u.weekly_work_hours, daily_salary: u.daily_salary, hourly_bonus_percent: u.hourly_bonus_percent,
  payroll_budget_id: u.payroll_budget_id,
  theme: u.theme, accent: u.accent, gravatar_enabled: u.gravatar_enabled, totp_enabled: u.totp_enabled,
  has_ical: !!u.ical_token, last_login_at: u.last_login_at,
  ui_version: u.ui_version, ui_choice_seen: u.ui_choice_seen, ui_prefs: normalizeUiPrefs(u.ui_prefs), has_background: !!u.background_key, background_updated_at: u.background_updated_at,
});

export default async function routes(app) {
  app.get('/me', requireAuth, async (req) => {
    const force = (await getSetting('security.force_2fa')) === true;
    return {
      user: publicUser(req.user), permissions: [...req.perms], roles: req.userRoles.map((r) => r.name), mfa_setup_required: force && !req.user.totp_enabled,
      features: { casefiles: await currentCaseFeatures(), modules: await currentModules() },
    };
  });

  app.patch('/me', requireAuth, async (req) => {
    const b = z.object({
      name: z.string().min(1).max(100).optional(),
      locale: z.enum(['de', 'en']).optional(),
      currency: z.string().length(3).optional(),
      timezone: z.string().max(60).optional(),
      week_start: z.number().int().min(0).max(1).optional(),
      weekly_work_hours: z.number().min(1).max(168).multipleOf(0.25).optional(),
      daily_salary: z.number().min(0).max(9999999999.99).multipleOf(0.01).optional(),
      hourly_bonus_percent: z.number().min(0).max(1000).multipleOf(0.01).optional(),
      payroll_budget_id: z.string().uuid().nullish(),
      theme: z.enum(['system', 'light', 'dark']).optional(),
      accent: z.enum(['indigo', 'emerald', 'ocean', 'rose', 'amber', 'mono']).optional(),
      gravatar_enabled: z.boolean().optional(),
      ui_version: z.enum(UI_VERSIONS).optional(),
      ui_choice_seen: z.literal(true).optional(),
      ui_prefs: uiPrefsSchema.optional(),
    }).parse(req.body);
    if (b.payroll_budget_id) {
      const budget = await one(
        "SELECT id FROM budgets WHERE id=$1 AND owner_user_id=$2 AND type='solo' AND archived=false AND currency=$3",
        [b.payroll_budget_id, req.user.id, b.currency || req.user.currency],
      );
      if (!budget) throw bad('Wähle ein aktives eigenes Konto mit derselben Währung für die Gehaltsbuchung');
    } else if (!('payroll_budget_id' in b) && req.user.payroll_budget_id && b.currency && b.currency !== req.user.currency) {
      const currentBudget = await one('SELECT currency FROM budgets WHERE id=$1', [req.user.payroll_budget_id]);
      if (currentBudget && currentBudget.currency !== b.currency) {
        throw bad('Wähle zuerst ein Gehaltskonto in der neuen Währung aus');
      }
    }
    const updates = { ...b };
    // Wer das Design selbst wählt, braucht den einmaligen Auswahldialog nicht mehr
    if (b.ui_version) updates.ui_choice_seen = true;
    if ('payroll_budget_id' in b && b.payroll_budget_id !== req.user.payroll_budget_id) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      updates.payroll_start_date = b.payroll_budget_id ? `${values.year}-${values.month}-${values.day}` : null;
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      await q(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [req.user.id, ...keys.map((k) => updates[k])]);
    }
    if (b.payroll_budget_id) payrollRun(req.log).catch((err) => req.log.error({ err }, 'Gehaltslauf fehlgeschlagen'));
    return publicUser(await one('SELECT * FROM users WHERE id=$1', [req.user.id]));
  });

  // Eigenes Hintergrundbild für V2: sieht nur der Benutzer selbst. Der Browser verkleinert es vorher und schickt JPEG oder PNG.
  app.put('/me/background', requireAuth, async (req) => {
    const file = await receiveUpload(req, { images: true });
    const old = req.user.background_key;
    await q('UPDATE users SET background_key=$2, background_updated_at=now() WHERE id=$1', [req.user.id, file.key]);
    if (old) removeUpload(old);
    return publicUser(await one('SELECT * FROM users WHERE id=$1', [req.user.id]));
  });
  app.get('/me/background', requireAuth, async (req, reply) => {
    const key = req.user.background_key;
    if (!key || !fs.existsSync(uploadPath(key))) throw notFound();
    const head = Buffer.alloc(4);
    const fd = fs.openSync(uploadPath(key), 'r');
    try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
    reply.header('content-type', head[0] === 0x89 ? 'image/png' : 'image/jpeg').header('cache-control', 'private, no-cache').header('x-content-type-options', 'nosniff');
    return reply.send(fs.createReadStream(uploadPath(key)));
  });
  app.delete('/me/background', requireAuth, async (req) => {
    const key = req.user.background_key;
    const prefs = normalizeUiPrefs(req.user.ui_prefs);
    if (prefs.background === 'custom') prefs.background = 'dusk';
    await q('UPDATE users SET background_key=NULL, background_updated_at=now(), ui_prefs=$2 WHERE id=$1', [req.user.id, prefs]);
    if (key) removeUpload(key);
    return publicUser(await one('SELECT * FROM users WHERE id=$1', [req.user.id]));
  });

  // Prüft Passwort oder 2FA-Code, also begrenzt gegen Durchprobieren
  const checksSecret = { ...requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/me/password', checksSecret, async (req, reply) => {
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
  app.post('/me/2fa/enable', checksSecret, async (req) => {
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
  app.post('/me/2fa/disable', checksSecret, async (req) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (!(await verifyPassword(req.user.password_hash, password))) throw bad('Passwort ist falsch', 'wrong_password');
    if (await getSetting('security.force_2fa')) throw bad('2FA ist für alle Konten verpflichtend');
    await q('UPDATE users SET totp_enabled=false, totp_secret_enc=NULL WHERE id=$1', [req.user.id]);
    await q('DELETE FROM recovery_codes WHERE user_id=$1', [req.user.id]);
    await audit(req, '2fa.disabled', 'user', req.user.id);
    return { ok: true };
  });
  app.post('/me/2fa/recovery', checksSecret, async (req) => {
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
  const shownInApp = `n.user_id=$1 AND NOT EXISTS (SELECT 1 FROM notification_prefs p WHERE p.user_id=n.user_id AND p.kind=n.kind AND NOT p.in_app)`;
  app.get('/notifications', requireAuth, async (req) => ({
    items: await many(`SELECT n.id, n.kind, n.title, n.body, n.read_at, n.created_at FROM notifications n WHERE ${shownInApp} ORDER BY n.created_at DESC LIMIT 50`, [req.user.id]),
    unread: (await one(`SELECT count(*)::int n FROM notifications n WHERE ${shownInApp} AND n.read_at IS NULL`, [req.user.id])).n,
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
    const [work_projects, timer, contacts, calendar_events, notes, todos, bug_reports, bug_report_comments] = await Promise.all([
      many('SELECT * FROM work_projects WHERE owner_user_id=$1 OR team_id IN (SELECT team_id FROM team_members WHERE user_id=$1) ORDER BY name', [req.user.id]),
      one('SELECT * FROM work_timers WHERE user_id=$1', [req.user.id]),
      many('SELECT provider,external_id,name,email,phone,updated_at FROM synced_contacts WHERE user_id=$1 ORDER BY provider,name', [req.user.id]),
      many('SELECT provider,external_id,title,starts_at,ends_at,all_day,updated_at FROM synced_calendar_events WHERE user_id=$1 ORDER BY starts_at', [req.user.id]),
      many('SELECT id,team_id,title,body,pinned,created_at,updated_at FROM notes WHERE owner_user_id=$1 OR created_by=$1 ORDER BY created_at', [req.user.id]),
      many('SELECT id,team_id,title,note,due_date,done_at,created_at,updated_at FROM todos WHERE owner_user_id=$1 OR created_by=$1 ORDER BY created_at', [req.user.id]),
      many('SELECT id,title,description,steps,github_url,created_at FROM bug_reports WHERE user_id=$1 ORDER BY created_at', [req.user.id]),
      many('SELECT report_id,body,created_at FROM bug_report_comments WHERE user_id=$1 ORDER BY created_at', [req.user.id]),
    ]);
    // Eigene Schulungsteilnahmen und selbst angelegte Akten, Lizenzarten, Schulungen und Dokumentationen
    const [training_records, case_files, license_types, trainings, doc_categories] = await Promise.all([
      many(`SELECT r.id, tr.name training, r.result, r.completed_on, r.valid_until, s.session_date, r.created_at FROM training_records r
        JOIN trainings tr ON tr.id=r.training_id LEFT JOIN training_sessions s ON s.id=r.session_id WHERE r.user_id=$1 ORDER BY r.created_at`, [req.user.id]),
      many('SELECT id,file_number,title,description,status,opened_on,closed_on,created_at FROM case_files WHERE owner_user_id=$1 ORDER BY created_at', [req.user.id]),
      many('SELECT id,name,description,validity_months,created_at FROM license_types WHERE owner_user_id=$1 ORDER BY name', [req.user.id]),
      many('SELECT id,name,description,validity_months,active,created_at FROM trainings WHERE owner_user_id=$1 ORDER BY name', [req.user.id]),
      many(`SELECT c.id, c.name, COALESCE(json_agg(json_build_object('title', p.title, 'body', p.body, 'updated_at', p.updated_at) ORDER BY p.title) FILTER (WHERE p.id IS NOT NULL), '[]') pages
        FROM doc_categories c LEFT JOIN doc_pages p ON p.category_id=c.id WHERE c.owner_user_id=$1 GROUP BY c.id ORDER BY c.name`, [req.user.id]),
    ]);
    // Mitgliedschaften in Organisationen: Rang, Gruppen und persönlich gesetzte Rechte
    const organisations = await many(
      `SELECT t.name, tm.is_owner, r.name rank,
         COALESCE((SELECT array_agg(g.name ORDER BY g.name) FROM team_group_members gm JOIN team_groups g ON g.id=gm.group_id WHERE gm.team_id=tm.team_id AND gm.user_id=tm.user_id), '{}') groups,
         COALESCE((SELECT json_agg(json_build_object('module', p.module, 'scope_id', p.scope_id, 'level', p.level)) FROM team_permissions p WHERE p.team_id=tm.team_id AND p.user_id=tm.user_id), '[]') personal_permissions
       FROM team_members tm JOIN teams t ON t.id=tm.team_id LEFT JOIN team_ranks r ON r.id=tm.rank_id WHERE tm.user_id=$1 ORDER BY t.name`,
      [req.user.id],
    );
    return { exported_at: new Date().toISOString(), user: u, organisations, budgets, transactions, work_entries, work_projects, work_timer: timer, contacts, calendar_events, notes, todos, bug_reports, bug_report_comments, training_records, case_files, license_types, trainings, doc_categories };
  });
}

export { need, invalidatePermCache };
