import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuestion, layoutFor, publicQuestions, grade, cleanAnswers, ExamError } from '../src/exam.js';

const q1 = { id: 'q1', sort: 1, kind: 'single', points: 2, text: 'Wie lautet der Notruf?', options: [{ id: 'a', text: '110', correct: true }, { id: 'b', text: '911', correct: false }] };
const q2 = { id: 'q2', sort: 2, kind: 'multiple', points: 1, text: 'Was gehört in den Verbandskasten?', options: [{ id: 'a', text: 'Pflaster', correct: true }, { id: 'b', text: 'Schere', correct: true }, { id: 'c', text: 'Schnaps', correct: false }] };
const q3 = { id: 'q3', sort: 3, kind: 'single', points: 1, text: 'Wahr oder falsch?', options: [{ id: 'w', text: 'Wahr', correct: false }, { id: 'f', text: 'Falsch', correct: true }] };
const all = [q1, q2, q3];

test('questions: ids are assigned and kept, correct answers are checked', () => {
  assert.deepEqual(normalizeQuestion({ kind: 'single', options: [{ text: ' A ', correct: true }, { id: 'x', text: 'B' }] }), [{ id: 'o1', text: 'A', correct: true }, { id: 'x', text: 'B', correct: false }]);
  assert.deepEqual(normalizeQuestion({ kind: 'single', options: [{ id: 'o2', text: 'A', correct: true }, { text: 'B' }] }).map((o) => o.id), ['o2', 'o3']);
  assert.throws(() => normalizeQuestion({ kind: 'single', options: [{ text: 'A', correct: true }, { text: 'B', correct: true }] }), ExamError);
  assert.throws(() => normalizeQuestion({ kind: 'multiple', options: [{ text: 'A' }, { text: 'B' }] }), /mindestens eine/);
  assert.throws(() => normalizeQuestion({ kind: 'single', options: [{ text: 'A', correct: true }, { text: 'a' }] }), /denselben Text/);
});

test('layout keeps sort order without shuffling and contains every option once with shuffling', () => {
  assert.deepEqual(layoutFor([q3, q1, q2], false).map((l) => l.q), ['q1', 'q2', 'q3']);
  for (let i = 0; i < 20; i++) {
    const layout = layoutFor(all, true);
    assert.deepEqual(layout.map((l) => l.q).sort(), ['q1', 'q2', 'q3']);
    assert.deepEqual(layout.find((l) => l.q === 'q2').o.sort(), ['a', 'b', 'c']);
  }
});

test('participants never see which answer is correct', () => {
  const shown = publicQuestions(all, layoutFor(all, false));
  assert.equal(JSON.stringify(shown).includes('correct'), false);
  assert.deepEqual(shown[1], { id: 'q2', kind: 'multiple', text: q2.text, points: 1, options: [{ id: 'a', text: 'Pflaster' }, { id: 'b', text: 'Schere' }, { id: 'c', text: 'Schnaps' }] });
});

test('grading is all or nothing per question and honours the pass mark', () => {
  const layout = layoutFor(all, false);
  const full = grade(all, layout, { q1: ['a'], q2: ['b', 'a'], q3: ['f'] }, 70);
  assert.deepEqual([full.score, full.max_score, full.percent, full.passed], [4, 4, 100, true]);
  const partial = grade(all, layout, { q1: ['a'], q2: ['a'], q3: ['f'] }, 70);
  assert.deepEqual([partial.score, partial.percent, partial.passed], [3, 75, true]);
  assert.deepEqual(partial.results.map((r) => r.correct), [true, false, true]);
  assert.equal(grade(all, layout, { q1: ['a'], q2: ['a', 'b', 'c'] }, 70).percent, 50);
  assert.equal(grade(all, layout, {}, 70).passed, false);
  // Gelöschte Fragen zählen nicht, ein leerer Test besteht nie
  assert.deepEqual(grade([q1], layout, { q1: ['a'] }, 70).max_score, 2);
  assert.equal(grade([], layout, {}, 1).passed, false);
});

test('only answers to questions and options of the attempt are stored', () => {
  const layout = layoutFor(all, false);
  assert.deepEqual(cleanAnswers(layout, { q1: ['a', 'a', 'zz'], q9: ['a'], q2: 'a', q3: [] }), { q1: ['a'] });
});
