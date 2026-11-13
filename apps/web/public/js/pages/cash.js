// Kasse (Wunsch des Auftraggebers vom 2026-11-13): eine Kasse ist ein Konto der Organisation. Bar einnehmen und
// ausgeben, Tagesbuchungen sehen, Tagesabschluss mit Zählung; die Differenz wird gebucht.
import { api } from '../api.js';
import { $, esc, empty, tag, eur, fdate, fdatetime, openForm, confirmBox, toast, todayStr, parseAmount } from '../ui.js';
import { can } from '../app.js';
import { loadTeams, pickTeam, rememberTeam, teamSelect, noTeam } from './org-pick.js';

export async function render(view, params) {
  const teams = await loadTeams('cash');
  let teamId = pickTeam(teams, 'cash', params?.get?.('team'));
  let data = { registers: [], level: 0 };
  let current = null;
  let detail = null;
  let day = todayStr();
  view.innerHTML = `<div class="page-head"><div><h1>Kasse</h1><p>Bargeld einnehmen, ausgeben und den Tag abschließen</p></div>
    <div class="actions">${teamSelect(teams, teamId)}<span id="ca-actions"></span></div></div>
    ${teams.length ? '<div id="ca-regs" class="chips" style="margin-bottom:14px"></div><div id="ca-body"></div>' : noTeam('Kassen')}`;
  if (!teams.length) return;

  function drawRegs() {
    $('#ca-actions', view).innerHTML = data.level >= 4 && can('cash:create') ? '<button class="btn ghost" id="ca-new">Neue Kasse</button>' : '';
    $('#ca-regs', view).innerHTML = data.registers.map((r) => `<button class="btn ${r.id === current ? '' : 'ghost'} sm" data-reg="${r.id}">${esc(r.name)} · ${eur(r.balance)}</button>`).join('');
  }
  async function drawDetail() {
    const body = $('#ca-body', view);
    if (!current) { body.innerHTML = `<div class="card">${empty(data.level >= 4 ? 'Noch keine Kasse. „Neue Kasse“ verbindet sie mit einem Konto der Organisation.' : 'Noch keine Kasse eingerichtet.')}</div>`; return; }
    detail = await api.get(`/cash-registers/${current}?date=${day}`);
    const w = detail.level >= 3 && can('cash:update');
    const inc = detail.entries.filter((t) => t.type === 'income').reduce((a, t) => a + Number(t.amount), 0);
    const exp = detail.entries.filter((t) => t.type === 'expense').reduce((a, t) => a + Number(t.amount), 0);
    body.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <div class="card"><div class="card-head"><h2>${esc(detail.name)}</h2><small>Konto ${esc(detail.budget_name || '')}</small></div>
        <div class="cash-balance"><small class="muted">Bestand laut Konto</small><b>${eur(detail.balance)}</b></div>
        ${w && day === todayStr() ? `<form id="ca-entry" class="form" novalidate style="margin-top:12px">
          <label class="field">Betrag<input name="amount" required inputmode="decimal" placeholder="0,00"></label>
          <label class="field">Text<input name="title" required maxlength="200" placeholder="z. B. Verkauf Burger"></label>
          <div class="full row start" style="gap:8px"><button class="btn" type="submit" data-type="income">Einnahme</button><button class="btn ghost" type="submit" data-type="expense">Ausgabe</button>
          <span class="grow"></span><button class="btn ghost" type="button" id="ca-close">Tagesabschluss</button></div></form>` : ''}
        ${detail.level >= 4 ? '<p style="margin:12px 0 0"><button class="btn ghost sm" id="ca-del">Kasse entfernen</button> <small class="muted">Konto und Buchungen bleiben.</small></p>' : ''}</div>
      <div class="card"><div class="card-head"><h2>Buchungen am</h2><input type="date" id="ca-day" value="${day}" max="${todayStr()}" aria-label="Tag"></div>
        <p class="muted" style="margin-top:0">Einnahmen ${eur(inc)} · Ausgaben ${eur(exp)}</p>
        ${detail.entries.length ? detail.entries.map((t) => `<div class="list-item"><div class="grow"><b>${esc(t.title)}</b><small>${new Date(t.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${esc(t.created_by_name || '–')}${t.source !== 'cash' ? ` · ${esc(t.source)}` : ''}</small></div><b class="${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '+' : '−'}${eur(t.amount)}</b></div>`).join('') : empty('Keine Buchungen an diesem Tag.')}</div></div>
      <div class="card" style="margin-top:18px"><div class="card-head"><h2>Tagesabschlüsse</h2></div>${detail.closings.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Tag</th><th>Erwartet</th><th>Gezählt</th><th>Differenz</th><th>Von</th><th>Notiz</th></tr></thead><tbody>
        ${detail.closings.map((c) => `<tr><td>${fdate(c.closed_on)}<br><small class="muted">${fdatetime(c.created_at)}</small></td><td>${eur(c.expected)}</td><td>${eur(c.counted)}</td><td>${Number(c.difference) === 0 ? tag('ok', 'stimmt') : tag(Number(c.difference) < 0 ? 'bad' : 'warn', eur(c.difference))}</td><td>${esc(c.created_by_name || '–')}</td><td>${esc(c.note || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch kein Tagesabschluss.')}</div>`;
    $('#ca-day', view).addEventListener('change', async (e) => { day = e.target.value || todayStr(); await drawDetail(); });
    const form = $('#ca-entry', view);
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = e.submitter?.dataset.type || 'income';
      try {
        await api.post(`/cash-registers/${current}/entries`, { type, amount: parseAmount(form.amount.value), title: form.title.value.trim() });
        toast(type === 'income' ? 'Einnahme gebucht' : 'Ausgabe gebucht');
        await load();
      } catch (x) { toast(x.message, true); }
    });
  }
  async function load() {
    data = await api.get(`/cash?team_id=${teamId}`);
    if (!data.registers.some((r) => r.id === current)) current = data.registers[0]?.id || null;
    drawRegs();
    await drawDetail();
  }
  async function newRegister() {
    const budgets = (await api.get('/budgets')).filter((b) => b.team_id === teamId && b.level >= 3 && !b.archived);
    if (!budgets.length) throw new Error('Lege zuerst unter „Konten“ ein Konto dieser Organisation an (z. B. „Kasse Laden“)');
    return openForm({
      title: 'Neue Kasse',
      fields: [
        { name: 'name', label: 'Name', required: true, maxlength: 100, placeholder: 'z. B. Kasse Theke' },
        { name: 'budget_id', label: 'Konto der Organisation', type: 'select', options: budgets.map((b) => ({ v: b.id, l: `${b.name} (${eur(b.balance)})` })) },
      ],
      onSubmit: async (v) => { const r = await api.post('/cash-registers', { team_id: teamId, name: v.name.trim(), budget_id: v.budget_id }); current = r.id; },
    });
  }
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !view.contains(b)) return;
    try {
      if (b.dataset.reg) { current = b.dataset.reg; drawRegs(); await drawDetail(); return; }
      if (b.id === 'ca-new') { if (await newRegister()) await load(); return; }
      if (b.id === 'ca-del' && await confirmBox('Kasse entfernen', 'Die Kasse verschwindet samt Abschlüssen; das Konto und seine Buchungen bleiben.', 'Entfernen')) { await api.del(`/cash-registers/${current}`); current = null; await load(); return; }
      if (b.id === 'ca-close') {
        const ok = await openForm({
          title: `Tagesabschluss ${detail.name}`,
          fields: [
            { type: 'html', html: `<p>Laut Konto sollten <b>${eur(detail.balance)}</b> in der Kasse sein. Zähle das Bargeld und trage die Summe ein; eine Differenz wird gebucht.</p>` },
            { name: 'counted', label: 'Gezählt', required: true, value: String(detail.balance).replace('.', ','), inputmode: 'decimal' },
            { name: 'note', label: 'Notiz', maxlength: 1000, full: true },
          ],
          submit: 'Abschließen',
          onSubmit: async (v) => {
            const r = await api.post(`/cash-registers/${current}/close`, { counted: parseAmount(v.counted), note: v.note.trim() });
            toast(Number(r.difference) === 0 ? 'Kasse stimmt' : `Differenz ${eur(r.difference)} gebucht`);
          },
        });
        if (ok) await load();
      }
    } catch (error) { toast(error.message, true); }
  });
  $('#org-team', view)?.addEventListener('change', async (e) => { teamId = e.target.value; rememberTeam('cash', teamId); current = null; await load(); });
  await load();
}
