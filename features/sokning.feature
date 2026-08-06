# language: sv
# KRAV-5, KRAV-6 (docs/KRAV.md)
Egenskap: Sökning på namn och bricka
  Som löpare
  vill jag kunna söka på mitt namn om jag inte minns mitt bricknummer
  så att jag ändå hittar mitt kvitto.

  Bakgrund:
    Givet att tjänsten är igång
    Och att MeOS har skickat en komplett tävling med tävlings-id 1

  Scenario: Sökning på namn är skiftlägesokänslig
    När jag söker på "anna"
    Så får jag 1 träff
    Och träffen visar "Anna Andersson" i klubben "OK Skogen" och klassen "H21" med bricka 123456

  Scenario: Sökning utan träff
    När jag söker på "Zebror"
    Så får jag 0 träffar

  # KRAV-6
  Scenario: Bricka som bara finns i en äldre tävling hittas ändå
    Givet att MeOS har skickat en komplett tävling med tävlings-id 2, namnet "Nyare tävlingen" och datumet "2026-09-01" utan löpare
    När jag hämtar kvittot för bricka 123456
    Så visar kvittot löparen "Anna Andersson" i klubben "OK Skogen" och klassen "H21"
    Och kvittot gäller tävlingen "Testtävlingen"

  # KRAV-6
  Scenario: Namnsökning träffar även äldre tävlingar
    Givet att MeOS har skickat en komplett tävling med tävlings-id 2, namnet "Nyare tävlingen" och datumet "2026-09-01" utan löpare
    När jag söker på "anna"
    Så får jag 1 träff
