import { api } from '../api.js';
import { $, esc, empty, fdate, tag, openForm, confirmBox, toast, todayStr, debounce } from '../ui.js';
import { can } from '../app.js';
import { writableTeams, visibilityField, scopeTag } from './common.js';

export const LICENSE_STATE = {
  valid: ['ok', 'Gültig'], expiring: ['warn', 'Läuft bald ab'], expired: ['bad', 'Abgelaufen'], suspended: ['warn', 'Gesperrt'], revoked: ['bad', 'Entzogen'],
};
const stateTag = (state) => tag(...(LICENSE_STATE[state] || ['', state]));
const sameScope = (a, b) => (a.team_id ? a.team_id === b.team_id : !b.team_id && a.owner_user_id === b.owner_user_id);

const typeForm = (type, teams) => openForm({
  title: type ? 'Lizenzart bearbeiten' : 'Neue Lizenzart',
  fields: [
    { name: 'name', label: 'Name', value: type?.name, required: true, maxlength: 100, placeholder: 'z. B. Führerschein, Waffenschein', full: true },
    { name: 'validity_months', label: 'Standard-Gültigkeit in Monaten', type: 'number', min: 1, step: 1, value: type?.validity_months ?? '', help: 'Leer heißt unbefristet. Neue Lizenzen laufen dann so lange.' },
    ...(type ? [] : [visibilityField(teams, null)]),
    { name: 'description', label: 'Beschreibung', type: 'textarea', value: type?.description, maxlength: 2000, full: true },
  ],
  onSubmit: async (values) => {
    const body = { name: values.name.trim(), description: values.description, validity_months: values.validity_months ? Number(values.validity_months) : null };
    if (type) await api.patch(`/license-types/${type.id}`, body);
    else await api.post('/license-types', { ...body, team_id: values.team_id || null });
    toast('Lizenzart gespeichert');
  },
});

async function licenseForm(license, types, people) {
  const writableTypes = types.filter((t) => t.role !== 'viewer');
  if (!license && !writableTypes.length) { toast('Lege zuerst eine Lizenzart an', true); return false; }
  const type = license ? types.find((t) => t.id === license.type_id) : writableTypes[0];
  const personOptions = (forType) => people.filter((p) => sameScope(forType, p) && (p.active || p.id === license?.person_id)).map((p) => ({ v: p.id, l: p.name }));
  const fields = license ? [
    { type: 'html', html: `<p><b>${esc(license.type_name)}</b> für <b>${esc(license.person_name || 'unbekannte Person')}</b></p>` },
  ] : [
    { name: 'type_id', label: 'Lizenzart', type: 'select', options: writableTypes.map((t) => ({ v: t.id, l: `${t.name}${t.team_name ? ` · ${t.team_name}` : ''}` })), value: type.id },
    { name: 'person_id', label: 'Person', type: 'select', options: personOptions(type), help: 'Personen aus demselben Bereich wie die Lizenzart (Team oder privat).' },
  ];
  fields.push(
    { name: 'number', label: 'Nummer', value: license?.number, maxlength: 60 },
    { name: 'issuer', label: 'Ausgestellt von', value: license?.issuer, maxlength: 100 },
    { name: 'issued_on', label: 'Ausgestellt am', type: 'date', value: license?.issued_on || todayStr(), required: true },
    { name: 'valid_until', label: 'Gültig bis', type: 'date', value: license?.valid_until || '', help: license ? 'Leer heißt unbefristet.' : 'Leer: Standard-Gültigkeit der Lizenzart.' },
    ...(license ? [] : [{ name: 'unlimited', label: 'Unbefristet', type: 'checkbox', value: false }]),
    ...(license ? [
      { name: 'status', label: 'Status', type: 'select', options: [{ v: 'valid', l: 'Gültig' }, { v: 'suspended', l: 'Gesperrt' }, { v: 'revoked', l: 'Entzogen' }], value: license.status },
      { name: 'status_reason', label: 'Begründung (bei gesperrt oder entzogen)', value: license.status_reason, maxlength: 500, full: true },
    ] : []),
    { name: 'note', label: 'Notiz', type: 'textarea', value: license?.note, maxlength: 2000, full: true },
  );
  const result = openForm({
    title: license ? 'Lizenz bearbeiten' : 'Lizenz ausstellen',
    fields,
    onSubmit: async (values) => {
      const body = { number: values.number.trim(), issuer: values.issuer.trim(), issued_on: values.issued_on, note: values.note };
      if (license) {
        Object.assign(body, { valid_until: values.valid_until || null, status: values.status, status_reason: values.status_reason.trim() });
        await api.patch(`/licenses/${license.id}`, body);
      } else {
        if (!values.person_id) throw new Error('Für diese Lizenzart gibt es keine passende Person. Lege sie unter „Personen“ im selben Bereich an.');
        Object.assign(body, { type_id: values.type_id, person_id: values.person_id });
        if (values.unlimited) body.valid_until = null;
        else if (values.valid_until) body.valid_until = values.valid_until;
        await api.post('/licenses', body);
      }
      toast('Lizenz gespeichert');
    },
  });
  // Personen passen zum Bereich der gewählten Lizenzart
  const typeSelect = document.querySelector('#f-type_id');
  typeSelect?.addEventListener('change', () => {
    const chosen = types.find((t) => t.id === typeSelect.value);
    document.querySelector('#f-person_id').innerHTML = personOptions(chosen).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
  });
  return result;
}

export async function render(view) {
  let types = [];
  let licenses = [];
  let people = [];
  const filter = { state: '', type_id: '', q: '' };
  const teams = can('team:read') ? await writableTeams() : [];
  view.innerHTML = `<div class="page-head"><div><h1>Lizenzen</h1><p>Lizenzen von Personen mit Gültigkeit, Sperre und Entzug</p></div>
    <div class="actions">${can('license:create') ? '<button class="btn ghost" id="l-type-new">Neue Lizenzart</button><button class="btn" id="l-new">Lizenz ausstellen</button>' : ''}</div></div>
    <div><div class="tabs"><button data-tab="licenses" class="on">Lizenzen</button><button data-tab="types">Lizenzarten</button></div>
    <div class="tab-panel on" data-panel="licenses">
      <div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="l-search" type="search" class="search" placeholder="Person, Nummer oder Art…" aria-label="Lizenzen durchsuchen">
        <select id="l-state" aria-label="Zustand"><option value="">Alle Zustände</option>${Object.entries(LICENSE_STATE).map(([k, [, l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select id="l-type" aria-label="Lizenzart"></select></div>
      <div class="card" id="l-list"></div></div>
    <div class="tab-panel" data-panel="types"><div class="card" id="l-types"></div></div></div>`;

  const writable = (row) => row.role !== 'viewer';
  function drawTypes() {
    $('#l-type').innerHTML = `<option value="">Alle Lizenzarten</option>${types.map((t) => `<option value="${t.id}" ${filter.type_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}`;
    $('#l-types').innerHTML = types.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Lizenzart</th><th>Gültigkeit</th><th>Lizenzen</th><th>Sichtbarkeit</th><th></th></tr></thead><tbody>
      ${types.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.description ? `<br><small class="muted">${esc(t.description)}</small>` : ''}</td>
        <td>${t.validity_months ? `${t.validity_months} Monate` : 'unbefristet'}</td><td>${t.licenses}</td><td>${scopeTag(t)}</td>
        <td style="white-space:nowrap">${writable(t) && can('license:update') ? `<button class="btn ghost sm" data-type-edit="${t.id}">Bearbeiten</button>` : ''}
        ${writable(t) && can('license:delete') && !t.licenses ? `<button class="btn ghost sm" data-type-del="${t.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Noch keine Lizenzarten. Lege zuerst eine an, z. B. „Führerschein“.');
  }
  function drawLicenses() {
    $('#l-list').innerHTML = licenses.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Person</th><th>Lizenzart</th><th>Nummer</th><th>Ausgestellt</th><th>Gültig bis</th><th>Zustand</th><th></th></tr></thead><tbody>
      ${licenses.map((l) => `<tr><td><b>${esc(l.person_name || '–')}</b></td><td>${esc(l.type_name)}${l.team_name ? `<br><small class="muted">${esc(l.team_name)}</small>` : ''}</td>
        <td>${esc(l.number || '–')}</td><td>${fdate(l.issued_on)}${l.issuer ? `<br><small class="muted">${esc(l.issuer)}</small>` : ''}</td><td>${l.valid_until ? fdate(l.valid_until) : 'unbefristet'}</td>
        <td>${stateTag(l.state)}${l.status_reason ? `<br><small class="muted">${esc(l.status_reason)}</small>` : ''}</td>
        <td style="white-space:nowrap">${writable(l) && can('license:update') ? `<button class="btn ghost sm" data-edit="${l.id}">Bearbeiten</button>${l.validity_months && l.status !== 'revoked' ? ` <button class="btn ghost sm" data-renew="${l.id}">Verlängern</button>` : ''}` : ''}
        ${writable(l) && can('license:delete') ? ` <button class="btn ghost sm" data-del="${l.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty(types.length ? 'Keine passenden Lizenzen.' : 'Noch keine Lizenzarten angelegt.');
  }
  async function load() {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
    [types, licenses] = await Promise.all([api.get('/license-types'), api.get(`/licenses?${qs}`)]);
    drawTypes();
    drawLicenses();
  }
  const loadPeople = async () => { people = can('person:read') ? await api.get('/people') : []; };

  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const license = (key) => licenses.find((l) => l.id === target.dataset[key]);
    try {
      let changed = false;
      if (target.id === 'l-type-new') changed = await typeForm(null, teams);
      else if (target.dataset.typeEdit) changed = await typeForm(types.find((t) => t.id === target.dataset.typeEdit), teams);
      else if (target.dataset.typeDel && await confirmBox('Lizenzart löschen', 'Die Lizenzart wird gelöscht.')) { await api.del(`/license-types/${target.dataset.typeDel}`); changed = true; }
      else if (target.id === 'l-new') { await loadPeople(); changed = await licenseForm(null, types, people); }
      else if (target.dataset.edit) { await loadPeople(); changed = await licenseForm(license('edit'), types, people); }
      else if (target.dataset.renew) {
        const r = await api.post(`/licenses/${target.dataset.renew}/renew`);
        toast(`Verlängert bis ${fdate(r.valid_until)}`);
        changed = true;
      } else if (target.dataset.del && await confirmBox('Lizenz löschen', 'Die Lizenz wird endgültig gelöscht. Für einen Entzug stattdessen den Status ändern.')) {
        await api.del(`/licenses/${target.dataset.del}`);
        changed = true;
      }
      if (changed) await load();
    } catch (error) {
      toast(error.message, true);
    }
  });
  const refilter = async () => { try { await load(); } catch (error) { toast(error.message, true); } };
  $('#l-search', view).addEventListener('input', debounce((event) => { filter.q = event.target.value.trim(); refilter(); }));
  $('#l-state', view).addEventListener('change', (event) => { filter.state = event.target.value; refilter(); });
  $('#l-type', view).addEventListener('change', (event) => { filter.type_id = event.target.value; refilter(); });
  await load();
}
