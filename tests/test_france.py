"""Toute la France (SPEC-FRANCE.md) : la géographie 3, ses camps, une partie qui joue."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'outils'))

from game import rules as R
from game import views as V
from game.geo import GeoMap, NONE
from game.engine import Game

GEO = GeoMap()


class France(unittest.TestCase):
    def test_tous_les_departements_jouables(self):
        self.assertEqual(GEO.version, 3)
        self.assertEqual(len(GEO.playable_codes), 89)
        self.assertTrue({'33', '75', '69', '13', '20', '67'} <= GEO.playable_codes)
        for c in GEO.playable_codes:
            self.assertIn(c, R.FACTIONS, f'{c} sans camp')

    def test_un_chef_lieu_par_departement_dans_son_departement(self):
        caps = {}
        for n in GEO.nodes:
            if n['type'] == 'capitale':
                self.assertNotIn(n['dept'], caps, f"deux chefs-lieux dans le {n['dept']}")
                caps[n['dept']] = n
                self.assertEqual(GEO.dept_at(n['x'], n['y']), n['dept'], f"{n['name']} hors de son département")
        self.assertEqual(set(caps), GEO.playable_codes)
        self.assertEqual(caps['75']['name'], 'Paris')

    def test_plus_de_254_places(self):
        # (cellnode sur deux octets : 2 000 places et plus)
        self.assertGreater(len(GEO.nodes), 2000)
        vus = {v for v in GEO.cellnode if v != NONE}
        self.assertGreater(max(vus), 254)

    def test_toutes_les_places_rejoignent_paris(self):
        # (SPEC-FRANCE.md : les vallées des Alpes et des Pyrénées, le pays de Gex, les bourgs du rivage par la route ; Ré,
        # Oléron, Groix, Belle-Île, Noirmoutier par un bac ; la Corse et l'île d'Yeu par la mer seulement)
        def depuis_paris(eau):
            nb = {}
            for e in GEO.edges:
                if eau or e.get('kind') != 'water':
                    nb.setdefault(e['a'], set()).add(e['b']); nb.setdefault(e['b'], set()).add(e['a'])
            vus, pile = {GEO.by_name['Paris']}, [GEO.by_name['Paris']]
            while pile:
                for v in nb.get(pile.pop(), ()):
                    if v not in vus:
                        vus.add(v); pile.append(v)
            return vus
        self.assertEqual(len(depuis_paris(True)), len(GEO.nodes))
        route = depuis_paris(False)
        self.assertEqual({n['name'] for n in GEO.nodes if n['id'] not in route and n['dept'] != '20'}, {"L'Île-d'Yeu"})
        for nom in ('Soulac', 'Urdos', 'Laruns', 'Barcelonnette', 'Briançon', 'Divonne-les-Bains', 'Chamonix-Mont-Blanc',
                    'Ars-en-Ré', 'Groix', 'Le Palais', 'Zonza'):
            self.assertTrue(GEO.adj[GEO.by_name[nom]], nom)

    def test_le_sud_ouest_des_anciennes_parties_inchange(self):
        # (places, routes, voies d'eau et zones des places des géographies 1 et 2, calculées avant les routes des vallées)
        import hashlib
        import json
        for v, h in ((1, '76e4a833d55d4ec3b68871489dfb6765846f7271'), (2, 'fba6051100642cec6bb6c307ef2d586f7e23487a')):
            g = GeoMap(v)
            blob = json.dumps([g.edges, g.nodes, list(g.cellnode)], sort_keys=True).encode()
            self.assertEqual(hashlib.sha1(blob).hexdigest(), h, f'géographie {v}')

    def test_ancienne_sauvegarde_aux_aretes_renumerotees(self):
        # une partie sauvegardée avant que les arêtes changent de numéros (voies d'eau, routes des vallées) : armées en marche
        # sur la route et en bateau sur la côte ; elle se recharge (views.recaler) et joue un mois
        import json
        import math
        import simuler as S
        from game import views as V
        from game.ai import AI
        g = Game(GEO, '76', 'normal', 1, '1790')
        route, bateau, perdue = [a for a in g.armies.values() if a['owner'] != '20'][:3]
        havre = GEO.by_name['Le Havre']
        mer = next(GEO.edges[i] for i in GEO.adj[havre] if GEO.edges[i].get('way') == 'Ponant')
        for a in (route, bateau, perdue):
            cap = g.capital_of(a['owner'])
            e, frm = (mer, havre) if a is bateau else (GEO.edges[GEO.adj[cap][0]], cap)
            a.update(at_node=None, state='move', boat=a is bateau, edge=dict(e=e['id'], frm=frm, pos=e['len'] / 2))
            a['x'], a['y'] = g.edge_xy(e, frm, e['len'] / 2)
            but = GEO.by_name['Fécamp'] if a is bateau else next(n['id'] for n in g.owned_nodes(a['owner']) if n['id'] != cap)
            a['target'] = dict(node=but)
            a['path'] = g.plan_route(a, but, frozenset())
            self.assertTrue(a['path'])
        avant = {a['id']: (a['edge']['e'], a['edge']['pos'], a['path'][-1]['to']) for a in (route, bateau)}
        d = json.loads(json.dumps(V.to_dict(g)))
        self.assertEqual(d.pop('graphe'), GEO.empreinte)
        n = len(GEO.edges)
        for a in d['armies'].values():   # l'ancienne numérotation
            if a.get('edge'):
                a['edge']['e'] = (a['edge']['e'] + 101) % n
            for l in a['path']:
                if l['kind'] == 'road':
                    l['e'] = (l['e'] + 101) % n
        d['armies'][perdue['id']]['x'] += 5   # (son arête n'existe plus : rien ne passe là où elle était)
        g2 = V.from_dict(GEO, d)

        def valides(ici=True):   # (ici : au point de son arête ; après un mois, une bataille la déporte)
            for a in g2.armies.values():
                if a.get('edge'):
                    e = GEO.edges[a['edge']['e']]
                    self.assertIn(a['edge']['frm'], (e['a'], e['b']))
                    self.assertLess(0 if not ici else math.dist(g2.edge_xy(e, a['edge']['frm'], a['edge']['pos']), (a['x'], a['y'])), 0.05)
                for l in a['path']:
                    if l['kind'] == 'road':
                        self.assertEqual({l['frm'], l['to']}, {GEO.edges[l['e']]['a'], GEO.edges[l['e']]['b']})
        valides()
        for aid, (e, pos, fin) in avant.items():   # (sur la même arête, au même endroit, vers la même place)
            a = g2.armies[aid]
            self.assertEqual((a['edge']['e'], a['edge']['pos'], a['path'][-1]['to']), (e, pos, fin))
        p = g2.armies[perdue['id']]
        self.assertEqual((p['edge'], p['at_node']), (None, g.capital_of(perdue['owner'])))
        self.assertTrue(p['path'])   # (son chemin recalculé vers sa destination)
        g2.ais[g2.player] = AI(g2, g2.player)
        S.play_month(g2)
        self.assertEqual(g2.date().month, 4)
        valides(False)

    def test_une_partie_de_france_joue_un_mois(self):
        import simuler as S
        from game.ai import AI
        g = Game(GEO, '69', 'normal', 3, '1790')
        self.assertEqual(len(g.factions), 89)
        g.ais[g.player] = AI(g, g.player)
        S.play_month(g)
        self.assertEqual(g.date().month, 4)
        self.assertTrue(all(f['alive'] for f in g.factions.values()))

    def test_ia_allegee_des_camps_lointains(self):
        # (SPEC-FRANCE.md : un camp loin du joueur réfléchit une fois par semaine et joue quand même ; un voisin, ou un
        # camp en guerre avec lui, garde l'IA complète)
        g = Game(GEO, '33', 'normal', 3, '1790')
        self.assertFalse(g.ia_lointaine('24'))   # la Dordogne, voisine
        self.assertTrue(g.ia_lointaine('67'))    # le Bas-Rhin
        self.assertEqual((g.ai_pas('24'), g.ai_pas('67')), (1.5, 6.0))
        pas = {'24': [], '67': []}
        for c, t in pas.items():
            ai = g.ais[c]
            ai.step = (lambda ai=ai, t=t, step=ai.step: (t.append(g.t), step()))
        places = len(g.owned_nodes('67'))
        while g.t < 20:
            g.step(0.1)
        self.assertGreaterEqual(len(pas['24']), 12)
        self.assertTrue(3 <= len(pas['67']) <= 4, pas['67'])
        self.assertGreater(len(g.owned_nodes('67')), places)   # il rallie ses villages
        # la guerre déclarée au joueur le réveille dans le quart de journée, et il reprend le pas complet
        g.set_status('33', '67', 'guerre')
        n = len(pas['67'])
        while g.t < 20.3:
            g.step(0.05)
        self.assertEqual(len(pas['67']), n + 1)
        self.assertEqual(g.ai_pas('67'), 1.5)

    def test_les_ia_se_font_la_guerre(self):
        # (SPEC-FRANCE.md, « Guerres entre les IA » : un accord de commerce avec presque chaque camp rendait tout le
        # monde ami, et riche à 200 000 livres ; quatre accords au plus, les voisins se brouillent et se font la guerre)
        import statistics
        from game import diplomacy as D
        g = Game(GEO, '33', 'normal', 1, '1790')
        for n, gn in zip(g.nodes, GEO.nodes):   # la course aux villages faite : chacun tient son département
            if n['owner'] not in g.factions and gn['dept'] in g.factions:
                n['owner'] = gn['dept']
        g._own_ver += 1
        codes = sorted(g.factions)
        for _ in range(37):   # un an de diplomatie (une tous les dix jours), sans les armées
            g.t += 10
            for c in codes:
                if c != g.player:
                    g.ais[c].diplomacy()
        self.assertLessEqual(max(len(f['trade']) for f in g.factions.values()), R.TRADE_MAX)
        rel = [g.factions[a]['rel'][b] for a in codes for b in codes if a != b and D.borders(g, a, b)]
        self.assertLess(statistics.median(rel), -10)   # (+5 avec un accord de commerce avec chacun)
        self.assertGreaterEqual(sum(g.at_war(a, b) for i, a in enumerate(codes) for b in codes[i + 1:]), 3)
        # un cinquième accord est refusé ; une partie d'avant la règle ne garde que ses quatre meilleurs accords
        f = g.factions['67']
        f['trade'] = {o: True for o in codes[:12] if o != '67'}
        for o in f['trade']:
            g.factions[o]['trade']['67'] = True
        moi = g.factions[g.player]
        moi['trade'] = {o: True for o in codes[-10:] if o != g.player}
        for o in moi['trade']:
            g.factions[o]['trade'][g.player] = True
        V.migrate(g)
        self.assertLessEqual(len(f['trade']), R.TRADE_MAX)   # (ses partenaires, déjà à quatre, ont pu le laisser)
        self.assertEqual(len(moi['trade']), R.TRADE_MAX)   # le joueur aussi, et ses accords gardés le restent des deux côtés
        self.assertTrue(all(g.player in g.factions[o]['trade'] for o in moi['trade']))
        self.assertLessEqual(max(len(x['trade']) for x in g.factions.values()), R.TRADE_MAX)
        autre = next(o for o in codes if o != '67' and o not in f['trade'] and g.status('67', o) != 'guerre')
        self.assertFalse(D.act(g, '67', autre, 'commerce')[0])

    def test_treve_courte_pour_un_vaincu_bien_plus_petit(self):
        # (SPEC-FRANCE.md, « Guerres décisives et armées actives » : de deux à cinq ans selon la taille du vaincu face à
        # son vainqueur, au lieu de cinq ans toujours)
        from game import diplomacy as D
        g = Game(GEO, '33', 'normal', 1, '1790')
        for n, gn in zip(g.nodes, GEO.nodes):   # chacun tient son département, la Gironde aussi les Landes et le Lot-et-Garonne
            if n['owner'] not in g.factions and gn['dept'] in g.factions:
                n['owner'] = gn['dept']
            if gn['dept'] in ('40', '47'):
                n['owner'] = '33'
        g._own_ver += 1
        g.factions['24']['pic'] = len(g.owned_nodes('24'))
        D.declare_war(g, '33', '24', quiet=True)
        petit, grand = len(g.owned_nodes('24')), len(g.owned_nodes('33'))
        g.capture(g.capital_of('24'), '33')
        self.assertTrue(g.factions['24']['alive'])
        treve = (g.factions['24']['truce']['33'] - g.t) / 365
        self.assertLess(petit * 2, grand)
        self.assertAlmostEqual(treve, max(2, min(5, 10 * petit / grand)), delta=0.15)

    def test_deux_defaites_en_25_ans_quel_que_soit_le_vainqueur_s_il_a_perdu_le_quart(self):
        from game import diplomacy as D
        g = Game(GEO, '33', 'normal', 1, '1790')
        f = g.factions['24']
        f['treaties'] = {'87': g.t - 3 * 365}   # (la Haute-Vienne l'a fait plier il y a trois ans)
        f['pic'] = 2 * len(g.owned_nodes('24'))   # et il a perdu plus du quart de ce qu'il a tenu
        D.declare_war(g, '33', '24', quiet=True)
        g.capture(g.capital_of('24'), '33')
        self.assertFalse(f['alive'])
        f = g.factions['19']   # la Corrèze, elle aussi vaincue il y a trois ans, mais qui a gardé ce qu'elle tenait
        f['treaties'] = {'87': g.t - 3 * 365}
        D.declare_war(g, '33', '19', quiet=True)
        g.capture(g.capital_of('19'), '33')
        self.assertTrue(f['alive'])

    def test_le_sud_ouest_garde_l_ia_complete(self):
        from fabrique import partie
        g = partie('33')
        self.assertFalse(any(g.ia_lointaine(c) for c in g.factions))
        self.assertFalse(g.bataille_proche())

    def test_plus_proche_place(self):
        import math
        import random
        from game.ai import nearest_dist
        rng = random.Random(1)
        for _ in range(50):
            pts = [(rng.uniform(0, 900), rng.uniform(0, 900)) for _ in range(rng.randint(1, 80))]
            near = nearest_dist(pts)
            for _ in range(10):
                x, y = rng.uniform(-200, 1100), rng.uniform(-200, 1100)
                self.assertEqual(near(x, y), min(math.hypot(x - a, y - b) for a, b in pts))


if __name__ == '__main__':
    unittest.main()
