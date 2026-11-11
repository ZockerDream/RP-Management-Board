import { api, refresh, setToken, onLogout, hasToken } from './api.js';
import { $, $$, esc, toast, setCurrency, bindPasswordToggles, passwordToggleButton, openForm } from './ui.js';
import { md5 } from './md5.js';

export const state = { me: null, perms: new Set(), mfaSetup: false, appName: 'RP-Management-Board' };
export function applyAppName(name) {
  state.appName = (name || '').trim() || 'RP-Management-Board';
  document.title = state.appName;
  document.querySelectorAll('[data-app-name]').forEach((n) => { n.textContent = state.appName; });
}
export const can = (p) => state.perms.has(p);
// Schalter des Aktensystems aus Server-Management → Sicherheit & Einstellungen (files, wanted, codes, charges, templates, types)
export const caseFeature = (key) => state.features?.casefiles?.[key] !== false;

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

const PAGES = {
  dashboard: { perm: 'budget:read', load: () => import('./pages/dashboard.js') },
  impressum: { perm: null, load: () => import('./pages/imprint.js') },
  datenschutz: { perm: null, load: () => import('./pages/privacy.js') },
  'bug-report': { perm: null, load: () => import('./pages/bug-report.js') },
  transactions: { perm: 'transaction:read', load: () => import('./pages/transactions.js') },
  work: { perm: null, load: () => import('./pages/work.js') },
  spending: { perm: 'budget:read', load: () => import('./pages/spending.js') },
  'sport-run': { perm: null, load: () => import('./pages/sport.js').then((m) => ({ render: (view) => m.render(view, 'run') })) },
  'sport-swim': { perm: null, load: () => import('./pages/sport.js').then((m) => ({ render: (view) => m.render(view, 'swim') })) },
  'sport-bike': { perm: null, load: () => import('./pages/sport.js').then((m) => ({ render: (view) => m.render(view, 'bike') })) },
  budgets: { perm: 'budget:read', load: () => import('./pages/budgets.js') },
  recurring: { perm: 'recurring:read', load: () => import('./pages/recurring.js') },
  goals: { perm: 'goal:read', load: () => import('./pages/goals.js') },
  reports: { perm: 'report:read', load: () => import('./pages/reports.js') },
  teams: { perm: 'team:read', load: () => import('./pages/teams.js') },
  calendar: { perm: 'calendar:read', load: () => import('./pages/calendar.js') },
  notes: { perm: null, load: () => import('./pages/notes.js') },
  todos: { perm: null, load: () => import('./pages/todos.js') },
  casefiles: { perm: 'casefile:read', load: () => import('./pages/casefiles.js') },
  trainings: { perm: 'training:read', load: () => import('./pages/trainings.js') },
  licenses: { perm: 'license:read', load: () => import('./pages/licenses.js') },
  fleet: { perm: 'fleet:read', load: () => import('./pages/fleet.js') },
  docs: { perm: 'doc:read', load: () => import('./pages/docs.js') },
  'assets-vehicles': { perm: 'vehicle:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'vehicles') })) },
  'assets-properties': { perm: 'property:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'properties') })) },
  // Ausgeblendet seit 2026-11-10: Personen laufen über „Akten → Personenakten“; alte Links leitet assets.js dorthin um
  'assets-people': { perm: null, load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'people') })) },
  'assets-keys': { perm: 'key:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'keys') })) },
  'assets-manage': { perm: 'key:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'manage') })) },
  assets: { perm: 'key:read', load: () => import('./pages/assets.js') },
  help: { perm: null, load: () => import('./pages/help.js') },
  changelog: { perm: null, load: () => import('./pages/changelog.js') },
  'admin-users': { perm: 'admin:access', load: () => import('./pages/admin.js').then((m) => ({ render: (view, params) => m.render(view, params, 'users') })) },
  'admin-server': { perm: 'admin:access', load: () => import('./pages/admin.js').then((m) => ({ render: (view, params) => m.render(view, params, 'server') })) },
  'admin-tickets': { perm: 'admin:access', load: () => import('./pages/admin.js').then((m) => ({ render: (view, params) => m.render(view, params, 'tickets') })) },
  admin: { perm: 'admin:access', load: () => import('./pages/admin.js').then((m) => ({ render: (view, params) => m.render(view, params, 'users') })) },
  settings: { perm: null, load: () => import('./pages/settings.js') },
};

/* ---------- Theme / Avatar ---------- */
export function applyTheme(mode, accent) {
  const t = mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.accent = accent;
  store.set('bm-theme', mode);
  store.set('bm-accent', accent);
}

/* ---------- Darstellung V2 ---------- */
// Werte aus users.ui_prefs (Regeln in apps/api/src/ui-prefs.js). Die Einstellungen rufen das auch für die Live-Vorschau
// mit noch nicht gespeicherten Werten auf.
let backgroundShown = null;
let wantImage = false;
export function applyUi(user) {
  const root = document.documentElement;
  const layer = $('#bg-layer');
  wantImage = user?.ui_version === 'v2' && user.ui_prefs?.background === 'custom' && !!user.has_background;
  if (user?.ui_version !== 'v2') {
    delete root.dataset.ui;
    delete root.dataset.bg;
    root.removeAttribute('data-ui-lite');
    layer?.classList.remove('has-image');
    store.set('bm-ui', null);
    return;
  }
  const p = user.ui_prefs || {};
  const bg = p.background === 'custom' && !user.has_background ? 'dusk' : p.background || 'dusk';
  root.dataset.ui = 'v2';
  root.dataset.bg = bg === 'custom' ? 'none' : bg;
  root.style.setProperty('--v2-blur', `${p.blur ?? 22}px`);
  root.style.setProperty('--v2-alpha', String((p.opacity ?? 52) / 100));
  root.style.setProperty('--v2-dim', String((p.dim ?? 20) / 100));
  root.toggleAttribute('data-ui-lite', p.lite !== false);
  store.set('bm-ui', { bg, blur: p.blur ?? 22, opacity: p.opacity ?? 52, dim: p.dim ?? 20, lite: p.lite !== false });
  if (bg !== 'custom') {
    layer?.classList.remove('has-image');
    return;
  }
  // Das Bild braucht die Anmeldung; als data:-URL, weil die CSP keine blob:-Adressen erlaubt
  const version = `${user.id}:${user.background_updated_at}`;
  if (backgroundShown === version) {
    layer?.classList.add('has-image');
    return;
  }
  backgroundShown = version;
  api.blob('/me/background').then((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  })).then((url) => {
    if (backgroundShown !== version || !layer) return;
    layer.style.setProperty('--v2-image', `url("${url}")`);
    if (wantImage) layer.classList.add('has-image');
  }).catch(() => { backgroundShown = null; });
}

// Symbole der Navigation, nur in V2 sichtbar (theme-v2.css)
const NAV_ICONS = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', transactions: 'M4 6h16M4 12h16M4 18h10', work: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2',
  budgets: 'M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 7l12-4v4M16 14h2', spending: 'M12 3v9h9M12 3a9 9 0 1 0 9 9',
  recurring: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3', goals: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2', calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4', notes: 'M5 3h10l4 4v14H5zM14 3v5h5M8 13h8M8 17h5', todos: 'M4 4h16v16H4zM8 12l3 3 5-6',
  'sport-run': 'M13 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M6 20l3.5-5 3 2.5 1 4.5M8 11l3.5-3 3 2.5 3 .5M9.5 15l-1.5-4',
  'sport-swim': 'M2 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 13c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M15 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  'sport-bike': 'M2 17a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M15 17a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 17L9 9h6l3.5 8M12 17L9 9M14 6h3',
  'assets-vehicles': 'M3 13l2-6h14l2 6v5H3zM3 13h18M7 18v2M17 18v2', 'assets-properties': 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  'assets-keys': 'M15 3a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM10.8 13.2L3 21M6 18l3 3M8 16l2 2', 'assets-manage': 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
  teams: 'M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 6v1', casefiles: 'M3 6h6l2 2h10v11H3z',
  trainings: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5', licenses: 'M3 5h18v14H3zM7 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5.5 16c.5-2 5.5-2 7 0M14 10h4M14 14h3',
  fleet: 'M2 6h11v10H2zM13 9h4l4 4v3h-8M5 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  docs: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z', 'admin-users': 'M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 6v1',
  'admin-server': 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01', 'admin-tickets': 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM13 7v10',
  help: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01', changelog: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  'bug-report': 'M8 8a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0zM12 12v6M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2',
  impressum: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5h.01', datenschutz: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
};
$$('.sidebar .nav[data-nav]').forEach((n) => {
  const d = NAV_ICONS[n.dataset.nav];
  if (d) n.insertAdjacentHTML('afterbegin', `<svg class="nav-i" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`);
});

export function renderAvatars() {
  const u = state.me;
  if (!u) return;
  const initials = u.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  $$('.avatar[data-me]').forEach((el) => {
    el.textContent = initials;
    if (!u.gravatar_enabled) return;
    const img = new Image();
    img.alt = '';
    img.onload = () => el.replaceChildren(img);
    img.src = `https://www.gravatar.com/avatar/${md5(u.email.trim().toLowerCase())}?s=200&d=404`;
  });
  $$('[data-me-name]').forEach((el) => { el.textContent = u.name; });
}

/* ---------- Auth-Bildschirme ---------- */
const authEl = $('#auth');
const appEl = $('.app');

const card = (title, lead, body) => `<div class="auth-card"><div class="auth-brand"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="bmg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#17171f"/><stop offset="1" stop-color="#08080b"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#bmg2)"/><rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="#fff" stroke-opacity=".14"/><rect x="7" y="16" width="4.5" height="9" rx="2.25" fill="#fff" fill-opacity=".32"/><rect x="13.75" y="11" width="4.5" height="14" rx="2.25" fill="#fff" fill-opacity=".6"/><rect x="20.5" y="6" width="4.5" height="19" rx="2.25" fill="var(--primary)"/></svg><span data-app-name>${esc(state.appName)}</span></div>
  <h1>${esc(title)}</h1><p class="auth-lead">${lead}</p>${body}<p class="auth-lead" style="margin-top:14px"><a href="#/impressum">Impressum</a> · <a href="#/datenschutz">Datenschutz</a></p></div>`;

function authForm(id, fields, submit, extra = '') {
  return `<form id="${id}" class="auth-form" novalidate>${fields}<p class="auth-error" role="alert" hidden></p><button class="btn auth-submit" type="submit">${esc(submit)}</button></form>${extra}`;
}
const inp = (name, label, type = 'text', ac = '') => `<label class="field">${esc(label)}${type === 'password'
  ? `<span class="password-control"><input name="${name}" type="password" ${ac ? `autocomplete="${ac}"` : ''} required>${passwordToggleButton(label)}</span>`
  : `<input name="${name}" type="${type}" ${ac ? `autocomplete="${ac}"` : ''} required`}</label>`;

function bind(id, fn) {
  const f = $(`#${id}`);
  bindPasswordToggles(f);
  const err = $('.auth-error', f);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', f);
    err.hidden = true;
    btn.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(f)));
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
  f.querySelector('input')?.focus();
}

function showAuth(html) {
  appEl.classList.add('hidden');
  authEl.classList.remove('hidden');
  authEl.innerHTML = html;
}

async function loginScreen(cfg) {
  showAuth(card('Willkommen zurück', 'Melde dich an, um deine Konten und Finanzen zu verwalten.',
    authForm('login', inp('email', 'E-Mail', 'email', 'username') + inp('password', 'Passwort', 'password', 'current-password'), 'Anmelden',
      `<p class="auth-lead" style="margin-top:14px"><a href="#/forgot">Passwort vergessen?</a>${cfg?.registration ? ' · <a href="#/register">Registrieren</a>' : ''}</p>`)));
  bind('login', async (v) => {
    const r = await api.post('/auth/login', { email: v.email, password: v.password });
    if (r.mfa_required) return mfaScreen(r.mfa_token);
    setToken(r.access_token);
    await boot();
  });
}

function mfaScreen(mfaToken) {
  showAuth(card('Zwei-Faktor-Authentifizierung', 'Gib den 6-stelligen Code deiner Authenticator-App oder einen Wiederherstellungscode ein.',
    authForm('mfa', inp('code', 'Code', 'text', 'one-time-code'), 'Bestätigen', '<p class="auth-lead" style="margin-top:14px"><a href="#/login">Abbrechen</a></p>')));
  bind('mfa', async (v) => {
    const r = await api.post('/auth/2fa/login', { mfa_token: mfaToken, code: v.code.trim() });
    setToken(r.access_token);
    await boot();
  });
}

function forgotScreen() {
  showAuth(card('Passwort zurücksetzen', 'Wir senden dir einen Link zum Zurücksetzen, falls ein Konto existiert.',
    authForm('forgot', inp('email', 'E-Mail', 'email', 'username'), 'Link anfordern', '<p class="auth-lead" style="margin-top:14px"><a href="#/login">Zurück zur Anmeldung</a></p>')));
  bind('forgot', async (v) => {
    await api.post('/auth/forgot', { email: v.email });
    $('#forgot').innerHTML = '<p>Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail versendet.</p>';
  });
}

function tokenScreen(kind, token) {
  const reset = kind === 'reset';
  const needName = !reset;
  showAuth(card(reset ? 'Neues Passwort' : 'Einladung annehmen', reset ? 'Wähle ein neues Passwort.' : 'Lege dein Konto an.',
    authForm('tok', (needName ? inp('name', 'Name', 'text', 'name') : '') + inp('password', 'Passwort', 'password', 'new-password'), reset ? 'Passwort speichern' : 'Konto anlegen')));
  bind('tok', async (v) => {
    if (reset) await api.post('/auth/reset', { token, password: v.password });
    else await api.post(`/auth/invite/${encodeURIComponent(token)}`, { name: v.name, password: v.password });
    history.replaceState(null, '', '#/login');
    toast(reset ? 'Passwort geändert – bitte anmelden' : 'Konto angelegt – bitte anmelden');
    route();
  });
}

function registerScreen() {
  showAuth(card('Konto erstellen', `Registriere dich für ${esc(state.appName)}.`,
    authForm('reg', inp('name', 'Name', 'text', 'name') + inp('email', 'E-Mail', 'email', 'username') + inp('password', 'Passwort', 'password', 'new-password'), 'Registrieren', '<p class="auth-lead" style="margin-top:14px"><a href="#/login">Zurück</a></p>')));
  bind('reg', async (v) => {
    await api.post('/auth/register', v);
    history.replaceState(null, '', '#/login');
    toast('Konto angelegt – bitte anmelden');
    route();
  });
}

/* ---------- Router ---------- */
const parseHash = () => {
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { page: path.split('/')[0] || '', params: new URLSearchParams(qs) };
};

// Ein Tab von vor einem Update findet die Dateien seiner Version nicht mehr; einmal neu laden holt den aktuellen Stand.
function reloadIfOutdated(error) {
  if (!/dynamically imported module|importing a module script/i.test(error?.message || '')) return false;
  try {
    if (Date.now() - Number(sessionStorage.getItem('bm-reload') || 0) < 30000) return false;
    sessionStorage.setItem('bm-reload', String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

let gen = 0;
export async function route() {
  const { page, params } = parseHash();
  if (['impressum', 'datenschutz'].includes(page)) {
    if (!state.me) {
      authEl.classList.remove('hidden');
      appEl.classList.add('hidden');
      try {
        const mod = await PAGES[page].load();
        return await mod.render(authEl, params);
      } catch (e) {
        if (!reloadIfOutdated(e)) toast(e.message, true);
        return undefined;
      }
    }
  }
  if (['reset', 'invite'].includes(page)) return tokenScreen(page, params.get('token') || '');
  if (!state.me) {
    if (page === 'forgot') return forgotScreen();
    const cfg = await api.get('/auth/config').catch(() => ({}));
    if (page === 'register' && cfg.registration) return registerScreen();
    return loginScreen(cfg);
  }
  authEl.classList.add('hidden');
  appEl.classList.remove('hidden');
  const allowed = Object.keys(PAGES).filter((k) => !PAGES[k].perm || can(PAGES[k].perm));
  const key = state.mfaSetup ? 'settings' : allowed.includes(page) ? page : allowed[0] || 'settings';
  if (key !== page) history.replaceState(null, '', `#/${key}`);
  $$('.nav').forEach((n) => n.classList.toggle('active', n.dataset.nav === key));
  $$('.nav').forEach((n) => n.classList.toggle('on', n.dataset.nav === key));
  $$('.sidebar').forEach((s) => s.classList.remove('open'));
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  const my = ++gen;
  view.innerHTML = '<p class="muted" style="padding:24px">Wird geladen…</p>';
  try {
    const mod = await PAGES[key].load();
    if (my !== gen) return;
    view.innerHTML = '';
    await mod.render(view, params);
  } catch (e) {
    if (my === gen && !reloadIfOutdated(e)) view.innerHTML = `<div class="card"><p class="auth-error">${esc(e.message)}</p></div>`;
  }
}

async function loadBell() {
  try {
    const n = await api.get('/notifications');
    const count = $('#bell-n');
    count.textContent = n.unread || '';
    count.hidden = !n.unread;
    $('#bell').setAttribute('aria-label', n.unread ? `Benachrichtigungen, ${n.unread} ungelesen` : 'Benachrichtigungen');
    $('#notification-read').hidden = !n.unread;
    $('#notification-items').innerHTML = n.items.length ? n.items.map((item) => `<div class="notification-item ${item.read_at ? '' : 'unread'}">
      <b>${esc(item.title)}</b><small>${esc(item.body || '')}</small><small>${new Date(item.created_at).toLocaleString('de-DE')}</small>
    </div>`).join('') : '<p class="muted">Keine Benachrichtigungen.</p>';
    return true;
  } catch {
    $('#notification-items').innerHTML = '<p class="auth-error">Benachrichtigungen konnten nicht geladen werden.</p>';
    return false;
  }
}

export async function reloadMe() {
  const r = await api.get('/me');
  state.me = r.user;
  state.perms = new Set(r.permissions);
  state.mfaSetup = r.mfa_setup_required;
  state.features = r.features || {};
  setCurrency(r.user.currency);
  applyTheme(r.user.theme || 'system', r.user.accent || 'indigo');
  applyUi(r.user);
  renderAvatars();
  $$('.nav').forEach((n) => {
    const p = PAGES[n.dataset.nav]?.perm;
    n.classList.toggle('hidden', !!p && !can(p));
  });
  $$('[data-admin-only]').forEach((n) => n.classList.toggle('hidden', !can('admin:access')));
  // Abschnittsüberschrift ohne sichtbaren Eintrag ausblenden
  $$('.sidebar .nav-label').forEach((label) => {
    const items = [];
    for (let n = label.nextElementSibling; n && !n.classList.contains('nav-label'); n = n.nextElementSibling) if (n.classList.contains('nav')) items.push(n);
    label.classList.toggle('hidden', items.length > 0 && items.every((n) => n.classList.contains('hidden')));
  });
}

async function boot() {
  try {
    await reloadMe();
  } catch {
    state.me = null;
  }
  if (state.me && (location.hash === '' || /^#\/(login|forgot|register)/.test(location.hash))) history.replaceState(null, '', '#/dashboard');
  await route();
  if (state.me) {
    loadBell();
    if (state.mfaSetup) toast('Zwei-Faktor-Authentifizierung ist vorgeschrieben – bitte einrichten.');
    else if (!state.me.ui_choice_seen) chooseDesign();
  }
}

// Einmalige Auswahl des Designs nach dem Login (Wunsch des Auftraggebers vom 2026-11-11). Ein Klick zeigt die Wahl sofort;
// „Übernehmen“ speichert sie, „Später“ behält das bisherige Design. In beiden Fällen erscheint der Dialog nicht wieder.
let choosing = false;
async function chooseDesign() {
  if (choosing) return;
  choosing = true;
  let pick = state.me.ui_version === 'v2' ? 'v2' : 'v1';
  const option = (value, title, text) => `<button type="button" role="radio" aria-checked="${pick === value}" class="ui-version ${pick === value ? 'on' : ''}" data-version="${value}">
    <span class="ui-pv ${value}" aria-hidden="true"><i></i><i></i><i></i><i></i></span><b>${title}</b><small class="muted">${text}</small></button>`;
  const done = openForm({
    title: 'Wähle dein Design',
    submit: 'Übernehmen',
    cancel: 'Später',
    wide: true,
    fields: [{
      type: 'html',
      html: `<div><p class="muted" style="margin:0 0 14px">Es gibt jetzt zwei Designs. Klick eins an, um es gleich zu sehen. Ändern kannst du das jederzeit unter Einstellungen → Darstellung.</p>
        <div class="ui-versions" role="radiogroup" aria-label="Design">
          ${option('v1', 'V1 · Klassisch', 'Ruhige, flache Flächen wie bisher')}
          ${option('v2', 'V2 · Glass <span class="tag primary">Neu</span>', 'Glas-Panels über einem Hintergrund, eigenes Bild möglich, Dashboard frei anpassbar')}
        </div></div>`,
    }],
    onSubmit: async () => true,
  });
  const modal = $('#modals .modal:last-child');
  modal.classList.add('design-choice');
  modal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-version]');
    if (!b) return;
    pick = b.dataset.version;
    $$('[data-version]', modal).forEach((n) => { n.classList.toggle('on', n === b); n.setAttribute('aria-checked', String(n === b)); });
    applyUi({ ...state.me, ui_version: pick });
  });
  const accepted = await done;
  try {
    await api.patch('/me', accepted ? { ui_version: pick, ui_choice_seen: true } : { ui_choice_seen: true });
    await reloadMe();
    if (accepted && pick === 'v2') toast('V2 aktiv – Hintergrund und Dashboard passt du unter Einstellungen → Darstellung an.');
  } catch (error) {
    applyUi(state.me);
    toast(error.message, true);
  } finally {
    choosing = false;
  }
}

async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignorieren */ }
  setToken(null);
  state.me = null;
  applyUi(null);
  history.replaceState(null, '', '#/login');
  route();
}

onLogout(() => { state.me = null; applyUi(null); route(); });
document.addEventListener('click', async (e) => {
  const popup = $('#notification-popover');
  if (e.target.closest('#bell')) {
    e.preventDefault();
    popup.hidden = !popup.hidden;
    $('#bell').setAttribute('aria-expanded', String(!popup.hidden));
    if (!popup.hidden) await loadBell();
    return;
  }
  if (!e.target.closest('.notification-wrap')) {
    popup.hidden = true;
    $('#bell').setAttribute('aria-expanded', 'false');
  }
  if (e.target.closest('#notification-read')) {
    try {
      await api.post('/notifications/read');
      await loadBell();
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  if (e.target.closest('[data-action=logout]')) logout();
  if (e.target.closest('#menuBtn')) $('#menuBtn').setAttribute('aria-expanded', String($('.sidebar').classList.toggle('open')));
  // Auf dem Handy schließt ein Tippen neben das Menü es wieder
  else if ($('.sidebar').classList.contains('open') && !e.target.closest('.sidebar')) {
    $('.sidebar').classList.remove('open');
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  }
  const m = e.target.closest('.modal [data-close]');
  if (m) m.closest('.modal').classList.remove('open');
  const tab = e.target.closest('.tabs [data-tab]');
  if (tab) {
    const root = tab.closest('.tabs').parentElement;
    $$('.tabs [data-tab]', root).forEach((t) => t.classList.toggle('on', t === tab));
    $$('.tab-panel', root).forEach((p) => p.classList.toggle('on', p.dataset.panel === tab.dataset.tab));
    tab.dispatchEvent(new CustomEvent('tabchange', { bubbles: true }));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#notification-popover').hidden) {
    $('#notification-popover').hidden = true;
    $('#bell').setAttribute('aria-expanded', 'false');
  }
});
window.addEventListener('hashchange', route);

// Tabellen auf dem Handy als Karten (layout.css, .table.stackable): jede Zelle bekommt ihre Spaltenüberschrift.
// Ein Beobachter erfasst auch Tabellen, die Seiten nachträglich zeichnen; ausgenommen sind schmale Rechentabellen.
function labelTables() {
  $$('table.table').forEach((table) => {
    if (table.closest('.forecast-week, .no-stack')) return;
    const heads = [];
    $$('thead tr:last-child > th', table).forEach((th) => { for (let i = 0; i < (th.colSpan || 1); i++) heads.push(th.textContent.trim()); });
    if (!heads.length) return;
    table.classList.add('stackable');
    $$('tbody > tr', table).forEach((tr) => {
      let col = 0;
      [...tr.children].forEach((td) => {
        if (!td.hasAttribute('data-label')) td.setAttribute('data-label', td.colSpan > 1 ? '' : heads[col] || '');
        col += td.colSpan || 1;
      });
    });
  });
}
let labelQueued = false;
new MutationObserver(() => {
  if (labelQueued) return;
  labelQueued = true;
  requestAnimationFrame(() => { labelQueued = false; labelTables(); });
}).observe(document.body, { childList: true, subtree: true });

(async () => {
  const cfg = await api.get('/auth/config').catch(() => null);
  if (cfg) applyAppName(cfg.app_name);
  if (await refresh()) await boot();
  else { state.me = null; await route(); }
  if (!hasToken()) $('.auth-loading')?.remove();
})();
