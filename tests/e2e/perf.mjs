// Antwortzeiten der Listen-Endpunkte messen (nach api.mjs, auf dem Wegwerf-Stack bm-check).
// node perf.mjs [ausgabe.json]   – PERF_SEED=1 legt vorher zusätzliche Organisationen und Budgets an,
// damit Abfragen pro Datensatz (N+1) überhaupt auffallen; PERF_RUNS bestimmt die Wiederholungen (Vorgabe 30).
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:18089';
const RUNS = Number(process.env.PERF_RUNS || 30);
const out = process.argv[2];

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Login ${email}: ${JSON.stringify(data)}`);
  return data.access_token;
}
const call = async (token, method, path, body) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

const alice = await login('alice@e2e.test', 'alice-Sehr-Sicher-9931!');

if (process.env.PERF_SEED) {
  const budgets = await call(alice, 'GET', '/budgets');
  for (let i = 0; i < 15; i++) {
    const team = await call(alice, 'POST', '/teams', { name: `Perf Organisation ${i + 1}` });
    await call(alice, 'POST', '/sport/routes', { team_id: team.id, sport_type: 'run', name: `Perf Strecke ${i + 1}`, checkpoints: 3, laps: 2 });
  }
  for (let i = 0; i < 30; i++) {
    await call(alice, 'POST', '/spending-budgets', { name: `Perf Budget ${i + 1}`, limit_amount: 100 + i, period_type: ['daily', 'weekly', 'monthly', 'yearly'][i % 4], budget_id: budgets[i % budgets.length].id });
  }
  console.log('Zusatzdaten angelegt: 15 Organisationen mit Strecke, 30 Budgets');
}

const PATHS = [
  '/me', '/budgets', '/transactions', '/spending-budgets', '/recurring', '/goals', '/stats/overview', '/stats/timeline', '/stats/by-category',
  '/stats/forecast', '/teams', '/calendar', '/notes', '/todos', '/notifications', '/sport/routes', '/work-hours', '/work-projects',
  '/case-files', '/person-files', '/people', '/trainings', '/licenses', '/doc-categories', '/assets/overview', '/fleet/teams', '/transfers',
];
const results = {};
for (const path of PATHS) {
  const times = [];
  await call(alice, 'GET', path).catch(() => null); // aufwärmen
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    try { await call(alice, 'GET', path); } catch { times.length = 0; break; }
    times.push(performance.now() - start);
  }
  if (!times.length) { console.log(`${path.padEnd(22)} übersprungen`); continue; }
  times.sort((a, b) => a - b);
  results[path] = { median: +times[Math.floor(times.length / 2)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1) };
  console.log(`${path.padEnd(22)} Median ${String(results[path].median).padStart(6)} ms   p95 ${String(results[path].p95).padStart(6)} ms`);
}
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
