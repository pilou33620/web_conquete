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
