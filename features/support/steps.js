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
  mopCompleteManyRunners,
} from '../../test/fixtures/mop.js';
import { IOF_RESULTLIST } from '../../test/fixtures/iof.js';
import { createMailer } from '../../lib/mailer.js';

setDefaultTimeout(10000);

// ---------------------------------------------------------------------------
// Världen: en serverinstans per scenario.
// ---------------------------------------------------------------------------

async function start(world, opts = {}) {
  await stop(world);
  world.appOpts = opts;
  const app = createApp(opts);
  world.app = app;
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

Given('att tjänsten är igång med datalagring utan gallring', async function () {
  this.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-bdd-'));
  await start(this, { dataDir: this.dataDir, saveDelayMs: 10, retentionDays: 0 });
});

/**
 * Fejkad SMTP-transport: samlar mejlen i minnet i stället för att skicka dem.
 * Inget scenario får nå en riktig e-postserver.
 */
function fakeMailer(world, { failing = false } = {}) {
  world.sent = [];
  return createMailer({
    from: 'Digitalt kvitto <kvitto@example.test>',
    transport: {
      async sendMail(message) {
        if (failing) throw new Error('SMTP 535 Authentication failed for user postmaster@…');
        world.sent.push(message);
        return { messageId: `test-${world.sent.length}` };
      },
    },
  });
}

Given('att tjänsten är igång med e-postutskick', async function () {
  await start(this, { mailer: fakeMailer(this) });
});

Given('att tjänsten är igång utan e-postutskick', async function () {
  this.sent = [];
  await start(this, { mailer: null });
});

Given('att tjänsten är igång med e-postutskick som misslyckas', async function () {
  await start(this, { mailer: fakeMailer(this, { failing: true }) });
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

Given('att MeOS har skickat en tävling med {int} löpare', async function (n) {
  assert.equal(await postMop(this, mopCompleteManyRunners(n), { competition: '3' }), 'OK');
});

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

Given('att all data har sparats till disk', function () {
  // Steget väntade förut på att filen skulle dyka upp. Att den finns är inte
  // samma sak som att den är aktuell: fanns den sedan en tidigare sparning
  // återvände steget genast, med gammalt innehåll, och en efterföljande
  // omstart läste fel data. flush() skriver det som väntar, nu.
  this.app.locals.store.flush();
  const file = path.join(this.dataDir, 'competitions.json');
  assert.ok(fs.existsSync(file), `${file} skrevs inte – nådde data aldrig lagret?`);
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

When(
  'MeOS skickar en diff där {string} med bricka {int} anmäls i klassen {string}',
  async function (name, card, clsName) {
    const cls = clsName === 'D21' ? 2 : 1;
    // Eget id, som MeOS skulle ge en efteranmäld löpare
    await postMop(this, mopDiffExtraRunner({ id: 55, name, card, cls }));
  }
);

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

When('jag laddar ner kvittot som PDF för bricka {int}', async function (card) {
  const res = await fetch(`${this.base}/api/receipt.pdf?card=${card}`);
  this.pdf = {
    status: res.status,
    type: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition') || '',
    body: Buffer.from(await res.arrayBuffer()),
  };
});

async function postEmail(world, card, email) {
  const res = await fetch(`${world.base}/api/receipt/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ card, email }),
  });
  return { status: res.status, body: await res.json() };
}

When('jag mejlar kvittot för bricka {int} till {string}', async function (card, email) {
  this.mail = await postEmail(this, card, email);
});

When('jag mejlar kvittot för bricka {int} till {int} olika adresser', async function (card, n) {
  this.mails = [];
  for (let i = 1; i <= n; i++) {
    this.mails.push(await postEmail(this, card, `loparen${i}@example.org`));
  }
});

When('jag söker på {string}', async function (q) {
  await getJson(this, `/api/search?q=${encodeURIComponent(q)}`);
});

When('tjänsten startas om med samma datalagring', async function () {
  await start(this, this.appOpts);
});

// Gallringen (KRAV-14) testas genom att flytta fram klockan i stället för att
// vänta – store:t läser tiden via now().
When('tjänsten startas om {int} dagar senare', async function (days) {
  const offset = days * 24 * 60 * 60 * 1000;
  await start(this, { ...this.appOpts, now: () => Date.now() + offset });
});

When('tjänsten startas om utan tidsförskjutning', async function () {
  // Gallringen sparas debouncat. Steget väntade förut en fast stund på att
  // skrivningen skulle hinna – och på en belastad maskin hann den inte, varpå
  // omstarten läste en fil som ännu hade kvar den gallrade tävlingen. Det var
  // orsaken till att sviten föll ibland utan att något var sönder.
  //
  // flush() skriver det som väntar, nu. Den skriver bara om något faktiskt
  // väntar, så scenariot prövar fortfarande att gallringen schemalägger en
  // sparning – det är bara väntan som försvinner.
  this.app.locals.store.flush();
  await start(this, { ...this.appOpts, now: undefined });
});

// ---------------------------------------------------------------------------
// Så
// ---------------------------------------------------------------------------

/**
 * Plockar ut den synliga texten ur en PDF byggd av lib/pdf.js: strömmarna är
 * okomprimerade, så textliteralerna före `Tj` går att läsa direkt (latin1).
 */
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const out = [];
  for (const m of raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    out.push(m[1].replace(/\\([\\()])/g, '$1'));
  }
  return out.join('\n');
}

Then('får jag en PDF-fil', function () {
  assert.equal(this.pdf.status, 200);
  assert.match(this.pdf.type, /application\/pdf/);
  assert.equal(this.pdf.body.subarray(0, 5).toString(), '%PDF-');
  assert.match(this.pdf.body.subarray(-8).toString(), /%%EOF/);
  assert.match(this.pdf.disposition, /^attachment; filename=/);
});

Then('filnamnet innehåller {string}', function (part) {
  assert.ok(
    this.pdf.disposition.includes(part),
    `${part} saknas i Content-Disposition: ${this.pdf.disposition}`
  );
});

Then('PDF:en innehåller texten {string}', function (text) {
  const content = pdfText(this.pdf.body);
  assert.ok(content.includes(text), `"${text}" saknas i PDF-texten:\n${content}`);
});

Then('blir PDF-svaret {int}', function (code) {
  assert.equal(this.pdf.status, code);
});

Then('blir mejlsvaret {int}', function (code) {
  assert.equal(this.mail.status, code, JSON.stringify(this.mail.body));
});

Then('skickas ett mejl till {string}', function (to) {
  assert.equal(this.sent.length, 1, `förväntade 1 mejl, fick ${this.sent.length}`);
  assert.equal(this.sent[0].to, to);
});

Then('mejlet har en PDF-bilaga', function () {
  const [attachment] = this.sent[0].attachments || [];
  assert.ok(attachment, 'mejlet saknar bilaga');
  assert.equal(attachment.contentType, 'application/pdf');
  assert.match(attachment.filename, /\.pdf$/);
  assert.equal(attachment.content.subarray(0, 5).toString(), '%PDF-');
});

Then('mejlets ämne innehåller {string}', function (text) {
  assert.ok(this.sent[0].subject.includes(text), `ämnet var: ${this.sent[0].subject}`);
});

Then('skickas inga mejl', function () {
  assert.equal(this.sent.length, 0, `${this.sent.length} mejl skickades ändå`);
});

Then('blir minst ett av svaren {int}', function (code) {
  const koder = this.mails.map((m) => m.status);
  assert.ok(koder.includes(code), `ingen ${code} bland ${koder.join(', ')}`);
});

Then('skickas färre än {int} mejl', function (n) {
  assert.ok(this.sent.length < n, `${this.sent.length} mejl skickades`);
});

Then('innehåller felmeddelandet inte {string}', function (text) {
  const body = JSON.stringify(this.mail.body);
  assert.ok(!body.includes(text), `felmeddelandet läckte "${text}": ${body}`);
});

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

Then('kvittot visar ingen starttid', function () {
  assert.equal(this.res.body.result.startTime, '');
});

Then('kvittot innehåller inga stämplingar', function () {
  assert.deepEqual(this.res.body.splits, []);
});

Then('stämplingen {string} saknar tider', function (name) {
  const split = this.res.body.splits.find((s) => s.name === name);
  assert.ok(split, `stämplingen ${name} saknas i kvittot`);
  assert.equal(split.leg, '', 'en tid utanför loppet ska inte visas som sträcktid');
  assert.equal(split.elapsed, '');
  assert.equal(split.clock, '');
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

Then('blir svaret 400 med ett felmeddelande', function () {
  assert.equal(this.res.status, 400, JSON.stringify(this.res.body));
  assert.ok(this.res.body.error);
});

Then('felmeddelandet nämner antalet träffar', function () {
  assert.match(this.res.body.error, /\d+/, `felmeddelandet saknar antal: ${this.res.body.error}`);
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

Then(
  'innehåller kvittot för bricka {int} stämplingarna {string}',
  async function (card, names) {
    const { status, body } = await getJson(this, `/api/receipt?card=${card}`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(
      body.splits.map((s) => s.name),
      names.split(',').map((s) => s.trim())
    );
  }
);

Then('visar kvittot för bricka {int} löparen {string}', async function (card, name) {
  const { status, body } = await getJson(this, `/api/receipt?card=${card}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.runner.name, name);
});
