import { api } from '../api.js';
import { $, $$, esc, fdatetime, empty, openForm, confirmBox, toast, showSecret, download } from '../ui.js';
import { state, can, reloadMe, applyTheme, applyUi, renderAvatars } from '../app.js';
import { payrollAccountOptions, payrollAccountHint } from './common.js';

const ACCENTS = [['indigo', 'Indigo'], ['emerald', 'Smaragd'], ['ocean', 'Ozean'], ['rose', 'Rose'], ['amber', 'Bernstein'], ['mono', 'Mono']];
const BACKGROUNDS = [['dusk', 'Dämmerung'], ['night', 'Nacht'], ['forest', 'Wald'], ['none', 'Ohne Bild']];

// Hintergrundbild im Browser verkleinern (höchstens 2560 px, JPEG): spart Platz im Upload-Volume und Ladezeit
async function shrinkImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Erlaubt sind PNG, JPEG und WebP.');
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('Das Bild lässt sich nicht lesen.'); }
  const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Das Bild lässt sich nicht verkleinern.');
  return blob;
}
const KINDS = [['budget_80', 'Kontolimit zu 80 % erreicht'], ['budget_exceeded', 'Kontolimit überschritten'], ['calendar', 'Termin-Erinnerungen'], ['vehicle_service', 'Fahrzeug-Service fällig'], ['first_aid_kit', 'Verbandskasten läuft ab'], ['key_overdue', 'Schlüssel-Rückgabe fällig'], ['team_added', 'Organisationen: Aufnahme und Rang'], ['recurring_share', 'Geteilte Daueraufträge'], ['todo_due', 'ToDo-Deadlines'], ['ticket_comment', 'Kommentare zu Tickets'], ['license_expiry', 'Lizenzen laufen ab'], ['training_expiry', 'Schulungsnachweise laufen ab'], ['report_review', 'Bericht wartet auf Freigabe'], ['report_decided', 'Eigener Bericht freigegeben oder zurückgegeben']];

export async function render(view) {
  const TABS = [['profile', 'Profil'], ['security', 'Sicherheit'], ['appearance', 'Darstellung'], ['notif', 'Benachrichtigungen'], ['sessions', 'Sitzungen'], ['keys', can('apikey:read') ? 'API & Kalender' : 'Kalender'], ['data', 'Daten']];
  view.innerHTML = `<div class="page-head"><div><h1>Einstellungen</h1><p>Profil, Sicherheit und Darstellung</p></div></div>
    <div><div class="tabs">${TABS.map(([k, l], i) => `<button data-tab="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>${TABS.map(([k], i) => `<div class="tab-panel ${i ? '' : 'on'}" data-panel="${k}"></div>`).join('')}</div>`;
  const cur = () => $('.tabs .on', view).dataset.tab;
  const u = () => state.me;
  const patchMe = async (b) => { await api.patch('/me', b); await reloadMe(); };

  const P = {
    async profile(el) {
      const accounts = can('budget:read') ? await api.get('/budgets') : [];
      const accountOptions = (currency, selected) => payrollAccountOptions(accounts, u(), currency)
        .map((option) => `<option value="${esc(option.v)}" ${option.v === selected ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${esc(option.l)}</option>`).join('');
      const accountHint = (currency) => payrollAccountHint(payrollAccountOptions(accounts, u(), currency), currency);
      el.innerHTML = `<form class="card" id="p-form"><div class="card-head"><h2>Profil</h2></div><div class="row start" style="gap:16px;margin-bottom:16px"><span class="avatar xl" data-me></span><small class="muted">Avatar wird über Gravatar anhand deiner E-Mail geladen (abschaltbar unter Darstellung).</small></div>
        <div class="form"><label class="field">Name<input name="name" value="${esc(u().name)}" required></label><label class="field">E-Mail<input value="${esc(u().email)}" disabled></label>
        <label class="field">Währung<select name="currency">${['EUR', 'USD', 'CHF', 'GBP'].map((c) => `<option ${c === u().currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field">Wochenstart<select name="week_start"><option value="1" ${u().week_start === 1 ? 'selected' : ''}>Montag</option><option value="0" ${u().week_start === 0 ? 'selected' : ''}>Sonntag</option></select></label>
        <label class="field">Festgehalt pro Tag (${esc(u().currency || 'EUR')})<input name="daily_salary" type="number" min="0" step="0.01" value="${esc(u().daily_salary ?? 0)}" required><small class="muted">Wird jeden Tag gutgeschrieben, auch am Wochenende und unabhängig von den Stunden.</small></label>
        <label class="field">Wochen-Sollzeit (Std.)<input name="weekly_work_hours" type="number" min="1" max="168" step="0.25" value="${esc(u().weekly_work_hours ?? 40)}" required><small class="muted">Ab dieser Stundenzahl (Montag bis Sonntag) gibt es den Bonus.</small></label>
        <label class="field">Bonus je Stunde über dem Soll (% vom Festgehalt)<input name="hourly_bonus_percent" type="number" min="0" max="1000" step="0.01" value="${esc(u().hourly_bonus_percent ?? 0)}" required><small class="muted">Beispiel: 17 % von 1.669 sind 283,73 je Stunde über dem Soll. Montags beginnt die Zählung neu.</small></label>
        <label class="field">Konto für Gehaltsgutschrift<select name="payroll_budget_id">${accountOptions(u().currency || 'EUR', u().payroll_budget_id)}</select><small class="muted" id="p-payroll-hint">${esc(accountHint(u().currency || 'EUR'))}</small></label></div>
        <div class="modal-foot"><button class="btn">Speichern</button></div></form>`;
      renderAvatars();
      $('select[name="currency"]', el).addEventListener('change', (event) => {
        const select = $('select[name="payroll_budget_id"]', el);
        const selected = accounts.some((budget) => budget.id === select.value && budget.currency === event.target.value) ? select.value : '';
        select.innerHTML = accountOptions(event.target.value, selected);
        $('#p-payroll-hint', el).textContent = accountHint(event.target.value);
      });
      $('#p-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await patchMe({
            name: f.get('name').trim(), currency: f.get('currency'), week_start: Number(f.get('week_start')),
            weekly_work_hours: Number(f.get('weekly_work_hours')), daily_salary: Number(f.get('daily_salary')),
            hourly_bonus_percent: Number(f.get('hourly_bonus_percent')),
            payroll_budget_id: f.get('payroll_budget_id') || null,
          });
          toast('Profil gespeichert');
        } catch (x) { toast(x.message, true); }
      });
    },
    security(el) {
      const on = u().totp_enabled;
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Passwort</h2></div><button class="btn" id="pw">Passwort ändern</button></div>
        <div class="card"><div class="card-head"><h2>Zwei-Faktor-Authentifizierung</h2>${on ? '<span class="tag ok">Aktiv</span>' : '<span class="tag warn">Inaktiv</span>'}</div>
        ${state.mfaSetup ? '<div class="note info">Dein Administrator verlangt 2FA. Bitte jetzt einrichten.</div>' : ''}
        <p class="muted">Schütze dein Konto mit einem Code aus einer Authenticator-App.</p>
        ${on ? '<div class="row"><button class="btn ghost" id="rc">Neue Wiederherstellungscodes</button><button class="btn ghost" id="off">2FA deaktivieren</button></div>' : '<button class="btn" id="on">2FA einrichten</button>'}</div>`;
    },
    appearance(el) {
      const mode = u().theme || 'system', acc = u().accent || 'indigo';
      const v2 = u().ui_version === 'v2';
      const prefs = u().ui_prefs;
      const bgOn = (key) => (prefs.background === key || (key === 'dusk' && prefs.background === 'custom' && !u().has_background) ? 'on' : '');
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Design</h2><small class="muted">Gilt nur für dich, auf allen Geräten</small></div>
        <div class="ui-versions" role="radiogroup" aria-label="Design-Version">
          <button type="button" role="radio" aria-checked="${!v2}" class="ui-version ${v2 ? '' : 'on'}" data-version="v1"><span class="ui-pv v1" aria-hidden="true"><i></i><i></i><i></i><i></i></span><b>V1 · Klassisch</b><small class="muted">Ruhige, flache Flächen wie bisher</small></button>
          <button type="button" role="radio" aria-checked="${v2}" class="ui-version ${v2 ? 'on' : ''}" data-version="v2"><span class="ui-pv v2" aria-hidden="true"><i></i><i></i><i></i><i></i></span><b>V2 · Glass <span class="tag primary">Neu</span></b><small class="muted">Glas-Panels über deinem Hintergrund, Dashboard frei anpassbar</small></button>
        </div>
        <div class="setting"><span>Modus</span><div class="seg" id="ap-mode">${[['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<button data-m="${v}" class="${v === mode ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="setting"><span>Akzentfarbe</span><div class="chips" id="ap-acc">${ACCENTS.map(([v, l]) => `<button class="btn ghost sm" data-a="${v}" style="${v === acc ? 'outline:2px solid var(--primary)' : ''}">${l}</button>`).join('')}</div></div>
        <label class="setting"><span>Gravatar-Avatar verwenden<small>Sendet einen E-Mail-Hash an gravatar.com</small></span><input type="checkbox" id="ap-grav" ${u().gravatar_enabled ? 'checked' : ''}></label></div>
        ${v2 ? `<div class="card"><div class="card-head"><h2>Hintergrund</h2><small class="muted">Das Bild sieht nur du</small></div>
        <div class="bg-thumbs" id="ap-bg">
          <label class="bg-thumb bg-upload"><input type="file" id="ap-file" accept="image/png,image/jpeg,image/webp"><span>${u().has_background ? 'Bild ersetzen' : 'Bild hochladen'}</span></label>
          ${u().has_background ? `<button type="button" class="bg-thumb ${bgOn('custom')}" data-bgp="custom" aria-pressed="${prefs.background === 'custom'}"><span class="bg-mini bg-own" id="ap-own"></span><span class="bg-name">Eigenes Bild</span></button>` : ''}
          ${BACKGROUNDS.map(([key, label]) => `<button type="button" class="bg-thumb ${bgOn(key)}" data-bgp="${key}" aria-pressed="${!!bgOn(key)}"><span class="bg-mini" data-bg="${key}"><i class="bg-m1"></i><i class="bg-m3"></i></span><span class="bg-name">${label}</span></button>`).join('')}
        </div>
        <p class="muted" style="margin:10px 0 0">PNG, JPEG oder WebP. Wird im Browser auf höchstens 2560 Pixel verkleinert und als JPEG gespeichert.${u().has_background ? ' <button type="button" class="link" id="ap-del">Eigenes Bild löschen</button>' : ''}</p>
        <div class="ui-sliders">
          <label class="ui-slider"><span>Unschärfe</span><input type="range" min="0" max="40" value="${prefs.blur}" data-pref="blur"><output>${prefs.blur} px</output></label>
          <label class="ui-slider"><span>Deckkraft der Panels</span><input type="range" min="20" max="90" value="${prefs.opacity}" data-pref="opacity"><output>${prefs.opacity} %</output></label>
          <label class="ui-slider"><span>Bild abdunkeln</span><input type="range" min="0" max="70" value="${prefs.dim}" data-pref="dim"><output>${prefs.dim} %</output></label>
        </div>
        <label class="setting"><span>Auf Handys ohne Unschärfe<small>Kräftige Flächen statt Glas, spart Akku und scrollt flüssiger</small></span><input type="checkbox" id="ap-lite" ${prefs.lite ? 'checked' : ''}></label>
        <div class="row" style="justify-content:flex-start;gap:8px;margin-top:12px;flex-wrap:wrap"><a class="btn ghost sm" href="#/dashboard?edit=1">Dashboard anpassen</a>${prefs.dashboard ? '<button type="button" class="btn ghost sm" id="ap-dash-reset">Dashboard auf Standard</button>' : ''}<button type="button" class="btn ghost sm" id="ap-bg-reset">Hintergrund auf Standard</button></div></div>` : ''}`;
      // Speichern kann scheitern, etwa wenn die Sitzung gerade abgelaufen ist: dann Meldung statt unbehandeltem Fehler,
      // und die Anzeige springt auf den gespeicherten Stand zurück (nach dem Abmelden gibt es keinen mehr)
      const save = async (body, undo) => {
        try { await patchMe(body); return true; } catch (error) { if (u()) undo(); toast(error.message, true); return false; }
      };
      const restoreTheme = () => applyTheme(u().theme || 'system', u().accent);
      $('#ap-mode', el).addEventListener('click', async (e) => { const b = e.target.closest('[data-m]'); if (b) { applyTheme(b.dataset.m, u().accent); if (await save({ theme: b.dataset.m }, restoreTheme)) P.appearance(el); } });
      $('#ap-acc', el).addEventListener('click', async (e) => { const b = e.target.closest('[data-a]'); if (b) { applyTheme(u().theme || 'system', b.dataset.a); if (await save({ accent: b.dataset.a }, restoreTheme)) P.appearance(el); } });
      $('#ap-grav', el).addEventListener('change', async (e) => { const box = e.target; await save({ gravatar_enabled: box.checked }, () => { box.checked = !box.checked; }); });
      $('.ui-versions', el).addEventListener('click', async (e) => {
        const b = e.target.closest('[data-version]');
        if (b && b.dataset.version !== u().ui_version && (await save({ ui_version: b.dataset.version }, () => applyUi(u())))) P.appearance(el);
      });
      if (!v2) return;
      // Live-Vorschau beim Schieben, gespeichert wird beim Loslassen
      const draft = { ...prefs };
      const savePrefs = async (next) => { applyUi({ ...u(), ui_prefs: next }); if (await save({ ui_prefs: next }, () => applyUi(u()))) P.appearance(el); };
      $$('[data-pref]', el).forEach((input) => {
        const unit = input.dataset.pref === 'blur' ? ' px' : ' %';
        input.addEventListener('input', () => {
          draft[input.dataset.pref] = Number(input.value);
          input.nextElementSibling.textContent = `${input.value}${unit}`;
          applyUi({ ...u(), ui_prefs: draft });
        });
        input.addEventListener('change', () => save({ ui_prefs: { ...draft } }, () => applyUi(u())));
      });
      $('#ap-lite', el).addEventListener('change', (e) => { draft.lite = e.target.checked; savePrefs({ ...draft }); });
      $('#ap-bg', el).addEventListener('click', (e) => {
        const b = e.target.closest('[data-bgp]');
        if (b) savePrefs({ ...draft, background: b.dataset.bgp });
      });
      $('#ap-bg-reset', el).addEventListener('click', () => savePrefs({ ...draft, background: 'dusk', blur: 22, opacity: 52, dim: 20, lite: true }));
      $('#ap-dash-reset', el)?.addEventListener('click', () => savePrefs({ ...draft, dashboard: null }));
      $('#ap-del', el)?.addEventListener('click', async () => {
        if (!(await confirmBox('Hintergrundbild löschen', 'Dein eigenes Bild wird vom Server gelöscht; der Hintergrund wechselt auf „Dämmerung“.'))) return;
        try { await api.del('/me/background'); await reloadMe(); P.appearance(el); toast('Bild gelöscht'); } catch (error) { toast(error.message, true); }
      });
      $('#ap-file', el).addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const form = new FormData();
          form.append('file', await shrinkImage(file), 'hintergrund.jpg');
          await api.put('/me/background', form);
          await patchMe({ ui_prefs: { ...draft, background: 'custom' } });
          toast('Hintergrund gespeichert');
          P.appearance(el);
        } catch (error) {
          toast(error.message, true);
          e.target.value = '';
        }
      });
      const own = $('#ap-own', el);
      // data:-URL, weil die CSP keine blob:-Adressen erlaubt
      if (own) {
        api.blob('/me/background').then((blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); }))
          .then((url) => { own.style.backgroundImage = `url("${url}")`; }).catch(() => {});
      }
    },
    async notif(el) {
      const [prefs, n] = await Promise.all([api.get('/me/notification-prefs'), api.get('/notifications')]);
      // E-Mails gehen nur nach ausdrücklicher Wahl raus; der Standard hier muss dem Verhalten des Servers entsprechen
      const get = (k) => prefs.find((p) => p.kind === k) || { in_app: true, email: false };
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Benachrichtigungen</h2></div><form id="n-form"><table class="table"><thead><tr><th>Ereignis</th><th>In der App</th><th>E-Mail</th></tr></thead><tbody>
        ${KINDS.map(([k, l]) => `<tr><td>${l}</td><td><input type="checkbox" name="${k}.in_app" ${get(k).in_app ? 'checked' : ''}></td><td><input type="checkbox" name="${k}.email" ${get(k).email ? 'checked' : ''}></td></tr>`).join('')}</tbody></table>
        <div class="modal-foot"><button class="btn">Speichern</button></div></form></div>
        <div class="card"><div class="card-head"><h2>Postfach</h2>${n.unread ? '<button class="btn ghost sm" id="n-read">Alle gelesen</button>' : ''}</div>${n.items.length ? n.items.map((i) => `<div class="list-item"><div class="grow"><b>${esc(i.title)}</b><small>${esc(i.body || '')}</small></div>${i.read_at ? '' : '<span class="tag warn">neu</span>'}<small>${fdatetime(i.created_at)}</small></div>`).join('') : empty('Keine Benachrichtigungen.')}</div>`;
      $('#n-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        try { await api.put('/me/notification-prefs', KINDS.map(([k]) => ({ kind: k, in_app: f[`${k}.in_app`].checked, email: f[`${k}.email`].checked }))); toast('Gespeichert'); } catch (x) { toast(x.message, true); }
      });
      $('#n-read', el)?.addEventListener('click', async () => {
        try { await api.post('/notifications/read'); } catch (error) { toast(error.message, true); return; }
        $('#bell-n').textContent = ''; $('#bell-n').hidden = true; $('#bell').setAttribute('aria-label', 'Benachrichtigungen'); P.notif(el);
      });
    },
    async sessions(el) {
      const s = await api.get('/me/sessions');
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Aktive Sitzungen</h2>${s.length > 1 ? '<button class="btn ghost sm" id="s-all">Alle anderen beenden</button>' : ''}</div>${s.map((x) => `<div class="list-item"><div class="grow"><b>${esc((x.user_agent || 'Unbekannt').slice(0, 80))}</b><small>${esc(x.ip || '')} · zuletzt aktiv ${fdatetime(x.last_seen_at)}</small></div>${x.current ? '<span class="tag ok">Diese Sitzung</span>' : `<button class="btn ghost sm" data-end="${x.id}">Beenden</button>`}</div>`).join('')}</div>`;
    },
    async keys(el) {
      const keys = can('apikey:read') ? await api.get('/me/api-keys') : [];
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Kalender-Abo (iCal)</h2></div><p class="muted">Abonniere deine Termine in Outlook, Apple oder Google Kalender. Ein neuer Link macht den alten ungültig.</p>
        <div class="row"><button class="btn" id="ic-new">${u().has_ical ? 'Neuen Link erzeugen' : 'Link erzeugen'}</button>${u().has_ical ? '<button class="btn ghost" id="ic-off">Deaktivieren</button>' : ''}</div></div>
        ${can('apikey:read') ? `<div class="card"><div class="card-head"><h2>API-Schlüssel</h2>${can('apikey:create') ? '<button class="btn ghost sm" id="k-new">Neuer Schlüssel</button>' : ''}</div>${keys.length ? `<table class="table"><thead><tr><th>Name</th><th>Präfix</th><th>Scope</th><th>Zuletzt genutzt</th><th></th></tr></thead><tbody>${keys.map((k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${esc(k.scope)}</td><td>${fdatetime(k.last_used_at)}</td><td>${can('apikey:delete') ? `<button class="btn ghost sm" data-kdel="${k.id}">Widerrufen</button>` : ''}</td></tr>`).join('')}</tbody></table>` : empty('Keine API-Schlüssel.')}<p class="muted">Verwendung: Header <code>Authorization: Bearer bm_live_…</code> auf <code>/api/…</code></p></div>` : ''}`;
    },
    data(el) {
      el.innerHTML = '<div class="card"><div class="card-head"><h2>Meine Daten</h2></div><p class="muted">Exportiere alle deine Daten (DSGVO) als JSON-Datei.</p><button class="btn" id="x-json">Daten exportieren</button></div>';
    },
  };

  async function renderIntegrations(el) {
    const integrations = await api.get('/integrations');
    const rows = ['google', 'microsoft'].map((provider) => {
      const account = integrations.find((item) => item.provider === provider);
      const name = provider === 'google' ? 'Google-Konto' : 'Outlook-Konto';
      return `<div class="card"><div class="card-head"><h2>${name}</h2>${account ? '<span class="tag ok">Verbunden</span>' : '<span class="tag">Nicht verbunden</span>'}</div>
        <p class="muted">${account ? `${esc(account.email)} · letzter Sync ${fdatetime(account.last_sync_at)}` : 'Kontakte und Kalendertermine werden nur lesend importiert.'}</p>
        <div class="row">${account ? `<button class="btn" id="${provider}-sync">Jetzt synchronisieren</button><button class="btn ghost" id="${provider}-disconnect">Trennen</button>` : `<button class="btn" id="${provider}-connect">${name} verbinden</button>`}</div><div id="${provider}-contacts"></div></div>`;
    }).join('');
    el.insertAdjacentHTML('afterbegin', rows);
    for (const provider of ['google', 'microsoft']) {
      if (!integrations.some((item) => item.provider === provider)) continue;
      const contacts = await api.get(`/integrations/${provider}/contacts`);
      $(`#${provider}-contacts`, el).innerHTML = contacts.length ? `<details><summary>${contacts.length} importierte Kontakte</summary>${contacts.slice(0, 100).map((contact) => `<div class="list-item"><div class="grow"><b>${esc(contact.name || '–')}</b><small>${esc(contact.email || contact.phone || '')}</small></div></div>`).join('')}</details>` : '<small class="muted">Noch keine Kontakte importiert.</small>';
    }
  }

  async function show(k = cur()) {
    if (!view.isConnected) return;
    const el = $(`.tab-panel[data-panel="${k}"]`, view);
    try { await P[k](el); if (k === 'keys') await renderIntegrations(el); } catch (x) { el.innerHTML = `<div class="card"><p class="auth-error">${esc(x.message)}</p></div>`; }
  }

  const showCodes = (codes) => showSecret('Wiederherstellungscodes', 'Bewahre diese Codes sicher auf. Jeder Code funktioniert nur einmal und wird nicht erneut angezeigt:', codes.join('   '));
  async function setup2fa() {
    const s = await api.post('/me/2fa/setup');
    return openForm({
      title: '2FA einrichten', submit: 'Aktivieren', fields: [
        { type: 'html', html: `<p>Scanne den QR-Code mit deiner Authenticator-App oder gib den Schlüssel manuell ein.</p><div class="qr" style="max-width:200px;background:#fff;padding:8px;border-radius:8px;margin:10px auto">${s.qr_svg}</div><span class="secret" style="word-break:break-all;display:block;text-align:center">${esc(s.secret)}</span>` },
        { name: 'code', label: '6-stelliger Code', required: true, full: true, autocomplete: 'one-time-code' },
      ],
      onSubmit: async (v) => {
        const r = await api.post('/me/2fa/enable', { code: v.code.trim() });
        await reloadMe();
        await showCodes(r.recovery_codes);
        toast('2FA aktiviert');
      },
    });
  }
  const askPw = (title, fn, submit) => openForm({ title, submit, fields: [{ name: 'password', label: 'Aktuelles Passwort', type: 'password', required: true, full: true, autocomplete: 'current-password' }], onSubmit: (v) => fn(v.password) });

  view.addEventListener('tabchange', () => show());
  view.addEventListener('click', async (e) => {
    const g = (s) => e.target.closest(s);
    try {
      if (g('#pw')) {
        await openForm({ title: 'Passwort ändern', fields: [{ name: 'current', label: 'Aktuelles Passwort', type: 'password', required: true, full: true, autocomplete: 'current-password' }, { name: 'password', label: 'Neues Passwort', type: 'password', required: true, full: true, autocomplete: 'new-password' }],
          onSubmit: async (v) => { await api.post('/me/password', { current: v.current, password: v.password }); toast('Passwort geändert – andere Sitzungen wurden beendet'); } });
      } else if (g('#on')) { if (await setup2fa()) show(); }
      else if (g('#off')) { if (await askPw('2FA deaktivieren', async (pw) => { await api.post('/me/2fa/disable', { password: pw }); await reloadMe(); }, 'Deaktivieren')) show(); }
      else if (g('#rc')) await askPw('Neue Wiederherstellungscodes', async (pw) => { const r = await api.post('/me/2fa/recovery', { password: pw }); await showCodes(r.recovery_codes); }, 'Erzeugen');
      else if (g('[data-end]')) { await api.del(`/me/sessions/${g('[data-end]').dataset.end}`); show(); }
      else if (g('#s-all')) { await api.del('/me/sessions'); toast('Andere Sitzungen beendet'); show(); }
      else if (g('#ic-new')) { const r = await api.post('/me/ical'); await reloadMe(); await showSecret('iCal-Link', 'Diesen Link in deinem Kalenderprogramm abonnieren (wird nur jetzt angezeigt):', r.url); show(); }
      else if (g('#ic-off')) { await api.del('/me/ical'); await reloadMe(); show(); }
      else if (g('#google-connect') || g('#microsoft-connect')) {
        const provider = g('#google-connect') ? 'google' : 'microsoft';
        const result = await api.get(`/integrations/${provider}/connect`);
        location.assign(result.url);
      } else if (g('#google-sync') || g('#microsoft-sync')) {
        const provider = g('#google-sync') ? 'google' : 'microsoft';
        const result = await api.post(`/integrations/${provider}/sync`);
        toast(`${result.contacts} Kontakte und ${result.events} Termine synchronisiert`);
        await show('keys');
      } else if (g('#google-disconnect') || g('#microsoft-disconnect')) {
        const provider = g('#google-disconnect') ? 'google' : 'microsoft';
        if (await confirmBox('Konto trennen', 'Die Verbindung und importierte Daten werden entfernt.', 'Trennen')) {
          await api.del(`/integrations/${provider}`);
          await show('keys');
        }
      }
      else if (g('#k-new')) {
        await openForm({ title: 'Neuer API-Schlüssel', fields: [{ name: 'name', label: 'Name', required: true, full: true }, { name: 'scope', label: 'Rechte', type: 'select', options: [{ v: 'read', l: 'Nur lesen' }, { v: 'write', l: 'Lesen & schreiben' }], value: 'read' }],
          onSubmit: async (v) => { const r = await api.post('/me/api-keys', { name: v.name.trim(), scope: v.scope }); await showSecret('API-Schlüssel', 'Wird nur einmal angezeigt:', r.token); } });
        show();
      } else if (g('[data-kdel]') && (await confirmBox('API-Schlüssel widerrufen', 'Der Schlüssel funktioniert danach nicht mehr.', 'Widerrufen'))) { await api.del(`/me/api-keys/${g('[data-kdel]').dataset.kdel}`); show(); }
      else if (g('#x-json')) download('rp-management-board-export.json', JSON.stringify(await api.get('/me/export'), null, 2), 'application/json');
    } catch (x) { toast(x.message, true); }
  });

  await show('profile');
  if (state.mfaSetup) $('.tabs [data-tab=security]', view).click();
}
