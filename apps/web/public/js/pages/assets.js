import { api } from '../api.js';
import { $, esc, eur, fdate, fdatetime, empty, openForm, confirmBox, toast, parseAmount, todayStr } from '../ui.js';
import { loadBudgets } from './common.js';
import { can } from '../app.js';

const STATUS = { available: ['ok', 'Verfügbar'], out: ['warn', 'Ausgegeben'], overdue: ['bad', 'Überfällig'], lost: ['bad', 'Verloren'] };
const VSTATUS = { available: 'Verfügbar', in_use: 'Im Einsatz', workshop: 'Werkstatt', retired: 'Ausgemustert' };
const PTYPE = { home: 'Wohnung/Haus', office: 'Büro', storage: 'Lager', holiday: 'Ferienobjekt' };
const PKIND = { employee: 'Mitarbeiter', external: 'Extern', family: 'Familie' };
const INTERVAL = { weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich', yearly: 'Jährlich', once: 'Einmalig' };
const EVENT = { issued: 'Ausgegeben', returned: 'Zurückgegeben', lost: 'Als verloren gemeldet' };
const ASSET_TYPE = { house: 'Haus', vehicle: 'Fahrzeug', key: 'Schlüssel' };

const costFields = (o, budgets) => [
  { type: 'html', html: '<div class="cost-block"><b>Laufende Kosten (optional)</b><p class="muted">Werden automatisch als Buchung bzw. Dauerauftrag im gewählten Budget geführt.</p></div>' },
  { name: 'cost_amount', label: 'Betrag', value: o?.cost_amount ? String(o.cost_amount).replace('.', ',') : '' },
  { name: 'cost_interval', label: 'Intervall', type: 'select', options: Object.entries(INTERVAL).map(([v, l]) => ({ v, l })), value: o?.cost_interval || 'monthly' },
  { name: 'cost_budget_id', label: 'Budget', type: 'select', options: [{ v: '', l: '– Keines –' }, ...budgets.map((b) => ({ v: b.id, l: b.name }))], value: o?.cost_budget_id || '' },
  { name: 'cost_category_id', label: 'Kategorie', type: 'select', options: [{ v: '', l: '– Keine –' }, ...budgets.flatMap((b) => b.categories.map((c) => ({ v: c.id, l: `${b.name} › ${c.name}` })))], value: o?.cost_category_id || '' },
  { name: 'cost_tracking', label: 'Kosten im Budget verbuchen', type: 'checkbox', value: o ? o.cost_tracking !== false : true },
];
const costBody = (v) => ({
  cost_amount: v.cost_amount ? parseAmount(v.cost_amount) : null, cost_interval: v.cost_amount ? v.cost_interval : null,
  cost_budget_id: v.cost_amount ? v.cost_budget_id || null : null, cost_category_id: v.cost_amount ? v.cost_category_id || null : null, cost_tracking: v.cost_tracking,
});
const save = (path, o, body) => (o ? api.patch(`/${path}/${o.id}`, body) : api.post(`/${path}`, body));
async function ownershipFields(o) {
  const teams = can('team:read') ? (await api.get('/teams')).filter((team) => team.role !== 'viewer') : [];
  return [
    { name: 'scope', label: 'Sichtbarkeit', type: 'select', options: [{ v: 'personal', l: 'Privat' }, ...(teams.length ? [{ v: 'team', l: 'Team' }] : [])], value: o?.team_id ? 'team' : 'personal' },
    { name: 'team_id', label: 'Team', type: 'select', options: [{ v: '', l: '–' }, ...teams.map((team) => ({ v: team.id, l: team.name }))], value: o?.team_id || '' },
  ];
}
const ownershipBody = (v) => ({ scope: v.scope, team_id: v.scope === 'team' ? v.team_id || null : null });

async function formProperty(o, people) {
  const budgets = await loadBudgets();
  const ownership = await ownershipFields(o);
  return openForm({
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
async function formVehicle(o) {
  const budgets = await loadBudgets();
  const ownership = await ownershipFields(o);
  return openForm({
    title: o ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug', wide: true, fields: [
      { name: 'plate', label: 'Kennzeichen', value: o?.plate, required: true },
      { name: 'make_model', label: 'Marke / Modell', value: o?.make_model, required: true },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(VSTATUS).map(([v, l]) => ({ v, l })), value: o?.status || 'available' },
      { name: 'service_due', label: 'Service fällig', type: 'date', value: o?.service_due?.slice(0, 10) },
      { name: 'odometer_km', label: 'Kilometerstand', type: 'number', min: 0, value: o?.odometer_km },
      { name: 'service_interval_km', label: 'Service-Intervall (km)', type: 'number', min: 1, value: o?.service_interval_km },
      { name: 'service_due_km', label: 'Service fällig bei (km)', type: 'number', min: 0, value: o?.service_due_km },
      { name: 'insurance_from', label: 'Versicherung ab', type: 'date', value: o?.insurance_from?.slice(0, 10) },
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
      return save('vehicles', o, { plate: v.plate.trim(), make_model: v.make_model.trim(), status: v.status, service_due: v.service_due || null, odometer_km: odometerKm, service_interval_km: serviceIntervalKm, service_due_km: serviceDueKm, insurance_from: v.insurance_from || null, note: v.note, ...ownershipBody(v), ...costBody(v) });
    },
  });
}
async function formKey(o, props, vehicles) {
  const budgets = await loadBudgets();
  const ownership = await ownershipFields(o);
  return openForm({
    title: o ? 'Schlüssel bearbeiten' : 'Neuer Schlüssel', wide: true, fields: [
      { name: 'code', label: 'Schlüssel-Nr.', value: o?.code, required: true },
      { name: 'label', label: 'Bezeichnung', value: o?.label, required: true },
      { name: 'kind', label: 'Art', value: o?.kind || 'Haustür' },
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
async function formPerson(o) {
  const ownership = await ownershipFields(o);
  return openForm({
  title: o ? 'Person bearbeiten' : 'Neue Person', fields: [
    { name: 'name', label: 'Name', value: o?.name, required: true },
    { name: 'kind', label: 'Art', type: 'select', options: Object.entries(PKIND).map(([v, l]) => ({ v, l })), value: o?.kind || 'employee' },
    { name: 'function', label: 'Funktion', value: o?.function },
    { name: 'phone', label: 'Telefon', value: o?.phone },
    { name: 'email', label: 'E-Mail', type: 'email', value: o?.email, full: true },
    { name: 'active', label: 'Aktiv', type: 'checkbox', value: o ? o.active : true },
    { name: 'note', label: 'Notiz', type: 'textarea', value: o?.note, full: true },
    ...ownership,
  ],
  onSubmit: (v) => save('people', o, { name: v.name.trim(), kind: v.kind, function: v.function, phone: v.phone, email: v.email, active: v.active, note: v.note, ...ownershipBody(v) }),
  });
}

const actions = (id, perm) => `${can(`${perm}:update`) ? `<button class="btn ghost sm" data-edit="${id}">Bearbeiten</button>` : ''}${can(`${perm}:delete`) ? ` <button class="btn ghost sm" data-del="${id}">Löschen</button>` : ''}`;

export async function render(view, params) {
  const D = {};
  const tabs = [['overview', 'Übersicht'], ['keys', 'Schlüssel'], ['properties', 'Häuser'], ['vehicles', 'Fahrzeuge'], ['people', 'Personen'], ['costs', 'Kosten'], ['log', 'Protokoll']]
    .filter(([k]) => can({ keys: 'key:read', properties: 'property:read', vehicles: 'vehicle:read', people: 'person:read' }[k] || 'key:read') || k === 'overview');
  const initial = tabs.some(([k]) => k === params?.get('tab')) ? params.get('tab') : tabs[0][0];
  view.innerHTML = `<div class="page-head"><div><h1>Schlüssel &amp; Objekte</h1><p>Häuser, Fahrzeuge, Schlüsselausgabe und Personen</p></div><div class="actions" id="a-actions"></div></div>
    <div><div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === initial ? 'on' : ''}">${l}</button>`).join('')}</div>${tabs.map(([k]) => `<div class="tab-panel ${k === initial ? 'on' : ''}" data-panel="${k}"></div>`).join('')}</div>`;

  const ADD = { keys: ['key:create', 'Neuer Schlüssel'], properties: ['property:create', 'Neues Haus'], vehicles: ['vehicle:create', 'Neues Fahrzeug'], people: ['person:create', 'Neue Person'] };
  const cur = () => $('.tabs .on', view).dataset.tab;
  const fetchAll = async () => {
    const [props, vehicles, people, keys] = await Promise.all([api.get('/properties').catch(() => []), api.get('/vehicles').catch(() => []), api.get('/people').catch(() => []), api.get('/keys').catch(() => [])]);
    Object.assign(D, { props, vehicles, people, keys });
  };

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
      el.innerHTML = `<div class="card">${D.keys.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Nr.</th><th>Bezeichnung</th><th>Objekt</th><th>Kopien</th><th>Inhaber</th><th>Status</th><th></th></tr></thead><tbody>${D.keys.map((k) => `<tr>
        <td>${esc(k.code)}</td><td><b>${esc(k.label)}</b><br><small class="muted">${esc(k.kind)}</small></td><td>${esc(k.property_name || (k.vehicle_name ? `${k.vehicle_name} (${k.vehicle_plate})` : '–'))}</td><td>${k.issued}/${k.copies}</td>
        <td>${k.holders.map((h) => `<div>${esc(h.person || '–')} <small class="muted">#${h.copy_no}${h.due_at ? ` bis ${fdate(h.due_at)}` : ''}${h.lost ? ' · verloren' : ''}</small> ${can('key:assign') ? `<button class="link" data-ret="${h.id}">zurück</button>${h.lost ? '' : ` <button class="link" data-lost="${h.id}">verloren</button>`}` : ''}</div>`).join('') || '<span class="muted">–</span>'}</td>
        <td><span class="tag ${STATUS[k.status][0]}">${STATUS[k.status][1]}</span></td>
        <td style="white-space:nowrap">${can('key:assign') && k.issued + k.lost < k.copies ? `<button class="btn sm" data-assign="${k.id}">Ausgeben</button> ` : ''}${actions(k.id, 'key')}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Schlüssel.')}</div>`;
    },
    async properties(el) {
      await fetchAll();
      el.innerHTML = `<div class="card">${D.props.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Art</th><th>Adresse</th><th>Verantwortlich</th><th>Wartung</th><th>Kosten</th><th></th></tr></thead><tbody>${D.props.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${PTYPE[p.type]}</td><td>${esc(p.address)}</td><td>${esc(D.people.find((x) => x.id === p.responsible_person_id)?.name || '–')}</td><td>${fdate(p.maintenance_due)}</td><td>${p.cost_amount ? `${eur(p.cost_amount)} ${INTERVAL[p.cost_interval].toLowerCase()}` : '–'}</td><td style="white-space:nowrap">${actions(p.id, 'property')}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Häuser.')}</div>`;
    },
    async vehicles(el) {
      await fetchAll();
      el.innerHTML = `<div class="card">${D.vehicles.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Kennzeichen</th><th>Modell</th><th>Status</th><th>Service</th><th>Versicherung ab</th><th>Kosten</th><th></th></tr></thead><tbody>${D.vehicles.map((v) => `<tr><td><b>${esc(v.plate)}</b></td><td>${esc(v.make_model)}</td><td>${VSTATUS[v.status]}</td><td>${fdate(v.service_due)}${v.service_due_km != null ? `<br><small class="muted">bei ${Number(v.service_due_km).toLocaleString('de-DE')} km</small>` : ''}</td><td>${fdate(v.insurance_from)}</td><td>${v.cost_amount ? `${eur(v.cost_amount)} ${INTERVAL[v.cost_interval].toLowerCase()}` : '–'}</td><td style="white-space:nowrap">${actions(v.id, 'vehicle')}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Fahrzeuge.')}</div>`;
    },
    async people(el) {
      await fetchAll();
      el.innerHTML = `<div class="card">${D.people.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Art</th><th>Funktion</th><th>Kontakt</th><th>Schlüssel</th><th>Status</th><th></th></tr></thead><tbody>${D.people.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${PKIND[p.kind]}</td><td>${esc(p.function)}</td><td>${esc(p.email || p.phone || '–')}</td><td>${p.keys}</td><td><span class="tag ${p.active ? 'ok' : 'warn'}">${p.active ? 'Aktiv' : 'Inaktiv'}</span></td><td style="white-space:nowrap">${actions(p.id, 'person')}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Personen.')}</div>`;
    },
    async costs(el) {
      const c = await api.get('/assets/costs');
      el.innerHTML = `<div class="card"><div class="card-head"><h2>Laufende Objektkosten</h2><b>${eur(c.yearly_total)} / Jahr</b></div>${c.items.length ? `<table class="table"><thead><tr><th>Objekt</th><th>Typ</th><th>Intervall</th><th>Budget</th><th style="text-align:right">Betrag</th><th style="text-align:right">pro Jahr</th></tr></thead><tbody>${c.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${ASSET_TYPE[i.type]}</td><td>${INTERVAL[i.interval]}</td><td>${esc(i.budget_name || '–')}${i.tracking ? '' : ' <span class="tag warn">nicht verbucht</span>'}</td><td style="text-align:right">${eur(i.amount)}</td><td style="text-align:right">${i.interval === 'once' ? '–' : eur(i.yearly)}</td></tr>`).join('')}</tbody></table>` : empty('Keine Kosten erfasst.')}</div>`;
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
        const list = { keys: D.keys, properties: D.props, vehicles: D.vehicles, people: D.people }[k];
        const o = rid ? list.find((x) => x.id === rid) : null;
        changed = await ({ keys: () => formKey(o, D.props, D.vehicles), properties: () => formProperty(o, D.people), vehicles: () => formVehicle(o), people: () => formPerson(o) }[k]());
      } else if (g('[data-del]')) {
        if (await confirmBox('Löschen', 'Eintrag wirklich löschen? Verknüpfte Kosten-Daueraufträge werden ebenfalls entfernt.')) { await api.del(`/${{ keys: 'keys', properties: 'properties', vehicles: 'vehicles', people: 'people' }[k]}/${id.del}`); changed = true; }
      } else if (g('[data-assign]')) changed = await assign(D.keys.find((x) => x.id === id.assign));
      else if (g('[data-ret]')) { await api.post(`/assignments/${g('[data-ret]').dataset.ret}/return`); changed = true; }
      else if (g('[data-lost]') && (await confirmBox('Schlüssel verloren', 'Als verloren melden? Die Kopie bleibt bis zur Klärung blockiert.', 'Melden'))) { await api.post(`/assignments/${g('[data-lost]').dataset.lost}/lost`); changed = true; }
      if (changed) show();
    } catch (x) { toast(x.message, true); }
  });
  await show(initial);
}
