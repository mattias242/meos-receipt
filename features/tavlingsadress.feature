# language: sv
# KRAV-18 (docs/KRAV.md)
Egenskap: En adress per tävling
  Som arrangör
  vill jag kunna trycka en adress till just min tävling i PM
  så att löparna kommer direkt till rätt tävling utan att välja i en lista.

  Bakgrund:
    Givet att tjänsten är igång

  # Adressen trycks i PM veckor i förväg, alltså innan MeOS skickat något
  Scenario: Adressen fungerar innan tävlingen börjat
    När jag öppnar tävlingens adress för tävling 4
    Så får jag kvittosidan

  Scenario: Adressen fungerar när tävlingen är inläst
    Givet att MeOS har skickat en komplett tävling med tävlings-id 4
    När jag öppnar tävlingens adress för tävling 4
    Så får jag kvittosidan

  # Sidan ligger på /t/4 men laddar styles.css, app.js och api/-anropen
  # relativt. Utan <base> löses de mot /t/ och ger 404 – sidan blir tom, och
  # servern svarar 200 på själva HTML:en så ingenting ser fel ut.
  Scenario: Sidans resurser går att hämta från tävlingens adress
    Givet att MeOS har skickat en komplett tävling med tävlings-id 4
    När jag öppnar tävlingens adress för tävling 4
    Så går sidans resurser att hämta från den adressen

  Scenario: Något som inte är ett tävlings-id är inte en tävlingsadress
    När jag öppnar tävlingens adress för "../hemligt"
    Så blir svaret 404

  # KRAV-20: klubbens egen adress i stället för tjänstens domän med ett id i.
  # Bindningen sätts av arrangören i driften, inte av MeOS.
  Scenario: Ett bundet värdnamn skickar vidare till tävlingens adress
    Givet att värdnamnet "kvitto.klubben.se" är bundet till tävling 4
    När jag hämtar "/" med värdnamnet "kvitto.klubben.se"
    Så skickas jag vidare till "/t/4"

  Scenario: Bindningen gäller även när tävlingen är inläst
    Givet att värdnamnet "kvitto.klubben.se" är bundet till tävling 4
    Och att MeOS har skickat en komplett tävling med tävlings-id 4
    När jag hämtar "/" med värdnamnet "kvitto.klubben.se"
    Så skickas jag vidare till "/t/4"

  # Bindningen pekas om inför varje arrangemang. En 301 ligger kvar i löparnas
  # webbläsare och skulle visa förra tävlingens kvitton nästa gång.
  Scenario: Vidareskickningen är tillfällig, inte permanent
    Givet att värdnamnet "kvitto.klubben.se" är bundet till tävling 4
    När jag hämtar "/" med värdnamnet "kvitto.klubben.se"
    Så blir svaret 302

  # Annars försvinner den tryckta adressen ur adressfältet vid första klicket,
  # och delade kvittolänkar pekar tillbaka på tjänstens egen domän.
  Scenario: Löparen blir kvar på klubbens värdnamn
    Givet att värdnamnet "kvitto.klubben.se" är bundet till tävling 4
    När jag hämtar "/" med värdnamnet "kvitto.klubben.se"
    Så är adressen jag skickas vidare till relativ

  Scenario: Ett obundet värdnamn får förstasidan som vanligt
    Givet att värdnamnet "kvitto.klubben.se" är bundet till tävling 4
    När jag hämtar "/" med värdnamnet "nagon.annan.se"
    Så får jag kvittosidan

  Scenario: Värdnamnet jämförs oavsett versaler och portnummer
    Givet att värdnamnet "kvitto.klubben.se" är bundet till tävling 4
    När jag hämtar "/" med värdnamnet "Kvitto.Klubben.SE:8443"
    Så skickas jag vidare till "/t/4"

  # Tävlingens egen adress (KRAV-18) gäller alla värdnamn, även ett bundet:
  # bindningen är en genväg från förstasidan, inte en låsning av tjänsten.
  Scenario: Tävlingens egen adress påverkas inte av bindningen
    Givet att värdnamnet "kvitto.klubben.se" är bundet till tävling 4
    När jag hämtar "/t/9" med värdnamnet "kvitto.klubben.se"
    Så får jag kvittosidan
