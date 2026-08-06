# language: sv
# KRAV-3, KRAV-4, KRAV-7 (docs/KRAV.md)
Egenskap: Digitalt kvitto via bricknummer
  Som löpare
  vill jag se min stämplingsutläsning i mobilen genom att ange mitt SportIdent-nummer
  så att jag inte behöver ett papperskvitto.

  Bakgrund:
    Givet att tjänsten är igång
    Och att MeOS har skickat en komplett tävling med tävlings-id 1

  Scenario: Kvitto för en godkänd löpare
    När jag hämtar kvittot för bricka 123456
    Så visar kvittot löparen "Anna Andersson" i klubben "OK Skogen" och klassen "H21"
    Och kvittot visar status "Godkänd"
    Och kvittot visar löptiden "35:00"
    Och kvittot visar starttid "10:00:00" och måltid "10:35:00"
    Och kvittot visar placering 2 med tiden "+2:30" efter segraren

  Scenario: Kvittot innehåller sträcktider för radiokontroller och mål
    När jag hämtar kvittot för bricka 123456
    Så innehåller kvittot sträckorna "Radio 1, Förvarning, Mål"
    Och sträckan "Radio 1" har sträcktid "15:00", totaltid "15:00" och klocktid "10:15:00"
    Och sträckan "Mål" har sträcktid "5:00", totaltid "35:00" och klocktid "10:35:00"

  Scenario: Löpare som startat men inte gått i mål
    När jag hämtar kvittot för bricka 111111
    Så visar kvittot status "Ute på banan"
    Och kvittot visar ingen löptid

  Scenario: Löpare som utgått behåller sin starttid
    När jag hämtar kvittot för bricka 222222
    Så visar kvittot status "Utgått"
    Och kvittot visar starttid "10:00:00" och måltid ""

  Scenario: Löpare som inte kommit till start visas utan starttid
    När jag hämtar kvittot för bricka 444444
    Så visar kvittot status "Ej start"
    Och kvittot visar ingen starttid
    Och kvittot visar ingen löptid

  Scenario: Preliminärt resultat markeras och får preliminär placering
    Givet att MeOS har skickat en diff där "Carl Carlsson" går i mål
    När jag hämtar kvittot för bricka 111111
    Så visar kvittot status "Godkänd"
    Och kvittot är markerat som preliminärt
    Och kvittot visar preliminär placering 1

  Scenario: Okänd bricka ger ett begripligt fel
    När jag hämtar kvittot för bricka 999999
    Så blir svaret 404 med ett felmeddelande

  # KRAV-7
  Scenario: Delad bricka ger en valbar träfflista
    Givet att MeOS har skickat en diff där "Erik Ek" med bricka 123456 anmäls i klassen "D21"
    När jag hämtar kvittot för bricka 123456
    Så blir svaret en träfflista med 2 löpare
    Och träfflistan innehåller "Anna Andersson" och "Erik Ek"
