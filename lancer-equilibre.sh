#!/bin/sh
# Outil d'équilibre (SPEC-POLITIQUE.md, module 8) : joue des séries de parties entre IA sur tous les cœurs du PC,
# puis ouvre le rapport (equilibre/rapport-<date>.html) dans le navigateur. Réglages : outils/equilibre.toml.
#   ./lancer-equilibre.sh             la série complète
#   ./lancer-equilibre.sh --rapide    un essai de deux ou trois minutes
cd "$(dirname "$0")" || exit 1
. ./scripts/binaires.sh
# un exécutable d'avant l'outil : bin/commit effacé, obtenir_binaires le retélécharge (ou le compile)
[ -x bin/equilibre ] || rm -f bin/commit
obtenir_binaires || exit 1
if [ ! -x bin/equilibre ]; then
  echo "[X] bin/equilibre manque : la version publiée est trop ancienne. Installer Rust (https://rustup.rs) puis relancer."
  exit 1
fi
# le navigateur seulement s'il y a un écran (pas en SSH)
ouvrir=
if [ -n "$DISPLAY$WAYLAND_DISPLAY" ] || [ "$(uname -s)" = Darwin ]; then ouvrir=--ouvrir; fi
bin/equilibre $ouvrir "$@" || { echo; echo "[X] L'outil d'équilibre a échoué. La raison est écrite au-dessus."; exit 1; }
echo
echo "Fini. Le fichier à envoyer à l'assistant est le resume-….json le plus récent du dossier equilibre."
