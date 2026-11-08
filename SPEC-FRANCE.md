# Spec : toute la France, puis l'Europe

## Pourquoi

Demande du 07/11/2026 : une grosse mise à jour.
1. **Toute la France** : les 96 départements de métropole, chacun jouable (on choisit n'importe lequel au départ).
2. **Plus tard, l'Europe et l'Afrique du Nord**, avec un second mode de jeu par pays (chaque pays et ses villes
   principales). Même étendue géographique qu'un grand jeu de stratégie d'époque, mais d'après la vraie géographie :
   rien n'est repris d'un autre jeu (ni carte, ni découpage, ni noms de régions inventés).

Décisions du joueur : la France d'abord ; deux modes de jeu (« France » par département, « Europe » par pays) ;
l'échelle de l'Europe reste à trancher (France détaillée et reste plus grossier, ou échelle revue pour tout).

## Ce qui suppose aujourd'hui cinq départements

| Où | Quoi |
|---|---|
| `game/geo.py` | `PLAYABLE` (33, 24, 40, 47, 64), bornes de `geo.json` (le Sud-Ouest), forêts, landes et vignobles écrits à la main, routes royales, cache de la carte (cases de 1 km) |
| `game/data/geo.json` | 15 départements (5 jouables et leurs voisins), 23 rivières, 6 étendues d'eau |
| `game/places.py` | ~220 places choisies à la main : chef-lieu, 9 villes, 33 villages par département, populations d'époque, spécialités |
| `game/rules.py`, `game/events.py`, `game/ai.py` | les 5 camps (nom, capitale, couleur, atouts), événements datés par département |
| `game/tactics/*` | terrains de bataille d'après la carte, plans des villes |
| `web/js/hex/modeles.js`, `carte/villes.js`, `carte/terre.js`, `towns.js` | styles de maisons, de toits et de cultures par département (5 pays) |

## Étape 1 : la France entière (mode « France ») — faite le 07/11/2026, branche `claude/france`

- **Données** (`outils/france.py`, sources npm : Highcharts, @etalab, GeoNames `cities.json`, Natural Earth) :
  89 départements de 1790 (la Seine, la Seine-et-Oise, la Corse réunies ; Belfort avec le Haut-Rhin), 1 942 places
  générées (chef-lieu, 7 villes, 16 villages répartis par département ; populations de 1790 pour les grandes villes,
  places fortes de Vauban), 67 rivières nommées (tracées le long des surfaces d'eau de Natural Earth entre des points
  connus de leur cours ; les petites rivières du Sud-Ouest gardées), lacs, pays voisins. Écrit `game/data/geo.json`
  (géographie 3) et `places_france.json` ; le Sud-Ouest d'avant devient `geo_v2.json` (anciennes parties).
- **Carte** (`game/geo.py`, géographie 3) : 1 150 × 1 099 km, cases de 1 km, 2 165 places, 4 382 routes ; relief par
  lignes de crête (Alpes, Pyrénées, Jura, Vosges, Corse) et massifs (Massif central, Préalpes, Armorique, Ardennes…),
  forêts, vignobles, marais (Camargue, Marais poitevin, Brière, Dombes) ; routes royales de poste depuis Paris. Générée
  en 70 s environ au premier démarrage (`map_cache.json`, non versionné). Les géographies 1 et 2 restent identiques.
  `cellnode` passe à deux octets par case (plus de 254 places).
- **Camps** (`game/rules.py`) : les 84 départements de plus sont générés (chef-lieu, couleur, un des cinq profils :
  négoce, forges, grenier, vignoble, montagne) ; familles, armées types, courbes de population par défaut. Une partie
  ne connaît que les camps de sa carte (`geo.playable_codes`).
- **Vitesse** : frontières, forces et revenus gardés un quart de journée : un mois de jeu avec 89 camps prend 8 à 20 s
  sur la machine de développement (40 à 60 s avant). Puis l'IA des camps lointains allégée (ci-dessous) : 2 à 4,5 s en
  début de partie, 6 à 8 s après deux ans.
- **Page** : liste déroulante des départements et fiche du choisi (ou toucher une ville) ; styles de maisons de douze
  grandes régions ; plateau bâti par blocs de 16 × 16 hexagones autour de la caméra (90 blocs, 260 places au plus) ;
  territoires sans lissage ni peinture des tuiles sur le plateau.

### IA allégée des camps lointains — faite le 08/11/2026

Le Raspberry Pi est 3 à 5 fois plus lent que la machine de développement : il fallait diviser par 3 au moins le temps
d'un mois en France, sans changer le Sud-Ouest. Décisions (prises seul, le joueur absent) :

- **Camp lointain** (`Game.ia_lointaine`) : ni en guerre ni allié avec le joueur, sans frontière commune avec lui,
  chef-lieu à plus de 200 km du sien ; réévalué chaque quart de journée. Depuis la Gironde, 75 camps sur 89. Jamais dans
  le Sud-Ouest (5 camps). Le camp du joueur, ses voisins, ses ennemis et ses alliés gardent l'IA complète.
- **Il réfléchit tous les 6 jours** (`AI_PAS_LOIN`) au lieu de 1,5 ; une guerre ou une frontière avec le joueur le
  réveille dans le quart de journée. Sa diplomatie revient tous les 4 à 9 jours au lieu de 8 à 13 (relations et
  déclarations de guerre au même rythme qu'avant, puisqu'il ne la fait qu'à ses réflexions) ; ses demandes de droit de
  passage tous les 45 jours (au lieu de 15), deux recherches de chemin au plus ; ses revenus refaits un jour sur deux.
- **Batailles entre camps lointains** : le tour des IA ne passe plus à petits pas (0,05 jour) pour elles, seulement pour
  une bataille du joueur ou d'un camp proche (`Game.bataille_proche`) ; il y en avait presque toujours une quelque part
  en France, ce qui doublait le nombre de pas de tout le mois.
- **Toute la France (89 camps), pour tous** : trésors par quarts de jour, milice et ordre public par demi-journées,
  usure et ravitaillement des armées par demi-journées, forces des camps gardées deux jours, réseau des places ouvertes
  à chaque camp gardé un quart de journée (et bâti à partir de celui des places neutres, commun à tous) ; premières
  réflexions décalées dans le pas de chaque camp (elles s'étalaient sur trois semaines).
- **Calculs exacts, partout** (mêmes résultats) : places de chaque camp (`owned_nodes`) gardées jusqu'au prochain
  changement de maître (`_own_ver`, à augmenter là où l'on change `n['owner']`) ; rencontres d'armées par balayage
  au lieu de toutes les paires ; plus proche place par carrés de 20 km ; cibles et point de ralliement par carrés de
  40 à 50 km ; défense des places jugée seulement pour les cibles les mieux classées ; masque des terres fermées fait
  seulement quand il sert ; demandes de passage vers une place qu'aucune route ne relie au reste (îles, vallées des
  Pyrénées et des Alpes) écartées sans recherche dans toute la carte ; routes coupées par la crue calculées autour
  de la Garonne et de la Dordogne seulement (7 s à la première crue, 1,6 s).

Mesures (`outils/banc_france.py`, Gironde, camp du joueur joué par une IA ; temps de calcul du processus, avant et après
lancés en même temps sur la machine de développement, chargée par d'autres calculs) :

| | avant | après |
|---|---|---|
| 1790, mois 1 à 3 | 7,2 / 13,2 / 18,8 s | 2,2 / 3,5 / 4,3 s (÷ 4) |
| 1700, mois 1 à 3 | 8,9 / 12,4 / 16,6 s | 3,2 / 3,3 / 3,2 s (÷ 4) |
| 1790, après 2 ans (mois 25 à 27) | 39,8 / 31,9 / 32,5 s | 7,8 / 6,3 / 6,1 s (÷ 5) |

Le monde lointain reste vivant : après deux ans, autant de places prises (2 598 avant, 2 622 après), plus de batailles
(victoires et défaites des camps : 190 avant, 296 après), la même médiane de places par camp (39). Le Sud-Ouest est
inchangé : `outils/simuler.py --parties 2 --epoque 1790 --annees 10 --graine 1 --proc 2` donne exactement les mêmes résultats.
Test : `tests/test_france.py` (un camp lointain réfléchit une fois par semaine et rallie ses villages, un voisin garde
le pas complet, la guerre réveille le lointain).

Vu en mesurant (non corrigé, hors sujet) : après la course aux villages neutres (un an), la France à 89 camps n'a presque
plus de guerres (aucune du 25e au 27e mois, avant comme après) ; 157 places de la géographie 3 ne sont pas reliées
au grand réseau des routes (Soulac, Urdos, Laruns, Barcelonnette, Briançon, le pays de Gex, les îles…) : les IA les
visent en vain ; les trésors des IA montent à 200 000 livres.

Reste à faire : événements et textes des autres régions, voies navigables et côtes au-delà du Sud-Ouest, vérifier la
fluidité sur iPad (et le temps d'un mois sur le Raspberry Pi lui-même).

## Étape 2 : l'Europe et l'Afrique du Nord (mode « Europe »)

- Pays d'époque (Angleterre, Espagne, Portugal, Prusse, Autriche, Russie, Empire ottoman, Provinces-Unies, États
  italiens, Suède, Maroc, régences d'Alger, de Tunis…) et leurs villes principales.
- Échelle à trancher : 17 millions de cases à 1 km, c'est trop pour un iPad ou un Raspberry.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
