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
  sur la machine de développement (40 à 60 s avant).
- **Page** : liste déroulante des départements et fiche du choisi (ou toucher une ville) ; styles de maisons de douze
  grandes régions ; plateau bâti par blocs de 16 × 16 hexagones autour de la caméra (90 blocs, 260 places au plus) ;
  territoires sans lissage ni peinture des tuiles sur le plateau.

Reste à faire : alléger encore l'IA des camps lointains (Raspberry Pi), événements et textes des autres régions,
vérifier la fluidité sur iPad.

### Voies navigables et côtes — faites le 08/11/2026

- `game/waterways.py` (géographie 3 seulement ; les géographies 1 et 2 gardent leurs voies d'eau à l'octet près, banc
  `tests/test_voies_eau.py`) : 27 rivières navigables de plus (tête de navigation d'époque, un point de geo.json d'où
  la rivière porte bateau jusqu'à l'aval), la Garonne dès Toulouse, 12 canaux, 4 routes de cabotage (Ponant, Levant,
  Corse, traversée Calvi – Antibes) et plus de 70 ports de mer.
- **Décisions** : un canal est daté (`year` sur ses arêtes) : `engine.road_route` ne s'y engage pas avant son
  ouverture et la carte ne le dessine qu'ensuite. Ses quais du milieu ne comptent comme quais de commerce que s'il est
  ouvert en 1700 (Midi, Briare, Orléans) : sinon les places resteraient « port » avant le canal. Le canal de Briare et
  celui du Loing (1723) ne font qu'un, daté de 1642 (le Loing se naviguait déjà). Pas de courant sur un canal.
- Les tracés en mer (routes plutôt à 2,5 – 6 km des côtes, chenal de chaque port, embouchures) sont calculés une fois
  sur la grille (`outils/voies_eau.py`, plus court chemin pondéré, simplifié sans quitter l'eau) et rangés dans
  `game/data/voies_france.json` : rien à calculer au démarrage. À relancer si la côte ou les places changent.
- Dunkerque, Cherbourg, Saint-Tropez, Briare, Digoin manquent aux places générées : des places voisines en tiennent
  lieu (Coudekerque-Branche, Fermanville, Sainte-Maxime, Gien, La Motte-Saint-Jean). Morlaix, Hyères, Fréjus et
  Propriano sont à plus de 5 km de la mer sur la grille : leur chenal passe sur la terre (côte grossière).
- Rendu : gabares sur toutes les rivières navigables (et non plus sur toutes les grandes rivières), navires sur toutes
  les routes du cabotage, ancres des quais. Le plateau 3D est bâti une fois : il ne dessine que les canaux ouverts dès
  1700 (Midi, Briare, Orléans) ; les autres n'apparaissent que sur la carte en tuiles (sans WebGL), à leur ouverture.
- Coût mesuré (même machine, même moment) : 7 386 → 7 871 arêtes (58 → 543 voies d'eau), 57 → 505 quais ; bâtir les
  voies d'eau prend 0,15 s au lieu de 0,45 s (les places sont d'abord filtrées par case) ; carte envoyée au navigateur
  +0,2 Mo (14,7 Mo) ; un mois de jeu à 89 camps 10,3 s → 11,1 s environ (bruit compris).


## Étape 2 : l'Europe et l'Afrique du Nord (mode « Europe »)

- Pays d'époque (Angleterre, Espagne, Portugal, Prusse, Autriche, Russie, Empire ottoman, Provinces-Unies, États
  italiens, Suède, Maroc, régences d'Alger, de Tunis…) et leurs villes principales.
- Échelle à trancher : 17 millions de cases à 1 km, c'est trop pour un iPad ou un Raspberry.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
