import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

/**
 * KRAV-8: tävlingarna hålls inte i minnet allihop.
 *
 * Uppmätt på 90 dagars data med stämplingar: allt inne kostade 40 MB heap,
 * medan det som behövs för att svara på sökning och brickuppslag – namn och
 * bricknummer – kostar 17 MB. Skillnaden är stämplingarna, och de behövs bara
 * när ett kvitto faktiskt ska byggas.
 *
 * Registret svarar alltså på "vilken tävling och vilka löpare", och tävlingens
 * fil läses in först när svaret kräver den.
 */

function medData(tavlingar) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-lat-'));
  const skapare = createStore({ dataDir: dir, saveDelayMs: 60000 });
  for (const [cid, { namn, datum, lopare }] of Object.entries(tavlingar)) {
    const cmp = skapare.getCompetition(cid);
    cmp.info.name = namn;
    cmp.info.date = datum;
    for (const [id, l] of Object.entries(lopare)) cmp.competitors[id] = l;
    skapare.touch(cid);
  }
  skapare.flush();
  return dir;
}

const DATA = {
  1: { namn: 'Vårserien', datum: '2026-06-01', lopare: { 31: { name: 'Anna Andersson', card: 123456 }, 32: { name: 'Berit Bengtsson', card: 222222 } } },
  4: { namn: 'Höstserien', datum: '2026-09-01', lopare: { 31: { name: 'Carl Carlsson', card: 333333 } } },
};

test('inget läses in vid start', () => {
  const store = createStore({ dataDir: medData(DATA), saveDelayMs: 60000 });
  assert.deepEqual(
    Object.keys(store.competitions),
    [],
    'tävlingarna ska ligga kvar på disk tills någon frågar efter dem'
  );
});

test('tävlingslistan svarar ur registret, utan att läsa in något', () => {
  const store = createStore({ dataDir: medData(DATA), saveDelayMs: 60000 });
  assert.deepEqual(
    store.listCompetitions().map((c) => `${c.id}:${c.name}`),
    ['4:Höstserien', '1:Vårserien'],
    'nyast först, som förut'
  );
  assert.deepEqual(Object.keys(store.competitions), [], 'listan får inte kosta en inläsning');
});

test('en sökning utan träff läser ingen fil', () => {
  const store = createStore({ dataDir: medData(DATA), saveDelayMs: 60000 });
  assert.deepEqual(store.tavlingarMedTraff('Zebror'), []);
  assert.deepEqual(
    Object.keys(store.competitions),
    [],
    'en miss går igenom hela databasen – den får inte läsa in den'
  );
});

test('en sökning med träff pekar ut tävlingen, nyast först', () => {
  const store = createStore({ dataDir: medData(DATA), saveDelayMs: 60000 });
  assert.deepEqual(store.tavlingarMedTraff('anna'), [1]);
  // "ss" finns i Andersson, Bengtsson och Carlsson – alltså i båda tävlingarna
  assert.deepEqual(store.tavlingarMedTraff('ss'), [4, 1], 'nyaste tävlingen först');
});

test('brickuppslag pekar ut tävlingen utan inläsning', () => {
  const store = createStore({ dataDir: medData(DATA), saveDelayMs: 60000 });
  assert.deepEqual(store.tavlingarMedBricka(222222), [1]);
  assert.deepEqual(store.tavlingarMedBricka(999999), []);
  assert.deepEqual(Object.keys(store.competitions), []);
});

test('hamta läser in tävlingen först när den behövs', () => {
  const store = createStore({ dataDir: medData(DATA), saveDelayMs: 60000 });
  const cmp = store.hamta(4);
  assert.equal(cmp.info.name, 'Höstserien');
  assert.equal(cmp.competitors[31].name, 'Carl Carlsson');
  assert.deepEqual(Object.keys(store.competitions), ['4'], 'bara den efterfrågade');
  assert.equal(store.hamta(77), undefined, 'en tävling som inte finns ger undefined');
});

test('en inläst tävling läses inte in igen', () => {
  const store = createStore({ dataDir: medData(DATA), saveDelayMs: 60000 });
  const första = store.hamta(1);
  första.info.organizer = 'satt i minnet';
  assert.equal(store.hamta(1).info.organizer, 'satt i minnet', 'samma objekt, inte en ny läsning');
});

test('cachen släpper de minst använda när den blir full', () => {
  const dir = medData({
    1: DATA[1], 4: DATA[4],
    7: { namn: 'Tredje', datum: '2026-10-01', lopare: {} },
    9: { namn: 'Fjärde', datum: '2026-11-01', lopare: {} },
  });
  const store = createStore({ dataDir: dir, saveDelayMs: 60000, cacheMax: 2 });
  store.hamta(1); store.hamta(4); store.hamta(7);
  assert.equal(
    Object.keys(store.competitions).length,
    2,
    'annars växer minnet tillbaka till att hålla allt'
  );
  assert.ok(store.competitions[7], 'den senast använda ska vara kvar');
});

test('ändringar går inte förlorade när cachen släpper tävlingen', () => {
  const dir = medData({ 1: DATA[1], 4: DATA[4], 7: { namn: 'Tredje', datum: '2026-10-01', lopare: {} } });
  const store = createStore({ dataDir: dir, saveDelayMs: 60000, cacheMax: 1 });
  store.getCompetition(1).info.organizer = 'OK Skogen';
  store.touch(1);
  store.hamta(4);
  store.hamta(7); // trängseln: tävling 1 skulle annars åka ut

  assert.ok(
    store.competitions[1],
    'en tävling som väntar på att sparas får aldrig kastas ut – ändringen finns bara i minnet'
  );
  store.flush();
  const om = createStore({ dataDir: dir, saveDelayMs: 60000 });
  assert.equal(om.hamta(1).info.organizer, 'OK Skogen', 'och den ska nå disken');
});

test('registret följer med när data ändras', () => {
  const dir = medData(DATA);
  const store = createStore({ dataDir: dir, saveDelayMs: 60000 });
  const cmp = store.getCompetition(1);
  cmp.competitors[33] = { name: 'Doris Dahl', card: 444444 };
  store.touch(1);

  assert.deepEqual(store.tavlingarMedBricka(444444), [1], 'ny löpare ska gå att hitta direkt');
  assert.deepEqual(store.tavlingarMedTraff('doris'), [1]);
});

test('gallring behöver inte läsa in tävlingarna', () => {
  const nu = Date.parse('2026-12-01T12:00:00Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-gallring-'));
  fs.mkdirSync(path.join(dir, 'tavlingar'), { recursive: true });
  // Fixturen skrivs direkt: åldern räknas från `updated`, och den sätts av
  // touch() till dagens datum – att gå via lagret ger inte två olika åldrar.
  const skriv = (cid, dagarSedan, lopare) =>
    fs.writeFileSync(
      path.join(dir, 'tavlingar', `${cid}.json`),
      JSON.stringify({
        info: { name: `Tävling ${cid}`, date: '2026-06-01' },
        controls: {}, classes: {}, orgs: {}, teams: {},
        competitors: lopare,
        updated: new Date(nu - dagarSedan * 24 * 3600 * 1000).toISOString(),
      })
    );
  skriv(1, 100, { 31: { name: 'Anna Andersson', card: 123456 } });
  skriv(4, 10, { 31: { name: 'Carl Carlsson', card: 333333 } });

  // Gallringen körs redan i konstruktorn
  const store = createStore({ dataDir: dir, saveDelayMs: 60000, retentionDays: 90, now: () => nu });
  assert.deepEqual(store.purgeExpired(), [], 'redan gallrad vid start');
  assert.deepEqual(Object.keys(store.competitions), [], 'gallringen ska gå på registret');
  assert.deepEqual(store.listCompetitions().map((c) => c.id), [4]);
  assert.deepEqual(store.tavlingarMedBricka(123456), [], 'registret ska följa med');
});
