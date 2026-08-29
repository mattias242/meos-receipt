import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadLimiter } from '../lib/lasgrans.js';
import { withServer } from './helpers/server.js';
import { MOP_COMPLETE, mopCompleteManyRunners } from './fixtures/mop.js';

/**
 * KRAV-5: tak för hur många olika löpare en klient får se.
 *
 * Uppmätt före taket: 2000 fullständiga kvitton hämtade på 1,3 sekunder genom
 * att räkna löpar-id uppåt, utan att något sa ifrån. Taket räknar personer och
 * inte anrop, eftersom kvittosidan hämtar samma kvitto var 15:e sekund så
 * länge resultatet inte är klart – många anrop, alltid samma person.
 */

test('samma kvitto om och om igen kostar bara en', () => {
  const gräns = createReadLimiter({ max: 3 });
  for (let i = 0; i < 100; i++) gräns.räkna('1.1.1.1', ['1:31']);
  assert.equal(gräns.sedda('1.1.1.1'), 1, 'pollning ska inte förbruka taket');
  assert.equal(gräns.överSkridet('1.1.1.1'), false);
});

test('olika löpare räknas var för sig', () => {
  const gräns = createReadLimiter({ max: 3 });
  gräns.räkna('1.1.1.1', ['1:31', '1:32']);
  assert.equal(gräns.överSkridet('1.1.1.1'), false);
  gräns.räkna('1.1.1.1', ['1:33']);
  assert.equal(gräns.överSkridet('1.1.1.1'), true);
});

test('klienter har egna budgetar', () => {
  const gräns = createReadLimiter({ max: 2 });
  gräns.räkna('1.1.1.1', ['1:31', '1:32']);
  assert.equal(gräns.överSkridet('1.1.1.1'), true);
  assert.equal(gräns.överSkridet('2.2.2.2'), false, 'grannen ska inte drabbas');
});

test('fönstret öppnar igen', () => {
  let nu = 0;
  const gräns = createReadLimiter({ max: 1, windowMs: 1000, now: () => nu });
  gräns.räkna('1.1.1.1', ['1:31']);
  assert.equal(gräns.överSkridet('1.1.1.1'), true);
  nu += 1001;
  assert.equal(gräns.överSkridet('1.1.1.1'), false);
});

test('max 0 stänger av taket helt', () => {
  const gräns = createReadLimiter({ max: 0 });
  for (let i = 0; i < 5000; i++) gräns.räkna('1.1.1.1', [`1:${i}`]);
  assert.equal(gräns.överSkridet('1.1.1.1'), false);
});

// --- genom tjänsten ---------------------------------------------------------

test('en uppräkning av löpar-id stoppas', { concurrency: true }, withServer(async ({ base }) => {
  await fetch(`${base}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1' },
    body: MOP_COMPLETE,
  });

  const koder = [];
  for (const id of [31, 32, 33, 34, 35]) {
    koder.push((await fetch(`${base}/api/receipt?cmp=1&id=${id}`)).status);
  }
  assert.ok(
    koder.includes(429),
    `räknade upp fem löpare utan att stoppas: ${koder.join(', ')}`
  );
}, { readLimit: 3 }));

test('en löpare som pollar sitt eget kvitto stoppas aldrig', { concurrency: true }, withServer(async ({ base }) => {
  await fetch(`${base}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1' },
    body: MOP_COMPLETE,
  });

  // Fyrtio uppdateringar – tio minuter på kvittosidan
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${base}/api/receipt?card=123456`);
    assert.equal(res.status, 200, `stoppades vid uppdatering ${i + 1}`);
  }
}, { readLimit: 3 }));

test('en bred träfflista räknas som de personer den visar', { concurrency: true }, withServer(async ({ base }) => {
  await fetch(`${base}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1' },
    body: mopCompleteManyRunners(60),
  });

  // "Löpare 1" matchar 1 och 10-19, alltså 11 personer per sökning. Taket
  // kontrolleras före svaret räknas in, så ett svar får gå över gränsen –
  // avsiktligt, eftersom alternativet vore att bygga svaret och sedan kasta
  // det. Efter två sökningar (22 sedda) stängs nästa.
  const koder = [];
  for (const q of ['Löpare 1', 'Löpare 2', 'Löpare 3']) {
    koder.push((await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`)).status);
  }
  assert.deepEqual(
    koder,
    [200, 200, 429],
    `smala sökningar i följd ska räknas ihop: ${koder.join(', ')}`
  );
}, { readLimit: 20 }));

test('taket är avstängt som standard i testerna och går att stänga av', { concurrency: true }, withServer(async ({ base }) => {
  await fetch(`${base}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1' },
    body: MOP_COMPLETE,
  });
  for (const id of [31, 32, 33, 34, 35]) {
    assert.notEqual((await fetch(`${base}/api/receipt?cmp=1&id=${id}`)).status, 429);
  }
}, { readLimit: 0 }));
