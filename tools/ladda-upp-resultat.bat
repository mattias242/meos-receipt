@echo off
rem ===========================================================================
rem  Ladda upp resultatfiler till kvittotjansten - ren Windows/DOS-applikation.
rem
rem  Bevakar resultatfilen som MeOS resultatautomat exporterar och laddar
rem  upp den till kvittotjansten (POST /iof) varje gang filen andras.
rem  Kraver endast curl.exe, som ar inbyggt i Windows 10 (1803+) och Windows 11.
rem
rem  Anvandning (fran kommandotolken, cmd.exe):
rem    ladda-upp-resultat.bat C:\meos\resultat.xml https://din-server.example 1 hemligt
rem
rem  Argument:
rem    1: sokvag till resultatfilen (IOF XML 3.0 med stracktider)
rem    2: tjanstens bas-URL
rem    3: tavlings-id      (valfritt, standard 1)
rem    4: losenord         (valfritt)
rem    5: intervall i sek  (valfritt, standard 10)
rem ===========================================================================
setlocal EnableDelayedExpansion

set "FIL=%~1"
set "URL=%~2"
set "CMP=%~3"
set "LOSEN=%~4"
set "INTERVALL=%~5"

rem Utan argument: las installningar fran ladda-upp-resultat.cfg bredvid
rem skriptet, sa att filen kan startas med dubbelklick.
if "%~2"=="" (
  if exist "%~dp0ladda-upp-resultat.cfg" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0ladda-upp-resultat.cfg") do set "%%A=%%B"
  )
)

if "%URL%"=="" (
  echo Anvandning: %~nx0 ^<resultatfil^> ^<url^> [tavlings-id] [losenord] [intervall-sek]
  echo Exempel:    %~nx0 C:\meos\resultat.xml https://din-server.example 1 hemligt
  echo.
  echo Alternativ: skapa %~dp0ladda-upp-resultat.cfg och dubbelklicka pa skriptet.
  pause
  exit /b 1
)

if "%CMP%"=="" set "CMP=1"
if "%INTERVALL%"=="" set "INTERVALL=10"

where curl >nul 2>&1
if errorlevel 1 (
  echo FEL: curl.exe hittades inte. Kraver Windows 10 1803 eller senare.
  exit /b 1
)

rem Andringsdetektorn nedan bygger pa filens tidsstampel, som i Windows bara
rem har minutupplosning, plus filstorleken. Andras t.ex. en stracktid fran
rem 1234 till 1235 inom samma minut ser filen oforandrad ut. Darfor laddas
rem filen upp pa nytt var TVINGA_EFTER:e varv aven utan synlig andring -
rem tjansten ar idempotent, sa en extra uppladdning kostar bara overforingen.
if "%TVINGA_EFTER%"=="" set "TVINGA_EFTER=30"

echo Bevakar %FIL%
echo Laddar upp till %URL%/iof (tavling %CMP%) var %INTERVALL%:e sekund vid andring.
echo Avbryt med Ctrl+C.
set "SENAST="
set /a CYKLER=0

:loop
if exist "%FIL%" (
  rem Tidsstampel + filstorlek som andringsdetektor
  for %%F in ("%FIL%") do set "TS=%%~tF_%%~zF"
  set "LADDA="
  if not "!TS!"=="!SENAST!" set "LADDA=1"
  if !CYKLER! GEQ %TVINGA_EFTER% set "LADDA=1"
  if defined LADDA (
    set "SVAR=INGET SVAR"
    for /f "delims=" %%S in ('curl -s -X POST -H "competition: %CMP%" -H "pwd: %LOSEN%" -H "Content-Type: application/xml; charset=utf-8" --data-binary @"%FIL%" "%URL%/iof"') do set "SVAR=%%S"
    echo !TIME:~0,8! !SVAR!
    rem Forst nar tjansten svarat OK ar filen verkligen uppladdad. Ett BADPWD
    rem eller ERROR ska ge nytt forsok, inte tystnad.
    if "!SVAR!"=="OK" (
      set "SENAST=!TS!"
      set /a CYKLER=0
    )
  )
) else (
  echo !TIME:~0,8! Vantar pa att %FIL% ska skapas...
)
set /a CYKLER+=1
timeout /t %INTERVALL% /nobreak >nul
goto loop
