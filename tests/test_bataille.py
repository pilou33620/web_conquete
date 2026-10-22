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


class DefenseVivante(unittest.TestCase):
    """Le défenseur en rase campagne (l'IA, camp 1, au niveau normal) : contre-attaques locales sur l'assaillant qui
    flotte, cavalerie sur les troupes désorganisées, écran de tirailleurs, retour offensif, arrière-garde."""

    def defense(self, era='1813', seed=1):
        import math
        from fabrique import S
        from game.tactics import ai
        g, bid = S.new(GEO, dict(me='33', foe='24', era=era, units=dict(ligne=2, legere=1, cavalerie=1), seed=seed,
                                 role='att'))
        tb = g.tactical[bid]
        tb.start()
        mem = tb.ai_mem['s1']
        mem['plan'], mem['mode'] = 'tenir', 'poste'
        mes = [u for u in tb.units if u.side == 0 and u.alive]
        z = tb.ai_zone(0)
        for k, u in enumerate(mes):   # (le joueur au fond de sa zone, loin de tout)
            u.x, u.y = (z[0] + z[2]) / 2 + 40 * k, (z[1] + z[3]) / 2
        tb._update_vision()

        def pense():
            mem['next'] = mem['rnext'] = 0.0
            ai.think(tb, 1, 2.0)

        def a_moi(cls, light=False):
            return next(u for u in mes if u.cls == cls and bool(u.light) == light)

        def a_lui(role):
            return next(u for u in tb.units if u.side == 1 and mem['role'].get(u.id) == role and u.valid)
        return tb, mem, pense, a_moi, a_lui, math

    def test_contre_attaque_sur_un_bataillon_ebranle(self):
        tb, mem, pense, a_moi, a_lui, _ = self.defense()
        u, e = a_lui('ligne'), a_moi('inf')
        u.morale, e.men = 80.0, u.men
        face_a_face(tb, u, e, 140)
        e.morale = 85.0
        pense()
        self.assertNotEqual(u.state, 'charge')   # une ligne fraîche, munitions pleines : on la fusille
        e.morale = 38.0
        pense()
        self.assertEqual((u.state, u.target), ('charge', e.id))
        self.assertTrue(any('contre-attaque' in n[1] for n in mem['journal']))
        e.state = 'deroute'
        pense()
        p = mem['post'][u.id]
        self.assertEqual(u.order.get('kind'), 'move')   # pas de poursuite : il reprend sa place
        self.assertLess(abs(u.goal[0] - p[0]) + abs(u.goal[1] - p[1]), 1.0)

    def test_1870_contre_attaque_courte(self):
        tb, mem, pense, a_moi, a_lui, _ = self.defense('1870')
        u, e = a_lui('ligne'), a_moi('inf')
        u.morale, e.men = 80.0, u.men
        face_a_face(tb, u, e, 150)
        e.morale = 45.0
        pense()
        self.assertNotEqual(u.state, 'charge')   # trop loin pour sortir de son couvert sous le fusil rayé
        u.busy = 0.0   # (il a fini de se déployer en tirailleurs)
        face_a_face(tb, u, e, 90)
        e.morale, e.men = 35.0, round(0.45 * e.men0)   # ébranlé et décimé, à bout portant
        pense()
        self.assertEqual((u.state, u.target), ('charge', e.id))

    def test_cavalerie_sur_troupe_en_marche(self):
        for era, form, charge in (('1813', 'ligne', True), ('1813', 'carre', False), ('1870', 'ligne', False)):
            with self.subTest(epoque=era, formation=form):
                tb, mem, pense, a_moi, a_lui, math = self.defense(era)
                c, e = a_lui('cav'), a_moi('inf')
                face_a_face(tb, c, e, 300)
                e.state, e.form, e.morale = 'marche', form, 80.0
                e.dir = math.atan2(c.y - e.y, c.x - e.x) + math.pi / 2   # elle prête le flanc
                pense()
                self.assertEqual(c.state == 'charge' and c.target == e.id, charge)

    def test_cavalerie_sur_colonne_qui_charge(self):
        tb, mem, pense, a_moi, a_lui, math = self.defense()
        c, u, e = a_lui('cav'), a_lui('ligne'), a_moi('inf')
        face_a_face(tb, u, e, 160)
        if math.hypot(c.x - e.x, c.y - e.y) > 450:
            c.x, c.y = e.x + (c.x - e.x) * 400 / math.hypot(c.x - e.x, c.y - e.y), \
                e.y + (c.y - e.y) * 400 / math.hypot(c.x - e.x, c.y - e.y)
            tb._update_vision()
        tb.order(0, [e.id], 'charge', target=u.id, who='any')
        pense()
        self.assertEqual((c.state, c.target), ('charge', e.id))

    def test_ecran_de_tirailleurs(self):
        tb, mem, pense, a_moi, a_lui, math = self.defense(seed=4)   # (une graine où l'IA a des légers)
        from game.tactics import ai
        lt, e = a_lui('avant'), a_moi('inf')
        p = mem['post'][lt.id]
        self.assertGreaterEqual(ai._rel(p[0], p[1], mem['ax'], mem['ay'], mem['fd'])[0], 1.4 * tb.ranges(lt)[0])
        lt.x, lt.y = p[0], p[1]
        e.form = 'ligne'
        face_a_face(tb, lt, e, 150)
        pense()
        self.assertEqual(mem['scr'][lt.id][0], 1)   # il recule d'un palier
        z = tb.ai_zone(0)
        e.x, e.y = (z[0] + z[2]) / 2, (z[1] + z[3]) / 2
        tb._update_vision()
        mem['phase'] = 'combat'
        tb.clock += 160
        pense()
        self.assertEqual(mem['scr'][lt.id][0], 0)   # l'assaut a reflué : il revient

    def test_retour_offensif_et_arret(self):
        tb, mem, pense, a_moi, a_lui, _ = self.defense()
        mes = [u for u in tb.units if u.side == 0 and u.alive and u.cls in ('inf', 'cavalerie')]
        u = a_lui('ligne')
        for k, e in enumerate(mes):   # (en vue, à 400 m : l'assaut est venu, puis il a reflué)
            face_a_face(tb, u, e, 400 + 30 * k)
            e.morale, e.men = 50.0, round(0.6 * e.men0)
        mes[0].state = 'deroute'
        mem.update(phase='combat', pressed=1, near_t=tb.clock - 400, t_contact=0)
        pense()
        self.assertEqual(mem['plan'], 'frontal')
        self.assertIn('ro', mem)
        for v in tb.units:
            if v.side == 1 and v.cls in ('inf', 'cavalerie', 'artillerie'):
                v.men = round(v.men * 0.9)
        pense()
        self.assertEqual((mem['plan'], mem['mode']), ('tenir', 'poste'))
        self.assertNotIn('ro', mem)

    def test_arriere_garde(self):
        tb, mem, pense, a_moi, a_lui, _ = self.defense()
        tb.withdraw(1)
        pense()
        rg = list(mem.get('rg') or [])
        self.assertTrue(1 <= len(rg) <= 3)
        self.assertTrue(all(tb.unit(i).order.get('kind') != 'retreat' for i in rg))
        tb.clock += 620
        pense()
        self.assertTrue(all(tb.unit(i).order.get('kind') == 'retreat' for i in rg))

    def test_memoire_json(self):
        from fabrique import S
        for era in ('1700', '1790', '1813', '1870'):
            with self.subTest(epoque=era):
                g, bid = S.new(GEO, dict(me='33', foe='24', era=era, units=dict(ligne=2, legere=1, cavalerie=1),
                                         seed=1, role='att'))
                tb = g.tactical[bid]
                tb.autofinish()
                tb.run_to_end()
                json.dumps(tb.ai_mem)



class IAAttaqueRaseCampagne(unittest.TestCase):
    """L'assaillant en rase campagne (l'IA, camp 0, troupes tirées au sort) : ordre selon l'époque, ligne hors du feu du Chassepot, point de
    rupture et grande batterie, masse jetée sur le point, poursuite par la cavalerie, bonds par moitiés en 1870."""

    def attaque(self, era='1813', units=None, lvl='normal'):
        import math
        from fabrique import S
        from game.tactics import ai
        g, bid = S.new(GEO, dict(me='33', foe='24', era=era, seed=1, role='def',
                                 units=units or dict(ligne=3, legere=1, cavalerie=2, artillerie=2)))
        tb = g.tactical[bid]
        tb.spec['ai_levels'] = [lvl, 'normal']
        ai.deploy(tb, 0)
        tb.start()
        mem = tb.ai_mem['s0']
        lui = [u for u in tb.units if u.side == 1 and u.alive]
        z = tb.ai_zone(1)
        for k, u in enumerate(lui):   # (le défenseur au fond de sa zone, loin de tout)
            u.x, u.y = (z[0] + z[2]) / 2 + 40 * k, (z[1] + z[3]) / 2
        tb._update_vision()

        def pense(n=1):
            for _ in range(n):
                mem['next'] = mem['rnext'] = 0.0
                ai.think(tb, 0, 2.0)

        def a_moi(role):
            return next(u for u in tb.units if u.side == 0 and mem['role'].get(u.id) == role and u.valid)

        def a_lui(cls, light=False):
            return next(u for u in lui if u.cls == cls and bool(u.light) == light)
        return tb, mem, pense, a_moi, a_lui, ai, math

    def test_pas_d_ordre_disperse_avant_le_fusil_raye(self):
        for era, forme in (('1790', 'ligne'), ('1870', 'tirailleurs')):
            with self.subTest(epoque=era):
                tb, mem, pense, a_moi, a_lui, ai, _ = self.attaque(era)
                u = a_moi('ligne')
                mem['vu'] = {}
                self.assertEqual(ai._march_form(tb, mem, ai.LEVELS['normal'], u, u.x, u.y, 300.0), forme)
                self.assertEqual(ai._march_form(tb, mem, ai.LEVELS['normal'], u, u.x, u.y, 250.0, True),
                                 'ligne' if era == '1790' else 'tirailleurs')   # (la défense garde ses règles)

    def test_la_ligne_attend_hors_du_chassepot(self):
        tb, mem, pense, a_moi, a_lui, ai, _ = self.attaque('1870')
        e = a_lui('inf')
        u = a_moi('ligne')
        face_a_face(tb, u, e, 900)
        pense(6)
        e_fo = tb.ranges(e)[0]
        self.assertEqual(mem['e_fo'], e_fo)
        d = ai._rel(e.x, e.y, mem['ax'], mem['ay'], mem['fd'])[0]
        self.assertGreater(d, 1.3 * e_fo)   # (la ligne attend la préparation hors de portée du fusil ennemi)
        self.assertIn(mem['phase'], ('marche', 'prepa'))

    def test_point_de_rupture_et_grande_batterie(self):
        tb, mem, pense, a_moi, a_lui, ai, math = self.attaque('1813')
        e = a_lui('inf')
        face_a_face(tb, a_moi('ligne'), e, 600)
        mem['phase'], mem['t_phase'] = 'prepa', tb.clock
        pense()
        self.assertTrue(mem.get('pt') and mem.get('pt_id'))
        self.assertEqual(tb.unit(mem['pt_id']).cls, 'inf')
        self.assertTrue(any('point de rupture' in n[1] for n in mem['journal']))
        # le feu des batteries s'y concentre (poids pt_k sur les cibles à moins de 260 m du point)
        g = next(o for o in tb.units if o.side == 1 and o.cls == 'artillerie')
        e, e2 = [o for o in tb.units if o.side == 0 and o.cls == 'inf'][:2]   # (le canon du camp 1 sur deux cibles)
        for k, v in enumerate((e, e2)):
            face_a_face(tb, g, v, 300)
            v.x, v.y = v.x + (k - 0.5) * 600 * math.sin(g.dir), v.y - (k - 0.5) * 600 * math.cos(g.dir)
        if not (tb.los_units(g, e) and tb.los_units(g, e2)):
            self.skipTest('pas de vue sur les deux cibles avec cette graine')
        for v in (e, e2):
            mem['pt'] = [v.x, v.y]
            self.assertIs(ai._art_target(tb, g, [e, e2], [], mem, 9e9, 9e9, 0, 50.0), v)

    def test_la_masse_se_jette_sur_le_point(self):
        tb, mem, pense, a_moi, a_lui, ai, _ = self.attaque('1813', dict(ligne=4, grenadiers=1, cavalerie=1,
                                                                         artillerie=1))
        res = [u for u in tb.units if u.side == 0 and mem['role'].get(u.id) == 'res']
        self.assertTrue(res)
        e = a_lui('inf')
        face_a_face(tb, a_moi('ligne'), e, 300)
        e.morale = 60.0
        mem.update(phase='combat', t_phase=tb.clock - 400, pt=[e.x, e.y], pt_id=e.id, t_contact=0)
        pense()
        masse = [u for u in tb.units if u.side == 0 and mem['role'].get(u.id) == 'masse']
        self.assertTrue(masse)
        self.assertTrue(any('assaut de la masse' in n[1] for n in mem['journal']))
        if len(res) >= 3:
            self.assertTrue(any(mem['role'].get(u.id) == 'res' for u in res))   # (un bataillon gardé pour les trous)
        json.dumps(tb.ai_mem)

    def test_la_cavalerie_poursuit(self):
        tb, mem, pense, a_moi, a_lui, ai, _ = self.attaque('1813')
        c = a_moi('cav')
        e = a_lui('inf')
        face_a_face(tb, c, e, 450)
        e.state, e.morale = 'deroute', 10.0
        c.morale, c.fat = 90.0, 0.0
        pense()
        self.assertIn(c.id, mem.get('pours', {}))
        self.assertEqual(c.state, 'charge')
        cavs = [u for u in tb.units if u.side == 0 and u.cls == 'cavalerie' and u.state == 'charge']
        self.assertLessEqual(len(cavs), max(1, sum(1 for u in tb.units if u.side == 0 and u.cls == 'cavalerie') // 2))

    def test_bonds_par_moities_en_1870(self):
        tb, mem, pense, a_moi, a_lui, ai, math = self.attaque('1870', lvl='difficile')
        L = ai.LEVELS['difficile']
        x0, y0 = mem['ax'], mem['ay']
        ai._advance(tb, mem, L, [], 500.0, L['bound_feu'])
        self.assertAlmostEqual(math.hypot(mem['ax'] - x0, mem['ay'] - y0), L['bound_feu'], delta=2)
        h = mem['half']
        tb.clock += 200
        ai._advance(tb, mem, L, [], 500.0, L['bound_feu'])
        self.assertEqual(mem['half'], -h)   # (l'autre moitié bondit à son tour)


class IAPlaces(unittest.TestCase):
    """Attaque et défense des places (IA contre IA, troupes tirées au sort) : batterie de brèche, regroupement qui
    dure, place investie puis abandonnée, coupure et contre-attaque dans la brèche, sorties, combats de rue."""

    def place(self, role='att', lvl='normal'):
        import math
        from fabrique import S
        from game.tactics import ai
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1790', kind='forteresse', role=role, seed=1,
                                 units=dict(ligne=4, legere=1, cavalerie=1, artillerie=2)))
        self.assertIsNotNone(g, bid)
        tb = g.tactical[bid]
        tb.spec['ai_levels'] = [lvl, lvl]
        tb.autofinish()   # (IA des deux côtés ; le combat commence)

        def pense(side, n=1):
            for _ in range(n):
                m = tb.ai_mem[f's{side}']
                m['next'] = m['rnext'] = 0.0
                ai.think(tb, side, 2.0)
        return tb, pense, ai, math

    def test_ordre_bombard(self):
        tb, pense, ai, math = self.place()
        art = next(u for u in tb.units if u.side == 0 and u.cls == 'artillerie' and u.type != 'mitrailleuses')
        inf = next(u for u in tb.units if u.side == 0 and u.cls == 'inf')
        art.ctrl = inf.ctrl = 'joueur'   # (l'IA ne les commande plus ; en accéléré, l'ordre passe par who='any')
        pl = tb.place_info()
        self.assertFalse(tb.order(0, [inf.id], 'bombard', who='any', x=pl['x'], y=pl['y'])[0])
        # la batterie à bonne portée du rempart : elle bat ce pan, et lui seul
        w = next(w for w in tb.map.walls if w.get('kind') != 'barricade')
        ax, ay = min(w['pts'], key=lambda q: math.hypot(q[0] - art.x, q[1] - art.y))
        a = math.atan2(ay - pl['y'], ax - pl['x'])
        e = tb.ranges(art)[0]
        art.x, art.y = ax + math.cos(a) * 0.7 * e, ay + math.sin(a) * 0.7 * e
        art.dir, art.form, art.path, art.goal, art.reload = a + math.pi, 'batterie', [], None, 0.0
        self.assertTrue(tb.order(0, [art.id], 'bombard', who='any', x=ax, y=ay)[0])
        before = {k: v for k, v in tb.pound.items()}
        avancer(tb, 300)
        self.assertEqual(kind(art), 'bombard')
        k = str(int((math.atan2(ay - pl['y'], ax - pl['x']) % (2 * math.pi)) / (2 * math.pi) * BT.BREACH_SECT))
        self.assertNotEqual(tb.pound.get(k, 0.0), before.get(k, 0.0))   # (son pan, à terre ou entamé)
        self.assertGreater(art.fired_t, 0)
        tc, _ = bataille()
        self.assertFalse(ordre(tc, next(u for u in tc.units if u.cls == 'artillerie' and u.ctrl == 'joueur'),
                               'bombard', x=100, y=100)[0])

    def test_batterie_de_breche_et_garde(self):
        tb, pense, ai, math = self.place()
        mem = tb.ai_mem['s0']
        self.assertTrue(mem['batter'])
        self.assertTrue(any(r == 'garde' for r in mem['role'].values()))
        for uid in mem['batter']:
            tb.unit(uid).x, tb.unit(uid).y = mem['post'][uid][:2]
            tb.unit(uid).form = 'batterie'
        pense(0)
        self.assertTrue(all(kind(tb.unit(uid)) == 'bombard' for uid in mem['batter']))
        self.assertTrue(any('batterie de brèche' in n[1] for n in mem['journal']))

    def test_regroupement_dure_puis_place_investie_puis_retraite(self):
        tb, pense, ai, math = self.place()
        mem = tb.ai_mem['s0']
        mem.update(phase='assaut', t_phase=tb.clock - 400, t_breach=10, waves=0, n_assault=10 ** 6)
        pense(0)
        self.assertEqual(mem['phase'], 'regroupe')
        mem['t_phase'] -= 300
        pense(0)
        self.assertEqual(mem['phase'], 'regroupe')   # (une vieille brèche ne relance plus l'assaut au bout de 2 min)
        mem.update(phase='assaut', t_phase=tb.clock - 400, waves=1, n_assault=10 ** 6)
        pense(0)
        self.assertEqual(mem['phase'], 'investi')
        mem.update(t_phase=tb.clock - 1900, bonus=1, extra=1)
        pense(0)
        self.assertTrue(tb.withdrawing[0])
        self.assertTrue(any("se retire dans les lignes" in n[1] for n in mem['journal']))
        json.dumps(tb.ai_mem)

    def test_coupure_et_contre_attaque_dans_la_breche(self):
        tb, pense, ai, math = self.place('def')
        mem = tb.ai_mem['s1']
        n0 = sum(1 for r in mem['role'].values() if r == 'coupure')
        pl = tb.place_info()
        a = mem['fd']
        q = [round(pl['x'] + math.cos(a) * (mem['r_in'] - 30)), round(pl['y'] + math.sin(a) * (mem['r_in'] - 30)),
             round(a, 3)]
        mem['breach'].append(q)
        pense(1)
        self.assertEqual(sum(1 for r in mem['role'].values() if r == 'coupure'), n0 + 1)
        # un assaillant ébranlé dans la brèche : on le rejette à la baïonnette
        e = next(u for u in tb.units if u.side == 0 and u.cls == 'inf' and u.valid)
        e.x, e.y, e.morale, e.path, e.goal = q[0], q[1], 45.0, [], None
        for u in tb.units:
            if u.side == 1 and mem['role'].get(u.id) in ('coupure', 'breche', 'res'):
                u.x, u.y = q[0] - math.cos(a) * 90, q[1] - math.sin(a) * 90
                u.morale, u.state = 90.0, 'repos'
        tb._update_vision()
        pense(1)
        self.assertTrue(any('dans la brèche' in n[1] for n in mem['journal']))

    def test_sortie_contre_une_batterie_isolee(self):
        tb, pense, ai, math = self.place('def')
        mem = tb.ai_mem['s1']
        pl = tb.place_info()
        a = mem['fd']
        cav = next(u for u in tb.units if u.side == 1 and mem['role'].get(u.id) == 'cav')
        cav.morale, cav.fat = 90.0, 0.0
        z = tb.ai_zone(0)
        g = None
        for u in tb.units:
            if u.side != 0:
                continue
            if u.cls == 'artillerie' and g is None:
                g = u
                d = mem['r_in'] + 500
                u.x, u.y, u.form, u.dir = pl['x'] + math.cos(a) * d, pl['y'] + math.sin(a) * d, 'batterie', a + math.pi
            else:   # (les autres loin derrière : la batterie est isolée)
                u.x, u.y = (z[0] + z[2]) / 2 + math.cos(a) * 1500, (z[1] + z[3]) / 2 + math.sin(a) * 1500
                u.x, u.y = min(max(u.x, 20), BT.W - 20), min(max(u.y, 20), BT.H - 20)
            u.path, u.goal = [], None
        tb._update_vision()
        if g.id not in tb.seen_by[1]:
            self.skipTest('batterie invisible depuis la place avec cette graine')
        pense(1)
        self.assertIn(cav.id, mem.get('sortie', {}))
        self.assertTrue(any('sortie de la garnison' in n[1] for n in mem['journal']))
        st = mem['sortie'][cav.id]
        cav.x, cav.y, cav.path, cav.goal = st[3], st[4], [], None
        tb._update_vision()
        pense(1)
        self.assertEqual(mem['sortie'][cav.id][0], 'charger')
        self.assertEqual(cav.state, 'charge')
        json.dumps(tb.ai_mem)

    def test_niveaux_facile_et_difficile(self):
        for lvl in ('facile', 'difficile'):
            for role in ('att', 'def'):   # (l'IA du joueur garde ACCEL_LEVEL : l'autre camp joue à ce niveau)
                tb, pense, ai, math = self.place(role, lvl)
                avancer(tb, 2400)
                json.dumps(tb.ai_mem)

    def test_combats_de_rue(self):
        tb, pense, ai, math = self.place('def')
        mem = tb.ai_mem['s1']
        if not mem.get('ilots'):
            self.skipTest('pas de maisons à tenir dans cette place')
        pl = tb.place_info()
        a = mem['fd']
        # 400 hommes dans la place, depuis plus d'une minute
        es = [u for u in tb.units if u.side == 0 and u.cls == 'inf' and u.valid][:2]
        for k, e in enumerate(es):
            e.x, e.y = pl['x'] + math.cos(a) * (mem['r_in'] - 60) + 20 * k, pl['y'] + math.sin(a) * (mem['r_in'] - 60)
            e.path, e.goal = [], None
        tb._update_vision()
        pense(1)
        tb.clock += 90
        pense(1)
        il = [k for k, r in mem['role'].items() if r == 'ilot']
        self.assertTrue(il)
        self.assertLessEqual(len(il), ai.LEVELS['normal']['ilots'])
        self.assertTrue(any('tient les maisons' in n[1] for n in mem['journal']))


if __name__ == '__main__':
    unittest.main()
