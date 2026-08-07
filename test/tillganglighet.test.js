import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * KRAV-17: kvittosidan läses i mobil, ofta utomhus i dagsljus. Färgerna hämtas
 * ur styles.css i stället för att upprepas här, så att en omfärgning som
 * försämrar läsbarheten fångas i stället för att slinka igenom en granskning.
 */

const CSS = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'styles.css'),
  'utf8'
);

/** Värdet på en CSS-variabel i :root, t.ex. --bg. */
function variabel(namn) {
  const m = CSS.match(new RegExp(`${namn}\\s*:\\s*([^;]+);`));
  assert.ok(m, `variabeln ${namn} saknas i styles.css`);
  return m[1].trim();
}

/** Som deklaration(), men null när egenskapen inte är satt i regeln. */
function deklarationOm(selektor, egenskap) {
  const esc = selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regel = CSS.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
  if (!regel) return null;
  const m = regel[1].match(new RegExp(`(?:^|[;\\s])${egenskap}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** Värdet på en deklaration inuti en regel, t.ex. ('main .lead', 'color'). */
function deklaration(selektor, egenskap) {
  const esc = selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regel = CSS.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(regel, `regeln ${selektor} saknas i styles.css`);
  const m = regel[1].match(new RegExp(`(?:^|[;\\s])${egenskap}\\s*:\\s*([^;]+);`));
  assert.ok(m, `${egenskap} saknas i ${selektor}`);
  return m[1].trim();
}

function relativLuminans(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  assert.match(h, /^[0-9a-f]{6}$/i, `kan inte tolka färgen ${hex}`);
  const kanal = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanal(0) + 0.7152 * kanal(2) + 0.0722 * kanal(4);
}

function kontrast(fg, bg) {
  const a = relativLuminans(fg);
  const b = relativLuminans(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const LITEN = 4.5; // WCAG AA, brödtext
const STOR = 3.0; // WCAG AA, stor eller fet text

/**
 * Vilket krav som gäller för texten i en regel, härlett ur dess egen
 * typografi. WCAG räknar text som stor från 18,66 px om den är fet, annars
 * från 24 px – och gränsen betyder något: toppradens vita text mot det röda
 * bandet mäter 4,44:1, vilket klarar 3:1 men inte 4,5:1. Skrivs kravet i
 * stället för hand fortsätter testet godkänna den även om någon gör rubriken
 * mindre eller tar bort fetstilen, och då syns det först ute i solen.
 */
function kravFör(selektor) {
  const rem = 16;
  const px = (v) => (v.endsWith('rem') ? parseFloat(v) * rem : parseFloat(v));
  const storlek = px(deklaration(selektor, 'font-size'));
  // font-weight utelämnas ofta; utan den gäller webbläsarens normal (400).
  // Att anta fetstil här hade sänkt kravet i tysthet – tvärtemot poängen.
  const vikt = parseInt(deklarationOm(selektor, 'font-weight') ?? '400', 10);
  const stor = storlek >= 24 || (storlek >= 18.66 && vikt >= 700);
  return stor ? STOR : LITEN;
}

test('kontrastfunktionen räknar rätt mot kända värden', () => {
  assert.equal(Math.round(kontrast('#000000', '#ffffff')), 21);
  assert.equal(Math.round(kontrast('#ffffff', '#ffffff')), 1);
});

test('sidans text är läsbar mot bakgrunden', () => {
  const bg = variabel('--bg');
  const par = [
    ['rubrik', deklaration('main h1', 'color'), bg, kravFör('main h1')],
    ['ingress', deklaration('main .lead', 'color'), bg, kravFör('main .lead')],
    ['toppradens text', '#ffffff', variabel('--rod'), kravFör('.brand')],
    ['navigationsbandets text', '#ffffff', variabel('--bla'), kravFör('.navText')],
    ['sökknappen', '#ffffff', variabel('--bla'), LITEN],
  ];
  for (const [namn, fg, bakgrund, krav] of par) {
    const k = kontrast(fg, bakgrund);
    assert.ok(k >= krav, `${namn}: ${k.toFixed(2)}:1 mot ${bakgrund}, kräver ${krav}:1`);
  }
});

test('kvittots text är läsbar mot det vita pappret', () => {
  const papper = '#fff';
  const par = [
    ['brödtext', deklaration('.receipt', '--ink'), LITEN],
    ['metadata', deklaration('.receipt', '--muted'), LITEN],
    ['godkänd', deklaration('.receipt .status.ok', 'color'), LITEN],
    ['felstämplad', deklaration('.receipt .status.bad', 'color'), LITEN],
    ['preliminär', deklaration('.receipt .status.pending', 'color'), LITEN],
  ];
  for (const [namn, fg, krav] of par) {
    const k = kontrast(fg, papper);
    assert.ok(k >= krav, `${namn}: ${k.toFixed(2)}:1 mot vitt, kräver ${krav}:1`);
  }
});

/**
 * KRAV-17: den som navigerar med tangentbord måste se var fokus står.
 * Webbläsarens standardring är blå och drunknar mot klubbens blå knappar –
 * uppmätt 1,09:1, mot WCAG:s krav på 3:1 för fokusindikatorer. Elementen
 * ligger dessutom på fyra olika bakgrunder, så en enda färg räcker inte.
 */
test('fokusmarkeringen syns mot alla bakgrunder sidan använder', () => {
  const regel = CSS.match(/:focus-visible\s*\{([^}]*)\}/);
  assert.ok(regel, 'ingen egen fokusmarkering – då gäller webbläsarens blå standardring');

  const kärna = (regel[1].match(/outline:\s*\d+px\s+solid\s+(#[0-9a-f]{3,6})/i) || [])[1];
  const halo = (regel[1].match(/box-shadow:[^;]*?(#[0-9a-f]{3,6})/i) || [])[1];
  assert.ok(kärna && halo, 'fokusmarkeringen behöver två lager för att synas överallt');

  // Varje bakgrund som ett fokuserbart element kan ligga på
  const bakgrunder = {
    'blå knapp': variabel('--bla'),
    'vitt kvitto': '#ffffff',
    'mörk sida': variabel('--bg'),
    'svart knapp': '#000000',
  };
  for (const [namn, bg] of Object.entries(bakgrunder)) {
    const bästa = Math.max(kontrast(kärna, bg), kontrast(halo, bg));
    assert.ok(bästa >= 3, `${namn}: bästa lagret ger ${bästa.toFixed(2)}:1, kräver 3:1`);
  }
});

/**
 * KRAV-17: kvittot öppnas i mobilen direkt efter målgång, ofta med kalla eller
 * blöta händer. WCAG rekommenderar minst 44x44 px för det man ska träffa.
 * Textlänkar i löpande text undantas.
 */
test('knappar och fält är tillräckligt stora att träffa', () => {
  const regler = [
    '.searchRow input',
    '.searchRow button',
    '#searchForm select',
    '.shareRow button, .shareRow .btn',
    '.mailInputs input',
    '.mailInputs button',
  ];
  for (const selektor of regler) {
    const block = CSS.match(
      new RegExp(`${selektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    );
    assert.ok(block, `regeln ${selektor} saknas`);
    const höjd = block[1].match(/min-height:\s*([\d.]+)px/);
    assert.ok(
      höjd && Number(höjd[1]) >= 44,
      `${selektor} saknar min-height: 44px – blir svår att träffa i mobilen`
    );
  }
});

test('kvittot är vitt papper med svart text oavsett sidans färger', () => {
  assert.equal(deklaration('.receipt', '--paper'), '#fff');
  assert.equal(deklaration('.receipt', '--ink'), '#000');
  assert.ok(
    !/prefers-color-scheme/.test(CSS),
    'ingen mörk variant ska färga om kvittot'
  );
});

/**
 * KRAV-10/KRAV-17: sträcktabellens kolumner måste ha luft emellan sig.
 *
 * Cellerna hade `padding: 0.22rem 0` – noll horisontellt – och de tre
 * tidskolumnerna är högerställda. Total och Klocka stötte alltså ihop:
 * "6:07" och "10:06:07" renderades som "6:0710:06:07", och rubrikerna som
 * "SträckaTotal". Uppmätt glapp: 0 px vid 320, 360, 390 och 430 px bredd.
 *
 * Det syntes inte i någon mätning av överflöd – tabellen är smalare än
 * skärmen, kolumnerna sitter bara ihop. Det upptäcktes genom att titta på
 * sidan.
 */
test('sträcktabellens kolumner sitter inte ihop', () => {
  const rem = 16;
  const px = (v) => (v.endsWith('rem') ? parseFloat(v) * rem : parseFloat(v));

  // padding: <lodrätt> <vågrätt> på cellerna i allmänhet
  const cellPadding = deklaration('.receipt td, .receipt th', 'padding').split(/\s+/);
  const vågrätt = cellPadding.length > 1 ? px(cellPadding[1]) : px(cellPadding[0]);

  // ...plus eventuell egen indragning på de högerställda tidskolumnerna
  const numRegel = '.receipt td.num, .receipt th.num';
  const numVänster = deklarationOm(numRegel, 'padding-left');
  const glapp = vågrätt * 2 + (numVänster ? px(numVänster) : 0);

  assert.ok(
    glapp >= 6,
    `kolumnerna får ${glapp} px luft emellan sig – högerställda tider som ` +
      '"6:07" och "10:06:07" flyter ihop till "6:0710:06:07"'
  );
});

/**
 * Varje färg kvittot faktiskt målar, inte de fem någon kom på.
 *
 * Kontrastparen ovan räknades upp för hand och täckte --ink, --muted och de
 * tre statusfärgerna. Utanför listan stod .prel, .stale, .missRow och båda
 * .badge-varianterna – alltså precis de färger som bara dyker upp när något
 * gått fel, och som löparen då mest behöver kunna läsa. De klarade kravet,
 * men ingenting höll fast dem: .prel ligger på 4,73:1, drygt två tiondelar
 * över gränsen, och sidans färger har redan justerats en gång.
 *
 * Listan hämtas därför ur CSS:en. En ny färg på kvittot bevakas då utan att
 * någon behöver lägga till den här.
 */

/** Regler under .receipt som sätter en textfärg, med sin egen bakgrund. */
function kvittotsFärgregler() {
  const variabler = {};
  const receiptRegel = CSS.match(/\.receipt\s*\{([^}]*)\}/)[1];
  for (const m of receiptRegel.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) variabler[m[1]] = m[2].trim();
  const lös = (v) => {
    const m = /var\((--[\w-]+)\)/.exec(v);
    return m ? variabler[m[1]] : v;
  };

  // Kommentarerna måste bort först. Med dem kvar hamnar texten före en regel
  // i selektorn, och varje regel som har en kommentar ovanför sig hoppas tyst
  // över – .receipt .stale och .receipt th föll bort precis så, och testet såg
  // grönt ut medan det bevakade tolv färger av fjorton.
  const utanKommentarer = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  const regler = [];
  for (const m of utanKommentarer.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selektor = m[1].trim();
    const kropp = m[2];
    if (!/(^|,\s*)\.receipt\b/.test(selektor)) continue;
    const färg = kropp.match(/(?:^|[;\s])color\s*:\s*([^;]+);/);
    if (!färg) continue;
    const bak = kropp.match(/(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+);/);
    regler.push({
      selektor,
      fg: lös(färg[1].trim()),
      bg: bak ? lös(bak[1].trim()) : variabler['--paper'],
      kropp,
    });
  }
  return regler;
}

test('varje färg på kvittot är läsbar mot sin egen bakgrund', () => {
  const regler = kvittotsFärgregler();
  assert.ok(
    regler.length >= 14,
    `hittade bara ${regler.length} färgregler – tolkningen av CSS:en brister, ` +
      'och ett test som tyst bevakar färre färger än det påstår är värre än inget'
  );

  const rem = 16;
  const px = (v) => (v.endsWith('rem') ? parseFloat(v) * rem : parseFloat(v));
  for (const { selektor, fg, bg, kropp } of regler) {
    // Kvittots grundstorlek är 0.9rem; en regel kan sätta sin egen.
    const storlek = kropp.match(/font-size\s*:\s*([^;]+);/);
    const vikt = kropp.match(/font-weight\s*:\s*([^;]+);/);
    const s = storlek ? px(storlek[1].trim()) : 0.9 * rem;
    const v = vikt ? parseInt(vikt[1], 10) : 400;
    const krav = s >= 24 || (s >= 18.66 && v >= 700) ? STOR : LITEN;

    const k = kontrast(fg, bg);
    assert.ok(
      k >= krav,
      `${selektor}: ${fg} mot ${bg} ger ${k.toFixed(2)}:1, kräver ${krav}:1`
    );
  }
});
