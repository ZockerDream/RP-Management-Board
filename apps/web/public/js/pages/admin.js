import { api } from '../api.js';
import { $, esc, eur, fdate, fdatetime, empty, openForm, confirmBox, toast, showSecret, debounce, tag } from '../ui.js';
import { areaChart } from '../charts.js';
import { can, applyAppName } from '../app.js';
import { ticketHtml, bindTickets } from './ticket-view.js';
import { NOTE_TAG_COLORS, noteTagHtml } from './common.js';

const STATUS = { active: ['ok', 'Aktiv'], locked: ['warn', 'Gesperrt'], disabled: ['bad', 'Deaktiviert'], invited: ['', 'Eingeladen'] };
const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtUp = (s) => `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
const errBox = (x) => `<div class="card"><p class="auth-error">${esc(x.message)}</p></div>`;
const btn = (attr, label) => `<button class="btn ghost sm" ${attr}>${label}</button>`;

const SECTIONS = {
  users: { title: 'User-Management', desc: 'Benutzer, Rollen, Gruppen und Organisationen', tabs: ['users', 'roles', 'groups', 'teams'] },
  server: { title: 'Server-Management', desc: 'Übersicht, Sicherheit, System, Integrationen, Notiz-Tags und Audit-Log', tabs: ['overview', 'settings', 'system', 'integr', 'notetags', 'audit'] },
  tickets: { title: 'Tickets', desc: 'Gemeldete Fehler und Anfragen', tabs: ['tickets'] },
};

export async function render(view, params, section) {
  const meta = SECTIONS[section] || SECTIONS.users;
  const ALL = [['overview', 'Übersicht', 'admin:access'], ['tickets', 'Tickets', 'admin:access'], ['users', 'Benutzer', 'user:read'], ['roles', 'Rollen & Rechte', 'role:read'], ['groups', 'Gruppen', 'group:read'], ['teams', 'Organisationen', 'team:read'],
    ['settings', 'Sicherheit & Einstellungen', 'settings:read'], ['system', 'System & Backups', 'settings:read'], ['integr', 'Integrationen', 'settings:read'], ['notetags', 'Notiz-Tags', 'settings:read'], ['audit', 'Audit-Log', 'audit:read']].filter((t) => meta.tabs.includes(t[0]) && can(t[2]));
  const D = { roles: [], groups: [], users: [] };
  view.innerHTML = `<div class="page-head"><div><h1>${meta.title}</h1><p>${meta.desc}</p></div><div class="actions" id="ad-actions"></div></div>
    <div><div class="tabs" ${ALL.length < 2 ? 'hidden' : ''}>${ALL.map(([k, l], i) => `<button data-tab="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>${ALL.map(([k], i) => `<div class="tab-panel ${i ? '' : 'on'}" data-panel="${k}"></div>`).join('')}</div>`;
  const cur = () => $('.tabs .on', view).dataset.tab;

  const loadRoles = async () => { const r = await api.get('/admin/roles'); D.roles = r.roles; D.catalog = r.catalog; };
  const loadGroups = async () => { D.groups = await api.get('/admin/groups'); };

  /* ----- Formulare ----- */
  const noteTagForm = (t) => openForm({
    title: t ? 'Tag bearbeiten' : 'Tag anlegen',
    fields: [
      { name: 'name', label: 'Name', value: t?.name, required: true, maxlength: 30, placeholder: 'z. B. WIP' },
      { name: 'color', label: 'Farbe', type: 'select', value: t?.color || 'neutral', options: Object.entries(NOTE_TAG_COLORS).map(([v, [, l]]) => ({ v, l })) },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), color: v.color };
      if (t) await api.patch(`/admin/note-tags/${t.id}`, body);
      else await api.post('/admin/note-tags', body);
      toast('Tag gespeichert');
    },
  });
  async function userForm(u) {
    await Promise.all([loadRoles(), can('group:read') ? loadGroups() : 0]);
    const fields = [
      { name: 'name', label: 'Name', value: u?.name, required: true },
      { name: 'email', label: 'E-Mail', type: 'email', value: u?.email, required: true },
      ...(u ? [{ name: 'status', label: 'Status', type: 'select', options: ['active', 'locked', 'disabled'].map((v) => ({ v, l: STATUS[v][1] })), value: u.status }]
        : [{ name: 'mode', label: 'Anlage', type: 'select', options: [{ v: 'invite', l: 'Einladung per E-Mail/Link' }, { v: 'password', l: 'Passwort direkt setzen' }], value: 'invite' },
          { name: 'password', label: 'Passwort (nur bei direkter Anlage)', type: 'password', autocomplete: 'new-password' }]),
      ...(u ? [{ name: 'password', label: 'Neues Passwort (optional)', type: 'password', autocomplete: 'new-password' }] : []),
      { name: 'role_ids', label: 'Rollen', type: 'multi', options: D.roles.map((r) => ({ v: r.id, l: r.name })), value: u ? D.roles.filter((r) => u.roles.includes(r.name)).map((r) => r.id) : [] },
      ...(D.groups.length ? [{ name: 'group_ids', label: 'Gruppen', type: 'multi', options: D.groups.map((g) => ({ v: g.id, l: g.name })), value: u ? D.groups.filter((g) => u.groups.includes(g.name)).map((g) => g.id) : [] }] : []),
      { name: 'expires_at', label: 'Zugang gilt bis einschließlich (optional)', type: 'date', value: u?.expires_at?.slice(0, 10) },
      { name: 'max_budgets', label: 'Max. Konten (optional)', type: 'number', min: 0, value: u?.max_budgets ?? '' },
    ];
    return openForm({
      title: u ? 'Benutzer bearbeiten' : 'Benutzer anlegen', fields,
      onSubmit: async (v) => {
        const body = { name: v.name.trim(), email: v.email.trim(), role_ids: v.role_ids, expires_at: v.expires_at || null, max_budgets: v.max_budgets === '' ? null : Number(v.max_budgets) };
        if (v.group_ids) body.group_ids = v.group_ids;
        if (u) {
          body.status = v.status;
          if (v.password) body.password = v.password;
          await api.patch(`/admin/users/${u.id}`, body);
        } else if (v.mode === 'invite') {
          const r = await api.post('/admin/users', { ...body, invite: true });
          if (r.link && !r.mail_sent) await showSecret('Einladungslink', 'E-Mail-Versand ist nicht konfiguriert. Gib diesen Link (7 Tage gültig) manuell weiter:', r.link);
        } else await api.post('/admin/users', { ...body, password: v.password });
        toast('Benutzer gespeichert');
      },
    });
  }

  async function roleForm(r) {
    await loadRoles();
    const has = new Set(r?.permissions || []);
    const matrix = `<table class="table"><thead><tr><th>Bereich</th><th>Rechte</th></tr></thead><tbody>${D.catalog.map((c) => `<tr><td>${esc(c.label)}</td><td>${c.actions.map((a) => `<label class="row start" style="display:inline-flex;margin-right:12px;font-weight:400;color:var(--text)"><input type="checkbox" name="perm" value="${c.resource}:${a}" ${has.has(`${c.resource}:${a}`) ? 'checked' : ''}> ${a}</label>`).join('')}</td></tr>`).join('')}</tbody></table>`;
    const fields = [
      { name: 'name', label: 'Name', value: r?.name, required: true },
      { name: 'data_scope', label: 'Datenumfang', type: 'select', options: [{ v: 'all', l: 'Alle Daten' }, { v: 'groups', l: 'Eigene Gruppen' }, { v: 'own', l: 'Nur eigene' }], value: r?.data_scope || 'all' },
      { name: 'description', label: 'Beschreibung', value: r?.description, full: true },
      { name: 'max_budgets', label: 'Max. Konten (optional)', type: 'number', min: 0, value: r?.max_budgets ?? '' },
      { name: 'is_default', label: 'Standardrolle für neue Benutzer', type: 'checkbox', value: r?.is_default },
      { type: 'html', html: matrix },
    ];
    return openForm({
      title: r ? `Rolle bearbeiten: ${r.name}` : 'Rolle anlegen', fields, wide: true,
      onSubmit: async (v, m) => {
        const body = { name: v.name.trim(), description: v.description, data_scope: v.data_scope, max_budgets: v.max_budgets === '' ? null : Number(v.max_budgets), is_default: v.is_default, permissions: [...m.querySelectorAll('input[name=perm]:checked')].map((i) => i.value) };
        if (r) await api.put(`/admin/roles/${r.id}`, body); else await api.post('/admin/roles', body);
      },
    });
  }

  async function groupForm(g) {
    await loadRoles();
    D.users = await api.get('/admin/users');
    return openForm({
      title: g ? 'Gruppe bearbeiten' : 'Gruppe anlegen', fields: [
        { name: 'name', label: 'Name', value: g?.name, required: true },
        { name: 'auto_domain', label: 'Auto-Zuweisung per E-Mail-Domain', value: g?.auto_domain, placeholder: 'firma.de' },
        { name: 'description', label: 'Beschreibung', value: g?.description, full: true },
        { name: 'leader_can_manage', label: 'Gruppenleiter dürfen Mitglieder verwalten', type: 'checkbox', value: g?.leader_can_manage },
        { name: 'role_ids', label: 'Rollen der Gruppe', type: 'multi', options: D.roles.map((r) => ({ v: r.id, l: r.name })), value: g?.role_ids || [] },
        { name: 'member_ids', label: 'Mitglieder', type: 'multi', options: D.users.map((u) => ({ v: u.id, l: u.name })), value: (g?.members || []).map((m) => m.id) },
      ],
      onSubmit: async (v) => {
        const body = { name: v.name.trim(), description: v.description, auto_domain: v.auto_domain || null, leader_can_manage: v.leader_can_manage, role_ids: v.role_ids, member_ids: v.member_ids };
        if (g) await api.put(`/admin/groups/${g.id}`, body); else await api.post('/admin/groups', body);
      },
    });
  }

  /* ----- Panels ----- */
  const P = {
    async overview(el) {
      const o = await api.get('/admin/overview');
      const s = o.stats;
      el.innerHTML = `<div class="grid cols-4">${[['Benutzer', `${s.active_users} / ${s.users}`, 'aktiv / gesamt'], ['Mit 2FA', s.users_2fa, `von ${s.users}`], ['Logins (24 h)', s.logins_24h, `${s.failed_24h} fehlgeschlagen`], ['Aktive Sitzungen', s.sessions, '']].map(([l, v, d]) => `<div class="card kpi"><span class="label">${l}</span><span class="value">${v}</span><span class="delta muted">${d}</span></div>`).join('')}</div>
      <div class="grid cols-4">${[['Organisationen', s.teams], ['Konten', s.budgets], ['Buchungen', s.transactions]].map(([l, v]) => `<div class="card kpi"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('')}</div>
      <div class="grid cols-21"><div class="card"><div class="card-head"><h2>Aktivität (14 Tage)</h2></div><div class="chart" id="ad-act"></div></div>
      <div class="card"><div class="card-head"><h2>Rollenverteilung</h2></div>${o.roles.map((r) => `<div class="list-item"><div class="grow">${esc(r.name)}</div><b>${r.n}</b></div>`).join('')}</div></div>
      <div class="card"><div class="card-head"><h2>Letzte Ereignisse</h2></div>${o.recent.length ? o.recent.map((r) => `<div class="list-item"><div class="grow"><b>${esc(r.action)}</b><small>${esc(r.user_name || 'System')} · ${esc(r.entity || '')}</small></div><small>${fdatetime(r.created_at)}</small></div>`).join('') : empty('Keine Ereignisse.')}</div>`;
      areaChart($('#ad-act', el), { labels: o.activity.map((a) => a.day.slice(8)), series: [{ name: 'Ereignisse', color: 'var(--c1)', data: o.activity.map((a) => a.n) }], format: (v) => String(Math.round(v)) });
    },
    async users(el) {
      const q = el._q || '';
      D.users = await api.get(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      el.innerHTML = `<div class="card"><div class="toolbar"><input id="u-q" placeholder="Name oder E-Mail suchen…" value="${esc(q)}" style="max-width:280px"></div>${D.users.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Rollen</th><th>Gruppen</th><th>2FA</th><th>Letzter Login</th><th>Status</th><th></th></tr></thead><tbody>${D.users.map((u) => `<tr>
        <td><b>${esc(u.name)}</b><br><small class="muted">${esc(u.email)}</small></td><td>${u.roles.map((r) => tag('', r)).join(' ')}</td><td>${esc(u.groups.join(', ') || '–')}</td><td>${u.totp_enabled ? '✔' : '–'}</td><td>${fdatetime(u.last_login_at)}</td>
        <td><span class="tag ${STATUS[u.status]?.[0] || ''}">${STATUS[u.status]?.[1] || esc(u.status)}</span></td>
        <td style="white-space:nowrap">${can('user:update') ? `${btn(`data-uedit="${u.id}"`, 'Bearbeiten')} ${btn(`data-u2fa="${u.id}"`, '2FA zurücksetzen')} ${btn(`data-usess="${u.id}"`, 'Sitzungen beenden')}` : ''}${can('user:delete') ? ` ${btn(`data-udel="${u.id}"`, 'Löschen')}` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Keine Benutzer gefunden.')}</div>`;
      const i = $('#u-q', el);
      i.addEventListener('input', debounce(async (e) => { el._q = e.target.value.trim(); await P.users(el); const n = $('#u-q', el); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }));
    },
    async tickets(el) {
      const { items } = await api.get('/admin/bug-reports');
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Gemeldete Tickets</h2></div>${items.length ? items.map((ticket) => ticketHtml(ticket, true)).join('') : empty('Noch keine Tickets gemeldet.')}</div>`;
      if (!el._ticketsBound) {
        el._ticketsBound = true;
        bindTickets(el, '/admin/bug-reports', () => P.tickets(el));
      }
    },
    async roles(el) {
      await loadRoles();
      el.innerHTML = `<div class="grid cols-2">${D.roles.map((r) => `<div class="card stack"><div class="row"><b>${esc(r.name)}</b>${r.is_system ? tag('', 'System') : ''}${r.is_default ? tag('ok', 'Standard') : ''}</div>
        <small class="muted">${esc(r.description || '')}</small><div class="row"><span class="muted">${r.users} Benutzer · ${r.permissions.length + (r.name === 'Admin' ? 0 : 0)} Rechte · Datenumfang: ${r.data_scope}</span></div>
        <div class="chips">${r.permissions.slice(0, 8).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}${r.permissions.length > 8 ? `<span class="chip">+${r.permissions.length - 8}</span>` : ''}</div>
        <div class="row">${can('role:update') && !r.is_system ? btn(`data-redit="${r.id}"`, 'Bearbeiten') : ''}${can('role:delete') && !r.is_system ? btn(`data-rdel="${r.id}"`, 'Löschen') : ''}</div></div>`).join('')}</div>`;
    },
    async groups(el) {
      await loadGroups();
      el.innerHTML = `<div class="card">${D.groups.length ? `<table class="table"><thead><tr><th>Gruppe</th><th>Mitglieder</th><th>Auto-Domain</th><th></th></tr></thead><tbody>${D.groups.map((g) => `<tr><td><b>${esc(g.name)}</b><br><small class="muted">${esc(g.description || '')}</small></td><td>${esc(g.members.map((m) => m.name).join(', ') || '–')}</td><td>${esc(g.auto_domain || '–')}</td>
        <td style="white-space:nowrap">${can('group:update') ? btn(`data-gedit="${g.id}"`, 'Bearbeiten') : ''}${can('group:delete') ? ` ${btn(`data-gdel="${g.id}"`, 'Löschen')}` : ''}</td></tr>`).join('')}</tbody></table>` : empty('Keine Gruppen.')}</div>`;
    },
    async teams(el) {
      const t = await api.get('/admin/teams');
      el.innerHTML = `<div class="card">${t.length ? `<table class="table"><thead><tr><th>Organisation</th><th>Erstellt von</th><th>Mitglieder</th><th>Konten</th><th>Status</th></tr></thead><tbody>${t.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.owner)}</td><td>${x.members}</td><td>${x.budgets}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody></table>` : empty('Keine Organisationen.')}</div>`;
    },
    async settings(el) {
      const { values: v, env } = await api.get('/admin/settings');
      const num = (k, l, min = 0) => `<label class="field">${l}<input type="number" min="${min}" name="${k}" value="${esc(v[k])}"></label>`;
      const sw = (k, l, h = '') => `<label class="setting"><span>${l}<small>${h}</small></span><input type="checkbox" name="${k}" ${v[k] ? 'checked' : ''}></label>`;
      const ro = can('settings:update') ? '' : 'disabled';
      el.innerHTML = `<form id="s-form" class="card"><fieldset ${ro} style="border:0;padding:0;margin:0"><div class="card-head"><h2>Sicherheit</h2></div><div class="form">
        ${num('security.password_min_length', 'Minimale Passwortlänge', 8)}${num('security.max_failed_logins', 'Fehlversuche bis Sperre', 1)}${num('security.lockout_minutes', 'Sperrdauer (Minuten)', 1)}${num('security.session_days', 'Sitzungsdauer (Tage)', 1)}
        <label class="field full">Admin-IP-Allowlist (Komma-getrennte IPs/CIDR, leer = alle)<input name="security.admin_ip_allowlist" value="${esc(v['security.admin_ip_allowlist'])}"></label></div>
        ${sw('security.force_2fa', '2FA für alle erzwingen', 'Benutzer ohne 2FA müssen sie beim nächsten Login einrichten')}
        <div class="card-head" style="margin-top:20px"><h2>Allgemein</h2></div>
        <div class="form"><label class="field">App-Name<input name="general.app_name" value="${esc(v['general.app_name'])}"></label><label class="field">Standard-Währung<input name="general.default_currency" maxlength="3" value="${esc(v['general.default_currency'])}"></label>
        <label class="field full">Wartungsmeldung<input name="general.maintenance_message" value="${esc(v['general.maintenance_message'])}"></label></div>
        ${sw('general.registration', 'Selbstregistrierung erlauben')}${sw('general.maintenance', 'Wartungsmodus', 'Nur Administratoren können sich anmelden')}${sw('mail.enabled', 'E-Mail-Versand aktiv')}
        <div class="card-head" style="margin-top:20px"><h2>Aufbewahrung (Tage)</h2></div><div class="form">${num('retention.audit_days', 'Audit-Log', 1)}${num('retention.notifications_days', 'Benachrichtigungen', 1)}${num('retention.sessions_days', 'Abgelaufene Sitzungen', 1)}${num('retention.trash_days', 'Papierkorb', 1)}</div>
        ${ro ? '' : '<div class="modal-foot"><button class="btn ghost" type="button" id="s-mail">SMTP testen</button><button class="btn">Speichern</button></div>'}</fieldset></form>
        <div class="card"><div class="card-head"><h2>Umgebung (.env, schreibgeschützt)</h2></div><div class="stack">
        <div class="row between"><span class="muted">App-URL</span><code>${esc(env.app_url)}</code></div><div class="row between"><span class="muted">SMTP</span><span>${env.smtp_configured ? `konfiguriert (${esc(env.smtp_host)})` : 'nicht konfiguriert'}</span></div>
        <div class="row between"><span class="muted">HIBP-Passwortprüfung</span><span>${env.hibp ? 'an' : 'aus'}</span></div><div class="row between"><span class="muted">Backup-Verschlüsselung</span><span>${env.backup_encrypt ? 'an' : 'aus'}</span></div>
        <div class="row between"><span class="muted">Backup-Aufbewahrung</span><span>${env.backup_retention_days} Tage</span></div>
        <div class="row between"><span class="muted">Reverse-Proxy vertrauen (TRUST_PROXY)</span><span>${env.trust_proxy ? 'an' : 'aus'}</span></div>
        ${env.proxy_not_trusted ? '<div class="note">Diese Anfrage kam über einen Proxy, aber TRUST_PROXY ist nicht gesetzt. Dann teilen sich alle Benutzer die IP des Proxys, auch beim Login-Limit und im Audit-Log. Bitte die Proxy-IP in der .env eintragen.</div>' : ''}</div></div>`;
      $('#s-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {};
        for (const i of e.target.querySelectorAll('input[name]')) body[i.name] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value;
        try { await api.put('/admin/settings', body); if (body['general.app_name'] !== undefined) applyAppName(body['general.app_name']); toast('Einstellungen gespeichert'); } catch (x) { toast(x.message, true); }
      });
      $('#s-mail', el)?.addEventListener('click', async () => { try { await api.post('/admin/settings/test-mail'); toast('SMTP-Verbindung erfolgreich'); } catch (x) { toast(x.message, true); } });
    },
    async system(el) {
      const [s, b] = await Promise.all([api.get('/admin/system'), can('backup:read') ? api.get('/admin/backups') : []]);
      el.innerHTML = `<div class="grid cols-4">${[['Version', s.version], ['Laufzeit', fmtUp(s.uptime_s)], ['Datenbank', fmtBytes(s.db_size)], ['Speicher API', `${s.memory_mb} MB`]].map(([l, v]) => `<div class="card kpi"><span class="label">${l}</span><span class="value" style="font-size:20px">${esc(v)}</span></div>`).join('')}</div>
      <div class="card"><div class="card-head"><h2>Geplante Jobs</h2><small>${esc(s.db_version)} · Node ${esc(s.node)}</small></div>${s.jobs.length ? `<table class="table"><thead><tr><th>Job</th><th>Letzter Lauf</th><th>Status</th><th>Meldung</th></tr></thead><tbody>${s.jobs.map((j) => `<tr><td>${esc(j.name)}</td><td>${fdatetime(j.last_run_at)}</td><td><span class="tag ${j.last_status === 'ok' ? 'ok' : 'bad'}">${esc(j.last_status || '–')}</span></td><td class="muted">${esc(j.last_message || '')}</td></tr>`).join('')}</tbody></table>` : empty('Jobs haben noch nicht gelaufen.')}</div>
      ${can('backup:read') ? `<div class="card"><div class="card-head"><h2>Backups</h2>${can('backup:create') ? '<button class="btn" id="b-new">Backup jetzt erstellen</button>' : ''}</div>${b.length ? `<table class="table"><thead><tr><th>Datei</th><th>Größe</th><th>Status</th><th>Erstellt</th><th></th></tr></thead><tbody>${b.map((x) => `<tr><td>${esc(x.filename)}</td><td>${x.size ? fmtBytes(Number(x.size)) : '–'}</td><td><span class="tag ${x.status === 'ok' ? 'ok' : 'bad'}" title="${esc(x.error || '')}">${esc(x.status)}</span></td><td>${fdatetime(x.created_at)}</td><td style="white-space:nowrap">${x.status === 'ok' ? btn(`data-bdl="${x.id}" data-bn="${esc(x.filename)}"`, 'Download') : ''}${can('backup:delete') ? ` ${btn(`data-bdel="${x.id}"`, 'Löschen')}` : ''}</td></tr>`).join('')}</tbody></table>` : empty('Noch keine Backups. Tägliche Backups laufen automatisch.')}</div>` : ''}`;
    },
    async integr(el) {
      const [w, k] = await Promise.all([api.get('/admin/webhooks'), can('apikey:read') ? api.get('/admin/api-keys') : []]);
      el.innerHTML = `      <div class="card"><div class="card-head"><h2>Webhooks</h2>${can('settings:update') ? '<button class="btn ghost sm" id="w-new">Webhook hinzufügen</button>' : ''}</div>${w.length ? w.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.url)}</b><small>${esc(x.events.join(', '))}</small></div>${can('settings:update') ? btn(`data-wdel="${x.id}"`, 'Löschen') : ''}</div>`).join('') : empty('Keine Webhooks. Sie melden Konto-Limits (80 %, überschritten).')}</div>
      <div class="card"><div class="card-head"><h2>API-Schlüssel aller Benutzer</h2></div>${k.length ? `<table class="table"><thead><tr><th>Name</th><th>Besitzer</th><th>Präfix</th><th>Scope</th><th>Zuletzt genutzt</th><th></th></tr></thead><tbody>${k.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.owner)}</td><td><code>${esc(x.prefix)}…</code></td><td>${esc(x.scope)}</td><td>${fdatetime(x.last_used_at)}</td><td>${can('apikey:delete') ? btn(`data-kdel="${x.id}"`, 'Widerrufen') : ''}</td></tr>`).join('')}</tbody></table>` : empty('Keine aktiven API-Schlüssel.')}</div>`;
    },
    async notetags(el) {
      D.noteTags = await api.get('/admin/note-tags');
      const edit = can('settings:update');
      const last = D.noteTags.length - 1;
      el.innerHTML = `<div class="card"><p class="muted" style="margin-top:0">Tags markieren Notizen im Notizblock. Jeder, der eine Notiz bearbeiten darf, kann beliebig viele davon setzen; im Notizblock lässt sich danach filtern. Ausgeblendet wird nichts.</p>${D.noteTags.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Tag</th><th>Farbe</th><th>Notizen</th><th></th></tr></thead><tbody>${D.noteTags.map((t, i) => `<tr><td>${noteTagHtml(t)}</td><td>${esc(NOTE_TAG_COLORS[t.color]?.[1] || t.color)}</td><td>${t.notes}</td>
        <td style="white-space:nowrap">${edit ? `${btn(`data-tup="${t.id}" aria-label="${esc(t.name)} nach oben" ${i ? '' : 'disabled style="visibility:hidden"'}`, '↑')} ${btn(`data-tdown="${t.id}" aria-label="${esc(t.name)} nach unten" ${i < last ? '' : 'disabled style="visibility:hidden"'}`, '↓')} ${btn(`data-tedit="${t.id}"`, 'Bearbeiten')} ${btn(`data-tdel="${t.id}"`, 'Löschen')}` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Tags.')}</div>`;
    },
    async audit(el) {
      const q = el._q || '';
      const rows = await api.get(`/admin/audit?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      el.innerHTML = `<div class="card"><div class="toolbar"><input id="a-q" placeholder="Suchen…" value="${esc(q)}" style="max-width:260px">${can('audit:export') ? '<button class="btn ghost sm" id="a-csv">CSV-Export</button>' : ''}</div>${rows.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Zeit</th><th>Benutzer</th><th>Aktion</th><th>Objekt</th><th>IP</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fdatetime(r.created_at)}</td><td>${esc(r.user_name || 'System')}</td><td><code>${esc(r.action)}</code></td><td>${esc(r.entity || '')}</td><td>${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('Keine Einträge.')}</div>`;
      $('#a-q', el).addEventListener('input', debounce(async (e) => { el._q = e.target.value.trim(); await P.audit(el); const n = $('#a-q', el); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 400));
    },
  };

  const ADD = { users: ['user:create', 'Benutzer anlegen'], roles: ['role:create', 'Rolle anlegen'], groups: ['group:create', 'Gruppe anlegen'], notetags: ['settings:update', 'Tag anlegen'] };
  async function show(k = cur()) {
    if (!view.isConnected) return;
    const el = $(`.tab-panel[data-panel="${k}"]`, view);
    const a = ADD[k];
    $('#ad-actions').innerHTML = (a && can(a[0]) ? `<button class="btn" id="ad-new">${a[1]}</button>` : '') + (k === 'users' && can('user:export') ? '<button class="btn ghost" id="u-csv">CSV-Export</button>' : '');
    try { await P[k](el); } catch (x) { el.innerHTML = errBox(x); }
  }

  view.addEventListener('tabchange', () => show());
  view.addEventListener('click', async (e) => {
    const g = (s) => e.target.closest(s);
    const k = cur();
    const ds = (a) => g(`[data-${a}]`)?.dataset[a];
    try {
      let changed = false;
      if (g('#ad-new')) changed = await ({ users: () => userForm(), roles: () => roleForm(), groups: () => groupForm(), notetags: () => noteTagForm() }[k]());
      else if (ds('uedit')) changed = await userForm(D.users.find((u) => u.id === ds('uedit')));
      else if (ds('u2fa') && (await confirmBox('2FA zurücksetzen', 'Die Zwei-Faktor-Authentifizierung des Benutzers wird deaktiviert.', 'Zurücksetzen'))) { await api.post(`/admin/users/${ds('u2fa')}/reset-2fa`); changed = true; toast('2FA zurückgesetzt'); }
      else if (ds('usess') && (await confirmBox('Sitzungen beenden', 'Alle Sitzungen des Benutzers werden beendet.', 'Beenden'))) { await api.post(`/admin/users/${ds('usess')}/revoke-sessions`); toast('Sitzungen beendet'); }
      else if (ds('udel') && (await confirmBox('Benutzer löschen', 'Der Benutzer wird deaktiviert und seine Zugänge werden entfernt.'))) { await api.del(`/admin/users/${ds('udel')}`); changed = true; }
      else if (g('#u-csv')) await api.download('/admin/users/export.csv', 'benutzer.csv');
      else if (ds('redit')) changed = await roleForm(D.roles.find((r) => r.id === ds('redit')));
      else if (ds('rdel') && (await confirmBox('Rolle löschen', 'Die Rolle wird von allen Benutzern entfernt.'))) { await api.del(`/admin/roles/${ds('rdel')}`); changed = true; }
      else if (ds('gedit')) changed = await groupForm(D.groups.find((x) => x.id === ds('gedit')));
      else if (ds('gdel') && (await confirmBox('Gruppe löschen', 'Gruppe wirklich löschen?'))) { await api.del(`/admin/groups/${ds('gdel')}`); changed = true; }
      else if (ds('tedit')) changed = await noteTagForm(D.noteTags.find((t) => t.id === ds('tedit')));
      else if (ds('tup') || ds('tdown')) { await api.post(`/admin/note-tags/${ds('tup') || ds('tdown')}/move`, { direction: ds('tup') ? 'up' : 'down' }); changed = true; }
      else if (ds('tdel')) {
        const t = D.noteTags.find((x) => x.id === ds('tdel'));
        if (await confirmBox('Tag löschen', t?.notes ? `„${t.name}“ wird von ${t.notes} ${t.notes === 1 ? 'Notiz' : 'Notizen'} entfernt. Die Notizen selbst bleiben.` : `„${t?.name}“ wird gelöscht.`)) { await api.del(`/admin/note-tags/${ds('tdel')}`); changed = true; }
      }
      else if (g('#b-new')) { g('#b-new').disabled = true; toast('Backup läuft…'); await api.post('/admin/backups'); toast('Backup erstellt'); changed = true; }
      else if (ds('bdl')) await api.download(`/admin/backups/${ds('bdl')}/download`, g('[data-bdl]').dataset.bn);
      else if (ds('bdel') && (await confirmBox('Backup löschen', 'Backup-Datei endgültig löschen?'))) { await api.del(`/admin/backups/${ds('bdel')}`); changed = true; }
      else if (g('#w-new')) changed = await openForm({
        title: 'Webhook hinzufügen', fields: [{ name: 'url', label: 'URL (https://…)', type: 'url', required: true, full: true }, { name: 'events', label: 'Ereignisse', type: 'multi', options: [{ v: 'budget_80', l: 'Kontolimit zu 80 % erreicht' }, { v: 'budget_exceeded', l: 'Kontolimit überschritten' }], value: ['budget_80', 'budget_exceeded'] }],
        onSubmit: async (v) => { const r = await api.post('/admin/webhooks', { url: v.url, events: v.events }); await showSecret('Webhook-Secret', 'Wird nur einmal angezeigt. Damit wird die Signatur (Header X-BM-Signature) geprüft:', r.secret); },
      });
      else if (ds('wdel') && (await confirmBox('Webhook löschen', 'Webhook entfernen?'))) { await api.del(`/admin/webhooks/${ds('wdel')}`); changed = true; }
      else if (ds('kdel') && (await confirmBox('API-Schlüssel widerrufen', 'Der Schlüssel funktioniert danach nicht mehr.', 'Widerrufen'))) { await api.del(`/admin/api-keys/${ds('kdel')}`); changed = true; }
      else if (g('#a-csv')) await api.download('/admin/audit/export.csv', 'audit.csv');
      if (changed) show();
    } catch (x) { toast(x.message, true); show(); }
  });
  void eur; void fdate;
  await show(ALL[0]?.[0]);
}
