# Driftsättning på Synology-NAS bakom Cloudflare

Mall. Byt `<värdnamn>`, `<användare>` och `<nas-adress>` mot dina egna
värden — de hör hemma i din egen anteckning, inte i ett publikt repo.

Kedjan är **Cloudflare → DSM-nginx på NAS:en → containern**. Uppsättningen
följer mönstret från `ett befintligt värdnamn`: vhosten bor i projektet och
installeras till `/etc/nginx/conf.d/`.

```mermaid
flowchart LR
  K["Löparens mobil"] --> CF["Cloudflare<br/>SSL-läge Full"]
  MEOS["MeOS på tävlingsdatorn"] --> CF
  CF --> NG["DSM-nginx<br/>http.<värdnamn>.conf"]
  NG --> APP["container meos-kvitto<br/>127.0.0.1:3459"]
  APP --> VOL[("/volume2/web/meos-kvitto/data")]
```

Avläst på NAS:en, inte antaget:

| | |
| --- | --- |
| Värdport | **3459** (ledig; youmewe ligger på 3456) – sätts som `HOST_PORT` i `.env` |
| Origin-certifikat | `/etc/ssl/certs/nas-origin.pem`, SAN en SAN som täcker värdnamnet — självsignerat |
| Cloudflare SSL-läge | **Full**, aldrig *Full (strict)* — certifikatet är självsignerat |
| `client_max_body_size` | redan `0` globalt i DSM:s nginx; sätts ändå i vhosten |
| `TRUST_PROXY` | **2** — Cloudflare och nginx bygger båda på `X-Forwarded-For` |

## 1. DNS

`<värdnamn>` saknar post. Lägg till den i Cloudflare, proxad
(orange moln), som övriga värdnamn i zonen.

## 2. Lägg upp projektet

```bash
# från arbetskatalogen
git archive --format=tar HEAD | gzip > /tmp/meos-kvitto.tgz
scp -O /tmp/meos-kvitto.tgz <användare>@<nas-adress>:/volume2/web/
ssh <användare>@<nas-adress> '
  mkdir -p /volume2/web/meos-kvitto &&
  tar xzf /volume2/web/meos-kvitto.tgz -C /volume2/web/meos-kvitto'
```

## 3. Konfigurera och starta

```bash
ssh <användare>@<nas-adress>
cd /volume2/web/meos-kvitto
cp deploy/env.exempel .env      # fyll i MEOS_PASSWORD, MAILGUN_PWD och HOST_PORT
chmod 600 .env

# Synologys Docker skapar inte bind-monteringens katalog själv – utan den
# vägrar containern starta med "Bind mount failed".
mkdir -p data

DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
$DOCKER compose up -d --build
curl -s localhost:3459/api/health
```

Tjänsten vägrar starta utan `MEOS_PASSWORD` — skrivändpunkterna ligger annars
öppna mot internet (KRAV-13).

Lösenordet behöver aldrig passera någon annanstans. Skapa det på NAS:en:

```bash
openssl rand -base64 24 | tr -d '/+=' | cut -c1-28
```

Läs det när det ska in i MeOS Onlineresultat:

```bash
grep '^MEOS_PASSWORD=' /volume2/web/meos-kvitto/.env | cut -d= -f2-
```

## 4. Installera vhosten

```bash
sudo cp deploy/http.VARDNAMN.conf.exempel /etc/nginx/conf.d/
sudo chmod 755 /etc/nginx/conf.d/http.<värdnamn>.conf
sudo nginx -t && sudo nginx -s reload
```

**Använd `nginx -s reload`, inte `synosystemctl restart nginx`.** Det senare går
via Synologys tjänstehanterare, hänger, och tar ner containrar på vägen — här
stoppades både `ntfy` och `meos-kvitto`, och med `restart: unless-stopped`
startade de inte om av sig själva. `-s reload` skickar SIGHUP direkt till nginx
master: inga avbrott, ingen kaskad.

`cp` kan lämna filen med läge `000`; nginx kör som root och läser den ändå, men
`nginx -t` som annan användare gör det inte. Därav `chmod`.

DSM kan skriva över egna filer i `/etc/nginx/conf.d/` vid större
uppdateringar — kör då det här steget igen.

## 5. Kontrollera — innan tävlingsdagen

```bash
tools/verifiera-drift.sh https://<värdnamn>
```

Nio kontroller: att tjänsten svarar, att data når disken, att
skrivändpunkterna kräver lösenord, att kvitton inte får cachas, att
proxyinställningen stämmer, och att kvitto och PDF fungerar.

**`TRUST_PROXY` ska inte gissas.** Tjänsten räknar hur många led som faktiskt
rapporteras i `X-Forwarded-For` och säger vad värdet borde vara:

```
✗ Proxyinställningen stämmer inte med hur anropen kommer in
    Anropen kommer via 2 proxyled men TRUST_PROXY är 1 – löparens adress blir
    då proxyns, gemensam för alla. Sätt TRUST_PROXY till 2.
```

Med fel värde räknas alla löpare som samma avsändare, och mejltaket låser ut
hela tävlingen efter fem utskick — utan att något annat ser fel ut. Samma
siffra finns i `/api/health` som `proxyhopp`.

## 6. MeOS på tävlingsdatorn

| | |
| --- | --- |
| Onlineresultat | `https://<värdnamn>/meos` |
| Resultatfiler | `https://<värdnamn>/iof` |
| Lösenord | samma som `MEOS_PASSWORD` |

## 7. Adressen i PM

Varje tävling har en egen adress (KRAV-18), att trycka i PM eller sätta som
QR-kod på arenan:

```
https://<värdnamn>/t/<tävlings-id>
```

Id:t är detsamma som du sätter i MeOS Onlineresultat. Adressen fungerar innan
tävlingen börjat — sidan säger då att inga resultat kommit än — så den kan
tryckas i förväg.

## 7b. Klubbens egen adress (KRAV-20)

Ett värdnamn kan bindas till en bestämd tävling, så att arrangören slipper ha
tjänstens domän och ett tävlings-id i den tryckta adressen. `https://kvitto.klubben.se/`
skickas då vidare till `/t/<tävlings-id>` — och löparen blir kvar på klubbens
värdnamn hela vägen, även i kvittolänkar hon delar.

Att lägga till ett värdnamn, en gång per klubb:

1. **DNS.** Lägg upp värdnamnet i Cloudflare, proxat (orange moln), mot samma
   adress som tjänstens övriga värdnamn. Ligger värdnamnet i en **annan zon** än
   den vanliga: kontrollera att den zonen har SSL-läge **Full** — inte *Full
   (strict)*. Origin-certet är självsignerat och har inget SAN för den domänen,
   så strict ger 526.
2. **Vhost.** Samma steg som avsnitt 4, med `server_name` satt till det nya
   värdnamnet. Filen heter `http.<värdnamn>.conf`. Utan vhost svarar DSM med
   Synology Web Stations standardsida, och allt ser ut att fungera utom att det
   är fel sida.
3. **Bindningen.** I `.env`:

   ```
   VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002
   ```

   Flera skiljs med komma. Starta om containern: `docker-compose up -d`.

### Inför varje nytt arrangemang

Bara bindningen behöver pekas om — ingen vhost-ändring, ingen deploy. Kör på
servern, i projektkatalogen:

```bash
cd /volume2/web/meos-kvitto
./tools/byt-tavling.sh 26091401
```

Skriptet skriver om raden i `.env`, startar om containern och kontrollerar mot
containern direkt att `/` skickas vidare till `/t/26091401`. Är flera värdnamn
bundna anges vilket: `./tools/byt-tavling.sh 26091401 kvitto.klubben.se`.

**Redigera inte `.env` för hand.** En andra `VARDNAMN_TAVLINGAR`-rad ser riktig
ut men gör att den ena tyst vinner över den andra, och det märks först när
löparen står i målfållan och ser fel tävling. Skriptet skriver om den befintliga
raden och städar bort en eventuell dubblett.

Kontrollera utifrån när DNS och cache hunnit med:

```bash
curl -sI https://kvitto.klubben.se | head -3
# HTTP/2 302
# location: /t/26091401        ← ska vara 302, aldrig 301
```

Vidareskickningen är medvetet **tillfällig**. En 301 cachas permanent i löparnas
webbläsare, och nästa gång bindningen pekas om skulle de som varit med förra
gången hamna på fel tävling utan att kunna göra något åt det.

`/t/<tävlings-id>` fungerar oförändrat från alla värdnamn — bindningen är en
genväg från förstasidan, inte en låsning av tjänsten.

### Två tävlingar samma helg, samma värdnamn

Lördag och söndag är **två tävlingar med varsitt tävlings-id** i MeOS, men bara
ett värdnamn och en QR-kod i målfållan. Två saker går fel om de inte görs, och
båda ser rätt ut ända tills löparen står med telefonen i handen.

**QR-koden ska peka på roten, inte på `/t/<id>`.**

```
https://kvitto.klubben.se/          ← rätt: följer bindningen, samma kod båda dagarna
https://kvitto.klubben.se/t/26090501  ← fel: visar lördagens tävling även på söndagen
```

Koden trycks en gång och sitter kvar på alla tre stationerna i målfållan hela
helgen. Med tävlings-id:t i koden hade söndagens löpare fått lördagens tävling,
och den enda rättningen hade varit att trycka om skyltarna mitt under loppet.
Roten skickas i stället vidare (302, aldrig 301) till den tävling som är bunden
just nu.

**Bindningen ska pekas om på söndag morgon** — den följer inte med av sig själv.

Checklista för helgen:

| När | Vad | Kommando |
| --- | --- | --- |
| Före lördag | Bind lördagens tävling | `./tools/byt-tavling.sh 26090501` |
| Före lördag | Kontrollera utifrån | `curl -sI https://kvitto.klubben.se \| head -3` → `302` mot `/t/26090501` |
| Före lördag | Kontrollera hela kedjan | `tools/verifiera-drift.sh https://kvitto.klubben.se` |
| **Söndag morgon** | Peka om bindningen | `./tools/byt-tavling.sh 26090601` |
| **Söndag morgon** | Kontrollera **innan första löparen går i mål** | `curl -sI https://kvitto.klubben.se \| head -3` → `302` mot `/t/26090601` |
| Söndag morgon | Kontrollera att söndagens data kommer in | `curl -s https://kvitto.klubben.se/api/health` |

`byt-tavling.sh` startar om containern och kontrollerar själv mot containern att
`/` skickas vidare till rätt tävling. Kontrollen utifrån är ändå värd sina tio
sekunder: den säger att DNS och Cloudflares cache också hunnit med.

**Räkna inte med att bricksökningen räddar dagen.** KRAV-6 slår upp ett
bricknummer i den senaste tävling där brickan förekommer — men bara när
uppslaget görs *utan* tävling. Skannar löparen QR-koden hamnar hon på
`/t/<bunden tävling>`, och sidan skickar med den tävlingen i varje sökning.
Uppmätt mot tjänsten med lördagen bunden och en söndagsbricka:

```
GET /api/receipt?cmp=<lördagen>&card=<söndagsbricka>
→ 404 {"error":"Ingen löpare med bricka 8002 hittades."}
GET /api/search?q=<söndagsbricka>&cmp=<lördagen>
→ 200 []
```

Söndagens löpare får alltså **inget kvitto alls**, inte bara fel rubrik. Den som
sprang båda dagarna får i stället lördagens kvitto, med lördagens tävlingsnamn i
rubriken — rätt person, fel dag. Fri sökning i senaste tävlingen fungerar bara
från tjänstens egen förstasida, där ingen tävling är bunden. Kontrollen i
tabellen ovan är därför inte valfri.

**Läsgränsen räcker för båda dagarna.** Uppmätt med `tools/lasttest.mjs 1000 20`:
med det gamla taket `READ_LIMIT=1000` fick 802 av 1000 löpare sitt kvitto när de
sökte på namn, och söndagens tävling gav **0 av 1000** från en klient som redan
sett lördagens fält. Med `5000` går båda dagarna igenom. Ändra inte värdet inför
helgen utan att mäta om.

**Glöm inte MeOS.** Onlineresultat på tävlingsdatorn ska ha söndagens tävlings-id
och samma `MEOS_PASSWORD`; uppladdningen av resultatfiler ska peka på söndagens
fil. Ett kvarglömt lördags-id syns som att söndagens löpare aldrig dyker upp.

## 8. Uppdatera en driftsatt tjänst

Samma kedja som steg 2, följt av en ombyggnad:

```bash
git archive --format=tar HEAD | gzip > /tmp/meos-kvitto.tgz
scp -O /tmp/meos-kvitto.tgz <användare>@<nas-adress>:/volume2/web/
ssh <användare>@<nas-adress> '
  cd /volume2/web/meos-kvitto &&
  tar xzf /volume2/web/meos-kvitto.tgz -C . &&
  /var/packages/ContainerManager/target/usr/bin/docker compose up -d --build'
```

**Uppackningen skriver över allt som ligger i repot**, `docker-compose.yml`
inräknat. Därför får inga driftvärden redigeras in i de filerna — de hör
hemma i `.env`, som inte finns i repot och alltså ligger kvar. Det var
`HOST_PORT` som lärde oss det: värdporten stod förr i `docker-compose.yml`,
återställdes till 3000 vid varje deploy, och containern band då fel port
medan nginx pekade på den gamla. Utåt blev det 502, medan `docker ps` såg
fullt friskt ut.

`data/` ligger utanför repot och rörs inte — tävlingsdata överlever en
uppdatering. Kontrollera efteråt med `tools/verifiera-drift.sh`.

## Noterat vid driftsättningen

- **Containern kör som `root`**, så filerna den skriver i `data/` blir
  root-ägda även om katalogen ägs av dig. Det fungerar, men en backup som körs
  som annan användare kan behöva `sudo`.
- **Startloggen säger "Löpare når kvittosidan via arenans wifi på …"** och
  visar containerns interna adress. Raden kommer från reservspåret utan
  internet (KRAV-12, utgått) och är missvisande här. Kosmetiskt.

## Kvarstående, ditt beslut

- **Containern kör som `root`.** Rättningen kräver att datakatalogen ägs av
  rätt uid; en volym som slutar gå att skriva till på en tävlingsdag är värre
  än problemet. Se `docs/systemritning.md`.
- **Läsgränsen är en bromskloss, inte en mur.** `READ_LIMIT=5000` olika löpare
  per klient och kvart. Höjt från 1000 efter mätning: en tävling med 1000
  deltagare bakom samma operatörsadress kostar ~1250 identiteter när löparna
  söker på namn, och en helg med tävling båda dagarna kostar det dubbla. Ett för
  lågt tak ger 429 åt en löpare som just gått i mål; ett för högt ger den som
  ändå skrapar några timmar i stället för en. Mät med `tools/lasttest.mjs` innan
  du ändrar. Taket är också ett minnestak: en klient som når det håller ~170 kB
  i en kvart.
