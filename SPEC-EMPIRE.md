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
