/** Delade MOP-fixturer för enhetstester (test/) och BDD-scenarier (features/). */

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

/** Komplett tävling utan löpare (för flertävlingsscenarier). */
export function mopCompleteMinimal({ name = 'Nyare tävlingen', date = '2026-09-01' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop">
  <competition date="${date}" organizer="Testklubben OK">${name}</competition>
</MOPComplete>`;
}
