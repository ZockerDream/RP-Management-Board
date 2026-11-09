import { api } from '../api.js';
import { $, esc, empty, fdatetime, tag, openForm, confirmBox, toast, debounce } from '../ui.js';
import { can } from '../app.js';
import { renderMarkdown } from '../markdown.js';
import { writableTeams, visibilityField, scopeTag } from './common.js';

const FORMAT_HELP = 'Formatierung: # Überschrift, **fett**, *kursiv*, - Liste, 1. nummerierte Liste, > Zitat, --- Trennlinie, [Text](https://…)';
const scopeName = (category) => (category.team_id ? category.team_name : 'Solo');

const categoryForm = (category, teams) => openForm({
  title: category ? 'Kategorie bearbeiten' : 'Neue Kategorie',
  fields: [
    { name: 'name', label: 'Name', value: category?.name, required: true, maxlength: 100, placeholder: 'z. B. Gesetze, Funktionen', full: true },
    { name: 'sort', label: 'Reihenfolge', type: 'number', min: -1000, step: 1, value: category?.sort ?? 0, help: 'Kleinere Zahlen stehen weiter oben.' },
    ...(category ? [] : [visibilityField(teams, null)]),
  ],
  onSubmit: async (values) => {
    const body = { name: values.name.trim(), sort: Number(values.sort) || 0 };
    if (category) await api.patch(`/doc-categories/${category.id}`, body);
    else await api.post('/doc-categories', { ...body, team_id: values.team_id || null });
    toast('Kategorie gespeichert');
  },
});

function pageForm(page, categories, preset) {
  // Neue Seiten in jede beschreibbare Kategorie; vorhandene nur innerhalb ihres Bereichs verschieben
  const writable = categories.filter((c) => c.level >= 3);
  const choices = page ? writable.filter((c) => (c.team_id || null) === (page.team_id || null)) : writable;
  if (!choices.length) { toast('Lege zuerst eine Kategorie an, in die du schreiben darfst', true); return Promise.resolve(false); }
  return openForm({
    title: page ? 'Seite bearbeiten' : 'Neue Seite',
    wide: true,
    fields: [
      { name: 'title', label: 'Titel', value: page?.title, required: true, maxlength: 200, full: true },
      { name: 'category_id', label: 'Kategorie', type: 'select', options: choices.map((c) => ({ v: c.id, l: `${c.name} · ${scopeName(c)}` })), value: page?.category_id || preset || choices[0].id },
      { name: 'pinned', label: 'Oben anheften', type: 'checkbox', value: page?.pinned },
      { name: 'body', label: 'Text', type: 'textarea', rows: 18, maxlength: 200000, value: page?.body, full: true, help: FORMAT_HELP },
    ],
    onSubmit: async (values) => {
      const body = { title: values.title.trim(), category_id: values.category_id, pinned: values.pinned, body: values.body };
      const result = page ? await api.patch(`/doc-pages/${page.id}`, body) : await api.post('/doc-pages', body);
      toast('Seite gespeichert');
      return page?.id || result.id;
    },
  });
}

export async function render(view, params) {
  let categories = [];
  let pages = [];
  let current = null;
  let selected = '';
  let query = '';
  // Kategorien anlegen braucht „Verwalten“ bei Dokumentationen; Rechte gelten auch pro Kategorie
  const teams = can('team:read') ? await writableTeams('doc', 4) : [];
  view.innerHTML = `<div class="page-head"><div><h1>Dokumentationen</h1><p>Gesetze, Funktionen und weitere Nachschlagewerke, solo oder in einer Organisation</p></div>
    <div class="actions">${can('doc:create') ? '<button class="btn ghost" id="d-cat-new">Neue Kategorie</button><button class="btn" id="d-new">Neue Seite</button>' : ''}</div></div>
    <div class="toolbar"><input id="d-search" type="search" class="search" placeholder="Alle Seiten durchsuchen…" aria-label="Dokumentationen durchsuchen"></div>
    <div class="docs-layout"><div class="card" id="d-cats"></div><div class="stack" id="d-main"></div></div>`;

  function drawCategories() {
    const groups = new Map();
    for (const c of categories) groups.set(scopeName(c), [...(groups.get(scopeName(c)) || []), c]);
    $('#d-cats').innerHTML = `<div class="card-head"><h2>Kategorien</h2></div>
      <button class="list-item doc-cat ${!selected ? 'on' : ''}" data-cat=""><span class="grow">Alle Seiten</span></button>
      ${[...groups].map(([scope, list]) => `<small class="muted doc-scope">${esc(scope)}</small>${list.map((c) => `<div class="doc-cat-row">
        <button class="list-item doc-cat ${selected === c.id ? 'on' : ''}" data-cat="${c.id}"><span class="grow">${esc(c.name)}</span><small class="muted">${c.pages}</small></button>
        ${c.level >= 4 && can('doc:update') ? `<button class="btn ghost sm" data-cat-edit="${c.id}" aria-label="Kategorie ${esc(c.name)} bearbeiten">Bearbeiten</button>` : ''}
        ${c.level >= 4 && can('doc:delete') && !c.pages ? `<button class="btn ghost sm" data-cat-del="${c.id}" aria-label="Kategorie ${esc(c.name)} löschen">Löschen</button>` : ''}</div>`).join('')}`).join('')}
      ${categories.length ? '' : empty('Noch keine Kategorien. Lege zum Beispiel „Gesetze“ oder „Funktionen“ an.')}`;
  }
  function drawList() {
    const title = query ? `Suche: „${esc(query)}“` : selected ? esc(categories.find((c) => c.id === selected)?.name || '') : 'Alle Seiten';
    $('#d-main').innerHTML = `<div class="card"><div class="card-head"><h2>${title}</h2><small class="muted">${pages.length} Seite(n)</small></div>
      ${pages.length ? pages.map((p) => `<button class="list-item doc-page-link" data-page="${p.id}"><div class="grow"><b>${esc(p.title)}</b>
        <small>${esc(p.category_name)} · geändert ${fdatetime(p.updated_at)}${p.updated_by_name ? ` von ${esc(p.updated_by_name)}` : ''}</small>
        ${query ? `<small class="muted">…${esc(p.excerpt)}…</small>` : ''}</div>${p.pinned ? tag('warn', 'Angeheftet') : ''}</button>`).join('') : empty(query ? 'Keine Seite gefunden.' : 'Noch keine Seiten in dieser Ansicht.')}</div>`;
  }
  function drawPage() {
    const p = current;
    const writable = p.level >= 3;
    $('#d-main').innerHTML = `<article class="card doc-article"><div class="card-head"><div><h2>${esc(p.title)}</h2>
        <small class="muted">${esc(p.category_name)} · ${scopeTag({ team_id: p.team_id, team_name: categories.find((c) => c.id === p.category_id)?.team_name })} · geändert ${fdatetime(p.updated_at)}${p.updated_by_name ? ` von ${esc(p.updated_by_name)}` : ''}</small></div>
        <div class="row"><button class="btn ghost sm" id="d-back">Zurück</button>
        ${writable && can('doc:update') ? `<button class="btn ghost sm" id="d-edit">Bearbeiten</button>` : ''}
        ${p.level >= 4 && can('doc:delete') ? `<button class="btn ghost sm" id="d-del">Löschen</button>` : ''}</div></div>
      <div class="doc-body">${p.body.trim() ? renderMarkdown(p.body) : empty('Diese Seite hat noch keinen Text.')}</div></article>`;
  }
  async function loadCategories() {
    categories = await api.get('/doc-categories');
    drawCategories();
  }
  async function loadPages() {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    else if (selected) qs.set('category_id', selected);
    pages = await api.get(`/doc-pages?${qs}`);
    current = null;
    drawList();
  }
  async function openPage(id) {
    current = await api.get(`/doc-pages/${id}`);
    drawPage();
    history.replaceState(null, '', `#/docs?page=${id}`);
  }

  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.dataset.cat !== undefined) {
        selected = target.dataset.cat;
        query = '';
        $('#d-search').value = '';
        drawCategories();
        await loadPages();
        history.replaceState(null, '', '#/docs');
      } else if (target.dataset.page) await openPage(target.dataset.page);
      else if (target.id === 'd-back') { await loadPages(); history.replaceState(null, '', '#/docs'); }
      else if (target.id === 'd-cat-new') { if (await categoryForm(null, teams)) await loadCategories(); }
      else if (target.dataset.catEdit) { if (await categoryForm(categories.find((c) => c.id === target.dataset.catEdit), teams)) await loadCategories(); }
      else if (target.dataset.catDel && await confirmBox('Kategorie löschen', 'Die leere Kategorie wird gelöscht.')) {
        await api.del(`/doc-categories/${target.dataset.catDel}`);
        if (selected === target.dataset.catDel) selected = '';
        await loadCategories();
        await loadPages();
      } else if (target.id === 'd-new') {
        const id = await pageForm(null, categories, selected);
        if (id) { await loadCategories(); await openPage(id); }
      } else if (target.id === 'd-edit') {
        if (await pageForm(current, categories)) { await loadCategories(); await openPage(current.id); }
      } else if (target.id === 'd-del' && await confirmBox('Seite löschen', `„${current.title}“ wird endgültig gelöscht.`)) {
        await api.del(`/doc-pages/${current.id}`);
        await loadCategories();
        await loadPages();
        history.replaceState(null, '', '#/docs');
      }
    } catch (error) {
      toast(error.message, true);
    }
  });
  $('#d-search', view).addEventListener('input', debounce(async (event) => {
    query = event.target.value.trim();
    try { await loadPages(); } catch (error) { toast(error.message, true); }
  }));

  await loadCategories();
  const initial = params?.get('page');
  if (initial) {
    try { await openPage(initial); return; } catch (error) { toast(error.message, true); }
  }
  await loadPages();
}
