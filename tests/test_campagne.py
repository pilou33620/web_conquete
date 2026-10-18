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
import os
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
        ok, msg = AA.choose(g, g.player, a, 'rallier')
        self.assertTrue(ok, msg)
        self.assertEqual(g.nodes[nid]['owner'], g.player, 'ralliée tout de suite, pendant votre tour')
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
        # (évolution du 18/10/2026 : à l'arrivée, le joueur choisit ; ici, « Assiéger »)
        self.assertEqual(a['ask']['node'], nid)
        ok, msg = AA.choose(g, g.player, a, 'assieger')
        self.assertTrue(ok, msg)
        self.assertEqual(a['state'], 'siege')
        self.assertFalse(g.battles)
        self.assertIn('Donner l’assaut', g.events[-1]['text'])
        self.assertTrue(g.events[-1]['important'], 'annoncé en bulle')
        self.assertTrue(g.assault(g.player, a['id'])[0])
        TT.settle(g)
        self.assertEqual([bt.get('mode') for bt in g.battles.values()], ['attente'], 'la fenêtre « Commander la bataille »')

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

    # ---------------------------------------------------------------- les choix (T2)
    def devant(self, nom, n=1):
        """Un détachement (toute l'armée de Bordeaux si n = 1) arrêté devant sa première ville en marchant vers nom."""
        a = self.detachements(n)[0]
        self.g.factions[self.g.player]['res']['livres'] = 1e5
        self.marcher(a, nom)
        self.assertTrue(a.get('ask'))
        return a

    def test_commander_la_bataille(self):
        g = self.g
        a = self.devant('Mérignac')
        ok, msg = AA.choose(g, g.player, a, 'manuel')
        self.assertTrue(ok, msg)
        bt = g.battles[a['battle']]
        self.assertNotEqual(bt.get('mode'), 'attente', 'pas de seconde fenêtre : le choix est fait')
        self.assertTrue(g.tactical, 'le champ de bataille de l’assaut')
        self.assertFalse(a.get('ask'))

    def test_resolution_automatique(self):
        g = self.g
        a = self.devant('Mérignac')
        ok, msg = AA.choose(g, g.player, a, 'auto')
        self.assertTrue(ok, msg)
        TT.settle(g)
        self.assertFalse(g.battles, 'réglée sur-le-champ')
        if a['id'] in g.armies:
            self.assertEqual(TT.march_left(g, a), 0.0, 'une bataille finit la marche du tour')
            self.assertFalse(a['path'])

    def test_rallier_puis_reprendre_la_route(self):
        g = self.g
        a = self.devant('Léognan')
        vil = self.idx["Villenave-d'Ornon"]
        self.assertEqual(a['ask']['node'], vil)
        ok, msg = AA.choose(g, g.player, a, 'rallier')
        self.assertTrue(ok, msg)
        self.assertEqual(g.nodes[vil]['owner'], g.player)
        TT.settle(g)
        self.assertEqual(a['ask']['node'], self.idx['Léognan'], 'elle reprend sa route jusqu’à Léognan, qui demande à son tour')

    def test_rallier_refuse_si_l_armee_est_trop_faible(self):
        g = self.g
        a = self.devant('Mérignac')
        mer = self.idx['Mérignac']
        f = 2 * g.node_defense_power(mer) / g.army_power(a, 1.0)   # (deux fois la défense : pas assez)
        for r in a['regs']:
            r['n'] *= f
        self.assertLess(g.army_power(a, 1.0), 3 * g.node_defense_power(mer))
        ok, msg = AA.choose(g, g.player, a, 'rallier')
        self.assertFalse(ok)
        self.assertIn('trop faible', msg)
        self.assertTrue(a.get('ask'), 'le choix reste ouvert')

    def test_assieger_seulement_une_place_a_remparts(self):
        g = self.g
        a = self.devant('Mérignac')
        self.assertFalse(AA.walled(g.nodes[self.idx['Mérignac']]))
        self.assertFalse(AA.choose(g, g.player, a, 'assieger')[0])
        self.assertNotIn('assieger', AA.ask_choices(g, a))

    def test_bloquer(self):
        g = self.g
        a = self.devant('Mérignac')
        ok, msg = AA.choose(g, g.player, a, 'bloquer')
        self.assertTrue(ok, msg)
        self.assertTrue(g.nodes[self.idx['Mérignac']]['siege'].get('blocus'))
        self.assertEqual(a['state'], 'siege')

    def test_contribution_puis_reprendre_la_route(self):
        g = self.g
        a = self.devant('Léognan')
        ok, msg = AA.choose(g, g.player, a, 'contribution')
        self.assertTrue(ok, msg)
        TT.settle(g)
        self.assertEqual(a['ask']['node'], self.idx['Léognan'])

    def test_negocier_l_armee_reste_devant_la_place(self):
        # (revue : les pourparlers exigent l'armée devant la place ; repartie, ils seraient rompus)
        g = self.g
        a = self.devant('Léognan')
        vil = self.idx["Villenave-d'Ornon"]
        ok, msg = AA.choose(g, g.player, a, 'negocier')
        self.assertTrue(ok, msg)
        self.assertIn('au prochain tour', msg)
        TT.settle(g)
        self.assertEqual((a['at_node'], a['path']), (vil, []))
        g.nodes[vil]['aa']['ng']['risk'] = 0.0
        jouer_mois(g)
        self.assertEqual(g.nodes[vil]['owner'], g.player, 'les notables rallient la place')

    def test_le_rapport_de_bout_en_bout(self):
        # chaque détachement choisit à chaque ville (ici : rallier quand c'est permis, sinon l'assaut automatique) ;
        # à la fin, plus rien n'attend, « Tour suivant » part, et aucune bataille n'a été engagée sans choix
        g = self.g
        for a, nom in zip(self.detachements(), ['Léognan', 'Cestas', 'Mérignac']):
            self.marcher(a, nom)
            for _ in range(10):
                if not a.get('ask'):
                    break
                self.assertFalse(any(bt.get('mode') == 'attente' for bt in g.battles.values()))
                ok, msg = AA.choose(g, g.player, a, 'rallier' if AA.ask_choices(g, a).get('rallier') == '' else 'auto')
                self.assertTrue(ok, msg)
                TT.settle(g)
        self.assertIsNone(AA.asking(g))
        self.assertTrue(TB.on_speed(g, 1)[0])

    # ---------------------------------------------------------------- après la revue
    def test_un_choix_perime_est_leve(self):
        g = self.g
        # l'armée reçoit un autre ordre de marche
        a = self.devant('Mérignac')
        self.assertTrue(g.order_move(g.player, a['id'], None, None, g.capital_of(g.player), 'route', None, False)[0])
        TT.settle(g)
        self.assertIsNone(AA.asking(g))
        self.assertFalse(AA.choose(g, g.player, a, 'auto')[0])
        self.assertFalse(g.battles)
        # deux détachements devant Mérignac : l'un la rallie, le choix de l'autre tombe (la ville est à nous)
        self.setUp()
        g = self.g
        a, b = self.detachements(2)
        self.marcher(a, 'Mérignac')
        self.marcher(b, 'Mérignac')
        self.assertTrue(a.get('ask') and b.get('ask'))
        if AA.ask_choices(g, a)['rallier']:
            for r in a['regs']:
                r['n'] *= 10
        self.assertTrue(AA.choose(g, g.player, a, 'rallier')[0])
        self.assertIsNone(AA.asking(g))
        self.assertFalse(AA.choose(g, g.player, b, 'auto')[0], 'pas d’assaut contre sa propre ville')

    def test_pas_de_choix_pendant_le_tour_des_ia(self):
        # (un choix posé pendant le tour des IA bloquerait la partie : on fait comme avant)
        g = self.g
        a = self.detachements(1)[0]
        mer = self.idx['Mérignac']
        g.tour['end'] = g.t + 20
        a['at_node'], a['path'], a['state'], a['tr'], a['hold'] = None, [], 'move', False, False
        a['x'], a['y'] = g.node_xy(mer)
        g.arrive_node(a, mer)
        self.assertFalse(a.get('ask'))

    def test_une_armee_en_retraite_ne_demande_rien(self):
        g = self.g
        a = self.detachements(1)[0]
        mer = self.idx['Mérignac']
        a['at_node'], a['path'], a['state'], a['tr'], a['hold'] = None, [], 'retreat', False, False
        a['x'], a['y'] = g.node_xy(mer)
        g.arrive_node(a, mer)
        self.assertFalse(a.get('ask'))

    def test_en_temps_reel_la_campagne_attend(self):
        g = self.g
        g.tour['on'] = False
        g.speed_idx = 1
        a = self.detachements(1)[0]
        mer = self.idx['Mérignac']
        a['at_node'], a['path'], a['state'], a['tr'], a['hold'] = None, [], 'move', False, False
        a['x'], a['y'] = g.node_xy(mer)
        g.arrive_node(a, mer)
        self.assertTrue(a.get('ask'))
        self.assertEqual(g.speed_idx, 0, 'le temps s’arrête')

    def test_apres_un_assaut_en_chemin_elle_repart_au_tour_suivant(self):
        g = self.g
        a = self.devant('Léognan')
        vil = self.idx["Villenave-d'Ornon"]
        for r in a['regs']:
            r['n'] *= 4   # (une victoire nette)
        self.assertTrue(AA.choose(g, g.player, a, 'auto')[0])
        TT.settle(g)
        self.assertEqual(g.nodes[vil]['owner'], g.player)
        self.assertEqual(TT.march_left(g, a), 0.0, 'la bataille finit la marche du tour')
        self.assertTrue(a['path'], 'la route vers Léognan est gardée')
        jouer_mois(g)
        self.assertEqual(a['ask']['node'], self.idx['Léognan'], 'au tour suivant, elle repart et Léognan demande')

    def test_un_assaut_sur_une_bataille_en_cours_la_rejoint(self):
        g = self.g
        a, b = self.detachements(2)
        self.marcher(a, 'Mérignac')
        self.marcher(b, 'Mérignac')
        self.assertTrue(AA.choose(g, g.player, a, 'manuel')[0])
        self.assertTrue(AA.choose(g, g.player, b, 'auto')[0])
        self.assertEqual(len(g.battles), 1, 'une seule bataille devant Mérignac')
        self.assertEqual(b['battle'], a['battle'])

    def test_commander_quand_une_autre_bataille_se_livre(self):
        g = self.g
        a, b = self.detachements(2)
        self.marcher(a, 'Mérignac')
        self.marcher(b, 'Léognan')   # (arrêtée à Villenave-d'Ornon)
        self.assertTrue(AA.choose(g, g.player, a, 'manuel')[0])
        ok, msg = AA.choose(g, g.player, b, 'manuel')
        self.assertFalse(ok)
        self.assertIn('déjà en cours', msg)
        self.assertTrue(b.get('ask'), 'le choix reste ouvert')
        self.assertEqual(len(g.battles), 1)

    def test_commander_meme_en_resolution_automatique(self):
        g = self.g
        g.settings['battles'] = 'auto'
        a = self.devant('Mérignac')
        self.assertTrue(AA.choose(g, g.player, a, 'manuel')[0])
        self.assertTrue(g.tactical)

    def test_rallier_ou_attaquer_pendant_le_choix_garde_la_route(self):
        g = self.g
        a = self.devant('Léognan')
        self.assertTrue(AA.conquer(g, g.player, a)[0])
        self.assertTrue(a['ask']['path'], 'la route vers Léognan n’est pas perdue')

    def test_assieger_assiege_sans_rallier(self):
        g = self.g
        a = self.detachements(1)[0]
        nid = next(n['id'] for n in g.nodes if n['owner'] == R.NEUTRAL and AA.walled(n) and n['fort'] >= 2)
        a['at_node'], a['path'], a['state'], a['tr'], a['hold'] = None, [], 'move', True, False
        a['x'], a['y'] = g.node_xy(nid)
        for r in a['regs']:
            r['n'] *= 50   # (assez forte pour la rallier : elle choisit pourtant le siège)
        g.arrive_node(a, nid)
        self.assertEqual(a['ask']['node'], nid)
        ok, msg = AA.choose(g, g.player, a, 'assieger')
        self.assertTrue(ok, msg)
        self.assertEqual(a['state'], 'siege')
        self.assertEqual(g.nodes[nid]['owner'], R.NEUTRAL)
        self.assertTrue(a['tr'], 'la conduite est gardée')

    def test_un_detachement_d_une_armee_en_halte_reste_en_halte(self):
        g = self.g
        a = self.devant('Mérignac')
        self.assertTrue(AA.choose(g, g.player, a, 'attendre')[0])
        ok, bid = g.split(g.player, a['id'], [a['regs'][0]['id']])
        self.assertTrue(ok, bid)
        self.assertTrue(g.armies[bid].get('hold'))

    # ---------------------------------------------------------------- chasse aux bugs du 18/10/2026
    def test_un_autre_prend_la_ville_d_assaut_l_armee_qui_attendait_repart(self):
        g = self.g
        a, b = self.detachements(2)
        self.marcher(a, 'Léognan')                    # (arrêtée devant Villenave-d'Ornon)
        self.marcher(b, "Villenave-d'Ornon")
        for r in b['regs']:
            r['n'] *= 4
        self.assertTrue(AA.choose(g, g.player, b, 'auto')[0])
        TT.settle(g)   # (comme le serveur après la commande)
        self.assertEqual(g.nodes[self.idx["Villenave-d'Ornon"]]['owner'], g.player)
        self.assertEqual(a['ask']['node'], self.idx['Léognan'], 'la ville prise, elle reprend sa route tout de suite')

    def test_la_place_prise_les_assiegeants_sont_liberes(self):
        g = self.g
        a, b = self.detachements(2)
        self.marcher(a, 'Mérignac')
        self.assertTrue(AA.choose(g, g.player, a, 'bloquer')[0])
        for r in b['regs']:
            r['n'] *= 10   # (assez forte pour la rallier en arrivant)
        self.marcher(b, 'Mérignac')
        self.assertEqual(g.nodes[self.idx['Mérignac']]['owner'], g.player)
        self.assertEqual(a['state'], 'idle', 'plus de siège devant sa propre ville')

    def test_retraite_d_une_bataille_qui_ne_vous_concerne_plus(self):
        g = self.g
        ally, foe = '24', '47'
        g.set_status(g.player, ally, 'alliance'); g.set_status(ally, foe, 'guerre'); g.set_status(g.player, foe, 'guerre')
        city = g.capital_of(ally)
        a = armee(g)
        a['x'], a['y'], a['at_node'], a['state'], a['path'] = *g.node_xy(city), city, 'idle', []
        e = armee(g, foe)
        e['x'], e['y'] = g.node_xy(city)
        g.start_battle([e], [], *g.node_xy(city), node=city)
        bt = next(iter(g.battles.values()))
        self.assertEqual(bt['mode'], 'attente')
        self.assertTrue(g.order_retreat(g.player, a['id'])[0])
        self.assertFalse(TB.involves_player(g, bt))
        self.assertEqual(bt['mode'], 'auto', 'elle se règle sans vous : la campagne n’attend plus')

    def test_recharger_ne_decale_pas_les_echeances_entre_ia(self):
        g = self.g
        mine = next(n for n in g.nodes if n['owner'] == g.player)
        other = next(n for n in g.nodes if n['owner'] not in (g.player, R.NEUTRAL))
        for n in (mine, other):
            n['tm'] = [dict(until=g.t + 37.1)]
        g.factions['24']['truce']['47'] = g.t + 41.3   # (une trêve entre IA)
        TT.migrate(g)
        self.assertAlmostEqual(other['tm'][0]['until'], g.t + 37.1, msg='ville d’une IA : son échéance ne bouge pas')
        self.assertAlmostEqual(g.factions['24']['truce']['47'], g.t + 41.3)
        self.assertEqual(mine['tm'][0]['until'], TT.turn_start_after(g, g.t + 37.1), 'les vôtres : au début d’un tour')

    def test_choix_inconnu(self):
        g = self.g
        a = self.devant('Mérignac')
        self.assertFalse(AA.choose(g, g.player, a, 'piller')[0])
        self.assertTrue(a.get('ask'))

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


class BancEquilibre(unittest.TestCase):
    """outils/simuler.py : des parties jouées par les IA seules, pour mesurer l'équilibre (SPEC-TECH.md)."""

    def test_meme_graine_meme_partie(self):
        from outils.simuler import simulate
        a, b = simulate(5, '1790', 2), simulate(5, '1790', 2)
        self.assertIsNone(a['err'])
        self.assertEqual(a, b, 'même graine : mêmes mesures')


class ArbreDesTechnologies(unittest.TestCase):
    """SPEC-TECH.md, module arbre : 94 technologies datées, prérequis cohérents, chaque effet lu par le moteur."""

    def test_prerequis_existants_sans_cycle_ni_anachronisme(self):
        self.assertEqual(len(R.TECH), 94)
        for t in R.TECH.values():
            self.assertIn(t['id'], R.TECH_YEAR, t['id'])
            for q in t['req']:
                self.assertIn(q, R.TECH, f"{t['id']} : prérequis {q}")

        def depth(tid, seen=()):
            self.assertNotIn(tid, seen, f'cycle : {seen}')
            return 1 + max((depth(q, seen + (tid,)) for q in R.TECH[tid]['req']), default=0)
        for tid in R.TECH:
            depth(tid)

    def test_pas_cherchable_avant_son_annee(self):
        g = partie(epoque='1700')
        g.factions[g.player]['techs'] += ['vapeur', 'manufactures']
        ok, why = g.research(g.player, 'vapeur_fluviale')
        self.assertFalse(ok)
        self.assertIn('1818', why)

    def test_branche_civil_et_sociale(self):
        self.assertIn('civil', R.BRANCHES, "l'identifiant reste « civil » (sauvegardes, goûts des IA)")
        self.assertEqual(R.TECH['suffrage']['branch'], 'civil')

    @unittest.expectedFailure   # shortcut: effets branchés par T54 à T58 (tasks/todo-tech.md), activé en T58
    def test_chaque_effet_est_lu_par_le_moteur(self):
        import glob
        import re
        racine = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        lus = set()
        for f in glob.glob(os.path.join(racine, 'game', '*.py')) + glob.glob(os.path.join(racine, 'game', 'tactics', '*.py')):
            for line in open(f, encoding='utf-8'):
                if re.search(r"\bmod\(|md\.get\(|mods'?\]?\.get\(|boost=", line):
                    lus |= set(re.findall(r"'([a-z_]+)'", line))
        lus.add('rail_troops')   # (les armées prendront le train en phase 2, avec les voies ferrées de la carte)
        oublies = sorted({k for t in R.TECH.values() for k in t['fx']} - lus)
        self.assertEqual(oublies, [], 'effets de technologies que le moteur ne lit nulle part')


def avec(g, code, *techs):
    """Donne ces technologies au camp et recalcule ses effets."""
    g.factions[code]['techs'] += [t for t in techs if t not in g.factions[code]['techs']]
    g.recompute_mods(code)
    return g


class EffetsEconomiques(unittest.TestCase):
    """SPEC-TECH.md : caisse d'épargne, éclairage au gaz, ciment, bateau à vapeur, Fresnel."""

    def test_le_tresor_rapporte_deux_pour_cent_l_an(self):
        import datetime
        a, b = partie(seed=4), avec(partie(seed=4), '33', 'caisse_epargne')
        for g in (a, b):
            g.factions['33']['res']['livres'] = 12000.0
            g.monthly(datetime.date(1790, 4, 1))
        self.assertAlmostEqual(b.factions['33']['res']['livres'] - a.factions['33']['res']['livres'], 20.0, places=3)

    def test_le_gaz_eclaire_les_villes_pas_les_villages(self):
        a, b = partie(), avec(partie(), '33', 'gaz')
        ville = next(n for n in a.nodes if n['owner'] == '33' and a.geo.nodes[n['id']]['type'] == 'capitale')
        village = next(n for n in a.nodes if a.geo.nodes[n['id']]['type'] == 'village')
        village['owner'] = b.nodes[village['id']]['owner'] = '33'
        k = b.node_output(b.nodes[ville['id']], '33')['livres'] / a.node_output(ville, '33')['livres']
        self.assertAlmostEqual(k, 1.05, places=6)
        self.assertEqual(b.node_output(b.nodes[village['id']], '33'), a.node_output(village, '33'))

    def test_le_ciment_construit_moins_cher_et_plus_vite(self):
        a, b = partie(), avec(partie(), '33', 'ciment')
        nid = next(n['id'] for n in a.nodes if n['owner'] == '33' and a.geo.nodes[n['id']]['type'] == 'capitale')
        res = []
        for g in (a, b):
            g.factions['33']['res'].update(livres=5000, bois=500, fer=500, outils=500)
            avant = dict(g.factions['33']['res'])
            ok, why = g.build('33', nid, 'dev')
            self.assertTrue(ok, why)
            res.append((avant['livres'] - g.factions['33']['res']['livres'], g.nodes[nid]['queue'][-1]['total']))
        self.assertEqual(res[1][0], math.ceil(res[0][0] * 0.85))
        self.assertAlmostEqual(res[1][1], res[0][1] * 0.85)

    def test_le_vapeur_remonte_aussi_vite_qu_il_descend(self):
        g = avec(partie(), '33', 'vapeur_fluviale')
        e = next(e for e in g.geo.edges if e.get('kind') == 'water' and not e['sea'] and e['down'] is not None)
        haut = e['a'] if e['down'] == e['b'] else e['b']   # (on part de l'amont : on descend)
        bas = e['down']
        self.assertAlmostEqual(g.water_speed(e, bas, estimate=True, code='33'), g.water_speed(e, haut, estimate=True, code='33'))
        self.assertLess(g.water_speed(e, bas, estimate=True, code='24'), g.water_speed(e, haut, estimate=True, code='24'))


class EffetsSurLaSociete(unittest.TestCase):
    """SPEC-TECH.md : vaccine, betterave, bouillie (et le mildiou), suffrage, mutuelles, syndicats."""

    def pop(self, g, code):
        return sum(n.get('pop', 0) for n in g.owned_nodes(code))

    def test_la_vaccine_divise_par_deux_le_cholera(self):
        a, b = partie(), avec(partie(), '33', 'vaccine')
        p0 = self.pop(a, '33')
        for g in (a, b):
            E.fire(g, '33', E.HIST_BY_ID['cholera'], 'hist')
        self.assertAlmostEqual((p0 - self.pop(b, '33')) / (p0 - self.pop(a, '33')), 0.5, places=6)

    def test_la_fievre_d_une_ville_aussi(self):
        a, b = partie(), avec(partie(), '33', 'vaccine')
        ev = next(e for e in CT.LOCAL if e['id'] == 'epidemie')
        nid = next(n['id'] for n in a.nodes if n['owner'] == '33' and a.geo.nodes[n['id']]['type'] == 'capitale')
        p0 = a.nodes[nid]['pop']
        for g in (a, b):
            CT.fire(g, '33', g.nodes[nid], ev)
        self.assertAlmostEqual((p0 - b.nodes[nid]['pop']) / (p0 - a.nodes[nid]['pop']), 0.5, places=6)

    def test_la_betterave_trouvee_apres_le_blocus_le_leve(self):
        g = partie()
        sans = g.mod('33', 'port')
        E.fire(g, '33', E.HIST_BY_ID['blocus'], 'hist')
        g.recompute_mods('33')
        self.assertAlmostEqual(g.mod('33', 'port'), sans - 0.4)
        avec(g, '33', 'betterave')
        self.assertAlmostEqual(g.mod('33', 'port'), sans, msg='le blocus ne coûte plus rien aux ports')

    def test_un_ancien_effet_sans_etiquette_reste_entier(self):
        g = partie()
        sans = g.mod('33', 'port')
        g.factions['33'].setdefault('tmods', []).append(dict(k='port', v=-0.4, until=g.t + 999))
        avec(g, '33', 'betterave')
        self.assertAlmostEqual(g.mod('33', 'port'), sans - 0.4)

    def test_le_mildiou_frappe_les_vignes_et_la_bouillie_l_attenue(self):
        g = partie()
        sans = g.mod('33', 'vin')
        E.fire(g, '33', E.HIST_BY_ID['mildiou'], 'hist')
        g.recompute_mods('33')
        self.assertLess(g.mod('33', 'vin'), sans)
        coup = sans - g.mod('33', 'vin')
        avec(g, '33', 'bouillie')
        self.assertAlmostEqual(sans + 0.15 - g.mod('33', 'vin'), coup / 2)

    def test_le_suffrage_ralentit_la_lassitude(self):
        import datetime
        res = []
        for techs in ((), ('suffrage',)):
            g = avec(partie(seed=2), '33', *techs)
            D.declare_war(g, '33', '24')
            avant = g.factions['33'].get('weary', 0.0)
            g.monthly(datetime.date(1790, 4, 1))
            res.append(g.factions['33']['weary'] - avant)
        self.assertGreater(res[0], 0)
        self.assertAlmostEqual(res[1], res[0] * 0.75)

    def test_les_mutuelles_calment_les_revoltes(self):
        import datetime
        revoltes = []
        for techs in ((), ('mutuelles',)):
            g = avec(partie(seed=6), '24', *techs)
            places = [n for n in g.nodes if n['owner'] == '24' and g.geo.nodes[n['id']]['type'] != 'capitale']
            for n in places:
                n['stab'], n['garrison'] = 0.05, []
            for a_ in [a_ for a_ in g.armies.values() if a_['owner'] == '24']:
                a_['at_node'] = None
            g.monthly(datetime.date(1790, 4, 1))
            revoltes.append({n['id'] for n in places if n['owner'] != '24'})
        self.assertTrue(revoltes[1] <= revoltes[0])
        self.assertLess(len(revoltes[1]), len(revoltes[0]))

    def test_greve_dans_une_ville_a_l_ordre_bas(self):
        import datetime
        g = avec(partie(), '33', 'syndicats')
        villes = [n for n in g.nodes if n['owner'] == '33' and g.geo.nodes[n['id']]['type'] in ('ville', 'capitale')]
        basse, haute = villes[0], villes[1] if len(villes) > 1 else None
        basse['stab'] = 0.3
        if haute:
            haute['stab'] = 0.9
        g.monthly(datetime.date(1791, 1, 1))
        self.assertTrue(any(t['k'] == 'industrie' and t['v'] <= -1 for t in basse.get('tm', [])))
        if haute:
            self.assertFalse(any(t['k'] == 'industrie' for t in haute.get('tm', [])))


class Renseignement(unittest.TestCase):
    """SPEC-TECH.md : photographie, téléphone."""

    def ennemi_en_vue(self, g):
        a = armee(g, '24')
        cap = g.geo.nodes[g.capital_of('33')]
        a['x'], a['y'] = cap['x'] + 3, cap['y'] + 3
        return a

    def regs_vus(self, g, a):
        return next(d for d in V.player_state(g)['armies'] if d['id'] == a['id'])['regs']

    def test_la_photographie_montre_l_experience_et_l_arme(self):
        g = partie()
        a = self.ennemi_en_vue(g)
        a['regs'][0]['xp'] = 40
        sans = self.regs_vus(g, a)[0]
        self.assertEqual(sans[4], 0)
        self.assertEqual(len(sans), 6, "sans photographie : ni l'expérience, ni l'arme")
        avec(g, '33', 'photographie')
        vu = self.regs_vus(g, a)[0]
        self.assertEqual(vu[4], 40)
        self.assertEqual(vu[6], a['regs'][0].get('arm'))
        self.assertEqual(vu[5], 0, 'le moral reste caché')

    def test_le_telephone_annonce_l_armee_qui_arrive(self):
        res = []
        for techs in ((), ('telephone',)):
            g = avec(partie(), '33', *techs)
            D.declare_war(g, '24', '33')
            a = armee(g, '24')
            cap = g.geo.nodes[g.capital_of('33')]
            dehors = min((n for n in g.geo.nodes if g.nodes[n['id']]['owner'] != '33'),
                         key=lambda n: abs(math.hypot(n['x'] - cap['x'], n['y'] - cap['y']) - 30))   # (à 30 km)
            a['x'], a['y'], a['at_node'] = dehors['x'], dehors['y'], dehors['id']
            ok, why = g.order_move('24', a['id'], node=g.capital_of('33'))
            self.assertTrue(ok, why)
            self.assertLessEqual(TT.eta(g, a), 1)
            res.append([x['id'] for x in TT.incoming(g, '33')])
        self.assertEqual(res[0], [], 'sans téléphone, rien')
        self.assertIn(armee(partie(), '24')['id'], res[1])


if __name__ == '__main__':
    unittest.main()
