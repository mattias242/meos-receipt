# language: sv
# KRAV-25 (docs/KRAV.md)
Egenskap: Tidsförlust per kontroll
  Som löpare i målfållan
  vill jag se var på banan jag tappade tid
  så att kvittot svarar på om en lång sträcka var en bom eller bara en lång sträcka.

  Måttet är MeOS egen bomanalys: löparens egen hastighetsnivå räknas bort mot
  klassens baslinje, så att den som är jämnt långsam inte får en bom på varje
  kontroll. Baslinjen i fixturen är 60, 120, 180, 90 och 60 sekunder.

  Bakgrund:
    Givet att tjänsten är igång
    Och att resultatautomaten har laddat upp en resultatfil för bomanalys

  Scenario: Kvittot visar tidsförlust på den kontroll där löparen bommade
    När jag hämtar kvittot i tävling 5 för bricka 900003
    Så visar sträckan för kontroll 45 tidsförlusten "2:37"
    Och visar kvittot den totala tidsförlusten "2:37"

  Scenario: Sträckor på klassens nivå ger ingen tidsförlust
    När jag hämtar kvittot i tävling 5 för bricka 900003
    Så visar sträckan för kontroll 31 ingen tidsförlust
    Och visar sträckan för kontroll 32 ingen tidsförlust
    Och visar sträckan för kontroll 50 ingen tidsförlust

  Scenario: En jämnt långsam löpare får inga tidsförluster
    När jag hämtar kvittot i tävling 5 för bricka 900004
    Så visar kvittot inga tidsförluster

  Scenario: En tidsförlust under tjugo sekunder rapporteras inte
    När jag hämtar kvittot i tävling 5 för bricka 900005
    Så visar kvittot inga tidsförluster

  Scenario: Gafflade sträckor jämförs bara med dem som sprungit samma sträcka
    När jag hämtar kvittot i tävling 5 för bricka 900006
    Så visar kvittot inga tidsförluster

  Scenario: Felstämplad löpare får tidsförlust på de sträckor hon har giltig tid på
    När jag hämtar kvittot i tävling 5 för bricka 900007
    Så visar sträckan för kontroll 32 tidsförlusten "3:03"

  Scenario: Sträckan över en saknad kontroll ger ingen tidsförlust
    När jag hämtar kvittot i tävling 5 för bricka 900007
    Så visar sträckan för kontroll 50 ingen tidsförlust

  Scenario: En kontroll med opålitlig tid får ingen tidsförlust
    När jag hämtar kvittot i tävling 5 för bricka 900009
    Så stämplingen "32" är markerad som opålitlig
    Och visar sträckan för kontroll 32 ingen tidsförlust

  Scenario: För få i klassen har gått i mål – kvittot säger det i stället för att gissa
    När jag hämtar kvittot i tävling 5 för bricka 900010
    Så säger kvittot att underlag saknas för bomanalys
    Och visar kvittot inga tidsförluster

  Scenario: Ett kvitto med bara radiotider får ingen bomanalys och ingen ursäkt
    Givet att MeOS har skickat en komplett tävling med tävlings-id 1
    När jag hämtar kvittot för bricka 123456
    Så visar kvittot inga tidsförluster
    Och nämner kvittot ingen bomanalys
