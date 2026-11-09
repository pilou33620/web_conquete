"""Banc des guerres décisives et des armées actives (SPEC-FRANCE.md, « Guerres décisives et armées actives »).

    python3 tests/test_guerres.py

- un camp réduit au quart du plus de places qu'il a tenues est absorbé dès la chute de son chef-lieu ; sinon il signe
  un traité (trêve de cinq ans dans le Sud-Ouest ; en France, plus courte pour un petit vaincu : test_france.py) ;
- une armée d'IA qui garde une place menacée attaque l'armée qui la menace si elle la bat nettement (toute la France
  seulement : dans le Sud-Ouest, elle garde sa place), ne se jette pas sur une armée plus forte, et n'y laisse que ce
  qu'il faut (le reste part vers une cible).
"""
import math
import unittest

from fabrique import partie
from game import diplomacy as D


def reduire(g, code, garde, pic):
    """Le camp code ne tient plus que son chef-lieu et `garde` autres places de son département (toutes les autres
    places, sauf celles des autres camps, passent à la Gironde) ; il en a tenu `pic` au plus fort."""
    cap = g.capital_of(code)
    autres = [n for n in g.nodes if n['owner'] in (code, 'neutre') and n['id'] != cap]
    autres.sort(key=lambda n: g.geo.nodes[n['id']]['dept'] != code)
    assert len(autres) > garde
    for i, n in enumerate(autres):
        n['owner'] = code if i < garde else '33'
    g.nodes[cap]['owner'] = code
    g._own_ver += 1
    g.factions[code]['pic'] = pic
    return cap


class GuerresDecisives(unittest.TestCase):
    def test_un_camp_reduit_au_quart_de_ce_qu_il_a_tenu_est_absorbe(self):
        g = partie()
        cap = reduire(g, '24', 9, 40)   # 9 places : moins du quart de 40
        D.declare_war(g, '33', '24', quiet=True)
        g.capture(cap, '33')
        self.assertFalse(g.factions['24']['alive'])
        self.assertTrue(all(n['owner'] != '24' for n in g.nodes))

    def test_sinon_un_traite_et_cinq_ans_de_treve_dans_le_sud_ouest(self):
        g = partie()
        cap = reduire(g, '24', 12, 40)   # 12 places : plus du quart de 40
        D.declare_war(g, '33', '24', quiet=True)
        g.capture(cap, '33')
        f = g.factions['24']
        self.assertTrue(f['alive'])
        self.assertEqual(g.nodes[cap]['owner'], '24')
        self.assertGreater(f['truce']['33'] - g.t, 4.5 * 365)   # (toute la France : plus courte, voir test_france.py)


class ArmeesActives(unittest.TestCase):
    def situation(self, mes, siens):
        """Une armée de la Dordogne (IA), `mes` régiments de ligne, au repos dans un de ses villages ; une armée de la
        Gironde, `siens` régiments, arrêtée en rase campagne à la place voisine. Rend (g, ia, armée, place voisine)."""
        g = partie()
        D.declare_war(g, '33', '24', quiet=True)
        g.armies.clear()
        ia = g.ais['24']
        villes = [g.node_xy(v['id']) for v in g.owned_nodes('24')]   # (au départ, le chef-lieu et les villes)
        n, m = next((n, m) for e in g.geo.edges if e.get('kind') != 'water' for n, m in ((e['a'], e['b']), (e['b'], e['a']))
                    if g.geo.nodes[n]['dept'] == '24' and g.geo.nodes[n]['type'] == 'village'
                    and 8 < math.dist(g.node_xy(n), g.node_xy(m)) < 25
                    and all(math.dist(v, g.node_xy(m)) > 30 for v in villes))   # (aucune ville menacée : il garde ce village)
        g.nodes[n]['owner'] = '24'
        g._own_ver += 1
        x, y = g.node_xy(n)
        a = g.create_army('24', x, y, [g.new_reg('ligne', code='24') for _ in range(mes)], node=n)
        mx, my = g.node_xy(m)
        g.create_army('33', mx, my, [g.new_reg('ligne', code='33') for _ in range(siens)])   # en rase campagne
        return g, ia, a, m

    def test_l_armee_plus_forte_attaque_celle_qui_menace_sa_place(self):
        g, ia, a, m = self.situation(6, 2)   # (frapper : toute la France seulement, voir le test suivant)
        self.assertTrue(ia.frapper(a, a['at_node'], ia.foes(), {}))
        self.assertEqual(a['state'], 'move')
        self.assertEqual((a['target'] or {}).get('node'), m)

    def test_dans_le_sud_ouest_elle_garde_sa_place(self):
        g, ia, a, m = self.situation(6, 2)
        ia.army_think(a, {})
        self.assertEqual(a['state'], 'idle')

    def test_pas_contre_une_armee_plus_forte(self):
        g, ia, a, m = self.situation(2, 6)
        self.assertFalse(ia.frapper(a, a['at_node'], ia.foes(), {}))
        ia.army_think(a, {})
        self.assertNotEqual((a['target'] or {}).get('node'), m)

    def test_ne_garder_qu_une_partie_des_forces(self):
        g, ia, a, m = self.situation(8, 1)
        n = a['at_node']
        self.assertTrue(ia.detacher(a, n, ia.threat_at(n, 30), {}))
        reste = [b for b in g.armies.values() if b['owner'] == '24' and b['state'] == 'idle']
        self.assertEqual([b['id'] for b in reste], [a['id']])
        self.assertTrue(0 < len(a['regs']) < 8)
        self.assertTrue(any(b['owner'] == '24' and b['state'] == 'move' for b in g.armies.values()))


if __name__ == '__main__':
    unittest.main()
