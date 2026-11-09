// Aktensystem: Fallakten mit Berichten, Anklagepunkten, Beweismitteln, Fahndungen, Fahrzeugen und Verlauf; dazu
// Personenakten, Fahndungsliste, Strafkatalog, Berichtsvorlagen und Aktenarten als eigene Tabs.
import { api } from '../api.js';
import { $, esc, empty, fdate, fdatetime, tag, openForm, confirmBox, toast, todayStr, debounce, printArea } from '../ui.js';
import { can, state } from '../app.js';
import { visibilityField, scopeTag } from './common.js';
import { markdownBlock } from '../markdown.js';
import * as P from './case-parts.js';
import { drawPeople } from './person-files.js';
import { drawWanted, drawCodes, drawTemplates } from './case-admin.js';

export const { CASE_STATUS } = P;
const KIND_SUGGESTIONS = ['Vermerk', 'Vernehmung', 'Verstoß', 'Beweismittel', 'Auszeichnung', 'Gespräch', 'Entscheidung', 'Telefonat', 'Ermittlung'];
const statusOptions = Object.entries(CASE_STATUS).map(([v, [, l]]) => ({ v, l }));
const priorityOptions = Object.entries(P.PRIORITY).map(([v, [, l]]) => ({ v, l }));
const sizeText = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.ceil(bytes / 1024)} KB`);
const MAIN_TABS = [['files', 'Fallakten'], ['people', 'Personenakten'], ['wanted', 'Fahndung'], ['codes', 'Strafkatalog'], ['templates', 'Berichtsvorlagen'], ['types', 'Aktenarten']];

// Aktenarten im Auswahlfeld: mit Bereich, damit gleichnamige Arten verschiedener Organisationen unterscheidbar sind
const typeLabel = (t) => `${t.name} (${t.team_name || 'privat'})`;
const typeOptions = (types) => [{ v: '', l: '– Ohne Aktenart –' }, ...types.map((t) => ({ v: t.id, l: typeLabel(t) }))];

const fileForm = (file, teams, types) => {
  // Neue Akte: Arten, in denen geschrieben werden darf; beim Bearbeiten nur Arten desselben Bereichs und nur mit „Verwalten“
  const choosable = file
    ? types.filter((t) => (file.team_id ? t.team_id === file.team_id : !t.team_id) && t.level >= 3)
    : types.filter((t) => t.level >= 3);
  const canRetype = file && file.level >= 4;
  const leads = file?.team_id ? file.members.map((m) => ({ v: m.id, l: m.name })) : [{ v: state.me.id, l: state.me.name }];
  return openForm({
    title: file ? 'Akte bearbeiten' : 'Neue Akte',
    wide: true,
    fields: [
      { name: 'title', label: 'Titel', value: file?.title, required: true, maxlength: 200, full: true, placeholder: 'z. B. Raubüberfall Pacific Bank, Verkehrsunfall Route 68' },
      { name: 'file_number', label: 'Aktenzeichen', value: file?.file_number, maxlength: 40, help: file ? '' : 'Leer: wird automatisch vergeben, z. B. 2026-0001.' },
      { name: 'priority', label: 'Priorität', type: 'select', options: priorityOptions, value: file?.priority || 'normal' },
      { name: 'status', label: 'Status', type: 'select', options: statusOptions, value: file?.status || 'open' },
      { name: 'lead_user_id', label: 'Sachbearbeitung', type: 'select', options: [{ v: '', l: '–' }, ...leads], value: file ? file.lead_user_id || '' : state.me.id },
      { name: 'incident_at', label: 'Tat- bzw. Einsatzzeit', type: 'datetime-local', value: P.toLocalInput(file?.incident_at) },
      { name: 'location', label: 'Tat- bzw. Einsatzort', value: file?.location, maxlength: 200 },
      { name: 'opened_on', label: 'Eröffnet am', type: 'date', value: file?.opened_on || todayStr(), required: true },
      ...(file ? [{ name: 'closed_on', label: 'Abgeschlossen am', type: 'date', value: file.closed_on || '', help: 'Nur bei Status „Abgeschlossen“; leer heißt heute.' }] : [visibilityField(teams, null)]),
      ...(!file || canRetype ? [{ name: 'type_id', label: 'Aktenart', type: 'select', options: typeOptions(choosable), value: file?.type_id || '', help: file ? 'Eine andere Art ändert, wer die Akte sieht.' : 'Die Art muss zum gewählten Bereich gehören.' }] : []),
      { name: 'description', label: 'Sachverhalt', type: 'textarea', rows: 8, value: file?.description, maxlength: 20000, full: true, markdown: true },
    ],
    onSubmit: async (values) => {
      const body = {
        title: values.title.trim(), file_number: values.file_number.trim(), status: values.status, opened_on: values.opened_on, description: values.description,
        priority: values.priority, location: values.location.trim(), incident_at: P.fromLocalInput(values.incident_at), lead_user_id: values.lead_user_id || null,
      };
      if (file) {
        await api.patch(`/case-files/${file.id}`, { ...body, closed_on: values.closed_on || null, ...(canRetype ? { type_id: values.type_id || null } : {}) });
        return file.id;
      }
      // Die Sachbearbeitung einer neuen Akte in einer Organisation ist man selbst; privat ohnehin
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
      { name: 'name', label: 'Name', value: type?.name, required: true, maxlength: 100, full: true, placeholder: 'z. B. Ermittlungsakte, Einsatzakte, Patientenakte, Personalakte' },
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
      { name: 'person_id', label: 'Person', type: 'select', options: people.map((p) => ({ v: p.id, l: `${p.name}${p.aliases ? ` („${p.aliases}“)` : ''}${p.birth_date ? ` · geb. ${fdate(p.birth_date)}` : ''}` })) },
      { name: 'role', label: 'Rolle in der Akte', maxlength: 60, suggestions: P.ROLE_SUGGESTIONS, placeholder: 'z. B. Beschuldigte/r, Zeuge/Zeugin, Patient/in' },
    ],
    onSubmit: async (values) => api.post(`/case-files/${file.id}/people`, { person_id: values.person_id, role: values.role.trim() }),
  });
}

const entryForm = (file, entry) => openForm({
  title: entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
  wide: true,
  fields: [
    { name: 'entry_date', label: 'Datum', type: 'date', value: entry?.entry_date || todayStr(), required: true },
    { name: 'kind', label: 'Art', value: entry?.kind, maxlength: 60, suggestions: KIND_SUGGESTIONS, placeholder: KIND_SUGGESTIONS.slice(0, 3).join(', ') },
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
  let detailTab = 'd-overview';
  let types = [];
  let pending = [];
  let tab = 'files';
  const filter = { status: '', type_id: '', priority: '', q: '' };
  const orgs = can('team:read') ? await api.get('/teams') : [];
  // Bereiche für Personenakten, Strafkatalog, Vorlagen und Fahndung: Organisationen mit Leserecht für Akten, dazu privat
  const areas = [...orgs.filter((o) => (o.levels.casefile ?? 0) >= 2).map((o) => ({ id: o.id, name: o.name, level: o.levels.casefile })), { id: '', name: 'Privat', level: 4 }];
  const ctx = { areas, area: areas[0].id, openFile: (id) => openFile(id), openPerson: (id, areaId) => openPerson(id, areaId), url: (hash) => history.replaceState(null, '', hash) };
  view.innerHTML = `<div class="page-head"><div><h1>Akten</h1><p>Fallakten, Personenakten, Berichte, Fahndungen und Strafkatalog</p></div>
    <div class="actions">${can('casefile:create') ? '<button class="btn" id="c-new">Neue Akte</button>' : ''}</div></div>
    <div class="tabs" id="c-tabs">${MAIN_TABS.map(([k, l], i) => `<button data-tab="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div>
    <div id="c-main"></div><input type="file" id="c-upload" accept="application/pdf,image/png,image/jpeg" hidden>`;
  const writable = () => detail.level >= 3 && can('casefile:update');
  const manageable = () => detail.level >= 4 && can('casefile:update');
  // Neue Akten: Organisationen mit Schreibrecht für Akten allgemein oder für mindestens eine ihrer Aktenarten
  const fileTeams = () => orgs.filter((o) => o.levels.casefile >= 3 || types.some((t) => t.team_id === o.id && t.level >= 3));
  const typeTeams = () => orgs.filter((o) => o.levels.casefile >= 4);
  // Jeder Tab zeichnet in ein frisches Element; so hängen keine Klick-Listener eines anderen Tabs nach
  const fresh = () => { const el = document.createElement('div'); $('#c-main').replaceChildren(el); return el; };

  function drawList() {
    const el = fresh();
    el.innerHTML = `${pending.length ? `<div class="card"><div class="card-head"><h2>Wartet auf deine Freigabe</h2>${tag('warn', String(pending.length))}</div>
        ${pending.map((r) => `<div class="list-item"><div class="grow"><button class="link" data-open="${r.case_file_id}"><b>${esc(r.file_number)}</b> · B-${r.number} ${esc(r.title)}</button><small>${esc(r.author_name || '–')} · eingereicht ${fdatetime(r.submitted_at)}</small></div></div>`).join('')}</div>` : ''}
      <div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="c-search" type="search" class="search" placeholder="Aktenzeichen, Titel, Person, Alias, Kennzeichen, Ort…" aria-label="Akten durchsuchen" value="${esc(filter.q)}">
      <select id="c-status" aria-label="Status"><option value="">Alle Status</option>${statusOptions.map((o) => `<option value="${o.v}" ${filter.status === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>
      <select id="c-priority" aria-label="Priorität"><option value="">Alle Prioritäten</option>${priorityOptions.map((o) => `<option value="${o.v}" ${filter.priority === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>
      ${types.length ? `<select id="c-type" aria-label="Aktenart"><option value="">Alle Aktenarten</option>${types.map((t) => `<option value="${t.id}" ${filter.type_id === t.id ? 'selected' : ''}>${esc(typeLabel(t))}</option>`).join('')}</select>` : ''}</div>
      <div class="card">${files.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Aktenzeichen</th><th>Titel</th><th>Personen</th><th>Status</th><th>Sachbearbeitung</th><th>Letzter Eintrag</th><th>Bereich</th><th></th></tr></thead><tbody>
      ${files.map((f) => `<tr><td><b>${esc(f.file_number)}</b>${f.priority !== 'normal' ? `<br>${P.st(P.PRIORITY, f.priority)}` : ''}</td>
        <td>${esc(f.title)}${f.restricted ? ` ${tag('warn', 'Beschränkt')}` : ''}${f.active_warrants ? ` ${tag('bad', `${f.active_warrants} Fahndung${f.active_warrants === 1 ? '' : 'en'}`)}` : ''}${f.reports_pending ? ` ${tag('warn', 'Bericht wartet')}` : ''}
          <br><small class="muted">${[f.type_name, f.location, f.incident_at && fdatetime(f.incident_at)].filter(Boolean).map(esc).join(' · ')}</small></td>
        <td>${esc(f.people.join(', ') || '–')}</td><td>${tag(...CASE_STATUS[f.status])}</td><td>${esc(f.lead_name || '–')}</td>
        <td>${f.last_entry ? fdate(f.last_entry) : '–'} <small class="muted">(${f.entries})</small></td><td>${scopeTag(f)}</td><td><button class="btn ghost sm" data-open="${f.id}">Öffnen</button></td></tr>`).join('')}</tbody></table></div>`
      : empty(filter.q || filter.status || filter.type_id || filter.priority ? 'Keine passende Akte.' : 'Noch keine Akten angelegt.')}</div>`;
    $('#c-search', el).addEventListener('input', debounce(async (event) => { filter.q = event.target.value.trim(); await reload(); }));
    for (const [id, key] of [['#c-status', 'status'], ['#c-priority', 'priority'], ['#c-type', 'type_id']]) {
      $(id, el)?.addEventListener('change', async (event) => { filter[key] = event.target.value; await reload(); });
    }
  }
  function drawTypes() {
    const el = fresh();
    const canCreate = can('casefile:create');
    el.innerHTML = `<div class="card"><div class="card-head"><h2>Aktenarten</h2>${canCreate ? '<button class="btn ghost sm" id="t-new">Aktenart anlegen</button>' : ''}</div>
      <p class="muted">Aktenarten wie Ermittlungsakte, Einsatzakte, Patientenakte oder Personalakte bekommen in der Organisation eigene Rechte. So sehen zum Beispiel nur bestimmte Ränge oder Gruppen die Personalakten.</p>
      ${types.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Aktenart</th><th>Bereich</th><th>Akten</th><th></th></tr></thead><tbody>
      ${types.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${scopeTag(t)}</td><td>${t.files}</td>
        <td style="white-space:nowrap">${t.level >= 4 && can('casefile:update') ? `<button class="btn ghost sm" data-t-edit="${t.id}">Umbenennen</button>` : ''}${t.level >= 4 && can('casefile:delete') && !t.files ? ` <button class="btn ghost sm" data-t-del="${t.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Noch keine Aktenarten. Akten ohne Art folgen den Rechten für Akten allgemein.')}</div>`;
  }
  const accessText = (f) => f.access.map((a) => (a.rank_id ? `Rang ${a.name} und höher` : a.group_id ? `Gruppe ${a.name}` : a.name)).map(esc).join(', ');

  function drawDetail() {
    const f = detail;
    const w = writable();
    const flags = { w, m: manageable(), me: state.me.id, owner: f.owner };
    const activeWarrants = f.warrants.filter((x) => x.status === 'active').length;
    const waiting = f.reports.filter((r) => r.status === 'submitted').length;
    const tabs = [
      ['d-overview', 'Übersicht'], ['d-reports', `Berichte (${f.reports.length})`], ['d-charges', `Anklagen (${f.charges.length})`],
      ['d-evidence', `Beweismittel (${f.evidence.length})`], ['d-warrants', `Fahndungen (${activeWarrants})`], ['d-entries', `Verlauf (${f.entries.length})`], ['d-files', `Anhänge (${f.attachments.length})`],
    ];
    if (!tabs.some(([k]) => k === detailTab)) detailTab = 'd-overview';
    const panel = (key, html) => `<div class="tab-panel ${key === detailTab ? 'on' : ''}" data-panel="${key}">${html}</div>`;
    const el = fresh();
    el.className = 'case-detail';
    el.innerHTML = `<div class="card"><div class="card-head"><div><h2>${esc(f.file_number)} · ${esc(f.title)}</h2>
        <div class="row wrap">${tag(...CASE_STATUS[f.status])} ${P.st(P.PRIORITY, f.priority)} ${scopeTag(f)}${f.type_name ? ` ${tag('', f.type_name)}` : ''}${f.restricted ? ` ${tag('warn', 'Beschränkt')}` : ''}</div></div>
        <div class="row wrap no-print"><button class="btn ghost sm" id="c-back">Zurück</button><button class="btn ghost sm" id="c-print">Drucken</button>${w ? '<button class="btn ghost sm" id="c-edit">Bearbeiten</button>' : ''}
        ${f.team_id && f.level >= 4 && can('casefile:update') ? '<button class="btn ghost sm" id="c-access">Zugriff</button>' : ''}
        ${f.level >= 4 && can('casefile:delete') ? '<button class="btn ghost sm" id="c-del">Löschen</button>' : ''}</div></div>
        <dl class="case-meta">
          <div><dt>Eröffnet</dt><dd>${fdate(f.opened_on)}${f.closed_on ? ` · abgeschlossen ${fdate(f.closed_on)}` : ''}</dd></div>
          <div><dt>Tat- / Einsatzzeit</dt><dd>${f.incident_at ? fdatetime(f.incident_at) : '–'}</dd></div>
          <div><dt>Ort</dt><dd>${esc(f.location || '–')}</dd></div>
          <div><dt>Sachbearbeitung</dt><dd>${esc(f.lead_name || '–')}</dd></div>
        </dl>
        ${activeWarrants ? `<div class="note bad-note">${activeWarrants === 1 ? 'Eine aktive Fahndung' : `${activeWarrants} aktive Fahndungen`} in dieser Akte.</div>` : ''}
        ${waiting && manageable() ? `<div class="note">${waiting === 1 ? 'Ein Bericht wartet' : `${waiting} Berichte warten`} auf Freigabe.</div>` : ''}
        ${f.restricted && f.access.length ? `<div class="note info">Sichtbar nur für: ${accessText(f)} – dazu Inhaber und wer die Akte angelegt hat.</div>` : ''}</div>
      <div class="tabs" id="d-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === detailTab ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${panel('d-overview', `<div class="card"><div class="card-head"><h2>Sachverhalt</h2></div>${f.description ? markdownBlock(f.description) : '<p class="muted">Kein Sachverhalt erfasst.</p>'}</div>
        <div class="grid cols-2">
          <div class="card"><div class="card-head"><h2>Beteiligte Personen</h2>${w ? '<button class="btn ghost sm" id="p-add">Person beteiligen</button>' : ''}</div>
            ${f.people.length ? f.people.map((p) => `<div class="list-item"><div class="grow"><b>${esc(p.name || 'Person nicht sichtbar')}</b><small>${esc(p.role || 'ohne Rolle')}${p.function ? ` · ${esc(p.function)}` : ''}${p.active === false ? ' · inaktiv' : ''}</small></div>
              ${p.name && can('person:read') ? `<button class="btn ghost sm" data-person="${p.person_id}" data-area="${f.team_id || ''}">Personenakte</button>` : ''}${w ? `<button class="btn ghost sm" data-p-del="${p.person_id}">Entfernen</button>` : ''}</div>`).join('') : empty('Noch keine Personen beteiligt.')}</div>
          ${P.vehiclesHtml(f, flags)}
        </div>
        ${P.linksHtml(f, flags)}`)}
      ${panel('d-reports', P.reportsHtml(f, flags))}
      ${panel('d-charges', P.chargesHtml(f, flags))}
      ${panel('d-evidence', P.evidenceHtml(f, flags))}
      ${panel('d-warrants', P.warrantsHtml(f, flags))}
      ${panel('d-entries', `<div class="card"><div class="card-head"><h2>Verlauf</h2>${w ? '<button class="btn ghost sm" id="e-new">Neuer Eintrag</button>' : ''}</div>
        ${f.entries.length ? f.entries.map((e) => `<div class="case-entry"><div class="row"><b>${fdate(e.entry_date)}</b>${e.kind ? tag('', e.kind) : ''}${e.person_name ? `<small class="muted">betrifft ${esc(e.person_name)}</small>` : ''}
            <span class="grow"></span>${w ? `<button class="btn ghost sm" data-e-edit="${e.id}">Bearbeiten</button><button class="btn ghost sm" data-e-del="${e.id}">Löschen</button>` : ''}</div>
          ${markdownBlock(e.body)}
          <small class="muted">${esc(e.created_by_name || '–')}, ${fdatetime(e.created_at)}${e.updated_by_name && e.updated_at !== e.created_at ? ` · geändert von ${esc(e.updated_by_name)}, ${fdatetime(e.updated_at)}` : ''}</small></div>`).join('') : empty('Noch keine Einträge.')}</div>`)}
      ${panel('d-files', `<div class="card"><div class="card-head"><h2>Anhänge</h2>${w ? '<button class="btn ghost sm" id="a-add">Datei hochladen</button>' : ''}</div>
        ${f.attachments.length ? f.attachments.map((a) => `<div class="list-item"><div class="grow"><button class="link" data-a-get="${a.id}">${esc(a.original_name)}</button><small>${sizeText(a.size)} · ${fdatetime(a.created_at)}${a.uploaded_by_name ? ` · ${esc(a.uploaded_by_name)}` : ''}</small></div>
          ${w ? `<button class="btn ghost sm" data-a-del="${a.id}">Löschen</button>` : ''}</div>`).join('') : empty('Keine Anhänge. Erlaubt sind PDF, PNG und JPEG.')}</div>`)}`;
    el.addEventListener('tabchange', (event) => { detailTab = event.target.dataset.tab; });
  }

  async function reload() {
    try {
      const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
      [files, types, pending] = await Promise.all([api.get(`/case-files?${qs}`), api.get('/case-file-types'), api.get('/case-file-reports/pending')]);
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
    $('#c-tabs', view).querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }
  async function openFile(id, keepTab = false) {
    if (!types.length) types = await api.get('/case-file-types');
    if (!keepTab && detail?.id !== id) detailTab = 'd-overview';
    detail = await api.get(`/case-files/${id}`);
    setTab('files');
    drawDetail();
    ctx.url(`#/casefiles?id=${id}`);
  }
  const refresh = () => openFile(detail.id, true);
  async function openPerson(id, areaId) {
    if (areaId !== undefined && areas.some((a) => a.id === areaId)) ctx.area = areaId;
    detail = null;
    setTab('people');
    await drawPeople(fresh(), ctx, id);
  }
  async function openTab(next) {
    detail = null;
    if (next === 'files') { await reload(); ctx.url('#/casefiles'); return; }
    setTab(next);
    ctx.url(`#/casefiles?tab=${next}`);
    if (next === 'types') { types = await api.get('/case-file-types'); drawTypes(); }
    else if (next === 'people') await drawPeople(fresh(), ctx);
    else if (next === 'wanted') await drawWanted(fresh(), ctx);
    else if (next === 'codes') await drawCodes(fresh(), ctx);
    else if (next === 'templates') await drawTemplates(fresh(), ctx);
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
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });

  // Aktionen in der geöffneten Akte; liefert true, wenn neu geladen werden soll
  async function detailAction(target, d) {
    const f = detail;
    const find = (list, id) => list.find((x) => x.id === id);
    if (target.id === 'c-back') { await reload(); ctx.url('#/casefiles'); return false; }
    if (target.id === 'c-print') { printArea($('#c-main .case-detail')); return false; }
    if (target.id === 'c-edit') return fileForm(f, fileTeams(), types);
    if (target.id === 'c-access') return accessForm(f);
    if (target.id === 'c-del') {
      if (!(await confirmBox('Akte löschen', `Akte ${f.file_number} wird mit allen Berichten, Anklagepunkten, Beweismitteln, Fahndungen, Einträgen und Anhängen endgültig gelöscht.`))) return false;
      await api.del(`/case-files/${f.id}`);
      await reload();
      ctx.url('#/casefiles');
      return false;
    }
    if (target.id === 'p-add') return personForm(f);
    if (d.pDel) return (await confirmBox('Person entfernen', 'Die Person wird aus der Akte entfernt. Einträge zu ihr bleiben ohne Personenbezug erhalten.', 'Entfernen')) && api.del(`/case-files/${f.id}/people/${d.pDel}`);
    if (target.id === 'e-new') return entryForm(f);
    if (d.eEdit) return entryForm(f, find(f.entries, d.eEdit));
    if (d.eDel) return (await confirmBox('Eintrag löschen', 'Der Eintrag wird endgültig gelöscht.')) && api.del(`/case-file-entries/${d.eDel}`);
    if (target.id === 'a-add') { $('#c-upload', view).click(); return false; }
    if (d.aGet) { await api.download(`/case-file-attachments/${d.aGet}`, find(f.attachments, d.aGet)?.original_name || 'anhang'); return false; }
    if (d.aDel) return (await confirmBox('Anhang löschen', 'Die Datei wird endgültig gelöscht.')) && api.del(`/case-file-attachments/${d.aDel}`);
    // Berichte
    if (target.id === 'r-new') return P.reportForm(f);
    if (d.rEdit) return P.reportForm(f, find(f.reports, d.rEdit));
    if (d.rAmend) return P.reportForm(f, null, find(f.reports, d.rAmend));
    if (d.rSubmit) {
      if (!(await confirmBox(f.team_id ? 'Bericht einreichen' : 'Bericht abschließen', f.team_id ? 'Nach dem Einreichen kannst du den Bericht nicht mehr ändern, bis er freigegeben oder zurückgegeben ist.' : 'Abgeschlossene Berichte lassen sich nicht mehr ändern; Korrekturen kommen als Nachtrag.', f.team_id ? 'Einreichen' : 'Abschließen'))) return false;
      const r = await api.post(`/case-file-reports/${d.rSubmit}/submit`);
      toast(r.status === 'approved' ? 'Bericht abgeschlossen' : 'Bericht eingereicht');
      return true;
    }
    if (d.rApprove) {
      if (!(await confirmBox('Bericht freigeben', 'Freigegebene Berichte sind gesperrt; Korrekturen kommen als Nachtrag.', 'Freigeben'))) return false;
      await api.post(`/case-file-reports/${d.rApprove}/review`, { decision: 'approve' });
      toast('Bericht freigegeben');
      return true;
    }
    if (d.rReturn) return P.reviewForm(find(f.reports, d.rReturn));
    if (d.rPrint) { printArea(target.closest('.case-report')); return false; }
    if (d.rDel) return (await confirmBox('Bericht löschen', 'Der Bericht wird endgültig gelöscht.')) && api.del(`/case-file-reports/${d.rDel}`);
    // Anklagepunkte
    if (target.id === 'ch-new') return P.chargeForm(f);
    if (d.chEdit) return P.chargeForm(f, find(f.charges, d.chEdit));
    if (d.chDecide) return P.decisionForm(find(f.charges, d.chDecide));
    if (d.chDel) return (await confirmBox('Anklagepunkt löschen', 'Der Anklagepunkt wird endgültig gelöscht.')) && api.del(`/case-file-charges/${d.chDel}`);
    // Beweismittel
    if (target.id === 'ev-new') return P.evidenceForm(f);
    if (d.evEdit) return P.evidenceForm(f, find(f.evidence, d.evEdit));
    if (d.evLog) return P.evidenceLogForm(find(f.evidence, d.evLog));
    if (d.evDel) return (await confirmBox('Beweismittel löschen', 'Das Beweismittel und seine Übergabekette werden endgültig gelöscht. Besser: Status „Herausgegeben“ oder „Vernichtet“ setzen.')) && api.del(`/case-file-evidence/${d.evDel}`);
    // Fahndungen
    if (target.id === 'wa-new') return P.warrantForm(f);
    if (d.waClose) return P.warrantCloseForm(find(f.warrants, d.waClose), d.status);
    if (d.waDel) return (await confirmBox('Fahndung löschen', 'Die Fahndung wird endgültig gelöscht. Besser: aufheben.')) && api.del(`/warrants/${d.waDel}`);
    // Fahrzeuge und Verknüpfungen
    if (target.id === 've-new') return P.vehicleForm(f);
    if (d.veEdit) return P.vehicleForm(f, find(f.vehicles, d.veEdit));
    if (d.veDel) return (await confirmBox('Fahrzeug entfernen', 'Das Fahrzeug wird aus der Akte entfernt.', 'Entfernen')) && api.del(`/case-file-vehicles/${d.veDel}`);
    if (target.id === 'li-new') return P.linkForm(f);
    if (d.liDel) return (await confirmBox('Verknüpfung lösen', 'Die Akten bleiben bestehen, nur die Verknüpfung entfällt.', 'Lösen')) && api.del(`/case-files/${f.id}/links/${d.liDel}`);
    return false;
  }

  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const d = target.dataset;
    try {
      if (target.closest('#c-tabs') && d.tab) { await openTab(d.tab); return; }
      if (target.id === 'c-new') { const id = await fileForm(null, fileTeams(), types); if (id) await openFile(id); return; }
      if (d.open) { await openFile(d.open); return; }
      if (d.person) { await openPerson(d.person, d.area); return; }
      if (tab === 'types' && !detail) {
        if (target.id === 't-new') { if (await typeForm(null, typeTeams())) { types = await api.get('/case-file-types'); drawTypes(); } }
        else if (d.tEdit) { if (await typeForm(types.find((t) => t.id === d.tEdit))) { types = await api.get('/case-file-types'); drawTypes(); } }
        else if (d.tDel && await confirmBox('Aktenart löschen', 'Die Aktenart und ihre Rechte werden gelöscht.')) {
          await api.del(`/case-file-types/${d.tDel}`);
          types = await api.get('/case-file-types');
          drawTypes();
        }
        return;
      }
      if (detail && tab === 'files' && target.closest('.case-detail') && await detailAction(target, d)) await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });

  const initial = params?.get('id');
  const initialPerson = params?.get('person');
  const initialTab = params?.get('tab');
  try {
    if (initial) { await openFile(initial); return; }
    if (initialPerson) { await openPerson(initialPerson, params.get('area') ?? undefined); return; }
    if (initialTab && MAIN_TABS.some(([k]) => k === initialTab)) { await openTab(initialTab); return; }
  } catch (error) {
    toast(error.message, true);
  }
  await reload();
}
