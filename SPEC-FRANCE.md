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

## Étape 1 : la France entière (mode « France »)

1. **Données** (outil `outils/france.py`, résultat versionné dans `game/data/`) :
   - contours des 96 départements, côtes, grandes rivières et lacs ;
   - places : par département, la préfecture, les sous-préfectures et villes principales, des villages, avec
     coordonnées et populations (INSEE via `@etalab/decoupage-administratif`, ramenées vers 1790), forts et places
     fortes de l'époque (Vauban : Lille, Strasbourg, Besançon, Briançon, Neuf-Brisach…) ;
   - relief : massifs (Alpes, Pyrénées, Massif central, Jura, Vosges…) en polygones, forêts et vignobles principaux.
   Sources : paquets npm (accessibles ici) ; pour les centres des communes, l'API `geo.api.gouv.fr`, qu'il faudra
   autoriser dans l'environnement (une seule fois).
2. **Carte** : cases de 1 km sur toute la métropole (~1 000 × 1 000 km, environ 30 fois la carte actuelle) : le cache,
   l'envoi au navigateur (compressé, par morceaux), le plateau 3D (décor bâti autour de la caméra, pas d'un coup) et
   les routes entre places voisines.
3. **Camps** : un camp par département, généré (nom, préfecture, couleur, atouts tirés de ses spécialités) ; les
   5 camps actuels gardent leurs textes. Écran de départ : choisir n'importe quel département sur la carte.
4. **Styles régionaux** : maisons, toits et cultures par grande région (Bretagne, Normandie, Alsace, Provence,
   Île-de-France…), sur le modèle des 5 pays actuels.
5. **Équilibre et IA** : 95 adversaires ; IA plus légère pour les camps lointains ; temps de tour mesuré.

## Étape 2 : l'Europe et l'Afrique du Nord (mode « Europe »)

- Pays d'époque (Angleterre, Espagne, Portugal, Prusse, Autriche, Russie, Empire ottoman, Provinces-Unies, États
  italiens, Suède, Maroc, régences d'Alger, de Tunis…) et leurs villes principales.
- Échelle à trancher : 17 millions de cases à 1 km, c'est trop pour un iPad ou un Raspberry.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
