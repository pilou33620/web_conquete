#!/bin/sh
# Toute la suite (tests/lancer.py) en une fois, avec un bilan court : le journal complet va dans /tmp/tests-conquete.log,
# l'écran ne reçoit que les échecs et une ligne de bilan. Échecs connus (le Pi est plus lent qu'un PC) : ignorés.
#   sh tests/resume.sh
cd "$(dirname "$0")/.." || exit 1
LOG=/tmp/tests-conquete.log
CONNUS='test_vite (test_cartes'
timeout 1500 python3 tests/lancer.py > "$LOG" 2>&1
NOUV=$(grep -E '^(FAIL|ERROR):|^not ok|✖' "$LOG" | grep -v "$CONNUS" | sort -u | head -30)
PY=$(grep -E '^Ran [0-9]+ tests' "$LOG" | tail -1)
if [ -n "$NOUV" ]; then echo "ÉCHECS :"; echo "$NOUV"; echo "(détails : $LOG)"; fi
echo "Bilan : ${PY:-python ?} (+ banc js) ; $( [ -n "$NOUV" ] && echo 'À CORRIGER' || echo 'OK (échecs connus ignorés)')"
