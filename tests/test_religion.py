"""Banc de la religion (SPEC-RELIGION.md, décisions 1 à 8) : python3 tests/test_religion.py

POURQUOI CE BANC EXISTE. La politique religieuse agit lentement (ordre public visé, exil mois après mois) : ici, on
règle la politique et l'on appelle le moteur directement.
"""
import json
import unittest

from fabrique import GEO, partie
from game import events as EV
from game import religion as RG
from game import revoltes as RV
from game import views as V


def place(g, nom):
    return next(n for n in g.nodes if g.geo.nodes[n['id']]['name'] == nom)


class Confession(unittest.TestCase):

    def test_parts_du_sud_ouest(self):
        g = partie()
        self.assertEqual(RG.confession(place(g, 'Orthez')['rp']), 'protestante')
        self.assertEqual(RG.confession(place(g, 'Bergerac')['rp']), 'mixte')
        self.assertEqual(place(g, 'Bayonne')['rp'], 0.0)
        self.assertEqual(place(g, 'Mont-de-Marsan')['rp'], 0.0, 'les Landes : aucun réformé')
        self.assertEqual(part := place(g, 'Orthez')['rp'], partie(seed=7).nodes[place(g, 'Orthez')['id']]['rp'])
        self.assertGreater(part, 0)

    def test_politique_de_depart_et_ancienne_sauvegarde(self):
        for ep, k in (('1700', 'contrainte'), ('1790', 'tolerance'), ('1813', 'concordat')):
            self.assertEqual(partie(epoque=ep).factions['33']['culte'], k)
        g = partie(epoque='1700')
        d = json.loads(json.dumps(V.to_dict(g)))
        for f in d['factions'].values():
            del f['culte']
        for n in d['nodes']:
            n.pop('rp', None)
        del d['bandes']
        g2 = V.from_dict(GEO, d)
        self.assertEqual(g2.factions['64']['culte'], 'contrainte')
        self.assertEqual(place(g2, 'Orthez')['rp'], place(g, 'Orthez')['rp'])
        self.assertEqual(g2.bandes, [])


class Politique(unittest.TestCase):

    def test_ordre_public_selon_la_politique(self):
        g = partie(epoque='1700')
        o, b = place(g, 'Orthez'), place(g, 'Bayonne')
        self.assertLess(RG.stab_bonus(g, o), -0.05, 'des réformés contraints grondent')
        self.assertGreater(RG.stab_bonus(g, b), 0, 'le clergé approuve')
        RG.set_culte(g, '64', 'tolerance', force=True)
        self.assertAlmostEqual(RG.stab_bonus(g, b), RG.TOLERANCE_CATH, msg='avant 1787, la tolérance fâche le clergé')
        self.assertGreater(RG.stab_bonus(g, o), RG.stab_bonus(g, b))

    def test_epoques_et_un_changement_par_an(self):
        g = partie()
        self.assertFalse(RG.set_culte(g, '33', 'dragonnades')[0], 'plus de dragonnades en 1790')
        self.assertFalse(RG.set_culte(g, '33', 'concordat')[0], 'pas de Concordat avant 1801')
        self.assertTrue(RG.set_culte(g, '33', 'laique')[0])
        self.assertFalse(RG.set_culte(g, '33', 'tolerance')[0], 'une politique se garde un an')
        g.t += 366
        self.assertTrue(RG.set_culte(g, '33', 'tolerance')[0])

    def test_clerge_soumis_livres_et_ferveur(self):
        g = partie()
        avant = g.mod('64', 'livres')
        RG.set_culte(g, '64', 'laique')
        self.assertAlmostEqual(g.mod('64', 'livres') - avant, 0.04)
        pau, agen = place(g, 'Pau'), place(g, 'Agen')
        RG.set_culte(g, '47', 'laique')
        self.assertLess(RG.stab_bonus(g, pau), RG.stab_bonus(g, agen), 'le Béarn est plus fervent que l’Agenais')

    def test_dragonnades_exil_et_conversions(self):
        g = partie(epoque='1700')
        RG.set_culte(g, '64', 'dragonnades', force=True)
        RG.set_culte(g, '40', 'tolerance', force=True)
        o = place(g, 'Orthez')
        rp, pop = o['rp'], o['pop']
        for f in g.factions.values():
            f['refu'] = 0.0
        RG.mensuel(g)
        self.assertLess(o['rp'], rp)
        self.assertLess(o['pop'], pop)
        self.assertGreater(sum(f['refu'] for f in g.factions.values()), 0, 'les exilés vont chez un voisin tolérant')

    def test_politique_hors_epoque(self):
        g = partie(epoque='1700')
        g.factions['33']['culte'] = 'dragonnades'
        g.t += (1761 - 1700) * 365.25
        RG.mensuel(g)
        self.assertEqual(g.factions['33']['culte'], 'contrainte')

    def test_ia_ne_prend_pas_les_dragonnades(self):
        g = partie(epoque='1700')
        for code in g.factions:
            g.factions[code].pop('culte_t', None)
            RG.ia_culte(g, code, True)
            self.assertNotEqual(g.factions[code]['culte'], 'dragonnades')


class Evenements(unittest.TestCase):

    def test_evenements_enregistres_et_effet_culte(self):
        ids = {e['id'] for e in EV.HIST}
        self.assertTrue({'camisards', 'constitution_civile', 'concordat', 'vendee', 'communes'} <= ids)
        self.assertEqual(len(ids), len(EV.HIST), 'identifiants uniques')
        g = partie()
        fx = dict(culte='laique')
        self.assertIn('politique religieuse : constitution civile du clergé', EV.describe(g, '33', fx))
        EV.apply(g, '33', fx)
        self.assertEqual(g.factions['33']['culte'], 'laique')

    def test_edit_de_tolerance_seulement_avec_des_reformes(self):
        ev = next(e for e in EV.HIST if e['id'] == 'edit_tolerance')
        g = partie(epoque='1700')
        self.assertTrue(ev['cond'](g, '64'))
        self.assertFalse(ev['cond'](g, '40'))

    def test_assemblee_au_desert(self):
        g = partie(epoque='1700')
        ev = EV.RANDOM_BY_ID['desert']
        self.assertTrue(ev['cond'](g, '64'))
        RG.set_culte(g, '64', 'tolerance', force=True)
        self.assertFalse(ev['cond'](g, '64'))

    def test_vue(self):
        g = partie(epoque='1700')
        v = V.player_state(g)['me']['culte']
        self.assertEqual(v['k'], 'contrainte')
        self.assertIn('dragonnades', [o[0] for o in v['options']])
        self.assertEqual(V.player_state(g)['nodes'][place(g, 'Sainte-Foy-la-Grande')['id']]['rp'], 0.6)
        self.assertIsNotNone(RV)


if __name__ == '__main__':
    unittest.main()
