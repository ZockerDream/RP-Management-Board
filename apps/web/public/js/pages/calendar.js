import { api } from '../api.js';
import { $, esc } from '../ui.js';
import { initCalendar } from '../calendar.js';
import { can } from '../app.js';

const MODAL = `<div class="modal" id="m-event"><div class="card"><div class="card-head"><h2 id="ev-head">Neuer Termin</h2></div>
  <div class="form">
    <label class="field full">Titel<input id="ev-title" placeholder="z. B. Service Transporter"></label>
    <label class="field">Kalender<select id="ev-type"><option value="personal">Privat</option><option value="team">Organisation</option></select></label>
    <label class="field">Datum<input type="date" id="ev-date"></label>
    <label class="field full" id="ev-team-wrap">Organisation<select id="ev-team"></select></label>
    <label class="field full row start"><input type="checkbox" id="ev-allday"> Ganztägig</label>
    <label class="field" id="ev-times-a">Beginn<input type="time" id="ev-start" value="09:00"></label>
    <label class="field" id="ev-times-b">Ende<input type="time" id="ev-end" value="10:00"></label>
    <label class="field">Wiederholung<select id="ev-repeat"><option value="none">Keine</option><option value="daily">Täglich</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option><option value="custom">Benutzerdefiniert (Tage)</option></select></label>
    <label class="field" id="ev-repeat-interval-wrap" hidden>Abstand in Tagen<input id="ev-repeat-interval" type="number" min="1" max="3650" value="1"></label>
    <label class="field">Erinnerung<select id="ev-remind"><option value="none">Keine</option><option value="1d">1 Tag vorher</option><option value="3d">3 Tage vorher</option><option value="7d">7 Tage vorher</option><option value="14d">14 Tage vorher</option></select></label>
    <label class="field full">Betrag (optional, negativ = Ausgabe)<input id="ev-amount" placeholder="-450"></label>
    <label class="field full">Notiz<input id="ev-note"></label>
    <p class="muted full" id="ev-occ"></p>
  </div>
  <div class="modal-foot"><button class="btn danger" id="ev-del">Löschen</button><button class="btn ghost" data-close>Schließen</button><button class="btn" id="ev-save">Speichern</button></div>
</div></div>`;

export async function render(view) {
  const teams = can('team:read') ? await api.get('/teams') : [];
  view.innerHTML = `<div id="cal">
  <div class="page-head"><div><h1>Kalender</h1><p>Zahlungen, Services, Schlüssel-Fristen, Termine der Organisation und private Termine</p></div>
    <div class="actions">${can('calendar:create') ? '<button class="btn" id="cal-new">Neuer Termin</button>' : ''}</div></div>
  <div class="cal-layout"><div class="card cal-main"><div class="cal-bar"><div class="row start">
    <button class="btn ghost sm" data-nav="-1" aria-label="Zurück">‹</button><button class="btn ghost sm" data-nav="0">Heute</button><button class="btn ghost sm" data-nav="1" aria-label="Weiter">›</button><h2 id="cal-title"></h2></div>
    <div class="seg"><button data-view="month" class="on">Monat</button><button data-view="week">Woche</button><button data-view="day">Tag</button><button data-view="agenda">Agenda</button></div></div>
    <div id="cal-body"></div></div>
  <div class="cal-side"><div class="card"><div class="card-head"><h2>Kalender</h2></div><div id="cal-filters"></div></div>
    <div class="card"><div class="card-head"><h2>Als Nächstes</h2></div><div id="cal-upcoming"></div></div>
    <div class="card"><div class="card-head"><h2>Zahlungen im Monat</h2></div><div id="cal-sum" class="stack"></div></div></div></div></div>`;
  $('#m-event')?.remove();
  $('#modals').insertAdjacentHTML('beforeend', MODAL);
  $('#ev-team').innerHTML = teams.filter((t) => t.levels.calendar >= 3).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  $('#ev-type option[value=team]').disabled = !$('#ev-team').options.length;
  initCalendar();
}
