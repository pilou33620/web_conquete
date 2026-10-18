# Spec : tour par tour à la Total War (tour des IA d'un coup, villes prises pendant le tour, le temps en tours)

## Objectif

Le joueur fait **tout** pendant son tour, combats compris, puis les IA jouent **le même mois** sans qu'il regarde le
mois défiler, et tout le monde passe au mois suivant en même temps (janvier = tour 1, février = tour 2…).

Ce qui existe déjà et ne change pas : un tour = un mois ; pendant le tour du joueur la date est figée et chaque ordre
s'exécute tout de suite (marche, bataille contre une armée ou une ville sans remparts, assaut ordonné) ; le tour se
termine au 1er du mois suivant, à 0 h, avec le récapitulatif du mois.

Ce qui change : le tour des IA (1, 2), les villes neutres (3, 4) et **le temps se compte en tours** partout où le
joueur le voit (5).

1. **Le tour des IA est calculé d'un coup.** « Tour suivant » ne fait plus défiler le mois en 15 s : le serveur le
   calcule aussi vite qu'il peut (environ 1,5 s sur le Raspberry), pendant que la barre du haut montre « Les IA
   jouent… » et la progression. Les pions sautent à leur nouvelle place, puis le récapitulatif du mois s'affiche.
   Le réglage du rythme (Lent, Normal, Rapide, Éclair, touches 1 à 4) disparaît.
2. **Le tour des IA ne s'arrête que si le joueur doit choisir :**
   - une bataille **où sont ses armées ou ses places** (une IA l'attaque, ou attaque une de ses villes) : arrêt, il
     choisit « jouer la bataille » ou « laisser le général », puis le tour des IA reprend tout seul ;
   - une décision qui l'attend (événement historique ou local) ;
   - la fin de la partie.

   Tout le reste (armée ennemie qui entre sur ses terres, siège ou blocus contre lui, bataille voisine entre
   d'autres camps, déclaration de guerre, proposition, nouvelle époque, traité) **n'arrête plus** le tour : c'est
   dans le récapitulatif du mois et dans le journal. Les propositions restent à traiter pendant son tour.
   Le bouton « Arrêter » disparaît (le tour des IA dure une ou deux secondes).
3. **Une ville neutre se prend pendant le tour du joueur.** Aujourd'hui, une armée qui arrive devant une ville
   neutre (même en chemin, ex. Sainte-Foy sur la route de Bergerac) lance un ralliement de 3 à 5 jours qui ne se
   termine que pendant le tour des IA : c'est le « combat qui attend la fin du tour ». Désormais, pendant le tour du
   joueur, le ralliement se fait tout de suite : la ville passe au joueur et l'armée **finit sa marche du tour** à
   cet endroit (comme une prise de ville dans Total War). Elle reprend sa route au tour suivant.
4. **Ville ennemie à remparts : inchangé**, comme Total War : le siège commence, il avance d'un mois à chaque tour
   des IA, et « Donner l'assaut » livre la bataille tout de suite. Ville ennemie sans remparts : bataille tout de
   suite (déjà le cas).

5. **Le temps se compte en tours, à l'écran et dans les règles** (1 tour = 1 mois), comme dans Empire. Plus aucune
   durée en jours n'est montrée au joueur (voir la section suivante).

### Décisions prises

- Une **décision** (événement) arrête le tour des IA : le joueur répond, puis le tour reprend tout seul.
- Ville neutre **trop forte pour se rallier** (armée moins de 3 fois plus forte que sa défense) : comme aujourd'hui,
  bataille tout de suite si elle n'a pas de remparts, siège si elle a des remparts solides (niveau 2 ou plus).
- Les **IA ne changent pas de façon de jouer**, et ne jouent pas « faction par faction ».
- Le **temps réel** (réglage avancé du menu ☰) reste disponible. Les règles en tours s'y appliquent aussi (un tour
  y est un mois du calendrier).

## Le temps en tours

Trois règles, appliquées partout :

**A. Capacité par tour (levées et constructions).** Chaque ville fait **un mois de travail par tour**, quelle que
soit la longueur du mois (février compte autant que mars). La file avance dans l'ordre, un élément après l'autre,
et s'arrête toujours pendant un siège. Le coût de chaque élément reste celui d'aujourd'hui (un régiment de 6 jours
prend un cinquième de la capacité d'un tour, un fort de 32 jours un peu plus d'un tour) : l'équilibre ne change pas.
À l'écran, chaque élément de la file dit **quand il sera prêt** : « au prochain tour », « dans 2 tours »
(« en attente » si la place est assiégée). Le coût d'un élément est montré en part de tour (« ⅕ de tour »,
« 1 tour ¼ »), pas en jours.

**B. Durées arrondies au tour.** Les autres durées deviennent un **nombre entier de tours**, arrondi au plus proche
et d'au moins 1, et se terminent **pile au début d'un tour** du joueur. Une durée de N tours laisse au joueur
N tours entiers, qu'elle commence pendant son tour ou pendant celui des IA.

| Durée | Aujourd'hui | En tours |
|---|---|---|
| Technologies | 28 à 84 j | 1 à 3 tours (les bonus de recherche réduisent toujours le temps : on en tient compte dans « prête dans N tours ») |
| Politique de ville | 18 j | 1 tour |
| Trêve après une paix | 120 j | 4 tours |
| Trêves de traité | 2, 3 ou 5 ans | 24, 36 ou 60 tours |
| Droit de passage | 365 j | 12 tours |
| Proposition reçue | 40 j | 1 tour (à traiter pendant le tour qui suit) |
| Décision d'événement | 30 j | 1 tour |
| Effets temporaires d'événements locaux | 30 à 120 j | 1 à 4 tours |
| Garde bourgeoise | 60 j, puis 180 j d'attente | 2 tours, puis 6 tours d'attente |
| Réquisition, contribution | 120 j, 90 j d'attente | 4 tours, 3 tours d'attente |
| Ralliement négocié | 2 à 5 j, puis 30 j d'attente après un refus | 1 tour, puis 1 tour d'attente |
| Grâce sur des terres fermées | 5 j | jusqu'à la fin du tour suivant (1 tour) |
| Rapport d'espion | valable 45 j, trajet de 2 à 3 j | valable 2 tours, rapport au tour suivant |

**C. Sièges : vitesse inchangée, affichage en tours.** « Brèche dans N tours » (selon l'artillerie, les sapeurs et
les remparts, d'après la vitesse actuelle) et, en blocus, « la place tient encore N tours » (vivres), arrondis au
tour supérieur. Le ralliement d'une ville neutre : immédiat pendant le tour du joueur (point 3), dans le mois pour
les IA.

**Marche des armées.** Une armée a **un tour de marche par tour** : à l'écran, une **jauge de mouvement** (pleine,
à moitié, vide) au lieu de « 12 / 30 jours ». Avant de marcher, la bulle de l'ordre de marche dit en combien de tours
l'armée arrivera (« arrivée au prochain tour », « dans 2 tours ») ; c'est une estimation (vitesse de l'armée, longueur
du chemin). La retraite d'une armée battue reste un petit repli tout de suite (une part de tour), puis plus de marche
ce tour.

**Les taux « par jour » deviennent « par tour »** : revenus, entretien, production, commerce, vivres des quartiers.

**Ce qui reste en jours ou en heures, invisible ou presque** : le pas de la simulation, la grâce d'un jour après une
bataille, l'embarquement en gabare, la durée d'une bataille (« depuis N h », sur la carte de bataille), la météo,
les délais internes des IA et des interruptions. La vitesse des armées (km/j) disparaît de l'écran, remplacée par la
jauge et l'estimation d'arrivée.

## Tech Stack

Python 3 (serveur et moteur, `game/`), JavaScript sans framework côté navigateur (`web/js/`). Aucune dépendance
ajoutée.

## Commandes

```
python3 tests/lancer.py            # tous les bancs (Python + interface), ~20 s sur le Raspberry
python3 tests/test_campagne.py     # le banc du tour par tour
node --test tests/                 # l'interface seule
./lancer.sh                        # le jeu, pour l'essayer à la main
```

## Structure (fichiers touchés)

```
game/turns.py      → tour des IA d'un coup (budget de temps par appel), arrêts réduits, rythme retiré, doc en tête ;
                     échéances en tours (début d'un tour du joueur) et conversion jours → tours, en un seul endroit
game/engine.py     → ralliement immédiat d'une ville neutre pendant le tour ; file de production à capacité par tour ;
                     technologies ; trêves ; espions
game/rules.py      → durées converties en tours (technologies, trêves, propositions, espions)
game/cities.py     → bâtiments d'emplacement, politiques, événements locaux, collèges
game/army_actions.py → garde, réquisition, contribution, ralliement négocié, terres fermées, blocus (affichage)
game/diplomacy.py, game/events.py → trêves, propositions, décisions
game/views.py      → durées envoyées au navigateur en tours (et taux par tour)
web/js/ui.js, web/js/map.js → textes en tours, jauge de mouvement, estimation d'arrivée, barre du haut
                     (« Les IA jouent… », plus de bouton Arrêter ni de rythme, touches 1–4 retirées)
web/js/tuto.js     → bulles du tutoriel qui parlent du mois qui défile ou de jours
server.py          → messages « N jours de marche employés », règles envoyées au navigateur (paces)
tests/test_campagne.py, tests/fabrique.py, tests/interface.test.mjs → bancs mis à jour
README.md          → section tour par tour
```

## Code Style

Le style du projet : français dans les noms de tests, les commentaires et les messages ; docstrings courtes qui
disent le pourquoi ; constantes en tête de module ; pas de nouvelle couche. Exemple (déjà dans `game/turns.py`) :

```python
def march_left(g, a):
    """Jours de marche qui restent à cette armée ce tour."""
    return march_days(g) if a.get('mp') is None else max(0.0, a['mp'])
```

## Stratégie de test

- `tests/test_campagne.py` (unittest, parties fabriquées par `tests/fabrique.py`) :
  - « Tour suivant » mène au 1er du mois suivant sans aucun arrêt quand rien ne concerne les armées du joueur ;
  - une bataille contre une armée ou une place du joueur arrête le tour des IA, et il reprend après le choix ;
  - une armée ennemie qui entre sur ses terres, une déclaration de guerre : pas d'arrêt, présentes dans le récap ;
  - une armée qui marche sur une ville neutre pendant le tour du joueur la prend tout de suite, la date ne bouge
    pas, et l'armée n'a plus de jours de marche ;
  - un siège devant une ville à remparts reste un siège (pas de prise immédiate), l'assaut se livre tout de suite ;
  - une file de levées : sur deux mois de longueurs différentes (février, mars), la même quantité de travail est
    faite par tour ; un élément annoncé « au prochain tour » est prêt au début du tour suivant ;
  - une durée de N tours (trêve, droit de passage, proposition) se termine pile au début du N-ième tour suivant,
    qu'elle commence pendant le tour du joueur ou pendant celui des IA ;
  - les anciennes sauvegardes (échéances en plein milieu d'un mois) se chargent et se terminent au début d'un tour.
- `tests/interface.test.mjs` : la barre du haut n'affiche plus de rythme ni « Arrêter » ; aucun texte de l'interface
  campagne ne contient plus « jour » ou « N j » (relevé des textes du panneau de ville, d'armée, technologies,
  diplomatie, événements).
- À la main sur le Raspberry : une partie, trois tours suivants, chacun en moins de 3 s.

## Boundaries

- **Toujours** : `python3 tests/lancer.py` avant chaque commit ; garder les anciennes sauvegardes lisibles (le champ
  `pace` d'une sauvegarde est ignoré, pas une erreur) ; garder le récapitulatif du mois.
- **Demander d'abord** : changer la façon de jouer des IA ; changer l'équilibre (coûts de production, vitesse des
  sièges) au-delà des arrondis du tableau ; une durée de l'inventaire qui ne rentre pas dans les règles A, B, C.
- **Jamais** : supprimer un banc qui échoue pour passer ; laisser le serveur bloqué plus d'une demi-seconde d'affilée
  (le navigateur doit continuer de recevoir l'état pendant le calcul).

## Critères de réussite

1. « Tour suivant » : le mois des IA est joué et le récapitulatif s'affiche en moins de 3 s sur le Raspberry, sans
   arrêt si rien ne concerne le joueur.
2. Une IA qui attaque une armée ou une ville du joueur arrête le tour des IA sur cette bataille ; après le choix,
   le tour des IA reprend sans clic de plus.
3. Les autres nouvelles du mois n'arrêtent plus le tour et figurent dans le récapitulatif.
4. Pendant son tour, le joueur prend une ville neutre sans attendre : elle est à lui avant « Tour suivant ».
5. Plus de réglage de rythme ni de bouton « Arrêter » dans l'interface ; les anciennes sauvegardes se chargent.
6. Aucune durée en jours n'est montrée au joueur sur la carte de campagne ; ce qui est annoncé « au prochain tour »
   ou « dans N tours » arrive bien à ce tour-là.
7. `python3 tests/lancer.py` passe.

## Questions ouvertes

Aucune. Inventaire complet des durées en jours (80 éléments, fichiers et lignes) : fait avant la spec, repris dans
le plan.

---

# Évolution du 18/10/2026 : à l'arrivée devant une ville, le joueur choisit

## Objectif

Rapport du joueur : « je scinde mon armée en trois, chaque détachement va attaquer une ville ; pendant mon tour, il ne
me propose pas de faire les batailles, à la main ou en automatique ; à la fin du tour, oui ». Cause : une ville neutre
faible rencontrée **en chemin** se rallie d'elle-même et **termine la marche du tour** (point 3 ci-dessus) ; le
détachement n'atteint sa cible qu'au tour suivant, et la bataille s'engage alors. Une place à remparts, elle, est
assiégée sans bataille (point 4).

Ce que veut le joueur : **décider lui-même, à chaque ville**. Quand une de ses armées arrive devant une ville qui
n'est pas à lui (sa cible, ou une ville rencontrée en chemin), la marche s'arrête et **une fenêtre de choix s'ouvre
toujours**, quel que soit le réglage des batailles :

| Choix | Quand il est proposé | Ce qu'il fait |
|---|---|---|
| **Commander la bataille** | toujours | assaut tout de suite, joué sur le champ de bataille (même une place à remparts : les canons y ouvrent des brèches, sinon on escalade, comme aujourd'hui) |
| **Résolution automatique** | toujours | le même assaut, réglé par le général |
| **Rallier** | ville neutre, armée au moins 3 fois plus forte que sa défense | la ville se rallie sans combat |
| **Négocier le ralliement** | ville neutre (comme aujourd'hui) | pourparlers payés, réponse au tour suivant |
| **Assiéger** / **Bloquer et affamer** | place à remparts (assiéger) ; toute place (bloquer, comme aujourd'hui) | le siège bat les murs à chaque tour des IA, l'assaut part de lui-même à la brèche ; le blocus affame |
| **Exiger une contribution** | comme aujourd'hui (une fois par place et par tour) | rançonne la place, puis la laisse |
| **Attendre devant la place** | toujours | l'armée fait halte ; les actions restent dans son panneau (comme la halte d'aujourd'hui) |

Ce qui ne change pas : les batailles contre une **armée** (contact en marche, attaque d'une IA) ; une ville d'un
voisin **en paix** (on passe, ou halte) ; une ville **déjà investie** par un autre camp, ou où une bataille se livre ;
une armée **en retraite** ; la conduite **« Traverser »** pour les villes rencontrées en chemin (traversées sans
fenêtre ; la cible, elle, demande) ; les **IA**, qui décident seules comme aujourd'hui ; la bataille d'assaut
elle-même (déploiement, brèches, escalade).

### Hypothèses (à corriger maintenant, sinon je les retiens)

1. La fenêtre s'ouvre pendant le tour du joueur, au moment où l'armée arrive : tout de suite après l'ordre, ou au
   début du tour suivant pour une marche qui reprend. Pendant le tour des IA, ses armées ne bougent pas (inchangé).
   En **temps réel** (réglage avancé), la même fenêtre s'ouvre et le temps s'arrête comme pour une bataille en attente.
2. Tant que la fenêtre attend, les autres armées du joueur peuvent recevoir des ordres, mais « Tour suivant » attend
   le choix (comme une bataille en attente aujourd'hui).
3. Deux armées arrivent devant deux villes : une fenêtre à la fois, l'une après l'autre.
4. Après « Commander la bataille » ou « Résolution automatique », la deuxième fenêtre d'aujourd'hui (« Commander /
   Automatique ») ne s'ouvre pas : le choix est déjà fait.

## Fichiers touchés

```
game/army_actions.py → arrivée devant une ville du joueur : halte et choix en attente ; les choix (assaut manuel ou
                       automatique, rallier, et les actions existantes : négocier, contribution, blocus, siège)
game/engine.py       → l'arrivée passe par ce choix pour le joueur (cible ou en chemin) ; assaut depuis la halte
game/turns.py        → un choix en attente arrête la marche et fige « Tour suivant », comme une bataille en attente
game/views.py        → le choix en attente envoyé au navigateur, avec les options permises et leur raison
server.py            → commande du choix
game/tactics/bridge.py → bataille démarrée avec son mode déjà choisi (manuel ou automatique)
web/js/ui.js         → la fenêtre de choix (comme celle des batailles), ouverte d'elle-même
tests/test_campagne.py, tests/interface.test.mjs → bancs ; README.md → section tour par tour
```

Commandes, style, structure, limites : celles de la spec ci-dessus.

## Stratégie de test

- `tests/test_campagne.py` :
  - le cas du rapport : Guyenne 1700, trois détachements sur Mérignac, Cestas et Léognan (dans les deux ordres) :
    chaque arrivée devant une ville ouvre un choix pendant le tour, y compris Villenave-d'Ornon en chemin ;
  - chaque choix fait ce qu'il dit : assaut manuel (bataille en mode manuel, sans deuxième fenêtre), assaut
    automatique (réglé sur-le-champ), rallier (ville au joueur), siège sur une place à remparts, blocus, contribution,
    attendre (halte, actions dans le panneau) ;
  - « Rallier » n'est pas proposé quand l'armée est trop faible ; « Assiéger » pas sur une ville sans remparts ;
  - réglage « toujours automatique » : la fenêtre s'ouvre quand même ;
  - conduite « Traverser » : pas de fenêtre en chemin, une fenêtre à la cible ;
  - « Tour suivant » refusé tant qu'un choix attend ; une ancienne sauvegarde se charge.
- `tests/interface.test.mjs` : la fenêtre s'ouvre d'elle-même quand l'état annonce un choix en attente, et ne montre
  que les options permises.
- À la main : la partie du rapport (Bordeaux scindée en trois).

## Limites

- **Demander d'abord :** changer la puissance des assauts ou la vitesse des sièges ; faire jouer les IA autrement.
- **Jamais :** casser une sauvegarde ; ouvrir une fenêtre pour une ville d'un voisin en paix.

## Critères de réussite

1. Pendant son tour, chaque arrivée d'une armée du joueur devant une ville qui n'est pas à lui (cible ou en chemin,
   sauf « Traverser » en chemin) ouvre la fenêtre de choix, quel que soit le réglage des batailles.
2. « Commander la bataille » ouvre le champ de bataille de l'assaut, même devant une place à remparts ; « Résolution
   automatique » règle l'assaut sur-le-champ.
3. Chaque autre choix fait ce qu'il annonce ; seuls les choix permis sont proposés, les autres sont absents.
4. Le cas du rapport (Bordeaux scindée en trois) ne laisse plus aucune bataille pour la fin du tour sans que le
   joueur l'ait choisi.
5. `python3 tests/lancer.py` passe ; les anciennes sauvegardes se chargent.

## Décisions (validées le 18/10/2026)

1. **Après un choix sans combat en chemin** (rallier, contribution, négocier) : l'armée **reprend sa route** vers sa
   cible avec la marche qui lui reste ce tour ; la fenêtre s'ouvrira à la ville suivante.
2. **Après un assaut gagné en chemin** : l'armée **s'arrête là** (une bataille finit la marche du tour) ; elle repart
   vers sa cible au tour suivant.
3. Les hypothèses 1 à 4 sont retenues.
