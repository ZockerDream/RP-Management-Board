import { api } from '../api.js';
import { $, esc, eur, fdate, fdatetime, empty, debounce, openForm, confirmBox, toast, parseAmount, todayStr, showSecret } from '../ui.js';
import { loadBudgets } from './common.js';
import { can, state } from '../app.js';
import { openGalleryModal } from '../gallery.js';

const STATUS = { available: ['ok', 'Verfügbar'], out: ['warn', 'Ausgegeben'], overdue: ['bad', 'Überfällig'], lost: ['bad', 'Verloren'] };
const VSTATUS = { available: 'Verfügbar', in_use: 'Im Einsatz', workshop: 'Werkstatt', retired: 'Ausgemustert' };
const PTYPE = { home: 'Wohnung/Haus', office: 'Büro', storage: 'Lager', holiday: 'Ferienobjekt' };
const INTERVAL = { once: 'Einmalig', daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich', yearly: 'Jährlich', custom: 'Benutzerdefiniert (Tage)' };
const INTERVAL_UNITS = { daily: 'Tage', weekly: 'Wochen', monthly: 'Monate', yearly: 'Jahre', custom: 'Tage' };
const EVENT = { issued: 'Ausgegeben', returned: 'Zurückgegeben', lost: 'Als verloren gemeldet' };
const ASSET_TYPE = { house: 'Haus', vehicle: 'Fahrzeug', key: 'Schlüssel' };

const costFields = (o, budgets) => [
  { type: 'html', html: '<div class="cost-block"><b>Laufende Kosten (optional)</b><p class="muted">Werden automatisch als Buchung bzw. Dauerauftrag im gewählten Konto geführt.</p></div>' },
  { name: 'cost_amount', label: 'Betrag', value: o?.cost_amount ? String(o.cost_amount).replace('.', ',') : '' },
  { name: 'cost_interval', label: 'Intervall', type: 'select', options: Object.entries(INTERVAL).map(([v, l]) => ({ v, l })), value: o?.cost_interval || 'monthly' },
  { name: 'cost_interval_count', label: 'Alle … Einheiten', type: 'number', min: 1, max: 3650, value: o?.cost_interval_count || 1 },
  { name: 'cost_budget_id', label: 'Konto', type: 'select', options: [{ v: '', l: '– Keines –' }, ...budgets.map((b) => ({ v: b.id, l: b.name }))], value: o?.cost_budget_id || '' },
  { name: 'cost_category_id', label: 'Kategorie', type: 'select', options: [{ v: '', l: '– Keine –' }, ...budgets.flatMap((b) => b.categories.map((c) => ({ v: c.id, l: `${b.name} › ${c.name}` })))], value: o?.cost_category_id || '' },
  { name: 'cost_tracking', label: 'Kosten im Konto verbuchen', type: 'checkbox', value: o ? o.cost_tracking !== false : true },
];
const costBody = (v) => ({
  cost_amount: v.cost_amount ? parseAmount(v.cost_amount) : null, cost_interval: v.cost_amount ? v.cost_interval : null,
  cost_interval_count: v.cost_amount ? (Number(v.cost_interval_count) || 1) : 1,
  cost_budget_id: v.cost_amount ? v.cost_budget_id || null : null, cost_category_id: v.cost_amount ? v.cost_category_id || null : null, cost_tracking: v.cost_tracking,
});
const costForm = (options) => {
  const dialog = openForm(options);
  const interval = $('#f-cost_interval');
  const countInput = $('#f-cost_interval_count');
  const count = countInput?.closest('label');
  let selectedInterval = interval?.value;
  const update = () => {
    if (count) {
      count.hidden = interval.value === 'once' || (interval.value !== 'custom' && Number(countInput.value) <= 1);
      count.firstChild.textContent = `Alle … ${INTERVAL_UNITS[interval.value] || 'Einheiten'}`;
    }
  };
  interval?.addEventListener('change', () => {
    if (interval.value !== selectedInterval && interval.value !== 'custom') countInput.value = '1';
    selectedInterval = interval.value;
    update();
  });
  update();
  return dialog;
};
const costIntervalText = (interval, count) => interval === 'custom'
  ? `alle ${count || 1} Tage`
  : Number(count) > 1
    ? `alle ${count} ${INTERVAL_UNITS[interval] || 'Einheiten'}`
    : INTERVAL[interval] || '–';
const save = (path, o, body) => (o ? api.patch(`/${path}/${o.id}`, body) : api.post(`/${path}`, body));
// Organisationen, in denen die Person diese Objektart anlegen und ändern darf
async function ownershipFields(o, module) {
  const teams = can('team:read') ? (await api.get('/teams?brief=1')).filter((team) => team.levels[module] >= 3) : [];
  if (o?.team_id && !teams.some((team) => team.id === o.team_id)) teams.push({ id: o.team_id, name: o.team_name || 'Organisation' });
  return [
    { name: 'scope', label: 'Sichtbarkeit', type: 'select', options: [{ v: 'personal', l: 'Privat' }, ...(teams.length ? [{ v: 'team', l: 'Organisation' }] : [])], value: o?.team_id ? 'team' : 'personal' },
    { name: 'team_id', label: 'Organisation', type: 'select', options: [{ v: '', l: '–' }, ...teams.map((team) => ({ v: team.id, l: team.name }))], value: o?.team_id || '' },
  ];
}
const ownershipBody = (v) => ({ scope: v.scope, team_id: v.scope === 'team' ? v.team_id || null : null });

async function formProperty(o, people) {
  const budgets = await loadBudgets();
  const ownership = await ownershipFields(o, 'property');
  return costForm({
    title: o ? 'Haus bearbeiten' : 'Neues Haus / Objekt', wide: true, fields: [
      { name: 'name', label: 'Name', value: o?.name, required: true },
      { name: 'type', label: 'Art', type: 'select', options: Object.entries(PTYPE).map(([v, l]) => ({ v, l })), value: o?.type || 'home' },
      { name: 'address', label: 'Adresse', value: o?.address, full: true },
      { name: 'responsible_person_id', label: 'Verantwortlich', type: 'select', options: [{ v: '', l: '–' }, ...people.map((p) => ({ v: p.id, l: p.name }))], value: o?.responsible_person_id || '' },
      { name: 'maintenance_due', label: 'Wartung fällig', type: 'date', value: o?.maintenance_due?.slice(0, 10) },
      { name: 'maintenance_note', label: 'Wartungshinweis', value: o?.maintenance_note, full: true },
      { name: 'note', label: 'Notiz', type: 'textarea', value: o?.note, full: true },
      ...ownership,
      ...costFields(o, budgets),
    ],
    onSubmit: (v) => save('properties', o, { name: v.name.trim(), type: v.type, address: v.address, responsible_person_id: v.responsible_person_id || null, maintenance_due: v.maintenance_due || null, maintenance_note: v.maintenance_note, note: v.note, ...ownershipBody(v), ...costBody(v) }),
  });
}
// Besitzer aus der Personenliste: Das Fahrzeug erscheint dann in seiner Personenakte. Inaktive Personen nur, wenn schon gewählt.
function ownerOptions(o, people) {
  const options = people.filter((p) => p.active || p.id === o?.owner_person_id).map((p) => ({ v: p.id, l: `${p.name}${p.function ? ` · ${p.function}` : ''}` }));
  if (o?.owner_person_id && !options.some((option) => option.v === o.owner_person_id)) options.push({ v: o.owner_person_id, l: o.owner_person_name || 'Person' });
  return [{ v: '', l: '– keine Person –' }, ...options];
}
async function formVehicle(o, people) {
  const budgets = await loadBudgets();
  const ownership = await ownershipFields(o, 'vehicle');
  const dialog = costForm({
    title: o ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug', wide: true, fields: [
      { name: 'plate', label: 'Kennzeichen', value: o?.plate, required: true },
      { name: 'make_model', label: 'Marke / Modell', value: o?.make_model, required: true },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(VSTATUS).map(([v, l]) => ({ v, l })), value: o?.status || 'available', help: 'Ausgemusterte Fahrzeuge geben ihr Kennzeichen frei und fehlen im Dashboard.' },
      { name: 'owner_person_id', label: 'Besitzer (Person)', type: 'select', options: ownerOptions(o, people), value: o?.owner_person_id || '', help: 'Das Fahrzeug erscheint automatisch in der Personenakte.' },
      { name: 'registered_owner', label: 'Besitzer ohne Personeneintrag', value: o?.registered_owner, maxlength: 100, full: true, help: 'Nur nötig, wenn der Besitzer nicht in der Personenliste steht.' },
      { name: 'service_due', label: 'Service fällig', type: 'date', value: o?.service_due?.slice(0, 10) },
      { name: 'odometer_km', label: 'Kilometerstand', type: 'number', min: 0, value: o?.odometer_km },
      { name: 'service_interval_km', label: 'Service-Intervall (km)', type: 'number', min: 1, value: o?.service_interval_km },
      { name: 'service_due_km', label: 'Service fällig bei (km)', type: 'number', min: 0, value: o?.service_due_km },
      { name: 'first_aid_kit_expires_on', label: 'Verbandskasten gültig bis', type: 'date', value: o?.first_aid_kit_expires_on?.slice(0, 10) },
      { name: 'note', label: 'Notiz', type: 'textarea', value: o?.note, full: true },
      ...ownership,
      ...costFields(o, budgets),
    ],
    onSubmit: (v) => {
      const odometerKm = v.odometer_km === '' ? null : Number(v.odometer_km);
      const serviceIntervalKm = v.service_interval_km === '' ? null : Number(v.service_interval_km);
      const serviceDueKm = v.service_due_km === ''
        ? (odometerKm !== null && serviceIntervalKm !== null ? odometerKm + serviceIntervalKm : null)
        : Number(v.service_due_km);
      return save('vehicles', o, { plate: v.plate.trim(), make_model: v.make_model.trim(), status: v.status, owner_person_id: v.owner_person_id || null, registered_owner: v.owner_person_id ? '' : v.registered_owner.trim(), service_due: v.service_due || null, odometer_km: odometerKm, service_interval_km: serviceIntervalKm, service_due_km: serviceDueKm, first_aid_kit_expires_on: v.first_aid_kit_expires_on || null, note: v.note, ...ownershipBody(v), ...costBody(v) });
    },
  });
  // Freitext nur ohne gewählte Person
  const person = $('#f-owner_person_id');
  const text = $('#f-registered_owner')?.closest('label');
  const toggle = () => { if (text) text.hidden = Boolean(person?.value); };
  person?.addEventListener('change', toggle);
  toggle();
  return dialog;
}
async function formKey(o, props, vehicles) {
  const budgets = await loadBudgets();
  const ownership = await ownershipFields(o, 'key');
  return costForm({
    title: o ? 'Schlüssel bearbeiten' : 'Neuer Schlüssel', wide: true, fields: [
      { name: 'code', label: 'Schlüssel-Nr.', value: o?.code, required: true },
      { name: 'label', label: 'Bezeichnung', value: o?.label, required: true },
      { name: 'kind', label: 'Art (frei definierbar)', value: o?.kind || 'Haustür', placeholder: 'z. B. Haustür, Briefkasten, eigener Schlüsseltyp' },
      { name: 'copies', label: 'Anzahl Kopien', type: 'number', min: 1, value: o?.copies || 1 },
      { name: 'property_id', label: 'Haus', type: 'select', options: [{ v: '', l: '–' }, ...props.map((p) => ({ v: p.id, l: p.name }))], value: o?.property_id || '' },
      { name: 'vehicle_id', label: 'Fahrzeug', type: 'select', options: [{ v: '', l: '–' }, ...vehicles.map((p) => ({ v: p.id, l: `${p.make_model} (${p.plate})` }))], value: o?.vehicle_id || '' },
      { name: 'note', label: 'Notiz', type: 'textarea', value: o?.note, full: true },
      ...ownership,
      ...costFields(o, budgets),
    ],
    onSubmit: (v) => save('keys', o, { code: v.code.trim(), label: v.label.trim(), kind: v.kind, copies: Number(v.copies) || 1, property_id: v.property_id || null, vehicle_id: v.vehicle_id || null, note: v.note, ...ownershipBody(v), ...costBody(v) }),
  });
}

// Stufe in der Organisation: ändern ab „Lesen & Schreiben“, löschen mit „Verwalten“; dazu die allgemeinen Rechte der Rolle.
// Personen werden seit 2026-11-10 nur noch unter „Akten → Personenakten“ gepflegt (person-files.js).
const writable = (item) => item.level >= 3;
const actions = (item, perm) => {
  const edit = can(`${perm}:update`) && writable(item);
  const del = can(`${perm}:delete`) && item.level >= 4;
  return `${edit ? `<button class="btn ghost sm" data-edit="${item.id}">Bearbeiten</button>` : ''}${del ? ` <button class="btn ghost sm" data-del="${item.id}">Löschen</button>` : ''}`;
};

const SECTIONS = {
  vehicles: { title: 'Fahrzeuge', desc: 'Fuhrpark, Service und Kosten', tabs: [['vehicles', 'Fahrzeuge']] },
  properties: { title: 'Häuser', desc: 'Häuser, Wohnungen und Wartung', tabs: [['properties', 'Häuser']] },
  keys: { title: 'Schlüssel', desc: 'Schlüsselbestand und Ausgabe', tabs: [['keys', 'Schlüssel']] },
  manage: { title: 'Verwaltung', desc: 'Übersicht, Kosten, Protokoll und Auditlog', tabs: [['overview', 'Übersicht'], ['costs', 'Kosten'], ['log', 'Protokoll'], ['audit', 'Auditlog']] },
};
const LEGACY_TAB = { overview: 'manage', costs: 'manage', log: 'manage', audit: 'manage' };

export async function render(view, params, section) {
  const D = {};
  const initialFilter = (params?.get('filter') || '').match(/^(house|vehicle):([0-9a-f-]{36})$/i);
  let keyFilter = initialFilter ? { type: initialFilter[1], id: initialFilter[2] } : null;
  let scannerActive = false;
  let cameraStream = null;
  const legacy = params?.get('tab');
  // Die Seite „Personen“ ist ausgeblendet (Wunsch des Auftraggebers vom 2026-11-10): alte Links führen zu den Personenakten
  if (section === 'people' || (!section && legacy === 'people')) { location.replace('#/casefiles?tab=people'); return; }
  if (!SECTIONS[section]) section = SECTIONS[legacy] ? legacy : LEGACY_TAB[legacy] || 'vehicles';
  const meta = SECTIONS[section];
  const perms = { keys: 'key:read', properties: 'property:read', vehicles: 'vehicle:read', audit: 'audit:read' };
  const tabs = meta.tabs.filter(([k]) => can(perms[k] || 'key:read') || k === 'overview');
  const initial = tabs.some(([k]) => k === legacy) ? legacy : tabs[0]?.[0];
  view.innerHTML = `<div class="page-head"><div><h1>${meta.title}</h1><p>${meta.desc}</p></div><div class="actions" id="a-actions"></div></div>
    <div><div class="tabs" ${tabs.length < 2 ? 'hidden' : ''}>${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === initial ? 'on' : ''}">${l}</button>`).join('')}</div>${tabs.map(([k]) => `<div class="tab-panel ${k === initial ? 'on' : ''}" data-panel="${k}"></div>`).join('')}</div>`;
  if (!tabs.length) { view.innerHTML += `<div class="card"><p class="muted">Keine Berechtigung.</p></div>`; return; }

  const ADD = { keys: ['key:create', 'Neuer Schlüssel'], properties: ['property:create', 'Neues Haus'], vehicles: ['vehicle:create', 'Neues Fahrzeug'] };
  const cur = () => $('.tabs .on', view).dataset.tab;
  const fetchAll = async () => {
    const [props, vehicles, people, keys] = await Promise.all([api.get('/properties').catch(() => []), api.get('/vehicles').catch(() => []), api.get('/people').catch(() => []), api.get('/keys').catch(() => [])]);
    Object.assign(D, { props, vehicles, people, keys });
  };
  const keyInventory = (field, assetId, type) => {
    const assigned = D.keys.filter((key) => key[field] === assetId);
    const total = assigned.reduce((sum, key) => sum + Number(key.copies), 0);
    const issued = assigned.reduce((sum, key) => sum + Number(key.issued), 0);
    const lost = assigned.reduce((sum, key) => sum + Number(key.lost), 0);
    const value = `${total} gesamt · ${issued} ausgegeben · ${lost} verloren`;
    return can('key:read') ? `<button class="link" data-manage-keys="${type}:${assetId}">${value}</button>` : value;
  };
  const pinEye = (id) => `<button class="btn ghost sm pin-eye" data-reveal-pin="${id}" aria-label="Tür-PIN einblenden" title="Tür-PIN einblenden"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="2.5"/></svg></button>`;

  const R = {
    async overview(el) {
      const o = await api.get('/assets/overview');
      const c = o.counts;
      el.innerHTML = `<div class="grid cols-4">${[['Häuser', c.properties], ['Fahrzeuge', c.vehicles], ['Schlüssel', `${c.issued} ausgegeben / ${c.keys}`], ['Personen', c.people]].map(([l, v]) => `<div class="card kpi"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('')}</div>
      <div class="grid cols-3"><div class="card"><div class="card-head"><h2>Schlüssel-Warnungen</h2></div>${o.key_alerts.length ? o.key_alerts.map((k) => `<div class="list-item"><div class="grow"><b>${esc(k.label)}</b><small>${esc(k.person || '–')} · Kopie ${k.copy_no}</small></div><span class="tag bad">${k.lost_at ? 'Verloren' : `fällig ${fdate(k.due_at)}`}</span></div>`).join('') : empty('Keine Warnungen.')}</div>
      <div class="card"><div class="card-head"><h2>Fahrzeug-Service</h2></div>${o.vehicle_service.length ? o.vehicle_service.map((v) => `<div class="list-item"><div class="grow"><b>${esc(v.make_model)}</b><small>${esc(v.plate)}</small></div><span class="tag warn">${v.service_due ? fdate(v.service_due) : ''}${v.service_due_km != null ? `${v.service_due ? ' · ' : ''}${v.odometer_km != null && Number(v.odometer_km) >= Number(v.service_due_km) ? 'fällig' : 'bei'} ${Number(v.service_due_km).toLocaleString('de-DE')} km` : ''}</span></div>`).join('') : empty('Keine fälligen Services.')}</div>
      <div class="card"><div class="card-head"><h2>Hauswartung (30 Tage)</h2></div>${o.property_maintenance.length ? o.property_maintenance.map((p) => `<div class="list-item"><div class="grow"><b>${esc(p.name)}</b><small>${esc(p.maintenance_note || '')}</small></div><span class="tag warn">${fdate(p.maintenance_due)}</span></div>`).join('') : empty('Keine fälligen Wartungen.')}</div></div>`;
    },
    async keys(el) {
      await fetchAll();
      const selectedKey = params?.get('key');
      if (!keyFilter && selectedKey) {
        const selected = D.keys.find((key) => key.id === selectedKey);
        if (selected) keyFilter = { type: selected.property_id ? 'house' : 'vehicle', id: selected.property_id || selected.vehicle_id };
      }
      const keys = keyFilter ? D.keys.filter((k) => k[keyFilter.type === 'house' ? 'property_id' : 'vehicle_id'] === keyFilter.id) : D.keys;
      const filterLabel = keyFilter ? D.props.find((p) => p.id === keyFilter.id)?.name || D.vehicles.find((v) => v.id === keyFilter.id)?.make_model : '';
      el.innerHTML = `<div class="card"><div class="card-head"><b>${keyFilter ? `Schlüssel für ${esc(filterLabel)}` : 'Schlüsselbestand und Ausgaben'}</b><div class="row">${keyFilter ? '<button class="btn ghost sm" data-clear-key-filter>Alle Schlüssel</button>' : ''}<button class="btn ghost sm" id="scan-keys">QR-Code scannen</button></div></div>${keys.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Nr.</th><th>Bezeichnung</th><th>Objekt</th><th>Bestand / ausgegeben / verloren</th><th>Inhaber</th><th>Status</th><th></th></tr></thead><tbody>${keys.map((k) => `<tr>
        <td>${esc(k.code)}</td><td><b>${esc(k.label)}</b><br><small class="muted">${esc(k.kind)}</small></td><td>${esc(k.property_name || (k.vehicle_name ? `${k.vehicle_name} (${k.vehicle_plate})` : '–'))}</td><td>${k.copies} / ${k.issued} / ${k.lost}</td>
        <td>${k.holders.map((h) => `<div>${esc(h.person || '–')} <small class="muted">#${h.copy_no}${h.due_at ? ` bis ${fdate(h.due_at)}` : ''}${h.lost ? ' · verloren' : ''}</small> ${can('key:assign') && writable(k) ? `<button class="link" data-ret="${h.id}">zurück</button>${h.lost ? '' : ` <button class="link" data-lost="${h.id}">verloren</button>`}` : ''}</div>`).join('') || '<span class="muted">–</span>'}</td>
        <td><span class="tag ${STATUS[k.status][0]}">${STATUS[k.status][1]}</span></td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-qr="${k.id}">QR</button> ${can('key:assign') && writable(k) && k.issued + k.lost < k.copies ? `<button class="btn sm" data-assign="${k.id}">Ausgeben</button> ` : ''}${actions(k, 'key')}</td></tr>`).join('')}</tbody></table></div>` : empty(keyFilter ? 'Für dieses Objekt sind noch keine Schlüssel angelegt.' : 'Noch keine Schlüssel.')}</div>`;
    },
    async properties(el) {
      await fetchAll();
      el.innerHTML = `<div class="card">${D.props.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Art</th><th>Adresse</th><th>Verantwortlich</th><th>Wartung</th><th>Schlüssel-Inventur</th><th>Tür-PIN</th><th>Kosten</th><th></th></tr></thead><tbody>${D.props.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${PTYPE[p.type]}</td><td>${esc(p.address)}</td><td>${esc(D.people.find((x) => x.id === p.responsible_person_id)?.name || '–')}</td><td>${fdate(p.maintenance_due)}</td><td>${keyInventory('property_id', p.id, 'house')}</td><td>${pinEye(p.id)}${can('property:update') && writable(p) ? ` <button class="btn ghost sm" data-set-pin="${p.id}">PIN ändern</button>` : ''}</td><td>${p.cost_amount ? `${eur(p.cost_amount)} ${costIntervalText(p.cost_interval, p.cost_interval_count)}` : '–'}</td><td style="white-space:nowrap">${actions(p, 'property')}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Häuser.')}</div>`;
    },
    async vehicles(el) {
      await fetchAll();
      // Besitzer als Person verlinkt auf die Personenakte, sonst der Freitext
      const owner = (v) => {
        if (!v.owner_person_id) return esc(v.registered_owner || '–');
        return can('casefile:read') && can('person:read') ? `<a href="#/casefiles?person=${v.owner_person_id}">${esc(v.owner_person_name)}</a>` : esc(v.owner_person_name || '–');
      };
      el.innerHTML = `<div class="card">${D.vehicles.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Kennzeichen</th><th>Modell</th><th>Besitzer</th><th>Status</th><th>Service</th><th>Verbandskasten</th><th>Schlüssel-Inventur</th><th>Kosten</th><th></th></tr></thead><tbody>${D.vehicles.map((v) => `<tr${v.status === 'retired' ? ' class="muted"' : ''}><td><b>${esc(v.plate)}</b></td><td>${esc(v.make_model)}</td><td>${owner(v)}</td><td>${v.status === 'retired' ? `<span class="tag">${VSTATUS[v.status]}</span>` : VSTATUS[v.status]}</td><td>${fdate(v.service_due)}${v.service_due_km != null ? `<br><small class="muted">bei ${Number(v.service_due_km).toLocaleString('de-DE')} km</small>` : ''}</td><td>${fdate(v.first_aid_kit_expires_on)}</td><td>${keyInventory('vehicle_id', v.id, 'vehicle')}</td><td>${v.cost_amount ? `${eur(v.cost_amount)} ${costIntervalText(v.cost_interval, v.cost_interval_count)}` : '–'}</td><td style="white-space:nowrap"><button class="btn ghost sm" data-images="${v.id}">Bilder${v.images ? ` (${v.images})` : ''}</button> ${actions(v, 'vehicle')}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Fahrzeuge.')}</div>`;
    },
    async costs(el) {
      const c = await api.get('/assets/costs');
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Laufende Objektkosten</h2><b>${eur(c.yearly_total)} / Jahr</b></div>${c.items.length ? `<table class="table"><thead><tr><th>Objekt</th><th>Typ</th><th>Intervall</th><th>Konto</th><th style="text-align:right">Betrag</th><th style="text-align:right">pro Jahr</th></tr></thead><tbody>${c.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${ASSET_TYPE[i.type]}</td><td>${costIntervalText(i.interval, i.interval_count)}</td><td>${esc(i.budget_name || '–')}${i.tracking ? '' : ' <span class="tag warn">nicht verbucht</span>'}</td><td style="text-align:right">${eur(i.amount)}</td><td style="text-align:right">${i.interval === 'once' ? '–' : eur(i.yearly)}</td></tr>`).join('')}</tbody></table>` : empty('Keine Kosten erfasst.')}</div>`;
    },
    async audit(el) {
      const q = el._q || '';
      const rows = await api.get(`/admin/audit?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      el.innerHTML = `<div class="card"><div class="toolbar"><input id="a-q" placeholder="Suchen…" value="${esc(q)}" style="max-width:260px">${can('audit:export') ? '<button class="btn ghost sm" id="a-csv">CSV-Export</button>' : ''}</div>${rows.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Zeit</th><th>Benutzer</th><th>Aktion</th><th>Objekt</th><th>IP</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fdatetime(r.created_at)}</td><td>${esc(r.user_name || 'System')}</td><td><code>${esc(r.action)}</code></td><td>${esc(r.entity || '')}</td><td>${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('Keine Einträge.')}</div>`;
      $('#a-q', el).addEventListener('input', debounce(async (e) => { el._q = e.target.value.trim(); await R.audit(el); const n = $('#a-q', el); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 400));
    },
    async log(el) {
      const l = await api.get('/assets/log');
      el.innerHTML = `<div class="card">${l.length ? l.map((e) => `<div class="list-item"><div class="grow"><b>${esc(e.label)}</b><small>${esc(e.person || '–')} · Kopie ${e.copy_no}</small></div><span class="tag">${EVENT[e.event]}</span><small>${fdatetime(e.at)}</small></div>`).join('') : empty('Noch keine Vorgänge.')}</div>`;
    },
  };

  async function show(k = cur()) {
    if (!view.isConnected) return;
    const el = $(`.tab-panel[data-panel="${k}"]`, view);
    const a = ADD[k];
    $('#a-actions').innerHTML = a && can(a[0]) ? `<button class="btn" id="a-new">${a[1]}</button>` : '';
    try { await R[k](el); } catch (x) { el.innerHTML = `<div class="card"><p class="auth-error">${esc(x.message)}</p></div>`; }
  }

  async function assign(k) {
    const act = D.people.filter((p) => p.active);
    if (!act.length) return toast('Keine aktive Person vorhanden', true);
    return openForm({
      title: `Schlüssel ausgeben: ${k.label}`, fields: [
        { name: 'person_id', label: 'Person', type: 'select', options: act.map((p) => ({ v: p.id, l: p.name })) },
        { name: 'due_at', label: 'Rückgabe bis (optional)', type: 'date', min: todayStr() },
        { name: 'receipt_signed', label: 'Empfangsquittung unterschrieben', type: 'checkbox' },
      ],
      submit: 'Ausgeben', onSubmit: (v) => api.post(`/keys/${k.id}/assign`, { person_id: v.person_id, due_at: v.due_at || null, receipt_signed: v.receipt_signed }),
    });
  }

  async function pinAccess(propertyId, reveal) {
    const fields = [
      ...(reveal ? [] : [{ name: 'pin', label: 'Neuer Tür-PIN (leer = entfernen)', type: 'password', autocomplete: 'off' }]),
      { name: 'password', label: 'Aktuelles Passwort', type: 'password', required: true, autocomplete: 'current-password' },
      ...(state.me?.totp_enabled ? [{ name: 'code', label: '2FA-Code', required: true, autocomplete: 'one-time-code' }] : []),
    ];
    return openForm({
      title: reveal ? 'Tür-PIN anzeigen' : 'Tür-PIN ändern',
      submit: reveal ? 'PIN anzeigen' : 'PIN speichern',
      fields,
      onSubmit: async (v) => {
        const credentials = { password: v.password, ...(v.code ? { code: v.code.trim() } : {}) };
        if (!reveal) return api.post(`/properties/${propertyId}/pin`, { pin: v.pin, ...credentials });
        const result = await api.post(`/properties/${propertyId}/pin/reveal`, credentials);
        await showSecret('Tür-PIN', 'PIN wird nur nach Passwortbestätigung angezeigt:', result.pin);
      },
    });
  }
  async function showKeyQr(keyId) {
    const { image } = await api.get(`/keys/${keyId}/qr`);
    return openForm({
      title: 'Schlüssel-QR-Code',
      submit: 'Schließen',
      fields: [{ type: 'html', html: `<p class="muted">Scannen öffnet diesen Schlüssel in der Bestandsverwaltung.</p><img class="key-qr" src="${esc(image)}" alt="QR-Code für den Schlüssel">` }],
      onSubmit: async () => true,
    });
  }
  async function scanKeyQr() {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      return toast('QR-Scan wird von diesem Browser nicht unterstützt. Nutze die Kamera-App zum Scannen.', true);
    }
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.innerHTML = `<div class="card"><div class="card-head"><h2>Schlüssel-QR-Code scannen</h2></div><video class="key-scan-video" playsinline muted></video><p class="muted">Halte den QR-Code vor die Kamera.</p><div class="modal-foot"><button class="btn ghost" data-close>Abbrechen</button></div></div>`;
    $('#modals').append(modal);
    const close = () => {
      scannerActive = false;
      cameraStream?.getTracks().forEach((track) => track.stop());
      cameraStream = null;
      modal.remove();
    };
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-close]')) close();
    });
    scannerActive = true;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      const video = $('video', modal);
      video.srcObject = cameraStream;
      await video.play();
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      while (scannerActive && view.isConnected) {
        const [result] = await detector.detect(video);
        if (result) {
          const scanned = new URL(result.rawValue, location.origin);
          const [route, query = ''] = scanned.hash.split('?');
          const values = new URLSearchParams(query);
          if (scanned.origin !== location.origin || !['#/assets', '#/assets-keys'].includes(route) || values.get('tab') !== 'keys' || !/^[0-9a-f-]{36}$/i.test(values.get('key') || '')) {
            toast('Der QR-Code verweist nicht auf einen gültigen Schlüssel in dieser App.', true);
            close();
            return;
          } else {
            close();
            location.hash = scanned.hash;
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      close();
    } catch (error) {
      close();
      toast(`Kamera konnte nicht gestartet werden: ${error.message}`, true);
    }
  }

  view.addEventListener('tabchange', () => show());
  view.addEventListener('click', async (e) => {
    const g = (s) => e.target.closest(s);
    const k = cur();
    const id = (g('[data-edit]') || g('[data-del]') || g('[data-assign]'))?.dataset;
    try {
      let changed = false;
      if (g('#a-new') || g('[data-edit]')) {
        await fetchAll();
        const rid = g('[data-edit]')?.dataset.edit;
        const list = { keys: D.keys, properties: D.props, vehicles: D.vehicles }[k];
        const o = rid ? list.find((x) => x.id === rid) : null;
        changed = await ({ keys: () => formKey(o, D.props, D.vehicles), properties: () => formProperty(o, D.people), vehicles: () => formVehicle(o, D.people) }[k]());
      } else if (g('[data-del]')) {
        if (await confirmBox('Löschen', 'Eintrag wirklich löschen? Verknüpfte Kosten-Daueraufträge werden ebenfalls entfernt.')) { await api.del(`/${{ keys: 'keys', properties: 'properties', vehicles: 'vehicles' }[k]}/${id.del}`); changed = true; }
      } else if (g('[data-assign]')) changed = await assign(D.keys.find((x) => x.id === id.assign));
      else if (g('[data-ret]')) { await api.post(`/assignments/${g('[data-ret]').dataset.ret}/return`); changed = true; }
      else if (g('[data-lost]') && (await confirmBox('Schlüssel verloren', 'Als verloren melden? Die Kopie bleibt bis zur Klärung blockiert.', 'Melden'))) { await api.post(`/assignments/${g('[data-lost]').dataset.lost}/lost`); changed = true; }
      else if (g('[data-manage-keys]')) {
        const [type, assetId] = g('[data-manage-keys]').dataset.manageKeys.split(':');
        keyFilter = { type, id: assetId };
        location.hash = `#/assets-keys?filter=${type}:${assetId}`;
        return;
      } else if (g('[data-clear-key-filter]')) { keyFilter = null; show('keys'); }
      else if (g('[data-reveal-pin]')) await pinAccess(g('[data-reveal-pin]').dataset.revealPin, true);
      else if (g('[data-set-pin]')) { await pinAccess(g('[data-set-pin]').dataset.setPin, false); show('properties'); }
      else if (g('[data-qr]')) await showKeyQr(g('[data-qr]').dataset.qr);
      else if (g('[data-images]')) {
        const vehicle = D.vehicles.find((v) => v.id === g('[data-images]').dataset.images);
        changed = await openGalleryModal({
          title: `${vehicle.make_model} (${vehicle.plate})`, listUrl: `/vehicles/${vehicle.id}/images`, uploadUrl: `/vehicles/${vehicle.id}/images`,
          urls: { file: (imageId) => `/vehicle-images/${imageId}`, item: (imageId) => `/vehicle-images/${imageId}` },
          writable: can('vehicle:update') && writable(vehicle),
        });
      }
      else if (g('#scan-keys')) await scanKeyQr();
      else if (g('#a-csv')) await api.download('/admin/audit/export.csv', 'audit.csv');
      if (changed) show();
    } catch (x) { toast(x.message, true); }
  });
  await show(initial);
}
