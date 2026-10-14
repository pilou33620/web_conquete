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
