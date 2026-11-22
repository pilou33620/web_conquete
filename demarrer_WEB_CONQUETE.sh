#!/bin/sh
# Lancement de Conquête (Linux, macOS, Raspberry Pi) : garde le terminal ouvert en cas d'erreur.
#   ./demarrer_WEB_CONQUETE.sh [--port 8790] [--lan | --local | --host ADRESSE] [--no-browser | --browser] [--no-update]
cd "$(dirname "$0")" || exit 1
# Un seul fichier a cliquer : les lanceurs Windows (.cmd, .bat) sont masques du gestionnaire de fichiers.
ls *.cmd *.bat > .hidden 2>/dev/null
. ./scripts/binaires.sh
# Le jeu sort avec le code 75 quand il vient de se mettre a jour (git pull, ou archive de
# production) : on reprend l'executable de la nouvelle version, puis on le relance.
export CONQUETE_RELANCEUR=1
while :; do
  obtenir_binaires && bin/conquete "$@"
  code=$?
  [ "$code" -eq 75 ] || break
done
if [ "$code" -ne 0 ]; then
  echo
  echo "[X] Le demarrage a echoue. La raison est ecrite au-dessus."
  # dans un terminal seulement : sous systemd ou web_launcher, personne pour appuyer sur Entree
  if [ -t 0 ]; then echo; printf "Appuyez sur Entree pour fermer..."; read -r _; fi
fi
exit "$code"
