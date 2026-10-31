# Spec : les villes organiques en bataille, en siège et sur la carte (31/10/2026)

État : **validée le 31/10/2026** (« fais tout d'un coup »). Suite de `web/js/carte/plan-organique.js` (villes organiques de la carte, 30/10/2026).

## Objectif

Une bataille ou un siège dans une ville se joue sur **les mêmes rues, îlots et enceinte** que ceux de la carte de
campagne. Ce qui lit encore l'ancien plan en anneaux sur la carte (marché des passants, réverbères, lieux de la
guerre) passe au plan organique.

## Choix du joueur (questionnaire du 31/10/2026)

- Mêmes rues et îlots que la carte (même graine), pas seulement le même style.
- Batailles en ville, sièges et passants de la carte.
- Édifices (église, cathédrale, couvent, caserne, hôpital, hôtels, halle, château) placés sur les îlots organiques,
  avec les dégâts sur des îlots à n côtés.
- **Toutes les sauvegardes passent au nouveau plan** : plus de versions figées pour les villes. Les anciennes
  sauvegardes peuvent être supprimées : aucune reprise d'une bataille en cours n'est prévue.

## Ce qui existe (rapport du 31/10)

- `genererPlan(v, eau, urbain)` (plan-organique.js:147) est pur et déterministe : aucun import, aucun DOM, hasard
  tiré de `v.graine` (`hash`, `bruit`, `alea`). Ses entrées sont faites par `planOrganique` (villes.js:493-529) à
  partir de `K.m.edges`, `K.m.rivers`, `eauK` et du profil de l'ancien plan (`R`, `rMur`, `sd`, citadelle, gare).
- Le serveur a déjà tout cela : `geo.py` donne les mêmes routes (après `_troncs`), `plan_ville.PV.Carte` les mêmes
  rivières et `eauK`, `plan_ville.py` le profil, au bit près (testé contre node, `tests/test_plan_ville.py`).
- La bataille (`terrain_ville.py`, `decor2d.js`) suppose partout des îlots **à 4 côtés** (`q`, `decaler_quad`,
  masque `cotes` sur 4 bits, centre `/4`).

## Décisions

1. **Port Python au bit près** : `game/tactics/plan_organique.py` porte `genererPlan` et la fabrique des entrées de
   `planOrganique` (axes autour de la ville, rivières, `enceinteCarte`, `eau`, `LARG_RIVIERE`), sur `jsmath.py` comme
   `plan_ville.py`. Un banc compare au JS sous node, comme `tests/plan_ville_js.mjs`. `plan_ville.py` reste pour le
   profil (rayon, enceinte, citadelle, gare, métiers).
2. **Îlots à n côtés en bataille** : `q` devient un polygone quelconque (le `bloc` organique), `cotes` une liste par
   côté (vrai si le côté donne sur une rue, un axe ou un quai, d'après `kinds`). Un seul retrait de polygone convexe
   remplace `decaler_quad`, côté serveur et côté client (`decor2d.js`). La bande de maisons (16 m) suit chaque côté
   sur rue.
3. **Les rues** : celles de la bataille sont les côtés des îlots de sorte rue ou axe (le milieu de l'espace entre deux
   blocs) ; les routes entrent par les axes. **Les portes** sont les croisements des axes avec `mur`.
4. **Les édifices** : une étape d'attribution après `genererPlan`, d'après le modèle de la ville comme aujourd'hui
   (plan_ville.py:357-500) : place, églises et jardin gardés tels que le plan les donne ; cathédrale sur le plus grand
   îlot près de la place ; couvents, hôpital, hôtels, casernes (près des portes) sur des îlots à leur taille ; halle
   sur la place, château pour le castrum. Ces rôles ne servent qu'en bataille : la carte garde les
   types d'îlots de son plan (place, églises, jardin).
5. **Les sièges** : l'enceinte de bataille est `mur.pts` (la même que la carte, `wallGeom`), bastions et demi-lunes
   compris quand la place est bastionnée ; brèches comme aujourd'hui (`terrain._enceinte`), sur ce polygone.
6. **La carte** : marché des passants (`vie.js:204`), réverbères (`ciel.js:270-305`), lieux et rayon des murs
   (`guerre.js:62`, `:903`, `towns.js:379`) lisent le plan organique (`planCartePas`).
7. **Versions** : `terrain.VERSION = 9`. Une bataille en ville de toute sauvegarde est refaite sur le nouveau plan ;
   on supprime `plan_ville_v4..v7`, `terrain_ville_v4..v7`, leurs branches dans `terrain.generate` et leurs tests
   (`crue.py` cesse d'importer `plan_ville_v5`). `terrain_v1` et les batailles hors ville ne changent pas.

## Risques

| Risque | Impact | Parade |
|---|---|---|
| Le port Python s'écarte du JS (bataille ≠ carte) | Haut | banc au bit près sous node sur les 40 villes, deux époques |
| Îlots à n côtés : maisons mal posées, côtés trop courts | Moyen | côté de moins de 12 m sans maisons ; captures des quatre modèles (bastide, port, grande ville, bourg) |
| Lenteur du plan côté serveur (Pi) | Moyen | cache par (ville, ère) comme `PV.plan` ; mesure sur le Pi |
| `eau` dépend encore de l'ancien plan (citadelle, gare) | Bas | gardé : `plan_ville.py` reste pour le profil |

## Critères de réussite

1. Pour chaque ville, la bataille montre la place, les rues et l'enceinte de la carte (banc au bit près + captures).
2. Siège : l'enceinte et ses brèches sont celles dessinées sur la carte.
3. Les tests passent (`python3 tests/lancer.py`), sans les versions figées supprimées.
4. Le marché, les réverbères et les lieux de la guerre sont dans les rues organiques.

## Hors périmètre

Les passants dans les rues (ils restent sur les routes, depuis les portes) ; la vue « Voir l'intérieur » (retirée) ;
les batailles hors ville.
