/**
 * Mäter vad tjänsten gör med en tävling i skarp storlek.
 *
 *   node tools/lasttest.mjs [antal löpare] [antal klasser]
 *
 * Testsviten kör med en handfull löpare. Den bevisar att koden gör rätt, men
 * inte att den gör det i tid när tusen personer går i mål inom en timme. Det
 * här verktyget svarar på fyra frågor som annars besvaras först under
 * tävlingen, när det är för sent:
 *
 *   1. Ryms sändningen? MeOS styckar en tävling i klumpar om 64 objekt, men
 *      den första klumpen bär hela metadatan och kroppen har ett tak på 32 MB
 *      (nginx har dessutom sitt eget, `client_max_body_size`).
 *   2. Hur länge blockerar sparningen eventloopen? Den är synkron, och under
 *      tävling skickar MeOS var tionde sekund.
 *   3. Hur snabbt får löparen sitt kvitto medan sändningarna pågår?
 *   4. Var tar läsgränsen (KRAV-5)? Den räknar olika löpare per klient-IP, och
 *      på arenan ligger hundratals löpare bakom samma operatörsadress.
 *
 * Datan är syntetisk – inga personuppgifter, så verktyget kan checkas in och
 * köras av vem som helst.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

const antalLöpare = parseInt(process.argv[2] || '1000', 10);
const antalKlasser = parseInt(process.argv[3] || '20', 10);

const ms = (n) => `${n.toFixed(1)} ms`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/**
 * En tävling som liknar en riktig: klasser, klubbar, radiokontroller och
 * löpare med sträcktider. Utan radiotiderna blir sändningen bara en bråkdel
 * av sin verkliga storlek, och mätningen ljuger.
 */
function byggTavling(n, klasser) {
  const kontroller = [100, 110, 120, 130, 140];
  const objekt = [
    `  <competition date="2026-09-05" organizer="Stora OK" homepage="https://example.org">Lasttestet</competition>`,
    ...kontroller.map((k) => `  <ctrl id="${k}">Radio ${k}</ctrl>`),
    ...Array.from(
      { length: klasser },
      (_, i) => `  <cls id="${i + 1}" ord="${i + 1}" radio="${kontroller.join(',')}">Klass ${i + 1}</cls>`
    ),
    ...Array.from({ length: 30 }, (_, i) => `  <org id="${i + 1}" nat="SWE">Klubb ${i + 1} OK</org>`),
    ...Array.from({ length: n }, (_, i) => {
      const rt = 20000 + ((i * 37) % 18000);
      const radio = kontroller
        .map((k, j) => `${k},${Math.round((rt * (j + 1)) / (kontroller.length + 1))}`)
        .join(';');
      return (
        `  <cmp id="${i + 1}" card="${500000 + i}">` +
        `<base org="${(i % 30) + 1}" cls="${(i % klasser) + 1}" stat="1" ` +
        `st="${360000 + i * 50}" rt="${rt}" bib="${i + 1}">Förnamn${i + 1} Efternamn${i % 200}</base>` +
        `<radio>${radio}</radio></cmp>`
      );
    }),
  ];
  return objekt;
}

/** Styckar som MeOS gör: 64 objekt per anrop, bara det första är MOPComplete. */
function styckaSom(objekt, chunk = 64) {
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

/**
 * Hur länge eventloopen stod stilla. En timer som ska gå var 10:e ms – det den
 * blir försenad är tid då ingen löpare kunde få svar.
 */
function mätBlockering() {
  let värsta = 0;
  let sist = performance.now();
  const timer = setInterval(() => {
    const nu = performance.now();
    värsta = Math.max(värsta, nu - sist - 10);
    sist = nu;
  }, 10);
  timer.unref?.();
  return {
    stopp() {
      clearInterval(timer);
      return värsta;
    },
  };
}

async function mät(fn, gånger = 20) {
  const tider = [];
  for (let i = 0; i < gånger; i++) {
    const t0 = performance.now();
    await fn(i);
    tider.push(performance.now() - t0);
  }
  tider.sort((a, b) => a - b);
  return {
    median: tider[Math.floor(tider.length / 2)],
    p95: tider[Math.floor(tider.length * 0.95)] ?? tider[tider.length - 1],
    värsta: tider[tider.length - 1],
  };
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-lasttest-'));
const app = createApp({ dataDir, password: 'lasttest', saveDelayMs: 100, readLimit: 1000 });
const server = await new Promise((r) => {
  const s = app.listen(0, () => r(s));
});
const bas = `http://127.0.0.1:${server.address().port}`;
const cid = '26090501';

console.log(`Lasttest: ${antalLöpare} löpare, ${antalKlasser} klasser\n`);

// --- 1. Sändningen -------------------------------------------------------
const objekt = byggTavling(antalLöpare, antalKlasser);
const helSändning = `<?xml version="1.0"?>\n<MOPComplete xmlns="http://www.melin.nu/mop">\n${objekt.join('\n')}\n</MOPComplete>`;
const delar = styckaSom(objekt);
const störstaDel = Math.max(...delar.map((d) => Buffer.byteLength(d)));

console.log('SÄNDNING');
console.log(`  Hela tävlingen i ett anrop   ${mb(Buffer.byteLength(helSändning))}`);
console.log(`  Största klump som MeOS gör   ${mb(störstaDel)} (${delar.length} anrop)`);
const tak = 32 * 1024 * 1024;
console.log(
  `  Mot 32 MB-taket              ${störstaDel > tak ? 'ÖVER TAKET' : 'ryms (' + ((störstaDel / tak) * 100).toFixed(2) + ' % av taket)'}`
);

// --- 2. Mottagning och sparning ------------------------------------------
const block = mätBlockering();
const t0 = performance.now();
for (const del of delar) {
  const res = await fetch(`${bas}/meos`, {
    method: 'POST',
    headers: { competition: cid, pwd: 'lasttest', 'content-type': 'application/xml' },
    body: del,
  });
  const svar = await res.text();
  if (!svar.includes('status="OK"')) {
    console.error(`  AVBRÖT: servern svarade ${svar}`);
    process.exit(1);
  }
}
const sändningsTid = performance.now() - t0;
await app.locals.store.flush?.();
const blockering = block.stopp();

console.log('\nMOTTAGNING');
console.log(`  Hela tävlingen mottagen      ${ms(sändningsTid)}`);
console.log(`  Värsta blockerade eventloop  ${ms(blockering)}`);

const fil = path.join(dataDir, 'tavlingar', `${cid}.json`);
if (fs.existsSync(fil)) console.log(`  Sparad fil på disk           ${mb(fs.statSync(fil).size)}`);

// --- 3. Svarstider medan sändningar pågår --------------------------------
// En diff var tionde sekund är vad MeOS gör under tävling. Här skickas de så
// tätt det går, alltså värre än verkligheten.
let störning = true;
const diff = styckaSom(objekt.slice(-64))[0].replace('MOPComplete', 'MOPDiff');
const störa = (async () => {
  while (störning) {
    await fetch(`${bas}/meos`, {
      method: 'POST',
      headers: { competition: cid, pwd: 'lasttest', 'content-type': 'application/xml' },
      body: diff,
    });
  }
})();

const kvitto = await mät((i) => fetch(`${bas}/api/receipt?cmp=${cid}&card=${500000 + i}`));
const pdf = await mät((i) => fetch(`${bas}/api/receipt.pdf?cmp=${cid}&card=${500000 + i}`), 10);
const sök = await mät(() => fetch(`${bas}/api/search?q=Efternamn7&cmp=${cid}`), 10);
störning = false;
await störa;

console.log('\nSVARSTIDER MEDAN MEOS SÄNDER (median / p95 / värsta)');
console.log(`  Kvitto      ${ms(kvitto.median)} / ${ms(kvitto.p95)} / ${ms(kvitto.värsta)}`);
console.log(`  PDF         ${ms(pdf.median)} / ${ms(pdf.p95)} / ${ms(pdf.värsta)}`);
console.log(`  Sökning     ${ms(sök.median)} / ${ms(sök.p95)} / ${ms(sök.värsta)}`);

// --- 4. Läsgränsen -------------------------------------------------------
// Alla anrop här kommer från samma adress, precis som när hundratals löpare
// ligger bakom en operatörs CGNAT. Frågan är hur många som hinner få sitt
// kvitto innan taket slår till.
const grans = createApp({ dataDir: null, password: 'x', readLimit: 1000 });
const gservern = await new Promise((r) => {
  const s = grans.listen(0, () => r(s));
});
const gbas = `http://127.0.0.1:${gservern.address().port}`;
await fetch(`${gbas}/meos`, {
  method: 'POST',
  headers: { competition: cid, pwd: 'x', 'content-type': 'application/xml' },
  body: helSändning,
});

let egnaKvitton = 0;
for (let i = 0; i < antalLöpare; i++) {
  const r = await fetch(`${gbas}/api/receipt?cmp=${cid}&card=${500000 + i}`);
  if (r.status === 429) break;
  egnaKvitton++;
}
// Marginalen är det som betyder något: hur många fler som ryms innan taket.
let överskott = 0;
while (överskott < antalLöpare) {
  const r = await fetch(`${gbas}/api/receipt?cmp=${cid}&id=${overskottsId(överskott)}`);
  if (r.status === 429) break;
  överskott++;
}

console.log('\nLÄSGRÄNSEN (READ_LIMIT=1000, allt från samma IP)');
console.log(`  Egna kvitton innan taket     ${egnaKvitton} av ${antalLöpare}`);
console.log(`  Marginal därefter            ${överskott} kvitton kvar till taket`);

// Det realistiska fallet: löparen söker på sitt namn först. En sökning kostar
// en identitet per träff, så den som inte skannar QR-koden kostar mer än en.
const grans2 = createApp({ dataDir: null, password: 'x', readLimit: 1000 });
const g2 = await new Promise((r) => {
  const s = grans2.listen(0, () => r(s));
});
const g2bas = `http://127.0.0.1:${g2.address().port}`;
await fetch(`${g2bas}/meos`, {
  method: 'POST',
  headers: { competition: cid, pwd: 'x', 'content-type': 'application/xml' },
  body: helSändning,
});
// Varje löpare söker på sitt efternamn och öppnar sedan sitt kvitto. Med 200
// efternamn på 1000 löpare ger varje sökning fem träffar – ungefär som en
// verklig tävling, där ett efternamn sällan är unikt.
let löpareMedSökning = 0;
for (let i = 0; i < antalLöpare; i++) {
  const s = await fetch(`${g2bas}/api/search?q=Efternamn${i % 200}&cmp=${cid}`);
  if (s.status === 429) break;
  const k = await fetch(`${g2bas}/api/receipt?cmp=${cid}&card=${500000 + i}`);
  if (k.status === 429) break;
  löpareMedSökning++;
}
console.log(`  Om löparna söker på namn     ${löpareMedSökning} av ${antalLöpare} hinner se sitt kvitto`);
if (löpareMedSökning < antalLöpare) {
  const rek = Math.ceil((antalLöpare / löpareMedSökning) * 1000 * 1.5);
  console.log(
    `  ⚠ Taket nås efter ${löpareMedSökning} löpare. Höj READ_LIMIT till minst ${rek} inför helgen.`
  );
}

/** Ett löpar-id som inte redan räknats, för att mäta marginalen. */
function overskottsId(n) {
  return antalLöpare + n + 1;
}

server.close();
gservern.close();
g2.close();
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
