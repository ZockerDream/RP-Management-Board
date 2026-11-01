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

/* ---------- Modal-Formulare ---------- */
function fieldHtml(f) {
  const id = `f-${f.name}`;
  const common = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  const val = f.value ?? '';
  const cls = f.full ? 'field full' : 'field';
  if (f.type === 'checkbox') return `<label class="${cls} row start"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
  if (f.type === 'html') return `<div class="full">${f.html}</div>`;
  let input;
  if (f.type === 'select') input = `<select ${common}>${(f.options || []).map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
  else if (f.type === 'multi') {
    input = `<div class="stack" style="gap:6px;max-height:150px;overflow:auto">${(f.options || []).map((o) => `<label class="row start" style="font-weight:400;color:var(--text)"><input type="checkbox" name="${f.name}" value="${esc(o.v)}" ${(val || []).includes(o.v) ? 'checked' : ''}> ${esc(o.l)}</label>`).join('')}</div>`;
  } else if (f.type === 'textarea') input = `<textarea ${common} rows="3">${esc(val)}</textarea>`;
  else input = `<input type="${f.type || 'text'}" ${common} value="${esc(val)}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`;
  return `<label class="${cls}">${esc(f.label)}${input}${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</label>`;
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
