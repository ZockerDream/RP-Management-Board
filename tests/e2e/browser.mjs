import { chromium } from 'playwright';
const BASE = 'http://localhost:18088';
const out = '/work/shots';
const fails = [], problems = [];
let passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else { fails.push(`${name} ${extra}`); console.log(`FAIL ${name} ${extra}`); } };

const browser = await chromium.launch();
const stamps = [];
const throttle = async () => { for (;;) { const now = Date.now(); while (stamps.length && now - stamps[0] > 61000) stamps.shift(); if (stamps.length < 200) return; await new Promise((r) => setTimeout(r, 1000)); } };
async function session(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let where = 'start';
  page.on('console', (m) => { if (m.type() === 'error' && !/gravatar|status of 4\d\d/i.test(m.text())) problems.push(`[${where}] console: ${m.text().slice(0, 220)}`); });
  page.on('pageerror', (e) => problems.push(`[${where}] pageerror: ${e.message.slice(0, 220)}`));
  page.on('request', () => stamps.push(Date.now()));
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
const go = async (page, hash) => { await throttle(); await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(150); await settle(page); await page.waitForTimeout(200); };
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
  for (const want of ['#/spending', '#/sport-run', '#/sport-swim', '#/sport-bike', '#/assets-vehicles', '#/assets-properties', '#/assets-people', '#/assets-keys', '#/assets-manage', '#/help', '#/bug-report', '#/datenschutz', '#/impressum']) check(`Nav ${want}`, navs.includes(want));
  for (const h of navs) {
    at(`alice ${h}`);
    await go(page, h);
    check(`Seite ${h} ohne Fehler`, !(await viewErr(page)), await viewErr(page));
    check(`Seite ${h} hat Inhalt`, ((await page.textContent('#view')) || '').trim().length > 10);
    for (const t of await page.$$('#view .tabs:not([hidden]) [data-tab]')) { await t.click(); await page.waitForTimeout(250); check(`${h} Tab ${await t.getAttribute('data-tab')}`, !(await viewErr(page)), await viewErr(page)); }
    const name = h.replace('#/', '');
    if (['dashboard', 'budgets', 'spending', 'sport-run', 'work', 'assets-manage', 'help', 'datenschutz', 'impressum'].includes(name)) await page.screenshot({ path: `${out}/alice-${name}.png` });
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
  await go(page, '#/transactions');
  check('Transaktionen zeigen zukünftige Buchung', /Zukunft Test/.test(await page.textContent('#view')));

  // Konten
  at('alice konten');
  await go(page, '#/budgets');
  check('Konto zeigt Kontostand', /Kontostand/.test(await page.textContent('#view')) && /Einkommen/.test(await page.textContent('#view')));
  await page.click('#view button:has-text("Neues Konto")');
  check('Kontoformular ohne Limit/Zeitraum', !(await page.$('.modal.open [name=limit_amount]')) && !(await page.$('.modal.open [name=period_type]')));
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
  for (const w of ['Budgets', 'Gehalt', 'Sport', 'Gravatar', 'Fehler melden']) { await page.fill('#help-search', w); check(`Hilfe kennt ${w}`, (await page.locator('[data-help-item]:visible').count()) > 0); }
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
  at('admin legacy');
  await go(page, '#/admin');
  check('Alter Link #/admin', (await page.textContent('#view h1')) === 'User-Management');
  at('admin tickets');
  await go(page, '#/admin-tickets');
  check('Ticket sichtbar', /Fehler im Test/.test(await page.textContent('#view')));
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
  await ctx.close();
}

// ---------- Mobil & Dunkel
{
  const { page, at, ctx } = await session({ width: 390, height: 800 });
  at('mobil-login');
  await login(page, 'alice@e2e.test', 'alice-Sehr-Sicher-9931!');
  for (const h of ['#/dashboard', '#/transactions', '#/work', '#/budgets', '#/spending', '#/recurring', '#/goals', '#/reports', '#/teams', '#/calendar', '#/sport-run', '#/assets-vehicles', '#/assets-properties', '#/assets-people', '#/assets-keys', '#/assets-manage', '#/help', '#/bug-report', '#/settings', '#/impressum', '#/datenschutz']) {
    at(`mobil ${h}`);
    await go(page, h);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`Mobil ${h} kein horizontales Scrollen`, over <= 1, `${over}px`);
    if (['#/sport-run', '#/spending', '#/datenschutz', '#/work'].includes(h)) await page.screenshot({ path: `${out}/mobil-${h.slice(2)}.png` });
  }
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
