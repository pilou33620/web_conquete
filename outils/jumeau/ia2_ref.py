"""Jumeau des fonctions pures de la seconde moitié de l'IA de bataille (game/tactics/ai.py, l. 2006-4722) : celles qui
ne lisent que leurs entrées (pas la bataille). Écrit rust/conquete/tests/references/ia2.json, relu par
rust/conquete/tests/ia2.rs.

    python3 outils/jumeau/ia2_ref.py

Les unités sont des objets à attributs (types.SimpleNamespace) ; la référence range leurs attributs en dict.
"""
import copy
import math
import os
import random
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commun  # noqa: E402

from game.tactics import ai as AI  # noqa: E402

IDS = ['r1', 'r12', 'r3', 'g7', 'r21', 'w2', 'c4', 'r100']


def unite(rng, uid, cls=None):
    return dict(id=uid, cls=cls or rng.choice(['inf', 'cavalerie', 'artillerie']), x=round(rng.uniform(0, 3000), 1),
                y=rng.uniform(0, 2000), dir=rng.uniform(-math.pi, math.pi),
                state=rng.choice(['repos', 'repos', 'deroute', 'marche']))


def ns(d):
    return SimpleNamespace(**d)


def main():
    ref = dict(foe_dist=[], front_dep=[], out_of_grape=[], gun_front=[], slot=[], recenter=[], wing_rank=[], wave=[])
    for seed in range(40):
        rng = random.Random(seed)
        body = [[rng.choice(IDS), rng.randint(0, 3000), rng.randint(0, 2000), rng.choice(['inf', 'artillerie']), 'ligne']
                for _ in range(rng.randint(0, 6))]
        tb = [tuple(t) for t in body]
        u = unite(rng, 'r1')
        ref['foe_dist'].append(dict(u=u, body=body, r=AI._foe_dist(ns(u), tb)))
        ax, ay, fd = rng.uniform(200, 2800), rng.uniform(200, 1800), rng.uniform(-math.pi, math.pi)
        span = rng.choice([400.0, 550.0, 900.0])
        ref['front_dep'].append(dict(body=body, ax=ax, ay=ay, fd=fd, span=span,
                                     r=list(AI._front_dep(tb, ax, ay, fd, span))))
        guns = [[rng.uniform(0, 3000), rng.uniform(0, 2000), rng.uniform(100, 400), 'c%d' % k]
                for k in range(rng.randint(0, 3))]
        x, y = rng.uniform(0, 3000), rng.uniform(0, 2000)
        ref['out_of_grape'].append(dict(guns=guns, x=x, y=y, fd=fd,
                                        r=list(AI._out_of_grape([tuple(g) for g in guns], x, y, fd))))
        e = unite(rng, 'c1', 'artillerie')
        ref['gun_front'].append(dict(e=e, u=u, r=AI._gun_front(ns(e), ns(u))))
        line = [unite(rng, i, 'inf') for i in IDS[:rng.randint(1, 6)]]
        mem = dict(mode=rng.choice(['poste', 'ligne']), ax=round(ax, 1), ay=round(ay, 1), fd=round(fd, 3),
                   post={v['id']: [round(v['x'], 1), round(v['y'], 1), 0.5] for v in line if rng.random() < 0.5},
                   back={v['id']: rng.choice([0.0, 60.0, 220.0]) for v in line if rng.random() < 0.5},
                   lat={v['id']: round(rng.uniform(-400, 400), 1) for v in line if rng.random() < 0.7})
        ref['slot'].append(dict(mem=mem, slots=[list(AI._slot(mem, v['id'])) for v in line]))
        m2 = copy.deepcopy(mem)
        m0 = copy.deepcopy(mem)
        AI._recenter(m2, [ns(v) for v in line])
        ref['recenter'].append(dict(mem=m0, line=line, r=m2))
        us = [unite(rng, i) for i in IDS]
        roles = {v['id']: rng.choice(['cav', 'cav', 'res', 'rallie', 'ligne']) for v in us}
        wing = {v['id']: rng.choice([-1, 0, 1]) for v in us if rng.random() < 0.8}
        mem3 = dict(role=roles, wing=wing, was={v['id']: 'ligne' for v in us if rng.random() < 0.4})
        ref['wing_rank'].append(dict(mem=mem3, us=us, r=[AI._wing_rank(mem3, [ns(v) for v in us], ns(v)) for v in us]))
        m4 = copy.deepcopy(mem3)
        AI._wave(m4, [ns(v) for v in us])
        ref['wave'].append(dict(mem=mem3, us=us, r=m4['role']))
    commun.ecrire('ia2', ref)


if __name__ == '__main__':
    main()
