# language: sv
# KRAV-21, KRAV-22 (docs/KRAV.md)
Egenskap: Användningsstatistik och löparens omdöme

  Tjänsten räknar hur den används, så att arrangören kan svara på om det
  digitala kvittot är värt något. Måtten är aggregerade per tävling: vem som
  tittat eller röstat lagras aldrig.

  Bakgrund:
    Givet att tjänsten är igång med datalagring
    Och att MeOS har skickat en komplett tävling med tävlings-id 1

  Scenario: Ett hämtat kvitto räknas
    När jag hämtar kvittot för bricka 123456
    Så visar statistiken 1 visade kvitton för tävling 1

  # Kvittosidan hämtar samma kvitto var 15:e sekund. Räknades anropen skulle
  # måttet mäta hur länge sidan stod öppen, inte hur många som tittat.
  Scenario: Samma löpare räknas en gång hur många gånger sidan än uppdateras
    När jag hämtar kvittot för bricka 123456
    Och jag hämtar kvittot för bricka 123456
    Och jag hämtar kvittot för bricka 123456
    Så visar statistiken 1 visade kvitton för tävling 1

  Scenario: Olika löpare räknas var för sig
    När jag hämtar kvittot för bricka 123456
    Och jag hämtar kvittot för bricka 654321
    Så visar statistiken 2 visade kvitton för tävling 1

  # Fyra av fem i fixturen kom till start; Eva Ek står som ej start.
  Scenario: Andelen räknas mot de startande, inte mot alla anmälda
    När jag hämtar kvittot för bricka 123456
    Så visar statistiken 4 startande för tävling 1

  Scenario: PDF räknas för sig
    När jag laddar ner kvittot som PDF för bricka 123456
    Så visar statistiken 1 hämtade PDF:er för tävling 1

  # MeOS skickar en ny komplett sändning varje gång Onlineresultat startas om.
  # Låg mätningen i tävlingens egen fil skulle den nollställas då.
  Scenario: En komplett sändning nollställer inte mätningen
    När jag hämtar kvittot för bricka 123456
    Och MeOS skickar en komplett tävling med tävlings-id 1
    Så visar statistiken 1 visade kvitton för tävling 1

  Scenario: En tumme upp räknas
    När jag röstar "upp" för tävling 1
    Så visar statistiken 1 tummar upp och 0 tummar ner för tävling 1

  Scenario: En tumme ner räknas
    När jag röstar "ner" för tävling 1
    Så visar statistiken 0 tummar upp och 1 tummar ner för tävling 1

  Scenario: Rösten röjer inte vem som röstat
    När jag röstar "upp" för tävling 1
    Så innehåller statistiken inga löpar-id

  Scenario: En röst på en okänd tävling avvisas
    När jag röstar "upp" för tävling 999
    Så avvisas rösten

  Scenario: Ett ogiltigt svar avvisas
    När jag röstar "kanske" för tävling 1
    Så avvisas rösten

  # Kvittot ska se likadant ut på skärm, i utskrift och i PDF. Frågan är
  # tjänstens, inte en del av resultatet, och hör därför inte hemma i remsan.
  Scenario: Frågan följer inte med i PDF:en
    När jag laddar ner kvittot som PDF för bricka 123456
    Så PDF:en innehåller inte texten "värdefullt"
