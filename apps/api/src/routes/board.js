// Pinnwand (Wunsch des Auftraggebers vom 2026-11-13): Ankündigungen an die ganze Organisation oder an Ränge (samt
// allen höheren), „gelesen von“, Glocke und Discord; dazu Umfragen (eine oder mehrere Antworten, anonym oder namentlich).
// Funktion „notices“: 2 lesen und abstimmen, 3 schreiben und „gelesen von“ sehen, 4 Fremdes ändern und löschen.
import { z } from 'zod';
import crypto from 'node:crypto';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden, notFound } from '../authz.js';
import { LEVEL } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDateTime } from '../records.js';
import { notify } from '../lib.js';
import { patchSchema } from '../validation.js';
import { teamFor, loadTeamRow, teamName } from '../orgfeature.js';
import { discord } from '../discord-send.js';

// Darf diese Person die Ankündigung sehen? Schreibende, Inhaber und Zielränge (samt allen höheren)
const noticeVisibleSql = (alias, n = '$1') => `(team_level(${alias}.team_id, ${n}, 'notices') >= 3
  OR (team_level(${alias}.team_id, ${n}, 'notices') >= 2 AND (cardinality(${alias}.rank_ids) = 0
    OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=${alias}.team_id AND tm.user_id=${n} AND tm.is_owner)
    OR (SELECT r.position FROM team_members tm JOIN team_ranks r ON r.id=tm.rank_id WHERE tm.team_id=${alias}.team_id AND tm.user_id=${n})
       >= (SELECT min(r2.position) FROM team_ranks r2 WHERE r2.id = ANY(${alias}.rank_ids)))))`;

// Empfänger einer Ankündigung (für Glocke und Zähler)
const recipients = (notice) => many(
  `SELECT tm.user_id, u.name FROM team_members tm JOIN users u ON u.id=tm.user_id AND u.status='active' AND u.deleted_at IS NULL
   CROSS JOIN (SELECT $2::uuid[] AS rank_ids, $1::uuid AS team_id) n
   WHERE tm.team_id=$1 AND ${noticeVisibleSql('n', 'tm.user_id')} ORDER BY u.name`,
  [notice.team_id, notice.rank_ids],
);

const noticeFields = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20000).default(''),
  rank_ids: z.array(uuid).max(50).default([]),
  pinned: z.boolean().default(false),
});
const pollFields = z.object({
  question: z.string().trim().min(1).max(300),
  description: z.string().max(5000).default(''),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(20),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  closes_at: isoDateTime.nullish(),
});

async function checkRanks(teamId, rankIds) {
  if (!rankIds.length) return;
  const found = await one('SELECT count(*)::int n FROM team_ranks WHERE team_id=$1 AND id = ANY($2::uuid[])', [teamId, rankIds]);
  if (found.n !== new Set(rankIds).size) throw bad('Rang gehört nicht zu dieser Organisation');
}
// Eigenes ändern ab Stufe 3, Fremdes ab 4
const mayEdit = (level, row, userId) => level >= LEVEL.MANAGE || (level >= LEVEL.WRITE && row.created_by === userId);

export default async function routes(app) {
  // ---------- Ankündigungen
  app.get('/notices', authz('notice:read'), async (req) => {
    const { team_id: teamId } = z.object({ team_id: uuid }).parse(req.query);
    const level = await teamFor(req, teamId, 'notices', LEVEL.READ);
    const rows = await many(
      `SELECT n.*, u.name created_by_name, r.read_at,
         ARRAY(SELECT name FROM team_ranks WHERE id = ANY(n.rank_ids) ORDER BY position DESC) AS rank_names,
         (SELECT count(*)::int FROM notice_reads x WHERE x.notice_id=n.id) AS read_count
       FROM notices n LEFT JOIN users u ON u.id=n.created_by LEFT JOIN notice_reads r ON r.notice_id=n.id AND r.user_id=$1
       WHERE n.team_id=$2 AND ${noticeVisibleSql('n')}
       ORDER BY n.pinned DESC, n.created_at DESC LIMIT 300`,
      [req.user.id, teamId],
    );
    return rows.map((n) => ({ ...n, can_edit: mayEdit(level, n, req.user.id), read_count: level >= LEVEL.WRITE ? n.read_count : undefined }));
  });

  app.post('/notices', authz('notice:create'), async (req) => {
    const b = noticeFields.extend({ team_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, 'notices', LEVEL.WRITE);
    await checkRanks(b.team_id, b.rank_ids);
    const row = await one(
      'INSERT INTO notices(team_id, title, body, rank_ids, pinned, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [b.team_id, b.title, b.body, [...new Set(b.rank_ids)], b.pinned, req.user.id],
    );
    await q('INSERT INTO notice_reads(notice_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.id, req.user.id]);
    const team = await teamName(b.team_id);
    const to = (await recipients(row)).filter((r) => r.user_id !== req.user.id);
    await Promise.all(to.map((r) => notify(r.user_id, 'notice', `${team}: ${b.title}`, b.body.slice(0, 300), `notice:${row.id}:${r.user_id}`, req.log)));
    discord(b.team_id, 'notice', { title: b.title, description: b.body, path: 'board', fields: [{ name: 'Von', value: req.user.name }] }, req.log);
    await audit(req, 'notice.created', 'notice', row.id, { team: b.team_id, title: b.title });
    return { id: row.id, recipients: to.length };
  });

  app.patch('/notices/:id', authz('notice:update'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'notices', uuid.parse(req.params.id), 'notices', LEVEL.WRITE);
    if (!mayEdit(level, row, req.user.id)) throw forbidden('Fremde Ankündigungen ändert nur, wer die Pinnwand verwaltet');
    const b = patchSchema(noticeFields).parse(req.body);
    if (b.rank_ids) await checkRanks(row.team_id, b.rank_ids);
    await q('UPDATE notices SET title=$2, body=$3, rank_ids=$4, pinned=$5, updated_at=now() WHERE id=$1',
      [row.id, b.title ?? row.title, b.body ?? row.body, b.rank_ids ? [...new Set(b.rank_ids)] : row.rank_ids, b.pinned ?? row.pinned]);
    await audit(req, 'notice.updated', 'notice', row.id, {});
    return { ok: true };
  });

  app.delete('/notices/:id', authz('notice:delete'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'notices', uuid.parse(req.params.id), 'notices', LEVEL.WRITE);
    if (!mayEdit(level, row, req.user.id)) throw forbidden('Fremde Ankündigungen löscht nur, wer die Pinnwand verwaltet');
    await q('DELETE FROM notices WHERE id=$1', [row.id]);
    await audit(req, 'notice.deleted', 'notice', row.id, { title: row.title });
    return { ok: true };
  });

  // Gelesen: nur wer die Ankündigung sehen darf
  app.post('/notices/:id/read', authz('notice:read'), async (req) => {
    const n = await one(`SELECT n.id FROM notices n WHERE n.id=$2 AND ${noticeVisibleSql('n')}`, [req.user.id, uuid.parse(req.params.id)]);
    if (!n) throw notFound('Ankündigung nicht gefunden');
    await q('INSERT INTO notice_reads(notice_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [n.id, req.user.id]);
    return { ok: true };
  });

  app.get('/notices/:id/reads', authz('notice:read'), async (req) => {
    const { row } = await loadTeamRow(req, 'notices', uuid.parse(req.params.id), 'notices', LEVEL.WRITE);
    const [list, reads] = await Promise.all([recipients(row), many('SELECT user_id, read_at FROM notice_reads WHERE notice_id=$1', [row.id])]);
    const at = new Map(reads.map((r) => [r.user_id, r.read_at]));
    return list.map((r) => ({ user_id: r.user_id, name: r.name, read_at: at.get(r.user_id) || null }));
  });

  // ---------- Umfragen
  app.get('/polls', authz('notice:read'), async (req) => {
    const { team_id: teamId } = z.object({ team_id: uuid }).parse(req.query);
    const level = await teamFor(req, teamId, 'notices', LEVEL.READ);
    const polls = await many(
      `SELECT p.*, u.name created_by_name, v.option_ids my_vote,
         (p.closed_at IS NOT NULL OR (p.closes_at IS NOT NULL AND p.closes_at <= now())) AS closed,
         (SELECT count(*)::int FROM poll_votes x WHERE x.poll_id=p.id) AS voters
       FROM polls p LEFT JOIN users u ON u.id=p.created_by LEFT JOIN poll_votes v ON v.poll_id=p.id AND v.user_id=$1
       WHERE p.team_id=$2 ORDER BY closed, p.created_at DESC LIMIT 200`,
      [req.user.id, teamId],
    );
    const ids = polls.map((p) => p.id);
    const votes = ids.length ? await many(
      `SELECT v.poll_id, v.option_ids, u.name FROM poll_votes v JOIN users u ON u.id=v.user_id WHERE v.poll_id = ANY($1::uuid[]) ORDER BY u.name`, [ids],
    ) : [];
    return polls.map((p) => {
      // Ergebnis nach der eigenen Stimme, nach dem Ende oder für Schreibende; Namen nie bei anonymen Umfragen
      const show = Boolean(p.my_vote) || p.closed || level >= LEVEL.WRITE;
      const mine = votes.filter((v) => v.poll_id === p.id);
      const results = show ? p.options.map((o) => {
        const by = mine.filter((v) => v.option_ids.includes(o.id));
        return { id: o.id, count: by.length, names: p.anonymous ? undefined : by.map((v) => v.name) };
      }) : null;
      return { ...p, results, can_edit: mayEdit(level, p, req.user.id), can_vote: level >= LEVEL.READ && !p.closed };
    });
  });

  app.post('/polls', authz('notice:create'), async (req) => {
    const b = pollFields.extend({ team_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, 'notices', LEVEL.WRITE);
    if (b.closes_at && new Date(b.closes_at) <= new Date()) throw bad('Das Ende muss in der Zukunft liegen');
    const options = b.options.map((text) => ({ id: crypto.randomUUID().slice(0, 8), text }));
    const row = await one(
      'INSERT INTO polls(team_id, question, description, options, multiple, anonymous, closes_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [b.team_id, b.question, b.description, JSON.stringify(options), b.multiple, b.anonymous, b.closes_at || null, req.user.id],
    );
    discord(b.team_id, 'poll', { title: `Umfrage: ${b.question}`, description: options.map((o) => `• ${o.text}`).join('\n'), path: 'board?tab=polls', fields: [{ name: 'Von', value: req.user.name }] }, req.log);
    await audit(req, 'poll.created', 'poll', row.id, { team: b.team_id });
    return row;
  });

  app.post('/polls/:id/vote', authz('notice:read'), async (req) => {
    const { row } = await loadTeamRow(req, 'polls', uuid.parse(req.params.id), 'notices', LEVEL.READ);
    const { option_ids: picked } = z.object({ option_ids: z.array(z.string().max(20)).min(1).max(20) }).parse(req.body);
    if (row.closed_at || (row.closes_at && new Date(row.closes_at) <= new Date())) throw bad('Die Umfrage ist beendet');
    const valid = new Set(row.options.map((o) => o.id));
    const ids = [...new Set(picked)];
    if (ids.some((id) => !valid.has(id))) throw bad('Unbekannte Antwort');
    if (!row.multiple && ids.length > 1) throw bad('Bei dieser Umfrage ist nur eine Antwort möglich');
    await q(`INSERT INTO poll_votes(poll_id, user_id, option_ids) VALUES ($1,$2,$3)
      ON CONFLICT (poll_id, user_id) DO UPDATE SET option_ids=$3, voted_at=now()`, [row.id, req.user.id, ids]);
    return { ok: true };
  });

  app.post('/polls/:id/close', authz('notice:update'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'polls', uuid.parse(req.params.id), 'notices', LEVEL.WRITE);
    if (!mayEdit(level, row, req.user.id)) throw forbidden('Fremde Umfragen beendet nur, wer die Pinnwand verwaltet');
    await q('UPDATE polls SET closed_at=COALESCE(closed_at, now()) WHERE id=$1', [row.id]);
    await audit(req, 'poll.closed', 'poll', row.id, {});
    return { ok: true };
  });

  app.delete('/polls/:id', authz('notice:delete'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'polls', uuid.parse(req.params.id), 'notices', LEVEL.WRITE);
    if (!mayEdit(level, row, req.user.id)) throw forbidden('Fremde Umfragen löscht nur, wer die Pinnwand verwaltet');
    await tx(async (c) => c.query('DELETE FROM polls WHERE id=$1', [row.id]));
    await audit(req, 'poll.deleted', 'poll', row.id, { question: row.question });
    return { ok: true };
  });
}
