import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { config } from './config.js';

const encKey = crypto.createHash('sha256').update(config.encryptionKey).digest();

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const hashPassword = (pw) => argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hash, pw) => argon2.verify(hash, pw).catch(() => false);
let dummy;
export async function dummyVerify(pw) {
  dummy ||= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummy, pw);
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
export function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export const signAccess = (user, sid) =>
  jwt.sign({ sub: user.id, sid, typ: 'access' }, config.jwtSecret, { expiresIn: config.accessTtlSec, algorithm: 'HS256' });
export const signMfa = (userId) => jwt.sign({ sub: userId, typ: 'mfa' }, config.jwtSecret, { expiresIn: 300, algorithm: 'HS256' });
// Kurzlebiger Schlüssel für <audio>: Das Element kann keinen Authorization-Header senden
export const signMusic = (userId) => jwt.sign({ sub: userId, typ: 'music' }, config.jwtSecret, { expiresIn: 6 * 3600, algorithm: 'HS256' });
export function verifyJwt(token, typ) {
  const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  if (p.typ !== typ) throw new Error('falscher Token-Typ');
  return p;
}

authenticator.options = { window: 1 };
export const newTotpSecret = () => authenticator.generateSecret();
export const totpUri = (email, secret) => authenticator.keyuri(email, 'RP-Management-Board', secret);
export const totpValid = (secret, code) => {
  try {
    return authenticator.check(String(code).replace(/\s/g, ''), secret);
  } catch {
    return false;
  }
};

export function newRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const s = crypto.randomBytes(5).toString('hex');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function passwordProblem(pw, minLen = 10) {
  if (typeof pw !== 'string' || pw.length < minLen) return `Passwort muss mindestens ${minLen} Zeichen lang sein`;
  if (pw.length > 200) return 'Passwort ist zu lang';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'Passwort braucht mindestens 3 von 4: Kleinbuchstaben, Großbuchstaben, Ziffern, Sonderzeichen';
  return null;
}

// HIBP k-Anonymity (nur 5 Hash-Zeichen verlassen den Server); bei Fehlern fail-open
export async function pwned(pw) {
  try {
    const h = crypto.createHash('sha1').update(pw).digest('hex').toUpperCase();
    const r = await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    return (await r.text()).split('\n').some((l) => l.startsWith(h.slice(5)));
  } catch {
    return false;
  }
}
