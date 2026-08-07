# language: sv
# KRAV-16 (docs/KRAV.md)
Egenskap: Kvitto via e-post
  Som löpare
  vill jag kunna få kvittot mejlat till mig som PDF
  så att jag har kvar sträcktiderna utan att behöva spara filen i mobilen.

  Bakgrund:
    Givet att tjänsten är igång med e-postutskick
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att resultatautomaten har laddat upp en resultatfil

  Scenario: Kvittot mejlas som PDF-bilaga
    När jag mejlar kvittot för bricka 123456 till "loparen@example.org"
    Så blir mejlsvaret 200
    Och skickas ett mejl till "loparen@example.org"
    Och mejlet har en PDF-bilaga
    Och mejlets ämne innehåller "Anna Andersson"

  # KRAV-16: sammanfattningen är det som syns i förhandsvisningen på
  # låsskärmen, så den får inte läsa som ett fastställt resultat
  Scenario: Ett preliminärt resultat märks ut i mejlet
    Givet att MeOS har skickat en diff där "Carl Carlsson" går i mål
    När jag mejlar kvittot för bricka 111111 till "loparen@example.org"
    Så blir mejlsvaret 200
    Och innehåller mejlets text "Preliminärt resultat"
    Och innehåller mejlets text "Prel. placering"

  Scenario: Ett fastställt resultat mejlas utan förbehåll
    När jag mejlar kvittot för bricka 123456 till "loparen@example.org"
    Så blir mejlsvaret 200
    Och innehåller mejlets text inte "Preliminärt"

  Scenario: Ogiltig adress avvisas utan utskick
    När jag mejlar kvittot för bricka 123456 till "inte-en-adress"
    Så blir mejlsvaret 400
    Och skickas inga mejl

  Scenario: Okänd bricka ger 404 utan utskick
    När jag mejlar kvittot för bricka 999999 till "loparen@example.org"
    Så blir mejlsvaret 404
    Och skickas inga mejl

  Scenario: Endpointen kan inte användas för massutskick
    När jag mejlar kvittot för bricka 123456 till 6 olika adresser
    Så blir minst ett av svaren 429
    Och skickas färre än 6 mejl

  Scenario: Utan konfigurerad e-post är funktionen avstängd
    Givet att tjänsten är igång utan e-postutskick
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    När jag mejlar kvittot för bricka 123456 till "loparen@example.org"
    Så blir mejlsvaret 503

  Scenario: Fel hos e-postleverantören läcker inte ut
    Givet att tjänsten är igång med e-postutskick som misslyckas
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    När jag mejlar kvittot för bricka 123456 till "loparen@example.org"
    Så blir mejlsvaret 502
    Och innehåller felmeddelandet inte "SMTP"
