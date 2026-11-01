import { api } from './api.js';
import { toast } from './ui.js';
const $ = (s, r = document) => r.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const H0 = 7, H1 = 20, HOUR = 48;

export const TYPES = {
  finance: { label: 'Zahlungen', color: 'var(--primary)' },
  vehicle: { label: 'Fahrzeuge', color: 'var(--warn)' },
  key: { label: 'Schlüssel', color: 'var(--bad)' },
  house: { label: 'Häuser', color: 'var(--ok)' },
  team: { label: 'Team', color: '#8b5cf6' },
  personal: { label: 'Privat', color: '#0ea5e9' },
  holiday: { label: 'Feiertage', color: 'var(--muted)' },
};

const today = new Date(); today.setHours(0, 0, 0, 0);
let events = [];
const st = { view: 'month', cursor: new Date(today), hidden: new Set(['holiday'].filter(() => false)), editing: null };

const occursOn = (e, d) => {
  const s = parse(e.date);
  if (d < s) return false;
  switch (e.repeat) {
    case 'weekly': return d.getDay() === s.getDay();
    case 'monthly': return d.getDate() === s.getDate();
    case 'yearly': return d.getDate() === s.getDate() && d.getMonth() === s.getMonth();
    default: return ymd(d) === e.date;
  }
};
const on = d => events.filter(e => !st.hidden.has(e.type) && occursOn(e, d))
  .sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start || '').localeCompare(b.start || ''));

const eur = n => (n > 0 ? '+' : '−') + Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: n % 1 ? 2 : 0 }) + ' €';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const timeLabel = e => e.allDay ? 'Ganztägig' : `${e.start}–${e.end}`;
const chip = (e, d) => `<button class="chip" data-ev="${e.id}" data-date="${ymd(d)}" style="--c:${TYPES[e.type].color}" title="${esc(e.title)}">${e.allDay ? '' : `<i>${e.start}</i>`}${esc(e.title)}</button>`;

function title() {
  const c = st.cursor;
  if (st.view === 'month') return `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  if (st.view === 'day') return `${DAYS_LONG[c.getDay()]}, ${c.getDate()}. ${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  if (st.view === 'week') {
    const a = monday(c), b = addDays(a, 6);
    return `${a.getDate()}. ${a.getMonth() === b.getMonth() ? '' : MONTHS[a.getMonth()] + ' '}– ${b.getDate()}. ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  }
  return 'Nächste 30 Tage';
}

function monthView() {
  const first = new Date(st.cursor.getFullYear(), st.cursor.getMonth(), 1);
  const start = monday(first);
  let h = `<div class="m-head">${DAYS.map(d => `<div>${d}</div>`).join('')}</div><div class="m-grid">`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), list = on(d);
    const cls = ['m-cell', d.getMonth() !== first.getMonth() && 'out', +d === +today && 'today'].filter(Boolean).join(' ');
    h += `<div class="${cls}" data-day="${ymd(d)}"><span class="m-num">${d.getDate()}</span>${list.slice(0, 3).map(e => chip(e, d)).join('')}${list.length > 3 ? `<button class="more" data-goday="${ymd(d)}">+${list.length - 3} weitere</button>` : ''}</div>`;
  }
  return h + '</div>';
}

function gridView(days) {
  const cols = `grid-template-columns: 52px repeat(${days.length}, 1fr)`;
  let h = `<div class="t-head" style="${cols}"><div></div>${days.map(d => `<button class="${+d === +today ? 'today' : ''}" data-goday="${ymd(d)}"><small>${DAYS[(d.getDay() + 6) % 7]}</small><b>${d.getDate()}</b></button>`).join('')}</div>`;
  h += `<div class="t-allday" style="${cols}"><div class="muted">Ganztägig</div>${days.map(d => `<div data-day="${ymd(d)}">${on(d).filter(e => e.allDay).map(e => chip(e, d)).join('')}</div>`).join('')}</div>`;
  h += `<div class="t-body" style="${cols}"><div class="t-hours">${Array.from({ length: H1 - H0 }, (_, i) => `<div style="height:${HOUR}px"><span>${pad(H0 + i)}:00</span></div>`).join('')}</div>`;
  h += days.map(d => {
    const evs = on(d).filter(e => !e.allDay);
    const now = +d === +today ? `<div class="now" style="top:${(new Date().getHours() + new Date().getMinutes() / 60 - H0) * HOUR}px"></div>` : '';
    return `<div class="t-col" data-day="${ymd(d)}" style="height:${(H1 - H0) * HOUR}px">${now}${evs.map(e => {
      const [sh, sm] = e.start.split(':').map(Number), [eh, em] = e.end.split(':').map(Number);
      const top = (sh + sm / 60 - H0) * HOUR, height = Math.max(24, (eh + em / 60 - sh - sm / 60) * HOUR - 2);
      return `<button class="block" data-ev="${e.id}" data-date="${ymd(d)}" style="--c:${TYPES[e.type].color};top:${top}px;height:${height}px"><b>${esc(e.title)}</b><span>${e.start}–${e.end}</span></button>`;
    }).join('')}</div>`;
  }).join('') + '</div>';
  return h;
}

function agendaView() {
  let h = '';
  for (let i = 0; i < 30; i++) {
    const d = addDays(st.cursor, i), list = on(d);
    if (!list.length) continue;
    h += `<div class="ag-day"><div class="ag-date${+d === +today ? ' today' : ''}"><b>${d.getDate()}</b><span>${DAYS_LONG[d.getDay()].slice(0, 2)}., ${MONTHS[d.getMonth()].slice(0, 3)}.</span></div><div class="ag-list">${list.map(e => `<button class="ag-item" data-ev="${e.id}" data-date="${ymd(d)}" style="--c:${TYPES[e.type].color}"><span class="ag-time">${timeLabel(e)}</span><b>${esc(e.title)}</b><span class="muted">${esc(e.note || TYPES[e.type].label)}</span>${e.amount ? `<span class="${e.amount > 0 ? 'up' : 'down'} ag-amt">${eur(e.amount)}</span>` : ''}</button>`).join('')}</div></div>`;
  }
  return h || '<p class="muted">Keine Termine in diesem Zeitraum.</p>';
}

function side() {
  $('#cal-filters').innerHTML = Object.entries(TYPES).map(([k, t]) =>
    `<label class="cal-filter"><input type="checkbox" data-filter="${k}" ${st.hidden.has(k) ? '' : 'checked'}><i style="background:${t.color}"></i>${t.label}</label>`).join('');
  const up = [];
  for (let i = 0; i < 14 && up.length < 6; i++) on(addDays(today, i)).filter(e => e.type !== 'holiday').forEach(e => up.length < 6 && up.push([addDays(today, i), e]));
  $('#cal-upcoming').innerHTML = up.map(([d, e]) => `<button class="up-item" data-ev="${e.id}" data-date="${ymd(d)}" style="--c:${TYPES[e.type].color}"><b>${esc(e.title)}</b><span class="muted">${+d === +today ? 'Heute' : d.getDate() + '.' + pad(d.getMonth() + 1) + '.'} · ${timeLabel(e)}</span></button>`).join('') || '<p class="muted">Nichts in den nächsten 14 Tagen.</p>';
  const sum = { out: 0, inc: 0 };
  const a = new Date(st.cursor.getFullYear(), st.cursor.getMonth(), 1), z = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  for (let d = new Date(a); d <= z; d = addDays(d, 1)) on(d).forEach(e => { if (e.amount) (e.amount < 0 ? (sum.out += e.amount) : (sum.inc += e.amount)); });
  $('#cal-sum').innerHTML = `<div class="row between"><span class="muted">Einnahmen</span><b class="up">${eur(sum.inc)}</b></div><div class="row between"><span class="muted">Ausgaben</span><b class="down">${eur(sum.out)}</b></div><div class="row between"><span class="muted">Saldo ${MONTHS[a.getMonth()]}</span><b>${eur(sum.inc + sum.out)}</b></div>`;
}

function render() {
  if (!$('#cal-body')) return;
  $('#cal-title').textContent = title();
  const v = st.view;
  $('#cal-body').innerHTML = v === 'month' ? monthView() : v === 'week' ? gridView(Array.from({ length: 7 }, (_, i) => addDays(monday(st.cursor), i))) : v === 'day' ? gridView([st.cursor]) : agendaView();
  document.querySelectorAll('#cal [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  side();
  const t = $('#cal-body .t-body'); if (t) t.scrollTop = 0;
}

const setTimes = hide => ['#ev-times-a', '#ev-times-b'].forEach(s => { $(s).hidden = hide; });

function openEvent(id, date, day) {
  const e = id ? events.find(x => x.id === id) : null;
  st.editing = e;
  const m = $('#m-event');
  const f = k => $('#ev-' + k);
  $('#ev-head').textContent = e ? (e.locked ? 'Schreibgeschützt' : 'Termin bearbeiten') : 'Neuer Termin';
  f('title').value = e?.title || '';
  f('type').value = ['team', 'personal'].includes(e?.type) ? e.type : 'personal';
  $('#ev-team-wrap').hidden = f('type').value !== 'team';
  f('date').value = e ? e.date : (day || ymd(st.cursor));
  f('allday').checked = e ? !!e.allDay : false;
  f('start').value = e?.start || '09:00';
  f('end').value = e?.end || '10:00';
  f('repeat').value = e?.repeat || 'none';
  f('remind').value = e?.remind || 'none';
  f('amount').value = e?.amount ?? '';
  f('note').value = e?.note || '';
  setTimes(f('allday').checked);
  $('#ev-del').hidden = !e || e.locked;
  $('#ev-save').hidden = !!e?.locked;
  if (e && date && e.repeat !== 'none') $('#ev-occ').textContent = `Serientermin · dieser Eintrag: ${date.split('-').reverse().join('.')}`; else $('#ev-occ').textContent = '';
  m.classList.add('open');
}

async function save() {
  const f = k => $('#ev-' + k);
  if (!f('title').value.trim()) return f('title').focus();
  const allDay = f('allday').checked;
  const amountRaw = f('amount').value.trim().replace(',', '.');
  const data = { title: f('title').value.trim(), type: f('type').value, team_id: f('type').value === 'team' ? f('team').value || null : null, date: f('date').value, allDay, start: allDay ? null : f('start').value, end: allDay ? null : f('end').value, repeat: f('repeat').value, remind: f('remind').value, amount: amountRaw === '' ? null : amountRaw, note: f('note').value.trim() };
  if (!allDay && data.end <= data.start) return f('end').focus();
  try {
    if (st.editing) await api.put('/calendar/events/' + encodeURIComponent(st.editing.id), data); else await api.post('/calendar/events', data);
  } catch (err) { return toast(err.message); }
  $('#m-event').classList.remove('open');
  if (data.date) st.cursor = parse(data.date);
  await load();
  toast('Termin gespeichert');
}

function nav(dir) {
  const c = st.cursor;
  if (dir === 0) st.cursor = new Date(today);
  else if (st.view === 'month') st.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  else st.cursor = addDays(c, dir * (st.view === 'week' ? 7 : st.view === 'day' ? 1 : 30));
  render();
}

document.addEventListener('click', e => {
  const q = s => e.target.closest(s);
  if (q('#ev-save')) return save();
  if (q('#ev-del')) { api.del('/calendar/events/' + encodeURIComponent(st.editing.id)).then(() => { $('#m-event').classList.remove('open'); return load(); }).catch(err => toast(err.message)); return; }
  if (!$('#cal') || !q('#cal')) return;
  let t;
  if ((t = q('[data-view]'))) { st.view = t.dataset.view; return render(); }
  if ((t = q('[data-nav]'))) return nav(+t.dataset.nav);
  if ((t = q('[data-ev]'))) return openEvent(t.dataset.ev, t.dataset.date);
  if ((t = q('[data-goday]'))) { st.cursor = parse(t.dataset.goday); st.view = 'day'; return render(); }
  if (q('#cal-new')) return openEvent(null, null, ymd(st.cursor));
  if (q('[data-filter]')) return;
  if ((t = q('[data-day]'))) openEvent(null, null, t.dataset.day);
});
document.addEventListener('change', e => {
  if (e.target.dataset.filter) { e.target.checked ? st.hidden.delete(e.target.dataset.filter) : st.hidden.add(e.target.dataset.filter); render(); }
  if (e.target.id === 'ev-type') $('#ev-team-wrap').hidden = e.target.value !== 'team';
  if (e.target.id === 'ev-allday') setTimes(e.target.checked);
});

async function load() {
  if (!$('#cal-body')) return;
  const rows = await api.get('/calendar');
  events = rows.map(e => ({ ...e, amount: e.amount == null ? undefined : parseFloat(e.amount), start: e.start || undefined, end: e.end || undefined }));
  render();
}
export const initCalendar = () => load().catch(err => toast(err.message));
