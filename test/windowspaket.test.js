import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { byggPaket } from '../tools/bygg-windowspaket.mjs';

/**
 * KRAV-11: paketet till MeOS-datorn byggs, inte plockas ihop för hand.
 *
 * Handhopplockningen gick fel på tre sätt som alla är osynliga tills någon
 * står vid tävlingsdatorn: en .bat som hunnit drifta isär från tools/, en
 * textfil med LF som Anteckningar visar som en enda lång rad, och åäö som
 * blir grums i PowerShell. Alla tre kontrolleras här i stället.
 */

const ROT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const läs = (p) => fs.readFileSync(p);

function bygg(val = {}) {
  const ut = fs.mkdtempSync(path.join(os.tmpdir(), 'winpaket-'));
  const paket = byggPaket({ url: 'https://exempel.test', cmp: 7, utkatalog: ut, zip: false, ...val });
  return paket;
}

test('paketet innehåller allt MeOS-datorn behöver', () => {
  const paket = bygg();
  const filer = fs.readdirSync(paket).sort();
  assert.deepEqual(filer, [
    'LAS-MIG.txt',
    'LaddaUppResultat.ps1',
    'kontrollera-tjansten.bat',
    'ladda-upp-resultat.bat',
    'ladda-upp-resultat.cfg',
  ].sort());
});

test('skripten är oförändrade kopior av dem i tools/', () => {
  // Kopieras de inte rakt av kan paketet rätta en bugg som källan har kvar,
  // eller tvärtom – och skillnaden upptäcks först på tävlingsdagen.
  const paket = bygg();
  for (const [i, ut] of [
    ['tools/ladda-upp-resultat.bat', 'ladda-upp-resultat.bat'],
    ['tools/LaddaUppResultat.ps1', 'LaddaUppResultat.ps1'],
  ]) {
    const källa = läs(path.join(ROT, i));
    const kopia = läs(path.join(paket, ut));
    // .ps1 får en BOM påklistrad (se nedan), i övrigt ska innehållet vara samma.
    const utanBom = kopia[0] === 0xef ? kopia.subarray(3) : kopia;
    assert.equal(
      utanBom.toString('utf8').replace(/\r\n/g, '\n'),
      källa.toString('utf8').replace(/\r\n/g, '\n'),
      `${ut} skiljer sig från ${i}`
    );
  }
});

test('alla textfiler har CRLF – Anteckningar visar annars en enda rad', () => {
  const paket = bygg();
  for (const fil of fs.readdirSync(paket)) {
    const text = läs(path.join(paket, fil)).toString('utf8');
    const ensammaLf = text.replace(/\r\n/g, '').includes('\n');
    assert.ok(!ensammaLf, `${fil} har rader som slutar med bara LF`);
  }
});

test('filer med åäö har BOM – annars läser PowerShell 5.1 dem som Windows-1252', () => {
  const paket = bygg();
  for (const fil of fs.readdirSync(paket)) {
    const rå = läs(path.join(paket, fil));
    if (!/[åäöÅÄÖ]/.test(rå.toString('utf8'))) continue;
    assert.deepEqual(
      [...rå.subarray(0, 3)],
      [0xef, 0xbb, 0xbf],
      `${fil} innehåller åäö men saknar BOM`
    );
  }
});

test('filnamnen är ASCII – de ska överleva zip och FAT-formaterat USB-minne', () => {
  const paket = bygg();
  for (const fil of fs.readdirSync(paket)) {
    assert.match(fil, /^[\x20-\x7e]+$/, `filnamnet ${fil} riskerar att bli grums på vägen`);
  }
});

test('adress och tävlings-id fylls i vid bygget', () => {
  const paket = bygg({ url: 'https://kvitto.exempel.test', cmp: 42 });
  const cfg = läs(path.join(paket, 'ladda-upp-resultat.cfg')).toString('utf8');
  assert.match(cfg, /^URL=https:\/\/kvitto\.exempel\.test$/m);
  assert.match(cfg, /^CMP=42$/m);
  const lasmig = läs(path.join(paket, 'LAS-MIG.txt')).toString('utf8');
  assert.ok(lasmig.includes('https://kvitto.exempel.test/meos'), 'LAS-MIG saknar adressen till MeOS');
  assert.ok(lasmig.includes('https://kvitto.exempel.test/t/42'), 'LAS-MIG saknar adressen till löparna');
  const kontroll = läs(path.join(paket, 'kontrollera-tjansten.bat')).toString('utf8');
  assert.ok(kontroll.includes('https://kvitto.exempel.test/api/health'), 'kontrollskriptet pekar fel');
});

test('bygget fyller aldrig i lösenordet', () => {
  // Paketet hamnar på ett USB-minne som byter händer. Lösenordet ger rätt att
  // ersätta hela tävlingen mitt i loppet (KRAV-13) och skrivs in på plats.
  // Sentinelen är medvetet obegriplig: "hemligt" förekommer redan som exempel
  // i skriptens egna användningsrader och hade fällt testet av fel skäl.
  const sentinel = 'LOSENORD-SOM-INTE-FAR-PAKETERAS-4711';
  const paket = bygg({ losen: sentinel, url: `https://exempel.test/${sentinel}` });
  const cfg = läs(path.join(paket, 'ladda-upp-resultat.cfg')).toString('utf8');
  assert.match(cfg, /^LOSEN=$/m, 'LOSEN ska lämnas tom i det byggda paketet');
  const cfgUtanUrl = cfg.replace(/^URL=.*$/m, '');
  assert.ok(!cfgUtanUrl.includes(sentinel), 'lösenordet läckte in i konfigfilen');
});

test('paketet kräver ingen runtime på MeOS-datorn', () => {
  // KRAV-11: bara det som ingår i Windows. Slinker en .js, .mjs eller .exe in
  // i paketet har någon lagt till ett beroende som inte finns på plats.
  const paket = bygg();
  for (const fil of fs.readdirSync(paket)) {
    assert.doesNotMatch(fil, /\.(js|mjs|cjs|exe|py)$/, `${fil} förutsätter något som inte ingår i Windows`);
  }
});
