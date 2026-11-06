import { api, refresh, setToken, onLogout, hasToken } from './api.js';
import { $, $$, esc, toast, setCurrency, bindPasswordToggles, passwordToggleButton } from './ui.js';
import { md5 } from './md5.js';

export const state = { me: null, perms: new Set(), mfaSetup: false, appName: 'Budget Manager' };
export function applyAppName(name) {
  state.appName = (name || '').trim() || 'Budget Manager';
  document.title = state.appName;
  document.querySelectorAll('[data-app-name]').forEach((n) => { n.textContent = state.appName; });
}
export const can = (p) => state.perms.has(p);

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
  'assets-vehicles': { perm: 'vehicle:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'vehicles') })) },
  'assets-properties': { perm: 'property:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'properties') })) },
  'assets-people': { perm: 'person:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'people') })) },
  'assets-keys': { perm: 'key:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'keys') })) },
  'assets-manage': { perm: 'key:read', load: () => import('./pages/assets.js').then((m) => ({ render: (view, params) => m.render(view, params, 'manage') })) },
  assets: { perm: 'key:read', load: () => import('./pages/assets.js') },
  help: { perm: null, load: () => import('./pages/help.js') },
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
  setCurrency(r.user.currency);
  applyTheme(r.user.theme || 'system', r.user.accent || 'indigo');
  renderAvatars();
  $$('.nav').forEach((n) => {
    const p = PAGES[n.dataset.nav]?.perm;
    n.classList.toggle('hidden', !!p && !can(p));
  });
  $$('[data-admin-only]').forEach((n) => n.classList.toggle('hidden', !can('admin:access')));
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
  }
}

async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignorieren */ }
  setToken(null);
  state.me = null;
  history.replaceState(null, '', '#/login');
  route();
}

onLogout(() => { state.me = null; route(); });
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
  if (e.target.closest('#menuBtn')) $('.sidebar').classList.toggle('open');
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

(async () => {
  const cfg = await api.get('/auth/config').catch(() => null);
  if (cfg) applyAppName(cfg.app_name);
  if (await refresh()) await boot();
  else { state.me = null; await route(); }
  if (!hasToken()) $('.auth-loading')?.remove();
})();
