"""Jumeau de game/turns.py, rails.py, crue.py, battle_log.py et views.py (rust/conquete/src/turns.rs, rails.rs, crue.rs,
battle_log.rs, views.rs). Écrit rust/conquete/tests/references/tours.json, relu par rust/conquete/tests/tours.rs.

- crue : _hash2, _sn, _bruit, _sur, _rayon, le relief et la distance au fleuve de _Terre, inonde, et spans de la
  géographie 1 ;
- deux sauvegardes d'une vraie partie (géographie 1, jouée ici quelques mois au tour par tour) : l'une en plein tour des
  IA, des batailles en cours, l'autre au tour du joueur, une bataille tactique engagée (le joueur la commande) ;
  pour chacune, ce que Python obtient en la relisant (views.from_dict) puis en la réécrivant (views.to_dict), et la
  vue du navigateur (views.player_state) de la partie relue ;
- sur chaque sauvegarde, posée sans migrate ni IA (la même partie, champ par champ, que l'essai Rust pose : ce qui
  tourne aujourd'hui sans cities, events, familles ni ai), une suite d'opérations [nom, arguments…] jouée des deux
  côtés : le calendrier et le temps en tours, l'estimation des marches, les vues, le récapitulatif, les chemins de fer
  (tronçons ouverts, chantiers, coupures), le journal des batailles (snapshot, tactical) ; puis l'empreinte de l'état.

    python3 outils/jumeau/tours_ref.py
"""
import copy
import json
import os
import random

os.environ['WEB_CONQUETE_NOLOG'] = '1'   # (le journal des batailles n'écrit rien)

import commun
from game import battle_log as BL
from game import crue as CR
from game import events as EV
from game import geo as G
from game import rails as RL
from game import turns as TT
from game import views as V
from game.engine import Game, SUBSTEP
from game.tactics import bridge as TB

GEO = G.GeoMap(1)
JOUEUR = '33'


def j(o):
    """Ce qu'une sauvegarde relue rend (tuples en listes, clés en textes…)."""
    return json.loads(json.dumps(o, ensure_ascii=False))


# ------------------------------------------------------------------ crue
def crue():
    ref = {}
    ref['hash2'] = [[i, j_, k, CR._hash2(i, j_, k)] for i in (0, 1, 7, 255, 999, 4096) for j_ in (0, 3, 640, 2047)
                    for k in (0, 7, 123456)]
    xs = [-20.0, -3.3, -0.5, 0.0, 0.25, 1.0, 3.14159, 6.5, 12.75, 100.1, 1e4 + 0.3]
    ref['sn'] = [[x, CR._sn(x)] for x in xs]
    ref['bruit'] = [[x, y, s, CR._bruit(x, y, s)] for x in xs[:6] for y in xs[3:9] for s in (0.0, 3.3)]
    pts = [[0.0, 0.0], [3.0, 4.0], [3.0, 4.0], [10.0, 4.5]]
    ref['sur'] = [[p, s, list(CR._sur(p, s))] for p in (pts, pts[:2], [[1.0, 1.0], [1.0, 1.0]]) for s in (0.0, 2.5, 5.0, 7.0, 40.0)]
    ref['rayon'] = [[n, CR._rayon(n)] for n in (dict(pop0=0), dict(pop0=None), dict(), dict(pop0=700), dict(pop0=1234.5),
                                                  dict(pop0=50000), dict(pop0=10 ** 6), dict(pop0=120))]
    m = GEO.client_payload()
    T = CR._Terre(GEO, m['rivers'])
    rnd = random.Random(3)
    pts = [(rnd.uniform(-2, GEO.W + 2), rnd.uniform(-2, GEO.H + 2)) for _ in range(1500)]
    # (près des fleuves : là où la crue se décide)
    for r in m['rivers']:
        if r['rank'] == 1 and r['name'] and ('Garonne' in r['name'] or 'Dordogne' in r['name']):
            for p in r['pts'][::3]:
                pts.append((p[0] + rnd.uniform(-1.5, 1.5), p[1] + rnd.uniform(-1.5, 1.5)))
    ref['terre'] = dict(W=T.W, H=T.H, alt=commun.empreinte(list(T.ALT)), crue=commun.empreinte(list(T.CRUE)),
                        alt0=list(T.ALT[:50]), crue_min=min(T.CRUE),
                        pts=[[x, y, T._bil(T.ALT, x, y), T._bil(T.CRUE, x, y), T.inonde(x, y)] for x, y in pts])
    sp = CR.spans(GEO)
    ref['spans'] = dict(empreinte=commun.empreinte_ordre({str(k): v for k, v in sp.items()}), n=len(sp),
                        quelques=[[k, v] for k, v in list(sp.items())[:8]])
    return ref


# ------------------------------------------------------------------ une vraie partie
def pas(g):
    """Un pas du tour des IA (TT.advance sans son budget de temps) ; vrai à la fin du mois."""
    tr = g.tour
    if not g.speed_idx:
        g.pending_ev.clear()   # (décisions : on n'attend pas le joueur)
        for bt in g.battles.values():
            if bt.get('mode') == 'attente':
                bt['mode'] = 'auto'
        TT.go(g)
    sub = SUBSTEP if g.battles else SUBSTEP * 2
    rem = tr['end'] - g.t
    seq0 = g.seq
    if rem <= sub + 1e-6:
        g.step(max(rem, 0.0) + 1e-9)
        g.t = tr['end']
        TT.watch(g, rem, seq0)
        TT.finish(g)
        return True
    g.step(sub)
    TT.watch(g, sub, seq0)
    return False


def parties():
    g = Game(GEO, JOUEUR, seed=11)
    g.settings['battles'] = 'auto'
    g.set_status('33', '24', 'guerre')
    g.set_status('33', '40', 'guerre')
    cap24 = g.capital_of('24')
    a33 = next(a for a in g.armies.values() if a['owner'] == '33')
    g.order_move('33', a33['id'], node=cap24)
    TT.settle(g)
    saves = {}
    for mois in range(3):
        TT.go(g)
        while True:
            fin = pas(g)
            if mois == 2 and 'ia' not in saves and len(g.battles) >= 1 and g.t - int(g.t) > 0.3:
                saves['ia'] = j(V.to_dict(g))   # en plein tour des IA, des batailles en cours
            if fin:
                break
    # au tour du joueur : une bataille contre une armée ennemie, que le joueur commande lui-même
    a33 = next(a for a in g.armies.values() if a['owner'] == '33')
    foe = next(a for a in g.armies.values() if a['owner'] in ('24', '40') and a['state'] != 'battle')
    g.settings['battles'] = 'demander'
    g.start_battle([a33], [foe], (a33['x'] + foe['x']) / 2, (a33['y'] + foe['y']) / 2)
    bt = next(b for b in g.battles.values() if a33['id'] in b['sides'][0]['armies'])
    bt['mode'] = 'attente'
    r = TB.command(g, dict(sub='choose', bid=bt['id'], mode='manuel'))
    assert r['ok'], r
    saves['joueur'] = j(V.to_dict(g))
    return saves


VIEILLES = ['spies', 'scenario', 'start_ord', 'pending_ev', 'ev_done', 'tour', 'rails', 'sites', 'ai_state', 'blockade']


def vieille(s):
    """Une sauvegarde d'avant (clés absentes : DEFAULTS, migrate) : la même, sans ces clés ni les réglages d'une armée."""
    s = copy.deepcopy(s)
    for k in VIEILLES:
        s.pop(k, None)
    a = next(iter(s['armies'].values()))
    for k in ('fm', 'pl', 'fm_t', 'emb', 'mp'):
        a.pop(k, None)
    return s


def assembler(s):
    """La partie d'une sauvegarde, champ par champ, sans migrate ni IA (le même assemblage que l'essai Rust)."""
    s = copy.deepcopy(s)
    g = Game.__new__(Game)
    g.geo = GEO
    for k in V.SAVE_KEYS:
        setattr(g, k, s[k] if k in s else V.DEFAULTS[k]())
    g._blockade = set(s.get('blockade', []))
    g.diplo = {(a, b): st for a, b, st in s['diplo']}
    g.rng = random.Random(g.seed + int(g.t * 1000))
    g.speed_idx = 0
    g._dirty_income = True
    g._last_day = int(g.t)
    g.y_mont = GEO.xy(43.2, 0)[1]
    g.x_cote = GEO.xy(44, -0.95)[0]
    for p in g.proposals:
        if p.get('give'):
            p['give'] = tuple(p['give'])
            p['get'] = tuple(p['get'])
    TB.load_from(g, s)
    g.ais = {}
    return g


def operations(g, rnd):
    ops = []
    codes = list(g.factions)
    p = g.player
    for k in (0, 1, 2, 3):
        ops.append(['month_end', None, k])
    for t in (g.t, 0.0, 28.5, 59.999, 60.0, 61.0, g.t + 45.3, 400.2, g.t - 3.7):
        ops += [['month_end', t, 1], ['month_end', t, 0], ['month_days', t + 1], ['turn_start_after', t], ['tours_left', t]]
    for dt in (0.05, 0.1, 1.0, 3.5):
        ops.append(['work', dt])
    for w in (0, 1e-7, 1.0, 5.0, 29.9, 30, 31, 75.5, 300):
        ops.append(['ready_in', w])
    for n in (0, 1, 2, 3):
        for who in ([], ['33'], ['24', '40'], ['33', '24']):
            ops.append(['deadline', n, who])
    for d in (0, 10, 26.9, 27, 30, 44.9, 45, 100, 1000):
        ops.append(['part_tour', d])
    ops += [['planning'], ['phase'], ['march_days'], ['lock_reason'], ['view'], ['_scan'],
            ['_candidates', dict(bt=[], ev=[])], ['_new_acc']]
    for aid in g.armies:
        ops += [['march_left', aid], ['eta', aid, None], ['_on_section', aid]]
    nids = [n['id'] for n in g.nodes]
    mine = [a for a in g.armies.values() if a['owner'] == p]
    for a in mine[:3] + [a for a in g.armies.values() if a['owner'] != p][:2]:
        for _ in range(3):
            nid = rnd.choice(nids)
            ops.append(['preview', a['owner'], a['id'], None, None, nid, rnd.choice(['route', 'champs'])])
            gn = GEO.nodes[rnd.choice(nids)]
            ops.append(['preview', a['owner'], a['id'], gn['x'] + rnd.uniform(-3, 3), gn['y'] + rnd.uniform(-3, 3), None,
                        rnd.choice(['route', 'champs'])])
    if mine:
        a = mine[0]
        ops += [['preview', '24', a['id'], None, None, nids[0], 'route'], ['preview', p, 'zz', None, None, nids[0], 'route'],
                ['preview', p, 5, None, None, nids[0], 'route'], ['preview', p, None, None, None, nids[0], 'route'],
                ['preview', p, a['id'], None, None, nids[0], 'vol'], ['preview', p, a['id'], None, None, nids[0], None],
                ['preview', p, a['id'], None, None, 99999, 'route'], ['preview', p, a['id'], None, None, True, 'route'],
                ['preview', p, a['id'], None, None, None, 'route'], ['preview', p, a['id'], 10.0, None, None, 'route']]
    for _ in range(12):
        gn = GEO.nodes[rnd.choice(nids)]
        ops.append(['_where', gn['x'] + rnd.choice([0.0, 0.4, 2.5, 9.0]), gn['y'] + rnd.choice([0.0, -0.3, 3.0])])
    for c in codes:
        ops.append(['incoming', c])
    # ------------------------------------------------------------------ chemins de fer
    secs = list(RL.sections(GEO))
    ops += [['sections'], ['client_payload'], ['exits'], ['by_town']]
    # (des tronçons ouverts, coupés, en chantier ; le joueur a le train)
    t = g.t
    ops += [['set', 'rails', secs[0], dict(done=True, cut=None)], ['set', 'rails', secs[1], dict(done=True, cut=t + 20)],
            ['set', 'rails', secs[2], dict(done=True, cut=t - 1)],
            ['set', 'rails', secs[3], dict(done=False, cut=None, by=p, left=40.0, total=120.0)],
            ['set', 'rails', secs[4], dict(done=False, cut=None, by='24', left=0.5, total=80.0)],
            ['set', 'rails', secs[5], dict(done=False, cut=None, by='zz', left=10.0, total=80.0)]]
    ops += [['set', 'factions', p, 'techs', g.factions[p]['techs'] + ['chemins_fer']],
            ['set', 'factions', p, 'mods', 'rail_troops', 1.0], ['set', 'factions', '24', 'techs', ['chemins_fer']]]
    for c in codes + ['zz']:
        if c != 'zz':
            ops += [['network', c], ['works', c], ['industry_k', c], ['rail_edges', c]]
            for sid in secs:
                ops += [['usable', c, sid], ['openable', c, sid], ['cost', c, sid]]
        ops.append(['player_view', c])
    ops.append(['openable', p, 'zz-0'])
    for sid in secs + ['zz-0']:
        ops.append(['open_', sid])
    towns = sorted(RL.by_town(GEO))
    for nid in towns + [nids[1]]:
        ops.append(['town_bonus', nid])
        gn = GEO.nodes[nid]
        for c in (p, '24'):
            ops.append(['near_station', c, gn['x'] + rnd.uniform(-35, 35), gn['y'] + rnd.uniform(-35, 35)])
    for sid in secs[:8]:
        ops += [['start', p, sid], ['start', '24', sid]]
    ops += [['tick', 0.1], ['tick', 30.0], ['player_view', p], ['tick', 80.0], ['player_view', p]]
    # des armées sur les voies : sabotage
    for k, a in enumerate(list(g.armies.values())[:6]):
        sec = RL.sections(GEO)[secs[k % 4]]
        e0 = sec['edges'][0] if sec['edges'] else None
        ops += [['set', 'armies', a['id'], 'edge', dict(e=e0, frm=GEO.edges[e0]['a'], pos=0.5) if k % 2 == 0 and e0 is not None
                 else None], ['set', 'armies', a['id'], 'at_node', sec['a'] if k % 2 else None],
                ['set', 'armies', a['id'], 'boat', False], ['set', 'armies', a['id'], 'rail', False],
                ['_on_section', a['id']]]
    ops += [['sabotage'], ['player_view', p], ['rail_edges', p], ['sabotage']]
    # ------------------------------------------------------------------ journal des batailles
    for bid in g.battles:
        ops.append(['snapshot', bid])
    ops.append(['tactical'])
    # ------------------------------------------------------------------ commandes et déroulement
    ops += [['migrate'], ['command', 'zz', None], ['_settled'], ['command', 'go', None], ['view'], ['_settled'],
            ['_accumulate', 0.1], ['watch', 0.05], ['_recap'], ['view'], ['command', 'mode', False], ['view'],
            ['planning'], ['lock_reason'], ['command', 'go', None], ['command', 'mode', 0], ['command', 'mode', 1],
            ['view'], ['go'], ['view'], ['_scan'], ['_accumulate', 0.25], ['_recap'], ['finish_sans_ia']]
    ops += [['rng']]
    return ops


def jouer(g, op):
    nom, args = op[0], op[1:]
    if nom == 'set':
        o = dict(armies=g.armies, nodes=g.nodes, factions=g.factions, rails=g.rails)[args[0]]
        for k in args[1:-2]:
            o = o[k]
        o[args[-2]] = copy.deepcopy(args[-1])
        return None
    if nom == 'rng':
        return g.rng.random()
    if nom == 'month_end':
        return TT.month_end(g, args[0], args[1])
    if nom in ('month_days', 'turn_start_after', 'tours_left', 'work', 'ready_in'):
        return getattr(TT, nom)(g, args[0])
    if nom == 'deadline':
        return TT.deadline(g, args[0], *args[1])
    if nom == 'part_tour':
        return TT.part_tour(args[0])
    if nom in ('planning', 'phase', 'march_days', 'lock_reason', 'view', '_scan', '_new_acc', '_settled', '_recap', 'migrate',
               'go'):
        r = getattr(TT, nom)(g)
        return list(r) if isinstance(r, tuple) else r
    if nom == '_candidates':
        return TT._candidates(g, args[0], TT._scan(g))
    if nom == 'march_left':
        return TT.march_left(g, g.armies[args[0]])
    if nom == 'eta':
        return TT.eta(g, g.armies[args[0]], args[1])
    if nom == 'preview':
        return list(TT.preview(g, *args))
    if nom == '_where':
        return TT._where(g, *args)
    if nom == 'incoming':
        return [a['id'] for a in TT.incoming(g, args[0])]
    if nom == 'command':
        return list(TT.command(g, *args))
    if nom == '_accumulate':
        return TT._accumulate(g, args[0])
    if nom == 'watch':
        return TT.watch(g, args[0], g.seq)
    if nom == 'finish_sans_ia':   # finish jusqu'à begin_turn (settle, les marches : vérifiés de bout en bout)
        tr = g.tour
        g.speed_idx = 0
        tr['recap'] = TT._recap(g)
        tr.update(end=None, stop=None, acc=None)
        return TT.view(g)
    # chemins de fer
    if nom == 'sections':
        return commun.empreinte_ordre(j(RL.sections(GEO)))
    if nom == 'client_payload':
        return commun.empreinte_ordre(j(RL.client_payload(GEO)))
    if nom == 'exits':
        return RL.exits()
    if nom == 'by_town':
        return RL.by_town(GEO)
    if nom == 'network':
        s = RL.network(g, args[0])
        return [None in s, sorted(x for x in s if x is not None)]
    if nom == 'rail_edges':
        return sorted(RL.rail_edges(g, args[0]))
    if nom in ('works', 'industry_k', 'player_view'):
        return getattr(RL, nom)(g, args[0])
    if nom in ('usable', 'openable', 'cost', 'start'):
        r = getattr(RL, nom)(g, *args)
        return list(r) if isinstance(r, tuple) else r
    if nom == 'open_':
        return RL.open_(g, args[0])
    if nom == 'town_bonus':
        return RL.town_bonus(g, args[0])
    if nom == 'near_station':
        return RL.near_station(g, *args)
    if nom == 'tick':
        return RL.tick(g, args[0])
    if nom == '_on_section':
        return [s['id'] for s in RL._on_section(g, g.armies[args[0]])]
    if nom == 'sabotage':
        return RL.sabotage(g)
    # journal des batailles
    if nom == 'snapshot':
        return BL.snapshot(g, g.battles[args[0]])
    if nom == 'tactical':
        tb = next(iter(g.tactical.values()), None)
        return None if tb is None else BL.tactical(tb)
    raise ValueError(nom)


def ev_norm(evs):
    """Le journal, sans l'ordre des lignes d'une même coupure de voie ferrée : rails.sabotage les écrit en parcourant un
    set de textes (`{code} | {…}`), dont l'ordre change d'un lancement de Python à l'autre. Leurs camps (who, important)
    sont comparés à part, triés."""
    out, coupes = [], []
    for e in j(evs):
        if e['kind'] == 'rail' and ' coupe la voie ferrée ' in e['text']:
            coupes.append([e['text'], e.pop('who'), e.pop('important')])
        out.append(e)
    return [out, sorted(coupes)]


def final(g):
    return dict(factions=commun.empreinte_ordre(j(g.factions)), nodes=commun.empreinte_ordre(j(g.nodes)),
                armies=commun.empreinte_ordre(j(g.armies)), events=commun.empreinte_ordre(ev_norm(g.events)),
                battles=commun.empreinte_ordre(j(g.battles)), rails=j(g.rails), tour=j(g.tour), n_events=len(g.events),
                last_events=[e['text'] for e in g.events[-12:]], speed=g.speed_idx)


def cas(nom, s, k):
    out = dict(nom=nom, save=s)
    # aller-retour (views.from_dict, views.to_dict) et vue du navigateur de la partie relue
    g = V.from_dict(GEO, copy.deepcopy(s))
    rt = j(V.to_dict(g))
    out['retour'] = commun.empreinte_ordre(rt)
    out['retour_ai'] = rt['ai_state']
    ps = j(V.player_state(g, 0))
    out['vue'] = commun.empreinte_ordre(ps)
    out['vue_parts'] = {k_: commun.empreinte_ordre(v) for k_, v in ps.items()}
    out['vue_lisible'] = dict(date=ps['date'], tour=ps['tour'], me_res=ps['me']['res'], nodes0=ps['nodes'][:3],
                              armies=ps['armies'][:2], battles=ps['battles'], factions0=ps['factions'][0])
    out['vue_since'] = commun.empreinte_ordre(j(V.player_state(g, s['seq'] - 3)))
    # la partie posée champ par champ : to_dict, puis les opérations
    out['to_dict'] = commun.empreinte_ordre(j(V.to_dict(assembler(s))))
    ga = assembler(s)
    ops = operations(ga, random.Random(77 + k))
    out['ops'] = j(ops)
    out['res'] = [j(jouer(ga, op)) for op in j(ops)]
    out['fin'] = final(ga)
    return out


if __name__ == '__main__':
    ref = dict(crue=crue())
    saves = parties()
    ref['cas'] = []
    for k, (nom, s) in enumerate(saves.items()):
        print(nom, len(json.dumps(s)) // 1024, 'Ko', 'tactical', list(s['tactical']), 'batailles', len(s['battles']))
        ref['cas'].append(cas(nom, s, k))
    # la fin du mois, de la sauvegarde en plein tour des IA : « Continuer le mois », les pas du tour des IA jusqu'au 1er
    # (finish : bilan, batailles réglées, begin_turn, settle et marches du joueur), puis un ordre de marche et settle
    g = V.from_dict(GEO, copy.deepcopy(saves['ia']))
    TT.go(g)
    n = 1
    while not pas(g):
        n += 1
    fin = dict(pas=n, fin=final(g), recap=j(g.tour['recap']), vue=commun.empreinte_ordre(j(V.player_state(g, 0))))
    a = next(a for a in g.armies.values() if a['owner'] == JOUEUR and a['state'] != 'battle')
    cible = g.capital_of('40')
    fin['ordre'] = [a['id'], cible, list(g.order_move(JOUEUR, a['id'], node=cible))]
    fin['settle'] = j(TT.settle(g))
    fin['apres'] = final(g)
    fin['trail'] = j(a.get('trail'))
    ref['mois'] = fin
    g = V.from_dict(GEO, vieille(saves['ia']))
    ref['vieille'] = dict(cles=VIEILLES, retour=commun.empreinte_ordre(j(V.to_dict(g))))
    ref['rules_payload'] = commun.empreinte_ordre(j(V.rules_payload()))
    commun.ecrire('tours', ref)
