import { api } from '../api.js';
import { $, esc, empty, fdatetime, tag, openForm, confirmBox, toast } from '../ui.js';
import { writableTeams, visibilityField, scopeTag } from './common.js';
import { markdownBlock, MARKDOWN_HELP } from '../markdown.js';

const noteForm = (note, teams) => openForm({
  title: note ? 'Notiz bearbeiten' : 'Neue Notiz',
  wide: true,
  fields: [
    { name: 'title', label: 'Titel', value: note?.title, maxlength: 150, full: true },
    { name: 'body', label: 'Text', type: 'textarea', value: note?.body, rows: 12, maxlength: 50000, full: true, help: MARKDOWN_HELP },
    visibilityField(teams, note),
  ],
  onSubmit: async (values) => {
    const body = { title: values.title.trim(), body: values.body, team_id: values.team_id || null };
    if (note) await api.patch(`/notes/${note.id}`, body);
    else await api.post('/notes', body);
    toast('Notiz gespeichert');
  },
});

export async function render(view) {
  let notes = [];
  let scope = 'all';
  let query = '';
  const teams = await writableTeams('notes');
  view.innerHTML = `<div class="page-head"><div><h1>Notizblock</h1><p>Eigene Notizen und gemeinsame Notizen einer Organisation</p></div>
    <div class="actions"><div class="seg" id="n-scope"><button data-s="all" class="on">Alle</button><button data-s="solo">Solo</button><button data-s="team">Organisation</button></div>
    <button class="btn" id="n-new">Neue Notiz</button></div></div>
    <div class="toolbar"><input id="n-search" type="search" class="search" placeholder="Notizen durchsuchen…" aria-label="Notizen durchsuchen"></div>
    <div id="n-list"></div>`;

  function draw() {
    const shown = notes.filter((note) => {
      if (scope !== 'all' && Boolean(note.team_id) !== (scope === 'team')) return false;
      return !query || `${note.title}\n${note.body}`.toLocaleLowerCase('de').includes(query);
    });
    $('#n-list').innerHTML = shown.length ? `<div class="grid cols-3">${shown.map((note) => `<div class="card stack memo">
      <div class="row"><b class="memo-title">${esc(note.title || 'Ohne Titel')}</b>${note.pinned ? tag('warn', 'Angeheftet') : ''}${scopeTag(note)}</div>
      ${markdownBlock(note.body, 'memo-body')}
      <small class="muted">Geändert ${fdatetime(note.updated_at)}${note.updated_by_name ? ` von ${esc(note.updated_by_name)}` : ''}</small>
      ${note.level < 3 ? '' : `<div class="row start"><button class="btn ghost sm" data-edit="${note.id}">Bearbeiten</button><button class="btn ghost sm" data-pin="${note.id}">${note.pinned ? 'Lösen' : 'Anheften'}</button><button class="btn ghost sm" data-del="${note.id}">Löschen</button></div>`}
    </div>`).join('')}</div>` : `<div class="card">${empty(notes.length ? 'Keine passende Notiz gefunden.' : 'Noch keine Notizen vorhanden.')}</div>`;
  }
  async function load() {
    notes = await api.get('/notes');
    draw();
  }

  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const note = (key) => notes.find((item) => item.id === target.dataset[key]);
    try {
      if (target.dataset.s) {
        scope = target.dataset.s;
        view.querySelectorAll('#n-scope button').forEach((button) => button.classList.toggle('on', button === target));
        draw();
      } else if (target.id === 'n-new') {
        if (await noteForm(null, teams)) await load();
      } else if (target.dataset.edit) {
        if (await noteForm(note('edit'), teams)) await load();
      } else if (target.dataset.pin) {
        await api.patch(`/notes/${target.dataset.pin}`, { pinned: !note('pin').pinned });
        await load();
      } else if (target.dataset.del && await confirmBox('Notiz löschen', 'Diese Notiz wird endgültig gelöscht.')) {
        await api.del(`/notes/${target.dataset.del}`);
        await load();
      }
    } catch (error) {
      toast(error.message, true);
    }
  });
  $('#n-search', view).addEventListener('input', (event) => {
    query = event.target.value.trim().toLocaleLowerCase('de');
    draw();
  });
  await load();
}
