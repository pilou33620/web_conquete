# Graph Report - web_conquete  (2026-10-18)

## Corpus Check
- 76 files · ~303,393 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 2, .bat 2, .css 2)

## Summary
- 2568 nodes · 6182 edges · 126 communities (87 shown, 39 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 197 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `08782e52`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- esc
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
- ui.js
- _think_field
- _d2
- terrain.py
- Effects
- tactics/ai.py
- skirmish.py
- .grow_population
- _bayonets
- Tutoriel de campagne en 15 bulles qui attendent l'action
- test_serveur.py
- cities.py
- diplomacy.py
- rules.py
- textures.js
- terrain.js
- formes.js
- GeoMap
- UnitArt
- bilan.py
- TownArt
- capture.mjs
- ai_step
- cuire.mjs
- _note
- interface.test.mjs
- closed_to
- battle_log.py
- modeles.test.mjs
- gestes.js
- clamp
- options
- bfx
- slots
- Http
- App
- place
- land_tick
- month_end
- README web_conquete (Conquête : Aquitaine 1700-1899)
- .action
- Spec : tour par tour à la Total War (tour des IA d'un coup, villes prises pendant le tour, le temps en tours)
- _decide_withdraw
- fanions.js
- UI
- Liste des tâches (étape 7)
- contribution
- engine.py
- check
- fire
- node_view
- main.js
- Tuto
- ai_policies
- canvas
- AI
- game/ai.py
- views.py
- migrate
- .armyById
- icon-180.png (app icon, 180px)
- lancer.sh
- Événements historiques à choix (une trentaine, 1701-1898)
- Banc d'essai de la bataille (banc.html)
- Saisons et météo (trois zones)
- Terrain, marche à travers champs et embuscades
- Unités, intendance et prisonniers
- Sauvegardes
- college_k
- events.py
- .enter
- .constructor
- settle
- waterways.py
- .rebuild
- Unit
- Troops
- works_level
- Service systemd web_conquete sur Raspberry Pi (iPad comme écran)
- unites.js
- Étape 7 : où on en est et ce qui reste (point du 18/10/2026)
- suivre.js
- footprint
- .cropMask
- Décision 9 : ombres de contact instanciées sous chaque figurine

## God Nodes (most connected - your core abstractions)
1. `Game` - 191 edges
2. `TacticalBattle` - 113 edges
3. `clamp()` - 104 edges
4. `UI` - 95 edges
5. `MapView` - 77 edges
6. `AI` - 54 edges
7. `esc()` - 49 edges
8. `BattleUI` - 46 edges
9. `partie()` - 44 edges
10. `BattleView` - 41 edges

## Surprising Connections (you probably didn't know these)
- `Étape 2 : les troupes` --references--> `layout()`  [INFERRED]
  tasks/todo-3d.md → web/js/battle/troupes.js
- `Arbres en touffes arrondies, bois au toit bosselé` --conceptually_related_to--> `crownGeo()`  [INFERRED]
  SPEC-3D.md → web/js/battle/decor.js
- `7d : mêlée et charges` --references--> `foeOf()`  [INFERRED]
  tasks/todo-3d.md → web/js/battle/gestes.js
- `7e : vue de loin` --references--> `scaleAt()`  [INFERRED]
  tasks/todo-3d.md → web/js/battle/gestes.js
- `Décisions d'architecture` --references--> `layout()`  [INFERRED]
  tasks/plan-3d.md → web/js/battle/troupes.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Architecture du rendu 3D des batailles (décisions 1 à 6)** — tasks_plan_view_api_preserved, tasks_plan_two_canvas, tasks_plan_ground_tiles_lod, tasks_plan_instanced_troops, tasks_plan_smoke_billboards, tasks_plan_lambert_lighting [EXTRACTED 1.00]
- **Modes de résolution des batailles** — readme_manual_battles, readme_auto_resolution, readme_finish_auto, readme_battle_mode [EXTRACTED 1.00]
- **Étape 6 : refonte de l'allure façon Ultimate General** — spec_3d_step6_ug_rendering, spec_3d_rounded_soldiers, spec_3d_far_lod, spec_3d_filmic_lighting, spec_3d_relief_crops, spec_3d_ground_colors, spec_3d_worn_paths, spec_3d_tufted_trees [EXTRACTED 1.00]
- **Pages de développement du mode Bataille** — web_js_battle_dev_banc_banc, web_js_battle_dev_banc_bataille [INFERRED 0.75]
- **Tutoriel interactif de campagne** — spec_interactive_tutorial, spec_tutorial_steps_as_data, spec_tutorial_per_device, web_index_tuto_bubble, web_js_tuto, web_js_ui [INFERRED 0.85]

## Communities (126 total, 39 thin omitted)

### Community 0 - "esc"
Cohesion: 0.18
Nodes (6): esc(), coat(), partTour(), toursTxt(), fmt(), fmt1()

### Community 2 - "troupes.js"
Cohesion: 0.12
Nodes (40): Soldats arrondis construits par le code (sans glTF), tricorne relevé, Troupes en InstancedMesh animées dans le vertex shader (texture de données), Décision 7 : modèles arrondis par le code (LatheGeometry, CapsuleGeometry, mêmes os), T19 : fantassins arrondis et taille (×1,6 gardé), T20 : chevaux, cavaliers, canons, caissons arrondis, T6 : fantassins 3D, T7 : cavaliers, chevaux, état-major, T8 : batteries, servants, caissons, chariots (+32 more)

### Community 4 - "turns.py"
Cohesion: 0.10
Nodes (17): _accumulate(), advance(), begin_turn(), _candidates(), command(), finish(), go(), _item() (+9 more)

### Community 5 - "BattleView"
Cohesion: 0.12
Nodes (4): Décisions d'architecture, Pièges rencontrés, profil(), BattleView

### Community 6 - "bridge.py"
Cohesion: 0.05
Nodes (30): army_locked(), army_tick(), _att_angle(), auto_battle_tick(), battle_view(), campaign_tick(), command(), default_deploy() (+22 more)

### Community 7 - "MapView"
Cohesion: 0.10
Nodes (3): fmtMen(), MapView, roundRect()

### Community 10 - "BattleUI"
Cohesion: 0.12
Nodes (4): fmt(), stars(), BattleUI, speedSvg()

### Community 14 - "server.py"
Cohesion: 0.08
Nodes (14): auto_update(), version(), banner(), _git(), _git_env(), GzipCache, is_headless(), is_raspberry() (+6 more)

### Community 17 - "map.js"
Cohesion: 0.11
Nodes (18): Commandes souris, doigt et stylet, CLS_ORDER, darken(), LEVELS, lighten(), mix(), PARTS, PLAYABLE (+10 more)

### Community 18 - "Terrain"
Cohesion: 0.13
Nodes (6): Décisions d'architecture, mixHex(), rgbStr(), offsetPts(), strokePts(), Terrain

### Community 19 - "math"
Cohesion: 0.11
Nodes (19): _at(), _best_depth(), _cover_spot(), _deploy_field(), _deploy_place_att(), _deploy_place_def(), _flank_fire_spot(), _gun_spot() (+11 more)

### Community 23 - "army_actions.py"
Cohesion: 0.11
Nodes (11): cell_mask(), closed_msg(), extra_food(), force_passage(), force_question(), migrate(), names_of(), route_level() (+3 more)

### Community 24 - "units.py"
Cohesion: 0.21
Nodes (6): ammo0_of(), cls_of(), from_reg(), general(), ranges(), unit_name()

### Community 25 - "partie"
Cohesion: 0.06
Nodes (15): armee(), jouer_mois(), partie(), ActionsEnTours, au(), EcheancesEnTours, jouer_reste(), Production (+7 more)

### Community 26 - "decor.js"
Cohesion: 0.10
Nodes (17): Arbres en touffes arrondies, bois au toit bosselé, Décision 12 : couronnes en 3 à 5 touffes d'icosaèdres, deux versions par zone (750 m), T12 : arbres instanciés, T13 : maisons, église, moulins, ponts, portes, T14 : remparts, brèches, tranchées, haies, T27 : arbres touffus, troupes visibles dans les bois, Builder, clearable() (+9 more)

### Community 27 - "simulation.mjs"
Cohesion: 0.08
Nodes (26): battles, get(), here, JEU, json(), proxy(), server, TYPES (+18 more)

### Community 28 - "vue.js"
Cohesion: 0.12
Nodes (27): Vue de bataille 3D web/js/battle (Three.js), Repère : x→X, y (sud)→Z, altitude→Y, 1 m = 1 unité, toWorld par marche de rayon sur l'altitude, Fumées en quads instanciés face à la caméra, Deux canevas : WebGL dessous, calque 2D dessus (fanions, gestes, tracés, pluie), T10 : fumées, éclairs, boulets, éclats, poussière, T15 : ombres portées, T2 : caméra orbitale et ses bancs (+19 more)

### Community 29 - "fabrique.py"
Cohesion: 0.13
Nodes (9): Bancs d'essai (tests/lancer.py, fabrique.py), avancer(), bataille(), ennemi(), face_a_face(), kind(), ordre(), BatailleEntiere (+1 more)

### Community 30 - "Relief"
Cohesion: 0.12
Nodes (5): cloudTexture(), Decals, Relief, ticks(), paintDecal()

### Community 31 - "ui.js"
Cohesion: 0.08
Nodes (27): Résolution automatique des batailles, Objectif ≥ 30 images/s sur iPad 2019 en qualité Haute, T16 : qualité, mesure, sans WebGL 2, appareil(), devine(), ecoutes, lire(), Mesure (+19 more)

### Community 32 - "_think_field"
Cohesion: 0.12
Nodes (14): _advance(), _clamp(), _einf(), _fine_halt(), _flank_group(), _foe_dist(), _front_dep(), _march_form() (+6 more)

### Community 33 - "_d2"
Cohesion: 0.13
Nodes (15): _apply(), _art_target(), _artillery(), _cav_near(), _d2(), _fetch(), _form(), _goto() (+7 more)

### Community 34 - "terrain.py"
Cohesion: 0.06
Nodes (32): ball_k(), grape_k(), _add_bridge(), _barricades(), BattleMap, bfs(), blur(), cell_of() (+24 more)

### Community 35 - "Effects"
Cohesion: 0.11
Nodes (12): Lumière douce : courbe filmique, ombres teintées, ombres de contact, Décision 10 : NeutralToneMapping, ombres PCF douces, ciel plus fort, sans post-traitement, Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md), Étape 1 : la bataille se joue en 3D (régiments en blocs), Étape 2 : les troupes, Étape 3 : le feu et l'atmosphère, Étape 4 : le décor, Étape 5 : finitions (+4 more)

### Community 36 - "tactics/ai.py"
Cohesion: 0.16
Nodes (15): _adopt(), _adopt_unit(), _announced(), _cat(), _choose_plan(), _counter_charge(), deploy(), _groups() (+7 more)

### Community 37 - "skirmish.py"
Cohesion: 0.15
Nodes (12): _count(), _foe_units(), _fort(), _local(), new(), _open_ground(), options(), _pick_season() (+4 more)

### Community 39 - "_bayonets"
Cohesion: 0.11
Nodes (13): _ang(), _bayonets(), _cav_target(), _cavalry(), _charge_ok(), _foe(), _gun_front(), _gun_zones() (+5 more)

### Community 40 - "Tutoriel de campagne en 15 bulles qui attendent l'action"
Cohesion: 0.15
Nodes (14): Mode Bataille sans campagne (skirmish.py), Brouillard de guerre et espions, Récapitulatif du mois, Temps réel avec pause (réglage avancé), Spec : tutoriel interactif (campagne et bataille), Bulles de bataille déclenchées par la situation (une fois chacune), Tutoriel de campagne en 15 bulles qui attendent l'action, Barre supérieure (date, vitesse, tour, ressources, menu) (+6 more)

### Community 41 - "test_serveur.py"
Cohesion: 0.11
Nodes (3): hote_permis(), Visites, Connexions

### Community 42 - "cities.py"
Cohesion: 0.11
Nodes (9): _fill(), _hilly(), local_ok(), prestige(), _river(), _troops(), upkeep(), _w_crue() (+1 more)

### Community 43 - "diplomacy.py"
Cohesion: 0.19
Nodes (13): act(), ai_evaluate(), answer(), apply(), declare_war(), exchange_prisoners(), held(), lost_nodes() (+5 more)

### Community 45 - "rules.py"
Cohesion: 0.09
Nodes (13): de(), nb(), num(), pl(), pop_curve(), _rural(), _town(), Journal des batailles logs/batailles.jsonl et outils/bilan.py (+5 more)

### Community 46 - "textures.js"
Cohesion: 0.26
Nodes (20): Couleurs du sol : blé or doux, teintes par parcelle, herbe variée, T24 : couleurs du sol, hash(), hexRgb(), blade(), CROP, css(), CULTURES (+12 more)

### Community 47 - "terrain.js"
Cohesion: 0.14
Nodes (16): Sol peint par terrain.js posé sur le relief 3D, Chemins larges et usés (ornières, herbe au milieu), Tuiles de texture du sol selon la distance à la caméra, Lumière Lambert, soleil selon l'heure, onBeforeCompile du sol, T11 : lumière, ciel, brume, météo, T25 : chemins larges et usés, T5 : tuiles de texture du sol, décalcomanies, brèches, couverts, cellRemap() (+8 more)

### Community 48 - "formes.js"
Cohesion: 0.12
Nodes (32): ACTIONS, actionsOf(), aide, arme(), armeOf(), FIRE_MODES, ORDER_LABEL, ordresHtml() (+24 more)

### Community 51 - "UnitArt"
Cohesion: 0.25
Nodes (5): dark(), headgear(), lite(), pen(), UnitArt

### Community 52 - "bilan.py"
Cohesion: 0.28
Nodes (8): load(), main(), mean(), mean100(), num(), pct(), ratio(), table()

### Community 53 - "TownArt"
Cohesion: 0.21
Nodes (4): Carte vivante : villes en vue cavalière et animations d'ambiance, shade(), STYLE, TownArt

### Community 54 - "capture.mjs"
Cohesion: 0.11
Nodes (13): Charge graphique : triangles ≤ départ + 10 % (renderer.info), Décision 13 : mesure des triangles (renderer.info) sur trois vues types bocage, T18 : banc des modèles, relevé de charge de départ, argv, chrome, errors, here, js (+5 more)

### Community 55 - "ai_step"
Cohesion: 0.22
Nodes (11): aa(), ai_step(), cd_left(), command(), garde(), garde_info(), own_place(), quarters() (+3 more)

### Community 56 - "cuire.mjs"
Cohesion: 0.07
Nodes (46): AIM(), arm(), BAYONET(), BUTT, CLIPS, copy(), DOWN, drum() (+38 more)

### Community 57 - "_note"
Cohesion: 0.18
Nodes (12): _aim_breach(), _breaches(), _foe_est(), _heavy(), _hour(), _note(), _roles_update(), _set_phase() (+4 more)

### Community 58 - "interface.test.mjs"
Cohesion: 0.17
Nodes (7): element(), installer(), barre(), campagne(), dom, JS, panneau()

### Community 59 - "closed_to"
Cohesion: 0.14
Nodes (8): ai_passage(), closed_owners(), closed_to(), eval_passage(), has_passage(), may_stay(), revoke_passage(), view_passage()

### Community 60 - "battle_log.py"
Cohesion: 0.24
Nodes (6): campaign_end(), _regs(), skirmish_end(), snapshot(), tactical(), write()

### Community 62 - "modeles.test.mjs"
Cohesion: 0.11
Nodes (14): Capture d'écran par Chromium sans écran (dev/capture.mjs), Version simple de loin (deux modèles par figurine, mêmes animations), Banc d'essai simulé (dev/maquette.mjs, banc.html, cinq scénarios), Stratégie de test 3D (bancs Node, captures, essai à la main), Décision 8 : deux versions par figurine, choix par régiment selon la hauteur à l'écran, T21 : version simple de loin (seuils 18/14 px, régiments hors champ non dessinés), FOOT, HORSE (+6 more)

### Community 63 - "gestes.js"
Cohesion: 0.09
Nodes (37): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7d : mêlée et charges, 7e : vue de loin, 7f : scène, Étape 7 : animer les batailles et se rapprocher d'Ultimate General (SPEC-3D.md « Étape 7 », plan : décisions 14 à 22), homme() (+29 more)

### Community 64 - "clamp"
Cohesion: 0.24
Nodes (4): along(), polyline(), T, clamp()

### Community 65 - "options"
Cohesion: 0.19
Nodes (12): clamp(), ctb_info(), end_garde(), force_ratio(), fortify_info(), neg_info(), negotiate(), node_aa() (+4 more)

### Community 66 - "bfx"
Cohesion: 0.24
Nodes (9): _add(), bfx(), growth_k(), node_extra(), pfx(), stab_bonus(), train_k(), train_xp() (+1 more)

### Community 67 - "slots"
Cohesion: 0.21
Nodes (8): demolish(), finish(), level_name(), migrate(), _milice(), slot_build(), slots(), sync()

### Community 70 - "place"
Cohesion: 0.23
Nodes (10): arrive(), fortify(), neg_tick(), passage_tick(), place(), quarters_tick(), tick(), wear_tick() (+2 more)

### Community 71 - "land_tick"
Cohesion: 0.17
Nodes (6): crossed(), incident(), land_owner(), land_tick(), trespassed(), way_out()

### Community 72 - "month_end"
Cohesion: 0.14
Nodes (9): eta(), march_days(), month_days(), month_end(), phase(), preview(), ready_in(), view() (+1 more)

### Community 73 - "README web_conquete (Conquête : Aquitaine 1700-1899)"
Cohesion: 0.16
Nodes (17): README web_conquete (Conquête : Aquitaine 1700-1899), Cinq départements / provinces d'Aquitaine, Économie : ressources, minimum garanti, spécialités, INSEE via @etalab/decoupage-administratif, france-geojson (IGN, Licence Ouverte), Natural Earth (fleuves et lacs), Population historique sur deux siècles, Serveur Python local (server.py, boucle de simulation 10 pas/s) (+9 more)

### Community 75 - "Spec : tour par tour à la Total War (tour des IA d'un coup, villes prises pendant le tour, le temps en tours)"
Cohesion: 0.15
Nodes (12): Boundaries, Code Style, Commandes, Critères de réussite, Décisions prises, Le temps en tours, Objectif, Questions ouvertes (+4 more)

### Community 76 - "_decide_withdraw"
Cohesion: 0.20
Nodes (5): _body(), _decide_withdraw(), _history(), _stalled(), _tenacity()

### Community 77 - "fanions.js"
Cohesion: 0.29
Nodes (11): L'entrée : champ de bataille en 3D (sol peint, blé en relief, figurines, fanions), Style Ultimate General : American Revolution (référence visuelle), T9 : fanions façon Ultimate General, LIFT(), banner(), drawBanners(), lite(), medallion() (+3 more)

### Community 79 - "Liste des tâches (étape 7)"
Cohesion: 0.09
Nodes (22): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7d : mêlée et charges, 7e : vue de loin, 7f : scène, Graphe des dépendances, Graphe des dépendances (+14 more)

### Community 80 - "contribution"
Cohesion: 0.20
Nodes (7): ai_siege(), blockade(), blockade_tick(), conquer(), contribution(), defenders(), foreign_place()

### Community 82 - "engine.py"
Cohesion: 0.09
Nodes (10): ordinal(), fbm(), _h(), _seg_inter(), vnoise(), Recherche de chemin A* avec terres interdites, Diplomatie et commerce, Cache de carte game/data/map_cache.json (+2 more)

### Community 83 - "check"
Cohesion: 0.22
Nodes (5): ai_build(), _ai_value(), check(), fits(), level_tech()

### Community 84 - "fire"
Cohesion: 0.29
Nodes (5): apply_local(), fire(), stats(), tick(), tours_of()

### Community 85 - "node_view"
Cohesion: 0.21
Nodes (9): describe_local(), fx_text(), _n(), node_view(), _pct(), per_k(), per_txt(), rules_payload() (+1 more)

### Community 88 - "main.js"
Cohesion: 0.42
Nodes (9): Interface web (HTML/CSS/JS, rendu canvas de la carte), announceUpdate(), api, boot(), checkVersion(), poll(), resetUI(), showStart() (+1 more)

### Community 89 - "Tuto"
Cohesion: 0.23
Nodes (5): Tutoriel à bulles (premiers pas, armes en bataille), Étapes du tutoriel en données (ETAPES, comme tipStep), etapes(), placer(), Tuto

### Community 90 - "ai_policies"
Cohesion: 0.25
Nodes (5): ai_policies(), policy_w(), set_policy(), _set_policy(), _trading()

### Community 91 - "canvas"
Cohesion: 0.23
Nodes (6): flashSprite(), glowSprite(), puffSprite(), canvas(), vnoise(), culture()

### Community 93 - "game/ai.py"
Cohesion: 0.33
Nodes (4): Politique de la ville, Emplacements et chaînes de bâtiments des villes, IA des départements (mêmes règles, ne thésaurisent plus), Événements locaux des villes

### Community 95 - "views.py"
Cohesion: 0.13
Nodes (12): _effects(), from_dict(), _gen(), _legs(), migrate(), _order(), player_state(), _popy() (+4 more)

### Community 98 - "migrate"
Cohesion: 0.33
Nodes (3): migrate(), new_state(), turn_start_after()

### Community 100 - "icon-180.png (app icon, 180px)"
Cohesion: 1.00
Nodes (4): icon-180.png (app icon, 180px), icon-192.png (app icon, 192px), icon-512.png (app icon, 512px), Heraldic shield with five vertical color stripes, cream star and year 1790 on navy background

### Community 109 - "college_k"
Cohesion: 0.40
Nodes (3): college_k(), daily(), research()

### Community 110 - "events.py"
Cohesion: 0.21
Nodes (11): affordable(), apply(), describe(), expire(), _fill(), fire(), _ord(), _pct() (+3 more)

### Community 111 - ".enter"
Cohesion: 0.26
Nodes (5): Bataille, ensureStyle(), hasGL2(), wait(), waitFor()

### Community 113 - "settle"
Cohesion: 0.20
Nodes (6): deadline(), march_left(), march_now(), planning(), resolve_autos(), settle()

### Community 114 - "waterways.py"
Cohesion: 0.24
Nodes (7): build(), add(), downstream(), piece(), _cut(), _project(), _seglen()

### Community 115 - ".rebuild"
Cohesion: 0.20
Nodes (10): 6a et 6b : figurines, 6c : lumière et couleurs, 6d : sol, 6e : arbres et fin, Décisions d'architecture, Liste des tâches (étape 6), Questions ouvertes (étape 6), Risques et parades (étape 6) (+2 more)

### Community 116 - "Unit"
Cohesion: 0.20
Nodes (3): milice(), Unit, wagon()

### Community 117 - "Troops"
Cohesion: 0.31
Nodes (3): flagPattern(), Troops, turn()

### Community 118 - "works_level"
Cohesion: 0.22
Nodes (6): bombard(), breach(), fort_eff(), siege_k(), walled(), works_level()

### Community 119 - "Service systemd web_conquete sur Raspberry Pi (iPad comme écran)"
Cohesion: 0.29
Nodes (4): installer.sh script, Sauvegarde automatique au début de chaque mois (saves/), Service systemd web_conquete sur Raspberry Pi (iPad comme écran), Méta d'application web iOS/Android et manifest (plein écran)

### Community 120 - "unites.js"
Cohesion: 0.33
Nodes (6): Étape 6 : se rapprocher du rendu d'Ultimate General, Figurines 2D des cartes d'unités gardées (icônes d'interface), T17 : nettoyage du code 2D, README, captures des cartes, OMBRE, TILT, HORSES

### Community 121 - "Étape 7 : où on en est et ce qui reste (point du 18/10/2026)"
Cohesion: 0.29
Nodes (6): Comment c'est fait (décisions 14 à 22 du plan, en bref), Décisions qui t'attendent, Où on en est (18/10/2026), Points de la revue laissés de côté (et pourquoi), Reprendre, Étape 7 : où on en est et ce qui reste (point du 18/10/2026)

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
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 728 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Game` connect `Game` to `skirmish.py`, `.grow_population`, `App`, `.plan_legs`, `test_serveur.py`, `.log`, `Sauvegardes`, `.arrive_node`, `server.py`, `.mod`, `.arm_level`, `engine.py`, `.update_battles`, `partie`, `AI`, `fabrique.py`, `views.py`?**
  _High betweenness centrality (0.196) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Game` (e.g. with `AI` and `from_dict()`) actually correct?**
  _`Game` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Événements historiques à choix (une trentaine, 1701-1898)`, `Classe Bataille (bataille.js)`, `Banc d'essai de la bataille (banc.html)` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `.spend` be split into smaller, more focused modules?**
  _Cohesion score 0.09782608695652174 - nodes in this community are weakly interconnected._
- **Why does `Bancs d'essai (tests/lancer.py, fabrique.py)` connect `fabrique.py` to `README web_conquete (Conquête : Aquitaine 1700-1899)`, `test_serveur.py`, `partie`, `interface.test.mjs`, `vue.js`, `modeles.test.mjs`?**
  _High betweenness centrality (0.156) - this node is a cross-community bridge._
- **Should `troupes.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1173054587688734 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Polices Google Fonts (EB Garamond, IM Fell English)` and `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._