# Spec : étape 9, le rendu d'Ultimate General (terrain et unités)

## Pourquoi

Les étapes 6 à 8 ont rapproché les batailles d'Ultimate General : American Revolution (UGAR) : soldats arrondis,
animations précalculées, tués au sol, blés en relief, uniformes d'époque. Mais à la vue d'ensemble (celle où l'on joue),
le champ de bataille se lit encore comme un **plateau de jeu** :

- le sol est fait d'aplats aux bords nets, d'une seule saturation, sans matière (pas de touffes, de mottes, de cailloux) ;
- le relief se voit mal : la lumière est plate, les creux ne sont pas plus sombres que les crêtes ;
- les bois sont des arbres isolés, pas des masses ;
- l'image n'a pas d'« étalonnage » : couleurs brutes, pas de lointain bleuté, pas d'ambiance propre à l'heure ;
- les soldats sont éclairés en Lambert et colorés par sommet : de près, ils font figurines de plastique, sans boutons,
  galons, plis ni reflets de métal ;
- les chevaux sont animés par le code et se reconnaissent comme tels.

Ce que fait UGAR (d'après les noms de classes de son code, `global-metadata.dat`, et les captures officielles) :

| Ce qu'on voit dans UGAR | Comment il le fait (noms trouvés dans le jeu) |
|---|---|
| Sol riche, parcelles qui se fondent | textures photo mélangées par masques (`SplatTexture`, `rtpMat` : Relief Terrain Pack ; terrain généré avec Gaia) |
| Herbe dense, arbres massifs de loin | herbe instanciée sur le GPU (`ComputeVisibleGrass`, `CullGrassWithMask`, `gpuInstancerSettings`), arbres en imposteurs (`AmplifyImpostor`, `TreeStandIn`) |
| Le sol se piétine là où passent les troupes | `TerrainLightMapFootprint`, `DrawFootprints`, `BlurFootprint` |
| Impacts et routes marqués au sol | `AddBulletDecal`, `RoadDecalConverter`, `DecalsManager.dll` |
| Ambiance chaude « tableau d'histoire » | tone mapping ACES (`TonemapACES`), étalonnage LUT (`ColorGradingLUT`), bloom, vignettage (aussi sous la pluie et la neige) |
| Lointains bleutés, matin brumeux | brouillard selon l'heure (`CreateTODFogColor`, `CreateTODFogDensity`), couches de nuages (`CloudLayer`) |
| Effet maquette de près | profondeur de champ et tilt-shift (`BokehDepthOfField`, `TiltShift`), SSAO |
| Des milliers d'hommes animés | animation sur le GPU (`GPUAnimator`, `BakedInstance`), corps au sol (`DeadSoldiersRenderer`) |
| Lisibilité tactique | lignes de front (`FrontLine`), mode ligne de vue (`ActivateLOSMode`), flèches au sol (`DepthBufferForArrows`) |
| Eau | AQUAS (reflets planaires) |

But : **à distance de caméra égale, une capture de web_conquete se confond avec une capture d'UGAR** à la vue d'ensemble
et à mi-distance. De très près, on s'en approche autant que l'iPad le permet.

Rien n'est repris d'UGAR : ses textures, modèles, sons et réglages appartiennent à Game-Labs. On reprend des
**techniques** et un **style** (palette, densité, lumière), mesurés sur des captures d'écran qui servent de référence.

## Décisions à prendre avant de commencer

| # | Question | Ce que je propose | Pourquoi |
|---|---|---|---|
| D1 | Des **textures photo** pour le sol (fichiers d'images dans `web/textures/`, environ 12 à 20 Mo) ? Aujourd'hui tout est peint par le code. | Oui, en CC0 (ambientCG, Poly Haven), redimensionnées en 512 et 1024 px, licence copiée à côté. | C'est la seule façon d'avoir la matière d'UGAR. Sans elles, on plafonne. |
| D2 | Des **coordonnées de texture** sur les figurines, avec un **atlas d'uniformes peint par le code** au chargement ? | Oui. Le choix « figurines construites par le code » est respecté : l'atlas est dessiné sur un canevas, il n'y a aucun fichier. | Boutons, galons, plis, buffleteries et visages ne tiennent pas dans des couleurs par sommet. |
| D3 | Les **chevaux** : animations CC0 précalculées (comme les fantassins), ou meilleures allures écrites par le code ? | Chercher d'abord un cheval animé en CC0 (packs d'animaux de Quaternius, à vérifier). Sinon, de vraies allures par le code (ordre des sabots, balancement de la tête, rebond du cavalier). | Le cheval est aujourd'hui la figurine la moins crédible. |
| D4 | Une **passe d'après-rendu** (rendu dans une texture flottante, puis une passe plein écran) ? Ta spec dit « pas d'addons ». | Oui, écrite à la main (environ 150 lignes), sans `EffectComposer`. | Étalonnage, vignettage, anticrénelage FXAA et léger bloom dans une seule passe. |
| D5 | Les **captures de référence** : les 10 captures Steam du 17/10, plus des captures que tu prends toi-même dans UGAR (même heure, même météo, mêmes distances) ? | Oui : 3 vues × 3 heures × 2 météos. | Pour régler les LUT et juger « côte à côte ». |

**Décisions prises le 20/10/2026** : D1 oui (textures CC0 d'ambientCG et Poly Haven), D2 oui (atlas peint par le
code), D3 cheval animé CC0 d'abord (allures par le code en repli), D4 oui (passe écrite à la main), D5 : les captures
officielles de la page Steam servent de référence en attendant les tiennes. Ordre : 9a puis 9b.

**Livré** : 9a (`heures.js`, `apres.js`). Niveaux d'après-rendu : Basse rendu direct avec ACES ; Moyenne LUT et
vignettage ; Haute aussi FXAA et halo ; Ultra aussi MSAA (4 échantillons) et maquette à moins de 260 m. Le grain est
présent dès Moyenne. Réglage d'après les captures Steam : plus saturé et plus chaud qu'imaginé au départ (les verts
d'UGAR tirent vers le jaune, ils ne sont pas « passés »).

**Livré** : 9b (`sols.js`, `terrain.js` solMask et solParts, `relief.js`, `web/textures/sols/`, 6,4 Mo). Écart
volontaire avec A1 : la peinture n'est pas remplacée par les masques, elle reste la couleur (saisons, parcelles,
routes, eau, mini-carte, et tout ce qui est peint par-dessus) ; la photo, divisée par sa couleur moyenne, en module la
matière et donne les normales. Ainsi rien des étapes 6 à 8 n'est perdu et la mini-carte reste cohérente. Seuls les
deux sols dominants de chaque point sont lus (une texture en tableau, lecture par numéro de couche). Contraste de la
photo rehaussé avec la distance (ses mipmaps l'aplatissent). Reste de A1 pour plus tard : la courbure (creux plus
verts), le triplanaire des pentes raides, la neige comme 9ᵉ sol (aujourd'hui, la matière s'efface à 30 % sous la
neige), la variation à grande échelle propre aux sols (les « nuances » peintes de terrain.js en tiennent lieu).

**Livré** : 9c (`horizon.js`, `relief.js` ombrage et prepRelief). Normales à 2,5 m et occlusion (part du ciel vue)
dans une texture en demi-flottants ; horizons dans huit directions sur une grille de 5 m, jusqu'à 600 m (environ
0,3 s au chargement sur un PC). L'ombre des collines et celle des nuages (motif de 2,4 km, bords plus doux) ne
retiennent que la lumière directe, et tombent aussi sur les troupes, les arbres, les maisons, les haies, les épis et
les tués (`ombrage`, un même bout de shader ; la position dans la scène est retrouvée depuis vViewPosition).
Constat en le réglant : la lumière du ciel pesait autant que le soleil, d'où l'éclairage plat ; par temps clair, le
soleil passe de 2,2 à 2,85 et le ciel de 2,05 à 1,5 (heures.js). Sous un ciel couvert, la lumière diffuse domine
toujours. Limite : les normales ne sont pas plus fines que les altitudes du moteur (une case de 20 m, affinée à 5 m) ;
talus et chemins creux demanderaient des altitudes plus fines côté serveur.

**Livré** : 9d (`decor.js` feuillage, `terrain.js` woodMask, `relief.js` sous-bois). Sous-bois sombre (masque des bois
à 4 m) ; couronnes des bois ×1,2 (÷ √ de la part gardée en Basse et Moyenne, qui ôtent des arbres) ; teinte selon un
bruit de 300 m, un arbre sur dix plus clair, un sur dix plus sombre ; feuillage : lumière enveloppante, translucidité à
contre-jour, grappes de feuilles (bruit 3D dans le shader), balancement au vent selon sa force. Pas fait : les
imposteurs d'arbres (A5.2 ; le nombre d'arbres actuel passe, à revoir avec 9k si l'iPad peine), et le traitement des
haies (A5.6 : elles restent des bandes extrudées).

## Ce qui ne change pas

Le moteur Python et ses API, les règles, les commandes et les gestes, l'interface, les noms des niveaux de qualité, les
animations déjà livrées (étape 7), les uniformes (étape 8), la qualité automatique. Toujours Three.js r186 seul, hors
ligne.

---

## Partie A : le terrain

### A1. Le sol mélangé par masques (splatmap), le cœur du chantier

**Aujourd'hui** : `terrain.js` peint les couleurs finales sur des canevas (image entière à 0,5 px/m, puis blocs de
512 px à 2, 4, 8 ou 16 px/m autour de la caméra), envoyées au shader du relief (`relief.js`).

**Demain** : `terrain.js` ne peint plus des couleurs mais des **masques**. Le shader du sol mélange des textures photo.

1. **Masques** (deux textures RGBA, donc 8 sols au plus, à la résolution de l'image entière, 1 à 2 px/m) :
   - masque 1 : pré, herbe sèche ou lande, blé ou culture, labour ou terre ;
   - masque 2 : chemin, route empierrée, sable ou grève, boue (rempli plus tard par le piétinement, A4).
   Les vignes, l'eau et les détails dessinés à la main (ornières, bords de route, fossés) restent dans la peinture
   actuelle, posée par-dessus avec sa transparence : on ne jette pas le travail des étapes 6 et 7.
2. **Bibliothèque de sols** : une `DataArrayTexture` (texture en tableau de WebGL 2) par sorte de carte :
   - albédo (la couleur), 8 couches de 1024 px en Haute et Ultra, 512 px en Basse et Moyenne, avec mipmaps ;
   - normales (le relief fin : touffes, mottes, cailloux), même taille ;
   - hauteur dans l'alpha de l'albédo (pour le mélange par hauteur, point 4).
   Un seul échantillonneur pour 8 sols : peu d'appels, et ça passe sur l'iPad.
3. **Casser la répétition** (sans quoi on voit un carrelage) :
   - chaque sol est lu à deux échelles (par exemple 4 m et 23 m) et les deux sont mélangées ;
   - **pavage stochastique** : la texture est tournée et décalée au hasard par cellule hexagonale, avec un fondu entre
     cellules (technique de Heitz et Neyret, environ 40 lignes de GLSL) ;
   - une **variation à grande échelle** : une texture de bruit de 1 à 2 km qui fait varier teinte, luminosité et
     saturation de ±8 %. C'est ce qui donne les « nappes » de vert plus ou moins jaune d'UGAR.
4. **Mélange par hauteur** : à la frontière entre deux sols, celui dont la hauteur est la plus forte gagne (l'herbe
   déborde sur le chemin en touffes, la terre apparaît entre les mottes) au lieu d'un fondu baveux.
5. **Bords de parcelles fondus** : le masque est flouté de 2 à 4 m, puis bruité. Une bordure d'herbe plus haute et plus
   sombre court le long des champs (les « tournières »).
6. **Le relief commande le sol** :
   - **pente** : au-delà d'environ 25°, la terre puis la roche remplacent l'herbe ;
   - **courbure** : les creux sont un peu plus verts et sombres (humidité), les crêtes un peu plus sèches et claires ;
   - **mappage triplanaire** sur les pentes raides (talus, ravins), pour éviter les textures étirées.
7. **Fondu avec la distance** : au loin, seule l'échelle large et la variation restent (pas de scintillement), et le
   sol rejoint progressivement la couleur de l'image entière, pour que la mini-carte et le lointain restent cohérents.
8. **Saisons** : chaque sol a une teinte par saison (uniforme dans le shader) au lieu d'une repeinture. La neige devient
   un 9e sol qui recouvre les autres selon la pente (moins sur les pentes raides) et le piétinement (A4).

Fichiers : `terrain.js` (masques), `relief.js` (shader du sol), nouveau `sols.js` (chargement de la bibliothèque,
teintes des saisons), `qualite.js` (taille des textures), nouveau `web/textures/` (images et `LICENCE.txt`).

### A2. Un relief qui se voit

1. **Normales fines du relief** : le maillage a une maille de 10 m, trop grossière pour la lumière. On calcule une
   texture de normales à 1 ou 2 m depuis les altitudes adoucies (`fineAt`) au chargement de la bataille. Les talus,
   les chemins creux et les ondulations du terrain accrochent alors la lumière.
2. **Occlusion ambiante du terrain** précalculée une fois par bataille (horizon vu depuis chaque point dans 8
   directions, sur le CPU, quelques dizaines de millisecondes) : les fonds de vallée et le pied des haies et des bois
   s'assombrissent doucement.
3. **Ombre portée des collines** quand le soleil est bas (matin, soir) : on la tire de la même carte d'horizon selon
   la direction du soleil, au lieu de la carte d'ombres qui ne couvre que les alentours de la caméra.
4. **Ombres des nuages** : déjà là. Il suffit de les rendre un peu plus grandes et plus douces, et de les faire passer
   aussi sur les troupes.

### A3. L'herbe et les cultures en volume

Les épis existent déjà (couches empilées, en Haute et Ultra). Il reste à :

1. **Herbe instanciée** dans les prés et les landes : des touffes de brins (3 à 5 plans croisés par touffe), posées sur
   le GPU selon le masque du pré, plus denses près de la caméra, éclaircies au loin. Densité et distance selon la
   qualité.
2. **L'herbe prend la couleur du sol en dessous** (le shader lit l'albédo du sol au pied de la touffe). C'est l'astuce
   d'UGAR : pas de couture entre la texture et l'herbe en volume, le fondu au loin est invisible.
3. **Vent** : l'ondulation existe pour les épis ; la même pour l'herbe, avec des rafales qui traversent le champ (une
   onde de bruit qui se déplace avec `uWind`).
4. **Piétinement** : l'herbe et les épis se couchent là où la carte de piétinement (A4) est forte.
5. **Fleurs, chardons, pierres** : quelques instances rares, en Haute et Ultra seulement.

### A4. Le sol qui garde la trace de la bataille

C'est la signature d'UGAR, et ton architecture s'y prête (les tués sont déjà des panneaux posés sur le relief).

1. **Carte de piétinement** : une texture de rendu de 1024 × 683 sur le champ de 3 × 2 km (environ 3 m par pixel),
   2048 en Ultra. À chaque image, chaque régiment en mouvement y dessine une tache douce (un quad instancié par
   régiment, à la forme de sa formation), d'intensité fonction des hommes, de la vitesse et de l'arme (la cavalerie et
   l'artillerie marquent plus).
2. **Effets dans le shader du sol** : la carte pousse vers le sol « boue » (masque 2), assombrit et aplatit l'herbe
   (A3), efface la neige.
3. **Pluie** : le piétinement marque deux fois plus et le sol foulé devient luisant (un peu de spéculaire).
4. **Ornières des pièces** : le passage d'une batterie trace deux traits parallèles (quads fins), en plus de la tache.
5. **Impacts** : les trous d'obus actuels gagnent une gerbe de terre projetée autour (un décalque plus large et
   dégradé), et le blé est couché autour.
6. **Débris** au sol, au fil de la bataille : chapeaux, fusils, havresacs, roues brisées près des pièces, en petites
   instances, plafonnées comme les corps.

La carte de piétinement est enregistrée avec la bataille (texture réduite en PNG dans la sauvegarde, ou recalculée
depuis l'historique des positions), pour qu'une bataille rechargée garde ses traces.

### A5. Les bois et les arbres

1. **Bois en masse** : sous chaque bois, un sous-bois sombre continu (décalque sur le sol) et une canopée faite de
   touffes qui se touchent (« bois au toit bosselé » existe déjà : on resserre les couronnes, on supprime les trous).
   Vu de haut, un bois doit être une masse sombre aux bords dentelés, comme dans UGAR.
2. **Imposteurs fabriqués par le jeu** : au chargement, chaque modèle d'arbre construit par le code est rendu sous 8
   à 16 angles dans un atlas (imposteurs octaédriques). Au-delà d'environ 400 m, on dessine l'image au lieu du modèle,
   avec un fondu enchaîné. On peut ainsi doubler ou tripler le nombre d'arbres pour le même coût, et toujours sans
   fichier téléchargé.
3. **Variété** : teinte de chaque arbre tirée d'un bruit à grande échelle (les bois ont des nuances, comme le sol),
   et quelques arbres plus clairs (bouleaux, peupliers) ou plus sombres (chênes, pins).
4. **Éclairage des couronnes** : lumière qui traverse les feuilles (translucidité quand le soleil est derrière),
   dessous sombre, ombre douce au pied.
5. **Vent** : balancement des couronnes dans le vertex shader, plus fort par gros temps.
6. **Haies du bocage** : même traitement (touffes, teintes, pieds sombres), plus quelques arbres têtards qui dépassent.

### A6. L'eau

1. Normales qui défilent dans le sens du courant (deux échelles), reflet du ciel (dégradé du ciel selon l'angle, terme
   de Fresnel), reflet doré du soleil quand il est bas.
2. Couleur selon la profondeur (plus claire au bord, plus sombre au milieu), d'après la distance à la berge lue dans
   le masque de l'eau.
3. Écume légère le long des berges et autour des piles des ponts.
4. Pas de reflets planaires (trop chers sur l'iPad) : le reflet du ciel et du soleil suffit à la vue d'ensemble.

### A7. Atmosphère, ciel et heure

1. **Brouillard selon la hauteur et la distance** au lieu de `THREE.Fog` : plus épais dans les vallées le matin, avec
   une diffusion vers le soleil (le lointain s'éclaircit du côté du soleil). C'est la « perspective aérienne » qui donne
   la profondeur des captures d'UGAR.
2. **Table des heures** (comme `CreateTODFogColor` dans UGAR) : pour chaque heure de 5 h à 22 h, la couleur et la force
   du soleil, du ciel, de l'ambiance, du brouillard, et la LUT à utiliser (B, Partie C). `effets.js` fournit déjà
   l'heure et la météo : on remplace les calculs dispersés par une seule table, réglée sur les captures de référence.
3. **Ciel** : dôme dégradé avec halo autour du soleil, nuages en couches qui défilent (deux textures de bruit),
   couchant coloré. Le ciel ne se voit qu'à ras des troupes, mais il colore tout (ambiance, eau).
4. **Météo** : pluie qui assombrit et fait briller le sol, brouillard qui mange les couleurs, neige qui bleuit les
   ombres. Chaque météo a sa LUT.

---

## Partie B : les unités

### B1. L'éclairage des figurines

Aujourd'hui : `MeshLambertMaterial` avec couleurs par sommet, plus une ombre plus sombre vers les pieds (étape 7).

1. **Modèle d'éclairage maison** (dans le `onBeforeCompile` existant de `troupes.js`) :
   - lumière enveloppante (half-Lambert) pour que l'ombre ne soit jamais noire ;
   - ambiance tirée du ciel par le haut et du sol par le bas (la couleur du sol sous le régiment, lue dans l'albédo
     du sol : un régiment dans le blé est légèrement doré en dessous) ;
   - **liseré de lumière** (rim light) quand le soleil est derrière : c'est ce qui détache les silhouettes du sol chez
     UGAR, surtout le matin et le soir ;
   - **reflets** sur le métal (baïonnettes, plaques de shako, cuivres des tambours, fûts de bronze), qui scintillent
     le long d'une ligne quand le soleil est bas.
2. **Occlusion ambiante par sommet**, calculée une fois pour chaque modèle construit (sous les bras, entre les jambes,
   sous le chapeau), et un léger assombrissement des rangs arrière (les hommes se font de l'ombre).
3. **Ombres** : les taches douces sous chaque figurine restent. On ajoute une **ombre de régiment**, une tache large et
   très douce sous toute la formation, qui fait « poser » le bloc sur le sol à la vue d'ensemble.

### B2. Les détails peints : l'atlas d'uniformes

C'est le plus gros écart de près avec UGAR, dont les figurines sont texturées.

1. **Coordonnées de texture** sur les pièces des modèles construits par le code (corps, basques, manches, jambes, tête,
   chapeau, havresac) : un dépliage simple par pièce (cylindrique ou plan).
2. **Atlas d'uniformes peint au chargement** (canevas 1024 × 1024, 2048 en Ultra), une case par uniforme et par
   époque :
   - boutons, galons, revers, parements, épaulettes, buffleteries croisées, giberne, guêtres ;
   - plis et ombrages peints (le plus foncé sous les bras et dans le dos) ;
   - visage : sourcils, yeux, ombre du nez ; mains ;
   - chapeaux : cocarde, ganse, plumet, plaque ;
   - la couleur du camp reste un canal à part, pour garder la règle de l'étape 8 (camp lisible aux revers et parements).
3. **Teinte par homme** (déjà là), plus une **usure** au fil de la bataille : habits salis de boue en bas, plus foncés
   sous la pluie.
4. **Normales peintes** dans le même atlas (plis, coutures), en Haute et Ultra seulement.
5. **Drapeaux et fanions** : vraies couleurs régimentaires peintes dans l'atlas (croix, devises, franges), tissu qui
   ondule dans le shader (existe) avec un ombrage selon les plis.

### B3. Les silhouettes et les modèles

1. **Proportions** : celles de l'étape 7 (trapues, tête et chapeau forts) restent. On compare à UGAR sur captures, à
   trois distances.
2. **Fusil et baïonnette** : assez fins pour paraître fins, mais jamais moins de 1 pixel à l'écran (sinon ils
   scintillent) : épaisseur réglée selon la distance dans le vertex shader.
3. **Animation secondaire** : basques et sabretaches qui bougent avec la marche, plumets qui suivent le vent, havresac
   qui rebondit.
4. **Pieds sur le relief** : chaque pied posé à l'altitude du sol (correction par cinématique inverse dans le vertex
   shader, déjà possible avec la texture du relief), pour que les rangs suivent les pentes sans flotter.

### B4. Les chevaux

1. Selon D3 : animations précalculées d'un cheval CC0 sur un squelette de cheval (même chaîne que les fantassins :
   `dev/cuire.mjs`), ou allures réécrites par le code :
   - pas, trot, galop avec le bon ordre des sabots ;
   - balancement de la tête et de l'encolure, queue et crinière qui suivent ;
   - le cavalier qui monte et descend avec le cheval (et se lève sur ses étriers au galop).
2. Robes variées (bai, alezan, noir, gris) avec des balzanes, peintes dans l'atlas (B2).
3. Poussière sous les sabots au trot et au galop (existe pour les charges : à généraliser), plus forte sur sol sec.

### B5. Le nombre d'hommes et la vue de loin

1. **Trois niveaux de détail** au lieu de deux :
   - près : figurine complète au squelette (aujourd'hui) ;
   - milieu : version simple (aujourd'hui) ;
   - loin : **imposteurs animés**, des images de la figurine rendues au chargement pour chaque geste principal
     (marche, joue, recharge, course, repos) sous 8 angles, posées face à la caméra. Elles coûtent un quad par homme.
2. Avec les imposteurs, le budget de figurines peut monter (par exemple Haute 10 000 → 16 000), ce qui rapproche de
   « un homme par figurine » plus loin, comme dans UGAR.
3. Le grossissement de loin (étape 7e) reste, réglé sur les captures.

### B6. Le feu et la fumée autour des troupes

La fumée existe déjà (bouffées qui se fondent en banc). Pour l'allure d'UGAR :

1. **Fumée éclairée** : plus claire du côté du soleil, plus sombre et bleutée à l'ombre, dorée le soir ; elle reçoit
   l'ombre des nuages.
2. **Fumée douce sur le sol** : les panneaux de fumée qui coupent le sol se fondent selon la profondeur (fumée « douce »,
   qui lit la profondeur de la scène), sinon on voit des arêtes nettes. C'est possible avec la passe d'après-rendu (D4).
3. **Éclairs de bouche** qui éclairent un instant les hommes et le sol autour (une lumière factice : une tache claire
   au sol et un coup de clair sur les figurines proches, sans vraie lampe).
4. **Variété** : fumée de canon plus épaisse et plus grise, qui monte plus haut ; fumée de mousqueterie plus blanche
   et plus basse.

### B7. La lisibilité à la manière d'UGAR

1. **Lignes de front** : un ruban à la couleur du camp, tracé au sol entre les régiments au contact (calque 2D, comme
   les flèches), qui ondule doucement.
2. **Mode ligne de vue** : en maintenant un bouton, le terrain que voit le régiment choisi reste clair et le reste
   s'assombrit. La fonction `los` du moteur existe ; le client a besoin d'une petite carte de visibilité (calculée
   par le serveur ou dans le navigateur).
3. **Sélection** : un anneau lumineux au sol, à la forme de la formation, plutôt qu'un contour.

---

## Partie C : l'image finale (après-rendu)

Une passe maison (D4), dans l'ordre :

1. La scène est rendue dans une texture flottante (`HalfFloatType`) avec un anticrénelage multi-échantillons sur PC
   (WebGL 2 le permet sur une cible de rendu), ou sans sur iPad.
2. **Tone mapping ACES** (ou AgX), à la place de `NeutralToneMapping`.
3. **LUT 3D** (texture 3D de 32³, WebGL 2) choisie selon l'heure et la météo (table A7), avec un fondu entre deux LUT
   quand l'heure tourne. Les LUT sont réglées sur les captures de référence (D5) : un « look » chaud, des verts un peu
   passés, des ombres légèrement bleutées, des hautes lumières douces.
4. **Vignettage** léger, plus fort sous la pluie et la neige (comme UGAR).
5. **Bloom** léger sur le soleil, les éclairs et la neige : une demi-résolution floutée, en Haute et Ultra seulement.
6. **FXAA** dans la même passe quand l'anticrénelage matériel est coupé (iPad).
7. **Profondeur de champ façon maquette** (tilt-shift) à ras des troupes, en Ultra seulement.
8. **Grain** très léger et réglage de netteté, pour casser l'aspect « image de synthèse ».

Repli : si la texture flottante n'est pas disponible, ou en qualité Basse, on revient au rendu direct d'aujourd'hui,
avec ACES et sans LUT.

---

## Budget : ce que chaque technique coûte, par qualité

| Technique | Basse | Moyenne | Haute | Ultra | Coût principal |
|---|---|---|---|---|---|
| A1 sol par masques | 512 px, 1 échelle | 512 px, 2 échelles | 1024 px, pavage stochastique | idem + triplanaire | lectures de texture par pixel |
| A2 normales, occlusion du terrain | occlusion seule | ✅ | ✅ | ✅ | calcul au chargement |
| A3 herbe instanciée | ❌ | ❌ | 150 m | 300 m | sommets |
| A4 piétinement | ✅ (512) | ✅ (1024) | ✅ | ✅ (2048) | une petite passe par image |
| A5 imposteurs d'arbres | ✅ | ✅ | ✅ | ✅ | mémoire de l'atlas |
| A6 eau | simple | ✅ | ✅ | ✅ | faible |
| A7 brouillard, ciel | ✅ | ✅ | ✅ | ✅ | faible |
| B1 éclairage des figurines | ✅ | ✅ | ✅ | ✅ | faible |
| B2 atlas d'uniformes | 512 | 1024 | 1024 + normales | 2048 + normales | mémoire |
| B5 imposteurs animés | ✅ | ✅ | ✅ | ✅ | mémoire, calcul au chargement |
| B6 fumée douce | ❌ | ❌ | ✅ | ✅ | lit la profondeur |
| C après-rendu | ❌ (ACES seul) | LUT + vignettage | + FXAA + bloom | + MSAA + tilt-shift | une passe plein écran |

Plafond de mémoire GPU sur l'iPad (Safari est avare) : textures du sol, atlas et imposteurs ne dépassent pas les
valeurs `textures` et `sprites` de `qualite.js`, à ajuster.

## Livraison par étapes (chaque sous-étape est jouable, capturée et commitée)

| Sous-étape | Contenu | Dépend de | Effet visible |
|---|---|---|---|
| 9a `image` | après-rendu (C), table des heures (A7.2), LUT réglées sur les captures | D4, D5 | ★★★ tout le jeu prend l'ambiance |
| 9b `sol` | sol par masques (A1), bibliothèque de sols CC0 | D1 | ★★★ fin du plateau de jeu |
| 9c `relief` | normales fines, occlusion et ombres des collines (A2) | 9b | ★★ le relief se lit |
| 9d `bois` | bois en masse, imposteurs d'arbres, haies (A5) | — | ★★ |
| 9e `pietinement` | carte de piétinement, ornières, impacts, débris (A4) | 9b | ★★ signature d'UGAR |
| 9f `herbe` | herbe instanciée qui prend la couleur du sol, vent, herbe couchée (A3) | 9b, 9e | ★★ |
| 9g `atmosphere` | brouillard selon la hauteur, ciel, eau (A6, A7) | 9a | ★★ |
| 9h `lumiere-troupes` | éclairage des figurines, ombre de régiment (B1) | 9a | ★★ |
| 9i `uniformes` | coordonnées de texture et atlas d'uniformes (B2) | D2 | ★★ de près |
| 9j `chevaux` | chevaux (B4) | D3 | ★★ de près |
| 9k `foule` | imposteurs animés, budgets relevés, détails des modèles (B3, B5) | 9i | ★ de loin |
| 9l `fumee-lisibilite` | fumée éclairée et douce, éclairs (B6), lignes de front, ligne de vue (B7) | 9a | ★ |

Ordre conseillé : 9a, 9b, 9c, 9d, 9e, puis le reste. Avec 9a à 9e, la vue d'ensemble a déjà l'essentiel du rendu
d'UGAR.

## Stratégie de test

- **Vues de référence** fixées dans `dev/capture.mjs` : vue d'ensemble, mi-distance, ras des troupes ; à 8 h, 13 h et
  19 h ; beau temps et pluie ; scénarios bocage, landes, vignes. Chaque sous-étape montre ces captures à côté des
  captures d'UGAR.
- **Bancs Node** pour la logique pure : encodage des masques (un pixel de pré donne bien le canal du pré), table des
  heures (continuité entre deux heures), carte de piétinement (dépôt, plafond, effacement par la neige), dépliage des
  coordonnées de texture (dans [0, 1], sans recouvrement entre pièces), choix du niveau de détail.
- **Charge graphique** : `renderer.info` (appels de dessin, triangles, textures) sur les trois vues, comparé à
  aujourd'hui, et temps d'image mesuré par l'indicateur existant.
- **iPad** : ≥ 30 images/s en Haute avec 20 régiments et la fumée d'un combat (critère 10 du début), à vérifier par toi.
- `python3 tests/lancer.py` passe avant chaque commit.

## Limites

- **Toujours** : Three.js seul, hors ligne ; mémoire GPU libérée à la sortie ; tout est borné par la qualité ; une
  licence à côté de chaque fichier d'image ajouté.
- **Demander d'abord** : toute bibliothèque en plus ; tout changement du moteur Python (sauf, si on le retient, une
  carte de visibilité pour B7.2) ; une taille du jeu qui dépasse 40 Mo.
- **Jamais** : un fichier, une texture ou un réglage repris d'UGAR ; une texture sans licence claire ; casser une
  partie sauvegardée.

## Critères de réussite

1. Aux vues de référence, à la vue d'ensemble et à mi-distance, les captures se confondent avec celles d'UGAR pour
   un œil non averti : sol riche sans carrelage visible, relief lisible, bois en masses, ambiance de l'heure, traces de
   la bataille au sol.
2. De près : uniformes avec boutons, galons et buffleteries, reflets du métal, chevaux crédibles.
3. Aucune erreur dans la console sur les cinq scénarios et dans une vraie bataille lancée depuis la campagne.
4. Les performances du critère 10 tiennent sur l'iPad en Haute.
5. Les bancs passent, avec les nouveaux.
6. Le README décrit le nouveau rendu et les sources des textures.

## Questions ouvertes

- D1 à D5 ci-dessus.
- La taille finale du jeu avec les textures (estimation : 15 à 25 Mo de plus).
- Le coût réel du pavage stochastique et de l'herbe instanciée sur un iPad de 2019 : à mesurer dès 9b et 9f. S'il est
  trop élevé, la Haute garde une seule échelle de texture et une herbe plus courte.
