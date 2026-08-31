/**
 * Bomanalys – tidsförlust per kontroll (KRAV-25).
 *
 * Översatt från MeOS egen implementation, så att kvittot visar samma mått som
 * MeOS sträcktidsutskrift:
 *   - baslinjen per sträcka: `oClass::calculateSplits()`, oClass.cpp 3567-3823
 *   - bomtiden per sträcka:  `oRunner::getSplitAnalysis()`, oRunner.cpp 5916-6015
 *
 * **Det här är inte "efter bäste på sträckan".** MeOS utskrift bär två mått som
 * båda ser ut som bomtid: kolumnen `includeTimeLoss` (sträcktid minus ledartid)
 * och den här analysen. Skillnaden är att analysen först skattar löparens egen
 * hastighetsnivå – kvoten mellan hennes sträcktider och klassens baslinje – och
 * räknar bort den. Den som är jämnt långsam får därför noll bom, medan
 * "efter bäste" hade satt ett plus på varenda rad. Blanda inte ihop dem.
 *
 * MOP-protokollet bär inget av detta: varken `mop.xsd` eller specen nämner
 * tidsförlust, median eller analys. Allt räknas här, ur klassens sträcktider.
 *
 * Modulen känner inte MeOS datamodell. Den tar färdiga sträckor i tiondelar
 * och lämnar tiondelar ifrån sig, så att den går att pröva utan att bygga ett
 * kvitto – och så att `lib/receipt.js` behåller ansvaret för vilka stämplingar
 * som duger (KRAV-10).
 *
 * Allt räknande sker i tiondels sekunder, som resten av projektet. MeOS
 * tjugosekunderströskel är därför 200 och inte 20.
 */

/** Minsta antal löpare i klassen med sträcktider. MeOS egen gräns. */
export const MINSTA_UNDERLAG = 3;

/**
 * Minsta antal giltiga sträckor hos löparen.
 *
 * Gränsen går på antal sträckor och inte på vilket inflöde datat kom från.
 * MOP-flödet med två radiokontroller ger sträckor på en kvart, där en bom på
 * tjugo sekunder inte går att se och en verklig treminutersbom tillskrivs en
 * sträcka löparen inte kan göra något åt. Samtidigt kan MOP bära hela banan
 * när arrangören kryssat i "skicka alla sträcktider", och då ska analysen
 * göras. En regel på antal sträckor täcker båda fallen utan en gren per flöde.
 */
export const MINSTA_STRACKOR = 5;

const TROSKEL = 200;      // deltaAbs >= 20 sekunder
const ANDEL = 0.1;        // deltaAbs > 10 % av sträcktiden
const MINSTA_DELTA = 0.01; // MeOS relativa tröskel, dimensionslös

const summa = (a, b) => a + b;

/**
 * Sträckans nyckel: kontrollkodsparet, aldrig radindex.
 *
 * Vid gaffling är två löpares tredje sträcka olika sträckor i skogen, och bara
 * kodparet jämför det som faktiskt sprungits lika. Start och mål har ingen kod
 * och får sentinelerna `S` och `M`.
 */
export function nyckel(från, till) {
  return `${från}>${till}`;
}

/**
 * Klassens baslinje per sträcka, i tiondelar och utan avrundning.
 *
 * `klassensStrackor` är en post per löpare: listan av sträckor hon har giltig
 * tid på. Vilka löpare som ingår, och vilka tider som är giltiga, avgörs av
 * anroparen – opålitliga tider (KRAV-10) får aldrig komma hit, varken som egen
 * bomtid eller som underlag för andras baslinje.
 */
export function baslinjer(klassensStrackor) {
  const tider = new Map();
  for (const löpare of klassensStrackor || []) {
    for (const sträcka of löpare || []) {
      if (!(sträcka.tiondelar > 0)) continue;
      if (!tider.has(sträcka.nyckel)) tider.set(sträcka.nyckel, []);
      tider.get(sträcka.nyckel).push(sträcka.tiondelar);
    }
  }

  const ut = new Map();
  for (const [key, lista] of tider) {
    const t = [...lista].sort((a, b) => a - b);
    const n = t.length;
    let bas;
    if (n < 5) {
      bas = t[0];
    } else if (n < 12) {
      bas = (t[0] + t[1]) / 2;
    } else {
      // Vinnaren hoppas över: en enskild urlöpning ska inte bestämma vad som
      // är en normal sträcktid för klassen.
      const sista = Math.floor(n / 6);
      const urval = t.slice(1, sista + 1);
      bas = urval.reduce(summa, 0) / urval.length;
    }
    ut.set(key, { bas, n });
  }
  return ut;
}

/**
 * Ett pass av MeOS analys. `res` och `bas` är index-alignade tiondelar.
 *
 * MeOS delar med sin `bestTime` – baslinjen summerad över hela banan – medan
 * `baseSum` är summan över de sträckor löparen har tid på. Hos MeOS är de
 * samma tal för den som sprungit hela banan, och kvoten mellan dem faller ur
 * formeln. Här delar vi med `baseSum` i båda leden, och det är avsiktligt:
 * MeOS känner banan, vi känner bara löparnas stämplingar. Sträckan över en
 * saknad kontroll får därför en nyckel nästan ingen delar, och dess baslinje
 * ligger i `baseSum` men aldrig i banans summa.
 *
 * Skillnaden är inte kosmetisk. Med två olika nämnare kan `baseSum` överstiga
 * banans summa, och då tappar `deltaAbs` sitt tak: uppmätt på Vinterrace 4
 * fick en löpare med sex saknade kontroller bomtiden 11:12 på en sträcka som
 * tog 8:32 – mer tid förlorad än sträckan varade. Med en och samma nämnare
 * gäller alltid deltaAbs <= res[k], eftersom res[k] >= bas[k] efter golvet och
 * resSum >= baseSum följer av det.
 */
function pass(res, bas, resSum, baseSum) {
  const ut = new Array(res.length).fill(0);
  for (let k = 0; k < res.length; k++) {
    const part = res[k] / resSum;
    const delta = part - bas[k] / baseSum;
    const deltaAbs = Math.round(delta * resSum);
    // Alla tre måste hålla. Utan dem blir varje kontroll en bom: den relativa
    // tröskeln sållar bort bruset, procentkravet skyddar de långa sträckorna
    // och tjugo sekunder är den minsta förlust en löpare kan känna igen.
    if (
      Math.abs(delta) > MINSTA_DELTA &&
      deltaAbs > ANDEL * res[k] &&
      deltaAbs >= TROSKEL
    ) {
      ut[k] = deltaAbs;
    }
  }
  return ut;
}

/**
 * Bomtid per sträcka i tiondelar, index-alignat med `mina`. 0 = ingen bom.
 *
 * `mina` är löparens sträckor med giltig tid. Banan behövs inte här – den
 * används bara till grinden i `bomanalys`, se `pass` för varför nämnaren är
 * densamma i båda leden.
 */
export function bomtider({ mina, baslinjer: bas }) {
  const strackor = mina || [];
  const ut = strackor.map(() => 0);
  if (!strackor.length) return ut;

  const baslinje = strackor.map((s) => bas.get(s.nyckel)?.bas ?? 0);

  // Sträckor utan baslinje lämnas utanför hela räkningen, inte bara utan eget
  // svar. Räknas de med blir `delta` hela löparens andel av sträckan minus
  // noll, vilket ser ut som en jättebom – och deras tid skulle dessutom dra upp
  // den skattade hastighetsnivån och förskjuta bomtiden på alla andra sträckor.
  const med = [];
  for (let k = 0; k < strackor.length; k++) if (baslinje[k] > 0) med.push(k);
  if (!med.length) return ut;

  const b = med.map((k) => baslinje[k]);
  // Golvet: en sträcka snabbare än baslinjen trycks upp till den. Summan måste
  // räknas på de golvade värdena – annars är pass 1 och pass 2 oense om vilken
  // nivå löparen håller, och bomtiden drar iväg.
  const res = med.map((k, i) => Math.max(strackor[k].tiondelar, b[i]));

  const baseSum = b.reduce(summa, 0);
  const resSum = res.reduce(summa, 0);

  if (!(baseSum > 0) || !(resSum > 0)) return ut;

  const första = pass(res, b, resSum, baseSum);

  // Pass 2 räknar om på en bomfri nivå. Utan det maskerar en stor bom sig
  // själv: den drar upp löparens skattade hastighetsnivå, och avvikelsen mot
  // den egna nivån blir mindre än den var.
  const bomfri = resSum - första.reduce(summa, 0);
  const andra = bomfri > 0 ? pass(res, b, bomfri, baseSum) : första;

  med.forEach((k, i) => {
    ut[k] = Math.max(första[i], andra[i]);
  });
  return ut;
}

/**
 * Hela analysen med sina grindar.
 *
 * `orsak` skiljer de två skälen att avstå: `'underlag'` betyder att klassen är
 * för liten och ska sägas rakt ut, medan `'strackor'` betyder att banan har för
 * få sträckor – och då sägs ingenting alls, eftersom en permanent ursäkt under
 * varje kvitto i radioflödet vore brus.
 */
export function bomanalys({ klassensStrackor, mina, banan }) {
  const strackor = mina || [];
  const tomt = strackor.map(() => 0);
  const underlag = (klassensStrackor || []).filter((s) => (s || []).length > 0).length;

  // Grinden mäter BANAN och inte vad löparen hann med. Räknades hennes egna
  // giltiga sträckor skulle en felstämpling kunna ta bort analysen för de
  // sträckor hon faktiskt har tid på – och det är just den löparen som har
  // mest nytta av att se var tiden gick.
  if ((banan || []).length < MINSTA_STRACKOR) {
    return { available: false, orsak: 'strackor', bommar: tomt };
  }
  if (underlag < MINSTA_UNDERLAG) {
    return { available: false, orsak: 'underlag', bommar: tomt };
  }
  return {
    available: true,
    orsak: null,
    bommar: bomtider({ mina: strackor, baslinjer: baslinjer(klassensStrackor) }),
  };
}
