import { api } from '../api.js';
import { $, esc, eur, empty, openForm, confirmBox, toast, parseAmount, fdate, progress } from '../ui.js';
import { loadBudgets, txForm } from './common.js';
import { can } from '../app.js';

async function form(g) {
  const budgets = await loadBudgets();
  if (!budgets.length) { toast('Bitte zuerst ein Budget anlegen', true); return false; }
  return openForm({
    title: g ? 'Sparziel bearbeiten' : 'Neues Sparziel', fields: [
      { name: 'name', label: 'Name', value: g?.name, required: true, full: true },
      { name: 'budget_id', label: 'Budget', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })), value: g?.budget_id },
      { name: 'target_amount', label: 'Zielbetrag', value: g ? String(g.target_amount).replace('.', ',') : '', required: true },
      { name: 'target_date', label: 'Zieldatum (optional)', type: 'date', value: g?.target_date?.slice(0, 10) },
      { name: 'monthly_amount', label: 'Monatliche Rate (optional)', value: g?.monthly_amount ? String(g.monthly_amount).replace('.', ',') : '' },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), target_amount: parseAmount(v.target_amount), target_date: v.target_date || null, monthly_amount: v.monthly_amount ? parseAmount(v.monthly_amount) : null };
      if (g) await api.patch(`/goals/${g.id}`, body); else await api.post('/goals', { ...body, budget_id: v.budget_id });
    },
  });
}

export async function render(view) {
  let goals = [];
  view.innerHTML = `<div class="page-head"><div><h1>Sparziele</h1><p>Fortschritt deiner Ziele im Blick</p></div>
    <div class="actions">${can('goal:create') ? '<button class="btn" id="g-new">Neues Sparziel</button>' : ''}</div></div><div id="g-body"></div>`;
  async function load() {
    goals = await api.get('/goals');
    $('#g-body').innerHTML = goals.length ? `<div class="grid cols-3">${goals.map((g) => {
      const pct = Math.min(100, (Number(g.saved) / Number(g.target_amount)) * 100);
      return `<div class="card stack"><div class="row"><b>${esc(g.name)}</b><span class="tag solo">${esc(g.budget_name)}</span></div>
        <small class="muted">${g.target_date ? `bis ${fdate(g.target_date)}` : 'ohne Termin'}${g.monthly_amount ? ` · Rate ${eur(g.monthly_amount)}/Monat` : ''}</small>
        <div class="row"><b>${eur(g.saved)}</b><span class="muted">von ${eur(g.target_amount)} (${Math.round(pct)} %)</span></div>${progress(pct)}
        <div class="row">${can('transaction:create') ? `<button class="btn sm" data-dep="${g.id}">Einzahlen</button>` : ''}${can('goal:update') ? `<button class="btn ghost sm" data-edit="${g.id}">Bearbeiten</button>` : ''}${can('goal:delete') ? `<button class="btn ghost sm" data-del="${g.id}">Löschen</button>` : ''}</div></div>`;
    }).join('')}</div>` : `<div class="card">${empty('Noch keine Sparziele.')}</div>`;
  }
  view.addEventListener('click', async (e) => {
    const t = (s) => e.target.closest(s);
    try {
      if (t('#g-new')) { if (await form()) load(); }
      else if (t('[data-edit]')) { if (await form(goals.find((g) => g.id === t('[data-edit]').dataset.edit))) load(); }
      else if (t('[data-dep]')) {
        const g = goals.find((x) => x.id === t('[data-dep]').dataset.dep);
        if (await txForm(null, { type: 'deposit', budget_id: g.budget_id, goal_id: g.id, title: `Einzahlung ${g.name}` })) load();
      } else if (t('[data-del]') && (await confirmBox('Sparziel löschen', 'Einzahlungen bleiben als Buchungen erhalten.'))) { await api.del(`/goals/${t('[data-del]').dataset.del}`); load(); }
    } catch (x) { toast(x.message, true); }
  });
  await load();
}
