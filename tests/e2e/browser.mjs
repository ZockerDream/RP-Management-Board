import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:18088';
const out = '/work/shots';
const fails = [], problems = [];
let passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else { fails.push(`${name} ${extra}`); console.log(`FAIL ${name} ${extra}`); } };

const browser = await chromium.launch();
async function session(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let where = 'start';
  page.on('console', (m) => { if (m.type() === 'error' && !/gravatar|status of 4\d\d/i.test(m.text())) problems.push(`[${where}] console: ${m.text().slice(0, 220)}`); });
  page.on('pageerror', (e) => problems.push(`[${where}] pageerror: ${e.message.slice(0, 220)}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`[${where}] ${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => { const f = r.failure()?.errorText || ''; if (!/ABORTED|gravatar/i.test(`${f} ${r.url()}`)) problems.push(`[${where}] requestfailed ${r.url()} ${f}`); });
  return { ctx, page, at: (w) => { where = w; } };
}
const until = async (page, fn, arg, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(60); } throw new Error(`Timeout: ${fn}`); };
const settle = (page) => until(page, () => !/Wird geladen/.test(document.querySelector('#view')?.textContent || '')).catch(() => {});
async function login(page, email, password) {
  await page.goto(`${BASE}/#/login`);
  await page.fill('#login [name=email]', email);
  await page.fill('#login [name=password]', password);
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.app:not(.hidden) #view');
  await settle(page);
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(150); await settle(page); await page.waitForTimeout(200); };
const submit = async (page) => { await page.click('.modal.open button[type=submit]'); await until(page, () => !document.querySelector('.modal.open form')); await page.waitForTimeout(350); };
const viewErr = (page) => page.$eval('#view', (v) => v.querySelector('.auth-error')?.textContent || '');

// ---------- Abgemeldet
{
  const { page, at, ctx } = await session();
  at('anon');
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#login');
  check('Login zeigt konfigurierten App-Namen', (await page.title()) === 'E2E Finanz', await page.title());
  await page.click('a[href="#/datenschutz"]');
  await page.waitForSelector('.legal h1');
  check('Datenschutz abgemeldet', (await page.textContent('.legal h1')) === 'Datenschutzerklärung');
  await page.screenshot({ path: `${out}/anon-datenschutz.png` });
  await page.click('.legal-tabs a[href="#/impressum"]');
  await until(page, () => document.querySelector('.legal h1')?.textContent === 'Impressum');
  check('Impressum abgemeldet', true);
  await page.click('.legal-tabs a[href="#/login"]');
  await page.waitForSelector('#login');
  check('Zurück führt zum Login', true);
  await page.fill('#login [name=email]', 'alice@e2e.test');
  await page.fill('#login [name=password]', 'falsch-falsch');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#login .auth-error:not([hidden])');
  check('Falsches Passwort zeigt Meldung', true);
  await go(page, '#/forgot');
  check('Passwort-vergessen', !!(await page.$('#forgot')));
  await ctx.close();
}

// ---------- Normaler Benutzer
{
  const { page, at, ctx } = await session();
  at('alice-login');
  await login(page, 'alice@e2e.test', 'alice-Sehr-Sicher-9931!');
  const navs = await page.$$eval('.sidebar a.nav', (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => n.getAttribute('href')));
  check('User sieht keine Admin-Links', !navs.some((h) => h.includes('admin')), navs.join());
  for (const want of ['#/notes', '#/todos', '#/spending', '#/sport-run', '#/sport-swim', '#/sport-bike', '#/assets-vehicles', '#/assets-properties', '#/assets-people', '#/assets-keys', '#/assets-manage', '#/help', '#/bug-report', '#/datenschutz', '#/impressum']) check(`Nav ${want}`, navs.includes(want));
  for (const h of navs) {
    at(`alice ${h}`);
    await go(page, h);
    check(`Seite ${h} ohne Fehler`, !(await viewErr(page)), await viewErr(page));
    check(`Seite ${h} hat Inhalt`, ((await page.textContent('#view')) || '').trim().length > 10);
    for (const t of await page.$$('#view .tabs:not([hidden]) [data-tab]')) { await t.click(); await page.waitForTimeout(250); check(`${h} Tab ${await t.getAttribute('data-tab')}`, !(await viewErr(page)), await viewErr(page)); }
    const name = h.replace('#/', '');
    if (['dashboard', 'budgets', 'spending', 'sport-run', 'work', 'notes', 'todos', 'bug-report', 'assets-manage', 'help', 'datenschutz', 'impressum'].includes(name)) await page.screenshot({ path: `${out}/alice-${name}.png` });
  }
  // Admin-URL direkt gesperrt
  at('alice admin direkt');
  await go(page, '#/admin-server');
  check('Admin-URL leitet User um', !(await page.evaluate(() => location.hash)).includes('admin'));

  // Dashboard zeigt nur den echten Stand
  at('alice dashboard saldo');
  await go(page, '#/dashboard');
  check('Dashboard ohne zukünftige Buchung', !/Zukunft Test/.test(await page.textContent('#view')));
  check('Gesamtsaldo gleich Kontostand', /960,50/.test(await page.locator('.kpi', { hasText: 'Gesamtsaldo' }).textContent()), await page.locator('.kpi', { hasText: 'Gesamtsaldo' }).textContent());
  const dashboardText = await page.textContent('#d-body');
  check('Dashboard zeigt Budget-Auslastung', /Budget-Auslastung/.test(dashboardText) && !/Konto-Auslastung/.test(dashboardText));
  check('Auslastung nennt echte Budgets', await page.locator('.gauge', { hasText: 'Gesamt' }).count() === 1);
  await go(page, '#/transactions');
  check('Transaktionen zeigen zukünftige Buchung', /Zukunft Test/.test(await page.textContent('#view')));

  // Dashboard: Tag, Woche, Monat
  at('alice dashboard ansichten');
  await go(page, '#/dashboard');
  const activeView = () => page.$eval('#d-view .on', (b) => b.dataset.v);
  const yAxis = () => page.$$eval('#d-cash text.axis[text-anchor="end"]', (t) => t.map((x) => x.textContent));
  const expenseKpi = () => page.locator('.kpi', { hasText: 'Ausgaben' }).locator('.value').textContent();
  check('Monat ist die Standardansicht', (await activeView()) === 'month');
  for (const [mode, caption, count, chart] of [['day', 'am gewählten Tag', 14, 'letzte 14 Tage'], ['week', 'in der gewählten Woche', 8, 'letzte 8 Wochen'], ['month', 'im gewählten Monat', 3, 'letzte 6 Monate']]) {
    await page.click(`#d-view [data-v=${mode}]`);
    await page.waitForTimeout(700);
    const body = await page.textContent('#d-body');
    check(`Ansicht ${mode}: Beschriftung`, body.includes(caption), body.slice(0, 200));
    check(`Ansicht ${mode}: Diagrammtitel`, body.includes(chart));
    check(`Ansicht ${mode}: Zeiträume`, (await page.locator('#d-range option').count()) === count);
    check(`Ansicht ${mode}: Saldo bleibt heutiger Stand`, /960,50/.test(await page.locator('.kpi', { hasText: 'Gesamtsaldo' }).textContent()));
    check(`Ansicht ${mode}: keine kaputten Werte`, !/undefined|NaN|null/.test(body));
    check(`Ansicht ${mode}: Achse ohne doppelte Werte`, new Set(await yAxis()).size === 5, (await yAxis()).join());
    check(`Ansicht ${mode}: Kurve bleibt im Diagramm`, await page.evaluate(() => { const box = document.querySelector('#d-cash svg').getBoundingClientRect(); return [...document.querySelectorAll('#d-cash path[fill="none"]')].every((p) => p.getBoundingClientRect().bottom <= box.bottom - 27); }));
    await page.screenshot({ path: `${out}/alice-dashboard-${mode}.png` });
  }
  await page.click('#d-view [data-v=day]');
  await page.waitForTimeout(600);
  check('Tagesansicht: heutige Ausgabe', /40,00/.test(await expenseKpi()), await expenseKpi());
  await page.selectOption('#d-range', '-1');
  await page.waitForTimeout(600);
  check('Tagesansicht: gestern andere Werte', /0,00/.test(await expenseKpi()) && !/40,00/.test(await expenseKpi()), await expenseKpi());
  await page.click('#d-view [data-v=week]');
  await page.waitForTimeout(600);
  check('Wechsel setzt auf den laufenden Zeitraum', (await page.inputValue('#d-range')) === '0');
  check('Wochenansicht: enthält heutige Ausgabe', /40,00/.test(await expenseKpi()), await expenseKpi());
  await go(page, '#/help');
  await go(page, '#/dashboard');
  check('Ansicht bleibt beim Seitenwechsel', (await activeView()) === 'week');
  for (const mode of ['day', 'week', 'day', 'month']) await page.click(`#d-view [data-v=${mode}]`);
  await page.waitForTimeout(900);
  check('Schneller Wechsel zeigt die letzte Wahl', (await page.textContent('#d-body')).includes('im gewählten Monat'));
  await page.selectOption('#d-range', '-1');
  await page.waitForTimeout(500);
  check('Letzter Monat bleibt wählbar', !/undefined|NaN/.test(await page.textContent('#d-body')));

  // Notizblock
  at('alice notizen');
  await go(page, '#/notes');
  check('Notiz wird als Text gezeigt', /onerror=alert/.test(await page.textContent('#n-list')) && !(await page.$('#n-list img')));
  await page.click('#n-new');
  check('Notiz: Solo und Team wählbar', (await page.$$eval('.modal.open [name=team_id] option', (o) => o.map((x) => x.textContent))).some((t) => t.includes('E2E Team')));
  await page.click('.modal.open button[type=submit]');
  await page.waitForSelector('.modal.open .auth-error:not([hidden])');
  check('Leere Notiz wird abgelehnt', /erforderlich/.test(await page.textContent('.modal.open .auth-error')));
  await page.fill('.modal.open [name=title]', 'UI Notiz');
  await page.fill('.modal.open [name=body]', 'Zeile 1\nZeile 2 mit **fett** und [Link](https://example.org)\n\n<b>kein HTML</b>');
  await submit(page);
  const noteCard = page.locator('#n-list .memo', { hasText: 'UI Notiz' });
  check('Notiz angelegt', await noteCard.count() === 1);
  // Notizen sind Markdown: Zeilenumbruch bleibt, **fett** und Links werden formatiert, HTML wird nur angezeigt
  check('Zeilenumbrüche bleiben', await noteCard.locator('.memo-body').evaluate((n) => n.querySelectorAll('p br').length === 1 && /Zeile 1/.test(n.textContent) && /Zeile 2/.test(n.textContent)));
  check('Markdown in Notizen', await noteCard.locator('.memo-body').evaluate((n) => n.querySelector('b')?.textContent === 'fett' && n.querySelector('a[href="https://example.org"][rel~=noopener]') !== null));
  check('HTML in Notizen wird nicht ausgeführt', await noteCard.locator('.memo-body').evaluate((n) => n.textContent.includes('<b>kein HTML</b>') && n.querySelectorAll('b').length === 1));
  await noteCard.locator('[data-edit]').click();
  check('Notiz vorbefüllt mit dem Rohtext', (await page.inputValue('.modal.open [name=body]')).startsWith('Zeile 1\nZeile 2 mit **fett**'));
  await page.selectOption('.modal.open [name=team_id]', { label: 'Organisation: E2E Team' });
  await submit(page);
  check('Notiz im Team', /E2E Team/.test(await noteCard.textContent()));
  await noteCard.locator('[data-pin]').click();
  await page.waitForTimeout(400);
  check('Notiz angeheftet steht vorn', /UI Notiz/.test(await page.locator('#n-list .memo').first().textContent()) && /Angeheftet/.test(await noteCard.textContent()));
  await page.click('#n-scope [data-s=solo]');
  check('Filter Solo', await noteCard.count() === 0);
  await page.click('#n-scope [data-s=team]');
  check('Filter Team', await noteCard.count() === 1 && await page.locator('#n-list .memo', { hasText: 'Meine Notiz' }).count() === 0);
  await page.click('#n-scope [data-s=all]');
  await page.fill('#n-search', 'zeile 2');
  check('Suche findet Text', await noteCard.count() === 1 && await page.locator('#n-list .memo').count() === 1);
  await page.fill('#n-search', 'gibt-es-nicht');
  check('Suche ohne Treffer', /Keine passende Notiz/.test(await page.textContent('#n-list')));
  check('Suche behält Fokus', await page.evaluate(() => document.activeElement?.id === 'n-search'));
  await page.screenshot({ path: `${out}/alice-notes-search.png` });
  await page.fill('#n-search', '');
  await noteCard.locator('[data-del]').click();
  await submit(page);
  check('Notiz gelöscht', await noteCard.count() === 0);

  // ToDos
  at('alice todos');
  await go(page, '#/todos');
  const openText = await page.textContent('#t-list');
  for (const word of ['Überfällig', 'Heute', 'Demnächst', 'Ohne Deadline', 'Morgen fällig', 'Steuer abgeben']) check(`ToDos zeigen ${word}`, openText.includes(word), openText.slice(0, 200));
  await page.screenshot({ path: `${out}/alice-todos.png` });
  await page.click('#t-new');
  await page.click('.modal.open button[type=submit]');
  await page.waitForTimeout(200);
  check('ToDo braucht einen Titel', await page.locator('.modal.open form').count() === 1);
  await page.fill('.modal.open [name=title]', 'UI Aufgabe');
  await page.fill('.modal.open [name=due_date]', new Date(Date.now() + 10 * 86400000).toLocaleDateString('sv-SE'));
  await page.selectOption('.modal.open [name=team_id]', { label: 'Organisation: E2E Team' });
  await submit(page);
  const todoRow = page.locator('#t-list .todo-row', { hasText: 'UI Aufgabe' });
  check('ToDo angelegt', await todoRow.count() === 1 && /E2E Team/.test(await todoRow.textContent()));
  await todoRow.locator('[data-edit]').click();
  await page.fill('.modal.open [name=note]', 'Mit <b>Notiz</b>');
  await submit(page);
  check('ToDo-Notiz bleibt Text', /<b>Notiz<\/b>/.test(await todoRow.textContent()));
  await todoRow.locator('[data-done]').check();
  await page.waitForTimeout(500);
  check('Abgehakt verschwindet aus Offen', await todoRow.count() === 0);
  await page.click('#t-status [data-status=done]');
  check('Erledigt zeigt es mit Name', /Erledigt .* von alice/.test(await todoRow.textContent()), await todoRow.textContent());
  await page.screenshot({ path: `${out}/alice-todos-done.png` });
  await todoRow.locator('[data-done]').uncheck();
  await page.waitForTimeout(500);
  await page.click('#t-status [data-status=open]');
  check('Wieder offen', await todoRow.count() === 1);
  await page.click('#t-scope [data-s=solo]');
  check('ToDo-Filter Solo', await todoRow.count() === 0);
  await page.click('#t-scope [data-s=team]');
  check('ToDo-Filter Team', await todoRow.count() === 1 && await page.locator('#t-list .todo-row', { hasText: 'Steuer abgeben' }).count() === 0);
  await page.click('#t-scope [data-s=all]');
  await todoRow.locator('[data-del]').click();
  await submit(page);
  check('ToDo gelöscht', await todoRow.count() === 0);
  await page.click('#bell');
  await page.waitForTimeout(400);
  check('Glocke meldet ToDo-Deadline', /ToDo morgen fällig: Steuer abgeben/.test(await page.textContent('#notification-items')));
  await page.click('#bell');

  // Eigene Tickets
  at('alice tickets');
  await go(page, '#/bug-report');
  await page.fill('#bug-report-form [name=title]', 'UI Ticket zum Löschen');
  await page.fill('#bug-report-form [name=description]', 'Beschreibung mit mindestens zwanzig Zeichen.');
  await page.click('#bug-report-form button[type=submit]');
  const ownTicket = page.locator('#bug-report-list .ticket', { hasText: 'UI Ticket zum Löschen' });
  await ownTicket.waitFor();
  await ownTicket.locator('[name=body]').fill('   ');
  await ownTicket.locator('[data-comment-form] button').click();
  await page.waitForTimeout(200);
  check('Leerer Kommentar wird nicht gesendet', await ownTicket.locator('.ticket-comment').count() === 0);
  await ownTicket.locator('[name=body]').fill('Mein Kommentar <i>x</i>\nzweite Zeile');
  await ownTicket.locator('[data-comment-form] button').click();
  await ownTicket.locator('.ticket-comment').waitFor();
  check('Kommentar erscheint als Text', /<i>x<\/i>/.test(await ownTicket.locator('.ticket-comment').textContent()) && /alice/.test(await ownTicket.locator('.ticket-comment').textContent()));
  check('Kommentarfeld ist danach leer', (await ownTicket.locator('[name=body]').inputValue()) === '');
  await page.screenshot({ path: `${out}/alice-ticket-comment.png` });
  await ownTicket.locator('[data-comment-del]').click();
  await submit(page);
  check('Eigener Kommentar gelöscht', await ownTicket.locator('.ticket-comment').count() === 0);
  await ownTicket.locator('[data-ticket-del]').click();
  check('Löschen fragt nach', /endgültig/.test(await page.textContent('.modal.open')));
  await submit(page);
  check('Eigenes Ticket gelöscht', await ownTicket.count() === 0);

  // Konten
  at('alice konten');
  await go(page, '#/budgets');
  check('Konto zeigt Kontostand', /Kontostand/.test(await page.textContent('#view')) && /Einkommen/.test(await page.textContent('#view')));
  await page.click('#view button:has-text("Neues Konto")');
  check('Kontoformular ohne Limit/Zeitraum', !(await page.$('.modal.open [name=limit_amount]')) && !(await page.$('.modal.open [name=period_type]')));
  check('Kontoformular schlägt Profilwährung vor', (await page.inputValue('.modal.open [name=currency]')) === 'EUR');
  await page.fill('.modal.open [name=name]', 'UI Konto');
  await submit(page);
  check('Konto über UI angelegt', /UI Konto/.test(await page.textContent('#view')));

  // Budgets
  at('alice budgets');
  await go(page, '#/spending');
  await page.click('#s-new');
  await page.fill('.modal.open [name=name]', 'UI Budget');
  await page.fill('.modal.open [name=limit_amount]', '12,50');
  await page.selectOption('.modal.open [name=period_type]', 'monthly');
  await submit(page);
  const card = page.locator('#s-body .card', { hasText: 'UI Budget' });
  check('Budget angelegt mit Komma-Betrag', /12,50/.test(await card.textContent()), await card.textContent());
  await card.locator('[data-edit]').click();
  check('Budget-Bearbeiten vorbefüllt', (await page.inputValue('.modal.open [name=limit_amount]')) === '12,50', await page.inputValue('.modal.open [name=limit_amount]'));
  await page.fill('.modal.open [name=name]', 'UI Budget 2');
  await submit(page);
  check('Budget bearbeitet', await page.locator('#s-body .card', { hasText: 'UI Budget 2' }).count() === 1);
  await page.click('#s-new');
  await page.fill('.modal.open [name=name]', 'x');
  await page.fill('.modal.open [name=limit_amount]', '0');
  await page.click('.modal.open button[type=submit]');
  await page.waitForSelector('.modal.open .auth-error:not([hidden])');
  check('Budget 0 wird abgelehnt', true);
  await page.click('.modal.open [data-x]');
  await page.locator('#s-body .card', { hasText: 'UI Budget 2' }).locator('[data-del]').click();
  await submit(page);
  check('Budget gelöscht', await page.locator('#s-body .card', { hasText: 'UI Budget 2' }).count() === 0);

  // Sport inkl. mehrfacher Seitenwechsel (keine doppelten Dialoge)
  at('alice sport');
  await go(page, '#/sport-bike'); await go(page, '#/sport-swim'); await go(page, '#/sport-run');
  check('Sporttitel', (await page.textContent('#view h1')) === 'Laufen');
  check('Chips einzeilig', await page.evaluate(() => { const c = [...document.querySelectorAll('.chips .chip')]; return c.length > 1 && c[0].getBoundingClientRect().top === c[1].getBoundingClientRect().top; }));
  await page.click('#route-new');
  check('nur ein Dialog nach Seitenwechseln', await page.locator('.modal.open').count() === 1);
  await page.fill('.modal.open [name=name]', 'UI Strecke');
  await page.fill('.modal.open [name=checkpoints]', '3');
  await page.fill('.modal.open [name=distance_km]', '4.5');
  await submit(page);
  const rc = page.locator('#sport-body .card', { hasText: 'UI Strecke' });
  check('Strecke angelegt', await rc.count() === 1);
  await rc.locator('[data-score-new]').click();
  await page.fill('.modal.open [name=score]', '42');
  await page.fill('.modal.open [name=duration]', '12:34');
  await page.fill('.modal.open [name=checkpoints_reached]', '2');
  await submit(page);
  check('Ergebnis in Bestenliste', /42/.test(await rc.textContent()) && /12:34/.test(await rc.textContent()), await rc.textContent());
  await rc.locator('[data-score-new]').click();
  await page.fill('.modal.open [name=score]', '1');
  await page.fill('.modal.open [name=duration]', 'abc');
  await page.click('.modal.open button[type=submit]');
  await page.waitForSelector('.modal.open .auth-error:not([hidden])');
  check('Ungültige Dauer gemeldet', true);
  await page.click('.modal.open [data-x]');
  await page.screenshot({ path: `${out}/alice-sport-scores.png` });
  await rc.locator('[data-score-del]').first().click();
  await submit(page);
  await rc.locator('[data-route-del]').click();
  await submit(page);
  check('Strecke gelöscht', await page.locator('#sport-body .card', { hasText: 'UI Strecke' }).count() === 0);
  await go(page, '#/sport-swim');
  check('Sportarten getrennt', !/Stadtpark/.test(await page.textContent('#view')));

  // Stundenzettel
  at('alice work');
  await go(page, '#/work');
  check('KPI Wochen-Soll', /Wochen-Soll/.test(await page.textContent('#work-kpis')) && !/Aktive Projekte/.test(await page.textContent('#work-kpis')));
  check('KPI-Karten nebeneinander', await page.evaluate(() => { const c = [...document.querySelectorAll('#work-kpis .card:not([hidden])')]; return c.length > 1 && c[0].getBoundingClientRect().top === c[1].getBoundingClientRect().top; }));
  check('Wochen-Soll Wert', /\S/.test(await page.textContent('#work-kpi-target')) && !/undefined|NaN/.test(await page.textContent('#view')));
  const modeSel = await page.$('#work-mode');
  if (modeSel) for (const v of await page.$$eval('#work-mode option', (o) => o.map((x) => x.value))) { await page.selectOption('#work-mode', v); await page.waitForTimeout(350); check(`Stundenzettel Modus ${v}`, !/undefined|NaN/.test(await page.textContent('#view'))); }

  // Gehalt: Konto direkt auf dem Stundenzettel wählbar, nicht passende Konten mit Begründung
  at('alice gehalt');
  await go(page, '#/budgets');
  await page.click('#view button:has-text("Neues Konto")');
  await page.fill('.modal.open [name=name]', 'Team-Kasse');
  await page.selectOption('.modal.open [name=type]', 'shared');
  await submit(page);
  await go(page, '#/work');
  check('Stundenzettel zeigt Gehaltskonto', /Gutschrift auf Giro neu/.test(await page.textContent('#pay-summary')), await page.textContent('#pay-summary'));
  await page.click('#pay-settings');
  const payOptions = () => page.$$eval('.modal.open [name=payroll_budget_id] option', (o) => o.map((x) => ({ text: x.textContent, off: x.disabled })));
  check('Eigenes Konto wählbar', (await payOptions()).some((o) => /UI Konto/.test(o.text) && !o.off), JSON.stringify(await payOptions()));
  check('Team-Konto mit Begründung gesperrt', (await payOptions()).some((o) => /Team-Kasse.*Konto einer Organisation/.test(o.text) && o.off), JSON.stringify(await payOptions()));
  check('Gehaltsdialog nach dem neuen Modell', !!(await page.$('.modal.open [name=daily_salary]')) && !!(await page.$('.modal.open [name=hourly_bonus_percent]')) && !(await page.$('.modal.open [name=hourly_rate]')));
  await page.selectOption('.modal.open [name=payroll_budget_id]', { label: 'UI Konto (EUR)' });
  await page.fill('.modal.open [name=daily_salary]', '1669');
  await page.fill('.modal.open [name=weekly_work_hours]', '13');
  await page.fill('.modal.open [name=hourly_bonus_percent]', '17');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/alice-gehalt.png` });
  await submit(page);
  const paySummary = await page.textContent('#pay-summary');
  check('Gehaltskonto gewechselt', /Gutschrift auf UI Konto/.test(paySummary), paySummary);
  // Währungsformate enthalten ein geschütztes Leerzeichen vor dem €, deshalb \s
  check('Festgehalt und Bonus wie vereinbart', /Festgehalt 1\.669,00\s€ pro Tag/.test(paySummary) && /13\sStd\./.test(paySummary) && /17 % = 283,73\s€ je Stunde/.test(paySummary), paySummary);
  check('Wochen-Soll oben aktualisiert', /13 Std\./.test(await page.textContent('#work-kpi-target')));
  await page.screenshot({ path: `${out}/alice-gehalt-karte.png` });
  await page.selectOption('#work-mode', 'month');
  await page.waitForTimeout(400);
  check('Monatsansicht nennt Festgehalt und Bonus', /Festgehalt: .*Bonus: .*Gesamt: /.test(await page.textContent('#work-list')) && !/undefined|NaN/.test(await page.textContent('#view')));
  await page.selectOption('#work-mode', 'week');
  await page.waitForTimeout(300);
  const teamCard = page.locator('#team-work-report .card', { hasText: 'carol' });
  check('Team-Stundenzettel nach dem neuen Modell', /Festgehalt .* pro Tag/.test(await teamCard.textContent()) && !/undefined|NaN/.test(await teamCard.textContent()));
  await teamCard.locator('[data-team-settings]').click();
  await page.waitForSelector('.modal.open form');
  check('Mitarbeitereinstellungen nach dem neuen Modell', !!(await page.$('.modal.open [name=daily_salary]')) && !(await page.$('.modal.open [name=hourly_rate]')));
  await page.click('.modal.open [data-x]');
  await go(page, '#/settings');
  check('Profil zeigt dasselbe Konto', /UI Konto/.test(await page.$eval('[name=payroll_budget_id]', (s) => s.selectedOptions[0].textContent)));
  check('Profil sperrt Team-Konto', await page.$eval('[name=payroll_budget_id]', (s) => [...s.options].some((o) => /Team-Kasse/.test(o.textContent) && o.disabled)));
  check('Profil zeigt dasselbe Festgehalt', Number(await page.inputValue('[name=daily_salary]')) === 1669 && Number(await page.inputValue('[name=hourly_bonus_percent]')) === 17);
  await page.selectOption('[name=currency]', 'CHF');
  check('Währungswechsel erklärt die leere Auswahl', /kein persönliches Konto in CHF/.test(await page.textContent('#p-payroll-hint')), await page.textContent('#p-payroll-hint'));
  await page.selectOption('[name=currency]', 'EUR');
  await page.selectOption('[name=payroll_budget_id]', { label: 'Giro neu (EUR)' });
  await page.click('#p-form .modal-foot button');
  await page.waitForTimeout(500);
  await go(page, '#/work');
  check('Im Profil gewähltes Konto gilt auch hier', /Gutschrift auf Giro neu/.test(await page.textContent('#pay-summary')));

  // Objekte: QR, PIN, Filter, Legacy-Links
  at('alice objekte');
  await go(page, '#/assets-keys');
  await page.click('#view [data-qr]');
  await page.waitForSelector('.modal.open img');
  check('QR-Code im Dialog', (await page.getAttribute('.modal.open img', 'src')).startsWith('data:image/png'));
  await page.screenshot({ path: `${out}/alice-qr.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('#modals .modal').forEach((m) => m.remove()));
  at('alice pin');
  await go(page, '#/assets-properties');
  await page.click('#view [data-reveal-pin]');
  await page.fill('.modal.open [name=password]', 'alice-Sehr-Sicher-9931!');
  await page.click('.modal.open button[type=submit]');
  await page.waitForTimeout(700);
  check('PIN wird angezeigt', /1234/.test(await page.textContent('body')));
  await page.evaluate(() => document.querySelectorAll('#modals .modal').forEach((m) => m.remove()));
  at('alice filter');
  const mk = await page.$('#view [data-manage-keys]');
  if (mk) { await mk.click(); await page.waitForTimeout(600); await settle(page); check('Schlüssel-Filter springt zur Schlüsselseite', (await page.evaluate(() => location.hash)).startsWith('#/assets-keys?filter=')); check('Filter zeigt Schlüssel', /Haustür/.test(await page.textContent('#view'))); }
  at('alice legacy');
  await go(page, '#/assets?tab=keys');
  check('Alter Link #/assets?tab=keys', (await page.textContent('#view h1')) === 'Schlüssel');
  await go(page, '#/assets?tab=costs');
  check('Alter Link #/assets?tab=costs', (await page.textContent('#view h1')) === 'Verwaltung');
  await go(page, '#/assets');
  check('Alter Link #/assets', (await page.textContent('#view h1')) === 'Fahrzeuge');

  // Hilfe
  at('alice hilfe');
  await go(page, '#/help');
  const total = await page.locator('[data-help-item]').count();
  await page.fill('#help-search', 'qwertzuiop');
  check('Hilfe-Suche leer', /Keine passende/.test(await page.textContent('#view')));
  for (const w of ['Budgets', 'Gehalt', 'Gehaltskonto', 'Festgehalt', 'Bonus', 'Sport', 'Gravatar', 'Fehler melden', 'Notizblock', 'ToDo', 'Deadline', 'Tickets', 'Woche']) { await page.fill('#help-search', w); check(`Hilfe kennt ${w}`, (await page.locator('[data-help-item]:visible').count()) > 0); }
  await page.fill('#help-search', 'Schlüssel');
  const vis = await page.locator('[data-help-item]:visible').count();
  check('Hilfe-Suche filtert', vis > 0 && vis < total, `${vis}/${total}`);

  // Rechtliches angemeldet
  at('alice legal');
  await go(page, '#/datenschutz');
  check('Datenschutz angemeldet', (await page.textContent('#view h1')) === 'Datenschutzerklärung');
  check('Sidebar bleibt angemeldet sichtbar', await page.locator('.sidebar').isVisible());

  // Einstellungen
  at('alice settings');
  await go(page, '#/settings');
  for (const t of await page.$$('#view [data-tab]')) { await t.click(); await page.waitForTimeout(200); check(`Einstellungen Tab ${await t.getAttribute('data-tab')}`, !(await viewErr(page))); }
  await page.screenshot({ path: `${out}/alice-settings.png` });

  // Abmelden
  at('alice logout');
  await page.evaluate(() => document.querySelector('[data-action=logout]')?.click());
  await page.waitForSelector('#login', { timeout: 5000 });
  check('Abmelden', true);
  await ctx.close();
}

// ---------- Admin
{
  const { page, at, ctx } = await session();
  at('admin-login');
  await login(page, 'admin@e2e.test', 'E2e-Admin-Passw0rd!x');
  const navs = await page.$$eval('.sidebar a.nav', (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => n.getAttribute('href')));
  for (const h of ['#/admin-users', '#/admin-server', '#/admin-tickets']) check(`Admin-Nav ${h}`, navs.includes(h));
  check('Sidebar zeigt App-Namen', /E2E Finanz/.test(await page.textContent('.sidebar .brand')));
  for (const h of navs) {
    at(`admin ${h}`);
    await go(page, h);
    check(`Admin ${h} ohne Fehler`, !(await viewErr(page)), await viewErr(page));
    for (const t of await page.$$('#view .tabs:not([hidden]) [data-tab]')) { await t.click(); await page.waitForTimeout(350); const tab = await t.getAttribute('data-tab'); check(`Admin ${h} Tab ${tab}`, !(await viewErr(page)), await viewErr(page)); if (h.includes('admin')) await page.screenshot({ path: `${out}/admin-${h.slice(2)}-${tab}.png` }); }
  }
  at('admin proxy');
  await go(page, '#/admin-server');
  await page.click('#view .tabs [data-tab=settings]');
  await page.waitForTimeout(400);
  check('Einstellungen zeigen TRUST_PROXY', /TRUST_PROXY/.test(await page.textContent('#view')));
  at('admin ablaufdatum');
  await go(page, '#/admin-users');
  await page.locator('#view tr', { hasText: 'carol@e2e.test' }).locator('[data-uedit]').click();
  check('Ablaufdatum sagt, bis wann es gilt', /bis einschließlich/.test(await page.textContent('.modal.open')));
  await page.click('.modal.open [data-x]');
  at('admin legacy');
  await go(page, '#/admin');
  check('Alter Link #/admin', (await page.textContent('#view h1')) === 'User-Management');
  at('admin leeres dashboard');
  await go(page, '#/dashboard');
  const emptyAxis = await page.$$eval('#d-cash text.axis[text-anchor="end"]', (t) => t.map((x) => x.textContent));
  check('Leeres Diagramm: Achse ohne doppelte Werte', new Set(emptyAxis).size === 5, emptyAxis.join());
  await page.click('#d-view [data-v=day]');
  await page.waitForTimeout(600);
  check('Leere Tagesansicht sauber', !/undefined|NaN/.test(await page.textContent('#d-body')));
  await page.screenshot({ path: `${out}/admin-dashboard-day-empty.png` });
  at('admin gehalt ohne konto');
  await go(page, '#/work');
  check('Ohne Konto ein klarer Hinweis auf der Seite', /Kein Konto für die Gehaltsgutschrift/.test(await page.textContent('#pay-summary')));
  await page.click('#pay-settings');
  check('Dialog erklärt, was fehlt', /kein persönliches Konto in EUR/.test(await page.textContent('.modal.open')), await page.textContent('.modal.open'));
  await page.screenshot({ path: `${out}/admin-gehalt-leer.png` });
  await page.click('.modal.open [data-x]');
  at('admin tickets');
  await go(page, '#/bug-report');
  await page.fill('#bug-report-form [name=title]', 'Admin-Ticket zum Löschen');
  await page.fill('#bug-report-form [name=description]', 'Beschreibung mit mindestens zwanzig Zeichen.');
  await page.click('#bug-report-form button[type=submit]');
  await page.locator('#bug-report-list .ticket', { hasText: 'Admin-Ticket zum Löschen' }).waitFor();
  await go(page, '#/admin-tickets');
  check('Ticket sichtbar', /Fehler im Test/.test(await page.textContent('#view')));
  const adminTicket = page.locator('#view .ticket', { hasText: 'Fehler im Test' });
  const commentsBefore = await adminTicket.locator('.ticket-comment').count();
  await adminTicket.locator('[name=body]').fill('Antwort vom Admin');
  await adminTicket.locator('[data-comment-form] button').click();
  await adminTicket.locator('.ticket-comment', { hasText: 'Antwort vom Admin' }).waitFor();
  check('Admin-Kommentar erscheint', await adminTicket.locator('.ticket-comment').count() === commentsBefore + 1);
  await adminTicket.locator('[name=body]').fill('Zweiter Kommentar');
  await adminTicket.locator('[data-comment-form] button').click();
  await adminTicket.locator('.ticket-comment', { hasText: 'Zweiter Kommentar' }).waitFor();
  check('Nach erneutem Zeichnen funktioniert das Formular weiter', await adminTicket.locator('.ticket-comment').count() === commentsBefore + 2);
  await page.screenshot({ path: `${out}/admin-ticket-comment.png` });
  await adminTicket.locator('.ticket-comment', { hasText: 'Zweiter Kommentar' }).locator('[data-comment-del]').click();
  check('Genau ein Dialog beim Kommentar-Löschen', await page.locator('.modal.open').count() === 1);
  await submit(page);
  check('Kommentar gelöscht', await adminTicket.locator('.ticket-comment').count() === commentsBefore + 1);
  const doomed = page.locator('#view .ticket', { hasText: 'Admin-Ticket zum Löschen' });
  await doomed.locator('[data-ticket-del]').click();
  await submit(page);
  check('Admin löscht Ticket', await doomed.count() === 0 && await adminTicket.count() === 1);
  at('admin auditlog in objekten');
  await go(page, '#/assets-manage');
  await page.click('#view .tabs [data-tab=audit]');
  await page.waitForSelector('#a-q');
  await page.fill('#a-q', 'login');
  await page.waitForTimeout(900);
  check('Auditlog-Suche behält Fokus', await page.evaluate(() => document.activeElement?.id === 'a-q'));
  await ctx.close();
}

// ---------- Viewer: keine Bearbeiten-Aktionen an Strecken
{
  const { page, at, ctx } = await session();
  at('carol');
  await login(page, 'carol@e2e.test', 'carol-Sehr-Sicher-9931!');
  await go(page, '#/sport-run');
  check('Viewer sieht Bestenliste', /Stadtpark/.test(await page.textContent('#view')));
  check('Viewer ohne Anlegen-Knopf', await page.locator('#route-new:visible').count() === 0);
  check('Viewer ohne Strecke-löschen', await page.locator('[data-route-del]').count() === 0);
  at('carol objekte');
  await go(page, '#/assets-vehicles');
  check('Viewer sieht Team-Fahrzeug', /E2E-1/.test(await page.textContent('#view')));
  check('Viewer ohne Bearbeiten und Löschen am Fahrzeug', await page.locator('#view [data-edit], #view [data-del]').count() === 0);
  await go(page, '#/assets-keys');
  check('Viewer sieht Team-Schlüssel', /Team-Tor/.test(await page.textContent('#view')));
  check('Viewer ohne Schlüssel-Aktionen', await page.locator('#view [data-edit], #view [data-del], #view [data-assign], #view [data-ret], #view [data-lost]').count() === 0);
  check('Viewer kann QR-Code weiter öffnen', await page.locator('#view [data-qr]').count() > 0);
  await go(page, '#/assets-people');
  check('Viewer ohne Personen-Aktionen', /Teamer/.test(await page.textContent('#view')) && await page.locator('#view [data-edit], #view [data-del]').count() === 0);
  at('carol notizen');
  await go(page, '#/notes');
  const teamNote = page.locator('#n-list .memo', { hasText: 'Team-Notiz' });
  check('Viewer liest Team-Notiz', await teamNote.count() === 1);
  check('Viewer ohne Notiz-Aktionen', await teamNote.locator('button').count() === 0);
  await page.click('#n-new');
  check('Viewer kann nur solo anlegen', (await page.$$eval('.modal.open [name=team_id] option', (o) => o.map((x) => x.textContent))).join() === 'Solo (nur für mich)');
  await page.click('.modal.open [data-x]');
  at('carol todos');
  await go(page, '#/todos');
  const teamTodo = page.locator('#t-list .todo-row', { hasText: 'Team-Protokoll' });
  check('Viewer sieht Team-ToDo', await teamTodo.count() === 1);
  check('Viewer kann nicht abhaken', await teamTodo.locator('[data-done]').isDisabled());
  check('Viewer ohne ToDo-Aktionen', await teamTodo.locator('button').count() === 0);
  at('carol einstellungen');
  await go(page, '#/settings');
  await page.click('#view .tabs [data-tab=notif]');
  await page.waitForTimeout(400);
  check('ToDo-Deadlines in den Einstellungen', /ToDo-Deadlines/.test(await page.textContent('#view')) && /Kommentare zu Tickets/.test(await page.textContent('#view')));
  check('Gespeicherte Abwahl bleibt', !(await page.isChecked('[name="todo_due.in_app"]')));
  check('E-Mail ist ohne Wahl aus', !(await page.isChecked('[name="ticket_comment.email"]')) && await page.isChecked('[name="ticket_comment.in_app"]'));
  at('carol organisation');
  await go(page, '#/teams');
  check('Leser sieht eigene Rechte', /Deine Rechte/.test(await page.textContent('#view')) && /Leser/.test(await page.textContent('#view')));
  check('Leser ohne Rechte-Tab', await page.locator('#view .tabs [data-tab=rights]').count() === 0 && await page.locator('#view .tabs [data-tab=members]').count() === 1);
  await page.click('#view .tabs [data-tab=members]');
  await page.waitForTimeout(300);
  check('Leser ohne Rang-Auswahl und Einladung', await page.locator('#view [data-rank], #t-inv').count() === 0);
  await ctx.close();
}

// ---------- Organisationen: Ränge, Gruppen und Rechte über die Oberfläche
{
  const { page, at, ctx } = await session();
  at('alice organisationen');
  await login(page, 'alice@e2e.test', 'alice-Sehr-Sicher-9931!');
  await go(page, '#/teams');
  check('Organisationen in der Navigation', /Organisationen/.test(await page.textContent('.sidebar')));
  check('Übersicht mit eigenen Rechten', /Deine Rechte/.test(await page.textContent('#view')) && /Inhaber/.test(await page.textContent('#view')));
  for (const tab of ['members', 'ranks', 'groups', 'rights']) {
    at(`alice organisationen ${tab}`);
    await page.click(`#view .tabs [data-tab=${tab}]`);
    await page.waitForTimeout(400);
    check(`Tab ${tab} ohne Fehler`, !(await viewErr(page)) && !/undefined|NaN/.test(await page.textContent('#t-panel')), (await page.textContent('#t-panel')).slice(0, 120));
  }
  at('alice rang');
  await page.click('#view .tabs [data-tab=ranks]');
  await page.waitForTimeout(300);
  await page.click('#r-new');
  await page.fill('.modal.open [name=name]', 'Praktikant');
  await submit(page);
  check('Rang angelegt', /Praktikant/.test(await page.textContent('#t-panel')));
  at('alice gruppe');
  await page.click('#view .tabs [data-tab=groups]');
  await page.waitForTimeout(300);
  await page.click('#g-new');
  await page.fill('.modal.open [name=name]', 'Streife');
  await page.fill('.modal.open [name=description]', 'Außendienst');
  await submit(page);
  check('Gruppe angelegt', /Streife/.test(await page.textContent('#t-panel')));
  at('alice gruppe zuweisen');
  await page.click('#view .tabs [data-tab=members]');
  await page.waitForTimeout(300);
  await page.locator('#t-panel tr', { hasText: 'carol@e2e.test' }).locator('[data-groups]').click();
  await page.locator('.modal.open label', { hasText: 'Streife' }).locator('input').check();
  await submit(page);
  await page.waitForTimeout(300);
  check('Gruppe beim Mitglied', /Streife/.test(await page.locator('#t-panel tr', { hasText: 'carol@e2e.test' }).textContent()));
  at('alice rechte');
  await page.click('#view .tabs [data-tab=rights]');
  await page.waitForTimeout(400);
  await page.selectOption('#r-subject', { label: 'Praktikant' });
  await page.waitForTimeout(400);
  const caseSelect = 'select[data-perm=casefile][data-scope=""]';
  check('Neuer Rang ohne Rechte', (await page.$eval(caseSelect, (s) => s.value)) === '0');
  await page.selectOption(caseSelect, '2');
  await page.waitForTimeout(600);
  check('Recht gespeichert', (await page.$eval(caseSelect, (s) => s.value)) === '2');
  check('Übersicht zeigt den Rang', /Praktikant/.test(await page.locator('#t-panel table.matrix').textContent()));
  await page.selectOption('#r-subject', { label: 'carol' });
  await page.waitForTimeout(500);
  check('Persönliche Rechte mit Wirksam-Spalte', /Wirksam/.test(await page.textContent('#t-panel')) && (await page.$eval(caseSelect, (s) => s.value)) === '');
  await page.screenshot({ path: `${out}/organisation-rechte.png`, fullPage: true });
  await ctx.close();
}

// ---------- Mobil & Dunkel
{
  const { page, at, ctx } = await session({ width: 390, height: 800 });
  at('mobil-login');
  await login(page, 'alice@e2e.test', 'alice-Sehr-Sicher-9931!');
  for (const h of ['#/dashboard', '#/transactions', '#/work', '#/budgets', '#/spending', '#/recurring', '#/goals', '#/reports', '#/teams', '#/calendar', '#/notes', '#/todos', '#/sport-run', '#/assets-vehicles', '#/assets-properties', '#/assets-people', '#/assets-keys', '#/assets-manage', '#/help', '#/bug-report', '#/settings', '#/impressum', '#/datenschutz']) {
    at(`mobil ${h}`);
    await go(page, h);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`Mobil ${h} kein horizontales Scrollen`, over <= 1, `${over}px`);
    if (['#/sport-run', '#/spending', '#/datenschutz', '#/work', '#/notes', '#/todos', '#/bug-report'].includes(h)) await page.screenshot({ path: `${out}/mobil-${h.slice(2)}.png` });
  }
  at('mobil dashboard ansichten');
  await go(page, '#/dashboard');
  for (const mode of ['day', 'week', 'month']) {
    await page.click(`#d-view [data-v=${mode}]`);
    await page.waitForTimeout(500);
    check(`Mobil Dashboard ${mode} kein horizontales Scrollen`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
    await page.screenshot({ path: `${out}/mobil-dashboard-${mode}.png` });
  }
  const mobileLabels = await page.evaluate(() => { document.querySelector('#d-view [data-v=day]').click(); return new Promise((resolve) => setTimeout(() => resolve([...document.querySelectorAll('#d-cash text.axis[text-anchor="middle"]')].map((t) => t.getBoundingClientRect())), 600)); });
  check('Mobil: Datumsachse überlappt nicht', mobileLabels.every((box, i) => !i || box.left >= mobileLabels[i - 1].right), String(mobileLabels.length));
  at('mobil menu');
  await page.click('#menuBtn');
  await page.waitForTimeout(300);
  check('Mobilmenü öffnet', await page.locator('.sidebar.open').count() === 1);
  await page.screenshot({ path: `${out}/mobil-menu.png` });
  await ctx.close();
}

await browser.close();
const uniq = [...new Set(problems)];
console.log(`\nBrowser-E2E: ${passed} bestanden, ${fails.length} fehlgeschlagen, ${uniq.length} Laufzeitprobleme`);
if (fails.length) console.log(fails.map((f) => ` - ${f}`).join('\n'));
if (uniq.length) console.log('Laufzeitprobleme:\n' + uniq.map((f) => ` - ${f}`).join('\n'));
process.exit(fails.length || uniq.length ? 1 : 0);
