import { one, q } from '../db.js';
import { authz, notFound, budgetAccess } from '../authz.js';
import { receiveUpload, sendUpload, removeUpload } from '../uploads.js';

export default async function routes(app) {
  app.post('/transactions/:id/attachments', authz('transaction:update'), async (req) => {
    const t = await one('SELECT budget_id FROM transactions WHERE id=$1', [req.params.id]);
    if (!t) throw notFound();
    await budgetAccess(req.user.id, t.budget_id, true);
    const file = await receiveUpload(req);
    const r = await one('INSERT INTO attachments(transaction_id,storage_key,original_name,mime,size,sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.params.id, file.key, file.name, file.mime, file.size, file.sha256]);
    return r;
  });

  app.get('/transactions/:id/attachments', authz('transaction:read'), async (req) => {
    const t = await one('SELECT budget_id FROM transactions WHERE id=$1', [req.params.id]);
    if (!t) throw notFound();
    await budgetAccess(req.user.id, t.budget_id);
    return (await q('SELECT id, original_name, mime, size FROM attachments WHERE transaction_id=$1', [req.params.id])).rows;
  });

  app.get('/attachments/:id', authz('transaction:read'), async (req, reply) => {
    const a = await one('SELECT a.*, t.budget_id FROM attachments a JOIN transactions t ON t.id=a.transaction_id WHERE a.id=$1', [req.params.id]);
    if (!a) throw notFound();
    await budgetAccess(req.user.id, a.budget_id);
    return sendUpload(reply, a);
  });

  app.delete('/attachments/:id', authz('transaction:update'), async (req) => {
    const a = await one('SELECT a.*, t.budget_id FROM attachments a JOIN transactions t ON t.id=a.transaction_id WHERE a.id=$1', [req.params.id]);
    if (!a) throw notFound();
    await budgetAccess(req.user.id, a.budget_id, true);
    removeUpload(a.storage_key);
    await q('DELETE FROM attachments WHERE id=$1', [a.id]);
    return { ok: true };
  });
}
