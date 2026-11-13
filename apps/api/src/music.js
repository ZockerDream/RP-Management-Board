// Musik vom Server: Regeln ohne Datenbank (Unit-Test test/music.test.js). Die Dateien liegen im Verzeichnis MUSIC_DIR
// (im Container /data/music, nur lesend eingebunden); die Bibliothek ist die Ordnerstruktur, Titel kommen aus dem Dateinamen.
import fs from 'node:fs';
import path from 'node:path';

export const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.flac': 'audio/flac', '.wav': 'audio/wav', '.webm': 'audio/webm',
};
export const MAX_TRACKS = 5000;
const MAX_DEPTH = 8;

// Inhalt der ersten Bytes → MIME-Typ, sonst null. Hochgeladene Dateien müssen wirklich Audio sein.
export function sniffAudio(head) {
  const b = Buffer.from(head || []);
  const at = (i, s) => b.length >= i + s.length && b.subarray(i, i + s.length).toString('latin1') === s;
  if (at(0, 'ID3')) return 'audio/mpeg';
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(0, 'fLaC')) return 'audio/flac';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(4, 'ftyp')) return 'audio/mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  // Frame-Sync: MPEG-Audio (Layer gesetzt) oder AAC/ADTS (Layer 00)
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg';
  return null;
}

export const audioType = (file) => AUDIO_TYPES[path.extname(file).toLowerCase()] || null;

// „01 - Künstler_Titel.mp3“ → „01 - Künstler Titel“
export const trackTitle = (file) => path.basename(file, path.extname(file)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || path.basename(file);

// Relativer Pfad aus der Anfrage → absoluter Pfad innerhalb von root, sonst null (kein „..“, kein absoluter Pfad,
// keine versteckten Dateien, nur bekannte Audioformate)
export function resolveTrack(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 1000 || rel.includes('\0') || rel.includes('\\')) return null;
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))) return null;
  if (!audioType(rel)) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, ...parts);
  return full.startsWith(base + path.sep) ? full : null;
}

// Alle Audiodateien unter root, sortiert nach Ordner und Name. Symlinks zählen nur, wenn ihr Ziel in root liegt.
export async function scanLibrary(root) {
  let base;
  try {
    base = await fs.promises.realpath(root);
  } catch {
    return { configured: false, tracks: [], truncated: false };
  }
  const tracks = [];
  let truncated = false;
  async function walk(dir, rel, depth) {
    if (depth > MAX_DEPTH || truncated) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      let stat;
      try {
        const real = await fs.promises.realpath(full);
        if (real !== base && !real.startsWith(base + path.sep)) continue;
        stat = await fs.promises.stat(real);
      } catch {
        continue;
      }
      if (stat.isDirectory()) await walk(full, relPath, depth + 1);
      else if (stat.isFile() && audioType(e.name)) {
        if (tracks.length >= MAX_TRACKS) { truncated = true; return; }
        tracks.push({ path: relPath, title: trackTitle(e.name), folder: rel, size: stat.size });
      }
    }
  }
  await walk(base, '', 0);
  return { configured: true, tracks, truncated };
}

// Redirect-URI für Spotify: Spotify nimmt nur HTTPS oder eine Loopback-IP, „localhost“ als Name nicht mehr.
export function spotifyRedirect(appUrl) {
  const u = new URL(appUrl);
  if (u.hostname === 'localhost') u.hostname = '127.0.0.1';
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}/api/music/spotify/callback`;
}
export const redirectProblem = (uri) => (/^https:\/\//.test(uri) || /^http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?\//.test(uri)
  ? null
  : 'Spotify erlaubt die Anmeldung nur über HTTPS (oder http://127.0.0.1 auf demselben Rechner). APP_URL muss dafür mit https:// beginnen.');

// Spotify-Link oder -URI → { kind, id } für den eingebetteten Player, sonst null.
// open.spotify.com/(intl-de/)playlist/ID?si=…, spotify:album:ID, open.spotify.com/embed/track/ID
export const SPOTIFY_KINDS = ['playlist', 'album', 'track', 'artist', 'episode', 'show'];
export function parseSpotifyLink(input) {
  const s = String(input || '').trim();
  let m = /^spotify:(playlist|album|track|artist|episode|show):([0-9A-Za-z]{10,40})$/.exec(s);
  if (m) return { kind: m[1], id: m[2] };
  m = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(playlist|album|track|artist|episode|show)\/([0-9A-Za-z]{10,40})(?:[/?#].*)?$/i.exec(s);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}
export const spotifyEmbedUrl = ({ kind, id }) => `https://open.spotify.com/embed/${kind}/${id}`;

// Range-Header „bytes=a-b“ → { start, end } (inklusive) oder null für „ganze Datei“; false, wenn nicht erfüllbar
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (!suffix) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return false;
  return { start, end };
}
