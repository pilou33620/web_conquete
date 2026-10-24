# Équilibre de la campagne : avant et après les nouvelles technologies (18/10/2026)

Banc : `outils/simuler.py` (T51). Campagnes jouées par les IA seules, le camp du joueur (Gironde) compris, graines
1 à 6, 30 ans.
- **Avant** : le code d'avant le chantier (commit `c583e31`).
- **Après** : la phase 0 (commit `9d61a8e`, T61), donc avant les corrections de la revue. Celles-ci ne touchent que des
  détails : les blessés des garnisons, les prisonniers, les retranchements après une charge, la mélinite des
  mitrailleuses.

Commande : `python3 outils/simuler.py --parties 6 --epoque 1790 --annees 30 --graine 1 --proc 2` (de même pour 1700).
Il faut environ 40 min par époque sur le Raspberry Pi.

## 1790 à 1820 (les nouvelles technologies apparaissent dès 1794)

| Moyenne des 6 parties | Avant | Après | Écart |
|---|---|---|---|
| Guerres déclarées | 8,8 | 8,2 | −7 % |
| Durée moyenne d'une guerre (mois) | 3,3 | 3,6 | +9 % |
| Écart de places entre le premier et le dernier camp | 90,3 | 85,8 | −5 % |
| Camps encore en vie | 3,8 | 3,7 | −3 % |
| Technologies par camp | 44,9 | 46,5 | +4 % |
| Trésor moyen (livres) | 61 317 | 60 500 | −1 % |
| Hommes sous les armes par camp | 10 656 | 10 379 | −3 % |

Toutes les mesures restent dans ±25 % de la référence : **le point 0 est franchi.**

## 1700 à 1730

Les résultats sont identiques avant et après, et c'est attendu : aucune des nouvelles technologies n'existe avant 1794.
Guerres 8,3, durée 4,2 mois, écart 96, camps en vie 3,5, technologies 12,3.

## À savoir pour lire ces chiffres

- **« Le tour des IA ne finit pas »** dans les tableaux bruts (`/tmp/eq-*.txt`) voulait dire que le camp du joueur,
  joué par une IA, avait été rayé de la carte, ce qui finit la partie. Le banc le note maintenant « fin » (commit
  `33afa76`). La plupart des parties s'arrêtent ainsi entre 1796 et 1820 (1710 à 1727 depuis 1700) : la Gironde jouée
  par l'IA tombe souvent la première. Les mesures portent donc sur des durées un peu différentes d'une partie à
  l'autre, mais ce sont les mêmes graines avant et après.
- Une petite différence de règle change toute la suite d'une partie (le hasard part ailleurs) : il faut lire les
  moyennes, pas les parties une à une.
- Une vieille sauvegarde (faite avec le code d'avant, juin 1790) se charge avec le nouveau code et se joue un an sans
  erreur.

# Phase 2a : avant et après le train (19/10/2026)

- **Avant** : le code d'avant les voies ferrées (commit `eeabfe5`, avant T69).
- **Après** : le train joué par les IA (commit `c6136ee`, T74), donc avant les corrections de la revue de 2a.

Commande : `python3 outils/simuler.py --parties 6 --epoque 1870 --annees 25 --graine 1 --proc 2` (de même pour 1813
sur 40 ans). Une partie lancée en 1790 n'atteint jamais 1841, l'année des voies ferrées : les bancs partent donc de
1813 et de 1870.

## 1870 à 1895

| Moyenne des 6 parties | Avant | Après | Écart |
|---|---|---|---|
| Guerres déclarées | 8,8 | 8,5 | −3 % |
| Durée moyenne d'une guerre (mois) | 3,1 | 3,8 | +23 % |
| Écart de places entre le premier et le dernier camp | 81,7 | 77,2 | −6 % |
| Camps encore en vie | 4,0 | 4,0 | 0 % |
| Technologies par camp | 92,3 | 92,5 | 0 % |
| Trésor moyen (livres) | 440 379 | 528 650 | +20 % |
| Hommes sous les armes par camp | 18 402 | 19 319 | +5 % |
| Tronçons de voie ferrée construits | 0 | 40,5 | |

## 1813 à 1853

| Moyenne des 6 parties | Avant | Après | Écart |
|---|---|---|---|
| Guerres déclarées | 11,0 | 12,5 | +14 % |
| Durée moyenne d'une guerre (mois) | 3,9 | 3,8 | −3 % |
| Écart de places entre le premier et le dernier camp | 114,8 | 105,2 | −8 % |
| Camps encore en vie | 3,3 | 3,5 | +6 % |
| Technologies par camp | 68,1 | 68,5 | +1 % |
| Trésor moyen (livres) | 423 816 | 394 146 | −7 % |
| Hommes sous les armes par camp | 15 443 | 16 083 | +4 % |
| Tronçons de voie ferrée construits | 0 | 36,8 | |

Toutes les mesures restent dans ±25 % et chaque partie construit des lignes (de 27 à 49 tronçons) : **le point 2a-1
est franchi.** Deux mesures sont proches de la limite :
- la durée des guerres de 1870 (+23 %) ;
- le trésor de 1870 (+20 %).

Elles restent à surveiller. Leur cause n'a pas été cherchée : ce peut être le bonus des villes reliées, le train, ou
le hasard, car six parties suffisent à faire bouger une moyenne de 20 %.

Aucune partie n'a planté. La partie 1 de 1813 s'arrête le 22 mai 1853 parce qu'il ne reste plus qu'un camp.

## Arbre des technologies (SPEC-ARBRE, A7, 24/10/2026)

Référence refaite le 24/10 sur le code d'avant le chantier (commit `98d9911`) : celle du 18/10 date d'avant le train.
6 parties, 30 ans, graines 1 à 6. « Arbre » : commit `869df5e` (recherche libre, IA qui fonce encore sur les armes).

| Moyenne | 1790 avant | 1790 arbre | 1700 avant | 1700 arbre |
|---|---|---|---|---|
| Guerres déclarées | 14,0 | 15,2 (+9 %) | 12,5 | 17,0 (+36 %) |
| Durée d'une guerre (mois) | 3,8 | 3,6 | 3,9 | 3,9 |
| Écart de places | 97,8 | 87,5 | 97,2 | 95,8 |
| Camps en vie | 3,5 | 3,7 | 3,5 | 3,3 |
| Technologies par camp | 54,0 | 47,6 | 16,2 | 23,1 (+43 %) |
| Trésor (livres) | 76 288 | 75 433 | 45 248 | 38 367 |
| Hommes par camp | 14 028 | 12 717 | 10 130 | 11 912 |

Grandes armes trouvées par les IA (commit `869df5e`) : depuis 1700, la percussion vers 1720 (18 camps sur 30), alors
que l'histoire la place en 1840. Banc long (2 parties, 1700 à 1890) : percussion vers 1725, Chassepot vers 1801.
Choix du 24/10 : **l'IA suit l'ordre historique** (elle ne lance une recherche que pour la finir vers sa date, à
5 ans près ; `ai.AI_AHEAD`), le joueur reste libre de foncer. Cette correction n'est pas encore mesurée : lancer
`sh outils/banc_arbre.sh court` (environ 70 min sur le Pi), puis lire `/tmp/banc-arbre/resume.txt`.

### Après la correction de l'IA (commit `defbf0d` et suivants, 24/10/2026)

6 parties, 30 ans. Graines 1 à 6 (`outils/banc_arbre.sh court`) et, depuis 1700, graines 7 à 12 en plus
(`outils/banc_compare.sh 98d9911 1700 7`), parce qu'une partie compte de 8 à 22 guerres : 6 parties ne suffisent pas.

| Moyenne | 1790 avant | 1790 après | 1700 avant (12 parties) | 1700 après (12 parties) |
|---|---|---|---|---|
| Guerres déclarées | 14,0 | 13,2 (−6 %) | 14,9 | 16,8 (+12 %) |
| Durée d'une guerre (mois) | 3,8 | 3,6 | 3,7 | 3,9 |
| Écart de places | 97,8 | 82,2 (−16 %) | 102,5 | 110,4 (+8 %) |
| Camps en vie | 3,5 | 3,8 | 3,4 | 3,0 (−12 %) |
| Technologies par camp | 54,0 | 47,8 (−11 %) | 16,4 | 16,5 |
| Trésor (livres) | 76 288 | 72 787 | 35 497 | 45 599 (+28 %) |
| Hommes par camp | 14 028 | 14 017 | 10 199 | 10 141 |

Grandes armes : aucune IA ne les trouve avant leur époque (depuis 1700, ni Gribeauval ni la percussion avant 1730 ;
depuis 1790, ni la percussion ni les canons rayés avant 1820). Tout est dans ±25 %, sauf le trésor depuis 1700
(+28 %) : les recherches durent des années, les IA lancent moins souvent une recherche payée d'avance.
