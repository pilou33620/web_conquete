# Spec : toute la France, puis l'Europe

## Pourquoi

Demande du 07/11/2026 : une grosse mise à jour.
1. **Toute la France** : les 96 départements de métropole, chacun jouable (on choisit n'importe lequel au départ).
2. **Plus tard, l'Europe et l'Afrique du Nord**, avec un second mode de jeu par pays (chaque pays et ses villes
   principales). Même étendue géographique qu'un grand jeu de stratégie d'époque, mais d'après la vraie géographie :
   rien n'est repris d'un autre jeu (ni carte, ni découpage, ni noms de régions inventés).

Décisions du joueur : la France d'abord ; deux modes de jeu (« France » par département, « Europe » par pays) ;
l'échelle de l'Europe reste à trancher (France détaillée et reste plus grossier, ou échelle revue pour tout).

## Ce qui suppose aujourd'hui cinq départements

| Où | Quoi |
|---|---|
| `game/geo.py` | `PLAYABLE` (33, 24, 40, 47, 64), bornes de `geo.json` (le Sud-Ouest), forêts, landes et vignobles écrits à la main, routes royales, cache de la carte (cases de 1 km) |
| `game/data/geo.json` | 15 départements (5 jouables et leurs voisins), 23 rivières, 6 étendues d'eau |
| `game/places.py` | ~220 places choisies à la main : chef-lieu, 9 villes, 33 villages par département, populations d'époque, spécialités |
| `game/rules.py`, `game/events.py`, `game/ai.py` | les 5 camps (nom, capitale, couleur, atouts), événements datés par département |
| `game/tactics/*` | terrains de bataille d'après la carte, plans des villes |
| `web/js/hex/modeles.js`, `carte/villes.js`, `carte/terre.js`, `towns.js` | styles de maisons, de toits et de cultures par département (5 pays) |

## Étape 1 : la France entière (mode « France ») — faite le 07/11/2026, branche `claude/france`

- **Données** (`outils/france.py`, sources npm : Highcharts, @etalab, GeoNames `cities.json`, Natural Earth) :
  89 départements de 1790 (la Seine, la Seine-et-Oise, la Corse réunies ; Belfort avec le Haut-Rhin), 1 942 places
  générées (chef-lieu, 7 villes, 16 villages répartis par département ; populations de 1790 pour les grandes villes,
  places fortes de Vauban), 67 rivières nommées (tracées le long des surfaces d'eau de Natural Earth entre des points
  connus de leur cours ; les petites rivières du Sud-Ouest gardées), lacs, pays voisins. Écrit `game/data/geo.json`
  (géographie 3) et `places_france.json` ; le Sud-Ouest d'avant devient `geo_v2.json` (anciennes parties).
- **Carte** (`game/geo.py`, géographie 3) : 1 150 × 1 099 km, cases de 1 km, 2 165 places, 4 382 routes ; relief par
  lignes de crête (Alpes, Pyrénées, Jura, Vosges, Corse) et massifs (Massif central, Préalpes, Armorique, Ardennes…),
  forêts, vignobles, marais (Camargue, Marais poitevin, Brière, Dombes) ; routes royales de poste depuis Paris. Générée
  en 70 s environ au premier démarrage (`map_cache.json`, non versionné). Les géographies 1 et 2 restent identiques.
  `cellnode` passe à deux octets par case (plus de 254 places).
- **Camps** (`game/rules.py`) : les 84 départements de plus sont générés (chef-lieu, couleur, un des cinq profils :
  négoce, forges, grenier, vignoble, montagne) ; familles, armées types, courbes de population par défaut. Une partie
  ne connaît que les camps de sa carte (`geo.playable_codes`).
- **Vitesse** : frontières, forces et revenus gardés un quart de journée : un mois de jeu avec 89 camps prend 8 à 20 s
  sur la machine de développement (40 à 60 s avant). Puis l'IA des camps lointains allégée (ci-dessous) : 2 à 4,5 s en
  début de partie, 6 à 8 s après deux ans.
- **Page** : liste déroulante des départements et fiche du choisi (ou toucher une ville) ; styles de maisons de douze
  grandes régions ; plateau bâti par blocs de 16 × 16 hexagones autour de la caméra (90 blocs, 260 places au plus) ;
  territoires sans lissage ni peinture des tuiles sur le plateau.

Reste à faire : vérifier la fluidité sur iPad et le temps d'un mois sur le Raspberry Pi lui-même. (Les places isolées :
faites le 09/11/2026, ci-dessous.)

### Événements et textes des autres régions — faits le 08/11/2026

Tout est dans `game/regions.py` (données seules), branché par quelques lignes sur `rules.py`, `events.py`, `geo.py`,
`engine.py` et `views.py`. Les parties du Sud-Ouest (géographie 2) restent identiques : aucun événement régional ne
vise les cinq départements écrits à la main, les imprévus régionaux ne jouent qu'en géographie 3.

- **Événements datés** : 120 de plus, au même format et de la même force que ceux d'avant (`HIST`, `who` = les
  départements touchés). Par région : Paris et Île-de-France 9, Nord et Artois 8, Picardie 3 (et le sucre de
  betterave, qui touche aussi le Nord), Normandie 4, Bretagne 6, Pays de la Loire 6, Poitou-Charentes 5, Centre 5,
  Bourgogne 6, Champagne et Ardennes 7, Lorraine 6, Alsace 6, Franche-Comté 5, Lyonnais, Forez et Bresse 6, Auvergne
  et Limousin 6, Languedoc, Rouergue et Roussillon 9, Provence et comté de Nice 9, Dauphiné 3 (et le retour de l'île
  d'Elbe), Savoie 5, Corse 5, frontière du Nord-Est en 1815 1. Thèmes laissés à la branche « religion et révoltes » :
  Camisards, protestants, chouannerie, Vendée, jacqueries, canuts, Commune, bandits (aucun ici).
- **Dates** : jour exact quand il est connu ; sinon le mois ou l'année seuls sont sûrs, et le texte dit « vers » ou
  l'année (Compagnie des Indes à Lorient 1719, haras du Pin 1730, Saumur 1763, Hennessy 1765, kaolin 1768, canal du
  Centre 1792, Peugeot 1810, Schneider 1836, bassin de Saint-Nazaire 1856, Bollée 1873…).
- **Imprévus selon le pays** (`RANDOM`) : deux ou trois par profil (forges, grenier, vignoble, montagne, négoce) et
  trois pour les départements côtiers (`COTE`). Le Sud-Ouest y prend part en partie de toute la France
  (`PROFIL_SO`), pas dans les siennes.
- **Grands événements nationaux** : hors Sud-Ouest, le Grand Hiver, la guerre de Sept Ans, l'Amérique et les
  Cent-Jours ne parlent plus de Bordeaux ni de la Garonne (`TEXTES`) ; le 4 mars 1790 et les époques ont un texte de
  toute la France (`DEPT_1790`, `ERES`).
- **Camps** : un titre et un premier atout propres à chacun des 84 départements générés (« Lille et les Houillères de
  Flandre », « Houillères d'Anzin : +35 % de fer ») ; le chiffre reste celui du profil. Décision : sept départements
  tirés au hasard en vignoble ou en négoce deviennent des greniers (Beauce, Champagne berrichonne, Vexin normand,
  Perche, Bas-Maine, Haute-Saône, Bresse). Avant 1790, les camps portent le nom de leur province (Flandre et Hainaut,
  Beauce, Bourbonnais, Comtat Venaissin…) ; la fiche d'une place dit « Chef-lieu du Nord » ou « de la Flandre ».
- **Spécialités** : 384 places des départements générés ont une spécialité phare (chaque chef-lieu et 2 à 6 villes,
  types existants de `rules.SPECIALTY`) : soieries de Lyon, houillères d'Anzin, Champagne de Reims, faïences de
  Quimper, arsenal de Toulon…
- **Interface** : titre de la page, conseil du marché (« prenez un port de mer ou de rivière »), aide et tutoriel
  sur les fleuves ne parlent plus de l'Aquitaine en partie de toute la France.
- **Anciennes sauvegardes** : un événement ajouté dont la date est passée est noté comme fait au chargement
  (`views.migrate`) : il ne se déclenche pas d'un coup.
- Non fait : la crue de printemps (Garonne et Dordogne seules) et les noms des eaux de la carte relèvent des voies
  navigables et des côtes.

### Voies navigables et côtes — faites le 08/11/2026

- `game/waterways.py` (géographie 3 seulement ; les géographies 1 et 2 gardent leurs voies d'eau à l'octet près, banc
  `tests/test_voies_eau.py`) : 27 rivières navigables de plus (tête de navigation d'époque, un point de geo.json d'où
  la rivière porte bateau jusqu'à l'aval), la Garonne dès Toulouse, 12 canaux, 4 routes de cabotage (Ponant, Levant,
  Corse, traversée Calvi – Antibes) et plus de 70 ports de mer.
- **Décisions** : un canal est daté (`year` sur ses arêtes) : `engine.road_route` ne s'y engage pas avant son
  ouverture et la carte ne le dessine qu'ensuite. Ses quais du milieu ne comptent comme quais de commerce que s'il est
  ouvert en 1700 (Midi, Briare, Orléans) : sinon les places resteraient « port » avant le canal. Le canal de Briare et
  celui du Loing (1723) ne font qu'un, daté de 1642 (le Loing se naviguait déjà). Pas de courant sur un canal.
- Les tracés en mer (routes plutôt à 2,5 – 6 km des côtes, chenal de chaque port, embouchures) sont calculés une fois
  sur la grille (`outils/voies_eau.py`, plus court chemin pondéré, simplifié sans quitter l'eau) et rangés dans
  `game/data/voies_france.json` : rien à calculer au démarrage. À relancer si la côte ou les places changent.
- Dunkerque, Cherbourg, Saint-Tropez, Briare, Digoin manquent aux places générées : des places voisines en tiennent
  lieu (Coudekerque-Branche, Fermanville, Sainte-Maxime, Gien, La Motte-Saint-Jean). Morlaix, Hyères, Fréjus et
  Propriano sont à plus de 5 km de la mer sur la grille : leur chenal passe sur la terre (côte grossière).
- Rendu : gabares sur toutes les rivières navigables (et non plus sur toutes les grandes rivières), navires sur toutes
  les routes du cabotage, ancres des quais. Le plateau 3D comme la carte en tuiles ne dessinent
  un canal qu'à partir de son année d'ouverture (au chargement d'une partie de 1790, 1813 ou 1870 comme quand l'année
  avance) : voir SPEC-HEX, « Canaux datés ».
- Coût mesuré (même machine, même moment) : 7 386 → 7 871 arêtes (58 → 543 voies d'eau), 57 → 505 quais ; bâtir les
  voies d'eau prend 0,15 s au lieu de 0,45 s (les places sont d'abord filtrées par case) ; carte envoyée au navigateur
  +0,2 Mo (14,7 Mo) ; un mois de jeu à 89 camps 10,3 s → 11,1 s environ (bruit compris).

### IA allégée des camps lointains — faite le 08/11/2026

Le Raspberry Pi est 3 à 5 fois plus lent que la machine de développement : il fallait diviser par 3 au moins le temps
d'un mois en France, sans changer le Sud-Ouest. Décisions (prises seul, le joueur absent) :

- **Camp lointain** (`Game.ia_lointaine`) : ni en guerre ni allié avec le joueur, sans frontière commune avec lui,
  chef-lieu à plus de 200 km du sien ; réévalué chaque quart de journée. Depuis la Gironde, 75 camps sur 89. Jamais dans
  le Sud-Ouest (5 camps). Le camp du joueur, ses voisins, ses ennemis et ses alliés gardent l'IA complète.
- **Il réfléchit tous les 6 jours** (`AI_PAS_LOIN`) au lieu de 1,5 ; une guerre ou une frontière avec le joueur le
  réveille dans le quart de journée. Sa diplomatie revient tous les 4 à 9 jours au lieu de 8 à 13 (relations et
  déclarations de guerre au même rythme qu'avant, puisqu'il ne la fait qu'à ses réflexions) ; ses demandes de droit de
  passage tous les 45 jours (au lieu de 15), deux recherches de chemin au plus ; ses revenus refaits un jour sur deux.
- **Batailles entre camps lointains** : le tour des IA ne passe plus à petits pas (0,05 jour) pour elles, seulement pour
  une bataille du joueur ou d'un camp proche (`Game.bataille_proche`) ; il y en avait presque toujours une quelque part
  en France, ce qui doublait le nombre de pas de tout le mois.
- **Toute la France (89 camps), pour tous** : trésors par quarts de jour, milice et ordre public par demi-journées,
  usure et ravitaillement des armées par demi-journées, forces des camps gardées deux jours, réseau des places ouvertes
  à chaque camp gardé un quart de journée (et bâti à partir de celui des places neutres, commun à tous) ; premières
  réflexions décalées dans le pas de chaque camp (elles s'étalaient sur trois semaines).
- **Calculs exacts, partout** (mêmes résultats) : places de chaque camp (`owned_nodes`) gardées jusqu'au prochain
  changement de maître (`_own_ver`, à augmenter là où l'on change `n['owner']`) ; rencontres d'armées par balayage
  au lieu de toutes les paires ; plus proche place par carrés de 20 km ; cibles et point de ralliement par carrés de
  40 à 50 km ; défense des places jugée seulement pour les cibles les mieux classées ; masque des terres fermées fait
  seulement quand il sert ; demandes de passage vers une place qu'aucune route ne relie au reste (îles, vallées des
  Pyrénées et des Alpes) écartées sans recherche dans toute la carte ; routes coupées par la crue calculées autour
  de la Garonne et de la Dordogne seulement (7 s à la première crue, 1,6 s).

Mesures (`outils/banc_france.py`, Gironde, camp du joueur joué par une IA ; temps de calcul du processus, avant et après
lancés en même temps sur la machine de développement, chargée par d'autres calculs) :

| | avant | après |
|---|---|---|
| 1790, mois 1 à 3 | 7,2 / 13,2 / 18,8 s | 2,2 / 3,5 / 4,3 s (÷ 4) |
| 1700, mois 1 à 3 | 8,9 / 12,4 / 16,6 s | 3,2 / 3,3 / 3,2 s (÷ 4) |
| 1790, après 2 ans (mois 25 à 27) | 39,8 / 31,9 / 32,5 s | 7,8 / 6,3 / 6,1 s (÷ 5) |

Le monde lointain reste vivant : après deux ans, autant de places prises (2 598 avant, 2 622 après), plus de batailles
(victoires et défaites des camps : 190 avant, 296 après), la même médiane de places par camp (39). Le Sud-Ouest est
inchangé : `outils/simuler.py --parties 2 --epoque 1790 --annees 10 --graine 1 --proc 2` donne exactement les mêmes résultats.
Test : `tests/test_france.py` (un camp lointain réfléchit une fois par semaine et rallie ses villages, un voisin garde
le pas complet, la guerre réveille le lointain).

### Places isolées et anciennes sauvegardes — faites le 09/11/2026

**Cause** : une route ne naissait (graphe de Gabriel, puis `_relier` pour raccorder les morceaux) que si la *ligne
droite* entre deux places passait le test `_water_on_segment` : moins d'une « faute », chaque échantillon de 0,4 km en
eau ou hors de France comptant 1 et chaque échantillon de haute montagne (`T_HAUTE`) 0,25. Plus de 1,6 km de haute
montagne sur la ligne droite suffisait donc à refuser la route : toute la Haute-Savoie (aucune de ses places reliée à une
autre, les crêtes des Alpes couvrent le département), la Tarentaise, la Maurienne, le Briançonnais, l'Ubaye, la Vésubie,
la Roya, les vallées des Pyrénées (Aspe, Ossau, Lavedan, Luchon, Cerdagne, Conflent…), le pays de Gex derrière le
Jura. Ailleurs, la côte et la frontière de la grille au km sont grossières : un bourg du rivage (Flamanville,
Jullouville, Cap-d'Ail, Cayeux…) ou de la frontière (Givet, Wissembourg, Crespin, Boeschepe, Châtel) tombe dans une case
de mer ou d'étranger, et la ligne droite vers ses voisins aussi. Enfin les îles sans port du cabotage (Groix, Ars-en-Ré,
le sud d'Oléron) n'avaient rien. 159 places hors du grand réseau des routes, 97 même avec les voies d'eau.

**Correction** (`geo._relier`, géographie 3 seulement) : pour raccorder un morceau, on essaie ses places voisines de la
plus proche à la plus lointaine (60 km au plus) : en ligne droite comme avant, sinon **par la terre** (`_par_terre` :
plus court chemin sur la grille, haute montagne comptée double, montagne 1,4, marais 1,5, une case de rivière ou de lac
6 — un pont ou un bac —, deux cases au plus de mer ou d'étranger comptées 4 et 3 — la côte et la frontière grossières ;
refusé au-delà de 2,5 fois la ligne droite, comme le tour d'une baie ou d'un lac). La route de terre a pour longueur ce
chemin (× 1,05) : un chemin de montagne est donc environ deux fois plus long que la ligne droite (Barcelonnette –
Embrun : 23 km à vol d'oiseau, 46 km de route ; Modane – Saint-Michel-de-Maurienne 15 → 31 km), sans autre règle. Sans
chemin de terre, **un bac** de moins de 20 km vers la place la plus proche (même règle que le bac de Blaye : traversée
lente, rivière « Mer » pour le dessin). Résultat : 129 routes de plus, 17 de moins (l'élagage des détours a changé
autour), 7 328 → 7 440 routes. Toutes les places rejoignent Paris par la route, sauf la Corse (43 places, reliée par
le cabotage comme avant) et l'île d'Yeu (à plus de 20 km de la côte ; port du cabotage). La route royale d'Espagne par
le Somport monte désormais jusqu'à Urdos.

Bacs créés : Ré (La Rochelle – La Flotte, La Flotte – Ars-en-Ré), Oléron (La Tremblade – Saint-Trojan), Belle-Île
(Le Palais – Saint-Pierre-Quiberon), Noirmoutier (Pornic), Groix (Lorient), Soulac – Royan (la pointe de Grave),
Saint-Malo – Saint-Briac (la Rance), Camaret – Lanvéoc, Saint-Pierre-Quiberon – Locmariaquer, Berck – Fort-Mahon
(l'Authie), et deux bacs dus à la côte grossière (Guérande – Piriac, Notre-Dame-de-Monts – Saint-Urbain) ; ces deux-là
et trois autres faux bacs sont devenus des routes le 09/11/2026 (voir « Bacs de la côte grossière »). Décision :
ces bacs sont des routes (`ferry`), pas des voies d'eau : il aurait fallu recalculer les tracés en mer
(`outils/voies_eau.py`) pour des îles sans port ; et aucune place n'est retirée des cibles des IA.

**Anciennes sauvegardes** (`views.recaler`) : une sauvegarde désigne des arêtes par leur numéro à trois endroits, tous
dans les armées : `a['edge']` (l'arête où elle se trouve, `e`, `frm`, `pos`), les étapes de son chemin `a['path']`
(`kind='road'` : `e`, `frm`, `to`, `pos`) et le chemin mis de côté devant une place `a['ask']['path']`. Le reste est
ailleurs : places par leur numéro (garnisons, sièges, bandes, batailles, blocus, voies ferrées `g.rails` par paires de
villes « a-b », dont les arêtes sont recalculées sur la carte), routes coupées par la crue recalculées (`crue.spans`).
Les numéros des places ne changent pas (mêmes 3 555 places, même ordre : rien n'a été ajouté). La sauvegarde garde
désormais `graphe`, l'empreinte de la numérotation des arêtes (`geo.empreinte` : les deux bouts et la voie de chaque
arête) ; si elle manque ou diffère au chargement : une armée sur une arête retrouve, parmi les arêtes de sa place de
départ et du même genre (voie d'eau en bateau, route sinon), celle qui passe à moins de 1,5 km de sa position ; sinon
elle revient à sa place de départ (un quai pour un bateau ; dans une bataille, elle reste où elle se bat, hors des
routes). Chaque étape d'un chemin se retrouve par ses deux bouts s'il n'y a qu'une arête entre eux (route *ou* voie
d'eau : sinon on ne sait laquelle) ; sinon le chemin est recalculé vers la destination (`Game.reroute`), ou l'armée
s'arrête. Une partie sauvegardée avec l'ancienne carte (`banc_france.py --sauve`, 94 armées dont 4 sur une route et 7
en marche) se recharge et joue un mois.

Tests (`tests/test_france.py`) : toutes les places de la géographie 3 rejoignent Paris (par la route, sauf la Corse et
Yeu, et toutes avec les voies d'eau) ; les géographies 1 et 2 inchangées (empreinte des routes, voies d'eau, places et
zones calculée avant) ; une sauvegarde aux arêtes renumérotées, avec une armée en marche sur la route, une en bateau sur
la côte du Ponant et une dont l'arête a disparu, se recharge (mêmes arêtes, mêmes positions, même destination ; la
dernière revenue à sa place, chemin recalculé) et joue un mois.

Coût : carte envoyée au navigateur 14,67 → 14,70 Mo (1,892 → 1,898 Mo compressée) ; la carte se recalcule une fois
(`map_cache.json`, 75 s environ sur la machine de développement chargée ; les géographies 1 et 2 aussi, identiques) ;
le chargement d'une sauvegarde à recaler prend moins d'un dixième de seconde. Mois de jeu (`banc_france.py --epoque
1790 --mois 3`, avant et après lancés ensemble) : 2,7 / 3,9 / 5,8 s avant, 2,6 / 4,3 / 6,0 s après (moyenne 4,1 → 4,3 s, dans
le bruit de la machine partagée) ; 1 694 places changées de main avant, 1 714 après.

### Bacs de la côte grossière, routes de montagne et canaux vus dans le navigateur — faits le 09/11/2026

**Bacs.** Sur la grille au km, la côte est très simplifiée (178 points pour toute la Loire-Atlantique) : Piriac,
Notre-Dame-de-Monts, Camaret, Saint-Malo, Soulac, Fort-Mahon tombent 4 à 9 km en mer, la presqu'île de Quiberon perd
son isthme et l'île de Ré n'existe presque pas. Aucun critère tiré de la grille ne sépare ces bourgs d'une vraie île
(Piriac est à 6 cases de mer de la côte, Groix à 8, Camaret à 9) : **décision**, une table `geo.ROUTES_COTE_3` des
routes que la côte refuse, posées avant de relier les morceaux (`_relier`), et des vrais bacs que ces routes auraient
remplacés (`_relier` ne fait qu'un lien par morceau), posés après. Chaque bac de la géographie 3, vérifié sur la carte
réelle :

| Bac (avant) | Bras de mer ? | Après |
|---|---|---|
| Blaye – Fort Médoc | oui, la Gironde (géographie 1) | gardé |
| Soulac – Royan | oui, la pointe de Grave | gardé ; Soulac a aussi la route de Lesparre (royale, comme dans le Sud-Ouest) |
| La Rochelle – La Flotte | oui, le pertuis Breton (Ré) | gardé |
| Ars-en-Ré – La Flotte | non, la même île (isthme du Martray) | route |
| La Tremblade – Saint-Trojan | oui, Maumusson (Oléron) | gardé |
| Camaret – Lanvéoc | non, la même presqu'île de Crozon | route |
| Saint-Malo – Saint-Briac | oui, la Rance | gardé ; Saint-Malo a aussi la route de Cancale (il n'avait que le bac) |
| Pornic – Noirmoutier | oui, la baie de Bourgneuf | gardé |
| Guérande – Piriac | non | route |
| Lorient – Groix | oui | gardé |
| Le Palais – Saint-Pierre-Quiberon | oui (Belle-Île) | gardé |
| Saint-Pierre-Quiberon – Locmariaquer | non : la presqu'île tient à la terre par l'isthme de Penthièvre | route Saint-Pierre-Quiberon – Étel |
| Berck – Fort-Mahon | oui, la baie d'Authie | gardé ; Fort-Mahon a aussi la route de Rue |
| Notre-Dame-de-Monts – Saint-Urbain | non | route |

14 bacs avant, 9 après ; 7 983 → 7 986 arêtes, 5 bacs devenus routes, 3 routes ajoutées (Saint-Malo – Cancale,
Soulac – Lesparre, Fort-Mahon – Rue), rien d'autre ne change. Camaret – Lanvéoc et Locmariaquer étaient donnés pour vrais :
ils ne traversent pourtant aucun bras de mer qu'une route ne contourne. Test : `test_bacs_des_vrais_bras_de_mer_seulement`
(la liste exacte des bacs, et les routes de terre de Piriac, Notre-Dame-de-Monts, Ré, Camaret, Quiberon). Une sauvegarde
d'avant ces routes se recharge (`views.recaler`, banc de la section précédente et `test_ancienne_sauvegarde_aux_aretes_renumerotees`).

**Vu dans le navigateur** (Playwright, Chromium avec WebGL logiciel ; captures dans
`/tmp/claude-0/-home-user-web-conquete/9d37804e-26e6-5a03-b5de-d55815175cd9/scratchpad/verifs/`, `apres/` après les
corrections) :

- Routes de montagne : la Maurienne (Saint-Michel – Modane), la vallée d'Aspe (Oloron – Accous – Urdos, route royale le
  long du gave) se dessinent sur le plateau et sur la carte en tuiles. Mais sur le plateau, **les cônes des sommets
  cachaient les routes** de haute montagne : Barcelonnette – Embrun et les routes du pays de Gex étaient invisibles
  (`gl-Barcelonnette_Embrun-z14.png`, `gl-Divonne-les-Bains-z20.png`). Correction (`hex/plateau.js`) : comme les
  vallées des rivières, un hexagone de montagne ou de haute montagne qu'une route traverse est mis à plat (collines) ;
  les routes paraissent au fond de leurs vallées (`apres/gl-Divonne-les-Bains-z20.png`, `apres/gl-Modane-z12.png`).
  Le tracé d'une route de montagne reste celui de la grille : Barcelonnette – Embrun compte 46 km (le chemin par la
  terre, `_par_terre`) mais se dessine presque droit, la grille ne connaissant pas la vallée de l'Ubaye.
- Bacs : le plateau ne dessinait rien sur l'eau (la route s'arrêtait au rivage) : **trait manquant**. Correction : la
  traversée en tirets bruns à fleur d'eau (`apres/gl-La_Rochelle_La_Flotte-z18.png`, Oléron, Soulac – Royan,
  Blaye). Carte en tuiles : les tirets étaient à l'échelle de la route (2 à 3 px, on aurait dit un trait plein) ; ils
  font désormais au moins 6 px, sombres, sans liseré (`apres/tuiles-La_Rochelle_La_Flotte-z18.png`).
- Le plateau dessinait aussi **les voies d'eau comme des routes** (ruban de route le long des rivières navigables et
  des canaux, même avant l'ouverture d'un canal, par exemple le long de la Sèvre à Marans) : `Plateau.routes` les saute
  désormais (les rivières et les canaux ont leur filet d'eau).
- Pas corrigé : l'île de Ré et une partie d'Oléron sont de la mer sur le plateau (côte de la grille) ; la route
  Ars-en-Ré – La Flotte ne s'y voit donc pas (elle se voit sur la carte en tuiles), comme le bout en mer des routes
  des bourgs tombés en mer (Piriac, Soulac…).

**Un canal qui ouvre en cours de partie** (`verifs/canal.cjs`) : partie de Saône-et-Loire commencée en 1790, jouée
par le serveur tour après tour (`tour`/`go`, batailles en « Automatique », chaque décision réglée par la commande
`event`), la page ouverte. Jouée en vrai, la partie est perdue en avril 1791 (le camp du joueur, sans personne pour
le défendre, est rayé de la carte ; six décisions réglées, aucune erreur) : le plateau de 1790 n'a pas le canal du
Centre (`canal-avant-1790.png`). La partie a donc été avancée côté serveur jusqu'au 1er décembre 1792
(`outils/banc_france.py --joueur 71 --avant 32 --mois 1 --sauve saves/canal-1792.json`, le camp joué par une IA),
rechargée dans le serveur (`/api/load`), puis décembre 1792 joué par « Tour suivant » : au 1er décembre, pas de canal
(`canal-avant.png`) ; au 1er janvier 1793, l'état reçu par la page change d'année et le canal paraît sans recharger
(`canal-apres.png`, Paray-le-Monial – Montceau – Écuisses – Chalon) ; page rechargée, il y est encore
(`canal-recharge.png`). Aucune erreur de console. Rien à corriger dans `majCanaux` ; mais avant la correction des voies
d'eau ci-dessus, un ruban de route aurait suivi le tracé du canal dès 1790.

### Guerres entre les IA — faites le 09/11/2026

Constat : après la course aux villages neutres, la France à 89 camps restait presque en paix (en 1790, 1 à 7 guerres
en cours, 70 places prises d'un camp à l'autre en trois ans ; en 1700, 8 guerres en cours en moyenne), et les trésors
des IA montaient sans fin (1790 : médiane 240 000 livres, le plus riche 480 000 après deux ans et demi), alors que le
Sud-Ouest (5 camps) est équilibré.

**Cause** (banc instrumenté : pour chaque camp et chaque voisin, la condition de `AI.diplomacy` qui empêche la guerre) :
les **accords de commerce**. Une IA propose un accord à tout camp qu'elle aime un peu (relation > 5), voisin ou non ;
dans le Sud-Ouest, cela fait au plus quatre partenaires, en France plus de 55 par camp. Or chaque accord rapporte 6 %
du revenu brut du partenaire et +1,5 de relation à chaque diplomatie : le revenu était décuplé (580 livres par jour
au lieu de 65 de revenu brut), et les relations entre voisins restaient vers +5 à +8, loin des −20 qu'il faut à une
IA pour attaquer un voisin à peine moins fort. La guerre n'était donc déclarée qu'au hasard des écarts de forces
(rapport 1,7), et l'argent qui ne trouvait plus d'emploi s'entassait. Ni la lassitude (médiane 0), ni les trêves, ni
les alliances, ni le nombre de voisins (5 à 6 en moyenne) ne bloquaient. L'IA allégée des camps lointains n'y est
pour rien : sa diplomatie revient à peu près aussi souvent (tous les 10 jours environ contre 11) et, sans elle, le
banc donne autant de guerres (5 en moyenne la première année, 14 la deuxième, contre 5,5 et 14).

**Correction** (décision prise seul) : **quatre accords de commerce au plus par camp** (`R.TRADE_MAX`, autant qu'il y a
d'autres camps dans le Sud-Ouest, où rien ne change donc). Un cinquième accord est refusé, au joueur comme aux IA
(« … a déjà 4 accords commerciaux ») ; une IA n'en propose plus au-delà. Les parties de toute la France d'avant cette
règle : au chargement (`views.migrate`), chaque camp, le joueur d'abord, perd ses accords en trop, sans brouille ; il
garde ceux des camps qu'il aime le plus, et une IA ne rompt jamais celui du joueur. Les voisins sans accord se brouillent (relation médiane −35 à −40 au bout de deux ans) et se font la guerre ; le
revenu redevient celui du pays, dépensé en régiments, remparts et constructions.

Mesures (`outils/banc_france.py`, Gironde jouée par une IA, graine 1 ; « prises » : places passées d'un camp à un
autre, comptées d'une fin de mois à la suivante ; avant et après lancés en même temps, machine partagée) :

| | 1790 avant | 1790 après | 1700 avant | 1700 après |
|---|---|---|---|---|
| guerres en cours, moyenne des mois 1-12 / 13-24 / 25-36 | 2,4 / 4,6 / 3,0 | 5,5 / 14,3 / 11,3 | 6,2 / 7,9 / 7,8 | 6,1 / 20,6 / 9,4 |
| places prises d'un camp à l'autre en 3 ans | 70 | 385 | 240 | 379 |
| chefs-lieux tombés (traités) en 3 ans | 7 | 15 | 18 | 10 |
| camps en vie après 3 ans | 89 | 89 | 89 | 89 |
| trésor médian / le plus riche après 3 ans (livres) | 295 000 / 559 000 | 2 150 / 30 000 | 99 500 / 324 000 | 6 300 / 33 000 |
| régiments (médiane) après 3 ans | 88 | 30 | 55 | 31 |
| temps d'un mois, mois 25 à 36 | 8,5 s | 5,6 s | 6,8 s | 5,4 s |

En 1700, les IA d'avant, riches et près de deux fois mieux armées, prenaient davantage de chefs-lieux (18 contre 10),
mais moins de places en tout (240 contre 379) ; après, les guerres sont plus nombreuses et plus disputées. Le mois est plus court : moins de régiments à faire marcher et à nourrir.

Sur sept ans (1790, après) : 12 guerres en cours en moyenne après la première année, un peu plus de 1 000 places prises, un chef-lieu
qui tombe par mois environ (69 traités) ; le premier camp disparaît au bout de 5 ans et demi (88 en vie), un deuxième
à 6 ans et demi, absorbé par un voisin qui passe de 85 à 132 places ; le plus petit tombe à 3 places, puis se relève à 11. La
paix d'un traité (cinq ans de trêve) et la règle des deux défaites en 25 ans font que les camps disparaissent
lentement : c'est voulu (règles d'avant, communes au Sud-Ouest ; revu le jour même, voir « Guerres décisives et
armées actives »).

Sud-Ouest inchangé : `outils/simuler.py --parties 2 --epoque 1790 --annees 10 --graine 1 --proc 2` donne exactement
les mêmes résultats (7,5 guerres en 10 ans, trésor 28 622, 13 069 hommes). Test : `tests/test_france.py`
(`test_les_ia_se_font_la_guerre` : chacun tenant son département, un an de diplomatie seule mène à des guerres, les
voisins se brouillent, quatre accords au plus, une ancienne partie ramenée à quatre accords).

### Guerres décisives et armées actives — faites le 09/11/2026

**Constat** (`outils/banc_guerres.py --geo 3 --epoque 1790 --mois 84`, code d'avant `27d9b16`, Gironde jouée par une
IA) : sept ans de guerres (11 en cours en moyenne, 923 places prises d'un camp à l'autre, 50 traités) et **aucun camp
disparu**. Les vaincus gardent 12 à 82 places à la chute de leur chef-lieu (médiane 31) : la guerre se résume à un
coup de main sur un chef-lieu tout proche de la frontière, suivi d'un traité qui ne coûte que les places occupées et
protège le vaincu cinq ans. La règle du camp « écrasé » (un quart de ses places de départ) ne compte que le chef-lieu
et les villes (3 à 8 places), soit 3 places en pratique, alors que chaque camp en tient une quarantaine après la course
aux villages ; la deuxième défaite face au même vainqueur en 25 ans n'arrive presque jamais avec cinq ans de trêve.
**Armées** : 78 % de la puissance des armées des camps en guerre reste au repos après une réflexion de son IA, à 89 %
pour garder une place menacée, le plus souvent plus forte que la menace (dans le Sud-Ouest, 1700, graines 1 à 4, dix
ans : 51 à 65 %, à 95 % pour garder). Cause (`AI.army_think`) : une place est menacée quand les armées ennemies à moins
de 30 km dépassent 0,8 fois sa défense propre, et l'armée qui s'y trouve y reste tant que dure la menace, quel que soit
le rapport de forces. Or cette armée ennemie est le plus souvent au repos dans sa propre place voisine, qu'elle garde
pour la même raison : deux armées se regardent d'une ville à l'autre toute la guerre.

**Décisions** (prises seul, le joueur absent) :

- **Armée sur une place menacée** : (toute la France seulement, voir plus bas) elle frappe la plus forte des armées ennemies à moins de 30 km qu'elle bat
  nettement (`AI.frapper` : 1,3 fois la puissance des armées ennemies à moins de 8 km de celle-ci, ou la défense de la
  place où elle se retranche, garnison, remparts et armées compris) ; sinon, devant une menace écrasante (2,5 fois la
  défense de la place, armée comprise ; jamais au chef-lieu), elle se replie vers la ville la plus proche ; sinon, elle
  n'y laisse que ce qu'il faut pour que la place tienne (`AI.detacher` : une défense d'une fois et demie la menace,
  remparts comptés) et lance le reste, s'il pèse au moins le tiers de l'armée, vers la meilleure cible à sa portée
  (sans cible, le détachement rentre dans le rang). Pas de suicide : ni attaque sans 1,3 fois l'adversaire, ni place
  vidée sous la menace.
- **Écrasé** : un camp dont le chef-lieu tombe est absorbé s'il ne tient plus que le quart du **plus de places qu'il a
  tenues** (`pic`, relevé chaque mois ; une ancienne sauvegarde le reprend au premier mois), de ses places de départ, ou
  3 places. Partout.
- **Toute la France (plus de cinq camps)** : la trêve d'un traité dure de deux à cinq ans, d'autant moins que le vaincu
  garde peu de places face à son vainqueur (cinq ans à la moitié, deux ans au cinquième et en dessous : la paix d'un
  faible ne dure pas) ; un camp qui plie une deuxième fois en 25 ans est absorbé **quel que soit le vainqueur** s'il a
  perdu le quart de ce qu'il a tenu au plus fort (deux défaites et un pays entamé : il n'a plus de quoi se relever). Le
  Sud-Ouest garde ses cinq ans et la règle du même vainqueur : avec quatre voisins seulement, les mêmes règles y
  faisaient tomber les guerres de 40 % et les camps en vie à 2,5 (voir `tasks/equilibre-reference.md`).
- Essayés et écartés : ne plus compter comme menace une armée ennemie retranchée chez elle (sauf autour du chef-lieu) :
  toutes les armées partaient à l'offensive, la France prenait trois fois plus de places, mais le Sud-Ouest devenait bien
  trop décisif (1700 : écart de places +42 %, 2,4 camps en vie, deux parties sur douze finies avec un seul camp) ;
  détacher dès que la place tient (une fois la menace, un quart de l'armée) : Sud-Ouest 1700, 2,2 camps en vie ; la
  deuxième défaite face à n'importe quel vainqueur sans condition : 28 camps disparus en six ans et demi en France,
  dont des camps de 70 à 95 places absorbés d'un coup ; avec la condition de la moitié de ce qu'il a tenu, 3 camps en cinq
  ans seulement.

**Mesures en France** (Gironde jouée par une IA, graine 1 ; banc des guerres, 84 mois depuis 1790, `27d9b16` puis
`854dbd2` ; le temps est le temps de calcul du processus, machine partagée et chargée différemment) :

| 1790 | avant | après |
|---|---|---|
| camps disparus après 1 / 2 / 3 / 4 / 5 / 6 / 7 ans | 0 / 0 / 0 / 0 / 0 / 0 / 0 | 0 / 1 / 3 / 4 / 8 / 15 / 24 |
| places prises d'un camp à l'autre après 3 / 7 ans | 491 / 923 | 884 / 2 259 |
| chefs-lieux tombés en 7 ans (traités + absorptions) | 50 + 0 | 73 + 24 |
| guerres en cours (moyenne des fins de mois sur 7 ans) | 10,9 | 8,9 |
| plus petit / plus grand camp après 7 ans (places) | 17 / 100 | 13 / 133 |
| armées des camps en guerre au repos après une réflexion | 78 % (garde : 89 %) | 41 % (garde : 44 %, sans cible : 48 %) |
| temps d'un mois (moyenne sur 7 ans) | 5,5 s | 6,2 s |

Pas d'effondrement en chaîne : les disparitions viennent au rythme de quelques-unes par an à partir de la troisième
année (1, 2, 1, 4, 7, 9), et le plus grand camp tient 133 places sur 3 555 après sept ans. Ce qui retient encore les
armées au repos : rien à prendre à leur portée qu'elles battent (48 %), ou garder une place devant une menace qu'elles
ne battent pas et qui ne laisse rien à détacher.

`outils/banc_france.py --mois 36` (trois ans ; avant et après lancés à des moments différents) :

| | 1790 avant | 1790 après | 1700 avant | 1700 après |
|---|---|---|---|---|
| camps en vie (disparus) | 89 (0) | 86 (3) | 89 (0) | 83 (6) |
| guerres en cours à la fin (vues en trois ans) | 9 (79) | 10 (84) | 16 (80) | 7 (86) |
| places prises d'un camp à l'autre | 491 | 884 | 454 | 892 |
| temps d'un mois (moyenne) | 5,64 s | 5,75 s | 5,91 s | 5,98 s |

Depuis 1700, 33 % de la puissance des armées des camps en guerre reste au repos après une réflexion (banc des
guerres, trois ans).

Sud-Ouest (`outils/simuler.py`, `tasks/equilibre-reference.md`) : 1700, 12 parties : guerres 17,0 → 12,9 (−24 %),
durée 3,4 → 2,8 mois, écart de places 101 → 115, camps en vie 3,3 → 3,2, trésor et hommes à ±4 % ; 1790, 24 parties :
guerres 13,9 → 12,2, durée 3,4 → 2,3 mois (−32 % : les chefs-lieux tombent plus tôt, c'est l'effet voulu), écart 108 →
130 (+20 %), camps en vie 3,35 → 2,95, trésor et hommes −5 %. Aucune partie ne finit avec un seul camp. Armées au repos
dans le Sud-Ouest (1700, graines 1 à 4) : 65 / 59 / 51 / 65 % avant, 45 / 40 / 1 / 15 % après.

**Revu le jour même : pas de frappe dans le Sud-Ouest.** La durée des guerres de 1790 y était hors de la tolérance
(−32 %). Instrumentées (graines 1 à 12), les guerres n'y finissent pas plus vite à la chute d'un chef-lieu (un mois
après la déclaration, avant comme après) : ce sont les impasses de quatre à neuf mois, closes par une paix proposée
(83 avant, 59 après), qui se dénouaient en un ou deux mois par la chute d'un chef-lieu proche de la frontière. La
frappe en est la cause : sans elle, durée 2,8 mois sur ces douze parties ; sans repli ni détachement, ou sans le quart
du plus de places tenues, toujours 2,3 à 2,4 ; frapper à 1,6 ou à 2,5 fois l'adversaire, 2,3 et 2,6 ; après trois mois
de guerre seulement, 2,7 sur 24 parties, mais un écart de places à +31 % en 1700. Dans le Sud-Ouest (cinq camps au plus), une armée sur une
place menacée ne frappe donc plus : elle se replie ou détache son surplus. Toute la France garde la frappe (rien n'y
change). Mesures : `tasks/equilibre-reference.md` ; armées au repos dans le Sud-Ouest (1700, graines 1 à 4) : 31 / 16
/ 26 / 36 %.

Tests : `tests/test_guerres.py` (un camp réduit au quart de ce qu'il a tenu absorbé dès la chute de son chef-lieu,
sinon un traité et cinq ans de trêve dans le Sud-Ouest ; l'armée plus forte attaque celle qui menace sa place, pas
contre plus fort, mais pas dans le Sud-Ouest ; ne laisser que ce qu'il faut), `tests/test_france.py` (trêve courte d'un petit vaincu, deuxième
défaite face à un autre vainqueur). Une sauvegarde faite avec le code d'avant (Sud-Ouest, 1702) se recharge et joue un an.

## Étape 2 : l'Europe et l'Afrique du Nord (mode « Europe »)

- Pays d'époque (Angleterre, Espagne, Portugal, Prusse, Autriche, Russie, Empire ottoman, Provinces-Unies, États
  italiens, Suède, Maroc, régences d'Alger, de Tunis…) et leurs villes principales.
- Échelle à trancher : 17 millions de cases à 1 km, c'est trop pour un iPad ou un Raspberry.

## Risques

- La taille : carte, mémoire du navigateur, temps de tour du serveur sur Raspberry.
- Les données d'époque (populations de 1790, places fortes) sont approchées pour les nouveaux départements.
