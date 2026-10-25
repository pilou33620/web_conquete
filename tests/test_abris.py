"""Banc d'essai des maisons occupées et des barricades (battle.py : ordres 'maisons' et 'barricade').

    python3 tests/test_abris.py

« Occuper les maisons » : l'infanterie va au bâti, y entre en 40 s, en sort en 30 s ; 25 hommes par case bâtie à moins
de 40 m, les autres restent dehors ; couvert des maisons, cachée au-delà de 120 m tant qu'elle ne tire pas, feu par les
fenêtres ×0,6, corps à corps ×1,6, les cavaliers n'y chargent pas, une maison en feu l'en chasse.
« Barricader » : l'infanterie arrêtée, sans ennemi à 200 m, avec de quoi faire (maisons, bois, sapeurs) dresse en 4 min
une ligne de cases de barricade devant elle, sur le découvert ; cavaliers et canons n'y passent pas, la charge s'y brise,
le boulet la renverse ; la sauvegarde la garde. L'IA s'en sert en défense.
"""
import json
import math
import unittest

from fabrique import BT, GEO, S, bataille
from game.tactics import ai as AI
from game.tactics.terrain import CELL, COLS, T_BATI, T_BOIS, T_EAU, T_MUR, T_PRE, T_ROUTE, T_BARRICADE

X0, Y0 = 1510.0, 1010.0   # le bourg (au milieu de la carte, loin des zones de déploiement ; au centre d'une case)


def calme(mes=None):
    """Une bataille engagée sans IA, l'ennemi rangé loin de tout (au bord de la carte) : rien ne bouge seul."""
    tb, us = bataille(mes or dict(ligne=1, cavalerie=1, sapeurs=1))
    tb.ai_sides = []
    for k, u in enumerate(tb.units):
        u.ctrl = 'joueur'
        u.path, u.goal, u.state = [], None, 'repos'
        if u.side != tb.me:
            u.x, u.y = 100.0 + 30 * k, 60.0
    return tb, us


def case(x, y):
    return int(y // CELL) * COLS + int(x // CELL)


def peindre(tb, x, y, r, t):
    """Les cases à moins de r m de (x, y) deviennent du type t (sans haie ni muret)."""
    for c in tb.cells_near(x, y, r):
        tb.t[c] = t
        tb.f[c] = 0
        tb.bati[c] = 0
    tb._cost_cache, tb._path_cache, tb._los_cache = {}, {}, {}


def bourg(tb, rue=False):
    """Un champ dégagé (400 m) et, au milieu, un bourg de 13 cases bâties à moins de 40 m (capacité : 325 hommes) ;
    rue : la case du milieu est une rue (12 maisons, 300 hommes ; le couvert ne vient alors que des maisons)."""
    peindre(tb, X0, Y0, 400, T_PRE)
    peindre(tb, X0, Y0, 40, T_BATI)
    if rue:
        tb.t[case(X0, Y0)] = T_ROUTE


def poser(u, x, y, d=0.0, men=None):
    u.x, u.y, u.dir, u.path, u.goal, u.state, u.busy, u.next_form = x, y, d, [], None, 'repos', 0.0, None
    if men is not None:
        u.men = u.men0 = float(men)


def foe(tb, u, cls='inf'):
    return next(e for e in tb.units if e.side != u.side and e.cls == cls)


def dedans(tb, u, men=200, rue=False):
    """u dans les maisons du bourg, tout de suite."""
    bourg(tb, rue)
    poser(u, X0, Y0, men=men)
    u.form = 'maisons'
    u.order = dict(kind='maisons', x=X0, y=Y0)


class Maisons(unittest.TestCase):

    def test_refus(self):
        tb, us = calme()
        bourg(tb)
        u, cav = us['ligne'], us['cavalerie']
        poser(cav, X0 + 80, Y0)
        self.assertEqual(tb.order(tb.me, [cav.id], 'maisons', who='any'),
                         (False, "Seule l'infanterie occupe les maisons."))
        poser(u, X0 + 400, Y0)
        self.assertEqual(tb.order(tb.me, [u.id], 'maisons', who='any')[1], "Aucune maison à moins de 60 m.")
        u.state = 'melee'
        self.assertIn("aux prises", tb.why_maisons(u, X0, Y0)[0])
        poser(u, X0 + 80, Y0)
        for c in tb.cells_near(X0, Y0, 60):
            if tb.t[c] == T_BATI:
                tb._bati_set(c, 2)
        self.assertEqual(tb.why_maisons(u, X0, Y0)[0], "Ces maisons brûlent.")

    def test_entrer_puis_sortir(self):
        tb, us = calme()
        bourg(tb)
        u = us['ligne']
        poser(u, X0 + 90, Y0, men=200)
        ok, msg = tb.order(tb.me, [u.id], 'maisons', who='any', x=X0, y=Y0)
        self.assertTrue(ok, msg)
        self.assertTrue(u.path)
        t0, entre = tb.clock, None
        while tb.clock - t0 < 400 and u.form != 'maisons':
            tb.step()
            if entre is None and u.next_form == 'maisons':
                entre = (tb.clock, u.busy)
        self.assertEqual(u.form, 'maisons')
        self.assertTrue(15 <= entre[1] <= BT.MAISON_IN, entre)            # 40 s au plus (moins pour des vétérans)
        self.assertLess(math.hypot(u.x - X0, u.y - Y0), 40)
        # tout ordre de marche l'en fait sortir : 30 s au plus avant de bouger
        x, y = u.x, u.y
        tb.order(tb.me, [u.id], 'move', who='any', x=X0 + 300, y=Y0)
        self.assertEqual(u.next_form, 'ligne')
        self.assertTrue(10 <= u.busy <= BT.MAISON_OUT, u.busy)
        tb.step()
        self.assertEqual((u.x, u.y), (x, y))
        for _ in range(int(BT.MAISON_OUT / BT.DT) + 2):
            tb.step()
        self.assertEqual(u.form, 'ligne')
        self.assertGreater(math.hypot(u.x - x, u.y - y), 1)

    def test_capacite_et_couvert(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u, men=200, rue=True)
        e = foe(tb, u)
        poser(e, X0 + 300, Y0)
        self.assertEqual(tb._maisons(u), (1.0, BT.BATI_COVER[0]))
        self.assertAlmostEqual(tb._cover_vs(u, e), BT.BATI_COVER[0])
        u.men = 600.0                                                       # 12 cases × 25 = 300 à l'abri
        occ, cov = tb._maisons(u)
        self.assertAlmostEqual(occ, 0.5)
        self.assertAlmostEqual(tb._cover_vs(u, e), 0.5 * BT.BATI_COVER[0])
        u.men = 200.0
        for c in tb.cells_near(X0, Y0, 60):
            if tb.t[c] == T_BATI:
                tb.bati[c] = 3                                              # en ruine : on s'y tient, moins bien
        self.assertEqual(tb._maisons(u), (1.0, BT.BATI_COVER[3]))
        u.form = 'ligne'
        self.assertEqual(tb._cover_vs(u, e), 0.0)                           # (dans la rue, sans les maisons)

    def test_cachee(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u)
        e = foe(tb, u)
        poser(e, X0 + 140, Y0)
        u.form = 'ligne'
        tb._update_vision()
        self.assertIn(u.id, tb.seen_by[e.side])                             # en lisière : on la voit
        u.form = 'maisons'
        tb._update_vision()
        self.assertNotIn(u.id, tb.seen_by[e.side])                          # derrière les volets, à 140 m
        u.fired_t = tb.clock - 30
        tb._update_vision()
        self.assertIn(u.id, tb.seen_by[e.side])                             # elle a tiré : vue 60 s
        u.fired_t = tb.clock - 61
        poser(e, X0 + 100, Y0)
        tb._update_vision()
        self.assertIn(u.id, tb.seen_by[e.side])                             # à moins de 120 m
        u.men = 650.0
        poser(e, X0 + 140, Y0)
        tb._update_vision()
        self.assertIn(u.id, tb.seen_by[e.side])                             # la moitié dans la rue : elle se voit

    def test_feu_par_les_fenetres(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u, rue=True)
        e = foe(tb, u)
        poser(e, X0 + 90, Y0, d=math.pi)
        tb._update_vision()

        def salve(form):
            u.form, u.reload, u.ammo, u.target, u.dir, u.fat = form, 0.0, 50.0, e.id, 0.0, 0.0
            e.men = e.men0 = 500.0
            lost = e.lost
            tb._fire(u, BT.DT)
            return e.lost - lost
        k = salve('maisons') / salve('ligne')
        self.assertAlmostEqual(k, 0.6 / (1 + tb.tech_of(u).get('ligne_fire', 0.0)), places=6)

    def test_corps_a_corps(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u, rue=True)
        e = foe(tb, u)
        poser(e, X0 + 20, Y0)
        k = tb._melee_k(u, e)
        u.form = 'ligne'
        self.assertAlmostEqual(k / tb._melee_k(u, e), BT.MAISON_MELEE)
        u.form, u.men = 'maisons', 600.0
        self.assertAlmostEqual(k / tb._melee_k(u, e), BT.MAISON_MELEE / (1 + 0.6 * 0.5))

    def test_pas_de_charge_de_cavaliers(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u)
        cav = foe(tb, u, 'cavalerie')
        poser(cav, X0 + 150, Y0)
        tb._update_vision()
        u.fired_t = tb.clock                                                # (repérée : elle tire)
        tb._update_vision()
        ok, msg = tb.order(cav.side, [cav.id], 'charge', who='any', target=u.id)
        self.assertFalse(ok)
        self.assertIn("ne chargent pas des maisons", msg)
        self.assertFalse(AI._charge_ok(tb, cav.side, cav, u))
        # une charge déjà lancée (avant qu'elle n'y entre) meurt au pied des maisons
        men, mor = u.men, u.morale
        cav.charge_v = 110.0
        tb._impact(cav, u)
        self.assertEqual((u.men, u.morale, u.state), (men, mor, 'repos'))
        self.assertEqual(cav.order, dict(kind='hold'))

    def test_maison_en_feu(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u)
        tb._bati_set(case(u.x, u.y), 2)
        tb._incendie()
        self.assertEqual(u.form, 'ligne')
        self.assertEqual(u.order, dict(kind='hold'))

    def test_deroute_et_retraite(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u)
        tb._rout(u)
        self.assertEqual(u.form, 'ligne')
        dedans(tb, u)
        tb._retreat(u)
        self.assertEqual(u.next_form, 'ligne')


def front(tb, u, d=0.0, men=300):
    """u arrêtée face à l'est, le bourg 40 m derrière elle (de quoi se barricader) ; le front est dégagé."""
    bourg(tb)
    poser(u, X0 + 80, Y0, d=d, men=men)
    u.form, u.fat = 'ligne', 0.0
    u.order = dict(kind='hold')


class Barricades(unittest.TestCase):

    def test_refus(self):
        tb, us = calme()
        u, cav, sap = us['ligne'], us['cavalerie'], us['sapeurs']
        front(tb, u)
        poser(cav, X0 + 100, Y0 + 100)
        self.assertEqual(tb.why_barricade(cav), "Seule l'infanterie dresse des barricades.")
        u.path = [(X0 + 300, Y0)]
        u.state = 'marche'
        self.assertEqual(tb.why_barricade(u), "Il faut d'abord qu'elle s'arrête.")
        poser(u, X0 + 100, Y0)
        e = foe(tb, u)
        poser(e, X0 + 280, Y0)
        tb._update_vision()
        self.assertIn("L'ennemi est trop près", tb.why_barricade(u))
        poser(e, 100, 60)
        tb._update_vision()
        self.assertEqual(tb.why_barricade(u), '')
        poser(u, X0 + 300, Y0)                                              # en rase campagne, loin de tout
        self.assertIn("Rien pour se barricader", tb.order(tb.me, [u.id], 'barricade', who='any')[1])
        poser(sap, X0 + 300, Y0 + 100)
        self.assertEqual(tb.why_barricade(sap), '')                         # les sapeurs, partout
        poser(u, X0 + 100, Y0)
        peindre(tb, X0 + 125, Y0, 80, T_EAU)
        self.assertIn("Pas de terrain", tb.why_barricade(u))

    def test_abattis_pres_des_bois(self):
        tb, us = calme()
        u = us['ligne']
        peindre(tb, X0, Y0, 400, T_PRE)
        peindre(tb, X0 - 40, Y0, 25, T_BOIS)
        poser(u, X0, Y0)
        self.assertEqual(tb._barr_style(u), 'b')
        poser(u, X0 + 100, Y0)
        self.assertIs(tb._barr_style(u), False)

    def test_duree_et_cases(self):
        tb, us = calme()
        u = us['ligne']
        front(tb, u)
        ok, msg = tb.order(tb.me, [u.id], 'barricade', who='any')
        self.assertTrue(ok, msg)
        self.assertEqual(u.order['need'], BT.BARR_T)
        while tb.clock - u.order['t0'] < BT.BARR_T - 4:
            tb.step()
        self.assertFalse(tb.barr)
        for _ in range(3):
            tb.step()
        self.assertEqual(len(tb.barr), 1)
        b = tb.barr[0]
        self.assertEqual((b['u'], b['s']), (u.id, 'v'))
        cells = [c for c, _p in b['c']]
        w = BT.U.footprint(u)[0]
        self.assertGreaterEqual(len(cells), int(w // CELL))                  # toute la largeur du front
        for c in cells:
            self.assertEqual(tb.t[c], T_BARRICADE)
            x = (c % COLS + 0.5) * CELL
            self.assertTrue(u.x + 10 <= x <= u.x + 40, x)                   # 10 à 20 m devant le front (6 m)
        self.assertEqual(kind(u), 'hold')
        self.assertEqual(tb.why_barricade(u), "Elle a déjà sa barricade.")
        # sapeurs : deux minutes ; fatigués : ×1,3
        sap = us['sapeurs']
        poser(sap, X0 + 100, Y0 + 300)
        sap.fat = 60.0
        self.assertTrue(tb.order(tb.me, [sap.id], 'barricade', who='any')[0])
        self.assertAlmostEqual(sap.order['need'], BT.BARR_T_SAP * BT.BARR_FAT)

    def test_interrompue(self):
        tb, us = calme()
        u = us['ligne']
        front(tb, u)
        tb.order(tb.me, [u.id], 'barricade', who='any')
        tb.step()
        e = foe(tb, u)
        poser(e, u.x + 140, u.y)
        tb._update_vision()
        tb.step()
        self.assertEqual(kind(u), 'hold')
        poser(e, 100, 60)
        tb._update_vision()
        tb.order(tb.me, [u.id], 'barricade', who='any')
        tb.order(tb.me, [u.id], 'move', who='any', x=u.x, y=u.y + 100)
        for _ in range(int(BT.BARR_T / BT.DT) + 5):
            tb.step()
        self.assertFalse(tb.barr)

    def test_seulement_sur_le_decouvert(self):
        tb, us = calme()
        u = us['ligne']
        front(tb, u)
        ahead = u.x + 6 + BT.BARR_D
        interdits = {}
        for k, t in enumerate((T_EAU, T_BATI, T_MUR, T_BOIS)):
            c = case(ahead, u.y - 45 + 30 * k)
            tb.t[c] = t
            interdits[c] = t
        cells, _pts = tb._barr_line(u)
        self.assertTrue(cells)
        for c in cells:
            self.assertIn(tb.t[c], BT.BARR_ON)
        self.assertFalse(set(cells) & set(interdits))
        # jamais dans la zone de déploiement de l'assaillant
        z = tb.zones[0]
        poser(u, (z[0] + z[2]) / 2, (z[1] + z[3]) / 2)
        peindre(tb, u.x, u.y, 100, T_PRE)
        self.assertEqual(tb._barr_line(u)[0], [])

    def bati(self, tb, u):
        tb.order(tb.me, [u.id], 'barricade', who='any')
        u.order['t0'] = tb.clock - BT.BARR_T
        tb.step()
        self.assertEqual(len(tb.barr), 1)
        return [c for c, _p in tb.barr[0]['c']]

    def test_cavaliers_et_canons_ne_passent_pas(self):
        tb, us = calme()
        u = us['ligne']
        front(tb, u)
        c = self.bati(tb, u)[0]
        x, y = (c % COLS + 0.5) * CELL, (c // COLS + 0.5) * CELL
        self.assertTrue(tb.passable(x, y, 'inf'))
        self.assertFalse(tb.passable(x, y, 'cavalerie'))
        self.assertFalse(tb.passable(x, y, 'artillerie'))

    def test_la_charge_se_brise(self):
        tb, us = calme()
        u = us['ligne']
        front(tb, u)
        cav = foe(tb, u, 'cavalerie')

        def choc():
            u.men = u.men0 = 300.0
            u.morale, u.ammo, u.state, u.lost = 30.0, 0.0, 'repos', 0.0    # ébranlée, sans cartouches : elle romprait
            poser(cav, u.x + 60, u.y, d=math.pi, men=300)
            cav.morale, cav.fat, cav.charge_v, cav.state = 80.0, 0.0, 110.0, 'charge'
            tb._impact(cav, u)
            return u.lost
        sans = choc()
        self.assertEqual(u.state, 'deroute')
        u.state, u.order = 'repos', dict(kind='hold')
        self.bati(tb, u)
        avec = choc()
        self.assertNotEqual(u.state, 'deroute')                             # elle ne la rompt pas
        self.assertEqual(cav.order, dict(kind='hold'))                       # les cavaliers tournent bride
        self.assertAlmostEqual(avec / sans, BT.BARR_CHOC, places=3)

    def test_le_boulet_la_renverse(self):
        tb, us = calme()
        u = us['ligne']
        front(tb, u)
        cells = self.bati(tb, u)
        art = foe(tb, u)                                                    # (le tireur : pour l'obus seulement)
        seq = tb.seq

        class Des:
            def __init__(self, v):
                self.v = v

            def random(self):
                return self.v
        rng, tb.rng = tb.rng, Des(0.3)
        tb._bati_hit((cells[0] % COLS + 0.5) * CELL, (cells[0] // COLS + 0.5) * CELL, art)
        self.assertEqual(tb.t[cells[0]], T_BARRICADE)                       # trois fois sur quatre, elle tient
        tb.rng = Des(0.2)
        tb._bati_hit((cells[0] % COLS + 0.5) * CELL, (cells[0] // COLS + 0.5) * CELL, art)
        tb.rng = rng
        self.assertEqual(tb.t[cells[0]], T_PRE)
        self.assertTrue(tb.passable((cells[0] % COLS + 0.5) * CELL, (cells[0] // COLS + 0.5) * CELL, 'cavalerie'))
        v = tb.view(tb.me, seq)
        self.assertEqual(v['barr_t'], [[cells[0], T_PRE]])
        self.assertEqual(len(v['barr']), 1)
        self.assertEqual(tb.why_barricade(u), "Elle a déjà sa barricade.")   # (il en reste)

    def test_sauvegarde(self):
        tb, us = calme()
        u, v = us['ligne'], us['sapeurs']
        front(tb, u)
        poser(v, X0, Y0)
        v.form = 'maisons'
        cells = self.bati(tb, u)
        tb._barr_set(cells[0], T_PRE)                                       # (un boulet l'a renversée là)
        d = json.loads(json.dumps(tb.to_dict()))
        tb2 = BT.TacticalBattle.from_dict(GEO, d)
        self.assertEqual(tb2.barr_prev, tb.barr_prev)
        self.assertEqual([tb2.t[c] for c in cells], [tb.t[c] for c in cells])
        self.assertEqual(tb2.t[cells[1]], T_BARRICADE)
        self.assertEqual(tb2.t[cells[0]], tb.t[cells[0]])
        x, y = (cells[1] % COLS + 0.5) * CELL, (cells[1] // COLS + 0.5) * CELL
        self.assertFalse(tb2.passable(x, y, 'cavalerie'))
        self.assertEqual(tb2.by_id[v.id].form, 'maisons')
        self.assertEqual(tb2.map_view()['barr'], tb.barr)

    def test_vue(self):
        tb, us = calme()
        u = us['ligne']
        front(tb, u)
        d = next(x for x in tb.view(tb.me)['units'] if x['id'] == u.id)
        self.assertIs(d['can_barricade'], True)
        self.assertIs(d['can_occupy'], True)                                # (le bourg à 100 m : maisons à 60 m)
        poser(u, X0 + 300, Y0)
        d = next(x for x in tb.view(tb.me)['units'] if x['id'] == u.id)
        self.assertIn("Rien pour se barricader", d['can_barricade'])
        self.assertEqual(d['can_occupy'], "Aucune maison à moins de 60 m.")
        self.assertNotIn('can_occupy', next(x for x in tb.view(tb.me)['units'] if x['id'] == us['cavalerie'].id))


def kind(u):
    return u.order.get('kind') if isinstance(u.order, dict) else u.order


class IA(unittest.TestCase):

    def test_la_garnison_occupe_les_maisons(self):
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1790', kind='forteresse', role='att', seed=1,
                                 units=dict(ligne=2, artillerie=1)))
        tb = g.tactical[bid]
        tb.start()
        mem = tb.ai_mem['s1']
        gar = [u for u in tb.units if u.side == 1 and u.cls == 'inf' and mem['role'].get(u.id) in AI.ABRI_ROLES
               and tb.why_maisons(u, u.x, u.y)[0] == '']
        self.assertTrue(gar, 'pas de garnison près des maisons')
        u = gar[0]
        poser(u, u.x, u.y)
        att = next(e for e in tb.units if e.side == 0 and e.cls == 'inf')
        poser(att, u.x + 2000, u.y)
        AI._abris(tb, 1, mem, [u], [att], set())
        self.assertNotEqual(kind(u), 'maisons')                             # l'ennemi est loin : rien
        poser(att, u.x + 500, u.y)
        busy = set()
        AI._abris(tb, 1, mem, [u], [att], busy)
        self.assertEqual(kind(u), 'maisons')
        self.assertIn(u.id, busy)
        self.assertTrue(AI._tenue(u))

    def test_le_defenseur_se_barricade_devant_des_cavaliers(self):
        tb, us = calme()
        cav = us['cavalerie']
        u = foe(tb, cav)                                                    # (une infanterie du défenseur)
        u.ctrl = 'ia'
        front(tb, u)
        poser(cav, u.x + 600, u.y)
        mem = {'plan': 'tenir', 'role': {}}
        self.assertEqual(u.side, 1)
        AI._abris(tb, 1, mem, [u], [], set())
        self.assertEqual(kind(u), 'hold')                                   # pas de cavaliers en vue : rien
        cav.state, cav.dir = 'marche', math.pi                              # (ils viennent droit sur elle)
        AI._abris(tb, 1, mem, [u], [cav], set())
        self.assertEqual(kind(u), 'barricade')

    def test_l_assaillant_ne_se_barricade_pas(self):
        tb, us = calme()
        u = us['ligne']
        u.ctrl = 'ia'
        front(tb, u)
        cav = foe(tb, u, 'cavalerie')
        poser(cav, u.x + 600, u.y)
        cav.state, cav.dir = 'marche', math.pi
        AI._abris(tb, 0, {'plan': 'assaut', 'role': {}}, [u], [cav], set())
        self.assertEqual(kind(u), 'hold')

    def test_les_legers_ne_se_barricadent_pas(self):
        tb, us = calme()
        cav = us['cavalerie']
        d = foe(tb, cav)
        d.ctrl, d.light = 'ia', True                                        # (des légers du défenseur)
        front(tb, d)
        poser(cav, d.x + 600, d.y)
        cav.state, cav.dir = 'marche', math.pi
        self.assertEqual(tb.why_barricade(d), '')
        AI._abris(tb, 1, {'plan': 'tenir', 'role': {}}, [d], [cav], set())
        self.assertEqual(kind(d), 'hold')

    def test_l_ia_laisse_les_troupes_a_l_abri(self):
        tb, us = calme()
        u = us['ligne']
        dedans(tb, u)
        mem = {'blocked': {}}
        AI._goto(tb, u.side, mem, u, u.x + 400, u.y)
        self.assertEqual(u.form, 'maisons')
        self.assertFalse(u.path)


if __name__ == '__main__':
    unittest.main()
