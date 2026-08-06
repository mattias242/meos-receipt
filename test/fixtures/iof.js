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
</ResultList>`;
