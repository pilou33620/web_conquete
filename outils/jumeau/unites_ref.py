"""Jumeau des unités tactiques et de ce qui s'en tire : game/tactics/units.py, stats.py, orders.py et battle.py (fonctions
du module, création d'une TacticalBattle, aides des lignes 525 à 1097). Écrit rust/conquete/tests/references/unites.json,
relu par rust/conquete/tests/unites.rs.

    python3 outils/jumeau/unites_ref.py

1. Les fonctions qui ne dépendent que de leurs entrées : unités de chaque type, forme, génération d'armes, état
   (to_dict, from_dict, view, portées, justesse, emprises…), stats, fonctions pures d'orders et de battle.
2. Quelques batailles créées (TacticalBattle(geo, spec, units)) sur la vraie carte de campagne (géographies 2 et 3,
   champs de version 9 sans place, places du générateur 1) : zones, vent, temps, ruines, puis les aides (terrain,
   ligne de vue, coûts, A*, chemins, unités, états-majors, journal) et les ordres du joueur (orders.py) sur cette
   bataille. Chaque appel est rangé dans l'ordre où l'essai Rust le refait.
"""
import copy
import hashlib
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commun  # noqa: E402

from game import geo as G  # noqa: E402
from game import rules as R  # noqa: E402
from game.tactics import ai as AI  # noqa: E402
from game.tactics import battle as BT  # noqa: E402
from game.tactics import orders as OR  # noqa: E402
from game.tactics import stats as ST  # noqa: E402
from game.tactics import terrain as TR  # noqa: E402
from game.tactics import units as U  # noqa: E402

E = commun.empreinte_ordre


def sha(t):
    return hashlib.sha256(t.encode('utf-8')).hexdigest()

g = random.Random(20261115)
ref = {}


# ====================================================================== 1. unités seules
def fabrique(c):
    """Une unité d'après sa recette : [constructeur, arguments…], puis ses attributs posés (« set »)."""
    k, a = c['f'], c['a']
    u = dict(from_reg=U.from_reg, milice=U.milice, general=U.general, wagon=U.wagon, Unit=None)[k]
    u = U.Unit(**a[0]) if k == 'Unit' else u(*a)
    for n, v in c['set'].items():
        setattr(u, n, [tuple(p) for p in v] if n == 'path' else v)
    return u


def recette(f, *a, **s):
    return dict(f=f, a=list(a), set=s)


TYPES = list(R.UNITS)
recettes = []
for i, typ in enumerate(TYPES):
    cls = U.cls_of(typ)
    for arm in range(0, 9, 2 if typ != 'artillerie' else 1):
        reg = dict(id=f'r{i}_{arm}', type=typ, n=g.choice([300, 280.5, 120, 37, 1]), xp=g.choice([0, 12.5, 50, 99]),
                   morale=g.choice([70, 55.5]), fat=g.choice([0.0, 33.3]), ammo=g.choice([100.0, 42, 0]), arm=arm)
        if arm == 8:
            del reg['arm'], reg['xp'], reg['morale'], reg['fat'], reg['ammo']
        for form in U.FORMS[cls] + (('maisons',) if cls == 'inf' else ()):
            s = dict(x=round(g.uniform(0, 3000), 3), y=round(g.uniform(0, 2000), 3), form=form, dir=g.uniform(-3, 3))
            r = g.random()
            if r < 0.2:
                s.update(state='deroute', halt=g.random() < 0.5, flag=False)
            elif r < 0.3:
                s.update(state='hors')
            elif r < 0.5:
                s.update(target='r0_0', order=dict(kind='attack', target='r0_0'), busy=g.choice([0.0, 12.4, 37.5]),
                         path=[[g.uniform(0, 3000), g.uniform(0, 2000)] for _ in range(g.randrange(1, 15))],
                         fire_mode=g.choice(['free', 'volley', 'hold']), stop=g.choice(U.STOPS), goal=[10.0, 20.0, None, True])
            if g.random() < 0.3:
                s['men'] = g.choice([0.5, 1.0, 75.0, 600.0, 151])
            recettes.append(recette('from_reg', reg, i % 2, '33' if i % 2 == 0 else '24', f'{i}e {typ}',
                                    g.choice([None, 'a1']), g.choice(['reg', 'garnison']), g.choice([None, 12]),
                                    g.choice(['ia', 'joueur']), **s))
for arm in range(8):
    recettes.append(recette('milice', f'm{arm}', 1, '24', g.choice([150, 87.5]), 65, arm, f"Milice {arm}", 7, 'ia',
                            x=100.5, y=200.25))
for lvl, trait in ((1, None), (2, 'inspirant'), (3, 'cavalier'), (5, 'artilleur'), (9, 'prudent')):
    recettes.append(recette('general', f'g{lvl}', lvl % 2, '33', dict(name=f'Gal {lvl}', trait=trait, lvl=lvl), 'a1', 'joueur',
                            x=10.0, y=20.0, dir=1.5))
recettes.append(recette('general', 'g0', 0, '33', dict(trait='eclaireur'), 'a2', 'ia', x=1, y=2))
recettes.append(recette('wagon', 'w1', 0, '33', 'a1', 'Chariot', 'ia', x=300.0, y=400.0))
recettes.append(recette('Unit', dict(id='u1', side=0, owner='33', type='ligne', cls='inf', name='nue', men=250, men0=250, xp=10,
                                     morale=60, ammo=30, ammo0=60, x=5, y=6, form='ligne', path=[(1.04, 2.06), (3, 4.25)])))

DIST = [0.0, 30.0, 55.5, 100.0, 250.0, 1000.0]
unites = []
for c in recettes:
    u = fabrique(c)
    d = u.to_dict()
    vues = [u.view(True, True), u.view(True, False), u.view(False, False)]
    rond = U.Unit.from_dict(d).to_dict()
    # (en entier pour les premières, en empreintes ensuite : la référence reste sous 1 Mo)
    plein = len(unites) < 6
    unites.append(dict(
        recette=c, dict=d if plein else E(d), dict_repr=repr(d) if plein else sha(repr(d)), vues=vues if plein else E(vues),
        vues_repr=repr(vues) if plein else sha(repr(vues)), rond_repr=sha(repr(rond)),
        alive=u.alive, valid=u.valid, d50=U.d50(u), precision=[U.precision(u, x) for x in DIST], bout=U.bout_portant(u),
        stop=[U.stop_dist(u, s) for s in U.STOPS + ('autre',)], reload=U.reload_time(u), pieces=U.pieces(u),
        footprint=list(U.footprint(u)), ranges=repr(U.ranges(u)), zones=BT.fire_zones(u), zones_repr=repr(BT.fire_zones(u)),
        mc=BT.move_class(u)))
ref['unites'] = unites
ref['cls_of'] = [[t, U.cls_of(t)] for t in TYPES + ['milice', 'general', 'chariot', 'inconnu']]
ref['ranges_dict'] = [[r, repr(U.ranges(r))] for r in
                      [dict(type=t, arm=a) for t in TYPES + ['milice', 'general'] for a in (None, 0, 3, 7, 12)] + [dict(type='ligne')]]
ref['ammo0_of'] = [[c, U.ammo0_of(c)] for c in ('inf', 'artillerie', 'cavalerie', 'general', 'chariot')]

# unit_name (sans partie : g = None)
ref['unit_name'] = [[t, i, U.unit_name(None, '33', t, i)] for t in TYPES + ['milice', 'general', 'autre'] for i in (1, 2, 4, 21)]

# ====================================================================== stats
cas = []
for typ in TYPES + ['milice', 'general', 'chariot', 'inconnu']:
    for arm in (0, 2, 5, 7, None, 11):
        for xp in (0.0, 37.5, 100.0):
            tr = g.choice([None, 'audacieux', 'cavalier', 'artilleur', 'inspirant', 'prudent'])
            mods = g.choice([None, {}, dict(all_power=0.1, cav_power=0.15, ligne_fire=0.2, colonne_charge=0.1, cav_charge=0.25,
                                             art_power=0.05, inf_power=0.08)])
            a = [typ, arm, xp, tr, g.random() < 0.5, g.choice([0.0, 0.1, 0.35]), mods]
            s = ST.stats(*a)
            cas.append(dict(a=a, r=s, repr=repr(s)))
ref['stats'] = cas
ref['xp_k'] = [[x, ST.xp_k(x)] for x in (0.0, 12.5, 50.0, 100.0)]
MD = [{}, dict(all_power=0.1), dict(all_power=0.1, inf_power=0.2, cav_power=0.3, art_power=0.05, cav_charge=0.25, colonne_charge=0.15)]
ref['power_k'] = [[m, c, ST.power_k(m, c), ST.charge_k(m, c)] for m in MD for c in ('inf', 'cavalerie', 'artillerie', 'general')]

# ====================================================================== fonctions pures d'orders et de battle
ref['wing_sign'] = [[o, OR.wing_sign(o)] for o in ({}, dict(wing='gauche'), dict(wing='droite'))]
ref['res_count'] = [[o, n, d, OR.res_count(o, n, d)] for o in (None, {}, dict(res='aucune'), dict(res='tiers'), dict(res='quart'))
                    for n in (0, 2, 3, 7, 9, 10) for d in (1, 2)]
us = [fabrique(c) for c in recettes[:40]]
ref['men'] = [[c, OR._men(us, c)] for c in (None, 'inf', 'cavalerie', 'artillerie', 'general')]
ref['grape_k'] = [[d, gr, BT.grape_k(d, gr)] for d in (0.0, 0.5, 50.0, 89.0, 120.0, 149.9, 300.0, 900.0) for gr in (250, 400)]
ref['ball_k'] = [[d, e, BT.ball_k(d, e)] for d in (0.0, 100.0, 650.0, 2400.0) for e in (0, 500, 1400)]
ref['ang_diff'] = [[a, b, BT.ang_diff(a, b)] for a in (0.0, 3.0, -3.0, 6.5) for b in (0.0, 3.1, -1.2, 9.9)]
ref['fmt_hour'] = [[c, BT.fmt_hour(c)] for c in (0.0, 59.0, 3600.0, 3725.5, -1800.0, -30000.0, 43210.0)]
# (les textes sont refaits par l'essai : [préfixe, nombre de 'A'])
PIETS = [['data:image/png;base64,', 4], ['data:image/jpeg;base64,', 1], ['data:image/png;base64,', BT.PIET_MAX - 22],
         ['data:image/png;base64,', BT.PIET_MAX - 21], ['data:image/png', 0]]
ref['valid_piet'] = [[None, BT.valid_piet(None)], [3, BT.valid_piet(3)]] + [[p, BT.valid_piet(p[0] + 'A' * n)] for p in PIETS for n in [p[1]]]


# ====================================================================== 2. batailles
GEOS = {v: G.GeoMap(v) for v in (2, 3)}


def libre(geo, x, y, d=1.35):
    return all(math.hypot(n['x'] - x, n['y'] - y) >= d for n in geo.nodes)


def point_libre(geo):
    while True:
        c = g.randrange(len(geo.terrain))
        x, y = round(c % geo.W + g.random(), 2), round(c // geo.W + g.random(), 2)
        if geo.terrain_at(x, y) > G.T_EAU and libre(geo, x, y):
            return x, y


def spec_de(bid, cx, cy, carte, season, weather, place=None, **plus):
    s = dict(bid=bid, seed=g.randrange(1 << 31), cx=cx, cy=cy, season=season, weather=weather, year=g.choice([1760, 1790, 1813, 1859]),
             place=place, att_angle=round(g.uniform(-3.1, 3.1), 3), marks=[[], ['mousquet']], balloon=[0, 1], lieu=None)
    if carte is not None:
        s['carte'] = carte
    s.update(plus)
    return s


def specs():
    out = []
    geo = GEOS[2]
    x, y = point_libre(geo)
    out.append((2, spec_de('b1', x, y, TR.VERSION, 'hiver', 'brouillard')))
    geo3 = GEOS[3]
    x, y = point_libre(geo3)
    out.append((3, spec_de('b2', x, y, None, 'printemps', 'pluie', h_off=-9000.0,
                           tech=[dict(colonne_charge=0.1, all_power=0.05), {}], umd={'r0': dict(entrench=1.0, shell=0.5, all_power=0.2)},
                           entrench=[0.5, 0], shell=[0, 1], fm_swift=[0.1, 0.0])))
    for gv, typ, fort, deg, w in ((2, 'ville', 2, 0.4, 'neige'), (2, 'village', 0, 0.0, 'orage'), (3, 'fort', 3, 0.15, 'soleil')):
        geo = GEOS[gv]
        n = [n for n in geo.nodes if n['type'] == typ][g.randrange(3)]
        pl = dict(nid=n['id'], name=n['name'], type=typ, fort=fort, dmg=0.2, dyn=0, bar=0.3, pop=n['pop0'], x=n['x'], y=n['y'],
                  battle=True, d=0, deg=deg)
        out.append((gv, spec_de(f'p{typ}', n['x'], n['y'], 1, 'ete', w, place=pl)))
    return out


def armee(tb):
    """Les recettes des unités d'une bataille : deux camps, posés au hasard dans leurs zones (après la création)."""
    rs = []
    for side in (0, 1):
        own = '33' if side == 0 else '24'
        for i, typ in enumerate(['ligne', 'ligne', 'legere', 'grenadiers', 'cavalerie', 'artillerie', 'chasseurs', 'mitrailleuses']):
            reg = dict(id=f'r{side}{i}' if (side, i) != (0, 0) else 'r0', type=typ, n=g.choice([300, 240.0, 120]), xp=25.0,
                       morale=70.0, fat=g.choice([0.0, 40.0, 70.0]), ammo=100.0, arm=g.randrange(5))
            rs.append(recette('from_reg', reg, side, own, f'{i + 1}e', 'a1', 'reg', None, 'ia'))
        rs.append(recette('general', f'g{side}', side, own, dict(name=f'Gal{side}', trait=('inspirant', 'eclaireur')[side], lvl=3),
                          'a1', 'ia'))
        rs.append(recette('wagon', f'w{side}', side, own, 'a1', 'Chariot', 'ia'))
    for c in rs:
        z = tb.zone(c['a'][1])
        c['set'] = dict(x=round(g.uniform(z[0], z[2]), 2), y=round(g.uniform(z[1], z[3]), 2), dir=round(g.uniform(-3, 3), 3))
    return rs


def pt():
    return [round(g.uniform(-50, 3050), 2), round(g.uniform(-50, 2050), 2)]


def ordres_hasard(gs):
    """Des ordres bruts, comme le client : une valeur au hasard parmi celles proposées (permises ou non), parfois rien."""
    raw = {}
    for gr in gs:
        if g.random() < 0.8:
            raw[gr['key']] = g.choice(gr['opts'])['v']
    raw['inconnu'] = 'x'
    return raw


def ecart(t, L):
    """Un réglage de l'IA : son empreinte, et ce qui y change (pour lire un écart)."""
    return [E(t), {k: v for k, v in t.items() if k not in L or L[k] != v or type(L[k]) is not type(v)}]


ref['L'] = AI.LEVELS['normal']
batailles = []
for gv, spec in specs():
    geo = GEOS[gv]
    spec0 = copy.deepcopy(spec)   # (la bataille et les ordres y écrivent ensuite)
    tb0 = BT.TacticalBattle(geo, dict(spec), [], (0, 1))
    rs = armee(tb0)
    units = [fabrique(dict(c, set={})) for c in rs]
    tb = BT.TacticalBattle(geo, spec, units, (0, 1))
    for u, c in zip(units, rs):
        for n, v in c['set'].items():
            setattr(u, n, v)
    r = {}
    r['creation'] = dict(edges=tb.edges, zones=tb.zones, ai_zones=tb.ai_zones, zones_repr=repr([tb.zones, tb.ai_zones]), wind=tb.wind,
                         dusk=tb.dusk, wx_at=tb.wx_at, wx_next=tb.wx_next, chaume=sorted(tb.chaume), bati=E(list(tb.bati)),
                         rng=tb.rng.random(), bid=tb.bid, weather=tb.weather, season=tb.season, difficulty=tb.difficulty)
    # ---- zones, bords, place
    r['zone'] = [[tb.zone(s), tb.ai_zone(s), tb.edge(s), tb.front_dir(s)] for s in (0, 1)]
    pts = [pt() for _ in range(30)]
    r['pts'] = pts
    r['edge_point'] = [[tb.edge_point(s, x, y), tb.off_map(s, x, y)] for x, y in pts for s in (0, 1)]
    r['off_map_bords'] = [tb.off_map(s, x, y) for s in (0, 1) for x, y in ((10, 1000), (2990, 1000), (1500, 10), (1500, 1990))]
    r['place'] = dict(objective=tb.objective(), cases_ville=E(tb.cases_ville()), n_ville=len(tb.cases_ville()),
                      degats=tb.degats_ville(), place_info=tb.place_info(), place_repr=repr(tb.place_info()),
                      in_place=[tb.in_place(x, y, m) for x, y in pts for m in (30.0, 0.0)])
    boxes = [[0, 100, 600, 1900], [2400, 100, 3000, 1900], [150, 0, 2850, 600], [150, 1400, 2850, 2000], [0, 0, 3000, 2000],
             [1200.5, 700.5, 1800.0, 1300.0]]
    r['dry'] = [[b, tb._dry(b)] for b in boxes]
    # ---- terrain
    r['terrain'] = [[tb.cell(x, y), tb.terrain_at(x, y), tb.is_wood(x, y), tb.height_at(x, y), tb.cover_at(x, y), tb.feature_at(x, y)]
                    for x, y in pts]
    r['cells_near'] = [tb.cells_near(x, y, rr) for (x, y), rr in zip(pts[:8], (0.0, 10.0, 25.0, 60.0, 140.0, 33.3, 400.0, 5.0))]
    r['costs'] = [[mc, s, E(tb.costs(mc, s))] for mc in ('inf', 'light', 'cav', 'art') for s in (0, 1)]
    r['passable'] = [[tb.passable(x, y, cls, s) for cls in ('inf', 'cavalerie', 'general', 'artillerie', 'chariot', 'light') for s in (0, 1)]
                     for x, y in pts]
    r['nearest'] = [[tb.nearest_passable(cls, s, x, y, mr, hf) for cls in ('inf', 'art') for s in (0, 1) for mr, hf in ((12, False), (3, True))]
                    for x, y in pts[:10]]
    r['nearest_u'] = [tb.nearest_passable(u, u.side, x, y, 12, False) for u, (x, y) in zip(units, pts)]
    eyes = (2.5, 3.0, 3.5)
    los, los_in = [], []
    for _ in range(250):
        a, b = pt(), pt()
        e1, e2 = g.choice(eyes), g.choice(eyes)
        los_in.append(a + b + [e1, e2])
        los.append(int(tb.los(a[0], a[1], b[0], b[1], e1, e2)))
    r['los_in'] = los_in
    r['los'] = ''.join(map(str, los))
    r['los_units'] = ''.join(str(int(tb.los_units(a, b))) for a in units for b in units)
    plans = []
    for u in units:
        for _ in range(3):
            left = tb._astar_left = g.choice([6, 1, 0])
            x, y = pt()
            plans.append([left, x, y, tb.plan_path(u, x, y), tb._astar_left])
    r['plan_path'] = plans
    r['path_cost'] = [[tb.path_cost(a[0], a[1], b[0], b[1], cls, s) for cls in ('inf', 'cav', 'artillerie') for s in (0, 1)]
                      for a, b in zip(pts[:10], pts[10:20])]
    r['astar'] = [tb._astar(tb.costs('inf', 0), tb.cell(*a), tb.cell(*b), cap) for a, b in zip(pts[:6], pts[6:12]) for cap in (9000, 50)]
    r['best_spot'] = [[tb.best_spot(x, y, rad, kind, s, fac, cls) for kind, fac in (('cover', None), ('height', None), ('wood_edge', 0.7),
                                                                                    ('wood_edge', None), ('wood_edge', -2.0))
                       for rad, s, cls in ((150.0, 0, 'inf'), (300.0, 1, 'cav'))] for x, y in pts[:6]]
    # ---- unités
    tb.seen_by[0] = {u.id for u in units if u.side == 1 and g.random() < 0.6}
    tb.seen_by[1] = {u.id for u in units if u.side == 0 and g.random() < 0.6}
    r['seen'] = [sorted(tb.seen_by[0]), sorted(tb.seen_by[1])]
    units[3].state = 'deroute'
    units[13].state = 'hors'
    ids = lambda us: [u.id for u in us]  # noqa: E731
    r['listes'] = [[ids(tb.units_of(s)), ids(tb.ai_units(s)), ids(tb.visible_enemies(s)), tb.strength(s), tb.seen_strength(s),
                    [tb.threat(s, x, y, rad) for x, y in pts[:10] for rad in (600, 1500.0)]] for s in (0, 1)]
    r['unit'] = [ids([tb.unit(i)]) if tb.unit(i) else None for i in ('r0', 'g1', 'zz', None)]
    r['dist'] = [[tb.dist(a, b), tb.bearing(a, b)] for a, b in zip(units, units[5:])]
    tb.clock = 1234.5
    r['time_left'] = tb.time_left()
    gens = []
    for k in range(2):
        if k == 1:   # (l'état-major du camp 1 tombe : on recalcule)
            units[-2].state = 'hors'
            tb._refresh_gens()
        gens.append([[ids([x]) if x else None for x in (tb.general_near(u, 400), tb.general_near(u, 1500.0), tb.rally_general(u))]
                     + [tb.has_general(u.side), tb.trait(u.side), tb.rally_radius(units[8 if u.side == 0 else 18])]
                     + [list(tb._rally_k(u, foe, order)) for foe in (100.0, 160.0, 500.0, 900.0) for order in (False, True)]
                     for u in units])
    r['gens'] = gens
    r['tech'] = [[tb.tech(s) for s in (0, 1)], [[tb.tech_of(u), tb.ufx(u, 'entrench'), tb.ufx(u, 'shell')] for u in units[:3]]]
    tb.clock = 61.7
    tb.emit('feu', 10.4, 20.5, None, None, None, None)
    tb.emit('charge', 1.5, 2.5, 3.5, 4.5, 7, 'r0')
    tb.emit('mort', 0.0, 0.0, None, None, 12.345, None)
    tb.log('Un message', None, None)
    tb.log('Un autre', 1, 0)
    for i in range(520):
        tb.emit('x', i, i)
    for i in range(310):
        tb.log(f'm{i}', 0)
    r['journal'] = dict(seq=tb.seq, fx=E(tb.fx), fx0=tb.fx[:3], n_fx=len(tb.fx), logs=E(tb.logs), n_logs=len(tb.logs))
    # ---- les ordres du joueur (orders.py) sur cette bataille
    tb.clock = 0.0
    o = {}
    for side in (0, 1):
        livres = (None, 30, 100)[side + (1 if spec['bid'] == 'b2' else 0)]
        gs = OR.groups(tb, side, livres)
        raws = [ordres_hasard(gs) for _ in range(3)] + [None, 'texte']
        cl = [OR.clean(tb, side, raw, livres) for raw in raws]
        o[side] = cl[0]
        r[f'ordres{side}'] = dict(livres=livres, groups=gs, defaults=OR.defaults(tb, side, gs), defaults_none=OR.defaults(tb, side, None),
                                  raws=raws, clean=cl, units=ids(OR._units(tb, side)), fat=OR._fat(tb, side), era=OR.era(tb),
                                  general=OR.general(tb, side), wood=[OR.wood_on_wing(tb, side, w) for w in (-1, 1)],
                                  scouting=OR.scouting(tb, side))
    tb.ai_mem = {'s0': dict(ax=600.0, ay=1000, fd=0.2, width=800, ord=dict(wood=[900, 700]), plan='frontal'),
                 's1': dict(ax=2400.5, ay=900.0, fd=math.pi, plan='tenir')}
    av = []
    for side in (0, 1):
        r[f'report{side}'] = OR.report(tb, side)
        mans = [x[0] for x in (OR.MAN_PLACE if tb.place_info() else OR.MAN)[side]] + ['autre']
        for m in mans:
            for k in range(2):
                oo = dict(o[side], man=m)
                if k:
                    oo.update(ruse=g.choice([x[0] for x in OR.RUSE]), cav=g.choice([x[0] for x in OR.CAV]),
                              art=g.choice([x[0] for x in OR.ART]), inf=g.choice(['colonne', 'dispersé', 'ligne']),
                              vsCav=g.choice([x[0] for x in OR.VS_CAV]), hour=g.choice(['aube', 'midi', 'matin']),
                              mood=g.choice([x[0] for x in OR.MOOD]), obj=g.choice([x[0] for x in OR.OBJ[0]]),
                              res=g.choice(['aucune', 'tiers', 'quart']), wing=g.choice(['gauche', 'droite']))
                av.append([side, oo, OR.advise(tb, side, oo), OR.arrows(tb, side, oo)])
    r['avis'] = av
    r['arrows_vides'] = [OR.arrows(tb, 0, {}), OR.arrows(tb, 0, None)]
    L = AI.LEVELS['normal']
    tw = []
    for oo in ([None, None], [o[0], None], [None, o[1]], [dict(o[0], man='percee', art='grande', mood='audacieux', obj='retraite',
                                                                resWhen='cede', vsCav='contre', cav='raid', leg='colonnes', ruse='feux'),
                                                         dict(o[1], man='elastique', art='prepa', obj='user', vsCav='feu',
                                                              cav='ecran', leg='avant', ruse='retraite')],
                                                        [dict(o[0], man='sorties', obj='cle'), dict(o[1], man='murs', obj='retraite')],
                                                        [dict(o[0], man='pilonner'), dict(o[1], man='escalade', mood='prudent')]):
        tb.spec['orders'] = oo
        tw.append([oo, [OR.of(tb, s) for s in (0, 1)], [OR.plan(tb, s, tb.place_info()) for s in (0, 1)],
                   [OR.plan(tb, s, None) for s in (0, 1)], [OR.tweak(tb, s, L) is L for s in (0, 1)],
                   [ecart(OR.tweak(tb, s, L), L) for s in (0, 1)], [OR.announced_k(tb, s) for s in (0, 1)]])
    r['tweak'] = tw
    # le moment décisif
    tb.spec['orders'] = [dict(o[0], resWhen='demande'), dict(o[1], resWhen='plie')]
    seq = []
    seq.append(OR.ask(tb, 0, 'res', 'Engager la réserve ?'))   # (pas de replay : 'go')
    tb.replay = {}
    tb.clock = 100.4
    seq += [OR.ask(tb, 0, 'res', 'Engager la réserve ?'), tb.ask, OR.ask(tb, 1, 'res', 'x'), OR.ask(tb, 0, 'cav', 'Et la cavalerie ?'), tb.ask]
    seq += [OR.answer(tb, 'wait'), tb.ask, OR.ask(tb, 0, 'res', 'y')]
    tb.clock = 1100.6
    seq += [OR.ask(tb, 0, 'res', 'y'), OR.ask(tb, 0, 'cav', 'z'), OR.answer(tb, 'go'), OR.answer(tb, 'go'), OR.ask(tb, 0, 'cav', 'z')]
    tb.replay = dict(skip=True)
    seq += [OR.ask(tb, 0, 'feu', 'w'), tb.ai_mem]
    r['ask'] = seq
    # l'heure de l'attaque
    st = []
    for side, h in ((0, 'aube'), (1, 'midi'), (0, 'matin'), (1, 'aube')):
        tb.clock = 3000.0 * side
        OR.setup(tb, side, dict(hour=h))
        st.append([tb.dusk, tb.light, tb.spec['h_off'], [[u.morale, u.fat] for u in units]])
    r['setup'] = st
    batailles.append(dict(gv=gv, spec=spec0, recettes=rs, r=r))
ref['batailles'] = batailles

commun.ecrire('unites', ref)
