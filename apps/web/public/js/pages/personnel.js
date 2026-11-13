// Personal (Wünsche des Auftraggebers vom 2026-11-13): Bewerbungen (von Mitgliedern gepflegt), Personalakte mit
// Beförderungen, Belobigungen und Verwarnungen, Abwesenheiten.
import { api } from '../api.js';
import { $, esc, empty, tag, fdate, fdatetime, openForm, confirmBox, toast, todayStr, debounce } from '../ui.js';
import { can, state, moduleOn } from '../app.js';
import { markdownBlock } from '../markdown.js';
import { pickTeam, rememberTeam, teamSelect, noTeam } from './org-pick.js';
import { toLocalInput, fromLocalInput } from './case-parts.js';

export const ABSENCE = { vacation: ['primary', 'Urlaub'], sick: ['warn', 'Krank'], inactive: ['', 'Inaktiv'], other: ['', 'Sonstiges'] };
const APP_STATUS = { new: ['primary', 'Neu'], interview: ['warn', 'Gespräch'], accepted: ['ok', 'Angenommen'], rejected: ['bad', 'Abgelehnt'], withdrawn: ['', 'Zurückgezogen'] };
const ENTRY = { hired: ['ok', 'Eingestellt'], promotion: ['ok', 'Beförderung'], demotion: ['warn', 'Degradierung'], commendation: ['primary', 'Belobigung'], warning: ['bad', 'Verwarnung'], note: ['', 'Vermerk'], left: ['', 'Ausgeschieden'] };

// Ränge, die ich vergeben darf (aus der vollen Organisationsliste; leer ohne Recht auf Mitglieder)
async function grantableRanks(teamId) {
  const t = (await api.get('/teams')).find((x) => x.id === teamId);
  return (t?.ranks || []).filter((r) => r.manageable).sort((a, b) => b.position - a.position);
}

// Benutzersuche nur mit Namen (wie bei Umbuchungen); füllt ein <select> im offenen Dialog
function userPicker(modal, current) {
  const input = $('[data-user-q]', modal);
  const select = $('[name=user_id]', modal);
  if (!input || !select) return;
  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return;
    const users = await api.get(`/transfers/users?q=${encodeURIComponent(q)}`).catch(() => []);
    select.innerHTML = `<option value="">– kein Benutzerkonto –</option>${users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}`;
    if (users.length) select.value = users[0].id;
  }, 300));
  if (current) select.innerHTML = `<option value="">– kein Benutzerkonto –</option><option value="${current.id}" selected>${esc(current.name)}</option>`;
}

/* ---------- Bewerbungen ---------- */
async function applicationsPanel(el, teamId, level) {
  let data = { items: [] };
  let filter = 'open';
  const shown = () => data.items.filter((a) => (filter === 'all') || (filter === 'open' ? ['new', 'interview'].includes(a.status) : !['new', 'interview'].includes(a.status)));
  const form = async (a) => {
    const done = openForm({
      title: a ? 'Bewerbung bearbeiten' : 'Neue Bewerbung', wide: true,
      fields: [
        { name: 'name', label: 'Name', value: a?.name, required: true, maxlength: 120 },
        { name: 'contact', label: 'Kontakt (Telefon, Discord …)', value: a?.contact, maxlength: 200 },
        { type: 'html', html: `<label class="field">Benutzerkonto suchen<input data-user-q placeholder="Name eingeben…" autocomplete="off"></label>` },
        { name: 'user_id', label: 'Benutzerkonto (wird bei Annahme Mitglied)', type: 'select', options: [{ v: '', l: '– kein Benutzerkonto –' }] },
        { name: 'status', label: 'Status', type: 'select', options: ['new', 'interview', 'withdrawn'].map((v) => ({ v, l: APP_STATUS[v][1] })), value: a?.status || 'new' },
        { name: 'interview_at', label: 'Gespräch am', type: 'datetime-local', value: toLocalInput(a?.interview_at) },
        { name: 'body', label: 'Bewerbung, Lebenslauf, Eindruck', type: 'textarea', value: a?.body, maxlength: 20000, full: true, markdown: true, rows: 6 },
      ],
      onSubmit: async (v, m) => {
        const body = { name: v.name.trim(), contact: v.contact.trim(), user_id: $('[name=user_id]', m).value || null, status: v.status, interview_at: v.interview_at ? fromLocalInput(v.interview_at) : null, body: v.body };
        if (a) await api.patch(`/applications/${a.id}`, body); else await api.post('/applications', { ...body, team_id: teamId });
        toast('Bewerbung gespeichert');
      },
    });
    userPicker($('#modals .modal:last-child'), a?.user_id ? { id: a.user_id, name: a.user_name } : null);
    return done;
  };
  async function detail(id) {
    const a = await api.get(`/applications/${id}`);
    const open = ['new', 'interview'].includes(a.status);
    const ranks = open && level >= 4 && a.user_id ? await grantableRanks(teamId) : [];
    const pending = openForm({
      title: a.name, wide: true, submit: 'Schließen', cancel: 'Abbrechen',
      extraButtons: open && level >= 4 ? '<button type="button" class="btn danger" data-decide="rejected">Ablehnen</button><button type="button" class="btn" data-decide="accepted">Annehmen</button>' : '',
      fields: [
        { type: 'html', html: `<p>${tag(...APP_STATUS[a.status])} ${a.contact ? `· ${esc(a.contact)}` : ''}${a.user_id ? ` · Konto: <b>${esc(a.user_name || '')}</b>` : ' · ohne Benutzerkonto'}${a.interview_at ? ` · Gespräch ${fdatetime(a.interview_at)}` : ''}</p>
          ${a.body ? markdownBlock(a.body) : ''}${a.decision_note ? `<p><b>Entscheidung:</b> ${esc(a.decision_note)}</p>` : ''}
          <h3 style="font-size:13px;margin:14px 0 6px">Notizen</h3>${a.notes.length ? a.notes.map((n) => `<div class="list-item"><div class="grow"><small class="muted">${esc(n.created_by_name || '–')} · ${fdatetime(n.created_at)}</small><div style="white-space:pre-line">${esc(n.body)}</div></div></div>`).join('') : '<p class="muted">Noch keine Notizen.</p>'}` },
        ...(open && level >= 3 ? [{ name: 'note', label: 'Neue Notiz', type: 'textarea', maxlength: 5000, full: true, rows: 2 }] : []),
        ...(open && level >= 4 ? [
          ...(a.user_id ? [{ name: 'rank_id', label: 'Rang bei Annahme', type: 'select', options: ranks.map((r) => ({ v: r.id, l: r.name })), value: a.rank_id || ranks[ranks.length - 1]?.id }] : [{ type: 'html', html: '<p class="muted">Ohne Benutzerkonto wird bei Annahme nur der Status gesetzt; Mitglied wird die Person über „Organisationen → Mitglieder“.</p>' }]),
          { name: 'decision_note', label: 'Begründung der Entscheidung (optional)', maxlength: 2000, full: true },
        ] : []),
      ],
      onSubmit: async (v) => { if (v.note?.trim()) await api.post(`/applications/${a.id}/notes`, { body: v.note.trim() }); return true; },
    });
    const m = $('#modals .modal:last-child');
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-decide]');
      if (!b) return;
      b.disabled = true;
      try {
        const r = await api.post(`/applications/${a.id}/decide`, { decision: b.dataset.decide, rank_id: $('[name=rank_id]', m)?.value || null, note: $('[name=decision_note]', m)?.value.trim() || '' });
        toast(b.dataset.decide === 'accepted' ? (r.member ? `Angenommen – jetzt Mitglied als ${r.member.rank}` : 'Angenommen') : 'Abgelehnt');
        $('[data-x]', m).click();
        await load();
      } catch (error) { b.disabled = false; toast(error.message, true); }
    });
    return pending;
  }
  function draw() {
    const list = shown();
    el.innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap"><div class="seg"><button data-f="open" class="${filter === 'open' ? 'on' : ''}">Offen</button><button data-f="done" class="${filter === 'done' ? 'on' : ''}">Entschieden</button><button data-f="all" class="${filter === 'all' ? 'on' : ''}">Alle</button></div>
      <span class="grow"></span>${level >= 3 && can('recruit:create') ? '<button class="btn sm" id="ap-new">Bewerbung anlegen</button>' : ''}</div>
      <div class="card">${list.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Status</th><th>Gespräch</th><th>Konto</th><th>Notizen</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.contact ? `<br><small class="muted">${esc(a.contact)}</small>` : ''}</td><td>${tag(...APP_STATUS[a.status])}${a.rank_name && a.status === 'accepted' ? `<br><small class="muted">${esc(a.rank_name)}</small>` : ''}</td>
        <td>${a.interview_at ? fdatetime(a.interview_at) : '–'}</td><td>${a.user_name ? esc(a.user_name) : '–'}</td><td>${a.notes}</td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-ap-open="${a.id}">Öffnen</button>${level >= 3 && ['new', 'interview'].includes(a.status) ? ` <button class="btn ghost sm" data-ap-edit="${a.id}">Bearbeiten</button>` : ''}${level >= 4 ? ` <button class="btn ghost sm" data-ap-del="${a.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Keine Bewerbungen.')}</div>`;
  }
  async function load() { data = await api.get(`/applications?team_id=${teamId}`); draw(); }
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.f) { filter = b.dataset.f; draw(); return; }
      let changed = false;
      if (b.id === 'ap-new') changed = await form(null);
      else if (b.dataset.apEdit) changed = await form(data.items.find((a) => a.id === b.dataset.apEdit));
      else if (b.dataset.apOpen) changed = await detail(b.dataset.apOpen);
      else if (b.dataset.apDel && await confirmBox('Bewerbung löschen', 'Die Bewerbung wird samt Notizen gelöscht.')) { await api.del(`/applications/${b.dataset.apDel}`); changed = true; }
      if (changed) await load();
    } catch (error) { toast(error.message, true); }
  };
  await load();
}

/* ---------- Personalakte ---------- */
async function personnelPanel(el, teamId, levels, isOwner) {
  let data = { members: [], level: 0 };
  async function record(userId) {
    const r = await api.get(`/personnel/${userId}?team_id=${teamId}`);
    const write = data.level >= 3 && can('personnel:create');
    const canRank = (isOwner || (levels.members || 0) >= 3) && userId !== state.me.id;
    const ranks = write && canRank ? await grantableRanks(teamId) : [];
    const pending = openForm({
      title: `Personalakte: ${r.member?.name || ''}`, wide: true, submit: write ? 'Eintrag speichern' : 'Schließen',
      fields: [
        { type: 'html', html: `<p>${r.member ? `Rang: <b>${esc(r.member.rank_name || '–')}</b>${r.member.is_owner ? ` ${tag('primary', 'Inhaber')}` : ''}` : '<span class="muted">Nicht mehr Mitglied</span>'}</p>
          <div class="pe-list">${r.entries.length ? r.entries.map((x) => `<div class="list-item"><div class="grow">${tag(...ENTRY[x.kind])} <b>${esc(x.title)}</b><small class="muted"> · ${fdate(x.entry_date)} · ${esc(x.created_by_name || '–')}${x.rank_from || x.rank_to ? ` · ${esc(x.rank_from || '–')} → ${esc(x.rank_to || '–')}` : ''}</small>
            ${x.body ? `<div style="white-space:pre-line;margin-top:4px">${esc(x.body)}</div>` : ''}</div>${data.level >= 4 ? `<button type="button" class="btn ghost sm" data-pe-del="${x.id}">Löschen</button>` : ''}</div>`).join('') : '<p class="muted">Noch keine Einträge.</p>'}</div>
          ${write ? '<h3 style="font-size:13px;margin:16px 0 6px">Neuer Eintrag</h3>' : ''}` },
        ...(write ? [
          { name: 'kind', label: 'Art', type: 'select', options: ['commendation', 'warning', 'note', ...(canRank ? ['promotion', 'demotion'] : []), 'left'].map((v) => ({ v, l: ENTRY[v][1] })) },
          ...(canRank && ranks.length ? [{ name: 'rank_id', label: 'Neuer Rang (nur bei Beförderung/Degradierung, ändert ihn sofort)', type: 'select', options: [{ v: '', l: '– Rang nicht ändern –' }, ...ranks.map((x) => ({ v: x.id, l: x.name }))] }] : []),
          { name: 'title', label: 'Titel (leer = Art)', maxlength: 200, full: true },
          { name: 'body', label: 'Begründung', type: 'textarea', maxlength: 10000, full: true, rows: 3 },
          { name: 'entry_date', label: 'Datum', type: 'date', value: todayStr() },
        ] : []),
      ],
      onSubmit: async (v) => {
        if (!write) return true;
        const res = await api.post(`/personnel/${userId}/entries`, { team_id: teamId, kind: v.kind, rank_id: v.rank_id || null, title: v.title.trim(), body: v.body, entry_date: v.entry_date });
        toast(res.rank ? `Eingetragen, neuer Rang: ${res.rank.to}` : 'Eingetragen');
        return true;
      },
    });
    $('#modals .modal:last-child').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pe-del]');
      if (!b) return;
      if (!(await confirmBox('Eintrag löschen', 'Der Eintrag verschwindet aus der Personalakte. Ein schon geänderter Rang bleibt.'))) return;
      try { await api.del(`/personnel-entries/${b.dataset.peDel}`); b.closest('.list-item').remove(); toast('Gelöscht'); await load(); } catch (error) { toast(error.message, true); }
    });
    return pending;
  }
  function draw() {
    el.innerHTML = `${data.level < 2 ? '<p class="muted">Du siehst deine eigene Personalakte.</p>' : ''}<div class="card">${data.members.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Mitglied</th><th>Rang</th><th>Einträge</th><th>Letzte Rangänderung</th><th></th></tr></thead><tbody>
      ${data.members.map((m) => `<tr><td><b>${esc(m.name)}</b>${m.is_owner ? ` ${tag('primary', 'Inhaber')}` : ''}</td><td>${esc(m.rank_name || '–')}</td><td>${m.entries}</td><td>${m.last_rank_change ? fdate(m.last_rank_change) : '–'}</td>
        <td><button class="btn ghost sm" data-pe-open="${m.user_id}">Akte öffnen</button></td></tr>`).join('')}</tbody></table></div>` : empty('Keine Mitglieder.')}</div>`;
  }
  async function load() { data = await api.get(`/personnel?team_id=${teamId}`); draw(); }
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b?.dataset.peOpen) return;
    try { if (await record(b.dataset.peOpen)) await load(); } catch (error) { toast(error.message, true); }
  };
  await load();
}

/* ---------- Abwesenheiten ---------- */
export async function absencesPanel(el, teamId, level) {
  let data = { items: [] };
  let when = 'current';
  let members = null;
  const today = todayStr();
  const shown = () => data.items.filter((a) => (when === 'all') || (when === 'current' ? a.ends_on >= today : a.ends_on < today));
  const form = async (a) => {
    if (!a && level >= 3 && !members) members = await api.get(`/org-members?team_id=${teamId}&module=absences&min=3`);
    return openForm({
      title: a ? 'Abwesenheit bearbeiten' : 'Abwesenheit melden',
      fields: [
        ...(!a && level >= 3 ? [{ name: 'user_id', label: 'Wer', type: 'select', options: [{ v: '', l: 'Ich selbst' }, ...members.map((m) => ({ v: m.user_id, l: `${m.name}${m.rank_name ? ` (${m.rank_name})` : ''}` }))] }] : []),
        { name: 'kind', label: 'Art', type: 'select', options: Object.entries(ABSENCE).map(([v, [, l]]) => ({ v, l })), value: a?.kind || 'vacation' },
        { name: 'starts_on', label: 'Von', type: 'date', value: a?.starts_on || today, required: true },
        { name: 'ends_on', label: 'Bis', type: 'date', value: a?.ends_on || today, required: true },
        { name: 'note', label: 'Notiz', value: a?.note, maxlength: 1000, full: true },
      ],
      onSubmit: async (v) => {
        const body = { kind: v.kind, starts_on: v.starts_on, ends_on: v.ends_on, note: v.note.trim() };
        if (a) await api.patch(`/absences/${a.id}`, body);
        else await api.post('/absences', { ...body, team_id: teamId, user_id: v.user_id || null });
        toast('Abwesenheit gespeichert');
      },
    });
  };
  function draw() {
    const list = shown();
    el.innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap"><div class="seg" id="ab-when"><button data-w="current" class="${when === 'current' ? 'on' : ''}">Aktuell & geplant</button><button data-w="past" class="${when === 'past' ? 'on' : ''}">Vergangen</button><button data-w="all" class="${when === 'all' ? 'on' : ''}">Alle</button></div>
      <span class="grow"></span>${can('absence:create') ? '<button class="btn sm" id="ab-new">Abwesenheit melden</button>' : ''}</div>
      ${level < 2 ? '<p class="muted">Du siehst nur deine eigenen Abwesenheiten.</p>' : ''}
      <div class="card">${list.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Wer</th><th>Art</th><th>Von</th><th>Bis</th><th>Notiz</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr><td><b>${esc(a.user_name)}</b>${a.starts_on <= today && a.ends_on >= today ? ` ${tag('warn', 'jetzt')}` : ''}</td><td>${tag(...(ABSENCE[a.kind] || ['', a.kind]))}</td><td>${fdate(a.starts_on)}</td><td>${fdate(a.ends_on)}</td><td>${esc(a.note || '')}</td>
        <td style="white-space:nowrap">${a.can_edit ? `<button class="btn ghost sm" data-ab-edit="${a.id}">Bearbeiten</button>` : ''}${a.can_delete ? ` <button class="btn ghost sm" data-ab-del="${a.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Keine Abwesenheiten.')}</div>`;
  }
  async function load() { data = await api.get(`/absences?team_id=${teamId}`); draw(); }
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.w) { when = b.dataset.w; draw(); return; }
      let changed = false;
      if (b.id === 'ab-new') changed = await form(null);
      else if (b.dataset.abEdit) changed = await form(data.items.find((a) => a.id === b.dataset.abEdit));
      else if (b.dataset.abDel && await confirmBox('Abwesenheit löschen', 'Die Abwesenheit wird gelöscht.')) { await api.del(`/absences/${b.dataset.abDel}`); changed = true; }
      if (changed) await load();
    } catch (error) { toast(error.message, true); }
  };
  await load();
}

export async function render(view, params) {
  // Jede Mitgliedschaft genügt: eigene Personalakte und eigene Abwesenheiten sieht jedes Mitglied
  const teams = can('team:read') ? await api.get('/teams?brief=1') : [];
  let teamId = pickTeam(teams, 'personnel', params?.get?.('team'));
  let tab = params?.get?.('tab') || null;
  view.innerHTML = `<div class="page-head"><div><h1>Personal</h1><p>Bewerbungen, Personalakten und Abwesenheiten</p></div><div class="actions">${teamSelect(teams, teamId)}</div></div>
    ${teams.length ? '<div><div class="tabs" id="pe-tabs"></div><div id="pe-body"></div></div>' : noTeam('Personal')}`;
  if (!teams.length) return;
  const tabsFor = (t) => [
    ...((t.is_owner || (t.levels.recruiting || 0) >= 2) && can('recruit:read') && moduleOn('recruiting') ? [['applications', 'Bewerbungen']] : []),
    ...(can('personnel:read') && moduleOn('personnel') ? [['records', 'Personalakte']] : []),
    ...(can('absence:read') && moduleOn('absences') ? [['absences', 'Abwesenheiten']] : []),
  ];
  async function load() {
    const t = teams.find((x) => x.id === teamId);
    const tabs = tabsFor(t);
    if (!tabs.some(([k]) => k === tab)) tab = tabs.find(([k]) => k === 'absences')?.[0] || tabs[0]?.[0];
    $('#pe-tabs', view).innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
    await panel();
  }
  async function panel() {
    const t = teams.find((x) => x.id === teamId);
    const body = $('#pe-body', view);
    body.innerHTML = '<div></div>';
    const el = body.firstChild;
    const lv = (m) => (t.is_owner ? 4 : t.levels[m] || 0);
    if (tab === 'applications') await applicationsPanel(el, teamId, lv('recruiting'));
    else if (tab === 'records') await personnelPanel(el, teamId, t.levels, t.is_owner);
    else if (tab === 'absences') await absencesPanel(el, teamId, lv('absences'));
  }
  $('#pe-tabs', view).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    $('#pe-tabs', view).querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    try { await panel(); } catch (error) { toast(error.message, true); }
  });
  $('#org-team', view)?.addEventListener('change', async (e) => { teamId = e.target.value; rememberTeam('personnel', teamId); await load(); });
  await load();
}
