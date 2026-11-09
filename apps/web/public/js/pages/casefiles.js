import { api } from '../api.js';
import { $, esc, empty, fdate, fdatetime, tag, openForm, confirmBox, toast, todayStr, debounce } from '../ui.js';
import { can } from '../app.js';
import { visibilityField, scopeTag } from './common.js';
import { markdownBlock } from '../markdown.js';

export const CASE_STATUS = { open: ['ok', 'Offen'], dormant: ['warn', 'Ruhend'], closed: ['', 'Abgeschlossen'] };
const KIND_SUGGESTIONS = ['Vermerk', 'Vernehmung', 'Verstoß', 'Beweismittel', 'Auszeichnung', 'Gespräch', 'Entscheidung'];
const statusOptions = Object.entries(CASE_STATUS).map(([v, [, l]]) => ({ v, l }));
const sizeText = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(bytes / 1024)} KB`);

// Aktenarten im Auswahlfeld: mit Bereich, damit gleichnamige Arten verschiedener Organisationen unterscheidbar sind
const typeLabel = (t) => `${t.name} (${t.team_name || 'privat'})`;
const typeOptions = (types) => [{ v: '', l: '– Ohne Aktenart –' }, ...types.map((t) => ({ v: t.id, l: typeLabel(t) }))];

const fileForm = (file, teams, types) => {
  // Neue Akte: Arten, in denen geschrieben werden darf; beim Bearbeiten nur Arten desselben Bereichs und nur mit „Verwalten“
  const choosable = file
    ? types.filter((t) => (file.team_id ? t.team_id === file.team_id : !t.team_id) && t.level >= 3)
    : types.filter((t) => t.level >= 3);
  const canRetype = file && file.level >= 4;
  return openForm({
    title: file ? 'Akte bearbeiten' : 'Neue Akte',
    wide: true,
    fields: [
      { name: 'title', label: 'Titel', value: file?.title, required: true, maxlength: 200, full: true },
      { name: 'file_number', label: 'Aktenzeichen', value: file?.file_number, maxlength: 40, help: file ? '' : 'Leer: wird automatisch vergeben, z. B. 2026-0001.' },
      { name: 'status', label: 'Status', type: 'select', options: statusOptions, value: file?.status || 'open' },
      { name: 'opened_on', label: 'Eröffnet am', type: 'date', value: file?.opened_on || todayStr(), required: true },
      ...(file ? [{ name: 'closed_on', label: 'Abgeschlossen am', type: 'date', value: file.closed_on || '', help: 'Nur bei Status „Abgeschlossen“; leer heißt heute.' }] : [visibilityField(teams, null)]),
      ...(!file || canRetype ? [{ name: 'type_id', label: 'Aktenart', type: 'select', options: typeOptions(choosable), value: file?.type_id || '', help: file ? 'Eine andere Art ändert, wer die Akte sieht.' : 'Die Art muss zum gewählten Bereich gehören.' }] : []),
      { name: 'description', label: 'Sachverhalt', type: 'textarea', rows: 8, value: file?.description, maxlength: 20000, full: true, markdown: true },
    ],
    onSubmit: async (values) => {
      const body = { title: values.title.trim(), file_number: values.file_number.trim(), status: values.status, opened_on: values.opened_on, description: values.description };
      if (file) {
        await api.patch(`/case-files/${file.id}`, { ...body, closed_on: values.closed_on || null, ...(canRetype ? { type_id: values.type_id || null } : {}) });
        return file.id;
      }
      const created = await api.post('/case-files', { ...body, team_id: values.team_id || null, type_id: values.type_id || null });
      toast(`Akte ${created.file_number} angelegt`);
      return created.id;
    },
  });
};

// Wer eine beschränkte Akte sieht: Ränge zählen samt allen höheren, dazu Gruppen und einzelne Mitglieder
async function accessForm(file) {
  const options = await api.get(`/case-files/${file.id}/access-options`);
  const chosen = (key) => file.access.filter((a) => a[key]).map((a) => a[key]);
  return openForm({
    title: 'Zugriff beschränken',
    wide: true,
    fields: [
      { type: 'html', html: '<p class="muted">Beschränkt sehen die Akte nur die gewählten Ränge (und alle höheren), Gruppen und Mitglieder – dazu Inhaber und wer die Akte angelegt hat. Was sie dort dürfen, richtet sich weiter nach ihren Rechten.</p>' },
      { name: 'restricted', label: 'Akte beschränken', type: 'checkbox', value: file.restricted, full: true },
      { name: 'rank_ids', label: 'Ränge (und höher)', type: 'multi', options: options.ranks.map((r) => ({ v: r.id, l: r.name })), value: chosen('rank_id') },
      { name: 'group_ids', label: 'Gruppen', type: 'multi', options: options.groups.map((g) => ({ v: g.id, l: g.name })), value: chosen('group_id') },
      { name: 'user_ids', label: 'Mitglieder', type: 'multi', options: options.members.map((m) => ({ v: m.id, l: m.name })), value: chosen('user_id'), full: true },
    ],
    onSubmit: (values) => api.put(`/case-files/${file.id}/access`, values.restricted
      ? { restricted: true, rank_ids: values.rank_ids, group_ids: values.group_ids, user_ids: values.user_ids }
      : { restricted: false }),
  });
}

async function typeForm(type, teams) {
  return openForm({
    title: type ? 'Aktenart umbenennen' : 'Neue Aktenart',
    fields: [
      { name: 'name', label: 'Name', value: type?.name, required: true, maxlength: 100, full: true, placeholder: 'z. B. Ermittlungsakte, Personalakte' },
      ...(type ? [] : [visibilityField(teams, null)]),
      ...(type ? [] : [{ type: 'html', html: '<p class="muted">Eigene Rechte für die Art setzt du in der Organisation unter „Rechte“.</p>' }]),
    ],
    onSubmit: (values) => (type ? api.patch(`/case-file-types/${type.id}`, { name: values.name.trim() }) : api.post('/case-file-types', { name: values.name.trim(), team_id: values.team_id || null })),
  });
}

async function personForm(file) {
  // Personen sind global: Jede aktive Person lässt sich beteiligen
  const people = (await api.get('/people')).filter((p) => p.active && !file.people.some((x) => x.person_id === p.id));
  if (!people.length) { toast('Keine weitere aktive Person. Lege sie unter „Personen“ an.', true); return false; }
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
    { name: 'body', label: 'Text', type: 'textarea', rows: 10, value: entry?.body, maxlength: 20000, required: true, full: true, markdown: true },
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
  let types = [];
  let tab = 'files';
  const filter = { status: '', type_id: '', q: '' };
  const orgs = can('team:read') ? await api.get('/teams') : [];
  view.innerHTML = `<div class="page-head"><div><h1>Akten</h1><p>Vorgänge mit beteiligten Personen, Einträgen und Anhängen</p></div>
    <div class="actions">${can('casefile:create') ? '<button class="btn" id="c-new">Neue Akte</button>' : ''}</div></div>
    <div class="tabs"><button data-tab="files" class="on">Akten</button><button data-tab="types">Aktenarten</button></div>
    <div id="c-main"></div><input type="file" id="c-upload" accept="application/pdf,image/png,image/jpeg" hidden>`;
  const writable = () => detail.level >= 3 && can('casefile:update');
  // Neue Akten: Organisationen mit Schreibrecht für Akten allgemein oder für mindestens eine ihrer Aktenarten
  const fileTeams = () => orgs.filter((o) => o.levels.casefile >= 3 || types.some((t) => t.team_id === o.id && t.level >= 3));
  const typeTeams = () => orgs.filter((o) => o.levels.casefile >= 4);

  function drawList() {
    $('#c-main').innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="c-search" type="search" class="search" placeholder="Aktenzeichen, Titel, Person…" aria-label="Akten durchsuchen" value="${esc(filter.q)}">
      <select id="c-status" aria-label="Status"><option value="">Alle Status</option>${statusOptions.map((o) => `<option value="${o.v}" ${filter.status === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>
      ${types.length ? `<select id="c-type" aria-label="Aktenart"><option value="">Alle Aktenarten</option>${types.map((t) => `<option value="${t.id}" ${filter.type_id === t.id ? 'selected' : ''}>${esc(typeLabel(t))}</option>`).join('')}</select>` : ''}</div>
      <div class="card">${files.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Aktenzeichen</th><th>Titel</th><th>Art</th><th>Personen</th><th>Status</th><th>Letzter Eintrag</th><th>Sichtbarkeit</th><th></th></tr></thead><tbody>
      ${files.map((f) => `<tr><td><b>${esc(f.file_number)}</b></td><td>${esc(f.title)}${f.restricted ? ` ${tag('warn', 'Beschränkt')}` : ''}</td><td>${esc(f.type_name || '–')}</td><td>${esc(f.people.join(', ') || '–')}</td><td>${tag(...CASE_STATUS[f.status])}</td>
        <td>${f.last_entry ? fdate(f.last_entry) : '–'} <small class="muted">(${f.entries})</small></td><td>${scopeTag(f)}</td><td><button class="btn ghost sm" data-open="${f.id}">Öffnen</button></td></tr>`).join('')}</tbody></table></div>`
      : empty(filter.q || filter.status || filter.type_id ? 'Keine passende Akte.' : 'Noch keine Akten angelegt.')}</div>`;
    $('#c-search').addEventListener('input', debounce(async (event) => { filter.q = event.target.value.trim(); await reload(); }));
    $('#c-status').addEventListener('change', async (event) => { filter.status = event.target.value; await reload(); });
    $('#c-type')?.addEventListener('change', async (event) => { filter.type_id = event.target.value; await reload(); });
  }
  function drawTypes() {
    const canCreate = can('casefile:create');
    $('#c-main').innerHTML = `<div class="card"><div class="card-head"><h2>Aktenarten</h2>${canCreate ? '<button class="btn ghost sm" id="t-new">Aktenart anlegen</button>' : ''}</div>
      <p class="muted">Aktenarten wie Ermittlungsakte oder Personalakte bekommen in der Organisation eigene Rechte. So sehen zum Beispiel nur bestimmte Ränge oder Gruppen die Personalakten.</p>
      ${types.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Aktenart</th><th>Bereich</th><th>Akten</th><th></th></tr></thead><tbody>
      ${types.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${scopeTag(t)}</td><td>${t.files}</td>
        <td style="white-space:nowrap">${t.level >= 4 && can('casefile:update') ? `<button class="btn ghost sm" data-t-edit="${t.id}">Umbenennen</button>` : ''}${t.level >= 4 && can('casefile:delete') && !t.files ? ` <button class="btn ghost sm" data-t-del="${t.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Noch keine Aktenarten. Akten ohne Art folgen den Rechten für Akten allgemein.')}</div>`;
  }
  const accessText = (f) => f.access.map((a) => (a.rank_id ? `Rang ${a.name} und höher` : a.group_id ? `Gruppe ${a.name}` : a.name)).map(esc).join(', ');
  function drawDetail() {
    const f = detail;
    const w = writable();
    $('#c-main').innerHTML = `<div class="card"><div class="card-head"><div><h2>${esc(f.file_number)} · ${esc(f.title)}</h2>
        <small class="muted">${tag(...CASE_STATUS[f.status])} ${scopeTag(f)}${f.type_name ? ` ${tag('', f.type_name)}` : ''}${f.restricted ? ` ${tag('warn', 'Beschränkt')}` : ''} · eröffnet ${fdate(f.opened_on)}${f.closed_on ? ` · abgeschlossen ${fdate(f.closed_on)}` : ''}</small></div>
        <div class="row"><button class="btn ghost sm" id="c-back">Zurück</button>${w ? '<button class="btn ghost sm" id="c-edit">Bearbeiten</button>' : ''}
        ${f.team_id && f.level >= 4 && can('casefile:update') ? '<button class="btn ghost sm" id="c-access">Zugriff</button>' : ''}
        ${f.level >= 4 && can('casefile:delete') ? '<button class="btn ghost sm" id="c-del">Löschen</button>' : ''}</div></div>
        ${f.restricted && f.access.length ? `<div class="note info">Sichtbar nur für: ${accessText(f)} – dazu Inhaber und wer die Akte angelegt hat.</div>` : ''}
        ${f.description ? markdownBlock(f.description) : '<p class="muted">Kein Sachverhalt erfasst.</p>'}</div>
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
          ${markdownBlock(e.body)}
          <small class="muted">${esc(e.created_by_name || '–')}, ${fdatetime(e.created_at)}${e.updated_by_name && e.updated_at !== e.created_at ? ` · geändert von ${esc(e.updated_by_name)}, ${fdatetime(e.updated_at)}` : ''}</small></div>`).join('') : empty('Noch keine Einträge.')}</div>`;
  }
  async function reload() {
    try {
      const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
      [files, types] = await Promise.all([api.get(`/case-files?${qs}`), api.get('/case-file-types')]);
      if (filter.type_id && !types.some((t) => t.id === filter.type_id)) filter.type_id = '';
      detail = null;
      setTab('files');
      const focused = document.activeElement?.id;
      drawList();
      if (focused === 'c-search') { const input = $('#c-search'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    } catch (error) {
      toast(error.message, true);
    }
  }
  function setTab(next) {
    tab = next;
    view.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }
  async function openFile(id) {
    if (!types.length) types = await api.get('/case-file-types');
    detail = await api.get(`/case-files/${id}`);
    setTab('files');
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
      if (target.id === 'c-new') { const id = await fileForm(null, fileTeams(), types); if (id) await openFile(id); }
      else if (d.tab === 'files') await reload();
      else if (d.tab === 'types') { types = await api.get('/case-file-types'); detail = null; setTab('types'); drawTypes(); history.replaceState(null, '', '#/casefiles'); }
      else if (target.id === 't-new') { if (await typeForm(null, typeTeams())) { types = await api.get('/case-file-types'); drawTypes(); } }
      else if (d.tEdit) { if (await typeForm(types.find((t) => t.id === d.tEdit))) { types = await api.get('/case-file-types'); drawTypes(); } }
      else if (d.tDel && await confirmBox('Aktenart löschen', 'Die Aktenart und ihre Rechte werden gelöscht.')) {
        await api.del(`/case-file-types/${d.tDel}`);
        types = await api.get('/case-file-types');
        drawTypes();
      } else if (target.id === 'c-access') { if (await accessForm(detail)) await openFile(detail.id); }
      else if (d.open) await openFile(d.open);
      else if (target.id === 'c-back') { await reload(); history.replaceState(null, '', '#/casefiles'); }
      else if (target.id === 'c-edit') { if (await fileForm(detail, fileTeams(), types)) await openFile(detail.id); }
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
