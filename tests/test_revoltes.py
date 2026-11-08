"""Banc des révoltes, brigands et partisans (SPEC-RELIGION.md, décisions 9 à 23) : python3 tests/test_revoltes.py

POURQUOI CE BANC EXISTE. Une insurrection demande un ordre public effondré, des partisans une guerre et une
occupation : des années de jeu pour y arriver. Ici, on pose la situation (ordre public, bande, guerre) et l'on appelle
les règles du mois ou du jour directement.
"""
import json
import unittest

from fabrique import GEO, armee, partie
from game import diplomacy as D
from game import events as EV
from game import revoltes as RV
from game import views as V


def place(g, nom):
    return next(n for n in g.nodes if g.geo.nodes[n['id']]['name'] == nom)


def bande(g, k, nom, n, c, **kw):
    return RV.naitre(g, k, place(g, nom)['id'], n, c, **kw)


class Insurrection(unittest.TestCase):

    def test_ordre_public_effondre(self):
        g = partie()
        n = place(g, 'Bergerac')
        for _ in range(60):
            n['stab'] = 0.05
            RV._naissances(g)
            if any(b['k'] == 'rebelles' for b in g.bandes):
                break
        b = next(b for b in g.bandes if b['k'] == 'rebelles')
        self.assertEqual((b['k'], b['node'], b['c']), ('rebelles', n['id'], '24'))
        self.assertGreaterEqual(b['n'], 80)

    def test_jamais_un_chef_lieu(self):
        g = partie()
        cap = place(g, 'Périgueux')
        for _ in range(60):
            cap['stab'] = 0.0
            RV._naissances(g)
        self.assertFalse(any(b['node'] == cap['id'] for b in g.bandes if b['k'] == 'rebelles'))
        b = RV.naitre(g, 'rebelles', cap['id'], 5000, '24')
        RV._rebelles(g, b)
        self.assertEqual(cap['owner'], '24', 'une bande ne prend jamais un chef-lieu')

    def test_prise_d_une_place_et_marche(self):
        g = partie()
        n = place(g, 'Ribérac')
        n['garrison'] = []
        for x in RV.voisins(g, n['id']):
            g.nodes[x]['owner'] = '24'
        b = RV.naitre(g, 'rebelles', n['id'], 3000, '24')
        RV._rebelles(g, b)
        self.assertEqual(n['owner'], 'neutre')
        self.assertNotEqual(b['node'], n['id'], 'la bande marche vers la place voisine')

    def test_bande_faible_repoussee_et_dispersion(self):
        g = partie()
        b = bande(g, 'rebelles', 'Bergerac', 70, '24')
        place(g, 'Bergerac')['stab'] = 0.9
        RV.mensuel(g)
        self.assertNotIn(b, g.bandes)

    def test_armee_ecrase_la_bande(self):
        g = partie()
        a = armee(g, '24')
        b = RV.naitre(g, 'rebelles', a['at_node'], 200, '24')
        self.assertIsNotNone(b)
        RV.quotidien(g)
        self.assertNotIn(b, g.bandes)

    def test_armee_trop_faible_recule(self):
        g = partie()
        a = armee(g, '24')
        hommes = g.army_men(a)
        b = RV.naitre(g, 'rebelles', a['at_node'], 20000, '24')
        RV.quotidien(g)
        self.assertIn(b, g.bandes)
        self.assertLess(g.army_men(a), hommes)
        self.assertLess(b['n'], 20000)

    def test_apaiser(self):
        g = partie()
        n = place(g, 'Bergerac')
        n['stab'] = 0.2
        b = bande(g, 'rebelles', 'Bergerac', 500, '24', why='religion')
        g.factions['24']['res']['livres'] = 1000
        self.assertFalse(RV.apaiser(g, '33', b['id'])[0], 'seul le camp visé apaise')
        ok, _ = RV.apaiser(g, '24', b['id'])
        self.assertTrue(ok)
        self.assertNotIn(b, g.bandes)
        self.assertEqual(g.factions['24']['res']['livres'], 1000 - 400)
        self.assertGreater(n['stab'], 0.2)
        self.assertGreater(n['rgb'][0], 0, 'concession aux réformés')


class Brigands(unittest.TestCase):

    def test_pillage_et_amnistie(self):
        g = partie()
        f = g.factions['40']
        f['res']['livres'] = 500
        b = bande(g, 'brigands', 'Morcenx', 150, '40')
        RV._pille(g, b)
        self.assertEqual(f['res']['livres'], 500 - 45)
        self.assertTrue(any(e.get('src') == 'brigands' for e in place(g, 'Morcenx')['tm']))
        rec = f['res']['recrues']
        self.assertTrue(RV.apaiser(g, '40', b['id'])[0])
        self.assertGreater(f['res']['recrues'], rec)

    def test_naissance_et_plafond(self):
        g = partie()
        for c in g.factions.values():
            c['famine'] = True
        for _ in range(400):
            RV._naissances(g)
        for code in g.factions:
            self.assertLessEqual(RV.compte(g, 'brigands', code), 1)
        self.assertTrue(any(b['k'] == 'brigands' for b in g.bandes))
        self.assertTrue(all(g.geo.nodes[b['node']]['type'] != 'capitale' for b in g.bandes if b['k'] == 'brigands'))


class Partisans(unittest.TestCase):

    def guerre_et_occupation(self):
        g = partie()
        D.declare_war(g, '24', '47')
        n = place(g, 'Marmande')
        g.capture(n['id'], '24')
        return g, n

    def test_naissance_dans_une_place_occupee(self):
        g, n = self.guerre_et_occupation()
        for _ in range(300):
            RV._naissances(g)
            if any(b['k'] == 'partisans' for b in g.bandes):
                break
        b = next(b for b in g.bandes if b['k'] == 'partisans')
        self.assertEqual((b['c'], b['sp']), ('24', '47'))

    def test_harcelement_et_paix(self):
        g, n = self.guerre_et_occupation()
        b = RV.naitre(g, 'partisans', n['id'], 200, '24', 'occupation', sp='47')
        a = armee(g, '24')
        a['x'], a['y'] = g.geo.nodes[n['id']]['x'] + 5, g.geo.nodes[n['id']]['y']
        a['supply'] = 1.0
        RV._harcele(g, b)
        self.assertLess(a['supply'], 1.0)
        D.make_peace(g, '24', '47') if hasattr(D, 'make_peace') else g.set_status('24', '47', 'paix')
        RV.mensuel(g)
        self.assertNotIn(b, g.bandes, 'la paix disperse les partisans')

    def test_lever_et_soutenir(self):
        g, n = self.guerre_et_occupation()
        f = g.factions['47']
        f['res'].update(livres=1000, armes=500)
        self.assertTrue(RV.lever(g, '47', n['id'])[0])
        b = RV.par_place(g)[n['id']]
        self.assertEqual((b['k'], b['c'], b['sp'], b['n']), ('partisans', '24', '47', RV.LEVER_N))
        self.assertFalse(RV.lever(g, '47', place(g, 'Agen')['id'])[0], 'pas chez soi')
        r = bande(g, 'rebelles', 'Bergerac', 300, '24')
        self.assertFalse(RV.soutenir(g, '33', r['id'])[0], 'pas sans guerre')
        self.assertTrue(RV.soutenir(g, '47', r['id'])[0])
        self.assertEqual((r['n'], r['sp']), (420, '47'))

    def test_soulever_la_population(self):
        g, n = self.guerre_et_occupation()
        self.assertFalse(g.spy('33', place(g, 'Bergerac')['id'], 'soulever')[0], 'en guerre seulement')
        cible = place(g, 'Bergerac')
        cible['stab'] = 0.4
        RV.fomenter(g, '47', cible['id'])
        b = RV.par_place(g)[cible['id']]
        self.assertEqual((b['k'], b['c'], b['sp']), ('rebelles', '24', '47'))


class Evenements(unittest.TestCase):

    def test_bande_d_un_evenement(self):
        g = partie()
        fx = dict(bande=dict(k='rebelles', n=900, why='religion', nom="l'Armée catholique et royale"))
        self.assertIn('une bande de 900 insurgés se lève', EV.describe(g, '64', fx))
        EV.apply(g, '64', fx)
        b = g.bandes[0]
        self.assertEqual((b['c'], b['nom']), ('64', "l'Armée catholique et royale"))
        self.assertEqual(g.geo.nodes[b['node']]['dept'], '64')


class IA(unittest.TestCase):

    def test_chasse_puis_laisse_faire(self):
        g = partie()
        ai = g.ais['24']
        a = armee(g, '24')
        voisine = next(x for x in RV.voisins(g, a['at_node']) if g.nodes[x]['owner'] == '24')
        b = RV.naitre(g, 'brigands', voisine, 80, '24')
        RV.ia(ai)
        self.assertEqual(a.get('chasse'), b['id'])
        self.assertTrue(RV.chasse(g, a))
        RV.fin(g, b)
        self.assertFalse(RV.chasse(g, a))

    def test_apaise_faute_d_armee(self):
        g = partie()
        ai = g.ais['24']
        for a in [a for a in g.armies.values() if a['owner'] == '24']:
            del g.armies[a['id']]
        g.factions['24']['res']['livres'] = 50000
        b = bande(g, 'rebelles', 'Bergerac', 300, '24')
        RV.ia(ai)
        self.assertNotIn(b, g.bandes)


class Vues(unittest.TestCase):

    def test_carte_menace_et_sauvegarde(self):
        g = partie()
        b = bande(g, 'rebelles', 'Bergerac', 300, '33')   # (une bande qui vise le joueur, chez un autre)
        n = place(g, 'Libourne')
        n['stab'] = 0.2
        st = json.loads(json.dumps(V.player_state(g)))
        self.assertEqual(st['nodes'][b['node']]['bd']['n'], 300)
        self.assertEqual(st['nodes'][n['id']]['mr'][0], 'imminente')
        self.assertIn('soulever', V.rules_payload()['spy'])
        g2 = V.from_dict(GEO, json.loads(json.dumps(V.to_dict(g))))
        self.assertEqual(g2.bandes[0]['nom'], b['nom'])


if __name__ == '__main__':
    unittest.main()
