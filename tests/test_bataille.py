"""Banc d'essai des batailles tactiques (game/tactics).

    python3 tests/test_bataille.py

POURQUOI CE BANC EXISTE. Une bataille dure plusieurs minutes à l'écran, et un ordre qui ne fait rien ou une unité
coincée ne se voit qu'en la jouant. Ici chaque situation se fabrique en une ligne (fabrique.bataille, face_a_face) et
se vérifie en quelques secondes. Bugs déjà rattrapés, à ne pas revoir :
- « Salve puis baïonnette » restait planté si l'on avait ordonné « cessez le feu » entre-temps ;
- un canon sans munitions restait « au feu » ;
- un régiment « anéanti » (moins de 8 hommes) revenait sur la carte de campagne.
"""
import json
import unittest

from fabrique import BT, GEO, avancer, bataille, ennemi, face_a_face, kind, ordre
from game import rules as R


class OrdresParArme(unittest.TestCase):
    """Chaque arme a ses ordres (web/js/battle/doctrine.js) ; le moteur refuse ceux qui ne sont pas les siens."""

    def test_ordres_acceptes_et_refuses(self):
        tb, u = bataille()
        cible = ennemi(tb, u['ligne'])
        face_a_face(tb, u['ligne'], cible, 300)
        attendu = [
            ('ligne', 'fire', dict(mode='volley'), True),
            ('ligne', 'volley_charge', dict(target=cible.id), True),
            ('ligne', 'charge', dict(target=cible.id), True),
            ('legere', 'harass', {}, True),
            ('legere', 'cover', {}, True),
            ('cavalerie', 'charge', dict(target=cible.id), True),
            ('cavalerie', 'volley_charge', dict(target=cible.id), False),   # la cavalerie ne tire pas
            ('cavalerie', 'harass', {}, False),
            ('cavalerie', 'pursue', {}, False),                             # personne ne fuit encore
            ('artillerie', 'shot', dict(mode='mitraille'), True),
            ('artillerie', 'counter', dict(mode='on'), True),
            ('ligne', 'shot', dict(mode='boulet'), False),                  # réservé aux canons
        ]
        for typ, k, p, ok in attendu:
            with self.subTest(arme=typ, ordre=k):
                res = ordre(tb, u[typ], k, **p)
                self.assertEqual(bool(res[0]), ok, res[1])

    def test_ordres_refuses_pendant_le_deploiement(self):
        tb, u = bataille(demarree=False)
        self.assertFalse(ordre(tb, u['ligne'], 'harass')[0])
        self.assertTrue(ordre(tb, u['artillerie'], 'shot', mode='boulet')[0])   # mais le projectile se règle avant

    def test_salve_puis_baionnette_finit_en_charge(self):
        tb, u = bataille(dict(ligne=1))
        L = u['ligne']
        cible = ennemi(tb, L)
        face_a_face(tb, L, cible, 80)   # déjà à portée de salve : on ne teste que « tirer puis charger »
        self.assertTrue(ordre(tb, L, 'volley_charge', target=cible.id)[0])
        ordre(tb, L, 'fire', mode='hold')   # « cessez le feu » donné ensuite : la salve part quand même
        avancer(tb, 120, jusqua=lambda: kind(L) != 'volley_charge')
        self.assertEqual(kind(L), 'charge')

    def test_harceler_passe_en_tirailleurs(self):
        tb, u = bataille(dict(legere=1))
        self.assertTrue(ordre(tb, u['legere'], 'harass')[0])
        avancer(tb, 60)
        self.assertEqual(u['legere'].form, 'tirailleurs')

    def test_artillerie_sans_munitions_au_repos(self):
        tb, u = bataille(dict(artillerie=1))
        A = u['artillerie']
        A.state, A.ammo = 'feu', 0
        avancer(tb, 10)
        self.assertNotIn(A.state, ('feu', 'recharge'))

    def test_regiment_aneanti_ne_revient_pas(self):
        tb, u = bataille(dict(ligne=1))
        L = u['ligne']
        tb._damage(L, L.men - 6, None, 'feu')   # 6 hommes : « anéanti »
        self.assertEqual(L.state, 'hors')
        self.assertEqual(L.men, 0)


class NomsDesRegiments(unittest.TestCase):
    def test_la_cavalerie_a_ses_dragons_de_1760_a_1860(self):
        # (étape 8 : les dragons portent l'habit vert ; il en faut dans les vraies batailles, pas seulement la maquette)
        tb, _ = bataille(dict(cavalerie=3), epoque='1790')
        noms = sorted(x.name for x in tb.units if x.owner == '33' and x.type == 'cavalerie')
        self.assertEqual(noms, ['1er dragons', '2e ch. à cheval', '3e hussards'])
        for ep in ('1700', '1870'):
            tb, _ = bataille(dict(cavalerie=1), epoque=ep)
            self.assertTrue(all('Cavalerie' in x.name for x in tb.units if x.owner == '33' and x.type == 'cavalerie'), ep)


class BatailleEntiere(unittest.TestCase):
    def test_jusqu_au_bout_puis_rechargement(self):
        tb, u = bataille(dict(ligne=2, cavalerie=1, artillerie=1))
        tb.autofinish()
        tb.run_to_end()
        self.assertEqual(tb.phase, 'fin')
        for x in tb.units:
            self.assertFalse(x.state == 'hors' and 0 < x.men < 8 and x.lost > x.men0 / 2, (x.name, x.men))
        tb2 = type(tb).from_dict(GEO, json.loads(json.dumps(tb.to_dict())))
        self.assertEqual(tb2.phase, 'fin')

    def test_rechargement_en_plein_combat(self):
        tb, u = bataille()
        cible = ennemi(tb, u['ligne'])
        face_a_face(tb, u['ligne'], cible, 300)
        ordre(tb, u['ligne'], 'volley_charge', target=cible.id)
        tb2 = type(tb).from_dict(GEO, json.loads(json.dumps(tb.to_dict())))
        avancer(tb2, 20)   # la bataille reprend sans erreur
        self.assertIn(tb2.phase, ('combat', 'fin'))
        self.assertEqual(BT.DT, 2.0)


class MarquesVisibles(unittest.TestCase):
    """SPEC-TECH.md, module visuels : la bataille reçoit les marques de chaque camp et l'arme de chaque régiment."""

    def test_marques_d_un_camp(self):
        self.assertIn('sans_fumee', R.marks(['lebel', 'gras']))
        self.assertNotIn('sans_fumee', R.marks(['gras']))
        self.assertEqual(R.marks([]), [])

    def test_la_spec_porte_les_marques_des_deux_camps(self):
        tb, _ = bataille(epoque='1870')
        self.assertEqual(len(tb.spec['marks']), 2)
        self.assertIn('reffye', tb.spec['marks'][0], 'en 1870, la mitrailleuse est connue (techs_before 1866)')
        self.assertNotIn('sans_fumee', tb.spec['marks'][0], 'pas encore de poudre B en 1870')
        self.assertEqual(tb.map_view()['marks'], tb.spec['marks'], 'le client les lit avec la carte')

    def test_la_vue_porte_l_arme_de_chaque_unite(self):
        tb, mes = bataille(epoque='1870')
        vue = {u['id']: u for u in tb.view(me=0)['units']}
        self.assertEqual(vue[mes['ligne'].id]['arm'], mes['ligne'].arm)
        self.assertGreater(mes['ligne'].arm, 0, 'en 1870, la ligne a mieux que le mousquet')


class DynamiteALAssaut(unittest.TestCase):
    """SPEC-TECH.md : à l'assaut, la dynamite de l'assaillant ouvre une brèche de plus dans les remparts."""

    def breches(self, annee_dynamite):
        from unittest import mock
        from game.tactics import skirmish as S
        with mock.patch.dict(R.TECH_YEAR, dynamite=annee_dynamite):   # (en 1870, dynamite connue ou non)
            g, bid = S.new(GEO, dict(me='33', foe='24', era='1870', kind='forteresse', role='att', seed=3,
                                     units=dict(ligne=2, artillerie=1)))
        self.assertIsNotNone(g, bid)
        return [b for w in g.tactical[bid].map_view()['walls'] for b in w['breach']]

    def test_une_place_intacte_a_une_breche_avec_la_dynamite(self):
        self.assertEqual(self.breches(1867), [], 'place intacte, pas de dynamite : pas de brèche')
        self.assertEqual(len(self.breches(1860)), 1)


class TechnologiesEnBataille(unittest.TestCase):
    """SPEC-TECH.md : ballon des aérostiers, retranchements, obus à la mélinite."""

    def test_le_ballon_voit_a_1500_metres_du_general(self):
        tb, mes = bataille()
        gen = next(u for u in tb.units if u.side == mes['ligne'].side and u.cls == 'general')
        foe = ennemi(tb, mes['ligne'], 'inf')
        tb.weather = 'brouillard'
        foe.x, foe.y = gen.x + 1200, gen.y
        for u in tb.units:
            if u.side == gen.side and u is not gen:
                u.x, u.y = gen.x - 3000, gen.y   # (personne d'autre pour voir)
        tb._update_vision()
        self.assertNotIn(foe.id, tb.seen_by[gen.side], 'dans le brouillard, à 1 200 m, on ne le voit pas')
        tb.spec['balloon'] = [1500, 1500]
        tb._update_vision()
        self.assertIn(foe.id, tb.seen_by[gen.side], 'le ballon, si')
        gen.wounded = True
        tb._update_vision()
        self.assertNotIn(foe.id, tb.seen_by[gen.side], "général blessé : plus d'observateur")

    def test_l_infanterie_arretee_se_retranche(self):
        tb, mes = bataille()
        u, foe = mes['ligne'], ennemi(tb, mes['ligne'], 'inf')
        tb.spec['entrench'] = [0.25, 0.25]
        u.still_t = tb.clock - 400
        self.assertAlmostEqual(tb._entrench_k(u, foe), 0.75)
        u.still_t = tb.clock - 100
        self.assertEqual(tb._entrench_k(u, foe), 1.0, 'arrêtée depuis moins de cinq minutes')
        u.still_t = tb.clock - 400
        tb.spec['entrench'] = [0.0, 0.0]
        self.assertEqual(tb._entrench_k(u, foe), 1.0, 'sans la technologie')

    def test_la_melinite_perce_le_couvert(self):
        tb, mes = bataille()
        art, foe = mes['artillerie'], ennemi(tb, mes['artillerie'], 'inf')
        tb.spec['entrench'] = [0.25, 0.25]
        foe.still_t = tb.clock - 400
        cov = tb._cover_vs(foe, art)
        tb.spec['shell'] = [0.5, 0.5]
        self.assertAlmostEqual(tb._fire_cover(foe, art), cov * 0.5)
        self.assertAlmostEqual(tb._entrench_k(foe, art), 1 - 0.25 * 0.5)
        self.assertAlmostEqual(tb._fire_cover(foe, mes['ligne']), tb._cover_vs(foe, mes['ligne']), msg='pas pour les fusils')

    def test_marques_et_effets_dans_la_spec(self):
        from unittest import mock
        with mock.patch.dict(R.TECH_YEAR, aerostiers=1700, genie=1700):
            tb, _ = bataille(epoque='1790')
        self.assertEqual(tb.spec['balloon'], [1500, 1500])
        self.assertEqual(tb.spec['entrench'], [0.0, 0.0])


if __name__ == '__main__':
    unittest.main()
