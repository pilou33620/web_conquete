# Tâches : les technologies et le rendu qui suit l'époque (SPEC-TECH.md, plan : tasks/plan-tech.md)

Vérifications communes à chaque tâche : `python3 tests/lancer.py` passe ; pour le rendu, pas d'erreur dans la console
du banc d'essai et capture `node web/js/battle/dev/capture.mjs <scénario> <fichier.png> --q "year=…"` regardée
(`free -m` avant : au moins 1,5 Go de libre). Un commit par tâche, « Technologies, T5x : … ».

## Phase 0 : socle et arbre

- [ ] **T51 : banc d'équilibre et mesure de référence**
  - Critères : `outils/simuler.py --parties N --de 1700 --a 1800 --graine G` joue des campagnes aux IA seules, sans
    joueur. Il rend les erreurs, le nombre et la durée moyenne des guerres, les places de chaque camp à la fin,
    l'écart entre le premier et le dernier, et les technologies trouvées par camp. La référence (6 parties depuis 1700 et
    6 depuis 1790, 30 ans chacune : environ 20 s de calcul par an et par partie sur le Pi) est notée dans `tasks/equilibre-reference.md`.
  - Vérif : deux lancers avec la même graine donnent le même résultat ; un petit banc (`test_campagne.py`) joue deux
    fois deux mois par la même fonction et compare.
  - Fichiers : `outils/simuler.py`, `tests/test_campagne.py`, `tasks/equilibre-reference.md`
  - Taille : M

- [ ] **T52 : marques visibles, arme des régiments envoyée à la bataille**
  - Critères : `rules.VISUALS` et `rules.marks(techs)` (D1) ; `make_spec` envoie `marks` ; `Unit.view` envoie `arm` ;
    `rules_payload` envoie `visuals`. Le banc d'essai prend `?marks=sans_fumee,reffye` et donne à chaque régiment
    l'arme de l'année du scénario (ou `?arm=`).
  - Vérif : banc Python (un camp qui a `lebel` reçoit `sans_fumee`, l'autre non ; `arm` est dans la vue de chaque
    unité) ; banc d'essai ouvert avec `?year=1700` et `?year=1890` sans erreur.
  - Fichiers : `game/rules.py`, `game/tactics/bridge.py`, `game/tactics/units.py`, `game/views.py`,
    `web/js/battle/dev/simulation.mjs`, `tests/test_bataille.py`
  - Taille : M

- [ ] **T53 : branche « Civil et social », 21 technologies dans l'arbre**
  - Critères : le nom affiché et la phrase du panneau changent (l'identifiant reste `civil`). Les 21 technologies du
    tableau de la spec sont dans `TECHS` et `TECH_YEAR`, avec leurs prérequis, leurs clés `fx` (D4) et leur
    description. Les effets sont branchés par T54 à T58, d'ici là les clés sont lues nulle part. L'ancien bonus de
    `mitrailleuse` est retiré ; son effet viendra en T59. Les scénarios donnent les technologies d'avant leur
    `techs_before`. Chaque date porte sa source en commentaire.
  - Vérif : banc existant `test_technologies_en_tours_entiers` ; nouveau banc : chaque prérequis existe, pas de
    cycle, aucune technologie n'est cherchable avant son année, chaque clé `fx` est dans la liste des clés lues (le
    banc échoue tant que T54 à T58 manquent : il est ajouté en « attendu en échec », puis activé en T58) ; panneau des
    recherches regardé (capture).
  - Fichiers : `game/rules.py`, `web/js/ui.js`, `tests/test_campagne.py`
  - Taille : M

- [ ] **T54 : effets économiques**
  - Critères : `interest` (le trésor positif rapporte 2 % l'an, au mois), `city_livres` (+5 % aux villes et chefs-lieux),
    `build_cost` (−15 % de coût et de délai : construction, IA et prix affichés par une seule fonction), `upstream`
    (la remontée des fleuves va aussi vite que la descente), Fresnel (commerce +10 %, ports +15 %).
  - Vérif : un banc par effet, sur une partie fabriquée, avec et sans la technologie.
  - Fichiers : `game/engine.py`, `game/cities.py`, `game/ai.py`, `game/views.py`, `tests/test_campagne.py`
  - Taille : M

- [ ] **T55 : effets sur la société**
  - Critères :
    - étiquette `ev` et atténuation des événements (D5) : vaccine (épidémies, choléra), betterave (blocus), bouillie
      (phylloxéra, et le mildiou de 1882, événement nouveau à deux choix) ;
    - `weary` (suffrage) et `revolt` (mutuelles, selon l'écart 1 accepté) ;
    - `strikes` (syndicats : une fois par an, une ville à l'ordre bas perd un mois d'industrie, prévenue dans le bilan
      du tour) ;
    - moissonneuses (recrues, clé existante).
  - Vérif : bancs : le choléra tue moitié moins avec la vaccine, y compris trouvée après l'événement ; un ancien
    `tmod` sans étiquette reste entier ; lassitude plus lente ; grève seulement sous le seuil d'ordre.
  - Fichiers : `game/events.py`, `game/engine.py`, `game/cities.py`, `tests/test_campagne.py`
  - Taille : M

- [ ] **T56 : renseignement**
  - Critères : `intel` (photographie : les armées ennemies repérées montrent l'expérience et l'arme de leurs
    régiments ; l'interface les affiche comme pour les siennes) ; `alert` (téléphone : le bilan du tour annonce les
    armées ennemies qui entreront chez vous au tour suivant).
  - Vérif : banc de la vue (champs présents avec, absents sans) ; banc du bilan (une armée à un tour d'une place) ;
    bancs d'interface.
  - Fichiers : `game/views.py`, `game/turns.py`, `web/js/ui.js`, `tests/test_campagne.py`, `tests/interface.test.mjs`
  - Taille : M

- [ ] **T57 : après la bataille et à l'assaut**
  - Critères : `wounded` (Croix-Rouge : un quart des pertes reviennent aux régiments, en bataille tactique et
    automatique, sans dépasser leur effectif) ; `breach` (dynamite : à l'assaut, une brèche de plus et le seuil levé ;
    les batailles automatiques en tiennent compte).
  - Vérif : bancs : mêmes pertes, régiment plus fort après avec la Croix-Rouge ; une place peu entamée a une brèche
    avec la dynamite.
  - Fichiers : `game/tactics/bridge.py`, `game/engine.py`, `game/tactics/terrain.py`, `game/army_actions.py`,
    `tests/test_bataille.py`
  - Taille : M

- [ ] **T58 : pendant la bataille**
  - Critères : `balloon` (tout ennemi à 1 500 m d'un général valide du camp est vu) ; `entrench` (l'infanterie arrêtée
    depuis 5 minutes perd 25 % de moins au feu ; attribut `still_t`, défaut au chargement d'une bataille sauvegardée) ;
    `shell` (le couvert de la cible compte moitié moins contre l'artillerie de ce camp). Le banc des clés de T53 est
    activé.
  - Vérif : bancs de bataille pour chaque effet ; une bataille sauvegardée avant la tâche se recharge.
  - Fichiers : `game/tactics/battle.py`, `game/tactics/units.py`, `game/tactics/bridge.py`, `tests/test_bataille.py`
  - Taille : M

- [ ] **T59 : mitrailleuses, campagne**
  - Critères : type `mitrailleuses` (classe `artillerie`, `req='mitrailleuse'`, villes et chefs-lieux) ; les tests
    littéraux `type == 'artillerie'` passent par la classe (D6) ; coût, délai, réarmement, noms ; les IA en lèvent
    (MIX).
  - Vérif : `grep -n "== 'artillerie'" game/` ne laisse que des tests de classe ; bancs : levée refusée sans la
    technologie, permise avec ; une armée qui en a assiège, se ravitaille, recule, est sauvegardée et rechargée.
  - Fichiers : `game/rules.py`, `game/engine.py`, `game/ai.py`, `game/army_actions.py`, `tests/test_campagne.py`
  - Taille : M

- [ ] **T60 : mitrailleuses, bataille**
  - Critères : six pièces ; portées 1 200 et 2 000 m ; cadence élevée, munitions qui fondent vite ; feu en salve sur une
    bande étroite, sans boulet ni mitraille ; plus faible contre les pièces et les remparts ; l'IA de combat la
    place comme l'artillerie.
  - Vérif : bancs : contre une ligne en plaine, plus de pertes qu'une batterie de 8 pièces de la même année ; contre
    une batterie, moins ; munitions épuisées plus tôt.
  - Fichiers : `game/tactics/units.py`, `game/tactics/battle.py`, `game/tactics/ai.py`, `tests/test_bataille.py`
  - Taille : M

- [ ] **T61 : mitrailleuses, interface**
  - Critères : levée dans le panneau de la ville, nom et description ; fanion à son pictogramme ; en bataille, la
    batterie s'affiche avec la pièce actuelle en attendant T66.
  - Vérif : bancs d'interface ; capture du panneau de levée et d'une bataille avec une batterie.
  - Fichiers : `web/js/ui.js`, `web/js/battle/fanions.js`, `web/js/battle/formes.js`, `tests/interface.test.mjs`
  - Taille : S

- [ ] **Point 0** : tous les bancs ; `outils/simuler.py` sur les mêmes graines que la référence : pas d'erreur, et
  chaque mesure dans ±25 % de la référence (sinon on règle les tables) ; une sauvegarde d'avant le chantier jouée un
  an ; revue des effets avec toi ; commit.

## Phase 1 : bataille-armes

- [ ] **T62 : poudre noire, puis sans fumée**
  - Critères : `smokeless(un, marks)` (D9) ; salve et coup de canon sans fumée : éclair, voile bleuté léger de
    quelques secondes, pas de banc ; un camp à poudre noire garde ses nuages dans la même bataille.
  - Vérif : banc Node de `smokeless` (arme 6 et 7, artillerie avec et sans la marque) ; captures côte à côte, même
    salve en 1880 et 1890.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/effets.js`, `tests/gestes.test.mjs`
  - Taille : S

- [ ] **T63 : piquiers**
  - Critères : sorte `piquier` (D7), de près et de loin ; un homme sur cinq, au centre, sur toute la profondeur, pour
    l'infanterie d'arme 0 ; pique dressée au repos, en marche et pendant la salve, croisée à la charge et en mêlée ; en
    carré, piques croisées vers l'extérieur ; carte d'unité avec un piquier.
  - Vérif : bancs Node (proportion et place des piquiers, geste dans chaque état, os valides de près et de loin) ;
    captures en 1700 (ligne, charge, carré).
  - Fichiers : `web/js/battle/troupes.js`, `web/js/battle/gestes.js`, `web/js/battle/unites.js`,
    `tests/troupes.test.mjs`, `tests/gestes.test.mjs`
  - Taille : M

- [ ] **Point 1a** : galerie (1700 avec piquiers ; 1880 et 1890 avec et sans fumée), revue avec toi.

- [ ] **T64 : une pièce par génération d'artillerie**
  - Critères : modèles `ancien` (générations 0 et 1), `gribeauval`, `valee`, `lahitte`, `bange`, `75` (D8), de près et de
    loin, avec leurs avant-trains et caissons (bois naturel, olive, acier) ; sortes créées pour les seules générations
    présentes.
  - Vérif : banc Node (une pièce par génération, sortes à la demande) ; captures de chaque pièce en batterie et attelée.
  - Fichiers : `web/js/battle/troupes.js`, `tests/modeles.test.mjs`
  - Taille : M

- [ ] **T65 : pièces sur les cartes d'unités, recul du canon de 75**
  - Critères : la carte d'unité montre la pièce de sa génération ; le 75 recule sur son frein (le tube, pas l'affût) et
    a son bouclier.
  - Vérif : captures des cartes ; vidéo courte d'un coup du 75.
  - Fichiers : `web/js/battle/unites.js`, `web/js/battle/troupes.js`
  - Taille : S

- [ ] **T66 : pièce de Reffye, servants, crépitement**
  - Critères : modèle de la pièce (faisceau de canons, manivelle), de près, de loin et sur la carte ; quatre servants,
    dont un tourne la manivelle (geste existant le plus proche, choisi sur captures) ; tir en crépitement de petits
    éclairs, filet de fumée (presque rien sans fumée).
  - Vérif : bancs Node (servants, os) ; capture et vidéo d'une batterie qui tire.
  - Fichiers : `web/js/battle/troupes.js`, `web/js/battle/gestes.js`, `web/js/battle/effets.js`,
    `web/js/battle/unites.js`, `tests/gestes.test.mjs`
  - Taille : M

- [ ] **Point 1b** : galerie (une pièce par génération, une batterie de mitrailleuses qui tire) ; essai sur l'iPad
  (images par seconde au moins celles de l'étape 7).

- [ ] **T67 : vrais drapeaux d'époque**
  - Critères : `drapeau(year)` (tableau de la spec) ; planche des étoffes de la bataille (D10), quartiers de chaque
    régiment d'après la liste des couleurs historiques avant 1791 ; haut de hampe (lance, pique, aigle, coq) et
    cravate ; étendard de cavalerie plus petit, frangé ; milice et garde nationale (drapeau de la ville avant 1790) ;
    les fanions de l'interface gardent la couleur du camp.
  - Vérif : banc Node de `drapeau` (chaque année charnière) et de la planche (deux régiments, deux cases) ; captures en
    1700, 1793, 1808, 1815, 1820, 1840, 1860, 1880.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `tests/gestes.test.mjs`, `tests/modeles.test.mjs`
  - Taille : M

- [ ] **T68 : revue complète, README, galerie, état de la spec**
  - Critères : `/review` de tout le chantier et ses corrections ; README (technologies, mitrailleuses, rendu selon
    l'époque) ; galerie des six époques (1700, 1793, 1808, 1815, 1870, 1890) de près et de loin ; état noté dans
    `SPEC-TECH.md` ; proposer la mise à jour du graphe (`graphify update .`).
  - Vérif : tous les bancs ; essai sur l'iPad ; ton avis sur la galerie.
  - Fichiers : `README.md`, `SPEC-TECH.md`, `tasks/todo-tech.md`
  - Taille : S
