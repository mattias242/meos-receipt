import { Given, When, Then, After, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server.js';
import {
  MOP_COMPLETE,
  MOP_DIFF_CARL,
  mopDiffExtraRunner,
  mopCompleteMinimal,
} from '../../test/fixtures/mop.js';
import { IOF_RESULTLIST } from '../../test/fixtures/iof.js';

setDefaultTimeout(10000);

// ---------------------------------------------------------------------------
// Världen: en serverinstans per scenario.
// ---------------------------------------------------------------------------

async function start(world, opts = {}) {
  await stop(world);
  world.appOpts = opts;
  const app = createApp(opts);
  world.server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  world.base = `http://127.0.0.1:${world.server.address().port}`;
}

async function stop(world) {
  if (world.server) {
    await new Promise((resolve) => world.server.close(resolve));
    world.server = null;
  }
}

async function postXml(world, url, xml, headers = {}) {
  const res = await fetch(`${world.base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1', ...headers },
    body: xml,
  });
  world.reply = await res.text();
  return world.reply;
}

const postMop = (world, xml, headers) => postXml(world, '/meos', xml, headers);
const postIof = (world, xml, headers) => postXml(world, '/iof', xml, headers);

async function getJson(world, url) {
  const res = await fetch(`${world.base}${url}`);
  world.res = { status: res.status, body: await res.json() };
  return world.res;
}

After(async function () {
  await stop(this);
  if (this.dataDir) {
    fs.rmSync(this.dataDir, { recursive: true, force: true });
    this.dataDir = null;
  }
});

// ---------------------------------------------------------------------------
// Givet
// ---------------------------------------------------------------------------

Given('att tjänsten är igång', async function () {
  await start(this);
});

Given('att tjänsten kräver lösenordet {string}', async function (pwd) {
  await start(this, { password: pwd });
});

Given('att tjänsten är igång med datalagring', async function () {
  this.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-bdd-'));
  await start(this, { dataDir: this.dataDir, saveDelayMs: 10 });
});

Given('att MeOS har skickat en komplett tävling med tävlings-id {int}', async function (cmp) {
  assert.equal(await postMop(this, MOP_COMPLETE, { competition: String(cmp) }), 'OK');
});

Given(
  'att MeOS har skickat en komplett tävling med tävlings-id {int}, namnet {string} och datumet {string} utan löpare',
  async function (cmp, name, date) {
    const xml = mopCompleteMinimal({ name, date });
    assert.equal(await postMop(this, xml, { competition: String(cmp) }), 'OK');
  }
);

Given('att MeOS har skickat en diff där {string} går i mål', async function (name) {
  assert.ok(MOP_DIFF_CARL.includes(name), `fixturen saknar ${name}`);
  assert.equal(await postMop(this, MOP_DIFF_CARL), 'OK');
});

Given(
  'att MeOS har skickat en diff där {string} med bricka {int} anmäls i klassen {string}',
  async function (name, card, clsName) {
    const cls = clsName === 'D21' ? 2 : 1;
    assert.equal(await postMop(this, mopDiffExtraRunner({ name, card, cls })), 'OK');
  }
);

Given('att all data har sparats till disk', async function () {
  const file = path.join(this.dataDir, 'competitions.json');
  const deadline = Date.now() + 500;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) {
      throw new Error(`${file} skrevs inte inom 500 ms`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
});

Given('att resultatautomaten har laddat upp en resultatfil', async function () {
  assert.equal(await postIof(this, IOF_RESULTLIST), 'OK');
});

// ---------------------------------------------------------------------------
// När
// ---------------------------------------------------------------------------

When('resultatautomaten laddar upp en resultatfil', async function () {
  await postIof(this, IOF_RESULTLIST);
});

When('resultatautomaten laddar upp en resultatfil med lösenordet {string}', async function (pwd) {
  await postIof(this, IOF_RESULTLIST, { pwd });
});

When('MeOS skickar en komplett tävling med tävlings-id {int}', async function (cmp) {
  await postMop(this, MOP_COMPLETE, { competition: String(cmp) });
});

When('MeOS skickar en komplett tävling utan tävlings-id', async function () {
  await postMop(this, MOP_COMPLETE, { competition: '' });
});

When('MeOS skickar en komplett tävling med lösenordet {string}', async function (pwd) {
  await postMop(this, MOP_COMPLETE, { pwd });
});

When('MeOS skickar zip-komprimerad data', async function () {
  await postMop(this, 'PK\x03\x04zipdata');
});

When('MeOS skickar en diff där {string} går i mål', async function (name) {
  assert.ok(MOP_DIFF_CARL.includes(name), `fixturen saknar ${name}`);
  await postMop(this, MOP_DIFF_CARL);
});

When(
  'MeOS skickar en komplett tävling med tävlings-id {int} och namnet {string}',
  async function (cmp, name) {
    await postMop(this, MOP_COMPLETE.replace('Testtävlingen', name), { competition: String(cmp) });
  }
);

When('jag hämtar kvittot för bricka {int}', async function (card) {
  await getJson(this, `/api/receipt?card=${card}`);
});

When('jag söker på {string}', async function (q) {
  await getJson(this, `/api/search?q=${encodeURIComponent(q)}`);
});

When('tjänsten startas om med samma datalagring', async function () {
  await start(this, this.appOpts);
});

// ---------------------------------------------------------------------------
// Så
// ---------------------------------------------------------------------------

Then('blir svaret {string}', function (expected) {
  assert.equal(this.reply, expected);
});

Then('tävlingen {string} finns i tävlingslistan', async function (name) {
  const { body } = await getJson(this, '/api/competitions');
  assert.ok(body.some((c) => c.name === name), `${name} saknas i ${JSON.stringify(body)}`);
});

Then(/^finns exakt (\d+) tävling(?:ar)? i tävlingslistan$/, async function (n) {
  const { body } = await getJson(this, '/api/competitions');
  assert.equal(body.length, Number(n));
});

Then('kvittot för bricka {int} visar status {string}', async function (card, status) {
  const { status: code, body } = await getJson(this, `/api/receipt?card=${card}`);
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.result.statusText, status);
});

Then(
  'visar kvittot löparen {string} i klubben {string} och klassen {string}',
  function (name, club, cls) {
    assert.equal(this.res.status, 200, JSON.stringify(this.res.body));
    assert.equal(this.res.body.runner.name, name);
    assert.equal(this.res.body.runner.club, club);
    assert.equal(this.res.body.runner.class, cls);
  }
);

Then('kvittot visar status {string}', checkStatus);
Then('visar kvittot status {string}', checkStatus);
function checkStatus(status) {
  assert.equal(this.res.body.result.statusText, status);
}

Then('kvittot visar löptiden {string}', function (time) {
  assert.equal(this.res.body.result.time, time);
});

Then('kvittot visar ingen löptid', function () {
  assert.equal(this.res.body.result.time, '');
});

Then('kvittot visar starttid {string} och måltid {string}', function (st, ft) {
  assert.equal(this.res.body.result.startTime, st);
  assert.equal(this.res.body.result.finishTime, ft);
});

Then(
  'kvittot visar placering {int} med tiden {string} efter segraren',
  function (place, after) {
    assert.equal(this.res.body.result.place, place);
    assert.equal(this.res.body.result.after, after);
  }
);

Then('innehåller kvittot sträckorna {string}', function (names) {
  const expected = names.split(',').map((s) => s.trim());
  assert.deepEqual(this.res.body.splits.map((s) => s.name), expected);
});

Then(
  'sträckan {string} har sträcktid {string}, totaltid {string} och klocktid {string}',
  function (name, leg, elapsed, clock) {
    const split = this.res.body.splits.find((s) => s.name === name);
    assert.ok(split, `sträckan ${name} saknas`);
    assert.equal(split.leg, leg);
    assert.equal(split.elapsed, elapsed);
    assert.equal(split.clock, clock);
  }
);

Then('innehåller kvittot stämplingarna {string}', function (names) {
  const expected = names.split(',').map((s) => s.trim());
  assert.deepEqual(this.res.body.splits.map((s) => s.name), expected);
});

Then('stämplingen {string} är markerad som saknad', function (name) {
  const split = this.res.body.splits.find((s) => s.name === name);
  assert.ok(split, `stämplingen ${name} saknas i kvittot`);
  assert.equal(split.status, 'missing');
  assert.equal(split.elapsed, '', 'en saknad stämpling ska inte ha någon tid');
});

Then('stämplingen {string} är markerad som extra', function (name) {
  const split = this.res.body.splits.find((s) => s.name === name);
  assert.ok(split, `stämplingen ${name} saknas i kvittot`);
  assert.equal(split.status, 'additional');
});

Then('kvittot är markerat som preliminärt', function () {
  assert.equal(this.res.body.result.preliminary, true);
});

Then('kvittot visar preliminär placering {int}', function (place) {
  assert.equal(this.res.body.result.prelPlace, place);
  assert.equal(this.res.body.result.place, null);
});

Then('kvittot gäller tävlingen {string}', function (name) {
  assert.equal(this.res.body.competition.name, name);
});

Then('blir svaret 404 med ett felmeddelande', function () {
  assert.equal(this.res.status, 404);
  assert.ok(this.res.body.error);
});

Then('blir svaret en träfflista med {int} löpare', function (n) {
  assert.equal(this.res.status, 300, JSON.stringify(this.res.body));
  assert.equal(this.res.body.alternatives?.length, n);
});

Then('träfflistan innehåller {string} och {string}', function (a, b) {
  const names = this.res.body.alternatives.map((h) => h.name);
  assert.ok(names.includes(a), `${a} saknas i ${names}`);
  assert.ok(names.includes(b), `${b} saknas i ${names}`);
});

Then(/^får jag (\d+) träff(?:ar)?$/, function (n) {
  assert.equal(this.res.status, 200);
  assert.equal(this.res.body.length, Number(n));
});

Then(
  'träffen visar {string} i klubben {string} och klassen {string} med bricka {int}',
  function (name, club, cls, card) {
    const hit = this.res.body[0];
    assert.equal(hit.name, name);
    assert.equal(hit.club, club);
    assert.equal(hit.class, cls);
    assert.equal(hit.card, card);
  }
);

Then('visar kvittot för bricka {int} löparen {string}', async function (card, name) {
  const { status, body } = await getJson(this, `/api/receipt?card=${card}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.runner.name, name);
});
