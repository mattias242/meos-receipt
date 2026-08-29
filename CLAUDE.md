# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Kommandon

```bash
npm start                       # kör tjänsten (http://localhost:3000)
npm run dev                     # node --watch
npm test                        # enhetstester (node --test, test/*.test.js)
npm run bdd                     # BDD-scenarier (cucumber-js, features/*.feature)
npm run verify                  # båda – definition of done
npm run build:exe:win           # fristående Windows-exe till dist/paket/ (reservspår)
```

**Node 22 eller senare krävs** (cucumber stödjer inte Node 20, som dessutom är
EOL). Dockerfile, CI och `engines` ska hållas på samma major.

Enskilda tester:

```bash
node --test test/iof.test.js
node --test --test-name-pattern "NOZIP"
npx cucumber-js features/kvitto.feature          # en feature
npx cucumber-js features/kvitto.feature:10       # ett scenario (radnummer)
npx cucumber-js --name "Kvitto för en godkänd löpare"
```

Kräver `.env` med `MEOS_PASSWORD` för `npm start` (kopiera `.env.example`); testerna
sätter lösenord själva via `createApp({ password })`.

## Arbetssätt (obligatoriskt)

`docs/KRAV.md` är kravregistret och varje krav (KRAV-n) spåras till en feature-fil.
Ett nytt krav ska först in i `docs/KRAV.md` + som Gherkin-scenario i `features/`
(rött), därefter enhetstest i `test/`, sedan implementation. Gherkin skrivs på
**svenska** (`# language: sv`). Ändras beteende – uppdatera kravtabellen, inte bara
koden. Utgångna krav stryks (`~~...~~`) med datum och motivering i stället för att
raderas.

## Arkitektur

Två oberoende inflöden av tävlingsdata som slås ihop till ett kvitto:

```
MeOS Onlineresultat ──MOP 2.0 XML──▶ POST /meos ─┐                     ┌─▶ GET /api/receipt ─▶ public/
                                                 ├─▶ store ────────────┼─▶ GET /api/receipt.pdf
MeOS resultatautomat ─IOF XML 3.0──▶ POST /iof ──┘   (minne + JSON)    └─▶ POST /api/receipt/email
```

- `server.js` — `createApp({ dataDir, password, saveDelayMs })` returnerar en
  Express-app utan att lyssna; testerna kör `app.listen(0)`. `index.js` är enda
  stället som läser miljövariabler och binder port.
- `lib/store.js` — **inte allt i minnet.** Ett register (namn, bricknummer,
  tävlingsuppgifter) räcker för sökning, brickuppslag och tävlingslistan;
  själva tävlingen läses in från sin fil först när ett kvitto ska byggas, och
  högst `cacheMax` hålls inlästa. `store.competitions` är därför *cachen*, inte
  allt som finns — använd `hamta(cid)`, `finns(cid)`, `tavlingarMedTraff(q)`
  och `tavlingarMedBricka(card)`. Är en tävling inläst går dess objekt före
  registret, så en ändring syns direkt även före `touch`. Data per tävlings-id
  (`cid`), persisteras
  debounced (`saveDelayMs`) till `DATA_DIR/tavlingar/<cid>.json` – en fil per
  tävling, via tmp + rename. Bara ändrade tävlingar skrivs om: med 90 dagars
  data kostade hela databasen 60 ms blockerad eventloop per sparning, en
  enskild tävling 3 ms. En oläsbar fil kostar dessutom bara sin egen tävling,
  inte alla nittio dagarna. En äldre `competitions.json` delas upp vid start
  och läggs undan som `.uppdelad-<tid>`.
  Kommentaren överst i filen är schemat för hela datamodellen.
- `lib/mop.js` — MeOS onlineprotokoll. `MOPComplete` nollställer tävlingen
  (`clearCompetition`), `MOPDiff` muterar inkrementellt.
- `lib/iof.js` — IOF XML 3.0 ResultList från resultatautomaten. Matchar löpare på
  **bricknummer**; skapar löpare/klasser/klubbar som bara finns i filen.
- `lib/receipt.js` — bygger kvittot: statustexter, placering, tid efter segrare,
  sträcktider.
- `lib/pdf.js` — kvittot som PDF, skriven för hand utan bibliotek: en 100 mm
  bred remsa vars höjd växer med innehållet, Courier + WinAnsi (bär åäö).
  `renderReceiptPdf()` ger en Buffer som återanvänds rakt av vid mejlutskick.
- `lib/mailer.js` — utskick via Mailgun EU SMTP. Transporten injiceras, så
  tester kör mot en fejk och inget mejl lämnar maskinen. Innehåller även
  adressvalidering och takt-begränsaren som `server.js` använder.

### Regler som är lätta att bryta

- **Tider är tiondels sekunder överallt** (MOP-konvention). `st` = tiondelar efter
  midnatt tävlingsdagen, `rt` = löptid i tiondelar. Formatering sker bara i
  `fmtClock`/`fmtElapsed` i `lib/receipt.js`.
- **`zerotime` får inte användas i tidsräkningen.** Fältet finns i protokollet
  och sparas, men MOP-specen säger att starttiden redan är räknad från midnatt.
  Justerar man för nolltiden förskjuts varje klockslag på kvittot – ett fel som
  är svårt att se eftersom tiderna fortfarande ser rimliga ut. Bevakas av
  `test/mop.test.js`.
- **MOP äger sanningen.** `applyIof` skriver bara `stat`/`st`/`rt` när MOP-datat
  saknar dem; `punches` (stämplingslistan) sätts alltid av IOF.
- **`MOPComplete` nollställer allt utom `punches`.** Stämplingarna kommer från
  resultatfilen och ägs inte av onlineprotokollet. MeOS skickar en ny komplett
  sändning varje gång Onlineresultat startas om – utan undantaget tappar
  kvittona alla stämplingar, och för gott om tävlingen redan är avslutad.
  Löparna matchas ihop på bricknummer (`punchesByCard` i `lib/mop.js`).
- **`punches` slår `radios`.** `buildSplits` väljer den kompletta
  stämplingslistan från resultatfilen om den finns, annars radiotiderna från MOP.
- **MOP bär inte bara radiotider.** Kryssar arrangören i "Skicka alla
  sträcktider efter brickavläsning" i Onlineresultat innehåller `radios` hela
  banans kontroller. Det ersätter ändå inte resultatfilerna: MeOS kastar
  sträckstatusen och tar bara med kontroller som har en tid större än noll, så
  saknade kontroller, extra stämplingar, absoluta tider och stämplingsordning
  finns aldrig i MOP – och klassens kontrollista bygger på en enda representativ
  bana, vilket spricker vid gaffling.
- **Skarp data innehåller orimliga stämplingstider.** Gamla stämplingar kvar i
  brickan, eller en kontrollenhet med fel klocka, ger tider långt utanför
  loppet. En tid större än löparens totaltid är ingen sträcktid: kontrollen
  visas utan tider och nästa sträcka räknas från föregående giltiga stämpling.
  I en verklig tävlingsfil drabbade det 40 av 110 löpare.
- **Har ingen stämpling någon tid visas ingen tabell.** MeOS exporterar hela
  banan som `Missing` för den som brutit utan att stämpla; en tabell med enbart
  streck säger löparen ingenting, så kvittot skriver i stället att inga
  stämplingar registrerats.
- **MOP-endpointerna svarar XML**, aldrig JSON eller ren text:
  `<?xml version="1.0"?><MOPStatus status="X"></MOPStatus>` med koderna `OK`,
  `BADCMP`, `BADPWD`, `NOZIP`, `ERROR` (KRAV-1). Inpackningen är inte kosmetisk:
  MeOS XML-parsar svaret, och en tom status bryter sändningsloopen. Eftersom
  MeOS styckar en tävling i klumpar om 64 objekt där bara den första bär
  `MOPComplete` kom bara den klumpen fram så länge vi svarade ren text – och
  metadatan ligger först, så det var löparna som uteblev. `/iof` ingår inte i
  MOP och svarar fortsatt ren text; dess klient är uppladdningsprogrammet
  (KRAV-11), som matchar på strängen `OK`. Rå body, gräns 32 MB.
- **Zip stöds inte, och MeOS sänder inte om okomprimerat.** Vi svarar `NOZIP`
  (payload börjar med `PK`), men MeOS 5.0 avbryter då med ett fel i stället för
  att försöka igen. "Packa stora filer (zip)" måste vara omarkerad i
  Onlineresultat.
- **Protokollets facit ligger i `mop/`**: specifikationen
  (`MeOS Online Protocol.pdf`), schemat `mop.xsd` och Melins
  referensimplementation i PHP. Kolla där innan du gissar om MOP.
- **Kontroller visas som `50 (Radio 1-1)` – koden först** (KRAV-19). Namnet är
  arrangörens etikett och sätts bara på de kontroller hen döpt; koden är det
  löparen kan jämföra mot skärmen i skogen.
- **MeOS kontroll-id är inte kontrollkoden.** Passerar banan samma kontroll
  flera gånger får varje besök ett eget id: kod + 100000 per extra besök
  (52 → 100052 → 200052). `controlCode` i `lib/receipt.js` räknar tillbaka
  det; utan den står `100052` på kvittot, ett nummer som inte finns i skogen.
  Att felet var skarpt syntes inte i testerna – det upptäcktes genom att läsa
  ett riktigt kvitto ur driftsatt data.
- **MeOS besöksnumrering hör inte hemma på kvittot.** Passerar banan samma
  döpta kontroll två gånger heter de "Radio 1-1" och "Radio 1-2". Suffixet
  stryks: det stämmer bara i MOP-flödet, som har ett eget id per besök, medan
  resultatfilen bara bär kontrollkoden – andra passagen hade då påstått att
  den är den första. Uppmätt: 103 löpare i RADIOTEST 2026-08-18.
- **MeOS platshållarnamn är inte namn.** En odöpt kontroll får sin egen kod
  som namn (`54`, eller `79-1` vid flera passager), så namnet ska utelämnas
  ur parentesen – annars blir det `54 (54)`. Samma sak för vår egen gamla
  platshållare `Kontroll <id>`, som ligger kvar i redan sparad data;
  `lib/mop.js` får inte återinföra den. I PDF:en är kontrollkolumnen 14
  tecken: ryms inte allt faller namnet bort i sin helhet, aldrig koden eller
  `SAKNAS`/`EXTRA` (`fitControl` i `lib/pdf.js`).
- **Statuskoder** är MeOS numeriska koder (`STATUS_TEXT` i `lib/receipt.js`);
  IOF-status mappas mot dem via `IOF_STATUS_TO_STAT` i `lib/iof.js`.
- **Sparningen blockerar eventloopen** och gör det med hela databasen, inte
  bara det som ändrats. Med 90 dagars data (60 tävlingar, ~57 000 löpare,
  16 MB) tar `JSON.stringify` 40 ms och skrivningen 24 ms. Under tävling, när
  MeOS skickar var tionde sekund, lyfter det p99 för kvittohämtning från 8 till
  69 ms medan medianen är oförändrad – omärkligt för en löpare, och därför
  medvetet inte optimerat. Blir datamängden flera gånger större närmar sig
  blockeringen en fördröjning som märks, och då är det inkrementell sparning
  som behövs, inte asynkron skrivning: `JSON.stringify` står för merparten, och
  två överlappande asynkrona sparningar skulle dessutom kunna trampa på samma
  tmp-fil.
- **Ingen build för frontend.** `public/` är vanilla JS/CSS som serveras statiskt
  och pollar `/api/receipt` var 15:e sekund. `PUBLIC_DIR` styr sökvägen (behövs för
  SEA-exen där `__dirname` blir exens mapp).
- **Inga externa beroenden i frontend.** Inga CDN:er, inga externa typsnitt –
  utseendet följer klubbsajten via en systemfont-stack. Utomstående resurser
  skulle läcka vilka löpare som öppnar sina kvitton.
- **Kvittot är alltid vitt papper med svart text i Courier**, oavsett sidans
  övriga färger, så att skärm, utskrift och PDF ser likadana ut. Färgkontraster
  bevakas av `test/tillganglighet.test.js`, som läser värdena ur `styles.css`.
- **Utgående svar får inte läcka driftdetaljer.** SMTP-fel loggas men klienten
  får ett neutralt meddelande, och `/api/receipt/email` har ett tak per
  avsändar-IP – tjänsten ligger öppen mot internet och skickar mejl på
  arrangörens konto.

### Tester

`test/fixtures/mop.js` och `test/fixtures/iof.js` delas av både enhetstester och
cucumber-steg (`features/support/steps.js`) – lägg nya fixtures där, inte inline.
Fixturernas huvudkommentarer listar vilken situation varje löpare täcker
(godkänd, felstämplad, utgången med och utan stämplingar, ej start, stafettlag,
trasig stämplingstid); håll dem uppdaterade när du lägger till någon.
Varje cucumber-scenario startar en egen server på port 0 och städar i `After`.

Testsviten bevisar att koden gör vad vi tror – inte att vi trott rätt saker. De
allvarligaste felen som hittats i projektet var alla gröna i testerna och
syntes först när utdata jämfördes mot en verklig tävlingsfil, när MeOS
faktiska driftbeteende härmades, eller när något mättes i stället för
bedömdes. Har du en skarp resultatfil: kör den mot tjänsten och jämför
placeringar och sträcktider mot filens egna värden.

## Deployment

Docker/`docker-compose.yml` (NAS) och `fly.toml` (Fly.io) finns i repot. Ligger
nginx framför: `client_max_body_size 32m;` krävs, annars 413 på `MOPComplete`.
`tools/ladda-upp-resultat.bat` körs på MeOS-datorn och får bara bero på inbyggd
`curl.exe` (KRAV-11) – `.gitattributes` tvingar CRLF på `tools/*.bat`.

`ladda-upp-resultat.sh` speglar `.bat`-filens logik och testas i
`test/uppladdning.test.js`; ändra båda när uppladdningen ändras. Filen räknas
som uppladdad först vid svaret `OK` – ett `BADPWD` eller `ERROR` ska ge nytt
försök, annars tystnar uppladdningen tills filen ändras igen.

E-post kräver `MAILGUN_SMTP`/`MAILGUN_USER`/`MAILGUN_PWD`. Mailgun EU kräver
`smtp.eu.mailgun.org` och att användarnamnet är en hel adress; saknas
konfigurationen är funktionen bara avstängd (`503`), inte trasig.

Två verktyg som inte ingår i `npm run verify` men som fångar sådant testerna
inte kan: `tools/verifiera-drift.sh <url> [bricka]` kontrollerar en driftsatt
tjänst (svarar den, når data disken, fungerar kvitto och PDF), och
`tools/korsvalidera.mjs <resultatfil> <url>` jämför samtliga kvitton mot en
riktig resultatfil. Det senare har hittat flera av projektets allvarligaste
fel; skarpa filer innehåller personuppgifter och tas därför som argument i
stället för att checkas in.

CI (`.github/workflows/ci.yml`) kör `npm test` + `npm run bdd` på varje push
till `main` och går att starta manuellt via `workflow_dispatch` – det behövs
när en driftstörning hos GitHub gör att push-eventet tappas bort.
