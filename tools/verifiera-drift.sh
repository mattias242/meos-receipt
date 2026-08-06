#!/usr/bin/env bash
# Kontrollerar att en driftsatt kvittotjänst fungerar – kör den dagen före
# tävlingen (KRAV-13).
#
#   ./verifiera-drift.sh https://din-server.example [bricknummer]
#
# Flera fel i den här tjänsten visar sig som tystnad snarare än felmeddelanden:
# att programmen är igång betyder inte att data kommer fram. Skriptet svarar på
# frågan "kan en löpare hämta sitt kvitto just nu?".
#
# Kräver bara curl. Avslutar med 0 om allt ser bra ut, annars 1.
set -u
URL=${1:?Ange tjänstens bas-URL, t.ex. https://din-server.example}
BRICKA=${2:-}
URL=${URL%/}

gron=0
varn=0
brist=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; gron=$((gron + 1)); }
varna(){ printf '  \033[33m!\033[0m %s\n' "$1"; varn=$((varn + 1)); }
fel()  { printf '  \033[31m✗\033[0m %s\n' "$1"; brist=$((brist + 1)); }

hamta() { curl -sS -m 15 "$@" 2>/dev/null; }

echo "Kontrollerar $URL"
echo

# 1. Svarar tjänsten?
halsa=$(hamta "$URL/api/health")
if [ -z "$halsa" ]; then
  fel "Tjänsten svarar inte på $URL/api/health"
  echo
  echo "Kontrollera att den är igång och att adressen stämmer."
  exit 1
fi
ok "Tjänsten svarar"

# 2. Finns inläst tävlingsdata?
antal=$(printf '%s' "$halsa" | tr ',' '\n' | sed -n 's/.*"competitions":\([0-9]*\).*/\1/p')
if [ "${antal:-0}" -gt 0 ] 2>/dev/null; then
  ok "Tävlingsdata inläst ($antal tävling(ar))"
else
  fel "Ingen tävling inläst – MeOS Onlineresultat har inte skickat något hit"
fi

# 3. Är e-postutskick påslaget?
case "$halsa" in
  *'"email":true'*)  ok "E-postutskick konfigurerat" ;;
  *) varna "E-postutskick avstängt (MAILGUN_* saknas) – kvittot kan inte mejlas" ;;
esac

# 4. Går det att lista tävlingar?
tavlingar=$(hamta "$URL/api/competitions")
case "$tavlingar" in
  \[*) ok "Tävlingslistan går att hämta" ;;
  *)   fel "Tävlingslistan svarar oväntat: ${tavlingar:0:60}" ;;
esac

# 5. Kan en löpare hämta sitt kvitto? Kräver ett bricknummer som finns.
if [ -n "$BRICKA" ]; then
  kvitto=$(hamta "$URL/api/receipt?card=$BRICKA")
  case "$kvitto" in
    *'"runner"'*)
      # Ta namnet ur runner-objektet. Kvittot innehåller fler "name"-fält
      # (varje stämpling har ett), och en girig sed skulle fånga det sista.
      namn=$(printf '%s' "$kvitto" | sed -n 's/.*"runner":{[^}]*"name":"\([^"]*\)".*/\1/p')
      ok "Kvitto för bricka $BRICKA: $namn"
      strackor=$(printf '%s' "$kvitto" | grep -o '"control"' | wc -l | tr -d ' ')
      if [ "$strackor" -gt 0 ]; then
        ok "Kvittot innehåller $strackor stämpling(ar)"
      else
        varna "Kvittot saknar stämplingar – har resultatfilen laddats upp?"
      fi
      pdf=$(curl -sS -m 15 -o /dev/null -w '%{content_type}' "$URL/api/receipt.pdf?card=$BRICKA" 2>/dev/null)
      case "$pdf" in
        application/pdf) ok "PDF-nedladdning fungerar" ;;
        *) fel "PDF svarar med $pdf i stället för application/pdf" ;;
      esac
      ;;
    *) fel "Hittade ingen löpare med bricka $BRICKA" ;;
  esac
else
  varna "Inget bricknummer angivet – kör med ett för att prova hela kedjan:"
  printf '      %s %s 123456\n' "$0" "$URL"
fi

echo
printf '%s godkända, %s varningar, %s fel\n' "$gron" "$varn" "$brist"
[ "$brist" -eq 0 ] || exit 1
