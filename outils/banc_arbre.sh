#!/bin/sh
# Bancs d'équilibre du chantier SPEC-ARBRE (A7), en arrière-plan : seul le résumé compte.
#   nohup sh outils/banc_arbre.sh [court] &      puis lire /tmp/banc-arbre/resume.txt (écrit à la fin de chaque banc)
#   court : sans le banc long (1700 à 1890, environ une heure de plus)
cd "$(dirname "$0")/.." || exit 1
D=/tmp/banc-arbre; mkdir -p $D
run() {  # nom, options
  python3 outils/simuler.py $2 --proc 2 > $D/$1.txt 2>&1
  { echo "== $1 ($2)"; grep -E '^moyenne|trouvée' $D/$1.txt; echo; } >> $D/resume.txt
}
: > $D/resume.txt
run 1790 "--parties 6 --epoque 1790 --annees 30 --graine 1"
run 1700 "--parties 6 --epoque 1700 --annees 30 --graine 1"
[ "$1" = court ] || run 1700-long "--parties 2 --epoque 1700 --annees 190 --graine 1"
echo "fini $(date)" >> $D/resume.txt
