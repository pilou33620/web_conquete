# Spec : tutoriel interactif (campagne et bataille)

## Objectif

Apprendre à jouer à quelqu'un qui découvre le jeu (sur l'iPad comme sur le PC) sans lire le README.

- **Campagne** : une première partie guidée par quinze bulles. Chaque bulle pointe un élément de l'écran et
  **attend que le joueur fasse l'action** (choisir une armée, la faire marcher, ouvrir une ville, finir son tour…)
  avant de passer à la suivante. Les bulles qui ne font qu'informer ont un bouton « Suivant ».
- **Bataille** : les bulles existantes (`web/js/battle/interface.js`, `tips()`) restent. On y ajoute des bulles
  **déclenchées par la situation**, une seule fois chacune : la première fois que le joueur choisit un régiment de
  chaque arme (ses ordres propres), le premier régiment en déroute, le premier canon sans munitions.
- **Lancement** : automatique au début d'une **nouvelle** partie de campagne, sur un appareil qui ne l'a jamais vu
  (charger ou reprendre une partie ne le lance pas) ; chaque appareil a son propre tutoriel ; « Revoir le tutoriel » dans le
  menu ☰ le relance (et remet à zéro les bulles de bataille).
- Toujours un bouton « Passer le tutoriel » ; le tutoriel ne bloque jamais le jeu.

### Déroulé de la campagne

| # | Bulle (pointe) | Passe à la suivante quand… |
|---|---|---|
| 1 | Bienvenue : date, ressources (barre du haut) | « Suivant » |
| 2 | Touchez une de vos armées (centre la carte sur elle) | une de vos armées est sélectionnée |
| 3 | Touchez une destination, puis « Marcher par les routes » | un ordre de marche est accepté par le serveur |
| 4 | Touchez votre chef-lieu (centre la carte sur lui) | une de vos places est sélectionnée |
| 5 | La ville : emplacements, bâtiments, lever des régiments (panneau) | une construction ou une levée acceptée |
| 6 | Ouvrez les Technologies (rail) | la fenêtre Technologies est ouverte |
| 7 | Diplomatie, Commerce, Production, Journal (rail) | « Suivant » |
| 8 | Ouvrez la Production (rail) | la fenêtre Production est ouverte |
| 9 | Impôts et ordre public | « Suivant » |
| 10 | Brouillard de guerre et espions : touchez l'œil (barre de zoom) | le brouillard est basculé |
| 11 | Fleuves et gabares : embarquement par les routes, blocus en aval | « Suivant » |
| 12 | Touchez « Tour suivant » (barre du tour) | le tour des IA commence |
| 13 | Le tour des IA peut s'interrompre : touchez la raison, puis « Continuer » | le tour revient au joueur |
| 14 | Le récapitulatif du mois (fiche en haut à gauche) | « Suivant » |
| 15 | Batailles : « Commander » pour la livrer vous-même (des bulles vous guideront) | « Compris » : fin |

Une fenêtre ouverte (Technologies, décision, bataille en attente…) cache la bulle ; elle revient à la fermeture.
En temps réel (réglage avancé, sans tour), les étapes 12 à 14 sont remplacées par une bulle sur la pause et les vitesses.
Si l'élément visé n'existe pas (plus d'armée, chef-lieu perdu), la bulle s'affiche au centre avec « Suivant ».

## Tech stack

Rien de nouveau : JavaScript en modules ES sans dépendance, CSS. Aucun changement côté serveur Python.

## Commandes

```bash
python3 tests/lancer.py          # tous les bancs (Python + interface)
node --test tests/               # l'interface seule
./lancer.sh                      # jouer (http://127.0.0.1:8790)
```

## Structure

```
web/js/tuto.js            NOUVEAU : étapes de la campagne, avancement, affichage de la bulle
web/js/ui.js              appelle le tutoriel (update, select, openModal, ordres acceptés) ; menu ☰ « Revoir le tutoriel »
web/js/battle/interface.js bulles de situation (arme choisie, déroute, canon sans munitions)
web/css/style.css         style de la bulle de campagne (reprend .bt-tip : fond bleu nuit, bord laiton, flèche)
tests/interface.test.mjs  tests du tutoriel
README.md                 une ligne dans « Principe » et dans « Organisation du code »
```

## Style de code

Celui du code existant : classes et fonctions courtes, commentaires en français, textes échappés avec `esc`,
localStorage protégé par `try/catch`. Les étapes sont des données, comme `tipStep()` :

```js
// [élément visé, texte, l'étape est-elle faite ? (null : bouton « Suivant »)]
const ETAPES = [
  ['#topbar', 'Bienvenue…', null],
  [ui => armeeAMoi(ui), 'Touchez une de vos armées…', ui => ui.sel?.kind === 'army' && ui.isMine(ui.armyById(ui.sel.id)?.o)],
  …
];
```

Clés localStorage : `conquete.tuto` (`fin` une fois vu ou passé ; un tutoriel abandonné en route reprend à la prochaine partie) ; les bulles de bataille déjà vues dans
`conquete.bataille.aide.vues`.

## Tests

`tests/interface.test.mjs`, sans navigateur (`tests/dom.mjs`), avec un état fabriqué à la main :

- le tutoriel démarre à une nouvelle partie si `conquete.tuto` est absent ; pas s'il vaut `fin`, ni au chargement d'une partie ;
- sélectionner une de ses armées fait passer de l'étape 2 à l'étape 3 ; une armée ennemie, non ;
- « Passer » enregistre `fin` et cache la bulle ; « Revoir le tutoriel » remet à l'étape 1 ;
- en temps réel, pas d'étape « Tour suivant » ;
- bataille : choisir une cavalerie montre la bulle de la cavalerie une fois, pas deux.

Vérification à la main : une partie neuve sur l'iPad (Safari) et sur le PC.

## Limites

- **Toujours** : passer le tutoriel à tout moment ; textes en français, phrases courtes ; tests verts avant commit.
- **Demander d'abord** : toute modification du serveur ou des règles du jeu ; changer les bulles de bataille existantes.
- **Jamais** : bloquer une action du joueur ou mettre le jeu en pause à sa place ; ajouter une dépendance ;
  toucher aux sauvegardes.

## Critères de réussite

1. Nouvelle partie sur un appareil neuf : la bulle 1 apparaît ; en faisant les actions demandées, on arrive au bout
   sans jamais rester bloqué.
2. « Passer » ferme le tutoriel pour de bon sur cet appareil ; « Revoir le tutoriel » le relance.
3. En bataille, chaque bulle de situation s'affiche une seule fois, au bon moment, et ne cache pas le régiment choisi.
4. Fonctionne au doigt sur l'iPad (bulle lisible, boutons assez grands) et à la souris.
5. `python3 tests/lancer.py` passe.

## Décisions prises

- Déroulé : les 11 étapes proposées, plus impôts, espions et brouillard, gabares (15 bulles : la Production en a deux).
- Lancement automatique à une nouvelle partie seulement.
- Un tutoriel par appareil (localStorage), aucun changement serveur.
