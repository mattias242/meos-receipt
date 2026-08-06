# language: sv
# KRAV-15 (docs/KRAV.md)
Egenskap: Kvitto som PDF
  Som löpare
  vill jag kunna ladda ner mitt kvitto som PDF
  så att jag kan spara eller skriva ut sträcktidsutläsningen efteråt.

  Bakgrund:
    Givet att tjänsten är igång
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att resultatautomaten har laddat upp en resultatfil

  Scenario: Godkänt kvitto som PDF
    När jag laddar ner kvittot som PDF för bricka 123456
    Så får jag en PDF-fil
    Och filnamnet innehåller "Anna-Andersson"
    Och PDF:en innehåller texten "Anna Andersson"
    Och PDF:en innehåller texten "Godkänd"
    Och PDF:en innehåller texten "Testtävlingen"

  Scenario: Felstämplat kvitto visar saknad kontroll i PDF:en
    När jag laddar ner kvittot som PDF för bricka 111111
    Så får jag en PDF-fil
    Och PDF:en innehåller texten "Felstämplad"
    Och PDF:en innehåller texten "SAKNAS"

  Scenario: Extra stämplingar märks ut i PDF:en
    När jag laddar ner kvittot som PDF för bricka 123456
    Så får jag en PDF-fil
    Och PDF:en innehåller texten "EXTRA"

  Scenario: PDF för okänd bricka ger 404
    När jag laddar ner kvittot som PDF för bricka 999999
    Så blir PDF-svaret 404
