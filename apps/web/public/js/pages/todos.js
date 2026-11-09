import { api } from '../api.js';
import { $, esc, empty, fdate, fdatetime, tag, todayStr, openForm, confirmBox, toast } from '../ui.js';
import { writableTeams, visibilityField, scopeTag } from './common.js';
import { markdownBlock, MARKDOWN_HELP } from '../markdown.js';

const dueOf = (todo) => (todo?.due_date ? String(todo.due_date).slice(0, 10) : '');
const tomorrowStr = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString('sv-SE');
};

function deadlineTag(todo, today) {
  const due = dueOf(todo);
  if (!due) return '';
  if (todo.done_at) return tag('', fdate(due));
  if (due < today) return tag('bad', `Überfällig · ${fdate(due)}`);
  if (due === today) return tag('warn', 'Heute fällig');
  if (due === tomorrowStr()) return tag('warn', 'Morgen fällig');
  return tag('', fdate(due));
}

const todoForm = (todo, teams) => openForm({
  title: todo ? 'ToDo bearbeiten' : 'Neues ToDo',
  fields: [
    { name: 'title', label: 'Aufgabe', value: todo?.title, required: true, maxlength: 200, full: true },
    { name: 'due_date', label: 'Deadline (optional)', type: 'date', value: dueOf(todo), help: 'Erinnerung einen Tag vorher, am Fälligkeitstag und wenn es überfällig ist.' },
    visibilityField(teams, todo),
    { name: 'note', label: 'Notiz', type: 'textarea', value: todo?.note, rows: 4, maxlength: 5000, full: true, help: MARKDOWN_HELP },
  ],
  onSubmit: async (values) => {
    const body = { title: values.title.trim(), note: values.note, due_date: values.due_date || null, team_id: values.team_id || null };
    if (!body.title) throw new Error('Bitte eine Aufgabe eingeben');
    if (todo) await api.patch(`/todos/${todo.id}`, body);
    else await api.post('/todos', body);
    toast('ToDo gespeichert');
  },
});

export async function render(view) {
  let todos = [];
  let status = 'open';
  let scope = 'all';
  const teams = await writableTeams('todos');
  view.innerHTML = `<div class="page-head"><div><h1>ToDos</h1><p>Aufgaben für dich oder deine Organisation, auf Wunsch mit Deadline</p></div>
    <div class="actions"><div class="seg" id="t-status"><button data-status="open" class="on">Offen</button><button data-status="done">Erledigt</button><button data-status="all">Alle</button></div>
    <div class="seg" id="t-scope"><button data-s="all" class="on">Alle</button><button data-s="solo">Solo</button><button data-s="team">Organisation</button></div>
    <button class="btn" id="t-new">Neues ToDo</button></div></div><div id="t-list"></div>`;

  const row = (todo, today) => {
    const done = Boolean(todo.done_at);
    const readOnly = todo.level < 3;
    return `<div class="list-item todo-row">
      <input type="checkbox" data-done="${todo.id}" aria-label="${esc(todo.title)} erledigt" ${done ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
      <div class="grow"><b class="${done ? 'todo-done' : ''}">${esc(todo.title)}</b>
        ${todo.note ? markdownBlock(todo.note, 'small text-block') : ''}
        ${done ? `<small>Erledigt ${fdatetime(todo.done_at)}${todo.done_by_name ? ` von ${esc(todo.done_by_name)}` : ''}</small>` : ''}</div>
      ${deadlineTag(todo, today)}${scopeTag(todo)}
      ${readOnly ? '' : `<div class="row start"><button class="btn ghost sm" data-edit="${todo.id}">Bearbeiten</button><button class="btn ghost sm" data-del="${todo.id}">Löschen</button></div>`}
    </div>`;
  };

  function draw() {
    const today = todayStr();
    const shown = todos.filter((todo) => scope === 'all' || Boolean(todo.team_id) === (scope === 'team'));
    const open = shown.filter((todo) => !todo.done_at);
    const groups = [
      ...(status === 'done' ? [] : [
        ['Überfällig', open.filter((todo) => dueOf(todo) && dueOf(todo) < today)],
        ['Heute', open.filter((todo) => dueOf(todo) === today)],
        ['Demnächst', open.filter((todo) => dueOf(todo) > today)],
        ['Ohne Deadline', open.filter((todo) => !dueOf(todo))],
      ]),
      ...(status === 'open' ? [] : [['Erledigt', shown.filter((todo) => todo.done_at)]]),
    ].filter(([, items]) => items.length);
    $('#t-list').innerHTML = `<div class="card">${groups.length
      ? groups.map(([title, items]) => `<section class="todo-group"><h3>${title} (${items.length})</h3>${items.map((todo) => row(todo, today)).join('')}</section>`).join('')
      : empty(status === 'done' ? 'Noch nichts erledigt.' : 'Keine offenen ToDos.')}</div>`;
  }
  async function load() {
    todos = await api.get('/todos');
    draw();
  }

  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.dataset.status) {
        status = target.dataset.status;
        view.querySelectorAll('#t-status button').forEach((button) => button.classList.toggle('on', button === target));
        draw();
      } else if (target.dataset.s) {
        scope = target.dataset.s;
        view.querySelectorAll('#t-scope button').forEach((button) => button.classList.toggle('on', button === target));
        draw();
      } else if (target.id === 't-new') {
        if (await todoForm(null, teams)) await load();
      } else if (target.dataset.edit) {
        if (await todoForm(todos.find((todo) => todo.id === target.dataset.edit), teams)) await load();
      } else if (target.dataset.del && await confirmBox('ToDo löschen', 'Dieses ToDo wird endgültig gelöscht.')) {
        await api.del(`/todos/${target.dataset.del}`);
        await load();
      }
    } catch (error) {
      toast(error.message, true);
    }
  });
  view.addEventListener('change', async (event) => {
    const box = event.target.closest('[data-done]');
    if (!box) return;
    try {
      await api.patch(`/todos/${box.dataset.done}`, { done: box.checked });
    } catch (error) {
      toast(error.message, true);
    }
    await load().catch((error) => toast(error.message, true));
  });
  await load();
}
