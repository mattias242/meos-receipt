# language: sv
# KRAV-1, KRAV-2 (docs/KRAV.md)
Egenskap: Mottagning av MeOS onlineprotokoll (MOP)
  Som tävlingsarrangör
  vill jag att MeOS inbyggda Onlineresultat kan skicka data till tjänsten oförändrat
  så att inga anpassningar behövs i MeOS.

  Scenario: En komplett tävling tas emot
    Givet att tjänsten är igång
    När MeOS skickar en komplett tävling med tävlings-id 1
    Så blir svaret "OK"
    Och tävlingen "Testtävlingen" finns i tävlingslistan

  Scenario: Sändning utan tävlings-id avvisas
    Givet att tjänsten är igång
    När MeOS skickar en komplett tävling utan tävlings-id
    Så blir svaret "BADCMP"

  Scenario: Sändning med fel lösenord avvisas
    Givet att tjänsten kräver lösenordet "hemligt"
    När MeOS skickar en komplett tävling med lösenordet "fel"
    Så blir svaret "BADPWD"

  Scenario: Sändning med rätt lösenord tas emot
    Givet att tjänsten kräver lösenordet "hemligt"
    När MeOS skickar en komplett tävling med lösenordet "hemligt"
    Så blir svaret "OK"

  Scenario: Zip-komprimerad sändning får svaret NOZIP
    Givet att tjänsten är igång
    När MeOS skickar zip-komprimerad data
    Så blir svaret "NOZIP"

  # KRAV-1: MeOS XML-parsar svaret och letar efter elementet MOPStatus. Ren text
  # ger tom status, vilket får MeOS att avbryta sändningen efter första klumpen.
  Scenario: Svaret är MOPStatus-XML, inte ren text
    Givet att tjänsten är igång
    När MeOS skickar en komplett tävling med tävlings-id 1
    Så är svarskroppen exakt "<?xml version=\"1.0\"?><MOPStatus status=\"OK\"></MOPStatus>"
    Och har svaret innehållstypen "application/xml"

  Scenario: Även avvisade sändningar svarar med MOPStatus-XML
    Givet att tjänsten kräver lösenordet "hemligt"
    När MeOS skickar en komplett tävling med lösenordet "fel"
    Så är svarskroppen exakt "<?xml version=\"1.0\"?><MOPStatus status=\"BADPWD\"></MOPStatus>"

  # KRAV-1: MeOS styckar sändningen i klumpar om 64 objekt. Bara den första bär
  # MOPComplete – resten kommer som MOPDiff, och måste landa de också.
  # Metadatan ligger först, så det är löparna som faller bort: löpare 1 ryms i
  # den första klumpen, löpare 150 kommer först i den sista.
  Scenario: En tävling som spänner över flera sändningsklumpar tas emot i sin helhet
    Givet att tjänsten är igång
    När MeOS skickar en tävling med 150 löpare styckad i klumpar om 64 objekt
    Så blir svaret "OK"
    Och har löparen med bricka 500000 ett kvitto
    Och har löparen med bricka 500149 ett kvitto

  Scenario: MOPDiff uppdaterar en löpare utan att radera övriga
    Givet att tjänsten är igång
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    När MeOS skickar en diff där "Carl Carlsson" går i mål
    Så blir svaret "OK"
    Och kvittot för bricka 111111 visar status "Godkänd"
    Och kvittot för bricka 123456 visar status "Godkänd"

  Scenario: MOPComplete ersätter tidigare data för tävlingen
    Givet att tjänsten är igång
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    När MeOS skickar en komplett tävling med tävlings-id 1 och namnet "Omstartad tävling"
    Så finns exakt 1 tävling i tävlingslistan
    Och tävlingen "Omstartad tävling" finns i tävlingslistan

  Scenario: Stämplingar från resultatfilen överlever en omstart av Onlineresultat
    Givet att tjänsten är igång
    Och att MeOS har skickat en komplett tävling med tävlings-id 1
    Och att resultatautomaten har laddat upp en resultatfil
    När MeOS skickar en komplett tävling med tävlings-id 1
    Så innehåller kvittot för bricka 123456 stämplingarna "31, 32, 77, 45, 50, Mål"
