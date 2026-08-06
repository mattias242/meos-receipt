import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

const MOP_COMPLETE = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <competition date="2026-08-06" organizer="Testklubben OK" homepage="https://example.org">Testtävlingen</competition>
  <ctrl id="150">Radio 1</ctrl>
  <ctrl id="162">Förvarning</ctrl>
  <cls id="1" ord="1" radio="150,162">H21</cls>
  <cls id="2" ord="2">D21</cls>
  <org id="5" nat="SWE">OK Skogen</org>
  <cmp id="31" card="123456">
    <base org="5" cls="1" stat="1" st="360000" rt="21000" bib="12">Anna Andersson</base>
    <radio>150,9000;162,18000</radio>
  </cmp>
  <cmp id="32" card="654321">
    <base org="5" cls="1" stat="1" st="366000" rt="19500">Berit Bengtsson</base>
    <radio>150,8500;162,17000</radio>
  </cmp>
  <cmp id="33" card="111111">
    <base org="5" cls="1" stat="0" st="372000" rt="0">Carl Carlsson</base>
  </cmp>
  <cmp id="34" card="222222">
    <base org="5" cls="2" stat="4" st="360000" rt="0">Doris Dahl</base>
  </cmp>
</MOPComplete>`;

const MOP_DIFF = `<?xml version="1.0" encoding="UTF-8"?>
<MOPDiff xmlns="http://www.melin.nu/mop">
  <cmp id="33" card="111111">
    <base org="5" cls="1" stat="1" st="372000" rt="18000" prel="true">Carl Carlsson</base>
    <radio>150,8000;162,16000</radio>
  </cmp>
</MOPDiff>`;

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

test('MOPComplete replaces earlier data for the competition', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  await postMop(base, MOP_COMPLETE.replace('Testtävlingen', 'Omstartad tävling'));

  const list = await (await fetch(`${base}/api/competitions`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Omstartad tävling');
});
