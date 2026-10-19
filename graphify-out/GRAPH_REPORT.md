# Graph Report - web_conquete  (2026-10-19)

## Corpus Check
- 84 files · ~334,246 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 2, .bat 2, .css 2)

## Summary
- 2850 nodes · 6779 edges · 134 communities (97 shown, 37 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 273 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `db516dcd`
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
- .cell
- ._fire
- army_actions.py
- units.py
- partie
- decor.js
- MockBattle
- camera.js
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
- Tutoriel de campagne en 15 bulles qui attendent l'action
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
- avec
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
- README web_conquete (Conquête : Aquitaine 1700-1899)
- UI
- Spec : tour par tour à la Total War (tour des IA d'un coup, villes prises pendant le tour, le temps en tours)
- _decide_withdraw
- simulation.mjs
- Décisions d'architecture
- Plan : batailles en 3D (SPEC-3D.md)
- choose
- test_campagne.py
- engine.py
- check
- fire
- node_view
- .log
- Spec : les technologies et le rendu qui suit l'époque
- policy_w
- canvas
- Propositions : les technologies et le rendu qui suit l'époque (1700-1899)
- Liste des tâches (étape 7)
- views.py
- advance
- au
- Tuto
- icon-180.png (app icon, 180px)
- lancer.sh
- Événements historiques à choix (une trentaine, 1701-1898)
- Banc d'essai de la bataille (banc.html)
- Saisons et météo (trois zones)
- Terrain, marche à travers champs et embuscades
- Unités, intendance et prisonniers
- month_end
- college_k
- events.py
- P
- interface.test.mjs
- .test_un_evenement_n_efface_pas_une_dette
- maquette.mjs
- node_aa
- Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1
- Troops
- main.js
- command
- ArbreDesTechnologies
- hold
- suivre.js
- make_spec
- finish
- Décision 9 : ombres de contact instanciées sous chaque figurine
- migrate
- Module `bataille-armes` (phase 1)
- Mitrailleuses
- on_speed
- Équilibre de la campagne : avant et après les nouvelles technologies (18/10/2026)
- Renseignement
- army_tick
- DynamiteALAssaut

## God Nodes (most connected - your core abstractions)
1. `Game` - 195 edges
2. `TacticalBattle` - 115 edges
3. `clamp()` - 105 edges
4. `UI` - 98 edges
5. `MapView` - 77 edges
6. `partie()` - 70 edges
7. `AI` - 56 edges
8. `esc()` - 50 edges
9. `BattleUI` - 46 edges
10. `BattleView` - 41 edges

## Surprising Connections (you probably didn't know these)
- `État (18/10/2026)` --references--> `ArriveeDevantUneVille`  [INFERRED]
  SPEC-TOURS.md → tests/test_campagne.py
- `Stratégie de test` --references--> `arm()`  [INFERRED]
  SPEC-TECH.md → web/js/battle/dev/cuire.mjs
- `Étape 2 : les troupes` --references--> `layout()`  [INFERRED]
  tasks/todo-3d.md → web/js/battle/troupes.js
- `Décisions d'architecture` --references--> `breach()`  [INFERRED]
  tasks/plan-tech.md → game/army_actions.py
- `Phase 0 : socle et arbre` --references--> `breach()`  [INFERRED]
  tasks/todo-tech.md → game/army_actions.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Architecture du rendu 3D des batailles (décisions 1 à 6)** — tasks_plan_view_api_preserved, tasks_plan_two_canvas, tasks_plan_ground_tiles_lod, tasks_plan_instanced_troops, tasks_plan_smoke_billboards, tasks_plan_lambert_lighting [EXTRACTED 1.00]
- **Modes de résolution des batailles** — readme_manual_battles, readme_auto_resolution, readme_finish_auto, readme_battle_mode [EXTRACTED 1.00]
- **Étape 6 : refonte de l'allure façon Ultimate General** — spec_3d_step6_ug_rendering, spec_3d_rounded_soldiers, spec_3d_far_lod, spec_3d_filmic_lighting, spec_3d_relief_crops, spec_3d_ground_colors, spec_3d_worn_paths, spec_3d_tufted_trees [EXTRACTED 1.00]
- **Pages de développement du mode Bataille** — web_js_battle_dev_banc_banc, web_js_battle_dev_banc_bataille [INFERRED 0.75]
- **Tutoriel interactif de campagne** — spec_interactive_tutorial, spec_tutorial_steps_as_data, spec_tutorial_per_device, web_index_tuto_bubble, web_js_tuto, web_js_ui [INFERRED 0.85]

## Communities (134 total, 37 thin omitted)

### Community 0 - "esc"
Cohesion: 0.10
Nodes (6): esc(), partTour(), toursTxt(), de(), fmt(), fmt1()

### Community 2 - "troupes.js"
Cohesion: 0.10
Nodes (47): Soldats arrondis construits par le code (sans glTF), tricorne relevé, Décision 7 : modèles arrondis par le code (LatheGeometry, CapsuleGeometry, mêmes os), T19 : fantassins arrondis et taille (×1,6 gardé), T20 : chevaux, cavaliers, canons, caissons arrondis, T7 : cavaliers, chevaux, état-major, T8 : batteries, servants, caissons, chariots, assemble(), both() (+39 more)

### Community 4 - "turns.py"
Cohesion: 0.09
Nodes (16): begin_turn(), deadline(), eta(), finish(), incoming(), lock_reason(), march_left(), march_now() (+8 more)

### Community 5 - "BattleView"
Cohesion: 0.07
Nodes (17): Décisions d'architecture, Comment c'est fait (décisions 14 à 22 du plan, en bref), Décisions qui t'attendent, Défauts corrigés le 18/10/2026 (à ta demande), Où on en est (18/10/2026), Pièges rencontrés, Points de la revue laissés de côté (et pourquoi), Reprendre (+9 more)

### Community 6 - "bridge.py"
Cohesion: 0.11
Nodes (15): army_locked(), auto_battle_tick(), battle_view(), ensure(), find(), involves_player(), load_from(), map_view() (+7 more)

### Community 7 - "MapView"
Cohesion: 0.10
Nodes (3): b64(), MapView, roundRect()

### Community 10 - "BattleUI"
Cohesion: 0.10
Nodes (7): fmt(), stars(), BattleUI, hourOf(), short(), speedSvg(), svg()

### Community 14 - "server.py"
Cohesion: 0.07
Nodes (15): auto_update(), version(), banner(), _git(), _git_env(), GzipCache, is_headless(), is_raspberry() (+7 more)

### Community 15 - "Ambient"
Cohesion: 0.14
Nodes (5): along(), Ambient, frac(), polyline(), T

### Community 17 - "map.js"
Cohesion: 0.10
Nodes (20): Commandes souris, doigt et stylet, Interface web (HTML/CSS/JS, rendu canvas de la carte), CLS_ORDER, darken(), fmtMen(), LEVELS, lighten(), mix() (+12 more)

### Community 18 - "Terrain"
Cohesion: 0.11
Nodes (6): mixHex(), rgbStr(), vnoise(), offsetPts(), strokePts(), Terrain

### Community 19 - "math"
Cohesion: 0.11
Nodes (19): _at(), _best_depth(), _cover_spot(), _deploy_field(), _deploy_place_att(), _deploy_place_def(), _flank_fire_spot(), _gun_spot() (+11 more)

### Community 23 - "army_actions.py"
Cohesion: 0.08
Nodes (17): blockade_tick(), bombard(), breach(), cell_mask(), closed_msg(), defenders(), extra_food(), force_passage() (+9 more)

### Community 24 - "units.py"
Cohesion: 0.10
Nodes (12): ammo0_of(), cls_of(), footprint(), from_reg(), general(), milice(), pieces(), ranges() (+4 more)

### Community 25 - "partie"
Cohesion: 0.13
Nodes (5): armee(), partie(), ActionsEnTours, jouer_reste(), TourParTour

### Community 26 - "decor.js"
Cohesion: 0.10
Nodes (16): Arbres en touffes arrondies, bois au toit bosselé, Décision 12 : couronnes en 3 à 5 touffes d'icosaèdres, deux versions par zone (750 m), T12 : arbres instanciés, T13 : maisons, église, moulins, ponts, portes, T14 : remparts, brèches, tranchées, haies, T27 : arbres touffus, troupes visibles dans les bois, Builder, clearable() (+8 more)

### Community 27 - "MockBattle"
Cohesion: 0.21
Nodes (4): get(), server, MockBattle, smooth()

### Community 28 - "camera.js"
Cohesion: 0.20
Nodes (17): Repère : x→X, y (sud)→Z, altitude→Y, 1 m = 1 unité, toWorld par marche de rayon sur l'altitude, T2 : caméra orbitale et ses bancs, cams, vp, anchor(), clampCam(), cross() (+9 more)

### Community 29 - "fabrique.py"
Cohesion: 0.09
Nodes (12): avancer(), bataille(), ennemi(), face_a_face(), kind(), ordre(), BatailleEntiere, MarquesVisibles (+4 more)

### Community 30 - "Relief"
Cohesion: 0.12
Nodes (5): cloudTexture(), Decals, Relief, ticks(), paintDecal()

### Community 31 - "qualite.js"
Cohesion: 0.12
Nodes (18): Résolution automatique des batailles, Objectif ≥ 30 images/s sur iPad 2019 en qualité Haute, Cultures en relief près de la caméra (épis qui ondulent, ~300 m), Décision 11 : cultures en relief par coquilles empilées et masque de végétation, T16 : qualité, mesure, sans WebGL 2, T26 : cultures en relief, appareil(), devine() (+10 more)

### Community 32 - "_think_field"
Cohesion: 0.12
Nodes (14): _advance(), _clamp(), _einf(), _fine_halt(), _flank_group(), _foe_dist(), _front_dep(), _march_form() (+6 more)

### Community 33 - "_d2"
Cohesion: 0.13
Nodes (15): _apply(), _art_target(), _artillery(), _cav_near(), _d2(), _fetch(), _form(), _goto() (+7 more)

### Community 34 - "terrain.py"
Cohesion: 0.08
Nodes (28): _add_bridge(), _barricades(), BattleMap, bfs(), blur(), cell_of(), center_of(), _clip_poly() (+20 more)

### Community 35 - "Effects"
Cohesion: 0.11
Nodes (13): Lumière douce : courbe filmique, ombres teintées, ombres de contact, Décision 10 : NeutralToneMapping, ombres PCF douces, ciel plus fort, sans post-traitement, Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md), Étape 1 : la bataille se joue en 3D (régiments en blocs), Étape 2 : les troupes, Étape 3 : le feu et l'atmosphère, Étape 4 : le décor, Étape 5 : finitions (+5 more)

### Community 36 - "tactics/ai.py"
Cohesion: 0.16
Nodes (15): _adopt(), _adopt_unit(), _announced(), _cat(), _choose_plan(), _counter_charge(), deploy(), _groups() (+7 more)

### Community 37 - "skirmish.py"
Cohesion: 0.14
Nodes (12): _count(), _foe_units(), _fort(), _local(), new(), _open_ground(), options(), _pick_season() (+4 more)

### Community 39 - "_bayonets"
Cohesion: 0.11
Nodes (13): _ang(), _bayonets(), _cav_target(), _cavalry(), _charge_ok(), _foe(), _gun_front(), _gun_zones() (+5 more)

### Community 40 - "Tutoriel de campagne en 15 bulles qui attendent l'action"
Cohesion: 0.12
Nodes (18): Mode Bataille sans campagne (skirmish.py), Finir automatiquement (IA des officiers en accéléré), Brouillard de guerre et espions, Généraux, formations et plans de bataille (3 phases), Batailles manuelles en temps réel avec pause (game/tactics), Récapitulatif du mois, Temps réel avec pause (réglage avancé), Déroutes et ralliement auprès du général (+10 more)

### Community 41 - "test_serveur.py"
Cohesion: 0.09
Nodes (4): hote_permis(), Visites, Connexions, Sauvegardes

### Community 42 - "cities.py"
Cohesion: 0.11
Nodes (12): _fill(), _hilly(), local_ok(), prestige(), _river(), _troops(), upkeep(), _w_crue() (+4 more)

### Community 43 - "diplomacy.py"
Cohesion: 0.14
Nodes (14): act(), ai_evaluate(), answer(), apply(), declare_war(), exchange_prisoners(), held(), lost_nodes() (+6 more)

### Community 45 - "rules.py"
Cohesion: 0.10
Nodes (10): de(), marks(), nb(), num(), pl(), pop_curve(), _rural(), _town() (+2 more)

### Community 46 - "textures.js"
Cohesion: 0.26
Nodes (20): Couleurs du sol : blé or doux, teintes par parcelle, herbe variée, T24 : couleurs du sol, hash(), hexRgb(), blade(), CROP, css(), CULTURES (+12 more)

### Community 47 - "terrain.js"
Cohesion: 0.14
Nodes (19): Sol peint par terrain.js posé sur le relief 3D, Chemins larges et usés (ornières, herbe au milieu), Tuiles de texture du sol selon la distance à la caméra, Lumière Lambert, soleil selon l'heure, onBeforeCompile du sol, Deux canevas : WebGL dessous, calque 2D dessus (fanions, gestes, tracés, pluie), T11 : lumière, ciel, brume, météo, T25 : chemins larges et usés, T3 : vue WebGL, relief, régiments en blocs, calque 2D (+11 more)

### Community 48 - "formes.js"
Cohesion: 0.10
Nodes (45): L'entrée : champ de bataille en 3D (sol peint, blé en relief, figurines, fanions), Vue de bataille 3D web/js/battle (Three.js), Style Ultimate General : American Revolution (référence visuelle), T4 : gestes, tracés au sol, mini-carte, T9 : fanions façon Ultimate General, ACTIONS, actionsOf(), aide (+37 more)

### Community 50 - "GeoMap"
Cohesion: 0.06
Nodes (4): GeoMap, slugify(), App, Handler

### Community 51 - "unites.js"
Cohesion: 0.13
Nodes (17): Étape 6 : se rapprocher du rendu d'Ultimate General, Figurines 2D des cartes d'unités gardées (icônes d'interface), Troupes en InstancedMesh animées dans le vertex shader (texture de données), Étape 8 : uniformes français d'époque (SPEC-3D.md « Étape 8 » ; plan : décisions 23 à 25), T17 : nettoyage du code 2D, README, captures des cartes, T6 : fantassins 3D, OMBRE, TILT (+9 more)

### Community 52 - "bilan.py"
Cohesion: 0.20
Nodes (12): load(), main(), mean(), mean100(), num(), pct(), ratio(), table() (+4 more)

### Community 53 - "TownArt"
Cohesion: 0.21
Nodes (4): Carte vivante : villes en vue cavalière et animations d'ambiance, shade(), STYLE, TownArt

### Community 54 - "capture.mjs"
Cohesion: 0.12
Nodes (10): argv, chrome, errors, here, js, maq, out, profile (+2 more)

### Community 55 - "place"
Cohesion: 0.19
Nodes (17): aa(), ai_step(), command(), fortify(), garde(), garde_info(), neg_tick(), negotiate() (+9 more)

### Community 56 - "cuire.mjs"
Cohesion: 0.06
Nodes (26): BUTT, CLIPS, copy(), DOWN, files, half, here, HIP (+18 more)

### Community 57 - "_note"
Cohesion: 0.18
Nodes (12): _aim_breach(), _breaches(), _foe_est(), _heavy(), _hour(), _note(), _roles_update(), _set_phase() (+4 more)

### Community 59 - "closed_to"
Cohesion: 0.14
Nodes (8): ai_passage(), closed_owners(), closed_to(), eval_passage(), has_passage(), may_stay(), revoke_passage(), view_passage()

### Community 60 - "battle_log.py"
Cohesion: 0.11
Nodes (12): campaign_end(), _regs(), skirmish_end(), snapshot(), tactical(), write(), main(), mean() (+4 more)

### Community 61 - "avec"
Cohesion: 0.13
Nodes (4): ApresLaBataille, avec(), EffetsEconomiques, EffetsSurLaSociete

### Community 62 - "modeles.test.mjs"
Cohesion: 0.16
Nodes (13): Version simple de loin (deux modèles par figurine, mêmes animations), Charge graphique : triangles ≤ départ + 10 % (renderer.info), Décision 13 : mesure des triangles (renderer.info) sur trois vues types bocage, Décision 8 : deux versions par figurine, choix par régiment selon la hauteur à l'écran, T18 : banc des modèles, relevé de charge de départ, T21 : version simple de loin (seuils 18/14 px, régiments hors champ non dessinés), FOOT, HORSE (+5 more)

### Community 63 - "gestes.js"
Cohesion: 0.09
Nodes (39): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7d : mêlée et charges, 7e : vue de loin, 7f : scène, Étape 7 : animer les batailles et se rapprocher d'Ultimate General (SPEC-3D.md « Étape 7 », plan : décisions 14 à 22), homme() (+31 more)

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

### Community 73 - "README web_conquete (Conquête : Aquitaine 1700-1899)"
Cohesion: 0.07
Nodes (28): build(), add(), downstream(), piece(), _cut(), _project(), _seglen(), installer.sh script (+20 more)

### Community 75 - "Spec : tour par tour à la Total War (tour des IA d'un coup, villes prises pendant le tour, le temps en tours)"
Cohesion: 0.09
Nodes (21): Boundaries, Code Style, Commandes, Critères de réussite, Critères de réussite, Décisions prises, Décisions (validées le 18/10/2026), Fichiers touchés (+13 more)

### Community 76 - "_decide_withdraw"
Cohesion: 0.20
Nodes (5): _body(), _decide_withdraw(), _history(), _stalled(), _tenacity()

### Community 77 - "simulation.mjs"
Cohesion: 0.19
Nodes (17): ARM_YEARS, armOf(), b64(), fbm(), genMap(), genUnits(), lineDist(), mkUnit() (+9 more)

### Community 78 - "Décisions d'architecture"
Cohesion: 0.15
Nodes (3): from_dict(), Décisions d'architecture, Phase 0 : socle et arbre

### Community 79 - "Plan : batailles en 3D (SPEC-3D.md)"
Cohesion: 0.10
Nodes (20): 6a et 6b : figurines, 6c : lumière et couleurs, 6d : sol, 6e : arbres et fin, Décisions d'architecture, Graphe des dépendances, Liste des tâches, Liste des tâches (étape 6) (+12 more)

### Community 80 - "choose"
Cohesion: 0.14
Nodes (12): ask_alive(), ask_choices(), asking(), choose(), conquer(), pose(), resume(), strong() (+4 more)

### Community 81 - "test_campagne.py"
Cohesion: 0.12
Nodes (6): jouer_mois(), Production, RechercheEtPolitiques, Sauvegarde, SiegesEnTours, TempsReel

### Community 82 - "engine.py"
Cohesion: 0.12
Nodes (9): ordinal(), fbm(), _h(), _seg_inter(), vnoise(), Recherche de chemin A* avec terres interdites, Diplomatie et commerce, Cache de carte game/data/map_cache.json (+1 more)

### Community 83 - "check"
Cohesion: 0.20
Nodes (6): ai_build(), _ai_value(), check(), fits(), level_tech(), slot_count()

### Community 84 - "fire"
Cohesion: 0.18
Nodes (7): ai_policies(), apply_local(), fire(), stats(), tick(), tours_of(), _trading()

### Community 85 - "node_view"
Cohesion: 0.24
Nodes (8): describe_local(), fx_text(), _n(), node_view(), _pct(), per_k(), per_txt(), rules_payload()

### Community 89 - "Spec : les technologies et le rendu qui suit l'époque"
Cohesion: 0.11
Nodes (17): Branche, Carte des modules, Choix validés (questionnaires du 18/10/2026), Commandes, Critères de réussite (phases 0 et 1), Hypothèses (à corriger maintenant si besoin), La batterie de mitrailleuses (unité nouvelle), Limites (+9 more)

### Community 90 - "policy_w"
Cohesion: 0.50
Nodes (3): policy_w(), set_policy(), _set_policy()

### Community 91 - "canvas"
Cohesion: 0.46
Nodes (6): Fumées en quads instanciés face à la caméra, T10 : fumées, éclairs, boulets, éclats, poussière, flashSprite(), glowSprite(), puffSprite(), canvas()

### Community 92 - "Propositions : les technologies et le rendu qui suit l'époque (1700-1899)"
Cohesion: 0.12
Nodes (16): 0. Ce qui existe déjà, 1. Mettre l'arbre à jour, 1a. Dates, 1b. Technologies qui manquent (proposition, chacune avec ce qu'elle montrerait), 1c. La branche « social », 2. Le socle commun (une seule source de vérité), 3. L'animation de la découverte, 4. La grande campagne : une carte qui change avec les siècles (+8 more)

### Community 93 - "Liste des tâches (étape 7)"
Cohesion: 0.12
Nodes (16): 7a : figurines animées, 7b : tués, 7c : places et bâtiments, 7d : mêlée et charges, 7e : vue de loin, 7f : scène, Décisions d'architecture, Décisions d'architecture (+8 more)

### Community 95 - "views.py"
Cohesion: 0.14
Nodes (11): _effects(), _gen(), _legs(), migrate(), _order(), player_state(), _popy(), _reg() (+3 more)

### Community 96 - "advance"
Cohesion: 0.14
Nodes (10): _accumulate(), advance(), _candidates(), command(), go(), _item(), _new_acc(), _scan() (+2 more)

### Community 97 - "au"
Cohesion: 0.16
Nodes (3): au(), EcheancesEnTours, TempsEnTours

### Community 98 - "Tuto"
Cohesion: 0.21
Nodes (5): Tutoriel à bulles (premiers pas, armes en bataille), Étapes du tutoriel en données (ETAPES, comme tipStep), etapes(), placer(), Tuto

### Community 100 - "icon-180.png (app icon, 180px)"
Cohesion: 1.00
Nodes (4): icon-180.png (app icon, 180px), icon-192.png (app icon, 192px), icon-512.png (app icon, 512px), Heraldic shield with five vertical color stripes, cream star and year 1790 on navy background

### Community 108 - "month_end"
Cohesion: 0.18
Nodes (7): march_days(), month_days(), month_end(), phase(), ready_in(), view(), work()

### Community 109 - "college_k"
Cohesion: 0.40
Nodes (3): college_k(), daily(), research()

### Community 110 - "events.py"
Cohesion: 0.17
Nodes (13): affordable(), apply(), describe(), expire(), _fill(), fire(), _ord(), _pct() (+5 more)

### Community 111 - "P"
Cohesion: 0.29
Nodes (14): arm(), drum(), hands(), key(), LAY(), leg(), limb2(), LINSTOCK_ARM() (+6 more)

### Community 112 - "interface.test.mjs"
Cohesion: 0.11
Nodes (12): Bancs d'essai (tests/lancer.py, fabrique.py), Capture d'écran par Chromium sans écran (dev/capture.mjs), Banc d'essai simulé (dev/maquette.mjs, banc.html, cinq scénarios), Stratégie de test 3D (bancs Node, captures, essai à la main), element(), installer(), barre(), campagne() (+4 more)

### Community 114 - "maquette.mjs"
Cohesion: 0.17
Nodes (7): battles, here, JEU, json(), proxy(), TYPES, WEB

### Community 115 - "node_aa"
Cohesion: 0.22
Nodes (7): end_garde(), node_aa(), on_capture(), output_k(), passage_tick(), quarters_tick(), tick()

### Community 116 - "Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1"
Cohesion: 0.20
Nodes (9): Choix du 18/10/2026, Graphe des dépendances, Liste des tâches, Phase 0 : socle et arbre, Phase 1 : bataille-armes, Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1, Risques et parades, Vue d'ensemble (+1 more)

### Community 117 - "Troops"
Cohesion: 0.15
Nodes (9): Phase 1 : bataille-armes, Tâches : les technologies et le rendu qui suit l'époque (SPEC-TECH.md, plan : tasks/plan-tech.md), drapeau(), ordonnance(), flagSheet(), paintFlag(), pushOf(), Troops (+1 more)

### Community 118 - "main.js"
Cohesion: 0.50
Nodes (8): announceUpdate(), api, boot(), checkVersion(), poll(), resetUI(), showStart(), startPolling()

### Community 119 - "command"
Cohesion: 0.25
Nodes (5): command(), create(), default_deploy(), make_units(), _num()

### Community 121 - "hold"
Cohesion: 0.43
Nodes (7): AIM(), BAYONET(), FIRE(), hold(), inChest(), RAMMER(), THRUST()

### Community 122 - "suivre.js"
Cohesion: 0.29
Nodes (5): foes, id, mine, t, w

### Community 123 - "make_spec"
Cohesion: 0.40
Nodes (3): _att_angle(), make_spec(), _side_plan()

### Community 124 - "finish"
Cohesion: 0.33
Nodes (3): finish(), resolve_now(), tick()

### Community 125 - "Décision 9 : ombres de contact instanciées sous chaque figurine"
Cohesion: 1.00
Nodes (3): Décision 9 : ombres de contact instanciées sous chaque figurine, T23 : ombres de contact, CONTACT

### Community 126 - "migrate"
Cohesion: 0.33
Nodes (3): migrate(), new_state(), turn_start_after()

### Community 127 - "Module `bataille-armes` (phase 1)"
Cohesion: 0.33
Nodes (6): Batterie de mitrailleuses, Module `bataille-armes` (phase 1), Piquiers (régiments armés « mousquet et piques »), Pièces d'artillerie selon leur génération, Poudre noire, puis sans fumée, Vrais drapeaux d'époque

### Community 129 - "on_speed"
Cohesion: 0.50
Nodes (3): frozen(), on_speed(), waiting()

### Community 130 - "Équilibre de la campagne : avant et après les nouvelles technologies (18/10/2026)"
Cohesion: 0.40
Nodes (4): 1700 à 1730, 1790 à 1820 (les nouvelles technologies apparaissent dès 1794), À savoir pour lire ces chiffres, Équilibre de la campagne : avant et après les nouvelles technologies (18/10/2026)

## Ambiguous Edges - Review These
- `Polices Google Fonts (EB Garamond, IM Fell English)` → `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)`  [AMBIGUOUS]
  web/index.html · relation: conceptually_related_to

## Knowledge Gaps
- **16 isolated node(s):** `Événements historiques à choix (une trentaine, 1701-1898)`, `Classe Bataille (bataille.js)`, `Banc d'essai de la bataille (banc.html)`, `Saisons et météo (trois zones)`, `Terrain, marche à travers champs et embuscades` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 843 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Game` connect `Game` to `AI`, `skirmish.py`, `.grow_population`, `.move_army`, `.plan_legs`, `test_serveur.py`, `.log`, `.update_battles`, `Décisions d'architecture`, `server.py`, `.mod`, `engine.py`, `GeoMap`, `.settle_conflicts`, `.compute_income`, `partie`, `fabrique.py`, `views.py`?**
  _High betweenness centrality (0.169) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Game` (e.g. with `AI` and `from_dict()`) actually correct?**
  _`Game` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Événements historiques à choix (une trentaine, 1701-1898)`, `Classe Bataille (bataille.js)`, `Banc d'essai de la bataille (banc.html)` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `esc` be split into smaller, more focused modules?**
  _Cohesion score 0.10359408033826638 - nodes in this community are weakly interconnected._
- **Why does `Décisions d'architecture` connect `Décisions d'architecture` to `Mitrailleuses`, `troupes.js`, `.move_army`, `.log`, `P`, `formes.js`, `army_actions.py`, `Troops`, `.log`, `._fire`, `units.py`, `Plan : les technologies et le rendu qui suit l'époque, phases 0 et 1`, `make_spec`, `finish`?**
  _High betweenness centrality (0.150) - this node is a cross-community bridge._
- **Should `AI` be split into smaller, more focused modules?**
  _Cohesion score 0.05570611261668172 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Polices Google Fonts (EB Garamond, IM Fell English)` and `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._