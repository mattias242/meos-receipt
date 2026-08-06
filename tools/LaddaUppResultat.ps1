# Bevakar resultatfilen som MeOS resultatautomat exporterar och laddar upp
# den till kvittotjänsten varje gång filen ändras.
#
# Körs på MeOS-datorn (Windows):
#   .\LaddaUppResultat.ps1 -Fil C:\meos\resultat.xml -Url https://din-server.example -Tavling 1 -Losenord hemligt
param(
  [Parameter(Mandatory = $true)][string]$Fil,
  [Parameter(Mandatory = $true)][string]$Url,
  [int]$Tavling = 1,
  [string]$Losenord = '',
  [int]$IntervallSekunder = 10
)

$senast = $null
Write-Host "Bevakar $Fil – laddar upp till $Url/iof (tävling $Tavling)"
while ($true) {
  if (Test-Path $Fil) {
    $ts = (Get-Item $Fil).LastWriteTimeUtc
    if ($ts -ne $senast) {
      try {
        $headers = @{ competition = "$Tavling"; pwd = $Losenord }
        $svar = Invoke-RestMethod -Method Post -Uri "$Url/iof" -Headers $headers `
          -InFile $Fil -ContentType 'application/xml; charset=utf-8'
        Write-Host "$(Get-Date -Format HH:mm:ss) $svar"
        $senast = $ts
      }
      catch {
        Write-Warning "Uppladdning misslyckades: $_"
      }
    }
  }
  Start-Sleep -Seconds $IntervallSekunder
}
