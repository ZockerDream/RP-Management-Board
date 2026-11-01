import { api } from '../api.js';
import { $, esc, eur, empty, openForm, confirmBox, toast, parseAmount, fdate, todayStr } from '../ui.js';
import { loadBudgets } from './common.js';
import { can } from '../app.js';

const FREQ = { daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich', yearly: 'Jährlich', custom: 'Benutzerdefiniert (Tage)' };

async function form(r) {
  const budgets = await loadBudgets();
  if (!budgets.length) { toast('Bitte zuerst ein Budget anlegen', true); return false; }
  const candidates = r ? [] : await api.get('/recurring/share-candidates');
  const bid = r?.budget_id || budgets[0].id;
  const catOpts = (id) => [{ v: '', l: '– Keine –' }, ...(budgets.find((b) => b.id === id)?.categories || []).map((c) => ({ v: c.id, l: c.name }))];
  const p = openForm({
    title: r ? 'Dauerauftrag bearbeiten' : 'Neuer Dauerauftrag', fields: [
      { name: 'name', label: 'Name', value: r?.name, required: true, full: true },
      { name: 'type', label: 'Art', type: 'select', options: [{ v: 'expense', l: 'Ausgabe' }, { v: 'income', l: 'Einnahme' }], value: r?.type || 'expense' },
      { name: 'income_kind', label: 'Einnahmeart', type: 'select', options: [{ v: 'other', l: 'Sonstige Einnahme' }, { v: 'salary', l: 'Gehalt' }], value: r?.income_kind || 'other' },
      { name: 'amount', label: 'Betrag', value: r ? String(r.amount).replace('.', ',') : '', required: true },
      { name: 'budget_id', label: 'Budget', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })), value: bid },
      { name: 'category_id', label: 'Kategorie', type: 'select', options: catOpts(bid), value: r?.category_id || '' },
      ...(!r ? [
        { name: 'recipient_user_id', label: 'Zusätzlich im persönlichen Budget buchen', type: 'select', options: [{ v: '', l: '– Nicht teilen –' }, ...candidates.map((u) => ({ v: u.id, l: u.name }))], value: '' },
        ...(candidates.length ? [{ type: 'html', html: '<small class="muted">Der andere Nutzer muss zustimmen. Danach wird der volle Betrag in beiden persönlichen Budgets gebucht.</small>' }] : []),
      ] : []),
      { name: 'frequency', label: 'Rhythmus', type: 'select', options: Object.entries(FREQ).map(([v, l]) => ({ v, l })), value: r?.frequency || 'monthly' },
      { name: 'interval', label: 'Alle … Einheiten', type: 'number', min: 1, max: 3650, value: r?.interval || 1, help: 'Bei „Benutzerdefiniert“ wird der Abstand in Tagen angegeben.' },
      { name: 'start_date', label: 'Start', type: 'date', value: r?.start_date?.slice(0, 10) || todayStr(), required: true },
      { name: 'end_date', label: 'Ende (optional)', type: 'date', value: r?.end_date?.slice(0, 10) },
      { name: 'active', label: 'Aktiv', type: 'checkbox', value: r ? r.active : true },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), type: v.type, income_kind: v.type === 'income' ? v.income_kind : 'other', amount: parseAmount(v.amount), category_id: v.category_id || null, frequency: v.frequency, interval: Number(v.interval) || 1, start_date: v.start_date, end_date: v.end_date || null, active: v.active };
      if (r) await api.patch(`/recurring/${r.id}`, body); else await api.post('/recurring', { ...body, budget_id: v.budget_id, recipient_user_id: v.recipient_user_id || null });
    },
  });
  const sel = $('#f-budget_id');
  const typeSel = $('#f-type');
  const frequencySel = $('#f-frequency');
  const recipientSel = $('#f-recipient_user_id');
  const incomeKind = $('#f-income_kind')?.closest('label');
  const updateIncomeKind = () => { if (incomeKind) incomeKind.hidden = typeSel?.value !== 'income'; };
  typeSel?.addEventListener('change', updateIncomeKind);
  updateIncomeKind();
  frequencySel?.addEventListener('change', () => {
    const intervalField = $('#f-interval')?.closest('label');
    const label = intervalField?.firstChild;
    if (label) label.textContent = frequencySel.value === 'custom' ? 'Abstand in Tagen' : 'Alle … Einheiten';
  });
  frequencySel?.dispatchEvent(new Event('change'));
  if (r) sel.disabled = true;
  sel.addEventListener('change', () => { $('#f-category_id').innerHTML = catOpts(sel.value).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join(''); });
  recipientSel?.addEventListener('change', () => {
    const available = recipientSel.value ? budgets.filter((budget) => budget.type === 'solo') : budgets;
    if (!available.length) {
      recipientSel.value = '';
      toast('Für einen geteilten Dauerauftrag wird ein persönliches Budget benötigt.', true);
      return;
    }
    const selected = available.some((budget) => budget.id === sel.value) ? sel.value : available[0]?.id;
    sel.innerHTML = available.map((budget) => `<option value="${esc(budget.id)}" ${budget.id === selected ? 'selected' : ''}>${esc(budget.name)}</option>`).join('');
    sel.dispatchEvent(new Event('change'));
  });
  return p;
}

export async function render(view) {
  let rules = [];
  view.innerHTML = `<div class="page-head"><div><h1>Daueraufträge</h1><p>Wiederkehrende Einnahmen und Ausgaben werden automatisch gebucht</p></div>
    <div class="actions">${can('recurring:create') ? '<button class="btn" id="r-new">Neuer Dauerauftrag</button>' : ''}</div></div>
    <div id="r-requests"></div><div class="card" id="r-body"></div>`;
  async function load() {
    const [loadedRules, requests] = await Promise.all([api.get('/recurring'), api.get('/recurring/share-requests')]);
    rules = loadedRules;
    $('#r-requests').innerHTML = requests.length ? `<div class="card"><div class="card-head"><h2>Geteilte Daueraufträge zur Bestätigung</h2></div><p class="muted">Bei Annahme wird der volle Betrag zusätzlich in deinem persönlichen Budget gebucht. Dafür muss die Währung mit der des Absenders übereinstimmen.</p>
      ${requests.map((r) => `<div class="list-item"><div class="grow"><b>${esc(r.name)}</b><small>${esc(r.sender_name)} · ${esc(r.budget_name)} · ${r.type === 'expense' ? 'Ausgabe' : 'Einnahme'} ${new Intl.NumberFormat('de-DE', { style: 'currency', currency: r.currency }).format(Number(r.amount))} · ${esc(r.frequency)}</small></div>
      <button class="btn sm" data-accept-share="${r.id}" data-share-currency="${esc(r.currency)}">Annehmen</button> <button class="btn ghost sm" data-decline-share="${r.id}">Ablehnen</button></div>`).join('')}</div>` : '';
    $('#r-body').innerHTML = rules.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Budget</th><th>Rhythmus</th><th>Nächste Buchung</th><th style="text-align:right">Betrag</th><th>Status</th><th></th></tr></thead><tbody>${rules.map((r) => `<tr>
      <td><b>${esc(r.name)}</b>${r.income_kind === 'salary' ? ' <span class="tag">Gehalt</span>' : ''}<br><small class="muted">${esc(r.category_name || '–')}</small></td><td>${esc(r.budget_name)}</td>
      <td>${r.frequency === 'custom' ? (r.interval === 1 ? 'jeden Tag' : `alle ${r.interval} Tage`) : `${r.interval > 1 ? `alle ${r.interval} · ` : ''}${FREQ[r.frequency]}`}</td><td>${r.active ? fdate(r.next_run) : '–'}</td>
      <td style="text-align:right" class="${r.type === 'expense' ? 'down' : 'up'}"><b>${r.type === 'expense' ? '−' : '+'}${eur(r.amount)}</b></td>
      <td><span class="tag ${r.active ? 'ok' : 'warn'}">${r.active ? 'Aktiv' : 'Pausiert'}</span>${r.source === 'asset' ? ' <span class="tag">Objekt</span>' : ''}${r.recipient_status ? `<br><small class="muted">${r.is_share_recipient ? `Geteilt von ${esc(r.creator_name || 'Nutzer')}` : `Geteilt mit ${esc(r.recipient_name || 'Nutzer')}`}: ${r.recipient_status === 'accepted' ? 'angenommen' : r.recipient_status === 'pending' ? 'ausstehend' : r.recipient_status === 'declined' ? 'abgelehnt' : 'beendet'}</small>` : ''}</td>
      <td style="white-space:nowrap">${!r.is_share_recipient && can('recurring:update') ? `<button class="btn ghost sm" data-edit="${r.id}">Bearbeiten</button> <button class="btn ghost sm" data-toggle="${r.id}">${r.active ? 'Pausieren' : 'Aktivieren'}</button>${r.recipient_status === 'pending' || r.recipient_status === 'accepted' ? ` <button class="btn ghost sm" data-revoke-share="${r.id}">Teilen beenden</button>` : ''}` : ''}${!r.is_share_recipient && can('recurring:delete') ? ` <button class="btn ghost sm" data-del="${r.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Keine Daueraufträge.');
  }
  view.addEventListener('click', async (e) => {
    const t = (s) => e.target.closest(s);
    try {
      if (t('#r-new')) { if (await form()) load(); }
      else if (t('[data-edit]')) { if (await form(rules.find((r) => r.id === t('[data-edit]').dataset.edit))) load(); }
      else if (t('[data-accept-share]')) {
        const request = t('[data-accept-share]');
        const budgets = (await loadBudgets()).filter((b) => b.type === 'solo' && !b.archived && b.currency === request.dataset.shareCurrency);
        if (!budgets.length) return toast('Du brauchst ein persönliches Budget mit derselben Währung, um diesen Dauerauftrag anzunehmen.', true);
        const selected = await openForm({
          title: 'Geteilten Dauerauftrag annehmen',
          fields: [{ type: 'html', html: '<p class="muted">Der volle Betrag wird zusätzlich in deinem Budget verbucht.</p>' }, { name: 'budget_id', label: 'Dein persönliches Budget', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })), value: budgets[0].id, required: true }],
          onSubmit: async (v) => api.post(`/recurring/${request.dataset.acceptShare}/accept`, { budget_id: v.budget_id }),
        });
        if (selected) await load();
      }
      else if (t('[data-decline-share]')) {
        const button = t('[data-decline-share]');
        if (await confirmBox('Dauerauftrag ablehnen', 'Der Auftrag wird nicht in deinem persönlichen Budget verbucht.', 'Ablehnen')) {
          await api.post(`/recurring/${button.dataset.declineShare}/decline`);
          await load();
        }
      }
      else if (t('[data-revoke-share]') && await confirmBox('Geteilten Dauerauftrag beenden', 'Künftige Buchungen werden nicht mehr in das Budget des anderen Nutzers übernommen.', 'Beenden')) {
        await api.post(`/recurring/${t('[data-revoke-share]').dataset.revokeShare}/revoke-share`);
        await load();
      }
      else if (t('[data-toggle]')) { const r = rules.find((x) => x.id === t('[data-toggle]').dataset.toggle); await api.patch(`/recurring/${r.id}`, { active: !r.active }); load(); }
      else if (t('[data-del]') && (await confirmBox('Dauerauftrag löschen', 'Bereits erzeugte Buchungen bleiben erhalten.'))) { await api.del(`/recurring/${t('[data-del]').dataset.del}`); load(); }
    } catch (x) { toast(x.message, true); }
  });
  await load();
}
