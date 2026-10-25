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
