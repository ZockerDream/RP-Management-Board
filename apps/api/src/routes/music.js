// Musik (Wünsche des Auftraggebers vom 2026-11-13): Spotify über die offizielle Web-API – jeder meldet sich selbst mit
// seinem Konto an (PKCE, kein Client-Secret; App des Servers oder eine eigene je Benutzer), Steuern braucht Premium –
// und Musik vom Server: Ordner MUSIC_DIR (nur lesend) plus hochgeladene Dateien (music_files, Upload-Volume).
// Spotify-Tokens verlassen den Server nie; der Browser spricht nur mit /api/music/….
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad, forbidden, notFound, HttpError, loadAccess, can } from '../authz.js';
import { config } from '../config.js';
import { encrypt, decrypt, randomToken, sha256, signMusic, verifyJwt } from '../security.js';
import { getSetting } from '../settings.js';
import { audit } from '../audit.js';
import { scanLibrary, resolveTrack, audioType, parseRange, sniffAudio, trackTitle, spotifyRedirect, redirectProblem, parseSpotifyLink, SPOTIFY_KINDS } from '../music.js';

const SPOTIFY_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const callbackUrl = () => spotifyRedirect(config.appUrl);
const clientIdSchema = z.string().trim().regex(/^[0-9a-zA-Z]{20,64}$/, 'Client-ID ungültig (32 Zeichen aus dem Spotify-Dashboard)');
const serverClientId = async () => (await getSetting('music.spotify_client_id')) || config.oauth.spotifyClientId || '';
async function clientFor(userId) {
  const u = await one('SELECT spotify_client_id FROM users WHERE id=$1', [userId]);
  return u?.spotify_client_id || (await serverClientId());
}
async function serverSecret() {
  const enc = await getSetting('music.spotify_client_secret');
  try { return enc ? decrypt(enc) : ''; } catch { return ''; }
}

// Suche ohne Anmeldung des Benutzers: Token der Server-App (Client Credentials), im Speicher bis kurz vor Ablauf
let appToken = null;
async function serverAppToken() {
  const [clientId, secret] = await Promise.all([serverClientId(), serverSecret()]);
  if (!clientId || !secret) throw new HttpError(409, 'Die Suche braucht die Spotify-App des Servers mit Client-Secret (Server-Management → Integrationen). Spotify-Links kannst du trotzdem einfügen.', 'search_unavailable');
  if (appToken && appToken.clientId === clientId && appToken.until > Date.now() + 30_000) return appToken.token;
  const response = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => { throw new HttpError(409, 'Spotify ist gerade nicht erreichbar', 'spotify_unreachable'); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(409, `Spotify lehnt die App des Servers ab (${data.error_description || data.error || response.status}). Client-ID und Secret prüfen.`, 'spotify_app');
  appToken = { clientId, token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return appToken.token;
}
export const forgetAppToken = () => { appToken = null; };

// Titel und Bild zu einem Spotify-Link über oEmbed (öffentlich, ohne Schlüssel)
async function oembed(kind, id) {
  try {
    const url = `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${kind}/${id}`)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return { title: String(d.title || '').slice(0, 200) };
  } catch {
    return null;
  }
}

const uploadDir = () => path.join(config.uploadDir, 'music');
const uploadFile = (key) => path.join(uploadDir(), path.basename(key));

// Spotify-Fehler in verständliche Meldungen übersetzen
function spotifyError(status, data) {
  const reason = data?.error?.reason || '';
  if (reason === 'NO_ACTIVE_DEVICE' || status === 404) return new HttpError(409, 'Kein aktives Spotify-Gerät. Öffne Spotify auf einem Gerät oder wähle unten ein Gerät aus.', 'no_device');
  if (reason === 'PREMIUM_REQUIRED' || status === 403) return new HttpError(403, 'Spotify erlaubt das Steuern nur mit Spotify Premium (oder dein Konto ist für die Spotify-App nicht freigeschaltet).', 'premium_required');
  if (status === 401) return new HttpError(409, 'Die Verbindung zu Spotify ist abgelaufen. Bitte neu verbinden.', 'spotify_reconnect');
  if (status === 429) return new HttpError(429, 'Spotify bremst gerade, bitte kurz warten.', 'rate_limited');
  return new HttpError(502, `Spotify antwortet nicht wie erwartet (${status})`, 'spotify');
}

async function tokenRequest(params) {
  const response = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw bad(data.error_description || 'Spotify hat die Anmeldung abgelehnt');
  return data;
}

async function accessToken(userId) {
  const c = await one("SELECT * FROM provider_connections WHERE user_id=$1 AND provider='spotify'", [userId]);
  if (!c) throw new HttpError(409, 'Spotify ist nicht verbunden', 'spotify_not_connected');
  if (new Date(c.expires_at).getTime() > Date.now() + 60_000) return decrypt(c.access_token_enc);
  const refresh = decrypt(c.refresh_token_enc);
  const clientId = c.client_id || (await clientFor(userId));
  let data;
  try {
    data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId });
  } catch {
    throw new HttpError(409, 'Die Verbindung zu Spotify ist abgelaufen. Bitte neu verbinden.', 'spotify_reconnect');
  }
  await q(`UPDATE provider_connections SET access_token_enc=$2, refresh_token_enc=$3, expires_at=now()+($4||' seconds')::interval
    WHERE user_id=$1 AND provider='spotify'`, [userId, encrypt(data.access_token), encrypt(data.refresh_token || refresh), Math.max(60, Number(data.expires_in) || 3600)]);
  return data.access_token;
}

async function spotify(userId, method, apiPath, { query, body } = {}) {
  const token = await accessToken(userId);
  const url = new URL(`${API}${apiPath}`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw spotifyError(response.status, data);
  return data;
}

const image = (images) => (Array.isArray(images) && images.length ? (images.find((i) => i.width && i.width <= 320) || images[0]).url : null);
const track = (t) => (t ? {
  uri: t.uri, name: t.name, artists: (t.artists || []).map((a) => a.name).join(', ') || t.show?.name || '',
  album: t.album?.name || '', image: image(t.album?.images || t.images), duration_ms: t.duration_ms || 0,
} : null);

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play'), uri: z.string().regex(/^spotify:[a-z]+:[A-Za-z0-9]+$/).optional(), context_uri: z.string().regex(/^spotify:[a-z]+(:[A-Za-z0-9]+)+$/).optional(), device_id: z.string().max(100).optional() }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('next') }),
  z.object({ action: z.literal('previous') }),
  z.object({ action: z.literal('volume'), volume: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal('shuffle'), state: z.boolean() }),
  z.object({ action: z.literal('repeat'), state: z.enum(['off', 'context', 'track']) }),
  z.object({ action: z.literal('seek'), position_ms: z.number().int().min(0).max(24 * 3600_000) }),
  z.object({ action: z.literal('transfer'), device_id: z.string().min(1).max(100) }),
]);

export default async function routes(app) {
  const read = authz('music:read');

  // ---------- Spotify: jeder meldet sich selbst an. App des Servers (Client-ID unter Server-Management → Integrationen)
  // oder eine eigene Spotify-App des Benutzers; Anmeldung per PKCE, ein Client-Secret braucht es nicht.
  app.get('/music/spotify', read, async (req) => {
    const [c, me, serverId] = await Promise.all([
      one("SELECT email FROM provider_connections WHERE user_id=$1 AND provider='spotify'", [req.user.id]),
      one('SELECT spotify_client_id FROM users WHERE id=$1', [req.user.id]),
      serverClientId(),
    ]);
    const redirect = callbackUrl();
    const secret = serverId ? await serverSecret() : '';
    return {
      search: Boolean(serverId && secret),
      configured: Boolean(me?.spotify_client_id || serverId), server_app: Boolean(serverId), own_app: me?.spotify_client_id || null,
      connected: Boolean(c), account: c?.email || null, redirect_uri: redirect, redirect_problem: redirectProblem(redirect),
    };
  });

  // Eigene Spotify-App (Client-ID) oder null für die App des Servers
  app.put('/music/spotify/app', read, async (req) => {
    const { client_id: clientId } = z.object({ client_id: clientIdSchema.nullable() }).parse(req.body);
    await q('UPDATE users SET spotify_client_id=$2 WHERE id=$1', [req.user.id, clientId]);
    await audit(req, 'music.spotify_app_changed', 'user', req.user.id, { own: Boolean(clientId) });
    return { ok: true };
  });

  app.get('/music/spotify/connect', read, async (req) => {
    const clientId = await clientFor(req.user.id);
    if (!clientId) throw bad('Für Spotify fehlt eine Spotify-App: Ein Admin trägt sie unter Server-Management → Integrationen ein, oder du hinterlegst deine eigene.');
    const redirect = callbackUrl();
    const problem = redirectProblem(redirect);
    if (problem) throw bad(problem);
    const state = randomToken(32);
    const verifier = randomToken(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await q('DELETE FROM oauth_states WHERE expires_at<=now()');
    await q("INSERT INTO oauth_states(state_hash,user_id,provider,expires_at,code_verifier,client_id) VALUES ($1,$2,'spotify',now()+interval '10 minutes',$3,$4)",
      [sha256(state), req.user.id, encrypt(verifier), clientId]);
    const params = {
      client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: SPOTIFY_SCOPES, state, show_dialog: 'true',
      code_challenge_method: 'S256', code_challenge: challenge,
    };
    return { url: `${ACCOUNTS}/authorize?${new URLSearchParams(params)}` };
  });

  // Rückkehr von Spotify: ohne Anmeldung (Browser-Weiterleitung), abgesichert über den einmaligen state und PKCE
  app.get('/music/spotify/callback', async (req, reply) => {
    const query = z.object({ state: z.string().min(20).max(200), code: z.string().min(1).max(2000).optional(), error: z.string().max(200).optional() }).parse(req.query);
    const state = await one("DELETE FROM oauth_states WHERE state_hash=$1 AND provider='spotify' AND expires_at>now() RETURNING user_id, code_verifier, client_id", [sha256(query.state)]);
    if (!state || !state.code_verifier || !state.client_id) throw bad('Anmeldestatus ist ungültig oder abgelaufen, bitte erneut verbinden');
    if (query.error || !query.code) return reply.redirect(`${config.appUrl}/#/music?spotify=denied`);
    const token = await tokenRequest({
      grant_type: 'authorization_code', code: query.code, redirect_uri: callbackUrl(), client_id: state.client_id, code_verifier: decrypt(state.code_verifier),
    });
    if (!token.refresh_token) throw bad('Spotify hat kein Refresh-Token geliefert, bitte erneut verbinden');
    const me = await fetch(`${API}/me`, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const account = String(me.display_name || me.id || 'Spotify').slice(0, 200);
    await q(
      `INSERT INTO provider_connections(user_id,provider,email,access_token_enc,refresh_token_enc,expires_at,client_id)
       VALUES ($1,'spotify',$2,$3,$4,now()+($5||' seconds')::interval,$6)
       ON CONFLICT(user_id,provider) DO UPDATE SET email=$2,access_token_enc=$3,refresh_token_enc=$4,expires_at=now()+($5||' seconds')::interval,client_id=$6`,
      [state.user_id, account, encrypt(token.access_token), encrypt(token.refresh_token), Math.max(60, Number(token.expires_in) || 3600), state.client_id],
    );
    await audit({ user: { id: state.user_id }, ip: req.ip, log: req.log }, 'music.spotify_connected', 'user', state.user_id, {});
    return reply.redirect(`${config.appUrl}/#/music?spotify=connected`);
  });

  app.delete('/music/spotify', read, async (req) => {
    const row = await one("DELETE FROM provider_connections WHERE user_id=$1 AND provider='spotify' RETURNING user_id", [req.user.id]);
    if (row) await audit(req, 'music.spotify_disconnected', 'user', req.user.id, {});
    return { ok: true };
  });

  // Aktueller Stand: null, wenn gerade nichts läuft
  app.get('/music/spotify/player', read, async (req) => {
    const p = await spotify(req.user.id, 'GET', '/me/player', { query: { additional_types: 'episode' } });
    if (!p) return null;
    return {
      playing: Boolean(p.is_playing), progress_ms: p.progress_ms || 0, shuffle: Boolean(p.shuffle_state), repeat: p.repeat_state || 'off',
      device: p.device ? { id: p.device.id, name: p.device.name, type: p.device.type, volume: p.device.volume_percent } : null,
      item: track(p.item), context_uri: p.context?.uri || null,
    };
  });

  app.get('/music/spotify/devices', read, async (req) => {
    const d = await spotify(req.user.id, 'GET', '/me/player/devices');
    return (d?.devices || []).map((x) => ({ id: x.id, name: x.name, type: x.type, active: x.is_active, volume: x.volume_percent }));
  });

  app.put('/music/spotify/player', read, async (req) => {
    const b = actionSchema.parse(req.body);
    const id = req.user.id;
    switch (b.action) {
      case 'play': {
        const body = b.context_uri ? { context_uri: b.context_uri } : b.uri ? { uris: [b.uri] } : undefined;
        await spotify(id, 'PUT', '/me/player/play', { query: { device_id: b.device_id }, body });
        break;
      }
      case 'pause': await spotify(id, 'PUT', '/me/player/pause'); break;
      case 'next': await spotify(id, 'POST', '/me/player/next'); break;
      case 'previous': await spotify(id, 'POST', '/me/player/previous'); break;
      case 'volume': await spotify(id, 'PUT', '/me/player/volume', { query: { volume_percent: b.volume } }); break;
      case 'shuffle': await spotify(id, 'PUT', '/me/player/shuffle', { query: { state: b.state } }); break;
      case 'repeat': await spotify(id, 'PUT', '/me/player/repeat', { query: { state: b.state } }); break;
      case 'seek': await spotify(id, 'PUT', '/me/player/seek', { query: { position_ms: b.position_ms } }); break;
      case 'transfer': await spotify(id, 'PUT', '/me/player', { body: { device_ids: [b.device_id], play: true } }); break;
      default: throw bad('Unbekannte Aktion');
    }
    return { ok: true };
  });

  app.get('/music/spotify/playlists', read, async (req) => {
    const d = await spotify(req.user.id, 'GET', '/me/playlists', { query: { limit: 50 } });
    return (d?.items || []).filter(Boolean).map((p) => ({ uri: p.uri, name: p.name, owner: p.owner?.display_name || '', tracks: p.tracks?.total ?? null, image: image(p.images) }));
  });

  app.get('/music/spotify/search', read, async (req) => {
    const { q: term } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
    const d = await spotify(req.user.id, 'GET', '/search', { query: { q: term, type: 'track,playlist,album', limit: 10 } });
    return {
      tracks: (d?.tracks?.items || []).filter(Boolean).map(track),
      albums: (d?.albums?.items || []).filter(Boolean).map((a) => ({ uri: a.uri, name: a.name, artists: (a.artists || []).map((x) => x.name).join(', '), image: image(a.images) })),
      playlists: (d?.playlists?.items || []).filter(Boolean).map((p) => ({ uri: p.uri, name: p.name, owner: p.owner?.display_name || '', image: image(p.images) })),
    };
  });

  // ---------- Eingebetteter Player: Suche über die App des Servers, ohne Anmeldung des Benutzers
  app.get('/music/spotify/catalog', read, async (req) => {
    const { q: term } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
    const token = await serverAppToken();
    const url = new URL(`${API}/search`);
    url.search = new URLSearchParams({ q: term, type: 'playlist,album,track', limit: '12', market: 'DE' }).toString();
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
      .catch(() => { throw new HttpError(409, 'Spotify ist gerade nicht erreichbar', 'spotify_unreachable'); });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { forgetAppToken(); throw new HttpError(409, 'Spotify-Suche gerade nicht möglich, bitte erneut versuchen', 'spotify'); }
    if (!r.ok) throw spotifyError(r.status, d);
    const pick = (x) => ({ kind: x.type, id: x.id, name: x.name, image: image(x.images || x.album?.images), by: x.owner?.display_name || (x.artists || []).map((a) => a.name).join(', ') });
    return {
      playlists: (d.playlists?.items || []).filter(Boolean).map(pick),
      albums: (d.albums?.items || []).filter(Boolean).map(pick),
      tracks: (d.tracks?.items || []).filter(Boolean).map(pick),
    };
  });

  // ---------- Empfehlungen: kleines Dashboard eingebetteter Playlists, gepflegt mit music:update
  app.get('/music/recommendations', read, async () => many(
    `SELECT r.id, r.kind, r.spotify_id, r.title, r.note, r.size, r.sort, u.name created_by_name FROM music_recommendations r
     LEFT JOIN users u ON u.id=r.created_by ORDER BY r.sort, r.created_at`,
  ));
  const recFields = z.object({ title: z.string().trim().max(200).optional(), note: z.string().trim().max(500).optional(), size: z.enum(['compact', 'large']).optional() });
  app.post('/music/recommendations', authz('music:update'), async (req) => {
    const b = recFields.extend({ url: z.string().trim().min(1).max(500) }).parse(req.body);
    const link = parseSpotifyLink(b.url);
    if (!link) throw bad('Kein Spotify-Link. Kopiere in Spotify „Teilen → Link kopieren“ (open.spotify.com/…).');
    const title = b.title || (await oembed(link.kind, link.id))?.title || `Spotify-${link.kind}`;
    try {
      const row = await one(
        `INSERT INTO music_recommendations(kind, spotify_id, title, note, size, sort, created_by)
         VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(max(sort), 0) + 1 FROM music_recommendations),$6) RETURNING id, kind, spotify_id, title`,
        [link.kind, link.id, title, b.note || '', b.size || 'compact', req.user.id],
      );
      await audit(req, 'music.recommendation_added', 'music_recommendation', row.id, { title });
      return row;
    } catch (e) {
      if (e.code === '23505') throw bad('Diese Empfehlung gibt es schon');
      throw e;
    }
  });
  const recId = (req) => z.string().uuid().parse(req.params.id);
  app.patch('/music/recommendations/:id', authz('music:update'), async (req) => {
    const b = recFields.parse(req.body);
    const row = await one(`UPDATE music_recommendations SET title=COALESCE(NULLIF($2,''), title), note=COALESCE($3, note), size=COALESCE($4, size)
      WHERE id=$1 RETURNING id`, [recId(req), b.title ?? null, b.note ?? null, b.size ?? null]);
    if (!row) throw notFound('Empfehlung nicht gefunden');
    await audit(req, 'music.recommendation_updated', 'music_recommendation', row.id, {});
    return { ok: true };
  });
  app.post('/music/recommendations/:id/move', authz('music:update'), async (req) => {
    const { dir } = z.object({ dir: z.enum(['up', 'down']) }).parse(req.body);
    const list = await many('SELECT id FROM music_recommendations ORDER BY sort, created_at');
    const i = list.findIndex((r) => r.id === recId(req));
    if (i < 0) throw notFound('Empfehlung nicht gefunden');
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
    await q('UPDATE music_recommendations r SET sort=x.n FROM unnest($1::uuid[]) WITH ORDINALITY x(id, n) WHERE r.id=x.id', [list.map((r) => r.id)]);
    return { ok: true };
  });
  app.delete('/music/recommendations/:id', authz('music:update'), async (req) => {
    const row = await one('DELETE FROM music_recommendations WHERE id=$1 RETURNING id, title', [recId(req)]);
    if (!row) throw notFound('Empfehlung nicht gefunden');
    await audit(req, 'music.recommendation_deleted', 'music_recommendation', row.id, { title: row.title });
    return { ok: true };
  });

  // ---------- Musik vom Server: Ordner MUSIC_DIR (nur lesend) und hochgeladene Dateien
  app.get('/music/local', read, async (req) => {
    const [lib, files] = await Promise.all([
      scanLibrary(config.musicDir),
      many(`SELECT f.id, f.folder, f.title, f.size, f.uploaded_by, u.name uploaded_by_name, f.created_at FROM music_files f
        LEFT JOIN users u ON u.id=f.uploaded_by ORDER BY lower(f.folder), lower(f.title)`),
    ]);
    const mayDelete = can(req, 'music:delete');
    const uploads = files.map((f) => ({
      src: 'upload', id: f.id, folder: f.folder, title: f.title, size: Number(f.size), uploaded_by_name: f.uploaded_by_name, created_at: f.created_at,
      can_edit: mayDelete || f.uploaded_by === req.user.id,
    }));
    return {
      configured: lib.configured, truncated: lib.truncated, can_upload: can(req, 'music:create'), max_upload_mb: Math.round(config.musicUploadBytes / 1048576),
      tracks: [...lib.tracks.map((t) => ({ src: 'server', ...t })), ...uploads],
    };
  });

  // Hochladen: eine Datei je Anfrage; Feld „folder“ vor der Datei (FormData), Inhalt muss Audio sein
  app.post('/music/files', authz('music:create'), async (req) => {
    const part = await req.file({ limits: { fileSize: config.musicUploadBytes, files: 1 } });
    if (!part) throw bad('Datei fehlt');
    const field = (name) => (typeof part.fields?.[name]?.value === 'string' ? part.fields[name].value.trim() : '');
    const folder = (field('folder') || 'Hochgeladen').replace(/\s+/g, ' ').slice(0, 100);
    fs.mkdirSync(uploadDir(), { recursive: true, mode: 0o700 });
    const key = crypto.randomUUID();
    const dest = uploadFile(key);
    let size = 0;
    let head = Buffer.alloc(0);
    part.file.on('data', (c) => {
      size += c.length;
      if (head.length < 16) head = Buffer.concat([head, c]).subarray(0, 16);
    });
    let mime;
    try {
      await pipeline(part.file, fs.createWriteStream(dest, { mode: 0o600 }));
      if (part.file.truncated) throw bad(`Datei größer als ${Math.round(config.musicUploadBytes / 1048576)} MB`);
      mime = sniffAudio(head);
      if (!mime || !size) throw bad('Keine Audiodatei (erlaubt: mp3, m4a, aac, ogg, opus, flac, wav, webm)');
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw e;
    }
    const original = path.basename(part.filename || 'titel').slice(0, 200);
    const title = (field('title') || trackTitle(original)).slice(0, 200) || 'Titel';
    const row = await one(
      `INSERT INTO music_files(storage_key, folder, title, original_name, mime, size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, folder, title`,
      [key, folder, title, original, mime, size, req.user.id],
    );
    await audit(req, 'music.file_uploaded', 'music_file', row.id, { title, folder, size });
    return row;
  });

  async function ownFile(req) {
    const f = await one('SELECT * FROM music_files WHERE id=$1', [z.string().uuid().parse(req.params.id)]);
    if (!f) throw notFound('Titel nicht gefunden');
    if (f.uploaded_by !== req.user.id && !can(req, 'music:delete')) throw forbidden('Nur wer den Titel hochgeladen hat (oder mit dem Recht „Musik löschen“) darf ihn ändern');
    return f;
  }
  app.patch('/music/files/:id', read, async (req) => {
    const f = await ownFile(req);
    const b = z.object({ title: z.string().trim().min(1).max(200).optional(), folder: z.string().trim().min(1).max(100).optional() }).parse(req.body);
    await q('UPDATE music_files SET title=$2, folder=$3 WHERE id=$1', [f.id, b.title ?? f.title, b.folder ?? f.folder]);
    await audit(req, 'music.file_updated', 'music_file', f.id, { title: b.title ?? f.title, folder: b.folder ?? f.folder });
    return { ok: true };
  });
  app.delete('/music/files/:id', read, async (req) => {
    const f = await ownFile(req);
    await q('DELETE FROM music_files WHERE id=$1', [f.id]);
    fs.rmSync(uploadFile(f.storage_key), { force: true });
    await audit(req, 'music.file_deleted', 'music_file', f.id, { title: f.title });
    return { ok: true };
  });

  // Schlüssel für das <audio>-Element (kann keinen Authorization-Header senden), 6 Stunden gültig
  app.post('/music/local/token', read, async (req) => ({ token: signMusic(req.user.id) }));

  // Abspielen: path = Datei im Musikordner, id = hochgeladene Datei
  app.get('/music/local/stream', async (req, reply) => {
    const query = z.object({ path: z.string().min(1).max(1000).optional(), id: z.string().uuid().optional(), t: z.string().min(20).max(2000) })
      .refine((x) => Boolean(x.path) !== Boolean(x.id), 'path oder id').parse(req.query);
    let payload;
    try {
      payload = verifyJwt(query.t, 'music');
    } catch {
      throw new HttpError(401, 'Wiedergabe-Schlüssel abgelaufen', 'unauthenticated');
    }
    const user = await one("SELECT id FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL", [payload.sub]);
    if (!user || !(await loadAccess(user.id)).perms.has('music:read')) throw new HttpError(403, 'Keine Berechtigung', 'forbidden');
    let real;
    let type;
    let stat;
    try {
      if (query.id) {
        const f = await one('SELECT storage_key, mime FROM music_files WHERE id=$1', [query.id]);
        if (!f) throw new Error('unbekannt');
        real = uploadFile(f.storage_key);
        type = f.mime;
      } else {
        const file = resolveTrack(config.musicDir, query.path);
        if (!file) throw new Error('ungültig');
        real = await fs.promises.realpath(file);
        const base = await fs.promises.realpath(config.musicDir);
        if (!real.startsWith(base + '/')) throw new Error('außerhalb');
        type = audioType(real);
      }
      stat = await fs.promises.stat(real);
      if (!stat.isFile()) throw new Error('keine Datei');
    } catch {
      throw notFound('Titel nicht gefunden');
    }
    const range = parseRange(req.headers.range, stat.size);
    reply.header('accept-ranges', 'bytes').header('content-type', type).header('x-content-type-options', 'nosniff');
    if (range === false) return reply.status(416).header('content-range', `bytes */${stat.size}`).send();
    if (range) {
      reply.status(206).header('content-range', `bytes ${range.start}-${range.end}/${stat.size}`).header('content-length', range.end - range.start + 1);
      return reply.send(fs.createReadStream(real, { start: range.start, end: range.end }));
    }
    reply.header('content-length', stat.size);
    return reply.send(fs.createReadStream(real));
  });
}
