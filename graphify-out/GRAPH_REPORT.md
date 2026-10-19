# Graph Report - web_conquete  (2026-10-19)

## Corpus Check
- 86 files · ~346,509 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 2, .bat 2, .css 2)

## Summary
- 2956 nodes · 7011 edges · 130 communities (88 shown, 42 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 288 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `22e1f41c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- UI
- AI
- troupes.js
- simulation.mjs
- turns.py
- BattleView
- bridge.py
- MapView
- Game
- .move_army
- BattleUI
- TacticalBattle
- server.py
- clamp
- map.js
- Terrain
- rails.py
- .cell
- ._fire
- army_actions.py
- units.py
- partie
- decor.js
- App
- vue.js
- fabrique.py
- Relief
- qualite.js
- _at
- _d2
- math
- Effects
- tactics/ai.py
- skirmish.py
- .grow_population
- _bayonets
- interface.test.mjs
- Sauvegardes
- cities.py
- diplomacy.py
- rules.py
- textures.js
- terrain.js
- formes.js
- GeoMap
- UnitArt
- VoiesFerrees
- TownArt
- capture.mjs
- options
- cuire.mjs
- _note
- ArriveeDevantUneVille
- closed_to
- battle_log.py
- avec
- modeles.test.mjs
- gestes.js
- Décisions d'architecture
- bfx
- slots
- Http
- .enter
- Plan : choisir à l'arrivée devant une ville (SPEC-TOURS.md, « Évolution du 18/10/2026 »)
- land_tick
- README web_conquete (Conquête : Aquitaine 1700-1899)
- simuler.py
- Décisions d'architecture
- Plan : batailles en 3D (SPEC-3D.md)
- choose
- jouer_mois
- geo.py
- check
- fire
- node_view
- Spec : les technologies et le rendu qui suit l'époque
- ai_policies
- canvas
- Propositions : les technologies et le rendu qui suit l'époque (1700-1899)
- Liste des tâches (étape 7)
- waterways.py
- test_campagne.py
- au
- .drawRails
- icon-180.png (app icon, 180px)
- lancer.sh
- Événements historiques à choix (une trentaine, 1701-1898)
- Banc d'essai de la bataille (banc.html)
- Saisons et météo (trois zones)
- Terrain, marche à travers champs et embuscades
- Unités, intendance et prisonniers
- fanions.js
- college_k
- events.py
- Étape 7 : où on en est et ce qui reste (point du 18/10/2026)
- Spec : batailles en 3D (style Ultimate General)
- .test_un_evenement_n_efface_pas_une_dette
- unites.js
- place
- Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1
- Troops
- À faire : technologies et rendu selon l'époque (point du 19/10/2026)
- create
- ArbreDesTechnologies
- SiegesEnTours
- suivre.js
- Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md)
- Mitrailleuses
- Équilibre de la campagne : avant et après les nouvelles technologies (18/10/2026)
- Renseignement
- DynamiteALAssaut

## God Nodes (most connected - your core abstractions)
1. `Game` - 196 edges
2. `TacticalBattle` - 115 edges
3. `clamp()` - 108 edges
4. `UI` - 100 edges
5. `MapView` - 81 edges
6. `partie()` - 78 edges
7. `AI` - 57 edges
8. `esc()` - 51 edges
9. `BattleUI` - 46 edges
10. `BattleView` - 41 edges

## Surprising Connections (you probably didn't know these)
- `Phase 2a : le train (plan : tasks/plan-tech.md, « Phase 2a »)` --references--> `eta()`  [INFERRED]
  tasks/todo-tech.md → game/turns.py
- `Décisions d'architecture` --references--> `a()`  [INFERRED]
  tasks/plan-tech.md → tests/interface.test.mjs
- `Stratégie de test` --references--> `arm()`  [INFERRED]
  SPEC-TECH.md → web/js/battle/dev/cuire.mjs
- `Étape 2 : les troupes` --references--> `layout()`  [INFERRED]
  tasks/todo-3d.md → web/js/battle/troupes.js
- `Phase 2 : l'écran` --references--> `arrive()`  [INFERRED]
  tasks/todo-arrivee.md → game/army_actions.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Architecture du rendu 3D des batailles (décisions 1 à 6)** — tasks_plan_view_api_preserved, tasks_plan_two_canvas, tasks_plan_ground_tiles_lod, tasks_plan_instanced_troops, tasks_plan_smoke_billboards, tasks_plan_lambert_lighting [EXTRACTED 1.00]
- **Modes de résolution des batailles** — readme_manual_battles, readme_auto_resolution, readme_finish_auto, readme_battle_mode [EXTRACTED 1.00]
- **Étape 6 : refonte de l'allure façon Ultimate General** — spec_3d_step6_ug_rendering, spec_3d_rounded_soldiers, spec_3d_far_lod, spec_3d_filmic_lighting, spec_3d_relief_crops, spec_3d_ground_colors, spec_3d_worn_paths, spec_3d_tufted_trees [EXTRACTED 1.00]
- **Pages de développement du mode Bataille** — web_js_battle_dev_banc_banc, web_js_battle_dev_banc_bataille [INFERRED 0.75]
- **Tutoriel interactif de campagne** — spec_interactive_tutorial, spec_tutorial_steps_as_data, spec_tutorial_per_device, web_index_tuto_bubble, web_js_tuto, web_js_ui [INFERRED 0.85]

## Communities (130 total, 42 thin omitted)

### Community 0 - "UI"
Cohesion: 0.06
Nodes (22): esc(), coat(), ICON, speedIcon(), partTour(), toursTxt(), ACTION_LABEL, BRANCH_LABEL (+14 more)

### Community 2 - "troupes.js"
Cohesion: 0.10
Nodes (48): Soldats arrondis construits par le code (sans glTF), tricorne relevé, Troupes en InstancedMesh animées dans le vertex shader (texture de données), Décision 7 : modèles arrondis par le code (LatheGeometry, CapsuleGeometry, mêmes os), T19 : fantassins arrondis et taille (×1,6 gardé), T20 : chevaux, cavaliers, canons, caissons arrondis, T6 : fantassins 3D, T7 : cavaliers, chevaux, état-major, T8 : batteries, servants, caissons, chariots (+40 more)

### Community 3 - "simulation.mjs"
Cohesion: 0.06
Nodes (30): centroid(), Controls, battles, get(), here, JEU, json(), proxy() (+22 more)

### Community 4 - "turns.py"
Cohesion: 0.05
Nodes (36): _accumulate(), advance(), begin_turn(), _candidates(), command(), deadline(), eta(), finish() (+28 more)

### Community 5 - "BattleView"
Cohesion: 0.14
Nodes (3): Décisions d'architecture, Pièges rencontrés, BattleView

### Community 6 - "bridge.py"
Cohesion: 0.06
Nodes (29): army_locked(), army_tick(), _att_angle(), auto_battle_tick(), battle_view(), campaign_tick(), command(), ensure() (+21 more)

### Community 7 - "MapView"
Cohesion: 0.10
Nodes (4): b64(), fmtMen(), MapView, roundRect()

### Community 10 - "BattleUI"
Cohesion: 0.12
Nodes (3): fmt(), BattleUI, speedSvg()

### Community 14 - "server.py"
Cohesion: 0.05
Nodes (18): auto_update(), version(), banner(), _git(), _git_env(), GzipCache, hote_permis(), is_headless() (+10 more)

### Community 15 - "clamp"
Cohesion: 0.14
Nodes (6): along(), Ambient, frac(), polyline(), T, clamp()

### Community 17 - "map.js"
Cohesion: 0.10
Nodes (19): Commandes souris, doigt et stylet, Interface web (HTML/CSS/JS, rendu canvas de la carte), CLS_ORDER, darken(), LEVELS, lighten(), mix(), PARTS (+11 more)

### Community 18 - "Terrain"
Cohesion: 0.10
Nodes (7): mixHex(), rgbStr(), vnoise(), chaikin(), offsetPts(), strokePts(), Terrain

### Community 19 - "rails.py"
Cohesion: 0.10
Nodes (20): by_town(), client_payload(), cost(), exits(), industry_k(), near_station(), network(), _on_section() (+12 more)

### Community 22 - "._fire"
Cohesion: 0.13
Nodes (3): ang_diff(), ball_k(), grape_k()

### Community 23 - "army_actions.py"
Cohesion: 0.09
Nodes (15): bombard(), cell_mask(), closed_msg(), extra_food(), force_passage(), force_question(), migrate(), names_of() (+7 more)

### Community 24 - "units.py"
Cohesion: 0.10
Nodes (11): ammo0_of(), cls_of(), footprint(), from_reg(), general(), milice(), pieces(), ranges() (+3 more)

### Community 25 - "partie"
Cohesion: 0.13
Nodes (6): armee(), partie(), ActionsEnTours, jouer_reste(), TempsReel, TourParTour

### Community 26 - "decor.js"
Cohesion: 0.09
Nodes (17): Arbres en touffes arrondies, bois au toit bosselé, Décision 12 : couronnes en 3 à 5 touffes d'icosaèdres, deux versions par zone (750 m), T12 : arbres instanciés, T13 : maisons, église, moulins, ponts, portes, T14 : remparts, brèches, tranchées, haies, T27 : arbres touffus, troupes visibles dans les bois, Builder, clearable() (+9 more)

### Community 28 - "vue.js"
Cohesion: 0.16
Nodes (21): Repère : x→X, y (sud)→Z, altitude→Y, 1 m = 1 unité, toWorld par marche de rayon sur l'altitude, Deux canevas : WebGL dessous, calque 2D dessus (fanions, gestes, tracés, pluie), T2 : caméra orbitale et ses bancs, T3 : vue WebGL, relief, régiments en blocs, calque 2D, T4 : gestes, tracés au sol, mini-carte, cams, vp (+13 more)

### Community 29 - "fabrique.py"
Cohesion: 0.09
Nodes (13): Bancs d'essai (tests/lancer.py, fabrique.py), avancer(), bataille(), ennemi(), face_a_face(), kind(), ordre(), BatailleEntiere (+5 more)

### Community 30 - "Relief"
Cohesion: 0.11
Nodes (7): Cultures en relief près de la caméra (épis qui ondulent, ~300 m), Décision 11 : cultures en relief par coquilles empilées et masque de végétation, T26 : cultures en relief, cloudTexture(), Decals, Relief, ticks()

### Community 31 - "qualite.js"
Cohesion: 0.11
Nodes (17): Résolution automatique des batailles, L'entrée : champ de bataille en 3D (sol peint, blé en relief, figurines, fanions), Objectif ≥ 30 images/s sur iPad 2019 en qualité Haute, T16 : qualité, mesure, sans WebGL 2, appareil(), devine(), ecoutes, lire() (+9 more)

### Community 32 - "_at"
Cohesion: 0.11
Nodes (18): _advance(), _at(), _cavalry(), _clamp(), _cover_spot(), _einf(), _fine_halt(), _flank_fire_spot() (+10 more)

### Community 33 - "_d2"
Cohesion: 0.11
Nodes (17): _apply(), _art_target(), _artillery(), _cav_near(), _d2(), _fetch(), _form(), _goto() (+9 more)

### Community 34 - "math"
Cohesion: 0.08
Nodes (29): _foe_dist(), _add_bridge(), _barricades(), BattleMap, bfs(), blur(), cell_of(), center_of() (+21 more)

### Community 35 - "Effects"
Cohesion: 0.16
Nodes (6): Phase 1 : bataille-armes, Phase 2a : le train (plan : tasks/plan-tech.md, « Phase 2a »), Tâches : les technologies et le rendu qui suit l'époque (SPEC-TECH.md, plan : tasks/plan-tech.md), Effects, pieces(), smokeless()

### Community 36 - "tactics/ai.py"
Cohesion: 0.10
Nodes (28): _adopt(), _adopt_unit(), _aim_breach(), _announced(), _breaches(), _cat(), _choose_plan(), deploy() (+20 more)

### Community 37 - "skirmish.py"
Cohesion: 0.14
Nodes (12): _count(), _foe_units(), _fort(), _local(), new(), _open_ground(), options(), _pick_season() (+4 more)

### Community 39 - "_bayonets"
Cohesion: 0.12
Nodes (12): _ang(), _bayonets(), _cav_target(), _charge_ok(), _counter_charge(), _foe(), _gun_front(), _gun_zones() (+4 more)

### Community 40 - "interface.test.mjs"
Cohesion: 0.05
Nodes (37): installer.sh script, Sauvegarde automatique au début de chaque mois (saves/), Brouillard de guerre et espions, Récapitulatif du mois, Service systemd web_conquete sur Raspberry Pi (iPad comme écran), Temps réel avec pause (réglage avancé), Tutoriel à bulles (premiers pas, armes en bataille), Spec : tutoriel interactif (campagne et bataille) (+29 more)

### Community 42 - "cities.py"
Cohesion: 0.10
Nodes (13): _fill(), _hilly(), local_ok(), prestige(), _river(), _troops(), upkeep(), _w_crue() (+5 more)

### Community 43 - "diplomacy.py"
Cohesion: 0.17
Nodes (14): act(), ai_evaluate(), answer(), apply(), declare_war(), exchange_prisoners(), held(), lost_nodes() (+6 more)

### Community 45 - "rules.py"
Cohesion: 0.08
Nodes (13): de(), nb(), num(), pl(), pop_curve(), _rural(), _town(), Mode Bataille sans campagne (skirmish.py) (+5 more)

### Community 46 - "textures.js"
Cohesion: 0.26
Nodes (20): Couleurs du sol : blé or doux, teintes par parcelle, herbe variée, T24 : couleurs du sol, hash(), hexRgb(), blade(), CROP, css(), CULTURES (+12 more)

### Community 47 - "terrain.js"
Cohesion: 0.15
Nodes (17): Sol peint par terrain.js posé sur le relief 3D, Chemins larges et usés (ornières, herbe au milieu), Tuiles de texture du sol selon la distance à la caméra, Lumière Lambert, soleil selon l'heure, onBeforeCompile du sol, T11 : lumière, ciel, brume, météo, T25 : chemins larges et usés, T5 : tuiles de texture du sol, décalcomanies, brèches, couverts, cellRemap() (+9 more)

### Community 48 - "formes.js"
Cohesion: 0.11
Nodes (35): Vue de bataille 3D web/js/battle (Three.js), ACTIONS, actionsOf(), aide, arme(), armeOf(), FIRE_MODES, ORDER_LABEL (+27 more)

### Community 50 - "GeoMap"
Cohesion: 0.12
Nodes (3): GeoMap, _seg_inter(), slugify()

### Community 51 - "UnitArt"
Cohesion: 0.25
Nodes (6): uniform(), dark(), headgear(), lite(), pen(), UnitArt

### Community 53 - "TownArt"
Cohesion: 0.21
Nodes (4): Carte vivante : villes en vue cavalière et animations d'ambiance, shade(), STYLE, TownArt

### Community 54 - "capture.mjs"
Cohesion: 0.12
Nodes (12): argv, chrome, done(), errors, here, js, kill(), out (+4 more)

### Community 55 - "options"
Cohesion: 0.17
Nodes (17): aa(), ai_step(), command(), end_garde(), fortify(), fortify_info(), garde(), garde_info() (+9 more)

### Community 56 - "cuire.mjs"
Cohesion: 0.07
Nodes (46): AIM(), arm(), BAYONET(), BUTT, CLIPS, copy(), DOWN, drum() (+38 more)

### Community 57 - "_note"
Cohesion: 0.09
Nodes (17): _best_depth(), _body(), _decide_withdraw(), _foe_est(), _heavy(), _history(), _hour(), _line_score() (+9 more)

### Community 58 - "ArriveeDevantUneVille"
Cohesion: 0.06
Nodes (22): Boundaries, Code Style, Commandes, Critères de réussite, Critères de réussite, Décisions prises, Décisions (validées le 18/10/2026), Fichiers touchés (+14 more)

### Community 59 - "closed_to"
Cohesion: 0.14
Nodes (8): ai_passage(), closed_owners(), closed_to(), eval_passage(), has_passage(), may_stay(), revoke_passage(), view_passage()

### Community 60 - "battle_log.py"
Cohesion: 0.13
Nodes (16): campaign_end(), _regs(), skirmish_end(), snapshot(), tactical(), write(), load(), main() (+8 more)

### Community 61 - "avec"
Cohesion: 0.12
Nodes (4): ApresLaBataille, avec(), EffetsEconomiques, EffetsSurLaSociete

### Community 62 - "modeles.test.mjs"
Cohesion: 0.11
Nodes (14): Version simple de loin (deux modèles par figurine, mêmes animations), Charge graphique : triangles ≤ départ + 10 % (renderer.info), Décision 13 : mesure des triangles (renderer.info) sur trois vues types bocage, Décision 8 : deux versions par figurine, choix par régiment selon la hauteur à l'écran, T18 : banc des modèles, relevé de charge de départ, T21 : version simple de loin (seuils 18/14 px, régiments hors champ non dessinés), FOOT, HORSE (+6 more)

### Community 63 - "gestes.js"
Cohesion: 0.09
Nodes (39): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7d : mêlée et charges, 7e : vue de loin, 7f : scène, Étape 7 : animer les batailles et se rapprocher d'Ultimate General (SPEC-3D.md « Étape 7 », plan : décisions 14 à 22), homme() (+31 more)

### Community 65 - "Décisions d'architecture"
Cohesion: 0.13
Nodes (15): ai_siege(), arrive(), asks(), blockade(), blockade_tick(), cd_left(), clamp(), contribution() (+7 more)

### Community 66 - "bfx"
Cohesion: 0.24
Nodes (9): _add(), bfx(), growth_k(), node_extra(), pfx(), stab_bonus(), train_k(), train_xp() (+1 more)

### Community 67 - "slots"
Cohesion: 0.21
Nodes (8): demolish(), finish(), level_name(), migrate(), _milice(), slot_build(), slots(), sync()

### Community 69 - ".enter"
Cohesion: 0.18
Nodes (7): T15 : ombres portées, Bataille, ensureStyle(), hasGL2(), wait(), waitFor(), loadAnims()

### Community 70 - "Plan : choisir à l'arrivée devant une ville (SPEC-TOURS.md, « Évolution du 18/10/2026 »)"
Cohesion: 0.18
Nodes (10): Graphe des dépendances, Liste des tâches, Phase 1 : le moteur, Phase 2 : l'écran, Plan : choisir à l'arrivée devant une ville (SPEC-TOURS.md, « Évolution du 18/10/2026 »), Point de contrôle 1, Point de contrôle final, Questions ouvertes (+2 more)

### Community 71 - "land_tick"
Cohesion: 0.17
Nodes (6): crossed(), incident(), land_owner(), land_tick(), trespassed(), way_out()

### Community 73 - "README web_conquete (Conquête : Aquitaine 1700-1899)"
Cohesion: 0.18
Nodes (12): README web_conquete (Conquête : Aquitaine 1700-1899), Technologies datées et armement par époque (réarmement), Cinq départements / provinces d'Aquitaine, Économie : ressources, minimum garanti, spécialités, Époques et départs 1700/1790/1813/1870, INSEE via @etalab/decoupage-administratif, france-geojson (IGN, Licence Ouverte), Natural Earth (fleuves et lacs) (+4 more)

### Community 75 - "simuler.py"
Cohesion: 0.18
Nodes (7): carry_on(), main(), mean(), play_month(), _run(), simulate(), BancEquilibre

### Community 78 - "Décisions d'architecture"
Cohesion: 0.12
Nodes (7): breach(), fort_eff(), marks(), from_dict(), migrate(), Décisions d'architecture, Phase 0 : socle et arbre

### Community 79 - "Plan : batailles en 3D (SPEC-3D.md)"
Cohesion: 0.10
Nodes (20): 6a et 6b : figurines, 6c : lumière et couleurs, 6d : sol, 6e : arbres et fin, Décisions d'architecture, Graphe des dépendances, Liste des tâches, Liste des tâches (étape 6) (+12 more)

### Community 80 - "choose"
Cohesion: 0.15
Nodes (11): ask_alive(), ask_choices(), asking(), choose(), pose(), resume(), strong(), view_army() (+3 more)

### Community 81 - "jouer_mois"
Cohesion: 0.18
Nodes (4): jouer_mois(), Production, RechercheEtPolitiques, Sauvegarde

### Community 82 - "geo.py"
Cohesion: 0.20
Nodes (6): fbm(), _h(), vnoise(), _path(), Recherche de chemin A* avec terres interdites, Cache de carte game/data/map_cache.json

### Community 83 - "check"
Cohesion: 0.20
Nodes (6): ai_build(), _ai_value(), check(), fits(), level_tech(), slot_count()

### Community 84 - "fire"
Cohesion: 0.29
Nodes (5): apply_local(), fire(), stats(), tick(), tours_of()

### Community 85 - "node_view"
Cohesion: 0.24
Nodes (8): describe_local(), fx_text(), _n(), node_view(), _pct(), per_k(), per_txt(), rules_payload()

### Community 89 - "Spec : les technologies et le rendu qui suit l'époque"
Cohesion: 0.05
Nodes (36): Batterie de mitrailleuses, Branche, Carte des modules, Choix validés (questionnaire du 19/10/2026), Choix validés (questionnaires du 18/10/2026), Commandes, Critères de réussite (2a), Critères de réussite (phases 0 et 1) (+28 more)

### Community 90 - "ai_policies"
Cohesion: 0.25
Nodes (5): ai_policies(), policy_w(), set_policy(), _set_policy(), _trading()

### Community 91 - "canvas"
Cohesion: 0.46
Nodes (6): Fumées en quads instanciés face à la caméra, T10 : fumées, éclairs, boulets, éclats, poussière, flashSprite(), glowSprite(), puffSprite(), canvas()

### Community 92 - "Propositions : les technologies et le rendu qui suit l'époque (1700-1899)"
Cohesion: 0.12
Nodes (16): 0. Ce qui existe déjà, 1. Mettre l'arbre à jour, 1a. Dates, 1b. Technologies qui manquent (proposition, chacune avec ce qu'elle montrerait), 1c. La branche « social », 2. Le socle commun (une seule source de vérité), 3. L'animation de la découverte, 4. La grande campagne : une carte qui change avec les siècles (+8 more)

### Community 93 - "Liste des tâches (étape 7)"
Cohesion: 0.12
Nodes (16): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7d : mêlée et charges, 7e : vue de loin, 7f : scène, Décisions d'architecture, Décisions d'architecture (+8 more)

### Community 94 - "waterways.py"
Cohesion: 0.24
Nodes (7): build(), add(), downstream(), piece(), _cut(), _project(), _seglen()

### Community 95 - "test_campagne.py"
Cohesion: 0.10
Nodes (12): ordinal(), _effects(), _gen(), _legs(), _order(), player_state(), _popy(), _reg() (+4 more)

### Community 97 - "au"
Cohesion: 0.16
Nodes (3): au(), EcheancesEnTours, TempsEnTours

### Community 100 - "icon-180.png (app icon, 180px)"
Cohesion: 1.00
Nodes (4): icon-180.png (app icon, 180px), icon-192.png (app icon, 192px), icon-512.png (app icon, 512px), Heraldic shield with five vertical color stripes, cream star and year 1790 on navy background

### Community 108 - "fanions.js"
Cohesion: 0.42
Nodes (8): LIFT(), banner(), drawBanners(), lite(), medallion(), men(), picto(), genName()

### Community 109 - "college_k"
Cohesion: 0.40
Nodes (3): college_k(), daily(), research()

### Community 110 - "events.py"
Cohesion: 0.17
Nodes (13): affordable(), apply(), describe(), expire(), _fill(), fire(), _ord(), _pct() (+5 more)

### Community 111 - "Étape 7 : où on en est et ce qui reste (point du 18/10/2026)"
Cohesion: 0.25
Nodes (7): Comment c'est fait (décisions 14 à 22 du plan, en bref), Décisions qui t'attendent, Défauts corrigés le 18/10/2026 (à ta demande), Où on en est (18/10/2026), Points de la revue laissés de côté (et pourquoi), Reprendre, Étape 7 : où on en est et ce qui reste (point du 18/10/2026)

### Community 112 - "Spec : batailles en 3D (style Ultimate General)"
Cohesion: 0.19
Nodes (13): Spec : batailles en 3D (style Ultimate General), Capture d'écran par Chromium sans écran (dev/capture.mjs), Banc d'essai simulé (dev/maquette.mjs, banc.html, cinq scénarios), Étape 6 : se rapprocher du rendu d'Ultimate General, Stratégie de test 3D (bancs Node, captures, essai à la main), Three.js r186 embarqué (web/vendor/three, sans CDN ni addons), Style Ultimate General : American Revolution (référence visuelle), Plan : batailles en 3D (+5 more)

### Community 114 - "unites.js"
Cohesion: 0.33
Nodes (6): Figurines 2D des cartes d'unités gardées (icônes d'interface), T17 : nettoyage du code 2D, README, captures des cartes, OMBRE, TILT, CARD_GUNS, HORSES

### Community 115 - "place"
Cohesion: 0.21
Nodes (9): conquer(), neg_tick(), passage_tick(), place(), quarters_tick(), tick(), wear_tick(), works_name() (+1 more)

### Community 116 - "Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1"
Cohesion: 0.15
Nodes (12): Choix du 18/10/2026, Graphe des dépendances, Graphe des dépendances, Liste des tâches, Phase 0 : socle et arbre, Phase 1 : bataille-armes, Phase 2a : le train (sous-module `carte-rail`, SPEC-TECH.md « Phase 2 », validée le 19/10/2026), Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1 (+4 more)

### Community 117 - "Troops"
Cohesion: 0.16
Nodes (9): Étape 8 : uniformes français d'époque (SPEC-3D.md « Étape 8 » ; plan : décisions 23 à 25), drapeau(), ordonnance(), coatOf(), flagSheet(), paintFlag(), pushOf(), Troops (+1 more)

### Community 118 - "À faire : technologies et rendu selon l'époque (point du 19/10/2026)"
Cohesion: 0.29
Nodes (6): 1. En cours sur le Pi (rien à faire, il faut attendre), 2 bis. Bugs signalés le 19/10/2026 (corrigés, commit `22e1f41`), 2. Ce qui me reste pour finir la phase 2a (tâche T78), 3. Ce qui t'attend, toi, 4. La suite (chaque morceau passera par spec, plan et ton accord avant le code), À faire : technologies et rendu selon l'époque (point du 19/10/2026)

### Community 119 - "create"
Cohesion: 0.40
Nodes (3): create(), default_deploy(), make_units()

### Community 122 - "suivre.js"
Cohesion: 0.29
Nodes (5): foes, id, mine, t, w

### Community 125 - "Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md)"
Cohesion: 0.15
Nodes (14): Lumière douce : courbe filmique, ombres teintées, ombres de contact, Décision 9 : ombres de contact instanciées sous chaque figurine, Décision 10 : NeutralToneMapping, ombres PCF douces, ciel plus fort, sans post-traitement, Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md), Étape 1 : la bataille se joue en 3D (régiments en blocs), Étape 2 : les troupes, Étape 3 : le feu et l'atmosphère, Étape 4 : le décor (+6 more)

### Community 130 - "Équilibre de la campagne : avant et après les nouvelles technologies (18/10/2026)"
Cohesion: 0.25
Nodes (7): 1700 à 1730, 1790 à 1820 (les nouvelles technologies apparaissent dès 1794), 1813 à 1853, 1870 à 1895, Phase 2a : avant et après le train (19/10/2026), À savoir pour lire ces chiffres, Équilibre de la campagne : avant et après les nouvelles technologies (18/10/2026)

## Ambiguous Edges - Review These
- `Polices Google Fonts (EB Garamond, IM Fell English)` → `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)`  [AMBIGUOUS]
  web/index.html · relation: conceptually_related_to

## Knowledge Gaps
- **16 isolated node(s):** `Événements historiques à choix (une trentaine, 1701-1898)`, `Classe Bataille (bataille.js)`, `Banc d'essai de la bataille (banc.html)`, `Saisons et météo (trois zones)`, `Terrain, marche à travers champs et embuscades` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 882 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Game` connect `Game` to `AI`, `skirmish.py`, `.grow_population`, `.move_army`, `Sauvegardes`, `.log`, `.update_battles`, `Décisions d'architecture`, `server.py`, `.mod`, `.settle_conflicts`, `.owned_nodes`, `partie`, `App`, `.resolve_battle_now`, `fabrique.py`, `test_campagne.py`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Game` (e.g. with `AI` and `from_dict()`) actually correct?**
  _`Game` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Événements historiques à choix (une trentaine, 1701-1898)`, `Classe Bataille (bataille.js)`, `Banc d'essai de la bataille (banc.html)` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05546218487394958 - nodes in this community are weakly interconnected._
- **Why does `Décisions d'architecture` connect `Décisions d'architecture` to `Mitrailleuses`, `troupes.js`, `bridge.py`, `Game`, `.log`, `.update_battles`, `.mod`, `formes.js`, `Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1`, `Troops`, `._fire`, `.trait`, `units.py`, `cuire.mjs`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Should `troupes.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09551020408163265 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Polices Google Fonts (EB Garamond, IM Fell English)` and `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._