import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { config } from './config.js';
import { waitForDb, migrate, pool } from './db.js';
import { seed } from './seed.js';
import { HttpError } from './authz.js';

const app = Fastify({
  logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
  trustProxy: true,
  bodyLimit: 1048576,
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cookie);
await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

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
    return reply.status(400).send({ error: 'validation', message: err.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; ') });
  }
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code || 'error', message: err.message });
  if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code || 'error', message: err.message });
  req.log.error({ err }, 'Unbehandelter Fehler');
  return reply.status(500).send({ error: 'internal', message: 'Interner Fehler' });
});
app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: 'not_found', message: 'Nicht gefunden' }));

app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
app.get('/ready', { config: { rateLimit: false } }, async (req, reply) => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ready' };
  } catch {
    return reply.status(503).send({ status: 'db_unavailable' });
  }
});

app.addHook('onSend', async (req, reply) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/health')) reply.header('cache-control', 'no-store');
});

await waitForDb();
await migrate(app.log);
await seed(app.log);

const modules = ['auth', 'me', 'finance', 'teams', 'objects', 'calendar', 'admin', 'attachments'];
await app.register(
  async (api) => {
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
