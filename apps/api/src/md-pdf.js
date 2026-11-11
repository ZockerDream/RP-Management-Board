// Zerlegt die HTML-Ausgabe von renderMarkdown (markdown.js) in Blöcke, die casefile-pdf.js mit pdfkit setzt.
// Die Eingabe ist kein beliebiges HTML, sondern die bekannte, bereinigte Tag-Menge des eigenen Renderers;
// unbekannte Tags liefern nur ihren Text. Ohne DOM und ohne Datenbank, damit der Unit-Test es prüfen kann.
const VOID = new Set(['br', 'hr', 'input', 'img', 'rect', 'circle', 'path']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) attrs[m[1].toLowerCase()] = m[2] === undefined ? true : decode(m[2]);
  return attrs;
}

// Kleiner Baum aus Tags und Text
function tree(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/gi;
  for (const m of html.matchAll(re)) {
    const top = stack.at(-1);
    if (m[4] !== undefined) { top.children.push({ text: decode(m[4]) }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.findLastIndex((n) => n.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const node = { tag, attrs: parseAttrs(m[3]), children: [] };
    top.children.push(node);
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(node);
  }
  return root;
}

const cls = (n) => String(n.attrs?.class || '');
const isBlock = (n) => n.tag && /^(h[1-6]|p|ul|ol|li|blockquote|div|table|pre|hr|section)$/.test(n.tag);

// Inline-Inhalt zu Runs; benachbarte Runs mit gleichen Merkmalen werden zusammengelegt
function runs(nodes, marks = {}) {
  const out = [];
  const push = (r) => {
    const last = out.at(-1);
    const same = last && ['bold', 'italic', 'strike', 'code', 'link'].every((k) => last[k] === r[k]);
    if (same) last.text += r.text;
    else out.push(r);
  };
  const walk = (list, m) => {
    for (const n of list) {
      if (n.text !== undefined) { if (n.text) push({ text: n.text, ...m }); continue; }
      if (n.tag === 'br') { push({ text: '\n', ...m }); continue; }
      if (n.tag === 'svg' || n.tag === 'input' || (n.tag === 'button' && cls(n).includes('md-fn-back'))) continue;
      const next = { ...m };
      if (n.tag === 'strong' || n.tag === 'b') next.bold = true;
      else if (n.tag === 'em' || n.tag === 'i') next.italic = true;
      else if (n.tag === 'del' || n.tag === 's') next.strike = true;
      else if (n.tag === 'code' || n.tag === 'kbd') next.code = true;
      else if (n.tag === 'a' && n.attrs.href) next.link = n.attrs.href;
      if (n.tag === 'sup') { push({ text: '[', ...m }); walk(n.children, next); push({ text: ']', ...m }); continue; }
      walk(n.children, next);
    }
  };
  walk(nodes, marks);
  return out;
}
const trimRuns = (list) => {
  const out = list.map((r) => ({ ...r }));
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, '');
  if (out.at(-1)) out.at(-1).text = out.at(-1).text.replace(/\s+$/, '');
  return out.filter((r) => r.text);
};
const textOf = (n) => (n.text !== undefined ? n.text : n.tag === 'br' ? '\n' : (n.children || []).map(textOf).join(''));

function blocksOf(nodes) {
  const out = [];
  let inline = [];
  const flush = () => {
    const r = trimRuns(runs(inline));
    if (r.length) out.push({ type: 'paragraph', runs: r });
    inline = [];
  };
  for (const n of nodes) {
    if (!isBlock(n)) { inline.push(n); continue; }
    flush();
    out.push(...block(n));
  }
  flush();
  return out;
}

function block(n) {
  const t = n.tag;
  if (/^h[1-6]$/.test(t)) return [{ type: 'heading', level: Number(t[1]), runs: trimRuns(runs(n.children)) }];
  if (t === 'p') {
    const r = trimRuns(runs(n.children));
    return r.length ? [{ type: 'paragraph', runs: r }] : [];
  }
  if (t === 'hr') return [{ type: 'rule' }];
  if (t === 'pre') return [{ type: 'code', text: textOf(n).replace(/\n$/, '') }];
  if (t === 'ul' || t === 'ol') {
    const items = n.children.filter((c) => c.tag === 'li').map((li) => {
      const box = li.children.find((c) => c.tag === 'input');
      const item = { blocks: blocksOf(li.children) };
      if (box || cls(li).includes('task')) item.checked = !!box?.attrs.checked;
      return item;
    });
    return [{ type: 'list', ordered: t === 'ol', items }];
  }
  if (t === 'blockquote') return [{ type: 'quote', blocks: blocksOf(n.children) }];
  if (t === 'div' && cls(n).includes('md-alert')) {
    const kind = cls(n).match(/md-alert-(note|tip|important|warning|caution)/)?.[1];
    const title = n.children.find((c) => c.tag === 'p' && cls(c).includes('md-alert-title'));
    return [{ type: 'quote', kind, title: title ? textOf(title).trim() : undefined, blocks: blocksOf(n.children.filter((c) => c !== title)) }];
  }
  if (t === 'table') {
    const rowsOf = (section) => (section?.children || []).filter((c) => c.tag === 'tr')
      .map((tr) => tr.children.filter((c) => c.tag === 'td' || c.tag === 'th').map((cell) => trimRuns(runs(cell.children))));
    const head = rowsOf(n.children.find((c) => c.tag === 'thead'))[0] || [];
    return [{ type: 'table', head, rows: rowsOf(n.children.find((c) => c.tag === 'tbody')) }];
  }
  if (t === 'section' && cls(n).includes('md-footnotes')) return [{ type: 'rule' }, ...blocksOf(n.children)];
  return blocksOf(n.children);
}

export const markdownBlocks = (html) => blocksOf(tree(String(html ?? '')).children);
