// Rechnungen und Angebote (Wünsche des Auftraggebers vom 2026-11-13): an Personen, Organisationen oder Freitext, mit
// Positionen und PDF; „bezahlt“ markieren bucht die Einnahme auf ein Konto der Organisation.
import { api } from '../api.js';
import { $, $$, esc, empty, tag, eur, fdate, openForm, confirmBox, toast, todayStr, parseAmount } from '../ui.js';
import { can } from '../app.js';
import { loadTeams, pickTeam, rememberTeam, teamSelect, noTeam } from './org-pick.js';

const STATUS = { draft: ['', 'Entwurf'], open: ['warn', 'Offen'], paid: ['ok', 'Bezahlt'], cancelled: ['', 'Storniert'], accepted: ['ok', 'Angenommen'], declined: ['bad', 'Abgelehnt'] };

function itemsEditor(items) {
  const row = (it = {}) => `<div class="inv-item"><input data-k="text" placeholder="Bezeichnung" value="${esc(it.text || '')}" maxlength="300" aria-label="Bezeichnung">
    <input data-k="qty" value="${esc(String(it.qty ?? 1).replace('.', ','))}" aria-label="Menge" inputmode="decimal"><input data-k="price" placeholder="0,00" value="${it.price ? esc(String(it.price).replace('.', ',')) : ''}" aria-label="Einzelpreis" inputmode="decimal">
    <button type="button" class="icon-x" data-rm aria-label="Position entfernen">×</button></div>`;
  return `<div class="field full"><span>Positionen</span><div class="inv-items">${(items.length ? items : [{}]).map(row).join('')}</div>
    <div class="row" style="margin-top:6px"><button type="button" class="btn ghost sm" data-add-item>Position hinzufügen</button><b data-inv-total></b></div><template data-row>${row()}</template></div>`;
}
function wireItems(m) {
  const box = $('.inv-items', m);
  const total = () => {
    let sum = 0;
    $$('.inv-item', box).forEach((r) => { const qn = Number(parseAmount($('[data-k=qty]', r).value)); const p = Number(parseAmount($('[data-k=price]', r).value)); if (qn > 0 && p >= 0) sum += Math.round(qn * p * 100) / 100; });
    $('[data-inv-total]', m).textContent = `Summe ${eur(sum)}`;
  };
  m.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-item]')) { box.insertAdjacentHTML('beforeend', $('template[data-row]', m).innerHTML); total(); }
    else if (e.target.closest('[data-rm]') && $$('.inv-item', box).length > 1) { e.target.closest('.inv-item').remove(); total(); }
  });
  box.addEventListener('input', total);
  total();
}
const readItems = (m) => $$('.inv-item', m).map((r) => ({ text: $('[data-k=text]', r).value.trim(), qty: parseAmount($('[data-k=qty]', r).value || '1'), price: parseAmount($('[data-k=price]', r).value || '0') })).filter((i) => i.text);

export async function render(view, params) {
  const teams = await loadTeams('invoices');
  let teamId = pickTeam(teams, 'invoices', params?.get?.('team'));
  let kind = params?.get?.('kind') === 'offer' ? 'offer' : 'invoice';
  let data = { items: [], level: 0 };
  let people = null;
  let orgs = null;
  view.innerHTML = `<div class="page-head"><div><h1>Rechnungen</h1><p>Rechnungen und Angebote deiner Organisation</p></div>
    <div class="actions">${teamSelect(teams, teamId)}<span id="iv-actions"></span></div></div>
    ${teams.length ? `<div><div class="tabs"><button data-tab="invoice" class="${kind === 'invoice' ? 'on' : ''}">Rechnungen</button><button data-tab="offer" class="${kind === 'offer' ? 'on' : ''}">Angebote</button></div><div id="iv-body"></div></div>` : noTeam('Rechnungen')}`;
  if (!teams.length) return;

  function draw() {
    const w = data.level >= 3 && can('invoice:create');
    $('#iv-actions', view).innerHTML = w ? `<button class="btn" id="iv-new">${kind === 'offer' ? 'Neues Angebot' : 'Neue Rechnung'}</button>` : '';
    const list = data.items.filter((i) => i.kind === kind);
    const open = list.filter((i) => i.status === 'open');
    const openSum = open.reduce((a, i) => a + Number(i.total), 0);
    $('#iv-body', view).innerHTML = `${kind === 'invoice' && open.length ? `<p class="muted">${open.length} offen über ${eur(openSum)}${open.some((i) => i.overdue) ? ` · ${open.filter((i) => i.overdue).length} überfällig` : ''}</p>` : ''}
      <div class="card">${list.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Nummer</th><th>Empfänger</th><th>Datum</th><th>${kind === 'offer' ? 'Gültig bis' : 'Fällig'}</th><th>Betrag</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((i) => `<tr><td><b>${esc(i.number)}</b></td><td>${esc(i.recipient_name)}</td><td>${fdate(i.issued_on)}</td><td>${i.due_on ? fdate(i.due_on) : '–'}${i.overdue ? ` ${tag('bad', 'überfällig')}` : ''}</td><td>${eur(i.total)}</td>
        <td>${tag(...STATUS[i.status])}${i.paid_budget_name ? `<br><small class="muted">${esc(i.paid_budget_name)}</small>` : ''}</td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-pdf="${i.id}">PDF</button>
          ${w && ['draft', 'open'].includes(i.status) ? ` <button class="btn ghost sm" data-edit="${i.id}">Bearbeiten</button>` : ''}
          ${w && i.status === 'draft' ? ` <button class="btn ghost sm" data-status="open" data-id="${i.id}">${kind === 'offer' ? 'Verschicken' : 'Stellen'}</button>` : ''}
          ${w && kind === 'invoice' && ['draft', 'open'].includes(i.status) && can('transaction:create') ? ` <button class="btn sm" data-paid="${i.id}">Bezahlt</button>` : ''}
          ${w && kind === 'offer' && i.status === 'open' ? ` <button class="btn ghost sm" data-status="declined" data-id="${i.id}">Abgelehnt</button>` : ''}
          ${w && kind === 'offer' && ['open', 'accepted'].includes(i.status) ? ` <button class="btn sm" data-convert="${i.id}">Zur Rechnung</button>` : ''}
          ${data.level >= 4 && ['draft', 'open'].includes(i.status) ? ` <button class="btn ghost sm" data-status="cancelled" data-id="${i.id}">Stornieren</button>` : ''}
          ${data.level >= 4 && (i.status === 'draft' || i.status === 'cancelled' || i.status === 'declined' || (kind === 'offer' && i.status !== 'open')) ? ` <button class="btn ghost sm" data-del="${i.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : empty(kind === 'offer' ? 'Noch keine Angebote.' : 'Noch keine Rechnungen.')}</div>`;
  }
  async function load() { data = await api.get(`/invoices?team_id=${teamId}`); draw(); }

  async function form(inv) {
    if (can('person:read') && !people) people = await api.get('/people').catch(() => []);
    if (!orgs) orgs = await api.get('/org-teams?module=members&min=0').catch(() => []);
    const full = inv ? await api.get(`/invoices/${inv.id}`) : null;
    const offer = (full?.kind || kind) === 'offer';
    const done = openForm({
      title: full ? `${offer ? 'Angebot' : 'Rechnung'} ${full.number} bearbeiten` : (offer ? 'Neues Angebot' : 'Neue Rechnung'), wide: true,
      fields: [
        { name: 'recipient_kind', label: 'Empfänger ist', type: 'select', options: [{ v: 'text', l: 'Freitext' }, ...(people?.length ? [{ v: 'person', l: 'Person aus der Personenliste' }] : []), { v: 'team', l: 'Organisation' }], value: full?.recipient_kind || 'text' },
        { name: 'recipient_name', label: 'Name (Freitext)', value: full?.recipient_kind === 'text' ? full.recipient_name : '', maxlength: 200 },
        ...(people?.length ? [{ name: 'recipient_person_id', label: 'Person', type: 'select', options: people.filter((p) => p.active).map((p) => ({ v: p.id, l: p.name })), value: full?.recipient_person_id || '' }] : []),
        { name: 'recipient_team_id', label: 'Organisation', type: 'select', options: orgs.map((t) => ({ v: t.id, l: t.name })), value: full?.recipient_team_id || '' },
        { name: 'recipient_address', label: 'Anschrift (optional)', type: 'textarea', value: full?.recipient_address, maxlength: 500, rows: 2, full: true },
        { type: 'html', html: itemsEditor(full?.items || []) },
        { name: 'issued_on', label: 'Datum', type: 'date', value: full?.issued_on || todayStr() },
        { name: 'due_on', label: offer ? 'Gültig bis' : 'Zahlbar bis', type: 'date', value: full?.due_on || '' },
        { name: 'note', label: 'Hinweis auf dem Beleg', type: 'textarea', value: full?.note, maxlength: 2000, full: true, rows: 2 },
        ...(full ? [] : [{ name: 'issue', label: offer ? 'Sofort verschicken (sonst Entwurf)' : 'Sofort stellen (sonst Entwurf)', type: 'checkbox', value: true }]),
      ],
      onSubmit: async (v, m) => {
        const body = { recipient_kind: v.recipient_kind, recipient_name: v.recipient_name?.trim() || '', recipient_person_id: v.recipient_person_id || null, recipient_team_id: v.recipient_team_id || null,
          recipient_address: v.recipient_address.trim(), items: readItems(m), issued_on: v.issued_on, due_on: v.due_on || null, note: v.note };
        if (!body.items.length) throw new Error('Mindestens eine Position mit Bezeichnung');
        if (full) { await api.patch(`/invoices/${full.id}`, body); toast('Gespeichert'); return; }
        const r = await api.post('/invoices', { ...body, team_id: teamId, kind, issue: v.issue });
        toast(`${r.number} angelegt`);
      },
    });
    const m = $('#modals .modal:last-child');
    wireItems(m);
    // Nur das passende Empfängerfeld zeigen
    const sync = () => {
      const k = $('[name=recipient_kind]', m).value;
      for (const [name, show] of [['recipient_name', k === 'text'], ['recipient_person_id', k === 'person'], ['recipient_team_id', k === 'team']]) {
        const f = $(`[name=${name}]`, m)?.closest('.field');
        if (f) f.hidden = !show;
      }
    };
    $('[name=recipient_kind]', m).addEventListener('change', sync);
    sync();
    return done;
  }
  async function paidForm(inv) {
    const budgets = (await api.get('/budgets')).filter((b) => b.team_id === teamId && b.level >= 3 && !b.archived);
    if (!budgets.length) throw new Error('Kein Konto dieser Organisation, auf das du buchen darfst');
    return openForm({
      title: `${inv.number} bezahlt`,
      fields: [
        { type: 'html', html: `<p><b>${eur(inv.total)}</b> von ${esc(inv.recipient_name)} werden als Einnahme gebucht.</p>` },
        { name: 'budget_id', label: 'Konto', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })) },
        { name: 'paid_on', label: 'Bezahlt am', type: 'date', value: todayStr() },
      ],
      submit: 'Als bezahlt buchen',
      onSubmit: async (v) => { await api.post(`/invoices/${inv.id}/paid`, { budget_id: v.budget_id, paid_on: v.paid_on }); toast('Bezahlt und gebucht'); },
    });
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !view.contains(b)) return;
    const d = b.dataset;
    const inv = (id) => data.items.find((i) => i.id === id);
    try {
      if (b.matches('.tabs [data-tab]')) { kind = d.tab; draw(); return; }
      let changed = false;
      if (b.id === 'iv-new') changed = await form(null);
      else if (d.edit) changed = await form(inv(d.edit));
      else if (d.pdf) { await api.download(`/invoices/${d.pdf}/pdf`, `${inv(d.pdf).number}.pdf`); return; }
      else if (d.paid) changed = await paidForm(inv(d.paid));
      else if (d.convert) { const r = await api.post(`/invoices/${d.convert}/convert`); toast(`Rechnung ${r.number} als Entwurf angelegt`); kind = 'invoice'; $$('.tabs [data-tab]', view).forEach((x) => x.classList.toggle('on', x.dataset.tab === 'invoice')); changed = true; }
      else if (d.status) {
        const label = { open: 'stellen', declined: 'als abgelehnt markieren', cancelled: 'stornieren' }[d.status];
        if (d.status === 'open' || await confirmBox(`${inv(d.id).number} ${label}`, d.status === 'cancelled' ? 'Storniert bleibt der Beleg erhalten, kann aber nicht mehr bezahlt werden.' : 'Das Angebot gilt als abgelehnt.', 'Ja')) { await api.post(`/invoices/${d.id}/status`, { status: d.status }); changed = true; }
      } else if (d.del && await confirmBox('Löschen', `${inv(d.del).number} wird gelöscht.`)) { await api.del(`/invoices/${d.del}`); changed = true; }
      if (changed) await load();
    } catch (error) { toast(error.message, true); }
  });
  $('#org-team', view)?.addEventListener('change', async (e) => { teamId = e.target.value; rememberTeam('invoices', teamId); await load(); });
  await load();
}
