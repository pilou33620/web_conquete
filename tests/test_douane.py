"""Banc de la douane (SPEC-MERCENAIRES.md, décisions 5 à 9) : python3 tests/test_douane.py

POURQUOI CE BANC EXISTE. Le tarif aux frontières touche les recettes, le commerce des partenaires, les relations des
voisins et la contrebande : des effets croisés entre camps qu'une partie ne montre qu'au bout de plusieurs mois.
"""
import datetime
import json
import unittest

from fabrique import partie
from game import rules as R
from game import views as V
from game.ai import AI
import server


def recette(g, code):
    g.compute_income()
    return g.factions[code]['_douane']['recette']


class Recettes(unittest.TestCase):

    def test_le_tarif_rapporte_davantage_a_chaque_niveau(self):
        g = partie()
        p = g.player
        r = []
        for t in range(len(R.TARIFS)):
            g.factions[p]['tarif'] = t
            r.append(recette(g, p))
        self.assertEqual(r[0], 0)
        self.assertEqual(r, sorted(r))
        self.assertGreater(r[-1], r[1])

    def test_moins_de_voisins_moins_de_recettes(self):
        g = partie()
        p = g.player
        g.factions[p]['tarif'] = 2
        nb = g.frontieres()[0][p]
        self.assertGreaterEqual(len(nb), 2)
        r0 = recette(g, p)
        o = sorted(nb)[0]
        for n in g.nodes:
            if n['owner'] == o:
                n['owner'] = R.NEUTRAL   # un voisin de moins (ses terres passent aux insurgés)
        self.assertNotIn(o, g.frontieres()[0][p])
        self.assertLess(recette(g, p), r0)


class Contrebande(unittest.TestCase):

    def test_la_part_suit_le_tarif_et_les_douaniers_la_divisent_par_deux(self):
        g = partie()
        f = g.factions[g.player]
        for t, (_, taux) in enumerate(R.TARIFS):
            f['tarif'] = t
            f['douaniers'] = False
            self.assertAlmostEqual(g.contrebande(g.player), min(0.9, 1.5 * taux))
            f['douaniers'] = True
            self.assertAlmostEqual(g.contrebande(g.player), min(0.9, 1.5 * taux) / 2)

    def test_les_douaniers_coutent_par_place_frontaliere(self):
        g = partie()
        p, f = g.player, g.factions[g.player]
        g.compute_income()
        sans = f['income']['livres']
        self.assertEqual(f['_upkeep']['douaniers'], 0)
        self.assertTrue(g.set_douaniers(p, True)[0])
        g.compute_income()
        cout = len(g.frontieres()[1][p]) * R.DOUANIERS_L
        self.assertGreater(cout, 0)
        self.assertAlmostEqual(f['_upkeep']['douaniers'], cout)
        self.assertAlmostEqual(f['income']['livres'], sans - cout, places=6)

    def test_les_contrebandiers_viennent_plus_souvent(self):
        from game import events as EV
        g = partie()
        e = EV.RANDOM_BY_ID['contrebande']
        w0 = e['w'](g, g.player)
        g.factions[g.player]['tarif'] = 3
        self.assertTrue(e['cond'](g, g.player))
        self.assertGreater(e['w'](g, g.player), 2 * w0)


class Prix(unittest.TestCase):

    def test_les_partenaires_gagnent_moins(self):
        g = partie()
        p = g.player
        o = sorted(g.frontieres()[0][p])[0]
        g.factions[p]['trade'][o] = g.factions[o]['trade'][p] = True
        g.compute_income()
        g.compute_income()   # (les revenus bruts de chacun sont connus au second passage)
        avant = g.factions[o]['_trade']['livres']
        g.factions[p]['tarif'] = 3
        g.compute_income()
        apres = g.factions[o]['_trade']['livres']
        self.assertAlmostEqual(apres, avant * (1 - 1.5 * R.TARIFS[3][1]), places=6)

    def test_les_voisins_l_aiment_moins_chaque_mois(self):
        g = partie()
        p = g.player
        nb = g.frontieres()[0][p]
        loin = [o for o in g.factions if o != p and o not in nb]
        g.factions[p]['tarif'] = 2
        avant = {o: g.factions[o]['rel'][p] for o in g.factions if o != p}
        g.monthly(datetime.date(1790, 3, 1))
        for o in nb:
            self.assertAlmostEqual(g.factions[o]['rel'][p], avant[o] - 2 * R.DOUANE_REL)
        for o in loin:
            self.assertEqual(g.factions[o]['rel'][p], avant[o])


class IA(unittest.TestCase):

    def test_marchand_bas_pauvre_en_guerre_haut(self):
        g = partie(joueur='64')
        g.compute_income()
        for code in ('33', '24'):   # Gironde marchande (0,9), Dordogne non (0,5)
            ai, f = AI(g, code), g.factions[code]
            ai.douane()
            self.assertEqual(f['tarif'], 0, 'en paix et à l’aise : libre')
            g.set_status(code, '40', 'guerre')
            ai.douane()
            self.assertEqual(f['tarif'], 1, 'en guerre : modéré')
            f['income']['livres'] = -5.0
            ai.douane()
            self.assertEqual(f['tarif'], 1 if code == '33' else 2, 'en guerre et en déficit : un marchand reste à « modéré », les autres « élevé »')
            g.set_status(code, '40', 'paix')
            ai.douane()
            self.assertEqual(f['tarif'], 1, 'en déficit seulement : modéré')


class Commandes(unittest.TestCase):

    def test_validation(self):
        app = server.App.__new__(server.App)   # (sans préparer la carte ni charger de sauvegarde)
        app.game, app.skirmish = partie(), None
        f = app.game.factions[app.game.player]
        for bad in (-1, 4, 1.5, '2', True, None, [1]):
            self.assertFalse(app.command(dict(cmd='tarif', value=bad))['ok'], bad)
        self.assertEqual(f['tarif'], 0)
        self.assertTrue(app.command(dict(cmd='tarif', value=3))['ok'])
        self.assertEqual(f['tarif'], 3)
        for bad in (1, 'oui', None):
            self.assertFalse(app.command(dict(cmd='douaniers', value=bad))['ok'], bad)
        self.assertTrue(app.command(dict(cmd='douaniers', value=True))['ok'])
        self.assertTrue(f['douaniers'])
        d = json.loads(json.dumps(V.player_state(app.game)))['me']['douane']
        self.assertEqual((d['tarif'], d['on'], len(d['niveaux'])), (3, True, 4))

    def test_ancienne_sauvegarde(self):
        g = partie()
        for f in g.factions.values():
            del f['tarif'], f['douaniers']
        V.migrate(g)
        self.assertTrue(all(f['tarif'] == 0 and f['douaniers'] is False for f in g.factions.values()))
        g.compute_income()


if __name__ == '__main__':
    unittest.main()
