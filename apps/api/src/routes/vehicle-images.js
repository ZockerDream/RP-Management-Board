// Bilder zu Fahrzeugen (Wunsch des Auftraggebers vom 2026-11-10): PNG und JPEG wie Fotos in der Personenakte.
// Sehen, wer das Fahrzeug sieht; hochladen, beschriften und löschen ab „Lesen & Schreiben“ bei Fahrzeugen.
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, notFound } from '../authz.js';
import { LEVEL, recordLevel } from '../org.js';
import { audit } from '../audit.js';
import { uuid } from '../records.js';
import { receiveUpload, sendUpload, removeUpload } from '../uploads.js';

const MAX_IMAGES = 50;
const caption = z.string().trim().max(200);

export default async function routes(app) {
  async function loadVehicle(req, vehicleId, need) {
    const vehicle = await one('SELECT id, plate, owner_user_id, team_id FROM vehicles WHERE id=$1', [uuid.parse(vehicleId)]);
    if (!vehicle) throw notFound('Fahrzeug nicht gefunden');
    await recordLevel(req.user.id, vehicle, 'vehicle', { need });
    return vehicle;
  }
  async function loadImage(req, need) {
    const image = await one('SELECT * FROM vehicle_images WHERE id=$1', [uuid.parse(req.params.id)]);
    if (!image) throw notFound('Bild nicht gefunden');
    await loadVehicle(req, image.vehicle_id, need);
    return image;
  }

  app.get('/vehicles/:id/images', authz('vehicle:read'), async (req) => {
    const vehicle = await loadVehicle(req, req.params.id, LEVEL.READ);
    return many(
      `SELECT i.id, i.original_name, i.mime, i.size, i.caption, i.created_at, u.name uploaded_by_name
       FROM vehicle_images i LEFT JOIN users u ON u.id=i.uploaded_by WHERE i.vehicle_id=$1 ORDER BY i.created_at, i.id`,
      [vehicle.id],
    );
  });

  app.post('/vehicles/:id/images', authz('vehicle:update'), async (req) => {
    const vehicle = await loadVehicle(req, req.params.id, LEVEL.WRITE);
    if ((await one('SELECT count(*)::int n FROM vehicle_images WHERE vehicle_id=$1', [vehicle.id])).n >= MAX_IMAGES) {
      throw bad(`Höchstens ${MAX_IMAGES} Bilder je Fahrzeug`);
    }
    const upload = await receiveUpload(req, { images: true });
    const row = await one(
      'INSERT INTO vehicle_images(vehicle_id, storage_key, original_name, mime, size, sha256, caption, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [vehicle.id, upload.key, upload.name, upload.mime, upload.size, upload.sha256, upload.caption, req.user.id],
    );
    await audit(req, 'vehicles.image_added', 'vehicles', vehicle.id, { image: row.id, name: upload.name });
    return row;
  });

  app.get('/vehicle-images/:id', authz('vehicle:read'), async (req, reply) => sendUpload(reply, await loadImage(req, LEVEL.READ)));

  app.patch('/vehicle-images/:id', authz('vehicle:update'), async (req) => {
    const image = await loadImage(req, LEVEL.WRITE);
    const b = z.object({ caption }).parse(req.body);
    await q('UPDATE vehicle_images SET caption=$2 WHERE id=$1', [image.id, b.caption]);
    return { ok: true };
  });

  app.delete('/vehicle-images/:id', authz('vehicle:update'), async (req) => {
    const image = await loadImage(req, LEVEL.WRITE);
    await q('DELETE FROM vehicle_images WHERE id=$1', [image.id]);
    removeUpload(image.storage_key);
    await audit(req, 'vehicles.image_deleted', 'vehicles', image.vehicle_id, { image: image.id, name: image.original_name });
    return { ok: true };
  });
}
