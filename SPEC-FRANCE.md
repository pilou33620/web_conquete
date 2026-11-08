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
voies navigables et côtes au-delà du Sud-Ouest, vérifier la fluidité sur iPad.

## Étape 2 : l'Europe et l'Afrique du Nord (mode « Europe »)

- Pays d'époque (Angleterre, Espagne, Portugal, Prusse, Autriche, Russie, Empire ottoman, Provinces-Unies, États
  italiens, Suède, Maroc, régences d'Alger, de Tunis…) et leurs villes principales.
- Échelle à trancher : 17 millions de cases à 1 km, c'est trop pour un iPad ou un Raspberry.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
