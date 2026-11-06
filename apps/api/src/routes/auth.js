import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { config } from '../config.js';
import {
  hashPassword, verifyPassword, dummyVerify, sha256, randomToken, signAccess, signMfa, verifyJwt,
  totpValid, decrypt, passwordProblem, pwned,
} from '../security.js';
import { HttpError, bad, loadAccess } from '../authz.js';
import { getSetting } from '../settings.js';
import { audit } from '../audit.js';
import { sendMail } from '../mail.js';
import { accessExpired, dateInZone } from '../periods.js';

const COOKIE = 'bm_refresh';

export async function checkPassword(pw) {
  const min = await getSetting('security.password_min_length');
  const p = passwordProblem(pw, min);
  if (p) throw bad(p, 'weak_password');
  if (config.hibpCheck && (await pwned(pw))) throw bad('Dieses Passwort ist in Datenlecks aufgetaucht – bitte ein anderes wählen', 'pwned_password');
}

async function startSession(req, reply, user) {
  const days = await getSetting('security.session_days');
  const refresh = randomToken(48);
  const s = await one(
    `INSERT INTO sessions(user_id, refresh_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval) RETURNING id`,
    [user.id, sha256(refresh), (req.headers['user-agent'] || '').slice(0, 250), req.ip, String(days)],
  );
  reply.setCookie(COOKIE, refresh, {
    httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/api/auth', maxAge: days * 86400,
  });
  await q('UPDATE users SET last_login_at=now(), failed_logins=0, locked_until=NULL WHERE id=$1', [user.id]);
  return { access_token: signAccess(user, s.id), expires_in: config.accessTtlSec };
}

async function loginFailed(req, user) {
  const max = await getSetting('security.max_failed_logins');
  const mins = await getSetting('security.lockout_minutes');
  const u = await one(
    `UPDATE users SET failed_logins=failed_logins+1,
       locked_until = CASE WHEN failed_logins+1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
     WHERE id=$1 RETURNING failed_logins`,
    [user.id, max, String(mins)],
  );
  await audit({ ...req, user }, 'login.failed', 'user', user.id, { failed: u.failed_logins });
}

export default async function routes(app) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/login', strict, async (req, reply) => {
    const { email, password } = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).parse(req.body);
    const user = await one('SELECT * FROM users WHERE email=$1 AND deleted_at IS NULL', [email]);
    const generic = new HttpError(401, 'E-Mail oder Passwort falsch', 'invalid_credentials');
    if (!user || !user.password_hash) {
      await dummyVerify(password);
      throw generic;
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) throw new HttpError(423, 'Konto vorübergehend gesperrt – bitte später erneut versuchen', 'locked');
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) {
      await loginFailed(req, user);
      throw generic;
    }
    if (user.status !== 'active') throw new HttpError(403, 'Konto ist nicht aktiv', 'inactive');
    if (accessExpired(user.expires_at, dateInZone(config.tz))) throw new HttpError(403, 'Konto ist abgelaufen', 'expired');
    if (user.totp_enabled) return { mfa_required: true, mfa_token: signMfa(user.id) };
    const tokens = await startSession(req, reply, user);
    await audit({ ...req, user }, 'login', 'user', user.id);
    return tokens;
  });

  app.post('/auth/2fa/login', strict, async (req, reply) => {
    const { mfa_token, code } = z.object({ mfa_token: z.string(), code: z.string().min(6).max(20) }).parse(req.body);
    let p;
    try {
      p = verifyJwt(mfa_token, 'mfa');
    } catch {
      throw new HttpError(401, 'Anmeldung abgelaufen, bitte neu starten', 'mfa_expired');
    }
    const user = await one("SELECT * FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL", [p.sub]);
    if (!user || !user.totp_enabled) throw new HttpError(401, 'Ungültig', 'invalid');
    if (accessExpired(user.expires_at, dateInZone(config.tz))) throw new HttpError(403, 'Konto ist abgelaufen', 'expired');
    if (user.locked_until && new Date(user.locked_until) > new Date()) throw new HttpError(423, 'Konto vorübergehend gesperrt', 'locked');
    let ok = totpValid(decrypt(user.totp_secret_enc), code);
    if (!ok) {
      const rc = await one('UPDATE recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id', [user.id, sha256(code.trim().toLowerCase())]);
      ok = !!rc;
    }
    if (!ok) {
      await loginFailed(req, user);
      throw new HttpError(401, 'Code ungültig', 'invalid_code');
    }
    const tokens = await startSession(req, reply, user);
    await audit({ ...req, user }, 'login', 'user', user.id, { mfa: true });
    return tokens;
  });

  // Ohne Limit: Jedes Neuladen ruft das auf, und das Token ist nicht erratbar
  app.post('/auth/refresh', async (req, reply) => {
    const old = req.cookies?.[COOKIE];
    if (!old) throw new HttpError(401, 'Keine Sitzung', 'no_session');
    const s = await one('SELECT * FROM sessions WHERE refresh_hash=$1', [sha256(old)]);
    if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) {
      // Wiederverwendung eines rotierten Tokens → gesamte Sitzung widerrufen
      reply.clearCookie(COOKIE, { path: '/api/auth' });
      throw new HttpError(401, 'Sitzung ungültig', 'no_session');
    }
    const user = await one("SELECT * FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL", [s.user_id]);
    if (!user || accessExpired(user.expires_at, dateInZone(config.tz))) throw new HttpError(401, 'Sitzung ungültig', 'no_session');
    const next = randomToken(48);
    await q('UPDATE sessions SET refresh_hash=$2, last_seen_at=now(), ip=$3 WHERE id=$1', [s.id, sha256(next), req.ip]);
    const days = await getSetting('security.session_days');
    reply.setCookie(COOKIE, next, { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/api/auth', maxAge: days * 86400 });
    return { access_token: signAccess(user, s.id), expires_in: config.accessTtlSec };
  });

  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies?.[COOKIE];
    if (t) await q('UPDATE sessions SET revoked_at=now() WHERE refresh_hash=$1', [sha256(t)]);
    reply.clearCookie(COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.post('/auth/forgot', strict, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await one("SELECT * FROM users WHERE email=$1 AND status='active' AND deleted_at IS NULL", [email]);
    if (user) {
      const token = randomToken(32);
      await q("INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')", [user.id, sha256(token)]);
      await sendMail({
        to: user.email,
        subject: 'Passwort zurücksetzen',
        text: `Hallo ${user.name},\n\nüber diesen Link kannst du dein Passwort zurücksetzen (1 Stunde gültig):\n${config.appUrl}/#/reset?token=${token}\n\nWar das nicht du, ignoriere diese Mail.`,
        log: req.log,
      });
    }
    return { ok: true };
  });

  app.post('/auth/reset', strict, async (req) => {
    const { token, password } = z.object({ token: z.string().min(10), password: z.string() }).parse(req.body);
    await checkPassword(password);
    const r = await one('SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()', [sha256(token)]);
    if (!r) throw bad('Link ungültig oder abgelaufen', 'invalid_token');
    const hash = await hashPassword(password);
    await tx(async (c) => {
      await c.query('UPDATE password_resets SET used_at=now() WHERE id=$1', [r.id]);
      await c.query('UPDATE users SET password_hash=$2, password_changed_at=now(), failed_logins=0, locked_until=NULL WHERE id=$1', [r.user_id, hash]);
      await c.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [r.user_id]);
    });
    await audit(req, 'password.reset', 'user', r.user_id);
    return { ok: true };
  });

  app.get('/auth/invite/:token', async (req) => {
    const inv = await one(
      'SELECT email FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()',
      [sha256(req.params.token)],
    );
    if (!inv) throw bad('Einladung ungültig oder abgelaufen', 'invalid_token');
    return { email: inv.email };
  });

  app.post('/auth/invite/:token', strict, async (req, reply) => {
    const { name, password } = z.object({ name: z.string().min(1).max(100), password: z.string() }).parse(req.body);
    await checkPassword(password);
    const inv = await one('SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()', [sha256(req.params.token)]);
    if (!inv) throw bad('Einladung ungültig oder abgelaufen', 'invalid_token');
    const hash = await hashPassword(password);
    const user = await tx(async (c) => {
      let u = (await c.query('SELECT * FROM users WHERE email=$1 AND deleted_at IS NULL', [inv.email])).rows[0];
      if (u && u.status !== 'invited') throw bad('Konto existiert bereits', 'exists');
      if (u) {
        await c.query("UPDATE users SET password_hash=$2, name=$3, status='active' WHERE id=$1", [u.id, hash, name]);
      } else {
        u = (await c.query('INSERT INTO users(email, password_hash, name) VALUES ($1,$2,$3) RETURNING *', [inv.email, hash, name])).rows[0];
      }
      const role = inv.role_id ? [inv.role_id] : (await c.query('SELECT id FROM roles WHERE is_default')).rows.map((r) => r.id);
      for (const rid of role) await c.query('INSERT INTO user_roles VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.id, rid]);
      if (inv.team_id) await c.query('INSERT INTO team_members VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [inv.team_id, u.id, inv.team_role]);
      await c.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [inv.id]);
      return u;
    });
    await audit({ ...req, user }, 'invite.accepted', 'user', user.id);
    return startSession(req, reply, user);
  });

  app.get('/auth/config', async () => ({
    registration: config.allowRegistration || (await getSetting('general.registration')),
    app_name: await getSetting('general.app_name'),
    maintenance: await getSetting('general.maintenance'),
  }));

  app.post('/auth/register', strict, async (req, reply) => {
    if (!(config.allowRegistration || (await getSetting('general.registration')))) throw new HttpError(403, 'Registrierung ist deaktiviert', 'disabled');
    const { email, name, password } = z.object({ email: z.string().email(), name: z.string().min(1).max(100), password: z.string() }).parse(req.body);
    await checkPassword(password);
    if (await one('SELECT 1 FROM users WHERE email=$1', [email])) throw bad('Registrierung nicht möglich', 'exists');
    const hash = await hashPassword(password);
    const user = await tx(async (c) => {
      const u = (await c.query('INSERT INTO users(email, password_hash, name) VALUES ($1,$2,$3) RETURNING *', [email, hash, name])).rows[0];
      await c.query('INSERT INTO user_roles SELECT $1, id FROM roles WHERE is_default', [u.id]);
      const dom = email.split('@')[1];
      await c.query("INSERT INTO group_members SELECT id, $1 FROM groups WHERE auto_domain IS NOT NULL AND lower(auto_domain)=lower($2) ON CONFLICT DO NOTHING", [u.id, dom]);
      return u;
    });
    await audit({ ...req, user }, 'register', 'user', user.id);
    return startSession(req, reply, user);
  });
}

export { loadAccess };
