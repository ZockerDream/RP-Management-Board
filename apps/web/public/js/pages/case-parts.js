// Bausteine einer Fallakte: Berichte, Anklagepunkte, Beweismittel, Fahndungen, Fahrzeuge und verknüpfte Akten.
// Jede Funktion *Html zeichnet einen Abschnitt, jede *Form öffnet einen Dialog und liefert true, wenn gespeichert wurde.
import { api } from '../api.js';
import { $, esc, eur, fdate, fdatetime, tag, openForm, toast, todayStr, empty } from '../ui.js';
import { can } from '../app.js';
import { markdownBlock } from '../markdown.js';

export const CASE_STATUS = { open: ['ok', 'Offen'], dormant: ['warn', 'Ruhend'], closed: ['', 'Abgeschlossen'] };
export const PRIORITY = { urgent: ['bad', 'Dringend'], high: ['warn', 'Hoch'], normal: ['', 'Normal'], low: ['', 'Niedrig'] };
export const REPORT_STATUS = { draft: ['', 'Entwurf'], submitted: ['warn', 'Wartet auf Freigabe'], approved: ['ok', 'Freigegeben'] };
export const CHARGE_STATUS = { open: ['warn', 'Offen'], convicted: ['bad', 'Verurteilt'], dropped: ['', 'Eingestellt'], acquitted: ['ok', 'Freigesprochen'] };
export const EVIDENCE_STATUS = { secured: ['warn', 'Sichergestellt'], analysis: ['warn', 'In Untersuchung'], stored: ['ok', 'Eingelagert'], released: ['', 'Herausgegeben'], destroyed: ['', 'Vernichtet'] };
export const WARRANT_KIND = { arrest: 'Haftbefehl', search: 'Durchsuchungsbeschluss', wanted: 'Fahndung (Aufenthalt)', vehicle: 'Fahrzeugfahndung' };
export const WARRANT_STATUS = { active: ['bad', 'Aktiv'], executed: ['ok', 'Vollstreckt'], revoked: ['', 'Aufgehoben'] };
export const ROLE_SUGGESTIONS = ['Beschuldigte/r', 'Tatverdächtige/r', 'Zeuge/Zeugin', 'Geschädigte/r', 'Opfer', 'Anzeigeerstatter/in', 'Hinweisgeber/in', 'Festgenommene/r', 'Patient/in', 'Angehörige/r', 'Ersthelfer/in'];
const EVIDENCE_KINDS = ['Waffe', 'Munition', 'Betäubungsmittel', 'Bargeld', 'Dokument', 'Datenträger', 'Handy', 'Spur', 'Kleidung', 'Fahrzeugteil', 'Werkzeug'];
const EVIDENCE_ACTIONS = ['Übergabe an Labor', 'Entnahme zur Untersuchung', 'Rückgabe ins Lager', 'Herausgabe an Eigentümer', 'Vorlage bei Gericht'];
const VEHICLE_ROLES = ['Tatfahrzeug', 'Fluchtfahrzeug', 'Unfallbeteiligt', 'Sichergestellt', 'Gestohlen', 'Zeugenfahrzeug'];

export const st = (map, key) => tag(...(map[key] || ['', key]));
export const jailText = (n) => (n ? `${Number(n).toLocaleString('de-DE')} HE` : '–');
const options = (map) => Object.entries(map).map(([v, x]) => ({ v, l: Array.isArray(x) ? x[1] : x }));
// datetime-local arbeitet in Ortszeit, die API mit ISO-Zeit samt Zone
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);
const involved = (f) => f.people.filter((p) => p.name).map((p) => ({ v: p.person_id, l: `${p.name}${p.role ? ` (${p.role})` : ''}` }));
const needPeople = (f) => {
  if (involved(f).length) return true;
  toast('Beteilige zuerst unter „Übersicht“ die Personen an der Akte', true);
  return false;
};
const lastModal = () => $('#modals .modal:last-child');

// ---------- Berichte
export function reportsHtml(f, { w, m, me, owner }) {
  const head = `<div class="card-head"><h2>Berichte</h2>${w ? '<button class="btn ghost sm" id="r-new">Neuer Bericht</button>' : ''}</div>`;
  if (!f.reports.length) return `<div class="card">${head}${empty('Noch keine Berichte. Fertige Vorlagen gibt es unter „Berichtsvorlagen“.')}</div>`;
  return `<div class="card">${head}${f.reports.map((r) => {
    const own = r.author_id === me;
    const buttons = [
      r.status === 'draft' && w && (own || m) ? `<button class="btn ghost sm" data-r-edit="${r.id}">Bearbeiten</button>` : '',
      r.status === 'draft' && w && own ? `<button class="btn sm" data-r-submit="${r.id}">${f.team_id ? 'Einreichen' : 'Abschließen'}</button>` : '',
      r.status === 'submitted' && m && (!own || owner) ? `<button class="btn sm" data-r-approve="${r.id}">Freigeben</button>` : '',
      r.status === 'submitted' && m ? `<button class="btn ghost sm" data-r-return="${r.id}">Zurückgeben</button>` : '',
      r.status === 'approved' && w ? `<button class="btn ghost sm" data-r-amend="${r.id}">Nachtrag</button>` : '',
      `<button class="btn ghost sm" data-r-print="${r.id}">Drucken</button>`,
      (r.status === 'draft' && w && (own || m)) || (r.status === 'submitted' && m) ? `<button class="btn ghost sm" data-r-del="${r.id}">Löschen</button>` : '',
    ].join('');
    const meta = [esc(r.author_name || '–'), r.occurred_at && `Zeitpunkt ${fdatetime(r.occurred_at)}`, r.submitted_at && `eingereicht ${fdatetime(r.submitted_at)}`,
      r.approved_at && `freigegeben von ${esc(r.approved_by_name || '–')}, ${fdatetime(r.approved_at)}`, r.amends_number && `Nachtrag zu B-${r.amends_number}`,
      r.people.length && `betrifft ${r.people.map((p) => esc(p.name)).join(', ')}`].filter(Boolean).join(' · ');
    return `<article class="case-report" data-report="${r.id}"><div class="row wrap"><b>B-${r.number}</b><span>${esc(r.title)}</span>${st(REPORT_STATUS, r.status)}${r.kind ? tag('', r.kind) : ''}<span class="grow"></span>${buttons}</div>
      <small class="muted">${meta}</small>
      ${r.review_note && r.status === 'draft' ? `<div class="note">Zurückgegeben: ${esc(r.review_note)}</div>` : ''}
      <details ${r.status === 'approved' ? '' : 'open'}><summary>Bericht lesen</summary>${r.body.trim() ? markdownBlock(r.body) : '<p class="muted">Noch kein Text.</p>'}</details></article>`;
  }).join('')}</div>`;
}

export async function reportForm(f, report, amends) {
  const templates = report ? [] : (await api.get('/report-templates')).filter((t) => (f.team_id ? t.team_id === f.team_id : !t.team_id));
  const people = involved(f);
  const done = openForm({
    title: report ? `Bericht B-${report.number} bearbeiten` : amends ? `Nachtrag zu B-${amends.number}` : 'Neuer Bericht',
    wide: true,
    fields: [
      ...(templates.length ? [{ name: 'template', label: 'Vorlage', type: 'select', options: [{ v: '', l: '– Ohne Vorlage –' }, ...templates.map((t) => ({ v: t.id, l: t.name }))], full: true }] : []),
      { name: 'title', label: 'Titel', value: report?.title ?? (amends ? `Nachtrag zu „${amends.title}“` : ''), required: true, maxlength: 200 },
      { name: 'kind', label: 'Art', value: report?.kind ?? (amends ? 'Nachtrag' : ''), maxlength: 100, suggestions: templates.map((t) => t.name), placeholder: 'z. B. Einsatzbericht' },
      { name: 'occurred_at', label: 'Zeitpunkt des Geschehens', type: 'datetime-local', value: toLocalInput(report?.occurred_at) },
      ...(people.length ? [{ name: 'person_ids', label: 'Betrifft Personen', type: 'multi', options: people, value: report?.people.map((p) => p.id) || [] }] : []),
      { name: 'body', label: 'Bericht', type: 'textarea', rows: 16, value: report?.body ?? '', maxlength: 50000, full: true, markdown: true },
    ],
    onSubmit: async (v) => {
      const body = { title: v.title.trim(), kind: v.kind.trim(), occurred_at: fromLocalInput(v.occurred_at), person_ids: v.person_ids || [], body: v.body };
      if (report) await api.patch(`/case-file-reports/${report.id}`, body);
      else await api.post(`/case-files/${f.id}/reports`, { ...body, amends_report_id: amends?.id || null });
      toast('Bericht gespeichert');
    },
  });
  // Vorlage übernehmen: Art, Titel und Text; eigener Text wird nur ersetzt, solange er noch der Vorlagentext ist
  const modal = lastModal();
  let applied = '';
  $('#f-template', modal)?.addEventListener('change', (event) => {
    const t = templates.find((x) => x.id === event.target.value);
    if (!t) return;
    const text = $('#f-body', modal);
    $('#f-kind', modal).value = t.name;
    if (!$('#f-title', modal).value.trim()) $('#f-title', modal).value = t.name;
    if (text.value.trim() && text.value !== applied) { toast('Dein Text bleibt – leere das Feld, um die Vorlage zu übernehmen'); return; }
    text.value = t.body;
    applied = t.body;
    text.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return done;
}

export const reviewForm = (report) => openForm({
  title: `B-${report.number} zurückgeben`,
  fields: [{ name: 'note', label: 'Was fehlt oder ist zu ändern?', type: 'textarea', rows: 4, maxlength: 2000, required: true, full: true }],
  submit: 'Zurückgeben',
  onSubmit: (v) => api.post(`/case-file-reports/${report.id}/review`, { decision: 'return', note: v.note.trim() }),
});

// ---------- Anklagepunkte, je Person mit Summen
const chargeSum = (list) => ({
  fine: list.reduce((s, c) => s + Number(c.fine) * c.count, 0), jail: list.reduce((s, c) => s + c.jail * c.count, 0), points: list.reduce((s, c) => s + c.points * c.count, 0),
});
export function chargesHtml(f, { w, m }) {
  const head = `<div class="card-head"><h2>Anklagepunkte</h2>${w ? '<button class="btn ghost sm" id="ch-new">Anklagepunkt</button>' : ''}</div>`;
  if (!f.charges.length) return `<div class="card">${head}${empty('Noch keine Anklagepunkte. Tatbestände kommen aus dem Strafkatalog oder werden frei erfasst.')}</div>`;
  const people = [...new Map(f.charges.map((c) => [c.person_id, c.person_name])).entries()];
  return `<div class="card">${head}${people.map(([personId, name]) => {
    const list = f.charges.filter((c) => c.person_id === personId);
    const open = chargeSum(list.filter((c) => c.status === 'open'));
    const convicted = chargeSum(list.filter((c) => c.status === 'convicted'));
    const sum = (s) => [eur(s.fine), s.jail && jailText(s.jail), s.points && `${s.points} Punkte`].filter(Boolean).join(' · ');
    return `<h3>${esc(name)}</h3><div class="scroll-x"><table class="table"><thead><tr><th>Paragraph</th><th>Tatbestand</th><th>Anzahl</th><th>Geldstrafe</th><th>Haft</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.title)}${c.note ? `<br><small class="muted">${esc(c.note)}</small>` : ''}</td><td>${c.count}×</td>
        <td>${eur(Number(c.fine) * c.count)}</td><td>${jailText(c.jail * c.count)}${c.points ? `<br><small class="muted">${c.points * c.count} Punkte</small>` : ''}</td>
        <td>${st(CHARGE_STATUS, c.status)}${c.decided_by_name ? `<br><small class="muted">${esc(c.decided_by_name)}, ${fdate(c.decided_at)}</small>` : ''}</td>
        <td style="white-space:nowrap">${c.status === 'open' && w ? `<button class="btn ghost sm" data-ch-edit="${c.id}">Bearbeiten</button>` : ''}${m ? ` <button class="btn ghost sm" data-ch-decide="${c.id}">Entscheiden</button>` : ''}${(c.status === 'open' && w) || m ? ` <button class="btn ghost sm" data-ch-del="${c.id}">Löschen</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div><p class="muted case-sums">${open.fine || open.jail ? `Offen: ${sum(open)}` : ''}${(open.fine || open.jail) && (convicted.fine || convicted.jail) ? ' · ' : ''}${convicted.fine || convicted.jail ? `<b>Verurteilt: ${sum(convicted)}</b>` : ''}</p>`;
  }).join('')}</div>`;
}

export async function chargeForm(f, charge) {
  if (charge) {
    return openForm({
      title: `${charge.code} · ${charge.title}`,
      fields: [
        { name: 'count', label: 'Anzahl', type: 'number', min: 1, max: 99, value: charge.count, required: true },
        { name: 'fine', label: 'Geldstrafe je Fall', value: String(charge.fine).replace('.', ','), required: true },
        { name: 'jail', label: 'Haft je Fall (HE)', type: 'number', min: 0, value: charge.jail },
        { name: 'points', label: 'Punkte je Fall', type: 'number', min: 0, max: 100, value: charge.points },
        { name: 'note', label: 'Notiz', type: 'textarea', rows: 2, value: charge.note, maxlength: 2000, full: true },
      ],
      onSubmit: (v) => api.patch(`/case-file-charges/${charge.id}`, { count: Number(v.count), fine: v.fine.trim(), jail: Number(v.jail) || 0, points: Number(v.points) || 0, note: v.note }),
    });
  }
  if (!needPeople(f)) return false;
  const codes = (await api.get(`/penal-codes${f.team_id ? `?team_id=${f.team_id}` : '?private=1'}`)).filter((c) => c.active);
  const done = openForm({
    title: 'Anklagepunkt erfassen',
    wide: true,
    fields: [
      { name: 'person_id', label: 'Gegen', type: 'select', options: involved(f), required: true },
      { name: 'penal_code_id', label: 'Tatbestand aus dem Strafkatalog', type: 'select', full: true,
        options: [{ v: '', l: codes.length ? '– Frei eingeben –' : '– Strafkatalog ist leer, frei eingeben –' }, ...codes.map((c) => ({ v: c.id, l: `${c.code} ${c.title} · ${eur(c.fine)}${c.jail ? ` · ${c.jail} HE` : ''}` }))] },
      { name: 'code', label: 'Paragraph (frei)', maxlength: 40, placeholder: 'z. B. § 123' },
      { name: 'title', label: 'Bezeichnung (frei)', maxlength: 200 },
      { name: 'fine', label: 'Geldstrafe (frei)', placeholder: '0,00' },
      { name: 'jail', label: 'Haft in HE (frei)', type: 'number', min: 0, value: '' },
      { name: 'count', label: 'Anzahl', type: 'number', min: 1, max: 99, value: 1, required: true },
      { name: 'note', label: 'Notiz', type: 'textarea', rows: 2, maxlength: 2000, full: true },
    ],
    onSubmit: async (v) => {
      const body = { person_id: v.person_id, count: Number(v.count) || 1, note: v.note };
      if (v.penal_code_id) body.penal_code_id = v.penal_code_id;
      else Object.assign(body, { code: v.code.trim(), title: v.title.trim(), fine: v.fine.trim() || '0', jail: Number(v.jail) || 0 });
      await api.post(`/case-files/${f.id}/charges`, body);
      toast('Anklagepunkt erfasst');
    },
  });
  // Freie Felder nur, wenn kein Tatbestand gewählt ist
  const modal = lastModal();
  const select = $('#f-penal_code_id', modal);
  const sync = () => ['code', 'title', 'fine', 'jail'].forEach((n) => { $(`#f-${n}`, modal).closest('label').hidden = !!select.value; });
  select?.addEventListener('change', sync);
  if (select) sync();
  return done;
}

export const decisionForm = (charge) => openForm({
  title: `Entscheidung: ${charge.code} ${charge.title}`,
  fields: [
    { name: 'status', label: 'Ergebnis', type: 'select', options: options(CHARGE_STATUS), value: charge.status === 'open' ? 'convicted' : charge.status },
    { name: 'note', label: 'Begründung oder Aktenzeichen des Urteils', type: 'textarea', rows: 3, value: charge.note, maxlength: 2000, full: true },
  ],
  onSubmit: (v) => api.post(`/case-file-charges/${charge.id}/decision`, { status: v.status, note: v.note }),
});

// ---------- Beweismittel mit Übergabekette
export function evidenceHtml(f, { w, m }) {
  const head = `<div class="card-head"><h2>Beweismittel</h2>${w ? '<button class="btn ghost sm" id="ev-new">Beweismittel sichern</button>' : ''}</div>`;
  if (!f.evidence.length) return `<div class="card">${head}${empty('Noch keine Beweismittel gesichert.')}</div>`;
  return `<div class="card">${head}${f.evidence.map((e) => `<div class="case-evidence"><div class="row wrap"><b>A-${e.number}</b><span>${esc(e.description)}</span>${e.kind ? tag('', e.kind) : ''}${st(EVIDENCE_STATUS, e.status)}<span class="grow"></span>
      ${w ? `<button class="btn ghost sm" data-ev-log="${e.id}">Vorgang</button><button class="btn ghost sm" data-ev-edit="${e.id}">Bearbeiten</button>` : ''}${m ? `<button class="btn ghost sm" data-ev-del="${e.id}">Löschen</button>` : ''}</div>
      <small class="muted">${[e.storage && `Lagerort: ${esc(e.storage)}`, e.found_where && `Fundort: ${esc(e.found_where)}`, e.found_at && fdatetime(e.found_at), e.person_name && `Person: ${esc(e.person_name)}`].filter(Boolean).join(' · ') || '–'}</small>
      ${e.note ? `<p class="small">${esc(e.note)}</p>` : ''}
      <details><summary>Übergabekette (${e.log.length})</summary><ol class="case-log">${e.log.map((l) => `<li><b>${esc(l.action)}</b> · ${fdatetime(l.at)} · ${esc(l.user_name || '–')}${l.note ? `<br><small class="muted">${esc(l.note)}</small>` : ''}</li>`).join('')}</ol></details></div>`).join('')}</div>`;
}

export function evidenceForm(f, e) {
  return openForm({
    title: e ? `A-${e.number} bearbeiten` : 'Beweismittel sichern',
    wide: true,
    fields: [
      { name: 'description', label: 'Beschreibung', value: e?.description, required: true, maxlength: 500, full: true, placeholder: 'z. B. Pistole, Kaliber 9 mm, Seriennummer …' },
      { name: 'kind', label: 'Art', value: e?.kind, maxlength: 60, suggestions: EVIDENCE_KINDS },
      { name: 'person_id', label: 'Gehört zu Person', type: 'select', options: [{ v: '', l: '–' }, ...involved(f)], value: e?.person_id || '' },
      { name: 'found_where', label: 'Fundort', value: e?.found_where, maxlength: 200 },
      { name: 'found_at', label: 'Fundzeit', type: 'datetime-local', value: toLocalInput(e?.found_at) },
      { name: 'storage', label: 'Lagerort', value: e?.storage, maxlength: 200, placeholder: 'z. B. Asservatenkammer Fach 3' },
      { name: 'note', label: 'Notiz', type: 'textarea', rows: 3, value: e?.note, maxlength: 2000, full: true },
    ],
    onSubmit: async (v) => {
      const body = { description: v.description.trim(), kind: v.kind.trim(), person_id: v.person_id || null, found_where: v.found_where.trim(), found_at: fromLocalInput(v.found_at), storage: v.storage.trim(), note: v.note };
      if (e) await api.patch(`/case-file-evidence/${e.id}`, body);
      else toast(`Beweismittel A-${(await api.post(`/case-files/${f.id}/evidence`, body)).number} gesichert`);
    },
  });
}

export const evidenceLogForm = (e) => openForm({
  title: `A-${e.number}: Vorgang festhalten`,
  fields: [
    { name: 'status', label: 'Status', type: 'select', options: options(EVIDENCE_STATUS), value: e.status },
    { name: 'action', label: 'Vorgang', maxlength: 60, suggestions: EVIDENCE_ACTIONS, placeholder: 'z. B. Übergabe an Labor' },
    { name: 'note', label: 'Notiz (an wen, warum)', type: 'textarea', rows: 2, maxlength: 500, full: true },
  ],
  onSubmit: (v) => api.post(`/case-file-evidence/${e.id}/log`, { status: v.status, action: v.action.trim(), note: v.note.trim() }),
});

// ---------- Fahndungen
export function warrantsHtml(f, { w, m }) {
  const head = `<div class="card-head"><h2>Fahndungen</h2>${w ? '<button class="btn ghost sm" id="wa-new">Fahndung ausschreiben</button>' : ''}</div>`;
  if (!f.warrants.length) return `<div class="card">${head}${empty('Keine Haftbefehle oder Fahndungen.')}</div>`;
  return `<div class="card">${head}${f.warrants.map((x) => warrantItem(x, { w, m })).join('')}</div>`;
}
export const warrantExpired = (x) => x.status === 'active' && x.valid_until && x.valid_until < todayStr();
export function warrantItem(x, { w, m, file = false }) {
  const target = x.kind === 'vehicle' ? `Kennzeichen <b>${esc(x.plate)}</b>${x.person_name ? ` · Halter ${esc(x.person_name)}` : ''}` : `<b>${esc(x.person_name || '–')}</b>`;
  const buttons = [
    x.status === 'active' && w ? `<button class="btn ghost sm" data-wa-close="${x.id}" data-status="executed">Vollstreckt</button><button class="btn ghost sm" data-wa-close="${x.id}" data-status="revoked">Aufheben</button>` : '',
    x.status !== 'active' && w ? `<button class="btn ghost sm" data-wa-close="${x.id}" data-status="active">Wieder aktiv</button>` : '',
    m && !file ? `<button class="btn ghost sm" data-wa-del="${x.id}">Löschen</button>` : '',
  ].join('');
  return `<div class="list-item case-warrant ${x.status === 'active' ? 'active' : ''}"><div class="grow"><div class="row wrap">${tag(x.kind === 'arrest' ? 'bad' : 'warn', WARRANT_KIND[x.kind])}${target}${st(WARRANT_STATUS, x.status)}${warrantExpired(x) ? tag('warn', 'Abgelaufen') : ''}${file ? ` <button class="link" data-open="${x.case_file_id}">${esc(x.file_number)}</button>` : ''}</div>
    <small>${esc(x.reason)}</small><small class="muted">ausgestellt ${fdate(x.issued_on)}${x.valid_until ? ` · gültig bis ${fdate(x.valid_until)}` : ''}${x.created_by_name ? ` · ${esc(x.created_by_name)}` : ''}${x.close_note ? ` · ${esc(x.close_note)}` : ''}</small></div>${buttons}</div>`;
}

export async function warrantForm(f) {
  const done = openForm({
    title: 'Fahndung ausschreiben',
    wide: true,
    fields: [
      { name: 'kind', label: 'Art', type: 'select', options: options(WARRANT_KIND), value: 'arrest' },
      { name: 'person_id', label: 'Gesuchte Person', type: 'select', options: [{ v: '', l: '–' }, ...involved(f)] },
      { name: 'plate', label: 'Kennzeichen', maxlength: 20, placeholder: 'nur bei Fahrzeugfahndung' },
      { name: 'issued_on', label: 'Ausgestellt am', type: 'date', value: todayStr(), required: true },
      { name: 'valid_until', label: 'Gültig bis', type: 'date', help: 'Leer heißt unbefristet.' },
      { name: 'reason', label: 'Grund', type: 'textarea', rows: 3, maxlength: 2000, required: true, full: true },
    ],
    onSubmit: async (v) => {
      await api.post(`/case-files/${f.id}/warrants`, { kind: v.kind, person_id: v.person_id || null, plate: v.plate.trim(), issued_on: v.issued_on, valid_until: v.valid_until || null, reason: v.reason.trim() });
      toast('Fahndung ausgeschrieben');
    },
  });
  const modal = lastModal();
  const kind = $('#f-kind', modal);
  const sync = () => { $('#f-plate', modal).closest('label').hidden = kind.value !== 'vehicle'; };
  kind.addEventListener('change', sync);
  sync();
  return done;
}

export const warrantCloseForm = (x, status) => (status === 'active'
  ? api.post(`/warrants/${x.id}/close`, { status: 'active' }).then(() => true)
  : openForm({
    title: `${WARRANT_KIND[x.kind]} ${status === 'executed' ? 'vollstreckt' : 'aufheben'}`,
    fields: [{ name: 'note', label: status === 'executed' ? 'Wann, wo, durch wen?' : 'Grund der Aufhebung', maxlength: 500, full: true }],
    submit: status === 'executed' ? 'Vollstreckt' : 'Aufheben',
    onSubmit: (v) => api.post(`/warrants/${x.id}/close`, { status, note: v.note.trim() }),
  }));

// ---------- Fahrzeuge und verknüpfte Akten (Übersicht)
export function vehiclesHtml(f, { w }) {
  return `<div class="card"><div class="card-head"><h2>Fahrzeuge</h2>${w ? '<button class="btn ghost sm" id="ve-new">Fahrzeug</button>' : ''}</div>
    ${f.vehicles.length ? f.vehicles.map((v) => `<div class="list-item"><div class="grow"><b>${esc(v.plate || 'ohne Kennzeichen')}</b> ${esc(v.description)}${v.role ? ` ${tag('', v.role)}` : ''}
      <small>${v.owner_name ? `Halter: ${esc(v.owner_name)}` : ''}${v.note ? `${v.owner_name ? ' · ' : ''}${esc(v.note)}` : ''}</small></div>
      ${w ? `<button class="btn ghost sm" data-ve-edit="${v.id}">Bearbeiten</button><button class="btn ghost sm" data-ve-del="${v.id}">Entfernen</button>` : ''}</div>`).join('') : empty('Keine Fahrzeuge erfasst.')}</div>`;
}
export async function vehicleForm(f, v) {
  const people = can('person:read') ? (await api.get('/people')).filter((p) => p.active || p.id === v?.owner_person_id).map((p) => ({ v: p.id, l: p.name })) : involved(f);
  return openForm({
    title: v ? 'Fahrzeug bearbeiten' : 'Fahrzeug erfassen',
    fields: [
      { name: 'plate', label: 'Kennzeichen', value: v?.plate, maxlength: 20 },
      { name: 'description', label: 'Marke, Modell, Farbe', value: v?.description, maxlength: 200 },
      { name: 'role', label: 'Rolle in der Akte', value: v?.role, maxlength: 60, suggestions: VEHICLE_ROLES },
      { name: 'owner_person_id', label: 'Halter', type: 'select', options: [{ v: '', l: '–' }, ...people], value: v?.owner_person_id || '' },
      { name: 'note', label: 'Notiz', type: 'textarea', rows: 2, value: v?.note, maxlength: 1000, full: true },
    ],
    onSubmit: async (x) => {
      const body = { plate: x.plate.trim(), description: x.description.trim(), role: x.role.trim(), owner_person_id: x.owner_person_id || null, note: x.note };
      if (v) await api.patch(`/case-file-vehicles/${v.id}`, body);
      else await api.post(`/case-files/${f.id}/vehicles`, body);
    },
  });
}

export function linksHtml(f, { w }) {
  return `<div class="card"><div class="card-head"><h2>Verknüpfte Akten</h2>${w ? '<button class="btn ghost sm" id="li-new">Verknüpfen</button>' : ''}</div>
    ${f.links.length ? f.links.map((l) => `<div class="list-item"><div class="grow"><button class="link" data-open="${l.id}"><b>${esc(l.file_number)}</b> ${esc(l.title)}</button>
      <small>${l.note ? esc(l.note) : ''}</small></div>${w ? `<button class="btn ghost sm" data-li-del="${l.id}">Lösen</button>` : ''}</div>`).join('') : empty('Keine verknüpften Akten.')}</div>`;
}
export async function linkForm(f) {
  const files = (await api.get('/case-files')).filter((c) => c.id !== f.id && (f.team_id ? c.team_id === f.team_id : !c.team_id) && !f.links.some((l) => l.id === c.id));
  if (!files.length) { toast('Keine weitere Akte in diesem Bereich', true); return false; }
  return openForm({
    title: 'Akte verknüpfen',
    fields: [
      { name: 'linked_id', label: 'Akte', type: 'select', options: files.map((c) => ({ v: c.id, l: `${c.file_number} ${c.title}` })), full: true },
      { name: 'note', label: 'Zusammenhang', maxlength: 200, full: true, placeholder: 'z. B. selbe Täter, Folgeeinsatz' },
    ],
    onSubmit: (v) => api.post(`/case-files/${f.id}/links`, { linked_id: v.linked_id, note: v.note.trim() }),
  });
}
