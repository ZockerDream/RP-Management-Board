import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { authz, bad, notFound, budgetAccess } from '../authz.js';

const ALLOWED = new Map([
  ['application/pdf', Buffer.from('%PDF')],
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
]);

export default async function routes(app) {
  app.post('/transactions/:id/attachments', authz('transaction:update'), async (req) => {
    const t = await one('SELECT budget_id FROM transactions WHERE id=$1', [req.params.id]);
    if (!t) throw notFound();
    await budgetAccess(req.user.id, t.budget_id, true);
    const part = await req.file();
    if (!part) throw bad('Datei fehlt');
    if (!ALLOWED.has(part.mimetype)) throw bad('Nur PDF, PNG und JPEG erlaubt');
    fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });
    const key = crypto.randomUUID();
    const dest = path.join(config.uploadDir, key);
    const hash = crypto.createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    part.file.on('data', (c) => {
      size += c.length;
      hash.update(c);
      if (head.length < 8) head = Buffer.concat([head, c]).subarray(0, 8);
    });
    try {
      await pipeline(part.file, fs.createWriteStream(dest, { mode: 0o600 }));
      if (part.file.truncated) throw bad(`Datei größer als ${config.maxUploadBytes / 1048576} MB`);
      if (!head.subarray(0, ALLOWED.get(part.mimetype).length).equals(ALLOWED.get(part.mimetype))) throw bad('Dateiinhalt passt nicht zum Typ');
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw e;
    }
    const name = path.basename(part.filename || 'datei').replace(/[^\w.\- äöüÄÖÜß]/g, '_').slice(0, 120);
    const r = await one('INSERT INTO attachments(transaction_id,storage_key,original_name,mime,size,sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.params.id, key, name, part.mimetype, size, hash.digest('hex')]);
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
    reply.header('content-type', a.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.original_name)}`).header('x-content-type-options', 'nosniff');
    return fs.createReadStream(path.join(config.uploadDir, path.basename(a.storage_key)));
  });

  app.delete('/attachments/:id', authz('transaction:update'), async (req) => {
    const a = await one('SELECT a.*, t.budget_id FROM attachments a JOIN transactions t ON t.id=a.transaction_id WHERE a.id=$1', [req.params.id]);
    if (!a) throw notFound();
    await budgetAccess(req.user.id, a.budget_id, true);
    fs.rmSync(path.join(config.uploadDir, path.basename(a.storage_key)), { force: true });
    await q('DELETE FROM attachments WHERE id=$1', [a.id]);
    return { ok: true };
  });
}
