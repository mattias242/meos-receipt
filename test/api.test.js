import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import {
  MOP_COMPLETE,
  MOP_DIFF_CARL as MOP_DIFF,
  mopDiffExtraRunner,
  mopCompleteMinimal,
  mopCompleteManyRunners,
} from './fixtures/mop.js';

async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

async function postMop(base, xml, headers = {}) {
  const res = await fetch(`${base}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1', ...headers },
    body: xml,
  });
  return res.text();
}

test('MOP endpoint validates competition id and password', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());

  assert.equal(await postMop(base, MOP_COMPLETE, { competition: '' }), 'BADCMP');
  assert.equal(await postMop(base, MOP_COMPLETE, { pwd: 'fel' }), 'BADPWD');
  assert.equal(await postMop(base, MOP_COMPLETE, { pwd: 'hemligt' }), 'OK');
});

test('zip payloads get NOZIP so MeOS falls back to plain XML', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  assert.equal(await postMop(base, 'PK\x03\x04zipdata'), 'NOZIP');
});

test('receipt by card number: result, placement, splits', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  assert.equal(await postMop(base, MOP_COMPLETE), 'OK');

  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 200);
  const r = await res.json();

  assert.equal(r.competition.name, 'Testtävlingen');
  assert.equal(r.runner.name, 'Anna Andersson');
  assert.equal(r.runner.club, 'OK Skogen');
  assert.equal(r.runner.class, 'H21');
  assert.equal(r.result.statusText, 'Godkänd');
  assert.equal(r.result.time, '35:00');           // 21000 tiondelar
  assert.equal(r.result.startTime, '10:00:00');   // 360000 tiondelar
  assert.equal(r.result.finishTime, '10:35:00');
  assert.equal(r.result.place, 2);                // Berit vann på 32:30
  assert.equal(r.result.after, '+2:30');

  assert.equal(r.splits.length, 3); // 2 radio + mål
  assert.deepEqual(r.splits.map((s) => s.name), ['Radio 1', 'Förvarning', 'Mål']);
  assert.equal(r.splits[0].elapsed, '15:00');
  assert.equal(r.splits[0].clock, '10:15:00');
  assert.equal(r.splits[1].leg, '15:00'); // 18000-9000 tiondelar
  assert.equal(r.splits[2].leg, '5:00');  // mål 21000-18000
});

test('status texts: on course and DNF', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  let r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(r.result.statusText, 'Ute på banan');
  assert.equal(r.result.time, '');

  r = await (await fetch(`${base}/api/receipt?card=222222`)).json();
  assert.equal(r.result.statusText, 'Utgått');
});

// KRAV-4: den som inte kommit till start ska inte visas med en starttid,
// även om MeOS har en tilldelad sådan – annars ser kvittot ut som en
// genomförd start. Den som brutit efter start behåller sin.
test('starttid visas bara för den som faktiskt startat', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const ejStart = await (await fetch(`${base}/api/receipt?card=444444`)).json();
  assert.equal(ejStart.result.statusText, 'Ej start');
  assert.equal(ejStart.result.startTime, '', 'ej start ska sakna starttid');
  assert.equal(ejStart.result.finishTime, '');
  assert.equal(ejStart.result.time, '');

  const utgatt = await (await fetch(`${base}/api/receipt?card=222222`)).json();
  assert.equal(utgatt.result.startTime, '10:00:00', 'utgått startade faktiskt');

  const godkand = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.equal(godkand.result.startTime, '10:00:00');
});

// KRAV-5: en bred sökning matchade hela deltagarfältet och skickade det i ett
// svar – vid 2000 löpare 240 kB, och en träfflista ingen kan hitta sig själv i.
test('för bred sökning avvisas i stället för att lista alla', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, mopCompleteManyRunners(150));

  const res = await fetch(`${base}/api/search?q=${encodeURIComponent('Löpare')}`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /150/, 'felet ska säga hur många som matchade');

  // En precisare sökning fungerar som vanligt
  const ok = await fetch(`${base}/api/search?q=${encodeURIComponent('Löpare 42 ')}`);
  assert.equal(ok.status, 200);
  const hits = await ok.json();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'Löpare 42 Efternamn');
});

test('sökning strax under gränsen listas som vanligt', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, mopCompleteManyRunners(100));

  const res = await fetch(`${base}/api/search?q=${encodeURIComponent('Löpare')}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 100);
});

// KRAV-4: slutar MeOS skicka – nätet på tävlingsdatorn dör, eller
// Onlineresultat stängs av misstag – fryser kvittona i det läge de var. En
// löpare som gått i mål och ser "Ute på banan" i en timme tror att hennes
// stämpling inte registrerats. Kvittot ska säga hur gammalt underlaget är.
test('kvittot berättar hur gammal tävlingsdatan är', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(typeof r.updatedAgeSeconds, 'number', 'åldern ska räknas av servern');
  assert.ok(r.updatedAgeSeconds < 5, `nyss inläst data, fick ${r.updatedAgeSeconds} s`);
  assert.equal(r.result.statusText, 'Ute på banan');
});

test('åldern räknas från senast mottagna data', async (t) => {
  const { createStore } = await import('../lib/store.js');
  const { applyMop } = await import('../lib/mop.js');
  const { buildReceipt } = await import('../lib/receipt.js');

  const store = createStore();
  applyMop(store, 1, MOP_COMPLETE);
  // Låtsas att det gått en halvtimme sedan MeOS senast hörde av sig
  const enHalvtimmeSenare = Date.now() + 30 * 60 * 1000;
  const r = buildReceipt(store.competitions[1], 1, 33, { now: () => enHalvtimmeSenare });
  assert.ok(
    r.updatedAgeSeconds >= 1800 && r.updatedAgeSeconds < 1810,
    `förväntade ~1800 s, fick ${r.updatedAgeSeconds}`
  );
});

test('MOPDiff updates a competitor and marks result preliminary', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  assert.equal(await postMop(base, MOP_DIFF), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(r.result.statusText, 'Godkänd');
  assert.equal(r.result.preliminary, true);
  assert.equal(r.result.time, '30:00');
  assert.equal(r.result.place, null);
  assert.equal(r.result.prelPlace, 1); // snabbast i H21
});

test('search by name and unknown card gives 404', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const hits = await (await fetch(`${base}/api/search?q=anna`)).json();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'Anna Andersson');
  assert.equal(hits[0].card, 123456);

  const res = await fetch(`${base}/api/receipt?card=999999`);
  assert.equal(res.status, 404);
});

// KRAV-6: brickan hittas i den senaste tävling där den förekommer
test('card found in older competition when the latest lacks it', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  await postMop(base, mopCompleteMinimal({ name: 'Nyare tävlingen', date: '2026-09-01' }), {
    competition: '2',
  });

  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.runner.name, 'Anna Andersson');
  assert.equal(r.competition.name, 'Testtävlingen');
});

// KRAV-7: delad bricka ska ge en valbar träfflista, inte en gissning
test('shared card gives 300 with alternatives', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  await postMop(base, mopDiffExtraRunner({ name: 'Erik Ek', card: 123456, cls: 2 }));

  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 300);
  const body = await res.json();
  assert.equal(body.alternatives.length, 2);
  assert.deepEqual(
    body.alternatives.map((h) => h.name).sort(),
    ['Anna Andersson', 'Erik Ek']
  );
});

test('MOPComplete replaces earlier data for the competition', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  await postMop(base, MOP_COMPLETE.replace('Testtävlingen', 'Omstartad tävling'));

  const list = await (await fetch(`${base}/api/competitions`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Omstartad tävling');
});
