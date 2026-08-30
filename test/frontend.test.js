import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Kvittosidan har ingen byggkedja och kan därför inte importeras här, men det
 * som betyder mest går att kontrollera i källan.
 *
 * KRAV-13: löparna är på mobildata vid arenan. Tappad täckning fick tidigare
 * sidan att se ut att hänga – anropet kastade och ingen fick veta något.
 */

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'),
  'utf8'
);

test('alla nätanrop går genom hjälpfunktionen med felhantering', () => {
  // Hjälpfunktionen anrop() är den enda som får röra fetch direkt.
  const rådaAnrop = APP.split('\n')
    .map((rad, i) => `rad ${i + 1}: ${rad.trim()}`)
    .filter((rad) => /\bfetch\(/.test(rad))
    .filter((rad) => !rad.includes('fetch(url, {'));

  assert.deepEqual(
    rådaAnrop,
    [],
    'ett fetch-anrop utanför anrop() tappar felhanteringen vid dålig täckning'
  );
});

test('anropen ger upp i stället för att vänta i oändlighet', () => {
  const kropp = APP.slice(APP.indexOf('async function anrop('), APP.indexOf('async function loadReceipt'));
  assert.match(kropp, /AbortController/, 'utan tidsgräns ser ett glapp ut som att sidan hängt sig');
  assert.match(kropp, /signal:/, 'signalen måste skickas med till fetch');
  const gräns = kropp.match(/timeoutMs\s*=\s*(\d+)/);
  assert.ok(gräns && Number(gräns[1]) <= 30000, 'tidsgränsen ska vara sekunder, inte minuter');
  assert.match(kropp, /clearTimeout/, 'timern ska städas bort när svaret kommit');
});

test('hjälpfunktionen signalerar utebliven kontakt', () => {
  assert.match(APP, /async function anrop\(/, 'hjälpfunktionen saknas');
  const kropp = APP.slice(APP.indexOf('async function anrop('), APP.indexOf('async function loadReceipt'));
  assert.match(kropp, /catch/, 'anrop() måste fånga nätverksfel');
  assert.match(kropp, /offline:\s*true/, 'och signalera det till anroparen');
});

test('användaren får besked när kontakten sviker', () => {
  // Sökning och kvittohämtning är det löparen gör – båda ska säga ifrån.
  for (const funktion of ['async function loadReceipt', 'async function search']) {
    const start = APP.indexOf(funktion);
    assert.ok(start > -1, `${funktion} saknas`);
    const kropp = APP.slice(start, start + 900);
    assert.match(kropp, /res\.offline/, `${funktion} hanterar inte utebliven kontakt`);
  }
});

test('automatisk uppdatering tiger vid glapp i täckningen', () => {
  const start = APP.indexOf('async function loadReceipt');
  const kropp = APP.slice(start, start + 900);
  // silent-läget används av pollningen var 15:e sekund – ett felmeddelande
  // som blinkar till vid varje glapp vore värre än tystnad.
  assert.match(kropp, /if \(!silent\) showMessage/, 'pollningen ska inte skrika vid glapp');
});

// KRAV-17: sidan används av löpare i alla åldrar, en del med skärmläsare.
const HTML = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'),
  'utf8'
);

test('sökfältet har en etikett, inte bara en platshållare', () => {
  const input = HTML.match(/<input[^>]*id="query"[^>]*>/s);
  assert.ok(input, 'sökfältet saknas');
  const harLabel = /<label[^>]*for="query"/.test(HTML);
  const harAria = /aria-label=/.test(input[0]);
  assert.ok(
    harLabel || harAria,
    'placeholder räcker inte – den läses inkonsekvent och försvinner när man skriver'
  );
});

test('sökfältet låser inte mobilens tangentbord till siffror', () => {
  // KRAV-5: sökningen tar både bricknummer och namn. iOS sifferknappsats har
  // inga bokstäver alls, så inputmode="numeric" gör namnsökningen omöjlig på
  // den enda enhet löparen har med sig till arenan. Samma sak för type="tel"
  // och type="number", som dessutom stryper inledande nollor.
  const input = HTML.match(/<input[^>]*id="query"[^>]*>/s);
  assert.ok(input, 'sökfältet saknas');
  const inputmode = input[0].match(/inputmode="([^"]*)"/);
  assert.ok(
    !inputmode || !/^(numeric|tel|decimal)$/.test(inputmode[1]),
    `inputmode="${inputmode?.[1]}" ger ett tangentbord utan bokstäver`
  );
  const typ = input[0].match(/type="([^"]*)"/);
  assert.ok(
    !typ || !/^(tel|number)$/.test(typ[1]),
    `type="${typ?.[1]}" ger ett tangentbord utan bokstäver`
  );
});

test('kvitto och meddelanden annonseras när de ändras', () => {
  // Sidan uppdaterar sig själv var 15:e sekund. Utan aria-live får den som
  // använder skärmläsare aldrig veta att resultatet kommit.
  for (const id of ['receipt', 'message']) {
    const el = HTML.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert.ok(el, `elementet ${id} saknas`);
    assert.match(el[0], /aria-live=/, `${id} annonseras inte vid ändring`);
  }
});

test('textfält från tjänsten escapas innan de sätts som HTML', () => {
  // Bara innerHTML-tilldelningarna är intressanta – text som går till
  // textContent eller navigator.share kan inte bli HTML.
  const htmlBlock = [...APP.matchAll(/innerHTML\s*=\s*([\s\S]*?);\n/g)].map((m) => m[1]);
  assert.ok(htmlBlock.length >= 2, 'förväntade minst renderReceipt och renderHits');

  // Fält som kommer från MeOS-data och alltså kan innehålla vad som helst.
  const fritext = /\.(name|club|organizer|statusText|leg|elapsed|clock|error)\b/;
  const oescapade = [];
  for (const block of htmlBlock) {
    for (const m of block.matchAll(/\$\{([^}]*)\}/g)) {
      const uttryck = m[1];
      if (fritext.test(uttryck) && !uttryck.includes('esc(')) oescapade.push(uttryck.trim());
    }
  }
  assert.deepEqual(oescapade, [], 'fritext från API:t ska gå genom esc()');
});

/**
 * KRAV-18: sidan serveras både från / och från /t/<id>.
 *
 * En relativ adress löses då mot /t/ och ger 404 – och servern märker
 * ingenting, eftersom HTML:en levererades felfritt. Sidan blir bara tom.
 * Det hände: /t/4 hämtade styles.css, app.js och samtliga api/-anrop mot
 * /t/ och visade en helt vit sida, medan alla tester var gröna.
 */
test('alla adresser sidan hämtar är rotabsoluta', () => {
  const relativa = [...APP.matchAll(/anrop\(\s*(['"`])([^'"`]+)\1/g)]
    .map((m) => m[2])
    .filter((u) => !u.startsWith('/'));
  assert.deepEqual(
    relativa,
    [],
    'en relativ adress löses mot /t/<id> när sidan öppnats via tävlingens adress'
  );

  const pdfLank = APP.match(/href="([^"]*receipt\.pdf[^"]*)"/);
  assert.ok(pdfLank, 'PDF-länken saknas');
  assert.ok(pdfLank[1].startsWith('/'), `PDF-länken är relativ: ${pdfLank[1]}`);
});

/**
 * KRAV-23: besöksstatistiken får aldrig kunna peka ut en enskild löpare.
 *
 * Kvittosidan skriver om adressen till /t/<tävling>?id=<löpar-id> när ett
 * kvitto visas (history.replaceState), och Umami följer history-API:t. Utan
 * `data-exclude-search` registreras därför exakt vilken löpare som tittat –
 * samma personuppgift som lib/statistik.js är byggd för att slippa. Flaggan är
 * lätt att råka stryka vid en uppdatering av scripttaggen, och felet syns inte
 * på sidan: det syns bara i Umami, långt senare.
 */
test('besöksstatistiken får inte se löpar-id i adressen', () => {
  const skript = HTML.match(/<script[^>]*umami[^>]*>/i);
  if (!skript) return; // ingen besöksstatistik konfigurerad – inget att skydda
  assert.match(
    skript[0],
    /data-exclude-search\s*=\s*"true"/,
    'Umami-taggen saknar data-exclude-search="true" – löpar-id skulle följa med i adressen'
  );
});

test('inga andra externa resurser än besöksstatistiken laddas', () => {
  // Utomstående resurser röjer vilka löpare som öppnar sina kvitton. Enda
  // undantaget är klubbens egen Umami (KRAV-23); allt annat ska vara lokalt.
  // Bara det som webbläsaren hämtar av sig själv räknas – en <a href> till
  // MeOS i sidfoten laddar ingenting förrän någon klickar på den.
  const externa = [...HTML.matchAll(/<(script|link|img|iframe|source)\b[^>]*>/gi)]
    .map((m) => m[0].match(/(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/i)?.[1])
    .filter(Boolean)
    .filter((url) => !url.startsWith('https://umami.neomeda.se/'));
  assert.deepEqual(externa, [], `externa resurser i index.html: ${externa.join(', ')}`);
});
