#!/bin/bash
# Peka om ett värdnamn till en ny tävling (KRAV-20).
#
# Körs på servern, i projektkatalogen. Bindningen bor i .env och inte i repot,
# eftersom deployen packar upp över arbetskatalogen och skriver över allt som
# ligger där (deploy/DRIFTSATTNING.md).
#
#   ./tools/byt-tavling.sh <tävlings-id> [värdnamn]
#   ./tools/byt-tavling.sh 26091401
#   ./tools/byt-tavling.sh 26091401 kvitto.klubben.se
#   ./tools/byt-tavling.sh --utan-omstart 26091401     # ändra .env, rör inte containern
#
# Skriptet skriver om den befintliga raden i stället för att lägga till en ny.
# Två VARDNAMN_TAVLINGAR-rader ser riktiga ut men gör att den ena tyst vinner,
# och det märks först när löparen ser fel tävling.

set -euo pipefail

ENV_FIL="${ENV_FIL:-.env}"
OMSTART=1

if [ "${1:-}" = "--utan-omstart" ]; then
  OMSTART=0
  shift
fi

CID="${1:-}"
VARDNAMN="${2:-}"

anvandning() {
  cat >&2 <<'EOF'
Användning: ./tools/byt-tavling.sh [--utan-omstart] <tävlings-id> [värdnamn]

  <tävlings-id>  samma heltal som i MeOS Onlineresultat, t.ex. 26091401
  [värdnamn]     krävs bara om flera värdnamn är bundna

Exempel:
  ./tools/byt-tavling.sh 26091401
  ./tools/byt-tavling.sh 26091401 kvitto.klubben.se
EOF
  exit 1
}

[ -n "$CID" ] || anvandning

# Id:t hamnar i /t/<id>, som bara släpper igenom siffror (KRAV-18). Ett id med
# bokstäver hade gett en vidareskickning till en adress som svarar 404.
if ! printf '%s' "$CID" | grep -qE '^[0-9]+$'; then
  echo "Fel: \"$CID\" är inget giltigt tävlings-id – det ska vara bara siffror." >&2
  exit 1
fi

if [ ! -f "$ENV_FIL" ]; then
  echo "Fel: hittar ingen $ENV_FIL." >&2
  echo "Kör skriptet från projektkatalogen, eller peka ut filen med ENV_FIL=..." >&2
  echo "(En ny .env skapas medvetet inte: utan MEOS_PASSWORD vägrar tjänsten starta.)" >&2
  exit 1
fi

NUVARANDE="$(grep -m1 '^VARDNAMN_TAVLINGAR=' "$ENV_FIL" | cut -d= -f2- || true)"

# Utan värdnamn i anropet går det bara att gissa om det finns exakt ett.
if [ -z "$VARDNAMN" ]; then
  ANTAL="$(printf '%s' "$NUVARANDE" | tr ',' '\n' | grep -c '=' || true)"
  if [ "$ANTAL" = "1" ]; then
    VARDNAMN="$(printf '%s' "$NUVARANDE" | cut -d= -f1)"
  elif [ "$ANTAL" = "0" ]; then
    echo "Fel: ingen bindning finns ännu – ange värdnamnet." >&2
    anvandning
  else
    echo "Fel: $ANTAL värdnamn är bundna – ange vilket som ska peka om." >&2
    printf '%s\n' "$NUVARANDE" | tr ',' '\n' | sed 's/^/  /' >&2
    exit 1
  fi
fi

# Bygg om listan: det utpekade värdnamnet får sitt nya id, övriga står kvar
# oförändrade och i samma ordning.
NY="$(
  VARDNAMN="$VARDNAMN" CID="$CID" awk -v RS=',' -v ORS=',' '
    BEGIN { hittad = 0 }
    {
      post = $0
      gsub(/^[ \t]+|[ \t\n]+$/, "", post)
      if (post == "") next
      split(post, delar, "=")
      if (tolower(delar[1]) == tolower(ENVIRON["VARDNAMN"])) {
        printf "%s=%s,", delar[1], ENVIRON["CID"]
        hittad = 1
      } else {
        printf "%s,", post
      }
    }
    END { if (!hittad) printf "%s=%s,", ENVIRON["VARDNAMN"], ENVIRON["CID"] }
  ' <<< "$NUVARANDE" | sed 's/,$//'
)"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if grep -q '^VARDNAMN_TAVLINGAR=' "$ENV_FIL"; then
  # Raden skrivs om på plats. awk och inte sed: värdnamn innehåller punkter och
  # id:t kan i teorin innehålla tecken sed hade tolkat.
  NY="$NY" awk '
    /^VARDNAMN_TAVLINGAR=/ && !gjord { print "VARDNAMN_TAVLINGAR=" ENVIRON["NY"]; gjord = 1; next }
    /^VARDNAMN_TAVLINGAR=/ { next }   # en eventuell dubblett städas bort
    { print }
  ' "$ENV_FIL" > "$TMP"
else
  cp "$ENV_FIL" "$TMP"
  printf '\n# Klubbens egen adress (KRAV-20). Peka om inför varje arrangemang.\n' >> "$TMP"
  printf 'VARDNAMN_TAVLINGAR=%s\n' "$NY" >> "$TMP"
fi

cat "$TMP" > "$ENV_FIL"

echo "$VARDNAMN är nu bundet till tävling $CID"
[ -n "$NUVARANDE" ] && echo "  förut: $NUVARANDE"
echo "  nu:    $NY"

if [ "$OMSTART" = "0" ]; then
  echo
  echo "Containern är inte omstartad (--utan-omstart). Ändringen slår igenom först då."
  exit 0
fi

# --- Starta om och kontrollera ------------------------------------------------

DOCKER="${DOCKER:-}"
if [ -z "$DOCKER" ]; then
  if [ -x /var/packages/ContainerManager/target/usr/bin/docker ]; then
    DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
  else
    DOCKER=docker
  fi
fi

echo
echo "Startar om containern …"
"$DOCKER" compose up -d

# Kontrollera mot containern direkt, inte via Cloudflare: det här ska säga
# om bindningen togs, inte om DNS och cache hunnit med.
PORT="$(grep -m1 '^HOST_PORT=' "$ENV_FIL" | cut -d= -f2- || true)"
PORT="${PORT:-3000}"

echo "Kontrollerar http://127.0.0.1:$PORT med Host: $VARDNAMN …"
for i in 1 2 3 4 5 6 7 8 9 10; do
  SVAR="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' \
    -H "Host: $VARDNAMN" "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  case "$SVAR" in
    "302 "*"/t/$CID") echo "  OK: / skickas vidare till /t/$CID"; exit 0 ;;
  esac
  sleep 1
done

echo "  Fel: fick \"$SVAR\", väntade 302 mot /t/$CID" >&2
echo "  Kontrollera loggen: $DOCKER logs --tail 30 meos-kvitto" >&2
exit 1
