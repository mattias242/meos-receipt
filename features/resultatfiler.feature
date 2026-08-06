# language: sv
# KRAV-9, KRAV-10 (docs/KRAV.md)
Egenskap: Resultatfiler från MeOS resultatautomat
  Som tävlingsarrangör
  vill jag komplettera onlinedatat med resultatfiler (IOF XML 3.0 med sträcktider)
  så att kvittot visar alla stämplingar inklusive felstämplade och saknade kontroller,
  precis som papperskvittot.

  Bakgrund:
    Givet att tjänsten är igång
    Och att MeOS har skickat en komplett tävling med tävlings-id 1

  Scenario: En resultatfil tas emot
    När resultatautomaten laddar upp en resultatfil
    Så blir svaret "OK"

  Scenario: Resultatfil med fel lösenord avvisas
    Givet att tjänsten kräver lösenordet "hemligt"
    När resultatautomaten laddar upp en resultatfil med lösenordet "fel"
    Så blir svaret "BADPWD"

  Scenario: Kvittot visar alla stämplingar inklusive extra stämpling
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 123456
    Så innehåller kvittot stämplingarna "31, 32, 77, 45, 50, Mål"
    Och stämplingen "77" är markerad som extra
    Och sträckan "Mål" har sträcktid "5:00", totaltid "35:00" och klocktid "10:35:00"
    Och kvittot visar starttid "10:00:00" och måltid "10:35:00"

  Scenario: Felstämplad löpare ser vilken kontroll som saknas
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 111111
    Så visar kvittot status "Felstämplad"
    Och stämplingen "45" är markerad som saknad
    Och kvittot visar starttid "10:20:00" och måltid "10:50:00"

  Scenario: Löpare som bara finns i resultatfilen får ändå kvitto
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 333333
    Så visar kvittot löparen "Frida Frisk" i klubben "OK Skogen" och klassen "D21"

  Scenario: Den som brutit utan att stämpla får ingen tabell med bara streck
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 222222
    Så visar kvittot status "Utgått"
    Och kvittot innehåller inga stämplingar

  Scenario: Den som brutit efter några kontroller ser sina stämplingar
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 555555
    Så visar kvittot status "Utgått"
    Och innehåller kvittot stämplingarna "31, 32, 45"
    Och stämplingen "45" är markerad som saknad

  Scenario: En stämplingstid utanför loppet förstör inte sträcktiderna
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 666666
    Så visar kvittot status "Godkänd"
    Och innehåller kvittot stämplingarna "31, 32, 45, 50, Mål"
    Och stämplingen "32" saknar tider
    Och sträckan "45" har sträcktid "10:00", totaltid "15:00" och klocktid "10:15:00"

  Scenario: Efteranmäld löpare i resultatfilen blir inte dubblett
    Givet att resultatautomaten har laddat upp en resultatfil
    När MeOS skickar en diff där "Frida Frisk" med bricka 333333 anmäls i klassen "D21"
    Så visar kvittot för bricka 333333 löparen "Frida Frisk"
    Och innehåller kvittot för bricka 333333 stämplingarna "31"

  Scenario: Radiotider visas som tidigare när ingen resultatfil finns
    När jag hämtar kvittot för bricka 123456
    Så innehåller kvittot sträckorna "Radio 1, Förvarning, Mål"
