// Umbuchungen (Wunsch des Auftraggebers vom 2026-11-11): Dialog zum Umbuchen und Liste offener Umbuchungen.
// Eigene Konten und Organisationskonten mit „Lesen & Schreiben“ buchen sofort, sonst erst nach Annahme.
import { api } from '../api.js';
import { $, esc, openForm, confirmBox, toast, debounce, parseAmount } from '../ui.js';
import { can } from '../app.js';

const money = (amount, currency) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR' }).format(Number(amount));

export async function openTransferDialog(budgets, defaults = {}) {
  const sources = budgets.filter((b) => b.level >= 3 && !b.archived);
  if (!sources.length) { toast('Du hast kein Konto, von dem du buchen darfst', true); return false; }
  const targets = await api.get('/transfers/targets');
  const teamOptions = targets.teams.flatMap((t) => t.budgets.map((b) => ({ v: b.id, l: `${t.team_name} · ${b.name} (${b.currency})${b.direct ? '' : ' – nach Annahme'}` })));
  const from = defaults.from_budget_id && sources.some((b) => b.id === defaults.from_budget_id) ? defaults.from_budget_id : sources[0].id;
  const fields = [
    { name: 'from_budget_id', label: 'Von Konto', type: 'select', options: sources.map((b) => ({ v: b.id, l: `${b.name}${b.team_name ? ` · ${b.team_name}` : ''} (${b.currency})` })), value: from, full: true },
    { name: 'target', label: 'Ziel', type: 'select', options: [{ v: 'own', l: 'Eigenes Konto' }, { v: 'team', l: 'Konto einer Organisation' }, { v: 'user', l: 'Anderer Benutzer' }], value: 'own' },
    { name: 'own_budget', label: 'Zielkonto', type: 'select', options: targets.own.map((b) => ({ v: b.id, l: `${b.name} (${b.currency})` })) },
    { name: 'team_budget', label: 'Organisationskonto', type: 'select', options: teamOptions.length ? teamOptions : [{ v: '', l: 'Du bist in keiner Organisation mit Konto' }] },
    { type: 'html', html: '<label class="field full" data-user-search hidden>Benutzer suchen<input type="search" id="tr-user-q" placeholder="Name, mindestens 2 Zeichen" autocomplete="off"></label>' },
    { name: 'to_user_id', label: 'Empfänger', type: 'select', options: [{ v: '', l: 'Erst oben suchen' }] },
    { name: 'amount', label: 'Betrag', required: true, placeholder: '0,00' },
    { name: 'title', label: 'Verwendungszweck', required: true, maxlength: 200 },
    { type: 'html', html: '<p class="muted" data-transfer-hint></p>' },
  ];
  const dialog = openForm({
    title: 'Umbuchen',
    fields,
    submit: 'Umbuchen',
    onSubmit: async (v) => {
      const body = { from_budget_id: v.from_budget_id, target: v.target, amount: parseAmount(v.amount), title: v.title.trim() };
      if (v.target === 'own') body.to_budget_id = v.own_budget;
      if (v.target === 'team') body.to_budget_id = v.team_budget;
      if (v.target === 'user') body.to_user_id = v.to_user_id;
      const r = await api.post('/transfers', body);
      toast(r.status === 'accepted' ? 'Umgebucht' : 'Gesendet – wird gebucht, sobald angenommen');
    },
  });
  const m = $('#modals .modal.open:last-child');
  const field = (name) => $(`#f-${name}`, m)?.closest('label');
  const hint = $('[data-transfer-hint]', m);
  // Das Quellkonto kann nicht zugleich Ziel sein; die Auswahl folgt dem gewählten Quellkonto
  const ownSelect = $('#f-own_budget', m);
  const syncOwn = () => {
    const fromId = $('#f-from_budget_id', m).value, before = ownSelect.value;
    const list = targets.own.filter((b) => b.id !== fromId);
    ownSelect.innerHTML = list.length ? list.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.currency)})</option>`).join('')
      : '<option value="">Kein weiteres eigenes Konto</option>';
    if (list.some((b) => b.id === before)) ownSelect.value = before;
  };
  const update = () => {
    syncOwn();
    const kind = $('#f-target', m).value;
    field('own_budget').hidden = kind !== 'own';
    field('team_budget').hidden = kind !== 'team';
    field('to_user_id').hidden = kind !== 'user';
    $('[data-user-search]', m).hidden = kind !== 'user';
    const teamText = $('#f-team_budget', m).selectedOptions[0]?.textContent || '';
    hint.textContent = kind === 'user' ? 'Wird erst gebucht, wenn die Person annimmt; sie wählt dabei ihr Konto.'
      : kind === 'team' && /nach Annahme/.test(teamText) ? 'Wird erst gebucht, wenn jemand mit Schreibrecht auf dem Konto annimmt.'
        : 'Wird sofort gebucht.';
  };
  const search = debounce(async () => {
    const term = $('#tr-user-q', m).value.trim();
    const users = term.length >= 2 ? await api.get(`/transfers/users?q=${encodeURIComponent(term)}`) : [];
    $('#f-to_user_id', m).innerHTML = users.length ? users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')
      : `<option value="">${term.length >= 2 ? 'Niemand gefunden' : 'Erst oben suchen'}</option>`;
  });
  m.addEventListener('change', update);
  $('#tr-user-q', m).addEventListener('input', search);
  update();
  return dialog;
}

// Offene Umbuchungen: eingehende annehmen oder ablehnen, ausgehende zurückziehen
export async function renderPendingTransfers(box, onChange) {
  if (!can('transaction:read')) return;
  const { incoming, outgoing } = await api.get('/transfers');
  if (!incoming.length && !outgoing.length) { box.innerHTML = ''; return; }
  const target = (t) => (t.to_user_id ? esc(t.to_user_name || 'Benutzer') : `${esc(t.to_team_name || 'Organisation')} · ${esc(t.to_budget_name || 'Konto')}`);
  box.innerHTML = `<div class="card" id="transfers-pending"><div class="card-head"><h2>Offene Umbuchungen</h2></div>
    ${incoming.map((t) => `<div class="list-item"><div class="grow"><b>${esc(t.title)}</b><small>von ${esc(t.from_name || 'Unbekannt')}${t.to_team_name ? ` an ${target(t)}` : ''} · ${money(t.amount, t.currency)}${t.note ? ` · ${esc(t.note)}` : ''}</small></div>
      ${can('transaction:create') ? `<button class="btn sm" data-tr-accept="${t.id}">Annehmen</button>` : ''} <button class="btn ghost sm" data-tr-decline="${t.id}">Ablehnen</button></div>`).join('')}
    ${outgoing.map((t) => `<div class="list-item"><div class="grow"><b>${esc(t.title)}</b><small>an ${target(t)} · ${money(t.amount, t.currency)} · wartet auf Annahme</small></div>
      <button class="btn ghost sm" data-tr-revoke="${t.id}">Zurückziehen</button></div>`).join('')}</div>`;
  box.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      let changed = false;
      if (b.dataset.trAccept) {
        const t = incoming.find((x) => x.id === b.dataset.trAccept);
        changed = await acceptDialog(t);
      } else if (b.dataset.trDecline && await confirmBox('Umbuchung ablehnen', 'Der Absender wird benachrichtigt, gebucht wird nichts.', 'Ablehnen')) {
        await api.post(`/transfers/${b.dataset.trDecline}/decline`);
        changed = true;
      } else if (b.dataset.trRevoke && await confirmBox('Umbuchung zurückziehen', 'Die Umbuchung wird zurückgezogen, gebucht wird nichts.', 'Zurückziehen')) {
        await api.post(`/transfers/${b.dataset.trRevoke}/revoke`);
        changed = true;
      }
      if (changed) { await renderPendingTransfers(box, onChange); await onChange?.(); }
    } catch (error) {
      toast(error.message, true);
    }
  };
}

async function acceptDialog(t) {
  if (!t.to_user_id) {
    if (!(await confirmBox('Umbuchung annehmen', `${money(t.amount, t.currency)} von ${t.from_name || 'Unbekannt'} auf „${t.to_budget_name}“ buchen?`, 'Annehmen'))) return false;
    await api.post(`/transfers/${t.id}/accept`, {});
    toast('Angenommen und gebucht');
    return true;
  }
  const { own } = await api.get('/transfers/targets');
  const fitting = own.filter((b) => b.currency === t.currency);
  if (!fitting.length) {
    await openForm({ title: 'Umbuchung annehmen', fields: [{ type: 'html', html: `<p>Lege zuerst ein persönliches Konto in ${esc(t.currency)} an. Dann kannst du die Umbuchung annehmen.</p>` }], submit: 'OK', cancel: 'Schließen', onSubmit: async () => true });
    return false;
  }
  return openForm({
    title: 'Umbuchung annehmen',
    fields: [
      { type: 'html', html: `<p><b>${money(t.amount, t.currency)}</b> von ${esc(t.from_name || 'Unbekannt')}: „${esc(t.title)}“</p>` },
      { name: 'budget_id', label: 'Auf Konto', type: 'select', options: fitting.map((b) => ({ v: b.id, l: b.name })), full: true },
    ],
    submit: 'Annehmen',
    onSubmit: async (v) => {
      await api.post(`/transfers/${t.id}/accept`, { budget_id: v.budget_id });
      toast('Angenommen und gebucht');
    },
  });
}
