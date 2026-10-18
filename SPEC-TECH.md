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
| `carte-epoque` | Rails et trains (les armées les prennent), Chappe, vapeurs, usines, pins, vignes, drapeaux des villes | `visuels`, `arbre` | 2 |
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

## Questions ouvertes

Spec validée le 18/10/2026 (questionnaire) ; prochaine étape : le plan.

1. ~~Fresnel~~ : le jeu ne perd pas de navires ; l'effet devient commerce +10 %, ports +15 %. Autres écarts acceptés le
   18/10 (mutuelles, mildiou, ciment, banc d'équilibre) : `tasks/plan-tech.md`, « Écarts à la spec ».
2. ~~Grèves~~ : réglé le 18/10, l'effet négatif reste (c'est réaliste).
3. ~~Drapeaux de 1700 à 1790~~ : réglé le 18/10, chaque régiment a ses quartiers, tirés des couleurs historiques.
4. **Ordre des phases suivantes** : on refait un point après la phase 1 (galerie et iPad) avant d'écrire la spec de la
   phase 2.
