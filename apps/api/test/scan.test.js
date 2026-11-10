import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement, parseAmount, findDate, findAmounts } from '../src/scan.js';

const today = '2026-11-10';
const short = (text) => parseStatement(text, { today }).items.map((x) => [x.title, x.amount, x.type, x.booked_at]);

test('amounts in German and English notation become cents', () => {
  assert.equal(parseAmount('1.234,56'), 123456n);
  assert.equal(parseAmount('1,234.56'), 123456n);
  assert.equal(parseAmount('1.669'), 166900n);
  assert.equal(parseAmount('1,669'), 166900n);
  assert.equal(parseAmount('12,5'), 1250n);
  assert.equal(parseAmount('23.50'), 2350n);
  assert.equal(parseAmount('1 234'), 123400n);
  assert.equal(parseAmount('1.234.567'), 123456700n);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('1.2.3'), null);
  assert.equal(parseAmount('9999999999999'), null);
});

test('only numbers with currency, sign or two decimals count as amounts', () => {
  const values = (text) => findAmounts(text).map((a) => a.cents);
  assert.deepEqual(values('Route 68 Haus 12'), []);
  assert.deepEqual(values('Tel 555-1234'), []);
  assert.deepEqual(values('Bonus 17,00 %'), []);
  assert.deepEqual(values('Benny -500'), [50000n]);
  assert.deepEqual(values('Route 68 - 500'), []);
  assert.deepEqual(values('Tanken 85,20'), [8520n]);
  assert.deepEqual(values('$ 1,500'), [150000n]);
  assert.deepEqual(values('120 $'), [12000n]);
  assert.deepEqual(values('USD 40'), [4000n]);
});

test('dates: German, ISO, American with slashes, names, today and yesterday; times are removed', () => {
  const date = (text) => findDate(text, today).date;
  assert.equal(date('09.11.2026'), '2026-11-09');
  assert.equal(date('9.11.26'), '2026-11-09');
  assert.equal(date('2026-11-09'), '2026-11-09');
  assert.equal(date('11/06/2026'), '2026-11-06');
  assert.equal(date('06/11/2026'), '2026-11-06');
  assert.equal(date('11.06.2026'), '2026-06-11');
  assert.equal(date('13/11/2026'), '2026-11-13');
  assert.equal(date('8. Nov 2026'), '2026-11-08');
  assert.equal(date('Nov 8, 2026'), '2026-11-08');
  assert.equal(date('3. Dezember'), '2025-12-03');
  assert.equal(date('Heute, 14:32'), today);
  assert.equal(date('Yesterday 18:22'), '2026-11-09');
  assert.equal(date('vorgestern'), '2026-11-08');
  assert.equal(date('31.02.2026'), null);
  assert.equal(findDate('Kosten 12.50.', today).rest, 'Kosten 12.50.');
  assert.doesNotMatch(findDate('Heute, 14:32', today).rest, /\d/);
});

// Die folgenden Texte hat Tesseract im Container aus nachgebauten Screenshots gelesen (browser.mjs rendert dieselben)
test('light app: date below each booking, balance is skipped', () => {
  assert.deepEqual(short(`Fleeca Bank

Kontostand: $ 48,250.00

Benny's Motorworks -$12,500.00
Heute, 14:32

Gehalt LSPD +$1,669.00
Heute, 03:45

Burger Shot -$23.50
Gestern, 19:10`), [
    ["Benny's Motorworks", '12500.00', 'expense', '2026-11-10'],
    ['Gehalt LSPD', '1669.00', 'income', '2026-11-10'],
    ['Burger Shot', '23.50', 'expense', '2026-11-09'],
  ]);
});

test('dark app: dates as group headers, German amounts', () => {
  assert.deepEqual(short(`Umsätze

09.11.2026

Überweisung von Max Mustermann +5.000,00 $
Tankstelle Route 68 -85,20 $
08.11.2026

Miete Apartment -1.200,00 $`), [
    ['Überweisung von Max Mustermann', '5000.00', 'income', '2026-11-09'],
    ['Tankstelle Route 68', '85.20', 'expense', '2026-11-09'],
    ['Miete Apartment', '1200.00', 'expense', '2026-11-08'],
  ]);
});

test('phone in a game screenshot: stray characters are ignored', () => {
  assert.deepEqual(short(`N
a Maze Bank
Verlauf
Received from Jimmy +$250
7 Today 21:04
Paid to Ammu-Nation -$1,450
Yesterday 18:22`), [
    ['Received from Jimmy', '250.00', 'income', '2026-11-10'],
    ['Paid to Ammu-Nation', '1450.00', 'expense', '2026-11-09'],
  ]);
});

test('amount on its own line takes the title from the line above', () => {
  assert.deepEqual(short(`Los Santos Customs
- 3.450,00 €
07.11.2026

Verkauf Fahrzeug

+ 18.000,00 €
07.11.2026`), [
    ['Los Santos Customs', '3450.00', 'expense', '2026-11-07'],
    ['Verkauf Fahrzeug', '18000.00', 'income', '2026-11-07'],
  ]);
});

test('date at the start of the line, English balance line skipped', () => {
  assert.deepEqual(short(`11/06/2026 Pillbox Hospital -$650.00
11/06/2026 Bounty paid out +$2,000.00
Balance $9,120.00`), [
    ['Pillbox Hospital', '650.00', 'expense', '2026-11-06'],
    ['Bounty paid out', '2000.00', 'income', '2026-11-06'],
  ]);
});

test('notifications without sign: the words decide; without date it is today and marked as guessed', () => {
  const result = parseStatement(`Eank

Du hast 2.500 $ von Lester erhalten
Eark

Zahlung an Vanilla Unicorn: 120 $`, { today });
  assert.deepEqual(result.items.map((x) => [x.title, x.amount, x.type, x.booked_at]), [
    ['Du hast von Lester erhalten', '2500.00', 'income', today],
    ['Zahlung an Vanilla Unicorn', '120.00', 'expense', today],
  ]);
  assert.ok(result.items.every((x) => x.guessed.date && !x.guessed.type));
});

test('unknown direction defaults to expense and is marked; future dates fall back to today', () => {
  const [item] = parseStatement('Irgendwas 12,00 €\n12.12.2026', { today }).items;
  assert.equal(item.type, 'expense');
  assert.equal(item.guessed.type, true);
  assert.equal(item.booked_at, today);
  assert.equal(item.guessed.date, true);
});

test('OCR slips in amounts are repaired: O for 0, l for 1', () => {
  assert.deepEqual(short('Benny -$1,5OO\nTanken l2,5O €'), [['Benny', '1500.00', 'expense', today], ['Tanken', '12.50', 'expense', today]]);
});

test('empty text and text without amounts give no suggestions', () => {
  assert.deepEqual(parseStatement('', { today }).items, []);
  assert.deepEqual(parseStatement('Maze Bank\nVerlauf\nKeine Umsätze', { today }).items, []);
});
