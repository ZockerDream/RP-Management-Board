import { api } from '../api.js';
import { $, esc, eur, eur0, empty, openForm, confirmBox, toast, MONTH_NAMES, monthStart, monthEnd } from '../ui.js';
import { areaChart, donut } from '../charts.js';
import { can } from '../app.js';

const KINDS = { monthly: 'Monatsbericht', categories: 'Kategorien-Bericht', costs: 'Objektkosten-Bericht' };
const RHYTHM = { weekly: 'Wöchentlich', monthly: 'Monatlich', quarterly: 'Vierteljährlich' };
const ASSET = { house: 'Häuser', vehicle: 'Fahrzeuge', key: 'Schlüssel', sonstige: 'Sonstige' };

export async function render(view) {
  let months = 6, scope = 'all';
  view.innerHTML = `<div class="page-head"><div><h1>Berichte</h1><p>Auswertungen und automatische Berichte per E-Mail</p></div>
    <div class="actions"><div class="seg" id="r-scope"><button data-s="solo">Solo</button><button data-s="shared">Team</button><button data-s="all" class="on">Gesamt</button></div>
    <select id="r-months" style="width:170px"><option value="3">3 Monate</option><option value="6" selected>6 Monate</option><option value="12">12 Monate</option></select></div></div>
    <div id="r-body"></div>
    <div class="card"><div class="card-head"><h2>Geplante Berichte</h2>${can('report:create') ? '<button class="btn ghost sm" id="s-new">Bericht planen</button>' : ''}</div><div id="s-body"></div></div>`;

  async function load() {
    const from = monthStart(-(months - 1)), to = monthEnd(0);
    const q = `scope=${scope}&from=${from}&to=${to}`;
    const [tl, cats, costs] = await Promise.all([api.get(`/stats/timeline?scope=${scope}&months=${months}`), api.get(`/stats/by-category?${q}`), api.get(`/reports/costs?${q}`)]);
    const inc = tl.reduce((a, r) => a + Number(r.income), 0), exp = tl.reduce((a, r) => a + Number(r.expense), 0);
    $('#r-body').innerHTML = `<div class="grid cols-3"><div class="card kpi"><span class="label">Einnahmen</span><span class="value">${eur0(inc)}</span></div>
      <div class="card kpi"><span class="label">Ausgaben</span><span class="value">${eur0(exp)}</span></div><div class="card kpi"><span class="label">Saldo</span><span class="value">${eur0(inc - exp)}</span></div></div>
      <div class="grid cols-21"><div class="card"><div class="card-head"><h2>Verlauf</h2></div><div class="chart" id="r-line"></div></div>
      <div class="card"><div class="card-head"><h2>Kategorien</h2></div>${cats.length ? '<div class="chart" id="r-donut"></div>' : empty('Keine Ausgaben.')}</div></div>
      <div class="card"><div class="card-head"><h2>Objektkosten</h2></div>${costs.length ? `<table class="table"><thead><tr><th>Bereich</th><th>Buchungen</th><th style="text-align:right">Summe</th></tr></thead><tbody>${costs.map((c) => `<tr><td>${ASSET[c.asset_type] || esc(c.asset_type)}</td><td>${c.n}</td><td style="text-align:right">${eur(c.total)}</td></tr>`).join('')}</tbody></table>` : empty('Keine Objektkosten im Zeitraum.')}</div>`;
    areaChart($('#r-line'), {
      labels: tl.map((r) => MONTH_NAMES[Number(r.month.slice(5)) - 1].slice(0, 3)),
      series: [{ name: 'Einnahmen', color: 'var(--c1)', data: tl.map((r) => Number(r.income)) }, { name: 'Ausgaben', color: 'var(--c2)', data: tl.map((r) => Number(r.expense)) }], format: eur0,
    });
    if (cats.length) donut($('#r-donut'), { items: cats.map((c) => ({ name: c.name, value: Number(c.total), color: c.color })), format: eur0 });
  }
  async function loadSaved() {
    const s = await api.get('/reports/saved');
    $('#s-body').innerHTML = s.length ? s.map((r) => `<div class="list-item"><div class="grow"><b>${KINDS[r.kind]}</b><small>${RHYTHM[r.rhythm]} · ${esc((r.recipients || []).join(', ') || 'an dich')}</small></div>${can('report:create') ? `<button class="btn ghost sm" data-del="${r.id}">Löschen</button>` : ''}</div>`).join('') : empty('Keine geplanten Berichte.');
  }
  view.addEventListener('click', async (e) => {
    const g = (s) => e.target.closest(s);
    try {
      if (g('#r-scope [data-s]')) { scope = g('[data-s]').dataset.s; document.querySelectorAll('#r-scope button').forEach((b) => b.classList.toggle('on', b === g('[data-s]'))); load(); }
      else if (g('#s-new')) {
        if (await openForm({ title: 'Bericht planen', fields: [
          { name: 'kind', label: 'Bericht', type: 'select', options: Object.entries(KINDS).map(([v, l]) => ({ v, l })) },
          { name: 'rhythm', label: 'Rhythmus', type: 'select', options: Object.entries(RHYTHM).map(([v, l]) => ({ v, l })), value: 'monthly' },
          { name: 'recipients', label: 'Zusätzliche Empfänger (Komma-getrennt)', full: true },
        ], onSubmit: (v) => api.post('/reports/saved', { kind: v.kind, rhythm: v.rhythm, recipients: v.recipients.split(',').map((x) => x.trim()).filter(Boolean) }) })) loadSaved();
      } else if (g('[data-del]') && (await confirmBox('Bericht löschen', 'Geplanten Bericht entfernen?'))) { await api.del(`/reports/saved/${g('[data-del]').dataset.del}`); loadSaved(); }
    } catch (x) { toast(x.message, true); }
  });
  $('#r-months').addEventListener('change', (e) => { months = Number(e.target.value); load(); });
  await Promise.all([load(), loadSaved()]);
}
