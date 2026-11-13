import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { waitForDb, migrate, pool } from './db.js';
import { seed } from './seed.js';
import { HttpError } from './authz.js';
import { assetVersion, versionIndexHtml } from './static-assets.js';
import { validationMessage } from './validation.js';
import { guardRoutes } from './feature-guard.js';

const app = Fastify({
  logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
  trustProxy: config.trustProxy,
  bodyLimit: 1048576,
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Spotify: Cover von i.scdn.co und Co., nur für Benutzer, die ihr Spotify-Konto verbunden haben
      imgSrc: ["'self'", 'data:', 'https://www.gravatar.com', 'https://secure.gravatar.com', 'https://i.scdn.co', 'https://*.scdn.co', 'https://*.spotifycdn.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      // Eingebetteter Spotify-Player (Musik → Spotify)
      frameSrc: ['https://open.spotify.com'],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: { directives: { camera: [], microphone: [], geolocation: [] } },
});
await app.register(cookie);
// Kein allgemeines Limit: Grenzen gelten nur dort, wo Passwörter oder Codes geprüft werden (`config.rateLimit` an der Route)
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });
const staticRoot = process.env.STATIC_DIR || fileURLToPath(new URL('../../web/public', import.meta.url));
const version = assetVersion(staticRoot);
const indexHtml = versionIndexHtml(fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf8'), version);
await app.register(fastifyStatic, {
  root: staticRoot,
  prefix: `/assets/${version}/`,
  wildcard: false,
  index: false,
  dotfiles: 'ignore',
  cacheControl: false,
  setHeaders(reply) {
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  },
});
for (const url of ['/', '/index.html']) {
  app.get(url, (req, reply) => reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml));
}

app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch {
    const e = new Error('Ungültiges JSON');
    e.statusCode = 400;
    done(e);
  }
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: 'validation', message: validationMessage(err.issues) });
  }
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code || 'error', message: err.message });
  if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code || 'error', message: err.message });
  // Von PostgreSQL abgelehnte Werte (keine gültige UUID, nicht existierendes Datum, Null-Byte im Text) sind Eingabefehler
  if (['22P02', '22007', '22008', '22021'].includes(err.code)) return reply.status(400).send({ error: 'validation', message: 'Ungültige Eingabe' });
  req.log.error({ err }, 'Unbehandelter Fehler');
  return reply.status(500).send({ error: 'internal', message: 'Interner Fehler' });
});
app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: 'not_found', message: 'Nicht gefunden' }));

app.get('/health', async () => ({ status: 'ok' }));
app.get('/ready', async (req, reply) => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ready' };
  } catch {
    return reply.status(503).send({ status: 'db_unavailable' });
  }
});

// Hinter einem Proxy ohne TRUST_PROXY teilen sich alle Benutzer dessen IP, auch beim Login-Limit und im Audit-Log
let proxyWarned = false;
app.addHook('onRequest', async (req) => {
  if (proxyWarned || config.trustProxy || !req.headers['x-forwarded-for']) return;
  proxyWarned = true;
  req.log.warn('Anfrage kam über einen Proxy, aber TRUST_PROXY ist nicht gesetzt');
});

app.addHook('onSend', async (req, reply) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/health')) reply.header('cache-control', 'no-store');
});

// Klartext statt Stacktrace, damit "docker compose logs" die Lösung lesbar zeigt
await waitForDb().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
await migrate(app.log);
await seed(app.log);

const modules = ['auth', 'me', 'finance', 'teams', 'objects', 'vehicle-images', 'calendar', 'admin', 'attachments', 'work', 'integrations', 'spending', 'sport', 'notes', 'todos', 'casefiles', 'case-records', 'case-reports', 'person-files', 'licenses', 'trainings', 'training-exams', 'docs', 'fleet', 'transfers', 'music', 'speedcams', 'board', 'absences', 'orgsettings', 'search', 'shifts', 'personnel', 'equipment', 'dispatch', 'invoices', 'cash', 'payslip', 'public'];
await app.register(
  async (api) => {
    guardRoutes(api);
    for (const m of modules) await api.register((await import(`./routes/${m}.js`)).default);
  },
  { prefix: '/api' },
);

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
