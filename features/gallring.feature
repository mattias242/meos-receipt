# language: sv
# KRAV-14 (docs/KRAV.md)
Egenskap: Gallring av gammal tävlingsdata
  Som arrangör och personuppgiftsansvarig
  vill jag att tävlingsdata rensas automatiskt när den blivit 90 dagar gammal
  så att deltagarnas namn, klubbar och bricknummer inte ligger kvar i onödan
  på en tjänst som är öppen mot internet.

  Scenario: Tävlingsdata som passerat 90 dagar gallras
    Givet att tjänsten är igång med datalagring
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att all data har sparats till disk
    När tjänsten startas om 91 dagar senare
    Så finns exakt 0 tävlingar i tävlingslistan

  Scenario: Tävlingsdata inom 90 dagar behålls
    Givet att tjänsten är igång med datalagring
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att all data har sparats till disk
    När tjänsten startas om 89 dagar senare
    Så finns exakt 1 tävling i tävlingslistan
    Och visar kvittot för bricka 123456 löparen "Anna Andersson"

  Scenario: Gallringen kan stängas av
    Givet att tjänsten är igång med datalagring utan gallring
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att all data har sparats till disk
    När tjänsten startas om 400 dagar senare
    Så finns exakt 1 tävling i tävlingslistan

  Scenario: Gallringen slår igenom på den sparade filen
    Givet att tjänsten är igång med datalagring
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att all data har sparats till disk
    När tjänsten startas om 91 dagar senare
    Och tjänsten startas om utan tidsförskjutning
    Så finns exakt 0 tävlingar i tävlingslistan
