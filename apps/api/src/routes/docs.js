import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound } from '../authz.js';
import { LEVEL, levelSql, recordLevel, recordOwner } from '../org.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { uuid } from '../records.js';

// Rechte gelten pro Kategorie (eigene Zeile) oder für Dokumentationen allgemein
const categoryLevelSql = (alias, n = '$1') => levelSql(alias, 'doc', n, `${alias}.id`);

const categoryFields = z.object({
  name: z.string().trim().min(1).max(100),
  sort: z.number().int().min(-1000).max(1000).default(0),
});
const pageFields = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200000).default(''),
  pinned: z.boolean().default(false),
});

export default async function routes(app) {
  // Lesen ab 2, Seiten schreiben ab 3, Seiten löschen und die Kategorie verwalten mit 4
  async function loadCategory(req, id, need = LEVEL.READ) {
    const category = await one('SELECT * FROM doc_categories WHERE id=$1', [id]);
    const level = await recordLevel(req.user.id, category, 'doc', { need, scope: category?.id });
    return { category, level };
  }
  async function loadPage(req, need = LEVEL.READ) {
    const page = await one('SELECT * FROM doc_pages WHERE id=$1', [req.params.id]);
    if (!page) throw notFound();
    const { category, level } = await loadCategory(req, page.category_id, need);
    return { page, category, level };
  }

  // ---- Kategorien
  app.get('/doc-categories', authz('doc:read'), async (req) => many(
    `SELECT * FROM (
       SELECT c.id, c.name, c.sort, c.team_id, t.name team_name, ${categoryLevelSql('c')} AS level,
         (SELECT count(*)::int FROM doc_pages p WHERE p.category_id=c.id) pages
       FROM doc_categories c LEFT JOIN teams t ON t.id=c.team_id WHERE c.owner_user_id=$1 OR c.team_id IS NOT NULL
     ) x WHERE x.level >= 2 ORDER BY x.team_id NULLS FIRST, x.team_name, x.sort, x.name`,
    [req.user.id],
  ));

  app.post('/doc-categories', authz('doc:create'), async (req) => {
    const b = categoryFields.extend({ team_id: uuid.nullish() }).parse(req.body);
    const scope = await recordOwner(req.user.id, b.team_id, 'doc', LEVEL.MANAGE);
    const row = await one('INSERT INTO doc_categories(owner_user_id,team_id,name,sort) VALUES ($1,$2,$3,$4) RETURNING id', [scope.owner_user_id, scope.team_id, b.name, b.sort]);
    await audit(req, 'doc_category.created', 'doc_category', row.id, { name: b.name });
    return row;
  });

  app.patch('/doc-categories/:id', authz('doc:update'), async (req) => {
    const { category } = await loadCategory(req, req.params.id, LEVEL.MANAGE);
    const b = patchSchema(categoryFields).parse(req.body);
    await q('UPDATE doc_categories SET name=$2, sort=$3 WHERE id=$1', [category.id, b.name ?? category.name, b.sort ?? category.sort]);
    await audit(req, 'doc_category.updated', 'doc_category', category.id);
    return { ok: true };
  });

  app.delete('/doc-categories/:id', authz('doc:delete'), async (req) => {
    const { category } = await loadCategory(req, req.params.id, LEVEL.MANAGE);
    if (await one('SELECT 1 FROM doc_pages WHERE category_id=$1 LIMIT 1', [category.id])) throw bad('Die Kategorie enthält noch Seiten – zuerst verschieben oder löschen');
    await tx(async (client) => {
      await client.query('DELETE FROM team_permissions WHERE scope_id=$1', [category.id]);
      await client.query('DELETE FROM doc_categories WHERE id=$1', [category.id]);
    });
    await audit(req, 'doc_category.deleted', 'doc_category', category.id, { name: category.name });
    return { ok: true };
  });

  // ---- Seiten
  app.get('/doc-pages', authz('doc:read'), async (req) => {
    const f = z.object({ category_id: uuid.optional(), q: z.string().trim().max(100).optional() }).parse(req.query);
    const params = [req.user.id];
    const where = [`${categoryLevelSql('c')} >= 2`];
    if (f.category_id) { params.push(f.category_id); where.push(`p.category_id=$${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(p.title ILIKE $${params.length} OR p.body ILIKE $${params.length})`); }
    // Liste ohne vollen Text; bei einer Suche ein Ausschnitt um den ersten Treffer
    const excerpt = f.q
      ? `substring(p.body FROM greatest(1, strpos(lower(p.body), lower($${params.push(f.q)})) - 60) FOR 200)`
      : 'left(p.body, 200)';
    return many(
      `SELECT p.id, p.category_id, c.name category_name, c.team_id, p.title, p.pinned, p.updated_at, u.name updated_by_name,
         ${excerpt} excerpt, ${categoryLevelSql('c')} AS level
       FROM doc_pages p JOIN doc_categories c ON c.id=p.category_id LEFT JOIN users u ON u.id=p.updated_by
       WHERE ${where.join(' AND ')}
       ORDER BY p.pinned DESC, p.title LIMIT 500`,
      params,
    );
  });

  app.get('/doc-pages/:id', authz('doc:read'), async (req) => {
    const { page, category, level } = await loadPage(req);
    const names = await one('SELECT (SELECT name FROM users WHERE id=$1) created_by_name, (SELECT name FROM users WHERE id=$2) updated_by_name', [page.created_by, page.updated_by]);
    return { ...page, ...names, category_name: category.name, team_id: category.team_id, level };
  });

  app.post('/doc-pages', authz('doc:create'), async (req) => {
    const b = pageFields.extend({ category_id: uuid }).parse(req.body);
    const { category } = await loadCategory(req, b.category_id, LEVEL.WRITE);
    const row = await one(
      'INSERT INTO doc_pages(category_id,title,body,pinned,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id',
      [category.id, b.title, b.body, b.pinned, req.user.id],
    );
    await audit(req, 'doc_page.created', 'doc_page', row.id, { title: b.title });
    return row;
  });

  app.patch('/doc-pages/:id', authz('doc:update'), async (req) => {
    const { page, category } = await loadPage(req, LEVEL.WRITE);
    const b = patchSchema(pageFields).extend({ category_id: uuid.optional() }).parse(req.body);
    // Verschieben nur in eine Kategorie desselben Bereichs, sonst sähen andere Personen die Seite
    if (b.category_id && b.category_id !== category.id) {
      const { category: target } = await loadCategory(req, b.category_id, LEVEL.WRITE);
      if (target.team_id !== category.team_id || target.owner_user_id !== category.owner_user_id) throw bad('Seiten lassen sich nur innerhalb desselben Bereichs verschieben');
    }
    const edited = ['title', 'body', 'category_id'].some((key) => key in b && b[key] !== page[key]);
    await q(
      `UPDATE doc_pages SET category_id=$2, title=$3, body=$4, pinned=$5,
         updated_by=CASE WHEN $6::boolean THEN $7::uuid ELSE updated_by END, updated_at=CASE WHEN $6::boolean THEN now() ELSE updated_at END
       WHERE id=$1`,
      [page.id, b.category_id ?? page.category_id, b.title ?? page.title, b.body ?? page.body, b.pinned ?? page.pinned, edited, req.user.id],
    );
    if (edited) await audit(req, 'doc_page.updated', 'doc_page', page.id);
    return { ok: true };
  });

  app.delete('/doc-pages/:id', authz('doc:delete'), async (req) => {
    const { page } = await loadPage(req, LEVEL.MANAGE);
    await q('DELETE FROM doc_pages WHERE id=$1', [page.id]);
    await audit(req, 'doc_page.deleted', 'doc_page', page.id, { title: page.title });
    return { ok: true };
  });
}
