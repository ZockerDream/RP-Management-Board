// Fahndungsliste mit Schnellabfrage, Strafkatalog (mit CSV) und Berichtsvorlagen eines Bereichs
import { api } from '../api.js';
import { $, esc, eur, tag, openForm, confirmBox, toast, empty, debounce } from '../ui.js';
import { can } from '../app.js';
import { markdownBlock } from '../markdown.js';
import * as P from './case-parts.js';

const areaSelect = (ctx, id) => (ctx.areas.length > 1
  ? `<select id="${id}" aria-label="Bereich">${ctx.areas.map((a) => `<option value="${a.id}" ${a.id === ctx.area ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : '');
const areaName = (ctx) => ctx.areas.find((a) => a.id === ctx.area)?.name || 'Privat';
const areaLevel = (ctx) => ctx.areas.find((a) => a.id === ctx.area)?.level ?? 0;
const sameArea = (ctx, row) => (ctx.area ? row.team_id === ctx.area : !row.team_id);
const wanted = { q: '', status: 'active' };

// ---------- Fahndung
export async function drawWanted(el, ctx) {
  const list = await api.get(`/warrants?${new URLSearchParams({ status: wanted.status, ...(wanted.q ? { q: wanted.q } : {}) })}`);
  el.innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="wa-q" type="search" class="search" placeholder="Abfrage: Name, Alias oder Kennzeichen…" aria-label="Fahndungen abfragen" value="${esc(wanted.q)}">
      <select id="wa-status" aria-label="Status"><option value="active" ${wanted.status === 'active' ? 'selected' : ''}>Aktive Fahndungen</option><option value="all" ${wanted.status === 'all' ? 'selected' : ''}>Alle, auch erledigte</option></select></div>
    <div class="card"><div class="card-head"><h2>Fahndungsliste</h2>${tag(list.some((x) => x.status === 'active') ? 'bad' : '', String(list.length))}</div>
      <p class="muted">Haftbefehle, Durchsuchungsbeschlüsse und Fahndungen aus allen Akten, die du sehen darfst. Ausgeschrieben wird in der jeweiligen Akte unter „Fahndungen“.</p>
      ${list.length ? list.map((x) => P.warrantItem(x, { w: x.level >= 3 && can('casefile:update'), m: false, file: true })).join('') : empty(wanted.q ? `Nichts zu „${wanted.q}“ – keine Fahndung.` : 'Keine Fahndungen.')}</div>`;
  $('#wa-q', el).addEventListener('input', debounce(async (e) => { wanted.q = e.target.value.trim(); await drawWanted(el, ctx); const q = $('#wa-q', el); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }));
  $('#wa-status', el).addEventListener('change', (e) => { wanted.status = e.target.value; drawWanted(el, ctx); });
  el.onclick = async (event) => {
    const b = event.target.closest('button[data-wa-close]');
    if (!b) return;
    try { if (await P.warrantCloseForm(list.find((x) => x.id === b.dataset.waClose), b.dataset.status)) await drawWanted(el, ctx); } catch (error) { toast(error.message, true); }
  };
}

// ---------- Strafkatalog
const codeForm = (ctx, code) => openForm({
  title: code ? `${code.code} bearbeiten` : `Tatbestand · ${areaName(ctx)}`,
  wide: true,
  fields: [
    { name: 'code', label: 'Paragraph', value: code?.code, required: true, maxlength: 40, placeholder: 'z. B. § 242 StGB' },
    { name: 'title', label: 'Bezeichnung', value: code?.title, required: true, maxlength: 200, placeholder: 'z. B. Diebstahl' },
    { name: 'category', label: 'Kategorie', value: code?.category, maxlength: 60, suggestions: ['Ordnungswidrigkeit', 'Vergehen', 'Verbrechen', 'Verkehr', 'Betäubungsmittel', 'Waffen'] },
    { name: 'fine', label: 'Geldstrafe', value: code ? String(code.fine).replace('.', ',') : '0', required: true },
    { name: 'jail', label: 'Haft in Hafteinheiten (HE)', type: 'number', min: 0, value: code?.jail ?? 0 },
    { name: 'points', label: 'Punkte (Führerschein)', type: 'number', min: 0, max: 100, value: code?.points ?? 0 },
    { name: 'active', label: 'Aktiv (in der Auswahl)', type: 'checkbox', value: code ? code.active : true },
    { name: 'description', label: 'Beschreibung', type: 'textarea', rows: 3, value: code?.description, maxlength: 2000, full: true },
  ],
  onSubmit: async (v) => {
    const body = { code: v.code.trim(), title: v.title.trim(), category: v.category.trim(), fine: v.fine.trim() || '0', jail: Number(v.jail) || 0, points: Number(v.points) || 0, active: v.active, description: v.description };
    if (code) await api.patch(`/penal-codes/${code.id}`, body);
    else await api.post('/penal-codes', { ...body, team_id: ctx.area || null });
  },
});

async function codeImport(ctx) {
  let checked = null;
  const done = openForm({
    title: `Strafkatalog importieren · ${areaName(ctx)}`,
    wide: true,
    submit: 'Prüfen',
    fields: [
      { type: 'html', html: '<p class="muted">CSV mit Kopfzeile: <b>Paragraph</b> und <b>Bezeichnung</b> (Pflicht), dazu Kategorie, Geldstrafe, Haft, Punkte, Beschreibung. Beträge wie in Excel (1.500,00). Vorhandene Paragraphen werden aktualisiert, neue angelegt. Anklagepunkte in Akten behalten ihren Stand.</p>' },
      { name: 'file', label: 'CSV-Datei', type: 'file', accept: '.csv,.txt,text/csv', required: true, full: true },
      { type: 'html', html: '<div id="pc-result"></div>' },
    ],
    onSubmit: async (_v, modal) => {
      const file = $('#f-file', modal).files[0];
      if (!file) throw new Error('Wähle eine CSV-Datei aus');
      const bytes = await file.arrayBuffer();
      let csv;
      try { csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { csv = new TextDecoder('windows-1252').decode(bytes); }
      if (csv !== checked) {
        const r = await api.post('/penal-codes/import', { team_id: ctx.area || null, csv, preview: true });
        $('#pc-result', modal).innerHTML = `<div class="note info">Prüfung: ${r.created} neu · ${r.updated} aktualisiert${r.errors ? ` · ${r.errors} fehlerhaft (werden übersprungen)` : ''}</div>
          ${r.problems.map((x) => `<small class="muted">Zeile ${x.line}${x.code ? ` ${esc(x.code)}` : ''}: ${esc(x.message)}</small><br>`).join('')}`;
        checked = r.created || r.updated ? csv : null;
        $('button[type=submit]', modal).textContent = checked ? 'Importieren' : 'Prüfen';
        return false;
      }
      const r = await api.post('/penal-codes/import', { team_id: ctx.area || null, csv });
      toast(`Strafkatalog: ${r.created} neu, ${r.updated} aktualisiert`);
      return true;
    },
  });
  const modal = $('#modals .modal:last-child');
  $('#f-file', modal)?.addEventListener('change', () => { checked = null; $('button[type=submit]', modal).textContent = 'Prüfen'; $('#pc-result', modal).innerHTML = ''; });
  return done;
}

// Export im Browser aus der geladenen Liste; gleiche Spalten wie der Import
function codeExport(ctx, list) {
  const cell = (v) => { const s = String(v ?? ''); const g = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[";\n\r]/.test(g) ? `"${g.replace(/"/g, '""')}"` : g; };
  const rows = [['Paragraph', 'Bezeichnung', 'Kategorie', 'Geldstrafe', 'Haft', 'Punkte', 'Beschreibung'], ...list.map((c) => [c.code, c.title, c.category, String(c.fine).replace('.', ','), c.jail, c.points, c.description])];
  const blob = new Blob([`﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `strafkatalog-${areaName(ctx).toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-')}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function drawCodes(el, ctx) {
  const list = (await api.get(`/penal-codes${ctx.area ? `?team_id=${ctx.area}` : '?private=1'}`)).filter((c) => sameArea(ctx, c));
  const manage = areaLevel(ctx) >= 4 && can('casefile:create');
  const categories = [...new Set(list.map((c) => c.category || 'Ohne Kategorie'))];
  el.innerHTML = `<div class="toolbar" style="gap:8px">${areaSelect(ctx, 'pc-area')}</div>
    <div class="card"><div class="card-head"><h2>Strafkatalog · ${esc(areaName(ctx))}</h2><div class="row wrap">
      ${list.length ? '<button class="btn ghost sm" id="pc-export">CSV-Export</button>' : ''}${manage ? '<button class="btn ghost sm" id="pc-import">CSV-Import</button><button class="btn ghost sm" id="pc-new">Tatbestand</button>' : ''}</div></div>
      <p class="muted">Aus dem Katalog wählst du in einer Akte die Anklagepunkte; Geldstrafe, Haft (in Hafteinheiten, HE) und Punkte werden dabei übernommen und lassen sich im Einzelfall anpassen.</p>
      ${list.length ? categories.map((cat) => `<h3>${esc(cat)}</h3><div class="scroll-x"><table class="table"><thead><tr><th>Paragraph</th><th>Bezeichnung</th><th>Geldstrafe</th><th>Haft</th><th>Punkte</th><th></th></tr></thead><tbody>
        ${list.filter((c) => (c.category || 'Ohne Kategorie') === cat).map((c) => `<tr><td><b>${esc(c.code)}</b>${c.active ? '' : ` ${tag('', 'inaktiv')}`}</td><td>${esc(c.title)}${c.description ? `<br><small class="muted">${esc(c.description)}</small>` : ''}</td>
          <td>${eur(c.fine)}</td><td>${P.jailText(c.jail)}</td><td>${c.points || '–'}</td>
          <td style="white-space:nowrap">${manage ? `<button class="btn ghost sm" data-pc-edit="${c.id}">Bearbeiten</button> <button class="btn ghost sm" data-pc-del="${c.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`).join('')
      : empty(manage ? 'Noch kein Strafkatalog. Lege Tatbestände an oder importiere eine CSV-Datei.' : 'Noch kein Strafkatalog.')}</div>`;
  $('#pc-area', el)?.addEventListener('change', (e) => { ctx.area = e.target.value; drawCodes(el, ctx); });
  el.onclick = async (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    try {
      let changed = false;
      if (b.id === 'pc-new') changed = await codeForm(ctx);
      else if (b.id === 'pc-import') changed = await codeImport(ctx);
      else if (b.id === 'pc-export') codeExport(ctx, list);
      else if (b.dataset.pcEdit) changed = await codeForm(ctx, list.find((c) => c.id === b.dataset.pcEdit));
      else if (b.dataset.pcDel) {
        const code = list.find((c) => c.id === b.dataset.pcDel);
        if (await confirmBox('Tatbestand löschen', `${code.code} verschwindet aus dem Katalog.${code.used ? ` ${code.used} Anklagepunkte behalten ihren Stand.` : ''} Besser: deaktivieren.`)) { await api.del(`/penal-codes/${code.id}`); changed = true; }
      }
      if (changed) await drawCodes(el, ctx);
    } catch (error) { toast(error.message, true); }
  };
}

// ---------- Berichtsvorlagen
const templateForm = (ctx, t) => openForm({
  title: t ? `Vorlage „${t.name}“` : `Neue Vorlage · ${areaName(ctx)}`,
  wide: true,
  fields: [
    { name: 'name', label: 'Name (wird zur Berichtsart)', value: t?.name, required: true, maxlength: 100, placeholder: 'z. B. Einsatzbericht' },
    { name: 'sort', label: 'Reihenfolge', type: 'number', min: -1000, value: t?.sort ?? 0 },
    { name: 'body', label: 'Vorlagentext', type: 'textarea', rows: 14, value: t?.body, maxlength: 20000, full: true, markdown: true, help: 'Überschriften, Listen, Tabellen und Aufgaben (- [ ]) helfen beim Ausfüllen.' },
  ],
  onSubmit: async (v) => {
    const body = { name: v.name.trim(), sort: Number(v.sort) || 0, body: v.body };
    if (t) await api.patch(`/report-templates/${t.id}`, body);
    else await api.post('/report-templates', { ...body, team_id: ctx.area || null });
  },
});

export async function drawTemplates(el, ctx) {
  const list = (await api.get('/report-templates')).filter((t) => sameArea(ctx, t));
  const manage = areaLevel(ctx) >= 4 && can('casefile:create');
  el.innerHTML = `<div class="toolbar" style="gap:8px">${areaSelect(ctx, 'rt-area')}</div>
    <div class="card"><div class="card-head"><h2>Berichtsvorlagen · ${esc(areaName(ctx))}</h2>${manage ? '<button class="btn ghost sm" id="rt-new">Neue Vorlage</button>' : ''}</div>
      ${manage ? `<div class="row wrap"><span class="muted">Fertige Vorlagen übernehmen:</span><button class="btn ghost sm" data-rt-set="police">Polizei</button><button class="btn ghost sm" data-rt-set="medic">Rettungsdienst</button><button class="btn ghost sm" data-rt-set="general">Allgemein</button></div>` : ''}
      ${list.length ? list.map((t) => `<div class="case-report"><div class="row wrap"><b>${esc(t.name)}</b><span class="grow"></span>${manage ? `<button class="btn ghost sm" data-rt-edit="${t.id}">Bearbeiten</button><button class="btn ghost sm" data-rt-del="${t.id}">Löschen</button>` : ''}</div>
        <details><summary>Vorschau</summary>${t.body.trim() ? markdownBlock(t.body) : '<p class="muted">Leer.</p>'}</details></div>`).join('')
      : empty('Noch keine Vorlagen. Ein neuer Bericht kann eine Vorlage übernehmen: Art, Titel und vorgegebene Abschnitte.')}</div>`;
  $('#rt-area', el)?.addEventListener('change', (e) => { ctx.area = e.target.value; drawTemplates(el, ctx); });
  el.onclick = async (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    try {
      let changed = false;
      if (b.id === 'rt-new') changed = await templateForm(ctx);
      else if (b.dataset.rtSet) { const r = await api.post('/report-templates/defaults', { team_id: ctx.area || null, set: b.dataset.rtSet }); toast(r.created ? `${r.created} Vorlagen übernommen` : 'Diese Vorlagen gibt es hier schon'); changed = true; }
      else if (b.dataset.rtEdit) changed = await templateForm(ctx, list.find((t) => t.id === b.dataset.rtEdit));
      else if (b.dataset.rtDel && await confirmBox('Vorlage löschen', 'Die Vorlage wird gelöscht; Berichte, die sie genutzt haben, bleiben unverändert.')) { await api.del(`/report-templates/${b.dataset.rtDel}`); changed = true; }
      if (changed) await drawTemplates(el, ctx);
    } catch (error) { toast(error.message, true); }
  };
}
