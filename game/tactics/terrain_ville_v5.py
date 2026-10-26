# FIGÉ : terrain_ville.py des cartes de version 5 (avant la densité des bourgs et des villes), pour qu'une bataille en
# cours d'une sauvegarde garde sa carte (terrain.VERSION). Ne pas modifier.
"""Batailles sur le plan des villes (SPEC-CARTE-2D.md, « Livré — E ») : une bataille à une place, ou tout près, se
livre dans la ville de « Voir l'intérieur » (plan_ville.py, le portage de web/js/carte/villes.js) : mêmes rues, mêmes
îlots, mêmes murs et portes, mêmes édifices, à l'échelle (1 unité = 1000 / 180 m) et dans le bon sens.

Le plan est posé sur la grille de 20 m (cartes de version 4 et plus) :
- l'enceinte (cercle ou rectangle médiéval à tours, tracé bastionné et demi-lunes, citadelle) en MUR, percée de PORTE
  là où passent les routes du plan ; brèches, glacis et canons du rempart comme avant (terrain._enceinte) ;
- les rues (leurs axes, d'une case : une rue du plan fait 6 à 13 m) en ROUTE (CHEMIN au village), la grand-place, les
  parvis ; sur une carte réduite, une rue sur deux ou trois seulement, plus les rues maîtresses ;
- les îlots : maisons (BATI) le long de la rue sur la profondeur d'une parcelle, cours et jardins (PRE) au milieu ; les
  faubourgs sur leur seul côté de la route ; les édifices (église, cathédrale, couvent, hôpital, hôtel, caserne, halle,
  château, gare) sur l'emprise de leur modèle, que le client dessine au même endroit (to_client : plan) ;
- quais, ponts des rues maîtresses ; la mer et les étangs autour de la ville d'après la campagne (sans le tremblé).

Une place trop grande pour le champ de bataille (3 × 2 km, l'assaillant doit pouvoir se déployer hors des murs) fait
réduire toute la carte (échelle k < 1 : la campagne autour aussi, pour que rivières et côtes restent à leur place).
"""
import math

from . import plan_ville_v5 as PV
from .terrain import (CELL, COLS, ROWS, N, W, H, VILLES, _causeway, _mainland, bfs, T_CHAMP, T_EAU, T_GUE, T_PRE, T_ROUTE, T_CHEMIN, T_BATI, T_MUR, T_PORTE,
                      T_BOIS, T_FORET_T, T_MARAIS_T, T_LANDE_T, T_ROCHE, T_SABLE, T_VIGNE_T, T_VERGER, RUE, cell_of,
                      center_of, _add_bridge, _barricades, _dedans, _densify, _enceinte, _line4, _redoubts, _seg_dist)

# emprises des modèles de bâtiments (web/js/battle/decor2d-dessin.js, D.boite, en unités du modèle)
BOITE = dict(cathedrale=(-53.0, -26.0, 55.4, 26.0), egliseRomane=(-27.0, -7.3, 15.0, 7.3), egliseDome=(-36.0, -20.0, 29.0, 20.0),
             halle=(-24.0, -13.0, 24.0, 13.0), caserne=(-42.0, -26.0, 42.0, 20.5), hotel=(-28.0, -11.0, 28.0, 27.0),
             hopital=(-26.0, -20.0, 26.0, 20.0), hotelDeVille=(-24.0, -8.0, 24.0, 8.0), couvent=(-31.0, -34.3, 18.0, 18.0),
             poudriere=(-10.0, -7.6, 10.0, 7.6), chateau=(-44.0, -14.0, 44.0, 34.0), gare=(-50.0, -30.0, 28.0, 16.0))
COUR = ('caserne', 'hotel', 'couvent', 'hopital')   # bâtis autour d'une cour : la cour reste un pré
SOL = (T_BOIS, T_FORET_T, T_MARAIS_T, T_LANDE_T, T_ROCHE, T_SABLE, T_VIGNE_T, T_VERGER)   # rasé dans la ville
# les métiers du plan (genererInterieur : plus) : modèle du client (decor2d.js, METIERS), nature du bâtiment, emprise
# (unités du modèle) et échelle (m par unité du modèle : à leur vraie taille, comme les maisons)
METIERS = dict(ferme=('fermeCour', 'ferme', (-31, -27, 30, 27), .6), mas=('mas', 'ferme', (-21, -7, 18, 5), .7),
               chateauVin=('chateau', 'chateau', (-44, -14, 44, 34), .4), scierie=('scierie', 'scierie', (-12, -7, 12, 7), .8),
               forge=('forge', 'forge', (-14, -8, 14, 8), .8), sechoir=('sechoir', 'sechoir', (-20, -5, 20, 5), .8),
               moulin=('moulin', 'moulin', (-7, -7, 7, 7), .5), moulinEau=('moulinEau', 'moulin', (-6, -22, 28, -9), .5),
               airial=('airial', 'ferme', (-18, -6, 24, 10), .8))
PROF = 16.0   # m : profondeur d'une maison sur rue (le client les dessine à cette taille, pas à celle de l'intérieur)
DEPLOI = 400.0   # m entre l'enceinte et le bord de l'assaillant (sa bande de déploiement, battle._zones)


class Lieu:
    """Le plan d'une place posé sur la carte : V (plan_ville), k (échelle de la carte), pos (centre en m)."""

    def __init__(self, V, k, nid, nx, ny, cx, cy):
        self.V, self.k, self.nid = V, k, nid
        self.Mk = PV.M * k
        self.pos = (W / 2 + (nx - cx) * 1000.0 * k, H / 2 + (ny - cy) * 1000.0 * k)
        ext = max([60.0] + [max(math.hypot(p[0] - PV.IC[0], p[1] - PV.IC[1]) for p in b['q']) for b in V['ilots']])
        self.r_eau = max(ext, PV.rayon_enceinte(V)) * self.Mk + 120   # (la mer et les étangs, d'après le plan)
        self.r_calme = self.r_eau + 200   # (les rivières sans méandres : celles du plan)
        self.r_mur = PV.rayon_enceinte(V) * self.Mk
        ext_v = max([0.0] + [max(math.hypot(p[0] - PV.IC[0], p[1] - PV.IC[1]) for p in b['q']) for b in V['ilots']
                             if b['zone'] == 'ville'])
        self.r_ville = max(self.r_mur, ext_v * self.Mk)   # (rien ne traverse la ville que les rivières du plan)
        self.rivieres = {r['name'] for r in V['Pf']['rivs']}

    def tf(self, p):
        return (self.pos[0] + (p[0] - PV.IC[0]) * self.Mk, self.pos[1] + (p[1] - PV.IC[1]) * self.Mk)

    def unites(self, x, y):
        return (PV.IC[0] + (x - self.pos[0]) / self.Mk, PV.IC[1] + (y - self.pos[1]) / self.Mk)


def bord_assaillant(a):
    """Le bord d'où vient l'assaillant (battle._zones, sans le repli vers un bord plus sec)."""
    ca, sa = math.cos(a), math.sin(a)
    if abs(ca) * H >= abs(sa) * W * 0.66:
        return 'E' if ca > 0 else 'O'
    return 'S' if sa > 0 else 'N'


def preparer(geo, spec, pl, cx, cy):
    """Avant la carte : le plan de la place pl dans son état (année, f, pop, d) et l'échelle k de la carte. Une place
    assiégée tient avec ses murs à DEPLOI m du bord de l'assaillant et à 20 m des autres ; près d'une bataille rangée,
    elle ne dépasse pas 600 m de rayon."""
    n = geo.nodes[pl['nid']]
    V = PV.plan(geo, pl['nid'], spec.get('year', 1790), pl.get('f', pl.get('fort', n['fort'])), pl.get('pop') or n['pop0'],
                pl.get('d', 0))
    r = PV.rayon_enceinte(V) * PV.M + 30.0   # (fossé, chemin couvert)
    e0, k = bord_assaillant(spec.get('att_angle', 0.0)), 1.0
    # (près de l'eau, battle._zones peut faire venir l'assaillant par un autre bord, plus sec : place pour lui partout)
    K = PV.carte_de(geo)
    mouille = any(K.eauK(n['x'] + math.cos(a) * d, n['y'] + math.sin(a) * d) > .5
                  for d in (.8, 1.6, 2.4) for a in (q * math.pi / 6 for q in range(12)))
    for _ in range(4):   # (la place se rapproche du centre quand la carte rétrécit)
        px, py = W / 2 + (n['x'] - cx) * 1000.0 * k, H / 2 + (n['y'] - cy) * 1000.0 * k
        if pl.get('battle'):
            room = dict(O=px, E=W - px, N=py, S=H - py)
            lim = min(v - (DEPLOI if e == e0 or mouille else 20.0) for e, v in room.items())
        else:
            lim = 600.0
        k = max(0.12, min(1.0, lim / r))
    return Lieu(V, k, pl['nid'], n['x'], n['y'], cx, cy)


def routes(L, geo, nid):
    """Les routes du plan jusqu'au bord de la scène, en mètres, pour chaque arête de la place : par la rue maîtresse
    de la vieille ville, puis (tracé bastionné) par la porte au milieu de sa courtine et à travers la demi-lune, puis
    tout droit comme dans l'intérieur. {indice de l'arête : points}."""
    V, n = L.V, geo.nodes[nid]
    IC = PV.IC
    out = {}
    plans = []
    for j, r in enumerate(V['routesL']):
        a = r['a']
        pts = [IC]
        rad = min(V.get('radiales', []), key=lambda x: abs(PV.ang_diff(x[0], a)), default=None)
        if rad and abs(PV.ang_diff(rad[0], a)) < .3:
            pts = [IC] + rad[1]
        tr = V['trace']
        if tr:
            i = min(range(tr['N']), key=lambda i: abs(PV.ang_diff(math.atan2(tr['cotes'][i]['porte'][1] - IC[1],
                                                                            tr['cotes'][i]['porte'][0] - IC[0]), a)))
            c, rv = tr['cotes'][i], tr['ravs'][i]
            L_ = PV.hypot(c['B'][0] - c['A'][0], c['B'][1] - c['A'][1])
            pts = [p for p in pts if PV.hypot(p[0] - IC[0], p[1] - IC[1]) < V['murInt']] + \
                [c['porte'], (rv['apex'][0] + rv['out'][0] * 30, rv['apex'][1] + rv['out'][1] * 30)]
        d0 = PV.hypot(pts[-1][0] - IC[0], pts[-1][1] - IC[1]) + 20
        # (au-delà, l'axe des faubourgs : le ruban des maisons de genererInterieur, qui ondule un peu autrement que la
        # route peinte dans l'intérieur ; la route passe ainsi entre leurs deux rangées)
        pts += [(IC[0] + PV.cos(a + .06 * PV.sin(d / 90)) * d, IC[1] + PV.sin(a + .06 * PV.sin(d / 90)) * d)
                for d in range(0, 761, 20) if d > d0]
        plans.append((a, [L.tf(p) for p in pts]))
    for ei, ed in enumerate(geo.edges):
        if nid not in (ed['a'], ed['b']) or ed.get('kind') == 'water' or ed.get('ferry'):
            continue
        p = ed['pts'] if ed['a'] == nid else ed['pts'][::-1]
        q = next((q for q in p if PV.hypot(q[0] - n['x'], q[1] - n['y']) > .9), p[-1])
        a = PV.atan2(q[1] - n['y'], q[0] - n['x'])
        best = min(plans, key=lambda x: abs(PV.ang_diff(x[0], a)), default=None)
        if best and abs(PV.ang_diff(best[0], a)) < .5:
            out[ei] = best[1]
    return out


def ecarter(pts, C, Rp):
    """Le tracé densifié pts écarté du point C jusqu'à Rp au moins : décalé en travers là où il passe au plus près,
    de moins en moins loin le long du tracé (sur 2 Rp + 800 m)."""
    if len(pts) < 2:
        return pts
    k0 = min(range(len(pts)), key=lambda k: (pts[k][0] - C[0]) ** 2 + (pts[k][1] - C[1]) ** 2)
    x0, y0 = pts[k0]
    d0 = math.hypot(x0 - C[0], y0 - C[1])
    if d0 >= Rp:
        return pts
    if d0 > 1:
        nx, ny = (x0 - C[0]) / d0, (y0 - C[1]) / d0
    else:   # (droit sur le centre : de côté)
        (ax, ay), (bx, by) = pts[max(0, k0 - 1)], pts[min(len(pts) - 1, k0 + 1)]
        ll = math.hypot(bx - ax, by - ay) or 1.0
        nx, ny = -(by - ay) / ll, (bx - ax) / ll
    dec, fade = Rp - d0, 2 * Rp + 800
    s = [0.0] * len(pts)
    for k in range(k0 + 1, len(pts)):
        s[k] = s[k - 1] + math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
    for k in range(k0 - 1, -1, -1):
        s[k] = s[k + 1] + math.hypot(pts[k][0] - pts[k + 1][0], pts[k][1] - pts[k + 1][1])
    out = []
    for (x, y), sk in zip(pts, s):
        u = max(0.0, 1.0 - sk / fade)
        wgt = u * u * (3 - 2 * u)
        out.append((x + nx * dec * wgt, y + ny * dec * wgt))
    return out


def _dans(poly):
    """Cases dont le centre est dans le polygone (balayage des rangées de sa boîte)."""
    ys = [p[1] for p in poly]
    j0, j1 = max(0, int(min(ys) // CELL)), min(ROWS - 1, int(max(ys) // CELL))
    n = len(poly)
    out = []
    for j in range(j0, j1 + 1):
        y = (j + 0.5) * CELL
        xs = []
        for k in range(n):
            (x1, y1), (x2, y2) = poly[k], poly[(k + 1) % n]
            if (y1 <= y) != (y2 <= y):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            for i in range(max(0, int(math.ceil(a / CELL - 0.5))), min(COLS - 1, int(math.floor(b / CELL - 0.5))) + 1):
                out.append(j * COLS + i)
    return out


def _cotes(poly, c):
    """Côtés d'un quadrilatère : (a, longueur, u, n vers l'intérieur), comme remplirIlot."""
    out = []
    for k in range(4):
        a, e = poly[k], poly[(k + 1) % 4]
        l = math.hypot(e[0] - a[0], e[1] - a[1]) or 1e-9
        u = ((e[0] - a[0]) / l, (e[1] - a[1]) / l)
        nn = (-u[1], u[0])
        if (c[0] - a[0]) * nn[0] + (c[1] - a[1]) * nn[1] < 0:
            nn = (-nn[0], -nn[1])
        out.append((a, l, u, nn))
    return out


def _edifices(V, Pf):
    """Les édifices du plan (comme remplirIlot et peindreInterieur les posent) : [îlot ou None, rôle du moteur, modèle,
    x, y, angle, échelle (unités du plan par unité du modèle)]."""
    IC, out = PV.IC, []
    for b in V['ilots']:
        sp = b.get('role')
        if not sp or sp in ('parvis', 'jardin', 'royale'):
            continue
        poly = PV.decaler_quad(b['q'], PV.RUE_MAIN if b['main'] else PV.RUE)
        if not poly:
            continue
        c = b['c']
        ed = _cotes(poly, c)
        angB, cote = PV.atan2(ed[0][2][1], ed[0][2][0]), min(ed[0][1], ed[1][1])
        if sp == 'place':
            if V['type'] == 'grande':
                n0 = ed[0][3]
                out.append([b, 'hotel', 'hotelDeVille', c[0] + n0[0] * 2, c[1] + n0[1] * 2 - cote * .3, angB, cote / 60])
            else:
                out.append([b, 'halle', 'halle', c[0], c[1] + cote * .08, angB, cote / 75])
                if V['type'] == 'moyenne':
                    out.append([b, 'hotel', 'hotelDeVille', c[0], c[1] - cote * .34, angB, cote / 70])
        elif sp == 'cathedrale' and b.get('voisin'):
            o = b['voisin']['c']
            Lc = PV.hypot(o[0] - c[0], o[1] - c[1]) + cote
            out.append([b, 'cathedrale', 'cathedrale', (c[0] + o[0]) / 2, (c[1] + o[1]) / 2,
                        PV.atan2(o[1] - c[1], o[0] - c[0]), Lc * 1.1 / 110])
        elif sp in ('cathedrale', 'eglise', 'egliseDome'):
            cle = 'cathedrale' if sp == 'cathedrale' else 'egliseDome' if sp == 'egliseDome' else \
                ('egliseRomane' if V['type'] == 'bourg' else 'cathedrale')
            larg = 110 if sp == 'cathedrale' else 58 if sp == 'egliseDome' else (40 if V['type'] == 'bourg' else 112)
            out.append([b, 'cathedrale' if sp == 'cathedrale' else 'eglise', cle, c[0], c[1], angB,
                        b['aire'] ** .5 * (.5 if V['type'] == 'bourg' else .8) / larg])
        elif sp == 'caserne':
            out.append([b, 'caserne', 'caserne', c[0], c[1], angB, cote / 92])
        elif sp == 'hotel':
            out.append([b, 'hotel', 'hotel', c[0], c[1], angB + math.pi, cote / 92])
        elif sp == 'couvent':
            out.append([b, 'couvent', 'couvent', c[0] - cote * .1, c[1] - cote * .02, angB, cote / 70])
        elif sp == 'hopital':
            out.append([b, 'hopital', 'hopital', c[0], c[1], angB, cote / 60])
    m = Pf['modele']
    if V['placeCentre'] and m != 'grande':
        out.append([None, 'halle', 'halle', IC[0], IC[1], Pf['routes'][0]['a'] if Pf['routes'] else 0.0, .1])
    if m == 'castrum':
        out.append([None, 'hotel', 'chateau', IC[0], IC[1] - 2, .2, 10 / 88])
    if m == 'fortin':
        out += [[None, 'caserne', 'caserne', IC[0], IC[1], 0.0, .15], [None, 'poudriere', 'poudriere', IC[0] + 12, IC[1] - 9, .6, .2],
                [None, 'eglise', 'egliseRomane', IC[0] - 11, IC[1] + 11, 0.0, .14]]
    if V['citadelle']:
        C2 = V['citadelle']['C']
        out.append([None, 'caserne', 'caserne', C2[0], C2[1], 0.0, .12])
    if V['gare']:
        g = V['gare']
        out.append([None, 'halle', 'gare', g['x'], g['y'], g['a'], .2])
    return out


def _enceinte_poly(V, L):
    """Le tracé de l'enceinte en mètres : (sommets, demi-lunes, bastionné ?, tours)."""
    Pf, IC = V['Pf'], PV.IC
    if Pf['murs'] == 'bastions':
        tr = V['trace']
        return ([L.tf(p) for p in tr['poly']], [[L.tf(r['b1']), L.tf(r['apex']), L.tf(r['b2'])] for r in tr['ravs']],
                True, None)
    if Pf['murs'] != 'medieval':
        return [], [], False, None
    if V['rect']:
        a, w, h = V['rect']['a'], V['rect']['w'], V['rect']['h']
        poly = [L.tf((IC[0] + math.cos(a) * u * (w / 2 + 3) - math.sin(a) * v * (h / 2 + 3),
                      IC[1] + math.sin(a) * u * (w / 2 + 3) + math.cos(a) * v * (h / 2 + 3)))
                for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        return poly, [], False, [[round(x), round(y)] for x, y in poly]
    r = V['murLigne']
    poly = [L.tf((IC[0] + math.cos(a) * r, IC[1] + math.sin(a) * r)) for a in (k * 2 * math.pi / 72 for k in range(72))]
    tours = [[round(x), round(y)] for x, y in _densify(poly + poly[:1], 9 * L.Mk)[:-1]]   # (une tour tous les 50 m)
    return poly, [], False, tours


def ville(m, pl, L, rng, spec, t, road_cells):
    """La place sur son plan : cases, enceinte, édifices, et ce que le client en dessine (m.plan)."""
    V, Pf = L.V, L.V['Pf']
    px, py = pos = L.pos
    Mk, tf = L.Mk, L.tf
    typ = pl['type'] if pl['type'] in VILLES else 'village'
    seed = int(spec['seed']) & 0x7FFFFFFF
    year = spec.get('year', 1790)
    fort = pl.get('fort', 0) if pl.get('battle') else 0   # (le jeu : brèches, portes fermées à l'assaillant)
    f_plan = Pf['f']
    att_a = spec.get('att_angle', 0.0)
    urbain = Pf['modele'] not in ('rue', 'airial', 'montagne')
    rue_t = T_ROUTE if urbain else T_CHEMIN
    kinds = m.kinds
    dist = lambda c: math.hypot(center_of(c)[0] - px, center_of(c)[1] - py)

    # la grille de campagne, grossière sur les côtes et l'estuaire, peut poser la place dans l'eau, coupée de la terre
    # ferme : elle est bâtie au sec, remparts et glacis compris, et une chaussée et son pont l'y relient (comme _town)
    road_cells = set(road_cells)
    chaussee = set()
    dry = L.r_mur + 60
    rc = int(dry // CELL) + 1
    ci, cj = int(px // CELL), int(py // CELL)
    mouille = any(t[j * COLS + i] == T_EAU for j in range(max(0, cj - rc), min(ROWS, cj + rc + 1))
                  for i in range(max(0, ci - rc), min(COLS, ci + rc + 1)))
    land = _mainland(t) if mouille else None   # (sans eau autour, la place est sur la terre ferme)
    if land is not None and cell_of(px, py) not in land:
        for j in range(max(0, cj - rc), min(ROWS, cj + rc + 1)):
            for i in range(max(0, ci - rc), min(COLS, ci + rc + 1)):
                c = j * COLS + i
                if t[c] == T_EAU and math.hypot(*(a - b for a, b in zip(center_of(c), pos))) < dry:
                    t[c] = T_PRE
        chaussee = {c for c in _causeway(m, t, px, py, spec.get('att_angle', 0.0), land) if t[c] != T_EAU}
        for c in chaussee:
            t[c] = T_ROUTE
        road_cells |= chaussee

    # en ville et aux portes, les routes d'un seul tenant par les côtés (pas de maison en travers, pas de pont qu'on ne
    # passe qu'en diagonale)
    loin = L.r_ville + 150
    for r in m.roads:
        for c in _line4(r['pts']):
            if 0 <= c < N and dist(c) < loin:
                if t[c] not in RUE:
                    t[c] = T_ROUTE if r['kind'] != 'chemin' else T_CHEMIN
                road_cells.add(c)

    # ------------------------------------------------ l'enceinte (cases des murs : rues et maisons s'y arrêtent)
    poly, ravs, bast, tours = _enceinte_poly(V, L)
    ct = V['citadelle']
    cpoly = [tf(p) for p in ct['poly']] if ct else []
    cinside = _dedans(cpoly) if cpoly else (lambda c: False)
    wall, inside = set(), None
    if poly:
        inside = _dedans(poly)
        outer = _line4(poly + poly[:1])
        wall = set(outer)
        if f_plan >= 2:   # (rempart épais : une seconde rangée de cases en dedans)
            for c in outer:
                for nc in (c - 1, c + 1, c - COLS, c + COLS):
                    if 0 <= nc < N and nc not in wall and inside(nc):
                        wall.add(nc)
        for rv in ravs:
            wall.update(c for c in _line4(rv) if not inside(c))
        wall = {c for c in wall if 0 <= c < N and t[c] != T_EAU and not cinside(c)}
    cwall = set()
    if cpoly:
        cwall = set(_line4(cpoly + cpoly[:1]))
        for c in list(cwall):
            for nc in (c - 1, c + 1, c - COLS, c + COLS):
                if 0 <= nc < N and nc not in cwall and cinside(nc):
                    cwall.add(nc)
        for rv in ct['ravs']:
            cwall.update(c for c in _line4([tf(rv['b1']), tf(rv['apex']), tf(rv['b2'])]) if not cinside(c))
        cwall = {c for c in cwall if 0 <= c < N and t[c] != T_EAU}
    murs = wall | cwall
    dedans = (lambda c: inside(c) or cinside(c)) if inside else cinside

    # ------------------------------------------------ îlots en mètres ; le sol de la ville (bois, landes… rasés)
    blocs = []
    for b in V['ilots']:
        ins = PV.decaler_quad(b['q'], PV.RUE_MAIN if b['main'] else PV.RUE)
        B = dict(b=b, q=[tf(p) for p in b['q']], ins=[tf(p) for p in ins] if ins else None)
        B['dq'] = _dans(B['q']) if b['zone'] == 'ville' else []   # (les cases de l'îlot, et celles sans sa rue)
        B['di'] = _dans(B['ins']) if ins else []
        blocs.append(B)
    sol = set()
    for B in blocs:
        if B['b']['zone'] == 'ville' and urbain:
            sol.update(B['dq'])
    if inside:
        rc = int(PV.rayon_enceinte(V) * Mk // CELL) + 2
        ci, cj = int(px // CELL), int(py // CELL)
        sol.update(c for c in (j * COLS + i for j in range(max(0, cj - rc), min(ROWS, cj + rc + 1))
                               for i in range(max(0, ci - rc), min(COLS, ci + rc + 1))) if dedans(c))
    for c in sol:
        if t[c] in SOL:
            t[c] = T_PRE

    # ------------------------------------------------ rues : les axes du plan, la grand-place
    # (une rue plus étroite qu'une case compte pour une case de passage, son axe ; une rue sur pas seulement, plus les
    # rues maîtresses, pour 80 m au moins entre deux rues : sinon, sur des cases de 20 m, la ville serait à moitié rue)
    streets = set()
    pas = max(1, math.ceil(4 * CELL / (12 * Mk)))
    seaux = {}
    for b in V['ilots']:
        seaux.setdefault((int(b['c'][0] // 14), int(b['c'][1] // 14)), []).append(b['c'])

    def pres_ilot(x, y):   # (comme peindreInterieur : une rue ne va que là où il y a des maisons)
        i0, j0 = int(x // 14), int(y // 14)
        return any(math.hypot(c[0] - x, c[1] - y) < 14 for di in (-1, 0, 1) for dj in (-1, 0, 1)
                   for c in seaux.get((i0 + di, j0 + dj), ()))
    rues_cl, ponts = [], []
    for rr in V['rues']:
        if not rr.get('main') and rr['n'] % pas:
            continue
        for a, b in zip(rr['pts'], rr['pts'][1:]):
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            if not pres_ilot(mx, my):
                continue
            if V['eau'](mx, my):
                if rr.get('main'):
                    ponts.append((tf(a), tf(b)))
                continue
            A, B_ = tf(a), tf(b)
            cm = cell_of((A[0] + B_[0]) / 2, (A[1] + B_[1]) / 2)
            if cm < 0 or t[cm] in (T_EAU, T_GUE):   # (l'eau de la bataille, plus large que celle du plan par endroits)
                continue
            rues_cl.append([round(A[0], 1), round(A[1], 1), round(B_[0], 1), round(B_[1], 1), 1 if rr.get('main') else 0])
            streets.update(_line4([A, B_]))
    if V['placeCentre']:
        r = V['rPlace'] * Mk
        streets.update(c for c in _dans([(px + math.cos(a) * r, py + math.sin(a) * r) for a in
                                          (k * math.pi / 12 for k in range(24))]))
        streets.add(cell_of(px, py))
    if Pf['murs'] == 'cours' and V['murLigne']:   # (les murs abattus : un boulevard planté)
        r = V['murLigne'] * Mk
        streets.update(_line4([(px + math.cos(a) * r, py + math.sin(a) * r) for a in (k * math.pi / 36 for k in range(73))]))
    streets = {c for c in streets if 0 <= c < N and c not in murs and t[c] not in (T_EAU, T_GUE)}
    for c in streets:
        if t[c] != T_ROUTE:
            t[c] = rue_t

    # ------------------------------------------------ édifices sur l'emprise de leur modèle
    reserve = set(murs) | road_cells | streets
    eds = []
    for b, kind, cle, x, y, a, s in _edifices(V, Pf):
        X, Y = tf((x, y))
        sm = s * Mk   # (m par unité du modèle)
        u0, v0, u1, v1 = BOITE[cle]
        ca, sa = math.cos(a), math.sin(a)
        corners = [(X + (u * ca - v * sa) * sm, Y + (u * sa + v * ca) * sm) for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]
        cour = CELL / sm   # (une case : l'épaisseur des bâtiments autour de la cour)
        foot = []
        for c in _dans(corners):
            if c in reserve or t[c] in (T_EAU, T_GUE) or kinds.get(c):
                continue
            cx, cy = center_of(c)
            dx, dy = cx - X, cy - Y
            u, v = (dx * ca + dy * sa) / sm, (-dx * sa + dy * ca) / sm
            if kind in COUR and u0 + cour < u < u1 - cour and v0 + cour < v < v1 - cour:
                t[c] = T_PRE
                continue
            t[c] = T_BATI
            kinds[c] = kind
            foot.append(c)
        if not foot:   # (trop petit pour une case : la case de son milieu, ou la plus proche hors des rues)
            c0 = cell_of(X, Y)
            for c in sorted((c0 + dj * COLS + di for dj in (-1, 0, 1) for di in (-1, 0, 1)),
                            key=lambda c: math.hypot(center_of(c)[0] - X, center_of(c)[1] - Y)) if c0 >= 0 else ():
                if 0 <= c < N and c not in reserve and t[c] not in (T_EAU, T_GUE) and not kinds.get(c):
                    t[c], kinds[c] = T_BATI, kind
                    foot.append(c)
                    break
        eds.append(dict(cle=cle, kind=kind, x=round(X, 1), y=round(Y, 1), a=round(a, 3), s=round(sm, 4),
                        b=None if b is None else id(b)))

    # ------------------------------------------------ îlots : maisons sur rue, cours et jardins au milieu
    ids = {id(B['b']): k for k, B in enumerate(blocs)}
    for e in eds:
        e['b'] = ids.get(e['b'])
    streets = {c for c in streets if t[c] != T_BATI}
    reserve = set(murs) | road_cells | streets
    pres_mur = bfs(sorted(murs), 2) if murs else bytearray([255]) * N   # (pas de maison du faubourg contre le mur)
    for B in blocs:
        b, ins = B['b'], B['ins']
        if not ins:
            continue
        sp, fau = b.get('role'), b['zone'] == 'faubourg'
        if fau and b.get('cotes') == [True, False, False, False]:
            # (maisons du faubourg au bord de la route : l'îlot rejoint la route, la bande des maisons part de là)
            q0, q1, q2, q3 = B['q']
            l0, l1 = math.hypot(q0[0] - q3[0], q0[1] - q3[1]) or 1, math.hypot(q1[0] - q2[0], q1[1] - q2[1]) or 1
            e = 1.5 * Mk   # (le front sur l'axe de la route ; les maisons sur une case au-delà de la route)
            ins = [(q0[0] + (q0[0] - q3[0]) / l0 * e, q0[1] + (q0[1] - q3[1]) / l0 * e),
                   (q1[0] + (q1[0] - q2[0]) / l1 * e, q1[1] + (q1[1] - q2[1]) / l1 * e), q2, q3]
        cells = [c for c in (B['di'] if ins is B['ins'] else _dans(ins)) if c not in reserve and t[c] not in (T_EAU, T_GUE) and not kinds.get(c)]
        if sp in ('place', 'parvis') or (sp in ('eglise', 'egliseDome', 'cathedrale') and urbain and V['type'] != 'bourg'):
            for c in cells:
                t[c] = T_ROUTE   # (pavé : la place, le parvis)
            continue
        if sp in ('jardin', 'eglise', 'egliseDome', 'cathedrale') or sp in COUR:
            for c in cells:
                t[c] = T_PRE   # (jardin public, cimetière du bourg, cours des couvents, casernes…)
            continue
        cx0 = sum(p[0] for p in ins) / 4, sum(p[1] for p in ins) / 4
        ed = _cotes(ins, cx0)
        cotes = b.get('cotes') or ([True, False, False, False] if fau else [True] * 4)
        fronts = [e for e, on in zip(ed, cotes) if on]
        prof = max(CELL, PROF) + (CELL if fau and cotes == [True, False, False, False] else 0)
        for c in cells:
            x, y = center_of(c)
            d = min(_seg_dist(x, y, a[0], a[1], a[0] + u[0] * l, a[1] + u[1] * l) for a, l, u, _ in fronts)
            if d <= prof and not (fau and pres_mur[c] <= 2 and not dedans(c)):
                t[c] = T_BATI
                kinds[c] = 'hotel' if sp == 'royale' else 'maison'
            else:
                t[c] = T_ROUTE if sp == 'royale' else T_PRE
        for c in cells:   # (une maison donne sur la rue : sans rue à côté, c'est la cour)
            if t[c] == T_BATI and not any(0 <= nc < N and t[nc] in RUE for nc in (c - 1, c + 1, c - COLS, c + COLS)):
                t[c] = T_PRE
                del kinds[c]

    # ------------------------------------------------ quais, ponts des rues maîtresses
    rq = V['rMur'] * Mk * 1.15
    if Pf['port']:
        for c in list(sol) + [c for c in streets]:
            if t[c] in (T_PRE, rue_t) and c not in murs and dist(c) < rq and \
                    any(0 <= nc < N and t[nc] == T_EAU for nc in (c - 1, c + 1, c - COLS, c + COLS)):
                t[c] = T_ROUTE
                streets.add(c)
    # les quais du plan (peindreInterieur) : le long de la première rivière d'un port, des deux côtés, jusqu'à 1,15 R
    quais, bateaux, quai_c = [], [], set()
    if Pf['port'] and Pf['rivs']:
        nomr, rq2 = Pf['rivs'][0]['name'], Pf['R'] * 1.15 * Mk
        for rv in m.rivers:
            if rv.get('name') != nomr:
                continue
            for sg in (-1, 1):
                pts = [p for p in _decaler(rv['pts'], sg * (rv['w'] / 2 + 5)) if math.hypot(p[0] - px, p[1] - py) < rq2]
                runs, cur = [], []   # (le quai sur la rive seulement : pas où la mer ou l'estuaire la noient)
                for p in pts:
                    c = cell_of(*p)
                    if c >= 0 and t[c] not in (T_EAU, T_GUE):
                        cur.append(p)
                    else:
                        if len(cur) > 1:
                            runs.append(cur)
                        cur = []
                if len(cur) > 1:
                    runs.append(cur)
                for ligne in runs:
                    quais.append([[round(x, 1), round(y, 1)] for x, y in ligne])
                for c in (c for ligne in runs for c in _line4(ligne)):
                    if t[c] not in (T_EAU, T_GUE, T_BATI) and c not in murs:
                        t[c] = T_ROUTE
                        streets.add(c)
                        quai_c.add(c)
                # des bateaux amarrés le long du quai (côté de l'eau)
                bord = _decaler(rv['pts'], sg * max(4.0, rv['w'] / 2 - 7))
                for k in range(1, len(bord) - 1, 2):
                    x, y = bord[k]
                    if math.hypot(x - px, y - py) < rq2 and PV.hash2(k, sg, Pf['sd']) < .45 and t[cell_of(x, y)] == T_EAU:
                        a = math.atan2(bord[k + 1][1] - bord[k - 1][1], bord[k + 1][0] - bord[k - 1][0])
                        bateaux.append([round(x, 1), round(y, 1), round(a, 2), 1 if rv['rank'] <= 1 and PV.hash2(k, 3, Pf['sd']) < .5 else 0])
    if Pf['port'] and Pf['mer']:   # (au mouillage, au large : comme la vue de l'intérieur)
        for i in range(6):
            a = Pf['mer']['a'] + (PV.hash2(i, 1, Pf['sd']) - .5) * .8
            d = Pf['R'] * (1.1 + PV.hash2(i, 2, Pf['sd']) * .8)
            x, y = tf((PV.IC[0] + math.cos(a) * d, PV.IC[1] + math.sin(a) * d))
            if cell_of(x, y) >= 0 and t[cell_of(x, y)] == T_EAU:
                bateaux.append([round(x, 1), round(y, 1), round(PV.hash2(i, 3, Pf['sd']) * 6.28, 2), 1 if PV.hash2(i, 4, Pf['sd']) < .4 else 0])
    for A, B_ in ponts:
        cells = _line4([A, B_])
        wet = [c for c in cells if t[c] in (T_EAU, T_GUE)]
        if wet and len(wet) <= 8 and all(t[c] not in (T_BATI,) and c not in murs for c in cells):
            for c in cells:
                t[c] = T_ROUTE
                streets.add(c)
            _add_bridge(m, wet, t)

    # ------------------------------------------------ dans les murs : terre-plein, rue du rempart
    ring = set()
    if inside:
        for c in sol:
            if t[c] not in RUE and t[c] not in (T_EAU, T_GUE, T_BATI) and c not in murs:
                t[c] = T_PRE
        for c in wall:
            for nc in (c - 1, c + 1, c - COLS, c + COLS):
                if 0 <= nc < N and nc not in murs and inside(nc) and t[nc] in (T_PRE,) and not kinds.get(nc):
                    ring.add(nc)
                    t[nc] = T_ROUTE
                    streets.add(nc)
    # le centre tient aux routes (un fort sans route du plan : un chemin jusqu'à la route la plus proche)
    c0 = cell_of(px, py)
    vus, todo, relie = {c0}, [c0], False
    while todo and not relie:
        c = todo.pop()
        for nc in (c - 1, c + 1, c - COLS, c + COLS):
            if 0 <= nc < N and nc not in vus and abs(nc % COLS - c % COLS) <= 1 and (t[nc] in RUE or nc in road_cells):
                relie = relie or nc in road_cells
                vus.add(nc)
                todo.append(nc)
    if not relie and road_cells:
        but = min((c for c in road_cells if c not in murs), key=dist, default=None)
        if but is not None:
            pts = [(px, py), center_of(but)]
            for c in _line4(pts):
                if t[c] in (T_EAU, T_GUE) or c in murs:
                    continue
                t[c] = T_ROUTE
                kinds.pop(c, None)
                streets.add(c)
            m.roads.append(dict(pts=pts, kind='chemin'))
    # (une rue sans issue, coupée du réseau par un édifice ou au fond d'un bastion, redevient jardin)
    net = set(road_cells) | {cell_of(px, py)}
    todo = list(net)
    while todo:
        c = todo.pop()
        for nc in (c - 1, c + 1, c - COLS, c + COLS):
            if 0 <= nc < N and nc not in net and abs(nc % COLS - c % COLS) <= 1 and t[nc] in RUE:
                net.add(nc)
                todo.append(nc)
    for c in streets:
        if c not in net and t[c] == T_ROUTE and c not in road_cells and c not in quai_c:
            t[c] = T_PRE

    metiers, vignes, salines = _metiers(m, pl, L, t, kinds, murs, road_cells | streets, att_a)

    # ------------------------------------------------ l'enceinte sur la carte : murs, portes, glacis, brèches
    allst = road_cells | streets
    R = V['rMur'] * Mk
    if wall:
        _enceinte(m, pl, pos, R, f_plan, bast, poly, ravs, wall, inside, allst, rng, t, att_a,
                  kind=None if bast else 'mur', tours=tours)
    if cwall:
        _enceinte(m, pl, tf(ct['C']), R, max(f_plan, 2), True, cpoly,
                  [[tf(rv['b1']), tf(rv['apex']), tf(rv['b2'])] for rv in ct['ravs']], cwall, cinside, allst, rng, t,
                  att_a, principal=not wall)
    # (les cases de ville en dehors des îlots et des rues : pré)
    r_mur = PV.rayon_enceinte(V) * Mk
    m.town_r = max(r_mur if (wall or cwall) else R, 60.0)   # (fermes et vergers se tiennent au-delà, glacis compris)
    m.place = dict(name=pl['name'], x=round(px), y=round(py), type=typ, r=round(r_mur if (wall or cwall) else R),
                   fort=pl.get('fort', 0), battle=bool(pl.get('battle')))
    # le cœur (l'objectif) : l'église ou la cathédrale, sinon la place, le château, le centre
    lieux = V['lieux']
    hx, hy = tf(lieux.get('cathedrale') or lieux.get('eglise') or lieux.get('chateau') or lieux.get('citadelle') or PV.IC)
    m.heart = (round(hx), round(hy))
    m.town = dict(type=typ, x=round(px), y=round(py), r=round(max(R, 60.0)), siecle=(year - 1) // 100 + 1,
                  enceinte=(m.walls[-1]['kind'] if (wall or cwall) else None))
    bar = pl.get('bar', 0.0) if pl.get('battle') else 0.0
    if bar > 0.05:
        if not (wall or cwall):
            _barricades(m, pos, R, bar, rng, t, att_a)
        else:
            _redoubts(m, pos, r_mur, bar, rng, t, att_a)
    # ------------------------------------------------ pour le client : le plan en mètres (decor2d.js le dessine)
    r1 = lambda p: [round(p[0], 1), round(p[1], 1)]
    m.plan = dict(
        k=round(Mk, 5), c=[round(px, 1), round(py, 1)], style=Pf['style'], modele=Pf['modele'], type=V['type'],
        murs=Pf['murs'], echelle=round(L.k, 4), nid=L.nid, f=Pf['f'], pop=Pf['pop'], d=Pf['d'],   # (l'état du plan)
        ilots=[[[r1(p) for p in B['q']], B['b'].get('role') or '', 1 if B['b']['zone'] == 'faubourg' else 0,
                1 if B['b']['main'] else 0, int(PV.hash2(k, 7, Pf['sd']) * 2 ** 31),
                sum(1 << i for i, on in enumerate(B['b'].get('cotes') or []) if on)]
               for k, B in enumerate(blocs)],
        rues=rues_cl, edifices=eds, place=[round(px, 1), round(py, 1), round(V['rPlace'] * Mk, 1)] if V['placeCentre'] else None,
        cours=round(V['murLigne'] * Mk, 1) if Pf['murs'] == 'cours' and V['murLigne'] else None,
        metiers=metiers, vignes=vignes, salines=salines, quais=quais, bateaux=bateaux)


def _decaler(pts, d):
    """Le tracé décalé de d sur sa gauche (lib.js : decaler)."""
    out = []
    for i, p in enumerate(pts):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        l = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
        out.append((p[0] - (b[1] - a[1]) / l * d, p[1] + (b[0] - a[0]) / l * d))
    return out


def _metiers(m, pl, L, t, kinds, murs, rues, att_a):
    """Les métiers du plan (châteaux viticoles et leurs vignes, scieries, forges, salines, séchoirs, moulins, fermes,
    airiaux) sur la carte, à leur place (à l'échelle) et à leur vraie taille : bâtiments en BATI, vignes en VIGNE,
    salines en MARAIS. Rien sur le glacis (140 m), à moins de 80 m d'une porte, dans la bande de l'assaillant, sur
    une route, l'eau ou une maison. Renvoie ce que le client dessine."""
    V, Pf = L.V, L.V['Pf']
    tf, Mk = L.tf, L.Mk
    px, py = L.pos
    pres = bfs(sorted(murs), 7) if murs else bytearray([255]) * N
    portes = [c for c in murs if c in rues]
    pres_p = bfs(portes, 4) if portes else bytearray([255]) * N
    bandes = []
    if pl.get('battle'):   # (la bande de déploiement de l'assaillant, comme battle._zones ; de tous les bords près de l'eau)
        r = PV.rayon_enceinte(V) * Mk
        room = dict(O=px, E=W - px, N=py, S=H - py)
        # (le bord de l'assaillant comme battle._zones le choisira : le plus sec si le sien est noyé)
        def band(e, dep):
            return dict(O=(0, 100, dep, H - 100), E=(W - dep, 100, W, H - 100), N=(150, 0, W - 150, dep), S=(150, H - dep, W - 150, H))[e]

        def sec(bx):
            cs = [j * COLS + i for j in range(int(bx[1] // CELL), min(ROWS, int(bx[3] // CELL)))
                  for i in range(int(bx[0] // CELL), min(COLS, int(bx[2] // CELL)))]
            return sum(t[c] != T_EAU for c in cs) / max(1, len(cs))
        e0 = bord_assaillant(att_a)
        if sec(band(e0, 600)) < 0.4:
            e0 = max('ONES', key=lambda e: (sec(band(e, 600)), e == e0))
        for e in (e0,):
            d = room[e] - r
            # (au plus les 250 premiers mètres : là où il entre et se range ; plus loin, les fermes de la campagne
            # y sont aussi, comme sur toute carte)
            dep = min(250, max(max(200, min(500, d - 150)), d - 450))
            bandes.append(band(e, dep))
    ok_c = lambda c: (0 <= c < N and t[c] not in (T_EAU, T_GUE, T_BATI, T_MUR, T_PORTE) and c not in rues and
                      c not in murs and pres[c] > 7 and pres_p[c] > 4)
    r_in = L.r_mur * 1.05 + 20 if murs else 0.0   # (rien entre les bastions : hors de l'enceinte, au-delà de ses pointes)
    dans_bande = lambda x, y: math.hypot(x - px, y - py) < r_in or any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in bandes)
    eaux = [r for r in m.rivers if r['kind'] != 'ruisseau']
    out, vignes, salines = [], [], []
    for p in V['plus']:
        if 'x' not in p:
            continue
        X, Y = tf((p['x'], p['y']))
        if not (40 < X < W - 40 and 40 < Y < H - 40) or dans_bande(X, Y):
            continue
        k = p['k']
        if k == 'salines':   # (douze bassins, comme l'intérieur, à l'échelle du plan)
            bas = []
            for i in range(12):
                x0, y0 = p['x'] - 40 + (i % 4) * 20, p['y'] - 24 + (i // 4) * 16
                q = [tf((x0, y0)), tf((x0 + 17, y0)), tf((x0 + 17, y0 + 13)), tf((x0, y0 + 13))]
                cs = [c for c in _dans(q) if ok_c(c)]
                if not cs and len(_dans(q)):
                    continue
                for c in cs:
                    t[c] = m.garder[c] = T_MARAIS_T
                bas.append([[round(a, 1), round(b, 1)] for a, b in q])
            if bas:
                salines.append(bas)
            continue
        if k == 'moulin' and any(min(_seg_dist(X, Y, *a, *b) for a, b in zip(r['pts'], r['pts'][1:])) < r['w'] / 2 + 60
                                for r in eaux):
            k = 'moulinEau'   # (au bord de l'eau, un moulin à roue)
        if k == 'ferme' and Pf['style'] in ('bearn', 'basque'):
            k = 'mas'
        cle, kind, (u0, v0, u1, v1), s = METIERS[k]
        a = p['a']
        if k == 'moulinEau':   # (la roue tournée vers la rivière la plus proche)
            r = min(eaux, key=lambda r: min(_seg_dist(X, Y, *a_, *b_) for a_, b_ in zip(r['pts'], r['pts'][1:])))
            q = min(r['pts'], key=lambda q: (q[0] - X) ** 2 + (q[1] - Y) ** 2)
            a = math.atan2(q[1] - Y, q[0] - X) + math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        X0, Y0 = X, Y
        for dx, dy in ((0, 0), (20, 0), (-20, 0), (0, 20), (0, -20), (30, 30), (-30, 30), (30, -30), (-30, -30), (50, 0),
                       (-50, 0), (0, 50), (0, -50)):   # (une route ou une maison à sa place : un peu à côté)
            X, Y = X0 + dx, Y0 + dy
            coins = [(X + (u * ca - v * sa) * s, Y + (u * sa + v * ca) * s) for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]
            foot = sorted(set(_dans(coins)) | {cell_of(X, Y)})   # (la case de son milieu, au moins)
            if all(ok_c(c) for c in foot) and not dans_bande(X, Y):
                break
        else:
            continue
        for c in foot:
            t[c] = T_BATI
            kinds[c] = kind
        out.append(dict(k=k, cle=cle, kind=kind, x=round(X, 1), y=round(Y, 1), a=round(a, 3), s=s))
        if k == 'chateauVin':   # ses quatre vignes (peindreInterieur), à l'échelle du plan
            for i in range(4):
                x0, y0 = p['x'] - 70 + (i % 2) * 74, p['y'] + (-70 if i < 2 else 34)
                q = [tf((x0, y0)), tf((x0 + 66, y0)), tf((x0 + 66, y0 + 34)), tf((x0, y0 + 34))]
                for c in _dans(q):
                    if ok_c(c) and t[c] in (T_PRE, T_CHAMP, T_LANDE_T, T_VERGER):
                        t[c] = m.garder[c] = T_VIGNE_T
                vignes.append([[round(a_, 1), round(b_, 1)] for a_, b_ in q])
    return out, vignes, salines
