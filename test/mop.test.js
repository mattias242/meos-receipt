import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { MOP_STAFETT } from './fixtures/mop.js';
import { applyMop, parseRadioTimes, parseTeamMembers } from '../lib/mop.js';
import { buildReceipt } from '../lib/receipt.js';

// ---------------------------------------------------------------------------
// Tidsräkning (KRAV-3)
// ---------------------------------------------------------------------------

/** Minimal tävling med en löpare, valfri nolltid. */
function mopMed({ zerotime = '', st = 360000, rt = 21000 } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <competition date="2026-08-06" organizer="OK Test"${zerotime ? ` zerotime="${zerotime}"` : ''}>Testet</competition>
  <ctrl id="150">Radio 1</ctrl>
  <cls id="1" ord="1" radio="150">H21</cls>
  <org id="5" nat="SWE">OK Skogen</org>
  <cmp id="31" card="123456">
    <base org="5" cls="1" stat="1" st="${st}" rt="${rt}">Anna Andersson</base>
    <radio>150,9000</radio>
  </cmp>
</MOPComplete>`;
}

function kvittoFor(xml) {
  const store = createStore();
  applyMop(store, 1, xml);
  return buildReceipt(store.competitions[1], 1, 31);
}

/**
 * MOP-specen: starttiden anges i tiondelar efter 00:00:00 lokal tid på
 * tävlingens första dag – alltså redan normaliserad till midnatt. Nolltiden
 * finns i protokollet men får inte påverka räkningen; gör den det förskjuts
 * varje klockslag på kvittot. Detta test faller om någon "rättar" det.
 */
test('klockslag räknas från midnatt oavsett zerotime', () => {
  const utan = kvittoFor(mopMed());
  const med = kvittoFor(mopMed({ zerotime: '09:00:00' }));

  assert.equal(utan.result.startTime, '10:00:00');
  assert.equal(utan.result.finishTime, '10:35:00');

  assert.equal(med.result.startTime, utan.result.startTime, 'zerotime får inte förskjuta starten');
  assert.equal(med.result.finishTime, utan.result.finishTime);
  assert.deepEqual(
    med.splits.map((s) => s.clock),
    utan.splits.map((s) => s.clock),
    'zerotime får inte förskjuta sträckornas klockslag'
  );
});

test('nolltiden sparas ändå för referens', () => {
  const store = createStore();
  applyMop(store, 1, mopMed({ zerotime: '09:00:00' }));
  assert.equal(store.competitions[1].info.zerotime, '09:00:00');
});

test('lopp över midnatt wrappar klockslaget', () => {
  // Start 23:50:00 (85800 s = 858000 tiondelar), löptid 30 min -> mål 00:20:00
  const r = kvittoFor(mopMed({ st: 858000, rt: 18000 }));
  assert.equal(r.result.startTime, '23:50:00');
  assert.equal(r.result.finishTime, '00:20:00');
  assert.equal(r.result.time, '30:00');
});

// ---------------------------------------------------------------------------
// Stafett (KRAV-3: kvittot visar lagnamnet)
// ---------------------------------------------------------------------------

function stafettKvitto(competitorId) {
  const store = createStore();
  applyMop(store, 1, MOP_STAFETT);
  return buildReceipt(store.competitions[1], 1, competitorId);
}

test('kvittot visar lagnamnet för en stafettlöpare', () => {
  const erik = stafettKvitto(41);
  assert.equal(erik.runner.name, 'Erik Etapp');
  assert.equal(erik.runner.team, 'OK Skogen 1');

  const frida = stafettKvitto(42);
  assert.equal(frida.runner.team, 'OK Skogen 1', 'även sträcka 2 hör till laget');
});

test('en löpare utanför laget får inget lagnamn', () => {
  assert.equal(stafettKvitto(43).runner.team, '');
});

test('lagets medlemmar läses in per sträcka', () => {
  const store = createStore();
  applyMop(store, 1, MOP_STAFETT);
  assert.deepEqual(store.competitions[1].teams[7].members, [[41], [42]]);
  assert.equal(store.competitions[1].teams[7].name, 'OK Skogen 1');
});

// ---------------------------------------------------------------------------
// Avanmälan (KRAV-2): MOP:s delete-attribut
// ---------------------------------------------------------------------------

/** MOPDiff som tar bort ett element, som när MeOS avanmäler någon. */
function mopRadera(element, id) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MOPDiff xmlns="http://www.melin.nu/mop">
  <${element} id="${id}" delete="true"></${element}>
</MOPDiff>`;
}

test('en avanmäld löpare tas bort ur tävlingen', () => {
  const store = createStore();
  applyMop(store, 1, MOP_STAFETT);
  assert.ok(store.competitions[1].competitors[41]);

  applyMop(store, 1, mopRadera('cmp', 41));
  assert.equal(store.competitions[1].competitors[41], undefined);
  assert.ok(store.competitions[1].competitors[42], 'övriga löpare rörs inte');
});

test('kvittot för en avanmäld löpare finns inte längre', () => {
  const store = createStore();
  applyMop(store, 1, MOP_STAFETT);
  applyMop(store, 1, mopRadera('cmp', 41));
  assert.equal(buildReceipt(store.competitions[1], 1, 41), null);
});

test('ett struket lag tas bort', () => {
  const store = createStore();
  applyMop(store, 1, MOP_STAFETT);
  assert.ok(store.competitions[1].teams[7]);

  applyMop(store, 1, mopRadera('tm', 7));
  assert.equal(store.competitions[1].teams[7], undefined);
  // Löparna finns kvar, men utan lagnamn
  assert.equal(buildReceipt(store.competitions[1], 1, 41).runner.team, '');
});

test('en borttagen klubb tas bort', () => {
  const store = createStore();
  applyMop(store, 1, MOP_STAFETT);
  assert.ok(store.competitions[1].orgs[5]);

  applyMop(store, 1, mopRadera('org', 5));
  assert.equal(store.competitions[1].orgs[5], undefined);
  assert.equal(buildReceipt(store.competitions[1], 1, 41).runner.club, '');
});

// ---------------------------------------------------------------------------
// Delformat (KRAV-1)
// ---------------------------------------------------------------------------

test('parseRadioTimes läser par och sållar bort skräp', () => {
  assert.deepEqual(parseRadioTimes('150,9000;162,15000'), [
    { ctrl: 150, rt: 9000 },
    { ctrl: 162, rt: 15000 },
  ]);
  assert.deepEqual(parseRadioTimes(''), []);
  assert.deepEqual(parseRadioTimes('trams;;,,'), []);
  assert.deepEqual(parseRadioTimes('150,9000;trasig'), [{ ctrl: 150, rt: 9000 }]);
});

test('parseTeamMembers läser sträckor med flera löpare', () => {
  assert.deepEqual(parseTeamMembers('31;32,33;35'), [[31], [32, 33], [35]]);
  assert.deepEqual(parseTeamMembers(''), []);
});

test('okänt rotelement avvisas', () => {
  const store = createStore();
  assert.throws(() => applyMop(store, 1, '<?xml version="1.0"?><Other/>'));
});
