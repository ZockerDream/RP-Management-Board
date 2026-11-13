// Musik vom Server: ein einziger Player für die ganze App. Er hängt an keinem Seitenelement, damit die Wiedergabe beim
// Seitenwechsel weiterläuft. Das <audio>-Element kann keinen Authorization-Header senden; deshalb holt der Player einen
// kurzlebigen Schlüssel (POST /music/local/token, 6 Stunden) und hängt ihn an die Adresse.
import { api } from './api.js';

const audio = new Audio();
audio.preload = 'metadata';
const listeners = new Set();
const s = { queue: [], index: -1, shuffle: false, repeat: false, error: '' };
let key = null;
let keyUntil = 0;

const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* Seite schon weg */ } });
['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'ended', 'error'].forEach((ev) => audio.addEventListener(ev, () => {
  if (ev === 'ended') { next(true); return; }
  if (ev === 'error' && s.index >= 0) s.error = 'Titel lässt sich nicht abspielen (Format oder Datei fehlt).';
  emit();
}));

// Titel aus dem Musikordner haben path, hochgeladene id
export const trackKey = (t) => (t ? (t.id ? `u:${t.id}` : `s:${t.path}`) : '');

async function streamUrl(track) {
  if (!key || Date.now() > keyUntil) {
    key = (await api.post('/music/local/token')).token;
    keyUntil = Date.now() + 5 * 3600_000;
  }
  return `/api/music/local/stream?${new URLSearchParams(track.id ? { id: track.id, t: key } : { path: track.path, t: key })}`;
}

async function load(index) {
  if (index < 0 || index >= s.queue.length) return;
  s.index = index;
  s.error = '';
  audio.src = await streamUrl(s.queue[index]);
  try {
    await audio.play();
  } catch (e) {
    if (e?.name !== 'AbortError') s.error = 'Wiedergabe blockiert – bitte noch einmal auf Abspielen tippen.';
  }
  emit();
}

function next(auto = false) {
  if (!s.queue.length) return;
  if (s.shuffle && s.queue.length > 1) {
    let i;
    do i = Math.floor(Math.random() * s.queue.length); while (i === s.index);
    load(i);
    return;
  }
  if (s.index + 1 < s.queue.length) load(s.index + 1);
  else if (s.repeat || !auto) load(0);
  else emit();
}

export const player = {
  get current() { return s.index >= 0 ? s.queue[s.index] : null; },
  get queue() { return s.queue; },
  get index() { return s.index; },
  get playing() { return !audio.paused && !audio.ended; },
  get time() { return audio.currentTime || 0; },
  get duration() { return Number.isFinite(audio.duration) ? audio.duration : 0; },
  get volume() { return audio.volume; },
  get shuffle() { return s.shuffle; },
  get repeat() { return s.repeat; },
  get error() { return s.error; },
  play(queue, index = 0) { s.queue = queue.slice(); return load(index); },
  async toggle() {
    if (s.index < 0) return;
    if (audio.paused) {
      try { await audio.play(); } catch { await load(s.index); }
    } else audio.pause();
  },
  next: () => next(false),
  prev() {
    if (audio.currentTime > 3 || s.index <= 0) { audio.currentTime = 0; return; }
    load(s.index - 1);
  },
  seek(sec) { if (Number.isFinite(sec)) audio.currentTime = sec; },
  setVolume(v) { audio.volume = Math.min(1, Math.max(0, v)); },
  setShuffle(on) { s.shuffle = Boolean(on); emit(); },
  setRepeat(on) { s.repeat = Boolean(on); emit(); },
  // Gelöschten Titel aus der Warteschlange nehmen; läuft er gerade, stoppt die Wiedergabe
  remove(key) {
    const i = s.queue.findIndex((t) => trackKey(t) === key);
    if (i < 0) return;
    if (i === s.index) { this.stop(); return; }
    s.queue.splice(i, 1);
    if (i < s.index) s.index -= 1;
    emit();
  },
  stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    s.queue = [];
    s.index = -1;
    key = null;
    emit();
  },
  // Gibt eine Abmeldefunktion zurück; Seiten melden sich ab, sobald ihr Element verschwindet
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

export const clock = (sec) => {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
