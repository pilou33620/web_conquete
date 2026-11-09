"""Toute la France (SPEC-FRANCE.md) : la géographie 3, ses camps, une partie qui joue."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'outils'))

from game import rules as R
from game.geo import GeoMap, NONE
from game.engine import Game

GEO = GeoMap()


class France(unittest.TestCase):
    def test_tous_les_departements_jouables(self):
        self.assertEqual(GEO.version, 3)
        self.assertEqual(len(GEO.playable_codes), 89)
        self.assertTrue({'33', '75', '69', '13', '20', '67'} <= GEO.playable_codes)
        for c in GEO.playable_codes:
            self.assertIn(c, R.FACTIONS, f'{c} sans camp')

    def test_un_chef_lieu_par_departement_dans_son_departement(self):
        caps = {}
        for n in GEO.nodes:
            if n['type'] == 'capitale':
                self.assertNotIn(n['dept'], caps, f"deux chefs-lieux dans le {n['dept']}")
                caps[n['dept']] = n
                self.assertEqual(GEO.dept_at(n['x'], n['y']), n['dept'], f"{n['name']} hors de son département")
        self.assertEqual(set(caps), GEO.playable_codes)
        self.assertEqual(caps['75']['name'], 'Paris')

    def test_plus_de_254_places(self):
        # (cellnode sur deux octets : 2 000 places et plus)
        self.assertGreater(len(GEO.nodes), 2000)
        vus = {v for v in GEO.cellnode if v != NONE}
        self.assertGreater(max(vus), 254)

    def test_le_reseau_routier_relie_le_continent(self):
        nb = {}
        for e in GEO.edges:
            nb.setdefault(e['a'], set()).add(e['b']); nb.setdefault(e['b'], set()).add(e['a'])
        paris = GEO.by_name['Paris']
        vus, pile = {paris}, [paris]
        while pile:
            for v in nb.get(pile.pop(), ()):
                if v not in vus:
                    vus.add(v); pile.append(v)
        for nom in ('Bordeaux', 'Lille', 'Strasbourg', 'Marseille', 'Brest', 'Perpignan', 'Nice'):
            self.assertIn(GEO.by_name[nom], vus, f'{nom} coupée de Paris')

    def test_une_partie_de_france_joue_un_mois(self):
        import simuler as S
        from game.ai import AI
        g = Game(GEO, '69', 'normal', 3, '1790')
        self.assertEqual(len(g.factions), 89)
        g.ais[g.player] = AI(g, g.player)
        S.play_month(g)
        self.assertEqual(g.date().month, 4)
        self.assertTrue(all(f['alive'] for f in g.factions.values()))

    def test_ia_allegee_des_camps_lointains(self):
        # (SPEC-FRANCE.md : un camp loin du joueur réfléchit une fois par semaine et joue quand même ; un voisin, ou un
        # camp en guerre avec lui, garde l'IA complète)
        g = Game(GEO, '33', 'normal', 3, '1790')
        self.assertFalse(g.ia_lointaine('24'))   # la Dordogne, voisine
        self.assertTrue(g.ia_lointaine('67'))    # le Bas-Rhin
        self.assertEqual((g.ai_pas('24'), g.ai_pas('67')), (1.5, 6.0))
        pas = {'24': [], '67': []}
        for c, t in pas.items():
            ai = g.ais[c]
            ai.step = (lambda ai=ai, t=t, step=ai.step: (t.append(g.t), step()))
        places = len(g.owned_nodes('67'))
        while g.t < 20:
            g.step(0.1)
        self.assertGreaterEqual(len(pas['24']), 12)
        self.assertTrue(3 <= len(pas['67']) <= 4, pas['67'])
        self.assertGreater(len(g.owned_nodes('67')), places)   # il rallie ses villages
        # la guerre déclarée au joueur le réveille dans le quart de journée, et il reprend le pas complet
        g.set_status('33', '67', 'guerre')
        n = len(pas['67'])
        while g.t < 20.3:
            g.step(0.05)
        self.assertEqual(len(pas['67']), n + 1)
        self.assertEqual(g.ai_pas('67'), 1.5)

    def test_le_sud_ouest_garde_l_ia_complete(self):
        from fabrique import partie
        g = partie('33')
        self.assertFalse(any(g.ia_lointaine(c) for c in g.factions))
        self.assertFalse(g.bataille_proche())

    def test_plus_proche_place(self):
        import math
        import random
        from game.ai import nearest_dist
        rng = random.Random(1)
        for _ in range(50):
            pts = [(rng.uniform(0, 900), rng.uniform(0, 900)) for _ in range(rng.randint(1, 80))]
            near = nearest_dist(pts)
            for _ in range(10):
                x, y = rng.uniform(-200, 1100), rng.uniform(-200, 1100)
                self.assertEqual(near(x, y), min(math.hypot(x - a, y - b) for a, b in pts))


if __name__ == '__main__':
    unittest.main()
