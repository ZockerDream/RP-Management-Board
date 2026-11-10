import { api } from '../api.js';
import { $, esc, eur, fdate, empty, budgetTag, opts, debounce, confirmBox, toast } from '../ui.js';
import { txForm, loadBudgets } from './common.js';
import { can } from '../app.js';

export async function render(view) {
  const budgets = await loadBudgets();
  const f = { scope: 'all', budget_id: '', type: '', income_kind: '', from: '', to: '', q: '', offset: 0 };
  const LIMIT = 50;
  const cats = [...new Map(budgets.flatMap((b) => b.categories).map((c) => [c.name, c])).values()];

  view.innerHTML = `<div class="page-head"><div><h1>Transaktionen</h1><p>Alle Buchungen deiner Konten</p></div>
    <div class="actions">${can('transaction:export') ? '<button class="btn ghost" id="t-csv">CSV-Export</button>' : ''}${can('transaction:create') ? '<button class="btn" id="t-new">Neue Buchung</button>' : ''}</div></div>
    <div class="card"><div class="toolbar" style="flex-wrap:wrap;gap:8px">
      <div class="seg" id="t-scope"><button data-s="all" class="on">Alle</button><button data-s="solo">Solo</button><button data-s="shared">Organisation</button></div>
      <input id="t-q" placeholder="Suchen…" style="width:180px">
      <select id="t-budget"><option value="">Alle Konten</option>${opts(budgets, '')}</select>
      <select id="t-type"><option value="">Alle Arten</option><option value="expense">Ausgaben</option><option value="income">Einnahmen</option><option value="deposit">Einzahlungen</option></select>
      <select id="t-income-kind"><option value="">Alle Einnahmen</option><option value="salary">Gehalt</option><option value="other">Sonstige Einnahmen</option></select>
      <input type="date" id="t-from" title="Von" style="width:150px"><input type="date" id="t-to" title="Bis" style="width:150px">
    </div><div id="t-sum" class="row" style="gap:18px;margin:10px 0"></div><div class="scroll-x" id="t-table"></div><div id="t-pager" class="row between" style="margin-top:12px"></div></div>`;

  const qs = () => new URLSearchParams(Object.entries({ ...f, limit: LIMIT }).filter(([, v]) => v !== '' && v !== null)).toString();
  async function load() {
    const r = await api.get(`/transactions?${qs()}`);
    $('#t-sum').innerHTML = `<span class="muted">${r.total} Buchungen</span><span class="up">Einnahmen ${eur(r.income)}</span><span class="up">davon Gehalt ${eur(r.salary_income)}</span><span class="down">Ausgaben ${eur(r.expense)}</span>`;
    $('#t-table').innerHTML = r.items.length ? `<table class="table"><thead><tr><th>Datum</th><th>Titel</th><th>Kategorie</th><th>Konto</th><th>Von</th><th style="text-align:right">Betrag</th><th></th></tr></thead><tbody>${r.items.map((t) => `<tr>
      <td>${fdate(t.booked_at)}</td>      <td><b>${esc(t.title || '–')}</b>${t.income_kind === 'salary' ? ' <span class="tag">Gehalt</span>' : ''}${t.attachments ? ' 📎' : ''}${t.tags?.length ? `<br><small class="muted">${t.tags.map((g) => '#' + esc(g)).join(' ')}</small>` : ''}</td>
      <td>${esc(t.category_name || '–')}</td><td>${budgetTag(t.budget_type, t.budget_name)}</td><td>${esc(t.created_by_name || '–')}</td>
      <td style="text-align:right" class="${t.type === 'expense' ? 'down' : 'up'}"><b>${t.type === 'expense' ? '−' : '+'}${eur(t.amount)}</b></td>
      <td style="white-space:nowrap">${t.source === 'manual' || !t.source ? '' : `<span class="tag">${t.source === 'interest' ? 'Zinsen' : 'auto'}</span> `}${can('transaction:update') && !['payroll', 'interest'].includes(t.source) ? `<button class="btn ghost sm" data-edit="${t.id}">Bearbeiten</button>` : ''}${can('transaction:delete') && t.source !== 'payroll' ? ` <button class="btn ghost sm" data-del="${t.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table>` : empty('Keine Buchungen gefunden.');
    $('#t-pager').innerHTML = `<button class="btn ghost sm" id="t-prev" ${f.offset ? '' : 'disabled'}>Zurück</button><span class="muted">${r.total ? f.offset + 1 : 0}–${Math.min(f.offset + LIMIT, r.total)} von ${r.total}</span><button class="btn ghost sm" id="t-next" ${f.offset + LIMIT < r.total ? '' : 'disabled'}>Weiter</button>`;
    view._items = r.items;
  }
  const reset = () => { f.offset = 0; load(); };
  view.addEventListener('click', async (e) => {
    const s = e.target.closest('#t-scope [data-s]');
    if (s) { f.scope = s.dataset.s; document.querySelectorAll('#t-scope button').forEach((b) => b.classList.toggle('on', b === s)); reset(); }
    if (e.target.closest('#t-new') && (await txForm())) load();
    if (e.target.closest('#t-prev')) { f.offset = Math.max(0, f.offset - LIMIT); load(); }
    if (e.target.closest('#t-next')) { f.offset += LIMIT; load(); }
    if (e.target.closest('#t-csv')) api.download(`/transactions/export.csv?${qs()}`, 'transaktionen.csv').catch((x) => toast(x.message, true));
    const ed = e.target.closest('[data-edit]');
    if (ed && (await txForm(view._items.find((t) => t.id === ed.dataset.edit)))) load();
    const de = e.target.closest('[data-del]');
    if (de && (await confirmBox('Buchung löschen', 'Diese Buchung wirklich löschen?'))) {
      try { await api.del(`/transactions/${de.dataset.del}`); toast('Gelöscht'); load(); } catch (x) { toast(x.message, true); }
    }
  });
  const bind = (id, k) => $(id).addEventListener('change', (e) => { f[k] = e.target.value; reset(); });
  bind('#t-budget', 'budget_id'); bind('#t-type', 'type'); bind('#t-income-kind', 'income_kind'); bind('#t-from', 'from'); bind('#t-to', 'to');
  $('#t-q').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); reset(); }));
  void cats;
  await load();
}
