# web_conquete — Conquête : Aquitaine 1700-1899

Deux siècles de guerres, de commerce et de diplomatie dans l’ancienne Aquitaine, de Louis XIV à la IIIe République.

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

### La grande campagne et les époques
- **Quatre départs** au choix sur l'écran d'accueil :
  - **1700** : la grande campagne, jusqu'à la fin de 1899 ;
  - **1790** : la Révolution, avec les techniques connues vers 1778 (fusil 1777, système Gribeauval…) ;
  - **1813** : la fin de l'Empire, avec les technologies d'époque déjà acquises ;
  - **1870** : la guerre de 1870, avec le Chassepot, les canons rayés et la mitrailleuse.
- **Provinces puis départements** : avant le 4 mars 1790, les cinq camps sont la **Guyenne**, le **Périgord**,
  les **Landes de Gascogne**, l'**Agenais** et le **Béarn et Pays basque**. À cette date, ils deviennent les cinq départements.
- **Époques** : Grand Siècle finissant (1700), Lumières (1715), Révolution (1789), Consulat et Empire (1804), Restauration
  (1815), IIe République et Second Empire (1848), IIIe République (1870). Le passage d'une époque à l'autre est annoncé
  et met le jeu en pause.
- **Technologies datées** : 73 technologies, de la baïonnette à douille (1700) au canon de 75 (1897) ; chacune ne se
  recherche qu'une fois inventée (la machine à vapeur vers 1820, les chemins de fer vers 1841, le Chassepot vers 1866…).
- **Armement par époque** : chaque régiment garde les armes reçues à sa levée, affichées à côté de son nom.
  - Infanterie : mousquet et piques (×0,85), fusil à silex (×1), fusil 1777 (×1,10), fusil à percussion (×1,22, ne
    craint plus la pluie), fusil rayé Minié (×1,40), Chassepot (×1,70), fusil Gras (×1,82), Lebel (×2,05).
  - Artillerie : canons de bronze (×0,85), système Vallière (×0,95), Gribeauval (×1,15), Valée (×1,30), canons rayés
    La Hitte (×1,55), de Bange (×1,85), canon de 75 (×2,30).
  - Après une découverte, les nouveaux régiments reçoivent les nouvelles armes ; les anciens se **réarment** dans une
    de vos places, au repos et hors siège (bouton « Réarmer » : 0,12 arme par homme, 0,25 arme et 0,25 fer par
    artilleur ; les soldats perdent un peu d'expérience à réapprendre). La milice prend toujours les armes de son camp.
  - La cavalerie ne change pas d'armes : face aux fusils rayés, ses charges perdent peu à peu leur avantage.
- **Noms d'époque** : mousquetaires et piquiers avant la baïonnette, miquelets (fusiliers de montagne) avant les chasseurs
  basques de 1792, milice bourgeoise puis Garde nationale (1789) puis armée territoriale (1872), voltigeurs puis
  chasseurs à pied (1838), cuirassiers sous l'Empire…
- **Villes** : leur population suit une croissance séculaire. Bordeaux compte environ 80 000 habitants en 1700 et
  110 000 en 1790 ; sa population « normale » est multipliée par 1,6 en 1900. Les agrandissements s'y ajoutent.
- **Fin de partie** : au 1er janvier 1900, le camp le plus **prestigieux** l'emporte. Prendre tous les chefs-lieux
  reste une victoire anticipée.
- **Prestige** : rayonnement équilibré, pour gagner par la paix comme par la guerre. Il compte le territoire
  (et les chefs-lieux), la population (chaque ville plafonnée à 25 000 habitants), la richesse, les agrandissements et
  les remparts, les technologies, les faits d'armes, et bientôt l'histoire. Chaque 1er janvier, le rayonnement du moment
  s'ajoute à la gloire accumulée. Le classement est dans le menu « Partie ».
- **Traités plutôt qu'anéantissement** : quand un chef-lieu tombe, le vaincu signe un traité. Il cède les places
  occupées, verse un tribut, récupère son chef-lieu et doit respecter une trêve de cinq ans. Le congrès rétablit aussi
  la paix entre le vaincu et ses autres ennemis pour deux ans (les alliés eux-mêmes respectent ces trêves). Le vaincu
  n'est absorbé que s'il est déjà écrasé (un quart de ses places de départ, ou 3 places) ou si le même vainqueur le
  fait plier une seconde fois en moins de 25 ans. Cela vaut aussi pour vous : perdre son chef-lieu n'est plus la fin
  de la partie.
- **Équilibre des puissances** : qui tient plus de 40 % des places de l'Aquitaine inquiète tout le monde. Les autres
  camps s'en méfient, s'allient plus volontiers et se joignent à ses guerres. Tenir beaucoup de pays mal assimilés
  accroît la lassitude (surextension). Enfin, un pays absorbé depuis plus de dix ans peut se soulever si son ancien
  chef-lieu est mal tenu (ni garnison ni armée) : il renaît avec ses places mal assimilées et une trêve de trois ans.
- **Attachement régional** : une place prise hors de sa province d'origine produit 30 % de moins et tient moins bien
  l'ordre, le temps d'une génération (25 ans) d'assimilation. Si elle se révolte, elle retourne à son camp d'origine.
- **Lassitude de la guerre** (0 à 100 %) : chaque mois de guerre et chaque homme perdu l'augmentent, la paix la fait
  retomber. Elle dégrade l'ordre public partout et pousse les IA à signer la paix. À l'inverse, après de longues années
  de paix, les ambitions des voisins se réveillent.
- **Rythme** :
  - deux vitesses rapides pour les années de paix, **×10** et **×30** jours par seconde (touches 5 et 6) ;
  - à ces vitesses, une bataille ou une guerre qui vous concerne, une proposition de paix ou d'alliance, ou le siège
    d'une de vos places remettent le jeu en pause ;
  - une nouvelle époque ou une capitulation arrête toujours le temps.

### La carte et les camps

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

### Unités, intendance et prisonniers
- Outre la ligne, les voltigeurs, la cavalerie et l'artillerie :
  - **Grenadiers** : infanterie d'élite, déjà aguerrie, chère ; après la technologie « Fusil et baïonnette à douille ».
  - **Chasseurs basques** : infanterie légère des montagnes, redoutable en relief, s'use peu dans les cols ;
    levés seulement en Pays basque et en Béarn.
  - **Sapeurs du génie** : peu combatifs, mais ils accélèrent les sièges et jettent des ponts (plus d'attente au bac).
  - **Garde nationale** : milice bon marché, levée même dans un village ; elle ne quitte pas sa ville mais la défend
    avec ardeur (+30 %).
- **Magasin aux vivres** (150 livres, 60 bois) : les armées en campagne à moins de 30 km restent ravitaillées, en puisant
  dans vos vivres. Pris par l'ennemi, il est pillé.
- **Moral et désertions** : trésor vide (solde impayée) ou vivres épuisés, le moral chute et les soldats désertent.
  Le journal fait le compte chaque mois.
- **Prisonniers** : une victoire en ramène (davantage avec une cavalerie qui poursuit). Ils mangent des vivres ;
  on peut les **enrôler** (une partie accepte de servir, leur département s'en fâche) ou les **échanger** dans la fenêtre
  Diplomatie (homme pour homme, puis le surplus se rachète 2 livres par tête).

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
| Carré | brise les charges (−65 % de dégâts de cavalerie) et fusille les escadrons | ravagée par l'artillerie, marche lente ; très exposée pendant qu'elle se forme |
| Tirailleurs | dispersés : moins touchés par les boulets, forts à couvert | fragiles face aux cavaliers |

- **Plans de bataille** : assaut frontal, préparation d'artillerie (+40 % aux canons), débordement (la cavalerie tourne
  l'ennemi en terrain ouvert et brise son moral), tenir la position (défense acharnée), harcèlement (escarmouche,
  on décroche au bout d'un jour).
- **Carré réflexe** : même quand vous commandez vous-même, l'infanterie forme d'elle-même le carré quand les escadrons
  chargent (les vétérans plus vite que les conscrits). Désactivable dans le panneau de l'armée.
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
- **Minimum garanti** : tant qu'un département tient son chef-lieu, il produit au moins 20 livres, 16 vivres, 9 fer,
  9 bois et 8 recrues par jour, modulés par ses traits (Périgord +40 % de fer, Landes +30 % de bois, Agenais +35 % de vivres…).
  Les vivres minimum suivent les saisons. Au-delà, il faut des villages, des forges, du commerce.
- 51 technologies en quatre branches : militaire (feu de rang, feu de peloton, ordre mixte de Guibert, cuirassiers,
  artillerie à cheval, génie…), civile (gendarmerie, cadastre, poste aux chevaux, écoles centrales, caisse d'escompte…),
  industrielle (poudreries, forges au coke, pièces interchangeables, draperies, chantiers de gabares…)
  et agricole (maïs, foires agricoles, gemmage, transhumance, greniers publics, conserves d'Appert…).
- **Population et agrandissement** : chaque place a ses habitants (estimations de 1790 : Bordeaux 110 000, Bayonne
  13 000, Agen 11 000, Pau 9 000…). Sa production suit sa population. « Agrandir » la ville (3 niveaux : premiers
  faubourgs, nouveaux quartiers, grande ville ; pour un village : village agrandi, gros bourg, bourg prospère) ouvre
  de la place pour 30 % d'habitants de plus, qui viennent s'installer mois après mois si l'ordre public est bon et les
  impôts raisonnables. Un siège ou la disette vident la ville, une prise de force fait fuir une partie des habitants.
- **Spécialités** : chacune des 50 villes principales a son produit phare, qui rapporte à qui la tient
  (grands crus de Bordeaux, Sauternes et Saint-Émilion, pruneaux d'Agen, truffes de Périgueux, jambons d'Orthez,
  chocolatiers de Bayonne, résine de Mimizan, tabacs de Tonneins, sel de Salies…). Un chef-lieu en produit deux fois plus.
  Des technologies les améliorent : chais (vins), foires agricoles (terroir), gemmage (résine), draperies (manufactures),
  ports et gabares (pêche et négoce). Aux vendanges, les grands vins comptent double.
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
