// Fahndungsboard (Wunsch des Auftraggebers vom 2026-11-13): alle aktiven Fahndungen groß, mit Foto und Kennzeichen,
// z. B. auf einem zweiten Bildschirm. Aktualisiert sich jede Minute; „Vollbild“ blendet alles andere aus.
import { api } from '../api.js';
import { $, esc, empty, fdate, toast } from '../ui.js';
import { can } from '../app.js';
import { imageSrc } from '../gallery.js';
import { WARRANT_KIND, warrantExpired } from './case-parts.js';

export async function render(view) {
  const teams = can('team:read') ? (await api.get('/org-teams?module=casefile')) : [];
  let area = (() => { try { return localStorage.getItem('bolo.area') || 'all'; } catch { return 'all'; } })();
  if (area !== 'all' && !teams.some((t) => t.id === area)) area = 'all';
  view.innerHTML = `<div class="page-head"><div><h1>Fahndungsboard</h1><p>Aktive Fahndungen auf einen Blick</p></div>
    <div class="actions"><select id="bo-area" aria-label="Bereich"><option value="all">Alle Bereiche</option>${teams.map((t) => `<option value="${t.id}" ${t.id === area ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <input id="bo-q" type="search" class="search" placeholder="Name, Kennzeichen…" aria-label="Fahndungen durchsuchen" style="max-width:200px"><button class="btn ghost" id="bo-full">Vollbild</button></div></div>
    <div id="bo-board" class="bolo"></div>`;
  let list = [];
  let q = '';
  const shown = () => list.filter((w) => !q || `${w.person_name || ''} ${w.person_aliases || ''} ${w.plate || ''} ${w.reason || ''} ${w.file_number}`.toLowerCase().includes(q));
  function draw() {
    const items = shown();
    const board = $('#bo-board', view);
    board.innerHTML = `<p class="muted bolo-meta">${items.length} aktive Fahndung${items.length === 1 ? '' : 'en'} · Stand ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</p>
      ${items.length ? `<div class="bolo-grid">${items.map((w) => `<article class="bolo-card k-${w.kind} ${warrantExpired(w) ? 'expired' : ''}">
        <div class="bolo-kind">${esc(WARRANT_KIND[w.kind] || w.kind)}${warrantExpired(w) ? ' · abgelaufen' : ''}</div>
        <div class="bolo-photo" ${w.person_has_photo && w.person_id ? `data-photo="${w.person_id}"` : ''}>${w.kind === 'vehicle' && w.plate ? `<span class="bolo-plate">${esc(w.plate)}</span>` : '<span class="muted">Kein Foto</span>'}</div>
        <div class="bolo-body"><b class="bolo-name">${esc(w.person_name || w.plate || 'Unbekannt')}</b>${w.person_aliases ? `<small class="muted">alias ${esc(w.person_aliases)}</small>` : ''}
          ${w.plate && w.kind !== 'vehicle' ? `<span class="bolo-plate sm">${esc(w.plate)}</span>` : ''}
          ${w.reason ? `<p>${esc(w.reason)}</p>` : ''}
          <small class="muted">${esc(w.file_number)}${w.team_name ? ` · ${esc(w.team_name)}` : ''} · seit ${fdate(w.issued_on)}${w.valid_until ? ` · bis ${fdate(w.valid_until)}` : ''}</small>
          ${can('casefile:read') ? `<a class="btn ghost sm" href="#/casefiles?id=${w.case_file_id}">Akte</a>` : ''}</div></article>`).join('')}</div>` : `<div class="card">${empty('Keine aktiven Fahndungen.')}</div>`}`;
    // Fotos mit Anmeldung nachladen (data:-URL)
    if (can('person:read')) board.querySelectorAll('[data-photo]').forEach((el) => imageSrc(`/people/${el.dataset.photo}/photo`).then((src) => { el.innerHTML = `<img src="${src}" alt="">`; }).catch(() => {}));
  }
  async function load() {
    list = await api.get(`/warrants?status=active${area !== 'all' ? `&team_id=${area}` : ''}`);
    draw();
  }
  $('#bo-area', view).addEventListener('change', async (e) => { area = e.target.value; try { localStorage.setItem('bolo.area', area); } catch { /* egal */ } await load().catch((x) => toast(x.message, true)); });
  $('#bo-q', view).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  $('#bo-full', view).addEventListener('click', () => {
    const el = $('#bo-board', view);
    if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => toast('Vollbild wird hier nicht unterstützt', true));
  });
  const timer = setInterval(() => {
    if (!view.isConnected) { clearInterval(timer); return; }
    if (!document.hidden) load().catch(() => {});
  }, 60000);
  await load();
}
