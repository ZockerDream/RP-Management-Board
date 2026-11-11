// Fuhrpark einer Organisation: Fahrzeuge in Gruppen, Kontrollrunden mit „Erledigt“, Markdown-Ausgabe.
// Rechte (Funktion „Fuhrpark“): 2 sehen, 3 pflegen und erfassen, 4 erledigte Runden ändern und löschen.
import { api } from '../api.js';
import { $, $$, esc, empty, fdate, tag, openForm, confirmBox, toast, download } from '../ui.js';
import { can } from '../app.js';

const LAST_TEAM = 'fleet.team';
const remember = (id) => { try { localStorage.setItem(LAST_TEAM, id); } catch { /* ohne Speicher geht es auch */ } };
const remembered = () => { try { return localStorage.getItem(LAST_TEAM); } catch { return null; } };

const groupForm = (group, teamId) => openForm({
  title: group ? 'Gruppe bearbeiten' : 'Neue Gruppe',
  fields: [
    { name: 'name', label: 'Name', value: group?.name, required: true, maxlength: 100, placeholder: 'z. B. Tailgater 2', full: true },
    { name: 'sort', label: 'Reihenfolge', type: 'number', step: 1, value: group?.sort ?? 0, help: 'Kleinere Zahlen stehen in der Liste weiter oben.' },
    { name: 'show_model', label: 'Spalte „Fahrzeug“ in der Liste', type: 'checkbox', value: group?.show_model ?? false, help: 'Für gemischte Gruppen wie „Sonstige Fahrzeuge“.' },
  ],
  onSubmit: async (v) => {
    const body = { name: v.name.trim(), sort: Number(v.sort) || 0, show_model: !!v.show_model };
    if (group) await api.patch(`/fleet/groups/${group.id}`, body);
    else await api.post('/fleet/groups', { ...body, team_id: teamId });
    toast('Gruppe gespeichert');
  },
});

const vehicleForm = (vehicle, groups, teamId) => {
  if (!groups.length) { toast('Lege zuerst eine Gruppe an', true); return false; }
  return openForm({
    title: vehicle ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug',
    fields: [
      { name: 'plate', label: 'Kennzeichen', value: vehicle?.plate, required: true, maxlength: 20 },
      { name: 'group_id', label: 'Gruppe', type: 'select', options: groups.map((g) => ({ v: g.id, l: g.name })), value: vehicle?.group_id ?? groups[0].id },
      { name: 'model', label: 'Fahrzeug', value: vehicle?.model, maxlength: 100, placeholder: 'z. B. Buzzard Heli', help: 'Erscheint in Gruppen mit Spalte „Fahrzeug“.' },
      { name: 'note', label: 'Notiz', value: vehicle?.note, maxlength: 2000, full: true },
    ],
    onSubmit: async (v) => {
      const body = { plate: v.plate.trim(), group_id: v.group_id, model: v.model.trim(), note: v.note };
      if (vehicle) await api.patch(`/fleet/vehicles/${vehicle.id}`, body);
      else await api.post('/fleet/vehicles', { ...body, team_id: teamId });
      toast('Fahrzeug gespeichert');
    },
  });
};

async function showMarkdown(check) {
  const text = await (await api.blob(`/fleet/checks/${check.id}/markdown`)).text();
  const name = `fuhrpark-${String(check.checked_on).slice(0, 10)}.md`;
  const dialog = openForm({
    title: 'Liste als Markdown',
    wide: true,
    fields: [{ type: 'html', html: `<textarea readonly rows="18" style="width:100%;font-family:monospace;font-size:12px" aria-label="Markdown">${esc(text)}</textarea>` }],
    submit: 'Kopieren',
    cancel: 'Schließen',
    extraButtons: '<button type="button" class="btn ghost" data-md-download>Herunterladen</button>',
    onSubmit: async () => {
      await navigator.clipboard.writeText(text);
      toast('Kopiert');
      return false;
    },
  });
  // openForm hängt den Dialog sofort ein
  $('#modals .modal.open:last-child [data-md-download]')?.addEventListener('click', () => download(name, text, 'text/markdown;charset=utf-8'));
  await dialog;
}

export async function render(view) {
  const teams = await api.get('/fleet/teams');
  if (!teams.length) {
    view.innerHTML = `<div class="page-head"><div><h1>Fuhrpark</h1><p>Fahrzeuge und Kontrollrunden deiner Organisation</p></div></div>
      <div class="card">${empty('Du bist in keiner Organisation mit Zugriff auf den Fuhrpark. Die Rechte vergibt die Organisation unter „Organisationen → Rechte“.')}</div>`;
    return;
  }
  let teamId = teams.some((t) => t.id === remembered()) ? remembered() : teams[0].id;
  let groups = [], vehicles = [], checks = [], showRetired = false, openCheck = null;
  const level = () => teams.find((t) => t.id === teamId)?.level ?? 0;

  view.innerHTML = `<div class="page-head"><div><h1>Fuhrpark</h1><p>Fahrzeuge und Kontrollrunden deiner Organisation</p></div>
    <div class="actions"><select id="f-team" aria-label="Organisation">${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div></div>
    <div><div class="tabs"><button data-tab="checks" class="on">Kontrollrunden</button><button data-tab="vehicles">Fahrzeuge</button></div>
    <div class="tab-panel on" data-panel="checks"><div class="toolbar" id="f-check-bar"></div><div class="card" id="f-checks"></div><div id="f-detail"></div></div>
    <div class="tab-panel" data-panel="vehicles"><div class="toolbar" id="f-vehicle-bar"></div><div class="card" id="f-vehicles"></div></div></div>`;
  $('#f-team').value = teamId;

  const write = () => level() >= 3 && can('fleet:update');
  const manage = () => level() >= 4;

  function drawBars() {
    $('#f-check-bar').innerHTML = write() && can('fleet:create') ? '<button class="btn" id="f-check-new">Neue Runde</button>' : '';
    $('#f-vehicle-bar').innerHTML = `${write() && can('fleet:create') ? '<button class="btn ghost" id="f-group-new">Neue Gruppe</button> <button class="btn" id="f-vehicle-new">Neues Fahrzeug</button>' : ''}
      <label style="margin-left:auto"><input type="checkbox" id="f-retired" ${showRetired ? 'checked' : ''}> Ausgemusterte zeigen</label>`;
  }
  function drawChecks() {
    $('#f-checks').innerHTML = checks.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Stand</th><th>Status</th><th>Fahrzeuge</th><th></th></tr></thead><tbody>
      ${checks.map((c) => `<tr><td><b>${fdate(c.checked_on)}</b></td>
        <td>${c.done ? `${tag('ok', 'Erledigt')}${c.done_by_name ? ` <small class="muted">${esc(c.done_by_name)}</small>` : ''}` : tag('warn', 'Offen')}</td>
        <td>${c.items}</td><td style="white-space:nowrap"><button class="btn ghost sm" data-open="${c.id}">Öffnen</button>
        ${manage() && can('fleet:delete') ? ` <button class="btn ghost sm" data-check-del="${c.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Noch keine Kontrollrunde. „Neue Runde“ übernimmt alle aktiven Fahrzeuge mit den Werten der letzten Runde.');
  }
  function drawVehicles() {
    const shown = vehicles.filter((v) => showRetired || v.active);
    $('#f-vehicles').innerHTML = groups.length ? groups.map((g) => {
      const list = shown.filter((v) => v.group_id === g.id);
      return `<div class="card-head" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h2 style="margin:0">${esc(g.name)}</h2>
        ${g.show_model ? tag('', 'mit Spalte Fahrzeug') : ''}<span style="flex:1"></span>
        ${write() ? `<button class="btn ghost sm" data-group-edit="${g.id}">Bearbeiten</button>` : ''}
        ${manage() && can('fleet:delete') && !list.length ? `<button class="btn ghost sm" data-group-del="${g.id}">Löschen</button>` : ''}</div>
        ${list.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Kennzeichen</th><th>Fahrzeug</th><th>Notiz</th><th></th></tr></thead><tbody>
        ${list.map((v, i) => `<tr><td><b>${esc(v.plate)}</b>${v.active ? '' : ` ${tag('', 'Ausgemustert')}`}</td><td>${esc(v.model || '–')}</td><td>${esc(v.note || '')}</td>
          <td style="white-space:nowrap">${write() ? `<button class="btn ghost sm" data-up="${v.id}" ${i ? '' : 'disabled'} aria-label="Nach oben">↑</button>
            <button class="btn ghost sm" data-down="${v.id}" ${i < list.length - 1 ? '' : 'disabled'} aria-label="Nach unten">↓</button>
            <button class="btn ghost sm" data-vehicle-edit="${v.id}">Bearbeiten</button>
            <button class="btn ghost sm" data-retire="${v.id}">${v.active ? 'Ausmustern' : 'Wieder in Betrieb'}</button>` : ''}
            ${manage() && can('fleet:delete') ? ` <button class="btn ghost sm" data-vehicle-del="${v.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : empty('Keine Fahrzeuge in dieser Gruppe.')}`;
    }).join('<hr style="border:0;border-top:1px solid var(--border);margin:12px 0">')
      : empty('Noch keine Gruppen. Lege zuerst eine Gruppe an, z. B. „Tailgater 2“.');
  }

  async function drawDetail() {
    const box = $('#f-detail');
    if (!openCheck) { box.innerHTML = ''; return; }
    const { check, items } = await api.get(`/fleet/checks/${openCheck}`);
    const editable = check.level >= 3 && can('fleet:update') && (!check.done || check.level >= 4);
    const sections = [];
    for (const i of items) {
      if (sections.at(-1)?.name !== i.group_name) sections.push({ name: i.group_name, show_model: i.show_model, items: [] });
      sections.at(-1).items.push(i);
    }
    const input = (i, k, type, attrs = '') => (editable
      ? `<input type="${type}" data-item="${i.id}" data-k="${k}" ${attrs} aria-label="${esc(i.plate)}">`
      : '');
    const val = (v) => (v == null ? '' : esc(String(v).slice(0, 10)));
    box.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-head" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <h2 style="margin:0">Runde vom ${fdate(check.checked_on)}</h2>${check.done ? tag('ok', 'Erledigt') : tag('warn', 'Offen')}<span style="flex:1"></span>
        <button class="btn ghost sm" id="f-md">Als Markdown</button>
        ${editable ? '<button class="btn ghost sm" id="f-save">Speichern</button>' : ''}
        ${!check.done && editable ? '<button class="btn sm" id="f-done">Erledigt</button>' : ''}
        ${check.done && check.level >= 4 && can('fleet:update') ? '<button class="btn ghost sm" id="f-undone">Erledigt zurücknehmen</button>' : ''}
        <button class="btn ghost sm" id="f-close">Schließen</button></div>
      ${check.done && editable ? '<p class="muted" style="margin:4px 0 8px">Erledigte Runde – Änderungen kommen ins Audit-Log.</p>' : ''}
      ${editable ? `<label>Stand <input type="date" id="f-date" value="${val(check.checked_on)}"></label>` : ''}
      ${sections.length ? sections.map((s) => `<h3>${esc(s.name)}</h3><div class="scroll-x"><table class="table"><thead><tr><th>Kennzeichen</th>${s.show_model ? '<th>Fahrzeug</th>' : ''}
        <th>KM-Stand</th><th>Letzte Wartung</th><th>Verbandkasten</th><th>Zubehör vollst.</th><th>Notizen</th></tr></thead><tbody>
        ${s.items.map((i) => `<tr><td><b>${esc(i.plate)}</b></td>${s.show_model ? `<td>${esc(i.model || '–')}</td>` : ''}
          <td>${editable ? input(i, 'odometer_km', 'number', `min="0" step="1" value="${i.odometer_km ?? ''}" style="width:110px"`) : esc(i.odometer_km ?? '–')}</td>
          <td>${editable ? input(i, 'last_service_on', 'date', `value="${val(i.last_service_on)}"`) : fdate(i.last_service_on)}</td>
          <td>${editable ? input(i, 'first_aid_kit_until', 'date', `value="${val(i.first_aid_kit_until)}"`) : fdate(i.first_aid_kit_until)}</td>
          <td>${editable ? input(i, 'accessories_complete', 'checkbox', i.accessories_complete ? 'checked' : '') : (i.accessories_complete ? '✔️' : '')}</td>
          <td>${editable ? input(i, 'note', 'text', `maxlength="2000" value="${esc(i.note)}"`) : esc(i.note)}</td></tr>`).join('')}</tbody></table></div>`).join('')
        : empty('Diese Runde enthält keine Fahrzeuge.')}</div>`;
  }

  // Werte aus der Tabelle der offenen Runde einsammeln
  const collect = () => {
    const byId = new Map();
    for (const el of $$('#f-detail [data-item]')) {
      const row = byId.get(el.dataset.item) || { id: el.dataset.item };
      const k = el.dataset.k;
      if (k === 'accessories_complete') row[k] = el.checked;
      else if (k === 'odometer_km') row[k] = el.value === '' ? null : Number(el.value);
      else if (k === 'note') row[k] = el.value;
      else row[k] = el.value || null;
      byId.set(el.dataset.item, row);
    }
    const body = { items: [...byId.values()] };
    if ($('#f-date')?.value) body.checked_on = $('#f-date').value;
    return body;
  };

  async function load() {
    [groups, vehicles, checks] = await Promise.all([
      api.get(`/fleet/groups?team_id=${teamId}`), api.get(`/fleet/vehicles?team_id=${teamId}&all=1`), api.get(`/fleet/checks?team_id=${teamId}`),
    ]);
    drawBars();
    drawChecks();
    drawVehicles();
    await drawDetail();
  }

  $('#f-team').addEventListener('change', async () => {
    teamId = $('#f-team').value;
    remember(teamId);
    openCheck = null;
    await load().catch((e) => toast(e.message, true));
  });
  view.addEventListener('change', (e) => {
    if (e.target.id === 'f-retired') { showRetired = e.target.checked; drawVehicles(); }
  });
  view.addEventListener('click', async (event) => {
    const t = event.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    const vehicle = (id) => vehicles.find((v) => v.id === id);
    try {
      let changed = false;
      if (t.id === 'f-group-new') changed = await groupForm(null, teamId);
      else if (d.groupEdit) changed = await groupForm(groups.find((g) => g.id === d.groupEdit), teamId);
      else if (d.groupDel && await confirmBox('Gruppe löschen', 'Die leere Gruppe wird gelöscht.')) { await api.del(`/fleet/groups/${d.groupDel}`); changed = true; }
      else if (t.id === 'f-vehicle-new') changed = await vehicleForm(null, groups, teamId);
      else if (d.vehicleEdit) changed = await vehicleForm(vehicle(d.vehicleEdit), groups, teamId);
      else if (d.retire) { const v = vehicle(d.retire); await api.patch(`/fleet/vehicles/${v.id}`, { active: !v.active }); changed = true; }
      else if (d.vehicleDel && await confirmBox('Fahrzeug löschen', 'Das Fahrzeug wird gelöscht. Kommt es schon in Kontrollrunden vor, musst du es stattdessen ausmustern.')) { await api.del(`/fleet/vehicles/${d.vehicleDel}`); changed = true; }
      else if (d.up || d.down) {
        const v = vehicle(d.up || d.down);
        const list = vehicles.filter((x) => x.group_id === v.group_id && (showRetired || x.active));
        const i = list.indexOf(v), j = d.up ? i - 1 : i + 1;
        [list[i], list[j]] = [list[j], list[i]];
        const others = vehicles.filter((x) => !list.includes(x));
        await api.put('/fleet/vehicles/order', { team_id: teamId, ids: [...others, ...list].map((x) => x.id) });
        changed = true;
      } else if (t.id === 'f-check-new') {
        const r = await api.post('/fleet/checks', { team_id: teamId });
        openCheck = r.id;
        toast('Runde angelegt – Werte der letzten Runde sind übernommen');
        changed = true;
      } else if (d.open) { openCheck = d.open; await drawDetail(); $('#f-detail').scrollIntoView({ behavior: 'smooth' }); }
      else if (d.checkDel && await confirmBox('Runde löschen', 'Die Kontrollrunde wird endgültig gelöscht.')) {
        await api.del(`/fleet/checks/${d.checkDel}`);
        if (openCheck === d.checkDel) openCheck = null;
        changed = true;
      } else if (t.id === 'f-close') { openCheck = null; await drawDetail(); }
      else if (t.id === 'f-save') { await api.patch(`/fleet/checks/${openCheck}`, collect()); toast('Gespeichert'); changed = true; }
      else if (t.id === 'f-done') { await api.patch(`/fleet/checks/${openCheck}`, { ...collect(), done: true }); toast('Runde erledigt'); changed = true; }
      else if (t.id === 'f-undone' && await confirmBox('Erledigt zurücknehmen', 'Die Runde ist danach wieder offen.', 'Zurücknehmen')) {
        await api.patch(`/fleet/checks/${openCheck}`, { done: false });
        changed = true;
      } else if (t.id === 'f-md') await showMarkdown(checks.find((c) => c.id === openCheck));
      if (changed) await load();
    } catch (error) {
      toast(error.message, true);
    }
  });

  await load();
}
