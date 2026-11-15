"""Références de la troisième partie du moteur de campagne (game/engine.py, lignes 2707 à 4376 : visibilité, batailles,
prise des places, usure, espions, impôts, ordres du joueur) pour le portage en Rust (rust/conquete/src/engine/batailles.rs
et prise.rs). Écrit rust/conquete/tests/references/campagne3.json, relu par rust/conquete/tests/campagne3.rs.

Seulement ce qui tourne sans le reste de la partie (les méthodes qui n'appellent ni les armées, ni les chemins, ni les
modules de campagne encore à porter), sur une partie vide (Game.__new__) posée sur la géographie 1 : chaque cas tire des
camps, des places, des armées et des batailles, puis enchaîne les méthodes et relève ce qu'elles rendent et l'état
qu'elles laissent. Le reste (update_battles, end_battle, capture, attrition…) est vérifié de bout en bout.

    python3 outils/jumeau/campagne3_ref.py
"""
import copy
import random

import commun
from game import rules as R
from game import engine as E
from game import geo as G

GEO = G.GeoMap(1)
CODES = ['33', '24', '40', '47', '64']
TYPES = ['ligne', 'legere', 'cavalerie', 'artillerie', 'chasseurs', 'garde', 'suisses']
MODS = ['stealth', 'node_vision', 'vision', 'detect', 'wounded', 'tax_unrest', 'order', 'market', 'ambush']


def regs_de(rnd, k):
    out = []
    for _ in range(rnd.randint(1, 5)):
        typ = rnd.choice(TYPES)
        out.append(dict(id=f'r{k}_{len(out)}', type=typ, n=rnd.choice([float(rnd.randint(3, 900)), rnd.randint(4, 600)]),
                        max=R.UNITS[typ]['men'], xp=rnd.choice([0.0, 12.5, 60]), morale=rnd.choice([80.0, 30.5, 100])))
    return out


def cas_de(i, rnd):
    t = rnd.choice([0.0, 30.25, 700.5, rnd.uniform(0, 30000)])
    factions = {}
    for c in CODES:
        factions[c] = dict(
            code=c, alive=rnd.random() < 0.9, overlord=None, techs=rnd.sample(['diplomates', 'chappe', 'vauban', 'semis'], 2),
            mods={k: round(rnd.uniform(-0.3, 0.6), 3) for k in rnd.sample(MODS, 5)},
            res=dict(livres=rnd.choice([10.0, 500.0, 5000]), vivres=400.0, recrues=rnd.choice([100.0, 3500.0]), fer=80.0,
                     bois=50, armes=10.0, outils=0.0),
            rel={o: rnd.randint(-99, 50) for o in CODES if o != c}, trade={o: 1 for o in CODES if o != c and rnd.random() < 0.3},
            stats=dict(won=rnd.randint(0, 9), lost=0, captured=rnd.randint(0, 5), killed=0), tax=0.5, tarif=0, douaniers=False,
            slider=0.5, army_count=3, income=dict(livres=rnd.choice([-5.0, 12.5])), start_nodes=rnd.randint(5, 40),
            intel={str(rnd.randrange(len(GEO.nodes))): rnd.choice([t - 1, t + 5]) for _ in range(2)},
            prisoners={o: rnd.choice([0, 37, 400.0]) for o in rnd.sample([o for o in CODES if o != c] + [R.NEUTRAL], 2)},
            truce={}, glory=rnd.choice([0.0, 33.3]), prestige=rnd.choice([0.0, 120.5]))
        if rnd.random() < 0.3:
            factions[c]['famine'] = True
        if rnd.random() < 0.2:
            factions[c]['banqueroute'] = True
    vassal = rnd.choice(CODES)
    factions[vassal]['overlord'] = rnd.choice([c for c in CODES if c != vassal])
    player = rnd.choice(CODES)
    factions[player]['alive'] = True
    nodes = []
    for gn in GEO.nodes:
        owner = gn['dept'] if gn['type'] in ('capitale', 'ville') and rnd.random() < 0.8 else rnd.choice(CODES + [R.NEUTRAL] * 2)
        n = dict(id=gn['id'], owner=owner, milice=rnd.choice([0.0, 40.0, 150]), milice_max=rnd.choice([60.0, 200]),
                 fort=rnd.randint(0, 3), dev=rnd.randint(0, 2), pop=rnd.choice([500.0, 30000.0]), garrison=[], queue=[],
                 siege=None, depot=rnd.choice([0, 0, 0, 1]))
        if rnd.random() < 0.05:
            n['siege'] = dict(by=rnd.choice(CODES), since=rnd.choice([t - 3, t + 2]))
        if rnd.random() < 0.08:
            n['garrison'] = regs_de(rnd, 1000 + gn['id'])
        nodes.append(n)
    armies = {}
    for k in range(14):
        gn = rnd.choice(GEO.nodes)
        at = rnd.random() < 0.4
        aid = f'a{k}'
        a = dict(id=aid, owner=rnd.choice(CODES), name=f'{k + 1}e Armée', x=gn['x'] + (0 if at else rnd.uniform(-6, 6)),
                 y=gn['y'] + (0 if at else rnd.uniform(-6, 6)), at_node=gn['id'] if at else None, onroad=at or rnd.random() < 0.3,
                 state=rnd.choice(['idle', 'idle', 'move', 'siege', 'retreat']), stance=rnd.choice(['normal', 'embuscade', 'retranche']),
                 hidden=rnd.random() < 0.3, regs=regs_de(rnd, k), path=rnd.choice([[], [dict(kind='off')]]), battle=None,
                 grace=rnd.choice([0.0, t + 3]), supply=rnd.choice([1.0, 0.4]), edge=None, assault=False)
        if rnd.random() < 0.7:
            a['gen'] = dict(id=f'g{k}', name='X', trait=rnd.choice(['eclaireur', 'inspirant', 'prudent', 'audacieux', 'cavalier']),
                            lvl=rnd.randint(1, 5), xp=rnd.randint(0, 9))
        for key, vals in (('tac_auto', [True, False]), ('fm', ['ligne', 'carre']), ('pl', ['tenir', 'frontal']),
                          ('fm_t', [t - 0.05, t - 3]), ('boat', [True, False]), ('mp', [None, 4.5])):
            if rnd.random() < 0.4:
                a[key] = rnd.choice(vals)
        armies[aid] = a
    # deux batailles : en rase campagne, devant une place
    ids = list(armies)
    battles = {}
    for b, node in (('b100', None), ('b101', rnd.randrange(len(GEO.nodes)))):
        att, de = ids[:2], ids[2:4]
        ids = ids[4:]
        for x in att + de:
            armies[x]['state'] = 'battle'
            armies[x]['battle'] = b
        bt = dict(id=b, x=armies[att[0]]['x'], y=armies[att[0]]['y'], node=node, t0=t - rnd.choice([0.1, 0.5, 2.0]),
                  ambush=rnd.random() < 0.3, surprise=False, terrain='Plaine', cover=rnd.random() < 0.5, defbonus=1.1, river=0,
                  sides=[dict(owner=armies[att[0]]['owner'], armies=att, men0=rnd.choice([100.0, 3000.0]), lost=rnd.choice([0.0, 400.0]),
                              node=None),
                         dict(owner=armies[de[0]]['owner'], armies=de, men0=2000.0, lost=rnd.choice([0.0, 700.0]), node=node)],
                  recent=[0.0, 0.0], mor=rnd.choice([[100, 100], [40, 80.5]]), cav=rnd.choice([[0, 0], [0.6, 0.1]]))
        battles[b] = bt
    diplo = []
    for a in CODES:
        for b in CODES:
            if a < b:
                diplo.append([[a, b], rnd.choice(['paix', 'guerre', 'guerre', 'alliance'])])
    weather = {z: dict(kind=rnd.choice(['soleil', 'brouillard', 'pluie', 'neige']), left=2) for z in R.ZONES}
    return dict(seed=i, t=t, player=player, factions=factions, nodes=nodes, armies=armies, battles=battles, diplo=diplo,
                weather=weather, start_ord=E.datetime.date(*R.SCENARIOS[rnd.choice(['1790', '1870'])]['date']).toordinal(),
                gar99=regs_de(random.Random(i), 9000), tg=[rnd.choice([0.0, 3.5, 40.0, 900.0]) for _ in range(20)],
                P=[[dict(artillerie=rnd.uniform(0, 50), inf=rnd.uniform(0, 300), cavalerie=rnd.uniform(0, 80)) for _ in (0, 1)]
                   for _ in range(4)])


def partie(cas):
    g = E.Game.__new__(E.Game)
    g.geo = GEO
    g.start_ord = cas['start_ord']
    g.t = cas['t']
    g.player = cas['player']
    g.difficulty = 'normal'
    g.factions = copy.deepcopy(cas['factions'])
    g.nodes = copy.deepcopy(cas['nodes'])
    g.armies = copy.deepcopy(cas['armies'])
    g.battles = copy.deepcopy(cas['battles'])
    g.events = []
    g.seq = 0
    g.speed_idx = 4
    g.flood_until = -1
    g.diplo = {tuple(k): v for k, v in cas['diplo']}
    g._dirty_income = False
    g.weather = copy.deepcopy(cas['weather'])
    g.y_mont = GEO.xy(43.2, 0.0)[1]
    g.x_cote = GEO.xy(44.0, -0.95)[0]
    g.market = dict(R.MARKET_BASE)
    g.rng = random.Random(cas['seed'])
    g.spies, g.sites, g._blockade, g.over = [], [], set(), None
    return g


def essai(f, *args):
    """Un ordre venu du navigateur : l'exception que le serveur rattrapait est notée « exc »."""
    try:
        return list(f(*args))
    except (ValueError, TypeError):
        return 'exc'


def mesurer(cas):
    g = partie(cas)
    out = {}
    g.update_hidden()
    out['hidden'] = {a['id']: a['hidden'] for a in g.armies.values()}
    vis = []
    for c in CODES:
        side, srcs = g.vision_sources(c)
        v, _ = g.visible_armies(c)
        vis.append([sorted(side), srcs, sorted(v)])
    out['vision'] = vis
    arms = list(g.armies.values())
    out['walls'] = [g.behind_walls(a, b) for a in arms[:9] for b in arms[:9]]
    out['arm_class'] = [g.arm_class(t) for t in list(R.UNITS) + ['milice', 'xyz']]
    out['gen'] = [[g.gen_trait(a), g.gen_level_k(a)] for a in arms] + [[g.gen_trait(None), g.gen_level_k(None)]]
    out['vul'] = [g.unit_vul(c, t, fm, p, ph) for c in ('artillerie', 'cavalerie', 'inf')
                  for t in ('artillerie', 'cavalerie', 'milice', 'ligne')
                  for fm in ('ligne', 'colonne', 'carre', 'carre_forme', 'tirailleurs', 'autre')
                  for p in (False, True) for ph in ('canonnade', 'charge')]
    bts = []
    for bt in g.battles.values():
        t0 = g.t
        ph = []
        for dt in (0.0, 0.3, 0.6, 2.0):
            g.t = bt['t0'] + dt
            ph.append(g.battle_phase(bt))
        g.t = t0
        r = [ph]
        for si in (0, 1):
            foe, cav, art = g.foe_mix(bt, si)
            r.append([len(foe), cav, art, [g.choose_formation(None, bt, si, p) for p in ('canonnade', 'fusillade', 'charge')],
                      g.side_men(bt, si), g.side_morale(bt, si) if bt['sides'][si]['node'] is None else None])
        r.append([list(g.battle_yield(bt, P)) for P in cas['P']])
        bts.append(r)
    out['batailles'] = bts
    # pertes typées : la cible de chaque régiment et la milice de la place, comme update_battles
    pertes = []
    for bt in g.battles.values():
        for si in (0, 1):
            tg = []
            for owner, r, a in g.side_units(bt, si):
                tg.append((r['n'], r['type'], a.get('fm', 'ligne'), True, r, a, 0.9))
            if bt['sides'][si]['node'] is not None:
                n = g.nodes[bt['sides'][si]['node']]
                tg.append((n['milice'], 'milice', 'ligne', False, n, None, 1.0))
                for r in n['garrison']:
                    tg.append((r['n'], r['type'], 'ligne', False, r, None, 1.0))
            dmg = cas['tg'][:len(tg)]
            tot = g.apply_typed_losses(bt, si, tg, dmg, 1500.0, 1.35 if si else 1.0)
            pertes.append([tot, bt['sides'][si], [g.armies[x]['regs'] for x in bt['sides'][si]['armies']],
                           g.nodes[bt['sides'][si]['node']] if bt['sides'][si]['node'] is not None else None])
    out['pertes'] = pertes
    g.restore_clock(g.t - 1.5)
    out['clock'] = [g.t, [b['t0'] for b in g.battles.values()], [a['grace'] for a in g.armies.values()],
                    [n['siege'] for n in g.nodes if n['siege']]]
    g.t = cas['t']
    g.dissolve_battle(g.battles['b100'])
    out['dissolve'] = [list(g.battles), [[a['state'], a['battle'], a['grace']] for a in arms[:4]]]
    out['fname'] = [g.fname(c) for c in CODES + [R.NEUTRAL]]
    # prise.rs
    out['depot'] = [g.depot_near(a) for a in arms] + [g.depot_near(arms[0], [n for n in g.nodes if n['id'] % 2])]
    out['intel'] = [g.intel_active(c, int(k)) for c in CODES for k in list(g.factions[c]['intel']) + ['3']]
    p = g.player
    ordres = []
    for v in (0.37, '0.555', ' 0.4 ', 'abc', None, float('inf'), 2, True, -3, 0.125, [1]):
        ordres.append(['tax', essai(g.set_tax, p, v), g.factions[p]['tax']])
        ordres.append(['slider', essai(g.set_slider, p, v), g.factions[p]['slider']])
    for v in (0, 3, 4, -1, True, '1', 2.0, 2):
        ordres.append(['tarif', essai(g.set_tarif, p, v), g.factions[p]['tarif']])
    for v in (True, False, 1, 'x', True):
        ordres.append(['douaniers', essai(g.set_douaniers, p, v), g.factions[p]['douaniers']])
    out['ordres'] = ordres
    out['stab'] = g.stab_targets()
    marche = []
    for res, qty, side in (('vivres', 50, 'buy'), ('fer', '20', 'sell'), ('recrues', 900, 'buy'), ('bois', 2000.7, 'buy'),
                           ('or', 5, 'buy'), ('fer', 5, 'troc'), ('fer', 'x', 'buy'), ('fer', 0.5, 'buy'),
                           ('fer', float('nan'), 'sell'), ('armes', 3000, 'sell'), ('bois', 10, 'sell'), ('vivres', None, 'buy')):
        marche.append([res, essai(g.market_trade, p, res, qty, side), dict(g.factions[p]['res'])])
    out['marche'] = [marche, g.market]
    out['enroll'] = [essai(g.enroll, p, o) for o in CODES + [R.NEUTRAL]] + [g.factions[p]['prisoners']]
    st = []
    for a in arms:
        for s in ('embuscade', 'retranche', 'x', 'normal'):
            st.append(essai(g.set_stance, a['owner'], a['id'], s))
        st.append(essai(g.set_stance, p, a['id'], 'normal'))
        st.append([a['stance'], a['state'], a['path']])
    out['stance'] = st
    gar = []
    for a in arms:
        if a['id'] in g.armies:
            gar.append(essai(g.to_garrison, a['owner'], a['id']))
    out['garnison'] = [gar, list(g.armies), [n['garrison'] for n in g.nodes if n['garrison']]]
    # une armée au repos dans une place du joueur reçoit des régiments de la garnison (form_army, into)
    n = next((n for n in g.nodes if n['owner'] == p), None)
    fa = []
    if n is not None:
        gn = GEO.nodes[n['id']]
        n['garrison'] = copy.deepcopy(cas['gar99'])
        g.armies['a99'] = dict(id='a99', owner=p, x=gn['x'], y=gn['y'], at_node=n['id'], state='idle', regs=[])
        ids = [r['id'] for r in n['garrison']]
        fa = [essai(g.form_army, p, n['id'], ids[:2], 'a99'), essai(g.form_army, p, n['id'], 'r', 'a99'),
              essai(g.form_army, p, n['id'], ids, 'a98'), g.armies['a99']['regs'], n['garrison']]
    out['form_army'] = fa
    g.factions['33']['alive'] = True
    g.set_status('33', '24', 'guerre')
    g.set_status('40', '33', 'guerre')
    g.compute_blockades()
    b1 = sorted(g._blockade)
    g.set_status('33', '24', 'paix')
    g.compute_blockades()
    out['blocus'] = [b1, sorted(g._blockade)]
    g.check_end()
    out['fin'] = [g.over, g.speed_idx]
    g.over = None
    loser, winner = [c for c in CODES if c != p][:2]
    g.factions[loser]['alive'] = True
    g.capitulate(loser, winner)
    g.capitulate(loser, winner)
    out['capitule'] = [[n['owner'] for n in g.nodes], list(g.armies), g.factions, [list(k) + [v] for k, v in g.diplo.items()],
                       [b['sides'] for b in g.battles.values()]]
    g.check_end()
    out['fin2'] = [g.over, g.speed_idx]
    out['journal'] = g.events
    out['hasard'] = g.rng.random()
    return out


if __name__ == '__main__':
    rnd = random.Random(3610)
    jeux = []
    for i in range(6):
        cas = cas_de(i, rnd)
        jeux.append(dict(cas=cas, vu=mesurer(cas)))
    commun.ecrire('campagne3', dict(jeux=jeux))
