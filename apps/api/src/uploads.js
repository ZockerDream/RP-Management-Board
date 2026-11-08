// Datei-Uploads (Belege, Akten-Anhänge): nur PDF, PNG und JPEG, Inhalt muss zum Typ passen, Ablage unter zufälligem Namen
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { bad } from './authz.js';

const ALLOWED = new Map([
  ['application/pdf', Buffer.from('%PDF')],
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
]);

export const uploadPath = (storageKey) => path.join(config.uploadDir, path.basename(storageKey));

export async function receiveUpload(req) {
  const part = await req.file();
  if (!part) throw bad('Datei fehlt');
  if (!ALLOWED.has(part.mimetype)) throw bad('Nur PDF, PNG und JPEG erlaubt');
  fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });
  const key = crypto.randomUUID();
  const dest = uploadPath(key);
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
  return { key, name, mime: part.mimetype, size, sha256: hash.digest('hex') };
}

export function sendUpload(reply, file) {
  reply.header('content-type', file.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`).header('x-content-type-options', 'nosniff');
  return fs.createReadStream(uploadPath(file.storage_key));
}

export const removeUpload = (storageKey) => fs.rmSync(uploadPath(storageKey), { force: true });
