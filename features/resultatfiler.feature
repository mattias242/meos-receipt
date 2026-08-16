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

  # Sommarträning 13/8: sex kontrollenheter gick ~16 min fel. På Orange låg de
  # mitt i loppet, så tiderna var mindre än totaltiden och slank igenom – med
  # sträckor på 23 minuter och totaltider som hoppade baklänges som följd.
  Scenario: Motstridiga stämplingstider visas utan tider i stället för som sanning
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 777777
    Så visar kvittot status "Godkänd"
    Och innehåller kvittot stämplingarna "31, 87, 46, 45, 50, Mål"
    Och stämplingen "87" saknar tider
    Och stämplingen "46" saknar tider
    Och stämplingen "87" är markerad som opålitlig
    Och sträckan "45" har sträcktid "20:00", totaltid "25:00" och klocktid "10:25:00"
    Och kvittot förklarar att en kontrollenhets klocka visat fel

  # Extra stämplingar kommer inte från det pågående loppet – de ligger kvar i
  # pinnen sedan en tidigare aktivitet därför att löparen missat TÖM.
  Scenario: Extra stämplingar förklaras med ett tips om TÖM
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 123456
    Så stämplingen "77" är markerad som extra
    Och kvittot tipsar om att stämpla TÖM före start

  Scenario: Kvitto utan extra stämplingar tipsar inte om TÖM
    Givet att resultatautomaten har laddat upp en resultatfil
    När jag hämtar kvittot för bricka 111111
    Så tipsar kvittot inte om TÖM

  Scenario: Efteranmäld löpare i resultatfilen blir inte dubblett
    Givet att resultatautomaten har laddat upp en resultatfil
    När MeOS skickar en diff där "Frida Frisk" med bricka 333333 anmäls i klassen "D21"
    Så visar kvittot för bricka 333333 löparen "Frida Frisk"
    Och innehåller kvittot för bricka 333333 stämplingarna "31"

  # Delarna testas var för sig ovan. Det här scenariot kör dem i den ordning de
  # sker på tävlingsdagen – flera fel i projektet har uppstått först i
  # kombinationen, inte i något enskilt steg.
  Scenario: Ett helt tävlingsförlopp från startlista till fastställt resultat
    Givet att resultatautomaten har laddat upp en resultatfil
    Och att MeOS har skickat en diff där "Frida Frisk" med bricka 333333 anmäls i klassen "D21"
    När MeOS skickar en komplett tävling med tävlings-id 1
    Och resultatautomaten laddar upp en resultatfil
    Så visar kvittot för bricka 123456 löparen "Anna Andersson"
    Och innehåller kvittot för bricka 123456 stämplingarna "31, 32, 77, 45, 50, Mål"
    Och kvittot för bricka 222222 visar status "Utgått"
    Och kvittot för bricka 444444 visar status "Ej start"
    Och finns exakt 1 tävling i tävlingslistan

  Scenario: Radiotider visas som tidigare när ingen resultatfil finns
    När jag hämtar kvittot för bricka 123456
    Så innehåller kvittot sträckorna "Radio 1, Förvarning, Mål"
