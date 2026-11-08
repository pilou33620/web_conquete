"""Voies navigables : gabares sur la Garonne, la Dordogne, l'Isle, le Lot, la Baïse, la Midouze et l'Adour,
cabotage le long de la côte atlantique.

Géographie 3 (toute la France) : en plus, les fleuves et rivières navigables d'époque, les canaux (datés : on ne s'y
engage qu'après leur ouverture), le cabotage du Ponant (de la Flandre à la Gironde), du Levant (du Roussillon à Nice)
et autour de la Corse. Les tracés des côtes et des embouchures sont calculés une fois, en mer, sur la grille de la carte
(outils/voies_eau.py, écrit data/voies_france.json).

Les voies d'eau deviennent des arêtes du graphe (kind='water') entre les ports et quais riverains ;
elles sont construites à chaque démarrage (rapide) et ne touchent pas au cache de la carte."""
import json
import math
import os

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

# ------------------------------------------------------------ géographie 3 : toute la France
# rivières navigables : start, le point (lat, lon) d'où la rivière porte bateau, vers l'aval (la tête de navigation
# des XVIIIe et XIXe siècles, à peu près : Saint-Rambert pour la Loire, Nogent pour la Seine, Gray pour la Saône…)
FR_GARONNE = dict(start=(43.60, 1.44))   # (la Garonne porte bateau dès Toulouse, où commence le canal du Midi)
FR_WAYS = [
    dict(name='Tarn', river='Tarn', start=(43.90, 1.90), into='Garonne', low_water=True),
    dict(name='Seine', river='Seine', start=(48.49, 3.50), into='Ponant'),
    dict(name='Yonne', river='Yonne', start=(47.80, 3.57), into='Seine', low_water=True),
    dict(name='Marne', river='Marne', start=(48.64, 4.95), into='Seine'),
    dict(name='Oise', river='Oise', start=(49.66, 3.36), into='Seine'),
    dict(name='Aisne', river='Aisne', start=(49.38, 3.32), into='Oise'),
    dict(name='Loire', river='Loire', start=(45.50, 4.24), into='Ponant', low_water=True),
    dict(name='Allier', river='Allier', start=(45.41, 3.32), into='Loire', low_water=True),
    dict(name='Cher', river='Cher', start=(47.22, 2.07), into='Loire', low_water=True),
    dict(name='Vienne', river='Vienne', start=(46.82, 0.55), into='Loire', low_water=True),
    dict(name='Mayenne', river='Mayenne', start=(48.07, -0.77), into='Loire'),
    dict(name='Sarthe', river='Sarthe', start=(48.00, 0.20), into='Loire'),
    dict(name='Vilaine', river='Vilaine', start=(48.11, -1.68), into='Ponant'),
    dict(name='Orne', river='Orne', start=(49.19, -0.36), into='Ponant'),
    dict(name='Somme', river='Somme', start=(49.90, 2.30), into='Ponant'),
    dict(name='Charente', river='Charente', start=(45.65, 0.15), into='Ponant', low_water=True),
    dict(name='Sèvre niortaise', river='Sèvre niortaise', start=(46.32, -0.46), into='Ponant'),
    dict(name='Rhône', river='Rhône', start=(45.96, 5.83), into='Levant'),
    dict(name='Saône', river='Saône', start=(47.45, 5.59), into='Rhône'),
    dict(name='Isère', river='Isère', start=(45.19, 5.72), into='Rhône'),
    dict(name='Aude', river='Aude', start=(43.27, 2.95), into='Levant', low_water=True),
    # (le Rhin, la Moselle, la Meuse et l'Escaut sortent de la carte : leur aval est hors du jeu)
    dict(name='Rhin', river='Rhin', start=(47.59, 7.58), into=None),
    dict(name='Ill', river='Ill', start=(48.08, 7.36), into='Rhin'),
    dict(name='Moselle', river='Moselle', start=(48.68, 5.89), into=None),
    dict(name='Meurthe', river='Meurthe', start=(48.69, 6.19), into='Moselle'),
    dict(name='Meuse', river='Meuse', start=(49.16, 5.38), into=None),
    dict(name='Escaut', river='Escaut', start=(50.18, 3.24), into=None),
]
# cabotage : les ports dans l'ordre de la route, de son début à sa fin (into : la route où elle aboutit) ; le tracé, en
# mer, et le chenal de chaque port sont dans data/voies_france.json. (Dunkerque, Cherbourg et Saint-Tropez manquent aux
# places générées : Coudekerque-Branche, Fermanville et Sainte-Maxime en tiennent lieu.)
FR_SEAS = [
    dict(name='Ponant', label='Côtes du Ponant', into='Côte', start=(51.12, 2.56), end=COAST[0], ports=[
        'Coudekerque-Branche', 'Grand-Fort-Philippe', 'Calais', 'Boulogne-sur-Mer', 'Étaples', 'Le Crotoy',
        'Mers-les-Bains', 'Dieppe', 'Saint-Valery-en-Caux', 'Fécamp', 'Le Havre', 'Honfleur', 'Ouistreham',
        'Port-en-Bessin-Huppain', 'Grandcamp-Maisy', 'Réville', 'Fermanville', 'Granville', 'Cancale', 'Saint-Malo',
        'Saint-Brieuc', 'Paimpol', 'Morlaix', 'Santec', 'Landéda', 'Brest', 'Camaret-sur-Mer', 'Douarnenez', 'Plogoff',
        'Concarneau', 'Lorient', 'Le Palais', 'Saint-Pierre-Quiberon', 'Vannes', 'Piriac-sur-Mer', 'Saint-Nazaire',
        'Pornic', "Noirmoutier-en-l'Île", "L'Île-d'Yeu", 'Saint-Hilaire-de-Riez', "Les Sables-d'Olonne", 'La Flotte',
        'La Rochelle', 'Fouras', "Saint-Pierre-d'Oléron", 'Royan']),
    dict(name='Levant', label='Côtes du Levant', into=None, start=(42.42, 3.30), end=(43.74, 7.56), ports=[
        'Collioure', 'Leucate', 'Port-La Nouvelle', 'Agde', 'Sète', 'Aigues-Mortes', 'Saintes-Maries-de-la-Mer',
        'Martigues', 'Marseille', 'La Ciotat', 'Toulon', 'Hyères', 'Sainte-Maxime', 'Fréjus', 'Antibes', 'Nice',
        'Menton']),
    dict(name='Corse', label='Côtes de Corse', into=None, ports=[
        'Bastia', 'Saint-Florent', "L'Île-Rousse", 'Calvi', 'Cargèse', 'Ajaccio', 'Propriano', 'Bonifacio',
        'Porto-Vecchio', 'Aléria']),
    dict(name='Traversée', label='Traversée de Corse', into='Levant', end=(43.50, 7.18), ports=['Calvi'], large=True),
]
# canaux : année d'ouverture, quais (dans l'ordre ; le premier et le dernier sont des quais des rivières qu'il relie),
# tracé (lat, lon) passant par les quais. Avant son ouverture, un canal est dessiné nulle part et ne porte personne ;
# ses quais du milieu ne comptent comme quais (commerce par eau) que s'il est ouvert dès 1700.
CANALS = [
    dict(name='Canal du Midi', year=1681, quais=['Toulouse', 'Castelnaudary', 'Carcassonne', 'Béziers', 'Agde', 'Sète'],
         pts=[(43.604, 1.444), (43.46, 1.58), (43.40, 1.72), (43.37, 1.82), (43.318, 1.953), (43.24, 2.11),
              (43.216, 2.349), (43.21, 2.44), (43.27, 2.72), (43.33, 3.04), (43.341, 3.214), (43.311, 3.476),
              (43.35, 3.53), (43.38, 3.62), (43.403, 3.693)]),
    dict(name='Canal de Briare et du Loing', year=1642, quais=['Gien', 'Montargis', 'Nemours', 'Montereau-Fault-Yonne'],
         pts=[(47.693, 2.631), (47.64, 2.74), (47.75, 2.89), (47.82, 2.84), (47.997, 2.733), (48.12, 2.73),
              (48.275, 2.691), (48.37, 2.81), (48.385, 2.95)]),
    dict(name="Canal d'Orléans", year=1692, quais=['Orléans', 'Montargis'],
         pts=[(47.902, 1.904), (47.90, 1.99), (47.93, 2.14), (47.94, 2.27), (47.92, 2.45), (47.96, 2.60),
              (47.997, 2.733)]),
    dict(name='Canal Crozat', year=1738, quais=['Saint-Quentin', 'Tergnier'],
         pts=[(49.849, 3.288), (49.76, 3.31), (49.66, 3.30)]),
    dict(name='Canal du Centre', year=1793, quais=['La Motte-Saint-Jean', 'Paray-le-Monial', 'Chalon-sur-Saône'],
         pts=[(46.50, 3.96), (46.45, 4.12), (46.67, 4.36), (46.75, 4.47), (46.91, 4.75), (46.781, 4.854)]),
    dict(name='Canal de Saint-Quentin', year=1810, quais=['Saint-Quentin', 'Cambrai'],
         pts=[(49.849, 3.288), (49.95, 3.25), (50.06, 3.24), (50.176, 3.235)]),
    dict(name='Canal de Bourgogne', year=1832, quais=['Joigny', 'Dijon', 'Losne'],
         pts=[(47.983, 3.401), (47.97, 3.51), (47.99, 3.73), (47.86, 3.97), (47.62, 4.34), (47.26, 4.55),
              (47.313, 5.014), (47.20, 5.15), (47.10, 5.26)]),
    dict(name='Canal du Rhône au Rhin', year=1833, quais=['Losne', 'Dole', 'Besançon', 'Montbéliard', 'Mulhouse', 'Strasbourg'],
         pts=[(47.10, 5.26), (47.12, 5.29), (47.09, 5.49), (47.16, 5.80), (47.249, 6.018), (47.35, 6.36),
              (47.45, 6.58), (47.51, 6.80), (47.63, 7.13), (47.752, 7.329), (48.02, 7.53), (48.30, 7.65),
              (48.584, 7.746)]),
    dict(name='Canal des Ardennes', year=1833, quais=['Sedan', 'Rethel', 'Soissons'],   # (et latéral à l'Aisne)
         pts=[(49.702, 4.94), (49.70, 4.87), (49.52, 4.76), (49.51, 4.37), (49.43, 4.03), (49.40, 3.90),
              (49.41, 3.52), (49.382, 3.324)]),
    dict(name='Canal de Nantes à Brest', year=1842, quais=['Nantes', 'Redon', 'Josselin', 'Pontivy', 'Brest'],
         pts=[(47.217, -1.553), (47.44, -1.50), (47.48, -1.76), (47.652, -2.084), (47.81, -2.38), (47.95, -2.55),
              (48.07, -2.75), (48.068, -2.967), (48.23, -3.18), (48.28, -3.57), (48.19, -3.82), (48.20, -4.09),
              (48.29, -4.27), (48.33, -4.42), (48.39, -4.49)]),
    dict(name='Canal de la Marne au Rhin', year=1853,
         quais=['Vitry-le-François', 'Bar-le-Duc', 'Toul', 'Nancy', 'Sarrebourg', 'Saverne', 'Strasbourg'],
         pts=[(48.725, 4.584), (48.79, 4.91), (48.773, 5.161), (48.69, 5.33), (48.69, 5.62), (48.681, 5.891),
              (48.76, 6.13), (48.684, 6.185), (48.62, 6.35), (48.73, 7.05), (48.742, 7.362), (48.73, 7.71),
              (48.584, 7.746)]),
    dict(name='Canal latéral à la Garonne', year=1856,
         quais=['Toulouse', 'Montech', 'Agen', 'Buzet', 'Meilhan-sur-Garonne'],
         pts=[(43.604, 1.444), (43.83, 1.30), (43.96, 1.23), (44.10, 1.08), (44.11, 0.89), (44.201, 0.615),
              (44.26, 0.30), (44.29, 0.27), (44.50, 0.04)]),
]
OPEN_YEAR = 1700   # (le début des parties : un canal plus jeune ne fait pas de ses places des quais de commerce)
FR_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'voies_france.json')


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


def _defs(geo):
    """Les voies de cette carte et, en géographie 3, les tracés calculés en mer (data/voies_france.json)."""
    if geo.version < 3:
        return WAYS, {}
    with open(FR_DATA, encoding='utf-8') as f:
        fr = json.load(f)
    defs = [dict(w, **FR_GARONNE) if w['name'] == 'Garonne' else w for w in WAYS]
    return defs + FR_WAYS + [dict(w, sea=True) for w in FR_SEAS] + [dict(w, canal=True, into=None) for w in CANALS], fr


def _near_cells(pts, k=4.0):
    """Cases de k km que la polyligne traverse, et leurs voisines : tout point à moins de k - 0,5 km y tombe."""
    out = set()
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.dist(a, b)))
        for i in range(n + 1):
            x, y = a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n
            ci, cj = int(x // k), int(y // k)
            out.update((ci + di, cj + dj) for di in (-1, 0, 1) for dj in (-1, 0, 1))
    return out


def build(geo):
    """Ajoute les arêtes fluviales et maritimes à geo.edges ; renseigne geo.ways, geo.ports, geo.down_nodes."""
    defs, fr = _defs(geo)
    rivers = {}
    for r in geo.src['rivers']:
        rivers.setdefault(r['name'], []).append(r)
    ways = {}
    for w in defs:
        if w.get('sea'):
            ll = COAST if w['name'] == 'Côte' else [tuple(p) for p in fr['mers'][w['name']]]
        elif w.get('canal'):
            ll = w['pts']
        else:
            segs = []
            for r in rivers.get(w['river'], []):
                if 'start' in w:   # (navigable de ce point jusqu'à l'embouchure : les rivières vont de la source à la mer)
                    i0 = min(range(len(r['pts'])), key=lambda i: math.dist(r['pts'][i], w['start'][::-1]))
                    ll = [(lat, lon) for lon, lat in r['pts'][max(0, i0 - 1):]]   # (un point de marge vers l'amont)
                else:
                    ll = [(lat, lon) for lon, lat in r['pts'] if w['clip'](lon, lat)]
                segs.append(ll)
            ll = max(segs, key=len)
            if w['name'] == 'Garonne':
                ll = ll + ESTUARY
            ll = ll + [tuple(p) for p in fr.get('embouchures', {}).get(w['name'], [])]
        pts = [geo.xy(lat, lon) for lat, lon in ll]
        cum = [0.0]
        for p, q in zip(pts, pts[1:]):
            cum.append(cum[-1] + math.dist(p, q))
        ways[w['name']] = dict(name=w['name'], label=w.get('label') or LABEL.get(w['name'], w['name']), pts=pts, cum=cum,
                               into=w['into'], sea=bool(w.get('sea')), low_water=bool(w.get('low_water')),
                               tidal_s=None, ports=[])
        if w.get('canal'):
            ways[w['name']].update(canal=True, year=w['year'])
        if w.get('tidal_lat'):
            ty = geo.xy(w['tidal_lat'], 0)[1]
            ways[w['name']]['tidal_s'] = next((cum[i] for i, p in enumerate(pts) if p[1] <= ty), None)
    # ports et quais
    taken = set()
    for name, w in ways.items():
        if w['sea'] or w.get('canal'):
            continue
        near = _near_cells(w['pts'])
        for n in geo.nodes:
            if EXCLUDE.get(n['name']) == name or (n['id'], name) in taken or (int(n['x'] // 4), int(n['y'] // 4)) not in near:
                continue
            d, s, q = _project(w['pts'], w['cum'], (n['x'], n['y']))
            if d <= RIVER_PORT_KM:
                w['ports'].append(dict(node=n['id'], s=s, q=q, spur=[]))
                taken.add((n['id'], name))
    for name, w in ways.items():
        if not w['sea']:
            continue
        for nm, spur in (SEA_PORTS.items() if name == 'Côte' else fr['ports'][name].items()):
            nid = geo.by_name.get(nm)
            if nid is None:
                continue
            n = geo.nodes[nid]
            sp = [geo.xy(lat, lon) for lat, lon in spur]
            anchor = sp[0] if sp else (n['x'], n['y'])
            d, s, q = _project(w['pts'], w['cum'], anchor)
            w['ports'].append(dict(node=nid, s=s, q=q, spur=sp))
    for c in defs:
        if c.get('canal'):
            w = ways[c['name']]
            for nm in c['quais']:
                n = geo.nodes[geo.by_name[nm]]
                d, s, q = _project(w['pts'], w['cum'], (n['x'], n['y']))
                w['ports'].append(dict(node=n['id'], s=s, q=q, spur=[]))
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
        if way.get('canal'):
            e['year'] = way['year']   # (engine.road_route : pas avant l'ouverture)
        new.append(e)
        eid += 1
        return e

    for w in ways.values():
        P = w['ports']
        for pa, pb in zip(P, P[1:]):
            if pa['node'] == pb['node']:
                continue
            tidal = w['sea'] or w.get('canal') or (w['tidal_s'] is not None and pa['s'] >= w['tidal_s'])
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
        if w.get('canal') and w['year'] > OPEN_YEAR:
            continue
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
        if w['sea'] or w.get('canal'):
            continue
        for p in w['ports']:
            down.setdefault(p['node'], [])
            for x in downstream(w['name'], p['s']):
                if x != p['node'] and x not in down[p['node']]:
                    down[p['node']].append(x)
    geo.down_nodes = down
    return keep
