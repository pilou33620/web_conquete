# Cartes des théâtres (Europe, Amérique, Inde, théâtres commerciaux)

`node outils/theatre.mjs <id> <dossier node_modules> [--apercu carte.svg] [--sortie dossier]` lit
`outils/theatres/<id>/` (`carte.mjs`, `villes.json`, `epoques.json`) et écrit dans `game/data` (ou dans `--sortie`) :
`<id>.json` (même forme que `geo.json` : pays dans `depts`, `rivers`, `waters`, `lands`), `places_<id>.json`
(comme `places_france.json`), `pays_<id>.json` (un objet par pays, les clés de `FACTIONS`, puis `moyens`, `maisons`,
`culture`), `epoques_<id>.json` (`"Nom|PAYS": [[année, population / population de 1790, étiquette], …]`) et
`cultures_<id>.json` (les cultures nouvelles du théâtre, `{}` si aucune). Deux lancements donnent les mêmes fichiers.

Théâtres connus de l'outil (table `THEATRES` en tête de `outils/theatre.mjs`) : `europe` (géographie 5, codes de deux
lettres), `amerique` (6, A..), `inde` (7, I..), `guinee` (8, G..), `bresil` (9, B..), `madagascar` (10, M..),
`indes_orientales` (11, O..). Hors d'Europe, un code de pays a trois majuscules et commence par l'initiale du théâtre.

## Dossier de travail (hors du dépôt)

Sans npm : les archives du registre, extraites à la main. `/tmp` étant en mémoire vive, les sources sont sur le disque
(`~/.cache/theatres-src`, 60 Mo) et `/tmp/theatres-src` y renvoie.

```sh
D=~/.cache/theatres-src; mkdir -p $D/node_modules $D/natural-earth; ln -sfn $D /tmp/theatres-src
get() { mkdir -p $D/node_modules/$1; curl -sSf https://registry.npmjs.org/$1/-/${1##*/}-$2.tgz | tar -xz -C $D/node_modules/$1 --strip-components=1 --wildcards "${3:-package/*}"; }
get world-atlas 2.0.2; get all-the-cities 3.1.0; get pbf 3.3.0; get ieee754 1.2.1
get resolve-protobuf-schema 2.1.0; get protocol-buffers-schema 3.6.1
get @highcharts/map-collection 2.3.3 'package/countries/*.topo.json'   # seulement les cartes topojson (18 Mo)
cd $D/natural-earth
for f in ne_10m_rivers_lake_centerlines ne_10m_lakes ne_10m_rivers_europe ne_10m_lakes_europe \
         ne_10m_rivers_north_america ne_10m_lakes_north_america; do
  curl -sSfO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/$f.geojson
done
node outils/theatre.mjs europe /tmp/theatres-src/node_modules --apercu /tmp/europe-apercu.svg   # depuis le dépôt
```

Le dossier `natural-earth` est cherché à côté de `node_modules`. Avec npm : `npm i world-atlas@2.0.2
@highcharts/map-collection@2.3.3 all-the-cities@3.1.0` revient au même.

## Sources (crédits)

- Natural Earth (domaine public) : pays à 10 m (`world-atlas` 2.0.2), fleuves et lacs à 10 m (dépôt
  `nvkelso/natural-earth-vector`, v5.1.2 ; fichiers globaux pour tous, fichiers régionaux nommés dans `carte.mjs`).
- Highcharts Map Collection 2.3.3 (déjà utilisée pour la France) : régions des pays coupés (Europe : Allemagne, Italie,
  Pologne, Ukraine, Croatie, Grèce, Roumanie, Serbie, départements français).
- GeoNames (CC BY 4.0), par `all-the-cities` 3.1.0 : coordonnées des villes, bourgs de complément.
- Aucune donnée d'un autre jeu. Frontières d'époque, populations de 1790 et de 1700 à 1900, caractère des pays :
  écrits à la main, de mémoire (ordres de grandeur de Bairoch et de De Vries, recensements) : des estimations.

## Interface d'un théâtre : `outils/theatres/<id>/`

`carte.mjs` :

```js
export default {
  id: '<id>', geo: <numéro de géographie>, nom: 'Amérique',
  cadre: { LON0, LON1, LAT0, LAT1, LAT_REF, KM: 5 },  // longitudes de −180 à 180, latitudes négatives au sud
  places: [min, max],                 // bornes du nombre de places (l'Europe : [900, 1400])
  ENTIERS, COUPES, DETROITS, FLEUVES,
  NE: { rivieres: [...], lacs: [...] }, // facultatif : fichiers Natural Earth en plus des globaux
  PAYS: { CODE: { name, short, color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty,
                  moyens: [[a1700, a1790, a1813, a1870], tresor], maisons: [8 noms], culture: '<clé>' } },
  CULTURES: { '<clé>': { prenoms: [...], prenoms_f: [...], noms: [...] } },
  // facultatifs : defaut, espace, NOM_LAC, PORTS_ADMIS, ILES (ci-dessous)
}
```

- `ENTIERS` : nom de pays Natural Earth → code du pays d'époque, ou « ~Nom » (terre hors jeu, `lands`).
- `COUPES` : nom de pays Natural Earth → `{ carte, regions, defaut, retouche }` : `carte` est une carte de
  `@highcharts/map-collection` (`'de/de-all'`, `'us/us-all'`), `regions` donne le code de chaque région, `defaut` celui du
  reste, `retouche(lon, lat, région)` un code ou `null`.
- `defaut` (facultatif) : l'étiquette de la terre d'un pays Natural Earth du cadre absent de `ENTIERS` et de `COUPES`
  (« ~Hors jeu » par exemple) ; sans elle, l'outil s'arrête et nomme ces pays.
- `DETROITS` : `[nom, [[lon, lat], …]]`, rouverts sur 7,5 km de large.
- `FLEUVES` : `[nom, rang 1 à 3, [lon, lat] vers la source, [lon, lat] à l'embouchure, /noms Natural Earth admis/]`, ou
  `[nom, rang, [[lon, lat], …]]` pour un cours absent de Natural Earth.
- `espace` (facultatif, 115 km) : un bourg GeoNames est ajouté là où aucune place du pays n'est plus près (la variable
  d'environnement `ESPACE` l'emporte) ; c'est le réglage du nombre de places.
- `NOM_LAC` (facultatif) : nom de lac Natural Earth → nom affiché. `PORTS_ADMIS` (facultatif) : `"Nom|CODE"` des ports
  sur un estuaire trop étroit pour la carte.
- `ILES` (facultatif, à la fin de l'objet) : `[[lon, lat, 'CODE', 'Nom'], …]`, des îles trop petites pour la grille
  (Saint-Eustache, les îles Banda) : la case de `KM` km du point devient une terre du pays, entière (son contour est le
  carré de la case, que `raster_ring` de `geo.rs` remplit par son centre). On y met une place de `villes.json` au même
  point (un bourg y prend l'étiquette `port` à la main : seules les villes la reçoivent d'office). L'outil nomme les îles forcées, et celles qui
  étaient déjà à l'échelle (inutiles).
- `culture` : une des clés du moteur (`britannique`, `allemande`, `russe`, `espagnole`, `portugaise`, `italienne`,
  `ottomane`, `scandinave`, `polonaise`, `neerlandaise` ; `francaise` : les noms des départements) ou une clé de
  `CULTURES`, qui ne contient que les cultures nouvelles.

`villes.json` : par pays, « nom français | nom GeoNames (alternatives séparées par /) ou @lat,lon | milliers d'habitants en
1790 | étiquettes (port, arsenal, commerce, peche) | remparts 0-4 ». La première ligne est la capitale.
`epoques.json` : `"Nom|CODE": [[année, milliers, étiquette], …]` de 1700 à 1900 ; la valeur de 1790 est celle de
`villes.json`.

## Ce que l'outil vérifie (il s'arrête au premier défaut)

Carte : `id` et `geo` conformes à la table des théâtres, cadre valide, codes des pays (deux lettres en Europe, ailleurs
trois majuscules avec l'initiale du théâtre), clé `culture` connue ou définie dans `CULTURES` (qui ne redéfinit pas une
culture du moteur, listes non vides), 8 maisons, `moyens` de forme `[[4 nombres ≥ 0], trésor > 0]` ; tout pays Natural
Earth du cadre a une règle (ou `defaut`) ; régions Highcharts connues ; au plus 250 pays et terres hors jeu ; il avertit
au-delà de 1,3 million de cases.
Géographie : il refait le calcul de `geo.rs` (contours remplis dans l'ordre des codes, trous bouchés, lacs, terres hors
jeu) et compare à sa grille de départ (moins de 2 % d'écart) ; chaque place est dans la case de son pays et dans le
cadre ; une capitale par pays, au moins 3 places ; pas de doublon « nom|pays » ; populations entières positives ; un port
est à moins de 25 km de la mer, d'un lac ou d'un fleuve ; aucun point habité à plus de 150 km d'une place de son pays ;
fleuves dans le cadre, finis à la mer, à un lac, à un confluent ou au bord du cadre ; époques : place connue, 4 à 8 points
de 1700 à 1900, 1790 = 1, étiquettes du jeu ; pays : clés de `mods` lues par le moteur, capitale existante, couleurs
distinctes entre voisins, chaque pays a un territoire ; nombre de places entre les bornes de `places` ; les fichiers
relus comme du JSON.

## Ajouter un théâtre

1. Côté données : `outils/theatres/<id>/carte.mjs`, `villes.json`, `epoques.json` ; l'`id` et son numéro dans la table
   `THEATRES` de `outils/theatre.mjs` (initiale des codes de pays).
2. `node outils/theatre.mjs <id> /tmp/theatres-src/node_modules --sortie /tmp/sortie-<id> --apercu /tmp/<id>.svg` jusqu'à
   ce qu'il ne signale plus rien, puis sans `--sortie` pour écrire dans `game/data`. Une carte régionale
   Natural Earth en plus (`ne_10m_rivers_north_america`…) : la télécharger dans `natural-earth` et la nommer dans `NE`.
3. Côté moteur : une ligne dans la table des théâtres du moteur (numéro de géographie, fichiers), puis recompiler.

## Dans le jeu

Le moteur Rust embarque les fichiers à la compilation (`include_str!` : `geo.rs`, `rules.rs`) : après un lancement de
l'outil, on recompile. La carte du jeu (géographie 5 pour l'Europe, `GeoMap::new(5)`) se refait alors toute seule, en
4 s environ : l'empreinte de son cache `game/data/map_cache_v5.json` suit `europe.json` et `places_europe.json`. Quand
c'est le calcul de la carte qui change (relief, végétation, routes : `geo.rs`), on augmente `GEN_THEATRE` (geo.rs : il refait le cache de tous les théâtres).
`cargo test -p conquete --test europe` vérifie la carte, les pays et les trajectoires de l'Europe.

## Ce qui est écrit dans le moteur, pas dans les données (Europe)

Les noms des familles culturelles du moteur (`CULTURES`) sont dans `rust/conquete/src/rules.rs` (les moyens et les maisons
d'Europe y sont aussi, `MOYENS_EUROPE` et `MAISONS_EUROPE`, recopiés dans `outils/theatres/europe/carte.mjs`) ; les bacs
nommés des détroits (`BACS_5`, Grand et Petit Belt, Øresund) dans `geo.rs`, les traversées de mer connues (`MERS_5`,
Stockholm – Mariehamn – Åbo, Kiel – Copenhague, Stralsund – Ystad) dans `waterways.rs`. Un nom de place qui change dans
`outils/theatres/europe/villes.json` doit y être changé aussi (les essais de `tests/europe.rs` le signalent).
