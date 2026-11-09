// Test im Tool: Karte in der Schulung, Fragen bearbeiten, Test machen (mit Countdown) und Antworten ansehen
import { api } from '../api.js';
import { $, esc, fdatetime, tag, openForm, confirmBox, toast, empty } from '../ui.js';
import { markdownBlock } from '../markdown.js';

const MAX_OPTIONS = 8;
const STATUS = { open: ['warn', 'Läuft'], submitted: ['', 'Abgegeben'], expired: ['bad', 'Zeit abgelaufen'] };
const resultTag = (a) => (a.status === 'open' ? tag(...STATUS.open) : a.passed ? tag('ok', `Bestanden ${a.percent} %`) : tag('bad', `Nicht bestanden ${a.percent ?? 0} %`));
// Antworten eines offenen Versuchs im Browser merken, damit „Später weitermachen“ nichts verliert
const store = {
  get: (id) => { try { return JSON.parse(localStorage.getItem(`exam:${id}`) || '{}'); } catch { return {}; } },
  set: (id, v) => { try { localStorage.setItem(`exam:${id}`, JSON.stringify(v)); } catch { /* privat oder voll: dann eben nicht */ } },
  drop: (id) => { try { localStorage.removeItem(`exam:${id}`); } catch { /* egal */ } },
};

export const examFacts = (e) => [`${e.questions} ${e.questions === 1 ? 'Frage' : 'Fragen'}`, `${e.points} Punkte`, `bestanden ab ${e.pass_percent} %`,
  e.time_limit ? `${e.time_limit} Minuten` : 'ohne Zeitlimit', e.max_attempts ? `${e.max_attempts} ${e.max_attempts === 1 ? 'Versuch' : 'Versuche'}` : 'Versuche unbegrenzt',
  e.after_session ? 'nach Teilnahme an einem Termin' : ''].filter(Boolean).join(' · ');

export function examCardHtml(t, { manage, write }) {
  const e = t.exam;
  if (!e) return '';
  const action = e.open_attempt ? '<button class="btn" data-exam-start>Test fortsetzen</button>'
    : e.can_start ? '<button class="btn" data-exam-start>Test starten</button>' : `<span class="muted">${esc(e.reason || '')}</span>`;
  const mine = e.mine.filter((a) => a.status !== 'open');
  // Je Person einmal „Versuche zurücksetzen“, wenn sie gezählte Versuche hat
  const resettable = new Set((e.all || []).filter((a) => a.counted && a.status !== 'open').map((a) => a.user_id));
  return `<div class="card exam-card"><div class="card-head"><h2>Test im Tool</h2><div class="row wrap">${manage ? '<button class="btn ghost sm" data-exam-questions>Fragen bearbeiten</button>' : ''}${action}</div></div>
    <p class="muted">${examFacts(e)}. Bestanden ist die Schulung erst mit bestandenem Test; ${t.level >= 3 ? 'Personen ohne Zugang trägst du weiter von Hand ein.' : 'das Ergebnis kommt sofort.'}</p>
    ${e.attempts_left !== null && !e.open_attempt ? `<p><small class="muted">Noch ${e.attempts_left} ${e.attempts_left === 1 ? 'Versuch' : 'Versuche'} für dich.</small></p>` : ''}
    ${mine.length ? `<h3>Deine Versuche</h3>${mine.map((a) => `<div class="list-item"><div class="grow">${fdatetime(a.submitted_at || a.started_at)}${a.counted ? '' : ' <small class="muted">(zurückgesetzt)</small>'}</div>${resultTag(a)}</div>`).join('')}` : ''}
    ${e.all ? `<h3>Alle Versuche</h3>${e.all.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Teilnehmer</th><th>Abgegeben</th><th>Punkte</th><th>Ergebnis</th><th></th></tr></thead><tbody>
      ${e.all.map((a) => `<tr><td><b>${esc(a.user_name)}</b>${a.counted ? '' : ' <small class="muted">zurückgesetzt</small>'}</td><td>${a.submitted_at ? fdatetime(a.submitted_at) : `seit ${fdatetime(a.started_at)}`}</td>
        <td>${a.score ?? '–'} / ${a.max_score ?? '–'}</td><td>${resultTag(a)}</td>
        <td style="white-space:nowrap">${write && a.status !== 'open' ? `<button class="btn ghost sm" data-attempt="${a.id}">Antworten</button>` : ''}${write && resettable.delete(a.user_id) ? ` <button class="btn ghost sm" data-exam-reset="${a.user_id}">Versuche zurücksetzen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Noch niemand hat den Test gemacht.')}` : ''}
    <div id="exam-questions"></div></div>`;
}

// ---------- Fragen
export async function drawQuestions(el, t) {
  const questions = await api.get(`/trainings/${t.id}/questions`);
  el.innerHTML = `<div class="card-head"><h3>Fragen (${questions.length})</h3><button class="btn ghost sm" data-q-new>Frage hinzufügen</button></div>
    ${questions.length ? questions.map((q, i) => `<div class="exam-q-edit"><div class="row wrap"><b>${i + 1}.</b>${tag('', q.kind === 'single' ? 'Eine Antwort' : 'Mehrere Antworten')}${tag('', `${q.points} ${q.points === 1 ? 'Punkt' : 'Punkte'}`)}<span class="grow"></span>
        <button class="btn ghost sm" data-q-edit="${q.id}">Bearbeiten</button><button class="btn ghost sm" data-q-del="${q.id}">Löschen</button></div>
      ${markdownBlock(q.text)}<ul class="exam-options">${q.options.map((o) => `<li class="${o.correct ? 'correct' : ''}">${o.correct ? '✓' : '·'} ${esc(o.text)}</li>`).join('')}</ul>
      ${q.explanation ? `<small class="muted">${esc(q.explanation)}</small>` : ''}</div>`).join('') : empty('Noch keine Fragen. Ohne Fragen lässt sich der Test nicht starten.')}`;
  el.questions = questions;
}

export function questionForm(t, q) {
  const option = (i) => q?.options[i];
  return openForm({
    title: q ? 'Frage bearbeiten' : 'Neue Frage',
    wide: true,
    fields: [
      { name: 'text', label: 'Frage', type: 'textarea', rows: 3, value: q?.text, required: true, maxlength: 2000, full: true },
      { name: 'kind', label: 'Art', type: 'select', options: [{ v: 'single', l: 'Eine richtige Antwort' }, { v: 'multiple', l: 'Mehrere richtige Antworten' }], value: q?.kind || 'single' },
      { name: 'points', label: 'Punkte', type: 'number', min: 1, max: 100, value: q?.points ?? 1 },
      { type: 'html', html: '<p class="muted">Mindestens zwei Antworten; leere Zeilen werden ignoriert. Für Wahr/Falsch zwei Antworten anlegen. Bei mehreren richtigen Antworten zählt die Frage nur, wenn genau die richtigen angekreuzt sind.</p>' },
      ...Array.from({ length: MAX_OPTIONS }, (_, i) => [
        { name: `option${i}`, label: `Antwort ${i + 1}`, value: option(i)?.text || '', maxlength: 500 },
        { name: `correct${i}`, label: 'richtig', type: 'checkbox', value: !!option(i)?.correct },
      ]).flat(),
      { name: 'explanation', label: 'Erklärung (nur für Ausbilder)', type: 'textarea', rows: 2, value: q?.explanation, maxlength: 2000, full: true },
    ],
    onSubmit: async (v) => {
      // IDs vorhandener Antworten bleiben, damit alte Versuche lesbar bleiben
      const options = Array.from({ length: MAX_OPTIONS }, (_, i) => ({ id: option(i)?.id, text: v[`option${i}`].trim(), correct: v[`correct${i}`] })).filter((o) => o.text);
      const body = { text: v.text.trim(), kind: v.kind, points: Number(v.points) || 1, options, explanation: v.explanation };
      if (q) await api.patch(`/training-questions/${q.id}`, body);
      else await api.post(`/trainings/${t.id}/questions`, body);
      toast('Frage gespeichert');
    },
  });
}

// ---------- Test machen
export async function takeExam(el, t, onDone) {
  const attempt = await api.post(`/trainings/${t.id}/exam/start`);
  const saved = { ...attempt.answers, ...store.get(attempt.id) };
  const offset = new Date(attempt.server_time).getTime() - Date.now();
  el.innerHTML = `<div class="card exam"><div class="card-head"><div><h2>Test: ${esc(attempt.training_name)}</h2><small class="muted">Bestanden ab ${attempt.pass_percent} % · ${attempt.questions.length} Fragen</small></div>
      ${attempt.deadline ? '<span class="tag warn exam-timer" id="exam-timer" aria-live="polite"></span>' : ''}</div>
    <p class="muted">Bei Fragen mit mehreren richtigen Antworten zählt die Frage nur, wenn genau die richtigen angekreuzt sind.</p>
    <form id="exam-form">${attempt.questions.map((q, i) => `<fieldset class="exam-q"><legend><b>${i + 1}.</b> <small class="muted">${q.points} ${q.points === 1 ? 'Punkt' : 'Punkte'}${q.kind === 'multiple' ? ' · mehrere Antworten möglich' : ''}</small></legend>
        ${markdownBlock(q.text)}${q.options.map((o) => `<label class="exam-option"><input type="${q.kind === 'single' ? 'radio' : 'checkbox'}" name="${q.id}" value="${o.id}" ${(saved[q.id] || []).includes(o.id) ? 'checked' : ''}> ${esc(o.text)}</label>`).join('')}</fieldset>`).join('')}
      <div class="modal-foot"><button type="button" class="btn ghost" id="exam-later">Später weitermachen</button><button type="submit" class="btn">Abgeben</button></div></form></div>`;
  const form = $('#exam-form', el);
  const answers = () => Object.fromEntries(attempt.questions.map((q) => [q.id, [...form.querySelectorAll(`input[name="${q.id}"]:checked`)].map((x) => x.value)]));
  form.addEventListener('change', () => store.set(attempt.id, answers()));
  let timer = 0;
  let sending = false;
  const stop = () => clearInterval(timer);
  const submit = async (auto) => {
    if (sending) return;
    sending = true;
    stop();
    try {
      const r = await api.post(`/training-attempts/${attempt.id}/submit`, { answers: answers() });
      store.drop(attempt.id);
      el.innerHTML = `<div class="card exam-result ${r.passed ? 'ok' : 'bad'}"><div class="card-head"><h2>${r.passed ? 'Bestanden' : 'Nicht bestanden'}</h2>${tag(r.passed ? 'ok' : 'bad', `${r.percent} %`)}</div>
        <p>${r.status === 'expired' ? 'Die Zeit war abgelaufen; der Versuch zählt als nicht bestanden.' : `${r.correct} von ${r.total} Fragen richtig, ${r.score} von ${r.max_score} Punkten. Bestanden ab ${r.pass_percent} %.`}</p>
        ${r.passed ? '<p>Der Nachweis ist eingetragen.</p>' : r.attempts_left === 0 ? '<p class="muted">Keine Versuche mehr übrig – der Ausbilder kann sie zurücksetzen.</p>' : r.attempts_left ? `<p class="muted">Noch ${r.attempts_left} ${r.attempts_left === 1 ? 'Versuch' : 'Versuche'}.</p>` : ''}
        <div class="row start"><button class="btn" id="exam-back">Zurück zur Schulung</button></div></div>`;
      if (auto) toast('Die Zeit ist abgelaufen – der Test wurde abgegeben', true);
    } catch (error) {
      sending = false;
      toast(error.message, true);
    }
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const open = attempt.questions.filter((q) => !form.querySelector(`input[name="${q.id}"]:checked`)).length;
    if (open && !(await confirmBox('Test abgeben', `${open} ${open === 1 ? 'Frage ist' : 'Fragen sind'} noch offen. Trotzdem abgeben?`, 'Abgeben'))) return;
    if (!open && !(await confirmBox('Test abgeben', 'Nach dem Abgeben lassen sich die Antworten nicht mehr ändern.', 'Abgeben'))) return;
    await submit(false);
  });
  el.addEventListener('click', (event) => {
    if (event.target.closest('#exam-later')) { stop(); onDone(); }
    else if (event.target.closest('#exam-back')) onDone();
  });
  if (attempt.deadline) {
    const deadline = new Date(attempt.deadline).getTime();
    const tick = () => {
      const box = $('#exam-timer', el);
      if (!box || !el.isConnected) { stop(); return; }
      const left = Math.max(0, deadline - (Date.now() + offset));
      box.textContent = `noch ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      box.classList.toggle('bad', left < 60000);
      if (left <= 0) submit(true);
    };
    tick();
    timer = setInterval(tick, 1000);
  }
}

// ---------- Antworten eines Versuchs (ab „Lesen & Schreiben“)
export async function attemptDetail(id) {
  const a = await api.get(`/training-attempts/${id}`);
  const html = `<p>${esc(a.user_name)} · ${fdatetime(a.submitted_at)} · ${a.score} / ${a.max_score} Punkte · ${resultTag(a)}</p>
    ${(a.questions || []).map((q, i) => `<div class="exam-q-edit"><div class="row wrap"><b>${i + 1}.</b>${q.correct ? tag('ok', 'richtig') : tag('bad', 'falsch')}</div>${markdownBlock(q.text)}
      <ul class="exam-options">${q.options.map((o) => `<li class="${o.correct ? 'correct' : ''}">${o.chosen ? '☒' : '☐'} ${esc(o.text)}${o.correct ? ' <small>(richtig)</small>' : ''}</li>`).join('')}</ul></div>`).join('')}`;
  return openForm({ title: 'Antworten im Test', wide: true, submit: 'Schließen', fields: [{ type: 'html', html }], onSubmit: async () => true });
}
