// Texterkennung mit Tesseract (im Image installiert, siehe apps/api/Dockerfile). Das Bild geht über stdin hinein und
// wird nirgends gespeichert. Höchstens zwei Erkennungen gleichzeitig, jede mit einem Kern und Zeitlimit, damit ein
// großer Screenshot den Server nicht blockiert.
import { spawn } from 'node:child_process';
import { HttpError } from './authz.js';

const PARALLEL = 2;
const TIMEOUT_MS = 60000;
let running = 0;
const waiting = [];

async function slot() {
  if (running < PARALLEL) { running++; return; }
  if (waiting.length >= 10) throw new HttpError(429, 'Gerade laufen zu viele Texterkennungen – versuche es gleich noch einmal', 'busy');
  await new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

export async function recognizeText(image, { languages = 'deu+eng' } = {}) {
  await slot();
  try {
    return await new Promise((resolve, reject) => {
      // --psm 6: ein einheitlicher Block; hält Text und Betrag einer Zeile zusammen, auch wenn der Betrag rechtsbündig weit
      // weg steht (mit --psm 4 und 3 fielen rechtsbündige Beträge im Handy-Ausschnitt eines Spielbilds weg)
      const child = spawn('tesseract', ['stdin', 'stdout', '-l', languages, '--psm', '6'], {
        env: { ...process.env, OMP_THREAD_LIMIT: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out = [];
      let err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new HttpError(422, 'Die Texterkennung hat zu lange gedauert – nimm einen kleineren Ausschnitt', 'ocr_timeout')); }, TIMEOUT_MS);
      child.stdout.on('data', (chunk) => out.push(chunk));
      child.stderr.on('data', (chunk) => { if (err.length < 2000) err += chunk; });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e.code === 'ENOENT' ? new HttpError(503, 'Texterkennung ist auf diesem Server nicht installiert (Tesseract fehlt im Image)', 'ocr_missing') : e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
        else reject(new HttpError(422, `Das Bild ließ sich nicht lesen${/Error in pix|Image file/i.test(err) ? ' (Format?)' : ''}`, 'ocr_failed'));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(image);
    });
  } finally {
    release();
  }
}
