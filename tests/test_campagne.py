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
import math
import unittest

from fabrique import GEO, TT, armee, jouer_mois, partie
from game import diplomacy as D
from game import army_actions as AA
from game import cities as CT
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

    def test_deux_decisions_au_meme_moment(self):
        g = partie()
        TT.go(g)
        for i in (1, 2):
            g.pending_ev.append(dict(id=f'e{i}', ev='essai', kind='hist', title=f'Décision {i}', text='', town=None,
                                     base='', until=g.t + 30, date=g.date_str(),
                                     choices=[dict(label='Oui', fx={}, desc=[])]))
        TT.advance(g, 0.1)
        self.assertEqual(g.tour['stop']['ev'], 'e1')
        E.resolve(g, 'e1', 0)
        TT.advance(g, 0.1)
        self.assertEqual((g.speed_idx, g.tour['stop']['ev']), (0, 'e2'), 'la seconde arrête aussi le tour')
        E.resolve(g, 'e2', 0)
        TT.advance(g, 0.1)
        self.assertTrue(g.speed_idx or g.tour['stop']['kind'] != 'decision')

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

    def test_une_ville_neutre_se_rallie_pendant_votre_tour(self):
        g = partie()
        a = armee(g)
        D.declare_war(g, g.player, '24', quiet=True)
        ids = {gn['name']: i for i, gn in enumerate(g.geo.nodes)}
        foy, berg = ids['Sainte-Foy-la-Grande'], ids['Bergerac']
        self.assertEqual(g.nodes[foy]['owner'], R.NEUTRAL)
        d0 = g.date_str()
        self.assertTrue(g.order_move(g.player, a['id'], *g.node_xy(berg))[0])
        TT.settle(g)
        self.assertEqual(a['at_node'], foy, "en chemin vers Bergerac, l'armée s'arrête à Sainte-Foy…")
        self.assertEqual(a['ask']['node'], foy, '… et attend le choix du joueur (évolution du 18/10/2026)')
        self.assertEqual(g.date_str(), d0)
        self.assertTrue(a['ask']['path'], 'la route vers Bergerac est gardée')

    def test_arrivee_annoncee(self):
        g = partie()
        a = armee(g)
        a['mp'] = 1.0   # presque plus de marche ce tour
        a['tr'] = True
        self.assertTrue(g.order_move(g.player, a['id'], a['x'] + 40, a['y'] + 10)[0])
        TT.settle(g)
        self.assertTrue(a['path'])
        self.assertEqual(TT.eta(g, a), 1, 'arrivée annoncée au prochain tour')
        jouer_mois(g)   # au début du tour suivant, l'armée repart
        self.assertFalse(a['path'], "elle est arrivée au tour annoncé")

    def test_rallier_apres_une_halte(self):
        g = partie()
        a = armee(g)
        nid = min((n['id'] for n in g.nodes if n['owner'] == R.NEUTRAL), key=g.node_defense_power)   # la plus faible
        a['at_node'], a['path'], a['state'], a['hold'] = nid, [], 'idle', True   # halte devant ses portes
        a['x'], a['y'] = g.node_xy(nid)
        ok, msg = AA.conquer(g, g.player, a)
        self.assertTrue(ok, msg)
        self.assertEqual(a['ask']['node'], nid, '« Rallier ou attaquer » rouvre le choix (évolution du 18/10/2026)')
        self.assertTrue(AA.choose(g, g.player, a, 'attendre')[0])
        jouer_mois(g)
        a['tr'] = True   # retour chez soi, sans rallier d'autres places en chemin
        self.assertTrue(g.order_move(g.player, a['id'], *g.node_xy(g.capital_of(g.player)))[0])
        TT.settle(g)
        self.assertFalse(a['path'], "au tour suivant, elle marche jusqu'au bout (pas arrêtée au premier pas)")

    def test_premier_tour_entame_marche_reduite(self):
        g = partie()   # 4 mars : 28 jours jusqu'au 1er avril
        self.assertEqual(TT.march_days(g), 28.0)
        jouer_mois(g)
        self.assertEqual(TT.march_days(g), 30.0, 'avril, un tour entier')

    def test_arrivee_estimee_sur_la_vraie_route(self):
        g = partie()
        a = armee(g)
        far = max((n['id'] for n in g.nodes), key=lambda i: math.dist(g.node_xy(i), (a['x'], a['y'])))
        near = min((n['id'] for n in g.nodes if n['id'] != a['at_node']), key=lambda i: math.dist(g.node_xy(i), (a['x'], a['y'])))
        a['mp'] = 1.0
        tn, msg = TT.preview(g, g.player, a['id'], None, None, far, 'route')
        self.assertGreaterEqual(tn, 1, msg)
        self.assertEqual((a['path'], a['mp']), ([], 1.0), "une estimation ne donne aucun ordre")
        a['mp'] = None
        self.assertEqual(TT.preview(g, g.player, a['id'], None, None, near, 'route')[0], 0, 'arrivée ce tour-ci')
        self.assertIsNone(TT.preview(g, g.player, 'a999', 10, 10, None, 'route')[0])

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
        a['tr'] = True   # traverse sans rallier les places neutres : elle reste loin de chez elle
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


def au(g, y, m, d=1):
    """Place la partie à cette date, 0 h (sans jouer les jours qui précèdent)."""
    import datetime
    g.t = float(datetime.date(y, m, d).toordinal() - g.start_ord)


class TempsEnTours(unittest.TestCase):
    """1 tour = 1 mois. Une durée de N tours laisse au joueur N tours entiers, et finit pile au début d'un tour."""

    def test_echeance_pendant_votre_tour(self):
        g = partie()   # 4 mars 1790, votre premier tour
        self.assertEqual(g.date_str(TT.deadline(g, 1)), '1er avril 1790', 'fin de ce tour')
        self.assertEqual(g.date_str(TT.deadline(g, 4)), '1er juillet 1790')
        au(g, 1790, 12)
        self.assertEqual(g.date_str(TT.deadline(g, 2)), '1er février 1791')

    def test_echeance_pendant_le_tour_des_ia(self):
        g = partie()
        TT.go(g)
        au(g, 1790, 3, 20)   # au milieu du tour des IA de mars
        self.assertEqual(g.date_str(TT.deadline(g, 1)), '1er mai 1790', "vous avez encore tout votre tour d'avril")

    def test_tours_restants(self):
        g = partie()
        self.assertEqual(TT.tours_left(g, TT.deadline(g, 1)), 1)
        self.assertEqual(TT.tours_left(g, TT.deadline(g, 3)), 3)
        au(g, 1790, 4)
        self.assertEqual(TT.tours_left(g, g.t + 12.5), 1, 'fini pendant ce tour des IA : vu au prochain tour')
        self.assertEqual(TT.tours_left(g, g.t + 40), 2)
        self.assertEqual(TT.tours_left(g, g.t), 0)

    def test_debut_de_tour_suivant(self):
        g = partie()
        au(g, 1790, 4, 12)
        self.assertEqual(g.date_str(TT.turn_start_after(g, g.t)), '1er mai 1790')
        au(g, 1790, 5)
        self.assertEqual(g.date_str(TT.turn_start_after(g, g.t)), '1er mai 1790', 'déjà au début d\'un tour')

    def test_un_tour_de_travail_quelle_que_soit_la_longueur_du_mois(self):
        g = partie()
        au(g, 1791, 3)
        self.assertAlmostEqual(TT.work(g, 28), TT.TOUR_DAYS, 'le mois de février qui vient de passer')
        au(g, 1791, 4)
        self.assertAlmostEqual(TT.work(g, 31), TT.TOUR_DAYS, 'le mois de mars')


class Production(unittest.TestCase):
    """Règle A : une ville fait un mois de travail par tour ; sa file avance dans l'ordre, le surplus passe au suivant."""

    def lever(self, g, k, days=6.0):
        n = next(n for n in g.owned_nodes(g.player) if n['id'] == g.capital_of(g.player))
        n['queue'] = [dict(kind='unit', what='ligne', left=days, total=days) for _ in range(k)]
        return n

    def test_cinq_regiments_d_un_cinquieme_de_tour(self):
        g = partie()
        jouer_mois(g)   # 1er avril : un tour entier devant soi
        n = self.lever(g, 5)
        self.assertEqual([TT.ready_in(g, 6.0 * (i + 1)) for i in range(5)], [1] * 5, 'tous annoncés au prochain tour')
        g0 = len(n['garrison'])
        jouer_mois(g)
        self.assertEqual(n['queue'], [])
        self.assertEqual(len(n['garrison']) - g0, 5)

    def test_le_surplus_passe_au_suivant(self):
        g = partie()
        jouer_mois(g)
        n = self.lever(g, 29, days=1.01)   # 29,3 jours de travail : un tour, sans rien perdre entre deux éléments
        jouer_mois(g)
        self.assertEqual(n['queue'], [])

    def test_premier_tour_entame(self):
        g = partie()   # 4 mars : il ne reste que 28 jours de mars
        n = self.lever(g, 5)
        self.assertEqual([TT.ready_in(g, 6.0 * (i + 1)) for i in range(5)], [1, 1, 1, 1, 2])
        jouer_mois(g)
        self.assertEqual(len(n['queue']), 1, 'le cinquième est pour le tour suivant, comme annoncé')
        jouer_mois(g)
        self.assertEqual(n['queue'], [])

    def test_deux_chantiers_de_24_jours(self):
        g = partie()
        self.lever(g, 2, days=24.0)
        self.assertEqual([TT.ready_in(g, 24.0), TT.ready_in(g, 48.0)], [1, 2])


class RechercheEtPolitiques(unittest.TestCase):
    def test_technologies_en_tours_entiers(self):
        for t in R.TECH.values():
            self.assertIn(t['days'], (30, 60, 90), t['id'])

    def test_une_technologie_d_un_tour_est_decouverte_au_tour_suivant(self):
        g = partie()
        jouer_mois(g)   # 1er avril
        f = g.factions[g.player]
        f['res']['livres'] = 1e5
        t = next(t for t in R.TECH.values() if t['days'] == 30 and t['id'] not in f['techs'] and not f['research'][t['branch']]
                 and all(r in f['techs'] for r in t['req']) and R.TECH_YEAR.get(t['id'], 0) <= g.date().year
                 and {x[0]: x[5] for x in R.TECHS}[t['id']] == 42)
        self.assertTrue(g.research(g.player, t['id'])[0])
        jouer_mois(g)
        self.assertIn(t['id'], f['techs'], '42 jours devenus un tour : découverte au tour suivant')

    def test_politique_en_place_au_prochain_tour(self):
        g = partie()
        n = next(n for n in g.owned_nodes(g.player))
        k = next(k for k in CT.POLICIES if k != 'equilibre')
        self.assertTrue(CT.set_policy(g, g.player, n['id'], k)[0])
        self.assertEqual(n['pol']['u'], TT.deadline(g, 1))
        jouer_mois(g)
        self.assertEqual(CT.policy_w(g, n), 1.0)

    def test_ancienne_politique_en_jours(self):
        g = partie()
        n = next(n for n in g.owned_nodes(g.player))
        au(g, 1790, 4, 20)
        n['pol'] = dict(k='equilibre', p='equilibre', t=g.t - 5, o=g.player)   # sauvegarde d'avant les tours
        self.assertLess(CT.policy_w(g, n), 1.0)
        au(g, 1790, 6)
        self.assertEqual(CT.policy_w(g, n), 1.0, 'les 18 jours (jusqu\'au 3 mai) finis au début du tour suivant')


class EcheancesEnTours(unittest.TestCase):
    """Règle B : trêves, droits de passage, propositions, décisions et effets d'événements en tours entiers."""

    def test_treve_de_quatre_tours(self):
        g = partie()   # 4 mars 1790, votre tour
        D.declare_war(g, g.player, '24', quiet=True)
        D.make_peace(g, g.player, '24')
        self.assertEqual(g.date_str(g.factions[g.player]['truce']['24']), '1er juillet 1790')

    def test_droit_de_passage_de_douze_tours(self):
        g = partie()
        AA.grant_passage(g, '24', g.player)
        self.assertEqual(g.date_str(g.factions['24']['passage'][g.player]), '1er mars 1791')

    def test_proposition_recue_pendant_le_tour_des_ia(self):
        g = partie()
        TT.go(g)
        au(g, 1790, 3, 20)
        n = len(g.proposals)
        D.act(g, '24', g.player, 'commerce')
        self.assertEqual(len(g.proposals), n + 1)
        self.assertEqual(g.date_str(g.proposals[-1]['expires']), '1er mai 1790', 'tout votre tour d\'avril pour répondre')

    def test_decision_d_un_tour(self):
        g = partie()
        E.fire(g, g.player, dict(id='essai', title='Essai', text='', choices=[dict(label='Oui', fx={}),
                                                                             dict(label='Non', fx={})]), 'hist')
        self.assertEqual(g.date_str(g.pending_ev[-1]['until']), '1er avril 1790')

    def test_anciennes_echeances_ramenees_au_debut_d_un_tour(self):
        g = partie()
        g.factions[g.player]['truce']['24'] = g.t + 50.5   # 23 avril 1790 et des poussières
        TT.migrate(g)
        self.assertEqual(g.date_str(g.factions[g.player]['truce']['24']), '1er mai 1790')


class ActionsEnTours(unittest.TestCase):
    def test_delai_d_attente_en_tours(self):
        g = partie()   # 4 mars 1790
        n = next(n for n in g.owned_nodes(g.player))
        AA.set_cd(g, n, 'req', AA.REQ_CD, g.player)
        self.assertEqual(AA.cd_left(g, n, 'req'), 4, 'quatre tours, celui-ci compris')
        m = next(n for n in g.owned_nodes('24'))
        AA.set_cd(g, m, 'req', AA.REQ_CD, '24')
        self.assertAlmostEqual(m['aa']['cd']['req'], g.t + 120, msg="une IA garde son rythme d'avant (120 jours)")
        au(g, 1790, 7)
        self.assertEqual(AA.cd_left(g, n, 'req'), 0, 'fini au début du 4e tour suivant')

    def test_ralliement_negocie_au_tour_suivant(self):
        g = partie()
        a = armee(g)
        nid = next(n['id'] for n in g.nodes if n['owner'] == R.NEUTRAL)
        a['at_node'], a['path'], a['state'], a['hold'] = nid, [], 'idle', True   # halte devant ses portes
        a['x'], a['y'] = g.node_xy(nid)
        g.factions[g.player]['res']['livres'] = 1e5
        ok, msg = AA.negotiate(g, g.player, a)
        self.assertTrue(ok, msg)
        self.assertIn('au prochain tour', msg)
        g.nodes[nid]['aa']['ng']['risk'] = 0.0
        jouer_mois(g)
        self.assertEqual(g.nodes[nid]['owner'], g.player)

    def test_espion_rapport_au_tour_suivant_valable_deux_tours(self):
        g = partie()
        nid = next(n['id'] for n in g.nodes if n['owner'] == '24')
        g.factions[g.player]['res']['livres'] = 1e5
        self.assertTrue(g.spy(g.player, nid, 'espionner')[0])
        s = g.spies[-1]
        self.assertEqual(g.date_str(s['done']), '1er avril 1790')
        TT.go(g)
        g.t = s['done'] + 1e-9   # le dernier pas du tour des IA, qui franchit minuit
        g.rng.random = lambda: 0.0
        g.update_spies()
        self.assertEqual(g.date_str(g.factions[g.player]['intel'][str(nid)]), '1er juin 1790', 'avril et mai')


class SiegesEnTours(unittest.TestCase):
    """Règle C : vitesse des sièges inchangée, brèche et vivres annoncés en tours, et l'annonce est tenue."""

    def assieger(self):
        g = partie()
        a = armee(g)
        D.declare_war(g, g.player, '24', quiet=True)
        nid = {gn['name']: i for i, gn in enumerate(g.geo.nodes)}['Bergerac']
        n = g.nodes[nid]
        a['at_node'], a['path'], a['state'] = nid, [], 'siege'
        a['x'], a['y'] = g.node_xy(nid)
        n['siege'] = dict(by=g.player, dmg=0.0, since=g.t)
        return g, n

    def test_breche_annoncee(self):
        g, n = self.assieger()
        sg = next(d for d in V.player_state(g)['nodes'] if d['id'] == n['id'])['sg']
        self.assertGreaterEqual(sg['br'], 1)
        for _ in range(sg['br']):
            if n['siege'] is None or n['siege']['dmg'] >= 0.85:
                break
            jouer_mois(g)
        self.assertTrue(n['siege'] is None or n['siege']['dmg'] >= 0.85 or n['owner'] == g.player,
                        'brèche ouverte (ou place prise) au tour annoncé')

    def test_place_a_remparts_pendant_votre_tour(self):
        # (rapport du 18/10/2026 : « en plein tour, il ne propose pas la bataille, en fin de tour oui ») : la place à
        # remparts est assiégée, pas attaquée, et la bulle dit comment l'attaquer tout de suite ; l'assaut demandé
        # pendant le tour attend aussitôt le choix du joueur
        g = partie()
        a = armee(g)
        D.declare_war(g, g.player, '24', quiet=True)
        nid = {gn['name']: i for i, gn in enumerate(g.geo.nodes)}['Bergerac']
        self.assertTrue(AA.walled(g.nodes[nid]))
        x, y = g.node_xy(nid)
        a['x'], a['y'], a['at_node'], a['edge'], a['tr'] = x + 3, y, None, None, False
        self.assertTrue(g.order_move(g.player, a['id'], x, y)[0])
        TT.settle(g)
        # (évolution du 18/10/2026 : à l'arrivée, le joueur choisit ; « Assiéger » mène au siège, voir T2)
        self.assertEqual(a['ask']['node'], nid)
        self.assertFalse(g.battles)
        self.assertIsNone(g.nodes[nid]['siege'])

    def test_blocus_en_tours(self):
        g, n = self.assieger()
        n['siege'].update(blocus=True, food=30, m0=100)
        sg = next(d for d in V.player_state(g)['nodes'] if d['id'] == n['id'])['sg']
        self.assertEqual(sg['food'], TT.tours_left(g, g.t + 30))


class ArriveeDevantUneVille(unittest.TestCase):
    """Évolution du 18/10/2026 (SPEC-TOURS.md) : une armée du joueur qui arrive devant une ville qui n'est pas à lui
    (sa cible, ou une ville en chemin) s'arrête, et le joueur choisit, toujours."""

    def setUp(self):
        self.g = partie('33', '1700')
        self.idx = {gn['name']: i for i, gn in enumerate(self.g.geo.nodes)}

    def detachements(self, n=3):
        """L'armée de Bordeaux scindée en n détachements (le rapport du joueur)."""
        g = self.g
        a = armee(g)
        ids = [a['id']]
        for r in [x['id'] for x in a['regs']][:n - 1]:
            ok, aid = g.split(g.player, a['id'], [r])
            self.assertTrue(ok, aid)
            ids.append(aid)
        return [g.armies[i] for i in ids]

    def marcher(self, a, nom, tr=None):
        g = self.g
        ok, msg = g.order_move(g.player, a['id'], None, None, self.idx[nom], 'route', tr, False)
        self.assertTrue(ok, msg)
        TT.settle(g)

    def test_le_cas_du_rapport(self):
        # Bordeaux scindée en trois, une marche par détachement, dans les deux ordres : chaque arrivée devant une ville
        # attend le choix du joueur, même en chemin (Léognan d'abord : Villenave-d'Ornon est sur la route)
        for ordre in (['Mérignac', 'Cestas', 'Léognan'], ['Léognan', 'Cestas', 'Mérignac']):
            self.setUp()
            g = self.g
            d0 = g.date_str()
            for a, nom in zip(self.detachements(), ordre):
                self.marcher(a, nom)
                self.assertTrue(a.get('ask'), f"{a['name']} vers {nom} : un choix attend")
                nid = a['ask']['node']
                self.assertEqual((a['at_node'], a['state']), (nid, 'idle'))
                self.assertNotEqual(g.nodes[nid]['owner'], g.player, "la ville ne se rallie pas d'elle-même")
                self.assertFalse(g.battles, 'aucune bataille sans le choix du joueur')
            self.assertEqual(g.date_str(), d0)
        a = g.armies[next(x for x in g.armies if g.armies[x].get('ask', {}).get('node') == self.idx["Villenave-d'Ornon"])]
        self.assertTrue(a['ask']['path'], 'la route vers Léognan est mise de côté')
        self.assertGreater(TT.march_left(g, a), 0, 'la marche qui reste est gardée')

    def test_traverser_en_chemin_la_cible_demande(self):
        a = self.detachements(1)[0]
        self.marcher(a, 'Léognan', tr=True)
        self.assertEqual(a['ask']['node'], self.idx['Léognan'], "Villenave-d'Ornon traversée ; Léognan, la cible, demande")

    def test_meme_en_resolution_automatique(self):
        self.g.settings['battles'] = 'auto'
        a = self.detachements(1)[0]
        self.marcher(a, 'Mérignac')
        self.assertTrue(a.get('ask'))
        self.assertFalse(self.g.battles)

    def test_attendre(self):
        g = self.g
        a = self.detachements(1)[0]
        self.marcher(a, 'Mérignac')
        ok, why = TB.on_speed(g, 1)
        self.assertFalse(ok, '« Tour suivant » attend le choix')
        self.assertIn('Mérignac', why)
        ok, msg = AA.choose(g, g.player, a, 'attendre')
        self.assertTrue(ok, msg)
        self.assertFalse(a.get('ask'))
        self.assertEqual((a['state'], a['hold']), ('idle', True), 'halte devant la place, actions dans le panneau')
        self.assertTrue(TB.on_speed(g, 1)[0])
        jouer_mois(g)
        self.assertEqual(a['at_node'], self.idx['Mérignac'], "elle n'a pas bougé")
        self.assertNotEqual(g.nodes[self.idx['Mérignac']]['owner'], g.player)

    def test_une_ia_fait_comme_avant(self):
        g = self.g
        D.declare_war(g, '24', g.player, quiet=True)
        b = armee(g, '24')
        nid = self.idx['Libourne']
        b['at_node'], b['path'], b['state'], b['tr'], b['hold'] = None, [], 'move', False, False
        b['x'], b['y'] = g.node_xy(nid)
        g.arrive_node(b, nid)
        self.assertFalse(b.get('ask'))
        self.assertIn(b['state'], ('siege', 'battle'))


class TempsReel(unittest.TestCase):
    def test_effets_par_jour_en_temps_reel(self):
        self.assertIn('/tour', CT.fx_text(dict(livres=0.1)))
        self.assertIn('/j', CT.fx_text(dict(livres=0.1), per_day=True))
        g = partie()
        nid = g.capital_of(g.player)
        v = dict(nid=nid, add=dict(fer=0.2))
        self.assertIn('par tour', CT.describe_local(g, v)[0])
        TT.command(g, 'mode', False)
        self.assertIn('par jour', CT.describe_local(g, v)[0])


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
