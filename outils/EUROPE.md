# Carte du mode « Europe » (SPEC-FRANCE.md, étape 2)

`node outils/europe.mjs <dossier node_modules> [--apercu carte.svg]` écrit dans `game/data` :
`europe.json` (même forme que `geo.json` : pays dans `depts`, `rivers`, `waters`, `lands`), `places_europe.json`
(comme `places_france.json`), `pays_europe.json` (un objet par pays, les clés de `FACTIONS`) et `epoques_europe.json`
(`"Nom|PAYS": [[année, population / population de 1790, étiquette], …]`). Deux lancements donnent les mêmes fichiers.

## Dossier de travail (hors du dépôt)

```sh
mkdir -p /tmp/europe-src && cd /tmp/europe-src && npm init -y
npm i world-atlas@2.0.2 @highcharts/map-collection@2.3.3 all-the-cities@3.1.0
mkdir natural-earth && cd natural-earth
for f in ne_10m_rivers_lake_centerlines ne_10m_rivers_europe ne_10m_lakes ne_10m_lakes_europe; do
  curl -sSO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/$f.geojson
done
node outils/europe.mjs /tmp/europe-src/node_modules --apercu /tmp/europe-apercu.svg   # depuis le dépôt
```

Le dossier `natural-earth` est cherché à côté de `node_modules`.

## Sources (crédits)

- Natural Earth (domaine public) : pays à 10 m (`world-atlas` 2.0.2), fleuves et lacs à 10 m (dépôt
  `nvkelso/natural-earth-vector`, v5.1.2).
- Highcharts Map Collection 2.3.3 (déjà utilisée pour la France) : régions d'Allemagne, d'Italie, de Pologne, d'Ukraine,
  de Croatie, de Grèce, de Roumanie, de Serbie, départements français.
- GeoNames (CC BY 4.0), par `all-the-cities` 3.1.0 : coordonnées des villes, bourgs de complément.
- Aucune donnée d'un autre jeu. Frontières de 1700-1750, populations de 1790 et de 1700 à 1900, caractère des pays :
  écrits à la main, de mémoire (ordres de grandeur de Bairoch et de De Vries, recensements) : des estimations.

## Ce qui s'édite à la main

- `outils/europe/villes.json` : par pays, « nom français | nom GeoNames ou @lat,lon | milliers d'habitants en 1790 |
  étiquettes | remparts ». La première ligne est la capitale.
- `outils/europe/epoques.json` : populations en milliers de 1700 à 1900 ; la valeur de 1790 est celle de `villes.json`.
- En tête de `outils/europe.mjs` : `ENTIERS` et `COUPES` (quel pays d'aujourd'hui, quelle région va à quel pays d'époque),
  `DETROITS`, `FLEUVES`, `PAYS`.

## Ce que l'outil vérifie (il s'arrête au premier défaut)

Il refait le calcul de `geo.rs` à 5 km (contours remplis dans l'ordre des codes, trous bouchés, lacs, terres hors jeu) et
compare à sa grille de départ (moins de 2 % d'écart) ; chaque place est dans la case de son pays et dans le cadre ; une
capitale par pays, au moins 3 places ; pas de doublon « nom|pays » ; populations entières positives ; un port est à moins
de 25 km de la mer, d'un lac ou d'un fleuve ; aucun point habité à plus de 150 km d'une place de son pays ; fleuves dans
le cadre, finis à la mer, à un lac, à un confluent ou au bord du cadre ; époques : place connue, 4 à 8 points de 1700 à
1900, 1790 = 1, étiquettes du jeu ; pays : clés de `mods` lues par le moteur, capitale existante, couleurs distinctes
entre voisins ; 900 à 1 400 places ; les quatre fichiers relus comme du JSON.

## Dans le jeu

Le moteur Rust embarque les quatre fichiers à la compilation (`include_str!` : `geo.rs`, `rules.rs`) : après un
lancement de l'outil, on recompile. La carte du jeu (géographie 5, `GeoMap::new(5)`) se refait alors toute seule, en
4 s environ : l'empreinte de son cache `game/data/map_cache_v5.json` suit `europe.json` et `places_europe.json`. Quand
c'est le calcul de la carte qui change (relief, végétation, routes : `geo.rs`), on augmente `GEN_EUROPE`.
`cargo test -p conquete --test europe` vérifie la carte, les pays et les trajectoires.

## Ce qui est écrit dans le moteur, pas dans les données

Les moyens de départ des pays (armée de paix réelle à chaque début, trésor : `MOYENS_EUROPE`), leurs maisons
(`MAISONS_EUROPE`) et les noms de leurs familles culturelles (`CULTURES`) sont dans `rust/conquete/src/rules.rs` ; les
bacs nommés des détroits (`BACS_5`, Grand et Petit Belt, Øresund) dans `geo.rs`, les traversées de mer connues
(`MERS_5`, Stockholm – Mariehamn – Åbo, Kiel – Copenhague, Stralsund – Ystad) dans `waterways.rs`. Un nom de place qui
change dans `outils/europe/villes.json` doit y être changé aussi (les essais de `tests/europe.rs` le signalent). Un pays
ajouté à `PAYS` doit entrer dans `MOYENS_EUROPE` et `MAISONS_EUROPE` (sans quoi il part avec les moyens d'un département).
