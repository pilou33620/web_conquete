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

- **Données** (`outils/france.py`, retiré du dépôt le 15/11/2026 et gardé dans l'historique git ; sources npm : Highcharts, @etalab, GeoNames `cities.json`, Natural Earth) :
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
- **Échelle : décidée le 16/11/2026, cases de 4 à 5 km** pour la carte d'Europe (à 1 km, 17 millions de cases : trop
  pour un iPhone, un iPad ou un Raspberry). Étendue d'environ 4 500 × 3 900 km (de l'Atlantique à l'Oural et à la
  Caspienne, du Sahara à la Scandinavie) : 5 km font environ 700 000 cases, moins que la carte de France ; 4 km en font
  1,1 million, autant qu'elle. On part sur 5 km, et 4 km si le Raspberry suit. La carte de France à 1 km reste celle du
  mode France ; on choisit le mode sur l'écran de départ.
- **Villes : les 25 plus grandes de chaque pays** (demande du 15/11/2026), capitale comprise, avec leur population
  vers 1790 (l'année des données du mode France). Exemple, la France, d'après les populations déjà dans le jeu
  (`places_france.json`, et `places.rs` pour le Sud-Ouest) :

  | # | Ville | Habitants | # | Ville | Habitants |
  |---|---|---|---|---|---|
  | 1 | Paris (capitale) | 600 000 | 14 | Metz | 36 000 |
  | 2 | Lyon | 145 000 | 15 | Angers | 33 000 |
  | 3 | Bordeaux | 110 000 | 16 | Montpellier | 32 000 |
  | 4 | Marseille | 106 000 | 17 | Caen | 31 000 |
  | 5 | Nantes | 80 000 | 18 | Reims | 31 000 |
  | 6 | Rouen | 72 000 | 19 | Brest | 30 000 |
  | 7 | Lille | 62 000 | 20 | Rennes | 30 000 |
  | 8 | Toulouse | 52 000 | 21 | Nancy | 30 000 |
  | 9 | Versailles | 51 000 | 22 | Besançon | 28 000 |
  | 10 | Strasbourg | 49 000 | 23 | Toulon | 28 000 |
  | 11 | Orléans | 48 000 | 24 | Troyes | 26 000 |
  | 12 | Nîmes | 41 000 | 25 | Avignon (papale jusqu'en 1791) | 26 000 |
  | 13 | Amiens | 40 000 | | | |

- **Les villes changent avec l'époque** (demande du 15/11/2026) : la liste des 25 suit les dates de la partie. Des
  villes y entrent au XIXe siècle (en France : Saint-Étienne, Roubaix, Le Havre, Saint-Nazaire, Mulhouse…), d'autres
  en sortent. Une ville neuve existe sur la carte dès le départ, comme un bourg, et grandit selon sa trajectoire.
- **Les villes côtières aussi** (demande du 16/11/2026), en vue d'un mode naval plus tard : en plus des 25, les ports
  qui comptent à l'époque, même petits, chacun avec son rôle : arsenal (flotte de guerre), commerce (colonies, coton,
  vin), pêche ou course (corsaires). Chacun porte l'étiquette `port` (déjà lue par le jeu : gabares, blocus, cabotage).
  Pour la France, d'après la carte actuelle (168 places étiquetées `port`) :
  - arsenaux : Brest, Toulon, Lorient, Rochefort (sans l'étiquette), Cherbourg (absente de la carte) ;
  - commerce : Marseille, Bordeaux, Nantes (sans l'étiquette), Le Havre, La Rochelle, Saint-Malo, Bayonne, Sète,
    Saint-Nazaire (sans l'étiquette, port neuf de 1856), Dunkerque (absente) ;
  - pêche et course : Dieppe, Fécamp, Honfleur, Granville, Boulogne, Calais, Concarneau, Douarnenez, Paimpol,
    Les Sables-d'Olonne, Morlaix (sans l'étiquette) ;
  - Méditerranée : Antibes, Agde, Ajaccio, Bastia ; Cannes et Port-Vendres absentes.
  Fait le 16/11/2026 avec la géographie 4 (`game/data/places_france_v4.json`) : Cherbourg, Dunkerque, Cannes,
  Port-Vendres (et Roubaix) ajoutées, `port` posé sur Rochefort, Nantes, Morlaix (Saint-Nazaire l'avait déjà).

Fait dans le mode France le 15/11/2026 :
- populations de 1790 corrigées (`POP_1790_FR`, `places.rs`) pour 70 places dont l'outil de la carte avait gardé un
  chiffre d'aujourd'hui réduit : Nice (114 476 → 25 000), Annecy, la banlieue de Paris (Saint-Denis, Boulogne…),
  Mulhouse, Perpignan, Saint-Nazaire, La Roche-sur-Yon… Le fichier `places_france.json` ne change pas : la carte n'est
  pas refaite et les parties sauvegardées restent valables ;
- trajectoires d'époque (`POP_CURVES`, `POP_PLACE` par « nom|département », `rules.rs`) : Paris (4,5 fois 1790 en 1900),
  Lyon, Marseille, Lille, les villes des mines et des forges (Saint-Étienne, Le Creusot, Decazeville, Montceau, Lens,
  Montluçon), des usines (Mulhouse, Tourcoing, Roanne, Calais), des ports (Le Havre, Boulogne,
  Saint-Nazaire), des arsenaux (Toulon, Brest, Lorient), des eaux et des bains (Vichy, Aix-les-Bains, Royan, Trouville,
  Nice, Menton), Lourdes, La Roche-sur-Yon (ville neuve de 1804), la banlieue de Paris.

Reste à faire : les autres places de la carte de France gardent un chiffre d'aujourd'hui réduit (moins de 14 000
habitants, l'ordre de grandeur reste plausible).

Fait le 16/11/2026, géographie 4 (la carte des nouvelles parties ; la 3 est figée pour les parties en cours, son cache
reste `map_cache.json`, celui de la 4 est `map_cache_v4.json`) : Roubaix, Cherbourg, Dunkerque, Cannes et Port-Vendres
ajoutées à la fin de la liste des places (celles de la 3 gardent leur numéro), avec leurs trajectoires (Roubaix sur la
courbe de Mulhouse, `cherbourg`, `cannes` ; Dunkerque et Port-Vendres sur la courbe ordinaire).

### Le moteur du mode Europe : fait le 16/11/2026 (géographie 5)

Données (`outils/europe.mjs`, voir `outils/EUROPE.md`) : `game/data/europe.json` (32 pays de 1700, fleuves, lacs),
`places_europe.json` (1 258 places), `pays_europe.json` (les camps), `epoques_europe.json` (172 trajectoires de villes).
Le moteur Rust les embarque et sait jouer sur cette carte ; la page (écran de départ, dessin de la carte) est le lot suivant.

- **Carte** (`geo.rs`, `GeoMap::new(5)`) : 867 × 733 cases de 5 km, cache `map_cache_v5.json`, faite en 4 s environ à la
  première demande (jamais au démarrage du serveur). Le moteur compte en cases et ses règles ne changent pas (une armée
  fait ses 22 cases par jour, 110 km sur cette carte) : seule la projection tient compte des 5 km (`KX`, `KY` par carte,
  `km_case`). Relief par lignes de crête et massifs (`_elev5` : Alpes, Pyrénées, Carpates, Balkans, Alpes dinariques,
  Apennins, Alpes scandinaves, Highlands, Massif central, sierras d'Espagne, Atlas, Taurus, chaîne Pontique, Caucase…),
  végétation avec les terrains du jeu (`_terrain5` : dunes pour le désert, lande pour la steppe, marais du Pripet, du
  delta du Danube, des Pays-Bas, taïga et forêts d'Europe centrale, vigne autour de la Méditerranée). Routes : places
  voisines jusqu'à 100 cases, routes de poste de chaque capitale à ses six plus grandes villes, un bac aux détroits
  d'une case (Sund, Messine, Petit Belt, Bosphore).
- **Îles** (`waterways.rs`) : chaque terre que la route ne relie pas reçoit une voie de mer, de port à port (Douvres –
  Calais, Belfast – Greenock, Palma – Tarragone, La Canée – Nauplie, Larnaca – Tripoli de Syrie, Malte par Gozo et
  Licata, la Sardaigne par Bonifacio, la Corse par l'île d'Elbe…) : 28 traversées, que les armées prennent comme le
  cabotage du Sud-Ouest (embarquement, 55 cases par jour, tempêtes). Tout le réseau est d'un seul tenant. Les fleuves de
  rang 1 (21 : Danube, Rhin, Volga, Nil…) sont navigables entre les places de leurs rives.
- **Camps** (`rules.rs`) : les 32 pays entrent dans `FACTIONS` après les départements (familles, armées types, IA) ; une
  partie ne connaît que les camps de sa carte. Le mot du camp est « pays » ; `SCENARIOS_EUROPE` et `ERAS_EUROPE` donnent
  les textes vus d'Europe (« Europe, 1700 »…), aux mêmes dates et avec les mêmes techniques qu'en France.
- **Trajectoires** : `pop_curve` lit d'abord `epoques_europe.json` (« Nom|PAYS »), sinon une ville ou une campagne
  ordinaires d'Europe (`POP_EUROPE`). Les coefficients vont de 0,002 (Saint-Pétersbourg en 1700) à 1 000 (Lodz en 1900) :
  la population suit, la production n'en prend que la racine quatrième (× 5,6 au plus) : rien à borner.
- **Ce qui était propre à la France** : chemins de fer générés (dans chaque pays, de la capitale à ses huit plus grandes
  villes, de 1837 à 1885) ; événements datés (l'histoire de France) remplacés par les seuls événements sans date ; pas
  de grande crue ni de routes coupées ; crue locale au bord de tout fleuve navigable ; ni spécialités phares des villes,
  ni voies et bacs du Sud-Ouest ; zones de météo d'après la carte (montagne, côte à deux cases de la mer) ; le chef d'un
  pays est son « Souverain ». Les étiquettes `arsenal`, `commerce`, `peche` sont gardées à part (`roles` d'une place).
- **Serveur** : `GET /api/map?geo=4|5` (la carte d'un mode pour l'écran de départ ; 400 sinon), champs `modes` et
  `km_case` ; `POST /api/new` et `/api/skirmish` avec `geo` (4 par défaut) ; un camp d'une autre carte est refusé (400).
  Les sauvegardes gardent leur carte (`geo: 5`) et reprennent au redémarrage.
- **Données corrigées** : la capitale de la Russie est Moscou (`outils/europe/villes.json`). Saint-Pétersbourg, un
  hameau de 440 âmes en 1700 collé à la frontière, tombait dans les premières années et la Russie finissait absorbée
  par la Courlande.
- **Essais** : `rust/conquete/tests/europe.rs` (carte, pays, réseau, trajectoires, parties, 24 mois deux fois à la même
  graine, sauvegarde, escarmouches, bataille de campagne) et `tests/bancs_serveur.rs` (`mode_europe`, reprise au
  redémarrage). Les références des géographies 1 à 3 n'ont pas bougé.
- **Mesures** (release, machine de développement) : carte faite en 4 s ; `/api/map?geo=5` : 7,4 Mo, 1,07 Mo compressé
  (France : 14,6 Mo et 1,9 Mo) ; un mois de campagne avec 32 IA : 1,5 s vers 1700, 3 à 4 s vers 1850 (France, 89 camps :
  2 à 3 s en 1700, 3,5 à 4,5 s en 1870).

Reste à faire :
- **la page** : écran de départ (choix du mode par `modes`, `/api/map?geo=5`), dessin de la carte à 5 km, distances
  affichées (multiplier par `km_case`), styles des villes par pays, ligne des crédits (Natural Earth, GeoNames) ;
- **l'équilibre** (une partie de contrôle de 1700 à 1725 : 167 guerres déclarées, 40 traités, 6 pays absorbés, dont la
  France par la Grande-Bretagne et les Habsbourg par les États pontificaux) : les armées traversent l'Europe
  en quelques semaines, comme elles traversaient la France (c'est la règle des cases) ; les petits pays (Malte,
  Wurtemberg) entretiennent 4 000 à 10 000 hommes avec le plancher de vivres d'un camp, sont souvent en disette et
  entassent 50 000 à 380 000 livres (le cours des vivres, tenu par 32 acheteurs, reste à 0,85, au-dessus du prix que
  les IA acceptent, 0,78) ; tous les camps partent avec les mêmes réserves et la même armée de 740 hommes, Malte comme
  la Russie, et Malte finit avec 22 places ;
- **le champ de bataille** tiré de la carte compte une case pour un kilomètre : en Europe, le terrain des cases voisines
  et une rivière à 5 km s'y retrouvent à 1 km ;
- textes restés français : noms de familles et de généraux, « chef-lieu » dans quelques messages, descriptions des
  techniques (« les vapeurs de la Garonne ») ; les distances en « km » de ces textes sont des cases ;
- cabotage libre de port à port, mode naval ; spécialités des places d'Europe (blé, fer, bois, vin) ; 4 km par case si
  le Raspberry suit.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
