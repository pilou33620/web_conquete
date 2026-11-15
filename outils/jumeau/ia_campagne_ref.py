"""Jumeau de l'IA de campagne, game/ai.py (rust/conquete/src/ai/) : ses décisions (recherche, dépenses, impôts, douane,
diplomatie, armée, garnisons, réarmement, espionnage) sur des parties variées. Écrit
rust/conquete/tests/references/ia_campagne.json, relu par rust/conquete/tests/ia_campagne.rs.

Pour chaque cas : une vraie partie sur la géographie 1 (Game(…), scénario 1790 ou 1870), retouchée (guerres, alliance,
vassal, trésors, revenus, prix, places abîmées ou assiégées, garnisons, armées dans tous leurs états, une bataille,
armées ennemies aux portes, armes démodées), puis ses IA recréées (AI(g, c)) et retouchées ; l'état est rangé tel quel
dans la référence. Puis des scénarios indépendants : chacun repart d'une copie de cet état, joue quelques opérations
[nom, camp, arguments…] et garde leurs résultats, l'empreinte de l'état final (camps, places, armées, journal,
propositions, diplomatie), l'état de l'IA (horloges, délais, refus, tirage suivant de son hasard) et le tirage suivant
du hasard de la partie.

    python3 outils/jumeau/ia_campagne_ref.py
"""
import copy
import json
import random

import commun
from game import geo as G
from game import rules as R
from game.ai import AI
from game.engine import Game

GEO = G.GeoMap(1)
JOUEUR = '33'
CODES = ['33', '24', '40', '47', '64']
IAS = ['24', '40', '47', '64']


def owned(g, code):
    return [n['id'] for n in g.nodes if n['owner'] == code]


def placer(a, nid, state='idle'):
    gn = GEO.nodes[nid]
    a.update(at_node=nid, x=float(gn['x']), y=float(gn['y']), state=state, path=[], edge=None)


def armee(g, code, nid, regs, **kw):
    a = g.create_army(code, GEO.nodes[nid]['x'], GEO.nodes[nid]['y'], [g.new_reg(t, n, code) for t, n in regs], node=nid)
    a.update(kw)
    return a


def partie(seed, scenario, t):
    g = Game(GEO, JOUEUR, seed=seed, scenario=scenario)
    rng = random.Random(800 + seed)
    g.t = t
    for c in CODES:
        f = g.factions[c]
        for o in f['rel']:
            f['rel'][o] = rng.choice([-80, -45, -25, 0, 12, 18.5, 30, 45, 70, 99.5])
        r = f['res']
        r['livres'] = rng.choice([90, 420, 700, 1300, 2600, 4800, 9000.5, 30000])
        r['armes'] = rng.choice([100, 240, 900, 1400, 4000])
        r['outils'] = rng.choice([10, 200, 700, 2000])
        r['recrues'] = rng.choice([50, 300, 900])
        r['vivres'] = rng.choice([100, 400, 900])
        r['fer'] = rng.choice([40, 200, 500])
        r['bois'] = rng.choice([30, 200, 600])
        f['income'] = dict(livres=rng.choice([-6.0, 0.2, 2.5, 14.0, 60.0]), vivres=rng.choice([-3.0, 0.0, 4.5]),
                           recrues=1.0, industrie=2.0, fer=1.0, bois=1.0, armes=0.5, outils=0.2)
        f['_gross_livres'] = rng.choice([20, 45.5, 120.25, 300.0])
        f['_upkeep'] = rng.choice([None, dict(livres=12.5, vivres=8.0), dict(livres=40.0, vivres=30.5)])
        f['_cov'] = rng.choice([0.4, 0.9])
        f['_douane'] = rng.choice([None, dict(perte=3.0, front=4), dict(perte=40.5, front=3)])
        f['tax'] = rng.choice([0.5, 0.3, 0.1, 0.62])
        f['slider'] = rng.choice([0.5, 0.8, 0.15])
        f['weary'] = rng.choice([0.0, 20.0, 40.0, 70.0])
        f['last_war'] = rng.choice([-730.0, t - 200, t - 4000])
        f['tarif'] = rng.choice([0, 1, 2])
        f['douaniers'] = rng.choice([False, True])
        for b in R.BRANCHES:
            f['research'][b] = None
        for b in rng.sample(R.BRANCHES, rng.choice([0, 1, 2, 4])):
            avail = [t for t in R.TECH.values() if t['branch'] == b and t['id'] not in f['techs']]
            if avail:
                f['research'][b] = dict(tech=avail[0]['id'], left=30.0, total=60.0)
    for k in g.market:
        g.market[k] = R.MARKET_BASE[k] * rng.choice([0.7, 1.0, 1.2, 1.6])
    return g, rng


def retoucher(g, rng, variante):
    t = g.t
    caps = {c: g.capital_of(c) for c in CODES}
    if variante == 3:
        # le joueur éliminé (la diplomatie des IA ne lui propose rien), des relations tièdes (pas de mariage), une guerre
        g.factions['33']['alive'] = False
        for c in CODES:
            for o in g.factions[c]['rel']:
                g.factions[c]['rel'][o] = rng.choice([-60, -25, -5, 0, 8, 15])
        g.set_status('24', '40', 'guerre')
        g.factions['24']['war_since']['40'] = g.factions['40']['war_since']['24'] = t - 10
        g.factions['47']['trade']['64'] = g.factions['64']['trade']['47'] = True
    elif variante == 0:
        g.set_status('24', '40', 'guerre')
        g.factions['24']['war_since']['40'] = g.factions['40']['war_since']['24'] = t - 30
    elif variante == 1:
        g.set_status('24', '40', 'guerre')
        g.set_status('47', '33', 'guerre')
        g.set_status('64', '47', 'guerre')
        for a, b, d in (('24', '40', 200), ('47', '33', 70), ('64', '47', 26)):
            g.factions[a]['war_since'][b] = g.factions[b]['war_since'][a] = t - d
        g.factions['40']['truce']['47'] = t + 30
        g.factions['24']['trade']['64'] = g.factions['64']['trade']['24'] = True
    else:
        g.set_status('24', '47', 'guerre')
        g.set_status('40', '24', 'alliance')
        g.set_status('40', '47', 'guerre')
        g.factions['64']['overlord'] = '47'
        g.set_status('64', '47', 'alliance')
        for a, b, d in (('24', '47', 400), ('40', '47', 100)):
            g.factions[a]['war_since'][b] = g.factions[b]['war_since'][a] = t - d
        g.factions['33']['captifs'] = [dict(gen=g.new_general('24'), de='24')]
        g.factions['33']['prisoners'] = {'40': 120}
    # places : dégâts, agrandissements, garnisons, chantiers, une population à l'étroit
    for c in IAS:
        mine = owned(g, c)
        for nid in mine:
            n = g.nodes[nid]
            n['stab'] = rng.choice([0.5, 0.7, 0.9, 1.0])
            if rng.random() < 0.3:
                n['deg'] = rng.choice([0.05, 0.2, 0.6])
            if rng.random() < 0.3:
                n['dev'] = rng.choice([0, 1, 2, 3])
            if rng.random() < 0.4:
                n['pop'] = g.pop_cap(n) * rng.choice([0.5, 0.95])
            if rng.random() < 0.3:
                n['garrison'] = n['garrison'] + [g.new_reg(rng.choice(['ligne', 'legere', 'garde', 'artillerie']),
                                                             rng.choice([None, 100, 500]), c) for _ in range(rng.randint(1, 4))]
            if rng.random() < 0.15:
                n['queue'] = [dict(kind='build', what=rng.choice(['dev', 'fort', 'repar']), left=3, total=5)]
        cap = caps[c]
        g.nodes[cap]['garrison'] = g.nodes[cap]['garrison'] + [g.new_reg('ligne', None, c) for _ in range(3)]
    # armées
    for c in IAS:
        cap = caps[c]
        foes = [o for o in CODES if o != c and g.at_war(c, o)]
        cibles = [v for v in range(len(g.nodes)) if g.nodes[v]['owner'] in foes] or owned(g, 'neutre')
        a1 = next(a for a in g.armies.values() if a['owner'] == c)
        placer(a1, cap)
        cible = min(cibles, key=lambda v: (GEO.nodes[v]['x'] - GEO.nodes[cap]['x']) ** 2 + (GEO.nodes[v]['y'] - GEO.nodes[cap]['y']) ** 2)
        gx, gy = GEO.nodes[cible]['x'], GEO.nodes[cible]['y']
        # en campagne, à mi-chemin de la cible
        a2 = armee(g, c, cap, [('ligne', 700), ('legere', 500), ('cavalerie', None), ('artillerie', None)])
        a2.update(at_node=None, onroad=False, x=(gx + GEO.nodes[cap]['x']) / 2 + 0.37, y=(gy + GEO.nodes[cap]['y']) / 2)
        # éprouvée, loin de chez elle
        a3 = armee(g, c, cap, [('ligne', 150), ('ligne', 120)], supply=0.2)
        a3.update(at_node=None, onroad=False, x=gx + 4.0, y=gy - 3.0)
        # en marche vers une place
        a4 = armee(g, c, cap, [('legere', None)])
        a4.update(state='move', target=dict(node=cible), at_node=None, x=a2['x'] + 1.0, y=a2['y'])
        # en embuscade
        a5 = armee(g, c, cap, [('legere', None), ('legere', None)], stance='embuscade',
                   ai=dict(then='embuscade', until=g.t + rng.choice([-2, 10])))
        a5.update(at_node=None, onroad=False, x=a2['x'] - 2.0, y=a2['y'] + 1.5)
        if rng.random() < 0.5:
            a1['qrt'] = True
        if rng.random() < 0.3:
            a1['regs'][0]['drill'] = 5.0
        # armes démodées (le réarmement)
        for a in (a1, a2):
            for r in a['regs']:
                if 'arm' in r and r['arm'] > 0 and rng.random() < 0.6:
                    r['arm'] = rng.randint(0, r['arm'] - 1)
        # un siège devant une place de l'ennemi
        if foes:
            fort = [v for v in cibles if g.nodes[v]['fort'] >= 1] or cibles
            sv = fort[rng.randrange(len(fort))]
            a6 = armee(g, c, sv, [('ligne', None), ('ligne', None), ('artillerie', None)], state='siege')
            g.nodes[sv]['siege'] = dict(by=c, dmg=rng.choice([0.0, 0.35, 0.7]), since=g.t - rng.choice([5, 50]))
            a6['onroad'] = True
        # l'ennemi aux portes
        for o in foes[:1]:
            e = armee(g, o, cap, [('ligne', None)] * rng.randint(1, 6))
            e.update(at_node=None, onroad=False, x=GEO.nodes[cap]['x'] + rng.choice([3.0, 12.0, 28.0]), y=GEO.nodes[cap]['y'] - 2.0)
    # une bataille entre deux IA en guerre
    att = next(a for a in g.armies.values() if a['owner'] == '24' and a['at_node'] is None and a['state'] == 'idle')
    de = next(a for a in g.armies.values() if a['owner'] != '24' and g.at_war('24', a['owner']))
    bid = g.nid('b')
    for a in (att, de):
        a.update(state='battle', battle=bid)
    for r in att['regs']:
        r['morale'] = 30.0
    g.battles[bid] = dict(id=bid, x=att['x'], y=att['y'], node=None, t0=g.t,
                          sides=[dict(owner='24', armies=[att['id']], men0=0.0, lost=0.0, node=None),
                                 dict(owner=de['owner'], armies=[de['id']], men0=0.0, lost=0.0, node=None)])
    for r in de['regs']:
        r['n'] = r['n'] * 5
    # (les caches au quart de journée : l'état vient d'être retouché)
    for k in ('_forces', '_frontieres'):
        g.__dict__.pop(k, None)
    g.rng = random.Random(g.seed)
    g.ais = {c: AI(g, c) for c in IAS}
    for c, ai in g.ais.items():
        ai.relief = rng.choice([0.5, 0.3, 0.05, 0.0])
        ai.menace = rng.choice([True, False])
        ai.tax_clock = rng.choice([0.0, g.t + 10])
        ai.cool[('go', 'a-x', 3)] = g.t + 5
        ai.cool[('47', 'paix')] = g.t + rng.choice([-1, 9])
        ai.cool[('33', 'commerce')] = g.t - 3
        ai.refused[5] = g.t - 2


def etat(g):
    ais = {c: dict(relief=ai.relief, menace=ai.menace, tax_clock=ai.tax_clock, cool=[[list(k), v] for k, v in ai.cool.items()],
                   refused=[[k, v] for k, v in ai.refused.items()]) for c, ai in g.ais.items()}
    return dict(t=g.t, start_ord=g.start_ord, player=g.player, difficulty=g.difficulty, scenario=g.scenario, seed=g.seed,
                uid=g.uid, seq=g.seq, factions=g.factions, nodes=g.nodes, armies=g.armies, events=g.events[-5:],
                proposals=g.proposals, battles=g.battles, rails=g.rails, diplo=[[list(k), v] for k, v in g.diplo.items()],
                weather=g.weather, y_mont=g.y_mont, x_cote=g.x_cote, tour=g.tour, market=g.market, era_id=g.era_id,
                flood_until=g.flood_until, speed_idx=g.speed_idx, ais=ais)


def court(o):
    return commun.empreinte_ordre(o)[:16]


def etat_ia(ai):
    return dict(diplo_clock=ai.diplo_clock, spend_clock=ai.spend_clock, tax_clock=ai.tax_clock, relief=ai.relief,
                menace=ai.menace, cool=court([[list(k), v] for k, v in ai.cool.items()]),
                refused=court([[k, v] for k, v in ai.refused.items()]), cool_purge=getattr(ai, 'cool_purge', 0),
                aa_clock=getattr(ai, 'aa_clock', 0), tarif_clock=getattr(ai, 'tarif_clock', 0),
                ct_clock=getattr(ai, '_ct_clock', 0), rally_stale=getattr(ai, '_rally_stale', False),
                rally=getattr(ai, '_rally', None), rng=ai.rng.random())


def scenarios(g):
    sc = []
    nids = sorted({v for c in IAS for v in owned(g, c)[:3]} | {g.capital_of(c) for c in CODES})
    for c in IAS:
        aids = [a['id'] for a in g.armies.values() if a['owner'] == c]
        lect = [['wars', c], ['foes', c], ['reserve', c], ['gross_norm', c], ['idle_money', c], ['regs_total', c],
                ['arms_floor', c], ['arms_purse', c], ['arms_room', c], ['rally_node', c], ['neighbours', c], ['reach', c]]
        lect += [['threat_at', c, v, r] for v in nids for r in (25, 35, 60)]
        for aid in aids:
            lect += [['home_node', c, aid], ['arm_gap', c, aid], ['reach_from', c, aid], ['go_cooled', c, aid, 3]]
        lect += [['menaced', c], ['rally', c], ['rally', c]]
        sc.append(lect)
        for op in (['research'], ['economy'], ['douane'], ['build_depot'], ['recruit'], ['raise_garde'], ['military'],
                   ['rearm'], ['stock_arms'], ['espionage'], ['diplomacy'], ['spend'], ['relieve_taxes'], ['gift', 2500.0],
                   ['stock_up', 900.0], ['repair_towns', 1500.0], ['expand_towns', 2000.0], ['fortify_frontier', 2000.0],
                   ['build_rails', 3000.0], ['buy', 'bois', 120.7], ['buy', 'outils', 5], ['provide'],
                   ['propose', '47', 'paix', 30], ['propose', '33', 'commerce', 0], ['step'], ['step', 'step']):
            if op[0] == 'step' and len(op) == 2:
                sc.append([['step', c], ['set_t', g.t + 2.5], ['step', c], ['set_t', g.t + 9.75], ['step', c]])
            else:
                sc.append([[op[0], c] + op[1:]])
        for k, aid in enumerate(aids):
            for op in ('army_think', 'pick_target', 'try_ambush', 'rearm_detour')[:2 if k >= 3 else 4]:
                sc.append([[op, c, aid]])
            if k < 3:
                sc.append([['go', c, aid, owned(g, c)[-1]], ['go', c, aid, owned(g, c)[-1]]])
    return sc


def scenarios_diplo(g):
    """(le cas sans joueur : la diplomatie entre IA, sans proposition au joueur)"""
    sc = []
    for c in IAS:
        sc += [[['diplomacy', c]], [['diplomacy', c], ['set_t', g.t + 13.0], ['diplomacy', c]], [['research', c]],
               [['recruit', c]], [['economy', c]]]
    return sc


def jouer(g, op):
    nom, args = op[0], op[1:]
    if nom == 'set_t':
        g.t = args[0]
        return None
    ai = g.ais[args[0]]
    A = lambda i: g.armies[args[i]]
    if nom in ('wars', 'foes'):
        r = getattr(ai, nom)()
        return r if nom == 'wars' else [a['id'] for a in r]
    if nom in ('reserve', 'gross_norm', 'idle_money', 'regs_total', 'arms_floor', 'arms_purse', 'arms_room', 'rally_node'):
        return getattr(ai, nom)()
    if nom == 'rally':
        return ai.rally
    if nom == 'neighbours':
        return [[k, sorted(v)] for k, v in sorted(ai.neighbours().items())]
    if nom == 'reach':
        block, comp = ai.reach()
        return [sorted(block), comp if comp is None else commun.empreinte(comp)]
    if nom == 'threat_at':
        return [ai.threat_at(args[1], args[2]), ai.threat_at(args[1], args[2], ai.foes(), {})]
    if nom == 'home_node':
        return ai.home_node(A(1))
    if nom == 'arm_gap':
        return list(ai.arm_gap(A(1)['regs']))
    if nom == 'reach_from':
        comp, starts = ai.reach_from(A(1))
        return None if comp is None else [commun.empreinte(comp), sorted(starts)]
    if nom == 'go_cooled':
        return ai.go_cooled(A(1), args[2])
    if nom == 'menaced':
        return ai.menaced(ai.wars())
    if nom in ('research', 'economy', 'douane', 'build_depot', 'recruit', 'raise_garde', 'military', 'rearm', 'stock_arms',
               'espionage', 'diplomacy', 'spend', 'step'):
        return getattr(ai, nom)()
    if nom == 'relieve_taxes':
        return ai.relieve_taxes(ai.reserve(), ai.wars())
    if nom == 'gift':
        return ai.gift(args[1])
    if nom == 'stock_up':
        return ai.stock_up(args[1], ai.reserve())
    if nom == 'repair_towns':
        return ai.repair_towns(args[1])
    if nom in ('expand_towns', 'build_rails'):
        return getattr(ai, nom)(args[1], ai.wars())
    if nom == 'fortify_frontier':
        return ai.fortify_frontier(args[1], ai.wars(), ai.reserve())
    if nom == 'buy':
        return ai.buy(args[1], args[2])
    if nom == 'provide':
        return [ai.provide(dict(livres=200, bois=500, fer=10), 900.0), ai.provide(dict(livres=200, outils=3000), 900.0)]
    if nom == 'propose':
        return ai.propose(args[1], args[2], args[3])
    if nom in ('army_think', 'pick_target', 'try_ambush', 'rearm_detour', 'rearm_here'):
        a = A(1)
        if a['id'] not in g.armies:
            return 'absente'
        if nom == 'army_think':
            return ai.army_think(a, {})
        if nom == 'pick_target':
            taken = {}
            return [ai.pick_target(a, taken, ai.wars()), sorted(taken.items())]
        if nom == 'rearm_here':
            return ai.rearm_here(a)
        return getattr(ai, nom)(a, ai.wars())
    if nom == 'go':
        return ai.go(A(1), args[2], tr=True)
    raise ValueError(nom)


def final(g, code):
    """(empreintes courtes : 16 caractères de empreinte_ordre)"""
    return dict(factions=court(g.factions), nodes=court(g.nodes), armies=court(g.armies), events=court(g.events[-20:]),
                proposals=court(g.proposals), diplo=court([[list(k), v] for k, v in g.diplo.items()]), market=court(g.market),
                n_events=len(g.events), last_event=g.events[-1]['text'] if g.events else None,
                ia=etat_ia(g.ais[code]), ias=court({c: etat_ia(ai) for c, ai in g.ais.items() if c != code}), rng=g.rng.random())


cas = []
for seed, scenario, t, variante in ((1, '1790', 60.5, 0), (2, '1790', 250.25, 1), (3, '1870', 140.75, 2),
                                    (4, '1790', 400.5, 3)):
    g, rng = partie(seed, scenario, t)
    retoucher(g, rng, variante)
    e0 = json.loads(json.dumps(etat(g)))
    res = []
    for ops in (scenarios(g) if variante < 3 else scenarios_diplo(g)):
        h = copy.deepcopy(g, {id(GEO): GEO})
        r = [jouer(h, op) for op in ops]
        res.append(dict(ops=ops, res=json.loads(json.dumps(r)), fin=json.loads(json.dumps(final(h, ops[0][1])))))
    cas.append(dict(seed=seed, etat=e0, sc=res))
commun.ecrire('ia_campagne', dict(cas=cas))
