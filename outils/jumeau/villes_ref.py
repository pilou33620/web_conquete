"""Références des villes, des événements et des familles (game/cities.py, game/events.py, game/familles.py) pour le
portage en Rust (rust/conquete/src/cities.rs, events.rs, familles.rs). Écrit rust/conquete/tests/references/villes.json,
relu par rust/conquete/tests/villes.rs.

Deux parties :
- ce qui ne dépend que de son entrée (textes des effets, chiffres, cumuls des bâtiments, règles envoyées au navigateur) ;
- des parties vides (Game.__new__) posées sur la géographie 1, et sur chacune une suite d'opérations (« ops ») que
  l'essai Rust rejoue telles quelles : bâtiments (coûts, niveaux, emplacements, chantiers, démolitions), production,
  événements (textes, conditions, poids, effets, déclenchement pour les IA, chaque jour), familles (naissances,
  mariages, morts, successions). Le camp du joueur est éteint : rien ne passe par ses décisions (turns.py).
  Les opérations qui passent par turns.deadline (événements locaux, politique de la ville) sont rangées à la fin de
  chaque partie, après l'opération 'tt' : l'essai Rust les saute tant que turns.rs n'est pas porté.

    python3 outils/jumeau/villes_ref.py
"""
import datetime
import json
import random

import commun
from game import rules as R
from game import engine as E
from game import geo as G
from game import cities as CT
from game import events as EV
from game import familles as FM

GEO = G.GeoMap(1)
CODES = ['33', '24', '40', '47', '64']
CHAINS = list(CT.CHAINS)
POL = list(CT.POLICIES)
SRC = dict(hist=EV.HIST_BY_ID, rand=EV.RANDOM_BY_ID, local=CT.LOCAL_BY_ID)
W_NOMS = ['_w_incendie', '_w_epidemie', '_w_disette', '_w_brigands', '_w_foire', '_w_crue', '_w_refugies', '_w_filon',
          '_w_emeute']

NOMBRES = [0, 0.1, 1.5, 2.25, 3.0, 10.0, 0.005, 0.015, 0.125, 12.345, 100, 7.999, -0.5, 0.3 * 30, 0.35 * 30, 2]
PCTS = [0.1, -0.1, 0.005, -0.005, 0.015, 0.025, -0.35, 0.0, 1.5, -0.125, 0.07, 3]
JOURS = [1, 14, 15, 29, 30, 44, 45, 60, 90, 180, 182, 183, 365, 547, 548, 730, 1095, 3650, 0]
AUTRES_FX = [dict(xp=5), dict(xp=5.0, milice=40.0), dict(stab=-0.02, train=0.2, cav_train=0.3, ev=dict(foire=0.5, xyz=-1)),
             dict(livres=0.05, trade=0.05), dict(livres=0.1, trade=0.1, depot=1), dict(spec=0.6, grow=0.25, research=0.03),
             dict(livres=1 / 15, vivres=0.0, recrues=0.2), dict()]
TMODS = [dict(k='order', v=-0.1, until=3.0, ev='cholera'), dict(k='order', v=-0.1, until=3.0), dict(k='morale', v=5, until=1),
         dict(k='vin', v=-0.3, until=1, ev='phylloxera'), dict(k='port', v=-0.2, until=1, ev='blocus'), dict(k='x', v=0.2, ev='epidemie')]
MODS_T = [{}, dict(epidemics=-0.5), dict(epidemics=-1.5, blockade=-0.25, vine_blight=0.1)]


def pur():
    out = {}
    out['n'] = [CT._n(x) for x in NOMBRES]
    fxs = [L['fx'] for c in CT.CHAINS.values() for L in c['levels']] + list(CT._PFX.values()) + AUTRES_FX
    out['fx_text'] = [[CT.fx_text(fx), CT.fx_text(fx, per_day=True)] for fx in fxs]
    out['pct'] = [[EV._pct(v), CT._pct(v)] for v in PCTS]
    out['years'] = [EV._years(d) for d in JOURS]
    out['tours_of'] = [CT.tours_of(d) for d in JOURS]
    out['min1'] = [EV._min1(s) for s in ['Le pensionner', 'Élever', '', 'a', 'Ouvrir les greniers']]   # (entrées : plus bas)
    out['rules'] = CT.rules_payload()
    out['pfx'] = CT._PFX
    rnd = random.Random(991)
    combos = []
    for _ in range(80):
        s = {c: rnd.randint(0, 4) for c in rnd.sample(CHAINS + ['xyz'], rnd.randint(0, 6))}
        combos.append([s, CT.bfx(dict(slots=s))])
    out['bfx'] = combos
    add = []
    for w in (1.0, 0.25, 0.7):
        tot = {'livres': 1, 'ev': {'foire': 1}}
        CT._add(tot, dict(livres=0.1, xp=5, ev=dict(foire=0.5, disette=-0.3), name='x', flag=True), w)
        add.append(tot)
    out['add'] = add
    out['tmod_value'] = [EV.tmod_value(e, m) for e in TMODS for m in MODS_T]
    out['prestige'] = CT.prestige([dict(slots=s) for s, _ in combos])
    out['entrees'] = dict(nombres=NOMBRES, pcts=PCTS, jours=JOURS, autres_fx=AUTRES_FX, tmods=TMODS, mods_t=MODS_T,
                          min1=['Le pensionner', 'Élever', '', 'a', 'Ouvrir les greniers'])
    return out


# ------------------------------------------------------------------ une partie
def partie(cas):
    g = E.Game.__new__(E.Game)
    g.geo = GEO
    g.seed = cas['seed']
    g.start_ord = cas['start_ord']
    g.t = cas['t']
    g.player = cas['player']
    g.difficulty = 'normal'
    g.factions = json.loads(json.dumps(cas['factions']))
    g.nodes = json.loads(json.dumps(cas['nodes']))
    g.armies = json.loads(json.dumps(cas['armies']))
    g.battles = {}
    g.events = []
    g.seq = 0
    g.uid = 1
    g.speed_idx = 4
    g.flood_until = cas['flood_until']
    g.diplo = {tuple(k): v for k, v in cas['diplo']}
    g._dirty_income = False
    g.rng = random.Random(cas['seed'])
    g.over = None
    g.pending_ev = []
    g.ev_done = []
    g.tour = dict(on=cas['tour'])
    return g


def cas_de(i, rnd):
    sc = rnd.choice(list(R.SCENARIOS))
    start_ord = datetime.date(*R.SCENARIOS[sc]['date']).toordinal()
    t = rnd.choice([0.0, 40.5, rnd.uniform(0, 4000)])
    player = rnd.choice(CODES)
    factions = {}
    for c in CODES:
        f = dict(code=c, alive=c != player, res=dict(livres=rnd.choice([10.0, 500.0, 2500.0, -80.0]), vivres=rnd.choice([0.0, 300.0]),
                                                     fer=80.0, bois=rnd.choice([10, 200.0]), armes=10.0, outils=rnd.choice([0, 40.0]),
                                                     recrues=rnd.choice([100.0, 900.0])),
                 income=dict(vivres=rnd.choice([-3.0, 2.0, 20.0]), livres=5.0),
                 research={b: (dict(id='x', left=rnd.choice([10.0, 55.5])) if rnd.random() < 0.6 else None) for b in R.BRANCHES},
                 techs=rnd.sample(list(R.TECH), rnd.randint(0, 70)), mods={},
                 rel={o: rnd.randint(-99, 99) for o in CODES if o != c}, trade={}, truce={}, overlord=None, war_since={},
                 last_war=-730.0, tarif=rnd.randint(0, 3), douaniers=rnd.random() < 0.5, tax=rnd.choice([0.3, 0.5, 0.7]),
                 weary=rnd.choice([0.0, 40.0, 99.5]), prestige=0.0, glory=rnd.choice([0.0, 12.5]))
        if rnd.random() < 0.3:
            f['famine'] = True
        if rnd.random() < 0.3:
            f['emods'] = {'livres': 0.05}
        if rnd.random() < 0.3:
            f['tmods'] = [dict(k='order', v=-0.1, until=t + 30, ev='cholera'), dict(k='morale', v=5, until=t - 1)]
        factions[c] = f
    nodes = []
    for gn in GEO.nodes:
        owner = gn['dept'] if gn['type'] in ('capitale', 'ville') and rnd.random() < 0.85 else rnd.choice(CODES + [R.NEUTRAL] * 2)
        n = dict(id=gn['id'], owner=owner, milice=rnd.choice([0.0, 40.0, 150]), milice_max=rnd.choice([60.0, 200]),
                 fort=rnd.randint(0, 3), dev=rnd.randint(0, 2), pop=rnd.choice([500.0, 30000.0]),
                 stab=rnd.choice([0.2, 0.55, 0.8, 1.0, rnd.random()]), garrison=[], queue=[], siege=None, depot=rnd.choice([0, 0, 0, 1]))
        if rnd.random() < 0.05:
            n['siege'] = dict(by=rnd.choice(CODES))
        if rnd.random() < 0.1:
            n['garrison'] = [dict(id='rg', type='ligne', n=300.0)]
        if rnd.random() < 0.5:
            n['slots'] = {c: rnd.randint(0, len(CT.CHAINS[c]['levels'])) for c in rnd.sample(CHAINS, rnd.randint(0, 4))}
        if rnd.random() < 0.3:
            n['pol'] = dict(k=rnd.choice(POL), p=rnd.choice(POL), t=t - rnd.uniform(0, 60), u=t + rnd.choice([-5.0, 10.0, 25.0]),
                            o=rnd.choice([owner, owner, '33']))
        if rnd.random() < 0.2:
            n['tm'] = [dict(k=rnd.choice(['prod', 'livres', 'vivres']), v=rnd.choice([-0.15, 0.4]), until=t + rnd.choice([-3.0, 20.0]))]
        if rnd.random() < 0.15:
            n['bo'] = {'fer': rnd.choice([0.4, 0.8])}
        if rnd.random() < 0.2:
            n['evt'] = t - rnd.choice([10.0, 300.0])
        if rnd.random() < 0.1:
            n['queue'] = [dict(kind='slot', what=rnd.choice(CHAINS), lvl=1, left=5.0, total=10.0)]
        nodes.append(n)
    armies = {}
    for k in range(8):
        n = rnd.choice(nodes)
        armies[f'a{k}'] = dict(id=f'a{k}', owner=rnd.choice([n['owner'], rnd.choice(CODES)]), at_node=n['id'],
                               state=rnd.choice(['idle', 'idle', 'move']), regs=[])
    diplo = [[[a, b], rnd.choice(['paix', 'guerre', 'alliance'])] for a in CODES for b in CODES if a < b]
    cas = dict(seed=i * 7 + 3, start_ord=start_ord, t=t, player=player, factions=factions, nodes=nodes, armies=armies,
               diplo=diplo, flood_until=rnd.choice([-1, t + 10.0, t - 200.0]), tour=rnd.random() < 0.5)
    cas = json.loads(json.dumps(cas))
    # les maisons : celles que FM.nouvelle donne à cette partie (vérifiées à part par l'opération 'nouvelle')
    g = partie(cas)
    for c in CODES:
        cas['factions'][c]['maison'] = FM.nouvelle(g, c)
    return json.loads(json.dumps(cas))


def ops_de(cas, rnd):
    t = cas['t']
    nodes, factions, player = cas['nodes'], cas['factions'], cas['player']
    vivants = [c for c in CODES if factions[c]['alive']]
    ops = []
    nids = rnd.sample(range(len(nodes)), 32)
    for nid in nids:
        n = nodes[nid]
        own = n['owner']
        code = own if own in CODES else rnd.choice(CODES)
        ops += [['slot_count', nid], ['bfx', nid], ['pfx', nid], ['policy_w', nid], ['stab_bonus', nid], ['growth_k', nid],
                ['train_k', nid, 'ligne'], ['train_k', nid, 'cavalerie'], ['train_xp', nid], ['river', nid], ['hilly', nid],
                ['trading', nid], ['troops', nid, code], ['troops', nid, rnd.choice(CODES)],
                ['fill_ct', nid, "{ville}|{de_ville}|{a_ville}|{riviere}"],
                ['node_extra', nid, code, rnd.choice([0.0, 1.5])]]
        if 'pol' not in n:
            ops.append(['node_view', nid])
        if own in CODES:
            ops.append(['weights', nid])
            ops += [['w', w, nid] for w in W_NOMS]
        for chain in CHAINS:
            ops += [['fits', nid, chain], ['check', code, nid, chain]]
            if nid in nids[:6] or (chain == 'specialite' and GEO.nodes[nid].get('star')):
                for lvl in range(1, len(CT.CHAINS[chain]['levels']) + 1):
                    ops += [['level_name', nid, chain, lvl], ['level_tech', nid, chain, lvl]]
            if nid in nids[:20]:
                ops.append(['ai_value', code, nid, chain, rnd.randint(1, len(CT.CHAINS[chain]['levels'])), rnd.choice([1.0, 0.37])])
    ops += [['upkeep', c] for c in CODES] + [['college_k', c] for c in CODES] + [['prestige'], ['research'], ['factions']]
    # chantiers
    for k in range(90):
        nid = rnd.choice(nids)
        own = nodes[nid]['owner']
        code = own if own in CODES and rnd.random() < 0.85 else rnd.choice(CODES)
        op = rnd.choice(['slot_build'] * 5 + ['finish'] * 3 + ['demolish'] * 2 + ['sync'])
        chain = rnd.choice(CHAINS + ['xyz'])
        if op == 'slot_build':
            ops.append(['slot_build', code, nid, chain])
        elif op == 'demolish':
            ops.append(['demolish', code, nid, chain])
        else:
            ops.append([op, nid])
        ops.append(['node', nid])
    ops += [['factions']] + [['upkeep', c] for c in CODES]
    # les saisons, la crue
    for dt in (0, 91, 182, 273):
        ops.append(['set_t', t + dt])
        for nid in nids[:12]:
            if nodes[nid]['owner'] in CODES:
                ops.append(['weights', nid])
    for fu in (t + 5, t - 30, -1):
        ops.append(['set_flood', fu])
        ops += [['w', '_w_crue', nid] for nid in nids if nodes[nid]['owner'] in CODES]
    ops.append(['set_t', t])
    # textes et effets des événements
    for src in ('hist', 'rand', 'local'):
        for eid, ev in SRC[src].items():
            code = rnd.choice(CODES)
            town = rnd.choice([None, rnd.choice(nids)])
            cs = list(range(len(ev.get('choices') or []))) + ([-1] if ev.get('base') else [])
            for ci in cs:
                if src == 'local':
                    nid = rnd.choice(nids)
                    c = ev['choices'][ci] if ci >= 0 else None
                    fx = dict(ville=dict(c.get('v', {}) if c else ev['base'], nid=nid))
                    if c and c.get('troops'):
                        fx['ville']['troops'] = True
                    if c and c.get('res'):
                        fx['res'] = {r: round(q * 1.8) for r, q in c['res'].items()}
                    ops += [['describe', code, fx, town], ['affordable', code, fx], ['soften', code, eid, fx]]
                else:
                    ops += [['describe_ev', code, src, eid, ci, town], ['affordable_ev', code, src, eid, ci],
                            ['soften_ev', code, src, eid, ci]]
    ops += [['describe', c, dict(chef=dict(nom='Jean Labat', ne=1750, trait=tr), vassal=rnd.choice(CODES), refus=rnd.choice(CODES)), None]
            for c, tr in zip(CODES, R.MAISON_TRAITS)]
    ops += [['describe', rnd.choice(CODES), dict(res=dict(livres=-12.7, bois=3), weary=-4.5, glory=2, rel=-10.5, research=1,
                                                   tmod=dict(morale=5, order=-0.1, xyz=0.2), days=rnd.choice([30, 400.0, 3000]),
                                                   pmod=dict(morale=-2.5, vin=0.08), regs=[['ligne', 2], ['cavalerie', 1]],
                                                   town_pop=-0.02, town_stab=0.03, pop=0.01, stab=-0.005), rnd.choice(nids)]]
    # effets appliqués
    for k in range(40):
        src = rnd.choice(['hist', 'rand'])
        eid = rnd.choice(list(SRC[src]))
        ev = SRC[src][eid]
        cs = list(range(len(ev.get('choices') or []))) + ([-1] if ev.get('base') else [])
        ops.append(['apply_ev', rnd.choice(CODES), src, eid, rnd.choice(cs), rnd.choice([None, rnd.choice(nids)])])
        if k % 8 == 7:
            ops += [['factions'], ['state']]
    ops.append(['apply', rnd.choice(CODES), dict(res=dict(livres=-1e6, vivres=50), res_pct=dict(fer=-0.5, xyz=0.1), weary=200,
                                                 glory=-3, rel=150, regs=[['legere', 2]], research=1, tmod=dict(order=-0.2),
                                                 ev='cholera', pmod=dict(fer=0.1)), None])
    ops += [['factions'], ['state'], ['journal']]
    # déclenchement pour les IA
    for eid, ev in EV.HIST_BY_ID.items():
        for code in rnd.sample(vivants, 2):
            ops.append(['ev_fire', code, 'hist', eid])
    for eid in EV.RANDOM_BY_ID:
        for code in vivants:
            ops.append(['ev_fire', code, 'rand', eid])
    ops += [['factions'], ['state'], ['journal']]
    # décisions du joueur (préparées à la main) : résolues, puis expirées
    for k, town in enumerate([None, rnd.choice(nids)]):
        ops.append(['add_pending', dict(id=f'e9{k}', ev='x', kind='hist', title='Titre', text='', town=town, base='',
                                        until=t + 5 * k, date='',
                                        choices=[dict(label='Prendre tout', fx=dict(res=dict(livres=-1e7)), desc=['a']),
                                                 dict(label='Laisser', fx=dict(stab=0.02), desc=['b', 'c']),
                                                 dict(label='Rien', fx=dict(), desc=['aucun effet'])])])
    ops += [['resolve', 'e90', 0, False], ['resolve', 'e90', 5, False], ['resolve', 'e99', 0, False], ['resolve', 'e90', -1, False],
            ['set_t', t + 2], ['expire'], ['set_t', t + 6], ['expire'], ['resolve', 'e91', 1, True], ['factions'], ['journal']]
    ops.append(['add_pending', dict(id='e92', ev='x', kind='hist', title='T2', text='', town=None, base='', until=t,
                                    date='', choices=[dict(label='Payer', fx=dict(res=dict(livres=-1e7)), desc=['a']),
                                                      dict(label='Payer aussi', fx=dict(res=dict(livres=-2e7)), desc=['a'])])])
    ops += [['expire'], ['journal'], ['set_t', t]]
    # familles
    ops += [['nouvelle', c] for c in CODES] + [['titre']]
    for a in CODES:
        ops.append(['epoux', a])
        ops.append(['vue', a])
        for b in CODES:
            if a != b:
                ops += [['lie', a, b], ['refus', a, b]]
    for k in range(8):
        a, b = rnd.sample(CODES, 2)
        ops += [['marier_si', a, b], ['vue', a], ['vue', b]]
    for k in range(4):
        a, b = rnd.sample(CODES, 2)
        ops.append(['guerre', a, b])
    for k in range(6):
        ops += [['set_t', t + 365 * (k + 1)], ['annuel'], ['factions'], ['journal']]
    for c in CODES:
        ops += [['mort_si', c, 'test'], ['vue', c]]
    ops += [['factions'], ['journal']]
    for c in CODES:
        o = rnd.choice([x for x in CODES if x != c])
        ops += [['appliquer', c, dict(chef=dict(nom='Pierre Dufau', ne=1760, trait=rnd.choice(list(R.MAISON_TRAITS)), maison='Dufau'),
                                      vassal=rnd.choice([None, o]), refus=rnd.choice([None, o]))],
                ['appliquer', c, dict(chef=dict(nom='Jean Lacoste', ne=1770, trait=list(R.MAISON_TRAITS)[-1]))], ['vue', c]]
    ops += [['factions'], ['state'], ['journal']]
    # chaque jour : événements datés, événements aléatoires, familles
    ops += [['set_t', t], ['ev_tick', 500], ['factions'], ['state'], ['journal'], ['hasard']]
    # événements locaux des IA dont aucun choix n'a d'effet passager (tm : turns.deadline)
    for nid in [nid for nid in nids if nodes[nid]['owner'] in vivants][:16]:
        for eid in ('disette', 'refugies', 'filon'):
            ops += [['set_t', t + rnd.choice([0, 300])], ['ct_fire', nodes[nid]['owner'], nid, eid], ['node', nid]]
    ops += [['factions'], ['state'], ['journal'], ['stats'], ['hasard']]
    # ------------------------------------------------------------ ce qui passe par turns.deadline
    ops.append(['tt'])
    ais = [nid for nid in nids if nodes[nid]['owner'] in vivants]
    for nid in ais[:15]:
        ops.append(['set_policy', nodes[nid]['owner'], nid, rnd.choice(POL + ['xyz']), rnd.random() < 0.2])
        ops += [['node', nid], ['pfx', nid], ['policy_w', nid]]
    for nid in ais[:20]:
        ops.append(['ct_fire', nodes[nid]['owner'], nid, rnd.choice([None, rnd.choice(list(CT.LOCAL_BY_ID))])])
        ops.append(['node', nid])
    ops += [['factions'], ['state'], ['journal'], ['stats']]
    for k in range(60):
        ops += [['set_t', t + 3 + k], ['ct_daily']]
    ops += [['grande_crue'], ['factions'], ['state'], ['journal'], ['stats'], ['hasard']]
    return ops


# ------------------------------------------------------------------ rejouer
def fx_de(src, eid, ci):
    ev = SRC[src][eid]
    return ev['base'] if ci < 0 else ev['choices'][ci]['fx']


def jouer(g, op):
    k = op[0]
    a = op[1:]
    if k == 'slot_count':
        return CT.slot_count(g, g.nodes[a[0]])
    if k == 'bfx':
        return CT.bfx(g.nodes[a[0]])
    if k == 'pfx':
        return CT.pfx(g, g.nodes[a[0]])
    if k == 'policy_w':
        return CT.policy_w(g, g.nodes[a[0]])
    if k == 'stab_bonus':
        return CT.stab_bonus(g, g.nodes[a[0]])
    if k == 'growth_k':
        return CT.growth_k(g, g.nodes[a[0]])
    if k == 'train_k':
        return CT.train_k(g, g.nodes[a[0]], a[1])
    if k == 'train_xp':
        return CT.train_xp(g, g.nodes[a[0]])
    if k == 'river':
        return CT._river(g, a[0])
    if k == 'hilly':
        return CT._hilly(g, a[0])
    if k == 'trading':
        return CT._trading(g, a[0])
    if k == 'troops':
        return CT._troops(g, g.nodes[a[0]], a[1])
    if k == 'fill_ct':
        return CT._fill(g, a[0], a[1])
    if k == 'node_extra':
        out = {r: 1.25 for r in CT.PROD}
        tr = CT.node_extra(g, g.nodes[a[0]], a[1], out, a[2])
        return [tr, out]
    if k == 'node_view':
        return CT.node_view(g, g.nodes[a[0]])
    if k == 'weights':
        return [[e['id'], w] for e, w in CT.weights(g, g.nodes[a[0]])]
    if k == 'w':
        n = g.nodes[a[1]]
        return getattr(CT, a[0])(g, n, g.geo.nodes[a[1]], g.season())
    if k == 'fits':
        return CT.fits(g, a[0], a[1])
    if k == 'check':
        return list(CT.check(g, a[0], g.nodes[a[1]], a[2]))
    if k == 'level_name':
        return CT.level_name(g, *a)
    if k == 'level_tech':
        return CT.level_tech(g, *a)
    if k == 'ai_value':
        class A:
            pass
        ai = A()
        ai.code, ai.pers, ai.g, ai.f = a[0], R.FACTIONS[a[0]]['personality'], g, g.factions[a[0]]
        return CT._ai_value(g, ai, g.nodes[a[1]], a[2], a[3], a[4])
    if k == 'upkeep':
        return CT.upkeep(g, a[0])
    if k == 'college_k':
        return CT.college_k(g, a[0])
    if k == 'prestige':
        return CT.prestige(g.nodes)
    if k == 'research':
        CT.research(g)
        return [f['research'] for f in g.factions.values()]
    if k == 'factions':
        return commun.empreinte_ordre(g.factions)
    if k == 'state':
        return [commun.empreinte_ordre(g.nodes), [list(x) + [v] for x, v in g.diplo.items()], g.uid, g.over, g.speed_idx,
                g._dirty_income]
    if k == 'journal':
        j = [[e['kind'], e['text'], e['who'], e['important'], e['x']] for e in g.events]
        g.events = []
        return j
    if k == 'slot_build':
        return list(CT.slot_build(g, *a))
    if k == 'demolish':
        return list(CT.demolish(g, *a))
    if k == 'finish':
        n = g.nodes[a[0]]
        q = next((q for q in n['queue'] if q['kind'] == 'slot'), None)
        if q is None:
            return None
        n['queue'].remove(q)
        CT.finish(g, n, q)
        return q
    if k == 'sync':
        CT.sync(g, g.nodes[a[0]])
        return None
    if k == 'node':
        n = g.nodes[a[0]]
        return [n.get('slots'), n['queue'], n['milice'], n['milice_max'], n['depot'], n.get('pol'), n.get('tm'), n.get('bo'),
                n['stab'], n['pop']]
    if k == 'set_t':
        g.t = a[0]
        return None
    if k == 'set_flood':
        g.flood_until = a[0]
        return None
    if k == 'describe':
        return EV.describe(g, a[0], a[1], a[2])
    if k == 'affordable':
        return EV.affordable(g, a[0], a[1])
    if k == 'soften':
        return EV.soften(g, a[0], a[1], a[2])
    if k == 'describe_ev':
        return EV.describe(g, a[0], fx_de(a[1], a[2], a[3]), a[4])
    if k == 'affordable_ev':
        return EV.affordable(g, a[0], fx_de(a[1], a[2], a[3]))
    if k == 'soften_ev':
        return EV.soften(g, a[0], a[2], fx_de(a[1], a[2], a[3]))
    if k == 'apply_ev':
        EV.apply(g, a[0], fx_de(a[1], a[2], a[3]), a[4])
        return [g.factions[a[0]]['res'], commun.empreinte_ordre(g.factions[a[0]])]
    if k == 'apply':
        EV.apply(g, a[0], a[1], a[2])
        return g.factions[a[0]]
    if k == 'ev_fire':
        EV.fire(g, a[0], SRC[a[1]][a[2]], a[1])
        return None
    if k == 'add_pending':
        g.pending_ev.append(json.loads(json.dumps(a[0])))
        return None
    if k == 'resolve':
        return list(EV.resolve(g, a[0], a[1], auto=a[2]))
    if k == 'expire':
        EV.expire(g)
        return g.pending_ev
    if k == 'nouvelle':
        return FM.nouvelle(g, a[0])
    if k == 'titre':
        return FM.titre(g)
    if k == 'epoux':
        return FM.epoux(g, a[0])
    if k == 'vue':
        return FM.vue(g, a[0])
    if k == 'lie':
        return FM.lie(g, a[0], a[1])
    if k == 'refus':
        return FM.refus_mariage(g, a[0], a[1])
    if k == 'marier_si':
        why = FM.refus_mariage(g, a[0], a[1])
        if why is None:
            FM.marier(g, a[0], a[1])
        return why
    if k == 'guerre':
        FM.guerre(g, a[0], a[1])
        return g.factions[a[0]].get('tmods')
    if k == 'annuel':
        FM.annuel(g)
        return None
    if k == 'mort_si':
        m = g.factions[a[0]]['maison']
        if not m['chef'] or (a[0] == g.player and not m['heritiers']):
            return False
        FM.mort(g, a[0], FM._rng(g, a[0], a[1]))
        return True
    if k == 'appliquer':
        FM.appliquer(g, a[0], a[1])
        return g.factions[a[0]]['maison']
    if k == 'ev_tick':
        for _ in range(a[0]):
            g.t += 1
            d = g.date()
            EV.tick(g, d)
            if d.month == 1 and d.day == 1:
                FM.annuel(g)
        return g.ev_done
    if k == 'hasard':
        return g.rng.random()
    if k == 'tt':
        return None
    if k == 'set_policy':
        return list(CT.set_policy(g, *a))
    if k == 'ct_fire':
        ev = CT.LOCAL_BY_ID[a[2]] if a[2] else None
        return CT.fire(g, a[0], g.nodes[a[1]], ev)
    if k == 'stats':
        return CT.stats(g)
    if k == 'ct_daily':
        CT.daily(g, g.date())
        return None
    if k == 'grande_crue':
        CT.grande_crue(g)
        return None
    raise ValueError(k)


if __name__ == '__main__':
    rnd = random.Random(1855)
    jeux = []
    for i in range(4):
        cas = cas_de(i, rnd)
        ops = ops_de(cas, rnd)
        g = partie(cas)
        vu = []
        for op in ops:
            vu.append(json.loads(json.dumps(commun._plat(jouer(g, op)))))
        jeux.append(dict(cas=cas, ops=ops, vu=vu))
    commun.ecrire('villes', dict(pur=pur(), jeux=jeux))
