# meos-receipt – Digitalt kvitto för MeOS

Ett digitalt alternativ till papperskvittot som normalt skrivs ut vid utläsning
av stämplingar. Löparen anger sitt SportIdent-nummer (eller söker på namn) och
får upp sitt kvitto direkt i mobilen: löptid, status, placering, tid efter
segraren samt sträcktider. Kvittot kan delas, laddas ner som PDF eller mejlas
som PDF-bilaga.

Med bara MOP visas radiokontrollernas tider. Kompletteras det med
resultatautomatens filer visas hela stämplingslistan i banordning, inklusive
saknade och extra stämplingar – se [Kompletta stämplingar](#kompletta-stämplingar-via-resultatautomaten-iof-xml).

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
4. Kvittot kan delas som länk, laddas ner som PDF (en 100 mm kvittoremsa) och
   mejlas till löparen som PDF-bilaga om e-post är konfigurerat.

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

- **Trunk-based:** små commits direkt på `main`; varje commit lämnar trunken
  grön (`npm run verify`).
- **BDD:** nya krav skrivs som scenarier *innan* implementation och ska vara
  röda från start. På trunken committas rött+grönt tillsammans; scenarier som
  väntar på implementation taggas `@wip` och ingår inte i `npm run bdd`.
- **TDD:** implementationsdetaljer drivs av enhetstester i `test/` — skriv
  testet, se det falla, implementera, se det passera.
- **CI vaktar trunken:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
  kör båda sviterna på varje push till `main` och varje pull request. Den kan
  även startas manuellt (`workflow_dispatch`), vilket behövs när en
  driftstörning hos GitHub gör att push-eventet tappas bort.

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

## Drift på tävlingen (via internet)

Löparna når tjänsten via internet med mobildata – arenan behöver inget
wifi eller lokalt nät. Tävlingsdatorn med MeOS behöver en
internetuppkoppling (t.ex. mobil delning eller 4G-router) för att skicka
data.

```
MeOS-datorn ──(internet)──▶ tjänsten (moln) ◀──(mobildata)── Löparnas mobiler
```

Checklista tävlingsdagen:

1. Tjänsten driftsatt på internet (se *Deployment* nedan) med
   `MEOS_PASSWORD` satt.
2. I MeOS: Onlineresultat mot `https://din-server.example/meos`
   (tävlings-id + lösenord).
3. För kompletta stämplingar: resultatautomat som exporterar IOF XML 3.0
   med sträcktider, och `ladda-upp-resultat.bat` mot
   `https://din-server.example`.
4. Sprid länken till löparna – skylt eller QR-kod vid målet:
   `https://din-server.example`. En direktlänk till ett kvitto har formen
   `https://din-server.example/?card=123456`.

### Verifiera dagen före

Flera fel visar sig som tystnad snarare än felmeddelanden, så kontrollera
att data faktiskt kommer fram – inte bara att programmen är igång:

```bash
# Tjänsten svarar, och e-post är på om ni tänkt använda det
curl https://din-server.example/api/health
# -> {"ok":true,"competitions":1,"email":true}

# Tävlingen har kommit in från MeOS
curl https://din-server.example/api/competitions

# En känd löpare får sitt kvitto
curl 'https://din-server.example/api/receipt?card=123456'
```

Titta också på fönstret där `ladda-upp-resultat.bat` körs. Varje uppladdning
skriver en rad: `OK` betyder att filen tagits emot, `BADPWD` att lösenordet är
fel och `ERROR` att filen inte kunde tolkas. Skriptet fortsätter försöka vid
fel, men kvittona blir ofullständiga tills raden visar `OK`.

Öppna slutligen ett kvitto i mobilen. Visar det bara radiokontroller i stället
för hela stämplingslistan har resultatfilen inte nått fram – se punkt 3.

### Om något krånglar under tävlingen

| Symtom | Trolig orsak |
| --- | --- |
| Kvittot visar bara radiotider | Resultatfilen når inte fram – kontrollera uppladdningsfönstret. |
| `BADPWD` i uppladdningsfönstret | Lösenordet skiljer sig från `MEOS_PASSWORD` på servern. |
| `413` i MeOS eller uppladdningen | nginx framför tjänsten saknar `client_max_body_size 32m;`. |
| Löparen hittar inte sitt kvitto | Sök på namn i stället; delad bricka ger en valbar lista. |
| "Sökningen gav N träffar" | Sökningen matchade fler än 100 – skriv mer av namnet. |
| Mejlformuläret syns inte | `MAILGUN_*` saknas på servern; `/api/health` visar `email: false`. |

Tävlingsdata ligger kvar i 90 dagar och gallras sedan automatiskt
(`RETENTION_DAYS`). Startas MeOS Onlineresultat om mitt under tävlingen
skickas en ny komplett sändning – stämplingarna från resultatfilen finns
kvar ändå.

**Reserv utan internet:** tjänsten kan även byggas som fristående
Windows-exe (`npm run build:exe:win`, paket i `dist/paket/`) och köras
direkt på tävlingsdatorn – men det förutsätter ett lokalt nätverk som
löparnas mobiler kan ansluta till, vilket normalt inte finns på arenan.
Se KRAV-12 (utgått) i `docs/KRAV.md`.

## Miljövariabler

| Variabel | Default | Beskrivning |
| --- | --- | --- |
| `MEOS_PASSWORD` | — | Lösenord som MeOS måste skicka i `pwd`-headern. Tomt = ingen kontroll (avrådes). |
| `DATA_DIR` | `./data` | Katalog för persisterad tävlingsdata (JSON). |
| `PORT` | `3000` | Port för webbservern. |
| `PUBLIC_DIR` | `public/` bredvid koden/exen | Katalog med kvittosidans statiska filer. |
| `RETENTION_DAYS` | `90` | Antal dagar tävlingsdata sparas innan den gallras (KRAV-14). `0` stänger av gallringen. |
| `MAILGUN_SMTP` | — | SMTP-server för utskick av kvitto (KRAV-16). EU-domäner kräver `smtp.eu.mailgun.org`; US-endpointen ger "Authentication failed". |
| `MAILGUN_USER` | — | SMTP-användare, hela adressen (t.ex. `kvitto@mg.dinklubb.se`). Enbart ett namn ger `501 Username used for auth is not valid email address`. |
| `MAILGUN_PWD` | — | SMTP-lösenordet, **inte** API-nyckeln. |
| `MAILGUN_PORT` | `587` | Byt till `465` om 587 är blockerad (`secure` slås då på automatiskt). |
| `MAIL_FROM` | `Digitalt kvitto <MAILGUN_USER>` | Avsändare i utgående mejl. |
| `MAIL_REPLY_TO` | — | Valfri svarsadress, t.ex. tävlingsledningens. |

Saknas någon av `MAILGUN_SMTP`, `MAILGUN_USER` och `MAILGUN_PWD` är
e-postutskicket avstängt: mejlformuläret döljs och endpointen svarar `503`.

## API

| Endpoint | Beskrivning |
| --- | --- |
| `POST /meos` (även `/update`, `/update.php`) | Tar emot MOP-XML från MeOS. Svarar `OK`, `BADCMP`, `BADPWD`, `NOZIP` eller `ERROR` som text. |
| `POST /iof` | Tar emot IOF XML 3.0 ResultList (med sträcktider) från resultatautomaten. Samma headers och svar som `/meos`. |
| `GET /api/competitions` | Lista över inlästa tävlingar. |
| `GET /api/search?q=<bricka eller namn>[&cmp=N]` | Sök löpare. Fler än 100 träffar avvisas med `400` och en uppmaning att skriva mer av namnet (KRAV-5). |
| `GET /api/receipt?card=<bricka>[&cmp=N]` | Kvitto via bricknummer. Delad bricka ger `300` med en träfflista (KRAV-7). |
| `GET /api/receipt?id=<löpar-id>&cmp=N` | Kvitto via MeOS löpar-id (delningslänk). |
| `GET /api/receipt.pdf?...` | Samma parametrar som `/api/receipt`, men kvittot som PDF-remsa 100 mm bred (KRAV-15). |
| `POST /api/receipt/email` | Mejlar kvittot som PDF-bilaga. JSON-body med `email` plus `card` eller `id`/`cmp` (KRAV-16). |
| `GET /api/health` | Hälsokontroll. Fältet `email` anger om e-postutskick är konfigurerat. |

## Deployment (container på egen NAS/server)

Repots `docker-compose.yml` kör tjänsten i container med persistent
datamapp – fungerar direkt i Synology Container Manager, QNAP Container
Station, Unraid, TrueNAS eller vanlig Docker:

```bash
MEOS_PASSWORD=hemligt docker compose up -d --build
```

Tjänsten lyssnar på port 3000 och sparar tävlingsdata i `./data`.

**Nåbarhet från internet** (löparna kommer via mobildata):

Med nginx som omvänd proxy på NAS:en (hostname → container) och
Cloudflare-proxy framför räcker det att mappa ett värdnamn, t.ex.
`kvitto.dindomän.se`, till containerns port. Tre saker att kontrollera i
den kedjan:

- **`client_max_body_size` i nginx** – standard är 1 MB, och en
  `MOPComplete` eller IOF-resultatfil för en större tävling överskrider
  det lätt. Då svarar nginx `413` och MeOS-pushen misslyckas mitt under
  tävlingen. Sätt `client_max_body_size 32m;` för värdnamnet (tjänstens
  egen gräns är 32 MB).
- **Cloudflare SSL/TLS-läge** – kör "Full (strict)" med giltigt certifikat
  på nginx (Lets Encrypt eller ett Cloudflare Origin-certifikat), inte
  "Flexible".
- **Ingen cachning av API:t** – Cloudflare cachar som standard bara
  statiska filändelser, så `/api/*` och POST-endpoints påverkas inte. Om
  du har egna Page Rules/Cache Rules för domänen: undanta värdnamnet.

MeOS-pushen och uppladdningsskriptet skickar sina headers (`competition`,
`pwd`) oförändrat genom både Cloudflare och nginx – inget särskilt behövs.

Saknar NAS:en publik IPv4 (CGNAT) är Cloudflare Tunnel alternativet:
`cloudflared` som extra container pekad mot `http://meos-kvitto:3000`.

Tänk på att hemmauppkopplingen och NAS:en blir en single point of failure
under tävlingsdagen – ha gärna molnalternativet nedan som reservplan.

## Deployment (Fly.io)

```bash
fly launch --no-deploy   # eller använd medföljande fly.toml
fly secrets set MEOS_PASSWORD=dittlösenord
fly volumes create meos_data --size 1
fly deploy
```

`fly.toml` monterar volymen på `/data`, sätter `DATA_DIR=/data` och
`RETENTION_DAYS=90`.

Vill du kunna mejla kvitton måste Mailgun-uppgifterna sättas som secrets –
`fly.toml` innehåller dem medvetet inte, eftersom filen checkas in:

```bash
fly secrets set \
  MAILGUN_SMTP=smtp.eu.mailgun.org \
  MAILGUN_USER=kvitto@mg.dinklubb.se \
  MAILGUN_PWD=ditt-smtp-lösenord
```

Kontrollera efteråt att de gick fram — `curl https://din-app.fly.dev/api/health`
ska visa `"email": true`. Saknas de startar tjänsten utan mejlfunktion, utan
att något annat ser fel ut.

Maskinen stoppas automatiskt när trafiken upphör (`auto_stop_machines`) och
startar igen vid nästa anrop. Tävlingsdata ligger på volymen och överlever, men
räkna med någon sekunds fördröjning på första anropet efter en tyst period.

## Krav

- Server: Node.js 22 eller senare (Windows, macOS eller Linux – tjänsten kan
  även köras direkt på MeOS-datorn med `npm start`). Containern och CI kör
  samma major; BDD-verktyget stödjer inte längre Node 20, som dessutom är
  end-of-life.
- Uppladdningsprogrammet på MeOS-datorn: endast Windows 10 (1803+) eller
  Windows 11 med inbyggd `curl.exe` – inga installationer krävs.

## Licens

Protokollreferens: [MeOS](https://www.melin.nu/meos) onlineprotokoll (MOP 2.0),
Melin Software HB, Apache License 2.0.
