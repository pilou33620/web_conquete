# Spec : les batailles en 2D vues de dessus (style Champs de Plaine)

## Pourquoi

Décision du 25/10/2026 : les batailles quittent la 3D (Three.js) pour une vue **à plat, vue de dessus**, dans le style
de Champs de Plaine (https://champsdeplaine.fr/jeu.html) : parcelles striées, haies et bois en boules, routes d'époque,
et des soldats dessinés vus d'en haut, un par homme, animés selon leur état. La 3D est **remplacée**, pas gardée en
option.

La référence visuelle est la maquette `web/js/battle/dev/maquette-2d.html` (page autonome, validée par le joueur). Son
code de dessin (figures, chevaux, pièces, caissons, drapeaux, fumée, sols, haies, bois, routes, rues pavées, bâtiments
d'époque, villes, tracé bastionné, dégâts et feu) est la base à reprendre : on le découpe en modules, on ne le réinvente
pas. Le moteur (`game/tactics`) garde ses règles ; seuls les ajouts listés en § 5 le touchent.

## 1. Repère et caméra

- Le champ de bataille est en mètres (comme aujourd'hui) : `x` vers l'est, `y` vers le sud, `W × H`.
- Caméra **verticale, sans pivot ni inclinaison** : `cam = { x, y, z }`, `z` en pixels CSS par mètre.
  Écran ↔ terrain : `sx = (x - cam.x) * z + vw / 2`, `sy = (y - cam.y) * z + vh / 2`. Plus de relief projeté.
- Gestes (`commandes.js`) : glisser (avec élan), pincer pour zoomer, molette ; plus de rotation à deux doigts.
- Cap d'une unité `dir` : l'avant est `(cos dir, sin dir)` (même convention qu'aujourd'hui, voir `vue.js`, `casualties`).

## 2. Un seul canevas 2D, des calques dans cet ordre

`BattleView` (`vue.js`) n'a plus de WebGL. À chaque image, sur un seul canevas :

1. **sol** (`Sol2D`) : la peinture du terrain, en tuiles mises en cache par niveau de zoom ; cratères, tués et
   piétinement y sont peints une fois pour toutes ;
2. **décor au sol** (`Decor2D.sous`) : bâtiments, murailles et bastions, ponts, clôtures, vie des champs ;
3. **troupes** (`Troupes2D.draw`) : ombres d'un seul tracé, puis les figures ;
4. **décor au-dessus** (`Decor2D.dessus`) : houppiers des bois (ajourés au-dessus des hommes), flammes des bâtiments ;
5. **effets** (`Effects.draw`) : fumée, éclairs, boulets, poussière ; puis l'atmosphère (pluie, neige, nuit) ;
6. **calque d'interface** (inchangé dans l'esprit) : tracés au sol des ordres, portées, anneau du régiment inspecté,
   lignes de front, objectif, fanions (`fanions.js`), étiquettes.

Chaque module dessine **en mètres** : il reçoit `view` et appelle `view.monde(ctx)` pour poser la transformation.

```js
view = {
  z, dpr, vw, vh, cam,            // caméra
  monde(ctx),                     // ctx.setTransform(dpr*z, 0, 0, dpr*z, dpr*(vw/2 - cam.x*z), dpr*(vh/2 - cam.y*z))
  toScreen(x, y) -> [sx, sy, 1],  // pour l'interface (le 3e terme reste pour compatibilité, toujours 1)
  visible(x, y, marge) -> bool,   // dans l'écran (en mètres de marge)
  time, dt, q,                    // temps (s), pas de l'image, profil de qualité (qualite.js)
}
```

## 3. Modules et propriétaires (un agent par ligne ; personne ne touche le fichier d'un autre)

| Module | Fichiers | Interface publique |
|---|---|---|
| Troupes | `web/js/battle/troupes2d.js` (nouveau), `tests/troupes2d.test.mjs` | `new Troupes2D(q, year)` ; `draw(ctx, view, units, colors, time)` ; `kill(u, n, bare, color, ball) -> decals[]` (même rôle que `Troops.kill`) ; `muzzles(u, time) -> [[x, y, a], …]` bouches à feu de l'unité (pour les éclairs et la fumée) ; `setQuality(q)` ; `dispose()` |
| Sol | `web/js/battle/sol2d.js` (nouveau), `web/js/battle/terrain.js`, `web/js/battle/textures.js`, `web/js/battle/pietinement.js`, `tests/sol2d.test.mjs` | `new Sol2D(terrain, q)` ; `draw(ctx, view)` ; `stamp(decals)` ; `invalidate(x, y, r)` ; `setQuality(q)` ; `dispose()`. `Pietinement` sans WebGL : `new Pietinement(W, H, q)`, `update(units, gap, wet, dt, rate)`, `exporter()` / `importer(url)` gardés (la boue est sauvegardée par le serveur), et `Sol2D` le compose dans ses tuiles |
| Décor | `web/js/battle/decor2d.js` (nouveau), `tests/decor2d.test.mjs` | `new Decor2D(terrain, map, q)` ; `sous(ctx, view)` ; `dessus(ctx, view, units)` ; `bati(etats)` (états des bâtiments reçus du serveur, § 5) ; `walls()` (enceinte refaite après une brèche) ; `update(dt)` (feu, fumée des cheminées, vie) ; `dispose()` |
| Effets | `web/js/battle/effets.js` (réécrit en 2D), `tests/effets.test.mjs` | `new Effects(q)` ; `push(f, unit, delay)` (mêmes `f.k` qu'aujourd'hui : salve, canon, mitraille, impact, explosion, charge, deroute, fumee…) ; `trail(x, y, dir, w)` ; `update(dt, wind)` ; `draw(ctx, view)` ; `atmosphere(ctx, view, sky, dt, time)` ; `ciel(sky, season)` (teinte de l'heure, sans WebGL) ; `decals` (cratères, trous) comme aujourd'hui ; `setQuality(q)` ; `dispose()`. Les éclairs partent des bouches données par `Troupes2D.muzzles` (passées dans `unit._muzzles` par la vue) |
| Moteur : dégâts | `game/tactics/battle.py`, `game/tactics/bridge.py`, `tests/test_degats.py` (nouveau) | § 5 |
| Moteur : villes et places | `game/tactics/terrain.py`, `tests/test_villes.py` (nouveau) | § 6 |
| Intégration | `web/js/battle/vue.js`, `camera.js`, `commandes.js`, `bataille.js`, `qualite.js`, `fanions.js`, `interface.js`, `ordres.js`, `unites.js`, `web/css/bataille.css`, tests existants des modules 3D, `README.md` | relie les modules, retire la 3D (§ 7) |

## 4. Rendu attendu (d'après la maquette)

- **Troupes** : une figure par homme tant que la qualité le permet (au-delà, une figure pour plusieurs), dans
  l'emprise de la formation (`formes.js`, `emprise`) : ligne sur deux ou trois rangs, colonne, carré à quatre faces,
  tirailleurs par deux. Coiffures et uniformes selon l'époque et le type (`unites.js` a déjà l'époque des coiffures),
  porte-drapeau, officier, tambour. Animations : marche, charge baïonnette, feu (joue, recul, rechargement à la
  baguette), mêlée, déroute, repos ; cavalerie au pas, au trot, au galop, sabre ; artillerie avec recul, refouloir,
  avant-train et chevaux (sauf sur un rempart) ; mitrailleuses ; général et état-major ; caisson. De loin (figures
  plus petites que 2 px), un bloc aux couleurs du camp à la forme de la formation. **Rapide** : sprites mis en cache
  par camp, type, pose et taille, posés par `drawImage` ; budget visé : 9 000 hommes à 60 images/s sur un iPad récent
  en Haute, 30 sur un iPhone de 2020 en Moyenne.
- **Sol** : palette et motifs de la maquette (chaume, blé, labour, pré, colza, friche, jachère, tournières, bottes),
  haies bocagères, chemins de terre, **routes royales empierrées** (ornières, fossés, bornes, ormes) et **rues pavées**
  en ville, rivières à ripisylve, ponts de pierre, colline lisible par un ombrage doux éclairé du nord-ouest (le
  relief du moteur sert seulement à cet ombrage). Saisons et neige gardées.
- **Décor** : bâtiments d'époque selon la région et le siècle (église romane, cathédrale gothique, église à dôme, ferme
  à cour, longère, mas, colombages, hôtel particulier, halle, moulins, caserne ; gare et immeubles haussmanniens
  seulement après leur date), îlots de maisons serrées le long des rues, murailles : mur médiéval à tours rondes ou
  **tracé bastionné** (bastions, courtines, demi-lunes, fossé, chemin couvert, glacis), portes, brèches. Bois : houppiers
  ronds et sapins, ajourés au-dessus des hommes. Toits crevés, feu, ruines selon `bati` (§ 5). Vie : bêtes au pré qui
  fuient les boulets, villageois qui fuient, cheminées qui fument, moulins qui tournent.
- **Effets** : fumée en taches pâles (comme la poussière du tracteur de Champs de Plaine), éclairs aux bouches, boulets
  en cloche avec leur ombre, ricochets, terre projetée, poussière des charges, fumée noire et braises des incendies.

## 5. Moteur : dégâts aux bâtiments et canons sur les murailles

- Chaque case bâtie (`T_BATI`) d'un même bâtiment a un état : `0` intact, `1` touché, `2` en feu, `3` en ruine.
  Un boulet (et une bombe) qui tombe dessus l'endommage ; le feu prend (plus vite sur le chaume), dure, gagne les
  cases bâties voisines, puis laisse une ruine. Effets de jeu : une maison en feu ne couvre plus et chasse ses
  occupants ; une ruine couvre moins qu'une maison ; tout reste déterministe à graine égale (tests).
- `/api/tactic` envoie `bati` : la liste des changements `[case, etat]` depuis `since` (comme les brèches), et
  `/api/tactic_map` l'état complet au chargement. Sauvegarde et rechargement gardent ces états.
- Siège ou assaut d'une place : l'artillerie du défenseur est **sur les remparts** (cases de mur, bastions) et tire de
  là ; elle ne sort pas des murs.

## 6. Moteur : villes et places plus réalistes

- `game/tactics/terrain.py` (`_town`, `_walls`, `_ilots`) : îlots de maisons serrées le long des rues avec cours au
  milieu, grand-place, église ; tailles selon le type de la ville (`village`, `ville`, `capitale`, `fort` dans
  `game/rules.py`) ; murs médiévaux pour les villes closes ; **tracé bastionné** pour les places fortes et capitales
  (bastions, demi-lunes, fossé) ; portes sur les routes. Le déplacement, les couverts et la ligne de vue gardent leurs
  règles ; les tests existants (`tests/test_bataille.py`, `tests/test_cartes.py`) restent verts.
- La carte envoyée au client dit ce qu'il faut pour dessiner : `town` (type, centre, rayon, siècle), `bastions`
  (sommets du tracé, s'il y en a), et pour chaque bâtiment un `kind` (`eglise`, `cathedrale`, `halle`, `ferme`,
  `maison`, `caserne`, `poudriere`, `moulin`…) que `Decor2D` dessine avec le bon modèle.

## 7. Ce qui disparaît

`relief.js`, `sols.js` (et `web/textures/sols/`), `herbe.js`, `apres.js`, `ciel.js`, `horizon.js`, `heures.js` (si plus
rien ne s'en sert), `epoque3d.js`, `troupes.js`, `gestes.js`, `decor.js`, `web/anims/` et `web/js/battle/dev/`
(sauf la maquette), avec leurs tests. `web/vendor/three/` reste : la carte de campagne s'en sert. Le réglage de qualité
garde ses quatre niveaux (densité de pixels, hommes par figure, fumée, détail du décor).

## 8. Fini quand

- Une bataille se charge, se déploie, se joue et se termine dans le navigateur, sans erreur dans la console, en vue de
  dessus ; une escarmouche et un siège de place forte ont été joués jusqu'au bout.
- `node --test tests/*.mjs` et `python3 tests/lancer.py` passent (échecs connus de `tests/resume.sh` exceptés).
- Le README dit ce qui a changé (section des batailles, tableau des tests).

## 9. Livré (25/10/2026)

Tout ce qui précède est livré : `vue.js` n'a plus de WebGL, un seul canevas porte les calques dans l'ordre du § 2,
la caméra est celle du § 1 (`camera.js`, banc `tests/camera.test.mjs`), les modules du § 3 sont branchés, le moteur
envoie `bati`, `rempart`, `town`, `bastions`, `demi_lunes`, `batis` et les tours, portes et fossés des enceintes, et
tout le § 7 est retiré (avec leurs bancs ; `heures.js` reste, réduit à la table que lit `effets.js`). Une escarmouche
et l'assaut d'une place bastionnée (Pau) ont été joués jusqu'au bout dans Chromium, sans erreur dans la console.

Écarts et décisions de l'intégration :
- **Ponts** : un seul dessin, celui du décor (`Decor2D`, `objetsFixes`) ; `terrain.paint` ne les peint plus. Les
  haies restent au sol.
- **Toits et modèles** : `buildings[]` porte déjà `kind` et `toit` ; `Decor2D` prend le toit du moteur (sinon celui de
  la contrée) et ne promeut plus une église en cathédrale quand la carte vient du nouveau moteur (`batis` présent : le
  moteur nomme sa cathédrale). `batis[]` lui-même n'est pas relu. Les tours, portes et fossés de `walls[i]` et les
  `demi_lunes` sont lus quand ils sont donnés (sinon les replis du module).
- **Fanions** : la hampe part du bord nord de l'emprise du régiment (au plus 40 px au-dessus de son centre) : il n'y
  a plus de « au-dessus des têtes ». `view.toScreenH(u)` le donne.
- **Gestes** : le clic droit ne pivote plus (il inspecte, comme le gauche) ; l'élan compte comme un geste pour la
  mesure des images par seconde.
- **Ligne de vue** : un voile case par case (20 m), adouci par l'agrandissement, posé après le décor du dessus et avant
  les effets.
- **Boue** : seulement pendant le combat ; un déplacement plus rapide que 15 m par seconde de bataille est un saut
  (redéploiement, ennemi revu ailleurs) : pas de glissade ni de traînée.
- **Qualité** : zoom le plus rapproché 12, 16, 24, 30 px/m ; sol au plus 8 px/m en Basse et Moyenne, 16 en Haute et
  Ultra ; plus d'anticrénelage, d'après-rendu, de sols photo, d'herbe ni de plafond de corps.
- **Sans WebGL** : `bataille.js` ne demande plus WebGL 2, la bataille s'ouvre partout.
- `fx.ciel(...).ombre` n'est pas passé aux troupes : leurs ombres gardent la lumière fixe du nord-ouest.

Reste à surveiller : les temps d'image n'ont été mesurés qu'en Chromium sans carte graphique (1280 × 800, densité 1 :
11 à 16 ms par image en combat de près, 13 à 22 ms en vue d'ensemble) ; à fort zoom, une tuile du sol neuve coûte un
à-coup (p90 jusqu'à 50 ms) ; quand des hommes sont sous les bois, les houppiers passent par une copie plein écran
(5 à 7 ms).
