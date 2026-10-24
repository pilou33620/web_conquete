# Spec : l'arbre des technologies, la recherche libre et la modernisation des armées

Demande du 23/10/2026 : « je ne veux pas forcément attendre que la date soit bonne pour découvrir une technologie ;
pour chaque type, j'aimerais un arbre de technologies ; un bouton pour moderniser l'armée suivant la technologie
(canons à douille, feu de rang) ; pour le militaire, deux sections : artillerie, et fantassins et cavalerie ».

## Ce qui existe (avant ce chantier)

- `engine.research` refuse toute recherche avant l'année d'invention (`rules.TECH_YEAR`) ; une recherche dure 1 à
  3 tours, c'est la date qui fait patienter.
- Les prérequis existent (`req`), mais la fenêtre Technologies les montre en cartes par colonne, sans traits.
- Quatre branches : militaire, civil et social, industriel, agricole ; une recherche à la fois par branche.
- Les **armes** (fusils, canons) se gardent par régiment (`reg['arm']`) et se changent par le bouton « Réarmer », au
  repos dans une place, hors siège (armes, fer pour l'artillerie, −15 % d'expérience). Les **manœuvres** (feu de rang,
  feu de peloton, ordre mixte, cuirassiers…) jouent aussitôt pour tout le camp (`engine.mod`, `spec['tech'][camp]`).

## Choix validés (questionnaires du 23/10/2026)

- **Recherche libre** : seuls les prérequis comptent, plus la date.
- **Garde-fous** : durées selon l'étage dans l'arbre, et prérequis entre branches.
- **Rythme** : une branche cherchée sans arrêt, sans bonus, se termine **vers 1890**, comme l'histoire.
- **Arbre par étages, un onglet par branche.**
- **Tout passe par « Moderniser »** : les armes et les manœuvres de troupe ; prix en livres et une immobilisation
  d'**un tour au plus**, dans une place.
- Manœuvres entraînées par régiment : **les manœuvres de troupe seulement** ; ce qui relève de l'État reste national.
- **Deux branches militaires, deux recherches en parallèle** : « Infanterie et cavalerie », « Artillerie et génie ».

## Carte des modules

| Module | Ce qu'il fait | Dépend de |
|---|---|---|
| `branches` | La branche militaire devient deux branches ; sauvegardes, IA, découvertes suivent | — |
| `recherche-libre` | Plus de date ; prérequis entre branches ; durée selon l'étage | `branches` |
| `arbre-ecran` | La fenêtre Technologies devient un arbre par onglet | `branches`, `recherche-libre` |
| `moderniser` | Les manœuvres apprises par régiment ; le bouton « Moderniser » remplace « Réarmer » | `branches` |

Ordre : `branches` → `recherche-libre` → `arbre-ecran`, `moderniser` (ces deux-là sont indépendants).

## Hypothèses (à corriger maintenant si besoin)

1. Identifiants des branches : `infanterie` (« Infanterie et cavalerie ») et `artillerie` (« Artillerie et génie ») ;
   `militaire` disparaît. Les IA de goût `militaire` (Landes, Pays basque) préfèrent les deux.
2. Le coût en livres reste celui d'aujourd'hui (il monte déjà de 375 à 2 000 le long de l'arbre), payé au lancement.
   Seule la durée change.
3. `TECH_YEAR` reste : il sert aux départs 1790, 1813 et 1870 (les technologies déjà acquises), aux villages insurgés,
   à la frise (« en avance de 40 ans sur l'histoire ») et à l'arbre (« historiquement : 1866 »).
4. Les sauvegardes se chargent : une recherche militaire en cours passe dans sa nouvelle branche, et **les régiments
   existants reçoivent toutes les manœuvres que leur camp connaît** (on n'affaiblit pas une partie en cours).
5. Les nouveaux régiments sont levés avec les armes et les manœuvres du moment ; la milice et la Garde nationale ont
   toujours celles de leur camp (comme les armes aujourd'hui).
6. Rien de neuf à télécharger, aucune dépendance.

## Module `branches`

| Infanterie et cavalerie (19) | Artillerie et génie (13) |
|---|---|
| baïonnette, fusil 1777, percussion, Minié, Chassepot, Gras, Lebel ; hussards, cuirassiers ; voltigeurs, feu de rang, feu de peloton, ordre mixte, retranchements ; levée en masse, système divisionnaire, état-major, service militaire, chemins de fer militaires | Vallière, Gribeauval, Valée, La Hitte, de Bange, canon de 75, mitrailleuse, artillerie à cheval, mélinite ; Vauban, génie, aérostiers, dynamite |

- `rules.BRANCHES` : cinq branches ; une recherche en cours par branche (donc deux militaires à la fois).
- L'IA cherche dans cinq branches ; ses seuils (« combien de recherches à la fois selon le trésor ») passent de 4 à 5.
- `decouvertes.js` : les deux branches militaires gardent l'illustration « canon » de la gravure.

## Module `recherche-libre`

### Plus de date

`engine.research`, `ai.research` et la fenêtre ne regardent plus `TECH_YEAR` : seuls les prérequis comptent.

### Prérequis entre branches (ajoutés aux prérequis actuels)

| Technologie | Demande en plus | Pourquoi |
|---|---|---|
| Fusil à percussion | Poudreries | l'amorce au fulminate |
| Chassepot | Outillage standardisé | la culasse usinée |
| Fusil Gras | Acier | la cartouche métallique, le canon d'acier |
| Lebel | Dynamite | la poudre B est une poudre chimique |
| Gribeauval | Fonderie de canons | des tubes forés et standard |
| Canons rayés La Hitte | Forges au coke | une fonte meilleure |
| Mitrailleuse | Pièces interchangeables | 25 canons identiques |
| Canons de Bange, dynamite | Acier | |
| Chemins de fer | Machine à vapeur | |
| Machine à vapeur | Forges au coke | |
| Acier | Machine à vapeur | convertisseurs soufflés |
| Outillage standardisé | Pièces interchangeables | |
| Électricité | Télégraphe électrique | |
| Service militaire | Chemins de fer | la mobilisation par le rail |
| Retranchements | Fusil Minié | la portée qui oblige à s'enterrer |
| Préfectures, gendarmerie, semis de pins | Ponts et Chaussées | |
| Canaux | Ponts de pierre | |
| Larrey, vaccine | Écoles centrales | médecins formés |
| Hygiène pastorienne | Vaccine | |
| Pomme de terre | Assolement | |
| Engrais chimiques | Machine à vapeur | |
| Vignes greffées | Engrais chimiques | l'agronomie savante |

Aucun prérequis ajouté n'est plus récent que la technologie qui le demande : les départs 1790, 1813 et 1870 restent
cohérents (un test le vérifie).

### Durée selon l'étage

- **Étage** d'une technologie : la plus longue chaîne de prérequis, toutes branches comprises (0 = sans prérequis).
- **Durée** = 190 ans × (1 + étage) ÷ (somme des (1 + étage) de sa branche), arrondie au tour.
  - Une branche cherchée sans arrêt dure donc 190 ans, soit 1700 à 1890 environ, quel que soit son nombre de
    technologies.
  - Les bonus de recherche (écoles centrales +25 %, Jules Ferry +20 %) font finir plus tôt.
- Ordres de grandeur : baïonnette 3 ans, fusil 1777 6 ans, Chassepot 14 ans, Lebel 20 ans ; canon de 75 24 ans ;
  électricité 24 ans. Foncer sur les fusils dès 1700 donne le Lebel vers 1780-1800, mais repousse le feu de rang, la
  levée, les divisions…
- La durée est calculée une fois, au chargement des règles (`TECH[t]['days']`) ; la fenêtre et l'IA la lisent comme
  aujourd'hui.

## Module `arbre-ecran`

- La fenêtre Technologies a **cinq onglets** (un par branche), avec la recherche en cours et sa barre en tête de chaque
  onglet. La frise des découvertes reste au-dessus.
- Dans un onglet :
  - chaque technologie est une **case** placée en colonne selon son étage dans la branche (prérequis de la même
    branche seulement), de gauche à droite ;
  - des **traits** relient chaque case à ses prérequis de la même branche ;
  - les prérequis d'une autre branche sont écrits dans la case (« ← Acier, industriel »).
- Couleurs : acquise, en cours, possible, bloquée (les classes actuelles `done`, `running`, `locked`).
- Toucher une case ouvre sa fiche dans l'onglet :
  - description ;
  - coût et durée ;
  - année historique, et l'avance qu'on prendrait (« historiquement 1866 : vous auriez 40 ans d'avance ») ;
  - bouton **Rechercher**.
- Grand arbre sur petit écran : défilement horizontal dans l'onglet (iPad compris). Les cases sont des boutons :
  clavier et lecteur d'écran.
- Dessin : HTML et CSS pour les cases, un SVG pour les traits ; pas de canevas, pas de bibliothèque.

## Module `moderniser`

### Ce qui s'apprend par régiment

| Manœuvre | Pour |
|---|---|
| Feu de rang, feu de peloton, ordre mixte, retranchements | infanterie (ligne, légère, grenadiers, chasseurs) |
| Voltigeurs | infanterie |
| Hussards, cuirassiers | cavalerie |
| Artillerie à cheval, obus à la mélinite | artillerie et mitrailleuses |

Le reste (levée, divisions, état-major, service militaire, Vauban, génie, aérostiers, dynamite, rail, sciences
civiles…) reste national et immédiat, comme aujourd'hui.

### Ce que veut dire « appris »

- Chaque régiment garde la liste des manœuvres qu'il a apprises (`reg['man']`), comme il garde ses armes.
- **Effets de régiment** d'une manœuvre (puissance, feu de ligne, feu du carré, élan de la charge, couvert des
  tirailleurs, retranchement, mélinite, vitesse de l'artillerie) : seulement pour les régiments qui l'ont apprise.
- **Effets d'armée ou d'État** (vision et détection des hussards, embuscades des voltigeurs, vitesse de changement de
  formation de l'ordre mixte) : pour le camp, dès la découverte, comme aujourd'hui.
- Même règle pour les **armes** : les effets de régiment d'un fusil ou d'un canon (ligne +10 % du Chassepot, couvert
  du Minié, vitesse du Gribeauval et du Valée…) ne jouent que pour les régiments qui ont cette arme ou mieux. La pluie
  (percussion) et l'embuscade (Lebel) restent nationales.
- La colonne « ordre mixte » en bataille : permise dès que le camp connaît la manœuvre ; seule la colonne d'un régiment
  qui l'a apprise a l'élan de +15 %.

### Le bouton « Moderniser » (remplace « Réarmer »)

- Mêmes lieux qu'aujourd'hui : une armée au repos dans une de vos places, hors siège, ou la garnison d'une place.
- Il dit ce qui change : « 6 régiments : Gribeauval → canons rayés ; 4 régiments : feu de peloton, ordre mixte ».
- Prix :
  - les armes, comme aujourd'hui (0,12 arme par homme ; 0,25 arme et 0,25 fer par artilleur ; −15 % d'expérience) ;
  - plus **0,1 livre par homme et par manœuvre** (30 livres pour un régiment de ligne et une manœuvre). C'est une
    valeur de départ, réglée au banc.
- Durée : **10 jours** (un tiers de tour). L'armée reste dans la place ; en tour par tour, un ordre de marche donné
  au même tour l'interrompt, donc elle y passe le tour (jamais plus). Elle se bat normalement si on l'attaque.
  (Écart du 23/10 : la spec prévoyait de lui retirer 10 jours de marche ; l'annulation au départ suffit.)
- Partir avant la fin annule l'entraînement, sans remboursement (la fenêtre de marche le dit). La place qui tombe
  l'annule aussi.
- Une armée démodée porte une marque « À moderniser » dans sa liste et son panneau.
- L'IA modernise comme elle réarme aujourd'hui : les armées les plus en retard d'abord, crochet par une place amie
  quand l'ennemi est loin.

## Fichiers touchés

| Fichier | Quoi |
|---|---|
| `game/rules.py` | `BRANCHES`, branche de chaque technologie militaire, prérequis ajoutés, durées par étage, table des manœuvres par classe, coût de l'entraînement |
| `game/engine.py` | `research` sans date ; chargement des sauvegardes ; `rearm` → `modernize` (prix, 10 jours, annulation) ; effets par régiment (`reg_power`, résolution automatique) ; manœuvres des nouveaux régiments |
| `game/army_actions.py`, `game/turns.py` | l'entraînement qui avance et finit ; la marche qui l'annule |
| `game/tactics/bridge.py`, `stats.py`, `battle.py`, `orders.py` | les effets de régiment par unité au lieu d'un dict par camp |
| `game/ai.py` | cinq branches, plus de date, modernisation à la place du réarmement |
| `game/views.py` | branches, étages, manœuvres des régiments, coût et état de « Moderniser » |
| `web/js/ui.js` | fenêtre en arbre, bouton « Moderniser », marque « À moderniser », aide |
| `web/js/decouvertes.js` | les deux branches militaires |
| `web/css` | arbre, onglets, traits |
| `README.md` | technologies, armement par époque |
| `tests/` | voir ci-dessous |

## Stratégie de test

- **Règles** :
  - aucun cycle dans les prérequis ;
  - aucun prérequis ajouté plus récent que la technologie qui le demande ;
  - chaque branche dure 190 ans à ±1 tour ;
  - chaque manœuvre de la table existe et concerne une classe de troupe.
- **Moteur** :
  - on peut chercher le Lebel en 1700 si les prérequis sont là, et pas sans eux ;
  - deux recherches militaires vont en parallèle ;
  - une sauvegarde d'avant le chantier se charge (recherche militaire déplacée, manœuvres données) ;
  - « Moderniser » coûte le bon prix, dure 10 jours, s'annule en marchant ;
  - un régiment sans « feu de rang » ne gagne pas les +12 %, l'autre si ;
  - l'IA modernise.
- **Interface** (`tests/interface.test.mjs`) : cinq onglets, une case par technologie, un trait par prérequis de même
  branche.
- **Banc d'équilibre** (`outils/simuler.py`, 1700 et 1790, 30 ans) :
  - technologies par camp et date des grandes armes, comparées à `tasks/equilibre-reference.md` ;
  - le but : à ±15 ans de l'histoire pour une IA ordinaire, et pas de camp qui s'envole.

## Limites

- Durées longues : une découverte tous les 8 à 10 ans par branche, plus rares qu'aujourd'hui en début de partie.
  C'est le prix du rythme historique.
- Un camp qui fonce peut avoir des fusils de 1886 en 1790 : les batailles le montrent déjà (armes par régiment), mais
  le décor et les noms d'époque suivent les technologies, pas toujours la logique historique.
- Les cinq onglets ne montrent pas les cinq arbres d'un coup ; les prérequis d'autres branches sont écrits, pas tracés.

## Critères de réussite

1. On peut lancer en 1700 une technologie de 1800 si ses prérequis sont acquis.
2. La fenêtre montre un arbre par branche, avec des traits ; on lit d'un coup d'œil ce qui est possible et ce qui manque.
3. L'artillerie et l'infanterie se cherchent en parallèle.
4. Après une découverte, une armée n'en profite qu'une fois modernisée ; le bouton dit quoi, combien, et finit dans le
   tour.
5. Les anciennes sauvegardes se chargent sans perte.
6. Banc : les IA restent dans ±25 % de la référence (guerres, écart, camps en vie), et leurs grandes armes arrivent à
   ±15 ans de l'histoire.
7. Tous les tests passent.

## Questions ouvertes

- Faut-il afficher, dans la fenêtre d'une armée ennemie repérée (avec la photographie), les manœuvres qu'elle a
  apprises ? Proposé : oui, à côté des armes, sans code de plus que la ligne d'affichage.

## État (24/10/2026)

- A1 à A6 construits ; A8 : README, revue faite et corrigée.
- A7 : premier banc mesuré (`tasks/equilibre-reference.md`, section « Arbre ») ; les IA trouvaient les armes un siècle
  trop tôt. Correction choisie le 24/10 : **les IA cherchent dans l'ordre historique** et finissent vers la date
  (`ai.AI_AHEAD` = 5 ans) ; le joueur, lui, peut foncer. À mesurer : `sh outils/banc_arbre.sh court`.
- Vérifications : par scripts, lancés par toi (`sh tests/resume.sh`, `sh outils/banc_arbre.sh [court]`).
