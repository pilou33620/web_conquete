# Tâches : batailles en 3D (SPEC-3D.md, plan : tasks/plan.md)

Vérifications communes à chaque tâche : `python3 tests/lancer.py` passe ; pas d'erreur dans la console du banc
d'essai ; capture `node --experimental-websocket web/js/battle/dev/capture.mjs <scénario> <fichier.png>` regardée.

## Étape 1 : la bataille se joue en 3D (régiments en blocs)

- [x] **T1 : Three.js copié, outil de capture**
  - Critères : `web/vendor/three/` contient three r186 (module + core minifiés, LICENSE) ; `dev/capture.mjs` lance la
    maquette et Chromium sans écran, ouvre `banc.html`, attend la fin du chargement et enregistre un PNG ; une page
    d'essai confirme que WebGL 2 marche dans ce Chromium.
  - Vérif : capture de la vue 2D actuelle (bocage) ; `import('three')` dans Node réussit.
  - Fichiers : `web/vendor/three/*`, `web/js/battle/dev/capture.mjs`
  - Taille : S

- [x] **T2 : caméra orbitale et ses bancs**
  - Critères : `camera.js` : cible, distance, cap, inclinaison selon la distance, conversion `z` ↔ distance,
    projection monde → écran et écran → monde par marche de rayon sur une fonction d'altitude, bornes du champ.
  - Vérif : `node --test tests/camera.test.mjs` : aller-retour à 1 m près sur un relief en colline, à plusieurs caps
    et zooms ; inclinaison croissante avec la distance ; la cible reste dans les bornes.
  - Fichiers : `web/js/battle/camera.js`, `tests/camera.test.mjs`
  - Taille : S

- [x] **T3 : vue WebGL, relief, régiments en blocs, calque 2D**
  - Critères : `vue.js` crée le moteur WebGL et le calque 2D ; le relief (altitudes adoucies de `terrain.js`) est
    texturé par l'image entière peinte à plat ; ciel et brume simples ; chaque régiment est un bloc à ses couleurs,
    posé sur le relief, orienté ; les fanions actuels et les noms s'affichent sur le calque ; interrogation du
    serveur et interpolation inchangées.
  - Vérif : captures des cinq scénarios (vue d'ensemble et vue rapprochée) ; bancs d'interface verts.
  - Fichiers : `web/js/battle/vue.js`, `web/js/battle/relief.js`, `web/js/battle/terrain.js`
  - Taille : M

- [x] **T4 : gestes, tracés au sol, mini-carte**
  - Critères : glisser déplace dans le repère de la caméra, pincer et molette zooment au point visé, deux doigts qui
    tournent et clic droit glissé pivotent, inertie, clavier ; sélection, cadre, tracé d'ordre (flèche, silhouettes),
    ligne d'arrivée, déploiement par glisser, ciblage ; portées, zone de déploiement, ralliement, objectif, ordres en
    cours tracés au sol en suivant le relief ; trapèze de la vue sur la mini-carte.
  - Vérif : capture pendant un geste simulé (ordre, sélection) ; essai à la souris dans le banc ; bancs verts.
  - Fichiers : `web/js/battle/commandes.js`, `web/js/battle/vue.js`, `web/js/battle/interface.js`
  - Taille : M

- [x] **T5 : tuiles de texture du sol, décalcomanies, brèches, couverts**
  - Critères : les tuiles proches de la caméra reçoivent une texture plus fine (niveaux 1 à 16 px/m selon la qualité,
    budget mémoire repris), peinte quelques-unes par image, l'image entière en attendant ; tués et trous d'obus
    peints dans les textures ; brèche repeinte ; voile des couverts pendant le déploiement.
  - Vérif : capture rapprochée nette (sillons, ornières lisibles) ; mémoire des tuiles bornée (compteur) ; bancs verts.
  - Fichiers : `web/js/battle/relief.js`, `web/js/battle/terrain.js`, `web/js/battle/vue.js`
  - Taille : M

- [x] **Point d’étape 1** : captures envoyées, commit « Batailles en 3D, étape 1 », revue avec toi.

## Étape 2 : les troupes

- [x] **T6 : fantassins 3D**
  - Critères : `troupes.js` : modèle de fantassin (habit, culotte, guêtres, buffleteries, fusil, coiffure de
    l'époque), instancié ; texture de données des unités ; altitude lue dans le shader ; poses repos, marche, course,
    mise en joue, rechargement, déroute, salve qui roule ; ligne, colonne, carré, tirailleurs ; porte-drapeau,
    tambours, officiers ; nombre de figurines borné par la qualité ; `layout` déplacé depuis `unites.js`.
  - Vérif : `node --test tests/troupes.test.mjs` (nombre de figurines, rangs, quatre faces du carré, déroute
    éparpillée, drapeau au premier rang) ; captures rapprochées de chaque formation.
  - Fichiers : `web/js/battle/troupes.js`, `web/js/battle/unites.js`, `web/js/battle/vue.js`, `tests/troupes.test.mjs`
  - Taille : M

- [x] **T7 : cavaliers, chevaux, état-major**
  - Critères : chevaux (robes variées) au pas et au galop, cavaliers, étendard, colonel à cheval, état-major du
    général.
  - Vérif : captures d'une cavalerie à l'arrêt et à la charge.
  - Fichiers : `web/js/battle/troupes.js`
  - Taille : S

- [x] **T8 : batteries, servants, caissons, chariots**
  - Critères : pièces (fût, affût, roues), avant-trains et attelages, servants qui s'affairent selon leur rôle, recul
    au coup ; batterie attelée en colonne ; chariot de munitions.
  - Vérif : captures d'une batterie en batterie et attelée.
  - Fichiers : `web/js/battle/troupes.js`
  - Taille : S

- [x] **T9 : fanions façon Ultimate General**
  - Critères : `fanions.js` : carré aux couleurs du camp avec pictogramme de l'arme, puis l'effectif sur fond sombre,
    hampe ; moral, déroute barrée, régiments devinés « ? » ; médaillon et nom des généraux ; les fanions ne se
    chevauchent pas ; toucher un fanion choisit le régiment.
  - Vérif : capture comparée aux captures de référence ; bancs verts.
  - Fichiers : `web/js/battle/fanions.js`, `web/js/battle/unites.js`, `web/js/battle/vue.js`
  - Taille : S

- [x] **Point d’étape 2** : captures (de près, de loin), images par seconde relevées, commit, revue avec toi.

## Étape 3 : le feu et l'atmosphère

- [x] **T10 : fumées, éclairs, boulets, éclats, poussière**
  - Critères : bouffées en 3D (montent, grossissent, partent avec le vent, cachées par une colline), éclairs de bouche
    additifs, boulets en arc avec ricochets, mitraille, gerbes de terre, explosions ; même file d'effets et mêmes
    rythmes qu'aujourd'hui ; nombre borné par la qualité.
  - Vérif : captures pendant une fusillade et une canonnade (banc avec `avance`).
  - Fichiers : `web/js/battle/effets.js`, `web/js/battle/vue.js`
  - Taille : M

- [x] **T11 : lumière, ciel, brume, météo**
  - Critères : soleil selon l'heure (direction, couleur), nuit bleue, ombres des nuages qui passent, brume de
    distance, brouillard, pluie, neige et orage sur le calque, voile de pluie.
  - Vérif : captures à 9 h, 13 h, 19 h, 21 h et par pluie, brouillard, neige.
  - Fichiers : `web/js/battle/effets.js`, `web/js/battle/relief.js`, `web/js/battle/vue.js`
  - Taille : M

- [x] **Point d’étape 3** : captures, commit, revue avec toi.

## Étape 4 : le décor

- [x] **T12 : arbres**
  - Critères : `decor.js` : arbres instanciés d'après `treeGrid` (feuillus, pins parasols, sapins, peupliers,
    buissons, arbres nus l'hiver, meules), couleurs de la saison, découpés par zones pour n'envoyer que ce qui est
    vu ; densité selon la qualité.
  - Vérif : captures bocage et landes, en été et en hiver.
  - Fichiers : `web/js/battle/decor.js`, `web/js/battle/terrain.js`, `web/js/battle/vue.js`
  - Taille : M

- [x] **T13 : maisons, église, moulins, ponts, portes**
  - Critères : maisons et fermes (murs, toit à deux pans, cheminée), église et clocher, moulin et ailes, ponts sur les
    rivières, portes de ville ; tuiles ou ardoises selon la région, neige l'hiver.
  - Vérif : captures d'un village (vignes) et de l'assaut.
  - Fichiers : `web/js/battle/decor.js`
  - Taille : S

- [x] **T14 : remparts, brèches, tranchées, haies**
  - Critères : remparts et bastions en volume (escarpe, parapet), murs de ville crénelés, brèches ouvertes pendant la
    bataille (remparts reconstruits autour), tranchées et gabions, barricades, haies, murets, clôtures.
  - Vérif : captures de l'assaut avant et après une brèche ; bocage (haies).
  - Fichiers : `web/js/battle/decor.js`, `web/js/battle/terrain.js`
  - Taille : M

- [x] **T15 : ombres portées**
  - Critères : ombre du soleil sur le relief, le décor et les troupes, autour de la cible de la caméra ; selon la
    qualité (sans ombre en Basse, ombre douce sous chaque régiment en repli).
  - Vérif : captures avec et sans ombres ; images par seconde relevées.
  - Fichiers : `web/js/battle/vue.js`, `web/js/battle/relief.js`, `web/js/battle/troupes.js`, `web/js/battle/decor.js`
  - Taille : M

- [x] **Point d’étape 4** : captures, commit, revue avec toi.

## Étape 5 : finitions

- [x] **T16 : qualité, mesure, sans WebGL 2**
  - Critères : profils Basse à Ultra pour la 3D (densité, soldats, fumées, arbres, ombres, détail du sol,
    anticrénelage) ; la mesure des images par seconde fait descendre la qualité ; sans WebGL 2, message et
    « Résolution automatique ».
  - Vérif : bancs ; capture en Basse et en Ultra ; essai avec WebGL désactivé.
  - Fichiers : `web/js/battle/qualite.js`, `web/js/battle/vue.js`, `web/js/battle/bataille.js`, `web/js/ui.js`
  - Taille : M

- [x] **T17 : nettoyage, README, captures des cartes**
  - Critères : code 2D devenu inutile retiré (`terrain.js` dessin par tuiles, `unites.js` dessin du terrain,
    `dev/essai-terrain.html`) ; README à jour ; captures des cartes d'unités à côté des soldats 3D envoyées.
  - Vérif : bancs ; recherche des fonctions retirées sans appel restant.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/unites.js`, `web/js/battle/dev/essai-terrain.html`, `README.md`
  - Taille : M

- [x] **Point final** : /review (corrections commitées), bancs, captures des cinq scénarios ; reste l'essai sur l'iPad par toi.

## Étape 6 : se rapprocher du rendu d'Ultimate General (SPEC-3D.md « Étape 6 », plan : décisions 7 à 13)

Vérifications communes : `python3 tests/lancer.py` passe ; aucune erreur dans la console sur le scénario touché ;
capture interne regardée (pas montrée) ; triangles relevés sur les trois vues types quand la tâche touche la charge.
Vues types (bocage, `avance=300`, 1400×800, Haute) : ensemble (z = 0,6), mi-distance (z = 4), au ras (z = 30).

- [x] **T18 : banc des modèles, relevé de départ**
  - Relevé de départ (Haute, 1400×800), en triangles par image et appels de dessin : ensemble 5 652 856 / 136 ;
    mi-distance 6 632 688 / 96 ; au ras 6 038 575 / 86.
  - Mesure refaite en attendant trois images dessinées après chaque déplacement de la caméra : le Pi n'en dessine
    qu'une toutes les 2 à 4 s.
  - L'essentiel vient des figurines : toutes sont dessinées, même hors champ. De près s'ajoute la passe d'ombre des
    troupes.
  - Critères :
    - `troupes.js` exporte `model(kind, year, lod)`, qui renvoie la géométrie d'une sorte.
    - `tests/modeles.test.mjs` vérifie pour chaque sorte : os dans la liste de la sorte, hauteur plausible, avant vers
      +Z.
    - Triangles des trois vues types relevés et notés ici.
  - Vérif : `node --test tests/` ; relevé fait avec `capture.mjs --js`.
  - Fichiers : `web/js/battle/troupes.js`, `tests/modeles.test.mjs`
  - Taille : S

- [x] **T19 : fantassins arrondis et taille**
  - Fait : environ 900 sommets par homme à pied (676 avant). Taille gardée à ×1,6 : à ×1,35, la ligne est trop maigre
    à mi-distance, et Ultimate General grandit aussi ses soldats (environ un tiers de maison).
  - Triangles : ensemble 5,6 M ; mi-distance 13,5 M (×2 avant la version de loin, T21 ; mesure de T18 encore
    imprécise).
  - Critères :
    - `soldier()` en formes arrondies : basques, buffleteries croisées, guêtres, fusil à baïonnette.
    - `hat()` : tricorne relevé, bicorne, shako, képi, bonnet à poil, chapeau rond.
    - Mêmes os et pivots qu'avant.
    - `SCALE` choisi sur captures.
    - Le banc vérifie l'absence de pavés : aucune `BoxGeometry` pour le corps, la tête et les membres.
  - Vérif : banc des modèles ; captures au ras et mi-distance (marche, salve) ; triangles relevés.
  - Fichiers : `web/js/battle/troupes.js`, `tests/modeles.test.mjs`, `tests/troupes.test.mjs` (si la taille change les
    écarts)
  - Taille : M

- [x] **T20 : chevaux, cavaliers, canons, caissons arrondis**
  - Fait : cheval d'environ 760 sommets (1 360 avec son cavalier) ; canon d'environ 800 sommets, avec roues à rayons.
  - Critères : corps en capsule, encolure et tête galbées, jambes effilées (mêmes os 1, 2, 5, 6, 7, 8) ; cavalier
    arrondi ; roues à rayons, fût galbé ; caisson et chariot bâché arrondis.
  - Vérif : banc des modèles ; captures cavalerie au galop et batterie qui tire.
  - Fichiers : `web/js/battle/troupes.js`, `tests/modeles.test.mjs`
  - Taille : M

- [x] **T21 : version simple de loin**
  - Fait :
    - Modèle lointain en boîtes (environ 280 sommets pour un fantassin, contre 1 070 de près).
    - Version choisie par régiment : de près au-dessus de 18 px de haut, de loin au-dessous de 14 px.
    - Les régiments hors champ ne sont plus dessinés (sphère élargie avec la distance).
    - Triangles : ensemble 4,17 M (−26 %), mi-distance 2,97 M (−55 %), au ras 4,71 M (−22 %).
  - Critères :
    - Chaque sorte a un modèle lointain (peu de sommets, mêmes os, même hauteur).
    - Choix par régiment selon la hauteur à l'écran, avec une marge (fonction pure `lodOf` testée).
    - Reconstruction limitée à quelques fois par seconde.
    - Ombres portées pour les deux versions.
  - Vérif : banc (`lodOf` : seuils, marge ; modèles proche et lointain avec les mêmes os et la même hauteur) ;
    triangles des trois vues ≤ départ + 10 % ; capture à la distance de bascule.
  - Fichiers : `web/js/battle/troupes.js`, `web/js/battle/vue.js`, `tests/modeles.test.mjs`
  - Taille : M

- [x] **Point de contrôle A** : bancs, cinq scénarios sans erreur, charge relevée, commit.

- [x] **T22 : courbe filmique, soleil, ciel, ombres douces**
  - Fait : `NeutralToneMapping` ; soleil un peu plus faible, ciel plus fort et bleuté (ombres teintées) ; PCF de
    rayon 2,5. Captures midi, matin, soir, crépuscule, brouillard, neige.
  - Vu en passant : dans les bois (landes, bocage), la canopée cache les régiments. Ajouté à T27.
  - Critères :
    - Tone mapping et exposition réglés.
    - Intensités de `ciel()` revues : ombres teintées, pas noires.
    - `shadow.radius` pour des bords doux.
    - Matin, soir, nuit, brouillard, pluie, neige, orage toujours justes.
    - Fumées et éclairs encore lisibles.
  - Vérif : captures aux heures et météos du banc ; bancs.
  - Fichiers : `web/js/battle/vue.js`, `web/js/battle/effets.js`, `web/js/battle/relief.js`
  - Taille : M

- [ ] **T23 : ombres de contact**
  - Critères : tache douce sous chaque figurine (soldat, cheval, canon, voiture) qui suit sa place et son pas ; partage
    les tampons d'instances ; cachée pour un régiment deviné (pointillés) ; remplace l'ombre en bloc des régiments.
  - Vérif : capture au ras et mi-distance ; triangles relevés.
  - Fichiers : `web/js/battle/troupes.js`
  - Taille : S

- [ ] **T24 : couleurs du sol**
  - Critères : blé or doux et plusieurs teintes par parcelle (mûr, vert, chaume, labour) ; herbe en taches de
    plusieurs verts et coins secs ; saisons toujours distinctes.
  - Vérif : captures bocage, vignes, landes, automne et hiver.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/textures.js`
  - Taille : M

- [ ] **T25 : chemins larges et usés**
  - Critères : chemins de terre plus larges, bords adoucis, ornières, herbe au milieu ; routes distinctes ; ponts et
    gués toujours raccordés.
  - Vérif : captures bocage et vignes, mi-distance et au ras.
  - Fichiers : `web/js/battle/terrain.js`
  - Taille : S

- [ ] **T26 : cultures en relief**
  - Critères :
    - Masque de hauteur de végétation peint une fois.
    - Couches d'épis près de la caméra, couleur du sol, plus sombres en bas, ondulation au vent.
    - Nombre de couches selon la qualité (aucune en Basse), coupées de loin.
    - Les soldats restent visibles : épis à hauteur de genou ou de taille.
  - Vérif : captures au ras dans le blé et mi-distance ; triangles et durée d'image relevés.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/relief.js`, `web/js/battle/qualite.js`, `web/js/battle/vue.js`
  - Taille : M

- [ ] **Point de contrôle B** : bancs, cinq scénarios sans erreur, charge relevée, commit.

- [ ] **T27 : arbres touffus**
  - Critères :
    - Couronnes en touffes : normales lisses, plus sombres dedans et dessous, teintes variées.
    - Bois au toit bosselé.
    - Deux versions selon la zone.
    - Même nombre d'arbres par qualité ; effacement près de la caméra toujours actif.
    - Troupes visibles dans les bois : sous l'emprise d'un régiment (avec une marge), la couronne s'efface et le tronc
      reste.
  - Vérif : captures landes (vue d'ensemble) et bocage au ras ; triangles des trois vues ≤ départ + 10 %.
  - Fichiers : `web/js/battle/decor.js`
  - Taille : M

- [ ] **T28 : vérification finale, README, revue**
  - Critères : captures internes des trois vues comparées à tes trois images ; tableau des triangles ; README
    (« La vue ») à jour ; spec et plan cochés ; /review et corrections.
  - Vérif : bancs ; cinq scénarios sans erreur.
  - Fichiers : `README.md`, `SPEC-3D.md`, `tasks/plan.md`, `tasks/todo.md`
  - Taille : S

- [ ] **Point final de l'étape 6** : tu essaies sur l'iPad.
