import { api } from '../api.js';
import { $, esc, empty, fdate, tag, openForm, confirmBox, toast, todayStr } from '../ui.js';
import { can } from '../app.js';
import { writableTeams, visibilityField, scopeTag } from './common.js';
import { markdownBlock, MARKDOWN_HELP } from '../markdown.js';

const RESULT = { registered: ['', 'Angemeldet'], passed: ['ok', 'Bestanden'], failed: ['bad', 'Nicht bestanden'], absent: ['warn', 'Nicht erschienen'] };
const STATE = { valid: ['ok', 'Gültig'], expiring: ['warn', 'Läuft bald ab'], expired: ['bad', 'Abgelaufen'] };
const timeText = (s) => (s.start_time ? `${s.start_time.slice(0, 5)}${s.end_time ? `–${s.end_time.slice(0, 5)}` : ''}` : 'ganztägig');
const sessionLabel = (s) => `${fdate(s.session_date)} · ${timeText(s)}${s.location ? ` · ${s.location}` : ''}`;

const trainingForm = (training, teams) => openForm({
  title: training ? 'Schulung bearbeiten' : 'Neue Schulung',
  wide: true,
  fields: [
    { name: 'name', label: 'Name', value: training?.name, required: true, maxlength: 150, full: true },
    { name: 'validity_months', label: 'Gültigkeit in Monaten', type: 'number', min: 1, step: 1, value: training?.validity_months ?? '', help: 'Leer heißt: Ein bestandener Nachweis gilt unbefristet.' },
    ...(training ? [{ name: 'active', label: 'Aktiv', type: 'checkbox', value: training.active }] : [visibilityField(teams, null)]),
    { name: 'description', label: 'Beschreibung und Inhalte', type: 'textarea', rows: 8, value: training?.description, maxlength: 20000, full: true, help: MARKDOWN_HELP },
  ],
  onSubmit: async (values) => {
    const body = { name: values.name.trim(), description: values.description, validity_months: values.validity_months ? Number(values.validity_months) : null };
    if (training) {
      await api.patch(`/trainings/${training.id}`, { ...body, active: values.active });
      return training.id;
    }
    const created = await api.post('/trainings', { ...body, team_id: values.team_id || null });
    toast('Schulung angelegt');
    return created.id;
  },
});

const sessionForm = (training, session) => openForm({
  title: session ? 'Termin bearbeiten' : 'Neuer Termin',
  fields: [
    { name: 'session_date', label: 'Datum', type: 'date', value: session?.session_date || todayStr(), required: true },
    { name: 'location', label: 'Ort', value: session?.location, maxlength: 200 },
    { name: 'start_time', label: 'Beginn (optional)', type: 'time', value: session?.start_time?.slice(0, 5) || '' },
    { name: 'end_time', label: 'Ende (optional)', type: 'time', value: session?.end_time?.slice(0, 5) || '' },
    { name: 'instructor', label: 'Ausbilder', value: session?.instructor, maxlength: 100 },
    { name: 'note', label: 'Notiz', type: 'textarea', value: session?.note, maxlength: 2000, full: true },
  ],
  onSubmit: async (values) => {
    const body = { session_date: values.session_date, location: values.location.trim(), start_time: values.start_time || null, end_time: values.end_time || null, instructor: values.instructor.trim(), note: values.note };
    if (session) await api.patch(`/training-sessions/${session.id}`, body);
    else await api.post(`/trainings/${training.id}/sessions`, body);
    toast('Termin gespeichert');
  },
});

async function recordForm(training, record, presetSession) {
  const sessionOptions = [{ v: '', l: '– Ohne Termin –' }, ...training.sessions.map((s) => ({ v: s.id, l: sessionLabel(s) }))];
  const fields = [];
  if (!record) {
    const candidates = await api.get(`/trainings/${training.id}/candidates`);
    const options = [...candidates.users.map((u) => ({ v: `user:${u.id}`, l: `${u.name} (Benutzer)` })), ...candidates.people.map((p) => ({ v: `person:${p.id}`, l: `${p.name} (Person)` }))];
    if (!options.length) { toast('Keine Teilnehmer verfügbar. Lege Personen im selben Bereich an.', true); return false; }
    fields.push({ name: 'participant', label: 'Teilnehmer', type: 'select', options, full: true });
  } else fields.push({ type: 'html', html: `<p>Teilnehmer: <b>${esc(record.participant || '–')}</b></p>` });
  fields.push(
    { name: 'session_id', label: 'Termin', type: 'select', options: sessionOptions, value: record?.session_id || presetSession || '' },
    { name: 'result', label: 'Ergebnis', type: 'select', options: Object.entries(RESULT).map(([v, [, l]]) => ({ v, l })), value: record?.result || 'registered' },
    { name: 'completed_on', label: 'Abgeschlossen am', type: 'date', value: record?.completed_on || '', help: 'Leer: Datum des Termins oder heute.' },
    { name: 'valid_until', label: 'Gültig bis', type: 'date', value: record?.valid_until || '', help: training.validity_months ? `Leer: ${training.validity_months} Monate ab Abschluss.` : 'Leer heißt unbefristet.' },
    { name: 'instructor', label: 'Ausbilder', value: record?.instructor, maxlength: 100 },
    { name: 'note', label: 'Notiz', type: 'textarea', value: record?.note, maxlength: 2000, full: true },
  );
  return openForm({
    title: record ? 'Teilnahme bearbeiten' : 'Teilnehmer eintragen',
    fields,
    onSubmit: async (values) => {
      const body = { session_id: values.session_id || null, result: values.result, completed_on: values.completed_on || null, instructor: values.instructor.trim(), note: values.note };
      // Ohne Datum bestimmt der Server die Gültigkeit aus der Schulung
      if (values.valid_until) body.valid_until = values.valid_until;
      else if (record && values.result === 'passed' && record.valid_until) body.valid_until = null;
      if (record) await api.patch(`/training-records/${record.id}`, body);
      else {
        const [kind, id] = values.participant.split(':');
        await api.post(`/trainings/${training.id}/records`, { ...body, [kind === 'user' ? 'user_id' : 'person_id']: id });
      }
      toast('Teilnahme gespeichert');
    },
  });
}

export async function render(view, params) {
  let trainings = [];
  let detail = null;
  // Schulungen anlegen braucht „Verwalten“; Termine und Ergebnisse „Lesen & Schreiben“; „Teilnehmen“ meldet sich nur selbst an
  const teams = can('team:read') ? await writableTeams('training', 4) : [];
  view.innerHTML = `<div class="page-head"><div><h1>Schulungen</h1><p>Termine, Teilnahme und Nachweise, solo oder in einer Organisation</p></div>
    <div class="actions">${can('training:create') ? '<button class="btn" id="t-new">Neue Schulung</button>' : ''}</div></div>
    <div><div class="tabs"><button data-tab="list" class="on">Schulungen</button><button data-tab="overview">Übersicht</button></div>
    <div class="tab-panel on" data-panel="list"><div id="t-main"></div></div>
    <div class="tab-panel" data-panel="overview"><div class="card" id="t-overview"></div></div></div>`;
  const writable = (row) => row.level >= 3 && can('training:update');
  const today = todayStr();

  function drawList() {
    $('#t-main').innerHTML = `<div class="card">${trainings.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Schulung</th><th>Nächster Termin</th><th>Gültige Nachweise</th><th>Angemeldet</th><th>Sichtbarkeit</th><th></th></tr></thead><tbody>
      ${trainings.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.active ? '' : ` ${tag('', 'Inaktiv')}`}<br><small class="muted">${t.validity_months ? `gilt ${t.validity_months} Monate` : 'unbefristet'}</small></td>
        <td>${t.next_session ? fdate(t.next_session) : '–'}</td><td>${t.valid_records ?? '–'}</td><td>${t.registered ?? '–'}</td><td>${scopeTag(t)}</td>
        <td><button class="btn ghost sm" data-open="${t.id}">Öffnen</button></td></tr>`).join('')}</tbody></table></div>`
      : empty('Noch keine Schulungen angelegt.')}</div>`;
  }
  function drawDetail() {
    const t = detail;
    const w = writable(t);
    const mine = new Map((t.my_sessions || []).map((m) => [m.session_id, m]));
    // Selbst an- und abmelden: kommende Termine aktiver Schulungen einer Organisation
    const enrol = (s) => {
      if (!t.team_id || s.session_date < today) return '';
      const m = mine.get(s.id);
      if (m) return m.withdrawable ? `<button class="btn ghost sm" data-unenroll="${s.id}">Abmelden</button>` : tag('ok', 'Eingetragen');
      return t.active ? `<button class="btn sm" data-enroll="${s.id}">Anmelden</button>` : '';
    };
    $('#t-main').innerHTML = `<div class="card"><div class="card-head"><div><h2>${esc(t.name)}</h2><small class="muted">${scopeTag(t)} · ${t.validity_months ? `Nachweis gilt ${t.validity_months} Monate` : 'Nachweis unbefristet'}${t.active ? '' : ' · inaktiv'}</small></div>
        <div class="row"><button class="btn ghost sm" id="t-back">Zurück</button>${t.level >= 4 && can('training:update') ? '<button class="btn ghost sm" id="t-edit">Bearbeiten</button>' : ''}
        ${t.level >= 4 && can('training:delete') ? '<button class="btn ghost sm" id="t-del">Löschen</button>' : ''}</div></div>
        ${t.description ? markdownBlock(t.description) : ''}</div>
      <div class="card"><div class="card-head"><h2>Termine</h2>${w ? '<button class="btn ghost sm" id="s-new">Neuer Termin</button>' : ''}</div>
        ${t.sessions.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Datum</th><th>Zeit</th><th>Ort</th><th>Ausbilder</th>${t.level >= 2 ? '<th>Teilnehmer</th>' : ''}<th></th></tr></thead><tbody>
        ${t.sessions.map((s) => `<tr><td>${fdate(s.session_date)}</td><td>${timeText(s)}</td><td>${esc(s.location || '–')}</td><td>${esc(s.instructor || '–')}</td>${t.level >= 2 ? `<td>${s.participants}</td>` : ''}
          <td style="white-space:nowrap">${enrol(s)} ${w ? `<button class="btn ghost sm" data-s-add="${s.id}">Teilnehmer eintragen</button> <button class="btn ghost sm" data-s-edit="${s.id}">Bearbeiten</button> <button class="btn ghost sm" data-s-del="${s.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : empty('Noch keine Termine.')}</div>
      ${t.level < 2 ? '<div class="note info">Du kannst dich für kommende Termine an- und abmelden. Teilnehmer und Ergebnisse sehen nur Mitglieder mit mindestens „Lesen“.</div>' : `<div class="card"><div class="card-head"><h2>Teilnahme und Nachweise</h2>${w ? '<button class="btn ghost sm" id="r-new">Teilnehmer eintragen</button>' : ''}</div>
        ${t.records.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Teilnehmer</th><th>Termin</th><th>Ergebnis</th><th>Abgeschlossen</th><th>Gültig bis</th><th></th></tr></thead><tbody>
        ${t.records.map((r) => `<tr><td><b>${esc(r.participant || '–')}</b><br><small class="muted">${r.participant_kind === 'user' ? 'Benutzer' : 'Person'}</small></td>
          <td>${r.session_date ? fdate(r.session_date) : '–'}</td><td>${tag(...RESULT[r.result])}</td><td>${fdate(r.completed_on)}</td>
          <td>${r.result === 'passed' ? `${r.valid_until ? fdate(r.valid_until) : 'unbefristet'} ${STATE[r.state] ? tag(...STATE[r.state]) : ''}` : '–'}</td>
          <td style="white-space:nowrap">${w ? `<button class="btn ghost sm" data-r-edit="${r.id}">Ergebnis erfassen</button> <button class="btn ghost sm" data-r-del="${r.id}">Löschen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : empty('Noch niemand eingetragen.')}</div>`}`;
  }
  async function drawOverview() {
    const rows = await api.get('/trainings/overview');
    const names = [...new Map(rows.map((r) => [r.training_id, r.training_name])).entries()];
    const people = new Map();
    for (const r of rows) {
      const key = r.user_id || r.person_id;
      if (!people.has(key)) people.set(key, { name: r.participant || '–', cells: new Map() });
      people.get(key).cells.set(r.training_id, r);
    }
    const sorted = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    $('#t-overview').innerHTML = rows.length ? `<div class="card-head"><h2>Wer hat welche Schulung?</h2><small class="muted">neuester bestandener Nachweis</small></div>
      <div class="scroll-x"><table class="table"><thead><tr><th>Teilnehmer</th>${names.map(([, n]) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>
      ${sorted.map((p) => `<tr><td><b>${esc(p.name)}</b></td>${names.map(([id]) => {
        const cell = p.cells.get(id);
        return `<td>${cell ? `${tag(...STATE[cell.state])}<br><small class="muted">${cell.valid_until ? `bis ${fdate(cell.valid_until)}` : 'unbefristet'}</small>` : '–'}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`
      : empty('Noch keine bestandenen Schulungen.');
  }
  async function loadList() {
    trainings = await api.get('/trainings');
    detail = null;
    drawList();
  }
  async function openTraining(id) {
    detail = await api.get(`/trainings/${id}`);
    drawDetail();
    history.replaceState(null, '', `#/trainings?id=${id}`);
  }

  view.addEventListener('tabchange', async () => {
    if ($('.tabs .on', view).dataset.tab === 'overview') {
      try { await drawOverview(); } catch (error) { toast(error.message, true); }
    }
  });
  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target || target.closest('.tabs')) return;
    const d = target.dataset;
    try {
      if (target.id === 't-new') { const id = await trainingForm(null, teams); if (id) await openTraining(id); }
      else if (d.open) await openTraining(d.open);
      else if (d.enroll) { await api.post(`/training-sessions/${d.enroll}/enroll`); toast('Angemeldet'); await openTraining(detail.id); }
      else if (d.unenroll) { await api.del(`/training-sessions/${d.unenroll}/enroll`); toast('Abgemeldet'); await openTraining(detail.id); }
      else if (target.id === 't-back') { await loadList(); history.replaceState(null, '', '#/trainings'); }
      else if (target.id === 't-edit') { if (await trainingForm(detail, teams)) await openTraining(detail.id); }
      else if (target.id === 't-del' && await confirmBox('Schulung löschen', 'Die Schulung wird mit allen Terminen und Nachweisen gelöscht.')) {
        await api.del(`/trainings/${detail.id}`);
        await loadList();
        history.replaceState(null, '', '#/trainings');
      } else if (target.id === 's-new') { if (await sessionForm(detail)) await openTraining(detail.id); }
      else if (d.sEdit) { if (await sessionForm(detail, detail.sessions.find((s) => s.id === d.sEdit))) await openTraining(detail.id); }
      else if (d.sDel && await confirmBox('Termin löschen', 'Der Termin wird gelöscht. Eingetragene Teilnahmen bleiben ohne Termin erhalten.')) {
        await api.del(`/training-sessions/${d.sDel}`);
        await openTraining(detail.id);
      } else if (target.id === 'r-new' || d.sAdd) { if (await recordForm(detail, null, d.sAdd)) await openTraining(detail.id); }
      else if (d.rEdit) { if (await recordForm(detail, detail.records.find((r) => r.id === d.rEdit))) await openTraining(detail.id); }
      else if (d.rDel && await confirmBox('Teilnahme löschen', 'Der Eintrag und sein Nachweis werden gelöscht.')) {
        await api.del(`/training-records/${d.rDel}`);
        await openTraining(detail.id);
      }
    } catch (error) {
      toast(error.message, true);
    }
  });

  const initial = params?.get('id');
  if (initial) {
    try { await openTraining(initial); return; } catch (error) { toast(error.message, true); }
  }
  await loadList();
}
