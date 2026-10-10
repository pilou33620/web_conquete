@echo off
cd /d "%~dp0"
rem Ouvre le jeu aux autres appareils du reseau local (iPad, telephone).
where python >nul 2>nul && (python server.py --lan) || (py server.py --lan)
pause
