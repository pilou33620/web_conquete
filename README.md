# web_conquete — Conquête : Aquitaine 1790

Première campagne : la guerre des départements de l’ancienne Aquitaine, en 1790.

Jeu de stratégie en temps réel (avec pause) sur la carte de l'ancienne Aquitaine, à l'époque des mousquets,
de la cavalerie et de l'artillerie. Le moteur tourne en Python sur un petit serveur local ; l'interface est une
page web (HTML, CSS, JavaScript) qui s'ouvre dans le navigateur.

## Lancer le jeu

Il faut seulement **Python 3.8 ou plus récent**. Aucune bibliothèque à installer.

| Système | Commande |
|---|---|
| Windows | double-clic sur `lancer.bat` (ou `python server.py`) |
| Linux, macOS | `./lancer.sh` (ou `python3 server.py`) |
| Android (Termux) | `pkg install python` puis `python server.py --no-browser`, et ouvrir `http://127.0.0.1:8790` dans Chrome |
| Raspberry Pi | `./lancer.sh` (sans navigateur, ouvert au réseau local, adresse affichée), ou `sh raspberry/installer.sh` pour un démarrage automatique à l'allumage (voir plus bas) |
| iPad (Pyto) | exécuter `server.py`, puis ouvrir `http://127.0.0.1:8790` dans Safari |

Options : `--lan` (ouvre le jeu aux autres appareils du réseau local), `--local` (cette machine seulement),
`--port 8790`, `--no-browser`, `--browser`. Sous Windows, `lancer-reseau.bat` lance directement le jeu en mode réseau.

**Sur un Raspberry Pi (ou tout Linux sans écran)**, le serveur le détecte tout seul : il ne lance pas de navigateur,
s'ouvre au réseau local et affiche en grand les adresses à taper depuis l'iPad, un téléphone ou un PC de la maison :

```
   Pour jouer depuis l'iPad, un téléphone ou un PC du réseau local,
   ouvrez le navigateur à l'une de ces adresses :

      http://192.168.1.42:8790
      http://raspberrypi.local:8790
```

Ces adresses sont aussi écrites dans `adresse-reseau.txt` (à côté de `server.py`), réaffichées si le Wi-Fi change
d'adresse, et visibles dans le jeu (écran d'accueil et menu ☰, rubrique « Jouer depuis un autre appareil »).

## Jouer sur l'iPad avec le jeu installé sur un Raspberry Pi

Le Raspberry fait tourner la partie, l'iPad sert d'écran tactile. Les deux doivent être sur le même Wi-Fi.

1. Récupérez le jeu sur le Raspberry : `git clone https://github.com/pilou33620/web_conquete.git`
   (dépôt privé : utilisez une clé SSH ou un jeton d'accès GitHub), ou copiez le dossier par clé USB ou `scp`.
   Mise à jour plus tard : `cd web_conquete && git pull && sudo systemctl restart web_conquete`.
2. Sur le Raspberry : `cd web_conquete && sh raspberry/installer.sh`
   Le script crée le service `web_conquete` (systemd) : le jeu démarre à chaque allumage et redémarre s'il plante.
   Il affiche l'adresse à taper sur l'iPad, par exemple `http://192.168.1.42:8790` ou `http://raspberrypi.local:8790`.
   Autre port : `sh raspberry/installer.sh 8800`. Désinstaller : `sh raspberry/installer.sh --retirer`.
3. Sur l'iPad, ouvrez cette adresse dans Safari, puis bouton Partager, « Sur l'écran d'accueil ».
   Le jeu s'ouvre alors en plein écran avec son icône, comme une application.

À savoir :
- Python 3.8+ suffit (déjà présent sur Raspberry Pi OS). Le Raspberry ne fait que la simulation ; le dessin de la carte
  se fait sur l'iPad.
- Il n'y a qu'une partie à la fois par serveur : l'ordinateur et l'iPad qui se connectent au même Raspberry
  voient et commandent la même partie. On peut donc commencer sur l'ordinateur et continuer sur l'iPad.
- Les sauvegardes sont stockées sur le Raspberry, dans `saves/`.
- Le jeu n'a pas de mot de passe : gardez-le sur le réseau de la maison, ne l'ouvrez pas sur Internet.
- Si l'adresse `.local` ne répond pas, utilisez l'adresse IP : elle est dans `adresse-reseau.txt`,
  dans `journalctl -u web_conquete` ou via `hostname -I` sur le Raspberry.
- La partie est **sauvegardée automatiquement** chaque mois de jeu ; après une coupure de courant ou un redémarrage,
  le Raspberry la reprend telle quelle (en pause).
- Commandes utiles : `sudo systemctl status web_conquete`, `sudo systemctl restart web_conquete`,
  `journalctl -u web_conquete -f`.

Au premier lancement, la carte est calculée (3 à 4 secondes sur un PC, 15 à 30 secondes sur un Raspberry Pi),
puis mise en cache dans `game/data/map_cache.json` (fichier ignoré par git).

## Principe

- Cinq départements créés en mars 1790 : **Gironde** (Bordeaux), **Dordogne** (Périgueux), **Landes** (Mont-de-Marsan),
  **Lot-et-Garonne** (Agen) et **Basses-Pyrénées** (Pau, l'actuel département des Pyrénées-Atlantiques).
  Vous en choisissez un, les quatre autres sont tenus par des IA qui peuvent devenir vos alliées ou vos ennemies.
- Chaque département compte son chef-lieu, 9 autres villes principales et 33 villages, soit 223 lieux avec les 8 places fortes.
  Les villes sont les plus peuplées aujourd'hui (hors banlieues collées au chef-lieu), les villages sont de vraies communes
  réparties sur tout le territoire (Saint-Émilion, Margaux, Sare, Saint-Palais, Pontenx-les-Forges…).
- Vous commencez avec votre chef-lieu et vos 9 villes. Les 165 villages et les places fortes sont indépendants :
  ralliez-les avec une armée nettement plus forte que leur milice pour gagner des revenus.
- **Victoire** : tous les chefs-lieux vous appartiennent, ou appartiennent à un département qui s'est soumis à vous.
  **Défaite** : votre chef-lieu tombe. Un département qui perd son chef-lieu capitule et ses villes passent au vainqueur.

### Armées et terrain
- Infanterie de ligne, infanterie légère (voltigeurs), cavalerie, artillerie. Chaque régiment a ses effectifs, son moral et son expérience.
- **Par les routes** : environ 21 km par jour au printemps (infanterie), les routes royales encore plus. Les grands fleuves
  se franchissent au bac (environ un tiers de journée d'attente, le double en crue) jusqu'à la technologie « Ponts de pierre ».
- **À travers champs** : l'armée choisit son chemin selon le relief. Dans un bois, une lande, un marais ou en montagne,
  elle peut se cacher et tendre une **embuscade** (gros bonus à l'attaque, moral ennemi brisé). En contrepartie :
  marche lente, usure (fièvres des marais, froid des cols), ravitaillement qui s'épuise loin de votre territoire.
- Terrain du combat : la cavalerie charge en plaine mais s'enlise en forêt ; l'artillerie domine en terrain dégagé ;
  la défense profite des collines et des montagnes ; traverser une rivière affaiblit l'attaquant.
- Places fortes : elles se prennent par **siège**. L'artillerie ouvre la brèche bien plus vite. On peut donner l'assaut avant.

### Fortifications
Chaque place a un niveau de fortification, dessiné sur la carte autour de la ville :

| Niveau | Ouvrage | Entretien |
|---|---|---|
| 1 | Mur d'enceinte flanqué de tours | 0,3 livre par jour |
| 2 | Remparts épais | 0,7 livre par jour |
| 3 | Remparts bastionnés (pointes de flèche) | 1,2 livre par jour |
| 4 | Bastions à la Vauban, avec demi-lunes | 2 livres par jour |

- Chaque niveau donne +40 de milice, +35 % de puissance aux défenseurs, les abrite derrière les murs et allonge le siège.
  Une ville tenue par un département et fortifiée (niveau 1 ou plus) ne se prend que par siège.
- On monte d'un niveau dans le panneau de la ville (« Aménagements »). Le niveau 4 n'existe que dans les chefs-lieux
  et les places fortes, après la technologie « Fortifications à la Vauban » (650 livres, 180 bois, 90 fer, 70 jours).
- Pendant un siège, la brèche s'ouvre dans l'enceinte dessinée à mesure que l'artillerie travaille.
- Une place prise par la force perd un niveau (remparts éventrés). Si le trésor est vide, faute d'entretien,
  les remparts les plus hauts se délabrent d'un niveau chaque mois. Le sabotage d'un espion retire aussi un niveau.

### Généraux, formations et plans de bataille
- Chaque armée est menée par un **général** (colonel, puis général de brigade et de division après des victoires)
  doté d'un trait : audacieux, prudent, cavalier, artilleur, montagnard, éclaireur, inspirant ou logisticien.
  Un général peut tomber au combat. Chaque département a son trait de prédilection (artilleurs du Périgord, éclaireurs landais…).
- Une bataille se déroule en trois **phases** : la **canonnade** (l'artillerie domine), la **fusillade** (la ligne et
  les voltigeurs), puis la **charge** (cavalerie et colonnes). Une armée surtout montée charge plus tôt.
- **Formations** de l'infanterie, visibles sur la carte :

| Formation | Force | Faiblesse |
|---|---|---|
| Ligne | feu nourri (+20 % en fusillade) | prise de flanc par la cavalerie |
| Colonne | choc à la charge (+25 %), marche +10 % | cible facile pour les canons |
| Carré | brise les charges (−65 % de dégâts de cavalerie) et fusille les escadrons | ravagée par l'artillerie, marche lente |
| Tirailleurs | dispersés : moins touchés par les boulets, forts à couvert | fragiles face aux cavaliers |

- **Plans de bataille** : assaut frontal, préparation d'artillerie (+40 % aux canons), débordement (la cavalerie tourne
  l'ennemi en terrain ouvert et brise son moral), tenir la position (défense acharnée), harcèlement (escarmouche,
  on décroche au bout d'un jour).
- Par défaut, **le général décide** : il choisit selon les armes de l'ennemi et change de formation à chaque phase
  (au prix d'un court moment de désordre). Vous pouvez aussi tout commander vous-même, y compris en pleine bataille.
- Bouton « Détacher la cavalerie / l'artillerie / l'infanterie » : une arme entière forme sa propre armée,
  par exemple pour envoyer la cavalerie en reconnaissance ou déborder par un autre chemin.

### Fleuves, gabares et blocus
- La Garonne et l'estuaire de la Gironde, la Dordogne, l'Isle, le Lot, la Baïse, la Midouze et l'Adour sont
  **navigables**, et un cabotage relie l'estuaire, le bassin d'Arcachon, Capbreton, Bayonne, Biarritz,
  Saint-Jean-de-Luz et Hendaye. Les quais sont marqués d'une ancre.
- En marche « routes et fleuves », l'armée **embarque toute seule** quand c'est plus rapide : environ 30 km par jour,
  plus vite en descendant le courant, moins vite en remontant ; basses eaux en été, crues au printemps,
  les tempêtes clouent les navires au port. L'artillerie, lente sur les routes, y gagne beaucoup.
- Arriver par le fleuve sur une place ennemie, c'est un **débarquement** : l'attaque est affaiblie au début.
- Des **canons ennemis sur la berge** (armée ou place forte riveraine, comme Blaye ou Fort Médoc) tirent sur les gabares qui passent.
- **Blocus** : si une place en aval, sur la route de la mer, est tenue par un ennemi, le commerce du port ou du quai
  tombe à 35 %. Tenir Blaye étrangle Bordeaux ; tenir Bordeaux étrangle l'Agenais et le Bergeracois.

### Brouillard de guerre et espions
- Vous ne voyez que ce que voient vos villes, vos armées, vos alliés et vos espions : le reste de la carte est assombri
  (bouton œil pour l'afficher ou le masquer). Les armées ennemies hors de vue n'apparaissent pas.
- Depuis une place étrangère : **Espionner** (60 livres, 2 jours) révèle sa garnison et les armées alentour pendant 45 jours ;
  **Saboter** (150 livres, 3 jours, en guerre) fait perdre un niveau de remparts. Un agent démasqué fâche le département visé.
  Les IA sabotent aussi les places que leurs armées convoitent.

### Impôts et ordre public
- Les impôts (fenêtre Production) vont de « très légers » (60 % des livres, recrues +15 %, pacification rapide des
  conquêtes) à « écrasants » (140 % des livres tout de suite).
- Au-delà d'impôts normaux, l'**ordre public** baisse lentement, et la production de chaque place suit son ordre public :
  pressurer le pays rapporte sur quelques semaines, puis coûte. Famine et banqueroute l'abaissent aussi.
- Une place agitée sans garnison ni armée peut **se révolter** et redevenir indépendante. Un régiment en garnison calme la population.

### Saisons et météo
- Récoltes faibles en hiver, abondantes en été et en automne ; vendanges en septembre et octobre.
- Trois zones météo (côte, intérieur, Pyrénées) : pluie et orage mouillent la poudre, la neige ferme les cols,
  le brouillard cache les armées, la canicule épuise les colonnes. Crues de printemps sur la Garonne et la Dordogne.

### Économie, technologies, diplomatie
- Ressources : livres, vivres, fer, bois, armes, outils, recrues. Les ateliers transforment fer et bois en **armes**
  (pour lever les régiments) ou en **outils** (jusqu'à +30 % sur toute la production, +45 % avec la technologie).
- **Minimum garanti** : tant qu'un département tient son chef-lieu, il produit au moins 20 livres, 16 vivres, 6 fer,
  6 bois et 8 recrues par jour, modulés par ses traits (Périgord +40 % de fer, Landes +30 % de bois, Agenais +35 % de vivres…).
  Les vivres minimum suivent les saisons. Au-delà, il faut des villages, des forges, du commerce.
- 28 technologies en quatre branches : militaire, civile, industrielle, agricole.
- Chaque département a ses avantages et inconvénients (négoce bordelais, forges du Périgord, échassiers landais,
  grenier agenais, montagnards basques et béarnais).
- Diplomatie : guerre, paix (avec tribut), alliance, accord commercial, présents, échanges de ressources, exigence de soumission.
- Marché des négociants : meilleurs prix si vous tenez un port.

## Commandes (souris, doigt ou stylet)

| Geste | Effet |
|---|---|
| Glisser sur la carte | La déplacer (elle garde son élan au doigt) |
| Pincer, molette, boutons + et − | Zoomer (les boutons servent au stylet, qui ne peut pas pincer) |
| Double appui | Zoom avant à cet endroit |
| Appui à deux doigts | Zoom arrière |
| Appui court | Sélectionner une ville, une armée ou une bataille |
| Appui court ailleurs, armée sélectionnée | Bulle d'ordre : par les routes ou à travers champs |
| **Glisser depuis une de vos armées** | **Dessiner son itinéraire**, puis « Suivre mon tracé » (idéal au stylet pour passer par un bois et tendre une embuscade) |
| Appui long, ou clic droit, armée sélectionnée | L'armée part aussitôt vers ce point |
| Appui long sur une ville ou une armée | La sélectionner et centrer la carte |
| Survol au stylet ou à la souris | Petite fiche : propriétaire, défenseurs, effectifs |
| Appui sur une ressource en haut | Détail de la production et du minimum garanti |
| Bouton viseur | Recentrer sur la sélection ou sur votre chef-lieu |
| Bouton œil | Afficher ou masquer le brouillard de guerre |

Pendant l'usage d'un stylet (Apple Pencil, stylet Android ou Windows), la paume posée sur l'écran est ignorée.
Sur grand écran tactile, les boutons et les cases sont agrandis automatiquement.
Clavier : espace pour la pause, 1 à 4 pour la vitesse, Échap pour annuler, + et − pour zoomer.

## Organisation du code
```
server.py            serveur HTTP local + boucle temps réel (10 pas par seconde)
game/geo.py          carte : projection, grilles de terrain, réseau routier, recherche de chemin A*
game/places.py       les 223 villes, villages et places fortes, routes royales
raspberry/           installation en service sur Raspberry Pi
game/rules.py        départements, unités, technologies, généraux, formations, météo
game/engine.py       simulation : économie, impôts, armées, gabares, combats par phases, sièges, espions
game/waterways.py    voies navigables (fleuves, estuaire, cabotage) et blocus
game/ai.py           IA des départements
game/diplomacy.py    diplomatie et commerce
game/views.py        état envoyé au navigateur (brouillard de guerre), sauvegardes
web/                 interface : index.html, css/style.css, js/map.js (rendu canvas), js/ui.js, js/main.js
saves/               parties sauvegardées (JSON)
```

## Sources des données
Contours des départements et des communes : [france-geojson](https://github.com/gregoiredavid/france-geojson) (données IGN, Licence Ouverte).
Population des communes : INSEE via [@etalab/decoupage-administratif](https://github.com/etalab/decoupage-administratif).
Fleuves et lacs : [Natural Earth](https://www.naturalearthdata.com/) (domaine public), complétés à la main pour l'Isle, la Vézère,
la Dronne, les gaves, la Midouze, la Leyre, la Nive et l'estuaire de la Gironde.
