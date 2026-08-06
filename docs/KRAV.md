# Krav – Digitalt kvitto för MeOS

Kraven är dokumenterade som exekverbara BDD-scenarier (Gherkin, svenska) i
[`features/`](../features/). Varje krav nedan spåras till en egenskap och sina
scenarier; scenarierna körs med `npm run bdd` och är den auktoritativa
definitionen av "klart". Implementation sker med TDD: scenariot/enhetstestet
skrivs först (rött), därefter implementeras minsta möjliga kod tills det är
grönt.

## Kravlista

| Krav | Beskrivning | Egenskap (feature-fil) |
| --- | --- | --- |
| KRAV-1 | Tjänsten tar emot tävlingsdata via MeOS onlineprotokoll (MOP 2.0) med tävlings-id och lösenord i HTTP-headers, och svarar med samma statuskoder som MeOS referensimplementation (`OK`, `BADCMP`, `BADPWD`, `NOZIP`, `ERROR`). | `features/mop-mottagning.feature` |
| KRAV-2 | `MOPComplete` ersätter all data för tävlingen; `MOPDiff` uppdaterar befintlig data utan att radera annat. | `features/mop-mottagning.feature` |
| KRAV-3 | En löpare kan hämta sitt digitala kvitto med sitt SportIdent-nummer. Kvittot visar namn, klubb, klass, löptid, status, placering, tid efter segraren, start-/måltid samt sträcktider (radiokontroller + mål) med sträck-, total- och klocktid. | `features/kvitto.feature` |
| KRAV-4 | Status visas begripligt på svenska: godkänd, felstämplad, utgått, ej start m.fl. En löpare som startat men saknar resultat visas som "Ute på banan". Preliminära resultat markeras och får preliminär placering. | `features/kvitto.feature` |
| KRAV-5 | Löpare kan även sökas på namn (delsträng, skiftlägesokänsligt). Träfflistan visar namn, klubb, klass och bricka. | `features/sokning.feature` |
| KRAV-6 | Ett bricknummer som inte finns i den senaste tävlingen men i en tidigare inläst tävling ger ändå träff (senaste tävling där brickan förekommer). | `features/sokning.feature` |
| KRAV-7 | Om flera löpare delar samma bricka i en tävling svarar kvitto-API:t med en valbar träfflista i stället för att gissa. | `features/kvitto.feature` |
| KRAV-8 | Inläst tävlingsdata överlever en omstart av tjänsten. | `features/persistens.feature` |
| KRAV-9 | Tjänsten tar emot resultatfiler i IOF XML 3.0 (ResultList med sträcktider), exporterade av MeOS resultatautomat, via `POST /iof` med samma autentisering som MOP. Löpare matchas mot befintlig MOP-data via bricknummer; löpare som bara finns i resultatfilen skapas. | `features/resultatfiler.feature` |
| KRAV-10 | När en resultatfil är inläst visar kvittot samtliga stämplingar i banordning — inklusive saknade kontroller (felstämpling) och extra stämplingar — med sträck-, total- och klocktid, samt starttid och måltid. Utan resultatfil visas radiotider som tidigare. | `features/resultatfiler.feature` |
| KRAV-11 | Uppladdningen från MeOS-datorn ska kunna köras som ren Windows/DOS-applikation (cmd.exe/`.bat`) utan andra beroenden än det som ingår i Windows 10/11 (`curl.exe`). Programmet ska även kunna startas med dubbelklick via en konfigfil. | `tools/ladda-upp-resultat.bat` — *verifieras manuellt på Windows; kan inte automattestas i CI-miljön (Linux)* |

## Arbetssätt

- **BDD:** Nya krav formuleras som scenarier i `features/` innan implementation
  påbörjas. Ett krav är uppfyllt när dess scenarier är gröna.
- **TDD:** Implementationsdetaljer (parsning, tidsformat, placering m.m.) drivs
  av enhetstester i `test/` (`npm test`). Skriv testet först, se det falla,
  implementera, se det passera, refaktorera.
- **Definition of done:** `npm test` och `npm run bdd` gröna.

## Avgränsningar

- MOP-protokollet innehåller endast radiotider. Kompletta stämplingar per
  kontroll skickas inte av MeOS den vägen; för fullständiga kvitton med alla
  stämplingar (inkl. felstämplade och saknade) kompletteras MOP med
  resultatfiler från MeOS resultatautomat (KRAV-9/KRAV-10).
- Zip-komprimerade sändningar stöds inte; tjänsten svarar `NOZIP` vilket får
  MeOS att sända om okomprimerat (samma beteende som referensimplementationen).
