import { api } from '../api.js';
import { $, esc, eur, empty, openForm, confirmBox, toast, parseAmount, fdate, todayStr } from '../ui.js';
import { loadBudgets } from './common.js';
import { can } from '../app.js';

const FREQ = { daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich', yearly: 'Jährlich' };

async function form(r) {
  const budgets = await loadBudgets();
  if (!budgets.length) { toast('Bitte zuerst ein Budget anlegen', true); return false; }
  const bid = r?.budget_id || budgets[0].id;
  const catOpts = (id) => [{ v: '', l: '– Keine –' }, ...(budgets.find((b) => b.id === id)?.categories || []).map((c) => ({ v: c.id, l: c.name }))];
  const p = openForm({
    title: r ? 'Dauerauftrag bearbeiten' : 'Neuer Dauerauftrag', fields: [
      { name: 'name', label: 'Name', value: r?.name, required: true, full: true },
      { name: 'type', label: 'Art', type: 'select', options: [{ v: 'expense', l: 'Ausgabe' }, { v: 'income', l: 'Einnahme' }], value: r?.type || 'expense' },
      { name: 'amount', label: 'Betrag', value: r ? String(r.amount).replace('.', ',') : '', required: true },
      { name: 'budget_id', label: 'Budget', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })), value: bid },
      { name: 'category_id', label: 'Kategorie', type: 'select', options: catOpts(bid), value: r?.category_id || '' },
      { name: 'frequency', label: 'Rhythmus', type: 'select', options: Object.entries(FREQ).map(([v, l]) => ({ v, l })), value: r?.frequency || 'monthly' },
      { name: 'interval', label: 'Alle … Einheiten', type: 'number', min: 1, value: r?.interval || 1 },
      { name: 'start_date', label: 'Start', type: 'date', value: r?.start_date?.slice(0, 10) || todayStr(), required: true },
      { name: 'end_date', label: 'Ende (optional)', type: 'date', value: r?.end_date?.slice(0, 10) },
      { name: 'active', label: 'Aktiv', type: 'checkbox', value: r ? r.active : true },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), type: v.type, amount: parseAmount(v.amount), category_id: v.category_id || null, frequency: v.frequency, interval: Number(v.interval) || 1, start_date: v.start_date, end_date: v.end_date || null, active: v.active };
      if (r) await api.patch(`/recurring/${r.id}`, body); else await api.post('/recurring', { ...body, budget_id: v.budget_id });
    },
  });
  const sel = $('#f-budget_id');
  if (r) sel.disabled = true;
  sel.addEventListener('change', () => { $('#f-category_id').innerHTML = catOpts(sel.value).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(''); });
  return p;
}

export async function render(view) {
  let rules = [];
  view.innerHTML = `<div class="page-head"><div><h1>Daueraufträge</h1><p>Wiederkehrende Einnahmen und Ausgaben werden automatisch gebucht</p></div>
    <div class="actions">${can('recurring:create') ? '<button class="btn" id="r-new">Neuer Dauerauftrag</button>' : ''}</div></div><div class="card" id="r-body"></div>`;
  async function load() {
    rules = await api.get('/recurring');
    $('#r-body').innerHTML = rules.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Budget</th><th>Rhythmus</th><th>Nächste Buchung</th><th style="text-align:right">Betrag</th><th>Status</th><th></th></tr></thead><tbody>${rules.map((r) => `<tr>
      <td><b>${esc(r.name)}</b><br><small class="muted">${esc(r.category_name || '–')}</small></td><td>${esc(r.budget_name)}</td>
      <td>${r.interval > 1 ? `alle ${r.interval} · ` : ''}${FREQ[r.frequency]}</td><td>${r.active ? fdate(r.next_run) : '–'}</td>
      <td style="text-align:right" class="${r.type === 'expense' ? 'down' : 'up'}"><b>${r.type === 'expense' ? '−' : '+'}${eur(r.amount)}</b></td>
      <td><span class="tag ${r.active ? 'ok' : 'warn'}">${r.active ? 'Aktiv' : 'Pausiert'}</span>${r.source === 'asset' ? ' <span class="tag">Objekt</span>' : ''}</td>
      <td style="white-space:nowrap">${can('recurring:update') ? `<button class="btn ghost sm" data-edit="${r.id}">Bearbeiten</button> <button class="btn ghost sm" data-toggle="${r.id}">${r.active ? 'Pausieren' : 'Aktivieren'}</button>` : ''}${can('recurring:delete') ? ` <button class="btn ghost sm" data-del="${r.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Keine Daueraufträge.');
  }
  view.addEventListener('click', async (e) => {
    const t = (s) => e.target.closest(s);
    try {
      if (t('#r-new')) { if (await form()) load(); }
      else if (t('[data-edit]')) { if (await form(rules.find((r) => r.id === t('[data-edit]').dataset.edit))) load(); }
      else if (t('[data-toggle]')) { const r = rules.find((x) => x.id === t('[data-toggle]').dataset.toggle); await api.patch(`/recurring/${r.id}`, { active: !r.active }); load(); }
      else if (t('[data-del]') && (await confirmBox('Dauerauftrag löschen', 'Bereits erzeugte Buchungen bleiben erhalten.'))) { await api.del(`/recurring/${t('[data-del]').dataset.del}`); load(); }
    } catch (x) { toast(x.message, true); }
  });
  await load();
}
