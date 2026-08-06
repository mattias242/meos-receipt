#!/usr/bin/env bash
# Bevakar resultatfilen som MeOS resultatautomat exporterar och laddar upp
# den till kvittotjänsten varje gång filen ändras.
#
#   ./ladda-upp-resultat.sh <fil> <url> [tävlings-id] [lösenord] [intervall-sek]
set -u
FIL=${1:?Ange resultatfil}
URL=${2:?Ange tjänstens bas-URL}
CMP=${3:-1}
LOSEN=${4:-}
INTERVALL=${5:-10}

senast=""
echo "Bevakar $FIL – laddar upp till $URL/iof (tävling $CMP)"
while true; do
  ts=$(stat -c %Y "$FIL" 2>/dev/null || stat -f %m "$FIL" 2>/dev/null || true)
  if [ -n "$ts" ] && [ "$ts" != "$senast" ]; then
    svar=$(curl -sS -X POST -H "competition: $CMP" -H "pwd: $LOSEN" \
      -H 'Content-Type: application/xml; charset=utf-8' \
      --data-binary @"$FIL" "$URL/iof") \
      && { echo "$(date '+%H:%M:%S') $svar"; senast=$ts; } \
      || echo "$(date '+%H:%M:%S') uppladdning misslyckades" >&2
  fi
  sleep "$INTERVALL"
done
