"""Références des champs de bataille (rust/conquete/src/tactics/terrain.rs, terrain_v1.rs) : ce que rendent
game/tactics/terrain.py et terrain_v1.py. Écrit rust/conquete/tests/references/terrain.json, relu par
rust/conquete/tests/terrain.rs.
    python3 outils/jumeau/terrain_ref.py            (--formes DOSSIER : les formes complètes des cartes, pour chercher un écart ;
                                                     --trace FICHIER NOM : la trace du hasard de la carte NOM)

Chaque carte est faite sur la vraie carte de campagne (GeoMap, géographie 3 ou 2 : `gv`) ; l'essai Rust la refait sur
la GeoMap de geo.rs (vérifiée par ailleurs identique à celle de Python).

Les cartes de version 9 avec une place (spec['place'], ou un lieu à moins de 1,3 km) passent par terrain_ville.py, porté
plus tard : elles ne sont pas ici.
"""
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commun  # noqa: E402

if '--trace' in sys.argv:
    TRACE = commun.tracer_hasard(sys.argv[sys.argv.index('--trace') + 1])
    TRACE_NOM = sys.argv[sys.argv.index('--trace') + 2]
else:
    TRACE = TRACE_NOM = None

from game import geo as G  # noqa: E402
from game.tactics import terrain as TR, terrain_v1 as V1  # noqa: E402

FORMES = sys.argv[sys.argv.index('--formes') + 1] if '--formes' in sys.argv else None
N, COLS = TR.N, TR.COLS
E = commun.empreinte_ordre


# ====================================================================== l'état d'une carte
def etat(m, spec):
    d = dict(t=m.t, h=m.h, f=m.f, biome=m.biome, roads=m.roads, rivers=m.rivers, buildings=m.buildings, walls=m.walls,
             hedges=m.hedges, fences=m.fences, bridges=m.bridges, place=m.place, heart=m.heart, town_r=m.town_r,
             region=m.region, stats=m.stats)
    if hasattr(m, 'batis'):
        d.update(town=m.town, bastions=m.bastions, demi_lunes=m.demi_lunes, batis=m.batis, plan=m.plan)
    d['client'] = m.to_client(spec)
    return d


def empreintes(et):
    return {k: E(v) for k, v in et.items()}


GEOS = {v: G.GeoMap(v) for v in (3, 2)}
ref = dict(cartes=[])
TEMPS = []


def cas(nom, gv, spec):
    """Range un cas : la carte de spec sur la géographie gv ; rend la carte."""
    if TRACE and nom == TRACE_NOM:
        TRACE.truncate(0)
        TRACE.seek(0)
    t0 = time.perf_counter()
    m = TR.generate(GEOS[gv], dict(spec))
    TEMPS.append((time.perf_counter() - t0, spec.get('carte', 1)))
    if TRACE and nom == TRACE_NOM:
        TRACE.flush()
        print(f'trace du hasard de {nom} écrite')
        sys.exit(0)   # (tout Random est tracé : la suite allongerait la trace)
    et = etat(m, spec)
    if FORMES:
        os.makedirs(FORMES, exist_ok=True)
        with open(os.path.join(FORMES, nom + '.py.txt'), 'w', encoding='utf-8') as f:
            for k, v in et.items():
                f.write(f'{k} {commun.canon_ordre(v)}\n')
    ref['cartes'].append(dict(nom=nom, spec=spec, gv=gv, etat=empreintes(et), stats=m.stats, region=m.region,
                              n=[len(m.roads), len(m.rivers), len(m.buildings), len(m.walls), len(m.bridges)]))
    return m


def libre(geo, x, y, d=1.35):
    return all(math.hypot(n['x'] - x, n['y'] - y) >= d for n in geo.nodes)


g = random.Random(20261115)
SAISONS, METEOS = ['printemps', 'ete', 'automne', 'hiver'], ['soleil', 'pluie', 'brouillard', 'neige', 'canicule', 'orage']


def spec_de(k, cx, cy, carte, place=None, **plus):
    s = dict(seed=g.randrange(1 << 31), cx=cx, cy=cy, season=SAISONS[k % 4], weather=METEOS[k % 6],
             year=(1790, 1805, 1840, 1858, 1870)[k % 5], place=place, att_angle=round(g.uniform(-3.1, 3.1), 3),
             marks=[[], ['mousquet']], balloon=[0, 1], lieu=None)
    if carte is not None:
        s['carte'] = carte
    s.update(plus)
    return s


# ---------------------------------------------------------------------- 1. chaque terrain de campagne, sans lieu (version 9 et 1)
NOMS_T = {G.T_PLAINE: 'plaine', G.T_FORET: 'foret', G.T_LANDE: 'lande', G.T_MARAIS: 'marais', G.T_COLLINES: 'collines',
          G.T_MONTAGNE: 'montagne', G.T_HAUTE: 'haute', G.T_DUNES: 'dunes', G.T_VIGNE: 'vigne'}
k = 0
for gv, par_type in ((3, 3), (2, 2)):
    geo = GEOS[gv]
    for T, nomt in NOMS_T.items():
        cases = [c for c in range(len(geo.terrain)) if geo.terrain[c] == T]
        faits, essais = 0, 0
        while cases and faits < par_type and essais < 200:
            essais += 1
            c = cases[g.randrange(len(cases))]
            cx, cy = round(c % geo.W + g.random(), 2), round(c // geo.W + g.random(), 2)
            if not libre(geo, cx, cy):
                continue
            carte = TR.VERSION if faits != 1 else (None if gv == 3 else 1)   # (le deuxième de chaque sorte : l'ancien générateur)
            k += 1
            if cas(f'{nomt}-g{gv}-{faits}-v{carte or 0}', gv, spec_de(k, cx, cy, carte)):
                faits += 1

# ---------------------------------------------------------------------- 2. rivières, ponts, gués, bacs, côtes (les deux versions)
for gv in (3, 2):
    geo = GEOS[gv]
    # (a) un pont : là où une route passe une rivière (edges : ponts), loin de tout lieu
    ponts = [(p, e) for e in geo.edges for p in e.get('ponts', []) if libre(geo, p[0] + 0.3, p[1] + 0.2)]
    for rang in (1, 2, 3):
        du_rang = [p for p, e in ponts if p[3] == rang]
        for q in range(2 if gv == 3 else 1):
            if not du_rang:
                break
            p = du_rang[g.randrange(len(du_rang))]
            k += 1
            carte = TR.VERSION if q == 0 else None
            cas(f'pont-rang{rang}-g{gv}-v{carte or 0}', gv, spec_de(k, round(p[0] + 0.3, 2), round(p[1] + 0.2, 2), carte))
    # (b) une rivière sans route : un point de son cours
    for rang in (1, 2, 3):
        rivs = [r for r in geo.src['rivers'] if r['rank'] == rang]
        for q in range(2):
            for _ in range(60):
                r = rivs[g.randrange(len(rivs))]
                lon, lat = r['pts'][g.randrange(len(r['pts']))]
                x, y = geo.xy(lat, lon)
                cx, cy = round(x + g.uniform(-0.6, 0.6), 2), round(y + g.uniform(-0.4, 0.4), 2)
                if libre(geo, cx, cy) and geo.terrain_at(cx, cy) > G.T_EAU:
                    k += 1
                    carte = TR.VERSION if q == 0 else None
                    if cas(f'riviere-rang{rang}-g{gv}-v{carte or 0}', gv, spec_de(k, cx, cy, carte)):
                        break
    # (c) la côte : une case de terre qui touche l'océan
    cote = [c for c in range(geo.W, len(geo.terrain) - geo.W) if geo.terrain[c] > G.T_EAU and G.T_OCEAN in (geo.terrain[c - 1], geo.terrain[c + 1], geo.terrain[c - geo.W], geo.terrain[c + geo.W])]
    for q in range(3):
        for _ in range(60):
            c = cote[g.randrange(len(cote))]
            cx, cy = round(c % geo.W + g.random(), 2), round(c // geo.W + g.random(), 2)
            if libre(geo, cx, cy):
                k += 1
                carte = TR.VERSION if q != 1 else None
                if cas(f'cote-g{gv}-{q}-v{carte or 0}', gv, spec_de(k, cx, cy, carte)):
                    break
# (d) les ponts datés : avant le pont de pierre, la route de Bordeaux passe la Garonne sur des bateaux
geo = GEOS[2]
for v, rv, an in TR.PONTS_DATES[:4]:
    n = next(n for n in geo.nodes if n['name'] == v)
    for e in geo.edges:
        for p in e.get('ponts', []):
            if p[2] == rv and math.hypot(p[0] - n['x'], p[1] - n['y']) < 4 and libre(geo, p[0] + 0.2, p[1] + 0.3):
                for year in (an - 1, an):
                    k += 1
                    cas(f'bac-{v}-{year}', 2, spec_de(k, round(p[0] + 0.2, 2), round(p[1] + 0.3, 2), TR.VERSION, year=year))
                break
        else:
            continue
        break

# ---------------------------------------------------------------------- 3. les places de l'ancien générateur (version 1)
for gv in (2, 3):
    geo = GEOS[gv]
    for typ in ('village', 'fort', 'ville', 'capitale'):
        lieux = [n for n in geo.nodes if n['type'] == typ]
        for q, (fort, bataille, dmg, dyn, bar) in enumerate([(0, False, 0.0, 0, 0.0), (0, True, 0.0, 0, 0.6), (1, True, 0.3, 0, 0.0),
                                                             (2, True, 0.5, 1, 0.5), (3, True, 0.9, 0, 0.9), (4, True, 0.05, 2, 0.2),
                                                             (2, False, 0.4, 1, 0.4)]):
            if gv == 3 and q not in (1, 4):
                continue
            n = lieux[g.randrange(len(lieux))]
            pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=fort, dmg=dmg, dyn=dyn, bar=bar,
                      pop=int(n['pop0'] * g.uniform(0.6, 1.6)), x=n['x'], y=n['y'], battle=bataille, d=0, deg=0.0)
            if q == 5:
                del pl['dyn']
                pl['pop'] = 0
            k += 1
            cas(f'place-{typ}-g{gv}-f{fort}-{q}', gv, spec_de(k, n['x'], n['y'], None if q % 2 else 1, place=pl))
    # un lieu tout près d'une bataille rangée : son village paraît sur la carte
    for q in range(3):
        n = geo.nodes[g.randrange(len(geo.nodes))]
        k += 1
        cas(f'pres-{n["type"]}-g{gv}-{q}', gv, spec_de(k, round(n['x'] + g.uniform(-0.8, 0.8), 2), round(n['y'] + g.uniform(-0.8, 0.8), 2), None,
                                                        lieu=dict(nid=n['id'], f=1, pop=900, d=0)))
# une place au bord du champ : la ville et ses murs sortent de la carte
for q, typ in enumerate(('ville', 'capitale', 'fort')):
    n = next(n for n in GEOS[2].nodes if n['type'] == typ)
    pl = dict(nid=n['id'], name=n['name'], type=typ, fort=3 + q % 2, dmg=0.4, dyn=0, bar=0.3, pop=n['pop0'], x=n['x'], y=n['y'], battle=True)
    k += 1
    cas(f'bord-{typ}', 2, spec_de(k, round(n['x'] + (1.3, -1.35, 1.2)[q], 2), round(n['y'] + (0.8, 0.85, -0.9)[q], 2), None, place=pl))
# une place vide ({}) vaut « pas de place » ; graine en texte, en flottant, énorme ; année absente
n = next(n for n in GEOS[2].nodes if libre(GEOS[2], n['x'] + 2.2, n['y'] + 1.7))
for q, (carte, graine) in enumerate([(TR.VERSION, '123456'), (TR.VERSION, 98765.9), (TR.VERSION, (1 << 40) + 77), (1, -5)]):
    s = spec_de(q, round(n['x'] + 2.2, 2), round(n['y'] + 1.7, 2), carte, place={}, seed=graine)
    del s['year'], s['marks'], s['balloon']
    cas(f'bizarre-{q}', 2, s)


# ====================================================================== les fonctions, une à une
def base(nom):
    """La carte d'un cas déjà rangé, refaite (les scènes plus bas la modifient)."""
    c = next(c for c in ref['cartes'] if c['nom'] == nom)
    return TR.generate(GEOS[c['gv']], dict(c['spec'])), c


F = ref['fonctions'] = {}
h = random.Random(424242)
F['hash'] = [[a, b, s, TR._hash(a, b, s)] for a, b, s in
             [(h.randrange(-5000, 200000), h.randrange(-500, 20000), h.randrange(1 << 31)) for _ in range(150)] +
             [(h.randrange(1 << 40), -h.randrange(1 << 35), h.randrange(1 << 31) + 7) for _ in range(50)] + [(0, 0, 0), (1, 1, 1), (-1, -1, -1)]]


def echant(v):
    return dict(e=E(v), v=[v[0], v[7777], v[N - 1]])


F['noise'] = [[s, sc, o, p, echant(TR.noise(random.Random(s), sc, o, p))] for s, sc, o, p in
              [(1, 16, 2, 0.5), (2, 34, 3, 0.45), (3, 13, 3, 0.55), (4, 3, 1, 0.5), (5, 9, 2, 0.5), (6, 6, 2, 0.5), (7, 2.5, 4, 0.7)]]
bruit = TR.noise(random.Random(7), 16, 2, 0.5)
F['blur'] = [[r, echant(TR.blur(bruit, r))] for r in (1, 3, 7)] + [[7, echant(TR.blur([float(int(v * 9) * 9) for v in bruit], 7))]]
masque = [v > 0.42 for v in TR.noise(random.Random(8), 9, 2, 0.5)]
F['bfs'] = []
for maxd, filtre in ((7, False), (14, False), (32, True), (255, True), (0, False)):
    src = [h.randrange(N) for _ in range(6)]
    F['bfs'].append([src, maxd, filtre, E(TR.bfs(src, maxd, (lambda c: masque[c]) if filtre else None))])
pts = [(h.uniform(-100, 3100), h.uniform(-100, 2100)) for _ in range(150)] + \
    [(0.0, 0.0), (2999.999, 1999.999), (3000.0, 0.0), (-0.0, 5.0), (20.0, 20.0), (19.999999999999996, 0.0), (-1e-9, 3.0), (59.99999999999999, 40.0)]
F['cell_of'] = [[x, y, TR.cell_of(x, y)] for x, y in pts]
F['center_of'] = [[c, list(TR.center_of(c))] for c in [0, 149, 150, N - 1] + [h.randrange(N) for _ in range(10)]]


def trace_au_hasard(n, large=False):
    a, b = (-600, 3600) if large else (100, 2900)
    return [(h.uniform(a, b), h.uniform(a * 2 / 3, b * 2 / 3)) for _ in range(n)]


F['traces'] = []
for q in range(12):
    p = trace_au_hasard(2 + q % 5, large=q % 2 == 1)
    pas = (8.0, 20.0, 40.0, 50.0)[q % 4]
    d = TR._densify(p, pas)
    amp, wave = [(45, 300), (18, 700), (35 + 130 * 0.4, 520 + 260), (0, 300), (20, 300)][q % 5]
    calme = ((1500.0, 1000.0), 300.0) if q % 3 == 0 else None
    md = TR._meander(d, random.Random(100 + q), amp, wave, calme=calme)
    marge = (0.0, 100.0, 200.0)[q % 3]
    F['traces'].append(dict(pts=p, pas=pas, densify=E(d), amp=amp, wave=wave, calme=calme, graine=100 + q, meander=E(md), marge=marge,
                            clip=E(TR._clip_poly(md, marge)), n_clip=len(TR._clip_poly(md, marge)), poly_cells=E(TR._poly_cells(md)),
                            line4=E(TR._line4(p)), line_cells=TR._line_cells(p[0][0], p[0][1], p[1][0], p[1][1]),
                            near=TR._poly_near_field(p)))
F['meander_court'] = [list(map(list, TR._meander([(0.0, 0.0), (10.0, 5.0)], random.Random(1), 45, 300)))]
F['seg_dist'] = [[*a, TR._seg_dist(*a)] for a in [[h.uniform(-50, 50) for _ in range(6)] for _ in range(60)] + [[1.0, 2.0, 3.0, 4.0, 3.0, 4.0]]]
F['random_crossing'] = [[s, TR._random_crossing(random.Random(s))] for s in range(8)]
F['hedge_lines'] = []
for seuil in (0.55, 0.62, 0.7):
    cells = [c for c in range(N) if bruit[c] > seuil and TR._hash(c, 3, 5) < 0.6]
    F['hedge_lines'].append([seuil, len(cells), E(TR._hedge_lines(cells))])
F['stamp'] = []
for q, rayon in enumerate((11.0, 25.0, 65.0, 37.5)):
    p = trace_au_hasard(3, large=True)
    ordre = []
    vu = TR._stamp(None, p, rayon, ordre.append) if q else TR._stamp(None, p, rayon, ordre.append, step=20.0)
    assert sorted(vu) == sorted(ordre)
    F['stamp'].append([p, rayon, 8.0 if q else 20.0, len(ordre), E(ordre)])
F['vauban'] = [[*a, E(TR._vauban(*a))] for a in [(1500.0, 1000.0, 4, 300.0, 0.3), (1400.5, 900.25, 5, 280.0, -1.2), (1500.0, 1000.0, 7, 410.0, 2.0),
                                                 (1600.0, 1100.0, 9, 520.0, 0.0)]]
F['trace'] = []
for q, (R, bast, road_a) in enumerate([(120.0, False, 0.0), (200.0, False, 1.0), (140, True, 0.4), (212.5, True, -2.0), (330.5, True, 3.0), (40.0, True, 0.0)]):
    poly, ravs = TR._trace((1480.0 + q, 1010.0 - q), R, bast, random.Random(50 + q), road_a)
    ded = TR._dedans(poly)
    F['trace'].append([R, bast, road_a, 50 + q, len(poly), E([poly, ravs]), E([int(ded(c)) for c in range(N)])])
F['toit'] = E([TR._toit(kd, dp, vl, an, hh) for kd in ('maison', 'ferme', 'eglise', 'moulin', 'hotel') for dp in ('33', '24', '40', '64', '47', '')
               for vl in (None, 'ville', 'capitale', 'fort') for an in (1790, 1860) for hh in (0.1, 0.3, 0.52, 0.6)])
hf = [3 + 30 * v for v in TR.noise(random.Random(3), 34, 3, 0.45)]
F['ilots'] = []
for q, main in enumerate((G.T_PLAINE, G.T_LANDE, G.T_VIGNE, G.T_COLLINES)):
    routes = [dict(pts=TR._densify(trace_au_hasard(3), 50.0), kind='route') for _ in range(q)]
    F['ilots'].append([main, 1000 + q, [r['pts'] for r in routes], E(TR._ilots(1000 + q, hf, routes, main))])

# ---------------------------------------------------------------------- scènes sur une carte : ce que terrain_ville appellera
plaines = [c['nom'] for c in ref['cartes'] if c['spec'].get('carte') == TR.VERSION and c['stats']['hist'].get('EAU', 0) < 200]
F['enceinte'] = []
for q, (fort, bast, dmg, dyn, kind, tours, principal, sans_route) in enumerate([
        (1, False, 0.0, 0, None, None, True, False), (2, False, 0.5, 0, None, None, True, False), (3, True, 0.6, 1, None, None, True, False),
        (4, True, 0.9, 2, 'citadelle', [[1, 2], [3, 4]], False, False), (2, False, 0.2, 0, None, None, True, True), (3, True, 0.0, 0, None, None, True, True),
        (2, False, 0.3, 0, None, None, True, 'diagonale'), (3, True, 0.3, 0, None, None, True, 'diagonale')]):
    nom = plaines[q % len(plaines)]
    m, c = base(nom)
    rng = random.Random(300 + q)
    pos, R, att_a = (1450.0 + 20 * q, 1020.0 - 10 * q), 150.0 + 25 * q, 0.5 * q - 1
    if sans_route:
        m.roads = []
    if sans_route == 'diagonale':
        m.roads = [dict(pts=[(pos[0] - R - 207.0, pos[1] - R - 181.0), (pos[0] + R + 203.0, pos[1] + R + 190.0)], kind='route')]
    poly, ravs = TR._trace(pos, R, bast, rng, 0.3 * q)
    inside = TR._dedans(poly)
    wall = set(TR._line4(poly + poly[:1]))
    for rv in ravs:
        wall.update(cc for cc in TR._line4(rv) if not inside(cc))
    streets = {cc for r in m.roads for cc in TR._poly_cells(r['pts'])}
    pl = dict(battle=True, dmg=dmg, dyn=dyn)
    TR._enceinte(m, pl, pos, R, fort, bast, poly, ravs, wall, inside, streets, rng, m.t, att_a, kind, tours, principal)
    m.place = dict(name='Essai', x=round(pos[0]), y=round(pos[1]), type='ville' if q % 2 else 'capitale', r=round(R), fort=fort, battle=True)
    m.town_r = R
    TR._barricades(m, pos, R, 0.2 + 0.15 * q, rng, m.t, att_a)
    TR._redoubts(m, pos, R, 0.15 * q, rng, m.t, att_a)
    TR._batis(m, 5 + q, ('33', '24', '40')[q % 3], 1790 + 20 * q)
    F['enceinte'].append(dict(nom=nom, fort=fort, bast=bast, dmg=dmg, dyn=dyn, kind=kind, tours=tours, principal=principal, sans_route=sans_route,
                              etat=empreintes(etat(m, c['spec']))))
F['poser'] = []
for q in range(3):
    nom = plaines[(q + 2) % len(plaines)]
    m, c = base(nom)
    kinds, reserve, pieds = {}, set(), []
    for qq, (w, hh, kind, parvis) in enumerate([(3, 2, 'eglise', TR.T_ROUTE), (2, 2, 'hotel', TR.T_PRE), (4, 3, 'caserne', TR.T_ROUTE), (1, 1, 'halle', TR.T_PRE),
                                               (5, 4, 'couvent', TR.T_PRE), (2, 2, 'hopital', TR.T_PRE)]):
        near = (300.0 + 550 * qq + 40 * q, 400.0 + 280 * qq) if qq < 5 else (15.0 + 30 * q, 12.0)
        pieds.append(TR._poser(m.t, lambda cc: m.t[cc] in TR.CULTIVE, near, w, hh, kind, kinds, reserve, parvis))
    F['poser'].append(dict(nom=nom, pieds=pieds, t=E(m.t), reserve=E(reserve), kinds=sorted(kinds.items())))
F['chemins'] = []
v9s = [c for c in ref['cartes'] if c['spec'].get('carte') == TR.VERSION]
sec = next(c['nom'] for c in v9s if c['stats']['main'] == G.T_PLAINE and c['n'][1] == 0 and c['n'][2] > 0)   # (moulin à vent)
mouille = next(c['nom'] for c in v9s if c['nom'].startswith(('riviere-rang2', 'riviere-rang3', 'pont-rang2', 'pont-rang3')) and c['n'][2] > 0)   # (moulin à eau)
for q, nom in enumerate([plaines[1], plaines[2], sec, mouille]):
    m, c = base(nom)
    rng = random.Random(700 + q)
    for _ in range(8):   # (sans m.ilot : droit vers la route, comme l'ancien générateur)
        x, y = TR.center_of(rng.randrange(N))
        TR._path_to_road(m, rng, x, y, m.t)
    # le terroir autour d'une place forte : pas de verger sur son glacis
    b = m.buildings[0]
    m.place = dict(name='Essai', x=b['x'], y=b['y'], type='ville', r=100, fort=2, battle=True)
    m.town_r = 100.0
    m.ilot, m.strip = TR._ilots(900 + q, hf, m.roads, c['stats']['main'])
    eau = [cc for cc in range(N) if m.t[cc] in (TR.T_EAU, TR.T_GUE)]
    dwat = TR.bfs(eau, 14) if eau else bytearray([255]) * N
    for cc in range(N):   # (les vergers de la carte redeviennent des champs : le terroir a de quoi faire)
        if m.t[cc] == TR.T_VERGER:
            m.t[cc] = TR.T_CHAMP
    TR._terroir(m, 900 + q, m.t, hf, dwat, m.biome, c['stats']['dept'])
    TR._path_to_road(m, rng, b['x'] + 0.0, b['y'] + 90.0, m.t)   # (avec m.ilot : le chemin longe les parcelles)
    if q >= 2:
        m.plan = dict(essai=1)   # (une carte à plan : pas de moulin dans la ville ni sur son glacis)
        m.town_r = 600.0
    if q == 3:   # (la place au bord de la rivière : le moulin à eau se pose plus loin)
        riv = next(r for r in m.rivers if r['kind'] in ('riviere', 'ruisseau'))
        p = riv['pts'][len(riv['pts']) // 2]
        m.place = dict(m.place, x=round(p[0]), y=round(p[1]))
    TR._farms(m, rng, 4, m.t, hf, c['stats']['main'])   # (les fermes se tiennent loin de la place)
    for _ in range(12):
        TR._mill(m, rng, m.t, hf, c['stats']['main'])
    TR._batis(m, 900 + q, c['stats']['dept'], 1850)
    m.ilot = m.strip = None
    F['chemins'].append(dict(nom=nom, etat=empreintes(etat(m, c['spec']))))
F['chaussee'] = []
cotes = [c['nom'] for c in ref['cartes'] if c['spec'].get('carte') == TR.VERSION and 1500 < c['stats']['hist'].get('EAU', 0) < 13000]
for q, nom in enumerate(cotes[:4]):
    m, c = base(nom)
    land = TR._mainland(m.t)
    eau = [cc for cc in range(N) if m.t[cc] == TR.T_EAU]
    x, y = TR.center_of(eau[len(eau) * (q + 1) // 5])
    px, py = x + 3.7, y + 1.3
    cells = TR._causeway(m, m.t, px, py, 0.7 * q - 1, land)
    F['chaussee'].append(dict(nom=nom, px=px, py=py, att_a=0.7 * q - 1, land=E(land), n_land=len(land), cells=sorted(cells), etat=empreintes(etat(m, c['spec']))))
assert len(F['chaussee']) >= 2, 'pas assez de cartes de côte'

commun.ecrire('terrain', ref)
v9 = sum(1 for c in ref['cartes'] if c['spec'].get('carte') == TR.VERSION)
print(f"{len(ref['cartes'])} cartes ({v9} de version {TR.VERSION}, {len(ref['cartes']) - v9} de version 1)")
print('rivières :', sum(1 for c in ref['cartes'] if c['n'][1]), '; ponts :', sum(1 for c in ref['cartes'] if c['n'][4]), '; murs :',
      sum(1 for c in ref['cartes'] if c['n'][3]))
t9 = [t for t, v in TEMPS if v == TR.VERSION]
t1 = [t for t, v in TEMPS if v != TR.VERSION]
print(f'temps Python par carte : version 9 {1000 * sum(t9) / max(1, len(t9)):.0f} ms, version 1 {1000 * sum(t1) / max(1, len(t1)):.0f} ms')
