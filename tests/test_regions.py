"""Événements et textes des autres régions de France (game/regions.py, SPEC-FRANCE.md)."""
import datetime
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game import events as E
from game import regions as RG
from game import rules as R
from game import views as V
from game.engine import Game
from game.geo import GeoMap

GEO = GeoMap()
# les clés d'effet que events.apply connaît (les crises de succession à part)
FX = {'res', 'res_pct', 'stab', 'weary', 'glory', 'pop', 'town_pop', 'town_stab', 'tmod', 'days', 'pmod', 'rel', 'regs',
      'research'}


def _effets(ev):
    return ([ev['base']] if ev.get('base') else []) + [c['fx'] for c in ev.get('choices') or []]


class Donnees(unittest.TestCase):
    def test_evenements_dates_cibles_et_effets(self):
        ids = [e['id'] for e in E.HIST]
        self.assertEqual(len(ids), len(set(ids)), 'identifiants en double')
        self.assertEqual(len({e['id'] for e in E.RANDOM}), len(E.RANDOM))
        for ev in RG.HIST:
            d = datetime.date(*ev['date'])   # (une date impossible lève ValueError)
            self.assertTrue(datetime.date(1700, 1, 1) <= d < datetime.date(*R.CAMPAIGN_END), ev['id'])
            self.assertTrue(ev['who'] and set(ev['who']) <= set(R.FACTIONS) - RG.SUD_OUEST, ev['id'])
            self.assertGreaterEqual(len(ev['choices']), 2, ev['id'])
        for ev in RG.HIST + RG.RANDOM:
            for fx in _effets(ev):
                self.assertLessEqual(set(fx), FX, ev['id'])
                for k in list(fx.get('tmod') or {}) + list(fx.get('pmod') or {}):
                    self.assertIn(k, E.MOD_LABEL, f"{ev['id']} : {k}")
                for k in list(fx.get('res') or {}) + list(fx.get('res_pct') or {}):
                    self.assertIn(k, R.RESOURCES, ev['id'])
                for typ, n in fx.get('regs') or []:
                    self.assertIn(typ, R.UNITS, ev['id'])

    def test_au_moins_trois_evenements_par_grande_region(self):
        regions = dict(paris={'75', '77', '78'}, nord={'59', '62'}, picardie={'80', '02', '60'},
                       normandie={'76', '14', '50', '27', '61'}, bretagne={'29', '56', '35', '22'},
                       loire={'44', '49', '72', '53', '85'}, poitou={'17', '16', '79', '86'},
                       centre={'45', '41', '37', '18', '36', '28'}, bourgogne={'21', '71', '58', '89'},
                       champagne={'51', '10', '08', '52'}, lorraine={'54', '55', '57', '88'}, alsace={'67', '68'},
                       comte={'25', '39', '70'}, lyonnais={'69', '42', '01'}, auvergne={'63', '15', '43', '03'},
                       limousin={'87', '19', '23'}, languedoc={'34', '30', '11', '31', '81', '12', '48', '82'},
                       roussillon={'66'}, provence={'13', '83', '84', '04', '06'}, dauphine={'38', '26', '05'},
                       savoie={'73', '74'}, corse={'20'})
        for nom, codes in regions.items():
            n = sum(1 for e in RG.HIST if set(e['who']) & codes)
            self.assertGreaterEqual(n, 1 if nom == 'roussillon' else 3, nom)

    def test_camps_provinces_specialites(self):
        for c, f in R.FACTIONS.items():
            if c in RG.SUD_OUEST:
                continue
            self.assertNotIn('{', f['title'])
            self.assertTrue(f['de'] and f['de_prov'], c)
            self.assertNotEqual(R.PROVINCES[c]['name'], f['name'] if c not in ('20', '73', '75') else None)
        for n in GEO.nodes:
            if n['type'] == 'capitale':
                self.assertIn(n.get('star', [None])[0], R.SPECIALTY, n['name'])
        self.assertEqual(R.FACTIONS['33']['title'], 'Le Négoce bordelais')   # (le Sud-Ouest garde ses textes)


class Partie(unittest.TestCase):
    def test_declenchements(self):
        g = Game(GEO, '59', 'normal', 3, '1700')
        # le siège de Lille arrive au joueur, le jour dit ; les autres camps choisissent aussitôt
        ev = E.HIST_BY_ID['siege_lille']
        E.tick(g, datetime.date(*ev['date']))
        self.assertIn('siege_lille', g.ev_done)
        p = next(x for x in g.pending_ev if x['ev'] == 'siege_lille')
        self.assertIn('Boufflers', p['text'])
        ok, _ = E.resolve(g, p['id'], 0)
        self.assertTrue(ok)
        # chaque événement, pour chacun de ses camps (textes complets, effets appliqués sans erreur)
        for ev in RG.HIST:
            for code in ev['who']:
                E.fire(g, code, ev, 'hist')
        for p in list(g.pending_ev):
            self.assertNotIn('{', p['title'] + p['text'])
            E.resolve(g, p['id'], len(p['choices']) - 1, auto=True)
        # le texte du Grand Hiver ne parle plus de la Garonne hors du Sud-Ouest
        E.fire(g, '59', E.HIST_BY_ID['grand_hiver'], 'hist')
        self.assertNotIn('Garonne', g.pending_ev[-1]['text'])
        # événements aléatoires du pays : forges et côte pour le Nord
        pool = {e['id'] for e in E.RANDOM if not e.get('cond') or e['cond'](g, '59')}
        self.assertTrue({'grisou', 'tempete'} <= pool and 'grele' not in pool)
        for ev in RG.RANDOM:
            code = next(c for c in g.factions if ev['cond'](g, c))
            E.fire(g, code, ev, 'rand')

    def test_sauvegarde_ancienne(self):
        g = Game(GEO, '13', 'normal', 3, '1700')
        g.t = 365 * 30   # (vers 1730 : la peste de Marseille est passée)
        g.ev_done = ['succession']
        V.migrate(g)
        self.assertIn('peste1720', g.ev_done)
        self.assertNotIn('expo1889', g.ev_done)

    def test_sud_ouest_sans_evenement_regional(self):
        g = Game(GeoMap(2), '33', 'normal', 3, '1700')
        self.assertFalse(any(e['cond'](g, c) for e in RG.RANDOM for c in g.factions))
        E.fire(g, '33', E.HIST_BY_ID['grand_hiver'], 'hist')
        self.assertIn('Garonne', g.pending_ev[-1]['text'])


if __name__ == '__main__':
    unittest.main()
