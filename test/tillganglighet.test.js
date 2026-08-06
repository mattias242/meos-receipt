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

test('kontrastfunktionen räknar rätt mot kända värden', () => {
  assert.equal(Math.round(kontrast('#000000', '#ffffff')), 21);
  assert.equal(Math.round(kontrast('#ffffff', '#ffffff')), 1);
});

test('sidans text är läsbar mot bakgrunden', () => {
  const bg = variabel('--bg');
  const par = [
    ['rubrik', deklaration('main h1', 'color'), bg, STOR],
    ['ingress', deklaration('main .lead', 'color'), bg, LITEN],
    ['toppradens text', '#ffffff', variabel('--rod'), STOR],
    ['navigationsbandets text', '#ffffff', variabel('--bla'), LITEN],
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

test('kvittot är vitt papper med svart text oavsett sidans färger', () => {
  assert.equal(deklaration('.receipt', '--paper'), '#fff');
  assert.equal(deklaration('.receipt', '--ink'), '#000');
  assert.ok(
    !/prefers-color-scheme/.test(CSS),
    'ingen mörk variant ska färga om kvittot'
  );
});
