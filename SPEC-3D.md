# Spec : batailles en 3D (style Ultimate General : American Revolution)

## Objectif

Remplacer la vue 2D des batailles (vue cavalière dessinée sur un canevas) par une vraie scène 3D qui ressemble aux
captures d'Ultimate General : American Revolution : relief en volume, champs peints, arbres et maisons en volume,
milliers de petits soldats 3D en rangs, nuages de fumée blanche le long des lignes de feu, fanions « drapeau + effectif »
au-dessus des régiments, médaillon des généraux, caméra libre.

Pour qui : le joueur, sur l'iPad (tactile) et sur le PC (souris, clavier). Le Raspberry Pi ne sert que de serveur.

Ce qui ne change pas : le moteur Python et ses API (`/api/tactic_map`, `/api/tactic`, `/api/cmd`), les règles, les
ordres, l'interface de bataille (barre des unités, panneaux, boutons, journal, bulles du tutoriel, mini-carte).

### Choix validés

- Moteur : **Three.js r186**, copié dans `web/vendor/three/` (marche hors ligne, sur le Pi comme sur l'iPad).
- Caméra **libre façon Total War** : rotation, la vue se couche quand on zoome, jusqu'au ras des troupes.
- La vue 2D est **remplacée**, sans repli. Sans WebGL 2, un message propose la résolution automatique.

### Hypothèses (à corriger si besoin)

1. Soldats, chevaux, canons : modèles 3D simples **construits par le code** (pas de fichiers téléchargés), animés sur
   la carte graphique. Uniformes à la couleur du camp, coiffures selon l'année (tricorne, bicorne, shako, képi, bonnet
   à poil), comme aujourd'hui.
2. Le sol garde la **peinture actuelle** de `terrain.js` (parcelles, sillons, routes, eau, saisons), posée sur un relief
   3D. Arbres, maisons, église, moulins, remparts, brèches, haies, murets, clôtures, ponts et portes passent en 3D.
3. Appareils visés : iPad de 2019 ou plus récent (Safari avec WebGL 2), PC. La qualité automatique (Basse à Ultra) reste
   et règle le nombre de soldats, de fumées, d'arbres, les ombres et la finesse de l'image.
4. Les figurines des cartes d'unités (barre du bas) restent de petits dessins 2D : ce sont des icônes d'interface
   (validé). À l'étape 5, des captures montrent les cartes à côté des soldats 3D pour juger du contraste.

### Ce que voit le joueur (critères d'acceptation)

| # | Élément | Attendu |
|---|---|---|
| 1 | Relief | Collines en volume, éclairées par le soleil de l'heure ; une colline cache ce qui est derrière. Au-delà du champ, le terrain se prolonge et se perd dans la brume. |
| 2 | Caméra | Glisser : déplacer. Pincer ou molette : zoomer, de tout le champ jusqu'au ras des troupes ; la vue se couche en zoomant. Deux doigts qui tournent ou clic droit glissé : pivoter. Double appui sur un régiment : y aller. |
| 3 | Régiments | Un soldat 3D par homme (dans la limite de la qualité), en rangs selon la formation : ligne, colonne, carré, tirailleurs. Porte-drapeau (drapeau qui flotte), tambours, officiers, colonel à cheval. |
| 4 | Animations | Marche (jambes, pas cadencé), pas de course et charge baïonnette en avant, mise en joue et salve qui roule le long du front, rechargement, déroute (fuite en désordre), mêlée. Chevaux au pas et au galop. Recul des pièces et servants qui s'affairent. |
| 5 | Feu | Éclairs de bouche, nuages de fumée blanche qui s'épaississent le long des lignes et partent avec le vent, boulets en vol avec ricochets, gerbes de terre, mitraille, explosions, poussière des charges. |
| 6 | Fanions | Au-dessus de chaque régiment, taille constante : carré aux couleurs du camp avec le pictogramme de l'arme, puis l'effectif. Barre de moral pour ses troupes, fanion barré en déroute. Généraux : médaillon rond et nom. |
| 7 | Décor | Arbres en volume (feuillus, pins, sapins, peupliers, buissons, arbres nus l'hiver, meules), maisons à toits à deux pans, église et clocher, moulins, remparts et bastions avec brèches, tranchées, barricades, haies, murets, clôtures, ponts. Ombres portées. |
| 8 | Atmosphère | Heure du jour (matin doré, soir orangé, nuit bleue), ombres des nuages qui passent, brume de distance, brouillard, pluie, neige, orage, selon la météo envoyée par le serveur. Tués et trous d'obus restent au sol. |
| 9 | Commandes | Tout marche comme avant : choisir, cadre de sélection, glisser pour tracer la route (flèche et silhouettes d'arrivée), ligne d'arrivée orientée, déploiement par glisser dans la zone, cibler un ennemi, portées, zone de ralliement, objectif d'un assaut, mini-carte (le cadre de la vue devient un trapèze). |
| 10 | Performances | ≥ 30 images/s sur un iPad de 2019 en qualité Haute, avec 20 régiments et la fumée d'un combat. La qualité descend toute seule si l'appareil peine. |
| 11 | Sans WebGL 2 | Message clair et choix « Résolution automatique » ; le jeu ne se bloque pas. |

## Tech stack

- JavaScript en modules ES, sans outil de construction (comme aujourd'hui).
- Three.js r186 (`three.module.min.js` + `three.core.min.js`, licence MIT copiée à côté). Pas d'« addons » : ce qu'il
  faut en plus (fusion de géométries, etc.) est écrit en quelques lignes.
- WebGL 2 (iPadOS 15 et plus, tous les navigateurs de PC récents).
- Aucun changement côté Python.

## Commandes

```bash
python3 tests/lancer.py                                   # tous les bancs (Python + interface)
node --test tests/                                        # l'interface seule
node web/js/battle/dev/maquette.mjs --port 8816           # bataille simulée, sans le moteur Python
#   puis http://127.0.0.1:8816/js/battle/dev/banc.html?scen=bocage&start=1&avance=300
node --experimental-websocket web/js/battle/dev/capture.mjs bocage /tmp/bocage.png   # capture d'écran (Chromium sans écran)
./lancer.sh                                               # jouer (http://127.0.0.1:8790)
```

## Structure

```
web/vendor/three/            NOUVEAU : three.module.min.js, three.core.min.js, LICENSE
web/js/battle/vue.js         RÉÉCRIT : moteur WebGL + calque 2D par-dessus (fanions, gestes, tracés au sol, pluie),
                             boucle, interrogation du serveur (inchangée), interpolation (inchangée)
web/js/battle/camera.js      NOUVEAU : caméra orbitale (cible, distance, cap, inclinaison qui suit le zoom),
                             passage monde ↔ écran (toScreen, toWorld par lancer de rayon sur le relief) ; maths pures
web/js/battle/relief.js      NOUVEAU : maillage du relief par tuiles, textures peintes par terrain.js (niveau de détail
                             selon la distance), ciel, brume, au-delà du champ
web/js/battle/decor.js       NOUVEAU : arbres instanciés, maisons, église, moulins, remparts et brèches, tranchées,
                             barricades, haies, murets, clôtures, ponts, portes
web/js/battle/terrain.js     GARDÉ : la peinture du sol (sans les arbres, maisons et ombrages, désormais en 3D) ;
                             perd le dessin 2D par tuiles à l'écran
web/js/battle/troupes.js     NOUVEAU : soldats, chevaux, canons, caissons, drapeaux en 3D instanciés ; animation
                             dans le vertex shader ; dispositions des rangs reprises de unites.js (layout)
web/js/battle/fanions.js     NOUVEAU : fanions façon Ultimate General et médaillons des généraux (calque 2D)
web/js/battle/unites.js      RÉDUIT : seulement les petites figurines 2D des cartes d'unités
web/js/battle/effets.js      RÉÉCRIT : fumées en panneaux face à la caméra, éclairs, boulets, éclats en 3D ;
                             pluie, neige, éclairs d'orage restent sur le calque 2D
web/js/battle/commandes.js   ADAPTÉ : rotation (deux doigts, clic droit), déplacement dans le repère de la caméra,
                             tracés au sol projetés
web/js/battle/interface.js   ADAPTÉ : cadre de la vue sur la mini-carte
web/js/battle/qualite.js     ADAPTÉ : profils pour la 3D (densité, soldats, fumées, arbres, ombres, détail du sol)
web/js/battle/dev/capture.mjs NOUVEAU : capture d'écran du banc d'essai par Chromium sans écran
web/js/battle/dev/essai-terrain.html  SUPPRIMÉ (mesurait le dessin 2D par tuiles)
tests/camera.test.mjs        NOUVEAU : aller-retour monde → écran → monde, bornes de la caméra
tests/troupes.test.mjs       NOUVEAU : dispositions (nombre d'hommes, rangs, carré, déroute)
README.md                    « Vue de bataille » et « Organisation du code »
```

Repère : x du jeu → X de Three.js, y du jeu (vers le sud) → Z, altitude → Y. Un mètre = une unité.

## Style de code

Celui du code existant : classes et fonctions courtes, commentaires en français qui disent le pourquoi, constantes en
majuscules, pas de dépendance hors Three.js, `try/catch` autour de localStorage, mémoire GPU libérée (`dispose()`) à la
sortie de la bataille.

```js
// caméra orbitale : la cible au sol, la distance, le cap (0 = regard vers le nord) ; l'inclinaison suit la distance
// (de haut quand on voit tout le champ, presque à l'horizontale au ras des troupes)
export function pitchAt(dist) { return clamp(0.32 + 0.9 * Math.log10(dist / 40) / Math.log10(3000 / 40), 0.32, 1.22); }

export class OrbitCam {
  constructor(heightAt) { this.heightAt = heightAt; this.x = 1500; this.y = 1000; this.dist = 1800; this.yaw = 0; }
  // position de l'œil dans le repère de Three.js (x, altitude, y)
  eye() {
    const p = pitchAt(this.dist), h = this.heightAt(this.x, this.y);
    return [this.x - Math.sin(this.yaw) * Math.cos(p) * this.dist, h + Math.sin(p) * this.dist, this.y + Math.cos(this.yaw) * Math.cos(p) * this.dist];
  }
}
```

## Stratégie de test

- **Bancs Node** (`node --test tests/`, sans navigateur) pour la logique pure : caméra (aller-retour monde ↔ écran à
  1 m près sur un relief, bornes, inclinaison), dispositions des rangs (nombre de figurines, carré à quatre faces,
  déroute éparpillée, drapeau au premier rang). Les bancs existants (`interface.test.mjs`, Python) doivent passer.
- **Captures d'écran** (`dev/capture.mjs`) des cinq scénarios du banc (bocage, landes, vignes, montagne, assaut), à
  plusieurs heures et météos, comparées à l'œil aux captures de référence d'Ultimate General.
- **Essai à la main** sur l'iPad et le PC : gestes, mesure des images par seconde (indicateur déjà présent).

## Limites

- **Toujours** : garder les API du serveur telles quelles ; lancer `python3 tests/lancer.py` avant chaque commit ;
  libérer la mémoire GPU à la sortie ; borner tout par la qualité graphique (Safari sur iPad est avare de mémoire).
- **Demander d'abord** : toute autre dépendance que Three.js ; tout changement du moteur Python ou des règles ;
  un changement visible de l'interface hors du champ de bataille ; la suppression d'une commande ou d'un geste.
- **Jamais** : charger Three.js depuis un CDN (le jeu doit marcher hors ligne) ; modifier les fichiers de
  `web/vendor/` ; casser une partie sauvegardée.

## Critères de réussite

1. Les cinq scénarios du banc s'ouvrent en 3D sans erreur dans la console, et une vraie bataille lancée depuis la
   campagne aussi.
2. Les captures montrent : relief, champs peints, arbres et maisons en volume, soldats 3D en rangs, fumée blanche,
   fanions avec effectif, médaillons des généraux.
3. Les gestes du tableau (critère 9) marchent à la souris et au doigt.
4. ≥ 30 images/s en qualité Haute sur un iPad de 2019 (à vérifier par toi sur l'appareil).
5. `python3 tests/lancer.py` passe, avec les nouveaux bancs.
6. Le README décrit la nouvelle vue.

## Livraison par étapes (chaque étape est jouable et commitée)

1. Three.js, caméra, relief texturé, commandes et calque 2D : la bataille se joue en 3D avec des blocs à la place des
   régiments.
2. Soldats, chevaux, canons 3D animés ; fanions façon Ultimate General.
3. Fumées, éclairs, boulets, poussière ; lumière de l'heure, brume, météo.
4. Décor 3D : arbres, maisons, remparts et brèches, haies, ponts ; ombres.
5. Réglages de qualité, mesure sur l'iPad, README, nettoyage du code 2D.

## Questions ouvertes

- Aucune bloquante. Les hypothèses 1 à 4 ci-dessus sont à confirmer.

## Étape 6 : se rapprocher du rendu d'Ultimate General

### Pourquoi

Les étapes 1 à 5 sont livrées. Comparées aux captures d'Ultimate General (trois images envoyées le 15/10/2026), il
manque l'allure :

- les soldats sont des assemblages de pavés, trapus (grandis ×1,6), éclairés à facettes ;
- le blé est jaune vif et plat, les chemins sont de minces traits, l'herbe est uniforme ;
- les arbres sont des boules à facettes ;
- la lumière est dure (couleurs brutes, sans courbe filmique ; ombres presque noires).

But : à distance de caméra égale, le joueur reconnaît le style d'Ultimate General.

### Choix validés (questionnaire du 15/10/2026)

- Soldats **arrondis, construits par le code**. Pas de modèles importés ni de chargeur glTF. Une **version simple de
  loin** garde l'iPad fluide.
- En plus des soldats : **champs et chemins**, **arbres**, **lumière et couleurs**.

### Hypothèses (à corriger si besoin)

1. **Soldats.** Corps, basques, membres et tête arrondis. Silhouette fine. Vrai tricorne à bords relevés (et bicorne,
   shako, etc. selon l'année). Buffleteries blanches croisées, guêtres, fusil fin à baïonnette. Éclairage doux, sans
   facettes visibles à mi-distance. Les mêmes animations qu'aujourd'hui.
2. **Taille.** Les figurines seront moins grandies et plus fines. La taille finale sera choisie sur captures (entre ×1,25
   et ×1,6) : la plus proche des images d'Ultimate General qui garde une ligne lisible de loin.
3. **Chevaux, cavaliers, officiers, tambours, porte-drapeau, servants.** Même traitement que les soldats. Les canons et
   caissons gagnent des roues à rayons et un fût plus galbé.
4. **Version simple de loin.** Chaque figurine a deux modèles. On passe de l'un à l'autre selon la distance, sans saut
   visible à l'écran. Les deux modèles ont les mêmes animations.
5. **Champs.**
   - Les cultures proches de la caméra (environ 300 m) ont un vrai relief (épis qui ondulent au vent) ; plus loin, la
     peinture à sillons suffit.
   - Couleurs : blé or doux plutôt que jaune vif, plusieurs teintes selon les parcelles (mûr, vert, chaume, labour).
6. **Chemins.** Larges et usés, bords adoucis, ornières, herbe au milieu des chemins de terre. Une route se distingue
   d'un chemin.
7. **Herbe.** Taches de plusieurs verts et coins secs, plus fines de près.
8. **Arbres.**
   - Couronnes faites de plusieurs touffes arrondies : dessus éclairé, dessous sombre, teintes variées, pas de facettes
     visibles.
   - Bois au toit bosselé.
   - Même nombre d'arbres par niveau de qualité.
9. **Lumière et couleurs.**
   - Courbe filmique, soleil plus doux, ombres teintées (bleutées le jour) au lieu de noires.
   - Ombre de contact sous chaque soldat, cheval, canon et arbre ; légère brume de distance.
   - Couleurs un peu moins saturées.
   - L'heure, la nuit et la météo marchent comme avant.
10. **Ce qui ne change pas.** Le moteur Python, les API, les règles, les commandes et gestes, l'interface, les noms des
    niveaux de qualité, les petites figurines 2D des cartes d'unités.

### Critères de réussite de l'étape 6

1. **Captures côte à côte avec les images d'Ultimate General**, aux trois distances (vue d'ensemble comme l'image 2,
   mi-distance comme l'image 1, au ras des troupes), en bocage, landes et vignes. Elles montrent :
   - soldats arrondis sans pavés visibles à mi-distance ;
   - blé en relief et de teintes variées ;
   - chemins larges et usés ;
   - arbres touffus ;
   - lumière douce avec ombres de contact.

   Tu juges l'allure sur ces captures.
2. **Charge graphique.** En qualité Haute, le nombre de triangles dessinés par image (`renderer.info`) ne dépasse pas
   celui d'aujourd'hui de plus de 10 %, sur les trois vues types du scénario bocage. La version simple de loin
   finance les soldats arrondis et les touffes des arbres.
3. **Aucune erreur** dans la console sur les cinq scénarios. Les animations restent visibles sur captures : marche,
   salve, charge, déroute, galop, recul des pièces.
4. **Tests.** `python3 tests/lancer.py` passe, avec un banc des modèles : chaque sommet a un os valide, et les deux
   versions d'une figurine ont les mêmes os, la même hauteur et la même orientation.
5. **iPad.** ≥ 30 images/s en qualité Haute sur un iPad de 2019, à vérifier par toi sur l'appareil.

### Livraison de l'étape 6 (chaque sous-étape est jouable et commitée)

1. **6a, fantassin arrondi** (prototype). Je te montre des captures à trois tailles pour valider l'allure avant de
   généraliser. C'est le point d'arrêt.
2. **6b, toutes les figurines.** Officiers, tambours, porte-drapeau, cavaliers et chevaux, servants, canons, caissons,
   puis la version simple de loin.
3. **6c, lumière et couleurs.**
4. **6d, champs, chemins, herbe.**
5. **6e, arbres.** Puis captures finales côte à côte, revue et README.

### État de l'étape 6

Livrée le 15/10/2026 (T18 à T28, voir tasks/todo.md). Reste à juger par toi en jouant sur l'iPad : l'allure, et la
fluidité en qualité Haute (épis en relief et touffes des arbres jamais mesurés sur un vrai processeur graphique).

### Questions ouvertes de l'étape 6

- **Taille des soldats.** Tranchée sur les captures de 6a.
- **Coût du blé en relief sur l'iPad.** Il est inconnu. S'il est trop cher, le relief est réservé aux qualités Haute et
  Ultra, et les autres gardent la peinture à sillons.

## Étape 7 : animer les batailles et se rapprocher d'Ultimate General

### Pourquoi

Après l'étape 6, la bataille ne ressemble toujours pas assez à Ultimate General : American Revolution. Comparée aux
dix captures officielles du jeu (page Steam, 17/10/2026), elle pèche sur cinq points :

- les hommes sont figés : même pose pour tous, bras de rechargement à peine baissé, aucun geste de mêlée ;
- les tués s'évaporent par paquets de 8, puis une tache peinte apparaît au sol ;
- un changement de formation fait sauter les hommes à leur nouvelle place ; une conversion fait tourner le régiment
  d'un bloc, comme sur un plateau ;
- de loin, les régiments ne sont plus que de minces traits ;
- les soldats sont posés dans les maisons et traversent leurs murs.

Le prototype (`web/js/battle/dev/anims.html`, commits du 17/10/2026) a validé la méthode. Les animations libres de
droits de Quaternius (Universal Animation Library 1 et 2, CC0) sont précalculées par `dev/cuire.mjs` sur les os de
nos figurines (`web/anims/soldat.bin`, 285 Ko). Les gestes du fusil (en joue, à genoux, recharge, baïonnette croisée,
estoc) sont posés par cinématique inverse. Le prototype ajoute aussi :

- une lumière enveloppante et une ombre plus sombre vers les pieds ;
- une teinte d'habit propre à chaque homme ;
- des rangs lâches ;
- un fondu entre deux gestes ;
- des proportions trapues (tête et chapeau plus forts, buste plus large).

But : à distance de caméra égale, les captures d'une bataille se lisent comme celles d'Ultimate General. Les régiments
vivent : ils marchent, tirent, rechargent, tombent, courent à leur place et se battent au corps à corps.

### Choix validés (questionnaires du 17/10/2026)

- **Les quatre familles d'animations :**
  - chute des tués, avec des corps en 3D qui restent au sol ;
  - hommes qui courent à leur place ;
  - feu, recharge et vie au repos ;
  - mêlée et charges.
- **En plus :** la vue de loin, les couleurs et la lumière, la fumée et les effets, et des troupes qui ne traversent plus
  les bâtiments (demande du 17/10/2026).
- **Animations libres de droits (CC0)**, précalculées. Pas de chargeur glTF dans le jeu. Rien n'est repris d'Ultimate
  General : ses fichiers appartiennent à Game-Labs.
- **Qui est animé :**
  - les fantassins : infanterie, grenadiers, légers, miliciens, officiers, tambours, porte-drapeau ;
  - les servants des pièces ;
  - les cavaliers.
  Les chevaux gardent l'animation par le code, car la bibliothèque n'a que des humains.
- **Corps au sol :** ils restent toute la bataille, dans la limite d'un plafond par qualité. Au-delà, les plus anciens
  redeviennent les taches peintes d'aujourd'hui.
- **De loin, les figurines grossissent** (jusqu'à environ ×2), et le régiment reste un bloc d'hommes lisible.
- **Ordre :** 7a, 7b, 7c, 7d, 7e, puis 7f (tableau ci-dessous). Chaque sous-étape est jouable, capturée et commitée.

### Découpage

| Sous-étape | Contenu | Dépend de |
|---|---|---|
| 7a `figurines-animees` | les animations précalculées dans les vraies batailles, gestes selon l'état, variété, fondus, lumière et proportions des troupes, servants des pièces | — |
| 7b `tues` | les hommes tombent un par un ; corps en 3D au sol ; un boulet couche une file | 7a |
| 7c `places` | les hommes courent à leur place (formation, conversion, pertes, déroute, ralliement) et contournent les bâtiments | 7a |
| 7d `melee` | mêlée et charges : estoc, poussée, rangs qui se mêlent ; cavaliers au squelette, sabres | 7a, 7c |
| 7e `vue-de-loin` | figurines grossies avec la distance, version de loin animée | 7a |
| 7f `scene` | couleurs et lumière du terrain, fumée et effets à l'échelle des figurines | — |

### Ce que voit le joueur (critères d'acceptation)

**7a, figurines animées**

1. **Gestes selon l'état du régiment :**

   | État | Geste |
   |---|---|
   | repos | repos (les officiers parlent) |
   | marche | marche au pas |
   | charge | charge, baïonnette croisée |
   | feu | en joue (le 1er rang d'une ligne à l'arrêt met genou à terre), au rythme de la salve qui roule le long du front |
   | recharge | recharge (baguette) |
   | déroute | course éperdue |
   | ralliement | trot vers le général, puis repos |

   Les tirailleurs tirent et rechargent chacun à son rythme.
2. **Pas de clones.** Chaque homme a :
   - sa place, à ±15 cm de celle du rang ;
   - son sens, à ±6° ;
   - sa taille, à ±5 % ;
   - sa teinte d'habit ;
   - son rythme, à ±6 % ;
   - ses horaires : il s'arrête, épaule et recharge quelques dixièmes de seconde avant ou après ses voisins.

   Tout cela est tiré une fois pour toutes par homme : rien ne saute quand le régiment change de forme.
3. **Fondu de 0,3 s entre deux gestes** : jamais de saut de pose.
4. **Lumière et allure du prototype :**
   - lumière enveloppante ;
   - ombre plus sombre vers les pieds ;
   - proportions trapues, pour la version de près comme pour la version de loin.
5. **Servants :** gestes au squelette, réglés sur le coup de leur pièce comme aujourd'hui (écouvillon, chargement du
   boulet, pointeur accroupi, boutefeu). Le tambour bat la caisse, le porte-drapeau porte la hampe.

**7b, tués**

6. Quand un régiment perd des hommes, autant de figurines qu'il le faut tombent (mort, touché à la tête, projeté) :
   - sous la mousqueterie, surtout le premier rang ;
   - sous un boulet, une file, le long de sa trajectoire.
   Les autres resserrent les rangs (en marchant, avec 7c).
7. **Les corps restent couchés en 3D** pendant toute la bataille, avec leur fusil, à l'endroit et dans le sens où ils
   sont tombés :
   - plafond : Basse 800, Moyenne 1 500, Haute 2 500, Ultra 4 000 (à régler sur l'iPad) ;
   - au-delà, les plus anciens redeviennent des taches peintes ;
   - jamais de corps dans l'emprise d'un bâtiment ni sur l'eau.
   Un cavalier tué tombe de sa selle ; son cheval mort reste couché.

**7c, places**

8. **À chaque nouvelle disposition**, chaque homme court à sa nouvelle place, au trot ou au pas selon la distance, puis
   se tourne face au front. Les nouvelles dispositions viennent :
   - d'une formation (ligne, colonne, carré, tirailleurs) ;
   - d'un front plus large ou plus étroit ;
   - des pertes ;
   - d'une déroute ou d'un ralliement.

   Les hommes gardent leur identité : celui de gauche reste à gauche si c'est possible.
9. **Conversion :** quand le régiment tourne sur place, ses hommes marchent pendant qu'il tourne. Plus de glissade.
10. **Bâtiments :** aucune figurine debout dans l'emprise d'une maison, d'une église ou d'un moulin (marge de 0,5 m).
    - Un homme dont la place tombe dans un bâtiment est repoussé dehors, au plus court.
    - Un régiment qui traverse un village s'écoule autour des maisons.
    - Le moteur, lui, laisse toujours les régiments occuper les villages : c'est une règle du jeu (couvert, ralliement).

**7d, mêlée et charges**

11. **Mêlée :**
    - les premiers rangs des deux régiments avancent l'un dans l'autre et se mêlent sur le front de contact ;
    - les hommes y font des estocs et des poussées, face à l'ennemi ;
    - les officiers frappent du sabre ;
    - les blessés tombent (7b).
12. **Cavaliers :** chaque cavalier est une figurine au squelette, assise sur le cheval actuel.
    - Sabre au clair à la charge, coups de sabre en mêlée.
    - Le cheval se cabre au choc (animation par le code).
    - Les dragons à pied gardent les gestes des fantassins.

**7e, vue de loin**

13. **Plus la caméra s'éloigne, plus les figurines grossissent** (jusqu'à environ ×2). Elles sont alors moins nombreuses,
    chacune comptant plusieurs hommes, et restent dans l'emprise du régiment. Vu de loin, un régiment reste un bloc
    d'hommes distincts. À la vue d'ensemble du scénario bocage, chaque soldat fait au moins 3 px de large et 8 px de
    haut.
14. La version de loin a les mêmes os et les mêmes gestes : une ligne lointaine marche, tire et tombe.

**7f, scène**

15. **Couleurs et lumière du terrain** se rapprochent des captures de référence :
    - lumière chaude, couleurs un peu passées ;
    - herbe en touffes de plusieurs verts ;
    - blés dorés ;
    - brume bleutée au loin.

    **Végétation en relief, carte réaliste** (demande du 17/10/2026 : « la végétation est plate ») :
    - les prés ont une vraie herbe en relief près de la caméra, comme les blés aujourd'hui : brins qui ondulent au
      vent, touffes plus hautes, quelques fleurs ;
    - plus loin, une texture d'herbe plus riche (touffes, coins secs, ombres) ;
    - les landes (bruyère, ajoncs) et les friches ont leur relief à elles ;
    - les pieds des soldats sont un peu dans l'herbe, comme dans Ultimate General.
16. **Fumée à l'échelle des figurines :**
    - les bouffées d'une salve se fondent en un banc continu le long de la ligne, d'environ 2 à 3 hauteurs d'homme ;
    - éclairs de bouche, poussière des charges, gerbes de terre des boulets.

**Partout**

17. **Performances :** ≥ 30 images/s en qualité Haute sur l'iPad de 2019, avec 20 régiments et la fumée d'un combat
    (comme le critère 10 du début). La qualité automatique descend si l'appareil peine.
18. **Rien de cassé :**
    - aucune erreur dans la console sur les cinq scénarios du banc ni dans une bataille lancée depuis la campagne ;
    - commandes, interface et parties sauvegardées inchangées.

### Tech stack

Celui des étapes 1 à 6 : JavaScript en modules ES, Three.js r186 copié dans `web/vendor/three/`, WebGL 2, aucun outil
de construction. Les animations sont un fichier précalculé (`web/anims/soldat.bin`, demi-flottants) lu dans une
texture ; le vertex shader place chaque os. Aucune nouvelle dépendance, aucun changement côté Python.

### Commandes

```bash
python3 tests/lancer.py                                   # tous les bancs (Python + interface)
node --test tests/                                        # l'interface seule
node web/js/battle/dev/cuire.mjs UAL1.glb UAL2.glb        # recalculer web/anims/soldat.* (bibliothèques Quaternius, versions Standard)
node web/js/battle/dev/maquette.mjs --port 8816           # bataille simulée ; puis /js/battle/dev/banc.html?scen=bocage&start=1
node web/js/battle/dev/capture.mjs bocage /tmp/b.png --q "avance=300" --js "…"     # capture du banc
node web/js/battle/dev/capture.mjs x /tmp/f.png --page banc.html --frames 180,0.1  # suite d'images → vidéo (ffmpeg)
./lancer.sh                                               # jouer (http://127.0.0.1:8790)
```

### Structure

```
web/js/battle/troupes.js     ADAPTÉ : figurines au squelette (RIG) pour fantassins, servants et cavaliers, de près et de
                             loin ; texture des animations ; gestes selon l'état ; variété par homme ; fondu ;
                             place de chaque homme (départ, arrivée, instant) ; répulsion des bâtiments ; échelle selon
                             la distance ; corps au sol (lot à part, plafonné)
web/js/battle/gestes.js      NOUVEAU : logique pure, sans Three.js (testée sous Node) : geste selon l'état et le rang,
                             variété par homme, appariement des places d'une disposition à l'autre, choix des tués,
                             anneau des corps, échelle selon la distance
web/js/battle/dev/cuire.mjs  ADAPTÉ : gestes des servants, du tambour, du cavalier en selle (sabre)
web/anims/soldat.bin, .json  RECALCULÉS ; LICENCE.txt (Quaternius, CC0)
web/js/battle/vue.js         ADAPTÉ : pertes → tués (7b) au lieu des taches ; boulets → files couchées
web/js/battle/terrain.js     ADAPTÉ : carte de répulsion des bâtiments (texture) ; couleurs du sol (7f)
web/js/battle/relief.js      ADAPTÉ : lumière, brume, étalonnage des couleurs (7f)
web/js/battle/effets.js      ADAPTÉ : bouffées à l'échelle des figurines, bancs de fumée continus (7f)
web/js/battle/qualite.js     ADAPTÉ : plafond des corps, fondu en Basse ou non
web/js/battle/dev/anims.html GARDÉ : page d'essai des gestes
tests/gestes.test.mjs        NOUVEAU : bancs de la logique pure
tests/modeles.test.mjs       ADAPTÉ : os de toutes les sortes au squelette, de près et de loin
README.md                    « Vue de bataille » (animations, tués, bâtiments) et crédit Quaternius (CC0)
```

### Style de code

Celui du code existant : français, commentaires qui disent le pourquoi, fonctions courtes, constantes en majuscules,
mémoire GPU libérée à la sortie. La logique qui ne dessine rien va dans `gestes.js`, testable sans navigateur :

```js
// geste d'un homme selon l'état de son régiment et sa place (rang 0 : le premier) ; le feu d'une ligne à l'arrêt met le
// premier rang à genoux
export function gesture(state, rank, form) {
  if (state === 'feu') return rank === 0 && form === 'ligne' ? 'genou' : 'joue';
  return GESTE[state] ?? 'repos';
}
```

### Stratégie de test

- **Bancs Node** (`tests/gestes.test.mjs`, `tests/modeles.test.mjs`) :
  - geste de chaque état ;
  - variété reproductible (même homme, même tirage) ;
  - appariement des places : chaque homme a une place, aucune place n'est prise deux fois, le trajet total est court,
    l'ordre gauche-droite est gardé ;
  - choix des tués (premier rang sous la mousqueterie, une file sous un boulet) ;
  - anneau des corps (plafond, les plus anciens sortent d'abord) ;
  - échelle selon la distance (croissante, bornée) ;
  - répulsion (un point dans une maison sort au plus court, un point dehors ne bouge pas) ;
  - os valides et identiques de près et de loin pour chaque sorte.
- **Captures et vidéos** (`dev/capture.mjs`, `--frames`, ffmpeg), pour chaque sous-étape, sur les cinq scénarios du banc :
  - de près, à mi-distance et en vue d'ensemble ;
  - comparées côte à côte aux captures de référence d'Ultimate General ;
  - publiées sur la page de la galerie, sur le réseau local.
- **Essai à la main** sur l'iPad (images par seconde) et le PC, à la fin de 7a puis de l'étape.

### Limites

- **Toujours :**
  - lancer `python3 tests/lancer.py` avant chaque commit ;
  - borner par la qualité (figurines, corps, fondus) ;
  - libérer la mémoire GPU à la sortie ;
  - tirer la variété par homme de façon reproductible ;
  - garder le moteur et les API tels quels.
- **Demander d'abord :**
  - toute dépendance nouvelle ;
  - tout changement du moteur Python ou des règles (par exemple interdire les villages aux régiments) ;
  - un changement de l'interface hors du champ de bataille ;
  - descendre l'objectif de 30 images/s.
- **Jamais :**
  - utiliser des fichiers d'Ultimate General ;
  - charger quoi que ce soit depuis Internet pendant le jeu ;
  - modifier `web/vendor/` ;
  - casser une partie sauvegardée.

### Critères de réussite de l'étape 7

1. Les critères 1 à 18 se voient sur les captures et les vidéos de chaque sous-étape, et tu les valides.
2. `python3 tests/lancer.py` passe, avec les nouveaux bancs.
3. Aucune erreur dans la console sur les cinq scénarios et dans une bataille de campagne.
4. ≥ 30 images/s en qualité Haute sur l'iPad de 2019 (à vérifier par toi), mesurées à la fin de 7a et à la fin de
   l'étape.
5. Le README décrit les animations, les tués, les bâtiments et crédite Quaternius (CC0).

### État de l'étape 7

Livrée le 18/10/2026 (T29 à T46, voir `tasks/todo-3d.md`), revue complète faite et corrigée ; où on en est et ce qui
reste : `tasks/reste-a-faire-etape7.md`. Galerie : `captures-3d/animations/` (hors dépôt).
- **Vus sur les captures :** critères 1 à 12, 14 à 16.
- **Bancs :** `python3 tests/lancer.py` passe, avec les bancs des gestes, des modèles et de la grille des bâtiments.
- **Rien de cassé (18) :** aucune erreur dans la console sur les cinq scénarios après dix minutes de bataille, ni
  dans une vraie bataille du mode Bataille (serveur Python), menée par les officiers.
- **Critère 13, vue d'ensemble :** avec ×2, un soldat y faisait 3,4 à 4,5 px de haut, et non 8. À ta demande, essai à
  ×3 (18/10/2026) : environ 6 à 7 px, des rangs plus aérés mais lisibles (galerie, « Essai ×3 ») ; à valider.
- **Pas mesuré :** critère 17 (images par seconde sur l'iPad 2019, en Haute).
- **À toi :** valider l'allure en jouant (critère 1 des critères de réussite).

### Questions ouvertes de l'étape 7

- **Plafond des corps par qualité :** les valeurs ci-dessus sont des points de départ, à régler sur l'iPad.
- **Coût des fondus et des corps sur l'iPad :** inconnu tant que l'iPad n'a rien mesuré. S'ils sont trop chers, la
  qualité Basse s'en passe (sans fondu, moins de corps).
- **Remparts :** les défenseurs se tiennent sur les remparts (comme dans Ultimate General). La répulsion ne vise que les
  maisons, l'église et les moulins, pas les murs d'enceinte. Les hommes passent par les brèches et les portes, comme le
  moteur le décide.
- **Agrandissement de loin :** ×2 au plus d'abord, ×3 à l'essai depuis le 18/10/2026 (critère 13).
- **Coût de l'herbe en relief sur l'iPad :** comme les blés, réservée aux qualités qui le supportent (`epis` dans
  `qualite.js`), mesurée au point final.
