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

# 3. Når data faktiskt disken? Ett sparfel märks annars först vid omstarten,
#    när hela tävlingen är borta.
case "$halsa" in
  *'"sparfel"'*)
    fel "Tävlingsdata kan inte sparas till disk – allt ligger bara i minnet"
    printf '      %s\n' "$(printf '%s' "$halsa" | sed -n 's/.*"sparfel":"\([^"]*\)".*/\1/p')"
    ;;
  *'"persistens":false'*)
    varna "Ingen datakatalog (DATA_DIR) – data försvinner vid omstart"
    ;;
  *) ok "Tävlingsdata sparas till disk" ;;
esac

# 4. Är e-postutskick påslaget?
case "$halsa" in
  *'"email":true'*)  ok "E-postutskick konfigurerat" ;;
  *) varna "E-postutskick avstängt (MAILGUN_* saknas) – kvittot kan inte mejlas" ;;
esac

# 5. Står tjänsten bakom en proxy utan att veta om det? Skriptets egna anrop
#    går samma väg som löparnas, så tjänsten har redan sett det den behöver.
hopp=$(printf '%s' "$halsa" | sed -n 's/.*"proxyhopp":\([0-9]*\).*/\1/p')
case "$halsa" in
  *'"proxyvarning"'*)
    fel "Proxyinställningen stämmer inte med hur anropen kommer in"
    printf '      %s\n' "$(printf '%s' "$halsa" | sed -n 's/.*"proxyvarning":"\([^"]*\)".*/\1/p')"
    ;;
  *)
    if [ -n "$hopp" ]; then
      ok "Proxyinställningen stämmer ($hopp led i X-Forwarded-For)"
    else
      ok "Inställningen för proxy stämmer med hur anropen kommer in"
    fi
    ;;
esac

# 6. Kräver skrivändpunkterna lösenord? Tjänsten ligger öppen mot internet
#    (KRAV-13), och utan lösenord kan vem som helst som hittar adressen
#    ersätta hela tävlingen med en MOPComplete mitt under loppet.
#
#    Sonden skickar en zip-signatur (PK) med fel lösenord. Den avvisas med
#    NOZIP *efter* lösenordskontrollen, så svaret skiljer på skyddad och öppen
#    tjänst utan att någonting tolkas eller sparas.
svar=$(printf 'PK\003\004' | curl -sS -m 15 -X POST "$URL/meos" \
  -H 'content-type: application/xml' \
  -H 'competition: 1' \
  -H 'pwd: fel-losenord-fran-verifiera-drift' \
  --data-binary @- 2>/dev/null)
#    Svaret är MOPStatus-XML (KRAV-1) – plocka ut statuskoden ur det. Äldre
#    versioner svarade ren text, så båda formerna godtas här: sonden ska kunna
#    granska en tjänst som ännu inte driftsatts om.
kod=$(printf '%s' "$svar" | sed -n 's/.*<MOPStatus[^>]*status="\([^"]*\)".*/\1/p')
[ -n "$kod" ] || kod="$svar"
case "$kod" in
  BADPWD) ok "Skrivändpunkterna kräver lösenord" ;;
  NOZIP|OK)
    fel "Skrivändpunkterna saknar lösenord – vem som helst kan skicka in tävlingsdata"
    printf '      %s\n' "Sätt MEOS_PASSWORD på servern (samma som i MeOS Onlineresultat)."
    ;;
  *) varna "Oväntat svar från /meos: ${svar:0:40}" ;;
esac

# 7. Får kvitton cachas av mellanled? De innehåller personuppgifter, och ett
#    cachat svar visar dessutom en gammal status med en ålder som ser färsk ut.
cache=$(curl -sS -m 15 -o /dev/null -D - "$URL/api/health" 2>/dev/null |
  tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: *//p')
case "$cache" in
  *no-store*) ok "Kvitton får inte cachas av mellanled" ;;
  '')         fel "API:t skickar ingen Cache-Control – mellanled får spara kvitton fritt" ;;
  *)          varna "Cache-Control saknar no-store: $cache" ;;
esac

# 7b. Hur länge cachas kvittosidans egna filer? Servern säger max-age=0 med
#     ETag, men ett mellanled kan skriva över det: Cloudflares "Browser Cache
#     TTL" sätter fyra timmar om den inte står på Respect Existing Headers.
#     Filnamnen är oversionerade, så löparen kör då gammal app.js mot ett nytt
#     API efter en driftsättning – det syns inte inifrån tjänsten, bara här.
statcache=$(curl -sS -m 15 -o /dev/null -D - "$URL/app.js" 2>/dev/null |
  tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: *//p')
statalder=$(printf '%s' "$statcache" | sed -n 's/.*max-age=\([0-9]*\).*/\1/p')
if [ -z "$statcache" ]; then
  varna "Kvittosidans filer saknar Cache-Control – mellanled får gissa cachetid"
elif [ -z "$statalder" ]; then
  varna "Kvittosidans filer har ingen max-age: $statcache"
elif [ "$statalder" -le 60 ]; then
  ok "Kvittosidans filer cachas kort (${statalder}s)"
else
  fel "Kvittosidans filer cachas i ${statalder}s – gammal frontend mot nytt API efter deploy"
  printf '      %s\n' "Servern säger max-age=0; värdet sätts av ett mellanled."
  printf '      %s\n' "Cloudflare: sätt Browser Cache TTL till Respect Existing Headers"
  printf '      %s\n' "(zonen, eller en Cache Rule för just det här värdnamnet)."
fi

# 8. Går det att lista tävlingar?
tavlingar=$(hamta "$URL/api/competitions")
case "$tavlingar" in
  \[*) ok "Tävlingslistan går att hämta" ;;
  *)   fel "Tävlingslistan svarar oväntat: ${tavlingar:0:60}" ;;
esac

# 9. Kan en löpare hämta sitt kvitto? Kräver ett bricknummer som finns.
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
