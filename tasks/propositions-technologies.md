# Propositions : les technologies et le rendu qui suit l'époque (1700-1899)

Document de travail du 18/10/2026, avant spec. Il fait le point sur ce qui existe, puis propose, axe par axe,
ce qu'on peut faire, avec une recommandation. Une fois tes choix faits : `/spec` puis `/plan` par phase.

## Tes choix (questionnaire du 18/10/2026)

- **Tout le rendu** : phases 1 à 4.
- **Monde mixte** : les nouveautés suivent les technologies de chaque camp, et les lignes se construisent peu à peu
  depuis le chef-lieu en suivant les tracés historiques.
- **Découverte** : mise en scène sur la carte pour les technologies qui s'y voient, fenêtre « gravure » pour les
  autres, frise chronologique, bandeau quand une IA découvre.
- **Branche « civil et social »** : « civil » renommée, les technologies sociales y vont.
- **Nouvelles technologies** : toutes celles du tableau 1b.
- **Liens avec le jeu dès la phase 2** : les armées prennent le train sur les lignes construites.
- **Méthode** : phase par phase (spec, plan, construction par petites étapes, galerie, revue), en commençant par
  les phases 0 et 1.

## 0. Ce qui existe déjà

- **73 technologies** en quatre branches (militaire, civil, industriel, agricole), chacune avec une année
  d'apparition (`rules.TECH_YEAR` : on ne cherche pas la vapeur en 1700). Le train y est déjà : `chemins_fer`,
  disponible dès 1841 (Bordeaux–La Teste), donc un peu avant 1850.
- **7 époques** (`rules.ERAS`), de Louis XIV à la IIIe République, et une trentaine d'événements datés.
- **Armement par régiment** (`rules.ARMS`) : 8 générations de fusils (mousquet et piques → Lebel), 7 d'artillerie
  (canons de bronze → canon de 75). Ça change déjà les portées et le rechargement en bataille.
- **Ce qui suit l'année à l'écran** : uniformes et coiffures (tricorne, bicorne, shako, ourson, képi, capote dès 1860)
  et noms des troupes.
- **Ce qui ne la suit pas** :
  - une découverte, c'est une ligne dans le journal et dans le bilan du tour ;
  - la carte de campagne est la même en 1700 et en 1899 : charrettes, gabares à voile, moulins, bacs ;
  - en bataille : même fumée, mêmes fusils et mêmes canons de 1700 à 1899, pas de piquiers avant la baïonnette,
    fanions carrés à la couleur du camp, même décor ; la bataille ne reçoit des technologies du camp que
    l'artillerie à cheval (`tactics/bridge.py`) ;
  - pas de son dans le jeu.

## 1. Mettre l'arbre à jour

### 1a. Dates

Les dates de `TECH_YEAR` sont justes pour l'essentiel. Une incohérence : l'époque « Restauration » annonce les
premières gabares à vapeur sur la Garonne, mais aucune technologie ne les porte (voir 1b).

### 1b. Technologies qui manquent (proposition, chacune avec ce qu'elle montrerait)

| Branche | Technologie | Année | Effet possible | Ce qu'on verrait |
|---|---|---|---|---|
| militaire | Aérostiers (Fleurus) | 1794 | vision en bataille | ballon captif au-dessus du camp |
| militaire | Dynamite et mélinite | 1867 / 1885 | sièges plus rapides | explosions, brèches |
| militaire | Retranchements de campagne | 1860 | défense à couvert | tranchées, gabions, abattis |
| militaire | Chemins de fer militaires | 1859 | armées transportées par le rail | trains de troupes |
| civil / social | Vaccine (Jenner) | 1800 | usure −, population + | — (fenêtre de découverte) |
| civil / social | Caisse d'épargne | 1819 | livres + | — |
| civil / social | Éclairage au gaz | 1830 | ordre public + | réverbères la nuit dans les villes |
| civil / social | Photographie | 1839 | prestige, reconnaissance | — |
| civil / social | Suffrage universel | 1848 | ordre +, révoltes − | — |
| civil / social | Croix-Rouge (Genève) | 1864 | pertes − | brassards et fanions à croix rouge, ambulances |
| civil / social | Sociétés de secours mutuels, syndicats | 1852 / 1884 | ordre public + | — |
| civil / social | Téléphone | 1879 | vision des villes + | fils sur poteaux |
| industriel | Bateau à vapeur | 1818 | fleuves plus rapides | vapeurs à roues sur la Garonne |
| industriel | Phare à lentille de Fresnel (Cordouan) | 1823 | ports + | faisceau tournant de Cordouan |
| industriel | Ciment (Vicat) | 1817 | constructions moins chères | — |
| agricole | Sucre de betterave | 1812 | vivres + | — |
| agricole | Charrue Dombasle | 1820 | vivres + | labours plus nets |
| agricole | Moissonneuses et batteuses à vapeur | 1855 | vivres + | machines dans les champs l'été |
| agricole | Bouillie bordelaise (Millardet) | 1885 | vin + | vignes qui reverdissent |

Toutes facultatives : on peut en prendre trois ou toutes.

### 1c. La branche « social »

- **A (recommandé)** : renommer « civil » en « civil et social » et y ranger les nouvelles technologies sociales.
  Rien ne change pour l'IA, l'interface ni les sauvegardes.
- **B** : une cinquième branche « social ». Plus clair, mais il faut revoir le panneau des recherches, les goûts des
  IA (`pers['tech']`, `cities.AI_TASTE`), l'équilibre et les sauvegardes.
- **C** : ne rien changer.

## 2. Le socle commun (une seule source de vérité)

Une petite table `rules.VISUALS` : pour chaque marque visible (rail, vapeur fluviale, Chappe, télégraphe, gaz,
fabriques, pins des Landes, phylloxéra, poudre sans fumée, piques, modèle de canon…), la technologie ou l'année qui
la déclenche. La carte et la bataille la lisent, au lieu de semer des `if (year < …)` partout.

À ajouter côté serveur : envoyer à la bataille les technologies de chaque camp (aujourd'hui seulement
l'artillerie à cheval).

Question de fond : **le monde suit-il l'histoire, ou les technologies de chaque camp ?**
- **Historique** : en 1841 les rails apparaissent partout, que vous ayez cherché ou non. Simple, fidèle.
- **Par camp** : les rails n'apparaissent que sur les terres des camps qui ont la technologie. On voit l'avance
  d'un voisin.
- **Mixte (recommandé)** : par camp, et les lignes se construisent peu à peu (quelques dizaines de km par tour à
  partir du chef-lieu, en suivant les grandes routes et les tracés historiques : Bordeaux–La Teste 1841,
  Bordeaux–Paris 1853, Bordeaux–Sète 1857, Bordeaux–Bayonne 1855…).

## 3. L'animation de la découverte

| Option | Ce que c'est | Coût |
|---|---|---|
| A. Fenêtre « gravure » | Titre, date, une citation d'époque, les effets, et une gravure du domaine public (Wikimedia Commons, licence vérifiée image par image) | petit, mais 75 à 95 images à choisir |
| B. Vignette animée | Une petite scène dessinée en canvas, comme la vie de la carte (`ambient.js`) : une dizaine de familles (train, vapeur, cheminée d'usine, Chappe qui bat des bras, canon qui tire, moisson, vigne…), chaque technologie prend celle de sa famille | moyen |
| C. Mise en scène sur la carte | La caméra va au chef-lieu et la nouveauté apparaît : les rails se tracent et le premier train part, les tours Chappe se dressent, les fabriques fument, les pins gagnent la lande | moyen, seulement pour les ~20 technologies qui laissent une trace sur la carte |
| D. Diorama 3D | Un modèle qui tourne (locomotive, canon de 75…) avec le moteur des batailles | grand : modèles CC0 à trouver ou à faire, lourd sur iPad |

**Recommandé** : C pour les technologies qui se voient sur la carte, A (ou B) pour les autres, plus une
**frise chronologique** des découvertes dans le panneau des recherches. Les découvertes des IA : un court bandeau
(« Le Périgord a le chemin de fer ») et un éclat sur la carte, sans arrêter le jeu.

## 4. La grande campagne : une carte qui change avec les siècles

| Branche | Technologie | Changement sur la carte |
|---|---|---|
| civil | `chemins_fer` | voies ferrées le long des grandes routes, gares, trains animés avec leur panache |
| civil | `ponts` | ponts de pierre à la place des bacs (les bacs sont déjà dessinés) |
| civil | `chappe` puis `telegraphe` | tours Chappe sur les hauteurs, puis poteaux le long des voies ferrées |
| civil | `ponts_chaussees`, `poste` | routes empierrées plus nettes, relais de poste |
| civil | éclairage au gaz (nouveau) | réverbères dans les villes la nuit |
| industriel | `vapeur`, `Fabrique` | cheminées d'usine qui fument dans les villes équipées |
| industriel | `hauts_fourneaux`, `coke` | lueur des forges la nuit |
| industriel | bateau à vapeur (nouveau) | vapeurs à roues parmi les gabares |
| industriel | Fresnel (nouveau) | faisceau de Cordouan plus long |
| agricole | `pins`, `landes1857` | la lande rase et les bergers sur échasses laissent peu à peu place à la forêt de pins |
| agricole | `gemmage` | pots de résine, résiniers |
| agricole | `drainage` | les marais rétrécissent |
| agricole | `chais`, phylloxéra, `greffe` | vignes qui brunissent (1875-1890) puis replantées en rangs |
| agricole | `assolement`, `mais` | champs plus variés, maïs en Chalosse et Béarn |
| agricole | moissonneuses (nouveau) | machines dans les champs l'été |

Et selon l'époque, sans technologie :
- **drapeaux sur les villes** : blanc fleurdelisé, tricolore (1790), aigle (Empire), blanc (1815), tricolore (1830) ;
- **passants sur les routes** : tricornes, puis hauts-de-forme ;
- **villes** : remparts démolis et allées (Tourny à Bordeaux, 1750), boulevards et gares au XIXe ;
- **style de la carte** (facultatif) : façon carte de Cassini au XVIIIe, façon carte d'état-major au XIXe.

## 5. Les batailles : l'année et les technologies de chaque camp

### Militaire (le plus visible)
- **Armes par régiment** : piquiers dans les rangs avant la baïonnette, fusil à silex, fusil rayé, Chassepot avec
  tir à genou et couché (la description le promet déjà), Lebel et sa cadence.
- **Poudre noire puis sans fumée** : épais nuages blancs jusqu'au Lebel, puis seulement des éclairs. C'est le
  changement le plus frappant de tout le siècle.
- **Artillerie** : quatre ou cinq modèles de pièces : bronze à l'ancienne, Gribeauval (affûts vert olive), Valée,
  rayé La Hitte, de Bange en acier, canon de 75 et son bouclier ; avant-trains et caissons.
- **Mitrailleuse de Reffye** : sa pièce et son crépitement de petits éclairs.
- **Cavalerie** : cuirasses qui brillent (`cuirassiers`), hussards.
- **Génie** : retranchements, gabions et abattis devant le défenseur (`genie`, et tranchées dès 1860-1870).
- **Aérostiers** : ballon captif au-dessus du camp.
- **Ambulances** : brancardiers et voitures de Larrey à l'arrière, croix rouge après 1864.
- **Drapeaux d'époque** portés en 3D par les porte-drapeaux (même suite que sur la carte), à côté des fanions
  carrés qui restent pour la lecture.

### Civil, industriel, agricole (le décor)
- voie ferrée qui traverse le champ si la région a le rail ; un train de renforts qui arrive (si on lie au jeu, § 6) ;
- poteaux télégraphiques le long des routes ; ponts de pierre au lieu des gués ;
- cheminées d'usine au loin près des villes, réverbères dans les villages après 1830 ;
- cultures de l'époque : maïs en Chalosse, vignes en foule avant le phylloxéra puis en rangs palissés,
  pins des Landes plantés en lignes après 1857, meules, machines agricoles après 1855.

## 6. Liens avec le jeu (facultatif)

- les armées prennent le train sur les lignes construites, les vapeurs remontent la Garonne ;
- les lignes se construisent (chantier) au lieu d'un bonus de vitesse sur toute route ;
- en bataille : renforts par le rail, ballon qui lève une partie du brouillard (`FOV`), poudre sans fumée qui
  cache le tireur.

C'est du jeu, pas du rendu : à décider à part, avec un banc d'essai d'équilibre.

## 7. Feuille de route proposée

Chaque phase : `/spec`, `/plan`, `/build` par petites étapes, captures dans la galerie (port 8799), essai sur
l'iPad, `/review`.

| Phase | Contenu | Taille |
|---|---|---|
| 0 | Socle `VISUALS`, technologies des camps envoyées à la bataille, mise à jour de l'arbre (1b, 1c) | petite |
| 1 | Batailles, militaire : fumée noire / sans fumée, piquiers, modèles de canons, drapeaux d'époque | moyenne |
| 2 | Carte : rails et trains, Chappe et poteaux, vapeurs, cheminées, pins des Landes, vignes, drapeaux ; les armées prennent le train (choix du 18/10) | grande |
| 3 | Découvertes : mise en scène sur la carte, fenêtre gravure, frise, bandeau des IA | moyenne |
| 4 | Batailles, décor : rail, télégraphe, usines, cultures, ambulances, ballons, retranchements | moyenne |
| 5 | (facultatif) Liens avec le jeu : train, vapeurs, renforts | moyenne |

## Risques

- **iPad et Raspberry Pi** : chaque nouvel objet animé coûte ; garder les instances et le dessin « seulement à
  l'écran, au bon zoom » d'`ambient.js`, et mesurer avec les bancs.
- **Droits** : modèles 3D seulement en CC0 (Quaternius, Poly Pizza) ; gravures seulement du domaine public, licence
  vérifiée image par image.
- **Sauvegardes** : de nouvelles technologies ne cassent rien ; une cinquième branche demande une migration.
- **Exactitude** : chaque date et chaque tracé de ligne à sourcer.
