/**
 * IOF XML 3.0 ResultList med sträcktider – som MeOS resultatautomat
 * exporterar den till fil. Matchar löparna i MOP-fixturerna via bricknummer.
 *
 * MeOS lägger extra stämplingar (status="Additional") sist i varje Result,
 * efter de banordnade – inte på sin kronologiska plats. Fixturen speglar det.
 *
 * - Anna Andersson (123456): godkänd, komplett bana + en extra stämpling (77)
 * - Carl Carlsson (111111): felstämplad, kontroll 45 saknas
 * - Frida Frisk (333333): finns inte i MOP-datat alls
 * - Doris Dahl (222222): utgått utan att stämpla något – MeOS exporterar då
 *   hela banan som Missing, vilket annars ger ett kvitto med bara streck
 * - Gustav Grön (555555): utgått efter att ha hunnit två kontroller
 * - Helga Hök (666666): godkänd, men kontroll 32 har en tid långt utanför
 *   loppet (gammal stämpling i brickan / kontrollenhet med fel klocka)
 * - Ivar Isaksson (777777): godkänd, men kontroll 87 har en klocka som går
 *   före. Tiden ryms inom loppet och slinker därför förbi totaltidsfiltret –
 *   den avslöjas bara av att den motsäger banordningen (87 ligger före 46 i
 *   banan men har högre tid). Så såg Sommarträning 13/8 ut på Orange-banan.
 */
export const IOF_RESULTLIST = `<?xml version="1.0" encoding="UTF-8"?>
<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" status="Complete">
  <Event>
    <Name>Testtävlingen</Name>
    <StartTime><Date>2026-08-06</Date></StartTime>
  </Event>
  <ClassResult>
    <Class><Id>1</Id><Name>H21</Name></Class>
    <PersonResult>
      <Person><Id>31</Id><Name><Given>Anna</Given><Family>Andersson</Family></Name></Person>
      <Organisation><Name>OK Skogen</Name></Organisation>
      <Result>
        <StartTime>2026-08-06T10:00:00+02:00</StartTime>
        <FinishTime>2026-08-06T10:35:00+02:00</FinishTime>
        <Time>2100</Time>
        <Position>2</Position>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>450</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>900</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>1350</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>1800</Time></SplitTime>
        <SplitTime status="Additional"><ControlCode>77</ControlCode><Time>1000</Time></SplitTime>
        <ControlCard>123456</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Carl</Given><Family>Carlsson</Family></Name></Person>
      <Organisation><Name>OK Skogen</Name></Organisation>
      <Result>
        <StartTime>2026-08-06T10:20:00+02:00</StartTime>
        <FinishTime>2026-08-06T10:50:00+02:00</FinishTime>
        <Time>1800</Time>
        <Status>MissingPunch</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>400</Time></SplitTime>
        <SplitTime status="Missing"><ControlCode>45</ControlCode></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>1500</Time></SplitTime>
        <ControlCard>111111</ControlCard>
      </Result>
    </PersonResult>
  </ClassResult>
  <ClassResult>
    <Class><Id>2</Id><Name>D21</Name></Class>
    <PersonResult>
      <Person><Name><Given>Doris</Given><Family>Dahl</Family></Name></Person>
      <Organisation><Name>OK Skogen</Name></Organisation>
      <Result>
        <StartTime>2026-08-06T10:00:00+02:00</StartTime>
        <Status>DidNotFinish</Status>
        <SplitTime status="Missing"><ControlCode>31</ControlCode></SplitTime>
        <SplitTime status="Missing"><ControlCode>32</ControlCode></SplitTime>
        <SplitTime status="Missing"><ControlCode>45</ControlCode></SplitTime>
        <ControlCard>222222</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Gustav</Given><Family>Grön</Family></Name></Person>
      <Organisation><Name>OK Skogen</Name></Organisation>
      <Result>
        <StartTime>2026-08-06T10:10:00+02:00</StartTime>
        <Status>DidNotFinish</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>420</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>880</Time></SplitTime>
        <SplitTime status="Missing"><ControlCode>45</ControlCode></SplitTime>
        <ControlCard>555555</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Helga</Given><Family>Hök</Family></Name></Person>
      <Organisation><Name>OK Skogen</Name></Organisation>
      <Result>
        <StartTime>2026-08-06T10:00:00+02:00</StartTime>
        <FinishTime>2026-08-06T10:30:00+02:00</FinishTime>
        <Time>1800</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>300</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>54288</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>900</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>1500</Time></SplitTime>
        <ControlCard>666666</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Frida</Given><Family>Frisk</Family></Name></Person>
      <Organisation><Name>OK Skogen</Name></Organisation>
      <Result>
        <StartTime>2026-08-06T10:05:00+02:00</StartTime>
        <FinishTime>2026-08-06T10:45:00+02:00</FinishTime>
        <Time>2400</Time>
        <Position>1</Position>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>500</Time></SplitTime>
        <ControlCard>333333</ControlCard>
      </Result>
    </PersonResult>
  </ClassResult>
  <ClassResult>
    <Class><Id>4</Id><Name>H45</Name></Class>
    <PersonResult>
      <Person><Name><Given>Ivar</Given><Family>Isaksson</Family></Name></Person>
      <Organisation><Name>OK Skogen</Name></Organisation>
      <Result>
        <StartTime>2026-08-06T10:00:00+02:00</StartTime>
        <FinishTime>2026-08-06T10:30:00+02:00</FinishTime>
        <Time>1800</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>300</Time></SplitTime>
        <SplitTime><ControlCode>87</ControlCode><Time>1400</Time></SplitTime>
        <SplitTime><ControlCode>46</ControlCode><Time>1000</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>1500</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>1650</Time></SplitTime>
        <ControlCard>777777</ControlCard>
      </Result>
    </PersonResult>
  </ClassResult>
</ResultList>`;


/**
 * IOF ResultList byggd för bomanalysen (KRAV-25). Egen tävling (id 5) med egna
 * bricknummer, så att inget scenario för de andra fixturerna rubbas.
 *
 * Klassen "H21 Bom" har banan 31-32-45-50-mål. Baslinjen per sträcka blir
 * 60, 120, 180, 90, 60 sekunder: två löpare springer exakt den tiden, och
 * eftersom 5 <= n < 12 tar MeOS snittet av de två snabbaste.
 *
 * - Rakel Referens  (900001) godkänd, exakt baslinjen hela vägen
 * - Rune Referens   (900002) samma – det är de två som sätter baslinjen
 * - Bosse Bom       (900003) baslinjen utom sträckan till 45, som tar tre
 *   minuter extra. Facit ur MeOS tre pass: 157 s (2:37) på kontroll 45.
 * - Lena Långsam    (900004) exakt 1,5 gånger baslinjen på VARJE sträcka.
 *   Den egna nivån räknas bort, så delta blir noll och hon får inga bommar.
 * - Milla Marginal  (900005) 15 s extra till kontroll 50 – under
 *   20-sekunderströskeln och ska därför inte rapporteras.
 * - Gunnar Gaffel   (900006) gafflad: 77 i stället för 45, och långsam där.
 *   Sträckorna 32>77 och 77>50 delas med ingen, så baslinjen blir hans egen
 *   tid och bomtiden noll. Med indexnyckling i stället för kontrollkodspar
 *   hade han felaktigt fått 139 s.
 * - Frida Fel       (900007) felstämplad: 45 saknas, och hon är dessutom
 *   långsam till 32. Facit: 1711 tiondelar (2:51) på kontroll 32, och INGEN
 *   bomtid på kontroll 50 trots att den sträckan spänner över den saknade
 *   kontrollen – den nyckeln delar hon med ingen, så det finns inget att
 *   jämföra med.
 * - Uno Utgången    (900008) utgått med två kontroller tagna. Bidrar till
 *   baslinjen men har själv för få sträckor för att analyseras.
 * - Olle Opålitlig  (900009) kontroll 32 har en tid långt utanför loppet.
 *   Den får varken egen bomtid eller sätta baslinjen för sträckan till 32.
 *
 * Klassen "D21 Bom" har bara två löpare – under MeOS gräns om tre – och
 * används för scenariot där kvittot säger att underlag saknas.
 */
export const IOF_BOMTID = `<?xml version="1.0" encoding="UTF-8"?>
<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" status="Complete">
  <Event>
    <Name>Bomtävlingen</Name>
    <StartTime><Date>2026-08-20</Date></StartTime>
  </Event>
  <ClassResult>
    <Class><Id>1</Id><Name>H21 Bom</Name></Class>
    <PersonResult>
      <Person><Name><Given>Rakel</Given><Family>Referens</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>510</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>180</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>360</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>450</Time></SplitTime>
        <ControlCard>900001</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Rune</Given><Family>Referens</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>510</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>180</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>360</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>450</Time></SplitTime>
        <ControlCard>900002</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Bosse</Given><Family>Bom</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>690</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>180</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>540</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>630</Time></SplitTime>
        <ControlCard>900003</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Lena</Given><Family>Långsam</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>765</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>90</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>270</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>540</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>675</Time></SplitTime>
        <ControlCard>900004</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Milla</Given><Family>Marginal</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>525</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>180</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>360</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>465</Time></SplitTime>
        <ControlCard>900005</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Gunnar</Given><Family>Gaffel</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>740</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>180</Time></SplitTime>
        <SplitTime><ControlCode>77</ControlCode><Time>580</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>680</Time></SplitTime>
        <ControlCard>900006</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Frida</Given><Family>Fel</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>720</Time>
        <Status>MissingPunch</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>360</Time></SplitTime>
        <SplitTime status="Missing"><ControlCode>45</ControlCode></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>660</Time></SplitTime>
        <ControlCard>900007</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Uno</Given><Family>Utgången</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>600</Time>
        <Status>DidNotFinish</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>70</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>200</Time></SplitTime>
        <SplitTime status="Missing"><ControlCode>45</ControlCode></SplitTime>
        <SplitTime status="Missing"><ControlCode>50</ControlCode></SplitTime>
        <ControlCard>900008</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Olle</Given><Family>Opålitlig</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>510</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>99999</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>360</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>450</Time></SplitTime>
        <ControlCard>900009</ControlCard>
      </Result>
    </PersonResult>
  </ClassResult>
  <ClassResult>
    <Class><Id>2</Id><Name>D21 Bom</Name></Class>
    <PersonResult>
      <Person><Name><Given>Petra</Given><Family>Person</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>510</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>60</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>180</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>360</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>450</Time></SplitTime>
        <ControlCard>900010</ControlCard>
      </Result>
    </PersonResult>
    <PersonResult>
      <Person><Name><Given>Pia</Given><Family>Person</Family></Name></Person>
      <Organisation><Name>OK Bommen</Name></Organisation>
      <Result>
        <StartTime>2026-08-20T10:00:00+02:00</StartTime>
        <Time>570</Time>
        <Status>OK</Status>
        <SplitTime><ControlCode>31</ControlCode><Time>70</Time></SplitTime>
        <SplitTime><ControlCode>32</ControlCode><Time>200</Time></SplitTime>
        <SplitTime><ControlCode>45</ControlCode><Time>400</Time></SplitTime>
        <SplitTime><ControlCode>50</ControlCode><Time>500</Time></SplitTime>
        <ControlCard>900011</ControlCard>
      </Result>
    </PersonResult>
  </ClassResult>
</ResultList>`;
