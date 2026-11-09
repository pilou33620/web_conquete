# Plan : mercenaires, douane, familles et mariages (SPEC-MERCENAIRES.md, validée le 1er/11/2026)

Construit par trois agents en parallèle (une copie du dépôt et une branche chacun), fusionné ensuite.

- [x] M1 (agent « mercenaires ») : décisions 1 à 4 ; `UNIT_YEAR`/`UNIT_UNTIL`/`UNIT_GAP` ; tests/test_mercenaires.py
- [x] M2 (agent « douane ») : décisions 5 à 9 et la part Commerce de 15 ; tests/test_douane.py
- [x] M3 (agent « familles ») : décisions 10 à 14 et la part Diplomatie de 15 ; tests/test_familles.py
- [x] M4 : fusion, tests, banc d'équilibre 1790 et 1700, README, revue, commit — **fini le 9/11/2026** (branche `equilibre-1700`, à fusionner)

## Où on s'est arrêté (1er/11/2026, à la demande du joueur)

**Sur `main`, en local, non poussé** : les trois branches fusionnées sans conflit (commits `797e1b8`, `ef6c0b6`,
`261ccea`, fusions jusqu'à `3a6ee22`). Suite complète sur la fusion : 367 tests, seuls les trois `test_vite` du Pi
échouent (comme avant).

**Non commité** (dans l'arbre de travail) :
- README (régiments étrangers, douane, familles) ;
- `events.py` : le journal ne met plus en minuscules que l'initiale du choix (« maison Garat ») ;
- revue faite ; sa correction : pas de mariage avant 16 ans (`rules.MARIAGE_AGE`, `familles.epoux`, test ajouté) ;
- **premier réglage d'équilibre, pas encore mesuré** : `MERC_MAX` 3 → 2 ; l'IA ne loue de régiments étrangers que si
  son trésor dépasse 6 fois sa réserve (au lieu de 3) ; tarif des IA plafonné à « élevé » (2) ; `DOUANE_REL` 0,5 → 0,25.
  Trois tests codent encore les anciens chiffres et échouent : `test_mercenaires.IA.test_loue_en_guerre_sans_recrues`,
  `test_mercenaires.Levee.test_trois_au_plus`, `test_douane.IA.test_marchand_bas_pauvre_en_guerre_haut`.

**Banc d'équilibre** (6 parties, 30 ans, graines 1 à 6) :

| | écart de places | camps en vie | guerres | trésor | hommes | mois de banqueroute |
|---|---|---|---|---|---|---|
| 1790 avant (après les généraux) | 74,8 | 3,8 | 13,8 | 31 344 | 14 369 | 0 |
| 1790 après (fusion, sans réglage) | 84,5 (+13 %) | 3,8 | 15,8 | 33 674 | 13 862 | 0 |
| 1700 avant (`cc2c6aa`) | 80,7 | 3,8 | 22,3 | 17 781 | 11 280 | 31 |
| 1700 après (fusion, sans réglage) | **142,2 (+76 %)** | **2,3** | 17,3 | 37 340 | 8 462 | 61 |
| 1700 sans régiments étrangers | 117,5 | 2,8 | 18,3 | 25 850 | 9 687 | 10 |
| 1700 sans douane chez les IA | 122,0 | 3,0 | 13,3 | 39 632 | 10 830 | 0 |

1790 tient dans les tolérances ; 1700 non (un camp écrase les autres). Les régiments étrangers (disponibles pendant
toute une partie de 1700, presque pas en 1790) et la douane des IA y contribuent chacun ; il reste environ +45 % sans
l'un ou l'autre : les familles (mariages, vassalités par succession) sont soupçonnées, à mesurer.

## Fin de M4 (9/11/2026, branche `equilibre-1700`)

Mesures complètes dans `tasks/equilibre-reference.md` (« Mercenaires, douane, familles : équilibre de 1700 et de
1790 »). En bref :
- le premier réglage (`bb5477f`) mesuré : 1700 sur 12 parties, écart 111,9, trésor 27 751 ; les familles n'y sont pour
  rien (sans elles : 125,8), les régiments étrangers non plus (presque jamais loués) ; même tout coupé, l'écart reste
  vers 115 ;
- **six parties ne suffisent pas** : le code de référence, avec un seul tirage au hasard de plus, passe de 87,8 à
  114,3 d'écart sur 12 parties. On compare donc sur 12 parties (1700) et 24 (1790) ;
- réglages retenus (décisions du 9/11, le joueur ayant laissé faire) : douane des IA libre en paix même en déficit
  (modérée en guerre, élevée en guerre et en déficit) ; mariages des IA 0,3 % au lieu de 0,5 % ; `MARIAGE_REL` 10 ;
  guerre de succession 15 % + 30 % × agressivité. Écarté : des régiments étrangers dès 4 réserves en guerre ;
- final, 1700 (12 parties) : écart +15 %, camps en vie −10 %, guerres −10 %, trésor +14 %, hommes −6 % ; 1790
  (24 parties) : tout dans ±11 % sauf l'écart de places, +26 %, qui vient de la religion et des révoltes (sans elles :
  +7 %).

Reste : la fusion de `equilibre-1700` dans la branche principale ; la mise à jour du graphe (`graphify update .`) ;
l'écart de 1790 est à suivre par le chantier religion et révoltes.

## Ce qui restait à faire (1er/11/2026, fait le 9/11)

1. Mesurer le premier réglage à 1700 : `python3 outils/simuler.py --parties 6 --epoque 1700 --annees 30 --graine 1 --proc 2`
   (environ 40 min ; sur une copie figée, `git worktree add`, si l'on continue à coder pendant ce temps). En
   parallèle, la même chose sans familles (`familles.annuel` qui rend tout de suite, mariages des IA à 0 %) pour
   mesurer leur part.
2. Selon le résultat, un second réglage (mariages des IA plus rares, `MARIAGE_REL` plus bas, prétendant étranger plus
   rare…), jusqu'à revenir dans ±25 % à 1700 et 1790.
3. Mettre les trois tests aux chiffres retenus ; `python3 tests/lancer.py`.
4. Noter les mesures dans `tasks/equilibre-reference.md` ; commit, mise à jour du graphe (`graphify update .`), push.
