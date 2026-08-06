# language: sv
# KRAV-8 (docs/KRAV.md)
Egenskap: Tävlingsdata överlever omstart
  Som tävlingsarrangör
  vill jag att inläst tävlingsdata finns kvar efter en omstart av tjänsten
  så att löpare kan se sina kvitton även om servern startas om under tävlingen.

  Scenario: Kvittot finns kvar efter omstart
    Givet att tjänsten är igång med datalagring
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att all data har sparats till disk
    När tjänsten startas om med samma datalagring
    Så visar kvittot för bricka 123456 löparen "Anna Andersson"
