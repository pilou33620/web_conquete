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

### Module 4, R7 agents-moteur (fait)

- **Fichiers** : `engine/agents.rs` (moteur, commandes, vue), `ai/agents.rs` (IA) ; `engine/prise.rs` : `rapport_espion`
  et `saboter_remparts` sortis de `resolve_spy` (l'ancien `spy` les appelle toujours). Points d'accroche « (SPEC-POLITIQUE,
  module 4) » : `engine/mod.rs` (champ `agents`), `views.rs` (sauvegarde, vue, vision des agents du joueur, règles),
  `serveur.rs` (`cmd: "agent"`), `turns.rs` (`debut_tour`), `engine/utilitaires.rs` (`tick` à chaque pas, `mois` chaque
  mois), `engine/economie.rs` (fin de file `kind: "agent"` : une ligne, `update_queues` y est), `ai/mod.rs` (`agents::jouer`
  remplace `espionage`, supprimée), `rules.rs` (chiffres). `cities.rs` n'a pas eu besoin d'être touché.
- **`g.agents`** : `{id ("ag…"): {id, owner, type, nom, x, y, at_node (place, ou None en chemin), de (dernière place
  quittée), dest, chemin ([nid…] sans la place où il est), prog, mp (tour par tour), xp, niveau (1 à 5), traits, mission
  (None ou {type, cible, tours, chance} : seulement les **postes**), cache, repos (jour avant lequel il ne mène pas d'autre
  mission)}}` ; sauvegardé sous la clé `agents` (absente d'une ancienne sauvegarde : `{}`).
- **Recrutement** : `kind: "agent"` dans la file (`what` = type), payé tout de suite. Bâtiments (`rules.AGENTS[t].batiments`,
  un seul suffit) : espion ← douane, port ou marché ; gentilhomme ← université (collège) ; prêtre ← église ; diplomate ←
  capitale du camp (`capital_of`) ou douane 3 (compagnie de commerce). Plafond : 1 + places ayant un de ces bâtiments au
  niveau 2 ou plus, au plus 4 / 3 / 5 / 3. Coût 120 / 180 / 90 / 200 livres, entretien 6 / 8 / 4 / 10 livres par mois
  (prélevé dans `agents::mois`, pas dans `compute_income`).
- **Mouvement** : par les routes et les voies d'eau, de place en place (Dijkstra sur `geo.adj`, longueur des tronçons),
  `AGENT_VITESSE` = 32 par jour ; entre partout, places étrangères comprises. Tour par tour comme les flottes : pendant son
  tour, l'agent du joueur part aussitôt (jours de route du mois, `mp`), il attend pendant le tour des IA.
- **Caché** : l'espion naît caché ; un autre camp le voit dans une de ses places de remparts 2 ou plus, ou à moins de
  `AGENT_DETECTE` (6) d'un de ses espions, gentilshommes ou d'une armée avec de la cavalerie (`agents::detecte`). Raté et
  échappé, il est démasqué.
- **Missions** (`rules.MISSIONS`) : l'agent arrêté dans une place vise la place, une armée ou un agent à moins de
  `AGENT_PORTEE` (6). Une mission par tour (`repos`). Les postes (`universite`, `apaiser`, `ambassade`) durent jusqu'à un
  départ ou `annuler` ; les autres se jouent sur-le-champ (aussi pour le joueur pendant son tour). Chance = base + 5 % par
  niveau + traits + « Diplomates » (10 %) − défense (remparts 3 % par niveau, « Télégraphe Chappe » 15 %, 5 % par agent
  du camp visé dans la place jusqu'à 15 %, cavalerie de l'armée visée 5 %, niveau et « Fine lame » de l'agent visé),
  bornée à 5–95 % : `agents::verifier` (commande `chance`, et `possibles` dans la vue). Échec : pris 40 % (il disparaît,
  **incident** : la relation de la victime baisse de `AGENT_REL` = 15, `agents::incident`), tué 20 %, sinon il s'échappe
  démasqué (25 % de prendre « Bavard »). Duel raté : notre gentilhomme est tué ou blessé (deux tours de repos).
  - espion : `espionner` (place : le rapport `intel` de toujours ; armée : son effectif et son général, `intel` sur la
    place la plus proche), `saboter_remparts` (l'effet de l'ancien sabotage), `saboter_batiment` (le meilleur bâtiment de
    niveau 2 ou plus perd un niveau, sinon dégâts de la ville +25 %), `saboter_armee` (moral −20, munitions ×0,6),
    `assassiner` (un agent, ou le général d'une armée : `tuer_general`), `inciter` (ordre public −0,2) ; sabotages en
    guerre seulement ;
  - gentilhomme : `duel`, `universite` (poste dans sa ville à collège : les recherches en cours avancent de
    `AGENT_RECHERCHE` = 10 % de plus, +25 % par niveau), `voler_tech` (une découverte du camp visé dont on a les prérequis) ;
  - prêtre : `apaiser` (poste : ordre public + `AGENT_APAISE` = 0,06 par mois, +25 % par niveau), `denoncer` (un agent
    étranger vu dans une de nos places, prêtre compris : pris, avec l'incident) ;
  - diplomate : `ambassade` (poste dans la capitale d'un camp en paix ; relation +1 par mois jusqu'à 60 ; fermée par la
    guerre : expulsé). **`agents::diplomate_present(g, code, chez) -> bool`** pour R9.
- **Expérience** : +1 par mission réussie (+2 si la base est sous 50 %), +1 par six mois de poste ; niveaux à 0, 2, 5, 9,
  14 ; chaque niveau donne un trait du type (`rules.AGENT_TRAITS` : Discret, Rusé, Fine lame, Éloquent, Pieux ; Bavard
  par un échec).
- **Commandes** `{cmd: "agent", sub, …}` : `recruter {node, type}`, `deplacer {agent, node}`, `mission {agent, mission,
  cible}` (cible : numéro de place, identifiant d'armée « a… » ou d'agent « ag… »), `chance {agent, mission, cible}` (rend
  `{ok, chance, msg}` sans donner l'ordre), `annuler {agent}` (quitte le poste, ou s'arrête à la prochaine place). Rend
  `{ok, msg}`. Tout sauf `recruter` et `chance` est refusé pendant le tour des IA (`TT::lock_reason`).
- **Vue** : `agents: [{id, proprio, type, nom, case: [x, y], niveau, traits, mission, cache}]` (les siens, ceux des alliés,
  les étrangers vus ; un espion caché seulement démasqué) ; pour les siens en plus `xp, at_node, dest, chemin, mp, repos
  (tours), possibles: [{mission, cible, chance}]` ; `agents_camp: {type: {n, plafond}}`. Les agents du joueur et de ses
  alliés voient à 8 autour d'eux (la vue seulement). Règles : `rules.AGENTS`, `rules.MISSIONS`, `rules.agent_traits`,
  `rules.agent_ordre`.
- **IA** (`ai/agents.rs`, tous les 15 jours) : forme un agent si elle a coût + 400 livres (espion d'abord en guerre,
  prêtre si une place est sous 55 % d'ordre public, puis gentilhomme, diplomate ; deux par type au plus), mène la
  meilleure mission possible là où il est, sinon l'envoie vers sa cible (place forte ennemie convoitée, place agitée,
  université, capitale d'un allié ou d'un voisin en paix) ; une cible injoignable est oubliée 90 jours.
- **Écarts, pas fait** : l'ancienne commande `spy` (et `g.spies`, `rules.spy`) reste pour la page actuelle (`ui.js`) :
  P8 la remplacera par les pions, puis elle pourra partir. Pas d'« accords secrets » ni de mariage par le diplomate (R9 lit
  `diplomate_present`) ; pas de défense active des universités par l'IA (le contre-espionnage passif compte) ; l'entretien
  des agents n'apparaît pas dans `me.upkeep`.

