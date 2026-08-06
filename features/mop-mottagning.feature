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
