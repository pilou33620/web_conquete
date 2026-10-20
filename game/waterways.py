"""Voies navigables : gabares sur la Garonne, la Dordogne, l'Isle, le Lot, la Baïse, la Midouze et l'Adour,
cabotage le long de la côte atlantique.

Les voies d'eau deviennent des arêtes du graphe (kind='water') entre les ports et quais riverains ;
elles sont construites à chaque démarrage (rapide) et ne touchent pas au cache de la carte."""
import math

# Gironde : axe de l'estuaire, du bec d'Ambès à la pointe de Grave (lat, lon)
ESTUARY = [(45.05, -0.62), (45.09, -0.675), (45.13, -0.70), (45.19, -0.715), (45.27, -0.745), (45.35, -0.784),
           (45.43, -0.85), (45.51, -0.945), (45.59, -1.02), (45.615, -1.06)]
# route côtière, de l'embouchure de la Gironde à la Bidassoa
COAST = [(45.615, -1.06), (45.62, -1.20), (45.40, -1.27), (45.10, -1.30), (44.80, -1.32), (44.60, -1.30), (44.40, -1.33),
         (44.10, -1.38), (43.80, -1.45), (43.66, -1.47), (43.53, -1.55), (43.47, -1.59), (43.40, -1.70), (43.38, -1.80)]

WAYS = [
    # nom, rivière de geo.json, découpe (lon, lat) -> navigable ?, se jette dans
    dict(name='Garonne', river='Garonne', clip=lambda lon, lat: lat >= 44.08, into='Côte', tidal_lat=44.55),
    dict(name='Dordogne', river='Dordogne', clip=lambda lon, lat: lon <= 1.42, into='Garonne', low_water=True),
    dict(name='Isle', river='Isle', clip=lambda lon, lat: lon <= 0.37, into='Dordogne', low_water=True),
    dict(name='Lot', river='Lot', clip=lambda lon, lat: lon <= 1.08, into='Garonne', low_water=True),
    dict(name='Baïse', river='Baïse', clip=lambda lon, lat: lat >= 44.10, into='Garonne', low_water=True),
    dict(name='Midouze', river='Midouze', clip=lambda lon, lat: True, into='Adour', low_water=True),
    dict(name='Adour', river='Adour', clip=lambda lon, lat: lon <= -0.55, into='Côte'),
    dict(name='Côte', river=None, clip=None, into=None, sea=True),
]
LABEL = {'Garonne': 'Garonne et Gironde', 'Côte': 'Côte atlantique'}
SEA_PORTS = {  # port : détour par la passe (lat, lon) depuis la route du large
    'La Teste-de-Buch': [(44.61, -1.24), (44.635, -1.19)],
    'Capbreton': [], 'Biarritz': [], 'Saint-Jean-de-Luz': [], 'Hendaye': [],
}
RIVER_PORT_KM = 3.0
EXCLUDE = {'Fort Médoc': 'Garonne'}  # le fort reste sur sa rive (bac de Blaye)


def _seglen(pts):
    return sum(math.dist(p, q) for p, q in zip(pts, pts[1:]))


def _project(pts, cum, p):
    """Projection d'un point sur une polyligne : (distance, abscisse curviligne, point projeté)."""
    best = (1e18, 0.0, pts[0])
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
        q = (a[0] + t * dx, a[1] + t * dy)
        d = math.dist(p, q)
        if d < best[0]:
            best = (d, cum[i] + t * math.sqrt(L2), q)
    return best


def _cut(pts, cum, s0, s1):
    """Morceau de polyligne entre deux abscisses (s0 < s1)."""
    out = []
    for i in range(len(pts) - 1):
        a, b = cum[i], cum[i + 1]
        if b < s0 or a > s1:
            continue
        L = b - a or 1e-9
        p0 = max(s0, a)
        p1 = min(s1, b)
        P = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * (p0 - a) / L, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (p0 - a) / L)
        Q = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * (p1 - a) / L, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (p1 - a) / L)
        if not out or math.dist(out[-1], P) > 1e-6:
            out.append(P)
        out.append(Q)
    return out


def build(geo):
    """Ajoute les arêtes fluviales et maritimes à geo.edges ; renseigne geo.ways, geo.ports, geo.down_nodes."""
    rivers = {}
    for r in geo.src['rivers']:
        rivers.setdefault(r['name'], []).append(r)
    ways = {}
    for w in WAYS:
        if w.get('sea'):
            ll = COAST
        else:
            segs = []
            for r in rivers.get(w['river'], []):
                ll = [(lat, lon) for lon, lat in r['pts'] if w['clip'](lon, lat)]
                segs.append(ll)
            ll = max(segs, key=len)
            if w['name'] == 'Garonne':
                ll = ll + ESTUARY
        pts = [geo.xy(lat, lon) for lat, lon in ll]
        cum = [0.0]
        for p, q in zip(pts, pts[1:]):
            cum.append(cum[-1] + math.dist(p, q))
        ways[w['name']] = dict(name=w['name'], label=LABEL.get(w['name'], w['name']), pts=pts, cum=cum, into=w['into'],
                               sea=bool(w.get('sea')), low_water=bool(w.get('low_water')),
                               tidal_s=None, ports=[])
        if w.get('tidal_lat'):
            ty = geo.xy(w['tidal_lat'], 0)[1]
            ways[w['name']]['tidal_s'] = next((cum[i] for i, p in enumerate(pts) if p[1] <= ty), None)
    # ports et quais
    taken = set()
    for name in ('Garonne', 'Dordogne', 'Isle', 'Lot', 'Baïse', 'Midouze', 'Adour'):
        w = ways[name]
        for n in geo.nodes:
            if EXCLUDE.get(n['name']) == name or (n['id'], name) in taken:
                continue
            d, s, q = _project(w['pts'], w['cum'], (n['x'], n['y']))
            if d <= RIVER_PORT_KM:
                w['ports'].append(dict(node=n['id'], s=s, q=q, spur=[]))
                taken.add((n['id'], name))
    sea = ways['Côte']
    for nm, spur in SEA_PORTS.items():
        nid = geo.by_name.get(nm)
        if nid is None:
            continue
        n = geo.nodes[nid]
        sp = [geo.xy(lat, lon) for lat, lon in spur]
        anchor = sp[0] if sp else (n['x'], n['y'])
        d, s, q = _project(sea['pts'], sea['cum'], anchor)
        sea['ports'].append(dict(node=nid, s=s, q=q, spur=sp))
    for w in ways.values():
        w['ports'].sort(key=lambda p: p['s'])
        # deux lieux au même endroit de la rive : on garde l'ordre, rien à faire
    # arêtes
    edges = geo.edges
    eid = len(edges)
    new = []

    def piece(port_a, port_b, way):
        a_xy = (geo.nodes[port_a['node']]['x'], geo.nodes[port_a['node']]['y'])
        b_xy = (geo.nodes[port_b['node']]['x'], geo.nodes[port_b['node']]['y'])
        mid = _cut(way['pts'], way['cum'], port_a['s'], port_b['s']) if port_a['s'] < port_b['s'] else \
            list(reversed(_cut(way['pts'], way['cum'], port_b['s'], port_a['s'])))
        return [a_xy] + list(reversed(port_a['spur'])) + mid + port_b['spur'] + [b_xy]

    def add(a, b, pts, way, down):
        nonlocal eid
        clean = [pts[0]]
        for p in pts[1:]:
            if math.dist(p, clean[-1]) > 0.05:
                clean.append(p)
        if len(clean) < 2:
            clean.append(pts[-1])
        e = dict(id=eid, a=a, b=b, len=round(max(0.5, _seglen(clean)), 2), kind='water', way=way['name'],
                 sea=way['sea'], down=down, royal=False, ferry=False, river=None, rrank=0, cx=None, cy=None,
                 pts=[[round(x, 2), round(y, 2)] for x, y in clean])
        new.append(e)
        eid += 1
        return e

    for w in ways.values():
        P = w['ports']
        for pa, pb in zip(P, P[1:]):
            if pa['node'] == pb['node']:
                continue
            tidal = w['sea'] or (w['tidal_s'] is not None and pa['s'] >= w['tidal_s'])
            add(pa['node'], pb['node'], piece(pa, pb, w), w, None if tidal else pb['node'])
    # confluences
    for w in ways.values():
        if not w['into'] or not w['ports']:
            continue
        parent = ways[w['into']]
        last = w['ports'][-1]
        jx, jy = w['pts'][-1]
        d, sj, q = _project(parent['pts'], parent['cum'], (jx, jy))
        up = [p for p in parent['ports'] if p['s'] < sj]
        dn = [p for p in parent['ports'] if p['s'] >= sj]
        tail = _cut(w['pts'], w['cum'], last['s'], w['cum'][-1])
        lx, ly = geo.nodes[last['node']]['x'], geo.nodes[last['node']]['y']
        for other, is_down in ((up[-1] if up else None, False), (dn[0] if dn else None, True)):
            if not other or other['node'] == last['node']:
                continue
            if is_down:
                mid = _cut(parent['pts'], parent['cum'], sj, other['s'])
            else:
                mid = list(reversed(_cut(parent['pts'], parent['cum'], other['s'], sj)))
            pts = [(lx, ly)] + tail + mid + other['spur'] + [(geo.nodes[other['node']]['x'], geo.nodes[other['node']]['y'])]
            add(last['node'], other['node'], pts, w, other['node'] if (is_down and not parent['sea']) else None)
    # pas de doublon (deux voies reliant les mêmes lieux) : on garde la plus courte
    best = {}
    for e in new:
        k = (min(e['a'], e['b']), max(e['a'], e['b']))
        if k not in best or e['len'] < best[k]['len']:
            best[k] = e
    keep = sorted(best.values(), key=lambda e: e['id'])
    base = len(edges)
    for i, e in enumerate(keep):
        e['id'] = base + i
        edges.append(e)
    geo.ways = ways
    # cumul des longueurs pour placer gabares et armées le long des arêtes (voies d'eau et tracés des routes)
    geo.edge_cum = {}
    for e in edges:
        cum = [0.0]
        for p, q in zip(e['pts'], e['pts'][1:]):
            cum.append(cum[-1] + math.dist(p, q))
        k = e['len'] / cum[-1] if cum[-1] > 0 else 1.0
        geo.edge_cum[e['id']] = [c * k for c in cum]
    # quais : lieux desservis par une voie d'eau ; et, pour le blocus, les lieux à franchir pour gagner la mer
    geo.ports = {}
    for w in ways.values():
        for p in w['ports']:
            geo.ports.setdefault(p['node'], []).append(w['name'])
    for nid, lst in geo.ports.items():
        geo.nodes[nid]['quai'] = [ways[x]['label'] for x in lst]
    down = {}

    def downstream(wname, s):
        w = ways[wname]
        out = [p['node'] for p in w['ports'] if p['s'] > s + 0.01]
        if w['into'] and not ways[w['into']]['sea']:
            parent = ways[w['into']]
            _, sj, _ = _project(parent['pts'], parent['cum'], w['pts'][-1])
            out += downstream(w['into'], sj)
        return out
    for w in ways.values():
        if w['sea']:
            continue
        for p in w['ports']:
            down.setdefault(p['node'], [])
            for x in downstream(w['name'], p['s']):
                if x != p['node'] and x not in down[p['node']]:
                    down[p['node']].append(x)
    geo.down_nodes = down
    return keep
