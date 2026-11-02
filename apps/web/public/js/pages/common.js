import { api } from '../api.js';
import { openForm, todayStr, toast, parseAmount, eur, esc } from '../ui.js';

export const loadBudgets = () => api.get('/budgets');

const TYPES = [{ v: 'expense', l: 'Ausgabe' }, { v: 'income', l: 'Einnahme' }, { v: 'deposit', l: 'Einzahlung Sparziel' }];

export async function txForm(tx, defaults = {}) {
  const [budgets, goals] = await Promise.all([loadBudgets(), api.get('/goals').catch(() => [])]);
  if (!budgets.length) { toast('Bitte zuerst ein Konto anlegen', true); return false; }
  const bid = tx?.budget_id || defaults.budget_id || budgets[0].id;
  const catOpts = (id) => [{ v: '', l: '– Keine –' }, ...(budgets.find((b) => b.id === id)?.categories || []).map((c) => ({ v: c.id, l: c.name }))];
  const fields = [
    { name: 'title', label: 'Titel', value: tx?.title ?? defaults.title, full: true, required: true },
    { name: 'type', label: 'Art', type: 'select', options: TYPES, value: tx?.type || defaults.type || 'expense' },
    { name: 'income_kind', label: 'Einnahmeart', type: 'select', options: [{ v: 'other', l: 'Sonstige Einnahme' }, { v: 'salary', l: 'Gehalt' }], value: tx?.income_kind || defaults.income_kind || 'other' },
    { name: 'amount', label: 'Betrag', value: tx?.amount ? String(tx.amount).replace('.', ',') : '', required: true, placeholder: '0,00' },
    { name: 'budget_id', label: 'Konto', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })), value: bid },
    { name: 'category_id', label: 'Kategorie', type: 'select', options: catOpts(bid), value: tx?.category_id || '' },
    { name: 'booked_at', label: 'Datum', type: 'date', value: tx?.booked_at?.slice(0, 10) || todayStr(), required: true },
    { name: 'goal_id', label: 'Sparziel (bei Einzahlung)', type: 'select', options: [{ v: '', l: '– Keines –' }, ...goals.map((g) => ({ v: g.id, l: g.name }))], value: tx?.goal_id || defaults.goal_id || '' },
    { name: 'tags', label: 'Tags (Komma-getrennt)', value: (tx?.tags || []).join(', '), full: true },
    { name: 'note', label: 'Notiz', type: 'textarea', value: tx?.note, full: true },
  ];
  const p = openForm({
    title: tx ? 'Buchung bearbeiten' : 'Neue Buchung', fields,
    onSubmit: async (v) => {
      const body = {
        title: v.title.trim(), type: v.type, income_kind: v.type === 'income' ? v.income_kind : 'other', amount: parseAmount(v.amount), category_id: v.category_id || null, booked_at: v.booked_at,
        goal_id: v.type === 'deposit' ? v.goal_id || null : null, note: v.note, tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (tx) await api.patch(`/transactions/${tx.id}`, body);
      else await api.post('/transactions', { ...body, budget_id: v.budget_id }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      toast('Buchung gespeichert');
    },
  });
  const sel = document.querySelector('#f-budget_id');
  const typeSel = document.querySelector('#f-type');
  const incomeKind = document.querySelector('#f-income_kind')?.closest('label');
  const updateIncomeKind = () => { if (incomeKind) incomeKind.hidden = typeSel?.value !== 'income'; };
  typeSel?.addEventListener('change', updateIncomeKind);
  updateIncomeKind();
  if (sel) {
    if (tx) sel.disabled = true;
    sel.addEventListener('change', () => {
      document.querySelector('#f-category_id').innerHTML = catOpts(sel.value).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
    });
  }
  return p;
}

export const money = eur;
export const sumBy = (list, k) => list.reduce((a, x) => a + Number(x[k] || 0), 0);
