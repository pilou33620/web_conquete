"""Carte de l'Aquitaine : projection, grilles (terrain, départements, cours d'eau),
réseau routier et recherche de chemin hors route (A*).

Tout est calculé en kilomètres. Une cellule de grille = 1 km x 1 km.
Le résultat est mis en cache dans data/map_cache.json (régénéré si la source change).
"""
import base64
import hashlib
import heapq
import json
import math
import os

from .places import PLACES, ROYAL_ROUTES, EXTRA_ROADS, FERRIES

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
CACHE_VERSION = 7

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
PLAYABLE = ['33', '24', '40', '47', '64']

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


class GeoMap:
    def __init__(self):
        with open(os.path.join(DATA_DIR, 'geo.json'), encoding='utf-8') as f:
            self.src = json.load(f)
        b = self.src['bounds']
        self.lon0, self.lon1, self.lat0, self.lat1 = b['lon0'], b['lon1'], b['lat0'], b['lat1']
        self.W = int(math.ceil((self.lon1 - self.lon0) * KX))
        self.H = int(math.ceil((self.lat1 - self.lat0) * KY))
        self.dept_codes = sorted(self.src['depts'].keys())
        self._build_nodes()
        self._load_or_generate()
        self.adj = {i: [] for i in range(len(self.nodes))}
        for e in self.edges:
            self.adj[e['a']].append(e['id'])
            self.adj[e['b']].append(e['id'])

    # ------------------------------------------------------------ projection
    def xy(self, lat, lon):
        return ((lon - self.lon0) * KX, (self.lat1 - lat) * KY)

    def lat_of(self, y):
        return self.lat1 - y / KY

    def lon_of(self, x):
        return self.lon0 + x / KX

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
        return d > 0 and self.dept_codes[d - 1] in PLAYABLE and self.terrain[c] > T_EAU

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
            x, y = self.xy(lat, lon)
            n = dict(id=k, slug=slugify(name), name=name, x=round(x, 2), y=round(y, 2), dept=dept,
                     type=typ, spec=list(spec), fort=fort)
            self.nodes.append(n)
            self.by_name[name] = k

    # ------------------------------------------------------------ cache
    def _src_hash(self):
        h = hashlib.sha1()
        h.update(json.dumps(self.src, sort_keys=True).encode())
        h.update(repr(PLACES).encode())
        h.update(repr(ROYAL_ROUTES).encode())
        h.update(repr(EXTRA_ROADS).encode())
        h.update(str(CACHE_VERSION).encode())
        with open(os.path.abspath(__file__), 'rb') as f:
            h.update(f.read())
        return h.hexdigest()

    def _load_or_generate(self):
        path = os.path.join(DATA_DIR, 'map_cache.json')
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
                    self.cellnode = bytearray(base64.b64decode(c['cellnode']))
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
                 cellnode=base64.b64encode(bytes(self.cellnode)).decode(),
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

    def _raster_line(self, pts, fn, step=0.35):
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            L = math.hypot(x2 - x1, y2 - y1)
            n = max(1, int(L / step))
            for s in range(n + 1):
                t = s / n
                c = self.cell(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
                if c >= 0:
                    fn(c)

    def _bfs(self, sources, maxd, passable=None):
        W, H = self.W, self.H
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
        terrain = bytearray(N)
        ocean_src = []
        for c in range(N):
            j = c // W
            if water[c]:
                terrain[c] = T_EAU
            elif self.dept[c] == 0:
                if j + 0.5 > y_spain and (c % W) > 3:
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

        forests = [(self.xy(la, lo), r, d) for la, lo, r, d in FORESTS]
        vines = [(self.xy(la, lo), r) for la, lo, r in VINEYARDS]

        for c in range(N):
            t = terrain[c]
            if t in (T_OCEAN, T_EAU):
                continue
            i, j = c % W, c // W
            x, y = i + 0.5, j + 0.5
            lat, lon = self.lat_of(y), self.lon_of(x)
            e = self._elev(lat, lon) + (fbm(x / 22, y / 22, 11, 4) - 0.5) * 0.42
            if lat < 43.35:
                e -= 0.6 * math.exp(-(d_riv[c] / 2.6) ** 2)
            else:
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
            if do <= 2 and lat > 43.55:
                terrain[c] = T_DUNES
                continue
            if do <= 7 and lat > 43.6 and n1 > 0.22:
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
                    or self.dept_codes[self.dept[c] - 1] not in PLAYABLE:
                bad += 1
            elif self.terrain[c] == T_HAUTE:
                bad += 0.25
        return bad

    def _build_roads(self):
        nodes = self.nodes
        P = [(n['x'], n['y']) for n in nodes]
        pairs = {}
        n = len(nodes)
        for a in range(n):
            for b in range(a + 1, n):
                d = math.dist(P[a], P[b])
                if d > 40:
                    continue
                mx, my = (P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2
                r2 = (d / 2) ** 2
                ok = True
                for c in range(n):
                    if c != a and c != b and (P[c][0] - mx) ** 2 + (P[c][1] - my) ** 2 < r2:
                        ok = False
                        break
                if ok and self._water_on_segment(P[a], P[b]) < 1:
                    pairs[(a, b)] = dict(royal=False, ferry=False)
        for route in ROYAL_ROUTES:
            ids = [self.by_name[nm] for nm in route]
            for a, b in zip(ids, ids[1:]):
                k = (min(a, b), max(a, b))
                if k in pairs:
                    pairs[k]['royal'] = True
                elif self._water_on_segment(P[a], P[b]) < 1:
                    pairs[k] = dict(royal=True, ferry=False)
        for na, nb in EXTRA_ROADS:
            a, b = self.by_name[na], self.by_name[nb]
            k = (min(a, b), max(a, b))
            fer = (na, nb) in FERRIES or (nb, na) in FERRIES
            if fer or self._water_on_segment(P[a], P[b]) < 1:
                pairs.setdefault(k, dict(royal=False, ferry=fer))
                pairs[k]['ferry'] = fer
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

        rivers = []
        for r in self.src['rivers']:
            if r['rank'] <= 2:
                rivers.append((r['name'], r['rank'], [self.xy(lat, lon) for lon, lat in r['pts']]))
        edges = []
        self.road = bytearray(self.W * self.H)
        for eid, ((a, b), info) in enumerate(sorted(pairs.items())):
            d = math.dist(P[a], P[b])
            e = dict(id=eid, a=a, b=b, len=round(d * 1.12, 2), royal=info['royal'], ferry=info['ferry'],
                     river=None, rrank=0, cx=None, cy=None)
            best = None
            for name, rank, pts in rivers:
                for p, q in zip(pts, pts[1:]):
                    it = _seg_inter(P[a], P[b], p, q)
                    if it and (best is None or rank < best[1]):
                        best = (name, rank, it[1])
            if info['ferry']:
                e['river'], e['rrank'] = 'Gironde', 1
                e['cx'], e['cy'] = round((P[a][0] + P[b][0]) / 2, 2), round((P[a][1] + P[b][1]) / 2, 2)
            elif best:
                e['river'], e['rrank'] = best[0], best[1]
                e['cx'], e['cy'] = round(best[2][0], 2), round(best[2][1], 2)
            edges.append(e)

            def setroad(c):
                self.road[c] = 1
            self._raster_line([P[a], P[b]], setroad, 0.3)
        self.edges = edges

    def _ensure_connected(self, pairs, P):
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

    def _build_cellnode(self):
        """Zone d'influence de chaque lieu : distance par la terre (l'eau sépare), dans son département."""
        W, H = self.W, self.H
        N = W * H
        cn = bytearray([255]) * N
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
            if self.cellnode[c] != 255:
                continue
            d = self.dept[c]
            if d == 0 or self.terrain[c] in (T_OCEAN, T_EAU) or d not in by_dept:
                continue
            x, y = c % W + 0.5, c // W + 0.5
            self.cellnode[c] = min(by_dept[d], key=lambda t: (t[1] - x) ** 2 + (t[2] - y) ** 2)[0]

    def _build_cellnode_euclid(self):
        W, H = self.W, self.H
        by_dept = {}
        for n in self.nodes:
            w = {'capitale': 1.35, 'ville': 1.15, 'village': 1.0, 'fort': 0.85}[n['type']]
            by_dept.setdefault(self.dept_codes.index(n['dept']) + 1, []).append((n['id'], n['x'], n['y'], w))
        cn = bytearray([255]) * (W * H)
        for c in range(W * H):
            d = self.dept[c]
            if d == 0 or self.terrain[c] in (T_OCEAN, T_EAU):
                continue
            cands = by_dept.get(d)
            if not cands:
                continue
            x, y = c % W + 0.5, c // W + 0.5
            jit = (fbm(x / 6, y / 6, 21) - 0.5) * 6.0
            best, bi = 1e9, 255
            for nid, nx, ny, w in cands:
                dd = math.hypot(x - nx, y - ny) / w + jit * (0.5 + _h(nid, 7, 3))
                if dd < best:
                    best, bi = dd, nid
            cn[c] = bi
        self.cellnode = cn

    def node_of_cell(self, x, y):
        c = self.cell(x, y)
        if c < 0:
            return None
        v = self.cellnode[c]
        return None if v == 255 else v

    # ------------------------------------------------------------ A* hors route
    def cell_cost(self, c):
        t = self.terrain[c]
        sp = TERRAIN[t][1]
        if sp <= 0 or self.dept[c] == 0 or self.dept_codes[self.dept[c] - 1] not in PLAYABLE:
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

    def astar(self, sx, sy, gx, gy, max_nodes=120000):
        W, H = self.W, self.H
        s, g = self.cell(sx, sy), self.cell(gx, gy)
        if s < 0 or g < 0 or self.cell_cost(g) is None:
            return None
        gi, gj = g % W, g // W
        hmin = 1.0 / 0.70
        openh = [(0.0, s)]
        gs = {s: 0.0}
        came = {}
        seen = 0
        D2 = math.sqrt(2)
        while openh:
            f, c = heapq.heappop(openh)
            if c == g:
                break
            seen += 1
            if seen > max_nodes:
                return None
            gc = gs[c]
            i, j = c % W, c // W
            for di, dj, m in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1),
                              (1, 1, D2), (1, -1, D2), (-1, 1, D2), (-1, -1, D2)):
                ni, nj = i + di, j + dj
                if not (0 <= ni < W and 0 <= nj < H):
                    continue
                nc = nj * W + ni
                cc = self.cell_cost(nc)
                if cc is None and nc != s:
                    continue
                if cc is None:
                    cc = 2.0
                ng = gc + cc * m
                if ng < gs.get(nc, 1e18):
                    gs[nc] = ng
                    came[nc] = c
                    hh = math.hypot(ni - gi, nj - gj) * hmin
                    heapq.heappush(openh, (ng + hh, nc))
        if g not in came and g != s:
            return None
        path = [g]
        while path[-1] != s:
            path.append(came[path[-1]])
        path.reverse()
        pts = [(c % W + 0.5, c // W + 0.5) for c in path]
        pts[0] = (sx, sy)
        pts[-1] = (gx, gy)
        return self._smooth(pts)

    def _line_ok(self, a, b, maxcost):
        L = math.dist(a, b)
        n = max(1, int(L / 0.5))
        for s in range(1, n):
            t = s / n
            c = self.cell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            cc = self.cell_cost(c) if c >= 0 else None
            if cc is None or cc > maxcost + 0.01:
                return False
        return True

    def _smooth(self, pts):
        if len(pts) <= 2:
            return pts
        costs = []
        for p in pts:
            c = self.cell(*p)
            cc = self.cell_cost(c) if c >= 0 else None
            costs.append(cc if cc is not None else 2.0)
        out = [pts[0]]
        i = 0
        while i < len(pts) - 1:
            j = i + 1
            mc = max(costs[i], costs[j])
            k = j
            while k + 1 < len(pts):
                mc2 = max(mc, costs[k + 1])
                if self._line_ok(pts[i], pts[k + 1], mc2):
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
        return dict(W=self.W, H=self.H, lon0=self.lon0, lat1=self.lat1, KX=KX, KY=KY,
                    y_mont=self.xy(43.2, 0)[1], x_cote=self.xy(44, -0.95)[0], y_spain=self.xy(43.36, 0)[1],
                    terrain=base64.b64encode(bytes(self.terrain)).decode(),
                    dept=base64.b64encode(bytes(self.dept)).decode(),
                    cellnode=base64.b64encode(bytes(self.cellnode)).decode(),
                    river=base64.b64encode(bytes(self.river)).decode(),
                    dept_codes=self.dept_codes, depts=depts, rivers=rivers, waters=waters,
                    nodes=self.nodes, edges=self.edges,
                    terrain_names={k: v[0] for k, v in TERRAIN.items()})
