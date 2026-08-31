/**
 * KRAV-25 sett från kvittot: att bomtiden hamnar på rätt rad, att den bygger
 * på rätt underlag, och att kvittot säger ifrån när underlaget inte räcker.
 *
 * Algoritmen själv prövas naken i test/bomtid.test.js. Här prövas kopplingen
 * till MeOS-datamodellen – det är där felen sitter: vilka löpare som får
 * bidra, vilka stämplingar som duger, och hur sträckorna nycklas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt } from '../lib/receipt.js';

const BANA = [31, 32, 45, 50];

/** Kumulativa stämplingstider i tiondelar ur sträcktider i sekunder. */
function stamplingar(strackor, koder = BANA) {
  let cum = 0;
  return koder.map((code, i) => {
    cum += strackor[i] * 10;
    return { code, rt: cum, status: 'ok' };
  });
}

const BASLINJE = [60, 120, 180, 90];
const SLUTSTRACKA = 60;
const total = (strackor) => (strackor.reduce((a, b) => a + b, 0) + SLUTSTRACKA) * 10;

/** En tävling med en klass där varje löpare beskrivs av sina sträcktider. */
function tavling(lopare) {
  const competitors = {};
  lopare.forEach((l, i) => {
    competitors[10 + i] = {
      name: l.name,
      card: 900000 + i,
      cls: 3,
      org: 5,
      stat: l.stat ?? 1,
      st: 360000,
      rt: l.rt ?? total(l.strackor),
      punches: l.punches ?? stamplingar(l.strackor, l.koder),
    };
  });
  return {
    info: { name: 'Bomtävlingen', date: '2026-08-20', organizer: 'UOK' },
    controls: {},
    classes: { 3: { name: 'H21' } },
    orgs: { 5: { name: 'UOK' } },
    teams: {},
    competitors,
    updated: '2026-08-20T10:00:00.000Z',
  };
}

const referens = (name) => ({ name, strackor: BASLINJE });
const lossFor = (r, control) => r.splits.find((s) => s.control === control)?.loss;

test('bomtiden hamnar på raden för den kontroll sträckan slutar vid', () => {
  const cmp = tavling([
    referens('Rakel'),
    referens('Rune'),
    { name: 'Bosse', strackor: [60, 120, 360, 90] },
  ]);
  const r = buildReceipt(cmp, 'bom', 12);

  assert.equal(r.timeLoss.available, true);
  assert.equal(lossFor(r, 45), '2:37', 'bommen låg på sträckan 32 -> 45');
  assert.equal(lossFor(r, 31), '');
  assert.equal(lossFor(r, 32), '');
  assert.equal(lossFor(r, 50), '');
  assert.equal(r.timeLoss.total, '2:37');
});

test('en jämnt långsam löpare får inga bomtider', () => {
  const cmp = tavling([
    referens('Rakel'),
    referens('Rune'),
    { name: 'Lena', strackor: BASLINJE.map((t) => t * 1.5), rt: total(BASLINJE) * 1.5 },
  ]);
  const r = buildReceipt(cmp, 'bom', 12);
  assert.deepEqual(r.splits.map((s) => s.loss), ['', '', '', '', '']);
  assert.equal(r.timeLoss.total, '');
});

/**
 * Underlaget till baslinjen är med flit ett annat än placeringens: en
 * felstämplad löpares enskilda sträcktider är fullgoda data, och i en klass om
 * fem halveras underlaget om de kastas. Testet bevisar att de räknas med
 * genom att låta två felstämplade vara de enda som kan sätta baslinjen.
 */
test('felstämplade och utgångna bidrar till klassens baslinje', () => {
  const felstämplad = (name) => ({
    name,
    stat: 3,
    strackor: BASLINJE,
    punches: stamplingar(BASLINJE).map((p) => (p.code === 50 ? { ...p, status: 'missing', rt: 0 } : p)),
    rt: total(BASLINJE),
  });
  const cmp = tavling([
    felstämplad('Frida'),
    { ...felstämplad('Fia'), stat: 4 },
    { name: 'Bosse', strackor: [60, 120, 360, 90] },
  ]);
  const r = buildReceipt(cmp, 'bom', 12);
  assert.equal(r.timeLoss.available, true, 'de två med anmärkning ska räknas som underlag');
  assert.ok(lossFor(r, 45), 'utan deras sträcktider finns ingen baslinje att jämföra mot');
});

test('en klass med för få löpare får ingen analys men en förklaring', () => {
  const cmp = tavling([referens('Rakel'), { name: 'Bosse', strackor: [60, 120, 360, 90] }]);
  const r = buildReceipt(cmp, 'bom', 11);

  assert.equal(r.timeLoss.available, false);
  assert.equal(r.timeLoss.total, '');
  assert.match(r.notes.timeLoss, /Underlag saknas/);
  assert.deepEqual(r.splits.map((s) => s.loss), ['', '', '', '', '']);
});

/**
 * Radioflödet: ett par radiokontroller ger sträckor på en kvart, där en bom på
 * tjugo sekunder inte går att se. Ingen analys – och ingen ursäkt heller, för
 * den hade stått under varje kvitto på den vanligaste konfigurationen.
 */
test('ett kvitto med bara radiotider får varken analys eller notering', () => {
  const cmp = {
    info: { name: 'Radiotävlingen', date: '2026-08-20', organizer: 'UOK' },
    controls: {},
    classes: { 3: { name: 'H21' } },
    orgs: { 5: { name: 'UOK' } },
    teams: {},
    competitors: Object.fromEntries(
      [0, 1, 2, 3].map((i) => [
        10 + i,
        {
          name: `Löpare ${i}`, card: 900100 + i, cls: 3, org: 5, stat: 1, st: 360000,
          rt: 21000 + i * 3000,
          radios: [{ ctrl: 150, rt: 9000 }, { ctrl: 162, rt: 18000 + i * 2000 }],
        },
      ])
    ),
    updated: '2026-08-20T10:00:00.000Z',
  };
  const r = buildReceipt(cmp, 'radio', 11);
  assert.equal(r.timeLoss.available, false);
  assert.equal(r.notes.timeLoss, undefined, 'ingen ursäkt när analysen ändå vore meningslös');
});

/**
 * En opålitlig tid (KRAV-10) får varken egen bomtid eller sätta baslinjen.
 * Det andra är lätt att glömma, eftersom den slingan går över ANDRA löpare –
 * och en kontrollenhet med fel klocka drabbar alla som passerar den.
 */
test('en opålitlig stämpling utesluts ur både egen analys och andras baslinje', () => {
  const medFelKlocka = (name) => ({
    name,
    strackor: BASLINJE,
    // Kontroll 32 har en tid långt utanför loppet – rimlighetsprövningen
    // fäller den, och sträckorna 31>32 och 32>45 försvinner med den.
    punches: stamplingar(BASLINJE).map((p) => (p.code === 32 ? { ...p, rt: 999999 } : p)),
    rt: total(BASLINJE),
  });
  const cmp = tavling([
    medFelKlocka('Olle'),
    medFelKlocka('Otto'),
    referens('Rakel'),
    { name: 'Bosse', strackor: [60, 120, 360, 90] },
  ]);

  const olle = buildReceipt(cmp, 'bom', 10);
  assert.equal(lossFor(olle, 32), '', 'en tid som inte går att lita på ger ingen bomtid');

  // Rakel och Bosse är de enda med en giltig tid på 32>45. Hade Olles och
  // Ottos orimliga tider fått vara med hade baslinjen dragits iväg.
  const bosse = buildReceipt(cmp, 'bom', 13);
  assert.equal(lossFor(bosse, 45), '2:37', 'baslinjen ska bara byggas av tider som duger');
});

/**
 * Sträckan över en saknad kontroll spänner över två sträckor och nycklas på
 * föregående giltiga kontroll. Nästan ingen annan har den nyckeln, så den får
 * ingen baslinje – och därmed ingen falsk bomtid. Det är den mest sannolika
 * källan till ett absurt tal på ett skarpt kvitto.
 */
test('sträckan över en saknad kontroll ger ingen falsk bomtid', () => {
  const utan45 = stamplingar([60, 300, 180, 90]).map((p) =>
    p.code === 45 ? { code: 45, rt: 0, status: 'missing' } : p
  );
  const cmp = tavling([
    referens('Rakel'),
    referens('Rune'),
    { name: 'Frida', stat: 3, strackor: [60, 300, 180, 90], punches: utan45, rt: total([60, 300, 180, 90]) },
  ]);
  const r = buildReceipt(cmp, 'bom', 12);

  assert.equal(lossFor(r, 45), '', 'en saknad kontroll har ingen sträcktid att bomma på');
  assert.equal(lossFor(r, 50), '', 'sträckan över hålet får ingen baslinje och därmed ingen bom');
  assert.ok(lossFor(r, 32), 'den långsamma sträckan hon HAR tid på ska analyseras');
});

/**
 * Gaffling: två löpare i samma klass springer olika kontroller mitt på banan.
 * Nycklas sträckorna på radindex jämförs deras tredje sträckor med varandra
 * trots att de är olika sträckor i skogen.
 */
test('gafflade sträckor jämförs inte med dem som sprungit en annan sträcka', () => {
  const cmp = tavling([
    referens('Rakel'),
    referens('Rune'),
    referens('Rita'),
    { name: 'Gunnar', strackor: [60, 120, 400, 100], koder: [31, 32, 77, 50], rt: total([60, 120, 400, 100]) },
  ]);
  const r = buildReceipt(cmp, 'bom', 13);
  assert.equal(lossFor(r, 77), '', 'ingen annan har sprungit 32 -> 77');
  assert.equal(r.timeLoss.total, '');
});
