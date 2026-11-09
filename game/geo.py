"""Carte de l'Aquitaine : projection, grilles (terrain, départements, cours d'eau),
réseau routier et recherche de chemin hors route (A*).

Tout est calculé en kilomètres. Une cellule de grille = 1 km x 1 km.
Le résultat est mis en cache dans data/map_cache.json (régénéré si la source change).

Versions de la géographie (VERSION, notée dans la sauvegarde : une partie garde la sienne, ses routes, ses crues et ses
cartes de bataille) : 1, les données d'avant (data/geo_v1.json, figé, avec la place d'alors des villes déplacées depuis) ;
2, les rivières d'OpenStreetMap (Overture, octobre 2026 : leur cours principal, simplifié à 60 m, chaque affluent
raccordé à sa rivière) et les villes au bord de l'eau à leur vraie place (places.py). Une modification du calcul de ce
fichier change aussi la carte des anciennes parties.
"""
import base64
import hashlib
import heapq
import json
import math
import os
import sys
from array import array

from .places import PLACES, ROYAL_ROUTES, EXTRA_ROADS, EXTRA_ROADS_2, NO_ROADS_2, FERRIES, CITY_SPECIALTIES, CITY_POP
from .regions import SPECIALITES

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
CACHE_VERSION = 8
VERSION = 3   # 3 : toute la France (outils/france.py) ; 2 et 1 : le Sud-Ouest des anciennes parties

LAT_REF = 44.25
KX = 111.32 * math.cos(math.radians(LAT_REF))
KY = 110.95

# Types de terrain
T_OCEAN, T_EAU, T_PLAINE, T_FORET, T_LANDE, T_MARAIS, T_COLLINES, T_MONTAGNE, T_HAUTE, T_DUNES, T_VIGNE = range(11)
TERRAIN = {
    # id: (nom, vitesse hors route, couvert pour embuscade, bonus défense)
    T_OCEAN: ('Océan', 0.0, False, 1.0),
    T_EAU: ('Eau', 0.0, False, 1.0),
    T_PLAINE: ('Plaine', 0.70, False, 1.0),
    T_FORET: ('Forêt', 0.42, True, 1.10),
    T_LANDE: ('Lande', 0.55, True, 1.0),
    T_MARAIS: ('Marais', 0.30, True, 1.05),
    T_COLLINES: ('Collines', 0.55, False, 1.15),
    T_MONTAGNE: ('Montagne', 0.30, True, 1.30),
    T_HAUTE: ('Haute montagne', 0.12, False, 1.45),
    T_DUNES: ('Dunes', 0.35, False, 1.0),
    T_VIGNE: ('Vignoble', 0.60, False, 1.05),
}
PLAYABLE = ['33', '24', '40', '47', '64']   # (géographies 1 et 2 ; depuis la 3, toute la France : GeoMap.playable_codes)
NONE = 0xFFFF   # cellnode : case sans lieu (eau, hors du jeu)


def _b16(a):
    a = array('H', a)
    if sys.byteorder == 'big':
        a.byteswap()
    return a.tobytes()


def _h16(b):
    a = array('H'); a.frombytes(b)
    if sys.byteorder == 'big':
        a.byteswap()
    return a

LANDES_POLY = [(45.48, -1.12), (45.20, -0.95), (45.02, -0.82), (44.80, -0.70), (44.55, -0.44), (44.30, -0.18),
               (44.08, 0.06), (43.93, -0.30), (43.90, -0.62), (43.82, -0.95), (43.72, -1.22), (43.66, -1.40),
               (44.20, -1.30), (44.60, -1.27), (45.00, -1.20), (45.50, -1.18)]
FORESTS = [  # (lat, lon, rayon km, densité)
    (45.12, 0.22, 17, 0.85), (44.98, 0.55, 11, 0.8), (44.76, 0.98, 11, 0.8), (45.10, 0.98, 9, 0.75),
    (45.00, 0.73, 8, 0.7), (45.48, 0.72, 16, 0.55), (44.85, 1.20, 14, 0.5), (44.28, 0.06, 15, 0.6),
    (43.05, -1.05, 11, 0.8), (43.10, -0.75, 9, 0.6), (44.42, 0.12, 8, 0.5), (45.40, 1.10, 12, 0.5),
    (44.60, 0.95, 10, 0.5), (43.25, -0.62, 7, 0.45),
]
VINEYARDS = [
    (44.90, -0.17, 8), (44.60, -0.38, 9), (44.75, -0.30, 11), (45.08, -0.56, 8), (44.82, 0.47, 9),
    (44.25, 0.30, 6), (44.67, 0.18, 6), (43.28, -0.45, 7), (43.55, -0.05, 6), (43.18, -1.30, 4),
    (45.14, -0.76, 7), (44.70, -0.47, 5), (43.88, -0.25, 6),
]


# ---------------------------------------------------------------- géographie 3 : toute la France (outils/france.py)
# relief : des lignes de crête (lat, lon) et des massifs isolés, en « hauteur » du jeu (> 0,42 collines, > 0,80 montagne,
# > 1,55 haute montagne) ; le Sud-Ouest garde son relief écrit à la main (_elev)
CRETES = [   # (amplitude, demi-largeur en degrés, crête)
    (2.20, 0.26, [(43.95, 7.25), (44.15, 6.95), (44.50, 6.70), (44.90, 6.60), (45.30, 6.90), (45.83, 6.86), (46.20, 6.65)]),   # Alpes
    (2.10, 0.26, [(43.10, -1.60), (42.98, -0.80), (42.80, 0.00), (42.70, 0.70), (42.62, 1.50), (42.52, 2.20), (42.48, 2.90)]),   # Pyrénées
    (0.95, 0.22, [(46.25, 5.95), (46.60, 6.15), (47.00, 6.55), (47.40, 7.00)]),   # Jura
    (1.00, 0.18, [(47.85, 7.00), (48.10, 7.05), (48.40, 7.18), (48.70, 7.20)]),   # Vosges
    (1.60, 0.18, [(41.70, 9.15), (42.00, 9.05), (42.40, 9.00), (42.70, 9.20)]),   # Corse
]
MASSIFS = [   # (lat, lon, amplitude, rayon en degrés)
    (45.30, 3.00, 0.55, 1.20), (45.06, 2.75, 1.20, 0.22), (45.53, 2.81, 1.15, 0.18), (45.80, 2.95, 0.45, 0.12),
    (44.90, 4.20, 0.90, 0.20), (44.85, 3.45, 0.40, 0.30), (44.60, 3.00, 0.35, 0.28), (44.25, 3.75, 0.70, 0.30),
    (43.45, 2.30, 0.45, 0.18), (45.70, 1.90, 0.25, 0.45), (47.15, 4.00, 0.55, 0.25), (45.60, 3.80, 0.60, 0.18),
    (45.65, 4.45, 0.35, 0.22), (45.00, 4.35, 0.55, 0.28), (45.45, 3.60, 0.45, 0.22), (46.10, 4.50, 0.40, 0.18),
    (45.90, 3.25, -0.70, 0.28),   # la Limagne
    (45.00, 5.50, 0.85, 0.22), (45.35, 5.80, 0.85, 0.18), (45.65, 6.15, 0.85, 0.18), (44.17, 5.28, 1.00, 0.12),
    (43.80, 5.40, 0.55, 0.30), (43.53, 5.60, 0.55, 0.15), (43.25, 6.35, 0.60, 0.25), (43.48, 6.85, 0.50, 0.15),
    (44.40, 5.20, 0.70, 0.35), (43.95, 6.20, 0.85, 0.35),   # Baronnies, Préalpes de Digne
    (48.40, -3.90, 0.55, 0.20), (48.20, -3.60, 0.45, 0.22), (48.75, -0.55, 0.50, 0.40), (48.40, -0.30, 0.42, 0.30),
    (49.85, 4.70, 0.75, 0.30), (49.15, 5.00, 0.45, 0.18), (47.20, 4.75, 0.50, 0.30), (47.80, 5.20, 0.48, 0.45),
    (48.90, 7.40, 0.60, 0.20),
    (42.70, 2.90, -1.60, 0.22), (43.20, 3.10, -0.80, 0.30),   # la plaine du Roussillon, le bas Languedoc
]
FORETS_3 = [   # (lat, lon, rayon km, densité)
    (47.95, 2.15, 18, 0.85), (48.40, 2.68, 10, 0.90), (49.37, 2.88, 10, 0.90), (48.65, 1.82, 10, 0.85), (49.25, 3.05, 8, 0.80),
    (49.18, 2.48, 7, 0.80), (47.55, 1.90, 30, 0.60), (48.15, 3.75, 12, 0.70), (47.12, 5.68, 10, 0.85), (48.20, 6.90, 35, 0.70),
    (48.90, 7.40, 20, 0.75), (48.85, 7.85, 8, 0.85), (49.15, 5.00, 14, 0.75), (49.85, 4.70, 25, 0.75), (47.15, 4.00, 22, 0.70),
    (46.65, 2.75, 9, 0.90), (47.80, 0.40, 8, 0.85), (46.80, 6.20, 40, 0.60), (48.00, -2.20, 8, 0.70), (45.00, 3.20, 60, 0.35),
    (44.20, 3.70, 25, 0.55), (45.70, 1.90, 40, 0.40), (43.25, 6.35, 15, 0.70), (43.48, 6.85, 8, 0.70), (42.20, 9.10, 35, 0.50),
    (49.43, 1.47, 10, 0.80), (49.95, 1.45, 8, 0.80), (49.60, 3.40, 9, 0.80), (48.50, 0.75, 14, 0.60), (45.40, 6.30, 45, 0.45),
]
VIGNES_3 = [   # (lat, lon, rayon km)
    (49.05, 4.00, 18), (47.05, 4.85, 14), (47.80, 3.80, 6), (46.10, 4.60, 12), (46.35, 4.75, 8), (44.25, 4.80, 18),
    (44.06, 4.85, 6), (48.15, 7.30, 14), (47.33, 2.83, 6), (47.40, 0.85, 10), (47.25, -0.20, 12), (47.10, -1.40, 12),
    (45.69, -0.33, 18), (43.40, 3.20, 35), (42.65, 2.80, 15), (43.45, 6.20, 20), (46.75, 5.60, 8), (45.55, 5.95, 6),
    (44.45, 1.30, 8), (43.90, 1.90, 8), (42.60, 9.35, 6),
]
ROUTES_ROYALES_3 = [   # les grandes routes de poste partant de Paris, et quelques transversales
    ['Paris', 'Orléans', 'Blois', 'Tours', 'Poitiers', 'Angoulême', 'Bordeaux'],
    ['Paris', 'Melun', 'Sens', 'Auxerre', 'Dijon', 'Chalon-sur-Saône', 'Mâcon', 'Lyon'],
    ['Lyon', 'Vienne', 'Valence', 'Montélimar', 'Orange', 'Avignon', 'Aix-en-Provence', 'Marseille'],
    ['Aix-en-Provence', 'Brignoles', 'Toulon'], ['Aix-en-Provence', 'Fréjus', 'Antibes', 'Nice'],
    ['Paris', 'Senlis', 'Compiègne', 'Péronne', 'Arras', 'Lille'], ['Paris', 'Beauvais', 'Amiens', 'Abbeville', 'Boulogne-sur-Mer', 'Calais'],
    ['Paris', 'Pontoise', 'Rouen', 'Le Havre'], ['Rouen', 'Lisieux', 'Caen', 'Bayeux', 'Saint-Lô', 'Coutances'],
    ['Paris', 'Meaux', 'Château-Thierry', 'Épernay', 'Châlons-en-Champagne', 'Verdun', 'Metz'],
    ['Châlons-en-Champagne', 'Vitry-le-François', 'Saint-Dizier', 'Toul', 'Nancy', 'Lunéville', 'Saverne', 'Strasbourg'],
    ['Paris', 'Versailles', 'Chartres', 'Le Mans', 'Laval', 'Rennes', 'Saint-Brieuc', 'Morlaix', 'Brest'],
    ['Le Mans', 'Angers', 'Nantes'], ['Rennes', 'Vannes', 'Lorient', 'Quimper'],
    ['Paris', 'Étampes', 'Orléans', 'Vierzon', 'Châteauroux', 'Limoges', 'Brive-la-Gaillarde', 'Cahors', 'Montauban', 'Toulouse'],
    ['Toulouse', 'Castelnaudary', 'Carcassonne', 'Narbonne', 'Béziers', 'Montpellier', 'Nîmes', 'Avignon'], ['Narbonne', 'Perpignan'],
    ['Lyon', 'Bourg-en-Bresse'], ['Dijon', 'Dole', 'Besançon', 'Belfort', 'Mulhouse', 'Colmar', 'Strasbourg'],
    ['Lyon', 'Roanne', 'Moulins', 'Nevers', 'Montargis', 'Fontainebleau', 'Paris'], ['Lyon', 'Bourgoin-Jallieu', 'Grenoble'],
    ['Clermont-Ferrand', 'Riom', 'Moulins'], ['Paris', 'Provins', 'Troyes', 'Chaumont', 'Langres', 'Dijon'],
    ['Lille', 'Douai', 'Cambrai', 'Saint-Quentin', 'Laon', 'Reims', 'Châlons-en-Champagne'],
]
MARAIS_3 = [(46.35, -1.00, 18), (43.55, 4.55, 20), (47.35, -2.25, 8), (46.00, 5.00, 15), (46.90, -2.00, 10), (49.30, -1.20, 9)]


def _h(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, y, seed):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = _h(ix, iy, seed), _h(ix + 1, iy, seed)
    c, d = _h(ix, iy + 1, seed), _h(ix + 1, iy + 1, seed)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def fbm(x, y, seed, octaves=3):
    t, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        t += vnoise(x, y, seed + o * 17) * amp
        norm += amp
        amp *= 0.5
        x *= 2.03
        y *= 2.03
    return t / norm


def _dseg(y, x, ay, ax, by, bx):
    """Distance du point (y, x) au segment a-b (mêmes unités)."""
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(ax + dx * t - x, ay + dy * t - y)


def slugify(name):
    rep = str.maketrans("éèêëàâäîïôöûüùçœÉÈÊÀÂÎÔÛÇ' -", "eeeeaaaiioouuucoEEEAAIOUC___")
    return ''.join(ch for ch in name.translate(rep).lower() if ch.isalnum() or ch == '_')


def _seg_inter(p1, p2, p3, p4):
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = p1, p2, p3, p4
    d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
    if abs(d) < 1e-12:
        return None
    t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
    u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
    if 0 <= t <= 1 and 0 <= u <= 1:
        return t, (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    return None


def _proj(p, line):
    """(distance, abscisse) du point le plus proche de p sur la polyligne line."""
    best, s0 = (1e18, 0.0), 0.0
    for q, r in zip(line, line[1:]):
        dx, dy = r[0] - q[0], r[1] - q[1]
        L = math.hypot(dx, dy)
        t = max(0.0, min(1.0, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / (L * L or 1)))
        d = math.hypot(q[0] + dx * t - p[0], q[1] + dy * t - p[1])
        if d < best[0]:
            best = (d, s0 + t * L)
        s0 += L
    return best


def _jusqua(line, s):
    """La polyligne line du début jusqu'à l'abscisse s."""
    out, s0 = [line[0]], 0.0
    for q, r in zip(line, line[1:]):
        L = math.dist(q, r)
        if s0 + L >= s:
            t = (s - s0) / (L or 1)
            out.append((q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t))
            return out
        out.append(r)
        s0 += L
    return out


def _troncs(paires, paths, ecart=0.35, mini=0.5):
    """Deux routes qui sortent d'une même ville côte à côte (moins de 0,35 km l'une de l'autre) se dessinaient en
    double : la seconde reprend le tracé de la première (royales d'abord) jusqu'où elles se séparent, puis bifurque.
    paths : les tracés de chaque paire (a, b), modifiés sur place."""
    ordre = sorted(range(len(paires)), key=lambda k: (not paires[k][1]['royal'], k))
    faits = {}    # lieu -> tracés déjà posés qui en partent, orientés depuis lui
    for k in ordre:
        (a, b), info = paires[k]
        if info['ferry']:
            continue
        for bout, autre in ((a, b), (b, a)):
            line = paths[k] if bout == a else paths[k][::-1]
            # échantillons tous les 100 m depuis le lieu : jusqu'où la route longe une route déjà posée
            ech, s = [], 0.0
            for q, r in zip(line, line[1:]):
                L = math.dist(q, r)
                n = max(1, int(L / 0.1))
                for i in range(n):
                    ech.append((s + L * i / n, (q[0] + (r[0] - q[0]) * i / n, q[1] + (r[1] - q[1]) * i / n)))
                s += L
            meilleur = None
            for f in faits.get(bout, ()):
                fin = None
                for se, p in ech[1:]:
                    d, sf = _proj(p, f)
                    if d > ecart:
                        break
                    fin = (se, sf)
                if fin and fin[0] >= mini and (not meilleur or fin[0] > meilleur[0][0]):
                    meilleur = (fin, f)
            if meilleur:
                (se, sf), f = meilleur
                reste = [p for s2, p in ech if s2 > se + 0.05] + [line[-1]]
                line = _jusqua(f, sf) + reste
                paths[k] = line if bout == a else line[::-1]
            faits.setdefault(bout, []).append(line)


class GeoMap:
    def __init__(self, version=VERSION):
        self.version = version
        self.suffixe = '' if version == VERSION else f'_v{version}'
        with open(os.path.join(DATA_DIR, f'geo{self.suffixe}.json'), encoding='utf-8') as f:
            self.src = json.load(f)
        b = self.src['bounds']
        self.lon0, self.lon1, self.lat0, self.lat1 = b['lon0'], b['lon1'], b['lat0'], b['lat1']
        self.KX = 111.32 * math.cos(math.radians(self.src.get('lat_ref', LAT_REF)))   # (le parallèle de référence de la carte)
        KX = self.KX
        self.playable_codes = {c for c, d in self.src['depts'].items() if d.get('playable')}
        self.W = int(math.ceil((self.lon1 - self.lon0) * KX))
        self.H = int(math.ceil((self.lat1 - self.lat0) * KY))
        self.dept_codes = sorted(self.src['depts'].keys())
        self._build_nodes()
        self._load_or_generate()
        from . import waterways
        waterways.build(self)
        self.adj = {i: [] for i in range(len(self.nodes))}
        for e in self.edges:
            self.adj[e['a']].append(e['id'])
            self.adj[e['b']].append(e['id'])
        # la numérotation des arêtes (gardée dans les sauvegardes : arête et chemin des armées) ; views.recaler si elle change
        self.empreinte = hashlib.sha1(repr([(e['a'], e['b'], e.get('way')) for e in self.edges]).encode()).hexdigest()[:16]

    # ------------------------------------------------------------ projection
    def xy(self, lat, lon):
        return ((lon - self.lon0) * self.KX, (self.lat1 - lat) * KY)

    def lat_of(self, y):
        return self.lat1 - y / KY

    def lon_of(self, x):
        return self.lon0 + x / self.KX

    def cell(self, x, y):
        i, j = int(x), int(y)
        if 0 <= i < self.W and 0 <= j < self.H:
            return j * self.W + i
        return -1

    def terrain_at(self, x, y):
        c = self.cell(x, y)
        return self.terrain[c] if c >= 0 else T_OCEAN

    def playable_at(self, x, y):
        c = self.cell(x, y)
        if c < 0:
            return False
        d = self.dept[c]
        return d > 0 and self.dept_codes[d - 1] in self.playable_codes and self.terrain[c] > T_EAU

    def dept_at(self, x, y):
        c = self.cell(x, y)
        if c < 0 or self.dept[c] == 0:
            return None
        return self.dept_codes[self.dept[c] - 1]

    # ------------------------------------------------------------ nœuds
    def _build_nodes(self):
        self.nodes = []
        self.by_name = {}
        for k, (name, lat, lon, dept, typ, spec, fort) in enumerate(PLACES):
            x, y = self.xy(*self.src.get('places', {}).get(name, (lat, lon)))   # (une ancienne géographie : la place d'alors)
            n = dict(id=k, slug=slugify(name), name=name, x=round(x, 2), y=round(y, 2), dept=dept,
                     type=typ, spec=list(spec), fort=fort)
            if name in CITY_SPECIALTIES:
                n['star'] = list(CITY_SPECIALTIES[name])   # spécialité phare : [type, nom]
            # population de départ : chiffres d'époque pour les villes, 300 à 1 600 âmes pour un village
            h = int(hashlib.sha1(name.encode()).hexdigest()[:6], 16)
            n['pop0'] = CITY_POP.get(name, 300 + (h % 1301))
            self.nodes.append(n)
            self.by_name[name] = k
        # (géographie 3) les places des autres départements, générées par outils/france.py, avec leur population
        if self.version >= 3:
            with open(os.path.join(DATA_DIR, 'places_france.json'), encoding='utf-8') as f:
                gen = json.load(f)
            slugs = {n['slug'] for n in self.nodes}
            for name, lat, lon, dept, typ, spec, fort, pop0 in gen:
                k = len(self.nodes)
                x, y = self.xy(lat, lon)
                slug = slugify(name)
                if slug in slugs:   # (homonymes d'un département à l'autre : Saint-Martin, Langon…)
                    slug = f'{slug}-{dept.lower()}'
                slugs.add(slug)
                self.nodes.append(dict(id=k, slug=slug, name=name, x=round(x, 2), y=round(y, 2), dept=dept, type=typ,
                                       spec=list(spec), fort=fort, pop0=pop0))
                if name in SPECIALITES.get(dept, ()):
                    self.nodes[-1]['star'] = list(SPECIALITES[dept][name])   # spécialité phare (game/regions.py)
                self.by_name.setdefault(name, k)   # (les noms des tables, Sud-Ouest d'abord : la place écrite à la main)

    # ------------------------------------------------------------ cache
    def _src_hash(self):
        h = hashlib.sha1()
        h.update(json.dumps(self.src, sort_keys=True).encode())
        h.update(repr(PLACES).encode())
        if self.version >= 3:
            with open(os.path.join(DATA_DIR, 'places_france.json'), 'rb') as f:
                h.update(f.read())
        h.update(repr(ROYAL_ROUTES).encode())
        h.update(repr(EXTRA_ROADS).encode())
        h.update(repr(EXTRA_ROADS_2 + NO_ROADS_2).encode())
        h.update(str(CACHE_VERSION).encode())
        with open(os.path.abspath(__file__), 'rb') as f:
            h.update(f.read())
        return h.hexdigest()

    def _load_or_generate(self):
        path = os.path.join(DATA_DIR, f'map_cache{self.suffixe}.json')
        hsh = self._src_hash()
        if os.path.exists(path):
            try:
                with open(path, encoding='utf-8') as f:
                    c = json.load(f)
                if c.get('hash') == hsh:
                    self.terrain = bytearray(base64.b64decode(c['terrain']))
                    self.dept = bytearray(base64.b64decode(c['dept']))
                    self.river = bytearray(base64.b64decode(c['river']))
                    self.road = bytearray(base64.b64decode(c['road']))
                    self.cellnode = _h16(base64.b64decode(c['cellnode']))
                    self.edges = c['edges']
                    return
            except Exception:
                pass
        self._generate()
        c = dict(hash=hsh,
                 terrain=base64.b64encode(bytes(self.terrain)).decode(),
                 dept=base64.b64encode(bytes(self.dept)).decode(),
                 river=base64.b64encode(bytes(self.river)).decode(),
                 road=base64.b64encode(bytes(self.road)).decode(),
                 cellnode=base64.b64encode(_b16(self.cellnode)).decode(),
                 edges=self.edges)
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(c, f)
        except OSError:
            pass

    # ------------------------------------------------------------ génération
    def _rings_xy(self, rings):
        return [[self.xy(lat, lon) for lon, lat in r] for r in rings]

    def _raster_ring(self, ring, fn):
        W, H = self.W, self.H
        ys = [p[1] for p in ring]
        j0, j1 = max(0, int(min(ys))), min(H - 1, int(max(ys)) + 1)
        n = len(ring)
        for j in range(j0, j1 + 1):
            yc = j + 0.5
            xs = []
            for k in range(n):
                x1, y1 = ring[k]
                x2, y2 = ring[(k + 1) % n]
                if (y1 <= yc) != (y2 <= yc):
                    xs.append(x1 + (yc - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for a, b in zip(xs[0::2], xs[1::2]):
                i0 = max(0, int(math.ceil(a - 0.5)))
                i1 = min(W - 1, int(math.floor(b - 0.5)))
                base = j * W
                for i in range(i0, i1 + 1):
                    fn(base + i)

    def _raster_line(self, pts, fn, step=0.35, f=1):
        """Les cases que la ligne traverse (f : cases par km)."""
        W, H = self.W * f, self.H * f
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            L = math.hypot(x2 - x1, y2 - y1)
            n = max(1, int(L / step))
            for s in range(n + 1):
                t = s / n
                i, j = int((x1 + (x2 - x1) * t) * f), int((y1 + (y2 - y1) * t) * f)
                if 0 <= i < W and 0 <= j < H:
                    fn(j * W + i)

    def _bfs(self, sources, maxd, passable=None, f=1):
        W, H = self.W * f, self.H * f
        dist = [255] * (W * H)
        q = list(sources)
        for c in q:
            dist[c] = 0
        head = 0
        while head < len(q):
            c = q[head]
            head += 1
            d = dist[c] + 1
            if d > maxd:
                continue
            i, j = c % W, c // W
            for ni, nj in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= ni < W and 0 <= nj < H:
                    nc = nj * W + ni
                    if dist[nc] > d and (passable is None or passable(nc)):
                        dist[nc] = d
                        q.append(nc)
        return dist

    def _generate(self):
        W, H = self.W, self.H
        N = W * H
        self.dept = bytearray(N)
        for idx, code in enumerate(self.dept_codes):
            for ring in self._rings_xy(self.src['depts'][code]['rings']):
                def setd(c, v=idx + 1):
                    self.dept[c] = v
                self._raster_ring(ring, setd)

        # bouche les trous de rastérisation (cellules isolées hors département)
        outside = bytearray(N)
        q = [c for c in range(N) if self.dept[c] == 0 and (c % W in (0, W - 1) or c // W in (0, H - 1))]
        for c in q:
            outside[c] = 1
        k = 0
        while k < len(q):
            c = q[k]
            k += 1
            i, j = c % W, c // W
            for ni, nj in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= ni < W and 0 <= nj < H:
                    nc = nj * W + ni
                    if not outside[nc] and self.dept[nc] == 0:
                        outside[nc] = 1
                        q.append(nc)
        for _ in range(4):
            for c in range(N):
                if self.dept[c] == 0 and not outside[c]:
                    i, j = c % W, c // W
                    for ni, nj in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                        if 0 <= ni < W and 0 <= nj < H and self.dept[nj * W + ni]:
                            self.dept[c] = self.dept[nj * W + ni]
                            break

        water = bytearray(N)  # 1 = lac/estuaire/bassin
        estuary = []
        for w in self.src['waters']:
            ring = [self.xy(lat, lon) for lon, lat in w['ring']]
            acc = []
            self._raster_ring(ring, acc.append)
            for c in acc:
                water[c] = 1
            if 'Gironde' in w['name']:
                estuary = acc

        y_spain = self.xy(43.36, 0)[1]
        hors = bytearray(N)   # (géographie 3) les terres des pays voisins, hors du jeu
        for l in self.src.get('lands', []):
            def seth(c):
                hors[c] = 1
            self._raster_ring([self.xy(lat, lon) for lon, lat in l['ring']], seth)
        terrain = bytearray(N)
        ocean_src = []
        for c in range(N):
            j = c // W
            if water[c]:
                terrain[c] = T_EAU
            elif self.dept[c] == 0:
                if self.version >= 3:
                    if hors[c]:
                        terrain[c] = T_PLAINE
                    else:
                        terrain[c] = T_OCEAN
                        ocean_src.append(c)
                elif j + 0.5 > y_spain and (c % W) > 3:
                    terrain[c] = T_PLAINE  # Espagne (hors jeu)
                else:
                    terrain[c] = T_OCEAN
                    ocean_src.append(c)
            else:
                terrain[c] = T_PLAINE
        # Espagne : marquée hors jeu par dept=0 (déjà)

        d_ocean = self._bfs(ocean_src, 12, lambda c: terrain[c] != T_OCEAN)
        d_estu = self._bfs(estuary, 8, lambda c: terrain[c] not in (T_OCEAN, T_EAU))

        # Rivières
        self.river = bytearray(N)
        adour = []
        for r in self.src['rivers']:
            pts = [self.xy(lat, lon) for lon, lat in r['pts']]
            lvl = {1: 3, 2: 2, 3: 1}[r['rank']]

            def setr(c, v=lvl):
                if self.river[c] < v:
                    self.river[c] = v
            self._raster_line(pts, setr)
            if r['name'] == 'Adour':
                self._raster_line(pts, adour.append)
        d_adour = self._bfs(adour, 3)
        d_riv = self._bfs([c for c in range(N) if self.river[c]], 5)

        landes = [self.xy(lat, lon) for lat, lon in LANDES_POLY]
        in_landes = bytearray(N)

        def setl(c):
            in_landes[c] = 1
        self._raster_ring(landes, setl)

        forests = [(self.xy(la, lo), r, d) for la, lo, r, d in FORESTS + (FORETS_3 if self.version >= 3 else [])]
        vines = [(self.xy(la, lo), r) for la, lo, r in VINEYARDS + (VIGNES_3 if self.version >= 3 else [])]
        marais3 = [(self.xy(la, lo), r) for la, lo, r in MARAIS_3]

        for c in range(N):
            t = terrain[c]
            if t in (T_OCEAN, T_EAU):
                continue
            i, j = c % W, c // W
            x, y = i + 0.5, j + 0.5
            lat, lon = self.lat_of(y), self.lon_of(x)
            v3 = self.version >= 3
            e = (self._elev3(lat, lon) if v3 else self._elev(lat, lon)) + (fbm(x / 22, y / 22, 11, 4) - 0.5) * 0.42
            if lat < 43.35 or (v3 and e > 0.8):   # (les vallées des montagnes sont creusées par leurs rivières)
                e -= 0.6 * math.exp(-(d_riv[c] / 2.6) ** 2)
            elif not v3:
                e = min(e, 0.78)
            if e > 1.55:
                terrain[c] = T_HAUTE
                continue
            if e > 0.80:
                terrain[c] = T_MONTAGNE
                continue
            t = T_COLLINES if e > 0.42 else T_PLAINE
            n1 = fbm(x / 7, y / 7, 3)
            do = d_ocean[c]
            aquit = not v3 or (lon < -0.9 and lat < 45.65)   # (géographie 3 : les dunes et la forêt du littoral aquitain)
            if do <= 2 and lat > 43.55 and (aquit or (lat > 50.2 and lon < 2.6) or (46.0 < lat < 46.9 and lon < -1.2)):
                terrain[c] = T_DUNES
                continue
            if do <= 7 and lat > 43.6 and n1 > 0.22 and aquit:
                terrain[c] = T_FORET
                continue
            if in_landes[c]:
                n2 = fbm(x / 9, y / 9, 5)
                if n2 > 0.60:
                    t = T_FORET
                elif n2 < 0.33:
                    t = T_MARAIS
                else:
                    t = T_LANDE
            if d_estu[c] <= 1:
                t = T_MARAIS
            elif d_estu[c] <= 6 and lon < -0.6 and lat > 44.95 and lat < 45.35:
                t = T_VIGNE if n1 > 0.3 else T_PLAINE
            if d_adour[c] <= 2 and lon < -0.55 and t in (T_PLAINE, T_LANDE):
                t = T_MARAIS if n1 > 0.35 else t
            if v3 and t in (T_PLAINE, T_COLLINES):
                for (mx, my), r in marais3:
                    if math.hypot(x - mx, y - my) < r and n1 > 0.3:
                        t = T_MARAIS
                        break
            if t in (T_PLAINE, T_COLLINES):
                for (fx, fy), r, dens in forests:
                    dd = math.hypot(x - fx, y - fy)
                    if dd < r and fbm(x / 5, y / 5, 7) < dens * (1 - 0.5 * dd / r) + 0.15:
                        t = T_FORET
                        break
            if t in (T_PLAINE, T_COLLINES):
                for (vx, vy), r in vines:
                    if math.hypot(x - vx, y - vy) < r and fbm(x / 4, y / 4, 9) > 0.42:
                        t = T_VIGNE
                        break
            if t in (T_PLAINE, T_COLLINES) and fbm(x / 6, y / 6, 13) > 0.70:
                t = T_FORET
            terrain[c] = t

        # Les villes sont en plaine (vallées), jamais dans l'eau
        for n in self.nodes:
            ci, cj = int(n['x']), int(n['y'])
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    c = self.cell(ci + di, cj + dj)
                    if c < 0:
                        continue
                    if di == 0 and dj == 0:
                        terrain[c] = T_PLAINE if terrain[c] in (T_OCEAN, T_EAU, T_MONTAGNE, T_HAUTE, T_MARAIS, T_DUNES) else terrain[c]
                        if self.dept[c] == 0:
                            self.dept[c] = self.dept_codes.index(n['dept']) + 1
                    elif terrain[c] in (T_MONTAGNE, T_HAUTE):
                        terrain[c] = T_COLLINES
        self.terrain = terrain
        self._build_roads()
        self._build_cellnode()

    @staticmethod
    def _elev(lat, lon):
        e = 0.0
        if lon > -1.0:
            base = 43.20 + 0.03 * (lon + 1.0) + 0.05 * math.sin(lon * 7.3) + 0.03 * math.sin(lon * 19.0 + 1.0)
            e += max(0.0, base - lat) / 0.21
        else:
            base = 43.36 + 0.04 * math.sin(lon * 9.0)
            e += max(0.0, base - lat) / 0.30
            if lat < 43.45:
                e += 0.18
        # Périgord / Limousin
        e += 0.62 * min(1, max(0, (lat - 44.95) / 0.55)) * min(1, max(0, (lon - 0.35) / 0.8))
        # Sarladais / Quercy
        e += 0.5 * math.exp(-(((lat - 44.82) / 0.22) ** 2 + ((lon - 1.18) / 0.30) ** 2))
        # Entre-deux-Mers
        e += 0.32 * math.exp(-(((lat - 44.72) / 0.12) ** 2 + ((lon + 0.22) / 0.22) ** 2))
        # Coteaux du Gers / Agenais sud
        e += 0.40 * min(1, max(0, (44.12 - lat) / 0.35)) * min(1, max(0, (lon - 0.05) / 0.25))
        # Chalosse / Tursan
        e += 0.40 * math.exp(-(((lat - 43.64) / 0.10) ** 2 + ((lon + 0.62) / 0.30) ** 2))
        # Haut-Agenais (nord du Lot)
        e += 0.34 * math.exp(-(((lat - 44.55) / 0.15) ** 2 + ((lon - 0.85) / 0.25) ** 2))
        return e

    @staticmethod
    def _elev3(lat, lon):
        """Le relief de toute la France : les Pyrénées et le Sud-Ouest de _elev (là seulement), les crêtes et les massifs."""
        cl = math.cos(math.radians(lat))
        sw = min(1.0, max(0.0, (1.9 - lon) / 0.5)) * min(1.0, max(0.0, (46.1 - lat) / 0.4))   # (le Sud-Ouest d'avant)
        # (le Sud-Ouest d'avant sans ses Pyrénées, qui montaient sans fin vers le sud : ici une ligne de crête, CRETES)
        if lon > -1.0:
            base = 43.20 + 0.03 * (lon + 1.0) + 0.05 * math.sin(lon * 7.3) + 0.03 * math.sin(lon * 19.0 + 1.0)
            pyr = max(0.0, base - lat) / 0.21
        else:
            pyr = max(0.0, 43.36 + 0.04 * math.sin(lon * 9.0) - lat) / 0.30 + (0.18 if lat < 43.45 else 0.0)
        e = max(0.0, GeoMap._elev(lat, lon) - pyr) * sw
        for amp, w, pts in CRETES:
            d = min(_dseg(lat, lon * cl, a[0], a[1] * cl, b[0], b[1] * cl) for a, b in zip(pts, pts[1:]))
            e += amp * math.exp(-(d / w) ** 2) + amp * 0.3 * math.exp(-(d / (w * 2.2)) ** 2)
        for la, lo, amp, r in MASSIFS:
            e += amp * math.exp(-(((lat - la) ** 2 + ((lon - lo) * cl) ** 2) / (r * r)))
        return e

    # ------------------------------------------------------------ routes
    def _water_on_segment(self, a, b, margin=1.2):
        (x1, y1), (x2, y2) = a, b
        L = math.hypot(x2 - x1, y2 - y1)
        n = max(2, int(L / 0.4))
        bad = 0
        for s in range(n + 1):
            t = s / n
            if t * L < margin or (1 - t) * L < margin:
                continue
            c = self.cell(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
            if c < 0 or self.terrain[c] in (T_OCEAN, T_EAU) or self.dept[c] == 0 \
                    or self.dept_codes[self.dept[c] - 1] not in self.playable_codes:
                bad += 1
            elif self.terrain[c] == T_HAUTE:
                bad += 0.25
        return bad

    def _build_roads(self):
        nodes = self.nodes
        P = [(n['x'], n['y']) for n in nodes]
        pairs = {}
        n = len(nodes)
        # le graphe de Gabriel des places à moins de 40 km : par cases de 20 km (toute la France : 2 000 places et plus)
        G = 20.0
        cases = {}
        for i, (x, y) in enumerate(P):
            cases.setdefault((int(x // G), int(y // G)), []).append(i)
        def proches(x, y, r):
            for ci in range(int((x - r) // G), int((x + r) // G) + 1):
                for cj in range(int((y - r) // G), int((y + r) // G) + 1):
                    yield from cases.get((ci, cj), ())
        for a in range(n):
            for b in proches(P[a][0], P[a][1], 40):
                if b <= a:
                    continue
                d = math.dist(P[a], P[b])
                if d > 40:
                    continue
                mx, my = (P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2
                r2 = (d / 2) ** 2
                if any(c != a and c != b and (P[c][0] - mx) ** 2 + (P[c][1] - my) ** 2 < r2 for c in proches(mx, my, d / 2)):
                    continue
                if self._water_on_segment(P[a], P[b]) < 1:
                    pairs[(a, b)] = dict(royal=False, ferry=False)
        if self.version >= 3:   # les grandes routes royales de la France : le plus court chemin du réseau, entre leurs villes
            self._ensure_connected(pairs, P)
            for route in ROUTES_ROYALES_3:
                ids = [self.by_name[nm] for nm in route if nm in self.by_name]
                for a, b in zip(ids, ids[1:]):
                    for k in self._chemin(pairs, P, a, b):
                        pairs[k]['royal'] = True
        for route in ROYAL_ROUTES:
            ids = [self.by_name[nm] for nm in route]
            for a, b in zip(ids, ids[1:]):
                k = (min(a, b), max(a, b))
                if k in pairs:
                    pairs[k]['royal'] = True
                # (géographie 2 : une route royale passe une case de côte, Bayonne – Saint-Jean-de-Luz)
                elif self._water_on_segment(P[a], P[b]) < (2 if self.version >= 2 else 1):
                    pairs[k] = dict(royal=True, ferry=False)
        for na, nb in EXTRA_ROADS + (EXTRA_ROADS_2 if self.version >= 2 else []):
            a, b = self.by_name[na], self.by_name[nb]
            k = (min(a, b), max(a, b))
            fer = (na, nb) in FERRIES or (nb, na) in FERRIES
            if fer or self._water_on_segment(P[a], P[b]) < 1:
                pairs.setdefault(k, dict(royal=False, ferry=fer))
                pairs[k]['ferry'] = fer
        for na, nb in NO_ROADS_2 if self.version >= 2 else []:
            a, b = self.by_name[na], self.by_name[nb]
            pairs.pop((min(a, b), max(a, b)), None)
        # élague les chemins redondants (un détour par une autre ville est presque aussi court)
        nb = {}
        for a, b in pairs:
            nb.setdefault(a, set()).add(b)
            nb.setdefault(b, set()).add(a)
        for (a, b), info in sorted(pairs.items(), key=lambda kv: -math.dist(P[kv[0][0]], P[kv[0][1]])):
            if info['royal'] or info['ferry']:
                continue
            d = math.dist(P[a], P[b])
            for c in nb[a] & nb[b]:
                if math.dist(P[a], P[c]) + math.dist(P[c], P[b]) < 1.13 * d:
                    nb[a].discard(b)
                    nb[b].discard(a)
                    info['drop'] = True
                    break
        for k in [k for k, v in pairs.items() if v.get('drop')]:
            del pairs[k]
        # connexité
        self._ensure_connected(pairs, P)

        rivers = []   # (nom, rang, morceaux de 48 segments avec leur emprise : on ne cherche l'eau que là où passe la route)
        for r in self.src['rivers']:
            if r['rank'] <= 2:
                pts = [self.xy(lat, lon) for lon, lat in r['pts']]
                parts = [pts[k:k + 49] for k in range(0, len(pts) - 1, 48)]
                rivers.append((r['name'], r['rank'], [(q, min(x for x, _ in q), min(y for _, y in q), max(x for x, _ in q),
                                                       max(y for _, y in q)) for q in parts]))

        def coupes(p1, p2):   # où le segment p1-p2 coupe les rivières : (nom, rang, point), rivière par rivière
            x0, y0, x1, y1 = min(p1[0], p2[0]), min(p1[1], p2[1]), max(p1[0], p2[0]), max(p1[1], p2[1])
            for name, rank, parts in rivers:
                for pts, a, b, c, d in parts:
                    if a <= x1 and c >= x0 and b <= y1 and d >= y0:
                        for p, q in zip(pts, pts[1:]):
                            if it := _seg_inter(p1, p2, p, q):
                                yield name, rank, it[1]

        def crossing(path, pair=()):
            best = None
            for p1, p2 in zip(path, path[1:]):
                for name, rank, it in coupes(p1, p2):
                    if (best is None or rank < best[1]) and name not in pair:
                        best = (name, rank, it)
            return best

        def pair(path):   # (géographie 2) les rivières que la ligne coupe un nombre pair de fois : leurs méandres, sans passage
            n = {name: 0 for name, _, _ in rivers}
            for p1, p2 in zip(path, path[1:]):
                for name, _, _ in coupes(p1, p2):
                    n[name] += 1
            return {k for k, v in n.items() if v % 2 == 0}

        edges = []
        self.road = bytearray(self.W * self.H)
        cost = {False: self._road_costs(0.4), True: self._road_costs(0.0)}   # routes royales : tirées au cordeau
        paires = sorted(pairs.items())
        paths = [[P[a], P[b]] if info['ferry'] else self._road_path(P[a], P[b], cost[info['royal']]) for (a, b), info in paires]
        if self.version >= 2:
            _troncs(paires, paths)
        for eid, ((a, b), info) in enumerate(paires):
            d = math.dist(P[a], P[b])
            e = dict(id=eid, a=a, b=b, len=info.get('len', round(d * 1.12, 2)), royal=info['royal'], ferry=info['ferry'],
                     river=None, rrank=0, cx=None, cy=None)
            # le jeu (rivière à franchir, longueur) reste celui de la ligne droite ; seul le tracé dessiné change
            best = crossing([P[a], P[b]], pair([P[a], P[b]]) if self.version >= 2 else ())
            path = paths[eid]
            if info['ferry']:
                e['river'], e['rrank'] = 'Mer' if info.get('mer') else 'Gironde', 1
                e['cx'], e['cy'] = round((P[a][0] + P[b][0]) / 2, 2), round((P[a][1] + P[b][1]) / 2, 2)
            elif best:
                e['river'], e['rrank'] = best[0], best[1]
                e['cx'], e['cy'] = round(best[2][0], 2), round(best[2][1], 2)
            # le pont dessiné, là où le tracé franchit l'eau (cx, cy : le passage pour les règles)
            if info['ferry']:
                e['bx'], e['by'] = e['cx'], e['cy']
            elif best and (on := crossing(path, {r[0] for r in rivers} - {best[0]} if self.version >= 2 else ()) or crossing(path)):
                # (géographie 2 : le pont dessiné est celui de la rivière de la règle, s'il est sur le tracé)
                e['bx'], e['by'] = round(on[2][0], 2), round(on[2][1], 2)
                # (les autres grandes rivières que le tracé passe, une fois chacune : leurs ponts ou leurs bacs ; la règle du
                # passage reste celle de la ligne droite)
                e['ponts'] = []
                for p1, p2 in zip(path, path[1:]):
                    for name, rank, it in coupes(p1, p2):
                        if name != on[0] and name not in [q[2] for q in e['ponts']]:
                            e['ponts'].append([round(it[0], 2), round(it[1], 2), name, rank])
            e['pts'] = [[round(x, 2), round(y, 2)] for x, y in path]
            edges.append(e)

            def setroad(c):
                self.road[c] = 1
            self._raster_line(path, setroad, 0.3)
        self.edges = edges

    @staticmethod
    def _chemin(pairs, P, a, b):
        """Les arêtes (clés de pairs) du plus court chemin de a à b dans le réseau des routes."""
        nb = {}
        for (u, v) in pairs:
            nb.setdefault(u, []).append(v); nb.setdefault(v, []).append(u)
        dist, prev, pq = {a: 0.0}, {}, [(0.0, a)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == b:
                break
            if d > dist[u]:
                continue
            for v in nb.get(u, ()):
                nd = d + math.dist(P[u], P[v])
                if nd < dist.get(v, 1e18):
                    dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
        out, u = [], b
        while u in prev:
            out.append((min(u, prev[u]), max(u, prev[u]))); u = prev[u]
        return out

    def _route_f(self):
        """La grille des tracés de routes : f cases par km et les rivières qui y passent. Géographie 2 : à la demi-case, pour
        que les routes passent entre les méandres serrés (Libourne) au lieu de les contourner."""
        f = 2 if self.version >= 2 else 1
        if f == 1:
            return f, self.river
        if '_rivf' not in self.__dict__:
            riv = self._rivf = bytearray(self.W * self.H * f * f)
            for r in self.src['rivers']:
                def setr(c, v={1: 3, 2: 2, 3: 1}[r['rank']]):
                    if riv[c] < v:
                        riv[c] = v
                self._raster_line([self.xy(lat, lon) for lon, lat in r['pts']], setr, 0.35 / f, f)
        return f, self._rivf

    def _road_costs(self, wobble):
        """Coût d'une cellule pour tracer une route : le relief, l'eau à éviter (on ne la franchit qu'une fois, sur un
        pont), les berges, et un bruit doux pour que les routes ondulent au lieu d'aller à la règle."""
        f, riv = self._route_f()
        W, N = self.W * f, self.W * self.H * f * f
        near = self._bfs([c for c in range(N) if riv[c] >= 2], 2, f=f)
        terr = {T_PLAINE: 1.0, T_VIGNE: 1.0, T_LANDE: 1.1, T_FORET: 1.3, T_COLLINES: 1.5, T_DUNES: 2.0,
                T_MARAIS: 2.5, T_MONTAGNE: 2.4, T_HAUTE: 4.0}
        bruit = [vnoise(c % self.W / 7, c // self.W / 7, 91) for c in range(self.W * self.H)] if wobble else None   # (au km)
        cost = [0.0] * N
        for c in range(N):
            i, j = c % W, c // W
            c1 = j // f * self.W + i // f   # (la case du km : terrain, département, bruit)
            t = self.terrain[c1]
            k = terr.get(t, 40.0) if self.dept[c1] and self.dept_codes[self.dept[c1] - 1] in self.playable_codes else 40.0
            k += (25.0, 10.0, 3.0)[3 - riv[c]] if riv[c] else (1.5, 0.4, 0.0)[near[c] - 1] if near[c] <= 2 else 0.0
            cost[c] = k * (1 - wobble / 2 + wobble * bruit[c1]) if wobble else k
        return cost

    def _road_path(self, A, B, cost):
        """Tracé d'une route de A à B : A* sur la grille (coûts de _road_costs), puis simplifié et lissé."""
        fr, riv = self._route_f()
        W, H = self.W * fr, self.H * fr
        si, sj, gi, gj = int(A[0] * fr), int(A[1] * fr), int(B[0] * fr), int(B[1] * fr)
        m = max(6, int(0.35 * math.dist(A, B))) * fr
        i0, i1 = max(0, min(si, gi) - m), min(W - 1, max(si, gi) + m)
        j0, j1 = max(0, min(sj, gj) - m), min(H - 1, max(sj, gj) + m)
        start, goal = sj * W + si, gj * W + gi
        g = {start: 0.0}
        prev = {}
        pq = [(0.0, start)]
        while pq:
            f, c = heapq.heappop(pq)
            if c == goal:
                break
            i, j = c % W, c // W
            for di, dj, s in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1),
                              (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)):
                ni, nj = i + di, j + dj
                if not (i0 <= ni <= i1 and j0 <= nj <= j1):
                    continue
                n = nj * W + ni
                k = cost[n] if n != goal else 1.0
                if di and dj:    # en diagonale, on ne se glisse pas entre deux cases d'un fleuve
                    k = max(k, cost[j * W + ni], cost[nj * W + i])
                ng = g[c] + s * k
                if ng < g.get(n, 1e18):
                    g[n] = ng
                    prev[n] = c
                    heapq.heappush(pq, (ng + 0.85 * math.hypot(gi - ni, gj - nj), n))
        if goal not in prev and goal != start:
            return [A, B]
        cells = [goal]
        while cells[-1] != start:
            cells.append(prev[cells[-1]])
        cells.reverse()
        pts = [A] + [((c % W + 0.5) / fr, (c // W + 0.5) / fr) for c in cells[1:-1]] + [B]

        def cel(x, y):
            i, j = int(x * fr), int(y * fr)
            return j * W + i if 0 <= i < W and 0 <= j < H else -1

        def along(p, q):    # coût d'un segment droit, échantillonné tous les 0,25 km
            n = max(1, int(math.dist(p, q) / 0.25))
            return sum(cost[cel(p[0] + (q[0] - p[0]) * (s + 0.5) / n, p[1] + (q[1] - p[1]) * (s + 0.5) / n)]
                       for s in range(n)) * math.dist(p, q) / n
        seg = [along(p, q) for p, q in zip(pts, pts[1:])]
        # corde tendue : du point i, on va en ligne droite au point le plus loin qui ne coûte guère plus que le
        # chemin de la grille ; les routes perdent ainsi les angles à 45° et 90° de la grille
        out, i = [pts[0]], 0
        while i < len(pts) - 1:
            k, run = i + 1, seg[i]
            for j in range(i + 2, len(pts)):
                run += seg[j - 1]
                if along(pts[i], pts[j]) <= 1.01 * run + 0.1:
                    k = j
            out.append(pts[k])
            i = k
        pts = out

        def wet(line):    # échantillons sur un fleuve : le lissage ne doit pas en ajouter
            n = [0]

            def f(c):
                n[0] += riv[c] >= 2
            self._raster_line(line, f, 0.3 / fr, fr)
            return n[0]
        smooth = pts
        for _ in range(3):    # Chaikin : coins arrondis, extrémités fixes
            smooth = [smooth[0]] + [q for p, r in zip(smooth, smooth[1:])
                                    for q in ((0.75 * p[0] + 0.25 * r[0], 0.75 * p[1] + 0.25 * r[1]),
                                              (0.25 * p[0] + 0.75 * r[0], 0.25 * p[1] + 0.75 * r[1]))][1:-1] + [smooth[-1]]
        return smooth if wet(smooth) <= wet(pts) else pts

    def _ensure_connected(self, pairs, P):
        if self.version >= 3:
            return self._relier(pairs, P)
        n = len(P)
        while True:
            parent = list(range(n))

            def find(x):
                while parent[x] != x:
                    parent[x] = parent[parent[x]]
                    x = parent[x]
                return x
            for a, b in pairs:
                parent[find(a)] = find(b)
            roots = {find(i) for i in range(n)}
            if len(roots) == 1:
                return
            best = None
            for a in range(n):
                for b in range(n):
                    if find(a) != find(b):
                        d = math.dist(P[a], P[b])
                        if (best is None or d < best[0]) and self._water_on_segment(P[a], P[b]) < 1:
                            best = (d, a, b)
            if best is None:
                return
            _, a, b = best
            pairs[(min(a, b), max(a, b))] = dict(royal=False, ferry=False)

    def _relier(self, pairs, P):
        """(géographie 3) Relie les morceaux du réseau : le plus petit d'abord, à la place la plus proche d'un autre morceau (à moins de
        60 km, sans eau entre elles en ligne droite, sinon par un chemin de terre : vallée ou col, plus long) ; une île, par un bac
        de moins de 20 km (Ré, Oléron, Groix, Belle-Île…) ; la Corse reste à part (le cabotage la relie)."""
        n = len(P)
        G = 20.0
        cases = {}
        for i, (x, y) in enumerate(P):
            cases.setdefault((int(x // G), int(y // G)), []).append(i)
        isoles = set()
        while True:
            parent = list(range(n))

            def find(x):
                while parent[x] != x:
                    parent[x] = parent[parent[x]]
                    x = parent[x]
                return x
            for a, b in pairs:
                parent[find(a)] = find(b)
            comps = {}
            for i in range(n):
                comps.setdefault(find(i), []).append(i)
            if len(comps) == 1:
                return
            relie = False
            for r, membres in sorted(comps.items(), key=lambda kv: len(kv[1])):
                if r in isoles or len(membres) == max(len(m) for m in comps.values()) and len(comps) - len(isoles) <= 1:
                    continue
                cand = []
                for a in membres:
                    x, y = P[a]
                    for ci in range(int((x - 60) // G), int((x + 60) // G) + 1):
                        for cj in range(int((y - 60) // G), int((y + 60) // G) + 1):
                            for b in cases.get((ci, cj), ()):
                                if find(b) != r:
                                    d = math.dist(P[a], P[b])
                                    if d < 60:
                                        cand.append((d, a, b))
                cand.sort()
                ok = None
                for d, a, b in cand:   # la plus proche : en ligne droite, sinon par la terre (vallée, col), plus longue
                    if self._water_on_segment(P[a], P[b]) < 1:
                        ok = (a, b, dict(royal=False, ferry=False))
                    elif (L := self._par_terre(P[a], P[b])) is not None:
                        ok = (a, b, dict(royal=False, ferry=False, len=round(L * 1.05, 2)))
                    if ok:
                        break
                if not ok:   # une île : un bac vers la place la plus proche, à moins de 20 km
                    ok = next(((a, b, dict(royal=False, ferry=True, mer=True)) for d, a, b in cand if d < 20), None)
                if ok:
                    a, b, info = ok
                    pairs[(min(a, b), max(a, b))] = info
                    relie = True
                    break
                isoles.add(r)
            if not relie:
                return

    def _par_terre(self, A, B):
        """(géographie 3) Longueur du chemin de A à B par la terre de la carte, la haute montagne comptée double, une case de
        rivière ou de lac six fois (un pont, un bac) ; deux cases au plus de mer ou d'étranger, comptées quatre et trois fois
        (la côte et la frontière de la grille sont grossières : un bourg du rivage ou de la frontière tombe dans l'eau ou
        hors de France) ; None s'il n'y en a pas ou s'il fait plus de 2,5 fois la ligne droite (le tour d'une baie, un lac)."""
        W, d = self.W, math.dist(A, B)
        lim, m = 2.5 * d + 5, int(d / 2) + 5
        si, sj, gi, gj = int(A[0]), int(A[1]), int(B[0]), int(B[1])
        i0, i1, j0, j1 = max(0, min(si, gi) - m), min(W - 1, max(si, gi) + m), max(0, min(sj, gj) - m), min(self.H - 1, max(sj, gj) + m)
        poids = {T_HAUTE: 2.0, T_MONTAGNE: 1.4, T_MARAIS: 1.5, T_EAU: 6.0, T_OCEAN: 4.0}
        start, goal = sj * W + si, gj * W + gi
        g, prev, pq = {start: 0.0}, {}, [(d, start)]
        while pq:
            f, c = heapq.heappop(pq)
            if c == goal:
                n, mauvais = prev.get(c), 0
                while n is not None and n != start:
                    mauvais += self.terrain[n] == T_OCEAN or not self.dept[n]
                    n = prev.get(n)
                return g[c] if mauvais <= 2 else None
            if f > lim:
                return None
            i, j = c % W, c // W
            for di, dj, s in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)):
                ni, nj = i + di, j + dj
                if not (i0 <= ni <= i1 and j0 <= nj <= j1):
                    continue
                n = nj * W + ni
                k = poids.get(self.terrain[n], 1.0)
                if self.terrain[n] != T_OCEAN and (not self.dept[n] or self.dept_codes[self.dept[n] - 1] not in self.playable_codes):
                    k = 3.0
                ng = g[c] + s * k
                if ng < g.get(n, 1e18):
                    g[n] = ng
                    prev[n] = c
                    heapq.heappush(pq, (ng + math.hypot(gi - ni, gj - nj), n))
        return None

    def _build_cellnode(self):
        """Zone d'influence de chaque lieu : distance par la terre (l'eau sépare), dans son département."""
        W, H = self.W, self.H
        N = W * H
        cn = array('H', [NONE]) * N
        dist = [1e18] * N
        pq = []
        bonus = {'capitale': -6.0, 'ville': -3.0, 'village': 0.0, 'fort': 1.0}
        for n in self.nodes:
            c = self.cell(n['x'], n['y'])
            if c < 0:
                continue
            d0 = bonus[n['type']]
            if d0 < dist[c]:
                dist[c] = d0
                cn[c] = n['id']
                heapq.heappush(pq, (d0, c))
        D2 = math.sqrt(2)
        jit = [0.0] * N
        for c in range(N):
            jit[c] = 0.55 * fbm((c % W) / 5.0, (c // W) / 5.0, 23)
        while pq:
            d, c = heapq.heappop(pq)
            if d > dist[c]:
                continue
            dep = self.dept[c]
            i, j = c % W, c // W
            for di, dj, m in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, D2), (1, -1, D2), (-1, 1, D2), (-1, -1, D2)):
                ni, nj = i + di, j + dj
                if not (0 <= ni < W and 0 <= nj < H):
                    continue
                nc = nj * W + ni
                if self.dept[nc] != dep or self.terrain[nc] in (T_OCEAN, T_EAU):
                    continue
                nd = d + m * (0.75 + jit[nc])
                if nd < dist[nc]:
                    dist[nc] = nd
                    cn[nc] = cn[c]
                    heapq.heappush(pq, (nd, nc))
        # cellules isolées (îlots) : lieu le plus proche à vol d'oiseau
        self.cellnode = cn
        self._fill_cellnode_rest()

    def _fill_cellnode_rest(self):
        W, H = self.W, self.H
        by_dept = {}
        for n in self.nodes:
            by_dept.setdefault(self.dept_codes.index(n['dept']) + 1, []).append((n['id'], n['x'], n['y']))
        for c in range(W * H):
            if self.cellnode[c] != NONE:
                continue
            d = self.dept[c]
            if d == 0 or self.terrain[c] in (T_OCEAN, T_EAU) or d not in by_dept:
                continue
            x, y = c % W + 0.5, c // W + 0.5
            self.cellnode[c] = min(by_dept[d], key=lambda t: (t[1] - x) ** 2 + (t[2] - y) ** 2)[0]

    def node_of_cell(self, x, y):
        c = self.cell(x, y)
        if c < 0:
            return None
        v = self.cellnode[c]
        return None if v == NONE else v

    # ------------------------------------------------------------ A* hors route
    def cell_costs(self):
        """cell_cost de toutes les cellules, calculé une fois (la carte ne change pas) : la recherche de chemin y lit
        directement au lieu d'appeler cell_cost pour chaque voisin."""
        cc = self.__dict__.get('_ccost')
        if cc is None:
            cc = self._ccost = [self.cell_cost(c) for c in range(self.W * self.H)]
        return cc

    def cell_cost(self, c):
        t = self.terrain[c]
        sp = TERRAIN[t][1]
        if sp <= 0 or self.dept[c] == 0 or self.dept_codes[self.dept[c] - 1] not in self.playable_codes:
            return None
        cost = 1.0 / sp
        r = self.river[c]
        if r == 3 and not self.road[c]:
            return None
        if r == 3:
            cost += 6
        elif r == 2:
            cost += 2.5
        elif r == 1:
            cost += 0.8
        return cost

    def astar(self, sx, sy, gx, gy, max_nodes=120000, block=None):
        """Chemin à travers champs. block : terres interdites, une marque par lieu (indice de self.cellnode, 0 : libre ;
        voir army_actions.cell_mask). Une cellule marquée ne s'atteint que depuis une cellule de même marque :
        on peut sortir des terres où l'on se trouve, pas y entrer."""
        W, H = self.W, self.H
        s, g = self.cell(sx, sy), self.cell(gx, gy)
        ccost = self.cell_costs()
        if s < 0 or g < 0 or ccost[g] is None:
            return None
        cn = self.cellnode
        if block is not None and block[cn[g]]:
            return None
        gi, gj = g % W, g // W
        hmin = 1.0 / 0.70
        openh = [(0.0, s)]
        gs = {s: 0.0}
        came = {}
        seen = 0
        D2 = math.sqrt(2)
        nbrs = ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, D2), (1, -1, D2), (-1, 1, D2), (-1, -1, D2))
        pop, push, hypot, gget = heapq.heappop, heapq.heappush, math.hypot, gs.get
        while openh:
            f, c = pop(openh)
            if c == g:
                break
            seen += 1
            if seen > max_nodes:
                return None
            gc = gs[c]
            i, j = c % W, c // W
            bc = block[cn[c]] if block is not None else 0
            for di, dj, m in nbrs:
                ni, nj = i + di, j + dj
                if not (0 <= ni < W and 0 <= nj < H):
                    continue
                nc = nj * W + ni
                cc = ccost[nc]
                if cc is None:
                    if nc != s:
                        continue
                    cc = 2.0
                if block is not None:
                    bk = block[cn[nc]]
                    if bk:
                        if bk != bc:
                            continue
                        cc *= 3   # en sortant de terres fermées, au plus court
                ng = gc + cc * m
                if ng < gget(nc, 1e18):
                    gs[nc] = ng
                    came[nc] = c
                    hh = hypot(ni - gi, nj - gj) * hmin
                    push(openh, (ng + hh, nc))
        if g not in came and g != s:
            return None
        path = [g]
        while path[-1] != s:
            path.append(came[path[-1]])
        path.reverse()
        pts = [(c % W + 0.5, c // W + 0.5) for c in path]
        pts[0] = (sx, sy)
        pts[-1] = (gx, gy)
        return self._smooth(pts, block)

    def nearest_open(self, x, y, block, strict=True, max_nodes=40000):
        """Sortie de terres interdites (marques de block) : chemin lissé vers la cellule libre la plus proche
        en temps de marche, ou None. strict : sans passer par d'autres terres interdites que celles où l'on est."""
        W, H = self.W, self.H
        s = self.cell(x, y)
        if s < 0:
            return None
        cn = self.cellnode
        ccost = self.cell_costs()
        t0 = block[cn[s]]
        dist = {s: 0.0}
        came = {}
        pq = [(0.0, s)]
        seen = 0
        D2 = math.sqrt(2)
        while pq:
            d, c = heapq.heappop(pq)
            if d > dist[c]:
                continue
            if c != s and not block[cn[c]] and cn[c] != NONE:
                path = [c]
                while path[-1] != s:
                    path.append(came[path[-1]])
                path.reverse()
                pts = [(p % W + 0.5, p // W + 0.5) for p in path]
                pts[0] = (x, y)
                return self._smooth(pts, block if strict else None)
            seen += 1
            if seen > max_nodes:
                return None
            i, j = c % W, c // W
            for di, dj, m in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1),
                              (1, 1, D2), (1, -1, D2), (-1, 1, D2), (-1, -1, D2)):
                ni, nj = i + di, j + dj
                if not (0 <= ni < W and 0 <= nj < H):
                    continue
                nc = nj * W + ni
                cc = ccost[nc]
                if cc is None:
                    continue
                bk = block[cn[nc]]
                if strict and bk and bk != t0:
                    continue
                nd = d + cc * m
                if nd < dist.get(nc, 1e18):
                    dist[nc] = nd
                    came[nc] = c
                    heapq.heappush(pq, (nd, nc))
        return None

    def _line_ok(self, a, b, maxcost, block=None):
        L = math.dist(a, b)
        n = max(1, int(L / 0.5))
        t0 = 0
        if block is not None:
            c0 = self.cell(*a)
            t0 = block[self.cellnode[c0]] if c0 >= 0 else 0
        ccost = self.cell_costs()
        for s in range(1, n):
            t = s / n
            c = self.cell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            cc = ccost[c] if c >= 0 else None
            if cc is None or cc > maxcost + 0.01:
                return False
            if block is not None and block[self.cellnode[c]] not in (0, t0):
                return False   # le raccourci ne coupe pas par des terres interdites
        return True

    def _smooth(self, pts, block=None):
        if len(pts) <= 2:
            return pts
        costs = []
        ccost = self.cell_costs()
        for p in pts:
            c = self.cell(*p)
            cc = ccost[c] if c >= 0 else None
            costs.append(cc if cc is not None else 2.0)
        out = [pts[0]]
        i = 0
        while i < len(pts) - 1:
            j = i + 1
            mc = max(costs[i], costs[j])
            k = j
            while k + 1 < len(pts):
                mc2 = max(mc, costs[k + 1])
                if self._line_ok(pts[i], pts[k + 1], mc2, block):
                    k += 1
                    mc = mc2
                else:
                    break
            out.append(pts[k])
            i = k
        return out

    # ------------------------------------------------------------ export client
    def client_payload(self):
        depts = {}
        for code, d in self.src['depts'].items():
            depts[code] = dict(name=d['name'], playable=d['playable'],
                               rings=[[[round(x, 2), round(y, 2)] for x, y in r] for r in self._rings_xy(d['rings'])])
        rivers = [dict(name=r['name'], rank=r['rank'],
                       pts=[[round(c, 2) for c in self.xy(lat, lon)] for lon, lat in r['pts']]) for r in self.src['rivers']]
        waters = [dict(name=w['name'], ring=[[round(c, 2) for c in self.xy(lat, lon)] for lon, lat in w['ring']])
                  for w in self.src['waters']]
        return dict(W=self.W, H=self.H, lon0=self.lon0, lat1=self.lat1, KX=self.KX, KY=KY, playable=sorted(self.playable_codes),
                    y_mont=self.xy(43.2, 0)[1], x_cote=self.xy(44, -0.95)[0], y_spain=self.xy(43.36, 0)[1],
                    terrain=base64.b64encode(bytes(self.terrain)).decode(),
                    dept=base64.b64encode(bytes(self.dept)).decode(),
                    cellnode=base64.b64encode(_b16(self.cellnode)).decode(),   # (deux octets par case, petit-boutiste)
                    river=base64.b64encode(bytes(self.river)).decode(),
                    dept_codes=self.dept_codes, depts=depts, rivers=rivers, waters=waters,
                    nodes=self.nodes, edges=self.edges,
                    ways=[dict(name=w['name'], label=w['label'], sea=w['sea'],
                               pts=[[round(x, 2), round(y, 2)] for x, y in w['pts']]) for w in self.ways.values()],
                    terrain_names={k: v[0] for k, v in TERRAIN.items()})
