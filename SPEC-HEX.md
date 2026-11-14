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
| `web/js/hex/moteur.js` | Le moteur repris de web_power, passé au rendu doux : matériau lisse, lots fusionnés (`put`, `fige`), tuiles biseautées (`tuiles`), formes, toits, rubans, la grille d'hexagones (`Grille`), la scène sous le canevas 2D (`Scene3D`) |
| `web/js/hex/modeles.js` | Les modèles : maisons de chaque pays (portes, fenêtres, volets, colombages, cheminées), église (clocher-mur en Béarn), cathédrale, halle, château, moulin, arbres, barque, quai, enceintes selon les remparts (1 à 4), fort en étoile |
| `web/js/hex/plateau.js` | La carte de campagne : hexagones de 4 km, terrain, rivières, étangs, routes, territoires, paysage des siècles, villes et villages d'après l'état, carte d'époque |
| `web/js/hex/champ.js` | Le champ de bataille : hexagones de 40 m, décor, routes, ponts, haies, clôtures, bâtiments (états du serveur), enceinte, barricades, cratères |
| `web/js/hex/troupes3d.js` | Les troupes en figurines 3D instanciées, posées par la logique de `battle/troupes2d.js` |
| `web/js/dev/modeles-hex.html` | Galerie des modèles |

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
