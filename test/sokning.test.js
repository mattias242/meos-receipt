import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCompetitors } from '../lib/receipt.js';

/**
 * KRAV-5: sökning på namn och bricka.
 *
 * En sökning utan träff går igenom samtliga inlästa tävlingar – det är så
 * KRAV-6 hittar en bricka i en äldre tävling. Med 90 dagars data (26 tävlingar,
 * 52 000 löpare) tog en miss 15 ms mot 0,5 ms för en träff, och en miss är just
 * vad löparen får när hen stavar fel. Nästan allt av det var objekt som byggdes
 * för deltagare som sedan filtrerades bort.
 */

/**
 * En tävling där varje avläsning av en deltagares `org` räknas.
 *
 * `org` läses bara när träfflistans post byggs. Att räkna den mäter alltså hur
 * många deltagare sökningen materialiserar – deterministiskt, till skillnad
 * från att ta tid, som skiljer sig mellan maskiner och CI-körningar.
 */
function tävlingSomRäknar(antal) {
  const räknare = { org: 0 };
  const competitors = {};
  for (let i = 1; i <= antal; i++) {
    const c = { name: `Löpare ${i} Efternamn`, card: 100000 + i, cls: 1, stat: 1 };
    Object.defineProperty(c, 'org', {
      enumerable: true,
      get() {
        räknare.org++;
        return 1;
      },
    });
    competitors[i] = c;
  }
  return {
    cmp: { competitors, orgs: { 1: { name: 'OK Skogen' } }, classes: { 1: { name: 'H21' } } },
    räknare,
  };
}

test('sökningen bygger poster bara för träffarna', () => {
  const { cmp, räknare } = tävlingSomRäknar(500);

  // 499 är entydigt bland 500; "42" hade matchat även 420-429 eftersom
  // sökningen trimmar bort det avslutande blanksteget.
  const hits = searchCompetitors(cmp, 1, 'Löpare 499');
  assert.equal(hits.length, 1, 'fel förutsättning: sökningen ska ge exakt en träff');

  assert.ok(
    räknare.org <= 5,
    `sökningen byggde poster för ${räknare.org} deltagare för att hitta ${hits.length} – ` +
      'en miss går igenom hela databasen och gör då det arbetet för varenda löpare'
  );
});

test('en sökning utan träff rör inga poster alls', () => {
  const { cmp, räknare } = tävlingSomRäknar(500);
  assert.deepEqual(searchCompetitors(cmp, 1, 'Ingen med det namnet'), []);
  assert.equal(räknare.org, 0, 'ingen träff ska inte kosta något att bygga');
});

test('samma svar som förut: namn, klubb, klass, status och ordning', () => {
  const { cmp } = tävlingSomRäknar(30);
  const hits = searchCompetitors(cmp, 7, 'löpare 1');
  // 1, 10-19 – skiftlägesokänslig delsträng, sorterad på namn
  assert.deepEqual(
    hits.map((h) => h.name),
    ['Löpare 1 Efternamn', ...Array.from({ length: 10 }, (_, i) => `Löpare 1${i} Efternamn`)]
  );
  // KRAV-5: bricknumret finns inte med – namn och klubb räcker för att
  // känna igen sig, och numret följer samma person mellan tävlingar.
  assert.deepEqual(hits[0], {
    id: 1,
    cmp: 7,
    name: 'Löpare 1 Efternamn',
    club: 'OK Skogen',
    class: 'H21',
    statusText: 'Godkänd',
  });
});

test('en siffersträng söks som bricknummer, inte som namn', () => {
  const { cmp } = tävlingSomRäknar(30);
  const hits = searchCompetitors(cmp, 1, '100007');
  assert.deepEqual(hits.map((h) => h.id), [7]);
  // Delsträngsmatchning på siffror skulle annars ge träff på flera brickor
  assert.deepEqual(searchCompetitors(cmp, 1, '10000').map((h) => h.id), []);
});
