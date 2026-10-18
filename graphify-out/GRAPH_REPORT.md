# Graph Report - web_conquete  (2026-10-18)

## Corpus Check
- 78 files · ~310,164 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 2, .bat 2, .css 2)

## Summary
- 2650 nodes · 6361 edges · 122 communities (82 shown, 40 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 228 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `df847f25`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- esc
- AI
- troupes.js
- Controls
- turns.py
- BattleView
- bridge.py
- MapView
- Game
- BattleUI
- TacticalBattle
- server.py
- Ambient
- map.js
- Terrain
- math
- ._update_unit
- ._fire
- army_actions.py
- units.py
- partie
- decor.js
- simulation.mjs
- vue.js
- fabrique.py
- Relief
- qualite.js
- _think_field
- _d2
- terrain.py
- Effects
- tactics/ai.py
- skirmish.py
- .grow_population
- _bayonets
- interface.test.mjs
- test_serveur.py
- cities.py
- diplomacy.py
- rules.py
- textures.js
- terrain.js
- formes.js
- GeoMap
- unites.js
- bilan.py
- TownArt
- capture.mjs
- place
- cuire.mjs
- _note
- ArriveeDevantUneVille
- closed_to
- battle_log.py
- modeles.test.mjs
- gestes.js
- clamp
- options
- bfx
- slots
- Http
- ui.js
- Décisions d'architecture
- land_tick
- engine.py
- README web_conquete (Conquête : Aquitaine 1700-1899)
- UI
- Spec : tour par tour à la Total War (tour des IA d'un coup, villes prises pendant le tour, le temps en tours)
- _decide_withdraw
- fanions.js
- Liste des tâches (étape 7)
- choose
- jouer_mois
- geo.py
- check
- fire
- node_view
- Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md)
- ai_policies
- canvas
- .constructor
- test_campagne.py
- views.py
- Visites
- au
- .armyPanel
- icon-180.png (app icon, 180px)
- lancer.sh
- Événements historiques à choix (une trentaine, 1701-1898)
- Banc d'essai de la bataille (banc.html)
- Saisons et météo (trois zones)
- Terrain, marche à travers champs et embuscades
- Unités, intendance et prisonniers
- EcheancesEnTours
- college_k
- events.py
- .enter
- Bancs d'essai (tests/lancer.py, fabrique.py)
- .test_un_evenement_n_efface_pas_une_dette
- waterways.py
- Liste des tâches (étape 6)
- BattleMap
- Troops
- .clampCam
- suivre.js
- .cropMask
- Décision 9 : ombres de contact instanciées sous chaque figurine

## God Nodes (most connected - your core abstractions)
1. `Game` - 192 edges
2. `TacticalBattle` - 113 edges
3. `clamp()` - 104 edges
4. `UI` - 96 edges
5. `MapView` - 77 edges
6. `AI` - 54 edges
7. `esc()` - 50 edges
8. `partie()` - 46 edges
9. `BattleUI` - 46 edges
10. `BattleView` - 41 edges

## Surprising Connections (you probably didn't know these)
- `État (18/10/2026)` --references--> `ArriveeDevantUneVille`  [INFERRED]
  SPEC-TOURS.md → tests/test_campagne.py
- `Étape 2 : les troupes` --references--> `layout()`  [INFERRED]
  tasks/todo-3d.md → web/js/battle/troupes.js
- `Phase 2 : l'écran` --references--> `arrive()`  [INFERRED]
  tasks/todo-arrivee.md → game/army_actions.py
- `Décisions d'architecture` --references--> `negotiate()`  [INFERRED]
  tasks/plan-arrivee.md → game/army_actions.py
- `Décisions d'architecture` --references--> `contribution()`  [INFERRED]
  tasks/plan-arrivee.md → game/army_actions.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Architecture du rendu 3D des batailles (décisions 1 à 6)** — tasks_plan_view_api_preserved, tasks_plan_two_canvas, tasks_plan_ground_tiles_lod, tasks_plan_instanced_troops, tasks_plan_smoke_billboards, tasks_plan_lambert_lighting [EXTRACTED 1.00]
- **Modes de résolution des batailles** — readme_manual_battles, readme_auto_resolution, readme_finish_auto, readme_battle_mode [EXTRACTED 1.00]
- **Étape 6 : refonte de l'allure façon Ultimate General** — spec_3d_step6_ug_rendering, spec_3d_rounded_soldiers, spec_3d_far_lod, spec_3d_filmic_lighting, spec_3d_relief_crops, spec_3d_ground_colors, spec_3d_worn_paths, spec_3d_tufted_trees [EXTRACTED 1.00]
- **Pages de développement du mode Bataille** — web_js_battle_dev_banc_banc, web_js_battle_dev_banc_bataille [INFERRED 0.75]
- **Tutoriel interactif de campagne** — spec_interactive_tutorial, spec_tutorial_steps_as_data, spec_tutorial_per_device, web_index_tuto_bubble, web_js_tuto, web_js_ui [INFERRED 0.85]

## Communities (122 total, 40 thin omitted)

### Community 0 - "esc"
Cohesion: 0.15
Nodes (5): esc(), partTour(), toursTxt(), fmt(), fmt1()

### Community 2 - "troupes.js"
Cohesion: 0.11
Nodes (41): Soldats arrondis construits par le code (sans glTF), tricorne relevé, Troupes en InstancedMesh animées dans le vertex shader (texture de données), Décision 7 : modèles arrondis par le code (LatheGeometry, CapsuleGeometry, mêmes os), T19 : fantassins arrondis et taille (×1,6 gardé), T20 : chevaux, cavaliers, canons, caissons arrondis, T6 : fantassins 3D, T7 : cavaliers, chevaux, état-major, T8 : batteries, servants, caissons, chariots (+33 more)

### Community 4 - "turns.py"
Cohesion: 0.05
Nodes (35): _accumulate(), advance(), begin_turn(), _candidates(), command(), deadline(), eta(), finish() (+27 more)

### Community 6 - "bridge.py"
Cohesion: 0.05
Nodes (30): army_locked(), army_tick(), _att_angle(), auto_battle_tick(), battle_view(), campaign_tick(), command(), default_deploy() (+22 more)

### Community 7 - "MapView"
Cohesion: 0.10
Nodes (3): b64(), MapView, roundRect()

### Community 10 - "BattleUI"
Cohesion: 0.10
Nodes (6): fmt(), BattleUI, hourOf(), short(), speedSvg(), svg()

### Community 14 - "server.py"
Cohesion: 0.08
Nodes (14): auto_update(), version(), banner(), _git(), _git_env(), GzipCache, is_headless(), is_raspberry() (+6 more)

### Community 15 - "Ambient"
Cohesion: 0.14
Nodes (5): along(), Ambient, frac(), polyline(), T

### Community 17 - "map.js"
Cohesion: 0.10
Nodes (20): Commandes souris, doigt et stylet, Interface web (HTML/CSS/JS, rendu canvas de la carte), CLS_ORDER, darken(), fmtMen(), LEVELS, lighten(), mix() (+12 more)

### Community 18 - "Terrain"
Cohesion: 0.10
Nodes (6): Décisions d'architecture, vnoise(), chaikin(), offsetPts(), strokePts(), Terrain

### Community 19 - "math"
Cohesion: 0.11
Nodes (19): _at(), _best_depth(), _cover_spot(), _deploy_field(), _deploy_place_att(), _deploy_place_def(), _flank_fire_spot(), _gun_spot() (+11 more)

### Community 23 - "army_actions.py"
Cohesion: 0.08
Nodes (18): blockade_tick(), bombard(), breach(), cell_mask(), closed_msg(), defenders(), extra_food(), force_passage() (+10 more)

### Community 24 - "units.py"
Cohesion: 0.10
Nodes (11): ammo0_of(), cls_of(), footprint(), from_reg(), general(), milice(), pieces(), ranges() (+3 more)

### Community 25 - "partie"
Cohesion: 0.15
Nodes (5): armee(), partie(), ActionsEnTours, jouer_reste(), TourParTour

### Community 26 - "decor.js"
Cohesion: 0.10
Nodes (17): Arbres en touffes arrondies, bois au toit bosselé, Décision 12 : couronnes en 3 à 5 touffes d'icosaèdres, deux versions par zone (750 m), T12 : arbres instanciés, T13 : maisons, église, moulins, ponts, portes, T14 : remparts, brèches, tranchées, haies, T27 : arbres touffus, troupes visibles dans les bois, Builder, clearable() (+9 more)

### Community 27 - "simulation.mjs"
Cohesion: 0.08
Nodes (26): battles, get(), here, JEU, json(), proxy(), server, TYPES (+18 more)

### Community 28 - "vue.js"
Cohesion: 0.17
Nodes (21): L'entrée : champ de bataille en 3D (sol peint, blé en relief, figurines, fanions), Vue de bataille 3D web/js/battle (Three.js), Repère : x→X, y (sud)→Z, altitude→Y, 1 m = 1 unité, toWorld par marche de rayon sur l'altitude, T2 : caméra orbitale et ses bancs, T4 : gestes, tracés au sol, mini-carte, cams, vp (+13 more)

### Community 29 - "fabrique.py"
Cohesion: 0.14
Nodes (8): avancer(), bataille(), ennemi(), face_a_face(), kind(), ordre(), BatailleEntiere, OrdresParArme

### Community 30 - "Relief"
Cohesion: 0.12
Nodes (5): cloudTexture(), Decals, Relief, ticks(), paintDecal()

### Community 31 - "qualite.js"
Cohesion: 0.12
Nodes (14): Résolution automatique des batailles, Objectif ≥ 30 images/s sur iPad 2019 en qualité Haute, T16 : qualité, mesure, sans WebGL 2, appareil(), devine(), ecoutes, lire(), onQualite() (+6 more)

### Community 32 - "_think_field"
Cohesion: 0.12
Nodes (14): _advance(), _clamp(), _einf(), _fine_halt(), _flank_group(), _foe_dist(), _front_dep(), _march_form() (+6 more)

### Community 33 - "_d2"
Cohesion: 0.13
Nodes (15): _apply(), _art_target(), _artillery(), _cav_near(), _d2(), _fetch(), _form(), _goto() (+7 more)

### Community 34 - "terrain.py"
Cohesion: 0.09
Nodes (27): _add_bridge(), _barricades(), bfs(), blur(), cell_of(), center_of(), _clip_poly(), _densify() (+19 more)

### Community 35 - "Effects"
Cohesion: 0.17
Nodes (5): Lumière douce : courbe filmique, ombres teintées, ombres de contact, Décision 10 : NeutralToneMapping, ombres PCF douces, ciel plus fort, sans post-traitement, T22 : courbe filmique, soleil, ciel, ombres douces, Effects, mix3()

### Community 36 - "tactics/ai.py"
Cohesion: 0.16
Nodes (15): _adopt(), _adopt_unit(), _announced(), _cat(), _choose_plan(), _counter_charge(), deploy(), _groups() (+7 more)

### Community 37 - "skirmish.py"
Cohesion: 0.14
Nodes (12): _count(), _foe_units(), _fort(), _local(), new(), _open_ground(), options(), _pick_season() (+4 more)

### Community 39 - "_bayonets"
Cohesion: 0.11
Nodes (13): _ang(), _bayonets(), _cav_target(), _cavalry(), _charge_ok(), _foe(), _gun_front(), _gun_zones() (+5 more)

### Community 40 - "interface.test.mjs"
Cohesion: 0.05
Nodes (36): installer.sh script, Sauvegarde automatique au début de chaque mois (saves/), Brouillard de guerre et espions, Récapitulatif du mois, Service systemd web_conquete sur Raspberry Pi (iPad comme écran), Temps réel avec pause (réglage avancé), Tutoriel à bulles (premiers pas, armes en bataille), Spec : tutoriel interactif (campagne et bataille) (+28 more)

### Community 42 - "cities.py"
Cohesion: 0.10
Nodes (13): _fill(), _hilly(), local_ok(), prestige(), _river(), _troops(), upkeep(), _w_crue() (+5 more)

### Community 43 - "diplomacy.py"
Cohesion: 0.19
Nodes (13): act(), ai_evaluate(), answer(), apply(), declare_war(), exchange_prisoners(), held(), lost_nodes() (+5 more)

### Community 45 - "rules.py"
Cohesion: 0.11
Nodes (9): de(), nb(), num(), pl(), pop_curve(), _rural(), _town(), Généraux, formations et plans de bataille (3 phases) (+1 more)

### Community 46 - "textures.js"
Cohesion: 0.26
Nodes (20): Couleurs du sol : blé or doux, teintes par parcelle, herbe variée, T24 : couleurs du sol, hash(), hexRgb(), blade(), CROP, css(), CULTURES (+12 more)

### Community 47 - "terrain.js"
Cohesion: 0.14
Nodes (17): Sol peint par terrain.js posé sur le relief 3D, Chemins larges et usés (ornières, herbe au milieu), Tuiles de texture du sol selon la distance à la caméra, Lumière Lambert, soleil selon l'heure, onBeforeCompile du sol, Deux canevas : WebGL dessous, calque 2D dessus (fanions, gestes, tracés, pluie), T11 : lumière, ciel, brume, météo, T25 : chemins larges et usés, T3 : vue WebGL, relief, régiments en blocs, calque 2D (+9 more)

### Community 48 - "formes.js"
Cohesion: 0.13
Nodes (31): ACTIONS, actionsOf(), aide, arme(), armeOf(), FIRE_MODES, ORDER_LABEL, ordresHtml() (+23 more)

### Community 50 - "GeoMap"
Cohesion: 0.06
Nodes (3): GeoMap, App, Handler

### Community 51 - "unites.js"
Cohesion: 0.20
Nodes (8): OMBRE, TILT, dark(), headgear(), HORSES, lite(), pen(), UnitArt

### Community 52 - "bilan.py"
Cohesion: 0.19
Nodes (12): load(), main(), mean(), mean100(), num(), pct(), ratio(), table() (+4 more)

### Community 53 - "TownArt"
Cohesion: 0.21
Nodes (4): Carte vivante : villes en vue cavalière et animations d'ambiance, shade(), STYLE, TownArt

### Community 54 - "capture.mjs"
Cohesion: 0.10
Nodes (13): Capture d'écran par Chromium sans écran (dev/capture.mjs), Banc d'essai simulé (dev/maquette.mjs, banc.html, cinq scénarios), Stratégie de test 3D (bancs Node, captures, essai à la main), argv, chrome, errors, here, js (+5 more)

### Community 55 - "place"
Cohesion: 0.13
Nodes (23): aa(), ai_step(), command(), end_garde(), fortify(), garde(), garde_info(), neg_tick() (+15 more)

### Community 56 - "cuire.mjs"
Cohesion: 0.07
Nodes (46): AIM(), arm(), BAYONET(), BUTT, CLIPS, copy(), DOWN, drum() (+38 more)

### Community 57 - "_note"
Cohesion: 0.18
Nodes (12): _aim_breach(), _breaches(), _foe_est(), _heavy(), _hour(), _note(), _roles_update(), _set_phase() (+4 more)

### Community 59 - "closed_to"
Cohesion: 0.14
Nodes (8): ai_passage(), closed_owners(), closed_to(), eval_passage(), has_passage(), may_stay(), revoke_passage(), view_passage()

### Community 60 - "battle_log.py"
Cohesion: 0.24
Nodes (6): campaign_end(), _regs(), skirmish_end(), snapshot(), tactical(), write()

### Community 62 - "modeles.test.mjs"
Cohesion: 0.11
Nodes (14): Version simple de loin (deux modèles par figurine, mêmes animations), Charge graphique : triangles ≤ départ + 10 % (renderer.info), Décision 13 : mesure des triangles (renderer.info) sur trois vues types bocage, Décision 8 : deux versions par figurine, choix par régiment selon la hauteur à l'écran, T18 : banc des modèles, relevé de charge de départ, T21 : version simple de loin (seuils 18/14 px, régiments hors champ non dessinés), FOOT, HORSE (+6 more)

### Community 63 - "gestes.js"
Cohesion: 0.11
Nodes (33): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7e : vue de loin, homme(), ligne, meta, servant() (+25 more)

### Community 65 - "options"
Cohesion: 0.18
Nodes (11): ai_siege(), blockade(), cd_left(), clamp(), contribution(), ctb_info(), force_ratio(), foreign_place() (+3 more)

### Community 66 - "bfx"
Cohesion: 0.24
Nodes (9): _add(), bfx(), growth_k(), node_extra(), pfx(), stab_bonus(), train_k(), train_xp() (+1 more)

### Community 67 - "slots"
Cohesion: 0.21
Nodes (8): demolish(), finish(), level_name(), migrate(), _milice(), slot_build(), slots(), sync()

### Community 69 - "ui.js"
Cohesion: 0.13
Nodes (15): coat(), ICON, speedIcon(), ACTION_LABEL, BRANCH_LABEL, fmt2(), hab(), minus() (+7 more)

### Community 70 - "Décisions d'architecture"
Cohesion: 0.13
Nodes (13): arrive(), asks(), Décisions d'architecture, Graphe des dépendances, Liste des tâches, Phase 1 : le moteur, Phase 2 : l'écran, Plan : choisir à l'arrivée devant une ville (SPEC-TOURS.md, « Évolution du 18/10/2026 ») (+5 more)

### Community 71 - "land_tick"
Cohesion: 0.17
Nodes (6): crossed(), incident(), land_owner(), land_tick(), trespassed(), way_out()

### Community 72 - "engine.py"
Cohesion: 0.12
Nodes (8): ordinal(), ball_k(), grape_k(), Mode Bataille sans campagne (skirmish.py), Finir automatiquement (IA des officiers en accéléré), Batailles manuelles en temps réel avec pause (game/tactics), Impôts, ordre public et révoltes, Écran d'accueil #start et chargement

### Community 73 - "README web_conquete (Conquête : Aquitaine 1700-1899)"
Cohesion: 0.10
Nodes (25): README web_conquete (Conquête : Aquitaine 1700-1899), Technologies datées et armement par époque (réarmement), Cinq départements / provinces d'Aquitaine, Économie : ressources, minimum garanti, spécialités, Époques et départs 1700/1790/1813/1870, INSEE via @etalab/decoupage-administratif, france-geojson (IGN, Licence Ouverte), Natural Earth (fleuves et lacs) (+17 more)

### Community 75 - "Spec : tour par tour à la Total War (tour des IA d'un coup, villes prises pendant le tour, le temps en tours)"
Cohesion: 0.09
Nodes (21): Boundaries, Code Style, Commandes, Critères de réussite, Critères de réussite, Décisions prises, Décisions (validées le 18/10/2026), Fichiers touchés (+13 more)

### Community 76 - "_decide_withdraw"
Cohesion: 0.20
Nodes (5): _body(), _decide_withdraw(), _history(), _stalled(), _tenacity()

### Community 77 - "fanions.js"
Cohesion: 0.29
Nodes (10): LIFT(), banner(), drawBanners(), lite(), medallion(), men(), picto(), genName() (+2 more)

### Community 79 - "Liste des tâches (étape 7)"
Cohesion: 0.09
Nodes (22): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7d : mêlée et charges, 7e : vue de loin, 7f : scène, Graphe des dépendances, Graphe des dépendances (+14 more)

### Community 80 - "choose"
Cohesion: 0.14
Nodes (12): ask_alive(), ask_choices(), asking(), choose(), conquer(), pose(), resume(), strong() (+4 more)

### Community 81 - "jouer_mois"
Cohesion: 0.18
Nodes (3): jouer_mois(), Production, RechercheEtPolitiques

### Community 82 - "geo.py"
Cohesion: 0.15
Nodes (8): fbm(), _h(), _seg_inter(), slugify(), vnoise(), Recherche de chemin A* avec terres interdites, Diplomatie et commerce, Cache de carte game/data/map_cache.json

### Community 83 - "check"
Cohesion: 0.20
Nodes (6): ai_build(), _ai_value(), check(), fits(), level_tech(), slot_count()

### Community 84 - "fire"
Cohesion: 0.29
Nodes (5): apply_local(), fire(), stats(), tick(), tours_of()

### Community 85 - "node_view"
Cohesion: 0.24
Nodes (8): describe_local(), fx_text(), _n(), node_view(), _pct(), per_k(), per_txt(), rules_payload()

### Community 89 - "Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md)"
Cohesion: 0.17
Nodes (11): 7d : mêlée et charges, 7f : scène, Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md), Étape 1 : la bataille se joue en 3D (régiments en blocs), Étape 2 : les troupes, Étape 3 : le feu et l'atmosphère, Étape 4 : le décor, Étape 5 : finitions (+3 more)

### Community 90 - "ai_policies"
Cohesion: 0.25
Nodes (5): ai_policies(), policy_w(), set_policy(), _set_policy(), _trading()

### Community 91 - "canvas"
Cohesion: 0.46
Nodes (6): Fumées en quads instanciés face à la caméra, T10 : fumées, éclairs, boulets, éclats, poussière, flashSprite(), glowSprite(), puffSprite(), canvas()

### Community 92 - ".constructor"
Cohesion: 0.20
Nodes (4): T15 : ombres portées, Mesure, profil(), loadAnims()

### Community 93 - "test_campagne.py"
Cohesion: 0.22
Nodes (3): Sauvegarde, SiegesEnTours, TempsReel

### Community 95 - "views.py"
Cohesion: 0.13
Nodes (12): _effects(), from_dict(), _gen(), _legs(), migrate(), _order(), player_state(), _popy() (+4 more)

### Community 96 - "Visites"
Cohesion: 0.22
Nodes (3): hote_permis(), Visites, Connexions

### Community 100 - "icon-180.png (app icon, 180px)"
Cohesion: 1.00
Nodes (4): icon-180.png (app icon, 180px), icon-192.png (app icon, 192px), icon-512.png (app icon, 512px), Heraldic shield with five vertical color stripes, cream star and year 1790 on navy background

### Community 109 - "college_k"
Cohesion: 0.40
Nodes (3): college_k(), daily(), research()

### Community 110 - "events.py"
Cohesion: 0.23
Nodes (11): affordable(), apply(), describe(), expire(), _fill(), fire(), _ord(), _pct() (+3 more)

### Community 111 - ".enter"
Cohesion: 0.26
Nodes (5): Bataille, ensureStyle(), hasGL2(), wait(), waitFor()

### Community 114 - "waterways.py"
Cohesion: 0.24
Nodes (7): build(), add(), downstream(), piece(), _cut(), _project(), _seglen()

### Community 115 - "Liste des tâches (étape 6)"
Cohesion: 0.22
Nodes (9): 6a et 6b : figurines, 6c : lumière et couleurs, 6d : sol, 6e : arbres et fin, Décisions d'architecture, Liste des tâches (étape 6), Questions ouvertes (étape 6), Risques et parades (étape 6) (+1 more)

### Community 117 - "Troops"
Cohesion: 0.22
Nodes (5): flagPattern(), pushOf(), seedOf(), Troops, turn()

### Community 121 - ".clampCam"
Cohesion: 0.20
Nodes (7): Comment c'est fait (décisions 14 à 22 du plan, en bref), Décisions qui t'attendent, Où on en est (18/10/2026), Pièges rencontrés, Points de la revue laissés de côté (et pourquoi), Reprendre, Étape 7 : où on en est et ce qui reste (point du 18/10/2026)

### Community 122 - "suivre.js"
Cohesion: 0.29
Nodes (5): foes, id, mine, t, w

### Community 124 - ".cropMask"
Cohesion: 0.83
Nodes (3): Cultures en relief près de la caméra (épis qui ondulent, ~300 m), Décision 11 : cultures en relief par coquilles empilées et masque de végétation, T26 : cultures en relief

### Community 125 - "Décision 9 : ombres de contact instanciées sous chaque figurine"
Cohesion: 1.00
Nodes (3): Décision 9 : ombres de contact instanciées sous chaque figurine, T23 : ombres de contact, CONTACT

## Ambiguous Edges - Review These
- `Polices Google Fonts (EB Garamond, IM Fell English)` → `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)`  [AMBIGUOUS]
  web/index.html · relation: conceptually_related_to

## Knowledge Gaps
- **16 isolated node(s):** `Événements historiques à choix (une trentaine, 1701-1898)`, `Classe Bataille (bataille.js)`, `Banc d'essai de la bataille (banc.html)`, `Saisons et météo (trois zones)`, `Terrain, marche à travers champs et embuscades` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 754 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **40 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Game` connect `Game` to `AI`, `skirmish.py`, `.grow_population`, `engine.py`, `.move_army`, `test_serveur.py`, `.log`, `.choose_tactics`, `.__init__`, `server.py`, `.mod`, `GeoMap`, `.update_battles`, `.owned_nodes`, `partie`, `fabrique.py`, `views.py`?**
  _High betweenness centrality (0.185) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Game` (e.g. with `AI` and `from_dict()`) actually correct?**
  _`Game` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Événements historiques à choix (une trentaine, 1701-1898)`, `Classe Bataille (bataille.js)`, `Banc d'essai de la bataille (banc.html)` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AI` be split into smaller, more focused modules?**
  _Cohesion score 0.05570611261668172 - nodes in this community are weakly interconnected._
- **Why does `TacticalBattle` connect `TacticalBattle` to `bridge.py`, `engine.py`, `.cell`, `.order`, `._update_unit`, `._fire`, `.log`, `.trait`, `._rally_k`, `.step`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Should `troupes.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11295681063122924 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Polices Google Fonts (EB Garamond, IM Fell English)` and `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._