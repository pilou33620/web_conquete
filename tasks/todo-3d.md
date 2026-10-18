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

- [x] **T23 : ombres de contact**
  - Fait : tache douce sous chaque figurine, dans toutes les qualités ; l'ombre en bloc des régiments est retirée.
    Fusil du modèle lointain épaissi (il ne restait que des points). Triangles : ensemble 4,25 M, mi-distance 3,06 M,
    au ras 4,79 M (sous le départ).
  - Critères : tache douce sous chaque figurine (soldat, cheval, canon, voiture) qui suit sa place et son pas ; partage
    les tampons d'instances ; cachée pour un régiment deviné (pointillés) ; remplace l'ombre en bloc des régiments.
  - Vérif : capture au ras et mi-distance ; triangles relevés.
  - Fichiers : `web/js/battle/troupes.js`
  - Taille : S

- [x] **T24 : couleurs du sol**
  - Fait :
    - L'été mêle l'or à des verts : blé 34 %, chaume 14 %, avoine 14 %, maïs 12 %, blé vert 8 %, prairie 18 %. Avant, 66 % des
      champs étaient jaunes.
    - Blé plus profond ; herbe d'été plus verte ; printemps moins citron ; nuance d'une prairie à l'autre doublée.
  - Vu en passant : les haies sont des règles lisses (orange à l'automne). Ajouté à T27.
  - Critères : blé or doux et plusieurs teintes par parcelle (mûr, vert, chaume, labour) ; herbe en taches de
    plusieurs verts et coins secs ; saisons toujours distinctes.
  - Vérif : captures bocage, vignes, landes, automne et hiver.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/textures.js`
  - Taille : M

- [x] **T25 : chemins larges et usés**
  - Fait : chemins de 5 m (3,6 avant), bas-côtés en deux passes (bord fondu), ornières plus écartées, herbe au milieu
    plus visible ; routes de 9,2 m ; terre et chaussée plus ocres.
  - Critères : chemins de terre plus larges, bords adoucis, ornières, herbe au milieu ; routes distinctes ; ponts et
    gués toujours raccordés.
  - Vérif : captures bocage et vignes, mi-distance et au ras.
  - Fichiers : `web/js/battle/terrain.js`
  - Taille : S

- [x] **T26 : cultures en relief**
  - Fait :
    - Masque couleur et hauteur des cultures à 2,5 m par pixel (3,8 Mo), routes et chemins retirés.
    - Couches d'épis sur une fenêtre du maillage du sol autour de la cible (60 à 260 m de rayon), un seul appel de dessin.
    - 5 couches en Haute, 8 en Ultra, aucune en Basse et Moyenne ; rien au-delà de 420 m de distance de caméra.
    - Blé à hauteur de genou des figurines ; ondulation au vent.
  - Pas mesuré : le coût en pixels sur l'iPad (rendu logiciel ici).
  - Critères :
    - Masque de hauteur de végétation peint une fois.
    - Couches d'épis près de la caméra, couleur du sol, plus sombres en bas, ondulation au vent.
    - Nombre de couches selon la qualité (aucune en Basse), coupées de loin.
    - Les soldats restent visibles : épis à hauteur de genou ou de taille.
  - Vérif : captures au ras dans le blé et mi-distance ; triangles et durée d'image relevés.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/relief.js`, `web/js/battle/qualite.js`, `web/js/battle/vue.js`
  - Taille : M

- [x] **Point de contrôle B** : bancs, cinq scénarios sans erreur, charge relevée (avec T27), commit.

- [x] **T27 : arbres touffus**
  - Fait :
    - Couronnes en 5 touffes (3 en Moyenne, 1 en Basse) aux normales lisses, plus sombres dessous et vers le cœur.
    - Zones à moins de 300 m de l'œil : touffe centrale plus fine.
    - Sous un régiment vu, la couronne s'efface et le tronc reste (masque de 4 m par pixel, refait 3 fois par seconde
      au plus, appliqué aussi à l'ombre portée).
    - Haies au bord bosselé tous les 1,6 m.
  - Triangles (bocage, Haute) :
    - ensemble 4,66 M (−17 %) ;
    - mi-distance 3,42 M (−48 %) ;
    - au ras 5,46 M (−10 %).
    - Avec des touffes fines partout, on était à 7,2 M au ras : corrigé.
  - Critères :
    - Couronnes en touffes : normales lisses, plus sombres dedans et dessous, teintes variées.
    - Bois au toit bosselé.
    - Deux versions selon la zone.
    - Même nombre d'arbres par qualité ; effacement près de la caméra toujours actif.
    - Troupes visibles dans les bois : sous l'emprise d'un régiment (avec une marge), la couronne s'efface et le tronc
      reste.
    - Haies buissonnantes (bord supérieur bosselé, teinte variée) au lieu de règles lisses.
  - Vérif : captures landes (vue d'ensemble) et bocage au ras ; triangles des trois vues ≤ départ + 10 %.
  - Fichiers : `web/js/battle/decor.js`
  - Taille : M

- [x] **T28 : vérification finale, README, revue**
  - Fait :
    - Captures internes comparées aux trois images de référence (bocage été et automne, landes, au ras du blé).
    - README à jour (« L'entrée », qualité graphique, banc des modèles).
    - /review : aucun point critique ; cinq points importants corrigés :
      - sortes vides envoyées à la carte graphique ;
      - épis débordant hors du champ ;
      - bout des haies perdu ;
      - épis effacés au-delà de 200 m de l'œil et 4 couches en Haute ;
      - canevas du masque libérés.
    - Vu sur captures et corrigé : les arbres isolés perdaient leur couronne près des troupes ; seuls les bois
      s'effacent désormais.
  - Triangles finaux (bocage, Haute, départ → fin) :
    - ensemble 5,65 → 4,66 M (−17 %) ;
    - mi-distance 6,63 → 4,33 M (−35 %) ;
    - au ras 6,04 → 5,38 M (−11 %).
  - Critères : captures internes des trois vues comparées à tes trois images ; tableau des triangles ; README
    (« La vue ») à jour ; spec et plan cochés ; /review et corrections.
  - Vérif : bancs ; cinq scénarios sans erreur.
  - Fichiers : `README.md`, `SPEC-3D.md`, `tasks/plan.md`, `tasks/todo.md`
  - Taille : S

- [x] **Point final de l'étape 6** : tu essaies sur l'iPad.

## Étape 7 : animer les batailles et se rapprocher d'Ultimate General (SPEC-3D.md « Étape 7 », plan : décisions 14 à 22)

Vérifications communes :
- `python3 tests/lancer.py` passe.
- Aucune erreur dans la console sur les cinq scénarios du banc.
- Captures (et vidéo si ça bouge) publiées sur la galerie du réseau local, à côté des captures de référence d'Ultimate
  General.
- Commit à chaque tâche.

Vues types : celles de l'étape 6 (bocage, `avance=300`, 1400×800, Haute), plus une vue en plongée façon Ultimate
General sur un régiment qui tire.

### 7a : figurines animées

- [x] **T29 : squelette dans les vraies batailles**
  - Fait : fantassins de près au squelette dans les vraies batailles (`Mesh` sur `InstancedBufferGeometry`, 11 attributs
    lus) ; gestes selon l'activité (`gestes.js`), réécrits pour le seul régiment dont l'activité change ; fondu prêt dans
    le shader. Seuls les attributs lus comptent : `uv` et `aBone`/`aPart` n'ont pas eu à être rangés ensemble.
  - Critères :
    - La texture des animations (`web/anims/soldat.*`) est chargée à l'entrée de la bataille. Si elle manque : une
      erreur dans la console, et les hommes restent dans leur pose de référence.
    - Fantassins de près au squelette (`model(kind, year, 1, true)`). Leurs gestes suivent l'état : repos, marche,
      charge, déroute, ralliement (`gestes.js`, `gesture()`).
    - Attributs réorganisés (décision 16). Un banc vérifie que chaque sorte en utilise au plus 16.
    - L'ancienne animation par le code des fantassins de près est retirée. Chevaux, canons, drapeaux, servants et
      version de loin ne changent pas encore.
  - Vérif :
    - banc `tests/gestes.test.mjs` (geste de chaque état, rang, formation) ;
    - banc des modèles (attributs) ;
    - captures au ras : un régiment qui marche, un qui charge, un en déroute.
  - Fichiers : `web/js/battle/troupes.js`, `web/js/battle/gestes.js` (nouveau), `web/js/battle/vue.js`,
    `tests/gestes.test.mjs` (nouveau), `tests/modeles.test.mjs`
  - Taille : M

- [x] **T30 : version de loin au squelette, ombres, lumière, proportions**
  - Fait : version de loin au squelette (jambe en un bloc coupé à mi-hauteur : au plus un tiers des sommets) ; étoffe
    du drapeau sur l'os de la hampe ; ombre au sol qui suit les hanches ; lumière enveloppante et ombre vers les pieds
    pour toutes les troupes ; clés de cache des programmes distinctes par sorte. Triangles pas encore relevés (point 7a).
  - Critères :
    - La version de loin a les os du squelette (genou et coude) : mêmes gestes, même hauteur.
    - Passe d'ombre et ombres de contact suivent le squelette ; la tache suit les hanches, même couché.
    - Le prototype passe dans le jeu, pour les troupes seulement :
      - lumière enveloppante ;
      - ombre plus sombre vers les pieds ;
      - proportions trapues.
    - Triangles des vues types relevés.
  - Vérif :
    - banc des modèles (mêmes os et même hauteur de près et de loin, pour toutes les sortes à pied) ;
    - captures à la distance de bascule et en vue d'ensemble.
  - Fichiers : `web/js/battle/troupes.js`, `tests/modeles.test.mjs`
  - Taille : M

- [x] **T31 : feu et recharge, officiers, tambours, drapeau**
  - Fait : gestes en plusieurs temps précalculés (« salve », « salve-genou », « feu-libre », « tambour »,
    « tambour-marche ») ; `pick()` choisit le geste de chaque homme (rang, place le long du front, salve qui roule,
    premier rang à genoux en ligne à l'arrêt, troisième rang sans tirer, officier en garde) selon l'instant ; une salve
    tirée depuis le repos se joue aussi (la maquette tire sans passer à l'état « feu ») ; gestes réécrits à chaque
    salve et à sa fin. 24 animations, 438 Ko.
  - Critères :
    - `cuire.mjs` précalcule :
      - « salve » et « salve à genoux » (en joue, feu, recharge, épaulé), qui s'enchaînent d'elles-mêmes ;
      - « feu libre » pour les tirailleurs, en boucle ;
      - « tambour » (les baguettes battent) ;
      - « garde » de l'officier, sabre au clair.
    - Une salve met chaque homme en joue au moment où le feu roule jusqu'à sa file (`un._volley`, horloge des effets).
      En ligne à l'arrêt, le premier rang est à genoux.
    - Officiers : ils parlent au repos, sont en garde au feu. Le porte-drapeau porte la hampe.
  - Vérif :
    - banc (geste d'une salve : instant de chaque file, rang à genoux) ;
    - vidéo d'une salve qui roule, avec sa fumée.
  - Fichiers : `web/js/battle/dev/cuire.mjs`, `web/anims/soldat.*`, `web/js/battle/gestes.js`,
    `web/js/battle/troupes.js`, `tests/gestes.test.mjs`
  - Taille : M

- [x] **T32 : variété par homme et fondus**
  - Fait : `variety()` (place, sens, taille, nuance, rythme, délai) tirée une fois par homme ; `rows()` écrit le geste
    et le geste d'avant, recalculé depuis l'activité précédente du régiment (pas de mémoire par homme) ; fondu au délai
    de chacun. Le réglage `fondu` de la qualité Basse n'est pas ajouté : seulement si la mesure de l'iPad le demande.
  - Critères :
    - Chaque homme a, tirés une fois pour toutes par hachage du régiment et de son numéro :
      - sa place (±15 cm), son sens (±6°), sa taille (±5 %) ;
      - sa teinte d'habit ;
      - son rythme (±6 %) ;
      - son décalage d'horaire, de quelques dixièmes de seconde.
    - Chaque changement de geste se fait en fondu de 0,3 s. Jamais de saut de pose.
    - En Basse : pas de fondu si la mesure de l'iPad le demande (réglage `fondu` dans `qualite.js`).
  - Vérif :
    - banc (variété reproductible, bornes respectées) ;
    - vidéo d'un régiment qui s'arrête, met en joue et repart.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `web/js/battle/qualite.js`,
    `tests/gestes.test.mjs`
  - Taille : M

- [x] **T33 : servants au squelette**
  - Fait : gestes précalculés « refouler », « porter » (aller-retour vers la pièce, déplacement du corps entier dans
    le geste : option `path` de `cuire.mjs`), « pointer » (à genoux), « boutefeu » (abaissé à l'instant du coup) ; le
    chef de pièce donne ses ordres. Servants en action 8 s après le dernier coup de leur pièce. L'ancienne animation des
    servants est retirée. 28 animations, 537 Ko.
  - Critères :
    - `cuire.mjs` précalcule les gestes des servants, réglés sur le coup de leur pièce (`_shots`) :
      - écouvillon (refouler) ;
      - chargement du boulet ;
      - pointeur accroupi ;
      - boutefeu.
    - Les servants gardent leur place autour de la pièce et leur habit sombre. L'animation par le code des servants est
      retirée.
  - Vérif : banc des modèles (servant au squelette) ; vidéo d'une batterie qui tire.
  - Fichiers : `web/js/battle/dev/cuire.mjs`, `web/anims/soldat.*`, `web/js/battle/troupes.js`, `web/js/battle/gestes.js`
  - Taille : M

- [x] **Point de contrôle 7a** (18/10/2026) : bancs (« Tout passe. ») ; cinq scénarios ouverts sans erreur ; galerie
  du réseau local (`captures-3d/animations/etape7a/`). Triangles et appels de dessin (bocage, `avance=300`, Haute,
  1400×800, caméra sur le centre de nos troupes) : ensemble 5,00 M / 188 ; mi-distance 4,60 M / 142 ; au ras
  5,22 M / 137. C'est sous le départ de l'étape 6 (5,65 / 6,63 / 6,04 M), au-dessus de l'après-T23 (4,25 / 3,06 /
  4,79 M) ; les appels augmentent avec les versions au squelette.
  - **En attente de toi** : images par seconde sur l'iPad en Haute (objectif ≥ 30). Si elles manquent, réglage
    `fondu` en Basse et version de loin plus légère.

### 7b : tués

- [x] **T34 : les hommes tombent, corps en 3D au sol**
  - Fait : `chooseDead` (tirage pondéré, surtout le premier rang) et `pushRing` (anneau) dans `gestes.js` ;
    `troupes.kill()` : les tombés jouent « mort » (étalés sur 1,5 s) puis restent couchés, dessinés dans les lots des
    hommes (régiment fictif `DEAD` à l'origine), de près ou de loin selon la distance, rien hors champ ; au-delà du
    plafond (`corps` dans `qualite.js`), les plus anciens sont repeints en taches. Cavaliers : taches comme avant (T35).
    Limite vue : tant qu'un régiment reste en place, un vivant peut se tenir sur un corps (la disposition se resserre
    par le bout) ; T36 fera prendre leur place aux vivants.
  - Critères :
    - Quand un régiment perd des hommes, `gestes.js` (`chooseDead`) choisit les figurines qui tombent, surtout au
      premier rang sous la mousqueterie.
    - Elles rejoignent le lot des corps à l'endroit, dans le sens et avec la teinte de leur chute. Elles y jouent
      « mort » ou « touché à la tête », puis restent couchées avec leur fusil.
    - Anneau plafonné (`corps` dans `qualite.js` : 800, 1 500, 2 500, 4 000). Au-delà, le plus ancien devient une
      tache peinte.
    - Pas de corps dans un bâtiment ni sur l'eau (`terrain.bare`).
    - Les taches « mort » d'aujourd'hui ne servent plus qu'au-delà du plafond.
  - Vérif :
    - banc (choix des tués, anneau : plafond, ordre de sortie) ;
    - vidéo d'un échange de salves ;
    - capture d'un champ après une heure de bataille (`avance=3600`).
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `web/js/battle/vue.js`,
    `web/js/battle/qualite.js`, `tests/gestes.test.mjs`
  - Taille : M

- [ ] **T35 : boulets qui couchent une file, chevaux morts**
  - Critères :
    - Un boulet (événement `canon`) qui frappe un régiment tue d'abord la file la plus proche de sa trajectoire. Ces
      hommes jouent « projeté ».
    - Un cavalier tué : le cheval couché (pose figée par le code) et son cavalier tombé.
    - Les attelages tués restent couchés aussi.
  - Vérif : banc (file la plus proche d'une trajectoire) ; vidéo d'une batterie qui tire sur une ligne et sur de la
    cavalerie.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `web/js/battle/vue.js`, `tests/gestes.test.mjs`
  - Taille : M

- [ ] **Point de contrôle 7b** : bancs, cinq scénarios, galerie, commit ; tu règles le plafond des corps sur l'iPad.

### 7c : places et bâtiments

- [ ] **T36 : hommes qui courent à leur place**
  - Critères :
    - À chaque nouvelle disposition (formation, largeur, pertes, déroute, ralliement), `gestes.js` (`matchSlots`)
      apparie les hommes en gardant l'ordre de lecture.
    - Chacun va de son ancienne place à la nouvelle (décision 18) : au trot au-delà de 3 m, au pas sinon, tourné vers
      sa route, puis face au front.
    - Plus aucun saut de place.
  - Vérif :
    - banc (`matchSlots` : chaque homme une place, aucune place prise deux fois, ordre gardé, trajet total court) ;
    - vidéo : ligne → colonne → carré → ligne.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `tests/gestes.test.mjs`
  - Taille : M

- [ ] **T37 : conversion, marche et arrêt sans glissade**
  - Critères :
    - Quand le cap d'un régiment change ou qu'il se déplace, ses hommes à l'arrêt se mettent en marche, puis reprennent
      leur geste à l'arrivée, en fondu.
    - Plus de régiment qui tourne ou glisse d'un bloc avec des hommes immobiles.
  - Vérif : banc (activité d'un régiment qui tourne) ; vidéo d'une conversion de 90°.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `tests/gestes.test.mjs`
  - Taille : S

- [ ] **T38 : bâtiments**
  - Critères :
    - `terrain.js` prépare la grille des bâtiments (décision 19). Le shader repousse toute figurine debout hors des
      maisons, de l'église et des moulins (marge de 0,5 m), vers le bord le plus proche. Les remparts ne sont pas
      concernés.
    - Un régiment qui traverse un village s'écoule autour des maisons.
  - Vérif :
    - banc (`pushOut` : un point dans une maison sort au plus court, un point dehors ne bouge pas, rectangle tourné) ;
    - vidéo d'un régiment qui traverse le village du scénario bocage.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/troupes.js`, `web/js/battle/gestes.js`,
    `tests/gestes.test.mjs`
  - Taille : M

- [ ] **Point de contrôle 7c** : bancs, cinq scénarios, galerie, commit.

### 7d : mêlée et charges

- [ ] **T39 : mêlée**
  - Critères :
    - En mêlée, l'adversaire est le régiment ennemi en mêlée le plus proche (`gestes.js`). Les premiers rangs avancent
      l'un dans l'autre sur le front de contact, sans traverser tout le régiment.
    - Les hommes font des estocs et des poussées, chacun à son rythme, tournés vers l'ennemi. Les officiers donnent des
      coups de sabre.
    - Les tués tombent (7b).
  - Vérif : banc (adversaire, profondeur de mêlée) ; vidéo d'une charge à la baïonnette qui finit en mêlée.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `tests/gestes.test.mjs`
  - Taille : M

- [ ] **T40 : cavaliers au squelette, en selle**
  - Critères :
    - Le cheval est dessiné sans cavalier. Le cavalier est une figurine au squelette posée sur la selle : jambes à
      califourchon (pose précalculée), habit, coiffure, sabre.
    - Il suit le balancement du cheval (même formule).
    - Mêmes règles pour le colonel et l'état-major ; le porte-étendard garde son étendard.
  - Vérif : banc des modèles (cavalier : os, hauteur en selle) ; vidéo au pas et au galop.
  - Fichiers : `web/js/battle/dev/cuire.mjs`, `web/anims/soldat.*`, `web/js/battle/troupes.js`,
    `tests/modeles.test.mjs`
  - Taille : M

- [ ] **T41 : sabres des cavaliers, chevaux qui se cabrent**
  - Critères :
    - À la charge, sabre levé.
    - En mêlée, coups de sabre (« assaut », « sabre »), chacun à son rythme.
    - Au choc d'une charge, les chevaux du premier rang se cabrent un instant (par le code).
  - Vérif : vidéo d'une charge de cavalerie sur une ligne.
  - Fichiers : `web/js/battle/dev/cuire.mjs`, `web/anims/soldat.*`, `web/js/battle/troupes.js`, `web/js/battle/gestes.js`
  - Taille : M

- [ ] **Point de contrôle 7d** : bancs, cinq scénarios, galerie, commit.

### 7e : vue de loin

- [ ] **T42 : échelle et nombre de figurines selon la distance**
  - Critères :
    - Par régiment, `gestes.js` (`scaleAt`) donne l'échelle (×1 à environ ×2) et le nombre d'hommes par figurine selon
      la distance à la caméra : par paliers, avec une marge, en restant dans l'emprise.
    - À la vue d'ensemble du bocage, chaque soldat fait au moins 3 px de large et 8 px de haut, et un régiment se lit
      comme un bloc d'hommes.
    - L'agrandissement maximal est choisi sur captures.
  - Vérif :
    - banc (`scaleAt` croissante, bornée, avec marge) ;
    - captures de la vue d'ensemble et de la mi-distance, à côté des captures de référence ;
    - triangles relevés.
  - Fichiers : `web/js/battle/gestes.js`, `web/js/battle/troupes.js`, `tests/gestes.test.mjs`
  - Taille : M

- [ ] **Point de contrôle 7e** : bancs, cinq scénarios, galerie, commit.

### 7f : scène

- [ ] **T43 : couleurs et lumière du terrain**
  - Critères :
    - Lumière chaude, couleurs un peu passées.
    - Herbe en touffes de plusieurs verts, blés dorés, brume bleutée au loin.
    - Captures comparées côte à côte aux captures de référence (bocage, landes, vignes).
    - Heures, nuit et météo toujours justes.
  - Vérif : captures des vues types à midi, matin, soir, brouillard, neige.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/textures.js`, `web/js/battle/relief.js`
  - Taille : M

- [ ] **T46 : herbe et végétation en relief** (demande du 17/10/2026)
  - Critères :
    - Les prés ont une herbe en relief près de la caméra :
      - mêmes couches empilées que les blés (T26), le masque de végétation étendu à l'herbe ;
      - brins plus fins et plus serrés, plusieurs verts, coins secs, quelques fleurs ;
      - ondulation au vent.
    - Les landes et les friches ont leur propre relief, plus bas et plus touffu.
    - Plus loin, la texture du sol montre des touffes et des coins secs (pas d'aplat).
    - Les pieds des soldats sont un peu dans l'herbe.
    - Le nombre de couches suit la qualité (`epis`) ; aucune en Basse.
  - Vérif :
    - captures au ras, à mi-distance et en plongée façon Ultimate General (bocage, landes), à côté des captures de
      référence ;
    - images par seconde relevées.
  - Fichiers : `web/js/battle/terrain.js`, `web/js/battle/textures.js`, `web/js/battle/relief.js`,
    `web/js/battle/qualite.js`
  - Taille : M

- [ ] **T44 : fumée et effets à l'échelle des figurines**
  - Critères :
    - Bouffées à l'échelle des figurines (rayon selon leur échelle).
    - Une salve laisse un banc de fumée continu le long de la ligne, d'environ 2 à 3 hauteurs d'homme.
    - Éclairs de bouche, poussière des charges, gerbes de terre lisibles.
    - Le nombre de fumées reste borné par la qualité.
  - Vérif : vidéo d'un échange de salves ; captures de la vue d'ensemble pendant un combat.
  - Fichiers : `web/js/battle/effets.js`, `web/js/battle/vue.js`
  - Taille : S

- [ ] **T45 : vérification finale, README, revue**
  - Critères :
    - Critères 1 à 18 de la spec vérifiés sur captures et vidéos.
    - README à jour : animations, tués, bâtiments, crédit Quaternius (CC0).
    - /review fait et ses corrections commitées.
    - Galerie finale.
  - Vérif : `python3 tests/lancer.py` ; cinq scénarios et une bataille de campagne sans erreur.
  - Fichiers : `README.md`, `SPEC-3D.md` (état de l'étape 7)
  - Taille : S

- [ ] **Point final de l'étape 7** : tu essaies sur l'iPad (images par seconde en Haute) et tu juges l'allure en
  jouant.
