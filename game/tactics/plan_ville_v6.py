# FIGÉ : plan_ville.py des cartes de version 6 (avant les villes denses dans leurs murs et collées à leur fleuve), pour
# qu'une bataille en cours d'une sauvegarde garde sa carte (terrain.VERSION). Ne pas modifier.
"""Le plan d'une ville, celui de « Voir l'intérieur » (web/js/carte/villes.js : profilVille, genererInterieur), porté
en Python pour les batailles (terrain.py) : mêmes rues, mêmes îlots, mêmes murs, mêmes lieux.

Portage fidèle de la géométrie : même tirage (alea : mulberry32), mêmes hachages (hash2, hashS : FNV-1a), même calcul
entier sur 32 bits, même Math.hypot que V8 et même arrondi que Math.round ; la même ville sort des deux côtés (au
millième d'unité près, tests/test_plan_ville.py le vérifie pour toutes les places). Ce que le plan ne dessine que dans
l'intérieur (fermes, métiers, peinture) n'est pas porté : rien de ce qui suit le tirage des îlots ne le consomme.

Repère : unités de l'intérieur, S = 180 par km, centre de la ville en IC ; x vers l'est, y vers le sud (comme la carte).
L'état qui change la géométrie : l'année (avant ou après 1860), f (l'enceinte), pop (la taille, par paliers), d (les
faubourgs). Bibliothèque standard seulement (serveur sur Raspberry Pi, Pyto sur iPad).
"""
import math

from .jsmath import alea, atan2, cos, hash2, hashS, hypot, jround, sin  # noqa: F401

S, IW, IH = 180, 1000, 760
IC = (500.0, 380.0)
TAU = math.pi * 2
M = 1000.0 / S   # mètres par unité
RUE_MAIN, RUE = 1.25, .6   # (la moitié des rues, en unités : 13 m pour une grande rue, 6,7 m pour les autres)


def mod(a, n):
    return math.fmod(math.fmod(a, n) + n, n)


def clamp(v, a, b):
    return a if v < a else (b if v > b else v)


def lerp(a, b, t):
    return a + (b - a) * t


def ang_diff(a, b):
    return atan2(sin(a - b), cos(a - b))


def aire(q):
    s = 0.0
    for k in range(len(q)):
        a, b = q[k], q[(k + 1) % len(q)]
        s += a[0] * b[1] - b[0] * a[1]
    return s / 2


def dist_poly(pts, x, y):
    d = 1e9
    for i in range(1, len(pts)):
        ax, ay = pts[i - 1]
        bx, by = pts[i]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        if not den:
            return math.nan   # (comme en JS : 0/0, et Math.min garde le NaN)
        k = clamp(((x - ax) * dx + (y - ay) * dy) / den, 0, 1)
        d = min(d, hypot(x - ax - k * dx, y - ay - k * dy))
    return d


def bastions(cx, cy, N, Rb, rot):
    """Le tracé bastionné de lib.js (premier système de Vauban) : sommets V, escarpe poly, demi-lunes ravs, côtés."""
    V, poly, ravs, cotes = [], [], [], []
    for i in range(N):
        a = rot + i * TAU / N
        V.append((cx + cos(a) * Rb, cy + sin(a) * Rb))
    for i in range(N):
        A, B = V[i], V[(i + 1) % N]
        L = hypot(B[0] - A[0], B[1] - A[1])
        Mi = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
        nl = hypot(cx - Mi[0], cy - Mi[1])
        nin = ((cx - Mi[0]) / nl, (cy - Mi[1]) / nl)
        perp = L / (8 if N <= 4 else 7 if N == 5 else 6)
        D = (Mi[0] + nin[0] * perp, Mi[1] + nin[1] * perp)
        uA = [D[0] - A[0], D[1] - A[1]]
        lA = hypot(*uA)
        uB = [D[0] - B[0], D[1] - B[1]]
        lB = hypot(*uB)
        uA = (uA[0] / lA, uA[1] / lA)
        uB = (uB[0] / lB, uB[1] / lB)
        FA = (A[0] + uA[0] * 2 * L / 7, A[1] + uA[1] * 2 * L / 7)
        FB = (B[0] + uB[0] * 2 * L / 7, B[1] + uB[1] * 2 * L / 7)
        r = hypot(FA[0] - FB[0], FA[1] - FB[1])
        GA = (FB[0] + uB[0] * r, FB[1] + uB[1] * r)
        GB = (FA[0] + uA[0] * r, FA[1] + uA[1] * r)
        poly += [FA, GA, GB, FB, B]
        u = ((B[0] - A[0]) / L, (B[1] - A[1]) / L)
        out = (-nin[0], -nin[1])
        ravs.append(dict(apex=(Mi[0] + out[0] * L * .34, Mi[1] + out[1] * L * .34),
                         b1=(Mi[0] + out[0] * L * .04 - u[0] * L * .2, Mi[1] + out[1] * L * .04 - u[1] * L * .2),
                         b2=(Mi[0] + out[0] * L * .04 + u[0] * L * .2, Mi[1] + out[1] * L * .04 + u[1] * L * .2),
                         M=Mi, out=out, u=u))
        cotes.append(dict(A=A, B=B, FA=FA, FB=FB, GA=GA, GB=GB, M=Mi, nin=nin,
                          porte=((GA[0] + GB[0]) / 2, (GA[1] + GB[1]) / 2)))
    return dict(V=V, poly=poly, ravs=ravs, cotes=cotes, C=(cx, cy), N=N, Rb=Rb)


# ---------------------------------------------------------------------- la carte du jeu, comme carteDe(map.m)
class Carte:
    """Ce que villes.js lit dans map.m (client_payload) : places, routes, rivières (en km, arrondies au centième comme
    la charge envoyée au navigateur), terrain."""

    def __init__(self, geo):
        self.geo = geo
        self.GW, self.GH, self.TER = geo.W, geo.H, geo.terrain
        self.EAU = bytes(1 if t in (0, 1) else 0 for t in self.TER)
        self.nodes, self.edges = geo.nodes, geo.edges
        self.rivers = [dict(name=r['name'], rank=r['rank'], pts=[[round(c, 2) for c in geo.xy(lat, lon)]
                                                                  for lon, lat in r['pts']]) for r in geo.src['rivers']]
        self.noeud = {n['id']: n for n in geo.nodes}
        self.y_mont = geo.xy(43.2, 0)[1]
        self.plans = {}

    def ter(self, x, y):
        i, j = int(x), int(y)
        return self.TER[j * self.GW + i] if 0 <= i < self.GW and 0 <= j < self.GH else 0

    def eauK(self, x, y):
        i, j = math.floor(x - .5), math.floor(y - .5)
        fx, fy = x - .5 - i, y - .5 - j
        e, GW, GH = self.EAU, self.GW, self.GH
        # (comme ter(i + .5, j + .5) dans la mer ou l'eau, en plus vite : une carte de bataille en lit 15 000)
        if 0 <= i < GW - 1 and 0 <= j < GH - 1:
            k = j * GW + i
            w0, w1, w2, w3 = e[k], e[k + 1], e[k + GW], e[k + GW + 1]
        else:
            w0, w1, w2, w3 = ((e[b * GW + a] if 0 <= a < GW and 0 <= b < GH else 1)
                              for a, b in ((int(a + .5), int(b + .5)) for a, b in ((i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1))))
        a0, a1 = w0 + (w1 - w0) * fx, w2 + (w3 - w2) * fx
        return a0 + (a1 - a0) * fy


_CARTES = {}


def carte_de(geo):
    K = _CARTES.get(id(geo))
    if K is None or K.geo is not geo:
        K = _CARTES[id(geo)] = Carte(geo)
    return K


BASQUES = {'Bayonne', 'Biarritz', 'Hendaye', 'Saint-Jean-de-Luz', 'Hasparren', 'Saint-Jean-Pied-de-Port', 'Mauléon',
           'Ustaritz', 'Espelette', 'Cambo-les-Bains', 'Saint-Palais'}
BASTIDES = {'Libourne', 'Sainte-Foy-la-Grande', 'Sauveterre-de-Guyenne', 'Créon', 'Villeréal', 'Eymet', 'Domme',
            'Lalinde', 'Villeneuve-sur-Lot', 'Monflanquin', 'Castillonnès', "Tournon-d'Agenais", 'Miramont', 'Cadillac',
            'Sauveterre-de-Béarn', 'Navarrenx', 'Beaumont-du-Périgord', 'Villefranche-du-Périgord', 'Monpazier', 'Vianne',
            'Hastingues'}


def style_de(n):
    if n['dept'] == '64':
        return 'basque' if n['name'] in BASQUES or n['x'] < 75 else 'bearn'
    return {'33': 'bordelais', '24': 'perigord', '40': 'landes', '47': 'agenais'}.get(n['dept'], 'bordelais')


def ere(a):
    return 1860 if a >= 1860 else 1789


def rayon(pop):   # (villes.js, rayon)
    return jround(clamp(1.45 * math.sqrt(pop) - 20, 20, 262) / 4) * 4


def _loc(n, x, y):
    return (IC[0] + (x - n['x']) * S, IC[1] + (y - n['y']) * S)


def profil_ville(K, n, annee=1789, f=None, pop=None, d=0):
    pop0 = n.get('pop0') or 700
    pop = pop or pop0
    spec = n.get('spec') or []
    annee = ere(annee or 1789)
    if f is None:
        f = n.get('fort') or 0
    d = d or 0
    R = rayon(pop)
    routes = []
    for ed in K.edges:
        if ed['a'] != n['id'] and ed['b'] != n['id']:
            continue
        pts = ed['pts'] if ed['a'] == n['id'] else ed['pts'][::-1]
        p = next((q for q in pts if hypot(q[0] - n['x'], q[1] - n['y']) > .9), pts[-1])
        a = atan2(p[1] - n['y'], p[0] - n['x'])
        autre = K.noeud.get(ed['b'] if ed['a'] == n['id'] else ed['a'])
        if not any(abs(ang_diff(r['a'], a)) < .4 for r in routes):
            routes.append(dict(a=a, royal=bool(ed.get('royal')), vers=autre and autre['name']))
    routes.sort(key=lambda r: -r['royal'])
    rivs = []
    for r in K.rivers:
        proches = [k for k, q in enumerate(r['pts']) if hypot(q[0] - n['x'], q[1] - n['y']) < 4.6]
        if len(proches) < 2 or not any(hypot(q[0] - n['x'], q[1] - n['y']) < 2.6 for q in r['pts']):
            continue
        i0, i1 = proches[0], proches[-1]
        rivs.append(dict(name=r['name'], rank=r['rank'], w=([0, 74, 34, 20, 13][r['rank']] if 0 <= r['rank'] <= 4 else 0) or 11,
                         pts=[_loc(n, *q) for q in r['pts'][max(0, i0 - 1):i1 + 2]]))
    mer = None
    sx = sy = 0.0
    c = 0
    a = 0.0
    while a < TAU:
        for dd in (1, 2, 3):
            if K.eauK(n['x'] + cos(a) * dd, n['y'] + sin(a) * dd) > .5:
                sx += cos(a) / dd
                sy += sin(a) / dd
                c += 1
        a += TAU / 24
    if c:
        mer = dict(a=atan2(sy, sx), n=c)
    comptes = [0] * 11
    for dx in range(-4, 5):
        for dy in range(-4, 5):
            comptes[K.ter(n['x'] + dx, n['y'] + dy)] += 1
    relief = (comptes[6] + comptes[7] * 2 + comptes[8] * 3) / 81
    style = style_de(n)
    port = 'port' in spec and bool(mer or any(r['rank'] <= 2 for r in rivs))
    typ, nf, name = n['type'], n.get('fort') or 0, n['name']
    if typ == 'fort' and (name.startswith('Fort') or pop0 <= 450):
        modele = 'fortin'
    elif nf >= 3 and pop0 < 4000 and not port:
        modele = 'place'
    elif name in BASTIDES:
        modele = 'bastide'
    elif typ == 'capitale' or pop0 >= 6000:
        modele = 'grande'
    elif typ == 'fort':
        modele = 'castrum'
    elif typ == 'ville':
        modele = 'port' if port and mer else 'ville'
    elif relief > .55 or (n['dept'] == '64' and n['y'] > K.y_mont - 25):
        modele = 'montagne'
    elif n['dept'] == '40' and comptes[3] + comptes[4] > 34:
        modele = 'airial'
    elif len(routes) <= 2:
        modele = 'rue'
    else:
        modele = 'rond'
    demoli = annee >= 1860 and f < 3 and modele in ('grande', 'ville', 'port')
    if modele in ('fortin', 'place'):
        murs = 'bastions'
    elif demoli:
        murs = 'cours' if (nf > 0 or f > 0) else None
    else:
        murs = 'bastions' if f >= 3 else ('medieval' if f >= 1 else None)
    return dict(n=n, pop=pop, spec=spec, R=R, routes=routes, rivs=rivs, mer=mer, comptes=comptes, relief=relief,
                style=style, port=port, modele=modele, murs=murs, annee=annee, f=f, d=d, sd=hashS(n.get('slug') or name),
                citadelle=f >= 2 and modele not in ('fortin', 'place') and pop0 > 2000,
                fau=1 + .18 * d, dfau=.08 * d)


# les îlots sans maisons et leur part par taille de ville (villes.js, CLOS et DENSITE)
CLOS = ['verger', 'verger', 'potager', 'potager', 'potager', 'cour', 'cour', 'vague']
DENSITE = dict(bourg=(.2, .95, .2), moyenne=(.2, .95, .2), grande=(.3, .9, .2))


def generer_interieur(K, Pf):
    """genererInterieur : les îlots (q, c, d, zone, main, aire, rôle…), les rues, l'enceinte (trace, rect, murLigne),
    la citadelle, la gare, les routes jusqu'au bord de la scène."""
    R = alea(Pf['sd'])
    n, Rv, sd = Pf['n'], Pf['R'], Pf['sd']
    ilots, rues, plus = [], [], []
    V = dict(Pf=Pf, type='grande' if Rv > 136 else 'moyenne' if Rv > 80 else 'bourg',
             larg=[1.5, 2.6] if Rv > 136 else [1.5, 2.7] if Rv > 80 else [1.6, 3], rues=rues, lieux={}, placeCentre=False,
             murLigne=None, rect=None, trace=None, citadelle=None, gare=None, murInt=None, rPlace=None, plus=plus)

    def eauL(x, y):
        return K.eauK(n['x'] + (x - IC[0]) / S, n['y'] + (y - IC[1]) / S)

    boites = [(min(p[0] for p in r['pts']), min(p[1] for p in r['pts']), max(p[0] for p in r['pts']),
               max(p[1] for p in r['pts']), r['w'] / 2) for r in Pf['rivs']]

    vus = {}   # (un sommet sert à quatre îlots)

    def pres(x, y, m=4):
        v = vus.get((x, y, m))
        if v is None:
            v = vus[x, y, m] = _pres(x, y, m)
        return v

    def _pres(x, y, m):
        for r, (x0, y0, x1, y1, w) in zip(Pf['rivs'], boites):
            e = w + m + 1e-6   # (loin de la boîte de la rivière : loin de la rivière, sans calcul)
            if x0 - e < x < x1 + e and y0 - e < y < y1 + e and dist_poly(r['pts'], x, y) < w + m:
                return True
        return eauL(x, y) > .42
    V['eau'] = lambda x, y: pres(x, y, 0)

    def ajout(q, **o):
        if any(pres(p[0], p[1]) for p in q) or pres((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, 6):
            return None
        c = ((q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4)
        b = dict(q=q, c=c, d=hypot(c[0] - IC[0], c[1] - IC[1]), zone='ville', main=False, aire=abs(aire(q)))
        b.update(o)
        ilots.append(b)
        return b

    ang_routes = [r['a'] for r in Pf['routes']]

    def tourne(a, u, v):
        return (cos(a) * u - sin(a) * v, sin(a) * u + cos(a) * v)
    routesL = []
    for k, r in enumerate(Pf['routes']):
        pts = []
        for d in range(0, 761, 20):
            a = r['a'] + .06 * sin(d / 90 + k * 2.1 + sd % 7)
            pts.append((IC[0] + cos(a) * d, IC[1] + sin(a) * d))
        routesL.append(dict(r, pts=pts))
    V['routesL'] = routesL

    def polaire(R0, R1, arc=16, pasR=12, tord=.3, zone='ville', cotes=None):
        """Les anneaux autour de la place (R0 : son bord), d'îlots de pasR de profondeur et d'environ arc de long : en
        s'éloignant de la place, une rue naît entre deux autres dès que l'îlot dépasserait 1,5 arc."""
        angs = ang_routes[:]
        while len(angs) < 3:
            angs.append((angs[0] if angs else 0) + TAU * (len(angs) / 3) + .4)
        angs = sorted(mod(a, TAU) for a in angs)
        rings = []
        r = R0
        while r < R1 - pasR * .6:
            rings.append(r)
            r += pasR * (.85 + R() * .3)
        rings.append(R1)
        A = [dict(a=a, id=i, route=True, m0=0) for i, a in enumerate(angs)]
        nid = len(A)
        memo = {}

        def P(m, s):
            p = memo.get((m, s['id']))
            if p is None:
                a = s['a'] + tord * min(arc / rings[m], .33) * sin(s['id'] * 1.7 + m * .9 + sd % 11)
                rr = rings[m] * (1 + .06 * sin(a * 3 + sd % 5))
                p = memo[m, s['id']] = (IC[0] + cos(a) * rr, IC[1] + sin(a) * rr)
            return p
        bandes = []
        for m in range(len(rings) - 1):
            rm = (rings[m] + rings[m + 1]) / 2
            B = []
            for k, s in enumerate(A):
                a1 = A[k + 1]['a'] if k + 1 < len(A) else A[0]['a'] + TAU
                n_ = jround((a1 - s['a']) * rm / arc)
                B.append(s)
                for q in range(1, n_):
                    B.append(dict(a=s['a'] + (a1 - s['a']) * q / n_ + (R() - .5) * .25 * arc / rm, id=nid, route=False, m0=m))
                    nid += 1
            A = B
            bandes.append(A)
            for k, s in enumerate(A):
                t = A[(k + 1) % len(A)]
                ajout([P(m, t), P(m, s), P(m + 1, s), P(m + 1, t)], main=s['route'] or t['route'], zone=zone, anneau=m,
                      secteur=k, cotes=cotes)
        for k, s in enumerate(A):   # (n : le rang de la rue, pour les batailles sur une carte réduite)
            rues.append(dict(pts=[P(m, s) for m in range(s['m0'], len(rings))], main=s['route'], n=k))
            if s['route']:   # (pour les batailles : les rues maîtresses qui mènent aux routes)
                V.setdefault('radiales', []).append((s['a'], rues[-1]['pts']))
        for m in range(len(rings)):
            L = bandes[min(m, len(bandes) - 1)] if bandes else A
            rues.append(dict(pts=[P(m, s) for s in L + L[:1]], anneau=True, main=False, n=m))
        return rings
    def grille(cx, cy, a, nx, ny, pas, jit=0, garder=None, zone='ville'):
        memo = {}

        def P(i, j):
            p = memo.get((i, j))
            if p is None:
                u, v = tourne(a, (i - nx / 2) * pas, (j - ny / 2) * pas)
                p = memo[i, j] = (cx + u + (hash2(i, j, sd) - .5) * jit, cy + v + (hash2(j, i, sd) - .5) * jit) \
                    if jit else (cx + u, cy + v)
            return p
        hx, hy = nx // 2, ny // 2
        garde = set()
        for i in range(nx):
            for j in range(ny):
                q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]
                c = ((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2)
                if garder and not garder(c):
                    continue
                if ajout(q, main=i == nx / 2 or i + 1 == hx or j == hy or j + 1 == hy, zone=zone, gi=i, gj=j):
                    garde.add((i, j))

        def ligne(n, pt, on, main, rang):   # (les rues le long des îlots gardés seulement)
            pts = []
            for k in range(n + 1):
                if k < n and on(k):
                    pts += [pt(k + 1)] if pts else [pt(k), pt(k + 1)]
                elif pts:
                    rues.append(dict(pts=pts, main=main, n=rang))
                    pts = []
        for i in range(nx + 1):
            ligne(ny, lambda j: P(i, j), lambda j: (i - 1, j) in garde or (i, j) in garde, i == hx, i)
        for j in range(ny + 1):
            ligne(nx, lambda i: P(i, j), lambda i: (i, j - 1) in garde or (i, j) in garde, j == hy, j)

    def le_plus_pres(liste, x, y, filtre=lambda b: True):
        l = [b for b in liste if not b.get('role') and filtre(b)]
        l.sort(key=lambda b: hypot(b['c'][0] - x, b['c'][1] - y))
        return l[0] if l else None

    def role(b, r):
        if b:
            b['role'] = r
            V['lieux'].setdefault(r, (b['c'][0], b['c'][1]))
        return b

    def ruban(route, d0, d1, prof=12, seg=8, densite=None):
        a0 = route['a']
        d = d0
        while d < d1:
            for s in (-1, 1):
                if densite and R() > densite:
                    continue

                def p(t, off):
                    a = a0 + .06 * sin(t / 90)
                    return (IC[0] + cos(a) * t - sin(a) * off * s, IC[1] + sin(a) * t + cos(a) * off * s)
                q = [p(d, 1.5), p(d + seg, 1.5), p(d + seg, prof), p(d, prof)] if s > 0 else \
                    [p(d + seg, 1.5), p(d, 1.5), p(d, prof), p(d + seg, prof)]
                ajout(q, zone='faubourg', cotes=[True, False, False, False])
            d += seg * (.85 + R() * .3)

    m = Pf['modele']
    a_main = ang_routes[0] if ang_routes else 0
    fau = Pf['fau'] or 1

    def dens(x):
        return min(1, x + (Pf['dfau'] or 0))
    if m == 'grande':
        polaire(10, Rv * .58 + (0 if Pf['murs'] == 'bastions' else 5.5), pasR=12, arc=16)
        V['murLigne'], V['rPlace'] = Rv * .58 + 8, 8.75
        if Pf['rivs']:
            p0, p1 = Pf['rivs'][0]['pts'][0], Pf['rivs'][0]['pts'][-1]
            ax = atan2(p1[1] - p0[1], p1[0] - p0[0])
        else:
            ax = a_main
        n2 = math.ceil(Rv * 2.1 / 17)
        ml = V['murLigne']

        def garder(c):
            d = hypot(c[0] - IC[0], c[1] - IC[1])
            return d > ml + 6 and d < Rv * (1 + .1 * sin(atan2(c[1] - IC[1], c[0] - IC[0]) * 3)) + 12
        grille(IC[0], IC[1], ax, n2, n2, 17, jit=3, garder=garder)
        for r in Pf['routes']:
            ruban(r, Rv + 10, Rv * 1.5 * fau, 12, 8, densite=dens(.95 if Pf['annee'] >= 1860 else .7))
    elif m in ('ville', 'port', 'castrum', 'rond', 'montagne'):
        r1 = Rv * .95 if m == 'montagne' else Rv
        R0 = 8 if m == 'castrum' else 7 if m in ('ville', 'port') else 6
        polaire(R0, r1 if m == 'montagne' or Pf['murs'] == 'bastions' else r1 + 6.5,
                pasR=11 if m in ('rond', 'castrum') else 14 if m == 'montagne' else 12, arc=24 if m == 'montagne' else 16,
                tord=.5 if m == 'montagne' else .3, zone='faubourg' if m == 'montagne' else 'ville',
                cotes=[True, True, True, True] if m == 'montagne' else None)
        V['murLigne'], V['rPlace'] = r1 + 9, R0 - 1.25
        for r in Pf['routes']:
            ruban(r, r1 + 12, r1 * (1.7 if Pf['annee'] >= 1860 else 1.4) * fau, 12, 8, densite=dens(.75))
    elif m in ('bastide', 'place'):
        n0 = clamp(jround(Rv / 19), 2 if m == 'bastide' else 4, 9)   # (une bastide de village : 5 îlots sur 3)
        p0, pas = (30, 12) if m == 'place' else (33, 13)
        nx = jround(n0 * p0 / pas)
        ny = jround((n0 - 1) * p0 / pas) if m == 'bastide' else nx
        grille(IC[0], IC[1], a_main, nx, ny, pas)
        V['rect'] = dict(a=a_main, w=nx * pas, h=ny * pas)
        for r in Pf['routes']:
            ruban(r, nx * pas * .75 + 34, nx * pas * 1.25 * fau, 12, 8, densite=dens(.6))
    elif m == 'rue':
        r = Pf['routes'][0] if Pf['routes'] else dict(a=0)
        r2 = Pf['routes'][1] if len(Pf['routes']) > 1 else dict(a=r['a'] + math.pi)
        ruban(r, 0, Rv * 4 * fau, 14)   # (le village plus petit : la rue plus longue que son rayon, 5 à 7 habitants par maison)
        ruban(r2, 8, Rv * 4 * fau, 14)
    elif m == 'airial':
        for r in Pf['routes']:
            ruban(r, 22, 70 * fau, 12, 8, densite=dens(.8))
        for k in range(9):
            a = R() * TAU
            d = 120 + R() * 220
            plus.append(dict(k='airial', x=IC[0] + cos(a) * d, y=IC[1] + sin(a) * d, a=R() * TAU))
    # --- les lieux
    villes = [b for b in ilots if b['zone'] == 'ville']
    if m in ('bastide', 'place'):
        c = le_plus_pres(villes, IC[0], IC[1])
        role(c, 'place')
        role(le_plus_pres(villes, IC[0] + 13, IC[1] + 13, lambda b: b is not c), 'eglise')
        if m == 'place':
            for b in sorted([b for b in villes if not b.get('role')], key=lambda b: -b['d'])[:3]:
                role(b, 'caserne')
    elif m not in ('rue', 'airial', 'fortin'):
        V['placeCentre'] = True
        V['lieux']['place'] = IC
        l0 = sorted([b for b in villes if b.get('anneau') is not None], key=lambda b: (b['anneau'], -b['aire']))
        cath = role(l0[0] if l0 else None, 'cathedrale' if m == 'grande' else 'eglise')
        if cath and m == 'grande':
            nb = next((b for b in villes if not b.get('role') and b.get('anneau') == cath['anneau'] and b.get('secteur') is not None
                       and abs(b['secteur'] - cath['secteur']) == 1), None)
            if nb:
                nb['role'] = 'parvis'
                cath['voisin'] = nb
        if m == 'grande':
            def libres(d0, d1):
                return [b for b in villes if not b.get('role') and Rv * d0 < b['d'] < Rv * d1]
            for k in range(4):
                ta = k * TAU / 4 + .6
                l = sorted(libres(.25, .9), key=lambda b: abs(ang_diff(atan2(b['c'][1] - IC[1], b['c'][0] - IC[0]), ta)))
                role(l[0] if l else None, 'egliseDome' if k % 2 else 'eglise')
            l = libres(.4, .95)
            role(l[2] if len(l) > 2 else None, 'couvent')
            l = libres(.5, 1)
            role(l[5] if len(l) > 5 else None, 'couvent')
            if Pf['rivs']:
                rp = Pf['rivs'][0]['pts']
                l = sorted([b for b in villes if not b.get('role')], key=lambda b: dist_poly(rp, *b['c']))
                role(l[0] if l else None, 'royale' if Pf['port'] and n['type'] == 'capitale' else 'hopital')
            l = sorted(libres(.6, 1.1), key=lambda b: -b['aire'])
            role(l[0] if l else None, 'jardin')
            for b in [b for k, b in enumerate(libres(.2, .55)) if k % 5 == 2][:4]:
                role(b, 'hotel')
            for b in sorted([b for b in villes if not b.get('role')], key=lambda b: -b['d'])[:2]:
                role(b, 'caserne')
        elif m in ('ville', 'port'):
            l = sorted([b for b in villes if not b.get('role') and b['d'] > Rv * .5], key=lambda b: -b['aire'])
            role(l[0] if l else None, 'couvent')
    elif m in ('rue', 'airial'):
        b = next((b for b in ilots if b['d'] < 80), None)
        if b:
            b['role'] = 'eglise'
            V['lieux']['eglise'] = b['c']
    # --- les métiers de la ville (plus : {k, x, y, a})
    def autour(dmin, dmax, k):
        for _ in range(40):
            a = R() * TAU
            d = dmin + R() * (dmax - dmin)
            x, y = IC[0] + cos(a) * d, IC[1] + sin(a) * d
            if not pres(x, y, 16) and not any(abs(b['c'][0] - x) < 40 and abs(b['c'][1] - y) < 40 and
                                              hypot(b['c'][0] - x, b['c'][1] - y) < 40 for b in ilots):
                return dict(k=k, x=x, y=y, a=R() * TAU)
        return None

    def add(o):
        if o:
            plus.append(o)
        return o
    spec = Pf['spec']
    if 'vin' in spec:
        for _ in range(3):
            add(autour(Rv + 60, Rv + 300, 'chateauVin'))
    if 'bois' in spec:
        add(autour(Rv + 30, Rv + 140, 'scierie'))
    if 'fer' in spec:
        add(autour(Rv + 30, Rv + 160, 'forge'))
    if 'sel' in spec:
        add(autour(Rv + 20, Rv + 120, 'salines'))
    if 'tabac' in spec:
        for _ in range(2):
            add(autour(Rv + 30, Rv + 200, 'sechoir'))
    if 'ble' in spec or m in ('rond', 'rue'):
        for _ in range(2):
            add(autour(Rv + 40, Rv + 220, 'moulin'))
    for _ in range(5 if n['type'] == 'village' else 8):
        add(autour(Rv + 50, 460, 'airial' if Pf['style'] == 'landes' else 'ferme'))
    if Pf['citadelle']:
        a1 = ang_routes[1] if len(ang_routes) > 1 else 1
        a = (Pf['mer']['a'] if Pf['mer'] else a1) if Pf['rivs'] else a1 + .4
        Rc = 36 if n['type'] == 'capitale' else 30
        d = (V['murLigne'] or Rv) + Rc * .9
        V['citadelle'] = ct = bastions(IC[0] + cos(a) * d, IC[1] + sin(a) * d, 5, Rc, a + math.pi)
        V['lieux']['citadelle'] = ct['C']
        for b in ilots:
            if hypot(b['c'][0] - ct['C'][0], b['c'][1] - ct['C'][1]) < Rc + 25:
                b['supprime'] = True
    if Pf['murs'] == 'bastions':
        N = 5 if m == 'fortin' else clamp(jround(Rv / 8), 5, 32)
        if m == 'fortin':
            besoin = 22
        else:
            besoin = max([60] + [max(hypot(p[0] - IC[0], p[1] - IC[1]) for p in b['q']) for b in ilots
                                 if b['zone'] == 'ville' and not b.get('supprime')]) + 4
        Rb, interieur = besoin, 0
        k = 0
        while k < 30 and interieur < besoin:
            V['trace'] = bastions(IC[0], IC[1], N, Rb, a_main + math.pi / N)
            interieur = min(hypot(c['GA'][0] - IC[0], c['GA'][1] - IC[1]) for c in V['trace']['cotes']) - 5
            Rb *= 1.05
            k += 1
        V['Rb'], V['murInt'] = Rb / 1.05, interieur
        for b in ilots:
            if b['zone'] == 'ville' and max(hypot(p[0] - IC[0], p[1] - IC[1]) for p in b['q']) > interieur:
                b['supprime'] = True
            elif b['zone'] == 'faubourg' and b['d'] < Rb + 110:
                b['supprime'] = True
        if m == 'fortin':
            plus.append(dict(k='fortin'))
            V['lieux']['place'] = IC
    if Pf['annee'] >= 1860 and Pf['pop'] > 3000:
        a = (ang_routes[1] if len(ang_routes) > 1 else a_main) + .5
        d = (V['murLigne'] or Rv) + 70
        V['gare'] = g = dict(x=IC[0] + cos(a) * d, y=IC[1] + sin(a) * d, a=a + math.pi / 2)
        for b in ilots:
            if hypot(b['c'][0] - g['x'], b['c'][1] - g['y']) < 30:
                b['supprime'] = True
    if m == 'castrum':
        V['lieux']['chateau'] = IC
    V['ilots'] = [b for b in ilots if not b.get('supprime')]
    bord = max([40] + [max(hypot(p[0] - IC[0], p[1] - IC[1]) for p in b['q']) for b in V['ilots'] if b['zone'] == 'ville'])
    if V['murInt']:
        V['rMur'] = V['murInt'] + 10
    elif V['rect']:
        V['rMur'] = hypot(V['rect']['w'], V['rect']['h']) / 2 + 6
    elif V['murLigne'] and m != 'montagne':
        V['rMur'] = V['murLigne']
    else:
        V['rMur'] = bord + 9
    # moins serré (villes.js, DENSITE) : des clos sans maisons passé le cœur, les autres îlots bâtis sur moins de côtés
    c0, pmax, smin = DENSITE[V['type']]
    for k, b in enumerate(V['ilots']):
        if b.get('role'):
            continue
        f = .6 if b['zone'] == 'faubourg' else clamp((b['d'] / Rv - c0) / (.75 - c0), 0, 1)
        if hash2(k, 17, sd) < pmax * f * (.35 if b['main'] else 1):
            b['role'] = CLOS[int(hash2(k, 18, sd) * len(CLOS))]
        elif b['zone'] == 'ville' and f > 0 and not b['main']:
            b['cotes'] = [hash2(k, 19 + i, sd) < 1 - (1 - smin) * f for i in range(4)]
            if True not in b['cotes']:
                b['cotes'][int(hash2(k, 23, sd) * 4)] = True
    return V


def plan(geo, nid, annee=1789, f=None, pop=None, d=0):
    """Le plan de la place nid dans cet état (gardé : le même état rend le même objet)."""
    K = carte_de(geo)
    n = K.noeud[nid]
    Pf = profil_ville(K, n, annee, f, pop, d)
    cle = (nid, Pf['annee'], Pf['f'], Pf['R'], Pf['d'])
    V = K.plans.get(cle)
    if V is None:
        V = K.plans[cle] = generer_interieur(K, Pf)
        if len(K.plans) > 64:
            K.plans.pop(next(iter(K.plans)))
    return V


def decaler_quad(q, w):
    """decalerQuad de lib.js : le quadrilatère rentré de w de chaque côté (l'îlot moins la moitié de la rue). (Pour les
    batailles seulement : math.hypot suffit, plus vite que celui de V8.)"""
    n = len(q)
    L = []
    for k in range(n):
        a, b = q[k], q[(k + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dy)
        L.append((a[0] - dy / l * w, a[1] + dx / l * w, dx, dy))
    out = []
    for k in range(n):
        x1, y1, dx1, dy1 = L[(k + n - 1) % n]
        x2, y2, dx2, dy2 = L[k]
        den = dx1 * dy2 - dy1 * dx2
        if abs(den) < 1e-6:
            return None
        t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den
        out.append((x1 + dx1 * t, y1 + dy1 * t))
    return out


def rayon_enceinte(V):
    """Jusqu'où porte la place, en unités depuis IC : l'enceinte (fossé et demi-lunes compris, citadelle aussi), sinon
    la ville bâtie."""
    r = V['rMur']
    for t in (V['trace'], V['citadelle']):
        if t:
            r = max([r] + [hypot(p[0] - IC[0], p[1] - IC[1]) for p in t['poly']] +
                    [hypot(rv['apex'][0] - IC[0], rv['apex'][1] - IC[1]) for rv in t['ravs']])
    if V['Pf']['murs'] in ('medieval', 'cours') and V['rect']:
        r = max(r, hypot(V['rect']['w'] / 2 + 3, V['rect']['h'] / 2 + 3))
    elif V['Pf']['murs'] in ('medieval', 'cours') and V['murLigne']:
        r = max(r, V['murLigne'])
    return r
