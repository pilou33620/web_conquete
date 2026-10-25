"""Simulation d'une bataille tactique (TacticalBattle), livrée par l'IA des deux camps : celle du joueur suit ses
ordres (« Donner mes ordres », orders.py).

Le temps s'exprime en secondes de bataille (0 = 8 h du matin, spec['h_off'] décale l'heure affichée). Le serveur fait
avancer la bataille par pas fixes de DT = 2 s de bataille, à l'allure du film (bridge.REPLAY_RATE) ou aussi vite
qu'il le peut (« Passer », « Finir automatiquement », bancs) : 0,3 à 0,6 ms par pas sur un PC, une bataille complète
en 2,5 s de calcul en médiane (6 s pour 9 sur 10) ; 3 à 4 fois plus sur un Raspberry Pi 4.

==================================================================================================================
RÈGLES DE COMBAT (équilibre ; les réglages sont les constantes P_*, CHOC, MELEE_*, FORMED… ci-dessous)
==================================================================================================================
- Feu soutenu : une salve par minute environ (units.INF_RELOAD, ART_RELOAD) ; 60 cartouches durent une heure de feu.
  Fusillade : P_FUSIL par homme du front et par salve à bout portant, de moins en moins juste avec la distance
  (units.precision : moitié à D50, de 55 m au mousquet à 360 m au Chassepot ; à 90 % de la portée efficace, deux à
  trois fois moins qu'à 30 m). Boulet : P_BOULET par pièce, de moins en moins juste avec la distance (ball_k : moitié
  à la portée efficace). Mitraille : P_MITRAILLE par pièce, la gerbe s'ouvre au-delà de 30 % de sa portée (grape_k :
  effet en 1/distance) ; terrible à bout portant (sous GRAPE_CLOSE = 150 m : ×1,5 à 100 m, ×GRAPE_POINT = 1,6 dès
  90 m). L'ordre dispersé (tirailleurs) prend nettement moins au
  canon (×0,35 au boulet, ×0,55 à la mitraille), un peu moins au fusil (×0,8).
- Charge : l'élan (charge_v, mètres de course utile ; plein élan en 110 m pour la cavalerie, 45 m pour l'infanterie)
  se gagne en courant et se perd en terrain difficile (bois, rochers, marais, vignes, maisons, murs : BRAKE_*), aux
  haies et en montée ; une charge relancée au contact ou en pleine mêlée n'a pas d'élan. De face, une troupe en ordre
  (ligne ou colonne, moral ≥ FORMED) ou une batterie chargée tire à bout portant (feu de défense) ; une colonne
  d'infanterie qui tombe sous FALTER s'arrête court ; la cavalerie qui ne rompt pas une ligne ferme est repoussée. Une
  batterie abordée de face lâche deux décharges de mitraille à bout portant (×GRAPE_POINT) : on la prend de flanc.
  De flanc, de dos, sur des tirailleurs, une troupe en manœuvre ou ébranlée, sur des canons : le choc est rude. Une
  charge essouffle les chevaux (CHARGE_FAT), qui chargent ensuite moins bien.
- Mêlée : peu de pertes (MELEE_K), décidée au moral (MELEE_MOR par seconde, partagé selon les forces) ; le plus faible
  cède du terrain sous GIVE_WAY (repli de 100 m, sans fuir) ; à plusieurs contre un, les forces s'additionnent, sauf
  dans un passage étroit (brèche, rue, maison, mur : NARROW) où la pression ne dépasse pas MELEE_MOR. La brèche est
  un goulet (BRECHE_*) : l'assaillant n'y engage pas plus de 180 hommes en mêlée, s'y bat à ×0,8 et y prend ×1,4 au feu.
- Moral : pertes (surtout brutales, de flanc, de dos ; pas de surprise pour une troupe qui se retire en ordre),
  déroutes voisines (ROUT_MOR, seulement pour les troupes déjà ébranlées : pas de déroute en chaîne), munitions,
  fatigue ; remonte au calme (MOR_REC), plus vite près du général. Déroute sous 25 : la troupe fuit vers son bord.
- Ralliement (RALLY_*) : seulement auprès d'un général (état-major ami à moins de 400 m, 500 m s'il est inspirant), au
  calme (aucun ennemi en état de combattre à moins de 400 m) : il faut aller chercher les fuyards ; ils s'y arrêtent,
  se reprennent (0,1 point de moral par seconde) et reforment les rangs à 40. Dans une place, et partout pour les
  défenseurs de la place (chez eux), leurs officiers les rallient sans le général (au calme : 400 m, 150 m dans les
  maisons). Sans général sur le terrain (blessé, absent,
  garnison seule), seulement loin de l'ennemi (700 m), deux fois et demie plus lentement. Sinon, les fuyards courent
  jusqu'au bord de la carte et quittent la bataille. L'ordre « Rallier » suit la même règle (l'ennemi à plus de 150 m
  suffit) et dit pourquoi il échoue (« Le général est trop loin pour rallier ces hommes. »).
- Prisonniers : fuyards rattrapés (CAPTURE), surtout par la cavalerie, moins par des chevaux essoufflés.
- Vue : symétrique (si je te vois, tu me vois) ; une troupe en lisière d'un bois ou de maisons voit et se voit ; bois,
  bâti, murs et haies ne cachent que ce qui est sous leur faîte (une haie ne cache rien à qui la domine).
- Place : l'assaillant l'emporte en tenant le cœur 6 min (HEART_*) ; à l'échelle ou sur une barricade, il se bat mal.
  Reddition (SURR_*) : une brèche ouverte depuis 20 min, une heure sous le canon, 30 % de pertes, un moral moyen sous 55
  et l'assaillant deux fois plus nombreux en ligne : la garnison capitule et elle est prisonnière (la place est prise).
  Siège ou assaut d'une place à enceinte : l'artillerie du défenseur se déploie sur l'enceinte (la case de mur la plus
  proche, à REMPART_GAP de la batterie voisine, tournée vers le dehors), tire de là et n'en bouge plus (on_rampart).
- Bâti (BATI_*, FEU_*, SPEC-2D § 5) : chaque case bâtie est intacte (0), touchée (1), en feu (2) ou en ruine (3). Un
  boulet qui tombe dessus l'entame (BATI_TOUCHE) ou y met le feu (BATI_FEU, BATI_FEU_CHAUME, ×2 à l'obus) ; le feu
  dure FEU_DUREE, gagne les cases bâties voisines (FEU_PROPAG), puis laisse une ruine. Couvert : BATI_COVER (en feu,
  aucun ; la troupe qui s'y trouve en sort et perd FEU_MOR de moral) ; une ruine laisse mieux passer la vue
  (RUINE_OPAC). Tout se tire de battle.rng : même graine, même incendie. Le client reçoit les changements
  [case, état] dans `bati` de la vue (depuis since), l'état complet dans `bati` de la carte ; la sauvegarde les garde.

==================================================================================================================
AIDE-MÉMOIRE POUR L'ÉQUIPE IA (game/tactics/ai.py)
==================================================================================================================
L'IA reçoit `battle` (TacticalBattle) et son camp `side` (0 assaillant, 1 défenseur). Elle ne fait que donner des
ordres, comme le joueur, et ne lit que ce que son camp voit :

Ordres (renvoient (ok, msg)) :
  battle.deploy(side, ids, x, y, dir=None, form=None)    pendant le déploiement : place les unités côte à côte
                                                          autour de (x, y), front tourné vers dir, dans la zone.
  battle.order(side, ids, kind, **params)                 kind : 'move' (x, y, dir?, run?), 'attack' (target),
        'charge' (target), 'hold', 'fire' (mode='free'|'hold'), 'form' (form), 'rally', 'retreat',
        'bombard' (x, y) : batterie de brèche (canons de l'assaillant, place à enceinte) : elle bat le rempart au plus
        près de (x, y) et ne tire sur l'ennemi qu'à portée de mitraille.
        Plusieurs unités en 'move' gardent leur disposition relative autour du point. L'IA ne commande que les unités
        qu'elle contrôle (u.ctrl == 'ia') : battle.ai_units(side).
  battle.withdraw(side)                                   tout le camp décroche (fin de bataille).

Lecture (sans tricher sur la vue) :
  battle.ai_units(side) / battle.units_of(side)           unités du camp (objets Unit, voir units.py) ;
  battle.visible_enemies(side)                            ennemis actuellement repérés par ce camp ;
  battle.unit(uid)                                        une unité par son id (ne lire que les siennes ou les repérées) ;
  battle.cover_at(x, y) → 0..0,7                          couvert de la case (réduction des pertes au feu ; maisons
                                                          touchées, en feu, en ruine : BATI_COVER) ;
  battle.on_rampart(u) → bool                             canon du défenseur sur l'enceinte (fixe) ;
  battle.height_at(x, y) → m                              altitude ;
  battle.terrain_at(x, y) → type T_* (terrain.TYPE_NAMES) ; battle.is_wood(x, y) ;
  battle.los(x1, y1, x2, y2, eye1, eye2) → bool           ligne de vue symétrique (bois, bâti, murs, haies, crêtes),
                                                          eye : hauteur de ce qui regarde ou est vu (HEIGHT) ;
  battle.los_units(a, b) → bool                           la même entre deux unités ;
  battle.path_cost(x1, y1, x2, y2, cls='inf', side=0)     temps de marche estimé (s) à vitesse 1 m/s
                                                          × coût du terrain, ou None si infranchissable ;
  battle.passable(x, y, cls='inf', side=0) → bool ;
  battle.ranges(u) → (efficace, max, mitraille|None) ;    battle.dist(a, b) ; battle.bearing(a, b) ;
  battle.zone(side) → [x0, y0, x1, y1]                    zone de déploiement ; battle.edge(side) : 'N','S','E','O' ;
  battle.front_dir(side) → angle vers l'ennemi depuis sa zone ;
  battle.feature_at(x, y) → 0 aucun, 1 clôture, 2 haie, 3 muret (couvert léger à moyen, léger ralentissement) ;
  battle.objective() → (x, y) | None                      cœur de la place (assaut) ;
  battle.place_info() → dict | None                       {x, y, r, fort} de la place ;
  battle.best_spot(x, y, radius, kind, side, facing=None) meilleure case proche : kind = 'cover' (couvert),
                                                          'height' (hauteur), 'wood_edge' (lisière, pour cacher
                                                          des canons : bois devant soi, vue dégagée vers facing) ;
  battle.threat(side, x, y, radius=600) → hommes ennemis repérés à moins de radius ;
  battle.time_left() → s avant le crépuscule ;           battle.clock, battle.phase, battle.difficulty ;
  battle.strength(side) → hommes valides de son camp ;    battle.seen_strength(side) → ennemis repérés (hommes).

  battle.general_near(u) → état-major ami à moins de 400 m ;  battle.trait(side) → trait du général du camp ;
  battle.rally_general(u) → état-major qui peut rallier cette troupe ; battle.rally_radius(g) → son rayon (m) ;
  battle.has_general(side) → le camp a encore un état-major sur le terrain ; battle.in_place(x, y) → dans la place ;
  battle.edge_point(side, x, y) → où fuient les troupes en déroute ;
  battle.rng (hasard déterministe de la bataille) ;  battle.ai_mem (dict libre pour la mémoire de l'IA, en types JSON :
  il est enregistré avec la bataille) ;  battle.withdrawing[side] (le camp décroche déjà).

Champs d'une unité (Unit) : id, side, owner, type, cls ('inf', 'cavalerie', 'artillerie', 'general', 'chariot'), light,
men, men0, xp, morale, fat, ammo, ammo0, x, y, dir, form, state, order, target, busy (s de manœuvre restantes), valid
(en état de combattre : ni déroute, ni hors de combat, ni état-major, ni chariot), group / gname (armée de campagne),
ctrl ('joueur' | 'ia'), halt (en déroute : les fuyards se sont arrêtés pour se reformer). Le chariot de munitions (type
'chariot', ammo = chargement en %) recomplète les régiments à moins de 150 m (4 % de la dotation par minute) ; il se
prend s'il reste sans escorte à moins de 40 m d'un ennemi. Le général (type 'general') donne +10 de moral à moins de
400 m et rallie les fuyards (voir « Ralliement ») ; il peut être blessé.

« Finir automatiquement » : battle.autofinish() fait passer la bataille en mode accéléré (battle.accel) : les unités
du joueur passent sous le contrôle de l'IA (son camp rejoint ai_sides, au niveau ACCEL_LEVEL = normal ; en plein combat,
elle reprend la situation telle qu'elle est : mémoire absente → ai._adopt), et la suite se joue IA contre IA avec les
mêmes règles et les mêmes pas DT. Le serveur avance une bataille accélérée par battle.run_for(budget) (bridge.tick :
un budget de calcul par appel, pour rester réactif) ; battle.run_to_end() la joue d'un coup (essais, bancs). Le mode
accéléré est enregistré avec la bataille (anciennes sauvegardes : une bataille commandée en cours s'y achève).
Chiffres : DT = 2 s par pas, repérage toutes les 4 s, IA toutes
les 2 s ; fin au crépuscule (DUSK) ; assaut gagné en tenant le cœur de la place 6 min (au moins 150 hommes à 90 m)
sans défenseur à 160 m.
==================================================================================================================
"""
import heapq
import math
import random
import time

from .. import rules as R
from . import stats as ST   # (xp_k, ELAN, technologies : les mêmes chiffres que la fiche)
from . import orders as OR   # (« Donner mes ordres » : le moment décisif)
from . import terrain as TR
from . import units as U
from .terrain import (COLS, ROWS, CELL, N, W, H, T_PRE, T_CHAMP, T_VIGNE_T, T_LANDE_T, T_BOIS, T_FORET_T, T_MARAIS_T,
                      T_EAU, T_GUE, T_ROUTE, T_CHEMIN, T_BATI, T_MUR, T_BRECHE, T_PORTE, T_SABLE, T_ROCHE,
                      T_BARRICADE, T_VERGER)

DT = 2.0                 # pas de simulation (s de bataille)
VIS_DT = 4.0             # mise à jour du repérage
AI_DT = 2.0              # l'IA réfléchit toutes les 2 s de bataille
START_H = 8.0
DUSK = {'printemps': 19.5, 'été': 20.5, 'ete': 20.5, 'automne': 18.0, 'hiver': 17.0}

X = None   # infranchissable
# coût de marche par classe de mouvement (1 = prairie), dans l'ordre des types de case
COST = {
    #        PRE  CHAMP VIGNE LANDE BOIS FORET MARAIS EAU GUE  ROUTE CHEMIN BATI MUR BRECHE PORTE SABLE ROCHE BARRIC. VERGER
    'inf':   [1.0, 1.15, 1.5, 1.25, 1.7, 2.6, 3.0, X, 3.0, 0.85, 0.95, 2.2, X, 2.5, 1.2, 1.8, 4.0, 3.5, 1.2],
    'light': [1.0, 1.1, 1.3, 1.1, 1.2, 1.8, 2.2, X, 2.5, 0.85, 0.95, 1.8, X, 2.2, 1.2, 1.6, 3.0, 3.0, 1.1],
    'cav':   [1.0, 1.2, 2.2, 1.4, 2.6, 5.0, 5.0, X, 2.5, 0.8, 0.9, 3.0, X, 4.0, 1.3, 2.0, X, 6.0, 1.6],
    'art':   [1.0, 1.3, 2.6, 1.5, 3.2, X, X, X, 4.0, 0.7, 0.9, 3.0, X, 6.0, 1.2, 3.0, X, X, 1.8],
}
# (verger, le dernier : couvert léger, les fruitiers gênent un peu la vue jusqu'à 5 m ; SPEC-CARTES.md)
COVER = [0.0, 0.05, 0.15, 0.1, 0.35, 0.5, 0.1, 0.0, 0.0, 0.0, 0.05, 0.55, 0.7, 0.35, 0.5, 0.05, 0.4, 0.5, 0.2]
OPACITY = [0, 0, 0, 0, 34, 60, 0, 0, 0, 0, 0, 50, 100, 0, 100, 0, 0, 0, 14]   # en centièmes, cumulés le long du regard
# hauteur (m) de ce qui bouche la vue sur la case : un regard qui passe au-dessus n'est pas gêné
TOP = [0, 0, 0, 0, 12, 16, 0, 0, 0, 0, 0, 8, 7, 0, 7, 0, 0, 0, 5]
WOODS = (T_BOIS, T_FORET_T)
# canons dans un bois (pas en forêt : les pièces n'y passent pas) : camouflés sous les branches, l'ennemi ne les voit
# qu'à moins de CAMO_SEEN m, CAMO_FIRE quand ils tirent (la fumée monte entre les arbres) ; en échange, les troncs
# gênent le pointage et ferment le champ de tir (tir ×CAMO_FIRE_K) et la mise en batterie est plus longue (×CAMO_SETUP)
CAMO_SEEN, CAMO_FIRE, CAMO_FIRE_K, CAMO_SETUP = 250.0, 500.0, 0.65, 1.6
# éléments linéaires (couche f) : aucun, clôture, haie, muret
FCOVER = [0.0, 0.12, 0.25, 0.35]
FCOST = [0.0, 0.15, 0.4, 0.3]
FOPAC = [0, 0, 15, 0]
FTOP = [0, 0, 2.8, 0]    # une haie (talus compris) cache ce qui est à hauteur d'homme, pas ce qu'on voit de plus haut
EYE = 2.5                # hauteur d'un fantassin, pour la vue (m)
# bâti sous le canon (SPEC-2D § 5) : chaque case bâtie est 0 intacte, 1 touchée, 2 en feu, 3 en ruine
BATI_COVER = (COVER[T_BATI], 0.45, 0.0, 0.3)   # en feu, elle ne couvre plus ; en ruine, moins qu'une maison
BATI_TOUCHE = 0.5        # un boulet tombé sur une case bâtie intacte l'entame une fois sur deux…
BATI_FEU = 0.06          # … et y met le feu (tuile, ardoise) six fois sur cent…
BATI_FEU_CHAUME = 0.3    # … trente sur un toit de chaume (map.buildings, toit='chaume') ; ×2 à l'obus (mélinite)
FEU_DT = 10.0            # l'incendie se calcule toutes les 10 s de bataille :
FEU_DUREE = 900.0        # une maison brûle un quart d'heure, puis il en reste une ruine ;
FEU_PROPAG = 0.006       # à chaque fois, le feu gagne une case bâtie voisine (×2,5 chaume, ×0,4 pluie ou neige) ;
FEU_MOR = 6.0            # la troupe chassée d'une maison en feu perd 6 points de moral
RUINE_OPAC = 25          # une ruine bouche la vue moitié moins qu'une maison (OPACITY du bâti : 50)
REMPART_GAP = 60.0       # siège : deux batteries du défenseur sur l'enceinte à 60 m l'une de l'autre au moins
PIET_MAX = 200000        # taille au plus de l'image de la boue (data URL PNG, SPEC-SUITE F8)


def valid_piet(v):
    """Image de la boue envoyée par le navigateur : une data URL PNG de taille raisonnable."""
    return isinstance(v, str) and v.startswith('data:image/png;base64,') and len(v) <= PIET_MAX
HEIGHT = dict(inf=2.5, artillerie=3.0, cavalerie=3.5, general=3.5, chariot=3.0)   # canons : officiers à cheval, caissons
# élan d'une charge : il se gagne en courant (mètres pour un plein élan), se perd en terrain difficile et en montée
ELAN_M = dict(cav=110.0, inf=45.0)
BRAKE_CAV = {T_BOIS: 0.45, T_FORET_T: 0.3, T_MARAIS_T: 0.35, T_VIGNE_T: 0.5, T_BATI: 0.4, T_ROCHE: 0.25, T_VERGER: 0.75,
             T_SABLE: 0.7, T_LANDE_T: 0.9, T_MUR: 0.3, T_PORTE: 0.3, T_BRECHE: 0.4, T_BARRICADE: 0.4, T_GUE: 0.6}
BRAKE_INF = {T_BOIS: 0.85, T_FORET_T: 0.7, T_MARAIS_T: 0.6, T_VIGNE_T: 0.85, T_BATI: 0.8, T_ROCHE: 0.55, T_VERGER: 0.9,
             T_SABLE: 0.8, T_MUR: 0.5, T_PORTE: 0.5, T_BRECHE: 0.7, T_BARRICADE: 0.7, T_GUE: 0.7}
# ---- équilibre du combat (voir « Règles de combat » dans l'aide-mémoire) ----
P_FUSIL = 0.014          # touchés par homme qui tire et par salve, à bout portant (× precision(d) : moitié à D50 ;
                         # avant arme, expérience, moral…)
P_BOULET = 0.26          # touchés par pièce et par coup de boulet à courte distance, sur une ligne à découvert
# les canons de l'assaillant battent le rempart d'une place : un pan s'effondre après BREACH_PTS coups de pièce (pondérés
# par l'armement et la distance) par niveau de fortification, dans un des BREACH_SECT secteurs de l'enceinte
# (deux batteries ouvrent une place ordinaire en une petite heure)
BREACH_PTS = 240.0
BREACH_SECT = 16
BREACH_R = 24.0          # rayon de la brèche ouverte au canon (m)
DEPLOY_GAP = 200.0       # demi-largeur de la bande neutre entre les deux zones de déploiement (m)
DEPLOY_WALL = 450.0      # l'assaillant se déploie au moins à cette distance de l'enceinte…
DEPLOY_DEF = 250.0       # … et le défenseur jusqu'à cette distance au-delà (m)
AI_DEPLOY_ATT = 500.0    # zones de l'IA : l'assaillant à moins de 500 m de son bord…
AI_DEPLOY_DEF_FRAC = 0.65   # … le défenseur sur le devant de sa zone (65 % de sa profondeur)…
AI_DEPLOY_DEF = 120.0    # … et dans une place, à 120 m de l'enceinte au plus
P_MITRAILLE = 0.56       # … à mitraille, jusqu'à 30 % de la portée de mitraille (puis de moins en moins : grape_k)
P_REFFYE = 0.32          # mitrailleuse : touchés par pièce et par gerbe, à bout portant (0,13 à 1 200 m, là où l'IA la
                         # place, comme avant), sur une ligne à découvert…
REFFYE_VS_PIECE = 0.25   # … bien moins contre des pièces (servants abrités derrière leurs affûts)
GRAPE_CLOSE = 150.0      # … et bien davantage à bout portant : sous 150 m, ×1,5 à 100 m…
GRAPE_POINT = 1.6        # … ×1,6 dès 90 m (aussi le feu de défense d'une batterie abordée de face)
P_RECEPTION = 0.035      # feu de défense à bout portant contre une charge, par homme du front
CHOC = 0.024             # pertes du choc d'une charge, par homme qui charge (× élan, flanc, ordre de la cible, type)
MELEE_K = 0.0004         # pertes infligées en mêlée, par homme et par seconde (× force au corps à corps)
MELEE_MOR = 0.5          # moral perdu par seconde de mêlée, partagé selon le rapport des forces au corps à corps
GIVE_WAY = 35            # au corps à corps, le plus faible cède du terrain (repli de 100 m) sous ce moral, sans fuir
FORMED = 50              # moral d'une troupe en ligne ou en colonne qui reçoit une charge de face en bon ordre…
HOLD = 40                # … et qui, s'il lui en reste autant après le choc, repousse les cavaliers
FALTER = 50              # une charge d'infanterie qui, sous le feu de défense, tombe sous ce moral s'arrête court
MOR_REC, MOR_REC_GEN = 0.02, 0.05   # moral regagné par seconde au calme (plus près du général)
ROUT_R = 220.0           # une déroute ébranle les amis à moins de 220 m…
ROUT_MOR = 3.0           # … de 3 points de moral (bataillon de 250 hommes ; deux fois moins près du général)…
ROUT_STEADY = 60         # … s'ils sont déjà ébranlés : rien au-dessus de 60 de moral, tout sous 30
# ralliement : une troupe en déroute ne se reforme que près d'un général (état-major ami à moins de RALLY_R, RALLY_R +
# RALLY_INSP pour un général inspirant) et au calme (aucun ennemi en état de combattre à moins de RALLY_CALM) : il faut
# aller la chercher. Les fuyards s'y arrêtent et regagnent RALLY_REC de moral par seconde ; à 40, ils reforment les rangs.
# Dans une place, et partout pour les défenseurs d'une place (chez eux), les officiers rallient leurs hommes sans le
# général (au calme ; RALLY_CALM_BATI dans les maisons ; RALLY_REC_PLACE), comme avant.
# Sans général sur le terrain (blessé, absent, garnison seule), ils ne les arrêtent que loin de l'ennemi (RALLY_ALONE),
# et lentement (RALLY_REC_ALONE). Partout ailleurs, les fuyards courent jusqu'au bord de la carte et quittent la bataille.
RALLY_R, RALLY_INSP = 400.0, 100.0
RALLY_CALM, RALLY_CALM_BATI, RALLY_ALONE = 400.0, 150.0, 700.0
RALLY_REC, RALLY_REC_PLACE, RALLY_REC_ALONE = 0.1, 0.08, 0.04
# assaut d'une place : l'assaillant l'emporte s'il tient le cœur (au moins HEART_MEN hommes en état de combattre à
# moins de HEART_R) sans défenseur en état de combattre à moins de HEART_FREE, pendant HEART_HOLD secondes de suite
HEART_R, HEART_MEN, HEART_FREE, HEART_HOLD = 90.0, 150.0, 160.0, 360.0
# reddition d'une place (l'usage des sièges, de Vauban à Strasbourg 1870 : la brèche praticable, la garnison peut se
# rendre) : brèche ouverte depuis SURR_BREACH_T, sous le canon depuis SURR_POUND_T, la garnison a perdu SURR_LOSS de ses
# hommes, son moral moyen (fuyards compris ; sous FORMED, une troupe est ébranlée) est sous SURR_MOR, et l'assaillant
# en état de combattre est SURR_RATIO fois plus nombreux : elle capitule, prisonnière (ni en rase campagne, ni sans brèche)
SURR_BREACH_T, SURR_POUND_T, SURR_LOSS, SURR_MOR, SURR_RATIO = 1200.0, 3600.0, 0.3, 55.0, 2.0
CAPTURE = dict(contact_cav=0.004, contact_inf=0.0007,  # part des fuyards rattrapés par pas de 2 s au contact
               choc_cav=0.03, choc_inf=0.02,            # … par une charge sur des fuyards
               rupture_cav=0.04, melee_cav=0.03)        # … quand la cavalerie rompt une troupe (choc, mêlée)
CHARGE_FAT = dict(cav=12.0, inf=6.0)   # fatigue d'une charge menée jusqu'au choc : les chevaux sont essoufflés
# ordres propres à chaque arme (voir order) : feu de salve et salve puis baïonnette (ligne, grenadiers), harcèlement
# et couvert (voltigeurs, chasseurs), poursuite (cavalerie), projectile et contre-batterie (artillerie)
VOLLEY_RANGE = 0.85      # feu de salve : on ne tire qu'à moins de 85 % de la portée efficace (tout porte)…
VOLLEY_POWER = 1.25      # … la volée groupée touche un quart de plus…
VOLLEY_RELOAD = 1.15     # … mais on attend l'ordre : le rechargement est plus long
VOLLEY_CHARGE_AT = 0.6   # « salve puis baïonnette » : on tire à 60 % de la portée efficace, puis on charge
VOLLEY_WAIT = 30.0       # … et l'on charge quand même si la volée n'est pas partie 30 s après être arrivé à portée
ENTRENCH_T = 300.0       # retranchements : cinq minutes à l'arrêt pour s'enterrer (technologie, SPEC-TECH.md)
LOGEMENT_K = 0.3         # logement dans une brèche (spec['logement'] : ids, posés par l'IA) : gabions, sacs à terre
HARASS_NEAR = 0.8        # harcèlement : on recule devant l'ennemi qui s'approche à moins de 80 % de la portée efficace…
HARASS_FAR = 1.05        # … et l'on s'avance s'il reste au-delà (jamais plus près que 90 % de la portée efficace)
HARASS_EVERY = 6.0       # le tirailleur réfléchit toutes les 6 s
COVER_RADIUS = 140.0     # « se couvrir » : meilleur couvert à moins de 140 m
PURSUIT_RADIUS = 700.0   # « poursuivre » : fuyards à moins de 700 m
# « Finir automatiquement » : la suite de la bataille est jouée par le moteur, IA contre IA, aussi vite que le serveur
# le permet. Les officiers du joueur commandent au niveau ACCEL_LEVEL (celui de son déploiement de départ : une IA
# correcte, quelle que soit la difficulté, qui ne règle que l'IA adverse) ; pendant l'accéléré, le client ne reçoit
# que les ACCEL_FX derniers effets de chaque réponse (le reste a défilé trop vite pour être vu)
ACCEL_LEVEL = 'normal'
ACCEL_FX = 80
ACCEL_BUSY = "Vos officiers mènent la bataille : reprenez le commandement pour donner vos ordres."
FCOST_K = dict(inf=1.0, light=0.6, cav=2.0, art=2.5)
WALLISH = {T_MUR: 0.65, T_PORTE: 0.65, T_BRECHE: 0.4, T_BARRICADE: 0.5}
NARROW = (T_BATI, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE)
# la brèche est un goulet (l'assaillant sur la brèche ou à une case de ses bords) : on n'y engage pas plus de
# BRECHE_FRONT hommes en mêlée (48 m de décombres : 60 files sur trois rangs), qui s'y battent mal (×BRECHE_MELEE : on
# grimpe sur les éboulis, sous les chevaux de frise) et y prennent les feux croisés des flancs (×BRECHE_FEU) : à
# Badajoz (1812), les colonnes d'assaut y perdirent près d'un homme sur trois
BRECHE_FRONT, BRECHE_MELEE, BRECHE_FEU = 180.0, 0.8, 1.4
OFFROAD = tuple(k for k in range(18) if k not in (T_ROUTE, T_CHEMIN))
VIEW = {'soleil': 2000, 'nuages': 1800, 'canicule': 1800, 'brouillard': 250, 'pluie': 600, 'orage': 500,
        'neige': 800, 'tempete': 700}
# vulnérabilité de la cible selon la formation : au feu de l'infanterie, au boulet, à la mitraille
# (l'ordre dispersé : nettement moins touché par le canon, un peu moins par la fusillade)
VUL_FIRE = dict(ligne=1.0, colonne=1.2, carre=1.3, tirailleurs=0.8, batterie=0.9, attelee=1.2)
VUL_BALL = dict(ligne=0.8, colonne=1.5, carre=1.5, tirailleurs=0.35, batterie=0.6, attelee=1.2)
VUL_GRAPE = dict(ligne=1.0, colonne=1.3, carre=1.3, tirailleurs=0.55, batterie=0.8, attelee=1.0)
ARC = dict(ligne=0.9, colonne=1.0, carre=4.0, tirailleurs=1.6, batterie=0.8, attelee=0.0)
TURN = dict(ligne=0.03, colonne=0.12, carre=0.2, tirailleurs=0.1, batterie=0.05, attelee=0.1)
FORM_TIME = dict(ligne=50, colonne=40, carre=60, tirailleurs=45, batterie=60, attelee=60)


def grape_k(d, grape):
    """La mitraille est terrible à bout portant ; au-delà de 30 % de sa portée, la gerbe s'ouvre et son effet décroît
    comme l'inverse de la distance (moitié à 60 % de la portée, 30 % au bout). Sous GRAPE_CLOSE (150 m), la gerbe encore
    serrée fauche des files entières : ×1,5 à 100 m, ×GRAPE_POINT dès 90 m."""
    k = min(1.0, 0.3 * grape / max(1.0, d))
    if d < GRAPE_CLOSE:
        k *= min(GRAPE_POINT, 1.0 + (GRAPE_CLOSE - d) / 100.0)
    return k


def ball_k(d, e):
    """Le boulet perd vite en justesse avec la distance : plein effet jusqu'au quart de la portée efficace, à peu près
    moitié à la portée efficace, presque rien au bout de la portée maximale."""
    return min(1.0, max(0.12, 1.2 - 0.75 * d / max(1.0, e)))


def ang_diff(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)


def fmt_hour(clock):
    m = int(START_H * 60 + clock / 60)
    return f"{m // 60} h {m % 60:02d}"


def move_class(u):
    if u.cls in ('artillerie', 'chariot'):
        return 'art'
    if u.cls in ('cavalerie', 'general'):
        return 'cav'
    return 'light' if u.light else 'inf'


class TacticalBattle:
    """Une bataille tactique. spec : description venue de la campagne (bridge.make_spec) ; units : liste d'Unit."""

    def __init__(self, geo, spec, units, ai_sides=(0, 1)):
        self.spec = spec
        self.bid = spec['bid']
        self.geo = geo
        self.map = TR.generate(geo, spec)
        self.t = self.map.t
        self.h = self.map.h
        self.f = self.map.f
        self.weather = spec.get('weather', 'soleil')
        self.season = spec.get('season', 'été')
        self.difficulty = spec.get('difficulty', 'normal')
        self.me = spec.get('me')            # camp du joueur (None : bataille entre IA)
        self.units = list(units)
        self.by_id = {u.id: u for u in self.units}
        self.phase = 'deploiement'
        self.clock = 0.0
        self.seq = 0
        self.fx = []
        self.logs = []
        self.result = None
        self.ai_sides = list(ai_sides)
        self.seen_by = [set(), set()]
        self.withdrawing = [False, False]
        self.withdraw_t = [0.0, 0.0]
        self.hold_t = 0.0
        self.siege_t = None                  # heure du premier coup des canons de l'assaillant sur le rempart
        self.prisoners = [0.0, 0.0]          # hommes de ce camp faits prisonniers
        self.ai_mem = {}                     # mémoire de l'IA (types JSON seulement : enregistrée avec la bataille)
        self.accel = False                   # « Finir automatiquement » : les officiers jouent la suite en accéléré…
        self.accel_t = 0.0                   # … depuis cette heure de bataille
        self.replay = None                   # « Donner mes ordres » : la bataille défile, réglée par bridge (orders.py)…
        self.ask = None                      # … et s'arrête au moment décisif, en attendant la réponse du joueur
        self._vis_t = -99.0
        self._ai_t = -99.0
        self._cost_cache = {}
        self._path_cache = {}
        self._astar_left = 6
        self._los_cache = {}
        self.pound = {}                      # coups encaissés par secteur de l'enceinte (canons de l'assaillant)
        self.breaches = []                   # brèches ouvertes pendant la bataille : [mur, x, y, rayon]
        self.breach_t = []                   # … et quand : [heure de bataille (s), secteur] (journal des batailles)
        self.piet = None                     # la boue laissée par les troupes (image PNG du navigateur, SPEC-SUITE F8)
        self.bati = bytearray(N)             # état de chaque case bâtie (BATI_*) : 0 intacte, 1 touchée, 2 feu, 3 ruine
        self.bati_log = []                   # … ses changements : [seq, case, état, heure de bataille (s)]
        self.feu = {}                        # cases en feu : heure où le feu a pris
        self._feu_t = -99.0
        self.chaume = {TR.cell_of(b['x'], b['y']) for b in self.map.buildings if b.get('toit') == 'chaume'}
        rng = random.Random(spec['seed'] ^ 0x5A5A)
        self.rng = rng
        wa = rng.random() * 6.283
        self.wind = [round(math.cos(wa), 2), round(math.sin(wa), 2)]
        # (h_off : « Donner mes ordres », l'heure de l'attaque ; l'horloge part toujours de 0, l'heure affichée et le
        # crépuscule glissent d'autant)
        self.dusk = (DUSK.get(self.season, 19.0) - START_H) * 3600 - spec.get('h_off', 0.0)
        self.light = 1.0
        self._zones()
        self._wx_fire = 1.0

    # ================================================================== zones et bords
    def _zones(self):
        a = self.spec.get('att_angle', math.pi)
        ca, sa = math.cos(a), math.sin(a)
        if abs(ca) * H >= abs(sa) * W * 0.66:
            e0 = 'E' if ca > 0 else 'O'
        else:
            e0 = 'S' if sa > 0 else 'N'
        # un bord noyé (estuaire, côte : la carte de campagne est grossière) : l'assaillant arrive par le plus sec
        if self._dry(self._edge_band(e0, 600)) < 0.4:
            e0 = max('ONES', key=lambda e: (self._dry(self._edge_band(e, 600)), e == e0))
        opp = dict(E='O', O='E', N='S', S='N')
        self.edges = [e0, opp[e0]]
        # chaque camp se déploie librement dans sa moitié de la carte, sauf une bande neutre de 2 × DEPLOY_GAP au
        # milieu ; devant une place, l'assaillant reste à DEPLOY_WALL de l'enceinte et le défenseur tient la place et
        # ses abords (DEPLOY_DEF au-delà de l'enceinte)
        # l'IA (et le placement de départ des troupes du joueur) garde des zones plus serrées, à bonne distance l'une
        # de l'autre (ai_zones, comprises dans les zones) : l'ennemi ne commence pas à 400 m de vos lignes
        pl = self.map.place
        z, za = [], []
        if pl and pl.get('battle'):
            px, py, r = pl['x'], pl['y'], pl['r']
            d = dict(O=px, E=W - px, N=py, S=H - py)[e0] - r
            # (une place sur son plan, carte de version 4, peut s'approcher du bord : la bande de l'assaillant reste
            # alors à 150 m de l'enceinte au moins, sur 200 m au moins)
            b0 = max(200, min(500, d - 150)) if getattr(self.map, 'plan', None) else 500
            z.append(self._edge_band(e0, max(b0, d - DEPLOY_WALL)))
            za.append(self._edge_band(e0, max(b0, min(1400, d - DEPLOY_WALL))))
            for k, lst in ((DEPLOY_DEF, z), (AI_DEPLOY_DEF, za)):
                r = pl['r'] + k
                lst.append([max(0, pl['x'] - r), max(0, pl['y'] - r), min(W, pl['x'] + r), min(H, pl['y'] + r)])
        else:
            span = W if e0 in 'OE' else H
            half = span / 2 - DEPLOY_GAP
            z.append(self._edge_band(e0, half))
            z.append(self._edge_band(opp[e0], half))
            za.append(self._edge_band(e0, AI_DEPLOY_ATT))
            # le défenseur : le devant de sa zone, sur AI_DEPLOY_DEF_FRAC de sa profondeur
            d1 = z[1]
            back = half * (1 - AI_DEPLOY_DEF_FRAC)
            za.append([d1[0] + (back if e0 == 'E' else 0), d1[1] + (back if e0 == 'S' else 0),
                       d1[2] - (back if e0 == 'O' else 0), d1[3] - (back if e0 == 'N' else 0)])
        self.zones = z
        self.ai_zones = za

    def _dry(self, box):
        """Part de terre (sans eau) dans le rectangle box."""
        cs = [j * COLS + i for j in range(int(box[1] // CELL), min(ROWS, int(box[3] // CELL)))
              for i in range(int(box[0] // CELL), min(COLS, int(box[2] // CELL)))]
        return sum(self.t[c] != T_EAU for c in cs) / max(1, len(cs))

    @staticmethod
    def _edge_band(e, depth):
        if e == 'O':
            return [0, 100, depth, H - 100]
        if e == 'E':
            return [W - depth, 100, W, H - 100]
        if e == 'N':
            return [150, 0, W - 150, depth]
        return [150, H - depth, W - 150, H]

    def zone(self, side):
        return list(self.zones[side])

    def ai_zone(self, side):
        """Zone où l'IA déploie et d'où elle juge l'ennemi (plus serrée que celle du joueur)."""
        return list(self.ai_zones[side])

    def edge(self, side):
        return self.edges[side]

    def front_dir(self, side):
        return {'O': 0.0, 'E': math.pi, 'N': math.pi / 2, 'S': -math.pi / 2}[self.edges[side]]

    def edge_point(self, side, x, y):
        e = self.edges[side]
        if e == 'O':
            return -30.0, y
        if e == 'E':
            return W + 30.0, y
        if e == 'N':
            return x, -30.0
        return x, H + 30.0

    def off_map(self, side, x, y):
        e = self.edges[side]
        return (e == 'O' and x < 15) or (e == 'E' and x > W - 15) or (e == 'N' and y < 15) or (e == 'S' and y > H - 15)

    def objective(self):
        pl = self.map.place
        if pl and pl.get('battle') and self.map.heart:
            return tuple(self.map.heart)
        return None

    def place_info(self):
        pl = self.map.place
        return dict(x=pl['x'], y=pl['y'], r=pl['r'], fort=pl.get('fort', 0)) if pl and pl.get('battle') else None

    # ================================================================== terrain : aides
    @staticmethod
    def cell(x, y):
        i, j = int(x // CELL), int(y // CELL)
        if i < 0:
            i = 0
        elif i >= COLS:
            i = COLS - 1
        if j < 0:
            j = 0
        elif j >= ROWS:
            j = ROWS - 1
        return j * COLS + i

    def terrain_at(self, x, y):
        return self.t[self.cell(x, y)]

    def is_wood(self, x, y):
        return self.t[self.cell(x, y)] in WOODS

    def height_at(self, x, y):
        return self.h[self.cell(x, y)]

    def cover_at(self, x, y):
        c = self.cell(x, y)
        tc = self.t[c]
        return max(BATI_COVER[self.bati[c]] if tc == T_BATI else COVER[tc], FCOVER[self.f[c]])

    def feature_at(self, x, y):
        """Élément linéaire de la case : 0 aucun, 1 clôture, 2 haie, 3 muret (terrain.FEAT_NAMES)."""
        return self.f[self.cell(x, y)]

    def costs(self, mc, side):
        """Coût de marche de chaque case pour cette classe et ce camp (None : infranchissable). Mis en cache."""
        key = (mc, side)
        arr = self._cost_cache.get(key)
        if arr is not None:
            return arr
        tab = list(COST[mc])
        mud = 1.0
        if self.weather in ('pluie', 'orage', 'tempete'):
            mud = 1.3
        elif self.weather == 'neige':
            mud = 1.4
        pl = self.map.place
        if side == 0 and pl and pl.get('battle'):
            tab[T_PORTE] = X   # portes fermées à l'assaillant
            if mc in ('inf', 'light') and T_BRECHE not in self.t:
                tab[T_MUR] = 14.0   # pas de brèche : l'escalade, à l'échelle
        for k in OFFROAD:
            if tab[k] is not None:
                tab[k] *= mud
        t, f = self.t, self.f
        fk = FCOST_K[mc]
        arr = [tab[t[c]] for c in range(N)]
        for c in range(N):
            if f[c] and arr[c] is not None:
                arr[c] += FCOST[f[c]] * fk
        self._cost_cache[key] = arr
        return arr

    def warm(self):
        """Prépare les tables de coût de marche des classes présentes (hors de la boucle tactique)."""
        for u in self.units:
            self.costs(move_class(u), u.side)

    def passable(self, x, y, cls='inf', side=0):
        if not (0 <= x < W and 0 <= y < H):
            return False
        mc = cls if cls in COST else ('cav' if cls in ('cavalerie', 'general') else ('art' if cls == 'artillerie' else 'inf'))
        return self.costs(mc, side)[self.cell(x, y)] is not None

    def _passable_u(self, u, x, y):
        return self.costs(move_class(u), u.side)[self.cell(x, y)] is not None

    def nearest_passable(self, u_or_cls, side, x, y, maxr=12, hors_feu=False):
        """Case franchissable la plus proche (hors_feu : et pas dans une maison en feu)."""
        mc = move_class(u_or_cls) if isinstance(u_or_cls, U.Unit) else u_or_cls
        cost = self.costs(mc, side)
        if hors_feu:
            bt = self.bati
            cost = [None if bt[c] == 2 else v for c, v in enumerate(cost)]
        c0 = self.cell(x, y)
        if cost[c0] is not None:
            return x, y
        ci, cj = c0 % COLS, c0 // COLS
        for r in range(1, maxr + 1):
            best = None
            for dj in range(-r, r + 1):
                for di in (-r, r) if abs(dj) != r else range(-r, r + 1):
                    i, j = ci + di, cj + dj
                    if 0 <= i < COLS and 0 <= j < ROWS and cost[j * COLS + i] is not None:
                        d = di * di + dj * dj
                        if best is None or d < best[0]:
                            best = (d, i, j)
            if best:
                return (best[1] + 0.5) * CELL, (best[2] + 0.5) * CELL
        return x, y

    def los(self, x1, y1, x2, y2, eye1=EYE, eye2=EYE):
        """Ligne de vue entre deux points, la même dans les deux sens : eye1 et eye2 sont les hauteurs de ce qui regarde
        ou est vu à chaque bout (fantassin 2,5 m, canons 3, cavaliers et état-major 3,5 : HEIGHT). Bois, bâti, murs et
        haies la bouchent peu à peu quand le regard passe sous leur faîte (une haie ne cache rien à qui la domine) ; les
        crêtes la coupent. Les deux cases au bord de chaque bout ne comptent pas : une troupe en lisière, ou postée
        juste derrière un mur, une haie, les premières maisons, voit dehors et y est vue."""
        c1, c2 = self.cell(x1, y1), self.cell(x2, y2)
        if c2 < c1:
            c1, c2, eye1, eye2 = c2, c1, eye2, eye1
        key = (c1, c2, eye1, eye2)
        r = self._los_cache.get(key)
        if r is not None:
            return r
        t, h, f, bt = self.t, self.h, self.f, self.bati
        i1, j1, i2, j2 = c1 % COLS, c1 // COLS, c2 % COLS, c2 // COLS
        n = max(abs(i2 - i1), abs(j2 - j1))
        ok = True
        if n > 2:
            z1 = h[c1] + eye1
            dz = (h[c2] + eye2 - z1) / n
            op = 0
            di, dj = (i2 - i1) / n, (j2 - j1) / n
            for s in range(1, n):
                c = int(j1 + dj * s + 0.5) * COLS + int(i1 + di * s + 0.5)
                clear = z1 + dz * s - h[c]
                if clear < -0.5:
                    ok = False
                    break
                if 2 < s < n - 2:
                    tc = t[c]
                    if OPACITY[tc] and clear < TOP[tc]:
                        op += OPACITY[tc] if bt[c] != 3 else RUINE_OPAC
                    fc = f[c]
                    if fc and FOPAC[fc] and clear < FTOP[fc]:
                        op += FOPAC[fc]
                    if op >= 100:
                        ok = False
                        break
        if len(self._los_cache) > 60000:
            self._los_cache.clear()
        self._los_cache[key] = ok
        return ok

    def los_units(self, a, b):
        """Ligne de vue entre deux unités (chacune à sa hauteur)."""
        return self.los(a.x, a.y, b.x, b.y, HEIGHT.get(a.cls, EYE), HEIGHT.get(b.cls, EYE))

    def _line_ok(self, cost, x1, y1, x2, y2, maxc):
        L = math.hypot(x2 - x1, y2 - y1)
        n = max(1, int(L / 10.0))
        for s in range(1, n + 1):
            k = s / n
            cc = cost[self.cell(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k)]
            if cc is None or cc > maxc:
                return False
        return True

    def _astar(self, cost, s, g, cap=9000):
        """A* pondéré sur la grille (8 voisins), avec pénalité de montée. Renvoie la liste des cases ou None."""
        if cost[g] is None:
            return None
        h = self.h
        gi, gj = g % COLS, g // COLS
        cmin = 0.7
        D2 = 1.4142
        openh = [(0.0, s)]
        gs = {s: 0.0}
        came = {}
        seen = 0
        while openh:
            _, c = heapq.heappop(openh)
            if c == g:
                break
            seen += 1
            if seen > cap:
                return None
            gc = gs[c]
            i, j = c % COLS, c // COLS
            hc = h[c]
            for di, dj, m in ((1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
                              (1, 1, D2), (1, -1, D2), (-1, 1, D2), (-1, -1, D2)):
                ni, nj = i + di, j + dj
                if ni < 0 or nj < 0 or ni >= COLS or nj >= ROWS:
                    continue
                nc = nj * COLS + ni
                cc = cost[nc]
                if cc is None:
                    continue
                if m > 1 and (cost[j * COLS + ni] is None or cost[nj * COLS + i] is None):
                    continue   # pas de coin coupé entre deux cases infranchissables
                dh = h[nc] - hc
                ng = gc + cc * m + (dh * 0.08 if dh > 0 else 0.0)
                if ng < gs.get(nc, 1e18):
                    gs[nc] = ng
                    came[nc] = c
                    dx, dy = abs(ni - gi), abs(nj - gj)
                    hh = (max(dx, dy) + 0.4142 * min(dx, dy)) * cmin * 1.25
                    heapq.heappush(openh, (ng + hh, nc))
        if g != s and g not in came:
            return None
        path = [g]
        while path[-1] != s:
            path.append(came[path[-1]])
        path.reverse()
        return path

    def plan_path(self, u, gx, gy):
        """Chemin de l'unité jusqu'à (gx, gy) : en ligne droite si le terrain s'y prête, sinon A* (mis en cache)."""
        mc = move_class(u)
        cost = self.costs(mc, u.side)
        gx, gy = self.nearest_passable(u, u.side, gx, gy)
        s, g = self.cell(u.x, u.y), self.cell(gx, gy)
        cs = cost[s] if cost[s] is not None else 1.0
        if self._line_ok(cost, u.x, u.y, gx, gy, max(2.0 if mc != 'art' else 1.6, cs)):
            return [(gx, gy)]
        key = (mc, u.side, s, g)
        pts = self._path_cache.get(key)
        if pts is None and self._astar_left <= 0:
            return [(gx, gy)]   # trop de recherches ce pas-ci : en ligne droite, on recalculera si ça bloque
        if pts is None:
            self._astar_left -= 1
            cells = self._astar(cost, s, g)
            if cells is None:
                pts = [(gx, gy)] if self._line_ok(cost, u.x, u.y, gx, gy, 99) else []
            else:
                pts = self._smooth(cost, [TR.center_of(c) for c in cells])
            if len(self._path_cache) > 200:
                self._path_cache.clear()
            self._path_cache[key] = pts
        pts = list(pts)
        if pts:
            pts[-1] = (gx, gy)
        return pts

    def _smooth(self, cost, pts):
        if len(pts) <= 2:
            return pts[1:] if len(pts) > 1 else pts
        cs = [cost[self.cell(*p)] or 1.0 for p in pts]
        out = []
        i = 0
        while i < len(pts) - 1:
            k = i + 1
            mc = max(cs[i], cs[k])
            j = k + 1
            while j < len(pts) and j - i < 40:
                m2 = max(mc, cs[j])
                if self._line_ok(cost, pts[i][0], pts[i][1], pts[j][0], pts[j][1], m2 + 0.01):
                    k, mc = j, m2
                    j += 1
                else:
                    break
            out.append(pts[k])
            i = k
        return out

    def path_cost(self, x1, y1, x2, y2, cls='inf', side=0):
        """Temps de marche estimé (s, à 1 m/s × coût du terrain) de (x1, y1) à (x2, y2), ou None si impossible."""
        mc = cls if cls in COST else ('cav' if cls in ('cavalerie', 'general') else ('art' if cls == 'artillerie' else 'inf'))
        cost = self.costs(mc, side)
        s, g = self.cell(x1, y1), self.cell(x2, y2)
        if cost[g] is None:
            return None
        if self._line_ok(cost, x1, y1, x2, y2, 99):
            L = math.hypot(x2 - x1, y2 - y1)
            n = max(1, int(L / 20))
            return sum(cost[self.cell(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n)] for k in range(1, n + 1)) * L / n
        cells = self._astar(cost, s, g)
        if cells is None:
            return None
        tot = 0.0
        for a, b in zip(cells, cells[1:]):
            tot += cost[b] * (1.4142 if (a % COLS != b % COLS and a // COLS != b // COLS) else 1.0) * CELL
        return tot

    def best_spot(self, x, y, radius, kind='cover', side=0, facing=None, cls='inf'):
        """Meilleure case à moins de radius de (x, y) : 'cover', 'height' ou 'wood_edge' (lisière face à facing)."""
        best, bv = (x, y), -1e9
        r = int(radius // CELL)
        ci, cj = int(x // CELL), int(y // CELL)
        step = 1 if r <= 10 else 2
        for dj in range(-r, r + 1, step):
            for di in range(-r, r + 1, step):
                i, j = ci + di, cj + dj
                if not (0 <= i < COLS and 0 <= j < ROWS) or di * di + dj * dj > r * r:
                    continue
                c = j * COLS + i
                px, py = (i + 0.5) * CELL, (j + 0.5) * CELL
                if not self.passable(px, py, cls, side):
                    continue
                d = math.sqrt(di * di + dj * dj) / max(1, r)
                if kind == 'height':
                    v = self.h[c] - 4 * d
                elif kind == 'wood_edge':
                    if self.t[c] not in WOODS or facing is None:
                        continue
                    # en lisière : la case suivante vers l'ennemi est dégagée
                    fx, fy = px + math.cos(facing) * CELL * 1.5, py + math.sin(facing) * CELL * 1.5
                    if self.terrain_at(fx, fy) in WOODS + (T_BATI, T_MUR, T_EAU):
                        continue
                    v = 1.0 + self.h[c] / 40.0 - d
                else:
                    v = COVER[self.t[c]] * 2 + self.h[c] / 80.0 - d * 0.5
                if v > bv:
                    best, bv = (px, py), v
        return best

    # ================================================================== unités : aides
    def unit(self, uid):
        return self.by_id.get(uid)

    def units_of(self, side):
        return [u for u in self.units if u.side == side and u.alive]

    def ai_units(self, side):
        return [u for u in self.units if u.side == side and u.alive and u.ctrl == 'ia']

    def visible_enemies(self, side):
        seen = self.seen_by[side]
        return [u for u in self.units if u.side != side and u.alive and u.id in seen]

    def ranges(self, u):
        return U.ranges(u)

    @staticmethod
    def dist(a, b):
        return math.hypot(a.x - b.x, a.y - b.y)

    @staticmethod
    def bearing(a, b):
        return math.atan2(b.y - a.y, b.x - a.x)

    def threat(self, side, x, y, radius=600):
        r2 = radius * radius
        return sum(u.men for u in self.visible_enemies(side) if (u.x - x) ** 2 + (u.y - y) ** 2 <= r2 and u.valid)

    def strength(self, side):
        return sum(u.men for u in self.units if u.side == side and u.valid)

    def seen_strength(self, side):
        return sum(u.men for u in self.visible_enemies(side) if u.valid)

    def time_left(self):
        return max(0.0, self.dusk - self.clock)

    def _refresh_gens(self):
        """États-majors présents et trait du général de chaque camp (recalculés à chaque pas)."""
        self._gens = [g for g in self.units if g.cls == 'general' and g.alive]
        self._traits = [None, None]
        for g in self._gens:
            if g.gen and self._traits[g.side] is None:
                self._traits[g.side] = g.gen.get('trait')

    def general_near(self, u, r=400):
        if not hasattr(self, '_gens'):
            self._refresh_gens()
        for g in self._gens:
            if g.side == u.side and g is not u and g.alive:
                rr = r + (200 if (g.gen or {}).get('trait') == 'inspirant' else 0)
                if (g.x - u.x) ** 2 + (g.y - u.y) ** 2 <= rr * rr:
                    return g
        return None

    def tech(self, side):
        """Technologies de combat du camp (stats.TECH_MODS → valeur, venues de la campagne ; {} sans elles)."""
        return (self.spec.get('tech') or ({}, {}))[side]

    def tech_of(self, u):
        """Technologies de combat de cette unité : celles de son régiment s'il n'a pas tout appris (SPEC-ARBRE.md,
        bridge._umd), sinon celles de son camp."""
        m = (self.spec.get('umd') or {}).get(u.id)
        return self.tech(u.side) if m is None else m

    def ufx(self, u, k):
        """Retranchements, mélinite… de cette unité (spec[k] par camp, ou ceux de son régiment)."""
        m = (self.spec.get('umd') or {}).get(u.id)
        return self.spec.get(k, [0, 0])[u.side] if m is None else m.get(k, 0.0)

    def trait(self, side):
        if not hasattr(self, '_traits'):
            self._refresh_gens()
        return self._traits[side]

    def rally_radius(self, g):
        """Rayon (m) dans lequel cet état-major rallie les fuyards (un peu plus pour un général inspirant)."""
        return RALLY_R + (RALLY_INSP if (g.gen or {}).get('trait') == 'inspirant' else 0.0)

    def rally_general(self, u):
        """L'état-major ami qui peut rallier cette troupe (à moins de rally_radius), ou None."""
        if not hasattr(self, '_gens'):
            self._refresh_gens()
        for g in self._gens:
            if g.side == u.side and g is not u and g.alive:
                r = self.rally_radius(g)
                if (g.x - u.x) ** 2 + (g.y - u.y) ** 2 <= r * r:
                    return g
        return None

    def has_general(self, side):
        """Le camp a-t-il encore un état-major sur le terrain (ni blessé ni absent) ?"""
        if not hasattr(self, '_gens'):
            self._refresh_gens()
        return any(g.side == side and g.alive for g in self._gens)

    def in_place(self, x, y, margin=30.0):
        """Le point est-il dans la place (enceinte ou bourg) dont on se dispute la possession ?"""
        pl = self.map.place
        if not pl or not pl.get('battle'):
            return False
        r = pl['r'] + margin
        return (x - pl['x']) ** 2 + (y - pl['y']) ** 2 <= r * r

    def _rally_k(self, u, foe=None, order=False):
        """Une troupe en déroute peut-elle se reprendre ici et maintenant ? Renvoie (moral regagné par seconde, qui la
        rallie : 'general', 'place', 'loin', ou la raison du refus : 'ennemi', 'general_loin', 'seuls').
        order : l'ordre « Rallier » (les officiers s'y mettent tous : il suffit que l'ennemi soit à plus de 150 m)."""
        if foe is None:
            foe = self._nearest_foe_dist(u)
        if self.in_place(u.x, u.y) or (u.side == 1 and self.objective() is not None):
            # dans une place (et partout pour ses défenseurs, chez eux), les officiers rallient leurs hommes au calme
            # (plus près de l'ennemi à l'abri des maisons)
            calm = RALLY_CALM_BATI if order or self.t[self.cell(u.x, u.y)] == T_BATI else RALLY_CALM
            return (RALLY_REC_PLACE, 'place') if foe > calm else (0.0, 'ennemi')
        if foe <= (RALLY_CALM_BATI if order else RALLY_CALM):
            return 0.0, 'ennemi'
        if self.rally_general(u) is not None:
            return RALLY_REC, 'general'
        if self.has_general(u.side):
            return 0.0, 'general_loin'
        if foe > RALLY_ALONE:
            return RALLY_REC_ALONE, 'loin'
        return 0.0, 'seuls'

    # ================================================================== journal et effets
    def emit(self, k, x, y, x2=None, y2=None, n=None, src=None):
        self.seq += 1
        e = dict(k=k, x=round(x), y=round(y), t=round(self.clock), s=self.seq)
        if x2 is not None:
            e['x2'], e['y2'] = round(x2), round(y2)
        if n is not None:
            e['n'] = round(n, 1)
        if src is not None:
            e['u'] = src
        self.fx.append(e)
        if len(self.fx) > 500:
            del self.fx[:150]

    def log(self, text, side=None, about=None):
        """side : camp qui voit ce message (None : les deux) ; about : camp de l'unité dont on parle."""
        self.seq += 1
        self.logs.append((self.seq, side, text, about))
        if len(self.logs) > 300:
            del self.logs[:100]

    # ================================================================== déploiement
    def deploy(self, side, ids, x, y, dir=None, form=None, who='ia'):
        if self.phase != 'deploiement':
            return False, "Le déploiement est terminé."
        us = [self.by_id.get(i) for i in ids]
        us = [u for u in us if u and u.side == side and u.alive and (who == 'any' or u.ctrl == who)]
        if not us:
            return False, "Aucune unité à placer."
        z = self.zones[side]
        if dir is None:
            dir = self.front_dir(side)
        x = min(max(float(x), z[0] + 10), z[2] - 10)
        y = min(max(float(y), z[1] + 10), z[3] - 10)
        # côte à côte, perpendiculairement au front
        px, py = -math.sin(dir), math.cos(dir)
        widths = []
        for u in us:
            if u.src == 'rempart':
                u.form = 'batterie'   # canons du rempart : toujours en batterie
            elif form and form in U.FORMS.get(u.cls, ()) and form != 'batterie':
                u.form = form
            elif form == 'batterie' and u.cls == 'artillerie':
                u.form = 'batterie'
            widths.append(U.footprint(u)[0] + 12)
        tot = sum(widths)
        off = -tot / 2
        for u, w in zip(us, widths):
            ox = off + w / 2
            off += w
            ux = min(max(x + px * ox, z[0] + 5), z[2] - 5)
            uy = min(max(y + py * ox, z[1] + 5), z[3] - 5)
            ux, uy = self.nearest_passable(u, side, ux, uy)
            u.x, u.y, u.dir = ux, uy, dir
            if side == 1 and u.cls == 'artillerie':
                self._to_rampart(u)
            u.path, u.goal, u.order = [], None, None
            u.state = 'repos'
        return True, f"{len(us)} unité{'s' if len(us) > 1 else ''} en place."

    def on_rampart(self, u):
        """Canon du défenseur sur l'enceinte (ou canons du rempart de la place) : il tire, il ne bouge pas."""
        return u.src == 'rempart' or (u.side == 1 and u.cls == 'artillerie' and self.t[self.cell(u.x, u.y)] == T_MUR)

    def _to_rampart(self, u):
        """Siège ou assaut d'une place à enceinte : la batterie du défenseur va sur la case de mur la plus proche,
        à REMPART_GAP au moins des autres, tournée vers le dehors. Rien hors d'une place à enceinte."""
        pl, t = self.map.place, self.t
        if not (pl and pl.get('battle')) or t[self.cell(u.x, u.y)] == T_MUR:
            return
        others = [(o.x, o.y) for o in self.units if o is not u and o.side == 1 and o.cls == 'artillerie' and
                  t[self.cell(o.x, o.y)] == T_MUR]
        best = None
        for c in range(N):
            if t[c] != T_MUR:
                continue
            cx, cy = TR.center_of(c)
            d = (cx - u.x) ** 2 + (cy - u.y) ** 2
            if any((cx - ox) ** 2 + (cy - oy) ** 2 < REMPART_GAP ** 2 for ox, oy in others):
                d += 1e12   # (la place est prise : seulement s'il n'en reste aucune autre)
            if best is None or d < best[0]:
                best = (d, cx, cy)
        if best:
            u.x, u.y = best[1], best[2]
            u.dir = math.atan2(u.y - pl['y'], u.x - pl['x'])
            u.form = 'batterie'

    def start(self):
        if self.phase != 'deploiement':
            return False, "La bataille est déjà engagée."
        for u in self.units:
            if u.side == 1 and u.cls == 'artillerie' and u.alive:
                self._to_rampart(u)   # (aussi celles que personne n'a déployées)
        self.phase = 'combat'
        self.warm()
        self._update_vision()
        self.log("La bataille commence.")
        return True, "La bataille commence !"

    # ================================================================== ordres
    def order(self, side, ids, kind, who='ia', **p):
        """Ordre à des unités du camp side (voir l'aide-mémoire en tête du fichier). Renvoie (ok, msg)."""
        if self.phase == 'fin':
            return False, "La bataille est terminée."
        if self.accel and who == 'joueur':
            return False, ACCEL_BUSY
        if isinstance(ids, str):
            ids = [ids]
        us = [self.by_id.get(i) for i in ids or []]
        us = [u for u in us if u and u.side == side and u.alive and (who == 'any' or u.ctrl == who)]
        if not us:
            return False, "Aucune unité à commander."
        if kind not in ('fire', 'hold', 'rally', 'shot', 'counter') and any(self.on_rampart(u) for u in us):
            us = [u for u in us if not self.on_rampart(u)]   # les canons du rempart ne bougent pas
            if not us:
                return False, "Les canons du rempart sont fixés sur la muraille : ils tirent, mais ne bougent pas."
        if self.phase == 'deploiement' and kind not in ('form', 'fire', 'shot', 'counter'):
            return False, "Déployez d'abord vos troupes, puis lancez la bataille."
        if kind in ('rally', 'retreat'):
            pass
        else:
            us2 = [u for u in us if u.state != 'deroute']
            if not us2:
                return False, "Ces troupes sont en déroute : il faut d'abord les rallier."
            us = us2
        rec = dict(kind=kind)
        if kind == 'move':
            x, y = float(p['x']), float(p['y'])
            if not (math.isfinite(x) and math.isfinite(y)):
                return False, "Destination invalide."
            x, y = min(max(x, 5), W - 5), min(max(y, 5), H - 5)
            d = p.get('dir')
            run = bool(p.get('run'))
            cx = sum(u.x for u in us) / len(us)
            cy = sum(u.y for u in us) / len(us)
            rot = 0.0
            if d is not None and len(us) > 1:
                cur = math.atan2(sum(math.sin(u.dir) for u in us), sum(math.cos(u.dir) for u in us))
                rot = float(d) - cur
            cr, sr = math.cos(rot), math.sin(rot)
            for u in us:
                ox, oy = (u.x - cx, u.y - cy) if len(us) > 1 else (0.0, 0.0)
                ox, oy = ox * cr - oy * sr, ox * sr + oy * cr
                gx, gy = min(max(x + ox, 5), W - 5), min(max(y + oy, 5), H - 5)
                self._go(u, gx, gy, None if d is None else float(d), run)
                u.order = dict(rec, x=round(gx), y=round(gy), dir=d, run=run)
                u.target = None
            return True, "En marche."
        if kind in ('attack', 'charge'):
            tg = self.by_id.get(p.get('target'))
            if not tg or tg.side == side or not tg.alive or tg.id not in self.seen_by[side]:
                return False, "Cible invisible ou introuvable."
            for u in us:
                if kind == 'charge' and u.cls in ('artillerie', 'general', 'chariot'):
                    continue
                if u.state == 'melee':
                    if u.melee_with == tg.id:
                        # déjà au corps à corps avec cette cible : la mêlée continue, sans nouveau choc
                        u.target = tg.id
                        u.order = dict(kind=kind, target=tg.id)
                        continue
                    self._end_melee(u)   # on se dégage pour aller ailleurs (sans élan : il faudra le reprendre)
                if kind == 'charge' and u.state == 'charge' and u.target == tg.id:
                    continue             # la charge est déjà lancée sur cette cible : elle garde son élan
                if kind == 'charge' and u.form == 'carre':
                    u.form = 'colonne'
                u.target = tg.id
                u.order = dict(kind=kind, target=tg.id)
                if kind == 'charge':
                    u.state = 'charge'
                    u.charge_v = 0.0
                    u.path = []
                    self.emit('charge', u.x, u.y, tg.x, tg.y, src=u.id)
                else:
                    self._approach(u, tg)
            return True, "À l'attaque !" if kind == 'attack' else "Chargez !"
        if kind == 'hold':
            for u in us:
                u.path, u.goal = [], None
                u.order = rec
                if u.state in ('marche', 'charge'):
                    u.state = 'repos'
                if u.fire_mode == 'hold':
                    u.fire_mode = 'free'
            return True, "Tenez la position."
        if kind == 'fire':
            mode = p.get('mode') or p.get('fire') or p.get('value') or p.get('v') or 'free'
            mode = 'hold' if mode in ('hold', 'cesser', False, 0) else ('volley' if mode == 'volley' else 'free')
            for u in us:
                # (le feu de salve est affaire d'infanterie ; ailleurs, c'est le feu à volonté)
                u.fire_mode = 'free' if mode == 'volley' and u.cls != 'inf' else mode
            if mode == 'volley':
                return True, "Feu de salve : à mon commandement, à bonne portée."
            return True, "Feu à volonté !" if mode == 'free' else "Cessez le feu."
        if kind == 'volley_charge':
            # « salve puis baïonnette » : l'infanterie s'approche, lâche une volée à bout portant, puis charge
            tg = self.by_id.get(p.get('target'))
            if not tg or tg.side == side or not tg.alive or tg.id not in self.seen_by[side]:
                return False, "Cible invisible ou introuvable."
            n = 0
            for u in us:
                if u.cls != 'inf' or u.light or u.type in ('sapeurs',):
                    continue
                if u.state == 'melee':
                    self._end_melee(u)
                if u.form in ('carre', 'tirailleurs'):
                    self._change_form(u, 'ligne')
                u.target = tg.id
                u.fire_mode = 'volley'
                u.order = dict(kind='volley_charge', target=tg.id, t0=self.clock, f0=u.fired_t)
                self._approach_to(u, tg, U.ranges(u)[0] * VOLLEY_CHARGE_AT)
                n += 1
            if not n:
                return False, "Seule l'infanterie de ligne et les grenadiers donnent la salve et la baïonnette."
            return True, "Salve, puis à la baïonnette !"
        if kind == 'harass':
            # voltigeurs, chasseurs : ils tiraillent à portée efficace et reculent devant l'ennemi qui approche
            n = 0
            for u in us:
                if u.cls != 'inf':
                    continue
                if u.state == 'melee':
                    self._end_melee(u)
                u.target = None
                u.fire_mode = 'free'
                u.order = dict(kind='harass', next=0.0)
                if u.form != 'tirailleurs':
                    self._change_form(u, 'tirailleurs')
                n += 1
            if not n:
                return False, "Seule l'infanterie harcèle."
            return True, "Harcelez l'ennemi : feu et repli."
        if kind == 'cover':
            n = 0
            for u in us:
                if u.cls != 'inf':
                    continue
                foe = self.nearest_foe(u)
                sx, sy = self.best_spot(u.x, u.y, COVER_RADIUS, 'cover', side, cls=move_class(u))
                face = self.bearing(u, foe) if foe is not None else u.dir
                self._go(u, sx, sy, face)
                u.order = dict(kind='move', x=round(sx), y=round(sy), dir=face, run=False)
                u.target = None
                n += 1
            if not n:
                return False, "Seule l'infanterie se met à couvert."
            return True, "Au couvert !"
        if kind == 'pursue':
            # la cavalerie court sus aux fuyards (le plus proche d'abord)
            seen = self.seen_by[side]
            n, why = 0, "Aucune troupe en fuite à poursuivre."
            for u in us:
                if u.cls != 'cavalerie':
                    continue
                best, bd = None, PURSUIT_RADIUS
                for f in self.units:
                    if f.side != side and f.alive and f.state == 'deroute' and f.id in seen:
                        d = self.dist(u, f)
                        if d < bd:
                            best, bd = f, d
                if best is None:
                    continue
                ok, _ = self.order(side, [u.id], 'charge', who=who, target=best.id)
                n += 1 if ok else 0
            return (True, "À la poursuite des fuyards !") if n else (False, why)
        if kind == 'shot':
            mode = p.get('mode') or p.get('value') or p.get('v') or 'auto'
            mode = mode if mode in ('auto', 'boulet', 'mitraille') else 'auto'
            n = 0
            for u in us:
                if u.cls == 'artillerie':
                    u.shot = mode
                    n += 1
            if not n:
                return False, "Seule l'artillerie choisit son projectile."
            return True, {'auto': "Les pièces choisissent leur projectile.", 'boulet': "Boulets sur toute la portée.",
                          'mitraille': "Mitraille : on attend l'ennemi à bout portant."}[mode]
        if kind == 'counter':
            on = (p.get('mode') or p.get('value') or p.get('v') or 'on') not in ('off', False, 0)
            n = 0
            for u in us:
                if u.cls == 'artillerie':
                    u.prio = 'artillerie' if on else None
                    u.target = None
                    n += 1
            if not n:
                return False, "Seule l'artillerie fait de la contre-batterie."
            return True, "Contre-batterie : les canons ennemis d'abord." if on else "Les pièces tirent sur le plus proche."
        if kind == 'form':
            f = p.get('form')
            n = 0
            for u in us:
                if f in U.FORMS.get(u.cls, ()):
                    if f != u.form or (u.busy > 0 and u.next_form != f):
                        if self.phase == 'deploiement':
                            u.form = f
                        else:
                            self._change_form(u, f)
                    n += 1
            return (True, "Changement de formation.") if n else (False, "Formation impossible.")
        if kind == 'rally':
            # même règle que le ralliement de lui-même (voir RALLY_*) : il faut le général auprès des fuyards (ou les
            # maisons d'une place, ou, sans général sur le terrain, être loin de l'ennemi)
            n, why = 0, None
            for u in us:
                if u.state != 'deroute':
                    continue
                k, who = self._rally_k(u, order=True)
                if not k:
                    why = why or who
                    continue
                if self.clock < u.rally_t:
                    why = why or 'tot'
                    continue
                u.morale = min(100.0, u.morale + 12 + (6 if self.rally_general(u) else 0))
                u.rally_t = self.clock + 300
                if u.morale >= 30:
                    self._start_rally(u)
                    n += 1
                else:
                    why = why or 'sourds'
            if n:
                return True, "Les officiers rallient leurs hommes."
            return False, {'general_loin': "Le général est trop loin pour rallier ces hommes.",
                           'ennemi': "Impossible de rallier : l'ennemi est trop près.",
                           'seuls': "Sans général sur le terrain, les officiers ne rallieront ces hommes que loin de "
                                    "l'ennemi.",
                           'tot': "Les officiers s'y emploient déjà : laissez-leur le temps.",
                           }.get(why, "Les hommes ne veulent rien entendre.")
        if kind == 'retreat':
            for u in us:
                self._retreat(u)
            return True, "Retraite !"
        if kind == 'bombard':
            pl = self.map.place
            if side != 0 or not pl or not pl.get('battle') or \
                    not any(w.get('kind') != 'barricade' for w in self.map.walls or []):
                return False, "Il n'y a pas de rempart à battre ici."
            us = [u for u in us if u.cls == 'artillerie' and u.type != 'mitrailleuses']
            if not us:
                return False, "Seuls les canons battent un rempart."
            try:
                x, y = float(p['x']), float(p['y'])
            except (KeyError, TypeError, ValueError):
                return False, "Touchez le rempart à battre."
            if not (math.isfinite(x) and math.isfinite(y)):
                return False, "Touchez le rempart à battre."
            for u in us:
                u.order = dict(kind='bombard', x=round(x), y=round(y))
                u.target = None
            return True, "Batterie de brèche : on bat le rempart."
        return False, "Ordre inconnu."

    def withdraw(self, side):
        """Le camp décroche : toutes ses unités quittent la carte par leur bord ; la bataille finit quand c'est fait."""
        if self.phase == 'fin':
            return False, "La bataille est terminée."
        if self.withdrawing[side]:
            return True, "Le camp décroche déjà."
        if self.phase == 'deploiement':
            self.start()
        self.withdrawing[side] = True
        self.withdraw_t[side] = self.clock
        for u in self.units_of(side):
            self._retreat(u)
        self.log("Ordre de décrocher : l'armée se retire du champ de bataille.", None)
        return True, "Le camp décroche."

    def _retreat(self, u):
        """Retraite en ordre vers son bord (sans recherche de chemin : on oblique devant les obstacles)."""
        if u.state == 'melee':
            self._end_melee(u)
        if u.cls == 'artillerie' and u.form == 'batterie':
            self._change_form(u, 'attelee')
        u.order = dict(kind='retreat')
        u.target = None
        u.path, u.goal = [], None
        if u.state not in ('deroute', 'ralliement'):
            u.state = 'marche'

    def _go(self, u, gx, gy, d, run=False, allow_out=False):
        if u.cls == 'artillerie' and u.form == 'batterie':
            self._change_form(u, 'attelee')
        if u.state == 'melee':
            self._end_melee(u)
        if allow_out:
            ix, iy = min(max(gx, 1), W - 1), min(max(gy, 1), H - 1)
            u.path = self.plan_path(u, ix, iy) + [(gx, gy)]
        else:
            u.path = self.plan_path(u, gx, gy)
        u.goal = [gx, gy, d, bool(run)]
        u.stuck = 0
        if u.state not in ('deroute', 'ralliement'):
            u.state = 'marche' if u.path else 'repos'

    def _approach(self, u, tg):
        """Se porter à portée de tir de la cible : on s'arrête dès qu'elle est à bonne portée (90 % de la
        portée efficace : la distance d'ouverture du feu des règlements), sans aller au contact."""
        e, mx, g = U.ranges(u)
        d = self.dist(u, tg)
        want = e * 0.9
        if u.cls == 'artillerie':
            # les canons tirent dès qu'ils portent : ils ne s'approchent que hors de portée
            want = mx * 0.95 if d > mx else d
        elif u.cls == 'cavalerie':
            want = 120
        if d > want:
            k = (d - want) / d
            self._go(u, u.x + (tg.x - u.x) * k, u.y + (tg.y - u.y) * k, self.bearing(u, tg))
        else:
            u.path, u.goal = [], None
            if u.cls == 'artillerie' and u.form != 'batterie':
                self._change_form(u, 'batterie')

    def _change_form(self, u, f):
        if u.form == f and u.busy <= 0:
            return
        if u.busy > 0 and u.next_form == f:
            return   # déjà en train de prendre cette formation : redonner l'ordre ne relance pas la manœuvre
        if u.busy > 0 and u.form == f and u.state != 'ralliement':
            # contrordre : on revient à la formation qu'on quittait, le temps de défaire ce qui est fait
            u.next_form = f
            return
        base = FORM_TIME.get(f, 50)
        trait = self.trait(u.side)
        k = 1 - 0.4 * u.xp / 100 - self.spec.get('fm_swift', [0, 0])[u.side]
        if u.cls == 'artillerie':
            k = 1 - (0.33 if self.spec.get('art_cheval', [0, 0])[u.side] else 0) - (0.2 if trait == 'artilleur' else 0)
            if f == 'batterie' and self.t[self.cell(u.x, u.y)] in WOODS:
                base *= CAMO_SETUP   # (mise en batterie entre les arbres)
        elif u.cls == 'cavalerie':
            base = 30
        u.next_form = f
        # (pendant un ralliement, les officiers reforment d'abord les rangs : pas de raccourci)
        u.busy = max(10.0, base * max(0.4, k), u.busy if u.state == 'ralliement' else 0.0)
        if u.state not in ('deroute',):
            if u.path and f == 'batterie':
                u.path = []

    def _start_rally(self, u):
        u.state = 'ralliement'
        u.halt = False
        u.busy = 60.0
        u.path = []
        u.goal = None
        u.next_form = 'ligne' if u.cls in ('inf', 'cavalerie') else ('attelee' if u.cls == 'artillerie' else u.form)
        if u.light:
            u.next_form = 'tirailleurs'

    def nearest_foe(self, u):
        """L'ennemi repéré le plus proche (en état de combattre), ou None."""
        best, bd = None, 1e18
        for f in self.visible_enemies(u.side):
            if f.valid:
                d = (f.x - u.x) ** 2 + (f.y - u.y) ** 2
                if d < bd:
                    best, bd = f, d
        return best

    def _approach_to(self, u, tg, want):
        """Se porter à la distance want de la cible (sans reculer)."""
        d = self.dist(u, tg)
        if d > want:
            k = (d - want) / d
            self._go(u, u.x + (tg.x - u.x) * k, u.y + (tg.y - u.y) * k, self.bearing(u, tg))
        else:
            u.path, u.goal = [], None

    def _nearest_foe_dist(self, u, valid=True):
        best = 1e9
        for e in self.units:
            if e.side != u.side and e.alive and (not valid or e.valid):
                d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2
                if d < best:
                    best = d
        return math.sqrt(best)

    # ================================================================== boucle
    def run_for(self, budget, until=None):
        """Bataille accélérée (« Finir automatiquement ») : des pas DT ordinaires, le même déroulé qu'à ×1, autant que
        le permet budget (secondes de calcul réelles ; au moins un pas), sans dépasser l'heure until (« Donner mes
        ordres » : la bataille défile à l'allure du film) ni le moment décisif (ask). Renvoie le nombre de pas."""
        if self.phase != 'combat' or self.ask:
            return 0
        t_end = time.perf_counter() + budget
        n = 0
        while self.phase == 'combat' and not self.ask and (until is None or self.clock < until):
            self.step(DT)
            n += 1
            if time.perf_counter() >= t_end:
                break
        return n

    def run_to_end(self):
        """Synchrone, sans budget de temps (essais, bancs) : joue la bataille jusqu'au bout par pas DT (la nuit y met
        fin au plus tard). Renvoie le nombre de pas."""
        if self.phase == 'deploiement':
            self.start()
        n = 0
        while self.phase == 'combat':
            if self.ask:
                OR.answer(self, 'go')   # (essais, bancs : le moment décisif ne s'attend pas)
            self.step(DT)
            n += 1
        return n

    def step(self, dt=DT):
        if self.phase != 'combat':
            return
        self.clock += dt
        left = self.dusk - self.clock
        self.light = 1.0 if left > 3600 else max(0.15, 0.15 + 0.85 * left / 3600)
        self._refresh_gens()
        self._astar_left = 3
        if self.clock - self._vis_t >= VIS_DT:
            self._update_vision()
        if self.clock - self._ai_t >= AI_DT:
            self._ai_t = self.clock
            self._think()
        alive = [u for u in self.units if u.alive]
        for u in alive:
            self._update_unit(u, dt)
        self._contacts(alive, dt)
        self._wagons(dt)
        if self.feu and self.clock - self._feu_t >= FEU_DT:
            self._feu_t = self.clock
            self._incendie()
        for u in alive:
            if u.alive:
                self._morale(u, dt)
        self._check_end()

    def _think(self):
        try:
            from . import ai as AI
        except Exception:   # pragma: no cover - l'IA est remplaçable
            return
        for side in (0, 1):
            if side in self.ai_sides or any(u.ctrl == 'ia' for u in self.units if u.side == side and u.alive):
                AI.think(self, side, AI_DT)

    # ------------------------------------------------------------------ repérage
    def _view_range(self, o):
        r = VIEW.get(self.weather, 1800) * max(0.25, self.light)
        if o.cls in ('cavalerie', 'general'):
            r *= 1.15
        if self.trait(o.side) == 'eclaireur':
            r *= 1.25
        return r

    def _update_vision(self):
        self._vis_t = self.clock
        for side in (0, 1):
            mine = [o for o in self.units if o.side == side and o.alive and o.state != 'hors']
            seen = set()
            bal = self.spec.get('balloon', [0, 0])[side]   # aérostiers : le ballon captif de l'état-major voit tout
            obs = [o for o in mine if o.cls == 'general' and not o.wounded] if bal else []
            eclaireur = self.trait(side) == 'eclaireur'
            for e in self.units:
                if e.side == side or not e.alive:
                    continue
                if any((o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= bal * bal for o in obs):
                    seen.add(e.id)
                    continue
                recent = self.clock - e.fired_t < 60
                ce = self.cell(e.x, e.y)
                hidden = self.t[ce] in WOODS or (self.t[ce] == T_BATI and e.cls != 'general')
                camo = e.cls == 'artillerie' and self.t[ce] in WOODS
                near = (100 if e.light else 150) + (100 if eclaireur else 0)
                he = self.h[ce]
                for o in mine:
                    d2 = (o.x - e.x) ** 2 + (o.y - e.y) ** 2
                    vr = self._view_range(o)
                    if self.h[self.cell(o.x, o.y)] > he + 10:
                        vr *= 1.2
                    if d2 > vr * vr:
                        continue
                    if camo and d2 > (CAMO_FIRE if recent else CAMO_SEEN) ** 2:
                        continue   # (canons camouflés dans un bois)
                    if recent:
                        seen.add(e.id)
                        break
                    if hidden and d2 > near * near and (e.light or self._deep(e, o, d2)):
                        continue   # (un bataillon posté à la lisière, face à qui regarde, se voit ; les légers non)
                    if d2 < 60 * 60 or self.los_units(o, e):
                        seen.add(e.id)
                        break
            self.seen_by[side] = seen
        for u in self.units:
            u.seen = u.id in self.seen_by[1 - u.side]

    def _deep(self, e, o, d2):
        """L'unité e est-elle enfoncée dans son bois ou ses maisons du côté de l'observateur o (la case à 40 m vers lui
        est encore du bois ou du bâti) ? Sinon elle est à la lisière, et se voit comme en terrain découvert."""
        d = math.sqrt(d2) or 1.0
        t = self.t[self.cell(e.x + (o.x - e.x) / d * 2 * CELL, e.y + (o.y - e.y) / d * 2 * CELL)]
        return t in WOODS or t == T_BATI

    # ------------------------------------------------------------------ une unité
    def _update_unit(self, u, dt):
        if u.busy > 0:
            u.busy -= dt
            if u.busy <= 0:
                u.busy = 0.0
                if u.next_form:
                    u.form = u.next_form
                    u.next_form = None
                if u.state == 'ralliement':
                    u.state = 'repos'
                    self.log(f"{u.name} s'est rallié.", u.side)
        if u.reload > 0:
            u.reload -= dt
        st = u.state
        if st == 'deroute':
            if u.halt:
                # près du général au calme (ou, sans général, loin de tout ennemi) : les fuyards s'arrêtent et leurs
                # officiers les reforment (voir _morale)
                self._fatigue(u, dt, 'repos')
                return
            self._move(u, dt, rout=True)
            if self.off_map(u.side, u.x, u.y):
                u.state = 'hors'
                self.log(f"{u.name} a fui le champ de bataille.", u.side)
            return
        if st == 'melee' or st == 'ralliement':
            self._fatigue(u, dt, 'melee' if st == 'melee' else 'repos')
            return
        if st == 'charge':
            self._charge(u, dt)
            return
        if u.order and u.order.get('kind') == 'retreat':
            if u.busy <= 0:
                u.still_t = self.clock
                self._flee(u, self._speed(u) * dt, self.costs(move_class(u), u.side))
                u.state = 'marche'
                if self.off_map(u.side, u.x, u.y):
                    u.state = 'hors'
                    self.log(f"{u.name} s'est retiré du champ de bataille.", u.side)
            return
        kind = u.order.get('kind') if u.order else None
        if kind == 'volley_charge' and self._volley_charge(u, dt):
            return
        if kind == 'harass':
            self._harass(u, dt)
        if u.order and u.order.get('kind') == 'attack':
            tg = self.by_id.get(u.target)
            if tg and tg.alive and tg.state != 'hors' and tg.id in self.seen_by[u.side]:
                e, mx, _ = U.ranges(u)
                d = self.dist(u, tg)
                if (d > e * 0.95 and not u.path) or (u.path and d < e * 0.9):
                    if u.busy <= 0 and (not u.path or d < e * 0.9):
                        self._approach(u, tg)
            elif u.path == [] and u.order.get('kind') == 'attack':
                u.order = dict(kind='hold')
        if u.path and u.busy <= 0:
            self._move(u, dt)
            if u.path:
                if kind == 'harass' and u.order.get('face') is not None:
                    u.dir = u.order['face']   # le tirailleur qui recule garde l'ennemi en face
                if u.cls == 'inf' and u.form == 'tirailleurs':
                    self._fire(u, dt, moving=True)
                return
            # arrivée
            if u.goal and u.goal[2] is not None:
                u.dir = u.goal[2]
            if u.order and u.order.get('kind') == 'retreat' and self.off_map(u.side, u.x, u.y):
                u.state = 'hors'
                self.log(f"{u.name} s'est retiré du champ de bataille.", u.side)
                return
            u.state = 'repos'
            if u.order and u.order.get('kind') == 'attack' and u.cls == 'artillerie':
                self._change_form(u, 'batterie')
        elif not u.path and u.state == 'marche':
            u.state = 'repos'
        self._fatigue(u, dt, 'repos')
        if u.busy <= 0:
            self._fire(u, dt)

    def _volley_charge(self, u, dt):
        """« Salve puis baïonnette » : approche, volée à bout portant, charge. Vrai si l'unité a fini son tour."""
        o = u.order
        tg = self.by_id.get(o.get('target'))
        if not (tg and tg.alive and tg.state != 'hors' and tg.id in self.seen_by[u.side]):
            u.order = dict(kind='hold')
            u.fire_mode = 'free'
            u.path, u.goal = [], None
            return False
        e, mx, _ = U.ranges(u)
        if u.ammo >= 1 and u.fired_t <= o.get('f0', o['t0']):
            u.fire_mode = 'volley'   # (un « cessez le feu » donné entre-temps ne bloque pas la volée)
            d = self.dist(u, tg)
            if d > e * (VOLLEY_CHARGE_AT + 0.1):
                o.pop('ready', None)
                if u.busy <= 0 and not u.path:
                    self._approach_to(u, tg, e * VOLLEY_CHARGE_AT)
                return False   # (en marche : le mouvement et le tir suivent leur cours normal)
            u.path, u.goal = [], None   # à bonne portée : on s'arrête et la volée part dès que les fusils sont chargés
            o.setdefault('ready', self.clock)
            if self.clock - o['ready'] < VOLLEY_WAIT:
                return False   # (pas de ligne de tir : on n'attend pas indéfiniment, on charge)
        # salve tirée (ou plus de cartouches) : à la baïonnette
        u.fire_mode = 'free'
        u.order = dict(kind='charge', target=tg.id)
        u.target = tg.id
        if u.form == 'carre':
            u.form = 'colonne'
        u.state = 'charge'
        u.charge_v = 0.0
        u.path = []
        self.emit('charge', u.x, u.y, tg.x, tg.y, src=u.id)
        return True

    def _harass(self, u, dt):
        """Tirailleurs qui harcèlent : à portée efficace de l'ennemi, ils reculent s'il approche, avancent s'il s'éloigne."""
        o = u.order
        if self.clock < o.get('next', 0.0) or u.busy > 0 or u.state in ('melee', 'charge'):
            return
        o['next'] = self.clock + HARASS_EVERY
        foe = self.nearest_foe(u)
        e, mx, _ = U.ranges(u)
        if foe is None or self.dist(u, foe) > mx * 1.6:
            return
        d = self.dist(u, foe)
        b = self.bearing(u, foe)
        o['face'] = b
        if d < e * HARASS_NEAR:
            back = e * 0.95 - d + 30
            self._go(u, u.x - math.cos(b) * back, u.y - math.sin(b) * back, b, run=True)
            o['face'] = b
        elif d > e * HARASS_FAR:
            step = d - e * 0.9
            self._go(u, u.x + math.cos(b) * step, u.y + math.sin(b) * step, b)
        else:
            u.path, u.goal = [], None
            u.dir = b

    def _speed(self, u, run=False, rout=False):
        base = U.TYPE.get(u.type, U.TYPE['ligne'])['speed']
        if u.cls == 'artillerie' and u.form == 'batterie':
            return 0.0
        if run or rout:
            base = {'cavalerie': 5.0, 'general': 5.0, 'artillerie': 2.0}.get(u.cls, 2.2)
            if run and u.cls == 'cavalerie':
                base = 3.5
        else:
            base *= U.FORM_SPEED.get(u.form, 1.0) if u.cls == 'inf' else (1.0 if u.form != 'ligne' or u.cls != 'cavalerie' else 0.85)
        tr = self.trait(u.side)
        if tr == 'cavalier' and u.cls == 'cavalerie':
            base *= 1.1
        return base * (1 - 0.35 * u.fat / 100)

    def _move(self, u, dt, rout=False):
        u.still_t = self.clock
        cost = self.costs(move_class(u), u.side)
        run = bool(u.goal and u.goal[3])
        sp = self._speed(u, run=run, rout=rout)
        if sp <= 0:
            return
        if rout and not u.path:
            self._flee(u, sp * dt, cost)
            return
        budget = sp * dt
        steps = 0
        moved = 0.0
        while budget > 0.01 and u.path and steps < 6:
            steps += 1
            c = self.cell(u.x, u.y)
            cc = cost[c] if cost[c] is not None else 1.5
            # pente
            tx, ty = u.path[0]
            dx, dy = tx - u.x, ty - u.y
            L = math.hypot(dx, dy)
            if L < 1.0:
                u.path.pop(0)
                continue
            nxp, nyp = u.x + dx / L * min(L, CELL), u.y + dy / L * min(L, CELL)
            dh = self.h[self.cell(nxp, nyp)] - self.h[c]
            slope = 1.0 + max(0.0, dh) / CELL * (2.0 if self.trait(u.side) == 'montagnard' else 4.0)
            k = cc * slope
            step = min(L, budget / k)
            nx, ny = u.x + dx / L * step, u.y + dy / L * step
            inside = 0 <= nx < W and 0 <= ny < H
            if inside and cost[self.cell(nx, ny)] is None and cost[c] is not None:
                u.stuck += 1
                if u.stuck <= 2 and u.goal:
                    u.path = self.plan_path(u, u.goal[0], u.goal[1])
                    continue
                u.path = []
                break
            u.dir = math.atan2(dy, dx) if not rout else u.dir
            if rout:
                u.dir = math.atan2(dy, dx)
            u.x, u.y = nx, ny
            if not inside:
                u.x, u.y = min(max(nx, -40), W + 40), min(max(ny, -40), H + 40)
            budget -= step * k
            moved += step
            if step >= L - 0.01:
                u.path.pop(0)
        if moved > 0:
            self._fatigue(u, dt, 'run' if (run or rout) else 'marche', self.costs(move_class(u), u.side)[self.cell(u.x, u.y)] or 1.0)

    def _flee(self, u, dist, cost):
        """Fuite d'une troupe en déroute : vers son bord, en obliquant devant l'eau, les murs ou les bois épais."""
        ex, ey = self.edge_point(u.side, u.x, u.y)
        base = math.atan2(ey - u.y, ex - u.x)
        c0 = cost[self.cell(u.x, u.y)] or 1.5
        step = min(CELL, dist / c0)
        for da in (0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2):
            a = base + da
            nx, ny = u.x + math.cos(a) * step, u.y + math.sin(a) * step
            if not (0 <= nx < W and 0 <= ny < H):
                u.x, u.y, u.dir = nx, ny, a   # il sort de la carte
                return
            if cost[self.cell(nx, ny)] is not None:
                u.x, u.y, u.dir = nx, ny, a
                self._fatigue(u, DT, 'run')
                return

    def _fatigue(self, u, dt, what, cost=1.0):
        k = 1.5 if self.weather == 'canicule' else 1.0
        if what == 'marche':
            d = 0.005 * min(3.0, cost) * k
        elif what == 'run':
            d = 0.015 * k if u.cls != 'cavalerie' else 0.02 * k
        elif what == 'melee':
            d = 0.03 * k
        elif what == 'feu':
            d = 0.002 * k
        else:
            d = -0.007 if self.clock - u.hit_t > 30 else -0.002
        u.fat = min(100.0, max(0.0, u.fat + d * dt))

    # ------------------------------------------------------------------ feu
    def _wx_k(self, u):
        w = self.weather
        if w in ('pluie', 'orage', 'tempete'):
            if u.cls == 'inf':
                return 0.5 if u.arm <= 2 else 0.85
            return 0.85
        if w == 'neige':
            return 0.8 if u.cls == 'inf' and u.arm <= 2 else 0.9
        if w == 'brouillard':
            return 0.9
        return 1.0

    def _pick_target(self, u, mx):
        seen = self.seen_by[u.side]
        cur = self.by_id.get(u.target)
        if cur and cur.alive and cur.id in seen and cur.state != 'hors':
            if self.dist(u, cur) <= mx and self.los_units(u, cur):
                return cur
        best, bv = None, -1e9
        for e in self.units:
            if e.side == u.side or not e.alive or e.id not in seen:
                continue
            d = math.hypot(e.x - u.x, e.y - u.y)
            if d > mx:
                continue
            v = -d - ang_diff(u.dir, math.atan2(e.y - u.y, e.x - u.x)) * 150
            if e.state == 'deroute':
                v -= 400
            if e.cls in ('chariot', 'general'):
                v -= 300
            if u.cls == 'artillerie' and e.form in ('colonne', 'carre'):
                v += 250
            if u.prio == 'artillerie' and e.cls == 'artillerie':
                v += 700   # contre-batterie : les canons ennemis d'abord
            if v > bv and self.los_units(u, e):
                best, bv = e, v
        if best is not None:
            u.target = best.id
        return best

    # ================================================================== maisons touchées, en feu, en ruine
    def _bati_hit(self, x, y, u):
        """Un boulet de u tombe en (x, y) : la case bâtie s'entame ou prend feu (BATI_*)."""
        c = self.cell(x, y)
        if self.t[c] != T_BATI or self.bati[c] >= 2:
            return
        p = (BATI_FEU_CHAUME if c in self.chaume else BATI_FEU) * (1 + 2 * self.ufx(u, 'shell'))
        if self.rng.random() < p:
            self._bati_set(c, 2)
        elif self.bati[c] == 0 and self.rng.random() < BATI_TOUCHE:
            self._bati_set(c, 1)

    def _bati_set(self, c, e):
        self.seq += 1
        self.bati_log.append([self.seq, c, e, round(self.clock)])
        self._bati_mark(c, e, self.clock)

    def _bati_mark(self, c, e, t0):
        self.bati[c] = e
        if e == 2:
            self.feu[c] = t0
        else:
            self.feu.pop(c, None)
        if e == 3:
            self._los_cache.clear()   # (une ruine laisse passer la vue)

    def _incendie(self):
        """Toutes les FEU_DT : les maisons brûlées tombent en ruine, le feu gagne les voisines, et la troupe qui est
        dans une maison en feu en sort."""
        t, bt = self.t, self.bati
        wet = 0.4 if self.weather in ('pluie', 'orage', 'tempete', 'neige') else 1.0
        for c, t0 in list(self.feu.items()):   # (ordre d'arrivée : même graine, même incendie)
            if self.clock - t0 >= FEU_DUREE:
                self._bati_set(c, 3)
                continue
            i, j = c % COLS, c // COLS
            for cc in (c - 1 if i > 0 else -1, c + 1 if i < COLS - 1 else -1, c - COLS if j > 0 else -1,
                       c + COLS if j < ROWS - 1 else -1):
                if cc >= 0 and t[cc] == T_BATI and bt[cc] < 2 and \
                        self.rng.random() < FEU_PROPAG * wet * (2.5 if cc in self.chaume else 1.0):
                    self._bati_set(cc, 2)
        for u in self.units:
            c = self.cell(u.x, u.y)
            if bt[c] == 2 and t[c] == T_BATI and u.alive and u.state != 'melee':
                u.x, u.y = self.nearest_passable(u, u.side, u.x, u.y, hors_feu=True)
                u.morale = max(0.0, u.morale - FEU_MOR)
                self.log(f"{u.name} quitte une maison en feu.", u.side, u.side)

    # ================================================================== brèches ouvertes au canon
    def _wall_target(self, u, mx, aim=None):
        """Point de l'enceinte d'une place le plus proche du canon (ou, avec aim, du point visé), à portée :
        (mur, x, y, distance) ou None."""
        pl = self.map.place
        if u.side != 0 or u.cls != 'artillerie' or not pl or not pl.get('battle'):
            return None
        best, bv = None, 1e18
        for wi, w in enumerate(self.map.walls):
            if w.get('kind') == 'barricade':
                continue
            for x, y in w['pts']:
                d = math.hypot(x - u.x, y - u.y)
                v = d if aim is None else math.hypot(x - aim[0], y - aim[1])
                if d < mx and v < bv:
                    best, bv = (wi, x, y, d), v
        return best

    def _bombard(self, u, e, mx, aim=None):
        """Canon de l'assaillant sans cible : il bat le rempart à portée. Vrai s'il s'en occupe."""
        wt = self._wall_target(u, mx, aim)
        if not wt:
            return False
        wi, x, y, d = wt
        b = math.atan2(y - u.y, x - u.x)
        if ang_diff(u.dir, b) > ARC.get(u.form, 1.0):
            rate = TURN.get(u.form, 0.1)
            delta = (b - u.dir + math.pi) % (2 * math.pi) - math.pi
            u.dir += max(-rate * DT, min(rate * DT, delta))
            return True
        if u.reload > 0:
            u.state = 'recharge'
            return True
        u.ammo = max(0.0, u.ammo - 1)
        u.reload = U.reload_time(u)
        u.fired_t = self.clock
        u.state = 'feu'
        self._fatigue(u, u.reload, 'feu')
        self.emit('canon', u.x, u.y, x, y, n=0, src=u.id)
        self._pound(u, wi, x, y, d, e, mx)
        return True

    def _pound(self, u, wi, x, y, d, e, mx):
        pl = self.map.place
        a = math.atan2(y - pl['y'], x - pl['x'])
        k = str(int((a % (2 * math.pi)) / (2 * math.pi) * BREACH_SECT) % BREACH_SECT)
        if self.pound.get(k, 0.0) < 0:
            return   # ce pan est déjà à terre
        if self.siege_t is None:
            self.siege_t = self.clock
        mult = R.ARMS['artillerie'][min(u.arm, len(R.ARMS['artillerie']) - 1)][2]
        dk = 1.0 if d <= e else max(0.3, 1 - 0.7 * (d - e) / max(1.0, mx - e))
        self.pound[k] = self.pound.get(k, 0.0) + U.pieces(u) * mult * dk
        if self.pound[k] >= BREACH_PTS * max(1, pl.get('fort', 1)):
            self.pound[k] = -1.0
            self._apply_breach(wi, x, y, BREACH_R)
            self.breach_t.append([round(self.clock), k])
            self.log('Les canons ont ouvert une brèche dans le rempart !')
            mem = self.ai_mem.get('s1')
            if isinstance(mem, dict) and 'breach' in mem:   # la garnison (IA) la défendra
                mem['breach'].append([round(x - math.cos(a) * 40), round(y - math.sin(a) * 40), round(a, 3)])

    def _apply_breach(self, wi, x, y, r):
        i0, i1 = max(0, int((x - r - 20) // CELL)), min(COLS - 1, int((x + r + 20) // CELL))
        j0, j1 = max(0, int((y - r - 20) // CELL)), min(ROWS - 1, int((y + r + 20) // CELL))
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                c = j * COLS + i
                if self.t[c] == T_MUR and math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y) <= r + 10:
                    self.t[c] = T_BRECHE
        self.map.walls[wi].setdefault('breach', []).append([round(x), round(y), round(r)])
        self.breaches.append([wi, round(x), round(y), round(r)])
        self._cost_cache = {}
        self._path_cache = {}
        self._los_cache = {}

    def _fire(self, u, dt, moving=False):
        if u.ammo < 1 and u.state in ('feu', 'recharge'):
            u.state = 'repos'   # plus de munitions : on ne reste pas en position de tir
        if u.fire_mode == 'hold' and not (u.order and u.order.get('kind') == 'attack'):
            return
        volley = u.fire_mode == 'volley' and u.cls == 'inf'
        if u.ammo < 1 or u.cls in ('general', 'chariot') or u.state in ('deroute', 'hors', 'melee', 'charge', 'ralliement'):
            return
        if u.cls == 'artillerie' and u.form != 'batterie':
            return
        if u.reload > DT * 1.5 and not moving:
            # en plein rechargement : on garde sa cible et on pivote vers elle
            tg = self.by_id.get(u.target)
            if tg is not None and tg.alive and u.cls != 'cavalerie':
                b = self.bearing(u, tg)
                if ang_diff(u.dir, b) > ARC.get(u.form, 1.0):
                    rate = TURN.get(u.form, 0.1)
                    delta = (b - u.dir + math.pi) % (2 * math.pi) - math.pi
                    u.dir += max(-rate * DT, min(rate * DT, delta))
            return
        e, mx, grape = U.ranges(u)
        if volley:
            mx = min(mx, e * VOLLEY_RANGE)   # feu de salve : seulement quand tout porte
        elif u.cls == 'inf' and not (u.order and u.order.get('kind') == 'attack'):
            # feu à volonté : l'infanterie attend que l'ennemi soit à bonne portée (on ménage les cartouches)
            mx = min(mx, e * 1.3)
        hu = self.height_at(u.x, u.y)
        if u.order and u.order.get('kind') == 'bombard':
            # batterie de brèche : elle ne se détourne du rempart que pour se défendre à mitraille
            tg = self._pick_target(u, grape)
            if not tg and self._bombard(u, e, mx, (u.order['x'], u.order['y'])):
                return
        else:
            tg = self._pick_target(u, mx * 1.15)
            if not tg and u.type != 'mitrailleuses' and self._bombard(u, e, mx):
                return
        if not tg:
            if u.state in ('feu', 'recharge'):
                u.state = 'repos'
            return
        d = self.dist(u, tg)
        ht = self.height_at(tg.x, tg.y)
        mx_eff = mx * (1.15 if hu > ht + 8 else 1.0)
        if d > mx_eff:
            return
        b = self.bearing(u, tg)
        arc = ARC.get(u.form, 1.0) if u.cls != 'cavalerie' else 1.2
        if ang_diff(u.dir, b) > arc:
            # la troupe pivote vers sa cible
            rate = TURN.get(u.form, 0.1) * (2 if u.cls == 'cavalerie' else 1)
            delta = (b - u.dir + math.pi) % (2 * math.pi) - math.pi
            u.dir += max(-rate * dt, min(rate * dt, delta))
            return
        if u.reload > 0:
            u.state = 'recharge' if not moving else u.state
            return
        # salve
        tr = self.trait(u.side)
        fat_k = 1 - 0.3 * u.fat / 100
        mor_k = 0.6 + 0.4 * u.morale / 100
        xp_k = ST.xp_k(u.xp)
        cov = self._fire_cover(tg, u)
        pr = U.precision(u, d)
        tk = U.TYPE.get(u.type, U.TYPE['ligne'])['fire']
        if u.type == 'mitrailleuses':
            # feu roulant : une gerbe de balles sur une bande étroite, comme une salve ; ni boulet, ni mitraille
            cas = U.pieces(u) * P_REFFYE * pr * VUL_FIRE.get(tg.form, 1.0) * (1 - cov)
            if tg.cls == 'artillerie':
                cas *= REFFYE_VS_PIECE
            if tg.cls == 'general':
                cas *= 0.3
            cas *= fat_k * mor_k * xp_k * self._wx_k(u) * self.light ** 0.5
            kind = 'salve'
            u.ammo -= 1
        elif u.cls == 'artillerie':
            pcs = U.pieces(u)
            mult = R.ARMS['artillerie'][min(u.arm, len(R.ARMS['artillerie']) - 1)][2]
            if tr == 'artilleur':
                mult *= 1.25
            use_grape = bool(grape) and d <= grape and u.shot != 'boulet'
            if u.shot == 'mitraille' and not use_grape:
                return   # (mitraille ordonnée : les canons attendent l'ennemi à portée de gerbe)
            if use_grape:
                cas = pcs * P_MITRAILLE * grape_k(d, grape) * mult * VUL_GRAPE.get(tg.form, 1.0) * (1 - cov)
                kind = 'mitraille'
            else:
                cas = pcs * P_BOULET * mult * ball_k(d, e) * VUL_BALL.get(tg.form, 1.0) * (1 - cov * 0.6)
                kind = 'canon'
            if tg.cls == 'general':
                cas *= 0.2
            cas *= fat_k * mor_k * xp_k * self._wx_k(u) * self.light ** 0.5
            u.ammo -= 1
        else:
            shooters = u.men * (U.FRONT.get(u.form, 1.0) if u.cls == 'inf' else 0.5)
            if moving:
                shooters *= 0.5
            mult = R.ARMS['inf'][min(u.arm, len(R.ARMS['inf']) - 1)][2] if u.cls == 'inf' else 0.8
            p0 = P_FUSIL * tk * math.sqrt(mult)
            cas = shooters * p0 * pr * fat_k * mor_k * xp_k * self._wx_k(u) * (1 - cov) * VUL_FIRE.get(tg.form, 1.0)
            cas *= self.light ** 0.5
            if tg.cls == 'general':
                cas *= 0.3
            if u.light and self.t[self.cell(u.x, u.y)] in WOODS:
                cas *= 1.15
            kind = 'salve'
            u.ammo -= 1
            if volley:
                cas *= VOLLEY_POWER
        # technologies de l'armée, comme en résolution automatique (engine.reg_power, phases) : toutes armes, l'arme ;
        # feu de rang et de peloton en ligne ; feu de peloton du carré sur les escadrons ; artillerie à cheval à mitraille
        md = self.tech_of(u)
        cas *= ST.power_k(md, u.cls)
        if u.cls == 'artillerie' and self.t[self.cell(u.x, u.y)] in WOODS:
            cas *= CAMO_FIRE_K   # (les troncs gênent le tir des canons camouflés)
        if u.cls == 'inf' and u.form == 'ligne':
            cas *= 1 + md.get('ligne_fire', 0.0)
        elif u.cls == 'inf' and u.form == 'carre' and tg.cls == 'cavalerie':
            cas *= 1 + md.get('carre_fire', 0.0)
        elif kind == 'mitraille':
            cas *= 1 + md.get('art_charge', 0.0)
        u.ammo = max(0.0, u.ammo)
        u.reload = U.reload_time(u) * (VOLLEY_RELOAD if volley else 1.0)
        u.fired_t = self.clock
        u.state = 'feu' if not moving else u.state
        u.fought += u.reload
        self._fatigue(u, u.reload, 'feu')
        cas *= self._entrench_k(tg, u)
        self.emit(kind, u.x, u.y, tg.x, tg.y, n=cas, src=u.id)
        if kind == 'canon':
            self._bati_hit(tg.x, tg.y, u)
        if kind == 'canon' and u.side == 0 and self.in_place(tg.x, tg.y, 0.0):
            # les boulets tirés sur les défenseurs de la place frappent aussi son rempart
            wt = self._wall_target(u, mx)
            if wt:
                self._pound(u, *wt, e, mx)
        if self._in_breach(tg):
            cas *= BRECHE_FEU   # (les feux croisés des flancs de la brèche)
        self._damage(tg, cas, u, kind)
        if u.ammo < 1:
            self.log(f"{u.name} n'a plus de munitions !", u.side)

    def _fire_cover(self, tg, shooter):
        """Couvert de la cible sous le feu : l'obus à la mélinite de l'artillerie le perce à moitié."""
        cov = self._cover_vs(tg, shooter)
        if shooter.cls == 'artillerie' and shooter.type != 'mitrailleuses':   # (des obus : pas les mitrailleuses)
            cov *= 1 - self.ufx(shooter, 'shell')
        return cov

    def _entrench_k(self, tg, shooter):
        """Retranchements : l'infanterie arrêtée depuis ENTRENCH_T s'est enterrée et perd moins d'hommes au feu (moitié
        moins d'abri contre les obus à la mélinite)."""
        k = self.ufx(tg, 'entrench')
        if tg.id in (self.spec.get('logement') or ()):
            k = max(k, LOGEMENT_K)
        if not k or tg.cls != 'inf' or self.clock - tg.still_t < ENTRENCH_T:
            return 1.0
        if shooter.cls == 'artillerie' and shooter.type != 'mitrailleuses':
            k *= 1 - self.ufx(shooter, 'shell')
        return 1 - k

    def _cover_vs(self, tg, shooter):
        """Couvert de la cible face à ce tireur : sa case, et un mur ou une barricade juste devant elle."""
        c = self.cover_at(tg.x, tg.y)
        if tg.cls == 'chariot':
            return 0.0
        if tg.light and self.t[self.cell(tg.x, tg.y)] in WOODS:
            c += 0.1
        dx, dy = shooter.x - tg.x, shooter.y - tg.y
        L = math.hypot(dx, dy) or 1.0
        for k in (1, 2, 3):
            cc = self.cell(tg.x + dx / L * CELL * k, tg.y + dy / L * CELL * k)
            t = self.t[cc]
            if t in WALLISH:
                c = max(c, WALLISH[t])
                break
            if k == 1 and self.f[cc]:   # derrière une haie, un muret, une clôture
                c = max(c, FCOVER[self.f[cc]])
        return min(0.75, c)

    def _damage(self, tg, cas, src, kind):
        if cas <= 0 or not tg.alive:
            return
        cas = min(tg.men, cas)
        tg.men -= cas
        tg.lost += cas
        tg.hit_t = self.clock
        tg.fought += 2.0
        if src is not None:
            src.killed += cas
        # moral : pertes (surtout brutales), feu de flanc ou de dos
        shock = 1.5 if cas > 0.03 * max(1.0, tg.men + cas) else 1.0
        if src is not None and not (tg.order and tg.order.get('kind') == 'retreat'):
            # (une troupe qui se retire en ordre tourne le dos à l'ennemi sans être surprise)
            a = ang_diff(tg.dir, math.atan2(src.y - tg.y, src.x - tg.x))
            if a > 2.3:
                shock *= 1.8
            elif a > 1.2 and tg.form != 'carre':
                shock *= 1.4
        steady = U.TYPE.get(tg.type, U.TYPE['ligne'])['steady']
        k = 140.0 / steady
        tr = self.trait(tg.side)
        if tr == 'inspirant':
            k *= 0.85
        elif tr == 'prudent' and tg.side == 1:
            k *= 0.9
        if self.general_near(tg):
            k *= 0.85
        tg.morale = max(0.0, tg.morale - cas / max(30.0, tg.men0) * k * shock)
        if tg.cls == 'general' and tg.men < 22 and not tg.wounded:
            tg.wounded = True
            tg.state = 'hors'
            self.log(f"Le général {(tg.gen or {}).get('name', '')} est blessé et emporté loin du feu !", None)
        if tg.men < 8 and tg.state != 'hors':
            tg.state = 'hors'
            tg.lost += max(0.0, tg.men)   # les derniers hommes sont dispersés : le régiment ne revient pas en campagne
            tg.men = 0.0
            self.log(f"{tg.name} est anéanti.", None, tg.side)

    # ------------------------------------------------------------------ charges et mêlées
    def _charge(self, u, dt):
        tg = self.by_id.get(u.target)
        if not tg or not tg.alive or tg.state == 'hors':
            u.state = 'repos'
            u.order = dict(kind='hold')
            return
        d = self.dist(u, tg)
        cav = u.cls == 'cavalerie'
        if cav:
            sp = 3.5 if d > 250 else 7.0
        else:
            sp = 1.4 if d > 150 else 2.5
        sp *= 1 - 0.35 * u.fat / 100
        mc = move_class(u)
        c0 = self.cell(u.x, u.y)
        cc = self.costs(mc, u.side)[c0] or 2.0
        sp /= cc
        step = min(d, sp * dt)
        b = self.bearing(u, tg)
        nx, ny = u.x + math.cos(b) * step, u.y + math.sin(b) * step
        if not self._passable_u(u, nx, ny):
            # obstacle : on contourne par un chemin, puis on reprend la charge
            u.state = 'marche'
            u.order = dict(kind='attack', target=tg.id)
            u.charge_v = 0.0
            self._go(u, tg.x, tg.y, b)
            return
        # élan (charge_v, en mètres de course utile) : il se gagne en courant ; le terrain difficile, les haies et la
        # montée le brisent, la descente l'augmente un peu
        brake = (BRAKE_CAV if cav else BRAKE_INF).get(self.t[c0], 1.0)
        if self.f[c0]:
            brake *= 0.75 if cav else 0.9
        grade = (self.h[self.cell(nx, ny)] - self.h[c0]) / CELL
        slope = max(0.3, 1 - 4 * grade) if grade > 0 else min(1.2, 1 - 2 * grade)
        full = ELAN_M['cav' if cav else 'inf']
        u.charge_v = min(full, u.charge_v * (0.5 + 0.5 * brake) + step * brake * slope)
        u.x, u.y, u.dir = nx, ny, b
        u.still_t = self.clock   # (qui charge sort de ses retranchements)
        self._fatigue(u, dt, 'run')
        wt, dtg = U.footprint(tg)
        wu, _ = U.footprint(u)
        if self.dist(u, tg) <= 12 + (wt + wu) / 5 + dtg / 2:
            self._impact(u, tg)

    def _impact(self, a, tg):
        """Le choc d'une charge : élan (course utile, terrain, pente), flanc ou dos, ordre de la cible. Une troupe en bon
        ordre, de face, reçoit la charge par un feu à bout portant et, si elle tient, la repousse ; prise de flanc, de
        dos, en désordre, en tirailleurs ou en pleine manœuvre, elle est culbutée."""
        cav = a.cls == 'cavalerie'
        mom = ST.ELAN['cavalerie' if cav else 'inf']
        if cav or a.form == 'colonne':
            mom *= ST.charge_k(self.tech_of(a), a.cls)   # cuirassiers ; ordre mixte (la colonne)
        mom *= 1 - a.fat / (120 if cav else 150)   # des chevaux essoufflés chargent mal
        elan = min(1.0, max(0.0, a.charge_v) / ELAN_M['cav' if cav else 'inf'])
        a.charge_v = 0.0
        a.fat = min(100.0, a.fat + CHARGE_FAT['cav' if cav else 'inf'])
        mom *= 0.3 + 0.7 * elan
        tt = self.t[self.cell(tg.x, tg.y)]
        # bois, rochers, marais, maisons, murs : la charge s'y brise
        mom *= (BRAKE_CAV if cav else BRAKE_INF).get(tt, 1.0)
        if cav and self.trait(a.side) == 'cavalier':
            mom *= 1.2
        if self.trait(a.side) == 'audacieux':
            mom *= 1.12
        ang = ang_diff(tg.dir, math.atan2(a.y - tg.y, a.x - tg.x))
        flank = 2.0 if ang > 2.3 else (1.5 if ang > 1.2 and tg.form != 'carre' else 1.0)
        self.emit('impact', tg.x, tg.y, n=a.men, src=a.id)
        if tg.cls == 'chariot':
            self._take_wagon(tg, a)
            a.state = 'repos'
            return
        if tg.state == 'deroute':
            # (des chevaux essoufflés, une charge sans élan ramassent moins de fuyards)
            frac = CAPTURE['choc_cav'] if cav else CAPTURE['choc_inf']
            self._capture(a, tg, frac * min(1.0, mom / ST.ELAN['cavalerie' if cav else 'inf']))
            a.state = 'repos'
            return
        if cav and tg.form == 'carre' and tg.busy <= 0:
            # le carré brise la charge
            back = self._melee_k(tg, a) * tg.men * 0.04
            self._damage(a, back, tg, 'impact')
            a.morale = max(0.0, a.morale - 18)
            self._damage(tg, a.men * 0.01, a, 'impact')
            self._repulse(a, tg)
            self.log(f"La charge de {a.name} se brise sur le carré de {tg.name} !", None, a.side)
            return
        # feu de défense : de face, une troupe en ordre (ou une batterie chargée) tire à bout portant sur ceux qui
        # chargent
        ready = flank == 1.0 and tg.busy <= 0 and tg.ammo >= 1 and tg.state not in ('melee', 'ralliement', 'charge') and \
            ((tg.cls == 'inf' and tg.form in ('ligne', 'colonne', 'tirailleurs')) or
             (tg.cls == 'artillerie' and tg.form == 'batterie'))
        if ready:
            if tg.type == 'mitrailleuses':
                # la mitrailleuse : trois gerbes à bout portant, sans mitraille (si serrées qu'elles ne fauchent qu'une
                # file ou deux)
                vol = U.pieces(tg) * P_REFFYE * 1.2 * (0.6 + 0.4 * tg.morale / 100)
                kind = 'salve'
            elif tg.cls == 'artillerie':
                # deux décharges de mitraille à bout portant pendant que la charge arrive (la gerbe serrée : ×2,2) ;
                # aborder une batterie de face coûte très cher, la prendre de flanc ou de dos ne coûte rien
                vol = U.pieces(tg) * P_MITRAILLE * GRAPE_POINT * 1.4 * (0.6 + 0.4 * tg.morale / 100) * \
                    (1 + self.tech_of(tg).get('art_charge', 0.0))
                kind = 'mitraille'
            else:
                vol = tg.men * U.FRONT.get(tg.form, 1.0) * P_RECEPTION * (0.5 + 0.5 * tg.morale / 100) * \
                    ST.xp_k(tg.xp) * self._wx_k(tg)
                kind = 'salve'
            vol *= ST.power_k(self.tech_of(tg), tg.cls)
            vol *= (VUL_FIRE if tg.cls == 'inf' else VUL_GRAPE).get(a.form, 1.0)
            tg.ammo = max(0.0, tg.ammo - 1)
            tg.reload = max(tg.reload, U.reload_time(tg))
            tg.fired_t = self.clock
            self.emit(kind, tg.x, tg.y, a.x, a.y, n=vol, src=tg.id)
            self._damage(a, vol, tg, kind)
            if not a.alive:
                return
            if not cav and a.morale < FALTER:
                # la colonne hésite sous le feu et s'arrête court
                self._repulse(a, tg, 60.0)
                self.log(f"La charge de {a.name} s'arrête sous le feu de {tg.name}.", None, a.side)
                return
        # une troupe en bon ordre, de face, encaisse le choc sans se rompre
        formed = flank == 1.0 and tg.busy <= 0 and tg.morale >= FORMED and tg.state != 'ralliement' and \
            tg.cls == 'inf' and tg.form in ('ligne', 'colonne')
        vul = 1.0
        if cav:
            vul = dict(ligne=1.2, tirailleurs=1.6, colonne=1.0, attelee=1.7, batterie=1.4).get(tg.form, 1.0)
            if tg.cls == 'cavalerie':
                vul = 0.8   # escadrons contre escadrons : on se sabre moins qu'on ne se bouscule
            if tg.busy > 0 and tg.next_form == 'carre':
                vul = 1.9   # pris en pleine manœuvre
        if formed:
            vul *= 0.4
        cas = a.men * CHOC * mom * flank * vul * U.TYPE.get(a.type, U.TYPE['ligne'])['melee'] * (0.5 + a.morale / 200)
        cas *= ST.power_k(self.tech_of(a), a.cls)
        self._damage(tg, cas, a, 'impact')
        shock = 6 * mom * flank * (1.3 if cav and tg.form in ('ligne', 'tirailleurs') else 1.0)
        tg.morale = max(0.0, tg.morale - shock * (0.5 if formed else 1.0))
        if tg.morale < 25:
            self._rout(tg)
            if cav:
                self._capture(a, tg, CAPTURE['rupture_cav'])
            a.state = 'repos'
            return
        if formed and cav and tg.morale >= HOLD:
            # la ligne a tenu : les cavaliers tournent bride
            a.morale = max(0.0, a.morale - 8)
            self._repulse(a, tg)
            self.log(f"{tg.name} repousse la charge de {a.name}.", None, a.side)
            return
        a.state = tg.state = 'melee'
        a.melee_with, tg.melee_with = tg.id, a.id
        a.path, tg.path = [], []

    def _repulse(self, a, tg, dist=120.0):
        """Charge repoussée : la troupe se replie de dist mètres face à l'ennemi, puis attend les ordres."""
        a.state = 'repos'
        a.order = dict(kind='hold')
        a.charge_v = 0.0
        b = math.atan2(a.y - tg.y, a.x - tg.x)
        gx, gy = min(max(a.x + math.cos(b) * dist, 10), W - 10), min(max(a.y + math.sin(b) * dist, 10), H - 10)
        self._go(a, gx, gy, b + math.pi)

    def _melee_k(self, u, foe):
        k = U.TYPE.get(u.type, U.TYPE['ligne'])['melee']
        k *= (0.5 + u.morale / 200) * ST.xp_k(u.xp) * (1 - u.fat / 250) * ST.power_k(self.tech_of(u), u.cls)
        if u.form == 'carre' and foe.cls == 'cavalerie':
            k *= 2.5
        elif u.form == 'tirailleurs':
            k *= 0.7
        tt = self.t[self.cell(u.x, u.y)]
        if tt in (T_MUR, T_PORTE, T_BARRICADE) and u.side == 0:
            k *= 0.6   # l'assaillant à cheval sur l'obstacle (à l'échelle, sur la barricade) se bat mal
        elif tt == T_BATI:
            k *= 1.4
        elif tt != T_BRECHE and self._cover_vs(u, foe) >= 0.5:
            k *= 1.5   # derrière un mur, une barricade, une haie épaisse
        if foe.cls == 'cavalerie' and tt in (T_BOIS, T_FORET_T, T_MARAIS_T, T_VIGNE_T):
            k *= 1.4
        if self._in_breach(u):
            k *= BRECHE_MELEE
        if self.trait(u.side) == 'audacieux':
            k *= 1.08
        return k

    def _in_breach(self, u):
        """L'assaillant sur une brèche ou à une case de ses bords (BRECHE_*)."""
        if u.side != 0 or not self.map.place:
            return False
        i, j = int(u.x // CELL), int(u.y // CELL)
        t = self.t
        return any(t[jj * COLS + ii] == T_BRECHE for jj in range(max(0, j - 1), min(ROWS, j + 2))
                   for ii in range(max(0, i - 1), min(COLS, i + 2)))

    def _melee_men(self, u):
        """Hommes engagés en mêlée : pas plus de BRECHE_FRONT de front dans une brèche."""
        return min(u.men, BRECHE_FRONT) if self._in_breach(u) else u.men

    def _end_melee(self, u):
        f = self.by_id.get(u.melee_with)
        u.melee_with = None
        if u.state == 'melee':
            u.state = 'repos'
        if f and f.melee_with == u.id:
            f.melee_with = None
            if f.state == 'melee':
                f.state = 'repos'

    def _contacts(self, alive, dt):
        # mêlées en cours ; plusieurs troupes peuvent s'acharner sur une même : leurs forces s'additionnent
        fights = []
        press = {}
        for u in alive:
            if u.state != 'melee':
                continue
            f = self.by_id.get(u.melee_with)
            if not f or not f.alive or f.state != 'melee':
                self._end_melee(u)   # (l'adversaire a fui, cédé du terrain ou s'est dégagé)
                continue
            ku = self._melee_k(u, f) * self._melee_men(u)
            fights.append((u, f, ku))
            press[f.id] = press.get(f.id, 0.0) + ku
        for u, f, ku in fights:
            if u.state != 'melee' or f.state != 'melee':
                continue
            kf = self._melee_k(f, u) * self._melee_men(f)
            tot = press.get(f.id, ku)
            self._damage(f, MELEE_K * ku * dt, u, 'melee')
            # la mêlée se décide surtout au moral : le plus faible plie le premier ; à plusieurs contre un, la pression
            # s'additionne, sauf dans une brèche, une rue, des maisons, derrière un mur, où l'on ne se bat pas à plus de
            # front que le passage (elle ne dépasse alors pas MELEE_MOR par seconde)
            narrow = self.t[self.cell(f.x, f.y)] in NARROW or self.t[self.cell(u.x, u.y)] in NARROW or \
                self.cover_at(f.x, f.y) >= 0.5
            share = (ku / max(1.0, tot)) * tot / max(1.0, tot + kf) if narrow else ku / max(1.0, ku + kf)
            f.morale = max(0.0, f.morale - MELEE_MOR * dt * share)
            u.fought += dt
            # (on ne se replie pas en ordre devant des cavaliers qui sont dans les rangs : fantassins hors du carré et
            # canonniers se débandent)
            ridden = u.cls == 'cavalerie' and f.form != 'carre' and f.cls in ('inf', 'artillerie')
            if (f.morale < 25 or (ridden and f.morale < GIVE_WAY)) and f.state != 'deroute':
                self._rout(f)
                if u.cls == 'cavalerie':
                    self._capture(u, f, CAPTURE['melee_cav'])
                self._end_melee(u)
            elif f.morale < GIVE_WAY and f.state == 'melee' and kf < tot:
                # le plus faible cède du terrain sans se débander : il se replie et se reforme
                self._end_melee(f)
                self._repulse(f, u, 100.0)
                self.log(f"{f.name} cède du terrain devant {u.name}.", None, f.side)
        # déroutés rattrapés, et troupes qui se heurtent (baïonnette) : seulement les voisines (cases de 40 m)
        bins = {}
        for u in alive:
            if u.state != 'hors':
                bins.setdefault((int(u.x // 40), int(u.y // 40)), []).append(u)
        pairs = []
        for (bx, by), lst in bins.items():
            for k, a in enumerate(lst):
                for b in lst[k + 1:]:
                    pairs.append((a, b))
            for nb in ((bx + 1, by), (bx - 1, by + 1), (bx, by + 1), (bx + 1, by + 1)):
                o = bins.get(nb)
                if o:
                    for a in lst:
                        for b in o:
                            pairs.append((a, b))
        for a, b in pairs:
            if not a.alive or not b.alive:
                continue
            dx, dy = b.x - a.x, b.y - a.y
            d2 = dx * dx + dy * dy
            if d2 > 900:
                continue
            if a.side == b.side:
                if d2 < 400 and a.state != 'melee' and b.state != 'melee':
                    d = math.sqrt(d2) or 1.0
                    push = (20 - d) / 2
                    for u, s in ((a, -1), (b, 1)):
                        nx, ny = u.x + s * dx / d * push, u.y + s * dy / d * push
                        if 0 <= nx < W and 0 <= ny < H and self._passable_u(u, nx, ny):
                            u.x, u.y, u.still_t = nx, ny, self.clock
                continue
            for x, y in ((a, b), (b, a)):
                if y.state == 'deroute' and x.valid and x.state != 'melee':
                    self._capture(x, y, CAPTURE['contact_cav'] if x.cls == 'cavalerie' else CAPTURE['contact_inf'])
            if a.valid and b.valid and a.state not in ('melee', 'charge') and b.state not in ('melee', 'charge') \
                    and a.cls not in ('general', 'chariot') and b.cls not in ('general', 'chariot') and d2 < 400:
                a.state = b.state = 'melee'
                a.melee_with, b.melee_with = b.id, a.id
                a.path, b.path = [], []

    def _wagons(self, dt):
        """Chariots de munitions : recomplètent les régiments proches, se font prendre s'ils restent sans escorte."""
        for w in self.units:
            if w.cls != 'chariot' or not w.alive:
                continue
            foe, friend = None, False
            for o in self.units:
                if not o.valid:
                    continue
                d2 = (o.x - w.x) ** 2 + (o.y - w.y) ** 2
                if o.side != w.side and d2 < 40 * 40:
                    foe = o
                elif o.side == w.side and d2 < 80 * 80:
                    friend = True
            if foe is not None and not friend:
                self._take_wagon(w, foe)
                continue
            if w.ammo <= 0 or w.path:
                continue
            tot = sum(u.men0 for u in self.units if u.side == w.side and u.cls in ('inf', 'artillerie', 'cavalerie')) or 1.0
            r2 = U.WAGON_RANGE ** 2
            for u in self.units:
                if u.side != w.side or not u.alive or u.cls in ('general', 'chariot') or u.ammo >= u.ammo0 \
                        or u.state in ('deroute', 'melee'):
                    continue
                if (u.x - w.x) ** 2 + (u.y - w.y) ** 2 > r2:
                    continue
                add = min(u.ammo0 - u.ammo, u.ammo0 * U.WAGON_RATE / 60 * dt)
                u.ammo += add
                w.ammo = max(0.0, w.ammo - add / u.ammo0 * u.men0 / tot * U.WAGON_LOAD)
                if w.ammo <= 0:
                    self.log(f"{w.name} est vide.", w.side)
                    break

    def _take_wagon(self, w, by):
        old = w.side
        w.side, w.owner, w.ctrl, w.army = by.side, by.owner, by.ctrl, by.army
        w.group, w.gname = by.group, by.gname
        w.path, w.goal, w.order, w.target = [], None, None, None
        w.state = 'repos'
        self.emit('impact', w.x, w.y, src=by.id)
        self.log(f"{by.name} s'empare d'un chariot de munitions ennemi !", by.side)
        self.log("Un de nos chariots de munitions est tombé aux mains de l'ennemi !", old)

    def _capture(self, x, y, frac):
        """Des hommes en déroute rattrapés par l'ennemi sont faits prisonniers."""
        if y.men <= 0:
            return
        k = y.men * frac if y.men > 25 else y.men
        y.men -= k
        y.captured += k
        self.prisoners[y.side] += k
        if y.men < 8:
            y.state = 'hors'
            y.captured += y.men   # les derniers aussi : le régiment ne revient pas en campagne
            self.prisoners[y.side] += y.men
            y.men = 0.0
            self.log(f"{y.name} est capturé.", None, y.side)

    # ------------------------------------------------------------------ moral
    def _rout(self, u):
        if u.state in ('deroute', 'hors'):
            return
        if u.state == 'melee':
            self._end_melee(u)
        u.state = 'deroute'
        u.halt = False
        u.order = dict(kind='deroute')
        u.target = None
        u.busy = 0.0
        u.next_form = None
        u.path = []   # la fuite se fait droit vers son bord, en contournant les obstacles (voir _flee)
        u.goal = None
        self.emit('deroute', u.x, u.y, src=u.id)
        self.log(f"{u.name} est en déroute !", None, u.side)
        # la déroute ébranle les voisins déjà éprouvés (une troupe ferme la laisse passer), d'autant plus que la troupe
        # qui fuit est nombreuse ; moins près du général
        k = ROUT_MOR * min(1.5, u.men / 250.0)
        for o in self.units:
            if o.side == u.side and o is not u and o.valid and (o.x - u.x) ** 2 + (o.y - u.y) ** 2 < ROUT_R * ROUT_R:
                shaken = min(1.0, max(0.0, (ROUT_STEADY - o.morale) / 30.0))
                hit = k * shaken / U.TYPE.get(o.type, U.TYPE['ligne'])['steady']
                if self.general_near(o):
                    hit *= 0.5
                o.morale = max(0.0, o.morale - hit)

    def _morale(self, u, dt):
        if u.state == 'hors':
            return
        gen = self.general_near(u)
        bonus = (15 if (gen.gen or {}).get('trait') == 'inspirant' else 10) if gen else 0
        calm = self.clock - u.hit_t > 30 and u.state != 'melee'
        cap = min(100.0, max(u.morale0, 60) + 5 + bonus - u.fat / 4)
        if u.state == 'deroute':
            # (seulement près du général, au calme ; dans une place, par ses officiers ; sans général sur le terrain,
            # loin de l'ennemi : voir RALLY_*)
            k, who = self._rally_k(u)
            # (les fuyards s'arrêtent auprès du général ou, loin de tout, de leurs officiers ; dans une place, ils se
            # reprennent en courant se mettre à l'abri au fond de la ville, comme avant)
            u.halt = k > 0 and who != 'place'
            if k:
                u.morale = min(cap, u.morale + k * dt)
                if u.morale >= 40:
                    self._start_rally(u)
                    self.log(f"{u.name} se rallie" + (" autour du général." if who == 'general' else "."), u.side)
            return
        if calm and u.morale < cap:
            rec = MOR_REC + (MOR_REC_GEN if gen else 0) + 0.01 * self.cover_at(u.x, u.y)
            u.morale = min(cap, u.morale + rec * dt)
        if u.ammo < 1 and u.cls != 'cavalerie' and self._nearest_foe_dist(u) < 400:
            u.morale = max(0.0, u.morale - 0.01 * dt)
        if u.cls not in ('general', 'chariot') and u.morale + bonus < 25:
            self._rout(u)

    # ------------------------------------------------------------------ fin
    def _check_end(self):
        v = [any(u.valid for u in self.units if u.side == s) for s in (0, 1)]
        res = None
        if self.objective() is not None:
            hx, hy = self.objective()
            att = sum(u.men for u in self.units if u.valid and u.side == 0 and
                      (u.x - hx) ** 2 + (u.y - hy) ** 2 < HEART_R * HEART_R)
            dfd = any(u.valid and u.side == 1 and (u.x - hx) ** 2 + (u.y - hy) ** 2 < HEART_FREE * HEART_FREE
                      for u in self.units)
            self.hold_t = self.hold_t + DT if att >= HEART_MEN and not dfd else 0.0
            if self.hold_t >= HEART_HOLD:
                res = (0, False, "L'assaillant tient le cœur de la place.")
            elif self._surrender():
                res = (0, False, "La garnison capitule : la brèche est ouverte, elle se rend prisonnière.")
        for s in (0, 1):
            if self.withdrawing[s] and self.clock - self.withdraw_t[s] > 1800 and v[s]:
                # une demi-heure après l'ordre de décrocher, l'arrière-garde a filé
                for u in self.units:
                    if u.side == s and u.valid:
                        u.state = 'hors'
                v[s] = False
        if res is None:
            if not v[0] and not v[1]:
                res = (1, True, "Les deux armées se sont débandées.")
            elif not v[0]:
                res = (1, self.withdrawing[0], "L'assaillant a décroché." if self.withdrawing[0]
                       else "L'assaillant est en déroute.")
            elif not v[1]:
                res = (0, self.withdrawing[1], "Le défenseur a décroché." if self.withdrawing[1]
                       else "Le défenseur est en déroute.")
            elif self.clock >= self.dusk:
                res = (1, True, "La nuit tombe : l'assaillant n'a pas emporté la décision et se retire.")
        if res:
            self.finish(*res)

    def _surrender(self):
        """La garnison d'une place battue en brèche capitule (SURR_*) : elle est prisonnière."""
        if not self.breach_t or self.siege_t is None or self.clock - self.breach_t[0][0] < SURR_BREACH_T or \
                self.clock - self.siege_t < SURR_POUND_T:
            return False
        gar = [u for u in self.units if u.side == 1 and u.cls not in ('general', 'chariot')]
        men0 = sum(u.men0 for u in gar)
        here = [u for u in gar if u.state != 'hors' and u.men > 0]   # (les fuyards encore là comptent au moral)
        men = sum(u.men for u in here if u.valid)
        if not men or sum(u.men0 - u.men for u in gar) < SURR_LOSS * men0 or \
                sum(u.morale * u.men for u in here) >= SURR_MOR * sum(u.men for u in here) or \
                self.strength(0) < SURR_RATIO * men:
            return False
        for u in self.units:
            if u.side == 1 and u.men > 0 and u.cls != 'general':
                u.captured += u.men
                self.prisoners[1] += u.men
                u.men = 0.0
                u.state = 'hors'
        return True

    def finish(self, winner, disengage, why):
        if self.phase == 'fin':
            return
        self.phase = 'fin'
        self.winner = winner
        self.disengage = disengage
        self.why = why
        self.log(why[:1].upper() + why[1:] if why else why)
        self.result = self._result()

    def _result(self):
        res = dict(winner=self.winner, disengage=self.disengage, why=self.why, units={},
                   lost=[0.0, 0.0], men0=[0.0, 0.0], prisoners=[round(self.prisoners[0]), round(self.prisoners[1])])
        for u in self.units:
            gain = 0.0 if u.fought <= 0 else 2 + 10 * min(1.0, u.fought / 1800)
            res['units'][u.id] = dict(men=u.men, lost=u.men0 - u.men, morale=u.morale, xp=gain, fat=u.fat,
                                      ammo=u.ammo / max(1, u.ammo0) * 100, captured=u.captured, state=u.state,
                                      wounded=u.wounded)
            if u.cls not in ('general', 'chariot'):
                res['lost'][u.side] += u.men0 - u.men
                res['men0'][u.side] += u.men0
        return res

    # ================================================================== « Finir automatiquement » : la bataille en accéléré
    def autofinish(self):
        """« Finir automatiquement » : les officiers du joueur (l'IA, au niveau ACCEL_LEVEL) prennent le commandement de
        ses unités et la suite se joue jusqu'au bout, IA contre IA, avec les mêmes règles et les mêmes pas DT qu'une
        bataille commandée, aussi vite que le serveur le permet (bridge.tick : budget de calcul par appel ; run_to_end
        pour les essais). Pendant le déploiement, les officiers déploient le camp à leur idée, puis engagent la bataille ;
        en plein combat, l'IA reprend la situation telle qu'elle est (ai._adopt) : les charges et mêlées en cours
        continuent, les troupes que le joueur a envoyées en retraite poursuivent leur retraite (elles restent à lui),
        celles à qui il avait fait cesser le feu le rouvrent, et un camp qui décroche continue de décrocher."""
        if self.phase == 'fin':
            return False, "La bataille est terminée."
        if self.accel:
            return True, "Vos officiers poursuivent déjà la bataille."
        me = self.me
        if me in (0, 1):
            lv = self.spec.get('ai_levels')
            lv = list(lv) if isinstance(lv, (list, tuple)) and len(lv) == 2 else [self.difficulty, self.difficulty]
            lv[me] = ACCEL_LEVEL   # (l'adversaire garde le sien : spec['ai_levels'], sinon la difficulté de la partie)
            self.spec['ai_levels'] = lv
            for u in self.units:
                if u.side != me or u.ctrl != 'joueur':
                    continue
                if self.phase == 'combat' and u.order and u.order.get('kind') == 'retreat':
                    continue
                u.ctrl = 'ia'
                u.fire_mode = 'free'
            if me not in self.ai_sides:
                self.ai_sides.append(me)
            # l'IA n'a rien gardé du camp du joueur (bridge.default_deploy) : elle repart de son propre déploiement, ou
            # de la situation présente à sa première réflexion
            self.ai_mem.pop(f's{me}', None)
            if self.phase == 'deploiement':
                from . import ai as AI
                AI.deploy(self, me)
        if self.phase == 'deploiement':
            self.start()
        self.accel = True
        self.accel_t = self.clock
        self.log("Vos officiers prennent le commandement : la bataille se poursuit en accéléré.", me)
        return True, "Vos officiers poursuivent la bataille."

    # ================================================================== vue client
    def view(self, me=None, since=0):
        me = self.me if me is None else me
        seen = self.seen_by[me] if me in (0, 1) else None
        units = []
        for u in self.units:
            if u.state == 'hors' and u.side != me:
                continue
            mine = me is None or u.side == me
            if not mine and (seen is None or u.id not in seen) and self.phase != 'fin':
                continue
            units.append(u.view(mine, u.seen))
            if u.cls == 'inf' and (self.ufx(u, 'entrench') or
                                   u.id in (self.spec.get('logement') or ())) and self.clock - u.still_t >= ENTRENCH_T:
                units[-1]['dug'] = 1   # retranchée : le client dessine sa tranchée et ses gabions (SPEC-SUITE J)
            if u.cls == 'artillerie' and self.on_rampart(u):
                units[-1]['rempart'] = True   # sur l'enceinte : le client la dessine sans avant-train
            if mine and u.cls == 'general' and u.alive:
                units[-1]['rally'] = round(self.rally_radius(u))   # (zone où il rallie les fuyards)
        sides = []
        for s in (0, 1):
            us = [u for u in self.units if u.side == s and u.cls not in ('general', 'chariot')]
            men = sum(u.men for u in us if u.state != 'hors')
            m0 = sum(u.men0 for u in us) or 1.0
            mor = sum(u.morale * u.men for u in us if u.alive) / max(1.0, sum(u.men for u in us if u.alive))
            sides.append(dict(owner=self.spec['owners'][s], name=self.spec['names'][s], color=self.spec['colors'][s],
                              men=int(round(men)), men0=int(round(m0)), morale=int(round(mor)),
                              routed=sum(1 for u in us if u.state == 'deroute'),
                              out=sum(1 for u in us if u.state == 'hors')))
            if me is not None and s != me and self.phase != 'fin':
                # l'ennemi : seulement ce qu'on en voit, et l'effectif de départ annoncé par les éclaireurs
                vis = [u for u in us if seen and u.id in seen and u.alive]
                sides[-1]['men'] = int(round(sum(u.men for u in vis)))
                # moral apparent : celui des troupes qu'on voit (0 si l'on ne voit personne)
                sides[-1]['morale'] = int(round(sum(u.morale * u.men for u in vis) / max(1.0, sum(u.men for u in vis))))
                sides[-1]['seen'] = True
        out = dict(bid=self.bid, seq=self.seq, phase=self.phase, clock=round(self.clock),
                   hour=fmt_hour(self.clock + self.spec.get('h_off', 0.0)), h_off=self.spec.get('h_off', 0.0), weather=self.weather, season=self.season, light=round(self.light, 2),
                   wind=self.wind, me=me, sides=sides, units=units, dusk=round(self.dusk),
                   title=self.spec.get('title'), place=self.spec.get('place_name'),
                   skirmish=bool(self.spec.get('skirmish')),   # mode Bataille : « Retour au menu »
                   breaches=self.breaches,                     # brèches ouvertes au canon pendant la bataille
                   bati=[[c, e] for s, c, e, _t in self.bati_log if s > since],   # maisons touchées, en feu, en ruine
                   fx=[e for e in self.fx if e['s'] > since],
                   log=[(txt if ab is None or me is None or ab == me else 'Ennemi : ' + txt)
                        for s, sd, txt, ab in self.logs if s > since and (sd is None or me is None or sd == me)])
        if self.phase == 'deploiement' and me in (0, 1):
            out['zone'] = self.zone(me)
        if self.accel:
            # « Finir automatiquement » : les officiers commandent, la bataille défile ; seuls les derniers effets
            # partent (les autres ont eu lieu trop vite pour être vus)
            out['accel'] = True
            out['accel_t'] = round(self.accel_t)
            out['fx'] = out['fx'][-ACCEL_FX:]
        if self.objective():
            out['objective'] = list(self.objective())
            out['hold'] = round(self.hold_t)
            out['hold_need'] = round(HEART_HOLD)
        if self.phase == 'fin' and self.result:
            out['result'] = self.result_view(me)
        return out

    def result_view(self, me):
        r = self.result
        m = 0 if me is None else me
        won = r['winner'] == m
        title = ('Victoire' if won else 'Défaite') if not r['disengage'] else \
            ('L\'ennemi décroche' if won else 'Retraite')
        h_off = self.spec.get('h_off', 0.0)
        lines = [r['why'], f"Bataille terminée à {fmt_hour(self.clock + h_off)}."]
        if self.accel and me in (0, 1):
            lines.append(f"Vos officiers ont mené la bataille à partir de {fmt_hour(self.accel_t)}.")
        names = self.spec['names']
        lines.append(f"Pertes : {names[m]} {int(r['lost'][m])}, {names[1 - m]} {int(r['lost'][1 - m])}.")
        if r['prisoners'][1 - m] or r['prisoners'][m]:
            lines.append(f"Prisonniers faits : {int(r['prisoners'][1 - m])} ; perdus : {int(r['prisoners'][m])}.")
        # expérience réellement gagnée : celle de la bataille, au moins les +8 que la campagne donne aux vainqueurs
        per = []
        for k, v in r['units'].items():
            u = self.by_id[k]
            if u.side != m or u.cls in ('general', 'chariot') or u.type == 'milice':
                continue
            gain = max(v['xp'], 8.0) if r['winner'] == m else v['xp']
            per.append(dict(id=k, name=u.name, lost=int(v['lost']), xp=round(gain)))
        xp = round(sum(p['xp'] for p in per) / len(per), 1) if per else 0
        out = dict(winner=r['winner'], won=won, disengage=r['disengage'], title=title, lines=lines,
                    losses=[[int(r['lost'][m]), int(r['lost'][1 - m])]],
                    prisoners=[int(r['prisoners'][m]), int(r['prisoners'][1 - m])], xp=xp, units=per)
        if self.spec.get('mode') == 'ordres':
            # « Donner mes ordres » : les pertes par arme des deux camps, et ce qui a décidé la journée (le journal de
            # ses officiers)
            out['arms'] = [[lab, *[int(sum(u.men0 - max(0.0, u.men) for u in self.units if u.side == s and u.cls == c))
                                   for s in (m, 1 - m)]]
                           for c, lab in (('inf', 'Infanterie'), ('cavalerie', 'Cavalerie'), ('artillerie', 'Artillerie'))]
            j = (self.ai_mem.get(f's{m}') or {}).get('journal') or []
            keys = ('feinte', 'masse', 'débordement', 'tournante', 'raid', 'brèche', 'contre-attaque', 'percée',
                    'assaut général', 'presse', 'poursuite', 'décroche', 'fausse retraite', 'réserve', 'grande batterie')
            out['decisive'] = [txt for t, txt in j if any(k in txt for k in keys)][-5:]
        return out

    def map_view(self):
        d = self.map.to_client(self.spec)
        d['nbreach'] = len(self.breaches)   # (déjà dans les remparts envoyés : le client ne les rajoute pas)
        d['bati'] = [[c, e] for c, e in enumerate(self.bati) if e]   # état des maisons (SPEC-2D § 5), au chargement
        if getattr(self, 'piet', None):
            d['piet'] = self.piet   # la boue laissée par les troupes (SPEC-SUITE F8), redessinée au rechargement
        return d

    # ================================================================== sauvegarde
    def to_dict(self):
        return dict(spec=self.spec, units=[u.to_dict() for u in self.units], phase=self.phase, clock=self.clock,
                    seq=self.seq, logs=[list(x) for x in self.logs[-60:]], ai_sides=self.ai_sides,
                    withdrawing=self.withdrawing, withdraw_t=self.withdraw_t, hold_t=self.hold_t, siege_t=self.siege_t, prisoners=self.prisoners,
                    ai_mem=self.ai_mem, result=self.result, pound=self.pound, breaches=self.breaches,
                    breach_t=self.breach_t, bati=self.bati_log,
                    accel=self.accel, accel_t=self.accel_t, replay=self.replay, ask=self.ask,
                    end=[getattr(self, 'winner', None), getattr(self, 'disengage', None), getattr(self, 'why', None)],
                    piet=getattr(self, 'piet', None))

    @classmethod
    def from_dict(cls, geo, d):
        units = [U.Unit.from_dict(x) for x in d['units']]
        tb = cls(geo, d['spec'], units, d.get('ai_sides', (0, 1)))
        tb.phase = d.get('phase', 'combat')
        tb.clock = d.get('clock', 0.0)
        tb.seq = d.get('seq', 0)
        tb.logs = [tuple(x) + (None,) * (4 - len(x)) for x in d.get('logs', [])]
        tb.withdrawing = d.get('withdrawing', [False, False])
        tb.withdraw_t = d.get('withdraw_t', [0.0, 0.0])
        tb.hold_t = d.get('hold_t', 0.0)
        tb.siege_t = d.get('siege_t')
        tb.prisoners = d.get('prisoners', [0.0, 0.0])
        tb.ai_mem = d.get('ai_mem') or {}
        tb.result = d.get('result')
        tb.piet = d.get('piet') if valid_piet(d.get('piet')) else None   # (anciennes sauvegardes : un sol neuf)
        tb.accel = bool(d.get('accel'))   # (anciennes sauvegardes : pas d'accéléré)
        tb.accel_t = d.get('accel_t', 0.0)
        tb.replay = d.get('replay')
        tb.ask = d.get('ask')
        tb.pound = dict(d.get('pound') or {})
        tb.breach_t = [list(x) for x in d.get('breach_t') or []]
        tb.bati_log = [list(x) for x in d.get('bati') or [] if 0 <= x[1] < N]   # (anciennes sauvegardes : intact)
        for _s, c, e, t0 in tb.bati_log:
            tb._bati_mark(c, e, t0)
        for wi, x, y, r in d.get('breaches') or []:
            tb._apply_breach(wi, x, y, r)
        e = d.get('end') or [None, None, None]
        if e[0] is not None:
            tb.winner, tb.disengage, tb.why = e
        left = tb.dusk - tb.clock
        tb.light = 1.0 if left > 3600 else max(0.15, 0.15 + 0.85 * left / 3600)
        tb._update_vision()
        return tb
