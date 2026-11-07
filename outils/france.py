#!/usr/bin/env python3
"""La géographie de toute la France (SPEC-FRANCE.md, étape 1) : écrit game/data/geo.json et game/data/places_france.json.

Sources (paquets npm, à installer dans un dossier de travail : npm i @highcharts/map-collection @etalab/decoupage-administratif
cities.json world-atlas @geo-maps/earth-rivers-10m @geo-maps/earth-lakes-10m ; et pip install numpy pillow scipy scikit-image) :
- contours des départements : Highcharts (fr-all-all, en longitude et latitude), réunis comme en 1790 : la Seine (75, 92,
  93, 94), la Seine-et-Oise (78, 91, 95), la Corse (2A, 2B) ; le Territoire de Belfort avec le Haut-Rhin ;
- villes et villages : GeoNames (cities.json : nom, coordonnées, département), populations INSEE (@etalab) ;
- pays voisins : Natural Earth 50 m (world-atlas) ; lacs : Natural Earth 10 m ;
- rivières : Natural Earth 10 m (des surfaces) : rastérisées à 250 m, amincies en tracés (squelette), les plus longues
  gardées, nommées d'après des points connus de leur cours.

Usage :  python3 outils/france.py /chemin/vers/node_modules
"""
import json
import math
import os
import sys
import unicodedata

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.morphology import skeletonize

ICI = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ICI, '..', 'game', 'data')
LON0, LON1, LAT0, LAT1, LAT_REF = -5.3, 9.7, 41.3, 51.2, 46.5
KX, KY = 111.32 * math.cos(math.radians(LAT_REF)), 110.95
RES = 0.25          # km par pixel pour amincir les rivières
CURATED = {'33', '24', '40', '47', '64'}   # places choisies à la main (game/places.py)
FUSION = {'92': '75', '93': '75', '94': '75', '91': '78', '95': '78', '2A': '20', '2B': '20', '90': '68', '69M': '69'}
NOMS_1790 = {'75': 'Seine', '78': 'Seine-et-Oise', '20': 'Corse'}
VOISINS = {'Spain', 'Andorra', 'Italy', 'Switzerland', 'Germany', 'Luxembourg', 'Belgium', 'Netherlands', 'Monaco',
           'United Kingdom', 'San Marino', 'Liechtenstein', 'Austria', 'Jersey', 'Guernsey', 'Sardinia'}

# rivières : nom, rang (1 fleuve, 2 grande rivière, 3 rivière), points de leur cours, de la source à l'embouchure (lon, lat)
RIVIERES = [
    ('Loire', 1, [(4.22, 44.84), (3.95, 45.10), (4.07, 46.04), (3.16, 46.99), (2.88, 47.48), (1.90, 47.90), (1.33, 47.59), (0.69, 47.39), (-0.53, 47.42), (-1.55, 47.21), (-2.20, 47.27)]),
    ('Seine', 1, [(4.72, 47.49), (4.58, 47.86), (4.07, 48.30), (2.95, 48.38), (2.66, 48.54), (2.35, 48.86), (1.72, 48.99), (1.09, 49.44), (0.20, 49.43)]),
    ('Rhône', 1, [(6.14, 46.21), (5.84, 45.96), (4.83, 45.75), (4.87, 45.52), (4.89, 44.93), (4.72, 44.56), (4.81, 43.95), (4.63, 43.68), (4.83, 43.33)]),
    ('Garonne', 1, [(0.69, 42.91), (0.72, 43.11), (1.44, 43.60), (0.62, 44.20), (0.17, 44.50), (-0.25, 44.55), (-0.57, 44.84), (-0.56, 45.04)]),
    ('Dordogne', 1, [(2.81, 45.53), (2.50, 45.40), (1.94, 45.09), (1.47, 44.90), (0.48, 44.85), (-0.24, 44.91), (-0.56, 45.04)]),
    ('Rhin', 1, [(7.59, 47.56), (7.58, 48.03), (7.80, 48.57), (8.23, 48.97)]),
    ('Saône', 2, [(6.07, 48.10), (5.59, 47.44), (5.39, 47.19), (4.85, 46.78), (4.83, 46.31), (4.82, 45.73)]),
    ('Meuse', 2, [(5.63, 48.07), (5.70, 48.36), (5.59, 48.76), (5.38, 49.16), (4.94, 49.70), (4.72, 49.77), (4.83, 50.14)]),
    ('Moselle', 2, [(6.90, 47.89), (6.45, 48.17), (5.89, 48.68), (6.06, 48.90), (6.18, 49.12), (6.17, 49.36), (6.36, 49.44)]),
    ('Marne', 2, [(5.31, 47.88), (5.14, 48.11), (4.95, 48.64), (4.37, 48.96), (3.95, 49.04), (3.40, 49.05), (2.88, 48.96), (2.41, 48.82)]),
    ('Oise', 2, [(4.08, 49.92), (3.63, 49.90), (3.22, 49.62), (2.83, 49.42), (2.47, 49.26), (2.10, 48.99)]),
    ('Aisne', 2, [(4.90, 49.09), (4.37, 49.51), (3.32, 49.38), (2.86, 49.43)]),
    ('Allier', 2, [(3.85, 44.57), (3.49, 45.10), (3.39, 45.29), (3.25, 45.54), (3.42, 46.13), (3.33, 46.57), (3.08, 46.96)]),
    ('Cher', 2, [(2.60, 46.34), (2.50, 46.72), (2.07, 47.22), (1.18, 47.34), (0.43, 47.35)]),
    ('Vienne', 2, [(1.26, 45.83), (0.67, 46.01), (0.55, 46.82), (0.24, 47.17), (0.07, 47.21)]),
    ('Charente', 2, [(0.29, 46.15), (0.16, 45.65), (-0.33, 45.70), (-0.63, 45.75), (-0.96, 45.94), (-1.10, 45.97)]),
    ('Lot', 2, [(3.75, 44.48), (3.50, 44.52), (2.76, 44.52), (2.08, 44.58), (1.44, 44.45), (0.97, 44.50), (0.71, 44.41), (0.34, 44.30)]),
    ('Tarn', 2, [(3.08, 44.10), (2.15, 43.93), (1.90, 43.90), (1.35, 44.02), (1.08, 44.10)]),
    ('Adour', 2, [(0.07, 43.23), (-0.26, 43.70), (-1.05, 43.71), (-1.47, 43.49), (-1.52, 43.53)]),
    ('Durance', 2, [(6.64, 44.90), (6.50, 44.56), (5.94, 44.20), (5.79, 43.83), (5.04, 43.84), (4.80, 43.95)]),
    ('Isère', 2, [(6.77, 45.62), (6.39, 45.67), (5.72, 45.19), (5.05, 45.04), (4.86, 44.99)]),
    ('Somme', 2, [(3.29, 49.85), (2.93, 49.93), (2.30, 49.89), (1.83, 50.11), (1.60, 50.20)]),
    ('Yonne', 2, [(3.52, 47.46), (3.57, 47.80), (3.40, 47.98), (3.28, 48.20), (2.96, 48.38)]),
    ('Doubs', 2, [(6.35, 46.90), (6.80, 47.51), (6.02, 47.24), (5.49, 47.09), (5.02, 46.90)]),
    ('Indre', 3, [(1.99, 46.58), (1.69, 46.81), (1.00, 47.13), (0.27, 47.24)]),
    ('Creuse', 3, [(2.17, 45.96), (1.52, 46.59), (1.06, 46.63), (0.55, 46.95)]),
    ('Aveyron', 3, [(2.57, 44.35), (2.03, 44.35), (1.15, 44.06)]),
    ('Mayenne', 3, [(-0.62, 48.30), (-0.77, 48.07), (-0.70, 47.83), (-0.55, 47.47)]),
    ('Sarthe', 3, [(0.09, 48.43), (0.20, 48.00), (-0.33, 47.84), (-0.55, 47.50)]),
    ('Loir', 3, [(1.33, 48.07), (1.07, 47.79), (-0.08, 47.70), (-0.50, 47.53)]),
    ('Vilaine', 3, [(-1.20, 48.12), (-1.68, 48.11), (-2.08, 47.65), (-2.45, 47.50)]),
    ('Orne', 3, [(-0.02, 48.74), (-0.36, 49.18), (-0.25, 49.28)]),
    ('Eure', 3, [(1.49, 48.45), (1.40, 48.73), (1.17, 49.21), (1.15, 49.30)]),
    ('Aude', 3, [(2.18, 42.87), (2.22, 43.05), (2.35, 43.21), (3.00, 43.18), (3.24, 43.21)]),
    ('Hérault', 3, [(3.71, 43.93), (3.42, 43.46), (3.47, 43.31)]),
    ('Ain', 3, [(5.60, 46.30), (5.33, 46.05), (5.17, 45.80)]),
    ('Var', 3, [(6.89, 43.95), (7.19, 43.66)]),
    ('Ariège', 3, [(1.84, 42.72), (1.61, 42.96), (1.61, 43.12), (1.40, 43.50)]),
    ('Aube', 3, [(4.70, 48.23), (4.14, 48.53), (3.62, 48.55)]),
    ('Meurthe', 3, [(6.95, 48.29), (6.50, 48.59), (6.18, 48.69), (6.13, 48.78)]),
    ('Ill', 3, [(7.34, 47.75), (7.36, 48.07), (7.75, 48.58)]),
    ('Escaut', 3, [(3.24, 50.18), (3.52, 50.36), (3.59, 50.45)]),
    ('Sambre', 3, [(3.69, 50.13), (3.97, 50.28)]),
    ('Sèvre niortaise', 3, [(-0.46, 46.32), (-0.99, 46.31), (-1.13, 46.31)]),
    ('Drôme', 3, [(5.37, 44.75), (5.02, 44.73), (4.80, 44.75)]),
    ('Gard', 3, [(3.98, 44.05), (4.54, 43.95), (4.65, 43.85)]),
    ('Ardèche', 3, [(4.39, 44.62), (4.40, 44.40), (4.65, 44.27)]),
    ('Blavet', 3, [(-2.96, 48.07), (-3.28, 47.80)]),
    ('Aulne', 3, [(-3.57, 48.27), (-4.09, 48.20), (-4.20, 48.25)]),
    ('Golo', 3, [(9.15, 42.30), (9.53, 42.53)]),
    ('Isle', 2, [(0.72, 45.18), (0.36, 45.03), (-0.13, 45.04), (-0.24, 44.92)]),
    ('Vézère', 2, [(1.56, 45.42), (1.16, 45.06), (0.93, 44.91), (0.89, 44.88)]),
    ('Gers', 3, [(0.38, 43.12), (0.59, 43.65), (0.62, 43.93), (0.60, 44.15)]),
    ('Gave de Pau', 2, [(-0.05, 43.10), (-0.37, 43.30), (-0.77, 43.49), (-1.10, 43.55)]),
    ('Baïse', 3, [(0.40, 43.20), (0.37, 43.96), (0.34, 44.14), (0.33, 44.30)]),
    ('Dronne', 3, [(0.65, 45.36), (0.34, 45.25), (-0.13, 45.04)]),
]


def xy(lon, lat):
    return (lon - LON0) * KX, (LAT1 - lat) * KY


def lonlat(x, y):
    return LON0 + x / KX, LAT1 - y / KY


def plat(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower().replace('-', ' ').replace("'", ' ')


def dans_cadre(ring, m=0.5):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return max(xs) > LON0 - m and min(xs) < LON1 + m and max(ys) > LAT0 - m and min(ys) < LAT1 + m


def arrondi(ring, k=4):
    out = []
    for x, y in ring:
        p = [round(x, k), round(y, k)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    ux, uy = bx - ax, by - ay; n = math.hypot(ux, uy) or 1.0
    d = [abs(ux * (p[1] - ay) - uy * (p[0] - ax)) / n for p in pts[1:-1]]
    i = d.index(max(d)) + 1
    if d[i - 1] > eps:
        return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


# ------------------------------------------------------------------ topojson (world-atlas)
def topo(path):
    d = json.load(open(path)); t = d.get('transform'); arcs = []
    for a in d['arcs']:
        x = y = 0; pts = []
        for p in a:
            if t:
                x += p[0]; y += p[1]; pts.append([x * t['scale'][0] + t['translate'][0], y * t['scale'][1] + t['translate'][1]])
            else:
                pts.append(p)
        arcs.append(pts)

    def ligne(ids):
        out = []
        for i in ids:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(a if not out else a[1:])
        return out

    def anneaux(g):   # les contours extérieurs
        if g['type'] == 'Polygon':
            return [ligne(g['arcs'][0])]
        if g['type'] == 'MultiPolygon':
            return [ligne(p[0]) for p in g['arcs']]
        return []
    return d, anneaux


# ------------------------------------------------------------------ départements
def departements(nm):
    gj = json.load(open(os.path.join(nm, '@highcharts/map-collection/countries/fr/fr-all-all.geo.json')))
    noms = {d['code']: d['nom'] for d in json.load(open(os.path.join(nm, '@etalab/decoupage-administratif/data/departements.json')))}
    depts = {}
    for f in gj['features']:
        k = f['properties']['hc-key'][3:].upper()
        if k.startswith('97') or k == '75C':
            k = '75' if k == '75C' else None
        if not k:
            continue
        code = FUSION.get(k, k)
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        d = depts.setdefault(code, dict(name=NOMS_1790.get(code, noms.get(code, code)), rings=[], playable=True))
        for p in polys:
            r = arrondi(p[0], 3)
            if len(r) >= 4:
                d['rings'].append(r)
    return depts


# ------------------------------------------------------------------ rivières
def rivieres(nm, v2):
    """Les rivières du tableau : entre leurs points connus, le chemin le moins coûteux le long des surfaces d'eau de
    Natural Earth (rastérisées à 250 m), simplifié ; puis les petites rivières du Sud-Ouest tracées à la main (géographie 2)."""
    from skimage.graph import route_through_array
    W, H = int((LON1 - LON0) * KX / RES), int((LAT1 - LAT0) * KY / RES)
    d = json.load(open(os.path.join(nm, '@geo-maps/earth-rivers-10m/map.geo.json')))
    img = Image.new('L', (W, H)); dr = ImageDraw.Draw(img)
    P = lambda r: [((x - LON0) * KX / RES, (LAT1 - y) * KY / RES) for x, y in r]
    for g in d['geometries']:
        for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
            if dans_cadre(p[0], 0.2):
                dr.polygon(P(p[0]), fill=255)
    m = ndimage.binary_dilation(np.array(img) > 0, iterations=2)
    cout = np.where(m, 1.0, 40.0).astype(np.float64)
    out = []
    for nom, rang, ref in RIVIERES:
        pts = []
        for a, b in zip(ref, ref[1:]):
            (ax, ay), (bx, by) = [xy(*q) for q in (a, b)]
            c0, c1 = int(min(ax, bx) / RES) - 80, int(max(ax, bx) / RES) + 80
            r0, r1 = int(min(ay, by) / RES) - 80, int(max(ay, by) / RES) + 80
            c0, r0, c1, r1 = max(0, c0), max(0, r0), min(W, c1), min(H, r1)
            sub = cout[r0:r1, c0:c1]
            iy = lambda v, o, n: min(n - 1, max(0, int(v / RES) - o))
            ch, _ = route_through_array(sub, (iy(ay, r0, r1 - r0), iy(ax, c0, c1 - c0)), (iy(by, r0, r1 - r0), iy(bx, c0, c1 - c0)), fully_connected=True, geometric=True)
            seg = [((c + c0) * RES, (r + r0) * RES) for r, c in ch]
            pts.extend(seg if not pts else seg[1:])
        pts = rdp(pts, 0.3)
        out.append(dict(name=nom, rank=rang, pts=[[round(v, 4) for v in lonlat(x, y)] for x, y in pts]))
    noms = {r[0] for r in RIVIERES}
    out += [r for r in v2['rivers'] if r['name'] not in noms]
    return out


# ------------------------------------------------------------------ lacs, pays voisins
def lacs(nm):
    d = json.load(open(os.path.join(nm, '@geo-maps/earth-lakes-10m/map.geo.json')))
    geoms = d['geometries'] if 'geometries' in d else [f['geometry'] for f in d['features']]
    out = []
    for g in geoms:
        for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
            r = p[0]
            if not dans_cadre(r, 0):
                continue
            xs = [xy(*q) for q in r]
            aire = abs(sum(xs[i][0] * xs[i - 1][1] - xs[i - 1][0] * xs[i][1] for i in range(len(xs)))) / 2
            if aire >= 3:
                out.append(dict(name='', ring=arrondi(r, 4)))
    return out


def voisins(nm):
    d, anneaux = topo(os.path.join(nm, 'world-atlas/countries-50m.json'))
    out = []
    for g in d['objects']['countries']['geometries']:
        if g.get('properties', {}).get('name') in VOISINS:
            for r in anneaux(g):
                if dans_cadre(r, 1.5):
                    out.append(dict(name=g['properties']['name'], ring=arrondi(r, 3)))
    return out


# ------------------------------------------------------------------ places
GRANDES_1790 = {   # populations vers 1790 des grandes villes (sinon : population d'aujourd'hui ramenée)
    'Paris': 600000, 'Lyon': 145000, 'Marseille': 106000, 'Nantes': 80000, 'Rouen': 72000, 'Lille': 62000,
    'Toulouse': 52000, 'Strasbourg': 49000, 'Orléans': 48000, 'Amiens': 40000, 'Nîmes': 41000, 'Metz': 36000,
    'Montpellier': 32000, 'Brest': 30000, 'Reims': 31000, 'Caen': 31000, 'Rennes': 30000, 'Toulon': 28000,
    'Besançon': 28000, 'Nancy': 30000, 'Grenoble': 22000, 'Tours': 21000, 'Angers': 33000, 'Dijon': 21000,
    'Limoges': 21000, 'Le Havre': 20000, 'Clermont-Ferrand': 24000, 'Avignon': 26000, 'Aix-en-Provence': 25000,
    'Dunkerque': 27000, 'Troyes': 26000, 'Versailles': 51000, 'Saint-Étienne': 18000, 'Poitiers': 18000,
    'Le Mans': 18000, 'Arles': 21000, 'Arras': 22000, 'Valenciennes': 20000, 'La Rochelle': 18000,
}
PLACES_FORTES = {   # places fortes de Vauban et des frontières : niveau de fortification
    'Lille': 4, 'Dunkerque': 3, 'Calais': 3, 'Maubeuge': 3, 'Givet': 3, 'Sedan': 3, 'Montmédy': 3, 'Longwy': 3,
    'Thionville': 3, 'Metz': 4, 'Bitche': 3, 'Strasbourg': 4, 'Neuf-Brisach': 3, 'Belfort': 3, 'Besançon': 3,
    'Briançon': 3, 'Mont-Dauphin': 2, 'Entrevaux': 2, 'Toulon': 3, 'Perpignan': 3, 'Mont-Louis': 2,
    'Brest': 3, 'Saint-Malo': 3, 'Cherbourg-en-Cotentin': 2, 'Le Havre': 2, 'Arras': 3, 'Valenciennes': 3,
    'Cambrai': 2, 'Douai': 2, 'Verdun': 3, 'Toul': 2, 'Phalsbourg': 2, 'Huningue': 2, 'Antibes': 2, 'Grenoble': 2,
    'Lyon': 1, 'Bayonne': 3, 'Rochefort': 2, 'Lorient': 2, 'Port-Louis': 2, 'Saint-Martin-de-Ré': 2, 'Auxonne': 2,
    'Landau': 2, 'Sarrelouis': 2, 'Bouillon': 2, 'Charleville-Mézières': 2, 'Rocroi': 2, 'Le Quesnoy': 2,
    'Gravelines': 2, 'Bergues': 2, 'Condé-sur-l\'Escaut': 2, 'Bouchain': 2, 'Marsal': 2, 'Sélestat': 2,
}


def places(nm, depts, mer):
    com = json.load(open(os.path.join(nm, '@etalab/decoupage-administratif/data/communes.json')))
    deps = {d['code']: d for d in json.load(open(os.path.join(nm, '@etalab/decoupage-administratif/data/departements.json')))}
    pop = {}
    cheflieu = {}
    for c in com:
        if c.get('type') != 'commune-actuelle':
            continue
        dc = FUSION.get(c['departement'], c['departement'])
        pop[(plat(c['nom']), dc)] = max(pop.get((plat(c['nom']), dc), 0), c.get('population') or 0)
        if deps.get(c['departement'], {}).get('chefLieu') == c['code']:
            cheflieu[c['departement']] = c['nom']
    cites = [c for c in json.load(open(os.path.join(nm, 'cities.json/cities.json'))) if c['country'] == 'FR']
    par_dep = {}
    for c in cites:
        dc = FUSION.get(c['admin2'].upper(), c['admin2'].upper())
        if dc not in depts or dc in CURATED:
            continue
        p = pop.get((plat(c['name']), dc))
        if not p:
            continue
        par_dep.setdefault(dc, {})[c['name']] = (c['name'], float(c['lat']), float(c['lng']), p)
    out = []
    for dc, villes in sorted(par_dep.items()):
        vs = sorted(villes.values(), key=lambda v: -v[3])
        # le chef-lieu de 1790 : la préfecture d'aujourd'hui (Paris pour la Seine, Versailles, Ajaccio pour la Corse)
        chef = {'75': 'Paris', '78': 'Versailles', '20': 'Ajaccio'}.get(dc) or cheflieu.get(dc)
        cap = next((v for v in vs if v[0] == chef), vs[0])
        choix = [cap]
        loin = lambda v, k: min(math.hypot(*(np.subtract(xy(v[2], v[1]), xy(w[2], w[1])))) for w in choix) > k
        for v in vs:   # les villes : les plus peuplées, pas collées à une autre
            if len(choix) >= 8:
                break
            if v not in choix and v[3] >= 2500 and loin(v, 12):
                choix.append(v)
        nv = len(choix)
        petits = [v for v in vs if 250 <= v[3] < 6000 and v not in choix]
        while len(choix) < nv + 16 and petits:   # les villages : répartis sur le département (le plus loin des autres)
            best = max(petits, key=lambda v: min(math.hypot(*(np.subtract(xy(v[2], v[1]), xy(w[2], w[1])))) for w in choix))
            choix.append(best); petits.remove(best)
        for k, (nom, lat, lon, p) in enumerate(choix):
            typ = 'capitale' if k == 0 else 'ville' if k < nv else 'village'
            x, y = xy(lon, lat)
            spec = ['port'] if mer(x, y) else []
            p0 = GRANDES_1790.get(nom) or int(round(p * (0.32 if p > 30000 else 0.5 if p > 5000 else 0.8)))
            out.append([nom, round(lat, 4), round(lon, 4), dc, typ, spec, PLACES_FORTES.get(nom, 1 if typ == 'capitale' else 0), p0])
    return out


def main():
    nm = sys.argv[1] if len(sys.argv) > 1 else 'node_modules'
    depts = departements(nm)
    print('départements', len(depts), flush=True)
    lands = voisins(nm)
    v2w = json.load(open(os.path.join(DATA, 'geo_v2.json'), encoding='utf-8'))['waters']
    waters = v2w + lacs(nm)   # (les étangs, le bassin d'Arcachon et l'estuaire de la Gironde de la géographie 2, nommés)
    print('pays voisins', len(lands), 'lacs', len(waters), flush=True)
    # la mer : hors des départements et des pays voisins (pour les ports), sur une grille de 2 km
    G = 2.0
    W, H = int((LON1 - LON0) * KX / G) + 1, int((LAT1 - LAT0) * KY / G) + 1
    img = Image.new('L', (W, H)); dr = ImageDraw.Draw(img)
    for r in [r for d in depts.values() for r in d['rings']] + [l['ring'] for l in lands]:
        dr.polygon([((x - LON0) * KX / G, (LAT1 - y) * KY / G) for x, y in r], fill=255)
    terre = np.array(img) > 0
    mer = lambda x, y: any(not terre[min(H - 1, max(0, int(y / G) + b)), min(W - 1, max(0, int(x / G) + a))] for a in (-2, 0, 2) for b in (-2, 0, 2))
    pl = places(nm, depts, mer)
    print('places', len(pl), flush=True)
    v2 = json.load(open(os.path.join(DATA, 'geo_v2.json'), encoding='utf-8'))
    rv = rivieres(nm, v2)
    print('rivières', len(rv), 'nommées', sum(1 for r in rv if r['name']), flush=True)
    src = dict(bounds=dict(lon0=LON0, lon1=LON1, lat0=LAT0, lat1=LAT1), lat_ref=LAT_REF, depts=depts, rivers=rv,
               waters=waters, lands=lands)
    with open(os.path.join(DATA, 'geo.json'), 'w', encoding='utf-8') as f:
        json.dump(src, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(DATA, 'places_france.json'), 'w', encoding='utf-8') as f:
        json.dump(pl, f, ensure_ascii=False, separators=(',', ':'))
    print('écrit', os.path.join(DATA, 'geo.json'))


if __name__ == '__main__':
    main()
