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
  | à partir de 110 | la vie : gens, bêtes, colonnes |
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
  sélecteur d'heure (quatre boutons `aria-pressed`, rangés à gauche du dernier bouton de `#zoombar`).
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

- Serveur (décor seulement, aucune règle changée) : un champ de bataille garde son vainqueur et ses prisonniers
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
  - **routes coupées par la crue** : une fois par crue, là où une route passe plus de 240 m dans les prés noyés, loin
    des places : l'eau sur la chaussée dès z 40, une charrette arrêtée devant dès `Z.VIE`. **Purement visuel** (la
    crue du serveur ne ralentit que les bacs : couper les routes changerait la marche des armées) ;
  - **feux des Landes** (`feuxDe`) : le panache noir de loin, les flammes sur la lisière dès z 10, la lueur (`LUM`,
    aussi de jour).
- Tuiles (`terre.js`, `ambiance.js`), dans `cleTuiles` : **crue** (`AMB.crue` : `flood` de l'état, ou les hautes eaux de
  mars et avril ; pas la pluie du jour, qui repeindrait les tuiles à chaque averse) : les prés bas (altitude approchée < 0,11) à moins de 0,25 à 1,35 km de
  la Garonne et de la Dordogne (`Terre.CRUE`, distance au fleuve par case, `inonde`) sous une eau trouble, sans
  parcelles ni arbres ; **brûlis** (`feuDe`, `brule`, `FEU_K` = 7 km, `FEU_MOIS` juin à novembre) : un carré de 7 km
  sur sept a son feu de l'année, allumé en juin, juillet ou août, de 0,5 à 1,6 km de rayon, noir sans arbres jusqu'en
  novembre, dans la pinède (forêt et lande). `AMB.mois` vient de la date de l'état ; la clé change chaque mois de juin
  à novembre (le fond et les tuiles se repeignent une fois par mois, comme au changement de saison).
- `carte/ciel.js` : **gaz** (`factions[].mk` `gaz`) : la nuit, le halo des villes du camp plus blanc (sprite `gaz`) ;
  dès `Z.PLAN`, des réverbères blancs tous les 70 m le long des rues du plan, entre les maisons seulement
  (`reverberes`).
- Bancs : `tests/travaux.test.mjs` (chantiers, produits, cordons, grands travaux, crue, réverbères, sur la vraie
  carte), `guerre.test.mjs` (nouvelle et fêtes, estafettes, prisonniers, traînards, avancée du siège), `terre.test.mjs`
  (crue, feux, clé des tuiles).
- Écarts : estafettes, prisonniers et traînards seulement au plus près (`Z.VIE`), comme les blessés de G ; le moral
  des armées étrangères est caché, leurs traînards ne se voient qu'en retraite ; les produits ne se voient que dans les
  places du joueur (`sl` n'est envoyé que pour elles) ; les grands travaux des Ponts et Chaussées et du canal
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
