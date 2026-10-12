"""Simulation d'une bataille tactique en temps réel avec pause (TacticalBattle).

Le temps s'exprime en secondes de bataille (0 = 8 h du matin). Le serveur fait avancer la bataille par pas fixes
de DT = 2 s de bataille ; à ×1, une seconde réelle vaut TIME_K = 18 s de bataille : une bataille rangée de 3 à 6 h
dure 10 à 20 min à ×1 (×2 et ×4 pour accélérer). Les vitesses de marche restent celles du contrat (§ 4) : une ligne
qui avance à 1 m/s parcourt 18 m par seconde réelle, sa propre largeur en 6 à 7 s.

==================================================================================================================
RÈGLES DE COMBAT (équilibre ; les réglages sont les constantes P_*, CHOC, MELEE_*, FORMED… ci-dessous)
==================================================================================================================
- Feu soutenu : une salve par minute environ (units.INF_RELOAD, ART_RELOAD) ; 60 cartouches durent une heure de feu.
  Fusillade : P_FUSIL par homme du front et par salve, à portée efficace. Boulet : P_BOULET par pièce, de moins en moins
  juste avec la distance (ball_k : moitié à la portée efficace). Mitraille : P_MITRAILLE par pièce, la gerbe s'ouvre
  au-delà de 30 % de sa portée (grape_k : effet en 1/distance) ; terrible à bout portant (sous GRAPE_CLOSE = 150 m :
  ×1,5 à 100 m, ×2 à 50 m, ×GRAPE_POINT = 2,2 au contact). L'ordre dispersé (tirailleurs) prend nettement moins au
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
  dans un passage étroit (brèche, rue, maison, mur : NARROW) où la pression ne dépasse pas MELEE_MOR.
- Moral : pertes (surtout brutales, de flanc, de dos ; pas de surprise pour une troupe qui se retire en ordre),
  déroutes voisines (ROUT_MOR, seulement pour les troupes déjà ébranlées : pas de déroute en chaîne), munitions,
  fatigue ; remonte au calme (MOR_REC), plus vite près du général. Déroute sous 25 : la troupe fuit vers son bord.
- Ralliement (RALLY_*) : seulement auprès d'un général (état-major ami à moins de 400 m, 500 m s'il est inspirant), au
  calme (aucun ennemi en état de combattre à moins de 400 m) : il faut aller chercher les fuyards ; ils s'y arrêtent,
  se reprennent (0,1 point de moral par seconde) et reforment les rangs à 40. Dans une place, leurs officiers les
  rallient sans le général (au calme : 400 m, 150 m dans les maisons). Sans général sur le terrain (blessé, absent,
  garnison seule), seulement loin de l'ennemi (700 m), deux fois et demie plus lentement. Sinon, les fuyards courent
  jusqu'au bord de la carte et quittent la bataille. L'ordre « Rallier » suit la même règle (l'ennemi à plus de 150 m
  suffit) et dit pourquoi il échoue (« Le général est trop loin pour rallier ces hommes. »).
- Prisonniers : fuyards rattrapés (CAPTURE), surtout par la cavalerie, moins par des chevaux essoufflés.
- Vue : symétrique (si je te vois, tu me vois) ; une troupe en lisière d'un bois ou de maisons voit et se voit ; bois,
  bâti, murs et haies ne cachent que ce qui est sous leur faîte (une haie ne cache rien à qui la domine).
- Place : l'assaillant l'emporte en tenant le cœur 6 min (HEART_*) ; à l'échelle ou sur une barricade, il se bat mal.

==================================================================================================================
AIDE-MÉMOIRE POUR L'ÉQUIPE IA (game/tactics/ai.py)
==================================================================================================================
L'IA reçoit `battle` (TacticalBattle) et son camp `side` (0 assaillant, 1 défenseur). Elle ne fait que donner des
ordres, comme le joueur, et ne lit que ce que son camp voit :

Ordres (renvoient (ok, msg)) :
  battle.deploy(side, ids, x, y, dir=None, form=None)    pendant le déploiement : place les unités côte à côte
                                                          autour de (x, y), front tourné vers dir, dans la zone.
  battle.order(side, ids, kind, **params)                 kind : 'move' (x, y, dir?, run?), 'attack' (target),
        'charge' (target), 'hold', 'fire' (mode='free'|'hold'), 'form' (form), 'rally', 'retreat'.
        Plusieurs unités en 'move' gardent leur disposition relative autour du point. L'IA ne commande que les unités
        qu'elle contrôle (u.ctrl == 'ia') : battle.ai_units(side).
  battle.withdraw(side)                                   tout le camp décroche (fin de bataille).

Lecture (sans tricher sur la vue) :
  battle.ai_units(side) / battle.units_of(side)           unités du camp (objets Unit, voir units.py) ;
  battle.visible_enemies(side)                            ennemis actuellement repérés par ce camp ;
  battle.unit(uid)                                        une unité par son id (ne lire que les siennes ou les repérées) ;
  battle.cover_at(x, y) → 0..0,7                          couvert de la case (réduction des pertes au feu) ;
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

Résolution d'un coup : battle.autofinish() (« Finir automatiquement ») : par quarts d'heure, jusqu'à ce qu'un camp
décroche comme le ferait l'IA (AUTO_WD), soit rompu, ou jusqu'à la nuit ; une place aux murs intacts ne tombe guère.
Chiffres : DT = 2 s par pas, TIME_K = 18 s de bataille par seconde réelle à ×1, repérage toutes les 4 s, IA toutes
les 2 s ; fin au crépuscule (DUSK) ; assaut gagné en tenant le cœur de la place 6 min (au moins 150 hommes à 90 m)
sans défenseur à 160 m.
==================================================================================================================
"""
import heapq
import math
import random

from .. import rules as R
from . import terrain as TR
from . import units as U
from .terrain import (COLS, ROWS, CELL, N, W, H, T_PRE, T_CHAMP, T_VIGNE_T, T_LANDE_T, T_BOIS, T_FORET_T, T_MARAIS_T,
                      T_EAU, T_GUE, T_ROUTE, T_CHEMIN, T_BATI, T_MUR, T_BRECHE, T_PORTE, T_SABLE, T_ROCHE,
                      T_BARRICADE)

DT = 2.0                 # pas de simulation (s de bataille)
TIME_K = 18.0            # s de bataille par s réelle, à ×1 (une bataille de 3 à 6 h dure 10 à 20 min à ×1)
VIS_DT = 4.0             # mise à jour du repérage
AI_DT = 2.0              # l'IA réfléchit toutes les 2 s de bataille
START_H = 8.0
DUSK = {'printemps': 19.5, 'été': 20.5, 'ete': 20.5, 'automne': 18.0, 'hiver': 17.0}

X = None   # infranchissable
# coût de marche par classe de mouvement (1 = prairie), dans l'ordre des types de case
COST = {
    #        PRE  CHAMP VIGNE LANDE BOIS FORET MARAIS EAU GUE  ROUTE CHEMIN BATI MUR BRECHE PORTE SABLE ROCHE BARRIC.
    'inf':   [1.0, 1.15, 1.5, 1.25, 1.7, 2.6, 3.0, X, 3.0, 0.85, 0.95, 2.2, X, 2.5, 1.2, 1.8, 4.0, 3.5],
    'light': [1.0, 1.1, 1.3, 1.1, 1.2, 1.8, 2.2, X, 2.5, 0.85, 0.95, 1.8, X, 2.2, 1.2, 1.6, 3.0, 3.0],
    'cav':   [1.0, 1.2, 2.2, 1.4, 2.6, 5.0, 5.0, X, 2.5, 0.8, 0.9, 3.0, X, 4.0, 1.3, 2.0, X, 6.0],
    'art':   [1.0, 1.3, 2.6, 1.5, 3.2, X, X, X, 4.0, 0.7, 0.9, 3.0, X, 6.0, 1.2, 3.0, X, X],
}
COVER = [0.0, 0.05, 0.15, 0.1, 0.35, 0.5, 0.1, 0.0, 0.0, 0.0, 0.05, 0.55, 0.7, 0.35, 0.5, 0.05, 0.4, 0.5]
OPACITY = [0, 0, 0, 0, 34, 60, 0, 0, 0, 0, 0, 50, 100, 0, 100, 0, 0, 0]   # en centièmes, cumulés le long du regard
# hauteur (m) de ce qui bouche la vue sur la case : un regard qui passe au-dessus n'est pas gêné
TOP = [0, 0, 0, 0, 12, 16, 0, 0, 0, 0, 0, 8, 7, 0, 7, 0, 0, 0]
WOODS = (T_BOIS, T_FORET_T)
# éléments linéaires (couche f) : aucun, clôture, haie, muret
FCOVER = [0.0, 0.12, 0.25, 0.35]
FCOST = [0.0, 0.15, 0.4, 0.3]
FOPAC = [0, 0, 15, 0]
FTOP = [0, 0, 2.8, 0]    # une haie (talus compris) cache ce qui est à hauteur d'homme, pas ce qu'on voit de plus haut
EYE = 2.5                # hauteur d'un fantassin, pour la vue (m)
HEIGHT = dict(inf=2.5, artillerie=3.0, cavalerie=3.5, general=3.5, chariot=3.0)   # canons : officiers à cheval, caissons
# élan d'une charge : il se gagne en courant (mètres pour un plein élan), se perd en terrain difficile et en montée
ELAN_M = dict(cav=110.0, inf=45.0)
BRAKE_CAV = {T_BOIS: 0.45, T_FORET_T: 0.3, T_MARAIS_T: 0.35, T_VIGNE_T: 0.5, T_BATI: 0.4, T_ROCHE: 0.25,
             T_SABLE: 0.7, T_LANDE_T: 0.9, T_MUR: 0.3, T_PORTE: 0.3, T_BRECHE: 0.4, T_BARRICADE: 0.4, T_GUE: 0.6}
BRAKE_INF = {T_BOIS: 0.85, T_FORET_T: 0.7, T_MARAIS_T: 0.6, T_VIGNE_T: 0.85, T_BATI: 0.8, T_ROCHE: 0.55,
             T_SABLE: 0.8, T_MUR: 0.5, T_PORTE: 0.5, T_BRECHE: 0.7, T_BARRICADE: 0.7, T_GUE: 0.7}
# ---- équilibre du combat (voir « Règles de combat » dans l'aide-mémoire) ----
P_FUSIL = 0.0065         # touchés par homme qui tire et par salve, à portée efficace (avant arme, expérience, moral…)
P_BOULET = 0.26          # touchés par pièce et par coup de boulet à courte distance, sur une ligne à découvert
P_MITRAILLE = 0.56       # … à mitraille, jusqu'à 30 % de la portée de mitraille (puis de moins en moins : grape_k)
GRAPE_CLOSE = 150.0      # … et bien davantage à bout portant : sous 150 m, ×1,5 à 100 m, ×2 à 50 m…
GRAPE_POINT = 2.2        # … ×2,2 au contact (le feu de défense d'une batterie abordée de face)
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
# Dans une place, les officiers rallient leurs hommes sans le général (au calme ; RALLY_CALM_BATI dans les maisons ;
# RALLY_REC_PLACE).
# Sans général sur le terrain (blessé, absent, garnison seule), ils ne les arrêtent que loin de l'ennemi (RALLY_ALONE),
# et lentement (RALLY_REC_ALONE). Partout ailleurs, les fuyards courent jusqu'au bord de la carte et quittent la bataille.
RALLY_R, RALLY_INSP = 400.0, 100.0
RALLY_CALM, RALLY_CALM_BATI, RALLY_ALONE = 400.0, 150.0, 700.0
RALLY_REC, RALLY_REC_PLACE, RALLY_REC_ALONE = 0.1, 0.08, 0.04
# assaut d'une place : l'assaillant l'emporte s'il tient le cœur (au moins HEART_MEN hommes en état de combattre à
# moins de HEART_R) sans défenseur en état de combattre à moins de HEART_FREE, pendant HEART_HOLD secondes de suite
HEART_R, HEART_MEN, HEART_FREE, HEART_HOLD = 90.0, 150.0, 160.0, 360.0
CAPTURE = dict(contact_cav=0.004, contact_inf=0.0007,  # part des fuyards rattrapés par pas de 2 s au contact
               choc_cav=0.03, choc_inf=0.02,            # … par une charge sur des fuyards
               rupture_cav=0.04, melee_cav=0.03)        # … quand la cavalerie rompt une troupe (choc, mêlée)
CHARGE_FAT = dict(cav=12.0, inf=6.0)   # fatigue d'une charge menée jusqu'au choc : les chevaux sont essoufflés
# résolution automatique : comme l'IA, un camp décroche passé AUTO_WD de pertes (déroutés pour moitié) s'il est dominé,
# passé AUTO_WD + AUTO_EVEN dans un combat égal ; l'assaillant accepte AUTO_ATT de plus ; jamais le défenseur d'une place
AUTO_WD, AUTO_EVEN, AUTO_ATT = 0.22, 0.07, 0.05
# … et derrière une enceinte fermée, le défenseur pèse (1 + AUTO_SHUT[0]) fois plus et perd AUTO_SHUT[1] de moins ; des
# barricades ferment AUTO_BAR × leur densité
AUTO_SHUT, AUTO_BAR, AUTO_BREACH = (1.0, 0.5), 1.25, 0.95
AUTO_LUCK = 0.15   # … et le sort des armes : chaque camp pèse de ±15 % pour toute la résolution
FCOST_K = dict(inf=1.0, light=0.6, cav=2.0, art=2.5)
WALLISH = {T_MUR: 0.65, T_PORTE: 0.65, T_BRECHE: 0.4, T_BARRICADE: 0.5}
NARROW = (T_BATI, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE)
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
    serrée fauche des files entières : ×1,5 à 100 m, ×2 à 50 m, jusqu'à ×GRAPE_POINT au contact."""
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
        self.speed = 1
        self.seq = 0
        self.fx = []
        self.logs = []
        self.result = None
        self.ai_sides = list(ai_sides)
        self.seen_by = [set(), set()]
        self.withdrawing = [False, False]
        self.withdraw_t = [0.0, 0.0]
        self.hold_t = 0.0
        self.prisoners = [0.0, 0.0]          # hommes de ce camp faits prisonniers
        self.ai_mem = {}                     # mémoire de l'IA (types JSON seulement : enregistrée avec la bataille)
        self._acc = 0.0
        self._vis_t = -99.0
        self._ai_t = -99.0
        self._cost_cache = {}
        self._path_cache = {}
        self._astar_left = 6
        self._los_cache = {}
        rng = random.Random(spec['seed'] ^ 0x5A5A)
        self.rng = rng
        wa = rng.random() * 6.283
        self.wind = [round(math.cos(wa), 2), round(math.sin(wa), 2)]
        self.dusk = (DUSK.get(self.season, 19.0) - START_H) * 3600
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
        opp = dict(E='O', O='E', N='S', S='N')
        self.edges = [e0, opp[e0]]
        pl = self.map.place
        z = []
        depth = 500
        if pl and pl.get('battle'):
            px, py, r = pl['x'], pl['y'], pl['r']
            d = dict(O=px, E=W - px, N=py, S=H - py)[e0] - r - 350
            depth = max(500, min(1400, d))
        z.append(self._edge_band(e0, depth))
        if pl and pl.get('battle'):
            r = pl['r'] + 120
            z.append([max(0, pl['x'] - r), max(0, pl['y'] - r), min(W, pl['x'] + r), min(H, pl['y'] + r)])
        else:
            far = self._edge_band(e0, 1300 if e0 in 'NS' else 2100)
            near = self._edge_band(e0, 1000 if e0 in 'NS' else 1250)
            z1 = list(far)
            if e0 == 'O':
                z1[0] = near[2]
            elif e0 == 'E':
                z1[2] = near[0]
            elif e0 == 'N':
                z1[1] = near[3]
            else:
                z1[3] = near[1]
            z.append(z1)
        self.zones = z

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
        return max(COVER[self.t[c]], FCOVER[self.f[c]])

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

    def nearest_passable(self, u_or_cls, side, x, y, maxr=12):
        mc = move_class(u_or_cls) if isinstance(u_or_cls, U.Unit) else u_or_cls
        cost = self.costs(mc, side)
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
        t, h, f = self.t, self.h, self.f
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
                        op += OPACITY[tc]
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
        if self.in_place(u.x, u.y):
            # dans une place, les officiers rallient leurs hommes au calme (plus près de l'ennemi à l'abri des maisons)
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
            if form and form in U.FORMS.get(u.cls, ()) and form != 'batterie':
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
            u.path, u.goal, u.order = [], None, None
            u.state = 'repos'
        return True, f"{len(us)} unité{'s' if len(us) > 1 else ''} en place."

    def start(self):
        if self.phase != 'deploiement':
            return False, "La bataille est déjà engagée."
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
        if isinstance(ids, str):
            ids = [ids]
        us = [self.by_id.get(i) for i in ids or []]
        us = [u for u in us if u and u.side == side and u.alive and (who == 'any' or u.ctrl == who)]
        if not us:
            return False, "Aucune unité à commander."
        if self.phase == 'deploiement' and kind not in ('form', 'fire'):
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
                u.fire_mode = 'free'
            return True, "Tenez la position."
        if kind == 'fire':
            mode = p.get('mode') or p.get('fire') or p.get('value') or p.get('v') or 'free'
            mode = 'hold' if mode in ('hold', 'cesser', False, 0) else 'free'
            for u in us:
                u.fire_mode = mode
            return True, "Feu à volonté !" if mode == 'free' else "Cessez le feu."
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
        """Se porter à bonne portée de la cible (aux deux tiers de la portée efficace)."""
        e, mx, g = U.ranges(u)
        d = self.dist(u, tg)
        want = e * 0.7
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

    def _nearest_foe_dist(self, u, valid=True):
        best = 1e9
        for e in self.units:
            if e.side != u.side and e.alive and (not valid or e.valid):
                d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2
                if d < best:
                    best = d
        return math.sqrt(best)

    # ================================================================== boucle
    def advance(self, real_dt, speed=None):
        """Avance d'un intervalle réel (s) à la vitesse tactique ; pas fixes de DT. Renvoie le nombre de pas."""
        sp = self.speed if speed is None else speed
        if self.phase != 'combat' or sp <= 0:
            return 0
        self._acc += real_dt * sp * TIME_K
        n = 0
        while self._acc >= DT and self.phase == 'combat' and n < 40:
            self._acc -= DT
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
            eclaireur = self.trait(side) == 'eclaireur'
            for e in self.units:
                if e.side == side or not e.alive:
                    continue
                recent = self.clock - e.fired_t < 60
                ce = self.cell(e.x, e.y)
                hidden = self.t[ce] in WOODS or (self.t[ce] == T_BATI and e.cls != 'general')
                near = (100 if e.light else 150) + (100 if eclaireur else 0)
                he = self.h[ce]
                for o in mine:
                    d2 = (o.x - e.x) ** 2 + (o.y - e.y) ** 2
                    vr = self._view_range(o)
                    if self.h[self.cell(o.x, o.y)] > he + 10:
                        vr *= 1.2
                    if d2 > vr * vr:
                        continue
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
                # près du général (ou dans une place, ou loin de tout ennemi), au calme : les fuyards s'arrêtent et
                # leurs officiers les reforment (voir _morale)
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
                self._flee(u, self._speed(u) * dt, self.costs(move_class(u), u.side))
                u.state = 'marche'
                if self.off_map(u.side, u.x, u.y):
                    u.state = 'hors'
                    self.log(f"{u.name} s'est retiré du champ de bataille.", u.side)
            return
        if u.order and u.order.get('kind') == 'attack':
            tg = self.by_id.get(u.target)
            if tg and tg.alive and tg.state != 'hors' and tg.id in self.seen_by[u.side]:
                e, mx, _ = U.ranges(u)
                d = self.dist(u, tg)
                if (d > e * 0.95 and not u.path) or (u.path and d < e * 0.75):
                    if u.busy <= 0 and (not u.path or d < e * 0.75):
                        self._approach(u, tg)
            elif u.path == [] and u.order.get('kind') == 'attack':
                u.order = dict(kind='hold')
        if u.path and u.busy <= 0:
            self._move(u, dt)
            if u.path:
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
            if v > bv and self.los_units(u, e):
                best, bv = e, v
        if best is not None:
            u.target = best.id
        return best

    def _fire(self, u, dt, moving=False):
        if u.fire_mode != 'free' and not (u.order and u.order.get('kind') == 'attack'):
            return
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
        if u.cls == 'inf' and not (u.order and u.order.get('kind') == 'attack'):
            # feu à volonté : l'infanterie attend que l'ennemi soit à bonne portée (on ménage les cartouches)
            mx = min(mx, e * 1.3)
        hu = self.height_at(u.x, u.y)
        tg = self._pick_target(u, mx * 1.15)
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
        xp_k = 0.8 + u.xp / 250
        cov = self._cover_vs(tg, u)
        pr = 1.0 if d <= e else max(0.2, 1 - 0.8 * (d - e) / max(1.0, mx_eff - e))
        tk = U.TYPE.get(u.type, U.TYPE['ligne'])['fire']
        if u.cls == 'artillerie':
            pcs = U.pieces(u)
            mult = R.ARMS['artillerie'][min(u.arm, len(R.ARMS['artillerie']) - 1)][2]
            if tr == 'artilleur':
                mult *= 1.25
            if grape and d <= grape:
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
        u.ammo = max(0.0, u.ammo)
        u.reload = U.reload_time(u)
        u.fired_t = self.clock
        u.state = 'feu' if not moving else u.state
        u.fought += u.reload
        self._fatigue(u, u.reload, 'feu')
        self.emit(kind, u.x, u.y, tg.x, tg.y, n=cas, src=u.id)
        self._damage(tg, cas, u, kind)
        if u.ammo < 1:
            self.log(f"{u.name} n'a plus de munitions !", u.side)

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
            tg.men = max(0.0, tg.men)
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
        mom = 2.2 if cav else 1.0
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
            self._capture(a, tg, frac * min(1.0, mom / (2.2 if cav else 1.0)))
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
            if tg.cls == 'artillerie':
                # deux décharges de mitraille à bout portant pendant que la charge arrive (la gerbe serrée : ×2,2) ;
                # aborder une batterie de face coûte très cher, la prendre de flanc ou de dos ne coûte rien
                vol = U.pieces(tg) * P_MITRAILLE * GRAPE_POINT * 1.4 * (0.6 + 0.4 * tg.morale / 100)
                kind = 'mitraille'
            else:
                vol = tg.men * U.FRONT.get(tg.form, 1.0) * P_RECEPTION * (0.5 + 0.5 * tg.morale / 100) * \
                    (0.8 + tg.xp / 250) * self._wx_k(tg)
                kind = 'salve'
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
        k *= (0.5 + u.morale / 200) * (0.8 + u.xp / 250) * (1 - u.fat / 250)
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
        if self.trait(u.side) == 'audacieux':
            k *= 1.08
        return k

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
            ku = self._melee_k(u, f) * u.men
            fights.append((u, f, ku))
            press[f.id] = press.get(f.id, 0.0) + ku
        for u, f, ku in fights:
            if u.state != 'melee' or f.state != 'melee':
                continue
            kf = self._melee_k(f, u) * f.men
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
            if True:
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
                                u.x, u.y = nx, ny
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
            u.halt = k > 0
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

    # ================================================================== résolution automatique (« Finir automatiquement »)
    def autofinish(self):
        """Résout la bataille d'un coup à partir de la situation du moment : effectifs, moral, munitions, fatigue,
        couverts et hauteurs tenus. Par manches d'un quart d'heure jusqu'à ce qu'un camp décroche (comme l'IA : voir
        AUTO_WD), soit rompu, ou jusqu'à la nuit."""
        if self.phase == 'fin':
            return False, "La bataille est terminée."
        if self.phase == 'deploiement':
            self.phase = 'combat'
        rnd = self.rng
        place = self.objective() is not None
        wall = self.place_info()
        quits = None
        # place : enceinte encore fermée (de 0 à 1) ; les brèches l'ouvrent, les barricades la ferment selon leur
        # densité. Murs fermés, on ne la prend guère que par la faim ; brèche ouverte, l'assaut se joue
        shut = 0.0
        pl = self.spec.get('place') or {}
        if place and pl:
            if pl.get('fort', 0) >= 1:
                shut = 1.0 if pl.get('dmg', 0.0) < 0.12 else max(0.0, 1.0 - AUTO_BREACH * pl.get('dmg', 0.0))
            else:
                shut = min(1.0, AUTO_BAR * pl.get('bar', 0.0))
        luck = [rnd.uniform(1 - AUTO_LUCK, 1 + AUTO_LUCK) for _ in (0, 1)]
        for _ in range(80):
            if self.clock >= self.dusk:
                break
            P = [0.0, 0.0]
            lists = [[], []]
            for u in self.units:
                if not u.valid:
                    continue
                k = U.TYPE.get(u.type, U.TYPE['ligne'])
                if u.cls == 'artillerie':
                    p = U.pieces(u) * 30 * R.ARMS['artillerie'][min(u.arm, 6)][2] * (1.0 if u.ammo >= 1 else 0.1)
                elif u.cls == 'cavalerie':
                    p = u.men * 1.3 * k['melee'] / 1.6
                else:
                    mult = R.ARMS['inf'][min(u.arm, 7)][2]
                    p = u.men * k['fire'] * mult * (1.0 if u.ammo >= 1 else 0.35)
                cov = self.cover_at(u.x, u.y)
                if wall and u.side == 1:
                    cov = max(cov, 0.25 + 0.1 * wall['fort'])
                p *= (0.5 + u.morale / 200) * (0.8 + u.xp / 250) * (1 - 0.3 * u.fat / 100)
                p *= 1 + 0.5 * cov + self.height_at(u.x, u.y) / 400
                p *= luck[u.side] * (1 + AUTO_SHUT[0] * shut if u.side == 1 else 1.0)
                P[u.side] += p
                lists[u.side].append((u, cov))
            if not lists[0] or not lists[1]:
                break
            for s in (0, 1):
                dmg = 0.035 * P[1 - s] * rnd.uniform(0.85, 1.15) * (1 - AUTO_SHUT[1] * shut if s == 1 else 1.0)
                tot = sum(u.men * (1 - c * 0.6) for u, c in lists[s]) or 1.0
                for u, c in lists[s]:
                    share = dmg * u.men * (1 - c * 0.6) / tot
                    if u.cls == 'general':
                        share *= 0.1
                    self._damage(u, share, None, 'auto')
                    u.fought += 900
                    u.ammo = max(0.0, u.ammo - (6 if u.cls == 'inf' else 8 if u.cls == 'artillerie' else 1))
                    u.fat = min(100.0, u.fat + 3)
            for u in self.units:
                if u.valid and u.morale < 25:
                    self._rout(u)
            # les déroutés de l'un sont en partie rattrapés si l'autre tient
            self.clock += 900
            v = [any(u.valid for u in self.units if u.side == s) for s in (0, 1)]
            if not v[0] or not v[1]:
                break
            # le camp trop éprouvé et dominé décroche en ordre (les pertes comptent pour moitié les déroutés)
            worst = None
            for s in (0, 1):
                if place and s == 1:
                    continue
                us = [u for u in self.units if u.side == s and u.cls not in ('general', 'chariot')]
                m0 = sum(u.men0 for u in us) or 1.0
                left = sum(u.men * (0.5 if u.state == 'deroute' else 1.0) for u in us if u.state != 'hors')
                loss, ratio = 1.0 - left / m0, P[s] / max(1.0, P[1 - s])
                k = AUTO_ATT if s == 0 else 0.0
                if (loss > AUTO_WD + k and ratio < 0.9) or (loss > AUTO_WD + AUTO_EVEN + k and ratio < 1.0):
                    if worst is None or ratio < worst[1]:
                        worst = (s, ratio)
            if worst:
                quits = worst[0]
                break
        for u in self.units:
            if u.state == 'deroute':
                foe_ok = any(e.valid for e in self.units if e.side != u.side)
                if foe_ok:
                    self._capture(None, u, 0.1)
                u.state = 'hors'
        self.clock = min(self.clock, self.dusk)
        v = [any(u.valid for u in self.units if u.side == s) for s in (0, 1)]
        if quits is not None:
            self.finish(1 - quits, True, "Résolution automatique : " +
                        ("l'assaillant" if quits == 0 else "le défenseur") + " décroche.")
        elif v[0] and not v[1]:
            self.finish(0, False, "Résolution automatique : le défenseur est rompu.")
        elif v[1] and not v[0]:
            self.finish(1, False, "Résolution automatique : l'assaillant est rompu.")
        else:
            self.finish(1, True, "Résolution automatique : la nuit tombe sans décision ; l'assaillant se retire."
                        if not place else "Résolution automatique : la place a tenu jusqu'à la nuit.")
        return True, "Bataille résolue automatiquement."

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
        out = dict(bid=self.bid, seq=self.seq, phase=self.phase, speed=self.speed, clock=round(self.clock),
                   hour=fmt_hour(self.clock), weather=self.weather, season=self.season, light=round(self.light, 2),
                   wind=self.wind, me=me, sides=sides, units=units, dusk=round(self.dusk),
                   title=self.spec.get('title'), place=self.spec.get('place_name'),
                   fx=[e for e in self.fx if e['s'] > since],
                   log=[(txt if ab is None or me is None or ab == me else 'Ennemi : ' + txt)
                        for s, sd, txt, ab in self.logs if s > since and (sd is None or me is None or sd == me)])
        if self.phase == 'deploiement' and me in (0, 1):
            out['zone'] = self.zone(me)
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
        lines = [r['why'], f"Bataille terminée à {fmt_hour(self.clock)}."]
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
        return dict(winner=r['winner'], won=won, disengage=r['disengage'], title=title, lines=lines,
                    losses=[[int(r['lost'][m]), int(r['lost'][1 - m])]],
                    prisoners=[int(r['prisoners'][m]), int(r['prisoners'][1 - m])], xp=xp, units=per)

    def map_view(self):
        return self.map.to_client(self.spec)

    # ================================================================== sauvegarde
    def to_dict(self):
        return dict(spec=self.spec, units=[u.to_dict() for u in self.units], phase=self.phase, clock=self.clock,
                    speed=self.speed, seq=self.seq, logs=[list(x) for x in self.logs[-60:]], ai_sides=self.ai_sides,
                    withdrawing=self.withdrawing, withdraw_t=self.withdraw_t, hold_t=self.hold_t, prisoners=self.prisoners, acc=self._acc,
                    ai_mem=self.ai_mem, result=self.result,
                    end=[getattr(self, 'winner', None), getattr(self, 'disengage', None), getattr(self, 'why', None)])

    @classmethod
    def from_dict(cls, geo, d):
        units = [U.Unit.from_dict(x) for x in d['units']]
        tb = cls(geo, d['spec'], units, d.get('ai_sides', (0, 1)))
        tb.phase = d.get('phase', 'combat')
        tb.clock = d.get('clock', 0.0)
        tb.speed = d.get('speed', 1)
        tb.seq = d.get('seq', 0)
        tb.logs = [tuple(x) + (None,) * (4 - len(x)) for x in d.get('logs', [])]
        tb.withdrawing = d.get('withdrawing', [False, False])
        tb.withdraw_t = d.get('withdraw_t', [0.0, 0.0])
        tb.hold_t = d.get('hold_t', 0.0)
        tb.prisoners = d.get('prisoners', [0.0, 0.0])
        tb._acc = d.get('acc', 0.0)
        tb.ai_mem = d.get('ai_mem') or {}
        tb.result = d.get('result')
        e = d.get('end') or [None, None, None]
        if e[0] is not None:
            tb.winner, tb.disengage, tb.why = e
        left = tb.dusk - tb.clock
        tb.light = 1.0 if left > 3600 else max(0.15, 0.15 + 0.85 * left / 3600)
        tb._update_vision()
        return tb
