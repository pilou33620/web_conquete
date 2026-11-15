"""Références de la première partie du moteur de campagne (game/engine.py, lignes 1 à 1523) pour le portage en Rust
(rust/conquete/src/engine/mod.rs, utilitaires.rs, economie.rs). Écrit rust/conquete/tests/references/campagne1.json,
relu par rust/conquete/tests/campagne1.rs.

Seulement ce qui tourne sans le reste de la partie : les fonctions du module (ordinal, curve_at) et les méthodes de
Game qui ne lisent que des champs simples (dates, années, époques, noms d'époque, armement, coûts, diplomatie, journal),
sur une partie vide (Game.__new__) dont chaque cas pose les champs. Game() lui-même et les méthodes qui appellent les
autres modules de campagne sont vérifiés de bout en bout (campagnes entières à la même graine).

    python3 outils/jumeau/campagne1_ref.py
"""
import copy
import random

import commun
from game import rules as R
from game import engine as E

CODES = ['33', '24', '40', '47', '64']


def ordinaux():
    return [[n, E.ordinal(n)] for n in (1, 2, 3, 11, 21)]


def courbes():
    rnd = random.Random(7)
    out = []
    pistes = [R.POP_ERA] + [R.POP_CURVES[k] for k in sorted(R.POP_CURVES)[:12]]
    for pts in pistes:
        ys = [pts[0][0] - 3, pts[0][0], pts[-1][0], pts[-1][0] + 5] + [p[0] for p in pts]
        ys += [rnd.uniform(pts[0][0] - 10, pts[-1][0] + 10) for _ in range(6)]
        for y in ys:
            v, lab = E.curve_at(pts, y)
            out.append([pts, y, v, lab])
    return out


def techs_avant(annee):
    known = {t for t in R.TECH if R.TECH_YEAR[t] <= annee}
    while (missing := {q for t in known for q in R.TECH[t]['req']} - known):
        known |= missing
    return [t for t in R.TECH if t in known]


def partie(cas):
    """Une partie vide, posée d'après le cas (les mêmes champs que l'essai Rust pose)."""
    g = E.Game.__new__(E.Game)
    g.start_ord = cas['start_ord']
    g.t = cas['t']
    g.player = cas['player']
    g.difficulty = cas['difficulty']
    g.factions = copy.deepcopy(cas['factions'])
    g.nodes = copy.deepcopy(cas['nodes'])
    g.armies = {}
    g.events = []
    g.seq = 0
    g.speed_idx = 4
    g.flood_until = cas['flood_until']
    g.diplo = {tuple(k): v for k, v in cas['diplo']}
    g._dirty_income = False
    g.weather = copy.deepcopy(cas['weather'])
    g.y_mont, g.x_cote = 300.0, 100.0
    return g


def cas_de(i, rnd):
    debut = rnd.choice(['1700', '1790', '1813', '1870'])
    sc = R.SCENARIOS[debut]
    start_ord = E.datetime.date(*sc['date']).toordinal()
    t = rnd.choice([0.0, 0.7, 31.5, 300.25, 3650.9, rnd.uniform(0, 40000)])
    annee = rnd.choice([1700, 1760, 1778, 1806, 1840, 1866, 1890])
    factions = {}
    for c in CODES:
        techs = techs_avant(annee - rnd.randint(0, 30))
        mods = {k: round(rnd.uniform(-0.3, 0.4), 3) for k in rnd.sample(
            ['recruit_cost', 'art_cost', 'cav_cost', 'ligne_armes', 'train', 'art_train', 'cav_train', 'build_cost',
             'tools_max', 'granary', 'livres', 'inf_power'], 6)}
        factions[c] = dict(code=c, alive=True, techs=techs, mods=mods, tarif=rnd.randint(0, 3),
                           douaniers=rnd.random() < 0.5, res=dict(livres=500.0, outils=rnd.choice([0, 40, 120.5, 900]),
                                                                  recrues=rnd.choice([0.0, 900, 50.5]),
                                                                  armes=rnd.choice([1.0, 160, 400.0])),
                           _nn=rnd.randint(1, 30), emods={'livres': 0.1} if rnd.random() < 0.3 else {},
                           maison=dict(chef=dict(trait=rnd.choice(list(R.MAISON_TRAITS)))) if rnd.random() < 0.5 else None)
    nodes = [dict(id=k, owner=rnd.choice(CODES + [R.NEUTRAL]), fort=rnd.randint(0, 4), milice=rnd.choice([30.0, 200.0, 400]),
                  milice_max=rnd.choice([20.0, 59, 220, 340.0]), deg=rnd.choice([0.0, 0.01, 0.3])) for k in range(12)]
    diplo = []
    for a in CODES:
        for b in CODES:
            if a < b and rnd.random() < 0.7:
                diplo.append([[a, b], rnd.choice(['paix', 'guerre', 'alliance'])])
    weather = {z: dict(kind=rnd.choice(list(R.WEATHER)), left=2, mud=rnd.choice([0, 1, 3])) for z in R.ZONES}
    return dict(start_ord=start_ord, t=t, player=rnd.choice(CODES), difficulty=rnd.choice(list(R.DIFFICULTY)),
                factions=factions, nodes=nodes, flood_until=rnd.choice([-1, 50.0, 4000.0]), diplo=diplo, weather=weather,
                regs=regs_de(rnd), gen=dict(gen=dict(talents=rnd.sample(list(R.GENERAL_TALENTS), 2))),
                dmg=[rnd.choice([0.0, 0.25, 1.0]) for _ in range(12)], renf=[rnd.choice([0.0, 30.0, 120.5]) for _ in range(6)],
                recr=[rnd.choice([10, 5000.5]) for _ in CODES])


def regs_de(rnd):
    regs = []
    for typ in R.UNITS:
        r = dict(id=f'r{len(regs)}', type=typ, n=float(rnd.randint(0, 900)), max=R.UNITS[typ]['men'], xp=rnd.choice([0.0, 12.5]),
                 morale=80.0, arm=rnd.randint(0, 3), man=rnd.sample(list(R.MANEUVERS), rnd.randint(0, 3)))
        if rnd.random() < 0.2:
            r['drill'] = dict(t=1.0, man=[], arm=None)
        if rnd.random() < 0.3:
            del r['arm']
        regs.append(r)
    return regs


def mesurer(cas):
    g = partie(cas)
    out = {}
    out['date'] = [[d.year, d.month, d.day] for d in (g.date(), g.date(17), g.date(400.9))]
    out['date_str'] = [g.date_str(), g.date_str(0), g.date_str(29.99)]
    out['year'] = g.year()
    out['era'] = g.era()['id']
    out['pop_era'] = [g.pop_era(), g.pop_era(1795), g.pop_era(1850.25)]
    out['season'] = g.season()
    out['departements'] = [g.departements(), g.dept_word(), g.pays_de(), g.faction_name('33')]
    out['flooded'] = g.flooded()
    out['zones'] = [[x, y, g.zone_of(x, y), g.wx(x, y)['food'], g.mud_k(x, y, False), g.mud_k(x, y, True)]
                    for x, y in ((50.0, 50.0), (150.0, 50.0), (150.0, 400.0), (100.0, 300.0))]
    out['diplo'] = [[a, b, g.status(a, b), g.at_war(a, b), g.friendly(a, b), g.hostile(a, b)]
                    for a in CODES + [R.NEUTRAL] for b in CODES + [R.NEUTRAL]]
    g.set_status('64', '24', 'guerre')
    out['set_status'] = [[list(k), v] for k, v in g.diplo.items()]
    out['valid_node'] = [g.valid_node(v) for v in (0, 11, 12, -1, True, 3.0, None, '2')]
    arm = []
    for code in CODES + ['99']:
        for cls in R.ARMS:
            arm.append([code, cls, g.arm_level(code, cls), g.arm_k(code, cls), g.arm_k(code, cls, 2), g.arm_k(code, cls, 99)])
        for cls in ('inf', 'cavalerie', 'artillerie'):
            arm.append([code, cls, g.known_man(code, cls)])
        arm.append([code, g.milice_k(code)])
        arm.append([code, [list(g.unit_name(code, typ)) for typ in R.UNITS]])
    out['armement'] = arm
    regs = copy.deepcopy(cas['regs'])
    gen = cas['gen']
    lag = []
    for code in ('33', '40', '99'):
        for r in regs:
            m0 = g.reg_mods(code, r)
            m1 = g.reg_mods(code, r, gen)
            lag.append([code, r['id'], g.reg_lag(code, r), m0, m0 is g.factions.get(code, {}).get('mods'), m1])
        lag.append([code, g.modernize_cost(code, regs)])
    out['regs'] = regs
    out['lag'] = lag
    cost = []
    for code in CODES:
        for typ in R.UNITS:
            cost.append([code, typ, g.unit_cost(code, typ), g.unit_days(code, typ)])
        cost.append([code, g.build_cost(code, R.BUILD['fort']['cost'](2)), g.build_days(code, 33),
                     g.contrebande(code), list(g.tools_bonus(code)), g.recruit_cap(code), g.granary_cap(code),
                     g.can_pay(code, dict(livres=500, outils=40)), g.can_pay(code, dict(livres=500.5))])
    out['couts'] = cost
    g.recompute_mods('33')
    g.recompute_mods(g.player)
    out['mods'] = [g.factions['33']['mods'], g.factions[g.player]['mods'], g.mod('33', 'livres'), g.mod('33', 'absent')]
    out['owned'] = [[n['id'] for n in g.owned_nodes(c)] for c in CODES]
    forts = []
    for k in range(12):
        n = g.nodes[k]
        forts.append([g.lose_fort_level(k), n['fort'], n['milice_max'], n['milice']])
        g.damage_town(n, cas['dmg'][k])
        forts.append(n['deg'])
    out['forts'] = forts
    rf = []
    for r, add in zip(regs[:6], cas['renf']):
        rf.append([g.reinforce('33', r, add), r['n'], r['xp'], dict(g.factions['33']['res'])])
    out['reinforce'] = rf
    rf = []
    for code, add in zip(CODES, cas['recr']):
        rf.append([g.add_recrues(code, add), g.factions[code]['res']['recrues']])
        g._granary_dirty(code)
        rf.append(g.factions[code]['_nn'])
    out['recrues'] = rf
    a = dict(regs=[dict(id=f'p{i}', type='ligne', n=float(n)) for i, n in enumerate((3, 400, 0, 6, 4.5))],
             morts=[[0, 'ligne', 'old', g.t - 50], [1, 'legere', 'recent', g.t - 1]])
    g.prune(a)
    g.prune(a)
    out['prune'] = a
    for k in range(405):
        g.log('info', f'message {k}', **(dict(x=1.5, y=2, who='33', important=True, extra=dict(coins=True)) if k % 7 == 0 else {}))
    out['log'] = [g.seq, len(g.events), g.events[0], g.events[-1]]
    g.speed_idx = 4
    g.alert_pause()
    s1 = g.speed_idx
    g.speed_idx = 5
    g.alert_pause()
    s2 = g.speed_idx
    g.speed_idx = 1
    g.alert_pause(True)
    out['pause'] = [s1, s2, g.speed_idx]
    return out


if __name__ == '__main__':
    rnd = random.Random(1790)
    jeux = []
    for i in range(14):
        cas = cas_de(i, rnd)
        jeux.append(dict(cas=cas, vu=mesurer(cas)))
    commun.ecrire('campagne1', dict(ordinal=ordinaux(), curve_at=courbes(), jeux=jeux))
