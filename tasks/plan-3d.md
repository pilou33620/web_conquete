# Plan : batailles en 3D (SPEC-3D.md)

## Vue d'ensemble

La vue de bataille passe d'un canevas 2D en vue cavalière à une scène Three.js : relief texturé par la peinture
actuelle du sol, soldats 3D instanciés et animés sur la carte graphique, fumées en panneaux, décor en volume, caméra
orbitale. Le serveur, les ordres et l'interface ne changent pas. Cinq étapes, chacune jouable et commitée.

## Décisions d'architecture

1. **On garde l'API de la vue** utilisée par `commandes.js` et `interface.js` : `cam.x`, `cam.y`, `cam.z`,
   `moveCam`, `zoomAt`, `clampCam`, `toScreen`, `toWorld`, `unitAt`, `onScreen`, `mine`. `cam.z` garde son sens
   (pixels CSS par mètre à la cible) et se convertit en distance de caméra ; on ajoute `cam.yaw` (cap). Ces deux
   fichiers changent donc peu.
2. **Deux canevas** : le WebGL dessous, un calque 2D dessus qui reçoit les gestes (`v.cv` reste le calque). Le calque
   porte les fanions, les tracés au sol (projetés point par point, suivant le relief), les gestes, la pluie et la neige.
3. **Sol** : `terrain.js` garde sa peinture, en mode « à plat » (sans arbres, maisons ni ombrage du relief, qui
   passent en 3D). Le relief est découpé en tuiles ; chaque tuile reçoit une texture peinte dont la finesse suit la
   distance à la caméra (mêmes niveaux et même budget mémoire que les tuiles 2D d'aujourd'hui), l'image entière en
   secours. Tués, trous d'obus et brèches continuent d'être peints dans les textures.
4. **Troupes** : un `InstancedMesh` par sorte de figure (fantassin, cheval, cavalier, canon, caisson, drapeau). Chaque
   instance porte : numéro de l'unité, place dans l'unité (u, v), sens, pose, phase. Les positions et sens des unités
   sont dans une petite texture de données mise à jour à chaque image ; le vertex shader place la figure, lit
   l'altitude dans une texture du relief et anime les membres (attribut « os » par sommet). Coût par image :
   proportionnel au nombre de régiments, pas d'hommes. Les dispositions (`layout`) sont reprises de `unites.js`.
5. **Fumées** : quads instanciés tournés vers la caméra dans le shader, textures de bouffées déjà peintes par
   `effets.js`, mélange alpha sans écriture de profondeur. La logique (file d'effets, salves qui roulent, vent) reste.
6. **Lumière** : matériaux Lambert (légers sur iPad), soleil selon l'heure, ciel et brume selon la météo ; ombres des
   nuages et voile des couverts (déploiement) ajoutés au shader du sol par `onBeforeCompile`. Ombres portées selon
   la qualité.
7. **Captures** : `dev/capture.mjs` pilote Chromium sans écran (protocole DevTools, `--experimental-websocket` de
   Node 20) sur le banc d'essai ; c'est la vérification visuelle de chaque tâche.

## Graphe des dépendances

```
Three.js + capture ──┬── camera.js ──┬── vue.js 3D + relief (image entière) ──┬── commandes / mini-carte
                     │               │                                         ├── tuiles de texture du sol
                     │               │                                         ├── troupes (inf → cav → art) ── fanions
                     │               │                                         ├── effets 3D ── lumière / météo
                     │               │                                         └── décor (arbres, bâti, murs) ── ombres
                     └───────────────┴───────────────────────────────────────────── qualité, nettoyage, README
```

## Liste des tâches

Détail, critères et vérifications : `tasks/todo.md`.

### Étape 1 : la bataille se joue en 3D (régiments en blocs)
- [x] T1 : Three.js copié, outil de capture
- [x] T2 : caméra orbitale (maths pures) et ses bancs
- [x] T3 : vue WebGL, relief texturé par l'image entière, régiments en blocs, calque 2D
- [x] T4 : gestes, tracés au sol et mini-carte en 3D
- [x] T5 : tuiles de texture du sol selon la distance, décalcomanies, brèches, voile des couverts
- [x] Point d’étape 1 (captures envoyées, revue avec toi)

### Étape 2 : les troupes
- [x] T6 : fantassins 3D instanciés et animés, dispositions reprises
- [x] T7 : cavaliers, chevaux, état-major
- [x] T8 : batteries, servants, caissons, chariots
- [x] T9 : fanions façon Ultimate General, médaillons
- [x] Point d’étape 2

### Étape 3 : le feu et l'atmosphère
- [x] T10 : fumées, éclairs, boulets, éclats, poussière en 3D
- [x] T11 : lumière de l'heure, ciel, brume, ombres des nuages, pluie, neige, orage
- [x] Point d’étape 3

### Étape 4 : le décor
- [x] T12 : arbres instanciés
- [x] T13 : maisons, église, moulins, ponts, portes
- [x] T14 : remparts, bastions, brèches, tranchées, barricades, haies, murets, clôtures
- [x] T15 : ombres portées
- [x] Point d’étape 4

### Étape 5 : finitions
- [x] T16 : profils de qualité 3D, mesure automatique, message sans WebGL 2
- [x] T17 : nettoyage du code 2D, README, captures des cartes d'unités
- [x] Point final (/review, bancs, captures ; reste l'essai sur l'iPad)

## Risques et parades

| Risque | Impact | Parade |
|---|---|---|
| Chromium sans écran sur le Pi (SwiftShader) trop lent ou sans WebGL 2 | Moyen : plus de captures | Vérifié dès T1 ; petite fenêtre, peu d'images ; à défaut, captures faites par toi |
| Remplissage de pixels sur iPad (fumées superposées, Retina) | Haut | Densité plafonnée par la qualité, nombre de bouffées borné, fumée la plus fine coupée de loin |
| Mémoire de Safari (textures du sol) | Haut | Budget de tuiles de `qualite.js` repris, `dispose()` systématique, image entière en secours |
| Toucher juste un point du sol sur le relief | Moyen | `toWorld` par marche de rayon sur l'altitude, banc aller-retour à 1 m près |
| Gros changement de `vue.js` qui casse `interface.js` | Moyen | API de la vue gardée (décision 1), bancs d'interface à chaque tâche |
| Three.js (≈ 700 Ko) à charger sur l'iPad à chaque bataille | Bas | Chargé une fois par session (module ES en cache du navigateur) |
| Fanions et tracés du calque 2D passent devant une colline | Bas | Voulu : ce sont des repères d'interface, comme dans Ultimate General |

## Questions ouvertes

- Aucune.

---

# Étape 6 : se rapprocher du rendu d'Ultimate General (SPEC-3D.md, « Étape 6 »)

Validé le 15/10/2026 : tout enchaîner sans arrêt intermédiaire ni captures montrées (tu verras en jouant). Les
captures restent mon outil de vérification interne. La taille des soldats est choisie par moi sur ces captures.

## Décisions d'architecture

7. **Modèles arrondis construits par le code.** `troupes.js` garde `assemble()` (couleur, os, teinte par sommet). Les
   pavés deviennent des cylindres effilés, des sphères aplaties, des profils tournés (`LatheGeometry`) et des capsules
   (`CapsuleGeometry`), qui ont des normales lisses. Les os et pivots ne changent pas, donc le shader d'animation reste
   le même. Tricorne : un anneau dont le bord se relève entre trois pointes.
8. **Deux versions par figurine.** Pour chaque sorte, un modèle proche (arrondi, détaillé) et un modèle lointain (peu de
   sommets, mêmes os, même hauteur).
   - Choix par régiment, selon la hauteur de la figurine à l'écran (px), avec une marge pour ne pas basculer sans cesse.
   - Chaque version a ses propres `InstancedMesh` et tampons d'instances. Le changement de version d'un régiment
     relance `rebuild`, au plus quelques fois par seconde.
   - La vue d'ensemble n'utilise que le modèle lointain. C'est ce qui paie les modèles proches.
9. **Ombres de contact.** Une tache douce au sol sous chaque figurine : un quadrilatère instancié qui partage les
   tampons d'instances de sa sorte et le placement du shader (4 sommets par figurine).
10. **Lumière.**
    - Courbe filmique de Three.js (`NeutralToneMapping` ou `AgXToneMapping`, choisie sur captures) et intensités
      revues dans `Effects.ciel()`.
    - Ombres douces : `shadow.radius` du PCF de r186.
    - Ciel plus fort par rapport au soleil, pour des ombres teintées au lieu de noires.
    - Pas de passe d'après-rendu (mémoire de l'iPad).
11. **Cultures en relief.**
    - `terrain.js` peint une fois un masque « hauteur de végétation » sur tout le champ (2 m par pixel, un octet),
      avec les mêmes contours de parcelles que la peinture du sol.
    - Près de la caméra, des couches empilées du sol (« coquilles ») dessinent les épis : couleur prise dans la texture
      du sol, plus sombre en bas, ondulation au vent.
    - Nombre de couches par niveau de qualité (`epis` dans `qualite.js`) ; aucune en Basse.
12. **Arbres touffus.**
    - Couronne faite de 3 à 5 touffes d'icosaèdres (normales lisses), plus sombre dedans et dessous, teinte variée.
    - Deux versions selon la zone (750 m) : touffes détaillées près de la caméra, touffe simple au loin.
    - Le nombre d'arbres par qualité ne change pas.
13. **Mesure de la charge.** `renderer.info.render.triangles`, lu par `--js` dans le banc de capture, sur trois vues
    types du scénario bocage. Le relevé de départ est noté dans T18. Le critère est de rester sous le départ + 10 %.

## Liste des tâches (étape 6)

### 6a et 6b : figurines
- [x] T18 : banc des modèles, relevé de charge de départ
- [x] T19 : fantassins arrondis (toutes les sortes à pied) et taille
- [x] T20 : chevaux, cavaliers, canons, caissons arrondis
- [x] T21 : version simple de loin (choix par régiment)
- [x] Point de contrôle A (bancs, 5 scénarios sans erreur, charge ≤ départ + 10 %)

### 6c : lumière et couleurs
- [x] T22 : courbe filmique, soleil et ciel, ombres douces
- [x] T23 : ombres de contact sous les figurines

### 6d : sol
- [x] T24 : couleurs du sol (blé or doux, teintes par parcelle, herbe variée)
- [x] T25 : chemins larges et usés
- [x] T26 : cultures en relief près de la caméra
- [x] Point de contrôle B

### 6e : arbres et fin
- [x] T27 : arbres touffus (deux versions par zone)
- [x] T28 : vérification finale, README, revue
- [ ] Point final de l'étape 6

## Risques et parades (étape 6)

| Risque | Impact | Parade |
|---|---|---|
| Coquilles des épis trop chères sur l'iPad (pixels superposés, rejet de pixels) | Haut | Couches selon la qualité, rayon limité, coupées de loin et pendant les gestes ; Basse sans |
| Bascule de version visible, ou `rebuild` trop fréquent | Moyen | Marge entre les seuils, choix par régiment, au plus quelques reconstructions par seconde |
| La courbe filmique change toutes les couleurs (nuit, brouillard, neige, effets additifs) | Moyen | Captures heure par heure et météo par météo après T22 ; palettes revues en T24 |
| Plus de sommets par figurine proche | Moyen | Modèle lointain plus léger qu'aujourd'hui ; relevé de charge à chaque tâche |
| Allure jugée par moi seul, sans ton retour avant la fin | Moyen | Comparaison systématique avec tes trois images aux mêmes distances ; tu valides en jouant |
| Captures lentes sur le Pi (rendu logiciel) | Bas | Petites tailles et peu de captures par tâche |

## Questions ouvertes (étape 6)

- Aucune bloquante. Taille des soldats et courbe filmique choisies sur captures internes.

# Étape 7 : animer les batailles et se rapprocher d'Ultimate General (SPEC-3D.md, « Étape 7 »)

Spec validée le 17/10/2026. Six sous-étapes dans l'ordre 7a → 7b → 7c → 7d → 7e → 7f, chacune jouable, capturée,
publiée sur la galerie (réseau local) et commitée. Le prototype (`dev/anims.html`, `dev/cuire.mjs`) sert de référence
et de page d'essai.

## Décisions d'architecture

14. **Le geste de chaque homme est choisi par le processeur, joué par la carte graphique.**
    - `gestes.js` (logique pure, testée sous Node) décide, pour chaque figurine, quelle animation jouer, depuis quel
      instant et à quelle vitesse, ainsi que l'animation d'avant et l'instant du fondu.
    - `troupes.js` écrit ces valeurs dans les attributs d'instance du régiment, seulement quand son activité change :
      état, marche, conversion, salve, perte, nouvelle disposition. Il ne met à jour que la plage de ce régiment.
    - Le vertex shader ne fait que lire la texture des animations et fondre deux poses (0,3 s), comme dans le prototype.
    - Une salve s'écrit en une fois, avec une animation précalculée qui s'enchaîne d'elle-même : « en joue → feu →
      recharge ». Une version à genoux sert au premier rang. Les tirailleurs ont un cycle « feu libre ».
15. **Une seule horloge pour les gestes : celle des effets** (`fxT`). Les salves, la fumée et les gestes restent
    ensemble. En accéléré, tout va plus vite ; en pause, tout ralentit avec les effets.
16. **Place des attributs (16 au plus en WebGL).** Les figurines en utilisent déjà 13 avec `instanceMatrix`. On passe
    d'`InstancedMesh` à `Mesh` sur une `InstancedBufferGeometry`, sans `instanceMatrix`, ce qui libère 4 emplacements.
    `aBone` et `aPart` sont rangés dans un `vec2`, et `uv` n'est gardé que pour les étoffes. Les attributs d'instance
    deviennent :
    - `aSlot` (u, v, sens, régiment) ;
    - `aAnim` (variété, taille, rang, sorte) ;
    - `aClip` et `aPrev` (animation et animation d'avant) ;
    - `aMove` (départ, instant, durée de la course à sa place) ;
    - `aCoat`.
17. **Identité des hommes.**
    - Chaque figurine a un numéro stable dans son régiment.
    - Sa variété est tirée une fois pour toutes, par un hachage du régiment et de ce numéro : place, sens, taille,
      teinte, rythme, décalage d'horaire.
    - D'une disposition à la suivante, `gestes.js` apparie les hommes en gardant l'ordre de lecture (rang, puis file) :
      celui de gauche reste à gauche. Les morts sont retirés avant l'appariement.
18. **Courir à sa place.** Le shader mène chaque homme de sa place de départ à sa place d'arrivée, en coordonnées du
    régiment, entre deux instants. Il est au trot si le trajet dépasse 3 m, au pas sinon, tourné vers sa route, puis
    face au front, avec un fondu. Une conversion (le cap du régiment change) ou un déplacement met en marche ceux qui
    sont à l'arrêt.
19. **Bâtiments : une grille et une liste lues par le shader.**
    - `terrain.js` range les bâtiments dans une grille de 8 m. Chaque case garde au plus 4 bâtiments, chacun un
      rectangle orienté.
    - Le shader repousse une figurine hors du rectangle élargi de 0,5 m, vers le bord le plus proche.
    - `gestes.js` a la même fonction en JavaScript pour le banc.
    - Seulement maisons, église et moulins : pas les remparts.
20. **Corps au sol : un lot à part, en coordonnées du monde.**
    - Un homme tué quitte son régiment.
    - Il rejoint le lot des corps de sa sorte, avec sa position, son sens et sa teinte au moment de sa mort. Il y joue
      « mort », « touché à la tête » ou « projeté », puis garde la dernière image.
    - Le lot est un anneau plafonné par la qualité. Le plus ancien redevient une tache peinte (`terrain.addDecals`).
    - Le choix des tués (`gestes.js`) : sous la mousqueterie, surtout le premier rang ; sous un boulet, la file la plus
      proche de sa trajectoire (événement `canon`, point de chute `x2`, `y2`).
    - Un cheval tué : le cheval couché, une pose figée par le code.
21. **Cavaliers au squelette.** Le cheval perd son cavalier. Le cavalier devient une figurine au squelette posée sur la
    selle :
    - jambes à califourchon, une pose précalculée par `cuire.mjs` ;
    - même balancement que le cheval (même formule, mêmes données du régiment) ;
    - au repos, les gestes des bras ;
    - à la charge, le sabre levé ;
    - en mêlée, des coups de sabre.
    Le cheval se cabre au choc, par le code.
22. **De loin, moins de figurines, plus grandes.**
    - Pour chaque régiment, l'échelle des figurines et le nombre d'hommes par figurine suivent la distance à la caméra,
      par paliers et avec une marge, comme `lodOf`.
    - L'échelle va de ×1 à environ ×2. Le nombre de figurines baisse d'autant, pour que le régiment tienne dans son
      emprise.
    - La version de loin a les mêmes os et les mêmes gestes.

## Graphe des dépendances

```
cuire.mjs (gestes précalculés) ──┐
gestes.js (logique pure) ────────┼──> troupes.js : squelette, attributs, gestes (7a) ──┬──> tués, corps (7b)
qualite.js (plafonds) ───────────┘                                                    ├──> places, bâtiments (7c) ──> mêlée, cavaliers (7d)
                                                                                      └──> échelle de loin (7e)
terrain.js, relief.js, effets.js : couleurs, lumière, fumée (7f, indépendant)
```

## Liste des tâches (étape 7)

### 7a : figurines animées
- [x] T29 : squelette dans les vraies batailles (fantassins de près, gestes selon l'état)
- [x] T30 : version de loin au squelette, ombres, lumière et proportions du prototype
- [x] T31 : feu et recharge (salve qui roule, à genoux, tirailleurs), officiers, tambours, drapeau
- [x] T32 : variété par homme et fondus
- [x] T33 : servants des pièces au squelette
- [x] Point de contrôle 7a (bancs, cinq scénarios, galerie ; images/s sur l'iPad : en attente de toi)

### 7b : tués
- [x] T34 : les hommes tombent, corps en 3D au sol (anneau plafonné)
- [x] T35 : boulets qui couchent une file, chevaux morts
- [x] Point de contrôle 7b (plafond des corps sur l'iPad : en attente de toi)

### 7c : places et bâtiments
- [ ] T36 : hommes qui courent à leur place
- [ ] T37 : conversion, marche et arrêt sans glissade
- [ ] T38 : bâtiments (répulsion)
- [ ] Point de contrôle 7c

### 7d : mêlée et charges
- [ ] T39 : mêlée (fronts qui se mêlent, estoc, poussée, sabres des officiers)
- [ ] T40 : cavaliers au squelette, en selle
- [ ] T41 : sabres des cavaliers, chevaux qui se cabrent
- [ ] Point de contrôle 7d

### 7e : vue de loin
- [ ] T42 : échelle et nombre de figurines selon la distance
- [ ] Point de contrôle 7e

### 7f : scène
- [ ] T43 : couleurs et lumière du terrain
- [ ] T46 : herbe et végétation en relief (demande du 17/10/2026)
- [ ] T44 : fumée et effets à l'échelle des figurines
- [ ] T45 : vérification finale, README, revue
- [ ] Point final de l'étape 7

## Risques et parades (étape 7)

| Risque | Impact | Parade |
|---|---|---|
| Lectures de texture par sommet trop chères sur l'iPad (6 par sommet, 12 pendant un fondu) | Haut | Version de loin légère ; fondu limité à 0,3 s ; mesure sur l'iPad dès le point de contrôle 7a ; en Basse, pas de fondu |
| Plus de 16 attributs par sommet : le shader ne compile pas | Haut | Décision 16, faite dès T29 ; banc qui compte les attributs de chaque sorte |
| Mise à jour des attributs trop fréquente (salves, marches) | Moyen | Seulement la plage du régiment touché, seulement quand son activité change |
| Les hommes de loin et de près ne font pas le même geste à la bascule | Moyen | Mêmes os, même texture, mêmes attributs : la bascule ne change que le modèle |
| Corps trop nombreux sur une longue bataille | Moyen | Anneau plafonné par qualité, au-delà taches peintes ; plafond réglé sur l'iPad |
| Cavalier et cheval désaccordés (balancement, cabrage) | Moyen | Même formule de balancement dans les deux shaders ; capture du galop et du choc |
| Répulsion qui fait trembler les hommes au bord d'une maison | Bas | Repousser vers le bord le plus proche, sans rebond ; captures d'un régiment qui traverse un village |
| Captures lentes sur le Pi (rendu logiciel) | Bas | Petites tailles, vidéos courtes, lancées en arrière-plan |

## Questions ouvertes (étape 7)

- Plafond des corps et coût des fondus : réglés sur l'iPad au point de contrôle 7a (puis 7b).
- Agrandissement maximal de loin : environ ×2, tranché sur les captures de T42.
