# Tâches : l'arbre des technologies et « Moderniser » (SPEC-ARBRE.md, plan : tasks/plan-arbre.md)

Vérifications communes à chaque tâche : `python3 tests/lancer.py` passe. Un commit par tâche, « Arbre, A? : … ».

- [x] **A1 : deux branches militaires**
  - Critères :
    - `BRANCHES` a cinq branches et chaque technologie militaire va dans `infanterie` ou `artillerie` (D1).
    - Les libellés suivent : « Infanterie et cavalerie », « Artillerie et génie ».
    - L'IA cherche dans cinq branches, avec son goût `militaire` traduit (D3) et ses seuils de 4 à 5.
    - La gravure garde le canon pour les deux branches militaires.
    - Les sauvegardes migrent leur recherche (D2).
  - Vérif :
    - test : une sauvegarde avec une recherche `militaire` en cours se charge dans la bonne branche ;
    - test : deux recherches militaires vont en parallèle ;
    - `decouvertes.test.mjs` est mis à jour.
  - Fichiers : `game/rules.py`, `game/ai.py`, `game/views.py`, `web/js/ui.js`, `web/js/decouvertes.js`,
    `tests/test_campagne.py`, `tests/decouvertes.test.mjs`
  - Taille : S

- [ ] **A2 : recherche libre, prérequis entre branches, durée selon l'étage**
  - Critères :
    - `research`, `ai.research` et la fenêtre ne lisent plus `TECH_YEAR` ;
    - `REQ_PLUS` est en place (la table de la spec) ;
    - durée = 190 ans × (1 + étage) ÷ somme de la branche, arrondie au tour.
  - Vérif (tests de règles) :
    - pas de cycle ;
    - aucun prérequis ajouté plus récent que sa technologie ;
    - chaque branche dure 190 ans ±1 tour ;
    - Lebel possible en 1700 avec ses prérequis, refusé sans eux ;
    - les départs 1790, 1813 et 1870 ont des technologies cohérentes.
  - Fichiers : `game/rules.py`, `game/engine.py`, `game/ai.py`, `web/js/ui.js`, `tests/test_campagne.py`
  - Taille : M

- [ ] **A3 : la fenêtre en arbre**
  - Critères :
    - cinq onglets, avec la recherche en cours en tête ;
    - les cases par étage, et les traits des prérequis de la même branche ;
    - les prérequis d'autres branches écrits dans la case ;
    - la fiche de la case choisie (description, coût, durée, année historique et avance, bouton Rechercher) ;
    - défilement horizontal ; cases au clavier.
  - Vérif :
    - `arbrePlace` testée (une case par technologie, un trait par prérequis de même branche, pas deux cases au même
      endroit) ;
    - capture de la fenêtre sur le Pi (navigateur sans tête), regardée.
  - Fichiers : `web/js/ui.js` (ou `web/js/arbre.js` si `ui.js` grossit trop), `web/css/*.css`,
    `tests/interface.test.mjs`
  - Taille : M

- [ ] **A4 : manœuvres par régiment (règles, résolution automatique, fiches)**
  - Critères :
    - `MANEUVERS`, `REG_KEYS` et `engine.reg_mods` (D4) ;
    - les nouveaux régiments, la milice et les régiments migrés ont les manœuvres de leur camp (D2) ;
    - `reg_power`, `update_battles` et `views._reg` lisent `reg_mods` (D5) ;
    - les manœuvres sont dans la vue des régiments, y compris les armées ennemies repérées avec la photographie.
  - Vérif :
    - test : un régiment sans feu de rang n'a pas les +12 %, l'autre si ;
    - test : un régiment au fusil à silex n'a pas le +10 % du Chassepot ;
    - test : une sauvegarde d'avant garde ses forces.
  - Fichiers : `game/rules.py`, `game/engine.py`, `game/views.py`, `tests/test_campagne.py`
  - Taille : M

- [ ] **A5 : manœuvres par régiment en bataille tactique**
  - Critères :
    - `make_spec` donne `md` à chaque unité ; `battle.tech_of(u)` remplace `tech(side)` partout où l'effet est de
      régiment ;
    - `entrench` et `shell` passent par l'unité ;
    - les scénarios du banc d'essai sans campagne marchent tels quels.
  - Vérif :
    - `test_bataille.py` : deux lignes identiques, une avec feu de rang, et la fusillade diffère ;
    - un scénario du banc d'essai ouvert sans erreur.
  - Fichiers : `game/tactics/bridge.py`, `game/tactics/battle.py`, `game/tactics/units.py`, `tests/test_bataille.py`
  - Taille : M

- [ ] **A6 : le bouton « Moderniser » et l'IA**
  - Critères :
    - `modernize_cost` et `modernize` : armes et manœuvres, 0,1 livre par homme et par manœuvre, 10 jours (D6) ;
    - une marche annule l'entraînement ; en tour par tour, l'armée perd 10 jours de marche ;
    - le bouton dit ce qui change et combien ; la marque « À moderniser » apparaît ; l'aide est à jour ;
    - l'IA modernise et reste dans la place pendant l'entraînement.
  - Vérif :
    - tests : bon prix, 10 jours, annulation en marchant, garnison modernisée, −15 % d'expérience seulement si les armes
      changent ;
    - test : une IA qui a une manœuvre nouvelle modernise ses armées en moins de trois mois ;
    - `interface.test.mjs` passe.
  - Fichiers : `game/engine.py`, `game/army_actions.py`, `game/turns.py`, `game/ai.py`, `game/views.py`, `server.py`,
    `web/js/ui.js`, tests
  - Taille : M

- [ ] **A7 : banc d'équilibre et réglages**
  - Critères :
    - `outils/simuler.py` rend aussi l'année où chaque camp obtient Gribeauval, la percussion, les canons rayés et le
      Chassepot ;
    - bancs 1700 et 1790 (6 parties, 30 ans) et un banc long 1700 à 1890 (2 parties, en arrière-plan) ;
    - réglage du prix des manœuvres et du choix des recherches de l'IA si besoin.
  - Vérif : `tasks/equilibre-reference.md` reçoit une section « Arbre (A7) » ; les critères 6 de la spec sont tenus,
    sinon l'écart est écrit et expliqué.
  - Fichiers : `outils/simuler.py`, `tasks/equilibre-reference.md`, `game/rules.py`, `game/ai.py`
  - Taille : M (dont environ 3 h de calcul sur le Pi)

- [ ] **A8 : documentation et revue**
  - Critères :
    - `README.md` à jour : technologies, armement par époque, « Moderniser » ;
    - revue complète du chantier (/review), avec ses corrections ;
    - proposer de mettre le graphe à jour (/graphify).
  - Fichiers : `README.md`, `SPEC-ARBRE.md` (état)
  - Taille : S
