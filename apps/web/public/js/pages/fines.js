// Bußgeldrechner (Wunsch des Auftraggebers vom 2026-11-13): Tatbestände aus dem Strafkatalog ankreuzen (mit Anzahl),
// Summe aus Geldstrafe, Haft und Punkten; ein Klick überträgt sie als Anklagepunkte in eine Fallakte.
import { api } from '../api.js';
import { $, $$, esc, empty, eur, openForm, toast } from '../ui.js';
import { can } from '../app.js';
import { jailText } from './case-parts.js';

export async function render(view) {
  const teams = can('team:read') ? await api.get('/org-teams?module=casefile') : [];
  let area = (() => { try { return localStorage.getItem('fines.area') || ''; } catch { return ''; } })();
  if (area && !teams.some((t) => t.id === area)) area = teams[0]?.id || '';
  view.innerHTML = `<div class="page-head"><div><h1>Bußgeldrechner</h1><p>Tatbestände ankreuzen, Summe sehen, in die Akte übertragen</p></div>
    <div class="actions"><select id="fi-area" aria-label="Strafkatalog"><option value="">Mein privater Katalog</option>${teams.map((t) => `<option value="${t.id}" ${t.id === area ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div></div>
    <div class="fines"><div><input id="fi-q" type="search" class="search" placeholder="Paragraph, Bezeichnung, Kategorie…" aria-label="Strafkatalog durchsuchen" style="width:100%;margin-bottom:10px"><div class="card" id="fi-list"></div></div>
    <aside class="card fines-sum" id="fi-sum"></aside></div>`;
  let codes = [];
  const picked = new Map();
  let q = '';
  function totals() {
    let fine = 0, jail = 0, points = 0;
    for (const [id, n] of picked) { const c = codes.find((x) => x.id === id); if (!c) continue; fine += Number(c.fine) * n; jail += c.jail * n; points += c.points * n; }
    return { fine, jail, points };
  }
  function drawSum() {
    const t = totals();
    const rows = [...picked].map(([id, n]) => ({ c: codes.find((x) => x.id === id), n })).filter((r) => r.c);
    $('#fi-sum', view).innerHTML = `<h2>Summe</h2>${rows.length ? rows.map(({ c, n }) => `<div class="row" style="gap:8px;margin:6px 0"><span class="grow"><b>${esc(c.code)}</b> ${esc(c.title)}</span><small>${n}×</small></div>`).join('') : '<p class="muted">Noch nichts angekreuzt.</p>'}
      <div class="fines-total"><div><small class="muted">Geldstrafe</small><b>${eur(t.fine)}</b></div><div><small class="muted">Haft</small><b>${jailText(t.jail)}</b></div><div><small class="muted">Punkte</small><b>${t.points}</b></div></div>
      ${rows.length ? `<div class="row start" style="gap:8px;flex-wrap:wrap"><button class="btn" id="fi-file" ${can('casefile:update') ? '' : 'disabled'}>In Akte übertragen</button><button class="btn ghost" id="fi-copy">Kopieren</button><button class="btn ghost" id="fi-clear">Leeren</button></div>` : ''}`;
  }
  function drawList() {
    const list = codes.filter((c) => c.active && (!q || `${c.code} ${c.title} ${c.category}`.toLowerCase().includes(q)));
    const cats = [...new Set(list.map((c) => c.category || 'Ohne Kategorie'))];
    $('#fi-list', view).innerHTML = list.length ? cats.map((cat) => `<h3 class="fines-cat">${esc(cat)}</h3>${list.filter((c) => (c.category || 'Ohne Kategorie') === cat).map((c) => `<label class="fines-row ${picked.has(c.id) ? 'on' : ''}">
      <input type="checkbox" data-code="${c.id}" ${picked.has(c.id) ? 'checked' : ''}><span class="grow"><b>${esc(c.code)}</b> ${esc(c.title)}<small class="muted">${eur(c.fine)}${c.jail ? ` · ${jailText(c.jail)}` : ''}${c.points ? ` · ${c.points} P.` : ''}</small></span>
      <input type="number" min="1" max="99" value="${picked.get(c.id) || 1}" data-count="${c.id}" aria-label="Anzahl ${esc(c.code)}" ${picked.has(c.id) ? '' : 'hidden'}></label>`).join('')}`).join('')
      : empty(codes.length ? 'Nichts gefunden.' : 'Der Strafkatalog dieses Bereichs ist leer. Lege ihn unter „Akten → Strafkatalog“ an.');
  }
  async function load() {
    codes = await api.get(area ? `/penal-codes?team_id=${area}` : '/penal-codes?private=1').catch((e) => { toast(e.message, true); return []; });
    picked.clear();
    drawList();
    drawSum();
  }
  async function toFile() {
    const files = (await api.get('/case-files')).filter((f) => (area ? f.team_id === area : !f.team_id) && f.level >= 3 && f.status !== 'closed');
    if (!files.length) throw new Error('Keine offene Fallakte in diesem Bereich, in die du schreiben darfst');
    let detail = await api.get(`/case-files/${files[0].id}`);
    const people = (d) => (d.people || []).filter((p) => p.name).map((p) => ({ v: p.person_id, l: `${p.name}${p.role ? ` (${p.role})` : ''}` }));
    const done = openForm({
      title: 'In Akte übertragen',
      fields: [
        { name: 'case_file_id', label: 'Fallakte', type: 'select', options: files.map((f) => ({ v: f.id, l: `${f.file_number} ${f.title}` })) },
        { name: 'person_id', label: 'Beschuldigte Person (an der Akte beteiligt)', type: 'select', options: people(detail) },
        { type: 'html', html: `<p class="muted">${picked.size} Tatbestände werden als offene Anklagepunkte eingetragen; Geldstrafe und Haft kommen aus dem Strafkatalog.</p>` },
      ],
      submit: 'Übertragen',
      onSubmit: async (v) => {
        if (!v.person_id) throw new Error('An dieser Akte ist noch keine Person beteiligt');
        for (const [id, n] of picked) await api.post(`/case-files/${v.case_file_id}/charges`, { penal_code_id: id, person_id: v.person_id, count: n });
        toast(`${picked.size} Anklagepunkte in ${files.find((f) => f.id === v.case_file_id).file_number} eingetragen`);
        return { file: v.case_file_id };
      },
    });
    const m = $('#modals .modal:last-child');
    $('[name=case_file_id]', m).addEventListener('change', async (e) => {
      detail = await api.get(`/case-files/${e.target.value}`);
      $('[name=person_id]', m).innerHTML = people(detail).map((o) => `<option value="${o.v}">${esc(o.l)}</option>`).join('');
    });
    const r = await done;
    if (r?.file) { picked.clear(); drawList(); drawSum(); }
  }
  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.code) { if (t.checked) picked.set(t.dataset.code, 1); else picked.delete(t.dataset.code); drawList(); drawSum(); }
    else if (t.dataset.count) { picked.set(t.dataset.count, Math.max(1, Math.min(99, Number(t.value) || 1))); drawSum(); }
  });
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.id === 'fi-clear') { picked.clear(); drawList(); drawSum(); }
      else if (b.id === 'fi-copy') {
        const t = totals();
        const text = [...picked].map(([id, n]) => { const c = codes.find((x) => x.id === id); return `${n}× ${c.code} ${c.title}`; }).join('\n') + `\nSumme: ${eur(t.fine)}${t.jail ? `, ${jailText(t.jail)}` : ''}${t.points ? `, ${t.points} Punkte` : ''}`;
        await navigator.clipboard.writeText(text);
        toast('Kopiert');
      } else if (b.id === 'fi-file') await toFile();
    } catch (error) { toast(error.message, true); }
  });
  $('#fi-q', view).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); drawList(); });
  $('#fi-area', view).addEventListener('change', async (e) => { area = e.target.value; try { localStorage.setItem('fines.area', area); } catch { /* egal */ } await load(); });
  await load();
}
