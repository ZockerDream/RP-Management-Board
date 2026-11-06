// Klick-Roboter: jede Aktionsart auf jeder Seite/jedem Tab, je Rolle. Zwei Durchläufe: sicher (Bestätigungen abbrechen), dann destruktiv.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:18088', OUT = process.env.CRAWL_OUT || '/work/crawl'; fs.mkdirSync(OUT, { recursive: true });
const ROLES = { admin: ['admin@e2e.test', 'E2e-Admin-Passw0rd!x'], alice: ['alice@e2e.test', 'alice-Sehr-Sicher-9931!'], carol: ['carol@e2e.test', 'carol-Sehr-Sicher-9931!'] };
const findings = [], actions = []; let shot = 0, uniq = 0;
const today = new Date().toISOString().slice(0, 10);
const find = (kind, where, msg) => { const f = `${kind} | ${where} | ${String(msg).slice(0, 260)}`; if (!findings.includes(f)) { findings.push(f); console.log(f); fs.writeFileSync(`${OUT}/findings.txt`, findings.join('\n')); } };
const browser = await chromium.launch();

async function run(role, destructive) {
  const [email, password] = ROLES[role];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let where = `${role} start`, downloads = 0;
  page.on('console', (m) => { if (m.type() === 'error' && !/gravatar|status of 4\d\d/i.test(m.text())) find('KONSOLE', where, m.text()); });
  page.on('pageerror', (e) => find('JS-FEHLER', where, e.message));
  page.on('download', () => { downloads++; });
  page.on('response', async (r) => {
    const s = r.status(); if (s < 400 || !r.url().includes('/api/') || r.url().includes('/auth/refresh')) return;
    let b = ''; try { b = (await r.text()).slice(0, 180); } catch {}
    find(s >= 500 ? 'SERVER-5XX' : s === 429 ? 'RATE-LIMIT' : 'API-4XX', where, `${s} ${r.request().method()} ${r.url().replace(BASE, '')} ${b}`);
  });
  const settle = async () => { for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !/Wird geladen/.test(document.querySelector('#view')?.textContent || ''))) break; await page.waitForTimeout(60); } await page.waitForTimeout(200); };
  const login = async () => {
    await page.goto(`${BASE}/#/login`); await page.waitForSelector('#auth:not(.hidden) #login, .app:not(.hidden) #view');
    if (await page.$('#auth:not(.hidden) #login')) { await page.waitForTimeout(1500); await page.fill('#login [name=email]', email); await page.fill('#login [name=password]', password); await page.click('#login button[type=submit]'); await page.waitForSelector('.app:not(.hidden) #view', { timeout: 15000 }); }
    await settle();
  };
  const ensure = async () => { if (await page.$('#auth:not(.hidden) #login') || !(await page.$('.app:not(.hidden) #view'))) { find('ABGEMELDET', where, 'Sitzung nach Aktion beendet'); await login(); } };
  const clearModals = () => page.evaluate(() => { document.querySelectorAll('#modals .modal').forEach((m) => m.remove()); document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open')); document.getElementById('toasts')?.replaceChildren(); });
  const open = async (hash, tab) => {
    await clearModals();
    await page.evaluate(() => { location.hash = '#/help'; }); await page.waitForTimeout(100);
    await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(120); await settle();
    if (tab) { await page.click(`#view .tabs [data-tab="${tab}"]`).catch(() => {}); await page.waitForTimeout(350); }
  };
  const textCheck = async (w) => {
    const t = await page.evaluate(() => { const c = document.querySelector('#view')?.cloneNode(true); c?.querySelectorAll('input,select,textarea,script,style,code').forEach((x) => x.remove()); const m = [...document.querySelectorAll('.modal.open')].map((x) => x.innerText).join(' '); return `${c?.innerText || ''} ${m}`; });
    const hit = t.match(/.{0,40}\b(undefined|NaN|\[object Object\]|Invalid Date|null)\b.{0,30}/);
    if (hit) find('TEXTFEHLER', w, hit[0]);
    const err = await page.evaluate(() => document.querySelector('.app:not(.hidden) #view .auth-error')?.textContent || '');
    if (err) find('SEITENFEHLER', w, err);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (over > 1) find('LAYOUT', w, `horizontal ${over}px`);
  };
  const fill = async (scope) => {
    for (const f of await page.$$(`${scope} input:not([type=hidden]):not([type=checkbox]):not([type=file]):not([type=radio]), ${scope} textarea, ${scope} select`)) {
      if (!(await f.isVisible()) || await f.isDisabled()) continue;
      const tag = await f.evaluate((e) => e.tagName), type = (await f.getAttribute('type')) || 'text', n = ((await f.getAttribute('name')) || (await f.getAttribute('id')) || '').toLowerCase(), cur = await f.inputValue();
      if (tag === 'SELECT') { if (!cur) { const o = await f.$$eval('option', (x) => x.map((y) => y.value).filter(Boolean)); if (o[0]) await f.selectOption(o[0]); } continue; }
      if (cur || /allowlist|expires_at/.test(n)) continue; // beides würde den Admin aussperren und wird vom Server abgelehnt
      uniq++;
      let v = 'Test Eintrag Nr ' + uniq;
      if (type === 'password' || /password|passwort|current/.test(n)) v = password;
      else if (type === 'email' || /mail/.test(n)) v = `neu${uniq}@e2e.test`;
      else if (type === 'date') v = today;
      else if (type === 'time') v = '10:00';
      else if (type === 'month') v = today.slice(0, 7);
      else if (type === 'url' || /url/.test(n)) v = 'https://example.com/hook';
      else if (type === 'number') v = (await f.getAttribute('min')) && Number(await f.getAttribute('min')) > 1 ? await f.getAttribute('min') : '2';
      else if (/amount|limit|betrag|price/.test(n)) v = '12,50';
      else if (/plate/.test(n)) v = `T-${uniq}`;
      else if (/code$/.test(n)) v = n === 'code' ? '000000' : `C${uniq}`;
      else if (/color/.test(n)) continue;
      else if (/duration/.test(n)) v = '12:34';
      else if (/description/.test(n)) v = 'Eine ausreichend lange Beschreibung für den Test.';
      await f.fill(v);
    }
  };
  const snap = () => page.evaluate(() => { const v = document.querySelector('#view'); return `${location.hash}|${v?.innerHTML.length}|${v?.innerText.length}|${document.querySelectorAll('.modal.open').length}|${document.querySelectorAll('.toast').length}|${document.documentElement.dataset.theme}|${document.documentElement.dataset.accent}|${document.activeElement?.tagName}`; });
  const modalState = () => page.evaluate(() => { const m = [...document.querySelectorAll('.modal.open')].pop(); if (!m) return null; const danger = !!m.querySelector('button.danger[type=submit], button[type=submit].danger'); return { title: m.querySelector('h2,h3')?.textContent || '', danger, fields: m.querySelectorAll('input:not([type=hidden]),select,textarea').length, text: m.innerText.slice(0, 120), hasSubmit: !!m.querySelector('button[type=submit]') }; });
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => ({ t: t.textContent, bad: !!t.style.background })));

  await login();
  const navs = await page.$$eval('.sidebar a.nav', (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => n.getAttribute('href')));
  const seen = new Set();
  for (const hash of [...navs, '#/settings']) {
    where = `${role} ${hash}`; await open(hash); await ensure();
    const tabs = await page.$$eval('#view .tabs:not([hidden]) [data-tab]', (t) => t.map((x) => x.dataset.tab));
    for (const tab of tabs.length ? tabs : [null]) {
      const loc = `${role} ${hash}${tab ? `/${tab}` : ''}`; where = loc;
      await open(hash, tab); await textCheck(loc);
      if (!destructive) await page.screenshot({ path: `${OUT}/${String(++shot).padStart(3, '0')}-${loc.replace(/[^\w-]+/g, '_')}.png` });
      // Auswahlfelder und Suchfelder
      const selects = await page.$$eval('#view select', (s) => s.map((x, i) => (x.closest('form') ? null : { i, id: x.id || x.name || i, opts: [...x.options].map((o) => o.value).slice(0, 6) })).filter(Boolean));
      if (!destructive) for (const s of selects) for (const o of s.opts) { where = `${loc} select:${s.id}=${o}`; await (await page.$$('#view select'))[s.i]?.selectOption(o).catch(() => {}); await page.waitForTimeout(250); await textCheck(where); actions.push(where); }
      // Aktionen einsammeln, je Art einmal
      await open(hash, tab);
      const collect = () => page.evaluate(() => [...document.querySelectorAll('#view button, #view a[href], #view [data-sel], #view input[type=checkbox], #view [data-day]')].map((e, i) => {
        if (e.offsetParent === null) return null;
        const data = Object.keys(e.dataset).sort().join(',');
        const label = (e.textContent || e.getAttribute('aria-label') || e.title || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const generic = data && !['tab'].includes(data);
        return { i, tag: e.tagName, type: e.type, data, label, href: e.getAttribute('href'), id: e.id, key: `${e.tagName}|${e.id}|${data}|${generic || e.id ? '' : label}|${generic ? label.replace(/[\d.,:€ -]+/g, '') : ''}` };
      }).filter(Boolean));
      const items = await collect();
      for (const it of items) {
        if (it.data === 'tab' || it.data === 'action') continue;
        const key = `${hash}|${tab}|${it.key}`; if (seen.has(key)) continue; seen.add(key);
        where = `${loc} › ${it.label || it.id || it.data || it.tag}`;
        await open(hash, tab); await ensure();
        // Die Position kann sich geändert haben, etwa nach gelöschten Zeilen: Element neu suchen
        const current = (await collect()).find((x) => x.key === it.key);
        if (!current) { actions.push(`${where} => nicht mehr vorhanden`); continue; }
        const el = page.locator('#view button, #view a[href], #view [data-sel], #view input[type=checkbox], #view [data-day]').nth(current.i);
        const before = await snap(), dl0 = downloads;
        const isSubmit = it.tag === 'BUTTON' && it.type === 'submit';
        try {
          if (isSubmit) await fill('#view form');
          await el.click({ timeout: 3000 });
        } catch (e) { find('NICHT-KLICKBAR', where, e.message.split('\n')[0]); continue; }
        await page.waitForTimeout(450); await settle();
        await textCheck(where);
        const m = await modalState();
        let result = 'keine sichtbare Wirkung';
        if (m) {
          result = `Dialog "${m.title}"`;
          await page.screenshot({ path: `${OUT}/${String(++shot).padStart(3, '0')}-${where.replace(/[^\w-]+/g, '_').slice(0, 90)}.png` });
          const isConfirm = m.danger || (m.fields === 0 && /löschen|wirklich|sperren|entfernen|beenden|widerrufen|zurücksetzen/i.test(m.title + m.text));
          if (isConfirm && !destructive) { await page.click('.modal.open [data-x]').catch(() => {}); result += ' (abgebrochen)'; }
          else if (m.hasSubmit) {
            await fill('.modal.open');
            await page.click('.modal.open button[type=submit]', { timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(700); await settle();
            const err = await page.evaluate(() => { const e = [...document.querySelectorAll('.modal.open .auth-error')].find((x) => !x.hidden); return e?.textContent || ''; });
            if (err) { find('FORMULAR-FEHLER', where, err); result += ` Fehler: ${err}`; } else result += ' abgesendet';
            await textCheck(where);
            await page.screenshot({ path: `${OUT}/${String(++shot).padStart(3, '0')}-danach-${where.replace(/[^\w-]+/g, '_').slice(0, 80)}.png` }).catch(() => {});
          } else if (destructive || !isConfirm) { await page.click('.modal.open [data-x], .modal.open [data-close]').catch(() => {}); }
        } else if (downloads > dl0) result = 'Download';
        else {
          const ts = await toasts();
          if (ts.length) { result = `Meldung: ${ts.map((x) => x.t).join('; ')}`; for (const t of ts) if (t.bad) find('FEHLERMELDUNG', where, t.t); }
          else if ((await snap()) !== before) result = 'Ansicht geändert';
          else find('OHNE-WIRKUNG', where, `${it.tag} ${it.data || it.id}`);
        }
        actions.push(`${where} => ${result}`); fs.writeFileSync(`${OUT}/actions-${role}-${destructive ? 'd' : 's'}.txt`, actions.join('\n'));
        await clearModals();
      }
    }
  }
  await ctx.close();
}
const main = async () => {
  const passes = process.env.ONLY_ADMIN ? [['admin', false], ['admin', true]] : [['carol', false], ['alice', false], ['admin', false], ['alice', true], ['admin', true]];
  for (const [role, d] of passes) {
    console.log(`### ${role} ${d ? 'destruktiv' : 'sicher'}`);
    try { await run(role, d); } catch (e) { find('ROBOTER-ABBRUCH', `${role}`, e.stack.split('\n').slice(0, 3).join(' ')); }
  }
  await browser.close();
  console.log(`\nFERTIG: ${actions.length} Aktionen, ${findings.length} Auffälligkeiten`);
};
await main();
