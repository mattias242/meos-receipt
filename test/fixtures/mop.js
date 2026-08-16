/**
 * Delade MOP-fixturer för enhetstester (test/) och BDD-scenarier (features/).
 *
 * Löparna i MOP_COMPLETE täcker de statusar kvittot måste hantera:
 *   31 Anna Andersson  (123456) godkänd med radiotider
 *   32 Berit Bengtsson (654321) godkänd, snabbast i klassen
 *   33 Carl Carlsson   (111111) ute på banan, inget resultat än
 *   34 Doris Dahl      (222222) utgått efter start
 *   35 Eva Ek          (444444) ej start, men med tilldelad starttid
 */

export const MOP_COMPLETE = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <competition date="2026-08-06" organizer="Testklubben OK" homepage="https://example.org">Testtävlingen</competition>
  <ctrl id="150">Radio 1</ctrl>
  <ctrl id="162">Förvarning</ctrl>
  <cls id="1" ord="1" radio="150,162">H21</cls>
  <cls id="2" ord="2">D21</cls>
  <org id="5" nat="SWE">OK Skogen</org>
  <cmp id="31" card="123456">
    <base org="5" cls="1" stat="1" st="360000" rt="21000" bib="12">Anna Andersson</base>
    <radio>150,9000;162,18000</radio>
  </cmp>
  <cmp id="32" card="654321">
    <base org="5" cls="1" stat="1" st="366000" rt="19500">Berit Bengtsson</base>
    <radio>150,8500;162,17000</radio>
  </cmp>
  <cmp id="33" card="111111">
    <base org="5" cls="1" stat="0" st="372000" rt="0">Carl Carlsson</base>
  </cmp>
  <cmp id="34" card="222222">
    <base org="5" cls="2" stat="4" st="360000" rt="0">Doris Dahl</base>
  </cmp>
  <cmp id="35" card="444444">
    <base org="5" cls="2" stat="20" st="378000" rt="0">Eva Ek</base>
  </cmp>
</MOPComplete>`;

/**
 * Stafett: två löpare som ingår i ett lag (MOP-elementet `tm`, med `r` som
 * anger medlemmar per sträcka).
 *   41 Erik Etapp   (777777) sträcka 1
 *   42 Frida Etapp  (888888) sträcka 2
 *   lag 7 "OK Skogen 1"
 */
export const MOP_STAFETT = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <competition date="2026-08-06" organizer="Testklubben OK">Stafetten</competition>
  <cls id="3" ord="3">H21 Stafett</cls>
  <org id="5" nat="SWE">OK Skogen</org>
  <cmp id="41" card="777777">
    <base org="5" cls="3" stat="1" st="360000" rt="12000">Erik Etapp</base>
  </cmp>
  <cmp id="42" card="888888">
    <base org="5" cls="3" stat="1" st="372000" rt="13000">Frida Etapp</base>
  </cmp>
  <cmp id="43" card="999999">
    <base org="5" cls="3" stat="1" st="360000" rt="14000">Gustav Ensam</base>
  </cmp>
  <tm id="7">
    <base org="5" cls="3" stat="1" st="360000" rt="25000">OK Skogen 1</base>
    <r>41;42</r>
  </tm>
</MOPComplete>`;

/** Diff där Carl Carlsson går i mål med preliminärt resultat. */
export const MOP_DIFF_CARL = `<?xml version="1.0" encoding="UTF-8"?>
<MOPDiff xmlns="http://www.melin.nu/mop">
  <cmp id="33" card="111111">
    <base org="5" cls="1" stat="1" st="372000" rt="18000" prel="true">Carl Carlsson</base>
    <radio>150,8000;162,16000</radio>
  </cmp>
</MOPDiff>`;

/** Diff som anmäler ytterligare en löpare (t.ex. med delad bricka). */
export function mopDiffExtraRunner({ id = 40, card = 123456, cls = 2, name = 'Erik Ek' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MOPDiff xmlns="http://www.melin.nu/mop">
  <cmp id="${id}" card="${card}">
    <base org="5" cls="${cls}" stat="0" st="0" rt="0">${name}</base>
  </cmp>
</MOPDiff>`;
}

/**
 * Komplett tävling med många likadant namngivna löpare, för att pröva
 * beteendet vid breda sökningar (KRAV-5) och vid realistisk deltagarvolym.
 */
export function mopCompleteManyRunners(n = 150, { name = 'Storatävlingen' } = {}) {
  const cmps = Array.from(
    { length: n },
    (_, i) =>
      `  <cmp id="${i + 1}" card="${500000 + i}">` +
      `<base org="5" cls="1" stat="1" st="${360000 + i * 100}" rt="${20000 + i}">` +
      `Löpare ${i + 1} Efternamn</base></cmp>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <competition date="2026-08-06" organizer="Stora OK">${name}</competition>
  <cls id="1" ord="1">H21</cls>
  <org id="5" nat="SWE">OK Skogen</org>
${cmps}
</MOPComplete>`;
}

/**
 * En komplett tävling styckad så som MeOS faktiskt skickar den (KRAV-1).
 *
 * MeOS skickar inte en tävling i ett anrop utan i klumpar om `chunk`
 * toppnivåobjekt – tävlingen, varje kontroll, klass, klubb, lag och löpare
 * räknas som ett objekt vardera. Bara den *första* klumpen bär rotelementet
 * `MOPComplete`; flaggan konsumeras av MeOS när den skrivits, så resten kommer
 * som `MOPDiff`. En mottagare som bara klarar den första klumpen tappar
 * merparten av deltagarfältet, och eftersom metadatan ligger först är det just
 * löparna som faller bort.
 *
 * Returnerar en lista med XML-dokument att posta i tur och ordning.
 */
export function mopChunkedSend(n = 150, { chunk = 64, name = 'Styckade tävlingen' } = {}) {
  const objekt = [
    `  <competition date="2026-08-06" organizer="Stora OK">${name}</competition>`,
    '  <cls id="1" ord="1">H21</cls>',
    '  <org id="5" nat="SWE">OK Skogen</org>',
    ...Array.from(
      { length: n },
      (_, i) =>
        `  <cmp id="${i + 1}" card="${500000 + i}">` +
        `<base org="5" cls="1" stat="1" st="${360000 + i * 100}" rt="${20000 + i}">` +
        `Löpare ${i + 1} Efternamn</base></cmp>`
    ),
  ];

  const delar = [];
  for (let i = 0; i < objekt.length; i += chunk) {
    const rot = i === 0 ? 'MOPComplete' : 'MOPDiff';
    delar.push(
      `<?xml version="1.0" encoding="UTF-8"?>\n<${rot} xmlns="http://www.melin.nu/mop">\n` +
        `${objekt.slice(i, i + chunk).join('\n')}\n</${rot}>`
    );
  }
  return delar;
}

/** Komplett tävling utan löpare (för flertävlingsscenarier). */
export function mopCompleteMinimal({ name = 'Nyare tävlingen', date = '2026-09-01' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <competition date="${date}" organizer="Testklubben OK">${name}</competition>
</MOPComplete>`;
}
