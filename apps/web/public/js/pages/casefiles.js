import { api } from '../api.js';
import { $, esc, empty, fdate, fdatetime, tag, openForm, confirmBox, toast, todayStr, debounce } from '../ui.js';
import { can } from '../app.js';
import { writableTeams, visibilityField, scopeTag } from './common.js';

export const CASE_STATUS = { open: ['ok', 'Offen'], dormant: ['warn', 'Ruhend'], closed: ['', 'Abgeschlossen'] };
const KIND_SUGGESTIONS = ['Vermerk', 'Vernehmung', 'Verstoß', 'Beweismittel', 'Auszeichnung', 'Gespräch', 'Entscheidung'];
const statusOptions = Object.entries(CASE_STATUS).map(([v, [, l]]) => ({ v, l }));
const sizeText = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(bytes / 1024)} KB`);

const fileForm = (file, teams) => openForm({
  title: file ? 'Akte bearbeiten' : 'Neue Akte',
  wide: true,
  fields: [
    { name: 'title', label: 'Titel', value: file?.title, required: true, maxlength: 200, full: true },
    { name: 'file_number', label: 'Aktenzeichen', value: file?.file_number, maxlength: 40, help: file ? '' : 'Leer: wird automatisch vergeben, z. B. 2026-0001.' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions, value: file?.status || 'open' },
    { name: 'opened_on', label: 'Eröffnet am', type: 'date', value: file?.opened_on || todayStr(), required: true },
    ...(file ? [{ name: 'closed_on', label: 'Abgeschlossen am', type: 'date', value: file.closed_on || '', help: 'Nur bei Status „Abgeschlossen“; leer heißt heute.' }] : [visibilityField(teams, null)]),
    { name: 'description', label: 'Sachverhalt', type: 'textarea', rows: 8, value: file?.description, maxlength: 20000, full: true },
  ],
  onSubmit: async (values) => {
    const body = { title: values.title.trim(), file_number: values.file_number.trim(), status: values.status, opened_on: values.opened_on, description: values.description };
    if (file) {
      await api.patch(`/case-files/${file.id}`, { ...body, closed_on: values.closed_on || null });
      return file.id;
    }
    const created = await api.post('/case-files', { ...body, team_id: values.team_id || null });
    toast(`Akte ${created.file_number} angelegt`);
    return created.id;
  },
});

const sameScope = (file, person) => (file.team_id ? person.team_id === file.team_id : !person.team_id && person.owner_user_id === file.owner_user_id);

async function personForm(file) {
  const people = (await api.get('/people')).filter((p) => sameScope(file, p) && p.active && !file.people.some((x) => x.person_id === p.id));
  if (!people.length) { toast(file.team_id ? 'Keine weitere aktive Person in diesem Team. Lege sie unter „Personen“ mit Sichtbarkeit Team an.' : 'Keine weitere aktive private Person. Lege sie unter „Personen“ an.', true); return false; }
  return openForm({
    title: 'Person beteiligen',
    fields: [
      { name: 'person_id', label: 'Person', type: 'select', options: people.map((p) => ({ v: p.id, l: p.name })) },
      { name: 'role', label: 'Rolle in der Akte', maxlength: 60, placeholder: 'z. B. Beschuldigter, Zeuge, Geschädigter' },
    ],
    onSubmit: async (values) => api.post(`/case-files/${file.id}/people`, { person_id: values.person_id, role: values.role.trim() }),
  });
}

const entryForm = (file, entry) => openForm({
  title: entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
  wide: true,
  fields: [
    { name: 'entry_date', label: 'Datum', type: 'date', value: entry?.entry_date || todayStr(), required: true },
    { name: 'kind', label: 'Art', value: entry?.kind, maxlength: 60, placeholder: KIND_SUGGESTIONS.slice(0, 3).join(', ') },
    { name: 'person_id', label: 'Betrifft Person', type: 'select', options: [{ v: '', l: '– Keine bestimmte Person –' }, ...file.people.filter((p) => p.name).map((p) => ({ v: p.person_id, l: `${p.name}${p.role ? ` (${p.role})` : ''}` }))], value: entry?.person_id || '' },
    { name: 'body', label: 'Text', type: 'textarea', rows: 10, value: entry?.body, maxlength: 20000, required: true, full: true },
  ],
  onSubmit: async (values) => {
    const body = { entry_date: values.entry_date, kind: values.kind.trim(), person_id: values.person_id || null, body: values.body };
    if (entry) await api.patch(`/case-file-entries/${entry.id}`, body);
    else await api.post(`/case-files/${file.id}/entries`, body);
    toast('Eintrag gespeichert');
  },
});

export async function render(view, params) {
  let files = [];
  let detail = null;
  const filter = { status: '', q: '' };
  const teams = can('team:read') ? await writableTeams() : [];
  view.innerHTML = `<div class="page-head"><div><h1>Akten</h1><p>Vorgänge mit beteiligten Personen, Einträgen und Anhängen</p></div>
    <div class="actions">${can('casefile:create') ? '<button class="btn" id="c-new">Neue Akte</button>' : ''}</div></div>
    <div id="c-main"></div><input type="file" id="c-upload" accept="application/pdf,image/png,image/jpeg" hidden>`;
  const writable = () => detail.role !== 'viewer' && can('casefile:update');

  function drawList() {
    $('#c-main').innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="c-search" type="search" class="search" placeholder="Aktenzeichen, Titel, Person…" aria-label="Akten durchsuchen" value="${esc(filter.q)}">
      <select id="c-status" aria-label="Status"><option value="">Alle Status</option>${statusOptions.map((o) => `<option value="${o.v}" ${filter.status === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select></div>
      <div class="card">${files.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Aktenzeichen</th><th>Titel</th><th>Personen</th><th>Status</th><th>Letzter Eintrag</th><th>Sichtbarkeit</th><th></th></tr></thead><tbody>
      ${files.map((f) => `<tr><td><b>${esc(f.file_number)}</b></td><td>${esc(f.title)}</td><td>${esc(f.people.join(', ') || '–')}</td><td>${tag(...CASE_STATUS[f.status])}</td>
        <td>${f.last_entry ? fdate(f.last_entry) : '–'} <small class="muted">(${f.entries})</small></td><td>${scopeTag(f)}</td><td><button class="btn ghost sm" data-open="${f.id}">Öffnen</button></td></tr>`).join('')}</tbody></table></div>`
      : empty(filter.q || filter.status ? 'Keine passende Akte.' : 'Noch keine Akten angelegt.')}</div>`;
    $('#c-search').addEventListener('input', debounce(async (event) => { filter.q = event.target.value.trim(); await reload(); }));
    $('#c-status').addEventListener('change', async (event) => { filter.status = event.target.value; await reload(); });
  }
  function drawDetail() {
    const f = detail;
    const w = writable();
    $('#c-main').innerHTML = `<div class="card"><div class="card-head"><div><h2>${esc(f.file_number)} · ${esc(f.title)}</h2>
        <small class="muted">${tag(...CASE_STATUS[f.status])} ${scopeTag(f)} · eröffnet ${fdate(f.opened_on)}${f.closed_on ? ` · abgeschlossen ${fdate(f.closed_on)}` : ''}</small></div>
        <div class="row"><button class="btn ghost sm" id="c-back">Zurück</button>${w ? '<button class="btn ghost sm" id="c-edit">Bearbeiten</button>' : ''}
        ${f.role !== 'viewer' && can('casefile:delete') ? '<button class="btn ghost sm" id="c-del">Löschen</button>' : ''}</div></div>
        ${f.description ? `<div class="memo-body">${esc(f.description)}</div>` : '<p class="muted">Kein Sachverhalt erfasst.</p>'}</div>
      <div class="grid cols-2">
        <div class="card"><div class="card-head"><h2>Beteiligte Personen</h2>${w ? '<button class="btn ghost sm" id="p-add">Person beteiligen</button>' : ''}</div>
          ${f.people.length ? f.people.map((p) => `<div class="list-item"><div class="grow"><b>${esc(p.name || 'Person nicht sichtbar')}</b><small>${esc(p.role || 'ohne Rolle')}${p.function ? ` · ${esc(p.function)}` : ''}${p.active === false ? ' · inaktiv' : ''}</small></div>
            ${w ? `<button class="btn ghost sm" data-p-del="${p.person_id}">Entfernen</button>` : ''}</div>`).join('') : empty('Noch keine Personen beteiligt.')}</div>
        <div class="card"><div class="card-head"><h2>Anhänge</h2>${w ? '<button class="btn ghost sm" id="a-add">Datei hochladen</button>' : ''}</div>
          ${f.attachments.length ? f.attachments.map((a) => `<div class="list-item"><div class="grow"><button class="link" data-a-get="${a.id}">${esc(a.original_name)}</button><small>${sizeText(a.size)} · ${fdatetime(a.created_at)}${a.uploaded_by_name ? ` · ${esc(a.uploaded_by_name)}` : ''}</small></div>
            ${w ? `<button class="btn ghost sm" data-a-del="${a.id}">Löschen</button>` : ''}</div>`).join('') : empty('Keine Anhänge. Erlaubt sind PDF, PNG und JPEG.')}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Einträge</h2>${w ? '<button class="btn ghost sm" id="e-new">Neuer Eintrag</button>' : ''}</div>
        ${f.entries.length ? f.entries.map((e) => `<div class="case-entry"><div class="row"><b>${fdate(e.entry_date)}</b>${e.kind ? tag('', e.kind) : ''}${e.person_name ? `<small class="muted">betrifft ${esc(e.person_name)}</small>` : ''}
            <span class="grow"></span>${w ? `<button class="btn ghost sm" data-e-edit="${e.id}">Bearbeiten</button><button class="btn ghost sm" data-e-del="${e.id}">Löschen</button>` : ''}</div>
          <div class="memo-body">${esc(e.body)}</div>
          <small class="muted">${esc(e.created_by_name || '–')}, ${fdatetime(e.created_at)}${e.updated_by_name && e.updated_at !== e.created_at ? ` · geändert von ${esc(e.updated_by_name)}, ${fdatetime(e.updated_at)}` : ''}</small></div>`).join('') : empty('Noch keine Einträge.')}</div>`;
  }
  async function reload() {
    try {
      const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
      files = await api.get(`/case-files?${qs}`);
      detail = null;
      const focused = document.activeElement?.id;
      drawList();
      if (focused === 'c-search') { const input = $('#c-search'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    } catch (error) {
      toast(error.message, true);
    }
  }
  async function openFile(id) {
    detail = await api.get(`/case-files/${id}`);
    drawDetail();
    history.replaceState(null, '', `#/casefiles?id=${id}`);
  }

  $('#c-upload', view).addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file || !detail) return;
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/case-files/${detail.id}/attachments`, form);
      toast('Datei hochgeladen');
      await openFile(detail.id);
    } catch (error) {
      toast(error.message, true);
    }
  });
  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const d = target.dataset;
    try {
      if (target.id === 'c-new') { const id = await fileForm(null, teams); if (id) await openFile(id); }
      else if (d.open) await openFile(d.open);
      else if (target.id === 'c-back') { await reload(); history.replaceState(null, '', '#/casefiles'); }
      else if (target.id === 'c-edit') { if (await fileForm(detail, teams)) await openFile(detail.id); }
      else if (target.id === 'c-del' && await confirmBox('Akte löschen', `Akte ${detail.file_number} wird mit allen Einträgen und Anhängen endgültig gelöscht.`)) {
        await api.del(`/case-files/${detail.id}`);
        await reload();
        history.replaceState(null, '', '#/casefiles');
      } else if (target.id === 'p-add') { if (await personForm(detail)) await openFile(detail.id); }
      else if (d.pDel && await confirmBox('Person entfernen', 'Die Person wird aus der Akte entfernt. Einträge zu ihr bleiben ohne Personenbezug erhalten.', 'Entfernen')) {
        await api.del(`/case-files/${detail.id}/people/${d.pDel}`);
        await openFile(detail.id);
      } else if (target.id === 'e-new') { if (await entryForm(detail)) await openFile(detail.id); }
      else if (d.eEdit) { if (await entryForm(detail, detail.entries.find((e) => e.id === d.eEdit))) await openFile(detail.id); }
      else if (d.eDel && await confirmBox('Eintrag löschen', 'Der Eintrag wird endgültig gelöscht.')) {
        await api.del(`/case-file-entries/${d.eDel}`);
        await openFile(detail.id);
      } else if (target.id === 'a-add') $('#c-upload', view).click();
      else if (d.aGet) await api.download(`/case-file-attachments/${d.aGet}`, detail.attachments.find((a) => a.id === d.aGet)?.original_name || 'anhang');
      else if (d.aDel && await confirmBox('Anhang löschen', 'Die Datei wird endgültig gelöscht.')) {
        await api.del(`/case-file-attachments/${d.aDel}`);
        await openFile(detail.id);
      }
    } catch (error) {
      toast(error.message, true);
    }
  });

  const initial = params?.get('id');
  if (initial) {
    try { await openFile(initial); return; } catch (error) { toast(error.message, true); }
  }
  await reload();
}
