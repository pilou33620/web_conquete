"""Banc des régiments étrangers (SPEC-MERCENAIRES.md, décisions 1 à 4) : python3 tests/test_mercenaires.py

POURQUOI CE BANC EXISTE. Les mercenaires ne se lèvent qu'à leur époque, au chef-lieu ou dans un port, trois au plus,
contre des livres seulement ; sans solde ils filent vite ; les IA en louent en guerre quand les recrues manquent.
"""
import datetime
import unittest

from fabrique import armee, partie
from game import diplomacy as D
from game import rules as R
from game import views as V
from game.tactics import skirmish as S


def au(g, annee):
    """Avance le calendrier de la partie au 1er juin de cette année."""
    g.start_ord = datetime.date(annee, 6, 1).toordinal() - int(g.t)


def port(g, code):
    return next(n['id'] for n in g.owned_nodes(code) if 'port' in g.geo.nodes[n['id']]['spec']
                and n['id'] != g.capital_of(code))


class Epoques(unittest.TestCase):

    def test_chacun_a_son_epoque(self):
        g = partie(epoque='1700')
        cap = g.capital_of(g.player)
        attendu = {1700: {'suisses', 'irlandais', 'royal_allemand'}, 1791: {'suisses', 'irlandais', 'royal_allemand'},
                   1792: {'suisses'}, 1800: set(), 1815: {'suisses'}, 1830: {'suisses'}, 1831: {'legion'},
                   1870: {'legion'}}
        for annee, ok in attendu.items():
            au(g, annee)
            got = {t for t in R.MERCS if g.can_recruit(g.player, cap, t)[0]}
            self.assertEqual(got, ok, annee)
        self.assertEqual([t for t in S.units_for('1813') if t in R.MERCS], [])   # (le mode Bataille aussi)
        self.assertIn('legion', S.units_for('1870'))


class Levee(unittest.TestCase):

    def test_livres_seulement_veterans_rapides(self):
        g = partie(epoque='1700')
        for t in R.MERCS:
            u = R.UNITS[t]
            self.assertEqual(set(u['cost']), {'livres'}, t)
            self.assertEqual(u['cost']['livres'], 2 * R.UNITS['ligne']['cost']['livres'])
            self.assertEqual(u['upkeep_l'], 2 * R.UNITS['ligne']['upkeep_l'])
            self.assertGreater(u['xp0'], R.UNITS['ligne'].get('xp0', 0))
        self.assertLess(R.UNITS['suisses']['days'], R.UNITS['ligne']['days'])
        self.assertEqual(R.UNITS['royal_allemand']['cls'], 'cavalerie')
        r = g.factions[g.player]['res']
        r['recrues'] = r['armes'] = 0
        r['livres'] = 10000
        ok, why = g.recruit(g.player, g.capital_of(g.player), 'suisses')
        self.assertTrue(ok, why)
        self.assertEqual(r['livres'], 10000 - g.unit_cost(g.player, 'suisses')['livres'])
        self.assertEqual(g.new_reg('suisses', code=g.player)['xp'], 30)

    def test_chef_lieu_ou_port(self):
        g = partie(epoque='1700')
        code = g.player
        autre = next(n['id'] for n in g.owned_nodes(code) if n['id'] != g.capital_of(code)
                     and 'port' not in g.geo.nodes[n['id']]['spec'] and g.geo.nodes[n['id']]['type'] == 'ville')
        self.assertTrue(g.can_recruit(code, g.capital_of(code), 'suisses')[0])
        self.assertTrue(g.can_recruit(code, port(g, code), 'suisses')[0])
        self.assertFalse(g.can_recruit(code, autre, 'suisses')[0])
        ru = {d['id']: d.get('ru') for d in V.player_state(g)['nodes']}   # la liste de recrutement des places
        self.assertIn('royal_allemand', ru[g.capital_of(code)])
        self.assertNotIn('suisses', ru[autre])

    def test_plafond(self):
        g = partie(epoque='1700')
        code, cap = g.player, g.capital_of(g.player)
        g.factions[code]['res']['livres'] = 10000
        g.nodes[cap]['queue'] = []
        armee(g)['regs'].append(g.new_reg('irlandais', code=code))      # en campagne
        self.assertTrue(g.recruit(code, cap, 'royal_allemand')[0])       # en file
        self.assertEqual(g.merc_count(code), R.MERC_MAX)
        ok, why = g.can_recruit(code, port(g, code), 'suisses')
        self.assertFalse(ok)
        self.assertIn(str(R.MERC_MAX), why)
        g.nodes[cap]['garrison'].append(g.new_reg('suisses', code=code))  # (en garnison, il compte aussi)
        self.assertEqual(g.merc_count(code), R.MERC_MAX + 1)


class Solde(unittest.TestCase):

    def test_desertent_trois_fois_plus_vite(self):
        g = partie(epoque='1700')
        a = armee(g)
        a['regs'] = [g.new_reg('ligne', code=g.player), g.new_reg('suisses', code=g.player)]
        for r in a['regs']:
            r['morale'] = 80.0   # (même moral : seule la solde compte)
        a['state'] = 'idle'
        g.factions[g.player]['banqueroute'] = True
        g.factions[g.player]['res']['livres'] = -1000
        n0 = [r['n'] for r in a['regs']]
        g.attrition(1.0)
        lig, sui = (n0[i] - a['regs'][i]['n'] for i in (0, 1))
        self.assertGreater(lig, 0)
        self.assertAlmostEqual(sui, 3 * lig, delta=0.5)   # (l'usure du terrain, la même pour tous, en plus)
        g.factions[g.player]['banqueroute'] = False
        a['state'] = 'move'   # (pas de renforts au repos)
        for r in a['regs']:
            r['morale'] = 30.0   # (des départs dus au moral seul : pareils pour tous)
        n0 = [r['n'] for r in a['regs']]
        g.attrition(1.0)
        self.assertAlmostEqual(1 - a['regs'][0]['n'] / n0[0], 1 - a['regs'][1]['n'] / n0[1], msg='payés, pas plus de départs')


class IA(unittest.TestCase):

    def test_loue_en_guerre_sans_recrues(self):
        g = partie(epoque='1700')
        code, autre = '24', '40'
        ai = g.ais[code]
        f = g.factions[code]
        f['res']['recrues'] = 0
        f['res']['livres'] = 6 * ai.reserve() - 1
        for n in g.owned_nodes(code):
            n['queue'] = []
        ai.recruit()
        self.assertEqual(g.merc_count(code), 0, 'en paix, pas de mercenaires')
        D.declare_war(g, code, autre, quiet=True)
        ai.recruit()
        self.assertEqual(g.merc_count(code), 0, 'trésor trop maigre')
        f['res']['livres'] = 7 * ai.reserve()
        ai.recruit()
        self.assertEqual(g.merc_count(code), 1)
        f['res']['recrues'] = 1000
        ai.recruit()
        self.assertEqual(g.merc_count(code), 1, 'des recrues : la troupe ordinaire')


if __name__ == '__main__':
    unittest.main(verbosity=0)
