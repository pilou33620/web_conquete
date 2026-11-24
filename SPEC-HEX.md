# Spec : le rendu en plateau d'hexagones (style web_power)

## Pourquoi

Décision du 06/11/2026 : après les maquettes validées par le joueur (`web/js/dev/carte-hex.html`,
`web/js/dev/bataille-hex.html`), tout le rendu passe au plateau d'hexagones en 3D « cartoon » de web_power (GridMaster) :
tuiles en relief, ombrage à trois tons, contours sombres, maisons et arbres en volumes simples. On garde :

- la même géographie et la même échelle que le jeu (km sur la carte, mètres en bataille) ;
- toutes les animations de vie d'avant (passants, charrettes, bêtes, bateaux, moulins, fumées, oiseaux, nuages,
  marchés, travaux, guerre, ciel et heures du jour ; en bataille, bêtes, villageois, fumées et feux) ;
- l'interface, les gestes, les armées et les effets.

Le détail des villes, des villages et des bâtiments de bataille est plus poussé que sur les maquettes.

## Le moteur commun web_engine (18/11/2026)

Décision du 18/11/2026 : tout le moteur graphique du plateau passe sur la bibliothèque commune **web_engine**
(<https://github.com/pilou33620/web_engine>, `lib/`), celle de web_royaumes et de web_power. Elle est copiée dans
`web/graphismes/` (partie `rendu`, avec three.js r186) par `outils/maj-graphismes.sh`, vérifiée en CI
(`--verifier`) et mise à jour chaque lundi par `.github/workflows/graphismes.yml`. **Les graphismes se modifient dans
web_engine, jamais dans `web/graphismes/`.** Le rendu doux ci-dessous (moteur.js, modeles.js) est retiré ; le plateau
prend le style de web_engine : ombrage toon à trois tons, contours bruns, hexagones séparés et étagés, mer translucide,
forêts de sapins et feuillus, massifs de roche, parcellaire et épouvantails, rivières en rubans de sable et d'eau,
bâtiments d'époque (Ancien Régime, Lumières, Empire, Révolution industrielle) aux couleurs du camp.

- **Adaptateur** (`web/js/hex/plateau.js`) : même interface pour `map.js` qu'avant (`image`, `hauteur`, `rayon`,
  `territoire`, `colorer`, `papier`, `majLieux`, `lieux`, `g.f`). Il ne dessine rien : il traduit la carte et l'état.
- **Carte** (`web/js/hex/carte-moteur.js`) : les cases de 1 km au format de carte du moteur (terrain, forêts, champs,
  rivières). Le moteur bâtit toute sa carte d'un coup et vise quelques milliers de cases : on ne lui donne qu'une
  **fenêtre** autour de la caméra (1,5 fois l'écran, au plus 1 500 cases), en hexagones de 4 km de près, puis 8, 16 et
  32 km en s'éloignant (la France entière tient en hexagones de 32 km). La fenêtre est refaite quand la vue en sort ou
  qu'on zoome assez pour un niveau plus fin, une fois la caméra posée (0,5 à 1 s de calcul, surtout les arbres).
- **Caméra** : celle du moteur est en perspective ; l'adaptateur lui donne à chaque image la vue orthographique
  inclinée du jeu (ci-dessous), si bien que rien ne change pour les calques 2D. La boucle du moteur continue d'animer,
  mais l'image n'est dessinée que par la boucle de `map.js`, et seulement quand quelque chose a changé.
- **Places** : le cœur (palais, église, maison, citadelle) sur l'hexagone de la place, des quartiers sur les voisins
  pour les grandes villes, une tour si elle est fortifiée, la version incendiée après un pillage.
- **Routes** (23/11/2026) : les routes du jeu (`map.edges`) passent d'hexagone en hexagone (`carte-moteur.js`, `routesDe`)
  et sont tracées par `graphismes/rendu/routes.js` (chemins de terre, routes royales bordées d'arbres) sur les hexagones
  de 4 cases ; jamais sur l'eau, sans bout dans le vide, une seule fois par paire. Un pont seulement là où le serveur en a
  un (`e.bx`, `e.ponts`) hors des places : ni au gué, ni au bac, ni le long d'une rivière, ni dans une ville. Pas de ferme
  ni de moulin sur une route ; pas de champs sur un hexagone de route (le moteur les y poserait par-dessus). Sur la carte
  de l'Europe (hexagones de 20 km), les villes n'ont pas de quartiers sur les voisins.
- **Vie et fluidité** (23/11/2026) : la vie du plateau est celle du moteur (`graphismes/rendu/vie.js`, `faune.js`, `eau.js`),
  dans son style : passants des places, charrettes des routes, vaches, cerfs et sangliers des lisières, travaux des champs selon
  la saison, fermes et moulins, bateaux et barques, oiseaux, poissons, vagues des côtes. L'adaptateur lui donne les places, les
  bâtiments, les routes de la fenêtre (`majVie`), et l'heure et le temps sous la caméra (`majClimat`). La vie dessinée en 2D
  (`carte/vie.js` : figures, fumées, nuages, oiseaux, écume) ne sert plus qu'à la carte classique (sans WebGL). Le plateau est
  dessiné à chaque image quand les animations sont permises (30 images/s au plus en qualité légère), plus du tout quand rien ne
  change si elles sont coupées. La molette zoome en glissant (160 ms, le point sous la souris reste fixe), et le moteur reçoit
  l'état avec la carte (`construire(C, etat)`, web_engine 2.26.0) : il ne bâtit le décor qu'une fois, si bien que le temps
  d'arrêt quand la vue change de niveau de détail baisse de 35 à 60 %.
- **Plus de vie, moins d'arrêts** (23/11/2026, web_engine 2.27.0) : voyageurs entre les villes (charrettes, cavaliers, piétons),
  troupeaux de moutons avec berger et chien, barques sur les rivières ; les bâtiments posés sont animés par `animerPose`
  (graphismes/rendu/monde.js : fumées des cheminées, drapeaux, ailes des moulins). Le décor se bâtit 2 à 3,5 fois plus vite qu'en
  2.25.1 (`toon.js`) ; en dézoomant, la fenêtre est bâtie pour une vue 1,6 fois plus large au même niveau de détail, ce qui
  épargne une reconstruction sur quatre environ.
- **Plus d'arrêt au changement de vue** (23/11/2026, web_engine 2.28.0) : le moteur pose le décor (arbres, rochers, champs)
  par morceaux de 6 ms par image, du centre vers les bords (`decorProgressif`) ; seuls les cases, le relief, les rivières, les
  routes et les villes sont bâtis aussitôt. Sur toute la carte de l'Aquitaine, l'arrêt passe de 1,5 s à environ 0,3 s (mesures
  dans un conteneur sans carte graphique, plus lent qu'un PC), puis le décor se remplit en une seconde environ.
- **Armées de près** (24/11/2026, web_engine 2.32.0) : dès qu'un hexagone fait 64 px à l'écran (fenêtre de près, décor
  complet), chaque armée visible, la nôtre comme celles des autres camps, est un petit groupe de figurines 3D posé par
  `hex/armees.js` (`maillageTroupe` de `graphismes/rendu/modeles.js`) au lieu de la longue colonne et du bivouac dessinés en
  2D (`carte/guerre.js`) : porte-drapeau aux couleurs du camp, infanterie de ligne (piquiers en 1700, grenadier ensuite),
  tirailleurs, un ou deux cavaliers, un canon s'il y a de l'artillerie, d'après `armies[].armes` ; 10 figurines (6 en qualité
  légère ou quand la qualité automatique coupe les habitants) ; uniforme du palier de l'année (1703 silex, 1765 Gribeauval, 1793,
  1825, 1832). Au repos, en carré au bivouac (tentes, feu) sur un hexagone libre qui touche sa place, au sud d'abord, face à la
  caméra ; en marche (ordre en cours, ou la marche du tour rejouée : `disp`, `d.anim`), en colonne courte tournée vers où elle
  va, qui glisse sur son trajet en marchant au pas. Un groupe par armée, refait seulement quand sa composition, son allure, son
  camp ou son époque changent ; masqué de loin. Restent en 2D au-dessus : l'anneau de sélection, le nom et le tracé des ordres ;
  de loin, le jeton et la formation. En train, en bateau, en bataille ou au siège : comme avant.
- **Perdu pour l'instant** (à ajouter dans web_engine si on le veut) : le paysage des siècles sur le plateau (pinèdes,
  marais drainés, vigne roussie), les enceintes dessinées autour des villes, la teinte des territoires (restent les
  liserés), les étangs plus petits qu'un hexagone, la mer qui fonce vers le large.

## Le rendu doux (14/11/2026)

Décision du 14/11/2026, après les maquettes `web/js/dev/carte-douce.html` et `web/js/dev/bataille-douce.html` : le plateau
quitte l'ombrage « cartoon » pour un rendu doux, sur la carte comme en bataille. La géographie, l'échelle, la caméra
(orthographique, calée sur les calques 2D) et tout ce qui se dessine par-dessus ne changent pas.

- **Matière** : ombrage lisse (`MeshStandardMaterial`), rendu filmique, plus de contours sombres (`put` n'en fait plus ;
  c'est aussi moitié moins de sommets). Les volumes à peu de pans (toits, flèches, montagnes) gardent des faces franches,
  les houppiers et les haies sont ronds (`sphere`), les rochers à facettes (`caillou`).
- **Tuiles** (`moteur.js`, `tuiles`) : un seul maillage, dessus à bord biseauté, flanc seulement là où le voisin est plus
  bas. Chaque sommet a sa nuance (le sol varie doucement d'un endroit à l'autre) ; la couleur d'une tuile se réécrit sur
  ses sommets `[t.v0, t.v1[` (saisons, carte d'époque).
- **Eau** : fond sans biseau sous la nappe, mer qui s'assombrit vers le large (distance à la terre).
- **Territoires** : la teinte reste sur le dessus plat ; le liseré est double (sombre dessous, couleur du camp dessus),
  sans ombrage. Pas de liseré autour d'un hexagone du pays que personne ne tient (rivière, étang).
- **Troupes** (`troupes3d.js`) : mêmes pièces articulées, plus détaillées : basques et retroussis, veste, revers,
  buffleteries croisées, giberne, bras et parements, col, cheveux poudrés ou bruns, coiffures galonnées, guêtres et
  souliers, chevaux en volumes ronds, roues à rayons cerclées de fer, drapeau d'ordonnance à croix blanche.
- **Soleil** (`champ.js`, `heure`) : en bataille il suit l'heure (levé à l'est, haut à midi, couché à l'ouest, plus chaud
  le soir) et le temps qu'il fait, qui peut tourner pendant la bataille.
- **Après les coups** (`battle/errants.js`, dessinés par `troupes3d.js`) : chevaux sans cavalier, blessés qui rampent ou
  s'en vont en boitant, brancardiers ; l'épave d'une pièce démontée reste sur place (`champ.js`, `DEBRIS.epave`).
  Affichage seul, sans effet sur les règles.
- **Décor du champ de bataille** (`champ.js`, `decor`) : chaque parcelle porte sa culture selon la saison (labours, blé
  en herbe, blé mûr et ses coquelicots, foin et ses meules, chaume et ses gerbes), parfois un épouvantail ; sous-bois
  (jeunes arbres, buissons, fougères, souches, troncs couchés, rochers moussus, champignons et feuilles mortes à
  l'automne) ; vergers en quinconce, fruits, paniers, échelles ; vignes à échalas, rousses et chargées de grappes à
  l'automne, ceps nus l'hiver ; landes à bruyère et ajoncs ; marais à nénuphars et quenouilles ; fleurs des prés ;
  roseaux au bord de l'eau, pierres du gué, bornes et calvaires au bord des routes. Les arbres roussissent à l'automne.
- **Vie de la carte** : passants, charrettes et bêtes se posent sur le relief du plateau (`ambient.js`, `sc.haut`).

Règles ajoutées le même jour (moteur) : la fumée de la poudre noire gêne le tir (`battle.py`, `SMOKE_*`), un bataillon
qui part en déroute au contact perd son drapeau (`FLAG_*`), le temps tourne pendant la bataille (`WX_CHANGE`), la boue
dure après la pluie en campagne (`rules.py`, `MUD_*`). Les sons sont synthétisés (`web/js/son.js`), coupés par défaut.

## Le seul rendu

Depuis le 06/11/2026, le plateau est le seul rendu proposé, sur la carte comme en bataille : le choix du style de la
carte a quitté le menu. Sans WebGL, le jeu revient de lui-même au rendu d'avant (vue du ciel, vue de dessus en bataille),
avec un avertissement dans la console : c'est un secours, pas un choix.

## Fichiers

| Fichier | Rôle |
|---|---|
| `web/graphismes/` | La bibliothèque graphique web_engine (copie, ne pas modifier ici) : `rendu/` (scène, plateau, modèles…) et `three/` |
| `web/js/hex/grille.js` | La grille d'hexagones (`Grille`) et la projection inclinée (`K`, `C`, `versEcran`, `versJeu`), sans three.js |
| `web/js/hex/carte-moteur.js` | La carte du jeu au format du moteur : niveaux de détail (`Niveau`), fenêtre (`cadrer`, `fenetre`) |
| `web/js/hex/plateau.js` | L'adaptateur : la carte de campagne dessinée par le moteur web_engine, caméra calée sur celle du jeu |
| `web/js/hex/armees.js` | Les armées de près en figurines 3D de web_engine (`maillageTroupe`) : composition, allure, cap, place près des villes |
| `web/js/hex/qualite.js` | La qualité automatique du plateau : paliers (définition, ombres, habitants, décor, vie, cases, cadence) et régulateur (SPEC-EMPIRE, « Chargement et fluidité ») |
| `web/js/hex/champ.js` | Le champ de bataille : hexagones de 40 m, décor, routes, ponts, haies, clôtures, bâtiments (états du serveur), enceinte, barricades, cratères |
| `web/js/hex/troupes3d.js` | Les troupes en figurines 3D instanciées, posées par la logique de `battle/troupes2d.js` |

## Comment les calques 2D tombent sur le plateau

La scène 3D est sur un canevas WebGL **sous** le canevas 2D du jeu, qui devient transparent. La caméra 3D est
orthographique, inclinée d'un angle fixe (direction (0 ; 0,83 ; 0,56), comme web_power), et calée sur la caméra 2D
(`{x, y, z}`). Le sol se projette alors par une affinité :

```
sx = (x − cam.x)·z + vw/2
sy = (y − cam.y)·z·K + vh/2 − h·z·C        K = sin(élévation) ≈ 0,83, C = cos(élévation)
```

Tous les calques 2D appliquent ce `K` sur l'axe vertical : `map.js` (`toScreen`, `toWorld`, gestes, cadrage),
`ambient.js` et `carte/vie.js` (`sc.k`), `carte/guerre.js`, `carte/ciel.js` ; en bataille `battle/camera.js` (`vp.k`),
`battle/vue.js` (`view.k`, `view.monde`), `battle/effets.js`. Avec `K = 1` (autres styles), tout est comme avant.
`toScreen` de la carte ajoute la hauteur du plateau (`h`), pour poser les étiquettes et les armées sur le relief.

## Carte de campagne

- Un hexagone prend le terrain, le département et la rivière majoritaires des cases de 1 km qu'il couvre ; plaine ou
  prairie selon un bruit ; hors des cinq pays, couleurs passées vers le parchemin. Les vallées des rivières sont à plat.
- Saisons : neige en hiver (partout en montagne, en plaine s'il a neigé), roux en automne, blé mûr en été.
- Territoires : une teinte légère de chaque hexagone et un liseré aux couleurs du camp le long des frontières, d'après
  les mêmes cases que la carte d'avant (`cellFac`).
- Places (`majLieux`, refaites quand changent le camp, les remparts, les agrandissements, la brèche ou le siècle) :
  village (maisons, église, vergers, parfois un moulin, palissade s'il est fortifié) ; ville (place, fontaine, église ou
  cathédrale, halle, maisons serrées façade sur la rue, faubourgs sur les hexagones voisins, enceinte centrée sur le cœur
  et les faubourgs, quai et barques pour un port, cheminée d'usine au XIXe siècle) ; chef-lieu (sur 3 à 7 hexagones,
  château à Pau) ; fort (étoile, fossé, casernement). Toits noircis selon la brèche du siège.
- Pays : forêts (sapins en Béarn), landes (pins maritimes, bruyère, maison de résinier), marais, collines (moulins),
  montagnes enneigées, plaines en lanières et fermes à cour, vignes et chais, dunes, peupliers au bord de l'eau, ormes
  le long des routes royales.
- Animations de la carte gardées sur le plateau : drapeau du maître de chaque place qui flotte (en berne, en fête),
  habitants sur la place et pigeons au clocher (`towns.js`, `animer`), courant des fleuves et écume de la mer
  (`ambient.js`), ailes des moulins 3D qui tournent (le plateau se redessine alors 15 fois par seconde, dès 15 px/km).
- Vie : figures grossies 4 fois (`carte/ambiance.js`, `echellePlateau`), visibles dès 60 px/km ; zoom limité à 240 px/km.
- Le décor se bâtit par paquets pendant les premières images (8 ms par image).
- Étangs et lacs trop petits pour faire un hexagone d'eau : une mare par case d'eau de 1 km, avec sa grève et ses
  roseaux ; rien ne s'y bâtit.
- Le paysage des siècles (`epoque.js`, 2c), selon les marques du camp qui tient chaque hexagone : les semis de pins
  doublent les pins de la lande, la loi de 1857 la change en pinède (trois fois plus de pins, teinte plus verte) ; le
  drainage ne laisse au marais qu'une mare, des fossés et des peupliers ; le phylloxéra roussit les rangs de vigne de
  1875 aux plants greffés (certains arrachés) ; le maïs, haut et vert, en Chalosse et en Béarn ; la luzerne et la
  betterave de l'assolement. Seuls les morceaux du décor qui changent sont refaits (`Plateau.paysage`).
- Villes : la ville jouet à toute distance (zoom limité à 240 px/km). Les maisons font le tour de la place et
  s'alignent en rangs serrés, façade sur la rue, le long du vrai tracé des routes qui entrent (un second rang derrière),
  le reste entre elles ; rien sur les routes ni dans l'eau. Les villages s'alignent de même le long de leur route.
  L'état les abîme comme la carte d'avant : maisons brûlées par l'incendie, ruines (murs à mi-hauteur, un pignon
  debout) du siège et des combats passés, toits noircis par le canon. (Un essai de vrai plan à l'échelle, de près, a
  été retiré : ses maisons de dix mètres juraient avec le plateau.)
- Teintes de la carte (Réglages) : « Nature », ou « Carte d'époque » : les tuiles au lavis de Cassini, puis de
  l'état-major à partir de 1818, et le plateau passé au sépia.

## Batailles

- Un hexagone de 40 m prend le type de case majoritaire (routes, chemins et gués mis à part, tracés à leur place) et la
  moitié de la hauteur moyenne.
- Bâtiments : chaque case bâtie de la ville porte une maison (2 ou 3 étages), façade vers la rue ; bâtiments isolés à
  leurs vraies dimensions ; grands bâtiments du plan (église, cathédrale, caserne, couvent, hôpital, hôtel, halle,
  château, forge, scierie, séchoir, poudrière, moulin aux ailes qui tournent). L'état envoyé par le serveur (`bati` :
  touché, en feu, ruine) refait le bâtiment ; les feux et la fumée restent ceux de `decor2d.js`.
- Enceinte : mur et tours, ou tracé bastionné avec fossé, parapet gazonné et pavillons d'entrée ; demi-lunes ; les
  brèches deviennent des gravats ; barricades (charrettes, tonneaux, planches) ; palissade de village.
- Troupes : une figurine par figure de `troupes2d.js` (même budget, mêmes dispositions, mêmes poses) : coiffures de
  l'époque, habits du camp, fusil qui suit la pose (épaule, joue avec recul, baïonnette, baguette), cavalerie, pièces
  qui reculent, avant-trains, caissons, drapeaux. Les tués restent couchés sur le plateau.
- Restent en 2D au-dessus : la vie des champs, fumées et feux (`Decor2D.vivant`), effets et atmosphère, ligne de vue,
  tracés des ordres, fanions, étiquettes, interface.

## Limites connues

- Bois : au-dessus des régiments, les arbres sur leur emprise s'ajourent un à un en fondu (trame de Bayer dans le
  shader des arbres et de leur ombre, `Champ.eclaircir`), de même les haies et les arbres des cours de ferme
  (`Champ.ouvrable`) ; les bâtiments restent pleins.
- Débris (chapeaux, fusils, sacs, roues brisées) et cratères en 3D, d'après les pertes (`Champ.debris`, vus dans une
  vraie bataille) ; ceux d'avant un rechargement ne reviennent pas. Neige : toits, murs, haies, barricades et arbres poudrés, sapins blancs.
- Figurines : jambes des chevaux au pas, au trot et au galop ; sabre tiré à la charge et en mêlée, épée des officiers ;
  refouloir des servants entre deux coups, pointeur penché, recul au coup ; postillon (chapeau rond, rênes, fouet) sur
  le cheval de gauche de chaque paire d'attelage ; rênes des cavaliers ; baguettes du tambour qui battent.
- La boue du piétinement (`battle/pietinement.js`) est posée en texture sur le dessus des hexagones de terre
  (`Champ.boue`) ; elle passe sous les cultures en relief (champs, vignes).
- Sur un appareil lent, le décor du plateau met quelques secondes à se bâtir à l'ouverture.
