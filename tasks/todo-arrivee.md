# Tâches : choisir à l'arrivée devant une ville (SPEC-TOURS.md, « Évolution du 18/10/2026 » ; plan : tasks/plan-arrivee.md)

## Phase 1 : le moteur

- [x] **T1 : l'arrivée pose le choix ; « Attendre » ; « Tour suivant » attend**
  - Fait : `army_actions.pose` (chemin et cible mis de côté dans `a['ask']`, halte, pause en temps réel), `asking`,
    `choose` (« attendre ») ; `engine.arrive_node(..., ask=True)` pose le choix pour le joueur (contrôle périodique :
    `ask=False`) ; `bridge.on_speed` refuse « Tour suivant » ; « Rallier ou attaquer » rouvre le choix. Bancs
    `ArriveeDevantUneVille` (cas du rapport dans les deux ordres, Traverser, réglage automatique, attendre, IA) ; les
    deux bancs de l'ancien comportement réduits à leur partie choix (complétés en T2).
  - Une armée du joueur qui arrive en marche devant une ville qui n'est pas à lui (cible ou en chemin) s'arrête, son
    chemin mis de côté, et porte un choix en attente ; quel que soit le réglage des batailles.
  - Inchangés : ville alliée, voisin en paix, retraite, « Traverser » en chemin (la cible demande), place investie par
    un autre camp, bataille déjà sur place, place sans défense, notre siège qu'on rejoint ; les IA ; le contrôle
    périodique d'une armée restée sur une place hostile.
  - « Attendre » lève le choix : l'armée reste en halte, les actions dans son panneau.
  - « Tour suivant » et la reprise du temps sont refusés tant qu'un choix attend ; en temps réel, l'arrivée met en
    pause.
  - Vérif : `tests/test_campagne.py` (classe `ArriveeDevantUneVille`) : le cas du rapport (Guyenne 1700 : trois
    détachements sur Mérignac, Cestas, Léognan, les deux ordres ; Villenave-d'Ornon en chemin pose aussi un choix) ;
    « Traverser » ; réglage « toujours automatique » ; « Tour suivant » refusé ; une IA qui arrive devant une ville
    du joueur fait comme avant ; `python3 tests/lancer.py`.
  - Fichiers : `game/engine.py`, `game/army_actions.py`, `game/tactics/bridge.py`, `tests/test_campagne.py`
  - Taille : M

- [x] **T2 : les autres choix**
  - Fait : `army_actions.ask_choices` (choix permis et raisons, d'après la fiche de la place), `choose` (assaut au
    mode déjà choisi via `start_battle` + `bridge.command`, rallier, assiéger par `arrive_node(ask=False)`, négocier,
    contribution, bloquer), `resume` (la route reprend après un choix sans combat). Bancs : un par choix, refus (trop
    faible, sans remparts, choix inconnu), le rapport de bout en bout ; mutation « trois fois la défense » détectée.
  - Commander la bataille : assaut démarré (même place à remparts), bataille en mode manuel sans seconde fenêtre.
  - Résolution automatique : assaut réglé sur-le-champ ; l'armée s'arrête là (une bataille finit la marche).
  - Rallier (ville neutre, armée au moins 3 fois plus forte) ; négocier ; contribution : l'armée reprend sa route avec
    la marche qui lui reste.
  - Assiéger (place à remparts) ; bloquer : l'armée reste devant la place.
  - Un choix non permis est refusé avec sa raison ; « Rallier ou attaquer » d'une armée en halte rouvre le choix.
  - Vérif : un banc par choix ; rallier refusé quand l'armée est trop faible, assiéger refusé sans remparts ;
    `python3 tests/lancer.py`.
  - Fichiers : `game/army_actions.py`, `game/engine.py`, `game/tactics/bridge.py`, `tests/test_campagne.py`
  - Taille : M

- [x] **Point de contrôle 1** (18/10/2026, `test_le_rapport_de_bout_en_bout`) : bancs ; le cas du rapport joué au banc de bout en bout (chaque détachement choisit,
  plus aucune bataille laissée pour la fin du tour).

## Phase 2 : l'écran

- [x] **T3 : état envoyé, commande du serveur, fenêtre « arrivée »**
  - Fait : `view_army` envoie `ask` (ville, choix permis et raisons) ; commande `arrive` (identifiant d'armée
    vérifié, `bid` renvoyé pour « Commander la bataille », marches reprises) ; message de l'ordre de marche « Devant X :
    à vous de choisir » ; `ui.arriveeModal` (choix permis, les autres grisés avec leur raison), ouverte d'elle-même
    après les batailles en attente ; « Tour suivant » grisé tant qu'une armée attend. Bancs serveur et interface.
  - `views.player_state` envoie les choix en attente (armée, ville, options permises et leur raison) ; la commande
    `arrive` du serveur transmet le choix (armée du joueur, valeur connue, sinon refus).
  - La fenêtre s'ouvre d'elle-même (une à la fois, comme celle des batailles), titre « Devant <ville> » ; les options
    non permises sont absentes ou grisées avec leur raison.
  - Vérif : `tests/test_serveur.py` (commande refusée pour une armée d'un autre camp, une valeur inconnue) ;
    `tests/interface.test.mjs` (la fenêtre s'ouvre sur un état avec un choix, montre les options permises) ;
    `python3 tests/lancer.py`.
  - Fichiers : `game/views.py`, `server.py`, `web/js/ui.js`, `tests/test_serveur.py`, `tests/interface.test.mjs`
  - Taille : M

- [ ] **T4 : README, essai sur le vrai serveur, revue**
  - README (section tour par tour) ; état dans SPEC-TOURS.md.
  - Essai : le vrai serveur (sauvegardes à part), Guyenne 1700, Bordeaux scindée en trois, une marche par détachement :
    la fenêtre s'ouvre à chaque ville, sans erreur dans la console (Chromium sans écran).
  - /review de tout le chantier, corrections commitées.
  - Fichiers : `README.md`, `SPEC-TOURS.md`
  - Taille : S

- [ ] **Point de contrôle final** : critères de réussite 1 à 5 de la spec ; revue faite et corrigée.
