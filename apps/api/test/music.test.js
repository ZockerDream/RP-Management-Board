import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTrack, trackTitle, parseRange, scanLibrary, audioType } from '../src/music.js';

test('resolveTrack bleibt im Musikverzeichnis', () => {
  const root = '/data/music';
  assert.equal(resolveTrack(root, 'Rock/01 Song.mp3'), '/data/music/Rock/01 Song.mp3');
  for (const bad of ['../etc/passwd.mp3', '/etc/x.mp3', 'a/../../x.mp3', 'a//b.mp3', '.hidden.mp3', 'a/.x/b.mp3', 'x.txt', 'a\\b.mp3', 'x\0.mp3', '', null]) {
    assert.equal(resolveTrack(root, bad), null, String(bad));
  }
});

test('trackTitle und audioType', () => {
  assert.equal(trackTitle('Ordner/01_Mein__Lied.flac'), '01 Mein Lied');
  assert.equal(audioType('a.MP3'), 'audio/mpeg');
  assert.equal(audioType('a.exe'), null);
});

test('parseRange', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), false);
  assert.equal(parseRange('bytes=5-2', 100), false);
  assert.equal(parseRange('items=0-1', 100), null);
});

test('scanLibrary findet Audiodateien und ignoriert Fremdes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.mkdirSync(path.join(root, 'Album 2'));
  fs.mkdirSync(path.join(root, '.versteckt'));
  fs.writeFileSync(path.join(root, 'Album 2', '10 Zehn.mp3'), 'x');
  fs.writeFileSync(path.join(root, 'Album 2', '2 Zwei.ogg'), 'xy');
  fs.writeFileSync(path.join(root, 'cover.jpg'), 'x');
  fs.writeFileSync(path.join(root, '.versteckt', 'a.mp3'), 'x');
  fs.writeFileSync(path.join(outside, 'geheim.mp3'), 'x');
  fs.symlinkSync(path.join(outside, 'geheim.mp3'), path.join(root, 'link.mp3'));
  const lib = await scanLibrary(root);
  assert.equal(lib.configured, true);
  assert.deepEqual(lib.tracks.map((t) => t.path), ['Album 2/2 Zwei.ogg', 'Album 2/10 Zehn.mp3']);
  assert.equal(lib.tracks[0].folder, 'Album 2');
  assert.equal((await scanLibrary(path.join(root, 'fehlt'))).configured, false);
});

test('sniffAudio erkennt Audio am Inhalt', async () => {
  const { sniffAudio } = await import('../src/music.js');
  assert.equal(sniffAudio(Buffer.from('ID3\x04\x00')), 'audio/mpeg');
  assert.equal(sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00])), 'audio/mpeg');
  assert.equal(sniffAudio(Buffer.from([0xff, 0xf1, 0x50, 0x80])), 'audio/aac');
  assert.equal(sniffAudio(Buffer.from('OggS\x00\x02')), 'audio/ogg');
  assert.equal(sniffAudio(Buffer.from('fLaC\x00\x00')), 'audio/flac');
  assert.equal(sniffAudio(Buffer.from('RIFF\x24\x08\x00\x00WAVEfmt ', 'latin1')), 'audio/wav');
  assert.equal(sniffAudio(Buffer.from('\x00\x00\x00\x20ftypM4A ', 'latin1')), 'audio/mp4');
  assert.equal(sniffAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'audio/webm');
  assert.equal(sniffAudio(Buffer.from('<html>')), null);
  assert.equal(sniffAudio(Buffer.from('%PDF-1.7')), null);
  assert.equal(sniffAudio(Buffer.alloc(0)), null);
});

test('spotifyRedirect und redirectProblem', async () => {
  const { spotifyRedirect, redirectProblem } = await import('../src/music.js');
  assert.equal(spotifyRedirect('http://localhost:8088'), 'http://127.0.0.1:8088/api/music/spotify/callback');
  assert.equal(spotifyRedirect('https://rp.example.org/'), 'https://rp.example.org/api/music/spotify/callback');
  assert.equal(redirectProblem('https://rp.example.org/api/music/spotify/callback'), null);
  assert.equal(redirectProblem('http://127.0.0.1:8088/api/music/spotify/callback'), null);
  assert.match(redirectProblem('http://192.168.1.5:8088/api/music/spotify/callback'), /HTTPS/);
});

test('parseSpotifyLink', async () => {
  const { parseSpotifyLink, spotifyEmbedUrl } = await import('../src/music.js');
  assert.deepEqual(parseSpotifyLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'), { kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(parseSpotifyLink('https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy'), { kind: 'album', id: '4aawyAB9vmqN3uQ7FjRGTy' });
  assert.deepEqual(parseSpotifyLink(' spotify:track:11dFghVXANMlKmJXsNCbNl '), { kind: 'track', id: '11dFghVXANMlKmJXsNCbNl' });
  assert.deepEqual(parseSpotifyLink('https://open.spotify.com/embed/show/5CfCWKI5pZ28U0uOzXkDHe'), { kind: 'show', id: '5CfCWKI5pZ28U0uOzXkDHe' });
  for (const bad of ['', 'Lofi Beats', 'https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M', 'http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'https://open.spotify.com/user/abc', 'spotify:playlist:<x>', 'javascript:alert(1)']) {
    assert.equal(parseSpotifyLink(bad), null, bad);
  }
  assert.equal(spotifyEmbedUrl({ kind: 'playlist', id: 'abcdefghij' }), 'https://open.spotify.com/embed/playlist/abcdefghij');
});
