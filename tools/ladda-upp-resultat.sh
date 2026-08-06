#!/usr/bin/env bash
# Bevakar resultatfilen som MeOS resultatautomat exporterar och laddar upp
# den till kvittotjänsten varje gång filen ändras.
#
#   ./ladda-upp-resultat.sh <fil> <url> [tävlings-id] [lösenord] [intervall-sek]
#
# Speglar logiken i ladda-upp-resultat.bat, som är den som körs på
# tävlingsdatorn (KRAV-11). Ändringar här bör göras i båda.
set -u
FIL=${1:?Ange resultatfil}
URL=${2:?Ange tjänstens bas-URL}
CMP=${3:-1}
LOSEN=${4:-}
INTERVALL=${5:-10}

# Ändringsdetektorn bygger på filens tidsstämpel och kan missa en ändring som
# sker inom samma sekund (på Windows samma minut). Ladda därför upp på nytt
# med jämna mellanrum även när filen ser oförändrad ut – tjänsten är
# idempotent, så en extra uppladdning kostar bara överföringen.
TVINGA_EFTER=${TVINGA_EFTER:-30}

senast=""
cykler=0
echo "Bevakar $FIL – laddar upp till $URL/iof (tävling $CMP)"
while true; do
  ts=$(stat -c %Y "$FIL" 2>/dev/null || stat -f %m "$FIL" 2>/dev/null || true)
  if [ -z "$ts" ]; then
    echo "$(date '+%H:%M:%S') väntar på att $FIL ska skapas..."
  elif [ "$ts" != "$senast" ] || [ "$cykler" -ge "$TVINGA_EFTER" ]; then
    if svar=$(curl -sS -X POST -H "competition: $CMP" -H "pwd: $LOSEN" \
      -H 'Content-Type: application/xml; charset=utf-8' \
      --data-binary @"$FIL" "$URL/iof"); then
      echo "$(date '+%H:%M:%S') $svar"
      # Först när tjänsten svarat OK är filen verkligen uppladdad. Ett
      # BADPWD eller ERROR ska ge nytt försök, inte tystnad.
      if [ "$svar" = "OK" ]; then
        senast=$ts
        cykler=0
      fi
    else
      echo "$(date '+%H:%M:%S') uppladdning misslyckades" >&2
    fi
  fi
  cykler=$((cykler + 1))
  sleep "$INTERVALL"
done
