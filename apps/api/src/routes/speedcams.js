// Blitzer (Wünsche des Auftraggebers vom 2026-11-13): systemweit, Rechte allein über die Rollenrechte speedcam:*.
// Standorte fester und mobiler Blitzer mit je einem Bild (PNG/JPEG im Upload-Volume). Rechnungen gibt es nicht mehr.
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, notFound } from '../authz.js';
import { audit } from '../audit.js';
import { uuid } from '../records.js';
import { patchSchema } from '../validation.js';
import { receiveUpload, sendUpload, removeUpload } from '../uploads.js';

const cameraFields = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().max(200).default(''),
  kind: z.enum(['fixed', 'mobile']).default('fixed'),
  speed_limit: z.number().int().min(1).max(400),
  active: z.boolean().default(true),
  note: z.string().max(2000).default(''),
});
const COLUMNS = `c.id, c.name, c.location, c.kind, c.speed_limit, c.active, c.note, c.created_at, c.updated_at,
  (c.photo_key IS NOT NULL) has_photo, u.name created_by_name`;

async function loadCamera(id) {
  const camera = await one('SELECT * FROM speed_cameras WHERE id=$1', [uuid.parse(id)]);
  if (!camera) throw notFound('Standort nicht gefunden');
  return camera;
}
const save = async (sql, params) => {
  try {
    return await one(sql, params);
  } catch (e) {
    if (e.code === '23505') throw bad('Einen Standort mit diesem Namen gibt es schon');
    throw e;
  }
};

export default async function routes(app) {
  app.get('/speed-cameras', authz('speedcam:read'), async () => many(
    `SELECT ${COLUMNS} FROM speed_cameras c LEFT JOIN users u ON u.id=c.created_by ORDER BY c.active DESC, lower(c.name)`,
  ));

  app.post('/speed-cameras', authz('speedcam:create'), async (req) => {
    const b = cameraFields.parse(req.body);
    const row = await save(
      'INSERT INTO speed_cameras(name, location, kind, speed_limit, active, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [b.name, b.location, b.kind, b.speed_limit, b.active, b.note, req.user.id],
    );
    await audit(req, 'speedcam.camera_created', 'speed_camera', row.id, { name: b.name });
    return row;
  });

  app.patch('/speed-cameras/:id', authz('speedcam:update'), async (req) => {
    const camera = await loadCamera(req.params.id);
    const patch = patchSchema(cameraFields).parse(req.body);
    const keys = Object.keys(patch);
    if (!keys.length) return { ok: true };
    await save(`UPDATE speed_cameras SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1 RETURNING id`,
      [camera.id, ...keys.map((k) => patch[k])]);
    await audit(req, 'speedcam.camera_updated', 'speed_camera', camera.id, { fields: keys });
    return { ok: true };
  });

  app.delete('/speed-cameras/:id', authz('speedcam:delete'), async (req) => {
    const camera = await loadCamera(req.params.id);
    await q('DELETE FROM speed_cameras WHERE id=$1', [camera.id]);
    if (camera.photo_key) removeUpload(camera.photo_key);
    await audit(req, 'speedcam.camera_deleted', 'speed_camera', camera.id, { name: camera.name });
    return { ok: true };
  });

  // ---------- Bild des Standorts: genau eines, PNG oder JPEG; ein neues ersetzt das alte
  app.post('/speed-cameras/:id/photo', authz('speedcam:update'), async (req) => {
    const camera = await loadCamera(req.params.id);
    const upload = await receiveUpload(req, { images: true });
    await q('UPDATE speed_cameras SET photo_key=$2, photo_mime=$3, updated_at=now() WHERE id=$1', [camera.id, upload.key, upload.mime]);
    if (camera.photo_key) removeUpload(camera.photo_key);
    await audit(req, 'speedcam.photo_set', 'speed_camera', camera.id, { name: camera.name });
    return { ok: true };
  });
  app.get('/speed-cameras/:id/photo', authz('speedcam:read'), async (req, reply) => {
    const camera = await loadCamera(req.params.id);
    if (!camera.photo_key) throw notFound('Kein Bild hinterlegt');
    return sendUpload(reply, { storage_key: camera.photo_key, mime: camera.photo_mime, original_name: `blitzer-${camera.id}.${camera.photo_mime === 'image/png' ? 'png' : 'jpg'}` });
  });
  app.delete('/speed-cameras/:id/photo', authz('speedcam:update'), async (req) => {
    const camera = await loadCamera(req.params.id);
    if (!camera.photo_key) throw bad('Kein Bild hinterlegt');
    await q('UPDATE speed_cameras SET photo_key=NULL, photo_mime=NULL, updated_at=now() WHERE id=$1', [camera.id]);
    removeUpload(camera.photo_key);
    await audit(req, 'speedcam.photo_removed', 'speed_camera', camera.id, { name: camera.name });
    return { ok: true };
  });
}
