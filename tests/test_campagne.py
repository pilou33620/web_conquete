"""Banc d'essai de la campagne : tour par tour, marche, retraite, sièges, événements, sauvegarde.

    python3 tests/test_campagne.py

POURQUOI CE BANC EXISTE. Un mois de jeu se joue en 15 secondes à l'écran, mais une règle de campagne (jours de
marche, retraite, dettes, sauvegarde des IA) ne se vérifie qu'au bout de plusieurs mois. Ici : une partie neuve
(fabrique.partie), un ordre, un mois joué en une seconde (jouer_mois). Bugs déjà rattrapés, à ne pas revoir :
- une armée en retraite repartait de 4 jours à chaque ordre donné, et marchait pendant le tour des IA ;
- un siège commencé au bout d'une marche était daté dans le futur (famine retardée) ;
- un événement effaçait la dette d'une faction en banqueroute ;
- l'état des IA (impôts, dépenses) n'était qu'à moitié sauvegardé.
"""
import json
import unittest

from fabrique import GEO, TT, armee, jouer_mois, partie
from game import diplomacy as D
from game import events as E
from game import rules as R
from game import views as V
from game.tactics import bridge as TB


def jouer_reste(g):
    """Finit le tour des IA en cours ; renvoie le genre des arrêts rencontrés (acceptés d'office)."""
    kinds = []
    for _ in range(300):
        if g.tour['end'] is None:
            break
        TT.advance(g, 0.1)
        if g.tour['stop'] and not g.speed_idx:
            kinds.append(g.tour['stop']['kind'])
            for bt in list(g.battles.values()):
                if bt.get('mode') == 'attente':
                    TB.command(g, dict(sub='choose', bid=bt['id'], mode='auto'))
            TT.go(g)
    return kinds


class TourParTour(unittest.TestCase):
    def test_votre_tour_puis_celui_des_ia(self):
        g = partie()
        a = armee(g)
        x0, y0, d0 = a['x'], a['y'], g.date_str()
        self.assertTrue(g.order_move(g.player, a['id'], x0 + 40, y0 + 10)[0])
        TT.settle(g)
        self.assertNotEqual((a['x'], a['y']), (x0, y0), "votre tour : l'armée part tout de suite")
        self.assertEqual(g.date_str(), d0, 'votre tour : la date ne bouge pas')
        jouer_mois(g, 2)
        self.assertEqual(g.date().day, 1)
        self.assertTrue(TT.planning(g), "après le tour des IA, c'est de nouveau à vous")
        for n in g.nodes:   # sièges commencés en chemin : datés au plus tard d'aujourd'hui
            if n.get('siege'):
                self.assertLessEqual(n['siege']['since'], g.t + 1e-6)

    def test_le_tour_des_ia_se_joue_d_un_coup(self):
        g = partie()
        TT.go(g)
        for n in range(1, 200):
            TT.advance(g, 0.1)   # un appel de la boucle du serveur (toutes les 0,1 s)
            if g.tour['stop']:
                TT.go(g)
            if g.tour['end'] is None:
                break
        self.assertEqual(g.date().day, 1)
        self.assertLess(n, 30, "le mois des IA se calcule aussi vite que possible, pas au rythme de 15 s")

    def test_plus_de_rythme(self):
        g = partie()
        g.tour['pace'] = 'lent'   # ancienne sauvegarde
        TT.migrate(g)
        self.assertNotIn('pace', g.tour)
        self.assertNotIn('pace', TT.view(g))
        self.assertFalse(TT.command(g, 'pace', 'lent')[0])

    def test_une_attaque_contre_vous_arrete_le_tour_des_ia_puis_il_reprend(self):
        g = partie()
        a = armee(g)
        b = armee(g, '24')
        D.declare_war(g, '24', g.player, quiet=True)
        b['x'], b['y'] = a['x'] + 1.0, a['y']   # au contact : la bataille s'engage au premier pas
        g.order_move('24', b['id'], a['x'], a['y'])
        TT.go(g)
        for _ in range(50):
            TT.advance(g, 0.1)
            if g.tour['stop']:
                break
        self.assertEqual(g.tour['stop']['kind'], 'bataille')
        bt = next(bt for bt in g.battles.values() if bt.get('mode') == 'attente')
        self.assertTrue(TB.command(g, dict(sub='choose', bid=bt['id'], mode='auto'))['ok'])
        TT.advance(g, 0.1)
        st = g.tour['stop']
        self.assertTrue(g.speed_idx or (st and st.get('sel') != ['battle', bt['id']]),
                        'le choix fait, le tour des IA reprend tout seul (sans « Continuer »)')
        self.assertEqual(set(jouer_reste(g)) - {'bataille'}, set(), "seules d'autres attaques l'arrêtent encore")
        self.assertEqual(g.date().day, 1)

    def test_une_decision_arrete_le_tour_des_ia_puis_il_reprend(self):
        g = partie()
        TT.go(g)
        g.pending_ev.append(dict(id='e1', ev='essai', kind='hist', title='Les états généraux', text='', town=None,
                                 base='', until=g.t + 30, date=g.date_str(),
                                 choices=[dict(label='Oui', fx={}, desc=[])]))
        TT.advance(g, 0.1)
        self.assertEqual(g.tour['stop']['kind'], 'decision')
        self.assertTrue(E.resolve(g, 'e1', 0)[0])
        TT.advance(g, 0.1)
        self.assertTrue(g.speed_idx or g.tour['stop']['kind'] != 'decision', 'la décision prise, le tour reprend seul')

    def test_une_guerre_n_arrete_plus_le_tour_des_ia(self):
        g = partie()
        TT.go(g)
        D.declare_war(g, '24', g.player)
        kinds = jouer_reste(g)
        self.assertNotIn('guerre', kinds)
        self.assertTrue(any('guerre' in f['text'] for f in g.tour['recap']['facts']), 'la guerre est dans le récap')

    def test_les_armees_ennemies_sur_vos_terres_sont_dans_le_recap(self):
        g = partie()
        b = armee(g, '24')
        D.declare_war(g, '24', g.player, quiet=True)
        cap = next(n for n in g.owned_nodes(g.player))
        b['x'], b['y'] = g.node_xy(cap['id'])[0] + 3, g.node_xy(cap['id'])[1]
        if g.geo.node_of_cell(b['x'], b['y']) != cap['id']:
            b['x'], b['y'] = g.node_xy(cap['id'])
        g.tour['acc'] = TT._new_acc(g)
        foes = TT._recap(g)['foes']
        self.assertEqual([f['id'] for f in foes], [b['id']])

    def test_plus_de_marche_plus_de_mouvement(self):
        g = partie()
        a = armee(g)
        a['mp'] = 0.0   # jours de marche du mois épuisés
        x0, y0 = a['x'], a['y']
        g.order_move(g.player, a['id'], x0 + 40, y0 + 10)
        TT.settle(g)
        self.assertEqual((a['x'], a['y']), (x0, y0))

    def test_ordres_de_marche_bloques_pendant_le_tour_des_ia(self):
        g = partie()
        self.assertIsNone(TT.lock_reason(g))
        g.tour['end'] = TT.month_end(g)   # le tour des IA a commencé
        self.assertIn('tour des IA', TT.lock_reason(g))

    def test_retraite_une_fois_par_tour(self):
        g = partie()
        a = armee(g)
        g.order_move(g.player, a['id'], a['x'] + 40, a['y'] + 10)   # loin de chez elle (une retraite a où aller)
        TT.settle(g)
        self.assertTrue(g.order_retreat(g.player, a['id'])[0])
        TT.settle(g)
        p1 = (a['x'], a['y'])
        TT.settle(g)   # un nouvel ordre ailleurs ne la fait pas repartir
        self.assertEqual((a['x'], a['y']), p1)
        self.assertTrue(a['rt'])
        self.assertEqual(a['mp'], 0.0)
        jouer_mois(g)
        self.assertFalse(a['rt'], 'nouveau tour : la retraite est de nouveau possible')


class Regles(unittest.TestCase):
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
            with self.subTest(livres=liv, effet=fx):
                g = G(liv)
                E.apply(g, '24', fx)
                self.assertAlmostEqual(g.factions['24']['res']['livres'], want)

    def test_prix_du_marche_une_seule_source(self):
        g = partie()
        self.assertEqual(g.market, R.MARKET_BASE)


class Sauvegarde(unittest.TestCase):
    def test_aller_retour(self):
        g = partie()
        jouer_mois(g)
        g.ais['24'].relief = 0.1   # une IA qui a baissé ses impôts…
        d1 = json.loads(json.dumps(V.to_dict(g)))
        g2 = V.from_dict(GEO, d1)
        self.assertEqual(g2.ais['24'].relief, 0.1)   # … les garde après un chargement
        d2 = json.loads(json.dumps(V.to_dict(g2)))
        self.assertEqual(d1['t'], d2['t'])
        self.assertEqual(sorted(d1['armies']), sorted(d2['armies']))
        self.assertEqual([n['owner'] for n in d1['nodes']], [n['owner'] for n in d2['nodes']])
        self.assertEqual(d1['ai_state'], d2['ai_state'])


if __name__ == '__main__':
    unittest.main()
