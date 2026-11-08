// API-E2E gegen den isolierten Stack. Jede 5xx-Antwort zählt automatisch als Fehler.
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://localhost:18088';
const results = { pass: 0, fail: [] };
const fives = [];
const check = (name, ok, extra = '') => {
  if (ok) results.pass++;
  else { results.fail.push(`${name} ${extra}`); console.log(`FAIL ${name} ${extra}`); }
};
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

function client(token) {
  const call = async (method, path, body, raw) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(token.t ? { authorization: `Bearer ${token.t}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 500) fives.push(`${method} ${path} -> ${res.status}`);
    if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return {
    get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: (p) => call('GET', p, undefined, true), token,
  };
}
const anon = client({});
async function login(email, password) {
  const r = await anon.post('/auth/login', { email, password });
  check(`login ${email}`, r.status === 200 && r.data.access_token, JSON.stringify(r.data));
  return client({ t: r.data.access_token });
}
const ok = (name, r, status = 200) => { check(name, r.status === status, `status=${r.status} ${JSON.stringify(r.data)?.slice(0, 220)}`); return r.data; };
const denied = (name, r, allowed = [401, 403, 404]) => check(name, allowed.includes(r.status), `status=${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`);
const invalid = (name, r) => check(name, r.status >= 400 && r.status < 500, `status=${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`);

// Der Stack läuft in Europe/Berlin; kurz nach Mitternacht weicht UTC davon ab
const dayAt = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(Date.now() + offset * 86400000));
const project = process.env.E2E_PROJECT || 'bm-e2e';
const psql = (sql) => execFileSync('docker', ['exec', `${project}-db-1`, 'psql', '-U', 'budget', '-d', 'budget', '-tA', '-c', sql]).toString().trim();
const runJob = (name) => execFileSync('docker', ['exec', `${project}-worker-1`, 'node', '--input-type=module', '-e', `const { runJob } = await import('/app/src/jobs.js'); await runJob('${name}', { info() {}, warn() {}, error(o, m) { console.error(m, o?.err?.message); process.exitCode = 1; } }); setTimeout(() => process.exit(process.exitCode || 0), 500);`], { stdio: 'pipe' });

// ---------- Basis, Header, Statik
for (const p of ['/health', '/ready', '/']) check(`static ${p}`, (await fetch(BASE + p)).status === 200);
// Versionierte Assets: neues HTML darf nie auf alte Dateien aus einem Cache treffen
const indexRes = await fetch(`${BASE}/`), indexText = await indexRes.text();
const assetBase = indexText.match(/src="(assets\/[0-9a-f]{12}\/)js\/app\.js"/)?.[1];
check('HTML verweist auf versionierte Assets', !!assetBase, indexText.slice(0, 300));
check('HTML ohne unversionierte Assets', !/(src|href)="(js|css)\//.test(indexText));
check('HTML wird immer neu geprüft', indexRes.headers.get('cache-control') === 'no-cache', indexRes.headers.get('cache-control'));
for (const p of ['js/app.js', 'js/theme.js', 'js/pages/sport.js', 'js/pages/spending.js', 'js/pages/privacy.js', 'js/pages/notes.js', 'js/pages/todos.js', 'js/pages/ticket-view.js', 'css/auth.css', 'favicon.svg']) {
  const res = await fetch(`${BASE}/${assetBase}${p}`);
  check(`Asset ${p}`, res.status === 200 && /immutable/.test(res.headers.get('cache-control') || ''), `${res.status} ${res.headers.get('cache-control')}`);
}
check('Fremde Asset-Version gibt es nicht', (await fetch(`${BASE}/assets/000000000000/js/app.js`)).status === 404);
check('Unversionierte Datei gibt es nicht', (await fetch(`${BASE}/js/app.js`)).status === 404);
check('Keine Dotfiles unter Assets', (await fetch(`${BASE}/${assetBase}.env`)).status === 404);
const rootHeaders = (await fetch(`${BASE}/`)).headers;
check('CSP-Header', /default-src/.test(rootHeaders.get('content-security-policy') || ''));
check('kein X-Powered-By', !rootHeaders.get('x-powered-by'));
denied('ohne Token /me', await anon.get('/me'), [401]);
denied('ohne Token /sport/routes', await anon.get('/sport/routes'), [401]);
denied('ohne Token /spending-budgets', await anon.get('/spending-budgets'), [401]);
denied('ohne Token /notes', await anon.get('/notes'), [401]);
denied('ohne Token /todos', await anon.get('/todos'), [401]);
denied('ohne Token Ticket löschen', await anon.del('/bug-reports/1'), [401]);
denied('Falsches Passwort', await anon.post('/auth/login', { email: 'admin@e2e.test', password: 'falsch' }), [400, 401]);
const pub = ok('public imprint', await anon.get('/public/imprint'));
check('Impressum hat neue Felder', 'country' in pub && 'website' in pub && 'supervisory' in pub && 'note' in pub, JSON.stringify(Object.keys(pub)));
const cfg = ok('auth config', await anon.get('/auth/config'));
check('auth config app_name', typeof cfg.app_name === 'string');

// ---------- Benutzer
const admin = await login('admin@e2e.test', 'E2e-Admin-Passw0rd!x');
const meAdmin = ok('admin me', await admin.get('/me'));
check('Admin hat admin:access', meAdmin.permissions.includes('admin:access'));
check('Gravatar standardmäßig aus', meAdmin.user.gravatar_enabled === false, String(meAdmin.user.gravatar_enabled));
const roles = ok('rollen', await admin.get('/admin/roles'));
const userRole = roles.roles.find((r) => r.name === 'User');
const mk = async (name) => {
  const email = `${name}@e2e.test`, password = `${name}-Sehr-Sicher-9931!`;
  const r = ok(`user ${name} anlegen`, await admin.post('/admin/users', { name, email, password, role_ids: [userRole.id] }));
  return { id: r.id, email, password };
};
const [uA, uB, uC, uD] = [await mk('alice'), await mk('bob'), await mk('carol'), await mk('dave')];
const alice = await login(uA.email, uA.password), bob = await login(uB.email, uB.password), carol = await login(uC.email, uC.password), dave = await login(uD.email, uD.password);
const meAlice = ok('alice me', await alice.get('/me'));
check('User hat kein admin:access', !meAlice.permissions.includes('admin:access'));
denied('User darf /admin/users nicht', await alice.get('/admin/users'));
denied('User darf /admin/audit nicht', await alice.get('/admin/audit'));
denied('User darf /admin/system nicht', await alice.get('/admin/system'));

// ---------- Teams
const team = ok('team', await alice.post('/teams', { name: 'E2E Team' }));
ok('bob editor', await alice.post(`/teams/${team.id}/members`, { email: uB.email, team_role: 'editor' }));
ok('carol viewer', await alice.post(`/teams/${team.id}/members`, { email: uC.email, team_role: 'viewer' }));
const teams = ok('teams', await bob.get('/teams'));
check('bob sieht Team', teams.some((t) => t.id === team.id), JSON.stringify(teams));

// ---------- Konten / Buchungen
const solo = ok('konto nur Name+Typ (neues Formular)', await alice.post('/budgets', { name: 'Giro', type: 'solo' }));
const shared = ok('geteiltes Konto', await alice.post('/budgets', { name: 'Haushalt', type: 'shared', team_id: team.id }));
ok('konto umbenennen (nur name)', await alice.patch(`/budgets/${solo.id}`, { name: 'Giro neu' }));
const cat = ok('kategorie', await alice.post(`/budgets/${solo.id}/categories`, { name: 'E2E-Essen', limit_amount: '100' }));
const budgets = ok('konten', await alice.get('/budgets'));
const giro = budgets.find((b) => b.id === solo.id);
check('Konto umbenannt', giro.name === 'Giro neu');
check('Konto hat Standardkategorien', giro.categories.length >= 2, String(giro.categories.length));
const tx1 = ok('einnahme', await alice.post('/transactions', { budget_id: solo.id, type: 'income', amount: '1000.50', booked_at: today, title: 'Lohn' }));
const tx2 = ok('ausgabe', await alice.post('/transactions', { budget_id: solo.id, category_id: cat.id, type: 'expense', amount: '30,25', booked_at: today, title: 'Markt <b>x</b>' }));
ok('ausgabe2', await alice.post('/transactions', { budget_id: shared.id, type: 'expense', amount: '10', booked_at: today, title: 'Team' }));
const after = (await alice.get('/budgets')).data.find((b) => b.id === solo.id);
check('Kontostand = Einnahmen-Ausgaben', after.balance === '970.25', JSON.stringify({ b: after.balance, i: after.income, e: after.expenses }));
check('Einkommen/Ausgaben im Konto', Number(after.income) === 1000.5 && Number(after.expenses) === 30.25);
ok('buchung ändern', await alice.patch(`/transactions/${tx2.id}`, { amount: '40' }));
check('Kontostand aktualisiert', (await alice.get('/budgets')).data.find((b) => b.id === solo.id).balance === '960.50');
const txs = ok('buchungen', await alice.get(`/transactions?budget_id=${solo.id}`));
check('Buchungsliste', (txs.items || txs).length === 2, JSON.stringify(txs).slice(0, 200));
const csv = await alice.raw('/transactions/export.csv');
check('CSV Export', csv.status === 200 && /csv/.test(csv.headers.get('content-type')));
{ const r = await bob.get(`/transactions?budget_id=${solo.id}`); check('IDOR: bob liest Solo-Buchung nicht', r.status !== 200 || r.data.items.length === 0, JSON.stringify(r.data)); }
denied('IDOR: bob bucht nicht auf Alice-Konto', await bob.post('/transactions', { budget_id: solo.id, type: 'expense', amount: '1', booked_at: today }));
denied('IDOR: bob ändert Alice-Buchung nicht', await bob.patch(`/transactions/${tx1.id}`, { amount: '1' }));
denied('Viewer bucht nicht aufs Team', await carol.post('/transactions', { budget_id: shared.id, type: 'expense', amount: '1', booked_at: today }));
ok('Editor bucht aufs Team', await bob.post('/transactions', { budget_id: shared.id, type: 'expense', amount: '5', booked_at: today }));
invalid('Betrag 0', await alice.post('/transactions', { budget_id: solo.id, type: 'expense', amount: '0', booked_at: today }));
invalid('Betrag Text', await alice.post('/transactions', { budget_id: solo.id, type: 'expense', amount: 'abc', booked_at: today }));
invalid('Datum ungültig', await alice.post('/transactions', { budget_id: solo.id, type: 'expense', amount: '1', booked_at: '2026-13-45' }));
invalid('Keine UUID in Pfad', await alice.patch('/transactions/abc', { amount: '1' }));

// ---------- Budgets (Ausgabenlimits)
const sb1 = ok('budget anlegen', await alice.post('/spending-budgets', { name: 'Essen Woche', limit_amount: 100, period_type: 'weekly', category_id: cat.id }));
const sb2 = ok('budget alle konten', await alice.post('/spending-budgets', { name: 'Gesamt Monat', limit_amount: 20, period_type: 'monthly' }));
for (const p of ['daily', 'yearly']) ok(`budget ${p}`, await alice.post('/spending-budgets', { name: p, limit_amount: 12.34, period_type: p, budget_id: solo.id }));
const sbs = ok('budgets liste', await alice.get('/spending-budgets'));
const wk = sbs.find((s) => s.id === sb1.id);
check('Budget zählt Kategorie-Ausgaben', Number(wk.used) === 40 && wk.remaining === '60.00' && wk.pct === 40, JSON.stringify(wk));
check('Budget löst Konto aus Kategorie auf', wk.budget_id === solo.id && wk.account_name === 'Giro neu' && wk.category_name === 'E2E-Essen', JSON.stringify(wk));
const all = sbs.find((s) => s.id === sb2.id);
check('Budget über alle Konten inkl. Team', Number(all.used) === 55, JSON.stringify(all.used));
check('Überschreitung negativ', all.remaining === '-35.00' && all.pct === 275, JSON.stringify(all));
check('Tageszeitraum heute', sbs.find((s) => s.name === 'daily').period_from === sbs.find((s) => s.name === 'daily').period_to);
ok('budget ändern', await alice.patch(`/spending-budgets/${sb2.id}`, { name: 'Gesamt', limit_amount: 500, period_type: 'yearly' }));
check('Änderung wirkt', (await alice.get('/spending-budgets')).data.find((s) => s.id === sb2.id).limit_amount === '500.00');
check('Bob sieht Alices Budgets nicht', (await bob.get('/spending-budgets')).data.length === 0);
denied('IDOR: Budget ändern', await bob.patch(`/spending-budgets/${sb2.id}`, { name: 'x', limit_amount: 1, period_type: 'daily' }));
denied('IDOR: Budget löschen', await bob.del(`/spending-budgets/${sb2.id}`));
denied('IDOR: Budget auf fremdes Konto', await bob.post('/spending-budgets', { name: 'x', limit_amount: 1, period_type: 'daily', budget_id: solo.id }));
denied('IDOR: Budget auf fremde Kategorie', await bob.post('/spending-budgets', { name: 'x', limit_amount: 1, period_type: 'daily', category_id: cat.id }));
invalid('Kategorie passt nicht zum Konto', await alice.post('/spending-budgets', { name: 'x', limit_amount: 1, period_type: 'daily', category_id: cat.id, budget_id: shared.id }));
invalid('Budget Limit 0', await alice.post('/spending-budgets', { name: 'x', limit_amount: 0, period_type: 'daily' }));
invalid('Budget falscher Zeitraum', await alice.post('/spending-budgets', { name: 'x', limit_amount: 1, period_type: 'custom' }));
invalid('Budget unbekannte Kategorie', await alice.post('/spending-budgets', { name: 'x', limit_amount: 1, period_type: 'daily', category_id: '00000000-0000-4000-8000-000000000000' }));
invalid('Budget PATCH keine UUID', await alice.patch('/spending-budgets/abc', { name: 'x', limit_amount: 1, period_type: 'daily' }));
invalid('Budget DELETE keine UUID', await alice.del('/spending-budgets/abc'));
ok('budget löschen', await alice.del(`/spending-budgets/${sb1.id}`));

// ---------- Sport
const route = ok('Strecke (Owner)', await alice.post('/sport/routes', { team_id: team.id, sport_type: 'run', name: 'Stadtpark', checkpoints: 5, distance_km: 7.25, notes: 'n' }));
const swim = ok('Strecke (Editor)', await bob.post('/sport/routes', { team_id: team.id, sport_type: 'swim', name: 'See' }));
ok('Strecke bike', await alice.post('/sport/routes', { team_id: team.id, sport_type: 'bike', name: 'Berg', checkpoints: 1 }));
denied('Viewer legt keine Strecke an', await carol.post('/sport/routes', { team_id: team.id, sport_type: 'run', name: 'x' }));
denied('Fremder legt keine Strecke an', await dave.post('/sport/routes', { team_id: team.id, sport_type: 'run', name: 'x' }));
check('Fremder sieht keine Strecken', (await dave.get('/sport/routes')).data.length === 0);
ok('Score alice', await alice.post(`/sport/routes/${route.id}/scores`, { score: 10.5, duration_seconds: 600, checkpoints_reached: 5, achieved_on: today }));
const scoreBob = ok('Score bob', await bob.post(`/sport/routes/${route.id}/scores`, { score: 20, checkpoints_reached: 4 }));
const scoreCarol = ok('Score Viewer erlaubt', await carol.post(`/sport/routes/${route.id}/scores`, { score: 5 }));
denied('Fremder trägt keinen Score ein', await dave.post(`/sport/routes/${route.id}/scores`, { score: 1 }));
invalid('Zu viele Checkpoints', await bob.post(`/sport/routes/${route.id}/scores`, { score: 1, checkpoints_reached: 6 }));
invalid('Negativer Score', await bob.post(`/sport/routes/${route.id}/scores`, { score: -1 }));
invalid('Score ungültiges Datum', await bob.post(`/sport/routes/${route.id}/scores`, { score: 1, achieved_on: '2026-13-45' }));
invalid('Strecke keine UUID', await bob.post('/sport/routes/abc/scores', { score: 1 }));
invalid('Strecke DELETE keine UUID', await bob.del('/sport/routes/abc'));
invalid('Score DELETE keine UUID', await bob.del('/sport/scores/abc'));
invalid('Filter falscher Typ', await bob.get('/sport/routes?sport_type=ski'));
const runs = ok('Bestenliste', await carol.get('/sport/routes?sport_type=run'));
check('Filter nach Sportart', runs.length === 1 && runs[0].id === route.id, JSON.stringify(runs.map((r) => r.name)));
check('Rangfolge absteigend', runs[0].scores.map((s) => Number(s.score)).join() === '20,10.50,5'.replace('10.50', '10.5'), JSON.stringify(runs[0].scores.map((s) => s.score)));
check('Kennzahlen', runs[0].attempts === 3 && runs[0].participants === 3 && Number(runs[0].best_score) === 20);
ok('Strecke ändern', await bob.patch(`/sport/routes/${route.id}`, { name: 'Stadtpark 2', checkpoints: 6, distance_km: null, notes: '' }));
denied('Viewer ändert Strecke nicht', await carol.patch(`/sport/routes/${route.id}`, { name: 'x', checkpoints: 0, notes: '' }));
denied('Viewer löscht fremden Score nicht', await carol.del(`/sport/scores/${scoreBob.id}`));
ok('Viewer löscht eigenen Score', await carol.del(`/sport/scores/${scoreCarol.id}`));
denied('Fremder löscht Score nicht', await dave.del(`/sport/scores/${scoreBob.id}`));
denied('Viewer löscht Strecke nicht', await carol.del(`/sport/routes/${swim.id}`));
denied('Fremder löscht Strecke nicht', await dave.del(`/sport/routes/${swim.id}`));
ok('Editor löscht Strecke', await bob.del(`/sport/routes/${swim.id}`));

// ---------- Daueraufträge
const rec = ok('Dauerauftrag', await alice.post('/recurring', { name: 'Miete', budget_id: solo.id, type: 'expense', amount: '500', frequency: 'monthly', interval: 1, start_date: `${month}-01` }));
ok('alle Rhythmen', await alice.post('/recurring', { name: 'Custom', budget_id: solo.id, type: 'expense', amount: '1', frequency: 'custom', interval: 10, start_date: '2030-01-01' }));
ok('Pausieren', await alice.patch(`/recurring/${rec.id}`, { active: false }));
const recs = ok('Liste', await alice.get('/recurring'));
check('Dauerauftrag pausiert', recs.find((r) => r.id === rec.id).active === false);
denied('IDOR Dauerauftrag', await bob.patch(`/recurring/${rec.id}`, { active: true }));
ok('Teilen-Kandidaten', await alice.get('/recurring/share-candidates'));
ok('Share-Requests', await bob.get('/recurring/share-requests'));

// ---------- Sparziele
const goal = ok('Sparziel', await alice.post('/goals', { budget_id: solo.id, name: 'Urlaub', target_amount: '1000', target_date: '2030-01-01', installment_amount: '50' }));
ok('Einzahlung', await alice.post('/transactions', { budget_id: solo.id, type: 'deposit', amount: '50', booked_at: today, goal_id: goal.id }));
check('Sparziel-Fortschritt', Number((await alice.get('/goals')).data.find((g) => g.id === goal.id).saved) === 50);
denied('IDOR Sparziel', await bob.patch(`/goals/${goal.id}`, { name: 'x' }));

// ---------- Saldo: nur was wirklich auf dem Konto ist
const balanceNow = async () => (await alice.get('/budgets')).data.find((b) => b.id === solo.id).balance;
const saldoNow = async () => Number((await alice.get(`/stats/overview?budget_id=${solo.id}`)).data.saldo);
const b0 = await balanceNow();
check('Sparziel-Einzahlung ändert den Kontostand nicht', b0 === '960.50', b0);
check('Dashboard-Saldo gleich Kontostand', (await saldoNow()) === Number(b0), String(await saldoNow()));
const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
ok('Buchung in der Zukunft', await alice.post('/transactions', { budget_id: solo.id, type: 'expense', amount: '7', booked_at: future, title: 'Zukunft Test' }));
check('Zukunft ändert Kontostand nicht', (await balanceNow()) === b0, await balanceNow());
check('Zukunft ändert Dashboard-Saldo nicht', (await saldoNow()) === Number(b0));
check('Transaktionsliste zeigt Zukunft', (await alice.get(`/transactions?budget_id=${solo.id}`)).data.items.some((t) => t.title === 'Zukunft Test'));
check('Filter to blendet Zukunft aus', !(await alice.get(`/transactions?budget_id=${solo.id}&to=${today}`)).data.items.some((t) => t.title === 'Zukunft Test'));
const tlAll = (await alice.get(`/stats/timeline?budget_id=${solo.id}&months=2`)).data, tlNow = (await alice.get(`/stats/timeline?budget_id=${solo.id}&months=2&to=${today}`)).data;
const sumExp = (rows) => rows.reduce((n, r) => n + Number(r.expense), 0);
check('Cashflow mit to ohne Zukunft', sumExp(tlNow) === 40, String(sumExp(tlNow)));
check('Bericht-Cashflow ohne to unverändert', future.slice(0, 7) !== today.slice(0, 7) || sumExp(tlAll) === 47, String(sumExp(tlAll)));
// Dashboard-Ansichten: Tag und Woche
const tlDay = ok('Cashflow nach Tagen', await alice.get(`/stats/timeline?budget_id=${solo.id}&granularity=day&periods=14&to=${today}`));
check('Tagesansicht hat 14 Punkte bis heute', tlDay.length === 14 && tlDay.at(-1).bucket === today, JSON.stringify(tlDay.at(-1)));
check('Tagesansicht ohne Zukunft', sumExp(tlDay) === 40, String(sumExp(tlDay)));
check('Heutige Ausgabe am heutigen Tag', Number(tlDay.at(-1).expense) === 40, JSON.stringify(tlDay.at(-1)));
const tlWeek = ok('Cashflow nach Wochen', await alice.get(`/stats/timeline?budget_id=${solo.id}&granularity=week&periods=8&week_start=1&to=${today}`));
check('Wochenansicht hat 8 Punkte', tlWeek.length === 8, String(tlWeek.length));
check('Woche beginnt am Montag', tlWeek.every((row) => new Date(`${row.bucket}T00:00:00Z`).getUTCDay() === 1), tlWeek[0].bucket);
check('Wochenansicht ohne Zukunft', sumExp(tlWeek) === 40, String(sumExp(tlWeek)));
const tlSun = ok('Woche ab Sonntag', await alice.get(`/stats/timeline?granularity=week&periods=2&week_start=0&to=${today}`));
check('Woche beginnt am Sonntag', tlSun.every((row) => new Date(`${row.bucket}T00:00:00Z`).getUTCDay() === 0), tlSun[0].bucket);
const tlFuture = (await alice.get(`/stats/timeline?budget_id=${solo.id}&granularity=day&periods=14&to=${future}`)).data;
check('Zukunft zählt nur mit späterem to', sumExp(tlFuture) === 47, String(sumExp(tlFuture)));
check('Monatsansicht bleibt nach Monaten', (await alice.get('/stats/timeline?months=2')).data.every((row) => /^\d{4}-\d{2}$/.test(row.month)));
const dayKpi = ok('KPI eines Tages', await alice.get(`/stats/overview?budget_id=${solo.id}&from=${today}&to=${today}`));
check('KPI eines Tages stimmt', Number(dayKpi.expense) === 40, dayKpi.expense);
invalid('Unbekannte Granularität', await alice.get('/stats/timeline?granularity=stunde'));
invalid('Zu viele Perioden', await alice.get('/stats/timeline?granularity=day&periods=500'));
invalid('Wochenstart ungültig', await alice.get('/stats/timeline?granularity=week&week_start=5'));
invalid('Datum ungültig (Cashflow)', await alice.get('/stats/timeline?granularity=day&to=2026-13-45'));
invalid('Datum nicht vorhanden (Cashflow)', await alice.get('/stats/timeline?granularity=week&to=2026-02-31'));
check('Fremde sehen keinen Cashflow', sumExp((await dave.get(`/stats/timeline?budget_id=${solo.id}&granularity=day`)).data) === 0);

// ---------- Statistik / Berichte
for (const p of ['/stats/overview', '/stats/by-category', '/stats/timeline', '/stats/overview?scope=solo', '/stats/overview?scope=shared', '/reports/costs', '/reports/saved', '/notifications', '/me/sessions', '/me/notification-prefs', '/me/api-keys', '/integrations', '/assets/overview', '/assets/costs', '/assets/log']) ok(`GET ${p}`, await alice.get(p));
const saved = ok('Geplanter Bericht', await alice.post('/reports/saved', { kind: 'monthly', rhythm: 'monthly', recipients: [] }));
ok('Bericht löschen', await alice.del(`/reports/saved/${saved.id}`));

// ---------- Zeiterfassung & Gehalt
// Neue Konten übernehmen die Profilwährung, sonst wären sie nie als Gehaltskonto wählbar
ok('Profil auf CHF', await dave.patch('/me', { currency: 'CHF' }));
const daveAccount = ok('Konto ohne Währung', await dave.post('/budgets', { name: 'Franken', type: 'solo' }));
check('Neues Konto hat Profilwährung', (await dave.get('/budgets')).data.find((row) => row.id === daveAccount.id)?.currency === 'CHF');
ok('Gehaltskonto in Profilwährung wählbar', await dave.patch('/me', { payroll_budget_id: daveAccount.id }));
const daveEuro = ok('Konto mit fester Währung', await dave.post('/budgets', { name: 'Euro', type: 'solo', currency: 'EUR' }));
check('Angegebene Währung bleibt', (await dave.get('/budgets')).data.find((row) => row.id === daveEuro.id)?.currency === 'EUR');
invalid('Gehaltskonto in anderer Währung abgelehnt', await dave.patch('/me', { payroll_budget_id: daveEuro.id }));
invalid('Team-Konto als Gehaltskonto abgelehnt', await alice.patch('/me', { payroll_budget_id: shared.id }));
invalid('Fremdes Konto als Gehaltskonto abgelehnt', await dave.patch('/me', { payroll_budget_id: solo.id }));
ok('Gehaltskonto entfernen', await dave.patch('/me', { payroll_budget_id: null }));
ok('Profil zurück auf EUR', await dave.patch('/me', { currency: 'EUR' }));
ok('Testkonto löschen', await dave.del(`/budgets/${daveAccount.id}`));
ok('Testkonto 2 löschen', await dave.del(`/budgets/${daveEuro.id}`));
ok('Profil Gehalt', await alice.patch('/me', { weekly_work_hours: 7, daily_salary: 10, hourly_bonus_percent: 25, payroll_budget_id: solo.id }));
invalid('Gehaltskonto bleibt in Profilwährung', await alice.patch(`/budgets/${solo.id}`, { currency: 'USD' }));
const otherAccount = ok('Konto zum Umstellen', await alice.post('/budgets', { name: 'Reisekasse', type: 'solo' }));
ok('Währung eines anderen Kontos ändern', await alice.patch(`/budgets/${otherAccount.id}`, { currency: 'CHF' }));
check('Währung geändert', (await alice.get('/budgets')).data.find((row) => row.id === otherAccount.id).currency === 'CHF');
ok('Konto zum Umstellen löschen', await alice.del(`/budgets/${otherAccount.id}`));
const proj = ok('Projekt privat', await alice.post('/work-projects', { name: 'P1' }));
const teamProj = ok('Projekt Team', await alice.post('/work-projects', { name: 'P2', team_id: team.id }));
const we = ok('Eintrag', await alice.post('/work-hours', { work_date: today, hours: 3.5, note: 'x', started_at: '08:00', ended_at: '12:00', break_minutes: 30 }));
ok('Projekteintrag', await alice.post('/work-hours', { work_date: today, hours: 1, project_id: proj.id }));
ok('Eintrag ändern', await alice.patch(`/work-hours/${we.id}`, { hours: 4 }));
invalid('Stunden > 24', await alice.post('/work-hours', { work_date: today, hours: 25 }));
invalid('Datum ungültig (Stunden)', await alice.post('/work-hours', { work_date: '2026-13-45', hours: 1 }));
ok('Timer Start', await alice.post('/work-hours/timer/start', {}));
invalid('Timer doppelt', await alice.post('/work-hours/timer/start', {}));
ok('Timer Pause', await alice.post('/work-hours/timer/pause', {}));
ok('Timer Weiter', await alice.post('/work-hours/timer/resume', {}));
ok('Timer Status', await alice.get('/work-hours/timer'));
const stopped = await alice.post('/work-hours/timer/stop', {});
check('Timer Stopp (auch ohne Mindestdauer sauber)', stopped.status < 500, JSON.stringify(stopped));
const rep = ok('Monatsbericht', await alice.get(`/work-hours/monthly?month=${month}`));
check('Monatsbericht weekly_target', rep.weekly_target === 7, JSON.stringify(rep.weekly_target));
const pdf = await alice.raw(`/work-hours/monthly.pdf?month=${month}`);
check('Monats-PDF', pdf.status === 200 && pdf.buf.slice(0, 4).toString() === '%PDF', `status=${pdf.status}`);
check('Stunden CSV', (await alice.raw('/work-hours/export.csv')).status === 200);
const teamRep = ok('Team-Monat', await alice.get(`/work-hours/team/monthly?team_id=${team.id}&month=${month}`));
const tm = (teamRep.members || teamRep).find?.((m) => m.user_id === meAlice.user.id);
check('Team-Bericht weekly_target pro Mitglied', tm && tm.weekly_target === 7, JSON.stringify(tm)?.slice(0, 240));
denied('Viewer sieht Teamzeiten nicht', await carol.get(`/work-hours/team/monthly?team_id=${team.id}&month=${month}`));
denied('Fremder sieht Teamzeiten nicht', await dave.get(`/work-hours/team/monthly?team_id=${team.id}&month=${month}`));
ok('Editor setzt Mitarbeiter-Einstellung', await bob.patch(`/work-hours/team/${team.id}/members/${meAlice.user.id}/settings`, { daily_salary: 11 }));
denied('Viewer setzt Einstellung nicht', await carol.patch(`/work-hours/team/${team.id}/members/${meAlice.user.id}/settings`, { daily_salary: 1 }));
check('Bericht zeigt Bonus je Stunde', (await alice.get(`/work-hours/monthly?month=${month}`)).data.bonus_per_hour === '2.75');
denied('Editor löscht Teamprojekt nicht (nur Owner)', await bob.del(`/work-projects/${teamProj.id}`));
ok('Owner löscht Teamprojekt', await alice.del(`/work-projects/${teamProj.id}`));
denied('Fremder löscht Projekt nicht', await dave.del(`/work-projects/${proj.id}`));

// ---------- Gehaltslauf mit dem Beispiel des Auftraggebers, über den echten Worker-Job
// 1.669 pro Tag, 13 Stunden Wochen-Soll, 17 % vom Festgehalt je Stunde darüber (283,73)
const plusDays = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const mondayOfThisWeek = (() => { const value = new Date(`${dayAt(0)}T00:00:00Z`); return plusDays(dayAt(0), -((value.getUTCDay() + 6) % 7)); })();
const [week1, week2, week3] = [-21, -14, -7].map((days) => plusDays(mondayOfThisWeek, days));
const salaryAccount = ok('Gehaltskonto für das Beispiel', await bob.post('/budgets', { name: 'Gehalt Bob', type: 'solo' }));
ok('Gehalt laut Beispiel', await bob.patch('/me', { daily_salary: 1669, weekly_work_hours: 13, hourly_bonus_percent: 17, payroll_budget_id: salaryAccount.id }));
const salaryProfile = (await bob.get('/me')).data.user;
check('Profil liefert das neue Modell', Number(salaryProfile.daily_salary) === 1669 && Number(salaryProfile.hourly_bonus_percent) === 17 && !('hourly_rate' in salaryProfile), JSON.stringify(salaryProfile));
psql(`UPDATE users SET payroll_start_date='${week1}' WHERE id='${uB.id}'`);
const workedHours = {
  [week1]: 8, // Woche 1: Soll nicht erreicht
  [week2]: 8, [plusDays(week2, 1)]: 7, [plusDays(week2, 2)]: 1, // Woche 2: Soll am Dienstag erreicht
  [week3]: 2, [plusDays(week3, 1)]: 2, [plusDays(week3, 2)]: 2, [plusDays(week3, 3)]: 2, [plusDays(week3, 4)]: 2, [plusDays(week3, 5)]: 4, [plusDays(week3, 6)]: 2, // Woche 3: Soll am Samstag erreicht
};
for (const [work_date, hours] of Object.entries(workedHours)) ok(`Stunden ${work_date}`, await bob.post('/work-hours', { work_date, hours }));
runJob('payroll.run');
const salaryRows = () => psql(`SELECT payroll_date||'|'||base_amount||'|'||overtime_hours||'|'||overtime_pay FROM payroll_payments WHERE user_id='${uB.id}' ORDER BY payroll_date`).split('\n').map((line) => { const [date, base, hours, pay] = line.split('|'); return { date, base, hours: Number(hours), pay }; });
const paidBefore = salaryRows();
// Gebucht wird der Vortag ab 03:45 Uhr; davor erst bis vorgestern
const berlinTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const payrollLastDay = berlinTime >= '03:45' ? dayAt(-1) : dayAt(-2);
const expectedDays = Math.round((Date.parse(`${payrollLastDay}T00:00:00Z`) - Date.parse(`${week1}T00:00:00Z`)) / 86400000) + 1;
check('Für jeden Tag genau eine Zahlung', paidBefore.length === expectedDays, `${paidBefore.length} statt ${expectedDays}`);
check('Festgehalt jeden Tag 1.669', paidBefore.every((row) => row.base === '1669.00'), JSON.stringify(paidBefore.filter((row) => row.base !== '1669.00')));
const bonusIn = (monday) => paidBefore.filter((row) => row.date >= monday && row.date <= plusDays(monday, 6) && row.hours > 0).map((row) => `${row.date}:${row.hours}:${row.pay}`).join();
check('Woche 1: Soll verfehlt, kein Bonus', bonusIn(week1) === '', bonusIn(week1));
check('Woche 2: Bonus ab Dienstag', bonusIn(week2) === `${plusDays(week2, 1)}:2:567.46,${plusDays(week2, 2)}:1:283.73`, bonusIn(week2));
check('Woche 3: nur Rest Samstag und Sonntag', bonusIn(week3) === `${plusDays(week3, 5)}:1:283.73,${plusDays(week3, 6)}:2:567.46`, bonusIn(week3));
check('Montag beginnt neu', bonusIn(mondayOfThisWeek) === '', bonusIn(mondayOfThisWeek));
const expectedSalary = expectedDays * 1669 + 567.46 + 283.73 + 283.73 + 567.46;
check('Kontostand stimmt auf den Cent', (await bob.get('/budgets')).data.find((row) => row.id === salaryAccount.id).balance === expectedSalary.toFixed(2), `${(await bob.get('/budgets')).data.find((row) => row.id === salaryAccount.id).balance} statt ${expectedSalary.toFixed(2)}`);
const salaryBookings = (await bob.get(`/transactions?budget_id=${salaryAccount.id}&limit=100`)).data.items;
check('Buchungstexte', salaryBookings.some((row) => row.title === 'Festgehalt und Bonus' && /567\.46 EUR Bonus für 2 Stunden/.test(row.note)) && salaryBookings.some((row) => row.title === 'Festgehalt'), JSON.stringify(salaryBookings[0]));
check('Bonus-Buchung im Betrag', salaryBookings.some((row) => Number(row.amount) === 1952.73));
runJob('payroll.run');
check('Zweiter Lauf zahlt nichts doppelt', salaryRows().length === expectedDays);
ok('Stunden nachtragen', await bob.post('/work-hours', { work_date: week1, hours: 20 }));
runJob('payroll.run');
check('Abgeschlossene Woche wird nicht nachberechnet', JSON.stringify(salaryRows()) === JSON.stringify(paidBefore));
const salaryMonth = ok('Monatsbericht mit Gehalt', await bob.get(`/work-hours/monthly?month=${plusDays(week2, 1).slice(0, 7)}`));
check('Bericht nennt Bonus je Stunde', salaryMonth.bonus_per_hour === '283.73' && salaryMonth.daily_salary === 1669, JSON.stringify(salaryMonth.bonus_per_hour));
const salaryPdf = await bob.raw(`/work-hours/monthly.pdf?month=${plusDays(week2, 1).slice(0, 7)}`);
check('Monats-PDF mit Gehalt', salaryPdf.status === 200 && salaryPdf.buf.slice(0, 4).toString() === '%PDF');
invalid('Festgehalt negativ', await bob.patch('/me', { daily_salary: -1 }));
invalid('Bonus zu hoch', await bob.patch('/me', { hourly_bonus_percent: 1001 }));
invalid('Festgehalt mit drei Nachkommastellen', await bob.patch('/me', { daily_salary: 1.234 }));
// ---------- Nachtschicht: Stunden zählen an dem Kalendertag, an dem sie gearbeitet wurden
const nightDate = dayAt(-3);
const nightEntry = ok('Manuelle Nachtschicht', await bob.post('/work-hours', { work_date: nightDate, hours: 4, started_at: '22:00', ended_at: '02:00', break_minutes: 30, note: 'Nacht E2E' }));
check('Nachtschicht wird auf zwei Tage aufgeteilt', nightEntry.entries === 2, JSON.stringify(nightEntry));
const nightRows = () => psql(`SELECT work_date||'|'||hours||'|'||started_at||'|'||ended_at||'|'||break_minutes FROM work_entries WHERE user_id='${uB.id}' AND note='Nacht E2E' ORDER BY work_date, started_at`);
check('Ein Eintrag je Kalendertag', nightRows() === `${nightDate}|2.00|22:00:00|00:00:00|15\n${plusDays(nightDate, 1)}|2.00|00:00:00|02:00:00|15`, nightRows());
const untilMidnight = ok('Schicht bis Mitternacht', await bob.post('/work-hours', { work_date: nightDate, hours: 2, started_at: '22:00', ended_at: '00:00' }));
check('Bis Mitternacht bleibt ein Eintrag', untilMidnight.entries === 1, JSON.stringify(untilMidnight));
invalid('Uhrzeit 25:00', await bob.post('/work-hours', { work_date: nightDate, hours: 1, started_at: '25:00' }));
const dayShift = ok('Tagesschicht', await bob.post('/work-hours', { work_date: nightDate, hours: 3, started_at: '10:00', ended_at: '13:00', note: 'Umbau E2E' }));
const movedShift = ok('Tagesschicht auf Nacht ändern', await bob.patch(`/work-hours/${dayShift.id}`, { started_at: '23:00', ended_at: '02:00' }));
check('Bearbeiten teilt an Mitternacht', movedShift.entries === 2, JSON.stringify(movedShift));
const movedRows = psql(`SELECT work_date||'|'||hours FROM work_entries WHERE user_id='${uB.id}' AND note='Umbau E2E' ORDER BY work_date`);
check('Bearbeitete Schicht: 1 + 2 Stunden', movedRows === `${nightDate}|1.00\n${plusDays(nightDate, 1)}|2.00`, movedRows);
// Älterer Eintrag über Mitternacht (vor der Regel): Notiz ändern teilt ihn nicht, sonst wanderten Stunden in eine andere Woche
const legacyId = psql(`INSERT INTO work_entries(user_id, work_date, hours, started_at, ended_at, note) VALUES ('${uB.id}', '${plusDays(nightDate, -7)}', 4, '22:00', '02:00', 'Alt E2E') RETURNING id`).split('\n')[0];
const legacyEdit = ok('Notiz eines alten Nacht-Eintrags ändern', await bob.patch(`/work-hours/${legacyId}`, { work_date: plusDays(nightDate, -7), hours: 4, started_at: '22:00', ended_at: '02:00', break_minutes: 0, note: 'Alt E2E geändert' }));
check('Alter Eintrag bleibt ungeteilt', legacyEdit.entries === 1 && psql(`SELECT count(*)||'|'||sum(hours) FROM work_entries WHERE user_id='${uB.id}' AND note LIKE 'Alt E2E%'`) === '1|4.00', JSON.stringify(legacyEdit));

// Timer über Mitternacht: Start gestern 23:30 Uhr Ortszeit, direkt in der Datenbank zurückgesetzt
const setTimerStart = (sql) => psql(`UPDATE work_timers SET started_at=${sql} WHERE user_id='${uB.id}'`);
const yesterdayPaid = () => psql(`SELECT count(*) FROM payroll_payments WHERE user_id='${uB.id}' AND payroll_date='${dayAt(-1)}'`);
ok('Timer für die Nacht', await bob.post('/work-hours/timer/start', { note: 'Timer E2E' }));
setTimerStart(`('${dayAt(-1)} 23:30'::timestamp AT TIME ZONE 'Europe/Berlin')`);
// Prüfbar nur, wenn der Vortag schon fällig ist (ab 03:45) und der Timer noch als offene Schicht gilt (jünger als 24 Stunden)
if (berlinTime >= '03:45' && berlinTime < '23:00') {
  psql(`DELETE FROM transactions WHERE id IN (SELECT transaction_id FROM payroll_payments WHERE user_id='${uB.id}' AND payroll_date='${dayAt(-1)}')`);
  psql(`DELETE FROM payroll_payments WHERE user_id='${uB.id}' AND payroll_date='${dayAt(-1)}'`);
  runJob('payroll.run');
  check('Gehaltslauf wartet auf das Ausstempeln', yesterdayPaid() === '0', yesterdayPaid());
}
const timerStop = ok('Ausstempeln nach Mitternacht', await bob.post('/work-hours/timer/stop'));
check('Timer legt je Kalendertag einen Eintrag an', timerStop.entries === 2, JSON.stringify(timerStop));
const timerRows = psql(`SELECT work_date||'|'||started_at||'|'||ended_at FROM work_entries WHERE user_id='${uB.id}' AND note='Timer E2E' ORDER BY work_date`).split('\n');
check('Timer-Teil vor Mitternacht', timerRows[0] === `${dayAt(-1)}|23:30:00|00:00:00`, timerRows.join(' / '));
check('Timer-Teil nach Mitternacht', timerRows[1]?.startsWith(`${dayAt(0)}|00:00:00|`), timerRows.join(' / '));
if (berlinTime >= '03:45' && berlinTime < '23:00') {
  runJob('payroll.run');
  check('Nach dem Ausstempeln wird der Vortag gebucht', yesterdayPaid() === '1', yesterdayPaid());
}
// Vergessener Timer: länger als 24 Stunden lässt er sich nicht stoppen, aber verwerfen
ok('Timer vergessen', await bob.post('/work-hours/timer/start', { note: 'Vergessen E2E' }));
setTimerStart("now() - interval '25 hours'");
const tooLong = await bob.post('/work-hours/timer/stop');
check('Timer über 24 Stunden wird abgelehnt', tooLong.status === 400 && /24 Stunden/.test(tooLong.data?.message), JSON.stringify(tooLong.data));
denied('Fremder verwirft keinen Timer', await dave.del('/work-hours/timer'), [400]);
ok('Timer verwerfen', await bob.del('/work-hours/timer'));
check('Verwerfen legt keinen Eintrag an', psql(`SELECT count(*) FROM work_entries WHERE user_id='${uB.id}' AND note='Vergessen E2E'`) === '0');
invalid('Ohne Timer nichts zu verwerfen', await bob.del('/work-hours/timer'));

ok('Gehaltskonto von Bob lösen', await bob.patch('/me', { payroll_budget_id: null }));

// ---------- Objekte
const person = ok('Person', await alice.post('/people', { name: 'Hans', kind: 'employee', email: '' }));
const house = ok('Haus', await alice.post('/properties', { name: 'Haus A', address: 'Weg 1', cost_amount: '100', cost_interval: 'monthly', cost_budget_id: solo.id, cost_tracking: true }));
const car = ok('Fahrzeug', await alice.post('/vehicles', { plate: 'E2E-1', make_model: 'VW', service_due: '2026-01-01', first_aid_kit_expires_on: '2026-02-01' }));
const key = ok('Schlüssel', await alice.post('/keys', { code: 'K1', label: 'Haustür', kind: 'Haustür', property_id: house.id, copies: 2 }));
invalid('Schlüssel ohne Objekt', await alice.post('/keys', { code: 'K2', label: 'x' }));
const costs = ok('Kosten', await alice.get('/assets/costs'));
check('Objektkosten erscheinen', costs.items.length === 1, JSON.stringify(costs.items));
const recAsset = (await alice.get('/recurring')).data.find((r) => r.asset_id === house.id);
check('Objektkosten erzeugen Dauerauftrag', !!recAsset);
ok('Preisänderung', await alice.patch(`/properties/${house.id}`, { cost_amount: '150' }));
const recs2 = (await alice.get('/recurring')).data.filter((r) => r.asset_id === house.id);
check('Keine Duplikate bei Preisänderung', recs2.length === 1 && Number(recs2[0].amount) === 150, JSON.stringify(recs2.map((r) => r.amount)));
const a1 = ok('Ausgabe', await alice.post(`/keys/${key.id}/assign`, { person_id: person.id, due_at: '2020-01-01' }));
const a2 = ok('Ausgabe 2', await alice.post(`/keys/${key.id}/assign`, { person_id: person.id }));
invalid('Keine weitere Kopie', await alice.post(`/keys/${key.id}/assign`, { person_id: person.id }));
denied('IDOR Rückgabe', await bob.post(`/assignments/${a1.id}/return`, {}));
ok('Rückgabe', await alice.post(`/assignments/${a1.id}/return`, {}));
ok('Verloren', await alice.post(`/assignments/${a2.id}/lost`, {}));
const qr = await alice.raw(`/keys/${key.id}/qr`);
check('QR', qr.status === 200 && JSON.parse(qr.buf).image.startsWith('data:image/png'));
denied('IDOR QR', await bob.get(`/keys/${key.id}/qr`));
const log = ok('Protokoll', await alice.get('/assets/log'));
check('Protokoll enthält Vorgänge', log.length >= 2);
denied('IDOR Schlüssel', await bob.patch(`/keys/${key.id}`, { label: 'x' }));
denied('IDOR Haus', await bob.patch(`/properties/${house.id}`, { name: 'x' }));
ok('Objekt privat→Team', await alice.patch(`/vehicles/${car.id}`, { scope: 'team', team_id: team.id }));
check('Team sieht Fahrzeug', (await carol.get('/vehicles')).data.some((v) => v.id === car.id));
denied('Viewer ändert Teamobjekt nicht', await carol.patch(`/vehicles/${car.id}`, { make_model: 'x' }));
// Die Oberfläche blendet Aktionen anhand der Rolle aus, dazu muss sie in den Listen stehen
const roleOf = async (who, path, itemId) => (await who.get(path)).data.find((row) => row.id === itemId)?.role;
check('Rolle in der Liste: Viewer', (await roleOf(carol, '/vehicles', car.id)) === 'viewer');
check('Rolle in der Liste: Editor', (await roleOf(bob, '/vehicles', car.id)) === 'editor');
check('Rolle in der Liste: Team-Owner', (await roleOf(alice, '/vehicles', car.id)) === 'owner');
check('Rolle in der Liste: privat', (await roleOf(alice, '/properties', house.id)) === 'owner');
const teamPerson = ok('Team-Person', await alice.post('/people', { name: 'Teamer', scope: 'team', team_id: team.id }));
const teamKey = ok('Team-Schlüssel', await alice.post('/keys', { code: 'TK', label: 'Team-Tor', vehicle_id: car.id, scope: 'team', team_id: team.id, copies: 2 }));
check('Rolle bei Personen', (await roleOf(carol, '/people', teamPerson.id)) === 'viewer');
check('Rolle bei Schlüsseln', (await roleOf(carol, '/keys', teamKey.id)) === 'viewer');
const teamIssue = ok('Team-Schlüssel ausgeben', await alice.post(`/keys/${teamKey.id}/assign`, { person_id: teamPerson.id }));
denied('Viewer gibt nicht aus', await carol.post(`/keys/${teamKey.id}/assign`, { person_id: teamPerson.id }));
denied('Viewer nimmt nicht zurück', await carol.post(`/assignments/${teamIssue.id}/return`, {}));
denied('Viewer meldet nicht verloren', await carol.post(`/assignments/${teamIssue.id}/lost`, {}));
ok('Editor nimmt zurück', await bob.post(`/assignments/${teamIssue.id}/return`, {}));
// Teil-Updates lassen alles andere unverändert (Zod 4 setzt bei .partial() sonst Standardwerte)
ok('Schlüssel nur umbenennen', await alice.patch(`/keys/${teamKey.id}`, { label: 'Team-Tor 2' }));
const keptKey = (await alice.get('/keys')).data.find((row) => row.id === teamKey.id);
check('Schlüssel behält Kopien und Team', keptKey.copies === 2 && keptKey.team_id === team.id && keptKey.kind === 'Haustür', JSON.stringify(keptKey).slice(0, 200));
ok('Person nur umbenennen', await alice.patch(`/people/${teamPerson.id}`, { name: 'Teamer 2' }));
check('Person behält Team', (await alice.get('/people')).data.find((row) => row.id === teamPerson.id).team_id === team.id);
ok('Haus-Kosten bleiben bei Namensänderung', await alice.patch(`/properties/${house.id}`, { name: 'Haus A3' }));
check('Haus behält Kosten', Number((await alice.get('/properties')).data.find((row) => row.id === house.id).cost_amount) === 150);
check('Eintrag behält Notiz und Pause', (await alice.get(`/work-hours?from=${today}&to=${today}`)).data.items.some((row) => row.id === we.id && row.note === 'x' && row.break_minutes === 30));
const keepTx = ok('Buchung mit Details', await alice.post('/transactions', { budget_id: solo.id, type: 'income', income_kind: 'salary', amount: '1', booked_at: today, title: 'Behalten', note: 'Notiz', tags: ['a'] }));
ok('Buchung nur umbenennen', await alice.patch(`/transactions/${keepTx.id}`, { title: 'Behalten 2' }));
const keptTx = (await alice.get(`/transactions?q=Behalten`)).data.items[0];
check('Buchung behält Notiz, Tags und Art', keptTx.note === 'Notiz' && keptTx.tags.includes('a') && keptTx.income_kind === 'salary', JSON.stringify(keptTx));
ok('Testbuchung löschen', await alice.del(`/transactions/${keepTx.id}`));
const keepRule = ok('Dauerauftrag mit Abstand', await alice.post('/recurring', { name: 'Behalten', budget_id: solo.id, type: 'expense', amount: '5', frequency: 'weekly', interval: 3, start_date: future }));
ok('Dauerauftrag nur umbenennen', await alice.patch(`/recurring/${keepRule.id}`, { name: 'Behalten 2' }));
const keptRule = (await alice.get('/recurring')).data.find((row) => row.id === keepRule.id);
check('Dauerauftrag behält Abstand', keptRule.interval === 3 && keptRule.active === true, JSON.stringify(keptRule).slice(0, 200));
ok('Testauftrag löschen', await alice.del(`/recurring/${keepRule.id}`));
const keepGoal = ok('Sparziel mit Rhythmus', await alice.post('/goals', { budget_id: solo.id, name: 'Behalten', target_amount: '10', installment_frequency: 'weekly', installment_interval: 2 }));
ok('Sparziel nur umbenennen', await alice.patch(`/goals/${keepGoal.id}`, { name: 'Behalten 2' }));
const keptGoal = (await alice.get('/goals')).data.find((row) => row.id === keepGoal.id);
check('Sparziel behält Rhythmus', keptGoal.installment_frequency === 'weekly' && keptGoal.installment_interval === 2, JSON.stringify(keptGoal));
ok('Testziel löschen', await alice.del(`/goals/${keepGoal.id}`));
ok('Patch ohne scope mit team_id ignoriert', await alice.patch(`/properties/${house.id}`, { name: 'Haus A2', team_id: team.id }));
check('team_id ohne scope bleibt privat', !(await bob.get('/properties')).data.some((p) => p.id === house.id));
ok('Person Patch', await alice.patch(`/people/${person.id}`, { function: 'Chef' }));
// PIN
denied('PIN falsches Passwort', await alice.post(`/properties/${house.id}/pin`, { pin: '1234', password: 'falsch' }), [400, 401, 403]);
ok('PIN setzen', await alice.post(`/properties/${house.id}/pin`, { pin: '1234', password: uA.password }));
const reveal = ok('PIN lesen', await alice.post(`/properties/${house.id}/pin/reveal`, { password: uA.password }));
check('PIN Wert', reveal.pin === '1234', JSON.stringify(reveal));
denied('IDOR PIN', await bob.post(`/properties/${house.id}/pin/reveal`, { password: uB.password }));
check('PIN nie in Liste', !JSON.stringify((await alice.get('/properties')).data).includes('door_pin_enc'));

// ---------- Kalender
const ev = ok('Termin', await alice.post('/calendar/events', { title: 'T', type: 'personal', date: today, allDay: true, repeat: 'monthly', remind: '1d' }));
ok('Termin Team', await alice.post('/calendar/events', { title: 'TT', type: 'team', team_id: team.id, date: today, start: '10:00', end: '11:00' }));
const y = new Date().getFullYear();
const cal = ok('Kalender', await alice.get(`/calendar?from=${y}-01-01&to=${y}-12-31`));
const list = cal.events || cal;
check('Kalender eigene und Auto-Termine', list.some((e) => e.source === 'own') && list.some((e) => e.source !== 'own'), JSON.stringify([...new Set(list.map((e) => e.source))]));
const evId = String(ev.id).replace(/^own:/, '');
denied('IDOR Termin', await bob.del(`/calendar/events/${evId}`));
const ical = ok('iCal Token', await alice.post('/me/ical', {}));
const icsToken = ical.token || ical.url?.split('/').pop()?.replace('.ics', '');
const ics = await fetch(`${BASE}/api/calendar/ical/${icsToken}.ics`);
check('iCal Feed', ics.status === 200 && (await ics.text()).includes('BEGIN:VCALENDAR'), `status=${ics.status}`);
check('iCal falscher Token', (await fetch(`${BASE}/api/calendar/ical/falsch.ics`)).status === 404);
ok('Termin löschen', await alice.del(`/calendar/events/${evId}`));

// ---------- Konto / Einstellungen
const me2 = ok('Gravatar an', await alice.patch('/me', { gravatar_enabled: true, theme: 'dark', accent: 'ocean' }));
check('Gravatar gespeichert', me2.gravatar_enabled === true);
const exp = ok('DSGVO-Export', await alice.get('/me/export'));
check('Export enthält Daten', !!exp);
const k = ok('API-Key', await alice.post('/me/api-keys', { name: 'k', scope: 'read' }));
const keyVal = k.key || k.token || k.api_key;
if (keyVal) {
  const viaKey = await fetch(`${BASE}/api/budgets`, { headers: { authorization: `Bearer ${keyVal}` } });
  check('API-Key lesend', viaKey.status === 200, `status=${viaKey.status}`);
  const write = await fetch(`${BASE}/api/teams`, { method: 'POST', headers: { authorization: `Bearer ${keyVal}`, 'content-type': 'application/json' }, body: '{"name":"x"}' });
  check('Read-Key darf nicht schreiben', [401, 403].includes(write.status), `status=${write.status}`);
} else check('API-Key Wert', false, JSON.stringify(k));
const keyRow = (await alice.get('/me/api-keys')).data.find((row) => row.prefix === k.prefix); ok('Key löschen', await alice.del(`/me/api-keys/${keyRow.id}`));

// ---------- Tickets
const bug = ok('Ticket', await alice.post('/bug-reports', { title: 'Fehler im Test', description: 'Beschreibung mit mindestens zwanzig Zeichen.', steps: '' }));
check('Eigene Tickets', (await alice.get('/bug-reports')).data.items.length >= 1);
check('Bob sieht fremdes Ticket nicht', (await bob.get('/bug-reports')).data.items.length === 0);
denied('User sieht Admin-Tickets nicht', await alice.get('/admin/bug-reports'));
ok('Admin-Tickets', await admin.get('/admin/bug-reports'));
// Kommentare und Löschen
const unread = async (who, kind) => (await who.get('/notifications')).data.items.filter((item) => item.kind === kind).length;
const aliceTicketBefore = await unread(alice, 'ticket_comment');
const adminTicketBefore = await unread(admin, 'ticket_comment');
const adminComment = ok('Admin kommentiert', await admin.post(`/admin/bug-reports/${bug.id}/comments`, { body: 'Bitte <script>alert(1)</script> prüfen' }));
check('Melder wird benachrichtigt', (await unread(alice, 'ticket_comment')) === aliceTicketBefore + 1);
const reply = ok('Melder antwortet', await alice.post(`/bug-reports/${bug.id}/comments`, { body: 'Danke\nzweite Zeile' }));
check('Admin wird benachrichtigt', (await unread(admin, 'ticket_comment')) === adminTicketBefore + 1);
check('Eigener Kommentar löst keine Eigenbenachrichtigung aus', (await unread(alice, 'ticket_comment')) === aliceTicketBefore + 1);
const seen = (await alice.get('/bug-reports')).data.items.find((item) => String(item.id) === String(bug.id));
check('Melder sieht beide Kommentare mit Namen', seen.comments.length === 2 && seen.comments[1].user_name === 'alice', JSON.stringify(seen.comments).slice(0, 200));
check('Kommentar bleibt wörtlich', seen.comments[0].body.includes('<script>'), seen.comments[0].body);
check('Admin sieht Kommentare', (await admin.get('/admin/bug-reports')).data.items.find((item) => String(item.id) === String(bug.id)).comments.length === 2);
invalid('Leerer Kommentar', await alice.post(`/bug-reports/${bug.id}/comments`, { body: '   ' }));
invalid('Zu langer Kommentar', await alice.post(`/bug-reports/${bug.id}/comments`, { body: 'x'.repeat(5001) }));
invalid('Ticket-ID ungültig', await alice.post('/bug-reports/abc/comments', { body: 'x' }));
invalid('Kommentar-ID ungültig', await alice.del(`/bug-reports/${bug.id}/comments/abc`));
denied('Fremder kommentiert nicht', await bob.post(`/bug-reports/${bug.id}/comments`, { body: 'x' }));
denied('User nutzt Admin-Kommentar nicht', await bob.post(`/admin/bug-reports/${bug.id}/comments`, { body: 'x' }));
denied('Fremder löscht Kommentar nicht', await bob.del(`/bug-reports/${bug.id}/comments/${reply.id}`));
denied('Melder löscht Admin-Kommentar nicht', await alice.del(`/bug-reports/${bug.id}/comments/${adminComment.id}`));
ok('Melder löscht eigenen Kommentar', await alice.del(`/bug-reports/${bug.id}/comments/${reply.id}`));
ok('Admin löscht fremden Kommentar', await admin.del(`/admin/bug-reports/${bug.id}/comments/${adminComment.id}`));
denied('Kommentar ist weg', await admin.del(`/admin/bug-reports/${bug.id}/comments/${adminComment.id}`));
denied('Fremder löscht Ticket nicht', await bob.del(`/bug-reports/${bug.id}`));
denied('User löscht nicht über Admin-Pfad', await bob.del(`/admin/bug-reports/${bug.id}`));
const bug2 = ok('Ticket 2', await alice.post('/bug-reports', { title: 'Zweites Ticket', description: 'Beschreibung mit mindestens zwanzig Zeichen.', steps: '' }));
ok('Kommentar an Ticket 2', await alice.post(`/bug-reports/${bug2.id}/comments`, { body: 'wird mit gelöscht' }));
ok('Melder löscht eigenes Ticket', await alice.del(`/bug-reports/${bug2.id}`));
check('Ticket ist weg', !(await alice.get('/bug-reports')).data.items.some((item) => String(item.id) === String(bug2.id)));
denied('Gelöschtes Ticket nicht mehr kommentierbar', await alice.post(`/bug-reports/${bug2.id}/comments`, { body: 'x' }));
const bug3 = ok('Ticket 3', await bob.post('/bug-reports', { title: 'Drittes Ticket', description: 'Beschreibung mit mindestens zwanzig Zeichen.', steps: '' }));
ok('Admin löscht fremdes Ticket', await admin.del(`/admin/bug-reports/${bug3.id}`));
check('Löschen steht im Audit-Log', (await admin.get('/admin/audit?limit=20&q=ticket.deleted')).data.some((row) => row.action === 'ticket.deleted'));

// ---------- Notizblock
const fiveK = 'x'.repeat(50001);
const noteSolo = ok('Notiz solo', await alice.post('/notes', { title: 'Meine Notiz', body: 'Text <img src=x onerror=alert(1)>' }));
const noteTeam = ok('Notiz Team', await bob.post('/notes', { title: 'Team-Notiz', body: 'Für alle', team_id: team.id }));
const notesOf = async (who) => (await who.get('/notes')).data;
check('Eigene und Team-Notiz', (await notesOf(alice)).some((n) => n.id === noteSolo.id) && (await notesOf(alice)).some((n) => n.id === noteTeam.id));
check('Rolle in der Liste', (await notesOf(carol)).find((n) => n.id === noteTeam.id)?.role === 'viewer');
check('Viewer sieht fremde Solo-Notiz nicht', !(await notesOf(carol)).some((n) => n.id === noteSolo.id));
check('Fremder sieht nichts', !(await notesOf(dave)).some((n) => [noteSolo.id, noteTeam.id].includes(n.id)));
denied('IDOR Notiz ändern', await bob.patch(`/notes/${noteSolo.id}`, { title: 'x' }), [404]);
denied('IDOR Notiz löschen', await dave.del(`/notes/${noteSolo.id}`), [404]);
denied('Fremder ändert Team-Notiz nicht', await dave.patch(`/notes/${noteTeam.id}`, { title: 'x' }), [404]);
denied('Viewer ändert Team-Notiz nicht', await carol.patch(`/notes/${noteTeam.id}`, { title: 'x' }), [403]);
denied('Viewer löscht Team-Notiz nicht', await carol.del(`/notes/${noteTeam.id}`), [403]);
denied('Viewer legt keine Team-Notiz an', await carol.post('/notes', { title: 'x', team_id: team.id }), [403]);
denied('Fremder legt keine Team-Notiz an', await dave.post('/notes', { title: 'x', team_id: team.id }), [404]);
ok('Owner ändert Team-Notiz', await alice.patch(`/notes/${noteTeam.id}`, { body: 'Geändert von Alice' }));
check('Team sieht Änderung und Bearbeiter', (await notesOf(bob)).find((n) => n.id === noteTeam.id)?.updated_by_name === 'alice', JSON.stringify((await notesOf(bob)).find((n) => n.id === noteTeam.id)?.updated_by_name));
const beforePin = (await notesOf(alice)).find((n) => n.id === noteSolo.id);
ok('Notiz anheften', await alice.patch(`/notes/${noteSolo.id}`, { pinned: true }));
const afterPin = await notesOf(alice);
check('Angeheftet steht oben', afterPin[0].id === noteSolo.id && afterPin[0].pinned === true);
check('Anheften zählt nicht als Bearbeitung', afterPin[0].updated_at === beforePin.updated_at, `${beforePin.updated_at} ${afterPin[0].updated_at}`);
invalid('Notiz ohne Inhalt', await alice.post('/notes', { title: '  ', body: '  ' }));
invalid('Notiz leer machen', await alice.patch(`/notes/${noteSolo.id}`, { title: '', body: '' }));
invalid('Titel zu lang', await alice.post('/notes', { title: 'x'.repeat(151) }));
invalid('Text zu lang', await alice.post('/notes', { body: fiveK }));
invalid('Notiz-ID ungültig', await alice.patch('/notes/abc', { title: 'x' }));
invalid('Team-ID ungültig', await alice.post('/notes', { title: 'x', team_id: 'abc' }));
invalid('Null-Byte im Text', await alice.post('/notes', { title: 'a\u0000b' }));
denied('Notiz nicht vorhanden', await alice.patch('/notes/00000000-0000-4000-8000-000000000000', { title: 'x' }), [404]);
ok('Notiz privat→Team', await alice.patch(`/notes/${noteSolo.id}`, { team_id: team.id }));
check('Team sieht verschobene Notiz', (await notesOf(carol)).some((n) => n.id === noteSolo.id));
denied('Viewer verschiebt nicht', await carol.patch(`/notes/${noteSolo.id}`, { team_id: null }), [403]);
ok('Notiz Team→privat', await alice.patch(`/notes/${noteSolo.id}`, { team_id: null }));
check('Team sieht sie nicht mehr', !(await notesOf(bob)).some((n) => n.id === noteSolo.id));
check('Besitzerin behält sie', (await notesOf(alice)).find((n) => n.id === noteSolo.id)?.role === 'owner');
const noteExtra = ok('Notiz zum Löschen', await alice.post('/notes', { body: 'nur Text, kein Titel' }));
ok('Notiz löschen', await alice.del(`/notes/${noteExtra.id}`));
denied('Gelöschte Notiz ist weg', await alice.del(`/notes/${noteExtra.id}`), [404]);

// ---------- ToDos
const todosOf = async (who) => (await who.get('/todos')).data;
const todoSolo = ok('ToDo solo', await alice.post('/todos', { title: 'Steuer abgeben', due_date: dayAt(1), note: 'Belege' }));
const todoTeam = ok('ToDo Team', await bob.post('/todos', { title: 'Team-Aufgabe', due_date: dayAt(0), team_id: team.id }));
const todoFree = ok('ToDo ohne Deadline', await alice.post('/todos', { title: 'Irgendwann' }));
check('Team-ToDo für Team sichtbar', (await todosOf(carol)).find((t) => t.id === todoTeam.id)?.role === 'viewer');
check('Solo-ToDo nicht für Team sichtbar', !(await todosOf(bob)).some((t) => t.id === todoSolo.id));
check('Fremder sieht keine ToDos', !(await todosOf(dave)).some((t) => [todoSolo.id, todoTeam.id].includes(t.id)));
denied('IDOR ToDo ändern', await bob.patch(`/todos/${todoSolo.id}`, { title: 'x' }), [404]);
denied('IDOR ToDo löschen', await dave.del(`/todos/${todoSolo.id}`), [404]);
denied('Viewer hakt nicht ab', await carol.patch(`/todos/${todoTeam.id}`, { done: true }), [403]);
denied('Viewer löscht nicht', await carol.del(`/todos/${todoTeam.id}`), [403]);
denied('Viewer legt kein Team-ToDo an', await carol.post('/todos', { title: 'x', team_id: team.id }), [403]);
invalid('ToDo ohne Titel', await alice.post('/todos', { title: '   ' }));
invalid('ToDo Datum ungültig', await alice.post('/todos', { title: 'x', due_date: '2026-13-45' }));
invalid('ToDo Datum nicht vorhanden', await alice.post('/todos', { title: 'x', due_date: '2026-02-31' }));
invalid('ToDo Titel zu lang', await alice.post('/todos', { title: 'x'.repeat(201) }));
invalid('ToDo-ID ungültig', await alice.patch('/todos/abc', { done: true }));
ok('Editor ändert Team-ToDo', await bob.patch(`/todos/${todoTeam.id}`, { note: 'wichtig' }));
ok('Editor hakt ab', await bob.patch(`/todos/${todoTeam.id}`, { done: true }));
const doneRow = (await todosOf(alice)).find((t) => t.id === todoTeam.id);
check('Erledigt mit Name', doneRow.done_at && doneRow.done_by_name === 'bob', JSON.stringify(doneRow));
ok('Wieder öffnen', await alice.patch(`/todos/${todoTeam.id}`, { done: false }));
const reopened = (await todosOf(alice)).find((t) => t.id === todoTeam.id);
check('Geöffnet ohne Erledigt-Daten', !reopened.done_at && !reopened.done_by_name, JSON.stringify(reopened));
ok('Deadline entfernen', await alice.patch(`/todos/${todoFree.id}`, { title: 'Später' }));
check('Andere Felder bleiben', (await todosOf(alice)).find((t) => t.id === todoSolo.id).note === 'Belege');

// Deadline-Benachrichtigungen über den echten Worker-Job
const runTodoJob = () => runJob('todos.remind');
const dueNotes = async (who) => (await who.get('/notifications')).data.items.filter((item) => item.kind === 'todo_due');
const todoOverdue = ok('ToDo überfällig', await alice.post('/todos', { title: 'Überfällig', due_date: dayAt(-3) }));
const todoLater = ok('ToDo später', await alice.post('/todos', { title: 'Viel später', due_date: dayAt(30) }));
const todoDone = ok('ToDo erledigt mit Deadline', await alice.post('/todos', { title: 'Schon erledigt', due_date: dayAt(0) }));
ok('Abhaken vor dem Lauf', await alice.patch(`/todos/${todoDone.id}`, { done: true }));
ok('Carol schaltet ToDo-Glocke ab', await carol.put('/me/notification-prefs', [{ kind: 'todo_due', in_app: false, email: false }]));
runTodoJob();
const aliceDue = await dueNotes(alice);
check('Morgen fällig gemeldet', aliceDue.some((item) => item.title === 'ToDo morgen fällig: Steuer abgeben'), JSON.stringify(aliceDue.map((i) => i.title)));
check('Heute fällig gemeldet', aliceDue.some((item) => item.title === 'ToDo heute fällig: Team-Aufgabe'));
check('Überfällig gemeldet', aliceDue.some((item) => item.title === 'ToDo überfällig: Überfällig'));
check('Spätere Deadline noch nicht', !aliceDue.some((item) => item.title.includes('Viel später')));
check('Erledigt meldet nicht', !aliceDue.some((item) => item.title.includes('Schon erledigt')));
check('Ohne Deadline meldet nicht', !aliceDue.some((item) => /Später|Irgendwann/.test(item.title)));
check('Team-ToDo erreicht andere Mitglieder', (await dueNotes(bob)).some((item) => item.title === 'ToDo heute fällig: Team-Aufgabe'));
check('Solo-ToDo erreicht andere nicht', !(await dueNotes(bob)).some((item) => item.title.includes('Steuer')));
check('Abgeschaltete Benachrichtigung bleibt aus', (await dueNotes(carol)).length === 0);
check('Fremde bekommen nichts', (await dueNotes(dave)).length === 0);
const firstCount = (await dueNotes(alice)).length;
runTodoJob();
check('Zweiter Lauf meldet nicht doppelt', (await dueNotes(alice)).length === firstCount, `${firstCount} -> ${(await dueNotes(alice)).length}`);
ok('Deadline verschieben', await alice.patch(`/todos/${todoLater.id}`, { due_date: dayAt(0) }));
runTodoJob();
check('Neue Deadline meldet erneut', (await dueNotes(alice)).some((item) => item.title === 'ToDo heute fällig: Viel später'));
ok('Team-ToDo löschen', await bob.del(`/todos/${todoTeam.id}`));
ok('ToDo löschen', await alice.del(`/todos/${todoDone.id}`));
denied('Gelöschtes ToDo ist weg', await alice.del(`/todos/${todoDone.id}`), [404]);
const expNew = ok('DSGVO-Export mit Notizen und ToDos', await alice.get('/me/export'));
check('Export enthält Notizen, ToDos, Tickets', expNew.notes.some((n) => n.id === noteSolo.id) && expNew.todos.some((t) => t.id === todoSolo.id) && expNew.bug_reports.some((b) => String(b.id) === String(bug.id)));
check('Export ohne Notizen anderer', !expNew.notes.some((n) => n.id === noteTeam.id));
ok('Team-ToDo für die Browser-Tests', await bob.post('/todos', { title: 'Team-Protokoll', due_date: dayAt(5), team_id: team.id }));
const jobNames = (await admin.get('/admin/system')).data.jobs.map((job) => job.name);
check('Job erscheint in der Systemübersicht', jobNames.includes('todos.remind'), jobNames.join());

// ---------- Akten, Lizenzen, Schulungen, Dokumentationen (Alice Owner, Bob Editor, Carol Viewer, Dave fremd)
const upload = async (who, path, content, name, type) => {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), name);
  const res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: { authorization: `Bearer ${who.token.t}` }, body: form });
  if (res.status >= 500) fives.push(`POST ${path} -> ${res.status}`);
  return { status: res.status, data: await res.json().catch(() => null) };
};
const orgPerson = ok('Team-Person', await alice.post('/people', { name: 'Max Muster', kind: 'external', email: '', scope: 'team', team_id: team.id }));
const orgPerson2 = ok('Zweite Team-Person', await bob.post('/people', { name: 'Erika Beispiel', kind: 'external', email: '', scope: 'team', team_id: team.id }));
const privatePerson = ok('Private Person', await alice.post('/people', { name: 'Paula Privat', kind: 'family', email: '' }));

const caseFile = ok('Akte anlegen', await bob.post('/case-files', { title: 'Einbruch Lager', description: 'Sachverhalt', team_id: team.id, people: [{ person_id: orgPerson.id, role: 'Beschuldigter' }] }));
check('Aktenzeichen automatisch', /^\d{4}-0001$/.test(caseFile.file_number), caseFile.file_number);
const caseFile2 = ok('Zweite Akte', await alice.post('/case-files', { title: 'Zweite Akte', team_id: team.id }));
check('Aktenzeichen fortlaufend', /^\d{4}-0002$/.test(caseFile2.file_number), caseFile2.file_number);
invalid('Aktenzeichen doppelt', await alice.post('/case-files', { title: 'Dritte', team_id: team.id, file_number: caseFile.file_number }));
invalid('Private Person in Team-Akte', await alice.post('/case-files', { title: 'X', team_id: team.id, people: [{ person_id: privatePerson.id }] }));
invalid('Akte ohne Titel', await alice.post('/case-files', { title: '', team_id: team.id }));
denied('Viewer legt keine Akte an', await carol.post('/case-files', { title: 'X', team_id: team.id }));
check('Viewer sieht Team-Akte', (await carol.get('/case-files')).data.some((f) => f.id === caseFile.id && f.role === 'viewer'));
denied('Fremder öffnet Akte nicht', await dave.get(`/case-files/${caseFile.id}`));
check('Fremder sieht Akte nicht in der Liste', !(await dave.get('/case-files')).data.some((f) => f.id === caseFile.id));
denied('Viewer ändert Akte nicht', await carol.patch(`/case-files/${caseFile.id}`, { title: 'Geändert' }));
denied('Fremder löscht Akte nicht', await dave.del(`/case-files/${caseFile.id}`));
ok('Person beteiligen', await bob.post(`/case-files/${caseFile.id}/people`, { person_id: orgPerson2.id, role: 'Zeuge' }));
const daveFile = ok('Fremder legt eigene Akte an', await dave.post('/case-files', { title: 'Daves Akte' }));
invalid('Fremde Person in eigener Akte', await dave.post(`/case-files/${daveFile.id}/people`, { person_id: orgPerson.id }));
const caseEntry = ok('Eintrag', await bob.post(`/case-files/${caseFile.id}/entries`, { kind: 'Vermerk', body: 'Zeuge befragt', person_id: orgPerson2.id }));
invalid('Eintrag zu unbeteiligter Person', await bob.post(`/case-files/${caseFile.id}/entries`, { body: 'x', person_id: privatePerson.id }));
invalid('Leerer Eintrag', await bob.post(`/case-files/${caseFile.id}/entries`, { body: '' }));
denied('Viewer schreibt keinen Eintrag', await carol.post(`/case-files/${caseFile.id}/entries`, { body: 'x' }));
denied('Fremder ändert keinen Eintrag', await dave.patch(`/case-file-entries/${caseEntry.id}`, { body: 'x' }));
ok('Eintrag bearbeiten', await bob.patch(`/case-file-entries/${caseEntry.id}`, { body: 'Zeuge ausführlich befragt' }));
const pdfBytes = Buffer.from('%PDF-1.4\n% e2e\n');
const caseAttachment = ok('Anhang hochladen', await upload(bob, `/case-files/${caseFile.id}/attachments`, pdfBytes, 'protokoll.pdf', 'application/pdf'));
invalid('Dateiinhalt passt nicht zum Typ', await upload(bob, `/case-files/${caseFile.id}/attachments`, Buffer.from('kein pdf'), 'x.pdf', 'application/pdf'));
invalid('Dateityp nicht erlaubt', await upload(bob, `/case-files/${caseFile.id}/attachments`, Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml'));
denied('Viewer lädt nichts hoch', await upload(carol, `/case-files/${caseFile.id}/attachments`, pdfBytes, 'x.pdf', 'application/pdf'));
const downloaded = await carol.raw(`/case-file-attachments/${caseAttachment.id}`);
check('Viewer lädt Anhang herunter', downloaded.status === 200 && downloaded.buf.slice(0, 4).toString() === '%PDF');
denied('Fremder lädt Anhang nicht', await dave.get(`/case-file-attachments/${caseAttachment.id}`));
const caseDetail = ok('Akte im Detail', await carol.get(`/case-files/${caseFile.id}`));
check('Detail mit Personen, Einträgen, Anhängen', caseDetail.people.length === 2 && caseDetail.entries[0]?.person_name === 'Erika Beispiel' && caseDetail.attachments.length === 1, JSON.stringify(caseDetail).slice(0, 240));
ok('Akte abschließen', await bob.patch(`/case-files/${caseFile.id}`, { status: 'closed' }));
check('Abschlussdatum gesetzt', (await bob.get(`/case-files/${caseFile.id}`)).data.closed_on === dayAt(0));
invalid('Abschluss vor Eröffnung', await bob.patch(`/case-files/${caseFile.id}`, { closed_on: '2000-01-01' }));
check('Suche nach beteiligter Person', (await alice.get('/case-files?q=Erika')).data.some((f) => f.id === caseFile.id));
check('Filter nach Status', (await alice.get('/case-files?status=open')).data.every((f) => f.status === 'open'));
invalid('Person mit Akte lässt sich nicht löschen', await alice.del(`/people/${orgPerson2.id}`));
ok('Person aus Akte entfernen', await bob.del(`/case-files/${caseFile.id}/people/${orgPerson2.id}`));
check('Eintrag bleibt ohne Personenbezug', (await bob.get(`/case-files/${caseFile.id}`)).data.entries[0]?.person_id === null);
ok('Akte löschen', await alice.del(`/case-files/${caseFile2.id}`));

const licType = ok('Lizenzart', await alice.post('/license-types', { name: 'Waffenschein', validity_months: 12, team_id: team.id }));
denied('Viewer legt keine Lizenzart an', await carol.post('/license-types', { name: 'X', team_id: team.id }));
invalid('Gültigkeit 0 Monate', await alice.post('/license-types', { name: 'X', validity_months: 0 }));
const license = ok('Lizenz ausstellen', await bob.post('/licenses', { type_id: licType.id, person_id: orgPerson.id, number: 'WS-1', issued_on: dayAt(-360) }));
check('Standard-Gültigkeit ergibt Ablauf in Kürze', license.valid_until >= dayAt(0) && license.valid_until <= dayAt(10), license.valid_until);
check('Lizenz läuft bald ab', (await carol.get('/licenses')).data.find((l) => l.id === license.id)?.state === 'expiring');
invalid('Private Person für Team-Lizenzart', await bob.post('/licenses', { type_id: licType.id, person_id: privatePerson.id }));
invalid('Gültig bis vor Ausstellung', await bob.post('/licenses', { type_id: licType.id, person_id: orgPerson.id, issued_on: '2026-05-01', valid_until: '2026-04-01' }));
const unlimitedLicense = ok('Unbefristete Lizenz', await bob.post('/licenses', { type_id: licType.id, person_id: orgPerson2.id, valid_until: null }));
check('Unbefristet bleibt ohne Ablauf', unlimitedLicense.valid_until === null);
denied('Viewer ändert Lizenz nicht', await carol.patch(`/licenses/${license.id}`, { status: 'revoked' }));
denied('Fremder nutzt fremde Lizenzart nicht', await dave.post('/licenses', { type_id: licType.id, person_id: orgPerson.id }));
check('Fremder sieht keine Lizenzen', !(await dave.get('/licenses')).data.some((l) => l.id === license.id));
runJob('reminders');
check('Erinnerung an ablaufende Lizenz', psql(`SELECT count(*) FROM notifications WHERE user_id='${uC.id}' AND kind='license_expiry'`) === '1');
const renewed = ok('Lizenz verlängern', await bob.post(`/licenses/${license.id}/renew`));
check('Verlängert ab bisherigem Ablauf', renewed.valid_until > license.valid_until && renewed.valid_until > dayAt(300), renewed.valid_until);
ok('Lizenz entziehen', await bob.patch(`/licenses/${license.id}`, { status: 'revoked', status_reason: 'Missbrauch' }));
invalid('Entzogene Lizenz nicht verlängern', await bob.post(`/licenses/${license.id}/renew`));
check('Filter: entzogen mit Begründung', (await alice.get('/licenses?state=revoked')).data.some((l) => l.id === license.id && l.status_reason === 'Missbrauch'));
invalid('Lizenzart mit Lizenzen nicht löschen', await alice.del(`/license-types/${licType.id}`));

const training = ok('Schulung', await alice.post('/trainings', { name: 'Erste Hilfe', validity_months: 24, team_id: team.id }));
const trainingSession = ok('Termin', await bob.post(`/trainings/${training.id}/sessions`, { session_date: dayAt(-1), start_time: '18:00', end_time: '20:00', location: 'Wache' }));
invalid('Termin endet vor Beginn', await bob.post(`/trainings/${training.id}/sessions`, { session_date: dayAt(1), start_time: '20:00', end_time: '18:00' }));
const userRecord = ok('Benutzer eintragen', await bob.post(`/trainings/${training.id}/records`, { session_id: trainingSession.id, user_id: uC.id }));
invalid('Doppelt für denselben Termin', await bob.post(`/trainings/${training.id}/records`, { session_id: trainingSession.id, user_id: uC.id }));
invalid('Fremder Benutzer als Teilnehmer', await bob.post(`/trainings/${training.id}/records`, { user_id: uD.id }));
invalid('Benutzer und Person zugleich', await bob.post(`/trainings/${training.id}/records`, { user_id: uC.id, person_id: orgPerson.id }));
invalid('Private Person in Team-Schulung', await bob.post(`/trainings/${training.id}/records`, { person_id: privatePerson.id }));
const personRecord = ok('Person bestanden', await bob.post(`/trainings/${training.id}/records`, { session_id: trainingSession.id, person_id: orgPerson.id, result: 'passed' }));
check('Gültig 24 Monate ab Termin', personRecord.valid_until?.slice(0, 4) === String(Number(dayAt(-1).slice(0, 4)) + 2), personRecord.valid_until);
ok('Ergebnis erfassen', await bob.patch(`/training-records/${userRecord.id}`, { result: 'passed', valid_until: dayAt(10) }));
const trainingDetail = ok('Schulung im Detail', await carol.get(`/trainings/${training.id}`));
check('Abschlussdatum vom Termin', trainingDetail.records.find((r) => r.id === userRecord.id)?.completed_on === dayAt(-1));
denied('Viewer trägt nicht ein', await carol.post(`/trainings/${training.id}/records`, { user_id: uC.id }));
denied('Fremder öffnet Schulung nicht', await dave.get(`/trainings/${training.id}`));
denied('Fremder ändert Nachweis nicht', await dave.patch(`/training-records/${userRecord.id}`, { result: 'failed' }));
const candidates = ok('Wählbare Teilnehmer', await bob.get(`/trainings/${training.id}/candidates`));
check('Teilnehmer: Mitglieder und Team-Personen', candidates.users.some((u) => u.id === uC.id) && candidates.people.some((p) => p.id === orgPerson.id) && !candidates.people.some((p) => p.id === privatePerson.id));
const trainingOverview = ok('Schulungsübersicht', await alice.get('/trainings/overview'));
check('Übersicht nennt Nachweise', trainingOverview.some((r) => r.training_id === training.id && r.participant === 'Max Muster' && r.state === 'valid')
  && trainingOverview.some((r) => r.training_id === training.id && r.user_id === uC.id && r.state === 'expiring'));
runJob('reminders');
check('Erinnerung an ablaufenden Nachweis', psql(`SELECT count(*) FROM notifications WHERE user_id='${uA.id}' AND kind='training_expiry'`) === '1');
const orgCalendar = ok('Kalender mit Schulung und Lizenz', await carol.get(`/calendar?from=${dayAt(-5)}&to=${dayAt(400)}`));
check('Kalender zeigt Schulungstermin', orgCalendar.some((e) => e.type === 'training' && e.title === 'Schulung: Erste Hilfe' && e.start === '18:00'));
check('Kalender zeigt Ablauf des Nachweises', orgCalendar.some((e) => e.type === 'training' && e.date === dayAt(10)));

const personOverview = ok('Personenübersicht', await carol.get(`/people/${orgPerson.id}/record`));
check('Personenübersicht vollständig', personOverview.case_files.length === 1 && personOverview.licenses.length === 1 && personOverview.trainings.length === 1, JSON.stringify(personOverview).slice(0, 240));
denied('Fremder sieht Personenübersicht nicht', await dave.get(`/people/${orgPerson.id}/record`));

const docCategory = ok('Doku-Kategorie', await alice.post('/doc-categories', { name: 'Gesetze', team_id: team.id }));
denied('Viewer legt keine Kategorie an', await carol.post('/doc-categories', { name: 'X', team_id: team.id }));
const docPage = ok('Doku-Seite', await bob.post('/doc-pages', { category_id: docCategory.id, title: 'StVO § 1', body: '# Grundregel\nDie Teilnahme am Straßenverkehr erfordert **ständige Vorsicht**.' }));
check('Suche findet Text mit Ausschnitt', (await carol.get('/doc-pages?q=Vorsicht')).data.some((p) => p.id === docPage.id && /Vorsicht/.test(p.excerpt)));
denied('Viewer ändert Seite nicht', await carol.patch(`/doc-pages/${docPage.id}`, { title: 'x' }));
denied('Fremder liest Seite nicht', await dave.get(`/doc-pages/${docPage.id}`));
check('Fremder sieht Kategorie nicht', !(await dave.get('/doc-categories')).data.some((c) => c.id === docCategory.id));
const privateCategory = ok('Private Kategorie', await alice.post('/doc-categories', { name: 'Eigene Notizen' }));
invalid('Seite nicht in anderen Bereich verschieben', await alice.patch(`/doc-pages/${docPage.id}`, { category_id: privateCategory.id }));
invalid('Kategorie mit Seiten nicht löschen', await alice.del(`/doc-categories/${docCategory.id}`));
ok('Seite bearbeiten', await bob.patch(`/doc-pages/${docPage.id}`, { body: 'Neu' }));
check('Änderung gespeichert', (await carol.get(`/doc-pages/${docPage.id}`)).data.body === 'Neu');
ok('Seite löschen', await bob.del(`/doc-pages/${docPage.id}`));
ok('Leere Kategorie löschen', await alice.del(`/doc-categories/${docCategory.id}`));

// Ein ganzes Team lässt sich mit Personen, Akten, Lizenzen und Nachweisen löschen
const dropTeam = ok('Team zum Löschen', await alice.post('/teams', { name: 'E2E Löschteam' }));
const dropPerson = ok('Person im Löschteam', await alice.post('/people', { name: 'Lotte Löschbar', kind: 'external', email: '', scope: 'team', team_id: dropTeam.id }));
const dropFile = ok('Akte im Löschteam', await alice.post('/case-files', { title: 'Löschakte', team_id: dropTeam.id, people: [{ person_id: dropPerson.id }] }));
ok('Eintrag zur Person', await alice.post(`/case-files/${dropFile.id}/entries`, { body: 'Vermerk', person_id: dropPerson.id }));
const dropType = ok('Lizenzart im Löschteam', await alice.post('/license-types', { name: 'Angelschein', team_id: dropTeam.id }));
ok('Lizenz im Löschteam', await alice.post('/licenses', { type_id: dropType.id, person_id: dropPerson.id }));
const dropTraining = ok('Schulung im Löschteam', await alice.post('/trainings', { name: 'Löschkurs', team_id: dropTeam.id }));
ok('Nachweis im Löschteam', await alice.post(`/trainings/${dropTraining.id}/records`, { person_id: dropPerson.id, result: 'passed' }));
invalid('Person mit Unterlagen wechselt die Sichtbarkeit nicht', await alice.patch(`/people/${dropPerson.id}`, { scope: 'personal' }));
const movable = ok('Person ohne Unterlagen', await alice.post('/people', { name: 'Moritz Mobil', kind: 'external', email: '', scope: 'team', team_id: dropTeam.id }));
ok('Person ohne Unterlagen wechselt die Sichtbarkeit', await alice.patch(`/people/${movable.id}`, { scope: 'personal' }));
check('Gewechselte Person ist privat', psql(`SELECT (team_id IS NULL AND owner_user_id='${uA.id}')::text FROM people WHERE id='${movable.id}'`) === 'true');
ok('Team mit Unterlagen löschen', await alice.del(`/teams/${dropTeam.id}`));
check('Unterlagen des Teams sind weg', psql(`SELECT (SELECT count(*) FROM people WHERE id='${dropPerson.id}') + (SELECT count(*) FROM case_files WHERE id='${dropFile.id}') + (SELECT count(*) FROM licenses WHERE person_id='${dropPerson.id}') + (SELECT count(*) FROM training_records WHERE person_id='${dropPerson.id}')`) === '0');

// ---------- Admin
for (const p of ['/admin/overview', '/admin/users', '/admin/roles', '/admin/groups', '/admin/teams', '/admin/settings', '/admin/system', '/admin/audit?limit=10', '/admin/api-keys', '/admin/webhooks', '/admin/backups']) ok(`GET ${p}`, await admin.get(p));
check('Audit-Export', (await admin.raw('/admin/audit/export.csv')).status === 200);
check('User-Export', (await admin.raw('/admin/users/export.csv')).status === 200);
ok('App-Name setzen', await admin.put('/admin/settings', { 'general.app_name': 'E2E Finanz' }));
check('App-Name öffentlich', (await anon.get('/auth/config')).data.app_name === 'E2E Finanz');
const group = ok('Gruppe', await admin.post('/admin/groups', { name: 'G1' }));
ok('Gruppe löschen', await admin.del(`/admin/groups/${group.id}`));
const role = ok('Rolle', await admin.post('/admin/roles', { name: 'Buchhalter', description: '', permissions: ['budget:read'], data_scope: 'own' }));
ok('Rolle löschen', await admin.del(`/admin/roles/${role.id}`));
const hook = ok('Webhook', await admin.post('/admin/webhooks', { url: 'http://localhost:9/x', events: ['budget_80'] }));
ok('Webhook löschen', await admin.del(`/admin/webhooks/${hook.id}`));
const backup = await admin.post('/admin/backups', {});
check('Backup erstellen', backup.status === 200, JSON.stringify(backup.data).slice(0, 300));
const backups = ok('Backups', await admin.get('/admin/backups'));
check('Backup erscheint', backups.length >= 1 || backups.files?.length >= 1, JSON.stringify(backups).slice(0, 200));
// Benutzer-Teil-Update darf Rollen nicht leeren
ok('Benutzer nur umbenennen', await admin.patch(`/admin/users/${uC.id}`, { name: 'carol' }));
check('Benutzer behält Rollen', (await admin.get('/admin/users')).data.find((row) => row.id === uC.id).roles.includes('User'));
// Validierungsmeldungen sind deutsch und nennen das Feld verständlich
const reportError = await alice.post('/reports/saved', { kind: 'monthly', rhythm: 'monthly', recipients: ['kaputt'] });
check('Meldung zu Empfängern', reportError.status === 400 && reportError.data.message === 'Empfänger 1 ist keine gültige E-Mail-Adresse', reportError.data.message);
const titleError = await alice.post('/notes', { title: 'x'.repeat(151) });
check('Meldung zu langem Titel', titleError.data.message === 'Titel darf höchstens 150 Zeichen lang sein', titleError.data.message);
const missingError = await alice.post('/todos', {});
check('Meldung zu fehlendem Feld', missingError.data.message === 'Titel fehlt', missingError.data.message);
// Proxy ohne TRUST_PROXY fällt im Admin-Bereich auf
const viaProxy = await fetch(`${BASE}/api/admin/settings`, { headers: { authorization: `Bearer ${admin.token.t}`, 'x-forwarded-for': '203.0.113.9' } });
check('Proxy-Hinweis bei fehlendem TRUST_PROXY', (await viaProxy.json()).env.proxy_not_trusted === true);
check('Kein Proxy-Hinweis ohne Proxy', (await admin.get('/admin/settings')).data.env.proxy_not_trusted === false);
// Benachrichtigungs-Schalter gelten für alle Arten
ok('Dave schaltet Team-Meldungen ab', await dave.put('/me/notification-prefs', [{ kind: 'team_added', in_app: false, email: false }]));
const switchTeam = ok('Team für Schalter-Test', await alice.post('/teams', { name: 'Schalter' }));
ok('Dave hinzufügen', await alice.post(`/teams/${switchTeam.id}/members`, { email: uD.email, team_role: 'viewer' }));
const daveTeamNotes = async () => (await dave.get('/notifications')).data.items.filter((item) => item.kind === 'team_added').length;
check('Abgeschaltete Art erscheint nicht', (await daveTeamNotes()) === 0);
const daveUnread = (await dave.get('/notifications')).data.unread;
ok('Dave schaltet sie wieder an', await dave.put('/me/notification-prefs', [{ kind: 'team_added', in_app: true, email: false }]));
check('Danach ist sie wieder sichtbar', (await daveTeamNotes()) === 1);
check('Zähler folgt dem Schalter', (await dave.get('/notifications')).data.unread === daveUnread + 1);
ok('Team für Schalter-Test löschen', await alice.del(`/teams/${switchTeam.id}`));
// Mailversand, wenn ein Test-SMTP läuft (MAILPIT=http://localhost:18025)
if (process.env.MAILPIT) {
  const mails = async (to, subject) => {
    const { messages } = await (await fetch(`${process.env.MAILPIT}/api/v1/messages?limit=200`)).json();
    return messages.filter((message) => message.To.some((address) => address.Address === to) && message.Subject.includes(subject)).length;
  };
  const mailsAfter = async (to, subject, count) => { for (let i = 0; i < 25; i++) { if ((await mails(to, subject)) >= count) return true; await new Promise((resolve) => setTimeout(resolve, 200)); } return false; };
  ok('Mailversand einschalten', await admin.put('/admin/settings', { 'mail.enabled': true }));
  const commentsBefore = await mails(uA.email, 'Neuer Kommentar zu Ticket');
  ok('Kommentar ohne Mail-Wahl', await admin.post(`/admin/bug-reports/${bug.id}/comments`, { body: 'ohne Mail' }));
  await new Promise((resolve) => setTimeout(resolve, 800));
  check('Ohne Wahl keine Mail', (await mails(uA.email, 'Neuer Kommentar zu Ticket')) === commentsBefore);
  ok('Alice wählt Mail für Kommentare', await alice.put('/me/notification-prefs', [{ kind: 'ticket_comment', in_app: true, email: true }]));
  ok('Kommentar mit Mail-Wahl', await admin.post(`/admin/bug-reports/${bug.id}/comments`, { body: 'mit Mail' }));
  check('Kommentar kommt per Mail', await mailsAfter(uA.email, 'Neuer Kommentar zu Ticket', commentsBefore + 1));
  // Nur E-Mail, ohne Glocke: Der Job läuft zweimal, die Mail darf nur einmal kommen
  ok('Alice: ToDo nur per Mail', await alice.put('/me/notification-prefs', [{ kind: 'todo_due', in_app: false, email: true }]));
  const mailTodo = ok('ToDo für Mail', await alice.post('/todos', { title: 'Mail-Aufgabe', due_date: dayAt(0) }));
  runTodoJob();
  check('ToDo-Deadline kommt per Mail', await mailsAfter(uA.email, 'ToDo heute fällig: Mail-Aufgabe', 1));
  psql(`UPDATE todos SET last_reminder=NULL WHERE id='${mailTodo.id}'`);
  runTodoJob();
  await new Promise((resolve) => setTimeout(resolve, 800));
  check('Mail kommt nur einmal', (await mails(uA.email, 'ToDo heute fällig: Mail-Aufgabe')) === 1);
  check('Glocke bleibt aus', !(await alice.get('/notifications')).data.items.some((item) => item.title.includes('Mail-Aufgabe')));
  // Ältere Arten: E-Mail-Schalter wirkt jetzt auch dort
  ok('Dave wählt Mail für Team-Meldungen', await dave.put('/me/notification-prefs', [{ kind: 'team_added', in_app: true, email: true }]));
  const mailTeam = ok('Team für Mail-Test', await alice.post('/teams', { name: 'MailTeam' }));
  ok('Dave hinzufügen für Mail', await alice.post(`/teams/${mailTeam.id}/members`, { email: uD.email, team_role: 'viewer' }));
  check('Team-Meldung kommt per Mail', await mailsAfter(uD.email, 'zu „MailTeam“', 1));
  ok('Team für Mail-Test löschen', await alice.del(`/teams/${mailTeam.id}`));
  ok('Alice: ToDo wieder normal', await alice.put('/me/notification-prefs', [{ kind: 'todo_due', in_app: true, email: false }, { kind: 'ticket_comment', in_app: true, email: false }]));
  ok('Testaufgabe löschen', await alice.del(`/todos/${mailTodo.id}`));
}
// Zugang gilt bis einschließlich zum Ablaufdatum
ok('Ablauf heute', await admin.patch(`/admin/users/${uD.id}`, { expires_at: dayAt(0) }));
const expiringLogin = await anon.post('/auth/login', { email: uD.email, password: uD.password });
check('Am letzten Tag noch gültig', expiringLogin.status === 200, JSON.stringify(expiringLogin.data));
const expiringClient = client({ t: expiringLogin.data.access_token });
ok('Sitzung am letzten Tag aktiv', await expiringClient.get('/me'));
ok('Ablauf gestern', await admin.patch(`/admin/users/${uD.id}`, { expires_at: dayAt(-1) }));
denied('Abgelaufene Sitzung endet sofort', await expiringClient.get('/me'), [401]);
denied('Abgelaufen meldet sich nicht an', await anon.post('/auth/login', { email: uD.email, password: uD.password }), [403]);
ok('Ablauf entfernen', await admin.patch(`/admin/users/${uD.id}`, { expires_at: null }));
ok('Ohne Ablauf wieder aktiv', await expiringClient.get('/me'));
ok('User sperren', await admin.patch(`/admin/users/${uD.id}`, { status: 'disabled' }));
denied('Deaktivierter Login', await anon.post('/auth/login', { email: uD.email, password: uD.password }), [400, 401, 403, 423]);

// ---------- Aufräum-Kaskaden
ok('Konto löschen entfernt Budgetbezug', await alice.del(`/budgets/${shared.id}`));
check('Budgets nach Kontolöschung konsistent', (await alice.get('/spending-budgets')).status === 200);

// ---------- Rate-Limits: nur dort, wo Passwörter oder Codes geprüft werden
const statuses = (requests) => Promise.all(requests).then((rows) => rows.map((row) => row.status));
const burst = (count, make) => statuses(Array.from({ length: count }, make));
check('Kein allgemeines Limit auf der API', (await burst(350, () => fetch(`${BASE}/api/auth/config`))).every((status) => status === 200));
check('Kein allgemeines Limit auf statischen Dateien', (await burst(350, () => fetch(`${BASE}/${assetBase}js/app.js`))).every((status) => status === 200));
check('Kein Limit beim Erneuern der Sitzung', !(await burst(30, () => fetch(`${BASE}/api/auth/refresh`, { method: 'POST' }))).includes(429));
const passwordTries = [];
for (let i = 0; i < 12; i++) passwordTries.push((await alice.post('/me/password', { current: 'falsch', password: 'egal-egal-egal' })).status);
check('Passwort ändern bleibt begrenzt', passwordTries.includes(429) && passwordTries[0] === 400, passwordTries.join());
const reveals = [];
for (let i = 0; i < 7; i++) reveals.push((await alice.post(`/properties/${house.id}/pin/reveal`, { password: 'falsch' })).status);
check('Tür-PIN bleibt begrenzt', reveals.includes(429), reveals.join());
const loginTries = [];
for (let i = 0; i < 12; i++) loginTries.push((await anon.post('/auth/login', { email: 'niemand@e2e.test', password: 'falsch' })).status);
check('Login bleibt begrenzt', loginTries.includes(429), loginTries.join());

// ---------- Ergebnis
check('keine 5xx-Antworten', fives.length === 0, `\n  ${fives.join('\n  ')}`);
console.log(`\nAPI-E2E: ${results.pass} bestanden, ${results.fail.length} fehlgeschlagen`);
if (results.fail.length) { console.log(results.fail.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
