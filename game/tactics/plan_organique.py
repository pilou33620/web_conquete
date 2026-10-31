"""Le plan organique d'une ville, celui de la carte (web/js/carte/plan-organique.js : genererPlan, tissu ; ses entrées
faites par planOrganique de web/js/carte/villes.js), porté en Python au bit près pour les batailles : mêmes rues,
mêmes îlots, même enceinte que la carte (tests/test_plan_organique.py le vérifie contre Node).

Tout est en km, repère de la carte. Les entrées viennent du plan V de plan_ville.py (profil : rayon, rMur, graine,
citadelle, gare) et de sa Carte (routes, rivières, eauK). Bibliothèque standard seulement.
"""
import math
from array import array

from .jsmath import atan2, cos, hash2, hypot, jround, sin
from . import plan_ville as PV

TAU = math.pi * 2
HG = 0.08                                    # pas de l'index des graines (km)
LARG_RIVIERE = (0, .32, .16, .09, .06)       # terre.js
DEMI_ROUTE = (.03, .045)                     # villes.js : demi-largeur des chemins et des routes royales
RUE_VILLE = .012                             # demi-largeur d'une route dans la ville
QUARTIERS = dict(vieux=.0032, faubourg=.0025, maraichers=.002, place=.0035, eglise=.0032, jardin=.004, ouvrier=.004,
                 immeubles=.006, usine=.006)   # demi-largeur de rue (km)

# (Float32Array de JS : chaque valeur arrondie en simple précision)
TABLE = array('f', (hash2(i, 7, 3) for i in range(65536))).tolist()


def bruit(x, y, f, d=0):
    x = x / f + d
    y = y / f + d * 1.7
    i, j = math.floor(x), math.floor(y)
    fx, fy = x - i, y - j
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a00, a10 = TABLE[((j & 255) << 8) | (i & 255)], TABLE[((j & 255) << 8) | ((i + 1) & 255)]
    a01, a11 = TABLE[(((j + 1) & 255) << 8) | (i & 255)], TABLE[(((j + 1) & 255) << 8) | ((i + 1) & 255)]
    h = a00 + (a10 - a00) * sx
    b = a01 + (a11 - a01) * sx
    return h + (b - h) * sy


# ---------------------------------------------------------------------- géométrie (polygones = listes de [x, y])
def aire(P):
    s = 0.0
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        s += a[0] * b[1] - b[0] * a[1]
    return s / 2


def centre(P):
    sx = sy = 0   # (pas sum() : Python 3.12+ compense la somme, JS non)
    for p in P:
        sx += p[0]
    for p in P:
        sy += p[1]
    return [sx / len(P), sy / len(P)]


def lerp(a, b, t):
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]


def dist_seg(x, y, a, b):
    """distSeg, et la position du point projeté (le tSeg du module JS)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy or 1)))
    ex, ey = x - a[0] - t * dx, y - a[1] - t * dy
    return math.sqrt(ex * ex + ey * ey), t


def dans_poly(P, x, y):
    d = False
    j = len(P) - 1
    for i in range(len(P)):
        xi, yi = P[i]
        xj, yj = P[j]
        if (yi > y) != (yj > y) and x < ((xj - xi) * (y - yi)) / (yj - yi) + xi:
            d = not d
        j = i
    return d


def couper(P, T, nx, ny, c, tag):
    Q, U = [], []
    n = len(P)
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        da, db = nx * a[0] + ny * a[1] - c, nx * b[0] + ny * b[1] - c
        if da <= 0:
            Q.append(a)
            U.append(T[i])
        if (da <= 0) != (db <= 0):
            k = da / (da - db)
            Q.append([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k])
            U.append(tag if da <= 0 else T[i])
    return Q, U


def normales(P):
    ar = aire(P)
    s = (ar > 0) - (ar < 0)
    out = []
    for i, a in enumerate(P):
        b = P[(i + 1) % len(P)]
        l = hypot(b[0] - a[0], b[1] - a[1]) or 1
        out.append(((-(b[1] - a[1]) / l) * s, ((b[0] - a[0]) / l) * s))
    return out


def rentrer(P, T, d):
    N = normales(P)
    Q, U = P, T
    for i in range(len(P)):
        if len(Q) <= 2:
            break
        nx, ny = N[i]
        a = P[i]
        Q, U = couper(Q, U, -nx, -ny, -(nx * a[0] + ny * a[1]) - d(i), T[i])
    return (Q, U) if len(Q) > 2 else None


def ecart(l, x, y):
    """Écart d'un point au bord de la chaussée, de l'eau ou du rempart d'une ligne (boîte gardée sur la ligne)."""
    b = l.get('boite')
    if b is None:
        xs, ys = [p[0] for p in l['pts']], [p[1] for p in l['pts']]
        w = max(l['ws']) if l['ws'] is not None else l['demi']
        b = l['boite'] = [min(xs) - w, min(ys) - w, max(xs) + w, max(ys) + w]
    hors = max(b[0] - x, x - b[2], b[1] - y, y - b[3])
    if hors > 0.5:
        return hors
    m = math.inf
    pts, ws, demi, sqrt = l['pts'], l['ws'], l['demi'], math.sqrt
    # (dist_seg en ligne, même arithmétique : c'est la boucle la plus chaude du plan)
    for k in range(1, len(pts)):
        ax, ay = pts[k - 1]
        bx, by = pts[k]
        dx, dy = bx - ax, by - ay
        t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1)
        t = 0 if t <= 0 else 1 if t >= 1 else t
        ex, ey = x - ax - t * dx, y - ay - t * dy
        d = sqrt(ex * ex + ey * ey) - (ws[k - 1] + (ws[k] - ws[k - 1]) * t if ws is not None else demi)
        if d < m:
            m = d
    return m


def demi_en(l, x, y):
    ws = l['ws']
    if ws is None:
        return l['demi']
    m, w = math.inf, 0
    pts = l['pts']
    for k in range(1, len(pts)):
        d, t = dist_seg(x, y, pts[k - 1], pts[k])
        if d < m:
            m, w = d, ws[k - 1] + (ws[k] - ws[k - 1]) * t
    return w


# ---------------------------------------------------------------------- génération
def generer_plan(v, eau):
    """genererPlan : {ilots: [{pts, bloc, kinds, type, c, graine, sec, boite}], mur, axes, boite}."""
    P = dict(ilots=[], mur=None, axes=[])
    tissu(P, v, eau)
    b = [math.inf, math.inf, -math.inf, -math.inf]
    for il in P['ilots']:
        xs, ys = [p[0] for p in il['bloc']], [p[1] for p in il['bloc']]
        bo = il['boite'] = [min(xs), min(ys), max(xs), max(ys)]
        for p in il['pts']:
            bo[0], bo[1], bo[2], bo[3] = min(bo[0], p[0]), min(bo[1], p[1]), max(bo[2], p[0]), max(bo[3], p[1])
        b = [min(b[0], bo[0]), min(b[1], bo[1]), max(b[2], bo[2]), max(b[3], bo[3])]
    P['boite'] = b
    return P


def tissu(P, v, eau):
    # shortcut: ères romaine, celte, moderne et futur non portées, seules classique et industrielle servent au jeu
    ere, R, g, cx, cy = v['ere'], v['r'], v['graine'], v['x'], v['y']
    classique, damier = ere == 'classique', bool(v.get('damier'))
    Rh = min(v['rh'] if v.get('rh') is not None else R, R)
    B = 1.75 * R + 0.15

    def D(x, y):
        return hypot(x - cx, y - cy)
    axes = [dict(pts=a['pts'], demi=a['demi'], ws=a['ws'], kind='axe') for a in v['axes'] if len(a['pts']) > 1]
    P['axes'] = axes

    def angle(a):
        return atan2(a['pts'][1][1] - cy, a['pts'][1][0] - cx)
    traces = sorted(axes, key=lambda a: -a['demi'])   # (v.toutes : toutes les routes tracent des rues)
    lignes = traces + [dict(pts=r['pts'], ws=[w + 0.012 for w in r['ws']], demi=None, kind='riviere') for r in v['rivieres']]
    dirAxe = angle(traces[0]) if traces else hash2(g, 1) * TAU
    co, si = cos(dirAxe), sin(dirAxe)
    g251, g97 = g % 251, g % 97

    if damier:
        def base(x, y):
            u, w = (x - cx) * co + (y - cy) * si, -(x - cx) * si + (y - cy) * co
            return 1 - max(abs(u), abs(w) * 1.2) / (R * 0.9 * (0.9 + 0.2 * bruit(x, y, 0.4, g97)))
    else:
        f1, f2, d2 = max(0.3, R * 0.8), max(0.12, R * 0.3), (g % 241) + 50

        def base(x, y):
            forme = 0.82 + 0.5 * (bruit(x, y, f1, g251) - 0.5) + 0.3 * (bruit(x, y, f2, d2) - 0.5)
            return 1 - D(x, y) / (R * forme)

    def fa(x, y):
        m = 0
        for a in axes:
            m = max(m, 1 - ecart(a, x, y) / 0.1)
        return m * (1 - D(x, y) / B)
    if v.get('mur'):
        P['mur'] = v['mur']
        lignes.append(dict(pts=v['mur']['pts'], demi=v['mur'].get('demi', 0.011), ws=None, kind=v['mur']['kind']))
    s0 = 0.075 if damier else 0.05
    lim = R * 1.3 + 0.1

    def esp(d, fin=False):
        if not fin and d > lim:
            return 0.25
        if damier:
            return 0.075
        if d < Rh or classique:
            return min(0.09, 0.05 + (0.035 * d) / max(Rh, 0.6))
        return 0.08

    def deform(d):
        return 0 if damier else 0.45 if d < Rh or classique else 0.12

    # graines : trame (quadtree dans le repère de l'axe principal), déformée, plus fine au cœur
    asp = 1 if damier else 1.4
    seeds = []

    def vers_monde(u, w):
        return cx + u * asp * co - w * si, cy + u * asp * si + w * co
    racine = s0 * 2 ** math.ceil(math.log2(0.3 / s0))   # (0,3 ou 0,4 : les mêmes que V8)

    def semer(u, w, t):
        x, y = vers_monde(u + t / 2, w + t / 2)
        d = D(x, y)
        s = esp(d)
        if t > 1.3 * s and t > 0.03:
            h = t / 2
            semer(u, w, h)
            semer(u + h, w, h)
            semer(u, w + h, h)
            semer(u + h, w + h, h)
            return
        i, j = jround(u / 0.005), jround(w / 0.005)
        jit = 0 if damier else 0.22 if d < Rh or classique else 0.08
        px, py = vers_monde(u + t * (0.5 + (hash2(i, j, g) - 0.5) * jit), w + t * (0.5 + (hash2(j, i, g + 1) - 0.5) * jit))
        A = deform(d) * s
        if A:
            dx = (bruit(px, py, 0.45, 3) - 0.5) * 2 + 0.35 * (bruit(px, py, 0.17, 5) - 0.5) * 2
            dy = (bruit(px, py, 0.45, 6) - 0.5) * 2 + 0.35 * (bruit(px, py, 0.17, 8) - 0.5) * 2
            px += A * dx
            py += A * dy
        seeds.append(dict(x=px, y=py, s=min(t, 1.3 * s), ligne=None))
    nu, nw = math.ceil(B / asp / racine), math.ceil(B / racine)
    for a in range(-nu, nu):
        for b in range(-nw, nw):
            semer(a * racine, b * racine, racine)
    # pas de trame sur l'eau ni sur les lignes (serre : les cellules sont coupées au tracé)
    seeds = [sd for sd in seeds if not eau(sd['x'], sd['y'])
             and not any(ecart(l, sd['x'], sd['y']) < 0.6 * sd['s'] for l in lignes)]
    # graines en miroir de part et d'autre de chaque ligne : la ligne devient une rue (ou un quai, un rempart)
    for li, l in enumerate(lignes):
        reste = 0
        pts, ws = l['pts'], l['ws']
        for k in range(1, len(pts)):
            a, b = pts[k - 1], pts[k]
            L = hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
            ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            t = reste
            while t < L:
                x, y = a[0] + ux * t, a[1] + uy * t
                d = D(x, y)
                s = esp(d, True)
                demi = ws[k - 1] + ((ws[k] - ws[k - 1]) * t) / L if ws is not None else l['demi']
                if d > 0.9 * s0:
                    o = demi + 0.5 * s
                    for c in (1, -1):
                        sx, sy = x - uy * o * c, y + ux * o * c
                        if not eau(sx, sy) and not any(mi != li and ecart(m, sx, sy) < 0.6 * s for mi, m in enumerate(lignes)):
                            seeds.append(dict(x=sx, y=sy, s=s, ligne=li, cote=c, o=o))
                t += s * asp * 0.95
            reste = t - L
    # qui fait partie de la ville : le cœur, les faubourgs le long des routes
    for k, sd in enumerate(seeds):
        sd['b'] = base(sd['x'], sd['y'])
        f = fa(sd['x'], sd['y']) if sd['ligne'] is not None and lignes[sd['ligne']]['kind'] == 'axe' else 0
        sd['garde'] = sd['b'] > 0 or (f > 0.12 and hash2(k, g, 4) < 0.85)
    grille = {}
    for k, sd in enumerate(seeds):
        grille.setdefault(math.floor(sd['x'] / HG) * 100003 + math.floor(sd['y'] / HG), []).append(k)

    def voisins(x, y, r):
        out = []
        for i in range(math.floor((x - r) / HG), math.floor((x + r) / HG) + 1):
            for j in range(math.floor((y - r) / HG), math.floor((y + r) / HG) + 1):
                for k in grille.get(i * 100003 + j, ()):
                    q = seeds[k]
                    if (q['x'] - x) * (q['x'] - x) + (q['y'] - y) * (q['y'] - y) < r * r:
                        out.append(k)
        return out
    # cellules de Voronoï des graines gardées ; chaque côté retient la graine voisine
    cellules = []
    for k, sd in enumerate(seeds):
        if not sd['garde']:
            continue
        x0, y0 = sd['x'], sd['y']
        h = 1.5 * sd['s'] * asp if sd['ligne'] is None else max(0.8 * sd['s'] * asp, 1.15 * sd['o'])
        r0 = 2.4 * sd['s'] * asp
        vide = False
        for essai in range(2):
            Q = [[x0 - h, y0 - h], [x0 + h, y0 - h], [x0 + h, y0 + h], [x0 - h, y0 + h]]
            U = [-1, -1, -1, -1]
            vs = []
            for j in voisins(x0, y0, r0):
                if j != k:
                    vs.append(((seeds[j]['x'] - x0) * (seeds[j]['x'] - x0) + (seeds[j]['y'] - y0) * (seeds[j]['y'] - y0), j))
            vs.sort(key=lambda e: e[0])
            rho2 = 2 * h * h
            for d2, j in vs:
                if d2 > 4 * rho2:
                    break
                q = seeds[j]
                nx, ny = q['x'] - x0, q['y'] - y0
                Q, U = couper(Q, U, nx, ny, (nx * (x0 + q['x'])) / 2 + (ny * (y0 + q['y'])) / 2, j)
                if len(Q) < 3:
                    vide = True
                    break
                rho2 = 0
                for p in Q:
                    rho2 = max(rho2, (p[0] - x0) * (p[0] - x0) + (p[1] - y0) * (p[1] - y0))
            if vide or 4 * rho2 <= r0 * r0:
                break
            r0 = 2 * math.sqrt(rho2) + 0.01
        if vide:
            continue
        # chaque ligne à portée coupe la cellule au tracé, du côté de sa graine (côté -10 - li)
        for li, l in enumerate(lignes):
            if ecart(l, x0, y0) > 3 * h:
                continue
            m, Pp = math.inf, None
            pts = l['pts']
            for q in range(1, len(pts)):
                d, t = dist_seg(x0, y0, pts[q - 1], pts[q])
                if d < m:
                    m, Pp = d, lerp(pts[q - 1], pts[q], t)
            if m < 1e-9:
                continue
            nx, ny = (x0 - Pp[0]) / m, (y0 - Pp[1]) / m
            Q, U = couper(Q, U, -nx, -ny, -(nx * Pp[0] + ny * Pp[1]), -10 - li)
            if len(Q) < 3:
                vide = True
                break
        if vide:
            continue
        ce = dict(pts=Q, tags=U, k=k, c=centre(Q))
        sd['cellule'] = ce
        cellules.append(ce)
    # quartier de chaque îlot selon l'ère
    mur = P['mur']

    def dedans(x, y):
        return dans_poly(mur['pts'], x, y) if mur else D(x, y) < Rh * 0.8
    for ce in cellules:
        x, y = ce['c']
        d, b, n, f = D(x, y), seeds[ce['k']]['b'], hash2(ce['k'], g, 11), fa(x, y)
        if classique:
            t = 'vieux' if (dedans(x, y) if mur else b > (0.12 if R < 0.3 else 0.3)) else 'faubourg' if b > 0.1 or f > 0.3 else 'maraichers'
        elif dedans(x, y) or d < Rh * 0.85:
            t = 'vieux'
        else:
            t = ('faubourg' if f > 0.3 else 'maraichers') if b < 0.08 else 'usine' if n < 0.1 else \
                'immeubles' if d < Rh * 1.3 and n < 0.5 else 'ouvrier'
        ce['type'] = t
    # rues : chaque côté rentre de la demi-largeur de sa rue (ou de la route, du quai, du rempart)
    ilots = []
    for ce in cellules:
        sd = seeds[ce['k']]
        tags, cp = ce['tags'], ce['pts']

        def sorte(j):
            if j <= -10:
                return lignes[-10 - j]['kind']
            if j >= 0 and sd['ligne'] is not None and seeds[j]['ligne'] == sd['ligne'] and seeds[j]['cote'] != sd['cote']:
                return lignes[sd['ligne']]['kind']
            return 'bord' if j < 0 or 'cellule' not in seeds[j] else 'rue'
        kinds = [sorte(j) for j in tags]

        def ligne_de(i):
            return lignes[-10 - tags[i] if tags[i] <= -10 else sd['ligne']]

        def milieu(i):
            a, b = cp[i], cp[(i + 1) % len(cp)]
            return (a[0] + b[0]) / 2, (a[1] + b[1]) / 2

        def dbloc(i):
            kd = kinds[i]
            if kd == 'bord':
                return 0
            if kd == 'rue':
                return max(QUARTIERS[ce['type']], QUARTIERS[seeds[tags[i]]['cellule']['type']])
            return demi_en(ligne_de(i), *milieu(i))
        r = rentrer(cp, kinds, dbloc)
        if not r or abs(aire(r[0])) < 0.00015:
            continue
        bloc, bk = r
        mouille = sum(1 for p in bloc if eau(p[0], p[1]))
        if mouille >= 2 or eau(*centre(bloc)):
            continue

        def dsol(i):
            kd = kinds[i]
            if kd == 'bord' or kd == 'rue':
                return 0
            return demi_en(ligne_de(i), *milieu(i)) - (0.012 if kd == 'riviere' else 0)
        sol = rentrer(cp, kinds, dsol)
        ilots.append(dict(pts=sol[0] if sol else bloc, bloc=bloc, kinds=bk, type=ce['type'], c=centre(bloc),
                          graine=hash2(ce['k'], g, 77), sec=not mouille))
    # lieux : place, églises du vieux centre, jardin public (pas de gare : celle du jeu)
    place, m = None, math.inf
    for il in ilots:
        dd = (il['c'][0] - cx) * (il['c'][0] - cx) + (il['c'][1] - cy) * (il['c'][1] - cy)
        if dd < m:
            m, place = dd, il
    if place:
        place['type'] = 'place'
    choix = []
    nmax = min(12, math.floor((Rh / 0.33) * (Rh / 0.33)))
    for il in sorted((il for il in ilots if il['type'] == 'vieux' and abs(aire(il['bloc'])) > 0.0022), key=lambda il: il['graine']):
        if len(choix) >= nmax:
            break
        if all(hypot(p[0] - il['c'][0], p[1] - il['c'][1]) > 0.25 for p in [[cx, cy]] + [c['c'] for c in choix]):
            choix.append(il)
    for il in choix:
        il['type'] = 'eglise'
    if Rh > 0.6:
        vieux = [il for il in ilots if il['type'] == 'vieux' and D(*il['c']) > Rh * 0.4]
        if vieux:
            max(vieux, key=lambda il: abs(aire(il['bloc'])))['type'] = 'jardin'
    P['ilots'] = ilots


# ---------------------------------------------------------------------- les entrées, comme planOrganique (villes.js)
def d_seg(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = PV.clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy or 1), 0, 1)
    return hypot(a[0] + dx * t - x, a[1] + dy * t - y)


def autour(pts, x, y, B):
    """La partie d'une polyligne à moins de B du point (du premier au dernier segment proche)."""
    i0 = i1 = -1
    for k in range(1, len(pts)):
        if d_seg(x, y, pts[k - 1], pts[k]) < B:
            if i0 < 0:
                i0 = k - 1
            i1 = k
    return None if i0 < 0 else pts[i0:i1 + 1]


def enceinte_carte(n, f, r):
    """La courtine des remparts de map.js (wallGeom) au rayon r (km)."""
    a0 = math.fmod(n['id'] * 2.399, TAU)
    pts = []

    def P(a):
        return [n['x'] + cos(a) * r, n['y'] + sin(a) * r * .86]
    if f <= 2:
        for i in range(13):
            pts.append(P(a0 + i * TAU / 12))
    else:
        m = 6 if f >= 4 else 5
        w = math.pi / m * .42
        for k in range(m):
            a = a0 + (k + .5) * TAU / m
            pts += [P(a - w), P(a + w)]
        pts.append(pts[0])
    return pts


def plan_organique(K, V):
    """planOrganique : le plan organique du plan V (gardé dans V['org']), None pour un fortin."""
    if 'org' in V:
        return V['org']
    Pf = V['Pf']
    n = Pf['n']
    if Pf['modele'] == 'fortin':
        V['org'] = None
        return None
    nx_, ny_ = n['x'], n['y']
    ere = 'industrielle' if Pf['annee'] >= 1860 else 'classique'
    r = Pf['R'] / PV.S * (1 + .05 * (Pf['d'] or 0))
    rMur = V['rMur'] / PV.S
    B = 1.75 * r + .3
    axes = []

    def pres(q):
        return any(d_seg(q[0], q[1], a['pts'][k - 1], a['pts'][k]) < .03 for a in axes for k in range(1, len(a['pts'])))
    for ed in sorted(K.edges, key=lambda e: -bool(e.get('royal'))):
        pts = autour(ed['pts'][::-1] if ed['b'] == n['id'] else ed['pts'], nx_, ny_, B)
        if not pts:
            continue
        ech = []
        for k in range(1, len(pts)):
            a, b = pts[k - 1], pts[k]
            t, pas = 0, .05 / (hypot(b[0] - a[0], b[1] - a[1]) or 1)
            while t < 1:
                ech.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
                t += pas
        ech.append(pts[-1])
        ech = [q for q in ech if hypot(q[0] - nx_, q[1] - ny_) < B + .3]
        i0 = 0
        while i0 < len(ech) and pres(ech[i0]):
            i0 += 1
        i1 = len(ech)
        while i1 > i0 and pres(ech[i1 - 1]):
            i1 -= 1
        sl = ech[max(0, i0 - 1):min(len(ech), i1 + 1)]
        dense = [q for k, q in enumerate(sl) if k % 5 == 0 or k == len(sl) - 1]
        if len(dense) < 2 or (any(pres(q) for q in ech[i0:i1]) and i1 - i0 < .5 * len(ech)):
            continue
        Dr = DEMI_ROUTE[1 if ed.get('royal') else 0]
        ws = [Dr + (RUE_VILLE - Dr) * PV.clamp((1.25 * r - hypot(q[0] - nx_, q[1] - ny_)) / (.35 * r), 0, 1) for q in dense]
        axes.append(dict(pts=dense, ws=ws, libre=True, grand=bool(ed.get('royal')), demi=Dr))
    rivieres = []
    for rv in K.rivers:
        pts = autour(rv['pts'], nx_, ny_, B + .3)
        w = ((LARG_RIVIERE[rv['rank']] if 0 <= rv['rank'] < len(LARG_RIVIERE) else 0) or .05) / 2
        if pts:
            rivieres.append(dict(pts=pts, ws=[w] * len(pts), w=w))
    # ni îlot sur l'eau, ni sous la citadelle, la gare, le château

    def km(x, y):
        return [nx_ + (x - PV.IC[0]) / PV.S, ny_ + (y - PV.IC[1]) / PV.S]
    libres = []
    if V['citadelle']:
        libres.append((km(*V['citadelle']['C']), 90 / PV.S))
    if V['gare']:
        libres.append((km(V['gare']['x'], V['gare']['y']), 50 / PV.S))
    if Pf['modele'] == 'castrum':
        libres.append(([nx_, ny_], 30 / PV.S))
    # (boîte de chaque rivière, élargie : écarte vite les points loin de l'eau sans changer la réponse)
    rbo = [(min(p[0] for p in rv['pts']) - 2 * rv['w'], min(p[1] for p in rv['pts']) - 2 * rv['w'],
            max(p[0] for p in rv['pts']) + 2 * rv['w'], max(p[1] for p in rv['pts']) + 2 * rv['w']) for rv in rivieres]

    def eau(x, y):
        if K.eauK(x, y) > .42:
            return True
        for rv, bo in zip(rivieres, rbo):
            if bo[0] <= x <= bo[2] and bo[1] <= y <= bo[3]:
                p = rv['pts']
                if any(d_seg(x, y, p[k - 1], p[k]) < rv['w'] for k in range(1, len(p))):
                    return True
        return any(hypot(x - c[0], y - c[1]) < d for c, d in libres)
    f = Pf['f']
    mur = dict(pts=enceinte_carte(n, f, rMur), kind='mur', demi=.012, dessine=False) if f > 0 else \
        dict(pts=enceinte_carte(n, 1, rMur), kind='boulevard', demi=.015) if Pf['murs'] == 'cours' else None
    v = dict(x=nx_, y=ny_, pop=Pf['pop'], ere=ere, r=r, rh=rMur if mur else r * .5, graine=Pf['sd'], axes=axes,
             rivieres=rivieres, mur=mur, toutes=True, gare=False, serre=True,
             damier=Pf['modele'] in ('bastide', 'place'))
    V['org'] = generer_plan(v, eau)
    return V['org']


def plan(geo, nid, annee=1789, f=None, pop=None, d=0):
    """Le plan organique de la place nid dans cet état (celui de la carte), None pour un fortin ; gardé avec PV.plan."""
    return plan_organique(PV.carte_de(geo), PV.plan(geo, nid, annee, f, pop, d))
