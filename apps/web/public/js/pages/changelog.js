// Changelog unter Administration: alle Versionen seit 0.0.0 aus js/changelog.js, mit Suche und Filter nach Art.
// Seite und Code kommen aus demselben Build, die oberste Version ist deshalb die installierte.
import { $, esc, fdate, tag } from '../ui.js';
import { CHANGELOG, UNRELEASED, CHANGE_TYPES } from '../changelog.js';

const TYPE_CLASS = { new: 'ok', changed: 'solo', fixed: 'warn', tech: 'sys' };
const changeList = (changes) => `<ul class="changelog-list">${changes.map(([type, text]) => `<li data-type="${type}"><span class="tag ${TYPE_CLASS[type]}">${CHANGE_TYPES[type]}</span><span>${esc(text)}</span></li>`).join('')}</ul>`;
const migrationText = (m) => (!m ? '' : ` · Migration${/[–-]/.test(m) ? 'en' : ''} ${esc(m)}`);

export async function render(view) {
  const [installed] = CHANGELOG;
  view.innerHTML = `<div class="page-head"><div><h1>Changelog</h1><p>Alle Änderungen seit dem ersten Stand · installiert ist Version ${esc(installed.version)}</p></div></div>
    <div class="stack"><div class="card"><div class="toolbar" style="gap:8px;flex-wrap:wrap">
      <input id="cl-search" type="search" class="search" placeholder="Änderungen durchsuchen, z. B. Zinsen, Akten, 1.1" aria-label="Changelog durchsuchen">
      <select id="cl-type" aria-label="Art der Änderung" style="width:auto"><option value="">Alle Arten</option>${Object.entries(CHANGE_TYPES).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <span class="muted" id="cl-count" aria-live="polite"></span></div></div>
    ${UNRELEASED.length ? `<section class="card changelog-version" data-search="noch nicht veröffentlicht unreleased"><div class="card-head"><h2>Noch nicht veröffentlicht</h2>${tag('warn', 'Kommt mit der nächsten Version')}</div>${changeList(UNRELEASED)}</section>` : ''}
    ${CHANGELOG.map((entry) => `<section class="card changelog-version" data-search="${esc(`${entry.version} ${entry.title} ${entry.date}`.toLocaleLowerCase('de'))}">
      <div class="card-head"><div><h2>Version ${esc(entry.version)}${entry === installed ? ` ${tag('ok', 'Installiert')}` : ''}</h2>
        <small class="muted">${fdate(entry.date)}${migrationText(entry.migrations)} · ${esc(entry.title)}</small></div></div>
      ${changeList(entry.changes)}</section>`).join('')}
    <p class="muted changelog-note">Vor 1.0.0 gab es keine eigenen Versionsnummern; die Stände 0.x sind nachträglich nach den zusammengeführten Änderungen nummeriert.</p>
    <div class="card" id="cl-empty" hidden><p class="muted">Keine Änderung passt zur Suche.</p></div></div>`;

  const search = $('#cl-search', view);
  const type = $('#cl-type', view);
  const sections = [...view.querySelectorAll('.changelog-version')];
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase('de');
    let shown = 0;
    for (const section of sections) {
      // Trifft die Suche Version, Titel oder Datum, bleibt die ganze Version sichtbar (gefiltert nur nach Art)
      const whole = query && section.dataset.search.includes(query);
      let visible = 0;
      for (const item of section.querySelectorAll('li')) {
        const match = (!type.value || item.dataset.type === type.value) && (!query || whole || item.textContent.toLocaleLowerCase('de').includes(query));
        item.hidden = !match;
        if (match) visible++;
      }
      section.hidden = visible === 0;
      shown += visible;
    }
    const total = sections.reduce((sum, section) => sum + section.querySelectorAll('li').length, 0);
    $('#cl-count', view).textContent = query || type.value ? `${shown} von ${total} Änderungen` : `${CHANGELOG.length} Versionen, ${total} Änderungen`;
    $('#cl-empty', view).hidden = shown > 0;
  };
  search.addEventListener('input', filter);
  type.addEventListener('change', filter);
  filter();
}
