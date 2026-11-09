import { api } from '../api.js';
import { $, esc, eur, empty, budgetTag, progress, openForm, confirmBox, toast, parseAmount, fdate } from '../ui.js';
import { loadBudgets } from './common.js';
import { can, state } from '../app.js';

async function budgetForm(b) {
  const teams = !b && can('team:read') ? (await api.get('/teams')).filter((t) => t.levels.budget >= 3) : [];
  const currency = b?.currency || state.me.currency || 'EUR';
  const fields = [
    { name: 'name', label: 'Name', value: b?.name, required: true, full: true },
    ...(b ? [] : [{ name: 'type', label: 'Typ', type: 'select', options: [{ v: 'solo', l: 'Solo' }, ...(teams.length ? [{ v: 'shared', l: 'Geteilt (Organisation)' }] : [])], value: 'solo' },
      { name: 'team_id', label: 'Organisation (bei geteilt)', type: 'select', options: teams.map((t) => ({ v: t.id, l: t.name })), value: teams[0]?.id }]),
    { name: 'currency', label: 'Währung', type: 'select', options: [...new Set(['EUR', 'USD', 'CHF', 'GBP', currency])].map((c) => ({ v: c, l: c })), value: currency, help: 'Beträge werden beim Ändern nicht umgerechnet.' },
  ];
  return openForm({
    title: b ? 'Konto bearbeiten' : 'Neues Konto', fields,
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), currency: v.currency };
      if (b) await api.patch(`/budgets/${b.id}`, body);
      else await api.post('/budgets', { ...body, type: v.type, team_id: v.type === 'shared' ? v.team_id : null });
      toast('Konto gespeichert');
    },
  });
}

async function catForm(b, c) {
  return openForm({
    title: c ? 'Kategorie bearbeiten' : 'Neue Kategorie', fields: [
      { name: 'name', label: 'Name', value: c?.name, required: true, full: true },
      { name: 'limit_amount', label: 'Limit (optional)', value: c?.limit_amount ? String(c.limit_amount).replace('.', ',') : '' },
      { name: 'color', label: 'Farbe', type: 'color', value: c?.color || '#6366f1' },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), limit_amount: v.limit_amount ? parseAmount(v.limit_amount) : null, color: v.color };
      if (c) await api.patch(`/categories/${c.id}`, body); else await api.post(`/budgets/${b.id}/categories`, body);
    },
  });
}

export async function render(view) {
  let scope = 'all', sel = null, budgets = [];
  view.innerHTML = `<div class="page-head"><div><h1>Konten</h1><p>Persönliche Konten und geteilte Konten einer Organisation getrennt verwalten</p></div>
    <div class="actions"><div class="seg" id="b-scope"><button data-s="all" class="on">Alle</button><button data-s="solo">Solo</button><button data-s="shared">Geteilt</button></div>
    ${can('budget:create') ? '<button class="btn" id="b-new">Neues Konto</button>' : ''}</div></div><div id="b-body"></div>`;

  async function load() {
    budgets = await loadBudgets();
    const list = budgets.filter((b) => scope === 'all' || b.type === scope);
    if (!list.find((b) => b.id === sel)) sel = list[0]?.id;
    const cur = list.find((b) => b.id === sel);
    $('#b-body').innerHTML = (list.length ? `<div class="grid cols-3">${list.map((b) => `<div class="card stack" data-sel="${b.id}" style="cursor:pointer;${b.id === sel ? 'outline:2px solid var(--primary)' : ''}">
      <div class="row"><b>${esc(b.name)}</b>${budgetTag(b.type, b.type === 'solo' ? 'Persönlich' : 'Geteilt')}</div>
      <small class="muted">${b.team_name ? `Organisation „${esc(b.team_name)}“` : 'Persönliches Konto'}</small>
      <div class="row"><b>${eur(b.balance)}</b><span class="muted">Kontostand</span></div>
      <div class="row"><span class="muted">Einkommen</span><b style="color:var(--success,#16a34a)">${eur(b.income)}</b></div>
      <div class="row"><span class="muted">Ausgaben</span><b>${eur(b.expenses)}</b></div>
      <div class="chips">${b.categories.slice(0, 4).map((c) => `<span class="chip">${esc(c.name)}</span>`).join('')}</div>
      <div class="row">${can('budget:update') && b.level >= 3 ? `<button class="btn ghost sm" data-edit="${b.id}">Bearbeiten</button>` : ''}${can('budget:delete') && b.level >= 4 ? `<button class="btn ghost sm" data-del="${b.id}">Löschen</button>` : ''}</div></div>`).join('')}</div>` : `<div class="card">${empty('Noch keine Konten vorhanden.')}</div>`)
      + (cur ? `<div class="card"><div class="card-head"><h2>Kategorien · ${esc(cur.name)}</h2>${can('budget:update') && cur.level >= 3 ? '<button class="btn ghost sm" id="c-new">Kategorie hinzufügen</button>' : ''}</div>
      ${cur.categories.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Kategorie</th><th>Ausgegeben</th><th>Limit</th><th style="width:34%">Auslastung</th><th></th></tr></thead><tbody>${cur.categories.map((c) => {
        const pct = Number(c.limit_amount) > 0 ? (Number(c.used) / Number(c.limit_amount)) * 100 : 0;
        return `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${esc(c.color || '#94a3b8')};margin-right:6px"></i>${esc(c.name)}</td><td>${eur(c.used)}</td><td>${c.limit_amount ? eur(c.limit_amount) : '–'}</td><td>${c.limit_amount ? progress(pct) : ''}</td>
        <td style="white-space:nowrap">${can('budget:update') && cur.level >= 3 ? `<button class="btn ghost sm" data-cedit="${c.id}">Bearbeiten</button> <button class="btn ghost sm" data-cdel="${c.id}">Löschen</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : empty('Keine Kategorien.')}</div>` : '');
  }

  view.addEventListener('click', async (e) => {
    const t = (s) => e.target.closest(s);
    const cur = budgets.find((b) => b.id === sel);
    try {
      if (t('#b-scope [data-s]')) { scope = t('#b-scope [data-s]').dataset.s; document.querySelectorAll('#b-scope button').forEach((x) => x.classList.toggle('on', x === t('#b-scope [data-s]'))); return load(); }
      if (t('#b-new')) { if (await budgetForm()) load(); return; }
      if (t('[data-edit]')) { if (await budgetForm(budgets.find((b) => b.id === t('[data-edit]').dataset.edit))) load(); return; }
      if (t('[data-del]')) {
        if (await confirmBox('Konto löschen', 'Das Konto inklusive aller Buchungen wird unwiderruflich gelöscht.')) { await api.del(`/budgets/${t('[data-del]').dataset.del}`); toast('Gelöscht'); load(); }
        return;
      }
      if (t('#c-new')) { if (await catForm(cur)) load(); return; }
      if (t('[data-cedit]')) { if (await catForm(cur, cur.categories.find((c) => c.id === t('[data-cedit]').dataset.cedit))) load(); return; }
      if (t('[data-cdel]')) { if (await confirmBox('Kategorie löschen', 'Buchungen bleiben erhalten, verlieren aber die Kategorie.')) { await api.del(`/categories/${t('[data-cdel]').dataset.cdel}`); load(); } return; }
      if (t('[data-sel]')) { sel = t('[data-sel]').dataset.sel; load(); }
    } catch (x) { toast(x.message, true); }
  });
  await load();
}
