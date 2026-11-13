// Lager & Ausrüstung (Wunsch des Auftraggebers vom 2026-11-13): Stücke mit Seriennummer, Ausgabe und Rückgabe.
// Funktion „Lager & Ausrüstung“: eigene Ausrüstung sieht jedes Mitglied; 2 Lager sehen, 3 anlegen und ausgeben, 4 löschen.
import { api } from '../api.js';
import { $, esc, empty, tag, fdate, fdatetime, openForm, confirmBox, toast, todayStr } from '../ui.js';
import { can, state } from '../app.js';
import { loadTeams, pickTeam, rememberTeam, teamSelect, noTeam } from './org-pick.js';

const STATUS = { available: ['ok', 'Im Lager'], issued: ['primary', 'Ausgegeben'], maintenance: ['warn', 'In Wartung'], lost: ['bad', 'Verloren'], retired: ['', 'Ausgemustert'] };

export async function render(view, params) {
  const teams = await loadTeams('equipment', 0);
  let teamId = pickTeam(teams, 'equipment', params?.get?.('team'));
  let data = { items: [], level: 0 };
  const filter = { q: '', status: '', category: '' };
  let members = null;
  view.innerHTML = `<div class="page-head"><div><h1>Lager</h1><p>Ausrüstung der Organisation, Ausgabe und Rückgabe</p></div>
    <div class="actions">${teamSelect(teams, teamId)}<span id="eq-actions"></span></div></div>
    ${teams.length ? '<div id="eq-mine"></div><div id="eq-body"></div>' : noTeam('das Lager')}`;
  if (!teams.length) return;

  const shown = () => data.items.filter((i) => (!filter.status || i.status === filter.status) && (!filter.category || i.category === filter.category)
    && (!filter.q || `${i.name} ${i.serial} ${i.category} ${i.holder_name || ''}`.toLowerCase().includes(filter.q)));
  function draw() {
    const write = data.level >= 3;
    $('#eq-actions', view).innerHTML = write && can('equipment:create') ? '<button class="btn" id="eq-new">Ausrüstung anlegen</button>' : '';
    const mine = data.items.filter((i) => i.holder_id === state.me.id);
    $('#eq-mine', view).innerHTML = mine.length ? `<div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Meine Ausrüstung</h2><small>${mine.length} Stück</small></div>
      ${mine.map((i) => `<div class="list-item"><div class="grow"><b>${esc(i.name)}</b><small>${esc([i.category, i.serial].filter(Boolean).join(' · '))} · seit ${fdate(i.issued_at)}</small></div>${i.due_on ? tag(i.due_on < todayStr() ? 'bad' : '', `zurück bis ${fdate(i.due_on)}`) : ''}</div>`).join('')}</div>` : '';
    if (data.level < 2) { $('#eq-body', view).innerHTML = mine.length ? '' : `<div class="card">${empty('Dir ist keine Ausrüstung ausgegeben.')}</div>`; return; }
    const cats = [...new Set(data.items.map((i) => i.category).filter(Boolean))].sort();
    const list = shown();
    const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, data.items.filter((i) => i.status === k).length]));
    $('#eq-body', view).innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="eq-q" type="search" class="search" placeholder="Name, Seriennummer, Inhaber…" value="${esc(filter.q)}" aria-label="Lager durchsuchen">
      <select id="eq-status" aria-label="Zustand"><option value="">Alle Zustände</option>${Object.entries(STATUS).map(([k, [, l]]) => `<option value="${k}" ${filter.status === k ? 'selected' : ''}>${l} (${counts[k]})</option>`).join('')}</select>
      <select id="eq-cat" aria-label="Kategorie"><option value="">Alle Kategorien</option>${cats.map((c) => `<option ${filter.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="card">${list.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Ausrüstung</th><th>Seriennummer</th><th>Zustand</th><th>Bei</th><th></th></tr></thead><tbody>
      ${list.map((i) => `<tr><td><b>${esc(i.name)}</b>${i.category ? `<br><small class="muted">${esc(i.category)}</small>` : ''}</td><td>${esc(i.serial || '–')}</td><td>${tag(...STATUS[i.status])}</td>
        <td>${i.holder_name ? `${esc(i.holder_name)}<br><small class="muted">seit ${fdate(i.issued_at)}${i.due_on ? `, bis ${fdate(i.due_on)}` : ''}</small>` : '–'}</td>
        <td style="white-space:nowrap">${write && i.status === 'available' ? `<button class="btn sm" data-issue="${i.id}">Ausgeben</button> ` : ''}${write && i.status === 'issued' ? `<button class="btn sm" data-return="${i.id}">Zurücknehmen</button> ` : ''}
          <button class="btn ghost sm" data-history="${i.id}">Verlauf</button>${write ? ` <button class="btn ghost sm" data-edit="${i.id}">Bearbeiten</button>` : ''}${data.level >= 4 && i.status !== 'issued' ? ` <button class="btn ghost sm" data-del="${i.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : empty(data.items.length ? 'Nichts gefunden.' : 'Das Lager ist leer.')}</div>`;
    $('#eq-q', view).addEventListener('input', (e) => { filter.q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; draw(); const n = $('#eq-q', view); n.focus(); n.setSelectionRange(pos, pos); });
    $('#eq-status', view).addEventListener('change', (e) => { filter.status = e.target.value; draw(); });
    $('#eq-cat', view).addEventListener('change', (e) => { filter.category = e.target.value; draw(); });
  }
  async function load() { data = await api.get(`/equipment?team_id=${teamId}`); draw(); }

  const itemForm = (i) => openForm({
    title: i ? 'Ausrüstung bearbeiten' : 'Ausrüstung anlegen',
    fields: [
      { name: 'name', label: 'Bezeichnung', value: i?.name, required: true, maxlength: 120, placeholder: 'z. B. Funkgerät' },
      { name: 'category', label: 'Kategorie', value: i?.category, maxlength: 60, suggestions: [...new Set(data.items.map((x) => x.category).filter(Boolean))], placeholder: 'z. B. Funk, Waffen, Schutz' },
      { name: 'serial', label: i ? 'Seriennummer' : 'Seriennummer (bei Anzahl > 1: Präfix, z. B. FUNK-)', value: i?.serial, maxlength: 60 },
      ...(i ? [] : [{ name: 'count', label: 'Anzahl', type: 'number', min: 1, max: 200, step: 1, value: 1 }]),
      ...(i && i.status !== 'issued' ? [{ name: 'status', label: 'Zustand', type: 'select', options: ['available', 'maintenance', 'lost', 'retired'].map((v) => ({ v, l: STATUS[v][1] })), value: i.status }] : []),
      { name: 'note', label: 'Notiz', value: i?.note, maxlength: 2000, full: true },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), category: v.category.trim(), serial: v.serial.trim(), note: v.note };
      if (i) { if (v.status) body.status = v.status; await api.patch(`/equipment/${i.id}`, body); toast('Gespeichert'); return; }
      const r = await api.post('/equipment', { ...body, team_id: teamId, count: Number(v.count) || 1 });
      toast(`${r.ids.length} angelegt`);
    },
  });
  async function issueForm(i) {
    members = members || await api.get(`/org-members?team_id=${teamId}&module=equipment&min=3`);
    return openForm({
      title: `Ausgeben: ${i.name}${i.serial ? ` (${i.serial})` : ''}`,
      fields: [
        { name: 'user_id', label: 'An', type: 'select', options: members.map((m) => ({ v: m.user_id, l: `${m.name}${m.rank_name ? ` (${m.rank_name})` : ''}` })) },
        { name: 'due_on', label: 'Zurück bis (optional)', type: 'date' },
        { name: 'note', label: 'Notiz', maxlength: 500, full: true },
      ],
      submit: 'Ausgeben',
      onSubmit: (v) => api.post(`/equipment/${i.id}/issue`, { user_id: v.user_id, due_on: v.due_on || null, note: v.note.trim() }),
    });
  }
  const returnForm = (i) => openForm({
    title: `Zurücknehmen: ${i.name}`,
    fields: [
      { type: 'html', html: `<p>Ausgegeben an <b>${esc(i.holder_name)}</b> seit ${fdate(i.issued_at)}.</p>` },
      { name: 'status', label: 'Zustand danach', type: 'select', options: ['available', 'maintenance', 'lost'].map((v) => ({ v, l: STATUS[v][1] })) },
      { name: 'note', label: 'Notiz', maxlength: 500, full: true },
    ],
    submit: 'Zurücknehmen',
    onSubmit: (v) => api.post(`/equipment/${i.id}/return`, { status: v.status, note: v.note.trim() }),
  });

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !view.contains(b)) return;
    const item = (id) => data.items.find((i) => i.id === id);
    const d = b.dataset;
    try {
      let changed = false;
      if (b.id === 'eq-new') changed = await itemForm(null);
      else if (d.edit) changed = await itemForm(item(d.edit));
      else if (d.issue) changed = await issueForm(item(d.issue));
      else if (d.return) changed = await returnForm(item(d.return));
      else if (d.del && await confirmBox('Ausrüstung löschen', 'Das Stück wird samt Verlauf gelöscht. Zum Aufbewahren stattdessen „Ausgemustert“ wählen.')) { await api.del(`/equipment/${d.del}`); changed = true; }
      else if (d.history) {
        const h = await api.get(`/equipment/${d.history}/history`);
        await openForm({ title: `Verlauf: ${item(d.history).name}`, submit: 'Schließen', fields: [{ type: 'html', html: h.length ? h.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.user_name)}</b><small>ausgegeben ${fdatetime(x.issued_at)} von ${esc(x.issued_by_name || '–')}${x.returned_at ? ` · zurück ${fdatetime(x.returned_at)} (${esc(x.returned_by_name || '–')})` : ' · noch ausgegeben'}${x.return_note ? ` · ${esc(x.return_note)}` : ''}</small></div></div>`).join('') : '<p class="muted">Noch nie ausgegeben.</p>' }], onSubmit: async () => true });
      }
      if (changed) await load();
    } catch (error) { toast(error.message, true); }
  });
  $('#org-team', view)?.addEventListener('change', async (e) => { teamId = e.target.value; rememberTeam('equipment', teamId); members = null; await load(); });
  await load();
}
