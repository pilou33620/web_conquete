# Étape 7 : ce qui reste à faire (point du 17/10/2026)

But de l'étape : que les batailles se lisent comme celles d'Ultimate General : American Revolution. Les régiments
marchent, tirent, rechargent, tombent, courent à leur place et se battent au corps à corps ; la vue de loin, le
terrain, l'herbe et la fumée suivent.

Documents de référence :
- `SPEC-3D.md`, section « Étape 7 » : critères 1 à 18, plus la végétation en relief en 7f ;
- `tasks/plan-3d.md`, section « Étape 7 » : décisions d'architecture 14 à 22, risques ;
- `tasks/todo-3d.md`, section « Étape 7 » : chaque tâche avec ses critères, sa vérification, ses fichiers et sa taille.

Ce fichier ne les remplace pas : il dit où on en est, comment reprendre, et ce qu'on a appris en route.

## Où on en est

Mode choisi par toi : `/build auto` sur tout le plan, avec une revue complète (`/review`) obligatoire à la fin.

**Faites et commitées :**

| Quoi | Commit |
|---|---|
| Prototype, page d'essai `dev/anims.html` (v1 et v2, validée) | `cf95d28`, `3ef8e13` |
| Spec de l'étape 7, plan, ajout de l'herbe (T46) | `4606c39`, `f5c9ba1`, `4f2b020` |
| T29 : fantassins de près au squelette dans les vraies batailles | `d861bcf` |
| T30 : version de loin au squelette, étoffe sur la hampe, ombre au sol qui suit les hanches, lumière enveloppante, ombre vers les pieds | `670feae` |
| T31 : salve qui roule, premier rang à genoux, tirailleurs, tambours, officiers en garde | `24a696e` |
| T32 : chaque homme différent (place, sens, taille, teinte, rythme, délai), fondus entre les gestes | `029c6a5` |
| T33 : servants des pièces au squelette (refouler, porter, pointer, boutefeu) | `db1dd47` |

T30 : captures de près et à mi-distance regardées, sans erreur. Seuls les triangles des vues types n'ont pas été
relevés : à faire au point de contrôle 7a.

**Restent, dans l'ordre :**

| Tâche | Sous-étape | En deux mots |
|---|---|---|
| Point 7a | | fait le 18/10/2026, sauf **ta mesure des images par seconde sur l'iPad** (voir `todo-3d.md`) |
| T34 | 7b | les hommes tombent ; corps en 3D au sol (anneau plafonné par qualité), au-delà, taches peintes |
| T35 | 7b | boulet qui couche une file (événement `canon`, `x2`/`y2`), chevaux morts |
| T36 | 7c | hommes qui courent à leur place (`matchSlots`, attribut `aMove`) |
| T37 | 7c | conversion et marche sans glissade |
| T38 | 7c | bâtiments : grille de 8 m lue par le shader, `pushOut` testé |
| T39 | 7d | mêlée (fronts qui se mêlent, estoc, poussée) |
| T40 | 7d | cavaliers au squelette, en selle |
| T41 | 7d | sabres des cavaliers, chevaux qui se cabrent |
| T42 | 7e | figurines plus grandes et moins nombreuses de loin (`scaleAt`) |
| T43 | 7f | couleurs et lumière du terrain |
| T46 | 7f | herbe et végétation en relief (demande du 17/10/2026) |
| T44 | 7f | fumée à l'échelle des figurines (aujourd'hui faite pour des figurines ×1,6 vues de loin) |
| T45 | 7f | vérification finale, README (crédit Quaternius), **/review obligatoire** |

## Reprendre

```bash
python3 tests/lancer.py                    # tous les bancs (environ 40 s), à lancer avant chaque commit
node --test tests/gestes.test.mjs          # logique des gestes
free -m                                    # avant toute capture : il faut au moins 1,5 Go de libre (voir « Pièges »)

# capture d'un régiment qui marche, suivi de près
node web/js/battle/dev/capture.mjs bocage /chemin/x.png --q "avance=60" --wait 3000 --size 1400x800 \
  --timeout 400000 --js "window.__zoom=0.45; $(cat web/js/battle/dev/suivre.js)"

# galerie sur le réseau local (http://192.168.1.31:8799/ ; Tailscale : http://100.80.111.121:8799/)
python3 -m http.server 8799 --bind 0.0.0.0 --directory captures-3d/animations
```

Pour recalculer les animations (T31, T33, T40 ajoutent des gestes dans `dev/cuire.mjs`), il faut d'abord retélécharger
les bibliothèques. Elles ne sont pas dans le dépôt, et `/tmp` est vidé à chaque redémarrage :

```bash
mkdir -p ~/.cache/conquete-dev/ual && cd ~/.cache/conquete-dev/ual
curl -sLO https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip
curl -sLO https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip
unzip -oq universal_animation_librarystandard.zip -x "*Unity*" "*Unreal Engine*"
unzip -oq universal_animation_library_2standard.zip -x "*Unity*"
cd ~/Documents/web_conquete
node web/js/battle/dev/cuire.mjs ~/.cache/conquete-dev/ual/"Animation Library[Standard]"/Godot/AnimationLibrary_Godot_Standard.glb \
  ~/.cache/conquete-dev/ual/"Universal Animation Library 2 [Standard]"/Unreal-Godot/UAL2_Standard.glb
```

## Comment c'est fait (décisions 14 à 22 du plan, en bref)

- **Un geste par homme, choisi par le processeur et joué par la carte graphique :**
  - `gestes.js` (logique pure, testée) donne le geste selon l'activité du régiment et la sorte de figurine ;
  - `troupes.js` l'écrit dans `aGest`/`aMix`, seulement pour le régiment dont l'activité change (`gestures(e, part)`) ;
  - le shader (branche `RIG`) lit la texture des animations et fond deux poses en 0,3 s.
- **Horloge des gestes :** celle des effets (`fx.t`), pour que salves, fumée et gestes restent ensemble.
- **Figurines :**
  - `Mesh` sur `InstancedBufferGeometry`, sans `instanceMatrix` ;
  - 11 attributs lus (seuls ceux que le shader lit comptent dans la limite de 16 ; un banc les compte) ;
  - activité et instant du changement gardés d'une disposition à la suivante (`e.act`, `e.actT`).
- **Os :** `RIG` + `RIG_EXTRA` dans `troupes.js`, dans l'ordre de `web/anims/soldat.json` (un banc le vérifie).
  - Le fusil, le bras et l'avant-bras gauches qui le portent ont leurs os à eux.
  - La hampe du drapeau et son étoffe suivent l'os du fusil (`pole`).
- **Le jeu sans le fichier des animations :** les hommes gardent leur pose de référence et une erreur va dans la
  console. Pas de blocage.

## Pièges rencontrés

- **Mémoire du Pi.**
  - Chaque session tmux de Claude Code « Remote Control » occupe environ 150 Mo, même sans session ouverte.
  - Avec toutes ouvertes, Chromium (rendu logiciel) n'a plus de place : l'échange se remplit, la charge monte à 45 et
    les captures ne finissent jamais, sans aucune erreur.
  - Fermer celles qui ne servent pas (compteur `Capacity: 0/32`), par exemple :
    `tmux kill-session -t WEB_3D` (de même pour `WEB_ANTENNA`, `web_menu`, `web_suite`, `tooth_dentaire`).
  - Claude Code n'a pas le droit de le faire lui-même sans une règle de permission.
- **Captures sur le Pi :**
  - une image toutes les 2 à 4 s : la caméra doit être posée directement (`v.cam = …`, `v.camAnim = null`), pas avec
    `moveCam` ;
  - `focusMine` recadre toutes les troupes : à neutraliser ;
  - la maquette ne bouge que sur ordre (`v.cmd('order', …)`), et le jeu est en pause tant qu'on n'a pas fait
    `v.cmd('speed', { v })` ;
  - l'ennemi caché par le brouillard ne peut pas être visé ;
  - l'horloge des gestes avance lentement en capture : c'est normal.
  - Tout cela est dans `dev/suivre.js`.
- **Clés de cache des programmes (`customProgramCacheKey`) :** elles doivent distinguer chaque combinaison de
  `defines`, sinon Three.js sert à une sorte le programme compilé pour une autre.
- **`put()` dans `rebuild`** doit recevoir le régiment `e` pour toute figurine au squelette (étoffe et servants
  compris) : ses gestes s'écrivent par régiment.
- **Fumée dans la page d'essai :** les bouffées d'`effets.js` sont réduites de moitié à la main (`shortcut:` dans
  `anims.html`). La vraie mise à l'échelle est l'objet de T44.

## Décisions qui t'attendent

- Plafond des corps au sol par qualité (800 / 1 500 / 2 500 / 4 000 proposés), réglé sur l'iPad au point 7b.
- Agrandissement maximal des figurines de loin (environ ×2), sur les captures de T42.
- Coût de l'herbe et des fondus sur l'iPad : mesures aux points 7a et final.
