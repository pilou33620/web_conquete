"""Fabrique de situations pour les bancs d'essai : une partie, un mois joué, une bataille déjà engagée, deux régiments
face à face… en une ligne, sans jouer des heures pour y arriver.

    from fabrique import partie, jouer_mois, bataille, face_a_face, avancer

Les bancs (test_*.py) s'en servent ; un nouveau banc pour une nouvelle fonctionnalité aussi.
"""
import os
import sys

os.environ['WEB_CONQUETE_NOLOG'] = '1'   # les essais n'écrivent pas dans logs/batailles.jsonl (outils/bilan.py)
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE)

from game import turns as TT  # noqa: E402
from game.engine import Game  # noqa: E402
from game.geo import GeoMap  # noqa: E402
from game.tactics import battle as BT  # noqa: E402
from game.tactics import skirmish as S  # noqa: E402

GEO = GeoMap()   # la carte, calculée une fois (en cache dans game/data/map_cache.json)


# ------------------------------------------------------------------ campagne
def partie(joueur='33', epoque='1790', seed=1, difficulte='normal'):
    """Une partie neuve, au tour du joueur. joueur : '33' Gironde, '24', '40', '47', '64' ; epoque : '1700', '1790',
    '1813', '1870'."""
    return Game(GEO, joueur, difficulte, seed, epoque)


def armee(g, owner=None):
    """Une armée du joueur (ou du camp owner)."""
    owner = owner or g.player
    return next(a for a in g.armies.values() if a['owner'] == owner)


def jouer_mois(g, n=1):
    """« Tour suivant » n fois : le tour des IA va jusqu'au 1er du mois suivant (interruptions acceptées d'office)."""
    for _ in range(n):
        TT.go(g)
        for _ in range(600):
            if g.tour['end'] is None:
                break
            TT.advance(g, 1.0)
            if g.tour['stop']:
                TT.go(g)
        else:
            raise AssertionError('le tour des IA ne finit pas')


# ------------------------------------------------------------------ batailles
def bataille(mes=None, epoque='1790', joueur='33', ennemi='24', demarree=True, seed=1):
    """Une escarmouche (mode Bataille) : mes = {type: nombre}, par défaut une unité de chaque arme.
    Renvoie (tb, unites) : la TacticalBattle et mes unités par type (la première de chaque type).
    demarree : déploiement fini, le combat a commencé. seed : même graine, même bataille (ennemis, terrain, météo)."""
    mes = mes or dict(ligne=1, legere=1, cavalerie=1, artillerie=1)
    g, bid = S.new(GEO, dict(me=joueur, foe=ennemi, era=epoque, units=mes, seed=seed))
    assert g is not None, bid   # (bid est alors le message d'erreur)
    tb = g.tactical[bid]
    if demarree:
        tb.start()
    unites = {}
    for u in tb.units:
        if u.owner == joueur and u.type in mes:
            unites.setdefault(u.type, u)
    return tb, unites


def bataille_de_campagne(epoque='1813', attaque=True, seed=3):
    """Une bataille de campagne en rase campagne qui attend le choix du joueur (« Donner mes ordres », commander,
    automatique) : les deux armées de départ, doublées, se rencontrent loin de toute place. Renvoie (g, bt)."""
    import copy
    from game import diplomacy as D
    g = partie(epoque=epoque, seed=seed)
    a, b = armee(g), armee(g, '24')
    best = None
    for dx in range(-30, 31, 2):
        for dy in range(-30, 31, 2):
            x, y = a['x'] + dx, a['y'] + dy
            if min((n['x'] - x) ** 2 + (n['y'] - y) ** 2 for n in g.geo.nodes) > 25 and g.geo.terrain_at(x, y) != 'eau':
                d = dx * dx + dy * dy
                if best is None or d < best[0]:
                    best = (d, x, y)
    for k in (a, b):
        k['regs'] += [dict(copy.deepcopy(r), id=r['id'] + 'b') for r in k['regs']]
        k['at_node'], k['state'] = None, 'idle'
    a['x'], a['y'] = best[1], best[2]
    b['x'], b['y'] = best[1] + 1.0, best[2]
    D.declare_war(g, '24', g.player, quiet=True)
    mover, target = (a, b) if attaque else (b, a)
    g.order_move(mover['owner'], mover['id'], target['x'], target['y'])
    TT.go(g)
    for _ in range(80):
        TT.advance(g, 0.1)
        if g.tour['stop']:
            break
    bt = next(bt for bt in g.battles.values() if bt.get('mode') == 'attente')
    assert bt['node'] is None
    return g, bt


def ennemi(tb, u, cls=None):
    """Un ennemi vivant de u (de l'arme cls si demandée : 'inf', 'cavalerie', 'artillerie')."""
    return next(e for e in tb.units if e.side != u.side and e.alive and e.state != 'hors' and (cls is None or e.cls == cls))


def face_a_face(tb, u, cible, distance=200.0):
    """Place la cible à environ `distance` mètres devant u, là où u la voit (pas dans un bois ni derrière une crête :
    on essaie quelques directions et distances voisines), et met la vision à jour tout de suite. Renvoie la distance."""
    import math
    for k in (1.0, 0.8, 1.2, 0.6, 1.4):
        for da in (0.0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9):
            a, d = u.dir + da, distance * k
            cible.x, cible.y = u.x + math.cos(a) * d, u.y + math.sin(a) * d
            cible.path, cible.goal = [], None
            tb._update_vision()
            if cible.id in tb.seen_by[u.side]:
                return d
    raise AssertionError('la cible reste invisible près de cette distance : essayer une autre graine')


def avancer(tb, secondes, jusqua=None):
    """Fait tourner la bataille `secondes` secondes de bataille (ou jusqu'à ce que jusqua() soit vrai).
    Renvoie le temps écoulé."""
    t = 0.0
    while t < secondes and tb.phase != 'fin':
        if jusqua is not None and jusqua():
            break
        tb.step()
        t += BT.DT
    return t


def ordre(tb, u, kind, **p):
    """Ordre du joueur à une unité, comme depuis le panneau : (ok, message)."""
    return tb.order(u.side, [u.id], kind, who='joueur', **p)


def kind(u):
    """Nom de l'ordre en cours d'une unité ('charge', 'harass'…), ou None."""
    return u.order.get('kind') if isinstance(u.order, dict) else u.order
