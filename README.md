# meos-receipt – Digitalt kvitto för MeOS

Ett digitalt alternativ till papperskvittot som normalt skrivs ut vid utläsning
av stämplingar. Löparen anger sitt SportIdent-nummer (eller söker på namn) och
får upp sitt kvitto direkt i mobilen: löptid, status, placering, tid efter
segraren samt sträcktider för radiokontroller.

Tjänsten tar emot data via **MeOS onlineprotokoll (MOP 2.0)** – samma protokoll
som MeOS inbyggda funktion *Onlineresultat* använder – och fungerar därmed utan
ändringar i MeOS.

## Hur det fungerar

```
MeOS ──(MOP XML, POST /meos)──▶ meos-receipt ◀──(mobil, /?card=123456)── Löpare
```

1. MeOS skickar `MOPComplete` (hela tävlingen) och därefter `MOPDiff`
   (uppdateringar) till `POST /meos` med HTTP-headers `competition` (tävlings-id)
   och `pwd` (lösenord).
2. Tjänsten lagrar tävlingsdata i minnet och som JSON på disk (`DATA_DIR`),
   så data överlever en omstart.
3. Löparen öppnar sidan i mobilen, anger sitt bricknummer och ser kvittot.
   Sidan uppdaterar sig själv var 15:e sekund tills resultatet är fastställt.

Zip-komprimerade sändningar besvaras med `NOZIP`, vilket får MeOS att skicka
om okomprimerat (samma beteende som referensimplementationen i PHP).

## Kom igång

```bash
cp .env.example .env
# sätt MEOS_PASSWORD i .env

npm install
npm start        # http://localhost:3000
npm test         # enhetstester (node --test)
npm run bdd      # BDD-scenarier (cucumber-js)
npm run verify   # båda
```

## Arbetssätt: BDD + TDD

Kraven är dokumenterade i [`docs/KRAV.md`](docs/KRAV.md) och formulerade som
exekverbara Gherkin-scenarier (svenska) i [`features/`](features/). Ett krav
är uppfyllt när dess scenarier är gröna (`npm run bdd`).

- **BDD:** nya krav skrivs som scenarier *innan* implementation och ska vara
  röda från start.
- **TDD:** implementationsdetaljer drivs av enhetstester i `test/` — skriv
  testet, se det falla, implementera, se det passera.
- CI-workflow finns i [`docs/github-actions-ci.yml`](docs/github-actions-ci.yml) –
  flytta den till `.github/workflows/ci.yml` för att köra båda sviterna på
  varje push och pull request.

## Konfigurera MeOS

I MeOS: **Tävling → Onlineresultat** (automatisk publicering):

| Inställning | Värde |
| --- | --- |
| URL | `https://din-server.example/meos` |
| Tävlings-id | valfritt heltal > 0, t.ex. `1` |
| Lösenord | samma som `MEOS_PASSWORD` |
| Format | MeOS onlineprotokoll (MOP) |

Skicka gärna med radiokontroller/mellantider i MeOS så visas de som
sträcktider på kvittot. MOP-protokollet innehåller dock endast radiotider –
för kompletta kvitton, se nästa avsnitt.

## Kompletta stämplingar via resultatautomaten (IOF XML)

För att kvittot ska visa **alla** stämplingar – i banordning, inklusive
felstämplade/saknade kontroller och extra stämplingar – kompletteras
onlinedatat med resultatfiler från MeOS resultatautomat:

1. I MeOS: skapa en **resultatautomat** (Automater) som med lämpligt
   intervall exporterar resultat till fil i formatet **IOF XML 3.0
   (ResultList)** med sträcktider.
2. Kör uppladdningsprogrammet på MeOS-datorn så laddas filen upp till
   `POST /iof` varje gång den ändras. **`tools/ladda-upp-resultat.bat`** är en
   ren Windows/DOS-applikation (cmd.exe) utan beroenden utöver `curl.exe`,
   som är inbyggt i Windows 10 (1803+) och Windows 11:

   ```bat
   ladda-upp-resultat.bat C:\meos\resultat.xml https://din-server.example 1 hemligt
   ```

   Alternativt: kopiera `tools/ladda-upp-resultat.cfg.exempel` till
   `ladda-upp-resultat.cfg` i samma mapp, fyll i värdena och **dubbelklicka**
   på `.bat`-filen – inga argument behövs.

   För den som föredrar PowerShell finns `tools/LaddaUppResultat.ps1`, och
   för macOS/Linux `tools/ladda-upp-resultat.sh`:

   ```bash
   ./tools/ladda-upp-resultat.sh /sökväg/resultat.xml https://din-server.example 1 hemligt
   ```

Löpare matchas mot onlinedatat via bricknummer; MOP-datat behåller företräde
för namn, status och tider medan resultatfilen bidrar med stämplingslistan
(inkl. `Missing`/`Additional`) och fyller i det som saknas. Löpare som bara
finns i resultatfilen skapas automatiskt, så tjänsten fungerar även helt utan
onlineanslutning från MeOS – ladda bara upp resultatfiler.

## Köra allt lokalt på arenan (publikt wifi)

Finns det publikt wifi på arenan kan hela tjänsten köras direkt på
MeOS-datorn – löparna når kvittosidan i mobilen via wifi:t, utan
molnserver:

1. **Bygg en fristående Windows-exe** (en gång, på valfri dator med Node):

   ```bash
   npm install
   npm run build:exe:win
   ```

   Paketet i `dist/paket/` (`meos-kvitto.exe`, `public/`, `start.bat`,
   `LASMIG.txt`) kopieras till tävlingsdatorn – **ingen Node-installation
   behövs där**.

2. **Starta** med dubbelklick på `start.bat`. Tillåt programmet i
   Windows-brandväggen när frågan kommer (vid publikt wifi: bocka även i
   "publika nätverk"). Fönstret visar vilka adresser löparna kan använda,
   t.ex. `http://192.168.1.42:3000`.

3. **Peka MeOS mot tjänsten lokalt**: Onlineresultat mot
   `http://localhost:3000/meos` och/eller `ladda-upp-resultat.bat` mot
   `http://localhost:3000`.

4. **Sprid adressen** till löparna – skriv den på en skylt vid målet
   eller gör en QR-kod av den.

Att tänka på:

- **Klientisolering:** en del publika/gäst-wifi blockerar trafik mellan
  anslutna enheter ("AP/client isolation"). Testa med en mobil innan
  tävlingen – når den inte datorns adress, be nätverksansvarig stänga av
  isoleringen eller använd egen router/accesspunkt.
- **Fast adress:** be gärna om ett reserverat IP (DHCP-reservation) för
  tävlingsdatorn så att adressen på skylten stämmer hela dagen.
- **SmartScreen:** exe-filens signatur bryts när applikationen bakas in i
  Node-binären (känd egenskap hos Node SEA), så Windows kan varna första
  gången – välj "Kör ändå".

## Miljövariabler

| Variabel | Default | Beskrivning |
| --- | --- | --- |
| `MEOS_PASSWORD` | — | Lösenord som MeOS måste skicka i `pwd`-headern. Tomt = ingen kontroll (avrådes). |
| `DATA_DIR` | `./data` | Katalog för persisterad tävlingsdata (JSON). |
| `PORT` | `3000` | Port för webbservern. |
| `PUBLIC_DIR` | `public/` bredvid koden/exen | Katalog med kvittosidans statiska filer. |

## API

| Endpoint | Beskrivning |
| --- | --- |
| `POST /meos` (även `/update`, `/update.php`) | Tar emot MOP-XML från MeOS. Svarar `OK`, `BADCMP`, `BADPWD`, `NOZIP` eller `ERROR` som text. |
| `POST /iof` | Tar emot IOF XML 3.0 ResultList (med sträcktider) från resultatautomaten. Samma headers och svar som `/meos`. |
| `GET /api/competitions` | Lista över inlästa tävlingar. |
| `GET /api/search?q=<bricka eller namn>[&cmp=N]` | Sök löpare. |
| `GET /api/receipt?card=<bricka>[&cmp=N]` | Kvitto via bricknummer. |
| `GET /api/receipt?id=<löpar-id>&cmp=N` | Kvitto via MeOS löpar-id (delningslänk). |
| `GET /api/health` | Hälsokontroll. |

## Deployment (Fly.io)

```bash
fly launch --no-deploy   # eller använd medföljande fly.toml
fly secrets set MEOS_PASSWORD=dittlösenord
fly volumes create meos_data --size 1
fly deploy
```

`fly.toml` monterar volymen på `/data` och sätter `DATA_DIR=/data`.

## Krav

- Server: Node.js 18.18 eller senare (Windows, macOS eller Linux – tjänsten
  kan även köras direkt på MeOS-datorn med `npm start`).
- Uppladdningsprogrammet på MeOS-datorn: endast Windows 10 (1803+) eller
  Windows 11 med inbyggd `curl.exe` – inga installationer krävs.

## Licens

Protokollreferens: [MeOS](https://www.melin.nu/meos) onlineprotokoll (MOP 2.0),
Melin Software HB, Apache License 2.0.
