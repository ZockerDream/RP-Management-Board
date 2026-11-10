// Personenakten: Liste mit Suche und Filtern je Bereich, Detail mit Foto, Stammdaten, Warnhinweisen, medizinischen
// Angaben, Fahndungen, Vorstrafen, Akten, Berichten, Beweismitteln, Fahrzeugen, Lizenzen und Schulungen.
import { api } from '../api.js';
import { $, esc, eur, fdate, fdatetime, tag, openForm, confirmBox, toast, empty, debounce, printArea } from '../ui.js';
import { can } from '../app.js';
import { markdownBlock } from '../markdown.js';
import * as P from './case-parts.js';
const { CASE_STATUS } = P;

const WARNINGS = ['Bewaffnet', 'Gewaltbereit', 'Fluchtgefahr', 'Suizidgefahr', 'Betäubungsmittel', 'Gang-Mitglied', 'Infektiös', 'Allergie', 'Diabetes', 'Epilepsie', 'Psychisch auffällig'];
const BLOOD = ['', '0+', '0−', 'A+', 'A−', 'B+', 'B−', 'AB+', 'AB−'];
const LICENSE_STATUS = { valid: 'Gültig', suspended: 'Gesperrt', revoked: 'Entzogen' };
const TRAINING_RESULT = { registered: 'Angemeldet', passed: 'Bestanden', failed: 'Nicht bestanden', absent: 'Nicht erschienen' };
const VEHICLE_STATUS = { available: 'Verfügbar', in_use: 'Im Einsatz', workshop: 'Werkstatt', retired: 'Ausgemustert' };
const FILTERS = [['', 'Alle Personen'], ['records', 'Mit Akten oder Personenakte'], ['wanted', 'Gesucht'], ['warnings', 'Mit Warnhinweisen'], ['inactive', 'Inaktiv']];
const photos = new Map();

const PKIND = { employee: 'Mitarbeiter', external: 'Extern', family: 'Familie' };
// Personen sind global: keine Sichtbarkeit, alle mit „Personen lesen“ sehen und nutzen sie
// Stammdaten: global wie die Person; auch die Personenakte (Akten) bearbeitet sie mit diesem Formular
export const GENDERS = ['weiblich', 'männlich', 'divers'];
export function formPerson(o) {
  return openForm({
  title: o ? 'Person bearbeiten' : 'Neue Person', wide: true, fields: [
    { name: 'name', label: 'Name', value: o?.name, required: true, maxlength: 100 },
    { name: 'aliases', label: 'Alias, Spitzname', value: o?.aliases, maxlength: 300 },
    { name: 'kind', label: 'Art', type: 'select', options: Object.entries(PKIND).map(([v, l]) => ({ v, l })), value: o?.kind || 'employee' },
    { name: 'function', label: 'Funktion, Beruf', value: o?.function, maxlength: 100 },
    { name: 'birth_date', label: 'Geburtsdatum', type: 'date', value: o?.birth_date || '' },
    { name: 'gender', label: 'Geschlecht', value: o?.gender, maxlength: 30, suggestions: GENDERS },
    { name: 'height_cm', label: 'Größe in cm', type: 'number', min: 30, max: 260, value: o?.height_cm ?? '' },
    { name: 'nationality', label: 'Staatsangehörigkeit', value: o?.nationality, maxlength: 60 },
    { name: 'address', label: 'Adresse', value: o?.address, maxlength: 300, full: true },
    { name: 'phone', label: 'Telefon', value: o?.phone, maxlength: 40 },
    { name: 'email', label: 'E-Mail', type: 'email', value: o?.email },
    { name: 'features', label: 'Besondere Merkmale', type: 'textarea', rows: 2, value: o?.features, maxlength: 1000, full: true, placeholder: 'z. B. Tattoo am Hals, Narbe linke Wange' },
    { name: 'active', label: 'Aktiv', type: 'checkbox', value: o ? o.active : true },
    { name: 'note', label: 'Notiz', type: 'textarea', value: o?.note, full: true, help: 'Stammdaten und Notiz sehen alle Benutzer mit Zugriff auf Personen. Was nur eine Organisation wissen soll, gehört in deren Personenakte.' },
  ],
  onSubmit: (v) => (o ? api.patch(`/people/${o.id}`, personBody(v)) : api.post('/people', personBody(v))),
  });
}
const personBody = (v) => ({
    name: v.name.trim(), aliases: v.aliases.trim(), kind: v.kind, function: v.function.trim(), birth_date: v.birth_date || null, gender: v.gender.trim(),
    height_cm: v.height_cm ? Number(v.height_cm) : null, nationality: v.nationality.trim(), address: v.address.trim(), phone: v.phone.trim(), email: v.email.trim(),
    features: v.features.trim(), active: v.active, note: v.note,
});

// Excel speichert CSV oft als Windows-1252 statt UTF-8; ohne diesen Rückfall würden Umlaute kaputtgehen
async function readCsvFile(file) {
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}
const count = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
function importResultHtml(r) {
  // In der Vorschau „wird/werden angelegt“, danach nur „angelegt“
  const will = (n, word) => (r.preview ? `${n === 1 ? 'wird' : 'werden'} ${word}` : word);
  const parts = [[r.created, 'neue Person', 'neue Personen', (n) => will(n, 'angelegt')], [r.updated, 'Person', 'Personen', (n) => will(n, 'geändert')],
    [r.unchanged, 'Person', 'Personen', () => 'unverändert'], [r.skipped, 'Zeile', 'Zeilen', () => 'übersprungen'], [r.errors, 'Zeile', 'Zeilen', () => 'fehlerhaft']]
    .filter(([n]) => n > 0).map(([n, one, many, verb]) => `${count(n, one, many)} ${verb(n)}`);
  const nothing = !r.created && !r.updated;
  const head = `<div class="note ${nothing ? 'warn' : 'info'}"><b>${r.preview ? 'Prüfung' : 'Import'}:</b> ${parts.join(' · ') || 'keine Personen gefunden'}${nothing && r.preview ? '. Nichts zu importieren.' : r.preview ? '. Fehlerhafte und übersprungene Zeilen werden nicht importiert.' : ''}</div>`;
  const ignored = r.ignored_columns.length ? `<p class="muted">Nicht erkannte Spalten werden ignoriert: ${esc(r.ignored_columns.join(', '))}</p>` : '';
  const problems = r.problems.length ? `<div class="person-record" style="max-height:220px;overflow:auto">${r.problems.map((p) => `<div class="list-item"><div class="grow"><b>Zeile ${p.line}</b>${p.name ? ` ${esc(p.name)}` : ''}<small>${p.kind === 'error' ? 'Fehler' : 'Übersprungen'}: ${esc(p.message)}</small></div></div>`).join('')}
    ${r.problems.length < r.errors + r.skipped ? `<p class="muted">… und ${r.errors + r.skipped - r.problems.length} weitere</p>` : ''}</div>` : '';
  return head + ignored + problems;
}
// CSV-Import in zwei Schritten: „Prüfen“ zeigt, was passieren würde, „Importieren“ schreibt genau diese Datei
export async function importPeople() {
  let checked = null;
  const done = openForm({
    title: 'Personen importieren', wide: true, submit: 'Prüfen',
    fields: [
      { type: 'html', html: `<p class="muted">CSV-Datei mit Kopfzeile, getrennt durch Semikolon, Komma oder Tab. Spalten wie beim CSV-Export: <b>Name</b> (Pflicht), Art (Mitarbeiter, Extern oder Familie), Funktion, Telefon, E-Mail, Aktiv (ja oder nein), Notiz. Zeilen <b>mit ID</b> ändern die vorhandene Person, Zeilen ohne ID legen eine neue an; gibt es den Namen schon, wird die Zeile übersprungen. Fehlende Spalten bleiben unverändert. Am einfachsten exportierst du die Liste, bearbeitest sie und liest sie wieder ein.</p>` },
      { name: 'file', label: 'CSV-Datei', type: 'file', accept: '.csv,.txt,text/csv', required: true, full: true },
      { type: 'html', html: '<div id="p-import-result"></div>' },
    ],
    onSubmit: async (_values, modal) => {
      const file = $('#f-file', modal).files[0];
      if (!file) throw new Error('Wähle eine CSV-Datei aus');
      const csv = await readCsvFile(file);
      const submit = $('button[type=submit]', modal);
      if (csv !== checked) {
        const r = await api.post('/people/import', { csv, preview: true });
        $('#p-import-result', modal).innerHTML = importResultHtml(r);
        checked = r.created || r.updated ? csv : null;
        submit.textContent = checked ? 'Importieren' : 'Prüfen';
        return false;
      }
      const r = await api.post('/people/import', { csv });
      toast(`Import: ${count(r.created, 'Person', 'Personen')} angelegt, ${r.updated} geändert${r.errors + r.skipped ? `, ${r.errors + r.skipped} Zeilen nicht übernommen` : ''}`);
      return true;
    },
  });
  // Neue Datei gewählt: erst wieder prüfen
  const modal = $('#modals .modal:last-child');
  $('#f-file', modal)?.addEventListener('change', () => { checked = null; $('button[type=submit]', modal).textContent = 'Prüfen'; $('#p-import-result', modal).innerHTML = ''; });
  return done;
}

const state = { q: '', only: '' };

const age = (birth) => {
  if (!birth) return '';
  const [y, m, d] = birth.split('-').map(Number);
  const now = new Date();
  return `${now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0)} Jahre`;
};
const warningTags = (list) => (list || []).map((w) => tag('bad', w)).join(' ');
// Foto mit Anmeldung holen und als data:-URL zeigen (die CSP erlaubt für Bilder nur eigene und data:-Adressen)
async function photoSrc(id) {
  if (photos.has(id)) return photos.get(id);
  const blob = await api.blob(`/people/${id}/photo`);
  const url = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
  photos.set(id, url);
  return url;
}
const areaSelect = (ctx) => (ctx.areas.length > 1
  ? `<select id="pf-area" aria-label="Bereich">${ctx.areas.map((a) => `<option value="${a.id}" ${a.id === ctx.area ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : '');
const areaName = (ctx) => ctx.areas.find((a) => a.id === ctx.area)?.name || 'Privat';
const areaQuery = (ctx) => (ctx.area ? `?team_id=${ctx.area}` : '');

export async function drawPeople(el, ctx, personId) {
  if (!can('person:read')) { el.innerHTML = '<div class="card"><p class="muted">Für Personenakten brauchst du zusätzlich das Recht „Personen lesen“.</p></div>'; return; }
  if (personId) return drawPerson(el, ctx, personId);
  const list = await api.get(`/person-files?${new URLSearchParams({ ...(ctx.area ? { team_id: ctx.area } : {}), ...(state.q ? { q: state.q } : {}), ...(state.only ? { only: state.only } : {}) })}`);
  el.innerHTML = `<div class="toolbar" style="gap:8px;flex-wrap:wrap">${areaSelect(ctx)}<input id="pf-q" type="search" class="search" placeholder="Name oder Alias…" aria-label="Personen suchen" value="${esc(state.q)}">
      <select id="pf-only" aria-label="Filter">${FILTERS.map(([v, l]) => `<option value="${v}" ${state.only === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="card"><div class="card-head"><h2>Personenakten · ${esc(areaName(ctx))}</h2><div class="row wrap">${can('person:export') ? '<button class="btn ghost sm" id="pf-csv">CSV-Export</button>' : ''}${can('person:create') ? '<button class="btn ghost sm" id="pf-import">CSV-Import</button><button class="btn ghost sm" id="pf-new">Neue Person</button>' : ''}</div></div>
      <p class="muted">Jede Person gibt es einmal für das ganze System: Mitarbeiter, Externe und Familie, auch ohne Zugang. Stammdaten sehen alle mit Zugriff auf Personen; was ${ctx.area ? 'diese Organisation' : 'du privat'} über sie weiß – Warnhinweise, Vermerke, medizinische Angaben, Akten und Fahndungen – steht in ihrer Personenakte.</p>
      ${list.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>Art, Funktion</th><th>Geboren</th><th>Hinweise</th><th>Akten</th><th>Vorstrafen</th>${can('key:read') ? '<th>Schlüssel</th>' : ''}<th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.aliases ? `<br><small class="muted">„${esc(p.aliases)}“</small>` : ''}${p.active ? '' : ` ${tag('', 'inaktiv')}`}</td>
        <td>${esc(PKIND[p.kind] || '')}${p.function ? `<br><small class="muted">${esc(p.function)}</small>` : ''}</td><td>${p.birth_date ? `${fdate(p.birth_date)}<br><small class="muted">${age(p.birth_date)}</small>` : '–'}</td>
        <td>${p.wanted ? tag('bad', 'Gesucht') : ''} ${warningTags(p.warnings)}</td><td>${p.files || '–'}</td><td>${p.convictions || '–'}</td>${can('key:read') ? `<td>${p.keys || '–'}</td>` : ''}
        <td><button class="btn ghost sm" data-pf-open="${p.id}">Öffnen</button></td></tr>`).join('')}</tbody></table></div>
        ${list.length >= 2000 ? '<p class="muted">Es werden die ersten 2.000 Personen gezeigt; grenze die Liste über Suche oder Filter ein.</p>' : ''}`
      : empty(state.q || state.only ? 'Keine passende Person.' : 'Noch keine Personen.')}</div>`;
  $('#pf-area', el)?.addEventListener('change', (e) => { ctx.area = e.target.value; drawPeople(el, ctx); });
  $('#pf-q', el).addEventListener('input', debounce(async (e) => { state.q = e.target.value.trim(); await drawPeople(el, ctx); const q = $('#pf-q', el); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }));
  $('#pf-only', el).addEventListener('change', (e) => { state.only = e.target.value; drawPeople(el, ctx); });
  el.onclick = async (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.pfOpen) { ctx.url(`#/casefiles?person=${b.dataset.pfOpen}&area=${ctx.area}`); await drawPerson(el, ctx, b.dataset.pfOpen); }
      else if (b.id === 'pf-new' && await formPerson(null)) await drawPeople(el, ctx);
      else if (b.id === 'pf-csv') await api.download('/people/export.csv', 'personen.csv');
      else if (b.id === 'pf-import' && await importPeople()) await drawPeople(el, ctx);
    } catch (error) { toast(error.message, true); }
  };
}

const dossierForm = (ctx, person, file) => {
  const chosen = file?.warnings || [];
  const options = [...new Set([...WARNINGS, ...chosen])].map((w) => ({ v: w, l: w }));
  return openForm({
    title: `Personenakte ${person.name} · ${areaName(ctx)}`,
    wide: true,
    fields: [
      { name: 'warnings', label: 'Warnhinweise', type: 'multi', options, value: chosen, full: true },
      { name: 'more', label: 'Weitere Warnhinweise (durch Komma getrennt)', maxlength: 400, full: true },
      { name: 'notes', label: 'Vermerke', type: 'textarea', rows: 6, value: file?.notes, maxlength: 20000, full: true, markdown: true },
      { type: 'html', html: '<h3>Medizinische Angaben</h3>' },
      { name: 'blood_type', label: 'Blutgruppe', type: 'select', options: BLOOD.map((b) => ({ v: b, l: b || '–' })), value: file?.blood_type || '' },
      { name: 'emergency_contact', label: 'Notfallkontakt', value: file?.emergency_contact, maxlength: 200 },
      { name: 'allergies', label: 'Allergien', value: file?.allergies, maxlength: 1000, full: true },
      { name: 'conditions', label: 'Vorerkrankungen', type: 'textarea', rows: 2, value: file?.conditions, maxlength: 2000, full: true },
      { name: 'medications', label: 'Medikamente', value: file?.medications, maxlength: 1000, full: true },
    ],
    onSubmit: async (v) => {
      const warnings = [...v.warnings, ...v.more.split(',').map((w) => w.trim()).filter(Boolean)];
      await api.put(`/person-files/${person.id}`, { team_id: ctx.area || null, warnings, notes: v.notes, blood_type: v.blood_type, emergency_contact: v.emergency_contact.trim(), allergies: v.allergies.trim(), conditions: v.conditions.trim(), medications: v.medications.trim() });
      toast('Personenakte gespeichert');
    },
  });
};

async function drawPerson(el, ctx, personId) {
  const r = await api.get(`/person-files/${personId}${areaQuery(ctx)}`);
  const p = r.person;
  const f = r.file;
  const write = r.level >= 3 && can('casefile:update');
  const activeWarrants = r.warrants.filter((x) => x.status === 'active');
  const fact = (label, value) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '');
  const section = (title, html, count) => `<div class="card"><div class="card-head"><h2>${title}</h2>${count !== undefined ? tag('', String(count)) : ''}</div>${html}</div>`;
  const fileLink = (id, number) => `<button class="link" data-open="${id}">${esc(number)}</button>`;
  const medical = f && (f.blood_type || f.allergies || f.conditions || f.medications || f.emergency_contact);
  el.innerHTML = `<div class="person-file">
    <div class="card person-head"><div class="person-photo" id="pf-photo">${p.has_photo ? '' : '<span>Kein Foto</span>'}</div>
      <div class="grow"><div class="card-head"><div><h2>${esc(p.name)}</h2>${p.aliases ? `<small class="muted">alias „${esc(p.aliases)}“</small>` : ''}</div>
        <div class="row wrap no-print">${areaSelect(ctx)}<button class="btn ghost sm" id="pf-back">Zurück</button><button class="btn ghost sm" id="pf-print">Drucken</button>
          ${can('person:update') ? `<button class="btn ghost sm" id="pf-person">Stammdaten</button><button class="btn ghost sm" id="pf-photo-set">Foto</button>${p.has_photo ? '<button class="btn ghost sm" id="pf-photo-del">Foto entfernen</button>' : ''}` : ''}
          ${can('person:delete') ? '<button class="btn ghost sm" id="pf-delete">Person löschen</button>' : ''}
          ${write ? '<button class="btn sm" id="pf-edit">Personenakte bearbeiten</button>' : ''}</div></div>
        <div class="row wrap">${activeWarrants.length ? tag('bad', `Gesucht: ${activeWarrants.map((x) => P.WARRANT_KIND[x.kind]).join(', ')}`) : ''} ${warningTags(f?.warnings)}${p.active ? '' : ` ${tag('', 'inaktiv')}`}</div>
        <dl class="case-meta">${fact('Geboren', p.birth_date && `${fdate(p.birth_date)} (${age(p.birth_date)})`)}${fact('Geschlecht', esc(p.gender))}${fact('Größe', p.height_cm && `${p.height_cm} cm`)}
          ${fact('Staatsangehörigkeit', esc(p.nationality))}${fact('Adresse', esc(p.address))}${fact('Telefon', esc(p.phone))}${fact('E-Mail', esc(p.email))}${fact('Art', esc(PKIND[p.kind] || ''))}${fact('Funktion', esc(p.function))}</dl>
        ${p.features ? `<p><b>Merkmale:</b> ${esc(p.features)}</p>` : ''}${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}</div></div>
    ${activeWarrants.length ? `<div class="note bad-note">${activeWarrants.map((x) => `<b>${P.WARRANT_KIND[x.kind]}</b> (${esc(x.file_number)}): ${esc(x.reason)}`).join('<br>')}</div>` : ''}
    <div class="grid cols-2">
      ${section(`Vermerke · ${esc(areaName(ctx))}`, f?.notes ? markdownBlock(f.notes) : `<p class="muted">${f ? 'Keine Vermerke.' : 'Für diesen Bereich gibt es noch keine Personenakte.'}</p>${f?.updated_by_name ? `<small class="muted">Zuletzt ${esc(f.updated_by_name)}, ${fdatetime(f.updated_at)}</small>` : ''}`)}
      ${section('Medizinische Angaben', medical ? `<dl class="case-meta">${fact('Blutgruppe', esc(f.blood_type))}${fact('Notfallkontakt', esc(f.emergency_contact))}${fact('Allergien', esc(f.allergies))}${fact('Vorerkrankungen', esc(f.conditions))}${fact('Medikamente', esc(f.medications))}</dl>` : '<p class="muted">Keine Angaben.</p>')}
    </div>
    ${section('Vorstrafen und Anklagepunkte', r.charges.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Akte</th><th>Tatbestand</th><th>Anzahl</th><th>Geldstrafe</th><th>Haft</th><th>Status</th></tr></thead><tbody>
      ${r.charges.map((c) => `<tr><td>${fileLink(c.case_file_id, c.file_number)}</td><td><b>${esc(c.code)}</b> ${esc(c.title)}</td><td>${c.count}×</td><td>${eur(Number(c.fine) * c.count)}</td><td>${P.jailText(c.jail * c.count)}</td><td>${P.st(P.CHARGE_STATUS, c.status)}${c.decided_at ? ` <small class="muted">${fdate(c.decided_at)}</small>` : ''}</td></tr>`).join('')}
      </tbody></table></div><p class="case-sums"><b>Verurteilt: ${r.totals.convictions} · ${eur(r.totals.fine)} · ${P.jailText(r.totals.jail)}${r.totals.points ? ` · ${r.totals.points} Punkte` : ''}</b></p>` : empty('Keine Anklagepunkte.'), r.totals.convictions)}
    ${section('Fallakten', r.case_files.length ? r.case_files.map((c) => `<div class="list-item"><div class="grow"><div class="row wrap">${fileLink(c.id, c.file_number)} ${esc(c.title)} ${tag(...CASE_STATUS[c.status])}${c.priority !== 'normal' ? P.st(P.PRIORITY, c.priority) : ''}</div>
      <small>${esc(c.role || 'ohne Rolle')}${c.type_name ? ` · ${esc(c.type_name)}` : ''} · eröffnet ${fdate(c.opened_on)}</small></div></div>`).join('') : empty('An keiner Akte beteiligt.'), r.case_files.length)}
    ${section('Fahndungen', r.warrants.length ? r.warrants.map((x) => P.warrantItem({ ...x, person_name: p.name }, { w: false, m: false, file: true })).join('') : empty('Keine Fahndungen.'), activeWarrants.length)}
    <div class="grid cols-2">
      ${section('Berichte', r.reports.length ? r.reports.map((x) => `<div class="list-item"><div class="grow">${fileLink(x.case_file_id, `${x.file_number} · B-${x.number}`)} ${esc(x.title)} ${P.st(P.REPORT_STATUS, x.status)}<small>${esc(x.kind || '')}${x.occurred_at ? ` · ${fdatetime(x.occurred_at)}` : ''}</small></div></div>`).join('') : empty('Keine Berichte über die Person.'), r.reports.length)}
      ${section('Beweismittel', r.evidence.length ? r.evidence.map((x) => `<div class="list-item"><div class="grow">${fileLink(x.case_file_id, `${x.file_number} · A-${x.number}`)} ${esc(x.description)} ${P.st(P.EVIDENCE_STATUS, x.status)}</div></div>`).join('') : empty('Keine Beweismittel.'), r.evidence.length)}
      ${r.owned_vehicles ? section('Fahrzeuge (Besitzer)', r.owned_vehicles.length ? r.owned_vehicles.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.plate)}</b> ${esc(x.make_model)}<small>${VEHICLE_STATUS[x.status] || ''} · aus der Fahrzeugverwaltung</small></div></div>`).join('') : empty('Keine Fahrzeuge in diesem Bereich.'), r.owned_vehicles.length) : ''}
      ${r.keys ? section('Schlüssel', r.keys.length ? r.keys.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.label)}</b> ${esc(x.code)} · Kopie ${x.copy_no}<small>${esc(x.object_name || '–')} · ausgegeben ${fdate(x.issued_at)}${x.due_at ? ` · Rückgabe bis ${fdate(x.due_at)}` : ''}${x.receipt_signed ? ' · quittiert' : ''}</small></div>${x.lost_at ? tag('bad', 'Verloren') : x.due_at && String(x.due_at).slice(0, 10) < new Date().toLocaleDateString('sv-SE') ? tag('bad', 'Überfällig') : ''}</div>`).join('') : empty('Keine Schlüssel in diesem Bereich.'), r.keys.length) : ''}
      ${section('Fahrzeuge in Akten (Halter)', r.vehicles.length ? r.vehicles.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.plate || '–')}</b> ${esc(x.description)}${x.role ? ` ${tag('', x.role)}` : ''}<small>${fileLink(x.case_file_id, x.file_number)}</small></div></div>`).join('') : empty('Keine Fahrzeuge in Akten.'), r.vehicles.length)}
      ${section('Einträge zur Person', r.entries.length ? r.entries.map((x) => `<div class="list-item"><div class="grow"><b>${fdate(x.entry_date)}</b> ${esc(x.kind || 'Eintrag')} · ${fileLink(x.case_file_id, x.file_number)}<small>${esc(x.body.length > 160 ? `${x.body.slice(0, 160)}…` : x.body)}</small></div></div>`).join('') : empty('Keine Einträge.'), r.entries.length)}
      ${r.licenses ? section('Lizenzen', r.licenses.length ? r.licenses.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.type_name)}</b>${x.number ? ` ${esc(x.number)}` : ''}<small>${LICENSE_STATUS[x.status]} · ${x.valid_until ? `gültig bis ${fdate(x.valid_until)}` : 'unbefristet'}${x.status_reason ? ` · ${esc(x.status_reason)}` : ''}</small></div></div>`).join('') : empty('Keine Lizenzen in diesem Bereich.')) : ''}
      ${r.trainings ? section('Schulungen', r.trainings.length ? r.trainings.map((x) => `<div class="list-item"><div class="grow"><b>${esc(x.training_name)}</b><small>${TRAINING_RESULT[x.result]}${x.completed_on ? ` am ${fdate(x.completed_on)}` : ''}${x.valid_until ? ` · gültig bis ${fdate(x.valid_until)}` : ''}</small></div></div>`).join('') : empty('Keine Schulungen in diesem Bereich.')) : ''}
    </div></div>`;
  if (p.has_photo) photoSrc(p.id).then((src) => { const box = $('#pf-photo', el); if (box) box.innerHTML = `<img src="${src}" alt="Foto von ${esc(p.name)}">`; }).catch(() => {});
  $('#pf-area', el)?.addEventListener('change', (e) => { ctx.area = e.target.value; ctx.url(`#/casefiles?person=${p.id}&area=${ctx.area}`); drawPerson(el, ctx, p.id); });
  el.onclick = async (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    try {
      let changed = false;
      if (b.id === 'pf-back') { ctx.url('#/casefiles?tab=people'); await drawPeople(el, ctx); return; }
      if (b.id === 'pf-print') { printArea($('.person-file', el)); return; }
      if (b.id === 'pf-edit') changed = await dossierForm(ctx, p, f);
      else if (b.id === 'pf-person') changed = await formPerson(p);
      else if (b.id === 'pf-photo-set') changed = await photoForm(p);
      else if (b.id === 'pf-photo-del' && await confirmBox('Foto entfernen', 'Das Foto wird für alle Bereiche gelöscht.', 'Entfernen')) { await api.del(`/people/${p.id}/photo`); changed = true; }
      else if (b.id === 'pf-delete' && await confirmBox('Person löschen', `${p.name} wird für das ganze System gelöscht, mit Foto und Stammdaten. Hat die Person noch Schlüssel, Akten, Lizenzen, Schulungsnachweise oder Fahrzeuge, geht das nicht; setze sie dann über „Stammdaten“ auf inaktiv.`)) {
        await api.del(`/people/${p.id}`);
        photos.delete(p.id);
        toast('Person gelöscht');
        ctx.url('#/casefiles?tab=people');
        await drawPeople(el, ctx);
        return;
      }
      if (changed) { photos.delete(p.id); await drawPerson(el, ctx, p.id); }
    } catch (error) { toast(error.message, true); }
  };
}

function photoForm(person) {
  return openForm({
    title: `Foto von ${person.name}`,
    fields: [
      { name: 'photo', label: 'Bild (PNG oder JPEG)', type: 'file', accept: 'image/png,image/jpeg', required: true, full: true },
      { type: 'html', html: '<p class="muted">Das Foto gehört zu den Stammdaten und ist für alle mit Zugriff auf Personen sichtbar.</p>' },
    ],
    onSubmit: async (_values, modal) => {
      const file = $('#f-photo', modal).files[0];
      if (!file) throw new Error('Wähle ein Bild aus');
      const form = new FormData();
      form.append('file', file);
      await api.post(`/people/${person.id}/photo`, form);
      toast('Foto gespeichert');
    },
  });
}
