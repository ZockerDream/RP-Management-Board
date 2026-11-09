import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, notFound } from '../authz.js';
import { LEVEL, levelSql, visibleSql, recordLevel, recordOwner } from '../org.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { addInterval, today } from '../lib.js';
import { uuid, isoDate, clockTime, assertPerson, assertUserInScope, personJoin } from '../records.js';
import { EXPIRY_WARNING_DAYS } from './licenses.js';

const RESULTS = ['registered', 'passed', 'failed', 'absent'];
const trainingFields = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().max(20000).default(''),
  validity_months: z.number().int().min(1).max(1200).nullish(),
  active: z.boolean().default(true),
});
const sessionFields = z.object({
  session_date: isoDate,
  start_time: clockTime.nullish(),
  end_time: clockTime.nullish(),
  location: z.string().trim().max(200).default(''),
  instructor: z.string().trim().max(100).default(''),
  note: z.string().max(2000).default(''),
});
const recordFields = z.object({
  session_id: uuid.nullish(),
  result: z.enum(RESULTS).default('registered'),
  completed_on: isoDate.nullish(),
  valid_until: isoDate.nullish(),
  instructor: z.string().trim().max(100).default(''),
  note: z.string().max(2000).default(''),
});

// Zustand eines Nachweises: nur bestandene zählen, dann entscheidet das Ablaufdatum
const recordState = `CASE WHEN r.result<>'passed' THEN r.result
  WHEN r.valid_until IS NOT NULL AND r.valid_until < CURRENT_DATE THEN 'expired'
  WHEN r.valid_until IS NOT NULL AND r.valid_until <= CURRENT_DATE + ${EXPIRY_WARNING_DAYS} THEN 'expiring'
  ELSE 'valid' END`;
const participantSql = `COALESCE(u.name, pe.name)`;

export default async function routes(app) {
  // Sehen und sich an- oder abmelden ab 1 (Teilnehmen), Teilnehmer und Ergebnisse ab 2, Termine und Ergebnisse eintragen ab 3,
  // Schulungen anlegen, ändern und löschen mit 4
  async function loadTraining(req, id, need = LEVEL.READ) {
    const training = await one('SELECT * FROM trainings WHERE id=$1', [id]);
    const level = await recordLevel(req.user.id, training, 'training', { need, see: LEVEL.PARTICIPATE });
    return { training, level };
  }
  async function loadChild(req, table, need) {
    const row = await one(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
    if (!row) throw notFound();
    const { training, level } = await loadTraining(req, row.training_id, need);
    return { row, training, level };
  }
  const checkTimes = (start, end) => {
    if (start && end && end <= start) throw bad('Ende muss nach dem Beginn liegen');
  };
  // Bestanden oder nicht bestanden braucht ein Datum; die Gültigkeit folgt aus der Schulung, wenn nichts angegeben ist
  async function resolveRecord(training, values, session) {
    const done = ['passed', 'failed'].includes(values.result);
    const completedOn = done ? values.completed_on || session?.session_date || today() : values.completed_on || null;
    let validUntil = values.result === 'passed' ? values.valid_until : null;
    if (values.result === 'passed' && values.valid_until === undefined && training.validity_months) validUntil = addInterval(completedOn, 'monthly', training.validity_months);
    if (validUntil && completedOn && validUntil < completedOn) throw bad('Gültig bis liegt vor dem Abschlussdatum');
    return { completedOn, validUntil: validUntil ?? null };
  }
  async function loadSession(trainingId, sessionId) {
    if (!sessionId) return null;
    const session = await one('SELECT * FROM training_sessions WHERE id=$1 AND training_id=$2', [sessionId, trainingId]);
    if (!session) throw bad('Termin gehört nicht zu dieser Schulung');
    return session;
  }

  app.get('/trainings', authz('training:read'), async (req) => many(
    `SELECT x.id, x.name, x.description, x.validity_months, x.active, x.team_id, x.team_name, x.level, x.next_session,
       CASE WHEN x.level >= 2 THEN x.valid_records END valid_records, CASE WHEN x.level >= 2 THEN x.registered END registered
     FROM (
       SELECT tr.*, t.name team_name, ${levelSql('tr', 'training')} AS level,
         (SELECT min(s.session_date) FROM training_sessions s WHERE s.training_id=tr.id AND s.session_date >= CURRENT_DATE) next_session,
         (SELECT count(*)::int FROM training_records r WHERE r.training_id=tr.id AND r.result='passed'
            AND (r.valid_until IS NULL OR r.valid_until >= CURRENT_DATE)) valid_records,
         (SELECT count(*)::int FROM training_records r WHERE r.training_id=tr.id AND r.result='registered') registered
       FROM trainings tr LEFT JOIN teams t ON t.id=tr.team_id WHERE tr.owner_user_id=$1 OR tr.team_id IS NOT NULL
     ) x WHERE x.level >= 1
     ORDER BY x.active DESC, x.name`,
    [req.user.id],
  ));

  // Übersicht: je Teilnehmer und Schulung der neueste bestandene Nachweis
  app.get('/trainings/overview', authz('training:read'), async (req) => many(
    `SELECT DISTINCT ON (r.training_id, COALESCE(r.user_id, r.person_id))
       r.training_id, tr.name training_name, r.user_id, r.person_id, ${participantSql} participant, r.completed_on, r.valid_until, ${recordState} AS state
     FROM training_records r JOIN trainings tr ON tr.id=r.training_id
       LEFT JOIN users u ON u.id=r.user_id ${personJoin('pe', 'r.person_id')}
     WHERE ${visibleSql('tr', 'training')} AND r.result='passed'
     ORDER BY r.training_id, COALESCE(r.user_id, r.person_id), r.completed_on DESC NULLS LAST, r.created_at DESC`,
    [req.user.id],
  ));

  app.post('/trainings', authz('training:create'), async (req) => {
    const b = trainingFields.extend({ team_id: uuid.nullish() }).parse(req.body);
    const scope = await recordOwner(req.user.id, b.team_id, 'training', LEVEL.MANAGE);
    const row = await one(
      'INSERT INTO trainings(owner_user_id,team_id,name,description,validity_months,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [scope.owner_user_id, scope.team_id, b.name, b.description, b.validity_months ?? null, b.active, req.user.id],
    );
    await audit(req, 'training.created', 'training', row.id, { name: b.name });
    return row;
  });

  app.get('/trainings/:id', authz('training:read'), async (req) => {
    const { training, level } = await loadTraining(req, req.params.id, LEVEL.PARTICIPATE);
    // Wer nur teilnehmen darf, sieht die Termine und die eigenen Anmeldungen, aber keine Teilnehmer und keine Ergebnisse
    if (level < LEVEL.READ) {
      const [team, sessions, mine] = await Promise.all([
        training.team_id ? one('SELECT name FROM teams WHERE id=$1', [training.team_id]) : null,
        many('SELECT s.id, s.training_id, s.session_date, s.start_time, s.end_time, s.location, s.instructor, s.note FROM training_sessions s WHERE s.training_id=$1 ORDER BY s.session_date DESC, s.start_time NULLS LAST', [training.id]),
        many('SELECT r.session_id, r.result FROM training_records r WHERE r.training_id=$1 AND r.user_id=$2 AND r.session_id IS NOT NULL', [training.id, req.user.id]),
      ]);
      return {
        ...training, team_name: team?.name || null, level, sessions, records: [],
        my_sessions: mine.map((r) => ({ session_id: r.session_id, withdrawable: r.result === 'registered' })),
      };
    }
    const [team, sessions, records] = await Promise.all([
      training.team_id ? one('SELECT name FROM teams WHERE id=$1', [training.team_id]) : null,
      many(`SELECT s.*, (SELECT count(*)::int FROM training_records r WHERE r.session_id=s.id) participants
        FROM training_sessions s WHERE s.training_id=$1 ORDER BY s.session_date DESC, s.start_time NULLS LAST`, [training.id]),
      many(`SELECT r.*, ${participantSql} participant, CASE WHEN r.user_id IS NOT NULL THEN 'user' ELSE 'person' END participant_kind,
          s.session_date, ${recordState} AS state
        FROM training_records r LEFT JOIN users u ON u.id=r.user_id ${personJoin('pe', 'r.person_id')}
          LEFT JOIN training_sessions s ON s.id=r.session_id
        WHERE r.training_id=$1 ORDER BY COALESCE(r.completed_on, s.session_date) DESC NULLS FIRST, participant`, [training.id]),
    ]);
    const my = records.filter((r) => r.user_id === req.user.id && r.session_id);
    return {
      ...training, team_name: team?.name || null, level, sessions, records,
      my_sessions: my.map((r) => ({ session_id: r.session_id, withdrawable: r.result === 'registered' })),
    };
  });

  // Wählbare Teilnehmer: im Team die Mitglieder, privat die eigene Person; dazu alle aktiven (globalen) Personen
  app.get('/trainings/:id/candidates', authz('training:read'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.WRITE);
    const users = training.team_id
      ? await many('SELECT u.id, u.name FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1 AND u.deleted_at IS NULL ORDER BY u.name', [training.team_id])
      : [{ id: req.user.id, name: req.user.name }];
    const people = await many('SELECT id, name FROM people WHERE active ORDER BY name');
    return { users, people };
  });

  app.patch('/trainings/:id', authz('training:update'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.MANAGE);
    const b = patchSchema(trainingFields).parse(req.body);
    await q(
      'UPDATE trainings SET name=$2, description=$3, validity_months=$4, active=$5, updated_at=now() WHERE id=$1',
      [training.id, b.name ?? training.name, b.description ?? training.description,
        'validity_months' in b ? b.validity_months ?? null : training.validity_months, b.active ?? training.active],
    );
    await audit(req, 'training.updated', 'training', training.id);
    return { ok: true };
  });

  app.delete('/trainings/:id', authz('training:delete'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.MANAGE);
    await q('DELETE FROM trainings WHERE id=$1', [training.id]);
    await audit(req, 'training.deleted', 'training', training.id, { name: training.name });
    return { ok: true };
  });

  // ---- Termine
  app.post('/trainings/:id/sessions', authz('training:update'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.WRITE);
    const b = sessionFields.parse(req.body);
    checkTimes(b.start_time, b.end_time);
    return one(
      'INSERT INTO training_sessions(training_id,session_date,start_time,end_time,location,instructor,note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [training.id, b.session_date, b.start_time || null, b.end_time || null, b.location, b.instructor, b.note],
    );
  });

  app.patch('/training-sessions/:id', authz('training:update'), async (req) => {
    const { row } = await loadChild(req, 'training_sessions', LEVEL.WRITE);
    const b = patchSchema(sessionFields).parse(req.body);
    const start = 'start_time' in b ? b.start_time || null : row.start_time?.slice(0, 5) ?? null;
    const end = 'end_time' in b ? b.end_time || null : row.end_time?.slice(0, 5) ?? null;
    checkTimes(start, end);
    await q(
      'UPDATE training_sessions SET session_date=$2, start_time=$3, end_time=$4, location=$5, instructor=$6, note=$7 WHERE id=$1',
      [row.id, b.session_date ?? row.session_date, start, end, b.location ?? row.location, b.instructor ?? row.instructor, b.note ?? row.note],
    );
    return { ok: true };
  });

  app.delete('/training-sessions/:id', authz('training:update'), async (req) => {
    const { row } = await loadChild(req, 'training_sessions', LEVEL.WRITE);
    await q('DELETE FROM training_sessions WHERE id=$1', [row.id]);
    return { ok: true };
  });

  // ---- Selbst anmelden und abmelden (ab „Teilnehmen“), nur für kommende Termine
  app.post('/training-sessions/:id/enroll', authz('training:read'), async (req) => {
    const { row: session, training } = await loadChild(req, 'training_sessions', LEVEL.PARTICIPATE);
    if (session.session_date < today()) throw bad('Für vergangene Termine kann man sich nicht mehr anmelden');
    if (!training.active) throw bad('Die Schulung ist nicht aktiv');
    try {
      const row = await one(
        `INSERT INTO training_records(training_id,session_id,user_id,result,created_by) VALUES ($1,$2,$3,'registered',$3) RETURNING id`,
        [training.id, session.id, req.user.id],
      );
      await audit(req, 'training.enrolled', 'training', training.id, { session: session.id });
      return row;
    } catch (e) {
      if (e.code === '23505') throw bad('Du bist für diesen Termin schon angemeldet');
      throw e;
    }
  });

  app.delete('/training-sessions/:id/enroll', authz('training:read'), async (req) => {
    const { row: session, training } = await loadChild(req, 'training_sessions', LEVEL.PARTICIPATE);
    if (session.session_date < today()) throw bad('Von vergangenen Terminen kann man sich nicht mehr abmelden');
    const removed = await one(
      "DELETE FROM training_records WHERE session_id=$1 AND user_id=$2 AND result='registered' RETURNING id",
      [session.id, req.user.id],
    );
    if (!removed) throw bad('Du bist für diesen Termin nicht angemeldet oder das Ergebnis steht schon fest');
    await audit(req, 'training.withdrawn', 'training', training.id, { session: session.id });
    return { ok: true };
  });

  // ---- Teilnahme und Nachweis
  app.post('/trainings/:id/records', authz('training:update'), async (req) => {
    const { training } = await loadTraining(req, req.params.id, LEVEL.WRITE);
    const b = recordFields.extend({ user_id: uuid.nullish(), person_id: uuid.nullish() }).parse(req.body);
    if (Boolean(b.user_id) === Boolean(b.person_id)) throw bad('Wähle genau einen Teilnehmer: Benutzer oder Person');
    if (b.user_id) await assertUserInScope(b.user_id, training);
    else await assertPerson(b.person_id);
    const session = await loadSession(training.id, b.session_id);
    const { completedOn, validUntil } = await resolveRecord(training, { ...b, valid_until: 'valid_until' in req.body ? b.valid_until : undefined }, session);
    try {
      const row = await one(
        `INSERT INTO training_records(training_id,session_id,user_id,person_id,result,completed_on,valid_until,instructor,note,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, valid_until`,
        [training.id, session?.id || null, b.user_id || null, b.person_id || null, b.result, completedOn, validUntil, b.instructor || session?.instructor || '', b.note, req.user.id],
      );
      await audit(req, 'training.record_added', 'training', training.id, { record: row.id, result: b.result });
      return row;
    } catch (e) {
      if (e.code === '23505') throw bad('Dieser Teilnehmer ist für den Termin schon eingetragen');
      throw e;
    }
  });

  app.patch('/training-records/:id', authz('training:update'), async (req) => {
    const { row, training } = await loadChild(req, 'training_records', LEVEL.WRITE);
    const b = patchSchema(recordFields).parse(req.body);
    const sessionId = 'session_id' in b ? b.session_id || null : row.session_id;
    const session = await loadSession(training.id, sessionId);
    const merged = {
      result: b.result ?? row.result,
      completed_on: 'completed_on' in b ? b.completed_on : row.completed_on,
      // Ohne neue Angabe bleibt ein vorhandenes Ablaufdatum; bei neu bestanden folgt es aus der Schulung
      valid_until: 'valid_until' in b ? b.valid_until : row.result === 'passed' ? row.valid_until : undefined,
    };
    const { completedOn, validUntil } = await resolveRecord(training, merged, session);
    try {
      await q(
        `UPDATE training_records SET session_id=$2, result=$3, completed_on=$4, valid_until=$5, instructor=$6, note=$7, updated_at=now() WHERE id=$1`,
        [row.id, session?.id || null, merged.result, completedOn, validUntil, b.instructor ?? row.instructor, b.note ?? row.note],
      );
    } catch (e) {
      if (e.code === '23505') throw bad('Dieser Teilnehmer ist für den Termin schon eingetragen');
      throw e;
    }
    await audit(req, 'training.record_updated', 'training', training.id, { record: row.id, result: merged.result });
    return { ok: true };
  });

  app.delete('/training-records/:id', authz('training:update'), async (req) => {
    const { row, training } = await loadChild(req, 'training_records', LEVEL.WRITE);
    await q('DELETE FROM training_records WHERE id=$1', [row.id]);
    await audit(req, 'training.record_deleted', 'training', training.id, { record: row.id });
    return { ok: true };
  });
}
