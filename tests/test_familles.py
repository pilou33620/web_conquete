"""Banc des familles dirigeantes et des mariages (SPEC-MERCENAIRES.md, décisions 10-14) : python3 tests/test_familles.py

POURQUOI CE BANC EXISTE. Les chefs vieillissent, meurent et se succèdent d'année en année : ces règles ne se voient
qu'au bout de décennies de jeu. Ici, on vieillit le chef, on vide ses héritiers et l'on appelle le moteur directement.
"""
import json
import unittest

from fabrique import GEO, partie
from game import diplomacy as D
from game import events as EV
from game import familles as FM
from game import rules as R
from game import views as V


def vieillir(g, code, age):
    g.factions[code]['maison']['chef']['ne'] = g.date().year - age


def annees(g, n):
    """n mois de janvier de suite, sans jouer le reste de l'année."""
    for _ in range(n):
        g.t += 365
        FM.annuel(g)


def sans_heritier(g, code, lien=None):
    """Le chef de code n'a pas d'héritier (ni trait d'ordre public) ; lien : une maison unie à la sienne par mariage."""
    m = g.factions[code]['maison']
    m['heritiers'], m['liens'], m['chef']['trait'] = [], {}, 'econome'
    if lien:
        m['liens'][lien] = g.factions[lien]['maison']['liens'][code] = 1780
    g.recompute_mods(code)
    return m


def ordre_du_trait(g, code):
    return R.MAISON_TRAITS[g.factions[code]['maison']['chef']['trait']]['fx'].get('order', 0)


class Maisons(unittest.TestCase):

    def test_une_maison_par_camp_au_depart_et_au_chargement(self):
        g = partie()
        for code, f in g.factions.items():
            self.assertIn(f['maison']['nom'], R.MAISON_NOMS[code])
            self.assertIn(f['maison']['chef']['trait'], R.MAISON_TRAITS)
        json.dumps(V.player_state(g))
        d = json.loads(json.dumps(V.to_dict(g)))
        for f in d['factions'].values():
            del f['maison']   # une sauvegarde d'avant les familles
        g2 = V.from_dict(GEO, d)
        self.assertTrue(all(f['maison']['chef'] for f in g2.factions.values()))
        self.assertEqual(g.factions['33']['maison']['nom'], g2.factions['33']['maison']['nom'], 'tirage fixé par la partie')

    def test_trait_par_les_modificateurs(self):
        g = partie()
        ch = g.factions['24']['maison']['chef']
        for trait, (k, v) in dict(savant=('research_speed', 0.08), populaire=('order', 0.05),
                                  batisseur=('build_cost', -0.10), belliqueux=('recrues', 0.10)).items():
            ch['trait'] = 'econome'
            g.recompute_mods('24')
            avant = g.mod('24', k)
            ch['trait'] = trait
            g.recompute_mods('24')
            self.assertAlmostEqual(g.mod('24', k) - avant, v)


class Successions(unittest.TestCase):

    def test_naissances(self):
        g = partie()
        m = g.factions['40']['maison']
        m['conjoint'], m['heritiers'] = dict(nom='Marie Labat', de=None), []
        for _ in range(20):
            vieillir(g, '40', 25)
            annees(g, 1)
        self.assertTrue(1 <= len(m['heritiers']) <= R.HERITIERS_MAX)
        m['conjoint'], n = None, len(m['heritiers'])
        for _ in range(8):
            vieillir(g, '40', 25)
            annees(g, 1)
        self.assertEqual(len(m['heritiers']), n, 'pas de naissance sans mariage')

    def test_mort_et_succession_de_l_aine(self):
        g = partie()
        m = g.factions['47']['maison']
        y = g.date().year
        m['heritiers'] = [dict(nom='Pierre X', ne=y - 10), dict(nom='Jean X', ne=y - 20, conjoint=dict(nom='Anne Y', de='33'))]
        for _ in range(30):
            if m['chef']['nom'] == 'Jean X':
                break
            vieillir(g, '47', 95)
            annees(g, 1)
        self.assertEqual(m['chef']['nom'], 'Jean X', "l'aîné succède")
        self.assertEqual(m['conjoint']['nom'], 'Anne Y', 'avec son épouse')
        self.assertEqual([h['nom'] for h in m['heritiers']], ['Pierre X'])
        morts = 0
        for _ in range(40):
            c = m['chef']['nom']
            vieillir(g, '47', 30)
            annees(g, 1)
            morts += m['chef'] is None or m['chef']['nom'] != c
        self.assertLessEqual(morts, 2, 'mort rare avant 50 ans')

    def test_crise_desordre(self):
        g = partie('33')
        f = g.factions['64']
        sans_heritier(g, '64')
        cible0 = g.stab_targets()['64']
        FM.mort(g, '64', g.rng)
        self.assertIsNotNone(f['maison']['chef'], "l'IA choisit aussitôt un successeur")
        self.assertAlmostEqual(g.stab_targets()['64'], cible0 - 0.1 + ordre_du_trait(g, '64'))
        g.t += R.CRISE_JOURS + 1
        g.recompute_mods('64')
        self.assertAlmostEqual(g.stab_targets()['64'], cible0 + ordre_du_trait(g, '64'), msg='six mois seulement')

    def test_crise_pretendant_etranger(self):
        g = partie('24')   # le joueur décide : le prétendant vient en premier, le cousin (le plus prudent) en dernier
        sans_heritier(g, '24', lien='40')
        FM.mort(g, '24', g.rng)
        p = g.pending_ev[-1]
        self.assertEqual(p['ev'], 'crise_succession')
        self.assertEqual(len(p['choices']), 3)
        self.assertEqual(p['choices'][0]['fx']['vassal'], '40')
        self.assertTrue(p['choices'][-1]['label'].startswith('Appeler un cousin'))
        self.assertIsNone(g.factions['24']['maison']['chef'], 'succession disputée en attendant')
        json.dumps(V.player_state(g))
        ok, _ = EV.resolve(g, p['id'], 0)
        self.assertTrue(ok)
        self.assertEqual(g.factions['24']['overlord'], '40')
        self.assertEqual(g.factions['24']['maison']['nom'], g.factions['40']['maison']['nom'])

    def test_pretendant_econduit_guerre_de_succession(self):
        guerres = 0
        for s in range(10):
            g = partie('24', seed=s)
            sans_heritier(g, '24', lien='40')
            FM.mort(g, '24', g.rng)
            p = g.pending_ev[-1]
            self.assertEqual(p['choices'][-1]['fx']['refus'], '40')
            EV.resolve(g, p['id'], len(p['choices']) - 1)
            self.assertIsNone(g.factions['24']['overlord'])
            guerres += g.at_war('40', '24')
        self.assertTrue(0 < guerres < 10, guerres)


class Mariages(unittest.TestCase):

    def test_regle_d_acceptation_de_l_ia(self):
        g = partie('33')
        for c in ('33', '24'):
            sans_heritier(g, c)['conjoint'] = None   # deux chefs seuls
        diplo = g.mod('33', 'diplo') + g.mod('33', 'prestige')
        g.factions['24']['rel']['33'] = 20 - diplo
        self.assertFalse(D.ai_evaluate(g, '24', '33', 'mariage')[0], 'relation trop basse')
        self.assertTrue(D.ai_evaluate(g, '24', '33', 'mariage', 30)[0], 'une dot aide')
        g.factions['24']['rel']['33'] = 21 - diplo
        self.assertTrue(D.ai_evaluate(g, '24', '33', 'mariage')[0])
        D.declare_war(g, '33', '24')
        self.assertFalse(D.ai_evaluate(g, '24', '33', 'mariage')[0], 'pas avec un ennemi')

    def test_dot_relations_liens(self):
        g = partie('33')
        f, o = g.factions['33'], g.factions['24']
        o['rel']['33'], f['rel']['24'] = 30, 0
        f['maison']['conjoint'] = None   # le chef girondin est seul : c'est lui qui se marie
        o['maison']['conjoint'], o['maison']['heritiers'] = dict(nom='X', de=None), [dict(nom='Louis Z', ne=1770)]
        l0, l1 = f['res']['livres'], o['res']['livres']
        ok, _ = D.act(g, '33', '24', 'mariage', 200)
        self.assertTrue(ok)
        self.assertEqual((f['res']['livres'], o['res']['livres']), (l0 - 200, l1 + 200), 'la dot')
        self.assertEqual((o['rel']['33'], f['rel']['24']), (30 + R.MARIAGE_REL, R.MARIAGE_REL))
        self.assertTrue(FM.lie(g, '33', '24') and FM.lie(g, '24', '33'))
        self.assertEqual(f['maison']['conjoint']['de'], '24')
        self.assertEqual(o['maison']['heritiers'][0]['conjoint']['de'], '33', "l'héritier, le chef étant déjà marié")
        self.assertFalse(D.act(g, '33', '24', 'mariage')[0], 'une seule fois')
        # l'alliance devient plus facile : il faut 20 points de relation de moins
        def seuil():
            for r in range(-100, 101):
                o['rel']['33'] = r
                if D.ai_evaluate(g, '24', '33', 'alliance')[0]:
                    return r
        lie = seuil()
        o['maison']['liens'].pop('33')
        self.assertEqual(seuil() - lie, 20)

    def test_guerre_a_une_maison_liee_coute_l_ordre(self):
        g = partie('33')
        sans_heritier(g, '33', lien='47')
        sans_heritier(g, '24')
        cible0 = g.stab_targets()['33']
        D.declare_war(g, '33', '24')
        self.assertAlmostEqual(g.stab_targets()['33'], cible0, msg='sans lien : rien')
        D.declare_war(g, '33', '47')
        self.assertAlmostEqual(g.stab_targets()['33'], cible0 - 0.1)



class MariageEnfant(unittest.TestCase):

    def test_pas_de_mariage_avant_seize_ans(self):
        from game import familles as FM
        g = partie()
        m = g.factions[g.player]['maison']
        m['conjoint'], m['heritiers'] = None, []
        m['chef']['ne'] = g.date().year - 2   # (l'aîné, enfant, a succédé)
        self.assertIsNone(FM.epoux(g, g.player))
        m['chef']['ne'] = g.date().year - 20
        self.assertIs(FM.epoux(g, g.player), m['chef'])


if __name__ == '__main__':
    unittest.main()
