# Spec : toute la France, puis l'Europe

**Mise à jour du 22/11/2026 (décision du joueur) : la France est retirée.** L'écran de départ propose l'Aquitaine
(géographie 2, les cinq départements du Sud-Ouest, la carte par défaut) et les théâtres : l'Europe (géographie 5), puis
l'Amérique, l'Inde, la Guinée, le Brésil, Madagascar et les Indes orientales (6 à 11, quand leurs données seront
écrites par `outils/theatre.mjs`), chacun une carte à part de cases de 5 km, un pays par camp. Ajouter un théâtre : une
ligne dans la table `THEATRES` de `rust/conquete/src/geo.rs` et ses fichiers (`<id>.json`, `places_<id>.json`,
`pays_<id>.json` avec les moyens, les maisons et la culture de chaque pays, `epoques_<id>.json`, `cultures_<id>.json`).
Les géographies 3 et 4, leurs données (`geo.json`, `places_france*.json`), les départements générés et leurs essais
sont retirés (historique git) : une partie sur la carte de France est refusée au chargement, avec un message. Ce qui
suit est l'histoire de l'étape 1 et de l'étape 2.

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

Données (`outils/theatre.mjs europe`, voir `outils/THEATRES.md`) : `game/data/europe.json` (32 pays de 1700, fleuves, lacs),
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
- **Données corrigées** : la capitale de la Russie est Moscou (`outils/theatres/europe/villes.json`). Saint-Pétersbourg, un
  hameau de 440 âmes en 1700 collé à la frontière, tombait dans les premières années et la Russie finissait absorbée
  par la Courlande.
- **Essais** : `rust/conquete/tests/europe.rs` (carte, pays, réseau, trajectoires, parties, 24 mois deux fois à la même
  graine, sauvegarde, escarmouches, bataille de campagne ; depuis les corrections : moyens de départ, champ de bataille
  à 5 km par case, Scandinavie reliée, textes des règles) et `tests/bancs_serveur.rs` (`mode_europe`, reprise au
  redémarrage). Les références des géographies 1 à 3 n'ont pas bougé.
- **Mesures** (release, machine de développement) : carte faite en 4 s ; `/api/map?geo=5` : 7,4 Mo, 1,07 Mo compressé
  (France : 14,6 Mo et 1,9 Mo) ; un mois de campagne avec 32 IA : 1,5 s vers 1700, 3 à 4 s vers 1850 (France, 89 camps :
  2 à 3 s en 1700, 3,5 à 4,5 s en 1870).

### Corrections du mode Europe : faites le 16/11/2026 (géographie 5, `GEN_EUROPE` = 2)

Demande du joueur : un équilibre réaliste, le champ de bataille à l'échelle, les distances des textes, tout en français,
la Scandinavie reliée. Tout est gardé par `Game::europe()` ou la géographie 5 : les références des géographies 1 à 4 ne
bougent pas.

1. **Équilibre** (`rules.rs` : `MOYENS_EUROPE`, `moyens_europe` ; `engine/mod.rs` : `regiments_europe`, `Game::new`).
   Chaque pays a son armée de paix réelle (milliers d'hommes, au début de 1700, 1790, 1813, 1870) et son trésor
   (multiple des 500 livres d'un département). Un régiment (~300 hommes) pour 10 000 hommes réels en 1700, 15 000 en 1790,
   20 000 en 1813, 25 000 en 1870, 30 au plus ; un cinquième en garnison à la capitale, 15 % dans les plus grandes
   villes, le reste en armées de dix régiments au plus (capitale, puis plus grandes villes) ; Malte et la
   Courlande : une demi-garnison et un petit corps (un homme sur trente-trois). Vivres, recrues et armes suivent le nombre
   de régiments. Le plancher de production (`FLOOR`) est multiplié par le poids du pays (armée de 1700 / 60 000, de
   0,1 à 1). Les villes produisent et lèvent leur milice selon leur taille (racine de la population / 25 000, de 0,4 à
   2,5 : base, port et vignoble ; `Game::taille_europe`). Le commerce d'un traité se mesure au plus petit des deux
   partenaires. Les IA paient les vivres jusqu'à deux fois le cours ordinaire en disette, ne lèvent plus de régiment quand
   les greniers sont vides et la récolte déficitaire, s'accordent au moins 2 régiments quel que soit leur revenu (5
   en France : un micro-État n'en paie pas cinq) et, trésor compris, pas plus que leur récolte n'en nourrit (vivres
   produits / 1,5, plus deux : une armée marche sur son ventre, et la Grande-Bretagne n'aligne plus deux fois l'armée de
   la France). Une seconde défaite face au même vainqueur n'est fatale qu'à un pays réduit de
   moitié (la France ne passe plus tout entière à l'Angleterre parce que Paris est tombé deux fois). Tableau et parties
   de contrôle plus bas.
2. **Champ de bataille** (`tactics/terrain.rs`, `terrain_ville.rs`, `bridge.rs`, `skirmish.rs`) : la génération lit la
   carte de campagne à `km_case` km par case (tremblé des bords, lieu tout proche à 1,3 km, routes à 2 km, place et
   bords mouillés de la ville, terrain d'une escarmouche à 3,5–6 km) : en Europe, un fleuve à 10 km n'est plus sur un
   champ de 3 km sur 2. Sur les cartes au kilomètre, les multiplications par 1 laissent les batailles identiques au bit.
3. **Distances** (`views.rs` : `rules_payload_carte`, `km_carte`) : les règles comptent en cases ; pour l'Europe, le
   texte servi multiplie par 5 les distances de la carte de campagne (hussards +30 km, aérostiers +15 km, Chappe +50 km,
   télégraphe +75 et +20 km, téléphone +50 km, espion 70 km, magasin aux vivres 150 km). La portée des canons La Hitte
   (« à 3 km ») se compte sur le champ de bataille, en vrais kilomètres : inchangée. Le texte de la France est le même.
   La page n'a qu'une distance calculée (`ui.js`, tronçons de voie ferrée) : déjà en km réels (`rails.rs`).
4. **En français partout** : « capitale » au lieu de « chef-lieu » pour un pays (politiques des villes, régiments étrangers,
   chemins de fer, effets des événements, Vauban) ; le legs d'un négociant va « au pays », pas « à la province » ; les
   régiments étrangers « plus en service ». Noms : `MAISON_NOMS` des 32 pays (la maison régnante de 1700 d'abord :
   Romanov, Habsbourg, Hohenzollern, Osman, Giray…), et dix familles culturelles (britannique, allemande, russe,
   espagnole, portugaise, italienne, ottomane, scandinave, polonaise, néerlandaise) pour les prénoms, les épouses et les
   généraux (`R::prenoms`, `prenoms_f`, `surnames` : Souvorov, Koutouzov, Cheremetiev… en Russie). La France et les
   départements gardent leurs noms.
5. **Scandinavie** (`geo.rs` : `BACS_5`, `_relier` ; `waterways.rs` : `MERS_5`) : bacs nommés du Grand Belt
   (Roskilde – Odense), du Petit Belt (Odense – Fredericia), de l'Øresund (Copenhague – Malmö, Elseneur – Helsingborg) ;
   voies de mer de Stockholm à Åbo par Mariehamn, de Kiel à Copenhague, de Stralsund à Ystad. Bornholm n'est plus le seul
   lien (Rønne – Colberg disparaît). La Finlande tient à la Russie par la terre (Vyborg, la Carélie) ; le fond du golfe de
   Botnie est au-delà du 62e parallèle, hors de la carte : pas de route de Suède en Finlande par la Laponie. `_relier`
   préfère la liaison qui passe le moins sur l'eau : plus de « route » Revel – Helsingfors à travers le golfe de Finlande.

Moyens de départ (régiments et hommes en armées et garnisons ; trésor en livres en 1700 ; un département de France :
6 régiments, 1 540 hommes, 500 livres) :

| Pays | Armée réelle (milliers) 1700 / 1790 / 1813 / 1870 | Régiments (hommes) 1700 | 1790 | 1813 | 1870 | Trésor | Plancher |
|---|---|---|---|---|---|---|---|
| France | 150 / 170 / 400 / 400 | 15 (4 000) | 11 (2 860) | 20 (5 340) | 16 (4 300) | 1 500 | 1 |
| Empire ottoman | 120 / 150 / 150 / 200 | 12 (3 160) | 10 (2 740) | 8 (2 240) | 8 (2 240) | 1 250 | 1 |
| Russie | 110 / 300 / 450 / 700 | 11 (2 860) | 20 (5 340) | 23 (6 240) | 28 (7 460) | 700 | 1 |
| Habsbourg | 100 / 300 / 250 / 280 | 10 (2 740) | 20 (5 340) | 13 (3 460) | 11 (2 860) | 1 000 | 1 |
| Suède | 70 / 50 / 40 / 40 | 7 (1 940) | 3 (840) | 2 (600) | 2 (600) | 600 | 1 |
| Provinces-Unies | 45 / 40 / 20 / 60 | 5 (1 340) | 3 (840) | 2 (600) | 2 (600) | 1 750 | 0,75 |
| Prusse | 40 / 190 / 230 / 400 | 4 (1 140) | 13 (3 460) | 12 (3 160) | 16 (4 300) | 700 | 0,67 |
| Maroc, Crimée | 40 / 30 (20) / … | 4 (1 000) | 2 (500) | 2 (500) | 2 (500) | 300, 150 | 0,67 |
| Grande-Bretagne | 30 / 45 / 250 / 180 | 3 (840) | 3 (840) | 13 (3 460) | 7 (1 940) | 2 250 | 0,5 |
| Espagne, Danemark, Pologne | 30 / 80, 70, 60 / … | 3 (700–840) | 4–5 | 2–5 | 2–4 | 1 100, 600, 300 | 0,5 |
| Savoie, Saxe | 25 / 40, 30 / … | 3 (840) | 2–3 | 2 | 2–3 | 450, 500 | 0,42 |
| Portugal, Naples, Venise, Bavière | 20 / … | 2 (600) | 2–3 | 2–3 | 2 | 750, 500, 700, 400 | 0,33 |
| Hanovre, Suisse, Westphalie, Pays-Bas du Sud, Alger | 15 / … | 2 (600) | 2 | 2 | 2 | 250 à 400 | 0,25 |
| Toscane et Milanais, Tunis | 10 / … | 2 (600) | 2 | 2 | 2 | 500, 200 | 0,17 |
| Tripoli, Gênes, États pontificaux, Wurtemberg | 5 / … | 2 (452) | 2 | 2 | 2 | 125 à 500 | 0,1 |
| Courlande, Malte | 2, 1,5 | 2 (210) | 2 (211) | 2 | 2 | 100, 200 | 0,1 |

Parties de contrôle (`simuler --geo 5`, IA partout, release) :

| Partie | Avant (0 → 30 ans) | Après |
|---|---|---|
| 1700 → 1730, graines 1 et 2 | France absorbée deux fois par la Grande-Bretagne (1715, 1717), les Habsbourg par les États pontificaux (1719), l'Empire ottoman par la Crimée (1720), l'Espagne par le Portugal (1723) ; Crimée à 154 places, Malte à 22 places et 300 000 livres | aucune grande puissance absorbée pour de bon : France 49 et 48 places, Grande-Bretagne 64 et 73, Russie 106 et 76, Empire ottoman 152 et 158, Espagne 52 et 50 ; les Habsbourg tombent une fois devant les Ottomans (1711) et se relèvent (25 places en 1730) ; tombent Malte, la Westphalie, la Suisse, la Saxe ; Crimée 48 et 7 places, Malte 0 |
| 1790 → 1820, graines 1 et 2 | (Russie absorbée par la Crimée en 1829 dans la partie de contrôle d'avant) | 30 et 32 pays en vie : France 50 et 38 places, Russie 95 et 116, Habsbourg 68 et 66, Prusse 84 et 43, Empire ottoman 82 et 118 ; tombent le Hanovre (à la Prusse, 1804) et la Suisse (1816) ; Malte 11 et 8 places |

Les petits pays lèvent encore, avec les années, 4 000 à 8 000 hommes (le quart des grandes puissances) ; mois de
banqueroute et de famine, tous camps, en 1700 – 1730 : 533 et 1 160 sur 23 040 mois-camps (2 et 1 200 avant : les
pays pauvres ont désormais un plancher à leur mesure). Sur d'autres graines (versions intermédiaires), la France est
encore tombée devant une coalition (1716, 1723) : le hasard des guerres compte.

Reste à faire :
- **la page** : écran de départ (choix du mode par `modes`, `/api/map?geo=5`), dessin de la carte à 5 km, distances
  affichées (multiplier par `km_case`), styles des villes par pays, ligne des crédits (Natural Earth, GeoNames) ;
- les armées traversent l'Europe en quelques semaines, comme elles traversaient la France (c'est la règle des cases) ;
- textes : descriptions des techniques propres à la France (« les vapeurs de la Garonne »), événements locaux d'esprit
  français (faux-sauniers, octroi) ; les régiments n'ont pas de nom dans le jeu (rien à traduire) ;
- cabotage libre de port à port, mode naval ; spécialités des places d'Europe (blé, fer, bois, vin) ; 4 km par case si
  le Raspberry suit.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
