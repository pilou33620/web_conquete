# Spec : la carte de campagne vue du ciel, vivante, avec l'intérieur des villes

## Pourquoi

Les batailles sont passées au rendu vu de dessus (SPEC-2D.md). La carte de campagne garde l'allure d'Ultimate General
(`map.js`, style « ugar ») et s'arrête au zoom 26 px/km. La maquette validée par le joueur
(`web/js/dev/carte-vivante.html`, sources dans `web/js/dev/carte/`) montre la même Aquitaine dans le style des
batailles :
- de loin, des pays aux bords sinueux ; de près, des parcelles, des bois, des vignes ;
- les villes avec leur vrai plan ;
- un bouton « Voir l'intérieur » pour chaque ville ;
- de la vie au plus près, qui suit les saisons, les heures, la météo et la guerre.

Cette spec la fait entrer dans le jeu, branchée sur l'état de la partie.

## Choix faits (25/10/2026)

- Le nouveau rendu **remplace** le style « ugar ». Le style « époque » (Cassini, puis état-major, `PAPIER`) reste un
  choix du joueur, inchangé.
- Le zoom va jusqu'à **320 px/km** (au lieu de 26). Les zooms (`carte/ambiance.js`, `Z`) :

  | Zoom | Ce qu'on voit |
  |---|---|
  | moins de 18 | le signe des villes |
  | à partir de 18 | le plan des villes |
  | à partir de 110 | la vie : gens, bêtes, colonnes (depuis « Livré — le zoom de la vie » : les colonnes à 110, la vie à 170) |
  | 320 | le plus près |

  Les figures se dessinent à `U` = 0,0045 km par unité, comme dans la maquette.
- La vie est **décorative**. Elle est tirée de la carte (même endroit, mêmes gens) et animée en temps réel. Elle ne
  montre que ce que l'état de la partie montre : brouillard de guerre respecté, pas d'armée cachée trahie par sa
  colonne ou ses traces.
- L'**heure du jour** (matin, midi, soir, nuit) est un réglage d'affichage (`AMB.heure`, `setHeure`, enregistré
  dans `localStorage`). Le jeu n'a pas d'heures.
- La **saison** vient de `state.season`, la **météo** de `state.weather[zone]` (zones `cote`, `interieur`,
  `montagne`, comme `engine.zone_of`).
- Les **événements locaux** des villes : le serveur envoie désormais `nodes[].lv = [genre, âge en jours]` pendant
  90 jours (`views.LEV_DAYS`). Les genres sont `incendie`, `epidemie`, `disette`, `brigands`, `foire`, `crue`,
  `refugies`, `filon`, `emeute`.
- La **famine** d'un camp : `state.me.famine`, connue pour le joueur seulement.
- Le **siège** d'une place : `nodes[].sg` (`dmg`, `by`, `food`), plus `bk` pour un blocus.
- Les **batailles** : `state.battles` (`x`, `y`, `phase`, `sides`).

## Ce qui est déjà en place (fondations communes, à ne pas réécrire)

- `web/js/carte/lib.js` : les primitives de la maquette telles quelles, en module, qui marchent aussi dans un worker
  (`toile()` crée un `OffscreenCanvas` hors du DOM). On y trouve :
  - formes et couleurs ;
  - `fantassin`, `cheval`, `cavalier`, `piece`, `avant`, `caisson`, `drapeau`, `tenue` ;
  - `bat` et les bâtiments, `remplirIlot`, `toitParcelle`, `bastions` ;
  - `fumee`, `sprite`, `SPR`, `parcelle`, `SOLS`, `arbre`, `sapin`, etc.
  - Ce qui manque dans `lib.js` se reprend de `web/js/dev/carte/new.js` et `vivante.js`, par exemple `figK`,
    `marcheur`, `charrette`, `diligence`, `mallePoste`, `vigne`, `parcelles`, `profilVille`, `genererInterieur`,
    `peindreInterieur`, `planCarte`.
- `web/js/carte/ambiance.js` : `Z`, `U`, l'objet `AMB` (saison, année, heure, météo par zone), `majAmbiance`,
  `zoneDe`, `meteoEn`, `bivouac()`, `nuit()`, et `LUM`, la liste des lumières de l'image.
  - `map.setState` appelle `majAmbiance`, puis repeint les terres et invalide les tuiles quand la saison ou la neige
    au sol change.
  - `map.draw` vide `LUM` au début de chaque image.
- Serveur : `nodes[].lv`, testé dans `tests/test_campagne.py`.

## Les quatre chantiers (un agent chacun, travail en parallèle)

Chaque chantier ne modifie **que ses fichiers**. Dans `map.js`, chacun touche **seulement les fonctions listées**.
Commiter et pousser sur `rendu-2d`. Si la poussée est refusée : `git pull --no-rebase`, régler, recommencer. Jamais
de `--force`.

### A. Terre — les tuiles (`map.js` : `renderTile`, `decorate`, `vineyards`, `paintLand`, `level`, `LEVELS`, les bornes du zoom dans `bindInput`, `zoomBy` et `zoomAt` ; `peintre.js` ; nouveau `carte/terre.js`)

Le travail :
- Reprendre la peinture de la maquette :
  - `couleurEn` : pays aux bords sinueux par `terOnde`, sable au bord de l'eau, ombrage du relief ;
  - `peindreFond` ;
  - `peindreTuile` :
    - échantillons sur une grille absolue avec une marge, donc houppiers sans couture ;
    - parcelles en briques masquées par les champs, vignes, bois en houppiers groupés par couleur ;
    - marais salants ;
    - fermes isolées.
- Les saisons et la neige de `vivante.js` : `saisonner`, `neige` (limite qui suit le relief), `solSaison`, `gerbes`,
  `boisSaison`, feuillus nus en hiver.
- Ajouter les niveaux 128 et 256 px/km et porter le zoom maximal à `Z.MAX`.

Ce qui doit rester :
- la peinture dans les workers (`peintre.js`) ;
- les territoires peints dans les tuiles (`fillCanvas`, frontières), les limites des départements, le voile hors du
  jeu ;
- ce que l'époque peint (`epoque.js`) ;
- le style « époque » (`PAPIER`), inchangé ;
- les ponts, les bacs, les voies navigables.

Restyler aussi :
- les rivières (eau bleue, berges vertes) ;
- les routes empierrées comme la maquette (pas de goudron), avec les routes royales bordées d'arbres de près.

Le budget : une tuile neuve au moins par image, d'autres tant qu'il reste du temps. Mesurer chaque niveau ; viser
moins de 150 ms par tuile dans un worker.

### B. Villes — plans et intérieurs (`towns.js` ; `ui.js` : `nodePanel` et l'ouverture de l'intérieur ; `web/css` ; nouveaux `carte/villes.js`, `carte/interieur.js`)

Le travail :
- Porter `profilVille`, `genererInterieur`, `peindreInterieur` et `planCarte` de la maquette. Les données sont
  celles du jeu : `map.m`, mêmes champs que la maquette.
- Sur la carte, à partir de `Z.PLAN`, dessiner chaque place par son vrai plan (un cache par place et par année) ;
  en dessous, le signe actuel.
- Dans le panneau d'une place, un bouton « Voir l'intérieur » ouvre une vue plein écran avec gestes et retour : le
  plan détaillé, sa vie (passants, charrettes, bateaux, bêtes, fumées), des visites (place, église, port, remparts…).

Ce que l'état de la partie change :

| État | Effet |
|---|---|
| `year` | murs médiévaux, bastions, cours plantés et gare selon l'époque |
| `f` | enceinte |
| `pop` | taille |
| `d` | faubourgs |
| `o` | drapeau |
| `sg.dmg` | ruines, toits crevés, incendies |
| `lv` | incendie : maisons brûlées ; foire : étals et foule ; émeute : attroupement à l'hôtel de ville ; épidémie : rues vides, convoi ; crue : quais sous l'eau ; disette : marché vide |
| `me.famine` | moins de monde dans les places du joueur |

À garder : les clics, les étiquettes, les remparts et la brèche de `map.js` (`walls`, `works`), qui restent
lisibles par-dessus le plan.

### C. Vie — la vie des pays (`ambient.js`, réécrit ; nouveau `carte/vie.js`)

Remplacer la petite vie actuelle par celle de la maquette, aux mêmes zooms :
- voyageurs : diligences, malle-poste, charrettes, cavaliers, troupeaux, piétons ;
- bêtes selon le terrain : vaches, moutons, cerfs, sangliers, hérons, berger landais sur échasses ;
- travaux de la saison : moissons, vendanges, labours, résiniers, bûcherons et charbonnières, estives,
  transhumance au printemps et à l'automne, paludiers l'été ;
- loups l'hiver ;
- bateaux, trains de bois flotté, pêcheurs du bassin d'Arcachon et de Saint-Jean-de-Luz, parcs à huîtres, cabanes
  tchanquées, carrelets de la Gironde ;
- relais de poste ;
- marchés et foires : `lv` `foire`, plus la chaîne `marche` des villes du joueur ;
- contrebandiers et douaniers ;
- oiseaux : grues, palombes, mouettes, étourneaux ;
- fumées des cheminées ;
- moulins vus de dessus (`moulinVu`, ailes de profil, ombre qui tourne) ;
- ombres des nuages ;
- le phare de Cordouan.

À garder :
- `drawTrains` (les trains de `rails`) ;
- l'interrupteur des animations (`setOn`, `conquete.anim`, mouvement réduit).

La densité suit l'état de la partie :
- moins de monde la nuit ;
- personne autour d'un siège ou d'une bataille ;
- moins de monde dans les places en famine, en épidémie ou en disette ;
- des brigands sur les routes près d'une place à `lv` `brigands`.

Les lumières (lanternes, fenêtres des relais, bateaux) vont dans `LUM`.

### D. Guerre et ciel (`map.js` : `drawArmies`, `drawToken`, `drawFormation`, `drawBattles`, `drawWeather`, `drawSeasonTint`, et le dessin du siège dans `drawNodes` : `works`, `tents`, `blockadeRing` ; nouveaux `carte/guerre.js`, `carte/ciel.js`)

Les armées et la guerre :
- **Colonnes.** À partir de `Z.VIE`, chaque armée visible marche en colonne de route sur sa route (`disp`, cap,
  arête), composée d'après ses régiments (`regs` : ligne, légère, cavalerie, artillerie) et son effectif. Les
  tenues suivent le camp. Le jeton et la formation restent en dessous de `Z.VIE` et pour les clics.
- **Bivouac.** Le soir et la nuit, ou à l'arrêt, l'armée monte un bivouac : tentes, feux, faisceaux, chevaux,
  canons parqués.
- **Traces.** Derrière une armée en marche : route défoncée, champs piétinés. L'historique des positions est gardé
  côté navigateur. Les villages d'un camp en guerre avec elle et proches de sa trace montrent la fumée du pillage
  quelques jours.
- **Réfugiés.** Devant une armée ennemie du joueur, des réfugiés fuient sur les routes.
- **Sièges.** D'après `sg` : parallèles et boyaux, batteries qui tirent (fréquence selon `dmg`), camp des
  assiégeants, incendies dans la place, campagne vide. Un anneau de blocus pour `bk`.
- **Batailles.** De loin, un nuage de fumée qui monte et dérive ; de près, les lignes, les salves, les batteries, les
  charges et les tombés, d'après `phase` et `sides`.

Le ciel (`ciel.js`) :
- la météo par zone : pluie et orage en averses (éclairs pour l'orage), brouillard en brume, neige qui tombe,
  tempête, canicule ;
- la brume du matin sur les fleuves ;
- l'heure : voile du matin, du soir, de la nuit, puis les lumières de `LUM` en mode `lighter`, les villes allumées
  la nuit, le faisceau de Cordouan ;
- un petit sélecteur d'heure sur la carte (créé par `ciel.js`, sans toucher `ui.js`).

## Tests et preuves

- `node --test tests/*.mjs` et `python3 tests/lancer.py` passent.
- Un test par module pour la logique non triviale : déterminisme des tirages, densités, composition d'une colonne
  d'après ses régiments, choix du plan d'une ville.
- Captures du vrai jeu (le serveur `server.py`, une partie lancée) avant et après, à plusieurs zooms et états :
  saisons, nuit, siège, bataille, ville en foire. Les ranger dans le dossier de travail
  `integration/carte-<chantier>/` et les citer dans le rapport.
- Temps d'image mesurés à 1280 × 800, densités 1 et 2 : vue d'ensemble, zoom 26, zoom 110, zoom 320. Rien ne doit
  être plus lent qu'avant à la vue d'ensemble et au zoom 26.
- Pas d'erreur dans la console. Le brouillard de guerre est respecté.

## Livré — B

- `carte/villes.js` : `profilVille`, `genererInterieur`, `peindreInterieur` (et `peindreInterieurPas`, par pas),
  `planCarte` (et `planCartePas`), `degats`, `lecture`, portés de la maquette, avec `carteDe(map.m)` pour les données.
  `etatVille(n, ns, st)` lit l'état : `f` choisit l'enceinte (1-2 murs et tours, 3-4 bastions ; après 1860 des cours
  si la ville n'a pas de bastions), `pop` la taille (par paliers de 8 unités), `d` des faubourgs plus longs et plus
  serrés, `sg.dmg` ruines et toits crevés, `lv` incendie (un quartier brûlé), crue (quais sous l'eau). Le **modèle** de
  plan suit `pop0` et `fort` du jeu : il ne change pas en cours de partie.
- Carte (`towns.js`) : à partir de `Z.PLAN`, hors style « époque », le plan à l'échelle ; à plat jusqu'à 0,5 pixel
  par unité, maison par maison au-delà (dès z 72 sur un écran Retina), peint au plus 6 ms par image et par pas.
  Par-dessus, `map.walls` et `map.works` (appelés, pas changés), agrandis au rayon du mur du plan (`V.rMur`) : niveau
  et brèche restent lisibles ; l'enceinte propre du plan n'est donc peinte que dans l'intérieur. Caches bornés :
  300 plans, 14 Mpx d'images.
- Intérieur (`carte/interieur.js`, bouton « Voir l'intérieur » du panneau) : plein écran, gestes, retour (et Échap),
  visites, « Ce que le générateur a lu » avec l'état ; s'ouvre tout de suite et se peint en 0,3 à 1,5 s par pas de
  12 ms. Vie : passants (moins la nuit, en famine, en siège, presque personne en épidémie), charrettes, bateaux,
  bêtes, fumées, moulins ; foire (étals, foule), émeute (attroupement au nord de la place), épidémie (convoi funèbre),
  disette (place vide), incendie et siège (flammes, fumée noire). Drapeau du maître par `map.flag`.
- Écart : dans `polaire`, les sommets des îlots sont pris dans l'autre sens. Dans la maquette, `decalerQuad`
  **gonflait** les îlots des plans ronds au lieu de les rentrer : sur la carte, la vieille ville devenait un disque
  beige ; dans l'intérieur, les îlots se chevauchaient. Les plans ronds ont maintenant des rues et des cours.
- Pour les autres : `planCarte(...).lum` (fenêtres en km, pour la nuit de `ciel.js`), `V.lieux.place` (marchés de
  `vie.js`), `V.rMur` (rayon des remparts, pour le siège de `guerre.js`). Dans `drawNodes`, l'anneau de siège et le tri
  des places hors écran (`x < -s - 80`) suivent encore la taille du signe : de près, l'anneau tombe dans la ville et
  un grand plan disparaît trop tôt au bord de l'écran. `moulinVu` est recopié dans `interieur.js`.

## Livré — C

- `carte/vie.js` : la vie de la maquette, tirée de la carte (même route, mêmes passants ; même kilomètre, mêmes
  bêtes et mêmes travaux), animée sur l'horloge de `ambient.js`. Deux passes : `dessinerSol` (sous les villes :
  Cordouan, bateaux, pêche, relais, contrebande, moulins vus de dessus, et au plus près les routes, bêtes, travaux,
  transhumance, brigands) et `dessinerDessus` (après les villes : marchés sur la grand-place de `planDe(...).lieux.place`,
  foire hors les murs, fumées des cheminées, ombres des nuages par beau temps de jour, oiseaux).
- Zooms : vie au plus près à `Z.VIE` ; marchés 40 ; foires, relais, sentiers 30 ; pêche, radeaux 18 ; fumées 14 ;
  oiseaux 4 ; Cordouan 2,5. **Écart** : les bateaux (gabares, navires, vapeurs de `epoque.vapeur`) dès z 10 au lieu
  de 18, à taille constante à l'écran, pour que l'eau ne soit pas morte entre 10 et 18.
- **Écart** : de loin (moins d'un pixel par unité, z < 222 à densité 1, z < 111 à densité 2), les figures sont
  dessinées en deux ou trois taches et les bêtes par couleur d'un seul tracé. Sans cela la vie coûtait 8,6 ms à
  Bordeaux z 110 l'été.
- Densité (`densite(x, y)`, de 0 à 1, la plus basse règle l'emporte) : nuit 0,15, soir 0,6 ; météo (pluie 0,6,
  orage 0,35, tempête 0,25, neige 0,5, brouillard 0,8, canicule 0,7) ; siège (`sg`) 0,06 jusqu'à 4 km du bord de la
  place ; bataille (`battles`) 0,1 dans 5 km ; famine (`me.famine`) 0,45 dans les places du joueur ; `lv` épidémie
  0,25 (convois funèbres), disette 0,3 (mendiants, pas de moisson ni de vendange). Grille par kilomètre recalculée
  quand l'état qui compte change (`majEtat`). Brigands : une bande tous les 4 km sur les routes d'une place à `lv`
  brigands, parfois une diligence arrêtée. Marchés : places à `sl` `marche` ≥ 1, ni assiégées ni en disette ou
  épidémie. Routes à moins de 12 km d'une foire : 1,6 fois plus de passants. La tempête garde navires et pêcheurs au port.
- Pour D : `ajouterDensite(fn)` ajoute une règle (`fn(x, y)` → 0 à 1), par exemple devant une armée ennemie ;
  `VIE.cordouan` donne la place du phare (le faisceau est à `ciel.js`) ; les lanternes (relais, diligences, bateaux,
  pêcheurs, yeux des loups) vont dans `LUM` avec `spr: 'fen'` (sprite créé par `vie.js` s'il manque).
- `ambient.js` garde l'interface (`under`, `over`, `drawTrains`, `setOn`, `conquete.anim`), les trains, l'écume et
  les reflets de la mer ; le courant des fleuves s'arrête à z 18 (la rivière des tuiles suffit). Supprimés : les
  dessins de profil (moulins, troupeaux, voyageurs, voiliers, phare, mouettes, vols) et la fumée des sièges (D).
  Animations coupées ou mouvement réduit : la vie reste dessinée, immobile, sans fumées.
- Temps de la vie par image (`under` + `over`, Chromium sans carte graphique, machine chargée), avant → après,
  densité 1 / 2 : vue d'ensemble 0,16 → 0,18 / 0,71 → 0,10 ms ; z 26 Bordeaux 1,56 → 0,54 / 2,07 → 0,70, Landes
  0,82 → 0,45 / 1,47 → 0,37, Pyrénées 1,06 → 0,76 / 1,33 → 0,86 ; z 110 Bordeaux 2,97 / 5,84, Landes 0,89 / 1,42,
  Pyrénées 2,56 / 3,78 ; z 320 Bordeaux 1,70 / 1,53, Landes 0,83 / 0,69, Pyrénées 1,85 / 1,89.

## Livré — A

- `carte/terre.js` : la peinture de la maquette sur les données du jeu (`terre(map)`, une fois par carte et par
  worker). `grille` (pays par `terOnde`, sable, saisons, neige, ombrage), `fond` (le fond de la carte, `paintLand`),
  `moyen` (6 à 12 px/km), `detail` (16 px/km et plus : houppiers sans couture, parcelles dès 24, marais salants,
  vagues), `arbresRoyaux` (routes royales dès 32). Exports pour les autres : `TT`, `hash2` (= `map.js hash`),
  `bruitC`, `solSaison`, `neigeAu`, `SEUIL_NEIGE`, `BOIS_S`, `boisSaison`, `parcelles`, `EAU`, `SABLE`,
  `LARG_RIVIERE` (largeur de l'eau par rang : 0,32 / 0,16 / 0,09 / 0,06 km, plus fine que l'ancienne carte) ;
  `terre(map).neige(x, y)`, `.terOnde(x, y)`, `.pinede(x, y)`, `.alt(x, y)` pour placer la vie là où la terre le dit.
- `map.js` : niveaux 2 à 256 px/km (96 et 192 en plus de 128 et 256, pour garder une échelle fine) ; zoom jusqu'à
  `Z.MAX`, aussi dans `moveTo` et `clampCam` (hors liste, sans quoi le zoom restait bloqué à 26). `syncPainters`
  envoie `AMB` aux peintres. Le style « époque » est le même au pixel près jusqu'à 64 px/km (vérifié tuile à tuile) ;
  au-delà, c'est la même gravure agrandie. `decorate` et `vineyards` ne servent plus qu'à lui.
- Écarts à la maquette :
  - densités des bois par km², les mêmes à tous les niveaux (dans la maquette, la lande devenait forêt dès 128 px/km
    et la forêt s'éclaircissait à 256) ; tirages par parcelle et vagues sur la grille d'un km (pas de couture) ;
  - l'ombre des arbres de bord de route était posée à 1,6 km (rangs de points sombres dans les champs) : corrigée ;
  - la neige couvre les parcelles d'une limite douce qui suit le relief (au lieu de parcelles blanches une à une),
    vignes comprises ; la neige qui tombe suit `AMB.meteo` par zone, aux limites de zone ondulées ;
  - limite de la pinède et, dès 64 px/km, lisières ondulées d'une onde fine de plus (plus de lignes droites de près) ;
  - de 6 à 12 px/km, une grille par tuile (un point tous les 2 px) ; le fond de la carte à 2 px/km (coût) ;
  - menus détails en carrés sous 1,5 px, ceps en pointillés ronds ; rivières et limites tracées par morceaux ;
  - au-delà du zoom 30, frontières de largeur constante à l'écran ;
  - pas de disette dans les tuiles (la maquette la simulait en Périgord).
- `lib.js` : `toile()` rend null sous Node (les tests importent `map.js`, qui importe maintenant `lib.js`).
- Pour C : `ambient.drawFlows` garde les largeurs de l'ancienne carte (0,75 × 0,3 km) ; les rivières sont plus fines
  (`LARG_RIVIERE`).

## Livré — E (batailles sur le plan des villes)

- `game/tactics/plan_ville.py` : `profilVille` et `genererInterieur` de `carte/villes.js` portés en Python (géométrie
  seulement : îlots, rôles, rues, enceinte, citadelle, gare ; pas les métiers ni la peinture, qui ne changent pas les
  îlots), avec l'état qui les change (année avant ou après 1860, `f`, `pop`, `d`). `game/tactics/jsmath.py` refait
  l'arithmétique de V8 : `alea` (mulberry32), `hash2`, `hashS` (FNV-1a), entiers sur 32 bits, `Math.hypot` (Kahan),
  `Math.round`, et `Math.sin`, `Math.cos`, `Math.atan2` de fdlibm (ceux de la libm du système diffèrent au dernier bit
  une fois sur 20 à 6 ; avec eux, Domme changeait de grand-place). Comparaison avec Node (`tests/test_plan_ville.py`,
  `tests/plan_ville_js.mjs`) : 223 places × 4 états (1789, 1870, f = 3, pop × 3 et d = 2), **0 plan différent**.
- Carte de bataille, version 4 (`terrain_ville.py`) : une bataille à une place, ou une bataille rangée à moins de
  1,3 km d'un lieu, se livre dans son plan, à l'échelle (1 unité = 1000 / 180 m) et dans le bon sens :
  - enceinte du plan en `MUR` (cercle ou rectangle médiéval à tours tous les 200 m, tracé bastionné et demi-lunes dans
    `bastions`/`demi_lunes`, citadelle avec son tracé dans son `walls[]`), portes là où passent les routes ; les
    routes du plan arrivent par la rue maîtresse, la porte au milieu de la courtine et la demi-lune, puis suivent
    l'axe des faubourgs jusqu'à l'autre lieu. Brèches, glacis, canons du rempart, chaussée d'une place dans l'eau :
    comme avant (`_enceinte`, `_causeway`).
  - îlots : maisons (`BATI`) sur une case le long des rues, cours et jardins (`PRE`) au milieu ; faubourgs sur leur
    côté de la route ; édifices (église, cathédrale, couvent, hôpital, hôtel, caserne, halle, château, gare,
    poudrière d'un fort) sur l'emprise de leur modèle ; rues (bandes entre les îlots et axes) en `ROUTE`, `CHEMIN` au
    village ; grand-place, parvis, quais, ponts des rues maîtresses, cours plantés après 1860.
  - mer et étangs autour de la ville d'après la campagne (`eauK`, sans le tremblé), rivières du plan sans méandres
    près de la ville ; une rivière que le plan ne voit pas (points trop espacés dans les données) est écartée hors
    de la ville.
  - client : `to_client` envoie `plan` (îlots en mètres avec rôle, zone, graine de parcelles, côtés sur rue ; rues ;
    édifices avec modèle, position, angle, échelle ; place ; état). `decor2d.js` (`preparerPlan`) dessine le sol de
    la ville, chaque îlot comme `remplirIlot` (une maison par parcelle, `toitParcelle`, toits du pays) et les
    édifices ; chaque parcelle va au bâtiment (groupe de cases bâties) de la case sous elle : touché, en feu, en
    ruine se voient bâtiment par bâtiment.
  - Une carte de version 3 garde la ville de `_town` (sauvegardes).
- Métiers et quais (suite) : le portage tire aussi les métiers de `genererInterieur` (`plus` : châteaux viticoles,
  scieries, forges, salines, séchoirs, moulins, fermes, airiaux landais), avec le même tirage ; comparaison avec Node :
  892 états, 7 288 métiers, **0 différence**. Sur la carte (`terrain_ville._metiers`), chacun à sa place du plan
  (à l'échelle de la carte) et à sa vraie taille : bâtiment en `BATI` (natures `chateau`, `forge`, `scierie`,
  `sechoir`, `moulin`, `ferme`), les quatre vignes du château en `VIGNE`, les douze bassins des salines en `MARAIS` ;
  un moulin à moins de 60 m d'une rivière devient moulin à roue (l'intérieur n'a que des moulins à vent). Rien sur le
  glacis (140 m), entre les bastions, à moins de 80 m d'une porte, ni dans les 250 premiers mètres de la bande de
  l'assaillant (son bord choisi comme `battle._zones`) ; une route ou une maison à sa place le décale de 50 m au
  plus. Hors du champ (beaucoup de métiers sont à 1,5–2,5 km), rien. Quais d'un port : la ligne de quai de
  l'intérieur le long de la première rivière, des deux côtés jusqu'à 1,15 R, en `ROUTE` sur la rive (pas où l'eau
  de la bataille la noie) ; bateaux amarrés le long des quais et, au bord de la mer, au mouillage. Le client
  (`decor2d.js`) dessine les modèles de la maquette (château, ferme, mas, moulin et ses ailes, moulin à roue) et ceux
  de `peindreInterieur` (scierie et grumes, forge et scories, séchoir, airial sous les chênes, salines, quais,
  `navire`). Les bancs : `test_les_metiers_et_les_quais` (Saint-Émilion, Sabres, Salies-de-Béarn, Bordeaux, glacis).
  Temps : la pose de la ville avec ses métiers 12 à 46 ms (Bayonne 44, Bordeaux 46, Saint-Émilion 12).
- Écarts :
  - **échelle réduite pour les grandes places** : à l'échelle de l'intérieur, Bayonne bastionnée fait 5 km de large et
    Navarrenx 2,5 km, plus que le champ (3 × 2 km). Toute la carte (ville et campagne, pour que rivières et côtes
    restent en place) est alors réduite (`plan.echelle`) : l'enceinte tient à 400 m du bord de l'assaillant (de tous
    les bords près de l'eau, où il peut venir d'ailleurs) et dans le champ, à 600 m de rayon près d'une bataille
    rangée. Bayonne : 0,35 ; Navarrenx : 0,66 ; Bordeaux (mur médiéval) : 0,57 ; un village : 1.
  - les maisons sont à leur vraie taille (6 à 15 m de façade, 16 m de profondeur), pas à celle des parcelles de
    l'intérieur (25 à 45 m) : même îlots, mêmes rues, mais plus de maisons par côté. Dans les plus petits îlots d'une
    ville réduite, la grille de 20 m n'a parfois pas de case bâtie : l'îlot reste sans maison.
  - `battle._zones` : sur une carte de version 4, la bande de l'assaillant reste à 150 m de l'enceinte (200 m de
    profondeur au moins) au lieu de 500 m quoi qu'il arrive ; `ai.py` : les défenseurs des murs gagnent les maisons
    jusqu'à 0,75 × le rayon de la place (et non 300 m) ; pas de moulin sur le glacis d'une carte de version 4.
  - `bridge.make_spec` envoie `place.d` et, pour une bataille rangée, `lieu` (l'état du lieu tout proche).
  - bancs mis à jour (le générateur d'avant y était supposé) : `test_villes` ne demande plus un rayon croissant du
    village à la capitale (les plans réduits ne le promettent pas : on compare les îlots), ni poudrière ni cathédrale
    à une capitale bastionnée (Périgueux perd la sienne sous sa citadelle, comme dans l'intérieur).
- Temps (PC de développement ; un Raspberry Pi est quatre à cinq fois plus lent) : plan et pose de la ville 25 à
  65 ms (Bayonne 52, Bordeaux 61, Périgueux 59, un village 25), carte entière 0,22 à 0,33 s (version 3 : 0,20 à
  0,28 s).

## Livré — D

- `carte/guerre.js` : `compoColonne(regs, cls, leger, gen)` (de la tête à la queue : avant-garde de cavalerie, à
  défaut les voltigeurs ; état-major ; un bataillon par régiment d'infanterie, une figure pour trois hommes, par rangs
  de quatre, officier, tambours, drapeau ; trois pièces attelées pour 120 artilleurs ; un caisson par pièce ; un
  chariot par 1 500 hommes ; arrière-garde), `geoSiege` (côté de la terre, parallèles, boyaux, cinq batteries, camp,
  foyers), `Guerre` (`sol` sous les villes, `siege` dans `drawNodes`, `armees` dans `drawArmies`, `dessus` dans
  `drawBattles`), `densiteGuerre` enregistrée dans `vie.js` par `ajouterDensite` (moins de monde devant l'ennemi).
- `carte/ciel.js` : `Ciel` (`drawWeather`) : voiles par zone, averses (éclairs pour l'orage, pluie couchée pour la
  tempête), brouillard en nappes dans les fonds (`terre(map).alt`), neige, canicule ; brume du matin ; voile de
  l'heure en `multiply` ; `LUM` en `lighter`, fenêtres des villes (`planCarte().lum`), phare de Cordouan ;
  sélecteur d'heure (quatre boutons `aria-pressed`, rangés à gauche du premier bouton de `#zoombar` : le bas reste aux
  avis de `#feed`, rangés à gauche de la colonne du zoom, trois au plus, trois lignes chacun, au-dessus de la date ; un
  avis ne rétrécit pas, les plus anciens sont coupés par le haut ; sous 660 px de haut, le zoom passe en haut, à gauche de
  la barre de côté ; captures 1280×720, 1366×768, 844×390, 768×1024).
- Écarts :
  - `drawSeasonTint` n'a plus la teinte de saison (les tuiles de A portent les saisons) ; c'est là, seule de mes
    fonctions appelée sous les villes, que se dessinent les traces, les tranchées et la terre piétinée.
  - Le voile de l'heure couvre aussi les noms et les chiffres (dessinés avant, dans `drawNodes`) : de loin, il
    s'allège (45 % à la vue d'ensemble) pour qu'ils restent lisibles. La nuit, les fumées des batailles cessent.
  - Pas de vent dans l'état : un vent d'ouest fixe (`VENT`).
  - La route parcourue est gardée par arêtes (tour par tour : `trl`) ; un saut (armée hors de vue, tour d'un autre
    camp) l'efface, une armée sortie de l'état perd ses traces. Les villages pillés (ville sans remparts ou village
    d'un camp en guerre avec l'armée, à moins de 3 km de sa trace) fument 4 jours de partie, et seulement dans les
    cercles de vision.
  - Une armée dans une place bivouaque au sud des murs du plan ; le clic reste où était le jeton. Une armée qui
    assiège ou qui se bat n'a pas de colonne : le siège et la bataille la montrent.
  - Siège : rayon des remparts = `V.rMur` × la forme de l'enceinte de `walls` (1,42 bastions, 1,62 demi-lunes) ;
    l'anneau, les tentes des quartiers et le blocus en tiennent compte dès `Z.PLAN`. Blocus d'un port (`bk`) : un
    anneau bleu de mer. Batteries et incendies à partir du zoom 6.
  - Bataille : axe d'après les armées des deux camps, troupes d'après `mix`, lignes plus serrées de `canonnade` à
    `charge`, tombés d'après `lost`. Au-delà de `Z.VIE`, les fumées et étincelles des particules laissent la place
    aux salves ; les chiffres des pertes restent.
  - Les rangs, cavaliers, tambours, bataillons et escadrons sont peints une fois par tenue, pose (huit phases du pas)
    et échelle (paliers de 2^¼), puis posés d'un `drawImage` : la colonne au zoom 110 passe de 15 à 5 ms.
  - Style « époque » : seulement les voiles, les averses et la neige ; ni guerre au sol, ni heure, ni lumières.
  - `this.wx` et `this.flash` (constructeur, `setState`) ne servent plus.
- Mesures (1280 × 800, Chromium sans carte graphique, ms de dessin par image ; météo brouillard / pluie / neige) :
  calques de D (`drawWeather` + `drawSeasonTint` + `drawBattles`) 0,54 ms à la vue d'ensemble et 0,66 au zoom 26,
  contre 0,35 et 0,23 avant ; image entière 5,0 / 4,6 ms (densité 1) et 5,2 / 5,5 (densité 2) contre 4,7 / 5,3 et
  5,4 / 5,3 avant, dans le bruit. Avec une bataille, un siège et trois colonnes : zoom 110, colonne 4,8 ms (5,8 en
  densité 2), bataille 2,7 (3,6), siège 3,0 (3,3) ; zoom 320, colonne 2,9 (3,1), bataille 2,0 (2,4), batterie 2,2.

## Livré — G (blessés, ravitaillement, réquisitions, conscription, fêtes, trains)

- Serveur (décor seulement, aucune règle changée) : `Game.sites`, les batailles rangées des 120 derniers jours
  (`engine.SITE_DAYS` ; `x`, `y`, `t`, pertes `l` et camps `o` des deux côtés), écrit par `end_battle`, sauvegardé
  (anciennes sauvegardes : vide) ; `factions[code].lb = [gagnée 0/1, date]`, la dernière bataille du camp, sauvegardée
  avec la faction. Vue (`views.player_state`) : `sites = [[x, y, âge, pertes 0, pertes 1, camp 0, camp 1]]` pour les
  batailles du joueur ou à portée de vue ; `factions[].lb = [gagnée, âge]` pendant 30 jours (`LB_DAYS`). Banc :
  `test_campagne.ChampsDeBataille`.
- `carte/guerre.js` (`JOURS`, `routeEntre`, `ravitaillement`, `tombes`, `fermesAutour`, `Guerre.arriere` relevé une
  fois par état) :
  - **blessés** : 30 jours, charrettes de blessés couchés sur la paille et ambulances bâchées (croix rouge après
    1864) du champ de bataille à la ville la plus proche de chaque camp, par les routes, d'autant plus nombreuses que
    les pertes sont lourdes, seulement dans les cercles de vision ; **terre piétinée** 60 jours (dès z 18) ;
    **tombes** (tertres et croix de bois, une pour 40 morts, de 3 à 60) 120 jours, l'herbe repousse et elles
    s'effacent (dès `Z.VIE`) ;
  - **ravitaillement** (armées du joueur hors des places) : d'après `dp`, sinon la place amie la plus proche sur ses
    terres ou celles d'un allié (comme `engine.attrition`) ; fourgons pleins vers la queue de la colonne, vides au
    retour, par les routes (60 km au plus). Coupée (pays ennemi ou neutre, sans magasin) : pas de convoi, colonne
    maigre (un rang sur trois manque), sans bagages, et un triangle d'alerte rouge près d'elle de z 5,5 à 200 ;
  - **réquisitions** : toute armée visible sur les terres d'un camp avec qui elle est en guerre envoie des
    fourrageurs aux trois fermes les plus proches (grille du kilomètre, pays découvert, à moins de 1,8 km) ; au
    retour, vaches ou moutons poussés devant, une charrette de foin ; meules entamées ;
  - **conscription** : une place du joueur dont la file (`q`) lève un régiment reçoit des recrues par chacune de ses
    routes (quatre conscrits et leur baluchon derrière un sergent) ; sur la grand-place (`planDe(...).lieux.place`),
    l'exercice : trois rangs, le sergent, deux tambours, demi-tour toutes les huit secondes ;
  - **fêtes et deuil** : 10 jours après une victoire, dans les places du vainqueur (celles du joueur, et des autres
    à portée de vue), le Te Deum (cloches à toute volée, arcs dorés autour de l'église, dès z 6), le feu de joie
    devant l'église (dans `LUM`, allumé la nuit), la foule, des guirlandes de fanions (dès z 40 et `Z.VIE`) ; 30 jours
    après une défaite, le glas (arcs sombres) et les drapeaux en berne avec un crêpe noir (`map.flag(…, 'deuil')`,
    demandé par `towns.js` à `Guerre.fete`).
- `ambient.drawTrains` : vu du ciel, les trains de dessus (`locoDessus`, `tenderDessus`, `voitureDessus` : chaudière,
  dôme, cheminée, cabine, charbon ; voitures de voyageurs ou wagons de charbon, de grumes, bâchés), le panache en
  bouffées laissées où était la cheminée, qui grossissent et dérivent sous le vent ; de profil sur la carte d'époque.
- Écarts : le feu de joie est sur le parvis, la grand-place étant à l'exercice des recrues ; les fermes des
  fourrageurs sont tirées sur la grille du kilomètre, pas celles des tuiles. En tour par tour, une bataille du tour
  des IA peut avoir plus de 10 jours au tour suivant : sa fête ne se voit alors pas (le deuil, si).
- Mesures (1280 × 800, Chromium sans carte graphique, scène montée à la main, médiane de 120 images, avant → après) :
  vue d'ensemble 4,0 / 3,9 → 4,3 / 3,8 ms (calques nouveaux 0,03 ms) ; z 26 Bordeaux 2,8 / 2,8 → 3,1 / 2,7 (0,05 à
  0,1 ms) ; z 110 champ de bataille, convoi et colonne 3,7–4,1 → 4,8–5,3 (+1,1) ; z 110 Bordeaux (recrues, fête,
  tombes) 3,3 → 4,1–4,5 (+0,8 à 1,2) ; z 110 armée coupée 3,2–3,3 → 3,1–3,6 ; z 320 Bordeaux 2,0 → 2,5, champ 2,0 → 2,2–2,4.

## Livré — H (estafettes, prisonniers, traînards, chantiers, produits, gaz, crues, cordons, feux des Landes, grands travaux, sièges)

- Serveur (décor seulement, aucune règle changée, sauf la règle de la crue plus bas) : un champ de bataille garde son vainqueur et ses prisonniers
  (`Game.sites[].w`, `.p` ; vue `sites = [x, y, âge, pertes 0, pertes 1, camp 0, camp 1, vainqueur, prisonniers]`,
  vainqueur `None` pour une ancienne sauvegarde) ; la dernière bataille d'un camp garde son lieu
  (`factions[].lb = [gagnée, date, x, y]`, vue `[gagnée, âge, x, y]`, le lieu seulement pour les camps du joueur et ses
  alliés ou à portée de vue) ; `LB_DAYS` passe de 30 à 40 jours (un tour, plus le chemin de la nouvelle). Le choléra de
  1832 (`events.cholera`) : pendant `LEV_DAYS` après le 1er avril 1832, les villes sans autre événement ont
  `lv = ['epidemie', âge]` (vue seulement). Bancs : `test_campagne.ChampsDeBataille`.
- `carte/guerre.js` :
  - **estafettes** (`NOUVELLE` = 60 km par jour, `arriveeNouvelle`, `capitaleDe`) : un cavalier au galop, par les
    routes, de la bataille à la capitale du camp (ou sa ville la plus proche du chef-lieu perdu), tant que la nouvelle
    n'y est pas ; dans les cercles de vision ; dès `Z.VIE`. **Fêtes et deuil** (`fetesDe`) : chaque ville commence à
    l'arrivée de la nouvelle (âge + ½ jour, l'âge étant arrondi) ; la fête dure 10 jours en temps réel, **un tour
    (30 jours) en tour par tour** (`JOURS.feteTour`, décision du joueur), le deuil 30 jours ; sans lieu (ancienne
    sauvegarde), tout de suite partout ;
  - **prisonniers** : 20 jours, par groupes de seize (un pour 60 prisonniers, 8 au plus) dans les habits du vaincu,
    sans armes, escortés par trois fantassins du vainqueur (un cavalier en tête), du champ de bataille à la ville du
    vainqueur la plus proche, par les routes ; dans les cercles de vision ; dès `Z.VIE` ;
  - **traînards et déserteurs** (`trainardsDe`, 0 à 20) : derrière toute armée en retraite ; pour celles du joueur,
    moral moyen des régiments sous 50, désertions du mois (`des`), vivres coupés ou `sup` < 0,35. Sur la route, après
    la queue de la colonne : des isolés qui suivent, des assis au bord du chemin, des déserteurs sans fusil qui s'en
    vont à travers champs ; dès `Z.VIE`. (Le moral des armées étrangères est caché : rien sauf la retraite.)
  - **travaux de siège** (`avanceeSiege`, `travauxSiege`) d'après `sg.dmg` (assaut à 0,85) : la première parallèle à
    l'ouverture, la deuxième au tiers, la troisième aux deux tiers ; les boyaux s'allongent vers les murs ; dès
    `Z.PLAN` un point à la tête de sape, dès `Z.VIE` le gabion farci, des gabions et trois sapeurs qui piochent ;
    parapets de gabions devant les batteries dès z 40.
- `carte/travaux.js` (nouveau, `Travaux`, appelé par `Guerre.dessus`, relevé une fois par état) :
  - **faubourgs** : une place du joueur dont la file (`q`) a l'agrandissement (`build` `dev`) : six maisons le long de
    la première route hors des murs, fondations, murs sous l'échafaudage et la charpente, finies, d'après
    l'avancement (`etatMaison`) ; tas de pierres, stères ; dès z 40 ; ouvriers et charrette dès `Z.VIE`. Les maisons
    finies du niveau suivant sont celles du plan (`d`, lot B) ;
  - **réparations** (`build` `repar`) : échafaudages sur 2 à 10 maisons (selon `dg`), une grue à roue dont la flèche
    tourne, dès z 40 ; maçons et charrettes de pierres sur deux routes dès `Z.VIE` ;
  - **produits** (chaîne `specialite` ≥ 1 d'une place du joueur, produit d'après `star`, `PRODUIT`) : six par niveau
    sur le quai du port (`lieu().port`), sinon devant la porte : barriques (vins, négoce), barriques de résine, tas de
    sel, paniers de poisson, caisses, sacs de grain, ballots, claies de tabac, gueuses de fer, bêtes en enclos ; dès
    z 40 ; une charrette chargée par niveau sur une route dès `Z.VIE` ;
  - **cordon sanitaire** (`lv` `epidemie`, choléra compris, toute place non assiégée) : à chaque route, au pied des
    murs, un drapeau jaune (taille fixe à l'écran) dès `Z.PLAN` et une lanterne la nuit ; la barrière rayée et deux
    gardes dès `Z.VIE` ;
  - **grands travaux** : voies ferrées en chantier (`rails.state` `chantier`, de tout camp, dans les cercles de
    vision) : le remblai sur 1,2 km devant la partie posée dès z 40, terrassiers, brouettes, traverses et rails
    empilés dès `Z.VIE`. Pour le joueur, d'après `me.tech_dates` : **Ponts et Chaussées**, 180 jours
    (`GRANDS_TRAVAUX`) de chantiers tous les 5 km sur ses routes royales (tas de cailloux dès z 40 ; cantonniers et
    rouleau dès `Z.VIE`), puis une borne par kilomètre (`Z.VIE`) ; **canal**, 240 jours de chantier tous les 4 km sur
    la rive de la Garonne et de la Dordogne (terre remuée dès z 40, terrassiers dès `Z.VIE`), puis le chemin de halage
    (dès z 40) et ses balises ;
  - **routes coupées par la crue** (`coupuresDe`, une fois par état) : les tronçons de `st.cut` (ci-dessous) : l'eau
    sur la chaussée dès z 40, une charrette arrêtée devant dès `Z.VIE` ;
  - **feux des Landes** (`feuxDe`) : le panache noir de loin, les flammes sur la lisière dès z 10, la lueur (`LUM`,
    aussi de jour).
- **Règle de la crue** (`game/crue.py`, décision du joueur) : pendant la crue (`Game.flooded` : la grande crue de `flood_until`,
  tirée en mars un printemps sur cinq environ, pour 3 à 6 semaines ; décision du joueur : pas tous les ans), les routes coupées (`Game.cut_edges`) : là où une route
  (ni bac ni voie d'eau) passe plus de 240 m dans les prés noyés (échantillons tous les 120 m), loin des places
  (`rayonPlace` + 0,5 km), d'après le critère des tuiles (`inonde`, ci-dessous) recalculé côté serveur sur les données
  de `client_payload` (relief approché, distance au fleuve en flottants 32 bits : la même liste que la carte). Calculé
  une fois par carte, au démarrage du serveur (environ 1 s) : **25 routes**, toutes au passage de la Garonne ou de la Dordogne. Une armée y perd
  `crue.DELAY` = **un jour** par arête coupée (à gué ou par un détour, quelle que soit la longueur de la route ; la marche
  est ralentie d'autant sur l'arête, jamais bloquée, pour ne pas rester au milieu), pas le train ; `edge_cost` en tient
  compte (+22 km équivalents), donc la recherche de chemin, l'IA et l'arrivée estimée (`turns.eta`)
  aussi. Vue : `cut = [[arête, début, fin], …]` (km le long du tracé), seulement pendant la crue ; la fiche d'une
  armée du joueur dont l'itinéraire passe par une route coupée le dit. Bancs : `test_campagne.RoutesCoupeesParLaCrue`.
- **Crues des villes** (événement local `crue`, `cities._w_crue`, décision du joueur) : seulement au printemps, et
  seulement dans les places au bord de la Garonne ou de la Dordogne (`cities.GRANDS`). Quand la grande crue est tirée,
  un camp sur deux voit une de ses places du bord sous l'eau (`cities.grande_crue`) ; le reste du printemps, le tirage
  ordinaire la pèse 3 pendant la crue, 0,5 l'année de la crue, 0,05 les autres années (incendie : 3). Mesure
  (`outils/simuler.py` compte les crues de ville ; 3 parties × 12 ans depuis 1790, graines 11 à 13, mois relevés à
  part) : 15 crues de ville avant, de mars à mai, aucune pendant une grande crue, au bord du Lot, de l'Adour, de
  l'Isle… ; après, 18, toutes en mars, pendant une des 10 grandes crues, au bord des deux fleuves. Bancs : `test_campagne.CruesDesVilles`.
- Tuiles (`terre.js`, `ambiance.js`), dans `cleTuiles` : **crue** (`AMB.crue` : `flood` de l'état, la période de
  `Game.flooded` ; pas la pluie du jour, qui repeindrait les tuiles à chaque averse) : les prés bas (altitude approchée < 0,11) à moins de 0,25 à 1,35 km de
  la Garonne et de la Dordogne (`Terre.CRUE`, distance au fleuve par case, `inonde`) sous une eau trouble, sans
  parcelles ni arbres ; **brûlis** (`feuDe`, `brule`, `FEU_K` = 7 km, `FEU_MOIS` juin à novembre) : les étés secs seulement
  (`anneeSeche`, un sur trois environ ; décision du joueur), un carré de 7 km sur 48 a son feu de l'année (2 à 5 feux sur
  toute la forêt), allumé en juin, juillet ou août, de 0,5 à 1,6 km de rayon, noir sans arbres jusqu'en
  novembre, dans la pinède (forêt et lande). `AMB.mois` vient de la date de l'état ; la clé change chaque mois de juin
  à novembre des étés secs (le fond et les tuiles se repeignent une fois par mois, comme au changement de saison).
- `carte/ciel.js` : **gaz** (`factions[].mk` `gaz`) : la nuit, le halo des villes du camp plus blanc (sprite `gaz`) ;
  dès `Z.PLAN`, des réverbères blancs tous les 70 m le long des rues du plan, entre les maisons seulement
  (`reverberes`).
- Bancs : `tests/travaux.test.mjs` (chantiers, produits, cordons, grands travaux, crue, réverbères, sur la vraie
  carte), `guerre.test.mjs` (nouvelle et fêtes, estafettes, prisonniers, traînards, avancée du siège), `terre.test.mjs`
  (crue, feux, clé des tuiles).
- Écarts : estafettes, prisonniers et traînards seulement au plus près (`Z.VIE`), comme les blessés de G ; le moral
  des armées étrangères est caché, leurs traînards ne se voient qu'en retraite ; les produits se voient partout, d'après la
  spécialité de la place, mais au niveau de la chaîne chez le joueur seulement (`sl` n'est envoyé que pour lui ; ailleurs 1) ; les grands travaux des Ponts et Chaussées et du canal
  seulement chez le joueur (`tech_dates`), la voie ferrée d'après son vrai chantier (`rails.state`) et non la date de
  la découverte ; dessins répétés (ouvriers, piles de produits, maisons, échafaudages, groupes de prisonniers,
  traînards) peints une fois par échelle et par pas (`Guerre.tampon`) : sans cela le lot coûtait 2,7 à 3,2 ms au zoom 110.
- Mesures (1280 × 800, Chromium sans carte graphique, scène montée à la main, `integration/vie3/h3.cjs`, médiane de
  120 images, avant → après, deux passes) : printemps (crue, chantiers, cordon, siège à 0,55, prisonniers, estafette,
  traînards, voie en chantier, travaux du joueur) vue d'ensemble 4,6 / 4,2 → 4,7 / 4,8 ms (calques nouveaux 0,04 ms,
  le reste dans le bruit) ; z 26 Bordeaux 2,7 / 2,7 → 3,1 / 2,8 ; z 110 Bordeaux 4,2 / 3,8 → 4,6 / 4,5 (+0,6) ; z 110
  champ de bataille 4,7 / 4,3 → 5,3 / 5,1 (+0,7) ; z 110 siège 3,3 / 3,5 → 3,9 / 3,9 (+0,5) ; z 320 Bordeaux 2,9 / 2,9 →
  3,3 / 3,4 (+0,45). Été (feux des Landes) : vue d'ensemble 4,7 / 4,2 → 4,6 / 3,9 (feux 0,1 ms) ; z 26 Landes 2,2 / 2,0 →
  2,4 / 2,1 ; z 110 Landes 1,8 / 1,6 → 1,8 / 1,7 ; z 110 Bordeaux 4,9 / 4,4 → 5,5 / 5,4 (+0,8). Les tuiles ne coûtent
  rien de plus par image ; le fond et les tuiles se repeignent quand la crue commence ou finit et une fois par mois
  de juin à novembre.
- Captures (`integration/vie3/`) : `h1-bordeaux-printemps-z260` (crue, faubourg en chantier, routes, tombes),
  `h2-champ-prisonniers-z200` (prisonniers, blessés, tombes), `h3-siege-sape-z110` (deux parallèles, sapes),
  `h4-landes-feu-z30` (feux, brûlis), `h5-bordeaux-gaz-nuit-z60` (réverbères au gaz).

## Livré — échelle réelle

Demande du joueur (iPhone, iPad) : gens, chevaux, charrettes, bateaux, bêtes et colonnes à leur vraie taille par
rapport aux maisons, aux rues et au terrain ; au plus près, environ 6 pixels CSS par mètre. Les batailles ne changent
pas.

- **Une échelle des figures** : `FIG` = 0,15 m par unité de figure (`ambiance.js`). Un fantassin ou un passant fait
  4,3 unités d'épaules (0,65 m), un cheval 16 (2,4 m). Banc : `tests/echelle.test.mjs` (ce que chaque figure dessine
  vraiment, en mètres, à 30 % près).
- **Vue de l'intérieur** (`interieur.js`) :
  - figures posées par `Scene.ech` = `FIG × S / 1000` (0,027 unité du plan par unité de figure ; le plan est à
    `S` = 180 unités par km, 5,56 m l'unité). Avant : un passant faisait 24 m, un cheval 59 m, une charrette 44 m.
  - tailles corrigées dans cette unité : charrette attelée (`charrette`, caisse 3 m × 1,6 m, 5,6 m avec le cheval),
    corbillard du convoi (3 m), badauds (0,65 m, comme les passants ; avant 2,4 fois plus petits), étals (3 m),
    vaches (2,2 m), gabares (20 m) et navires (40 m) ; émeute serrée (70 personnes sur 35 m au lieu de 100).
  - vitesses réelles : passants 1,1 à 1,6 m/s, charrettes 1,3, bateaux 1 à 2, vaches 0,8 (avant 8 à 28 m/s).
  - zoom jusqu'à `zMax` = 6 px/m (33 px par unité, au lieu de 4,5) ; la visite « La grand-place » à 9 (les gens s'y
    voient). Une figure de moins d'un pixel ne se dessine pas : les passants et badauds à partir du zoom 8,6
    (1,5 px/m), les vaches dès 2,5, les étals dès 1,9, les charrettes, convois et bateaux toujours (dès 0,8).
  - **le plan net de près** (`rejeu.js`, `peintre-tuiles.js`) : la peinture de l'intérieur s'enregistre pendant
    qu'elle se fait (tableaux typés : 5 à 12 Mo pour une ville, 175 000 à 415 000 appels), chaque tracé avec sa boîte.
    Au-delà de 1,25 fois la résolution de la texture, l'écran se couvre de tuiles de 512 pixels (niveaux 4 à 64 px par
    unité, puissances de deux) où un worker rejoue seulement ce qui touche la tuile : morceaux d'une soixantaine
    d'appels sautés d'un coup, segments des longs traits (rivières, routes, murs) hors de la tuile sautés, couleurs
    posées seulement avant un tracé rejoué. Même image au pixel près que la peinture entière (vérifié tuile à tuile à
    16 et 64 px par unité, trois villes). En attendant une tuile, la texture agrandie dessous ; quand les tuiles
    couvrent l'écran, la texture n'est plus posée. Sans worker à canevas 2D, les tuiles se peignent dans la vue,
    6 ms par image. Au plus 48 tuiles (48 Mo), vidées à la fermeture.
- Mesures (Chromium sans carte graphique, 1280 × 800, dpr 2, médiane de 120 images de `sc.draw` avec le rendu,
  `integration/echelle/int.cjs`, avant → après) : Bordeaux vue d'ensemble 29,3 → 26,8 ms, z 4 28,8 → 9,8, la place
  z 9 (avant bloqué à 4,5) 29,4 → 25,7, z 18 30,7 → 28,7, zoom max 32,1 → 27,1, port au zoom max 27,0 → 27,0 ; Libourne
  en foire z 9 28,3 → 28,3, zoom max 32,4 → 27,1. Une tuile : 3 à 12 ms de rejeu, 12 à 38 ms avec la peinture, dans
  le worker. Peinture de la texture : 1,4 → 2,1 s pour Bordeaux (l'enregistrement), toujours 12 ms par image.
- Écarts :
  - le plan de l'intérieur garde sa taille : ses parcelles font 25 à 45 m de façade, la grand-place de Bordeaux
    244 m, une cathédrale jusqu'à 600 m. À côté, les gens à leur vraie taille paraissent petits ; ramener les
    bâtiments à leur vraie taille changerait le générateur (et son portage Python des batailles) : à décider.
  - moulins, fumées, flammes et drapeau restent à l'échelle des bâtiments du plan.
  - les badauds trop petits pour un pixel ne se dessinent pas en tache (une foule de 80 sur 80 m de rayon est trop
    clairsemée pour une tache à sa vraie taille).
- **Carte de campagne : pas faite** (arrêt prévu par la demande). Sonde (`integration/echelle/campagne.cjs`, fil
  principal, Chromium sans carte graphique) : une tuile de 256 px de `renderTile` à 1–2 km d'une ville coûte, à 256 /
  512 / 1024 / 2048 / 4096 / 8192 px/km, Bordeaux 31 / 31 / 43 / 74 / 151 / 403 ms, Sabres 17 / 19 / 21 / 32 / 92 /
  274, Laruns 19 / 31 / 54 / 92 / 249 / 531 ; un écran d'iPad au zoom 6 000 px/km demande environ 106 tuiles à
  8 192 px/km (28 Mo, la mémoire tiendrait), soit 30 à 55 s de peinture : des secondes de flou à chaque
  déplacement. La peinture du paysage (`terre.js`) ne descend pas avec la surface de la tuile ; il faudrait d'abord
  la rendre proportionnelle (moins de 30 ms par tuile), puis rejouer les plans des villes par tuiles (`rejeu.js`,
  comme l'intérieur : `planCarte` s'arrête à 2 px par unité et 2 048 px de côté), puis passer `U` à `FIG / 1000`
  (0,00015 km, 30 fois plus petit) avec tous les décalages en km de `vie.js`, `guerre.js`, `travaux.js`, `ciel.js`,
  les seuils (une personne fait un pixel à 1 550 px/km) et la vraie longueur des colonnes.

## Livré — bâtiments à la vraie taille

Demande validée par le joueur : bâtiments, rues, places, églises, quais et remparts à leur vraie taille, à côté des
gens de « Livré — échelle réelle ». L'emprise des villes ne change pas : rayon d'après la population (`rayon`,
`rayonPlace`), mur du plan (`V.rMur`, donc `rayonMurs`) ; une ville garde sa surface, avec quatre à huit fois plus
d'îlots (Bordeaux : 187 → 878). Puis, à la demande du joueur (« ça c'est pas beau »), l'aspect de l'intérieur.

- **Le générateur** (`villes.js`, `genererInterieur`, et son portage `plan_ville.py`, toujours identique : 0 plan
  différent sur 669 états) ; 1 unité = 5,56 m :
  - plans ronds (`polaire`) : anneaux de 12 unités (11 au bourg, 14 en montagne), îlots d'environ 16 de long ; en
    s'éloignant de la place, une rue naît entre deux autres dès qu'un îlot dépasserait 1,5 fois cette longueur (le tracé
    reste rond et rayonnant) ; le tremblé des sommets est borné à 0,1 radian (près de la place, il croisait les îlots).
    La place : 97 m à Bordeaux (`V.rPlace`, 8,75), 64 m dans une ville, 53 m dans un bourg. Le mur médiéval et la vieille
    ville gardent leur rayon (les îlots vont jusqu'à 14 m du mur).
  - damiers : faubourgs des grandes villes au pas de 17 (94 m), bastides de 13 (72 m), places fortes de 12, à la même
    emprise qu'avant ; leurs rues seulement le long des îlots gardés (plus à travers la vieille ville ni les champs).
    Faubourgs le long des routes : lots de 44 × 67 m, maisons à 8 m de l'axe.
  - rues de 6,7 m et grandes rues de 13,9 m (les îlots rentrés de 0,6 et 1,25), routes de 8 et 12 m, ponts de 13 m ;
    façades de 6 à 12 m (grande ville), 7 à 14, 8 à 15 (bourg), profondeur de 10 à 16 m ; maisons à 22 m de l'eau,
    derrière le quai (22 m).
  - église ou cathédrale : le plus grand îlot du premier anneau qui reste (à La Réole, l'eau prenait tout le premier) ;
    à l'échelle de l'aire de son îlot (un coin n'en fait plus une chapelle). Citadelle de 400 m (capitale) ou 330 m ;
    tracé bastionné à fronts d'environ 300 m (`N` = R / 8, de 5 à 32), bastions de 80 m de face, terre-plein de 28 m ;
    fort isolé de 280 m (au lieu de 670) ; gare de 87 m ; château du castrum 56 m ; halle 27 m ; métiers aux échelles de
    `terrain_ville.METIERS` (vignes et salines gardent leurs champs).
- **La peinture** (`lib.js`, `villes.js`) : murs de 3 m, tours de 11 m tous les 50 m, lices de 22 m ; enceinte
  bastionnée (fossé de 36 m, glacis de 100 m, chemin couvert, pièces à la taille des figures) ; cours de 33 m, un
  arbre tous les 10 m ; moulins (tour de 9 m), fumées, flammes et drapeau à l'échelle des maisons.
- **L'aspect** : rues de teinte unie, d'un seul tracé par largeur (plus de joints ronds ni de sillons), le milieu bombé un
  peu plus clair ; la grand-place pavée sobrement, la statue sur son socle (la halle ailleurs) ; toits en rangées serrées
  de tailles et de teintes variées, faîtages, ailes en retour et jardinets sur les cours ; la profondeur des maisons
  suit l'aire de l'îlot, pas son côté le plus court : aux pointes, les maisons se rejoignent en coin.
- **Ce qui lit le plan** : badauds, foire, étals et émeute selon `V.rPlace` ; visites (`interieur.js`, pixels par unité) :
  la grand-place à 26 (4,7 px/m, la place entière et ses gens), l'église 12, le port 5, les remparts 8, la citadelle 7,
  le château 14, les forges 14 ; fenêtres de la nuit (`planCarte().lum`) : une fenêtre sur deux tous les 50 m, au plus
  900 réparties dans toute la ville (avant : `hash2(lum.length…)` retirait toujours le même nombre, 8 fenêtres à
  Bordeaux) ; réverbères (`ciel.js`), lieux, quais, port, dégâts, faubourgs : inchangés, ils suivent le plan.
- **Le mur sur la carte** : `V.rMur` à 2,3 % près au début de la partie (Bayonne −2,3 %, Blaye −1,8 %), à 4 à 8 % dans un
  état bastionné hypothétique (les pas de 5 % de la recherche du tracé) ; sauf Fort Médoc et Urdos : 71 → 32 unités,
  `rayonMurs` 0,63 → 0,49 km (`rayonPlace` l'emporte).
- **La carte de campagne** (`planCarte`) : à plat jusqu'à 1 pixel par unité (îlots pleins), maison par maison à 2,
  sans ailes, jardinets, faîtages, cheminées ni arbres, d'un pan par maison.
- **Batailles** (`terrain_ville.py`, cases de 20 m) : une rue plus étroite qu'une case compte pour une case de passage,
  son axe (`_line4`, d'un seul tenant) ; les bandes entre les îlots (moins d'une case) ne sont plus des rues ; une rue sur
  `pas` = ⌈80 m / (12 unités × l'échelle)⌉ seulement, plus les rues maîtresses, pour 80 m au moins entre deux rues
  (sinon la ville serait à moitié rue) ; un édifice plus petit qu'une case prend la case la plus proche hors des rues.
  L'enceinte étant plus petite, la carte est moins réduite (Bordeaux 0,57 → 0,73, Bayonne 0,35 → 0,54, Périgueux 0,38 →
  0,65, Navarrenx 0,66 → 1). Cases bâties / de rue, avant → après : Bordeaux 1 120 / 3 758 → 2 332 / 3 142, Bayonne
  208 / 1 729 → 1 121 / 1 745, Périgueux 122 / 1 023 → 791 / 1 342, Navarrenx 224 / 648 → 467 / 972, Belin 555 / 1 336
  → 657 / 1 039. Client (`decor2d.js`) : mêmes rues, place, cours et rentrées que l'intérieur.
  `Carte.eauK` lit un masque d'eau précalculé (deux fois plus vite, mêmes valeurs).
- **Bancs** : `villes.test.mjs` (la vraie taille mesurée sur ce que le plan dessine : façades 8,8 m, profondeur 12,1 m,
  îlots 76 m, rues 6,7 m, grandes rues 13,9 m, place royale 97 m, place de bastide 72 m, cathédrale 119 m, église de
  village 35 m) ; `test_plan_ville` : Salies-de-Béarn attaquée de l'est (ses salines sont tirées à l'ouest désormais).
- Mesures (Chromium sans carte graphique, médianes ; avant → après). Génération du plan dans le navigateur : Bordeaux
  7 → 13 ms, Bayonne 5 → 10, Libourne 1 → 6 ; les 223 places 0,22 → 0,42 s. Peinture de l'intérieur (texture à 3 px par
  unité, enregistrée) : Bordeaux 1,0 → 1,7 s (373 000 → 934 000 appels), Bayonne 0,6 → 1,4, Libourne 0,7 → 1,2, Sabres
  0,5 → 0,4 ; à l'écran, peinte en 1,7 → 4,0 s pour Bordeaux (12 ms par image). Plan de la carte : à plat 12 → 46 ms,
  maison par maison 76 → 310 ms (Bordeaux, étalés à 6 ms par image). Images de la vue de l'intérieur (dpr 2, 120 images,
  `integration/echelle/int.cjs`) : Bordeaux vue d'ensemble 27,1 → 27,5 ms, z 4 10,1 → 10,9, z 9 32,2 → 29,8, z 18
  29,3 → 28,4, zoom max 24,2 → 26,4, port 26,0 → 23,9 ; Libourne en foire z 9 28,8 → 23,6, zoom max 29,9 → 28,3. Carte de
  campagne (`vie3/h3.cjs`, dpr 1) : z 26 4,6 / 4,0 → 4,9 / 4,1 ms, z 110 7,5 / 7,4 → 7,4 / 7,7, z 320 5,5 / 5,0 → 5,4 /
  5,4. Carte de bataille (`test_vite`) : 0,43 à 0,55 s par carte avant comme après sur cette machine (très chargée : la
  version d'avant n'y passe pas non plus sous 0,5 s).
- Écarts :
  - un village garde l'emprise de son rayon (311 m au moins) : à la vraie taille, cela fait des centaines de maisons
    pour 700 habitants ; réduire l'emprise des bourgs et des villages est à décider (elle sert à la carte et au jeu).
  - la peinture de l'intérieur de Bordeaux et de Bayonne dure 1,7 à 2,3 fois plus.
  - les gens à leur vraie taille restent petits à l'ouverture de la grand-place (3 px).

## Livré — peinture de l'intérieur optimisée

Choix du joueur : « optimiser d'abord ». Le lot des bâtiments à la vraie taille avait porté la peinture de l'intérieur de
Bordeaux à 1,7 s (934 000 appels) et l'ouverture complète à l'écran à 4 s ; l'image ne devait pas changer.

- **Profil** (Bordeaux, Chromium sans carte graphique) : environ 500 ms de rastérisation (quelque 200 000 petites formes,
  dont 70 000 pans de toit), 350 ms d'enregistrement (`rejeu.js`), 150 ms de calcul. Rassembler les toits de toute la ville
  en un tracé par teinte ne gagnait que 5 % et ralentissait les tuiles (les morceaux de 63 appels couraient sur toute la
  ville) : écarté.
- **La texture peinte par le worker** (`interieur.js`, `peintre-tuiles.js`) : avec un worker à canevas 2D, le fil principal
  ne fait plus qu'enregistrer (`enregistrer(g, false)` : repère et réglages passent au canevas, pas les tracés), 12 ms par
  image comme avant ; après chaque pas, la tranche enregistrée part au worker (`tranche()`), qui la rejoue telle quelle,
  dans l'ordre (`rejouerTout`), et rend la texture tous les quarts de seconde, puis finie. Sans worker, la peinture se fait
  ici comme avant ; si le worker échoue en route, tout se rejoue ici d'un coup à la fin.
- **Pas d'image refaite pour rien** : pendant l'enregistrement rien ne vit encore ; la vue ne se redessine que si la caméra ou
  la texture a changé (la redessiner à chaque image, 25 à 40 ms sans carte graphique, doublait l'ouverture).
- **Moins d'appels** : les menus détails des parcelles (herbes, fleurs, mottes, chaumes, des centaines par parcelle) et les
  disques de l'eau, d'un tracé par couleur (`taches`) ; l'enregistreur va plus vite (`moveTo`, `lineTo` sans détour, tableaux
  typés par `new` et non `from`). Chaque sous-chemin a sa boîte : une tuile ne rejoue que les taches qui la touchent.
- Mesures (Chromium sans carte graphique, 1280 × 800, dpr 2, avant → après ; la machine moins chargée qu'au lot précédent) :
  - génération du plan inchangée (Bordeaux 11 à 15 ms, Bayonne 5 à 6, Libourne 3 à 5) ;
  - peinture sur le fil principal : Bordeaux 1 140 → 520 ms (enregistrement seul ; 1 220 sans worker), Bayonne 940 → 370,
    Libourne 1 100 → 320 ; appels 934 000 → 903 000 (Bayonne 674 000 → 625 000) ;
  - complète à l'écran (`campagne-echelle/ouvre.cjs`, deux passes) : Bordeaux 2,31 / 2,44 → 1,22 / 1,21 s, Bayonne 1,93 /
    1,84 → 1,03 / 1,17, Libourne 1,82 / 1,54 → 1,49 / 1,39 ; `echelle/int.cjs` : Bordeaux 2,03 → 1,32 s, Libourne 1,73 → 0,95 ;
  - images de la vue (médiane de 120, `int.cjs` avec vidage) : Bordeaux vue d'ensemble 18,8 / 18,1 → 17,4 / 18,2 ms, z 4 6,2 /
    6,7 → 6,3 / 6,4, z 9 15,8 / 16,7 → 17,3 / 19,3, z 18 16,6 / 18,1 → 17,3 / 17,6, zoom max 16,2 / 18,0 → 17,0 / 16,3, port
    16,1 / 19,4 → 16,1 / 17,6 ; Libourne z 9 16,7 / 18,9 → 19,4 / 18,4, zoom max 16,9 / 18,5 → 17,7 / 17,8 (dans le bruit) ;
  - une tuile de 512 px rejouée (fil principal, Bordeaux) : à 16 px par unité 15,6 → 11,5 ms, à 64 6,6 → 3,4.
- Fidélité (moyenne de |ΔR| + |ΔG| + |ΔB| par pixel, part des pixels à plus de 60) : peinte ici, avant → après : Bordeaux
  0,025 et 0,009 % (99,3 % des pixels identiques), Bayonne 0,055 / 0,023 %, Libourne 0,006 / 0,002 %, Sabres 0,055 / 0,018 %
  (les taches d'une couleur passent avant celles de l'autre) ; peinte par le worker : Bordeaux 0,15 / 0,035 %, Bayonne 0,24 /
  0,076 % (un `OffscreenCanvas` ne rastérise pas tout à fait comme un canevas de la page : rejouée sur un canevas de la page,
  la même tranche donne la même image au pixel près) ; tuiles contre rejeu entier (`echelle/fidele.cjs`) : 0,00 à 0,02, aucun
  pixel à plus de 60. Banc : `echelle.test.mjs` (sous-chemins hors de la fenêtre sautés, tranches rejouées dans l'ordre).

## Livré — la surface des villages et des bourgs

Choix du joueur : « il faudrait trouver un entre-deux suivant la taille des villes » ; les villages rétrécissent nettement,
les bourgs un peu, les grandes villes presque pas.

- **Le rayon** (`villes.js`, `rayon`, et `plan_ville.rayon`, identiques) : R = 2,1 √pop − 36 unités de 5,56 m, entre 20 et
  262, par paliers de 4 (avant : 46 + 1,55 √pop, entre 56 et 262, par paliers de 8). Le plancher, 20 unités (111 m), garde
  un village lisible : à z 110, 24 px de diamètre, une couronne d'îlots autour de la place et de l'église. Il est lu partout :
  `rayonPlace` (`guerre.js`, `vie.js`, d'après `rayon`), donc `rayonMurs`, le siège, les bivouacs, les foires, les lumières
  (`ciel.js`), `travaux.js` ; `crue.py` (les places que la crue épargne) ; les cartes de bataille et de siège
  (`terrain_ville.py`, par le plan). Le village-rue garde des rues de 4 fois son rayon (avant 1,5) : 5 à 8 habitants par
  maison.
- **Sur la carte**, une place dont le plan ferait moins de 10 px de rayon garde son signe (`towns.js`, `plan`) : un village
  de 111 m jusqu'à z 90, un bourg de 445 m jusqu'à z 22. Dans l'intérieur, la place s'ouvre entière (jusqu'à 12 px par
  unité au lieu de 4) ; le sol de la ville suit ses îlots (plancher 40 unités ramené au rayon).
- Exemples (maisons comptées sur le plan peint, 1789 ; avant → après) :

  | Place | Habitants | Rayon | Îlots | Maisons | Habitants par maison |
  |---|---|---|---|---|---|
  | Belin (village rond) | 731 | 489 → 111 m | 174 → 14 | 3 391 → 229 | 0,2 → 3,2 |
  | Lanton (village rond) | 676 | 489 → 111 m | 171 → 12 | 3 420 → 182 | 0,2 → 3,7 |
  | Nontron (bourg) | 3 000 | 712 → 445 m | 321 → 112 | 7 709 → 2 433 | 0,4 → 1,2 |
  | Libourne (bastide) | 8 000 | 1 023 → 845 m | 509 → 403 | 10 820 → 8 291 | 0,7 → 1,0 |
  | Bayonne | 13 000 | 1 245 → 1 134 m | 626 → 508 | 19 727 → 15 822 | 0,7 → 0,8 |
  | Bordeaux | 110 000 | 1 468 m | 878 | 23 869 | 4,6 |

  Médianes : villages 0,3 → 2,8 habitants par maison, villes 0,4 → 1,2, capitales 0,6 → 1,3.
- Écarts :
  - les bourgs et les villes restent bien plus serrés que la cible (6 à 10 habitants par maison dans un bourg, 15 à 30 par
    immeuble dans une grande ville) : à la densité du générateur (des maisons en rangées sur tout le tour des îlots), y
    arriver demanderait des bourgs de 170 m de rayon et un Bayonne de 500 m, ou des îlots moins serrés (jardins entre les
    maisons) : à décider ;
  - un village de montagne au plancher n'a qu'un anneau (Denguin, Gan : 45 à 50 maisons) ; une place sur l'eau perd ses
    îlots noyés (Port-Sainte-Marie : 9 maisons) ;
  - la vie autour (passants, foires, fumées) suit `rayonPlace`, mais sa densité ne suit pas encore le nombre de maisons.
- Batailles : `test_plan_ville` (JS = Python sur tous les états) passe ; carte de bataille 0,30 → 0,27 s en moyenne (Bayonne
  0,34 → 0,29, Bordeaux 0,38 → 0,36, Navarrenx 0,26 → 0,25, Belin 0,22 → 0,19). Tests adaptés : le bourg de Belin compte
  plus de 30 cases bâties (avant 50) ; la carte de Salies-de-Béarn est centrée 600 m au sud (ses salines, tirées à 1,3 km au
  sud, sortaient de la carte) ; les canons du défenseur se vérifient dans sa propre vue ; la longueur d'une coupure de crue,
  arrondie au mètre, à 1e-9 près.
- Captures (`integration/campagne-echelle/`) : `int-village-belin.png`, `int-bourg-nontron.png`,
  `carte-village-belin-z110.png`.

## Livré — la carte de campagne à la vraie taille

L'étape intermédiaire validée par le joueur : les figures de la carte à leur vraie taille, un zoom quatre fois plus
proche, le paysage et les plans des villes nets jusque-là, et à chaque zoom quelque chose de sensé.

- **Échelle et zooms** (`ambiance.js`) : `U` = `FIG` / 1000 (0,00015 km par unité de figure, 30 fois moins qu'avant) ;
  `Z.MAX` = 1 300 px/km (un cheval y fait 3 px) ; `vue(z, t)` : une figure de t unités fait-elle un pixel ? Niveaux des tuiles
  jusqu'à 1 024 px/km (384, 512, 768, 1 024) ; au-delà de 256, une tuile est prise un peu agrandie, jamais réduite (réduites,
  sans carte graphique, les poser coûtait 20 à 40 ms par image sur un écran Retina).
- **Le paysage** (`terre.js`, `map.js`) : au-delà de 256 px/km, les houppiers rapetissent et se resserrent avec le zoom
  (21 m de rayon à 1 024, autant d'arbres par tuile ; la marge des tuiles élargie : plus de coutures) ; les arbres des routes
  royales 9 m tous les 35 m ; la route royale 12 m, les autres 6 (de loin, 2,6 et 1,4 px comme avant), son bord 3 m ; la
  ferme isolée 25 m (elle en faisait 250), la cabane du saunier 10 m. Une tuile de 256 px à 1 024 px/km : 6 à 23 ms
  (Bordeaux 19, Sabres 6, Laruns 23 ; avant ce lot, 17 à 42), environ 25 tuiles pour un écran d'iPad.
- **Les plans des villes** (`villes.js`, `towns.js`) : maison par maison, la peinture du plan s'enregistre (`rejeu.js`) ; au-delà
  de 2,4 px par unité de l'écran, des tuiles de 512 px rejouées par un worker (`peintre-tuiles.js`, qui garde six plans),
  agrandies d'au plus deux fois ; l'image du plan dessous tant qu'il en manque. Au plus 40 tuiles (40 Mo), toutes places
  confondues ; l'enregistrement compte dans le budget des plans (Bordeaux 6,8 Mo). Le plan de Bordeaux maison par maison :
  183 → 249 ms (étalés à 6 ms par image). Le mur de `map.walls`, sur un grand plan : rond, à 48 pans.
- **La vie** (`vie.js`) : les gens à pied ne se dessinent pas (moins d'un pixel jusqu'à 1 550 px/km) ; la foule d'un marché ou
  d'une foire en taches, une par personne ; les chevaux dès qu'ils font un pixel ; chaque voyageur de la route seulement s'il
  fait un pixel. Tailles : diligence 10 m, malle-poste 9, charrette attelée 6 (`guerre.charrette`, partagée), vaches 2,2 m,
  brebis 1,2, cerfs 1,8, sangliers 1,3, gabares 20 m et navires 40 (au moins 3 px de long : de loin, un signe), pinasses 10,
  trains de bois 30, relais de poste 25 m et sa cour, cabanes tchanquées 6 m, carrelets 5, cayolar 6 et son parc de 15,
  charbonnière 5, moulins (tour de 9 m), étals 3 m, enclos de foire 7 m, Cordouan 16 m. Vitesses réelles : malle-poste
  15 km/h, diligence 10, cavalier 11, charrette 5, bœufs 3, troupeaux 2,5. Passants à 3 m de l'axe de la route.
- **La guerre** (`guerre.js`) : la colonne à sa vraie longueur (`compoColonne`, en mètres : par quatre, un rang d'infanterie au
  mètre, de cavalerie aux trois mètres ; une pièce attelée 22 m, un caisson 14, une voiture 10, l'état-major 15, 10 m entre
  deux bataillons : 600 hommes, 200 m ; avant, 2 à 8 km pour 1 100 hommes), en bandes de leur vraie largeur (infanterie 3 m,
  cavalerie 5, au moins un pixel), ses chevaux un à un, ses pièces, caissons et bagages en figures dès 420 px/km ; coupée de
  ses vivres, des bandes plus étroites et sans bagages. Bataille : un bataillon, une bande de son front (0,65 m par file sur
  trois rangs), un escadron de même (1,2 m par cheval), trois pièces à 15 m. Bivouac : tentes 3 m, feux 1,5 m, pièces tous
  les 8 m, chevaux à la corde côte à côte. Siège : tranchées 8 m, épaulements 40 m, parapets de gabions 28 m, maisons en feu.
  Traces 12 m, tertres 2 m ; prisonniers en tache de 5 m ; fourgons, blessés, estafettes à leur vitesse ; fêtes, pillages,
  traînards, recrues, fourrageurs à pied : sous le pixel.
- **Les travaux** (`travaux.js`) et **le ciel** (`ciel.js`) : faubourgs en chantier (maisons de 12 m à 10 m de la route),
  échafaudages, grue, barrières des cordons, remblais de 10 m, halage de 3 m, crue sur 40 m ; fenêtres de 1,2 m de près.
- **Ce qui se voit, à quel zoom** (px CSS par km ; un pixel CSS) : une personne, jamais (0,84 px à 1 300) ; une brebis dès 830,
  un cheval, une vache dès 420-450, une tente dès 330, un étal dès 330, une charrette dès 170, une diligence dès 105, une
  gabare dès 50 (avant, en signe de 3 px dès 10), un navire dès 25 ; la colonne en bande dès `Z.VIE` (110), ses chevaux dès
  420, son drapeau dès 600 ; les tranchées, routes, traces, au moins 3 px. Avant ce lot, au même zoom 110, les figures
  faisaient 30 fois leur taille.
- Mesures (`campagne-echelle/h3.cjs`, la scène du lot H montée à la main, médiane de 120 images, deux passes, avant → après,
  dpr 1) : vue d'ensemble 5,0 / 4,4 → 4,0 / 4,4 ms ; z 26 Bordeaux 3,5 / 2,8 → 3,2 / 2,8 ; z 110 Bordeaux 4,7 / 4,2 → 4,0 /
  3,4, champ de bataille 5,0 / 5,2 → 4,0 / 4,0, siège 3,7 / 3,4 → 3,2 / 3,1 ; z 320 Bordeaux 2,9 / 3,0 → 2,5 / 2,6, colonne 2,3 /
  2,8 → 2,0 / 1,7 ; z 640 Bordeaux 2,6 / 2,4 → 2,2 / 2,3 ; z 1 300 Bordeaux 2,2 / 2,4 → 2,2 / 2,4, colonne 1,6 / 1,5 → 2,0 /
  1,7, siège 1,2 / 1,2 → 1,3 / 1,3 (avant, à 640 et 1 300 : la caméra posée là, hors des bornes d'alors). Dpr 2 : vue
  d'ensemble 5,1 / 4,7 → 4,9 / 4,4 ; z 110 Bordeaux 6,0 / 5,2 → 4,6 / 4,2 ; z 320 Bordeaux 3,7 / 3,3 → 3,2 / 3,4 ; z 1 300
  Bordeaux 2,8 / 2,8 → 2,6 / 2,4, colonne 2,0 / 1,9 → 2,2 / 2,1. Au plus +0,4 ms.
- Bancs : `echelle.test.mjs` (`U` en km, une charrette attelée de 6 m sur 1,8, une colonne de 600 hommes de 200 m en bande
  de 3 m), `guerre.test.mjs` (1 120 hommes sur 0,5 à 0,8 km), `vie.test.mjs` (la vie tirée et animée de près, à 600 px/km).
- Captures (`integration/campagne-echelle/`) : `carte-colonne-z700.png` (900 fantassins, 300 cavaliers, 120 artilleurs sur la
  route de Libourne), `carte-bordeaux-z1300.png` (le plan rejoué net), `carte-libourne-z450.png`.
- Écarts :
  - (décision du joueur, depuis) les trains vus du ciel ont leur vraie longueur (14 m par voiture, rien sous 1,5 px ; de
    profil sur la carte d'époque, lisibles) et les oiseaux leur vraie envergure (grue 2 m, mouette 1 m, palombe 0,7 m,
    étourneau 0,4 m ; rien sous le pixel) ; les lumières (lanternes, feux) gardent leur halo de quelques pixels ;
  - (fait depuis, « Livré — petits défauts ») le mur de `map.walls` suit le tracé du plan ; les rangs d'arbres s'arrêtent aux
    ponts ;
  - les tuiles de l'intérieur sont encore prises réduites (`interieur.js`) ;
  - le style « époque » garde ses figures et ses tailles d'avant.

## Livré — petits défauts (arbres des ponts, murs du plan, pont de pierre, carte d'époque)

- **Les arbres des routes royales** (`terre.js`, `arbresRoyaux`) s'arrêtent sur le pont (la moitié du pont de `drawRoads`, plus
  un houppier) ; les bacs n'en avaient déjà pas (la route du bac n'est que la traversée).
- **Le mur de la carte suit le plan** (`villes.js`, `formeMur` ; `map.js`, `walls` et `wallGeom` ; `towns.js`, `plan`) : de
  près, sur le plan, le rectangle de la bastide (Libourne), le tracé bastionné du plan et ses demi-lunes (au niveau 4), la
  citadelle à côté du mur (Bordeaux, Bayonne), mis au rayon du mur (`V.rMur`), coupés en pans pour les tours et la brèche ;
  sans tracé, le mur rond comme avant ; de loin (le signe), l'étoile d'avant. `rayonMurs` (`guerre.js`) lit l'étendue de ce
  tracé au lieu des facteurs de l'étoile (1,42, 1,62). Banc : `villes.test.mjs`.
- **Les ponts datés** (`villes.PONTS_DATES`, `terrain.PONTS_DATES` : ville, rivière, année) : le pont de pierre de Bordeaux,
  inauguré en 1822. Avant : dans l'intérieur, pas de pont, l'eau repasse sur la route (la texture change avec, `cleTexture`) ;
  sur la carte, le pont de la route de Lormont devient un bac (`map.js`, `pontAn` ; les tuiles se repeignent au passage,
  `epoque.js`) ; dans une bataille, les routes qui passent la Garonne à moins de 2 km de Bordeaux y passent sur un pont de
  bateaux (le dessin seul change : mêmes cases, toutes versions de carte). Banc : `test_plan_ville`.
  - (fait depuis, « Livré — les autres ponts datés ») Autres ponts dessinés dès 1789 qu'on pourrait dater : le pont de pierre de Libourne sur la
    Dordogne (1824), le pont suspendu de Cubzac (1839), le pont de pierre d'Agen (1827), le pont de Bergerac (vers 1825), les
    ponts suspendus de La Réole (vers 1835), Langon (vers 1831), Cadillac, Marmande, Tonneins, Sainte-Foy (années 1830-1840) ;
    la carte dessine un pont à chaque route qui passe un fleuve (`geo.py`, `bx`), l'intérieur à chaque route ou rue
    maîtresse. Dans une bataille à Bordeaux, trois routes passent la Garonne (Lormont, Libourne, Cubzac) : trois à cinq ponts
    au lieu d'un.
  - De près, sur la carte, un pont n'a que 1,5 fois la largeur de la route (vraie taille) : il se lit mal.
- **La carte d'époque** revue à chaque zoom (captures `integration/petits-defauts/`, dpr 1 et 2) : la gravure jusqu'à 64 px/km,
  puis elle s'efface sur la vue du ciel. Elle finit désormais de s'effacer à `PAPIER_MAX` (85 px d'écran par km), quand
  paraissent les plans, la vie et les lumières (avant, jusqu'à 100 : les plans se posaient sur une gravure encore au tiers).
  Le reste tient : signes, jetons et trains de profil lisibles, tailles des routes et des ponts gravés en km comme avant.
  Écart : les seuils sont en pixels de l'écran, la gravure s'efface donc à z 35-42 sur un écran Retina et à z 70-85 sur un
  écran simple (voulu : au-delà, la tuile de 64 serait floue).


## Livré — la densité des bourgs et des villes

Demande du joueur : environ un habitant par maison dans un bourg de 3 000 habitants ou à Libourne ; la cible, 6 à 10 dans
un bourg, 15 à 30 par immeuble de 2 à 4 étages dans une grande ville. Approche retenue, un mélange : un cœur serré, des
faubourgs aérés, un rayon un peu plus court.

- **Le rayon** (`villes.js`, `rayon`, et `plan_ville.rayon`) : R = 1,45 √pop − 20 unités (avant 2,1 √pop − 36), mêmes bornes
  (20 à 262) ; un village de 700 garde ses 111 m, Bordeaux ses 1,47 km. Les tailles de ville suivent (même population : grande
  au-delà de R 136, moyenne au-delà de 80 ; avant 190 et 110). Une bastide de village n'a plus que 5 îlots sur 3 (au moins
  10 sur 8 avant : Cadillac, 318 habitants, avait 376 maisons).
- **Les clos** (`villes.js`, `CLOS`, `DENSITE` ; `plan_ville.py`, identiques) : passé le cœur (0,2 du rayon, 0,3 dans une grande
  ville), une part croissante des îlots sans rôle devient un clos, jusqu'à 95 % (90 %) aux trois quarts du rayon ; les
  faubourgs des routes à 0,6 de ce maximum, les îlots des rues maîtresses au tiers. Un clos est un verger, un maraîcher, une
  cour avec son hangar (chantier, entrepôt) ou un terrain vague (`lib.js`, `remplirIlot`, `CLOS_COUL`). Les autres îlots hors
  du cœur ne sont bâtis que sur une partie de leurs côtés (`cotes`, jusqu'à 20 % au bord), jardins derrière. Tirages par
  `hash2` de l'îlot : le tirage du plan ne change pas.
- **Les façades** un peu plus larges : 8 à 14 m dans une grande ville (avant 6 à 12), 8 à 15 dans une moyenne, 9 à 17 dans un
  bourg (`remplirIlot` ; `decor2d.js`, `LARG` des batailles inchangé).
- **Ce qui suit** : la carte (`planCarte`, à plat : clos à leur teinte, maisons sur leurs seuls côtés), les dégâts et les
  fenêtres de la nuit (pas dans les clos), les batailles (`terrain_ville.py` : un clos en pré, un verger en `VERGER` ; maisons
  sur les côtés du plan ; `decor2d.js` : teintes des clos, maisons sur les côtés), la crue (`crue.py`, par `rayon`).
- **Cartes de bataille, version 6** (`terrain.VERSION`) : une bataille de version 5 d'une sauvegarde garde son plan
  (`plan_ville_v5.py`, `terrain_ville_v5.py`, figés ; banc `test_carte_v5_figee`). Carte de bataille 0,32 s en moyenne avant
  comme après (Bayonne 0,43 → 0,38, Bordeaux 0,44 → 0,41, Navarrenx 0,32 → 0,29, Belin 0,19 → 0,28). Nontron : cases bâties
  506 → 142.
- Avant → après (maisons comptées sur le plan peint, 1789 ; `integration/campagne-echelle/maisons.mjs`) :

  | Place | Habitants | Rayon | Îlots | Maisons | Habitants par maison |
  |---|---|---|---|---|---|
  | Belin (village rond) | 731 | 111 m | 14 | 229 → 120 | 3,2 → 6,1 |
  | Lanton (village rond) | 676 | 111 m | 12 | 182 → 136 | 3,7 → 5,0 |
  | Nontron (bourg) | 3 000 | 445 → 334 m | 112 → 78 | 2 433 → 424 | 1,2 → 7,1 |
  | Libourne (bastide) | 8 000 | 845 → 600 m | 403 → 231 | 8 291 → 1 069 | 1,0 → 7,5 |
  | Bayonne | 13 000 | 1 134 → 801 m | 508 → 233 | 15 822 → 1 984 | 0,8 → 6,6 |
  | Bordeaux | 110 000 | 1 468 m | 878 | 23 869 → 6 711 | 4,6 → 16,4 |

  Médianes, toutes places : villages 2,8 → 6,8 habitants par maison, villes 1,2 → 6,6, capitales 1,3 → 10,3.
- Écarts :
  - Bayonne (6,6) et les capitales de département restent sous la cible d'une grande ville : leur vieille ville dans les murs
    reste serrée ; y arriver demanderait d'aérer aussi l'intérieur des murs ou d'en raccourcir encore le rayon : à décider ;
  - à Bordeaux, les faubourgs hors les murs sont presque tous des clos, les Chartrons compris (le long du port, ils étaient
    bâtis) ;
  - quelques villages (Buzet, Sainte-Colombe : 2 habitants par maison) gardent leur plancher de 111 m.
- Captures (`integration/densite/`) : intérieurs de Nontron, Libourne, Bayonne, Bordeaux ; Nontron sur la carte à z 200 et 450.

## Livré — le zoom de la vie

À la vraie taille, `Z.VIE` (110 px/km) ne montrait plus que les colonnes, les diligences et les bateaux ; le reste de la vie
(paysans, charrettes, bêtes, travaux, marchés) se calculait et se peignait sous le pixel jusqu'à 170 à 450 px/km.

- **Les zooms** (`ambiance.js`, `Z`) : `COLONNES` = 110 (les armées en bandes à leur vraie taille, les batailles en lignes :
  une colonne de 600 hommes y fait 22 px ; `map.js`, `guerre.js`), `VIE` = 170 (une charrette ou une diligence y fait un pixel).
- **Chaque chose dès qu'elle fait un pixel** (`vue(z, taille)`), rien n'est calculé en dessous :
  - `vie.js` : la vie des routes, des champs et des bois à partir de `Z.VIE` (chaque voyageur à sa taille, comme avant) ; les
    transhumances dès qu'un mouton bâté (16 unités) fait un pixel (420 px/km), les brigands à leur cheval (ou à la voiture
    arrêtée), les bêtes des champs à leur vache (12 unités, 560), le labour à ses bœufs (420), le gemmeur à son pot et son
    houppier (510), les loups (830), les paludiers à leur râteau (1 100) ; moisson, vendanges, bûcherons et estive dès
    `Z.VIE` (charrette, charbonnière, cayolar) ; les chevaux de relève et les contrebandiers à leurs chevaux (420, au lieu de
    110 et 60) ; les marchés à leurs étals de 3 m (330, au lieu de 40) ; la foire, sa terre piétinée dès 30, ses enclos et
    sa foule dès 140 ; les moulins à leur tour de 9 m (110, au lieu de 40) ;
  - `guerre.js` : l'arrière des armées (blessés, prisonniers, fourgons, traînards, fourrageurs, recrues) dès `Z.VIE` ;
    l'estafette, les pièces et les chevaux du camp, les sapeurs et leur gabion dès qu'un cheval fait un pixel (420) ; les
    servants des batteries avec les gens (jamais à la vraie taille) ;
  - `travaux.js` : barrières, ouvriers et charrettes des chantiers dès `Z.VIE` ; chaque dessin posé (`pose`) dès qu'il fait
    un pixel (maisons du faubourg, échafaudages, tas, brouettes, rouleau) ; bornes et balises à leur taille (en fait jamais
    dessinées : un point d'un pixel depuis, « Livré — petits défauts de la relecture ») ;
  - `ciel.js` : rien de vivant (fenêtres et réverbères dès le plan, au moins un pixel).
- Mesures (`integration/vie3/h3.cjs`, la scène du lot H, médiane de 120 images, deux passes, dpr 1, avant → après) : vue
  d'ensemble 4,3 / 5,7 → 5,9 / 4,4 ms (bruit) ; z 26 Bordeaux 3,0 / 3,5 → 2,7 / 2,8 ; z 110 Bordeaux 4,1 / 4,2 → 2,2 / 2,6,
  champ de bataille 4,5 / 4,1 → 2,8 / 2,4, siège 4,5 / 3,4 → 2,7 / 3,7 ; z 320 Bordeaux 3,3 / 3,5 → 2,1 / 2,1. Avec
  `integration/controle/h3z.cjs` (mêmes scènes, d'autres zooms) : z 80 champ 2,9 / 2,8 → 2,3 / 2,3 ; z 170 Bordeaux 3,1 /
  3,5 → 2,8 / 2,6, champ 3,2 / 4,0 → 2,8 / 2,7 ; z 450 Bordeaux 2,5 / 2,4 → 2,7 / 2,5, champ 2,3 / 1,7 → 2,2 / 1,9 (dans le
  bruit de la machine).


## Captures de contrôle (après les trois lots précédents)

États préparés à la main, aucune partie ni bataille jouée (`integration/controle/`) : `1-siege-bayonne-debut-ensemble.png` et
`2-siege-bayonne-debut-ville.png` (assaut de Bayonne préparé par `onStartSkirmish`, en déploiement, `siege-debut.cjs`),
`3-bordeaux-gaz-nuit-z90.png`, `4-cordon-libourne-z220.png`, `5-crue-route-coupee-z400.png` (la coupure de la route de
Cubzac posée dans l'état, `cut`), `6-bayonne-murs-z45.png` (le tracé bastionné et la citadelle sur la carte),
`7-vie-bordeaux-marche-z450.png` ; scripts `../c1/cap.cjs` (état forcé, vues, intérieurs) et `h3z.cjs`.

- Corrigé :
  - le pont d'une route dont le tracé a plusieurs segments était tourné selon le segment dont le milieu est le plus proche,
    pas celui qui passe l'eau (le pont de Cubzac de travers sur la Dordogne) : `map.js`, `prepEdges`, la distance au segment ;
  - les réverbères au gaz éclairaient les rues des clos et toutes celles à moins de 24 unités d'un îlot (les faubourgs aérés
    restaient illuminés) : seulement le long des îlots bâtis, à moins de 20 unités (`ciel.js`, `reverberes`).
- À décider (depuis : Libourne, Bayonne et le mur de Bordeaux, « villes denses dans leurs murs » ; la vie rare, « le trafic
  des routes » ; la route de Libourne, « les autres ponts datés ») :
  - Libourne (600 m) et Bayonne (800 m) ne touchent plus leurs rivières : la ville rétrécit autour de son point, la Dordogne,
    l'Isle, l'Adour passent hors les murs ; le port et ses quais n'ont plus d'eau (il faudrait décaler le centre du plan vers
    l'eau, ou garder le rayon des ports) ;
  - le mur rond de la carte (et de l'intérieur) traverse la Garonne à Bordeaux, ses tours dans l'eau ;
  - la vie à la vraie taille est rare : un voyageur visible tous les 2 à 3 km de route royale, une scène des champs par km² ;
    à 600 px/km l'écran (2 km sur 1,3) n'en montre souvent aucune ; la densifier coûterait des figures par image ;
  - sur la carte, la route de Libourne passe la Garonne à Bordeaux sans pont ni bac (`geo.py` ne retient qu'un passage par
    route, ici celui de la Dordogne) ; de même pour toute route qui passe deux rivières ;
  - dans les batailles, les clos n'ont que leur teinte (ni arbres du plan, ni hangar), les vergers ont les arbres des cases
    `VERGER`.


## Livré — villes denses dans leurs murs, collées à leur fleuve

Décision du joueur : chaque ville à sa vraie taille, serrée dans ses murs (300 à 500 habitants par hectare dans le cœur), les
clos (vergers, maraîchers, vignes, jardins) seulement hors les murs, chaque ville au bord de son fleuve avec ses quais, le mur
jamais dans l'eau ; les villages et les bourgs sans murs comme avant.

- **Le cœur d'une ville close** (`villes.js`, `coeur`, et `plan_ville.coeur`, identiques) : 0,47 √pop unités (environ
  400 habitants par hectare, au moins 111 m) ; Bordeaux 870 m (le mur au même endroit qu'avant), Bayonne 300 m, Agen 270 m,
  Libourne 230 m. L'emprise (`rayon`) ne change pas : au-delà du mur, les faubourgs (`hors`) jusqu'à elle.
  - grande ville : la vieille ville ronde jusqu'au cœur, le damier des faubourgs au-delà ; ville, port : les anneaux du cœur,
    puis d'autres anneaux et d'autres rues hors les murs ; bastide close : 3 îlots sur 2 à Libourne (`rc / 13`), un damier de
    faubourgs autour jusqu'au bord de l'emprise ; place forte : 2 îlots au moins (au lieu de 4).
  - dans les murs, rien que des maisons, sauf 4 % de cours et de vergers (jardins d'hôtels) ; hors les murs, les clos comme
    avant (de plus en plus vers le bord) ; à moins de 220 m de l'eau, tout est bâti (les quais : les Chartrons).
  - les lieux dans les murs : églises selon la taille de la vieille ville (une à quatre), couvents, hôpital, casernes ;
    l'esplanade de la citadelle 55 m (au lieu de 140) ; les faubourgs hors du glacis, 250 m au-delà des bastions (au lieu de
    610).
- **Au bord de l'eau** (`profilVille`, `o`) : les rivières des données passent souvent à 1 ou 2 km du nœud. Le plan d'une
  ville, d'un port ou d'une place forte est décalé vers la grande rivière la plus proche (ou la mer) : la rive au pied des
  murs (67 m de quais), ou, sans murs, l'eau qui mord sur 15 % de l'emprise. Décalage : Bordeaux 220 m (du fleuve), Bayonne
  1,27 km (vers l'Adour), Agen 910 m, Libourne 870 m (au confluent de l'Isle et de la Dordogne), Blaye 350 m, Pauillac 110 m ;
  les villages, les forts et les villages perchés sous leur château (castrum) restent au nœud. Au-delà de 1,35 km, l'eau des
  données n'est pas la sienne : Langon, Montpon, Domme, Saint-Sever, Sainte-Livrade, Penne-d'Agenais restent au nœud.
  - les grandes rivières se trouvent par leurs segments (Bergerac, Cadillac : la Dordogne et la Garonne passaient entre deux
    points des données, à 500 m) ; les petites comme avant ; largeur du plan = largeur de la carte (`terre.js`,
    `LARG_RIVIERE`), les maisons ne s'arrêtent plus à 100 m d'une eau qu'on ne voit pas ; les quais d'une ville au bord d'un
    fleuve, port ou non (`Pf.quai`), coupés au confluent.
- **Le mur jamais dans l'eau** : `formeMur` rend des tracés ouverts, en pans de r / 8, coupés là où ils passeraient dans
  l'eau (le mur rond aussi : `map.walls`) ; dans l'intérieur, l'enceinte bastionnée est peinte avant l'eau, qui la recouvre ;
  la citadelle tourne jusqu'au sec ; les demi-lunes dans l'eau tombent. Bataille : les murs ne prennent pas les cases d'eau
  (comme avant).
- **Où la ville est dessinée** (`villes.site`, `n.vx`, `n.vy`, calculés par `carteDe`) : le plan, les remparts, le signe, le
  nom, la garnison, le choix au doigt, les armées rangées sous la place, le siège (tranchées, camps), les foires, les halos
  de la nuit, les fumées, les échafaudages. Restent au nœud : les routes de la carte et les armées en marche (les données du
  serveur), le cordon sanitaire et les chantiers du faubourg (le long des routes).
- **Batailles, version 7** (`terrain.VERSION`) : la carte d'un assaut se centre sur la ville (`Lieu.site`), le plan s'y
  pose par son centre (`V['C']`) ; les quais des villes au bord d'un fleuve ; une maison dont la rue a été retirée (rue sans
  issue) devient une cour. La version 6 est figée (`plan_ville_v6`, `terrain_ville_v6` ; `test_carte_v6_figee` : l'empreinte
  de la carte de Libourne d'alors). Carte de bataille 0,32 s en moyenne (Bayonne 0,31, Bordeaux 0,46, Navarrenx 0,27, Belin
  0,24).
- **La crue** (`crue.py`, `_rayon`) lit le rayon figé de `plan_ville_v5` : la règle des parties en cours ne suit plus le
  dessin des villes ; 27 routes coupées (`test_campagne`, 30 avec le rayon de la version 6).
- Avant → après (1789, maisons comptées sur le plan peint, `integration/villes-denses/mesures.mjs` ; « murs → eau » : du mur
  du plan à l'eau, 0 = coupé à la rive) :

  | Place | Habitants | Mur (rayon) | Maisons | Habitants par maison | Bâti → eau | Murs → eau | Décalage |
  |---|---|---|---|---|---|---|---|
  | Bordeaux | 110 000 | 895 → 911 m | 6 711 → 11 233 | 16,4 → 9,8 | 40 → 40 m | 0 (dans la Garonne) → 24 m | 220 m |
  | Bayonne (bastionnée) | 13 000 | 1 104 → 419 m | 1 984 → 909 | 6,6 → 14,3 | 754 → 40 m | 420 → 0 m | 1 270 m |
  | Libourne (bastide) | 8 000 | 750 → 374 m | 1 069 → 1 391 | 7,5 → 5,8 | 124 → 33 m | 547 → 17 m | 870 m |
  | Agen | 11 000 | 470 → 318 m | 1 536 → 1 907 | 7,2 → 5,8 | 135 → 24 m | 778 → 17 m | 910 m |
  | Nontron (bourg sans murs) | 3 000 | — | 424 → 424 | 7,1 | — | — | 0 |
  | Saint-Médard-en-Jalles (village) | 691 | — | 133 → 133 | 5,2 | — | — | 0 |
  | Blaye (port, bastionné) | 4 500 | 541 → 416 m | 578 → 276 | 7,8 → 16,3 | 182 → 64 m | 0 (dans l'estuaire) → 17 m | 350 m |
  | Pauillac (port, village) | 1 478 | — | 104 → 322 | 14,2 → 4,6 | 33 → 24 m | — | 110 m |

- Écarts :
  - (fait depuis pour les nouvelles parties, « Livré — les rivières affinées, les villes à leur vraie place ») les routes
    de la carte vont toujours au nœud : à Bayonne, 1,3 km au sud de la ville, elles se rejoignent dans les
    faubourgs ; les armées en marche aussi (les positions du serveur) ; déplacer les nœuds des données réglerait tout, mais
    changerait la carte, les batailles des versions figées et la crue ;
  - (fait depuis, même lot) la Nive des données s'arrête 1,9 km au sud de l'Adour : Bayonne est sur l'Adour, pas sur la Nive ;
  - Bayonne et Blaye (bastionnées, faubourgs hors du glacis) ont 14 à 16 habitants par maison ; Libourne et Agen 6 ;
    Bordeaux 10 (ses échoppes basses) ;
  - les villages au bord d'une grande rivière (Port-Sainte-Marie) gardent leurs îlots noyés.


## Livré — les autres ponts datés

- **`PONTS_DATES`** (`villes.js` et `terrain.py`, identiques, banc `test_les_autres_ponts_dates`) : Bordeaux, Garonne 1822 ;
  ponts de pierre de Libourne (Dordogne) 1824, Bergerac (Dordogne) vers 1825, Agen (Garonne) 1827 ; ponts suspendus de
  Sainte-Foy-la-Grande (Dordogne, à Port-Sainte-Foy) 1829, Langon (Garonne) 1831, Tonneins 1833, La Réole (pont du Rouergue)
  1835, Marmande 1838 (1836 selon d'autres sources), Cubzac (Dordogne, `Saint-André-de-Cubzac`) 1839 ; Cadillac 1835,
  **date approximative** (non trouvée). Sources : Bridgemeister (Langon, Tonneins, Marmande, Port-Sainte-Foy, La Réole),
  geneawiki (La Réole).
- Avant la date : sur la carte, un bac (`map.js`, `passes`, l'année de la ville la plus proche du passage, à moins de 5 km :
  Cubzac est à 4,6 km de son pont) ; dans une bataille, un pont de bateaux (à moins de 5 km de la ville, au lieu de 2 ; le
  dessin seul change, toutes versions de carte) ; dans l'intérieur, pas de pont, et les charrettes s'arrêtent au bac (elles
  roulaient sur la Garonne à Bordeaux avant 1822 : `interieur.js`, `jusquAuBac`).
- **La route de Libourne passe la Garonne** : `geo.py` ne retenait qu'un passage par route (la Dordogne) ; chaque route garde le
  passage de sa règle (`bx`, `river`) et note les autres grandes rivières que son tracé passe (`ponts`) : la carte y pose aussi
  un pont ou un bac (routes de Bordeaux à Libourne et à Cubzac : la Garonne ; cinq routes des Landes : le Gave de Pau, la
  Midouze). La règle du jeu (attente au bac, sapeurs, crue) reste celle d'un seul passage par route.
- Écart : deux routes qui passent la même rivière près d'une ville ont chacune leur pont (Libourne : routes de Bordeaux et de
  Créon) ; le pont de l'Isle à Libourne n'est pas daté.

## Livré — le trafic des routes

Avant : un voyageur tous les 1,1 km de route royale (2,2 km de chemin), partout pareil : une voiture visible tous les 2 à 3 km.

- **La circulation** (`vie.js`, `majEtat` : `r.villes` ; `vieDePres`), estimations pour la fin du XVIIIe siècle :
  - aux portes d'une ville de pop habitants, Q = 300 (pop / 110 000)^0,6 voitures par jour sur une route royale : Bordeaux
    300 (plusieurs centaines aux portes), Bayonne 80, Libourne 60, un bourg de 3 000 35, un village de 700 14 ; le tiers sur
    un chemin ; jour de marché (la chaîne du commerce) × 1,5, foire (l'événement de l'état) × 2,5 ;
  - elle s'éteint vers la campagne sur λ = 2 + 4 √(pop / 110 000) km (Bordeaux 6 km, Libourne 3, un village 2,3), comptée
    depuis la porte (le rayon de la ville) ;
  - le passage d'un bout à l'autre : 40 voitures par jour sur une route royale (trois ou quatre à l'heure), 4 sur un chemin ;
  - en voyageurs par km de route (piétons et cavaliers compris, 60 % de voitures ; douze heures de jour, 5 km/h) : Q / 36.
    Aux portes de Bordeaux, 8 voyageurs par km (5 voitures), 3 à 6 km ; en pleine campagne, 1,1 sur une route royale (une
    voiture tous les 1,5 km), 0,1 sur un chemin.
  - les voyageurs d'une ville vont et reviennent (jusqu'à D, tiré pour que la foule décroisse en e^(−d/λ)) : rien ne paraît
    ni ne disparaît au milieu de la route ; le pays déserté (siège, bataille, nuit, mauvais temps) comme avant.
- **Le coût** : rien n'est calculé sous le pixel (le genre d'abord) ; une voiture de moins de 6 px de long est une tache de sa
  couleur sur la route, d'un tracé par couleur. Mesures (`integration/villes-denses/h3v.cjs`, la scène de `vie3/h3.cjs` plus
  z 450 et z 1 300, à Bordeaux et sur la route de Belin à 2,5 km ; médianes de 120 images, deux passes, deux séries, avant →
  après) : z 450 Bordeaux 2,5 / 2,5 et 2,6 / 2,5 → 2,7 / 2,6 ms ; z 450 route 1,9 / 1,9 et 2,1 / 1,9 → 1,8 / 1,8 ; z 1 300
  Bordeaux 2,9 / 2,0 et 2,2 / 2,0 → 2,5 / 2,4 ; z 1 300 route 1,3 / 1,2 et 1,2 / 1,1 → 1,4 / 1,5 ; ailleurs dans le bruit.
- Banc : `vie.test.mjs` (une ville plus qu'un village, une capitale plus loin, la foire attire du monde).

## Livré — les figures lisibles

À la vraie taille, on ne distinguait plus personne sur les routes. Toutes les figures (gens, chevaux, voitures, bateaux,
bêtes, soldats) grossissent d'un même facteur k = max(1, P / (0,6 m × pixels par mètre)), P = 4,5 px (décision du joueur : « plus gros, mais pas de trop » ; `ambiance.js`,
`kFig`, `echelle(z)` à chaque image : `U` = k × `FIG` / 1000) : une personne fait toujours au moins 4,5 px, une charrette
36, et les proportions entre figures restent vraies. k vaut 53 à z 110, 13 à z 450, 4,5 à z 1 300 ; dans l'intérieur
(`Scene.ech`), 1 au plus près (6 px/m). 5 px faisaient une charrette de 460 m à z 110.
- Restent à la vraie taille (`vraie`, ou `s / K`) : bâtiments, rues, routes, plans ; étals, marchés et foire ; maisons,
  échafaudages et grue des chantiers ; tentes et feux des camps et du siège, gabions ; fermes, tertres, cabanes
  tchanquées et carrelets. Les vignettes des champs (moisson, estive, labour…) grossissent entières.
- `Z.VIE` = 110 (comme avant « le zoom de la vie ») ; `GENS` et `CHEVAL` dès la vie.
- Pas de tas, et un coût borné : un voyageur sur k / 6 (une figure tous les 120 px aux portes de Bordeaux, à tout zoom), à
  k m de l'axe ; un kilomètre de champs sur k / 12 (un quart à z 110), moins de bêtes par troupeau ; un blessé, prisonnier,
  fourgon, mort, danseur sur k / 10, un ouvrier sur k / 20.
- La colonne garde sa vraie longueur (s'allonger de k la ferait 12 km pour 600 hommes à z 110) : sur sa bande, un fantassin
  tous les 0,8 k m (un pour 3 k hommes), un cavalier tous les 3 k m.
- Mesures (`integration/vie3/h3.cjs`, médianes de 120 images, deux passes, avant → après) : z 110 Bordeaux 2,1 / 1,8 →
  2,5 / 2,5 ms, champ 2,1 / 2,1 → 2,6 / 2,6, siège 2,5 / 2,3 → 2,6 / 2,5 ; z 450 2,3 / 2,3 → 2,5 / 2,7 ; z 1 300 2,4 / 1,9 →
  2,1 / 2,2. Captures : `integration/figures/`. Banc : `echelle.test.mjs`.

## Livré — petits défauts de la relecture

- Les bornes (27 cm, une par kilomètre des routes royales empierrées) et les balises du chemin de halage n'étaient jamais
  dessinées (`vue(z, 1,8)` demande 3 704 px/km, `Z.MAX` vaut 1 300), ni les ouvriers des chantiers (`vue(z, 4,3)`) : de la
  vie (`Z.VIE`), chacun est un point d'un pixel, blanc pour la borne, rouge pour la balise, de son habit pour l'ouvrier
  (`travaux.js`, `point`) ; au-delà de 4,3 unités par pixel (jamais à la vraie taille), l'ouvrier dessiné comme avant.


## Livré — les rivières affinées, les villes à leur vraie place

Décision du joueur : des rivières au vrai tracé, et les villes à leur vraie place, pour que les routes et les armées
arrivent à la ville et non dans ses faubourgs (la carte du jeu change : les distances bougent un peu).

- **Les sauvegardes** (étude d'abord) : une sauvegarde référence la géographie par les numéros des lieux (l'ordre de
  `PLACES`, inchangé) et des arêtes (l'ordre des paires de lieux, qui change dès qu'une route naît ou disparaît), les
  positions sur une arête (`edge.pos`, en km de sa longueur), les `x`, `y` des armées, la crue (`crue.spans`, recalculée
  d'après la carte), et les batailles en cours, refaites au chargement d'après la carte (les versions figées,
  `terrain.VERSION`, ne figent que le code). Convertir au chargement aurait laissé les batailles en cours changer sous
  les troupes. Retenu : **une version de la géographie dans la sauvegarde** (`geo.VERSION`, clé `geo` ; absente : 1).
  Une ancienne partie se charge sur la carte d'alors (`game/data/geo_v1.json`, figé, avec la place d'alors des villes
  déplacées ; son cache `map_cache_v1.json`, refait au premier besoin, 5 s sur un PC) : mêmes routes, mêmes armées sur
  leurs arêtes, même crue (27 routes), mêmes cartes de bataille. Le serveur fait chaque carte au premier besoin
  (`App.geo_for`) et sert à la page celle de la partie en cours (`/api/map`, `geo`) ; l'état dit la géographie de la
  partie (`geo`) : la page se recharge sur la bonne carte (« Cette partie a sa propre carte »). Les nouvelles parties, le
  mode Bataille : la géographie 2. Une modification du calcul de `geo.py` change aussi la carte des anciennes parties
  (d'où l'empreinte du banc). Bancs : `test_serveur` (une sauvegarde sans `geo` : la carte d'alors et son empreinte,
  l'armée sur la route de Libourne à sa place, 27 routes coupées, la page reçoit la géographie 1) ; `test_plan_ville`
  (les cartes de bataille des versions 4 à 7 sur la géographie 1, et l'empreinte de Libourne en version 7).
- **Les rivières** (`game/data/geo.json`) : d'OpenStreetMap (Overture, octobre 2026), le cours principal de chacune (du
  départ d'avant au bout de son lit), simplifié à 60 m (Douglas-Peucker), chaque affluent coupé au plus près de sa rivière
  et raccordé à elle ; 572 → 6 838 points, la carte envoyée au navigateur 82 → 121 Ko compressée. Garonne 426 → 512 km,
  Dordogne 241 → 289, Adour 236 → 303, Isle 175 → 253, Lot 131 → 189, Baïse 128 → 182, Dropt 81 → 121 (avec le Drot),
  Midouze 39 → 42, Nive 50 → 68 (elle traverse Bayonne jusqu'à l'Adour) ; le second « Isle » d'avant (un bout de son
  cours d'amont) devient l'Auvézère ; la Charente (surtout hors de la carte, données partielles) et la Dordogne d'amont
  (hors de la carte) comme avant ; le Gave d'Ossau a un trou de 4 km dans les données, vers Bielle (en ligne droite).
- **Les villes à leur vraie place** (`places.py`) : les 40 villes dessinées au bord de l'eau (celles dont le plan était
  décalé, `site`) au point de la localité d'OSM, puis à leur site (le centre du plan, la rive au pied des murs) : leur
  nœud est là où leur plan est dessiné, `site` n'y décale plus que de 1 à 10 m (il reste pour la carte des anciennes
  parties). Les villages et les villes loin de l'eau gardent leur nœud (centre de la commune, IGN).

  | Ville | Rivière | Nœud → axe de la rivière, avant → après | Plan décalé, avant → après | Bord de la ville → eau, avant → après |
  |---|---|---|---|---|
  | Langon | Garonne | 1 985 → 460 m | 0 → 2 m | 1 523 → 0 m |
  | Montpon | Isle | 1 825 → 291 m | 0 → 3 m | 1 537 → 0 m |
  | Saint-Sever | Adour | 2 260 → 515 m | 0 → 3 m | 1 741 → 0 m |
  | Sainte-Livrade | Lot | 2 092 → 369 m | 0 → 6 m | 1 728 → 0 m |
  | Domme | Dordogne | 2 126 → 329 m | 0 → 8 m | 1 788 → 0 m |
  | Mussidan | Isle | plus de 2,6 km → 288 m | 0 → 0 m | — → 0 m |
  | Marmande | Garonne | plus de 2,6 km → 591 m | 0 → 3 m | — → 0 m |
  | Bayonne | Adour (la Nive au travers) | 1 792 → 521 m | 1 268 → 3 m | 0 → 0 m |
  | Agen | Garonne | 1 413 → 503 m | 912 → 3 m | 0 → 0 m |
  | Libourne | Dordogne, Isle | 1 330 → 463 m | 870 → 3 m | 0 → 0 m |
  | Dax | Adour | 1 544 → 403 m | 1 142 → 1 m | 0 → 0 m |
  | Aire-sur-l'Adour | Adour | 1 326 → 464 m | 864 → 2 m | 0 → 0 m |
  | Sainte-Foy-la-Grande | Dordogne | 1 259 → 301 m | 947 → 10 m | 0 → 0 m |
  | Villeneuve-sur-Lot | Lot | 1 222 → 394 m | 828 → 1 m | 0 → 0 m |
  | Aiguillon | Lot | 1 199 → 385 m | 736 → 3 m | 0 → 0 m |
  | Tonneins | Garonne | 1 180 → 591 m | 586 → 4 m | 0 → 0 m |
  | Coutras | Isle | 957 → 328 m | 632 → 2 m | 0 → 0 m |
  | Bordeaux | Garonne | 869 → 1 088 m | 224 → 4 m | 0 → 0 m |
  | Périgueux | Isle | 718 → 347 m | 369 → 2 m | 0 → 0 m |
  | Bergerac, Cadillac, La Réole, Lalinde, Pau, Orthez, Oloron, Peyrehorade, Navarrenx, Sauveterre, Fumel, Terrasson, Mont-de-Marsan | leur rivière | 30 à 490 → 180 à 460 m | 19 à 345 → 1 à 8 m | 0 → 0 m |

  (« Bord → eau » : du mur, ou de l'emprise d'une ville sans murs, à la rive, après le décalage du plan ; au-delà de
  1,35 km, le plan n'était pas décalé. Saint-André-de-Cubzac, à 2,3 km de la Dordogne, reste loin de l'eau, comme en vrai.)
- **Les routes suivent** (`geo.py`, géographie 2 seulement) : elles partent des nouveaux nœuds (le pont ou le bac au pied
  de la ville : 81 des 139 ponts dessinés à moins de 1 km d'une ville, 58 sur 140 avant) ; la règle du passage (la ligne
  droite) ne compte plus une rivière qu'elle coupe un nombre pair de fois (ses méandres : la ligne reste sur sa rive) ; le
  pont dessiné (`bx`) est celui de la rivière de la règle s'il est sur le tracé (la route de Bordeaux à Libourne : la
  Dordogne, la Garonne dans `ponts`) ; une route royale passe une case de côte (Bayonne – Saint-Jean-de-Luz, perdue
  sinon) ; la route de Bazas à La Réole est gardée (`EXTRA_ROADS` : Langon, à sa vraie place, la cachait au maillage).
  500 routes (498 avant) : naissent Urdos – Laruns et Mauléon – Sauveterre-de-Béarn. 80 routes changent de rivière à
  passer, dont 22 pour l'attente au bac (rang 1 : 77 → 79 routes) : Bergerac – Monbazillac, Sainte-Foy – Bergerac, Nérac –
  Port-Sainte-Marie la passent désormais, Bergerac – Vergt, Agen – Port-Sainte-Marie, Lalinde – Sainte-Alvère plus (elles
  restent sur leur rive) ; Peyrehorade – Bayonne passe le Gave de Pau au lieu de l'Adour.
- **Les distances par les routes** (plus court chemin, 153 paires de 18 villes principales) : écart moyen 0,3 %, au plus
  2 % (Pau – Oloron 24,5 → 25,0 km, Langon – Marmande 40,2 → 39,4) ; Bordeaux – Libourne 31,5 → 31,3, Bordeaux – Bayonne
  190,5 → 191,6, Bordeaux – Agen 144,5 → 145,0, Bordeaux – Pau 205,5 → 206,0. Aucun écart de plus de 5 % entre villes
  principales ; entre toutes les places, 51 paires sur 24 753, toutes raccourcies par les deux routes nouvelles (Urdos –
  Laruns 29,9 → 18,7 km, Mauléon – Sauveterre 31,2 → 21,9).
- **Les voies d'eau** suivent les méandres : 1 266 → 1 405 km de tronçons (Bordeaux – Agen 165 → 175 km, + 6 % ; Bordeaux
  – Langon + 7 % ; Bordeaux – Bergerac 159 → 183, + 15 % ; Dax – Mont-de-Marsan 56 → 86, + 54 % ; Bayonne – Dax + 2 %) ;
  quais à moins de 3 km de leur rivière : gagnés Layrac, Meilhan-sur-Garonne, Hinx, Lamonzie-Saint-Martin ; perdus
  Saint-Martin-de-Seignanx, Saint-Hilaire-de-Lusignan, Ambarès-et-Lagrave, Castelculier.
- **La crue** (`crue.py`, même règle) : 29 routes coupées dans les nouvelles parties, 27 dans les anciennes ; peinte dans
  les tuiles d'après les mêmes rivières (`terre.js`, `inonde` ; banc `travaux.test.mjs`).
- **Batailles** : pas de nouvelle version (`terrain.VERSION` 7 : le code ne change pas ; une bataille d'une ancienne
  partie a sa carte d'alors). Les plans des villes (`villes.js` et `plan_ville.py`) restent identiques sur la nouvelle
  carte (669 états, banc).
- **Relecture** :
  - le coût par image : le courant des fleuves (`ambient.js`, `drawFlows`, z 3,5 à 18) en morceaux de 48 pas avec leur
    emprise, seuls ceux de la vue tracés (3 441 sommets à chaque image sinon) ; les gabares et les radeaux placés par
    dichotomie sur les longueurs cumulées de leur rivière (`vie.js`, `surCumul`). Mesures (`vie3/h3.cjs`, médianes de
    120 images, deux passes, dpr 1 ; main → branche) : z 26 Bordeaux 2,7 / 2,6 → 2,5 / 2,4 ms, z 110 Bordeaux 2,2 / 2,9 →
    1,9 / 1,9, champ 2,3 / 2,3 → 2,1 / 1,9, siège 2,6 / 2,8 → 2,3 / 2,5, z 320 2,4 / 2,2 → 2,2 / 2,0. Le reste de l'écart
    mesuré d'abord à z 26 (la couche sol, 0,35 → 0,8) venait de la scène : sur la nouvelle carte, `h3.cjs` pose l'armée
    A1 plus loin sur la route de Bordeaux (`fr1` 0,7 au lieu de 0,4, d'après le territoire de Bordeaux, qui a bougé), sa
    trace piétinée est plus longue ; à `fr1` égal, la couche sol fait 0,36 à 0,42 ms (0,32 sur main) ;
  - la construction à froid (`geo.py`, les passages des routes) : les rivières en morceaux de 48 segments avec leur
    emprise, on ne cherche l'eau que là où passe la route (même carte, à l'octet) : carte 2, 8,4 → 4,6 s ; carte 1, 4,9 →
    4,6 s. `/api/load` fait la carte d'une ancienne partie hors du verrou de la partie (`App.geo_lock`, une seule fois) :
    les autres appareils continuent (`/api/saves` répond en 90 ms pendant les 5,6 s du chargement à froid) ; la sauvegarde
    automatique d'une ancienne partie fait sa carte au démarrage ;
  - la carte 1 vraiment figée : la case de côte des routes royales et la route de Bazas à La Réole (`EXTRA_ROADS_2`) en
    géographie 2 seulement ; l'empreinte du banc couvre ce que la page reçoit (`client_payload`, rails) et les cases des
    routes, la même que sur main ;
  - le rechargement sur la carte de la partie : `/api/new` et `/api/load` disent sa géographie ; si ce n'est pas celle de
    la page, elle note la reprise (`sessionStorage`, `conquete.reprise`, avec le tutoriel s'il était demandé) et se
    recharge ; au retour, elle reprend la partie (ni l'intro ni l'écran de départ) et relance le tutoriel ;
  - l'attribution (ODbL) : « Rivières et position des villes : © les contributeurs d'OpenStreetMap (ODbL), via Overture
    Maps » sur l'écran de départ et dans le README, qui dit aussi que `geo.json` et la place des villes au bord de l'eau
    forment une base dérivée sous ODbL.
- **Décisions du joueur** (géographie 2) :
  - les routes tracées à la demi-case (`geo.py`, `_route_f` : les rivières rastérisées à 500 m pour le tracé ; le bruit
    des routes au km) : elles passent entre les méandres serrés. À Libourne, les routes de Bordeaux, Créon et Izon passent
    la Dordogne au pied de la ville (460 à 530 m du nœud, 2,4 km en amont avant) ; Libourne – Izon, 12,9 km de tracé pour
    8,9 à vol d'oiseau (19,5 avant), en contournant la boucle de Vayres ; détour moyen des tracés 1,05 → 1,02, aucun au-delà
    de 1,5 ; 83 ponts sur 139 à moins de 1 km d'une ville. Le banc des ponts datés regarde de nouveau Libourne (pont de
    bateaux en 1800, de pierre en 1830 ; ses trois routes passent au pied de la ville). Construction à froid de la carte 2 :
    7,1 s (5,0 sur main) ;
  - pas de route Urdos – Laruns (`NO_ROADS_2`) : 499 routes (498 avant ; naît Mauléon – Sauveterre-de-Béarn) ;
  - les gabares gardent les méandres, sans compenser leur vitesse ;
  - les autres lieux restent à leur nœud ; seul Le Bugue, dont le nœud tombait dans le lit de la Vézère (aucun îlot), est
    porté à 216 m, sur sa rive (géographie 2 ; `geo_v1.json` garde sa place d'alors, la carte 1 ne change pas).
  Crue des nouvelles parties : 26 routes coupées (27 dans les anciennes) ; attente au bac (rang 1) : 77 → 79 routes ;
  80 routes changent de rivière à passer, dont 22 de rang 1. Distances par les routes entre les 18 villes principales :
  écart moyen 0,3 %, au plus 2 % (aucun au-delà de 5 %) ; entre toutes les places, 43 paires sur 24 753 au-delà de 5 %,
  toutes raccourcies par Mauléon – Sauveterre. Coût par image (`vie3/h3.cjs`, main → branche, l'armée A1 à la même place) :
  z 26 Bordeaux 3,2 / 2,8 → 2,6 / 3,3 ms, z 110 Bordeaux 2,7 / 2,2 → 2,3 / 2,2 (dans le bruit). Capture :
  `integration/rivieres2/1-libourne-routes-z110.png`.
- Captures (`integration/rivieres/`, une partie neuve préparée, aucun tour joué) : `1-bayonne-nive-adour-z170.png` (la Nive
  au travers de la ville jusqu'à l'Adour, les routes à la ville), `2-langon-z220.png`, `3-saint-sever-z220.png`,
  `4-agen-routes-z320.png` (les routes de l'autre rive passent la Garonne au pied des murs), `5-ensemble-z2.png`,
  `6-bayonne-interieur.png`.
- Écarts :
  - (fait depuis, « Décisions du joueur ») à Libourne, les routes de Bordeaux, Créon et Izon passent la Dordogne à 2,4 km en amont (vers Condat) : entre les
    méandres serrés, la grille d'un km du tracé ne trouve pas de passage unique au pied de la ville ; la carte d'une bataille
    à Libourne n'a plus qu'un pont de bateaux (le banc des ponts datés regarde Bergerac) ; la route d'Izon fait 19,5 km
    pour 8,9 à vol d'oiseau ;
  - Urdos – Laruns, d'une vallée à l'autre par la montagne (le relief des Pyrénées suit les gaves affinés) : à garder ou
    à retirer ;
  - les gabares vont plus lentement d'un port à l'autre (les méandres) ;
  - Beynac (au pied de son château, sur la Dordogne) : une place bastionnée y serait presque toute dans l'eau ; Domme
    bastionnée a des rues de l'autre côté de la Dordogne ;
  - les villages au bord de l'eau gardent leur nœud (Saint-Pierre-d'Eyraud à 2,6 km de la Dordogne, Barbaste à 4,2 km de
    la Baïse) ; les villes loin de l'eau aussi (Morcenx à 3,7 km de sa localité).
