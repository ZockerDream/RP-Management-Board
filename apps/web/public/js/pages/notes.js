import { api } from '../api.js';
import { $, esc, empty, fdatetime, tag, openForm, toast, confirmBox } from '../ui.js';
import { writableTeams, visibilityField, scopeTag, noteTagHtml } from './common.js';
import { markdownBlock } from '../markdown.js';

// Tags legt das Server-Management an; ohne Tags gibt es weder Feld noch Knopf noch Filter
const tagField = (tags, selected) => (tags.length
  ? [{ name: 'tag_ids', label: 'Tags', type: 'multi', full: true, options: tags.map((t) => ({ v: t.id, l: t.name })), value: selected || [] }]
  : []);

const noteForm = (note, teams, tags) => openForm({
  title: note ? 'Notiz bearbeiten' : 'Neue Notiz',
  wide: true,
  fields: [
    { name: 'title', label: 'Titel', value: note?.title, maxlength: 150, full: true },
    { name: 'body', label: 'Text', type: 'textarea', value: note?.body, rows: 12, maxlength: 50000, full: true, markdown: true },
    visibilityField(teams, note),
    ...tagField(tags, note?.tag_ids),
  ],
  onSubmit: async (values) => {
    const body = { title: values.title.trim(), body: values.body, team_id: values.team_id || null };
    if (tags.length) body.tag_ids = values.tag_ids;
    if (note) await api.patch(`/notes/${note.id}`, body);
    else await api.post('/notes', body);
    toast('Notiz gespeichert');
  },
});

const tagsForm = (note, tags) => openForm({
  title: 'Tags der Notiz',
  fields: tagField(tags, note.tag_ids),
  onSubmit: async (values) => {
    await api.patch(`/notes/${note.id}`, { tag_ids: values.tag_ids });
    toast('Tags gespeichert');
  },
});

export async function render(view) {
  let notes = [];
  let scope = 'all';
  let state = 'open';
  let query = '';
  let tagFilter = '';
  const [teams, tags] = await Promise.all([writableTeams('notes'), api.get('/note-tags')]);
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const tagsOf = (note) => (note.tag_ids || []).map((id) => tagById.get(id)).filter(Boolean);
  view.innerHTML = `<div class="page-head"><div><h1>Notizblock</h1><p>Eigene Notizen und gemeinsame Notizen einer Organisation</p></div>
    <div class="actions"><div class="seg" id="n-state"><button data-state="open" class="on">Offen</button><button data-state="archived">Archiv</button><button data-state="all">Alle</button></div>
    <div class="seg" id="n-scope"><button data-s="all" class="on">Alle</button><button data-s="solo">Solo</button><button data-s="team">Organisation</button></div>
    <button class="btn" id="n-new">Neue Notiz</button></div></div>
    <div class="toolbar"><input id="n-search" type="search" class="search" placeholder="Notizen durchsuchen…" aria-label="Notizen durchsuchen">
    ${tags.length ? `<select id="n-tag" aria-label="Nach Tag filtern" style="max-width:200px"><option value="">Alle Tags</option><option value="none">Ohne Tag</option>${tags.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>` : ''}</div>
    <div id="n-list"></div>`;

  function draw() {
    const inState = notes.filter((note) => state === 'all' || Boolean(note.archived_at) === (state === 'archived'));
    const shown = inState.filter((note) => {
      if (scope !== 'all' && Boolean(note.team_id) !== (scope === 'team')) return false;
      const own = tagsOf(note);
      if (tagFilter === 'none' ? own.length : tagFilter && !own.some((t) => t.id === tagFilter)) return false;
      return !query || `${note.title}\n${note.body}\n${own.map((t) => t.name).join(' ')}`.toLocaleLowerCase('de').includes(query);
    });
    $('#n-list').innerHTML = shown.length ? `<div class="grid cols-3">${shown.map((note) => {
      const own = tagsOf(note);
      return `<div class="card stack memo">
      <div class="row"><b class="memo-title">${esc(note.title || 'Ohne Titel')}</b>${note.pinned ? tag('warn', 'Angeheftet') : ''}${note.archived_at ? tag('', 'Archiviert') : ''}${scopeTag(note)}</div>
      ${own.length ? `<div class="row wrap memo-tags">${own.map(noteTagHtml).join('')}</div>` : ''}
      ${markdownBlock(note.body, 'memo-body')}
      <small class="muted">Geändert ${fdatetime(note.updated_at)}${note.updated_by_name ? ` von ${esc(note.updated_by_name)}` : ''}${note.archived_at ? `<br>Archiviert ${fdatetime(note.archived_at)}${note.archived_by_name ? ` von ${esc(note.archived_by_name)}` : ''}` : ''}</small>
      ${note.level < 3 ? '' : `<div class="row wrap"><button class="btn ghost sm" data-edit="${note.id}">Bearbeiten</button>${tags.length ? `<button class="btn ghost sm" data-tags="${note.id}">Tags</button>` : ''}${note.archived_at ? '' : `<button class="btn ghost sm" data-pin="${note.id}">${note.pinned ? 'Lösen' : 'Anheften'}</button>`}<button class="btn ghost sm" data-archive="${note.id}">${note.archived_at ? 'Wiederherstellen' : 'Archivieren'}</button><button class="btn ghost sm" data-del="${note.id}">Löschen</button></div>`}
    </div>`;
    }).join('')}</div>` : `<div class="card">${empty(inState.length ? 'Keine passende Notiz gefunden.'
      : !notes.length ? 'Noch keine Notizen vorhanden.'
        : state === 'archived' ? 'Noch keine archivierten Notizen.' : 'Keine offenen Notizen, alle sind archiviert.')}</div>`;
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
      if (target.dataset.state) {
        state = target.dataset.state;
        view.querySelectorAll('#n-state button').forEach((button) => button.classList.toggle('on', button === target));
        draw();
      } else if (target.dataset.s) {
        scope = target.dataset.s;
        view.querySelectorAll('#n-scope button').forEach((button) => button.classList.toggle('on', button === target));
        draw();
      } else if (target.id === 'n-new') {
        if (await noteForm(null, teams, tags)) await load();
      } else if (target.dataset.edit) {
        if (await noteForm(note('edit'), teams, tags)) await load();
      } else if (target.dataset.tags) {
        if (await tagsForm(note('tags'), tags)) await load();
      } else if (target.dataset.archive) {
        const archived = !note('archive').archived_at;
        await api.patch(`/notes/${target.dataset.archive}`, { archived });
        toast(archived ? 'Notiz archiviert' : 'Notiz wiederhergestellt');
        await load();
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
  $('#n-tag', view)?.addEventListener('change', (event) => {
    tagFilter = event.target.value;
    draw();
  });
  await load();
}
