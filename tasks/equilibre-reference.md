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

## Généraux qui évoluent (SPEC-GENERAUX.md, 31/10/2026)

1790, 30 ans, graines 1 à 6 ; « avant » : `fe1c2f4` ; « après » : grades jusqu'à maréchal (bonus de grade arrêté au
général de division), talents, médailles, blessures, morts et captures. Un premier « après » avec +20 % au maréchal
donnait un écart de places de 99,7 (+48 %) : réglé.

| Moyenne des 6 parties | Avant | Après | Écart |
|---|---|---|---|
| Guerres | 15,7 | 13,8 | −12 % |
| Durée d'une guerre (mois) | 4,4 | 4,2 | −5 % |
| Écart de places entre le premier et le dernier camp | 67,5 | 74,8 | +11 % |
| Camps en vie | 4,2 | 3,8 | −10 % |
| Technologies | 47,8 | 47,3 | −1 % |
| Trésor moyen (livres) | 24 312 | 31 344 | +29 % (de 8 000 à 46 000 selon la partie) |
| Hommes | 14 568 | 14 369 | −1 % |
| Mois de banqueroute / de famine | 6 / 4 | 0 / 0 | |

## Religion, révoltes et guérilla (SPEC-RELIGION.md, 8/11/2026)

12 parties par époque (graines 1 à 12, en deux bancs de 6), 30 ans, géographie 2. « Avec » : commit `bcd46f8` ;
« sans » : le même code avec l'interrupteur `CONQUETE_SANS_RELIGION=1` (il redonne exactement les parties du commit de
départ `f2a7433` : vérifié à 1790, graines 1 à 6).

    python3 outils/simuler.py --parties 6 --epoque 1790 --annees 30 --graine 1 --proc 2   # puis --graine 7
    CONQUETE_SANS_RELIGION=1 python3 outils/simuler.py …                                 # « sans »

| Moyenne des 12 parties | 1790 sans | 1790 avec | 1700 sans | 1700 avec |
|---|---|---|---|---|
| Guerres déclarées | 16,4 | 15,5 (−5 %) | 16,7 | 16,0 (−4 %) |
| Durée d'une guerre (mois) | 3,9 | 3,3 (−14 %) | 3,6 | 3,6 (−1 %) |
| Écart de places | 84,9 | 104,3 (+23 %) | 111,9 | 112,2 (0 %) |
| Camps en vie | 3,8 | 3,7 (−3 %) | 3,0 | 2,9 (−3 %) |
| Technologies par camp | 47,4 | 46,8 (−1 %) | 16,4 | 15,7 (−4 %) |
| Trésor (livres) | 40 040 | 33 516 (−16 %) | 27 751 | 25 045 (−10 %) |
| Hommes par camp | 12 972 | 12 816 (−1 %) | 10 305 | 10 212 (−1 %) |
| Mois de banqueroute / de famine (tous camps) | 0 / 10 | 2 / 0 | 9 / 38 | 91 / 43 |

Tout est dans ±25 %. À lire avec prudence : sur les graines 1 à 6 seules, l'écart de places de 1790 passait de 70,5 à
124,3 (+76 %), sur les graines 7 à 12 de 99,2 à 84,2 (−15 %) : une petite différence de règle fait partir chaque
partie ailleurs, et trois expériences sur les graines 3 et 5 (sans les événements du chantier, sans l'effet des
politiques, sans naissance de bandes) donnaient chacune d'autres vainqueurs sans désigner de coupable. Un premier
« avec » (`bcb105a`) laissait une armée de l'IA bloquée en chasse d'une bande passée chez un autre camp : corrigé
(`bcd46f8`, 45 jours de chasse au plus) avant les mesures ci-dessus. Les dépenses directes du chantier sont faibles
(1700, graine 5, 20 ans : 180 livres pillées, 150 d'apaisement, 1 200 de partisans levés pour tous les camps).

À surveiller : l'écart de places de 1790 (+23 %) et les mois de banqueroute depuis 1700 (91 contre 9 sur 21 600
mois-camps, soit 0,4 %). Aucune partie n'a planté ; aucune révolte n'a rayé de camp (jamais de chef-lieu).

## Mercenaires, douane, familles : équilibre de 1700 et de 1790 (SPEC-MERCENAIRES.md, M4, 9/11/2026)

Branche `equilibre-1700`. Référence : le code d'avant le chantier (`cc2c6aa`), remesuré sur la même machine (ses
graines 1 à 6 redonnent exactement les chiffres connus : écart 80,7 depuis 1700, 74,8 depuis 1790). « Final » : la
branche principale `4833ef3` (religion et révoltes comprises) fusionnée avec les réglages ci-dessous (`1a29eaa`).

    python3 outils/simuler.py --parties 12 --epoque 1700 --annees 30 --graine 1 --proc 4
    python3 outils/simuler.py --parties 12 --epoque 1790 --annees 30 --graine 1 --proc 4    # puis --graine 13
    CONQUETE_SANS_RELIGION=1 python3 outils/simuler.py …                                    # « final sans religion »

### Six parties ne suffisent pas

Le code de référence lui-même, avec un seul tirage au hasard de plus dans la diplomatie des IA (aucune règle changée),
donne depuis 1700 un écart de places de **114,3** sur 12 parties, contre 87,8 sans ce tirage : une partie va de 25 à
176 places d'écart selon le vainqueur. L'écart de 80,7 des graines 1 à 6 était un tirage bas (les bancs précédents
de 1700 donnaient 96 à 110). Les comparaisons ci-dessous portent donc sur 12 parties depuis 1700 et 24 depuis 1790 ;
les mois de banqueroute (de 9 à 123 sur 12 parties selon le seul hasard) ne se comparent pas.

### Ce que pèse chaque nouveauté (1700, avant réglage, graines 1 à 6 puis 1 à 12)

| Variante (code de `f2a7433`, premier réglage `bb5477f`) | écart | camps en vie | guerres | trésor | hommes |
|---|---|---|---|---|---|
| tel quel (12 parties) | 111,9 | 3,0 | 16,7 | 27 751 | 10 305 |
| sans familles (naissances, morts, mariages des IA) | 125,8 | 3,0 | 19,8 | 26 040 | 10 180 |
| sans régiments étrangers, douane des IA ni familles | 117,8 | 3,3 | 14,8 | 27 990 | 11 174 |
| … ni traits des chefs (12 parties) | 114,8 | 3,3 | 17,9 | 24 267 | 10 071 |
| tel quel, sans les traits des chefs | 100,5 | 3,2 | 15,7 | 25 613 | 10 002 |

Conclusions : les familles ne sont pas en cause (le soupçon du 1er/11) ; les régiments étrangers non plus (une partie
de 30 ans n'en voit presque aucun loué : l'IA n'en prend que sans recrues et très riche) ; même tout coupé, l'écart
reste vers 115 et le trésor vers 24 000, donc le reste de l'écart de 6 parties était du hasard. Le trésor plus haut
que la référence (+30 %) vient en partie des traits des chefs et en partie d'une dérive non élucidée du code postérieur
à `cc2c6aa`, qui subsiste tout coupé (ni la mise à jour des revenus par quart de journée ni le cache des frontières de
la France : remis comme avant, rien ne change). Ce qui reste propre au chantier : la **douane des IA**. Une partie de 1700 (graine 3) passait 86 % des mois-camps sous tarif, parce qu'un camp « pauvre » (revenu net
sous 15 % du brut) le montait même en paix, et les IA de 1700 dépensent tout.

### Réglages retenus (en plus de `bb5477f` : `MERC_MAX` 2, régiments étrangers au-delà de 6 réserves, prétendant rare, pas de mariage avant 16 ans, `DOUANE_REL` 0,25)

- Douane des IA : **libre en paix**, même en déficit ; en guerre, modéré, élevé si de plus en déficit (un marchand
  s'en tient à modéré). Le joueur garde tous ses tarifs.
- Mariages proposés par les IA : 0,3 % par voisin et par réflexion (au lieu de 0,5 %) ; `MARIAGE_REL` 15 → 10.
- Guerre de succession d'un prétendant éconduit : 15 % + 30 % × agressivité (au lieu de 30 % + 40 %).
- Essayé et écarté : les IA louant des régiments étrangers dès 4 réserves en guerre, recrues ou non (écart 121,5 depuis
  1700 : l'argent du plus riche devient des vétérans).

### Mesures finales

| 1700, 12 parties | Référence `cc2c6aa` | `bb5477f` seul (sans religion) | `6ecc5f2` fusionné (tarif en déficit encore) | Final | Écart du final |
|---|---|---|---|---|---|
| Guerres déclarées | 18,9 | 16,7 | 15,2 | 17,0 | −10 % |
| Durée d'une guerre (mois) | 4,3 | 3,6 | 3,2 | 3,4 | −21 % |
| Écart de places | 87,8 | 111,9 | 113,5 | 101,0 | +15 % |
| Camps en vie | 3,65 | 3,0 | 2,9 | 3,3 | −10 % |
| Trésor (livres) | 18 515 | 27 751 | 24 595 | 21 123 | +14 % |
| Hommes par camp | 11 134 | 10 305 | 10 076 | 10 499 | −6 % |
| Mois de banqueroute (tous camps) | 69 | 9 | 46 | 26 | (hasard) |

Sur les seules graines 1 à 6, le final donne : guerres 18,7 (−16 % contre 22,3), écart 88,5 (+10 % contre 80,7), camps
en vie 3,8 (0 %), trésor 18 000 (+1 %), hommes 10 804 (−4 %). Tout est dans ±25 %, à 6 comme à 12 parties.

| 1790, 24 parties | Référence `cc2c6aa` | Final | Écart | Final sans religion | Écart |
|---|---|---|---|---|---|
| Guerres déclarées | 13,8 | 13,9 | 0 % | 14,4 | +4 % |
| Durée d'une guerre (mois) | 3,8 | 3,4 | −11 % | 4,1 | +6 % |
| Écart de places | 85,6 | 107,7 | **+26 %** | 92,0 | +7 % |
| Camps en vie | 3,7 | 3,35 | −9 % | 3,6 | −3 % |
| Trésor (livres) | 38 328 | 39 826 | +4 % | 42 959 | +12 % |
| Hommes par camp | 13 665 | 12 163 | −11 % | 13 379 | −2 % |
| Mois de banqueroute (tous camps) | 23 | 0 | (hasard) | 19 | (hasard) |

Depuis 1790, les trois nouveautés réglées restent dans ±12 % de la référence. L'écart de places du code complet
(+26 %, juste au-delà de la tolérance) vient de la religion et des révoltes : leur propre banc le chiffrait à +23 % (voir
plus haut) ; il est à surveiller par ce chantier-là. Sur les seules graines 1 à 6 de 1790, l'écart du final est de
122,3 contre 74,8 : six parties n'en disent rien (graines 7 à 12 : 111,8 contre 89,0). Aucune partie n'a planté.

## Guerres décisives et armées actives (SPEC-FRANCE.md, 9/11/2026)

« Avant » : `27d9b16` ; « après » : `fd82254`, identique pour le Sud-Ouest au code final `854dbd2` (les règles propres
à toute la France, plus de cinq camps, n'y changent rien : trêve de deux à cinq ans, deuxième défaite face à n'importe
quel vainqueur). Les graines 1 à 24 de
1790 « avant » redonnent exactement le « final » de la section précédente.

    python3 outils/simuler.py --parties 12 --epoque 1700 --annees 30 --graine 1 --proc 3
    python3 outils/simuler.py --parties 12 --epoque 1790 --annees 30 --graine 1 --proc 3    # puis --graine 13

| Moyenne | 1700 avant (12) | 1700 après (12) | 1790 avant (24) | 1790 après (24) |
|---|---|---|---|---|
| Guerres déclarées | 17,0 | 12,9 (−24 %) | 13,85 | 12,2 (−12 %) |
| Durée d'une guerre (mois) | 3,4 | 2,8 (−18 %) | 3,4 | 2,3 (**−32 %**) |
| Écart de places | 101,0 | 114,9 (+14 %) | 107,7 | 129,6 (+20 %) |
| Camps en vie | 3,3 | 3,2 (−3 %) | 3,35 | 2,95 (−12 %) |
| Technologies par camp | 15,6 | 15,3 | 46,6 | 45,4 |
| Trésor (livres) | 21 123 | 21 361 (+1 %) | 39 826 | 37 644 (−5 %) |
| Hommes par camp | 10 499 | 10 966 (+4 %) | 12 163 | 11 541 (−5 %) |
| Mois de banqueroute / de famine | 26 / 33 | 47 / 30 | 0 / 3 | 23 / 10 |

Tout est dans ±25 %, sauf la durée des guerres de 1790 (−32 %) : c'est l'effet voulu, des armées qui frappent au lieu
de se regarder font tomber les chefs-lieux plus tôt, et la guerre finit au traité. Aucune partie ne finit avec un seul
camp (au moins deux en vie, comme avant ; le plus grand écart d'une partie est de 184 places, contre 176 avant). Sur les seules graines 1 à 12 de 1790, le trésor baissait de 39 % (47 606 → 29 007) ; les graines
13 à 24 le font monter de 44 % (32 046 → 46 280) : c'est le hasard de quelques parties très riches (de 10 000 à
107 000 livres), il faut les 24 parties.

Armées au repos (`outils/banc_guerres.py --geo 2 --epoque 1700 --mois 120`, graines 1 à 4 : part de la puissance des
armées des camps en guerre restée au repos après une réflexion de son IA) : 65 / 59 / 51 / 65 % avant, dont 95 % à
garder une place menacée ; 45 / 40 / 1 / 15 % après.

Essais écartés (1700, 12 parties) :

| Variante | guerres | durée | écart | camps en vie | trésor | hommes |
|---|---|---|---|---|---|---|
| armée ennemie retranchée chez elle comptée comme menace seulement autour du chef-lieu | 13,5 | 2,4 | 143,0 (+42 %) | 2,4 (−27 %) | 25 682 | 9 236 |
| frapper et se replier seulement (sans détacher) | 15,1 | 2,8 | 112,3 | 2,9 | 24 660 | 9 613 |
| … et le quart du plus de places tenues | 15,0 | 2,8 | 121,2 | 2,8 | 24 840 | 9 182 |
| … et de plus la trêve de deux à cinq ans partout | 15,4 | 2,7 | 133,4 (+32 %) | 2,7 | 16 977 | 9 918 |
| détacher dès que la place tient (une fois la menace, un quart de l'armée) | 14,1 | 2,8 | 140,8 (+39 %) | 2,2 (−33 %) | 37 040 | 8 416 |
| … et deuxième défaite face à n'importe quel vainqueur partout | 10,2 (−40 %) | 2,7 | 143,7 (+42 %) | 2,5 | 27 822 | 9 121 |

Quatre de ces variantes finissaient au moins une partie sur douze avec un seul camp (de 1721 à 1729). Retenu :
frapper, se replier, détacher ce qui dépasse une fois et demie la menace (au moins un tiers de l'armée), le quart du
plus de places tenues partout ; trêve raccourcie et deuxième défaite face à n'importe quel vainqueur en France
seulement.

### Pas de frappe dans le Sud-Ouest (9/11/2026)

La durée des guerres de 1790 (−32 %) sortait de la tolérance. Cause et essais : SPEC-FRANCE.md, « Revu le jour même :
pas de frappe dans le Sud-Ouest ». Réglage : dans le Sud-Ouest (cinq camps au plus), une armée sur une place menacée
ne sort plus frapper (`AI.frapper`, toute la France seulement) ; elle se replie ou détache son surplus. « Avant » :
`27d9b16` (les mêmes fichiers que plus haut) ; « final » : `21fc7c5`, mêmes commandes, `--proc 4`.

| Moyenne | 1700 avant (12) | 1700 final (12) | 1790 avant (24) | 1790 final (24) |
|---|---|---|---|---|
| Guerres déclarées | 17,0 | 14,8 (−13 %) | 13,85 | 13,05 (−6 %) |
| Durée d'une guerre (mois) | 3,4 | 3,1 (−9 %) | 3,4 | 2,9 (−15 %) |
| Écart de places | 101,0 | 117,1 (+16 %) | 107,7 | 119,1 (+11 %) |
| Camps en vie | 3,3 | 2,9 (−12 %) | 3,35 | 3,05 (−9 %) |
| Technologies par camp | 15,6 | 15,3 | 46,6 | 46,0 |
| Trésor (livres) | 21 123 | 22 082 (+5 %) | 39 826 | 35 529 (−11 %) |
| Hommes par camp | 10 499 | 9 756 (−7 %) | 12 163 | 12 268 (+1 %) |
| Mois de banqueroute / de famine | 26 / 33 | 66 / 106 | 0 / 3 | 5 / 7 |

Tout est dans ±25 %. Les mois de famine de 1700 montent (106 contre 33 ; 124 dans un essai voisin, même réglage) :
à surveiller, ce n'est pas une mesure de la tolérance. Armées au repos (`outils/banc_guerres.py --geo 2 --epoque 1700
--mois 120`, graines 1 à 4) : 31 / 16 / 26 / 36 % (45 / 40 / 1 / 15 % avec la frappe, 65 / 59 / 51 / 65 % avant le
chantier). Toute la France ne change pas (le code n'y change pas ; `outils/banc_france.py --epoque 1790 --mois 36` :
85 camps en vie, 863 places prises à un camp, contre 86 et 884 : ce banc ne se reproduit pas exactement d'une exécution à l'autre ; `outils/banc_guerres.py --geo 3
--epoque 1790 --mois 84` : 4 / 9 / 12 / 16 / 18 camps disparus après 3 / 4 / 5 / 6 / 7 ans, 2 076 places prises,
69 traités et 18 absorptions, 43 % des armées au repos, contre 24 disparus et 41 % dans la mesure du chantier).
