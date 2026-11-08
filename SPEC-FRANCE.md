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

Reste à faire : alléger encore l'IA des camps lointains (Raspberry Pi), voies navigables et côtes au-delà du
Sud-Ouest, vérifier la fluidité sur iPad.

### Événements et textes des autres régions — faits le 08/11/2026

Tout est dans `game/regions.py` (données seules), branché par quelques lignes sur `rules.py`, `events.py`, `geo.py`,
`engine.py` et `views.py`. Les parties du Sud-Ouest (géographie 2) restent identiques : aucun événement régional ne
vise les cinq départements écrits à la main, les imprévus régionaux ne jouent qu'en géographie 3.

- **Événements datés** : 120 de plus, au même format et de la même force que ceux d'avant (`HIST`, `who` = les
  départements touchés). Par région : Paris et Île-de-France 9, Nord et Artois 8, Picardie 3 (et le sucre de
  betterave, qui touche aussi le Nord), Normandie 4, Bretagne 6, Pays de la Loire 6, Poitou-Charentes 5, Centre 5,
  Bourgogne 6, Champagne et Ardennes 7, Lorraine 6, Alsace 6, Franche-Comté 5, Lyonnais, Forez et Bresse 6, Auvergne
  et Limousin 6, Languedoc, Rouergue et Roussillon 9, Provence et comté de Nice 9, Dauphiné 3 (et le retour de l'île
  d'Elbe), Savoie 5, Corse 5, frontière du Nord-Est en 1815 1. Thèmes laissés à la branche « religion et révoltes » :
  Camisards, protestants, chouannerie, Vendée, jacqueries, canuts, Commune, bandits (aucun ici).
- **Dates** : jour exact quand il est connu ; sinon le mois ou l'année seuls sont sûrs, et le texte dit « vers » ou
  l'année (Compagnie des Indes à Lorient 1719, haras du Pin 1730, Saumur 1763, Hennessy 1765, kaolin 1768, canal du
  Centre 1792, Peugeot 1810, Schneider 1836, bassin de Saint-Nazaire 1856, Bollée 1873…).
- **Imprévus selon le pays** (`RANDOM`) : deux ou trois par profil (forges, grenier, vignoble, montagne, négoce) et
  trois pour les départements côtiers (`COTE`). Le Sud-Ouest y prend part en partie de toute la France
  (`PROFIL_SO`), pas dans les siennes.
- **Grands événements nationaux** : hors Sud-Ouest, le Grand Hiver, la guerre de Sept Ans, l'Amérique et les
  Cent-Jours ne parlent plus de Bordeaux ni de la Garonne (`TEXTES`) ; le 4 mars 1790 et les époques ont un texte de
  toute la France (`DEPT_1790`, `ERES`).
- **Camps** : un titre et un premier atout propres à chacun des 84 départements générés (« Lille et les Houillères de
  Flandre », « Houillères d'Anzin : +35 % de fer ») ; le chiffre reste celui du profil. Décision : sept départements
  tirés au hasard en vignoble ou en négoce deviennent des greniers (Beauce, Champagne berrichonne, Vexin normand,
  Perche, Bas-Maine, Haute-Saône, Bresse). Avant 1790, les camps portent le nom de leur province (Flandre et Hainaut,
  Beauce, Bourbonnais, Comtat Venaissin…) ; la fiche d'une place dit « Chef-lieu du Nord » ou « de la Flandre ».
- **Spécialités** : 384 places des départements générés ont une spécialité phare (chaque chef-lieu et 2 à 6 villes,
  types existants de `rules.SPECIALTY`) : soieries de Lyon, houillères d'Anzin, Champagne de Reims, faïences de
  Quimper, arsenal de Toulon…
- **Interface** : titre de la page, conseil du marché (« prenez un port de mer ou de rivière »), aide et tutoriel
  sur les fleuves ne parlent plus de l'Aquitaine en partie de toute la France.
- **Anciennes sauvegardes** : un événement ajouté dont la date est passée est noté comme fait au chargement
  (`views.migrate`) : il ne se déclenche pas d'un coup.
- Non fait : la crue de printemps (Garonne et Dordogne seules) et les noms des eaux de la carte relèvent des voies
  navigables et des côtes.

## Étape 2 : l'Europe et l'Afrique du Nord (mode « Europe »)

- Pays d'époque (Angleterre, Espagne, Portugal, Prusse, Autriche, Russie, Empire ottoman, Provinces-Unies, États
  italiens, Suède, Maroc, régences d'Alger, de Tunis…) et leurs villes principales.
- Échelle à trancher : 17 millions de cases à 1 km, c'est trop pour un iPad ou un Raspberry.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
