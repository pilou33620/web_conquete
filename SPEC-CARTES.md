# Spec : des champs de bataille composés comme ceux d'Ultimate General

## Pourquoi

Les cartes d'Ultimate General sont dessinées à la main : des champs aux formes variées qui suivent les routes et le
relief, des villages entourés de jardins et de vergers, des prés humides le long des ruisseaux, des bois aux lisières
découpées, des haies et des chemins qui relient les fermes. Les nôtres sont générées (`game/tactics/terrain.py`), et
cela se voit :

- **les parcelles sont un quadrillage** : des blocs de 160 à 220 m alignés sur les axes, décalés d'une rangée à
  l'autre, coupés en lanières droites (le rendu les arrondit depuis l'étape 9, mais l'ordre de la grille reste) ;
- **rien n'organise le paysage** : les cultures sont tirées au hasard partout, sans lien avec les villages, l'eau ou
  la pente ;
- **les bois** sont des taches de bruit, sans clairières dessinées ni lisières de buissons côté champs ;
- **les haies** suivent la grille des blocs.

Choix déjà faits (20/10/2026) : on garde des cartes **générées** (pas le vrai terrain de l'IGN, pas de cartes
dessinées à la main), mais mieux composées.

## Choix validés (20/10/2026)

- La spec telle quelle.
- **Un vrai type « verger »** (19ᵉ type de case, ajouté à la fin : les numéros des autres ne changent pas, les
  sauvegardes restent valables) : couvert 0,2, gêne la vue (opacité 14, jusqu'à 5 m), coût de marche 1,2 (infanterie),
  1,1 (légère), 1,6 (cavalerie), 1,8 (artillerie), freinage 0,9 et 0,75 au contact.
- **Glacis dégagé** : pas de verger à moins de 300 m de l'enceinte d'une place forte.

## Ce qui ne change pas

La taille du champ (3 000 × 2 000 m), la grille de 20 m, les 18 types de case et leurs effets sur le jeu (mouvement,
couvert, vue), le contrat envoyé au navigateur (`to_client`), les places fortes et les villes (`_town`, `_walls`), les
rivières et les routes de la campagne, le déterminisme (même graine, même carte), le temps de calcul (environ 0,1 s,
au plus 0,3 s sur un Raspberry Pi).

## Ce qui change

### C1. Des parcelles aux formes variées, qui suivent les routes

1. **Découpage en îlots** : des germes tirés à environ 180 m les uns des autres (moins près d'un village, plus en
   lande), une cellule de Voronoï par germe (les cases les plus proches), à la place des blocs alignés.
2. **Sens des sillons** : chaque îlot prend la direction de la route ou du chemin le plus proche (s'il est à moins de
   250 m), sinon celle de la pente, sinon un angle tiré au hasard. Ses lanières sont découpées dans ce sens (largeur de
   40 à 100 m), pas selon les axes de la grille.
3. **Lanières de longueurs inégales** : une lanière sur trois est recoupée en travers, comme les champs anciens.

### C2. Un paysage organisé (les « auréoles » du terroir)

Autour de chaque village ou ferme, puis selon l'eau et la pente :

| Où | Ce qu'on y trouve le plus |
|---|---|
| à moins de 120 m des maisons | jardins et vergers (prés semés d'arbres isolés), petites parcelles |
| de 120 à 600 m | champs et vignes (selon le pays), en lanières |
| au-delà | prés, landes, puis les bois en lisière du champ de bataille |
| à moins de 80 m d'un ruisseau ou d'une rivière | prés humides, quelques saules et peupliers, marais dans les creux |
| pentes fortes (> 12 %) | prés, landes et bois (on ne laboure pas les pentes) ; vignes sur les coteaux au sud du Bordelais |

Les tables de cultures actuelles (`CROPS`, `DEPT_CROPS`, le bocage par département) restent : elles donnent le pays,
les auréoles en déplacent les poids selon la place.

### C3. Des bois aux formes de bois

1. **Lisières découpées** : le seuil du bruit est bousculé par un second bruit plus fin ; les bois bordent de préférence
   les limites d'îlots (un bois suit les parcelles qui le touchent).
2. **Clairières** : une ou deux par grand bois (plus de 30 hectares), en pré.
3. **Bosquets** isolés dans les champs (quelques cases), et un rang d'arbres le long des chemins creux.

### C4. Haies, chemins et fermes

1. **Les haies suivent les bords des îlots** (et non plus la grille), avec des trouées ; le bocage par département
   (`BOCAGE`) en règle la part.
2. **Chaque ferme a son chemin** vers la route la plus proche (existe), et les chemins **longent les bords d'îlots**
   au lieu de couper les champs en biais.
3. **Hameaux** : de temps en temps, deux ou trois fermes groupées à un carrefour.

## Hypothèses

- Le rendu (étapes 9b à 9f) tire déjà parti de formes plus organiques : parcelles arrondies, matière des sols, herbe en
  relief. Aucun changement du navigateur n'est nécessaire.
- Les batailles restent jouables comme avant : la part de chaque type de terrain (bois, champs, prés…) varie de moins de
  10 % en moyenne sur les 24 cartes du banc d'équilibre ; c'est leur disposition qui change.

## Critères de réussite

1. Vu de haut, plus aucun alignement de parcelles sur les axes : sur un banc, la part des bords de parcelles parallèles
   aux axes passe sous 30 % (aujourd'hui, presque tous le sont : le banc mesurera la valeur de départ).
2. Autour des villages, des petites parcelles et des vergers ; le long de l'eau, des prés ; les champs suivent les routes.
3. Même graine, même carte (banc existant) ; moins de 0,3 s de calcul par carte sur un PC.
4. `python3 tests/lancer.py` passe ; le banc d'équilibre (`outils/bilan.py`) ne montre pas d'écart de plus de 5 points
   dans les victoires par camp.

## Livraison

| Étape | Contenu |
|---|---|
| C-a | îlots de Voronoï, sens des sillons selon les routes et la pente, lanières (C1), avec le banc des alignements |
| C-b | auréoles autour des villages et des fermes, prés le long de l'eau, pentes (C2) |
| C-c | bois : lisières, clairières, bosquets, rangs d'arbres (C3) |
| C-d | haies sur les bords d'îlots, chemins le long des parcelles, hameaux (C4), puis le banc d'équilibre |

## Limites

- **Toujours** : Python standard seul, déterministe, cartes compatibles avec les sauvegardes existantes (une bataille
  en cours garde sa carte : elle est enregistrée telle quelle).
- **Demander d'abord** : un nouveau type de case (par exemple « verger » comme vrai terrain, avec son couvert) ; tout
  changement des effets du terrain sur le jeu.
- **Jamais** : casser une partie sauvegardée.

## Livré (C-a à C-d en une fois)

`game/tactics/terrain.py` : `_ilots` (C1), `_terroir` (C2, après la pose des fermes et du village), `_bois_details`
(C3), haies sur les bords d'îlots et `_path_on_edges` (plus court chemin qui préfère les bords d'îlots), hameaux (C4).
Le tracé des routes de campagne est calculé avant les parcelles (leurs sillons les suivent). Navigateur : le verger
(formes.js, terrain.js : herbe, fruitiers en rangs tous les 10 m, couvert léger au déploiement).

Mesures sur 24 cartes de villages : bords de parcelles en longues droites alignées (5 cases ou plus) de 76 % à 16 % ;
génération de 95 à 185 ms en moyenne (220 ms au plus) ; parts : champs 32,8 → 28,2 %, prés 20,1 → 22,8 %, vergers
2 %, bois 8,2 → 9,5 %, le reste à moins d'un point. Équilibre, 40 batailles isolées menées par les officiers des deux
camps (mêmes graines) : victoires 13 / 26 / 1 indécise avant, 15 / 24 / 1 après (5 points, deux batailles : dans le
bruit) ; pertes moyennes 13,7 / 11,7 % avant, 14,8 / 14,1 % après. Pas fait : les rangs d'arbres le long des chemins
creux (C3.3).
