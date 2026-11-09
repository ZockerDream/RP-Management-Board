// Test einer Schulung ohne Datenbank (unit-testbar): Fragen prüfen, Ablauf eines Versuchs mischen, auswerten.
import crypto from 'node:crypto';

export class ExamError extends Error {}

// Antworten bekommen kurze, stabile IDs; bei Einfachauswahl genau eine richtige, bei Mehrfachauswahl mindestens eine
export function normalizeQuestion({ kind, options }) {
  const used = new Set();
  const list = options.map((o, i) => {
    let id = typeof o.id === 'string' && /^[a-z0-9]{1,12}$/i.test(o.id) && !used.has(o.id) ? o.id : '';
    for (let n = i + 1; !id || used.has(id); n++) id = `o${n}`;
    used.add(id);
    return { id, text: o.text.trim(), correct: !!o.correct };
  });
  const correct = list.filter((o) => o.correct).length;
  if (kind === 'single' && correct !== 1) throw new ExamError('Bei Einfachauswahl ist genau eine Antwort richtig');
  if (kind === 'multiple' && correct < 1) throw new ExamError('Bei Mehrfachauswahl ist mindestens eine Antwort richtig');
  if (new Set(list.map((o) => o.text.toLowerCase())).size !== list.length) throw new ExamError('Zwei Antworten haben denselben Text');
  return list;
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Reihenfolge eines Versuchs: Fragen nach sort oder gemischt, Antworten je Frage ebenso
export function layoutFor(questions, mix) {
  const ordered = mix ? shuffle(questions) : [...questions].sort((a, b) => a.sort - b.sort);
  return ordered.map((q) => ({ q: q.id, o: (mix ? shuffle(q.options) : q.options).map((o) => o.id) }));
}

// Was Teilnehmende sehen: Fragen in der Reihenfolge des Versuchs, ohne Lösung
export function publicQuestions(questions, layout) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return layout.filter((l) => byId.has(l.q)).map((l) => {
    const q = byId.get(l.q);
    const options = new Map(q.options.map((o) => [o.id, o]));
    return { id: q.id, kind: q.kind, text: q.text, points: q.points, options: l.o.filter((id) => options.has(id)).map((id) => ({ id, text: options.get(id).text })) };
  });
}

// Alles oder nichts je Frage: Die gewählten Antworten müssen genau die richtigen sein.
// Fragen, die es seit dem Start nicht mehr gibt, zählen nicht mit.
export function grade(questions, layout, answers, passPercent) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let score = 0;
  let max = 0;
  const results = [];
  for (const { q: id } of layout) {
    const q = byId.get(id);
    if (!q) continue;
    const chosen = [...new Set(Array.isArray(answers?.[id]) ? answers[id].map(String) : [])].sort();
    const right = q.options.filter((o) => o.correct).map((o) => o.id).sort();
    const correct = chosen.length === right.length && chosen.every((c, i) => c === right[i]);
    max += q.points;
    if (correct) score += q.points;
    results.push({ question_id: id, correct, chosen });
  }
  const percent = max ? Math.floor((score * 100) / max) : 0;
  return { score, max_score: max, percent, passed: max > 0 && percent >= passPercent, results };
}

// Nur Antworten auf Fragen des Versuchs und nur bekannte Antwort-IDs speichern
export function cleanAnswers(layout, answers) {
  const out = {};
  for (const { q, o } of layout) {
    const chosen = Array.isArray(answers?.[q]) ? answers[q].map(String).filter((id) => o.includes(id)) : [];
    if (chosen.length) out[q] = [...new Set(chosen)];
  }
  return out;
}
