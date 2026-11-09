import { test } from 'node:test';
import assert from 'node:assert/strict';
// Der Renderer läuft im Browser, kommt aber ohne DOM aus und lässt sich deshalb hier prüfen
import { renderMarkdown as md, renderInline } from '../../web/public/js/markdown.js';

const has = (html, ...parts) => { for (const part of parts) assert.ok(html.includes(part), `${part}\n  in ${html}`); };
const lacks = (html, ...parts) => { for (const part of parts) assert.ok(!html.includes(part), `${part} darf nicht vorkommen\n  in ${html}`); };

test('headings: ATX one level lower than the page title, setext, closing hashes, no hashtag', () => {
  assert.equal(md('# Eins'), '<h2>Eins</h2>');
  assert.equal(md('###### Sechs ###'), '<h6>Sechs</h6>');
  assert.equal(md('Titel\n====='), '<h2>Titel</h2>');
  assert.equal(md('Titel\n---'), '<h3>Titel</h3>');
  assert.equal(md('#hashtag'), '<p>#hashtag</p>');
});

test('emphasis, strikethrough and literal asterisks or underscores', () => {
  assert.equal(md('**fett** *kursiv* ***beides*** ~~weg~~ __auch__ _so_'),
    '<p><strong>fett</strong> <em>kursiv</em> <strong><em>beides</em></strong> <del>weg</del> <strong>auch</strong> <em>so</em></p>');
  assert.equal(md('*a **b** c*'), '<p><em>a <strong>b</strong> c</em></p>');
  assert.equal(md('snake_case_name und 5 * 3 * 2'), '<p>snake_case_name und 5 * 3 * 2</p>');
  assert.equal(md('\\*kein\\* \\_Text\\_'), '<p>*kein* _Text_</p>');
});

test('code spans and code blocks keep their content literally', () => {
  assert.equal(md('`a < b` und ``x `y` z``'), '<p><code>a &lt; b</code> und <code>x `y` z</code></p>');
  assert.equal(md('`**nicht fett**`'), '<p><code>**nicht fett**</code></p>');
  assert.equal(md('```js\nconst a = "<b>";\n\n**x**\n```'), '<pre data-lang="js"><code class="language-js">const a = &quot;&lt;b&gt;&quot;;\n\n**x**</code></pre>');
  assert.equal(md('~~~\n```\n~~~'), '<pre><code>```</code></pre>');
  assert.equal(md('Text\n\n    eingerückt\n    Code'), '<p>Text</p><pre><code>eingerückt\nCode</code></pre>');
  assert.equal(md('```\noffen bis zum Ende'), '<pre><code>offen bis zum Ende</code></pre>');
});

test('line breaks stay line breaks inside paragraphs, blank lines separate paragraphs', () => {
  assert.equal(md('eins\nzwei  \ndrei\\\nvier\n\nfünf'), '<p>eins<br>zwei<br>drei<br>vier</p><p>fünf</p>');
});

test('lists: nested, ordered with start, tight and loose, lazy continuation', () => {
  assert.equal(md('- a\n- b\n  - c\n  - d\n- e'), '<ul><li>a</li><li>b<ul><li>c</li><li>d</li></ul></li><li>e</li></ul>');
  assert.equal(md('3. drei\n4. vier'), '<ol start="3"><li>drei</li><li>vier</li></ol>');
  assert.equal(md('- a\n\n- b'), '<ul><li><p>a</p></li><li><p>b</p></li></ul>');
  assert.equal(md('- a\n  weiter\nträge'), '<ul><li>a<br>weiter<br>träge</li></ul>');
  // Großzügig: zwei Leerzeichen unter „1.“ reichen für einen Unterpunkt
  assert.equal(md('1. a\n  - b\n2. c'), '<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>');
  // Wechsel der Markierung beginnt eine neue Liste
  assert.equal(md('- a\n* b'), '<ul><li>a</li></ul><ul><li>b</li></ul>');
  assert.equal(md('- a\n  - b\n\n  - c'), '<ul><li>a<ul><li><p>b</p></li><li><p>c</p></li></ul></li></ul>');
  assert.equal(md('- Punkt\n\n  ```\n  code\n  ```'), '<ul><li><p>Punkt</p><pre><code>code</code></pre></li></ul>');
});

test('task lists render disabled checkboxes', () => {
  const html = md('- [ ] offen\n- [x] erledigt\n- normal');
  has(html, '<ul class="contains-task-list">', '<li class="task"><input type="checkbox" disabled aria-label="Offen"> offen</li>',
    '<li class="task"><input type="checkbox" disabled checked aria-label="Erledigt"> erledigt</li>', '<li>normal</li>');
});

test('paragraphs end at headings, lists, quotes and fences; ordered lists only interrupt with 1', () => {
  assert.equal(md('Text\n# H'), '<p>Text</p><h2>H</h2>');
  assert.equal(md('Text\n- a'), '<p>Text</p><ul><li>a</li></ul>');
  assert.equal(md('Am\n2. Tag'), '<p>Am<br>2. Tag</p>');
  assert.equal(md('Text\n> Zitat'), '<p>Text</p><blockquote><p>Zitat</p></blockquote>');
  assert.equal(md('***\n___\n- - -'), '<hr><hr><hr>');
});

test('block quotes nest and contain other blocks; GitHub alerts become boxes', () => {
  assert.equal(md('> a\n> > b\n> - c'), '<blockquote><p>a</p><blockquote><p>b</p></blockquote><ul><li>c</li></ul></blockquote>');
  assert.equal(md('> a\nträge'), '<blockquote><p>a<br>träge</p></blockquote>');
  assert.equal(md('> [!WARNING]\n> Vorsicht, **heiß**'), '<div class="md-alert md-alert-warning"><p class="md-alert-title">Warnung</p><p>Vorsicht, <strong>heiß</strong></p></div>');
});

test('tables with alignment, inline formatting, escaped pipes and missing cells', () => {
  const html = md('| Name | Wert | Mitte |\n|:-----|-----:|:-----:|\n| **a** | `1\\|2` | x |\n| b |');
  has(html, '<div class="md-table"><table><thead><tr><th style="text-align:left">Name</th><th style="text-align:right">Wert</th><th style="text-align:center">Mitte</th></tr></thead>',
    '<td style="text-align:left"><strong>a</strong></td><td style="text-align:right"><code>1|2</code></td>', '<tr><td style="text-align:left">b</td><td style="text-align:right"></td><td style="text-align:center"></td></tr>');
  assert.equal(md('a | b\n--|--\n1 | 2'), '<div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>');
  // Ohne passende Trennzeile keine Tabelle
  assert.equal(md('a | b\n---'), '<h3>a | b</h3>');
});

test('links: inline with title, references, autolinks, bare URLs, emails and app pages', () => {
  assert.equal(renderInline('[Docs](https://example.com/a_(b) "Titel")'), '<a href="https://example.com/a_(b)" title="Titel" target="_blank" rel="noopener noreferrer">Docs</a>');
  assert.equal(md('[Seite][ref] und [ref]\n\n[ref]: https://example.com "T"'), '<p><a href="https://example.com" title="T" target="_blank" rel="noopener noreferrer">Seite</a> und <a href="https://example.com" title="T" target="_blank" rel="noopener noreferrer">ref</a></p>');
  has(renderInline('<https://a.de/x> und <mail@a.de>'), 'href="https://a.de/x"', 'href="mailto:mail@a.de"');
  assert.equal(renderInline('Siehe https://a.de/x_y). Oder www.b.de.'),
    'Siehe <a href="https://a.de/x_y" target="_blank" rel="noopener noreferrer">https://a.de/x_y</a>). Oder <a href="https://www.b.de" target="_blank" rel="noopener noreferrer">www.b.de</a>.');
  has(renderInline('Schreib an max.muster@example.com.'), '<a href="mailto:max.muster@example.com" target="_blank" rel="noopener noreferrer">max.muster@example.com</a>.');
  assert.equal(renderInline('[Akten](#/casefiles)'), '<a href="#/casefiles">Akten</a>');
  assert.equal(renderInline('[Google](google.com)'), '<a href="https://google.com" target="_blank" rel="noopener noreferrer">Google</a>');
  assert.equal(renderInline('**[fett](https://a.de)**'), '<strong><a href="https://a.de" target="_blank" rel="noopener noreferrer">fett</a></strong>');
  // Unterstriche in Adressen sind keine Hervorhebung
  has(renderInline('_https://a.de/a_b_c_'), 'href="https://a.de/a_b_c"');
  // Keine Definition: „siehe oben“ ist keine Adresse
  assert.equal(md('[Hinweis]: siehe oben'), '<p>[Hinweis]: siehe oben</p>');
});

test('images: data images inline, external images only as link', () => {
  has(md('![Logo](data:image/png;base64,iVBORw0KGgo=)'), '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Logo" loading="lazy">');
  const external = md('![Karte](https://maps.example.com/k.png)');
  has(external, '<a class="md-image-link" href="https://maps.example.com/k.png"', '<span>Karte</span>');
  lacks(external, '<img');
  lacks(md('![x](data:image/svg+xml;base64,PHN2Zz4=)'), '<img');
});

test('footnotes are numbered by first use and jump by button, not by #', () => {
  const html = md('Text[^b] und[^a] und[^b]\n\n[^a]: Erste\n[^b]: Zweite *kursiv*');
  assert.match(html, /<sup class="md-fn-ref"><button type="button" class="md-fn" data-md-fn="(md\d+)-fn-1" id="\1-ref-1" aria-label="Fußnote 1">1<\/button><\/sup>/);
  assert.equal((html.match(/id="md\d+-ref-1"/g) || []).length, 1, 'zweiter Verweis ohne doppelte ID');
  has(html, '<section class="md-footnotes" aria-label="Fußnoten"><ol>', 'Zweite <em>kursiv</em> <button type="button" class="md-fn md-fn-back"');
  assert.ok(html.indexOf('Zweite') < html.indexOf('Erste'), 'Reihenfolge nach erstem Verweis');
  lacks(html, 'href="#');
  assert.equal(md('Ohne[^x] Definition'), '<p>Ohne[^x] Definition</p>');
});

test('HTML is shown as text; only a few harmless tags without attributes survive', () => {
  assert.equal(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(md('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(renderInline('<kbd>Strg</kbd>+<kbd>C</kbd> und H<sub>2</sub>O<br>neu'), '<kbd>Strg</kbd>+<kbd>C</kbd> und H<sub>2</sub>O<br>neu');
  assert.equal(renderInline('<kbd onclick="x()">a</kbd>'), '&lt;kbd onclick=&quot;x()&quot;&gt;a&lt;/kbd&gt;');
  assert.equal(renderInline('</b>offen<b>zu</b>'), '&lt;/b&gt;offen<b>zu</b>');
});

test('dangerous links never become clickable', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.example/x']) {
    const html = renderInline(`[klick](${url})`);
    lacks(html, '<a ');
  }
  lacks(md('[x]: javascript:alert(1)\n\n[x]'), '<a ');
  const title = renderInline('[a](https://a.de "\\"><svg onload=alert(1)>")');
  lacks(title, '<svg');
  has(title, 'title="&quot;&gt;&lt;svg onload=alert(1)&gt;"');
  lacks(renderInline('https://a.de/"onmouseover="alert(1)'), '"onmouseover');
  lacks(md('```"><script>\nx\n```'), '<script');
});

test('robust against odd input', () => {
  assert.equal(md(''), '');
  assert.equal(md(null), '');
  assert.equal(md('1 Text'), '<p>1 Text</p>');
  assert.equal(md('[nicht [geschlossen'), '<p>[nicht [geschlossen</p>');
  assert.equal(md('`offen'), '<p>`offen</p>');
  // Viele offene Klammern und Sterne bleiben schnell
  const started = Date.now();
  md(`${'[*_'.repeat(3000)}\n${'| a '.repeat(500)}\n`);
  assert.ok(Date.now() - started < 2000, 'langsam');
});
