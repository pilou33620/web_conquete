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
- La page (P1) : le panneau de la place lit encore `sl` / `sn` / `rules.cities` ; `chains` et `bat` sont prêts.
- Les navires (`chantier_ok` est là pour R2), la production des denrées (`denree`, R3), l'effet du phare.
- Pas de banc sur la carte d'Europe ni sur un théâtre colonial.

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
