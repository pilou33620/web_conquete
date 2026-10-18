# Étape 7 : où on en est et ce qui reste (point du 18/10/2026)

But de l'étape : que les batailles se lisent comme celles d'Ultimate General : American Revolution. Les régiments
marchent, tirent, rechargent, tombent, courent à leur place et se battent au corps à corps ; la vue de loin, le
terrain, l'herbe et la fumée suivent.

Documents de référence :
- `SPEC-3D.md`, section « Étape 7 » : critères 1 à 18, plus la végétation en relief en 7f ;
- `tasks/plan-3d.md`, section « Étape 7 » : décisions d'architecture 14 à 22, risques ;
- `tasks/todo-3d.md`, section « Étape 7 » : chaque tâche avec ses critères, sa vérification, ses fichiers et sa taille.

Ce fichier ne les remplace pas : il dit où on en est, comment reprendre, et ce qu'on a appris en route.

## Où on en est (18/10/2026)

Mode choisi par toi : `/build auto` sur tout le plan, avec une revue complète (`/review`) obligatoire à la fin.
**Tout le plan est fait (T29 à T46), revue comprise.** Il reste ton essai sur l'iPad et tes décisions (plus bas).

| Quoi | Commit |
|---|---|
| Prototype, page d'essai `dev/anims.html` (v1 et v2, validée) | `cf95d28`, `3ef8e13` |
| Spec de l'étape 7, plan, ajout de l'herbe (T46) | `4606c39`, `f5c9ba1`, `4f2b020` |
| 7a : T29 à T33 (fantassins, version de loin, salve, variété, servants), point 7a | `d861bcf` … `697ff73` |
| 7b : T34, T35 (tués, corps au sol, boulet), point 7b | `5883e59`, `aee9cff`, `d5ba68a` |
| 7c : T36 à T38 (course à sa place, conversion, bâtiments), point 7c | `48de304`, `801eb2f`, `9ddeb0d`, `96bb6a4` |
| 7d : T39 à T41 (mêlée, cavaliers, choc), point 7d | `3dd93b9`, `a408a77`, `923c83a`, `68158a8` |
| 7e : T42 (figurines plus grandes de loin) | `15226c9` |
| 7f : T43 (lumière), T46 (herbe), T44 (fumée à l'échelle) | `a520172`, `ab541a1`, `8f264bb` |
| T45 : README, revue et ses corrections, galerie, état de la spec | voir `git log` |

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
- **Salves en capture :** l'horloge des effets avance trop lentement sur le Pi, la file des événements du serveur
  s'accumule et déborde le plafond des bouffées. Pour voir une salve seule : vider `v.fx.queue` et `v.fx.puffs`,
  tirer, puis neutraliser `v.fx.push`, et avancer l'horloge avec `v.fx.update(0.25, …)`.
- **Vraie bataille en capture :** `~/.cache/conquete-dev/campagne.mjs` (hors dépôt) lance le serveur Python sur un
  port libre, avec ses sauvegardes dans un dossier temporaire (ta sauvegarde automatique n'est pas touchée), ouvre
  une bataille du mode Bataille et la confie aux officiers (`autofinish`).
- **`console.warn` compte comme une erreur** dans `capture.mjs` : la grille des bâtiments s'en sert pour signaler une
  case pleine.

## Décisions qui t'attendent

- **Images par seconde sur l'iPad 2019, en Haute** (critère 17) : jamais mesurées sur un vrai processeur graphique.
  La qualité baisse d'elle-même si la bataille saccade ; les corps au sol suivent désormais cette baisse.
- **Plafond des corps au sol** par qualité (800 / 1 500 / 2 500 / 4 000), à régler sur l'iPad.
- **Vue d'ensemble :** avec ×2, un soldat faisait 3,4 à 4,5 px de haut au zoom de la vue d'ensemble (la spec en
  demande 8). ×3 essayé et retenu le 18/10/2026 (constante `PALIERS` de `gestes.js`) : environ 6 à 7 px. Reste à
  le voir sur l'iPad ; pour revenir à ×2, retirer les paliers 2,5 et 3.
- **Caméra :** celle d'Ultimate General est plus couchée à mi-distance (hors spec).
- **Hauteur du blé en Haute :** depuis l'herbe (T46), les couches sont resserrées près du sol (8, 33, 73, 130 cm) ;
  le blé (1 m) ne montre plus que sa couche de 73 cm. Choix : 5 couches en Haute (un quart de coût en plus) ou un
  espacement moins serré (l'herbe perd une couche). À juger sur capture.

## Défauts corrigés le 18/10/2026 (à ta demande)

- **Recul du coup de feu** : un fondu par étape dans `cuire.mjs` (le coup de feu, sec : le recul monte d'un coup) ;
  animations recalculées (seules salve, salve à genoux et feu libre changent).
- **Herbe de loin** : les brins de 6 cm s'effacent plus près (de 67 à 112 m), à proportion de leur taille.
- **Cavalerie et attelages** : chevaux, cavaliers, fanions et pièces courent à leur nouvelle place comme les hommes
  (la course est commune à toutes les sortes dans le shader).
- **Bâtiments** : chevaux, cavaliers, fanions et pièces repoussés de tout leur long.

## Points de la revue laissés de côté (et pourquoi)

La revue du 18/10/2026 (deux relecteurs, 92 bancs, 45 mutations) a été corrigée pour tout ce qui était critique ou
requis. Restent, facultatifs :
- **Coût des reconstructions** : elles sont groupées (cinq par seconde au plus, au lieu d'une à chaque perte) et
  allégées (variété en cache, pas de copie par homme) ; une reconstruction de 9 740 figurines prend encore environ
  60 ms sur le Pi, contre 70 avant (mesures sous Node, bruitées par des captures en cours). Le vrai remède
  (corps dans des lots à part, mise à jour par régiment) est un chantier : seulement si l'iPad saccade.
- **`troupes.js`** fait 1 100 lignes (modèles, shader et état) : en sortir les modèles (`modeles.js`) si on y retouche.
- **Bâtiments, de loin :** chevaux et pièces sont repoussés de tout leur long tant que cette longueur tient dans la
  portée de la grille (3,5 m) ; de loin, grossis jusqu'à ×3, ils peuvent encore mordre un peu sur un mur (à peine
  visible à cette distance). Le remède : une portée plus grande, au prix de cases plus pleines.
- **Gerbes de terre** à l'échelle de la batterie qui tire, pas de la cible.
