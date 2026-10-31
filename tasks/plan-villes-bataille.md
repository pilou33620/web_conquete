# Plan : les villes organiques en bataille (SPEC-VILLES-BATAILLE.md, validée le 31/10/2026)

Construction enchaînée (« fais tout d'un coup »), revue à la fin.

- [x] T1 : `game/tactics/plan_organique.py`, port au bit près de `genererPlan` (branches utiles : ères classique et
  industrielle, damier, mur imposé, `toutes`, `serre`, `gare: false`) et de la fabrique des entrées (`planOrganique`,
  `enceinteCarte`, `autour`, `LARG_RIVIERE`) ; banc contre node (`tests/plan_organique_js.mjs`, `tests/test_plan_organique.py`)
- [x] T2 : bataille sur îlots à n côtés : `terrain_ville.py` lit le plan organique (îlots, rues = côtés sur rue ou
  axe, portes = axes × mur) ; `decor2d.js` dessine des polygones quelconques
- [x] T3 : édifices attribués sur les îlots organiques (cathédrale, couvents, hôpital, hôtels, casernes, halle, château)
- [x] T4 : sièges : enceinte de bataille = `mur.pts`, brèches sur ce polygone
- [x] T5 : carte : marché (`vie.js`), réverbères (`ciel.js`), lieux et rayon des murs (`guerre.js`, `towns.js`)
- [x] T6 : `terrain.VERSION = 9`, suppression de `plan_ville_v4..v7`, `terrain_ville_v4..v7`, branches et tests ;
  `crue.py` sans `plan_ville_v5`
- [x] T7 : `python3 tests/lancer.py` (seuls les trois test_vite échouent sur le Pi, comme avant), README, revue (31/10)
- [ ] Ton avis sur une capture (rues de 20 m sur la grille : bourgs très pavés ?) ; graphe à mettre à jour
