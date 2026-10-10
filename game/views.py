"""Vues envoyées au navigateur et sauvegarde/chargement."""
import random

from . import rules as R
from .engine import Game

SAVE_KEYS = ['player', 'difficulty', 'seed', 't', 'uid', 'seq', 'events', 'proposals', 'armies', 'battles', 'over',
             'flood_until', 'market', 'weather', 'factions', 'nodes', '_ai_clock']


def to_dict(g):
    d = {k: getattr(g, k) for k in SAVE_KEYS}
    d['diplo'] = [[a, b, s] for (a, b), s in g.diplo.items()]
    d['version'] = 1
    return d


def from_dict(geo, d):
    g = Game.__new__(Game)
    g.geo = geo
    for k in SAVE_KEYS:
        setattr(g, k, d[k])
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
    from .ai import AI
    g.ais = {c: AI(g, c) for c in R.FACTIONS if c != g.player}
    for c in g.factions:
        g.recompute_mods(c)
    g.compute_income()
    return g


def rules_payload():
    build = {k: dict(name=b['name'], max=b['max'], desc=b['desc'], costs=[b['cost'](l) for l in range(b['max'])],
                     days=[b['days'](l) for l in range(b['max'])]) for k, b in R.BUILD.items()}
    return dict(factions=R.FACTIONS, units=R.UNITS, unit_order=R.UNIT_ORDER, techs=list(R.TECH.values()),
                branches=R.BRANCHES, build=build, node_base=R.NODE_BASE, spec={k: v['label'] for k, v in R.SPEC.items()},
                weather=R.WEATHER, zones=R.ZONES, speeds=R.SPEEDS, res=R.RESOURCES, res_label=R.RES_LABEL,
                difficulty={k: v['label'] for k, v in R.DIFFICULTY.items()}, neutral_color=R.NEUTRAL_COLOR,
                seasons=R.SEASON_LABEL)


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
                 sg=dict(by=n['siege']['by'], dmg=round(n['siege']['dmg'], 2)) if n['siege'] else None)
        if n['owner'] in side:
            d['m'] = round(n['milice'])
            d['mm'] = round(n['milice_max'] * (1 + g.mod(n['owner'], 'milice')))
            d['g'] = [_reg(r) for r in n['garrison']]
            if n['owner'] == p:
                d['q'] = [dict(kind=q['kind'], what=q['what'], left=round(q['left'], 1), total=round(q['total'], 1)) for q in n['queue']]
        elif seen(gn['x'], gn['y']):
            d['m'] = round(n['milice'])
            d['gm'] = round(sum(r['n'] for r in n['garrison']))
        nodes.append(d)

    armies = []
    for a in g.armies.values():
        if a['id'] not in vis:
            continue
        d = dict(id=a['id'], o=a['owner'], name=a['name'], x=round(a['x'], 2), y=round(a['y'], 2), st=a['state'],
                 sk=a['stance'], h=a['hidden'], n=a['at_node'], men=round(g.army_men(a)))
        if a['edge']:
            e = g.geo.edges[a['edge']['e']]
            d['e'] = [e['id'], a['edge']['frm'], round(a['edge']['pos'] / e['len'], 4)]
        if a['owner'] == p:
            d['regs'] = [_reg(r) for r in a['regs']]
            d['md'] = a['mode']
            d['sup'] = round(a['supply'], 2)
            d['path'] = _legs(a)
            d['bt'] = a['battle']
        else:
            d['regs'] = [[None, r['type'], round(r['n']), r['max'], 0, 0] for r in a['regs']]
        armies.append(d)

    battles = []
    for bt in g.battles.values():
        involved = any(s['owner'] in side for s in bt['sides'])
        if not involved and not seen(bt['x'], bt['y']):
            continue
        battles.append(dict(id=bt['id'], x=round(bt['x'], 2), y=round(bt['y'], 2), node=bt['node'], amb=bt['ambush'],
                            age=round(g.t - bt['t0'], 2), terrain=bt['terrain'],
                            sides=[dict(o=s['owner'], men=round(g.side_men(bt, i)), lost=round(s['lost']),
                                        mor=round(g.side_morale(bt, i)), armies=s['armies']) for i, s in enumerate(bt['sides'])]))

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
                floor=me.get('_floor', {}),
                has_port=has_port, famine=bool(me.get('famine')), banqueroute=bool(me.get('banqueroute')),
                stats={k: int(v) for k, v in me['stats'].items()}, mods={k: round(v, 3) for k, v in me['mods'].items()})

    return dict(t=round(g.t, 3), date=g.date_str(), season=g.season(), speed=g.speed_idx, over=g.over,
                weather={z: dict(kind=w['kind'], left=w['left']) for z, w in g.weather.items()},
                me=mine, factions=facs, nodes=nodes, armies=armies, battles=battles,
                events=[e for e in g.events if e['seq'] > since], seq=g.seq,
                proposals=[dict(id=x['id'], frm=x['frm'], action=x['action'], amount=x['amount'], give=x['give'],
                                get=x['get'], date=x['date']) for x in g.proposals],
                market=dict(prices=g.market, spread=[1.15, 0.85] if has_port else [1.4, 0.6]),
                flood=g.t < g.flood_until)
