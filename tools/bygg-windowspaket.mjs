/**
 * Bygger paketet som ska ligga på MeOS-datorn (KRAV-11).
 *
 *   npm run build:windows -- https://din-server.example 4
 *
 * Resultatet hamnar i dist/windows/MeOS-kvitto/ – kopiera hela mappen till ett
 * USB-minne. Inget i paketet kräver installerad runtime: .bat-filerna använder
 * curl.exe, som ingår i Windows 10 (1803+) och 11.
 *
 * Skripten kopieras oförändrade ur tools/ i stället för att skrivas av här.
 * Ett paket som hunnit drifta isär från källan rättar buggar källan har kvar,
 * eller tvärtom, och skillnaden märks först vid tävlingsdatorn.
 *
 * Tre fällor som paketet måste överleva, och som test/windowspaket.test.js
 * bevakar:
 *   - LF i en textfil visas som en enda lång rad i Anteckningar
 *   - BOM-lös UTF-8 läses av Windows PowerShell 5.1 som Windows-1252 (åäö → grums)
 *   - filnamn med åäö blir grums på vägen genom zip och FAT-formaterat USB-minne
 *
 * Lösenordet fylls aldrig i: USB-minnet byter händer, och lösenordet ger rätt
 * att ersätta hela tävlingen mitt i loppet (KRAV-13).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BOM = '\ufeff';

/** Windows läser textfiler radvis; LF ensamt ger en enda lång rad. */
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');

/** BOM behövs bara där det finns åäö, men skadar aldrig. */
function skriv(fil, text, { bom = /[åäöÅÄÖ]/.test(text) } = {}) {
  fs.writeFileSync(fil, (bom ? BOM : '') + crlf(text), 'utf8');
}

function lasmig(url, cmp) {
  return `MeOS digitalt kvitto – filer för MeOS-datorn
============================================

Tjänsten körs på ${url}. Den här mappen innehåller bara det som ska köras
här på MeOS-datorn: uppladdningen av resultatfiler.

Kopiera hela mappen från USB-minnet till t.ex. C:\\meos\\kvitto och kör den
därifrån.


INNAN DU BÖRJAR
---------------

1. Tävlings-id. Ett heltal som måste vara SAMMA i MeOS Onlineresultat och i
   ladda-upp-resultat.cfg. Olika id ger halva deltagarfältet i placeringarna
   och ofullständiga kvitton.

2. Lösenord. Samma lösenord i båda inflödena – fråga den som driftsatt
   tjänsten. Skriv in det i ladda-upp-resultat.cfg (raden LOSEN=).


STEG 1 – MEOS ONLINERESULTAT (Tävling -> Onlineresultat)
--------------------------------------------------------

  URL          ${url}/meos
  Tävlings-id  ${cmp}
  Lösenord     tjänstens lösenord
  Format       MeOS onlineprotokoll (MOP)

Ställ in radiokontroller och mellantider om ni har dem.

Kontroll: dubbelklicka på kontrollera-tjansten.bat – "competitions" ska ha
ökat med ett efter att Onlineresultat skickat första gången.


STEG 2 – RESULTATAUTOMAT I MEOS (Automater)
-------------------------------------------

  Format       IOF XML 3.0 (ResultList)
  Sträcktider  MED – utan dem blir hela steget meningslöst
  Sökväg       C:\\meos\\resultat.xml
  Intervall    30–60 sekunder

Utan det här steget visar kvittot bara radiokontrollerna. Med det visar det
hela stämplingslistan, vilket är hela poängen med ett kvitto.


STEG 3 – STARTA UPPLADDNINGEN
-----------------------------

1. Öppna ladda-upp-resultat.cfg i Anteckningar och fyll i:
     FIL     = samma sökväg som resultatautomaten skriver till
     CMP     = tävlings-id (samma som i steg 1)
     LOSEN   = tjänstens lösenord

2. Dubbelklicka på ladda-upp-resultat.bat.

Inget behöver installeras – skriptet använder curl.exe, som ingår i Windows
10 och 11. Låt fönstret stå öppet under hela tävlingen. Det skriver en rad
per uppladdning:

  14:32:10 OK
  14:32:40 OK

  OK       Uppladdad
  BADPWD   Fel lösenord – rätta LOSEN i .cfg
  BADCMP   Tävlings-id saknas eller är noll
  ERROR    Filen gick inte att tolka – exporterar automaten IOF XML 3.0?

Skriptet ger inte upp vid fel; filen räknas som uppladdad först vid OK.

Föredrar du PowerShell finns LaddaUppResultat.ps1, som gör samma sak:

  .\\LaddaUppResultat.ps1 -Fil C:\\meos\\resultat.xml -Url ${url} -Tavling ${cmp}

Stoppar körningspolicyn skriptet:

  powershell -ExecutionPolicy Bypass -File .\\LaddaUppResultat.ps1 ...


ADRESSEN TILL LÖPARNA
---------------------

  ${url}/t/${cmp}

Fungerar redan innan tävlingen börjat – kan tryckas i PM eller sättas som
QR-kod på arenan i förväg. Löparen söker på bricknummer eller namn.
Bricknumret visas aldrig på kvittot.


OM NÅGOT KRÅNGLAR
-----------------

  Kvittot visar bara radiotider
      Resultatfilen når inte fram – kolla uppladdningsfönstret.

  BADPWD i uppladdningsfönstret
      Lösenordet skiljer sig från tjänstens.

  Två tävlingar med samma namn i listan
      Onlineresultat och uppladdningen använder olika tävlings-id.

  Sträcktiderna hör inte ihop med loppet
      FIL i .cfg pekar på en gammal resultatfil.

  Kvittot står stilla
      Onlineresultat har slutat skicka. Kvittosidan skriver själv ut en
      varning när tjänsten inte fått ny data på tio minuter.

Tävlingsdata gallras automatiskt efter 90 dagar.
`;
}

function cfg(url, cmp) {
  // Ren ASCII: filen läses av cmd.exe, som inte är att lita på med åäö.
  return `# Installningar for ladda-upp-resultat.bat.
# Rader som borjar med # ar kommentarer.
#
# LOSEN maste fyllas i pa plats - fraga den som driftsatt tjansten.
# CMP ar tavlings-id och MASTE vara samma som i MeOS Onlineresultat.

FIL=C:\\meos\\resultat.xml
URL=${url}
CMP=${cmp}
LOSEN=
INTERVALL=10
`;
}

function kontrollskript(url) {
  return `@echo off
rem Kontrollerar att kvittotjansten svarar. Kraver bara curl.exe (Windows 10/11).
echo Kontrollerar ${url} ...
echo.
curl -s -m 10 ${url}/api/health
echo.
echo.
echo ok=true          tjansten svarar
echo persistens=true  data nar disken
echo competitions=N   antal tavlingar tjansten kanner till
echo.
pause
`;
}

/**
 * @param {{url?: string, cmp?: number|string, utkatalog?: string, zip?: boolean}} val
 * @returns {string} sökvägen till den byggda mappen
 */
export function byggPaket({
  url = 'https://din-server.example',
  cmp = 1,
  utkatalog = path.join(ROT, 'dist', 'windows'),
  zip = true,
} = {}) {
  const rensadUrl = String(url).replace(/\/+$/, '');
  const paket = path.join(utkatalog, 'MeOS-kvitto');
  fs.rmSync(paket, { recursive: true, force: true });
  fs.mkdirSync(paket, { recursive: true });

  // Skripten rakt av ur tools/ – .bat är redan CRLF via .gitattributes.
  fs.copyFileSync(
    path.join(ROT, 'tools', 'ladda-upp-resultat.bat'),
    path.join(paket, 'ladda-upp-resultat.bat')
  );
  skriv(
    path.join(paket, 'LaddaUppResultat.ps1'),
    fs.readFileSync(path.join(ROT, 'tools', 'LaddaUppResultat.ps1'), 'utf8'),
    { bom: true }
  );

  skriv(path.join(paket, 'ladda-upp-resultat.cfg'), cfg(rensadUrl, cmp), { bom: false });
  skriv(path.join(paket, 'kontrollera-tjansten.bat'), kontrollskript(rensadUrl), { bom: false });
  // Filnamnet är avsiktligt ASCII: LÄS-MIG.txt blir grums på vägen genom
  // zip och FAT-formaterat USB-minne.
  skriv(path.join(paket, 'LAS-MIG.txt'), lasmig(rensadUrl, cmp));

  if (zip) skapaZip(utkatalog, paket);
  return paket;
}

/** Bekvämlighet, inte krav – mappen är leveransen. */
function skapaZip(utkatalog, paket) {
  const arkiv = `${paket}.zip`;
  fs.rmSync(arkiv, { force: true });
  try {
    execFileSync('zip', ['-rq', path.basename(arkiv), path.basename(paket)], { cwd: utkatalog });
  } catch {
    console.log('   (hoppar över zip – kommandot "zip" saknas; mappen räcker)');
  }
}

// Kör som skript: npm run build:windows -- <url> [tävlings-id]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [url, cmp] = process.argv.slice(2);
  const paket = byggPaket({ url: url || undefined, cmp: cmp || undefined });
  console.log(`Paketet ligger i ${paket}`);
  console.log('Kopiera hela mappen till USB-minnet. Fyll i LOSEN i ladda-upp-resultat.cfg på plats.');
}
