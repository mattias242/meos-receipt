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
    .filter((rad) => !rad.includes('fetch(url, opts)'));

  assert.deepEqual(
    rådaAnrop,
    [],
    'ett fetch-anrop utanför anrop() tappar felhanteringen vid dålig täckning'
  );
});

test('hjälpfunktionen signalerar utebliven kontakt', () => {
  assert.match(APP, /async function anrop\(/, 'hjälpfunktionen saknas');
  const kropp = APP.slice(APP.indexOf('async function anrop('));
  assert.match(kropp.slice(0, 600), /catch/, 'anrop() måste fånga nätverksfel');
  assert.match(kropp.slice(0, 600), /offline:\s*true/, 'och signalera det till anroparen');
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
