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
