import { api } from '../api.js';
import { $, esc, eur, eur0, fdate, empty, budgetTag, MONTH_NAMES, monthStart, monthEnd, todayStr } from '../ui.js';
import { areaChart, donut, gauge } from '../charts.js';
import { txForm, loadBudgets } from './common.js';
import { can, state } from '../app.js';
import { occursOn } from '../recurrence.js';

export async function render(view) {
  view.classList.add('dashboard-view');
  let scope = 'all';
  let range = 0;
  const now = new Date();
  const rangeOpts = [0, -1, -2].map((o) => {
    const d = new Date(now.getFullYear(), now.getMonth() + o, 1);
    return `<option value="${o}">${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}</option>`;
  }).join('');

  view.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><p>Willkommen zurück, ${esc(state.me.name)}</p></div>
    <div class="actions"><div class="seg" id="d-scope"><button data-s="solo">Solo</button><button data-s="shared">Team</button><button data-s="all" class="on">Gesamt</button></div>
    <select id="d-range" style="width:170px">${rangeOpts}</select>
    ${can('transaction:create') ? '<button class="btn" id="d-new">Buchung</button>' : ''}</div></div>
    <div id="d-body"></div>`;

  const vehiclesRequest = can('vehicle:read') ? api.get('/vehicles') : Promise.resolve([]);
  const eventsRequest = can('calendar:read') ? api.get('/calendar') : Promise.resolve([]);

  async function load() {
    // Das Dashboard zeigt nur den echten Stand: Buchungen mit Datum in der Zukunft zählen noch nicht
    const now = todayStr();
    const from = monthStart(range), to = monthEnd(range) > now ? now : monthEnd(range);
    const q = `scope=${scope}&from=${from}&to=${to}`;
    const [ov, cats, tl, budgets, txs, vehicles, events] = await Promise.all([
      api.get(`/stats/overview?${q}`), api.get(`/stats/by-category?${q}`), api.get(`/stats/timeline?scope=${scope}&months=6&to=${now}`),
      loadBudgets(), api.get(`/transactions?scope=${scope}&limit=6&to=${now}`).catch(() => ({ items: [] })),
      vehiclesRequest, eventsRequest,
    ]);
    const inc = Number(ov.income), exp = Number(ov.expense);
    const rate = inc > 0 ? Math.round(((inc - exp) / inc) * 100) : 0;
    const shown = budgets.filter((b) => scope === 'all' || b.type === scope).slice(0, 6);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateKey = (d) => d.toLocaleDateString('sv-SE');
    const upcoming = [];
    for (let offset = 0; offset < 30; offset++) {
      const day = new Date(today);
      day.setDate(day.getDate() + offset);
      const key = dateKey(day);
      events.forEach((event) => {
        const repeats = occursOn(event.date.slice(0, 10), event.repeat, event.repeat_interval, key);
        if (repeats && event.type !== 'holiday') upcoming.push({ ...event, occurrence: key });
      });
    }
    upcoming.sort((a, b) => a.occurrence.localeCompare(b.occurrence) || (a.start || '').localeCompare(b.start || ''));
    const vehicleStatus = { available: ['ok', 'Verfügbar'], in_use: ['warn', 'Im Einsatz'], workshop: ['bad', 'Werkstatt'], retired: ['sys', 'Ausgemustert'] };
    const eventTypes = { finance: 'Zahlung', vehicle: 'Fahrzeug', key: 'Schlüssel', house: 'Wartung', team: 'Team', personal: 'Privat' };
    const vehicleItems = vehicles.slice(0, 5);
    $('#d-body').innerHTML = `
      <div class="grid cols-4">
        <div class="card kpi"><span class="label">Gesamtsaldo</span><span class="value">${eur(ov.saldo)}</span><span class="delta muted">alle Buchungen bis heute</span></div>
        <div class="card kpi"><span class="label">Einnahmen</span><span class="value">${eur(inc)}</span><span class="delta muted">im gewählten Monat</span></div>
        <div class="card kpi"><span class="label">Ausgaben</span><span class="value">${eur(exp)}</span><span class="delta muted">im gewählten Monat</span></div>
        <div class="card kpi"><span class="label">Sparquote</span><span class="value">${rate} %</span><span class="delta ${rate >= 0 ? 'up' : 'down'}">${eur(inc - exp)} Überschuss</span></div>
      </div>
      <div class="grid cols-21">
        <div class="card"><div class="card-head"><h2>Cashflow</h2><div class="legend"><span style="--c:var(--c1)">Einnahmen</span><span style="--c:var(--c2)">Ausgaben</span></div></div><div class="chart" id="d-cash"></div></div>
        <div class="card"><div class="card-head"><h2>Ausgaben nach Kategorie</h2></div>${cats.length ? '<div class="chart" id="d-donut"></div>' : empty('Keine Ausgaben in diesem Zeitraum.')}</div>
      </div>
      <div class="grid cols-12">
        <div class="card"><div class="card-head"><h2>Konto-Auslastung</h2></div>
          ${shown.length ? `<div class="grid cols-3" style="margin:0;gap:8px">${shown.map((b, i) => `<div class="gauge"><div class="chart" data-g="${i}"></div><div class="g-label">${esc(b.name)}</div><small>${eur0(b.used)} / ${eur0(b.limit_amount)}</small></div>`).join('')}</div>` : empty('Noch keine Konten.')}
        </div>
        <div class="card"><div class="card-head"><h2>Letzte Buchungen</h2><a class="btn ghost sm" href="#/transactions">Alle anzeigen</a></div>
          ${txs.items.length ? txs.items.map((t) => `<div class="list-item"><div class="grow"><b>${esc(t.title || t.category_name || '–')}</b><small>${esc(t.category_name || '–')} · ${fdate(t.booked_at)}</small></div>${budgetTag(t.budget_type, t.budget_name)}<b class="${t.type === 'expense' ? 'down' : 'up'}">${t.type === 'expense' ? '−' : '+'}${eur(t.amount)}</b></div>`).join('') : empty('Noch keine Buchungen.')}
        </div>
      </div>
      ${can('vehicle:read') || can('calendar:read') ? `<div class="grid cols-2 dashboard-extras">
        ${can('vehicle:read') ? `<div class="card"><div class="card-head"><h2>Fuhrpark</h2><a class="btn ghost sm" href="#/assets-vehicles">Alle Fahrzeuge</a></div>
          ${vehicles.length ? `<div class="dashboard-summary"><span>${vehicles.length} Fahrzeuge</span><span>${vehicles.filter((v) => v.status === 'in_use').length} im Einsatz</span><span>${vehicles.filter((v) => v.status === 'workshop').length} in Werkstatt</span></div>
            ${vehicleItems.map((v) => {
              const due = v.service_due?.slice(0, 10);
              const days = due ? (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${dateKey(today)}T00:00:00Z`)) / 86400000 : null;
              const serviceTag = days === null ? '' : `<span class="tag ${days < 0 ? 'bad' : days <= 30 ? 'warn' : 'ok'}">${days < 0 ? `Service überfällig · ${fdate(due)}` : `Service · ${fdate(due)}`}</span>`;
              const [statusClass, statusLabel] = vehicleStatus[v.status] || ['sys', v.status];
              return `<div class="list-item"><div class="grow"><b>${esc(v.make_model)}</b><small>${esc(v.plate)}</small></div><span class="tag ${statusClass}">${esc(statusLabel)}</span>${serviceTag}</div>`;
            }).join('')}${vehicles.length > vehicleItems.length ? `<a class="dashboard-more" href="#/assets-vehicles">+ ${vehicles.length - vehicleItems.length} weitere Fahrzeuge</a>` : ''}` : empty('Noch keine Fahrzeuge erfasst.')}</div>` : ''}
        ${can('calendar:read') ? `<div class="card"><div class="card-head"><h2>Als Nächstes</h2><a class="btn ghost sm" href="#/calendar">Kalender öffnen</a></div>
          ${upcoming.length ? upcoming.slice(0, 6).map((event) => `<div class="list-item dashboard-event"><span class="dashboard-date">${fdate(event.occurrence)}</span><div class="grow"><b>${esc(event.title)}</b><small>${esc(event.start ? `${event.start}${event.end ? `–${event.end}` : ''} · ` : '')}${esc(event.note || eventTypes[event.type] || 'Termin')}</small></div></div>`).join('') : empty('Keine Termine in den nächsten 30 Tagen.')}</div>` : ''}
      </div>` : ''}`;
    areaChart($('#d-cash'), {
      labels: tl.map((r) => MONTH_NAMES[Number(r.month.slice(5)) - 1].slice(0, 3)),
      series: [{ name: 'Einnahmen', color: 'var(--c1)', data: tl.map((r) => Number(r.income)) }, { name: 'Ausgaben', color: 'var(--c2)', data: tl.map((r) => Number(r.expense)) }],
      format: eur0,
    });
    if (cats.length) donut($('#d-donut'), { items: cats.map((c) => ({ name: c.name, value: Number(c.total), color: c.color })), format: eur0 });
    shown.forEach((b, i) => gauge($(`[data-g="${i}"]`), { value: Math.min(100, b.pct) }));
  }

  view.addEventListener('click', async (e) => {
    const s = e.target.closest('#d-scope [data-s]');
    if (s) { scope = s.dataset.s; document.querySelectorAll('#d-scope button').forEach((b) => b.classList.toggle('on', b === s)); load(); }
    if (e.target.closest('#d-new') && (await txForm())) load();
  });
  $('#d-range').addEventListener('change', (e) => { range = Number(e.target.value); load(); });
  await load();
}
