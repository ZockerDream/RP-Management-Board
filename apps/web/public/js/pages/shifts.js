// Dienstplan (Wunsch des Auftraggebers vom 2026-11-13): Woche mit Schichten, eintragen, tauschen, krank melden,
// Planung aus Vorlagen und „Wer ist im Dienst?“. Funktion „Dienstplan“: 2 sehen und selbst handeln, 3 planen, 4 löschen.
import { api } from '../api.js';
import { $, esc, empty, tag, openForm, confirmBox, toast, todayStr } from '../ui.js';
import { can, state } from '../app.js';
import { loadTeams, pickTeam, rememberTeam, teamSelect, noTeam } from './org-pick.js';
import { toLocalInput, fromLocalInput } from './case-parts.js';

const COLOR = { primary: 'primary', ok: 'ok', warn: 'warn', bad: 'bad', neutral: '' };
const COLOR_LABEL = { primary: 'Blau', ok: 'Grün', warn: 'Gelb', bad: 'Rot', neutral: 'Grau' };
const STATUS = { assigned: ['', 'eingeteilt'], offered: ['warn', 'zum Tausch'], sick: ['bad', 'fällt aus'] };
const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso) => new Date(iso).toLocaleDateString('sv-SE');
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
const weekStartOf = (d) => { const x = new Date(`${d}T12:00:00`); const wd = (x.getDay() + 6) % 7; return addDays(d, -wd); };

export async function render(view, params) {
  const teams = await loadTeams('shifts');
  let teamId = pickTeam(teams, 'shifts', params?.get?.('team'));
  let tab = ['plan', 'now', 'templates'].includes(params?.get?.('tab')) ? params.get('tab') : 'plan';
  let week = weekStartOf(todayStr());
  let data = { shifts: [], absences: [], level: 0 };
  let templates = [];
  let members = null;
  const level = () => teams.find((t) => t.id === teamId)?.level || 0;
  view.innerHTML = `<div class="page-head"><div><h1>Dienstplan</h1><p>Schichten planen, eintragen, tauschen und krank melden</p></div>
    <div class="actions">${teamSelect(teams, teamId)}<span id="s-actions"></span></div></div>
    ${teams.length ? `<div><div class="tabs" id="s-tabs"></div><div id="s-body"></div></div>` : noTeam('den Dienstplan')}`;
  if (!teams.length) return;

  const tabs = () => [['plan', 'Woche'], ['now', 'Im Dienst'], ...(level() >= 3 ? [['templates', 'Vorlagen']] : [])];
  function drawTabs() {
    if (!tabs().some(([k]) => k === tab)) tab = 'plan';
    $('#s-tabs', view).innerHTML = tabs().map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
    $('#s-actions', view).innerHTML = level() >= 3 && can('shift:create') && tab === 'plan' ? '<button class="btn ghost" id="s-one">Einzelne Schicht</button><button class="btn" id="s-plan">Schichten planen</button>' : '';
  }

  function shiftCard(s) {
    const mine = s.mine;
    const plan = level() >= 3;
    const people = s.assignments.map((a) => `<span class="shift-person ${a.user_id === state.me.id ? 'me' : ''}">${esc(a.name)}${a.status !== 'assigned' ? ` ${tag(...STATUS[a.status])}` : ''}
      ${!s.past && a.status === 'offered' && a.user_id !== state.me.id ? `<button class="btn sm" data-take="${a.id}">Übernehmen</button>` : ''}
      ${plan && a.user_id !== state.me.id ? `<button class="icon-x" data-unassign="${a.id}" aria-label="${esc(a.name)} austragen">×</button>` : ''}</span>`).join('');
    const actions = [];
    if (!s.past) {
      if (!mine || mine.status === 'sick') { if (s.free > 0) actions.push(`<button class="btn sm" data-join="${s.id}">Eintragen</button>`); }
      else if (mine.status === 'assigned') {
        if (new Date(s.starts_at) > new Date()) actions.push(`<button class="btn ghost sm" data-offer="${mine.id}">Tausch anbieten</button><button class="btn ghost sm" data-leave="${mine.id}">Austragen</button>`);
        actions.push(`<button class="btn ghost sm" data-sick="${mine.id}">Krank melden</button>`);
      } else if (mine.status === 'offered') actions.push(`<button class="btn ghost sm" data-keep="${mine.id}">Doch selbst arbeiten</button>`);
    }
    if (plan) actions.push(`<button class="btn ghost sm" data-assign="${s.id}">Einteilen</button><button class="btn ghost sm" data-edit="${s.id}">Bearbeiten</button>`);
    if (level() >= 4) actions.push(`<button class="btn ghost sm" data-del="${s.id}">Löschen</button>`);
    return `<article class="card shift-card shift-${s.color} ${s.past ? 'past' : ''} ${mine && mine.status !== 'sick' ? 'mine' : ''}">
      <div class="row" style="align-items:flex-start"><div><b>${esc(s.title)}</b><br><small class="muted">${time(s.starts_at)} – ${time(s.ends_at)}${dayKey(s.ends_at) !== dayKey(s.starts_at) ? ' (+1)' : ''}</small></div>
      ${tag(s.free ? 'warn' : 'ok', `${s.slots - s.free}/${s.slots}`)}</div>
      ${s.note ? `<p class="muted" style="margin:6px 0 0">${esc(s.note)}</p>` : ''}
      <div class="shift-people">${people || '<small class="muted">Noch niemand eingeteilt</small>'}</div>
      ${actions.length ? `<div class="row start" style="gap:6px;flex-wrap:wrap;margin-top:10px">${actions.join('')}</div>` : ''}</article>`;
  }

  async function drawPlan() {
    const to = addDays(week, 6);
    data = await api.get(`/shifts?team_id=${teamId}&from=${week}&to=${to}`);
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
    const away = (d) => data.absences.filter((a) => a.starts_on <= d && a.ends_on >= d);
    const today = todayStr();
    $('#s-body', view).innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-week="-7" aria-label="Vorherige Woche">‹</button>
      <b>${new Date(`${week}T12:00:00`).toLocaleDateString('de-DE')} – ${new Date(`${to}T12:00:00`).toLocaleDateString('de-DE')}</b>
      <button class="btn ghost sm" data-week="7" aria-label="Nächste Woche">›</button><button class="btn ghost sm" data-week="0">Heute</button>
      <span class="grow"></span><small class="muted">${data.shifts.filter((s) => s.mine && s.mine.status !== 'sick').length} eigene Schichten diese Woche</small></div>
      ${days.map((d) => {
        const list = data.shifts.filter((s) => dayKey(s.starts_at) === d);
        const off = away(d);
        return `<section class="shift-day ${d === today ? 'today' : ''}"><h3>${dayLabel(d)}${d === today ? ' · heute' : ''}</h3>
          ${off.length ? `<p class="muted" style="margin:0 0 6px"><small>Abwesend: ${esc(off.map((a) => a.name).join(', '))}</small></p>` : ''}
          ${list.length ? `<div class="shift-grid">${list.map(shiftCard).join('')}</div>` : '<p class="muted" style="margin:0"><small>Keine Schichten</small></p>'}</section>`;
      }).join('')}`;
  }

  async function drawNow() {
    const now = await api.get(`/shifts/now?team_id=${teamId}`);
    $('#s-body', view).innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <div class="card"><div class="card-head"><h2>Laufende Schichten</h2></div>${now.shifts.length ? now.shifts.map((s) => `<div class="list-item"><div class="grow"><b>${esc(s.title)}</b><small>${time(s.starts_at)} – ${time(s.ends_at)}</small></div>
        <div class="chips">${s.people.map((p) => tag('', p.name)).join('') || '<small class="muted">niemand</small>'}</div></div>`).join('') : empty('Gerade läuft keine Schicht.')}</div>
      <div class="card"><div class="card-head"><h2>Eingestempelt</h2><small>Stundenzettel</small></div>${now.clocked.length ? now.clocked.map((c) => `<div class="list-item"><div class="grow"><b>${esc(c.name)}</b><small>${esc(c.rank_name || '')}</small></div>
        ${c.paused_at ? tag('warn', 'Pause') : tag('ok', `seit ${time(c.started_at)}`)}</div>`).join('') : empty('Niemand ist eingestempelt.')}</div></div>`;
  }

  async function drawTemplates() {
    templates = await api.get(`/shift-templates?team_id=${teamId}`);
    $('#s-body', view).innerHTML = `<div class="card"><div class="card-head"><h2>Vorlagen</h2><button class="btn sm" id="t-new">Neue Vorlage</button></div>
      <p class="muted" style="margin-top:0">Aus Vorlagen entstehen mit „Schichten planen“ die Schichten eines Zeitraums. Endet eine Vorlage vor ihrem Beginn (z. B. Nacht 22–06), liegt das Ende am Folgetag.</p>
      <table class="table"><thead><tr><th>Name</th><th>Zeit</th><th>Plätze</th><th>Farbe</th><th></th></tr></thead><tbody>
      ${templates.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${t.starts.slice(0, 5)} – ${t.ends.slice(0, 5)}</td><td>${t.slots}</td><td>${tag(COLOR[t.color], COLOR_LABEL[t.color])}</td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-t-edit="${t.id}">Bearbeiten</button>${level() >= 4 ? ` <button class="btn ghost sm" data-t-del="${t.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const draw = () => (tab === 'now' ? drawNow() : tab === 'templates' ? drawTemplates() : drawPlan());
  async function load() { drawTabs(); await draw(); }

  const templateForm = (t) => openForm({
    title: t ? 'Vorlage bearbeiten' : 'Neue Vorlage',
    fields: [
      { name: 'name', label: 'Name', value: t?.name, required: true, maxlength: 60, placeholder: 'z. B. Früh' },
      { name: 'starts', label: 'Beginn', type: 'time', value: t?.starts?.slice(0, 5) || '06:00', required: true },
      { name: 'ends', label: 'Ende', type: 'time', value: t?.ends?.slice(0, 5) || '14:00', required: true },
      { name: 'slots', label: 'Plätze', type: 'number', min: 1, max: 100, step: 1, value: t?.slots ?? 2 },
      { name: 'color', label: 'Farbe', type: 'select', options: Object.entries(COLOR_LABEL).map(([v, l]) => ({ v, l })), value: t?.color || 'primary' },
      { name: 'sort', label: 'Reihenfolge', type: 'number', step: 1, value: t?.sort ?? 0 },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), starts: v.starts, ends: v.ends, slots: Number(v.slots), color: v.color, sort: Number(v.sort) || 0 };
      if (t) await api.patch(`/shift-templates/${t.id}`, body); else await api.post('/shift-templates', { ...body, team_id: teamId });
    },
  });
  async function planForm() {
    if (!templates.length) templates = await api.get(`/shift-templates?team_id=${teamId}`);
    return openForm({
      title: 'Schichten planen',
      fields: [
        { name: 'from', label: 'Von', type: 'date', value: week, required: true },
        { name: 'to', label: 'Bis', type: 'date', value: addDays(week, 6), required: true },
        { name: 'template_ids', label: 'Vorlagen', type: 'multi', options: templates.map((t) => ({ v: t.id, l: `${t.name} (${t.starts.slice(0, 5)}–${t.ends.slice(0, 5)}, ${t.slots} Plätze)` })), value: templates.map((t) => t.id), full: true },
        { name: 'slots', label: 'Plätze je Schicht (leer = wie Vorlage)', type: 'number', min: 1, max: 100, step: 1 },
      ],
      submit: 'Anlegen',
      onSubmit: async (v) => {
        if (!v.template_ids.length) throw new Error('Wähle mindestens eine Vorlage');
        const r = await api.post('/shifts', { team_id: teamId, from: v.from, to: v.to, template_ids: v.template_ids, slots: v.slots ? Number(v.slots) : null });
        toast(r.created ? `${r.created} Schichten angelegt` : 'Alle Schichten gab es schon');
      },
    });
  }
  const shiftForm = (s) => openForm({
    title: s ? 'Schicht bearbeiten' : 'Einzelne Schicht',
    fields: [
      { name: 'title', label: 'Bezeichnung', value: s?.title, required: true, maxlength: 60, placeholder: 'z. B. Sonderdienst Stadtfest' },
      { name: 'starts_at', label: 'Beginn', type: 'datetime-local', value: toLocalInput(s?.starts_at || `${week}T18:00`), required: true },
      { name: 'ends_at', label: 'Ende', type: 'datetime-local', value: toLocalInput(s?.ends_at || `${week}T22:00`), required: true },
      { name: 'slots', label: 'Plätze', type: 'number', min: 1, max: 100, step: 1, value: s?.slots ?? 2 },
      { name: 'color', label: 'Farbe', type: 'select', options: Object.entries(COLOR_LABEL).map(([v, l]) => ({ v, l })), value: s?.color || 'primary' },
      { name: 'note', label: 'Notiz', value: s?.note, maxlength: 1000, full: true },
    ],
    onSubmit: async (v) => {
      const body = { title: v.title.trim(), starts_at: fromLocalInput(v.starts_at), ends_at: fromLocalInput(v.ends_at), slots: Number(v.slots), color: v.color, note: v.note };
      if (s) await api.patch(`/shifts/${s.id}`, body); else await api.post('/shifts', { ...body, team_id: teamId });
    },
  });
  async function assignForm(s) {
    members = members || await api.get(`/org-members?team_id=${teamId}&module=shifts&min=3`);
    const inShift = new Set(s.assignments.filter((a) => a.status !== 'sick').map((a) => a.user_id));
    const awayIds = new Set(data.absences.filter((a) => a.starts_on <= dayKey(s.starts_at) && a.ends_on >= dayKey(s.starts_at)).map((a) => a.user_id));
    const options = members.filter((m) => !inShift.has(m.user_id)).map((m) => ({ v: m.user_id, l: `${m.name}${m.rank_name ? ` (${m.rank_name})` : ''}${awayIds.has(m.user_id) ? ' – abwesend' : ''}` }));
    if (!options.length) { toast('Alle Mitglieder sind schon eingeteilt', true); return false; }
    return openForm({
      title: `Einteilen: ${s.title} ${time(s.starts_at)}`,
      fields: [{ name: 'user_id', label: 'Mitglied', type: 'select', options }, ...(s.free ? [] : [{ type: 'html', html: '<p class="muted">Alle Plätze sind belegt; einteilen geht trotzdem.</p>' }])],
      submit: 'Einteilen',
      onSubmit: (v) => api.post(`/shifts/${s.id}/assign`, { user_id: v.user_id }),
    });
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !view.contains(b)) return;
    const d = b.dataset;
    const shift = (id) => data.shifts.find((s) => s.id === id);
    try {
      if (b.matches('#s-tabs [data-tab]')) {
        tab = d.tab;
        // Nur den Inhalt neu zeichnen; die Tab-Leiste bleibt stehen
        $('#s-tabs', view).querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        $('#s-actions', view).innerHTML = level() >= 3 && can('shift:create') && tab === 'plan' ? '<button class="btn ghost" id="s-one">Einzelne Schicht</button><button class="btn" id="s-plan">Schichten planen</button>' : '';
        await draw();
        return;
      }
      if (d.week !== undefined) { week = d.week === '0' ? weekStartOf(todayStr()) : addDays(week, Number(d.week)); await drawPlan(); return; }
      let changed = false;
      if (b.id === 's-plan') changed = await planForm();
      else if (b.id === 's-one') changed = await shiftForm(null);
      else if (b.id === 't-new') changed = await templateForm(null);
      else if (d.tEdit) changed = await templateForm(templates.find((t) => t.id === d.tEdit));
      else if (d.tDel && await confirmBox('Vorlage löschen', 'Bestehende Schichten bleiben.')) { await api.del(`/shift-templates/${d.tDel}`); changed = true; }
      else if (d.join) { await api.post(`/shifts/${d.join}/join`); toast('Eingetragen'); changed = true; }
      else if (d.assign) changed = await assignForm(shift(d.assign));
      else if (d.edit) changed = await shiftForm(shift(d.edit));
      else if (d.del && await confirmBox('Schicht löschen', 'Eingeteilte werden benachrichtigt.')) { await api.del(`/shifts/${d.del}`); changed = true; }
      else if (d.offer) {
        changed = await openForm({ title: 'Tausch anbieten', fields: [{ name: 'note', label: 'Hinweis (optional)', maxlength: 500, full: true, placeholder: 'z. B. Termin beim Arzt' }], submit: 'Anbieten',
          onSubmit: (v) => api.post(`/shift-assignments/${d.offer}/offer`, { note: v.note.trim() }) });
        if (changed) toast('Angeboten – alle im Dienstplan wurden benachrichtigt');
      } else if (d.keep) { await api.post(`/shift-assignments/${d.keep}/keep`); changed = true; }
      else if (d.take) { await api.post(`/shift-assignments/${d.take}/take`); toast('Schicht übernommen'); changed = true; }
      else if (d.sick && await confirmBox('Krank melden', 'Dein Platz wird frei, die Planung bekommt eine Nachricht. Gute Besserung!', 'Krank melden')) { await api.post(`/shift-assignments/${d.sick}/sick`); changed = true; }
      else if (d.leave && await confirmBox('Austragen', 'Du wirst aus der Schicht ausgetragen.', 'Austragen')) { await api.del(`/shift-assignments/${d.leave}`); changed = true; }
      else if (d.unassign && await confirmBox('Austragen', 'Das Mitglied wird aus der Schicht ausgetragen und benachrichtigt.', 'Austragen')) { await api.del(`/shift-assignments/${d.unassign}`); changed = true; }
      if (changed) await draw();
    } catch (error) { toast(error.message, true); }
  });
  $('#org-team', view)?.addEventListener('change', async (e) => { teamId = e.target.value; rememberTeam('shifts', teamId); members = null; templates = []; await load(); });
  await load();
}
