# web_conquete — Conquête : Aquitaine 1700-1899

Deux siècles de guerres, de commerce et de diplomatie dans l’ancienne Aquitaine, de Louis XIV à la IIIe République.

Jeu de stratégie au tour par tour, mois par mois, sur la carte de l'ancienne Aquitaine, à l'époque des mousquets,
de la cavalerie et de l'artillerie : vous donnez vos ordres, puis le mois se joue sous vos yeux.
Le temps réel avec pause d'origine reste disponible en réglage avancé. Le moteur tourne en Python sur un petit serveur local ; l'interface est une
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
`--port 8790`, `--no-browser`, `--browser`, `--no-update`. Sous Windows, `lancer-reseau.bat` lance directement le jeu en mode réseau.

**Mise à jour automatique.** Si le jeu a été installé avec `git clone`, le serveur cherche une nouvelle version sur GitHub
à chaque démarrage : il l'installe (avance rapide seulement, sauvegardes intactes), affiche les nouveautés et se relance
tout seul. Sans Internet, ou si la clé SSH / le jeton manque, il démarre simplement avec la version actuelle (aucune invite
de mot de passe ne bloque le démarrage). Sur un Raspberry Pi, il patiente jusqu'à 40 secondes que le Wi-Fi arrive.
Si des fichiers ont été modifiés à la main, la mise à jour est mise de côté et la console explique quoi faire.
L'écran d'accueil indique la version et le résultat de la vérification ; une page restée ouverte sur l'iPad se recharge
d'elle-même quand le serveur a changé de version. `--no-update` désactive la vérification.

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
   Les mises à jour s'installent ensuite toutes seules à chaque démarrage du Raspberry (ou avec
   `sudo systemctl restart web_conquete`).
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
- La partie est **sauvegardée automatiquement** au début de chaque mois de jeu (donc au début de chaque tour) ; après
  une coupure de courant ou un redémarrage, le Raspberry la reprend telle quelle (en pause).
- Le tour des IA se calcule d'un coup : environ 1 seconde sur un Raspberry Pi en début de partie, 2,5 secondes après
  un an et demi de guerres (une cinquantaine d'armées).
- Commandes utiles : `sudo systemctl status web_conquete`, `sudo systemctl restart web_conquete`,
  `journalctl -u web_conquete -f`.

Au premier lancement (et après une mise à jour du calcul de la carte, `game/geo.py`), la carte est calculée
(3 à 4 secondes sur un PC, 15 à 30 secondes sur un Raspberry Pi),
puis mise en cache dans `game/data/map_cache.json` (fichier ignoré par git).

## Principe

### Tour par tour, mois par mois
Chaque tour est un mois, à la manière de Civilization ou d'Empire : Total War, en deux temps :

1. **Votre tour** : la date ne bouge pas et chaque ordre s'exécute tout de suite. Une armée qui reçoit un ordre de
   marche part aussitôt, sous vos yeux, jusqu'au bout de sa marche du tour ou jusqu'à l'ennemi (une route plus longue
   reprend d'elle-même au tour suivant ; la bulle de l'ordre annonce l'arrivée). Une bataille contre une armée se
   livre sur-le-champ ; achats, constructions et recherches sont payés tout de suite.
   **Devant une ville qui n'est pas à vous** (sa destination, ou une ville sur sa route), l'armée s'arrête et une
   fenêtre vous demande quoi faire, quel que soit le réglage des batailles : **donner vos ordres** ou la
   **résolution automatique** (l'assaut tout de suite, même contre des remparts : vos canons y ouvrent des brèches),
   **rallier** (ville neutre, armée au moins trois fois plus forte que sa défense), **négocier** le ralliement,
   **assiéger** (place à remparts : l'assaut part de lui-même à la brèche, pendant le tour des IA), **bloquer et
   affamer**, **exiger une contribution**, ou **attendre** devant la place (« Rallier ou attaquer », dans le panneau
   de l'armée, rouvre la fenêtre). Après « Rallier » ou une contribution, l'armée reprend sa route avec la marche qui
   lui reste ; après des pourparlers, un blocus ou un siège, elle reste devant la place ; après un assaut gagné, elle
   repart vers sa cible au tour suivant. « Tour suivant » attend votre choix. En conduite « Traverser », elle passe
   les villes neutres de sa route sans s'arrêter ; une place ennemie sur sa route, comme sa destination, demande.
2. **Le tour des IA** : touchez **« Tour suivant »** en haut de l'écran (ou la barre d'espace). Le mois est calculé
   d'un coup, en une ou deux secondes : les IA marchent, négocient et se battent, travaux et sièges avancent, les revenus
   tombent. Vos armées, qui ont déjà joué, restent en place. Tout le monde passe au **1er du mois suivant** en même
   temps, et c'est de nouveau à vous, avec le récapitulatif du mois.

- **Le tour des IA ne s'arrête que si vous devez choisir**, comme dans Total War :
  - une IA attaque une de vos armées ou une de vos places : jouez la bataille ou laissez-la au général ;
  - une décision vous attend (événement historique ou local) ;
  - la partie est finie.

  Votre choix fait, le tour des IA reprend tout seul. Le reste (armées ennemies sur vos terres, sièges, guerres
  déclarées, propositions, nouvelle époque, traités) est dans le récapitulatif du mois.
- **Le temps se compte en tours** (un tour = un mois) :
  - **Production** : chaque ville fait un tour de travail par tour (février comme mars), sa file avance dans l'ordre ;
    le panneau dit quand chaque élément sera prêt (« au prochain tour », « dans 2 tours ») et le coût de chaque levée
    en part de tour (« ⅕ de tour » : cinq régiments de ligne par tour).
  - **Durées arrondies au tour**, qui finissent au début d'un de vos tours : technologies 1 à 3 tours, politique de
    ville 1 tour, trêve après une paix 4 tours (traités : 2 à 5 ans), droit de passage 12 tours, proposition et
    décision : à traiter pendant le tour qui suit, garde bourgeoise 2 tours, rapport d'espion au tour suivant (valable
    deux tours), ralliement négocié au tour suivant.
  - **Sièges** : « brèche dans N tours », « vivres pour N tours » en blocus.
  - **Marche** : une jauge de mouvement par armée et l'arrivée estimée ; revenus, entretien et commerce par tour.
- **Tutoriel** : à la première nouvelle partie sur un appareil, des bulles guident les premiers pas et attendent que
  vous fassiez l'action demandée (choisir une armée, la faire marcher, ouvrir votre chef-lieu, finir votre tour…).
  « Passer » le ferme ; menu ☰, « Revoir le tutoriel » le relance. En bataille, une bulle explique chaque arme la
  première fois que vous la choisissez, et la première déroute ou le premier canon sans munitions.
- **Récapitulatif du mois** : au début de chaque tour, une fiche discrète en haut à gauche résume le mois écoulé :
  revenus nets de chaque ressource, batailles (victoires et défaites), places prises et perdues, constructions
  terminées, régiments levés, découvertes et faits marquants (guerres, paix, traités, révoltes, nouvelle époque). Chaque
  ligne centre la carte au bon endroit ; « Tout voir » déplie la liste, la croix la referme.
- **Un seul joueur, plusieurs écrans** : l'iPad et le PC ouverts sur le même serveur voient et commandent le même tour.
  « Tour suivant » touché sur l'un lance le tour des IA sur les deux.
- **Sauvegardes** : on peut sauvegarder et recharger en plein mois (la partie reprend en pause, même échéance, même
  récapitulatif en cours). Les anciennes sauvegardes se chargent au tour par tour, en attente des ordres.
- **Temps réel** : menu ☰, rubrique « Rythme du jeu », « Jouer en temps réel (avec pause) » rend les boutons de vitesse
  d'origine (pause, ×½ à ×30 jours par seconde) ; « Revenir au tour par tour » fait l'inverse. Les nouvelles parties
  commencent au tour par tour.

### La grande campagne et les époques
- **Quatre départs** au choix sur l'écran d'accueil :
  - **1700** : la grande campagne, jusqu'à la fin de 1899 ;
  - **1790** : la Révolution, avec les techniques connues vers 1778 (fusil 1777, système Gribeauval…) ;
  - **1813** : la fin de l'Empire, avec les technologies d'époque déjà acquises ;
  - **1870** : la guerre de 1870, avec le Chassepot, les canons rayés, la mitrailleuse, et les voies ferrées déjà
    ouvertes (Bordeaux–Bayonne, Bordeaux–Sète, Paris–Bordeaux… : 30 tronçons ouverts avant 1870).
- **La carte de l'accueil suit le départ choisi** : un bouton 1700, 1790, 1813 ou 1870 montre aussitôt le paysage de
  l'année (tours Chappe, poteaux télégraphiques, usines, forêt de pins des Landes, voies ferrées et leurs trains,
  drapeaux, style de carte d'époque si l'option est prise) et ce qui est déjà acquis (nombre de technologies, les plus
  visibles, tronçons de voie ferrée ouverts).
- **Provinces puis départements** : avant le 4 mars 1790, les cinq camps sont la **Guyenne**, le **Périgord**,
  les **Landes de Gascogne**, l'**Agenais** et le **Béarn et Pays basque**. À cette date, ils deviennent les cinq départements.
- **Époques** : Grand Siècle finissant (1700), Lumières (1715), Révolution (1789), Consulat et Empire (1804), Restauration
  (1815), IIe République et Second Empire (1848), IIIe République (1870). Le passage d'une époque à l'autre est annoncé
  et met le jeu en pause.
- **Technologies datées** : 94 technologies, de la baïonnette à douille (1700) au canon de 75 (1897) ; chacune ne se
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
- **Population sur deux siècles** : chaque place suit sa propre trajectoire, tirée de l'histoire.
  - Bordeaux passe d'environ 45 000 âmes en 1700 à 110 000 en 1790, retombe sous la Révolution et le blocus, puis
    dépasse 250 000 en 1900 avec les chemins de fer et les usines.
  - Les villes grandissent surtout après 1830-1850 : Périgueux et les ateliers du chemin de fer d'Orléans, Pau ville
    d'hiver des Anglais, Dax et ses curistes, Biarritz station impériale dès 1854, Arcachon (rattachée à La Teste)
    qui sort des dunes après 1857. Saint-Jean-de-Luz, grand port baleinier vers 1700, décline après le traité
    d'Utrecht.
  - Les campagnes se remplissent jusque vers 1850 puis se vident : exode rural en Dordogne et dans l'Agenais,
    émigration béarnaise et basque vers les Amériques, phylloxéra dans le vignoble girondin. Seule la lande plantée
    de pins après la loi de 1857 continue de croître.
  - La guerre pèse : une ville prise de force est pillée (6 à 15 % de ses habitants, selon les remparts qui ont
    résisté), un siège qui s'éternise la vide de plus en plus vite, le désordre fait partir les habitants. Une partie
    des fuyards gagne les places sûres de leur camp.
  - Le panneau d'une ville indique la tendance et sa raison ; la fenêtre Production donne l'évolution de vos terres
    sur l'année, villes et campagnes à part.
- **Fin de partie** : au 1er janvier 1900, le camp le plus **prestigieux** l'emporte. Prendre tous les chefs-lieux
  reste une victoire anticipée.
- **Prestige** : rayonnement équilibré, pour gagner par la paix comme par la guerre. Il compte le territoire
  (et les chefs-lieux), la population (chaque ville plafonnée à 25 000 habitants), la richesse, les agrandissements et
  les remparts, les technologies, les faits d'armes et l'histoire (vos choix lors des grands événements). Chaque 1er janvier, le rayonnement du moment
  s'ajoute à la gloire accumulée. Le classement est dans le menu « Partie ».
- **Événements historiques** : une trentaine de dates de l'histoire de France et du Sud-Ouest vous demandent un choix,
  et le jeu se met en pause. On y trouve la guerre de Succession d'Espagne (1701), le Grand Hiver (1709), la
  banqueroute de Law, l'intendant Tourny à Bordeaux, les fors du Béarn, la guerre de Sept Ans, la guerre des
  farines, les cahiers de doléances et la Grande Peur, la chute des Girondins, la levée en masse, le sacre, le Blocus
  continental, le 12 mars 1814, les Cent-Jours, le choléra, le train de La Teste, 1848, Biarritz impériale, le
  classement de 1855, la loi des Landes de 1857, 1870 et le gouvernement à Bordeaux, la Commune, le phylloxéra,
  l'Exposition de 1889 et l'affaire Dreyfus.
  - Chaque option affiche ses effets : ressources, ordre public, lassitude, population, régiments offerts, effets
    temporaires ou durables, et points d'**histoire** qui comptent dans le prestige.
  - Les IA choisissent elles aussi. Sans réponse avant la fin du tour suivant, la dernière option, la plus prudente,
    s'applique.
  - Les effets en cours sont rappelés dans la fenêtre Production, et le journal a un onglet « Histoire ».
- **Imprévus** : tous les 8 à 18 mois environ, chaque camp connaît un événement aléatoire : récolte magnifique,
  épizootie, legs d'un négociant, filon de fer, savant à pensionner, contrebandiers. Certains demandent une décision.
  Incendies, fièvres, brigands et foires touchent désormais une seule ville (voir « Villes »).
- **Traités plutôt qu'anéantissement** : quand un chef-lieu tombe, le vaincu signe un traité. Il cède les places
  occupées, verse un tribut, récupère son chef-lieu et doit respecter une trêve de cinq ans. Le congrès rétablit aussi
  la paix entre le vaincu et ses autres ennemis pour deux ans (les alliés eux-mêmes respectent ces trêves). Le vaincu
  n'est absorbé que s'il est déjà écrasé (un quart de ses places de départ, ou 3 places) ou si le même vainqueur le
  fait plier une seconde fois en moins de 25 ans. Cela vaut aussi pour vous : perdre son chef-lieu n'est plus la fin
  de la partie.
- **IA** : elles ne thésaurisent plus. Au-delà d'un trésor de guerre (une quarantaine de jours de revenu), elles
  allègent leurs impôts, agrandissent leurs villes, fortifient leurs frontières, cherchent dans toutes les branches,
  vendent leurs surplus d'armes et d'outils et font des présents aux voisins redoutés. En guerre, elles puisent dans
  ce trésor pour lever des troupes. Elles généralisent aussi un nouvel armement en quelques jours : réarmement des
  régiments les plus en retard d'abord, achat au marché du fer et des armes qui manquent, grandes armées réarmées par
  fournées, crochet par la place amie la plus proche quand l'ennemi est loin.
- **Équilibre des puissances** : qui tient plus de 40 % des places de l'Aquitaine inquiète tout le monde. Les autres
  camps s'en méfient, s'allient plus volontiers et se joignent à ses guerres. Tenir beaucoup de pays mal assimilés
  accroît la lassitude (surextension). Enfin, un pays absorbé depuis plus de dix ans peut se soulever si son ancien
  chef-lieu est mal tenu (ni garnison ni armée) : il renaît avec ses places mal assimilées et une trêve de trois ans.
- **Attachement régional** : une place prise hors de sa province d'origine produit 30 % de moins et tient moins bien
  l'ordre, le temps d'une génération (25 ans) d'assimilation. Si elle se révolte, elle retourne à son camp d'origine.
- **Lassitude de la guerre** (0 à 100 %) : chaque mois de guerre et chaque homme perdu (bataille gagnée, perdue ou
  rompue par un décrochage) l'augmentent, la paix la fait retomber. Elle dégrade l'ordre public partout et pousse les IA à signer la paix. À l'inverse, après de longues années
  de paix, les ambitions des voisins se réveillent.
- **Rythme en temps réel** (réglage avancé, voir « Tour par tour ») :
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
- La carte prend l'allure de celle d'Ultimate General : herbe olive et dorée, relief ombré, futaies denses de
  houppiers ronds, mer turquoise et rivage à la tranche brune, fleuves vert-de-gris, chemins de terre claire. L'hiver
  la couvre de givre (et de neige en montagne), l'automne roussit les prés. Villes et forts portent leur nom sur une plaque
  d'ardoise au liseré du camp, les eaux ont leur nom gravé, les armées une plaque et un fanion. L'interface est en
  ardoise, comme celle des batailles ; les régiments d'une armée y paraissent en **cartes portrait** (la figure de
  leur arme à l'uniforme de l'époque, effectif, expérience, effectif et moral en barres ; un appui les coche pour
  scinder l'armée), et sur un grand écran la date se lit en bas à droite. Le général d'une armée y paraît en
  **médaillon** : un portrait peint par le jeu, au visage tiré de son nom, coiffé selon l'époque (tricorne et perruque
  poudrée, puis bicorne à cocarde, puis képi). De près, les régiments sont de **petites figurines debout** en rangs,
  à l'uniforme de l'époque, comme les armées d'Ultimate General.
- **La carte change avec les siècles**, camp par camp, selon ses technologies : tours Chappe aux bras mobiles, puis
  poteaux télégraphiques le long des routes royales ; cheminées d'usine qui fument, lueur des forges ; vapeurs à roues
  sur les fleuves ; la forêt de pins gagne la lande, les marais drainés s'assèchent, le phylloxéra roussit les vignes
  jusqu'aux plants greffés, le maïs pousse en Chalosse et en Béarn. Le drapeau des clochers suit l'époque (blanc du
  roi, tricolore, blanc de la Restauration), bordé de la couleur du maître de la place, et les passants changent de
  chapeau (tricorne, bicorne, haut-de-forme).
- **Chaque découverte a sa mise en scène** : si elle se voit sur la carte, la caméra va à votre chef-lieu et un éclat
  d'or s'y ouvre ; puis une fenêtre à ruban rouge présente la technologie, sa date et ce qu'elle change, avec une
  vignette animée (une locomotive qui passe, un canon qui tire, des épis au vent, une tour Chappe qui bat des bras…).
  Le panneau des technologies s'ouvre sur la frise de vos découvertes. Celles des autres camps qui se voient (rail,
  télégraphe, usines, pins…) sont annoncées par un bandeau et un éclat sur leur chef-lieu.
- **Maquette de la vue inclinée** (comme Ultimate General) : la page `/js/dev/carte3d.html` montre la carte de
  campagne en relief, forêts et villes debout, caméra qui se couche en zoomant. Ce n'est pas encore le jeu (rien ne
  s'y touche) : elle sert à juger l'allure et à mesurer les images par seconde sur l'iPad.
- Villes et villages sont dessinés en vue cavalière : maisons, église à clocher, grande église des villes, cathédrale et
  hôtel de ville des chefs-lieux, citadelle des places fortes. Chaque pays a ses couleurs (pierre blonde et tuiles du
  Bordelais, toits bruns du Périgord, colombages des Landes, brique de l'Agenais, murs blancs et ardoise du Béarn),
  le nombre de maisons suit la population et les agrandissements, la neige couvre les toits en hiver.
  Drapeau au clocher, passants dans les rues et pigeons autour du clocher les animent.
- La carte vit : moulins à vent qui tournent dans les champs (plus vite par gros temps), moulins à eau, fumées des
  cheminées (épaisses en hiver, noires sur une place assiégée), drapeaux au vent, vols d'oiseaux en V (migrations au
  printemps et à l'automne), mouettes, gabares sur les fleuves et navires du cabotage, barques de pêche, courant des
  fleuves, écume et reflets sur l'océan, charrettes, cavaliers et colporteurs sur les routes, vaches et moutons, bergers
  landais sur leurs échasses, phare de Cordouan. Menu ☰, rubrique « Affichage », pour couper ces animations.
- **Carte d'époque** (menu ☰, Affichage, « Style de la carte ») : à la place des couleurs d'Ultimate General, la
  carte gravée de Cassini jusqu'en 1817 (papier, hachures, bois en petits arbres, lignes d'eau le long des côtes,
  noms à l'encre), puis la carte d'état-major aquarellée (bois vert-jaune, vignes lie-de-vin, grandes routes ocre).

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
  et les places fortes, après la technologie « Fortifications à la Vauban » (650 livres, 180 bois, 90 fer, 2 tours ⅓ de travail).
- Pendant un siège, la brèche s'ouvre dans l'enceinte dessinée à mesure que l'artillerie travaille.
- Une place prise par la force perd un niveau (remparts éventrés). Si le trésor est vide, faute d'entretien,
  les remparts les plus hauts se délabrent d'un niveau chaque mois. Le sabotage d'un espion retire aussi un niveau.

### Ce qu'une armée fait dans une place
Le panneau d'une armée à l'arrêt propose des actions selon l'endroit où elle se tient.

**Dans une de vos places :**
- **Barricades et palissades** : une part de tour de travaux (plus vite avec beaucoup d'hommes ou des sapeurs), 40 à 90 bois.
  Une place sans remparts vaut alors presque un mur d'enceinte (niveau 0,8) et soutient un siège au lieu d'être emportée
  d'emblée. L'ouvrage s'use en trois mois environ, plus vite sous la pluie, en hiver, et bien plus vite sous le canon.
  Devant des remparts, ce sont des **redoutes** : un petit bonus (+0,3 niveau). Pieux, gabions et redoutes sont dessinés sur la carte.
- **Prendre ses quartiers** : renforts et moral plus rapides, ordre public en hausse, mais 60 % de vivres en plus pour
  l'armée. Le cantonnement cesse dès qu'elle se met en marche. Des tentes apparaissent autour de la place.
- **Armer les habitants** : la milice gagne 60 % de son effectif et un peu plus selon la population (jusqu'à 900 hommes),
  pour 2 tours, contre 0,15 arme par homme ; la production baisse de 10 %. Une fois tous les six tours par place.
- **Réquisitionner** : vivres, recrues et livres pris sur-le-champ selon la population (Bordeaux : 900 vivres, 300 recrues,
  400 livres ; un village : une quarantaine de vivres). L'ordre public perd 25 %. Une fois tous les quatre mois par place.

**En marche, au moment de choisir la destination** : « Conquérir en chemin » (on rallie ou on attaque les places sur la
route) ou « Traverser » (le choix est gardé). En traversant, l'armée passe les places indépendantes sans combattre,
puis fait halte devant sa destination sans l'attaquer ; une place ennemie tenue lui barre toujours la route. Le tracé en
pointillé clair et le drapeau blanc le rappellent.

**Frontières : terres fermées et droit de passage**
- Les terres d'un département qui n'est ni à vous, ni votre allié (alliance, suzerain, vassal, vassal du même suzerain),
  ni en guerre avec vous, et qui ne vous accorde pas de droit de passage, sont **fermées** : vos armées n'y entrent pas,
  ni par ses places, ni à travers ses campagnes (une campagne appartient au maître de la place dont elle relève).
  Les places indépendantes restent ouvertes, même enclavées chez un voisin, et les terres d'un ennemi se traversent
  (ses places tenues arrêtent toujours l'armée).
- **Contournement** : par les routes, à travers champs ou en suivant votre tracé, l'itinéraire évite les terres fermées.
  La bulle de destination prévient quand le chemin direct les traverse, et le tracé affiche le détour.
- **Pas de chemin sans y passer** : l'ordre est refusé. Vous pouvez demander un droit de passage, ou **passer en force** :
  le jeu demande confirmation, car c'est **déclarer la guerre** à ce département (règles ordinaires : une trêve ou un
  suzerain l'interdisent, et ses alliés peuvent entrer en guerre).
- **Fleuves et côte** : les gabares passent librement devant les quais d'un département aux terres fermées, mais
  n'y embarquent ni n'y débarquent. Le délai de grâce ne court pas à bord.
- **Droit de passage** (fenêtre Diplomatie) : un an, révocable. Les IA l'accordent selon la relation (plus volontiers
  quand elle est bonne), leur caractère, la peur d'être envahies et l'ennemi visé. Elles le demandent quand le détour
  est trop long ou impossible, contournent sinon, ou renoncent un mois à une destination refusée ; elles ne passent
  jamais en force. La fenêtre Diplomatie résume qui vous laisse passer et à qui vous laissez passer.
- **Délai de grâce** : une armée qui se retrouve sur des terres fermées sans l'avoir voulu (droit retiré ou échu en
  chemin, place qui change de mains, paix signée en territoire ennemi, retraite) a **jusqu'à la fin du tour** pour en sortir. Elle
  reçoit d'elle-même un itinéraire de sortie (même destination par un détour, sinon les terres ouvertes les plus
  proches) et vous êtes prévenu. Au-delà, la relation baisse chaque jour, un **incident diplomatique** (−10 points au
  moins, tous les deux mois au plus) peut pousser le voisin à vous déclarer la guerre. Une retraite n'est jamais piégée :
  elle traverse s'il le faut, et le délai s'applique. Une armée qui part de terres fermées peut toujours en sortir.

**Devant une place qui n'est pas à vous :**
- **Négocier le ralliement** (place indépendante) : réponse au tour suivant, contre une somme qui dépend des habitants et
  de la milice, réduite devant une armée imposante. Les notables peuvent refuser : l'argent revient, et ils ne vous
  recevront plus pendant un mois.
- **Exiger une contribution** (indépendante, ou ennemie en guerre) : livres et vivres tout de suite, puis on laisse la place.
  Une place indépendante indigne tous les départements, une place ennemie fâche son maître. Une fois tous les trois mois par place.
- **Bloquer et affamer** : ni bombardement ni assaut, les remparts restent intacts mais la place ne produit plus rien.
  Ses réserves tiennent un tour environ, plus d'un tour de plus avec un magasin aux vivres. Puis la faim et les désertions
  minent la garnison et la milice jusqu'à la reddition, un tour plus tard environ (le panneau dit combien de tours). Le blocus est dessiné comme un cordon en pointillé.
  On peut toujours bombarder ou donner l'assaut.

Les IA s'en servent avec mesure. Elles barricadent les places menacées, arment les bourgeois face au danger et prennent
leurs quartiers pour se refaire. Elles réquisitionnent en cas de disette, affament les hautes murailles faute de canons,
rançonnent avant de lever un siège sans espoir et traversent quand elles se portent au secours d'une place. Le journal
vous prévient d'un blocus ou d'une contribution sur vos places et des troupes qui passent sur vos terres.

### Unités, intendance et prisonniers
- Outre la ligne, les voltigeurs, la cavalerie et l'artillerie :
  - **Grenadiers** : infanterie d'élite, déjà aguerrie, chère ; après la technologie « Fusil et baïonnette à douille ».
  - **Chasseurs basques** : infanterie légère des montagnes, redoutable en relief, s'use peu dans les cols ;
    levés seulement en Pays basque et en Béarn.
  - **Sapeurs du génie** : peu combatifs, mais ils accélèrent les sièges et jettent des ponts (plus d'attente au bac).
  - **Garde nationale** : milice bon marché, levée même dans un village ; elle ne quitte pas sa ville mais la défend
    avec ardeur (+30 %).
  - **Mitrailleuses** (batterie de six pièces de Reffye, après la technologie « Mitrailleuse de Reffye », 1866) : un feu
    roulant à 1 200 m (2 000 au plus), redoutable contre l'infanterie à découvert, faible contre les canons et sans
    effet sur les remparts ; ses munitions fondent vite. Armement fixe : elle ne se réarme pas.
- **Magasin aux vivres** (150 livres, 60 bois, un emplacement de la ville) : les armées en campagne à moins de 30 km restent ravitaillées, en puisant
  dans vos vivres. Pris par l'ennemi, il est pillé.
- **Moral et désertions** : trésor vide (solde impayée) ou vivres épuisés, le moral chute et les soldats désertent.
  Le journal fait le compte chaque mois.
- **Prisonniers** : une victoire en ramène quelques-uns (davantage à l'assaut d'une place, ou d'une armée presque
  anéantie que la cavalerie poursuit). Ils mangent des vivres ;
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

### Batailles sur ordres
- Quand une bataille concerne vos armées ou vos places (assauts compris), la campagne s'arrête et une fenêtre propose
  **« Donner mes ordres »** ou **« Résolution automatique »** (réglage dans le menu ☰ : toujours demander,
  escarmouches automatiques, toujours automatiques). Les batailles entre IA se résolvent toujours seules. La fenêtre
  montre aussi un **petit plan de la position** (`web/js/plan.js`) : la vraie carte de la bataille, tournée pour que vos
  troupes soient en bas, vos régiments, et l'ennemi tel que vos éclaireurs le voient (sinon sa zone, hachurée).
  (Il n'y a plus de commandement régiment par régiment : on donne ses ordres, puis on regarde.)
- **« Donner mes ordres »** (`game/tactics/orders.py`, `web/js/battle/ordres.js`) : le champ de bataille s'ouvre en 3D,
  **vu de dessus**, et une fenêtre propose vos ordres en quatre onglets. **Manœuvre** : l'objectif de la journée
  (battre son armée, la position clé, couper sa retraite, l'user), la manœuvre (en attaque : assaut frontal, ordre
  oblique avant 1789, percée au centre après 1789, enveloppement d'une aile, double enveloppement avec un général de
  division ou une nette supériorité, fixer et déborder avec assez de cavalerie, usure ; en défense : tenir, tenir puis
  contre-attaquer, contre-pente de 1789 à 1849, défense avancée, contre-offensive, usure ; devant une place : assaut à
  la brèche, pilonner d'abord, escalade sans attendre, ou défendre la place, sorties, tenir les murs) et l'aile
  d'effort. **Les armes** : la marche de l'infanterie (colonnes, ligne, ordre mixte avec la technologie, ordre
  dispersé), les légers (écran, couverts, avec la ligne), la cavalerie (aile, réserve, écran, raid sur les arrières),
  l'artillerie (contre-batterie, préparation, grande batterie, appui jusqu'au bout). **Réserve et imprévus** : sa
  taille, sa place, quand l'engager (quand l'ennemi plie, pour boucher les trous, ou **« Me demander »** : la bataille
  s'arrête au moment décisif et vous dites « Maintenant ! » ou « Attendre un quart d'heure »), que faire si sa
  cavalerie charge ou si sa réserve se montre. **Ruse et heure** : feinte, marche par le bois, feux de camp, faux
  déserteurs (60 livres), fausse retraite ; l'heure de l'attaque (aube à 5 h 30, surprise mais fatigue ; matin ;
  après-midi) ; l'attitude (prudent, équilibré, audacieux). Un choix impossible est grisé avec sa raison (époque,
  général, terrain, cavalerie, livres). À chaque choix, vos troupes se redéploient sur la carte, et l'avis de votre
  général (points forts, risques, estimation) tient compte de ce que vos éclaireurs savent de l'ennemi : son général
  et son caractère, son intention probable (si vous avez assez de cavaliers et de légers), ses armes. Des **flèches de
  manœuvre** dessinent le plan au sol : l'effort principal, la troupe qui fixe, la feinte, la marche par le bois, le
  raid de la cavalerie, la contre-attaque, le tir de l'artillerie.
  « Engager la bataille » : vos officiers la livrent selon vos ordres, avec les vraies règles, et elle **défile sous
  vos yeux** en une vingtaine à une quarantaine de secondes (une escarmouche plus vite ; ×2 de lui-même après 25 s, ×4
  après 40 s), la caméra suivant l'action. Un bandeau raconte les grands gestes ; des **étiquettes** sur la carte
  marquent charges, carrés, mêlées et déroutes ; chaque grand moment laisse un **repère** sur la barre de la journée,
  qu'on touche pour y ramener la caméra. « ×1 / ×2 / ×4 » règlent la vitesse, « Passer » la finit au plus vite.
  Le récapitulatif ajoute les pertes par arme et ce qui a décidé la journée. Banc : `python3 outils/banc_ia.py --ordres '{"man": "double"}'`.
- **Canons camouflés.** Une batterie postée dans un bois (pas en forêt : les pièces n'y passent pas) ne se voit qu'à
  moins de 250 m, 500 m quand elle tire (la fumée reste sous les arbres) ; en échange, les troncs gênent son tir
  (−35 %) et sa mise en batterie est plus longue de moitié. Vaut pour vous comme pour l'ennemi, dans tous les modes ;
  le panneau du régiment le rappelle.
- La **résolution automatique** (et toute bataille entre IA) se joue sur la carte de campagne, en quelques heures à
  quelques jours, et finit comme une bataille que vos officiers mènent jusqu'au bout : en rase campagne, le camp dominé
  ou ébranlé décroche en bon ordre (passé environ 12 % de pertes face à un ennemi nettement plus fort, 19 % à forces
  voisines ; le défenseur tient mieux que sa seule force) ; le défenseur d'une place ne décroche pas, il la rend, et un
  assaut brisé reflue en désordre. Seule une armée presque anéantie est poursuivie ; il y a peu de prisonniers
  (davantage à l'assaut d'une place), et le vaincu perd encore quelques traînards dans sa retraite. Pertes,
  prisonniers et vainqueurs sont du même ordre dans les deux modes (mesuré bataille par bataille).
- Sur ordres, la bataille se livre sur une carte de 3 × 2 km tirée du terrain de la campagne : relief, bois, champs, vignes, haies, clôtures et
  murets, routes, rivières avec gués et ponts, fermes, et la ville avec ses remparts, ses portes et la brèche du siège.
  Le paysage est composé comme une vraie campagne : des parcelles aux formes variées qui suivent les routes et les
  courbes de niveau, des **vergers** autour des maisons (couvert léger, ils ralentissent un peu et gênent un peu la
  vue ; jamais sur le glacis d'une place forte), des prés le long de l'eau, pas de labours sur les pentes fortes, des
  bois aux lisières découpées avec leurs clairières, des bosquets, des haies au bord des parcelles et des chemins qui
  les longent jusqu'aux fermes et aux hameaux.
  Chaque régiment a son expérience, son endurance, la portée de ses armes et ses munitions (un chariot par armée les
  recomplète) ; les bois cachent les troupes, la nuit arrête le combat.
- Munitions et fatigue restent d'une bataille à l'autre : elles se
  recomplètent en campagne (vite chez soi, peu en pays ennemi).

#### Mode Bataille (sans campagne)
L'écran d'accueil a deux onglets : **Campagne** (la partie habituelle) et **Bataille**, pour livrer une bataille isolée.
On y choisit l'époque (1700, 1790, 1813, 1870), son camp, l'adversaire (ou au hasard), jusqu'à **10 régiments**, et le type
de bataille : **bataille rangée** en rase campagne ou **place forte**, en attaquant ou en défenseur (l'assaillant d'une
place, remparts intacts, reçoit 5 régiments de renfort : 2 batteries, des sapeurs, des grenadiers et de la ligne, soit
15 régiments contre une garnison de 7 et la milice ; il faut escalader les murs). Lieu, saison et météo se
règlent ou se tirent **au hasard** ; on peut aussi toucher une ville sur la carte. L'ennemi aligne autant de régiments,
tirés au sort. La bataille se livre **sur ordres**, comme en campagne, puis « Retour au menu ». Elle n'est pas enregistrée et
ne touche pas à la campagne en cours (`game/tactics/skirmish.py`).

#### Regarder la bataille
- **L'entrée.** La carte de campagne plonge vers le lieu du combat, puis le champ de bataille apparaît **en 3D**,
  la caméra tournée vers l'ennemi : relief en volume, sol peint comme un paysage (herbe aux nuances multiples, blé
  doré mêlé de cultures vertes, chaumes et labours selon la saison, vignes en rangs, larges chemins de terre à
  ornières, rivières avec berges et reflets) ; de près, le blé, les cultures, l'herbe des prés et des landes montent
  en relief et ondulent au vent.
  Arbres et bois aux couronnes touffues, fermes, villages, église et clocher, moulins, ponts, remparts et bastions,
  tranchées, haies, murets et clôtures ; le soleil de l'heure porte leurs ombres, adoucies, et une lumière douce
  éclaire le tout. Chaque régiment est fait de figurines 3D arrondies (un homme par figurine tant que la qualité
  graphique le permet) en uniforme français de l'époque : justaucorps gris-blanc sous Louis XIV, habit bleu national
  puis impérial, capote bleu foncé et pantalon garance en 1870, artillerie en bleu foncé, dragons en habit vert (de
  1760 à 1860, la cavalerie compte dragons, chasseurs à cheval et hussards). Son camp se lit à ses revers,
  son collet et ses parements, de loin à son plastron et à sa ceinture, et à ses drapeaux et fanions. Il se tient en
  rangs serrés (trois rangs pour une ligne), avec porte-drapeau, tambours, officiers et colonel à cheval ; les
  coiffures suivent l'époque (tricorne relevé, bicorne, shako, képi, bonnet à poil), buffleteries blanches,
  havresac ; chaque homme a son ombre au sol. Dans un bois, la couronne des arbres s'efface au-dessus d'un régiment :
  on voit ses hommes entre les troncs. Les hommes sont
  **animés**, chacun avec son allure et son temps de retard : ils marchent au pas, mettent en joue l'un après
  l'autre quand la salve roule le long du front (le premier rang à genoux), puis rechargent à la baguette ; quand la
  formation change, chacun court à sa nouvelle place ; en mêlée, les premiers rangs avancent baïonnette en avant
  vers l'ennemi le plus proche. Les cavaliers sont en selle, sabre au clair, au pas, au trot ou au galop ; au choc,
  les chevaux du premier rang se cabrent et les cavaliers frappent. Les servants écouvillonnent, chargent, pointent
  et mettent le boutefeu ; la pièce recule au départ du coup. Les tués tombent selon le coup (un boulet fauche une
  file, les hommes sont projetés ; les chevaux s'abattent, leur cavalier à côté) et **restent au sol toute la
  bataille** (jusqu'à un plafond selon la qualité, les plus anciens deviennent des taches au sol). Les troupes
  **contournent les bâtiments** au lieu de les traverser. La fumée blanche des salves forme un banc le long de la
  ligne, s'amasse et dérive avec le vent ; avec la poudre B (le fusil Lebel, et les pièces d'un camp qui a la
  technologie), plus que l'éclair et un voile à peine visible. Les armes suivent l'époque et la génération de chaque
  régiment : avant la baïonnette, un homme sur cinq porte la pique, au centre du bataillon (dressée, croisée à la
  charge et en carré) ; chaque génération d'artillerie a sa pièce (long fût de bronze sur affût de bois, Gribeauval
  vert olive, Valée et La Hitte à flèche, de Bange en acier, canon de 75 et son bouclier, dont seul le tube recule) ;
  la mitrailleuse de Reffye crépite, un servant à la manivelle. Les porte-drapeau portent les **vrais drapeaux de
  l'époque** : d'ordonnance aux couleurs de chaque régiment (jusqu'en 1790), modèles 1791, de l'an II, 1804 et 1812,
  drapeau blanc fleurdelisé de la Restauration, tricolore au coq puis à l'aigle, « RF » ; avec le haut de hampe (fer
  de lance, aigle, coq) et la cravate de leur temps. Tous les camps étant français, c'est le fanion au-dessus du
  régiment qui dit à qui il est. Au-dessus de chaque régiment, un fanion à la manière d'Ultimate
  General porte le pictogramme de son arme et son effectif (barré et pâli s'il est en déroute) ; le général a son
  médaillon. Le temps, la saison et l'heure se voient : pluie, brouillard, neige, orage, ombres des nuages qui
  passent, lumière dorée du matin, couchant puis nuit.
- **Le déploiement.** Vos officiers placent vos troupes selon vos ordres, dans votre moitié du champ de bataille (sauf
  une bande neutre de 400 m au milieu) ; devant une place, l'assaillant reste à 450 m de l'enceinte, le défenseur tient
  la place et 250 m autour. L'ennemi se déploie plus en retrait : les armées ne commencent pas au contact. Une place
  forte a ses **canons du rempart** : une batterie fixe par niveau de fortification (1 à 3), immobile ; ils tirent,
  peuvent être pris, et comptent aussi dans la résolution automatique (à moitié : `rules.FORT_GUNS_AUTO`). Les canons
  de l'assaillant **ouvrent des brèches** en battant le rempart (une petite heure pour deux batteries contre une place
  ordinaire) ; l'assaillant laisse d'abord ses canons travailler, puis lance ses colonnes dans la brèche dès qu'elle
  s'ouvre ; sans brèche, il finit par escalader.
- **La fiche d'un régiment.** Touchez un régiment (le vôtre ou l'ennemi) : sa fiche donne son arme, son effectif, son
  état, ses valeurs et, pour une batterie dans un bois, son camouflage ; « Ligne de vue » montre ce qu'il voit.
- **Déroutes et ralliement.** Une troupe en déroute fuit vers son bord de la carte. Elle ne se reforme **qu'auprès
  de son général**, loin de l'ennemi (à plus de 400 m, 500 m pour un général inspirant) ; vos officiers vont la
  chercher. Dans une place, les officiers rallient leurs hommes sans le général ; sans général sur le terrain, ils
  n'arrêtent les fuyards que très loin de l'ennemi. Ceux qui atteignent le bord quittent la bataille et retrouvent
  leur armée en campagne.
- **Le canon.** La mitraille est terrible à bout portant : sous 150 m, la gerbe encore serrée fauche des files
  entières (à 50 m, elle tue plus que deux bataillons qui font feu). Aborder une batterie de face coûte très cher ;
  prenez-la de flanc, ou faites-la taire d'abord.
- **La vue.** Pendant le film, la caméra suit l'action (« Caméra : vue d'ensemble » la fige au-dessus du champ) ; on
  peut toujours la prendre : glisser pour se déplacer, pincer pour zoomer, **tourner deux doigts pour pivoter** ; à la
  souris, molette pour zoomer, **clic droit glissé pour pivoter** ; flèches du clavier. La **mini-carte** (en bas à
  droite) montre la part de terrain vue et se touche pour s'y rendre.
- **Lire la bataille**, comme dans Ultimate General : le régiment choisi est cerné d'un anneau lumineux ; entre deux
  régiments ennemis au contact, une **ligne de front** ondule au sol, à la couleur de chaque camp de son côté ; le
  bouton **« Ligne de vue »** de la fiche d'un régiment assombrit tout ce qu'il ne voit pas (crêtes, bois,
  bâti et vergers, la même règle que le moteur, haies mises à part). La fumée des canons, plus grise, monte au-dessus
  de celle des fusils. De près, les fantassins ont le corps modelé des personnages de Quaternius (CC0), habillé de
  l'uniforme de l'époque ; les revers portent leurs boutons dorés et les visages leurs yeux et sourcils ;
  baïonnettes, cuivres et bronze des pièces renvoient le soleil ; les haies du bocage sont des
  rangs de feuillage touffu, d'où dépassent des arbres têtards ; les creux du terrain sont plus verts et plus sombres.
  Au fil de la bataille, la boue monte sur les guêtres et les culottes ; sous la pluie, les habits foncent et la boue
  foulée luit, ses flaques reflétant le ciel. Au fil des pertes, des débris jonchent le sol (chapeaux, fusils, havresacs, roues brisées près des pièces), et la
  boue laissée par les troupes est gardée avec la bataille : une bataille rechargée retrouve ses traces.
  Le décor suit l'époque et les technologies des deux camps : poteaux télégraphiques et voie ferrée le long de la
  grand-route, cheminées d'usine à l'horizon, ambulances à l'arrière (à croix rouge après la convention de Genève),
  ballon captif au-dessus de l'état-major des aérostiers, parapet de terre devant l'infanterie retranchée. Les
  cultures aussi : vignes « en foule » (ceps épars, sans rangs) jusqu'aux plants greffés, puis en rangs palissés ;
  maïs dans la moitié des champs de Chalosse et du Béarn l'été et l'automne ; pins des Landes semés en lignes après
  la loi de 1857.
- **En haut** : l'heure (et la nuit qui approche), le temps, le rapport de forces (l'ennemi : seulement ce que
  vous en voyez) et le journal (repliable, et complet derrière son bouton).
- **La fin.** Le récapitulatif donne victoire ou défaite, pertes des deux camps, prisonniers, expérience, et les
  pertes de chaque régiment ; « Retour à la carte » ramène la campagne, que vous relancez quand vous voulez.
- **Qualité graphique** (menu ☰, section Affichage, ou fenêtre du journal de bataille) : **Basse** (appareils
  anciens : image moins fine, 3 000 figurines, peu de fumée, bois allégés, sans ombres), **Moyenne** (tablettes et
  téléphones modestes : ombres du décor, 6 000 figurines), **Haute** (iPad récent : écran Retina, sol détaillé
  jusqu'à 16 pixels par mètre, 10 000 figurines, ombres des troupes), **Ultra** (ordinateurs : 20 000 figurines, plus
  de fumée, ombres plus fines). Au-delà, chaque figurine compte plusieurs hommes. En Haute et en Ultra, les cultures
  proches de la caméra sont en relief ; de loin, les figurines passent à une version plus simple (on ne voit pas la
  différence, l'appareil la sent), et elles grandissent (jusqu'à trois fois) en se faisant moins nombreuses, à la
  manière d'Ultimate General, pour que les rangs restent lisibles ; la fumée grandit avec elles. Les tués restent
  au sol jusqu'à 800 (Basse), 1 500, 2 500 ou 4 000 (Ultra). À partir de Moyenne, l'image passe par un
  **après-rendu** à la manière d'Ultimate General : courbe filmique ACES, étalonnage propre à l'heure et au temps
  (matin doré et brumeux, midi chaud aux verts tirés vers le jaune, couchant orangé, nuit bleue, pluie grise),
  vignettage, et la **brume** : un voile qui pâlit les lointains (plus dense au ras du sol, éclairci du côté du
  soleil), la brume basse des vallées au petit matin, épaisse par temps de brouillard. Au-dessus de l'horizon, un
  **ciel** : bleu au zénith, clair à l'horizon, halo du soleil, couchant coloré et bancs de nuages qui défilent au
  vent (leurs ombres passent sur le champ). L'**eau** des rivières et des étangs est vert-de-gris, ridée par le vent,
  avec le reflet du ciel qui grandit vers l'horizon, l'éclat du soleil et une écume claire aux berges ; en Haute s'y ajoutent l'anticrénelage FXAA et un léger halo des plein-soleil ; en Ultra,
  l'anticrénelage matériel et, à ras des troupes, une profondeur de champ « maquette » (le haut et le bas de l'image
  se floutent). Le sol garde sa peinture (couleurs de la saison et des parcelles) mais prend la **matière de huit
  sols photographiés** (pré, herbe sèche, lande, terre, chemin, route empierrée, sable, roche ; CC0, ambientCG) :
  touffes, mottes et cailloux qui accrochent la lumière, mêlés par leur hauteur à la frontière de deux sols, la terre
  puis la roche sur les pentes ; photos de 512 px en Basse et Moyenne, de 1024 px avec un pavage aléatoire qui en
  cache la répétition en Haute et Ultra. Le **relief se lit** : le soleil l'emporte sur la lumière du ciel par temps
  clair, les pentes accrochent la lumière, les fonds de vallée sont plus sombres, et quand le soleil est bas les
  collines portent leur ombre, comme les nuages, sur le sol, les troupes et les arbres. Les **bois** sont des masses
  sombres : sous-bois assombri, couronnes qui se touchent, grappes de feuilles, nuances d'un bout à l'autre du bois,
  soleil qui traverse le feuillage à contre-jour, arbres qui se balancent au vent. Les **chevaux** sont de vrais modèles
  animés (Quaternius, CC0) : au repos ils broutent ou s'ébrouent, ils vont au pas et au galop, tombent quand ils sont
  tués ; de loin, une version simplifiée. En Haute et Ultra, les prés et les
  landes ont de l'**herbe en relief** autour de la vue (des touffes de brins qui prennent la couleur du sol, ondulent
  au vent et se couchent là où les troupes passent). Le **sol garde la trace** de la
  bataille : là où passent les troupes (la cavalerie et l'artillerie plus que l'infanterie, deux fois plus sous la
  pluie) et autour des trous d'obus, il tourne à la boue, les épis se couchent et la neige s'efface (la trace n'est
  pas enregistrée : une bataille rechargée repart d'un sol neuf). La caméra regarde le champ en biais (50° de loin),
  et l'interface reprend l'allure d'Ultimate General : panneaux d'ardoise, bandeau fin avec l'année et l'heure, cartes
  d'unités en portrait sous des onglets à la couleur du camp, mini-carte encadrée. Au premier lancement, elle est
  choisie d'après l'appareil, puis baisse d'elle-même d'un cran si la bataille saccade (moins de 26 images par
  seconde) ; un choix fait à la main est gardé tel quel. Elle est enregistrée sur l'appareil et s'applique tout de
  suite, sans quitter la bataille (l'anticrénelage, à la bataille suivante). Les batailles demandent **WebGL 2**
  (iPadOS 15 et plus, tout navigateur récent) ; sans lui, un message le dit et vos officiers mènent la bataille.
- Clavier : flèches ou ZQSD pour la vue, + et − zoom, Échap referme la fiche.

### Voies ferrées et trains
- Avec la technologie « Chemins de fer » (vers 1841), le panneau d'une ville propose les **tronçons** de voie ferrée
  qui en partent, sur les **tracés historiques** : 29 lignes vérifiées, de Bordeaux–La Teste (1841) à Dax–Mont-de-Marsan
  (1899). Un tronçon va d'une ville à la suivante, par la route la plus courte.
- Un tronçon s'ouvre si ses deux villes sont à vous et si l'une est votre chef-lieu ou touche déjà votre réseau. Il se
  **paie** (30 livres, 8 fer et 6 bois par km ; le ciment réduit le prix) et avance à part de la file de la ville, plus
  vite si votre industrie est forte (× 0,5 à 2). Deux chantiers au plus à la fois.
- Une ligne ouverte **dope** ses villes : +5 % d'industrie et de livres par tronçon, jusqu'à +15 %. Une armée à moins
  de 30 km d'une gare de son camp s'use 30 % moins vite. La technologie n'accélère plus toutes les routes.
- Avec « Chemins de fer militaires » (vers 1859), les armées **prennent le train** sur leurs lignes et celles de leurs
  alliés : une journée pour embarquer en gare, puis 130 km par jour ; elles descendent un peu désorganisées (moral −5).
  L'ordre de marche le montre (trait de rail), l'armée roule en convoi. Les IA construisent et prennent le train aussi.
- Une ligne n'est à personne : on s'en sert si ses deux villes sont à soi ou à un allié ; prendre une ville prend ses
  rails. Une armée en guerre qui finit son mois sur une ligne ennemie la **coupe** pour trois tours (croix rouge sur la
  carte) ; un convoi en route descend et finit à pied.
- Sur la carte : voies (trait noir à tirets blancs), chantiers en pointillés, gares, lignes qui sortent vers Paris,
  Toulouse, Limoges ou l'Espagne, et des trains qui vont et viennent avec leur panache.

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
- Depuis une place étrangère : **Espionner** (60 livres, rapport au tour suivant) révèle sa garnison et les armées alentour pendant deux tours ;
  **Saboter** (150 livres, rapport au tour suivant, en guerre) fait perdre un niveau de remparts. Un agent démasqué fâche le département visé.
  Les IA sabotent aussi les places que leurs armées convoitent.

### Impôts et ordre public
- Les impôts (fenêtre Production) vont de « très légers » (60 % des livres, recrues +15 %, pacification rapide des
  conquêtes) à « écrasants » (140 % des livres tout de suite).
- Au-delà d'impôts normaux, l'**ordre public** baisse lentement, et la production de chaque place suit son ordre public :
  pressurer le pays rapporte sur quelques semaines, puis coûte. Famine et banqueroute l'abaissent aussi.
- Une place agitée sans garnison ni armée peut **se révolter** et redevenir indépendante. Un régiment en garnison calme la population.

### Villes : emplacements, politique et événements locaux
Tout marche seul avec les réglages par défaut ; on intervient quand on veut, depuis le panneau de la ville.

- **Emplacements** : village et place forte 1, ville 3, chef-lieu 5, plus 1 par agrandissement. Chacun accueille une
  chaîne de bâtiments à trois niveaux, bâtie dans la file de la place comme les remparts (ressources et part de tour).
  Certains niveaux demandent un agrandissement, une technologie ou une spécialité. Remparts et agrandissements restent
  à part. Toucher un emplacement vide montre les chaînes possibles ; un emplacement occupé propose l'amélioration ou la
  démolition.

| Chaîne | Niveaux | Effet (niveau 1 / 2 / 3) | Entretien |
|---|---|---|---|
| Commerce | Marché, Halle couverte, Bourse de commerce (Caisse d'escompte) | +0,1 / 0,2 / 0,35 livre par jour, foires plus fréquentes | 0 / 0,05 / 0,15 |
| Grains | Moulins, Minoterie, Greniers d'abondance (Greniers publics) | +0,2 / 0,4 / 0,6 vivres, moins de disettes | 0 / 0,05 / 0,1 |
| Spécialité | Chai, Maison de négoce, Grand chai… (selon la ville ; technologie de la spécialité) | spécialité +20 / 40 / 60 % | 0 / 0,05 / 0,15 |
| Industrie | Atelier, Manufacture (Manufactures royales), Fabrique (Machine à vapeur) | +0,1 / 0,25 / 0,45 industrie | 0 / 0,05 / 0,15 |
| Garnison | Caserne, Quartier de cavalerie (Haras), École militaire (Système divisionnaire) | recrues +0,1 / 0,2 / 0,3, régiments formés 15 à 25 % plus vite, milice +40 à +80, recrues aguerries à l'École | 0,1 / 0,2 / 0,35 |
| Charité | Hospice, Hôtel-Dieu, Collège | ordre public +3 / 5 / 7 %, croissance +10 / 20 / 25 %, moins de fièvres ; le Collège accélère les recherches | 0,05 / 0,15 / 0,25 |
| Port fluvial (quais) | Cale et entrepôts, Chantier de gabares, Arsenal | +0,1 / 0,2 / 0,35 livre de commerce par eau (sensible au blocus), bois, industrie | 0 / 0,05 / 0,15 |
| Magasin aux vivres | un seul niveau | ravitaille les armées à moins de 30 km | 0 |

  La production des bâtiments est réduite de moitié dans un village ou une place forte, augmentée de moitié au
  chef-lieu ; elle suit ensuite la population, l'ordre public et les outils de la place. Une ancienne sauvegarde se charge telle
  quelle : un magasin existant occupe un emplacement, et une place qui a plus de bâtiments que d'emplacements (ville
  réduite après un sac) garde tout, mais ne peut plus en bâtir de nouveaux.
- **Politique de la ville** : une orientation par place, sans rien construire. Un changement prend effet peu à peu
  (au tour suivant). Un bouton l'applique à toutes vos places du même type.

| Politique | Bonus | Contrepartie |
|---|---|---|
| Équilibre (par défaut) | — | — |
| Commerce | livres +10 %, foires plus fréquentes | vivres −10 %, recrues −15 % |
| Grenier | vivres +15 %, disettes deux fois plus rares | livres −8 % |
| Recrutement | recrues +25 % | croissance −25 %, ordre public −3 % |
| Place d'armes | régiments formés 20 % plus vite et plus aguerris, ordre public +3 %, moins de brigands | livres −10 % |
| Fêtes et culte | ordre public +7 %, croissance +15 %, moins d'émeutes | livres −15 % |

- **Événements locaux** : environ un tous les deux à trois mois de jeu pour vos places (davantage si l'ordre public est
  bas ou en guerre). Incendie, fièvre, disette, brigands, grande foire, crue (au printemps, villes sur les fleuves),
  réfugiés (surtout en guerre), filon de fer, émotion populaire. Chacun propose deux ou trois choix (payer, envoyer la
  garnison, laisser faire…) dont les effets ne touchent que la ville. Le jeu se met en pause, la fenêtre montre les
  coûts et effets et permet d'aller voir la ville ; un sceau rouge la signale sur la carte. Saisons, ordre public,
  bâtiments et politique pèsent sur les chances : un Hôtel-Dieu éloigne les fièvres, une Halle attire les foires, des
  greniers préviennent les disettes. Sans réponse avant la fin du tour suivant, la dernière option s'applique.
- **IA** : elles jouent avec les mêmes règles. Elles bâtissent là où un bâtiment rapporte le plus pour son prix, selon
  leur personnalité (négoce girondin, forges du Périgord, grenier agenais…), choisissent la politique de leurs villes
  selon leurs besoins (fêtes si l'ordre vacille, recrutement et place d'armes en guerre, grenier quand la faim menace,
  commerce dans les places de négoce) et répondent à leurs propres événements, sans pause.

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
- 94 technologies en quatre branches : militaire (feu de rang, feu de peloton, ordre mixte de Guibert, cuirassiers,
  artillerie à cheval, génie…), civile et sociale (gendarmerie, cadastre, poste aux chevaux, écoles centrales, caisse
  d'escompte…), industrielle (poudreries, forges au coke, pièces interchangeables, draperies, chantiers de gabares…)
  et agricole (maïs, foires agricoles, gemmage, transhumance, greniers publics, conserves d'Appert…). Certaines ont un
  effet à elles (SPEC-TECH.md) :
  - militaire : **aérostiers** (1794 : en bataille, le ballon du général voit tout ennemi à 1 500 m), **retranchements**
    (1860 : l'infanterie arrêtée depuis cinq minutes perd 25 % de moins au feu), **dynamite** (1867 : une brèche de plus
    à l'assaut), **mélinite** (1885 : le couvert protège moitié moins de votre artillerie), chemins de fer militaires
    (1859 : les armées prendront le train, avec les voies ferrées de la carte) ;
  - civile et sociale : **vaccine** (1800 : épidémies moitié moins meurtrières), **caisse d'épargne** (1819 : le trésor
    rapporte 2 % l'an), **éclairage au gaz** (1830 : villes +5 % de livres), **photographie** (1839 : l'expérience et
    l'armement des armées ennemies repérées), **suffrage universel** (1848 : lassitude de la guerre ×0,75), **secours
    mutuels** (1852 : révoltes moitié moins probables), **Croix-Rouge** (1864 : un quart des pertes d'une bataille
    rejoint ses régiments), **téléphone** (1879 : le bilan du tour annonce les armées ennemies qui arrivent au tour
    suivant), **syndicats** (1884 : industrie +10 %, mais une ville à l'ordre bas fait grève en janvier) ;
  - industrielle : **bateau à vapeur** (1818 : on remonte les fleuves aussi vite qu'on les descend), **ciment** (1817 :
    constructions −15 % de coût et de délai), phares de Fresnel (1823) ;
  - agricole : **sucre de betterave** (1812 : le Blocus ne coûte plus rien aux ports), charrue Dombasle (1820),
    moissonneuses (1855), **bouillie bordelaise** (1885 : le phylloxéra et le mildiou de 1882 frappent moitié moins).
- **Population et agrandissement** : chaque place a ses habitants (estimations de 1790 : Bordeaux 110 000, Bayonne
  13 000, Agen 11 000, Pau 9 000…). Sa production suit sa population. « Agrandir » la ville (3 niveaux : premiers
  faubourgs, nouveaux quartiers, grande ville ; pour un village : village agrandi, gros bourg, bourg prospère) ouvre
  de la place pour 10 % d'habitants de plus, qui viennent s'installer mois après mois si l'ordre public est bon et les
  impôts raisonnables. La production de la place suit son remplissage et la valeur de ses agrandissements.
- **Spécialités** : chacune des 50 villes principales a son produit phare, qui rapporte à qui la tient
  (grands crus de Bordeaux, Sauternes et Saint-Émilion, pruneaux d'Agen, truffes de Périgueux, jambons d'Orthez,
  chocolatiers de Bayonne, résine de Mimizan, tabacs de Tonneins, sel de Salies…). Un chef-lieu en produit deux fois plus.
  Des technologies les améliorent : chais (vins), foires agricoles (terroir), gemmage (résine), draperies (manufactures),
  ports et gabares (pêche et négoce). Aux vendanges, les grands vins comptent double.
- Chaque département a ses avantages et inconvénients (négoce bordelais, forges du Périgord, échassiers landais,
  grenier agenais, montagnards basques et béarnais).
- Diplomatie : guerre, paix (avec tribut), alliance, accord commercial, présents, échanges de ressources, exigence de soumission.
- Marché des négociants : meilleurs prix si vous tenez un port.

### Journal des batailles (pour l'équilibre)
Chaque bataille terminée (automatique, sur ordres, entre IA ou du mode Bataille) ajoute une ligne à
`logs/batailles.jsonl` (non suivi par git ; mis de côté dans `batailles.1.jsonl` au-delà de 20 Mo) : date, saison,
météo, terrain, place, fortification et canons du rempart, forces des deux camps, durée, brèches ouvertes et à quelle
heure, vainqueur, pertes, prisonniers, prise de la place. `python3 outils/bilan.py` (option `--depuis AAAA-MM-JJ`) en
tire des tableaux : taux de prise des places selon leur fortification, temps pour ouvrir une brèche, places prises avec
ou sans brèche, batailles automatiques face à celles sur ordres, résultats du mode Bataille.

**Banc d'équilibre de la campagne** : `python3 outils/simuler.py --parties 6 --epoque 1790 --annees 30 --proc 2` fait
jouer des campagnes aux IA seules (le camp du joueur compris), sur des graines fixes, et donne pour chacune les guerres
et leur durée, les places de chaque camp, l'écart entre le premier et le dernier, les camps en vie, les technologies, le
trésor et les hommes sous les armes. Environ 20 s de calcul par année et par partie sur le Raspberry Pi ; la mesure
d'avant et d'après les nouvelles technologies est dans `tasks/equilibre-reference.md`.

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
Clavier : espace pour « Tour suivant » ou « Continuer » (pour la pause en temps réel), 1 à 6 pour la vitesse en temps
réel, Échap pour annuler, + et − pour zoomer.

## Organisation du code
```
server.py            serveur HTTP local + boucle de simulation (10 pas par seconde)
game/turns.py        tour par tour : tour des IA d'un coup, arrêts, temps en tours (work, deadline), récapitulatif
game/geo.py          carte : projection, grilles de terrain, réseau routier, recherche de chemin A* (avec terres interdites)
game/places.py       les 223 villes, villages et places fortes, routes royales
raspberry/           installation en service sur Raspberry Pi
game/rules.py        départements, unités, technologies, généraux, formations, météo
game/engine.py       simulation : économie, impôts, armées, gabares, combats par phases, sièges, espions
game/army_actions.py actions d’armée : barricades, quartiers, garde bourgeoise, réquisition, traversée, terres fermées et droit de passage, blocus
game/waterways.py    voies navigables (fleuves, estuaire, cabotage) et blocus
game/ai.py           IA des départements
game/cities.py       villes : emplacements et bâtiments, politique de la ville, événements locaux
game/diplomacy.py    diplomatie et commerce
game/battle_log.py   journal des batailles (logs/batailles.jsonl) ; outils/bilan.py en fait le bilan
game/views.py        état envoyé au navigateur (brouillard de guerre), sauvegardes
game/tactics/        batailles sur ordres : carte de bataille (terrain.py), unités (units.py), simulation
                     (battle.py), IA qui livre la bataille (ai.py), vos ordres et leurs flèches (orders.py), raccord avec la
                     campagne et plan de la position (bridge.py)
web/                 interface : index.html, css/style.css, js/map.js (rendu canvas), js/ambient.js (animations
                     de la carte), js/towns.js (dessin des villes), js/ui.js, js/plan.js (plan de la position dans la fenêtre de bataille),
                     js/tuto.js (tutoriel), js/main.js
web/js/battle/       vue de bataille en 3D (Three.js) : bataille.js (entrée et sortie depuis la campagne),
                     vue.js (scène WebGL et calque 2D, boucle, interrogation du serveur, tracés au sol),
                     camera.js (caméra orbitale, passage écran ↔ terrain), relief.js (relief, sol peint de
                     plus en plus fin autour de la caméra, tués au sol, ciel, brume, ombres), terrain.js
                     (peinture du sol, altitudes, données du décor), textures.js (motifs du sol), decor.js
                     (arbres, bâti, remparts, haies en volume), troupes.js (figurines 3D animées sur la
                     carte graphique, dispositions des rangs, tués au sol), gestes.js (le geste de chaque homme,
                     sa place, les tués, l'échelle de loin : logique pure, testée),
                     fanions.js (fanions et médaillons),
                     unites.js (figurines peintes des cartes d'unités), effets.js (fumées, tirs, météo),
                     heures.js (table des heures : lumière, brume et étalonnage de 5 h à 22 h ; logique pure,
                     testée), horizon.js (normales fines, occlusion et horizons du relief, calculés une fois
                     par bataille ; logique pure, testée), apres.js (après-rendu : brume, ACES, LUT d'étalonnage, vignettage, FXAA, halo,
                     maquette), ciel.js (le ciel : dégradé, soleil, nuages), visibilite.js (ligne de vue ; logique pure, testée), epoque3d.js (le décor de l'époque), herbe.js (touffes d'herbe en relief), pietinement.js (la boue laissée par les troupes), sols.js (sols photo : chargement des huit sols), qualite.js (qualité
                     graphique), commandes.js (caméra au doigt et au clavier), ordres.js (fenêtre des ordres, flèches,
                     film : étiquettes, repères, vitesses),
                     interface.js (barres, panneaux, récapitulatif), formes.js (constantes et outils
                     communs), css/bataille.css ;
                     dev/cuire.mjs : précalcule les animations sur le squelette de nos figurines (à relancer
                     seulement si on change les gestes) ; dev/cheval.mjs : précalcule le cheval de Quaternius
                     (node web/js/battle/dev/cheval.mjs Horse.gltf) ; dev/anims.html : page d'essai des animations
web/anims/           animations précalculées des soldats (soldat.bin, soldat.json), cheval animé de Quaternius
                     (cheval.bin, cheval.json : maillage et gestes, CC0) et leur licence
web/textures/sols/   les huit sols photo (couleur, normales, hauteur ; 6,4 Mo) et leur licence (CC0, ambientCG)
web/vendor/three/    Three.js r186 (licence MIT), copié tel quel : le jeu marche hors ligne
saves/               parties sauvegardées (JSON)
tests/               bancs d'essai (voir « Tests » ci-dessous)
```

## Tests

Des bancs d'essai vérifient en moins d'une minute ce qui demanderait des heures de jeu : batailles, campagne,
serveur et interface. Aucune bibliothèque à installer (Python standard, et Node pour l'interface, facultatif).

```bash
python3 tests/lancer.py                          # tout (environ 40 s sur un Raspberry Pi)
python3 tests/test_bataille.py                   # un seul banc Python
node --test tests/*.mjs                         # l'interface seule
```

| Fichier | Ce qu'il vérifie |
|---|---|
| `tests/test_bataille.py` | ordres propres à chaque arme (acceptés ou refusés), salve puis baïonnette, harcèlement, canons sans munitions, régiment anéanti, bataille jusqu'au bout et rechargement en plein combat ; « Donner mes ordres » de bout en bout (choix verrouillés, redéploiement, heure, moment décisif, récapitulatif), flèches de manœuvre, plan de la position, vitesses du film, mode Bataille sur ordres, banc de quelques jeux d'ordres ; canons camouflés dans un bois |
| `tests/test_campagne.py` | votre tour puis celui des IA (d'un coup, arrêts, reprise), villes neutres, temps en tours (production, recherche, échéances, actions d'armée, sièges, arrivée), retraite une fois par tour, dettes et événements, prix du marché, sauvegarde (IA comprises) |
| `tests/test_cartes.py` | cartes de bataille : même graine, même carte ; plus de parcelles en quadrillage (moins de 30 % de bords en longues droites) ; vergers près des maisons, jamais sur le glacis ; moins d'une demi-seconde par carte |
| `tests/test_serveur.py` | un vrai serveur HTTP sur un port libre : requêtes mal formées, fichiers hors de `web/`, ordres pendant le tour des IA, sauvegardes (dossier temporaire, les vraies ne sont pas touchées) |
| `tests/interface.test.mjs` | sans navigateur (`tests/dom.mjs`) : chargement de tous les modules, fiche du régiment (camouflage compris), fenêtre de bataille à deux choix, barre du tour, tutoriel et bulles de bataille |
| `tests/camera.test.mjs` | caméra 3D des batailles : allers-retours écran ↔ terrain à 1 m et 1 pixel près sur une colline, à plusieurs caps et zooms ; bornes |
| `tests/troupes.test.mjs` | dispositions des figurines : rangs de la ligne, plafond par régiment, carré à quatre faces, colonne, tirailleurs, déroute |
| `tests/gestes.test.mjs` | animations des batailles : geste de chaque homme (salve qui roule, recharge, servants, mêlée, charge), allure propre à chacun, place gardée d'une formation à l'autre, tués (ligne d'un boulet, plafond des corps), contour des bâtiments, échelle des figurines de loin |
| `tests/visibilite.test.mjs` | ligne de vue du navigateur : rase campagne vue, crête et bois épais qui bouchent, lisière qui voit dehors, la même dans les deux sens, champ de vision borné |
| `tests/decouvertes.test.mjs` | découvertes : chaque technologie a sa famille de vignette animée |
| `tests/epoque.test.mjs` | la carte selon l'époque : drapeau de chaque période, chapeaux des passants, phylloxéra de 1875 aux plants greffés |
| `tests/frontieres.test.mjs` | frontières de la carte de campagne : les segments des carrés marchants raboutés en lignes continues, sans perdre ni doubler un point |
| `tests/portraits.test.mjs` | portraits des régiments : la même figure en bataille et en campagne (piquiers avant la baïonnette, pièce de son époque, cavalier pour le général) |
| `tests/heures.test.mjs` | table des heures : rangée de 5 h à 22 h, pas de saut quand l'horloge tourne ni quand la lumière baisse, étalonnage neutre sans effet et toujours dans [0, 1], LUT complète, verts tirés vers le jaune à midi, nuit bleue, pluie éteinte ; zénith bleu par beau temps et pâle sous les nuages, brume des vallées seulement le matin, voile épaissi par le brouillard |
| `tests/horizon.test.mjs` | relief et lumière : horizon plat en plaine, haut du côté d'une colline et bas de l'autre, occlusion au pied d'une colline, normales qui penchent vers l'extérieur |
| `tests/pietinement.test.mjs` | piétinement : rien au repos ni sous un général, un tiers de boue au passage d'un régiment de ligne, plus sous la cavalerie et l'artillerie, double sous la pluie, mêlée sur place |
| `tests/cheval.test.mjs` | cheval précalculé : gestes attendus par le shader, quatre os et des poids qui font 1 par sommet, maillage léger, dos à hauteur de selle |
| `tests/herbe.test.mjs` | herbe en relief : rien en Basse et Moyenne, au plus 60 000 touffes en Haute et 120 000 en Ultra |
| `tests/sols.test.mjs` | sols photo : huit sols, parts de chaque sorte de terrain et de chaque culture (elles font 1, 0 sous l'eau), images et licence présentes, après-rendu et sols qui montent avec la qualité |
| `tests/modeles.test.mjs` | modèles 3D des figurines : os de l'animation, pieds au sol, hauteur, tournés vers l'avant, formes arrondies, version de loin (mêmes os, même hauteur, un tiers des sommets), choix de la version selon la taille à l'écran |

**Essayer une nouvelle fonctionnalité sans jouer.** `tests/fabrique.py` fabrique une situation en une ligne : une
partie (`partie('64', '1870')`), un ou plusieurs mois joués (`jouer_mois(g, 3)`), une bataille déjà engagée avec les
régiments voulus (`bataille(dict(ligne=2, cavalerie=1))`), un ennemi placé à 200 m en vue (`face_a_face`), quelques
secondes de bataille (`avancer(tb, 60)`). Les batailles sont tirées avec une graine fixe : même graine, même
bataille. Les essais n'écrivent pas dans `logs/batailles.jsonl` (`WEB_CONQUETE_NOLOG=1`).

## Sources des données
Animations des soldats : [Universal Animation Library](https://quaternius.com/) 1 et 2 de Quaternius (CC0, domaine
public), retouchées et précalculées sur nos figurines (`web/anims/LICENCE.txt`). Corps des fantassins de près :
[Universal Base Characters](https://quaternius.itch.io/universal-base-characters) de Quaternius (CC0), allégé et
posé sur nos os par `web/js/battle/dev/corps.mjs`.
Contours des départements et des communes : [france-geojson](https://github.com/gregoiredavid/france-geojson) (données IGN, Licence Ouverte).
Population des communes : INSEE via [@etalab/decoupage-administratif](https://github.com/etalab/decoupage-administratif).
Fleuves et lacs : [Natural Earth](https://www.naturalearthdata.com/) (domaine public), complétés à la main pour l'Isle, la Vézère,
la Dronne, les gaves, la Midouze, la Leyre, la Nive et l'estuaire de la Gironde.
