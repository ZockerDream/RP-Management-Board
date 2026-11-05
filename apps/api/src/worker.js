import PgBoss from 'pg-boss';
import { config } from './config.js';
import { waitForDb, pool } from './db.js';
import { JOBS, runJob } from './jobs.js';

const log = {
  info: (m) => console.log(JSON.stringify({ level: 'info', msg: typeof m === 'string' ? m : m })),
  warn: (m) => console.warn(JSON.stringify({ level: 'warn', msg: m })),
  error: (o, m) => console.error(JSON.stringify({ level: 'error', msg: m, err: o?.err?.message })),
};

await waitForDb();
const boss = new PgBoss({ connectionString: config.databaseUrl, schema: 'pgboss' });
boss.on('error', (e) => log.error({ err: e }, 'pg-boss'));
await boss.start();

for (const [name, job] of Object.entries(JOBS)) {
  await boss.createQueue(name);
  await boss.schedule(name, job.cron, null, { tz: config.tz });
  await boss.work(name, async () => runJob(name, log));
}
log.info(`Worker gestartet (${Object.keys(JOBS).join(', ')})`);
await runJob('recurring.run', log);
await runJob('payroll.run', log);

const stop = async () => {
  await boss.stop({ graceful: true, timeout: 20000 });
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
