@echo off
rem Outil d'equilibre (SPEC-POLITIQUE.md, module 8), a double-cliquer : joue des series de parties entre IA
rem sur tous les coeurs du PC, puis ouvre le rapport (equilibre\rapport-<date>.html) dans le navigateur.
rem Reglages : outils\equilibre.toml. Essai court : lancer-equilibre.cmd --rapide
chcp 65001 >nul
cd /d "%~dp0"
rem Un executable d'avant l'outil : bin\commit efface, binaires.cmd le retelecharge (ou le compile).
if not exist bin\equilibre.exe if exist bin\commit del bin\commit
call scripts\binaires.cmd
if errorlevel 1 goto echec
if not exist bin\equilibre.exe (
  echo [X] bin\equilibre.exe manque : la version publiee est trop ancienne. Installer Rust ^(https://rustup.rs^) puis relancer.
  goto echec
)
bin\equilibre.exe --ouvrir %*
if errorlevel 1 goto echec
echo.
echo Fini. Le rapport s'ouvre dans le navigateur ; le fichier a envoyer a l'assistant
echo est le resume-....json du dossier equilibre (le plus recent).
echo.
pause
exit /b 0
:echec
echo.
echo [X] L'outil d'equilibre a echoue. La raison est ecrite au-dessus.
echo.
pause
exit /b 1
