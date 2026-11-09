// Markdown-Editor: Werkzeugleiste über einem Textfeld mit Vorschau, Nebeneinander-Ansicht, Vollbild, Hilfe und Tastenkürzeln.
// Arbeitet direkt auf dem <textarea>, Formulare lesen den Wert also wie bisher. Änderungen laufen über
// execCommand('insertText'), damit Strg+Z sie wie getippten Text rückgängig macht.
// Einbinden: <textarea data-md> und danach markdownEditors(container); openForm macht das für Felder mit markdown: true.
import { markdownBlock, renderMarkdown, escapeHtml } from './markdown.js';

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICONS = {
  quote: svg('<path d="M4 6h5v5H4zM4 11c0 3.5 1.5 6 5 7M14 6h5v5h-5zM14 11c0 3.5 1.5 6 5 7"/>'),
  code: svg('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>'),
  codeblock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  ul: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
  ol: svg('<path d="M10 6h10M10 12h10M10 18h10M4 4h1v4M3.5 8h2.5M3.5 13.5a1.3 1.3 0 0 1 2.4.6c0 .9-2.4 1.9-2.4 1.9h2.5"/>'),
  task: svg('<rect x="3" y="4" width="6" height="6" rx="1"/><path d="M4.5 7l1.3 1.3L8 6"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M12 7h9M12 17h9"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  hr: svg('<path d="M3 12h18M7 6h10M7 18h10" opacity=".9"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  preview: svg('<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="2.5"/>'),
  split: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5M12 17h.01"/>'),
};
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD = MAC ? '⌘' : 'Strg';

// [Name, Beschriftung, Tastenkürzel, Symbol, Umschalter?]; '|' trennt Gruppen, '>' schiebt den Rest nach rechts
const TOOLS = [
  ['heading', 'Überschrift (mehrmals: kleiner)', `${MOD}+H`, '<b>H</b>'],
  ['bold', 'Fett', `${MOD}+B`, '<b>B</b>'],
  ['italic', 'Kursiv', `${MOD}+I`, '<i>I</i>'],
  ['strike', 'Durchgestrichen', `${MOD}+Umschalt+X`, '<s>S</s>'],
  '|',
  ['quote', 'Zitat', `${MOD}+Umschalt+.`, ICONS.quote],
  ['code', 'Code', `${MOD}+E`, ICONS.code],
  ['codeblock', 'Codeblock', '', ICONS.codeblock],
  ['link', 'Link', `${MOD}+K`, ICONS.link],
  ['image', 'Bild', '', ICONS.image],
  '|',
  ['ul', 'Aufzählung', `${MOD}+Umschalt+8`, ICONS.ul],
  ['ol', 'Nummerierte Liste', `${MOD}+Umschalt+7`, ICONS.ol],
  ['task', 'Aufgabenliste', `${MOD}+Umschalt+9`, ICONS.task],
  '|',
  ['table', 'Tabelle', '', ICONS.table],
  ['hr', 'Trennlinie', '', ICONS.hr],
  '|',
  ['undo', 'Rückgängig', `${MOD}+Z`, ICONS.undo],
  ['redo', 'Wiederholen', MAC ? '⌘+Umschalt+Z' : 'Strg+Y', ICONS.redo],
  '>',
  ['preview', 'Vorschau', '', ICONS.preview, true],
  ['split', 'Nebeneinander', '', ICONS.split, true],
  ['fullscreen', 'Vollbild', 'Esc beendet', ICONS.fullscreen, true],
  ['help', 'Markdown-Hilfe', '', ICONS.help, true],
];
const KEYS = { KeyB: 'bold', KeyI: 'italic', KeyE: 'code', KeyK: 'link', KeyH: 'heading' };
const SHIFT_KEYS = { KeyX: 'strike', Period: 'quote', Digit8: 'ul', Digit7: 'ol', Digit9: 'task' };

// Spickzettel: links die Eingabe, rechts das Ergebnis aus demselben Renderer
const HELP = [
  ['# Überschrift\n## Kleiner\n### Noch kleiner', 'Überschriften'],
  ['**fett**, *kursiv*, ~~durch~~, `Code`', 'Hervorhebung'],
  ['- Punkt\n  - Unterpunkt\n1. Erstens\n2. Zweitens', 'Listen (Unterpunkte mit zwei Leerzeichen einrücken)'],
  ['- [ ] offen\n- [x] erledigt', 'Aufgaben'],
  ['> Zitat', 'Zitat'],
  ['> [!TIP]\n> Kästen: NOTE, TIP, IMPORTANT, WARNING, CAUTION', 'Hinweis-Kasten'],
  ['[Link](https://example.com), https://example.com, [Akten](#/casefiles)', 'Links; #/… öffnet eine Seite der App'],
  ['| Name | Wert |\n| :--- | ---: |\n| A | 1 |', 'Tabelle; : richtet aus'],
  ['```\nCodeblock\n```', 'Codeblock (mit Sprache: ```js)'],
  ['Text mit Fußnote[^1]\n\n[^1]: Die Fußnote', 'Fußnoten'],
  ['---', 'Trennlinie'],
  ['<kbd>Strg</kbd>+<kbd>C</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <mark>markiert</mark>', 'Erlaubtes HTML'],
  ['\\*kein kursiv\\*, 1\\. keine Liste', 'Zeichen ohne Formatierung'],
];
const helpHtml = () => `<p class="muted">Ein Zeilenumbruch bleibt ein Zeilenumbruch, eine Leerzeile beginnt einen neuen Absatz. Bilder aus dem Internet werden zum Schutz deiner Daten nur als Link gezeigt. Anderes HTML erscheint als Text.</p>
  <div class="md-help-grid">${HELP.map(([source, label]) => `<div class="md-help-row"><small class="muted">${escapeHtml(label)}</small><pre>${escapeHtml(source)}</pre><div class="doc-body md">${renderMarkdown(source)}</div></div>`).join('')}</div>`;

// Die Zeilen, die die Auswahl berührt
function lineBlock(ta) {
  const v = ta.value;
  const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? ta.selectionEnd - 1 : ta.selectionEnd;
  end = v.indexOf('\n', end);
  if (end < 0) end = v.length;
  return { start, end, text: v.slice(start, end) };
}

function replace(ta, start, end, text, selStart = start + text.length, selEnd = selStart) {
  ta.focus();
  ta.setSelectionRange(start, end);
  // execCommand hält den Verlauf für Strg+Z; ohne Unterstützung direkt ersetzen. Zum Löschen „delete“ statt
  // insertText mit leerem Text: Chromium setzt den Cursor sonst vor einen Zeilenumbruch am Ende.
  let done = false;
  try { done = text || start === end ? document.execCommand('insertText', false, text) : document.execCommand('delete'); } catch { done = false; }
  if (!done || ta.value.slice(start, start + text.length) !== text) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.setSelectionRange(selStart, selEnd);
}

function wrap(ta, before, after, sample) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const selected = v.slice(s, e);
  // Schon so formatiert: wieder entfernen
  if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after && v[s - before.length - 1] !== before[0]) {
    return replace(ta, s - before.length, e + after.length, selected, s - before.length, e - before.length);
  }
  if (selected.length > before.length + after.length && selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, -after.length);
    return replace(ta, s, e, inner, s, s + inner.length);
  }
  // Leerzeichen am Rand der Auswahl bleiben außerhalb, sonst greift die Formatierung nicht
  const lead = selected.match(/^\s*/)[0];
  const trail = selected.slice(lead.length).match(/\s*$/)[0];
  const core = selected.slice(lead.length, selected.length - trail.length) || sample;
  const text = `${lead}${before}${core}${after}${trail}`;
  const from = s + lead.length + before.length;
  return replace(ta, s, e, text, from, from + core.length);
}

const LIST = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;
const PATTERNS = { ul: /^(\s*)[-*+] (?!\[[ xX]\] )/, ol: /^(\s*)\d+[.)] /, task: /^(\s*)[-*+] \[[ xX]\] /, quote: /^(\s*)> ?/ };
function toggleLines(ta, kind) {
  const { start, end, text } = lineBlock(ta);
  const lines = text.split('\n');
  const filled = lines.filter((line) => line.trim());
  const remove = filled.length > 0 && filled.every((line) => PATTERNS[kind].test(line));
  let n = 0;
  const out = lines.map((line) => {
    if (remove) return line.replace(PATTERNS[kind], '$1');
    if (!line.trim() && lines.length > 1) return line;
    if (kind === 'quote') return `> ${line}`;
    const indent = line.match(/^\s*/)[0];
    n++;
    const marker = kind === 'ul' ? '- ' : kind === 'ol' ? `${n}. ` : '- [ ] ';
    return indent + marker + line.slice(indent.length).replace(LIST, '');
  });
  const result = out.join('\n');
  // Eine einzelne Zeile: Cursor ans Ende; mehrere: alles markiert lassen
  if (lines.length === 1) replace(ta, start, end, result);
  else replace(ta, start, end, result, start, start + result.length);
}

function heading(ta) {
  const { start, end, text } = lineBlock(ta);
  const lines = text.split('\n');
  const level = (lines[0].match(/^(#{1,6}) /) || ['', ''])[1].length;
  const next = level >= 3 ? 0 : level + 1;
  const result = lines.map((line) => (next ? `${'#'.repeat(next)} ` : '') + line.replace(/^#{1,6} /, '')).join('\n');
  replace(ta, start, end, result);
}

// Ein Block steht für sich: davor und danach eine Leerzeile
function insertBlock(ta, block, select) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const before = v.slice(0, s);
  const after = v.slice(e);
  const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const at = s + pre.length;
  const [from, to] = select ? [at + block.indexOf(select), at + block.indexOf(select) + select.length] : [at + block.length, at + block.length];
  replace(ta, s, e, pre + block + post, from, to);
}

function codeBlock(ta) {
  const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (!selected.includes('\n')) {
    if (selected) return insertBlock(ta, `\`\`\`\n${selected}\n\`\`\``, selected);
    return insertBlock(ta, '```\nCode\n```', 'Code');
  }
  const { start, end, text } = lineBlock(ta);
  const result = `\`\`\`\n${text}\n\`\`\``;
  replace(ta, start, end, result, start + 4, start + 4 + text.length);
}

function link(ta, image) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const selected = v.slice(s, e);
  const isUrl = /^(?:https?:\/\/|www\.)\S+$/.test(selected.trim());
  const prefix = image ? '!' : '';
  if (isUrl) {
    const label = image ? 'Beschreibung' : 'Text';
    const text = `${prefix}[${label}](${selected.trim()})`;
    return replace(ta, s, e, text, s + prefix.length + 1, s + prefix.length + 1 + label.length);
  }
  const label = selected || (image ? 'Beschreibung' : 'Linktext');
  const text = `${prefix}[${label}](https://)`;
  const urlAt = s + prefix.length + label.length + 3;
  // Mit markiertem Text gleich die Adresse eintippen, sonst zuerst den Text
  return selected ? replace(ta, s, e, text, urlAt, urlAt + 8) : replace(ta, s, e, text, s + prefix.length + 1, s + prefix.length + 1 + label.length);
}

const ACTIONS = {
  heading,
  bold: (ta) => wrap(ta, '**', '**', 'fetter Text'),
  italic: (ta) => wrap(ta, '*', '*', 'kursiver Text'),
  strike: (ta) => wrap(ta, '~~', '~~', 'durchgestrichen'),
  code: (ta) => (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n') ? codeBlock(ta) : wrap(ta, '`', '`', 'Code')),
  codeblock: codeBlock,
  quote: (ta) => toggleLines(ta, 'quote'),
  link: (ta) => link(ta, false),
  image: (ta) => link(ta, true),
  ul: (ta) => toggleLines(ta, 'ul'),
  ol: (ta) => toggleLines(ta, 'ol'),
  task: (ta) => toggleLines(ta, 'task'),
  table: (ta) => insertBlock(ta, '| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Inhalt | Inhalt |', 'Spalte 1'),
  hr: (ta) => insertBlock(ta, '---'),
  undo: (ta) => { ta.focus(); document.execCommand('undo'); },
  redo: (ta) => { ta.focus(); document.execCommand('redo'); },
};

// Enter in einer Liste oder einem Zitat setzt die Markierung fort; in einem leeren Punkt beendet es die Liste
function continueList(ta, event) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  if (s !== e) return;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  const line = v.slice(lineStart, s);
  const m = /^(\s*)(?:([-*+]) \[[ xX]\] |([-*+]) |(\d+)([.)]) |> ?)/.exec(line);
  if (!m) return;
  // Im Codeblock nichts anfassen
  if (((v.slice(0, lineStart).match(/^ {0,3}(?:```|~~~)/gm) || []).length % 2) === 1) return;
  event.preventDefault();
  const lineEnd = v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s);
  if (!line.slice(m[0].length).trim() && !v.slice(s, lineEnd).trim()) return replace(ta, lineStart, lineEnd, '');
  const marker = m[2] ? `${m[2]} [ ] ` : m[3] ? `${m[3]} ` : m[4] ? `${Number(m[4]) + 1}${m[5]} ` : '> ';
  replace(ta, s, s, `\n${m[1]}${marker}`);
}

// Tab rückt Listenpunkte ein, Umschalt+Tab aus; außerhalb von Listen bleibt Tab der Sprung zum nächsten Feld
function indentList(ta, event) {
  const { start, end, text } = lineBlock(ta);
  const lines = text.split('\n');
  if (!lines.every((line) => !line.trim() || LIST.test(line))) return;
  event.preventDefault();
  const result = lines.map((line) => (event.shiftKey ? line.replace(/^( {1,2}|\t)/, '') : line.trim() ? `  ${line}` : line)).join('\n');
  const single = ta.selectionStart === ta.selectionEnd && lines.length === 1;
  const shift = result.length - text.length;
  if (single) replace(ta, start, end, result, Math.max(start, ta.selectionStart + shift));
  else replace(ta, start, end, result, start, start + result.length);
}

function build(ta) {
  const editor = document.createElement('div');
  editor.className = 'md-editor';
  editor.dataset.mode = 'write';
  const max = Number(ta.getAttribute('maxlength')) || 0;
  editor.innerHTML = `<div class="md-toolbar" role="toolbar" aria-label="Formatierung" aria-controls="${ta.id || ''}">${TOOLS.map((tool) => {
    if (tool === '|') return '<span class="md-sep" aria-hidden="true"></span>';
    if (tool === '>') return '<span class="md-spacer"></span>';
    const [name, label, keys, icon, toggle] = tool;
    const title = keys ? `${label} (${keys})` : label;
    return `<button type="button" class="md-tool" data-md-tool="${name}" title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}"${toggle ? ' aria-pressed="false"' : ''} tabindex="-1">${icon}</button>`;
  }).join('')}</div>
    <div class="md-panes"></div>
    <div class="md-help card" hidden></div>
    <div class="md-status"><span>Markdown</span><span class="md-count" aria-live="off"></span></div>`;
  ta.before(editor);
  const panes = editor.querySelector('.md-panes');
  panes.append(ta);
  const preview = document.createElement('div');
  preview.className = 'md-preview doc-body md';
  preview.hidden = true;
  preview.setAttribute('aria-label', 'Vorschau');
  panes.append(preview);
  const toolbar = editor.querySelector('.md-toolbar');
  const tools = [...toolbar.querySelectorAll('.md-tool')];
  tools[0].tabIndex = 0;
  const count = editor.querySelector('.md-count');
  const help = editor.querySelector('.md-help');
  const state = { preview: false, split: false, fullscreen: false, help: false };
  // Vorschau so hoch wie das Textfeld, damit nichts springt; im Vollbild regelt das CSS die Höhe
  let lastHeight = ta.offsetHeight || 160;
  const sizePreview = () => {
    if (!ta.hidden && ta.offsetHeight) lastHeight = ta.offsetHeight;
    preview.style.height = state.split && !state.fullscreen ? `${lastHeight}px` : '';
    preview.style.minHeight = state.preview && !state.fullscreen ? `${lastHeight}px` : '';
  };

  const render = () => { preview.innerHTML = ta.value.trim() ? markdownBlock(ta.value) : '<p class="muted">Noch nichts zu sehen.</p>'; };
  const updateCount = () => { count.textContent = max ? `${ta.value.length.toLocaleString('de-DE')} / ${max.toLocaleString('de-DE')}` : `${ta.value.length.toLocaleString('de-DE')} Zeichen`; };
  let pending = 0;
  const schedule = () => { clearTimeout(pending); pending = setTimeout(render, ta.value.length > 20000 ? 300 : 80); };
  const apply = () => {
    const showPreview = state.preview || state.split;
    editor.dataset.mode = state.split ? 'split' : state.preview ? 'preview' : 'write';
    editor.classList.toggle('md-fullscreen', state.fullscreen);
    if (!ta.hidden && ta.offsetHeight) lastHeight = ta.offsetHeight;
    ta.hidden = state.preview && !state.split;
    sizePreview();
    preview.hidden = !showPreview;
    help.hidden = !state.help;
    if (state.help && !help.innerHTML) help.innerHTML = helpHtml();
    if (showPreview) render();
    for (const name of ['preview', 'split', 'fullscreen', 'help']) editor.querySelector(`[data-md-tool="${name}"]`).setAttribute('aria-pressed', String(state[name]));
    // Formatieren geht nur beim Schreiben
    for (const button of tools) if (ACTIONS[button.dataset.mdTool]) button.disabled = ta.hidden;
    // Der Tab-Stopp der Leiste muss auf einem bedienbaren Knopf liegen
    const enabled = tools.filter((button) => !button.disabled);
    if (!enabled.some((button) => button.tabIndex === 0)) for (const button of tools) button.tabIndex = button === enabled[0] ? 0 : -1;
  };
  const toggle = (name) => {
    state[name] = !state[name];
    if (name === 'preview' && state.preview) state.split = false;
    if (name === 'split' && state.split) state.preview = false;
    apply();
    if (!ta.hidden && name !== 'help') ta.focus();
  };
  const run = (name) => {
    if (name in state) return toggle(name);
    if (ta.hidden || ta.readOnly || ta.disabled) return;
    ACTIONS[name](ta);
  };

  toolbar.addEventListener('mousedown', (event) => {
    // Fokus und Auswahl im Textfeld behalten
    if (event.target.closest('.md-tool') && !ta.hidden) event.preventDefault();
  });
  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('.md-tool');
    if (button && !button.disabled) run(button.dataset.mdTool);
  });
  // Werkzeugleiste wie eine Leiste bedienen: ein Tab-Stopp, Pfeiltasten wechseln
  toolbar.addEventListener('keydown', (event) => {
    const enabled = tools.filter((button) => !button.disabled);
    const at = enabled.indexOf(document.activeElement);
    if (at < 0) return;
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: enabled.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = enabled[(next + enabled.length) % enabled.length];
    for (const button of tools) button.tabIndex = button === target ? 0 : -1;
    target.focus();
  });
  ta.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const mod = MAC ? event.metaKey : event.ctrlKey;
    if (mod && !event.altKey) {
      const name = event.shiftKey ? SHIFT_KEYS[event.code] : KEYS[event.code];
      if (name) { event.preventDefault(); run(name); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey && !mod && !event.altKey) continueList(ta, event);
    else if (event.key === 'Tab' && !mod && !event.altKey) indentList(ta, event);
  });
  // Eine Adresse über markierten Text einfügen macht einen Link daraus
  ta.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain')?.trim() || '';
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (!selected || selected.includes('\n') || !/^https?:\/\/\S+$/.test(text) || /^https?:\/\//.test(selected)) return;
    event.preventDefault();
    replace(ta, ta.selectionStart, ta.selectionEnd, `[${selected}](${text})`);
  });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.fullscreen) { event.preventDefault(); event.stopPropagation(); toggle('fullscreen'); }
  });
  ta.addEventListener('input', () => { updateCount(); if (state.split) schedule(); });
  // Gleicher Fortschritt beim Scrollen in der Nebeneinander-Ansicht
  ta.addEventListener('scroll', () => {
    if (!state.split) return;
    const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
  });
  // Pflichtfeld leer und gerade in der Vorschau: zurück zum Schreiben, damit der Browser das Feld zeigen kann
  ta.addEventListener('invalid', () => { if (ta.hidden) { state.preview = false; apply(); } });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (state.split && !state.fullscreen) sizePreview(); }).observe(ta);
  // Formular zurückgesetzt (z. B. nach dem Absenden): Zähler und Vorschau nachziehen
  ta.form?.addEventListener('reset', () => setTimeout(() => { updateCount(); if (!preview.hidden) render(); }));
  updateCount();
  apply();
  editor.mdEditor = { toggle, run, state };
  return editor;
}

function setup(ta) {
  ta.dataset.mdReady = '1';
  return build(ta);
}
// Alle noch nicht eingerichteten Markdown-Felder in einem Bereich mit Werkzeugleiste versehen
export function markdownEditors(root = document) {
  for (const ta of root.querySelectorAll('textarea[data-md]:not([data-md="lazy"]):not([data-md-ready])')) setup(ta);
}
// data-md="lazy" (z. B. Kommentarfelder unter jedem Ticket): Leiste erst beim ersten Fokus, damit lange Listen ruhig bleiben
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    const ta = event.target;
    if (!(ta instanceof HTMLTextAreaElement) || ta.dataset.md !== 'lazy' || ta.dataset.mdReady) return;
    setup(ta);
    // Das Verschieben in den Editor nimmt dem Feld den Fokus
    ta.focus();
  });
}
