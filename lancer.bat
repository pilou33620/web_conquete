@echo off
cd /d "%~dp0"
rem Le jeu sort avec le code 75 quand il vient de se mettre a jour (git pull) : on reprend l'executable, puis on relance.
set CONQUETE_RELANCEUR=1
:boucle
call binaires.cmd || goto fin
bin\conquete.exe %*
if %errorlevel%==75 goto boucle
:fin
pause
