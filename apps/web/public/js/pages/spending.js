import { api } from '../api.js';
import { $, esc, eur, empty, progress, openForm, confirmBox, toast, parseAmount, fdate } from '../ui.js';
import { loadBudgets } from './common.js';
import { can } from '../app.js';

const PERIODS = [{ v: 'daily', l: 'Pro Tag' }, { v: 'weekly', l: 'Pro Woche' }, { v: 'monthly', l: 'Pro Monat' }, { v: 'yearly', l: 'Pro Jahr' }];
const periodLabel = (value) => PERIODS.find((period) => period.v === value)?.l || value;

async function spendingForm(item) {
  const accounts = await loadBudgets();
  const categories = accounts.flatMap((account) => account.categories.map((category) => ({ v: category.id, l: `${category.name} · ${account.name}` })));
  return openForm({
    title: item ? 'Budget bearbeiten' : 'Neues Budget',
    fields: [
      { name: 'name', label: 'Wofür? (z. B. Lebensmittel)', value: item?.name, required: true, full: true },
      { name: 'limit_amount', label: 'Betrag', value: item ? String(item.limit_amount).replace('.', ',') : '', required: true, placeholder: '0,00' },
      { name: 'period_type', label: 'Zeitraum', type: 'select', options: PERIODS, value: item?.period_type || 'weekly' },
      { name: 'category_id', label: 'Kategorie (optional)', type: 'select', options: [{ v: '', l: '– Alle Kategorien –' }, ...categories], value: item?.category_id || '' },
      { name: 'budget_id', label: 'Konto (optional)', type: 'select', options: [{ v: '', l: '– Alle Konten –' }, ...accounts.map((account) => ({ v: account.id, l: account.name }))], value: item?.budget_id || '' },
    ],
    onSubmit: async (v) => {
      const amount = Number(parseAmount(v.limit_amount));
      if (!(amount > 0)) throw new Error('Betrag muss größer als 0 sein');
      const body = { name: v.name.trim(), limit_amount: amount, period_type: v.period_type, category_id: v.category_id || null, budget_id: v.budget_id || null };
      if (item) await api.patch(`/spending-budgets/${item.id}`, body);
      else await api.post('/spending-budgets', body);
    },
  });
}

export async function render(view) {
  let items = [];
  view.innerHTML = `<div class="page-head"><div><h1>Budgets</h1><p>Ausgabenlimits für einzelne Bereiche, z. B. pro Woche</p></div>
    <div class="actions">${can('budget:update') ? '<button class="btn" id="s-new">Neues Budget</button>' : ''}</div></div><div id="s-body"></div>`;

  async function load() {
    items = await api.get('/spending-budgets');
    $('#s-body').innerHTML = items.length ? `<div class="grid cols-3">${items.map((item) => `<div class="card stack">
      <div class="row"><b>${esc(item.name)}</b><span class="chip">${periodLabel(item.period_type)}</span></div>
      <small class="muted">${esc(item.category_name || 'Alle Kategorien')} · ${esc(item.account_name || 'Alle Konten')}<br>${fdate(item.period_from)} – ${fdate(item.period_to)}</small>
      <div class="row"><b>${eur(item.used)}</b><span class="muted">von ${eur(item.limit_amount)}</span></div>${progress(item.pct)}
      <small class="muted">${Number(item.remaining) >= 0 ? `Noch ${eur(item.remaining)} verfügbar` : `${eur(-Number(item.remaining))} überschritten`}</small>
      ${can('budget:update') ? `<div class="row"><button class="btn ghost sm" data-edit="${item.id}">Bearbeiten</button><button class="btn ghost sm" data-del="${item.id}">Löschen</button></div>` : ''}</div>`).join('')}</div>`
      : `<div class="card">${empty('Noch keine Budgets angelegt.')}</div>`;
  }

  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.id === 's-new') { if (await spendingForm()) await load(); }
      else if (target.dataset.edit) { if (await spendingForm(items.find((item) => item.id === target.dataset.edit))) await load(); }
      else if (target.dataset.del && await confirmBox('Budget löschen', 'Das Budget wird gelöscht; Buchungen bleiben erhalten.')) {
        await api.del(`/spending-budgets/${target.dataset.del}`);
        await load();
      }
    } catch (error) { toast(error.message, true); }
  });
  await load();
}
