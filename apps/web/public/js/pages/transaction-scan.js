// Screenshot-Scanning für Ein- und Ausgaben (Wunsch des Auftraggebers vom 2026-11-10): Bild wählen, einfügen oder
// hineinziehen, der Server liest den Text (Tesseract, lokal) und schlägt Buchungen vor. Gebucht wird nur, was man hier
// prüft und anhakt; was es auf dem Konto schon gibt (gleiches Datum, gleiche Art, gleicher Betrag), ist abgewählt.
import { api } from '../api.js';
import { $, $$, esc, openForm, toast, todayStr } from '../ui.js';
import { loadBudgets } from './common.js';

const TYPE_OPTIONS = [['expense', 'Ausgabe'], ['income', 'Einnahme']];

// Texterkennung liest dunklen Text auf hellem Grund in ausreichender Größe am besten. Screenshots aus dem Spiel mischen
// beides: ein dunkles Handy mit heller oder farbiger Schrift vor buntem Hintergrund. Deshalb zählt der lokale Kontrast:
// Jeder Punkt wird mit dem Mittel seiner Umgebung verglichen; was sich in Richtung Schrift deutlich abhebt, wird
// schwarz, der Rest weiß.
// Dazu werden kleine Bilder vergrößert (Schrift von 12–16 px ist für die Erkennung zu klein).
const WINDOW = 41;
const MAX_PIXELS = 8e6;
export async function prepareImage(blob) {
  const bitmap = await createImageBitmap(blob);
  let scale = Math.min(3, Math.max(1.5, 1800 / bitmap.width));
  scale = Math.min(scale, 5000 / bitmap.width, 5000 / bitmap.height, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
  const canvas = document.createElement('canvas');
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  // Mittel über WINDOW × WINDOW Punkte als laufende Summe, erst je Zeile, dann je Spalte
  const r = WINDOW >> 1;
  const rows = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += gray[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      rows[o + x] = sum;
      sum += gray[o + Math.min(w - 1, x + r + 1)] - gray[o + Math.max(0, x - r)];
    }
  }
  const area = WINDOW * WINDOW;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += rows[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      const j = y * w + x;
      const mean = sum / area;
      // Auf hellem Grund ist Schrift dunkler als ihre Umgebung, auf dunklem heller; der Rand daneben weicht in die
      // andere Richtung ab und bleibt so weiß. Bis 10 Helligkeitsstufen Abstand weiß, ab 50 schwarz.
      const diff = mean >= 128 ? mean - gray[j] : gray[j] - mean;
      const value = 255 - Math.min(255, Math.max(0, ((diff - 10) * 255) / 40));
      const i = j * 4;
      px[i] = px[i + 1] = px[i + 2] = value;
      px[i + 3] = 255;
      sum += rows[Math.min(h - 1, y + r + 1) * w + x] - rows[Math.max(0, y - r) * w + x];
    }
  }
  ctx.putImageData(image, 0, 0);
  const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  // Sehr große Bilder als JPEG, damit sie unter der Upload-Grenze bleiben
  const result = png && png.size <= 8 * 1048576 ? png : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  return { blob: result, preview: canvas.toDataURL('image/jpeg', 0.6) };
}

const sameAmount = (a, b) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);

export async function scanForm() {
  const budgets = await loadBudgets();
  if (!budgets.length) { toast('Bitte zuerst ein Konto anlegen', true); return false; }
  let items = [];
  let busy = false;
  const done = openForm({
    title: 'Screenshot scannen', wide: true, submit: 'Buchen',
    fields: [
      { type: 'html', html: `<div class="scan-drop" id="scan-drop" tabindex="0" role="button" aria-label="Screenshot wählen oder einfügen">
          <b>Screenshot hierher ziehen, mit Strg+V einfügen oder klicken</b><small class="muted">PNG oder JPEG, z. B. die Umsatzliste deiner Bank-App. Das Bild wird nur gelesen und nicht gespeichert.</small>
          <img id="scan-preview" alt="" hidden></div><input type="file" id="scan-file" accept="image/png,image/jpeg" hidden>
        <p id="scan-status" class="muted" role="status"></p>` },
      { name: 'budget_id', label: 'Konto', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })), value: budgets[0].id, full: true },
      { type: 'html', html: '<div id="scan-result"></div>' },
    ],
    onSubmit: async (values, modal) => {
      if (busy) return false;
      const chosen = readRows(modal).filter((row) => row.use);
      if (!items.length) throw new Error('Wähle zuerst einen Screenshot');
      if (!chosen.length) throw new Error('Keine Buchung ausgewählt');
      for (const row of chosen) {
        if (!/^\d{1,12}([.,]\d{1,2})?$/.test(row.amount)) throw new Error(`Ungültiger Betrag: ${row.amount || '(leer)'}`);
        if (!row.booked_at) throw new Error('Jede Buchung braucht ein Datum');
      }
      const r = await api.post('/transactions/import', {
        budget_id: values.budget_id,
        items: chosen.map((row) => ({ type: row.type, amount: row.amount.replace(',', '.'), booked_at: row.booked_at, title: row.title, category_id: row.category_id || null })),
      });
      toast(`${r.created} ${r.created === 1 ? 'Buchung' : 'Buchungen'} angelegt`);
      return true;
    },
  });
  const modal = $('#modals .modal:last-child');
  // Breiter als ein normales Formular, damit Text und Betrag nebeneinander lesbar bleiben
  $('.card', modal).style.width = '980px';
  const status = $('#scan-status', modal);
  const input = $('#scan-file', modal);
  const drop = $('#scan-drop', modal);
  const account = $('#f-budget_id', modal);
  const categories = () => budgets.find((b) => b.id === account.value)?.categories || [];

  function readRows(root) {
    return $$('[data-scan-row]', root).map((tr) => ({
      use: $('[data-k=use]', tr).checked, booked_at: $('[data-k=booked_at]', tr).value, title: $('[data-k=title]', tr).value.trim(),
      type: $('[data-k=type]', tr).value, amount: $('[data-k=amount]', tr).value.trim(), category_id: $('[data-k=category_id]', tr).value,
    }));
  }

  // Schon gebuchte Vorschläge erkennen: gleiches Konto, Datum, Art und Betrag
  async function markDuplicates() {
    if (!items.length) return;
    const dates = items.map((x) => x.booked_at).sort();
    const known = await api.get(`/transactions?${new URLSearchParams({ budget_id: account.value, from: dates[0], to: dates.at(-1), limit: 500 })}`).then((r) => r.items).catch(() => []);
    items.forEach((x) => { x.duplicate = known.some((t) => t.booked_at.slice(0, 10) === x.booked_at && t.type === x.type && sameAmount(t.amount, x.amount)); });
  }

  function drawRows() {
    const box = $('#scan-result', modal);
    if (!items.length) { box.innerHTML = ''; return; }
    const cats = categories();
    const duplicates = items.filter((x) => x.duplicate).length;
    box.innerHTML = `<p class="muted">${items.length} ${items.length === 1 ? 'Buchung' : 'Buchungen'} erkannt. Prüfe Datum, Text, Art und Betrag; <span class="tag warn">geraten</span> heißt, dass der Screenshot dazu nichts Eindeutiges zeigte.${duplicates ? ` ${duplicates} ${duplicates === 1 ? 'steht' : 'stehen'} schon auf dem Konto und ${duplicates === 1 ? 'ist' : 'sind'} abgewählt.` : ''}</p>
      <div class="scroll-x"><table class="table scan-table"><thead><tr><th><input type="checkbox" id="scan-all" aria-label="Alle auswählen" ${items.every((x) => x.use) ? 'checked' : ''}></th><th>Datum</th><th>Text</th><th>Art</th><th>Betrag</th><th>Kategorie</th></tr></thead><tbody>
      ${items.map((x, i) => `<tr data-scan-row="${i}" title="${esc(x.text)}">
        <td><input type="checkbox" data-k="use" aria-label="Buchung übernehmen" ${x.use ? 'checked' : ''}></td>
        <td><input type="date" data-k="booked_at" value="${esc(x.booked_at)}" max="${todayStr()}" aria-label="Datum">${x.guessed.date ? '<span class="tag warn">geraten</span>' : ''}</td>
        <td><input data-k="title" value="${esc(x.title)}" maxlength="200" aria-label="Text">${x.duplicate ? '<span class="tag">schon gebucht</span>' : ''}</td>
        <td><select data-k="type" aria-label="Art">${TYPE_OPTIONS.map(([v, l]) => `<option value="${v}" ${x.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${x.guessed.type ? '<span class="tag warn">geraten</span>' : ''}</td>
        <td><input data-k="amount" value="${esc(String(x.amount).replace('.', ','))}" inputmode="decimal" aria-label="Betrag" style="width:110px"></td>
        <td><select data-k="category_id" aria-label="Kategorie"><option value="">– Keine –</option>${cats.map((c) => `<option value="${c.id}" ${x.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>
      <details><summary>Erkannter Text</summary><pre class="scan-text">${esc(lastText)}</pre></details>`;
    $('#scan-all', box).addEventListener('change', (e) => $$('[data-k=use]', box).forEach((c) => { c.checked = e.target.checked; }));
  }

  // Änderungen in der Tabelle merken, damit ein Kontowechsel sie nicht verwirft
  function keepEdits() {
    readRows(modal).forEach((row, i) => Object.assign(items[i], { use: row.use, booked_at: row.booked_at, title: row.title, type: row.type, amount: row.amount.replace(',', '.'), category_id: row.category_id }));
  }

  let lastText = '';
  async function scan(file) {
    if (!file || busy) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { status.textContent = 'Nur PNG und JPEG.'; return; }
    busy = true;
    status.textContent = 'Bild wird vorbereitet …';
    try {
      const prepared = await prepareImage(file);
      const preview = $('#scan-preview', modal);
      preview.src = prepared.preview;
      preview.hidden = false;
      status.textContent = 'Text wird erkannt … (kann einige Sekunden dauern)';
      const form = new FormData();
      form.append('file', prepared.blob, prepared.blob.type === 'image/png' ? 'screenshot.png' : 'screenshot.jpg');
      const r = await api.post(`/transactions/scan?today=${todayStr()}`, form);
      lastText = r.text;
      items = r.items.map((x) => ({ ...x, use: true, category_id: '' }));
      await markDuplicates();
      items.forEach((x) => { if (x.duplicate) x.use = false; });
      status.textContent = items.length ? '' : 'Im Bild wurde kein Betrag gefunden. Nimm einen schärferen oder größeren Ausschnitt, auf dem Beträge mit Währung oder Vorzeichen stehen.';
      drawRows();
      if (!items.length && lastText.trim()) $('#scan-result', modal).innerHTML = `<details open><summary>Erkannter Text</summary><pre class="scan-text">${esc(lastText)}</pre></details>`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
    }
  }

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { scan(input.files[0]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); scan(e.dataTransfer.files[0]); });
  const onPaste = (e) => {
    const file = [...(e.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'))?.getAsFile();
    if (file) { e.preventDefault(); scan(file); }
  };
  document.addEventListener('paste', onPaste);
  account.addEventListener('change', async () => {
    keepEdits();
    items.forEach((x) => { x.category_id = ''; });
    const before = items.map((x) => x.duplicate);
    await markDuplicates();
    items.forEach((x, i) => { if (x.duplicate && !before[i]) x.use = false; });
    drawRows();
  });
  const result = await done;
  document.removeEventListener('paste', onPaste);
  return result;
}
