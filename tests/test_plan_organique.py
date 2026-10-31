"""Banc du plan organique des villes (SPEC-VILLES-BATAILLE.md, T1) : python3 tests/test_plan_organique.py

POURQUOI CE BANC EXISTE. Une bataille en ville doit se livrer sur les rues, les îlots et l'enceinte de la carte : le
serveur refait le plan organique de web/js/carte/plan-organique.js (planOrganique de villes.js) en Python
(game/tactics/plan_organique.py). Le portage doit rendre les mêmes flottants, au bit près : on le vérifie contre Node
pour un éventail de places (grande ville, port bastionné, bastide, place forte, bourg, castrum, enceinte devenue cours),
avant et après 1860.
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))

from game.geo import GeoMap  # noqa: E402
from game.tactics import plan_organique as PO, plan_ville as PV  # noqa: E402

GEO = GeoMap()
K = PV.carte_de(GEO)
nom = lambda x: next(n for n in GEO.nodes if n['name'] == x)
# (nom, f, pop, d) : f=None garde l'enceinte de la place
VILLES = [('Bordeaux', None, None, 0), ('Bayonne', None, None, 0), ('Libourne', None, None, 0),
          ('Navarrenx', None, None, 0), ('Belin', None, None, 0), ('Dax', 3, None, 0), ('Bazas', 0, None, 0),
          ('Beynac', None, None, 0), ('Agen', None, 30000, 2), ('Fort Médoc', None, None, 0)]


def resume(O):
    if O is None:
        return None
    nb = lambda b: [None if math.isinf(v) else v for v in b]   # (JSON : Infinity devient null)
    return dict(ilots=[dict(pts=il['pts'], bloc=il['bloc'], kinds=il['kinds'], type=il['type'], c=il['c'],
                            graine=il['graine'], sec=il['sec'], boite=il['boite']) for il in O['ilots']],
                mur=O['mur'] and dict(pts=O['mur']['pts'], kind=O['mur']['kind'], demi=O['mur']['demi']),
                axes=[dict(pts=a['pts'], ws=a['ws'], demi=a['demi'], kind=a['kind']) for a in O['axes']],
                boite=nb(O['boite']))


def ecart(a, b, path=''):
    """Premier écart entre deux résumés (nombres égaux au bit près), ou None."""
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return path + ' : clés'
        return next((r for r in (ecart(a[k], b[k], path + '.' + k) for k in a) if r), None)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            return f'{path} : {len(a)} contre {len(b)}'
        return next((r for r in (ecart(x, y, f'{path}[{i}]') for i, (x, y) in enumerate(zip(a, b))) if r), None)
    return None if a == b and isinstance(a, bool) == isinstance(b, bool) else f'{path} : {a!r} contre {b!r}'


class LeMemePlan(unittest.TestCase):

    @unittest.skipUnless(shutil.which('node'), "Node absent : pas de comparaison avec plan-organique.js")
    def test_le_plan_de_python_est_celui_de_la_carte(self):
        etats = [[nom(x)['id'], an, f, pop, d] for x, f, pop, d in VILLES for an in (1789, 1870)]
        dr = tempfile.mkdtemp()
        with open(os.path.join(dr, 'm.json'), 'w') as fh:
            json.dump(GEO.client_payload(), fh)
        with open(os.path.join(dr, 'e.json'), 'w') as fh:
            json.dump(etats, fh)
        js = json.loads(subprocess.check_output(['node', os.path.join(ICI, 'plan_organique_js.mjs'),
                                                 os.path.join(dr, 'm.json'), os.path.join(dr, 'e.json')]))
        shutil.rmtree(dr)
        faux, ilots = [], 0
        for (nid, an, f, pop, d), j in zip(etats, js):
            O = PO.plan(GEO, nid, an, f, pop, d)
            ilots += len(O['ilots']) if O else 0
            r = ecart(resume(O), j)
            if r:
                faux.append(f"{K.noeud[nid]['name']} ({an}, f={f}) {r}")
        print(f'plan organique : {len(etats) - len(faux)}/{len(etats)} plans identiques à Node ({ilots} îlots)')
        self.assertEqual(faux, [], f'{len(faux)} plans sur {len(etats)} diffèrent')

    def test_cache_et_fortin(self):
        n = nom('Bordeaux')
        self.assertIs(PO.plan(GEO, n['id'], 1789), PO.plan(GEO, n['id'], 1789))
        self.assertIsNone(PO.plan(GEO, nom('Fort Médoc')['id'], 1789))

    def test_duree_bordeaux(self):
        n = nom('Bordeaux')
        V = PV.plan(GEO, n['id'], 1870)
        V.pop('org', None)
        t = time.perf_counter()
        PO.plan_organique(K, V)
        print(f'plan organique de Bordeaux (1870) : {time.perf_counter() - t:.2f} s')


if __name__ == '__main__':
    unittest.main(verbosity=0)
