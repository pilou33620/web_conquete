#!/usr/bin/env python3
"""Tracés en mer des voies d'eau de toute la France (géographie 3) : écrit game/data/voies_france.json.

Pour chaque route de cabotage de game/waterways.py (FR_SEAS) : la route en mer, d'un port au suivant, plutôt à 2,5 à
6 km de la côte (au plus court pour une traversée) ; le chenal de chaque port, de la route jusqu'à la place ; et
l'embouchure de chaque rivière qui se jette dans une de ces routes. Tout est cherché sur la grille de la carte (cases
de 1 km, plus court chemin pondéré) puis simplifié sans quitter l'eau. À relancer si la côte, les places ou les routes
de FR_SEAS changent.

Usage :  pip install numpy scipy scikit-image ; python3 outils/voies_eau.py
"""
import json
import math
import os
import sys

import numpy as np
from scipy import ndimage
from skimage.graph import route_through_array

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, '..'))
from game import waterways as WW   # noqa: E402
from game.geo import GeoMap, T_OCEAN, T_EAU   # noqa: E402

WW.build = lambda geo: None   # (on n'a besoin que de la grille et des places : les voies d'eau viennent d'ici)
G = GeoMap()
T = np.frombuffer(bytes(G.terrain), dtype=np.uint8).reshape(G.H, G.W)
water = (T == T_OCEAN) | (T == T_EAU)
lab, _ = ndimage.label(water)
size = np.bincount(lab.ravel())
SEA = water & (lab > 0) & (size[lab] > 5000)   # la mer et les estuaires (pas les lacs ni les étangs isolés)
D = ndimage.distance_transform_edt(SEA)        # km jusqu'à la terre
COST_BAND = np.where(SEA, 1 + 3 * np.clip(2.5 - D, 0, None) + 0.15 * np.clip(D - 6, 0, None), np.inf)
COST_OPEN = np.where(SEA, 1 + 3 * np.clip(2.5 - D, 0, None), np.inf)
COST_LAND = np.where(SEA, 1 + 2 * np.clip(1.5 - D, 0, None), 25.0)   # chenaux et embouchures : la terre, à grand coût
_, NEAR_SEA = ndimage.distance_transform_edt(~SEA, return_indices=True)
_, NEAR_OFF = ndimage.distance_transform_edt(~(SEA & (D >= 2)), return_indices=True)


def cell(lat, lon):
    x, y = G.xy(lat, lon)
    return min(G.H - 1, max(0, int(y))), min(G.W - 1, max(0, int(x)))


def snap(c, near):
    return int(near[0][c]), int(near[1][c])


def route(a, b, cost):
    path, _ = route_through_array(cost, a, b, fully_connected=True, geometric=True)
    return [(i + 0.5, j + 0.5) for j, i in path]


def in_sea(p, q, ok):
    n = max(1, int(math.dist(p, q) * 4))
    for k in range(n + 1):
        x, y = p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n
        if not ok(int(y), int(x)):
            return False
    return True


def simplify(pts, ok, maxlen=30):
    """Garde le moins de points possible, chaque segment restant sur l'eau (ok) et plus court que maxlen km."""
    out, i = [pts[0]], 0
    while i < len(pts) - 1:
        k = i + 1
        while k + 1 < len(pts) and math.dist(pts[i], pts[k + 1]) <= maxlen and in_sea(pts[i], pts[k + 1], ok):
            k += 1
        out.append(pts[k])
        i = k
    return out


def latlon(pts):
    return [[round(G.lat_of(y), 4), round(G.lon_of(x), 4)] for x, y in pts]


def land_km(pts):
    n = 0
    for p, q in zip(pts, pts[1:]):
        m = max(1, int(math.dist(p, q) * 4))
        n += sum(not SEA[int(p[1] + (q[1] - p[1]) * k / m), int(p[0] + (q[0] - p[0]) * k / m)] for k in range(m))
    return n / 4


sea_ok = lambda j, i: bool(SEA[j, i])
out = dict(mers={}, ports={}, embouchures={})
for s in WW.FR_SEAS:
    offs = {}
    for nm in s['ports']:
        n = G.nodes[G.by_name[nm]]
        offs[nm] = snap((int(n['y']), int(n['x'])), NEAR_OFF)
    stops = ([snap(cell(*s['start']), NEAR_SEA)] if s.get('start') else []) + [offs[nm] for nm in s['ports']] \
        + ([snap(cell(*s['end']), NEAR_SEA)] if s.get('end') else [])
    line = []
    for a, b in zip(stops, stops[1:]):
        leg = route(a, b, COST_OPEN if s.get('large') else COST_BAND)
        line += leg if not line else leg[1:]
    # (les arrêts devant les ports restent dans le tracé : la projection d'un port tombe sur son chenal)
    keep = {(i + 0.5, j + 0.5) for j, i in stops}
    pts, seg = [], []
    for p in line:
        seg.append(p)
        if p in keep and len(seg) > 1:
            pts += simplify(seg, sea_ok)[(1 if pts else 0):]
            seg = [p]
    if len(seg) > 1:
        pts += simplify(seg, sea_ok)[(1 if pts else 0):]
    out['mers'][s['name']] = latlon(pts)
    out['ports'][s['name']] = {}
    for nm in s['ports']:
        n = G.nodes[G.by_name[nm]]
        j, i = offs[nm]
        sp = route((j, i), (int(n['y']), int(n['x'])), COST_LAND)
        allowed = {(int(y), int(x)) for x, y in sp}
        sp = simplify(sp, lambda j, i: SEA[j, i] or (j, i) in allowed, 15)[:-1]   # (sans la place elle-même)
        out['ports'][s['name']][nm] = latlon(sp)
        lk = land_km(sp + [(n['x'], n['y'])])
        if lk > 3:
            print(f"  {nm} : chenal de {lk:.1f} km sur terre")
    print(s['name'], len(pts), 'points', round(sum(math.dist(p, q) for p, q in zip(pts, pts[1:]))), 'km')

seas = {s['name']: s for s in WW.FR_SEAS}
rivers = {r['name']: r for r in G.src['rivers']}
for w in WW.FR_WAYS:
    if w['into'] not in seas:
        continue
    lon, lat = rivers[w['river']]['pts'][-1]
    x, y = G.xy(lat, lon)
    sea = [G.xy(*p) for p in out['mers'][w['into']]]
    tx, ty = min(sea, key=lambda p: math.dist(p, (x, y)))
    sp = route((int(y), int(x)), snap((int(ty), int(tx)), NEAR_SEA), COST_LAND)
    allowed = {(int(b), int(a)) for a, b in sp}
    sp = simplify(sp, lambda j, i: SEA[j, i] or (j, i) in allowed, 15)[1:]
    out['embouchures'][w['name']] = latlon(sp)
    print(f"embouchure {w['name']} : {len(sp)} points, {land_km([(x, y)] + sp):.1f} km sur terre")

with open(os.path.join(ICI, '..', 'game', 'data', 'voies_france.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
