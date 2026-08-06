/**
 * Jämför tjänstens kvitton mot en riktig resultatfil.
 *
 *   node tools/korsvalidera.mjs <resultatfil.xml> <url> [tävlings-id]
 *
 * Testsviten bevisar att koden gör vad vi tror. Det här verktyget prövar om vi
 * trott rätt: filen är facit, och varje löpares namn, klass, status, placering,
 * måltid och sträcktider jämförs mot vad tjänsten svarar.
 *
 * Flera av de allvarligaste felen i projektet hittades precis så – bland annat
 * att 40 av 110 löpare fick felaktiga sträcktider när en kontrollenhet hade
 * fel klocka. Inget av dem syntes i testerna.
 *
 * Filen läses med en egen, enkel tolkning och inte med lib/iof.js, så att
 * jämförelsen inte blir cirkulär. Skarpa resultatfiler innehåller
 * personuppgifter och ska inte checkas in.
 */
import fs from 'node:fs';

const [fil, bas, tavling] = process.argv.slice(2);
if (!fil || !bas) {
  console.error('Användning: node tools/korsvalidera.mjs <resultatfil.xml> <url> [tävlings-id]');
  process.exit(2);
}

const STATUS = {
  OK: 'Godkänd',
  MissingPunch: 'Felstämplad',
  DidNotStart: 'Ej start',
  DidNotFinish: 'Utgått',
  Disqualified: 'Diskvalificerad',
  OverTime: 'Över maxtid',
  NotCompeting: 'Utom tävlan',
};

const klocka = (iso) => (iso.match(/T(\d\d:\d\d:\d\d)/) || [, ''])[1];
const varaktighet = (sek) => {
  const h = Math.floor(sek / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = String(sek % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
const taggInnehall = (block, tagg) => {
  const m = block.match(new RegExp(`<${tagg}>([^<]*)</${tagg}>`));
  return m ? m[1].trim() : null;
};

const xml = fs.readFileSync(fil, 'utf8');
const url = bas.replace(/\/$/, '');
const cmpParam = tavling ? `cmp=${tavling}&` : '';

const avvikelser = [];
let kollade = 0;
let ejFunna = 0;

for (const klassBlock of xml.match(/<ClassResult>[\s\S]*?<\/ClassResult>/g) || []) {
  const klass = (klassBlock.match(/<Class>[\s\S]*?<Name>([^<]*)<\/Name>/) || [, ''])[1].trim();

  for (const person of klassBlock.match(/<PersonResult>[\s\S]*?<\/PersonResult>/g) || []) {
    const kort = taggInnehall(person, 'ControlCard');
    if (!kort) continue;
    kollade++;

    const namn = [taggInnehall(person, 'Given'), taggInnehall(person, 'Family')]
      .filter(Boolean)
      .join(' ');
    const status = taggInnehall(person, 'Status');
    const position = taggInnehall(person, 'Position');
    const malIso = (person.match(/<FinishTime>([^<]*)<\/FinishTime>/) || [, ''])[1];
    // Totaltiden står i Result efter FinishTime; utan måltid finns ingen.
    const totalM = person.match(/<FinishTime>[^<]*<\/FinishTime>\s*<Time>(\d+)<\/Time>/);
    const total = totalM ? Number(totalM[1]) : null;

    let svar;
    try {
      const res = await fetch(`${url}/api/receipt?${cmpParam}card=${kort}`);
      if (!res.ok) {
        ejFunna++;
        avvikelser.push(`bricka ${kort} (${namn}): tjänsten svarade ${res.status}`);
        continue;
      }
      svar = await res.json();
    } catch (err) {
      console.error(`Kunde inte nå ${url}: ${err.message}`);
      process.exit(1);
    }

    const jamfor = (vad, forvantat, faktiskt) => {
      if (forvantat !== null && forvantat !== undefined && String(forvantat) !== String(faktiskt)) {
        avvikelser.push(`bricka ${kort} (${namn}) ${vad}: filen=${forvantat} tjänsten=${faktiskt}`);
      }
    };

    jamfor('namn', namn, svar.runner.name);
    jamfor('klass', klass, svar.runner.class);
    jamfor('status', STATUS[status] ?? status, svar.result.statusText);
    jamfor('placering', position, svar.result.place ?? '');
    if (malIso) jamfor('måltid', klocka(malIso), svar.result.finishTime);

    // Sträcktider: filens tider i tidsordning, bortsett från sådana som ligger
    // utanför loppet (gamla stämplingar i brickan visas medvetet utan tid).
    const filensSplits = [];
    for (const s of person.match(/<SplitTime[\s\S]*?<\/SplitTime>/g) || []) {
      const kod = taggInnehall(s, 'ControlCode');
      const tid = taggInnehall(s, 'Time');
      if (!kod || !tid) continue;
      if (total !== null && Number(tid) > total) continue;
      filensSplits.push({ kod, tid: Number(tid) });
    }
    filensSplits.sort((a, b) => a.tid - b.tid);

    const tjanstensSplits = svar.splits.filter((s) => s.elapsed && s.name !== 'Mål');
    const filOrdning = filensSplits.map((s) => s.kod).join(',');
    const tjanstOrdning = tjanstensSplits.map((s) => s.name).join(',');
    if (filOrdning !== tjanstOrdning) {
      avvikelser.push(
        `bricka ${kort} (${namn}) stämplingsordning: filen=${filOrdning} tjänsten=${tjanstOrdning}`
      );
      continue;
    }

    let forra = 0;
    filensSplits.forEach((s, i) => {
      jamfor(`sträcktid till ${s.kod}`, varaktighet(s.tid - forra), tjanstensSplits[i].leg);
      forra = s.tid;
    });
  }
}

console.log(`Jämförde ${kollade} löpare i ${fil} mot ${url}`);
if (ejFunna) console.log(`  ${ejFunna} hittades inte i tjänsten`);

if (avvikelser.length === 0) {
  console.log('Inga avvikelser.');
  process.exit(0);
}
console.log(`\n${avvikelser.length} avvikelser:`);
for (const a of avvikelser.slice(0, 40)) console.log(`  ${a}`);
if (avvikelser.length > 40) console.log(`  … och ${avvikelser.length - 40} till`);
process.exit(1);
