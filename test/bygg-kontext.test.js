import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vad som hamnar i containerimagen.
 *
 * `.gitignore` utesluter `/*.xml` med motiveringen att skarpa resultatfiler
 * innehåller personuppgifter. `.dockerignore` fick aldrig samma regel, så en
 * resultatfil i arbetskatalogen bakades rakt in i imagen – och följde med
 * varhelst den imagen sedan hamnar. Det var inte en glömd rad utan två listor
 * som ska hållas i takt manuellt, vilket de förr eller senare inte blir.
 *
 * Därför är `.dockerignore` en vitlista: allt utesluts, och bara det tjänsten
 * behöver för att köra släpps in. En ny känslig fil är då utesluten som
 * standard, utan att någon behöver komma ihåg något.
 */

const ROT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Raderna i .dockerignore, utan kommentarer och tomrader. */
function regler() {
  return fs
    .readFileSync(path.join(ROT, '.dockerignore'), 'utf8')
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r && !r.startsWith('#'));
}

/**
 * Hamnar `sökväg` i byggkontexten? Sista matchande regeln vinner, och `*`
 * matchar inte katalogseparatorn – samma grundregler som Docker.
 */
function tasMed(sökväg) {
  let med = true;
  for (const regel of regler()) {
    const negerad = regel.startsWith('!');
    const mönster = negerad ? regel.slice(1) : regel;
    const re = new RegExp(
      '^' + mönster.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/.*)?$'
    );
    if (re.test(sökväg)) med = negerad;
  }
  return med;
}

test('känsliga filer följer inte med in i imagen', () => {
  for (const sökväg of [
    'Vrace_4.xml',           // skarp resultatfil – 110 verkliga personer
    'nagon-annan-fil.xml',
    '.env',                  // Mailgun-uppgifter
    'data/tavlingar/1.json', // hela deltagarfältet
    '.git/config',
    'node_modules/express/index.js',
    '.DS_Store',
  ]) {
    assert.equal(tasMed(sökväg), false, `${sökväg} hamnar i containerimagen`);
  }
});

test('det tjänsten behöver för att köra följer med', () => {
  for (const sökväg of [
    'package.json',
    'package-lock.json',
    'index.js',
    'server.js',
    'lib/mop.js',
    'public/app.js',
    'public/index.html',
  ]) {
    assert.equal(tasMed(sökväg), true, `${sökväg} saknas i imagen – tjänsten startar inte`);
  }
});

test('.dockerignore är en vitlista, inte en lista över det man kom på', () => {
  const rader = regler();
  const stjärna = rader.indexOf('*');
  assert.ok(stjärna > -1, '.dockerignore utesluter inte allt som standard');
  assert.ok(
    rader.slice(0, stjärna).every((r) => !r.startsWith('!')),
    'ett undantag före "*" får ingen effekt – sista matchande regeln vinner'
  );
  // Ett nytt filnamn ingen tänkt på ska vara uteslutet utan att någon agerar
  assert.equal(tasMed('nagot-nytt-hemligt.txt'), false);
});
