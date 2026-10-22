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

    def test_attaquer_s_arrete_a_portee_de_tir(self):
        from game.tactics import units as U
        tb, u = bataille()
        L = u['ligne']
        cible = ennemi(tb, L)
        e = U.ranges(L)[0]
        face_a_face(tb, L, cible, e * 2.5)
        for x in tb.units:   # (les ennemis restent sur place : on ne mesure que l'approche)
            if x.side == cible.side:
                x.ctrl = 'joueur'
        self.assertTrue(ordre(tb, L, 'attack', target=cible.id)[0])
        avancer(tb, 900, jusqua=lambda: not L.path and tb.dist(L, cible) < e)
        self.assertLess(tb.dist(L, cible), e)            # à bonne portée, il fait feu…
        self.assertGreater(tb.dist(L, cible), e * 0.8)   # … sans aller se coller à l'ennemi

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


class BoueEnregistree(unittest.TestCase):
    """La boue laissée par les troupes (SPEC-SUITE F8) : le navigateur l'envoie, la sauvegarde la garde."""
    PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='

    def test_la_boue_suit_la_sauvegarde(self):
        tb, u = bataille()
        self.assertTrue(BT.valid_piet(self.PNG))
        self.assertFalse(BT.valid_piet('data:text/html;base64,AAAA'))
        self.assertFalse(BT.valid_piet('data:image/png;base64,' + 'A' * BT.PIET_MAX))
        tb.piet = self.PNG
        tb2 = type(tb).from_dict(GEO, json.loads(json.dumps(tb.to_dict())))
        self.assertEqual(tb2.piet, self.PNG)
        self.assertEqual(tb2.map_view()['piet'], self.PNG)
        old = tb.to_dict()
        old.pop('piet')
        self.assertIsNone(type(tb).from_dict(GEO, json.loads(json.dumps(old))).piet, 'ancienne sauvegarde : un sol neuf')
        self.assertNotIn('piet', type(tb).from_dict(GEO, json.loads(json.dumps(old))).map_view())


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

    def test_une_charge_defait_le_retranchement(self):
        tb, mes = bataille()
        u, foe = mes['ligne'], ennemi(tb, mes['ligne'], 'inf')
        face_a_face(tb, u, foe, 150)
        u.still_t = -999.0
        ok, why = ordre(tb, u, 'charge', target=foe.id)
        self.assertTrue(ok, why)
        avancer(tb, 5)
        self.assertGreater(u.still_t, tb.clock - 10, 'qui charge ne reste pas enterré')

    def test_la_melinite_ne_sert_pas_aux_mitrailleuses(self):
        tb, mes = bataille(mes={'mitrailleuses': 1}, epoque='1870')
        m, foe = mes['mitrailleuses'], ennemi(tb, mes['mitrailleuses'])
        tb.spec['shell'] = [0.5, 0.5]
        tb.spec['entrench'] = [0.25, 0.25]
        foe.still_t, foe.cls = tb.clock - 400, 'inf'
        self.assertEqual(tb._fire_cover(foe, m), tb._cover_vs(foe, m))
        self.assertAlmostEqual(tb._entrench_k(foe, m), 0.75)

    def test_marques_et_effets_dans_la_spec(self):
        from unittest import mock
        with mock.patch.dict(R.TECH_YEAR, aerostiers=1700, genie=1700):
            tb, _ = bataille(epoque='1790')
        self.assertEqual(tb.spec['balloon'], [1500, 1500])
        self.assertEqual(tb.spec['entrench'], [0.0, 0.0])


class MitrailleusesEnBataille(unittest.TestCase):
    """SPEC-TECH.md : six pièces de Reffye, 1 200 et 2 000 m, feu roulant ; redoutables contre l'infanterie à découvert,
    faibles contre les pièces et les remparts."""

    def pertes(self, typ, cible_cls, distance=1000, secondes=240):
        import math
        tb, mes = bataille(mes={typ: 1}, epoque='1870', seed=2)
        u = mes[typ]
        cible = ennemi(tb, u)
        if cible_cls == 'artillerie':   # (la cible fabriquée : une batterie de huit pièces, ou une ligne de 300 hommes)
            cible.type, cible.cls, cible.form, cible.men = 'artillerie', 'artillerie', 'batterie', 120.0
        else:
            cible.type, cible.cls, cible.form, cible.men = 'ligne', 'inf', 'ligne', 300.0
        cible.men0 = cible.men
        tb.ai_sides = []
        for x in tb.units:
            if x is not u:
                x.fire_mode = 'hold'
                x.ctrl = 'joueur'
        for da in (0.0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2):
            a = u.dir + da
            cible.x, cible.y, cible.dir = u.x + math.cos(a) * distance, u.y + math.sin(a) * distance, a + math.pi
            tb._update_vision()
            if cible.id in tb.seen_by[u.side] and tb.los_units(u, cible):
                break
        else:
            raise AssertionError('pas de vue dégagée à cette distance')
        avant, munitions = cible.men, u.ammo
        avancer(tb, secondes)
        return avant - cible.men, munitions - u.ammo, u

    def test_six_pieces_et_leurs_portees(self):
        tb, mes = bataille(mes={'mitrailleuses': 1}, epoque='1870')
        u = mes['mitrailleuses']
        self.assertEqual(u.cls, 'artillerie')
        self.assertEqual(BT.U.pieces(u), 6)
        self.assertEqual(BT.U.ranges(u), (1200, 2000, None))

    def test_contre_une_ligne_plus_que_les_canons(self):
        m, mun_m, _ = self.pertes('mitrailleuses', 'inf')
        c, mun_c, _ = self.pertes('artillerie', 'inf')
        self.assertGreater(m, c, 'contre une ligne en plaine, à 1 000 m')
        self.assertGreater(mun_m, mun_c, 'les munitions fondent plus vite')

    def test_contre_une_batterie_moins_que_les_canons(self):
        m, _, _ = self.pertes('mitrailleuses', 'artillerie')
        c, _, _ = self.pertes('artillerie', 'artillerie')
        self.assertLess(m, c)



class ValeursChiffrees(unittest.TestCase):
    """Les valeurs chiffrées de la fiche du régiment (game/tactics/stats.py), à la manière d'Empire: Total War : les
    chiffres disent la vérité. Deux fois plus en Précision ou en Mêlée, deux fois plus de pertes infligées, sur le
    moteur lui-même (_fire, _melee_k), le tir ramené au bout portant par la courbe de distance propre à chaque arme."""

    def setUp(self):
        from game.tactics import stats as ST
        from game.tactics import units as U
        self.ST, self.U = ST, U
        self.tb, u = bataille()
        self.l = u['ligne']
        self.c = ennemi(self.tb, self.l, 'inf')
        face_a_face(self.tb, self.l, self.c, 80)

    def tir(self, xp, typ='ligne', arm=1):
        l, c = self.l, self.c
        l.xp, l.type, l.arm = xp, typ, arm
        l.fat, l.reload, l.state, l.ammo, l.morale, l.form = 0.0, 0.0, 'repos', 60.0, 80.0, 'ligne'
        l.target, l.order, l.fire_mode = c.id, dict(kind='attack', target=c.id), 'free'
        c.men, c.state, c.morale = 500.0, 'repos', 80.0
        self.tb._fire(l, 2.0)
        # la Précision affichée vaut au bout portant : on y ramène le tir (la demi-justesse D50 change avec l'arme)
        return (500.0 - c.men) / self.U.precision(l, self.tb.dist(l, c))

    def pre(self, xp, typ='ligne', arm=1):
        v = self.ST.stats(typ, arm, xp)['pre']
        return v[0] + v[1]

    def test_la_precision_dit_vrai(self):
        p0 = self.tir(0)
        self.assertGreater(p0, 0, 'la ligne doit tirer')
        for (xa, ta, aa), (xb, tb_, ab) in [((100, 'ligne', 1), (0, 'ligne', 1)), ((0, 'legere', 1), (0, 'ligne', 1)),
                                            ((0, 'ligne', 4), (0, 'ligne', 1))]:
            with self.subTest(a=(xa, ta, aa), b=(xb, tb_, ab)):
                vrai = self.tir(xa, ta, aa) / self.tir(xb, tb_, ab)
                k = self.ST.xp_k   # (rapport des totaux non arrondis)
                fa = self.ST.K * self.U.TYPE[ta]['fire'] * R.ARMS['inf'][aa][2] ** 0.5 * k(xa)
                fb = self.ST.K * self.U.TYPE[tb_]['fire'] * R.ARMS['inf'][ab][2] ** 0.5 * k(xb)
                self.assertAlmostEqual(vrai, fa / fb, delta=0.02 * fa / fb)
                self.assertAlmostEqual(self.pre(xa, ta, aa) / self.pre(xb, tb_, ab), fa / fb, delta=0.04 * fa / fb)

    def test_la_melee_dit_vrai(self):
        l, c = self.l, self.c
        l.fat, l.morale, l.form = 0.0, 80.0, 'ligne'
        l.type, l.xp = 'ligne', 0
        k0 = self.tb._melee_k(l, c)
        l.type, l.xp = 'grenadiers', 100
        k1 = self.tb._melee_k(l, c)
        m = lambda typ, xp: sum(self.ST.stats(typ, 1, xp)['mel'][:2])
        self.assertAlmostEqual(k1 / k0, 2.25, places=3)
        self.assertAlmostEqual(m('grenadiers', 100) / m('ligne', 0), 2.25, delta=0.05)

    def test_le_rechargement_est_celui_du_moteur(self):
        for typ in self.U.TYPE:
            cls = self.U.cls_of(typ)
            for arm in range(8):
                s = self.ST.stats(typ, arm, 50)
                if 'rec' not in s:
                    continue
                with self.subTest(typ=typ, arm=arm):
                    u = self.U.Unit(type=typ, cls=cls, arm=arm, xp=50)
                    self.assertEqual(sum(s['rec']), round(self.U.reload_time(u)))

    def test_toutes_les_armes(self):
        for typ in self.U.TYPE:
            cls = self.U.cls_of(typ)
            for arm in range(8):
                with self.subTest(typ=typ, arm=arm):
                    s = self.ST.stats(typ, arm, 0)
                    for k in ('mel', 'vit', 'dis'):
                        self.assertIn(k, s)
                    tire = typ not in ('general', 'chariot')
                    for k in ('pre', 'rec', 'por', 'mun'):
                        self.assertEqual(k in s, tire, k)
                    self.assertEqual('chg' in s, cls in ('inf', 'cavalerie'))
                    self.assertEqual('car' in s, cls == 'inf')
                    for k, v in s.items():
                        if k not in ('por', 'mun'):
                            self.assertEqual(v[1], 0, k)   # une recrue : aucun bonus d'expérience
                    v = self.ST.stats(typ, arm, 100, 'audacieux')
                    self.assertEqual(v['dis'][1], 0)
                    if 'chg' in v:
                        self.assertEqual(v['chg'][1], 0)
                    if typ != 'chariot':   # (le chariot : 8 % de 10, l'arrondi l'efface)
                        self.assertGreater(v['mel'][2], 0)
        from unittest import mock
        with mock.patch.object(self.tb, 'trait', return_value='audacieux'):
            self.assertGreater(self.ST.of_unit(self.l, self.tb)['mel'][2], 0)
        with mock.patch.object(self.tb, 'trait', return_value=None):   # le général blessé : plus rien
            self.assertTrue(all(v[2] == 0 for k, v in self.ST.of_unit(self.l, self.tb).items() if k not in ('por', 'mun')))

    def test_la_vue_de_bataille(self):
        from game.tactics import bridge as TB
        from fabrique import S
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1790', units=dict(ligne=1, cavalerie=1), seed=1))
        tb = g.tactical[bid]
        tb.start()
        v = TB.battle_view(g, bid)
        mes = [d for d in v['units'] if d['side'] == tb.me]
        autres = [d for d in v['units'] if d['side'] != tb.me]
        self.assertTrue(mes and all('stats' in d and 'mel' in d['stats'] for d in mes))
        self.assertTrue(all('stats' not in d for d in autres))
        json.dumps(v)   # (le serveur l'envoie tel quel)


class JustesseDuFeu(unittest.TestCase):
    """Le feu est d'autant plus juste qu'on est près : à 90 % de la portée efficace, bien moins qu'à 30 m."""

    def test_plus_juste_de_pres_pour_chaque_arme(self):
        U = BT.U
        for arm, (e, mx) in enumerate(U.INF_RANGE):
            u = U.Unit(type='ligne', cls='inf', arm=arm)
            with self.subTest(arme=R.ARMS['inf'][arm][1]):
                p = [U.precision(u, d) for d in (0, 30, 0.9 * e, e, 1.3 * e, mx)]
                self.assertEqual(p[0], 1.0)
                self.assertEqual(p, sorted(p, reverse=True))   # toujours moins juste en s'éloignant
                self.assertGreater(p[1], 2 * p[2])             # deux fois plus juste à 30 m qu'à 90 % de la portée efficace


if __name__ == '__main__':
    unittest.main()
