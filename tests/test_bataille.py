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

from fabrique import BT, GEO, S, avancer, bataille, bataille_de_campagne, ennemi, face_a_face, kind, ordre
from game import rules as R


class OrdresParArme(unittest.TestCase):
    """Chaque arme a ses ordres (l'IA les donne par battle.order) ; le moteur refuse ceux qui ne sont pas les siens."""

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
                        if k not in ('por', 'jus', 'mun'):
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
            self.assertTrue(all(v[2] == 0 for k, v in self.ST.of_unit(self.l, self.tb).items() if k not in ('por', 'jus', 'mun')))

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


    def test_l_assaut_chasse_a_la_baionnette_les_gardiens_du_coeur(self):
        # au cœur de la place, l'assaillant ne se contente pas de fusiller : il charge ceux qui le tiennent encore,
        # cavaliers compris, et relance une charge arrêtée court
        tb, pense, ai, math = self.place()
        mem = tb.ai_mem['s0']
        mem.update(phase='assaut', t_phase=tb.clock - 400, t_go=tb.clock - 1000, n_assault=1)
        hx, hy = mem['heart']
        u = next(v for v in tb.units if v.side == 0 and mem['role'].get(v.id) == 'assaut' and v.valid)
        cav = next(v for v in tb.units if v.side == 1 and v.cls == 'cavalerie' and v.valid)
        for v in tb.units:
            if v.side == 1 and v is not cav:
                v.state = 'hors'
        cav.x, cav.y, cav.state, cav.path, cav.goal = hx + 50, hy, 'repos', [], None
        u.x, u.y, u.morale, u.state, u.path, u.goal = hx, hy, 90.0, 'repos', [], None
        tb._update_vision()
        pense(0)
        self.assertEqual((u.state, u.target), ('charge', cav.id))
        u.state = 'repos'   # (la charge s'est arrêtée court ; l'ordre est resté)
        pense(0)
        self.assertEqual(u.state, 'charge')


class PlaceAuMilieuDeLEau(unittest.TestCase):
    """Fort Médoc (graine 2) : la carte de campagne, grossière sur l'estuaire, posait la place dans l'eau, sans un
    pont pour y aller ; l'assaillant se déployait sur l'eau. La place est bâtie au sec, reliée par une chaussée et
    son pont, et l'assaillant arrive par le bord le plus sec."""

    def test_on_va_au_pied_du_rempart_par_le_pont(self):
        import math
        from fabrique import GEO
        from game.tactics import skirmish as S
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1790', kind='forteresse', role='def',
                                 units=dict(ligne=2, artillerie=1), seed=2))
        tb = g.tactical[bid]
        pl = tb.map.place
        self.assertEqual(pl['name'], 'Fort Médoc')
        self.assertTrue(any(math.hypot(b['x'] - pl['x'], b['y'] - pl['y']) < pl['r'] + 300 for b in tb.map.bridges))   # (le pont de la chaussée)
        self.assertGreater(tb._dry(tb.zone(0)), 0.3)
        u = next(u for u in tb.units if u.side == 0 and u.cls == 'inf')
        a, r = math.atan2(u.y - pl['y'], u.x - pl['x']), pl['r'] + 80
        self.assertIsNotNone(tb.path_cost(u.x, u.y, pl['x'] + math.cos(a) * r, pl['y'] + math.sin(a) * r, 'inf', 0))


class RedditionDUnePlace(unittest.TestCase):
    """Une garnison battue en brèche, éprouvée et débordée capitule sans assaut (SURR_*) : elle est prisonnière et la
    place est prise sur la carte de campagne ; une garnison encore solide tient."""

    def test_la_garnison_capitule_et_la_place_est_prise(self):
        from fabrique import S
        from game.tactics import bridge as TB
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1870', kind='forteresse', role='att', seed=1,
                                 units=dict(ligne=4, artillerie=2)))
        tb = g.tactical[bid]
        tb.autofinish()
        gar = [u for u in tb.units if u.side == 1 and u.cls not in ('general', 'chariot')]
        tb.clock, tb.siege_t, tb.breach_t = 4000.0, 0.0, [[1000, '0']]
        for u in gar:
            u.men, u.morale = u.men0 * 0.4, 80.0
        tb._check_end()
        self.assertNotEqual(tb.phase, 'fin')   # (moral encore ferme : elle tient)
        for u in gar:
            u.morale = 40.0
        tb._check_end()
        self.assertEqual((tb.phase, tb.winner), ('fin', 0))
        self.assertTrue(tb.why.startswith('La garnison capitule'))
        self.assertTrue(all(u.men == 0 for u in gar))
        self.assertGreaterEqual(tb.result['prisoners'][1], 0.4 * sum(u.men0 for u in gar) - 1)
        # la campagne : la place change de mains
        de = next(a for a in g.armies.values() if a.get('at_node') is not None)
        att = next(a for a in g.armies.values() if a is not de)
        nid = de['at_node']
        g.battles[bid] = dict(id=bid, x=att['x'], y=att['y'], node=nid, ambush=False, surprise=False, recent=[0.0, 0.0],
                              sides=[dict(owner=att['owner'], armies=[att['id']], men0=1.0, lost=0.0, node=None),
                                     dict(owner=de['owner'], armies=[de['id']], men0=1.0, lost=0.0, node=nid)])
        TB.finish(g, tb)
        self.assertEqual(g.nodes[nid]['owner'], att['owner'])
        self.assertNotIn(de['id'], g.armies)   # (la garnison prisonnière ne revient pas)


class LaBrecheEstUnGoulet(unittest.TestCase):
    """Sur une brèche et à une case de ses bords, l'assaillant n'engage que BRECHE_FRONT hommes en mêlée, s'y bat moins
    bien et prend les feux croisés ; pas le défenseur, ni l'assaillant à deux cases."""

    def test_front_etroit_et_feux_croises(self):
        from fabrique import S
        from game.tactics.terrain import CELL, COLS, T_BRECHE, T_MUR
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1813', kind='forteresse', role='att', seed=1,
                                 units=dict(ligne=2)))
        tb = g.tactical[bid]
        a = next(u for u in tb.units if u.side == 0 and u.cls == 'inf' and u.men > BT.BRECHE_FRONT)
        d = next(u for u in tb.units if u.side == 1 and u.cls == 'inf')
        c = tb.t.index(T_MUR)
        x, y = (c % COLS + 0.5) * CELL, (c // COLS + 0.5) * CELL
        a.x, a.y = x + CELL, y
        k0 = tb._melee_k(a, d)
        self.assertEqual(tb._melee_men(a), a.men)
        tb.t[c] = T_BRECHE
        self.assertTrue(tb._in_breach(a))
        self.assertEqual(tb._melee_men(a), BT.BRECHE_FRONT)
        self.assertAlmostEqual(tb._melee_k(a, d), k0 * BT.BRECHE_MELEE)
        a.x = x + 2 * CELL
        self.assertFalse(tb._in_breach(a))
        d.x, d.y = x, y
        self.assertFalse(tb._in_breach(d))


class VillageBarricade(unittest.TestCase):
    """Le lieu « village » du mode Bataille (et du banc) : un village sans remparts, barricadé, que l'IA attaque
    (plan 'assaut') et défend (plan 'place')."""

    def test_village_barricade_attaque_et_defendu(self):
        from fabrique import S
        from game.tactics.terrain import T_BARRICADE
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1813', kind='village', role='att', seed=1,
                                 units=dict(ligne=2)))
        tb = g.tactical[bid]
        self.assertEqual((tb.map.place['type'], tb.place_info()['fort']), ('village', 0))
        self.assertGreater(tb.t.count(T_BARRICADE), 10)
        self.assertIsNotNone(tb.objective())
        tb.autofinish()
        self.assertEqual((tb.ai_mem['s0']['plan'], tb.ai_mem['s1']['plan']), ('assaut', 'place'))


class TechnologiesDeCombat(unittest.TestCase):
    """Feu de rang, ordre mixte, cuirassiers, artillerie à cheval, toutes armes… : la spec de la bataille les porte
    (bridge.make_spec), le moteur les applique comme la résolution automatique, et la fiche les compte."""

    def setUp(self):
        from game.tactics import stats as ST
        from game.tactics import units as U
        self.ST, self.U = ST, U
        self.tb, u = bataille()
        self.l = u['ligne']
        self.c = ennemi(self.tb, self.l, 'inf')
        face_a_face(self.tb, self.l, self.c, 80)

    tir = ValeursChiffrees.tir

    def tech(self, **md):
        self.tb.spec['tech'] = [md, {}] if self.l.side == 0 else [{}, md]

    def test_la_spec_porte_les_technologies(self):
        md = self.tb.tech(self.l.side)
        self.assertTrue(set(md) <= set(self.ST.TECH_MODS))
        self.assertGreater(md.get('ligne_fire', 0), 0, 'en 1790, le feu de rang est connu')
        del self.tb.spec['tech']
        self.assertEqual(self.tb.tech(0), {}, 'une ancienne sauvegarde : rien')

    def test_un_regiment_sans_feu_de_rang(self):
        # SPEC-ARBRE.md : la spec porte les effets propres des régiments en retard (umd), la bataille les préfère
        self.tech(ligne_fire=0.22)
        p_avec = self.tir(50)
        self.tb.spec['umd'] = {self.l.id: {}}
        self.assertAlmostEqual(p_avec / self.tir(50), 1.22, delta=0.02)
        self.assertEqual(self.tb.tech_of(self.c), self.tb.tech(self.c.side), 'les autres gardent ceux du camp')

    def test_la_spec_porte_les_regiments_en_retard(self):
        g, bt = bataille_de_campagne(epoque='1790')
        a = next(g.armies[aid] for s in bt['sides'] for aid in s['armies'] if g.armies[aid]['owner'] == g.player)
        r = next(r for r in a['regs'] if R.UNITS[r['type']]['cls'] == 'inf')
        r['man'] = []
        from game.tactics import bridge
        spec = bridge.make_spec(g, bt)
        self.assertEqual(list(spec['umd']), [r['id']], 'seul le régiment qui n’a rien appris')
        self.assertLess(spec['umd'][r['id']].get('ligne_fire', 0), spec['tech'][[s['owner'] for s in bt['sides']].index(g.player)]['ligne_fire'])

    def test_le_feu_de_rang_et_toutes_armes_au_tir(self):
        self.tech()
        p0 = self.tir(50)
        self.tech(ligne_fire=0.22, all_power=0.08, inf_power=0.05)
        self.assertAlmostEqual(self.tir(50) / p0, 1.22 * 1.13, delta=0.02)
        f = lambda **md: sum(self.ST.stats('ligne', 1, 50, mods=md)['pre'][:2])
        self.assertAlmostEqual(f(ligne_fire=0.22, all_power=0.08, inf_power=0.05) / f(), 1.22 * 1.13, delta=0.03)

    def test_la_melee_et_la_charge(self):
        l, c = self.l, self.c
        l.fat, l.morale, l.form = 0.0, 80.0, 'ligne'
        self.tech()
        k0 = self.tb._melee_k(l, c)
        self.tech(all_power=0.08, cav_power=0.15)
        self.assertAlmostEqual(self.tb._melee_k(l, c) / k0, 1.08, places=6, msg="l'infanterie : pas les hussards")
        s = lambda typ, **md: self.ST.stats(typ, 1, 0, mods=md)
        self.assertAlmostEqual(s('cavalerie', cav_charge=0.2)['chg'][0] / s('cavalerie')['chg'][0], 1.2, delta=0.04)
        self.assertAlmostEqual(s('ligne', colonne_charge=0.15)['chg'][0] / s('ligne')['chg'][0], 1.15, delta=0.04)
        self.assertEqual(s('ligne', cav_charge=0.2)['chg'], s('ligne')['chg'])

    def test_les_cuirassiers_au_choc(self):
        from unittest import mock
        cav = next(u for u in self.tb.units if u.side == self.l.side and u.cls == 'cavalerie')

        def choc(**md):
            self.tech(**md)
            cav.fat, cav.morale, cav.charge_v, cav.state = 0.0, 90.0, 999.0, 'charge'
            self.c.busy, self.c.men, self.c.morale, self.c.state = 5.0, 500.0, 90.0, 'repos'   # pris en manœuvre
            cav.x, cav.y = self.c.x + 10, self.c.y
            with mock.patch.object(self.tb, '_damage') as dmg:
                self.tb._impact(cav, self.c)
            return next(a[1] for a, _ in dmg.call_args_list if a[0] is self.c)

        self.assertAlmostEqual(choc(cav_charge=0.2) / choc(), 1.2, places=6)

    def test_la_portee_de_justesse(self):
        j = lambda arm: self.ST.stats('ligne', arm, 0)['jus']
        self.assertEqual((j(1), j(4)), (self.U.INF_D50[1], self.U.INF_D50[4]))
        u = self.U.Unit(type='ligne', cls='inf', arm=4)
        self.assertAlmostEqual(self.U.precision(u, j(4)), 0.5, places=3)
        self.assertNotIn('jus', self.ST.stats('artillerie', 2, 0), 'les canons : boulet et mitraille, pas cette courbe')
        self.assertIn('jus', self.ST.stats('mitrailleuses', 0, 0))


class IAFinirAutomatiquementEtLogement(unittest.TestCase):
    """« Finir automatiquement » en défense reprend les réglages du déploiement ; le logement dans la brèche."""

    def test_finir_automatiquement_en_defense(self):
        from fabrique import S
        from game.tactics import ai
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1813', seed=1, role='def',
                                 units=dict(ligne=3, legere=1, artillerie=2)))
        tb = g.tactical[bid]
        tb.start()
        z = tb.ai_zone(0)
        for k, u in enumerate(u for u in tb.units if u.side == 0):   # (l'assaillant au fond de sa zone, loin)
            u.x, u.y = (z[0] + z[2]) / 2 + 40 * k, (z[1] + z[3]) / 2
        mes = [u for u in tb.units if u.side == 1 and u.alive]
        line = [u for u in mes if u.cls == 'inf' and not u.light]
        light = next(u for u in mes if u.light)
        light.x, light.y = line[0].x + 30, line[0].y   # (le joueur avait ramené ses tirailleurs dans la ligne)
        tb._update_vision()
        tb.autofinish()
        ai.think(tb, 1, 2.0)
        mem = tb.ai_mem['s1']
        self.assertTrue(all(u.fire_mode == 'volley' for u in line))
        self.assertIn(light.id, mem['scr'])
        p = mem['post'][light.id]
        self.assertGreater(ai._rel(p[0], p[1], light.x, light.y, mem['fd'])[0], 80)   # l'écran repart en avant
        if mem['plan'] == 'tenir':
            arts = [u for u in mes if u.cls == 'artillerie']
            lats = sorted(mem['lat'][u.id] for u in arts)
            ll = [mem['lat'][u.id] for u in line]
            self.assertEqual((lats[0], lats[-1]), (round(min(ll), 1), round(max(ll), 1)))   # feux croisés
        # contre-pente en plein combat : le bataillon vu de l'ennemi garde sa place sur la crête et s'en va attendre
        # derrière (son poste), sans être redéployé
        from unittest import mock
        u = line[0]
        x0, y0 = u.x, u.y
        with mock.patch.object(ai, '_hidden', lambda b, s, x, y: (x, y) != (x0, y0)), \
                mock.patch.object(tb, 'height_at', lambda x, y: 10.0 if (x, y) == (x0, y0) else 0.0):
            ai._reverse_slope(tb, 1, mem, ai.LEVELS['normal'], [u], mem['fd'])
        self.assertEqual((u.x, u.y), (x0, y0))
        self.assertEqual(mem['crest'][u.id], [round(x0, 1), round(y0, 1)])
        self.assertLess(ai._rel(*mem['post'][u.id][:2], x0, y0, mem['fd'])[0], -10)

    def test_logement_dans_la_breche(self):
        tb, pense, ai, math = IAPlaces.place(self)
        mem = tb.ai_mem['s0']
        mem.update(phase='assaut', t_phase=tb.clock - 400, t_go=tb.clock - 1000, n_assault=1)
        bx, by = mem['bin']
        ass = [v for v in tb.units if v.side == 0 and mem['role'].get(v.id) == 'assaut' and v.valid]
        for k, v in enumerate(ass[:2]):
            v.x, v.y, v.morale, v.state, v.path, v.goal = bx + 30 * k, by, 90.0, 'repos', [], None
        for v in tb.units:   # (plus un défenseur sur la brèche)
            if v.side == 1 and math.hypot(v.x - bx, v.y - by) < 120:
                v.x, v.y = mem['heart']
        tb._update_vision()
        pense(0)
        u = tb.unit(mem['lodge'][0])
        self.assertEqual(u, ass[0])
        self.assertIn(u.id, tb.spec['logement'])
        self.assertEqual(kind(u), 'hold')
        self.assertTrue(any("s'y loge" in n[1] for n in mem['journal']))
        # retranché : gabions et sacs à terre au bout de ENTRENCH_T à l'arrêt
        u.still_t = tb.clock - BT.ENTRENCH_T - 1
        self.assertAlmostEqual(tb._entrench_k(u, ass[1]), 1 - BT.LOGEMENT_K)
        # la garnison l'en chasse : il s'est arrêté au débouché, on le rejette à la baïonnette
        md = tb.ai_mem['s1']
        q = [round(c) for c in ai._at(bx, by, mem['fd'], -20)] + [round(mem['fd'] + math.pi, 3)]
        md.setdefault('breach', []).append(q)
        u.state, u.morale = 'feu', 90.0
        res = next(v for v in tb.units if v.side == 1 and md['role'].get(v.id) == 'res' and v.cls == 'inf')
        res.x, res.y, res.morale, res.state, res.men = bx - math.cos(mem['fd']) * 90, \
            by - math.sin(mem['fd']) * 90, 90.0, 'repos', 2 * u.men
        tb._update_vision()
        pense(1)
        self.assertEqual((res.state, res.target), ('charge', u.id))
        # en déroute, le logement est perdu (la réserve qui l'a chargé tient la brèche : on n'y en loge pas un autre)
        u.state = 'deroute'
        res.x, res.y = bx, by
        tb._update_vision()
        pense(0)
        self.assertIsNone(mem['lodge'])
        self.assertNotIn(u.id, tb.spec['logement'])



def TB_view(g, bid):
    from game.tactics import bridge as TB
    return TB.battle_view(g, bid, 0)


class DonnerMesOrdres(unittest.TestCase):
    """« Donner mes ordres » (game/tactics/orders.py) : le joueur choisit ses ordres, ses officiers livrent la bataille
    selon eux, sous ses yeux, et s'arrêtent au moment décisif s'il l'a demandé."""

    def test_de_bout_en_bout(self):
        from game.tactics import bridge as TB
        g, bt = bataille_de_campagne('1813', attaque=True)
        r = TB.command(g, dict(sub='choose', bid=bt['id'], mode='ordres'))
        self.assertTrue(r['ok'], r)
        tb = g.tactical[bt['id']]
        self.assertEqual((tb.spec['mode'], tb.phase, tb.me), ('ordres', 'deploiement', 0))
        v = TB.battle_view(g, bt['id'], 0)
        o = v['ordres']
        self.assertEqual([t for t, _ in o['tabs']], ['man', 'armes', 'res', 'ruse'])
        keys = {gr['key'] for gr in o['groups']}
        self.assertTrue({'obj', 'man', 'wing', 'inf', 'cav', 'art', 'res', 'resWhen', 'ruse', 'hour', 'mood'} <= keys)
        self.assertIn('verdict', o['advice'])
        # un choix verrouillé (l'ordre oblique en 1813) est refusé : la valeur par défaut reste
        r = TB.command(g, dict(sub='orders', bid=bt['id'], orders=dict(man='oblique')))
        self.assertTrue(r['ok'])
        self.assertEqual(r['ordres']['orders']['man'], 'frontal')
        # un ordre de commandement ordinaire est refusé : ses officiers commandent
        self.assertFalse(TB.command(g, dict(sub='start', bid=bt['id']))['ok'])
        want = dict(man='enveloppement', wing='gauche', resWhen='demande', hour='aube', cav='aile')
        r = TB.command(g, dict(sub='orders', bid=bt['id'], orders=want, go=True))
        self.assertTrue(r['ok'], r)
        self.assertEqual((tb.phase, tb.spec['h_off']), ('combat', -2.5 * 3600))
        self.assertTrue(tb.view(0)['hour'].startswith('5 h'))
        mem = tb.ai_mem['s0']
        self.assertEqual((mem['plan'], mem['flank']), ('debordement', -1))
        self.assertTrue(all(mem['wing'][u.id] == -1 for u in tb.units if u.side == 0 and u.cls == 'cavalerie'))
        asked = False
        for _ in range(20000):
            if bt['id'] not in g.tactical:
                break
            TB.tick(g, 0.1)
            if tb.ask:
                asked = True
                self.assertIn('ask', TB.battle_view(g, bt['id'], 0))
                n = tb.clock
                TB.tick(g, 0.1)
                self.assertEqual(tb.clock, n, 'la bataille attend la réponse')
                self.assertTrue(TB.command(g, dict(sub='answer', bid=bt['id'], v='go'))['ok'])
        self.assertNotIn(bt['id'], g.tactical, 'la bataille est finie et reportée en campagne')
        self.assertTrue(asked, 'la réserve est partie au moment décisif, sur l’ordre du joueur')
        res = tb.result_view(0)
        self.assertEqual([a[0] for a in res['arms']], ['Infanterie', 'Cavalerie', 'Artillerie'])
        self.assertIsInstance(res['decisive'], list)

    def test_plan_fleches_et_vitesses(self):
        from game.tactics import bridge as TB
        g, bt = bataille_de_campagne('1813', attaque=True)
        r = TB.command(g, dict(sub='preview', bid=bt['id']))
        p = r['plan']
        self.assertEqual(len(p['t']), p['cols'] * p['rows'])
        self.assertTrue(any(u['s'] == p['me'] for u in p['units']), 'vos troupes sur le plan')
        pre = g.tac_preview[bt['id']]
        TB.command(g, dict(sub='choose', bid=bt['id'], mode='ordres'))
        tb = g.tactical[bt['id']]
        self.assertIs(tb, pre, 'la bataille du plan est celle des ordres')
        r = TB.command(g, dict(sub='orders', bid=bt['id'], orders=dict(man='enveloppement', ruse='feinte', art='grande')))
        kinds = {a['k'] for a in r['ordres']['arrows']}
        self.assertTrue({'main', 'fix'} <= kinds, kinds)
        self.assertFalse(TB.command(g, dict(sub='choose', bid=bt['id'], mode='manuel'))['ok'], 'plus de bataille commandée')
        TB.command(g, dict(sub='orders', bid=bt['id'], orders={}, go=True))
        self.assertTrue(TB.command(g, dict(sub='replay', bid=bt['id'], k=4))['ok'])
        self.assertEqual(TB.battle_view(g, bt['id'], 0)['replay']['k'], 4)
        for sub in ('deploy', 'order', 'speed', 'autofinish', 'resume', 'withdraw'):
            self.assertFalse(TB.command(g, dict(sub=sub, bid=bt['id']))['ok'], sub)

    def test_le_mode_bataille_se_livre_sur_ordres(self):
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1813', units=dict(ligne=2, cavalerie=1), seed=1))
        tb = g.tactical[bid]
        self.assertEqual(tb.spec['mode'], 'ordres')
        self.assertTrue(all(u.ctrl == 'ia' for u in tb.units))
        self.assertIn('ordres', TB_view(g, bid))

    def test_retour_a_la_fenetre_de_bataille(self):
        from game.tactics import bridge as TB
        g, bt = bataille_de_campagne('1790', attaque=False)
        TB.command(g, dict(sub='choose', bid=bt['id'], mode='ordres'))
        self.assertTrue(TB.command(g, dict(sub='cancel', bid=bt['id']))['ok'])
        self.assertEqual((g.tactical, bt['mode']), ({}, 'attente'))

    def test_la_cavalerie_et_la_reserve_suivent_les_ordres(self):
        from game.tactics import bridge as TB
        g, bt = bataille_de_campagne('1813', attaque=True)
        TB.command(g, dict(sub='choose', bid=bt['id'], mode='ordres'))
        tb = g.tactical[bt['id']]
        cav = [u for u in tb.units if u.side == 0 and u.cls == 'cavalerie']
        for c, w in (('aile', 1), ('reserve', 0)):
            TB.command(g, dict(sub='orders', bid=bt['id'], orders=dict(cav=c, wing='droite', man='frontal')))
            mem = tb.ai_mem['s0']
            self.assertEqual({mem['wing'][u.id] for u in cav}, {w}, c)

    def test_banc_des_ordres(self):
        """Quelques jeux d'ordres joués jusqu'au bout, IA contre IA : pas d'erreur, une issue."""
        from game.tactics import ai
        from game.tactics import orders as OR
        jeux = [('att', dict(man='double', cav='raid', leg='bois', ruse='bois', obj='retraite', vsCav='contre',
                             hour='aube')),
                ('att', dict(man='percee', art='grande', inf='mixte', vsRes='presser', ruse='feux', hour='midi')),
                ('def', dict(man='contrepente', ruse='deserteurs', wing='gauche', obj='cle', vsRes='canons'))]
        for role, o in jeux:
            g, bid = S.new(GEO, dict(me='33', foe='24', era='1813', kind='bataille', role=role,
                                     units=dict(ligne=4, legere=2, cavalerie=2, artillerie=2), seed=2))
            tb = g.tactical[bid]
            tb.spec['orders'] = [None, None]
            tb.spec['orders'][tb.me] = OR.clean(tb, tb.me, o)
            tb.autofinish()
            OR.setup(tb, tb.me, tb.spec['orders'][tb.me])
            if o.get('ruse') == 'deserteurs':
                ai.shift_reserve(tb, 1 - tb.me, OR.wing_sign(o))
            tb.run_to_end()
            self.assertEqual(tb.phase, 'fin', o)
            self.assertIn(tb.result['winner'], (0, 1, None))


class CanonsCamoufles(unittest.TestCase):
    """Des canons dans un bois : l'ennemi ne les voit qu'à moins de 250 m (500 m quand ils tirent) ; en échange, ils
    tirent moins bien (×0,65) et se mettent en batterie plus lentement (×1,6)."""

    def lisiere(self, tb):
        """Une case de bois avec 400 m de prairie ou de champs à l'est."""
        from game.tactics.terrain import COLS, ROWS, CELL, T_BOIS, T_PRE, T_CHAMP
        for j in range(10, ROWS - 10):
            for i in range(5, COLS - 25):
                if tb.t[j * COLS + i] == T_BOIS and all(tb.t[j * COLS + i + k] in (T_PRE, T_CHAMP) and
                                                        tb.h[j * COLS + i + k] <= tb.h[j * COLS + i] + 1
                                                        for k in range(1, 21)):
                    return (i + 0.5) * CELL, (j + 0.5) * CELL
        raise AssertionError('pas de lisière dégagée sur cette carte')

    def test_vus_de_pres_seulement(self):
        for seed in (1, 2, 3, 4, 5):
            tb, mes = bataille(dict(artillerie=1, ligne=1), epoque='1813', seed=seed)
            try:
                x, y = self.lisiere(tb)
                break
            except AssertionError:
                continue
        gun = mes['artillerie']
        obs = ennemi(tb, gun)
        for u in tb.units:   # (les autres loin de là)
            if u is not gun and u is not obs:
                u.x, u.y = 20.0 + 3 * (u.side * 2900), 20.0
        gun.x, gun.y = x, y
        def vu(d, tire):
            obs.x, obs.y = x + d, y
            gun.fired_t = tb.clock if tire else -1e9
            tb._update_vision()
            return gun.id in tb.seen_by[obs.side]
        self.assertFalse(vu(300, False))
        self.assertFalse(vu(600, True), 'la fumée sous les arbres ne trahit pas la batterie de loin')
        self.assertTrue(vu(400, True))
        self.assertTrue(vu(200, False) or vu(150, False))
        # hors du bois, la même batterie qui tire se voit de loin
        gun.x = x + 40
        self.assertTrue(vu(600, True))
        # mise en batterie plus lente entre les arbres
        gun.x, gun.form, gun.busy = x, 'attelee', 0.0
        tb._change_form(gun, 'batterie')
        t_bois = gun.busy
        gun.x, gun.form, gun.busy = x + 100, 'attelee', 0.0
        tb._change_form(gun, 'batterie')
        self.assertAlmostEqual(t_bois, gun.busy * BT.CAMO_SETUP, delta=0.5)


if __name__ == '__main__':
    unittest.main()
