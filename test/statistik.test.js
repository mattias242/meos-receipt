// KRAV-21, KRAV-22: användningsstatistik och löparens omdöme.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStatistik } from '../lib/statistik.js';

function tmpKatalog(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-stat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('en löpare som hämtar sitt kvitto räknas', { concurrency: true }, () => {
  const s = createStatistik();
  s.kvitto(1, 31);
  assert.equal(s.for(1).kvittonVisade, 1);
});

test('samma löpare räknas en gång oavsett hur ofta sidan pollar', { concurrency: true }, () => {
  const s = createStatistik();
  for (let i = 0; i < 20; i++) s.kvitto(1, 31);
  assert.equal(s.for(1).kvittonVisade, 1);
});

test('olika löpare räknas var för sig', { concurrency: true }, () => {
  const s = createStatistik();
  s.kvitto(1, 31);
  s.kvitto(1, 32);
  assert.equal(s.for(1).kvittonVisade, 2);
});

test('tävlingar räknas var för sig', { concurrency: true }, () => {
  const s = createStatistik();
  s.kvitto(1, 31);
  s.kvitto(2, 31);
  assert.equal(s.for(1).kvittonVisade, 1);
  assert.equal(s.for(2).kvittonVisade, 1);
});

test('PDF, mejl och sökningar räknas var för sig', { concurrency: true }, () => {
  const s = createStatistik();
  s.pdf(1);
  s.pdf(1);
  s.mejl(1);
  s.sokning(1);
  s.sokning(1);
  s.sokning(1);
  const u = s.for(1);
  assert.equal(u.pdf, 2);
  assert.equal(u.mejl, 1);
  assert.equal(u.sokningar, 3);
});

test('en tumme upp och en tumme ner räknas var för sig', { concurrency: true }, () => {
  const s = createStatistik();
  assert.equal(s.rosta(1, 'upp'), true);
  assert.equal(s.rosta(1, 'upp'), true);
  assert.equal(s.rosta(1, 'ner'), true);
  assert.equal(s.for(1).upp, 2);
  assert.equal(s.for(1).ner, 1);
});

test('ett svar som varken är upp eller ner avvisas', { concurrency: true }, () => {
  const s = createStatistik();
  assert.equal(s.rosta(1, 'kanske'), false);
  assert.equal(s.rosta(1, ''), false);
  assert.equal(s.rosta(1, undefined), false);
  assert.equal(s.for(1).upp, 0);
  assert.equal(s.for(1).ner, 0);
});

test('en tävling utan användning svarar med nollor, inte undefined', { concurrency: true }, () => {
  const s = createStatistik();
  const u = s.for(99);
  assert.equal(u.kvittonVisade, 0);
  assert.equal(u.pdf, 0);
  assert.equal(u.upp, 0);
});

// Det som lagras får inte gå att läsa som "löpare 31 tittade".
test('inga löpar-id lagras', { concurrency: true }, (t) => {
  const dir = tmpKatalog(t);
  const s = createStatistik({ dataDir: dir, saveDelayMs: 1 });
  s.kvitto(1, 31);
  s.kvitto(1, 4711);
  s.flush();
  const rå = fs.readFileSync(path.join(dir, 'statistik.json'), 'utf8');
  assert.doesNotMatch(rå, /4711/, 'löpar-id hittades i statistikfilen');
  assert.equal(JSON.parse(rå)['1'].kvittonVisade, 2);
});

test('mätningen överlever en omstart', { concurrency: true }, (t) => {
  const dir = tmpKatalog(t);
  const första = createStatistik({ dataDir: dir, saveDelayMs: 1 });
  första.kvitto(1, 31);
  första.pdf(1);
  första.rosta(1, 'upp');
  första.flush();

  const andra = createStatistik({ dataDir: dir, saveDelayMs: 1 });
  const u = andra.for(1);
  assert.equal(u.kvittonVisade, 1);
  assert.equal(u.pdf, 1);
  assert.equal(u.upp, 1);
});

// Priset för att inte föra register över vem som tittat: mängden unika id:n
// börjar tom efter en omstart, så en återvändande löpare räknas igen.
test('en löpare som återkommer efter omstart räknas igen', { concurrency: true }, (t) => {
  const dir = tmpKatalog(t);
  const första = createStatistik({ dataDir: dir, saveDelayMs: 1 });
  första.kvitto(1, 31);
  första.flush();

  const andra = createStatistik({ dataDir: dir, saveDelayMs: 1 });
  andra.kvitto(1, 31);
  assert.equal(andra.for(1).kvittonVisade, 2);
});

test('en gallrad tävling glöms', { concurrency: true }, (t) => {
  const dir = tmpKatalog(t);
  const s = createStatistik({ dataDir: dir, saveDelayMs: 1 });
  s.kvitto(1, 31);
  s.kvitto(2, 31);
  s.glom(1);
  assert.equal(s.for(1).kvittonVisade, 0);
  assert.equal(s.for(2).kvittonVisade, 1);
  s.flush();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'statistik.json'), 'utf8'))['1'], undefined);
});

test('utan datalagring räknas ändå i minnet', { concurrency: true }, () => {
  const s = createStatistik();
  s.kvitto(1, 31);
  s.flush();
  assert.equal(s.for(1).kvittonVisade, 1);
});

test('en trasig statistikfil tystar inte tjänsten', { concurrency: true }, (t) => {
  const dir = tmpKatalog(t);
  fs.writeFileSync(path.join(dir, 'statistik.json'), '{ trasig');
  const s = createStatistik({ dataDir: dir, saveDelayMs: 1 });
  s.kvitto(1, 31);
  assert.equal(s.for(1).kvittonVisade, 1);
});

test('allt() ger en post per tävling som använts', { concurrency: true }, () => {
  const s = createStatistik();
  s.kvitto(1, 31);
  s.sokning(2);
  assert.deepEqual(Object.keys(s.allt()).sort(), ['1', '2']);
});

test('tidsstämplar sätts vid första och senaste användning', { concurrency: true }, () => {
  let tid = 1000;
  const s = createStatistik({ now: () => tid });
  s.kvitto(1, 31);
  tid = 5000;
  s.pdf(1);
  const u = s.for(1);
  assert.equal(u.forsta, new Date(1000).toISOString());
  assert.equal(u.senaste, new Date(5000).toISOString());
});
