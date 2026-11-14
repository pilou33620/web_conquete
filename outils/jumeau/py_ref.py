"""Références du socle Rust (rust/conquete/src/py) : ce que Python rend pour son hasard, ses arrondis, ses sommes,
hypot, // et %, repr, json et heapq. Écrit rust/conquete/tests/references/py.json, relu par src/py/essais.rs.
    python3 outils/jumeau/py_ref.py
"""
import heapq
import json
import math
import os
import random

ICI = os.path.dirname(os.path.abspath(__file__))
g = random.Random(20261114)
ref = {}

def suite(r):
    s = [r.random() for _ in range(5)]
    s.append(r.uniform(2, 5))
    s += [r.randint(1, 6) for _ in range(5)]
    s += [r.randrange(10), r.randrange(3, 1000000), r.randrange(1 << 40), r.randrange(1 << 30)]
    s.append(r.choice(list(range(7))))
    l = list(range(10)); r.shuffle(l); s.append(l)
    s += [r.gauss(0, 1) for _ in range(3)]
    s.append(r.choices(list(range(5)), k=4))
    s.append(r.choices(list(range(4)), weights=[1, 2, 3, 4], k=5))
    s.append(r.choices(list(range(3)), weights=[0.2, 0.5, 0.3], k=6))
    s.append(r.random())
    return s

ref['hasard_int'] = [[s, suite(random.Random(s))] for s in (0, 1, 12345, 2**31 + 5, 2**40 + 7, -3, 0x5A5A ^ 77)]
ref['hasard_str'] = [[s, suite(random.Random(s))] for s in ('', '1234-5-abc', 'é-1790', '123456-1795-33-quoi')]

xs = [0.5, 1.5, 2.5, -0.5, -1.5, 2.675, 1.005, 0.125, 1e-9, 123456.789, -2.5, 3.0, 1e300, 5e-324]
xs += [g.uniform(-1000, 1000) for _ in range(300)] + [g.random() * 10 ** g.randint(-8, 12) for _ in range(300)]
xs += [round(g.uniform(0, 50), 1) + 0.05 for _ in range(100)] + [k / 8 for k in range(-40, 40)]
ref['round'] = [[x, round(x) if abs(x) < 1e15 else 0, round(x, 1), round(x, 2), round(x, 3), round(x, -1) if abs(x) < 1e15 else 0.0] for x in xs]
ref['repr'] = [[x, repr(x)] for x in xs + [0.0, -0.0, 1e16, 1e15, 1e-4, 1e-5, 123456789012345678.0, 0.1, 1 / 3, 2.0 ** 70, 1.5e-7]]

sommes = []
for _ in range(200):
    n = g.randint(0, 40)
    l = [g.uniform(-1, 1) * 10 ** g.randint(-6, 6) for _ in range(n)]
    sommes.append([l, sum(l)])
ref['sum'] = sommes
mixtes = []
for _ in range(100):
    l = [g.choice([g.randint(-5, 5), g.uniform(-3, 3), g.random() * 1e6]) for _ in range(g.randint(0, 20))]
    mixtes.append([l, sum(l)])
ref['sum_v'] = mixtes

paires = [(g.uniform(-1, 1) * 10 ** g.randint(-3, 5), g.uniform(-1, 1) * 10 ** g.randint(-3, 5)) for _ in range(8000)]
paires += [(3.0, 4.0), (0.0, 0.0), (1e200, 1e200), (1e-200, 1e-200), (5e-324, 5e-324), (1.0, 0.0), (-7.5, 0.0)]
ref['hypot'] = [[x, y, math.hypot(x, y)] for x, y in paires]
ref['dist'] = [[a, b, c, d, math.dist((a, b), (c, d))] for (a, b), (c, d) in zip(paires[:3000], paires[3000:6000])]
ref['hypot3'] = [[a, b, c, math.hypot(a, b, c)] for (a, b), (c, _) in zip(paires[:2000], paires[6000:8000])]

pw = [g.uniform(-1, 1) * 10 ** g.randint(-6, 6) for _ in range(60000)]
ref['pow'] = [[x, x ** 2, abs(x) ** 0.5, abs(x) ** 1.5] for x in pw if x ** 2 != x * x or abs(x) ** 0.5 != math.sqrt(abs(x))][:400]
import sys
sys.path.insert(0, ICI)
import commun
etat = {'b': {10: 'a', 2: 5.0, 1: 1.5}, 'a': [1.0, 2.5, -0.0, 1e16, 1e300, (1, 2.0)], 'é': {3, 1, 2}, 'o': bytearray(b'\x01\x02')}
ref['canon'] = dict(texte=commun.canon(etat), empreinte=commun.empreinte(etat))

ent = [(g.randint(-50, 50), g.choice([-7, -3, -1, 1, 2, 5, 13])) for _ in range(200)]
ref['divmod_i'] = [[a, b, a // b, a % b] for a, b in ent]
fl = [(g.uniform(-50, 50), g.choice([-7.5, -3.0, -0.25, 0.1, 1.0, 2.5, 360.0, math.pi, 2 * math.pi])) for _ in range(500)]
fl += [(6.0, 3.0), (-6.0, 3.0), (0.0, 2.0), (-0.0, 2.0), (5.5, -0.5), (1e30, 1e-3)]
ref['divmod_f'] = [[a, b, a // b, a % b] for a, b in fl]

obj = {'a': 1, 'b': 1.0, 'c': [1, 2.5, 'é"\n\t', None, True, False], 'd': {'z': 1e-7, 'y': 1e16, 3: 'trois'}, 'e': ' /\\', 'f': (1, 2), 'g': {}, 'h': []}
ref['json'] = dict(defaut=json.dumps(obj), compact=json.dumps(obj, ensure_ascii=False, separators=(',', ':')),
                   canon=json.dumps({'b': {10: 'a', 2: 'b', 1: 1.0}, 'a': [obj['c']], 'é': 1}, ensure_ascii=False, separators=(',', ':'), sort_keys=True),
                   indente=json.dumps(obj, ensure_ascii=False, indent=1), repr=repr(obj), str=str(obj))

tas, sortie = [], []
for i in range(400):
    if tas and g.random() < 0.4:
        sortie.append(heapq.heappop(tas))
    else:
        heapq.heappush(tas, [g.randint(0, 12), i])   # (les priorités se répètent : l'ordre des égaux compte)
ops = [[p, i] for p, i in sortie]
ref['heapq'] = dict(graine=20261114, sortie=ops, reste=[heapq.heappop(tas) for _ in range(len(tas))])
l = [[g.randint(0, 9), i] for i in range(50)]
ref['heapify'] = dict(avant=[list(x) for x in l])
heapq.heapify(l)
ref['heapify']['apres'] = l

with open(os.path.join(ICI, '..', '..', 'rust', 'conquete', 'tests', 'references', 'py.json'), 'w', encoding='utf-8') as f:
    json.dump(ref, f, ensure_ascii=False, separators=(',', ':'))
print('py.json écrit')
