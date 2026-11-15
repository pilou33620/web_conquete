"""Références de l'arithmétique du navigateur et des plans de ville (game/tactics/jsmath.py, plan_ville.py,
plan_organique.py) pour leur portage en Rust (rust/conquete/src/tactics/). Écrit
rust/conquete/tests/references/plans.json, relu par rust/conquete/tests/plans.rs.
    python3 outils/jumeau/plans_ref.py

- jsmath : chaque fonction publique sur quelques milliers de cas tirés d'une graine fixe. Les entrées ne sont pas
  rangées : l'essai Rust les retire de la même graine (py::Random rend les mêmes nombres), leur empreinte le vérifie ;
  les résultats sont rangés tels quels. Les cas limites, eux, sont rangés avec leurs entrées.
- la carte : celle du Sud-Ouest (GeoMap(2)), réduite à ce que plan_ville.Carte en lit (terrain, places, arêtes,
  rivières) et rangée serrée (terrain en plages, coordonnées en entiers, de proche en proche) ; le jumeau travaille sur la carte relue de
  cette forme, celle-là même que l'essai Rust relit.
- les plans : toutes les places dans trois états (plan_ville), des dizaines de villes de tous les modèles dans
  plusieurs états (plan_organique), sous forme d'empreinte ordonnée et de quelques valeurs lisibles.
- les fonctions publiques intermédiaires des deux modules, avec leurs entrées.
"""
import math
import os
import random
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
import commun  # noqa: E402

from game.geo import KY, GeoMap  # noqa: E402
from game.tactics import jsmath as JM, plan_organique as PO, plan_ville as PV  # noqa: E402

g = random.Random(20261115)
ref = {}


# ---------------------------------------------------------------------- jsmath
def echelle(a, b):
    """Un flottant de toutes tailles : uniforme dans [-1, 1[, fois une puissance de deux."""
    u = g.uniform(-1, 1)
    return u * 2.0 ** g.randint(a, b)


# (l'ordre des tirages est celui de l'essai Rust : `entrees` de tests/plans.rs)
angles = [echelle(-30, 21) for _ in range(2000)]
paires = [(echelle(-20, 20), echelle(-20, 20)) for _ in range(2000)]
triples = [(g.uniform(-1000, 1000), g.uniform(-1000, 1000), g.uniform(-1000, 1000)) for _ in range(500)]
ronds = [g.uniform(-1e6, 1e6) for _ in range(1500)] + [g.randint(-10 ** 6, 10 ** 6) + 0.5 for _ in range(500)]
h2 = [(g.randint(-2 ** 31, 2 ** 31 - 1), g.randint(-10 ** 6, 10 ** 6), g.randint(0, 2 ** 32 - 1)) for _ in range(1500)]
h2 += [(g.randint(-2 ** 40, 2 ** 40), g.randint(-2 ** 33, 2 ** 33), g.randint(0, 2 ** 34)) for _ in range(500)]
graines = [g.randint(0, 2 ** 32 - 1) for _ in range(40)]


def tirages(a, n=25):
    R = JM.alea(a)
    return [R() for _ in range(n)]


def autour_de(x):
    return [math.nextafter(x, -math.inf), x, math.nextafter(x, math.inf)]


UN = [0.0, -0.0, 5e-324, 1e-300, 2.0 ** -28, 0.25, 0.3, 0.5, 1.0, 1.5, 2.0, 1e6, 1e15, 1e22, 2.0 ** 66, 1e308]
for x in (2.0 ** -27, 0.29999999701976776, 0.78125, math.pi / 4, 3 * math.pi / 4, 0.4375, 0.6875, 1.1875, 2.4375,
          2.0 ** 19 * math.pi / 2, 823549.6645826707, 2.0 ** 66):
    UN += autour_de(x)
for k in range(1, 41):
    UN += autour_de(k * math.pi / 2)
UN += [-x for x in UN if x]
DEUX = [(0.0, 0.0), (-0.0, 0.0), (0.0, -0.0), (-0.0, -0.0), (1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0), (0.0, 2.0),
        (-0.0, 2.0), (0.0, -2.0), (-0.0, -2.0), (0.5, 1.0), (-0.5, 1.0), (1e308, 1.0), (-1e308, 1.0), (1e300, 1e-300),
        (-1e300, 1e-300), (1e300, -1e-300), (1e-300, -1e300), (-1e-300, -1e300), (1e-300, 1e300), (3.0, 4.0), (4.0, 3.0),
        (1e200, 1e200), (1e-200, 1e-200), (5e-324, 5e-324), (-7.5, 0.0), (0.25, -0.97), (3.1, 4.7), (1.0, 1.0), (-1.0, -1.0)]
ENTIERS = [(i, j, k) for i in (-2, -1, 0, 1, 7) for j in (-1, 0, 3) for k in (0, 1, 2881610187)]
ENTIERS += [(2 ** 31, -2 ** 31, 2 ** 32), (2 ** 31 - 1, 2 ** 32 + 1, -1), (-2 ** 53, 2 ** 53, 2 ** 62), (3, -7, 2881610187)]
TEXTES = ['', 'a', 'bayonne', 'Bayonne', 'saint-émilion', "tournon-d'agenais", 'é', 'œuvre', '日本', '🙂', 'a🙂b', ' ', '\n']

ref['jsmath'] = dict(
    entrees=commun.empreinte([angles, paires, triples, ronds, h2, graines]),
    sin=[JM.sin(x) for x in angles], cos=[JM.cos(x) for x in angles], atan=[JM.atan(x) for x in angles],
    atan2=[JM.atan2(y, x) for y, x in paires], hypot=[JM.hypot(x, y) for x, y in paires],
    hypot_n=[JM.hypot(*t) for t in triples], jround=[JM.jround(x) for x in ronds], hash2=[JM.hash2(*t) for t in h2],
    alea=[tirages(a) for a in graines],
    limites=dict(
        un=[[x, JM.sin(x), JM.cos(x), JM.atan(x)] for x in UN],
        deux=[[y, x, JM.atan2(y, x), JM.hypot(y, x)] for y, x in DEUX],
        hypot_n=[[list(t), JM.hypot(*t)] for t in ((0.0, 0.0, 0.0), (1.0, 2.0, 2.0), (3.0, 4.0, 12.0, 84.0), (1e200, 1e200, 1e200),
                                                  (1e-200, 2e-200, 3e-200), (-1.5, 0.0, 2.5, -3.5, 4.5), (0.0, 0.0, 5.0))],
        jround=[[x, JM.jround(x)] for x in [k / 4 for k in range(-40, 41)] + [-0.0, 0.49999999999999994, -0.5000000000000001,
                                                                               4503599627370495.5, -4503599627370495.5, 2.0 ** 52, 1e15 + 0.5]],
        hash2=[[i, j, k, JM.hash2(i, j, k)] for i, j, k in ENTIERS] + [[i, j, 0, JM.hash2(i, j)] for i, j in ((0, 0), (5, 9), (-4, 2 ** 35))],
        alea=[[a, tirages(a, 5)] for a in (0, 1, -1, 1234567, 2 ** 31, 2 ** 32 + 5, -2 ** 31, 2 ** 53 + 1)],
        hashS=[[s, JM.hashS(s)] for s in TEXTES]))


# ---------------------------------------------------------------------- la carte, réduite et rangée serrée
def code(pts, k):
    """Des points [x, y] à k décimales près : leurs entiers, de proche en proche, à plat."""
    out, px, py = [], 0, 0
    for x, y in pts:
        ix, iy = round(x * k), round(y * k)
        assert ix / k == x and iy / k == y, (x, y)
        out += [ix - px, iy - py]
        px, py = ix, iy
    return out


def plages(t):
    """Le terrain en plages : [type, longueur, type, longueur…]."""
    out = []
    for v in t:
        if out and out[-2] == v:
            out[-1] += 1
        else:
            out += [v, 1]
    return out


def decode(d, k):
    pts, x, y = [], 0, 0
    for i in range(0, len(d), 2):
        x += d[i]
        y += d[i + 1]
        pts.append([x / k, y / k])
    return pts


VRAIE = GeoMap(2)   # (le Sud-Ouest des anciennes parties : celle des bancs tests/test_plan_ville.py)
carte = dict(W=VRAIE.W, H=VRAIE.H, lon0=VRAIE.lon0, lat1=VRAIE.lat1, KX=VRAIE.KX, KY=KY,
             terrain=plages(VRAIE.terrain), nodes=VRAIE.nodes,
             edges=[dict(a=e['a'], b=e['b'], royal=bool(e.get('royal')), d=code(e['pts'], 100)) for e in VRAIE.edges],
             rivers=[dict(name=r['name'], rank=r['rank'], d=code(r['pts'], 10000)) for r in VRAIE.src['rivers']])
ref['carte'] = carte


class Geo:
    """La carte relue de sa forme rangée : ce que plan_ville.Carte lit d'une GeoMap (GeoEssai de tests/plans.rs)."""

    def __init__(self, c):
        self.W, self.H, self.c = c['W'], c['H'], c
        self.terrain = bytearray(v for k in range(0, len(c['terrain']), 2) for v in [c['terrain'][k]] * c['terrain'][k + 1])
        self.nodes = c['nodes']
        self.edges = [dict(a=e['a'], b=e['b'], royal=e['royal'], pts=decode(e['d'], 100)) for e in c['edges']]
        self.src = dict(rivers=[dict(name=r['name'], rank=r['rank'], pts=decode(r['d'], 10000)) for r in c['rivers']])

    def xy(self, lat, lon):
        return ((lon - self.c['lon0']) * self.c['KX'], (self.c['lat1'] - lat) * self.c['KY'])


GEO = Geo(carte)
assert bytes(GEO.terrain) == bytes(VRAIE.terrain)
assert [e['pts'] for e in GEO.edges] == [e['pts'] for e in VRAIE.edges]
assert all(GEO.xy(lat, lon) == VRAIE.xy(lat, lon) for r in VRAIE.src['rivers'] for lon, lat in r['pts'])
K = PV.carte_de(GEO)
assert K.rivers == PV.carte_de(VRAIE).rivers and K.y_mont == PV.carte_de(VRAIE).y_mont
nom = lambda x: next(n for n in GEO.nodes if n['name'] == x)  # noqa: E731
assert all(n['id'] == k for k, n in enumerate(GEO.nodes))

pts_carte = [(g.uniform(-3, GEO.W + 3), g.uniform(-3, GEO.H + 3)) for _ in range(400)]
pts_carte += [(n['x'] + g.uniform(-3, 3), n['y'] + g.uniform(-3, 3)) for n in GEO.nodes[:100]]
pts_carte = [(round(x, 3), round(y, 3)) for x, y in pts_carte] + [(-0.5, -0.5), (0.0, 0.0), (0.5, 0.5), (GEO.W, GEO.H), (GEO.W - 0.5, 1.5)]
ref['Carte'] = dict(rivers=commun.empreinte_ordre(K.rivers), riviere0=K.rivers[0]['pts'][:5], y_mont=K.y_mont,
                    noeuds=len(K.noeud), ter=[[x, y, K.ter(x, y), K.eauK(x, y)] for x, y in pts_carte])


# ---------------------------------------------------------------------- les plans
def sans(V):
    """Le plan sans ce qui ne se range pas : la fonction V['eau'] (PV::eau en Rust) et le plan organique gardé."""
    return {k: v for k, v in V.items() if k not in ('eau', 'org')}


SONDES = [(PV.IC[0] + dx, PV.IC[1] + dy) for dx in (-320, -150, -40, 0, 40, 150, 320) for dy in (-240, -60, 0, 60, 240)]


def formes(nom, o):
    """PLANS_FORMES=dossier : la forme complète, à comparer à celle de l'essai Rust (même variable)."""
    if os.environ.get('PLANS_FORMES'):
        with open(os.path.join(os.environ['PLANS_FORMES'], nom + '.json'), 'w', encoding='utf-8') as fh:
            fh.write(commun.canon_ordre(o))


def cas(nid, annee, f, pop, d, organique=False, rang=0, K=K):
    Pf = PV.profil_ville(K, K.noeud[nid], annee, f, pop, d)
    V = PV.generer_interieur(K, Pf)
    r = dict(v=commun.empreinte_ordre(sans(V)), modele=Pf['modele'], R=Pf['R'], ilots=len(V['ilots']))
    if organique:
        r.update(pf=commun.empreinte_ordre(Pf), murs=Pf['murs'], rMur=V['rMur'], rues=len(V['rues']), plus=len(V['plus']),
                 eau=''.join('1' if V['eau'](x, y) else '0' for x, y in SONDES))
        formes(f'{rang}.v', sans(V))
        O = PO.plan_organique(K, V)
        formes(f'{rang}.o', O)
        r['o'] = commun.empreinte_ordre(O)
        if O:
            types = {}
            for il in O['ilots']:
                types[il['type']] = types.get(il['type'], 0) + 1
            r.update(o_ilots=len(O['ilots']), o_types=dict(sorted(types.items())), o_axes=len(O['axes']),
                     o_mur=O['mur'] and O['mur']['kind'])
    return [nid, annee, f, pop, d, r]


# plan_ville : toutes les places, dans les trois états du banc tests/test_plan_ville.py
tous = []
for n in GEO.nodes:
    tous += [cas(n['id'], 1789, None, None, 0), cas(n['id'], 1870, None, None, 0),
             cas(n['id'], 1789, 3, (n['pop0'] or 700) * 3, 2)]
ref['plan_ville'] = tous

# plan_organique : les villes des bancs, puis les premières places de chaque modèle, dans plusieurs états
# (nom, f, pop, d) : f=None garde l'enceinte de la place
VILLES = [('Bordeaux', None, None, 0), ('Bayonne', None, None, 0), ('Libourne', None, None, 0),
          ('Navarrenx', None, None, 0), ('Belin', None, None, 0), ('Dax', 3, None, 0), ('Bazas', 0, None, 0),
          ('Beynac', None, None, 0), ('Agen', None, 30000, 2), ('Fort Médoc', None, None, 0),
          ('Saint-Émilion', None, None, 0), ('Sabres', None, None, 0), ('Salies-de-Béarn', None, None, 0),
          ('Navarrenx', 4, None, 0), ('Bayonne', 3, None, 0), ('Bordeaux', 2, None, 1), ('Libourne', 1, 9000, 0),
          ('Pau', 1, None, 3), ('Périgueux', 2, 2500.5, 0), ('Mont-de-Marsan', 0, 12000, 1)]
etats = [[nom(x)['id'], an, f, pop, d] for x, f, pop, d in VILLES for an in (1789, 1870)]
par_modele = {}
for n in GEO.nodes:
    par_modele.setdefault(PV.profil_ville(K, n)['modele'], []).append(n['id'])
for m, ids in par_modele.items():
    for nid in ids[:3]:
        etats += [[nid, 1790, None, None, 0], [nid, 1865, 1, None, 1]]
vus, organiques = set(), []
for e in etats:
    if tuple(e) not in vus:
        vus.add(tuple(e))
        organiques.append(cas(*e, organique=True, rang=len(organiques)))
ref['plan_organique'] = organiques

# une rivière à deux points confondus : dist_poly rend NaN (comme en JS), et le tri des îlots au bord de l'eau, dont
# aucune comparaison n'est vraie, laisse la liste telle quelle — Bordeaux sur sa rivière, un point doublé
GEO2 = Geo(carte)
n0 = GEO2.nodes[0]
loin = lambda q: math.hypot(q[0] - n0['x'], q[1] - n0['y'])  # noqa: E731
ri = next(i for i, r in enumerate(K.rivers) if any(loin(q) < 2.6 for q in r['pts']))
ki = min(range(len(K.rivers[ri]['pts'])), key=lambda k: loin(K.rivers[ri]['pts'][k]))
GEO2.src['rivers'][ri]['pts'].insert(ki, list(GEO2.src['rivers'][ri]['pts'][ki]))
K2 = PV.Carte(GEO2)
assert math.isnan(PV.dist_poly(PV.profil_ville(K2, K2.noeud[0])['rivs'][0]['pts'], *PV.IC))
ref['point_double'] = dict(riviere=ri, rang=ki, cas=[cas(0, an, None, None, 0, organique=True, rang=1000 + k, K=K2)
                                                    for k, an in enumerate((1789, 1870))])

# les plans gardés : PV.plan rend le même objet pour le même état, n'en garde que 64 ; PO.plan range le sien dans V
K.plans.clear()
garde = dict(memes=[], cles=None, organiques=[])
for nid in range(70):
    V = PV.plan(GEO, nid, 1789)
    garde['memes'].append(V is PV.plan(GEO, nid, 1795, None, None, 0) and commun.empreinte_ordre(sans(V)) == tous[3 * nid][5]['v'])
garde['cles'] = [list(k) for k in K.plans]
for x in ('Bazas', 'Fort Médoc', 'Navarrenx'):
    nid = nom(x)['id']
    O = PO.plan(GEO, nid, 1870, 1)
    garde['organiques'].append([nid, O is PO.plan(GEO, nid, 1870, 1), O is PV.plan(GEO, nid, 1870, 1)['org'], commun.empreinte_ordre(O)])
ref['gardes'] = garde


# ---------------------------------------------------------------------- les fonctions intermédiaires de plan_ville
def arr(x, n=3):
    return round(x, n)


def poly(n, r=1.0, cx=0.0, cy=0.0, dec=3):
    """Un polygone étoilé autour de (cx, cy) : n sommets, rayons tirés entre 0,5 r et 1,5 r."""
    a0 = g.uniform(0, 6.28)
    return [[arr(cx + math.cos(a0 + k * 6.283 / n) * r * g.uniform(.5, 1.5), dec),
             arr(cy + math.sin(a0 + k * 6.283 / n) * r * g.uniform(.5, 1.5), dec)] for k in range(n)]


pv = {}
pv['mod'] = [[a, n, PV.mod(a, n)] for a, n in [(arr(g.uniform(-20, 20)), PV.TAU) for _ in range(40)] + [(-0.0, PV.TAU), (7.5, 2.5), (-7.5, 2.5)]]
pv['clamp'] = [[v, a, b, PV.clamp(v, a, b)] for v, a, b in [(arr(g.uniform(-2, 3)), 0.0, 1.0) for _ in range(20)] + [(-0.0, 0.0, 1.0), (5, 4, 9), (12, 4, 9), (1, 4, 9)]]
pv['lerp'] = [[a, b, t, PV.lerp(a, b, t)] for a, b, t in [(arr(g.uniform(-5, 5)), arr(g.uniform(-5, 5)), arr(g.uniform(0, 1))) for _ in range(30)]]
pv['ang_diff'] = [[a, b, PV.ang_diff(a, b)] for a, b in [(arr(g.uniform(-10, 10)), arr(g.uniform(-10, 10))) for _ in range(200)]]
polys = [poly(g.randint(3, 9), g.uniform(5, 200), 500, 380, 2) for _ in range(40)]
pv['aire'] = [[q, PV.aire(q)] for q in polys]
lignes = [poly(g.randint(2, 12), 150, 500, 380, 2) for _ in range(30)] + [[[1.0, 1.0], [2.0, 2.0], [2.0, 2.0], [5.0, 1.0]]]
pv['dist_poly'] = [[l, x, y, None if math.isnan(d) else d] for l in lignes for x, y in [(arr(g.uniform(300, 700), 1), arr(g.uniform(200, 560), 1)) for _ in range(6)]
                   for d in [PV.dist_poly(l, x, y)]]
pv['bastions'] = [[cx, cy, N, Rb, rot, commun.empreinte_ordre(t), t['poly'][:3], t['ravs'][0], t['cotes'][-1]] for cx, cy, N, Rb, rot in
                  [(arr(g.uniform(300, 700), 1), arr(g.uniform(200, 560), 1), N, arr(g.uniform(40, 300), 2), arr(g.uniform(-4, 4))) for N in (3, 4, 5, 5, 6, 7, 8, 9)]
                  for t in [PV.bastions(cx, cy, N, Rb, rot)]]
pv['style_de'] = [PV.style_de(n) for n in GEO.nodes]
pv['ere'] = [[a, PV.ere(a)] for a in (1700, 1789, 1859, 1860, 1861, 1914)]
pv['rayon'] = [[p, PV.rayon(p)] for p in [0, 1, 41, 42, 100, 450, 700, 2000, 2500.5, 19000, 19400, 110000, 10 ** 6] + [g.randint(50, 30000) for _ in range(60)]]
pv['constantes'] = dict(S=PV.S, IW=PV.IW, IH=PV.IH, IC=PV.IC, TAU=PV.TAU, M=PV.M)
ref['pv'] = pv

# ---------------------------------------------------------------------- les fonctions intermédiaires de plan_organique
po = {}
# (pas d'empreinte du texte : ces flottants de simple précision tombent parfois à mi-chemin de deux écritures
# décimales les plus courtes, et repr de Python et py::repr_f n'y choisissent pas la même ; la somme, elle, est exacte)
assert all(v * 4294967296 == int(v * 4294967296) for v in PO.TABLE)
po['TABLE'] = dict(somme=sum((i % 251 + 1) * int(v * 4294967296) for i, v in enumerate(PO.TABLE)), debut=PO.TABLE[:8], fin=PO.TABLE[-4:])
po['bruit'] = [[x, y, f, d, PO.bruit(x, y, f, d)] for x, y, f, d in
               [(arr(g.uniform(-50, 300)), arr(g.uniform(-50, 350)), g.choice([0.4, 0.45, 0.17, 0.3, 1.2]), g.choice([0, 3, 5, 8, 96, 250]))
                for _ in range(300)]]
po['bruit0'] = [[x, y, PO.bruit(x, y, 0.4)] for x, y in ((0.0, 0.0), (101.26, 104.16), (-3.5, 7.25))]
polys = [poly(g.randint(3, 9), g.uniform(.02, .4), 100, 100, 4) for _ in range(40)]
po['aire'] = [[q, PO.aire(q)] for q in polys]
po['centre'] = [[q, PO.centre(q)] for q in polys]
po['normales'] = [[q, PO.normales(q)] for q in polys[:20] + [[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]], [[0.0, 0.0], [0.0, 0.0], [1.0, 1.0]]]]
po['lerp'] = [[a, b, t, PO.lerp(a, b, t)] for q in polys[:20] for a, b, t in [(q[0], q[1], arr(g.uniform(0, 1)))]]
segs = [(arr(g.uniform(99, 101), 4), arr(g.uniform(99, 101), 4), q[0], q[1]) for q in polys for _ in range(3)]
segs += [(1.0, 1.0, [0.0, 0.0], [0.0, 0.0]), (1.0, 0.0, [0.0, 0.0], [2.0, 0.0]), (-1.0, 0.5, [0.0, 0.0], [2.0, 0.0]), (3.0, 0.5, [0.0, 0.0], [2.0, 0.0])]
po['dist_seg'] = [[x, y, a, b, list(PO.dist_seg(x, y, a, b)), PO.d_seg(x, y, a, b)] for x, y, a, b in segs]
po['dans_poly'] = [[q, [[x, y, PO.dans_poly(q, x, y)] for x, y in [(arr(g.uniform(99.5, 100.5), 4), arr(g.uniform(99.5, 100.5), 4)) for _ in range(8)]]] for q in polys]
coupes = []
for q in polys:
    a = g.uniform(0, 6.28)
    nx, ny, c, T = arr(math.cos(a), 4), arr(math.sin(a), 4), arr(g.uniform(-.2, .2), 4), list(range(len(q)))
    c = arr(nx * 100 + ny * 100 + c, 4)
    coupes.append([q, T, nx, ny, c, -7, list(PO.couper(q, T, nx, ny, c, -7))])
coupes.append([polys[0], ['a'] * len(polys[0]), 1.0, 0.0, 0.0, 'b', list(PO.couper(polys[0], ['a'] * len(polys[0]), 1.0, 0.0, 0.0, 'b'))])
po['couper'] = coupes
rentres = []
for q in polys:
    T = [g.choice(['rue', 'bord', 'axe']) for _ in q]
    ds = [arr(g.uniform(0, .05), 4) for _ in q]
    r = PO.rentrer(q, T, lambda i: ds[i])
    rentres.append([q, T, ds, r and list(r)])
po['rentrer'] = rentres
ecarts = []
for k in range(30):
    pts = poly(g.randint(2, 9), .6, 100, 100, 4)
    ws = None if k % 3 == 0 else [arr(g.uniform(.01, .05), 4) for _ in pts]
    l = dict(pts=pts, ws=ws, demi=None if k % 3 == 1 else arr(g.uniform(.01, .05), 4), kind='axe')
    sondes = [(arr(g.uniform(98.5, 101.5), 4), arr(g.uniform(98.5, 101.5), 4)) for _ in range(10)]
    ecarts.append([pts, ws, l['demi'], [[x, y, PO.ecart(l, x, y), PO.demi_en(l, x, y)] for x, y in sondes], l['boite']])
po['ecart'] = ecarts
po['autour'] = [[e['pts'], n['x'], n['y'], B, PO.autour(e['pts'], n['x'], n['y'], B)] for e in [e for e in GEO.edges if len(e['pts']) <= 12][:25]
                for n, B in [(GEO.nodes[e['a']], 1.2), (GEO.nodes[e['b']], 0.4), (GEO.nodes[3], 0.6)]]
po['enceinte_carte'] = [[n['id'], f, r, PO.enceinte_carte(n, f, r)] for n in GEO.nodes[:12] for f, r in [(n['id'] % 5, arr(g.uniform(.2, 1.4)))]]
po['constantes'] = dict(TAU=PO.TAU, HG=PO.HG, LARG_RIVIERE=PO.LARG_RIVIERE, DEMI_ROUTE=PO.DEMI_ROUTE, RUE_VILLE=PO.RUE_VILLE,
                        QUARTIERS=PO.QUARTIERS)
# generer_plan sans carte : ni axe (la direction vient de hash2), ni rivière, ni mur, pas d'eau
entrees = [dict(x=12.5, y=40.25, pop=900, ere='classique', r=.22, rh=None, graine=2881610187, axes=[], rivieres=[], mur=None),
           dict(x=7.0, y=3.5, pop=4000, ere='industrielle', r=.7, graine=123456789, axes=[], rivieres=[], mur=None),
           dict(x=7.0, y=3.5, pop=4000, ere='classique', r=.5, rh=.3, graine=77, axes=[], rivieres=[], mur=None, damier=True),
           dict(x=50.0, y=60.0, pop=2000, ere='industrielle', r=.4, rh=.35, graine=4242,
                axes=[dict(pts=[[50.0, 60.0], [50.4, 60.1], [51.2, 60.0]], ws=[.012, .03, .045], demi=.045),
                      dict(pts=[[50.0, 60.0]], ws=[.012], demi=.03),
                      dict(pts=[[50.0, 60.0], [49.7, 59.4], [49.5, 58.9]], ws=[.012, .02, .03], demi=.03)],
                rivieres=[dict(pts=[[49.2, 60.5], [50.1, 60.3], [50.9, 60.6]], ws=[.045] * 3, w=.045)],
                mur=dict(pts=PO.enceinte_carte(dict(id=3, x=50.0, y=60.0), 1, .3), kind='boulevard', demi=.015))]
po['generer_plan'] = []
for v in entrees:
    P = PO.generer_plan(v, lambda x, y: False)
    formes(f"generer_plan.{len(po['generer_plan'])}", P)
    po['generer_plan'].append([v, commun.empreinte_ordre(P), len(P['ilots']), P['boite']])
ref['po'] = po

commun.ecrire('plans', ref)
