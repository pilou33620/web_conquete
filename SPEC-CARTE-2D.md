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
