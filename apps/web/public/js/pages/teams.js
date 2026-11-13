// Organisationen (API: /teams): Mitglieder mit Rang und Gruppen, Rechte pro Funktion für Ränge, Gruppen und einzelne Mitglieder
import { api } from '../api.js';
import { $, esc, empty, openForm, confirmBox, toast, showSecret, tag } from '../ui.js';
import { can, state, moduleOn } from '../app.js';

const TABS = [['overview', 'Übersicht'], ['members', 'Mitglieder'], ['ranks', 'Ränge'], ['groups', 'Gruppen'], ['rights', 'Rechte'], ['discord', 'Discord']];
const SHORT = ['–', 'T', 'L', 'L+S', 'V'];
const LEVEL_TAG = ['', 'warn', 'solo', 'shared', 'ok'];

export async function render(view, params) {
  let teams = [], catalog = null, perms = null, memberLevels = null;
  let sel = params?.get?.('id') || null;
  let tab = params?.get?.('tab') || 'overview';
  let subject = '';
  view.innerHTML = `<div class="page-head"><div><h1>Organisationen</h1><p>Mitglieder mit Rang und Gruppen, Rechte für jede Funktion</p></div>
    <div class="actions">${can('team:create') ? '<button class="btn" id="t-new">Organisation erstellen</button>' : ''}</div></div><div id="t-body"></div>`;

  const current = () => teams.find((t) => t.id === sel);
  const seeMembers = (t) => t.is_owner || t.levels.members >= 2;
  const manageMembers = (t) => t.is_owner || t.levels.members >= 3;
  const manageRights = (t) => t.is_owner || t.levels.members >= 4;
  const levelTag = (level) => tag(LEVEL_TAG[level] || '', catalog.levels[level]);
  const groupName = (t, id) => t.groups.find((g) => g.id === id)?.name;
  // Ränge, die die handelnde Person vergeben darf: Inhaber alle, sonst nur unter dem eigenen
  const grantableRanks = (t) => t.ranks.filter((r) => r.manageable);

  async function load() {
    [teams, catalog] = await Promise.all([api.get('/teams'), catalog || api.get('/teams/catalog')]);
    if (!teams.find((t) => t.id === sel)) sel = teams[0]?.id;
    const t = current();
    if (!t) { $('#t-body').innerHTML = `<div class="card">${empty('Du bist noch in keiner Organisation.')}</div>`; return; }
    const tabs = TABS.filter(([k]) => (k !== 'discord' || moduleOn('discord')) && (k === 'overview' || (k === 'rights' || k === 'discord' ? manageRights(t) : seeMembers(t))));
    if (!tabs.some(([k]) => k === tab)) tab = 'overview';
    $('#t-body').innerHTML = `${teams.length > 1 ? `<div class="seg" id="t-sel" style="margin-bottom:16px">${teams.map((x) => `<button data-t="${x.id}" class="${x.id === sel ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      <div class="tabs" ${tabs.length < 2 ? 'hidden' : ''}>${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="t-panel"></div>`;
    await renderTab();
  }

  // Discord: Webhook der Organisation und welche Ereignisse dorthin gehen (Wunsch vom 2026-11-13)
  async function discordPanel(t, panel) {
    const d = await api.get(`/teams/${t.id}/discord`);
    panel.innerHTML = `<div class="card"><div class="card-head"><h2>Discord</h2>${d.configured ? tag('ok', 'Verbunden') : tag('', 'Nicht verbunden')}</div>
      <p class="muted" style="margin-top:0">Ausgewählte Ereignisse dieser Organisation landen automatisch in einem Discord-Kanal. In Discord: Kanal bearbeiten → Integrationen → Webhooks → „Neuer Webhook“ → „Webhook-URL kopieren“. Die Adresse wird verschlüsselt gespeichert; Erwähnungen wie @everyone werden nie ausgelöst.</p>
      <form id="dc-form" class="form" novalidate>
        <label class="field full">Webhook-URL<input name="webhook_url" type="password" autocomplete="off" placeholder="${d.configured ? `gespeichert (${esc(d.webhook_hint)}) – leer lassen zum Behalten` : 'https://discord.com/api/webhooks/…'}"></label>
        <div class="field full"><span>Ereignisse</span><div class="dc-events">${Object.entries(d.available).map(([k, l]) => `<label class="row start" style="gap:8px"><input type="checkbox" name="ev" value="${k}" ${d.events.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
        <div class="full row start" style="gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Speichern</button>${d.configured ? '<button class="btn ghost" type="button" id="dc-test">Testnachricht senden</button><button class="btn danger" type="button" id="dc-del">Verbindung entfernen</button>' : ''}</div>
      </form></div>`;
    $('#dc-form', panel).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { events: [...f.querySelectorAll('input[name=ev]:checked')].map((i) => i.value) };
      if (f.webhook_url.value.trim()) body.webhook_url = f.webhook_url.value.trim();
      try { await api.put(`/teams/${t.id}/discord`, body); toast('Discord gespeichert'); await discordPanel(t, panel); } catch (x) { toast(x.message, true); }
    });
    $('#dc-test', panel)?.addEventListener('click', async () => { try { await api.post(`/teams/${t.id}/discord/test`); toast('Testnachricht gesendet'); } catch (x) { toast(x.message, true); } });
    $('#dc-del', panel)?.addEventListener('click', async () => {
      if (!(await confirmBox('Discord-Verbindung entfernen', 'Es gehen keine Nachrichten mehr an Discord.', 'Entfernen'))) return;
      try { await api.put(`/teams/${t.id}/discord`, { webhook_url: '', events: [] }); toast('Entfernt'); await discordPanel(t, panel); } catch (x) { toast(x.message, true); }
    });
  }

  async function renderTab() {
    const t = current();
    const panel = $('#t-panel');
    if (tab === 'members') panel.innerHTML = membersHtml(t);
    else if (tab === 'ranks') panel.innerHTML = ranksHtml(t);
    else if (tab === 'groups') panel.innerHTML = groupsHtml(t);
    else if (tab === 'rights') { await loadRights(t); panel.innerHTML = rightsHtml(t); }
    else if (tab === 'discord') await discordPanel(t, panel);
    else panel.innerHTML = await overviewHtml(t);
  }

  // ---- Übersicht: eigene Stellung und eigene Rechte
  async function overviewHtml(t) {
    const myGroups = t.group_ids.map((id) => groupName(t, id)).filter(Boolean);
    const objectKinds = [
      ['property:read', 'property', '/properties', 'Häuser', (item) => item.name],
      ['vehicle:read', 'vehicle', '/vehicles', 'Fahrzeuge', (item) => `${item.make_model} (${item.plate})`],
      ['key:read', 'key', '/keys', 'Schlüssel', (item) => `${item.label} (${item.code})`],
    ].filter(([permission, module]) => can(permission) && t.levels[module] >= 2);
    const objects = await Promise.all(objectKinds.map(async ([, , path, label, title]) => ({
      label, items: (await api.get(path)).filter((item) => item.team_id === t.id).map((item) => title(item)),
    })));
    return `<div class="grid cols-21"><div class="card stack"><div class="card-head"><h2>${esc(t.name)}</h2>${t.status === 'archived' ? tag('warn', 'Archiviert') : ''}</div>
        <p>Dein Rang: <b>${esc(t.rank_name || 'ohne Rang')}</b> ${t.is_owner ? tag('ok', 'Inhaber') : ''}</p>
        <p>Deine Gruppen: ${myGroups.length ? myGroups.map((g) => tag('', g)).join(' ') : (t.group_ids.length ? `${t.group_ids.length}` : '<span class="muted">keine</span>')}</p>
        ${t.is_owner ? '<div class="note info">Als Inhaber darfst du alles: Rechte, Ränge und Gruppen gelten für dich nicht.</div>' : ''}
        <p>${t.budgets} geteilte${t.budgets === 1 ? 's' : ''} Konto${t.budgets === 1 ? '' : 'en'} – anzulegen unter „Konten“.</p>
        ${t.is_owner ? '<div class="row start"><button class="btn ghost sm" id="t-ren">Umbenennen</button><button class="btn ghost sm" id="t-arch">' + (t.status === 'archived' ? 'Wieder aktivieren' : 'Archivieren') + '</button><button class="btn ghost sm" id="t-del">Organisation löschen</button></div>' : ''}</div>
      <div class="card"><div class="card-head"><h2>Deine Rechte</h2></div><div class="scroll-x"><table class="table"><tbody>
        ${catalog.modules.map((m) => `<tr><td>${esc(m.label)}</td><td>${levelTag(t.levels[m.key] ?? 0)}</td><td class="muted">${esc(m.hints[t.levels[m.key]] || '')}</td></tr>`).join('')}
      </tbody></table></div></div></div>
      ${objects.length ? `<div class="card"><div class="card-head"><h2>Objekte dieser Organisation</h2></div><div class="grid cols-2">${objects.map((group) => `<div><h3>${esc(group.label)}</h3>${group.items.length ? `<ul>${group.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="muted">Keine sichtbar.</p>'}</div>`).join('')}</div></div>` : ''}`;
  }

  // ---- Mitglieder
  function membersHtml(t) {
    const ranks = grantableRanks(t);
    const rankSelect = (m) => {
      const options = ranks.some((r) => r.id === m.rank_id) ? ranks : [{ id: m.rank_id, name: m.rank_name || 'ohne Rang', disabled: true }, ...ranks];
      return `<select data-rank="${m.id}" aria-label="Rang von ${esc(m.name)}">${options.map((r) => `<option value="${r.id || ''}" ${r.id === m.rank_id ? 'selected' : ''} ${r.disabled ? 'disabled' : ''}>${esc(r.name)}</option>`).join('')}</select>`;
    };
    return `<div class="card"><div class="card-head"><h2>Mitglieder</h2>${tag('', `${t.members.length} aktiv · ${t.invitations.length} eingeladen`)}</div>
      <div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>E-Mail</th><th style="width:160px">Rang</th><th>Gruppen</th><th></th></tr></thead><tbody>
      ${t.members.map((m) => `<tr><td><b>${esc(m.name)}</b> ${m.is_owner ? tag('ok', 'Inhaber') : ''}</td><td>${esc(m.email)}</td>
        <td>${m.manageable ? rankSelect(m) : esc(m.rank_name || '–')}</td>
        <td>${m.group_ids.map((id) => tag('', groupName(t, id) || '?')).join(' ') || '<span class="muted">–</span>'}
          ${m.manageable && t.groups.length ? ` <button class="link" data-groups="${m.id}">Gruppen</button>` : ''}</td>
        <td style="white-space:nowrap">${t.is_owner && m.id !== state.me.id ? `<button class="link" data-owner="${m.id}">${m.is_owner ? 'Inhaber entfernen' : 'Zum Inhaber machen'}</button> ` : ''}
          ${m.id === state.me.id ? `<button class="link" data-rm="${m.id}">Verlassen</button>` : m.manageable ? `<button class="link" data-rm="${m.id}">Entfernen</button>` : ''}</td></tr>`).join('')}
      ${t.invitations.map((i) => `<tr><td class="muted">—</td><td>${esc(i.email)}</td><td>${esc(i.rank_name || '–')}</td><td><span class="tag warn">Einladung offen</span></td><td><button class="link" data-rminv="${i.id}">Entfernen</button></td></tr>`).join('')}
      </tbody></table></div>
      ${manageMembers(t) && ranks.length ? `<form class="row" id="t-inv" style="margin-top:16px"><input name="email" type="email" placeholder="E-Mail zum Einladen" required aria-label="E-Mail zum Einladen">
        <select name="rank" style="width:160px" aria-label="Rang">${[...ranks].reverse().map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><button class="btn">Einladen</button></form>` : ''}
      ${manageMembers(t) && !t.is_owner ? '<p class="muted" style="margin-top:12px">Du verwaltest Mitglieder unter deinem Rang und vergibst nur Ränge und Gruppen, die nicht mehr dürfen als du.</p>' : ''}</div>`;
  }

  // ---- Ränge, höchster zuerst
  function ranksHtml(t) {
    const manage = manageRights(t);
    return `<div class="card"><div class="card-head"><h2>Ränge</h2>${manage ? '<button class="btn ghost sm" id="r-new">Rang anlegen</button>' : ''}</div>
      <p class="muted">Höchster Rang oben. Neue Ränge kommen ganz nach unten und haben noch keine Rechte – die setzt du unter „Rechte“.</p>
      ${t.ranks.length ? t.ranks.map((r, i) => `<div class="list-item"><div class="grow"><b>${esc(r.name)}</b><small>${r.members === 1 ? '1 Mitglied' : `${r.members} Mitglieder`}</small></div>
        ${manage && r.manageable ? `<div class="row">
          <button class="btn ghost sm" data-rup="${r.id}" ${i === 0 || !t.ranks[i - 1].manageable ? 'disabled' : ''} aria-label="${esc(r.name)} nach oben">▲</button>
          <button class="btn ghost sm" data-rdown="${r.id}" ${i === t.ranks.length - 1 ? 'disabled' : ''} aria-label="${esc(r.name)} nach unten">▼</button>
          <button class="btn ghost sm" data-rren="${r.id}">Umbenennen</button><button class="btn ghost sm" data-rdel="${r.id}">Löschen</button></div>` : ''}</div>`).join('') : empty('Noch keine Ränge.')}</div>`;
  }

  // ---- Gruppen
  function groupsHtml(t) {
    const manage = manageRights(t);
    const memberName = (id) => t.members.find((m) => m.id === id)?.name || '?';
    return `<div class="card"><div class="card-head"><h2>Gruppen</h2>${manage ? '<button class="btn ghost sm" id="g-new">Gruppe anlegen</button>' : ''}</div>
      <p class="muted">Gruppen fassen Mitglieder unabhängig vom Rang zusammen, z. B. Abteilungen. Ihre Rechte kommen zum Rang dazu; zugewiesen werden sie unter „Mitglieder“.</p>
      ${t.groups.length ? t.groups.map((g) => `<div class="list-item"><div class="grow"><b>${esc(g.name)}</b><small>${esc(g.description || '')}${g.description ? ' · ' : ''}${g.member_ids.length ? g.member_ids.map(memberName).map(esc).join(', ') : 'noch keine Mitglieder'}</small></div>
        ${manage ? `<div class="row"><button class="btn ghost sm" data-gedit="${g.id}">Bearbeiten</button><button class="btn ghost sm" data-gdel="${g.id}">Löschen</button></div>` : ''}</div>`).join('') : empty('Noch keine Gruppen.')}</div>`;
  }

  // ---- Rechte
  async function loadRights(t) {
    perms = await api.get(`/teams/${t.id}/permissions`);
    const subjects = subjectOptions(t);
    if (!subjects.some((s) => s.v === subject)) subject = subjects[0]?.v || '';
    memberLevels = subject.startsWith('user:') ? await api.get(`/teams/${t.id}/members/${subject.slice(5)}/levels`) : null;
  }
  function subjectOptions(t) {
    return [
      ...t.ranks.map((r) => ({ v: `rank:${r.id}`, l: r.name, group: 'Ränge', locked: !r.manageable })),
      ...t.groups.map((g) => ({ v: `group:${g.id}`, l: g.name, group: 'Gruppen', locked: false })),
      ...t.members.filter((m) => !m.is_owner).map((m) => ({ v: `user:${m.id}`, l: m.name, group: 'Mitglieder (persönlich)', locked: !m.manageable })),
    ];
  }
  function rightsHtml(t) {
    const subjects = subjectOptions(t);
    if (!subjects.length) return `<div class="card">${empty('Lege zuerst einen Rang an.')}</div>`;
    const [kind, id] = subject.split(':');
    const locked = subjects.find((s) => s.v === subject)?.locked;
    const rows = perms.rows.filter((r) => r[`${kind}_id`] === id);
    const rowOf = (module, scope = null) => rows.find((r) => r.module === module && (r.scope_id || null) === scope);
    const mine = (key) => (perms.is_owner ? 4 : perms.mine[key] ?? 0);
    const select = (m, scope, scopeName) => {
      const row = rowOf(m.key, scope?.id || null);
      const key = scope ? `${m.key}:${scope.id}` : m.key;
      const inherit = scope ? `Wie ${m.label} allgemein` : kind === 'user' ? 'Wie Rang und Gruppen' : null;
      const value = row ? String(row.level) : inherit ? '' : '0';
      const options = [...(inherit ? [{ v: '', l: inherit }] : []), ...m.levels.map((l) => ({ v: String(l), l: catalog.levels[l], disabled: l > mine(key) && String(l) !== value }))];
      return `<select data-perm="${m.key}" data-scope="${scope?.id || ''}" ${locked ? 'disabled' : ''} aria-label="${esc(scopeName || m.label)}">${options.map((o) => `<option value="${o.v}" ${o.v === value ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
    };
    const effective = (key) => (memberLevels ? levelTag(memberLevels[key] ?? 0) : '');
    const body = catalog.modules.map((m) => {
      const scopes = m.scope ? perms.scopes[m.key] || [] : [];
      return `<tr><td><b>${esc(m.label)}</b></td><td>${select(m, null)}</td>${memberLevels ? `<td>${effective(m.key)}</td>` : ''}<td class="muted">${esc(Object.entries(m.hints).map(([l, h]) => `${SHORT[l]}: ${h}`).join(' · '))}</td></tr>
        ${scopes.map((s) => `<tr><td style="padding-left:28px">${esc(m.scope)}: ${esc(s.name)}</td><td>${select(m, s, `${m.scope} ${s.name}`)}</td>${memberLevels ? `<td>${effective(`${m.key}:${s.id}`)}</td>` : ''}<td></td></tr>`).join('')}`;
    }).join('');
    const groups = [...new Set(subjects.map((s) => s.group))];
    return `<div class="card"><div class="card-head"><h2>Rechte</h2>
        <select id="r-subject" style="max-width:280px" aria-label="Rechte für">${groups.map((g) => `<optgroup label="${esc(g)}">${subjects.filter((s) => s.group === g).map((s) => `<option value="${s.v}" ${s.v === subject ? 'selected' : ''}>${esc(s.l)}</option>`).join('')}</optgroup>`).join('')}</select></div>
      <div class="note info">Es gilt das höchste Recht aus Rang und Gruppen. Ein persönlich gesetztes Recht gilt genau so, auch wenn es weniger ist. Eine Zeile für eine Aktenart oder Kategorie geht der allgemeinen vor. Inhaber dürfen immer alles.</div>
      ${locked ? '<p class="muted">Diese Rechte ändert jemand über dir.</p>' : !perms.is_owner ? '<p class="muted">Du vergibst nur, was du selbst hast; höhere Stufen sind ausgegraut.</p>' : ''}
      <div class="scroll-x"><table class="table"><thead><tr><th>Funktion</th><th style="width:240px">Recht</th>${memberLevels ? '<th>Wirksam</th>' : ''}<th>Stufen</th></tr></thead><tbody>${body}</tbody></table></div></div>
      ${matrixHtml(t)}`;
  }
  // Alle Ränge und Gruppen auf einen Blick (nur Funktionen, ohne Aktenarten und Kategorien)
  function matrixHtml(t) {
    const cols = [...t.ranks.map((r) => ({ id: r.id, kind: 'rank', name: r.name })), ...t.groups.map((g) => ({ id: g.id, kind: 'group', name: g.name }))];
    const cell = (col, module) => {
      const row = perms.rows.find((r) => r[`${col.kind}_id`] === col.id && r.module === module && !r.scope_id);
      const level = row?.level ?? (col.kind === 'group' ? null : 0);
      return level === null ? '<span class="muted">·</span>' : `<span title="${esc(catalog.levels[level])}">${SHORT[level]}</span>`;
    };
    return `<div class="card"><div class="card-head"><h2>Übersicht</h2><span class="muted">${SHORT.map((s, l) => `${s} = ${catalog.levels[l]}`).join(' · ')}</span></div>
      <div class="scroll-x"><table class="table matrix"><thead><tr><th>Funktion</th>${cols.map((c) => `<th>${esc(c.name)}${c.kind === 'group' ? '<br><small class="muted">Gruppe</small>' : ''}</th>`).join('')}</tr></thead>
      <tbody>${catalog.modules.map((m) => `<tr><td>${esc(m.label)}</td>${cols.map((c) => `<td>${cell(c, m.key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---- Aktionen
  view.addEventListener('click', async (e) => {
    const g = (s) => e.target.closest(s);
    const t = current();
    try {
      if (g('#t-new')) {
        const created = await openForm({ title: 'Organisation erstellen', fields: [{ name: 'name', label: 'Name', required: true, full: true, help: 'Du wirst Inhaber. Die Ränge Leitung, Mitglied und Leser werden mit passenden Rechten angelegt.' }], onSubmit: (v) => api.post('/teams', { name: v.name.trim() }) });
        if (created) { sel = created.id; tab = 'overview'; load(); }
      } else if (g('#t-sel [data-t]')) { sel = g('[data-t]').dataset.t; load(); }
      else if (g('.tabs [data-tab]')) { tab = g('[data-tab]').dataset.tab; $$tabs(); await renderTab(); }
      else if (g('#t-ren')) { if (await openForm({ title: 'Organisation umbenennen', fields: [{ name: 'name', label: 'Name', value: t.name, required: true, full: true }], onSubmit: (v) => api.patch(`/teams/${t.id}`, { name: v.name.trim() }) })) load(); }
      else if (g('#t-arch')) { await api.patch(`/teams/${t.id}`, { status: t.status === 'archived' ? 'active' : 'archived' }); load(); }
      else if (g('#t-del')) { if (await confirmBox('Organisation löschen', 'Geteilte Konten, Akten, Schulungen, Lizenzen, Dokumentationen und Objekte der Organisation werden ebenfalls gelöscht.')) { await api.del(`/teams/${t.id}`); load(); } }
      else if (g('[data-rm]')) {
        const self = g('[data-rm]').dataset.rm === state.me.id;
        if (await confirmBox(self ? 'Organisation verlassen' : 'Mitglied entfernen', self ? 'Du verlierst den Zugriff auf alles dieser Organisation.' : 'Soll das Mitglied aus der Organisation entfernt werden?', self ? 'Verlassen' : 'Entfernen')) { await api.del(`/teams/${t.id}/members/${g('[data-rm]').dataset.rm}`); load(); }
      } else if (g('[data-rminv]')) { await api.del(`/teams/${t.id}/invitations/${g('[data-rminv]').dataset.rminv}`); load(); }
      else if (g('[data-owner]')) {
        const m = t.members.find((x) => x.id === g('[data-owner]').dataset.owner);
        if (await confirmBox(m.is_owner ? 'Inhaber entfernen' : 'Zum Inhaber machen', m.is_owner ? `${m.name} verliert die Inhaberrechte und hat danach nur noch die Rechte des Rangs.` : `${m.name} darf danach alles in dieser Organisation, auch dich entfernen.`, m.is_owner ? 'Entfernen' : 'Zum Inhaber machen')) {
          await api.patch(`/teams/${t.id}/members/${m.id}`, { is_owner: !m.is_owner }); load();
        }
      } else if (g('[data-groups]')) {
        const m = t.members.find((x) => x.id === g('[data-groups]').dataset.groups);
        if (await openForm({ title: `Gruppen von ${m.name}`, fields: [{ name: 'group_ids', label: 'Gruppen', type: 'multi', full: true, value: m.group_ids, options: t.groups.map((x) => ({ v: x.id, l: x.name })) }], onSubmit: (v) => api.patch(`/teams/${t.id}/members/${m.id}`, { group_ids: v.group_ids }) })) load();
      } else if (g('#r-new')) { if (await openForm({ title: 'Rang anlegen', fields: [{ name: 'name', label: 'Name', required: true, full: true, maxlength: 60, help: 'Kommt ganz nach unten, ohne Rechte.' }], onSubmit: (v) => api.post(`/teams/${t.id}/ranks`, { name: v.name.trim() }) })) load(); }
      else if (g('[data-rup]')) { await api.patch(`/team-ranks/${g('[data-rup]').dataset.rup}`, { move: 'up' }); load(); }
      else if (g('[data-rdown]')) { await api.patch(`/team-ranks/${g('[data-rdown]').dataset.rdown}`, { move: 'down' }); load(); }
      else if (g('[data-rren]')) {
        const r = t.ranks.find((x) => x.id === g('[data-rren]').dataset.rren);
        if (await openForm({ title: 'Rang umbenennen', fields: [{ name: 'name', label: 'Name', value: r.name, required: true, full: true, maxlength: 60 }], onSubmit: (v) => api.patch(`/team-ranks/${r.id}`, { name: v.name.trim() }) })) load();
      } else if (g('[data-rdel]')) {
        const r = t.ranks.find((x) => x.id === g('[data-rdel]').dataset.rdel);
        if (await confirmBox('Rang löschen', `„${r.name}“ und seine Rechte werden gelöscht.`)) { await api.del(`/team-ranks/${r.id}`); load(); }
      } else if (g('#g-new') || g('[data-gedit]')) {
        const grp = g('[data-gedit]') ? t.groups.find((x) => x.id === g('[data-gedit]').dataset.gedit) : null;
        if (await openForm({
          title: grp ? 'Gruppe bearbeiten' : 'Gruppe anlegen',
          fields: [{ name: 'name', label: 'Name', value: grp?.name || '', required: true, full: true, maxlength: 60 }, { name: 'description', label: 'Beschreibung', type: 'textarea', value: grp?.description || '', full: true, maxlength: 500 }],
          onSubmit: (v) => (grp ? api.patch(`/team-groups/${grp.id}`, v) : api.post(`/teams/${t.id}/groups`, v)),
        })) load();
      } else if (g('[data-gdel]')) {
        const grp = t.groups.find((x) => x.id === g('[data-gdel]').dataset.gdel);
        if (await confirmBox('Gruppe löschen', `„${grp.name}“ und ihre Rechte werden gelöscht; die Mitglieder bleiben.`)) { await api.del(`/team-groups/${grp.id}`); load(); }
      }
    } catch (x) { toast(x.message, true); }
  });
  const $$tabs = () => view.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));

  view.addEventListener('change', async (e) => {
    const t = current();
    try {
      if (e.target.dataset.rank) {
        await api.patch(`/teams/${t.id}/members/${e.target.dataset.rank}`, { rank_id: e.target.value });
        toast('Rang geändert');
        load();
      } else if (e.target.id === 'r-subject') {
        subject = e.target.value;
        await renderTab();
      } else if (e.target.dataset.perm) {
        const [kind, id] = subject.split(':');
        await api.put(`/teams/${t.id}/permissions`, {
          subject: kind, subject_id: id, module: e.target.dataset.perm, scope_id: e.target.dataset.scope || null,
          level: e.target.value === '' ? null : Number(e.target.value),
        });
        toast('Recht gespeichert');
        await renderTab();
      }
    } catch (x) { toast(x.message, true); renderTab(); }
  });
  view.addEventListener('submit', async (e) => {
    if (e.target.id !== 't-inv') return;
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api.post(`/teams/${sel}/members`, { email: f.get('email'), rank_id: f.get('rank') });
      if (r.link && !r.mail_sent) await showSecret('Einladungslink', 'E-Mail-Versand ist nicht konfiguriert. Gib diesen Link (7 Tage gültig) manuell weiter:', r.link);
      else toast(r.invited ? 'Einladung gesendet' : 'Mitglied hinzugefügt');
      load();
    } catch (x) { toast(x.message, true); }
  });
  await load();
}
