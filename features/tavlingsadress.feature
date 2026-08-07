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
