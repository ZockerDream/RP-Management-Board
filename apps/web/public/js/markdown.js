// Kleine, sichere Textformatierung für Dokumentationen, Notizen und Beschreibungen: erst alles maskieren, dann wenige Auszeichnungen erlauben.
// Unterstützt: # Überschriften, **fett**, *kursiv*, `Code`, Listen mit - oder 1., > Zitate, --- Trennlinie, Links nur mit http(s).
import { esc } from './ui.js';

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export const MARKDOWN_HELP = 'Markdown: # Überschrift, **fett**, *kursiv*, - Liste, 1. Liste, > Zitat, --- Linie, [Text](https://…)';
// Für einzeilige Stellen wie Tabellenzellen: nur fett, kursiv, Code und Links
export const renderInline = (source) => inline(String(source ?? ''));
// Formatierter Block; die Klassen sorgen für Abstände wie in Dokumentationen
export const markdownBlock = (source, extra = '') => `<div class="doc-body md ${extra}">${renderMarkdown(source)}</div>`;

export function renderMarkdown(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushParagraph(); closeList(); out.push('<hr>'); continue; }
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    if (quote) { flushParagraph(); closeList(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return out.join('');
}
