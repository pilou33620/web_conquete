"""Les routes que la crue de la Garonne et de la Dordogne coupe (SPEC-CARTE-2D, lot H) : là où une route passe plus de
240 m dans les prés noyés, loin des places. Même critère que la carte (web/js/carte/terre.js `inonde`, relief approché
d'après le terrain ; travaux.js), recalculé ici d'après les mêmes données (client_payload) : le serveur est seul à
décider, la carte dessine sa liste (`cut` de l'état). Calculé une fois par carte (sur geo._crue)."""
import math
import re
from array import array

FACTOR = 0.25   # sur une route coupée, on passe à gué ou on fait un détour : quatre fois plus lent
HT = [-.1, -.05, .04, .1, .05, 0, .38, .9, 1.6, .14, .16]   # altitude approchée par terrain (terre.js)
M32 = 0xffffffff


def _hash2(i, j, k):
    n = (i * 374761393 + j * 668265263 + k * 1442695041) & M32
    n = ((n ^ (n >> 13)) * 1274126177) & M32
    return (n ^ (n >> 16)) / 4294967296


def _sn(x):   # le sinus rapide de terre.js (Math.round arrondit les moitiés vers le haut)
    x -= 6.283185307179586 * math.floor(x * 0.15915494309189535 + 0.5)
    y = 1.2732395447351628 * x - 0.4052847345693511 * x * abs(x)
    return 0.225 * (y * abs(y) - y) + y


def _bruit(i, j, s):
    return .5 + .25 * _sn(i * .31 + s) * _sn(j * .27 - s * .6 + 1.5707963267948966) + .25 * _sn((i * .13 - j * .17) + s * 2.3)


def _lerp(a, b, t):
    return a + (b - a) * t


def _clamp(v, a, b):
    return a if v < a else b if v > b else v


class _Terre:
    """Le relief approché et la distance au fleuve, par case, en flottants 32 bits comme les Float32Array du client."""

    def __init__(self, geo, rivers):
        self.W, self.H = W, H = geo.W, geo.H
        TER = geo.terrain
        A = array('f', (HT[TER[k]] + .06 * _hash2(k % W, k // W, 7) for k in range(W * H)))
        for _ in range(3):
            t = array('f', bytes(4 * W * H))
            for j in range(H):
                rows = [r for r in (j - 1, j, j + 1) if 0 <= r < H]
                for i in range(W):
                    s, n = 0.0, 0
                    for r in rows:
                        for x in (i - 1, i, i + 1):
                            if 0 <= x < W:
                                s += A[r * W + x]
                                n += 1
                    t[j * W + i] = s / n
            A = t
        self.ALT = A
        C = self.CRUE = array('f', [3.0]) * (W * H)
        for r in rivers:
            if r['rank'] != 1 or not re.search('Garonne|Dordogne', r['name'] or ''):
                continue
            p = r['pts']
            for k in range(1, len(p)):
                (ax, ay), (bx, by) = p[k - 1], p[k]
                l2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1e-9
                for j in range(max(0, math.floor(min(ay, by) - 3)), min(H - 1, math.ceil(max(ay, by) + 3)) + 1):
                    for i in range(max(0, math.floor(min(ax, bx) - 3)), min(W - 1, math.ceil(max(ax, bx) + 3)) + 1):
                        u = _clamp(((i + .5 - ax) * (bx - ax) + (j + .5 - ay) * (by - ay)) / l2, 0, 1)
                        d = math.hypot(i + .5 - ax - u * (bx - ax), j + .5 - ay - u * (by - ay))
                        if d < C[j * W + i]:
                            C[j * W + i] = d

    def _bil(self, G, x, y):
        W = self.W
        i, j = _clamp(math.floor(x - .5), 0, W - 2), _clamp(math.floor(y - .5), 0, self.H - 2)
        fx, fy, k = _clamp(x - .5 - i, 0, 1), _clamp(y - .5 - j, 0, 1), j * W + i
        return _lerp(_lerp(G[k], G[k + 1], fx), _lerp(G[k + W], G[k + W + 1], fx), fy)

    def inonde(self, x, y):
        d = self._bil(self.CRUE, x, y)
        if d >= 2.1:   # (plus loin, jamais noyé : le seuil ne dépasse pas 2,01 km)
            return False
        a = self._bil(self.ALT, x, y)
        return a <= .11 and d < .25 + 1.1 * _bruit(x * .9, y * .9, 3.3) * (1 - a * 6)


def _sur(pts, s):   # surChemin (lib.js) : le point à s km le long du tracé
    for i in range(1, len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        l = math.hypot(x1 - x0, y1 - y0)
        if s <= l or i == len(pts) - 1:
            k = _clamp(s / l, 0, 1) if l else 0
            return _lerp(x0, x1, k), _lerp(y0, y1, k)
        s -= l


def _rayon(n):   # rayonPlace (guerre.js), d'après la population de départ
    return math.floor(_clamp(46 + 1.55 * math.sqrt(n.get('pop0') or 700), 56, 262) / 8 + .5) * 8 / 180


def spans(geo):
    """{arête : [(début, fin) en km le long de son tracé, …]} : les routes que la crue coupe."""
    if getattr(geo, '_crue', None) is not None:
        return geo._crue
    m = geo.client_payload()
    T = _Terre(geo, m['rivers'])
    places = [(n['x'], n['y'], _rayon(n) + 0.5) for n in m['nodes']]
    out = {}
    for e in m['edges']:
        pts = e['pts']
        if e.get('kind') == 'water' or e.get('ferry') or len(pts) < 2:
            continue
        L = sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts)))
        s, s0 = 0.2, None
        while s <= L:
            x, y = _sur(pts, min(s, L))
            noye = s < L - 0.2 and T.inonde(x, y) and not any(abs(px - x) < 3 and math.hypot(px - x, py - y) < r
                                                              for px, py, r in places)
            if noye and s0 is None:
                s0 = s
            if not noye and s0 is not None:
                if s - s0 >= 0.24:
                    out.setdefault(e['id'], []).append((round(s0, 3), round(s, 3)))
                s0 = None
            s += 0.12
    geo._crue = out
    return out
