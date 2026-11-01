# Plan : mercenaires, douane, familles et mariages (SPEC-MERCENAIRES.md, validée le 1er/11/2026)

Construit par trois agents en parallèle (une copie du dépôt et une branche chacun), fusionné ensuite.

- [ ] M1 (agent « mercenaires », branche `mercenaires`) : décisions 1 à 4 ; `UNIT_YEAR`/`UNIT_UNTIL` ; tests/test_mercenaires.py
- [ ] M2 (agent « douane », branche `douane`) : décisions 5 à 9 et la part Commerce de 15 ; tests/test_douane.py
- [ ] M3 (agent « familles », branche `familles`) : décisions 10 à 14 et la part Diplomatie de 15 ; tests/test_familles.py
- [ ] M4 : fusion, `python3 tests/lancer.py`, banc d'équilibre 1790 et 1700, README, revue, commit et push
