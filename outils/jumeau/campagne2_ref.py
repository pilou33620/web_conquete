"""Jumeau de game/engine.py, lignes 1525 à 2705 (rust/conquete/src/engine/armees.rs, chemins.rs) : ce qui tourne sans
le reste de la partie (généraux, réserve, talents, risques, hégémon, canons des remparts, arêtes et places voisines,
préfixe à bord, sièges, pauses, train). Écrit rust/conquete/tests/references/campagne2.json, relu par
rust/conquete/tests/campagne2.rs.

Pour chaque graine : un état de départ (camps, armées, places ; tiré ici, relu tel quel par le Rust), puis une suite
d'opérations [nom, arguments…] jouée des deux côtés ; on garde le résultat de chacune, l'état final et le tirage suivant
du hasard de la partie. (Les armées du joueur ne sont ni blessées ni promues : le journal n'est pas encore porté.)

    python3 outils/jumeau/campagne2_ref.py
"""
import copy
import json
import random

import commun
from game import geo as G
from game import rules as R
from game.engine import Game

GEO = G.GeoMap(3)
CODES = ['33', '24', '40', '47', '64', '17']
JOUEUR = '33'
EAU = next(e for e in GEO.edges if e.get('kind') == 'water')
TRAITS = list(R.GENERAL_TRAITS)


def general(rng, code, k):
    lvl = rng.randint(1, 5)
    return dict(id=f"g{code}-{k}", name=rng.choice(R.SURNAMES), trait=rng.choice(TRAITS), lvl=lvl,
                xp=R.GENERAL_XP[lvl - 1] + rng.choice([0, 1, 2.5]), vic=rng.randint(0, 7),
                talents=[], medailles=[['Ordre de Saint-Louis', 'x', '1 mai 1790']] * rng.randint(0, 4), etats=[])


def etat_initial(seed):
    rng = random.Random(1000 + seed)
    factions = {c: dict(name=c, mods={}) for c in CODES}
    factions['33']['generaux'] = [general(rng, '33', 10 + k) for k in range(5)]
    factions['33']['generaux'][1]['retour'] = 50.0
    factions['24']['generaux'] = [general(rng, '24', 10)]
    factions['24']['gid'] = 4
    nodes = []
    for i in range(14):
        o = rng.choice(['24', '24', '40', '47', '64', '33', 'neutre'])
        nodes.append(dict(id=i, owner=o, fort=rng.choice([0, 1, 2, 2.0, 3, 5]), siege=None, milice=10.0, garrison=[]))
    armies = {}
    for i in range(10):
        owner = CODES[i % 5]
        regs = [dict(type='ligne', n=600.0, morale=rng.choice([50, 3.0, 72.5])), dict(type='artillerie', n=120, morale=4)]
        armies[f"a{i}"] = dict(id=f"a{i}", owner=owner, name=f"{i}e Armée", regs=regs, x=10.0 + i, y=20.5 + i,
                               at_node=i if i < 7 else None, path=[], target=None, state='idle', edge=None, boat=False,
                               battle=None, gen=general(rng, owner, i), rail=False, emb=0.0)
        nodes[i]['owner'] = owner if i in (0, 2, 4) else nodes[i]['owner']
    armies['a0']['gen']['lvl'] = 3
    armies['a0']['gen']['talents'] = []
    armies['a6']['gen'] = None
    # siège de la place 3 par le camp de a3 (et a8 : même camp, ailleurs)
    nodes[3]['siege'] = dict(by=armies['a3']['owner'], dmg=0.2, since=1.0)
    armies['a3']['state'] = 'siege'
    armies['a1']['at_node'] = 3
    armies['a1']['owner'] = armies['a3']['owner']
    armies['a1']['state'] = 'siege'
    # à bord, au milieu d'une voie d'eau
    armies['a8'].update(boat=True, edge=dict(e=EAU['id'], frm=EAU['a'], pos=1.5))
    armies['a9'].update(boat=True, edge=None, at_node=None)
    armies['a7'].update(rail=True, emb=0.6)
    return json.loads(json.dumps(dict(factions=factions, armies=armies, nodes=nodes)))


def operations(seed, etat):
    rng = random.Random(2000 + seed)
    ops = []
    for c in CODES + ['zz']:
        ops += [['gid', c], ['new_general', c]]
    for c in CODES:
        ops += [['prendre_general', c], ['generaux', c]]
    ops += [['blesser', 'a1', None], ['blesser', 'a2', None], ['blesser', 'a3', 2], ['blesser', 'a2', None], ['tuer', 'a4'],
            ['tuer', 'a6'], ['risques', 'a6', 'defaite', False]]
    for aid in ('a1', 'a2', 'a3', 'a4', 'a7', 'a8'):
        for issue in ('victoire', 'defaite', 'aneantie'):
            ops.append(['risques', aid, issue, rng.random() < 0.5])
    ops += [['set_t', 37.6], ['risques', 'a4', 'aneantie', True], ['risques', 'a9', 'defaite', False]]
    ops += [['general_xp', 'a4', 5, True], ['general_xp', 'a4', 0.34, False], ['general_xp', 'a9', 20, True],
            ['general_xp', 'a7', 1.0, False], ['general_xp', 'a8', 40, False], ['offres_talent', 'a4'], ['offres_talent', 'a9'],
            ['offrir_talent', 'a0'], ['choisir_talent', JOUEUR, 'a0', '@promo'], ['choisir_talent', JOUEUR, 'a0', 'rien'],
            ['choisir_talent', '24', 'a0', '@promo'], ['choisir_talent', JOUEUR, 'a0', '@promo'], ['offrir_talent', 'a9']]
    ops += [['reserver', '24', dict(id='g24-x', name='Colonel', trait='prudent', lvl=1, xp=0, vic=0, talents=[], medailles=[])],
            ['reserver_armee', '24', 'a1'], ['reserver_armee', 'zz', 'a1']]
    for k in range(4):
        ops.append(['reserver', '33', dict(id=f'g33-r{k}', name='Lacoste', trait='cavalier', lvl=2 + k % 3, xp=3, vic=0, talents=[])])
    ops += [['generaux', c] for c in CODES]
    ops += [['set_t', 100.0], ['soigner'], ['generaux', '40'], ['generaux', '47']]
    ops += [['nommer', JOUEUR, 'a0', 'g33-13'], ['nommer', JOUEUR, 'a0', 'g33-11'], ['nommer', JOUEUR, 'a5', 'g33-r0'],
            ['nommer', JOUEUR, 'a0', 'g33-r3'], ['nommer', '24', 'a0', 'g33-r2'], ['nommer', JOUEUR, 'a9', 'g33-12']]
    ops += [['moral', aid] for aid in ('a0', 'a2', 'a6', None)]
    ops += [['hegemon'], ['army_men', 'a0'], ['army_men', 'a5'], ['army_pos_node', 'a0'], ['army_pos_node', 'a8']]
    ops += [['fort_guns', i] for i in range(len(etat['nodes']))]
    for i in range(len(etat['nodes'])):
        for c in ('33', '24'):
            for block in ([], ['24'], ['24', '40', 'neutre']):   # (block None : status, pas encore porté)
                ops.append(['passable', c, i, 0, block])
    for e in (GEO.edges[0], GEO.edges[5], GEO.edges[77], GEO.edges[len(GEO.edges) // 2], EAU):
        for frm_a in (True, False):
            for pos in (0.0, 0.3 * e['len'], e['len'], e['len'] + 3.0, -1.0, 0.71):
                ops.append(['edge_xy', e['id'], frm_a, pos])
        ops += [['edge_between', e['a'], e['b']], ['edge_between', e['b'], e['a']], ['edge_between', e['a'], e['a']]]
    for k in range(12):
        n = GEO.nodes[(k * 131 + seed) % len(GEO.nodes)]
        x, y = n['x'] + rng.uniform(-4, 4), n['y'] + rng.uniform(-4, 4)
        ops += [['nearest', x, y, 1e9, False], ['nearest', x, y, 2.0, False], ['nearest', x, y, 60.0, True]]
    ops += [['boat_prefix', aid] for aid in ('a8', 'a9', 'a0')]
    ops += [['besiegers', 3], ['end_siege', 'a3'], ['besiegers', 3], ['end_siege', 'a1'], ['besiegers', 3], ['end_siege', 'a7']]
    for tour in (dict(on=False, end=None), dict(on=True, end=None), dict(on=True, end=12)):
        for aid in ('a0', 'a5', 'a2'):
            ops.append(['paused', aid, tour])
    ops += [['set_state', 'a5', 'retreat'], ['paused', 'a5', dict(on=True, end=12)], ['set_state', 'a5', 'move'],
            ['paused', 'a5', dict(on=True, end=12)]]
    ops += [['rail_switch', 'a7', False], ['rail_switch', 'a7', False], ['rail_switch', 'a7', True], ['rail_switch', 'a2', False],
            ['rail_switch', 'a2', False]]
    for aid in ('a0', 'a2', 'a4'):
        ops += [['start_land', aid, ['24', '40']], ['start_land', aid, []]]
    ops.append(['rng'])
    return ops


def jouer(g, op):
    nom, args = op[0], op[1:]
    A = lambda aid: g.armies[aid] if aid is not None else None
    if nom == 'gid':
        return g.gid(args[0])
    if nom == 'new_general':
        return g.new_general(args[0])
    if nom == 'prendre_general':
        return g.prendre_general(args[0])
    if nom == 'generaux':
        return [x['id'] for x in g.generaux(args[0])]
    if nom == 'blesser':
        return g.blesser_general(A(args[0]), args[1])
    if nom == 'tuer':
        return g.tuer_general(A(args[0]))
    if nom == 'risques':
        return g.risques_general(A(args[0]), args[1], args[2])
    if nom == 'set_t':
        g.t = args[0]
        return None
    if nom == 'general_xp':
        return g.general_xp(A(args[0]), args[1], args[2])
    if nom == 'offres_talent':
        return g.offres_talent(A(args[0])['gen'])
    if nom == 'offrir_talent':
        return g.offrir_talent(A(args[0]))
    if nom == 'choisir_talent':
        cle = args[2]
        if cle == '@promo':
            cle = (A(args[1])['gen'].get('promo') or ['?'])[0]
        return list(g.choisir_talent(args[0], args[1], cle))
    if nom == 'reserver':
        return g.reserver(args[0], copy.deepcopy(args[1]))
    if nom == 'reserver_armee':
        return g.reserver(args[0], A(args[1])['gen'])
    if nom == 'soigner':
        return g.soigner_generaux()
    if nom == 'nommer':
        return list(g.nommer(*args))
    if nom == 'moral':
        return g.moral_medailles(A(args[0]))
    if nom == 'hegemon':
        return g.hegemon()
    if nom == 'army_men':
        return g.army_men(A(args[0]))
    if nom == 'army_pos_node':
        return g.army_pos_node(A(args[0]))
    if nom == 'fort_guns':
        return g.fort_guns(g.nodes[args[0]])
    if nom == 'passable':
        block = None if args[3] is None else frozenset(args[3])
        return g.passable_node(args[0], args[1], None, args[2], block)
    if nom == 'edge_xy':
        e = GEO.edges[args[0]]
        return list(g.edge_xy(e, e['a'] if args[1] else e['b'], args[2]))
    if nom == 'edge_between':
        e = g.edge_between(args[0], args[1])
        return None if e is None else e['id']
    if nom == 'nearest':
        return g.nearest_node(args[0], args[1], (lambda i: i % 3 == 0) if args[3] else None, args[2])
    if nom == 'boat_prefix':
        return g.boat_prefix(A(args[0]))
    if nom == 'besiegers':
        return [a['id'] for a in g.besiegers(g.nodes[args[0]])]
    if nom == 'end_siege':
        return g.end_siege_for(A(args[0]))
    if nom == 'paused':
        g.tour = args[1]
        return [bool(g.paused(A(args[0]))), bool(g.marching(A(args[0])))]   # (paused rend parfois None : la chaîne de and)
    if nom == 'set_state':
        A(args[0])['state'] = args[1]
        return None
    if nom == 'rail_switch':
        return g.rail_switch(A(args[0]), args[1])
    if nom == 'start_land':
        return g.start_land(A(args[0]), frozenset(args[1]))
    if nom == 'rng':
        return g.rng.random()
    raise ValueError(nom)


cas = []
for seed in (1, 7, 12345):
    etat = etat_initial(seed)
    ops = operations(seed, etat)
    g = Game.__new__(Game)
    g.geo, g.seed, g.rng, g.t, g.player = GEO, seed, random.Random(seed), 0.0, JOUEUR
    g.factions, g.armies, g.nodes = copy.deepcopy(etat['factions']), copy.deepcopy(etat['armies']), copy.deepcopy(etat['nodes'])
    g.tour = dict(on=False, end=None)
    res = [jouer(g, op) for op in ops]
    cas.append(dict(seed=seed, etat=etat, ops=ops, res=res, fin=dict(factions=g.factions, armies=g.armies, nodes=g.nodes)))
commun.ecrire('campagne2', dict(cas=cas))
