"""Vues envoyées au navigateur et sauvegarde/chargement."""
import random

from . import rules as R
from .engine import Game

SAVE_KEYS = ['player', 'difficulty', 'seed', 't', 'uid', 'seq', 'events', 'proposals', 'armies', 'battles', 'over',
             'flood_until', 'market', 'weather', 'factions', 'nodes', '_ai_clock', 'spies']
DEFAULTS = dict(spies=list)


def to_dict(g):
    d = {k: getattr(g, k) for k in SAVE_KEYS}
    d['diplo'] = [[a, b, s] for (a, b), s in g.diplo.items()]
    d['blockade'] = sorted(g._blockade)
    # horloges des IA : sans elles, un chargement relance aussitôt leur diplomatie et leurs propositions
    d['ai_state'] = {c: dict(diplo_clock=ai.diplo_clock, cool=[[k[0], k[1], v] for k, v in ai.cool.items()])
                     for c, ai in getattr(g, 'ais', {}).items()}
    d['version'] = 2
    return d


def migrate(g):
    """Complète une sauvegarde d'une version antérieure (généraux, formations, impôts…)."""
    for f in g.factions.values():
        f.setdefault('tax', 0.5)
        f.setdefault('intel', {})
    for a in g.armies.values():
        if not a.get('gen'):
            a['gen'] = g.new_general(a['owner'])
        for k, v in dict(fm='ligne', pl='frontal', fm_t=-9.0, tac_auto=True, landing=False, boat=False, emb=0.0).items():
            a.setdefault(k, v)
    for bt in g.battles.values():
        bt.setdefault('mor', [100, 100])
        bt.setdefault('phase', 'fusillade')
        bt.setdefault('landing', False)


def from_dict(geo, d):
    g = Game.__new__(Game)
    g.geo = geo
    for k in SAVE_KEYS:
        setattr(g, k, d[k] if k in d else DEFAULTS[k]())
    g._blockade = set(d.get('blockade', []))
    g.diplo = {(a, b): s for a, b, s in d['diplo']}
    g.rng = random.Random(g.seed + int(g.t * 1000))
    g.speed_idx = 0
    g._dirty_income = True
    g._last_day = int(g.t)
    g.y_mont = geo.xy(43.2, 0)[1]
    g.x_cote = geo.xy(44, -0.95)[0]
    for p in g.proposals:
        if p.get('give'):
            p['give'] = tuple(p['give'])
            p['get'] = tuple(p['get'])
    migrate(g)
    from .ai import AI
    g.ais = {c: AI(g, c) for c in R.FACTIONS if c != g.player}
    for c, st in (d.get('ai_state') or {}).items():
        if c in g.ais:
            g.ais[c].diplo_clock = st.get('diplo_clock', g.ais[c].diplo_clock)
            g.ais[c].cool = {(o, act): t for o, act, t in st.get('cool', [])}
    for c in g.factions:
        g.recompute_mods(c)
    g.compute_income()
    return g


def rules_payload():
    build = {k: dict(name=b['name'], max=b['max'], desc=b['desc'], costs=[b['cost'](l) for l in range(b['max'])],
                     days=[b['days'](l) for l in range(b['max'])]) for k, b in R.BUILD.items()}
    fort = dict(max=R.FORT_MAX, bastion=R.BASTION_LEVEL, bastion_types=R.BASTION_TYPES, upkeep=R.FORT_UPKEEP,
                names=R.FORT_NAMES)
    return dict(factions=R.FACTIONS, units=R.UNITS, unit_order=R.UNIT_ORDER, techs=list(R.TECH.values()), fort=fort,
                specialty=R.SPECIALTY, specialty_capital=R.SPECIALTY_CAPITAL,
                branches=R.BRANCHES, build=build, node_base=R.NODE_BASE, spec={k: v['label'] for k, v in R.SPEC.items()},
                weather=R.WEATHER, zones=R.ZONES, speeds=R.SPEEDS, res=R.RESOURCES, res_label=R.RES_LABEL,
                difficulty={k: v['label'] for k, v in R.DIFFICULTY.items()}, neutral_color=R.NEUTRAL_COLOR,
                seasons=R.SEASON_LABEL, traits=R.GENERAL_TRAITS, ranks=R.GENERAL_RANKS, formations=R.FORMATIONS,
                formation_speed=R.FORMATION_SPEED, plans=R.PLANS, phases=R.PHASES, spy=R.SPY, spy_days=R.SPY_INTEL_DAYS,
                tax_labels=R.TAX_LABELS, water=dict(speed=R.WATER_SPEED, sea=R.SEA_SPEED, embark=R.EMBARK_DAYS,
                                                    quai=R.QUAI_LIVRES, blockade=R.BLOCKADE_K))


def _gen(g):
    return dict(name=g['name'], rank=R.GENERAL_RANKS[g['lvl'] - 1], trait=g['trait'], lvl=g['lvl'], xp=round(g['xp'], 1)) if g else None


def _reg(r):
    return [r['id'], r['type'], round(r['n']), r['max'], round(r['xp']), round(r['morale'])]


def _legs(a):
    out = []
    for leg in a['path']:
        if leg['kind'] == 'road':
            out.append(dict(e=leg['e'], frm=leg['frm'], to=leg['to'], pos=round(leg['pos'], 2)))
        else:
            out.append(dict(pts=[[round(p[0], 2), round(p[1], 2)] for p in leg['pts'][max(0, leg['i'] - 1):]]))
    return out


def player_state(g, since=0):
    if g._dirty_income:
        g.compute_income()
    p = g.player
    me = g.factions[p]
    vis, srcs = g.visible_armies(p)
    side = {c for c in g.factions if g.friendly(p, c) or g.factions[c]['overlord'] == p or me['overlord'] == c} | {p}

    def seen(x, y):
        for sx, sy, r in srcs:
            if (sx - x) ** 2 + (sy - y) ** 2 <= r * r:
                return True
        return False

    nodes = []
    for n in g.nodes:
        gn = g.geo.nodes[n['id']]
        d = dict(id=n['id'], o=n['owner'], f=n['fort'], d=n['dev'], s=round(n['stab'], 2),
                 sg=dict(by=n['siege']['by'], dmg=round(n['siege']['dmg'], 2), occ=bool(n['siege'].get('occupy')))
                 if n['siege'] else None)
        if n['id'] in g._blockade:
            d['bk'] = 1
        if n['owner'] in side:
            d['m'] = round(n['milice'])
            d['mm'] = round(n['milice_max'] * (1 + g.mod(n['owner'], 'milice')))
            d['g'] = [_reg(r) for r in n['garrison']]
            if n['owner'] == p:
                d['fx'] = g.fort_max(p, n['id'])
                d['q'] = [dict(kind=q['kind'], what=q['what'], left=round(q['left'], 1), total=round(q['total'], 1)) for q in n['queue']]
        elif g.intel_active(p, n['id']):
            d['m'] = round(n['milice'])
            d['gm'] = round(sum(r['n'] for r in n['garrison']))
            d['g'] = [[None, r['type'], round(r['n']), r['max'], 0, round(r['morale'])] for r in n['garrison']]
            d['intel'] = g.date_str(me['intel'][str(n['id'])])
        elif seen(gn['x'], gn['y']):
            d['m'] = round(n['milice'])
            d['gm'] = round(sum(r['n'] for r in n['garrison']))
        spy = next((s for s in g.spies if s['by'] == p and s['node'] == n['id']), None)
        if spy:
            d['spy'] = dict(kind=spy['kind'], left=round(spy['done'] - g.t, 1))
        nodes.append(d)

    armies = []
    for a in g.armies.values():
        if a['id'] not in vis:
            continue
        d = dict(id=a['id'], o=a['owner'], name=a['name'], x=round(a['x'], 2), y=round(a['y'], 2), st=a['state'],
                 sk=a['stance'], h=a['hidden'], n=a['at_node'], men=round(g.army_men(a)),
                 gen=_gen(a.get('gen')), fm=a.get('fm', 'ligne'))
        if a.get('boat'):
            d['boat'] = 1
        if a['edge']:
            e = g.geo.edges[a['edge']['e']]
            d['e'] = [e['id'], a['edge']['frm'], round(a['edge']['pos'] / e['len'], 4)]
        if a['owner'] == p:
            d['regs'] = [_reg(r) for r in a['regs']]
            d['md'] = a['mode']
            d['sup'] = round(a['supply'], 2)
            d['path'] = _legs(a)
            d['bt'] = a['battle']
            d['pl'] = a.get('pl', 'frontal')
            d['auto'] = bool(a.get('tac_auto', True))
            d['sp'] = round(g.army_speed(a), 1)
            if a.get('emb', 0) > 0:
                d['emb'] = round(a['emb'], 2)
            if a.get('_fire'):
                d['fire'] = 1
        else:
            d['regs'] = [[None, r['type'], round(r['n']), r['max'], 0, 0] for r in a['regs']]
        armies.append(d)

    battles = []
    for bt in g.battles.values():
        involved = any(s['owner'] in side for s in bt['sides'])
        if not involved and not seen(bt['x'], bt['y']):
            continue
        sides = []
        for i, s in enumerate(bt['sides']):
            tac = []
            for aid in s['armies']:
                a = g.armies.get(aid)
                if a:
                    tac.append(dict(id=aid, name=a['name'], fm=a.get('fm', 'ligne'), pl=a.get('pl', 'frontal'),
                                    gen=_gen(a.get('gen')), reorg=g.t - a.get('fm_t', -9) < 0.1))
            mix = {}
            for _, r, _ in g.side_units(bt, i):
                c = g.arm_class(r['type'])
                mix[c] = mix.get(c, 0) + round(r['n'])
            if s['node'] is not None:
                mix['milice'] = round(g.nodes[s['node']]['milice'])
            sides.append(dict(o=s['owner'], men=round(g.side_men(bt, i)), lost=round(s['lost']),
                              mor=round(g.side_morale(bt, i)), armies=s['armies'], tac=tac, mix=mix))
        battles.append(dict(id=bt['id'], x=round(bt['x'], 2), y=round(bt['y'], 2), node=bt['node'], amb=bt['ambush'],
                            age=round(g.t - bt['t0'], 2), terrain=bt['terrain'], phase=bt.get('phase', 'fusillade'),
                            land=bool(bt.get('landing')), river=bt.get('river', 0), sides=sides))

    facs = []
    for code, f in g.factions.items():
        facs.append(dict(code=code, alive=f['alive'], nodes=len(g.owned_nodes(code)),
                         power=int(round(g.faction_power(code), -2)), st=g.status(p, code) if code != p else 'self',
                         rel=round(f['rel'].get(p, 0)) if code != p else None,
                         trade=bool(me['trade'].get(code)), over=f['overlord'],
                         truce=g.date_str(me['truce'][code]) if code in me['truce'] else None,
                         wars=[o for o in g.factions if o != code and g.at_war(code, o)],
                         cap_owner=g.nodes[g.capital_of(code)]['owner'], techs=len(f['techs'])))

    has_port = any('port' in g.geo.nodes[n['id']]['spec'] for n in g.owned_nodes(p))
    tb, cov = g.tools_bonus(p)
    mine = dict(code=p, res={k: round(v, 1) for k, v in me['res'].items()},
                income={k: round(v, 2) for k, v in me['income'].items()}, slider=me['slider'],
                research={b: (dict(tech=v['tech'], left=round(v['left'], 1), total=v['total']) if v else None)
                          for b, v in me['research'].items()},
                techs=me['techs'], cov=round(cov, 2), tools_bonus=round(tb, 3), cap=round(me.get('_cap', 0), 2),
                upkeep={k: round(v, 2) for k, v in me.get('_upkeep', {}).items()},
                trade={k: round(v, 2) for k, v in me.get('_trade', {}).items()},
                unit_costs={u: g.unit_cost(p, u) for u in R.UNITS}, unit_days={u: round(g.unit_days(p, u), 1) for u in R.UNITS},
                floor=me.get('_floor', {}), tax=me.get('tax', 0.5), order=_order(g, p),
                spies=[dict(node=s['node'], kind=s['kind'], left=round(s['done'] - g.t, 1)) for s in g.spies if s['by'] == p],
                has_port=has_port, famine=bool(me.get('famine')), banqueroute=bool(me.get('banqueroute')),
                stats={k: int(v) for k, v in me['stats'].items()}, mods={k: round(v, 3) for k, v in me['mods'].items()})

    return dict(t=round(g.t, 3), date=g.date_str(), season=g.season(), speed=g.speed_idx, over=g.over,
                weather={z: dict(kind=w['kind'], left=w['left']) for z, w in g.weather.items()},
                me=mine, factions=facs, nodes=nodes, armies=armies, battles=battles,
                events=[e for e in g.events if e['seq'] > since], seq=g.seq,
                proposals=[dict(id=x['id'], frm=x['frm'], action=x['action'], amount=x['amount'], give=x['give'],
                                get=x['get'], date=x['date']) for x in g.proposals],
                market=dict(prices=g.market, spread=[1.15, 0.85] if has_port else [1.4, 0.6]),
                flood=g.t < g.flood_until, vis=[[round(x, 1), round(y, 1), round(r, 1)] for x, y, r in srcs])


def _order(g, p):
    """Ordre public : moyenne, places agitées, places menacées de révolte."""
    mine = g.owned_nodes(p)
    if not mine:
        return dict(avg=0, unrest=[], risk=[], target=1)
    held = {a['at_node'] for a in g.armies.values() if a['owner'] == p and a['at_node'] is not None}
    unrest, risk = [], []
    for n in mine:
        if n['stab'] < 0.6:
            unrest.append([n['id'], round(n['stab'], 2)])
        if n['stab'] < 0.45 and not n['garrison'] and n['id'] not in held \
                and g.geo.nodes[n['id']]['type'] != 'capitale':
            risk.append(n['id'])
    tgt = g.stab_targets().get(p, 1.0)
    return dict(avg=round(sum(n['stab'] for n in mine) / len(mine), 3), unrest=sorted(unrest, key=lambda u: u[1])[:12],
                risk=risk, target=round(max(0.1, min(1.0, tgt)), 2))
