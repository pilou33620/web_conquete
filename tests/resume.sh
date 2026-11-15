#!/bin/sh
# Toute la suite en une fois, avec un bilan court : le journal complet va dans /tmp/tests-conquete.log,
# l'écran ne reçoit que les échecs et une ligne de bilan.
#   sh tests/resume.sh
cd "$(dirname "$0")/.." || exit 1
LOG=/tmp/tests-conquete.log
{ cargo test -p conquete 2>&1; echo "== node"; node --test --test-reporter=dot tests/*.test.mjs 2>&1; } > "$LOG"
NOUV=$(grep -E '^test .* FAILED|^---- .* stdout ----|panicked at|^not ok|✖' "$LOG" | sort -u | head -30)
RS=$(grep -E '^test result:' "$LOG" | awk '{ok+=$4; ko+=$6} END {print ok " essais Rust réussis, " ko " échoués"}')
if [ -n "$NOUV" ]; then echo "ÉCHECS :"; echo "$NOUV"; echo "(détails : $LOG)"; fi
echo "Bilan : $RS (+ banc js) ; $( [ -n "$NOUV" ] && echo 'À CORRIGER' || echo 'OK')"
