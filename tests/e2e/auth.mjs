// Auth-Flows: 2FA, Refresh-Rotation, Sitzungen, Passwort, Reset-Token aus DB, Einladung
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
const BASE = `${process.env.BASE || 'http://localhost:18088'}/api`;
let pass = 0; const fails = [];
const check = (n, ok, x = '') => { if (ok) pass++; else { fails.push(`${n} ${x}`); console.log('FAIL', n, x); } };
const psql = (sql) => execSync(`docker exec ${process.env.E2E_PROJECT || 'bm-e2e'}-db-1 psql -U budget -d budget -tA -c "${sql}"`).toString().trim();
const req = async (m, p, { t, body, cookie } = {}) => {
  const r = await fetch(BASE + p, { method: m, headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (r.status >= 500) check(`kein 5xx ${m} ${p}`, false, text.slice(0, 200));
  return { s: r.status, d: data, cookie: r.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; '), raw: r.headers.getSetCookie?.() };
};
function totp(secret, drift = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + drift));
  const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const adminLogin = await req('POST', '/auth/login', { body: { email: 'admin@e2e.test', password: 'E2e-Admin-Passw0rd!x' } });
const A = adminLogin.d.access_token;
const roleId = (await req('GET', '/admin/roles', { t: A })).d.roles.find((r) => r.name === 'User').id;
const pw = 'Erin-Sehr-Sicher-4417!';
await req('POST', '/admin/users', { t: A, body: { name: 'erin', email: 'erin@e2e.test', password: pw, role_ids: [roleId] } });

// Cookie-Flags & Refresh-Rotation
let l = await req('POST', '/auth/login', { body: { email: 'erin@e2e.test', password: pw } });
check('Refresh-Cookie httpOnly/SameSite', /HttpOnly/i.test(l.raw.join()) && /SameSite=Strict/i.test(l.raw.join()), l.raw.join());
const r1 = await req('POST', '/auth/refresh', { cookie: l.cookie });
check('Refresh liefert Token', r1.s === 200 && r1.d.access_token);
check('Rotation: neues Cookie', r1.cookie && r1.cookie !== l.cookie);
const reuse = await req('POST', '/auth/refresh', { cookie: l.cookie });
check('Altes Refresh-Token ungültig', reuse.s === 401, `status=${reuse.s}`);
const T = r1.d.access_token;
check('Manipuliertes JWT', (await req('GET', '/me', { t: `${T}x` })).s === 401);

// 2FA
const setup = await req('POST', '/me/2fa/setup', { t: T, body: {} });
check('2FA Setup', setup.s === 200 && setup.d.secret && setup.d.qr_svg);
check('2FA falscher Code', (await req('POST', '/me/2fa/enable', { t: T, body: { code: '000000' } })).s === 400);
const en = await req('POST', '/me/2fa/enable', { t: T, body: { code: totp(setup.d.secret) } });
check('2FA aktiv', en.s === 200 && en.d.recovery_codes?.length === 8, JSON.stringify(en.d));
const l2 = await req('POST', '/auth/login', { body: { email: 'erin@e2e.test', password: pw } });
check('Login verlangt 2FA', l2.d.mfa_required === true && !l2.d.access_token);
check('2FA falscher Login-Code', (await req('POST', '/auth/2fa/login', { body: { mfa_token: l2.d.mfa_token, code: '000000' } })).s >= 400);
const l3 = await req('POST', '/auth/2fa/login', { body: { mfa_token: l2.d.mfa_token, code: totp(setup.d.secret) } });
check('2FA-Login', l3.s === 200 && l3.d.access_token, JSON.stringify(l3.d));
const l4 = await req('POST', '/auth/login', { body: { email: 'erin@e2e.test', password: pw } });
const rc = en.d.recovery_codes[0];
const l5 = await req('POST', '/auth/2fa/login', { body: { mfa_token: l4.d.mfa_token, code: rc } });
check('Recovery-Code', l5.s === 200 && l5.d.access_token, JSON.stringify(l5.d));
const l6 = await req('POST', '/auth/login', { body: { email: 'erin@e2e.test', password: pw } });
check('Recovery-Code nur einmal', (await req('POST', '/auth/2fa/login', { body: { mfa_token: l6.d.mfa_token, code: rc } })).s >= 400);
// PIN mit 2FA
const E = l5.d.access_token;
const house = await req('POST', '/properties', { t: E, body: { name: 'H' } });
check('PIN ohne 2FA-Code abgelehnt', (await req('POST', `/properties/${house.d.id}/pin`, { t: E, body: { pin: '77', password: pw } })).s === 400);
check('PIN mit 2FA-Code', (await req('POST', `/properties/${house.d.id}/pin`, { t: E, body: { pin: '77', password: pw, code: totp(setup.d.secret) } })).s === 200);
check('Audit protokolliert PIN', Number(psql("select count(*) from audit_log where action='property.pin.updated'")) >= 1);
const stored = psql(`select door_pin_enc from properties where id='${house.d.id}'`);
check('PIN nicht im Klartext gespeichert', stored && stored !== '77' && !stored.includes('77:'));
check('2FA aus', (await req('POST', '/me/2fa/disable', { t: E, body: { password: pw } })).s === 200);
const secretDb = psql("select coalesce(totp_secret_enc,'') from users where email='erin@e2e.test'");
check('2FA-Secret verschlüsselt', secretDb !== setup.d.secret);

// Passwort ändern / Sitzungen
const newPw = 'Erin-Neu-Sicher-8826!';
check('Passwort falsch aktuell', (await req('POST', '/me/password', { t: E, body: { current: 'x', password: newPw } })).s >= 400);
check('Schwaches Passwort', (await req('POST', '/me/password', { t: E, body: { current: pw, password: '123' } })).s === 400);
check('Passwort ändern', (await req('POST', '/me/password', { t: E, body: { current: pw, password: newPw } })).s === 200);
check('Altes Passwort tot', (await req('POST', '/auth/login', { body: { email: 'erin@e2e.test', password: pw } })).s >= 400);
const l7 = await req('POST', '/auth/login', { body: { email: 'erin@e2e.test', password: newPw } });
check('Neues Passwort', l7.s === 200);
const sess = await req('GET', '/me/sessions', { t: l7.d.access_token });
check('Sitzungsliste', sess.s === 200 && sess.d.length >= 1);
check('Andere Sitzungen beenden', (await req('DELETE', '/me/sessions', { t: l7.d.access_token })).s === 200);

// Reset (Token direkt einsetzen, weil ohne SMTP keine Mail rausgeht)
check('Forgot verrät keine Existenz', (await req('POST', '/auth/forgot', { body: { email: 'nobody@e2e.test' } })).s === 200);
check('Forgot', (await req('POST', '/auth/forgot', { body: { email: 'erin@e2e.test' } })).s === 200);
const tok = crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(tok).digest('hex');
psql(`insert into password_resets(user_id,token_hash,expires_at) select id,'${hash}',now()+interval '1 hour' from users where email='erin@e2e.test'`);
const rs = await req('POST', '/auth/reset', { body: { token: tok, password: 'Erin-Reset-Sicher-1173!' } });
check('Reset', rs.s === 200, JSON.stringify(rs.d));
check('Reset-Token einmalig', (await req('POST', '/auth/reset', { body: { token: tok, password: 'Erin-Reset-Sicher-1174!' } })).s >= 400);
check('Login nach Reset', (await req('POST', '/auth/login', { body: { email: 'erin@e2e.test', password: 'Erin-Reset-Sicher-1173!' } })).s === 200);

// Einladung
const inv = await req('POST', '/admin/users', { t: A, body: { name: 'frank', email: 'frank@e2e.test', role_ids: [roleId], invite: true } });
check('Einladung', inv.s === 200 && inv.d.invited, JSON.stringify(inv.d));
const link = inv.d.link || inv.d.url || inv.d.invite_url || '';
const invTok = (link.match(/token=([^&]+)/) || [])[1];
check('Einladungslink ohne SMTP', !!invTok, JSON.stringify(inv.d));
if (invTok) {
  check('Einladung lesen', (await req('GET', `/auth/invite/${invTok}`)).s === 200);
  const acc = await req('POST', `/auth/invite/${invTok}`, { body: { name: 'Frank', password: 'Frank-Sehr-Sicher-5521!' } });
  check('Einladung annehmen', acc.s === 200, JSON.stringify(acc.d));
  check('Login Eingeladener', (await req('POST', '/auth/login', { body: { email: 'frank@e2e.test', password: 'Frank-Sehr-Sicher-5521!' } })).s === 200);
}
// Registrierung standardmäßig aus
check('Registrierung aus', (await req('POST', '/auth/register', { body: { email: 'x@e2e.test', name: 'x', password: 'Xx-Sehr-Sicher-5521!' } })).s === 403);

// Konto löschen + DSGVO
const del = await req('POST', '/auth/login', { body: { email: 'frank@e2e.test', password: 'Frank-Sehr-Sicher-5521!' } });
console.log(`\nAuth-E2E: ${pass} bestanden, ${fails.length} fehlgeschlagen`);
if (fails.length) { console.log(fails.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
