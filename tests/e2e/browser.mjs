import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:18089';
const out = '/work/shots';
const fails = [], problems = [];
// Gültiges 1×1-PNG, damit der Browser die Vorschau wirklich darstellen kann
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else { fails.push(`${name} ${extra}`); console.log(`FAIL ${name} ${extra}`); } };

const browser = await chromium.launch();
async function session(viewport = { width: 1400, height: 900 }) {
  // de-DE wie bei echten Benutzern; ohne meldet Headless-Chromium „en-US@posix“, daran stürzt der eingebettete Spotify-Player ab
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'de-DE' });
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
async function login(page, email, password, { keepChoice = false } = {}) {
  await page.goto(`${BASE}/#/login`);
  await page.fill('#login [name=email]', email);
  await page.fill('#login [name=password]', password);
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.app:not(.hidden) #view');
  await settle(page);
  // Einmaliger Design-Dialog nach dem ersten Login: „Später“, außer der Test prüft ihn selbst
  if (!keepChoice && (await page.waitForSelector('.design-choice', { timeout: 1500 }).catch(() => null))) {
    await page.click('.design-choice [data-x]');
    await page.waitForSelector('.design-choice', { state: 'detached' });
  }
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
  // Personen laufen seit 2026-11-10 über die Personenakten; alte Links führen dorthin
  check('Keine eigene Seite „Personen“ mehr', !navs.includes('#/assets-people'), navs.join());
  for (const old of ['#/assets-people', '#/assets?tab=people']) {
    await page.evaluate((h) => { location.hash = h; }, old);
    await until(page, () => location.hash === '#/casefiles?tab=people' && !!document.querySelector('#pf-q')).catch(() => {});
    check(`Alter Link ${old} führt zu den Personenakten`, (await page.evaluate(() => location.hash)) === '#/casefiles?tab=people' && !!(await page.$('#pf-q')), await page.evaluate(() => location.hash));
  }
  for (const want of ['#/changelog', '#/notes', '#/todos', '#/spending', '#/sport-run', '#/sport-swim', '#/sport-bike', '#/assets-vehicles', '#/assets-properties', '#/assets-keys', '#/assets-manage', '#/help', '#/bug-report', '#/datenschutz', '#/impressum', '#/music', '#/speedcams']) check(`Nav ${want}`, navs.includes(want));
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
  // Der Golf (E2E-R) ist ausgemustert: weder im Fuhrpark noch mit Service unter „Als Nächstes“
  check('Dashboard ohne ausgemusterte Fahrzeuge', /Fuhrpark/.test(dashboardText) && !/Golf|Ausgemustert/.test(dashboardText), dashboardText.slice(dashboardText.indexOf('Fuhrpark'), dashboardText.indexOf('Fuhrpark') + 300));
  const forecastCard = page.locator('#d-body .card', { hasText: 'Prognose' });
  check('Dashboard zeigt die Wochenprognose', await forecastCard.count() === 1 && /Diese Woche/.test(await forecastCard.textContent()) && /Nächste Woche/.test(await forecastCard.textContent()) && /Erwartet/.test(await forecastCard.textContent()) && !/NaN|undefined/.test(await forecastCard.textContent()), await forecastCard.textContent().catch(() => ''));
  await page.screenshot({ path: `${out}/alice-dashboard-prognose.png`, fullPage: true });
  await go(page, '#/transactions');
  check('Transaktionen zeigen zukünftige Buchung', /Zukunft Test/.test(await page.textContent('#view')));

  // Screenshot-Scanning: nachgebaute Bank-Apps rendern, als Bild scannen und die Vorschläge prüfen
  at('alice screenshot scan');
  const day = (offset) => page.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString('sv-SE'); }, offset);
  const [d0, d1, d2] = [await day(0), await day(-1), await day(-2)];
  const de = (iso) => iso.split('-').reverse().join('.');
  const css = (bg, fg) => `body{margin:0;background:${bg};color:${fg};font:16px/1.4 Arial,sans-serif}.app{padding:18px}.row{display:flex;justify-content:space-between;padding:10px 0 2px}.sub{font-size:13px;opacity:.75;padding-bottom:8px;border-bottom:1px solid #8884}.neg{color:#e5484d}.pos{color:#30a46c}h1{font-size:22px}h2{font-size:15px;margin:16px 0 4px;opacity:.8}`;
  const mocks = [
    { name: 'hell, Datum unter der Buchung', size: { width: 390, height: 520 },
      html: `<style>${css('#fff', '#111')}</style><div class=app><h1>Fleeca Bank</h1><div>Kontostand: $ 48,250.00</div>
        <div class=row><span>Benny's Motorworks</span><span class=neg>-$12,500.00</span></div><div class=sub>Heute, 14:32</div>
        <div class=row><span>Gehalt LSPD</span><span class=pos>+$1,669.00</span></div><div class=sub>Heute, 03:45</div>
        <div class=row><span>Burger Shot</span><span class=neg>-$23.50</span></div><div class=sub>Gestern, 19:10</div></div>`,
      expect: [['Benny', '12500.00', 'expense', d0], ['Gehalt', '1669.00', 'income', d0], ['Burger', '23.50', 'expense', d1]] },
    { name: 'dunkel, Datum als Überschrift, deutsche Beträge', size: { width: 390, height: 460 },
      html: `<style>${css('#121418', '#f2f2f2')}</style><div class=app><h1>Umsätze</h1><h2>${de(d1)}</h2>
        <div class=row><span>Überweisung von Max Mustermann</span><span class=pos>+5.000,00 $</span></div>
        <div class=row><span>Tankstelle Route 68</span><span class=neg>-85,20 $</span></div><h2>${de(d2)}</h2>
        <div class=row><span>Miete Apartment</span><span class=neg>-1.200,00 $</span></div></div>`,
      expect: [['Max Mustermann', '5000.00', 'income', d1], ['Tankstelle', '85.20', 'expense', d1], ['Miete', '1200.00', 'expense', d2]] },
    { name: 'Handy im Spielbild', size: { width: 1600, height: 900 },
      html: `<style>body{margin:0;width:1600px;height:900px;background:linear-gradient(135deg,#2b5876,#4e4376 40%,#c06c84 70%,#f8b195);font:17px/1.4 Arial,sans-serif;position:relative;overflow:hidden}
        .blob{position:absolute;border-radius:50%;opacity:.5}.phone{position:absolute;right:120px;top:90px;width:360px;height:700px;background:#0d0f14;border-radius:36px;border:10px solid #222;color:#fff;padding:28px 22px;box-sizing:border-box}
        .row{display:flex;justify-content:space-between;padding:12px 0 2px}.sub{font-size:14px;color:#aab;padding-bottom:8px;border-bottom:1px solid #333}.neg{color:#ff6b6b}.pos{color:#5fdc8f}</style>
        ${Array.from({ length: 14 }, (_, i) => `<div class=blob style="left:${(i * 97) % 1100}px;top:${(i * 53) % 800}px;width:${60 + (i * 37) % 160}px;height:${60 + (i * 37) % 160}px;background:hsl(${i * 47},70%,55%)"></div>`).join('')}
        <div class=phone><div style="font-size:22px;font-weight:bold">Maze Bank</div><div class=sub>Verlauf</div>
        <div class=row><span>Received from Jimmy</span><span class=pos>+$250</span></div><div class=sub>Today 21:04</div>
        <div class=row><span>Paid to Ammu-Nation</span><span class=neg>-$1,450</span></div><div class=sub>Yesterday 18:22</div></div>`,
      expect: [['Jimmy', '250.00', 'income', d0], ['Ammu', '1450.00', 'expense', d1]] },
  ];
  const shot = await ctx.newPage();
  const scanRows = () => page.$$eval('.modal.open [data-scan-row]', (rows) => rows.map((r) => ({
    use: r.querySelector('[data-k=use]').checked, date: r.querySelector('[data-k=booked_at]').value, title: r.querySelector('[data-k=title]').value,
    type: r.querySelector('[data-k=type]').value, amount: r.querySelector('[data-k=amount]').value.replace(',', '.'), text: r.textContent,
  })));
  const scanImage = async (buffer) => {
    await page.setInputFiles('.modal.open #scan-file', { name: 'screenshot.png', mimeType: 'image/png', buffer });
    await until(page, () => !!document.querySelector('.modal.open [data-scan-row]') || /kein Betrag|Nur PNG|nicht/.test(document.querySelector('.modal.open #scan-status')?.textContent || ''), undefined, 60000).catch(() => {});
    return scanRows();
  };
  const scanned = [];
  for (const mock of mocks) {
    await shot.setViewportSize(mock.size);
    await shot.setContent(mock.html);
    const buffer = await shot.screenshot();
    await page.click('#t-scan');
    await page.waitForSelector('.modal.open #scan-drop');
    const rows = await scanImage(buffer);
    scanned.push({ mock, buffer, rows });
    const missing = mock.expect.filter(([title, amount, type, date]) => !rows.some((r) => r.title.includes(title) && r.amount === amount && r.type === type && r.date === date));
    check(`Scan ${mock.name}: alle Buchungen erkannt`, !missing.length, `fehlt: ${JSON.stringify(missing)} erkannt: ${JSON.stringify(rows.map(({ text, ...r }) => r))} Text: ${(await page.textContent('.modal.open .scan-text').catch(() => '')).slice(0, 400)}`);
    check(`Scan ${mock.name}: kein Kontostand als Buchung`, !rows.some((r) => r.amount === '48250.00'));
    await page.screenshot({ path: `${out}/alice-scan-${scanned.length}.png`, fullPage: true });
    await page.click('.modal.open [data-x]');
  }
  // Buchen: nur angehakte Vorschläge, danach als „schon gebucht“ erkannt
  await page.click('#t-scan');
  await page.waitForSelector('.modal.open #scan-drop');
  const firstRows = await scanImage(scanned[0].buffer);
  check('Neue Vorschläge sind angehakt', firstRows.length >= 3 && firstRows.every((r) => r.use), JSON.stringify(firstRows));
  await page.locator('.modal.open [data-scan-row]', { has: page.locator('[data-k=title][value*="Gehalt"]') }).locator('[data-k=use]').uncheck();
  await page.locator('.modal.open [data-scan-row]', { has: page.locator('[data-k=title][value*="Burger"]') }).locator('[data-k=title]').fill('Burger Shot Mittag');
  await page.click('.modal.open button[type=submit]');
  await until(page, () => !document.querySelector('.modal.open #scan-drop'), undefined, 10000).catch(() => {});
  await page.waitForTimeout(500);
  const listText = await page.textContent('#view');
  check('Gebuchte Vorschläge mit Kennzeichen Import', /Benny's Motorworks/.test(listText) && /Burger Shot Mittag/.test(listText) && await page.locator('#view tr', { hasText: 'Burger Shot Mittag' }).locator('.tag', { hasText: 'Import' }).count() === 1);
  check('Abgewählter Vorschlag nicht gebucht', await page.locator('#view tr', { hasText: 'Gehalt LSPD' }).count() === 0);
  await page.click('#t-scan');
  await page.waitForSelector('.modal.open #scan-drop');
  const againRows = await scanImage(scanned[0].buffer);
  check('Zweiter Scan erkennt Gebuchtes', againRows.filter((r) => /schon gebucht/.test(r.text)).length === 2 && againRows.filter((r) => r.use).length === againRows.length - 2, JSON.stringify(againRows.map((r) => [r.title, r.use])));
  await page.click('.modal.open [data-x]');
  await shot.close();
  // Wieder entfernen, damit spätere Prüfungen dieselben Summen sehen
  for (const title of ["Benny's Motorworks", 'Burger Shot Mittag']) {
    await page.locator('#view tr', { hasText: title }).locator('[data-del]').click();
    await submit(page);
  }

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
  await page.fill('.modal.open [name=body]', 'Zeile 1\nZeile 2 mit **fett** und [Link](https://example.org)\n\n<i onclick="alert(1)">kein HTML</i>');
  await submit(page);
  const noteCard = page.locator('#n-list .memo', { hasText: 'UI Notiz' });
  check('Notiz angelegt', await noteCard.count() === 1);
  // Notizen sind Markdown: Zeilenumbruch bleibt, **fett** und Links werden formatiert, HTML wird nur angezeigt
  check('Zeilenumbrüche bleiben', await noteCard.locator('.memo-body').evaluate((n) => n.querySelectorAll('p br').length === 1 && /Zeile 1/.test(n.textContent) && /Zeile 2/.test(n.textContent)));
  check('Markdown in Notizen', await noteCard.locator('.memo-body').evaluate((n) => n.querySelector('strong')?.textContent === 'fett' && n.querySelector('a[href="https://example.org"][rel~=noopener]') !== null));
  check('HTML mit Attributen wird nur angezeigt', await noteCard.locator('.memo-body').evaluate((n) => n.textContent.includes('<i onclick="alert(1)">kein HTML</i>') && !n.querySelector('[onclick], i')));
  await noteCard.locator('[data-edit]').click();
  check('Notiz vorbefüllt mit dem Rohtext', (await page.inputValue('.modal.open [name=body]')).startsWith('Zeile 1\nZeile 2 mit **fett**'));
  await page.selectOption('.modal.open [name=team_id]', { label: 'Organisation: E2E Team' });
  await submit(page);
  check('Notiz im Team', /E2E Team/.test(await noteCard.textContent()));
  await noteCard.locator('[data-pin]').click();
  check('Angeheftet sofort vorn (ohne auf den Server zu warten)', /UI Notiz/.test(await page.locator('#n-list .memo').first().textContent()));
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
  // Tags: mehrere je Notiz, nur Markierung und Filter
  at('alice notiz-tags');
  await noteCard.locator('[data-tags]').click();
  check('Tag-Dialog zeigt die Standard-Tags', await page.locator('.modal.open input[name=tag_ids]').count() === 4);
  await page.check('.modal.open label.row:has-text("WIP") input[name=tag_ids]');
  await page.check('.modal.open label.row:has-text("BLOCKED") input[name=tag_ids]');
  await submit(page);
  check('Tags an der Karte', await noteCard.locator('.memo-tags .tag').allTextContents().then((t) => t.join() === 'BLOCKED,WIP'), (await noteCard.locator('.memo-tags').textContent().catch(() => '')));
  await page.selectOption('#n-tag', { label: 'WIP' });
  check('Filter nach Tag', await noteCard.count() === 1 && await page.locator('#n-list .memo').count() === 1);
  await page.selectOption('#n-tag', 'none');
  check('Filter ohne Tag', await noteCard.count() === 0);
  await page.selectOption('#n-tag', '');
  await page.fill('#n-search', 'blocked');
  check('Suche findet Tag-Namen', await noteCard.count() === 1);
  await page.fill('#n-search', '');
  await page.screenshot({ path: `${out}/alice-notes-tags.png` });
  await noteCard.locator('[data-edit]').click();
  check('Bearbeiten zeigt gesetzte Tags', await page.isChecked('.modal.open label.row:has-text("WIP") input[name=tag_ids]') && !(await page.isChecked('.modal.open label.row:has-text("DONE") input[name=tag_ids]')));
  await page.uncheck('.modal.open label.row:has-text("BLOCKED") input[name=tag_ids]');
  await submit(page);
  check('Tag im Formular entfernt', (await noteCard.locator('.memo-tags').textContent()).trim() === 'WIP');
  // Archiv: eigener Knopf, Ansicht Offen | Archiv | Alle
  at('alice notiz-archiv');
  check('Ansicht startet mit Offen', await page.locator('#n-state [data-state=open].on').count() === 1);
  await noteCard.locator('[data-archive]').click();
  await until(page, () => ![...document.querySelectorAll('#n-list .memo')].some((n) => n.textContent.includes('UI Notiz')));
  check('Archivierte Notiz verschwindet aus Offen', await noteCard.count() === 0);
  await page.click('#n-state [data-state=archived]');
  check('Ansicht Archiv zeigt nur sie', await noteCard.count() === 1 && /Archiviert/.test(await noteCard.textContent()) && await page.locator('#n-list .memo').count() === 1);
  check('Archiviert: kein Anheften, Tags bleiben', await noteCard.locator('[data-pin]').count() === 0 && !/Angeheftet/.test(await noteCard.textContent()) && /WIP/.test(await noteCard.textContent()));
  await page.screenshot({ path: `${out}/alice-notes-archive.png` });
  await page.click('#n-state [data-state=all]');
  check('Ansicht Alle zeigt offene und archivierte', await noteCard.count() === 1 && await page.locator('#n-list .memo', { hasText: 'Meine Notiz' }).count() === 1);
  await noteCard.locator('[data-archive]').click();
  await until(page, () => /Archivieren/.test([...document.querySelectorAll('#n-list .memo')].find((n) => n.textContent.includes('UI Notiz'))?.textContent || ''));
  await page.click('#n-state [data-state=open]');
  check('Wiederhergestellt wieder unter Offen', await noteCard.count() === 1 && !/Archiviert/.test(await noteCard.textContent()));
  await noteCard.locator('[data-del]').click();
  await submit(page);
  check('Notiz gelöscht', await noteCard.count() === 0);

  // Markdown-Editor: Werkzeugleiste, Tastenkürzel, Listen fortsetzen, Vorschau, Nebeneinander, Vollbild, Hilfe
  at('alice markdown editor');
  await page.click('#n-new');
  check('Editor mit Werkzeugleiste', await page.locator('.modal.open .md-toolbar [data-md-tool]').count() >= 18);
  await page.fill('.modal.open [name=title]', 'Editor Notiz');
  const mdBody = page.locator('.modal.open [name=body]');
  await mdBody.fill('wichtig');
  await mdBody.selectText();
  await page.click('.modal.open [data-md-tool=bold]');
  check('Fett-Knopf umschließt die Auswahl', (await mdBody.inputValue()) === '**wichtig**', await mdBody.inputValue());
  await page.click('.modal.open [data-md-tool=bold]');
  check('Zweiter Klick nimmt Fett zurück', (await mdBody.inputValue()) === 'wichtig', await mdBody.inputValue());
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B');
  check('Strg+B formatiert fett', (await mdBody.inputValue()) === '**wichtig**', await mdBody.inputValue());
  await mdBody.press('End');
  await page.keyboard.type('\n\n- eins');
  await page.keyboard.press('Enter');
  await page.keyboard.type('zwei');
  check('Enter setzt die Liste fort', (await mdBody.inputValue()).endsWith('- eins\n- zwei'), await mdBody.inputValue());
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  check('Enter im leeren Punkt beendet die Liste', !(await mdBody.inputValue()).endsWith('- '), JSON.stringify(await mdBody.inputValue()));
  await page.keyboard.type('Fußnote[^1]\n\n[^1]: Mehr dazu');
  await page.click('.modal.open [data-md-tool=table]');
  check('Tabelle eingefügt und erste Überschrift markiert', /\| Spalte 1 \| Spalte 2 \|\n\| --- \| --- \|/.test(await mdBody.inputValue()) && await mdBody.evaluate((t) => t.value.slice(t.selectionStart, t.selectionEnd) === 'Spalte 1'));
  await page.keyboard.type('Name');
  await page.click('.modal.open [data-md-tool=preview]');
  const previewOk = await page.evaluate(() => {
    const m = document.querySelector('.modal.open');
    const p = m.querySelector('.md-preview');
    return !p.hidden && m.querySelector('[name=body]').hidden && p.querySelector('strong')?.textContent === 'wichtig'
      && p.querySelectorAll('ul > li').length === 2 && p.querySelector('th')?.textContent === 'Name' && !!p.querySelector('.md-footnotes');
  });
  check('Vorschau zeigt das Ergebnis', previewOk);
  check('In der Vorschau ruhen die Formatknöpfe', await page.locator('.modal.open [data-md-tool=bold]').isDisabled());
  await page.click('.modal.open [data-md-tool=split]');
  await mdBody.press('Control+End');
  await page.keyboard.type('\n\n> [!TIP]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Neu getippt');
  check('Enter setzt das Zitat fort', (await mdBody.inputValue()).endsWith('> [!TIP]\n> Neu getippt'), JSON.stringify((await mdBody.inputValue()).slice(-40)));
  await until(page, () => !!document.querySelector('.modal.open .md-preview .md-alert-tip'));
  check('Nebeneinander: Vorschau folgt beim Tippen', await page.locator('.modal.open [name=body]').isVisible() && /Neu getippt/.test(await page.textContent('.modal.open .md-preview')));
  await page.click('.modal.open [data-md-tool=fullscreen]');
  check('Vollbild', await page.evaluate(() => { const e = document.querySelector('.modal.open .md-editor'); const r = e.getBoundingClientRect(); return e.classList.contains('md-fullscreen') && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }));
  await page.screenshot({ path: `${out}/alice-markdown-vollbild.png` });
  await mdBody.press('Escape');
  check('Esc beendet nur das Vollbild, der Dialog bleibt', await page.locator('.modal.open .md-editor.md-fullscreen').count() === 0 && await page.locator('.modal.open [name=body]').count() === 1);
  await page.click('.modal.open [data-md-tool=help]');
  check('Hilfe zeigt Beispiele mit Ergebnis', await page.locator('.modal.open .md-help .md-help-row').count() >= 10 && await page.locator('.modal.open .md-help table').count() === 1);
  await page.screenshot({ path: `${out}/alice-markdown-editor.png` });
  await submit(page);
  const mdCard = page.locator('#n-list .memo', { hasText: 'Editor Notiz' });
  check('Notiz mit Tabelle, Liste und Hinweis-Kasten', await mdCard.locator('.memo-body').evaluate((n) => !!n.querySelector('table th') && n.querySelectorAll('li').length >= 2 && !!n.querySelector('.md-alert-tip')));
  await mdCard.locator('.md-fn').first().click();
  await page.waitForTimeout(300);
  check('Fußnote springt, ohne die Seite zu wechseln', (await page.evaluate(() => location.hash)) === '#/notes');
  await mdCard.locator('[data-del]').click();
  await submit(page);

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
  await page.fill('.modal.open [name=note]', 'Mit <b onclick="x()">Notiz</b>');
  await submit(page);
  check('ToDo-Notiz: HTML mit Attributen bleibt Text', /<b onclick="x\(\)">Notiz<\/b>/.test(await todoRow.textContent()) && await todoRow.locator('[onclick]').count() === 0);
  // Optimistische Anzeige: lehnt der Server ab, springt das ToDo zurück
  const refuse = (route) => (route.request().method() === 'PATCH'
    ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden', message: 'Test: abgelehnt' }) })
    : route.continue());
  await page.route('**/api/todos/*', refuse);
  await todoRow.locator('[data-done]').click();
  await page.locator('.toast', { hasText: 'Test: abgelehnt' }).first().waitFor({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  check('Abgelehnt: ToDo springt zurück', await todoRow.count() === 1 && !(await todoRow.locator('[data-done]').isChecked()));
  await page.unroute('**/api/todos/*', refuse);
  // Abhaken wirkt sofort, ohne auf den Server zu warten (Element wird neu gezeichnet, deshalb click statt check)
  let releasePatch;
  const slow = async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await new Promise((resolve) => { releasePatch = resolve; });
    return route.continue();
  };
  await page.route('**/api/todos/*', slow);
  await todoRow.locator('[data-done]').click();
  check('Abgehakt verschwindet sofort aus Offen', await todoRow.count() === 0);
  releasePatch?.();
  await page.waitForTimeout(500);
  await page.unroute('**/api/todos/*', slow);
  check('Abgehakt bleibt aus Offen', await todoRow.count() === 0);
  await page.click('#t-status [data-status=done]');
  check('Erledigt zeigt es mit Name', /Erledigt .* von alice/.test(await todoRow.textContent()), await todoRow.textContent());
  await page.screenshot({ path: `${out}/alice-todos-done.png` });
  await todoRow.locator('[data-done]').click();
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
  // ToDo-Deadlines stehen im Kalender, mit eigenem Filter
  await go(page, '#/calendar');
  await until(page, () => !!document.querySelector('#cal-filters [data-filter="todo"]')).catch(() => {});
  check('Kalenderfilter für ToDo-Deadlines', /ToDo-Deadlines/.test(await page.textContent('#cal-filters')));
  await page.click('#cal [data-view=agenda]');
  await page.waitForTimeout(200);
  check('ToDo-Deadline in der Agenda', /ToDo: Steuer abgeben/.test(await page.textContent('#cal-body')), (await page.textContent('#cal-body')).slice(0, 300));
  await page.uncheck('#cal-filters [data-filter="todo"]');
  check('Filter blendet ToDo-Deadlines aus', !/ToDo: Steuer abgeben/.test(await page.textContent('#cal-body')));
  await page.check('#cal-filters [data-filter="todo"]');

  // Eigene Tickets
  at('alice tickets');
  await go(page, '#/bug-report');
  await page.fill('#bug-report-form [name=title]', 'UI Ticket zum Löschen');
  await page.fill('#bug-report-form [name=description]', 'Beschreibung mit mindestens zwanzig Zeichen.');
  await page.click('#bug-report-form button[type=submit]');
  const ownTicket = page.locator('#bug-report-list .ticket', { hasText: 'UI Ticket zum Löschen' });
  await ownTicket.waitFor();
  await ownTicket.locator('[name=body]').fill('   ');
  check('Kommentarfeld bekommt beim Fokus die Werkzeugleiste', await ownTicket.locator('[data-comment-form] .md-toolbar').count() === 1);
  await ownTicket.locator('[data-comment-form] button[type=submit]').click();
  await page.waitForTimeout(200);
  check('Leerer Kommentar wird nicht gesendet', await ownTicket.locator('.ticket-comment').count() === 0);
  await ownTicket.locator('[name=body]').fill('Mein Kommentar <i class="y">x</i>\nzweite Zeile');
  await ownTicket.locator('[data-comment-form] button[type=submit]').click();
  await ownTicket.locator('.ticket-comment').waitFor();
  check('Kommentar: HTML mit Attributen bleibt Text', /<i class="y">x<\/i>/.test(await ownTicket.locator('.ticket-comment').textContent()) && /alice/.test(await ownTicket.locator('.ticket-comment').textContent()));
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
  // Persönliche Konten stehen vorn und sind vorausgewählt (vorher kam „Team-Kasse“ zuerst)
  const firstCard = page.locator('#b-body [data-sel]').first();
  check('Persönliches Konto zuerst gewählt', /Persönlich/.test(await firstCard.textContent()) && /outline/.test(await firstCard.getAttribute('style')), await firstCard.textContent());
  // Zinsen einschalten, anzeigen und wieder abschalten
  const uiCard = () => page.locator('#b-body [data-sel]', { hasText: 'UI Konto' });
  await uiCard().locator('[data-edit]').click();
  await page.waitForSelector('.modal.open [name=interest_rate]');
  await page.fill('.modal.open [name=interest_rate]', '1,5');
  await page.selectOption('.modal.open [name=interest_period]', 'monthly');
  await submit(page);
  await until(page, () => /Zinsen 1,5/.test(document.querySelector('#b-body')?.textContent || '')).catch(() => {});
  const interestCard = await uiCard().textContent();
  check('Konto zeigt Zinsen und nächste Gutschrift', /Zinsen 1,5 % pro Monat/.test(interestCard) && /Nächste Gutschrift am \d\d\.\d\d\.\d{4}/.test(interestCard), interestCard);
  await page.screenshot({ path: `${out}/alice-konto-zinsen.png` });
  await uiCard().locator('[data-edit]').click();
  await page.waitForSelector('.modal.open [name=interest_rate]');
  check('Zinssatz im Formular', (await page.inputValue('.modal.open [name=interest_rate]')) === '1,5' && (await page.inputValue('.modal.open [name=interest_period]')) === 'monthly');
  await page.fill('.modal.open [name=interest_rate]', '');
  await submit(page);
  await until(page, () => !/Zinsen 1,5/.test(document.querySelector('#b-body')?.textContent || '')).catch(() => {});
  check('Zinsen wieder aus', !/Zinsen/.test(await uiCard().textContent()));

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
  check('Kein Distanzfeld', await page.locator('.modal.open [name=distance_km]').count() === 0);
  await page.fill('.modal.open [name=laps]', '4');
  await submit(page);
  const rc = page.locator('#sport-body .card', { hasText: 'UI Strecke' });
  check('Strecke angelegt', await rc.count() === 1);
  await rc.locator('[data-score-new]').click();
  check('Kein Punktefeld', await page.locator('.modal.open [name=score]').count() === 0);
  await page.fill('.modal.open [name=duration]', '12:34:56');
  check('Kein Feld für erreichte Checkpoints', await page.locator('.modal.open [name=checkpoints_reached]').count() === 0);
  await submit(page);
  check('Ergebnis in Bestenliste', /12:34:56/.test(await rc.textContent()) && /Bestzeit 12:34:56/.test(await rc.textContent()) && /4 Runden/.test(await rc.textContent()) && !/ km/.test(await rc.textContent()) && !/Punkte/.test(await rc.textContent()), await rc.textContent());
  await rc.locator('[data-score-new]').click();
  await page.fill('.modal.open [name=duration]', '12:61:00');
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
  // Stundenzettel der Organisation ohne die eigene Person, mit Mitarbeitersuche; Stunden aus Beginn, Ende und Pause
  at('alice stundenzettel suche');
  await until(page, () => document.querySelectorAll('#team-work-report h3').length > 0).catch(() => {});
  const teamNames = () => page.$$eval('#team-work-report h3', (h) => h.map((x) => x.textContent.trim()));
  check('Eigene Person nicht im Stundenzettel der Organisation', (await teamNames()).length > 0 && !(await teamNames()).includes('alice'), (await teamNames()).join());
  await page.fill('#team-work-search', 'car');
  check('Mitarbeitersuche filtert', (await teamNames()).join() === 'carol', (await teamNames()).join());
  await page.fill('#team-work-search', 'niemand');
  check('Suche ohne Treffer erklärt sich', /Kein Mitarbeiter passt zur Suche/.test(await page.textContent('#team-work-report')));
  await page.fill('#team-work-search', '');
  check('Leere Suche zeigt wieder alle', (await teamNames()).length >= 2, (await teamNames()).join());
  await page.click('#work-new');
  await page.waitForSelector('.modal.open [name=started_at]');
  await page.fill('.modal.open [name=started_at]', '22:00');
  await page.fill('.modal.open [name=ended_at]', '02:30');
  await page.fill('.modal.open [name=break_minutes]', '30');
  check('Stunden aus Beginn, Ende und Pause (über Mitternacht)', (await page.inputValue('.modal.open [name=hours]')) === '4', await page.inputValue('.modal.open [name=hours]'));
  await page.fill('.modal.open [name=ended_at]', '23:15');
  check('Stunden folgen jeder Änderung', (await page.inputValue('.modal.open [name=hours]')) === '0.75', await page.inputValue('.modal.open [name=hours]'));
  await page.fill('.modal.open [name=hours]', '1.5');
  check('Stunden bleiben von Hand änderbar', (await page.inputValue('.modal.open [name=hours]')) === '1.5');
  await page.click('.modal.open [data-x]');

  // Objekte: QR, PIN, Filter, Legacy-Links
  // Fahrzeuge: Besitzer als Person, ausgemusterte markiert, Bilder mit Galerie und Großansicht
  at('alice fahrzeuge');
  await go(page, '#/assets-vehicles');
  check('Besitzerin als Link zur Personenakte', await page.locator('#view a[href^="#/casefiles?person="]', { hasText: 'Hanna Halter' }).count() === 1);
  check('Ausgemustertes Fahrzeug markiert', /Ausgemustert/.test(await page.locator('#view tr', { hasText: 'Golf' }).textContent()));
  await page.locator('#view tr', { hasText: 'Polo' }).locator('[data-edit]').click();
  await page.waitForSelector('.modal.open [name=owner_person_id]');
  check('Besitzer aus der Personenliste vorausgewählt', /Hanna Halter/.test(await page.$eval('.modal.open [name=owner_person_id]', (s) => s.selectedOptions[0].textContent)));
  check('Freitext versteckt, solange eine Person gewählt ist', await page.$eval('.modal.open [name=registered_owner]', (i) => i.closest('label').hidden));
  await page.selectOption('.modal.open [name=owner_person_id]', '');
  check('Freitext erscheint ohne Person', !(await page.$eval('.modal.open [name=registered_owner]', (i) => i.closest('label').hidden)));
  await page.click('.modal.open [data-x]');
  await page.locator('#view tr', { hasText: 'E2E-1' }).locator('[data-images]').click();
  await page.waitForSelector('.modal.open [data-gallery]');
  await page.click('.modal.open [data-img-add]');
  await page.waitForSelector('.modal.open #f-file');
  await page.setInputFiles('.modal.open #f-file', { name: 'auto.png', mimeType: 'image/png', buffer: PNG });
  await page.fill('.modal.open [name=caption]', 'Seitenansicht');
  await page.click('.modal.open button[type=submit]');
  await until(page, () => !!document.querySelector('.modal.open [data-gallery] .gallery-thumb img')).catch(() => {});
  check('Fahrzeugbild in der Galerie mit Vorschau', /Seitenansicht/.test(await page.textContent('.modal.open [data-gallery]')) && await page.locator('.modal.open [data-gallery] .gallery-thumb img').count() === 1);
  await page.screenshot({ path: `${out}/alice-fahrzeugbilder.png` });
  await page.click('.modal.open [data-gallery] .gallery-thumb');
  await page.waitForSelector('.modal.open .lightbox-img');
  check('Großansicht des Fahrzeugbilds', (await page.getAttribute('.modal.open .lightbox-img', 'src')).startsWith('data:image/png'));
  await page.locator('.modal.open').last().locator('[data-x]').click();
  await page.locator('.modal.open').last().locator('[data-x]').click();
  await until(page, () => /Bilder \(1\)/.test(document.querySelector('#view')?.textContent || '')).catch(() => {});
  check('Fahrzeugliste zählt das Bild', /Bilder \(1\)/.test(await page.locator('#view tr', { hasText: 'E2E-1' }).textContent()));
  at('alice objekte');
  await go(page, '#/assets-keys');
  await page.click('#view [data-qr]');
  await page.waitForSelector('.modal.open img');
  check('QR-Code im Dialog', (await page.getAttribute('.modal.open img', 'src')).startsWith('data:image/png'));
  await page.screenshot({ path: `${out}/alice-qr.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('#modals .modal').forEach((m) => m.remove()));
  at('alice personen csv');
  await go(page, '#/casefiles?tab=people');
  await page.waitForSelector('#pf-csv');
  const [peopleDownload] = await Promise.all([page.waitForEvent('download'), page.click('#pf-csv')]);
  check('Personen-Export lädt personen.csv', peopleDownload.suggestedFilename() === 'personen.csv');
  check('Personenliste mit Art, Funktion und Schlüsseln', /Art, Funktion/.test(await page.textContent('#view thead')) && /Schlüssel/.test(await page.textContent('#view thead')));
  await page.click('#pf-import');
  await page.waitForSelector('.modal.open #f-file');
  // Wie aus Excel: Windows-1252 statt UTF-8; „Hans“ gibt es schon
  await page.setInputFiles('.modal.open #f-file', { name: 'personen.csv', mimeType: 'text/csv', buffer: Buffer.from('Name;Art;Notiz\r\nJürgen Ümlaut;Extern;aus Excel\r\nHans;;\r\n', 'latin1') });
  await page.click('.modal.open button[type=submit]');
  await until(page, () => !!document.querySelector('#p-import-result .note'));
  const importPreview = await page.textContent('#p-import-result');
  check('Import-Vorschau zählt', /1 neue Person wird angelegt/.test(importPreview) && /1 Zeile übersprungen/.test(importPreview) && /Zeile 3/.test(importPreview), importPreview);
  check('Nach dem Prüfen heißt der Knopf Importieren', (await page.textContent('.modal.open button[type=submit]')).trim() === 'Importieren');
  await page.screenshot({ path: `${out}/alice-personen-import.png` });
  await page.click('.modal.open button[type=submit]');
  await until(page, () => !document.querySelector('.modal.open'));
  await settle(page);
  await until(page, () => /Jürgen Ümlaut/.test(document.querySelector('#view')?.textContent || '')).catch(() => {});
  check('Importierte Person mit Umlauten in der Liste', /Jürgen Ümlaut/.test(await page.textContent('#view')));
  // Schlüssel und Löschen in der Personenakte (früher auf der Seite „Personen“); Hans' Schlüssel liegt in Alices privatem Bereich
  await page.selectOption('#pf-area', '');
  await page.waitForTimeout(400);
  await page.fill('#pf-q', 'Hans');
  // Erst klicken, wenn genau diese Person dasteht: vorher zeigt die Liste noch die alte Suche
  await until(page, (n) => { const rows = document.querySelectorAll('#view [data-pf-open]'); return rows.length === 1 && rows[0].closest('tr').textContent.includes(n); }, 'Hans').catch(() => {});
  await page.click('#view [data-pf-open]');
  await page.waitForSelector('#view .person-head');
  const hansText = await page.textContent('#view .person-file');
  check('Personenakte zeigt Schlüssel samt Verlust', /Schlüssel/.test(hansText) && /Haustür/.test(hansText) && /Verloren/.test(hansText), hansText.slice(0, 200));
  check('Personenakte bietet „Person löschen“', await page.locator('#pf-delete').count() === 1);
  await page.click('#pf-back');
  await page.waitForSelector('#pf-q');
  await page.fill('#pf-q', 'Jürgen');
  // Erst klicken, wenn genau diese Person dasteht: vorher zeigt die Liste noch die alte Suche
  await until(page, (n) => { const rows = document.querySelectorAll('#view [data-pf-open]'); return rows.length === 1 && rows[0].closest('tr').textContent.includes(n); }, 'Jürgen').catch(() => {});
  await page.click('#view [data-pf-open]');
  await page.waitForSelector('#pf-delete');
  await page.click('#pf-delete');
  await submit(page);
  await page.waitForSelector('#pf-q');
  await page.fill('#pf-q', 'Jürgen');
  await page.waitForTimeout(600);
  check('Person über die Personenakte gelöscht', !/Jürgen Ümlaut/.test(await page.textContent('#view')) && (await page.evaluate(() => location.hash)) === '#/casefiles?tab=people');
  await page.fill('#pf-q', '');
  await page.waitForTimeout(500);
  // Aktensystem: Fallakte anlegen, Person beteiligen, Bericht aus Vorlage bis zur Freigabe, Anklage, Beweismittel, Fahndung, Personenakte
  at('alice aktensystem');
  // Nach jeder Aktion lädt die Akte neu: auf den erwarteten Text warten statt auf eine feste Zeit
  const waitFor = (selector, pattern) => until(page, ([s, p]) => new RegExp(p).test(document.querySelector(s)?.textContent || ''), [selector, pattern.source]).catch(() => {});
  await go(page, '#/casefiles');
  check('Akten-Tabs, Personenakten zuerst', (await page.$$eval('#c-tabs [data-tab]', (t) => t.map((x) => x.textContent.trim()))).join().replace(/Fallakten\s*\d+/, 'Fallakten') === 'Personenakten,Fallakten,Fahndung,Strafkatalog,Berichtsvorlagen,Aktenarten');
  await page.waitForSelector('#pf-q');
  check('Startseite der Akten sind die Personenakten', (await page.$eval('#c-tabs .on', (b) => b.dataset.tab)) === 'people' && (await page.evaluate(() => location.hash)) === '#/casefiles?tab=people', await page.evaluate(() => location.hash));
  await page.click('#c-new');
  await page.fill('.modal.open [name=title]', 'UI Einsatz Hafen');
  await page.selectOption('.modal.open [name=priority]', 'high');
  await page.fill('.modal.open [name=location]', 'Hafen, Pier 4');
  await page.fill('.modal.open [name=incident_at]', '2026-11-08T20:15');
  await page.selectOption('.modal.open [name=team_id]', { label: 'Organisation: E2E Team' });
  await submit(page);
  await page.waitForSelector('#view .case-detail');
  check('Neue Akte öffnet sich mit Kopfdaten', /UI Einsatz Hafen/.test(await page.textContent('#view .case-detail h2')) && /Hafen, Pier 4/.test(await page.textContent('#view .case-meta')) && /Hoch/.test(await page.textContent('#view .case-detail .card')));
  await page.click('#p-add');
  await page.selectOption('.modal.open [name=person_id]', { index: 0 });
  check('Rollen als Vorschläge', await page.locator('.modal.open datalist option[value="Zeuge/Zeugin"]').count() === 1);
  await page.fill('.modal.open [name=role]', 'Beschuldigte/r');
  await submit(page);
  await waitFor('#view [data-panel=d-overview]', /Beschuldigte\/r/);
  const involvedName = (await page.textContent('#view [data-panel=d-overview] .list-item b')).trim();
  check('Person beteiligt', /Beschuldigte\/r/.test(await page.textContent('#view [data-panel=d-overview]')));
  // Bericht aus Vorlage, einreichen und (als Inhaberin auch den eigenen) freigeben
  await page.click('#d-tabs [data-tab=d-reports]');
  await page.click('#r-new');
  await page.selectOption('.modal.open [name=template]', { label: 'Einsatzbericht' });
  check('Vorlage füllt Art, Titel und Text', (await page.inputValue('.modal.open [name=kind]')) === 'Einsatzbericht' && /## Einsatzanlass/.test(await page.inputValue('.modal.open [name=body]')));
  await page.fill('.modal.open [name=title]', 'Einsatz am Pier');
  await page.check(`.modal.open [name=person_ids] >> nth=0`);
  await submit(page);
  await waitFor('#view [data-panel=d-reports]', /Entwurf/);
  check('Entwurf sichtbar', /Entwurf/.test(await page.textContent('#view [data-panel=d-reports]')) && await page.locator('#d-tabs [data-tab=d-reports].on').count() === 1);
  await page.click('#view [data-r-submit]');
  await submit(page);
  await waitFor('#view [data-panel=d-reports]', /Wartet auf Freigabe/);
  check('Eingereicht', /Wartet auf Freigabe/.test(await page.textContent('#view [data-panel=d-reports]')));
  await page.click('#view [data-r-approve]');
  await submit(page);
  await waitFor('#view [data-panel=d-reports]', /Freigegeben/);
  check('Freigegeben und gesperrt', /Freigegeben/.test(await page.textContent('#view [data-panel=d-reports]')) && await page.locator('#view [data-r-edit]').count() === 0 && await page.locator('#view [data-r-amend]').count() === 1);
  // Anklagepunkt aus dem Strafkatalog
  await page.click('#d-tabs [data-tab=d-charges]');
  await page.click('#ch-new');
  // Das Formular lädt erst den Strafkatalog
  await page.waitForSelector('.modal.open [name=penal_code_id]');
  const codeOption = await page.$$eval('.modal.open [name=penal_code_id] option', (o) => o.map((x) => x.value).find(Boolean));
  await page.selectOption('.modal.open [name=penal_code_id]', codeOption);
  check('Freie Felder verschwinden bei Katalogwahl', await page.locator('.modal.open [name=code]').isHidden());
  await submit(page);
  await waitFor('#view [data-panel=d-charges]', /Offen:/);
  check('Anklagepunkt mit Summe', /Offen:/.test(await page.textContent('#view [data-panel=d-charges]')) && /HE/.test(await page.textContent('#view [data-panel=d-charges]')));
  // Beweismittel mit Übergabe
  await page.click('#d-tabs [data-tab=d-evidence]');
  await page.click('#ev-new');
  await page.fill('.modal.open [name=description]', 'Messer, 20 cm');
  await page.fill('.modal.open [name=storage]', 'Fach 7');
  await submit(page);
  await waitFor('#view [data-panel=d-evidence]', /A-1/);
  await page.click('#view [data-ev-log]');
  await page.selectOption('.modal.open [name=status]', 'stored');
  await page.fill('.modal.open [name=action]', 'Übergabe an Asservatenkammer');
  await submit(page);
  await waitFor('#view [data-panel=d-evidence]', /Übergabekette \(2\)/);
  check('Beweismittel mit Übergabekette', /A-1/.test(await page.textContent('#view [data-panel=d-evidence]')) && /Eingelagert/.test(await page.textContent('#view [data-panel=d-evidence]')) && /Übergabekette \(2\)/.test(await page.textContent('#view [data-panel=d-evidence]')));
  // Haftbefehl
  await page.click('#d-tabs [data-tab=d-warrants]');
  await page.click('#wa-new');
  check('Kennzeichen nur bei Fahrzeugfahndung', await page.locator('.modal.open [name=plate]').isHidden());
  await page.selectOption('.modal.open [name=person_id]', { index: 1 });
  await page.fill('.modal.open [name=reason]', 'Flucht nach Messerangriff');
  await submit(page);
  await waitFor('#view .case-detail .card', /aktive Fahndung/);
  check('Aktive Fahndung im Kopf der Akte', /Eine aktive Fahndung/.test(await page.textContent('#view .case-detail .card')));
  // Bilder der Akte: eigener Tab mit Vorschau, Bildunterschrift und Großansicht
  await page.click('#d-tabs [data-tab=d-images]');
  await page.click('#img-add');
  await page.waitForSelector('.modal.open #f-file');
  await page.setInputFiles('.modal.open #f-file', { name: 'tatort.png', mimeType: 'image/png', buffer: PNG });
  await page.fill('.modal.open [name=caption]', 'Tatort Pier 4');
  await submit(page);
  await waitFor('#view [data-panel=d-images]', /Tatort Pier 4/);
  await until(page, () => !!document.querySelector('#view [data-panel=d-images] .gallery-thumb img')).catch(() => {});
  check('Aktenbild mit Vorschau und Bildunterschrift', /Tatort Pier 4/.test(await page.textContent('#view [data-panel=d-images]')) && await page.locator('#view [data-panel=d-images] .gallery-thumb img').count() === 1);
  check('Bilder getrennt von Anhängen gezählt', /Bilder \(1\)/.test(await page.textContent('#d-tabs')) && /Anhänge \(0\)/.test(await page.textContent('#d-tabs')), await page.textContent('#d-tabs'));
  await page.click('#view [data-panel=d-images] .gallery-thumb');
  await page.waitForSelector('.modal.open .lightbox-img');
  check('Großansicht des Aktenbilds', (await page.getAttribute('.modal.open .lightbox-img', 'src')).startsWith('data:image/png'));
  await page.click('.modal.open [data-x]');
  await page.click('#c-print');
  await page.screenshot({ path: `${out}/alice-akte.png`, fullPage: true });
  // Personenakte mit Warnhinweis
  await page.click('#d-tabs [data-tab=d-overview]');
  await page.click('#view [data-person]');
  await page.waitForSelector('#view .person-head');
  check('Personenakte zeigt die Fahndung', /Gesucht: Haftbefehl/.test(await page.textContent('#view .person-head')) && (await page.textContent('#view .person-head h2')).trim() === involvedName);
  await page.click('#pf-edit');
  await page.check('.modal.open [name=warnings][value="Bewaffnet"]');
  await page.selectOption('.modal.open [name=blood_type]', 'A+');
  await submit(page);
  await waitFor('#view .person-head', /Bewaffnet/);
  check('Warnhinweis und Blutgruppe in der Personenakte', /Bewaffnet/.test(await page.textContent('#view .person-head')) && /A\+/.test(await page.textContent('#view .person-file')));
  await page.screenshot({ path: `${out}/alice-personenakte.png`, fullPage: true });
  await page.click('#pf-back');
  await page.waitForSelector('#pf-q');
  await page.fill('#pf-q', involvedName.slice(0, 4));
  await page.waitForTimeout(700);
  check('Personenakten-Suche', /Gesucht/.test(await page.textContent('#view .card')) && /Bewaffnet/.test(await page.textContent('#view .card')));
  // Fahndungsliste, Strafkatalog, Vorlagen
  await page.click('#c-tabs [data-tab=wanted]');
  await page.waitForSelector('#wa-q');
  check('Fahndungsliste', /Flucht nach Messerangriff/.test(await page.textContent('#view')));
  await page.click('#c-tabs [data-tab=codes]');
  await page.waitForTimeout(600);
  check('Strafkatalog', /Schwerer Raub/.test(await page.textContent('#view')) && await page.locator('#pc-import').count() === 1);
  await page.click('#c-tabs [data-tab=templates]');
  await page.waitForTimeout(600);
  check('Berichtsvorlagen', /Festnahmebericht/.test(await page.textContent('#view')) && await page.locator('[data-rt-set=medic]').count() === 1);
  await page.click('#c-tabs [data-tab=files]');
  await page.waitForTimeout(600);
  check('Liste zeigt Priorität und Fahndung', /UI Einsatz Hafen/.test(await page.textContent('#view')) && /Hoch/.test(await page.textContent('#view table')) && /Fahndung/.test(await page.textContent('#view table')));
  check('Zurück aus der Liste bleibt bei Fallakten', (await page.evaluate(() => location.hash)) === '#/casefiles?tab=files');
  // Personenakte: Einträge ohne Fallakte, Fahrzeuge und Schlüssel aus allen Bereichen (api.mjs: Max Muster hat ein privates
  // Fahrzeug E2E-PF und eines der Organisation E2E-PT)
  at('alice personenakte eintraege');
  await go(page, '#/casefiles?tab=people');
  await page.selectOption('#pf-area', { label: 'E2E Team' });
  await page.waitForTimeout(500);
  await page.fill('#pf-q', 'Max Muster');
  await page.waitForTimeout(700);
  await page.locator('#view tr', { hasText: 'Max Muster' }).locator('[data-pf-open]').click();
  await page.waitForSelector('#view .person-head');
  const vehiclesCard = page.locator('#view .card', { hasText: 'Fahrzeuge (Besitzer)' });
  check('Privates Fahrzeug in der Akte der Organisation', /E2E-PF/.test(await vehiclesCard.textContent()) && /Privat/.test(await vehiclesCard.textContent()) && /E2E-PT/.test(await vehiclesCard.textContent()) && /E2E Team/.test(await vehiclesCard.textContent()), await vehiclesCard.textContent());
  check('Privater Schlüssel in der Akte der Organisation', /Garage/.test(await page.locator('#view .card', { hasText: 'Schlüssel' }).last().textContent()));
  await page.click('#pf-entry-new');
  check('Eintrag mit Markdown-Editor', await page.locator('.modal.open .md-toolbar, .modal.open [data-md]').count() > 0);
  await page.fill('.modal.open [name=kind]', 'Gespräch');
  await page.fill('.modal.open [name=body]', 'Hat **bereitwillig** ausgesagt');
  await submit(page);
  await until(page, () => /bereitwillig/.test(document.querySelector('#pf-entries')?.textContent || '')).catch(() => {});
  check('Eintrag erscheint in der Personenakte', /Gespräch/.test(await page.textContent('#pf-entries')) && await page.locator('#pf-entries strong', { hasText: 'bereitwillig' }).count() === 1);
  await page.locator('#pf-entries [data-pe-edit]').first().click();
  await page.fill('.modal.open [name=body]', 'Hat bereitwillig ausgesagt, Termin folgt');
  await submit(page);
  await until(page, () => /Termin folgt/.test(document.querySelector('#pf-entries')?.textContent || '')).catch(() => {});
  check('Eintrag bearbeitet', /Termin folgt/.test(await page.textContent('#pf-entries')) && /geändert von/.test(await page.textContent('#pf-entries')));
  await page.screenshot({ path: `${out}/alice-personenakte-eintraege.png`, fullPage: true });
  await page.locator('#pf-entries [data-pe-del]').first().click();
  await submit(page);
  await until(page, () => !/Termin folgt/.test(document.querySelector('#pf-entries')?.textContent || 'Termin folgt')).catch(() => {});
  check('Eintrag gelöscht', !/Termin folgt/.test(await page.textContent('#pf-entries')));
  // Schulung mit Test im Tool: Einstellungen, Fragen, Test mit Unterbrechung und Countdown, Ergebnis
  at('alice schulung test');
  await go(page, '#/trainings');
  await page.click('#t-new');
  await page.fill('.modal.open [name=name]', 'UI Erste Hilfe mit Test');
  check('Testeinstellungen erst mit Haken', await page.locator('.modal.open [name=exam_pass_percent]').isHidden());
  await page.check('.modal.open [name=exam_required]');
  check('Testeinstellungen nach dem Haken', await page.locator('.modal.open [name=exam_pass_percent]').isVisible() && await page.locator('.modal.open [name=exam_shuffle]').isChecked());
  await page.fill('.modal.open [name=exam_pass_percent]', '60');
  await page.fill('.modal.open [name=exam_time_limit]', '10');
  await submit(page);
  await until(page, () => /Test im Tool/.test(document.querySelector('#t-main')?.textContent || ''));
  check('Ohne Fragen kein Start', /keine Fragen/.test(await page.textContent('#t-main')) && await page.locator('#t-main [data-exam-start]').count() === 0);
  await page.click('#t-main [data-exam-questions]');
  await page.waitForSelector('#exam-questions [data-q-new]');
  await page.click('#exam-questions [data-q-new]');
  await page.fill('.modal.open [name=text]', 'Darf man einem Bewusstlosen **zu trinken** geben?');
  await page.fill('.modal.open [name=option0]', 'Ja, Wasser');
  await page.fill('.modal.open [name=option1]', 'Nein, auf keinen Fall');
  await page.check('.modal.open [name=correct1]');
  await submit(page);
  await until(page, () => /1\./.test(document.querySelector('#exam-questions')?.textContent || ''));
  await page.click('#exam-questions [data-q-new]');
  await page.fill('.modal.open [name=text]', 'Was hilft bei starker Blutung?');
  await page.selectOption('.modal.open [name=kind]', 'multiple');
  await page.fill('.modal.open [name=points]', '2');
  await page.fill('.modal.open [name=option0]', 'Druckverband');
  await page.check('.modal.open [name=correct0]');
  await page.fill('.modal.open [name=option1]', 'Hochlagern');
  await page.check('.modal.open [name=correct1]');
  await page.fill('.modal.open [name=option2]', 'Pflaster abziehen');
  await submit(page);
  await until(page, () => /Fragen \(2\)/.test(document.querySelector('#exam-questions')?.textContent || ''));
  check('Fragen mit markierter Lösung', await page.locator('#exam-questions .exam-options li.correct').count() === 3 && await page.locator('#exam-questions strong').count() === 1);
  await page.screenshot({ path: `${out}/alice-schulung-fragen.png`, fullPage: true });
  await page.click('#t-main [data-exam-start]');
  await page.waitForSelector('#exam-form');
  check('Test zeigt Fragen ohne Lösung mit Countdown', await page.locator('#exam-form .exam-q').count() === 2 && /noch (9|10):\d\d/.test(await page.textContent('#exam-timer')), await page.textContent('#exam-timer'));
  check('Einfachauswahl als Radio, Mehrfachauswahl als Kästchen', await page.locator('#exam-form input[type=radio]').count() === 2 && await page.locator('#exam-form input[type=checkbox]').count() === 3);
  await page.check('#exam-form label.exam-option:has-text("Nein, auf keinen Fall") input');
  await page.click('#exam-later');
  await until(page, () => /Test fortsetzen/.test(document.querySelector('#t-main')?.textContent || ''));
  check('Unterbrochener Test lässt sich fortsetzen', true);
  await page.click('#t-main [data-exam-start]');
  await page.waitForSelector('#exam-form');
  check('Antworten bleiben beim Fortsetzen erhalten', await page.isChecked('#exam-form label.exam-option:has-text("Nein, auf keinen Fall") input'));
  await page.click('#exam-form button[type=submit]');
  await page.waitForSelector('.modal.open');
  check('Warnung bei offener Frage', /1 Frage ist noch offen/.test(await page.textContent('.modal.open')), await page.textContent('.modal.open'));
  await page.click('.modal.open [data-x]');
  await page.check('#exam-form label.exam-option:has-text("Druckverband") input');
  await page.check('#exam-form label.exam-option:has-text("Hochlagern") input');
  await page.screenshot({ path: `${out}/alice-schulung-test.png`, fullPage: true });
  await page.click('#exam-form button[type=submit]');
  await submit(page);
  await page.waitForSelector('.exam-result');
  const examResult = await page.textContent('.exam-result');
  check('Test bestanden mit 100 %', /Bestanden/.test(examResult) && /100 %/.test(examResult) && /2 von 2 Fragen/.test(examResult), examResult);
  await page.screenshot({ path: `${out}/alice-schulung-ergebnis.png` });
  await page.click('#exam-back');
  await until(page, () => /Deine Versuche/.test(document.querySelector('#t-main')?.textContent || ''));
  const examCard = await page.textContent('#t-main');
  check('Versuch und Nachweis in der Schulung', /schon bestanden/.test(examCard) && /Bestanden 100 %/.test(examCard) && /Test im Tool/.test(examCard) === true, examCard.slice(0, 400));
  await page.click('#t-main [data-attempt]');
  await page.waitForSelector('.modal.open .exam-options');
  check('Antworten im Einzelnen mit Lösung', await page.locator('.modal.open .tag:has-text("richtig")').count() === 2);
  await page.click('.modal.open [data-x]');
  await page.click('#t-back');
  await until(page, () => /UI Erste Hilfe mit Test/.test(document.querySelector('#t-main table')?.textContent || ''));
  check('Liste markiert Schulungen mit Test', await page.locator('#t-main tr:has-text("UI Erste Hilfe mit Test") .tag:has-text("Test")').count() === 1);
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

  // Changelog unter Administration: alle Versionen seit 0.0.0, Suche und Filter nach Art
  at('alice changelog');
  await go(page, '#/changelog');
  // Dass die oberste Version der package.json entspricht, prüft test/changelog.test.js
  const versions = () => page.$$eval('.changelog-version:not([hidden]) h2', (h) => h.map((x) => x.textContent.trim()));
  const installedHeading = (await versions()).find((v) => /Installiert/.test(v)) || '';
  check('Changelog: installierte Version markiert und im Kopf genannt', /^Version \d+\.\d+\.\d+/.test(installedHeading) && (await page.textContent('#view .page-head')).includes(installedHeading.match(/\d+\.\d+\.\d+/)?.[0]), (await versions()).slice(0, 3).join(' | '));
  check('Changelog: bis zurück zu 0.0.0', (await versions()).at(-1) === 'Version 0.0.0');
  await page.fill('#cl-search', 'Zinsen');
  const zinsen = await versions();
  check('Changelog-Suche findet Zinsen', zinsen.length >= 1 && zinsen.every((v) => !/0\.0\.0/.test(v)), zinsen.join(' | '));
  await page.fill('#cl-search', '1.1.1');
  check('Changelog-Suche nach Version', (await versions()).join() === 'Version 1.1.1', (await versions()).join(' | '));
  await page.fill('#cl-search', '');
  await page.selectOption('#cl-type', 'fixed');
  check('Changelog-Filter nach Art', await page.$$eval('.changelog-list li:not([hidden]) .tag', (t) => t.length > 0 && t.every((x) => x.textContent === 'Behoben')));
  await page.fill('#cl-search', 'qwertzuiop');
  check('Changelog ohne Treffer erklärt sich', /Keine Änderung passt/.test(await page.textContent('#view')));
  await page.screenshot({ path: `${out}/alice-changelog.png` });

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
  // Speichern der Darstellung scheitert (wie bei gerade abgelaufener Sitzung): Meldung, alter Stand, kein unbehandelter Fehler
  at('alice darstellung fehler');
  await page.click('#view [data-tab=appearance]');
  await page.waitForTimeout(200);
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.route('**/api/me', (route) => (route.request().method() === 'PATCH'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', message: 'Testfehler beim Speichern' }) })
    : route.continue()));
  const problemsBefore = problems.length;
  await page.click(`#ap-mode [data-m=${themeBefore === 'dark' ? 'light' : 'dark'}]`);
  await page.waitForTimeout(500);
  check('Darstellung: Fehler beim Speichern wird gemeldet', /Testfehler beim Speichern/.test(await page.textContent('#toasts')));
  check('Darstellung: Modus springt auf den gespeicherten zurück', (await page.evaluate(() => document.documentElement.dataset.theme)) === themeBefore);
  const gravatarBefore = await page.isChecked('#ap-grav');
  await page.click('#ap-grav');
  await page.waitForTimeout(400);
  check('Gravatar: Haken springt zurück, wenn Speichern scheitert', (await page.isChecked('#ap-grav')) === gravatarBefore);
  check('Darstellung: kein unbehandelter Fehler', problems.length === problemsBefore, problems.slice(problemsBefore).join(' | '));
  await page.unroute('**/api/me');

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
  at('admin akten schalter');
  check('Schalter für Teile des Aktensystems', await page.locator('#view input[name="casefiles.files"]').isChecked() && await page.locator('#view input[name="casefiles.penal_codes"]').count() === 1);
  await page.uncheck('#view input[name="casefiles.files"]');
  check('Abhängige Schalter werden blass', await page.locator('#s-case-parts.muted-block').count() === 1);
  await page.click('#s-form button:not([type=button])');
  await page.waitForTimeout(600);
  await go(page, '#/casefiles');
  await page.waitForSelector('#pf-q');
  check('Ohne Fallakten nur Personenakten und Strafkatalog', (await page.$$eval('#c-tabs [data-tab]', (t) => t.map((x) => x.dataset.tab))).join() === 'people,codes' && await page.locator('#c-new').count() === 0, (await page.$$eval('#c-tabs [data-tab]', (t) => t.map((x) => x.dataset.tab))).join());
  await page.screenshot({ path: `${out}/admin-akten-ohne-fallakten.png` });
  await go(page, '#/admin-server');
  await page.click('#view .tabs [data-tab=settings]');
  await page.waitForSelector('#view input[name="casefiles.files"]');
  await page.check('#view input[name="casefiles.files"]');
  await page.click('#s-form button:not([type=button])');
  await page.waitForTimeout(600);
  await go(page, '#/casefiles');
  check('Fallakten wieder da', await page.locator('#c-tabs [data-tab=files]').count() === 1);
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
  at('admin notiz-tags');
  await go(page, '#/admin-server');
  await page.click('#view .tabs [data-tab=notetags]');
  const tagPanel = page.locator('#view [data-panel=notetags]');
  await tagPanel.locator('table').waitFor();
  check('Tab Notiz-Tags mit Standard-Tags', /WIP/.test(await tagPanel.textContent()) && /BLOCKED/.test(await tagPanel.textContent()) && !/ARCHIVE/.test(await tagPanel.textContent()));
  await page.click('#ad-new');
  await page.fill('.modal.open [name=name]', 'UI-Tag');
  await page.selectOption('.modal.open [name=color]', 'ok');
  await submit(page);
  const uiTagRow = tagPanel.locator('tr', { hasText: 'UI-Tag' });
  await uiTagRow.waitFor();
  check('Neuer Tag unten mit Farbe', /Grün/.test(await uiTagRow.textContent()) && /UI-Tag/.test(await tagPanel.locator('tbody tr').last().textContent()));
  await uiTagRow.locator('[data-tup]').click();
  await until(page, () => !/UI-Tag/.test(document.querySelector('#view [data-panel=notetags] tbody tr:last-child')?.textContent || 'UI-Tag'));
  check('Tag nach oben verschoben', /UI-Tag/.test(await tagPanel.locator('tbody tr').nth(-2).textContent()));
  await uiTagRow.locator('[data-tedit]').click();
  await page.fill('.modal.open [name=name]', 'UI-Tag neu');
  await submit(page);
  await tagPanel.locator('tr', { hasText: 'UI-Tag neu' }).waitFor({ timeout: 8000 }).catch(() => {});
  check('Tag umbenannt', await tagPanel.locator('tr', { hasText: 'UI-Tag neu' }).count() === 1);
  await page.screenshot({ path: `${out}/admin-notiz-tags.png` });
  await tagPanel.locator('tr', { hasText: 'UI-Tag neu' }).locator('[data-tdel]').click();
  await submit(page);
  check('Tag gelöscht', await tagPanel.locator('tr', { hasText: 'UI-Tag' }).count() === 0);
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
  await adminTicket.locator('[data-comment-form] button[type=submit]').click();
  await adminTicket.locator('.ticket-comment', { hasText: 'Antwort vom Admin' }).waitFor();
  check('Admin-Kommentar erscheint', await adminTicket.locator('.ticket-comment').count() === commentsBefore + 1);
  await adminTicket.locator('[name=body]').fill('Zweiter Kommentar');
  await adminTicket.locator('[data-comment-form] button[type=submit]').click();
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
  await go(page, '#/casefiles?tab=people');
  await page.waitForSelector('#pf-q');
  // Personen sind global: Für sie zählen nur die Rollenrechte, nicht die Stufe in der Organisation
  check('Viewer sieht Personen und darf sie mit der Rolle User anlegen', /Teamer/.test(await page.textContent('#view')) && await page.locator('#pf-new').count() === 1);
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

// ---------- Fuhrpark: Fahrzeuge, Kontrollrunde, Markdown (Wunsch des Auftraggebers vom 2026-11-11)
{
  const { page, at, ctx } = await session();
  at('alice fuhrpark');
  await login(page, 'alice@e2e.test', 'alice-Sehr-Sicher-9931!');
  await go(page, '#/fleet');
  check('Fuhrpark in der Navigation', /Fuhrpark/.test(await page.textContent('.sidebar')));
  await page.selectOption('#f-team', { label: 'E2E Team' });
  await settle(page);
  await page.click('#view .tabs [data-tab=vehicles]');
  await page.click('#f-group-new');
  await page.fill('.modal.open [name=name]', 'Rumpo Espera');
  await submit(page);
  await page.click('#f-vehicle-new');
  await page.selectOption('.modal.open [name=group_id]', { label: 'Rumpo Espera' });
  await page.fill('.modal.open [name=plate]', '30 AB9FH');
  await submit(page);
  check('Fuhrpark: Fahrzeug in der Liste', /30 AB9FH/.test(await page.textContent('#f-vehicles')), (await page.textContent('#f-vehicles')).slice(0, 200));
  at('alice fuhrpark runde');
  await page.click('#view .tabs [data-tab=checks]');
  await page.click('#f-check-new');
  await page.waitForSelector('#f-detail [data-k=odometer_km]');
  const row = await page.$('#f-detail tr:has-text("30 AB9FH")');
  await (await row.$('[data-k=odometer_km]')).fill('2356');
  await (await row.$('[data-k=accessories_complete]')).check();
  await (await row.$('[data-k=note]')).fill('Sullivan');
  await page.click('#f-save');
  await page.waitForTimeout(400);
  await page.click('#f-done');
  await page.waitForTimeout(500);
  check('Fuhrpark: Runde erledigt', /Erledigt/.test(await page.textContent('#f-detail')));
  await page.click('#f-md');
  await page.waitForSelector('.modal.open textarea');
  const md = await page.$eval('.modal.open textarea', (t) => t.value);
  check('Fuhrpark: Markdown im Dialog', /^Stand: /.test(md) && md.includes('### Rumpo Espera') && md.includes('|30 AB9FH|2356|') && md.includes('Sullivan'), md.slice(0, 300));
  await page.screenshot({ path: `${out}/fuhrpark-markdown.png` });
  await page.click('.modal.open [data-x]');
  check('Fuhrpark ohne Fehlermeldung', !(await viewErr(page)));
  await ctx.close();
}

// ---------- Umbuchungen: an einen anderen Benutzer senden, dort annehmen (Wunsch des Auftraggebers vom 2026-11-11)
{
  const { page, at, ctx } = await session();
  at('bob umbuchen');
  await login(page, 'bob@e2e.test', 'bob-Sehr-Sicher-9931!');
  await go(page, '#/budgets');
  await page.click('#b-transfer');
  await page.waitForSelector('.modal.open #f-own_budget');
  check('Umbuchung: Quellkonto nicht als eigenes Ziel', await page.evaluate(() => { const from = document.querySelector('#f-from_budget_id').value; return ![...document.querySelectorAll('#f-own_budget option')].some((o) => o.value === from); }));
  await page.selectOption('.modal.open [name=target]', 'user');
  await page.fill('#tr-user-q', 'car');
  await until(page, () => [...document.querySelectorAll('.modal.open [name=to_user_id] option')].some((o) => o.textContent === 'carol'));
  await page.selectOption('.modal.open [name=to_user_id]', { label: 'carol' });
  await page.fill('.modal.open [name=amount]', '12,50');
  await page.fill('.modal.open [name=title]', 'Browser-Umbuchung');
  await submit(page);
  check('Umbuchung: ausgehend sichtbar', /Browser-Umbuchung/.test(await page.textContent('#transfers-pending')));
  await ctx.close();
  const s2 = await session({ width: 390, height: 800 });
  s2.at('carol annehmen');
  await login(s2.page, 'carol@e2e.test', 'carol-Sehr-Sicher-9931!');
  await go(s2.page, '#/budgets');
  check('Umbuchung: Carol sieht eingehend', /Browser-Umbuchung/.test(await s2.page.textContent('#transfers-pending')));
  check('Umbuchung mobil kein horizontales Scrollen', (await s2.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
  await s2.page.click('#transfers-pending [data-tr-accept]');
  await s2.page.waitForSelector('.modal.open [name=budget_id]');
  await submit(s2.page);
  await go(s2.page, '#/transactions');
  const row = await s2.page.$('#view tr:has-text("Umbuchung: Browser-Umbuchung")');
  check('Umbuchung: Buchung bei Carol', !!row);
  check('Umbuchung: Tag und kein Löschen', !!row && /Umbuchung/.test(await row.textContent()) && !(await row.$('[data-del]')) && !(await row.$('[data-edit]')));
  await s2.page.screenshot({ path: `${out}/umbuchung-carol.png` });
  await s2.ctx.close();
}

// ---------- Akten als PDF: Teile wählen, Bericht einzeln (Wunsch des Auftraggebers vom 2026-11-11)
{
  const { page, at, ctx } = await session();
  at('bob akte pdf');
  await login(page, 'bob@e2e.test', 'bob-Sehr-Sicher-9931!');
  await go(page, '#/casefiles?tab=files');
  await page.click('#view [data-open]:has-text("Raubüberfall Bank"), #view tr:has-text("Raubüberfall Bank") [data-open]');
  await page.waitForSelector('#c-pdf');
  await page.click('#c-pdf');
  await page.waitForSelector('.modal.open input[name=parts]');
  const boxes = await page.$$eval('.modal.open input[name=parts]', (list) => list.map((b) => [b.value, b.checked]));
  check('PDF-Dialog: alle Teile vorausgewählt', boxes.length >= 8 && boxes.every(([, on]) => on), JSON.stringify(boxes));
  await page.uncheck('.modal.open input[name=parts][value=images]');
  const [akte] = await Promise.all([page.waitForEvent('download'), page.click('.modal.open button[type=submit]')]);
  check('PDF-Download der Akte', /^akte-.*\.pdf$/.test(akte.suggestedFilename()), akte.suggestedFilename());
  await page.click('#view .tabs [data-tab=d-reports], #view [data-tab=d-reports]').catch(() => {});
  await page.waitForSelector('[data-r-pdf]');
  const [bericht] = await Promise.all([page.waitForEvent('download'), page.click('[data-r-pdf]')]);
  check('PDF-Download eines Berichts', /^bericht-.*\.pdf$/.test(bericht.suggestedFilename()), bericht.suggestedFilename());
  await ctx.close();
}

// ---------- Musik vom Server und Blitzer (Wunsch des Auftraggebers vom 2026-11-13)
{
  const { page, at, ctx } = await session();
  at('alice musik');
  await login(page, 'alice@e2e.test', 'alice-Sehr-Sicher-9931!');
  await go(page, '#/music');
  // Eingebetteter Player: Link einfügen spielt sofort; Empfehlungen (in api.mjs vom Admin angelegt) für alle sichtbar
  await page.fill('#m-emb-q', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc');
  await page.click('[data-m=emb-go]');
  await page.waitForSelector('#m-emb iframe.sp-embed');
  check('Link spielt im eingebetteten Player', (await page.getAttribute('#m-emb iframe', 'src')).startsWith('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M'));
  await page.fill('#m-emb-q', 'Lofi Beats');
  await page.click('[data-m=emb-go]');
  await page.waitForTimeout(300);
  check('Ohne Server-Secret erklärt die Seite die Suche', /kein Spotify-Link/.test(await page.textContent('#toasts, body')));
  check('Empfehlungen für alle sichtbar, ohne Pflege-Knöpfe', !!(await page.$('#m-recs .rec iframe.sp-embed')) && /Top Hits/.test(await page.textContent('#m-recs')) && !(await page.$('[data-m=rec-new]')));
  await page.screenshot({ path: `${out}/musik-spotify-player.png`, fullPage: true });
  check('Spotify ohne Server-App bietet die eigene App an', /eigene App/.test(await page.textContent('#m-sp')) && !!(await page.$('#m-sp-own')), await page.textContent('#m-sp'));
  await page.click('#view .tabs [data-tab=local]');
  const hasTracks = await page.waitForSelector('.music-track[data-key^="s:"]', { timeout: 4000 }).catch(() => null);
  if (hasTracks) {
    const title = (await page.textContent('.music-track[data-key^="s:"] span')).trim();
    await page.click('.music-track[data-key^="s:"]');
    await until(page, (t) => document.querySelector('#m-local-now b')?.textContent === t, title);
    await until(page, () => document.querySelector('[data-m=local-toggle]')?.getAttribute('aria-label') === 'Pause').catch(() => {});
    check('Titel vom Server spielt', (await page.getAttribute('[data-m=local-toggle]', 'aria-label')) === 'Pause');
    await page.screenshot({ path: `${out}/musik-server.png` });
    await go(page, '#/dashboard');
    await go(page, '#/music?tab=local');
    await page.waitForSelector('#m-local-now b');
    check('Wiedergabe läuft nach Seitenwechsel weiter', (await page.textContent('#m-local-now b')) === title && (await page.getAttribute('[data-m=local-toggle]', 'aria-label')) === 'Pause');
    await page.click('[data-m=local-toggle]');
    await until(page, () => document.querySelector('[data-m=local-toggle]')?.getAttribute('aria-label') === 'Abspielen');
    check('Pause', true);
  } else console.log('HINWEIS: Musikordner leer, Wiedergabe nicht geprüft');
  // Hochladen über die Oberfläche, mehrere Dateien auf einmal
  const wav = (() => { const n = 4000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
  await page.click('[data-m=local-upload]');
  await page.fill('.modal.open [name=folder]', 'Browser Upload');
  await page.setInputFiles('.modal.open [name=files]', [{ name: 'Erster_Upload.wav', mimeType: 'audio/wav', buffer: wav }, { name: 'Zweiter_Upload.wav', mimeType: 'audio/wav', buffer: wav }]);
  await page.click('.modal.open button[type=submit]');
  await until(page, () => !document.querySelector('.modal.open form'), undefined, 15000);
  await page.waitForSelector('.music-track:has-text("Zweiter Upload")');
  check('Hochgeladene Titel in der Bibliothek', /Browser Upload/.test(await page.textContent('#m-local-list')) && !!(await page.$('.music-track:has-text("Erster Upload")')));
  await page.click('.music-track:has-text("Erster Upload")');
  await until(page, () => document.querySelector('#m-local-now b')?.textContent === 'Erster Upload');
  check('Hochgeladener Titel spielt', true);
  await page.screenshot({ path: `${out}/musik-upload.png`, fullPage: true });
  await page.click('.music-row:has-text("Zweiter Upload") [data-file-del]');
  await page.click('.modal.open button[type=submit]');
  await until(page, () => !document.querySelector('.music-track[data-key]') || ![...document.querySelectorAll('.music-track')].some((b) => /Zweiter Upload/.test(b.textContent)));
  check('Eigenen Titel löschen', true);

  at('alice blitzer');
  await go(page, '#/speedcams');
  check('Keine Rechnungen mehr', !(await page.$('#view .tabs [data-tab=tickets]')) && !/Rechnung/.test(await page.textContent('#view')));
  await page.click('#sc-cam-new');
  await page.fill('.modal.open [name=name]', 'Browser Blitzer');
  await page.fill('.modal.open [name=location]', 'Vinewood Blvd');
  await page.fill('.modal.open [name=speed_limit]', '80');
  await page.setInputFiles('.modal.open [name=photo]', { name: 'blitzer.png', mimeType: 'image/png', buffer: PNG });
  await submit(page);
  const card = await page.waitForSelector('.cam-card:has-text("Browser Blitzer")');
  check('Standort als Karte mit Tempo', /Vinewood Blvd/.test(await card.textContent()) && (await (await card.$('.cam-limit')).textContent()) === '80');
  await page.waitForSelector('.cam-card:has-text("Browser Blitzer") .cam-photo img');
  check('Bild in der Karte', true);
  await page.screenshot({ path: `${out}/blitzer.png` });
  await page.click('.cam-card:has-text("Browser Blitzer") .cam-photo');
  await page.waitForSelector('.modal.open .lightbox-img');
  check('Bild groß', true);
  await page.click('.modal.open button[type=submit]');
  await page.click('.cam-card:has-text("Browser Blitzer") [data-cam-edit]');
  await page.uncheck('.modal.open [name=active]');
  await page.check('.modal.open [name=remove_photo]');
  await submit(page);
  check('Abgeschaltet verschwindet aus „Aktiv“', !(await page.$('.cam-card:has-text("Browser Blitzer")')));
  await page.click('#sc-state [data-s=off]');
  await page.waitForSelector('.cam-card:has-text("Browser Blitzer") .cam-photo.empty');
  check('Unter „Abgeschaltet“ ohne Bild', true);

  // Pinnwand, Umfrage, Abwesenheit, Discord-Tab, globale Suche (2026-11-13)
  at('alice pinnwand');
  await go(page, '#/board');
  await page.click('#b-new');
  await page.fill('.modal.open [name=title]', 'Browser-Ankündigung');
  await page.fill('.modal.open [name=body]', 'Bitte **alle** lesen');
  await submit(page);
  await page.waitForSelector('.notice:has-text("Browser-Ankündigung") strong');
  check('Ankündigung mit Markdown', true);
  await page.click('#view .tabs [data-tab=polls]');
  await page.click('#b-poll-new');
  await page.fill('.modal.open [name=question]', 'Browser-Umfrage?');
  await page.fill('.modal.open [name=options]', 'Ja\nNein');
  await submit(page);
  await page.click('article:has-text("Browser-Umfrage?") .poll-opt:has-text("Ja") input');
  await page.click('article:has-text("Browser-Umfrage?") [data-vote]');
  await until(page, () => [...document.querySelectorAll('#b-polls article')].some((a) => a.textContent.includes('Browser-Umfrage?') && a.textContent.includes('1 Stimme')));
  check('Abgestimmt, Ergebnis sichtbar', true);
  await page.screenshot({ path: `${out}/pinnwand-umfrage.png`, fullPage: true });
  at('alice personal');
  await go(page, '#/personnel?tab=absences');
  await page.click('#ab-new');
  await page.selectOption('.modal.open [name=kind]', 'vacation');
  await submit(page);
  check('Abwesenheit gemeldet', /Urlaub/.test(await page.textContent('#pe-body')));
  at('alice discord');
  await go(page, '#/teams?tab=discord');
  await page.waitForSelector('#dc-form');
  check('Discord-Tab für die Inhaberin', /Webhook-URL/.test(await page.textContent('#t-panel')));
  at('alice suche');
  await page.fill('#gsearch', 'Muster');
  await page.waitForSelector('#gsearch-res:not([hidden]) a');
  check('Suche zeigt Treffer', /Person/.test(await page.textContent('#gsearch-res')));
  await page.screenshot({ path: `${out}/suche.png` });
  await page.press('#gsearch', 'Enter');
  await until(page, () => location.hash.startsWith('#/casefiles?person='));
  check('Enter öffnet den ersten Treffer', true);

  // Dienstplan, Personal, Lager (Block B)
  at('alice dienstplan');
  await go(page, '#/shifts');
  await page.click('#s-plan');
  await submit(page);
  await page.waitForSelector('.shift-card');
  const joinBtn = await page.$('.shift-card:not(.past) [data-join]');
  if (joinBtn) { await joinBtn.click(); await page.waitForSelector('.shift-card.mine'); }
  check('Schichten geplant und eingetragen', !!(await page.$('.shift-card.mine')));
  await page.screenshot({ path: `${out}/dienstplan.png`, fullPage: true });
  await page.click('#s-tabs [data-tab=now]');
  await until(page, () => /Eingestempelt/.test(document.querySelector('#s-body')?.textContent || ''));
  check('Im Dienst', true);
  at('alice personal');
  await go(page, '#/personnel?tab=applications');
  await page.waitForSelector('#ap-new');
  await page.click('#ap-new');
  await page.fill('.modal.open [name=name]', 'Browser Bewerber');
  await submit(page);
  check('Bewerbung angelegt', /Browser Bewerber/.test(await page.textContent('#pe-body')));
  await page.click('#pe-tabs [data-tab=records]');
  await page.waitForSelector('[data-pe-open]');
  await page.click('tr:has-text("carol") [data-pe-open]');
  await page.waitForSelector('.modal.open [name=kind]');
  await page.selectOption('.modal.open [name=kind]', 'commendation');
  await page.fill('.modal.open [name=title]', 'Browser-Belobigung');
  await submit(page);
  check('Belobigung eingetragen', true);
  at('alice lager');
  await go(page, '#/equipment');
  await page.click('#eq-new');
  await page.fill('.modal.open [name=name]', 'Schutzweste');
  await page.fill('.modal.open [name=serial]', 'WEST-');
  await page.fill('.modal.open [name=count]', '2');
  await submit(page);
  await page.click('tr:has-text("WEST-1") [data-issue]');
  await page.selectOption('.modal.open [name=user_id]', { label: 'alice (Leitung)' });
  await submit(page);
  await page.waitForSelector('#eq-mine .list-item');
  check('Eigene Ausrüstung oben', /Schutzweste/.test(await page.textContent('#eq-mine')));
  await page.screenshot({ path: `${out}/lager.png`, fullPage: true });

  // Einsätze & Funk, Fahndungsboard, Bußgeldrechner (Block C)
  at('alice einsaetze');
  await go(page, '#/dispatch?tab=units');
  await page.click('#u-new');
  await page.fill('.modal.open [name=callsign]', 'Browser-1');
  await submit(page);
  await page.click('.tabs [data-tab=board]');
  await page.waitForSelector('.unit-card:has-text("Browser-1")');
  await page.click('#d-new');
  await page.fill('.modal.open [name=title]', 'Browser-Einsatz');
  await page.click('.modal.open .stack label:has-text("Browser-1") input');
  await submit(page);
  await until(page, () => /Browser-Einsatz/.test(document.querySelector('#d-body')?.textContent || ''));
  check('Browser-1 alarmiert', /Browser-Einsatz/.test(await page.textContent('.unit-card:has-text("Browser-1")')));
  await page.click('.unit-card:has-text("Browser-1") .fms-btn.s4');
  await until(page, () => document.querySelector('.unit-card.st4') !== null);
  check('Status 4 gesetzt', true);
  await page.screenshot({ path: `${out}/einsaetze.png`, fullPage: true });
  at('alice bolo');
  await go(page, '#/bolo');
  check('Fahndungsboard', /aktive Fahndung/.test(await page.textContent('#bo-board')));
  await page.screenshot({ path: `${out}/fahndungsboard.png`, fullPage: true });
  at('alice bussgeld');
  await go(page, '#/fines');
  await page.selectOption('#fi-area', { label: 'E2E Team' });
  await page.waitForTimeout(400);
  const firstCode = await page.$('#fi-list [data-code]');
  if (firstCode) { await page.click('#fi-list [data-code]'); await until(page, () => /Summe/.test(document.querySelector('#fi-sum')?.textContent || '') && !!document.querySelector('#fi-file')); }
  check('Bußgeldrechner rechnet', !firstCode || /€/.test(await page.textContent('#fi-sum')));
  await page.screenshot({ path: `${out}/bussgeld.png`, fullPage: true });

  // Rechnungen, Kasse, Lohnzettel (Block D)
  at('alice rechnungen');
  await go(page, '#/invoices');
  await page.click('#iv-new');
  await page.fill('.modal.open [name=recipient_name]', 'Browser Kunde');
  await page.fill('.modal.open .inv-item [data-k=text]', 'Ölwechsel');
  await page.fill('.modal.open .inv-item [data-k=price]', '49,90');
  await page.click('.modal.open [data-add-item]');
  await page.fill('.modal.open .inv-item:nth-child(2) [data-k=text]', 'Filter');
  await page.fill('.modal.open .inv-item:nth-child(2) [data-k=qty]', '2');
  await page.fill('.modal.open .inv-item:nth-child(2) [data-k=price]', '5');
  check('Summe im Formular', /59,90/.test(await page.textContent('.modal.open [data-inv-total]')));
  await submit(page);
  const invRowEl = await page.waitForSelector('#iv-body tr:has-text("Browser Kunde")');
  check('Rechnung in der Liste', /59,90/.test(await invRowEl.textContent()));
  await page.screenshot({ path: `${out}/rechnungen.png`, fullPage: true });
  at('alice kasse');
  await go(page, '#/cash');
  check('Kasse ohne Kasse erklärt', /Kasse/.test(await page.textContent('#ca-body')));
  at('alice lohnzettel');
  await go(page, '#/work');
  check('Lohnzettel-Knopf', !!(await page.$('#work-payslip')));
  await ctx.close();
}

// ---------- Mobil & Dunkel
{
  const { page, at, ctx } = await session({ width: 390, height: 800 });
  at('mobil-login');
  await login(page, 'alice@e2e.test', 'alice-Sehr-Sicher-9931!');
  for (const h of ['#/dashboard', '#/transactions', '#/work', '#/budgets', '#/spending', '#/recurring', '#/goals', '#/reports', '#/teams', '#/calendar', '#/notes', '#/todos', '#/sport-run', '#/assets-vehicles', '#/assets-properties', '#/casefiles?tab=people', '#/fleet', '#/speedcams', '#/music', '#/board', '#/shifts', '#/personnel', '#/equipment', '#/dispatch', '#/bolo', '#/fines', '#/invoices', '#/cash', '#/assets-keys', '#/assets-manage', '#/help', '#/bug-report', '#/settings', '#/impressum', '#/datenschutz']) {
    at(`mobil ${h}`);
    await go(page, h);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`Mobil ${h} kein horizontales Scrollen`, over <= 1, `${over}px`);
    if (['#/sport-run', '#/spending', '#/datenschutz', '#/work', '#/notes', '#/todos', '#/bug-report', '#/speedcams', '#/music', '#/board'].includes(h)) await page.screenshot({ path: `${out}/mobil-${h.slice(2)}.png` });
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
  await page.mouse.click(370, 400);
  await page.waitForTimeout(300);
  check('Mobilmenü schließt beim Tippen daneben', await page.locator('.sidebar.open').count() === 0);
  at('mobil benachrichtigungen');
  await page.click('#bell');
  await page.waitForSelector('#notification-popover:not([hidden])');
  const pop = await page.$eval('#notification-popover', (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; });
  check('Mobil: Benachrichtigungen ganz im Bild', pop.left >= 0 && pop.right <= pop.width, JSON.stringify(pop));
  await page.screenshot({ path: `${out}/mobil-benachrichtigungen.png` });
  await page.click('#bell');
  at('mobil tabellen als karten');
  await go(page, '#/transactions');
  const stacked = await page.evaluate(() => {
    const table = document.querySelector('#view table.table');
    const cell = table?.querySelector('tbody td');
    return { stackable: table?.classList.contains('stackable'), label: cell?.dataset.label, head: getComputedStyle(table.querySelector('thead')).display };
  });
  check('Mobil: Tabelle als Karten mit Beschriftung', stacked.stackable && stacked.label === 'Datum' && stacked.head === 'none', JSON.stringify(stacked));
  await page.screenshot({ path: `${out}/mobil-transactions-karten.png` });
  await ctx.close();
}

// ---------- Einmaliger Design-Dialog nach dem Login (Wunsch des Auftraggebers vom 2026-11-11)
{
  const { page, at, ctx } = await session({ width: 1400, height: 900 });
  at('design-dialog');
  await login(page, 'dave@e2e.test', 'dave-Sehr-Sicher-9931!', { keepChoice: true });
  await page.waitForSelector('.design-choice', { timeout: 5000 });
  check('Design-Dialog beim ersten Login mit vier Designs', await page.locator('.design-choice [data-version]').count() === 4);
  await page.click('.design-choice [data-version=v2]');
  check('Design-Dialog: Klick zeigt V2 sofort', await page.evaluate(() => document.documentElement.dataset.ui === 'v2'));
  await page.screenshot({ path: `${out}/design-dialog.png` });
  await page.click('.design-choice button[type=submit]');
  await page.waitForSelector('.design-choice', { state: 'detached' });
  await page.reload();
  await page.waitForSelector('.app:not(.hidden) #view');
  await settle(page);
  await page.waitForTimeout(1500);
  check('Design-Dialog erscheint nur einmal', await page.locator('.design-choice').count() === 0);
  check('Design-Dialog: Wahl gespeichert', await page.evaluate(() => document.documentElement.dataset.ui === 'v2'));
  await ctx.close();
}

// ---------- Design V2: Umschalten, eigenes Hintergrundbild, Dashboard anpassen (Wunsch des Auftraggebers vom 2026-11-11)
{
  const { page, at, ctx } = await session({ width: 1400, height: 900 });
  at('v2 umschalten');
  await login(page, 'bob@e2e.test', 'bob-Sehr-Sicher-9931!');
  await go(page, '#/settings');
  await page.click('[data-tab=appearance]');
  await page.click('[data-version=v2]');
  await page.waitForSelector('#ap-bg');
  check('V2 aktiv', await page.evaluate(() => document.documentElement.dataset.ui === 'v2' && !!document.querySelector('.sidebar .nav .nav-i')));
  check('V2: Karten sind Glas', await page.evaluate(() => getComputedStyle(document.querySelector('#view .card')).backdropFilter.includes('blur')));
  at('v2 eigenes bild');
  await page.setInputFiles('#ap-file', { name: 'bild.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('[data-bgp=custom].on', { timeout: 10000 });
  await until(page, () => document.querySelector('#bg-layer').classList.contains('has-image'));
  check('V2: eigenes Bild als Hintergrund', await page.evaluate(() => getComputedStyle(document.querySelector('#bg-layer')).backgroundImage.startsWith('url("data:image/jpeg')));
  at('v2 regler');
  await page.$eval('[data-pref=blur]', (input) => { input.value = '5'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await until(page, () => document.documentElement.style.getPropertyValue('--v2-blur') === '5px');
  check('V2: Regler wirkt sofort', true);
  await page.screenshot({ path: `${out}/v2-einstellungen.png` });
  at('v2 dashboard anpassen');
  await go(page, '#/dashboard');
  await page.waitForSelector('.dash-grid');
  check('V2: Standard-Dashboard mit Stundenzettel', await page.locator('[data-mod=timer]').count() === 1);
  await page.click('#d-edit');
  await page.click('[data-mod=categories] [data-hide]');
  await page.waitForSelector('[data-add=categories]');
  await page.selectOption('[data-mod=cashflow] [data-span]', '12');
  await page.waitForSelector('[data-mod=cashflow][data-span="12"]');
  await page.click('[data-mod=timer] [data-move="-1"]');
  await page.waitForTimeout(400);
  const before = await page.$$eval('.dash-mod', (n) => n.map((x) => x.dataset.mod).join());
  await page.reload();
  await page.waitForSelector('.dash-grid');
  await settle(page);
  const after = await page.$$eval('.dash-mod', (n) => n.map((x) => x.dataset.mod).join());
  check('V2: Dashboard-Modul Musik', after.includes('music') && /Musik/.test(await page.textContent('[data-mod=music]')), after);
  check('V2: Layout bleibt nach dem Neuladen', after === before && !after.includes('categories') && after.indexOf('timer') < after.indexOf('cashflow'), `${before} | ${after}`);
  await page.screenshot({ path: `${out}/v2-dashboard.png` });
  await page.click('#d-edit');
  await page.click('[data-reset]');
  await page.waitForSelector('[data-mod=categories]');
  check('V2: Standard wiederherstellen', await page.locator('[data-mod=categories]').count() === 1);
  // Schrift im Diagramm-Tooltip immer in Kontrastfarbe zum Hintergrund (Wunsch vom 2026-11-11), hell und dunkel
  at('v2 diagramm kontrast');
  const themeOrig = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of ['dark', 'light']) {
    const ratio = await page.evaluate(async (t) => {
      document.documentElement.dataset.theme = t;
      const rect = document.querySelector('#d-cash svg rect[fill="transparent"]');
      const box = rect.getBoundingClientRect();
      rect.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + box.width * 0.9, clientY: box.top + box.height / 2 }));
      await new Promise((r) => setTimeout(r, 200));
      const tip = document.querySelector('#d-cash .chart-tip');
      const rgb = (c) => {
        const n = c.match(/[\d.]+/g).map(Number);
        return c.startsWith('color(') ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
      };
      const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const style = getComputedStyle(tip);
      const [a, b] = [lum(style.color), lum(style.backgroundColor)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    }, theme);
    check(`V2 ${theme}: Diagramm-Tooltip gut lesbar`, ratio >= 4.5, `Kontrast ${ratio.toFixed(2)}`);
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, themeOrig);
  at('v2 zurück auf v1');
  await go(page, '#/settings');
  await page.click('[data-tab=appearance]');
  await page.click('[data-version=v1]');
  await until(page, () => !document.documentElement.dataset.ui);
  check('Zurück auf V1 ohne Hintergrund', await page.evaluate(() => getComputedStyle(document.querySelector('#bg-layer')).display === 'none'));
  await ctx.close();
}

// ---------- Designs V3 und V4: Navigation oben als Pillen (Wunsch des Auftraggebers vom 2026-11-13)
{
  const { page, at, ctx } = await session({ width: 1400, height: 900 });
  at('v3 umschalten');
  await login(page, 'bob@e2e.test', 'bob-Sehr-Sicher-9931!');
  await go(page, '#/settings');
  await page.click('[data-tab=appearance]');
  await page.click('[data-version=v3]');
  await until(page, () => document.documentElement.dataset.shell === 'top');
  check('V3: Seitenleiste weg, Navigation oben', await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).display === 'none' && getComputedStyle(document.querySelector('.topnav')).display !== 'none'));
  check('V3: ohne Glas und Bild', await page.evaluate(() => !document.documentElement.dataset.ui && getComputedStyle(document.querySelector('#bg-layer')).display === 'none'));
  check('V3: Dashboard-Karte in den Einstellungen', await page.locator('a[href="#/dashboard?edit=1"]').count() === 1);
  at('v3 pillen');
  await go(page, '#/dashboard');
  await page.waitForSelector('.dash-grid');
  const pillOn = () => page.evaluate(() => {
    const pills = document.querySelector('#topnav-pills');
    const on = pills.querySelector('button[aria-pressed=true]');
    const clip = pills.querySelector('.topnav-pill').style.clipPath;
    return { label: on?.textContent, clip, left: on ? on.offsetLeft : -1 };
  });
  const start = await pillOn();
  check('V3: Bereich Finanzen aktiv', start.label === 'Finanzen' && /inset\(/.test(start.clip), JSON.stringify(start));
  check('V3: Seiten des Bereichs als Chips', await page.locator('#topnav-pages a[aria-current=page][href="#/dashboard"]').count() === 1 && await page.locator('#topnav-pages a[href="#/transactions"]').count() === 1);
  check('V3: Begrüßung im Dashboard', /Guten (Morgen|Tag|Abend)/.test(await page.textContent('.page-head h1')));
  await page.screenshot({ path: `${out}/v3-dashboard.png` });
  await page.click('#topnav-pills button:has-text("Organisation")');
  await settle(page);
  await page.waitForTimeout(700);
  const org = await pillOn();
  check('V3: Klick auf Bereich öffnet dessen erste Seite', /^#\/teams/.test(await page.evaluate(() => location.hash)) && org.label === 'Organisation', JSON.stringify(org));
  const [, , , , l] = org.clip.match(/inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px/) || [];
  check('V3: Pille steht auf dem neuen Bereich', Math.abs(Number(l) - org.left) < 1.5, `${org.clip} / ${org.left}`);
  await page.click('#topnav-pages a[href="#/fleet"]');
  await settle(page);
  await page.click('#topnav-pills button:has-text("Finanzen")');
  await settle(page);
  await page.click('#topnav-pills button:has-text("Organisation")');
  await settle(page);
  check('V3: Bereich merkt sich die letzte Seite', /^#\/fleet/.test(await page.evaluate(() => location.hash)));
  await page.screenshot({ path: `${out}/v3-organisation.png` });
  await go(page, '#/settings');
  check('V3: Seite ohne Bereich zeigt keine Pille', await page.evaluate(() => !document.querySelector('#topnav-pills button[aria-pressed=true]')));
  at('v3 handy');
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, '#/reports');
  await page.waitForTimeout(400);
  check('V3 Handy: kein waagrechtes Scrollen', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), String(await page.evaluate(() => document.documentElement.scrollWidth)));
  check('V3 Handy: Pillen scrollen, aktiver Bereich sichtbar', await page.evaluate(() => {
    const on = document.querySelector('#topnav-pills button[aria-pressed=true]').getBoundingClientRect();
    return on.left >= -1 && on.right <= innerWidth + 1;
  }));
  await page.screenshot({ path: `${out}/v3-handy.png`, fullPage: false });
  await page.setViewportSize({ width: 1400, height: 900 });
  at('v4 glas');
  await go(page, '#/settings');
  await page.click('[data-tab=appearance]');
  await page.click('[data-version=v4]');
  await page.waitForSelector('#ap-bg');
  check('V4: Navigation oben mit Glas und Hintergrund', await page.evaluate(() => document.documentElement.dataset.shell === 'top' && document.documentElement.dataset.ui === 'v2'
    && getComputedStyle(document.querySelector('#bg-layer')).display === 'block' && getComputedStyle(document.querySelector('.topnav-pills')).backdropFilter.includes('blur')));
  await go(page, '#/dashboard');
  await page.waitForSelector('.dash-grid');
  await page.screenshot({ path: `${out}/v4-dashboard.png` });
  await page.reload();
  await page.waitForSelector('.app:not(.hidden) #view');
  check('V4: gilt sofort nach dem Neuladen', await page.evaluate(() => document.documentElement.dataset.shell === 'top' && document.documentElement.dataset.ui === 'v2'));
  at('v4 zurück auf v1');
  await go(page, '#/settings');
  await page.click('[data-tab=appearance]');
  await page.click('[data-version=v1]');
  await until(page, () => !document.documentElement.dataset.shell && !document.documentElement.dataset.ui);
  check('Zurück auf V1 mit Seitenleiste', await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).display !== 'none' && getComputedStyle(document.querySelector('.topnav')).display === 'none'));
  await ctx.close();
}

await browser.close();
const uniq = [...new Set(problems)];
console.log(`\nBrowser-E2E: ${passed} bestanden, ${fails.length} fehlgeschlagen, ${uniq.length} Laufzeitprobleme`);
if (fails.length) console.log(fails.map((f) => ` - ${f}`).join('\n'));
if (uniq.length) console.log('Laufzeitprobleme:\n' + uniq.map((f) => ` - ${f}`).join('\n'));
process.exit(fails.length || uniq.length ? 1 : 0);
