// Klick-Roboter: jede Aktionsart auf jeder Seite/jedem Tab, je Rolle. Zwei Durchläufe: sicher (Bestätigungen abbrechen), dann destruktiv.
// Schnell durch: Warten auf offene Anfragen statt fester Pausen, kein Umweg über eine andere Seite zum Neuladen,
// Formulare in einem Schritt ausfüllen, deaktivierte Knöpfe überspringen und je Durchlauf mehrere Browser parallel.
// Umgebung: BASE, CRAWL_OUT, CRAWL_WORKERS (Standard 3), CRAWL_ROLES (z. B. carol,alice), CRAWL_SHOTS (pages | all | none), ONLY_ADMIN
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:18088', OUT = process.env.CRAWL_OUT || '/work/crawl'; fs.mkdirSync(OUT, { recursive: true });
const WORKERS = Math.max(1, Number(process.env.CRAWL_WORKERS) || 3);
const SHOTS = process.env.CRAWL_SHOTS || 'pages';
const ROLES = { admin: ['admin@e2e.test', 'E2e-Admin-Passw0rd!x'], alice: ['alice@e2e.test', 'alice-Sehr-Sicher-9931!'], carol: ['carol@e2e.test', 'carol-Sehr-Sicher-9931!'] };
const findings = []; let shot = 0, uniq = 0, total = 0;
const today = new Date().toISOString().slice(0, 10);
const find = (kind, where, msg) => { const f = `${kind} | ${where} | ${String(msg).slice(0, 260)}`; if (!findings.includes(f)) { findings.push(f); console.log(f); fs.writeFileSync(`${OUT}/findings.txt`, findings.join('\n')); } };
const duration = (ms) => `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`;
const shotName = (name) => `${OUT}/${String(++shot).padStart(4, '0')}-${name.replace(/[^\w-]+/g, '_').slice(0, 90)}.png`;
const browser = await chromium.launch();

// Ein Browser-Kontext mit eigener Anmeldung. Mehrere davon teilen sich in einem Durchlauf die Liste der Seiten.
async function session(role, destructive, pass) {
  const [email, password] = ROLES[role];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let where = `${role} start`, downloads = 0, lastNet = 0;
  page.on('console', (m) => { if (m.type() === 'error' && !/gravatar|status of 4\d\d/i.test(m.text())) find('KONSOLE', where, m.text()); });
  page.on('pageerror', (e) => find('JS-FEHLER', where, e.message));
  page.on('download', () => { downloads++; });
  page.on('response', async (r) => {
    const s = r.status(); if (s < 400 || !r.url().includes('/api/') || r.url().includes('/auth/refresh')) return;
    let b = ''; try { b = (await r.text()).slice(0, 180); } catch {}
    find(s >= 500 ? 'SERVER-5XX' : s === 429 ? 'RATE-LIMIT' : 'API-4XX', where, `${s} ${r.request().method()} ${r.url().replace(BASE, '')} ${b}`);
  });
  // Offene Anfragen an die App mitzählen: Fertig ist eine Aktion, wenn keine mehr läuft und kurz keine neue kam.
  // Der Token-Refresh beim Laden meldet in Playwright nie ein Ende, und allgemein gilt eine Anfrage nach 5 s als hängend,
  // damit ein einzelner Ausreißer nicht jedes Warten bis zur Obergrenze verlängert.
  const pending = new Map();
  const ours = (r) => r.url().startsWith(BASE) && !r.url().includes('/auth/refresh');
  page.on('request', (r) => { if (ours(r)) { pending.set(r, Date.now()); lastNet = Date.now(); } });
  const finished = (r) => { if (pending.delete(r)) lastNet = Date.now(); };
  page.on('requestfinished', finished); page.on('requestfailed', finished);
  const busy = () => { const now = Date.now(); for (const [r, at] of pending) { if (now - at < 5000) return true; pending.delete(r); } return false; };
  const settle = async (quiet = 100, max = 10000) => {
    const start = Date.now(); lastNet = Math.max(lastNet, start);
    while (Date.now() - start < max) {
      if (!busy() && Date.now() - lastNet >= quiet
        && !(await page.evaluate(() => /Wird geladen/.test(document.querySelector('#view')?.textContent || '')).catch(() => false))) break;
      await page.waitForTimeout(20);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  };
  const login = async () => {
    await page.goto(`${BASE}/#/login`); await page.waitForSelector('#auth:not(.hidden) #login, .app:not(.hidden) #view');
    if (await page.$('#auth:not(.hidden) #login')) {
      await settle(); await page.fill('#login [name=email]', email); await page.fill('#login [name=password]', password); await page.click('#login button[type=submit]');
      await page.waitForSelector('.app:not(.hidden) #view', { timeout: 15000 });
    }
    await settle();
  };
  const ensure = async () => { if (await page.evaluate(() => !!document.querySelector('#auth:not(.hidden) #login') || !document.querySelector('.app:not(.hidden) #view'))) { find('ABGEMELDET', where, 'Sitzung nach Aktion beendet'); await login(); } };
  const clearModals = () => page.evaluate(() => { document.querySelectorAll('#modals .modal').forEach((m) => m.remove()); document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open')); document.getElementById('toasts')?.replaceChildren(); });
  // Seite frisch aufbauen: Steht der Hash schon da, löst ein hashchange-Ereignis dasselbe Neurendern aus wie eine echte Navigation
  const open = async (hash, tab) => {
    await clearModals();
    await page.evaluate((h) => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash);
    await settle();
    if (tab) { await page.click(`#view .tabs [data-tab="${tab}"]`, { timeout: 1000 }).catch(() => {}); await settle(); }
  };
  const textCheck = async (w) => {
    const r = await page.evaluate(() => {
      const c = document.querySelector('#view')?.cloneNode(true); c?.querySelectorAll('input,select,textarea,script,style,code').forEach((x) => x.remove());
      const m = [...document.querySelectorAll('.modal.open')].map((x) => x.innerText).join(' ');
      return { text: `${c?.innerText || ''} ${m}`, err: document.querySelector('.app:not(.hidden) #view .auth-error')?.textContent || '', over: document.documentElement.scrollWidth - innerWidth };
    });
    const hit = r.text.match(/.{0,40}\b(undefined|NaN|\[object Object\]|Invalid Date|null)\b.{0,30}/);
    if (hit) find('TEXTFEHLER', w, hit[0]);
    if (r.err) find('SEITENFEHLER', w, r.err);
    if (r.over > 1) find('LAYOUT', w, `horizontal ${r.over}px`);
  };
  // Alle leeren sichtbaren Felder in einem Schritt füllen; input- und change-Ereignisse wie beim Tippen.
  // Jeder Aufruf reserviert einen eigenen Nummernblock, damit parallele Browser keine gleichen Werte eintragen.
  const fill = async (scope) => {
    const first = uniq; uniq += 100;
    await page.evaluate(({ scope, password, today, first }) => {
      let uniq = first;
      const set = (el, v) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const fields = document.querySelectorAll(`${scope} input:not([type=hidden]):not([type=checkbox]):not([type=file]):not([type=radio]), ${scope} textarea, ${scope} select`);
      for (const f of fields) {
        if (!f.getClientRects().length || getComputedStyle(f).visibility === 'hidden' || f.disabled) continue;
        const type = f.getAttribute('type') || 'text', n = (f.getAttribute('name') || f.id || '').toLowerCase();
        if (f.tagName === 'SELECT') { if (!f.value) { const o = [...f.options].map((x) => x.value).find(Boolean); if (o) set(f, o); } continue; }
        if (f.value || /allowlist|expires_at/.test(n)) continue; // beides würde den Admin aussperren und wird vom Server abgelehnt
        uniq++;
        let v = `Test Eintrag Nr ${uniq}`;
        if (type === 'password' || /password|passwort|current/.test(n)) v = password;
        else if (type === 'email' || /mail/.test(n)) v = `neu${uniq}@e2e.test`;
        else if (type === 'date') v = today;
        else if (type === 'time') v = '10:00';
        else if (type === 'month') v = today.slice(0, 7);
        else if (type === 'url' || /url/.test(n)) v = 'https://example.com/hook';
        else if (type === 'number') { const min = Number(f.getAttribute('min')); v = min > 1 ? String(min) : '2'; }
        else if (/amount|limit|betrag|price/.test(n)) v = '12,50';
        else if (/plate/.test(n)) v = `T-${uniq}`;
        else if (/code$/.test(n)) v = n === 'code' ? '000000' : `C${uniq}`;
        else if (/color/.test(n)) continue;
        else if (/duration/.test(n)) v = '12:34';
        else if (/description/.test(n)) v = 'Eine ausreichend lange Beschreibung für den Test.';
        set(f, v);
      }
    }, { scope, password, today, first });
  };
  const snap = () => page.evaluate(() => { const v = document.querySelector('#view'); return `${location.hash}|${v?.innerHTML.length}|${v?.innerText.length}|${document.querySelectorAll('.modal.open').length}|${document.querySelectorAll('.toast').length}|${document.documentElement.dataset.theme}|${document.documentElement.dataset.accent}|${document.activeElement?.tagName}`; });
  const modalState = () => page.evaluate(() => { const m = [...document.querySelectorAll('.modal.open')].pop(); if (!m) return null; const danger = !!m.querySelector('button.danger[type=submit], button[type=submit].danger'); return { title: m.querySelector('h2,h3')?.textContent || '', danger, fields: m.querySelectorAll('input:not([type=hidden]),select,textarea').length, text: m.innerText.slice(0, 120), hasSubmit: !!m.querySelector('button[type=submit]') }; });
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => ({ t: t.textContent, bad: !!t.style.background })));
  const ACTIONABLE = '#view button, #view a[href], #view [data-sel], #view input[type=checkbox], #view [data-day]';
  const collect = () => page.evaluate((selector) => [...document.querySelectorAll(selector)].map((e, i) => {
    if (e.offsetParent === null) return null;
    const data = Object.keys(e.dataset).sort().join(',');
    const label = (e.textContent || e.getAttribute('aria-label') || e.title || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const generic = data && !['tab'].includes(data);
    return { i, tag: e.tagName, type: e.type, data, label, href: e.getAttribute('href'), id: e.id, disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true',
      key: `${e.tagName}|${e.id}|${data}|${generic || e.id ? '' : label}|${generic ? label.replace(/[\d.,:€ -]+/g, '') : ''}` };
  }).filter(Boolean), ACTIONABLE);
  const log = (line) => { pass.actions.push(line); total++; };

  // Eine Seite oder nur einen ihrer Tabs. Weitere Tabs einer Seite reiht der Browser vorn ein, damit die anderen Browser
  // sie gleich übernehmen; sonst hielte eine große Seite wie die Einstellungen den ganzen Durchlauf auf.
  async function crawlPage(hash, onlyTab) {
    where = `${role} ${hash}`; await open(hash); await ensure();
    let tabs = await page.$$eval('#view .tabs:not([hidden]) [data-tab]', (t) => t.map((x) => x.dataset.tab));
    if (onlyTab !== undefined) tabs = [onlyTab];
    else if (tabs.length > 1) { pass.queue.unshift(...tabs.slice(1).map((tab) => ({ hash, tab }))); tabs = [tabs[0]]; }
    for (const tab of tabs.length ? tabs : [null]) {
      const loc = `${role} ${hash}${tab ? `/${tab}` : ''}`; where = loc;
      await open(hash, tab); await textCheck(loc);
      if (!destructive && SHOTS !== 'none') await page.screenshot({ path: shotName(loc) });
      // Auswahlfelder und Suchfelder. Versteckte (andere Tabs) und gesperrte auslassen: selectOption würde sonst je Option
      // bis zu 30 s darauf warten, dass sie sichtbar werden
      const selects = await page.$$eval('#view select', (s) => s.map((x, i) => (x.closest('form') || !x.getClientRects().length || x.disabled ? null : { i, id: x.id || x.name || i, opts: [...x.options].map((o) => o.value).slice(0, 6) })).filter(Boolean));
      if (!destructive) for (const s of selects) for (const o of s.opts) { where = `${loc} select:${s.id}=${o}`; await (await page.$$('#view select'))[s.i]?.selectOption(o, { timeout: 1000 }).catch(() => {}); await settle(); await textCheck(where); log(where); }
      // Aktionen einsammeln, je Art einmal
      await open(hash, tab);
      for (const it of await collect()) {
        if (it.data === 'tab' || it.data === 'action') continue;
        const key = `${hash}|${tab}|${it.key}`; if (pass.seen.has(key)) continue; pass.seen.add(key);
        where = `${loc} › ${it.label || it.id || it.data || it.tag}`;
        const started = Date.now();
        await open(hash, tab); await ensure();
        // Die Position kann sich geändert haben, etwa nach gelöschten Zeilen: Element neu suchen
        const current = (await collect()).find((x) => x.key === it.key);
        if (!current) { log(`${where} => nicht mehr vorhanden`); continue; }
        // Deaktivierte Knöpfe (Blättern am Rand, oberster Rang, ToDo für Leser) sind gewollt; Klicken hieße nur, auf den Timeout zu warten
        if (current.disabled) { log(`${where} => deaktiviert`); continue; }
        const el = page.locator(ACTIONABLE).nth(current.i);
        const before = await snap(), dl0 = downloads, found0 = findings.length;
        const isSubmit = it.tag === 'BUTTON' && it.type === 'submit';
        try {
          if (isSubmit) await fill('#view form');
          await el.click({ timeout: 1500 });
        } catch (e) { find('NICHT-KLICKBAR', where, e.message.split('\n')[0]); continue; }
        await settle();
        await textCheck(where);
        const m = await modalState();
        let result = 'keine sichtbare Wirkung';
        if (m) {
          result = `Dialog "${m.title}"`;
          if (SHOTS === 'all') await page.screenshot({ path: shotName(where) });
          const isConfirm = m.danger || (m.fields === 0 && /löschen|wirklich|sperren|entfernen|beenden|widerrufen|zurücksetzen/i.test(m.title + m.text));
          if (isConfirm && !destructive) { await page.click('.modal.open [data-x]', { timeout: 1000 }).catch(() => {}); result += ' (abgebrochen)'; }
          else if (m.hasSubmit) {
            await fill('.modal.open');
            await page.click('.modal.open button[type=submit]', { timeout: 1500 }).catch(() => {});
            await settle();
            const err = await page.evaluate(() => { const e = [...document.querySelectorAll('.modal.open .auth-error')].find((x) => !x.hidden); return e?.textContent || ''; });
            if (err) { find('FORMULAR-FEHLER', where, err); result += ` Fehler: ${err}`; } else result += ' abgesendet';
            await textCheck(where);
            if (SHOTS === 'all') await page.screenshot({ path: shotName(`danach-${where}`) }).catch(() => {});
          } else if (destructive || !isConfirm) { await page.click('.modal.open [data-x], .modal.open [data-close]', { timeout: 1000 }).catch(() => {}); }
        } else if (downloads > dl0) result = 'Download';
        else {
          const ts = await toasts();
          if (ts.length) { result = `Meldung: ${ts.map((x) => x.t).join('; ')}`; for (const t of ts) if (t.bad) find('FEHLERMELDUNG', where, t.t); }
          else if ((await snap()) !== before) result = 'Ansicht geändert';
          else find('OHNE-WIRKUNG', where, `${it.tag} ${it.data || it.id}`);
        }
        // Bildschirmfoto nur, wenn diese Aktion etwas Neues gefunden hat
        if (SHOTS !== 'none' && findings.length > found0) await page.screenshot({ path: shotName(`fund-${where}`) }).catch(() => {});
        log(`${where} => ${result} (${Date.now() - started} ms)`);
        await clearModals();
      }
    }
  }

  await login();
  return {
    navs: () => page.$$eval('.sidebar a.nav', (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => n.getAttribute('href'))),
    async drain() {
      while (pass.queue.length) {
        const item = pass.queue.shift();
        const [hash, tab] = typeof item === 'string' ? [item, undefined] : [item.hash, item.tab];
        const started = Date.now();
        try { await crawlPage(hash, tab); } catch (e) { find('ROBOTER-ABBRUCH', `${role} ${hash}`, e.stack.split('\n').slice(0, 3).join(' ')); }
        pass.timings.push([`${hash}${tab ? `/${tab}` : ''}`, Date.now() - started]);
        fs.writeFileSync(`${OUT}/actions-${role}-${destructive ? 'd' : 's'}.txt`, pass.actions.join('\n'));
      }
    },
    close: () => ctx.close(),
  };
}

async function run(role, destructive) {
  const started = Date.now();
  const pass = { queue: [], seen: new Set(), actions: [], timings: [] };
  const sessions = await Promise.all(Array.from({ length: WORKERS }, () => session(role, destructive, pass)));
  pass.queue.push(...await sessions[0].navs(), '#/settings');
  await Promise.all(sessions.map((s) => s.drain()));
  await Promise.all(sessions.map((s) => s.close()));
  const slowest = pass.timings.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, ms]) => `${name} ${duration(ms)}`).join(', ');
  console.log(`### ${role} ${destructive ? 'destruktiv' : 'sicher'}: ${pass.actions.length} Aktionen in ${duration(Date.now() - started)} (langsamste: ${slowest})`);
}
const main = async () => {
  const started = Date.now();
  const only = process.env.CRAWL_ROLES?.split(',').map((r) => r.trim());
  const passes = (process.env.ONLY_ADMIN ? [['admin', false], ['admin', true]] : [['carol', false], ['alice', false], ['admin', false], ['alice', true], ['admin', true]])
    .filter(([role]) => !only || only.includes(role));
  console.log(`Crawler: ${passes.length} Durchläufe mit je ${WORKERS} Browsern, Bildschirmfotos: ${SHOTS}`);
  for (const [role, d] of passes) {
    try { await run(role, d); } catch (e) { find('ROBOTER-ABBRUCH', `${role}`, e.stack.split('\n').slice(0, 3).join(' ')); }
  }
  await browser.close();
  console.log(`\nFERTIG: ${total} Aktionen, ${findings.length} Auffälligkeiten in ${duration(Date.now() - started)}`);
};
await main();
