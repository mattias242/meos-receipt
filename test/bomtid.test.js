import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINSTA_STRACKOR,
  MINSTA_UNDERLAG,
  baslinjer,
  bomanalys,
  bomtider,
  nyckel,
} from '../lib/bomtid.js';

/**
 * KRAV-25: MeOS bomanalys, översatt från oClass.cpp/oRunner.cpp.
 *
 * Testerna här kör algoritmen naken – utan kvitto, utan MeOS-datamodell – så
 * att varje gren och varje tröskel går att pröva var för sig. Talen är i
 * tiondelar, som överallt annars i projektet.
 */

const s = (nyckel, sekunder) => ({ nyckel, tiondelar: sekunder * 10 });

/** En klass där `antal` löpare har sträcktiderna `tider` (sekunder) på 'A>B'. */
function klassMed(tider) {
  return tider.map((t) => [s('A>B', t)]);
}

// ---------------------------------------------------------------------------
// Nyckeln
// ---------------------------------------------------------------------------

test('sträckor nycklas på kontrollkodsparet, med S för start och M för mål', () => {
  assert.equal(nyckel('S', 31), 'S>31');
  assert.equal(nyckel(45, 50), '45>50');
  assert.equal(nyckel(50, 'M'), '50>M');
});

// ---------------------------------------------------------------------------
// Baslinjen – de tre grenarna i oClass::calculateSplits()
// ---------------------------------------------------------------------------

test('färre än fem tider ger klassens bästa tid som baslinje', () => {
  const bas = baslinjer(klassMed([100, 120, 140, 160]));
  assert.equal(bas.get('A>B').n, 4);
  assert.equal(bas.get('A>B').bas, 1000);
});

test('fem till elva tider ger snittet av de två bästa', () => {
  assert.equal(baslinjer(klassMed([100, 120, 140, 160, 180])).get('A>B').bas, 1100);
  assert.equal(
    baslinjer(klassMed([100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300])).get('A>B').bas,
    1100
  );
});

/**
 * Från tolv tider hoppar MeOS över vinnaren och tar medel av t[1]..t[n/6].
 * Med n = 12 blir det bara t[1] och t[2]; med n = 18 blir det t[1]..t[3].
 * Att vinnaren utelämnas är hela poängen – en enskild urlöpning ska inte
 * bestämma vad som är en normal sträcktid.
 */
test('från tolv tider hoppas vinnaren över', () => {
  const tolv = [10, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
  assert.equal(baslinjer(klassMed(tolv)).get('A>B').bas, ((100 + 200) / 2) * 10);

  const arton = [10, 100, 200, 300, 400, 500, 600, 700, 800, 900,
                 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700];
  assert.equal(baslinjer(klassMed(arton)).get('A>B').bas, ((100 + 200 + 300) / 3) * 10);
});

test('varje sträcka får sin egen baslinje och sitt eget antal', () => {
  const bas = baslinjer([
    [s('S>31', 60), s('31>32', 120)],
    [s('S>31', 80), s('31>32', 120)],
    [s('S>31', 90)],
  ]);
  assert.equal(bas.get('S>31').n, 3);
  assert.equal(bas.get('S>31').bas, 600);
  assert.equal(bas.get('31>32').n, 2);
  assert.equal(bas.get('31>32').bas, 1200);
});

// ---------------------------------------------------------------------------
// Bomtiden – oRunner::getSplitAnalysis()
// ---------------------------------------------------------------------------

/**
 * Facit räknat för hand ur MeOS formel, med baslinjen 60/120/180/90/60 och en
 * löpare som tappar tre minuter på sträckan till 45:
 *
 *   pass 1: delta = 3600/6900 - 1800/5100 = 0,16880 -> 1165 tiondelar
 *   pass 2: nivån rensas, resSum = 6900 - 1165 = 5735
 *           delta = 3600/5735 - 1800/5100 = 0,27478 -> 1576 tiondelar
 *   pass 3: max(1165, 1576) = 1576 tiondelar, alltså 2:37 på kvittot
 *
 * Räkningen sker i tiondelar hela vägen och avrundas först vid presentation.
 * Rundas den till hela sekunder redan här hamnar facit på 1570 i stället.
 *
 * Att pass 2 ger ett större tal än pass 1 är själva skälet till att MeOS kör
 * två pass: bommen drar annars upp löparens skattade nivå och maskerar sig
 * själv.
 */
const BAS = new Map([
  ['S>31', { bas: 600, n: 8 }],
  ['31>32', { bas: 1200, n: 8 }],
  ['32>45', { bas: 1800, n: 8 }],
  ['45>50', { bas: 900, n: 8 }],
  ['50>M', { bas: 600, n: 8 }],
]);

const banan = [
  { nyckel: 'S>31' }, { nyckel: '31>32' }, { nyckel: '32>45' },
  { nyckel: '45>50' }, { nyckel: '50>M' },
];

const mina = (legs) =>
  legs.map((sek, i) => ({ nyckel: banan[i].nyckel, tiondelar: sek * 10 }));

test('bomtiden räknas i tre pass och tar det största utfallet', () => {
  const ut = bomtider({ mina: mina([60, 120, 360, 90, 60]), banan, baslinjer: BAS });
  assert.deepEqual(ut, [0, 0, 1576, 0, 0]);
});

test('en jämnt långsam löpare får inga bomtider', () => {
  // 1,5 gånger baslinjen på varje sträcka: den egna nivån räknas bort och
  // delta blir exakt noll. Det är skillnaden mot "efter bäste på sträckan",
  // som hade gett plus på varenda rad.
  const ut = bomtider({ mina: mina([90, 180, 270, 135, 90]), banan, baslinjer: BAS });
  assert.deepEqual(ut, [0, 0, 0, 0, 0]);
});

test('en sträcka snabbare än baslinjen ger aldrig en negativ bomtid', () => {
  const ut = bomtider({ mina: mina([40, 120, 180, 90, 60]), banan, baslinjer: BAS });
  assert.ok(ut.every((v) => v >= 0), `negativ bomtid: ${ut}`);
});

// --- de tre trösklarna, var för sig ----------------------------------------

test('en förlust under tjugo sekunder rapporteras inte', () => {
  // 15 s extra på sträckan till 50: deltaAbs blir 12 s, vilket klarar både
  // delta- och procentkravet men inte 20-sekunderskravet.
  const ut = bomtider({ mina: mina([60, 120, 180, 105, 60]), banan, baslinjer: BAS });
  assert.deepEqual(ut, [0, 0, 0, 0, 0]);
});

test('en förlust som är liten i förhållande till sträckan rapporteras inte', () => {
  // Sträckan tar sexton minuter och löparen tappar 22 s på den. Det klarar
  // både delta-tröskeln och de tjugo sekunderna, men är under 10 % av
  // sträckan – på en så lång sträcka är det inte en bom utan brus.
  const lång = new Map([...BAS, ['32>45', { bas: 10000, n: 8 }]]);
  const ut = bomtider({ mina: mina([60, 120, 1090, 90, 60]), banan, baslinjer: lång });
  assert.equal(ut[2], 0, 'en halv minut på en sextonminuterssträcka är ingen bom');
});

test('sträckor utan baslinje ger ingen bomtid', () => {
  // Gaffling: ingen annan har sprungit 32>77, så det finns inget att jämföra
  // med. Med indexnyckling hade sträckan felaktigt jämförts med 32>45.
  const gafflad = [
    { nyckel: 'S>31' }, { nyckel: '31>32' }, { nyckel: '32>77' },
    { nyckel: '77>50' }, { nyckel: '50>M' },
  ];
  const egna = gafflad.map((b, i) => ({
    nyckel: b.nyckel,
    tiondelar: [60, 120, 400, 100, 60][i] * 10,
  }));
  const bas = new Map([...BAS, ['32>77', { bas: 4000, n: 1 }], ['77>50', { bas: 1000, n: 1 }]]);
  assert.deepEqual(bomtider({ mina: egna, banan: gafflad, baslinjer: bas }), [0, 0, 0, 0, 0]);
});

/**
 * Golvet i MeOS trycker upp en sträcka som gått snabbare än baslinjen, och
 * summan måste räknas på de golvade värdena. Räknas resSum på de ogolvade
 * blir pass 1 och pass 2 oense om vilken nivå löparen håller, och bomtiden
 * drar iväg. Felet syns bara på en löpare som både är snabb någonstans och
 * bommar någon annanstans.
 */
test('summan räknas på de golvade sträcktiderna', () => {
  const ut = bomtider({ mina: mina([40, 120, 360, 90, 60]), banan, baslinjer: BAS });
  const utanSnabbSträcka = bomtider({
    mina: mina([60, 120, 360, 90, 60]),
    banan,
    baslinjer: BAS,
  });
  assert.deepEqual(ut, utanSnabbSträcka, 'den snabba sträckan ska golvas till baslinjen');
});

test('tomma och orimliga indata ger inga bomtider i stället för att spricka', () => {
  assert.deepEqual(bomtider({ mina: [], banan: [], baslinjer: BAS }), []);
  assert.deepEqual(
    bomtider({ mina: mina([0, 0, 0, 0, 0]), banan, baslinjer: new Map() }),
    [0, 0, 0, 0, 0]
  );
});

// ---------------------------------------------------------------------------
// Grindarna: när analysen inte får göras alls
// ---------------------------------------------------------------------------

test('en klass med för få löpare analyseras inte, och orsaken går att visa', () => {
  const klassen = [mina([60, 120, 180, 90, 60]), mina([70, 130, 190, 100, 70])];
  const ut = bomanalys({ klassensStrackor: klassen, mina: klassen[0], banan });
  assert.equal(ut.available, false);
  assert.equal(ut.orsak, 'underlag');
  assert.deepEqual(ut.bommar, [0, 0, 0, 0, 0]);
  assert.ok(MINSTA_UNDERLAG > klassen.length);
});

test('en bana med för få sträckor analyseras inte, och tigger inte om ursäkt', () => {
  // Radioflödet: ett par radiokontroller ger sträckor på en kvart styck, där
  // en bom på 20 sekunder inte går att se. Ingen notering visas.
  const kort = [{ nyckel: 'S>150', tiondelar: 9000 }, { nyckel: '150>M', tiondelar: 12000 }];
  const klassen = [kort, kort, kort, kort, kort];
  const ut = bomanalys({ klassensStrackor: klassen, mina: kort, banan: kort });
  assert.equal(ut.available, false);
  assert.equal(ut.orsak, 'strackor');
  assert.ok(kort.length < MINSTA_STRACKOR);
});

/**
 * Grinden mäter banan och inte vad löparen hann med: en felstämplad löpare
 * har färre giltiga sträckor än banan har, och det är just hon som har mest
 * nytta av att se var tiden gick.
 */
test('en felstämplad löpare på en hel bana analyseras ändå', () => {
  const hel = mina([60, 120, 180, 90, 60]);
  const utanEnKontroll = [
    { nyckel: 'S>31', tiondelar: 600 },
    { nyckel: '31>32', tiondelar: 3000 },
    { nyckel: '32>50', tiondelar: 3000 },
    { nyckel: '50>M', tiondelar: 600 },
  ];
  const ut = bomanalys({
    klassensStrackor: [hel, hel, utanEnKontroll],
    mina: utanEnKontroll,
    banan,
  });
  assert.equal(ut.available, true);
  assert.ok(ut.bommar[1] > 0, 'den långsamma sträckan till 32 ska ge en bomtid');
  assert.equal(ut.bommar[2], 0, 'sträckan över den saknade kontrollen ska inte ge någon');
});

test('med tillräckligt underlag görs analysen', () => {
  const klassen = [
    mina([60, 120, 180, 90, 60]),
    mina([60, 120, 180, 90, 60]),
    mina([60, 120, 360, 90, 60]),
  ];
  const ut = bomanalys({ klassensStrackor: klassen, mina: klassen[2], banan });
  assert.equal(ut.available, true);
  assert.equal(ut.orsak, null);
  assert.ok(ut.bommar[2] > 0, 'bommen på sträckan till 45 skulle hittas');
});

/**
 * En sträcka utan baslinje får inte bara sakna eget svar – den måste hållas
 * utanför hela räkningen. Räknas den med blir `delta` löparens hela andel av
 * sträckan minus noll, alltså en jättebom, och tiden drar dessutom upp den
 * skattade hastighetsnivån så att bomtiden på alla andra sträckor förskjuts.
 */
test('en sträcka utan baslinje ger varken bomtid eller rubbar de andra', () => {
  const utan = new Map([...BAS]);
  utan.delete('31>32');
  const ut = bomtider({ mina: mina([60, 120, 360, 90, 60]), banan, baslinjer: utan });
  assert.equal(ut[1], 0, 'sträckan utan baslinje ska inte få någon bomtid');
  assert.ok(ut[2] > 0, 'bommen på sträckan till 45 ska fortfarande hittas');
});
