import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIofResultList } from '../lib/iof.js';
import { createApp } from '../server.js';
import { MOP_COMPLETE } from './fixtures/mop.js';
import { IOF_RESULTLIST } from './fixtures/iof.js';

// ---------------------------------------------------------------------------
// Parsning (KRAV-9)
// ---------------------------------------------------------------------------

test('parseIofResultList: event, löpare, brickor och sträcktider', () => {
  const { event, results } = parseIofResultList(IOF_RESULTLIST);
  assert.equal(event.name, 'Testtävlingen');
  assert.equal(event.date, '2026-08-06');
  assert.equal(results.length, 6); // se fixturens huvudkommentar

  const anna = results.find((r) => r.card === 123456);
  assert.equal(anna.name, 'Anna Andersson');
  assert.equal(anna.club, 'OK Skogen');
  assert.equal(anna.className, 'H21');
  assert.equal(anna.status, 'OK');
  assert.equal(anna.st, 360000);   // 10:00:00 i tiondelar sedan midnatt
  assert.equal(anna.rt, 21000);    // 2100 s -> tiondelar
  assert.equal(anna.splits.length, 5);
  assert.deepEqual(anna.splits[0], { code: 31, rt: 4500, status: 'ok' });
  // Extra stämplingar ligger sist i filen, i MeOS egen ordning.
  assert.deepEqual(anna.splits[4], { code: 77, rt: 10000, status: 'additional' });

  const carl = results.find((r) => r.card === 111111);
  assert.equal(carl.status, 'MissingPunch');
  const missing = carl.splits.find((s) => s.code === 45);
  assert.deepEqual(missing, { code: 45, rt: 0, status: 'missing' });
});

// ---------------------------------------------------------------------------
// Sammanslagning och kvitto (KRAV-9, KRAV-10)
// ---------------------------------------------------------------------------

async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

async function post(base, url, xml, headers = {}) {
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1', ...headers },
    body: xml,
  });
  return res.text();
}

test('IOF-fil kompletterar MOP-data: alla stämplingar på kvittot', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.deepEqual(
    r.splits.map((s) => s.name),
    ['31', '32', '77', '45', '50', 'Mål']
  );
  assert.equal(r.splits[2].status, 'additional');
  assert.equal(r.splits[0].elapsed, '7:30');
  assert.equal(r.splits[0].clock, '10:07:30');
  // Extra stämplingen sorteras in kronologiskt och sträcktiderna följer med
  assert.equal(r.splits[2].leg, '1:40'); // 77: 1000 s - 900 s
  assert.equal(r.splits[3].leg, '5:50'); // 45: 1350 s - 1000 s
  assert.equal(r.splits[5].leg, '5:00'); // Mål: 2100 s - 1800 s
  // MOP-data ska inte skrivas över
  assert.equal(r.result.statusText, 'Godkänd');
  assert.equal(r.result.place, 2);
});

// KRAV-10: MeOS exporterar hela banan som Missing för den som brutit utan att
// stämpla. En tabell med enbart streck säger löparen ingenting – då ska
// sträcktabellen utelämnas helt. Har någon kontroll en tid visas den som vanligt.
test('utgått utan stämplingar ger ingen sträcktabell', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=222222`)).json();
  assert.equal(r.result.statusText, 'Utgått');
  assert.deepEqual(r.splits, [], 'en tabell med bara streck ska inte visas');
  assert.equal(r.result.startTime, '10:00:00', 'löparen startade faktiskt');
});

test('utgått efter några kontroller behåller sina stämplingar', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=555555`)).json();
  assert.equal(r.result.statusText, 'Utgått');
  assert.deepEqual(r.splits.map((s) => s.name), ['31', '32', '45']);
  assert.equal(r.splits[0].elapsed, '7:00');
  assert.equal(r.splits[2].status, 'missing');
  assert.equal(r.splits.at(-1).name, '45', 'ingen målrad utan måltid');
});

// KRAV-10: en gammal stämpling i brickan (eller en kontrollenhet med fel
// klocka) ger en sträcktid långt utanför loppet. Den ska inte visas som tid,
// och nästa sträcka ska räknas från föregående giltiga stämpling – annars
// blir både den raden och nästa obrukbara. I den skarpa Vinterrace-filen
// drabbade det 40 av 110 löpare.
test('stämplingstid utanför loppet ignoreras utan att förstöra nästa sträcka', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=666666`)).json();
  assert.equal(r.result.statusText, 'Godkänd');
  assert.deepEqual(r.splits.map((s) => s.name), ['31', '32', '45', '50', 'Mål']);

  const trasig = r.splits[1];
  assert.equal(trasig.elapsed, '', 'tiden ligger utanför loppet');
  assert.equal(trasig.leg, '');
  assert.equal(trasig.clock, '');

  // Nästa kontroll räknas från 31 (300 s), inte från den trasiga tiden
  assert.equal(r.splits[2].leg, '10:00');   // 900 - 300
  assert.equal(r.splits[2].elapsed, '15:00');
  assert.equal(r.splits[3].leg, '10:00');   // 1500 - 900
  assert.equal(r.splits.at(-1).leg, '5:00'); // Mål: 1800 - 1500
});

test('IOF-fil fyller i status och måltid för löpare utan MOP-resultat', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await post(base, '/meos', MOP_COMPLETE);
  await post(base, '/iof', IOF_RESULTLIST);

  // Carl var "på banan" i MOP (stat=0) men felstämplad enligt resultatfilen
  const r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(r.result.statusText, 'Felstämplad');
  assert.equal(r.result.startTime, '10:20:00');
  assert.equal(r.result.finishTime, '10:50:00');
  const missing = r.splits.find((s) => s.name === '45');
  assert.equal(missing.status, 'missing');
  assert.equal(missing.elapsed, '');
});

test('IOF-fil skapar löpare som saknas i MOP-datat', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await post(base, '/meos', MOP_COMPLETE);
  await post(base, '/iof', IOF_RESULTLIST);

  const res = await fetch(`${base}/api/receipt?card=333333`);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.runner.name, 'Frida Frisk');
  assert.equal(r.runner.club, 'OK Skogen');
  assert.equal(r.runner.class, 'D21');
  assert.equal(r.result.statusText, 'Godkänd');
});

test('IOF-endpoint kräver rätt lösenord', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());
  assert.equal(await post(base, '/iof', IOF_RESULTLIST, { pwd: 'fel' }), 'BADPWD');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST, { pwd: 'hemligt' }), 'OK');
});
