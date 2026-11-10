import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { requireAuth, bad } from '../authz.js';
import { LEVEL, levelSql, recordLevel, recordOwner } from '../org.js';

const fields = z.object({
  title: z.string().trim().max(150),
  body: z.string().max(50000),
  pinned: z.boolean(),
  team_id: z.string().uuid().nullable(),
  tag_ids: z.array(z.string().uuid()).max(50),
  archived: z.boolean(),
}).partial();

const requireText = (title, body) => {
  if (!title && !body.trim()) throw bad('Titel oder Text erforderlich');
};

// Tags verwaltet das Server-Management (admin.js); hier nur prüfen, dass es sie gibt
async function checkTags(tagIds) {
  const ids = [...new Set(tagIds)];
  if (!ids.length) return ids;
  const found = await one('SELECT count(*)::int n FROM note_tags WHERE id = ANY($1::uuid[])', [ids]);
  if (found.n !== ids.length) throw bad('Unbekannter Tag, bitte die Seite neu laden');
  return ids;
}

async function setTags(client, noteId, ids) {
  await client.query('DELETE FROM note_tag_links WHERE note_id=$1 AND NOT (tag_id = ANY($2::uuid[]))', [noteId, ids]);
  if (ids.length) {
    await client.query(
      // aus note_tags gelesen: ein gerade gelöschter Tag fällt weg statt an der Fremdschlüssel-Prüfung zu scheitern
      'INSERT INTO note_tag_links(note_id, tag_id) SELECT $1, id FROM note_tags WHERE id = ANY($2::uuid[]) ON CONFLICT DO NOTHING',
      [noteId, ids],
    );
  }
}

export default async function routes(app) {
  app.get('/note-tags', requireAuth, async () => many('SELECT id, name, color, position FROM note_tags ORDER BY position, lower(name)'));

  app.get('/notes', requireAuth, async (req) => many(
    `SELECT * FROM (
       SELECT n.id, n.title, n.body, n.pinned, n.team_id, t.name team_name, n.created_at, n.updated_at,
         ${levelSql('n', 'notes')} AS level, u.name updated_by_name, n.archived_at, au.name archived_by_name,
         ARRAY(SELECT l.tag_id FROM note_tag_links l JOIN note_tags nt ON nt.id=l.tag_id
               WHERE l.note_id=n.id ORDER BY nt.position, lower(nt.name)) AS tag_ids
       FROM notes n LEFT JOIN teams t ON t.id=n.team_id LEFT JOIN users u ON u.id=n.updated_by LEFT JOIN users au ON au.id=n.archived_by
       WHERE n.owner_user_id=$1 OR n.team_id IS NOT NULL
     ) x WHERE x.level >= 2
     -- offene zuerst, damit ein volles Archiv sie nicht aus der Grenze drängt
     ORDER BY x.archived_at IS NOT NULL, x.pinned DESC, x.updated_at DESC, x.archived_at DESC LIMIT 1000`,
    [req.user.id],
  ));

  app.post('/notes', requireAuth, async (req) => {
    const b = fields.parse(req.body);
    const title = b.title ?? '', body = b.body ?? '';
    requireText(title, body);
    const owner = await recordOwner(req.user.id, b.team_id, 'notes');
    const tagIds = await checkTags(b.tag_ids ?? []);
    return tx(async (client) => {
      const { rows: [note] } = await client.query(
        'INSERT INTO notes(owner_user_id,team_id,title,body,pinned,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id',
        [owner.owner_user_id, owner.team_id, title, body, b.pinned ?? false, req.user.id],
      );
      await setTags(client, note.id, tagIds);
      return note;
    });
  });

  app.patch('/notes/:id', requireAuth, async (req) => {
    const note = await one('SELECT * FROM notes WHERE id=$1', [req.params.id]);
    await recordLevel(req.user.id, note, 'notes', { need: LEVEL.WRITE });
    const b = fields.parse(req.body);
    const title = b.title ?? note.title, body = b.body ?? note.body;
    requireText(title, body);
    const moved = 'team_id' in b && (b.team_id || null) !== note.team_id;
    const owner = moved ? await recordOwner(req.user.id, b.team_id, 'notes') : note;
    const tagIds = b.tag_ids ? await checkTags(b.tag_ids) : null;
    // Archivieren löst das Anheften; eine archivierte Notiz lässt sich nicht anheften
    const archived = b.archived ?? Boolean(note.archived_at);
    if (archived && b.pinned) throw bad('Archivierte Notizen lassen sich nicht anheften');
    const pinned = archived ? false : b.pinned ?? note.pinned;
    // Anheften, Archivieren und Tags zählen nicht als Bearbeitung
    const edited = moved || title !== note.title || body !== note.body;
    await tx(async (client) => {
      await client.query(
        `UPDATE notes SET title=$2, body=$3, pinned=$4, owner_user_id=$5, team_id=$6,
           updated_by=CASE WHEN $7::boolean THEN $8::uuid ELSE updated_by END,
           updated_at=CASE WHEN $7::boolean THEN now() ELSE updated_at END,
           archived_at=CASE WHEN NOT $9::boolean THEN NULL WHEN archived_at IS NULL THEN now() ELSE archived_at END,
           archived_by=CASE WHEN NOT $9::boolean THEN NULL WHEN archived_at IS NULL THEN $8::uuid ELSE archived_by END
         WHERE id=$1`,
        [note.id, title, body, pinned, owner.owner_user_id, owner.team_id, edited, req.user.id, archived],
      );
      if (tagIds) await setTags(client, note.id, tagIds);
    });
    return { ok: true };
  });

  app.delete('/notes/:id', requireAuth, async (req) => {
    const note = await one('SELECT * FROM notes WHERE id=$1', [req.params.id]);
    await recordLevel(req.user.id, note, 'notes', { need: LEVEL.WRITE });
    await q('DELETE FROM notes WHERE id=$1', [note.id]);
    return { ok: true };
  });
}
