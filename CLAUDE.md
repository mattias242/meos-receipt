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
MeOS Onlineresultat ──MOP 2.0 XML──▶ POST /meos ─┐
                                                 ├─▶ store (minne + JSON) ─▶ GET /api/receipt ─▶ public/
MeOS resultatautomat ─IOF XML 3.0──▶ POST /iof ──┘
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

### Regler som är lätta att bryta

- **Tider är tiondels sekunder överallt** (MOP-konvention). `st` = tiondelar efter
  midnatt tävlingsdagen, `rt` = löptid i tiondelar. Formatering sker bara i
  `fmtClock`/`fmtElapsed` i `lib/receipt.js`.
- **MOP äger sanningen.** `applyIof` skriver bara `stat`/`st`/`rt` när MOP-datat
  saknar dem; `punches` (stämplingslistan) sätts alltid av IOF.
- **`punches` slår `radios`.** `buildSplits` väljer den kompletta
  stämplingslistan från resultatfilen om den finns, annars radiotiderna från MOP.
- **XML-endpointerna svarar ren text**, aldrig JSON: `OK`, `BADCMP`, `BADPWD`,
  `NOZIP`, `ERROR`. `NOZIP` (payload börjar med `PK`) får MeOS att skicka om
  okomprimerat – zip stöds medvetet inte. Rå body, gräns 32 MB.
- **Statuskoder** är MeOS numeriska koder (`STATUS_TEXT` i `lib/receipt.js`);
  IOF-status mappas mot dem via `IOF_STATUS_TO_STAT` i `lib/iof.js`.
- **Ingen build för frontend.** `public/` är vanilla JS/CSS som serveras statiskt
  och pollar `/api/receipt` var 15:e sekund. `PUBLIC_DIR` styr sökvägen (behövs för
  SEA-exen där `__dirname` blir exens mapp).

### Tester

`test/fixtures/mop.js` och `test/fixtures/iof.js` delas av både enhetstester och
cucumber-steg (`features/support/steps.js`) – lägg nya fixtures där, inte inline.
Varje cucumber-scenario startar en egen server på port 0 och städar i `After`.

## Deployment

Docker/`docker-compose.yml` (NAS) och `fly.toml` (Fly.io) finns i repot. Ligger
nginx framför: `client_max_body_size 32m;` krävs, annars 413 på `MOPComplete`.
`tools/ladda-upp-resultat.bat` körs på MeOS-datorn och får bara bero på inbyggd
`curl.exe` (KRAV-11) – `.gitattributes` tvingar CRLF på `tools/*.bat`.
