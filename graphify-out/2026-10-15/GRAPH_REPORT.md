# Graph Report - web_conquete  (2026-10-15)

## Corpus Check
- 72 files · ~268,208 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 2, .bat 2, .css 2)

## Summary
- 2300 nodes · 5617 edges · 108 communities (72 shown, 36 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 148 edges (avg confidence: 0.87)
- Token cost: 166,500 input · 0 output

## Community Hubs (Navigation)
- Interface campagne (ui.js)
- IA de campagne
- Troupes 3D et modèles
- Maquette et commandes
- Tour par tour
- Vue de bataille 3D
- Pont campagne-bataille
- Carte de campagne (rendu)
- Moteur : armées et recrutement
- Interface de bataille
- Bataille tactique (serveur)
- Serveur et mise à jour
- Carte vivante (ambiance)
- Carte : armées et jetons
- Peintre du sol (terrain.js)
- IA tactique : déploiement
- Formes partagées et docs 3D
- Bataille : mouvement et charge
- Bataille : tirs et contacts
- Actions d'armée : siège et travaux
- Unités tactiques
- Banc campagne et fabrique
- Décor 3D (arbres, bâti)
- Vues des joueurs
- Caméra orbitale 3D
- Banc bataille
- Relief 3D et décalques
- Qualité graphique et épis
- IA tactique : champ et flancs
- IA tactique : artillerie et soutien
- Génération du terrain tactique
- Effets et ciel
- IA tactique : décisions
- Escarmouche (bataille seule)
- Moteur : population
- IA tactique : carrés et charges
- Accueil et tutoriel (docs)
- Banc serveur : sauvegardes
- Génération des villes
- Diplomatie
- Règles et ralliement
- Textures du sol
- Sol détaillé 3D (tuiles)
- Doctrine et dispositions
- Carte géo (cases)
- Figurines des cartes d'unités
- Bilan et canons des places
- Dessins des villes
- Outil de capture
- Actions d'armée : réquisitions
- Événements historiques
- IA tactique : rôles et brèches
- Banc de l'interface
- Droits de passage
- Journal des batailles
- Serveur de la maquette
- Application serveur
- Carte : gestes et sélection
- Options et négociations
- Villes : effets des bâtiments
- Villes : emplacements
- Banc serveur : requêtes
- Requêtes HTTP
- Fortification et usure
- Territoire et passages
- Économie et provinces (docs)
- Villes du terrain tactique
- Voies d'eau
- IA : décision de retraite
- Fanions de bataille
- Spec et plan 3D
- Constructeur de décor
- Blocus et conquête
- Routes et fermes du terrain
- Bruit et géométrie
- IA de construction
- Villes : recherche et tic
- Villes : descriptions
- Bataille : début et fin
- Démarrage du client
- Bulle du tutoriel
- Politiques des villes
- Sprites de fumée
- Routes de la carte géo
- Pertes au canon
- IA des villes (docs)
- Installation et service
- Chargement de la carte géo
- Carte de bataille générée
- Modes de bataille (docs)
- Icônes de l'appli
- Script de lancement
- Événements et prestige
- Banc d'essai de bataille
- Saisons et météo
- Terrain et marche
- Unités et intendance

## God Nodes (most connected - your core abstractions)
1. `Game` - 189 edges
2. `TacticalBattle` - 113 edges
3. `clamp()` - 103 edges
4. `UI` - 93 edges
5. `MapView` - 77 edges
6. `AI` - 54 edges
7. `esc()` - 49 edges
8. `BattleUI` - 46 edges
9. `BattleView` - 41 edges
10. `GeoMap` - 35 edges

## Surprising Connections (you probably didn't know these)
- `Arbres en touffes arrondies, bois au toit bosselé` --conceptually_related_to--> `crownGeo()`  [INFERRED]
  SPEC-3D.md → web/js/battle/decor.js
- `Troupes en InstancedMesh animées dans le vertex shader (texture de données)` --references--> `layout()`  [INFERRED]
  tasks/plan.md → web/js/battle/troupes.js
- `toWorld par marche de rayon sur l'altitude` --conceptually_related_to--> `unproject()`  [INFERRED]
  tasks/plan.md → web/js/battle/camera.js
- `Décision 12 : couronnes en 3 à 5 touffes d'icosaèdres, deux versions par zone (750 m)` --conceptually_related_to--> `crownGeo()`  [INFERRED]
  tasks/plan.md → web/js/battle/decor.js
- `T19 : fantassins arrondis et taille (×1,6 gardé)` --references--> `SCALE`  [EXTRACTED]
  tasks/todo.md → web/js/battle/troupes.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Architecture du rendu 3D des batailles (décisions 1 à 6)** — tasks_plan_view_api_preserved, tasks_plan_two_canvas, tasks_plan_ground_tiles_lod, tasks_plan_instanced_troops, tasks_plan_smoke_billboards, tasks_plan_lambert_lighting [EXTRACTED 1.00]
- **Modes de résolution des batailles** — readme_manual_battles, readme_auto_resolution, readme_finish_auto, readme_battle_mode [EXTRACTED 1.00]
- **Étape 6 : refonte de l'allure façon Ultimate General** — spec_3d_step6_ug_rendering, spec_3d_rounded_soldiers, spec_3d_far_lod, spec_3d_filmic_lighting, spec_3d_relief_crops, spec_3d_ground_colors, spec_3d_worn_paths, spec_3d_tufted_trees [EXTRACTED 1.00]
- **Pages de développement du mode Bataille** — web_js_battle_dev_banc_banc, web_js_battle_dev_banc_bataille [INFERRED 0.75]
- **Tutoriel interactif de campagne** — spec_interactive_tutorial, spec_tutorial_steps_as_data, spec_tutorial_per_device, web_index_tuto_bubble, web_js_tuto, web_js_ui [INFERRED 0.85]

## Communities (108 total, 36 thin omitted)

### Community 0 - "Interface campagne (ui.js)"
Cohesion: 0.06
Nodes (20): esc(), coat(), ICON, speedIcon(), ACTION_LABEL, BRANCH_LABEL, de(), fmt() (+12 more)

### Community 2 - "Troupes 3D et modèles"
Cohesion: 0.07
Nodes (49): Version simple de loin (deux modèles par figurine, mêmes animations), Soldats arrondis construits par le code (sans glTF), tricorne relevé, Charge graphique : triangles ≤ départ + 10 % (renderer.info), Décision 9 : ombres de contact instanciées sous chaque figurine, Décision 7 : modèles arrondis par le code (LatheGeometry, CapsuleGeometry, mêmes os), Décision 13 : mesure des triangles (renderer.info) sur trois vues types bocage, Décision 8 : deux versions par figurine, choix par régiment selon la hauteur à l'écran, T18 : banc des modèles, relevé de charge de départ (+41 more)

### Community 3 - "Maquette et commandes"
Cohesion: 0.08
Nodes (21): centroid(), Controls, get(), server, b64(), fbm(), genMap(), genUnits() (+13 more)

### Community 4 - "Tour par tour"
Cohesion: 0.06
Nodes (30): _accumulate(), advance(), begin_turn(), _candidates(), command(), finish(), _fresh_place(), go() (+22 more)

### Community 5 - "Vue de bataille 3D"
Cohesion: 0.09
Nodes (7): Bataille, ensureStyle(), hasGL2(), wait(), waitFor(), profil(), BattleView

### Community 6 - "Pont campagne-bataille"
Cohesion: 0.05
Nodes (30): army_locked(), army_tick(), _att_angle(), auto_battle_tick(), battle_view(), campaign_tick(), command(), default_deploy() (+22 more)

### Community 10 - "Interface de bataille"
Cohesion: 0.11
Nodes (6): fmt(), stars(), BattleUI, hourOf(), short(), svg()

### Community 14 - "Serveur et mise à jour"
Cohesion: 0.08
Nodes (14): auto_update(), version(), banner(), _git(), _git_env(), GzipCache, is_headless(), is_raspberry() (+6 more)

### Community 15 - "Carte vivante (ambiance)"
Cohesion: 0.14
Nodes (5): along(), Ambient, frac(), polyline(), T

### Community 17 - "Carte : armées et jetons"
Cohesion: 0.09
Nodes (19): Commandes souris, doigt et stylet, Interface web (HTML/CSS/JS, rendu canvas de la carte), b64(), CLS_ORDER, darken(), fmtMen(), LEVELS, lighten() (+11 more)

### Community 18 - "Peintre du sol (terrain.js)"
Cohesion: 0.12
Nodes (5): vnoise(), offsetPts(), strokePts(), Terrain, culture()

### Community 19 - "IA tactique : déploiement"
Cohesion: 0.11
Nodes (19): _at(), _best_depth(), _cover_spot(), _deploy_field(), _deploy_place_att(), _deploy_place_def(), _flank_fire_spot(), _gun_spot() (+11 more)

### Community 20 - "Formes partagées et docs 3D"
Cohesion: 0.10
Nodes (27): Vue de bataille 3D web/js/battle (Three.js), Étape 6 : se rapprocher du rendu d'Ultimate General, Figurines 2D des cartes d'unités gardées (icônes d'interface), Troupes en InstancedMesh animées dans le vertex shader (texture de données), T17 : nettoyage du code 2D, README, captures des cartes, T6 : fantassins 3D, CELL_NAMES, CLS_OF_TYPE (+19 more)

### Community 23 - "Actions d'armée : siège et travaux"
Cohesion: 0.09
Nodes (15): bombard(), breach(), cell_mask(), closed_msg(), extra_food(), force_passage(), force_question(), fort_eff() (+7 more)

### Community 24 - "Unités tactiques"
Cohesion: 0.10
Nodes (11): ammo0_of(), cls_of(), footprint(), from_reg(), general(), milice(), pieces(), ranges() (+3 more)

### Community 25 - "Banc campagne et fabrique"
Cohesion: 0.13
Nodes (8): Bancs d'essai (tests/lancer.py, fabrique.py), Vérifications communes (lancer.py, console, capture), armee(), jouer_mois(), partie(), Regles, Sauvegarde, TourParTour

### Community 26 - "Décor 3D (arbres, bâti)"
Cohesion: 0.13
Nodes (15): Arbres en touffes arrondies, bois au toit bosselé, Décision 12 : couronnes en 3 à 5 touffes d'icosaèdres, deux versions par zone (750 m), T12 : arbres instanciés, T13 : maisons, église, moulins, ponts, portes, T14 : remparts, brèches, tranchées, haies, T27 : arbres touffus, troupes visibles dans les bois, clearable(), crownGeo() (+7 more)

### Community 27 - "Vues des joueurs"
Cohesion: 0.11
Nodes (13): ordinal(), _effects(), from_dict(), _gen(), _legs(), migrate(), _order(), player_state() (+5 more)

### Community 28 - "Caméra orbitale 3D"
Cohesion: 0.17
Nodes (21): Repère : x→X, y (sud)→Z, altitude→Y, 1 m = 1 unité, toWorld par marche de rayon sur l'altitude, Deux canevas : WebGL dessous, calque 2D dessus (fanions, gestes, tracés, pluie), T15 : ombres portées, T2 : caméra orbitale et ses bancs, T3 : vue WebGL, relief, régiments en blocs, calque 2D, T4 : gestes, tracés au sol, mini-carte, cams (+13 more)

### Community 29 - "Banc bataille"
Cohesion: 0.15
Nodes (8): avancer(), bataille(), ennemi(), face_a_face(), kind(), ordre(), BatailleEntiere, OrdresParArme

### Community 30 - "Relief 3D et décalques"
Cohesion: 0.13
Nodes (4): cloudTexture(), Decals, Relief, ticks()

### Community 31 - "Qualité graphique et épis"
Cohesion: 0.12
Nodes (18): Résolution automatique des batailles, Objectif ≥ 30 images/s sur iPad 2019 en qualité Haute, Cultures en relief près de la caméra (épis qui ondulent, ~300 m), Décision 11 : cultures en relief par coquilles empilées et masque de végétation, T16 : qualité, mesure, sans WebGL 2, T26 : cultures en relief, appareil(), devine() (+10 more)

### Community 32 - "IA tactique : champ et flancs"
Cohesion: 0.12
Nodes (14): _advance(), _clamp(), _einf(), _fine_halt(), _flank_group(), _foe_dist(), _front_dep(), _march_form() (+6 more)

### Community 33 - "IA tactique : artillerie et soutien"
Cohesion: 0.13
Nodes (15): _apply(), _art_target(), _artillery(), _cav_near(), _d2(), _fetch(), _form(), _goto() (+7 more)

### Community 34 - "Génération du terrain tactique"
Cohesion: 0.14
Nodes (13): _add_bridge(), bfs(), blur(), _clip_poly(), _densify(), _force_bridge(), generate(), _mill() (+5 more)

### Community 35 - "Effets et ciel"
Cohesion: 0.17
Nodes (5): Lumière douce : courbe filmique, ombres teintées, ombres de contact, Décision 10 : NeutralToneMapping, ombres PCF douces, ciel plus fort, sans post-traitement, T22 : courbe filmique, soleil, ciel, ombres douces, Effects, mix3()

### Community 36 - "IA tactique : décisions"
Cohesion: 0.16
Nodes (15): _adopt(), _adopt_unit(), _announced(), _cat(), _choose_plan(), _counter_charge(), deploy(), _groups() (+7 more)

### Community 37 - "Escarmouche (bataille seule)"
Cohesion: 0.14
Nodes (12): _count(), _foe_units(), _fort(), _local(), new(), _open_ground(), options(), _pick_season() (+4 more)

### Community 39 - "IA tactique : carrés et charges"
Cohesion: 0.11
Nodes (13): _ang(), _bayonets(), _cav_target(), _cavalry(), _charge_ok(), _foe(), _gun_front(), _gun_zones() (+5 more)

### Community 40 - "Accueil et tutoriel (docs)"
Cohesion: 0.13
Nodes (17): Brouillard de guerre et espions, Récapitulatif du mois, Temps réel avec pause (réglage avancé), Tutoriel à bulles (premiers pas, armes en bataille), Spec : tutoriel interactif (campagne et bataille), Bulles de bataille déclenchées par la situation (une fois chacune), Tutoriel de campagne en 15 bulles qui attendent l'action, Étapes du tutoriel en données (ETAPES, comme tipStep) (+9 more)

### Community 41 - "Banc serveur : sauvegardes"
Cohesion: 0.10
Nodes (3): Visites, Connexions, Sauvegardes

### Community 42 - "Génération des villes"
Cohesion: 0.11
Nodes (9): _fill(), _hilly(), local_ok(), prestige(), _river(), _troops(), upkeep(), _w_crue() (+1 more)

### Community 43 - "Diplomatie"
Cohesion: 0.17
Nodes (14): act(), ai_evaluate(), answer(), apply(), declare_war(), exchange_prisoners(), held(), lost_nodes() (+6 more)

### Community 45 - "Règles et ralliement"
Cohesion: 0.10
Nodes (11): de(), nb(), num(), pl(), pop_curve(), _rural(), _town(), Technologies datées et armement par époque (réarmement) (+3 more)

### Community 46 - "Textures du sol"
Cohesion: 0.26
Nodes (20): Couleurs du sol : blé or doux, teintes par parcelle, herbe variée, T24 : couleurs du sol, hash(), hexRgb(), blade(), CROP, css(), CULTURES (+12 more)

### Community 47 - "Sol détaillé 3D (tuiles)"
Cohesion: 0.15
Nodes (16): Sol peint par terrain.js posé sur le relief 3D, Chemins larges et usés (ornières, herbe au milieu), Tuiles de texture du sol selon la distance à la caméra, Lumière Lambert, soleil selon l'heure, onBeforeCompile du sol, T11 : lumière, ciel, brume, météo, T25 : chemins larges et usés, T5 : tuiles de texture du sol, décalcomanies, brèches, couverts, cellRemap() (+8 more)

### Community 48 - "Doctrine et dispositions"
Cohesion: 0.21
Nodes (16): ACTIONS, actionsOf(), aide, arme(), armeOf(), FIRE_MODES, ORDER_LABEL, ordresHtml() (+8 more)

### Community 51 - "Figurines des cartes d'unités"
Cohesion: 0.25
Nodes (5): dark(), headgear(), lite(), pen(), UnitArt

### Community 52 - "Bilan et canons des places"
Cohesion: 0.19
Nodes (12): load(), main(), mean(), mean100(), num(), pct(), ratio(), table() (+4 more)

### Community 53 - "Dessins des villes"
Cohesion: 0.21
Nodes (4): Carte vivante : villes en vue cavalière et animations d'ambiance, shade(), STYLE, TownArt

### Community 54 - "Outil de capture"
Cohesion: 0.12
Nodes (10): argv, chrome, errors, here, js, maq, out, profile (+2 more)

### Community 55 - "Actions d'armée : réquisitions"
Cohesion: 0.20
Nodes (13): aa(), ai_siege(), ai_step(), cd_left(), command(), contribution(), garde(), garde_info() (+5 more)

### Community 56 - "Événements historiques"
Cohesion: 0.23
Nodes (11): affordable(), apply(), describe(), expire(), _fill(), fire(), _ord(), _pct() (+3 more)

### Community 57 - "IA tactique : rôles et brèches"
Cohesion: 0.18
Nodes (12): _aim_breach(), _breaches(), _foe_est(), _heavy(), _hour(), _note(), _roles_update(), _set_phase() (+4 more)

### Community 58 - "Banc de l'interface"
Cohesion: 0.17
Nodes (7): element(), installer(), barre(), campagne(), dom, JS, panneau()

### Community 59 - "Droits de passage"
Cohesion: 0.14
Nodes (8): ai_passage(), closed_owners(), closed_to(), eval_passage(), has_passage(), may_stay(), revoke_passage(), view_passage()

### Community 60 - "Journal des batailles"
Cohesion: 0.24
Nodes (6): campaign_end(), _regs(), skirmish_end(), snapshot(), tactical(), write()

### Community 62 - "Serveur de la maquette"
Cohesion: 0.15
Nodes (7): battles, here, JEU, json(), proxy(), TYPES, WEB

### Community 65 - "Options et négociations"
Cohesion: 0.22
Nodes (11): clamp(), ctb_info(), end_garde(), fortify_info(), neg_info(), negotiate(), node_aa(), on_capture() (+3 more)

### Community 66 - "Villes : effets des bâtiments"
Cohesion: 0.24
Nodes (9): _add(), bfx(), growth_k(), node_extra(), pfx(), stab_bonus(), train_k(), train_xp() (+1 more)

### Community 67 - "Villes : emplacements"
Cohesion: 0.21
Nodes (8): demolish(), finish(), level_name(), migrate(), _milice(), slot_build(), slots(), sync()

### Community 70 - "Fortification et usure"
Cohesion: 0.23
Nodes (10): arrive(), fortify(), neg_tick(), passage_tick(), place(), quarters_tick(), tick(), wear_tick() (+2 more)

### Community 71 - "Territoire et passages"
Cohesion: 0.17
Nodes (6): crossed(), incident(), land_owner(), land_tick(), trespassed(), way_out()

### Community 73 - "Économie et provinces (docs)"
Cohesion: 0.21
Nodes (10): README web_conquete (Conquête : Aquitaine 1700-1899), Cinq départements / provinces d'Aquitaine, Économie : ressources, minimum garanti, spécialités, INSEE via @etalab/decoupage-administratif, france-geojson (IGN, Licence Ouverte), Natural Earth (fleuves et lacs), 223 lieux : chefs-lieux, villes, villages, places fortes, Population historique sur deux siècles (+2 more)

### Community 74 - "Villes du terrain tactique"
Cohesion: 0.23
Nodes (8): _barricades(), cell_of(), _hash(), _line_cells(), noise(), _poly_cells(), _redoubts(), _town()

### Community 75 - "Voies d'eau"
Cohesion: 0.24
Nodes (7): build(), add(), downstream(), piece(), _cut(), _project(), _seglen()

### Community 76 - "IA : décision de retraite"
Cohesion: 0.20
Nodes (5): _body(), _decide_withdraw(), _history(), _stalled(), _tenacity()

### Community 77 - "Fanions de bataille"
Cohesion: 0.33
Nodes (10): L'entrée : champ de bataille en 3D (sol peint, blé en relief, figurines, fanions), Style Ultimate General : American Revolution (référence visuelle), T9 : fanions façon Ultimate General, banner(), drawBanners(), lite(), medallion(), men() (+2 more)

### Community 78 - "Spec et plan 3D"
Cohesion: 0.24
Nodes (10): Spec : batailles en 3D (style Ultimate General), Capture d'écran par Chromium sans écran (dev/capture.mjs), Banc d'essai simulé (dev/maquette.mjs, banc.html, cinq scénarios), Stratégie de test 3D (bancs Node, captures, essai à la main), Three.js r186 embarqué (web/vendor/three, sans CDN ni addons), Plan : batailles en 3D, Livraison en cinq étapes jouables (blocs, troupes, feu, décor, finitions), Tâches : batailles en 3D (+2 more)

### Community 80 - "Blocus et conquête"
Cohesion: 0.20
Nodes (6): blockade(), blockade_tick(), conquer(), defenders(), force_ratio(), foreign_place()

### Community 81 - "Routes et fermes du terrain"
Cohesion: 0.20
Nodes (6): center_of(), _farms(), _hedge_lines(), _meander(), _path_to_road(), _walls()

### Community 82 - "Bruit et géométrie"
Cohesion: 0.28
Nodes (5): fbm(), _h(), vnoise(), Recherche de chemin A* avec terres interdites, Cache de carte game/data/map_cache.json

### Community 83 - "IA de construction"
Cohesion: 0.22
Nodes (5): ai_build(), _ai_value(), check(), fits(), level_tech()

### Community 84 - "Villes : recherche et tic"
Cohesion: 0.25
Nodes (6): apply_local(), daily(), fire(), research(), stats(), tick()

### Community 85 - "Villes : descriptions"
Cohesion: 0.25
Nodes (7): describe_local(), fx_text(), _n(), node_view(), _pct(), rules_payload(), slot_count()

### Community 88 - "Démarrage du client"
Cohesion: 0.50
Nodes (8): announceUpdate(), api, boot(), checkVersion(), poll(), resetUI(), showStart(), startPolling()

### Community 90 - "Politiques des villes"
Cohesion: 0.25
Nodes (5): ai_policies(), policy_w(), set_policy(), _set_policy(), _trading()

### Community 91 - "Sprites de fumée"
Cohesion: 0.46
Nodes (6): Fumées en quads instanciés face à la caméra, T10 : fumées, éclairs, boulets, éclats, poussière, flashSprite(), glowSprite(), puffSprite(), canvas()

### Community 94 - "IA des villes (docs)"
Cohesion: 0.33
Nodes (4): Politique de la ville, Emplacements et chaînes de bâtiments des villes, IA des départements (mêmes règles, ne thésaurisent plus), Événements locaux des villes

### Community 95 - "Installation et service"
Cohesion: 0.33
Nodes (3): installer.sh script, Sauvegarde automatique au début de chaque mois (saves/), Service systemd web_conquete sur Raspberry Pi (iPad comme écran)

### Community 98 - "Modes de bataille (docs)"
Cohesion: 0.50
Nodes (4): Mode Bataille sans campagne (skirmish.py), Finir automatiquement (IA des officiers en accéléré), Batailles manuelles en temps réel avec pause (game/tactics), Écran d'accueil #start et chargement

### Community 100 - "Icônes de l'appli"
Cohesion: 1.00
Nodes (4): icon-180.png (app icon, 180px), icon-192.png (app icon, 192px), icon-512.png (app icon, 512px), Heraldic shield with five vertical color stripes, cream star and year 1790 on navy background

## Ambiguous Edges - Review These
- `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)` → `Polices Google Fonts (EB Garamond, IM Fell English)`  [AMBIGUOUS]
  web/index.html · relation: conceptually_related_to

## Knowledge Gaps
- **16 isolated node(s):** `Cache de carte game/data/map_cache.json`, `Tutoriel à bulles (premiers pas, armes en bataille)`, `Événements historiques à choix (une trentaine, 1701-1898)`, `Terrain, marche à travers champs et embuscades`, `Unités, intendance et prisonniers` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 617 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Game` connect `Moteur : armées et recrutement` to `IA de campagne`, `Escarmouche (bataille seule)`, `Moteur : population`, `Requêtes HTTP`, `Moteur : déplacements et contacts`, `Banc serveur : sauvegardes`, `Moteur : journal et batailles`, `Moteur : revenus et blocus`, `Moteur : puissance et tactiques`, `Serveur et mise à jour`, `Moteur : marche et attrition`, `Banc campagne et fabrique`, `Vues des joueurs`?**
  _High betweenness centrality (0.205) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Game` (e.g. with `AI` and `from_dict()`) actually correct?**
  _`Game` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Cache de carte game/data/map_cache.json`, `Tutoriel à bulles (premiers pas, armes en bataille)`, `Événements historiques à choix (une trentaine, 1701-1898)` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Interface campagne (ui.js)` be split into smaller, more focused modules?**
  _Cohesion score 0.05847665847665848 - nodes in this community are weakly interconnected._
- **Why does `TacticalBattle` connect `Bataille tactique (serveur)` to `Pont campagne-bataille`, `Bataille : ordres et approche`, `Bataille : moral et déroute`, `Bataille : mouvement et charge`, `Bataille : tirs et contacts`, `Bataille : début et fin`, `Bataille : traits et vision`, `Pertes au canon`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Should `IA de campagne` be split into smaller, more focused modules?**
  _Cohesion score 0.05570611261668172 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Three.js r186 embarqué (web/vendor/three, sans CDN ni addons)` and `Polices Google Fonts (EB Garamond, IM Fell English)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._