"""Références des villes posées sur les champs de bataille (rust/conquete/src/tactics/terrain_ville.rs) : ce que rendent
game/tactics/terrain.py et terrain_ville.py pour les cartes de version 9 avec une place. Écrit
rust/conquete/tests/references/terrain_ville.json, relu par rust/conquete/tests/terrain_ville.rs.
    python3 outils/jumeau/terrain_ville_ref.py      (--formes DOSSIER : les formes complètes des cartes, pour chercher un écart ;
                                                     --trace FICHIER NOM : la trace du hasard de la carte NOM)

Les places : une de chaque sorte (type de lieu, modèle du plan, style, citadelle, port) sur la géographie 2, celles que
la géographie 3 ajoute, puis quelques lieux tout près d'une bataille rangée et des places au bord du champ. L'état
(fort de 0 à 4, année, population, faubourgs, brèches, barricades, dégâts) varie d'un cas à l'autre.
"""
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commun  # noqa: E402

if '--trace' in sys.argv:
    TRACE = commun.tracer_hasard(sys.argv[sys.argv.index('--trace') + 1])
    TRACE_NOM = sys.argv[sys.argv.index('--trace') + 2]
else:
    TRACE = TRACE_NOM = None

from game import geo as G  # noqa: E402
from game.tactics import plan_ville as PV, terrain as TR, terrain_ville as TV  # noqa: E402

FORMES = sys.argv[sys.argv.index('--formes') + 1] if '--formes' in sys.argv else None
E = commun.empreinte_ordre


def etat(m, spec):
    d = dict(t=m.t, h=m.h, f=m.f, biome=m.biome, roads=m.roads, rivers=m.rivers, buildings=m.buildings, walls=m.walls,
             hedges=m.hedges, fences=m.fences, bridges=m.bridges, place=m.place, heart=m.heart, town_r=m.town_r,
             region=m.region, stats=m.stats, town=m.town, bastions=m.bastions, demi_lunes=m.demi_lunes, batis=m.batis,
             plan=m.plan)
    d['client'] = m.to_client(spec)
    return d


GEOS = {v: G.GeoMap(v) for v in (2, 3)}
ref = dict(cartes=[])
TEMPS = []


def cas(nom, gv, spec):
    if TRACE and nom == TRACE_NOM:
        TRACE.truncate(0)
        TRACE.seek(0)
    t0 = time.perf_counter()
    m = TR.generate(GEOS[gv], dict(spec))
    TEMPS.append(time.perf_counter() - t0)
    if TRACE and nom == TRACE_NOM:
        TRACE.flush()
        print(f'trace du hasard de {nom} écrite')
        sys.exit(0)
    assert m.plan is not None, nom
    et = etat(m, spec)
    if FORMES:
        os.makedirs(FORMES, exist_ok=True)
        with open(os.path.join(FORMES, nom + '.py.txt'), 'w', encoding='utf-8') as f:
            for k, v in et.items():
                f.write(f'{k} {commun.canon_ordre(v)}\n')
    ref['cartes'].append(dict(nom=nom, spec=spec, gv=gv, etat={k: E(v) for k, v in et.items()},
                              n=[len(m.plan['ilots']), len(m.plan['edifices']), len(m.walls), len(m.plan['metiers']),
                                 len(m.plan['quais']), len(m.plan['bateaux'])]))
    return m


g = random.Random(20261116)
SAISONS, METEOS = ['printemps', 'ete', 'automne', 'hiver'], ['soleil', 'pluie', 'brouillard', 'neige', 'canicule', 'orage']
ANNEES = (1700, 1790, 1805, 1840, 1858, 1865, 1880)


def spec_de(k, cx, cy, place=None, **plus):
    s = dict(seed=g.randrange(1 << 31), cx=cx, cy=cy, season=SAISONS[k % 4], weather=METEOS[k % 6],
             year=ANNEES[k % len(ANNEES)], place=place, att_angle=round(g.uniform(-3.1, 3.1), 3),
             marks=[[], ['mousquet']], balloon=[0, 1], lieu=None, carte=TR.VERSION)
    s.update(plus)
    return s


def place_de(n, k, bataille=True):
    """La place n assiégée (ou non) dans un état tiré au sort : fort de 0 à 4 tour à tour."""
    pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=k % 5, dmg=round(g.choice((0.0, 0.05, 0.2, 0.5, 0.9)), 2),
              dyn=g.choice((0, 0, 1, 2)), bar=round(g.choice((0.0, 0.03, 0.3, 0.7)), 2),
              pop=int(n['pop0'] * g.uniform(0.5, 2.5)), x=n['x'], y=n['y'], battle=bataille, d=g.choice((0, 0, 1, 2)),
              deg=round(g.choice((0.0, 0.1, 0.4)), 3))
    if k % 7 == 3:
        pl['f'] = g.randrange(5)   # (l'état de l'enceinte donné à part)
    if k % 11 == 5:
        del pl['dyn'], pl['d']
    return pl


def sorte(K, n):
    Pf = PV.profil_ville(K, n, 1790, n['fort'], n['pop0'], 0)
    return (n['type'], Pf['modele'], Pf['style'], bool(Pf['citadelle']), bool(Pf['port']), Pf['f'] >= 3)


k = 0
vues = set()
for gv in (2, 3):
    geo = GEOS[gv]
    K = PV.carte_de(geo)
    classes = {}
    for n in geo.nodes:
        classes.setdefault(sorte(K, n), []).append(n)
    for s in sorted(classes, key=repr):
        if s in vues:
            continue
        vues.add(s)
        n = classes[s][g.randrange(len(classes[s]))]
        k += 1
        nom = f'{s[0]}-{s[1]}-{s[2]}{"-cit" if s[3] else ""}{"-port" if s[4] else ""}{"-bast" if s[5] else ""}-g{gv}'
        cas(nom, gv, spec_de(k, n['x'], n['y'], place_de(n, k, bataille=k % 6 != 0)))
    # quelques places de plus, au hasard, dans d'autres années (l'époque du plan)
    for q in range(10 if gv == 2 else 6):
        n = geo.nodes[g.randrange(len(geo.nodes))]
        k += 1
        cas(f'hasard-{q}-{n["type"]}-g{gv}', gv, spec_de(k, n['x'], n['y'], place_de(n, k)))
    # un lieu tout près d'une bataille rangée (moins de 1,3 km) : son village paraît ; avec son état ou sans
    for q in range(6):
        n = geo.nodes[g.randrange(len(geo.nodes))] if q % 2 else next(m for m in geo.nodes if m['type'] in ('ville', 'capitale') and g.random() < 0.2)
        k += 1
        lieu = dict(nid=n['id'], f=g.randrange(5), pop=int(n['pop0'] * g.uniform(0.6, 1.8)), d=q % 3) if q % 3 else None
        a, r = g.uniform(-3.1, 3.1), g.uniform(0.2, 1.25)
        cas(f'pres-{q}-{n["type"]}-g{gv}', gv, spec_de(k, round(n['x'] + math.cos(a) * r, 2), round(n['y'] + math.sin(a) * r * 0.8, 2), lieu=lieu))
    # au bord du champ : la place et ses murs sortent de la carte
    for q, typ in enumerate(('ville', 'capitale', 'fort', 'village')):
        n = [m for m in geo.nodes if m['type'] == typ][q]
        k += 1
        pl = place_de(n, k)
        pl['fort'] = 3 + q % 2
        cas(f'bord-{typ}-g{gv}', gv, spec_de(k, round(n['x'] + (1.3, -1.35, 1.2, -1.1)[q], 2), round(n['y'] + (0.8, 0.85, -0.9, -0.7)[q], 2), pl))
# les métiers rares : les salines (la seule place qui en a), les moulins au bord d'une rivière (moulin à eau)
geo = GEOS[2]
sal = next(n for n in geo.nodes if n['name'] == 'Salies-de-Béarn')
for q in range(3):
    k += 1
    cas(f'salines-{q}', 2, spec_de(k, sal['x'], sal['y'], place_de(sal, k, bataille=q != 1)))
K = PV.carte_de(geo)
moulins = [n for n in geo.nodes if PV.plan(geo, n['id'], 1790, n['fort'], n['pop0'], 0)['Pf']['rivs'] and
           any(p['k'] == 'moulin' for p in PV.plan(geo, n['id'], 1790, n['fort'], n['pop0'], 0)['plus'] if 'x' in p)]
for q in range(8):
    n = moulins[g.randrange(len(moulins))]
    k += 1
    pl = place_de(n, k, bataille=q % 2 == 0)
    pl.pop('f', None)
    pl['fort'] = n['fort']
    cas(f'moulin-{q}-{n["type"]}', 2, spec_de(k, n['x'], n['y'], pl, year=1790))
# (un moulin à eau : trouvé en cherchant sur la géographie 3)
n = GEOS[3].nodes[517]
for q in range(2):
    k += 1
    pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=n['fort'], pop=n['pop0'], x=n['x'], y=n['y'], battle=False)
    cas(f'moulin-eau-{q}', 3, spec_de(k, n['x'], n['y'], pl, year=1790, att_angle=0.5, seed=7 + q))


# ====================================================================== les fonctions publiques
F = ref['fonctions'] = {}
h = random.Random(515151)
geo = GEOS[2]
F['bord_assaillant'] = [[a, TV.bord_assaillant(a)] for a in [h.uniform(-7, 7) for _ in range(200)] +
                        [0.0, math.pi / 2, math.pi, -math.pi / 2, 0.6, -0.6, 2.55, 2.56, -2.55, 1.0, 0.98]]
F['enceinte_carte'] = []
for _ in range(25):
    n = geo.nodes[h.randrange(len(geo.nodes))]
    f, r = h.randrange(1, 5), h.uniform(0.05, 0.6)
    F['enceinte_carte'].append([n['id'], f, r, E(TV.enceinte_carte(n, f, r))])


def trace_au_hasard(nb):
    return [(h.uniform(-200, 3200), h.uniform(-200, 2200)) for _ in range(nb)]


F['ecarter'] = []
for q in range(40):
    pts = TR._densify(trace_au_hasard(2 + q % 4), 40.0) if q % 9 else [(h.uniform(0, 3000), 500.0)][:q % 2 + 0]
    if q % 5 == 0 and pts:
        C = pts[len(pts) // 2]   # (droit sur le centre)
    else:
        C = (h.uniform(500, 2500), h.uniform(400, 1600))
    Rp = h.uniform(50, 900)
    F['ecarter'].append([pts, list(C), Rp, E(TV.ecarter(pts, C, Rp))])
F['preparer'] = []
for q in range(16):
    gv = 2 if q < 12 else 3
    geo = GEOS[gv]
    n = geo.nodes[h.randrange(len(geo.nodes))] if q % 4 else next(m for m in geo.nodes if m['type'] == ('capitale', 'ville', 'fort')[q % 3] and h.random() < 0.3)
    pl = dict(nid=n['id'], name=n['name'], type=n['type'], fort=q % 5, battle=q % 3 != 0, pop=int(n['pop0'] * h.uniform(0.5, 2)) if q % 2 else 0)
    if q % 4 == 1:
        pl['f'], pl['d'] = h.randrange(5), h.randrange(3)
    spec = dict(year=ANNEES[q % len(ANNEES)], att_angle=h.uniform(-3, 3)) if q != 7 else {}
    cx, cy = round(n['x'] + h.uniform(-1, 1), 2), round(n['y'] + h.uniform(-1, 1), 2)
    L = TV.preparer(geo, spec, pl, cx, cy)
    ilots = [[b['q'], b['ins'], b['c'], b['type'], b['zone'], b['main'], b['cotes'], b['kinds'], b['sd'], b['role']] for b in L.ilots]
    F['preparer'].append(dict(gv=gv, spec=spec, pl=pl, cx=cx, cy=cy, k=L.k, pos=list(L.pos), Mk=L.Mk, r_eau=L.r_eau, r_calme=L.r_calme,
                              r_mur=L.r_mur, r_ville=L.r_ville, rivieres=sorted(L.rivieres), ilots=E(ilots), n_ilots=len(ilots),
                              enceinte=E(L.enceinte), cours=E(L.cours), rayon=TV.rayon_enceinte(L.V),
                              routes=E({str(ei): v for ei, v in sorted(TV.routes(L, geo, pl['nid']).items())}),
                              tf=list(L.tf((512.25, 371.5))), unites=list(L.unites(1500.0, 1000.0))))

commun.ecrire('terrain_ville', ref)
print(f"{len(ref['cartes'])} cartes ; temps Python par carte : {1000 * sum(TEMPS) / len(TEMPS):.0f} ms")
print('îlots, édifices, murs, métiers, quais, bateaux :', [sum(c['n'][i] for c in ref['cartes']) for i in range(6)],
      '; cartes avec métiers :', sum(1 for c in ref['cartes'] if c['n'][3]), ', quais :', sum(1 for c in ref['cartes'] if c['n'][4]),
      ', bateaux :', sum(1 for c in ref['cartes'] if c['n'][5]))
