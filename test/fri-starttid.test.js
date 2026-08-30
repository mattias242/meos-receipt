/**
 * KRAV-24: MOP-fältet `competing` avgör vem som är ute på banan när starttiden
 * inte gör det.
 *
 * Vid fri starttid tilldelar MeOS ingen starttid: `st` är 0 tills brickan
 * lästs. Regeln "startad = har starttid" gav då "Ej startat" åt löparen som
 * står i målfållan och läser sitt kvitto – rätt enligt fälten, fel enligt
 * verkligheten.
 *
 * Fältet är tre-värt (mop.xsd: "Absence of attribute indicates that the status
 * is not known"), och det är hela poängen med testerna här: bara `true` får
 * ändra något. `false` och avsaknad ska bete sig exakt som före KRAV-24, för
 * annars ändras beteendet för all redan sparad data och för hela IOF-flödet,
 * där fältet aldrig sätts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { applyMop } from '../lib/mop.js';
import { buildReceipt } from '../lib/receipt.js';
import { MOP_FRI_STARTTID } from './fixtures/mop.js';

function fristarten() {
  const store = createStore();
  applyMop(store, 9, MOP_FRI_STARTTID);
  return store.competitions[9];
}

/** En löpare med fri starttid: inget som skiljer dem åt utom `competing`. */
function loparen(competing) {
  const c = { name: 'Test Testsson', card: 1, cls: 9, org: 5, stat: 0, st: 0, rt: 0, radios: [] };
  if (competing !== undefined) c.competing = competing;
  return {
    info: { name: 'Fristarten', date: '2026-09-05', organizer: 'OK' },
    controls: {},
    classes: { 9: { name: 'Öppen motion' } },
    orgs: { 5: { name: 'OK Skogen' } },
    teams: {},
    competitors: { 1: c },
  };
}

const status = (cmp, id) => buildReceipt(cmp, 'x', id).result.statusText;

test('MOP läser competing som tre-värt: true, false och okänt', () => {
  const cmp = fristarten();
  assert.equal(cmp.competitors[51].competing, true);
  assert.equal(cmp.competitors[52].competing, false);
  // Attributet saknas – MeOS vet inte, och det är inte samma sak som "nej".
  assert.equal(cmp.competitors[53].competing, null);
});

test('competing=true gör löparen utan starttid till "Ute på banan"', () => {
  assert.equal(status(fristarten(), 51), 'Ute på banan');
  assert.equal(status(loparen(true), 1), 'Ute på banan');
});

test('competing=false ändrar ingenting – utan starttid är löparen ej startad', () => {
  assert.equal(status(fristarten(), 52), 'Ej startat');
  assert.equal(status(loparen(false), 1), 'Ej startat');
});

test('okänt competing beter sig som före KRAV-24', () => {
  assert.equal(status(fristarten(), 53), 'Ej startat');
  assert.equal(status(loparen(null), 1), 'Ej startat');
  // Fältet kan saknas helt i data sparad före KRAV-24, och i IOF-flödet.
  assert.equal(status(loparen(undefined), 1), 'Ej startat');
});

test('competing=true hittar inte på en starttid som saknas', () => {
  const r = buildReceipt(fristarten(), 'x', 51);
  assert.equal(r.result.startTime, '');
  assert.equal(r.result.time, '');
});

/**
 * Starttiden är hårda fakta, `competing` en ledtråd: ledtråden fyller i när
 * fakta saknas, aldrig tvärtom. En löpare med starttid och känd status ska
 * inte kunna få den omskriven av ett attribut om vem som "just nu tävlar".
 */
test('competing väger aldrig över en status MeOS redan satt', () => {
  const cmp = fristarten();
  assert.equal(status(cmp, 54), 'Godkänd');
  assert.equal(buildReceipt(cmp, 'x', 54).result.startTime, '10:00:00');

  // Ej start med tilldelad starttid ska fortsatt döljas (KRAV-4), även om
  // MeOS av något skäl skulle kalla löparen tävlande.
  const ejStart = loparen(true);
  ejStart.competitors[1].stat = 20;
  ejStart.competitors[1].st = 378000;
  const r = buildReceipt(ejStart, 'x', 1);
  assert.equal(r.result.statusText, 'Ej start');
  assert.equal(r.result.startTime, '');
});

/**
 * Placeringen räknas på MeOS status, inte på `competing`. MeOS har redan en
 * egen mekanism för den som inte är med i tävlingen – status 15, "Utom
 * tävlan" – och den är det resultatlistan på arenan bygger på. Räknades
 * `competing === false` bort ur nämnaren skulle kvittot säga en annan sak än
 * listan, och placeringen skulle dessutom bero på om MeOS råkade skicka
 * attributet eller inte.
 */
test('competing påverkar varken placering, antal i mål eller antal i klassen', () => {
  const r = buildReceipt(fristarten(), 'x', 54);
  assert.equal(r.result.place, 1);
  assert.equal(r.result.finished, 1);
  // Alla fyra räknas: 51 (true), 52 (false), 53 (okänt) och 54 själv.
  assert.equal(r.result.total, 4);
});
