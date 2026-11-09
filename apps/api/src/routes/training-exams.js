// Test im Tool für Schulungen. Fragen pflegt, wer die Schulung verwaltet (4); den Test macht, wer teilnehmen darf (ab 1);
// Versuche und Ergebnisse sehen Leser (ab 2), Antworten im Einzelnen und Zurücksetzen ab „Lesen & Schreiben“ (3).
// Bestanden wird ein Benutzer bei einer Schulung mit Test nur über einen bestandenen Versuch; der Nachweis entsteht dabei.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound } from '../authz.js';
import { LEVEL, recordLevel } from '../org.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { addInterval, today } from '../lib.js';
import { uuid } from '../records.js';
import { normalizeQuestion, layoutFor, publicQuestions, grade, cleanAnswers, ExamError } from '../exam.js';
import { EXPIRY_WARNING_DAYS } from './licenses.js';

const GRACE_MS = 30000;
const questionFields = z.object({
  kind: z.enum(['single', 'multiple']).default('single'),
  text: z.string().trim().min(1).max(2000),
  options: z.array(z.object({ id: z.string().max(20).optional(), text: z.string().trim().min(1).max(500), correct: z.boolean().default(false) })).min(2).max(10),
  points: z.number().int().min(1).max(100).default(1),
  explanation: z.string().max(2000).default(''),
  sort: z.number().int().min(-100000).max(100000).optional(),
});
const questionsOf = (trainingId) => many('SELECT * FROM training_questions WHERE training_id=$1 ORDER BY sort, created_at', [trainingId]);

async function loadTraining(req, id, need) {
  const training = await one('SELECT * FROM trainings WHERE id=$1', [id]);
  const level = await recordLevel(req.user.id, training, 'training', { need, see: LEVEL.PARTICIPATE });
  return { training, level };
}

// Nachweis aus einem Versuch: die offene Anmeldung (bevorzugt eines vergangenen Termins) bekommt das Ergebnis, sonst ein neuer Eintrag
async function applyResult(client, training, userId, passed) {
  const record = (await client.query(
    `SELECT r.id FROM training_records r LEFT JOIN training_sessions s ON s.id=r.session_id
     WHERE r.training_id=$1 AND r.user_id=$2 AND r.result IN ('registered', 'failed')
     ORDER BY (s.session_date IS NOT NULL AND s.session_date <= CURRENT_DATE) DESC, s.session_date DESC NULLS LAST, r.created_at DESC LIMIT 1 FOR UPDATE OF r`,
    [training.id, userId],
  )).rows[0];
  const completedOn = today();
  const validUntil = passed && training.validity_months ? addInterval(completedOn, 'monthly', training.validity_months) : null;
  const result = passed ? 'passed' : 'failed';
  if (record) {
    await client.query(
      `UPDATE training_records SET result=$2, completed_on=$3, valid_until=$4, instructor=CASE WHEN instructor='' THEN 'Test im Tool' ELSE instructor END, updated_at=now() WHERE id=$1`,
      [record.id, result, completedOn, validUntil],
    );
    return record.id;
  }
  return (await client.query(
    `INSERT INTO training_records(training_id,user_id,result,completed_on,valid_until,instructor,created_by) VALUES ($1,$2,$3,$4,$5,'Test im Tool',$2) RETURNING id`,
    [training.id, userId, result, completedOn, validUntil],
  )).rows[0].id;
}

// Abgelaufene offene Versuche zählen als nicht bestanden
async function expireOverdue(training, userId) {
  const overdue = await many(
    `SELECT * FROM training_attempts WHERE training_id=$1 AND user_id=$2 AND status='open' AND deadline IS NOT NULL AND deadline < now() - interval '${GRACE_MS / 1000} seconds'`,
    [training.id, userId],
  );
  for (const attempt of overdue) {
    await tx(async (client) => {
      const recordId = await applyResult(client, training, userId, false);
      await client.query(`UPDATE training_attempts SET status='expired', submitted_at=deadline, passed=false, percent=0, score=0, record_id=$2 WHERE id=$1 AND status='open'`, [attempt.id, recordId]);
    });
  }
}

// Darf die Person jetzt (neu) starten? Liefert den Grund, wenn nicht
async function startCheck(training, userId, questionCount, attempts) {
  if (!training.exam_required) return 'Für diese Schulung gibt es keinen Test';
  if (!training.active) return 'Die Schulung ist nicht aktiv';
  if (!questionCount) return 'Der Test hat noch keine Fragen';
  const valid = await one(
    `SELECT 1 FROM training_records WHERE training_id=$1 AND user_id=$2 AND result='passed' AND (valid_until IS NULL OR valid_until > CURRENT_DATE + ${EXPIRY_WARNING_DAYS})`,
    [training.id, userId],
  );
  if (valid) return 'Du hast die Schulung schon bestanden';
  const used = attempts.filter((a) => a.counted && a.status !== 'open').length;
  if (training.exam_max_attempts && used >= training.exam_max_attempts) return 'Keine Versuche mehr übrig – der Ausbilder kann sie zurücksetzen';
  if (training.exam_after_session) {
    const attended = await one(
      `SELECT 1 FROM training_records r JOIN training_sessions s ON s.id=r.session_id
       WHERE r.training_id=$1 AND r.user_id=$2 AND r.result IN ('registered', 'failed') AND s.session_date <= CURRENT_DATE`, [training.id, userId]);
    if (!attended) return 'Der Test ist erst nach der Teilnahme an einem Termin möglich';
  }
  return null;
}

// Für die Schulungsansicht: Eckdaten, eigene Versuche, ob man starten darf; ab „Lesen“ alle Versuche
export async function examInfo(training, userId, level) {
  if (!training.exam_required) return null;
  if (level >= LEVEL.PARTICIPATE) await expireOverdue(training, userId);
  const [stats, mine, all] = await Promise.all([
    one('SELECT count(*)::int questions, COALESCE(sum(points), 0)::int points FROM training_questions WHERE training_id=$1', [training.id]),
    many('SELECT id, status, started_at, deadline, submitted_at, percent, passed, counted FROM training_attempts WHERE training_id=$1 AND user_id=$2 ORDER BY started_at DESC', [training.id, userId]),
    level >= LEVEL.READ ? many(
      `SELECT a.id, a.user_id, u.name user_name, a.status, a.started_at, a.submitted_at, a.score, a.max_score, a.percent, a.passed, a.counted
       FROM training_attempts a JOIN users u ON u.id=a.user_id WHERE a.training_id=$1 ORDER BY a.started_at DESC LIMIT 500`, [training.id]) : null,
  ]);
  const used = mine.filter((a) => a.counted && a.status !== 'open').length;
  const open = mine.find((a) => a.status === 'open');
  const reason = open ? null : await startCheck(training, userId, stats.questions, mine);
  return {
    questions: stats.questions, points: stats.points, pass_percent: training.exam_pass_percent, time_limit: training.exam_time_limit,
    max_attempts: training.exam_max_attempts, after_session: training.exam_after_session, shuffle: training.exam_shuffle,
    attempts_left: training.exam_max_attempts ? Math.max(0, training.exam_max_attempts - used) : null,
    mine, open_attempt: open ? { id: open.id, deadline: open.deadline } : null, can_start: !open && !reason, reason, all,
  };
}

export default async function routes(app) {
  // ---------- Fragen
  app.get('/trainings/:id/questions', authz('training:read'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.MANAGE);
    return questionsOf(training.id);
  });
  const parseQuestion = (body) => {
    try { return { ...body, options: normalizeQuestion(body) }; } catch (e) {
      if (e instanceof ExamError) throw bad(e.message);
      throw e;
    }
  };
  app.post('/trainings/:id/questions', authz('training:update'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.MANAGE);
    const b = parseQuestion(questionFields.parse(req.body));
    const sort = b.sort ?? (await one('SELECT COALESCE(max(sort), 0) + 10 n FROM training_questions WHERE training_id=$1', [training.id])).n;
    const row = await one('INSERT INTO training_questions(training_id,sort,kind,text,options,points,explanation) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [training.id, sort, b.kind, b.text, JSON.stringify(b.options), b.points, b.explanation]);
    await audit(req, 'training.question_added', 'training', training.id, { question: row.id });
    return row;
  });
  async function loadQuestion(req) {
    const row = await one('SELECT * FROM training_questions WHERE id=$1', [uuid.parse(req.params.id)]);
    if (!row) throw notFound();
    const { training } = await loadTraining(req, row.training_id, LEVEL.MANAGE);
    return { row, training };
  }
  app.patch('/training-questions/:id', authz('training:update'), async (req) => {
    const { row, training } = await loadQuestion(req);
    const b = patchSchema(questionFields).parse(req.body);
    const m = { ...row, ...b };
    const options = b.options || b.kind ? parseQuestion({ kind: m.kind, options: m.options }).options : row.options;
    await q('UPDATE training_questions SET sort=$2, kind=$3, text=$4, options=$5, points=$6, explanation=$7 WHERE id=$1',
      [row.id, m.sort, m.kind, m.text, JSON.stringify(options), m.points, m.explanation]);
    await audit(req, 'training.question_updated', 'training', training.id, { question: row.id });
    return { ok: true };
  });
  app.delete('/training-questions/:id', authz('training:update'), async (req) => {
    const { row, training } = await loadQuestion(req);
    await q('DELETE FROM training_questions WHERE id=$1', [row.id]);
    await audit(req, 'training.question_deleted', 'training', training.id, { question: row.id });
    return { ok: true };
  });

  // ---------- Test machen
  const view = (attempt, questions, training) => ({
    id: attempt.id, training_id: training.id, training_name: training.name, started_at: attempt.started_at, deadline: attempt.deadline, server_time: new Date(),
    pass_percent: training.exam_pass_percent, answers: attempt.answers, questions: publicQuestions(questions, attempt.layout),
  });
  app.post('/trainings/:id/exam/start', authz('training:read'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.PARTICIPATE);
    await expireOverdue(training, req.user.id);
    const questions = await questionsOf(training.id);
    const open = await one("SELECT * FROM training_attempts WHERE training_id=$1 AND user_id=$2 AND status='open'", [training.id, req.user.id]);
    if (open) return view(open, questions, training);
    const attempts = await many('SELECT status, counted FROM training_attempts WHERE training_id=$1 AND user_id=$2', [training.id, req.user.id]);
    const reason = await startCheck(training, req.user.id, questions.length, attempts);
    if (reason) throw bad(reason);
    let attempt;
    try {
      // Frist in der Datenbank rechnen, damit sie genau zum Startzeitpunkt passt (ohne Zeitlimit bleibt sie leer)
      attempt = await one(
        "INSERT INTO training_attempts(training_id,user_id,deadline,layout) VALUES ($1,$2,now() + $3::int * interval '1 minute',$4) RETURNING *",
        [training.id, req.user.id, training.exam_time_limit ?? null, JSON.stringify(layoutFor(questions, training.exam_shuffle))]);
    } catch (e) {
      // Doppelklick: Es gibt schon einen offenen Versuch
      if (e.code !== '23505') throw e;
      attempt = await one("SELECT * FROM training_attempts WHERE training_id=$1 AND user_id=$2 AND status='open'", [training.id, req.user.id]);
    }
    await audit(req, 'training.exam_started', 'training', training.id, { attempt: attempt.id });
    return view(attempt, questions, training);
  });

  app.post('/training-attempts/:id/submit', authz('training:read'), async (req) => {
    const attempt = await one('SELECT * FROM training_attempts WHERE id=$1', [uuid.parse(req.params.id)]);
    if (!attempt || attempt.user_id !== req.user.id) throw notFound();
    const { training } = await loadTraining(req, attempt.training_id, LEVEL.PARTICIPATE);
    if (attempt.status !== 'open') throw bad('Dieser Versuch ist schon abgeschlossen');
    const b = z.object({ answers: z.record(z.string().max(40), z.array(z.string().max(20)).max(20)).default({}) }).parse(req.body);
    const late = attempt.deadline && Date.now() > new Date(attempt.deadline).getTime() + GRACE_MS;
    const questions = await questionsOf(training.id);
    const answers = cleanAnswers(attempt.layout, b.answers);
    const graded = grade(questions, attempt.layout, answers, training.exam_pass_percent);
    const result = late ? { ...graded, score: 0, percent: 0, passed: false } : graded;
    const status = late ? 'expired' : 'submitted';
    const saved = await tx(async (client) => {
      const recordId = await applyResult(client, training, req.user.id, result.passed);
      return (await client.query(
        `UPDATE training_attempts SET status=$2, submitted_at=now(), answers=$3, score=$4, max_score=$5, percent=$6, passed=$7, record_id=$8 WHERE id=$1 AND status='open' RETURNING id`,
        [attempt.id, status, JSON.stringify(answers), result.score, result.max_score, result.percent, result.passed, recordId],
      )).rowCount;
    });
    if (!saved) throw bad('Dieser Versuch ist schon abgeschlossen');
    await audit(req, 'training.exam_submitted', 'training', training.id, { attempt: attempt.id, percent: result.percent, passed: result.passed, late: !!late });
    const used = (await one('SELECT count(*)::int n FROM training_attempts WHERE training_id=$1 AND user_id=$2 AND counted AND status<>$3', [training.id, req.user.id, 'open'])).n;
    return {
      status, passed: result.passed, percent: result.percent, score: result.score, max_score: result.max_score, pass_percent: training.exam_pass_percent,
      correct: late ? 0 : graded.results.filter((r) => r.correct).length, total: graded.results.length,
      attempts_left: training.exam_max_attempts ? Math.max(0, training.exam_max_attempts - used) : null,
    };
  });

  // ---------- Versuche ansehen und zurücksetzen
  // Teilnehmende sehen bei sich nur die Auswertung; wer Ergebnisse eintragen darf, auch die Antworten im Einzelnen
  app.get('/training-attempts/:id', authz('training:read'), async (req) => {
    const attempt = await one('SELECT a.*, u.name user_name FROM training_attempts a JOIN users u ON u.id=a.user_id WHERE a.id=$1', [uuid.parse(req.params.id)]);
    if (!attempt) throw notFound();
    const own = attempt.user_id === req.user.id;
    const { training, level } = await loadTraining(req, attempt.training_id, own ? LEVEL.PARTICIPATE : LEVEL.READ);
    const summary = { id: attempt.id, user_name: attempt.user_name, status: attempt.status, started_at: attempt.started_at, submitted_at: attempt.submitted_at, score: attempt.score, max_score: attempt.max_score, percent: attempt.percent, passed: attempt.passed };
    if (level < LEVEL.WRITE) return summary;
    const questions = await questionsOf(training.id);
    const byId = new Map(questions.map((x) => [x.id, x]));
    const graded = grade(questions, attempt.layout, attempt.answers, training.exam_pass_percent);
    return {
      ...summary,
      questions: graded.results.map((r) => {
        const x = byId.get(r.question_id);
        return { id: x.id, text: x.text, kind: x.kind, points: x.points, correct: r.correct, options: x.options.map((o) => ({ ...o, chosen: r.chosen.includes(o.id) })) };
      }),
    };
  });

  app.post('/trainings/:id/exam/reset', authz('training:update'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.WRITE);
    const b = z.object({ user_id: uuid }).parse(req.body);
    const reset = await q(`UPDATE training_attempts SET counted=false WHERE training_id=$1 AND user_id=$2 AND counted AND status<>'open'`, [training.id, b.user_id]);
    if (!reset.rowCount) throw bad('Für diese Person gibt es keine Versuche zum Zurücksetzen');
    await audit(req, 'training.exam_reset', 'training', training.id, { user: b.user_id, attempts: reset.rowCount });
    return { reset: reset.rowCount };
  });
}

export const examBlocksManualPass = (training, userId, result) => training.exam_required && !!userId && result === 'passed';
export const EXAM_PASS_MESSAGE = 'Für diese Schulung ist ein Test nötig: Benutzer bestehen über den Test im Tool. Personen ohne Zugang lassen sich weiter von Hand eintragen.';
