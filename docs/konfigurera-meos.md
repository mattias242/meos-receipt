# Konfigurera MeOS mot kvittotjänsten

Guide för dig som sitter vid MeOS-datorn på tävlingsdagen.

Byt ut `https://din-server.example` mot tjänstens adress. Den som driftsatt
tjänsten vet vilken den är, och vilket lösenord som gäller.

Det finns två inflöden, och de gör olika saker. Kör båda — men det första
räcker för att komma igång.

| | Vad det ger | Hur ofta |
| --- | --- | --- |
| **Onlineresultat** (MOP) | Namn, klass, status, tider, placering, radiotider | var tionde sekund, automatiskt |
| **Resultatautomat** (IOF XML) | **Alla** stämplingar i banordning, även saknade och extra | så ofta du ställer in |

Utan resultatautomaten visar kvittot bara radiokontrollerna. Med den visar det
hela stämplingslistan — vilket är själva poängen med ett kvitto.

---

## Innan tävlingsdagen

### Bestäm tävlings-id först

Ett heltal större än noll. Det används på **tre** ställen och måste vara
detsamma överallt:

1. MeOS Onlineresultat
2. Uppladdningsprogrammet för resultatfiler
3. Adressen i PM: `https://din-server.example/t/<tävlings-id>`

> **Använder de två inflödena olika id blir kvittona fel.** Tjänsten tror då
> att det är två skilda tävlingar, räknar placeringen på halva deltagarfältet
> och visar ofullständiga kvitton. Den varnar i loggen när det händer, men
> ingen sitter och läser loggen mitt under tävlingen.

Eftersom id:t ingår i PM-adressen behöver du bestämma det innan PM trycks.

### Skaffa lösenordet

Samma lösenord används av båda inflödena. Det sattes när tjänsten driftsattes
— fråga den som gjorde det. Skicka det inte i mejl eller chatt.

---

## Steg 1: Onlineresultat

**Tävling → Onlineresultat** i MeOS.

| Inställning | Värde |
| --- | --- |
| URL | `https://din-server.example/meos` |
| Tävlings-id | ditt valda heltal, t.ex. `4` |
| Lösenord | tjänstens lösenord |
| Format | MeOS onlineprotokoll (MOP) |

Ställ in **radiokontroller och mellantider** i MeOS om ni har dem — de blir
sträcktider på kvittot direkt, utan resultatautomaten.

Kontrollera att det gick fram:

```bash
curl -s https://din-server.example/api/health
```

`"competitions"` ska ha ökat med ett.

> Startar du om Onlineresultat mitt under tävlingen skickar MeOS hela
> tävlingen på nytt. Det är ofarligt — stämplingarna från resultatfilerna
> ligger kvar.

---

## Steg 2: Resultatautomat och uppladdning

### I MeOS

Skapa en **resultatautomat** under *Automater* som exporterar till fil:

| | |
| --- | --- |
| Format | **IOF XML 3.0 (ResultList)** |
| Sträcktider | **med** — utan dem blir hela steget meningslöst |
| Sökväg | t.ex. `C:\meos\resultat.xml` |
| Intervall | 30–60 sekunder räcker gott |

### På MeOS-datorn

Kopiera `tools\ladda-upp-resultat.cfg.exempel` till
`ladda-upp-resultat.cfg` bredvid `.bat`-filen och fyll i:

```ini
FIL=C:\meos\resultat.xml
URL=https://din-server.example
CMP=4
LOSEN=<tjänstens lösenord>
INTERVALL=10
```

**Dubbelklicka sedan på `ladda-upp-resultat.bat`.** Inga argument behövs, och
inget behöver installeras — programmet använder `curl.exe`, som ingår i
Windows 10 och 11.

Låt fönstret stå öppet under hela tävlingen. Det skriver en rad per
uppladdning:

```
14:32:10 OK
14:32:40 OK
```

| Svar | Betyder |
| --- | --- |
| `OK` | Uppladdad |
| `BADPWD` | Fel lösenord — rätta i `.cfg` |
| `BADCMP` | Tävlings-id saknas eller är noll |
| `ERROR` | Filen gick inte att tolka — exporterar automaten rätt format? |

Programmet ger inte upp vid fel. Först när svaret är `OK` räknas filen som
uppladdad, så ett tillfälligt fel leder till nytt försök i stället för tystnad.
Var trettionde varv laddas filen upp igen även om den ser oförändrad ut —
ändringsdetektorn bygger på tidsstämpel och storlek och kan missa en ändring.

> **Föredrar du PowerShell** finns `tools\LaddaUppResultat.ps1`, och på
> macOS/Linux `tools/ladda-upp-resultat.sh`. Alla tre gör samma sak.

---

## Steg 3: Adressen till löparna

```
https://din-server.example/t/<tävlings-id>
```

Den fungerar redan innan tävlingen börjat — då står det att inga resultat
kommit än — så den kan tryckas i PM eller sättas som QR-kod på arenan i
förväg.

Löparen som kommer den vägen slipper välja tävling och söker sedan på sitt
**bricknummer eller namn**. Delar hon sitt kvitto följer tävlingen med i
länken, så mottagaren hamnar rätt.

Kvittot visar namn, klubb och klass. **Bricknumret visas inte** — det går att
söka på, men lämnar aldrig tjänsten.

---

## Prova hela kedjan dagen före

```bash
tools/verifiera-drift.sh https://din-server.example <ett-bricknummer>
```

Nio kontroller: att tjänsten svarar, att data når disken, att kvitto och PDF
fungerar, och att konfigurationen är rätt. Allt ska vara grönt utom eventuella
varningar du känner igen.

Öppna sedan `https://din-server.example/t/<tävlings-id>` i mobilen och sök upp
en löpare. Ser kvittot rätt ut är ni klara.

---

## Under tävlingen

Två saker är värda att hålla ögonen på:

**Uppladdningsfönstret.** Slutar det skriva `OK` har något hänt med
resultatautomaten eller nätet.

**Kvittosidan säger själv ifrån.** Har tjänsten inte fått ny data på tio
minuter, och resultatet inte är klart, står det på kvittot:

> Tjänsten har inte fått ny data från tävlingen på 47 minuter. Ditt resultat
> kan redan vara registrerat – fråga tävlingsledningen om det dröjer.

Ser du den texten är det Onlineresultat som slutat skicka.

---

## Om något krånglar

| Symtom | Trolig orsak |
| --- | --- |
| Kvittot visar bara radiotider | Resultatfilen når inte fram — kolla uppladdningsfönstret |
| `BADPWD` i uppladdningsfönstret | Lösenordet skiljer sig från tjänstens |
| Två tävlingar med samma namn i listan | Onlineresultat och uppladdningen använder **olika tävlings-id** |
| Sträcktiderna hör inte ihop med loppet | Uppladdningen pekar på en gammal resultatfil |
| En löpare hittar inte sitt kvitto | Sök på namn i stället; delad bricka ger en valbar lista |
| Kvittot står stilla | Onlineresultat har slutat skicka — se varningen ovan |
| Mejlformuläret syns inte | E-post är inte påslaget; `/api/health` visar `"email": false` |
| `413` i MeOS eller uppladdningen | En proxy framför tjänsten stryper kroppsstorleken — säg till den som driftsatt |

Tävlingsdata gallras automatiskt efter 90 dagar.

---

## Fungerar det utan Onlineresultat?

Ja. Laddar du bara upp resultatfiler skapas löparna av dem, och kvittona
fungerar — men utan den löpande uppdateringen under loppet. Omvänt fungerar
också: bara Onlineresultat, med radiotider i stället för hela
stämplingslistan.

Bäst blir det med båda.
