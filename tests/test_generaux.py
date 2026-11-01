"""Banc des généraux qui évoluent (SPEC-GENERAUX.md) : python3 tests/test_generaux.py

POURQUOI CE BANC EXISTE. Un général se suit d'une bataille à l'autre (grades jusqu'à maréchal, talents, médailles,
blessures, captivité) : ces règles ne se voient qu'au bout de plusieurs batailles, ici jouées en appelant le moteur.
"""
import json
import unittest

from fabrique import armee, bataille_de_campagne, partie
from game import diplomacy as D
from game import rules as R
from game import views as V


class Grades(unittest.TestCase):

    def test_de_colonel_a_marechal(self):
        g = partie()
        a = armee(g)
        gen = a['gen']
        self.assertEqual((gen['lvl'], gen['talents'], gen['medailles']), (1, [], []))
        g.general_xp(a, 12.0)
        self.assertEqual(gen['lvl'], 4)
        self.assertTrue(g.gen_title(gen).startswith('Lieutenant général'))
        g.general_xp(a, 10.0)
        self.assertEqual(gen['lvl'], 4, 'pas de bâton sans victoires')
        for _ in range(R.MARECHAL_VICTOIRES):
            g.general_xp(a, 0, victoire=True)
        self.assertEqual(gen['lvl'], 5)
        self.assertTrue(g.gen_title(gen).startswith('Maréchal'))
        json.dumps(V.player_state(g))   # (l'état envoyé au client supporte le cinquième grade)

    def test_un_seul_marechal_par_camp(self):
        g = partie()
        a = armee(g)
        b = g.create_army(g.player, a['x'], a['y'], [g.new_reg('ligne', code=g.player)], node=a['at_node'])
        for x in (a, b):
            g.general_xp(x, 30.0)
            for _ in range(R.MARECHAL_VICTOIRES):
                g.general_xp(x, 0, victoire=True)
        self.assertEqual(sorted((a['gen']['lvl'], b['gen']['lvl'])), [4, 5])

    def test_ancienne_sauvegarde(self):
        g = partie()
        a = armee(g)
        a['gen'] = dict(name='Labat', trait='prudent', lvl=2, xp=4.0)
        V.migrate(g)
        self.assertEqual((a['gen']['talents'], a['gen']['etats'], a['gen']['vic']), ([], [], 0))
        self.assertTrue(a['gen']['id'])



class Reserve(unittest.TestCase):

    def test_fusion_reserve_et_nomination(self):
        g = partie()
        a = armee(g)
        b = g.create_army(g.player, a['x'], a['y'], [g.new_reg('ligne', code=g.player)], node=a['at_node'])
        g.general_xp(b, 4.0)   # (général de brigade)
        gb = b['gen']
        ok, _ = g.merge(g.player, a['id'], b['id'])
        self.assertTrue(ok)
        self.assertIs(a['gen'], gb, 'le meilleur prend la tête')
        self.assertEqual(g.factions[g.player].get('generaux', []), [], 'le colonel sans états de service se retire')
        # le général de brigade écarté par une fusion attend en réserve ; une armée nouvelle le prend
        c = g.create_army(g.player, a['x'], a['y'], [g.new_reg('ligne', code=g.player)], node=a['at_node'])
        g.general_xp(c, 8.0)
        ok, _ = g.merge(g.player, c['id'], a['id'])
        self.assertEqual(g.factions[g.player]['generaux'], [gb])
        d = g.create_army(g.player, a['x'], a['y'], [g.new_reg('ligne', code=g.player)], node=a['at_node'])
        self.assertIs(d['gen'], gb)
        # nomination : le général de la réserve à la tête d'une armée dans une place du joueur
        g.reserver(g.player, d['gen'])
        d['gen'] = g.new_general(g.player)
        ok, msg = g.nommer(g.player, d['id'], gb['id'])
        self.assertTrue(ok, msg)
        self.assertIs(d['gen'], gb)
        self.assertFalse(g.nommer(g.player, d['id'], 'g-inconnu')[0])

    def test_le_detachement_des_ia_ne_vole_pas_de_general(self):
        g = partie()
        a = armee(g)
        g.general_xp(a, 4.0)
        gen = a['gen']
        ok, bid = g.split(g.player, a['id'], [a['regs'][0]['id']])
        self.assertTrue(ok)
        self.assertIsNot(g.armies[bid]['gen'], gen)
        self.assertEqual(g.factions[g.player].get('generaux', []), [], 'un détachement prend un colonel neuf')



class Risques(unittest.TestCase):

    def test_blesse_remplace_puis_revient(self):
        g = partie()
        a = armee(g)
        g.general_xp(a, 4.0)
        gen = a['gen']
        g.blesser_general(a, 2)
        self.assertTrue(a['gen'].get('interim'))
        g.t += 59
        g.soigner_generaux()
        self.assertTrue(a['gen'].get('interim'), 'encore en convalescence')
        g.t += 2
        g.soigner_generaux()
        self.assertIs(a['gen'], gen)

    def test_tirage_selon_le_trait(self):
        g = partie()
        a = armee(g)
        compte = {}
        for trait in ('audacieux', 'prudent'):
            a['gen']['trait'] = trait
            compte[trait] = 0
            for j in range(600):   # (le tirage est fixé par le jour : un jour différent à chaque essai)
                g.t = float(j)
                compte[trait] += g.risques_general(a, 'aneantie') is not None
        self.assertGreater(compte['audacieux'], compte['prudent'] * 1.6)

    def test_etat_major_pris_en_bataille_commandee(self):
        """Le sort de l'état-major décide de celui du général (bridge.finish) : pris, il part chez le vainqueur."""
        from game.tactics import bridge as TB
        g, bt = bataille_de_campagne('1813', attaque=True)
        self.assertTrue(TB.command(g, dict(sub='choose', bid=bt['id'], mode='manuel'))['ok'])
        tb = g.tactical[bt['id']]
        em = next(u for u in tb.units if u.cls == 'general' and u.side == 0)
        a = g.armies[em.army]
        gen = a['gen']
        em.captured, em.men = 30.0, 0.0
        tb.finish(1, False, "essai")
        TB.finish(g, tb)
        vainqueur = next(x.owner for x in tb.units if x.side == 1)
        self.assertIn(gen, [c['gen'] for c in g.factions[vainqueur].get('captifs', [])])


class Captifs(unittest.TestCase):

    def test_echange_rachat_et_paix(self):
        g = partie()
        moi, eux = g.player, '24'
        a, b = armee(g), armee(g, eux)
        g.general_xp(a, 4.0)
        g.general_xp(b, 8.0)
        ga, gb = a['gen'], b['gen']
        g.capturer_general(a, eux)
        g.capturer_general(b, moi)
        self.assertEqual([c['gen'] for c in D.captifs(g, eux, moi)], [ga])
        D.exchange_prisoners(g, moi, eux)
        self.assertIn(ga, g.factions[moi]['generaux'])
        self.assertIn(gb, g.factions[eux]['generaux'])
        # un général sans contrepartie se rachète selon son grade
        g.capturer_general(armee(g), eux)
        livres = g.factions[moi]['res']['livres'] = 1000
        D.exchange_prisoners(g, moi, eux)
        self.assertEqual(D.captifs(g, eux, moi), [])
        self.assertEqual(g.factions[moi]['res']['livres'], livres - R.GENERAL_RANCON[0])
        # à la paix, les captifs rentrent chez eux
        g.capturer_general(armee(g), eux)
        D.make_peace(g, moi, eux)
        self.assertEqual(D.captifs(g, eux, moi), [])


    def test_le_marechal_libere_ne_fait_pas_un_second_marechal(self):
        g = partie()
        moi, eux = g.player, '24'
        a = armee(g)
        a['gen']['lvl'] = 5
        g.capturer_general(a, eux)
        a['gen']['lvl'] = 5   # (un autre maréchal pendant sa captivité)
        D.make_peace(g, moi, eux)
        self.assertEqual(sorted(x['lvl'] for x in g.generaux(moi)), [4, 5])


class Talents(unittest.TestCase):

    def test_promotion_du_joueur_et_effet(self):
        g = partie()
        a = armee(g)
        a['gen']['trait'] = 'artilleur'
        g.general_xp(a, 3.0)
        offres = a['gen']['promo']
        self.assertEqual(offres[:2], ['pointeurs', 'attelages'], 'les deux talents du premier étage de son arbre')
        self.assertIsNone(R.GENERAL_TALENTS[offres[2]]['trait'], 'et un commun')
        art = next(r for r in a['regs'] if r['type'] == 'artillerie') if any(r['type'] == 'artillerie' for r in a['regs']) else None
        if art is None:
            art = g.new_reg('artillerie', code=g.player)
            a['regs'].append(art)
        p0 = g.reg_power(g.player, art, 'Plaine', a=a)
        ok, _ = g.choisir_talent(g.player, a['id'], 'pointeurs')
        self.assertTrue(ok)
        self.assertNotIn('promo', a['gen'])
        self.assertGreater(g.reg_power(g.player, art, 'Plaine', a=a), p0 * 1.03)
        self.assertFalse(g.choisir_talent(g.player, a['id'], 'pointeurs')[0], 'plus de choix en attente')
        # le second étage s'ouvre
        g.general_xp(a, 4.0)
        self.assertIn('grande_batterie', a['gen']['promo'])

    def test_les_ia_choisissent_seules(self):
        g = partie()
        b = armee(g, '24')
        g.general_xp(b, 12.0)
        self.assertEqual(len(b['gen']['talents']), 3)
        self.assertNotIn('promo', b['gen'])



class Medailles(unittest.TestCase):

    def test_nom_selon_l_epoque_et_moral(self):
        for epoque, nom in (('1700', 'Ordre de Saint-Louis'), ('1813', 'Légion d’honneur')):
            g = partie(epoque=epoque)
            a = armee(g)
            r = a['regs'][0]
            r['morale'] = 60.0
            p0 = g.reg_power(g.player, r, 'Plaine', a=a)
            g.decorer(a, 'victoire à un contre deux')
            self.assertEqual(a['gen']['medailles'][0][:2], [nom, 'victoire à un contre deux'])
            self.assertEqual(a['gen']['xp'], 1.0)
            self.assertGreater(g.reg_power(g.player, r, 'Plaine', a=a), p0)
            for _ in range(5):
                g.decorer(a, 'x')
            self.assertEqual(g.moral_medailles(a), 3 * R.MEDAILLE_MORAL, 'trois médailles comptent au plus')


if __name__ == '__main__':
    unittest.main()
