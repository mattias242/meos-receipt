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
- `lib/store.js` — allt data i ett objekt per tävlings-id (`cid`), persisteras
  debounced (`saveDelayMs`) till `DATA_DIR/competitions.json` via tmp + rename.
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
- **Skarp data innehåller orimliga stämplingstider.** Gamla stämplingar kvar i
  brickan, eller en kontrollenhet med fel klocka, ger tider långt utanför
  loppet. En tid större än löparens totaltid är ingen sträcktid: kontrollen
  visas utan tider och nästa sträcka räknas från föregående giltiga stämpling.
  I en verklig tävlingsfil drabbade det 40 av 110 löpare.
- **Har ingen stämpling någon tid visas ingen tabell.** MeOS exporterar hela
  banan som `Missing` för den som brutit utan att stämpla; en tabell med enbart
  streck säger löparen ingenting, så kvittot skriver i stället att inga
  stämplingar registrerats.
- **XML-endpointerna svarar ren text**, aldrig JSON: `OK`, `BADCMP`, `BADPWD`,
  `NOZIP`, `ERROR`. `NOZIP` (payload börjar med `PK`) får MeOS att skicka om
  okomprimerat – zip stöds medvetet inte. Rå body, gräns 32 MB.
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

CI (`.github/workflows/ci.yml`) kör `npm test` + `npm run bdd` på varje push
till `main` och går att starta manuellt via `workflow_dispatch` – det behövs
när en driftstörning hos GitHub gör att push-eventet tappas bort.
