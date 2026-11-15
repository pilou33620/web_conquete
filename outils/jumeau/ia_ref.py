"""Jumeau des fonctions pures de game/tactics/ai.py, première moitié (rust/conquete/src/tactics/ai/deploiement.rs,
reflexion.rs) : écrit rust/conquete/tests/references/ia.json.

Seules les fonctions qui ne lisent que leurs entrées (géométrie, tables, ordre de bataille, mémoire) : le reste de
l'IA se vérifie de bout en bout, bataille entière à la même graine.

    python3 outils/jumeau/ia_ref.py
"""
import copy
import random
from types import SimpleNamespace as NS

import commun
from game.tactics import ai

g = random.Random(20261115)
ref = {}

# ------------------------------------------------------------------ géométrie
geo = []
for _ in range(400):
    x, y = g.uniform(-200, 3200), g.uniform(-200, 2200)
    ax, ay = g.uniform(0, 3000), g.uniform(0, 2000)
    a, b = g.uniform(-7, 7), g.uniform(-7, 7)
    dep, lat, m = g.uniform(-900, 900), g.uniform(-900, 900), g.choice([30.0, 5.0, 0.0, 20.5])
    geo.append(dict(e=[x, y, ax, ay, a, b, dep, lat, m], at=list(ai._at(x, y, a, dep, lat)),
                    rel=list(ai._rel(x, y, ax, ay, a)), clamp=list(ai._clamp(x, y, m)), d2=ai._d2(x, y, ax, ay),
                    ang=ai._ang(a, b)))
ref['geo'] = geo
ref['hour'] = [[c, ai._hour(c)] for c in [0.0, 59.9, 60.0, 3599.0, 3725.5, -61.0, 40000.0] +
               [g.uniform(-3000, 50000) for _ in range(40)]]

# ------------------------------------------------------------------ unités : catégorie, front, qualité, ordre de bataille
TYPES = [('inf', 'ligne', False), ('inf', 'grenadiers', False), ('inf', 'sapeurs', False), ('inf', 'garde', False),
         ('inf', 'milice', False), ('inf', 'legere', True), ('cavalerie', 'hussards', False),
         ('artillerie', 'pied', False), ('general', 'general', False), ('chariot', 'chariot', False)]


def unite(i):
    cls, typ, light = g.choice(TYPES)
    nom = g.choice([f'{i + 1}e {typ}', f'Bataillon {i}', f'{i}er Ligne'])
    return dict(id=f'u{i}', cls=cls, type=typ, light=light, name=nom, men=round(g.uniform(20, 900), 3),
                men_nom=g.choice([600, 800.0, 0.5, 120]), morale=round(g.uniform(10, 100), 2), xp=round(g.uniform(0, 100), 2))


unites = [unite(i) for i in range(120)]
ref['unites'] = [dict(u=u, cat=ai._cat(NS(**u)), width=ai._width(NS(**u)), quality=ai._quality(NS(**u)),
                      foe=ai._foe(NS(**u))) for u in unites]
lay = []
for k in range(30):
    us = g.sample(unites, g.randint(0, 14))
    half, gap = g.uniform(50, 1500), g.choice([22.0, 0.0, 35.5])
    out, width = ai._layout([NS(**u) for u in us], half, gap)
    lay.append(dict(ids=[u['id'] for u in us], half=half, gap=gap, out=[[u.id, lat] for u, lat in out], width=width))
ref['layout'] = lay

# ------------------------------------------------------------------ mémoire : enceinte, brèches, estimations
rings = []
for k in range(60):
    ring = [None if g.random() < 0.4 else g.randint(80, 400) for _ in range(24)] if k % 7 else []
    mem = dict(ring=ring)
    a, dflt = g.uniform(-8, 8), g.choice([None, 123, 250.5])
    pl = dict(x=g.randint(500, 2500), y=g.randint(400, 1600))
    ri, br = g.uniform(40, 400), g.uniform(10, 40)
    rings.append(dict(ring=ring, a=a, default=dflt, ring_at=ai._ring_at(mem, a, dflt), pl=pl, ri=ri, br=br,
                      posts=[list(p) for p in ai._breach_posts(mem, pl, a, ri, br)]))
ref['rings'] = rings

ests = []
for k in range(40):
    vu, vu0 = {}, {}
    for i in range(g.randint(0, 12)):
        vu[f'e{i}'] = [0, 0, 0, g.randint(0, 900), 'inf', 'ligne', g.choice(['repos', 'deroute', 'hors', 'feu']), 50, 0.0, 0]
        if g.random() < 0.8:
            vu0[f'e{i}'] = g.randint(100, 1000)
    mem = dict(vu=vu, vu0=vu0)
    if g.random() < 0.8:
        mem['ann'] = g.choice([g.randint(0, 8000), 0])
    ests.append(dict(mem=mem, est=ai._foe_est(mem)))
ref['foe_est'] = ests

adopt = []
for k in range(30):
    u = dict(unites[k], x=g.uniform(0, 3000), y=g.uniform(0, 2000))
    mem = dict(plan=g.choice(['place', 'tenir', 'frontal']), ax=g.choice([round(g.uniform(0, 3000), 1), 1500]),
               ay=round(g.uniform(0, 2000), 1), fd=round(g.uniform(-3.2, 3.2), 4), role={}, lat={}, back={}, post={},
               wing={})
    avant = copy.deepcopy(mem)
    ai._adopt_unit(mem, NS(**u))
    adopt.append(dict(u=u, avant=avant, apres=commun.canon_ordre(mem)))
ref['adopt_unit'] = adopt

ref['tenue'] = [[f, o, ai._tenue(NS(form=f, order=o))] for f in ('ligne', 'maisons')
                for o in (None, {}, {'kind': 'maisons'}, {'kind': 'barricade'}, {'kind': 'move'})]
ref['dfn'] = [[s, m, ai._dfn(s, m)] for s in (0, 1)
              for m in ({}, {'plan': 'tenir', 'mode': 'poste'}, {'plan': 'harcelement', 'mode': 'poste'},
                        {'plan': 'tenir', 'mode': 'ligne'}, {'plan': 'frontal', 'mode': 'poste'})]

commun.ecrire('ia', ref)
