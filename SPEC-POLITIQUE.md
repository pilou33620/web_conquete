# Spec : agents, politique intérieure, diplomatie profonde, outil d'équilibre (24/11/2026)

Suite de `SPEC-EMPIRE.md`, demandée par le joueur pour se rapprocher d'Empire Total War (hors graphismes) :
**4** agents sur la carte, **5** politique intérieure, **6** diplomatie profonde, **8** équilibre et IA éprouvés à
grande échelle, **sans tests faits par une IA à tokens** : un outil que le joueur lance sur son PC.

Règle du joueur, toujours valable : **tout rendu visuel 3D se fait dans web_engine**, puis web_conquete l'importe par
`outils/maj-graphismes.sh` ; on ne modifie jamais `web/graphismes/` à la main.

## Choix du joueur (questionnaires du 24/11/2026)

| Question | Réponse |
|---|---|
| Agents | **Espion, gentilhomme, prêtre, diplomate** |
| Recrutement | **Par les bâtiments, avec un plafond par camp** ; expérience et traits |
| Diplomate | **Facultatif, avec un bonus** (la négociation à distance reste) |
| Religions | **Non** : le prêtre sert l'ordre public seulement |
| Politique | **Comme Empire** : 3 régimes, cabinet de ministres, noblesse et peuple, impôts par classe, révolutions, guerre civile |
| Diplomatie | **Tout** : personnalité et mémoire des IA, attitude visible avec ses raisons, échanges composés et contre-propositions, ultimatums, appels aux armes, protectorats |
| Tests | **Outil à lancer sur le PC du joueur**, rapport HTML, aucune IA à tokens |
| Réglages | **Faits par l'assistant à partir des rapports** que le joueur lui donne |

## Ce qui existe (relevé du 24/11)

- Espion sans pion : `Game::spy(code, nid, kind)` (`engine/prise.rs`), rapports `intel` (`SPY_INTEL_TOURS`), sabotage par
  l'IA (`ai/mod.rs` `espionage`), vision `intel` dans `vision_sources`.
- Diplomatie : `diplomacy.rs` (guerre, paix, alliance, vassal, commerce, passage, mariage, soumission, échanges, prisonniers,
  `ai_evaluate`, `act`, `apply`, `answer`), relations entre camps, casus belli (module commerce), trêves, traités.
- Gouvernement : politiques de ville (`cities::set_policy`), impôts (`TAX_LABELS`), ordre public, lassitude, grèves,
  familles et successions (`familles.rs`), généraux et leurs traits.
- Bancs : `src/bin/simuler.rs` (`--parties`, `--epoque`, `--annees`, `--graine`, `--proc`, `--suivi`), `bilan`.

## Carte des modules (un agent par module ; personne ne touche les fichiers d'un autre)

| Module | Dépôt | Fichiers à soi | Dépend de |
|---|---|---|---|
| **W6 agents-rendu** | web_engine | `lib/rendu/agents.js` (nouveau) ou ajouts à `modeles.js`/`animations.js` limités aux agents, maquette `maquettes/web_engine/agents.html` | — |
| **R7 agents-moteur** | web_conquete | nouveaux `engine/agents.rs`, `ai/agents.rs` ; `engine/prise.rs` (`spy` migré) | — |
| **R8 politique-moteur** | web_conquete | nouveaux `engine/politique.rs`, `ai/politique.rs` ; impôts et ordre public dans `engine/economie.rs` (points d'accroche) | — |
| **R9 diplomatie-moteur** | web_conquete | `diplomacy.rs`, nouveau `engine/memoire.rs` (mémoire et attitude), IA diplomatique (`ai/` : fonctions de diplomatie) | — |
| **T1 outil d'équilibre** | web_conquete | `src/bin/simuler.rs` (ou nouveau `src/bin/equilibre.rs`), `outils/equilibre.*`, `lancer-equilibre.cmd`/`.sh` | — (lit ce qui existe ; s'étend aux nouveautés après fusion) |
| **P8/P9/P10 pages** | web_conquete | `web/js/agents.js`, `web/js/politique.js`, `web/js/diplomatie.js` (nouveaux), points d'accroche dans `ui.js`/`map.js`/`hex/` | R7/R8/R9, W6 |

Fichiers partagés (`rules.rs`, `views.rs`, `serveur.rs`, `engine/mod.rs`, `lib.rs`, `ai/mod.rs`, `turns.rs`) : de petits
points d'accroche groupés et commentés au nom du module. Les références de tests se refont par le module qui change la
donnée. **Coût** : chaque module ne ralentit pas le tour des IA de plus de 10 % (banc
`CONQUETE_BANC_GEO=13|5|2 cargo test --release -p conquete --test monde banc -- --ignored --nocapture`).
**Sauvegardes** : une sauvegarde d'avant se charge (champs absents = valeurs par défaut).

## Module 4 : agents sur la carte (R7, W6)

- `g.agents` : `{id: {id, owner, type: "espion"|"gentilhomme"|"pretre"|"diplomate", nom, x, y, at_node?, dest?, chemin,
  mp, xp, niveau (1 à 5), traits: [..], mission?: {type, cible, tours, chance}, cache: bool}}`, sauvegardé.
- **Recrutement** dans la file d'une place (`kind: "agent"`), selon les bâtiments (chaînes de `cities.rs`) :
  espion ← taverne/douane/port (chaîne `douane` ou `port`, ou marché) ; gentilhomme ← `universite` ; prêtre ← `eglise` ;
  diplomate ← palais de la capitale ou `douane` niveau 3 (compagnie de commerce). **Plafond par camp** : 1 par type, +1
  par bâtiment de niveau 2 ou plus de la chaîne correspondante, plafonné (3 à 5 selon le type). Coût et entretien.
- **Mouvement** comme une armée légère (plus rapide), par la route ; peut entrer dans une place étrangère ; un espion
  peut rester caché (détecté par les espions ennemis, les gentilshommes, la cavalerie et les places fortes).
- **Missions** (chance de réussite = base + niveau de l'agent + traits − défense de la cible ; montrée avant l'ordre ;
  échec : l'agent peut être pris ou tué, incident diplomatique si pris) :
  - espion : espionner une place ou une armée (rapport `intel`, ce qui existe), saboter remparts / bâtiment / armée
    (moral, munitions), assassiner un agent ou un général, inciter à la révolte (ordre public de la place) ;
  - gentilhomme : duel contre un gentilhomme ennemi (l'un meurt ou est blessé), poste à l'université d'une ville
    (recherche +), voler une technologie dans une université étrangère ;
  - prêtre : apaiser une place (ordre public +, révoltes −), chasser un prêtre ou dénoncer un agent étranger dans ses
    places ;
  - diplomate : posté dans une capitale étrangère, il donne un bonus d'acceptation aux propositions (R9), monte
    l'attitude avec le temps, permet mariages et accords secrets ; peut être expulsé.
- **Expérience et traits** : chaque mission réussie donne de l'expérience ; traits gagnés (« Fine lame », « Bavard »,
  « Pieux », « Rusé »…) qui modifient les chances.
- **IA** (`ai/agents.rs`) : recrute selon ses bâtiments et sa situation, espionne et sabote avant ses guerres, apaise ses
  places agitées, poste des diplomates chez ses alliés et ses voisins puissants, défend ses universités. Léger en calcul.
- **Vue** : `agents: [{id, proprio, type, nom, case: [x, y], niveau, traits, mission, cache}]` (les agents étrangers
  seulement s'ils sont vus) ; commandes `{cmd: "agent", sub: "recruter"|"deplacer"|"mission"|"annuler", …}` ; règles
  `rules.AGENTS`, `rules.MISSIONS` dans `rules_payload`. `R7` remplace l'ancien `spy` par le pion (l'IA aussi) en gardant
  ses effets.
- **Rendu (W6, web_engine)** : quatre figurines reconnaissables de près (espion en manteau sombre et tricorne, gentilhomme
  en habit et épée, prêtre en soutane, diplomate en habit de cour avec porte-documents), à la couleur du camp, selon
  l'époque, avec une petite animation au repos et en marche ; scènes courtes de mission : duel (deux épées), sabotage
  (fumée, étincelles), assassinat (silhouette qui s'efface), apaisement (cloche, foule calmée), diplomate reçu (drapeau
  hissé) ; marqueur « caché ». API documentée, qualité légère respectée. Maquette `agents.html`. Version **2.34.0**.

## Module 5 : politique intérieure (R8)

- `factions[c].politique` : `{regime: "absolue"|"constitutionnelle"|"republique", cabinet: {poste: ministre}, classes:
  {noblesse: {mecontentement, impot}, peuple: {mecontentement, impot}}, revolution?: {...}}`.
- **Régimes** (effets, comme Empire) : monarchie absolue (impôts de la noblesse bas, peuple plus vite mécontent, ministres
  à vie) ; monarchie constitutionnelle (Premier ministre renouvelé tous les N tours ou après une défaite, commerce +,
  noblesse et peuple modérés) ; république (élections, peuple apaisé, noblesse mécontente, recherche +). Effets chiffrés
  dans `rules.REGIMES`.
- **Cabinet** : postes (chef du gouvernement, finances, guerre, marine, justice, commerce/colonies…) tenus par des
  ministres générés avec des traits (compétence, corruption, réformateur…) ; le joueur nomme et renvoie (renvoyer coûte de
  la satisfaction à une classe) ; effets sur impôts, recherche, recrutement, ordre public, commerce.
- **Classes** : noblesse et peuple, impôt réglé par classe (remplace le réglage unique, l'ancien devient la moyenne), mé-
  contentement par classe selon impôts, régime, guerres, défaites, famine, bâtiments (églises, universités…), ministres.
- **Révolution** : quand le mécontentement d'une classe dépasse un seuil assez longtemps, des émeutes puis une révolution :
  le joueur choisit (réprimer, céder, abdiquer) ; si elle gagne, changement de régime (peuple → république ; noblesse →
  monarchie absolue) ; **guerre civile** possible : une partie des places et des armées passe à un camp rebelle qui porte
  le nouveau régime ; le joueur peut choisir de jouer le camp révolutionnaire.
- **IA** (`ai/politique.rs`) : règle ses impôts par classe, nomme des ministres compétents, réprime ou cède selon sa
  personnalité.
- **Vue** : `me.politique` complet, résumé (`regime`, mécontentements) pour les autres camps ; commandes `{cmd:
  "politique", sub: "impot"|"nommer"|"renvoyer"|"revolution", …}` ; `rules.REGIMES`, `rules.POSTES` dans `rules_payload`.
  Les révolutions historiques (1789…) existantes dans `events.rs` passent par ce mécanisme quand c'est possible.

## Module 6 : diplomatie profonde (R9)

- **Personnalité** de chaque camp IA (`factions[c].caractere` : agressif, expansionniste, marchand, prudent, loyal,
  opportuniste…), tirée selon le pays et l'histoire, qui pèse dans toutes ses décisions.
- **Mémoire** (`engine/memoire.rs`) : faits datés entre deux camps (guerre déclarée, traité rompu, alliance honorée,
  aide en guerre, cadeau, commerce, incident d'espion, corsaire, mariage, frontière commune, religion — non —, régime
  semblable…) avec un poids qui s'efface avec le temps ; **attitude** = somme des faits, avec la liste des raisons.
- **Propositions composées** : un paquet de clauses des deux côtés (régions, technologies, argent comptant, tribut annuel
  sur N tours, droit de passage, accord commercial, alliance, paix, protectorat, échange de cartes) ; l'IA les évalue par
  sa valeur, son attitude et son caractère, et peut faire **une contre-proposition**.
- **Ultimatums et exigences** : exiger une région, un tribut, une rupture d'alliance, sous menace de guerre (refus = casus
  belli) ; l'IA en adresse aussi au joueur.
- **Appels aux armes** : un allié en guerre appelle les siens ; refuser coûte de l'attitude et peut rompre l'alliance.
- **Protectorats** (comme Empire) : un camp protégé paie un tribut, suit les guerres de son protecteur, ne fait pas sa
  propre diplomatie étrangère ; peut demander l'indépendance. Les vassaux existants deviennent des protectorats.
- **Diplomate présent** (R7) : `agents::diplomate_present(g, code, chez)` → bonus d'acceptation.
- **Vue** : par camp, `attitude: {valeur, raisons: [{texte, valeur}]}`, `caractere` ; propositions composées dans les
  propositions reçues ; commandes `{cmd: "diplo", sub: "proposer", clauses: {donner: [...], recevoir: [...]}}`,
  `"ultimatum"`, `"appel"`, `"repondre"`. `rules.CARACTERES`, `rules.CLAUSES`.

## Module 8 : outil d'équilibre à lancer sur le PC du joueur (T1)

- Une commande : `lancer-equilibre.cmd` (double-clic sous Windows) et `lancer-equilibre.sh` (Linux, macOS), qui
  compile si besoin (ou prend le binaire publié) puis joue **N parties complètes entre IA** sur tous les cœurs du PC
  (cartes au choix : Aquitaine, Europe, Monde ; époque de départ ; nombre d'années ; graines), sans affichage, et écrit
  **`equilibre/rapport-<date>.html`** (une seule page, sans dépendance externe, lisible hors ligne) :
  - par camp : places, revenus, armée, technologies, guerres gagnées / perdues, survie, au fil des années (courbes) ;
  - unités levées, bâtiments bâtis, navires, agents, missions et leur réussite, ministres, régimes, révolutions ;
  - stratégies de bataille choisies et leurs victoires (ce que `simuler` mesure déjà), batailles navales ;
  - commerce : routes, comptoirs, prix des denrées ;
  - alertes d'équilibre : un camp qui avale tout, une unité ou un bâtiment jamais pris, une mission toujours ratée, une
    économie qui s'effondre ; plantages (avec la graine pour rejouer) ; temps par tour des IA (moyen, pire).
  - un fichier `equilibre/resume-<date>.json` compact que le joueur peut donner à l'assistant pour les réglages.
- Réglages : `outils/equilibre.toml` (cartes, parties, années, cœurs) ; documentation dans le README (rubrique
  « Tester l'équilibre sur un PC »). Les chiffres d'équilibre restent dans `rules.rs` ; l'assistant les règle à partir
  des résumés.
- Aucun changement de résultat du moteur par l'outil lui-même (il lit l'état des parties).

## Ordre de livraison

1. En parallèle : W6, R7, R8, R9, T1.
2. Fusion des moteurs (références refaites) ; puis en parallèle P8 (agents : pions de web_engine, fenêtres de mission),
   P9 (politique : panneau du gouvernement, cabinet, classes, révolution), P10 (diplomatie : attitude et raisons,
   propositions composées, ultimatums, appels) ; T1 étend son rapport aux nouveautés.
3. web_engine 2.34.0 fusionné dans main et importé ; tout poussé sur main (accord du joueur).

## Critères de réussite

- Un espion caché sabote les remparts d'une place ennemie avant un siège ; un gentilhomme gagne un duel ; un prêtre fait
  baisser une révolte ; un diplomate posté à Londres fait accepter un accord refusé sans lui.
- En monarchie absolue, des impôts lourds sur le peuple mènent à une révolution ; si elle gagne, la république et une
  guerre civile ; le joueur peut nommer et renvoyer ses ministres.
- L'Espagne se souvient qu'on a rompu une alliance ; on voit pourquoi elle nous déteste ; elle contre-propose ; un allié
  nous appelle à sa guerre ; un protectorat paie son tribut.
- `lancer-equilibre` sur un PC produit un rapport HTML et un résumé JSON sans aucune intervention.
- `cargo test --locked -p conquete`, `node --test tests/*.test.mjs`, `outils/maj-graphismes.sh --verifier` passent.

## État

(à remplir par chaque module : fait, pas fait, écarts)

### Module 6 : diplomatie profonde (R9) — fait

Fichiers : `diplomacy.rs` (section « SPEC-POLITIQUE, module 6 »), `engine/memoire.rs` (nouveau), `ai/gouvernement.rs`
(`diplomacy`, `proposer`), points d'accroche commentés dans `rules.rs`, `views.rs`, `serveur.rs`, `engine/mod.rs`,
`engine/utilitaires.rs` (`monthly` → `diplomacy::mois`), `engine/commerce.rs` (`incident` → mémoire). Essais :
`tests/diplomatie.rs`.

- **Caractère** : `factions[c].caractere` ∈ `rules.CARACTERES` (`agressif`, `expansionniste`, `marchand`, `prudent`,
  `loyal`, `opportuniste`), chacun `{nom, desc, guerre, paix, alliance, commerce, fidelite, argent, region, menace,
  rancune}`. Tiré à la création par `memoire::tirer_caractere(seed, code)` (profil `personality` du pays + bonus
  historique `rules.CARACTERE_HISTOIRE` + hasard de la graine, sans toucher au hasard de la partie) ; posé au chargement
  d'une sauvegarde d'avant. Il pèse : envie de guerre de l'IA (× `guerre`), scores de paix / alliance / commerce,
  valeur de l'argent et des régions, ultimatums (`menace`), appels aux armes (`fidelite`), mauvais souvenirs (`rancune`).
- **Mémoire** : `factions[a].memoire[b]` = `[[jour, fait, poids, demi_vie], …]` (12 au plus ; un même fait répété dans
  le mois s'additionne), faits de `rules.MEMOIRE` : `guerre`, `trahison` (alliance rompue, guerre à un allié, rupture
  sous ultimatum), `accord_rompu`, `aide`, `appel_refuse`, `cadeau`, `commerce`, `accord`, `mariage`, `ultimatum`,
  `incident` (corsaires ; R7 : `memoire::retenir(g, victime, auteur, "incident", None)` pour un espion pris),
  `tribut_impaye`, `independance_refusee`. Le poids s'efface de moitié à chaque demi-vie ; purge chaque mois.
- **Attitude** de a envers b = `rel` (inchangée, lue par le reste du jeu) + mémoire + situation (régime semblable /
  différent si R8 pose `factions[c].politique.regime` ; diplomate de b chez a), bornée à ±100 : `memoire::valeur(g, a, b)`
  (les décisions de l'IA et `ai_evaluate` l'utilisent à la place de `rel`) ; `memoire::vue(g, a, b)` =
  `{valeur, raisons: [{texte, valeur}]}` (première raison : « Relations »).
- **Propositions composées** : `diplomacy::proposer(g, frm, cible, {donner: [...], recevoir: [...]})` (frm donne
  `donner`, demande `recevoir`), clauses de `rules.CLAUSES` : `{type: "region", node}`, `{type: "technologie", tech}`,
  `{type: "argent", montant}`, `{type: "tribut", montant, tours}` (montant à chaque tour, 60 tours au plus ; payé par
  `diplomacy::mois`, `factions[c].tributs`), `passage`, `commerce`, `alliance`, `paix` (mutuelles : d'un côté ou de
  l'autre), `protectorat` (celui qui la donne passe sous la protection de l'autre), `independance` (le protecteur la
  donne), `cartes` (les villes de celui qui donne, vues `CARTES_TOURS` tours). L'IA évalue en livres (`valeur_clause`,
  `evaluer` : gains − cessions × (1,15 − attitude/400 − prestige/200 − 0,15 si diplomate)) et fait au joueur une
  **contre-proposition** (argent comptant, sinon tribut sur 12 tours, sinon sans sa cession la plus chère), qu'il
  trouve dans ses propositions reçues (`contre_proposition: true`).
- **Ultimatums** : `diplomacy::ultimatum(g, frm, cible, exigence)`, exigence `{type: "region", node}`,
  `{type: "tribut", montant, tours}`, `{type: "rompre", allie}`. Une IA cède devant un camp ≥ 1,5 fois plus fort si la
  peur couvre le prix ; refus = casus belli de 12 tours pour frm (`factions[frm].cb`, celui du module commerce). L'IA en
  adresse à ses voisins bien plus faibles (une place qui fut à elle, sinon un tribut ; une fois l'an au plus).
- **Appels aux armes** : `diplomacy::appel(g, frm, allie, contre)`. Quand on attaque un camp, ses alliés IA répondent si
  leur attitude dépasse 15 − 30 × (fidélité − 0,5) ; **le joueur n'entre plus en guerre tout seul** : il reçoit l'appel.
  Refus : souvenir `appel_refuse` chez l'appelant ; l'alliance se rompt si son attitude devient négative. L'IA appelle
  ses alliés qui ne combattent pas encore son ennemi.
- **Protectorats** : les vassaux (`overlord`) sont les protectorats (colonies de la carte Monde comprises) : tribut
  (15 % des livres, inchangé), guerres suivies (inchangé) **et paix suivie** (nouveau), pas de diplomatie propre (seuls
  guerre — refusée par `war_refusal` —, ruptures, cadeaux, prisonniers, et la paix d'une guerre à soi passent ; on traite
  avec le protecteur) ; indépendance par la clause `independance` (`diplomacy::liberer`), demandée par une IA protégée
  devenue forte et mécontente. La vue garde `over` (le protecteur).
- **Diplomate présent** : `memoire::diplomate_present(g, code, chez)` lit pour l'instant `factions[code].diplomates`
  (liste de camps, posée par les essais) : **à brancher à la fusion sur `agents::diplomate_present` (R7)**, et adapter
  `tests/diplomatie.rs::un_diplomate_present_fait_accepter` (poster un vrai diplomate). Effets : +10 d'attitude (raison
  « Un diplomate à notre cour »), +10 points aux scores, −15 % sur le prix des cessions.
- **Commandes** : `{cmd: "diplo", sub: "proposer", cible, clauses: {donner, recevoir}}`, `{…, sub: "ultimatum", cible,
  exigence}`, `{…, sub: "appel", cible, contre}`, `{…, sub: "repondre", id, accepte}` (rendent `{ok, msg, pending}`) ;
  une autre `sub` est une action d'avant (`act`, avec `cible`) ; l'ancienne forme `{cmd: "diplo", to, action, …}` et
  `{cmd: "answer"}` marchent toujours.
- **Vue** : chaque camp étranger a `caractere` et `attitude: {valeur, raisons}` ; chaque proposition reçue garde ses
  champs d'avant et, selon `action` : `"proposition"` → `clauses: {donner, recevoir}` (chaque clause avec `texte`),
  `contre_proposition` ; `"ultimatum"` → `exigence` ; `"appel"` → `contre` ; toujours un `texte`. `rules_payload` :
  `CARACTERES`, `CLAUSES` (clés en capitales, comme le dit la spec).
- **Écarts / pas fait** : l'IA n'échange pas de technologies ni de régions entre IA d'elle-même (elle les évalue quand on
  les lui propose) ; une proposition au joueur qui expire ne coûte rien ; le tribut est par tour (mois) et non annuel ;
  les propositions au joueur gouverné par son IA (simulations) sont jugées par l'IA (`attend_le_joueur`).

### Module 8 (T1, outil d'équilibre) — 24/11/2026

**Fait.**
- `src/bin/equilibre.rs` : chaque partie dans son propre processus (`equilibre --partie carte:époque:graine:années:camp`,
  qui sert aussi à rejouer une partie plantée), sur `coeurs` processus à la fois ; panique du moteur, arrêt du processus
  ou partie plus longue que `limite_minutes` : notée (graine, carte, message, commande), les autres continuent. Cartes
  préparées une à une avant la série (cache), grandes cartes d'abord, avancement et temps restant sur la sortie
  d'erreur. Écrit `equilibre/rapport-<date>.html` (page autonome, données JSON inline, courbes SVG dessinées à la main,
  thème clair / sombre / auto, onglet par carte) et `equilibre/resume-<date>.json` (≈ 10 Ko pour 3 cartes, ≈ 40 Ko pour
  les 9 ; tableau compact par camp, compteurs, catégories, valeurs de fin, alertes, 50 plantages au plus) ; `--ouvrir`
  ouvre le rapport.
- `src/bin/equilibre/mesures.rs` : quatre tables, une ligne par mesure, qui lisent la partie ou sa sauvegarde
  (`views::to_dict`, réglages des batailles remis comme avant : la partie n'est pas changée). Par camp et par an : places,
  vivant, revenus, trésor, hommes (armées et garnisons), technologies, navires, flottes, commerce maritime, prestige ;
  par mois : régiments apparus / disparus par type, niveaux de bâtiments bâtis, navires gagnés / perdus, batailles par
  situation, stratégies choisies et victoires, batailles navales et leurs stratégies, sièges (commencés, finis, réussis),
  places changées de main, guerres gagnées / perdues par camp (le camp qui a pris le plus de places à l'autre, ou l'a
  rayé), mois de banqueroute et de famine par camp, journal par sorte ; toute la carte par an : prix du marché, prix des
  denrées, routes (et coupées), comptoirs tenus, flottes en traversée, états diplomatiques (tous ceux qui existeront),
  camps en vie et en guerre.
- Nouveautés prévues, qui s'allument dès que R7/R8/R9 sauvegardent leurs champs : agents par camp (`agents` avec
  `owner`/`proprio`), agents recrutés / perdus par type, missions finies et « agent revenu » par type
  (`agents[id].mission.type`), mécontentement du peuple et de la noblesse (`politique.classes.*.mecontentement`),
  changements de régime (`politique.regime`), révolutions (`politique.revolution`), ministres nommés par poste
  (`politique.cabinet`), régime et caractère à la fin (`caractere`) avec la part des places, attitude moyenne
  (`factions[c].attitude`, nombre ou `{valeur}`), camps nés en cours de partie (guerre civile, indépendance),
  protectorats (état diplomatique).
- Alertes : domination (plus de `domination_places` % des places dans plus de `domination_parties` % des parties), camp
  toujours rayé, banqueroutes et famines (plus de 10 % des mois), unité / bâtiment / navire / stratégie jamais pris
  (parmi ceux sans technologie requise), stratégie presque toujours perdante ou gagnante (20 fois au moins), tour des IA
  lent (`tour_ms`), plantages ; temps moyen et pire du tour des IA par carte.
- `outils/equilibre.toml` (lu par un petit lecteur TOML, sans dépendance) : 9 cartes, 1700, 32 parties de 50 ans, tous
  les cœurs, camp suivi au hasard ; `[rapide]` : Aquitaine, Europe, Côte de l'Ivoire, 2 parties de 2 ans.
- `lancer-equilibre.cmd` / `.sh` (compile ou télécharge par `scripts/binaires.*`, retélécharge si `bin/equilibre`
  manque, lance, ouvre le rapport) ; `.github/workflows/binaires.yml` : `equilibre` vient avec `--bins`, et l'archive de
  production prend les lanceurs et `outils/equilibre.toml`. README : « Tester l'équilibre sur un PC ».
- `simuler` : `carry_on`, `play_month` et le camp par défaut passés dans `src/bin/commun/` (sortie inchangée) ;
  `Args::parse_drapeaux` pour les options sans valeur. Essais : `tests/outils.rs` `equilibre` (une partie, puis la série
  réduite : rapport et résumé écrits avec leurs clés), lecteur TOML dans le binaire.
- `--rapide` : 1 min 24 s ici (4 cœurs virtuels qui ne valent qu'un cœur réel). Série par défaut estimée à 35 h de
  calcul d'un cœur (Monde ≈ 45 s par année de jeu, Europe ≈ 18 s, Aquitaine ≈ 2 s, théâtres 1 à 5 s) : 2 à 5 h sur un PC
  de 8 à 16 cœurs.

**Écarts, pas fait.**
- Batailles navales : le moteur ne les écrit au journal que si le camp suivi ou un allié y est ; elles ne sont donc
  comptées que pour lui (le camp suivi est tiré au hasard à chaque partie pour les répartir). Les navires gagnés /
  perdus, eux, sont comptés pour tous.
- « Joueur absent » impossible (le moteur veut un camp du joueur) : il est joué par une IA comme les autres.
- Unités : ni victoires ni défaites par type (le moteur ne le garde pas) ; « disparus » compte aussi les fusions.
- Temps du tour : par mois de jeu et par partie (toutes les IA ensemble), pas par IA.
- Missions (R7) : la réussite est devinée (agent encore là à la fin de la mission) ; à affiner quand R7 dira l'issue.
  Les champs supposés des nouveautés sont ceux de cette spec : à vérifier après la fusion (`mesures.rs`, une ligne).


### Module 5 : politique intérieure (R8) — fait le 24/11/2026

- **Moteur** `engine/politique.rs`, **IA** `ai/politique.rs`, chiffres dans `rules.rs` (`REGIMES`, `CLASSES`, `POSTES`,
  `MINISTRE_TRAITS`, `POL_*`, `SEUIL_EMEUTE` 70, `SEUIL_REVOLUTION` 80 pendant `REVOLUTION_MOIS` 4 mois,
  `REVOLUTION_REPIT` 24 mois, `GUERRE_CIVILE_PLACES` 6, `GUERRE_CIVILE_PART` 0,35, `regime_historique`).
- `factions[c].politique` = `{regime, cabinet: {poste: ministre|None}, candidats: [ministre], classes: {noblesse|peuple:
  {mecontentement 0-100, impot 0-1, mois}}, choc: {classe: points}, mandat: jour|None, revolution: None|{classe, chance},
  repit, seq, _lost, revolutions, guerres_civiles [, rebelle_de, capitale, nom, couleur]}` ; ministre = `{id, nom,
  poste, competence 1-5, traits, ne, depuis}`. Sauvegardé avec le camp ; une ancienne sauvegarde reçoit le régime de son
  pays à sa date et son impôt unique sur les deux classes. `f.tax` reste l'impôt du camp (moyenne des deux classes) :
  l'économie et l'ancien réglage `{cmd: "tax"}` marchent comme avant (le réglage déplace les deux classes d'autant).
- **Régime de départ** selon l'histoire : France absolue / constitutionnelle (1789) / république (1792) / absolue
  (1804) / constitutionnelle (1814) / république (1848) / absolue (1852) / république (1870) ; Grande-Bretagne et Pologne
  constitutionnelles ; Provinces-Unies, Venise, Gênes, Suisse républiques ; Suède, Espagne, Portugal, Prusse, Autriche,
  Danemark… selon leurs dates ; un département suit la France, une colonie sa métropole ; les autres pays absolus.
- **Mécontentement** : cible mensuelle (régime, impôt de la classe × sensibilité du régime, injustice fiscale, guerres,
  lassitude, famine, banqueroute, églises, universités, ministres, chocs : défaites, renvois, choix d'événements) ;
  au-delà de 55 il ôte de l'ordre public visé (`stab_targets`) ; émeutes à 70 ; révolution à 80 pendant 4 mois.
- **Effets** : régime et cabinet passent par `recompute_mods` (absolue recrues +5 % ; constitutionnelle commerce +10 %,
  livres +3 % ; république recherche +10 %, lassitude −10 % ; postes × compétence ; traits).
- **Gouvernement** : ministres à vie en monarchie absolue (morts en janvier, remplacés) ; Premier ministre renouvelé
  tous les 48 mois ou après deux défaites dans le mois (constitutionnelle) ; élections tous les 48 mois en république
  (un peuple mécontent porte l'opposition). Trois candidats renouvelés chaque janvier ; nommer (le titulaire est renvoyé)
  et renvoyer (choc sur la noblesse, ou le peuple pour un ministre populaire : 3 / 6 / 8 selon le régime).
- **Révolution** : une décision d'événement (`ev: "revolution"`, fenêtre des événements existante ou commande) :
  réprimer (chance montrée : régime, ministre de la Justice, garnisons, colère), abdiquer (la classe obtient son régime,
  l'héritier succède), céder (un pas vers le régime voulu, ou impôt de la classe −20 % ; coûte des livres ; sans réponse,
  on cède). Répression ratée : la révolution l'emporte ; un camp de 6 places ou plus se déchire en **guerre civile** :
  un camp rebelle `<code>r` (« FRr », « France (républicains) ») prend 35 % des places autour de la plus grande ville après
  la capitale, les armées qui s'y trouvent, 30 % du trésor, porte le nouveau régime, en guerre avec son pays ; le joueur
  peut en prendre la tête (`ev: "guerre_civile"`). Les rebelles qui perdent leur capitale face à leur pays ou toutes leurs
  places capitulent ; s'ils prennent la capitale du pays, la capitulation ou le traité ordinaires s'appliquent.
  Le camp rebelle est inscrit dans les tables des camps du fil (`R::inscrire_rebelle`, refait au chargement).
- **Histoire** : 14 juillet 1789 (France absolue), 22 février 1848 (France et onze pays non républicains), 4 septembre
  1870 (France absolue) : une révolution du peuple là où il gronde (40 ou plus) ; les choix des doléances, des Trois
  Glorieuses, de 1848 et de la Commune pèsent sur les classes (`politique::EVENEMENTS`, sans changer `HIST` ni la
  référence du jumeau Python).
- **IA** : répartit son impôt (la moyenne reste celle de son économie) vers la classe la moins fâchée, pourvoit les postes
  vacants et remplace en janvier un incapable par un candidat brillant ; devant une révolution, poids selon son caractère
  (`factions[c].caractere` du module 6 s'il existe, sinon tiré de sa personnalité).
- **Vue** : `me.politique` = `{regime, cabinet: {poste: {id, nom, poste, competence, traits, age}|None}, candidats,
  classes: {c: {mecontentement, impot, cible, mois, etat: calme|agitation|emeutes|revolution, raisons: [{texte, valeur}]}},
  mandat (tours), revolution: {classe, chance, decision}|None, repit (tours), rebelle_de, rebelles (code du camp rebelle
  de son pays en vie), seuils, revolutions, guerres_civiles}` ; `factions[i].politique` = `{regime, noblesse, peuple
  [, rebelle: {de, nom, couleur, capitale}]}` ; règles `rules.regimes`, `rules.postes`, `rules.ministre_traits`,
  `rules.classes` (en minuscules, comme les autres clés de `rules_payload`).
- **Commandes** `{cmd: "politique", sub: "impot", classe, value}`, `{sub: "nommer", poste, ministre}`, `{sub: "renvoyer",
  poste}`, `{sub: "revolution", choix: "reprimer"|"abdiquer"|"ceder"|"rejoindre"|"fidele"}`.
- **Essais** `tests/politique.rs` (régime de départ, impôts lourds → émeutes → révolution → céder, réprimer réussi / raté,
  guerre civile et joueur rebelle, sauvegarde du camp rebelle, rebelles qui capitulent, guerre civile entre IA sur deux
  ans, ministre nommé / renvoyé, élections, 1789, sauvegarde et ancienne sauvegarde) ; banc ignoré `banc_revolutions`.
  Références refaites : `campagnes.json`, `tours.json`, `serveur.json` (/api/map), `outils/simuler.txt`.
- **Bancs** : tour des IA (`CONQUETE_BANC_GEO=13|5`, processeur) monde 2,69 s → 2,54 s, Europe 1,25 s → 1,19 s (bruit
  d'autres travaux en parallèle ; pas de hausse mesurable). Révolutions : Aquitaine 3 parties de 30 ans (1700, 1790) :
  0 révolution, 0 guerre civile ; Europe 2 parties de 4 ans : 0 ; une guerre civile russe forcée se joue 4 ans sans
  erreur. Pas d'avalanche ; plutôt rares hors des dates de l'histoire et des impôts lourds du joueur.
- **Pas fait / écarts** : les accroches d'impôt et d'ordre public sont dans `engine/prise.rs` (`set_tax`, `stab_targets`,
  où vivent ces fonctions) et non dans `economie.rs` ; la page (P9) n'est pas faite : le camp rebelle n'est pas dans
  `rules.factions` (sa couleur et son nom sont dans `factions[i].politique.rebelle`, son nom dans `names`) ; pas de
  flotte donnée aux rebelles ; un camp rebelle n'a pas de `caractere` (module 6) tant que R9 ne le pose pas.
