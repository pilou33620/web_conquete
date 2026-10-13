"""Tests de non-régression (bibliothèque standard seulement, environ 15 s sur un PC, une minute sur un Raspberry Pi).

    python3 -m unittest discover tests

Ils couvrent ce qui fait perdre une partie quand ça casse : la sauvegarde (aller-retour, écriture, sauvegarde
illisible), le tour par tour (votre tour, puis le tour des IA jusqu'au 1er du mois suivant), une bataille tactique
menée jusqu'au bout, et les commandes mal formées envoyées au serveur.
"""
import json
import os
import sys
import tempfile
import unittest

os.environ['WEB_CONQUETE_NOLOG'] = '1'   # les tests n'écrivent pas dans logs/batailles.jsonl
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402
from game import events as E  # noqa: E402
from game import turns as TT  # noqa: E402
from game import views as V  # noqa: E402
from game.engine import Game  # noqa: E402
from game.geo import GeoMap  # noqa: E402
from game.tactics import skirmish as S  # noqa: E402

GEO = GeoMap()


def play_month(g):
    """« Tour suivant » : le tour des IA se joue jusqu'au 1er du mois suivant (interruptions comprises)."""
    TT.go(g)
    for _ in range(600):
        if g.tour['end'] is None:
            return
        TT.advance(g, 1.0)
        if g.tour['stop']:
            TT.go(g)
    raise AssertionError('le tour des IA ne finit pas')


class Campagne(unittest.TestCase):
    def test_tour_puis_sauvegarde(self):
        g = Game(GEO, '33', 'normal', 1, '1790')
        a = next(x for x in g.armies.values() if x['owner'] == g.player)
        x0, y0, d0 = a['x'], a['y'], g.date_str()
        ok, _ = g.order_move(g.player, a['id'], x0 + 40, y0 + 10)
        self.assertTrue(ok)
        TT.settle(g)
        self.assertNotEqual((a['x'], a['y']), (x0, y0), "votre tour : l'armée part tout de suite")
        self.assertEqual(g.date_str(), d0, 'votre tour : la date ne bouge pas')
        play_month(g)
        play_month(g)
        self.assertEqual(g.date().day, 1)
        self.assertTrue(TT.planning(g), "après le tour des IA, c'est de nouveau à vous")
        # aller-retour de sauvegarde : rien ne se perd
        d1 = json.loads(json.dumps(V.to_dict(g)))
        g2 = V.from_dict(GEO, d1)
        d2 = json.loads(json.dumps(V.to_dict(g2)))
        self.assertEqual(d1['t'], d2['t'])
        self.assertEqual(sorted(d1['armies']), sorted(d2['armies']))
        self.assertEqual([n['owner'] for n in d1['nodes']], [n['owner'] for n in d2['nodes']])
        self.assertEqual(d1['ai_state'], d2['ai_state'])

    def test_un_evenement_n_efface_pas_une_dette(self):
        class G:
            def __init__(s, liv):
                s.factions = {'24': {'res': {'livres': liv}}}
                s.nodes = []

            def owned_nodes(s, c):
                return []

            def __getattr__(s, k):
                return lambda *a, **kw: None
        for liv, fx, want in [(-1000, {'res': {'livres': -60}}, -1000), (-1000, {'res': {'livres': 40}}, -960),
                              (100, {'res': {'livres': -160}}, 0), (-1000, {'res_pct': {'livres': 0.2}}, -1000),
                              (100, {'res_pct': {'livres': 0.2}}, 120)]:
            g = G(liv)
            E.apply(g, '24', fx)
            self.assertAlmostEqual(g.factions['24']['res']['livres'], want, msg=(liv, fx))


class Bataille(unittest.TestCase):
    def test_escarmouche_jusqu_au_bout(self):
        g, bid = S.new(GEO, dict(me='33', foe='24', era='1790', units=dict(ligne=2, cavalerie=1, artillerie=1)))
        self.assertIsNotNone(bid)
        tb = g.tactical[bid]
        tb.start()
        tb.autofinish()
        tb.run_to_end()
        self.assertEqual(tb.phase, 'fin')
        for u in tb.units:
            self.assertTrue(u.men == 0 or u.men >= 8 or u.state == 'hors', (u.name, u.men, u.state))
        # sauvegarde en pleine bataille terminée : elle se recharge
        type(tb).from_dict(GEO, json.loads(json.dumps(tb.to_dict())))


class Serveur(unittest.TestCase):
    def setUp(self):
        self.saves = server.SAVES
        server.SAVES = tempfile.mkdtemp()

    def tearDown(self):
        server.SAVES = self.saves

    def app(self):
        app = server.App.__new__(server.App)
        app.game = None
        app.skirmish = None
        return app

    def test_sauvegarde_illisible_mise_de_cote(self):
        p = os.path.join(server.SAVES, server.AUTOSAVE + '.json')
        with open(p, 'w', encoding='utf-8') as f:
            f.write('{"game": {pas du json')
        app = self.app()
        app.load_autosave()
        self.assertFalse(os.path.exists(p), 'la prochaine sauvegarde automatique ne doit pas l’écraser')
        self.assertTrue(any('illisible' in n for n in os.listdir(server.SAVES)))

    def test_ecriture_sauvegarde(self):
        app = self.app()
        app.game = Game(GEO, '33', 'normal', 1, '1790')
        app.write_save(server.AUTOSAVE, auto=True)
        with open(os.path.join(server.SAVES, server.AUTOSAVE + '.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['meta']['player'], '33')

    def test_commandes_mal_formees(self):
        app = self.app()
        app.game = Game(GEO, '33', 'normal', 1, '1790')
        app.skirmish, bid = S.new(GEO, dict(me='33', foe='24', era='1790', units=dict(ligne=1)))
        for body in ['x', [], {}, {'cmd': 'move', 'army': 'a1', 'x': 'nan'}, {'cmd': 'move', 'army': [], 'x': 1e400},
                     {'cmd': 'tac', 'sub': 'deploy', 'bid': bid, 'x': 'a'}, {'cmd': 'tac', 'sub': 'order', 'bid': bid, 'units': 5}]:
            self.assertIsInstance(app.command(body), dict, body)


if __name__ == '__main__':
    unittest.main()
