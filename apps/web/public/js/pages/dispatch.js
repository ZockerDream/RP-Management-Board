// Einsätze & Funk (Wünsche des Auftraggebers vom 2026-11-13): Lage mit Einheiten und Status 1–6, Einsätze mit Verlauf,
// Funkbuch, Einheiten verwalten, Übernahme in eine Fallakte. Aktualisiert die Lage alle 15 Sekunden.
import { api } from '../api.js';
import { $, $$, esc, empty, tag, fdatetime, openForm, confirmBox, toast } from '../ui.js';
import { can } from '../app.js';
import { markdownBlock } from '../markdown.js';
import { loadTeams, pickTeam, rememberTeam, teamSelect, noTeam } from './org-pick.js';

const STATUS_TAG = { 1: 'ok', 2: 'ok', 3: 'warn', 4: 'bad', 5: 'primary', 6: '' };
const PRIO_TAG = { low: '', normal: 'primary', high: 'warn', critical: 'bad' };
const time = (d) => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export async function render(view, params) {
  const teams = await loadTeams('dispatch');
  let teamId = pickTeam(teams, 'dispatch', params?.get?.('team'));
  let tab = ['board', 'incidents', 'log', 'units'].includes(params?.get?.('tab')) ? params.get('tab') : 'board';
  let data = { units: [], incidents: [], statuses: {}, priorities: {}, level: 0 };
  let fleet = null;
  let members = null;
  view.innerHTML = `<div class="page-head"><div><h1>Einsätze & Funk</h1><p>Lage, Einsätze, Status der Einheiten und Funkbuch</p></div>
    <div class="actions">${teamSelect(teams, teamId)}<span id="d-actions"></span></div></div>
    ${teams.length ? `<div><div class="tabs">${[['board', 'Lage'], ['incidents', 'Einsätze'], ['log', 'Funkbuch'], ['units', 'Einheiten']].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="d-body"></div></div>` : noTeam('Einsätze')}`;
  if (!teams.length) return;
  const write = () => data.level >= 3 && can('dispatch:update');

  const statusButtons = (u) => `<div class="fms">${Object.keys(data.statuses).map((s) => `<button class="fms-btn s${s} ${String(u.status) === s ? 'on' : ''}" data-status="${s}" data-unit="${u.id}" title="${esc(data.statuses[s])}" aria-label="Status ${s}: ${esc(data.statuses[s])}">${s}</button>`).join('')}</div>`;
  function unitCard(u) {
    const mayStatus = write() || (u.mine && can('dispatch:read'));
    return `<article class="card unit-card st${u.status} ${u.active ? '' : 'inactive'}"><div class="row" style="align-items:flex-start">
      <div style="min-width:0"><b>${esc(u.callsign)}</b>${u.kind ? ` <small class="muted">${esc(u.kind)}</small>` : ''}<br><small class="muted">${esc(u.crew_names.join(', ') || 'ohne Besatzung')}${u.vehicle_plate ? ` · ${esc(u.vehicle_plate)}` : ''}</small></div>
      <span class="fms-now s${u.status}" title="${esc(data.statuses[u.status])}">${u.status}</span></div>
      <p style="margin:8px 0 0">${tag(STATUS_TAG[u.status], data.statuses[u.status])} <small class="muted">seit ${time(u.status_at)}${u.status_note ? ` · ${esc(u.status_note)}` : ''}</small></p>
      ${u.incident_number ? `<p style="margin:6px 0 0"><button class="btn ghost sm" data-open="${u.incident_id}">${esc(u.incident_number)}: ${esc(u.incident_title)}</button></p>` : ''}
      ${mayStatus && u.active ? statusButtons(u) : ''}</article>`;
  }
  function incidentRow(i) {
    return `<div class="list-item incident ${i.status}"><div class="grow"><b>${esc(i.number)}</b> ${esc(i.title)} ${tag(PRIO_TAG[i.priority], data.priorities[i.priority])}${i.status === 'closed' ? ` ${tag('', 'abgeschlossen')}` : ''}
      <small>${fdatetime(i.started_at)}${i.location ? ` · ${esc(i.location)}` : ''}${i.units.filter((u) => !u.released_at).length ? ` · ${esc(i.units.filter((u) => !u.released_at).map((u) => u.callsign).join(', '))}` : ''}${i.file_number ? ` · Akte ${esc(i.file_number)}` : ''}</small></div>
      <button class="btn ghost sm" data-open="${i.id}">Öffnen</button></div>`;
  }

  async function draw() {
    $('#d-actions', view).innerHTML = write() && can('dispatch:create') ? '<button class="btn" id="d-new">Neuer Einsatz</button>' : '';
    const body = $('#d-body', view);
    if (tab === 'board') {
      const active = data.incidents.filter((i) => i.status === 'active');
      const units = data.units.filter((u) => u.active);
      const free = units.filter((u) => [1, 2].includes(u.status)).length;
      body.innerHTML = `<p class="muted">${free} von ${units.length} Einheiten frei · ${active.length} laufende Einsätze · aktualisiert ${time(new Date())}</p>
        <div class="unit-grid">${units.map(unitCard).join('') || `<div class="card">${empty(data.level >= 4 ? 'Noch keine Einheiten. Lege sie im Tab „Einheiten“ an.' : 'Noch keine Einheiten.')}</div>`}</div>
        <div class="card" style="margin-top:18px"><div class="card-head"><h2>Laufende Einsätze</h2></div>${active.map(incidentRow).join('') || empty('Keine laufenden Einsätze.')}</div>`;
    } else if (tab === 'incidents') {
      body.innerHTML = `<div class="card">${data.incidents.map(incidentRow).join('') || empty('Keine Einsätze in den letzten 7 Tagen.')}</div>`;
    } else if (tab === 'log') {
      const entries = await api.get(`/dispatch-log?team_id=${teamId}`);
      body.innerHTML = `${write() ? `<form class="card toolbar" id="d-msg" style="gap:8px;flex-wrap:wrap;margin-bottom:14px"><select name="unit_id" aria-label="Einheit"><option value="">Leitstelle</option>${data.units.map((u) => `<option value="${u.id}">${esc(u.callsign)}</option>`).join('')}</select>
        <input name="text" required maxlength="2000" placeholder="Funkspruch oder Vermerk…" style="flex:1;min-width:200px" aria-label="Funkspruch"><button class="btn sm">Eintragen</button></form>` : ''}
        <div class="card">${entries.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Zeit</th><th>Einheit</th><th>Eintrag</th><th>Von</th></tr></thead><tbody>
        ${entries.map((e) => `<tr><td style="white-space:nowrap">${fdatetime(e.created_at)}</td><td>${esc(e.callsign || '–')}</td>
          <td>${e.kind === 'status' ? `${tag(STATUS_TAG[e.status], `Status ${e.status}`)} ${esc(data.statuses[e.status])}${e.text ? ` · ${esc(e.text)}` : ''}` : esc(e.text)}${e.incident_number ? ` <small class="muted">(${esc(e.incident_number)})</small>` : ''}</td>
          <td>${esc(e.created_by_name || '–')}</td></tr>`).join('')}</tbody></table></div>` : empty('Das Funkbuch ist leer.')}</div>`;
      $('#d-msg', view)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api.post('/dispatch-log', { team_id: teamId, unit_id: e.target.unit_id.value || null, text: e.target.text.value.trim() }); await draw(); } catch (x) { toast(x.message, true); }
      });
    } else {
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Einheiten</h2>${data.level >= 4 && can('dispatch:create') ? '<button class="btn sm" id="u-new">Neue Einheit</button>' : ''}</div>
        ${data.units.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Rufname</th><th>Art</th><th>Besatzung</th><th>Fahrzeug</th><th>Status</th><th></th></tr></thead><tbody>
        ${data.units.map((u) => `<tr><td><b>${esc(u.callsign)}</b>${u.active ? '' : ` ${tag('', 'außer Dienst')}`}</td><td>${esc(u.kind || '–')}</td><td>${esc(u.crew_names.join(', ') || '–')}</td><td>${esc(u.vehicle_plate || '–')}</td><td>${tag(STATUS_TAG[u.status], `${u.status} ${data.statuses[u.status]}`)}</td>
          <td style="white-space:nowrap">${data.level >= 3 ? `<button class="btn ghost sm" data-u-edit="${u.id}">${data.level >= 4 ? 'Bearbeiten' : 'Besatzung'}</button>` : ''}${data.level >= 4 ? ` <button class="btn ghost sm" data-u-del="${u.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Einheiten.')}</div>`;
    }
  }
  async function load() { data = await api.get(`/dispatch?team_id=${teamId}`); await draw(); }

  async function unitForm(u) {
    members = members || await api.get(`/org-members?team_id=${teamId}&module=dispatch&min=3`);
    if (data.level >= 4 && fleet === null) fleet = await api.get(`/fleet/vehicles?team_id=${teamId}`).catch(() => []);
    const full = data.level >= 4;
    return openForm({
      title: u ? `Einheit ${u.callsign}` : 'Neue Einheit',
      fields: [
        ...(full ? [
          { name: 'callsign', label: 'Rufname', value: u?.callsign, required: true, maxlength: 40, placeholder: 'z. B. Adam-12, RTW 1' },
          { name: 'kind', label: 'Art', value: u?.kind, maxlength: 40, placeholder: 'z. B. Streife, RTW, Heli' },
          { name: 'fleet_vehicle_id', label: 'Fahrzeug (Fuhrpark)', type: 'select', options: [{ v: '', l: '– keins –' }, ...(fleet || []).map((f) => ({ v: f.id, l: `${f.plate}${f.model ? ` (${f.model})` : ''}` }))], value: u?.fleet_vehicle_id || '' },
        ] : []),
        { name: 'crew', label: 'Besatzung', type: 'multi', options: members.map((m) => ({ v: m.user_id, l: m.name })), value: u?.crew || [], full: true },
        ...(full ? [{ name: 'active', label: 'Im Dienst (aus = ausblenden)', type: 'checkbox', value: u ? u.active : true }, { name: 'sort', label: 'Reihenfolge', type: 'number', step: 1, value: u?.sort ?? 0 }] : []),
      ],
      onSubmit: async (v) => {
        const body = full ? { callsign: v.callsign.trim(), kind: v.kind.trim(), fleet_vehicle_id: v.fleet_vehicle_id || null, crew: v.crew, active: v.active, sort: Number(v.sort) || 0 } : { crew: v.crew };
        if (u) await api.patch(`/dispatch-units/${u.id}`, body); else await api.post('/dispatch-units', { ...body, team_id: teamId });
      },
    });
  }
  const incidentForm = (i) => openForm({
    title: i ? `Einsatz ${i.number} bearbeiten` : 'Neuer Einsatz', wide: true,
    fields: [
      { name: 'title', label: 'Stichwort', value: i?.title, required: true, maxlength: 200, full: true, placeholder: 'z. B. Verkehrsunfall mit Verletzten' },
      { name: 'kind', label: 'Art', value: i?.kind, maxlength: 60, placeholder: 'z. B. VU, Raub, Brand' },
      { name: 'priority', label: 'Priorität', type: 'select', options: Object.entries(data.priorities).map(([v, l]) => ({ v, l })), value: i?.priority || 'normal' },
      { name: 'location', label: 'Ort', value: i?.location, maxlength: 200, full: true },
      ...(i ? [] : [{ name: 'unit_ids', label: 'Einheiten alarmieren', type: 'multi', options: data.units.filter((u) => u.active && !u.incident_id).map((u) => ({ v: u.id, l: `${u.callsign} (Status ${u.status})` })), full: true }]),
      { name: 'description', label: 'Lage', type: 'textarea', value: i?.description, maxlength: 20000, full: true, markdown: true, rows: 5 },
    ],
    onSubmit: async (v) => {
      const body = { title: v.title.trim(), kind: v.kind.trim(), priority: v.priority, location: v.location.trim(), description: v.description };
      if (i) { await api.patch(`/incidents/${i.id}`, body); return; }
      const r = await api.post('/incidents', { ...body, team_id: teamId, unit_ids: v.unit_ids });
      toast(`Einsatz ${r.number} angelegt`);
    },
  });

  // Einsatz im Dialog: Verlauf, Einheiten, Funkspruch, abschließen, in Fallakte
  async function openIncident(id) {
    const i = await api.get(`/incidents/${id}`);
    const w = i.level >= 3 && can('dispatch:update');
    const active = i.status === 'active';
    const freeUnits = data.units.filter((u) => u.active && !u.incident_id);
    const pending = openForm({
      title: `${i.number}: ${i.title}`, wide: true, submit: 'Schließen', cancel: 'Abbrechen',
      extraButtons: w ? `${active ? '<button type="button" class="btn ghost" data-i-edit>Bearbeiten</button><button type="button" class="btn danger" data-i-close>Abschließen</button>' : ''}${can('casefile:update') ? '<button type="button" class="btn ghost" data-i-file>In Fallakte</button>' : ''}${i.level >= 4 && !active ? '<button type="button" class="btn danger" data-i-del>Löschen</button>' : ''}` : '',
      fields: [{ type: 'html', html: `<p>${tag(PRIO_TAG[i.priority], data.priorities[i.priority])} ${active ? tag('warn', 'läuft') : tag('', 'abgeschlossen')} · seit ${fdatetime(i.started_at)}${i.closed_at ? ` · Ende ${fdatetime(i.closed_at)}` : ''}${i.location ? ` · ${esc(i.location)}` : ''}${i.case_file ? ` · Akte <a href="#/casefiles?id=${i.case_file.id}">${esc(i.case_file.file_number)}</a>` : ''}</p>
        ${i.description ? markdownBlock(i.description) : ''}
        <h3 style="font-size:13px;margin:12px 0 6px">Einheiten</h3>${i.units.map((u) => `<div class="list-item"><span class="grow"><b>${esc(u.callsign)}</b> <small class="muted">ab ${time(u.assigned_at)}${u.released_at ? ` bis ${time(u.released_at)}` : ''}</small></span>${!u.released_at ? `${tag(STATUS_TAG[u.status], `Status ${u.status}`)}${w && active ? `<button type="button" class="btn ghost sm" data-i-release="${u.unit_id}">Freigeben</button>` : ''}` : ''}</div>`).join('') || '<p class="muted">Keine Einheiten.</p>'}
        ${w && active && freeUnits.length ? `<div class="toolbar" style="gap:8px;margin-top:6px"><select data-i-unit aria-label="Einheit">${freeUnits.map((u) => `<option value="${u.id}">${esc(u.callsign)}</option>`).join('')}</select><button type="button" class="btn ghost sm" data-i-assign>Alarmieren</button></div>` : ''}
        <h3 style="font-size:13px;margin:14px 0 6px">Verlauf</h3><div class="incident-log">${i.entries.map((e) => `<div><small class="muted">${time(e.created_at)}</small> ${e.callsign ? `<b>${esc(e.callsign)}</b> ` : ''}${e.kind === 'status' ? `Status ${e.status} – ${esc(data.statuses[e.status])}` : esc(e.text)} <small class="muted">${esc(e.created_by_name || '')}</small></div>`).join('')}</div>
        ${w && active ? '<div class="toolbar" style="gap:8px;margin-top:8px"><input data-i-text maxlength="2000" placeholder="Lagemeldung, Funkspruch…" style="flex:1" aria-label="Eintrag zum Einsatz"><button type="button" class="btn ghost sm" data-i-log>Eintragen</button></div>' : ''}` }],
      onSubmit: async () => true,
    });
    const m = $('#modals .modal:last-child');
    const reopen = async () => { $('[data-x]', m).click(); await load(); await openIncident(id); };
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.matches('[data-i-assign]')) { await api.post(`/incidents/${id}/units`, { unit_ids: [$('[data-i-unit]', m).value] }); await reopen(); }
        else if (b.dataset.iRelease) { await api.del(`/incidents/${id}/units/${b.dataset.iRelease}`); await reopen(); }
        else if (b.matches('[data-i-log]')) { const t = $('[data-i-text]', m).value.trim(); if (!t) return; await api.post('/dispatch-log', { team_id: teamId, incident_id: id, text: t }); await reopen(); }
        else if (b.matches('[data-i-edit]')) { $('[data-x]', m).click(); if (await incidentForm(i)) await load(); }
        else if (b.matches('[data-i-close]')) {
          $('[data-x]', m).click();
          const ok = await openForm({ title: `Einsatz ${i.number} abschließen`, fields: [{ name: 'note', label: 'Abschlussmeldung', maxlength: 2000, full: true }], submit: 'Abschließen', danger: true,
            onSubmit: (v) => api.post(`/incidents/${id}/close`, { note: v.note.trim() }) });
          if (ok) { toast('Einsatz abgeschlossen, Einheiten frei'); await load(); }
        } else if (b.matches('[data-i-file]')) { $('[data-x]', m).click(); await toCaseFile(i); }
        else if (b.matches('[data-i-del]') && await confirmBox('Einsatz löschen', 'Der Einsatz wird samt Verlauf gelöscht. Ein Eintrag in einer Fallakte bleibt.')) { $('[data-x]', m).click(); await api.del(`/incidents/${id}`); await load(); }
      } catch (error) { toast(error.message, true); }
    });
    return pending;
  }
  async function toCaseFile(i) {
    const files = await api.get('/case-files').catch(() => []);
    const writable = (Array.isArray(files) ? files : files.items || []).filter((f) => f.team_id === teamId && f.level >= 3 && f.status !== 'closed');
    return openForm({
      title: `${i.number} in eine Fallakte`,
      fields: [
        { name: 'case_file_id', label: 'Fallakte', type: 'select', options: [{ v: '', l: '– neue Fallakte anlegen –' }, ...writable.map((f) => ({ v: f.id, l: `${f.file_number} ${f.title}` }))] },
        { type: 'html', html: '<p class="muted">Der Einsatz kommt mit Einheiten und Verlauf als Eintrag „Einsatz“ in die Akte.</p>' },
      ],
      submit: 'Übernehmen',
      onSubmit: async (v) => {
        let fileId = v.case_file_id;
        if (!fileId) fileId = (await api.post('/case-files', { team_id: teamId, title: i.title.slice(0, 200), description: i.description, location: i.location, incident_at: i.started_at, status: 'open' })).id;
        const r = await api.post(`/incidents/${i.id}/case-file`, { case_file_id: fileId });
        toast(`In Akte ${r.file_number} übernommen`);
        await load();
      },
    });
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !view.contains(b)) return;
    const d = b.dataset;
    try {
      if (b.matches('.tabs [data-tab]')) { tab = d.tab; await draw(); return; }
      let changed = false;
      if (b.id === 'd-new') changed = await incidentForm(null);
      else if (b.id === 'u-new') changed = await unitForm(null);
      else if (d.uEdit) changed = await unitForm(data.units.find((u) => u.id === d.uEdit));
      else if (d.uDel && await confirmBox('Einheit löschen', 'Die Einheit wird gelöscht; das Funkbuch behält ihre Einträge ohne Rufnamen.')) { await api.del(`/dispatch-units/${d.uDel}`); changed = true; }
      else if (d.status) { await api.put(`/dispatch-units/${d.unit}/status`, { status: Number(d.status) }); changed = true; }
      else if (d.open) { await openIncident(d.open); return; }
      if (changed) await load();
    } catch (error) { toast(error.message, true); }
  });
  $('#org-team', view)?.addEventListener('change', async (e) => { teamId = e.target.value; rememberTeam('dispatch', teamId); fleet = null; members = null; await load(); });
  // Lage regelmäßig aktualisieren, solange die Seite offen ist und kein Dialog stört
  const timer = setInterval(() => {
    if (!view.isConnected) { clearInterval(timer); return; }
    if (document.hidden || tab !== 'board' || $('#modals .modal')) return;
    load().catch(() => {});
  }, 15000);
  await load();
}
