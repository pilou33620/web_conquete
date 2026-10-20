"""Banc du générateur de cartes de bataille (game/tactics/terrain.py, SPEC-CARTES.md) : python3 tests/test_cartes.py

POURQUOI CE BANC EXISTE. Les cartes doivent rester les mêmes pour une graine donnée (une bataille rechargée, la
maquette, les bancs d'équilibre en dépendent), ne plus être quadrillées, organiser le terroir (vergers près des
maisons, jamais sur le glacis d'une place forte) et se calculer vite, même sur un Raspberry Pi.
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
VILLAGES = [n for n in GEO.nodes if n['type'] in ('village', 'bourg', 'ville')][::9][:10]
CROP = {TR.T_CHAMP, TR.T_PRE, TR.T_VIGNE_T, TR.T_LANDE_T, TR.T_VERGER}


def carte(k, n, place=None):
    spec = dict(seed=500 + k * 31, cx=n['x'] + 0.6, cy=n['y'] + 0.4, season='ete', weather='soleil', year=1790, place=place)
    return TR.generate(GEO, spec)


def droites(m):
    """Part des bords entre deux cultures différentes qui forment des droites de 5 cases (100 m) ou plus."""
    t, tot, al = m.t, 0, 0
    for vertical in (True, False):
        outer, inner = (TR.COLS - 1, TR.ROWS) if vertical else (TR.ROWS - 1, TR.COLS)
        for a in range(outer):
            run = 0
            for b in range(inner + 1):
                edge = False
                if b < inner:
                    c, d = (b * TR.COLS + a, b * TR.COLS + a + 1) if vertical else (a * TR.COLS + b, (a + 1) * TR.COLS + b)
                    edge = t[c] != t[d] and t[c] in CROP and t[d] in CROP
                if edge:
                    run += 1
                else:
                    tot += run
                    al += run if run >= 5 else 0
                    run = 0
    return al / max(1, tot)


class Cartes(unittest.TestCase):
    def test_meme_graine_meme_carte(self):
        a, b = carte(1, VILLAGES[0]), carte(1, VILLAGES[0])
        self.assertEqual(bytes(a.t), bytes(b.t))
        self.assertEqual(bytes(a.h), bytes(b.h))
        self.assertEqual(a.roads, b.roads)

    def test_plus_de_quadrillage(self):
        parts = [droites(carte(k, n)) for k, n in enumerate(VILLAGES)]
        moy = sum(parts) / len(parts)
        self.assertLess(moy, 0.30, f'{moy:.0%} des bords de parcelles en longues droites alignées')

    def test_vergers_pres_des_maisons(self):
        n_verger, loin = 0, 0
        for k, n in enumerate(VILLAGES):
            m = carte(k, n)
            maisons = [TR.center_of(c) for c in range(TR.N) if m.t[c] == TR.T_BATI]
            for c in range(TR.N):
                if m.t[c] != TR.T_VERGER:
                    continue
                n_verger += 1
                x, y = TR.center_of(c)
                if min(math.hypot(x - a, y - b) for a, b in maisons) > 300:
                    loin += 1
        self.assertGreater(n_verger, 0, 'des vergers à la campagne')
        self.assertLess(loin / n_verger, 0.05, 'les vergers sont près des maisons')

    def test_glacis_degage(self):
        n = next(g for g in GEO.nodes if g['type'] in ('ville', 'fort'))
        pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=2, dmg=0.0, bar=0.0, pop=n['pop0'], x=n['x'], y=n['y'], battle=True)
        for k in range(3):
            spec = dict(seed=900 + k, cx=n['x'], cy=n['y'], season='ete', weather='soleil', year=1790, place=pl, att_angle=0.0)
            m = TR.generate(GEO, spec)
            px, py, r = m.place['x'], m.place['y'], m.town_r + 300
            for c in range(TR.N):
                if m.t[c] == TR.T_VERGER:
                    x, y = TR.center_of(c)
                    self.assertGreater(math.hypot(x - px, y - py), r - TR.CELL, 'pas de verger sur le glacis')

    def test_vite(self):
        t0 = time.perf_counter()
        for k, n in enumerate(VILLAGES[:5]):
            carte(k, n)
        self.assertLess((time.perf_counter() - t0) / 5, 0.5, 'moins d’une demi-seconde par carte sur un PC')


if __name__ == '__main__':
    unittest.main()
