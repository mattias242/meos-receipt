import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

/**
 * KRAV-8: tävlingsdata sparas i en fil per tävling.
 *
 * Uppmätt på 90 dagars data med stämplingar (65 tävlingar, 57 850 löpare,
 * 23 MB): att skriva om hela databasen kostar 60 ms blockerad eventloop och
 * sker varje gång någon tävling ändras – var tionde sekund under tävling.
 * En enskild tävling kostar 2,6 ms. Uppstarten tolkade hela filen på 126 ms.
 *
 * Det viktigaste är dock inte hastigheten: med en fil per tävling kostar en
 * oläsbar fil *en* tävling i stället för alla nittio dagarna.
 */

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'meos-part-'));
const filer = (d) =>
  fs.existsSync(path.join(d, 'tavlingar'))
    ? fs.readdirSync(path.join(d, 'tavlingar')).sort()
    : [];
const las = (d, cid) =>
  JSON.parse(fs.readFileSync(path.join(d, 'tavlingar', `${cid}.json`), 'utf8'));

function medTavlingar(d, ids, opts = {}) {
  const store = createStore({ dataDir: d, saveDelayMs: 60000, ...opts });
  for (const cid of ids) {
    store.getCompetition(cid).info.name = `Tävling ${cid}`;
    store.touch(cid);
  }
  return store;
}

test('varje tävling får en egen fil', () => {
  const d = dir();
  medTavlingar(d, [1, 2, 7]).flush();
  assert.deepEqual(filer(d), ['1.json', '2.json', '7.json']);
  assert.equal(las(d, 7).info.name, 'Tävling 7');
});

test('bara den ändrade tävlingen skrivs om', () => {
  const d = dir();
  const store = medTavlingar(d, [1, 2]);
  store.flush();
  const före = fs.statSync(path.join(d, 'tavlingar', '2.json')).mtimeMs;

  store.getCompetition(1).info.organizer = 'OK Skogen';
  store.touch(1);
  store.flush();

  assert.equal(
    fs.statSync(path.join(d, 'tavlingar', '2.json')).mtimeMs,
    före,
    'en orörd tävling ska inte skrivas om – det är hela poängen med uppdelningen'
  );
  assert.equal(las(d, 1).info.organizer, 'OK Skogen');
});

/**
 * Det här är den verkliga vinsten. Med en enda fil kostade en trasig byte
 * hela databasen: 90 dagar, alla tävlingar, borta i ett svep.
 */
test('en oläsbar tävlingsfil kostar bara den tävlingen', () => {
  const d = dir();
  medTavlingar(d, [1, 2, 3]).flush();
  fs.writeFileSync(path.join(d, 'tavlingar', '2.json'), '{ trasigt');

  const om = createStore({ dataDir: d, saveDelayMs: 60000 });
  assert.deepEqual(
    om.listCompetitions().map((c) => c.id).sort(),
    [1, 3],
    'de läsbara tävlingarna ska överleva'
  );
  assert.equal(om.hamta(1).info.name, 'Tävling 1');
  const undanlagda = fs.readdirSync(path.join(d, 'tavlingar')).filter((f) => f.includes('trasig'));
  assert.equal(undanlagda.length, 1, 'den trasiga filen ska läggas undan, inte skrivas över');
});

test('gallring tar bort tävlingens fil', () => {
  const d = dir();
  let nu = Date.parse('2026-08-06T12:00:00Z');
  const store = medTavlingar(d, [1, 2], { now: () => nu, retentionDays: 90 });
  store.flush();
  assert.deepEqual(filer(d), ['1.json', '2.json']);

  store.hamta(1).updated = new Date(nu - 91 * 24 * 3600 * 1000).toISOString();
  store.touch(1);
  store.hamta(1).updated = new Date(nu - 91 * 24 * 3600 * 1000).toISOString();
  assert.deepEqual(store.purgeExpired(), [1]);
  store.flush();
  assert.deepEqual(filer(d), ['2.json'], 'den gallrade tävlingens fil ska vara borta');
});

test('data överlever en omstart', () => {
  const d = dir();
  medTavlingar(d, [1, 2]).flush();
  const om = createStore({ dataDir: d, saveDelayMs: 60000 });
  assert.deepEqual(om.listCompetitions().map((c) => c.id).sort(), [1, 2]);
  assert.equal(om.hamta(2).info.name, 'Tävling 2');
});

/**
 * En befintlig installation har en competitions.json. Den ska delas upp vid
 * start, och originalet läggas undan i stället för att raderas – går
 * uppdelningen fel ska datan gå att rädda för hand (samma hållning som KRAV-8
 * har till en oläsbar fil).
 */
test('en gammal competitions.json delas upp vid start', () => {
  const d = dir();
  fs.writeFileSync(
    path.join(d, 'competitions.json'),
    JSON.stringify({
      1: { info: { name: 'Gamla tävlingen' }, competitors: { 31: { name: 'Anna', card: 123456 } }, updated: '2026-08-06T10:00:00Z' },
      4: { info: { name: 'Andra tävlingen' }, competitors: {}, updated: '2026-08-06T10:00:00Z' },
    })
  );

  const store = createStore({ dataDir: d, saveDelayMs: 60000 });
  assert.deepEqual(store.listCompetitions().map((c) => c.id).sort(), [1, 4]);
  assert.deepEqual(filer(d), ['1.json', '4.json']);
  assert.equal(las(d, 1).competitors[31].name, 'Anna');
  assert.equal(
    fs.existsSync(path.join(d, 'competitions.json')),
    false,
    'originalet ska inte ligga kvar och läsas in igen vid nästa start'
  );
  assert.ok(
    fs.readdirSync(d).some((f) => f.startsWith('competitions.json.uppdelad-')),
    'men det ska sparas undan, inte raderas'
  );
});

test('migreringen körs inte om den redan är gjord', () => {
  const d = dir();
  medTavlingar(d, [1]).flush();
  fs.writeFileSync(path.join(d, 'competitions.json'), JSON.stringify({ 9: { info: { name: 'Skulle skriva över' }, competitors: {} } }));

  const om = createStore({ dataDir: d, saveDelayMs: 60000 });
  assert.deepEqual(
    om.listCompetitions().map((c) => String(c.id)),
    ['1'],
    'finns redan uppdelade filer är de sanningen – en kvarglömd competitions.json får inte läsas in'
  );
});

test('undanlagda filer gallras enligt samma regel', () => {
  const d = dir();
  let nu = Date.parse('2026-08-06T12:00:00Z');
  const gammal = nu - 91 * 24 * 3600 * 1000;
  fs.mkdirSync(path.join(d, 'tavlingar'), { recursive: true });
  fs.writeFileSync(path.join(d, 'tavlingar', `2.json.trasig-${gammal}`), 'x');
  fs.writeFileSync(path.join(d, `competitions.json.uppdelad-${gammal}`), 'x');

  createStore({ dataDir: d, saveDelayMs: 60000, now: () => nu, retentionDays: 90 });
  assert.equal(filer(d).filter((f) => f.includes('trasig')).length, 0, 'undanlagd tävlingsfil');
  assert.equal(
    fs.readdirSync(d).filter((f) => f.includes('uppdelad')).length,
    0,
    'undanlagd hel databas – den innehåller hela deltagarfältet'
  );
});
