// API-E2E gegen den isolierten Stack. Jede 5xx-Antwort zählt automatisch als Fehler.
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

// ---------- Basis, Header, Statik
for (const p of ['/health', '/ready', '/', '/js/app.js', '/js/pages/sport.js', '/js/pages/spending.js', '/js/pages/privacy.js', '/css/auth.css']) {
  check(`static ${p}`, (await fetch(BASE + p)).status === 200);
}
const rootHeaders = (await fetch(`${BASE}/`)).headers;
check('CSP-Header', /default-src/.test(rootHeaders.get('content-security-policy') || ''));
check('kein X-Powered-By', !rootHeaders.get('x-powered-by'));
denied('ohne Token /me', await anon.get('/me'), [401]);
denied('ohne Token /sport/routes', await anon.get('/sport/routes'), [401]);
denied('ohne Token /spending-budgets', await anon.get('/spending-budgets'), [401]);
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

// ---------- Statistik / Berichte
for (const p of ['/stats/overview', '/stats/by-category', '/stats/timeline', '/stats/overview?scope=solo', '/stats/overview?scope=shared', '/reports/costs', '/reports/saved', '/notifications', '/me/sessions', '/me/notification-prefs', '/me/api-keys', '/integrations', '/assets/overview', '/assets/costs', '/assets/log']) ok(`GET ${p}`, await alice.get(p));
const saved = ok('Geplanter Bericht', await alice.post('/reports/saved', { kind: 'monthly', rhythm: 'monthly', recipients: [] }));
ok('Bericht löschen', await alice.del(`/reports/saved/${saved.id}`));

// ---------- Zeiterfassung & Gehalt
ok('Profil Gehalt', await alice.patch('/me', { weekly_work_hours: 7, hourly_rate: 10, overtime_surcharge_percent: 25, payroll_budget_id: solo.id }));
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
ok('Editor setzt Mitarbeiter-Einstellung', await bob.patch(`/work-hours/team/${team.id}/members/${meAlice.user.id}/settings`, { hourly_rate: 11 }));
denied('Viewer setzt Einstellung nicht', await carol.patch(`/work-hours/team/${team.id}/members/${meAlice.user.id}/settings`, { hourly_rate: 1 }));
denied('Editor löscht Teamprojekt nicht (nur Owner)', await bob.del(`/work-projects/${teamProj.id}`));
ok('Owner löscht Teamprojekt', await alice.del(`/work-projects/${teamProj.id}`));
denied('Fremder löscht Projekt nicht', await dave.del(`/work-projects/${proj.id}`));

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
ok('User sperren', await admin.patch(`/admin/users/${uD.id}`, { status: 'disabled' }));
denied('Deaktivierter Login', await anon.post('/auth/login', { email: uD.email, password: uD.password }), [400, 401, 403, 423]);

// ---------- Aufräum-Kaskaden
ok('Konto löschen entfernt Budgetbezug', await alice.del(`/budgets/${shared.id}`));
check('Budgets nach Kontolöschung konsistent', (await alice.get('/spending-budgets')).status === 200);

// ---------- Ergebnis
check('keine 5xx-Antworten', fives.length === 0, `\n  ${fives.join('\n  ')}`);
console.log(`\nAPI-E2E: ${results.pass} bestanden, ${results.fail.length} fehlgeschlagen`);
if (results.fail.length) { console.log(results.fail.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
