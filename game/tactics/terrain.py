"""Carte d'une bataille tactique : 3 000 × 2 000 m, grille de 20 m (150 × 100 cases).

Construite à partir des cases de campagne autour de la bataille (terrain, rivières, routes, places proches),
puis enrichie de bruit procédural déterministe (graine) : bosquets, haies, champs en lanières, vignes en rangs,
fermes, chemins, ruisseaux, mares, relief.

Composée comme les cartes d'Ultimate General (SPEC-CARTES.md) : les parcelles sont des îlots aux formes variées
(cellules de Voronoï), coupés en lanières dans le sens de la route voisine ou des courbes de niveau ; le terroir
s'organise autour des maisons (vergers, petits champs), le long de l'eau (prés) et selon la pente (pas de labours sur
les pentes fortes) ; les bois ont des lisières découpées, des clairières, et des bosquets parsèment les champs ; les
haies suivent les bords des îlots, les chemins des fermes les longent. Une place forte ou une ville occupe le centre quand la bataille s'y livre,
avec ses rues, son enceinte, ses portes, la brèche du siège et ses barricades.

Coordonnées en mètres : x vers l'est (0 à 3 000), y vers le sud (0 à 2 000), comme la carte de campagne.
Case (i, j) : centre en ((i + 0,5) × 20, (j + 0,5) × 20), indice c = j × 150 + i.
Tout est calculé en Python pur, d'un seul passage par couche (environ 0,1 s sur un PC).
"""
import base64
import math
import random

from ..geo import (T_OCEAN, T_EAU as G_EAU, T_PLAINE, T_FORET, T_LANDE, T_MARAIS, T_COLLINES, T_MONTAGNE, T_HAUTE,
                   T_DUNES, T_VIGNE)

W, H, CELL = 3000, 2000, 20
COLS, ROWS = W // CELL, H // CELL
N = COLS * ROWS

# Types de case (ordre du contrat) ; BARRICADE est un ajout (ouvrages de fortune : muret franchissable lentement)
# VERGER est le dernier venu (SPEC-CARTES.md) : prés plantés d'arbres fruitiers autour des maisons, couvert léger ; ajouté
# à la fin, les numéros des autres ne changent pas (sauvegardes)
(T_PRE, T_CHAMP, T_VIGNE_T, T_LANDE_T, T_BOIS, T_FORET_T, T_MARAIS_T, T_EAU, T_GUE, T_ROUTE, T_CHEMIN, T_BATI, T_MUR,
 T_BRECHE, T_PORTE, T_SABLE, T_ROCHE, T_BARRICADE, T_VERGER) = range(19)
TYPE_NAMES = ['PRE', 'CHAMP', 'VIGNE', 'LANDE', 'BOIS', 'FORET', 'MARAIS', 'EAU', 'GUE', 'ROUTE', 'CHEMIN', 'BATI',
              'MUR', 'BRECHE', 'PORTE', 'SABLE', 'ROCHE', 'BARRICADE', 'VERGER']
# Éléments linéaires (couche à part, `f`) : bordent champs et chemins, donnent un couvert léger à moyen
F_NONE, F_CLOTURE, F_HAIE, F_MURET = range(4)
FEAT_NAMES = ['', 'cloture', 'haie', 'muret']
# probabilité qu'un bord de parcelle porte une clôture ou un muret (en plus des haies du bocage)
FENCE = {T_PLAINE: 0.22, T_COLLINES: 0.30, T_VIGNE: 0.32, T_MONTAGNE: 0.30, T_HAUTE: 0.15, T_LANDE: 0.08,
         T_MARAIS: 0.12, T_FORET: 0.05, T_DUNES: 0.0}
STONY = ('24', '64')   # pays de pierre : murets plutôt que clôtures
TYPE_LABEL = ['Prairie', 'Champs', 'Vignes', 'Lande', 'Bois', 'Forêt', 'Marais', 'Eau', 'Gué', 'Route', 'Chemin',
              'Maisons', 'Rempart', 'Brèche', 'Porte', 'Sable', 'Rochers', 'Barricade', 'Verger']
CULTIVE = (T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T)   # ce que le terroir peut réattribuer (C2)

# amplitude du relief (m) selon le terrain de campagne
AMP = {T_OCEAN: 0, G_EAU: 0, T_PLAINE: 7, T_FORET: 14, T_LANDE: 4, T_MARAIS: 1, T_COLLINES: 38, T_MONTAGNE: 66,
       T_HAUTE: 80, T_DUNES: 18, T_VIGNE: 16}
# seuil du bruit au-dessus duquel pousse un bois (plus bas = plus boisé)
WOOD = {T_PLAINE: 0.70, T_FORET: 0.30, T_LANDE: 0.56, T_MARAIS: 0.78, T_COLLINES: 0.60, T_MONTAGNE: 0.47,
        T_HAUTE: 0.72, T_DUNES: 0.50, T_VIGNE: 0.80}
# cultures des parcelles : [(type, poids)]
CROPS = {
    T_PLAINE: [(T_CHAMP, 55), (T_PRE, 30), (T_VIGNE_T, 5), (T_LANDE_T, 4)],
    T_VIGNE: [(T_VIGNE_T, 66), (T_CHAMP, 14), (T_PRE, 14)],
    T_COLLINES: [(T_CHAMP, 38), (T_PRE, 38), (T_VIGNE_T, 8), (T_LANDE_T, 6)],
    T_LANDE: [(T_LANDE_T, 70), (T_PRE, 10), (T_CHAMP, 6)],
    T_FORET: [(T_PRE, 50), (T_CHAMP, 30), (T_LANDE_T, 20)],
    T_MARAIS: [(T_MARAIS_T, 55), (T_PRE, 40)],
    T_MONTAGNE: [(T_PRE, 45), (T_LANDE_T, 40), (T_ROCHE, 6)],
    T_HAUTE: [(T_ROCHE, 45), (T_LANDE_T, 35), (T_PRE, 20)],
    T_DUNES: [(T_SABLE, 70), (T_LANDE_T, 30)],
}
# bocage : part des bords de parcelles plantés de haies, selon le département
BOCAGE = {'64': 0.38, '24': 0.26, '47': 0.14, '40': 0.10, '33': 0.04}
# cultures supplémentaires selon le pays (vignes du Bordelais et de Bergerac, prés du Béarn…)
DEPT_CROPS = {'33': [(T_VIGNE_T, 20)], '24': [(T_PRE, 10)], '47': [(T_CHAMP, 15)], '64': [(T_PRE, 20)],
              '40': [(T_LANDE_T, 10)]}
FARMS = {T_PLAINE: 6, T_VIGNE: 5, T_COLLINES: 5, T_LANDE: 3, T_FORET: 2, T_MARAIS: 2, T_MONTAGNE: 3, T_HAUTE: 1,
         T_DUNES: 1}
RIVER_W = {1: 130, 2: 50, 3: 22}   # largeur des cours d'eau (m) selon leur rang


def _hash(a, b, seed):
    n = (a * 374761393 + b * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def noise(rng, scale, octaves=2, persist=0.5):
    """Bruit de valeurs lissé sur toute la grille (liste de N flottants entre 0 et 1). scale : taille d'un motif en cases."""
    out = [0.0] * N
    amp, tot = 1.0, 0.0
    s = float(scale)
    for _ in range(octaves):
        gw, gh = int(COLS / s) + 3, int(ROWS / s) + 3
        lat = [rng.random() for _ in range(gw * gh)]
        xs = []
        for i in range(COLS):
            f = (i + 0.5) / s
            ix = int(f)
            t = f - ix
            xs.append((ix, t * t * (3 - 2 * t)))
        for j in range(ROWS):
            f = (j + 0.5) / s
            iy = int(f)
            u = f - iy
            u = u * u * (3 - 2 * u)
            r0, r1 = iy * gw, (iy + 1) * gw
            row = [lat[r0 + k] + (lat[r1 + k] - lat[r0 + k]) * u for k in range(gw)]
            base = j * COLS
            for i, (ix, t) in enumerate(xs):
                a = row[ix]
                out[base + i] += (a + (row[ix + 1] - a) * t) * amp
        tot += amp
        amp *= persist
        s /= 2.0
    inv = 1.0 / tot
    return [v * inv for v in out]


def blur(vals, r):
    """Flou de boîte séparable (rayon r cases)."""
    tmp = [0.0] * N
    k = 1.0 / (2 * r + 1)
    for j in range(ROWS):
        base = j * COLS
        row = vals[base:base + COLS]
        pad = [row[0]] * r + row + [row[-1]] * r
        s = sum(pad[:2 * r + 1])
        for i in range(COLS):
            tmp[base + i] = s * k
            s += pad[i + 2 * r + 1] - pad[i] if i + 2 * r + 1 < len(pad) else 0
    out = [0.0] * N
    for i in range(COLS):
        col = tmp[i::COLS]
        pad = [col[0]] * r + col + [col[-1]] * r
        s = sum(pad[:2 * r + 1])
        for j in range(ROWS):
            out[j * COLS + i] = s * k
            s += pad[j + 2 * r + 1] - pad[j] if j + 2 * r + 1 < len(pad) else 0
    return out


def bfs(sources, maxd, passable=None):
    """Distance en cases (4-voisinage) depuis des cases sources, plafonnée à maxd (255 au-delà)."""
    dist = bytearray([255]) * N
    q = list(sources)
    for c in q:
        dist[c] = 0
    k = 0
    while k < len(q):
        c = q[k]
        k += 1
        d = dist[c] + 1
        if d > maxd:
            continue
        i = c % COLS
        for nc in ((c + 1) if i < COLS - 1 else -1, (c - 1) if i > 0 else -1, c + COLS, c - COLS):
            if 0 <= nc < N and dist[nc] > d and (passable is None or passable(nc)):
                dist[nc] = d
                q.append(nc)
    return dist


def cell_of(x, y):
    i, j = int(x // CELL), int(y // CELL)
    if 0 <= i < COLS and 0 <= j < ROWS:
        return j * COLS + i
    return -1


def center_of(c):
    return (c % COLS + 0.5) * CELL, (c // COLS + 0.5) * CELL


class BattleMap:
    """Carte générée : t (types), h (altitudes), et les objets dessinés par le client."""

    def __init__(self):
        self.t = bytearray(N)
        self.h = bytearray(N)
        self.roads = []
        self.rivers = []
        self.buildings = []
        self.walls = []
        self.hedges = []
        self.f = bytearray(N)
        self.fences = []
        self.bridges = []
        self.place = None
        self.heart = None
        self.town_r = 0.0
        self.biome = None
        self.region = ''
        self.stats = {}

    def to_client(self, spec):
        r2 = lambda p: [round(p[0], 1), round(p[1], 1)]
        return dict(W=W, H=H, cell=CELL, cols=COLS, rows=ROWS,
                    t=base64.b64encode(bytes(self.t)).decode(), h=base64.b64encode(bytes(self.h)).decode(),
                    roads=[[r2(p) for p in r['pts']] for r in self.roads],
                    road_kinds=[r['kind'] for r in self.roads],
                    rivers=[dict(w=r['w'], pts=[r2(p) for p in r['pts']], kind=r['kind'], name=r.get('name'))
                            for r in self.rivers],
                    buildings=self.buildings, walls=self.walls, place=self.place,
                    hedges=[[r2(p) for p in hd] for hd in self.hedges], bridges=self.bridges,
                    f=base64.b64encode(bytes(self.f)).decode(), feature_names=FEAT_NAMES,
                    fences=[dict(kind=k, pts=[r2(p) for p in pts]) for k, pts in self.fences],
                    heart=list(self.heart) if self.heart else None,
                    seed=spec['seed'], season=spec['season'], weather=spec['weather'], year=spec.get('year'),
                    marks=spec.get('marks', [[], []]),
                    camp=dict(x=spec['cx'], y=spec['cy']), region=self.region,
                    types=TYPE_NAMES, labels=TYPE_LABEL)


# ====================================================================== tracés
def _densify(pts, step):
    out = []
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        L = math.hypot(x2 - x1, y2 - y1)
        n = max(1, int(L / step))
        for s in range(n):
            t = s / n
            out.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
    if pts:
        out.append(tuple(pts[-1]))
    return out


def _meander(pts, rng, amp, wave):
    """Méandres : décalage perpendiculaire lisse le long d'un tracé densifié."""
    if len(pts) < 3 or amp <= 0:
        return pts
    ph1, ph2 = rng.random() * 6.28, rng.random() * 6.28
    w2 = wave * (0.37 + rng.random() * 0.2)
    out = [pts[0]]
    s = 0.0
    for k in range(1, len(pts) - 1):
        (x0, y0), (x1, y1), (x2, y2) = pts[k - 1], pts[k], pts[k + 1]
        s += math.hypot(x1 - x0, y1 - y0)
        dx, dy = x2 - x0, y2 - y0
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        off = amp * (0.7 * math.sin(s / wave * 6.283 + ph1) + 0.3 * math.sin(s / w2 * 6.283 + ph2))
        # les extrémités restent en place (raccord aux villes)
        k_end = min(1.0, k / 4.0, (len(pts) - 1 - k) / 4.0)
        out.append((x1 + nx * off * k_end, y1 + ny * off * k_end))
    out.append(pts[-1])
    return out


def _clip_poly(pts, margin=0.0):
    """Garde la partie d'un tracé qui passe sur le champ de bataille (morceaux successifs)."""
    parts, cur = [], []
    x0, y0, x1, y1 = -margin, -margin, W + margin, H + margin
    for p in pts:
        if x0 <= p[0] <= x1 and y0 <= p[1] <= y1:
            cur.append(p)
        else:
            if cur:
                cur.append(p)
                parts.append(cur)
                cur = []
            elif parts or True:
                cur = []
    if cur:
        parts.append(cur)
    # raccroche le point précédent l'entrée sur la carte
    res = []
    for part in parts:
        if len(part) >= 2:
            res.append(part)
    return res


def _stamp(m, pts, radius, fn, step=8.0):
    """Applique fn(c) à toutes les cases à moins de radius (m) du tracé."""
    rc = int(radius // CELL) + 1
    r2 = radius * radius
    seen = set()
    for x, y in _densify(pts, step):
        ci, cj = int(x // CELL), int(y // CELL)
        for dj in range(-rc, rc + 1):
            j = cj + dj
            if j < 0 or j >= ROWS:
                continue
            cy = (j + 0.5) * CELL - y
            for di in range(-rc, rc + 1):
                i = ci + di
                if i < 0 or i >= COLS:
                    continue
                c = j * COLS + i
                if c in seen:
                    continue
                cx = (i + 0.5) * CELL - x
                if cx * cx + cy * cy <= r2:
                    seen.add(c)
                    fn(c)
    return seen


def _line_cells(x1, y1, x2, y2):
    """Cases traversées par un segment (pas d'une demi-case)."""
    L = math.hypot(x2 - x1, y2 - y1)
    n = max(1, int(L / (CELL * 0.5)))
    out = []
    last = -1
    for s in range(n + 1):
        t = s / n
        c = cell_of(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
        if c >= 0 and c != last:
            out.append(c)
            last = c
    return out


def _poly_cells(pts):
    out = []
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        out.extend(_line_cells(x1, y1, x2, y2))
    return out


# ====================================================================== génération
def generate(geo, spec):
    """Carte de la bataille décrite par spec (voir bridge.make_spec) ; déterministe pour une graine donnée."""
    seed = int(spec['seed']) & 0x7FFFFFFF
    rng = random.Random(seed)
    m = BattleMap()
    cx, cy = spec['cx'], spec['cy']

    def to_m(xk, yk):
        return ((xk - cx) * 1000.0 + W / 2, (yk - cy) * 1000.0 + H / 2)

    # ---------------------------------------------------------- terrain de campagne sous chaque case
    jx, jy = noise(rng, 16, 2), noise(rng, 16, 2)
    gt, gW, gH = geo.terrain, geo.W, geo.H
    biome = bytearray(N)
    for j in range(ROWS):
        yk0 = cy + ((j + 0.5) * CELL - H / 2) / 1000.0
        base = j * COLS
        for i in range(COLS):
            c = base + i
            X = cx + ((i + 0.5) * CELL - W / 2) / 1000.0 + (jx[c] - 0.5) * 0.9
            Y = yk0 + (jy[c] - 0.5) * 0.9
            ii, jj = int(X), int(Y)
            biome[c] = gt[jj * gW + ii] if 0 <= ii < gW and 0 <= jj < gH else T_OCEAN
    m.biome = biome
    hist = {}
    for b in biome:
        hist[b] = hist.get(b, 0) + 1
    land = {b: v for b, v in hist.items() if b not in (T_OCEAN, G_EAU)}
    main = max(land, key=land.get) if land else T_PLAINE
    dept = geo.dept_at(cx, cy) or ''
    m.region = _region_name(geo, cx, cy, main, dept)

    # ---------------------------------------------------------- relief
    amp = blur([float(AMP.get(b, 8)) for b in biome], 7)
    nh = noise(rng, 34, 3, 0.45)
    hf = [0.0] * N
    for c in range(N):
        a = amp[c]
        v = nh[c]
        if a > 30:   # montagne : crêtes marquées (passage progressif depuis les collines)
            k = min(1.0, (a - 30) / 30.0)
            v = v * (1 - k) + (1.0 - abs(2 * v - 1.0) * 0.8) * k
        hf[c] = 3.0 + a * v

    # ---------------------------------------------------------- eau : rivières de campagne, lacs, océan
    t = m.t
    for c in range(N):
        if biome[c] in (T_OCEAN, G_EAU):
            t[c] = T_EAU
    water_src = []
    for r in geo.src['rivers']:
        pts = [to_m(*geo.xy(lat, lon)) for lon, lat in r['pts']]
        # segments qui approchent du champ de bataille
        near = [k for k, (x, y) in enumerate(pts) if -2500 <= x <= W + 2500 and -2500 <= y <= H + 2500]
        if not near:
            continue
        k0, k1 = max(0, near[0] - 1), min(len(pts), near[-1] + 2)
        sub = pts[k0:k1]
        if len(sub) < 2 or not _poly_near_field(sub):
            continue
        w = RIVER_W.get(r['rank'], 22) * (0.75 if r['name'] in ('Adour', 'Lot', 'Isle') else 1.0)
        dense = _densify(sub, 40.0)
        dense = _meander(dense, rng, 35 + w * 0.4, 520 + w * 2)
        for part in _clip_poly(dense, 200):
            m.rivers.append(dict(w=round(w), pts=part, kind='riviere' if r['rank'] > 1 else 'fleuve', name=r['name'],
                                 rank=r['rank']))

            def wet(c):
                t[c] = T_EAU
            water_src.extend(_stamp(m, part, w / 2, wet))
    # ruisseaux procéduraux (gués sur toute leur longueur)
    if main not in (T_DUNES,) and rng.random() < (0.75 if not m.rivers else 0.35):
        for _ in range(1 if rng.random() < 0.7 else 2):
            pts = _random_crossing(rng)
            pts = _meander(_densify(pts, 40.0), rng, 45, 300)
            m.rivers.append(dict(w=8, pts=pts, kind='ruisseau', name=None, rank=4))
            for c in _poly_cells(pts):
                if t[c] != T_EAU:
                    t[c] = T_GUE
                    water_src.append(c)
    # vallées : le relief se creuse vers l'eau
    wsrc = [c for c in range(N) if t[c] in (T_EAU, T_GUE)]
    dwat = bfs(wsrc, 14) if wsrc else bytearray([255]) * N
    for c in range(N):
        d = dwat[c]
        if d < 14:
            hf[c] *= 0.18 + 0.82 * (d / 14.0) ** 1.4
    # gués des rivières (rang 2 et 3) : 1 à 3 passages peu profonds
    for r in m.rivers:
        if r['kind'] != 'riviere':
            continue
        nf = 1 + int(rng.random() * (3 if r['rank'] == 3 else 2))
        dense = _densify(r['pts'], 20.0)
        inside = [p for p in dense if 60 < p[0] < W - 60 and 60 < p[1] < H - 60]
        for _ in range(nf):
            if not inside:
                break
            p = inside[rng.randrange(len(inside))]

            def ford(c):
                if t[c] == T_EAU:
                    t[c] = T_GUE
            _stamp(m, [p, p], r['w'] / 2 + 12, ford)
            r.setdefault('fords', []).append([round(p[0]), round(p[1])])

    # ---------------------------------------------------------- tracé des routes de campagne (à moins de 2 km) : avant les
    # parcelles, dont les sillons les suivent (posées sur la carte plus bas)
    for e in geo.edges:
        if e.get('kind') == 'water' or e.get('ferry'):
            continue
        A, B = geo.nodes[e['a']], geo.nodes[e['b']]
        if _seg_dist(cx, cy, A['x'], A['y'], B['x'], B['y']) > 2.0:
            continue
        pa, pb = to_m(A['x'], A['y']), to_m(B['x'], B['y'])
        dense = _densify([pa, pb], 50.0)
        dense = _meander(dense, rng, 18, 700)
        for part in _clip_poly(dense, 100):
            m.roads.append(dict(pts=part, kind='royale' if e.get('royal') else 'route'))
    if not m.roads:
        pts = _meander(_densify(_random_crossing(rng), 50.0), rng, 40, 500)
        m.roads.append(dict(pts=pts, kind='chemin'))

    # ---------------------------------------------------------- couvert : bois, marais, parcelles
    nw = noise(rng, 13, 3, 0.55)
    nlis = noise(rng, 3, 1)   # (lisières découpées : le seuil des bois bousculé de près, C3)
    ilot, strip = _ilots(seed, hf, m.roads, main)
    m.ilot, m.strip = ilot, strip
    year = spec.get('year', 1790)
    nwet = noise(rng, 9, 2)
    crops_extra = DEPT_CROPS.get(dept, [])
    bocage = BOCAGE.get(dept, 0.1) * (1.4 if main in (T_COLLINES, T_PLAINE) else 0.6)
    if main == T_LANDE:
        bocage *= 0.3
    hedge_cells = []
    feat = m.f
    fence_p = FENCE.get(main, 0.2)
    wall_kind = F_MURET if dept in STONY or main in (T_MONTAGNE, T_HAUTE, T_VIGNE) else F_CLOTURE
    for j in range(ROWS):
        base = j * COLS
        for i in range(COLS):
            c = base + i
            if t[c] in (T_EAU, T_GUE):
                continue
            b = biome[c]
            wthr = WOOD.get(b, 0.7)
            if b == T_LANDE and year < 1857:
                wthr += 0.12   # avant la loi de 1857, la lande rase domine : les pins sont encore rares
            if dwat[c] <= 2 and b != T_MARAIS:
                wthr += 0.05
            v = nw[c] + (nlis[c] - 0.5) * 0.12
            if v > wthr:
                dense = b in (T_FORET, T_MONTAGNE) and v > wthr + 0.18
                t[c] = T_FORET_T if dense else T_BOIS
                continue
            if b == T_MARAIS and nwet[c] > 0.45 or (b == T_LANDE and nwet[c] > 0.74) or \
                    (dwat[c] <= 3 and nwet[c] > 0.66 and b in (T_PLAINE, T_LANDE)):
                t[c] = T_MARAIS_T
                continue
            if b in (T_MONTAGNE, T_HAUTE) and hf[c] > 0.86 * amp[c] + 3:
                t[c] = T_ROCHE
                continue
            # parcelle : la lanière de son îlot (C1), sa culture tirée d'après son numéro
            crops = CROPS.get(b, CROPS[T_PLAINE]) + crops_extra
            tot = sum(w for _, w in crops)
            x = _hash(strip[c], 5, seed) * tot
            for ty, w in crops:
                x -= w
                if x <= 0:
                    break
            t[c] = ty
            # haies et clôtures sur les bords des îlots (C4) : tout un bord a le même sort (les deux îlots qu'il sépare)
            il = ilot[c]
            other = ilot[c + 1] if i < COLS - 1 and ilot[c + 1] != il else (ilot[c + COLS] if j < ROWS - 1 and ilot[c + COLS] != il else -1)
            if other >= 0 and ty in CULTIVE and _hash(i, j, seed + 7) > 0.12:   # (des trouées, des barrières ouvertes)
                a, bb = min(il, other), max(il, other)
                hv = _hash(a, bb + 11, seed)
                if hv < bocage and ty != T_VIGNE_T:
                    hedge_cells.append(c)
                    feat[c] = F_HAIE
                elif hv < bocage + fence_p:
                    feat[c] = wall_kind if (ty == T_VIGNE_T or _hash(a, bb, seed + 3) < 0.7) else \
                        (F_CLOTURE if wall_kind == F_MURET else F_MURET)

    # mares
    if main in (T_PLAINE, T_LANDE, T_MARAIS, T_COLLINES):
        for _ in range(rng.randrange(4)):
            c = rng.randrange(N)
            if t[c] in (T_PRE, T_LANDE_T, T_CHAMP, T_MARAIS_T):
                t[c] = T_EAU

    _bois_details(rng, t)

    # ---------------------------------------------------------- routes de campagne : tracées plus haut, posées ici
    road_cells = set()
    for r in m.roads:
        for c in _poly_cells(r['pts']):
            road_cells.add(c)
    for r in m.roads:
        cells = _poly_cells(r['pts'])
        wet_run = []
        for c in cells:
            if t[c] in (T_EAU, T_GUE):
                wet_run.append(c)
            elif wet_run:
                _add_bridge(m, wet_run, t)
                wet_run = []
            t[c] = T_ROUTE if r['kind'] != 'chemin' else T_CHEMIN
        for c in wet_run:
            t[c] = T_ROUTE if r['kind'] != 'chemin' else T_CHEMIN
    # un grand fleuve sans pont ni gué sur la carte : un pont de bateaux, pour que la bataille ait un passage
    for r in m.rivers:
        if r['kind'] == 'fleuve' and not r.get('fords') and not any(b.get('river') == r['name'] for b in m.bridges):
            _force_bridge(m, r, rng, t)

    # ---------------------------------------------------------- place, ville ou village
    pl = spec.get('place')
    if pl is None:
        # bataille rangée près d'un lieu : son village apparaît sur la carte
        best = None
        for gn in geo.nodes:
            d = math.hypot(gn['x'] - cx, gn['y'] - cy)
            if d < 1.3 and (best is None or d < best[0]):
                best = (d, gn)
        if best:
            gn = best[1]
            pl = dict(nid=gn['id'], name=gn['name'], type=gn['type'], fort=0, dmg=0.0, bar=0.0, pop=gn['pop0'],
                      x=gn['x'], y=gn['y'], battle=False)
    if pl:
        _town(m, pl, to_m(pl['x'], pl['y']), rng, spec, t, road_cells)

    # ---------------------------------------------------------- fermes, moulin, chemins
    _farms(m, rng, FARMS.get(main, 3), t, hf, main)
    _mill(m, rng, t, hf, main)
    _terroir(m, seed, t, hf, dwat, biome, dept)

    # ---------------------------------------------------------- altitude finale
    hb = m.h
    for c in range(N):
        v = hf[c]
        tc = t[c]
        if tc == T_EAU:
            v = min(v, 2.0)
        hb[c] = 0 if v < 0 else (80 if v > 80 else int(v))
    # éléments linéaires : pas sur les routes, l'eau ni le bâti ; les chemins creux du bocage sont bordés de haies
    for c in range(N):
        tc = t[c]
        if tc in (T_ROUTE, T_CHEMIN, T_EAU, T_GUE, T_BATI, T_MUR, T_BRECHE, T_PORTE, T_BARRICADE, T_BOIS, T_FORET_T):
            feat[c] = F_NONE
    m.ilot = m.strip = None   # (seulement pour la génération)
    if bocage > 0.12:
        for c in range(COLS, N - COLS):
            if t[c] == T_CHEMIN and _hash(c, 17, seed) < bocage:
                for nc in (c - 1, c + 1, c - COLS, c + COLS):
                    if t[nc] in (T_CHAMP, T_PRE, T_LANDE_T):
                        feat[nc] = F_HAIE
    for k in (F_CLOTURE, F_HAIE, F_MURET):
        for a, b in _hedge_lines([c for c in range(N) if feat[c] == k]):
            m.fences.append((FEAT_NAMES[k], [a, b]))
    m.hedges = [pts for k, pts in m.fences if k == 'haie']
    m.stats = dict(main=main, dept=dept, hist={TYPE_NAMES[k]: t.count(k) for k in range(len(TYPE_NAMES)) if t.count(k)},
                   feat={FEAT_NAMES[k]: feat.count(k) for k in (1, 2, 3)})
    return m


def _region_name(geo, cx, cy, main, dept):
    names = {T_PLAINE: 'plaine', T_FORET: 'forêt', T_LANDE: 'landes', T_MARAIS: 'marais', T_COLLINES: 'collines',
             T_MONTAGNE: 'montagne', T_HAUTE: 'haute montagne', T_DUNES: 'dunes', T_VIGNE: 'vignoble'}
    return f"{names.get(main, 'plaine')} ({dept or '?'})"


def _poly_near_field(pts):
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        if _seg_dist(W / 2, H / 2, x1, y1, x2, y2) < 1900:
            return True
    return False


def _seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 <= 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
    return math.hypot(px - x1 - t * dx, py - y1 - t * dy)


def _random_crossing(rng):
    """Tracé d'un bord de la carte au bord opposé."""
    if rng.random() < 0.5:
        return [(-40, rng.uniform(200, H - 200)), (W / 2 + rng.uniform(-500, 500), rng.uniform(300, H - 300)),
                (W + 40, rng.uniform(200, H - 200))]
    return [(rng.uniform(300, W - 300), -40), (rng.uniform(600, W - 600), H / 2 + rng.uniform(-300, 300)),
            (rng.uniform(300, W - 300), H + 40)]


def _hedge_lines(cells):
    """Haies en tronçons (pour le dessin) : cases voisines alignées regroupées."""
    s = set(cells)
    out = []
    done = set()
    for c in cells:
        if c in done:
            continue
        for step in (1, COLS):
            if c - step in s and (step == COLS or c % COLS):
                continue
            run = [c]
            k = c
            while k + step in s and (step == COLS or (k + 1) % COLS):
                k += step
                run.append(k)
            if len(run) >= 2:
                done.update(run)
                out.append([center_of(run[0]), center_of(run[-1])])
                break
    return out


def _add_bridge(m, cells, t):
    if not cells:
        return
    (x1, y1), (x2, y2) = center_of(cells[0]), center_of(cells[-1])
    name = None
    best = 1e9
    for r in m.rivers:
        for p in r['pts'][::3]:
            d = (p[0] - x1) ** 2 + (p[1] - y1) ** 2
            if d < best:
                best, name = d, r.get('name')
    m.bridges.append(dict(x=round((x1 + x2) / 2), y=round((y1 + y2) / 2), a=round(math.atan2(y2 - y1, x2 - x1), 2),
                          len=round(math.hypot(x2 - x1, y2 - y1) + CELL), river=name))


def _force_bridge(m, r, rng, t):
    dense = _densify(r['pts'], 20.0)
    inside = [k for k, p in enumerate(dense) if 400 < p[0] < W - 400 and 300 < p[1] < H - 300]
    if not inside:
        return
    k = inside[len(inside) // 2 + rng.randrange(-len(inside) // 4 - 1, len(inside) // 4 + 1) if len(inside) > 4 else 0]
    k = max(1, min(len(dense) - 2, k))
    (x0, y0), (x1, y1) = dense[k - 1], dense[k + 1]
    L = math.hypot(x1 - x0, y1 - y0) or 1.0
    nx, ny = -(y1 - y0) / L, (x1 - x0) / L
    px, py = dense[k]
    half = r['w'] / 2 + 50
    pts = [(px - nx * half, py - ny * half), (px + nx * half, py + ny * half)]
    cells = _poly_cells(pts)
    wet = [c for c in cells if t[c] in (T_EAU, T_GUE)]
    for c in cells:
        if t[c] in (T_EAU, T_GUE, T_MARAIS_T, T_BOIS, T_FORET_T):
            t[c] = T_ROUTE
    _add_bridge(m, wet or cells, t)
    m.bridges[-1]['kind'] = 'bateaux'
    m.roads.append(dict(pts=pts, kind='chemin'))


# ---------------------------------------------------------------------- place
def _town(m, pl, pos, rng, spec, t, road_cells):
    px, py = pos
    typ = pl['type']
    pop = max(200, pl.get('pop') or 600)
    if typ == 'village':
        R = 70 + min(70, pop / 25)
    elif typ == 'fort':
        R = 95 + min(60, pop / 60)
    elif typ == 'ville':
        R = 150 + min(170, math.sqrt(pop) * 1.6)
    else:
        R = 260 + min(220, math.sqrt(pop) * 1.1)
    m.town_r = R
    m.place = dict(name=pl['name'], x=round(px), y=round(py), type=typ, r=round(R), fort=pl.get('fort', 0),
                   battle=bool(pl.get('battle')))
    rn = noise(rng, 6, 2)
    # rues : les routes qui y mènent, et quelques rues de plus en étoile
    streets = set(c for c in road_cells if math.hypot(*(a - b for a, b in zip(center_of(c), pos))) < R + 40)
    n_extra = 2 if typ == 'village' else (4 if typ in ('ville', 'fort') else 6)
    a0 = rng.random() * math.pi
    for k in range(n_extra):
        a = a0 + k * math.pi * 2 / n_extra + rng.uniform(-0.25, 0.25)
        pts = [(px, py), (px + math.cos(a) * R * 0.95, py + math.sin(a) * R * 0.95)]
        for c in _poly_cells(pts):
            streets.add(c)
    if typ != 'village':   # boulevard intérieur
        ring = [(px + math.cos(a) * R * 0.55, py + math.sin(a) * R * 0.55) for a in
                [i * math.pi / 12 for i in range(25)]]
        for c in _poly_cells(ring):
            streets.add(c)
    rc = int(R // CELL) + 2
    ci, cj = int(px // CELL), int(py // CELL)
    bati = []
    for dj in range(-rc, rc + 1):
        for di in range(-rc, rc + 1):
            i, j = ci + di, cj + dj
            if not (0 <= i < COLS and 0 <= j < ROWS):
                continue
            c = j * COLS + i
            if t[c] == T_EAU:
                continue
            x, y = center_of(c)
            d = math.hypot(x - px, y - py) / R
            if d > 1.05:
                continue
            if c in streets:
                t[c] = T_ROUTE
                continue
            dens = 1.0 - d * d * 0.7 + (rn[c] - 0.5) * 0.6
            if dens > 0.45 or d < 0.35:
                t[c] = T_BATI
                bati.append(c)
            elif t[c] in (T_BOIS, T_FORET_T, T_MARAIS_T, T_LANDE_T, T_ROCHE, T_SABLE):
                t[c] = T_PRE   # jardins et vergers
    # place publique et église au centre
    hc = cell_of(px, py)
    if hc >= 0:
        for c in (hc, hc + 1, hc - 1, hc + COLS, hc - COLS):
            if 0 <= c < N:
                t[c] = T_ROUTE
        chc = hc + 2 if (hc % COLS) < COLS - 2 else hc - 2
        t[chc] = T_BATI
        x, y = center_of(chc)
        m.buildings.append(dict(x=round(x), y=round(y), w=26 if typ != 'village' else 18, h=12, a=0, kind='eglise'))
        m.heart = (round(x), round(y))
    # maisons : un bâtiment par case de bâti, tourné vers la rue la plus proche
    stride = 1 if len(bati) < 500 else 2
    for c in bati[::stride]:
        if t[c] != T_BATI:
            continue
        x, y = center_of(c)
        a = 0.0 if _hash(c, 3, 77) < 0.5 else math.pi / 2
        m.buildings.append(dict(x=round(x + rng.uniform(-3, 3)), y=round(y + rng.uniform(-3, 3)),
                                w=round(rng.uniform(11, 17)), h=round(rng.uniform(8, 12)), a=round(a, 2), kind='maison'))
    fort = pl.get('fort', 0) if pl.get('battle') else min(pl.get('fort', 0), 1)
    att_a = spec.get('att_angle', 0.0)   # direction d'où vient l'assaillant, vue de la place
    if fort >= 1:
        _walls(m, pl, pos, R, fort, rng, t, road_cells | streets, att_a)
    bar = pl.get('bar', 0.0) if pl.get('battle') else 0.0
    if bar > 0.05:
        if fort <= 0:
            _barricades(m, pos, R, bar, rng, t, att_a)
        else:
            _redoubts(m, pos, R, bar, rng, t, att_a)


def _walls(m, pl, pos, R, fort, rng, t, streets, att_a):
    px, py = pos
    Rw = R + 25
    thick = CELL * (1 if fort == 1 else 2) + 2
    nb = 0 if fort <= 2 else (4 if fort == 3 else 6)
    bdepth = 0 if nb == 0 else (40 if fort == 3 else 70)
    b0 = rng.random() * 6.283
    wob = [rng.uniform(-0.06, 0.06) for _ in range(12)]

    def radius(a):
        k = (a % 6.283) / 6.283 * 12
        i0 = int(k) % 12
        f = k - int(k)
        r = Rw * (1 + wob[i0] * (1 - f) + wob[(i0 + 1) % 12] * f)
        if nb:
            ph = ((a - b0) % (6.283 / nb)) / (6.283 / nb)
            r += bdepth * max(0.0, 1 - abs(ph - 0.5) * 4)   # pointe du bastion
        return r

    wall_cells = []
    rc = int((Rw + bdepth + 40) // CELL) + 1
    ci, cj = int(px // CELL), int(py // CELL)
    for dj in range(-rc, rc + 1):
        for di in range(-rc, rc + 1):
            i, j = ci + di, cj + dj
            if not (0 <= i < COLS and 0 <= j < ROWS):
                continue
            c = j * COLS + i
            x, y = center_of(c)
            d = math.hypot(x - px, y - py)
            rr = radius(math.atan2(y - py, x - px))
            if rr <= d < rr + thick:
                if t[c] == T_EAU:
                    continue
                wall_cells.append(c)
            elif rr + thick <= d < rr + thick + 140 and t[c] in (T_BOIS, T_FORET_T, T_VIGNE_T):
                t[c] = T_PRE   # glacis dégagé devant les remparts
    gates = []
    for c in wall_cells:
        t[c] = T_PORTE if c in streets else T_MUR
        if c in streets:
            gates.append(c)
    if not gates:   # au moins une porte, sur la route la plus proche
        best = min(wall_cells, key=lambda c: abs(((math.atan2(center_of(c)[1] - py, center_of(c)[0] - px) - att_a
                                                  + 3.1416) % 6.283) - 3.1416)) if wall_cells else None
        if best is not None:
            t[best] = T_PORTE
    kind = 'mur' if fort == 1 else ('rempart' if fort <= 3 and nb == 0 else 'bastion')
    if fort == 3:
        kind = 'bastion'
    pts = [(px + math.cos(a) * (radius(a) + thick / 2), py + math.sin(a) * (radius(a) + thick / 2))
           for a in [k * 6.283 / 72 for k in range(73)]]
    wall = dict(pts=[[round(x), round(y)] for x, y in pts], kind=kind, breach=[], thick=round(thick))
    # brèches du siège, du côté de l'assaillant
    dmg = pl.get('dmg', 0.0) if pl.get('battle') else 0.0
    dyn = pl.get('dyn', 0) if pl.get('battle') else 0   # la dynamite de l'assaillant : une brèche de plus
    if dmg >= 0.12 or dyn:
        nbr = (1 + int(dmg * 2.4) if dmg >= 0.12 else 0) + dyn
        dmg = max(dmg, 0.12)
        for k in range(min(3 + dyn, nbr)):
            a = att_a + (k - (nbr - 1) / 2) * 0.55 + rng.uniform(-0.15, 0.15)
            r0 = radius(a) + thick / 2
            bx, by = px + math.cos(a) * r0, py + math.sin(a) * r0
            br = 16 + dmg * 34
            for c in wall_cells:
                x, y = center_of(c)
                if t[c] == T_MUR and math.hypot(x - bx, y - by) <= br + 10:
                    t[c] = T_BRECHE
            wall['breach'].append([round(bx), round(by), round(br)])
    m.walls.append(wall)


def _barricades(m, pos, R, bar, rng, t, att_a):
    """Barricades d'une place sans remparts : un anneau de murets aux entrées, ouvert par endroits."""
    px, py = pos
    rb = R + 15
    pts = []
    for k in range(49):
        a = k * 6.283 / 48
        pts.append((px + math.cos(a) * rb, py + math.sin(a) * rb))
    gap = 1.0 - bar
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        if _hash(k, 1, int(R)) < gap * 0.8:
            continue
        for c in _line_cells(a[0], a[1], b[0], b[1]):
            if t[c] not in (T_EAU, T_BATI):
                t[c] = T_BARRICADE
    m.walls.append(dict(pts=[[round(x), round(y)] for x, y in pts], kind='barricade', breach=[], thick=CELL))


def _redoubts(m, pos, R, bar, rng, t, att_a):
    """Redoutes devant des remparts : petits ouvrages de terre face à l'assaillant."""
    px, py = pos
    for k in range(1 + int(bar * 2.5)):
        a = att_a + (k - 1) * 0.6
        d = R + 170
        x, y = px + math.cos(a) * d, py + math.sin(a) * d
        sq = [(x - 30, y - 30), (x + 30, y - 30), (x + 30, y + 30), (x - 30, y + 30), (x - 30, y - 30)]
        for c in _poly_cells(sq):
            if t[c] not in (T_EAU, T_BATI, T_ROUTE):
                t[c] = T_BARRICADE
        m.walls.append(dict(pts=[[round(p[0]), round(p[1])] for p in sq], kind='barricade', breach=[], thick=CELL))


# ---------------------------------------------------------------------- fermes et moulins
def _farms(m, rng, n, t, hf, main):
    placed = []
    tries = 0
    pl = m.place
    while len(placed) < n and tries < n * 30:
        tries += 1
        i, j = rng.randrange(4, COLS - 6), rng.randrange(4, ROWS - 6)
        c = j * COLS + i
        if t[c] not in (T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T):
            continue
        x, y = center_of(c)
        if pl and math.hypot(x - pl['x'], y - pl['y']) < m.town_r + 280:
            continue
        if any(math.hypot(x - a, y - b) < 380 for a, b in placed):
            continue
        fw, fh = 2 + rng.randrange(2), 2
        ok = all(t[c + dj * COLS + di] not in (T_EAU, T_ROUTE, T_GUE) for dj in range(-1, fh + 1)
                 for di in range(-1, fw + 1))
        if not ok:
            continue
        for dj in range(-1, fh + 1):
            for di in range(-1, fw + 1):
                cc = c + dj * COLS + di
                inside = 0 <= di < fw and 0 <= dj < fh
                t[cc] = T_BATI if inside and (di + dj) % 3 != 2 else (T_PRE if t[cc] != T_CHEMIN else T_CHEMIN)
        placed.append((x, y))
        a = 0.0 if rng.random() < 0.5 else 1.5708
        big = main == T_VIGNE and rng.random() < 0.4   # château viticole
        m.buildings.append(dict(x=round(x + CELL * (fw - 1) / 2), y=round(y + CELL * (fh - 1) / 2),
                                w=round(rng.uniform(22, 30) * (1.4 if big else 1)), h=round(rng.uniform(10, 14)),
                                a=round(a, 2), kind='ferme'))
        m.buildings.append(dict(x=round(x + CELL * fw - 6), y=round(y + 4), w=12, h=8, a=round(1.5708 - a, 2),
                                kind='ferme'))
        _path_to_road(m, rng, x, y, t)
        # hameau (C4) : une fois sur quatre, une ou deux maisons de plus autour de la ferme, sur son chemin
        if rng.random() < 0.25:
            for _ in range(1 + (rng.random() < 0.5)):
                a2 = rng.random() * 6.283
                hx, hy = x + math.cos(a2) * rng.uniform(60, 100), y + math.sin(a2) * rng.uniform(60, 100)
                hc = cell_of(hx, hy)
                if hc < 0 or t[hc] not in CULTIVE:
                    continue
                t[hc] = T_BATI
                m.buildings.append(dict(x=round(hx), y=round(hy), w=round(rng.uniform(12, 18)), h=round(rng.uniform(8, 11)),
                                        a=round(a2, 2), kind='maison'))


def _path_to_road(m, rng, x, y, t):
    """Chemin de la ferme à la route (ou au chemin) la plus proche : il longe les bords des parcelles (C4), comme les
    chemins de terre qui séparent les champs, au lieu de les couper en biais."""
    if getattr(m, 'ilot', None):
        pts = _path_on_edges(m, x, y + CELL * 1.5, t)
        if pts:
            for c in _poly_cells(pts):
                if t[c] not in (T_ROUTE, T_BATI, T_GUE):
                    t[c] = T_CHEMIN
            m.roads.append(dict(pts=pts, kind='chemin'))
            return
    best = None
    for r in m.roads:
        for p in r['pts'][::2]:
            d = (p[0] - x) ** 2 + (p[1] - y) ** 2
            if best is None or d < best[0]:
                best = (d, p)
    if best is None or best[0] > 900 ** 2 or best[0] < 40 ** 2:
        return
    pts = _meander(_densify([(x, y + CELL * 1.5), best[1]], 40.0), rng, 20, 300)
    cells = _poly_cells(pts)
    for c in cells:
        if t[c] in (T_EAU, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE):
            return
    for c in cells:
        if t[c] == T_GUE:
            continue
        if t[c] not in (T_ROUTE, T_BATI):
            t[c] = T_CHEMIN
    m.roads.append(dict(pts=pts, kind='chemin'))


def _mill(m, rng, t, hf, main):
    if rng.random() < 0.3:
        return
    riv = [r for r in m.rivers if r['kind'] in ('riviere', 'ruisseau')]
    if riv and rng.random() < 0.6:
        r = riv[rng.randrange(len(riv))]
        dense = _densify(r['pts'], 20.0)
        for _ in range(20):
            p = dense[rng.randrange(len(dense))]
            for dx, dy in ((r['w'] / 2 + 20, 0), (-r['w'] / 2 - 20, 0), (0, r['w'] / 2 + 20), (0, -r['w'] / 2 - 20)):
                c = cell_of(p[0] + dx, p[1] + dy)
                if c >= 0 and t[c] in (T_PRE, T_CHAMP, T_LANDE_T, T_VIGNE_T):
                    t[c] = T_BATI
                    x, y = center_of(c)
                    m.buildings.append(dict(x=round(x), y=round(y), w=12, h=10, a=0, kind='moulin', water=True))
                    return
        return
    if main in (T_PLAINE, T_COLLINES, T_VIGNE, T_LANDE):
        best = None
        for _ in range(60):
            c = rng.randrange(N)
            if t[c] in (T_CHAMP, T_PRE, T_VIGNE_T, T_LANDE_T) and 3 < c % COLS < COLS - 3:
                if best is None or hf[c] > hf[best]:
                    best = c
        if best is not None:
            t[best] = T_BATI
            x, y = center_of(best)
            m.buildings.append(dict(x=round(x), y=round(y), w=9, h=9, a=0, kind='moulin', water=False))


# ====================================================================== composition (SPEC-CARTES.md)
def _ilots(seed, hf, roads, main):
    """C1. Îlots : la cellule de Voronoï d'un germe (germes à 9 cases, environ 180 m ; 12 en lande, 7 dans les vignes),
    coupée en lanières de 2 à 5 cases dans le sens des sillons : celui de la route ou du chemin le plus proche (à moins
    de 250 m), sinon les courbes de niveau, sinon un angle au hasard ; une lanière sur trois est recoupée en travers.
    Renvoie, pour chaque case, le numéro de son îlot et celui de sa lanière (deux cases d'une même lanière ont le même)."""
    S = 12 if main in (T_LANDE, T_DUNES) else (7 if main == T_VIGNE else 9)
    gw, gh = COLS // S + 2, ROWS // S + 2
    germs = []
    for b in range(gh):
        for a in range(gw):
            germs.append(((a + 0.15 + _hash(a, b, seed + 31) * 0.7) * S, (b + 0.15 + _hash(a, b, seed + 32) * 0.7) * S))
    # (points des routes, tous les 40 m, avec leur direction)
    rp = []
    for r in roads:
        d = _densify(r['pts'], 40.0)
        for k in range(1, len(d)):
            (x0, y0), (x1, y1) = d[k - 1], d[k]
            rp.append(((x0 + x1) / 2, (y0 + y1) / 2, math.atan2(y1 - y0, x1 - x0)))
    ang, sw = [], []
    for k, (gx, gy) in enumerate(germs):
        x, y = gx * CELL, gy * CELL
        best = None
        for px, py, a in rp:
            dd = (px - x) ** 2 + (py - y) ** 2
            if best is None or dd < best[0]:
                best = (dd, a)
        if best and best[0] < 250 ** 2:
            a = best[1]
        else:
            i, j = min(COLS - 3, max(2, int(gx))), min(ROWS - 3, max(2, int(gy)))
            gx_, gy_ = (hf[j * COLS + i + 2] - hf[j * COLS + i - 2]) / 80.0, (hf[(j + 2) * COLS + i] - hf[(j - 2) * COLS + i]) / 80.0
            # (sur une pente, les sillons suivent les courbes de niveau : perpendiculaires à la pente)
            a = math.atan2(gy_, gx_) + math.pi / 2 if math.hypot(gx_, gy_) > 0.03 else _hash(k, 77, seed) * math.pi
        ang.append((math.cos(a), math.sin(a)))
        sw.append(2 + int(_hash(k, 78, seed) * 3.99))
    ilot = [0] * N
    strip = [0] * N
    for j in range(ROWS):
        b0 = int(j / S)
        for i in range(COLS):
            a0 = int(i / S)
            best, bk = 1e18, 0
            for b in (b0 - 1, b0, b0 + 1):
                if b < 0 or b >= gh:
                    continue
                for a in (a0 - 1, a0, a0 + 1):
                    if a < 0 or a >= gw:
                        continue
                    k = b * gw + a
                    gx, gy = germs[k]
                    dd = (gx - i - 0.5) ** 2 + (gy - j - 0.5) ** 2
                    if dd < best:
                        best, bk = dd, k
            gx, gy = germs[bk]
            ca, sa = ang[bk]
            u = (i + 0.5 - gx) * ca + (j + 0.5 - gy) * sa
            v = -(i + 0.5 - gx) * sa + (j + 0.5 - gy) * ca
            si = int(math.floor(v / sw[bk]))
            sub = int(math.floor(u / (6 + int(_hash(bk, si + 300, seed) * 5)))) if _hash(bk, si + 200, seed) < 0.33 else 0
            c = j * COLS + i
            ilot[c] = bk
            strip[c] = bk * 4096 + (si + 64) * 32 + (sub + 16)
    return ilot, strip


def _bois_details(rng, t):
    """C3. Clairières dans les grands bois (plus de 30 hectares : une ou deux, en pré) ; bosquets dans les champs."""
    seen = bytearray(N)
    for c0 in range(N):
        if seen[c0] or t[c0] not in (T_BOIS, T_FORET_T):
            continue
        comp, q = [], [c0]
        seen[c0] = 1
        while q:
            c = q.pop()
            comp.append(c)
            i = c % COLS
            for nc in ((c + 1) if i < COLS - 1 else -1, (c - 1) if i > 0 else -1, c + COLS, c - COLS):
                if 0 <= nc < N and not seen[nc] and t[nc] in (T_BOIS, T_FORET_T):
                    seen[nc] = 1
                    q.append(nc)
        if len(comp) < 750:
            continue
        inside = set(comp)
        for _ in range(1 + (len(comp) > 2000)):
            ci = comp[rng.randrange(len(comp))]
            r = 2 + rng.randrange(3)
            x0, y0 = ci % COLS, ci // COLS
            for dj in range(-r, r + 1):
                for di in range(-r, r + 1):
                    if di * di + dj * dj <= r * r + rng.random() * 2:
                        cc = (y0 + dj) * COLS + x0 + di
                        if cc in inside:
                            t[cc] = T_PRE
    for _ in range(5 + rng.randrange(6)):
        c = rng.randrange(N)
        if t[c] not in (T_CHAMP, T_PRE):
            continue
        for _ in range(2 + rng.randrange(5)):
            t[c] = T_BOIS
            i = c % COLS
            nc = c + (1, -1, COLS, -COLS)[rng.randrange(4)]
            if 0 <= nc < N and abs(nc % COLS - i) <= 1 and t[nc] in (T_CHAMP, T_PRE):
                c = nc


def _terroir(m, seed, t, hf, dwat, biome, dept):
    """C2. Le terroir : chaque lanière cultivée est réattribuée selon sa place. Près des maisons, des vergers ; le long de
    l'eau, des prés ; sur les pentes fortes, pas de labours (prés, landes ; vignes sur les coteaux exposés au sud dans le
    Bordelais) ; loin des maisons, des prés plutôt que des champs. Le glacis d'une place forte reste dégagé : pas de
    verger à moins de 300 m de l'enceinte."""
    strip = m.strip
    bati = [c for c in range(N) if t[c] == T_BATI]
    dh = bfs(bati, 32) if bati else bytearray([255]) * N
    glacis = None
    if m.place and m.place.get('fort', 0) >= 1:
        glacis = (m.place['x'], m.place['y'], m.town_r + 300.0)
    groups = {}
    for c in range(N):
        if t[c] in CULTIVE:
            groups.setdefault(strip[c], []).append(c)
    for key, cells in groups.items():
        n = len(cells)
        mh = sum(dh[c] for c in cells) / n
        mw = sum(dwat[c] for c in cells) / n
        # pente moyenne (m par m) et exposition (vers le sud : l'altitude baisse quand y croît)
        sl, south = 0.0, 0.0
        for c in cells:
            i, j = c % COLS, c // COLS
            if 0 < i < COLS - 1 and 0 < j < ROWS - 1:
                gx = (hf[c + 1] - hf[c - 1]) / (2 * CELL)
                gy = (hf[c + COLS] - hf[c - COLS]) / (2 * CELL)
                sl += math.hypot(gx, gy)
                south -= gy
        sl /= n
        south /= n
        cur = t[cells[0]]
        new = cur
        r1, r2 = _hash(key, 401, seed), _hash(key, 402, seed)
        lande = biome[cells[0]] in (T_LANDE, T_DUNES)
        if mh <= 6 and r1 < (0.25 if lande else 0.5):
            new = T_VERGER
        elif mw <= 4 and cur in (T_CHAMP, T_VIGNE_T) and r1 < 0.75:
            new = T_PRE
        elif sl > 0.12 and cur == T_CHAMP:
            new = T_VIGNE_T if dept == '33' and south > 0.03 and r2 < 0.6 else (T_LANDE_T if lande or r2 < 0.3 else T_PRE)
        elif mh >= 30 and cur == T_CHAMP and r2 < 0.12:
            new = T_LANDE_T if lande else T_PRE
        if new != cur:
            for c in cells:
                # (glacis : la part de la lanière qui y entre reste ce qu'elle était)
                if new == T_VERGER and glacis:
                    x, y = center_of(c)
                    if math.hypot(x - glacis[0], y - glacis[1]) < glacis[2]:
                        continue
                t[c] = new


def _path_on_edges(m, x, y, t, maxd=45):
    """Plus court chemin (en cases) d'un point à la route ou au chemin le plus proche, moins coûteux sur les bords des
    îlots : le chemin longe les champs. None si rien à moins de maxd cases, ou si l'eau barre le passage."""
    import heapq
    ilot = m.ilot
    start = cell_of(x, y)
    if start < 0:
        return None
    goal = (T_ROUTE, T_CHEMIN)
    dist = {start: 0.0}
    prev = {}
    q = [(0.0, start)]
    end = None
    while q:
        d, c = heapq.heappop(q)
        if d > dist.get(c, 1e18):
            continue
        if t[c] in goal and c != start:
            end = c
            break
        if d > maxd * 2.5:
            break
        i = c % COLS
        for nc in ((c + 1) if i < COLS - 1 else -1, (c - 1) if i > 0 else -1, c + COLS, c - COLS):
            if not (0 <= nc < N):
                continue
            tn = t[nc]
            if tn in (T_EAU, T_MUR, T_PORTE, T_BRECHE, T_BARRICADE) or (tn == T_BATI and nc != start):
                continue
            ni = nc % COLS
            edge = (ni < COLS - 1 and ilot[nc + 1] != ilot[nc]) or (ni > 0 and ilot[nc - 1] != ilot[nc]) or \
                (nc + COLS < N and ilot[nc + COLS] != ilot[nc]) or (nc - COLS >= 0 and ilot[nc - COLS] != ilot[nc])
            w = 1.0 if edge else 2.6
            if tn == T_GUE:
                w += 4.0
            nd = d + w
            if nd < dist.get(nc, 1e18):
                dist[nc] = nd
                prev[nc] = c
                heapq.heappush(q, (nd, nc))
    if end is None:
        return None
    path = [end]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()
    if len(path) < 3:
        return None
    return [center_of(c) for c in path]
