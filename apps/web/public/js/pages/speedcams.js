// Blitzer (Wunsch des Auftraggebers vom 2026-11-13): systemweit, Rechte über die Rollenrechte speedcam:*.
// Standorte und Blitzer-Rechnungen; aus einer Rechnung entsteht ein Eintrag in der Personenakte des Halters.
import { api } from '../api.js';
import { $, esc, empty, tag, eur, fdatetime, openForm, confirmBox, toast, debounce, parseAmount } from '../ui.js';
import { can } from '../app.js';
import { orgsWithLevel } from './common.js';
import { toLocalInput, fromLocalInput } from './case-parts.js';

const STATUS = { open: ['warn', 'Offen'], paid: ['ok', 'Bezahlt'], cancelled: ['', 'Storniert'] };
const KIND = { fixed: 'Fest', mobile: 'Mobil' };
const statusTag = (s) => tag(...(STATUS[s] || ['', s]));
const opt = (map) => Object.entries(map).map(([v, x]) => ({ v, l: Array.isArray(x) ? x[1] : x }));

const cameraForm = (camera) => openForm({
  title: camera ? 'Standort bearbeiten' : 'Neuer Blitzer-Standort',
  fields: [
    { name: 'name', label: 'Name', value: camera?.name, required: true, maxlength: 100, placeholder: 'z. B. Highway Nord' },
    { name: 'kind', label: 'Art', type: 'select', options: opt(KIND), value: camera?.kind || 'fixed' },
    { name: 'location', label: 'Ort', value: camera?.location, maxlength: 200, full: true, placeholder: 'Straße, Kreuzung, Postleitzahl…' },
    { name: 'speed_limit', label: 'Erlaubt (km/h)', type: 'number', min: 1, max: 400, step: 1, value: camera?.speed_limit ?? 50, required: true },
    { name: 'active', label: 'Aktiv', type: 'checkbox', value: camera ? camera.active : true },
    { name: 'note', label: 'Notiz', type: 'textarea', value: camera?.note, maxlength: 2000, full: true },
  ],
  onSubmit: async (v) => {
    const body = { name: v.name.trim(), kind: v.kind, location: v.location.trim(), speed_limit: Number(v.speed_limit), active: v.active, note: v.note };
    if (camera) await api.patch(`/speed-cameras/${camera.id}`, body);
    else await api.post('/speed-cameras', body);
    toast('Standort gespeichert');
  },
});

async function ticketForm(ticket, cameras, people) {
  const usable = cameras.filter((c) => c.active || c.id === ticket?.camera_id);
  if (!usable.length) { toast('Lege zuerst einen aktiven Standort an', true); return false; }
  const showPeople = can('person:read');
  const personOptions = [{ v: '', l: '– automatisch aus dem Fahrzeug –' }, ...people.filter((p) => p.active || p.id === ticket?.person_id).map((p) => ({ v: p.id, l: p.name }))];
  const first = usable.find((c) => c.id === ticket?.camera_id) || usable[0];
  const done = openForm({
    title: ticket ? `Rechnung ${ticket.number} bearbeiten` : 'Neue Blitzer-Rechnung',
    fields: [
      { name: 'camera_id', label: 'Standort', type: 'select', options: usable.map((c) => ({ v: c.id, l: `${c.name} (${c.speed_limit} km/h)${c.active ? '' : ' – abgeschaltet'}` })), value: first.id, full: true },
      { name: 'measured_at', label: 'Zeitpunkt', type: 'datetime-local', value: toLocalInput(ticket?.measured_at || new Date().toISOString()), required: true },
      { name: 'plate', label: 'Kennzeichen', value: ticket?.plate, required: true, maxlength: 20 },
      { type: 'html', html: '<p class="muted" id="st-lookup" style="margin:-4px 0 0"></p>' },
      ...(showPeople ? [{ name: 'person_id', label: 'Halter', type: 'select', options: personOptions, value: ticket?.person_id || '', full: true, help: 'Leer: Besitzer des Fahrzeugs mit diesem Kennzeichen, soweit du es sehen darfst.' }] : []),
      { name: 'measured_kmh', label: 'Gemessen (km/h)', type: 'number', min: 1, max: 1000, step: 1, value: ticket?.measured_kmh ?? '', required: true },
      { name: 'speed_limit', label: 'Erlaubt (km/h)', type: 'number', min: 1, max: 400, step: 1, value: ticket?.speed_limit ?? first.speed_limit, required: true },
      { name: 'tolerance_kmh', label: 'Toleranz (km/h)', type: 'number', min: 0, max: 100, step: 1, value: ticket?.tolerance_kmh ?? 3 },
      { name: 'amount', label: 'Betrag', value: ticket ? String(ticket.amount).replace('.', ',') : '', required: true, placeholder: '0,00' },
      ...(ticket ? [{ name: 'status', label: 'Status', type: 'select', options: opt(STATUS), value: ticket.status }] : []),
      { name: 'note', label: 'Notiz', type: 'textarea', value: ticket?.note, maxlength: 2000, full: true },
    ],
    onSubmit: async (v) => {
      const body = {
        camera_id: v.camera_id, measured_at: fromLocalInput(v.measured_at), plate: v.plate.trim(), measured_kmh: Number(v.measured_kmh),
        speed_limit: Number(v.speed_limit), tolerance_kmh: Number(v.tolerance_kmh || 0), amount: parseAmount(v.amount || '0'), note: v.note,
      };
      if (showPeople && (!ticket || v.person_id !== (ticket.person_id || ''))) body.person_id = v.person_id || null;
      if (ticket) {
        body.status = v.status;
        await api.patch(`/speed-tickets/${ticket.id}`, body);
      } else {
        const r = await api.post('/speed-tickets', body);
        toast(`Rechnung ${r.number} angelegt`);
        return;
      }
      toast('Rechnung gespeichert');
    },
  });
  // Formular ist jetzt im DOM: Standort setzt das erlaubte Tempo, Kennzeichen zeigt Fahrzeug und Halter
  const m = $('#modals .modal:last-child');
  const limit = $('[name=speed_limit]', m);
  $('[name=camera_id]', m).addEventListener('change', (e) => { const c = cameras.find((x) => x.id === e.target.value); if (c) limit.value = c.speed_limit; });
  const hint = $('#st-lookup', m);
  const lookup = debounce(async (plate) => {
    if (!plate) { hint.textContent = ''; return; }
    try {
      const r = await api.get(`/speed-tickets/lookup?plate=${encodeURIComponent(plate)}`);
      hint.textContent = r.vehicle ? `Fahrzeug: ${r.vehicle.make_model || r.vehicle.plate}${r.person ? ` · Halter: ${r.person.name}` : ' · kein Halter hinterlegt'}` : 'Kein bekanntes Fahrzeug mit diesem Kennzeichen.';
    } catch { hint.textContent = ''; }
  }, 350);
  $('[name=plate]', m).addEventListener('input', (e) => lookup(e.target.value.trim()));
  if (ticket?.plate) lookup(ticket.plate);
  return done;
}

async function entryForm(ticket) {
  const teams = await orgsWithLevel('casefile', 3);
  return openForm({
    title: 'Akteneintrag erstellen',
    fields: [
      { type: 'html', html: `<p>Die Rechnung <b>${esc(ticket.number)}</b> wird als Eintrag „Blitzer“ in die Personenakte von <b>${esc(ticket.person_name || 'Halter')}</b> übernommen.</p>` },
      { name: 'team_id', label: 'Bereich der Personenakte', type: 'select', options: [{ v: '', l: 'Privat (nur ich)' }, ...teams.map((t) => ({ v: t.id, l: t.name }))], value: teams[0]?.id || '', full: true },
    ],
    submit: 'Eintrag erstellen',
    onSubmit: async (v) => {
      const r = await api.post(`/speed-tickets/${ticket.id}/file-entry`, { team_id: v.team_id || null });
      toast('Akteneintrag erstellt');
      return { ...r, area: v.team_id || '' };
    },
  });
}

export async function render(view) {
  let cameras = [];
  let tickets = [];
  let people = [];
  const filter = { status: '', camera_id: '', q: '' };
  const canEntry = can('casefile:update') && can('person:read');
  view.innerHTML = `<div class="page-head"><div><h1>Blitzer</h1><p>Blitzer-Standorte und Rechnungen, auf Knopfdruck in die Personenakte</p></div>
    <div class="actions">${can('speedcam:create') ? '<button class="btn ghost" id="sc-cam-new">Neuer Standort</button><button class="btn" id="sc-new">Neue Rechnung</button>' : ''}</div></div>
    <div><div class="tabs"><button data-tab="tickets" class="on">Rechnungen</button><button data-tab="cameras">Standorte</button></div>
    <div class="tab-panel on" data-panel="tickets">
      <div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="sc-q" type="search" class="search" placeholder="Kennzeichen, Nummer, Halter…" aria-label="Rechnungen durchsuchen">
        <select id="sc-status" aria-label="Status"><option value="">Alle Status</option>${opt(STATUS).map((o) => `<option value="${o.v}">${o.l}</option>`).join('')}</select>
        <select id="sc-cam" aria-label="Standort"></select></div>
      <div class="card" id="sc-list"></div></div>
    <div class="tab-panel" data-panel="cameras"><div class="card" id="sc-cams"></div></div></div>`;

  function drawCameras() {
    $('#sc-cam', view).innerHTML = `<option value="">Alle Standorte</option>${cameras.map((c) => `<option value="${c.id}" ${filter.camera_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
    $('#sc-cams', view).innerHTML = cameras.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Standort</th><th>Art</th><th>Erlaubt</th><th>Rechnungen</th><th>Status</th><th></th></tr></thead><tbody>
      ${cameras.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.location ? `<br><small class="muted">${esc(c.location)}</small>` : ''}${c.note ? `<br><small class="muted">${esc(c.note)}</small>` : ''}</td>
        <td>${KIND[c.kind]}</td><td>${c.speed_limit} km/h</td><td>${c.tickets}</td><td>${c.active ? tag('ok', 'Aktiv') : tag('', 'Abgeschaltet')}</td>
        <td style="white-space:nowrap">${can('speedcam:update') ? `<button class="btn ghost sm" data-cam-edit="${c.id}">Bearbeiten</button>` : ''}
        ${can('speedcam:delete') && !c.tickets ? ` <button class="btn ghost sm" data-cam-del="${c.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Noch keine Standorte. Lege zuerst einen an, z. B. „Highway Nord, 120 km/h“.');
  }
  function entryCell(t) {
    if (t.has_entry) return `${tag('primary', 'In der Akte')}${t.person_id && can('casefile:read') ? `<br><a href="#/casefiles?person=${t.person_id}&area=${t.entry_team_id || ''}" class="muted"><small>Personenakte</small></a>` : ''}`;
    if (!t.has_person) return '<small class="muted">kein Halter</small>';
    return canEntry ? `<button class="btn ghost sm" data-entry="${t.id}">Akteneintrag</button>` : '–';
  }
  function drawTickets() {
    $('#sc-list', view).innerHTML = tickets.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Rechnung</th><th>Zeitpunkt</th><th>Standort</th><th>Kennzeichen</th><th>Halter</th><th>Gemessen</th><th>Betrag</th><th>Status</th><th>Akte</th><th></th></tr></thead><tbody>
      ${tickets.map((t) => `<tr><td><b>${esc(t.number)}</b></td><td>${fdatetime(t.measured_at)}</td><td>${esc(t.camera_name)}</td><td>${esc(t.plate)}</td>
        <td>${t.person_name ? esc(t.person_name) : t.has_person ? '<small class="muted">verborgen</small>' : '–'}</td>
        <td>${t.measured_kmh} / ${t.speed_limit} km/h<br><small class="${t.over_kmh ? '' : 'muted'}">${t.over_kmh ? `+${t.over_kmh} km/h` : 'keine Überschreitung'}${t.tolerance_kmh ? ` (Toleranz ${t.tolerance_kmh})` : ''}</small></td>
        <td>${eur(t.amount)}</td><td>${statusTag(t.status)}</td><td>${entryCell(t)}</td>
        <td style="white-space:nowrap">${can('speedcam:update') ? `<button class="btn ghost sm" data-edit="${t.id}">Bearbeiten</button>` : ''}
          ${can('speedcam:update') && t.status === 'open' ? ` <button class="btn ghost sm" data-paid="${t.id}">Bezahlt</button>` : ''}
          ${can('speedcam:delete') ? ` <button class="btn ghost sm" data-del="${t.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty(cameras.length ? 'Keine passenden Rechnungen.' : 'Noch keine Standorte angelegt.');
  }
  async function load() {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    [cameras, tickets] = await Promise.all([api.get('/speed-cameras'), api.get(`/speed-tickets?${qs}`)]);
    drawCameras();
    drawTickets();
  }
  const loadPeople = async () => { people = can('person:read') && !people.length ? await api.get('/people') : people; };

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ticket = (k) => tickets.find((t) => t.id === b.dataset[k]);
    try {
      let changed = false;
      if (b.id === 'sc-cam-new') changed = await cameraForm(null);
      else if (b.dataset.camEdit) changed = await cameraForm(cameras.find((c) => c.id === b.dataset.camEdit));
      else if (b.dataset.camDel && await confirmBox('Standort löschen', 'Der Standort wird gelöscht.')) { await api.del(`/speed-cameras/${b.dataset.camDel}`); changed = true; }
      else if (b.id === 'sc-new') { await loadPeople(); changed = await ticketForm(null, cameras, people); }
      else if (b.dataset.edit) { await loadPeople(); changed = await ticketForm(ticket('edit'), cameras, people); }
      else if (b.dataset.paid) { await api.patch(`/speed-tickets/${b.dataset.paid}`, { status: 'paid' }); toast('Als bezahlt markiert'); changed = true; }
      else if (b.dataset.entry) changed = await entryForm(ticket('entry'));
      else if (b.dataset.del && await confirmBox('Rechnung löschen', 'Die Blitzer-Rechnung wird endgültig gelöscht. Ein schon erstellter Akteneintrag bleibt bestehen.')) {
        await api.del(`/speed-tickets/${b.dataset.del}`);
        changed = true;
      }
      if (changed) await load();
    } catch (error) {
      toast(error.message, true);
    }
  });
  const refilter = async () => { try { await load(); } catch (error) { toast(error.message, true); } };
  $('#sc-q', view).addEventListener('input', debounce((e) => { filter.q = e.target.value.trim(); refilter(); }));
  $('#sc-status', view).addEventListener('change', (e) => { filter.status = e.target.value; refilter(); });
  $('#sc-cam', view).addEventListener('change', (e) => { filter.camera_id = e.target.value; refilter(); });
  await load();
}
