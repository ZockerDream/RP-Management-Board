// Update im selben Browserprofil ohne Cache-Löschen. Erst "before" auf der alten Version, dann Update einspielen, dann "after".
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:18088';
const phase = process.argv[2] || 'after';
const OUT = process.argv[3] || '/work/upgrade-shots';
const PROFILE = process.argv[4] || '/work/upgrade-profile';
const ROUTES = { notes: 'Notizblock', todos: 'ToDos', spending: 'Budgets', 'sport-run': 'Laufen', 'sport-swim': 'Schwimmen', 'sport-bike': 'Biken', 'assets-vehicles': 'Fahrzeuge', 'assets-properties': 'Häuser', 'assets-people': 'Personen', 'assets-keys': 'Schlüssel', 'assets-manage': 'Verwaltung', casefiles: 'Akten', trainings: 'Schulungen', licenses: 'Lizenzen', docs: 'Dokumentationen', 'admin-users': 'User-Management', 'admin-server': 'Server-Management', 'admin-tickets': 'Tickets', datenschutz: 'Datenschutzerklärung', impressum: 'Impressum' };

const ctx = await chromium.launchPersistentContext(PROFILE, { viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
const page = ctx.pages()[0] || await ctx.newPage();
const problems = [];
const fails = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().includes('/auth/refresh')) problems.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

await page.goto(`${BASE}/`);
await page.waitForSelector('#auth:not(.hidden) #login, .app:not(.hidden) #view', { timeout: 20000 });
if (await page.$('#auth:not(.hidden) #login')) {
  await page.fill('#login [name=email]', 'admin@e2e.test');
  await page.fill('#login [name=password]', 'E2e-Admin-Passw0rd!x');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.app:not(.hidden) #view', { timeout: 20000 });
}
await page.waitForTimeout(800);
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(700); };

if (phase === 'before') {
  // Normale Nutzung auf der alten Version, damit alles im Browser-Cache liegt
  for (const r of ['dashboard', 'transactions', 'work', 'budgets', 'recurring', 'goals', 'reports', 'teams', 'calendar', 'assets', 'help', 'settings', 'admin', 'impressum']) await go(`#/${r}`);
  console.log('Alte Version besucht');
} else {
  // Das tut ein Nutzer nach dem Update: normal neu laden, nichts löschen
  await page.reload();
  await page.waitForTimeout(1000);
  for (const [route, title] of Object.entries(ROUTES)) {
    await go(`#/${route}`);
    const hash = await page.evaluate(() => location.hash), h1 = await page.evaluate(() => document.querySelector('#view h1')?.textContent || '');
    if (!hash.startsWith(`#/${route}`) || h1 !== title) fails.push(`${route}: Adresse ${hash}, Titel "${h1}"`);
  }
  await go('#/impressum');
  if (!(await page.$('#view .legal'))) fails.push('Impressum zeigt nicht das aktuelle Layout');
  await page.screenshot({ path: `${OUT}/impressum.png` }).catch(() => {});
  await go('#/sport-run');
  await page.screenshot({ path: `${OUT}/sport.png` }).catch(() => {});
  for (const p of new Set(problems)) fails.push(p);
  console.log(fails.length ? `Upgrade fehlgeschlagen:\n${fails.map((f) => ` - ${f}`).join('\n')}` : `Upgrade in Ordnung: ${Object.keys(ROUTES).length} Seiten aktuell, ohne Cache-Löschen`);
}
await ctx.close();
process.exit(fails.length ? 1 : 0);
