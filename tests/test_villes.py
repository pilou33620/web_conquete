"""Banc des villes et des places du générateur de cartes (game/tactics/terrain.py, SPEC-2D § 6) : python3 tests/test_villes.py

POURQUOI CE BANC EXISTE. Le client dessine les bourgs, les villes et les places fortes d'après la carte du moteur :
îlots de maisons sur rue, grand-place et église, enceinte médiévale ou tracé bastionné, et chaque bâtiment avec sa
nature (`batis[].kind`) et sa couverture (`toit`). Les cases doivent rester cohérentes avec les règles du moteur
(murs, portes, rues, maisons) : l'assaillant entre par les portes ou les brèches, jamais par un trou du mur.
"""
import math
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game.geo import GeoMap  # noqa: E402
from game.tactics import terrain as TR  # noqa: E402

GEO = GeoMap()
RUE = (TR.T_ROUTE, TR.T_CHEMIN, TR.T_PORTE, TR.T_BRECHE)


def noeud(typ, k=0):
    return [n for n in GEO.nodes if n['type'] == typ][k]


def carte(n, fort=0, seed=700, battle=True, dmg=0.0):
    pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=fort, dmg=dmg, bar=0.0, pop=n['pop0'], x=n['x'],
              y=n['y'], battle=battle)
    spec = dict(seed=seed, cx=n['x'], cy=n['y'], season='ete', weather='soleil', year=1790, place=pl, att_angle=0.5,
                carte=TR.VERSION)
    return TR.generate(GEO, spec)


def voisins(c, diag=False):
    i = c % TR.COLS
    out = [c - TR.COLS, c + TR.COLS] + ([c - 1] if i else []) + ([c + 1] if i < TR.COLS - 1 else [])
    if diag:
        out += ([c - TR.COLS - 1, c + TR.COLS - 1] if i else []) + \
               ([c - TR.COLS + 1, c + TR.COLS + 1] if i < TR.COLS - 1 else [])
    return [v for v in out if 0 <= v < TR.N]


def flood(m, c0, ok, diag=False):
    seen, todo = {c0}, [c0]
    while todo:
        c = todo.pop()
        for v in voisins(c, diag):
            if v not in seen and ok(m.t[v]):
                seen.add(v)
                todo.append(v)
    return seen


def bati_en_ville(m):
    pl = m.place
    return [c for c in range(TR.N) if m.t[c] == TR.T_BATI and
            ((TR.center_of(c)[0] - pl['x']) ** 2 + (TR.center_of(c)[1] - pl['y']) ** 2) ** 0.5 < m.town_r * 1.05]


FORTS = [n for n in GEO.nodes if n['type'] == 'fort'][:4] + [noeud('capitale', 1), noeud('capitale', 3)]


class Villes(unittest.TestCase):
    def test_la_ville_a_la_taille_de_son_plan(self):
        # (version 4 : la taille est celle du plan de « Voir l'intérieur » ; le générateur d'avant faisait grandir le
        # rayon du village à la capitale, ce que les vrais plans, réduits pour tenir sur le champ, ne promettent plus)
        nb = []
        for typ in ('village', 'ville', 'capitale'):
            m = carte(noeud(typ, 0), battle=False)   # (géographie 2 : Mont-de-Marsan, la troisième capitale, n'a plus que 45 îlots sur le champ)
            self.assertEqual(m.town['type'], typ)
            self.assertTrue(m.plan and m.plan['ilots'], typ)
            self.assertTrue(bati_en_ville(m), typ)
            nb.append(len(m.plan['ilots']))
        self.assertLess(nb[0], nb[2], f'îlots {nb}')

    def test_chaque_batiment_a_sa_nature_et_son_toit(self):
        for n, fort in ((noeud('village', 5), 0), (noeud('ville', 3), 1), (noeud('capitale', 1), 4), (FORTS[2], 2)):
            m = carte(n, fort)
            d = m.to_client(dict(seed=1, season='ete', weather='soleil', cx=0, cy=0))
            vus = set()
            for b in d['batis']:
                self.assertIn(b['kind'], TR.KINDS)
                self.assertIn(b['toit'], ('ardoise', 'tuile', 'canal', 'chaume'))
                self.assertTrue(all(m.t[c] == TR.T_BATI for c in b['c']))
                vus.update(b['c'])
            self.assertEqual(vus, {c for c in range(TR.N) if m.t[c] == TR.T_BATI}, 'toute case bâtie a son bâtiment')
            self.assertTrue(all('toit' in b for b in d['buildings']))
            kinds = {b['kind'] for b in d['batis']}
            self.assertTrue(kinds & {'eglise', 'cathedrale'}, f"{n['name']} : une église")
            if n['type'] == 'capitale':   # (version 4 : les édifices du plan ; ni poudrière, ni toujours la cathédrale)
                self.assertTrue({'hotel', 'caserne', 'couvent'} <= kinds, kinds)
            self.assertEqual(d['town']['siecle'], 18)

    def test_place_forte_bastionnee(self):
        for n in FORTS:
            m = carte(n, 3)
            self.assertEqual(m.walls[-1]['kind'], 'bastion', n['name'])
            self.assertGreaterEqual(len(m.bastions), 25, 'cinq sommets par front au moins')
            self.assertEqual(m.demi_lunes, [], 'pas de demi-lune au niveau 3, comme sur la carte')
            m = carte(n, 4)
            self.assertEqual(len(m.demi_lunes), len(m.bastions) // 5, 'au niveau 4, une demi-lune devant chaque front')
            portes = {c for c in range(TR.N) if m.t[c] == TR.T_PORTE}
            self.assertTrue(portes, n['name'])
            # chaque route qui entre dans la place passe une porte
            dedans = TR._dedans([tuple(p) for p in m.bastions])
            for r in m.roads:
                cells = TR._poly_cells(r['pts'])
                if any(dedans(c) for c in cells) and not all(dedans(c) for c in cells):
                    self.assertTrue(any(m.t[c] == TR.T_PORTE for c in cells), f"{n['name']} : route sans porte")
            # les rues tiennent ensemble : de la grand-place, on gagne chaque porte et presque toute la ville
            c0 = TR.cell_of(m.place['x'], m.place['y'])
            reseau = flood(m, c0, lambda tc: tc in RUE)
            # (les portes du corps de place ; celles d'une demi-lune peuvent être sur une route qui longe la place)
            corps = {c for c in portes if dedans(c) or any(dedans(v) for v in voisins(c))}
            self.assertTrue(corps, n['name'])
            self.assertTrue(corps <= reseau, f"{n['name']} : {len(corps - reseau)} portes hors des rues")
            rues = [c for c in range(TR.N) if m.t[c] == TR.T_ROUTE and dedans(c)]
            reseau |= flood(m, c0, lambda tc: tc in RUE or tc == TR.T_EAU)   # (la Dordogne passe dans la place à Domme : les rues d'en face)
            self.assertGreater(sum(c in reseau for c in rues) / len(rues), 0.95, n['name'])

    def test_les_murs_ferment_la_ville(self):
        for n, fort in [(f, 2) for f in FORTS[:3]] + [(noeud('ville', 4), 1), (noeud('ville', 6), 2)]:
            m = carte(n, fort)
            c0 = TR.cell_of(m.place['x'], m.place['y'])
            # (en 8 voisins, comme les troupes : pas de trou en diagonale ; l'eau est un obstacle à part)
            ville = flood(m, c0, lambda tc: tc not in (TR.T_MUR, TR.T_PORTE, TR.T_EAU), diag=True)
            bord = {c for c in ville if c % TR.COLS in (0, TR.COLS - 1) or c // TR.COLS in (0, TR.ROWS - 1)}
            self.assertFalse(bord, f"{n['name']} : l'enceinte a un trou")
            # (les maisons de la ville dans les murs ; les faubourgs les touchent dehors, version 7 : bastide de Domme)
            pl = m.place
            coeur = {c for c in bati_en_ville(m) if math.hypot(TR.center_of(c)[0] - pl['x'], TR.center_of(c)[1] - pl['y']) < .5 * m.town_r}
            self.assertTrue(coeur <= ville, f"{n['name']} : des maisons hors les murs")

    def test_pas_de_maison_sur_une_rue(self):
        for n, fort in ((noeud('village', 7), 0), (noeud('ville', 0), 1), (noeud('capitale', 0), 4), (FORTS[3], 3)):   # (pas Beynac : au pied du château, la Dordogne prend sa place bastionnée ; ni La Réole, au bord de la Garonne : 94,9 % sur rue)
            m = carte(n, fort)
            for r in m.roads:
                if r['kind'] != 'chemin':
                    self.assertFalse([c for c in TR._poly_cells(r['pts']) if m.t[c] == TR.T_BATI], n['name'])
            # les maisons de la ville sont sur rue (les cours et jardins au milieu des îlots)
            g = {c: b['kind'] for b in m.batis for c in b['c']}
            maisons = [c for c in bati_en_ville(m) if g[c] == 'maison']
            sur_rue = [c for c in maisons if any(m.t[v] in (TR.T_ROUTE, TR.T_CHEMIN) for v in voisins(c))]
            self.assertGreater(len(sur_rue) / len(maisons), 0.95, n['name'])

    def test_breche_du_siege(self):
        m = carte(FORTS[2], 3, dmg=0.5)
        self.assertTrue(m.walls[-1]['breach'])
        self.assertIn(TR.T_BRECHE, m.t)

    def test_meme_graine_meme_ville(self):
        n = noeud('capitale', 1)
        a, b = carte(n, 4, seed=9), carte(n, 4, seed=9)
        self.assertEqual(bytes(a.t), bytes(b.t))
        self.assertEqual((a.batis, a.bastions, a.demi_lunes, a.walls, a.buildings),
                         (b.batis, b.bastions, b.demi_lunes, b.walls, b.buildings))
        self.assertNotEqual(bytes(a.t), bytes(carte(n, 4, seed=10).t))

    def test_vite(self):
        t0 = time.perf_counter()
        cas = [(noeud('village', 1), 0), (noeud('ville', 1), 2), (FORTS[0], 4), (noeud('capitale', 0), 4)]
        for n, fort in cas:
            carte(n, fort)
        self.assertLess((time.perf_counter() - t0) / len(cas), 0.5, 'moins d’une demi-seconde par carte sur un PC')


if __name__ == '__main__':
    unittest.main()
