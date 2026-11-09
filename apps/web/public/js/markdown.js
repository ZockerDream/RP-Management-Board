// Markdown für Notizen, Dokumentationen, Akten, Schulungen, Tickets und Co.: CommonMark mit den GitHub-Erweiterungen
// (Tabellen, Aufgabenlisten, Durchstreichen, automatische Links, Fußnoten, Hinweis-Kästen mit > [!NOTE]).
// Sicher, weil zuerst alles maskiert wird: HTML aus dem Text erscheint als Text. Nur wenige Tags ohne Attribute bleiben
// erhalten (<br>, <kbd>, <sub>, <sup>, <mark>, <u>, <ins>, <del>, <s>, <small>, <b>, <i>, <strong>, <em>).
// Links nur http(s), mailto, tel und Seiten der App (#/…). Bilder nur als data:-Bild; externe Bilder erscheinen als Link,
// weil die App keine fremden Server anfragt (Datenschutz, CSP img-src).
// Abweichung von CommonMark wie bei GitHub-Kommentaren: Ein Zeilenumbruch im Absatz bleibt ein Zeilenumbruch.
// Ohne DOM nutzbar; Tests in apps/api/test/markdown.test.js.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const unescapeHtml = (value) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);

const PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const SAFE_TAG = /^<(?:br\s*\/?|(\/?)(b|i|u|s|em|strong|del|ins|mark|kbd|sub|sup|small))>/i;
const ALERTS = { note: 'Hinweis', tip: 'Tipp', important: 'Wichtig', warning: 'Warnung', caution: 'Vorsicht' };
const IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
let renderCount = 0;

// ---------- Links und Bilder
function safeUrl(raw) {
  const url = String(raw).trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(url) || url.startsWith('#/')) return url;
  if (/^www\.[\w-]+\./i.test(url)) return `https://${url}`;
  // „example.com/seite“ ohne Protokoll ist fast immer als Webadresse gemeint
  if (/^[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:[/?#]|$)/i.test(url)) return `https://${url}`;
  return null;
}
function linkHtml(url, inner, title) {
  const internal = url.startsWith('#/');
  return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${internal ? '' : ' target="_blank" rel="noopener noreferrer"'}>${inner}</a>`;
}
const IMAGE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';
function imageHtml(src, alt, title) {
  const raw = String(src).trim();
  if (IMAGE_DATA.test(raw)) return `<img src="${escapeHtml(raw.replace(/\s+/g, ''))}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
  const url = safeUrl(raw);
  const label = `${IMAGE_ICON}<span>${escapeHtml(alt || 'Bild')}</span>`;
  if (url && /^https?:/i.test(url)) {
    return `<a class="md-image-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Externes Bild – wird zum Schutz deiner Daten nicht eingebettet. Klicken öffnet es in einem neuen Tab.">${label}</a>`;
  }
  return `<span class="md-image-link">${label}</span>`;
}

// ---------- Inline: Code, Escapes, Links, Hervorhebungen
// Fertige HTML-Stücke werden durch Platzhalter ersetzt, damit spätere Schritte sie nicht noch einmal anfassen
const placeholder = /(\d+)/g;

function findClosingTicks(s, from, n) {
  for (let i = from; i < s.length;) {
    if (s[i] !== '`') { i++; continue; }
    let run = 0;
    while (s[i + run] === '`') run++;
    if (run === n) return i;
    i += run;
  }
  return -1;
}
function matchBracket(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']' && --depth === 0) return i;
  }
  return -1;
}
function parseDestination(s, start) {
  let i = start;
  const skip = () => { while (s[i] === ' ' || s[i] === '\n') i++; };
  skip();
  let url;
  if (s[i] === '<') {
    const end = s.indexOf('>', i);
    if (end < 0) return null;
    url = s.slice(i + 1, end);
    i = end + 1;
  } else {
    const from = i;
    let depth = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === ' ' || c === '\n') break;
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
    }
    url = s.slice(from, i);
  }
  skip();
  let title = '';
  if (s[i] === '"' || s[i] === "'" || (s[i] === '(' && url)) {
    const close = s[i] === '(' ? ')' : s[i];
    const end = s.indexOf(close, i + 1);
    if (end < 0) return null;
    title = s.slice(i + 1, end);
    i = end + 1;
    skip();
  }
  if (s[i] !== ')') return null;
  return { url, title, end: i + 1 };
}
const normLabel = (label) => label.trim().toLowerCase().replace(/\s+/g, ' ');
const plainText = (s) => s.replace(placeholder, '').replace(/[*_~`]/g, '');

function footnoteRef(ctx, label) {
  let index = ctx.footnotes.order.indexOf(label);
  const first = index < 0;
  if (first) index = ctx.footnotes.order.push(label) - 1;
  const n = index + 1;
  return `<sup class="md-fn-ref"><button type="button" class="md-fn" data-md-fn="${ctx.uid}-fn-${n}"${first ? ` id="${ctx.uid}-ref-${n}"` : ''} aria-label="Fußnote ${n}">${n}</button></sup>`;
}

// [Text](Ziel), ![Bild](Ziel), [Text][Ref], [Ref], [^Fußnote]
function links(s, ctx, h) {
  let out = '';
  for (let i = 0; i < s.length;) {
    const image = s[i] === '!' && s[i + 1] === '[';
    if (s[i] !== '[' && !image) { out += s[i++]; continue; }
    const open = image ? i + 1 : i;
    if (!image && s[open + 1] === '^') {
      const m = /^\[\^([^\]\s]+)\]/.exec(s.slice(open));
      if (m && ctx.footnotes.defs.has(normLabel(m[1]))) { out += h.hold(footnoteRef(ctx, normLabel(m[1]))); i = open + m[0].length; continue; }
    }
    const close = matchBracket(s, open);
    if (close < 0 || (ctx.inLink && !image)) { out += s[i++]; continue; }
    const text = s.slice(open + 1, close);
    let target = null;
    let end = close + 1;
    if (s[close + 1] === '(') {
      const dest = parseDestination(s, close + 2);
      if (dest) { target = { url: h.raw(dest.url), title: h.raw(dest.title) }; end = dest.end; }
    } else if (s[close + 1] === '[') {
      const refEnd = s.indexOf(']', close + 2);
      const ref = refEnd > 0 && ctx.refs.get(normLabel(s.slice(close + 2, refEnd) || text));
      if (ref) { target = ref; end = refEnd + 1; }
    } else if (ctx.refs.has(normLabel(text))) target = ctx.refs.get(normLabel(text));
    if (!target) { out += s[i++]; continue; }
    if (image) out += h.hold(imageHtml(target.url, plainText(h.raw(text)), target.title));
    else {
      const url = safeUrl(target.url);
      const inner = inlineRaw(text, { ...ctx, inLink: true }, h);
      out += h.hold(url ? linkHtml(url, inner, target.title) : `<span class="md-badlink" title="${escapeHtml(`Kein erlaubter Link: ${target.url}`)}">${inner}</span>`);
    }
    i = end;
  }
  return out;
}

// Adressen im Fließtext (GitHub): Satzzeichen am Ende und eine nicht geöffnete Klammer gehören nicht dazu
function trimUrl(url) {
  let link = url;
  let rest = '';
  for (;;) {
    const last = link.at(-1);
    if (/[?!.,:*_~'";]/.test(last)) { rest = last + rest; link = link.slice(0, -1); continue; }
    if (last === ')' && (link.match(/\(/g) || []).length < (link.match(/\)/g) || []).length) { rest = last + rest; link = link.slice(0, -1); continue; }
    break;
  }
  return { link, rest };
}
function autolinks(s, h) {
  return s
    .replace(/(^|[^a-z0-9/@.\-])((?:https?:\/\/|www\.)[^\s<]+)/gi, (match, pre, url) => {
      const { link, rest } = trimUrl(url);
      if (!/^(?:https?:\/\/[^/\s]|www\.[\w-]+\.)/i.test(link)) return match;
      return pre + h.hold(linkHtml(/^www\./i.test(link) ? `https://${link}` : link, escapeHtml(link))) + rest;
    })
    .replace(/(^|[^\w.+\-/:@])([\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})(?![\w@-])/gi, (_, pre, mail) => pre + h.hold(linkHtml(`mailto:${mail}`, escapeHtml(mail))));
}

function emphasis(s) {
  return s
    .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/(^|[^\w])___(?=\S)([\s\S]*?\S)___(?!\w)/g, '$1<strong><em>$2</em></strong>')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

// Liefert HTML mit Platzhaltern; inline() setzt sie am Ende ein
function inlineRaw(src, ctx, h) {
  let out = '';
  const s = String(src);
  // Schließende Tags nur zu vorher geöffneten, sonst bleiben sie Text
  const openTags = {};
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '\n') { out += h.hold('<br>'); i += 2; continue; }
    if (c === '\\' && i + 1 < s.length && PUNCT.includes(s[i + 1])) { out += h.hold(escapeHtml(s[i + 1])); i += 2; continue; }
    if (c === '`') {
      let n = 0;
      while (s[i + n] === '`') n++;
      const close = findClosingTicks(s, i + n, n);
      if (close < 0) { out += s.slice(i, i + n); i += n; continue; }
      let code = h.raw(s.slice(i + n, close)).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      out += h.hold(`<code>${escapeHtml(code)}</code>`);
      i = close + n;
      continue;
    }
    if (c === '<') {
      const head = s.slice(i, i + 400);
      const tag = SAFE_TAG.exec(head);
      const name = tag?.[2]?.toLowerCase();
      if (tag && (!name || !tag[1] || openTags[name] > 0)) {
        if (name) openTags[name] = (openTags[name] || 0) + (tag[1] ? -1 : 1);
        out += h.hold(name ? `<${tag[1]}${name}>` : '<br>');
        i += tag[0].length;
        continue;
      }
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/i.exec(head);
      if (auto && !ctx.inLink) { out += h.hold(linkHtml(auto[1].includes(':') ? auto[1] : `mailto:${auto[1]}`, escapeHtml(auto[1]))); i += auto[0].length; continue; }
    }
    out += c;
    i++;
  }
  let text = links(out, ctx, h);
  if (!ctx.inLink) text = autolinks(text, h);
  return emphasis(escapeHtml(text)).replace(/ *\n/g, '<br>');
}

function holder() {
  const held = [];
  const hold = (html) => `${held.push(html) - 1}`;
  // Rohtext zurück, z. B. für Link-Ziele mit maskierten Zeichen wie \_
  const raw = (s) => s.replace(placeholder, (_, n) => unescapeHtml(held[n].replace(/<[^>]+>/g, '')));
  const restore = (s) => {
    let out = s;
    for (let k = 0; k < 20 && out.includes(''); k++) out = out.replace(placeholder, (_, n) => held[n]);
    return out;
  };
  return { hold, raw, restore };
}
function inline(src, ctx) {
  const h = holder();
  return h.restore(inlineRaw(String(src).replace(/[]/g, ''), ctx, h));
}

// ---------- Blöcke
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?=[ \t]|$)([ \t]*)(.*)$/;
const DELIM_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const blank = (line) => !line.trim();
const indentOf = (line) => line.length - line.trimStart().length;
const heading = (level, html) => `<h${Math.min(level + 1, 6)}>${html}</h${Math.min(level + 1, 6)}>`;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cell += '|'; i++; } else if (s[i] === '|') { cells.push(cell.trim()); cell = ''; } else cell += s[i];
  }
  cells.push(cell.trim());
  return cells;
}
const isTableStart = (lines, i) => i + 1 < lines.length && lines[i].includes('|') && !ITEM.test(lines[i]) && !QUOTE.test(lines[i])
  && DELIM_ROW.test(lines[i + 1]) && lines[i + 1].includes('|') && splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
// Was einen Absatz beendet; nummerierte Listen nur, wenn sie mit 1 beginnen (wie CommonMark)
function interrupts(line) {
  if (FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const m = ITEM.exec(line);
  return !!m && !blank(m[4]) && (!/\d/.test(m[2][0]) || /^1[.)]$/.test(m[2]));
}

function table(lines, start, ctx) {
  const head = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
  const cell = (tag, text, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(text, ctx)}</${tag}>`;
  const rows = [];
  let i = start + 2;
  while (i < lines.length && !blank(lines[i]) && lines[i].includes('|') && !interrupts(lines[i])) {
    const cells = splitRow(lines[i]);
    rows.push(`<tr>${head.map((_, k) => cell('td', cells[k] ?? '', k)).join('')}</tr>`);
    i++;
  }
  const html = `<div class="md-table"><table><thead><tr>${head.map((text, k) => cell('th', text, k)).join('')}</tr></thead>${rows.length ? `<tbody>${rows.join('')}</tbody>` : ''}</table></div>`;
  return { html, next: i };
}

function quote(inner, ctx) {
  const alert = /^ {0,3}\[!(note|tip|important|warning|caution)\][ \t]*$/i.exec(inner[0] || '');
  if (!alert) return `<blockquote>${blocks(inner, ctx)}</blockquote>`;
  const kind = alert[1].toLowerCase();
  return `<div class="md-alert md-alert-${kind}"><p class="md-alert-title">${ALERTS[kind]}</p>${blocks(inner.slice(1), ctx)}</div>`;
}

// Listen: Ein Punkt reicht bis zur nächsten Zeile, die weniger eingerückt ist als sein Inhalt. Großzügiger als CommonMark:
// Ein Unterpunkt zählt schon als verschachtelt, wenn er weiter eingerückt ist als die Markierung darüber.
function list(lines, start, ctx) {
  const first = ITEM.exec(lines[start]);
  const ordered = /\d/.test(first[2][0]);
  const kind = (m) => (/\d/.test(m[2][0]) ? m[2].slice(-1) : m[2]);
  const items = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || /\d/.test(m[2][0]) !== ordered || kind(m) !== kind(first)) break;
    const markerIndent = m[1].length;
    let pad = m[3].length;
    let content = m[4];
    if (blank(content)) pad = 1;
    else if (pad > 4) { content = ' '.repeat(pad - 1) + content; pad = 1; }
    const contentIndent = markerIndent + m[2].length + pad;
    const body = [content];
    i++;
    let afterBlank = false;
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) { body.push(''); afterBlank = true; i++; continue; }
      const indent = indentOf(line);
      if (indent >= contentIndent) { body.push(line.slice(contentIndent)); afterBlank = false; i++; continue; }
      const sub = ITEM.exec(line);
      if (sub && indent > markerIndent) { body.push(line.slice(indent)); afterBlank = false; i++; continue; }
      if (afterBlank || sub || interrupts(line)) break;
      body.push(line.trim());
      i++;
    }
    let trailing = 0;
    while (body.length > 1 && blank(body[body.length - 1])) { body.pop(); trailing++; }
    // Locker (mit Absätzen) wird die Liste durch Leerzeilen zwischen Punkten oder zwischen Blöcken eines Punktes,
    // nicht durch Leerzeilen in einer Unterliste oder einem Codeblock
    let fence = null;
    const nestedFrom = body.findIndex((line, k) => k > 0 && ITEM.test(line));
    body.forEach((line, k) => {
      const f = FENCE.exec(line);
      if (fence) { if (f && f[2][0] === fence[0] && f[2].length >= fence.length && !f[3]) fence = null; return; }
      if (f) { fence = f[2]; return; }
      const next = body[k + 1];
      if (!blank(line) || next === undefined || blank(next) || indentOf(next) > 0) return;
      if (nestedFrom >= 0 && nestedFrom < k && ITEM.test(next)) return;
      loose = true;
    });
    if (trailing && i < lines.length) {
      const next = ITEM.exec(lines[i]);
      if (next && /\d/.test(next[2][0]) === ordered && kind(next) === kind(first)) loose = true;
    }
    const task = /^\[([ xX])\](?=[ \t]|$)/.exec(body[0]);
    if (task) body[0] = body[0].slice(3).replace(/^[ \t]/, '');
    items.push({ body, task: task ? task[1] !== ' ' : null });
  }
  const html = items.map(({ body, task }) => {
    let inner = blocks(body, ctx, !loose);
    if (task !== null) {
      const box = `<input type="checkbox" disabled${task ? ' checked' : ''} aria-label="${task ? 'Erledigt' : 'Offen'}"> `;
      inner = inner.startsWith('<p>') ? `<p>${box}${inner.slice(3)}` : box + inner;
    }
    return `<li${task !== null ? ' class="task"' : ''}>${inner}</li>`;
  }).join('');
  const startNo = ordered ? Number(first[2].slice(0, -1)) : 1;
  const tag = ordered ? 'ol' : 'ul';
  const cls = items.some((item) => item.task !== null) ? ' class="contains-task-list"' : '';
  return { html: `<${tag}${startNo !== 1 ? ` start="${startNo}"` : ''}${cls}>${html}</${tag}>`, next: i };
}

function blocks(lines, ctx, tight = false) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    let m = FENCE.exec(line);
    if (m) {
      const [, indent, fence, info] = m;
      const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      const body = [];
      for (i++; i < lines.length && !closing.test(lines[i]); i++) body.push(lines[i].replace(new RegExp(`^ {0,${indent.length}}`), ''));
      i++;
      const lang = info.replace(/[^\w+#.-]/g, '').slice(0, 30);
      out.push(`<pre${lang ? ` data-lang="${lang}"` : ''}><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (indentOf(line) >= 4) {
      const body = [];
      for (; i < lines.length && (indentOf(lines[i]) >= 4 || blank(lines[i])); i++) body.push(lines[i].slice(4));
      while (body.length && blank(body[body.length - 1])) body.pop();
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = HEADING.exec(line))) { out.push(heading(m[1].length, inline(m[2] || '', ctx))); i++; continue; }
    if (HR.test(line)) { out.push('<hr>'); i++; continue; }
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length) {
        const l = lines[i];
        if (QUOTE.test(l)) { inner.push(l.replace(/^ {0,3}> ?/, '')); i++; continue; }
        // Träge Fortsetzung: Text direkt unter einer Zitatzeile gehört noch dazu
        if (!blank(l) && inner.length && !blank(inner[inner.length - 1]) && !interrupts(l)) { inner.push(l); i++; continue; }
        break;
      }
      out.push(quote(inner, ctx));
      continue;
    }
    if (isTableStart(lines, i)) { const t = table(lines, i, ctx); out.push(t.html); i = t.next; continue; }
    if (ITEM.test(line)) { const l = list(lines, i, ctx); out.push(l.html); i = l.next; continue; }
    // Absatz; eine Zeile aus = oder - darunter macht ihn zur Überschrift
    const para = [line.trim()];
    let setext = 0;
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (blank(l)) break;
      if (/^ {0,3}=+[ \t]*$/.test(l)) { setext = 1; i++; break; }
      if (/^ {0,3}-+[ \t]*$/.test(l)) { setext = 2; i++; break; }
      if (interrupts(l) || isTableStart(lines, i)) break;
      para.push(l.trim());
    }
    const html = inline(para.join('\n'), ctx);
    out.push(setext ? heading(setext, html) : tight ? html : `<p>${html}</p>`);
  }
  return out.join('');
}

// Referenzen ([name]: https://…) und Fußnoten ([^1]: Text) vorab einsammeln, außerhalb von Codeblöcken
function definitions(lines, ctx) {
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (fence) { if (f && f[2][0] === fence[0] && f[2].length >= fence.length && !f[3]) fence = null; out.push(line); continue; }
    if (f) { fence = f[2]; out.push(line); continue; }
    const note = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/.exec(line);
    if (note) {
      const body = [note[2]];
      while (i + 1 < lines.length && (indentOf(lines[i + 1]) >= 4 || (blank(lines[i + 1]) && indentOf(lines[i + 2] || '') >= 4))) body.push(lines[++i].replace(/^ {4}/, ''));
      if (!ctx.footnotes.defs.has(normLabel(note[1]))) ctx.footnotes.defs.set(normLabel(note[1]), body);
      continue;
    }
    // Nur echte Adressen gelten als Definition; „[Hinweis]: siehe oben“ bleibt Text
    const ref = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/.exec(line);
    if (ref && (safeUrl(ref[2]) || IMAGE_DATA.test(ref[2]))) {
      if (!ctx.refs.has(normLabel(ref[1]))) ctx.refs.set(normLabel(ref[1]), { url: ref[2], title: ref[3] ?? ref[4] ?? ref[5] ?? '' });
      continue;
    }
    out.push(line);
  }
  return out;
}

// Tabs am Zeilenanfang zählen wie bis zu vier Leerzeichen
const expandTabs = (line) => line.replace(/^[ \t]+/, (lead) => {
  let col = 0;
  for (const c of lead) col = c === '\t' ? col + 4 - (col % 4) : col + 1;
  return ' '.repeat(col);
});

const context = () => ({ refs: new Map(), footnotes: { defs: new Map(), order: [] }, uid: `md${++renderCount}` });

export function renderMarkdown(source) {
  const ctx = context();
  const lines = definitions(String(source ?? '').replace(/\r\n?/g, '\n').replace(/[]/g, '').split('\n').map(expandTabs), ctx);
  let html = blocks(lines, ctx);
  if (ctx.footnotes.order.length) {
    const items = [];
    // Fußnoten können weitere Fußnoten nennen, die Liste wächst dabei
    for (let k = 0; k < ctx.footnotes.order.length; k++) {
      const n = k + 1;
      const back = `<button type="button" class="md-fn md-fn-back" data-md-fn="${ctx.uid}-ref-${n}" aria-label="Zurück zum Text">↩</button>`;
      const body = blocks(ctx.footnotes.defs.get(ctx.footnotes.order[k]), ctx);
      items.push(`<li id="${ctx.uid}-fn-${n}" tabindex="-1">${body.endsWith('</p>') ? `${body.slice(0, -4)} ${back}</p>` : body + back}</li>`);
    }
    html += `<section class="md-footnotes" aria-label="Fußnoten"><ol>${items.join('')}</ol></section>`;
  }
  return html;
}

// Für einzeilige Stellen wie Tabellenzellen: nur Inline-Formatierung
export const renderInline = (source) => inline(String(source ?? ''), context());
// Formatierter Block; die Klassen sorgen für Abstände wie in Dokumentationen
export const markdownBlock = (source, extra = '') => `<div class="doc-body md ${extra}">${renderMarkdown(source)}</div>`;

// Fußnoten springen per Knopf statt per #-Link, weil # in dieser App die Seite wechselt
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-md-fn]');
    if (!button) return;
    event.preventDefault();
    const target = document.getElementById(button.dataset.mdFn);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus?.({ preventScroll: true });
  });
}
