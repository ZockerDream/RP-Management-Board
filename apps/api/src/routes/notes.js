import { z } from 'zod';
import { one, many, q } from '../db.js';
import { requireAuth, bad } from '../authz.js';
import { LEVEL, levelSql, recordLevel, recordOwner } from '../org.js';

const fields = z.object({
  title: z.string().trim().max(150),
  body: z.string().max(50000),
  pinned: z.boolean(),
  team_id: z.string().uuid().nullable(),
}).partial();

const requireText = (title, body) => {
  if (!title && !body.trim()) throw bad('Titel oder Text erforderlich');
};

export default async function routes(app) {
  app.get('/notes', requireAuth, async (req) => many(
    `SELECT * FROM (
       SELECT n.id, n.title, n.body, n.pinned, n.team_id, t.name team_name, n.created_at, n.updated_at,
         ${levelSql('n', 'notes')} AS level, u.name updated_by_name
       FROM notes n LEFT JOIN teams t ON t.id=n.team_id LEFT JOIN users u ON u.id=n.updated_by
       WHERE n.owner_user_id=$1 OR n.team_id IS NOT NULL
     ) x WHERE x.level >= 2 ORDER BY x.pinned DESC, x.updated_at DESC LIMIT 500`,
    [req.user.id],
  ));

  app.post('/notes', requireAuth, async (req) => {
    const b = fields.parse(req.body);
    const title = b.title ?? '', body = b.body ?? '';
    requireText(title, body);
    const owner = await recordOwner(req.user.id, b.team_id, 'notes');
    return one(
      'INSERT INTO notes(owner_user_id,team_id,title,body,pinned,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id',
      [owner.owner_user_id, owner.team_id, title, body, b.pinned ?? false, req.user.id],
    );
  });

  app.patch('/notes/:id', requireAuth, async (req) => {
    const note = await one('SELECT * FROM notes WHERE id=$1', [req.params.id]);
    await recordLevel(req.user.id, note, 'notes', { need: LEVEL.WRITE });
    const b = fields.parse(req.body);
    const title = b.title ?? note.title, body = b.body ?? note.body;
    requireText(title, body);
    const moved = 'team_id' in b && (b.team_id || null) !== note.team_id;
    const owner = moved ? await recordOwner(req.user.id, b.team_id, 'notes') : note;
    // Anheften zählt nicht als Bearbeitung
    const edited = moved || title !== note.title || body !== note.body;
    await q(
      `UPDATE notes SET title=$2, body=$3, pinned=$4, owner_user_id=$5, team_id=$6,
         updated_by=CASE WHEN $7::boolean THEN $8::uuid ELSE updated_by END,
         updated_at=CASE WHEN $7::boolean THEN now() ELSE updated_at END
       WHERE id=$1`,
      [note.id, title, body, b.pinned ?? note.pinned, owner.owner_user_id, owner.team_id, edited, req.user.id],
    );
    return { ok: true };
  });

  app.delete('/notes/:id', requireAuth, async (req) => {
    const note = await one('SELECT * FROM notes WHERE id=$1', [req.params.id]);
    await recordLevel(req.user.id, note, 'notes', { need: LEVEL.WRITE });
    await q('DELETE FROM notes WHERE id=$1', [note.id]);
    return { ok: true };
  });
}
