import test from 'node:test';
import assert from 'node:assert/strict';
import { laddaSidan } from './helpers/frontend-harness.js';

/**
 * Kvittosidan körd på riktigt (se helpers/frontend-harness.js).
 *
 * KRAV-3/KRAV-13: sidan uppdaterar sig var 15:e sekund så länge resultatet
 * inte är klart, och 2000 löpare kan ha den öppen samtidigt på mobildata.
 */

/** Ett kvitto för en löpare som fortfarande är ute på banan. */
const UTE_PÅ_BANAN = {
  competition: { id: 1, name: 'Testtävlingen', date: '2026-08-06', organizer: 'OK Test' },
  runner: { id: 31, name: 'Anna Andersson', club: 'OK Skogen', class: 'H21', card: 123456 },
  result: { status: 0, statusText: 'Ute på banan', preliminary: false, startTime: '10:00:00', finishTime: '', time: '', place: null, after: '' },
  splits: [],
  updatedAgeSeconds: 3,
};

/** Servern svarar, men först efter `fördröjning` millisekunder. */
function långsamServer(fördröjning, kropp = UTE_PÅ_BANAN) {
  return (url, opts, tid) =>
    new Promise((klar) => {
      tid.setTimeout(() => {
        if (url.includes('/health')) return klar({ status: 200, body: { email: false } });
        if (url.includes('/competitions')) return klar({ status: 200, body: [] });
        klar({ status: 200, body: kropp });
      }, fördröjning);
    });
}

/**
 * Uppdateringen låg på setInterval(15 s) medan varje anrop får ta upp till
 * 25 s. En långsam server fick därför varje mobil att lägga en ny begäran
 * ovanpå den förra – flest anrop precis när servern har det som svårast.
 */
test('en långsam server ger inte överlappande uppdateringar', async () => {
  const sida = laddaSidan({ svar: långsamServer(20000), search: '?cmp=1&id=31' });

  // Fem uppdateringsvarv med en server som tar 20 s per svar
  await sida.tick(100000);

  // Bara kvittoanropen: sidstarten hämtar health och competitions parallellt
  // med flit, och det är inte det här testet handlar om.
  const samtidiga = sida.flestSamtidigt(/receipt/);
  assert.equal(
    samtidiga,
    1,
    `sidan hade ${samtidiga} kvittoanrop ute samtidigt – en långsam server ` +
      'får då dubbel last av varje mobil'
  );
  assert.ok(sida.anrop.some((a) => /receipt/.test(a.url)), 'inget kvitto hämtades alls');
});

test('uppdateringen fortsätter när resultatet inte är klart', async () => {
  const sida = laddaSidan({ svar: långsamServer(50), search: '?cmp=1&id=31' });
  await sida.tick(100);
  const efterFörsta = sida.anrop.filter((a) => a.url.includes('receipt')).length;
  await sida.tick(60000);
  const senare = sida.anrop.filter((a) => a.url.includes('receipt')).length;
  assert.ok(senare > efterFörsta, 'sidan slutade uppdatera sig fast löparen är ute på banan');
});

test('uppdateringen upphör när resultatet är slutgiltigt', async () => {
  const klart = {
    ...UTE_PÅ_BANAN,
    result: { ...UTE_PÅ_BANAN.result, status: 1, statusText: 'Godkänd', time: '35:00', place: 2 },
  };
  const sida = laddaSidan({ svar: långsamServer(50, klart), search: '?cmp=1&id=31' });
  await sida.tick(100);
  const efterFörsta = sida.anrop.length;
  await sida.tick(120000);
  assert.equal(
    sida.anrop.length,
    efterFörsta,
    'sidan fortsatte fråga efter ett resultat som inte kan ändras'
  );
});

/**
 * Den självschemaläggande timern sätts om i slutet av loadReceipt – alltså
 * först efter ett lyckat svar. Utan omplanering också i felvägarna hade
 * kedjan dött vid första glappet i mobilnätet, och löparen fått ett fruset
 * kvitto utan att något sa ifrån. Det är samma sorts följdfel som förr:
 * något får ändrat livslängd utan att alla vägar dit räknas igenom.
 */
test('ett glapp i täckningen avbryter inte den automatiska uppdateringen', async () => {
  let varv = 0;
  const sida = laddaSidan({
    search: '?cmp=1&id=31',
    svar: (url, opts, tid) =>
      new Promise((klar, kasta) => {
        tid.setTimeout(() => {
          if (url.includes('/health')) return klar({ status: 200, body: { email: false } });
          if (url.includes('/competitions')) return klar({ status: 200, body: [] });
          varv++;
          // Andra kvittoanropet: täckningen försvinner ett ögonblick.
          if (varv === 2) return kasta(new Error('nätverksfel'));
          klar({ status: 200, body: UTE_PÅ_BANAN });
        }, 50);
      }),
  });

  await sida.tick(60000);
  assert.ok(varv >= 3, `uppdateringen dog efter glappet (kom till varv ${varv})`);
});

test('ett borttaget kvitto slutar efterfrågas', async () => {
  let varv = 0;
  const sida = laddaSidan({
    search: '?cmp=1&id=31',
    svar: (url, opts, tid) =>
      new Promise((klar) => {
        tid.setTimeout(() => {
          if (url.includes('/health')) return klar({ status: 200, body: { email: false } });
          if (url.includes('/competitions')) return klar({ status: 200, body: [] });
          varv++;
          // Tävlingen gallras (KRAV-14) medan sidan står öppen.
          if (varv >= 2) return klar({ status: 404, body: { error: 'Hittades inte.' } });
          klar({ status: 200, body: UTE_PÅ_BANAN });
        }, 50);
      }),
  });

  await sida.tick(120000);
  assert.equal(varv, 2, `sidan fortsatte fråga efter ett kvitto som är borta (${varv} varv)`);
});
