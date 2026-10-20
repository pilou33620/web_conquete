# Spec : tout ce qui reste à faire (point du 20/10/2026, validée le même jour)

## Pourquoi

Le 20/10/2026, tu as demandé de rapprocher tout le jeu d'Ultimate General : American Revolution (UGAR) : batailles,
interface, caméra, troupes et chevaux, carte de campagne. Une grande partie est faite et poussée sur `main` (liste et
commits dans `tasks/a-faire.md`). Les chantiers restants sont aujourd'hui éparpillés :

- dans `SPEC-RENDU.md`, sous les « Pas fait » de chaque étape livrée ;
- dans `SPEC-CARTES.md` (une ligne) ;
- dans `SPEC-TECH.md`, où les phases 2b à 4 tiennent en quelques lignes ;
- dans des conversations (soldats et canon téléchargés, vue 3D de la campagne).

Cette spec les rassemble **tous**, partie par partie. Pour chacun, elle dit :

- ce que verra le joueur ;
- comment le faire, et dans quels fichiers ;
- ce qu'il coûte, par qualité ;
- comment le tester ;
- à quoi on reconnaît qu'il est fini.

Elle ne remplace pas les specs d'origine : elle les complète et donne l'ordre. Chaque partie passera, comme toujours,
par son plan (`tasks/plan-*.md`), sa construction par petites étapes, ses captures et ta validation.

Rien n'est repris d'UGAR : ni texture, ni modèle, ni son, ni réglage. Les captures officielles de sa page Steam
servent seulement de référence pour juger « côte à côte ».

## Carte des parties

| Partie | Ce qu'elle fait | Bloquée par | Taille | Effet visible |
|---|---|---|---|---|
| **E. Figurines** | Soldats en modèles libres, canon téléchargé, deuxième cheval en option | tes téléchargements | grande | ★★★ de près |
| **F. Rendu des batailles** | Atmosphère, eau, métal, atlas d'uniformes, foule, lisibilité, sol, haies, traces | — | grande | ★★ à ★★★ |
| **G. Carte de campagne** | Panneaux comme UGAR, portraits des généraux, armées en figurines, vue inclinée | décision D2 | moyenne à très grande | ★★★ |
| **H. La carte selon l'époque** | Télégraphes, vapeurs et usines (2b), paysage (2c), allure (2d) | — | moyenne | ★★ |
| **I. Les découvertes** | Mise en scène sur la carte, fenêtre « gravure », frise, bandeau des IA (phase 3) | décision D5 | moyenne | ★★ |
| **J. Le décor des batailles selon l'époque** | Rail, télégraphe, usines, cultures, ambulances, ballon, retranchements (phase 4) | H | moyenne | ★★ |
| **K. Vérifications et dettes** | Essais iPad et Raspberry Pi, deux tests de campagne en échec | toi | petite | — |

## Décisions à prendre avant de commencer

| # | Question | Ce que je propose | Pourquoi |
|---|---|---|---|
| D1 | Comment récupérer les **soldats** (itch.io) et le **canon** (Sketchfab) ? | Tu les télécharges dans ton dossier Téléchargements. À défaut, tu m'autorises à passer par ton Chrome (Claude in Chrome) pour itch.io ; Sketchfab demande que tu y sois connecté. | Itch.io refuse depuis mon navigateur (« invalid key ») ; je ne crée pas de compte et ne saisis pas de mot de passe. |
| D2 | La **vue inclinée** de la carte de campagne, comme UGAR : la faire, et comment ? | D'abord G1 à G3 (panneaux, portraits, figurines), qui servent dans tous les cas. Puis une **maquette** de la vue inclinée en Three.js (G4), jugée sur l'iPad avant d'aller plus loin. | C'est le plus gros chantier de la liste : la carte est un canevas 2D de 2 600 lignes. La maquette dit ce que ça coûte avant de s'engager. |
| D3 | Le **style de la carte selon l'époque** (phase 2d), prévu « Cassini au XVIIIe, état-major au XIXe » : comment l'accorder avec le style UGAR livré le 20/10 ? | Le style UGAR reste la base. L'époque le fait seulement varier (teintes, écritures, cadre), et le style « d'époque » complet devient une option du menu Affichage. | Sinon le travail du 20/10 disparaîtrait dès la partie suivante. |
| D4 | Les **portraits des généraux** : peints par le code (comme les portraits des cartes de régiment en bataille), ou des images ? | Peints par le code : buste en uniforme de l'époque et du camp, visage tiré de son nom (traits, favoris, perruque ou cheveux selon l'année). Aucun fichier. | Reste fidèle au choix « figurines construites par le code » ; marche hors ligne. |
| D5 | Les **gravures** de la fenêtre de découverte (phase 3) : 75 à 95 images du domaine public (Wikimedia Commons), ou des vignettes animées dessinées par le code ? | Vignettes animées par le code (une dizaine de familles) d'abord, gravures ensuite seulement pour les découvertes majeures (une vingtaine), avec ton accord image par image. | Chaque image demande un téléchargement et une licence vérifiée ; les vignettes n'en demandent aucune. |
| D6 | **Enregistrer la boue** du piétinement avec la bataille demande de toucher au moteur Python (une nouvelle donnée dans la sauvegarde). D'accord ? | Oui : une image réduite (PNG de 256 × 171) envoyée par le navigateur toutes les 30 s de bataille, gardée avec la bataille, ignorée par les anciennes sauvegardes. | La spec de l'étape 9 met « tout changement du moteur » dans « demander d'abord ». |
| D7 | L'**ordre** des chantiers. | Celui de la section « Livraison » plus bas : ce qui se voit le plus d'abord, ce qui est bloqué quand il est débloqué. | — |

**Décisions prises le 20/10/2026** (« tu peux tout faire toi ») : D1 à D7 comme proposé. Les téléchargements passent
par ton Chrome (Claude in Chrome) quand mon navigateur est refusé ; la vue inclinée commence par une maquette ; le
style UGAR reste la base des époques ; portraits peints par le code ; vignettes animées d'abord ; la boue est
enregistrée avec la bataille ; l'ordre est celui de la section « Livraison ».

## Hypothèses (à corriger maintenant si besoin)

1. Les figurines téléchargées sont **allégées** (Blender sans fenêtre, déjà installé dans le bloc-notes de travail) et
   **cuites** en fichiers du jeu (`web/anims/`), comme le cheval. Le navigateur ne charge jamais les fichiers d'origine.
2. Les soldats Universal Base Characters ont **le même squelette** que les animations déjà dans le jeu (Universal
   Animation Library, Quaternius) : leurs corps se posent donc sur nos gestes sans reciblage.
3. Le canon téléchargé ne remplace que les **pièces de bronze à âme lisse** (générations « ancien », « gribeauval »,
   « valée ») vues de près. Les pièces rayées, de Bange et le canon de 75 restent construites par le code.
4. Budgets de départ, à mesurer sur l'iPad avant de les figer :
   - soldat près : 1 200 triangles au plus ; version simple : 300 ;
   - canon près : 2 000 triangles au plus ;
   - poids ajouté au jeu : 8 Mo au plus pour toute la partie E.
5. Le ciel et le brouillard (F1) n'ajoutent **aucune texture** au shader du sol, qui est à 15 sur 16 : ils se calculent.
6. Tout reste en Three.js r186 seul, hors ligne, sans dépendance nouvelle. Les qualités Basse, Moyenne, Haute et Ultra
   gardent leurs noms ; chaque nouveauté dit ce qu'elle fait dans chacune.
7. Aucune sauvegarde ne casse. Ce qui change une carte ou une règle est versionné, comme le générateur des cartes de
   bataille (`terrain_v1.py`).

---

## Partie E : les figurines

### E1. Les soldats (Universal Base Characters, Quaternius, CC0)

**Ce que verra le joueur.** De près, des hommes aux proportions et aux visages de vrais modèles, au lieu des
silhouettes construites par le code. Mêmes gestes qu'aujourd'hui, mêmes uniformes d'époque.

**Comment.**

1. Copier le zip dans un dossier vide à part, lire sa licence, lister les modèles (homme, femme ; corps nus ou habillés).
2. Script Blender sans fenêtre (`web/js/battle/dev/soldat.py`, lancé par `dev/soldat.mjs`) :
   - garder le corps d'homme ;
   - l'alléger à 1 200 triangles (près) et 300 (version simple), en gardant visage et mains lisibles ;
   - vérifier que les os portent les mêmes noms que ceux de `soldat.json` (sinon, table de correspondance) ;
   - exporter positions, normales, os et poids (4 par sommet).
3. Cuire comme le cheval : `web/anims/corps.bin` et `corps.json`, sommets en demi-flottants, poids en octets.
4. Dans `troupes.js`, une variante `CORPS` du shader (comme `CHEVAL`) :
   - le corps est le modèle cuit ;
   - l'habit, les basques, les revers, la coiffure, le havresac, les buffleteries et le fusil restent construits par
     le code et sont accrochés aux os (on ne jette pas le travail des étapes 7 et 8) ;
   - le corps est teint par zones (peau, habit, culotte, guêtres) grâce à un numéro de zone peint par sommet dans
     Blender, en attendant l'atlas (F4).
5. Les versions de loin ne changent pas (elles changeront avec F5).

**Fichiers.** `dev/soldat.py`, `dev/soldat.mjs`, `web/anims/corps.*`, `web/anims/LICENCE.txt`, `troupes.js`,
`qualite.js` (quand utiliser le modèle près), `tests/corps.test.mjs`.

**Coût.** Haute et Ultra seulement pour le modèle près ; Basse et Moyenne gardent les figurines actuelles.

**Test.**
- Le fichier cuit se relit (nombre de sommets, d'os, poids normalisés).
- Chaque geste du soldat joue sans pied qui flotte ni bras qui traverse le corps (banc `?scen=`, captures à 5, 20 et
  60 m).

**Fini quand.** À 10 m, côte à côte avec une capture d'UGAR, on ne voit plus « une figurine de code ». Les images par
seconde de l'iPad en Haute ne baissent pas de plus de 10 %.

### E2. Le canon (« Napoleonic Era Cannon », MenOfMena, CC-BY)

**Ce que verra le joueur.** De près, une pièce de bronze aux formes justes : tourillons, renforts, flasques et roues à
rayons.

**Comment.**

1. Copier le glTF dans un dossier vide à part ; noter auteur, lien et licence CC-BY dans `web/anims/LICENCE.txt`, et
   l'auteur dans le README (sources).
2. Blender : alléger à 2 000 triangles ; séparer le tube (il recule au tir) de l'affût ; ramener les couleurs à celles
   des époques (bronze, affût vert olive Gribeauval, bois naturel avant 1765).
3. Cuire en `web/anims/canon.*` ; dans `troupes.js`, `gun()` prend le modèle cuit pour les générations « ancien »,
   « gribeauval » et « valée » vues de près, le recul du tube restant sur l'os 1.
4. Avant-trains et caissons : inchangés (construits par le code).

**Test.** Le recul du tube, le pointage et la mise en batterie jouent comme avant ; aucune pièce rayée ne reçoit le
modèle.

**Fini quand.** À 15 m, la pièce tient la comparaison avec UGAR ; l'auteur est crédité.

### E3. Le cheval de henry_7 (CC-BY, Sketchfab), en option

À ne faire que si le cheval Quaternius (livré, `8584bd4`) paraît trop simple de près, une fois E1 en place. Même chaîne
que le cheval actuel (`dev/cheval.mjs`), auteur crédité.

---

## Partie F : le rendu des batailles (reste de SPEC-RENDU)

Chaque point renvoie à sa section de `SPEC-RENDU.md`, qui garde le détail technique.

### F1. Atmosphère, ciel et eau (9g ; A6, A7)

**Ce que verra le joueur.**
- Des lointains bleutés et plus clairs du côté du soleil.
- Des vallées plus brumeuses le matin.
- Un vrai ciel au-dessus de l'horizon (visible avec la caméra en biais) : dégradé, halo du soleil, nuages en couches,
  couchant coloré.
- De l'eau qui bouge et reflète le ciel.

**Comment.**
1. Brouillard maison à la place de `THREE.Fog` (`relief.js`, ligne `scene.fog`) :
   - épaisseur selon la distance et l'altitude ;
   - teinte vers le soleil ;
   - couleurs et forces prises dans la table des heures (`heures.js`, colonnes nouvelles `brume`, `brumeH`).
   Un même bout de shader, posé avec `ombrage`, sur tous les matériaux (sol, troupes, arbres, maisons, fumée).
2. Ciel : une sphère avec son propre shader :
   - dégradé et halo du soleil ;
   - deux couches de bruit qui défilent pour les nuages ;
   - dans la même texture de nuages que leurs ombres au sol, pour que les ombres correspondent aux nuages.
3. Eau (A6) : matériau à part (pas de texture en plus dans le sol) :
   - normales qui défilent dans le sens du courant ;
   - Fresnel vers la couleur du ciel, reflet doré du soleil bas ;
   - couleur selon la distance à la berge, écume le long des berges et des piles de ponts.
4. Météo : la pluie assombrit et fait luire le sol (un peu de spéculaire), le brouillard mange les couleurs, la neige
   bleuit les ombres (une ligne par météo dans `heures.js`).

**Coût.** Basse : brouillard simple, ciel dégradé, eau sans normales. Moyenne : tout sauf les nuages en couches. Haute
et Ultra : tout.

**Test.** `heures.test.mjs` étendu (les nouvelles colonnes existent pour chaque heure et chaque météo) ; captures à
6 h, 12 h et 19 h, par temps clair et sous la pluie.

**Fini quand.** À la vue d'ensemble, la profondeur des captures d'UGAR (perspective aérienne) se retrouve, et le ciel
n'a plus d'arête nette à l'horizon.

**Livré le 20/10/2026** (`ciel.js`, brume dans `apres.js`, eau dans `relief.js`, colonnes `zen`, `voile`,
`vallee` de `heures.js`). La brume est calculée dans l'après-rendu, depuis la profondeur de l'image (Moyenne et
au-delà) ; en Basse, la brume de Three.js reste. L'eau est repérée dans le shader du sol (aucun sol photo n'y est
mélangé) : pas de texture en plus. Écart : pas de couleur selon la profondeur de l'eau (le masque ne la donne pas), et
la pluie ne fait pas encore luire le sol (avec F8). Trouvé en le réglant : les couleurs de la table sont en sRGB ; le
bleu du zénith doit passer en linéaire, sinon l'ACES le blanchit.

### F2. Le métal et l'occlusion des figurines (fin de 9h ; B1)

- **Reflets** sur les baïonnettes, plaques de shako, cuivres, fûts de bronze : un terme spéculaire sur les seules pièces
  marquées « métal », qui scintille le long d'une ligne quand le soleil est bas. Haute et Ultra.
- **Occlusion par sommet** calculée une fois par modèle construit (sous les bras, entre les jambes, sous le chapeau),
  et rangs arrière un peu plus sombres. Toutes qualités (coût nul en jeu).
- Fichiers : `troupes.js`, `formes.js`. Test : les attributs existent et restent entre 0 et 1.

### F3. Le sol : la fin de A1

- **Courbure** : creux un peu plus verts et sombres, crêtes plus sèches et claires (calculée avec les normales fines de
  9c, rangée dans un canal libre ; pas de texture en plus).
- **Triplanaire** sur les pentes raides (talus, ravins) : en Haute et Ultra seulement.
- **La neige comme 9ᵉ sol**, qui tient moins sur les pentes raides et s'efface sous le piétinement (aujourd'hui la
  matière s'efface à 30 % sous la neige).
- Fichiers : `relief.js`, `sols.js`. Attention à la limite des 16 textures : ranger avant d'ajouter (voir SPEC-RENDU,
  « Contrainte apparue »).

### F4. L'atlas d'uniformes (9i ; B2)

**Ce que verra le joueur.** De près : boutons, galons, revers, parements, épaulettes, buffleteries croisées, giberne,
guêtres, plis ; visages avec sourcils et yeux ; cocardes et plumets ; drapeaux régimentaires peints (croix, devises,
franges) ; robes des chevaux avec balzanes.

**Comment.**
1. Coordonnées de texture sur chaque pièce construite par le code (dépliage cylindrique ou plan) et sur le corps de E1.
2. Atlas peint au chargement sur un canevas de 1 024 px (2 048 en Ultra), une case par uniforme et par époque, depuis
   les tables d'uniformes de l'étape 8.
3. La couleur du camp reste un canal à part : la règle de l'étape 8 (camp lisible aux revers et parements) tient.
4. Usure : bas des habits salis de boue au fil de la bataille, habits plus foncés sous la pluie.
5. Normales peintes (plis, coutures) en Haute et Ultra.

**Fichiers.** Nouveau `uniformes-atlas.js`, `troupes.js`, `formes.js`, `qualite.js`, `tests/atlas.test.mjs` (chaque
uniforme de chaque époque a sa case ; le canal du camp est rempli).

**Fini quand.** À 5 m, on lit les boutons et les buffleteries ; à la vue d'ensemble, rien ne scintille.

### F5. La foule de loin (9k ; B3, B5, A5.2)

1. **Imposteurs animés** : chaque geste principal (marche, en joue, recharge, course, repos) rendu au chargement sous
   8 angles dans un atlas ; au-delà d'une distance réglée par qualité, un quad par homme au lieu de la figurine.
2. Budgets relevés : par exemple Haute de 10 000 à 16 000 hommes dessinés, à mesurer.
3. **Fusils jamais plus fins qu'un pixel** (épaisseur réglée par la distance dans le vertex shader).
4. **Animation secondaire** : basques, sabretaches, plumets au vent, havresac qui rebondit.
5. **Pieds posés sur la pente** (correction dans le vertex shader avec la texture d'altitude).
6. **Imposteurs d'arbres** (A5.2), seulement si l'iPad peine avec les bois actuels.

**Fini quand.** À la vue d'ensemble, un régiment montre « un homme par figurine » comme UGAR, sans perte d'images par
seconde sur l'iPad en Haute.

### F6. La lisibilité (9l ; B6, B7)

- **Lignes de front** : un ruban à la couleur du camp, au sol, entre les régiments au contact, qui ondule doucement
  (calque 2D, comme les flèches de `interface.js`).
- **Mode ligne de vue** : en maintenant un bouton, ce que voit le régiment choisi reste clair, le reste s'assombrit.
  Carte de visibilité calculée dans le navigateur (altitudes et opacité des cases, que le client a déjà), sans toucher
  au moteur.
- **Sélection** : un anneau lumineux au sol, à la forme de la formation.
- **Fumée** : fondu selon la profondeur là où elle coupe le sol (passe d'après-rendu), éclairs de bouche qui éclairent
  un instant le sol et les hommes proches, fumée de canon plus grise et plus haute que celle de la mousqueterie.

**Livré le 20/10/2026** (`visibilite.js`, `vue.js` drawGround et updateLos, bouton du panneau et touche V,
`effets.js`) : lignes de front entre régiments ennemis au contact (feu, recharge, mêlée, charge ; pas avec un ennemi
qu'on ne voit plus), anneau lumineux du régiment choisi, mode ligne de vue (calculé en 3 ms sur un PC, recalculé quand
le régiment change de case, passé au sol par la texture des couverts : aucune texture en plus), fumée de canon plus
grise qui monte plus haut. Écarts : les haies ne comptent pas dans la ligne de vue du navigateur ; pas encore de fondu
de la fumée selon la profondeur, ni d'éclairs qui éclairent le sol (à reprendre avec F8).

### F7. Les haies (A5.6)

Les haies du bocage cessent d'être des bandes extrudées : des touffes de feuillage serrées (le shader `feuillage` des
bois), pied sombre, teintes variées, quelques arbres têtards qui dépassent. Fichiers : `decor.js`, `terrain.js`.

### F8. Les traces de la bataille : la fin de A4

1. **La boue enregistrée avec la bataille** (selon D6) : une bataille rechargée garde ses traces.
2. **Ornières** des pièces et des caissons : deux traits parallèles derrière chaque batterie qui se déplace.
3. **Débris** au fil de la bataille : chapeaux, fusils, havresacs, roues brisées près des pièces, en petites instances,
   plafonnés comme les corps.
4. **Gerbe de terre** autour des trous d'obus, blé couché autour.
5. **Boue luisante** sous la pluie (avec le spéculaire de F1).

Fichiers : `pietinement.js`, `effets.js`, `vue.js` ; pour D6, `game/tactics/battle.py` et la route de sauvegarde du
serveur, plus un test Python (une ancienne sauvegarde sans boue se charge).

### F9. Les rangs d'arbres le long des chemins creux (SPEC-CARTES, C3.3)

Le générateur de cartes de bataille plante des rangs d'arbres le long de certains chemins creux. Comme pour le verger,
la carte change : le générateur passe en version 3, et la version 2 est figée dans un `terrain_v2.py` à ne jamais
modifier, pour que les batailles en cours des sauvegardes gardent leur carte. Test : `tests/test_cartes.py` étendu.

---

## Partie G : la carte de campagne (reste de SPEC-RENDU, partie D)

Livré le 20/10 (`810efca`) : relief ombré, saisons, côtes, forêts, plaques, fanions, interface en ardoise.

### G1. Les panneaux comme UGAR

**Ce que verra le joueur.**
- En bas à droite, un panneau de la date (« 1er mars 1700 », le moment du jour) et des commandes de temps.
- En bas, quand une armée est choisie, ses régiments en **cartes portrait** (comme en bataille : figurine peinte,
  effectif, état).
- En bas à gauche, un résumé de la sélection (« Régiments choisis : 2, hommes : 5 118 »).

**Comment.** Sortir le dessin des portraits (méthode `figure()` de `BattleUI`, `web/js/battle/interface.js`) dans un
module partagé, pour s'en servir aussi dans `ui.js` ;
`style.css` reprend les classes `bt-` du thème ardoise. Le bouton « Tour suivant » rejoint le panneau de la date ;
la barre du haut garde les ressources.

**Test.** `interface.test.mjs` : les cartes d'une armée choisie existent, une par régiment ; aucun texte ne sort de son
cadre à 768 px de large (iPad en portrait).

**Livré le 20/10/2026** (`portraits.js`, `ui.js` cardsHtml et drawCards, `style.css`) : les régiments de l'armée
choisie en cartes portrait dans son panneau (au-dessus de la liste détaillée, qui reste pour les armes, munitions et
endurance) ; un appui coche le régiment comme la case de la liste. Le dessin des portraits est sorti de
`interface.js` dans `portraits.js`, partagé par la bataille et la campagne. La date passe en bas à droite au-delà de
1 100 px de large. Écart : le bouton « Tour suivant » reste en haut (il est l'action la plus fréquente).

### G2. Les portraits des généraux

Un médaillon rond au-dessus de chaque armée qui a un général, avec son nom sur une plaque (comme « WASHINGTON » dans
UGAR). Portrait peint par le code (D4), mis en cache par général. Visible à partir d'un zoom moyen ; au loin, seul le
fanion reste.

### G3. Les armées en figurines

Au zoom rapproché, les blocs vus de dessus (`drawFoot`, `drawHorse`, `drawGuns` dans `map.js`) deviennent de petites
figurines en vue cavalière :
- fantassins en rangs ;
- cavaliers ;
- pièces attelées ;
- un porte-drapeau en tête.

Peintes dans un atlas au chargement depuis les mêmes figures que les cartes portrait, aux couleurs de l'époque et du
camp. Elles marchent (balancement) quand l'armée bouge.

**G2 et G3 livrés le 20/10/2026** (`portraits.js` portraitGeneral et traitsGeneral, `map.js` medallion, figArt et
drawFormation) : médaillon du général à droite du jeton (zoom moyen) et à gauche de la formation (de près, pour ne pas
cacher le nom de la place) ; de près, les régiments en figurines debout de l'imagier des cartes (unites.js), rangées
sur leur emprise teintée, triées de loin en près. Écart : les figurines ne marchent pas encore (pas de balancement).

### G4. La vue inclinée (selon D2)

**Ce que verra le joueur.** La carte vue en biais comme dans UGAR : relief en volume, horizon brumeux au loin, forêts
et villes debout.

**Comment (maquette d'abord).**
1. Un maillage du relief de toute la carte (272 × 337 cases d'1 km, affiné à 4 points par km près de la caméra), teint
   par la couche des terres peinte par `paintLand` (on la garde).
2. Forêts en arbres instanciés (comme `herbe.js`), villes en sprites debout (les dessins de `towns.js` sur des quads),
   armées en figurines (G3) sur des quads.
3. Caméra des batailles (`camera.js`) adaptée : inclinaison qui se redresse en zoomant, limites de la carte.
4. Tout ce qui se clique (villes, armées, chemins, gestes) garde la même logique, avec un lancer de rayon au lieu de
   `toWorld`.

**Coût.** Très grand (la carte compte 2 600 lignes, plus `ambient.js` et `towns.js`). La maquette (relief, forêts,
villes, caméra, sans clics) est faite et mesurée sur l'iPad avant toute décision d'aller au bout. La vue 2D actuelle
reste disponible (option, et repli si WebGL 2 manque).

**Fini quand.** La maquette tourne à 30 images par seconde sur l'iPad en Haute ; tu juges la ressemblance sur
captures.

### G5. Le temps de chargement sur le Raspberry Pi

`paintLand` prend 0,1 s sur un PC, peut-être 1 s sur le Pi, au chargement et à chaque changement de saison. Si c'est
gênant : peindre la saison suivante en tâche de fond pendant la saison en cours (un `requestIdleCallback` par bande de
lignes), et ne jamais bloquer l'affichage.

---

## Partie H : la carte selon l'époque (SPEC-TECH, phases 2b à 2d)

Les déclencheurs sont ceux de `rules.VISUALS` : la technologie du camp qui tient la place, ou l'année. Tout se dessine
dans le style UGAR livré le 20/10 (D3).

### H1. Télégraphes, vapeurs et usines (2b)

- **Tours Chappe** aux bras mobiles sur les hauteurs, entre les villes d'un camp qui a `chappe`. Elles « battent »
  quand une dépêche part (un ordre donné à une armée lointaine).
- **Poteaux et fil** le long des voies ferrées et des routes royales, avec `telegraphe`.
- **Bateaux à vapeur** à roues parmi les gabares, sur les fleuves d'un camp qui a `vapeur_fluviale`, avec leur panache.
- **Cheminées d'usine** qui fument dans les villes qui ont une Fabrique, ou dans toutes les villes d'un camp qui a
  `vapeur`.
- La nuit : **lueur rouge des forges** (`hauts_fourneaux`, `coke`), **réverbères** dans les villes (`gaz`).
- **Faisceau de Cordouan** plus long avec `fresnel`.

Fichiers : `ambient.js` (vie de la carte), `towns.js` (cheminées, réverbères), `map.js` (poteaux le long des routes,
peints dans les tuiles), `game/rules.py` (`VISUALS`). Test : un état fabriqué en 1850 avec et sans chaque technologie ;
les marques apparaissent seulement chez le camp qui l'a.

### H2. Le paysage (2c)

- **Les pins gagnent les Landes** : la lande rase et ses bergers sur échasses reculent case par case avec `pins` puis
  `landes1857` (des cases converties au fil des années, tirées d'un ordre fixe pour être les mêmes d'une partie à
  l'autre). Pots de résine et résiniers avec `gemmage`.
- **Les marais rétrécissent** avec `drainage`.
- **Les vignes brunissent** au phylloxéra (l'événement de 1875), puis renaissent en rangs palissés avec `greffe`.
- **Champs plus variés** avec `assolement`, maïs en Chalosse et en Béarn avec `mais`, moissonneuses l'été avec
  `moissonneuses`.

Le terrain des règles ne change pas (une case de lande reste « lande » pour la marche) : seul le dessin change. Si on
veut que les pins changent les règles, c'est une décision à part, avec un banc d'équilibre.

Fichiers : `map.js` (`paintLand` et `decorate` lisent une couche « époque » envoyée avec l'état), `ambient.js`
(bergers, moissonneuses).

### H3. L'allure (2d)

- **Drapeau d'époque** au-dessus de chaque ville : la table des drapeaux de la phase 1, côté carte (blanc fleurdelisé,
  tricolore en 1790, aigle de l'Empire, blanc en 1815, tricolore en 1830).
- **Passants de l'époque** sur les routes : tricorne, puis bicorne, puis haut-de-forme.
- **Villes qui changent** : remparts démolis et allées (Tourny à Bordeaux, 1750), boulevards et gares au XIXe.
- **Teinte d'époque** sur le style UGAR (D3) : un peu plus sépia et des écritures plus anciennes au XVIIIe, des
  couleurs plus franches au XIXe. Le style « d'époque » complet (Cassini, état-major) devient une option d'affichage.

---

## Partie I : les découvertes (SPEC-TECH, phase 3)

**Ce que verra le joueur.**
1. **Mise en scène sur la carte** pour la vingtaine de technologies qui s'y voient : la caméra va au chef-lieu, la
   nouveauté apparaît :
   - les rails se tracent et le premier train part ;
   - les tours Chappe se dressent ;
   - les fabriques se mettent à fumer ;
   - les pins gagnent la lande.
   Durée 4 à 6 s, passable d'un toucher.
2. **Fenêtre de découverte** pour toutes les autres, dans le thème ardoise. Elle porte :
   - le titre, la date et une citation d'époque ;
   - les effets en clair ;
   - une vignette animée par le code (D5 : une dizaine de familles : vapeur, canon qui tire, moisson, vigne, presse,
     médecine…).
3. **Frise chronologique** des découvertes dans le panneau des recherches : les siennes et celles connues des autres
   camps.
4. **Bandeau des IA** : « Le Périgord a le chemin de fer », avec un éclat sur la carte au chef-lieu, sans arrêter le
   jeu.

**Fichiers.** Nouveau `web/js/decouvertes.js`, `ui.js`, `map.js` (mise en scène), `style.css`. Le moteur envoie déjà
les recherches terminées dans l'état ; on y ajoute seulement la date de chaque découverte pour la frise (petit
changement du moteur, à confirmer au plan).

**Test.** Un état fabriqué où une technologie vient d'être trouvée : la fenêtre s'ouvre une seule fois, la mise en
scène se lance pour une technologie « de carte », la frise la montre ; une découverte d'IA donne un bandeau et rien
d'autre.

---

## Partie J : le décor des batailles selon l'époque (SPEC-TECH, phase 4)

Le générateur de cartes de bataille et le décor reçoivent l'année et les marques de chaque camp (`marks`, déjà
envoyées).

- **Voie ferrée** qui traverse le champ si la région a le rail ; poteaux télégraphiques le long des routes ; ponts de
  pierre au lieu des gués après les `ponts`.
- **Cheminées d'usine** au loin près des villes, réverbères dans les villages après 1830.
- **Cultures de l'époque** : maïs en Chalosse, vignes en foule avant le phylloxéra puis en rangs palissés, pins plantés
  en lignes après 1857, meules, machines agricoles après 1855.
- **Retranchements** visibles devant l'infanterie qui se retranche (`retranchements`, déjà dans les règles) :
  tranchées, gabions, abattis.
- **Ballon captif** au-dessus de l'état-major d'un camp qui a `aerostiers` (la règle existe : il voit à 1 500 m).
- **Ambulances** : brancardiers et voitures de Larrey à l'arrière, croix rouge après 1864 (`croix_rouge`).

Ce qui change la carte (voie ferrée, cultures, ponts) passe par la version du générateur (comme F9) ; tout le reste
n'est que du décor. Fichiers : `game/tactics/terrain.py` (version suivante), `decor.js`, `terrain.js`, `troupes.js`
(ambulances), `effets.js` (ballon).

---

## Partie K : vérifications et dettes

- **Essai sur l'iPad en qualité Haute** (la qualité automatique peut redescendre en Basse ; on la règle à la main) :
  images par seconde en bataille avec l'herbe, le cheval et la fumée ; puis après chaque partie de E et F.
- **Essai sur le Raspberry Pi** : chargement de la carte de campagne (G5).
- **Ton avis sur la ressemblance** : batailles, carte de campagne, interface, sur captures côte à côte.
- **Deux tests de campagne en échec sur `main`**, sans rapport avec le rendu :
  - `test_deux_decisions_au_meme_moment` ;
  - `test_une_decision_arrete_le_tour_des_ia_puis_il_reprend` (`tests/test_campagne.py`).
  À examiner à part : soit le test, soit le tour par tour a dérivé.

## Livraison (ordre proposé)

| Ordre | Étape | Contenu | Dépend de | Effet |
|---|---|---|---|---|
| 1 | F1 `atmosphere` | brouillard, ciel, eau, météo | — | ★★★ la vue d'ensemble prend sa profondeur |
| 2 | G1 `panneaux-campagne` | date en bas à droite, cartes portrait, résumé | — | ★★ |
| 3 | E1, E2 `figurines` | soldats et canon téléchargés | D1 | ★★★ de près |
| 4 | F4 `uniformes` | atlas d'uniformes | E1 de préférence | ★★★ de près |
| 5 | F6 `lisibilite` | lignes de front, ligne de vue, sélection, fumée | — | ★★ |
| 6 | G2, G3 `generaux-figurines` | portraits, armées en figurines sur la carte | D4 | ★★ |
| 7 | F2, F3, F7, F8 `finitions` | métal, occlusion, sol, haies, traces | D6 pour la boue | ★★ |
| 8 | F5 `foule` | imposteurs, budgets, animation secondaire | F4 | ★ de loin |
| 9 | H1 à H3 `carte-epoque` | télégraphes, vapeurs, usines, paysage, allure | D3 | ★★ |
| 10 | I `decouvertes` | mise en scène, fenêtre, frise, bandeau | H, D5 | ★★ |
| 11 | J `bataille-decor` | décor des batailles selon l'époque | H | ★★ |
| 12 | F9 `rangs-arbres` | rangs d'arbres des chemins creux (générateur v3) | — | ★ |
| 13 | G4 `vue-inclinee` | maquette, puis la suite si elle est retenue | D2, G3 | ★★★ |

E1 et E2 passent en tête dès que les fichiers sont là, quel que soit l'ordre ci-dessus.

## Stratégie de test

- **Bancs existants** à chaque étape : tous les tests JavaScript (`tests/*.test.mjs`) et Python (`tests/test_*.py`),
  sauf les deux échecs connus (K).
- **Un test par module nouveau** (`corps`, `canon`, `atlas`, `decouvertes`, etc.) : données cuites relues, tables
  complètes pour chaque époque, rien en dehors des bornes.
- **Captures** : banc des batailles (`dev/banc.html?scen=…`, maquette sur le port 8816) et vraie partie, aux mêmes vues
  et heures que les captures de référence ; galerie (port 8799) pour la carte selon l'époque.
- **Qualité réglée à la main** avant de juger une image : `localStorage['conquete.bataille.qualite']='haute'` (le
  navigateur de test redescend sinon en Basse).
- **Vieilles sauvegardes** : une sauvegarde d'avant chaque étape qui touche au moteur ou au générateur se charge et se
  joue un an (ou une bataille) sans erreur.
- **Équilibre** : le banc des 40 batailles du 20/10 (40 batailles isolées menées par les officiers des deux camps,
  mêmes graines ; à ranger dans `outils/` au premier usage) avant et après F9 et J ; le banc de campagne avant et
  après H2 si les pins touchent un jour aux règles.

## Limites

- **Toujours** : Three.js r186 seul, hors ligne ; une licence à côté de chaque fichier ajouté ; l'auteur crédité pour
  le CC-BY ; tout borné par la qualité ; mémoire GPU libérée à la sortie.
- **Demander d'abord** : toute bibliothèque en plus ; tout changement du moteur Python (D6, la date des découvertes) ;
  une taille du jeu qui dépasse 40 Mo ; chaque téléchargement (modèle, gravure).
- **Jamais** : un fichier, une texture, un modèle ou un réglage repris d'UGAR ; un compte créé ou un mot de passe saisi
  à ta place ; casser une partie sauvegardée ; modifier `terrain_v1.py`.

## Critères de réussite

1. Côte à côte avec les captures d'UGAR, à la vue d'ensemble et à mi-distance, un œil non averti ne sait plus lequel
   est lequel (batailles), et la carte de campagne en a l'allure (couleurs, panneaux, généraux, armées).
2. De près : soldats, canons et chevaux crédibles, uniformes avec boutons et buffleteries, reflets du métal.
3. Les époques se voient sur la carte et en bataille, sans casser le style.
4. L'iPad tient 30 images par seconde en Haute, en bataille comme sur la carte.
5. Aucune erreur dans la console ; tous les bancs passent, avec les nouveaux ; les vieilles sauvegardes se chargent.
6. Le README décrit chaque nouveauté et la source de chaque fichier ajouté.

## Questions ouvertes

- D1 à D7 ci-dessus.
- Le poids réel des modèles cuits (E) et des imposteurs (F5) : à mesurer dès E1.
- Le coût de la vue inclinée (G4) sur l'iPad : la maquette le dira.
- Faut-il que les pins des Landes (H2) changent aussi les règles (couvert, marche) ? C'est du jeu, pas du rendu : à
  décider à part, avec un banc d'équilibre.
