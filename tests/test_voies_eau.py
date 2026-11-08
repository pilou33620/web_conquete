"""Voies d'eau (game/waterways.py) : fleuves, canaux et côtes de toute la France (géographie 3) ; le Sud-Ouest des
anciennes parties (géographies 1 et 2) inchangé."""
import hashlib
import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game import waterways as WW
from game.engine import Game
from game.geo import GeoMap, T_OCEAN, T_EAU

GEO = GeoMap()


def empreinte(g):
    """Ce que les voies d'eau ajoutent à une carte : arêtes, voies, quais, places en aval."""
    blob = dict(edges=[e for e in g.edges if e.get('kind') == 'water'],
                ways=[[w['name'], w['label'], w['sea'], [[round(x, 2), round(y, 2)] for x, y in w['pts']]] for w in g.ways.values()],
                ports=g.ports, down={str(k): v for k, v in g.down_nodes.items()}, quai=[n.get('quai') for n in g.nodes])
    return hashlib.sha1(json.dumps(blob, sort_keys=True).encode()).hexdigest()


def composantes(g, annee=9999):
    """Composantes du réseau des voies d'eau ouvertes cette année-là (find : place -> représentant)."""
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            x = parent[x]
        return x
    for e in g.edges:
        if e.get('kind') == 'water' and e.get('year', 0) <= annee:
            parent[find(e['a'])] = find(e['b'])
    return find


class AnciennesCartes(unittest.TestCase):
    def test_sud_ouest_inchange(self):
        # (calculé avant la France entière : une ancienne partie garde ses gabares au même endroit)
        self.assertEqual(empreinte(GeoMap(1)), '644a5e89690752afd5926d15b8b1929d0cdab26c')
        self.assertEqual(empreinte(GeoMap(2)), 'ff3824a9c7d2b1250a14eb9d809f65b5b703ac7d')


class France(unittest.TestCase):
    def test_grands_ports_et_quais(self):
        noms = ['Brest', 'Lorient', 'Nantes', 'Saint-Nazaire', 'La Rochelle', 'Rochefort', 'Le Havre', 'Rouen', 'Saint-Malo',
                'Calais', 'Boulogne-sur-Mer', 'Marseille', 'Toulon', 'Sète', 'Bastia', 'Ajaccio', 'Bordeaux', 'Bayonne',
                'Paris', 'Lyon', 'Orléans', 'Tours', 'Strasbourg', 'Metz', 'Amiens', 'Toulouse', 'Avignon']
        for nm in noms:
            self.assertIn(GEO.by_name[nm], GEO.ports, f'{nm} sans quai')
        for s in WW.FR_SEAS:
            for nm in s['ports']:
                self.assertIn(s['name'], GEO.ports.get(GEO.by_name[nm], []), f"{nm} hors de la route {s['name']}")

    def test_voies_d_eau_connexes(self):
        # tout se tient par l'eau (le Rhin et la Moselle par les canaux du XIXe siècle) ; la Corse par la traversée
        find = composantes(GEO)
        ref = find(GEO.by_name['Paris'])
        for nid in GEO.ports:
            self.assertEqual(find(nid), ref, f"{GEO.nodes[nid]['name']} isolé")
        # en 1700 : la Méditerranée par le canal du Midi, la Corse ; le Rhin pas encore
        find = composantes(GEO, 1700)
        paris = find(GEO.by_name['Paris'])
        for nm in ('Marseille', 'Bastia', 'Bordeaux', 'Brest', 'Lyon', 'Bayonne'):
            self.assertEqual(find(GEO.by_name[nm]), paris, nm)
        self.assertNotEqual(find(GEO.by_name['Strasbourg']), paris)

    def test_les_cotes_restent_en_mer(self):
        eau = (T_OCEAN, T_EAU)
        for s in WW.FR_SEAS:
            pts = GEO.ways[s['name']]['pts']
            n = ok = 0
            for p, q in zip(pts, pts[1:]):
                m = max(1, int(math.dist(p, q) * 4))
                for k in range(m):
                    n += 1
                    ok += GEO.terrain_at(p[0] + (q[0] - p[0]) * k / m, p[1] + (q[1] - p[1]) * k / m) in eau
            self.assertGreater(ok / n, 0.995, s['name'])
        # les rivières suivent leur tracé de geo.json jusqu'à leur confluent ou la mer
        riv = {r['name']: r for r in GEO.src['rivers']}
        for w in WW.FR_WAYS:
            fin = GEO.xy(*riv[w['river']]['pts'][-1][::-1])
            self.assertTrue(any(math.dist(fin, p) < 0.05 for p in GEO.ways[w['name']]['pts']), w['name'])

    def test_un_canal_ne_sert_qu_apres_son_ouverture(self):
        centre = [e for e in GEO.edges if e.get('way') == 'Canal du Centre']
        self.assertTrue(centre and all(e['year'] == 1793 for e in centre))
        a, b = GEO.by_name['Paray-le-Monial'], GEO.by_name['Chalon-sur-Saône']
        for sc, par_eau in (('1790', False), ('1813', True)):
            g = Game(GEO, '71', 'normal', 1, sc)
            r = g.road_route('71', {a: 0.0}, b, boat=True)
            self.assertEqual(any(GEO.edges[e].get('way') == 'Canal du Centre' for e in r[2]), par_eau, sc)


if __name__ == '__main__':
    unittest.main()
