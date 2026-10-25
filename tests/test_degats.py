"""Banc d'essai des dégâts aux bâtiments et des canons sur les murailles (SPEC-2D § 5).

    python3 tests/test_degats.py

Une maison sous le canon s'entame, brûle, gagne ses voisines et tombe en ruine ; une maison en feu ne couvre plus et
chasse ses occupants ; une ruine couvre moins qu'une maison et laisse mieux passer la vue. Le client reçoit les
changements dans `bati` (depuis since), l'état complet avec la carte ; la sauvegarde les garde. Dans une place à
enceinte, l'artillerie du défenseur est sur le rempart, tournée vers le dehors, et n'en bouge pas.
"""
import json
import math
import unittest

from fabrique import BT, GEO, S, avancer
from game.tactics.terrain import COLS, N, T_BATI, T_MUR, T_PRE, center_of


def place(role='att', seed=1, demarree=True):
    """Un siège (mode Bataille, place forte de 1790) : la TacticalBattle."""
    g, bid = S.new(GEO, dict(me='33', foe='24', era='1790', kind='forteresse', role=role, seed=seed,
                             units=dict(ligne=2, artillerie=2)))
    assert g is not None, bid
    tb = g.tactical[bid]
    if demarree:
        tb.start()
    return tb


def maison(tb, voisines=2):
    """Une case bâtie sans haie ni muret qui a au moins `voisines` cases bâties autour d'elle (dans le bourg)."""
    t = tb.t
    for c in range(COLS, N - COLS):
        if t[c] == T_BATI and not tb.f[c] and \
                sum(t[cc] == T_BATI for cc in (c - 1, c + 1, c - COLS, c + COLS)) >= voisines:
            return c
    raise AssertionError('pas de maison dans la place')


def brule(tb, duree):
    """Fait passer `duree` secondes de bataille à l'incendie seul (sans le reste de la bataille)."""
    for _ in range(int(duree // BT.FEU_DT)):
        tb.clock += BT.FEU_DT
        tb._incendie()


def scenario(tb):
    """Toujours la même suite de coups : vingt boulets sur une maison, puis deux heures d'incendie."""
    art = next(u for u in tb.units if u.cls == 'artillerie' and u.side == 0)
    c = maison(tb)
    for _ in range(20):
        tb._bati_hit(*center_of(c), art)
    tb._bati_set(c, 2)
    brule(tb, 7200)
    return tb.bati_log


class Maisons(unittest.TestCase):

    def test_un_boulet_sur_une_maison(self):
        tb = place()
        art = next(u for u in tb.units if u.cls == 'artillerie' and u.side == 0)
        cible = next(u for u in tb.units if u.side == 1 and u.cls == 'inf')
        c = maison(tb)
        cible.x, cible.y = center_of(c)
        art.x, art.y, art.dir = cible.x + 300, cible.y, math.pi
        art.form, art.shot, art.fire_mode, art.ammo, art.state, art.order = 'batterie', 'boulet', 'free', 50, 'repos', None
        tb._pick_target = lambda u, mx: cible   # (on ne teste que le boulet, pas le repérage)
        autour = [cc for cc in range(N) if tb.t[cc] == T_BATI and math.dist(center_of(cc), center_of(c)) < 80]
        for _ in range(60):
            art.reload = 0.0
            tb._fire(art, BT.DT)
            if any(tb.bati[cc] for cc in autour):
                break
        self.assertTrue(any(tb.bati[cc] for cc in autour), 'la maison visée ou une voisine est touchée')
        self.assertTrue(any(e['k'] == 'canon' for e in tb.fx))

    def test_les_boulets_tombent_court_ou_long(self):
        tb = place()
        art = next(u for u in tb.units if u.cls == 'artillerie' and u.side == 0)
        x, y = center_of(maison(tb))
        art.x, art.y = x + 400, y
        pts = [tb._chute(art, x, y) for _ in range(400)]
        axe = [px - x for px, _ in pts]
        cote = [py - y for _, py in pts]
        sd = lambda v: math.sqrt(sum(a * a for a in v) / len(v))
        self.assertAlmostEqual(sd(axe), 15 + 0.07 * 400, delta=8)   # dans l'axe du tir…
        self.assertAlmostEqual(sd(cote), 5 + 0.02 * 400, delta=4)   # … et moins de côté
        tb2 = place()
        art2 = next(u for u in tb2.units if u.cls == 'artillerie' and u.side == 0)
        art2.x, art2.y = art.x, art.y
        self.assertEqual(pts[:20], [tb2._chute(art2, x, y) for _ in range(20)], 'même graine, mêmes points de chute')

    def test_les_coups_longs_tombent_dans_la_ville(self):
        tb = place()
        pl = tb.map.place
        art = next(u for u in tb.units if u.cls == 'artillerie' and u.side == 0)
        murs = [c for c in range(N) if tb.t[c] == T_MUR]
        w = max(murs, key=lambda c: center_of(c)[0])   # le mur le plus à l'est
        wx, wy = center_of(w)
        a = math.atan2(wy - pl['y'], wx - pl['x'])
        art.x, art.y = wx + math.cos(a) * 350, wy + math.sin(a) * 350   # dehors, face au mur
        for _ in range(400):
            tb._bati_hit(*tb._chute(art, wx, wy), art)
        dedans = [c for c in range(N) if tb.bati[c] and math.dist(center_of(c), (pl['x'], pl['y'])) <
                  math.dist((wx, wy), (pl['x'], pl['y']))]
        self.assertTrue(dedans, 'des boulets trop longs passent le rempart et frappent les maisons derrière')

    def test_le_feu_gagne_puis_laisse_des_ruines(self):
        tb = place()
        c = maison(tb, 3)
        old = BT.FEU_PROPAG
        BT.FEU_PROPAG = 0.2   # (un feu qui gagne à coup sûr : on ne mesure pas la chance ici)
        try:
            tb._bati_set(c, 2)
            brule(tb, BT.FEU_DUREE - BT.FEU_DT)
            self.assertEqual(tb.bati[c], 2)   # il brûle encore…
            self.assertTrue(any(tb.bati[cc] == 2 for cc in (c - 1, c + 1, c - COLS, c + COLS)))   # … et a gagné
            brule(tb, 2 * BT.FEU_DT)
            self.assertEqual(tb.bati[c], 3)   # … puis tombe en ruine
            brule(tb, 4 * 3600)
        finally:
            BT.FEU_PROPAG = old
        etats = {tb.bati[x] for x in range(N) if tb.t[x] == T_BATI}
        self.assertNotIn(2, etats)   # tout ce qui a brûlé est en ruine
        self.assertFalse(tb.feu)

    def test_la_maison_en_feu_chasse_ses_occupants(self):
        tb = place()
        u = next(u for u in tb.units if u.side == 1 and u.cls == 'inf')
        c = maison(tb)
        u.x, u.y = center_of(c)
        u.morale = 70.0
        tb._bati_set(c, 2)
        brule(tb, BT.FEU_DT)
        self.assertNotEqual(tb.cell(u.x, u.y), c)
        self.assertNotEqual(tb.bati[tb.cell(u.x, u.y)], 2)
        self.assertLess(math.hypot(u.x - center_of(c)[0], u.y - center_of(c)[1]), 100)   # juste à côté
        self.assertEqual(u.morale, 70.0 - BT.FEU_MOR)

    def test_couvert_selon_l_etat(self):
        tb = place()
        c = maison(tb)
        x, y = center_of(c)
        vus = []
        for e in range(4):
            tb.bati[c] = e
            vus.append(tb.cover_at(x, y))
        self.assertEqual(vus, list(BT.BATI_COVER))
        intacte, touchee, feu, ruine = vus
        self.assertEqual(intacte, BT.COVER[T_BATI])
        self.assertEqual(feu, 0.0)
        self.assertGreater(intacte, ruine)
        self.assertGreater(ruine, BT.COVER[T_PRE])

    def test_une_ruine_laisse_passer_la_vue(self):
        tb = place()
        # deux maisons sur un regard à plat, en plein champ : elles le bouchent ; en ruine, plus
        j, i0 = 5, 10
        cs = [j * COLS + i for i in range(i0, i0 + 12)]
        for c in cs:
            tb.t[c], tb.h[c], tb.f[c] = T_PRE, 10, 0
        for c in cs[5:7]:
            tb.t[c] = T_BATI
        a, b = center_of(cs[0]), center_of(cs[-1])
        tb._los_cache.clear()
        self.assertFalse(tb.los(*a, *b))
        for c in cs[5:7]:
            tb._bati_set(c, 3)
        self.assertTrue(tb.los(*a, *b))

    def test_meme_graine_meme_incendie(self):
        un, deux = scenario(place(seed=4)), scenario(place(seed=4))
        self.assertTrue(un)
        self.assertEqual(un, deux)

    def test_bati_depuis_since_et_carte_complete(self):
        tb = place()
        c = maison(tb)
        s0 = tb.view(since=0)['seq']
        tb._bati_set(c, 1)
        s1 = tb.seq
        tb._bati_set(c, 2)
        self.assertEqual(tb.view(since=s0)['bati'], [[c, 1], [c, 2]])
        self.assertEqual(tb.view(since=s1)['bati'], [[c, 2]])
        self.assertEqual(tb.view(since=tb.seq)['bati'], [])
        self.assertIn([c, 2], tb.map_view()['bati'])
        self.assertEqual(len(tb.map_view()['bati']), 1)

    def test_sauvegarde_et_ancienne_sauvegarde(self):
        tb = place()
        scenario(tb)
        d = json.loads(json.dumps(tb.to_dict()))
        tc = BT.TacticalBattle.from_dict(GEO, d)
        self.assertEqual(tc.bati, tb.bati)
        self.assertEqual(tc.feu, tb.feu)
        self.assertEqual(tc.map_view()['bati'], tb.map_view()['bati'])
        self.assertEqual(tc.view(since=0)['bati'], tb.view(since=0)['bati'])
        del d['bati']   # (sauvegarde d'avant les dégâts : tout est intact)
        old = BT.TacticalBattle.from_dict(GEO, d)
        self.assertFalse(any(old.bati))
        self.assertEqual(old.map_view()['bati'], [])


class CanonsSurLeRempart(unittest.TestCase):

    def test_les_canons_du_defenseur_sont_sur_l_enceinte(self):
        tb = place('att', demarree=False)
        pl = tb.map.place
        canons = [u for u in tb.units if u.side == 1 and u.cls == 'artillerie']
        self.assertTrue(canons)
        # même déployée loin dehors, une batterie du défenseur va sur le mur
        z = tb.zone(1)
        u = canons[0]
        self.assertTrue(tb.deploy(1, [u.id], z[0], z[1], who='any')[0])
        self.assertEqual(tb.t[tb.cell(u.x, u.y)], T_MUR)
        tb.start()
        vus = {d['id']: d for d in tb.view(me=None)['units']}
        for u in canons:
            with self.subTest(canon=u.id):
                self.assertEqual(tb.t[tb.cell(u.x, u.y)], T_MUR)
                self.assertTrue(vus[u.id].get('rempart'))
                self.assertEqual(u.form, 'batterie')
                dehors = math.atan2(u.y - pl['y'], u.x - pl['x'])
                self.assertGreater(math.cos(u.dir - dehors), 0.99)   # tournée vers le dehors
                ok, msg = tb.order(1, [u.id], 'move', who='any', x=pl['x'], y=pl['y'])
                self.assertFalse(ok, msg)   # elle ne quitte pas le mur
        for a in canons:
            for b in canons:
                if a is not b:
                    self.assertGreaterEqual(math.hypot(a.x - b.x, a.y - b.y), BT.REMPART_GAP)
        att = [u for u in tb.units if u.side == 0 and u.cls == 'artillerie']
        self.assertFalse(any(d.get('rempart') for k, d in vus.items() if k in {u.id for u in att}))

    def test_le_canon_du_rempart_tire(self):
        tb = place('att')
        tb.autofinish()
        u = next(u for u in tb.units if u.side == 1 and u.cls == 'artillerie')
        x, y = u.x, u.y
        avancer(tb, 3600, jusqua=lambda: u.fired_t > 0)
        self.assertGreater(u.fired_t, 0)
        if u.state != 'deroute':
            self.assertEqual((u.x, u.y), (x, y))

    def test_en_rase_campagne_rien_ne_change(self):
        from fabrique import bataille
        tb, mes = bataille()
        self.assertFalse(any(d.get('rempart') for d in tb.view()['units']))
        self.assertEqual(tb.view()['bati'], [])


if __name__ == '__main__':
    unittest.main()
