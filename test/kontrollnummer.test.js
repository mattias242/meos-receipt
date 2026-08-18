/**
 * KRAV-19: kontrollens beteckning på kvittot – nummer först, namnet som
 * suffix inom parentes.
 *
 * Numret är det löparen har på banbeskrivningen och det enda som går att
 * jämföra mot skärmen i skogen. Namnet ("Radio 1") är arrangörens etikett,
 * finns bara för de kontroller MeOS namngett och duger inte ensamt för att
 * peka ut en kontroll.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt } from '../lib/receipt.js';
import { receiptLines } from '../lib/pdf.js';

/** Minsta tävling som buildReceipt behöver: en löpare i en klass. */
function tavling({ controls = {}, radios = [], punches = null, rt = 21000 }) {
  const c = { name: 'Daniel Nilsson', card: 8012345, cls: 3, org: 5, stat: 1, st: 360000, rt, radios };
  if (punches) c.punches = punches;
  return {
    info: { name: 'Simulering', date: '2026-08-20', organizer: 'UOK' },
    controls,
    classes: { 3: { name: 'HD16' } },
    orgs: { 5: { name: 'UOK' } },
    teams: {},
    competitors: { 99: c },
  };
}

const namn = (r) => r.splits.map((s) => s.name);

test('radiokontroll med namn visas som nummer följt av namnet', () => {
  const cmp = tavling({
    controls: { 50: { name: 'Radio 1' }, 61: { name: 'Radio 2' } },
    radios: [{ ctrl: 50, rt: 4000 }, { ctrl: 61, rt: 9000 }],
  });
  const r = buildReceipt(cmp, 'sim', 99);
  assert.deepEqual(namn(r), ['50 (Radio 1)', '61 (Radio 2)', 'Mål']);
  // Numret ska finnas kvar som eget fält – etiketten är för läsaren, inte
  // för den som slår upp kontrollen.
  assert.deepEqual(r.splits.map((s) => s.control), [50, 61, null]);
});

test('kontroll utan namn visas som enbart numret', () => {
  const cmp = tavling({ controls: {}, radios: [{ ctrl: 77, rt: 4000 }] });
  assert.deepEqual(namn(buildReceipt(cmp, 'sim', 99)), ['77', 'Mål']);
});

// Före KRAV-19 sparade lib/mop.js "Kontroll <nr>" som namn på en namnlös
// kontroll. Den platshållaren ligger kvar i sparad data och ser ut som ett
// namn utan att vara det – den får inte bli "77 (Kontroll 77)".
test('platshållarnamn från äldre data blir inte ett suffix', () => {
  const cmp = tavling({
    controls: { 77: { name: 'Kontroll 77' } },
    radios: [{ ctrl: 77, rt: 4000 }],
  });
  assert.deepEqual(namn(buildReceipt(cmp, 'sim', 99)), ['77', 'Mål']);
});

test('stämplingar från resultatfilen får samma beteckning', () => {
  const cmp = tavling({
    controls: { 50: { name: 'Radio 1' } },
    punches: [
      { code: 31, rt: 4500, status: 'ok' },
      { code: 50, rt: 9000, status: 'ok' },
    ],
  });
  // 31 är ingen namngiven kontroll i MeOS och har bara sitt nummer.
  assert.deepEqual(namn(buildReceipt(cmp, 'sim', 99)), ['31', '50 (Radio 1)', 'Mål']);
});

test('målraden har varken nummer eller namn utöver "Mål"', () => {
  const cmp = tavling({ controls: {}, radios: [{ ctrl: 31, rt: 4000 }] });
  const mal = buildReceipt(cmp, 'sim', 99).splits.at(-1);
  assert.equal(mal.name, 'Mål');
  assert.equal(mal.control, null);
});

/**
 * PDF:ens kontrollkolumn är bara 14 tecken bred. Ryms inte hela beteckningen
 * tillsammans med SAKNAS/EXTRA är det namnet som ska falla bort – numret
 * pekar ut kontrollen och markören säger vad som hänt.
 */
test('numret och SAKNAS överlever den smala kontrollkolumnen i PDF:en', () => {
  const cmp = tavling({
    controls: { 50: { name: 'Radio 1' } },
    punches: [{ code: 50, rt: 0, status: 'missing' }],
  });
  const rad = receiptLines(buildReceipt(cmp, 'sim', 99))
    .map((l) => l.text)
    .find((t) => t.startsWith('50'));
  assert.ok(rad, 'kontrollraden saknas i PDF:en');
  assert.match(rad, /^50 SAKNAS/, `numret och markören ska överleva, fick: ${JSON.stringify(rad)}`);
});

/**
 * Namnkonventionerna nedan är avlästa ur en skarp MeOS-sändning (RADIOTEST
 * 2026-08-18, 500 löpare, 80 kontroller), inte påhittade:
 *
 *   - En kontroll arrangören inte döpt får sin egen kod som namn: id 54 -> "54".
 *   - Förekommer koden flera gånger i banan numreras besöken: "79-1", "52-2".
 *   - Andra och tredje besöket får ett eget internt id: kod + 100000 * (besök-1).
 *     I filen: 32/100032 -> "32-1"/"32-2", 61/100061/200061 -> "61-1".."61-3".
 *   - Bara de kontroller arrangören faktiskt döpt bär ett riktigt namn:
 *     "Radio 1-1" (id 50), "Radio 1-2" (id 100050), "Radio 2", "Förvarning".
 *
 * Samtliga 76 odöpta kontroller i filen följde id % 100000 exakt.
 */
test('MeOS eget platshållarnamn blir inte ett suffix', () => {
  const cmp = tavling({
    controls: { 54: { name: '54' }, 79: { name: '79-1' } },
    radios: [{ ctrl: 54, rt: 970 }, { ctrl: 79, rt: 1680 }],
  });
  // "54 (54)" och "79 (79-1)" säger löparen ingenting – namnet *är* koden.
  assert.deepEqual(namn(buildReceipt(cmp, 'sim', 99)), ['54', '79', 'Mål']);
});

/**
 * Det andra besöket på en kontroll har ett internt id i MeOS – 100052 för
 * kontroll 52. Det numret står inte på någon skärm i skogen, så det får
 * aldrig hamna på kvittot: löparen ska se 52 båda gångerna, och vilken
 * passage det är framgår av ordningen i tabellen.
 */
test('andra besöket på en kontroll visar kontrollkoden, inte MeOS interna id', () => {
  const cmp = tavling({
    controls: {
      52: { name: '52-1' },
      100052: { name: '52-2' },
      50: { name: 'Radio 1-1' },
      100050: { name: 'Radio 1-2' },
    },
    radios: [
      { ctrl: 52, rt: 1000 },
      { ctrl: 50, rt: 2000 },
      { ctrl: 100052, rt: 3000 },
      { ctrl: 100050, rt: 4000 },
    ],
  });
  const r = buildReceipt(cmp, 'sim', 99);
  assert.deepEqual(namn(r), ['52', '50 (Radio 1-1)', '52', '50 (Radio 1-2)', 'Mål']);
  // Kontrollnumret utåt är koden, inte det interna id:t.
  assert.deepEqual(r.splits.map((s) => s.control), [52, 50, 52, 50, null]);
});

test('tredje besöket följer samma regel', () => {
  const cmp = tavling({
    controls: { 200061: { name: '61-3' } },
    radios: [{ ctrl: 200061, rt: 1000 }],
  });
  assert.deepEqual(namn(buildReceipt(cmp, 'sim', 99)), ['61', 'Mål']);
});
