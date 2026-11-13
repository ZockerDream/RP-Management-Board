// Personal (Wünsche des Auftraggebers vom 2026-11-13): Bewerbungen und Personalakte.
// Bewerbungen pflegen Mitglieder der Organisation; niemand bewirbt sich selbst über die App. Bei Annahme wird ein
// verknüpfter Benutzer Mitglied mit dem gewählten Rang (gleiche Regeln wie unter „Organisationen“).
// Funktion „recruiting“: 2 sehen, 3 anlegen und bearbeiten, 4 annehmen, ablehnen, löschen.
// Funktion „personnel“: die eigene Akte sieht jedes Mitglied; 2 alle sehen, 3 Einträge schreiben (Rang ändern zusätzlich
// mit „Mitglieder & Ränge: Lesen & Schreiben“), 4 Einträge löschen.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden, notFound } from '../authz.js';
import { LEVEL, isMember } from '../org.js';
import { audit } from '../audit.js';
import { uuid, isoDate, isoDateTime } from '../records.js';
import { patchSchema } from '../validation.js';
import { notify, today } from '../lib.js';
import { teamFor, loadTeamRow, teamName } from '../orgfeature.js';
import { discord } from '../discord-send.js';
import { actorOf, needMembers, belowActor, assertSubjectWithin, rankOf, memberOf, assertManageable } from './teams.js';

export const APPLICATION_STATUS = { new: 'Neu', interview: 'Gespräch', accepted: 'Angenommen', rejected: 'Abgelehnt', withdrawn: 'Zurückgezogen' };
export const ENTRY_KINDS = { hired: 'Eingestellt', promotion: 'Beförderung', demotion: 'Degradierung', commendation: 'Belobigung', warning: 'Verwarnung', note: 'Vermerk', left: 'Ausgeschieden' };

const appFields = z.object({
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(200).default(''),
  user_id: uuid.nullish(),
  person_id: uuid.nullish(),
  status: z.enum(['new', 'interview', 'withdrawn']).default('new'),
  interview_at: isoDateTime.nullish(),
  rank_id: uuid.nullish(),
  body: z.string().max(20000).default(''),
});

// Rang ändern wie unter „Organisationen“: Rechte bei Mitgliedern, nur unter dem eigenen Rang, nie mehr Rechte als selbst
async function changeRank(req, teamId, userId, rankId) {
  const actor = await actorOf(req.user.id, teamId);
  needMembers(actor, LEVEL.WRITE);
  const target = await memberOf(teamId, userId);
  assertManageable(actor, target);
  const rank = await rankOf(teamId, rankId);
  if (!belowActor(actor, rank.position)) throw forbidden('Du kannst nur Ränge unter deinem eigenen vergeben');
  await assertSubjectWithin(actor, 'rank_id', rank.id);
  await q('UPDATE team_members SET rank_id=$3 WHERE team_id=$1 AND user_id=$2', [teamId, userId, rank.id]);
  return { from: target.rank_name, to: rank.name };
}

async function checkRefs(teamId, b) {
  if (b.user_id && !(await one("SELECT 1 FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL", [b.user_id]))) throw bad('Benutzer nicht gefunden');
  if (b.person_id && !(await one('SELECT 1 FROM people WHERE id=$1', [b.person_id]))) throw bad('Person nicht gefunden');
  if (b.rank_id) await rankOf(teamId, b.rank_id);
}

export default async function routes(app) {
  // ---------- Bewerbungen
  app.get('/applications', authz('recruit:read'), async (req) => {
    const f = z.object({ team_id: uuid, status: z.enum(Object.keys(APPLICATION_STATUS)).optional() }).parse(req.query);
    const level = await teamFor(req, f.team_id, 'recruiting', LEVEL.READ);
    const rows = await many(
      `SELECT a.*, u.name user_name, pe.name person_name, r.name rank_name, cu.name created_by_name, du.name decided_by_name,
         (SELECT count(*)::int FROM application_notes n WHERE n.application_id=a.id) notes
       FROM applications a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN people pe ON pe.id=a.person_id LEFT JOIN team_ranks r ON r.id=a.rank_id
       LEFT JOIN users cu ON cu.id=a.created_by LEFT JOIN users du ON du.id=a.decided_by
       WHERE a.team_id=$1 AND ($2::text IS NULL OR a.status=$2)
       ORDER BY (a.status IN ('new', 'interview')) DESC, COALESCE(a.interview_at, a.created_at) DESC LIMIT 500`,
      [f.team_id, f.status || null],
    );
    return { level, items: rows };
  });

  app.get('/applications/:id', authz('recruit:read'), async (req) => {
    const { row, level } = await loadTeamRow(req, 'applications', uuid.parse(req.params.id), 'recruiting', LEVEL.READ);
    const notes = await many('SELECT n.*, u.name created_by_name FROM application_notes n LEFT JOIN users u ON u.id=n.created_by WHERE n.application_id=$1 ORDER BY n.created_at', [row.id]);
    return { ...row, level, notes };
  });

  app.post('/applications', authz('recruit:create'), async (req) => {
    const b = appFields.extend({ team_id: uuid }).parse(req.body);
    await teamFor(req, b.team_id, 'recruiting', LEVEL.WRITE);
    await checkRefs(b.team_id, b);
    const row = await one(
      `INSERT INTO applications(team_id, name, contact, user_id, person_id, status, interview_at, rank_id, body, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b.team_id, b.name, b.contact, b.user_id || null, b.person_id || null, b.status, b.interview_at || null, b.rank_id || null, b.body, req.user.id],
    );
    await audit(req, 'application.created', 'application', row.id, { team: b.team_id, name: b.name });
    return row;
  });

  app.patch('/applications/:id', authz('recruit:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'applications', uuid.parse(req.params.id), 'recruiting', LEVEL.WRITE);
    if (['accepted', 'rejected'].includes(row.status)) throw bad('Entschiedene Bewerbungen lassen sich nicht mehr ändern');
    const b = { ...row, ...patchSchema(appFields).parse(req.body) };
    await checkRefs(row.team_id, b);
    await q(`UPDATE applications SET name=$2, contact=$3, user_id=$4, person_id=$5, status=$6, interview_at=$7, rank_id=$8, body=$9, updated_at=now() WHERE id=$1`,
      [row.id, b.name, b.contact, b.user_id || null, b.person_id || null, b.status, b.interview_at || null, b.rank_id || null, b.body]);
    await audit(req, 'application.updated', 'application', row.id, {});
    return { ok: true };
  });

  app.post('/applications/:id/notes', authz('recruit:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'applications', uuid.parse(req.params.id), 'recruiting', LEVEL.WRITE);
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
    await q('INSERT INTO application_notes(application_id, body, created_by) VALUES ($1,$2,$3)', [row.id, body, req.user.id]);
    await q('UPDATE applications SET updated_at=now() WHERE id=$1', [row.id]);
    return { ok: true };
  });

  // Entscheidung: annehmen (verknüpfter Benutzer wird Mitglied mit Rang) oder ablehnen
  app.post('/applications/:id/decide', authz('recruit:update'), async (req) => {
    const { row } = await loadTeamRow(req, 'applications', uuid.parse(req.params.id), 'recruiting', LEVEL.MANAGE);
    if (['accepted', 'rejected'].includes(row.status)) throw bad('Die Bewerbung ist schon entschieden');
    const b = z.object({ decision: z.enum(['accepted', 'rejected']), rank_id: uuid.nullish(), note: z.string().trim().max(2000).default('') }).parse(req.body);
    const team = await teamName(row.team_id);
    let member = null;
    if (b.decision === 'accepted' && row.user_id) {
      const rankId = b.rank_id || row.rank_id;
      if (!rankId) throw bad('Wähle den Rang, mit dem die Person Mitglied wird');
      // Gleiche Regeln wie beim Hinzufügen unter „Organisationen“
      const actor = await actorOf(req.user.id, row.team_id);
      needMembers(actor, LEVEL.WRITE);
      const rank = await rankOf(row.team_id, rankId);
      if (!belowActor(actor, rank.position)) throw forbidden('Du kannst nur Ränge unter deinem eigenen vergeben');
      await assertSubjectWithin(actor, 'rank_id', rank.id);
      if (await isMember(row.user_id, row.team_id)) throw bad('Die Person ist schon Mitglied');
      await tx(async (c) => {
        await c.query('INSERT INTO team_members(team_id, user_id, rank_id) VALUES ($1,$2,$3)', [row.team_id, row.user_id, rank.id]);
        await c.query(`INSERT INTO personnel_entries(team_id, user_id, kind, title, body, rank_to, created_by) VALUES ($1,$2,'hired',$3,$4,$5,$6)`,
          [row.team_id, row.user_id, `Eingestellt als ${rank.name}`, b.note, rank.name, req.user.id]);
      });
      member = { rank: rank.name };
      await notify(row.user_id, 'team_added', `Du wurdest in „${team}“ aufgenommen`, `Rang: ${rank.name}`, undefined, req.log);
    }
    await q('UPDATE applications SET status=$2, decision_note=$3, decided_by=$4, decided_at=now(), rank_id=COALESCE($5, rank_id), updated_at=now() WHERE id=$1',
      [row.id, b.decision, b.note, req.user.id, b.rank_id || null]);
    if (b.decision === 'accepted') discord(row.team_id, 'application', { title: `Willkommen: ${row.name}`, description: member ? `Neues Mitglied als ${member.rank}` : 'Bewerbung angenommen', path: 'personnel?tab=applications' }, req.log);
    await audit(req, `application.${b.decision}`, 'application', row.id, { member: Boolean(member) });
    return { ok: true, member };
  });

  app.delete('/applications/:id', authz('recruit:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'applications', uuid.parse(req.params.id), 'recruiting', LEVEL.MANAGE);
    await q('DELETE FROM applications WHERE id=$1', [row.id]);
    await audit(req, 'application.deleted', 'application', row.id, { name: row.name });
    return { ok: true };
  });

  // ---------- Personalakte: Mitglieder mit Rang und Zahl der Einträge; die eigene sieht jedes Mitglied
  app.get('/personnel', authz('personnel:read'), async (req) => {
    const { team_id: teamId } = z.object({ team_id: uuid }).parse(req.query);
    const level = await teamFor(req, teamId, 'personnel', 0);
    const members = await many(
      `SELECT tm.user_id, u.name, r.name rank_name, r.position, tm.is_owner,
         (SELECT count(*)::int FROM personnel_entries e WHERE e.team_id=tm.team_id AND e.user_id=tm.user_id) entries,
         (SELECT max(entry_date) FROM personnel_entries e WHERE e.team_id=tm.team_id AND e.user_id=tm.user_id AND e.kind IN ('promotion','demotion','hired')) last_rank_change
       FROM team_members tm JOIN users u ON u.id=tm.user_id LEFT JOIN team_ranks r ON r.id=tm.rank_id
       WHERE tm.team_id=$1 AND ($2 OR tm.user_id=$3) ORDER BY r.position DESC NULLS LAST, u.name`,
      [teamId, level >= LEVEL.READ, req.user.id],
    );
    return { level, members };
  });

  app.get('/personnel/:userId', authz('personnel:read'), async (req) => {
    const f = z.object({ team_id: uuid }).parse(req.query);
    const userId = uuid.parse(req.params.userId);
    const level = await teamFor(req, f.team_id, 'personnel', userId === req.user.id ? 0 : LEVEL.READ);
    const member = await one(
      `SELECT tm.user_id, u.name, r.name rank_name, tm.rank_id, tm.is_owner FROM team_members tm JOIN users u ON u.id=tm.user_id
       LEFT JOIN team_ranks r ON r.id=tm.rank_id WHERE tm.team_id=$1 AND tm.user_id=$2`, [f.team_id, userId]);
    const entries = await many(
      `SELECT e.*, u.name created_by_name FROM personnel_entries e LEFT JOIN users u ON u.id=e.created_by
       WHERE e.team_id=$1 AND e.user_id=$2 ORDER BY e.entry_date DESC, e.created_at DESC`, [f.team_id, userId]);
    if (!member && !entries.length) throw notFound('Mitglied nicht gefunden');
    return { level, member, entries };
  });

  app.post('/personnel/:userId/entries', authz('personnel:create'), async (req) => {
    const userId = uuid.parse(req.params.userId);
    const b = z.object({
      team_id: uuid, kind: z.enum(Object.keys(ENTRY_KINDS)), title: z.string().trim().max(200).default(''), body: z.string().max(10000).default(''),
      entry_date: isoDate.optional(), rank_id: uuid.nullish(),
    }).parse(req.body);
    await teamFor(req, b.team_id, 'personnel', LEVEL.WRITE);
    if (userId === req.user.id && ['promotion', 'demotion'].includes(b.kind)) throw forbidden('Deinen eigenen Rang ändert jemand über dir');
    if (!(await isMember(userId, b.team_id)) && b.kind !== 'left') throw bad('Die Person ist kein Mitglied dieser Organisation');
    let change = null;
    // Beförderung/Degradierung mit Rang ändert ihn sofort (mit den Regeln von „Organisationen“)
    if (b.rank_id && ['promotion', 'demotion'].includes(b.kind)) change = await changeRank(req, b.team_id, userId, b.rank_id);
    const title = b.title || (change ? `${ENTRY_KINDS[b.kind]} zu ${change.to}` : ENTRY_KINDS[b.kind]);
    const row = await one(
      `INSERT INTO personnel_entries(team_id, user_id, kind, title, body, rank_from, rank_to, entry_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [b.team_id, userId, b.kind, title, b.body, change?.from || null, change?.to || null, b.entry_date || today(), req.user.id],
    );
    if (userId !== req.user.id) await notify(userId, 'personnel', `${await teamName(b.team_id)}: ${title}`, b.body.slice(0, 300), undefined, req.log);
    await audit(req, `personnel.${b.kind}`, 'personnel_entry', row.id, { team: b.team_id, user: userId, rank: change?.to });
    return { id: row.id, rank: change };
  });

  app.delete('/personnel-entries/:id', authz('personnel:delete'), async (req) => {
    const { row } = await loadTeamRow(req, 'personnel_entries', uuid.parse(req.params.id), 'personnel', LEVEL.MANAGE);
    await q('DELETE FROM personnel_entries WHERE id=$1', [row.id]);
    await audit(req, 'personnel.entry_deleted', 'personnel_entry', row.id, { user: row.user_id });
    return { ok: true };
  });
}
