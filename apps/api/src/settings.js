import { one, many, q } from './db.js';

export const DEFAULTS = {
  'security.password_min_length': 10,
  'security.max_failed_logins': 5,
  'security.lockout_minutes': 15,
  'security.session_days': 14,
  'security.force_2fa': false,
  'security.admin_ip_allowlist': '',
  'general.app_name': 'RP-Management-Board',
  'general.maintenance': false,
  'general.maintenance_message': 'Wartungsarbeiten – bitte später erneut versuchen.',
  'general.registration': false,
  'general.default_currency': 'EUR',
  'general.default_locale': 'de',
  'retention.audit_days': 365,
  'retention.notifications_days': 90,
  'retention.sessions_days': 30,
  'retention.trash_days': 30,
  'mail.enabled': true,
  // Teile des Aktensystems ein- und ausschalten (features.js); Personenakten bleiben immer an
  'casefiles.files': true,
  'casefiles.wanted': true,
  'casefiles.penal_codes': true,
  'casefiles.report_templates': true,
  'casefiles.types': true,
  // Spotify-App des Servers (nur die Client-ID, Anmeldung per PKCE); leer: SPOTIFY_CLIENT_ID aus der .env
  // Neue Funktionen ab 2026-11-13 ein- und ausschalten (features.js, MODULE_SWITCHES)
  'modules.board': true, 'modules.shifts': true, 'modules.dispatch': true, 'modules.bolo': true, 'modules.fines': true,
  'modules.recruiting': true, 'modules.personnel': true, 'modules.absences': true, 'modules.equipment': true,
  'modules.invoices': true, 'modules.cash': true, 'modules.payslip': true, 'modules.speedcams': true, 'modules.music': true,
  'modules.discord': true, 'modules.search': true,
  'music.spotify_client_id': '',
  // Client-Secret verschlüsselt (encrypt); nur für die Suche ohne Anmeldung (Client Credentials)
  'music.spotify_client_secret': '',
};

let cache = null;
let cacheAt = 0;

export async function allSettings() {
  if (cache && Date.now() - cacheAt < 5000) return cache;
  const rows = await many('SELECT key, value FROM settings');
  cache = { ...DEFAULTS };
  for (const r of rows) cache[r.key] = r.value;
  cacheAt = Date.now();
  return cache;
}

export const getSetting = async (k) => (await allSettings())[k];

export async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in DEFAULTS)) continue;
    if (typeof v !== typeof DEFAULTS[k]) continue;
    await q('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [k, JSON.stringify(v)]);
  }
  cache = null;
}

export const jobStatus = () => many('SELECT * FROM job_runs ORDER BY name');
export const settingRow = (k) => one('SELECT value FROM settings WHERE key=$1', [k]);
