// Musik (Wunsch des Auftraggebers vom 2026-11-13): Spotify steuern (eigenes Konto, Premium) und Musik vom Server hören.
// Der Player für Server-Musik steckt in music-player.js und läuft beim Seitenwechsel weiter.
import { api } from '../api.js';
import { $, $$, esc, empty, toast, debounce, confirmBox, openForm } from '../ui.js';
import { can } from '../app.js';
import { player, clock, trackKey } from '../music-player.js';

const P = {
  play: 'M7 4l13 8-13 8z', pause: 'M7 4h3v16H7zM14 4h3v16h-3z', next: 'M5 4l10 8-10 8zM18 4v16', prev: 'M19 4L9 12l10 8zM6 4v16',
  shuffle: 'M3 6h4l10 12h4M17 3l4 3-4 3M3 18h4l3-3.6M13.5 9.6L17 6h4M17 15l4 3-4 3', repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  note: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z',
};
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const cover = (url, alt = '') => (url ? `<img class="music-cover" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="music-cover">${svg(P.note)}</span>`);
const btn = (action, label, d, extra = '') => `<button type="button" class="icon-btn ${extra}" data-m="${action}" aria-label="${label}" title="${label}">${svg(d)}</button>`;

/* ---------- Bausteine, auch für das Dashboard ---------- */
function localNow(compact) {
  const t = player.current;
  if (!t) return '';
  return `<div class="music-now">${cover(null)}<div class="music-meta"><b>${esc(t.title)}</b><small class="muted">${esc(t.folder || 'Musik vom Server')}</small></div></div>
    ${player.error ? `<p class="auth-error" role="alert">${esc(player.error)}</p>` : ''}
    <div class="music-progress"><span>${clock(player.time)}</span><input type="range" data-m="local-seek" min="0" max="${Math.max(1, Math.floor(player.duration))}" value="${Math.floor(player.time)}" aria-label="Position"><span>${clock(player.duration)}</span></div>
    <div class="music-ctrl">${btn('local-prev', 'Zurück', P.prev)}${btn('local-toggle', player.playing ? 'Pause' : 'Abspielen', player.playing ? P.pause : P.play, 'play')}${btn('local-next', 'Weiter', P.next)}
      ${compact ? '' : `${btn('local-shuffle', 'Zufall', P.shuffle, player.shuffle ? 'on' : '')}${btn('local-repeat', 'Wiederholen', P.repeat, player.repeat ? 'on' : '')}
      <input type="range" data-m="local-volume" min="0" max="100" value="${Math.round(player.volume * 100)}" aria-label="Lautstärke">`}</div>`;
}

function spotifyNow(st, compact) {
  if (!st?.item) return empty('Gerade läuft nichts auf Spotify. Starte eine Playlist oder öffne Spotify auf einem Gerät.');
  const i = st.item;
  return `<div class="music-now">${cover(i.image, i.album)}<div class="music-meta"><b>${esc(i.name)}</b><small class="muted">${esc(i.artists)}${i.album ? ` · ${esc(i.album)}` : ''}</small>
      ${st.device ? `<small class="muted">auf ${esc(st.device.name)}</small>` : ''}</div></div>
    ${compact ? '' : `<div class="music-progress"><span>${clock(st.progress_ms / 1000)}</span><input type="range" data-m="sp-seek" min="0" max="${Math.max(1, Math.floor(i.duration_ms / 1000))}" value="${Math.floor(st.progress_ms / 1000)}" aria-label="Position"><span>${clock(i.duration_ms / 1000)}</span></div>`}
    <div class="music-ctrl">${btn('sp-previous', 'Zurück', P.prev)}${btn(st.playing ? 'sp-pause' : 'sp-play', st.playing ? 'Pause' : 'Abspielen', st.playing ? P.pause : P.play, 'play')}${btn('sp-next', 'Weiter', P.next)}
      ${compact ? '' : `${btn('sp-shuffle', 'Zufall', P.shuffle, st.shuffle ? 'on' : '')}${btn('sp-repeat', 'Wiederholen', P.repeat, st.repeat !== 'off' ? 'on' : '')}
      ${st.device && st.device.volume !== null && st.device.volume !== undefined ? `<input type="range" data-m="sp-volume" min="0" max="100" value="${st.device.volume}" aria-label="Lautstärke">` : ''}`}</div>`;
}

// Spotify-Aktion; wirft Fehler als Toast
async function spotifyAction(action, el, st) {
  const body = { action };
  if (action === 'shuffle') body.state = !st?.shuffle;
  if (action === 'repeat') body.state = st?.repeat === 'off' ? 'context' : 'off';
  if (action === 'volume') body.volume = Number(el.value);
  if (action === 'seek') body.position_ms = Number(el.value) * 1000;
  await api.put('/music/spotify/player', body);
}

function handleLocal(action, el) {
  if (action === 'local-toggle') player.toggle();
  else if (action === 'local-next') player.next();
  else if (action === 'local-prev') player.prev();
  else if (action === 'local-shuffle') player.setShuffle(!player.shuffle);
  else if (action === 'local-repeat') player.setRepeat(!player.repeat);
  else if (action === 'local-volume') player.setVolume(Number(el.value) / 100);
  else if (action === 'local-seek') player.seek(Number(el.value));
  else return false;
  return true;
}

// Kleiner Player für das Dashboard-Modul „Musik“: Server-Musik, wenn sie läuft, sonst Spotify
export function mountMiniPlayer(el) {
  let sp = null;
  let spotifyOn = false;
  let timer = null;
  const draw = () => {
    if (!el.isConnected) { stop(); return; }
    const local = player.current;
    el.innerHTML = `<div class="card-head"><h2>Musik</h2><a class="btn ghost sm" href="#/music">Öffnen</a></div>
      ${local ? localNow(true) : spotifyOn ? spotifyNow(sp, true) : empty('Nichts läuft gerade. Unter „Musik“ wählst du Titel vom Server oder verbindest Spotify.')}`;
  };
  const poll = async () => {
    if (!el.isConnected) { stop(); return; }
    if (document.hidden || player.current) return;
    try {
      sp = await api.get('/music/spotify/player');
      spotifyOn = true;
    } catch {
      spotifyOn = false;
    }
    draw();
  };
  const unsubscribe = player.subscribe(() => { if (!document.activeElement?.matches?.('input[type=range]')) draw(); });
  function stop() { unsubscribe(); clearInterval(timer); }
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || b.matches('input')) return;
    const a = b.dataset.m;
    if (handleLocal(a, b)) return;
    try {
      await spotifyAction(a.slice(3), b, sp);
      setTimeout(poll, 400);
    } catch (error) { toast(error.message, true); }
  });
  el.addEventListener('change', (e) => { if (e.target.dataset.m) handleLocal(e.target.dataset.m, e.target); });
  draw();
  api.get('/music/spotify').then((s) => {
    if (!s.connected) return;
    spotifyOn = true;
    poll();
    timer = setInterval(poll, 10000);
  }).catch(() => {});
}

/* ---------- Eingebetteter Spotify-Player ---------- */
// Gleiche Regeln wie parseSpotifyLink in apps/api/src/music.js (die API prüft Empfehlungen selbst)
export function parseSpotifyLink(input) {
  const s = String(input || '').trim();
  let m = /^spotify:(playlist|album|track|artist|episode|show):([0-9A-Za-z]{10,40})$/.exec(s);
  if (m) return { kind: m[1], id: m[2] };
  m = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(playlist|album|track|artist|episode|show)\/([0-9A-Za-z]{10,40})(?:[/?#].*)?$/i.exec(s);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}
const KIND_LABEL = { playlist: 'Playlist', album: 'Album', track: 'Titel', artist: 'Künstler', episode: 'Folge', show: 'Podcast' };
export const spotifyEmbed = (kind, id, large = false) => `<iframe class="sp-embed" src="https://open.spotify.com/embed/${encodeURIComponent(kind)}/${encodeURIComponent(id)}?utm_source=generator" height="${large ? 352 : 152}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="Spotify-Player"></iframe>`;

/* ---------- Seite ---------- */
export async function render(view, params = new URLSearchParams()) {
  const tabs = [['spotify', 'Spotify'], ['local', 'Vom Server']];
  const initial = params.get('tab') === 'local' ? 'local' : 'spotify';
  view.innerHTML = `<div class="page-head"><div><h1>Musik</h1><p>Spotify steuern und Musik vom Server hören</p></div></div>
    <div><div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === initial ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="tab-panel ${initial === 'spotify' ? 'on' : ''}" data-panel="spotify"><div id="m-recs"></div><div id="m-player"></div><div id="m-sp"></div></div>
    <div class="tab-panel ${initial === 'local' ? 'on' : ''}" data-panel="local"><div id="m-local"></div></div></div>`;

  if (params.get('spotify') === 'connected') toast('Spotify verbunden');
  if (params.get('spotify') === 'denied') toast('Spotify-Verbindung abgebrochen', true);

  /* ----- Empfehlungen (kleines Dashboard) ----- */
  let recs = [];
  const manage = can('music:update');
  const recForm = (rec) => openForm({
    title: rec ? 'Empfehlung bearbeiten' : 'Empfehlung hinzufügen',
    fields: [
      ...(rec ? [] : [{ name: 'url', label: 'Spotify-Link', required: true, maxlength: 500, full: true, placeholder: 'https://open.spotify.com/playlist/…', help: 'In Spotify: „…“ → Teilen → Link kopieren. Playlists, Alben, Titel, Künstler und Podcasts.' }]),
      { name: 'title', label: 'Titel', value: rec?.title || '', maxlength: 200, full: true, help: rec ? '' : 'Leer: Name von Spotify.' },
      { name: 'note', label: 'Notiz', value: rec?.note || '', maxlength: 500, full: true, placeholder: 'z. B. Für die Nachtschicht' },
      { name: 'size', label: 'Größe', type: 'select', options: [{ v: 'compact', l: 'Klein' }, { v: 'large', l: 'Groß (mit Titelliste)' }], value: rec?.size || 'compact' },
    ],
    onSubmit: async (v) => {
      const body = { title: v.title.trim(), note: v.note.trim(), size: v.size };
      if (rec) await api.patch(`/music/recommendations/${rec.id}`, body);
      else {
        if (!parseSpotifyLink(v.url)) throw new Error('Kein Spotify-Link. In Spotify „Teilen → Link kopieren“ (open.spotify.com/…).');
        await api.post('/music/recommendations', { ...body, url: v.url.trim() });
      }
      toast('Empfehlung gespeichert');
    },
  });
  async function loadRecs() {
    recs = await api.get('/music/recommendations');
    const box = $('#m-recs', view);
    if (!recs.length && !manage) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Empfehlungen</h2>${manage ? '<button class="btn sm" data-m="rec-new">Empfehlung hinzufügen</button>' : ''}</div>
      ${recs.length ? `<div class="rec-grid">${recs.map((r, i) => `<div class="rec ${r.size === 'large' ? 'large' : ''}"><div class="rec-head"><b>${esc(r.title)}</b><small class="muted">${KIND_LABEL[r.kind] || ''}${r.note ? ` · ${esc(r.note)}` : ''}</small></div>
        ${spotifyEmbed(r.kind, r.spotify_id, r.size === 'large')}
        ${manage ? `<div class="row start" style="gap:4px;margin-top:6px;flex-wrap:wrap"><button class="btn ghost sm" data-rec-move="up" data-rec="${r.id}" ${i ? '' : 'disabled'} aria-label="${esc(r.title)} nach vorn">↑</button><button class="btn ghost sm" data-rec-move="down" data-rec="${r.id}" ${i < recs.length - 1 ? '' : 'disabled'} aria-label="${esc(r.title)} nach hinten">↓</button>
          <button class="btn ghost sm" data-rec-edit="${r.id}">Bearbeiten</button><button class="btn ghost sm" data-rec-del="${r.id}">Entfernen</button></div>` : ''}</div>`).join('')}</div>`
        : empty('Noch keine Empfehlungen. Füge Spotify-Playlists hinzu, die alle hier direkt abspielen können.')}</div>`;
  }

  /* ----- Player: suchen oder Link einfügen, spielt eingebettet ----- */
  let found = null;
  function drawPlayer(current) {
    const box = $('#m-player', view);
    const searchable = info?.search;
    box.innerHTML = `<div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Spotify-Player</h2><small>spielt hier im Browser</small></div>
      <div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="m-emb-q" type="search" class="search" style="flex:1;min-width:220px" placeholder="${searchable ? 'Playlist, Album oder Titel suchen – oder Spotify-Link einfügen' : 'Spotify-Link einfügen (open.spotify.com/…)'}" aria-label="Spotify suchen oder Link einfügen">
      <button class="btn sm" data-m="emb-go">${searchable ? 'Suchen' : 'Abspielen'}</button></div>
      <p class="muted" style="margin:8px 0 0"><small>Ganze Titel hörst du, wenn du in diesem Browser bei Spotify angemeldet bist (open.spotify.com); sonst spielt Spotify nur kurze Vorschauen.${searchable ? '' : ' Suchen kann hier erst, wenn ein Admin die Spotify-App mit Client-Secret einrichtet.'}</small></p>
      <div id="m-emb-res"></div><div id="m-emb" style="margin-top:12px">${current ? spotifyEmbed(current.kind, current.id, true) : ''}</div></div>`;
  }
  function drawFound() {
    const res = $('#m-emb-res', view);
    if (!found) { res.innerHTML = ''; return; }
    const section = (label, list) => (list.length ? `<h3 style="font-size:13px;margin:14px 0 6px">${label}</h3><div class="music-grid">${list.map((x) => `<button class="music-tile" data-emb-kind="${esc(x.kind)}" data-emb-id="${esc(x.id)}">${cover(x.image, x.name)}<b>${esc(x.name)}</b><small class="muted">${esc(x.by || '')}</small></button>`).join('')}</div>` : '');
    const html = section('Playlists', found.playlists) + section('Alben', found.albums) + section('Titel', found.tracks);
    res.innerHTML = html || empty('Nichts gefunden.');
  }
  function playEmbed(kind, id) {
    $('#m-emb', view).innerHTML = spotifyEmbed(kind, id, true);
    $('#m-emb', view).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function embedGo() {
    const value = $('#m-emb-q', view).value.trim();
    if (!value) return;
    const link = parseSpotifyLink(value);
    if (link) { found = null; drawFound(); playEmbed(link.kind, link.id); return; }
    if (!info?.search) throw new Error('Das ist kein Spotify-Link. Kopiere in Spotify „Teilen → Link kopieren“.');
    found = await api.get(`/music/spotify/catalog?q=${encodeURIComponent(value)}`);
    drawFound();
  }

  /* ----- Spotify ----- */
  let info = null;
  let st = null;
  let devices = [];
  let playlists = [];
  let results = null;
  let timer = null;

  function drawSpotify() {
    const box = $('#m-sp', view);
    if (!box) return;
    const ownApp = `<details style="margin-top:14px"><summary>Eigene Spotify-App verwenden${info.own_app ? ' (aktiv)' : ''}</summary>
      <p class="muted" style="margin:8px 0">Spotify lässt eine App im Entwicklungsmodus nur für freigeschaltete Konten zu. Mit deiner eigenen App klappt die Anmeldung immer: Unter developer.spotify.com/dashboard „Create app“ wählen, „Web API“ ankreuzen, als Redirect URI <code>${esc(info.redirect_uri)}</code> eintragen und die Client-ID hier einfügen. Ein Secret brauchst du nicht.</p>
      <div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="m-sp-own" value="${esc(info.own_app || '')}" placeholder="Client-ID deiner Spotify-App" aria-label="Client-ID deiner Spotify-App" maxlength="64" style="max-width:340px">
      <button class="btn sm" data-m="sp-own-save">Speichern</button>${info.own_app ? '<button class="btn ghost sm" data-m="sp-own-clear">App des Servers verwenden</button>' : ''}</div></details>`;
    const problem = info.redirect_problem ? `<p class="auth-error" role="alert" style="margin-top:10px">${esc(info.redirect_problem)}</p>` : '';
    if (!info.connected) {
      box.innerHTML = `<div class="card"><h2>Spotify-Geräte steuern (Premium)</h2><p class="muted" style="margin:8px 0 14px">Melde dich mit deinem Spotify-Konto an, dann steuerst du, was auf deinen Spotify-Geräten läuft (Handy, PC, Lautsprecher). Steuern erlaubt Spotify nur mit Premium.</p>
        ${info.configured ? '<button class="btn" data-m="sp-connect">Mit Spotify anmelden</button>' : `<p>${can('admin:access') ? 'Für alle einrichten: Server-Management → Integrationen → Spotify. Oder nur für dich mit deiner eigenen App (unten).' : 'Ein Admin hat noch keine Spotify-App für alle eingerichtet. Du kannst stattdessen deine eigene App hinterlegen (unten).'}</p>`}
        ${problem}${ownApp}</div>`;
      return;
    }
    const active = document.activeElement;
    if (active?.id === 'm-sp-q') return; // Suche nicht beim Tippen neu zeichnen
    box.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <div class="card"><div class="card-head"><h2>Läuft gerade</h2><small>${esc(info.account || '')}</small></div>${spotifyNow(st, false)}
        <div class="row start" style="margin-top:14px;flex-wrap:wrap"><select id="m-sp-dev" aria-label="Gerät">${devices.length ? devices.map((d) => `<option value="${esc(d.id)}" ${d.active ? 'selected' : ''}>${esc(d.name)} (${esc(d.type)})</option>`).join('') : '<option value="">Kein Gerät gefunden</option>'}</select>
        <button class="btn ghost sm" data-m="sp-devices">Geräte aktualisieren</button><button class="btn ghost sm" data-m="sp-disconnect">Abmelden</button></div></div>
      <div class="card"><div class="card-head"><h2>Suchen</h2></div><input id="m-sp-q" type="search" class="search" placeholder="Titel, Album oder Playlist…" aria-label="Spotify durchsuchen" style="width:100%">
        <div id="m-sp-res" style="margin-top:10px">${drawResults()}</div></div></div>
      <div class="card"><div class="card-head"><h2>Deine Playlists</h2></div>${playlists.length ? `<div class="music-grid">${playlists.map((p) => `<button class="music-tile" data-ctx="${esc(p.uri)}">${cover(p.image, p.name)}<b>${esc(p.name)}</b><small class="muted">${esc(p.owner)}${p.tracks !== null ? ` · ${p.tracks} Titel` : ''}</small></button>`).join('')}</div>` : empty('Keine Playlists gefunden.')}</div>`;
  }
  function drawResults() {
    if (!results) return '';
    const list = [
      ...results.tracks.map((t) => `<button class="music-track" data-uri="${esc(t.uri)}"><span><b>${esc(t.name)}</b> <small class="muted">${esc(t.artists)}</small></span></button>`),
      ...results.albums.map((a) => `<button class="music-track" data-ctx="${esc(a.uri)}"><span>Album: <b>${esc(a.name)}</b> <small class="muted">${esc(a.artists)}</small></span></button>`),
      ...results.playlists.map((p) => `<button class="music-track" data-ctx="${esc(p.uri)}"><span>Playlist: <b>${esc(p.name)}</b> <small class="muted">${esc(p.owner)}</small></span></button>`),
    ];
    return list.length ? list.join('') : empty('Nichts gefunden.');
  }
  async function pollSpotify() {
    if (!view.isConnected) { clearInterval(timer); return; }
    if (document.hidden || !info?.connected) return;
    try {
      st = await api.get('/music/spotify/player');
    } catch (error) {
      st = null;
      if (error.code === 'spotify_reconnect' || error.code === 'spotify_not_connected') { info.connected = false; clearInterval(timer); }
    }
    if (!document.activeElement?.matches?.('#m-sp input[type=range]')) drawSpotify();
  }
  async function loadSpotify() {
    info = await api.get('/music/spotify');
    if (info.connected) {
      const [s, d, p] = await Promise.all([
        api.get('/music/spotify/player').catch(() => null), api.get('/music/spotify/devices').catch(() => []), api.get('/music/spotify/playlists').catch((e) => { toast(e.message, true); return []; }),
      ]);
      st = s; devices = d; playlists = p;
      clearInterval(timer);
      timer = setInterval(pollSpotify, 5000);
    }
    drawSpotify();
  }
  const deviceId = () => $('#m-sp-dev', view)?.value || undefined;
  async function playSpotify(body) {
    await api.put('/music/spotify/player', { action: 'play', ...body, device_id: st?.device ? undefined : deviceId() });
    setTimeout(pollSpotify, 500);
  }

  /* ----- Server: Musikordner und hochgeladene Titel ----- */
  let lib = null;
  let filter = '';
  const shown = () => (filter ? lib.tracks.filter((t) => `${t.folder} ${t.title}`.toLowerCase().includes(filter)) : lib.tracks);
  const groupKey = (t) => `${t.src}:${t.folder}`;
  function drawLocalNow() {
    const n = $('#m-local-now', view);
    if (!n || document.activeElement?.matches?.('#m-local-now input[type=range]')) return;
    n.innerHTML = player.current ? localNow(false) : empty('Wähle unten einen Titel oder spiele einen ganzen Ordner ab.');
    const now = trackKey(player.current);
    $$('.music-track[data-key]', view).forEach((b) => b.classList.toggle('on', b.dataset.key === now));
  }
  function drawLocalList() {
    const box = $('#m-local-list', view);
    const tracks = shown();
    if (!tracks.length) {
      box.innerHTML = empty(lib.tracks.length ? 'Keine passenden Titel.' : lib.can_upload ? 'Noch keine Musik. Lade oben mit „Hochladen“ Titel hoch.' : 'Noch keine Musik vorhanden.');
      return;
    }
    const groups = new Map();
    tracks.forEach((t) => { const k = groupKey(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    const now = trackKey(player.current);
    const note = svg(P.note).replace('<svg', '<svg style="width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8"');
    box.innerHTML = `${lib.truncated ? '<p class="muted">Aus dem Musikordner werden nur die ersten 5.000 Titel angezeigt.</p>' : ''}${[...groups].map(([k, list]) => `<div class="music-folder"><h3><span>${esc(list[0].folder || 'Hauptordner')} <small class="muted">${list[0].src === 'upload' ? 'hochgeladen · ' : ''}${list.length} Titel</small></span>
      <button class="btn ghost sm" data-group="${esc(k)}">Ordner abspielen</button></h3>
      ${list.map((t) => `<div class="music-row"><button class="music-track ${trackKey(t) === now ? 'on' : ''}" data-key="${esc(trackKey(t))}">${note}<span>${esc(t.title)}</span>${t.uploaded_by_name ? `<small class="muted">${esc(t.uploaded_by_name)}</small>` : ''}</button>
        ${t.can_edit ? `<button class="btn ghost sm" data-file-edit="${t.id}">Bearbeiten</button><button class="btn ghost sm" data-file-del="${t.id}">Löschen</button>` : ''}</div>`).join('')}</div>`).join('')}`;
  }
  async function loadLocal() {
    lib = await api.get('/music/local');
    const box = $('#m-local', view);
    const hint = !lib.configured && can('admin:access')
      ? '<p class="muted" style="margin:0 0 10px">Zusätzlich zu hochgeladenen Titeln kann der Server einen Musikordner einbinden: Dateien in den Ordner <code>music</code> neben der <code>docker-compose.yml</code> legen (oder <code>MUSIC_DIR</code> in der <code>.env</code>).</p>' : '';
    box.innerHTML = `<div class="card" id="m-local-now" style="margin-bottom:18px"></div>
      <div class="card"><div class="card-head"><h2>Bibliothek</h2><div class="row">${lib.can_upload ? '<button class="btn sm" data-m="local-upload">Hochladen</button>' : ''}<small>${lib.tracks.length} Titel</small></div></div>${hint}
      <div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:6px"><input id="m-local-q" type="search" class="search" placeholder="Titel oder Ordner…" aria-label="Musik durchsuchen" value="${esc(filter)}">
      <button class="btn ghost sm" data-m="local-all">Alle abspielen</button></div><div id="m-local-list"></div></div>`;
    $('#m-local-q', view).addEventListener('input', debounce((e) => { filter = e.target.value.trim().toLowerCase(); drawLocalList(); }, 200));
    drawLocalNow();
    drawLocalList();
  }
  const uploadFolders = () => [...new Set(lib.tracks.filter((t) => t.src === 'upload').map((t) => t.folder))];
  async function uploadForm() {
    const done = openForm({
      title: 'Musik hochladen',
      fields: [
        { name: 'folder', label: 'Ordner (Album)', value: 'Hochgeladen', required: true, maxlength: 100, suggestions: uploadFolders(), full: true },
        { name: 'files', label: `Dateien (mp3, m4a, aac, ogg, opus, flac, wav, webm; je höchstens ${lib.max_upload_mb} MB)`, type: 'file', accept: 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.wav,.webm', required: true, full: true },
        { type: 'html', html: '<p class="muted" id="m-up-state" style="margin:0"></p>' },
      ],
      submit: 'Hochladen',
      onSubmit: async (v, m) => {
        const files = [...$('[name=files]', m).files];
        if (!files.length) throw new Error('Wähle mindestens eine Datei');
        const state = $('#m-up-state', m);
        const failed = [];
        for (const [i, file] of files.entries()) {
          state.textContent = `Lade ${i + 1} von ${files.length}: ${file.name} …`;
          const form = new FormData();
          form.append('folder', v.folder.trim());
          form.append('file', file);
          try { await api.post('/music/files', form); } catch (error) { failed.push(`${file.name}: ${error.message}`); }
        }
        const ok = files.length - failed.length;
        if (failed.length) {
          state.textContent = '';
          if (ok) toast(`${ok} von ${files.length} hochgeladen`);
          throw new Error(failed.join(' · '));
        }
        toast(files.length === 1 ? 'Titel hochgeladen' : `${files.length} Titel hochgeladen`);
      },
    });
    $('#modals .modal:last-child [name=files]')?.setAttribute('multiple', '');
    await done;
    await loadLocal();
  }
  async function fileForm(t) {
    const saved = await openForm({
      title: 'Titel bearbeiten',
      fields: [
        { name: 'title', label: 'Titel', value: t.title, required: true, maxlength: 200, full: true },
        { name: 'folder', label: 'Ordner (Album)', value: t.folder, required: true, maxlength: 100, suggestions: uploadFolders(), full: true },
      ],
      onSubmit: (v) => api.patch(`/music/files/${t.id}`, { title: v.title.trim(), folder: v.folder.trim() }),
    });
    if (saved) await loadLocal();
  }
  const unsubscribe = player.subscribe(() => { if (!view.isConnected) { unsubscribe(); return; } drawLocalNow(); });

  /* ----- Ereignisse ----- */
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t || !view.contains(t)) return;
    try {
      const a = t.dataset.m;
      if (t.dataset.key) { const list = shown(); await player.play(list, list.findIndex((x) => trackKey(x) === t.dataset.key)); return; }
      if (t.dataset.group) { await player.play(lib.tracks.filter((x) => groupKey(x) === t.dataset.group)); return; }
      if (t.dataset.fileEdit) { await fileForm(lib.tracks.find((x) => x.id === t.dataset.fileEdit)); return; }
      if (t.dataset.fileDel) {
        const f = lib.tracks.find((x) => x.id === t.dataset.fileDel);
        if (!(await confirmBox('Titel löschen', `„${f.title}“ wird für alle gelöscht.`))) return;
        await api.del(`/music/files/${f.id}`);
        player.remove(trackKey(f));
        toast('Titel gelöscht');
        await loadLocal();
        return;
      }
      if (t.dataset.embKind) { playEmbed(t.dataset.embKind, t.dataset.embId); return; }
      if (a === 'emb-go') { await embedGo(); return; }
      if (a === 'rec-new') { if (await recForm(null)) await loadRecs(); return; }
      if (t.dataset.recEdit) { if (await recForm(recs.find((r) => r.id === t.dataset.recEdit))) await loadRecs(); return; }
      if (t.dataset.recMove) { await api.post(`/music/recommendations/${t.dataset.rec}/move`, { dir: t.dataset.recMove }); await loadRecs(); return; }
      if (t.dataset.recDel) {
        const r = recs.find((x) => x.id === t.dataset.recDel);
        if (!(await confirmBox('Empfehlung entfernen', `„${r.title}“ verschwindet für alle von der Musikseite.`, 'Entfernen'))) return;
        await api.del(`/music/recommendations/${r.id}`);
        await loadRecs();
        return;
      }
      if (t.dataset.ctx) { await playSpotify({ context_uri: t.dataset.ctx }); return; }
      if (t.dataset.uri) { await playSpotify({ uri: t.dataset.uri }); return; }
      if (!a) return;
      if (a === 'local-all') { await player.play(shown()); return; }
      if (a === 'local-upload') { await uploadForm(); return; }
      if (a === 'sp-own-save' || a === 'sp-own-clear') {
        const id = a === 'sp-own-clear' ? null : $('#m-sp-own', view).value.trim();
        if (a === 'sp-own-save' && !id) throw new Error('Client-ID fehlt');
        await api.put('/music/spotify/app', { client_id: id });
        toast(id ? 'Eigene Spotify-App gespeichert' : 'App des Servers wird verwendet');
        await loadSpotify();
        return;
      }
      if (handleLocal(a, t)) return;
      if (a === 'sp-connect') { window.location.href = (await api.get('/music/spotify/connect')).url; return; }
      if (a === 'sp-disconnect') {
        if (!(await confirmBox('Von Spotify abmelden', 'Die Verbindung zu deinem Spotify-Konto wird entfernt.', 'Abmelden'))) return;
        await api.del('/music/spotify');
        clearInterval(timer);
        await loadSpotify();
        return;
      }
      if (a === 'sp-devices') { devices = await api.get('/music/spotify/devices'); drawSpotify(); return; }
      if (a === 'sp-play' && !st?.device && deviceId()) { await playSpotify({}); return; }
      if (a.startsWith('sp-')) { await spotifyAction(a.slice(3), t, st); setTimeout(pollSpotify, 400); }
    } catch (error) {
      toast(error.message, true);
    }
  });
  view.addEventListener('change', async (e) => {
    const el = e.target;
    try {
      if (el.id === 'm-sp-dev' && el.value) { await api.put('/music/spotify/player', { action: 'transfer', device_id: el.value }); setTimeout(pollSpotify, 600); return; }
      const a = el.dataset.m;
      if (!a) return;
      if (handleLocal(a, el)) return;
      if (a.startsWith('sp-')) { await spotifyAction(a.slice(3), el, st); setTimeout(pollSpotify, 400); }
    } catch (error) {
      toast(error.message, true);
    }
  });
  view.addEventListener('input', debounce(async (e) => {
    if (e.target.id !== 'm-sp-q') return;
    const term = e.target.value.trim();
    try {
      results = term ? await api.get(`/music/spotify/search?q=${encodeURIComponent(term)}`) : null;
      $('#m-sp-res', view).innerHTML = drawResults();
    } catch (error) { toast(error.message, true); }
  }, 350));

  view.addEventListener('keydown', (e) => {
    if (e.target.id === 'm-emb-q' && e.key === 'Enter') { e.preventDefault(); embedGo().catch((error) => toast(error.message, true)); }
  });
  await Promise.all([loadRecs().catch((error) => { $('#m-recs', view).innerHTML = empty(error.message); }), loadSpotify().then(() => drawPlayer()).catch((error) => { drawPlayer(); $('#m-sp', view).innerHTML = empty(error.message); }), loadLocal().catch((error) => { $('#m-local', view).innerHTML = empty(error.message); })]);
}
