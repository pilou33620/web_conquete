# Tâches : tour par tour à la Total War (SPEC-TOURS.md, plan : tasks/plan.md)

Vérification commune à chaque tâche : `python3 tests/lancer.py` passe, puis un commit.

## Partie 1 : le tour des IA

- [x] **T1 : le tour des IA calculé d'un coup, sans rythme**
  - « Tour suivant » joue le mois par tranches d'environ 0,25 s de calcul, jusqu'au 1er du mois suivant.
  - Plus de rythme (Lent, Normal, Rapide, Éclair) : ni bouton, ni touches 1 à 4, ni réglage dans le menu. La barre
    du haut affiche « Les IA jouent… » et la progression. Une sauvegarde qui a un champ `pace` se charge.
  - Vérifier : banc `test_campagne.py` (un mois joué en appelant `advance` sans attendre le temps réel ; l'ancien
    `pace` ignoré) ; banc de l'interface (la barre n'a plus de rythme) ; mesure du temps d'un mois sur le Raspberry,
    en 1790 et sur une sauvegarde avancée (objectif : moins de 3 s).
  - Fichiers : `game/turns.py`, `server.py`, `web/js/ui.js`, `tests/test_campagne.py`, `tests/interface.test.mjs`
  - Taille : M

- [x] **T2 : arrêts seulement quand le joueur doit choisir, reprise automatique**
  - Le tour des IA s'arrête seulement sur : une bataille où le joueur a une armée ou une place, une décision qui
    l'attend, la fin de la partie. Plus de bouton « Arrêter ».
  - Entrée d'une armée ennemie, siège contre lui, bataille voisine, guerre, proposition, nouvelle époque, traité :
    pas d'arrêt, et présents dans le récapitulatif du mois.
  - Après le choix (bataille réglée par le général ou jouée, décision prise), le tour des IA reprend tout seul.
  - Vérifier : bancs `test_campagne.py` (une IA attaque une armée du joueur → arrêt, reprise après le choix ; une
    déclaration de guerre → pas d'arrêt, dans le récap) ; banc de l'interface (plus de bouton Arrêter).
  - Dépend de : T1
  - Fichiers : `game/turns.py`, `game/engine.py` (`alert_pause`), `game/tactics/bridge.py`, `web/js/ui.js`,
    `tests/test_campagne.py`
  - Taille : M

- [x] **T3 : ville neutre prise tout de suite pendant le tour du joueur**
  - Pendant le tour du joueur, une armée assez forte qui arrive devant une ville neutre la rallie tout de suite : la
    ville est à lui, la date ne bouge pas, l'armée n'a plus de marche ce tour (et garde son chemin pour le tour
    suivant).
  - Ville neutre trop forte : comme aujourd'hui (bataille, ou siège si remparts de niveau 2 ou plus). Les IA :
    ralliement en quelques jours comme avant.
  - Vérifier : banc `test_campagne.py` (marche sur Bergerac par Sainte-Foy : Sainte-Foy prise, armée arrêtée,
    date inchangée ; tour suivant : l'armée repart vers Bergerac).
  - Fichiers : `game/engine.py`, `game/turns.py`, `tests/test_campagne.py`
  - Taille : S

- [ ] **Point 1** : tous les bancs passent ; tu joues trois tours (un tour des IA en 1 à 2 s, un arrêt sur une
  attaque, une ville neutre prise pendant ton tour). Ton accord avant la partie 2.

## Partie 2 : les règles en tours

- [x] **T4 : aides de temps en tours et anciennes sauvegardes**
  - `turns.work(g, dt)`, `turns.deadline(g, n)`, `turns.tours_left(g, until)`, `turns.tours(days)` (voir le plan,
    décision 4). `deadline` donne toujours n tours entiers au joueur, qu'on soit dans son tour ou dans celui des IA.
  - `toursTxt` dans `web/js/ui.js` : « au prochain tour », « dans N tours », « ⅕ de tour ».
  - Au chargement, une échéance en milieu de mois est repoussée au début du tour suivant.
  - Vérifier : banc `test_campagne.py` (`deadline` pendant le tour du joueur et pendant celui des IA, en février et
    en mars ; `work` sur février et mars : 30 jours de travail chacun) ; banc de l'interface (`toursTxt`).
  - Fichiers : `game/turns.py`, `web/js/ui.js`, `tests/test_campagne.py`, `tests/interface.test.mjs`
  - Taille : S

- [x] **T5 : production à capacité par tour**
  - La file d'une ville avance de `work(dt)` (30 jours de travail par tour) ; le surplus d'un élément terminé passe
    au suivant.
  - Le panneau de ville dit pour chaque élément de la file « prêt au prochain tour » / « dans N tours » / « en
    attente » (siège), et le coût de chaque levée ou construction en part de tour.
  - Vérifier : banc `test_campagne.py` (cinq régiments de 6 jours lancés pendant le tour : tous prêts au tour
    suivant, en février comme en mars ; ce qui est annoncé « dans 2 tours » est prêt au 2e tour) ; banc de
    l'interface (le panneau de ville ne contient plus « j »).
  - Dépend de : T4
  - Fichiers : `game/engine.py` (`update_queues`), `game/views.py`, `game/cities.py`, `web/js/ui.js`,
    `tests/test_campagne.py`
  - Taille : M

- [x] **T6 : recherche et politiques de ville en tours**
  - Technologies : 1 à 3 tours (arrondi de 28 à 84 jours), recherche qui avance de `work(dt)` ; les bonus et
    collèges réduisent toujours le temps ; « prête au prochain tour / dans N tours ».
  - Politique de ville : 1 tour.
  - Vérifier : banc `test_campagne.py` (une technologie d'un tour lancée pendant le tour est découverte au tour
    suivant) ; comparaison du nombre de technologies d'une IA après 24 mois, avant et après (écart noté dans le
    commit).
  - Dépend de : T4
  - Fichiers : `game/rules.py`, `game/engine.py`, `game/cities.py`, `game/views.py`, `web/js/ui.js`
  - Taille : M

- [x] **T7 : trêves, droits de passage, propositions, décisions et événements en tours**
  - Trêve 4 tours, traités 24/36/60 tours, droit de passage 12 tours, proposition 1 tour, décision 1 tour, effets
    d'événements locaux 1 à 4 tours, tous par `deadline`. Écran : « encore N tours » ou la date du tour de fin.
  - Vérifier : banc `test_campagne.py` (une proposition reçue pendant le tour des IA est encore là pendant tout le
    tour suivant du joueur, et expire au début du tour d'après ; une trêve de 4 tours finit au début du 4e tour).
  - Dépend de : T4
  - Fichiers : `game/diplomacy.py`, `game/events.py`, `game/cities.py`, `game/rules.py`, `web/js/ui.js`
  - Taille : M

- [x] **T8 : actions d'armée et espions en tours**
  - Garde bourgeoise 2 tours (6 d'attente), réquisition 4 tours d'attente, contribution 3, ralliement négocié 1 tour
    (1 d'attente), grâce sur des terres fermées 1 tour, rapport d'espion au tour suivant et valable 2 tours.
  - Vérifier : banc `test_campagne.py` (un ralliement négocié lancé pendant le tour aboutit au tour suivant ; un
    délai d'attente de 3 tours se lève au début du 3e tour).
  - Dépend de : T4
  - Fichiers : `game/army_actions.py`, `game/engine.py` (espions), `game/rules.py`, `web/js/ui.js`, `web/js/map.js`
  - Taille : M

- [ ] **Point 2** : tous les bancs passent ; tu vérifies une ville (file en tours), les technologies et la
  diplomatie. Ton accord avant la partie 3.

## Partie 3 : l'écran en tours

- [x] **T9 : sièges et blocus en tours**
  - « Brèche dans N tours » d'après la vitesse actuelle du siège, « la place tient encore N tours » en blocus,
    arrondis au tour supérieur ; ralliement des IA « en cours ». Vitesse des sièges inchangée.
  - Vérifier : banc `test_campagne.py` (l'annonce « brèche dans 1 tour » est tenue) ; banc de l'interface.
  - Dépend de : T4
  - Fichiers : `game/views.py`, `game/army_actions.py`, `web/js/ui.js`, `tests/test_campagne.py`
  - Taille : S

- [x] **T10 : marche en tours**
  - Jauge de mouvement dans le panneau d'armée (au lieu de « x / y jours », et plus de km/j) ; la bulle de l'ordre
    de marche annonce l'arrivée (« au prochain tour », « dans N tours », estimation) ; messages du serveur sans jours.
  - Vérifier : banc `test_campagne.py` (l'estimation pour un trajet de deux tours dit 2, à un tour près au plus) ;
    banc de l'interface (jauge).
  - Dépend de : T4
  - Fichiers : `game/turns.py`, `game/views.py`, `server.py`, `web/js/ui.js`, `web/js/map.js`
  - Taille : M

- [ ] **T11 : taux par tour, tutoriel, README, chasse aux derniers « jours »**
  - Revenus, entretien, production, commerce et vivres des quartiers affichés par tour ; bulles du tutoriel et aide
    en tours ; README (section tour par tour) ; doc en tête de `game/turns.py`.
  - Banc de l'interface : aucun texte des panneaux de campagne ne contient « jour » ou « N j ».
  - Dépend de : T5 à T10
  - Fichiers : `web/js/ui.js`, `web/js/tuto.js`, `README.md`, `game/turns.py`, `tests/interface.test.mjs`
  - Taille : M

- [ ] **Point final** : /review ; tous les bancs passent ; tu essaies sur l'iPad et sur le PC ; proposition de
  mettre à jour le graphe (`/graphify .`).
