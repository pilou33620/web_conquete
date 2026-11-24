# Spec : se rapprocher d'Empire Total War (marine, monde, bâtiments, commerce maritime) — 23/11/2026

Demande du joueur : quatre manques par rapport à Empire Total War, à combler :
**2** la marine, **3** la campagne mondiale, **4** les bâtiments à emplacements et le recrutement qui en dépend,
**7** le commerce maritime. **Tout le rendu visuel (bâtiments, animations, navires, comptoirs, routes) se fait dans
web_engine** (`/home/user/web_engine/lib/rendu/`), puis web_conquete l'importe par `outils/maj-graphismes.sh`.
On ne touche jamais `web/graphismes/` à la main (vérifié en CI).

## Choix du joueur (questionnaires du 23/11/2026)

| Question | Réponse |
|---|---|
| Campagne mondiale | **Théâtres reliés par la mer** : les cartes restent à part, une flotte (avec ou sans armée) qui prend une route maritime arrive sur l'autre carte après quelques tours ; une seule partie |
| Théâtres reliés | **Europe + Amérique + Inde** (les autres théâtres et l'Aquitaine restent des parties à part) |
| Bâtiments | **Emplacements comme Empire** : nombre d'emplacements selon la taille de la place, chaînes à niveaux |
| Recrutement | **Lié aux bâtiments, sauf milice et ligne** (cavalerie : haras ; artillerie : fonderie / arsenal ; grenadiers et garde : école militaire ; navires : chantier naval) |
| Batailles navales | **Par stratégie**, comme les batailles terrestres (`SPEC-BATAILLE.md`) |
| Commerce maritime | **Tout** : comptoirs en mer, routes commerciales visibles, denrées coloniales, corsaires |
| web_engine | Fusionné dans `main` de web_engine, version montée, puis importée par web_conquete |
| Maquette | Artefact : galerie 3D des nouveaux bâtiments (époques, couleur du camp, animations) + village d'essai où l'on remplit les emplacements |

## Ce qui existe déjà (relevé du 23/11)

- **Emplacements** : `cities.rs` — `SLOTS` (village 1, fort 1, ville 3, capitale 5, +1 par agrandissement `dev`),
  `CHAINS` (marche, moulins, specialite, atelier, caserne, depot ; 3 niveaux, `tech`, `where` = star | quai, `fx`),
  `check`, `slot_build`, `finish`, `demolish`, `bfx`. File de production `n.queue` (`kind: slot`). On l'étend, on ne
  le réécrit pas.
- **Recrutement** : `engine/economie.rs` `can_recruit`, `recruit` ; `rules.UNITS`. IA : `ai/gouvernement.rs`.
- **Mer** : les armées font déjà du cabotage seules (`engine/chemins.rs`, `SEA_SPEED`, état « à bord », `EMBARK_DAYS`),
  les gabares sur les fleuves ; ports `g.geo.ports`. Aucune flotte.
- **Bataille par stratégie** : `engine/strategie.rs`, `engine/batailles.rs`, `rules.STRATS`, phases, journal.
- **Théâtres** : `geo.rs` `THEATRES` (géographies 5 Europe, 6 Amérique, 7 Inde…), données `game/data/<id>.json`,
  `outils/theatre.mjs`. Une partie = une géographie.
- **web_engine** : `marine.js` dessine déjà flottes (flûte, corvette, frégate, vaisseau, vapeurs), tangage, sillage,
  bataille navale (bordées, fumée, naufrage), chaloupes, blocus, navette commerciale (`majMarine(etat)`,
  `jouerMoisMarine(rapport)`) ; `modeles.js` `BATR` a ~55 bâtiments anciens (caserne, haras, arsenal, fonderie, port,
  comptoir, banque, académie, école, église, entrepôt…) ; `animations.js` `RECETTES` leurs animations.
  web_conquete n'appelle pas encore `marine.js`.

## Carte des modules (un agent par module ; personne ne touche les fichiers d'un autre)

| Module | Dépôt | Fichiers à soi | Dépend de |
|---|---|---|---|
| **W1 bâtiments-rendu** | web_engine | `lib/rendu/modeles.js` (ajouts à `BATR`), `lib/rendu/animations.js` (ajouts à `RECETTES`, nouvelles animations), `maquettes/web_engine/batiments-empire.html` | — |
| **W2 marine-rendu** | web_engine | `lib/rendu/marine.js`, `maquettes/web_engine/marine-empire.html` | — |
| **R1 bâtiments-moteur** | web_conquete | `cities.rs`, `engine/economie.rs` (`can_recruit`), `ai/gouvernement.rs` (choix des constructions), `tests/` Rust des villes | — |
| **R2 marine-moteur** | web_conquete | nouveaux `engine/marine.rs`, `engine/navale.rs` ; `engine/chemins.rs` (mer) ; IA des flottes (nouveau `ai/marine.rs`) | — |
| **R4 monde-moteur** | web_conquete | `geo.rs` (géographie 13 « monde »), `outils/theatre.mjs` si besoin, routes maritimes | — |
| **R3 commerce-moteur** | web_conquete | nouveau `engine/commerce.rs`, `diplomacy.rs` (corsaires, incidents) | R2, R4 |
| **P1 page-bâtiments** | web_conquete | `web/js/ui.js` (panneau de la place), `web/js/hex/plateau.js` (bâtiments posés autour de la place) | R1, W1 |
| **P2 page-marine** | web_conquete | nouveau `web/js/hex/marine.js` (adaptateur vers `rendu/marine.js`), fenêtres flotte / bataille navale / commerce, sélecteur de théâtre | R2, R3, R4, W2 |

Fichiers partagés (`rules.rs`, `views.rs`, `serveur.rs`, `lib.rs`, `engine/mod.rs`) : chacun n'y ajoute que de
**petits points d'accroche** (une ligne d'appel, une entrée de table, un champ de vue), regroupés et commentés au nom
du module, pour que la fusion soit simple. Les références de tests (`rust/conquete/tests/references`) se refont par
le module qui change la donnée.

## Module 4 : bâtiments à emplacements et recrutement

### Nouvelles chaînes (`cities.rs` `CHAINS`)

Gardées : `marche`, `moulins`, `specialite`, `atelier`, `caserne`, `depot`. Ajoutées (3 niveaux sauf mention ;
`where` : `quai` = port de mer ou fleuve navigable, `mer` = port de mer seulement, `colonie` = place hors d'Europe) :

| Chaîne | Niveaux (nom → bâtiment web_engine) | `where` | Effets principaux | Débloque |
|---|---|---|---|---|
| `haras` | Haras → `haras` ; Haras royal ; École de cavalerie (tech `hussards`) | — | recrues montées, `cav_train` | cavalerie (1), cuirassiers / Royal-Allemand (2), hussards (3) |
| `fonderie` | Fonderie → `fonderie` ; Fonderie de canons → `armurerie` ; Arsenal → `arsenal` (tech `gribeauval`) | — | industrie, `art_train` | artillerie (1), artillerie à cheval (2), mitrailleuses (3, tech) |
| `ecole_militaire` | Salle d'armes → `ecole_militaire` ; École militaire ; École polytechnique (tech `polytechnique` si elle existe, sinon `levee_masse`) | — | expérience des recrues `train_xp`, `train` | grenadiers (1), chasseurs / légère (1), garde (3) |
| `universite` | Collège → `ecole` ; Université → `universite` ; Académie des sciences → `academie` | — | recherche (`research` +10 / 20 / 35 %), stabilité | — |
| `eglise` | Paroisse → `eglise` ; Séminaire → `seminaire` ; Cathédrale → `cathedrale` | — | ordre public, natalité (croissance) | — |
| `port` | Port de commerce → `port` ; Chantier naval → `chantier_naval` ; Arsenal de marine → `cale_seche` | `mer` | commerce (`livres`), réparation des flottes | flûte, corvette (1) ; frégate (2) ; vaisseau de ligne, vapeurs selon les techs (3) |
| `douane` | Bureau des douanes → `douane` ; Entrepôt → `entrepot` ; Compagnie de commerce → `comptoir` | `quai` | droits de douane (`TARIFS`), revenu des routes commerciales | navires marchands (R3) |
| `phare` | Phare → `phare` (1 niveau) | `mer` | moins de naufrages, flottes amies plus rapides au départ | — |
| `plantation` | Plantation → `plantation_<denrée>` ; Grande plantation ; Sucrerie / manufacture (tech `vapeur`) | `colonie` | produit la denrée coloniale de la place (R3 : sucre, tabac, café, coton, thé, épices, indigo) | — |

Chiffres : comme les chaînes actuelles (coûts 100 à 650 livres, 20 à 70 jours de travail, convertis en tours par
`SPEC-TOURS.md`). L'équilibre est ajusté par R1 avec un banc (`bancs_campagne.rs`) : la puissance des IA à 1750 ne
doit pas baisser de plus de 10 %.

### Recrutement lié aux bâtiments (`rules.UNIT_REQ`)

Une table `type d'unité → (chaîne, niveau)` lue par `can_recruit` (joueur et IA, un seul chemin). `ligne` et la milice :
aucune exigence. Le refus dit quoi bâtir (« Il faut un haras dans la ville. »). Les régiments déjà levés ne sont pas
touchés. Une place sans le bâtiment peut toujours **compléter** (renforts) un régiment existant.
L'IA (`ai/gouvernement.rs`) bâtit d'abord ce qu'il lui faut pour son mélange d'armes (`ai::MIX`) dans son meilleur
chef-lieu, sinon elle lève ce qu'elle peut (pas de blocage : sans haras, pas de cavalerie).

### Vue (`views.rs`)

Chaque place : `slots: {chaîne: niveau}`, `slot_max`, et pour l'écran la liste des chaînes possibles
(`chains: [{id, nom, niveau, max, possible, raison, cout, tours, bat}]`), où `bat` est la **clé web_engine** du
bâtiment du niveau en cours (colonne « bâtiment web_engine » ci-dessus), que la page passe à `maillageBatiment`.

### Rendu (W1, web_engine)

Nouveaux bâtiments dans `BATR` (même style toon, quatre époques `ancien`, `lumieres`, `empire`, `industrie`, couleur
du camp sur drapeaux / volets / auvents, neige et saisons, version `ruine` automatique) et leur recette dans
`RECETTES` :

| Clé | Ce qu'on voit | Animation |
|---|---|---|
| `chantier_naval` | cale inclinée vers l'eau, coque en construction sur ses tins, grue de bois, tas de bois | la coque se couvre de bordages par étapes (boucle), charpentiers au marteau, porteur de planches |
| `cale_seche` | bassin de pierre avec un vaisseau à sec, portes d'écluse, grue | ouvriers sur la coque, pompe qui va et vient |
| `ecole_militaire` | bâtiment à fronton et cour carrée, mât de drapeau | cadets à l'exercice qui défilent en rang dans la cour, tambour |
| `universite` | collège à cloître et tourelle d'horloge, bibliothèque | étudiants en robe qui entrent et sortent, oiseaux |
| `seminaire` | chapelle et bâtiment conventuel, jardin clos | procession de religieux, cloche qui balance |
| `phare` | tour blanche et rouge sur rocher, lanterne | faisceau tournant (visible surtout la nuit), mouettes |
| `douane` | bureau à barrière peinte aux couleurs du camp, entrepôt | charrette arrêtée puis qui repart, douanier |
| `plantation_sucre` `plantation_tabac` `plantation_cafe` `plantation_coton` `plantation_the` `plantation_epices` `plantation_indigo` | maison de maître à véranda, rangs de la culture (cannes, feuilles de tabac, caféiers, coton blanc, théiers en terrasses, poivriers, indigotiers), séchoirs | travailleurs qui récoltent, charrette de ballots, moulin à sucre qui tourne (sucre) |

Les bâtiments existants servent pour les autres niveaux (`haras`, `fonderie`, `armurerie`, `arsenal`, `ecole`,
`academie`, `eglise`, `cathedrale`, `port`, `entrepot`, `comptoir`).

**Maquette** `maquettes/web_engine/batiments-empire.html` (sur le modèle de `batiments-antiques.html`) :
1. une galerie : chaque bâtiment nouveau ou utilisé par une chaîne, animé, qui tourne, avec époque, couleur du camp,
   saison et nuit au choix ; `#cle` pour un gros plan ;
2. un village d'essai : une place (village, ville, capitale) avec ses emplacements ; on choisit pour chacun une chaîne
   et son niveau, le bâtiment correspondant se pose autour de la place sur le plateau.
Elle sert aussi d'artefact pour le joueur.

## Module 2 : la marine

### Flottes (`engine/marine.rs`)

- `g.flottes` : `{id: {id, owner, x, y (case), navires: {type: n}, pv: {type: [0..1] par navire]}, amiral?: général,
  dest?, chemin: [cases], a_quai?: id de place, armee?: id d'armée embarquée, ordre: "" | "blocus" | "commerce" |
  "corsaire" | "route", route?: id de route maritime (R4)}`.
- Types (`rules.NAVIRES`) : `flute` (transport et commerce), `corvette`, `fregate`, `vaisseau` (vaisseau de ligne),
  et à l'ère industrielle `vapeur` (vapeur à roues), `fregate_helice`, `vaisseau_helice`, `cuirasse` (après 1860).
  Chacun : canons, coque (pv), vitesse, capacité de transport (hommes), coût, entretien, chantier exigé
  (chaîne `port`), technologie. Ces types sont **ceux que `marine.js` sait déjà dessiner** (sinon W2 les ajoute).
- Construction : file de la place portuaire (`kind: "navire"`), comme un régiment.
- Mouvement : sur les cases de mer, vitesse du plus lent, plusieurs jours de mer par tour ; tempêtes (météo) qui
  retardent ; entrée au port ami seulement.
- **Transport** : une armée peut embarquer sur une flotte amie à quai (capacité) ; débarquer sur une côte. Le cabotage
  actuel des armées seules est **gardé** à l'intérieur d'un théâtre (l'IA s'en sert), mais une armée qui fait du
  cabotage peut être **interceptée** par une flotte ennemie (bataille navale où elle n'a que ses chaloupes : pertes
  lourdes). Passer d'un théâtre à l'autre exige une flotte.
- **Blocus** : une flotte en ordre « blocus » devant un port ennemi : ce port ne commerce plus par mer, ses navires
  ne sortent pas, et un siège terrestre en même temps affame deux fois plus vite.
- Réparation au port ami (chaîne `port`), plus vite avec un chantier naval.
- IA (`ai/marine.rs`) : bâtit une petite flotte de guerre si elle a des ports, escorte ses transports, bloque le port
  ennemi le plus riche en guerre, protège ses routes de commerce.

### Batailles navales par stratégie (`engine/navale.rs`)

Mêmes principes que `SPEC-BATAILLE.md`, un seul chemin pour joueur et IA, attente du choix du joueur
(`mode: "attente"`) :
- **Stratégies** (`rules.STRATS_NAV`, contres +20 %) : « Ligne de file » (canonnade), « Couper la ligne » (contre la
  ligne de file, risqué), « Abordage » (prend des navires, fort contre les petits), « Feu à démâter » (ralentit,
  empêche la fuite), « Rompre le combat » (fuite, réussite selon la vitesse), « Brûlot » (avec un navire sacrifié).
- **Phases** : approche, bordées, mêlée / abordage ; vent (météo) qui avantage un camp (« avoir le vent »).
- **Fin** : navires coulés, pris (abordage), en fuite ; amiral (général) qui gagne de l'expérience ; prestige
  (navires pris) ; une armée embarquée sur un navire coulé perd ses hommes au prorata.
- **Vue** : comme les batailles terrestres (`batailles` dans l'état), avec `naval: true`, les navires par camp,
  la phase, le journal ; la page la montre avec `marine.js` (bordées, fumée, naufrage).

### Contrat de vue pour la page et `marine.js`

L'état envoyé à la page porte `flottes: [{id, proprio, case: [x, y], navires: {type: n}, chemin: [[x, y]…],
a_quai, armee: {id, effectif} | null, ordre}]`, `blocus: [{flotte, ville, lieu: [x, y]}]`. L'adaptateur de la page
(P2, `web/js/hex/marine.js`) traduit les cases du jeu en cases du moteur (`carte-moteur.js` `indexEn`) et appelle
`majMarine` / `jouerMoisMarine` de web_engine.

### Rendu (W2, web_engine, `marine.js`)

À ajouter à ce qui existe (navires, flottes, bataille, blocus, chaloupes, navette) :
- **Comptoir en mer** : bouée et pavillon du comptoir, ancre ; les navires marchands qui l'exploitent mouillés autour,
  chaloupes qui font la navette, caisses de la denrée (couleur selon la denrée) ; comptoir libre / occupé / disputé.
- **Routes commerciales** : un ruban pointillé animé sur la mer entre deux ports (couleur du camp), qui suit un chemin
  donné ; état « coupée » (rouge, pointillés arrêtés) quand une flotte ennemie ou un corsaire est dessus ; petit navire
  marchand qui la parcourt.
- **Corsaires** : navire au pavillon noir ou à la flamme rouge, qui fond sur un marchand, abordage (grappins, fumée),
  le marchand pris change de pavillon.
- **Route vers un autre théâtre** : au bord de la mer, une flèche d'horizon (« vers l'Amérique », « vers l'Inde ») ;
  une flotte qui part s'éloigne et s'estompe, une flotte qui arrive apparaît à l'horizon.
- Types manquants s'il y en a (`cuirasse`), et une **vue de bataille navale par phases** (approche, bordées,
  abordage) pilotable par la page (fonction exportée qui reçoit la phase et les navires de chaque camp).
- Maquette `maquettes/web_engine/marine-empire.html` : tout cela sur une mer d'essai.

## Module 3 : la campagne mondiale (`geo.rs`)

- Nouvelle géographie **13 « monde »** à l'écran de départ : Europe, Amérique et Inde dans **une seule partie**. Les
  trois cartes sont posées côte à côte dans une même grille (décalage des cases, bandes d'océan vides entre elles) :
  le moteur, qui compte en cases, n'a pas à savoir qu'il y a trois cartes, sauf pour les routes maritimes.
- Chaque place, case et pays porte son **théâtre** (`theatre: "europe" | "amerique" | "inde"`).
- **Routes maritimes** (`g.geo.routes_mer` : `[{id, de: [x, y], vers: [x, y], tours, nom}]`) : des cases de mer au
  bord de chaque carte, reliées : Europe (Atlantique) ↔ Amérique : 2 tours ; Europe (Atlantique sud) ↔ Inde (par le
  Cap) : 4 tours ; Amérique ↔ Inde : 5 tours. Une flotte qui y entre (ordre `route`) disparaît de la carte et
  réapparaît à l'autre bout au bout de `tours` tours (on la voit « en mer » dans la vue, avec le tour d'arrivée).
- Camps : ceux des trois théâtres réunis ; les puissances européennes (France, Grande-Bretagne, Espagne, Portugal,
  Provinces-Unies) gardent leurs colonies d'Amérique et d'Inde quand le théâtre les prévoit (sinon les colonies sont
  des pays indépendants). R4 consigne ce qu'il a fait dans cette spec.
- Page : un sélecteur de théâtre (trois boutons) qui déplace la caméra ; la mini-carte montre les trois.
- Taille : la page ne bâtit qu'une fenêtre autour de la caméra (`SPEC-HEX.md`) : rien ne change pour le moteur
  graphique.

## Module 7 : le commerce maritime (`engine/commerce.rs`)

- **Comptoirs en mer** (`g.comptoirs` : `[{id, x, y, theatre, denree, places: 3, navires: [{flotte, owner}]}]`),
  placés par R4 au large des côtes d'Amérique et d'Inde (et quelques-uns d'Afrique sur la route du Cap) : une flotte
  de flûtes en ordre « commerce » sur le comptoir rapporte chaque tour selon le **prix** de la denrée ; un comptoir a
  3 places ; un ennemi peut en chasser les marchands (bataille navale).
- **Denrées coloniales** (`rules.DENREES` : sucre, tabac, café, coton, thé, épices, indigo, ivoire, fourrures) :
  produites par les plantations (chaîne `plantation`) et les comptoirs ; **prix mondial** par denrée, qui baisse quand
  l'offre monte (`prix = base × (demande / offre)^0,5`, bornée entre 0,4 et 2), montré à l'écran (`marche` dans la
  vue).
- **Routes commerciales visibles** : chaque accord commercial (`diplomacy` « commerce ») entre deux camps qui ont un
  port crée une route maritime entre leurs ports principaux (chemin sur la mer, `routes: [{id, de, vers, chemin,
  owner, partenaire, valeur, coupee}]`) ; elle rapporte chaque tour ; **coupée** si une flotte ennemie ou un corsaire
  est sur son chemin (revenu perdu, et le corsaire prend une part).
- **Corsaires** : une flotte en ordre « corsaire » contre un camp donné pille ses routes **sans guerre déclarée** ;
  chaque tour, risque d'**incident diplomatique** (relation en baisse, casus belli offert à la victime) ; les flûtes
  ne peuvent pas être corsaires.
- IA : envoie des flûtes aux comptoirs libres, signe des accords commerciaux, arme des corsaires contre son rival
  quand elle n'ose pas la guerre.

## Hypothèses (à corriger maintenant si besoin)

- Le cabotage des armées seules reste possible dans un théâtre (sinon les IA actuelles ne savent plus se déplacer) ;
  seule la traversée entre théâtres exige une flotte.
- Les plantations n'existent que hors d'Europe ; elles ne montrent pas d'esclavage, seulement des travailleurs aux
  champs (choix de présentation).
- Les sauvegardes d'avant ce chantier se chargent : flottes vides, nouvelles chaînes absentes.
- Les batailles navales n'ont pas de champ tactique (comme les terrestres).

## Ordre de livraison

1. En parallèle : W1, W2 (web_engine) ; R1, R2, R4 (moteur).
2. Fusion des branches du moteur ; puis en parallèle : R3, P1, P2 (P2 sur la marine et le monde d'abord, le commerce
   ensuite).
3. web_engine : version montée (2.29.0), `CHANGELOG.md`, fusion dans `main` ; web_conquete :
   `outils/maj-graphismes.sh` (parties : ajouter `guerre` pour `marine.js`), `cargo test`, `node --test`.

## Critères de réussite

- Dans une partie « monde », une flotte française part de Brest avec une armée, arrive en Amérique 2 tours plus tard,
  débarque et prend une place ; une flotte anglaise peut l'intercepter (bataille navale par stratégie, montrée par
  `marine.js`).
- Une ville sans haras ne lève pas de cavalerie ; l'écran le dit et montre quoi bâtir ; le bâtiment bâti apparaît
  autour de la place, animé, rendu par web_engine.
- Un comptoir occupé rapporte ; une route commerciale se voit, se coupe par blocus ou corsaire ; le prix du sucre baisse
  quand tout le monde en produit.
- `cargo test --locked -p conquete`, `node --test tests/*.test.mjs` et `outils/maj-graphismes.sh --verifier` passent.
- La maquette des bâtiments est publiée en artefact.

## État

(à remplir par chaque module : ce qui est fait, ce qui ne l'est pas, écarts à la spec)

### Module 3 (R4, la campagne mondiale) — 23/11/2026

**Fait.**
- Géographie **13 « Monde »** (`geo::VERSION_MONDE` ; 12 reste la carte inconnue des essais) : `GeoMap::monde` fait ou
  relit (cache `map_cache_v5/6/7.json`) les cartes de l'Amérique, de l'Europe et de l'Inde, et les pose d'ouest en est,
  chacune à sa latitude (KY est le même partout), avec 20 cases d'océan vide entre deux : grille de 2 607 × 1 254 cases,
  2 382 places, 4 509 arêtes. Rien n'est recalculé : grilles recopiées (codes des pays renumérotés), places, arêtes, voies
  d'eau, ports et tracés de la page décalés. Aucune arête ne relie deux théâtres. Pas de cache propre.
- Tout ce qui supposait une seule projection : `GeoMap.parties` (un théâtre posé : décalage, taille, `lon0`, `lat1`, `KX`,
  numéros de ses places, ses pays) ; `xy` et `lon_of` prennent la projection du théâtre de la longitude ; `lat_of` vaut à
  une demi-case près. `km_case` (5) et `KY` sont communs. Le relief, la végétation, les climats et les routes restent ceux
  de chaque théâtre (calculés avec sa projection). Les saisons et la météo du moteur ne dépendent pas de la latitude
  (calendrier commun, trois zones côte / intérieur / montagne d'après le terrain de la case) : l'Inde et l'Amérique les ont
  donc comme dans leur partie à part. Distances, chemins, frontières (`diplomacy::borders` par les arêtes) : en cases, sans
  changement. La mini-carte et les frontières de la page : `depts`, `rivers`, `waters` déjà en cases.
- Théâtre de chaque place (`"theatre"` dans `geo.nodes`, carte monde seulement), `geo.theatre_de(nid)` (toute carte : le
  théâtre de la carte, celui de la partie sur la carte monde, None en Aquitaine), `geo.theatre_case(x, y)` (None entre
  deux cartes), `rules::theatre_du_pays(code)`.
- Routes maritimes `geo.routes_mer : [{id, de: [x, y], vers: [x, y], tours, nom}]`, ids `europe-amerique` (2 tours,
  « vers l'Amérique ») et retour `amerique-europe` (« vers l'Europe »), `europe-inde` / `inde-europe` (4 tours, « … (route
  du Cap) »), `amerique-inde` / `inde-amerique` (5 tours) ; chaque bout est une case d'océan à moins de 12 cases du bord de
  sa carte (`ROUTES_MER`, en lat/lon). `geo::route_mer(&geo, id)`. Balises `geo.sorties : [{case: [x, y], nom, route}]`
  (une par départ).
- Comptoirs `geo.comptoirs : [{id, nom, x, y, theatre, denree}]` (`COMPTOIRS`) : dix cases d'océan au large d'une côte :
  Amérique (Îles du Vent sucre, Saint-Domingue café, Chesapeake tabac, Géorgie coton, golfe du Saint-Laurent fourrures),
  Inde (Malabar épices, Ceylan épices, golfe de Cambay indigo, bouches du Gange thé), route du Cap (Mogador ivoire : la
  grille d'Europe s'arrête au Maroc, le Cap n'y est pas). R3 en fait `g.comptoirs` (places, navires).
- Camps : les 52 pays des trois théâtres (`rules::pays(13)`, dans l'ordre de `FACTIONS`). **Décision sur les colonies** :
  les données ont des pays coloniaux distincts (codes uniques par théâtre, pas de France ni d'Angleterre en Inde) ; on ne
  les fond pas dans leur métropole (elle perdrait leur armée et leur gouvernement). Lien explicite `rules::COLONIES` :
  Nouvelle-France et Louisiane → France, Amérique britannique et Treize Colonies → Grande-Bretagne, Nouvelle-Espagne et
  Cuba → Espagne, Antilles et Ceylan néerlandais → Provinces-Unies, État portugais des Indes → Portugal. Sur la carte
  monde, chacune commence **vassale** de sa métropole (`overlord`, alliance, relations à 60) : tribut, guerres de la
  métropole, victoire comptée avec elle (règles des vassaux existantes). Les autres pays restent indépendants. Une partie
  jouée avec une colonie en fait un vassal (il ne déclare pas la guerre seul).
- Écran de départ : « Monde » ajouté à `R::MODES` (geo 13, après les théâtres) : `/api/map?geo=13` et `/api/new` avec
  `geo: 13` marchent sans autre changement du serveur. `/api/map` de la carte monde porte en plus `map.theatres : [{id,
  nom, cadre: [x, y, largeur, hauteur], lon0, lat1, KX, pays: [codes]}]` (le sélecteur de théâtre), `map.routes_mer`,
  `map.sorties`, `map.comptoirs`, et chaque place son `theatre` ; `rules.factions[code]` y a `theatre` et `metropole`
  (code ou null). Les autres cartes ne changent pas, sauf la liste `modes` de leur /api/map (référence `serveur.json` refaite : octets et empreinte). /api/map de la carte monde : 24,5 Mo
  avant gzip (les grilles en base64).
- Essais `tests/monde.rs` (carte, routes, comptoirs, camps, une partie de quatre tours sauvée et relue, référence
  `tests/references/monde.json` refaite par `refaire_monde`, banc ignoré `banc_tours_des_ia`).

**Mesures** (cette machine, 4 cœurs, `--release`, partie de 1700, le joueur en France) : carte monde 0,4 s depuis les
caches des trois théâtres (7,4 s sans eux : les trois cartes se font) ; partie créée en 0,08 s ; un tour des IA (un mois, 52 camps) 3,1 / 3,7 / 3,9 / 3,7 / 5,0 /
6,2 s sur six mois, contre 1,3 à 3,3 s pour l'Europe seule (32 camps), 0,3 à 0,7 s pour l'Amérique et 0,2 à 0,5 s pour
l'Inde. Le profil est plat : le coût est celui des camps et de leurs armées (IA, économie, sièges, batailles), la
géographie (chemins A*, routes) n'y pèse pas.

**Pas fait / écarts.**
- Objectif d'un tour des IA sous 3 s **non atteint** (3 à 6 s) : il faudrait alléger les boucles par camp de l'IA et de
  l'économie (`ai/`, `engine/economie.rs`), fichiers d'autres modules ; à reprendre après la fusion.
- Mousson, saisons inversées : pas de météo par théâtre (le moteur n'en a pas) ; la météo est commune aux trois cartes.
- Le passage d'une flotte par une route (ordre `route`, la flotte « en mer » et son tour d'arrivée) : R2.
- Le sélecteur de théâtre et la mini-carte à trois cadres : P2 (les données sont dans /api/map).

#### Page (P2) — 23/11/2026

**Fait.**
- Sélecteur de théâtre et mini-carte (`web/js/monde.js`, accroché dans `main.js`) : trois boutons (Amérique, Europe, Inde,
  dans l'ordre de `map.theatres`) qui cadrent la caméra sur `cadre`, le bouton du théâtre regardé allumé ; une mini-carte
  (210 × 100 px, les terres de la grille, les trois cadres, la vue en cours, un toucher y mène). En haut au centre en partie,
  en haut à droite sur l'écran de départ ; seulement sur une carte qui a `map.theatres`.
- Balises des routes maritimes (`map.sorties`) et comptoirs (`map.comptoirs`, montrés libres en attendant la vue du
  commerce) : dessinés par `marine.js` (champs `sorties`, `comptoirs` de `majMarine`), traduits par `web/js/hex/marine.js` ;
  visibles dès l'écran de départ.
- Écran de départ de la carte Monde : les 52 pays dans la liste ; la rangée « Carte » (neuf cartes) passe à la ligne
  (`seg wrap`) au lieu de couper « Monde ». Un panneau de place demandé avant le premier état (la partie Monde le fait
  attendre plus d'une demi-seconde) ne plante plus (`renderPanel`).
- **Poids de /api/map?geo=13** : les quatre grilles (terrain, dept, cellnode, river) de la carte Monde partent compactées
  (`geo::rle` : suites valeur + longueur LEB128, en base64 ; `map.rle: true` ; dépliées par `map.js` `deRle`) ; les autres
  cartes ne changent pas (Europe : mêmes octets ; références `serveur.json`, `geo.json`… identiques ; `monde.json` refaite).
  24,6 Mo → 3,7 Mo avant gzip, 1,22 Mo → 1,15 Mo en gzip (le serveur le sert déjà compressé, niveau 6, calculé une fois).
  Essais : `tests/monde.rs` `grilles_compactees`, `tests/marine.test.mjs` (mêmes octets dépliés).
- Chargement de la page jusqu'à l'écran de départ (Chromium, cette machine) : 15,3 s avec l'ancienne carte, 13,1 s avec
  la nouvelle (mêmes conditions, carte servie par Playwright) ; 14,8 s servie par le serveur ; Europe seule 7,5 s.

**Pas fait / écarts.**
- Le temps de chargement de la carte Monde reste surtout celui de la page (peinture des tuiles de base, territoires, niveau
  du plateau sur 3,3 millions de cases), pas celui du transfert : à reprendre dans `map.js` (hors P2).
- La flotte « en mer » entre deux théâtres (ordre `route`, tour d'arrivée) : la page propose l'ordre (routes qui partent
  du théâtre de la flotte), `marine.js` montre le départ à l'horizon ; l'arrivée (`jouerMoisMarine` `arrivees`) attend la
  vue du moteur (R2 / R4).

### Module 4 (R1 bâtiments-moteur) — 23/11/2026

**Fait** (`cities.rs`, `engine/utilitaires.rs` `can_recruit`, `rules.rs` `UNIT_REQ`, une ligne dans `web/js/ui.js`) :
- Neuf chaînes ajoutées à `CHAINS` et à la fin de `CHAIN_ORDER` : `haras`, `fonderie`, `ecole_militaire`, `universite`,
  `eglise`, `port` (`where: mer`), `douane` (`quai`), `phare` (`mer`, un niveau), `plantation` (`colonie`). Coûts
  110 à 650 livres, 14 à 45 jours, entretien 0,05 à 0,4 livre par jour.
- Chaque niveau de chaque chaîne (anciennes comprises) porte `bat`, la clé web_engine ; `bat_de(g, nid, chaîne, niveau)`
  donne `plantation_<denrée>` (denrée de la place, `sucre` tant que le commerce ne la pose pas). `rules_payload` des
  villes rend aussi `bat` par niveau.
- Effets : `cav_train` (haras, seul ou avec `train`), `art_train` (fonderies : artillerie et mitrailleuses, lu par
  `train_k`), `xp` et `train` (école), `research` (collèges, plafond `COLLEGE_MAX` porté de 0,15 à 0,25), `stab` et
  `grow` (église, université : `stab_bonus` les lit), `trade` (port, phare, douane : revenu sensible au blocus),
  `livres` (douane, plantation). Lus nulle part encore : `phare` (naufrages, module 2) et `denree` (module 7).
- `where` : `mer` = un quai de la place donne sur une voie d'eau marine (`port_de_mer`, d'après `g.geo.ports` et
  `ways[].sea`) ; `colonie` = `est_colonie(g, nid)` : le champ `theatre` de la place s'il existe (carte « monde »),
  sinon le théâtre de la carte, ni l'Europe ni l'Aquitaine.
- `rules.UNIT_REQ` : cavalerie → haras 1 ; artillerie → fonderie 1 ; mitrailleuses → fonderie 3 (arsenal) ; légère,
  chasseurs, grenadiers, sapeurs → école militaire 1. Lu par `can_recruit` (`cities::unit_req_why`), un seul chemin
  pour le joueur, l'IA et la vue (`ru` / `rw`) ; refus : « Bâtiment requis dans la ville : haras. » Un chantier
  en cours ne compte pas. Les renforts des régiments levés ne passent pas par `can_recruit` : inchangés.
- `chantier_ok(g, nid, niveau)` pour la marine (niveau achevé de la chaîne `port`).
- Vue d'une place du joueur (`cities::node_view`, donc sans toucher `views.rs`) : en plus de `sl` / `sn` (gardés),
  `slots: {chaîne: niveau}`, `slot_max`, `chains: [{id, nom, niveau, max, possible, raison, cout, tours, bat}]`, la
  liste des chaînes **qui ont leur place ici** (spécialité, quai, port de mer, colonie) ; `niveau` 0 = rien d'achevé ;
  `possible` / `raison` = `cities::check` (sans le prix ni la file) ; `cout` (prix du camp) et `tours` (fraction de
  tour) : le prochain niveau, `null` au maximum ; `bat` : le niveau achevé, ou le premier s'il n'y a rien.
  La page cache déjà les chaînes absentes de `chains` (une ligne dans `slotCheck`).
- IA : `cities::ai_build` bâtit d'abord le bâtiment qui manque à son mélange d'armes (`ai::MIX` lu dans l'ordre,
  `ai_besoin_mil`) dans son chef-lieu, sinon sa ville la plus peuplée qui peut le bâtir ; puis les chaînes
  économiques comme avant. `AI.recruit` levait déjà de la ligne quand aucune place ne peut lever le type tiré : pas
  de blocage. Un collège n'a plus de valeur pour l'IA une fois le plafond de recherche atteint.
- Sauvegardes anciennes : rien à migrer (chaîne absente = niveau 0 ; `niveau()` lit `slots` sans le créer).

**Écarts** :
- `polytechnique` et `levee_masse` n'existent pas dans `R::TECHS` : l'École polytechnique demande `levee` (Levée en masse).
- `garde` est ici la Garde nationale (la milice des villages) : libre, comme la ligne. L'école militaire de niveau 3
  n'ouvre donc aucun type pour l'instant. Sapeurs : école militaire 1 (la spec ne disait rien).
- Cuirassiers, Royal-Allemand, hussards, artillerie à cheval ne sont pas des types d'unité (ce sont des techs ou des
  mercenaires) : seuls les niveaux 1 du haras et de la fonderie comptent, plus l'arsenal pour les mitrailleuses. Les
  mercenaires ne demandent rien.
- Recherche des collèges : +5 / 10 / 18 % (au lieu de 10 / 20 / 35 %) et plafond 25 %, pour ne pas emballer l'IA.
- Douane : un revenu fixe en livres (et du commerce) ; pas branchée sur `TARIFS`.
- Pas de tech pour les niveaux du port ni pour le phare.

**Banc** (`target/release/simuler --parties 8 --epoque 1700 --graine 1`, Aquitaine, avant / après) : hommes sous
les armes (moyenne par camp) 10 636 → 11 165 en 1720 (+5 %), 11 007 → 11 231 en 1750 (+2 %) ; technologies 17,2 →
18,1 en 1750 (collèges). Pas de baisse : aucun réglage de coût n'a été nécessaire. Le banc compte les hommes, pas la
part de cavalerie et d'artillerie (un peu plus de ligne au début, le temps des premiers haras et fonderies).

**Pas fait** :
- ~~La page (P1)~~ : faite, ci-dessous.
- Les navires (`chantier_ok` est là pour R2), la production des denrées (`denree`, R3), l'effet du phare.
- Pas de banc sur la carte d'Europe ni sur un théâtre colonial.

#### Page (P1) — 23/11/2026

**Fait** (`web/js/ui.js`, `web/js/hex/plateau.js`, `web/css/style.css`, une ligne dans `views.rs`) :
- Panneau de la place (`cityHtml`) : lit `slots`, `slot_max` et `chains` de la vue (plus `sl` / `sn`, ni le calcul côté
  page `slotCheck`, supprimé). `slot_max` cases : libre (« + Bâtir… ») ou occupée (vignette, nom du niveau,
  `niveau / max`, « en chantier »). Une case libre ouvre la liste des chaînes qui ont leur place ici, les possibles
  d'abord : vignette, prix (`cout`), durée (`tours`, en part de tour), effets du niveau, et la raison du moteur
  (`raison`) ou de la page (file pleine, siège, ressources) quand le bouton est grisé. Une case occupée : effets,
  « Améliorer : <niveau suivant> » (prix, durée, raison) ou « Niveau maximal atteint. », « Démolir » / « Abandonner le
  chantier ». Commandes inchangées : `slot_build`, `slot_demolish`.
- Vignettes : `Plateau.vignette(clé, couleur, an)` rend le `maillageBatiment` du moteur dans un coin de son canevas
  (scène à part, caméra orthographique, deux rendus sur fond noir puis blanc pour la transparence, recadrage), en garde
  l'image (`data:` PNG) par clé, couleur du camp et époque, et redessine la vue aussitôt. Deux nouvelles par tranche de
  50 ms (environ 25 ms chacune sous Chromium sans GPU) : le panneau se redessine pour les suivantes. Sans plateau
  (carte classique, pas de WebGL) : l'icône de la chaîne.
- Recrutement : les armes refusées faute de bâtiment (`rules.unit_req`, ajouté à `rules_payload` : `{type: [chaîne,
  niveau]}`, copie de `R::UNIT_REQ`) restent dans la grille, grisées, avec la raison du moteur (`rw`, « Bâtiment requis
  dans la ville : haras. ») et un lien « Bâtir… » (« Améliorer… », « Voir le chantier… ») qui ouvre l'emplacement de la
  chaîne (sinon le premier libre) avec cette chaîne en évidence ; sans emplacement libre, la raison du moteur en toast.
  Les armes qui attendent une technologie restent dans « Plus tard ».
- Plateau : autour de chaque place dont la vue donne `chains` (les siennes ; celles des autres camps : rien), les
  bâtiments des chaînes achevées (`bat`, niveau ≥ 1) sont posés comme le village d'essai de web_engine
  (`maillageBatiment` + `animerPose`), à l'époque et à la couleur du camp, ruinés si la place est incendiée, sur les
  hexagones libres autour d'elle puis un cran plus loin (ni place, ni ferme, ni eau, ni rivière, ni route : choisis
  une fois par niveau de détail, `placer`). Port, chantier naval, cale sèche et phare d'abord, sur un hexagone qui
  touche l'eau, tournés vers elle (le modèle a l'eau du côté +x). De près seulement (hexagones de 4 cases, décor
  complet). Ces hexagones passent au moteur comme bâtis (pas d'arbres dessous) : le décor n'est refait que quand ils
  changent. Une place n'est rebâtie que si ses bâtiments achevés changent (`cleLieu`).
- Habitants et pièces mobiles (`modele(animationsAncien(…))` + `animer`) : seulement quand un hexagone fait au moins
  90 px à l'écran (`PRES_PX`), animations permises, et pour les bâtiments à l'écran ; un modèle assemblé par image
  (10 à 15 ms chacun sans GPU), jeté (`jeter`) dès qu'il sort de la vue. Le tri des bâtiments à animer ne tourne que
  quand la caméra ou les bâtiments changent (5 µs).
- Essai : `tests/interface.test.mjs` (« emplacements… ») ; références : `tours.json` (empreinte de `rules_payload`), `serveur.json` (`/api/map`, taille et
  empreinte).

**Vérifié** dans Chromium (Aquitaine 1790, Gironde) : Bordeaux, « Bâtir… » depuis la carte de la cavalerie, haras
bâti, tour suivant, cavalerie levable, haras posé sur le plateau (avec ses chevaux de tout près) ; La Teste-de-Buch :
port et phare au bord du bassin d'Arcachon. Aucune erreur de console.

**Écarts, pas fait** :
- Les bâtiments en chantier ne se voient pas sur le plateau (`maillageChantier` existe dans web_engine, non branché).
- Les bâtiments d'une place se déplacent quand une chaîne plus haut dans `CHAIN_ORDER` s'ajoute (placement dans
  l'ordre des chaînes) ; une grande place entourée de routes et de villages peut n'avoir que quelques hexagones libres :
  les bâtiments en trop ne sont pas posés.
- Sur la carte d'Europe (hexagones de 20 km), un bâtiment occupe un hexagone entier comme sur l'Aquitaine.
- La fluidité n'a pu être mesurée que sous Chromium sans GPU (2 images par seconde, avec ou sans bâtiments) : à
  vérifier sur le Raspberry Pi.

### Module 2 (R2, marine-moteur) — 23/11/2026

**Fait** (`engine/marine.rs`, `engine/navale.rs`, `ai/marine.rs`, banc `tests/marine.rs`) :
- `rules.NAVIRES` (`flute`, `corvette`, `fregate`, `vaisseau`, `vapeur`, `fregate_helice`, `vaisseau_helice`,
  `cuirasse` : `nom, canons, coque, vitesse` (cases par jour, échelle de `SEA_SPEED`), `transport, equipage, cout,
  jours, entretien` (livres par jour), `port` (niveau de la chaîne « port »), `tech, desc`), `NAVIRE_ORDRE`,
  `rules.STRATS_NAV` (`ligne, couper, abordage, demater, rompre, brulot` : `label, desc, m {approche, bordees,
  abordage}, pertes, bat`), `PHASES_NAV`, `PRESTIGE_NAVIRE`, `PRESTIGE_COULE`, `REPARE_JOUR`, `BLOCUS_CASES`,
  `CONTACT_MER`. Technologies prises dans `rules.TECHS` : `fonderie` (vaisseau), `vapeur_fluviale` (vapeur),
  `outillage` (frégate à hélice), `lahitte` (vaisseau à hélice), `acier` (cuirassé). Elles ne sont pas (encore) dans
  `rules::constantes()` : la référence `rules.json` n'a pas bougé.
- `g.flottes` `{fid: {id, owner, x, y, navires, pv, amiral, dest, chemin, a_quai, armee, ordre, route, cible}}` comme la
  spec (plus `cible`, et des clés de travail : `bord` = le dict de l'armée embarquée, sortie de `g.armies` pendant la
  traversée ; `vers`, `mp`, `prog`, `bataille`, `bloque`). `g.navales` : les batailles navales en attente. Les deux
  sont sauvegardés (clés `flottes`, `navales`, écrites seulement s'il y en a) ; une ancienne sauvegarde se charge.
- Construction : file de la place (`kind: "navire"`), fin de chantier dans `update_queues` (le navire rejoint la
  flotte au quai, sinon une flotte neuve avec un amiral). Entretien dans `compute_income` (`_upkeep.navires`, avec la
  solde de l'armée à bord).
- Mouvement : A* sur les cases d'eau (océan, eau), vitesse du plus lent, météo de la zone (tempête ×0,12 ; vapeurs
  moins gênés), arrivée au quai d'une place amie. Tour par tour : pendant le tour du joueur ses flottes partent tout de
  suite (jours de mer du mois), restent en place pendant le tour des IA, reprennent leur route au début du tour.
- Transport (embarquer à quai, capacité ; débarquer au quai ou sur la côte à deux cases) ; cabotage des armées seules
  gardé, mais une flotte ennemie à `CONTACT_MER` l'intercepte (10 à 60 % des hommes perdus, retour au port de départ).
- Blocus : port ajouté à `g._blockade` (plus de commerce), flottes du port retenues (sauf pour attaquer les
  bloqueurs), vivres d'une place aussi bloquée sur terre épuisés deux fois plus vite (`blockade_tick`), journal.
- Batailles navales : approche (premier feu, démâtage, fuite), trois bordées (brûlot d'abord), abordage (prises), vent,
  coulés / pris / fuite, armée à bord au prorata de la place perdue, expérience de l'amiral, prestige (`glory`),
  repli du vaincu vers un port ami ; attente du joueur (`mode: "attente"`, `{cmd: "tac", sub: "choose", bid, strat}`
  ou `mode: "auto"`), qui fige la campagne et arrête le tour des IA comme une bataille terrestre ; IA :
  `navale::choisir_strat`.
- Réparation au port ami (+50 % par niveau de la chaîne « port » au-delà du premier).
- IA (`ai/marine.rs`, tous les dix jours) : petite flotte de guerre si ports et argent qui dort, escorte des armées en
  cabotage, blocus du port ennemi le plus peuplé en guerre, retour au port.
- Commandes `/api/cmd` `{cmd: "flotte", sub, …}` : `construire {node, type}`, `deplacer {flotte, node | x, y}`,
  `fusionner {flotte, autre}`, `separer {flotte, navires: {type: n}}` (rend `id`), `embarquer {flotte, army}`,
  `debarquer {flotte, x?, y?}`, `ordre {flotte, ordre: "" | "blocus" | "commerce" | "corsaire" | "route", node?
  (blocus), cible? (comptoir, camp chassé), route?}`.
- Vue : `flottes: [{id, proprio, case, navires, chemin, a_quai, armee: {id, effectif} | null, ordre, pv, bataille}]`
  (les siennes en plus : `cible, route, mp, amiral, vitesse, capacite`), `blocus: [{flotte, ville, lieu}]`, batailles
  navales dans `battles` (`naval: true`, `sides[].navires`, `navires0`, `feu`, `armee`, `amiral`, `phase`, `vent`,
  `journal` `[{ph, l, p, w}]`, `choix`, `defaut`) ; fin de bataille : événement `battle_end` avec `naval: true,
  coules, pris, vent` (et `interception: true` pour un cabotage surpris) ; `rules_payload` : `navires, navire_ordre,
  strats_nav, phases_nav`.

**Écarts, raccourcis** :
- `marine::niveau_port` lit `slots(n)["port"]` ; tant que la chaîne `port` n'est pas dans `CT::CHAINS`, toute place
  portuaire (étiquette `port` et une case d'eau à 10 km) compte pour un port de niveau 1 au moins. **À remplacer par
  `CT::chantier_ok(g, nid, niveau)` à la fusion du module 4.**
- Une bataille navale se règle d'un coup (pas de durée en heures) ; la page montre le journal par phase.
- L'IA ne fait pas embarquer ses armées sur ses flottes (elle garde le cabotage) ; l'escorte va au port d'arrivée.
- `commerce`, `corsaire`, `route` sont acceptés et gardés, sans effet (R3, R4). La traversée entre théâtres et
  « les flûtes ne peuvent pas être corsaires » (refusé dès maintenant) relèvent de R3 / R4.
- Phare (vitesse au départ) : non fait (chaîne de R1).

**Essais** : `tests/marine.rs` (8 essais) ; `cargo test --locked -p conquete` passe en entier, `node --test
tests/*.test.mjs` aussi (100). Références refaites : `campagnes.json`, `ia_campagne.json` (les IA mettent des navires en
chantier dès le premier mois), `tours.json` (vue et `rules_payload`), `serveur.json` (`/api/map`). Banc `simuler`
(release, IA seules, graine 1, aucune erreur) : Europe 1790 sur 3 ans 61,0 / 61,2 s avant, 65,2 / 63,2 s après
(+3 à +7 %) ; Aquitaine 1790 sur 10 ans 21,2 s avant, 22,4 s après (+6 %).

#### Page (P2) — 23/11/2026

**Fait.**
- Adaptateur `web/js/hex/marine.js` (sans three.js, testé par `tests/marine.test.mjs`) : l'état du jeu → l'état de
  `graphismes/rendu/marine.js`. Cases [x, y] du jeu → indices de case de la fenêtre que le plateau a bâtie (`indexEn`,
  `Plateau.local`) ; une case de mer tombée sur un hexagone de terre passe à l'hexagone d'eau voisin le plus proche ; une
  flotte hors de la fenêtre n'est pas montrée. Camps : le joueur 0 (marine.js le suppose), les autres dans l'ordre de
  `rules.factions`, neutre 99. Places portuaires de la fenêtre (`villes`) et leur bâtiment `port` (chaîne `port`, reste 1
  en chantier) ; blocus `{flotte, ville, lieu}` → `{par, ville, case: l'hexagone de la place}`. Appelé à chaque état
  (`Plateau.majLieux`) et à chaque fenêtre rebâtie (sans animation). Une flotte qui change d'hexagone (ordre du joueur,
  tour des IA) parcourt un chemin d'hexagones d'eau (`jouerMoisMarine` `mouvements`), une bataille navale réglée sans le
  joueur y tonne (`combats`, d'après `battle_end` `naval`) ; l'état suivant n'est posé (`majMarine`) qu'après l'animation.
- Plateau (`hex/plateau.js`) : `marine.js` importé à part (son échec laisse le plateau ; sans WebGL, la carte de secours
  montre une pastille par flotte) ; le calque `#etiquettes` créé avant l'import du moteur (étiquettes des flottes, balises,
  comptoirs, scène navale), et la caméra du moteur recalée sur celle du jeu juste avant qu'elles se posent
  (`apresCamera`), sinon elles tombaient à côté. Styles repris de `rendu.css` sous `#etiquettes` (`style.css`).
- Fenêtre de flotte (`web/js/flottes.js`, accrochée à `ui.js` : sélection, panneau, actions `fl-…`, toucher ; à `map.js` :
  `hitTest`, anneau de sélection et route en 2D) : composition (canons, coque, transport), coque moyenne, amiral, vitesse,
  jours de mer, capacité, ordre ; ordres : faire voile (toucher la mer ou un port ; toucher la mer avec une flotte choisie
  suffit), bloquer un port ennemi (toucher le port), commerce vers un comptoir, course contre un camp en guerre (refusée
  aux flûtes), route vers un autre théâtre (carte Monde : les routes qui partent du théâtre de la flotte), lever l'ordre,
  embarquer une armée au repos dans la place du quai, débarquer (au quai, sur la côte proche, ou sur une côte touchée),
  fusionner avec une flotte de la même case, détacher un navire.
- Chantier naval dans le panneau d'une place portuaire à soi (`ui.js` `nodePanel`, une ligne) : les navires de
  `rules.navires` (ceux d'une autre ère seulement à l'approche), coût, durée en tours, refus expliqué (niveau de port :
  port de commerce / chantier naval / arsenal de marine, découverte, siège, file pleine, ressources) ; la file nomme les
  navires.
- Bataille navale : les batailles `naval: true` sont mises à part (`st.navales`) : ni la carte, ni la petite scène
  terrestre ne les montrent (`map.js setState` plantait sur `sides[].armies`). En attente, la fenêtre des batailles de
  `strategie.js`, étendue (titre, contexte : haute mer, vent, météo ; forces : navires par type, canons, amiral, armée à
  bord ; stratégies `strats_nav` avec description, contres et effets par phase ; « Laisser faire l'amiral ») ; la caméra
  va sur la bataille, les flottes des deux camps sont cachées et `sceneNavale` joue l'approche. Le choix fait, la scène se
  joue par phases (approche, bordées, abordage, fin : coulés cumulés d'après le journal, pris à l'abordage) dans une
  fenêtre posée en bas, journal par phase, « Passer au résultat » ; puis le résultat (`resultatHtml` : navires perdus,
  navires pris). Animations coupées : le résultat directement.
- Partie d'essai : `tests/partie_marine.rs` (ignoré ; `CONQUETE_PARTIE_MARINE=<chemin>.json`) écrit une sauvegarde
  (France 1790 en guerre contre la Grande-Bretagne, Brest avec un chantier naval, une corvette anglaise au large).
  Vérifié dans Chromium : frégate mise en chantier à Brest, lancée après deux tours, déplacée par toucher, bataille navale
  (la corvette anglaise était partie bloquer Marseille), stratégie « Ligne de file », scène, victoire ; blocus anglais
  dessiné (voiles serrées) ; aucune erreur de console.

**Manque dans web_engine (noté, pas dessiné dans le jeu).**
- `etiquettes.js` pose ses étiquettes avec la caméra de sa boucle (`placerCamera`) : une page qui cale sa propre caméra
  doit la recaler dans un `apresCamera` enregistré avant l'import d'`etiquettes.js` ; un réglage « caméra pilotée par la
  page » serait plus sûr.
- `marine.js` ne masque pas les flottes de l'état sous la scène d'une bataille navale (la page le fait), et sa scène est à
  l'échelle d'un hexagone (la page zoome à 70 px l'hexagone) ; pas de sélection ni de survol d'une flotte (la page dessine
  l'anneau en 2D).
- `jouerMoisMarine` anime un trajet case à case en ligne droite : la page lui donne un chemin d'hexagones d'eau.

**Pas fait / écarts.**
- Commerce, course, route : ordres proposés et acceptés, sans effet tant que R3 / R4 ne les jouent pas ; comptoirs
  toujours libres (pas encore de `comptoirs` dans l'état).
- Une flotte qui sort de la fenêtre pendant son mouvement saute (pas d'animation hors fenêtre) ; une bataille navale hors
  de la fenêtre ne tonne pas.
- L'interception d'une armée en cabotage n'a pas de scène (le résultat seulement, comme une bataille).

### Module 7 (R3, commerce-moteur) — 23/11/2026

**Fait** (`engine/commerce.rs`, `ai/commerce.rs`, ordres dans `engine/marine.rs`, casus belli dans `diplomacy.rs`, essais
`tests/commerce.rs`) :
- **État** `g.commerce` (un seul champ, sauvegardé s'il n'est pas vide ; une ancienne sauvegarde se charge) : `comptoirs`
  (faits de `g.geo.comptoirs` : `{id, nom, x, y, theatre, denree, places: 3, navires: [{flotte, owner}]}`), `routes`
  (`{id: {id, proprio, partenaire, de, vers, chemin, boite, ports, valeur, coupee}}`), `marche` (`{denrée: {prix, offre,
  demande}}`) et `en_mer` (`{fid: flotte}` : les flottes en traversée, sorties de `g.flottes`). Écart : la spec disait
  `g.comptoirs` ; tout est sous `g.commerce` pour ne toucher qu'un champ de `Game`.
- **Denrées** `rules.DENREES` (`sucre, tabac, cafe, coton, the, epices, indigo, ivoire, fourrures` : `nom`, `prix` de base
  en livres par jour pour une unité vendue), `DENREE_DEMANDE` (6 unités), `DENREE_PRIX` (0,4 à 2 × la base),
  `PLANTATION_K`, `COMPTOIR_PLACES`, `COMPTOIR_FLUTES`, `ROUTE_BASE`, `ROUTE_PART`, `CORSAIRE_PART`, `CORSAIRE_PRISE`,
  `CORSAIRE_INCIDENT`, `INCIDENT_REL`, `CASUS_BELLI_TOURS` (hors de `rules::constantes()` : `rules.json` n'a pas bougé).
- **Denrée d'une place** `commerce::denree_place(geo, nid)` : d'après son théâtre, sa latitude et sa longitude (Amérique :
  fourrures au nord du 44e parallèle, tabac, coton, indigo, puis café / sucre aux Antilles ; Inde : thé, indigo, coton,
  épices ; Brésil, Guinée, Madagascar, Indes orientales aussi) ; None en Europe et en Aquitaine. `cities::bat_de` la lit
  (`plantation_<denrée>`, sucre hors des théâtres coloniaux).
- **Production** : `fx.denree` de la chaîne `plantation` (1, 2, 3 unités, `commerce::production`), vendue seulement par un
  camp qui a un port de mer non bloqué ou une route ouverte ; chaque flotte d'un comptoir vend une unité par flûte (4 au
  plus). **Prix** mondial par denrée, refait chaque mois : `base × (demande / offre)^0,5`, borné.
- **Revenu** (livres par jour, `f._mer {plantations, comptoirs, routes, corsaires}`, refait chaque mois, et quand un accord
  naît ou qu'un marchand s'installe) : plantations `unités × prix × PLANTATION_K`, comptoirs `unités × prix`, routes
  ouvertes `ROUTE_BASE + ROUTE_PART × min(revenu brut des deux camps)` pour chacun, part des corsaires. `compute_income`
  l'ajoute au commerce du camp (`_trade.livres`, la ligne « Commerce » de la page) ; le détail est dans la vue (`me.mer`).
- **Comptoirs** : ordre `commerce` (`cible` = id du comptoir, des flûtes exigées) : la flotte s'y rend et, arrivée à une
  case près, y prend une place s'il en reste (sinon elle attend). Une flotte de guerre en guerre avec un des marchands sur
  le comptoir le dispute (pas de revenu) et la bataille navale s'engage (`navale::rencontre`, au mois ou dès qu'elle
  approche) ; le vaincu se replie et perd sa place.
- **Routes commerciales** : chaque accord `commerce` entre deux camps qui ont un port de mer (`commerce::port_de_mer` :
  un mouillage et un quai marin) fait une route entre leurs ports les plus peuplés **d'un même théâtre** (celui de la
  capitale de l'un, puis de l'autre, puis un autre où ils ont tous deux un port), chemin `marine::chemin_mer`. Le chemin
  n'est cherché qu'à la naissance de l'accord (`diplomacy::apply` → `commerce::accord`) ou quand un des deux ports change
  de main (ou, sans chemin, quand le nombre de ports des deux camps change) ; la route disparaît avec l'accord. Elle est
  **coupée** si un de ses ports est bloqué (`g._blockade`), ou si une flotte armée en guerre avec l'un des deux camps,
  ou un corsaire qui vise l'un d'eux, est à une case près du chemin (boîte englobante d'abord).
- **Corsaires** : ordre `corsaire` (`cible` = code d'un camp, **obligatoire** désormais ; flûtes seules refusées) ; la
  flotte coupe les routes de la cible où elle se trouve, sans guerre, prend `CORSAIRE_PART` de leur valeur, parfois un
  marchand (une flûte ajoutée à sa flotte, 20 % par route et par mois) ; chaque mois où elle a pillé, 35 % de risque
  d'**incident** : relation de la victime −15, **casus belli** pour la victime (`f.cb {camp: échéance}`, 12 tours). Une
  guerre déclarée avec un casus belli ne fâche pas les autres camps (`declare_war`, le casus belli sert une fois) ; l'IA
  qui en tient un déclare plus volontiers la guerre (`gouvernement.rs`, si elle est la plus forte).
- **Traversées** (ordre `route`, `route` = id de `g.geo.routes_mer`) : refusé si la route part d'un autre théâtre ; la
  flotte gagne la case `de`, puis quitte la carte (`g.commerce.en_mer`, `en_mer: {route, arrivee}` = le 1er du mois
  `tours` mois plus tard, `TT::month_end`) et réapparaît sur la case `vers` (dans `marine::tick` et au début du tour du
  joueur), sans ordre, avec l'armée à bord ; une flotte ennemie qui l'attend l'attaque. Pendant la traversée rien ne la
  voit ni ne la combat, elle ne reçoit pas d'ordre, son entretien court. `marine::chemin_mer` reste désormais dans le
  cadre du théâtre de départ sur la carte monde (avant, une flotte pouvait traverser les bandes d'océan entre deux cartes).
- **IA** (`ai/commerce.rs`, tous les dix jours, hasard propre) : flûtes mêlées à une flotte de guerre séparées, flottes
  de flûtes envoyées au comptoir libre le plus proche de leur théâtre, une flûte en chantier quand un comptoir est libre
  dans un théâtre où elle a un port et que l'argent dort (1 à 3 flottes marchandes) ; corsaires rares (5 % par coup d'œil,
  en paix avec tous, contre le pire rival, relation < −25, qui a une route dans son théâtre ; six mois au plus, fin à la
  guerre ou si la relation remonte) ; sur la carte monde, une métropole (`R::COLONIES`) dont une colonie est en guerre
  envoie au plus une fois l'an une flotte de guerre de ses ports d'Europe, avec l'armée qui attend au port si elle tient
  à bord ; à l'arrivée, la flotte gagne le port ami le plus proche et l'armée débarque. Les accords commerciaux : la
  diplomatie des IA les proposait déjà à ses voisins en paix (`gouvernement.rs`), chaque accord fait sa route.
  `ai/marine.rs` laisse les corsaires et les traversées à `ai/commerce.rs`.
- **Vue** (`views::player_state`, `commerce::vue`) : `comptoirs: [{id, nom, case: [x, y], denree, places, navires:
  [{flotte, proprio}], dispute}]`, `routes_mer: [{id, chemin: [[x, y]…], proprio, partenaire, de, vers, valeur,
  coupee: null | "blocus" | "ennemi" | "corsaire"}]` (la coupure est recalculée à chaque vue), `marche: {denrée: {prix,
  offre, demande}}`, `en_mer: [{id, proprio, route, arrivee (tours restants), date, navires, armee}]` (le joueur et ses
  alliés), `me.mer: {plantations, comptoirs, routes, corsaires}` (livres par jour, déjà comptées dans `me.trade.livres`),
  `factions[].cb: true` quand le joueur tient un casus belli contre ce camp ; `rules_payload` : `denrees`. Les balises
  `sorties` restent dans /api/map. Commandes : aucune nouvelle, `{cmd: "flotte", sub: "ordre", flotte, ordre:
  "commerce", cible: id du comptoir}`, `{…, ordre: "corsaire", cible: code}`, `{…, ordre: "route", route: id}` ;
  une flotte en mer répond « La flotte est en mer… ».

**Écarts, raccourcis** :
- ~~Sur les théâtres seulement~~ : l'Aquitaine a désormais routes, corsaires et marché (voir « Suite » plus bas) ; ni
  comptoirs ni plantations.
- Le revenu est un taux par jour refait chaque mois (comme le reste de l'économie), pas une somme versée au 1er.
- Une route ne relie que deux ports d'un même théâtre ; pas de route Europe–Amérique par la haute mer.
- Les corsaires ne pillent que les routes (pas les comptoirs) ; un corsaire du joueur ne va pas seul sur les routes : on
  le mène sur le ruban de la route.
- Les comptoirs de la carte monde seulement (les théâtres coloniaux joués à part n'en ont pas) ; les plantations
  produisent partout hors d'Europe.
- L'IA ne ramène pas ses flottes d'expédition en Europe ; elle n'arme pas de corsaire contre le joueur plus qu'un autre.
- ~~Le moteur d'armée ne fait pas « arriver » sur une place une armée posée sur la case même de la place~~ : corrigé (voir
  « Suite » plus bas) ; l'essai de la traversée débarque sur la case de la place.

**Essais** : `tests/commerce.rs` (6 essais, carte monde, IA retirées sauf pour l'essai de l'IA) : plantation et denrée de
sa place (Québec fourrures, Cochin épices, Paris rien ; `bat_de`), prix qui baisse quand tout le monde plante la même
denrée (et bornes), flûtes qui vont au comptoir de Mogador et y rapportent (vue, `me.mer`), route née d'un accord puis
coupée par un blocus et par un corsaire (part du corsaire, flûtes refusées en course), incident et casus belli (vue,
guerre qui ne fâche pas un camp lointain), traversée Brest → Amérique (la flotte quitte la carte, en mer dans la vue,
entretien, sauvegardée et relue en pleine traversée, arrivée au bout du compte de tours avec l'armée à bord, qui débarque
et prend une place), IA (flûtes au comptoir ; expédition vers une colonie en guerre avec l'armée du port).
`cargo test --locked -p conquete` passe en entier. Références refaites : `tours.json` (vue et `rules_payload` :
`denrees`, nouvelles clés), `serveur.json` (/api/map : 1 487 130 octets, empreinte refaite). `campagnes.json`,
`ia_campagne.json`, `actions.json`, `monde.json` inchangées (Aquitaine non touchée, carte monde non touchée).

**Banc** (`CONQUETE_BANC_GEO=13 cargo test --release -p conquete --test monde banc -- --ignored --nocapture`, machine
partagée et chargée par d'autres agents, chiffres bruités) : avant le module 2,25 / 2,65 / 3,02 / 3,34 / 3,39 / 3,18 s
(17,8 s les six mois). Même binaire avec et sans le commerce (interrupteur provisoire, retiré), deux fois chacun : sans
18,3 et 16,8 s, avec 19,2 et 19,1 s (+9 % en moyenne). Le coût propre du commerce, mesuré en le chronométrant : 0,45 s
sur six mois (2,5 %) : accords (chemins des nouvelles routes, 0,18 s le premier mois), `mois` (0,1 s), IA (0,02 s) ;
le reste de l'écart vient de parties qui divergent (les IA plus riches font davantage). Allègement fait en route : les
ports de mer de la carte relevés une fois par carte, `revenus` recalculé à l'accord seulement pour le joueur.
Gains faciles pour le tour des IA : aucun de sûr relevé ici sans profileur (pas de `perf` sur cette machine).


#### Suite (R3, commerce-moteur) — 23/11/2026

**Fait.**
- **Commerce maritime en Aquitaine** (géographies 1 et 2, demande du joueur) : plus de garde `g.theatre()` dans
  `commerce::accord`, `mois`, `revenus`, `vue`. Chaque accord commercial entre deux camps qui ont un port de mer (mouillage)
  fait sa route entre leurs ports les plus peuplés (Bordeaux, Bayonne…), coupée par blocus, flotte ennemie ou corsaire ;
  le marché a ses prix (sans offre : au plafond). Pas de comptoirs (`g.geo.comptoirs` vide : ceux de la carte Monde) ni de
  plantations (`denree_place` rend None hors des théâtres coloniaux, `cities::est_colonie` faux). L'IA y arme des
  corsaires comme ailleurs (`ai/commerce.rs` inchangé : `theatre_case` vaut None partout, la comparaison tient). Les
  chiffres du commerce sont ceux des théâtres (le banc ne demande pas de les baisser, voir plus bas).
- **Défaut des armées corrigé** (`engine/chemins.rs`, `move_army`) : une étape hors route d'un seul point (l'armée déjà sur
  la case de la place visée, débarquée là) était retirée sans `arrive_node` ; elle arrive désormais comme au bout d'un
  chemin plus long (prise d'une place ennemie sans défense, siège, bataille…). Essai `tests/marine.rs`
  `une_armee_debarquee_sur_la_case_d_une_place_y_arrive_et_la_prend` ; `tests/commerce.rs` débarque sur la case de la
  place.
- **Abordages** : `CORSAIRE_PRISE` 0,2 → 0,4 par mois et par route pillée (un corsaire posé sur une route prend en général
  un marchand dans les 2 ou 3 tours : 64 % en deux tours, 78 % en trois). Essai `tests/commerce.rs`
  `un_corsaire_sur_une_route_prend_un_marchand_en_quelques_tours` : une partie jouée tour par tour, sans rien injecter,
  produit l'événement « Des corsaires … prennent un navire marchand … » avec `corsaire`, `route`, `victime`.
  `tests/partie_commerce.rs` garantit un abordage au premier tour (course en cours `jusqua`, rancune du corsaire contre la
  France, graine de la partie choisie pour que le tirage du 1er du mois réussisse).
- **Départs et arrivées de tous les camps** (`g.commerce.mouvements`, noté par `commerce::partir` et `traversees`, oublié
  au-delà de la période) ; vue :
  - `departs: [{id, proprio, case: [x, y], route, navires}]` : les flottes qui ont quitté la carte par une route maritime
    (`case` = case de départ de la route, `navires` = {type: nombre} au départ) ;
  - `arrivees: [{id, proprio, case: [x, y], route}]` : celles qui y sont apparues (`case` = case d'arrivée) ;
  - période : après le 1er du mois d'avant (exclu), c'est-à-dire le dernier tour des IA (une arrivée du 1er du mois, au
    début du tour du joueur, en fait partie), le tour du joueur et le tour des IA s'il se joue ;
  - visibilité : comme les flottes (`marine::vue`) : celles du joueur et de ses alliés, et les autres si la case est vue
    (`seen` de `views::player_state`, le brouillard des armées).
- Outil `tests/actions.rs` `refaire` (`CONQUETE_REFAIRE_ACTIONS=1 cargo test --release -p conquete --test actions refaire
  -- --ignored --nocapture`) : réécrit les résultats et l'état final qui diffèrent, écrit chaque différence, et dit si les
  camps sans `_mer` sont ceux de la référence.
- `simuler --suivi` écrit aussi le revenu brut en livres et celui du commerce maritime de chaque camp suivi.

**Essais** : `tests/marine.rs` (`le_commerce_maritime_en_aquitaine` : route née d'un accord entre deux camps d'Aquitaine,
revenu, marché, ni comptoir ni plantation, corsaire qui la coupe ; l'armée débarquée sur la case d'une place),
`tests/commerce.rs` (abordage en partie ; départ puis arrivée dans `departs` / `arrivees`, le départ oublié après le
tour). `cargo test --locked -p conquete` passe en entier, `node --test tests/*.test.mjs` aussi (107).

**Références refaites** : `actions.json` (seule différence : `_mer` des camps, les camps sans `_mer` identiques à la
référence, pour les trois graines), `campagnes.json` (parties d'Aquitaine), `tours.json` (vues : `departs`, `arrivees`,
routes d'Aquitaine ; factions de fin du mois), `outils/simuler.txt` (graine 3 diverge). Inchangées : `ia_campagne.json`,
`monde.json`, `serveur.json` (/api/map ne bouge pas), `campagne1.json`, `campagne3.json`.

**Banc** (Aquitaine, `simuler --parties 2 --epoque 1700 --annees 51 --graine 1 --proc 2 --suivi 24,33,40,47,64`, avant :
la branche sans ces changements, même suivi ; revenu brut en livres par jour, hors commerce) :

| | 1720 avant | 1720 après | 1750 avant | 1750 après |
|---|---|---|---|---|
| camps vivants (graines 1 + 2) | 3 + 4 | 4 + 4 | 2 + 2 | 2 + 4 |
| revenu brut moyen d'un camp vivant | 160 | 154 (−4 %) | 222 | 226 (+2 %) |
| commerce maritime (le camp qui en tire le plus) | 0 | 4,7 (2,8 % de son brut) | 0 | 5,5 (2,5 %) |
| commerce maritime / brut de tous les camps vivants | 0 | 1,3 à 1,4 % | 0 | 0 à 1,7 % |

Les parties divergent vite (guerres, camps disparus : guerres déclarées 27,5 → 23 en moyenne, trésor et hommes de fin
très différents d'une graine à l'autre), les écarts de revenu moyen sont du bruit ; l'effet propre du commerce reste sous
3 % du revenu de chaque camp, loin des 15 % : les chiffres des théâtres sont gardés pour l'Aquitaine.

#### Page (P3) — 23/11/2026

**Fait.**
- Adaptateur `web/js/hex/marine.js` : comptoirs de l'état (`st.comptoirs` : marchands numérotés comme les camps,
  `dispute`), ceux de la carte (`md.comptoirs`, libres) restant pour l'écran de départ ; routes commerciales `routes_mer`
  traduites en chemins d'hexagones d'eau de la fenêtre (`routesMer` : sans doublon à la suite, coupées en morceaux `id#k`
  quand le chemin sort de la fenêtre et y revient ; `coupee` passé tel quel : marine.js la dessine en rouge). Une flotte
  encore sur la carte avec l'ordre `route` navigue comme une autre (marine.js la cacherait aussitôt) ; quand elle passe
  dans `en_mer`, elle est montrée 20 s sur la case de départ de sa route avec l'ordre `route` : marine.js la mène de la
  balise à l'horizon (si on la voyait, elle gagne d'abord la balise par un chemin d'eau). Une flotte de `en_mer` revenue
  dans `flottes` surgit de l'horizon par la balise de sa case d'arrivée (`jouerMoisMarine` `arrivees`). Abordages
  (`abordages`) : d'après l'événement du moteur.
- Moteur (`engine/commerce.rs`, une ligne commentée) : l'événement « des corsaires prennent un navire marchand » (déjà
  émis quand le joueur est le corsaire ou la victime) porte `corsaire` (la flotte), `route`, `victime` ; la page joue
  l'abordage sur la case de la route pillée la plus proche du corsaire, le marchand aux couleurs de la victime.
- Fenêtre de flotte (`flottes.js`) : comptoirs du théâtre de la flotte (denrée et prix du marché, places prises avec la
  couleur de chaque camp, libres, complet, disputé ; « Commercer » y mène la flotte, refusé sans flûtes ; « en cours »
  pour son comptoir) ; « Course contre » : tout camp vivant ni allié ni vassal (« en guerre » signalé), avec le rappel
  du risque d'incident diplomatique ; routes vers un autre théâtre avec leur durée (« 2 tours en mer »), l'ordre en cours
  nommé ; une flotte en traversée garde sa fenêtre : « En mer, arrivée dans N tours (date) », navires, armée à bord.
- Panneau « Commerce maritime », au bas de la fenêtre Commerce (montré dès qu'il y a comptoirs, routes, flottes en mer
  ou revenu de la mer) : revenu `me.mer` (plantations, comptoirs, routes, corsaires, par tour ou par jour), prix mondial
  de chaque denrée avec offre, demande et une flèche de tendance (prix d'avant son dernier changement, retenu par la page
  à chaque état : `Flottes.majPrix`), routes commerciales du joueur (ports, partenaire, valeur, ouverte ou coupée par
  blocus / flotte ennemie / corsaire, « Voir » cadre la carte sur la route), flottes en mer du joueur et de ses alliés
  (« Fenêtre » ouvre celle de la flotte).
- Diplomatie : badge « Casus belli » sur le camp contre lequel le joueur en tient un (`factions[].cb`).
- Partie d'essai : `tests/partie_commerce.rs` (ignoré ; `CONQUETE_PARTIE_COMMERCE=<chemin>.json`) : carte Monde 1700, la
  France, accord avec la Grande-Bretagne (route Cherbourg – Aberdeen), flûtes françaises et espagnoles à Mogador, corsaire
  espagnol sur la route française près de Cherbourg, casus belli contre l'Espagne, frégate et deux flûtes avec une armée
  à Cherbourg. Vérifié dans Chromium : comptoir occupé (2/3), fenêtre des flûtes, panneau, route coupée en rouge et son
  corsaire, abordage, badge, ordre `route` (départ de la balise vers l'horizon, fenêtre « en mer »), arrivée en Amérique
  deux tours plus tard par l'horizon ; aucune erreur de console. Essais de l'adaptateur : `tests/marine.test.mjs`.
- Défaut signalé (Brest sans son chantier naval sur le plateau, partie d'essai de la marine) : pas un défaut de la page.
  Le plateau pose les bâtiments d'après `chains` de la vue, et `cities::chains_view` n'y met que les chaînes qui
  « vont » à la place (`cities::fits`) ; pour la chaîne `port` (`where: mer`), `fits` exige un quai sur une voie d'eau
  marine (`geo.ports`, `cities::port_de_mer`), que Brest n'a pas sur la carte d'Europe. La partie d'essai pose le port au
  niveau 2 à la main ; la marine le voit (`marine::niveau_port` ne demande qu'un mouillage), la vue des emplacements non.
  Sur la carte d'Europe, 298 des 337 places à mouillage n'ont pas ce quai (Brest, Alger, Ostende, Bergen…), 423 sur 511
  sur la carte Monde : elles ne peuvent pas bâtir de port, donc pas de navire, et n'ont pas de route commerciale
  (`commerce::port_de_mer`). À trancher côté moteur (R1 / R3) : `fits` « mer » sur `marine::case_port` (mouillage) ?
  Cherbourg, qui a ce quai, montre bien son chantier naval.

**Manque dans web_engine (noté, pas dessiné dans le jeu).**
- Le ruban d'une route commerciale a une largeur fixe dans la scène : de loin (toute la Manche à l'écran), il ne se voit
  presque plus ; seule l'étiquette « route coupée » reste lisible.
- La flotte qui part vers l'horizon s'éloigne vers le bord de la fenêtre le plus proche de la balise (`versLarge`), pas
  vers le théâtre où elle va (sur la carte Monde, la balise est en pleine mer) ; même chose pour l'arrivée.
- `abordageCorsaire` sur un marchand de passage : la page ne sait pas où passe le marchand, elle donne la case de la
  route la plus proche du corsaire.

**Pas fait / écarts.**
- Les flottes ennemies qui prennent la mer disparaissent sans scène (la vue ne donne `en_mer` que pour le joueur et ses
  alliés) ; une flotte en mer hors de la fenêtre ne part ni n'arrive à l'écran (pas d'animation hors fenêtre).
- La tendance des prix se compte d'un état à l'autre dans la page : elle repart de zéro au rechargement.
- Le défaut de Brest n'est pas corrigé (moteur, voir plus haut).

### Chargement et fluidité de la page (24/11/2026)

**Mesures** : Chromium sans carte graphique (rendu logiciel), fenêtre 1400 × 860 (chargement) ou 1280 × 800 (images),
`deviceScaleFactor` 1, serveur local `--release` ; machine de 4 cœurs **partagée avec d'autres compilations** (charge 6 à 12) :
les chiffres bougent de ±30 % d'un essai à l'autre, avant et après ont été mesurés en alternance. Scripts Playwright hors du
dépôt (`charge.cjs`, `fps.cjs`, `banc-charge.sh`, `banc-fps.sh`). Le code « avant » est celui de `claude/lucid-allen-dqqpzg`
au début de ce travail (4c65811).

**Chargement** (médiane de six essais ; « écran de départ » et « première image » vus par le banc, qui ne voit la page
qu'entre deux images, donc un peu tard ; décor posé : arbres, champs, rochers) :

| Carte | Écran de départ | Première image du plateau | Décor posé |
|---|---|---|---|
| Monde (3,3 millions de cases) | 17,9 s → 3,9 s | 20,2 s → 6,3 s | 25 à 32 s → 10 à 15 s |
| Europe | 9,8 s → 3,5 s | 12,0 s → 5,8 s | 11 à 21 s → 8 à 14 s |
| Aquitaine | 7,2 s → 3,3 s | 9,1 s → 5,7 s | 9 à 16 s → 10 à 13 s |

Mesuré dans la page (instants `performance.now`, un essai, charge 7) : Monde, écran de départ 14,1 s → 1,2 s, première image
16,3 s → 4,8 s ; Europe 8,8 s → 1,0 s et 11,1 s → 4,5 s ; Aquitaine 5,6 s → 0,9 s et 7,1 s → 4,2 s. Sans carte graphique, la
première image coûte à elle seule 2 à 3,5 s : 0,7 à 1,3 s de JavaScript (la fenêtre du plateau, `construire` et `majRoutes`
de web_engine) et autant pour la dessiner (programmes des shaders compris).

**Où allait le temps** (profil CDP de la carte Monde, avant) : plus de la moitié dans la carte classique, qui ne sert que
sans WebGL et ne se voit jamais sur le plateau : couches de la mer et des terres (`buildBases`, `paintLand` → `terre.js`,
3,6 s), fond de tuiles peint d'avance (`renderTile`, `prepRoutes` → `fusionRoutes`, 1,7 s), peintres (workers) qui
recevaient les grilles (13 Mo chacun), vie 2D (`Ambient` → `carte/vie.js preparer`, 1,1 s) ; puis trois images du plateau
dessinées sous l'écran de chargement opaque (1,3 s chacune sans carte graphique) ; 2 400 drapeaux de places dessinés à
chaque image (`towns.js vivre`, 0,6 s).

**Fait (chargement)**.
- `map.js` : la carte classique (couches, fond de tuiles, parcelles, peintres) n'est préparée que si le plateau manque
  (`classique()`, appelé par le secours sans WebGL) ; `repaint` et `paintLand` ne font rien sans elle. `buildProxy` sur une
  file en tableau typé. Rien ne se dessine tant que l'écran de chargement est là.
- `ambient.js` : la vie 2D (distance à la côte, écume, courants, `preparer`, `majEtat` de `carte/vie.js`, un tableau de
  W × H recalculé à chaque état) ne se prépare qu'à la première image de la carte classique.
- `main.js` : `/api/saves` est demandé en même temps que la carte ; une carte choisie (sans l'intro) se cadre d'un coup à
  l'écran de départ (glissée, le plateau rebâtissait sa fenêtre à l'arrivée).
- Plateau : le décor se pose par morceaux d'un quart de l'intervalle entre deux images (6 à 40 ms au lieu de 6) : sur un
  appareil lent, le décor de la carte Monde demandait des dizaines d'images.

**Images par seconde** (rendu logiciel, processeur ralenti ×4 par CDP, partie neuve 1700, après 4 s, ou 25 s en
automatique ; loin : toute la carte, moyen : 8 px par km, près : 30 px par km sur la capitale, ses bâtiments et sa vie ;
« léger fixé » : `?qualite=leger`, sans la qualité automatique) :

| | avant | léger fixé | automatique (palier atteint : 4) |
|---|---|---|---|
| Aquitaine loin / moyen / près | 0,8 / 0,7 / 1,5 | 0,5 / 0,2 / 1,2 | 0,9 / 1,1 / 3,9 |
| Europe loin / moyen / près | 0,7 / 1,0 / 1,3 | 0,6 / 0,6 / 1,2 | 1,0 / 1,2 / 6,1 |
| Monde loin / moyen / près | 0,7 / 1,1 / 1,8 (0,7 / 1,0 / 1,2) | 0,7 / 1,0 / 1,8 | 0,5 / 1,2 / 7,0 (1,5 / 0,8 / 3,5 avec les hexagones de 32 km) |

Temps de JavaScript du dessin par image (×4) : Monde loin 243 à 266 ms → 43 à 52 ms ; Europe loin 97 → 23 à 25 ms ;
Aquitaine 21 → 15 ms. Sans carte graphique, plus de 90 % du temps d'une image est celui du rendu logiciel (le fil
principal attend `ReadPixels` à chaque image) : le JavaScript du jeu y est de 1 à 3 ms par image sans ralenti. Les images
« léger fixé » ne sont pas meilleures qu'avant : la page dessinait déjà en qualité légère sur cette machine (4 cœurs), le
gain y est celui du processeur, invisible derrière le rendu logiciel. Pas de flotte au départ de ces parties : la vue « près
d'une flotte » n'a pas été mesurée à part (la marine est dans l'image de près sur les côtes).

**Fait (fluidité)**.
- `map.js` : animations permises, le calque 2D n'est redessiné que quand le plateau l'est (30 images/s en qualité légère) ou
  quand la caméra bouge, au lieu de 60 fois par seconde ; le temps sauté compte à l'image suivante. Les places que le plateau
  ne bâtit pas à ce niveau de détail (villages de loin) n'ont plus de drapeau ni d'habitants dessinés à chaque image.
- `plateau.js` : le rayon d'une place (demandé pour chaque place à chaque image) est gardé avec la fenêtre.
- **Qualité automatique** (`web/js/hex/qualite.js`, appliquée par `plateau.js` `appliquer`) : seulement quand le plateau
  est dessiné à chaque image (animations permises) et que le réglage est « Automatique ». Médiane des intervalles entre
  deux images sur la dernière seconde et demie (quatre images au moins) : au-delà de **55 ms** (moins de 18 images/s)
  pendant **3 s**, un palier plus bas ; en deçà de **36 ms** pendant **10 s**, un palier plus haut (attente doublée, jusqu'à
  une minute, quand une remontée rechute dans les 15 s) ; 2 s sans mesure après chaque changement et 1 s après une fenêtre
  rebâtie ; un intervalle de plus de 5 s (onglet caché) ne compte pas. Paliers :
  0. le réglage du moteur (deviné : léger sur un Raspberry Pi, un iPad ou 4 cœurs) ;
  1. ombres coupées (niveau léger du moteur ; sauté s'il l'est déjà) ;
  2. définition × 0,85, habitants et pièces mobiles des bâtiments des emplacements coupés ;
  3. définition × 0,7, décor allégé (un arbre par hexagone de forêt, pas de parcelles), fenêtre à moitié moins de cases
     (des hexagones plus grands plus tôt) ;
  4. définition × 0,6, plus de vie (passants, charrettes, troupeaux), fenêtre au tiers, 20 images/s au plus ; de loin, la
     carte Monde passe en hexagones de 32 km (niveau `sobre` de `carte-moteur.js`, jamais en qualité pleine).
  Un palier automatique ne s'enregistre pas comme un choix de l'appareil (`reglerQualite` de web_engine retient sinon le
  niveau). Menu ☰ (et réglages de l'écran de départ) : « Qualité du plateau : Automatique / Légère / Normale / Riche »
  (`conquete.plateau.qualite`) ; un niveau choisi coupe le régulateur ; `?qualite=` dans l'adresse aussi.
- Essais : `tests/hex.test.mjs` (régulateur : baisse, remontée, à-coups et onglet caché ignorés, palier sauté ; `choisirPas`
  avec moins de cases).

**Vérifié** dans Chromium : Aquitaine (départ, Bordeaux de près aux paliers 0 et 4, menu, animations coupées avec une place
choisie), Europe et Monde (départ, partie, toute la carte au palier 4) ; aucune erreur de console (seulement les
avertissements du rendu logiciel, `ReadPixels`, et de three.js au niveau normal, `PCFSoftShadowMap`). `node --test`
(108), `cargo test --locked -p conquete`, `outils/maj-graphismes.sh --verifier` passent.

**Relève de web_engine** (non modifié ici ; gains estimés sur ces mesures) :
- `rendu/plateau.js` (`rebatir`, `tuile`) et `rendu/toon.js` (`contour`, `fusion`) : chaque hexagone garde biseau, flancs et
  contour à toute distance : 790 000 triangles pour toute l'Aquitaine (6 800 hexagones, 116 par hexagone), 365 000 de près
  (288 hexagones, décor compris). Un hexagone simplifié (dessus plat, sans contour) quand il fait moins de ~15 px à l'écran,
  ou en qualité légère, diviserait par 3 à 5 le rendu de loin, où la qualité automatique ne gagne presque rien.
- `rendu/scene.js` : `antialias: true` fixé à la création du `WebGLRenderer` ; le multi-échantillonnage coûte cher sur un
  Raspberry Pi et en rendu logiciel ; le choisir d'après la qualité (léger : sans) avant de créer le renderer.
- `rendu/scene.js` `reglerQualite(n)` enregistre toujours le niveau dans `localStorage` : une option pour ne pas le retenir
  (la page remet l'ancien choix à la main) ; un facteur de définition et un interrupteur du décor et de la vie exportés
  éviteraient au jeu de reconstruire la fenêtre (palier 3).
- `rendu/plateau.js` `construire` / `rendu/routes.js` `majRoutes` : 0,3 + 0,27 s pour la fenêtre de toute l'Aquitaine,
  0,65 s pour le monde ; la moitié de la première image. Programmes des shaders compilés à la première image
  (`compileAsync` pendant le chargement de la carte : ~0,5 à 1 s sur cette machine).
- `rendu/scene.js` : `PCFSoftShadowMap` n'existe plus dans three.js r186 (avertissement au niveau normal).

**Pas fait / écarts**.
- Europe : écran de départ en 1 s, mais **première image du plateau en 4,5 s** (objectif 3 s non atteint ici) : le reste est
  le rendu de la première fenêtre (web_engine, ci-dessus) et le rendu logiciel de cette machine.
- Les images par seconde ne sont mesurées que sous Chromium sans carte graphique : elles disent ce que coûte le rendu, pas ce
  qu'on aura sur un Raspberry Pi (carte graphique V3D) ; les seuils (55 / 36 ms) sont à vérifier sur l'appareil. La vue de loin
  reste lente sans carte graphique (0,5 à 1,5 image/s) : géométrie du moteur.
- Pas de qualité automatique quand les animations sont coupées (le plateau n'est alors dessiné qu'aux changements).
- Les animations de la marine et des chantiers (autre agent) n'ont pas été mesurées à part.

#### web_engine 2.31.0 branché dans la page (P6) — 24/11/2026

**Fait** (`web/js/hex/plateau.js`, `qualite.js`, `carte-moteur.js` (commentaire), une ligne de `web/js/carte/ciel.js` ; rien
dans `web/graphismes/`) :
- **Hexagones simples de loin** : `batir` appelle `E.P.hexagonesSimples(N.leger)` juste avant `construire` : les niveaux
  `leger` de `carte-moteur.js` (hexagones de moins d'une trentaine de pixels) sont bâtis sans flancs cachés ni petites pièces,
  le niveau fin (hexagones de 4 cases de près) reste complet. À l'écran : 0,4 % des pixels changent sur l'Aquitaine entière,
  0,1 % sur le Monde ; de près, rien (comparaison avant / après au palier 0, `vue-*-loin-*.png`).
- **Qualité automatique** par `E.S.reglerQualite(niveau, { retenir: false, echelle, decor, vie })` à chaque palier : plus de
  sauvegarde et de remise de `web_engine.qualite` dans `localStorage`, plus de `setPixelRatio` à la main, plus de
  `versionSobre` (le clairsemé de web_engine : un arbre par hexagone de forêt, ni arbres épars, ni buissons, ni fleurs). Le
  réglage du menu ☰ reste (`reglerQualite(v)` retenu, comme avant). Vérifié : aucun palier automatique n'écrit
  `web_engine.qualite` ; le niveau choisi au menu l'écrit.
- **Parcelles** : le clairsemé de web_engine garde les champs, l'ancienne astuce du jeu les ôtait (routes factices de l'état,
  comme de loin). Gardée aux paliers 3 et 4 : avec les champs, la vue de près des paliers les plus sobres passe de 41-42 k à
  105-116 k triangles sur l'Europe et le Monde et de 12 à 5,5 images/s ; sans eux elle reste lisible (hexagones de culture
  unis, comme au module précédent). Le décor et le nombre de cases changent ensemble dans `PALIERS` : la fenêtre est rebâtie
  pour les deux (`refaire`), comme avant.
- **Anticrénelage** : rien à faire ; vérifié coupé en qualité légère (`qualite.aa` et `getContextAttributes().antialias` faux).
- **Première image** : `E.S.prechauffer()` une fois la première fenêtre dessinée et `E.P.decorEnCours()` faux, sans l'attendre.
- **Vraie nuit du plateau** : `nuit.js` importé avec les autres modules ; à chaque changement de l'heure du jeu (`AMB.heure`,
  sélecteur de `ciel.js`), `E.N.eclairage('jour' | 'nuit' | { jour, aube, nuit, phase })` (matin : jour 0,7 et aube 0,3 ;
  soir : aube 1, nuit 0,2, crépuscule), et le plateau est redessiné trois secondes, même sans animations, le temps que la
  lumière gagne sa consigne. `majClimat` ne pose plus que le temps qu'il fait. Le voile 2D de l'heure (`ciel.js`) ne se pose
  plus sur le plateau, sauf la nuit un voile très léger (12 % au lieu de 58 %) pour les calques 2D, armées et étiquettes, que
  la lumière 3D n'atteint pas ; la carte de secours sans WebGL garde son voile. La nuit vient de la scène : lune bleutée,
  fenêtres allumées, lueurs des villes, faisceaux du phare de La Teste-de-Buch (`phare-nuit-*.png`).

**Mesures** (même machine et même protocole que plus haut ; charge 2 à 5 ; avant = `claude/lucid-allen-dqqpzg` à d86c861,
qui a déjà web_engine 2.31.0 sans s'en servir, donc sans anticrénelage en qualité légère des deux côtés ; serveurs avant et
après lancés côte à côte, mesures en alternance).

Chargement (médiane de quatre à cinq essais, premier essai d'une carte sur un serveur neuf écarté) :

| Carte | Écran de départ | Première image (page) | Décor posé (banc) |
|---|---|---|---|
| Aquitaine | 0,47 s → 0,49 s | 2,06 s → 1,79 s | 4,2 s → 3,0 s |
| Europe | 0,6 s → 0,57 s | 2,03 s → 1,83 s | 3,8 s → 3,0 s |
| Monde | 0,8 s → 0,83 s | 2,74 s → 2,23 s | 4,1 s → 3,4 s |

Images par seconde (rendu logiciel, ×4, loin / moyen / près) et triangles :

| | avant | après |
|---|---|---|
| Aquitaine, automatique (palier 4) | 5,6 / 5,1 / 10,3 | 11,1 / 8,8 / 11,1 |
| Aquitaine, léger fixé | 1,9 / 2,7 / 4,2 | 3,9 / 5,0 / 4,2 |
| Europe, automatique | 2,4 / 2,4 / 8,9 | 6,7 / 5,2 / 12,3 |
| Europe, léger fixé | 1,6 / 2,1 / 2,6 | 3,2 / 4,0 / 3,1 |
| Monde, automatique | 4,2 / 3,0 / 9,6 | 7,1 / 4,9 / 11,5 |
| Monde, léger fixé | 1,5 / 2,3 / 2,9 | 3,7 / 3,9 / 3,4 |
| Triangles de loin, léger fixé (Aquitaine / Europe / Monde) | 1 505 k / 1 035 k / 1 361 k | 434 k / 532 k / 417 k |
| Triangles de loin, automatique | 390 k / 608 k / 367 k | 101 k / 206 k / 169 k |
| Triangles de près, automatique | 110 k / 55 k / 55 k | 86 k / 41 k / 42 k |

De loin, trois à quatre fois moins de triangles (deux fois sur l'Europe, dont la vue d'ensemble est en hexagones de 8 cases,
déjà peu détaillés) et deux à trois fois plus d'images ; de près au palier 0, rien ne change (mêmes triangles, mêmes images :
4,2 et 4,2 en alternance) ; de près aux paliers sobres, le décor clairsemé de web_engine ôte aussi buissons et fleurs. Le
JavaScript du dessin par image bouge peu (Aquitaine loin 12,5 → 9,6 ms ; Monde 26 → 25 ms) : sans carte graphique, le temps
reste celui du rendu logiciel. La première image gagne 10 à 20 % (fenêtre de départ en hexagones simples), le décor posé
0,7 à 1,2 s.

**Vérifié** dans Chromium (deviceScaleFactor 1 ; aucune erreur de console) : Aquitaine et Monde de loin, Bordeaux de près
(paliers 0 et 3), nuit, soir et matin à La Teste-de-Buch (phare et douane bâtis dans une partie d'essai), départ par
l'horizon de la flotte hollandaise de la balise Europe → Amérique (sauvegarde de `tests/partie_commerce.rs` modifiée comme
en P4) : la flotte file vers l'ouest-sud-ouest, navires grossis, et s'efface en 8 à 9 s. `node --test`, `cargo test --locked
-p conquete`, `outils/maj-graphismes.sh --verifier` passent.

**Pas fait / écarts**.
- Les calques 2D (armées, étiquettes) ne suivent pas l'éclairage 3D ; la nuit, le voile léger les assombrit un peu. Les
  lumières 2D de `ciel.js` (halos des villes, fenêtres des plans, Cordouan) se dessinent toujours par-dessus le plateau la
  nuit, en plus de celles du moteur : non revues.
- `prechauffer` compile d'un coup sans compilation parallèle (rendu logiciel) : une image un peu plus longue juste après le
  décor posé, non mesurée à part.
- Toujours rien sur un Raspberry Pi (carte graphique V3D) : les gains du rendu logiciel sont ceux de la géométrie.

#### Page (P4) — 23/11/2026

**Fait** (`web/js/hex/marine.js`, la partie « bâtiments des emplacements » de `web/js/hex/plateau.js`, une ligne de
`web/js/carte/ciel.js`, essais `tests/marine.test.mjs` ; tout le rendu vient de web_engine 2.30.0, rien dans `web/graphismes/`) :
- **Sortie et entrée de vue** : `mouvements()` n'exige plus que tout le chemin d'eau tienne dans la fenêtre. Les flottes hors
  de la fenêtre sont gardées à part (`dehors` de `etatMarine`, retiré avant `majMarine`) avec leur hexagone ; une flotte qui
  sort de la fenêtre suit son chemin jusqu'au bord (trajet terminé par −1, `sortie: [dx, dz]` de son pas vers le dehors), une
  qui entre paraît au bord (trajet commencé par −1, `entree: [dx, dz]`) ; celle qui passe et repasse le bord ne montre que le
  morceau où elle finit (ou commence, si elle finit dehors). Pas de chemin cherché pour une flotte dehors avant et après.
- **Traversées de tous les camps** d'après la vue `departs` / `arrivees` (plus `en_mer`) : chacune jouée une fois (mémoire des
  clés `id|route|sens` de la vue précédente, oubliées quand la vue ne les donne plus ; rien au premier état, donc rien au
  rechargement, ni quand la fenêtre est rebâtie). Une flotte qu'on voyait gagne la balise de sa route puis l'horizon (ordre
  `route`, `flottes[].sortie` = la balise ; si la balise est hors de la fenêtre : sortie de vue vers elle) ; une flotte qu'on
  ne voyait pas (une flotte ennemie, que la page ne suit pas) part de la balise (`departs` de `jouerMoisMarine`, comme
  `departFlotte`, avec l'effectif embarqué quand `en_mer` le donne) ; une arrivée surgit de l'horizon par la balise de sa
  case d'arrivée. Orientation (carte Monde) : `versTheatre(md, a, b)` = direction du centre du théâtre (`md.theatres[].cadre`)
  qui contient b, vue de a : `sorties[].vers` (théâtre de la case `vers` de la route de la balise), `flottes[].vers` et
  `departs[].vers` (théâtre de destination), `arrivees[].vers` (théâtre de départ) ; sur l'Aquitaine et l'Europe, rien.
- **Abordages réels** : la page joue `abordageCorsaire` sur l'événement « marchand pris » du moteur (vérifié sans rien
  injecter sur la partie de `tests/partie_commerce.rs` : un tour, `abordages: [{flotte: "f244", …}]`, scène vue).
- **Bâtiments en chantier** : `emplacements()` met aussi les chantiers d'emplacement de la file (`q`, `kind: "slot"`, `lvl`,
  `left`, `total`) avec leur avancement `1 − left / total` (au vingtième), placés comme les bâtiments achevés (même ordre :
  le chantier est sur l'hexagone que le bâtiment occupera ; une amélioration remplace l'ancien niveau sur son hexagone) ; clé
  du niveau en chantier : `rules.cities.chains[ch].levels[lvl − 1].bat` (plantation : `bat` de la vue, avec la denrée).
  `maillageEnChantier({cle, couleur, epoque, saison, neige, av})` posé dans le groupe des habitants, animé (`animer`), gardé
  tant que sa clé (hexagone, bâtiment, couleur, époque, saison, avancement) ne change pas, jeté (`jeter`) sinon ; la place
  n'est rebâtie que quand un chantier avance d'un vingtième ou s'achève (`cleLieu`), pas à chaque image. De près seulement
  (hexagones de 4 cases), comme les bâtiments achevés ; la qualité légère est celle de web_engine (moins de figurants).
  Défaut corrigé en route : la liste des emplacements n'était refaite que si leurs hexagones changeaient ; un chantier achevé
  sur le même hexagone restait en chantier.
- **Phare et barrière** : rien à changer côté page (P1 pose les bâtiments avec `animerPose` et `animationsAncien`) : le bras de
  la barrière de la douane s'ouvre et se rabat, le phare de La Teste-de-Buch a ses faisceaux. Défaut corrigé (`ciel.js`) : le
  voile de l'heure (matin, soir, nuit) se posait en « multiply » sur le canevas 2D, transparent au-dessus du plateau : un
  aplat opaque cachait tout le plateau. Avec le plateau, un voile translucide (nuit : bleu nuit à 58 % de près) ; le phare
  éclaire à travers.

**Vérifié** dans Chromium (deviceScaleFactor 1, aucune erreur de console ; seuls les avertissements « GPU stall due to
ReadPixels » du pilote logiciel, déjà là) : partie de `tests/partie_commerce.rs` (abordage réel au premier tour) ; une copie
avec une flotte hollandaise à 16 cases de la balise Europe → Amérique, ordre `route` (départ vers l'ouest-sud-ouest, côté
Amérique, par `departs`), et la frégate de Brest qui prend la route (elle file vers l'ouest et sort de la vue ; deux tours
plus tard, elle surgit de l'est, côté Europe, à la balise « vers l'Europe ») ; Aquitaine 1790, Gironde : phare et douane à
La Teste-de-Buch, collège à Bordeaux (chantiers à 0, douane à 0,7 au tour suivant, achevée au troisième, barrière qui
s'ouvre, phare de nuit).

**Manque dans web_engine (noté).**
- Le plateau n'a pas de nuit à lui : la page n'importe pas `meteo.js` (lumière du soleil), la scène reste éclairée en plein
  jour sous le voile 2D (fenêtres et lanternes des maisons pas plus visibles que le jour) ; le phare reste discret, son halo
  passe sous le voile.
- `departFlotte` est court (de la balise à 4,5 unités au-delà, 5 s) : la flotte qui part sans qu'on la voie disparaît en
  deux secondes, et ses navires, à l'échelle des cases du Monde, sont petits de loin.

**Pas fait / écarts.**
- Sur la carte Monde, les départs ennemis ne se voient presque jamais : la case d'un départ est la balise, en haute mer au
  bord du théâtre, et le moteur ne montre un départ ennemi que si la case est vue (`seen` : places et armées ; les flottes ne
  voient pas). Pour l'essai, une armée française a été posée en mer près de la balise dans la sauvegarde.
- Les chantiers en Aquitaine durent moins d'un tour (0,4 à 0,6) : on ne voit avancer d'un tour à l'autre que ceux qui
  attendent dans la file derrière un autre.
- Un chantier qui commence fait encore glisser les bâtiments des chaînes suivantes d'un hexagone (placement dans l'ordre des
  chaînes, comme en P1) ; il ne bouge plus quand il s'achève.
