#!/bin/sh
# Même banc sur deux versions du code : un commit de référence et le code actuel, mêmes graines.
#   sh outils/banc_compare.sh <commit> [epoque] [graine] [parties] [annees]
# Résumé seulement : /tmp/banc-compare/resume.txt (le détail de chaque partie à côté).
REF=${1:?commit de référence}; E=${2:-1700}; G=${3:-1}; P=${4:-6}; A=${5:-30}
cd "$(dirname "$0")/.." || exit 1
D=/tmp/banc-compare; W=/tmp/wc-ref-$REF; mkdir -p $D
[ -d "$W" ] || git worktree add -q --detach "$W" "$REF" || exit 1
OPT="--parties $P --epoque $E --annees $A --graine $G --proc 2"
: > $D/resume.txt
for V in ref actuel; do
  [ $V = ref ] && DIR=$W || DIR=.
  (cd "$DIR" && python3 outils/simuler.py $OPT) > $D/$V.txt 2>&1
  { echo "== $V ($( [ $V = ref ] && echo "$REF" || git rev-parse --short HEAD)) $OPT"; grep -E '^moyenne|^graine|^ +[0-9]+ ' $D/$V.txt; echo; } >> $D/resume.txt
done
git worktree remove --force "$W"
echo "fini $(date)" >> $D/resume.txt
