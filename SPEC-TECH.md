# Spec : les technologies et le rendu qui suit l'époque

Demande du 18/10/2026 : « tout le rendu et aussi les technologies doivent pouvoir évoluer en fonction de l'année et de
la période du jeu », avec des animations à la découverte, et des rendus des technologies sociales, agricoles,
industrielles et militaires, en bataille comme sur la carte de la grande campagne.

Propositions, constat de l'existant et choix du questionnaire : `tasks/propositions-technologies.md`.
Cette spec couvre les **phases 0 et 1**. Les phases 2 à 4 auront chacune leur section, écrite au moment de les
commencer.

## Carte des modules

| Module | Ce qu'il fait | Dépend de | Phase |
|---|---|---|---|
| `visuels` | Table `rules.VISUALS` : quelle technologie ou quelle année déclenche quelle marque visible ; marques de chaque camp et arme de chaque régiment envoyées à la bataille | — | 0 |
| `arbre` | Branche « civil et social », 21 nouvelles technologies et leurs effets nouveaux, mitrailleuse devenue unité | — | 0 |
| `bataille-armes` | Piquiers, poudre noire puis sans fumée, modèles de canons, batterie de mitrailleuses, vrais drapeaux d'époque | `visuels`, `arbre` | 1 |
| `carte-epoque` | Rails et trains (les armées les prennent), Chappe, vapeurs, usines, pins, vignes, drapeaux des villes ; découpé en `carte-rail`, `carte-industrie`, `carte-paysage`, `carte-allure` (section « Phase 2 ») | `visuels`, `arbre` | 2 |
| `decouvertes` | Mise en scène sur la carte, fenêtre « gravure », frise, bandeau des IA | `carte-epoque` | 3 |
| `bataille-decor` | Voie ferrée, télégraphe, usines, cultures, ambulances, ballons, retranchements dans le décor | `bataille-armes`, `carte-epoque` | 4 |

Ordre : `visuels`, `arbre` → `bataille-armes` → `carte-epoque` → `decouvertes`, `bataille-decor`.
(Les phases et leur ordre sont ceux que tu as choisis le 18/10 ; cette table leur donne des noms stables.)

## Choix validés (questionnaires du 18/10/2026)

- Tout le rendu (phases 1 à 4) ; monde **mixte** : les nouveautés suivent les technologies de chaque camp, les lignes
  se construisent peu à peu sur les tracés historiques ; les armées prennent le train dès la phase 2.
- Découverte : mise en scène sur la carte et fenêtre « gravure », frise, bandeau des IA (phase 3).
- **Civil et social** : la branche « civil » est renommée, pas de cinquième branche.
- **Toutes** les nouvelles technologies proposées, avec des **effets nouveaux** (pas seulement des bonus existants).
- **Vrais drapeaux d'époque** (pas aux couleurs du camp) : les fanions carrés de l'interface restent pour distinguer
  les camps.
- **Mitrailleuse : une nouvelle sorte d'unité**, avec ses règles.
- **Piquiers : le plus réaliste selon l'époque.**
- Méthode : phase par phase, spec, plan, construction par petites étapes avec ton accord, galerie, revue.

## Hypothèses (à corriger maintenant si besoin)

1. L'identifiant interne de la branche reste `civil` (sauvegardes, IA, goûts des IA inchangés) ; seul le nom affiché
   devient « Civil et social ».
2. Les piquiers suivent l'arme du régiment : un régiment armé « mousquet et piques » (génération 0) en a, même si son
   camp tarde à chercher la baïonnette après 1703. Vers 1700, l'infanterie française comptait environ un piquier pour
   quatre ou cinq mousquetaires, groupés au centre du bataillon : on prend **un homme sur cinq, au centre, sur toute la
   profondeur**.
3. La poudre sans fumée : l'infanterie la reçoit avec son fusil (Lebel, génération 7) ; l'artillerie et les
   mitrailleuses dès que leur camp a la technologie `lebel` (la poudre B est nationale).
4. Les nouveaux effets ont des valeurs de départ (tableau ci-dessous) ; on les règle avec les bancs de campagne
   (62 parties simulées), pas à l'œil.
5. Les parties sauvegardées se chargent : les camps qui avaient la technologie `mitrailleuse` perdent son ancien bonus
   de feu et gagnent le droit de lever des mitrailleuses.
6. Rien n'est chargé depuis Internet ; aucune dépendance nouvelle ; les drapeaux sont dessinés (canevas), d'après
   des modèles du domaine public.

## Module `visuels` (phase 0)

Une table dans `game/rules.py` : chaque marque visible, ce qui la déclenche, et pour qui.

```python
# marques visibles : ce qui les déclenche (technologie du camp, ou année de la partie) ; la carte et la bataille
# lisent cette table au lieu de comparer des années partout
VISUALS = dict(
    sans_fumee=dict(tech='lebel'),             # poudre B : artillerie et mitrailleuses du camp
    reffye=dict(tech='mitrailleuse'),
    aerostat=dict(tech='aerostiers'),
    # phases 2 à 4 : rail, chappe, telegraphe, gaz, fabriques, pins, phylloxera…
)
```

- `make_spec` (`game/tactics/bridge.py`) envoie `marks=[[…], […]]` : les marques de chaque camp. L'actuel
  `art_cheval` reste tel quel (il sert aux règles).
- La vue d'une unité (`Unit.view`) envoie son `arm` (génération d'armes), aujourd'hui seulement dans le moteur.
- Les drapeaux dépendent de l'année seule : la table des drapeaux est côté client (module `bataille-armes`), avec
  l'année que la bataille reçoit déjà.
- Le banc d'essai (`dev/simulation.mjs`) prend `?marks=` et une arme par régiment selon l'année du scénario.

## Module `arbre` (phase 0)

### Branche

« Civil » devient « Civil et social » dans l'interface (`BRANCH_LABEL`) et dans la phrase d'en-tête du panneau des
recherches.

### Nouvelles technologies

Effets **en gras** : règle nouvelle à écrire dans le moteur. Les autres reprennent des effets existants.
Coûts et durées dans la gamme de leur époque (500 à 2 000 livres, un à trois tours).

| Id | Branche | Nom | Année | Prérequis | Effet |
|---|---|---|---|---|---|
| `aerostiers` | militaire | Aérostiers (Fleurus) | 1794 | `genie` | **en bataille, un ballon captif voit tout à 1 500 m de l'état-major** ; vision +3 km |
| `retranchements` | militaire | Retranchements de campagne | 1860 | `genie` | **en bataille, l'infanterie arrêtée depuis 5 minutes se retranche : pertes au feu −25 %** |
| `dynamite` | militaire | Dynamite | 1867 | `genie` | **à l'assaut, les remparts ont un niveau de brèche de plus** ; sièges +20 % |
| `melinite` | militaire | Obus à la mélinite | 1885 | `dynamite`, `debange` | **le couvert (bâtiments, bois, retranchements) protège moitié moins des pièces de ce camp** |
| `rail_militaire` | militaire | Chemins de fer militaires | 1859 | `chemins_fer` | **les armées prennent le train sur les lignes de leur camp** (règle écrite en phase 2 ; en phase 0, la technologie existe et le dit) |
| `mitrailleuse` | militaire | Mitrailleuse de Reffye | 1866 | `lahitte` | **débloque la batterie de mitrailleuses** (remplace l'ancien bonus de feu) |
| `vaccine` | civil | Vaccine (Jenner) | 1800 | — | usure −15 % ; **les épidémies (choléra…) frappent moitié moins** |
| `caisse_epargne` | civil | Caisse d'épargne | 1819 | `escompte` | **le trésor rapporte 2 % l'an** |
| `gaz` | civil | Éclairage au gaz | 1830 | `vapeur` | ordre public +6 % ; **les villes (pas les villages) produisent 5 % de livres de plus** |
| `photographie` | civil | Photographie | 1839 | `ecoles` | **les armées ennemies repérées montrent l'armement et l'expérience de leurs régiments** |
| `suffrage` | civil | Suffrage universel | 1848 | `codecivil` | **lassitude de la guerre −25 %** ; ordre public +5 % |
| `mutuelles` | civil | Sociétés de secours mutuels | 1852 | `suffrage` | **les révoltes coûtent moitié moins d'ordre public** ; recrues +5 % |
| `croix_rouge` | civil | Croix-Rouge (convention de Genève) | 1864 | `larrey` | **un quart des blessés d'une bataille rejoint ses régiments** ; pertes −5 % |
| `telephone` | civil | Téléphone | 1879 | `telegraphe` | vision des villes +10 km ; **les alertes d'invasion arrivent un tour plus tôt** |
| `syndicats` | civil | Syndicats (loi de 1884) | 1884 | `mutuelles` | industrie +10 % ; **grèves : un mois de production perdu par an si l'ordre public est bas** |
| `vapeur_fluviale` | industriel | Bateau à vapeur | 1818 | `vapeur` | **on remonte les fleuves aussi vite qu'on les descend** ; ports +10 % |
| `ciment` | industriel | Ciment (Vicat) | 1817 | `manufactures` | **constructions −15 % de coût et de délai** |
| `fresnel` | industriel | Phares à lentille de Fresnel | 1823 | `canal` | ports +15 % ; **navires perdus en mer −50 %** (si le jeu en perd ; sinon commerce +10 %) |
| `betterave` | agricole | Sucre de betterave | 1812 | `assolement` | vivres +5 % ; **le Blocus continental ne coûte plus de livres** |
| `dombasle` | agricole | Charrue Dombasle | 1820 | `assolement` | vivres +10 % |
| `moissonneuses` | agricole | Moissonneuses et batteuses à vapeur | 1855 | `dombasle`, `vapeur` | vivres +15 % ; **recrues +10 % (bras libérés)** |
| `bouillie` | agricole | Bouillie bordelaise (Millardet) | 1885 | `greffe` | vin +15 % ; **le phylloxéra et le mildiou frappent moitié moins** |

Les dates entrent dans `TECH_YEAR` ; les scénarios de départ (1790, 1813, 1870) donnent comme aujourd'hui les
technologies antérieures à leur `techs_before`.

### La batterie de mitrailleuses (unité nouvelle)

- Type `mitrailleuses`, de la classe `artillerie` (mêmes formations, avant-trains, servants, munitions, capture) ;
  levée avec la technologie `mitrailleuse`, dans les villes qui lèvent l'artillerie.
- Six pièces de Reffye ; portée efficace 1 200 m, maximale 2 000 m ; pas de mitraille ni de boulet : un feu roulant
  qui frappe une bande étroite (comme une salve), cadence élevée, munitions qui fondent vite.
- Plus faible que l'artillerie contre les pièces et les remparts, redoutable contre l'infanterie en terrain découvert.
- Les IA la lèvent selon leurs goûts (comme l'artillerie).
- Valeurs exactes réglées par les bancs de bataille (une batterie contre une ligne, contre une batterie).

## Module `bataille-armes` (phase 1)

### Piquiers (régiments armés « mousquet et piques »)

- Un homme sur cinq porte la pique, groupé au centre du régiment sur toute la profondeur.
- Pique dressée au repos et en marche, croisée en avant à la charge, en mêlée et contre la cavalerie (carré).
- Ils ne tirent pas : pendant la salve, ils restent pique dressée.
- De loin, la pique reste visible (trait fin) ; les mousquetaires gardent leurs gestes actuels.
- Les petites figurines des cartes d'unités montrent un piquier.

### Poudre noire, puis sans fumée

- Jusqu'à la poudre B : les nuages blancs actuels.
- Régiment au fusil Lebel, artillerie et mitrailleuses d'un camp qui a `sans_fumee` : un éclair à la bouche, un voile
  bleuté très léger qui se dissipe en quelques secondes, plus de banc de fumée.
- Dans une même bataille, les deux peuvent se côtoyer (un camp en avance, ou un régiment pas encore réarmé).

### Pièces d'artillerie selon leur génération

| Génération | Arme | Pièce |
|---|---|---|
| 0 et 1 | canons de bronze, système Vallière | long fût de bronze orné, affût lourd en bois naturel |
| 2 | Gribeauval | fût de bronze plus court, affût à flasques vert olive (la pièce d'aujourd'hui) |
| 3 | système Valée | bronze, affût à flèche unique, coffret sur l'essieu |
| 4 | canons rayés La Hitte | même affût, fût de bronze rayé, plus fin |
| 5 | de Bange | fût d'acier sombre, culasse, affût d'acier |
| 6 | canon de 75 | tube long et fin, frein sous le tube, bouclier, roues hautes |

- Les avant-trains et caissons suivent (bois naturel avant Gribeauval, olive ensuite, acier gris dès de Bange).
- Le canon de 75 tire plus vite (règle existante) ; on voit le recul du tube sur son frein, pas de l'affût.
- Les cartes d'unités montrent la pièce de leur génération.

### Batterie de mitrailleuses

- Pièce de Reffye : faisceau de 25 canons dans un tube de bronze, manivelle à l'arrière, affût de campagne.
- Tir : crépitement de petits éclairs sur la bouche, fumée en filet continu (ou presque rien sans fumée).
- Servants : moins nombreux qu'au canon (quatre par pièce), un tourne la manivelle.
- Sa carte d'unité et son fanion ont leur propre pictogramme.

### Vrais drapeaux d'époque

Le drapeau du porte-drapeau (et l'étendard de la cavalerie, plus petit, frangé) suit l'année de la bataille :

| Années | Drapeau | Haut de la hampe |
|---|---|---|
| 1700-1790 | drapeau d'ordonnance : croix blanche, quartiers aux couleurs du régiment (chaque régiment les siennes, tirées d'une liste des couleurs historiques) | fer de lance |
| 1791-1793 | modèle 1791 : quartiers d'ordonnance, canton tricolore | fer de lance |
| 1794-1803 | modèle de l'an II : tricolore, losange blanc central | pique tricolore |
| 1804-1812 | modèle 1804 : losange blanc, coins bleus et rouges alternés, inscriptions dorées | aigle |
| 1813-1814 | modèle 1812 : trois bandes verticales | aigle |
| 1815 (Cent-Jours) | modèle 1812 | aigle |
| 1816-1830 | drapeau blanc fleurdelisé, armes de France | fer de lance |
| 1831-1852 | tricolore vertical | coq |
| 1853-1870 | tricolore vertical | aigle |
| 1871-1899 | tricolore vertical, « RF » | fer de lance |

- Une cravate tricolore à la hampe dès 1791 (blanche de 1816 à 1830).
- Les fanions carrés au-dessus des régiments (l'interface) gardent la couleur du camp : c'est eux qui disent à qui est
  un régiment ; la notice du banc d'essai le rappelle.
- La milice et la garde nationale portent le drapeau de leur ville (aux couleurs de la ville) avant 1790, tricolore
  ensuite.

## Tech stack

Celui du jeu : Python 3 sans dépendance pour le moteur (`game/`), JavaScript en modules ES et Three.js r186 copié dans
`web/vendor/three/` pour la bataille, WebGL 2, aucun outil de construction. Les figurines suivent le squelette et les
animations Quaternius (CC0) de l'étape 7 ; la pique est portée par l'os du fusil, comme la hampe.

## Commandes

```bash
python3 tests/lancer.py                                   # tous les bancs (Python + interface), avant chaque commit
node --test tests/                                        # l'interface seule
node web/js/battle/dev/maquette.mjs --port 8816           # bataille simulée ; puis /js/battle/dev/banc.html?scen=bocage&start=1
node web/js/battle/dev/capture.mjs bocage /tmp/b.png --q "avance=300&year=1700" --js "…"     # capture du banc
free -m                                                   # avant une capture : au moins 1,5 Go de libre
./lancer.sh                                               # jouer (http://127.0.0.1:8790)
```

## Structure (fichiers touchés)

```
game/rules.py             VISUALS ; 21 technologies ; TECH_YEAR ; unité « mitrailleuses » ; ARMS (la mitrailleuse)
game/engine.py            effets nouveaux (trésor, villes, épidémies, lassitude, révoltes, grèves, blessés, constructions)
game/events.py            choléra, blocus, phylloxéra et mildiou atténués par vaccine, betterave, bouillie
game/views.py             photographie : armement et expérience des régiments ennemis repérés
game/cities.py            constructions (ciment), levée des mitrailleuses
game/ai.py                goût des IA pour les mitrailleuses
game/tactics/units.py     arm dans la vue ; portées, cadence et feu de la mitrailleuse
game/tactics/battle.py    ballon (vision), retranchement, mélinite, brèche (dynamite)
game/tactics/bridge.py    marques des camps dans la spec ; blessés qui reviennent (Croix-Rouge)
web/js/ui.js              « Civil et social » ; la batterie de mitrailleuses dans la levée
web/js/battle/troupes.js  piquiers ; pièces par génération ; Reffye ; drapeaux d'époque ; cravate et haut de hampe
web/js/battle/effets.js   tir sans fumée ; crépitement de la mitrailleuse
web/js/battle/gestes.js   geste du piquier selon l'état ; drapeau d'une année (logique pure, testée sous Node)
web/js/battle/unites.js   cartes d'unités : piquier, pièce de sa génération, Reffye
web/js/battle/fanions.js  pictogramme de la mitrailleuse
web/js/battle/dev/simulation.mjs   ?marks=, arme par régiment selon l'année, une batterie de mitrailleuses
tests/test_campagne.py, tests/test_bataille.py, tests/gestes.test.mjs, tests/modeles.test.mjs   bancs
README.md                 technologies, mitrailleuse, rendu selon l'époque
```

## Style de code

Celui du jeu : français, commentaires qui disent le pourquoi, fonctions courtes, constantes en majuscules, tables de
données plutôt que des `if` (comme `ARMS`, `UNIT_NAMES`). Ce qui ne dessine rien va dans `gestes.js`, testable sans
navigateur :

```js
// drapeau d'un régiment selon l'année : modèle de l'étoffe et haut de la hampe (SPEC-TECH, « Vrais drapeaux »)
const DRAPEAUX = [[1790, 'ordonnance', 'lance'], [1793, 'm1791', 'lance'], [1803, 'an2', 'pique'], [1812, 'm1804', 'aigle'],
  [1815, 'm1812', 'aigle'], [1830, 'lys', 'lance'], [1852, 'tricolore', 'coq'], [1870, 'tricolore', 'aigle'], [9999, 'rf', 'lance']];
export const drapeau = year => DRAPEAUX.find(([fin]) => year <= fin);
```

## Stratégie de test

- **Bancs Python** (`tests/test_campagne.py`, `tests/test_bataille.py`) :
  - chaque technologie a une année, des prérequis qui existent, une durée en tours entiers, et n'est pas
    cherchable avant son année ;
  - chaque effet nouveau, sur une partie fabriquée (`tests/fabrique.py`) : trésor qui rapporte, épidémie atténuée,
    blessés qui reviennent, brèche de plus, ballon qui lève le brouillard, retranchement qui protège, mélinite ;
  - une batterie de mitrailleuses contre une ligne en plaine fait plus de pertes qu'une batterie de 8 pièces de la
    même année ; contre une batterie, moins ;
  - une partie sauvegardée avant la spec se charge et se joue un an ;
  - les marques des camps et l'`arm` des unités arrivent dans la spec et la vue de la bataille ;
  - les 62 parties simulées (banc de campagne) finissent sans erreur, la durée des guerres et l'équilibre des camps
    restent dans leurs bornes actuelles.
- **Bancs Node** (`tests/gestes.test.mjs`, `tests/modeles.test.mjs`) : drapeau de chaque année du tableau ; geste du
  piquier dans chaque état ; un homme sur cinq piquier, au centre ; modèle de pièce de chaque génération ; chaque
  modèle a des os valides de près et de loin.
- **Captures** (galerie, port 8799) : une bataille en 1700, 1793, 1808, 1815, 1870, 1890 (mêmes scénarios), de près et
  de loin ; piquiers ; chaque pièce ; une batterie de mitrailleuses qui tire ; la même salve avec et sans fumée.
- **Essai à la main** sur l'iPad : images par seconde au moins égales à celles de l'étape 7.

## Limites

- **Toujours :**
  - lancer `python3 tests/lancer.py` avant chaque commit ;
  - garder les identifiants des technologies et des branches (sauvegardes) ;
  - garder le budget d'attributs des figurines (16 au plus) et les plafonds de la qualité ;
  - garder les deux camps lisibles (fanions) même quand les drapeaux sont les mêmes.
- **Demander d'abord :**
  - toute dépendance nouvelle ;
  - un effet nouveau qui n'est pas dans le tableau, ou une valeur qui s'en écarte de plus du double ;
  - toucher aux pions des armées sur la carte de campagne (phase 2) ;
  - descendre l'objectif de 30 images/s.
- **Jamais :**
  - utiliser des fichiers d'Ultimate General, ou des images sous droits (drapeaux et pièces dessinés d'après des modèles
    du domaine public ou la connaissance générale) ;
  - charger quoi que ce soit depuis Internet pendant le jeu ;
  - modifier `web/vendor/` ;
  - casser une partie sauvegardée.

## Critères de réussite (phases 0 et 1)

1. Le panneau des recherches montre « Civil et social » et les 94 technologies (73 + 21), chacune disponible à partir de son année.
2. Chaque effet nouveau se vérifie par son banc ; les 62 parties simulées restent équilibrées.
3. Une batterie de mitrailleuses se lève après la découverte, se déploie et tire en bataille.
4. En 1700, des piquiers au centre des régiments au mousquet, qui croisent la pique à la charge et ne tirent pas.
5. Après le Lebel, plus de bancs de fumée pour ce camp ; l'autre camp, à poudre noire, garde les siens.
6. Chaque génération d'artillerie a sa pièce, de près, de loin et sur sa carte d'unité.
7. Le drapeau du porte-drapeau est celui de l'année (tableau), avec son haut de hampe ; les camps restent lisibles par
   leurs fanions.
8. `python3 tests/lancer.py` passe ; aucune erreur sur les scénarios du banc ; images par seconde sur l'iPad au moins
   celles de l'étape 7.

## État (18/10/2026, phases 0 et 1)

Construit en `/build auto` (T51 à T68, un commit par tâche), suivi d'une revue complète et de ses corrections.
- **Phase 0** : faite. Le banc d'équilibre (`outils/simuler.py`) est écrit. Avant et après, 1790 à 1820 : toutes les
  mesures restent dans ±25 % (`tasks/equilibre-reference.md`). Une sauvegarde d'avant le chantier se joue un an sans
  erreur.
- **Phase 1** : faite : poudre sans fumée, piquiers, une pièce par génération, Reffye, vrais drapeaux. Captures dans la
  galerie (port 8799, section « Technologies »).
- **Reste à faire** : ton avis sur la galerie et l'essai sur l'iPad (images par seconde). Ensuite, la spec de la
  phase 2 (la carte qui change, le train).
- **Écarts à la spec, acceptés le 18/10** (`tasks/plan-tech.md`) : les mutuelles rendent les révoltes moitié moins
  probables ; Fresnel donne commerce +10 % ; un événement « mildiou » apparaît en 1882 ; le ciment réduit aussi les prix
  affichés. Une grève ne descend pas l'industrie sous 10 % (les ateliers sont « presque arrêtés »).

## Questions ouvertes

Spec validée le 18/10/2026 (questionnaire) ; prochaine étape : le plan.

1. ~~Fresnel~~ : le jeu ne perd pas de navires ; l'effet devient commerce +10 %, ports +15 %. Autres écarts acceptés le
   18/10 (mutuelles, mildiou, ciment, banc d'équilibre) : `tasks/plan-tech.md`, « Écarts à la spec ».
2. ~~Grèves~~ : réglé le 18/10, l'effet négatif reste (c'est réaliste).
3. ~~Drapeaux de 1700 à 1790~~ : réglé le 18/10, chaque régiment a ses quartiers, tirés des couleurs historiques.
4. **Ordre des phases suivantes** : on refait un point après la phase 1 (galerie et iPad) avant d'écrire la spec de la
   phase 2.

---

# Phase 2 : la carte qui change avec les siècles (module `carte-epoque`)

Spec écrite le 19/10/2026, après les phases 0 et 1. Choix du questionnaire du même jour, plus les choix du 18/10
(monde mixte, les armées prennent le train dès la phase 2).

## Découpage (sous-modules, dans cet ordre)

| Sous-module | Ce qu'il fait | Dépend de |
|---|---|---|
| `carte-rail` (2a) | Chantiers de voies ferrées par tronçon, trains sur la carte, gares, armées qui prennent le train, rails qui dopent l'industrie | `visuels`, `arbre` |
| `carte-industrie` (2b) | Tours Chappe puis poteaux télégraphiques, bateaux à vapeur, cheminées d'usines, lueur des forges, réverbères au gaz | `visuels` |
| `carte-paysage` (2c) | Les pins gagnent les Landes, les marais rétrécissent, les vignes brunissent puis renaissent, les cultures changent | `visuels` |
| `carte-allure` (2d) | Drapeaux d'époque sur les villes, passants de l'époque, style de la carte (Cassini, état-major) | `visuels`, `bataille-armes` (table des drapeaux) |

Chaque sous-module a son plan, sa construction, sa galerie et sa revue. 2a vient d'abord : c'est le seul qui change les
règles. 2b à 2d ne changent que le rendu.

## Choix validés (questionnaire du 19/10/2026)

- **Chantiers payés, tronçon par tronçon** : d'une ville à la suivante sur les tracés historiques. Chaque tronçon se
  paie (livres, fer, bois) et avance doucement.
- **L'industrie et les rails se nourrissent** : l'industrie du camp fait avancer les chantiers plus vite, et chaque
  tronçon achevé dope l'industrie et le commerce des villes qu'il dessert.
- **Le train** : environ six fois plus vite qu'à pied sur une ligne achevée, et une journée pour embarquer en gare. On
  roule sur ses lignes et sur celles des alliés. Une ligne prise passe à l'ennemi, qui s'en sert s'il a la technologie.
  Les IA s'en servent aussi.
- **Le bonus de « Chemins de fer » passe sur les lignes** : la technologie ne donne plus +30 % sur toutes les routes.
  Elle ouvre les chantiers, et le gain ne vaut que là où il y a des rails.
- **Toute la carte** (2a à 2d), dans l'ordre : le train, puis télégraphes et usines, puis le paysage, puis l'allure.

## Hypothèses (à corriger maintenant si besoin)

1. **Les lignes historiques donnent l'ordre, pas la date.** Une fois la technologie trouvée, tous les tronçons du
   tableau ci-dessous sont ouvrables. Leur année historique sert seulement à les présenter (et à guider les IA). Un
   camp en avance peut donc avoir Bordeaux–Bayonne avant 1855.
2. **Un tronçon s'ouvre si** :
   - ses deux villes sont à vous ;
   - l'une d'elles est votre chef-lieu ou touche déjà une ligne achevée de votre camp : le réseau part du chef-lieu ;
   - il ne se construit qu'un chantier à la fois par tronçon, lancé depuis la file d'une des deux villes.
3. **Un tronçon suit la route la plus courte** entre ses deux villes : les routes royales d'abord, villages compris.
   Les rails sont dessinés le long de cette route, légèrement décalés.
4. **Une ligne n'appartient à personne** : elle est sur la carte. Un camp s'en sert si les deux villes du tronçon sont
   à lui ou à un allié. Prendre une ville prend donc les rails qui y mènent.
5. **Prix et durée de départ**, à régler au banc :
   - 30 livres, 8 fer et 6 bois par km ;
   - 4 jours de travail par km, à vitesse d'industrie moyenne.

   Un tronçon de 30 km coûte donc environ 900 livres, 240 fer et 180 bois, et demande 4 tours.
6. **Vitesse des chantiers** : × (0,5 à 2) selon l'industrie du camp, comparée à celle d'un camp moyen de son époque.
7. **Gain d'un tronçon achevé** : +5 % d'industrie et +5 % de livres de commerce pour chaque ville qu'il dessert, jusqu'à
   +15 % par ville. Une armée à moins de 30 km d'une gare de son camp s'use 30 % moins vite (l'ancien effet
   « ravitaillement » de la technologie).
8. **Le train** :
   - 130 km par jour sur un tronçon utilisable, avec « Chemins de fer militaires » ;
   - une journée d'embarquement au début d'un trajet en train ;
   - l'armée est désorganisée à la descente : moral −5, la fatigue de la marche en moins.
9. **Les sauvegardes d'avant la phase 2** se chargent sans rails. Un camp qui avait déjà la technologie peut lancer ses
   chantiers ; son bonus de +30 % sur les routes disparaît (changement d'effet : `recompute_mods` au chargement).

## Lignes historiques (vérifiées le 19/10/2026 sur les articles « Ligne de… » de Wikipédia)

Seules les villes de la carte sont nommées. « → bord » : la ligne continue hors de la carte, dessinée jusqu'au bord,
sans effet.

| Ligne | Villes (dans l'ordre) | Années | Confiance |
|---|---|---|---|
| Bordeaux–La Teste | Bordeaux, La Teste-de-Buch | 1841 | sûr |
| Paris–Bordeaux | Bordeaux, Libourne, Coutras → bord (Angoulême) | 1852 | sûr |
| Bordeaux–Bayonne (Midi) | Bordeaux, Morcenx, Dax, Bayonne | 1854 (Dax), 1855 (Bayonne) | sûr |
| Bordeaux–Sète (Midi) | Bordeaux, Langon, La Réole, Marmande, Tonneins, Aiguillon, Agen → bord (Toulouse) | 1855, 1856 (Agen) | sûr |
| Morcenx–Tarbes | Morcenx, Mont-de-Marsan, Aire-sur-l'Adour → bord (Tarbes) | 1857, 1859 (Aire) | sûr |
| Coutras–Périgueux | Coutras, Montpon, Mussidan, Périgueux | 1857 | sûr |
| Périgueux–Brive | Périgueux, Terrasson → bord (Brive) | 1860 | sûr |
| Périgueux–Limoges | Périgueux, Thiviers → bord (Limoges) | 1861 | sûr |
| Toulouse–Bayonne | Pau, Orthez, Peyrehorade, Bayonne ; Pau → bord (Tarbes) | 1863, 1864 (Bayonne) | 1864 probable |
| Puyoô–Dax | Orthez, Dax | 1863 | sûr |
| Agen–Périgueux | Agen, Fumel, Périgueux | 1863 | sûr |
| Bayonne–Irun | Bayonne, Biarritz, Saint-Jean-de-Luz, Hendaye → bord (Irun) | 1864 | sûr |
| Langon–Bazas | Langon, Bazas | 1866 | sûr |
| Penne–Villeneuve–Tonneins | Fumel, Villeneuve-sur-Lot (1869), Sainte-Livrade, Tonneins (1894) | 1869, 1894 | sûr |
| Libourne–Le Buisson | Libourne, Bergerac (1875), Lalinde (1879) | 1875, 1879 | sûr |
| Médoc | Bordeaux, Lesparre-Médoc | 1873 | sûr |
| Saint-Mariens–Blaye | Blaye → bord (Saint-Mariens) | 1873 | sûr |
| Port-Sainte-Marie–Condom | Aiguillon, Nérac | 1880 | sûr |
| La Cave–Ribérac | Périgueux, Ribérac | 1881 | sûr |
| Le Buisson–Sarlat | Lalinde, Sarlat | 1882 | sûr |
| Angoulême–Nontron–Thiviers | Nontron, Thiviers ; Nontron → bord (Angoulême) | 1883, 1892 | sûr |
| Pau–Oloron | Pau, Oloron-Sainte-Marie | 1883 | sûr |
| Puyoô–Mauléon | Orthez, Salies-de-Béarn, Mauléon | 1884, 1887 | sûr |
| Marmande–Angoulême | Marmande, Miramont, Bergerac, Mussidan, Ribérac | 1886, 1888, 1890 | sûr |
| Saintes–Bordeaux | Bordeaux, Saint-André-de-Cubzac → bord (Saintes) | 1886 | probable |
| Saint-André–Blaye | Saint-André-de-Cubzac, Blaye | 1889 | probable |
| Labouheyre–Mimizan | Morcenx, Mimizan (par Labouheyre, sur Bordeaux–Bayonne) | 1889 | sûr |
| Nérac–Mont-de-Marsan | Nérac, Mont-de-Marsan | 1890, 1897 | sûr |
| Marmande–Mont-de-Marsan | Marmande, Casteljaloux, Mont-de-Marsan | 1882 à 1893 | sûr |
| Dax–Mont-de-Marsan | Mont-de-Marsan, Saint-Sever, Dax | 1891, 1899 | sûr |

Sans train avant 1900 : Biscarrosse, Capbreton, Soustons, Hasparren.

## Sous-module `carte-rail` (2a) : ce que voit le joueur

- **Panneau de la ville** : une section « Voie ferrée ». Elle liste les tronçons ouvrables depuis cette ville (vers
  quelle ville, longueur, prix, durée), lance un chantier et montre son avancement. Le chantier prend une place dans la
  file de la ville, comme une construction.
- **Sur la carte** :
  - un tronçon en chantier se dessine en pointillés, avec des traverses qui avancent selon les travaux ;
  - un tronçon achevé se dessine comme une voie ferrée (deux rails et des traverses) le long de sa route ;
  - une petite gare apparaît dans chaque ville desservie ;
  - des trains animés roulent sur les lignes (une locomotive à panache, quelques wagons), comme les charrettes
    aujourd'hui. Ils roulent sur toutes les lignes achevées, à qui qu'elles soient.
- **Le train** : un ordre de marche qui passe par des tronçons utilisables prend le train de lui-même, avec
  l'embarquement en gare au début. Le tracé de l'ordre montre la partie en train (trait de rail) et la durée. Une armée
  dans un train se dessine en convoi sur la ligne.
- **Le bilan du tour** dit les tronçons achevés (« La ligne Bordeaux–Libourne est ouverte : Libourne +5 %
  d'industrie »).
- **Les IA** lancent des chantiers (en paix d'abord, en commençant par les lignes les plus anciennes du tableau) et
  font prendre le train à leurs armées.

## Sous-modules 2b à 2d : ce que voit le joueur (détaillés dans leur plan)

Tout se déclenche par `rules.VISUALS` : la technologie du camp qui tient la place, ou l'année.

- **2b, télégraphes, vapeurs, usines**
  - Tours Chappe aux bras mobiles sur les hauteurs, entre les villes d'un camp qui a `chappe`. Avec `telegraphe`, des
    poteaux et un fil le long des voies ferrées et des routes royales.
  - Bateaux à vapeur à roues parmi les gabares, sur les fleuves d'un camp qui a `vapeur_fluviale`.
  - Cheminées d'usine qui fument dans les villes qui ont une Fabrique, ou dans toutes les villes d'un camp qui a
    `vapeur`.
  - Lueur rouge des forges la nuit (`hauts_fourneaux`, `coke`), réverbères au gaz dans les villes la nuit (`gaz`).
- **2c, paysage**
  - Les Landes rases et leurs bergers sur échasses laissent peu à peu place aux pins : semis avec `pins`, puis forêt
    avec `landes1857`, cases converties au fil des années. Pots de résine avec `gemmage`.
  - Les marais rétrécissent avec `drainage`.
  - Les vignes brunissent au phylloxéra (l'événement de 1875) puis renaissent en rangs avec `greffe`.
  - Champs plus variés avec `assolement`, maïs en Chalosse et en Béarn avec `mais`, moissonneuses l'été avec
    `moissonneuses`.
- **2d, allure**
  - Drapeau d'époque au-dessus de chaque ville : la table des drapeaux de la phase 1, côté carte.
  - Passants sur les routes coiffés du tricorne, puis du bicorne, puis du haut-de-forme.
  - Style de la carte au choix dans les options (« d'époque » par défaut) : façon Cassini au XVIIIe (tons sépia,
    hachures), façon état-major au XIXe (couleurs plus franches).

## Fichiers touchés (2a)

```
game/rules.py            RAIL_LINES (tracés historiques), prix et durées, vitesse du train ; chemins_fer sans bonus de route
game/rails.py            NOUVEAU : tronçons (route la plus courte entre deux villes), ouvrables, chantiers, achèvement,
                         utilisables par un camp, effets sur les villes ; état dans g.rails (sauvegardé)
game/engine.py           file des villes (chantier de tronçon), vitesse et itinéraire des armées (train, embarquement),
                         ravitaillement près des gares, effets sur l'industrie et le commerce
game/ai.py               chantiers des IA, trains des armées
game/views.py            tronçons (achevés, en chantier, ouvrables) envoyés au navigateur ; sauvegardes
game/turns.py            bilan : tronçons ouverts
web/js/map.js            voies ferrées, chantiers, gares, convois en train, tracé d'ordre en train
web/js/ambient.js        trains animés et leur panache
web/js/ui.js             section « Voie ferrée » du panneau de la ville
tests/test_campagne.py   bancs ; outils/simuler.py inchangé (mesure avant et après)
README.md
```

## Stratégie de test (2a)

- **Bancs Python** :
  - les tronçons du tableau existent : chaque ville est sur la carte et une route relie les deux bouts ;
  - un tronçon s'ouvre seulement avec la technologie, les deux villes à soi, et un lien au chef-lieu ou au réseau ;
  - un chantier se paie, avance plus vite avec plus d'industrie, puis s'achève, et les villes desservies gagnent leur
    bonus ;
  - une armée avec `rail_militaire` met moins de temps par le train qu'à pied, embarquement compris ; sans la
    technologie, ou sur la ligne d'un ennemi, elle marche ;
  - une ville prise fait passer les rails qui y mènent au vainqueur ;
  - une sauvegarde d'avant la phase 2 se charge et se joue un an ;
  - les IA lancent des chantiers et prennent le train.
- **Banc d'équilibre** (`outils/simuler.py`) : 6 parties depuis 1790 et 6 depuis 1813, sur 40 ans, avant et après. Les
  mesures doivent rester dans ±25 %, et il faut au moins une ligne achevée par partie après 1841.
- **Bancs d'interface** : la section « Voie ferrée » du panneau, et le tracé d'un ordre en train.
- **Captures** de la carte en 1840, 1860 et 1880 (rails, gares, trains), et vidéo d'un train qui roule.

## Limites (2a), en plus de celles des phases 0 et 1

- **Toujours** :
  - tester les changements d'itinéraire sur les bancs de campagne existants (marches, sièges, retraites, gabares) ;
  - garder le tracé des routes tel quel ;
  - ne dessiner les rails que pour les tuiles de la carte touchées par un tronçon qui change.
- **Demander d'abord** :
  - changer la carte géographique (`game/data/geo.json`) ;
  - ajouter un tronçon qui ne suit pas une route existante ;
  - un prix ou une vitesse qui s'écarte de plus du double des valeurs ci-dessus.
- **Jamais** : casser une partie sauvegardée ; un tracé inventé présenté comme historique (une ligne douteuse est
  marquée « approximative » dans le tableau).

## Critères de réussite (2a)

1. Après « Chemins de fer », le panneau d'une ville propose les tronçons qui en partent. Un chantier lancé se paie,
   avance tour après tour (plus vite avec plus d'industrie), puis s'achève.
2. La voie ferrée se dessine sur la carte : pointillés pendant le chantier, rails ensuite. Les gares et les trains
   animés apparaissent.
3. Les villes desservies gagnent de l'industrie et du commerce, et le bilan du tour le dit.
4. Avec « Chemins de fer militaires », une armée prend le train sur ses lignes et celles des alliés, environ six fois
   plus vite qu'à pied, embarquement compris. Une ligne prise passe au vainqueur.
5. Les IA construisent des lignes et s'en servent.
6. Le bonus de +30 % sur toutes les routes a disparu. Le banc d'équilibre reste dans ±25 %.
7. `python3 tests/lancer.py` passe, et une sauvegarde d'avant la phase 2 se joue un an.

## Réponses du 19/10/2026 (spec de la phase 2 validée)

1. **Lignes partagées** : non, les deux villes d'un tronçon doivent être à vous. On roule pourtant sur les lignes des
   alliés.
2. **Sabotage, dès 2a** :
   - une armée en guerre avec le camp d'un tronçon, qui finit son tour sur la route de ce tronçon, le coupe ;
   - la ligne coupée ne sert plus à personne pendant 3 tours, puis elle est réparée d'elle-même ;
   - un convoi en route sur le tronçon coupé descend du train et finit à pied ;
   - le bilan du tour le dit aux deux camps ;
   - les IA coupent les lignes ennemies qu'elles traversent en guerre, et se méfient de celles qui sont coupées.
3. **Lignes hors carte** : dessinées jusqu'au bord de la carte. Les trains y entrent et en sortent, sans effet au-delà.

Ajouts aux critères de réussite de 2a : une armée qui finit son tour sur un tronçon ennemi le coupe pour 3 tours ;
plus personne n'y roule ; il est réparé ensuite.
