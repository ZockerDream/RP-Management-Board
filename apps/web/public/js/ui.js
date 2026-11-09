import { markdownEditors } from './editor.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let currency = 'EUR';
export const setCurrency = (c) => { currency = c || 'EUR'; };
export const eur = (v, signed = false) => {
  const n = Number(v);
  const s = Math.abs(n).toLocaleString('de-DE', { style: 'currency', currency, minimumFractionDigits: 2 });
  return signed ? (n < 0 ? '−' : '+') + s : (n < 0 ? '−' : '') + s;
};
export const eur0 = (v) => Number(v).toLocaleString('de-DE', { style: 'currency', currency, maximumFractionDigits: 0 });
export const fdate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '–');
export const fdatetime = (d) => (d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
export const todayStr = () => new Date().toLocaleDateString('sv-SE');
export const monthStart = (offset = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).toLocaleDateString('sv-SE');
};
export const monthEnd = (offset = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset + 1, 0).toLocaleDateString('sv-SE');
};
export const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function toast(msg, bad = false) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  if (bad) t.style.background = 'var(--bad)';
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}

export const tag = (cls, text) => `<span class="tag ${cls}">${esc(text)}</span>`;
export const budgetTag = (type, name) => tag(type === 'solo' ? 'solo' : 'shared', name);
export const progress = (pct) => `<div class="progress"><i class="${pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : ''}" style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>`;
export const empty = (msg) => `<p class="muted" style="padding:12px 4px">${esc(msg)}</p>`;
export const opts = (list, sel, valueKey = 'id', labelKey = 'name') =>
  list.map((o) => `<option value="${esc(o[valueKey])}" ${String(o[valueKey]) === String(sel) ? 'selected' : ''}>${esc(o[labelKey])}</option>`).join('');

const eyeIcon = (visible) => visible
  ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.2 2.2-2.4 3.3M6.2 6.2C3.9 7.7 2.7 9.8 2.5 12c.5 1.4 1.7 3.2 4 4.6A10.3 10.3 0 0012 19c1 0 1.9-.2 2.7-.5"/></svg>'
  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="2.5"/></svg>';
export const passwordToggleButton = (label) =>
  `<button type="button" class="btn ghost sm password-toggle" data-password-toggle data-password-label="${esc(label)}" aria-label="${esc(label)} einblenden" title="${esc(label)} einblenden">${eyeIcon(false)}</button>`;

/* ---------- Modal-Formulare ---------- */
function fieldHtml(f) {
  const id = `f-${f.name}`;
  const common = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  const val = f.value ?? '';
  const cls = f.full ? 'field full' : 'field';
  if (f.type === 'checkbox') return `<label class="${cls} row start"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
  if (f.type === 'html') return `<div class="full">${f.html}</div>`;
  let input;
  if (f.type === 'select') input = `<select ${common}>${(f.options || []).map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
  else if (f.type === 'multi') {
    input = `<div class="stack" style="gap:6px;max-height:150px;overflow:auto">${(f.options || []).map((o) => `<label class="row start" style="font-weight:400;color:var(--text)"><input type="checkbox" name="${f.name}" value="${esc(o.v)}" ${(val || []).includes(o.v) ? 'checked' : ''}> ${esc(o.l)}</label>`).join('')}</div>`;
  } else if (f.type === 'textarea') input = `<textarea ${common} rows="${f.rows || 3}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}${f.markdown ? ' data-md' : ''}>${esc(val)}</textarea>`;
  else input = `<input type="${f.type || 'text'}" ${common} value="${esc(val)}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''} ${f.accept ? `accept="${esc(f.accept)}"` : ''} ${f.suggestions ? `list="${id}-list"` : ''}>`;
  // Vorschläge zum Antippen, freie Eingabe bleibt möglich (z. B. Rollen in einer Akte)
  if (f.suggestions) input += `<datalist id="${id}-list">${f.suggestions.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>`;
  if (f.type === 'password') input = `<span class="password-control">${input}${passwordToggleButton(f.label)}</span>`;
  // Markdown-Felder bekommen eine Werkzeugleiste; ein <label> drumherum würde Klicks in die Vorschau auf das Textfeld lenken
  if (f.markdown) return `<div class="${cls} md-field"><label for="${id}">${esc(f.label)}</label>${input}${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</div>`;
  return `<label class="${cls}">${esc(f.label)}${input}${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</label>`;
}

export function bindPasswordToggles(root) {
  $$('[data-password-toggle]', root).forEach((button) => {
    button.addEventListener('click', () => {
      const input = $('input', button.parentElement);
      const visible = input.type === 'password';
      const label = button.dataset.passwordLabel || 'Wert';
      input.type = visible ? 'text' : 'password';
      button.innerHTML = eyeIcon(visible);
      button.setAttribute('aria-label', `${label} ${visible ? 'ausblenden' : 'einblenden'}`);
      button.title = `${label} ${visible ? 'ausblenden' : 'einblenden'}`;
    });
  });
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'html') continue;
    if (f.type === 'checkbox') out[f.name] = form.elements[f.name].checked;
    else if (f.type === 'multi') out[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value);
    else out[f.name] = form.elements[f.name]?.value ?? '';
  }
  return out;
}

export function openForm({ title, fields, submit = 'Speichern', onSubmit, danger, extraButtons = '', wide }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal open';
    m.innerHTML = `<div class="card" ${wide ? 'style="width:720px"' : ''}><div class="card-head"><h2>${esc(title)}</h2></div>
      <form novalidate><div class="form">${fields.map(fieldHtml).join('')}</div>
      <p class="auth-error" role="alert" hidden></p>
      <div class="modal-foot"><button type="button" class="btn ghost" data-x>Abbrechen</button>${extraButtons}<button type="submit" class="btn ${danger ? 'danger' : ''}">${esc(submit)}</button></div></form></div>`;
    $('#modals').append(m);
    const form = $('form', m);
    bindPasswordToggles(m);
    markdownEditors(m);
    const err = $('.auth-error', m);
    const close = (v) => { m.remove(); resolve(v); };
    m.addEventListener('click', (e) => { if (e.target === m) close(null); });
    $('[data-x]', m).addEventListener('click', () => close(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) return form.reportValidity();
      const btn = $('button[type=submit]', m);
      btn.disabled = true;
      err.hidden = true;
      try {
        const res = await onSubmit(readForm(form, fields), m);
        if (res === false) { btn.disabled = false; return; }
        close(res ?? true);
      } catch (ex) {
        err.textContent = ex.message || 'Fehler';
        err.hidden = false;
        btn.disabled = false;
      }
    });
    form.querySelector('input:not([type=hidden]),select,textarea')?.focus();
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
  });
}

export const confirmBox = (title, text, label = 'Löschen') =>
  openForm({ title, fields: [{ type: 'html', html: `<p>${esc(text)}</p>` }], submit: label, danger: true, onSubmit: async () => true }).then(Boolean);

export function showSecret(title, text, secret) {
  return openForm({
    title, submit: 'Schließen', fields: [{ type: 'html', html: `<p class="muted">${esc(text)}</p><span class="secret" style="word-break:break-all;display:block;margin-top:8px">${esc(secret)}</span>` }],
    onSubmit: async () => true,
  });
}

export const download = (name, content, type = 'text/plain') => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};

export const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const parseAmount = (v) => String(v).trim().replace(/\./g, (m, i, s) => (s.includes(',') ? '' : m)).replace(',', '.');

// Nur diesen Bereich drucken (Akte, Bericht, Personenakte); alles andere blendet das Druck-CSS aus.
// Zugeklappte Abschnitte (<details>) werden dafür geöffnet, alle Tabs einer Akte erscheinen untereinander.
export function printArea(el) {
  el.querySelectorAll('details').forEach((d) => { d.open = true; });
  document.body.classList.add('printing');
  el.classList.add('print-area');
  const done = () => {
    el.classList.remove('print-area');
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
