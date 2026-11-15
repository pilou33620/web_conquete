"""Références de la géographie (game/places.py, game/geo.py, game/waterways.py) pour le portage en Rust
(rust/conquete/src/places.rs, geo.rs, waterways.rs). Écrit rust/conquete/tests/references/geo.json, relu par
rust/conquete/tests/geo.rs.

    python3 outils/jumeau/geo_ref.py                    les trois cartes, GÉNÉRÉES (jamais relues d'un cache), et la référence
    python3 outils/jumeau/geo_ref.py --caches DOSSIER   de même, et les caches écrits par Python restent dans DOSSIER
                                                        (l'essai Rust les relit : CONQUETE_CACHE_PYTHON=DOSSIER)
    python3 outils/jumeau/geo_ref.py --relire DOSSIER   relit les caches de DOSSIER (écrits par le Rust : CONQUETE_DATA=DOSSIER)
                                                        et compare les cartes à la référence, sans rien écrire
    … --complet DOSSIER                                 écrit aussi la forme complète de chaque attribut (pour chercher un
                                                        écart ; côté Rust : CONQUETE_GEO_COMPLET=DOSSIER)

Le dossier des données du moteur (geo.DATA_DIR) est détourné vers un dossier de travail où les sources sont copiées :
les caches de game/data ne sont ni lus ni touchés.
"""
import hashlib
import json
import os
import random
import shutil
import sys
import tempfile
import time

import commun
from game import geo as G, places as PL, waterways as WW

SOURCES = ('geo_v1.json', 'geo_v2.json', 'geo.json', 'places_france.json')
ATTRIBUTS = ('nodes', 'edges', 'adj', 'by_name', 'terrain', 'dept', 'river', 'road', 'cellnode', 'ways', 'edge_cum',
             'ports', 'down_nodes', 'dept_codes', 'playable_codes')


def option(nom):
    return sys.argv[sys.argv.index(nom) + 1] if nom in sys.argv else None


def masque(marques):
    """Le masque de army_actions.cell_mask : une marque par lieu interdit."""
    m = bytearray(65536)
    for nid, t in marques:
        m[nid] = t
    return m


def carte(g, v, complet=None):
    """Tout ce qu'une carte pose, en empreintes, quelques valeurs lisibles, et ses méthodes sur des cas tirés au hasard."""
    r = {}
    histo = [0] * 11
    for t in g.terrain:
        histo[t] += 1
    routes = [e for e in g.edges if e.get('kind') != 'water']
    r['lisible'] = dict(
        version=g.version, suffixe=g.suffixe, W=g.W, H=g.H, KX=g.KX, lon0=g.lon0, lon1=g.lon1, lat0=g.lat0, lat1=g.lat1,
        hash=g._src_hash(), noeuds=len(g.nodes), aretes=len(g.edges), routes=len(routes),
        royales=sum(1 for e in routes if e['royal']), bacs=sum(1 for e in routes if e['ferry']),
        ponts=sum(1 for e in routes if e['river']), terrains=histo, dept_codes=g.dept_codes,
        playable=sorted(g.playable_codes), premiers_noeuds=g.nodes[:3], derniers_noeuds=g.nodes[-2:],
        premieres_aretes=g.edges[:2], derniere_route=routes[-1], derniere_arete=g.edges[-1],
        voies={k: [len(w['pts']), w['cum'][-1], len(w['ports']), w['tidal_s']] for k, w in g.ways.items()})
    emp = {a: commun.empreinte_ordre(getattr(g, a)) for a in ATTRIBUTS}
    emp['client_payload'] = commun.empreinte_ordre(g.client_payload())
    emp['cell_costs'] = commun.empreinte_ordre(g.cell_costs())
    if '_rivf' in g.__dict__:   # (la grille des rivières à la demi-case : seulement sur une carte générée)
        emp['_rivf'] = commun.empreinte_ordre(g._rivf)
    r['empreintes'] = emp
    if complet:
        os.makedirs(complet, exist_ok=True)
        for a in ATTRIBUTS:
            with open(os.path.join(complet, f'py_{v}_{a}.txt'), 'w', encoding='utf-8') as f:
                f.write(commun.canon_ordre(getattr(g, a)).replace('},{', '},\n{'))

    rng = random.Random(1790 + v)
    W, H, n = g.W, g.H, len(g.nodes)
    P = [(nd['x'], nd['y']) for nd in g.nodes]
    jouables = [nd['id'] for nd in g.nodes if nd['dept'] in g.playable_codes]

    def voisin(a, dmin, dmax):
        """Un lieu à une distance de a prise entre dmin et dmax (None s'il n'y en a pas)."""
        l = [b for b in jouables if b != a and dmin <= ((P[a][0] - P[b][0]) ** 2 + (P[a][1] - P[b][1]) ** 2) ** 0.5 <= dmax]
        return rng.choice(l) if l else None

    # projection, cases, terrain
    pts = [(rng.uniform(-20, W + 20), rng.uniform(-20, H + 20)) for _ in range(50)]
    pts += [(0.0, 0.0), (-0.5, 3.0), (W - 0.01, H - 0.01), (float(W), 5.0), (5.0, float(H)), (12, 7), (-1e-9, 0.2)]
    pts += [(P[a][0] + rng.uniform(-3, 3), P[a][1] + rng.uniform(-3, 3)) for a in rng.sample(range(n), 40)]
    r['points'] = []
    for x, y in pts:
        c = g.cell(x, y)
        r['points'].append([x, y, c, g.terrain_at(x, y), g.playable_at(x, y), g.dept_at(x, y), g.node_of_cell(x, y),
                            g.lat_of(y), g.lon_of(x), list(g.xy(g.lat_of(y), g.lon_of(x))), g.cell_cost(c) if c >= 0 else None])
    r['xy'] = [[la, lo, list(g.xy(la, lo))] for la, lo in [(rng.uniform(41, 51.5), rng.uniform(-5.5, 10)) for _ in range(20)]]

    # tracés élémentaires
    r['raster_line'] = []
    for k in range(12):
        ligne = [(rng.uniform(-5, W + 5), rng.uniform(-5, H + 5))]
        for _ in range(rng.randint(1, 4)):
            ligne.append((ligne[-1][0] + rng.uniform(-9, 9), ligne[-1][1] + rng.uniform(-9, 9)))
        step, f = rng.choice([(0.35, 1), (0.3, 1), (0.175, 2), (0.15, 2)])
        acc = []
        g._raster_line(ligne, acc.append, step, f)
        r['raster_line'].append([ligne, step, f, acc])
    r['raster_ring'] = []
    for k in range(12):
        cx, cy = rng.uniform(0, W), rng.uniform(0, H)
        anneau = [(cx + rng.uniform(-12, 12), cy + rng.uniform(-12, 12)) for _ in range(rng.randint(3, 7))]
        acc = []
        g._raster_ring(anneau, acc.append)
        r['raster_ring'].append([anneau, acc])
    src = [rng.randrange(W * H) for _ in range(30)]
    r['bfs'] = [[src, 6, commun.empreinte_ordre(g._bfs(src, 6))],
                [src, 9, commun.empreinte_ordre(g._bfs(src, 9, lambda c: g.terrain[c] > G.T_EAU))],
                [src[:5], 4, commun.empreinte_ordre(g._bfs([c * 2 for c in src[:5]], 4, None, 2))]]

    # l'eau entre deux lieux, le plus court chemin du réseau
    r['water'] = []
    for _ in range(40):
        a = rng.randrange(n)
        b = voisin(a, 1, 60) or rng.randrange(n)
        marge = rng.choice([0.0, 2.5])
        r['water'].append([a, b, marge, g._water_on_segment(P[a], P[b]), g._water_on_segment(P[a], P[b], marge)])
    pairs = {(e['a'], e['b']): 1 for e in routes}
    r['chemin'] = []
    for _ in range(12):
        a = rng.choice(jouables)
        b = voisin(a, 30, 250) or rng.choice(jouables)
        r['chemin'].append([a, b, [list(k) for k in G.GeoMap._chemin(pairs, P, a, b)]])

    # A* hors route
    marques = [[nid, rng.randint(1, 3)] for nid in jouables if rng.random() < 0.3]
    r['marques'] = marques
    m = masque(marques)
    libres = [a for a in jouables if not m[a]]
    fermes = [a for a in jouables if m[a]]
    r['astar'] = []

    def astar(a, b, bloc, max_nodes=120000):
        sx, sy = P[a][0] + rng.uniform(-0.4, 0.4), P[a][1] + rng.uniform(-0.4, 0.4)
        gx, gy = P[b][0] + rng.uniform(-0.4, 0.4), P[b][1] + rng.uniform(-0.4, 0.4)
        res = g.astar(sx, sy, gx, gy, max_nodes, m if bloc else None)
        r['astar'].append([sx, sy, gx, gy, max_nodes, bloc, res])
    for k in range(24):
        a = rng.choice(jouables)
        astar(a, voisin(a, 5, 45) or a, False)
    for k in range(4):
        a = rng.choice(jouables)
        astar(a, voisin(a, 20, 60) or a, False, rng.choice([30, 400]))
    for k in range(10):
        a = rng.choice(libres)
        astar(a, voisin(a, 5, 45) or a, True)
    for k in range(8):
        a = rng.choice(fermes)
        astar(a, voisin(a, 5, 30) or a, True)
    for k in range(6):   # (des points quelconques : dans l'eau, hors du jeu, hors de la carte)
        sx, sy, gx, gy = rng.uniform(-5, W + 5), rng.uniform(-5, H + 5), rng.uniform(0, W), rng.uniform(0, H)
        r['astar'].append([sx, sy, gx, gy, 5000, False, g.astar(sx, sy, gx, gy, 5000)])
    r['nearest_open'] = []
    for k in range(14):
        a = rng.choice(fermes)
        x, y = P[a][0] + rng.uniform(-0.4, 0.4), P[a][1] + rng.uniform(-0.4, 0.4)
        strict, mn = rng.random() < 0.6, rng.choice([40000, 40000, 60])
        r['nearest_open'].append([x, y, strict, mn, g.nearest_open(x, y, m, strict, mn)])
    r['line_ok'] = []
    for k in range(40):
        a = rng.choice(jouables)
        p = (P[a][0] + rng.uniform(-2, 2), P[a][1] + rng.uniform(-2, 2))
        q = (p[0] + rng.uniform(-8, 8), p[1] + rng.uniform(-8, 8))
        mc, bloc = rng.choice([1.5, 2.0, 2.5, 4.0, 9.0]), rng.random() < 0.5
        r['line_ok'].append([list(p), list(q), mc, bloc, g._line_ok(p, q, mc, m if bloc else None)])
    r['smooth'] = []
    for k in range(10):
        a = rng.choice(jouables)
        l = [(P[a][0] + rng.uniform(-1, 1), P[a][1] + rng.uniform(-1, 1))]
        for _ in range(rng.randint(0, 9)):
            l.append((l[-1][0] + rng.uniform(-1.5, 1.5), l[-1][1] + rng.uniform(-1.5, 1.5)))
        bloc = rng.random() < 0.5
        r['smooth'].append([l, bloc, g._smooth(list(l), m if bloc else None)])
    return r


def fonctions():
    """Les fonctions et les constantes des trois modules, hors de toute carte."""
    rng = random.Random(17900714)
    r = {}
    U = rng.uniform
    r['constantes'] = dict(
        CACHE_VERSION=G.CACHE_VERSION, VERSION=G.VERSION, LAT_REF=G.LAT_REF, KX=G.KX, KY=G.KY, NONE=G.NONE,
        TERRAIN=G.TERRAIN, PLAYABLE=G.PLAYABLE, LANDES_POLY=G.LANDES_POLY, FORESTS=G.FORESTS, VINEYARDS=G.VINEYARDS,
        CRETES=G.CRETES, MASSIFS=G.MASSIFS, FORETS_3=G.FORETS_3, VIGNES_3=G.VIGNES_3, ROUTES_ROYALES_3=G.ROUTES_ROYALES_3,
        MARAIS_3=G.MARAIS_3, T=[G.T_OCEAN, G.T_EAU, G.T_PLAINE, G.T_FORET, G.T_LANDE, G.T_MARAIS, G.T_COLLINES, G.T_MONTAGNE,
                                G.T_HAUTE, G.T_DUNES, G.T_VIGNE],
        ESTUARY=WW.ESTUARY, COAST=WW.COAST, LABEL=WW.LABEL, SEA_PORTS=WW.SEA_PORTS, RIVER_PORT_KM=WW.RIVER_PORT_KM,
        EXCLUDE=WW.EXCLUDE,
        WAYS=[[w['name'], w['river'], w['into'], w.get('tidal_lat'), bool(w.get('low_water')), bool(w.get('sea'))] for w in WW.WAYS])
    r['places'] = {k: commun.empreinte_ordre(getattr(PL, k)) for k in
                   ('PLACES', 'ROYAL_ROUTES', 'EXTRA_ROADS', 'EXTRA_ROADS_2', 'NO_ROADS_2', 'CITY_SPECIALTIES', 'CITY_POP')}
    r['places']['FERRIES'] = commun.empreinte_ordre(sorted(PL.FERRIES))
    r['places']['repr'] = {k: hashlib.sha256(repr(getattr(PL, k)).encode()).hexdigest() for k in
                           ('PLACES', 'ROYAL_ROUTES', 'EXTRA_ROADS')}
    r['places']['lisible'] = [PL.PLACES[0], PL.PLACES[-1], len(PL.PLACES), PL.ROYAL_ROUTES[0], PL.CITY_POP['Bordeaux'],
                              PL.CITY_SPECIALTIES['Pau']]
    pts_clip = [(U(-2, 2), U(43, 46)) for _ in range(30)]
    r['clip'] = [[lon, lat, [bool(w['clip'](lon, lat)) if w['clip'] else None for w in WW.WAYS]] for lon, lat in pts_clip]

    ent = [(rng.randint(-300, 2500), rng.randint(-300, 2500), rng.choice([3, 5, 7, 9, 11, 13, 23, 91, 28, 62])) for _ in range(80)]
    r['_h'] = [[a, b, s, G._h(a, b, s)] for a, b, s in ent]
    fl = [(U(-40, 400), U(-40, 400), rng.choice([3, 5, 7, 9, 11, 13, 23, 91])) for _ in range(120)] + [(3.0, 7.0, 11), (0.0, 0.0, 3)]
    r['vnoise'] = [[x, y, s, G.vnoise(x, y, s)] for x, y, s in fl]
    r['fbm'] = [[x, y, s, o, G.fbm(x, y, s, o)] for (x, y, s), o in zip(fl, [rng.choice([1, 3, 3, 4]) for _ in fl])]
    r['_dseg'] = []
    for _ in range(60):
        a = [U(-5, 5) for _ in range(6)]
        if rng.random() < 0.1:
            a[4], a[5] = a[2], a[3]   # (segment réduit à un point)
        r['_dseg'].append(a + [G._dseg(*a)])
    noms = ['Saint-Jean-d\'Illac', 'Échourgnac', 'L\'Haÿ-les-Roses', 'Œuilly', 'Sainte-Foy-la-Grande', 'Bœuf 12 Été', 'ÀÂÎÔÛÇ çœù',
            'Forge d\'Ans', 'Aÿ', 'Saint-Étienne-de-Baïgorry', '', 'a_b-c d', 'Mâcon ! (Saône)', 'Fère-en-Tardenois', 'Ébreuil ÉÈÊ']
    r['slugify'] = [[s, G.slugify(s)] for s in noms + [p[0] for p in rng.sample(PL.PLACES, 25)]]
    r['_seg_inter'] = []
    for _ in range(80):
        p = [(U(-3, 3), U(-3, 3)) for _ in range(4)]
        if rng.random() < 0.1:
            p[3] = (p[2][0] + p[1][0] - p[0][0], p[2][1] + p[1][1] - p[0][1])   # (parallèles)
        it = G._seg_inter(*p)
        r['_seg_inter'].append([p, None if it is None else [it[0], list(it[1])]])
    r['_proj'], r['_jusqua'], r['ww'] = [], [], []
    for _ in range(40):
        ligne = [(U(-5, 5), U(-5, 5))]
        for _ in range(rng.randint(1, 6)):
            ligne.append((ligne[-1][0] + U(-3, 3), ligne[-1][1] + U(-3, 3)))
        if rng.random() < 0.15:
            ligne.insert(1, ligne[0])   # (un segment nul)
        p = (U(-6, 6), U(-6, 6))
        r['_proj'].append([list(p), ligne, list(G._proj(p, ligne))])
        s = U(0, 14)
        r['_jusqua'].append([ligne, s, G._jusqua(ligne, s)])
        cum = [0.0]
        for a, b in zip(ligne, ligne[1:]):
            cum.append(cum[-1] + ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5)
        s0 = U(0, cum[-1])
        s1 = U(s0, cum[-1])
        pr = WW._project(ligne, cum, p)
        r['ww'].append([ligne, cum, list(p), s0, s1, WW._seglen(ligne), [pr[0], pr[1], list(pr[2])], WW._cut(ligne, cum, s0, s1)])
    geo = [(U(42.3, 51.2), U(-5.0, 9.5)) for _ in range(150)] + [(43.3, -1.2), (43.0, -0.5), (44.9, 0.9), (45.83, 6.86)]
    r['_elev'] = [[la, lo, G.GeoMap._elev(la, lo), G.GeoMap._elev3(la, lo)] for la, lo in geo]
    l16 = [rng.randrange(65536) for _ in range(40)] + [0, 65535, 258]
    r['_b16'] = [l16, list(G._b16(l16)), list(G._h16(G._b16(l16)))]
    # les troncs communs : des routes qui partent côte à côte d'un même lieu
    r['_troncs'] = []
    for _ in range(12):
        paires, paths = [], []
        for k in range(rng.randint(2, 5)):
            a, b = (0, k + 1) if rng.random() < 0.8 else (k + 1, 9)
            l = [(0.0, 0.0)] if a == 0 else [(U(3, 6), U(-3, 3))]
            for i in range(rng.randint(2, 8)):
                l.append((l[-1][0] + U(0.3, 1.5), l[-1][1] + U(-0.15, 0.15) * (1 + i * rng.choice([0, 1, 3]))))
            paires.append([[a, b], dict(royal=rng.random() < 0.3, ferry=rng.random() < 0.1)])
            paths.append(l)
        avant = [list(p) for p in paths]
        G._troncs([(tuple(k), i) for k, i in paires], paths)
        r['_troncs'].append([paires, avant, paths])
    return r


def cartes(dossier, generee, complet=None):
    """Les trois cartes, construites sur le dossier de données `dossier` : générées, ou relues de ses caches."""
    G.DATA_DIR = dossier
    faites = []
    d_origine = G.GeoMap._generate

    def espion(self):
        faites.append(self.version)
        return d_origine(self)
    G.GeoMap._generate = espion
    out = {}
    for v in (1, 2, 3):
        t = time.time()
        g = G.GeoMap(v)
        dt = time.time() - t
        if generee and v not in faites:
            sys.exit(f'géographie {v} : la carte a été relue d\'un cache, la référence doit venir d\'une carte générée')
        if not generee and v in faites:
            sys.exit(f'géographie {v} : le cache de {dossier} n\'a pas été relu (empreinte des sources différente ?)')
        print(f'géographie {v} : {"générée" if generee else "relue du cache"} en {dt:.1f} s ({g.W} x {g.H}, {len(g.nodes)} lieux, {len(g.edges)} arêtes)')
        out[str(v)] = carte(g, v, complet)
    G.GeoMap._generate = d_origine
    return out


def sources(dossier):
    os.makedirs(dossier, exist_ok=True)
    for f in SOURCES:
        shutil.copy(os.path.join(commun.RACINE, 'game', 'data', f), os.path.join(dossier, f))


if __name__ == '__main__':
    relire, caches, complet = option('--relire'), option('--caches'), option('--complet')
    if relire:
        sources(relire)
        vu = json.loads(json.dumps(cartes(relire, False, complet)))
        with open(os.path.join(commun.REFS, 'geo.json'), encoding='utf-8') as f:
            ref = json.load(f)['cartes']
        ok = True
        for v in vu:
            ref[v]['empreintes'].pop('_rivf', None)
            for k in vu[v]:
                if commun.canon(vu[v][k]) != commun.canon(ref[v][k]):
                    ok = False
                    print(f'géographie {v} : « {k} » diffère de la référence')
        print('cartes relues du cache : identiques à la référence' if ok else 'ÉCART')
        sys.exit(0 if ok else 1)
    with tempfile.TemporaryDirectory() as tmp:
        dossier = caches or tmp
        sources(dossier)
        for v in ('', '_v1', '_v2'):   # (jamais de cache : la référence vient d'une carte générée)
            if os.path.exists(os.path.join(dossier, f'map_cache{v}.json')):
                os.remove(os.path.join(dossier, f'map_cache{v}.json'))
        ref = dict(fonctions=fonctions(), cartes=cartes(dossier, True, complet))
    commun.ecrire('geo', ref)
