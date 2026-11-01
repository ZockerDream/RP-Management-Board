import { api } from '../api.js';
import { $, esc, fdatetime, empty, openForm, confirmBox, toast, showSecret, download } from '../ui.js';
import { state, can, reloadMe, applyTheme, renderAvatars } from '../app.js';

const ACCENTS = [['indigo', 'Indigo'], ['emerald', 'Smaragd'], ['ocean', 'Ozean'], ['rose', 'Rose'], ['amber', 'Bernstein'], ['mono', 'Mono']];
const KINDS = [['budget_80', 'Budget zu 80 % erreicht'], ['budget_exceeded', 'Budget überschritten'], ['calendar', 'Termin-Erinnerungen'], ['vehicle_service', 'Fahrzeug-Service fällig'], ['key_overdue', 'Schlüssel überfällig'], ['team_added', 'Team-Einladungen']];

export async function render(view) {
  const TABS = [['profile', 'Profil'], ['security', 'Sicherheit'], ['appearance', 'Darstellung'], ['notif', 'Benachrichtigungen'], ['sessions', 'Sitzungen'], ['keys', can('apikey:read') ? 'API & Kalender' : 'Kalender'], ['data', 'Daten']];
  view.innerHTML = `<div class="page-head"><div><h1>Einstellungen</h1><p>Profil, Sicherheit und Darstellung</p></div></div>
    <div><div class="tabs">${TABS.map(([k, l], i) => `<button data-tab="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>${TABS.map(([k], i) => `<div class="tab-panel ${i ? '' : 'on'}" data-panel="${k}"></div>`).join('')}</div>`;
  const cur = () => $('.tabs .on', view).dataset.tab;
  const u = () => state.me;
  const patchMe = async (b) => { await api.patch('/me', b); await reloadMe(); };

  const P = {
    profile(el) {
      el.innerHTML = `<form class="card" id="p-form"><div class="card-head"><h2>Profil</h2></div><div class="row start" style="gap:16px;margin-bottom:16px"><span class="avatar xl" data-me></span><small class="muted">Avatar wird über Gravatar anhand deiner E-Mail geladen (abschaltbar unter Darstellung).</small></div>
        <div class="form"><label class="field">Name<input name="name" value="${esc(u().name)}" required></label><label class="field">E-Mail<input value="${esc(u().email)}" disabled></label>
        <label class="field">Währung<select name="currency">${['EUR', 'USD', 'CHF', 'GBP'].map((c) => `<option ${c === u().currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field">Wochenstart<select name="week_start"><option value="1" ${u().week_start === 1 ? 'selected' : ''}>Montag</option><option value="0" ${u().week_start === 0 ? 'selected' : ''}>Sonntag</option></select></label></div>
        <div class="modal-foot"><button class="btn">Speichern</button></div></form>`;
      renderAvatars();
      $('#p-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try { await patchMe({ name: f.get('name').trim(), currency: f.get('currency'), week_start: Number(f.get('week_start')) }); toast('Profil gespeichert'); } catch (x) { toast(x.message, true); }
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
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Darstellung</h2></div>
        <div class="setting"><span>Modus</span><div class="seg" id="ap-mode">${[['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<button data-m="${v}" class="${v === mode ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="setting"><span>Akzentfarbe</span><div class="chips" id="ap-acc">${ACCENTS.map(([v, l]) => `<button class="btn ghost sm" data-a="${v}" style="${v === acc ? 'outline:2px solid var(--primary)' : ''}">${l}</button>`).join('')}</div></div>
        <label class="setting"><span>Gravatar-Avatar verwenden<small>Sendet einen E-Mail-Hash an gravatar.com</small></span><input type="checkbox" id="ap-grav" ${u().gravatar_enabled ? 'checked' : ''}></label></div>`;
      $('#ap-mode', el).addEventListener('click', async (e) => { const b = e.target.closest('[data-m]'); if (b) { applyTheme(b.dataset.m, u().accent); await patchMe({ theme: b.dataset.m }); P.appearance(el); } });
      $('#ap-acc', el).addEventListener('click', async (e) => { const b = e.target.closest('[data-a]'); if (b) { applyTheme(u().theme || 'system', b.dataset.a); await patchMe({ accent: b.dataset.a }); P.appearance(el); } });
      $('#ap-grav', el).addEventListener('change', async (e) => { await patchMe({ gravatar_enabled: e.target.checked }); });
    },
    async notif(el) {
      const [prefs, n] = await Promise.all([api.get('/me/notification-prefs'), api.get('/notifications')]);
      const get = (k) => prefs.find((p) => p.kind === k) || { in_app: true, email: true };
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Benachrichtigungen</h2></div><form id="n-form"><table class="table"><thead><tr><th>Ereignis</th><th>In der App</th><th>E-Mail</th></tr></thead><tbody>
        ${KINDS.map(([k, l]) => `<tr><td>${l}</td><td><input type="checkbox" name="${k}.in_app" ${get(k).in_app ? 'checked' : ''}></td><td><input type="checkbox" name="${k}.email" ${get(k).email ? 'checked' : ''}></td></tr>`).join('')}</tbody></table>
        <div class="modal-foot"><button class="btn">Speichern</button></div></form></div>
        <div class="card"><div class="card-head"><h2>Postfach</h2>${n.unread ? '<button class="btn ghost sm" id="n-read">Alle gelesen</button>' : ''}</div>${n.items.length ? n.items.map((i) => `<div class="list-item"><div class="grow"><b>${esc(i.title)}</b><small>${esc(i.body || '')}</small></div>${i.read_at ? '' : '<span class="tag warn">neu</span>'}<small>${fdatetime(i.created_at)}</small></div>`).join('') : empty('Keine Benachrichtigungen.')}</div>`;
      $('#n-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        try { await api.put('/me/notification-prefs', KINDS.map(([k]) => ({ kind: k, in_app: f[`${k}.in_app`].checked, email: f[`${k}.email`].checked }))); toast('Gespeichert'); } catch (x) { toast(x.message, true); }
      });
      $('#n-read', el)?.addEventListener('click', async () => { await api.post('/notifications/read'); $('#bell-n').textContent = ''; P.notif(el); });
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
      else if (g('#x-json')) download('budget-manager-export.json', JSON.stringify(await api.get('/me/export'), null, 2), 'application/json');
    } catch (x) { toast(x.message, true); }
  });

  await show('profile');
  if (state.mfaSetup) $('.tabs [data-tab=security]', view).click();
}
