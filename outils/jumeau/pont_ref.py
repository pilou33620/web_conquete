"""Jumeau de game/tactics/bridge.py et skirmish.py (rust/conquete/src/tactics/bridge.rs, skirmish.rs) : ce qui ne
dépend que de ses entrées, sans partie en marche. Écrit rust/conquete/tests/references/pont.json, relu par
rust/conquete/tests/pont.rs (et par l'essai crc32 de bridge.rs).

- bridge : zlib.crc32, la graine de make_spec (formule seule), _att_angle (sans chef-lieu : l'assaillant loin du centre,
  ou la direction tirée du bid), reg_k, march_k, is_auto, _num ;
- skirmish : _fort, _techs, units_for, _local, _count, _pick_weather, _pick_season, _foe_units, et sur la géographie 3
  options et _open_ground.

    python3 outils/jumeau/pont_ref.py
"""
import math
import random
import types
import zlib

import commun
from game import geo as G
from game import rules as R
from game.tactics import bridge as TB
from game.tactics import skirmish as SK

ref = {}

# ------------------------------------------------------------------ bridge
BIDS = ['', 'b12', 'b123456', 'esc1073741823', 'b7-ü', '123456789', 'b' * 40]
ref['crc32'] = [[b, zlib.crc32(b.encode())] for b in BIDS]
GRAINES = [0, 1, 12345, 2 ** 30 - 1, 2 ** 31, 2 ** 40 + 7, 2 ** 62 + 12345, -5, -(2 ** 50)]
ref['graine'] = [[b, s, (zlib.crc32(b.encode()) ^ (s * 2654435761)) & 0x7FFFFFFF] for b in BIDS for s in GRAINES]

cas = []
for i, (armies, bx, by) in enumerate([
        ({}, 10.0, 20.0),                                                        # personne : la direction du bid
        ({'a1': dict(x=10.1, y=20.1, owner='33')}, 10.0, 20.0),                  # trop près, pas de chef-lieu
        ({'a1': dict(x=13.0, y=17.5, owner='33')}, 10.0, 20.0),                  # loin : vers lui
        ({'a1': dict(x=10.0, y=20.1, owner='33'), 'a2': dict(x=8.0, y=21.0, owner='33')}, 10.0, 20.0),
        ({'a2': dict(x=10.2, y=20.0, owner='33')}, 10.0, 20.0),                  # pile à 0,2 km : pas plus loin
        ({'a1': dict(x=-4.5, y=3.25, owner='64')}, 1.0, 2.0)]):
    for bid in ('b12', 'b9', 'esc77'):
        bt = dict(id=bid, x=bx, y=by, sides=[dict(armies=['a1', 'a2', 'a9'])])
        g = types.SimpleNamespace(armies=armies, factions={})
        cas.append(dict(armies=armies, bt=bt, angle=TB._att_angle(g, bt)))
ref['att_angle'] = cas

regs = [dict(type='ligne', fat=30.0, ammo=55.0, n=600.0), dict(type='artillerie', n=120.0), dict(type='cavalerie', fat=80.0, ammo=0.0, n=350.0),
        dict(type='inconnu', fat=12.5, n=0.0), dict(type='grenadiers', fat=0.0, ammo=100.0, n=0.0)]
ref['reg_k'] = [[r, c, TB.reg_k(r, c)] for r in regs for c in (None, 'inf', 'cavalerie', 'artillerie')]
ref['march_k'] = [[a, TB.march_k(a)] for a in (dict(regs=[]), dict(regs=regs), dict(regs=regs[3:]), dict(regs=regs[:2]))]
ref['is_auto'] = [[bt, TB.is_auto(bt)] for bt in ({}, dict(mode='auto'), dict(mode='attente'), dict(mode='ordres'))]
nums = []
for v in (1, 2.5, '3.25', ' -7 ', True, 'inf', float('nan'), 'x', None, [1]):
    try:
        nums.append([v if not (isinstance(v, float) and v != v) else 'nan!', TB._num(v)])
    except Exception as e:
        nums.append([v if not (isinstance(v, float) and v != v) else 'nan!', type(e).__name__])
ref['num'] = nums

# ------------------------------------------------------------------ skirmish
ref['fort'] = [[gn, SK._fort(gn)] for gn in (dict(type='capitale', fort=0), dict(type='capitale', fort=3), dict(type='ville', fort=1),
                                             dict(type='village', fort=0))]
ref['techs'] = {era: sorted(SK._techs(era)) for era in R.SCENARIOS}
ref['units_for'] = {era: [SK.units_for(era), SK.units_for(era, True)] for era in R.SCENARIOS}
CODES = ['33', '64', '40', '47']
ref['local'] = [[t, c, SK._local(t, c)] for t in R.UNIT_ORDER for c in CODES]
allowed = {'ligne', 'legere', 'cavalerie', 'artillerie'}
counts = []
for u in (None, [], {}, {'ligne': 3}, {'ligne': '2', 'cavalerie': 1.9, 'artillerie': True}, {'ligne': 0, 'legere': -2},
          {'ligne': 'x'}, {'ligne': None}, {'ligne': [1]}, {'ligne': 11}, {'ligne': 6, 'legere': 5}, {'ligne': 1000},
          {'grenadiers': 1}, {'zouaves': 2}, {'ligne': 3, 'grenadiers': 0}, {'ligne': 20, 'zouaves': 1}, {'ligne': ' 4 '},
          {'ligne': '+3', 'legere': float('nan')}):
    out, msg = SK._count(u, allowed)
    counts.append([u if not (isinstance(u, dict) and any(isinstance(v, float) and v != v for v in u.values())) else 'nan!',
                   out, msg])
ref['count'] = counts
ref['count_nan'] = SK._count({'ligne': 3, 'legere': float('nan')}, allowed)[1]

weathers = []
for seed in range(6):
    for season in SK.SEASONS:
        for w in (None, 'pluie', 'neige', 'grele', 7):
            rng = random.Random(seed)
            weathers.append([seed, season, w, SK._pick_weather(rng, season, w), rng.random()])
ref['pick_weather'] = weathers
seasons = []
for seed in range(6):
    for s in (None, 'été', 'printemps', 'ete', 3):
        for w in (None, 'neige', 'canicule', 'soleil', 'grele', 'tempete'):
            rng = random.Random(seed)
            seasons.append([seed, s, w, SK._pick_season(rng, s, w), rng.random()])
ref['pick_season'] = seasons
foes = []
for seed in range(4):
    for era in R.SCENARIOS:
        for code in ('33', '64'):
            for n, assault in ((0, False), (1, True), (0, True), (5, False), (15, True)):
                rng = random.Random(seed)
                foes.append([seed, era, code, n, assault, SK._foe_units(rng, era, code, n, assault), rng.random()])
ref['foe_units'] = foes

GEO = G.GeoMap(3)
opt = SK.options(GEO)
ref['options'] = dict(empreinte=commun.empreinte_ordre(opt), places=len(opt['places']), premiers=opt['places'][:5],
                      units=opt['units'])
ground = []
for seed in range(8):
    n = GEO.nodes[(seed * 97) % len(GEO.nodes)]
    for r0, r1 in ((3.5, 6.0), (1.2, 2.0)):
        rng = random.Random(seed)
        x, y = SK._open_ground(GEO, rng, n['x'], n['y'], r0, r1)
        ground.append([seed, n['x'], n['y'], r0, r1, x, y, rng.random()])
rng = random.Random(1)
ground.append([1, -500.0, -500.0, 1.0, 2.0, *SK._open_ground(GEO, rng, -500.0, -500.0, 1.0, 2.0), rng.random()])   # (en mer : 80 essais)
ref['open_ground'] = ground

commun.ecrire('pont', ref)
