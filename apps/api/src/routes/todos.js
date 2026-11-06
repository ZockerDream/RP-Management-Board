import { z } from 'zod';
import { one, many, q } from '../db.js';
import { requireAuth, recordRole, recordOwner } from '../authz.js';
import { patchSchema } from '../validation.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Ungültiges Datum');
const fields = {
  title: z.string().trim().min(1).max(200),
  note: z.string().max(5000).default(''),
  due_date: date.nullish(),
  team_id: z.string().uuid().nullish(),
};
const createBody = z.object(fields);
const patchBody = patchSchema(createBody).extend({ done: z.boolean().optional() });

export default async function routes(app) {
  app.get('/todos', requireAuth, async (req) => many(
    `SELECT td.id, td.title, td.note, td.due_date, td.done_at, td.team_id, t.name team_name, td.created_at,
       CASE WHEN td.owner_user_id=$1 THEN 'owner' ELSE tm.team_role END role, u.name done_by_name
     FROM todos td LEFT JOIN teams t ON t.id=td.team_id
       LEFT JOIN team_members tm ON tm.team_id=td.team_id AND tm.user_id=$1
       LEFT JOIN users u ON u.id=td.done_by
     WHERE td.owner_user_id=$1 OR tm.user_id IS NOT NULL
     ORDER BY td.done_at IS NOT NULL, td.done_at DESC, td.due_date NULLS LAST, td.created_at LIMIT 1000`,
    [req.user.id],
  ));

  app.post('/todos', requireAuth, async (req) => {
    const b = createBody.parse(req.body);
    const owner = await recordOwner(req.user.id, b.team_id);
    return one(
      'INSERT INTO todos(owner_user_id,team_id,title,note,due_date,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [owner.owner_user_id, owner.team_id, b.title, b.note, b.due_date || null, req.user.id],
    );
  });

  app.patch('/todos/:id', requireAuth, async (req) => {
    const todo = await one('SELECT * FROM todos WHERE id=$1', [req.params.id]);
    await recordRole(req.user.id, todo, true);
    const b = patchBody.parse(req.body);
    const moved = 'team_id' in b && (b.team_id || null) !== todo.team_id;
    const owner = moved ? await recordOwner(req.user.id, b.team_id) : todo;
    const isDone = b.done ?? Boolean(todo.done_at);
    const finishedNow = isDone && !todo.done_at;
    await q(
      `UPDATE todos SET title=$2, note=$3, due_date=$4, owner_user_id=$5, team_id=$6,
         done_at=CASE WHEN NOT $7::boolean THEN NULL WHEN $8::boolean THEN now() ELSE done_at END,
         done_by=CASE WHEN NOT $7::boolean THEN NULL WHEN $8::boolean THEN $9::uuid ELSE done_by END,
         updated_at=now()
       WHERE id=$1`,
      [todo.id, b.title ?? todo.title, b.note ?? todo.note, 'due_date' in b ? b.due_date || null : todo.due_date,
        owner.owner_user_id, owner.team_id, isDone, finishedNow, req.user.id],
    );
    return { ok: true };
  });

  app.delete('/todos/:id', requireAuth, async (req) => {
    const todo = await one('SELECT * FROM todos WHERE id=$1', [req.params.id]);
    await recordRole(req.user.id, todo, true);
    await q('DELETE FROM todos WHERE id=$1', [todo.id]);
    return { ok: true };
  });
}
