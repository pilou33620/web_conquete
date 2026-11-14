"""Jumeau de game/rules.py (rust/conquete/src/rules.rs) : écrit rust/conquete/tests/references/rules.json.

- chaque constante publique du module (nom en majuscules, ni fonction ni module) : sa forme ordonnée
  (commun.canon_ordre) si elle tient en moins de 2 Ko, sinon son empreinte ; et l'empreinte de sa repr, qui distingue
  1 de 1.0, un tuple d'une liste et d'un set (la forme des références, elle, les tient pour égaux) ;
- les résultats des fonctions sur des cas variés.

    python3 outils/jumeau/rules_ref.py            écrit la référence
    python3 outils/jumeau/rules_ref.py DOSSIER    écrit aussi la forme complète de chaque constante dans DOSSIER
                                                  (NOM.py.json, NOM.py.repr), à comparer à celles que l'essai Rust
                                                  écrit dans <tmp>/conquete_rules quand une constante diffère
"""
import hashlib
import os
import sys
import types

import commun
from game import rules as R


def sans_fonctions(o):
    """BUILD tient des lambdas (cost, days) : elles sortent de la constante et sont vérifiées à part (BUILD_cost,
    BUILD_days côté Rust)."""
    if isinstance(o, dict):
        return {k: sans_fonctions(v) for k, v in o.items() if not callable(v)}
    return o


def repr_type(o):
    """repr(o), les sets triés (leur ordre change d'un lancement à l'autre) : Val::repr côté Rust."""
    if isinstance(o, dict):
        return '{' + ', '.join(f'{repr_type(k)}: {repr_type(v)}' for k, v in o.items()) + '}'
    if isinstance(o, list):
        return '[' + ', '.join(map(repr_type, o)) + ']'
    if isinstance(o, tuple):
        return '(' + ', '.join(map(repr_type, o)) + (',)' if len(o) == 1 else ')')
    if isinstance(o, (set, frozenset)):
        return '{' + ', '.join(map(repr_type, sorted(o))) + '}' if o else 'set()'
    return repr(o)


def sha(t):
    return hashlib.sha256(t.encode('utf-8')).hexdigest()


ref = {}

# ------------------------------------------------------------------ constantes
noms = [k for k, v in vars(R).items()
        if k.isupper() and not k.startswith('_') and not callable(v) and not isinstance(v, types.ModuleType)]
ref['noms'] = noms
ref['constantes'] = {}
for k in noms:
    v = sans_fonctions(getattr(R, k))
    t, r = commun.canon_ordre(v), repr_type(v)
    c = dict(canon=t) if len(t.encode('utf-8')) < 2048 else dict(empreinte=commun.empreinte_ordre(v), taille=len(t))
    c['repr'] = sha(r)
    ref['constantes'][k] = c
    if len(sys.argv) > 1:
        os.makedirs(sys.argv[1], exist_ok=True)
        for ext, texte in (('json', t), ('repr', r)):
            with open(os.path.join(sys.argv[1], f'{k}.py.{ext}'), 'w', encoding='utf-8') as f:
                f.write(texte)

# ------------------------------------------------------------------ fonctions
lieux = ['Agen', 'Bordeaux', 'Le Bugue', 'Les Eyzies', 'Hendaye', 'avril', 'Étampes', 'Île-de-France', 'Oloron-Sainte-Marie',
         'Yonne', '', 'Le', 'Les', 'Le ', 'Les ', 'le Bugue', 'Ébreuil', 'Âge', 'Ussel', 'ÿ', 'Œuvre', 'Zürich', '33', 'İstanbul',
         'Haute-Garonne', "L'Isle-Jourdain", ' Pau', 'Ôo', 'ühl', 'Wissembourg']
lieux += [f[k] for f in R.FACTIONS.values() for k in ('name', 'capital')]
ref['de'] = [[n, R.de(n)] for n in lieux]

xs = [0, 0.0, -0.0, 1, -1, 0.05, 0.25, -0.25, 0.35, 2.5, 12.345, -12.355, 1234.5, 1e6, 0.449999, 99.95, -0.04, 0.5, 1.5,
      -2.5, 0.125, 0.375, 1e-9, 123456789.987]
ref['num'] = [[x, d, R.num(x, d)] for x in xs for d in (0, 1, 2, 3)]
ref['num_defaut'] = [[x, R.num(x)] for x in xs]
ref['nb'] = [[x, R.nb(x)] for x in [0, 1, -1, 0.4, 0.5, 1.5, 2.5, -0.5, -0.4, -0.6, -1.5, 999, 1000, 5350, 1234567, -1234567.8,
                                    12345.5, 1e9, -999.5, 999.5, 110000, 2390.0, -1000, 0.0, -0.0]]
ref['pl'] = [[n, s, p, R.pl(n, s, p)] for n in [0, 1, 2, -1, -2, 3, 21, 1.0, 1.5, 2.0, 0.5, -1.9, -2.0, 1999]
             for s, p in [('tour', None), ('régiment', 'régiments'), ('régiment modernisé', 'régiments modernisés'),
                          ('cheval', 'chevaux'), ('place', '')]]

techs = [[], ['lebel'], ['vapeur', 'gaz', 'pins'], list(R.TECH), ['inconnue'], ['chemins_fer', 'croix_rouge', 'mitrailleuse'],
         {'chappe': 1, 'telegraphe': 0}, list(R.TECH)[::3], list(reversed(list(R.TECH)))]
ref['marks'] = [[t, R.marks(t)] for t in techs]

noeuds = [dict(name=n, type='ville', dept='33', spec=[]) for n in list(R.POP_PLACE)[::5]]
noeuds += [dict(name='Inconnu', type=t, dept=d, spec=s)
           for t in ('fort', 'village', 'ville', 'capitale')
           for d in ('33', '24', '40', '47', '64', '59', '75', '2A')
           for s in ([], ['bois'], ['fer'], ['vin', 'port'], ['ble', 'fer'], 'bois', {'fer': 1})]
noeuds += [dict(name='Bordeaux', type='fort', dept='40', spec=['bois']), dict(name='Houeillès', type='village', dept='47', spec=[])]
ref['pop_curve'] = [[gn, c, repr(c)] for gn in noeuds for c in [R.pop_curve(gn)]]

ans = [0, 1699, 1700, 1790, 1791, 1792, 1793, 1800, 1813, 1814, 1815, 1829, 1830, 1831, 1832, 1870, 1900, 9999, 10000]
ref['hors_service'] = [[t, y, R.hors_service(t, y)] for t in list(R.UNITS) + ['inconnu'] for y in ans]

ref['tax_label'] = [[v, R.tax_label(v)] for v in [-1, 0, 0.1, 0.15, 0.2, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0, 1.01, 1.5, 0.149999, 1.0099]]

ref['etage'] = {t: R._etage(t) for t in R.TECH}
ref['town'] = [[a, b, late, c, repr(c)] for a, b, late in [(1.2, 1.45, 'ville'), (1.15, 1.22, 'bourg'), (0.5, 3.0, 'declin')]
               for c in [R._town(a, b, late)]]
ref['town_defaut'] = repr(R._town(1.18, 1.4))
ref['rural'] = [[y, p, e, late, early, c, repr(c)]
                for y, p, e, late, early in [(1875, 1.17, 1.05, 'phylloxera', 'plein'), (1846, 1.12, 0.85, 'exode', 'lande'),
                                             (1800, 2.0, 1.0, 'pins', 'plein')]
                for c in [R._rural(y, p, e, late, early)]]
ref['rural_defaut'] = repr(R._rural(1851, 1.15, 0.95, 'exode'))
ref['t'] = [[lab, desc, trait, et, fx, c, repr(c)]
            for lab, desc, trait, et, fx in [('Élan', 'Infanterie +6 %.', 'audacieux', 1, dict(inf_power=0.06)),
                                             ('Vétéran', 'Toutes armes +3 %.', None, 1, dict(all_power=0.03)),
                                             ('Rien', '', 'prudent', 2, {}),
                                             ('Deux', 'd’un coup', None, 2, dict(cav_power=0.06, breach=1))]
            for c in [R._t(lab, desc, trait, et, **fx)]]

# les lambdas de BUILD
ref['build'] = [[k, lvl, cost, repr(cost), days, repr(days)] for k, b in R.BUILD.items() for lvl in range(-1, 7)
                for cost, days in [(b['cost'](lvl), b['days'](lvl))]]

commun.ecrire('rules', ref)
