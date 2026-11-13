const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  return v;
}

const appUrl = (env.APP_URL || 'http://localhost').replace(/\/+$/, '');
const proxySetting = env.TRUST_PROXY || 'false';

export const config = {
  port: Number(env.PORT || 3000),
  appUrl,
  secureCookies: appUrl.startsWith('https://'),
  trustProxy: proxySetting === 'true'
    ? true
    : proxySetting === 'false'
      ? false
      : proxySetting.split(',').map((address) => address.trim()).filter(Boolean),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  encryptionKey: required('ENCRYPTION_KEY'),
  accessTtlSec: Number(env.ACCESS_TOKEN_TTL_SEC || 900),
  refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS || 14),
  admin: {
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Administrator',
  },
  uploadDir: env.UPLOAD_DIR || '/data/uploads',
  backupDir: env.BACKUP_DIR || '/data/backups',
  backupRetentionDays: Number(env.BACKUP_RETENTION_DAYS || 14),
  backupEncrypt: (env.BACKUP_ENCRYPT || 'true') === 'true',
  backupHour: Number(env.BACKUP_HOUR || 3),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  allowRegistration: (env.ALLOW_REGISTRATION || 'false') === 'true',
  hibpCheck: (env.HIBP_CHECK || 'false') === 'true',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: (env.SMTP_SECURE || 'false') === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASSWORD || '',
    from: env.SMTP_FROM || 'RP-Management-Board <noreply@localhost>',
  },
  oauth: {
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    microsoftClientId: env.MICROSOFT_CLIENT_ID || '',
    microsoftClientSecret: env.MICROSOFT_CLIENT_SECRET || '',
    spotifyClientId: env.SPOTIFY_CLIENT_ID || '',
  },
  musicDir: env.MUSIC_ROOT || '/data/music',
  musicUploadBytes: Number(env.MUSIC_UPLOAD_MB || 50) * 1024 * 1024,
  githubIssues: {
    token: env.GITHUB_ISSUES_TOKEN || '',
    repository: env.GITHUB_ISSUES_REPOSITORY || 'ZockerDream/RP-Management-Board',
  },
  imprint: {
    name: env.IMPRINT_NAME || '',
    representative: env.IMPRINT_REPRESENTATIVE || '',
    street: env.IMPRINT_STREET || '',
    postalCode: env.IMPRINT_POSTAL_CODE || '',
    city: env.IMPRINT_CITY || '',
    country: env.IMPRINT_COUNTRY || '',
    email: env.IMPRINT_EMAIL || '',
    phone: env.IMPRINT_PHONE || '',
    website: env.IMPRINT_WEBSITE || '',
    register: env.IMPRINT_REGISTER || '',
    vatId: env.IMPRINT_VAT_ID || '',
    responsible: env.IMPRINT_RESPONSIBLE || '',
    supervisory: env.IMPRINT_SUPERVISORY || '',
    note: env.IMPRINT_NOTE || '',
  },
  logLevel: env.LOG_LEVEL || 'info',
  tz: env.TZ || 'Europe/Berlin',
};

if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET muss mindestens 32 Zeichen lang sein');
if (config.encryptionKey.length < 32) throw new Error('ENCRYPTION_KEY muss mindestens 32 Zeichen lang sein');
