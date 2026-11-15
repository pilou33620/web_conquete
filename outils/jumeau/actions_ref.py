"""Jumeau de game/army_actions.py et game/diplomacy.py (rust/conquete/src/army_actions/, diplomacy.rs) : ce qui tourne
sans le reste de la campagne (turns, familles, la prise d'une place et les batailles ne sont pas encore portés).
Écrit rust/conquete/tests/references/actions.json, relu par rust/conquete/tests/actions.rs.

Pour chaque graine : une vraie partie sur la géographie 1 (Game(…)), retouchée (guerre, alliance, vassal, trêve, droits
de passage, prisonniers et généraux captifs, travaux, garde, pourparlers, blocus, renforts, armées placées), rangée
telle quelle dans la référence ; puis une suite d'opérations [nom, arguments…] jouée des deux côtés. On garde le
résultat de chacune, l'empreinte de l'état final (camps, places, armées, journal, propositions, diplomatie) et le
tirage suivant du hasard de la partie.

    python3 outils/jumeau/actions_ref.py
"""
import copy
import json
import random

import commun
from game import army_actions as AA
from game import diplomacy as D
from game import geo as G
from game.engine import Game

GEO = G.GeoMap(1)
JOUEUR = '33'
CODES = ['33', '24', '40', '47', '64']


def owned(g, code):
    return [n['id'] for n in g.nodes if n['owner'] == code]


def placer(g, a, nid, state='idle'):
    gn = GEO.nodes[nid]
    a.update(at_node=nid, x=float(gn['x']), y=float(gn['y']), state=state, path=[], edge=None)


def armee(g, code, nid, regs, **kw):
    a = g.create_army(code, GEO.nodes[nid]['x'], GEO.nodes[nid]['y'], [g.new_reg(t, n, code) for t, n in regs], node=nid)
    a.update(kw)
    return a


def partie(seed):
    g = Game(GEO, JOUEUR, seed=seed)
    rng = random.Random(500 + seed)
    g.t = 37.25 + seed
    for c in CODES:
        for o in g.factions[c]['rel']:
            g.factions[c]['rel'][o] = rng.choice([-80, -30, 0, 12, 25, 45, 70, 18.5])
    g.set_status('33', '24', 'guerre')
    g.set_status('40', '47', 'alliance')
    g.factions['64']['overlord'] = '47'
    g.set_status('64', '47', 'alliance')
    g.factions['33']['truce']['40'] = g.t + 30
    g.factions['40']['truce']['33'] = g.t + 30
    g.factions['33']['trade']['40'] = True
    g.factions['40']['trade']['33'] = True
    g.factions['40']['passage'] = {'33': g.t + 50, '24': g.t - 1}
    g.factions['47']['passage'] = {'33': g.t + 0.5}
    g.factions['33']['passage'] = {'40': g.t + 20}
    g.factions['24']['passage'] = {}
    g.factions['64'].pop('passage', None)
    g.factions['33']['prisoners'] = {'24': 120 + seed}
    g.factions['24']['prisoners'] = {'33': 45}
    g.factions['24']['res']['livres'] = 37 + seed
    g.factions['33']['captifs'] = [dict(gen=g.new_general('24'), de='24') for _ in range(3)]
    g.factions['24']['captifs'] = [dict(gen=g.new_general('33'), de='33')]
    g.factions['33']['captifs'][1]['gen']['lvl'] = 5
    g.factions['33']['res']['bois'] = 400
    # places
    cap33, cap24 = g.capital_of('33'), g.capital_of('24')
    o33 = [v for v in owned(g, '33') if v != cap33]
    o24 = [v for v in owned(g, '24') if v != cap24]
    o47, o64 = owned(g, '47'), owned(g, '64')
    neut = owned(g, 'neutre')
    rng.shuffle(neut)
    v33, v33b = o33[0], o33[1]
    n24, n24b = o24[0], o24[1]
    nn1, nn2, nn3, nn4 = neut[:4]
    for v in (nn1, nn2, nn3, nn4):
        g.nodes[v]['pop'] = rng.choice([0, 800, 3500.0, 12000])
    g.nodes[nn3]['fort'] = 2
    g.nodes[nn3]['garrison'] = [g.new_reg('ligne', 300, 'neutre'), g.new_reg('legere', 4, 'neutre')]
    g.nodes[nn4]['siege'] = dict(by='24', dmg=0.1, since=g.t - 30, blocus=True, food=25, m0=1)
    g.nodes[nn4]['depot'] = True
    g.nodes[cap33]['aa'] = dict(bar=0.75, gd=dict(until=g.t + 3, add=120))
    g.nodes[cap33]['milice_max'] += 120
    g.nodes[n24]['aa'] = dict(bar=0.3, bw=dict(by='a-parti', code='24', kind='red', left=2.0, total=5.0))
    g.nodes[n24b]['aa'] = dict(ng=dict(by='33', army='x', until=g.t, price=55, risk=0.2), gd=dict(until=g.t + 9, add=60),
                               bw=dict(by='x', code='24', kind='bar', left=1, total=3), bar=0.5, cd=dict(garde=g.t))
    g.nodes[n24b]['milice_max'] += 60
    g.nodes[n24b]['milice'] += 60
    # armées
    a33 = next(a for a in g.armies.values() if a['owner'] == '33')
    a24 = next(a for a in g.armies.values() if a['owner'] == '24')
    a40 = next(a for a in g.armies.values() if a['owner'] == '40')
    a47 = next(a for a in g.armies.values() if a['owner'] == '47')
    placer(g, a33, cap33)
    a33['regs'][0]['n'] = 180.0
    a33['regs'][2]['n'] = 150
    a33['morts'] = [[1, 'ligne', 'r999', g.t - 5], [0, 'cavalerie', 'r998', g.t - 60], [3, 'artillerie', 'r997', g.t - 1]]
    a33b = armee(g, '33', v33, [('ligne', 500), ('sapeurs', 80)], qrt=True)
    g.nodes[v33]['aa'] = dict(bw=dict(by=a33b['id'], code='33', kind='bar', left=1.3, total=4.0))
    a33c = armee(g, '33', cap33, [('ligne', 200), ('cavalerie', 90), ('artillerie', 100)])
    a33c['rg'] = dict(node=cap33, until=g.t + 3, ui=g.t + 1, men=250, t0=g.t)
    a33d = armee(g, '33', v33b, [('ligne', 400)])
    a33d['rg'] = dict(node=cap33, until=g.t + 3, men=10, t0=g.t)
    a33n = armee(g, '33', nn1, [('ligne', 900), ('artillerie', 120)], tr=True, hold=True)
    g.nodes[nn1]['aa'] = dict(ng=dict(by='33', army=a33n['id'], until=g.t + 20, price=60, risk=0.3))
    g.nodes[nn2]['aa'] = dict(ng=dict(by='33', army='a-absente', until=g.t + 20, price=45, risk=0.3))
    a24s = armee(g, '24', nn4, [('ligne', 700)], state='siege')
    a24n = armee(g, '24', nn4, [('legere', 40)])   # (amie de la place ? non : neutre ; elle ne compte pas)
    placer(g, a24, cap24)
    placer(g, a40, o47[0])
    a40c = armee(g, '40', o64[0], [('ligne', 300)])
    a40p = armee(g, '40', v33, [('ligne', 100)])
    placer(g, a47, cap33)   # (47 est en paix avec 33, sans droit de passage : terres du joueur fermées)
    g.proposals = [
        dict(id='p900', frm='40', action='commerce', amount=0, give=None, get=None, expires=g.t + 9, date='x'),
        dict(id='p901', frm='47', action='echange', amount=10, give=['bois', 5], get=['fer', 2], expires=g.t + 9, date='x'),
        dict(id='p902', frm='24', action='prisonniers', amount=0, give=None, get=None, expires=g.t + 9, date='x'),
        dict(id='p903', frm='64', action='alliance', amount=0, give=None, get=None, expires=g.t + 9, date='x'),
        dict(id='p904', frm='24', action='paix', amount=0, give=None, get=None, expires=g.t + 9, date='x'),
    ]
    del a33b['tr']
    a33b['trx'] = True
    g.rng = random.Random(seed)
    lieux = dict(cap33=cap33, cap24=cap24, v33=v33, v33b=v33b, n24=n24, n24b=n24b, nn1=nn1, nn2=nn2, nn3=nn3, nn4=nn4,
                 o47=o47[0], o64=o64[0])
    ids = dict(a33=a33['id'], a33b=a33b['id'], a33c=a33c['id'], a33d=a33d['id'], a33n=a33n['id'], a24=a24['id'],
               a24s=a24s['id'], a24n=a24n['id'], a40=a40['id'], a40c=a40c['id'], a40p=a40p['id'], a47=a47['id'])
    return g, lieux, ids


def etat(g):
    return dict(t=g.t, start_ord=g.start_ord, player=g.player, difficulty=g.difficulty, scenario=g.scenario, seed=g.seed,
                uid=g.uid, seq=g.seq, factions=g.factions, nodes=g.nodes, armies=g.armies, events=g.events,
                proposals=g.proposals, diplo=[[list(k), v] for k, v in g.diplo.items()], weather=g.weather,
                y_mont=g.y_mont, x_cote=g.x_cote, tour=g.tour, market=g.market, era_id=g.era_id,
                flood_until=g.flood_until, speed_idx=g.speed_idx)


def operations(seed, g, L, A):
    rng = random.Random(900 + seed)
    ops = []
    tous_a = list(A.values())
    nids = list(L.values())
    ops.append(['fortify', '33', A['a33']])          # (ouvrage encore solide : avant l'usure)
    ops.append(['fortify', '33', A['a33b']])         # (travaux déjà en cours)
    for v in nids:
        ops += [['works_level', v], ['breach', v], ['walled', v], ['siege_k', v], ['output_k', v], ['stab_bonus', v],
                ['garde_info', v], ['req_info', v], ['defenders', v], ['works_name', v, None], ['works_name', v, 'red']]
        for att in (None, '33', 'zz'):
            ops.append(['fort_eff', v, att])
    for c in CODES:
        ops += [['extra_food', c], ['closed_owners', c], ['lost_nodes', c]]
        for o in CODES + ['neutre', 'zz']:
            ops += [['has_passage', c, o], ['closed_to', c, o], ['view_passage', c, o]]
            if o in CODES:
                ops += [['borders', c, o], ['war_refusal', c, o], ['held', c, o], ['captifs', c, o], ['a_echanger', c, o]]
        for res in ('livres', 'vivres', 'fer', 'bois', 'armes', 'outils', 'recrues'):
            ops.append(['value_of', c, res, rng.choice([1, 17, 250])])
    for aid in tous_a:
        ops += [['rangs_info', aid], ['route_level', aid], ['asks', aid], ['morts', aid]]
        if g.armies[aid].get('rg'):
            ops.append(['rangs_ok', aid])
        for c in ('33', '24', '40'):
            ops += [['rangs_place', c, aid], ['rangs_why', c, aid], ['relever_info', c, aid], ['relever_why', c, aid],
                    ['own_place', c, aid, False], ['own_place', c, aid, True], ['foreign_place', c, aid, False],
                    ['foreign_place', c, aid, True]]
        for o in ('33', '64', '47', 'zz'):
            ops.append(['may_stay', aid, o])
        for v in (L['nn1'], L['nn3'], L['cap24']):
            ops += [['force_ratio', '33', v], ['neg_info', aid, v], ['ctb_info', aid, v], ['strong', aid, v],
                    ['fortify_info', aid, v]]
    ops += [['monte', A['a33c'], i] for i in range(3)]
    for owners in ([], ['40', '24'], ['64']):
        ops.append(['cell_mask', owners])
    for k in range(25):
        n = GEO.nodes[rng.randrange(len(GEO.nodes))]
        ops.append(['land_owner', n['x'] + rng.uniform(-6, 6), n['y'] + rng.uniform(-6, 6)])
    ops.append(['land_owner', -50.0, -50.0])
    # itinéraires : des routes (dont des voies d'eau), à travers champs
    eaux = [e for e in GEO.edges if e.get('kind') == 'water']
    routes = [e for e in GEO.edges if e.get('kind') != 'water']
    for k in range(6):
        legs = []
        for _ in range(rng.randint(1, 4)):
            e = rng.choice(routes)
            legs.append(dict(kind='road', e=e['id'], to=e['b']))
        if k % 2:
            e1, e2 = rng.choice(eaux), rng.choice(eaux)
            legs += [dict(kind='road', e=e1['id'], to=e1['b']), dict(kind='road', e=e2['id'], to=e2['b'])]
        a, b, c = (GEO.nodes[rng.randrange(len(GEO.nodes))] for _ in range(3))
        legs.append(dict(kind='off', pts=[[a['x'], a['y']], [b['x'] + 0.37, b['y']], [c['x'], c['y'] - 0.5]]))
        legs.append(dict(kind='off', pts=[]))
        for target in (None, dict(node=L['o64']), dict(x=c['x'], y=c['y']), dict(x=None)):
            for skip in (None, '24'):
                ops.append(['crossed', legs, target, ['24', '40', '47', '64', 'neutre'], skip])
        ops.append(['crossed', legs, None, [], None])
    for who in (['40'], ['40', '64']):
        ops += [['names_of', who], ['closed_msg', who], ['force_question', who]]
    for ai_, frm in (('24', '33'), ('40', '33'), ('47', '33'), ('64', '33'), ('33', '40'), ('40', '24')):
        for amount in (0, 160):
            ops.append(['eval_passage', ai_, frm, amount])
            for action, give, get in (('paix', None, None), ('commerce', None, None), ('echange', ['livres', 100], ['bois', 20]),
                                      ('echange', ['fer', 10], ['vivres', 500]), ('echange', ['bois', 5], ['fer', 9]),
                                      ('passage', None, None), ('prisonniers', None, None), ('soumission', None, None),
                                      ('xyz', None, None)):
                ops.append(['ai_evaluate', ai_, frm, action, amount, give, get])
    for v in nids:
        for mine in (False, True):
            for vis in (False, True):
                ops.append(['view_node', v, mine, vis])
    # ------------------------------------------------------------------ ce qui change la partie
    ops += [['migrate'], ['on_capture', L['n24b']], ['on_capture', L['nn3']], ['rendre_general', '33', 1]]
    ops += [['arrive', A['a33n'], L['nn1'], False], ['arrive', A['a24'], L['cap33'], False]]
    ops += [['set', 'armies', A['a40'], 'tr', True], ['arrive', A['a40'], L['o47'], False]]
    ops += [['set', 'armies', A['a33'], 'tr', True], ['arrive', A['a33'], L['o47'], False],
            ['set', 'armies', A['a33'], 'path', [1]], ['arrive', A['a33'], L['o47'], False],
            ['set', 'armies', A['a33'], 'path', []], ['set', 'armies', A['a33'], 'tr', False],
            ['set', 'armies', A['a33'], 'hold', False], ['set', 'armies', A['a33'], 'state', 'idle']]
    ops += [['set', 'armies', A['a33n'], 'ask', dict(node=L['nn1'], path=[dict(kind='road', e=0, to=8)], target=None)],
            ['ask_alive', A['a33n']], ['asking'], ['set', 'nodes', L['nn1'], 'owner', '33'], ['ask_alive', A['a33n']],
            ['asking'], ['set', 'nodes', L['nn1'], 'owner', 'neutre'], ['set', 'armies', A['a33n'], 'state', 'idle'],
            ['set', 'armies', A['a33n'], 'path', []]]
    ops += [['command', '33', A['a33b'], 'camp'], ['command', '33', A['a33b'], 'camp'], ['command', '33', A['a33'], 'quarters'],
            ['command', '33', A['a33'], 'quarters'], ['command', '33', A['a33n'], 'quarters'], ['command', '33', 'zz', 'quarters'],
            ['command', '33', 5, 'quarters'], ['command', '24', A['a33'], 'quarters'], ['command', '33', A['a33'], 'dance'],
            ['command', '33', A['a33'], 7], ['command', '33', A['a33'], 'rangs_stop'], ['command', '33', A['a33'], 'conquer'],
            ['command', '33', A['a33'], 'blocus'], ['command', '33', A['a33n'], 'neg'], ['command', '33', A['a33'], 'bombard'],
            ['command', '33', A['a33d'], 'rangs_stop'], ['command', '33', A['a33d'], 'rangs_stop']]
    ops += [['quarters', '33', A['a33b'], True], ['quarters', '33', A['a33c'], True], ['quarters_tick', 0.25],
            ['quarters_tick', 0.5], ['stab_bonus', L['cap33']], ['stab_bonus', L['v33']], ['extra_food', '33']]
    ops += [['works_tick', L['v33'], 0.5], ['works_tick', L['v33'], 1.0], ['wear_tick', L['cap33'], 0.25],
            ['wear_tick', L['n24'], 2.0], ['works_tick', L['n24'], 0.5]]
    ops += [['set', 'nodes', L['v33b'], 'aa', dict(bw=dict(by=A['a33'], code='33', kind='bar', left=1, total=3))],
            ['works_tick', L['v33b'], 0.25]]
    for k in range(4):
        ops += [['rangs_tick', 0.25 + 0.5 * k], ['rangs_info', A['a33c']]]
    ops += [['set', 'armies', A['a33c'], 'rg', dict(node=L['cap33'], until=g.t, ui=g.t, men=250, t0=g.t)],
            ['rangs_tick', 0.25]]
    for k in range(5):
        ops += [['blockade_tick', L['nn4'], 0.5], ['defenders', L['nn4']]]
    ops += [['set', 'nodes', L['nn4'], 'siege', 'since', g.t - 2], ['blockade_tick', L['nn4'], 0.5],
            ['set', 'nodes', L['nn4'], 'fort', 2], ['command', '24', A['a24s'], 'bombard'], ['command', '24', A['a24s'], 'bombard']]
    ops += [['land_tick', A['a40c'], 0.25], ['land_tick', A['a40p'], 0.25], ['land_tick', A['a40'], 0.25],
            ['land_tick', A['a47'], 0.25], ['land_tick', A['a47'], 0.25], ['land_tick', A['a24'], 0.25]]
    ops += [['set_t', g.t + 6.5], ['land_tick', A['a40c'], 0.25], ['land_tick', A['a47'], 0.25], ['land_tick', A['a47'], 0.25]]
    ops += [['tick', 0.1, False], ['tick', 0.2, False], ['tick', 0.05, True], ['set_t', g.t + 7.5], ['tick', 0.3, False],
            ['passage_tick'], ['end_garde', L['cap33'], False], ['end_garde', L['cap33'], False]]
    ops += [['revoke_passage', '40', '33'], ['revoke_passage', '40', '64'], ['revoke_passage', '64', '33']]
    ops += [['act', '33', '40', 'commerce', 0, None, None], ['act', '33', '47', 'commerce', 0, None, None],
            ['act', '33', '47', 'echange', 0, ['livres', 50], ['bois', '12']],
            ['act', '33', '40', 'echange', 0, ['bois', 5], ['bois', 5]], ['act', '33', '40', 'echange', 0, ['bois'], ['fer', 3]],
            ['act', '33', '40', 'echange', 0, None, ['fer', 3]], ['act', '33', '40', 'echange', 0, ['xx', 1], ['fer', 3]],
            ['act', '33', '40', 'echange', 0, ['bois', 100000], ['fer', 3]],
            ['act', '33', '40', 'echange', 0, ['bois', 5], ['recrues', 100000]],
            ['act', '33', '40', 'echange', 0, ['bois', 'abc'], ['fer', 3]],
            ['act', '33', '40', 'echange', 0, ['bois', 2.9], ['fer', -4]],
            ['act', '33', '64', 'echange', 'x9', ['livres', 5], ['fer', 3]],
            ['act', '33', '64', 'echange', 7000, ['livres', 5], ['fer', 3]],
            ['act', '33', '33', 'commerce', 0, None, None], ['act', '33', 'zz', 'commerce', 0, None, None],
            ['act', '33', 5, 'commerce', 0, None, None], ['act', '33', None, 'commerce', 0, None, None],
            ['act', '33', '40', 'rompre', 0, None, None], ['act', '40', '47', 'rompre', 0, None, None],
            ['act', '47', '64', 'rompre', 0, None, None], ['act', '33', '40', 'fin_commerce', 0, None, None],
            ['act', '33', '40', 'fin_passage', 0, None, None], ['act', '33', '40', 'fin_passage', 0, None, None],
            ['act', '33', '24', 'passage', 0, None, None],
            ['act', '33', '40', 'prisonniers', 0, None, None], ['act', '33', '40', 'cadeau', 'abc', None, None],
            ['act', '33', '40', 'cadeau', [1], None, None], ['act', '33', '40', 'cadeau', 0, None, None],
            ['act', '33', '40', 'cadeau', -5, None, None], ['act', '33', '40', 'cadeau', 12.7, None, None],
            ['act', '33', '40', 'cadeau', '80', None, None], ['act', '33', '40', 'cadeau', None, None, None],
            ['act', '33', '40', 7, 0, None, None], ['act', '33', '40', 'xyz', 3, None, None]]
    ops += [['answer', 'p999', True], ['answer', 5, True], ['answer', 'p903', False], ['answer', 'p900', True],
            ['answer', 'p901', True], ['answer', 'p902', True], ['answer', 'p902', True]]
    ops += [['act', '33', '24', 'prisonniers', 0, None, None], ['exchange_prisoners', '33', '24'],
            ['exchange_prisoners', '40', '47'], ['make_alliance', '24', '64'], ['borders', '33', '24']]
    for c in CODES:
        ops += [['held', c, '24'], ['captifs', c, '33']]
    ops.append(['rng'])
    return ops


def jouer(g, op):
    nom, args = op[0], op[1:]
    A = lambda aid: g.armies[aid]
    N = lambda v: g.nodes[v]
    if nom == 'set':
        o = dict(armies=g.armies, nodes=g.nodes, factions=g.factions)[args[0]]
        for k in args[1:-2]:
            o = o[k]
        o[args[-2]] = copy.deepcopy(args[-1])
        return None
    if nom == 'set_t':
        g.t = args[0]
        return None
    if nom == 'rng':
        return g.rng.random()
    if nom == 'fortify':
        return list(AA.fortify(g, args[0], A(args[1])))
    if nom in ('works_level', 'breach', 'walled', 'siege_k', 'garde_info', 'req_info'):
        return getattr(AA, nom)(N(args[0]))
    if nom in ('output_k', 'stab_bonus', 'defenders'):
        return getattr(AA, nom)(g, N(args[0]))
    if nom == 'works_name':
        return AA.works_name(N(args[0]), args[1])
    if nom == 'fort_eff':
        return AA.fort_eff(g, N(args[0]), args[1])
    if nom == 'closed_owners':
        return sorted(AA.closed_owners(g, args[0]))
    if nom in ('extra_food', 'lost_nodes'):
        return (AA.extra_food if nom == 'extra_food' else D.lost_nodes)(g, args[0])
    if nom in ('has_passage', 'closed_to', 'view_passage'):
        return getattr(AA, nom)(g, *args)
    if nom in ('borders', 'war_refusal', 'held', 'a_echanger'):
        return getattr(D, nom)(g, *args)
    if nom == 'captifs':
        return [c['gen']['id'] for c in D.captifs(g, *args)]
    if nom == 'value_of':
        return D.value_of(g, *args)
    if nom in ('rangs_info', 'route_level', 'asks', 'morts', 'rangs_ok', 'ask_alive'):
        r = getattr(AA, nom)(g, A(args[0]))
        return list(r) if isinstance(r, tuple) else r
    if nom in ('rangs_place', 'rangs_why', 'relever_info', 'relever_why'):
        r = getattr(AA, nom)(g, args[0], A(args[1]))
        return list(r) if isinstance(r, tuple) else r
    if nom in ('own_place', 'foreign_place'):
        return list(getattr(AA, nom)(g, args[0], A(args[1]), args[2]))
    if nom == 'may_stay':
        return AA.may_stay(g, A(args[0]), args[1])
    if nom == 'force_ratio':
        return AA.force_ratio(g, args[0], args[1])
    if nom in ('neg_info', 'ctb_info', 'strong', 'fortify_info'):
        r = getattr(AA, nom)(g, A(args[0]), args[1])
        return list(r) if isinstance(r, tuple) else r
    if nom == 'monte':
        return AA.monte(A(args[0])['regs'][args[1]])
    if nom == 'cell_mask':
        m = AA.cell_mask(g, frozenset(args[0]))
        return None if m is None else [[i, v] for i, v in enumerate(m) if v]
    if nom == 'land_owner':
        return AA.land_owner(g, *args)
    if nom == 'crossed':
        return AA.crossed(g, args[0], args[1], frozenset(args[2]), args[3])
    if nom in ('names_of', 'closed_msg', 'force_question'):
        return getattr(AA, nom)(g, args[0])
    if nom == 'eval_passage':
        return list(AA.eval_passage(g, *args))
    if nom == 'ai_evaluate':
        return list(D.ai_evaluate(g, *args))
    if nom == 'view_node':
        n = N(args[0])
        d = dict(sg={}) if n['siege'] else {}
        AA.view_node(g, n, d, args[1], lambda: args[2])
        return d
    if nom == 'migrate':
        return AA.migrate(g)
    if nom == 'on_capture':
        return AA.on_capture(g, args[0])
    if nom == 'arrive':
        return AA.arrive(g, A(args[0]), args[1], args[2])
    if nom == 'asking':
        a = AA.asking(g)
        return None if a is None else a['id']
    if nom == 'command':
        return list(AA.command(g, *args))
    if nom == 'quarters':
        return list(AA.quarters(g, args[0], A(args[1]), args[2]))
    if nom == 'quarters_tick':
        return AA.quarters_tick(g, args[0])
    if nom in ('works_tick', 'wear_tick'):
        n = N(args[0])
        return getattr(AA, nom)(g, n, n['aa'], args[1])
    if nom == 'rangs_tick':
        return AA.rangs_tick(g, args[0])
    if nom == 'blockade_tick':
        n = N(args[0])
        return AA.blockade_tick(g, n, g.besiegers(n), args[1])
    if nom == 'land_tick':
        return AA.land_tick(g, A(args[0]), args[1])
    if nom == 'tick':
        return AA.tick(g, args[0], args[1])
    if nom == 'passage_tick':
        return AA.passage_tick(g)
    if nom == 'end_garde':
        return AA.end_garde(g, N(args[0]), args[1])
    if nom == 'revoke_passage':
        return list(AA.revoke_passage(g, *args))
    if nom == 'act':
        try:   # (comme server.py : une entrée invalide du navigateur)
            return list(D.act(g, *args))
        except (KeyError, ValueError, TypeError, OverflowError, IndexError) as e:
            return [False, f'Commande invalide ({e}).']
    if nom == 'answer':
        return list(D.answer(g, *args))
    if nom == 'rendre_general':
        return D.rendre_general(g, args[0], g.factions[args[0]]['captifs'][args[1]])
    if nom == 'exchange_prisoners':
        return D.exchange_prisoners(g, *args)
    if nom == 'make_alliance':
        return D.make_alliance(g, *args)
    raise ValueError(nom)


def final(g):
    return dict(factions=commun.empreinte_ordre(g.factions), nodes=commun.empreinte_ordre(g.nodes),
                armies=commun.empreinte_ordre(g.armies), events=commun.empreinte_ordre(g.events),
                proposals=commun.empreinte_ordre(g.proposals), diplo=[[list(k), v] for k, v in g.diplo.items()],
                qn=sorted(getattr(g, '_aa_qn', ())), aa=[g._aa_dt, getattr(g, '_aa_day', -1)], n_events=len(g.events),
                last_events=[e['text'] for e in g.events[-12:]])


cas = []
for seed in (1, 5, 9):
    g, L, A = partie(seed)
    e0 = json.loads(json.dumps(etat(g)))
    ops = operations(seed, g, L, A)
    res = [jouer(g, op) for op in ops]
    cas.append(dict(seed=seed, etat=e0, ops=ops, res=res, fin=final(g)))
commun.ecrire('actions', dict(cas=cas))
