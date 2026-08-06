import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

// KRAV-8: konfigurerbar sparfördröjning så att data snabbt når disken
test('store persists to disk within saveDelayMs', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = createStore({ dataDir: dir, saveDelayMs: 10 });
  store.getCompetition(1).info.name = 'Test';
  store.touch(1);

  const file = path.join(dir, 'competitions.json');
  const deadline = Date.now() + 500;
  while (!fs.existsSync(file) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(fs.existsSync(file), 'competitions.json skrevs inte inom 500 ms');

  const reloaded = createStore({ dataDir: dir });
  assert.equal(reloaded.getCompetition(1).info.name, 'Test');
});

// KRAV-8: en oläsbar datafil får inte tyst skrivas över. Filen kan innehålla
// hela tävlingens data – startar tjänsten tom och sparar över den är den borta
// för gott, utan möjlighet att rädda innehållet.
test('en oläsbar datafil sparas undan i stället för att skrivas över', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-trasig-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'competitions.json');

  const original = '{"1":{"info":{"name":"Viktig tävling"},"competitors":{"31":{"name":"Anna"';
  fs.writeFileSync(file, original);

  const store = createStore({ dataDir: dir, saveDelayMs: 10 });
  assert.deepEqual(store.listCompetitions(), [], 'trasig data ska inte läsas in');

  const undanlagd = fs.readdirSync(dir).filter((f) => f.includes('trasig'));
  assert.equal(undanlagd.length, 1, `förväntade en undanlagd fil, fick ${fs.readdirSync(dir)}`);
  assert.equal(
    fs.readFileSync(path.join(dir, undanlagd[0]), 'utf8'),
    original,
    'innehållet ska bevaras oförändrat'
  );

  // Ny data ska kunna sparas som vanligt efteråt
  store.getCompetition(2).info.name = 'Ny tävling';
  store.touch(2);
  await waitFor(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'))['2']);
});

test('en läsbar datafil lämnas orörd', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-ok-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'competitions.json');

  const skapare = createStore({ dataDir: dir, saveDelayMs: 10 });
  skapare.getCompetition(1).info.name = 'Test';
  skapare.touch(1);
  await waitFor(() => fs.existsSync(file));

  const läsare = createStore({ dataDir: dir, saveDelayMs: 10 });
  assert.equal(läsare.getCompetition(1).info.name, 'Test');
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.includes('trasig')),
    [],
    'inget ska läggas undan när filen går att läsa'
  );
});

// KRAV-8: misslyckas sparningen – full disk, fel rättigheter, trasig volym –
// loggades det bara. Tjänsten fortsatte svara att allt var bra, och hela
// tävlingen kunde köras med data som bara fanns i minnet. Det märktes först
// vid omstarten, när allt var borta.
test('sparfel syns i store-status', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-spar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Lägg en fil där datakatalogen ska vara – då går den inte att skriva i
  const somFil = path.join(dir, 'blockerad');
  fs.writeFileSync(somFil, 'inte en katalog');

  const fel = [];
  const original = console.error;
  console.error = (...a) => fel.push(a.join(' '));
  t.after(() => { console.error = original; });

  const store = createStore({ dataDir: somFil, saveDelayMs: 5 });
  assert.equal(store.status().sparfel, null, 'inget fel innan något sparats');

  store.getCompetition(1).info.name = 'Tävling';
  store.touch(1);
  await new Promise((r) => setTimeout(r, 60));

  const status = store.status();
  assert.ok(status.sparfel, 'sparfelet ska gå att fråga efter, inte bara loggas');
  assert.match(status.sparfel, /\w/);
  assert.ok(fel.length > 0, 'och fortfarande loggas');
});

test('lyckad sparning nollställer sparfelet', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-spar-ok-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = createStore({ dataDir: dir, saveDelayMs: 5 });
  store.getCompetition(1).info.name = 'Tävling';
  store.touch(1);
  await waitFor(() => fs.existsSync(path.join(dir, 'competitions.json')));
  assert.equal(store.status().sparfel, null);
});

test('utan datakatalog rapporteras ingen persistens', () => {
  const store = createStore();
  assert.equal(store.status().persistens, false, 'körs bara i minnet');
  assert.equal(store.status().sparfel, null);
});

// KRAV-9: sätts MeOS och uppladdningsprogrammet till olika tävlings-id hamnar
// inflödena i var sin tävling. Allt svarar OK, men placeringen räknas på bara
// den delmängd av fältet som hamnat där. Kontrollen ligger i store och inte i
// en av inläsarna, eftersom felet ser likadant ut oavsett vilket inflöde som
// kom först.

/** Fångar console.warn under testet. */
function fangaVarningar(t) {
  const varningar = [];
  const original = console.warn;
  console.warn = (...a) => varningar.push(a.join(' '));
  t.after(() => { console.warn = original; });
  return varningar;
}

/** Lägger en tävling med givet namn/datum och bricknummer i store. */
function laggTavling(store, cid, namn, datum, kort) {
  const cmp = store.getCompetition(cid);
  cmp.info.name = namn;
  cmp.info.date = datum;
  kort.forEach((card, i) => {
    cmp.competitors[i + 1] = { name: `Löpare ${i + 1}`, card, cls: 1, org: 1, stat: 1, st: 0, rt: 0 };
  });
  store.touch(cid);
}

test('två tävlingar med samma namn, datum och brickor ger en varning', (t) => {
  const store = createStore();
  const varningar = fangaVarningar(t);

  laggTavling(store, 1, 'Testtävlingen', '2026-08-06', [111, 222, 333]);
  laggTavling(store, 2, 'Testtävlingen', '2026-08-06', [111, 222, 333]);

  assert.equal(varningar.length, 1, `förväntade en varning, fick ${varningar.length}`);
  assert.match(varningar[0], /tävlings-id/);
  assert.match(varningar[0], /3 bricknummer/);
});

test('varningen kommer oavsett vilket inflöde som skapade tävlingen först', (t) => {
  const store = createStore();
  const varningar = fangaVarningar(t);
  // Omvänd ordning mot förra testet – resultatfilen först, MeOS sedan
  laggTavling(store, 2, 'Testtävlingen', '2026-08-06', [111, 222]);
  laggTavling(store, 1, 'Testtävlingen', '2026-08-06', [111, 222]);
  assert.equal(varningar.length, 1);
});

test('varningen upprepas inte vid varje sändning', (t) => {
  const store = createStore();
  const varningar = fangaVarningar(t);
  laggTavling(store, 1, 'Testtävlingen', '2026-08-06', [111]);
  laggTavling(store, 2, 'Testtävlingen', '2026-08-06', [111]);
  for (let i = 0; i < 5; i++) store.touch(2);
  assert.equal(varningar.length, 1, 'MeOS skickar var tionde sekund – en varning räcker');
});

test('olika tävlingar med samma löpare varnar inte', (t) => {
  const store = createStore();
  const varningar = fangaVarningar(t);
  // Nästa veckas tävling med samma deltagare – det vanligaste fallet av alla
  laggTavling(store, 1, 'Testtävlingen', '2026-08-06', [111, 222]);
  laggTavling(store, 2, 'Nästa tävling', '2026-08-13', [111, 222]);
  assert.deepEqual(varningar, []);
});

test('samma namn och datum men utan gemensamma brickor varnar inte', (t) => {
  const store = createStore();
  const varningar = fangaVarningar(t);
  laggTavling(store, 1, 'Vårserien', '2026-08-06', [111, 222]);
  laggTavling(store, 2, 'Vårserien', '2026-08-06', [777, 888]);
  assert.deepEqual(varningar, [], 'skilda deltagarfält kan vara etapper eller klasser');
});

// --- KRAV-14: gallring av gammal tävlingsdata -------------------------------

const DAY = 24 * 60 * 60 * 1000;

/** Store med en tävling vars senaste uppdatering ligger `ageDays` bakåt. */
function storeWithAge(ageDays, opts = {}) {
  const store = createStore({ retentionDays: 90, ...opts });
  const cmp = store.getCompetition(1);
  cmp.info.name = 'Gammal tävling';
  cmp.updated = new Date(Date.now() - ageDays * DAY).toISOString();
  return store;
}

test('purgeExpired tar bort tävlingar som passerat gallringsgränsen', () => {
  const store = storeWithAge(91);
  assert.deepEqual(store.purgeExpired(), [1]);
  assert.equal(store.listCompetitions().length, 0);
});

test('purgeExpired behåller tävlingar inom gallringsgränsen', () => {
  const store = storeWithAge(89);
  assert.deepEqual(store.purgeExpired(), []);
  assert.equal(store.listCompetitions().length, 1);
});

test('retentionDays 0 stänger av gallringen helt', () => {
  const store = storeWithAge(400, { retentionDays: 0 });
  assert.deepEqual(store.purgeExpired(), []);
  assert.equal(store.listCompetitions().length, 1);
});

test('gallringen använder tävlingsdatumet när updated saknas', () => {
  const store = createStore({ retentionDays: 90 });
  const gammal = store.getCompetition(1);
  gammal.info.date = new Date(Date.now() - 91 * DAY).toISOString().slice(0, 10);
  const fersk = store.getCompetition(2);
  fersk.info.date = new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10);

  assert.deepEqual(store.purgeExpired(), [1]);
  assert.deepEqual(store.listCompetitions().map((c) => c.id), [2]);
});

test('en tävling utan både updated och datum gallras inte', () => {
  const store = createStore({ retentionDays: 90 });
  store.getCompetition(7).info.name = 'Okänd ålder';
  assert.deepEqual(store.purgeExpired(), []);
  assert.equal(store.listCompetitions().length, 1);
});

test('gallring vid start rensar även den sparade filen', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-purge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'competitions.json');

  const gammal = createStore({ dataDir: dir, saveDelayMs: 10, retentionDays: 0 });
  gammal.getCompetition(1).info.name = 'Gammal tävling';
  gammal.getCompetition(1).updated = new Date(Date.now() - 91 * DAY).toISOString();
  gammal.touch(2); // färsk tävling som ska överleva
  await waitFor(() => fs.existsSync(file));

  // Ny start med gallring påslagen: den gamla tävlingen ska vara borta både
  // ur minnet och ur filen.
  const rensad = createStore({ dataDir: dir, saveDelayMs: 10, retentionDays: 90 });
  assert.deepEqual(rensad.listCompetitions().map((c) => c.id), [2]);

  await waitFor(() => !JSON.parse(fs.readFileSync(file, 'utf8'))['1']);
  const påDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(påDisk), ['2']);
});

async function waitFor(cond, ms = 500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (cond()) return;
    } catch {
      // filen kanske inte finns än
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`villkoret uppfylldes inte inom ${ms} ms`);
}
