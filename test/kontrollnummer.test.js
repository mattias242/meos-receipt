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
