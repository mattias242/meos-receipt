# Bevakar resultatfilen som MeOS resultatautomat exporterar och laddar upp
# den till kvittotjänsten varje gång filen ändras.
#
# Körs på MeOS-datorn (Windows):
#   .\LaddaUppResultat.ps1 -Fil C:\meos\resultat.xml -Url https://din-server.example -Tavling 1 -Losenord hemligt
#
# Speglar ladda-upp-resultat.bat och .sh (KRAV-11). Ändras uppladdningen ska
# alla tre följas åt; .sh är den som testas i test/uppladdning.test.js.
param(
  [Parameter(Mandatory = $true)][string]$Fil,
  [Parameter(Mandatory = $true)][string]$Url,
  [int]$Tavling = 1,
  [string]$Losenord = '',
  [int]$IntervallSekunder = 10,
  # Ändringsdetektorn bygger på filens tidsstämpel och kan missa en ändring.
  # Ladda därför upp på nytt med jämna mellanrum – tjänsten är idempotent.
  [int]$TvingaEfter = 30
)

$senast = $null
$cykler = 0
Write-Host "Bevakar $Fil – laddar upp till $Url/iof (tävling $Tavling)"
while ($true) {
  if (Test-Path $Fil) {
    $ts = (Get-Item $Fil).LastWriteTimeUtc
    if ($ts -ne $senast -or $cykler -ge $TvingaEfter) {
      try {
        $headers = @{ competition = "$Tavling"; pwd = $Losenord }
        $svar = Invoke-RestMethod -Method Post -Uri "$Url/iof" -Headers $headers `
          -InFile $Fil -ContentType 'application/xml; charset=utf-8'
        Write-Host "$(Get-Date -Format HH:mm:ss) $svar"
        # Först när tjänsten svarat OK är filen verkligen uppladdad. Ett BADPWD
        # eller ERROR kommer som ett vanligt svar, inte som ett undantag – utan
        # den här kontrollen tystnar uppladdningen efter första felet.
        if ("$svar".Trim() -eq 'OK') {
          $senast = $ts
          $cykler = 0
        }
      }
      catch {
        Write-Warning "Uppladdning misslyckades: $_"
      }
    }
  }
  else {
    Write-Host "$(Get-Date -Format HH:mm:ss) Väntar på att $Fil ska skapas..."
  }
  $cykler++
  Start-Sleep -Seconds $IntervallSekunder
}
