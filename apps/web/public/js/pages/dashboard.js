import { api } from '../api.js';
import { $, $$, esc, eur, eur0, fdate, empty, budgetTag, toast, progress, MONTH_NAMES, monthStart, monthEnd, todayStr } from '../ui.js';
import { areaChart, donut, gauge } from '../charts.js';
import { txForm } from './common.js';
import { moduleOn, can, state, isModern } from '../app.js';
import { occursOn } from '../recurrence.js';

const VIEWS = {
  day: { caption: 'am gewählten Tag', chart: 'letzte 14 Tage', query: 'granularity=day&periods=14', count: 14 },
  week: { caption: 'in der gewählten Woche', chart: 'letzte 8 Wochen', query: 'granularity=week&periods=8', count: 8 },
  month: { caption: 'im gewählten Monat', chart: 'letzte 6 Monate', query: 'months=6', count: 3 },
};
const VIEW_KEY = 'bm-dashboard-view';
const savedView = () => {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return VIEWS[value] ? value : 'month';
  } catch {
    return 'month';
  }
};
const saveView = (value) => {
  try { localStorage.setItem(VIEW_KEY, value); } catch { /* nur Komfort */ }
};

// Zeitraum relativ zu heute: Offset 0 ist der laufende Tag, die laufende Woche oder der laufende Monat
function period(mode, offset, weekStart) {
  if (mode === 'month') return { from: monthStart(offset), to: monthEnd(offset) };
  const now = new Date();
  const dateAt = (day) => new Date(now.getFullYear(), now.getMonth(), day).toLocaleDateString('sv-SE');
  if (mode === 'day') {
    const day = dateAt(now.getDate() + offset);
    return { from: day, to: day };
  }
  const first = now.getDate() - ((now.getDay() - weekStart + 7) % 7) + 7 * offset;
  return { from: dateAt(first), to: dateAt(first + 6) };
}

function periodOptions(mode, weekStart) {
  const short = (date) => fdate(date).slice(0, 6);
  return Array.from({ length: VIEWS[mode].count }, (_, index) => {
    const { from, to } = period(mode, -index, weekStart);
    const date = new Date(`${from}T00:00:00`);
    let label = `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    if (mode === 'week') label = ['Diese Woche', 'Letzte Woche'][index] || `${short(from)} – ${short(to)}`;
    if (mode === 'day') label = ['Heute', 'Gestern'][index] || date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    return `<option value="${-index}">${label}</option>`;
  }).join('');
}

// Prognose dieser und nächster Woche (Wunsch des Auftraggebers vom 2026-11-10): Geplantes plus Erfahrungswert, Regeln in
// apps/api/src/forecast.js. Zeilen ohne Betrag fallen weg, damit die Tabelle kurz bleibt.
const FORECAST_ROWS = [['booked', 'Gebucht'], ['planned', 'Vorausdatiert'], ['recurring', 'Daueraufträge'], ['salary', 'Festgehalt'], ['estimate', 'Schätzung']];
function forecastHtml(f) {
  const short = (date) => fdate(date).slice(0, 6);
  const right = 'style="text-align:right"';
  const week = (w, label) => {
    const rows = FORECAST_ROWS.filter(([key]) => Number(w.income[key]) || Number(w.expense[key]));
    return `<div class="forecast-week"><div class="row between"><h3>${label}</h3><small class="muted">${short(w.start)} – ${short(w.end)}</small></div>
      <table class="table"><thead><tr><th></th><th ${right}>Einnahmen</th><th ${right}>Ausgaben</th></tr></thead><tbody>
      ${rows.map(([key, text]) => `<tr><td>${text}${key === 'estimate' ? ` <small class="muted">${w.estimate_days} ${w.estimate_days === 1 ? 'Tag' : 'Tage'}</small>` : ''}</td><td ${right}>${eur(w.income[key])}</td><td ${right}>${eur(w.expense[key])}</td></tr>`).join('')}
      <tr><td><b>Erwartet</b></td><td ${right} class="up"><b>${eur(w.income.total)}</b></td><td ${right} class="down"><b>${eur(w.expense.total)}</b></td></tr></tbody></table>
      <div class="row between forecast-balance"><span>Überschuss</span><b class="${Number(w.balance) >= 0 ? 'up' : 'down'}">${eur(w.balance)}</b></div></div>`;
  };
  const basis = f.history_weeks
    ? `Schätzung: Schnitt pro Tag aus ${f.history_weeks === 1 ? 'der letzten Woche' : `den letzten ${f.history_weeks} Wochen`} ohne Daueraufträge und Festgehalt, für die restlichen Tage.`
    : 'Für eine Schätzung fehlt noch eine abgeschlossene Woche mit Buchungen; gezeigt wird nur Geplantes.';
  return `<div class="card"><div class="card-head"><h2>Prognose</h2><small class="muted">Gebucht, vorausdatiert, Daueraufträge und Festgehalt plus Erfahrungswert</small></div>
    <div class="grid cols-2 forecast-weeks" style="margin:0">${week(f.weeks[0], 'Diese Woche')}${week(f.weeks[1], 'Nächste Woche')}</div>
    <p class="muted" style="margin:8px 0 0">${basis} Sparziel-Einzahlungen zählen nicht. Bonus für Stunden über dem Wochen-Soll steckt nur im Erfahrungswert.</p></div>`;
}

/* ---------- Module ----------
   Die IDs müssen zu DASHBOARD_MODULES in apps/api/src/ui-prefs.js passen. V1 zeigt immer die feste Anordnung von früher,
   V2 hat einen eigenen Standard und lässt sich anpassen (Darstellung V2, Wunsch des Auftraggebers vom 2026-11-11).
   need: welche Daten das Modul braucht, so lädt das Dashboard nur, was sichtbar ist. */
const MODULES = {
  kpis: { title: 'Kennzahlen', need: ['ov'], spans: [6, 12] },
  forecast: { title: 'Prognose', need: ['forecast'], spans: [4, 6, 8, 12] },
  cashflow: { title: 'Cashflow', need: ['tl'], spans: [4, 6, 8, 12] },
  categories: { title: 'Ausgaben nach Kategorie', need: ['cats'], spans: [4, 6, 8, 12] },
  budgets: { title: 'Budget-Auslastung', need: ['spending'], spans: [4, 6, 8, 12] },
  transactions: { title: 'Letzte Buchungen', need: ['txs'], spans: [4, 6, 8, 12] },
  timer: { title: 'Stundenzettel', need: ['timer', 'week'], spans: [4, 6, 8, 12], v2: true },
  accounts: { title: 'Konten', need: ['accounts'], spans: [4, 6, 8, 12], v2: true },
  goals: { title: 'Sparziele', need: ['goals'], spans: [4, 6, 8, 12], v2: true, perm: 'goal:read' },
  todos: { title: 'ToDos', need: ['todos'], spans: [4, 6, 8, 12], v2: true },
  fleet: { title: 'Fuhrpark', need: ['vehicles'], spans: [4, 6, 8, 12], perm: 'vehicle:read' },
  upcoming: { title: 'Als Nächstes', need: ['events'], spans: [4, 6, 8, 12], perm: 'calendar:read' },
  // Musik (2026-11-13): lädt selbst (music.js), läuft Server-Musik, zeigt sie die, sonst Spotify
  music: { title: 'Musik', need: [], spans: [4, 6, 8, 12], v2: true, perm: 'music:read' },
};
const V1_LAYOUT = [['kpis', 12], ['forecast', 12], ['cashflow', 8], ['categories', 4], ['budgets', 4], ['transactions', 8], ['fleet', 6], ['upcoming', 6]];
const V2_LAYOUT = [['kpis', 12], ['cashflow', 8], ['timer', 4], ['forecast', 8], ['accounts', 4], ['budgets', 4], ['transactions', 4], ['upcoming', 4], ['todos', 4], ['goals', 4], ['categories', 4], ['music', 4], ['fleet', 12]];
const SPAN_LABELS = { 4: 'Schmal', 6: 'Halb', 8: 'Breit', 12: 'Ganze Breite' };

// Das anpassbare Dashboard mit den Zusatzmodulen gilt für alle Designs außer V1
const isV2 = () => ['v2', 'v3', 'v4'].includes(state.me?.ui_version);
const greeting = () => { const h = new Date().getHours(); return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend'; };
const usable = (id) => MODULES[id] && (!MODULES[id].perm || can(MODULES[id].perm)) && (isV2() || !MODULES[id].v2) && (id !== 'music' || moduleOn('music'));

// Gespeichertes Layout auf die heute verfügbaren Module abbilden: neue Module kommen ans Ende, fehlende Rechte blenden aus
function resolveLayout() {
  if (!isV2()) return { shown: V1_LAYOUT.filter(([id]) => usable(id)).map(([id, span]) => ({ id, span })), hidden: [] };
  const defaults = Object.fromEntries(V2_LAYOUT);
  const saved = state.me.ui_prefs?.dashboard;
  if (!saved) return { shown: V2_LAYOUT.filter(([id]) => usable(id)).map(([id, span]) => ({ id, span })), hidden: [] };
  const fit = (id, span) => (MODULES[id].spans.includes(span) ? span : defaults[id]);
  const order = saved.order.filter(usable);
  const hidden = saved.hidden.filter(usable);
  V2_LAYOUT.forEach(([id]) => { if (usable(id) && !order.includes(id) && !hidden.includes(id)) order.push(id); });
  return { shown: order.map((id) => ({ id, span: fit(id, saved.spans[id] ?? defaults[id]) })), hidden };
}

const icon = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
  hide: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.4 3M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4.4-1.1',
  plus: 'M12 5v14M5 12h14', tune: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
};

const timerSeconds = (t, now = Date.now()) => {
  if (!t) return 0;
  const pause = t.paused_seconds + (t.paused_at ? Math.max(0, now - Date.parse(t.paused_at)) / 1000 : 0);
  return Math.max(0, Math.floor((now - Date.parse(t.started_at)) / 1000 - pause));
};
const clock = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
const hours = (h) => Number(h).toLocaleString('de-DE', { maximumFractionDigits: 2 });

export async function render(view, params) {
  view.classList.add('dashboard-view');
  let scope = 'all';
  let mode = savedView();
  let range = 0;
  let latest = 0;
  let editing = isV2() && params?.get('edit') === '1';
  let data = {};
  let loaded = new Set();
  const weekStart = Number(state.me.week_start ?? 1);

  view.innerHTML = `<div class="page-head"><div>${isModern() ? `<h1>${greeting()}, ${esc(state.me.name)}</h1><p>Dein Überblick</p>` : `<h1>Dashboard</h1><p>Willkommen zurück, ${esc(state.me.name)}</p>`}</div>
    <div class="actions"><div class="seg" id="d-scope"><button data-s="solo">Solo</button><button data-s="shared">Organisation</button><button data-s="all" class="on">Gesamt</button></div>
    <div class="seg" id="d-view">${[['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat']].map(([value, label]) => `<button data-v="${value}" class="${value === mode ? 'on' : ''}">${label}</button>`).join('')}</div>
    <select id="d-range" style="width:170px" aria-label="Zeitraum">${periodOptions(mode, weekStart)}</select>
    ${isV2() ? `<button class="btn ghost" id="d-edit" aria-pressed="false">${icon(ICONS.tune)}<span>Anpassen</span></button>` : ''}
    ${can('transaction:create') ? '<button class="btn" id="d-new">Buchung</button>' : ''}</div></div>
    <div id="d-tray"></div><div id="d-body"></div>`;

  // Ausgemusterte Fahrzeuge gehören nicht mehr zum Fuhrpark (Wunsch des Auftraggebers vom 2026-11-10)
  const fetchers = {
    ov: (q) => api.get(`/stats/overview?${q}`),
    cats: (q) => api.get(`/stats/by-category?${q}`),
    tl: (q, now) => api.get(`/stats/timeline?scope=${scope}&${VIEWS[mode].query}&week_start=${weekStart}&to=${now}`),
    spending: () => api.get('/spending-budgets'),
    txs: (q, now) => api.get(`/transactions?scope=${scope}&limit=6&to=${now}`).catch(() => ({ items: [] })),
    vehicles: () => api.get('/vehicles').then((list) => list.filter((v) => v.status !== 'retired')),
    events: () => api.get('/calendar'),
    forecast: (q, now) => api.get(`/stats/forecast?scope=${scope}&week_start=${weekStart}&today=${now}`).catch(() => null),
    timer: () => api.get('/work-hours/timer').catch(() => null),
    week: (q, now) => api.get(`/work-hours?from=${period('week', 0, weekStart).from}&to=${now}`).catch(() => ({ total_hours: 0 })),
    accounts: () => api.get('/budgets').then((list) => list.filter((b) => !b.archived)),
    goals: () => api.get('/goals').catch(() => []),
    todos: () => api.get('/todos').then((list) => list.filter((t) => !t.done_at)).catch(() => []),
  };

  async function load() {
    const current = ++latest;
    // Das Dashboard zeigt nur den echten Stand: Buchungen mit Datum in der Zukunft zählen noch nicht
    const now = todayStr();
    const span = period(mode, range, weekStart);
    const from = span.from, to = span.to > now ? now : span.to;
    const q = `scope=${scope}&from=${from}&to=${to}`;
    const keys = [...new Set(resolveLayout().shown.flatMap(({ id }) => MODULES[id].need))];
    const values = await Promise.all(keys.map((key) => fetchers[key](q, now)));
    // Ein schneller Wechsel der Ansicht darf nicht von einer älteren Antwort überschrieben werden
    if (current !== latest || !view.isConnected) return;
    data = Object.fromEntries(keys.map((key, i) => [key, values[i]]));
    loaded = new Set(keys);
    paint();
  }

  const BODY = {
    kpis() {
      const ov = data.ov;
      const inc = Number(ov.income), exp = Number(ov.expense);
      const rate = inc > 0 ? Math.round(((inc - exp) / inc) * 100) : 0;
      return `<div class="grid cols-4 kpi-grid" style="margin:0">
        <div class="card kpi"><span class="label">Gesamtsaldo</span><span class="value">${eur(ov.saldo)}</span><span class="delta muted">alle Buchungen bis heute</span></div>
        <div class="card kpi"><span class="label">Einnahmen</span><span class="value">${eur(inc)}</span><span class="delta muted">${VIEWS[mode].caption}</span></div>
        <div class="card kpi"><span class="label">Ausgaben</span><span class="value">${eur(exp)}</span><span class="delta muted">${VIEWS[mode].caption}</span></div>
        <div class="card kpi"><span class="label">Sparquote</span><span class="value">${rate} %</span><span class="delta ${rate >= 0 ? 'up' : 'down'}">${eur(inc - exp)} Überschuss</span></div>
      </div>`;
    },
    forecast: () => (data.forecast ? forecastHtml(data.forecast) : `<div class="card"><div class="card-head"><h2>Prognose</h2></div>${empty('Die Prognose ist gerade nicht verfügbar.')}</div>`),
    cashflow: () => `<div class="card"><div class="card-head"><h2>Cashflow · ${VIEWS[mode].chart}</h2><div class="legend"><span style="--c:var(--c1)">Einnahmen</span><span style="--c:var(--c2)">Ausgaben</span></div></div><div class="chart" id="d-cash"></div></div>`,
    categories: () => `<div class="card"><div class="card-head"><h2>Ausgaben nach Kategorie</h2></div>${data.cats.length ? '<div class="chart" id="d-donut"></div>' : empty('Keine Ausgaben in diesem Zeitraum.')}</div>`,
    budgets() {
      const shown = data.spending.slice(0, 6);
      return `<div class="card"><div class="card-head"><h2>Budget-Auslastung</h2><a class="btn ghost sm" href="#/spending">Alle anzeigen</a></div>
        ${shown.length ? `<div class="grid cols-3 gauge-grid" style="margin:0;gap:8px">${shown.map((b, i) => `<div class="gauge"><div class="chart" data-g="${i}"></div><div class="g-label">${esc(b.name)}</div><small>${eur0(b.used)} / ${eur0(b.limit_amount)}</small></div>`).join('')}</div>` : empty('Noch keine Budgets angelegt.')}</div>`;
    },
    transactions: () => `<div class="card"><div class="card-head"><h2>Letzte Buchungen</h2><a class="btn ghost sm" href="#/transactions">Alle anzeigen</a></div>
      ${data.txs.items.length ? data.txs.items.map((t) => `<div class="list-item"><div class="grow"><b>${esc(t.title || t.category_name || '–')}</b><small>${esc(t.category_name || '–')} · ${fdate(t.booked_at)}</small></div>${budgetTag(t.budget_type, t.budget_name)}<b class="${t.type === 'expense' ? 'down' : 'up'}">${t.type === 'expense' ? '−' : '+'}${eur(t.amount)}</b></div>`).join('') : empty('Noch keine Buchungen.')}</div>`,
    fleet() {
      const vehicles = data.vehicles;
      const vehicleStatus = { available: ['ok', 'Verfügbar'], in_use: ['warn', 'Im Einsatz'], workshop: ['bad', 'Werkstatt'] };
      const items = vehicles.slice(0, 5);
      const today = todayStr();
      return `<div class="card"><div class="card-head"><h2>Fuhrpark</h2><a class="btn ghost sm" href="#/assets-vehicles">Alle Fahrzeuge</a></div>
        ${vehicles.length ? `<div class="dashboard-summary"><span>${vehicles.length} Fahrzeuge</span><span>${vehicles.filter((v) => v.status === 'in_use').length} im Einsatz</span><span>${vehicles.filter((v) => v.status === 'workshop').length} in Werkstatt</span></div>
          ${items.map((v) => {
            const due = v.service_due?.slice(0, 10);
            const days = due ? (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000 : null;
            const serviceTag = days === null ? '' : `<span class="tag ${days < 0 ? 'bad' : days <= 30 ? 'warn' : 'ok'}">${days < 0 ? `Service überfällig · ${fdate(due)}` : `Service · ${fdate(due)}`}</span>`;
            const [statusClass, statusLabel] = vehicleStatus[v.status] || ['sys', v.status];
            return `<div class="list-item"><div class="grow"><b>${esc(v.make_model)}</b><small>${esc(v.plate)}</small></div><span class="tag ${statusClass}">${esc(statusLabel)}</span>${serviceTag}</div>`;
          }).join('')}${vehicles.length > items.length ? `<a class="dashboard-more" href="#/assets-vehicles">+ ${vehicles.length - items.length} weitere Fahrzeuge</a>` : ''}` : empty('Noch keine Fahrzeuge erfasst.')}</div>`;
    },
    upcoming() {
      const eventTypes = { finance: 'Zahlung', vehicle: 'Fahrzeug', key: 'Schlüssel', house: 'Wartung', license: 'Lizenz', training: 'Schulung', todo: 'ToDo', team: 'Organisation', personal: 'Privat' };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const upcoming = [];
      for (let offset = 0; offset < 30; offset++) {
        const day = new Date(today);
        day.setDate(day.getDate() + offset);
        const key = day.toLocaleDateString('sv-SE');
        data.events.forEach((event) => {
          if (event.type !== 'holiday' && occursOn(event.date.slice(0, 10), event.repeat, event.repeat_interval, key)) upcoming.push({ ...event, occurrence: key });
        });
      }
      upcoming.sort((a, b) => a.occurrence.localeCompare(b.occurrence) || (a.start || '').localeCompare(b.start || ''));
      return `<div class="card"><div class="card-head"><h2>Als Nächstes</h2><a class="btn ghost sm" href="#/calendar">Kalender öffnen</a></div>
        ${upcoming.length ? upcoming.slice(0, 6).map((event) => `<div class="list-item dashboard-event"><span class="dashboard-date">${fdate(event.occurrence)}</span><div class="grow"><b>${esc(event.title)}</b><small>${esc(event.start ? `${event.start}${event.end ? `–${event.end}` : ''} · ` : '')}${esc(event.note || eventTypes[event.type] || 'Termin')}</small></div></div>`).join('') : empty('Keine Termine in den nächsten 30 Tagen.')}</div>`;
    },
    timer() {
      const t = data.timer;
      const done = Number(data.week?.total_hours || 0);
      const target = Number(state.me.weekly_work_hours || 0);
      const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
      const status = !t ? '<span class="tag sys">Ausgestempelt</span>' : t.paused_at ? '<span class="tag warn">Pause</span>' : '<span class="tag ok">Läuft</span>';
      return `<div class="card dash-timer"><div class="card-head"><h2>Stundenzettel</h2>${status}</div>
        <div class="dash-timer-body">
          <svg class="dash-ring" viewBox="0 0 80 80" role="img" aria-label="${hours(done)} von ${hours(target)} Stunden Wochen-Soll"><circle cx="40" cy="40" r="34" pathLength="100" class="track"/><circle cx="40" cy="40" r="34" pathLength="100" class="fill" stroke-dasharray="${pct} 100"/><text x="40" y="45" text-anchor="middle">${pct} %</text></svg>
          <div class="grow"><div class="dash-clock" data-clock>${clock(timerSeconds(t))}</div>
          <small class="muted">${t ? `seit ${new Date(t.started_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}${t.project_name ? ` · ${esc(t.project_name)}` : ''}` : 'Kein Timer aktiv'}</small>
          <small class="muted" style="display:block">Woche ${hours(done)} / ${hours(target)} h</small></div>
        </div>
        <div class="row" style="margin-top:14px;gap:8px;justify-content:flex-start">${t
          ? `<button class="btn ghost" data-timer="${t.paused_at ? 'resume' : 'pause'}">${t.paused_at ? 'Fortsetzen' : 'Pause'}</button><button class="btn" data-timer="stop">Ausstempeln</button>`
          : '<button class="btn" data-timer="start">Einstempeln</button>'}<a class="btn ghost" href="#/work">Öffnen</a></div></div>`;
    },
    accounts: () => `<div class="card"><div class="card-head"><h2>Konten</h2><a class="btn ghost sm" href="#/budgets">Alle anzeigen</a></div>
      ${data.accounts.length ? data.accounts.slice(0, 6).map((b) => `<div class="list-item"><div class="grow"><b>${esc(b.name)}</b><small>${b.type === 'solo' ? 'Persönlich' : `Organisation · ${esc(b.team_name || '')}`}${b.interest_rate ? ' · mit Zinsen' : ''}</small></div><b class="${Number(b.balance) < 0 ? 'down' : ''}">${eur(b.balance)}</b></div>`).join('') : empty('Noch keine Konten.')}</div>`,
    goals: () => `<div class="card"><div class="card-head"><h2>Sparziele</h2><a class="btn ghost sm" href="#/goals">Alle anzeigen</a></div>
      ${data.goals.length ? data.goals.slice(0, 4).map((g) => {
        const pct = Math.round((Number(g.saved) / Number(g.target_amount)) * 100);
        return `<div class="dash-goal"><div class="row between"><b>${esc(g.name)}</b><small class="muted">${eur0(g.saved)} / ${eur0(g.target_amount)}</small></div>${progress(pct)}<small class="muted">${esc(g.budget_name)}${g.target_date ? ` · bis ${fdate(g.target_date)}` : ''}</small></div>`;
      }).join('') : empty('Noch keine Sparziele.')}</div>`,
    music() {
      return '<div class="card" data-music-mini></div>';
    },
    todos() {
      const today = todayStr();
      const due = (d) => (!d ? '' : d.slice(0, 10) < today ? `<span class="tag bad">überfällig · ${fdate(d)}</span>` : d.slice(0, 10) === today ? '<span class="tag warn">heute</span>' : `<span class="tag sys">${fdate(d)}</span>`);
      return `<div class="card"><div class="card-head"><h2>ToDos</h2><a class="btn ghost sm" href="#/todos">Alle anzeigen</a></div>
        ${data.todos.length ? data.todos.slice(0, 6).map((t) => `<label class="list-item dash-todo"><input type="checkbox" data-todo="${t.id}" ${t.level >= 3 ? '' : 'disabled'} aria-label="${esc(t.title)} erledigen"><span class="grow"><b>${esc(t.title)}</b><small>${t.team_name ? esc(t.team_name) : 'Solo'}</small></span>${due(t.due_date)}</label>`).join('') : empty('Keine offenen ToDos.')}</div>`;
    },
  };

  function mountCharts() {
    if (data.tl && $('#d-cash', view)) {
      areaChart($('#d-cash', view), {
        labels: data.tl.map((r) => (r.month ? MONTH_NAMES[Number(r.month.slice(5)) - 1].slice(0, 3) : fdate(r.bucket).slice(0, 6))),
        series: [{ name: 'Einnahmen', color: 'var(--c1)', data: data.tl.map((r) => Number(r.income)) }, { name: 'Ausgaben', color: 'var(--c2)', data: data.tl.map((r) => Number(r.expense)) }],
        format: eur0,
      });
    }
    if (data.cats?.length && $('#d-donut', view)) donut($('#d-donut', view), { items: data.cats.map((c) => ({ name: c.name, value: Number(c.total), color: c.color })), format: eur0 });
    if (data.spending) data.spending.slice(0, 6).forEach((b, i) => { const el = $(`[data-g="${i}"]`, view); if (el) gauge(el, { value: Math.min(100, b.pct) }); });
  }

  function tools(id, span, index, count) {
    const m = MODULES[id];
    return `<div class="mod-tools" role="group" aria-label="${esc(m.title)} anpassen">
      <span class="mod-grip" title="Ziehen zum Verschieben">${icon(ICONS.grip)}<b>${esc(m.title)}</b></span>
      <button type="button" class="mod-btn" data-move="-1" aria-label="${esc(m.title)} nach vorn" ${index === 0 ? 'disabled' : ''}>${icon(ICONS.left)}</button>
      <button type="button" class="mod-btn" data-move="1" aria-label="${esc(m.title)} nach hinten" ${index === count - 1 ? 'disabled' : ''}>${icon(ICONS.right)}</button>
      <select data-span aria-label="Breite von ${esc(m.title)}">${m.spans.map((s) => `<option value="${s}" ${s === span ? 'selected' : ''}>${SPAN_LABELS[s]}</option>`).join('')}</select>
      <button type="button" class="mod-btn" data-hide aria-label="${esc(m.title)} ausblenden">${icon(ICONS.hide)}</button></div>`;
  }

  function mountMusic() {
    const el = $('[data-music-mini]', view);
    if (el) import('./music.js').then((m) => m.mountMiniPlayer(el)).catch(() => {});
  }

  function paint() {
    const { shown, hidden } = resolveLayout();
    const missing = shown.some(({ id }) => MODULES[id].need.some((key) => !loaded.has(key)));
    if (missing) { load().catch((error) => toast(error.message, true)); return; }
    $('#d-edit', view)?.classList.toggle('on', editing);
    $('#d-edit', view)?.setAttribute('aria-pressed', String(editing));
    $('#d-tray', view).innerHTML = editing ? `<div class="card dash-tray"><div class="grow"><b>Dashboard anpassen</b><small class="muted">Module ziehen oder mit den Pfeilen verschieben, Breite wählen, ausblenden. Wird sofort gespeichert.</small></div>
      <div class="chips">${hidden.map((id) => `<button type="button" class="btn ghost sm" data-add="${id}">${icon(ICONS.plus)}${esc(MODULES[id].title)}</button>`).join('')}</div>
      <button type="button" class="btn ghost sm" data-reset>Standard wiederherstellen</button><button type="button" class="btn sm" data-done>Fertig</button></div>` : '';
    $('#d-body', view).innerHTML = `<div class="dash-grid ${editing ? 'editing' : ''}">${shown.map(({ id, span }, index) => `<section class="dash-mod" data-mod="${id}" data-span="${span}" style="--span:${span}" ${editing ? 'draggable="true"' : ''} aria-label="${esc(MODULES[id].title)}">
      ${editing ? tools(id, span, index, shown.length) : ''}${BODY[id]()}</section>`).join('') || empty('Alle Module sind ausgeblendet. Unter „Anpassen“ kannst du sie wieder hinzufügen.')}</div>`;
    mountCharts();
    mountMusic();
  }

  // Layout speichern: immer das ganze Objekt (PATCH /me prüft es vollständig)
  async function saveLayout(dashboard) {
    const before = state.me.ui_prefs;
    state.me.ui_prefs = { ...before, dashboard };
    paint();
    try {
      const user = await api.patch('/me', { ui_prefs: state.me.ui_prefs });
      state.me.ui_prefs = user.ui_prefs;
    } catch (error) {
      state.me.ui_prefs = before;
      paint();
      toast(error.message, true);
    }
  }
  const current = () => {
    const { shown, hidden } = resolveLayout();
    return { order: shown.map((m) => m.id), hidden, spans: Object.fromEntries(shown.map((m) => [m.id, m.span])) };
  };
  const move = (id, target, after) => {
    const layout = current();
    const order = layout.order.filter((x) => x !== id);
    let index = order.indexOf(target);
    if (index < 0) return;
    if (after) index += 1;
    order.splice(index, 0, id);
    saveLayout({ ...layout, order });
  };

  // Stempeluhr im Modul läuft sekundengenau weiter, bis die Seite verlassen wird
  const tick = setInterval(() => {
    if (!view.isConnected) { clearInterval(tick); return; }
    const el = $('[data-clock]', view);
    if (el && data.timer) el.textContent = clock(timerSeconds(data.timer));
  }, 1000);

  const reload = () => load().catch((error) => toast(error.message, true));
  view.addEventListener('click', async (e) => {
    const s = e.target.closest('#d-scope [data-s]');
    if (s) { scope = s.dataset.s; $$('#d-scope button', view).forEach((b) => b.classList.toggle('on', b === s)); reload(); }
    const v = e.target.closest('#d-view [data-v]');
    if (v && v.dataset.v !== mode) {
      mode = v.dataset.v;
      range = 0;
      saveView(mode);
      $$('#d-view button', view).forEach((b) => b.classList.toggle('on', b === v));
      $('#d-range', view).innerHTML = periodOptions(mode, weekStart);
      reload();
    }
    if (e.target.closest('#d-new') && (await txForm())) reload();
    if (e.target.closest('#d-edit') || e.target.closest('[data-done]')) { editing = !editing; paint(); return; }
    if (e.target.closest('[data-reset]')) { saveLayout(null); return; }
    const add = e.target.closest('[data-add]');
    if (add) {
      const layout = current();
      saveLayout({ ...layout, order: [...layout.order, add.dataset.add], hidden: layout.hidden.filter((id) => id !== add.dataset.add) });
      return;
    }
    const mod = e.target.closest('.dash-mod')?.dataset.mod;
    if (mod && e.target.closest('[data-hide]')) {
      const layout = current();
      saveLayout({ ...layout, order: layout.order.filter((id) => id !== mod), hidden: [...layout.hidden, mod] });
      return;
    }
    const step = e.target.closest('[data-move]');
    if (mod && step) {
      const order = current().order;
      const target = order[order.indexOf(mod) + Number(step.dataset.move)];
      if (target) move(mod, target, Number(step.dataset.move) > 0);
      return;
    }
    const action = e.target.closest('[data-timer]')?.dataset.timer;
    if (action) {
      try {
        if (action === 'start') await api.post('/work-hours/timer/start', {});
        else await api.post(`/work-hours/timer/${action}`);
        if (action === 'stop') toast('Ausgestempelt');
      } catch (error) {
        toast(error.message, true);
      }
      reload();
    }
  });
  view.addEventListener('change', async (e) => {
    if (e.target.id === 'd-range') { range = Number(e.target.value); reload(); return; }
    const mod = e.target.closest('.dash-mod')?.dataset.mod;
    if (mod && e.target.matches('[data-span]')) {
      const layout = current();
      saveLayout({ ...layout, spans: { ...layout.spans, [mod]: Number(e.target.value) } });
      return;
    }
    const todo = e.target.closest('[data-todo]');
    if (todo) {
      try {
        await api.patch(`/todos/${todo.dataset.todo}`, { done: true });
        toast('ToDo erledigt');
      } catch (error) {
        todo.checked = false;
        toast(error.message, true);
      }
      reload();
    }
  });

  // Ziehen und Ablegen im Bearbeitungsmodus; ohne Maus helfen die Pfeil-Knöpfe
  let dragged = null;
  view.addEventListener('dragstart', (e) => {
    const sec = e.target.closest?.('.dash-grid.editing .dash-mod');
    if (!sec) return;
    dragged = sec.dataset.mod;
    sec.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged);
  });
  view.addEventListener('dragover', (e) => {
    const sec = e.target.closest?.('.dash-grid.editing .dash-mod');
    if (!sec || !dragged) return;
    e.preventDefault();
    $$('.dash-mod.drop-before, .dash-mod.drop-after', view).forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    if (sec.dataset.mod === dragged) return;
    const rect = sec.getBoundingClientRect();
    sec.classList.add(e.clientX > rect.left + rect.width / 2 ? 'drop-after' : 'drop-before');
  });
  view.addEventListener('drop', (e) => {
    const sec = e.target.closest?.('.dash-grid.editing .dash-mod');
    if (!sec || !dragged) return;
    e.preventDefault();
    const after = sec.classList.contains('drop-after');
    if (sec.dataset.mod !== dragged) move(dragged, sec.dataset.mod, after);
    dragged = null;
  });
  view.addEventListener('dragend', () => {
    dragged = null;
    $$('.dash-mod', view).forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after'));
  });

  await load();
}
