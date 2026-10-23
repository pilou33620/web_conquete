"""Actions d'une armée dans une place : fortification de fortune, quartiers, garde bourgeoise, réquisition ;
devant une place étrangère : traversée et droit de passage, ralliement négocié, contribution, blocus.

L'état propre à une place est rangé dans n['aa'] (travaux, solidité des barricades, garde, négociation, délais) ;
celui d'une armée dans a['tr'] (traverser), a['hold'] (halte devant une place), a['qrt'] (quartiers), a['rg'] (rangs à compléter),
a['cl'] (sur des terres fermées : délai de grâce), a['ex'] (terres fermées dont son itinéraire la fait sortir),
a['dt'] (terres fermées que son itinéraire contourne) ; les droits de passage dans
faction['passage'] = {bénéficiaire: échéance}.
"""
import math

from . import rules as R
from . import turns as TT
from .geo import TERRAIN

# ------------------------------------------------------------------ fortification de fortune
BAR_WORK = dict(village=4000, fort=5000, ville=6000, capitale=9000)   # journées d'homme
BAR_BOIS = dict(village=40, fort=50, ville=60, capitale=90)
BAR_SAPEUR = 5          # un sapeur abat l'ouvrage de six fantassins
BAR_DAYS = (2.0, 20.0)  # durée des travaux, au plus court et au plus long
BAR_LEVEL = 0.8         # une place sans remparts barricadée vaut presque un mur d'enceinte (niveau 1)
RED_LEVEL = 0.3         # redoutes devant des remparts : petit bonus
RED_WORK = 0.6          # les redoutes demandent moins de travail
BAR_WEAR = 1 / 90       # usure par jour : environ trois tours
BAR_WET = 1.5           # pluie, orage, neige, tempête
BAR_WINTER = 1.3
BAR_SIEGE = 1.6         # la brèche s'ouvre plus vite que dans des remparts
BAR_GUN = 0.012         # usure par jour et par batterie ennemie qui tire dessus
BAR_REDO = 0.7          # on peut relever un ouvrage usé sous ce seuil
BAR_MIN = 0.25          # en dessous, l'ouvrage n'arrête plus personne (plus de siège)

# ------------------------------------------------------------------ quartiers
QRT_REPL = 0.01         # renforts en plus par jour (part de l'effectif) : les quartiers sont surtout repos et ordre
QRT_FOOD = 0.6          # vivres consommés en plus (part de l'entretien)
QRT_STAB = 0.12         # ordre public visé en plus dans la place

# ------------------------------------------------------------------ compléter les rangs
RNG_LOURD = 0.30        # au-delà de 30 % de pertes, deux tours : une classe ne se lève ni ne s'instruit en un mois
RNG_MIN = 0.02          # en dessous, les rangs sont au complet
RNG_REMONTE = 0.10      # cavalerie et attelages : au-delà de 10 % de pertes, un tour de plus pour acheter et dresser les
                        # remontes (le goulot des armées : en 1813, la cavalerie française ne s'en est jamais remise)
RNG_CADRE = 0.05        # régiment anéanti : le dépôt envoie un cadre d'officiers et de sous-officiers autour duquel le relever
MORTS_JOURS = 40        # régiments anéantis qu'on peut encore relever : ceux de la bataille ou du mois précédents

# ------------------------------------------------------------------ garde bourgeoise
GARDE_TOURS = 2
GARDE_CD = 6            # délai entre deux levées dans la même place (tours)
GARDE_MM = 0.6          # milice en plus : part de la milice ordinaire…
GARDE_POP = 0.012       # … et des habitants
GARDE_MAX = 900
GARDE_ARMES = 0.15      # armes par homme armé
GARDE_PROD = 0.9        # production pendant que les bourgeois montent la garde

# ------------------------------------------------------------------ réquisition
REQ_CD = 4               # tours
REQ_STAB = 0.25
REQ = dict(vivres=(30, 0.012, 900), recrues=(10, 0.003, 300), livres=(0, 0.004, 400))   # (fixe, par habitant, plafond)

# ------------------------------------------------------------------ ralliement négocié
NEG_TOURS = 1            # réponse des notables : au tour suivant
NEG_BASE, NEG_POP, NEG_MIL = 40, 0.02, 1.0
NEG_CD = 1              # après un refus, les notables ne reçoivent plus pendant un tour

# ------------------------------------------------------------------ contribution
CTB_CD = 3               # tours
CTB_MIN = 0.5           # rapport de forces minimal pour se faire payer
CTB = dict(livres=(30, 0.01, 900), vivres=(20, 0.012, 600))
CTB_REL_ALL = 5         # place indépendante : tous les départements s'en indignent…
CTB_REL_HOME = 8        # … surtout celui dont elle relève
CTB_REL_OWNER = 15      # place ennemie : son maître s'en souviendra
CTB_STAB = 0.15

# ------------------------------------------------------------------ blocus
BLOC_FOOD = dict(village=18, fort=30, ville=25, capitale=35)   # jours de réserves
BLOC_DEPOT = 40         # un magasin aux vivres tient bien plus longtemps
BLOC_STARVE = 25        # jours de famine avant la reddition
BLOC_MIN = 0.5          # rapport de forces pour investir la place

# ------------------------------------------------------------------ passage
PASSAGE_TOURS = 12   # droit de passage accordé (tours)
INCIDENT_CD = 60        # au-delà du délai de grâce : un incident par armée et par département, au plus tous les deux mois
INCIDENT_REL = 10
NOTICE_CD = 60


def clamp(v, a, b):
    return max(a, min(b, v))


def node_aa(n):
    return n.get('aa') or {}


def aa(n):
    return n.setdefault('aa', {})


def cd_left(g, n, k):
    """Tours d'attente qui restent avant de pouvoir recommencer (0 : c'est possible)."""
    return TT.tours_left(g, node_aa(n).get('cd', {}).get(k, -1))


def set_cd(g, n, k, tours, code):
    aa(n).setdefault('cd', {})[k] = TT.deadline(g, tours, code)


def place(g, nid):
    return g.geo.nodes[nid]['name']


def migrate(g):
    """Anciennes sauvegardes : ni travaux, ni droits de passage, ni quartiers."""
    for f in g.factions.values():
        f.setdefault('passage', {})
    for a in g.armies.values():
        for k in ('tr', 'hold', 'qrt', 'rg'):
            a.setdefault(k, False)
        a.pop('trx', None)   # ancien passage forcé « quitte à provoquer un incident »


# ================================================================== défense des places
def works_level(n):
    """Niveau de défense provisoire : barricades d'une place sans remparts, redoutes devant des remparts."""
    s = node_aa(n).get('bar', 0.0)
    if s <= 0:
        return 0.0
    return (BAR_LEVEL if n['fort'] <= 0 else RED_LEVEL) * s


def breach(n):
    """Brèche ouverte par un siège (un blocus n'abîme pas les murs)."""
    s = n['siege']
    return s['dmg'] if s and not s.get('blocus') else 0.0


BREACH_STEP = 1 / 2.4   # une brèche de plus sur la carte de la bataille (tactics/terrain.py, _walls) : autant de murs en moins


def fort_eff(g, n, att=None):
    """Remparts moins la brèche, et ouvrages de fortune ; att : l'assaillant, dont la dynamite ouvre une brèche de plus."""
    b = breach(n)
    if att in g.factions:
        b = min(1.0, b + BREACH_STEP * g.mod(att, 'breach'))
    return (n['fort'] + works_level(n)) * (1 - b)


def walled(n):
    """La place se prend-elle par un siège plutôt que d'emblée ?"""
    return n['fort'] >= 1 or works_level(n) >= BAR_LEVEL * BAR_MIN


def siege_k(n):
    return BAR_SIEGE if n['fort'] <= 0 and works_level(n) > 0 else 1.0


def output_k(g, n):
    return GARDE_PROD if 'gd' in node_aa(n) else 1.0


def stab_bonus(g, n):
    return QRT_STAB if n['id'] in getattr(g, '_aa_qn', ()) else 0.0


def extra_food(g, code):
    """Vivres consommés en plus par les armées en quartiers (par jour, avant les technologies)."""
    v = 0.0
    for a in g.armies.values():
        if a['owner'] == code and a.get('qrt'):
            v += sum(R.UNITS[r['type']]['upkeep_v'] * r['n'] / 100 for r in a['regs']) * QRT_FOOD
    return v


def force_ratio(g, code, nid):
    """Rapport de forces entre nos armées devant la place et ses défenseurs."""
    gn = g.geo.nodes[nid]
    tname = TERRAIN[g.geo.terrain_at(gn['x'], gn['y'])][0]
    mine = sum(g.army_power(b, tname) for b in g.armies.values()
               if b['owner'] == code and b['at_node'] == nid and b['state'] in ('idle', 'siege'))
    return mine / max(1.0, g.node_defense_power(nid))


def on_capture(g, nid):
    """La place change de mains : ouvrages rasés, travaux et pourparlers abandonnés, bourgeois désarmés."""
    n = g.nodes[nid]
    x = node_aa(n)
    if not x:
        return
    ng = x.pop('ng', None)
    if ng and ng['by'] in g.factions:
        g.factions[ng['by']]['res']['livres'] += ng['price']
    end_garde(g, n, quiet=True)
    x.pop('bw', None)
    x.pop('bar', None)


# ================================================================== tic
def tick(g, dt, flush=False):
    """(par quarts de jour ; flush : le reste aussi, à la fin du tour des IA, pour que ce qui est dû au 1er du mois s'y
    règle, comme une réponse de pourparlers annoncée « au prochain tour »)"""
    g._aa_dt = getattr(g, '_aa_dt', 0.0) + dt
    if g._aa_dt < 0.25 and not (flush and g._aa_dt > 0):
        return
    dt, g._aa_dt = g._aa_dt, 0.0
    quarters_tick(g, dt)
    rangs_tick(g, dt)
    for n in g.nodes:
        x = n.get('aa')
        if not x:
            continue
        if 'bw' in x:
            works_tick(g, n, x, dt)
        if x.get('bar'):
            wear_tick(g, n, x, dt)
        if 'gd' in x and x['gd']['until'] <= g.t:
            end_garde(g, n)
        if 'ng' in x:
            neg_tick(g, n, x, dt)
    day = int(g.t)
    if day != getattr(g, '_aa_day', -1):
        g._aa_day = day
        passage_tick(g)


# ================================================================== 1. fortification de fortune
def fortify_info(g, a, nid):
    n, gn = g.nodes[nid], g.geo.nodes[nid]
    kind = 'bar' if n['fort'] <= 0 else 'red'
    cur = node_aa(n).get('bar', 0.0)
    frac = max(0.3, 1 - cur)
    men = g.army_men(a)
    sap = sum(r['n'] for r in a['regs'] if r['type'] == 'sapeurs')
    work = BAR_WORK[gn['type']] * (RED_WORK if kind == 'red' else 1) * frac
    days = clamp(work / max(1.0, men + BAR_SAPEUR * sap), *BAR_DAYS)
    bois = int(round(BAR_BOIS[gn['type']] * frac))
    return kind, round(days, 1), bois, cur


def works_name(n, kind=None):
    kind = kind or ('bar' if n['fort'] <= 0 else 'red')
    return 'barricades et palissades' if kind == 'bar' else 'redoutes et ouvrages de campagne'


def fortify(g, code, a):
    nid, why = own_place(g, code, a, siege_ok=True)
    if why:
        return False, why
    n = g.nodes[nid]
    x = aa(n)
    if 'bw' in x:
        return False, "Des travaux sont déjà en cours dans cette place."
    kind, days, bois, cur = fortify_info(g, a, nid)
    if cur >= BAR_REDO:
        return False, f"Les {works_name(n, kind)} tiennent encore ({int(cur * 100)} %)."
    if g.factions[code]['res']['bois'] < bois:
        return False, f"Il faut {bois} bois."
    g.factions[code]['res']['bois'] -= bois
    x['bw'] = dict(by=a['id'], code=code, kind=kind, left=days, total=days)
    return True, f"La troupe élève des {works_name(n, kind)} à {place(g, nid)} ({TT.part_tour(days)}, {bois} bois)."


def works_tick(g, n, x, dt):
    w = x['bw']
    a = g.armies.get(w['by'])
    nid = n['id']
    if not a or a['at_node'] != nid or a['state'] != 'idle' or n['owner'] != w['code'] or a['owner'] != w['code']:
        del x['bw']
        if w['code'] == g.player:
            g.log('armee', f"Travaux abandonnés à {place(g, nid)} : la troupe est partie.", *g.node_xy(nid), who=w['code'])
        return
    w['left'] -= dt
    if w['left'] > 0:
        return
    del x['bw']
    x['bar'] = 1.0
    if w['code'] == g.player:
        txt = ("la place pourra soutenir un siège" if w['kind'] == 'bar' else "la défense en est un peu renforcée")
        g.log('armee', f"{works_name(n, w['kind']).capitalize()} achevées à {place(g, nid)} : {txt}, "
                       f"le temps qu'elles durent (environ trois tours).", *g.node_xy(nid), who=w['code'], important=True)


def wear_tick(g, n, x, dt):
    gx, gy = g.node_xy(n['id'])
    k = BAR_WEAR
    if g.weather[g.zone_of(gx, gy)]['kind'] in ('pluie', 'orage', 'neige', 'tempete'):
        k *= BAR_WET
    if g.season() == 'hiver':
        k *= BAR_WINTER
    s = n['siege']
    if s and not s.get('blocus') and not s.get('occupy'):
        guns = sum(1 for b in g.armies.values() if b['at_node'] == n['id'] and b['owner'] == s['by']
                   and b['state'] in ('siege', 'battle') for r in b['regs'] if r['type'] == 'artillerie')
        k += BAR_GUN * guns
    x['bar'] = max(0.0, x['bar'] - k * dt)
    if x['bar'] < 0.05:
        del x['bar']
        if n['owner'] == g.player:
            g.log('armee', f"Les {works_name(n)} {R.de(place(g, n['id']))} ne sont plus que des débris.",
                  gx, gy, who=n['owner'])


# ================================================================== 2. quartiers
def quarters(g, code, a, on):
    if not on:
        if not a.get('qrt'):
            return False, "L'armée n'a pas pris ses quartiers."
        a['qrt'] = False
        g._dirty_income = True
        return True, "L'armée lève le camp."
    nid, why = own_place(g, code, a)
    if why:
        return False, why
    if a.get('qrt'):
        return False, "L'armée a déjà pris ses quartiers."
    a['qrt'] = True
    g._dirty_income = True
    return True, (f"La {a['name']} prend ses quartiers à {place(g, nid)} : renforts et moral plus rapides, "
                  f"ordre public en hausse, mais elle mange davantage.")


def quarters_tick(g, dt):
    qn = set()
    for a in g.armies.values():
        if not a.get('qrt'):
            continue
        nid = a['at_node']
        code = a['owner']
        if nid is None or a['state'] != 'idle' or a.get('boat') or g.nodes[nid]['owner'] != code or g.nodes[nid]['siege']:
            a['qrt'] = False
            g._dirty_income = True
            continue
        qn.add(nid)
        f = g.factions[code]
        if not (f.get('banqueroute') or f.get('famine')):
            g.replenish(code, a['regs'], dt, QRT_REPL)
    g._aa_qn = qn


# ================================================================== 2 bis. compléter les rangs
def monte(r):
    """Régiment monté ou attelé (cavalerie, artillerie, mitrailleuses) : ses pertes se comblent en chevaux dressés."""
    return R.UNITS[r['type']]['cls'] != 'inf'


def rangs_info(g, a):
    """(hommes à lever, armes, tours, tours de l'infanterie) pour remettre au complet les régiments présents ; les
    régiments montés qui ont perdu plus de RNG_REMONTE attendent leurs remontes un tour de plus."""
    need = sum(r['max'] - r['n'] for r in a['regs'])
    mx = sum(r['max'] for r in a['regs']) or 1
    t = 1 if need / mx <= RNG_LOURD else 2
    m = [r for r in a['regs'] if monte(r)]
    rm = sum(r['max'] - r['n'] for r in m) > RNG_REMONTE * sum(r['max'] for r in m)
    return need, math.ceil(need * R.REPL_ARMES), t + rm, t


def rangs_place(g, code, a):
    """(place, raison) : à l'arrêt dans une de nos villes, ou un village qui a un magasin ; trésor en état."""
    nid, why = own_place(g, code, a)
    if why:
        return None, why
    if g.geo.nodes[nid]['type'] == 'village' and not g.nodes[nid].get('depot'):
        return None, "Il faut une ville ou un magasin : les conscrits se rassemblent au dépôt."
    f = g.factions[code]
    if f.get('banqueroute') or f.get('famine'):
        return None, "Le trésor ne peut lever ni habiller de recrues."
    return nid, ''


def rangs_why(g, code, a):
    _, why = rangs_place(g, code, a)
    if why:
        return why
    if a.get('rg'):
        return "Les renforts sont déjà en route."
    need, armes, _, _ = rangs_info(g, a)
    if need < RNG_MIN * (sum(r['max'] for r in a['regs']) or 1):
        return "Les rangs sont au complet."
    res = g.factions[code]['res']
    if res['recrues'] < need or res['armes'] < armes:
        return f"Il faut {int(need)} recrues et {armes} armes."
    return ''


def rangs_ok(g, a):
    """(ok, raison) : les renforts peuvent-ils continuer d'arriver ?"""
    if a['id'] not in g.armies:
        return False, "l'armée n'est plus"
    nid, why = rangs_place(g, a['owner'], a)
    if why:
        return False, why[0].lower() + why[1:].rstrip('.')
    if nid != a['rg']['node']:
        return False, "l'armée a changé de place"
    return True, ''


def rangs(g, code, a, on):
    if not on:
        if not a.get('rg'):
            return False, "Aucun renfort n'est en route."
        rangs_stop(g, a, "ordre de l'état-major")
        return True, "Les renforts sont arrêtés."
    why = rangs_why(g, code, a)
    if why:
        return False, why
    nid = a['at_node']
    need, armes, tours, ti = rangs_info(g, a)
    a['rg'] = dict(node=nid, until=TT.deadline(g, tours, code), ui=TT.deadline(g, ti, code), men=need, t0=g.t)
    when = 'au prochain tour' if tours == 1 else f'dans {tours} tours'
    rm = " (les remontes de chevaux prennent un tour de plus)" if tours > ti else ''
    return True, (f"La {a['name']} complète ses rangs à {place(g, nid)} : {int(need)} recrues et {armes} armes, "
                  f"au complet {when}{rm}. Elle doit rester sur place.")


def rangs_stop(g, a, why):
    nid = a['rg']['node']
    a['rg'] = False
    if a['owner'] == g.player:
        g.log('armee', f"Les renforts destinés à la {a['name']} s'arrêtent à {place(g, nid)} : {why}. "
                       f"Les hommes déjà arrivés restent dans les rangs.", *g.node_xy(nid), who=a['owner'])


def rangs_tick(g, dt):
    """Les détachements du dépôt arrivent au fil des jours ; le dernier pas, à l'échéance, comble tout."""
    for a in list(g.armies.values()):
        rg = a.get('rg')
        if not rg:
            continue
        ok, why = rangs_ok(g, a)
        if not ok:
            rangs_stop(g, a, why)
            continue
        code = a['owner']
        kk = lambda until: 1.0 if until <= g.t + 1e-6 else min(1.0, dt / max(dt, until - g.t + dt))
        k, ki = kk(rg['until']), kk(rg.get('ui', rg['until']))   # (l'infanterie n'attend pas les remontes)
        full = True
        for r in a['regs']:
            if r['n'] < r['max']:
                g.reinforce(code, r, (r['max'] - r['n']) * (k if monte(r) else ki))
                full = full and r['n'] >= r['max'] - 1e-6
        if k < 1:
            continue
        a['rg'] = False
        if code == g.player:
            nm = place(g, rg['node'])
            got = int(round(rg['men'] - sum(r['max'] - r['n'] for r in a['regs'])))
            g.log('armee', f"La {a['name']} a complété ses rangs à {nm} (+{max(0, got)} hommes, l'expérience des "
                           f"anciens diluée)." if full else f"Rangs incomplets à {nm} : il manque des recrues ou des armes.",
                  *g.node_xy(rg['node']), who=code, important=True)


def morts(g, a):
    """Régiments de l'armée anéantis depuis peu (engine.bury) : [[rang dans l'armée, type, id, date], ...]."""
    return sorted(m for m in a.get('morts') or [] if m[3] > g.t - MORTS_JOURS)


def relever_info(g, code, a):
    """(régiments à relever, prix de leur levée hors recrues et armes, que les renforts versent comme aux autres)."""
    ms, cost = morts(g, a), {}
    for m in ms:
        for k, v in g.unit_cost(code, m[1]).items():
            if k not in ('recrues', 'armes'):
                cost[k] = cost.get(k, 0) + v
    return ms, cost


def relever_why(g, code, a):
    _, why = rangs_place(g, code, a)
    if why:
        return why
    if a.get('rg'):
        return "Les renforts sont déjà en route."
    ms, cost = relever_info(g, code, a)
    if not ms:
        return "Aucun régiment anéanti à relever."
    need = sum(r['max'] - r['n'] for r in a['regs']) + sum(R.UNITS[m[1]]['men'] for m in ms)
    cost = dict(cost, recrues=need, armes=math.ceil(need * R.REPL_ARMES))
    if not g.can_pay(code, cost):
        return "Il faut " + ', '.join(f"{math.ceil(v)} {k}" for k, v in cost.items()) + '.'
    return ''


def relever(g, code, a):
    """Relève les régiments anéantis depuis peu, sous leur nom et leur numéro (leur rang dans l'armée), autour d'un cadre
    du dépôt : la levée se paie comme un régiment neuf, puis les recrues arrivent comme pour « Compléter les rangs »."""
    why = relever_why(g, code, a)
    if why:
        return False, why
    ms, cost = relever_info(g, code, a)
    g.pay(code, cost)
    for i, typ, rid, _ in ms:   # dans l'ordre des rangs : chacun reprend sa place, donc son numéro de bataille
        reg = g.new_reg(typ, 0, code)
        reg['id'] = rid
        g.reinforce(code, reg, RNG_CADRE * reg['max'])
        a['regs'].insert(min(i, len(a['regs'])), reg)
    a.pop('morts', None)
    from .tactics import units as U
    ids = {m[2] for m in ms}
    nms = [U.unit_name(g, code, r['type'], 1 + sum(q['type'] == r['type'] for q in a['regs'][:i]))
           for i, r in enumerate(a['regs']) if r['id'] in ids]   # le nom que lui donnera la bataille
    ok, msg = rangs(g, code, a, True)
    return True, f"{', '.join(nms)} : relevé{'s' if len(ms) > 1 else ''} autour du cadre du dépôt. {msg}"


# ================================================================== 3. garde bourgeoise
def garde_info(n):
    add = int(round(min(GARDE_MAX, GARDE_MM * n['milice_max'] + GARDE_POP * n.get('pop', 0))))
    return add, int(round(add * GARDE_ARMES))


def garde(g, code, a):
    nid, why = own_place(g, code, a, siege_ok=True)
    if why:
        return False, why
    n = g.nodes[nid]
    if 'gd' in node_aa(n):
        return False, "Les bourgeois sont déjà sous les armes."
    left = cd_left(g, n, 'garde')
    if left > 0:
        return False, f"Les habitants ont rendu leurs armes il y a peu : encore {R.pl(left, 'tour')}."
    add, armes = garde_info(n)
    f = g.factions[code]
    if f['res']['armes'] < armes:
        return False, f"Il faut {armes} armes."
    f['res']['armes'] -= armes
    aa(n)['gd'] = dict(until=TT.deadline(g, GARDE_TOURS, code), add=add)
    n['milice_max'] += add
    n['milice'] += add
    set_cd(g, n, 'garde', GARDE_CD, code)
    g._dirty_income = True
    gname = g.unit_name(code, 'garde')[0].lower()
    return True, (f"{R.nb(add)} habitants de {place(g, nid)} prennent les armes ({gname}) pour {GARDE_TOURS} tours "
                  f"({armes} armes). La production de la place baisse un peu.")


def end_garde(g, n, quiet=False):
    gd = node_aa(n).get('gd')
    if not gd:
        return
    del n['aa']['gd']
    n['milice_max'] = max(20.0, n['milice_max'] - gd['add'])
    n['milice'] = min(n['milice'], n['milice_max'])
    g._dirty_income = True
    if not quiet and n['owner'] == g.player:
        g.log('armee', f"Les bourgeois {R.de(place(g, n['id']))} rendent leurs armes.", *g.node_xy(n['id']), who=n['owner'])


# ================================================================== 4. réquisition
def req_info(n):
    pop = n.get('pop', 0)
    return {k: int(round(min(top, c + pop * per))) for k, (c, per, top) in REQ.items()}


def requisition(g, code, a):
    nid, why = own_place(g, code, a)
    if why:
        return False, why
    n = g.nodes[nid]
    left = cd_left(g, n, 'req')
    if left > 0:
        return False, f"La place a déjà été réquisitionnée : encore {R.pl(left, 'tour')}."
    gain = req_info(n)
    f = g.factions[code]
    f['res']['vivres'] += gain['vivres']
    f['res']['livres'] += gain['livres']
    rec = int(g.add_recrues(code, gain['recrues']))
    n['stab'] = max(0.05, n['stab'] - REQ_STAB)
    set_cd(g, n, 'req', REQ_CD, code)
    got = [f"{gain['vivres']} vivres"] + ([f"{rec} recrues"] if rec else []) + \
        ([f"{gain['livres']} livres"] if gain['livres'] else [])
    return True, f"Réquisition à {place(g, nid)} : {', '.join(got)}. La population gronde (ordre public −{int(REQ_STAB * 100)} %)."


# ================================================================== 5. traverser, droit de passage
# Terres fermées : celles d'un département qui n'est ni nous, ni un allié (suzerain, vassal, vassal du même suzerain),
# ni en guerre avec nous, et qui ne nous accorde pas le droit de passage. On ne les traverse pas : ni ses places par
# la route, ni ses campagnes (cellules rattachées à ses places, voir geo.node_of_cell). Les places indépendantes et
# les terres d'un ennemi se traversent. Sur les fleuves, les gabares passent librement devant ses quais, sans y
# débarquer. Une armée qui s'y trouve sans l'avoir voulu a quelques jours de grâce pour en sortir.
def has_passage(g, code, o):
    """o laisse-t-il passer les armées de code ?"""
    f = g.factions.get(o)
    return bool(f) and f.get('passage', {}).get(code, -1) > g.t


def closed_to(g, code, o):
    """Les terres de o sont-elles fermées aux armées de code ?"""
    if o == code or o == R.NEUTRAL or o not in g.factions or code not in g.factions:
        return False
    if g.status(code, o) in ('guerre', 'alliance'):
        return False
    ov = g.factions[code]['overlord']
    if ov and ov == g.factions[o]['overlord']:
        return False   # vassaux du même suzerain
    return not has_passage(g, code, o)


def closed_owners(g, code):
    """Départements dont les terres sont fermées à code (à passer à la recherche de chemin)."""
    return frozenset(o for o in g.factions if closed_to(g, code, o))


def cell_mask(g, owners):
    """Pour geo.astar : une marque par propriétaire interdit, indexée par lieu (valeurs de geo.cellnode) ; None si aucun."""
    if not owners:
        return None
    tag = {o: i + 1 for i, o in enumerate(sorted(owners))}
    m = bytearray(256)
    for n in g.nodes:
        t = tag.get(n['owner'])
        if t:
            m[n['id']] = t
    return m


def land_owner(g, x, y):
    """Maître des terres en (x, y) : celui de la place dont relève la cellule (None : eau, hors région)."""
    nd = g.geo.node_of_cell(x, y)
    return None if nd is None else g.nodes[nd]['owner']


def route_level(g, a):
    """Places traversables par la route : 0 en conquérant, 1 en traversant (une retraite garde ses chemins d'avant)."""
    return 1 if a.get('tr') and a['state'] != 'retreat' else 0


def arrive(g, a, nid, ask=True):
    """Arrivée d'une armée sur une place ni à elle ni alliée. None : comme avant (rallier, assiéger, combattre) ;
    False : elle passe son chemin ; True : elle s'arrête devant la place, sans l'attaquer (le joueur choisit, si ask)."""
    n = g.nodes[nid]
    o, code = n['owner'], a['owner']
    war = o != R.NEUTRAL and g.at_war(code, o)
    if o != R.NEUTRAL and not war:
        # voisin en paix (droit de passage, gabare devant ses quais, sortie de ses terres) : on ne fait que passer
        if a['path']:
            return False
        a['state'] = 'idle'
        if a.get('tr') and not a.get('hold'):
            a['hold'] = True
            if code == g.player:
                g.log('armee', f"La {a['name']} fait halte devant {place(g, nid)} (en paix, elle n'y entre pas).",
                      *g.node_xy(nid), who=code)
        return True
    if a['state'] == 'retreat' or not (a.get('tr') or a.get('hold')):
        return None
    if a['path'] and a.get('tr'):
        return None if war else False   # une place ennemie tenue barre la route ; les neutres se traversent
    if n['siege'] and n['siege']['by'] == code:
        return None                     # nos troupes l'investissent déjà : on se joint à elles
    if ask and asks(g, a):
        pose(g, a, nid)                 # sa cible, en conduite « Traverser » : le joueur choisit
        return True
    a['path'] = []
    a['state'] = 'idle'
    if not a.get('hold'):
        a['hold'] = True
        if code == g.player:
            g.log('armee', f"La {a['name']} fait halte devant {place(g, nid)} (négociez, rançonnez, bloquez ou attaquez).",
                  *g.node_xy(nid), who=code)
    return True


# ================================================================== arrivée devant une place : le joueur choisit
# (SPEC-TOURS.md, évolution du 18/10/2026) : l'armée s'arrête, son chemin mis de côté (a['ask']), et une fenêtre
# propose l'assaut (à la main ou automatique), rallier, négocier, assiéger ou bloquer, la contribution, ou d'attendre
def asks(g, a):
    """Cette armée demande-t-elle au joueur ce qu'elle doit faire devant une place ? Les siennes, pas les IA ; et pas
    pendant le tour des IA (le mois ne s'arrête pas pour ça : une fenêtre y bloquerait la partie)."""
    return (a['owner'] == g.player and g.player not in getattr(g, 'ais', {}) and not g.over
            and not (g.tour['on'] and g.tour['end'] is not None))


def pose(g, a, nid):
    a['ask'] = dict(node=nid, path=a['path'], target=a.get('target'))
    a['path'] = []
    a['state'] = 'idle'
    a['hold'] = True
    if not TT.planning(g):
        g.speed_idx = 0   # temps réel : la campagne attend le choix


def ask_alive(g, a):
    """Le choix en attente de cette armée, s'il vaut encore ; sinon il est levé (elle est repartie, en retraite ou au
    combat, la place a changé de mains, la paix est signée). La place passée au joueur : elle reprend sa route."""
    k = a.get('ask')
    if not k:
        return None
    code, o = a['owner'], g.nodes[k['node']]['owner']
    here = a['at_node'] == k['node'] and a['state'] == 'idle' and not a['battle']
    if here and not g.friendly(code, o) and (o == R.NEUTRAL or g.at_war(code, o)):
        return k
    a.pop('ask')
    if here and g.friendly(code, o):
        resume(g, a, k)
    return None


def asking(g):
    """La première armée du joueur qui attend son choix devant une place, ou None (les choix périmés sont levés)."""
    return next(iter([a for a in g.armies.values() if a['owner'] == g.player and ask_alive(g, a)]), None)


def strong(g, a, nid):
    """Assez forte pour qu'une place neutre se rallie sans combat (trois fois sa défense, comme engine.arrive_node)."""
    gn = g.geo.nodes[nid]
    return g.army_power(a, TERRAIN[g.geo.terrain_at(gn['x'], gn['y'])][0]) > 3 * g.node_defense_power(nid)


def ask_choices(g, a):
    """Les choix de la fenêtre d'arrivée : {choix: '' s'il est permis, sinon la raison}. L'assaut (sur ordres ou
    automatique) et l'attente le sont toujours ; les autres selon la place, comme dans le panneau de l'armée."""
    nid = a['ask']['node']
    n = g.nodes[nid]
    neutral = n['owner'] == R.NEUTRAL
    x = options(g, a, nid) or {}
    out = dict(ordres='', auto='')
    if neutral:
        out['rallier'] = '' if strong(g, a, nid) else "Armée trop faible : il faut trois fois la défense de la place"
    if 'neg' in x:
        out['negocier'] = x['neg']['why']
    if walled(n) and (not neutral or n['fort'] >= 2):
        out['assieger'] = ''
    if 'blq' in x:
        out['bloquer'] = x['blq']['why']
    if 'ctb' in x:
        out['contribution'] = x['ctb']['why']
    out['attendre'] = ''
    return out


def resume(g, a, k):
    """Après un choix sans combat : l'armée reprend sa route avec la marche qui lui reste (turns.settle la fait partir)."""
    if k['path'] and a['id'] in g.armies and a['state'] == 'idle':
        a['path'], a['target'], a['state'], a['hold'] = k['path'], k['target'], 'move', False


def choose(g, code, a, what):
    """Le choix du joueur devant la place (fenêtre d'arrivée)."""
    k = ask_alive(g, a) if a and a['owner'] == code else None
    if not k:
        return False, "Cette armée n'attend pas d'ordre devant une place."
    why = ask_choices(g, a).get(what)
    if why is None:
        return False, "Choix inconnu."
    if why:
        return False, why
    nid = k['node']
    gn = g.geo.nodes[nid]
    if what == 'attendre':
        a.pop('ask')
        return True, f"La {a['name']} attend devant {place(g, nid)}."
    if what in ('ordres', 'auto'):
        # l'assaut tout de suite, même sur une place à remparts (les canons y ouvrent des brèches) ; le mode est déjà
        # choisi : pas de seconde fenêtre. Une bataille finit la marche du tour
        from .tactics import bridge as TB
        bt = next((b for b in g.battles.values() if b['node'] == nid), None)
        if bt and not (g.friendly(code, bt['sides'][0]['owner']) and g.hostile(code, bt['sides'][1]['owner'])):
            return False, f"Une bataille se livre déjà devant {place(g, nid)}."
        if what == 'ordres' and not bt and g.tactical:
            return False, "Une autre bataille est déjà en cours."
        a.pop('ask')
        a['hold'] = False
        a['assault'] = True
        a['path'], a['target'] = k['path'], k['target']   # (vainqueur, elle repart vers sa cible au tour suivant)
        if TT.planning(g):
            a['mp'] = 0.0
        if bt:   # un assaut se livre déjà devant la place : on le rejoint, comme en marche (engine.arrive_node)
            g.join_battle(a, bt, 0)
            return True, f"La {a['name']} rejoint l'assaut {R.de(gn['name'])}."
        g.start_battle([a], [], gx=gn['x'], gy=gn['y'], node=nid)
        bt = g.battles[a['battle']]
        bt['mode'] = 'attente'
        r = TB.command(g, dict(sub='choose', bid=bt['id'], mode=what))
        return r['ok'], r['msg']
    if what == 'rallier':
        a.pop('ask')
        g.log('capture', f"{gn['name']} se rallie à {g.fname(code)}.", gn['x'], gn['y'], who=code, important=True)
        g.capture(nid, code, peaceful=True)
        resume(g, a, k)
        asking(g)   # (les autres armées devant la place : leur choix tombe, elles reprennent leur route)
        return True, f"{gn['name']} se rallie à vous."
    if what == 'assieger':
        a.pop('ask')
        a['hold'] = False
        g.begin_siege(a, nid)
        return True, f"Le siège {R.de(gn['name'])} commence."
    ok, msg = dict(negocier=negotiate, contribution=contribution, bloquer=blockade)[what](g, code, a)
    if ok:
        a.pop('ask')
        if what == 'contribution':   # (pourparlers et blocus exigent l'armée devant la place)
            resume(g, a, k)
    return ok, msg


def crossed(g, path, target, owners, skip=None):
    """Départements de `owners` dont l'itinéraire traverse les terres : places par la route (une gabare passe devant
    les quais sans y débarquer), campagnes à travers champs, destination. skip : celui dont on sort."""
    if not owners:
        return []
    seen = set()

    def chk(o):
        if o in owners and o != skip:
            seen.add(o)
    for i, leg in enumerate(path):
        if leg['kind'] == 'road':
            if g.geo.edges[leg['e']].get('kind') == 'water':
                nxt = path[i + 1] if i + 1 < len(path) else None
                if nxt and nxt['kind'] == 'road' and g.geo.edges[nxt['e']].get('kind') == 'water':
                    continue   # toujours à bord
            chk(g.nodes[leg['to']]['owner'])
        else:
            pts = leg['pts']
            for p, q in zip(pts, pts[1:]):
                k = max(1, int(math.dist(p, q)))
                for s in range(k):
                    chk(land_owner(g, p[0] + (q[0] - p[0]) * s / k, p[1] + (q[1] - p[1]) * s / k))
            if pts:
                chk(land_owner(g, *pts[-1]))
    if target:
        # la destination elle-même, même chez celui dont on sort
        o = g.nodes[target['node']]['owner'] if target.get('node') is not None else \
            land_owner(g, target['x'], target['y']) if target.get('x') is not None else None
        if o in owners:
            seen.add(o)
    return sorted(seen)


def names_of(g, who):
    return ' et '.join(g.fname(o) for o in who)


def closed_msg(g, who):
    return (f"Aucun chemin sans traverser les terres {R.de(names_of(g, who))} : demandez un droit de passage "
            f"(Diplomatie), ou passez en force (déclaration de guerre).")


def force_question(g, who):
    n = names_of(g, who)
    return (f"Aucun chemin sans traverser les terres {R.de(n)}, qui ne vous {'ont' if len(who) > 1 else 'a'} pas "
            f"accordé le droit de passage.\n\nPasser en force, c'est DÉCLARER LA GUERRE à {n} (ses alliés "
            f"peuvent s'en mêler). Sinon, annulez et demandez un droit de passage dans la fenêtre Diplomatie.\n\n"
            f"Déclarer la guerre à {n} et passer en force ?")


def force_passage(g, code, who):
    """Passage en force : la guerre à chacun, selon les règles ordinaires (trêve, suzerain…). (ok, message)."""
    from . import diplomacy as D
    for o in who:
        why = D.war_refusal(g, code, o)
        if why:
            return False, f"Passage en force impossible : {why}"
    for o in who:
        if not g.at_war(code, o):
            D.declare_war(g, code, o)
            g.log('diplo', f"{g.fname(code)} force le passage sur les terres {R.de(g.fname(o))}.", who=code,
                  important=g.player in (code, o))
    return True, f"Guerre déclarée à {names_of(g, who)} : l'armée passe en force."


# ------------------------------------------------------------------ délai de grâce
GRACE_TOURS = 1         # pour sortir de terres fermées où l'on se retrouve sans l'avoir voulu


def land_tick(g, a, dt):
    """Armée sur des terres qui lui sont fermées (droit échu ou retiré en chemin, place passée en d'autres mains,
    paix signée en territoire ennemi, retraite) : chemin de sortie et délai de grâce, puis incidents."""
    if a.get('boat') or a['state'] not in ('move', 'idle', 'retreat'):
        return   # à bord, le fleuve est libre ; en bataille ou en siège, on ne compte pas
    code = a['owner']
    o = g.nodes[a['at_node']]['owner'] if a['at_node'] is not None else land_owner(g, a['x'], a['y'])
    if o is None or o in (code, R.NEUTRAL) or o not in g.factions:
        a.pop('cl', None)
        return
    if not closed_to(g, code, o):
        a.pop('cl', None)
        if o == g.player and g.status(code, o) == 'paix' and g.t >= a.setdefault('_ntc', {}).get(o, -1):
            a['_ntc'][o] = g.t + NOTICE_CD
            g.log('diplo', f"Des troupes {R.de(g.fname(code))} traversent vos terres (droit de passage).",
                  a['x'], a['y'], who=code)
        return
    if a['state'] == 'move' and a['edge'] and a.get('ex') != o:
        # une route entre deux places ouvertes peut frôler ses campagnes : ce n'est pas y entrer
        e = g.geo.edges[a['edge']['e']]
        if not closed_to(g, code, g.nodes[e['a']]['owner']) and not closed_to(g, code, g.nodes[e['b']]['owner']):
            return
    cl = a.get('cl')
    if not cl or cl['o'] != o:
        # (une IA garde ses cinq jours d'avant)
        cl = a['cl'] = dict(o=o, until=TT.deadline(g, GRACE_TOURS) if code == g.player else g.t + 5.0, rt=0.0)
        if code == g.player:
            g.log('armee', f"La {a['name']} se trouve sur les terres {R.de(g.fname(o))} sans droit de passage : "
                           f"elle a jusqu'au {g.date_str(cl['until'])} pour en sortir.", a['x'], a['y'], who=o, important=True)
    if g.t >= cl['rt'] and not (a['state'] == 'move' and a.get('ex') == o):
        cl['rt'] = round(g.t + 1.0, 2)   # au plus une tentative par jour
        way_out(g, a, o)
    if g.t > cl['until']:
        # au-delà du délai de grâce : les relations se dégradent, et l'on peut lui déclarer la guerre
        fo = g.factions[o]
        fo['rel'][code] = max(-100, fo['rel'][code] - 1.2 * dt)
        a['viol'] = a.get('viol', 0.0) + dt
        trespassed(g, a, o)


def way_out(g, a, o):
    """Itinéraire de sortie : vers la même destination par un détour si l'on marchait, sinon vers les terres
    les plus proches où l'armée a le droit d'être. Une retraite garde son chemin."""
    if a['state'] == 'retreat':
        return True
    code = a['owner']
    mine = code == g.player
    if a['state'] == 'move' and g.reroute(a):
        if mine:
            g.log('armee', f"La {a['name']} change d'itinéraire pour quitter les terres {R.de(g.fname(o))}.",
                  a['x'], a['y'], who=code)
        return True
    if not g.exit_path(a, o):
        return False
    if mine:
        g.log('armee', f"La {a['name']} quitte les terres {R.de(g.fname(o))} par le plus court.", a['x'], a['y'],
              who=code)
    return True


def trespassed(g, a, o):
    """Incident, au plus un par armée et par voisin tous les deux mois."""
    inc = a.setdefault('_inc', {})
    if g.t >= inc.get(o, -1):
        inc[o] = round(g.t + INCIDENT_CD, 2)
        incident(g, a, o)


def incident(g, a, o):
    from . import diplomacy as D
    code = a['owner']
    fo = g.factions[o]
    pen = INCIDENT_REL + min(15, g.army_men(a) / 400)
    fo['rel'][code] = max(-100, fo['rel'][code] - pen)
    if code == g.player:
        g.log('diplo', f"Incident diplomatique : la {a['name']} s'attarde sans droit de passage sur les terres "
                       f"{R.de(g.fname(o))} (relation −{int(pen)}).", a['x'], a['y'], who=o, important=True)
    elif o == g.player:
        g.log('diplo', f"Incident : des troupes {R.de(g.fname(code))} s'attardent sur vos terres sans droit de passage.",
              a['x'], a['y'], who=code, important=True)
    if o == g.player or fo['overlord'] or code in fo['truce']:
        return
    # l'IA peut très mal le prendre
    aggr = R.FACTIONS[o]['personality']['aggr']
    if fo['rel'][code] < -40 and g.faction_power(o) > 0.7 * g.faction_power(code) \
            and g.rng.random() < 0.15 + 0.4 * aggr:
        ok, _ = D.declare_war(g, o, code)
        if ok:
            g.log('diplo', f"{g.fname(o)} ne tolère pas cette violation de ses frontières.", a['x'], a['y'], who=o,
                  important=True)


def may_stay(g, a, o):
    """Une armée à l'arrêt chez un voisin en paix peut y rester si ses terres lui sont ouvertes (droit de passage)."""
    return o in g.factions and not closed_to(g, a['owner'], o)


def grant_passage(g, grantor, grantee, tours=PASSAGE_TOURS):
    until = TT.deadline(g, tours, grantor, grantee)
    g.factions[grantor].setdefault('passage', {})[grantee] = until
    g.log('diplo', f"{g.fname(grantor)} accorde le droit de passage à {g.fname(grantee)} jusqu'au "
                   f"{g.date_str(until)}.", who=grantor, important=g.player in (grantor, grantee))


def revoke_passage(g, grantor, grantee):
    f = g.factions[grantor].setdefault('passage', {})
    if f.get(grantee, -1) <= g.t:
        return False, "Aucun droit de passage à retirer."
    del f[grantee]
    g.factions[grantee]['rel'][grantor] = max(-100, g.factions[grantee]['rel'][grantor] - 5)
    g.log('diplo', f"{g.fname(grantor)} retire le droit de passage à {g.fname(grantee)}.", who=grantor,
          important=g.player in (grantor, grantee))
    return True, "Droit de passage retiré."


def eval_passage(g, ai, frm, amount=0):
    """Une IA accorde-t-elle le passage ? Selon la relation, sa personnalité, la peur d'être envahie
    et contre qui l'armée va marcher."""
    st = g.status(ai, frm)
    if st == 'guerre':
        return False, "Nous sommes en guerre."
    if st == 'alliance':
        return False, "Nos alliés passent déjà librement."
    if has_passage(g, frm, ai):
        return False, "Droit de passage déjà accordé."
    f = g.factions[ai]
    pers = R.FACTIONS[ai]['personality']
    pa, pb = max(1.0, g.faction_power(ai)), max(1.0, g.faction_power(frm))
    score = f['rel'][frm] + amount / 8 + g.mod(frm, 'diplo') + g.mod(frm, 'prestige') \
        + (10 if frm in f['trade'] else 0) + 30 * (pers['trade'] - 0.5) - 30 * (pers['aggr'] - 0.5)
    if pb > 1.5 * pa:
        score -= 15   # on craint de laisser entrer plus fort que soi
    if g.hegemon() == frm:
        score -= 25
    foes = [x for x in g.factions if x not in (ai, frm) and g.factions[x]['alive'] and g.at_war(frm, x)]
    if any(g.at_war(ai, x) for x in foes):
        score += 20   # il va frapper notre ennemi : tant mieux
    if any(g.friendly(ai, x) or f['rel'][x] > 40 for x in foes):
        score -= 30   # il va frapper un ami : non
    if f['rel'][frm] > 20:
        score += 8    # sans ce droit, ses armées ne passent pas du tout : on l'accorde plus volontiers aux amis
    if score >= 10:
        return True, f"{g.fname(ai)} accorde le droit de passage pour un an."
    return False, f"{g.fname(ai)} refuse de laisser passer vos troupes (relation {int(f['rel'][frm])})."


def passage_tick(g):
    """Chaque jour : droits de passage échus ou devenus sans objet (guerre)."""
    for o, f in g.factions.items():
        ps = f.get('passage')
        if not ps:
            continue
        for c in list(ps):
            if ps[c] <= g.t or c not in g.factions or not g.factions[c]['alive'] or g.at_war(o, c):
                if ps[c] <= g.t and g.player in (o, c):
                    g.log('diplo', f"Le droit de passage accordé par {g.fname(o)} à {g.fname(c)} expire.", who=o)
                del ps[c]


# ================================================================== 6. ralliement négocié
def neg_info(g, a, nid):
    n, gn = g.nodes[nid], g.geo.nodes[nid]
    ratio = force_ratio(g, a['owner'], nid)
    k = clamp(1.25 - 0.22 * ratio, 0.35, 1.2)   # une armée imposante fait baisser le prix
    price = int(round((NEG_BASE + NEG_POP * n.get('pop', 0) + NEG_MIL * n['milice']) * k / 5) * 5)
    home = gn['dept']
    risk = 0.12 + (0.25 if ratio < 1 else 0) - (0.08 if ratio > 3 else 0) + (0.1 if n['fort'] >= 2 else 0)
    if home in g.factions and g.factions[home]['alive'] and home != a['owner']:
        risk += 0.12   # elle préférerait se donner à son propre pays
    elif home == a['owner']:
        risk -= 0.06
    return price, round(clamp(risk, 0.05, 0.6), 2)


def negotiate(g, code, a):
    nid, why = foreign_place(g, code, a)
    if why:
        return False, why
    n = g.nodes[nid]
    if n['owner'] != R.NEUTRAL:
        return False, "On ne négocie le ralliement que d'une place indépendante."
    if n['siege']:
        return False, "La place est déjà investie."
    if 'ng' in node_aa(n):
        return False, "Les pourparlers sont déjà engagés."
    left = cd_left(g, n, 'neg')
    if left > 0:
        return False, f"Les notables ne vous recevront pas avant {R.pl(left, 'tour')}."
    price, risk = neg_info(g, a, nid)
    f = g.factions[code]
    if f['res']['livres'] < price:
        return False, f"Il faut {price} livres."
    f['res']['livres'] -= price
    aa(n)['ng'] = dict(by=code, army=a['id'], until=TT.deadline(g, NEG_TOURS), price=price, risk=risk)
    return True, (f"Pourparlers avec les notables {R.de(place(g, nid))} : {price} livres engagées, réponse "
                  f"au prochain tour (risque de refus {int(risk * 100)} %).")


def neg_tick(g, n, x, dt):
    ng = x['ng']
    nid = n['id']
    a = g.armies.get(ng['army'])
    code = ng['by']
    f = g.factions.get(code)
    if not f or not f['alive']:
        del x['ng']
        return
    if not a or a['at_node'] != nid or a['state'] != 'idle' or n['owner'] != R.NEUTRAL or n['siege']:
        del x['ng']
        f['res']['livres'] += ng['price']
        if code == g.player:
            g.log('armee', f"Pourparlers rompus à {place(g, nid)} : vos livres vous sont rendues.", *g.node_xy(nid), who=code)
        return
    if 'until' not in ng:   # (sauvegarde d'avant les tours : jours restants)
        ng['until'] = TT.turn_start_after(g, g.t + ng.pop('left', 0.0))
    if g.t < ng['until'] - 1e-6:
        return
    del x['ng']
    if g.rng.random() < ng['risk']:
        f['res']['livres'] += ng['price']
        set_cd(g, n, 'neg', NEG_CD, code)
        if code == g.player:
            g.log('armee', f"Les notables {R.de(place(g, nid))} refusent vos offres.", *g.node_xy(nid), who=code,
                  important=True)
        return
    g.log('capture', f"{place(g, nid)} se rallie à {g.fname(code)} après négociation ({ng['price']} livres).",
          *g.node_xy(nid), who=code, important=code == g.player)
    g.capture(nid, code, peaceful=True)
    for b in g.armies.values():
        if b['at_node'] == nid and b['owner'] == code:
            b['hold'] = False


# ================================================================== 7. contribution
def ctb_info(g, a, nid):
    n = g.nodes[nid]
    ratio = force_ratio(g, a['owner'], nid)
    kf = clamp(0.3 + 0.3 * ratio, 0.3, 1.3)
    pop = n.get('pop', 0)
    gain = {k: int(round(min(top, (c + pop * per) * kf))) for k, (c, per, top) in CTB.items()}
    return gain, ratio


def contribution(g, code, a):
    nid, why = foreign_place(g, code, a, siege_ok=True)
    if why:
        return False, why
    n = g.nodes[nid]
    o = n['owner']
    if o != R.NEUTRAL and not g.at_war(code, o):
        return False, "On ne rançonne qu'une place indépendante ou ennemie."
    s = n['siege']
    if s and (s['by'] != code or s.get('occupy')):
        return False, "La place est déjà investie." if s['by'] != code else "La place est en train de se rallier."
    left = cd_left(g, n, 'ctb')
    if left > 0:
        return False, f"La place vient d'être rançonnée : encore {R.pl(left, 'tour')}."
    gain, ratio = ctb_info(g, a, nid)
    if ratio < CTB_MIN:
        return False, "Vos troupes ne font pas assez peur pour se faire payer."
    f = g.factions[code]
    f['res']['livres'] += gain['livres']
    f['res']['vivres'] += gain['vivres']
    gn = g.geo.nodes[nid]
    if o in g.factions:
        fo = g.factions[o]
        fo['res']['livres'] -= min(max(0.0, fo['res']['livres']), gain['livres'] * 0.6)   # le reste sort des coffres de la ville
        fo['res']['vivres'] -= min(max(0.0, fo['res']['vivres']), gain['vivres'] * 0.5)
        fo['rel'][code] = max(-100, fo['rel'][code] - CTB_REL_OWNER)
        n['stab'] = max(0.05, n['stab'] - CTB_STAB)
        for c, fc in g.factions.items():
            if c not in (code, o) and fc['alive']:
                fc['rel'][code] = max(-100, fc['rel'][code] - 3)
    else:
        for c, fc in g.factions.items():
            if c != code and fc['alive']:
                fc['rel'][code] = max(-100, fc['rel'][code] - CTB_REL_ALL - (CTB_REL_HOME if gn['dept'] == c else 0))
    set_cd(g, n, 'ctb', CTB_CD, code)
    # puis on laisse la place : siège levé, halte devant ses portes
    for b in g.armies.values():
        if b['at_node'] == nid and b['owner'] == code and b['state'] in ('idle', 'siege'):
            if b['state'] == 'siege':
                g.end_siege_for(b)
            b['hold'] = True
            b['assault'] = False
            b['grace'] = g.t + 1.0
    if n['siege'] and n['siege']['by'] == code:
        n['siege'] = None
    txt = f"{gain['livres']} livres et {gain['vivres']} vivres"
    if o == g.player:
        g.log('siege', f"{g.fname(code)} rançonne {place(g, nid)} : {txt} extorqués.", gn['x'], gn['y'], who=code,
              important=True)
    elif code != g.player and o in g.factions:
        g.log('siege', f"{g.fname(code)} rançonne {place(g, nid)}.", gn['x'], gn['y'], who=code)
    who = "Tous les départements s'en indignent" if o == R.NEUTRAL else f"{g.fname(o)} ne l'oubliera pas"
    return True, f"Contribution exigée {R.de(place(g, nid))} : {txt}. {who}."


# ================================================================== 8. blocus
def defenders(g, n):
    men = n['milice'] + sum(r['n'] for r in n['garrison'])
    men += sum(g.army_men(b) for b in g.armies.values()
               if b['at_node'] == n['id'] and b['state'] == 'idle' and g.friendly(b['owner'], n['owner']))
    return men


def blockade(g, code, a):
    nid, why = foreign_place(g, code, a, siege_ok=True)
    if why:
        return False, why
    n = g.nodes[nid]
    o = n['owner']
    if o != R.NEUTRAL and not g.at_war(code, o):
        return False, "On ne bloque qu'une place indépendante ou ennemie."
    s = n['siege']
    if s and s['by'] != code:
        return False, "La place est déjà investie par un autre camp."
    if s and s.get('blocus'):
        return False, "La place est déjà bloquée."
    if s and s.get('occupy'):
        return False, "La place est en train de se rallier."
    if any(bt['node'] == nid for bt in g.battles.values()):
        return False, "On se bat devant la place."
    if force_ratio(g, code, nid) < BLOC_MIN:
        return False, "Trop peu de troupes pour investir la place."
    gn = g.geo.nodes[nid]
    food = BLOC_FOOD[gn['type']] + (BLOC_DEPOT if n.get('depot') else 0) + 4 * n['fort']
    n['siege'] = dict(by=code, dmg=0.0, since=round(g.t, 2), blocus=True, food=food, m0=round(defenders(g, n)))
    for b in g.armies.values():
        if b['at_node'] == nid and b['owner'] == code and b['state'] in ('idle', 'siege'):
            b['state'] = 'siege'
            b['hold'] = False
            b['assault'] = False
    if o == g.player:
        g.alert_pause()
        g.log('siege', f"Blocus {R.de(gn['name'])} par {g.fname(code)} : plus rien n'entre ni ne sort. "
                       f"Ses réserves dureront environ {R.pl(TT.tours_left(g, g.t + food), 'tour')}.", gn['x'], gn['y'], who=code, important=True)
    elif code != g.player and o in g.factions:
        g.log('siege', f"Blocus {R.de(gn['name'])} par {g.fname(code)}.", gn['x'], gn['y'], who=code)
    return True, (f"Blocus {R.de(gn['name'])} : ni bombardement ni assaut, la place est coupée de tout. Ses réserves "
                  f"tiendront environ {R.pl(TT.tours_left(g, g.t + food), 'tour')}, puis la faim et les désertions la pousseront à se rendre.")


def bombard(g, code, a):
    nid = a['at_node']
    n = g.nodes[nid] if nid is not None else None
    if not n or not n['siege'] or n['siege']['by'] != code or not n['siege'].get('blocus'):
        return False, "Cette armée ne bloque aucune place."
    if not walled(n):
        return False, "La place n'a pas de remparts à battre : donnez l'assaut."
    n['siege'] = dict(by=code, dmg=0.0, since=n['siege']['since'])
    return True, f"Les batteries ouvrent le feu sur {place(g, nid)} : le blocus devient un siège."


def blockade_tick(g, n, bes, dt):
    """Un jour de blocus : les réserves s'épuisent, puis la faim et les désertions minent les défenseurs."""
    s = n['siege']
    nid = n['id']
    gn = g.geo.nodes[nid]
    if any(b['assault'] for b in bes):
        for b in bes:
            b['state'] = 'idle'
            b['assault'] = True
        g.start_battle(bes, [], gx=gn['x'], gy=gn['y'], node=nid)
        return
    el = g.t - s['since']
    famine = el > s['food']
    km, kg, kmor = (0.03, 0.025, 3.0) if famine else (0.004, 0.002, 0.5)
    n['milice'] = max(0.0, n['milice'] * (1 - km * dt))
    for r in n['garrison']:
        r['n'] *= 1 - kg * dt
        r['morale'] = max(5, r['morale'] - kmor * dt)
    n['garrison'] = [r for r in n['garrison'] if r['n'] >= 5]
    if famine:
        for b in g.armies.values():
            if b['at_node'] == nid and b['state'] == 'idle' and g.friendly(b['owner'], n['owner']):
                for r in b['regs']:
                    r['n'] *= 1 - 0.01 * dt
                    r['morale'] = max(5, r['morale'] - 2 * dt)
    s['dmg'] = min(1.0, el / (s['food'] + BLOC_STARVE))
    if s['dmg'] < 1.0 and not (famine and defenders(g, n) < 0.2 * max(1, s.get('m0', 1))):
        return
    # reddition : la garnison obtient les honneurs de la guerre et se retire
    by, o = s['by'], n['owner']
    for b in list(g.armies.values()):
        if b['at_node'] == nid and b['state'] == 'idle' and g.friendly(b['owner'], o):
            for r in b['regs']:
                r['n'] *= 0.75
            g.retreat(b)
    n['siege'] = None
    if g.player in (by, o) or (o in g.factions and g.friendly(g.player, o)):
        g.log('capture', f"{gn['name']}, affamée, ouvre ses portes à {g.fname(by)}.", gn['x'], gn['y'], who=by,
              important=True)
    g.capture(nid, by, peaceful=True)
    for b in bes:
        b['state'] = 'idle'


# ================================================================== commandes
def own_place(g, code, a, siege_ok=False):
    """(place, raison) : l'armée est-elle à l'arrêt dans une de nos places ?"""
    nid = a['at_node']
    if nid is None or a['state'] != 'idle' or a.get('boat') or a['battle']:
        return None, "L'armée doit être à l'arrêt dans une de vos places."
    n = g.nodes[nid]
    if n['owner'] != code:
        return None, "L'armée doit être à l'arrêt dans une de vos places."
    if n['siege'] and not siege_ok:
        return None, "La place est assiégée."
    return nid, None


def foreign_place(g, code, a, siege_ok=False):
    """(place, raison) : l'armée se tient-elle devant une place qui n'est pas à nous (ni alliée) ?"""
    nid = a['at_node']
    states = ('idle', 'siege') if siege_ok else ('idle',)
    if nid is None or a['state'] not in states or a.get('boat') or a['battle']:
        return None, "L'armée doit se tenir devant la place."
    o = g.nodes[nid]['owner']
    if o == code or g.friendly(code, o):
        return None, "Cette place est à vous ou à un allié."
    return nid, None


def conquer(g, code, a):
    """Fin de la halte : rallier ou attaquer la place, comme une armée en conquête."""
    nid, why = foreign_place(g, code, a)
    if why:
        return False, why
    o = g.nodes[nid]['owner']
    if o != R.NEUTRAL and not g.at_war(code, o):
        return False, f"{place(g, nid)} appartient à {g.fname(o)} (en paix). Déclarez la guerre d'abord."
    if ask_alive(g, a):
        return True, f"Devant {place(g, nid)} : à vous de choisir."
    a['hold'] = False
    a['tr'] = False
    g.arrive_node(a, nid)
    if a.get('ask'):
        return True, f"Devant {place(g, nid)} : à vous de choisir."
    if a.pop('took', False):   # tour du joueur : la place s'est ralliée tout de suite, la marche du tour s'arrête là
        a['mp'] = 0.0
        return True, f"{place(g, nid)} se rallie à vous."
    return True, ("Ralliement en cours." if a['state'] == 'siege' and g.nodes[nid]['siege'] and
                  g.nodes[nid]['siege'].get('occupy') else "À l'attaque !")


ACTIONS = dict(fortify=fortify, garde=garde, req=requisition, neg=negotiate, ctb=contribution, blocus=blockade,
               bombard=bombard, conquer=conquer)


def command(g, code, aid, what):
    a = g.armies.get(aid)
    if not a or a['owner'] != code:
        return False, "Armée introuvable."
    if what in ('quarters', 'camp'):
        return quarters(g, code, a, what == 'quarters')
    if what in ('rangs', 'rangs_stop'):
        return rangs(g, code, a, what == 'rangs')
    if what == 'relever':
        return relever(g, code, a)
    fn = ACTIONS.get(what)
    if not fn:
        return False, "Action inconnue."
    return fn(g, code, a)


# ================================================================== vues (état envoyé au navigateur)
def view_node(g, n, d, mine, visible):
    """Ouvrages, travaux et garde d'une place ; blocus. mine : place de notre camp ; visible() : vue d'ici."""
    if n['siege'] and n['siege'].get('blocus') and d.get('sg'):
        d['sg']['bl'] = 1
    x = n.get('aa')
    if not x:
        return
    if x.get('bar') and (mine or visible()):
        d['bar'] = round(x['bar'], 2)
    if not mine:
        return
    if 'bw' in x:
        w = x['bw']
        d['bw'] = [round(1 - w['left'] / max(0.1, w['total']), 2), round(w['left'], 1), w['kind']]
    if 'gd' in x:
        d['gd'] = [g.date_str(x['gd']['until']), x['gd']['add']]


def view_army(g, a, d, own):
    if a.get('qrt'):
        d['qr'] = 1
    if not own:
        return
    if a.get('tr'):
        d['tr'] = 1
    if a.get('hold'):
        d['hold'] = 1
    if a.get('rg') and rangs_ok(g, a)[0]:
        d['rg'] = [TT.tours_left(g, a['rg']['until']), round(sum(r['max'] - r['n'] for r in a['regs']))]
    if ask_alive(g, a):
        d['ask'] = dict(n=a['ask']['node'], c=ask_choices(g, a))   # fenêtre d'arrivée devant une place (ui.js)
    if a.get('dt') and a['path']:
        d['dt'] = [g.fname(o) for o in a['dt']]   # terres fermées contournées
    cl = a.get('cl')
    if cl:
        d['cl'] = [g.fname(cl['o']), TT.tours_left(g, cl['until'])]   # sur des terres fermées : tours de grâce
    nid = a['at_node']
    if nid is None or a['state'] not in ('idle', 'siege') or a.get('boat') or a['battle']:
        return
    d['ax'] = options(g, a, nid)


def options(g, a, nid):
    """Actions possibles là où se tient l'armée, avec leurs coûts et leurs raisons."""
    code = a['owner']
    n = g.nodes[nid]
    res = g.factions[code]['res']
    x = node_aa(n)
    if n['owner'] == code:
        if a['state'] != 'idle':
            return None
        _, why_s = own_place(g, code, a)
        kind, days, bois, cur = fortify_info(g, a, nid)
        w = x.get('bw')
        fwhy = ("Travaux en cours" if w else f"Ouvrage encore solide ({int(cur * 100)} %)" if cur >= BAR_REDO
                else f"Il faut {bois} bois" if res['bois'] < bois else '')
        add, armes = garde_info(n)
        gl = cd_left(g, n, 'garde')
        gwhy = ("Déjà sous les armes" if 'gd' in x else f"Encore {R.pl(gl, 'tour')}" if gl > 0
                else f"Il faut {armes} armes" if res['armes'] < armes else '')
        rl = cd_left(g, n, 'req')
        rq = req_info(n)
        food = sum(R.UNITS[r['type']]['upkeep_v'] * r['n'] / 100 for r in a['regs']) * QRT_FOOD * (1 + g.mod(code, 'upkeep'))
        need, rarmes, tours, ti = rangs_info(g, a)
        ms, rcost = relever_info(g, code, a)
        rg = a.get('rg')
        return dict(own=1,
                    fort=dict(why=fwhy, k=kind, d=days, b=bois, s=round(cur, 2),
                              w=[round(w['left'], 1), round(w['total'], 1)] if w and w['by'] == a['id'] else None),
                    qrt=dict(on=bool(a.get('qrt')), why=why_s or '', food=round(food, 1)),
                    rg=dict(why='' if rg else rangs_why(g, code, a), t=tours, rm=tours - ti, men=int(need), armes=rarmes,
                            w=TT.tours_left(g, rg['until']) if rg else None),
                    rv=dict(why=relever_why(g, code, a), regs=[[m[0], m[1]] for m in ms],
                            cost={k: round(v) for k, v in rcost.items()}) if ms else None,
                    garde=dict(why=gwhy, add=add, armes=armes, t=GARDE_TOURS),
                    req=dict(why=why_s or (f"Encore {R.pl(rl, 'tour')}" if rl > 0 else ''), g=rq,
                             stab=int(REQ_STAB * 100)))
    if g.friendly(code, n['owner']):
        return None
    o = n['owner']
    war = o != R.NEUTRAL and g.at_war(code, o)
    s = n['siege']
    out = dict(own=0, o=o, hold=bool(a.get('hold')))
    if o != R.NEUTRAL and not war:
        return out   # chez un voisin en paix : seulement passer
    if s and s['by'] != code:
        out['busy'] = 1
        return out
    occ = bool(s and s.get('occupy'))
    if o == R.NEUTRAL and not s:
        price, risk = neg_info(g, a, nid)
        ng = x.get('ng')
        nl = cd_left(g, n, 'neg')
        out['neg'] = dict(why=("Pourparlers en cours" if ng else f"Pas reçus avant {R.pl(nl, 'tour')}" if nl > 0
                               else f"Il faut {price} livres" if res['livres'] < price else ''),
                          p=price, r=risk, w=TT.tours_left(g, ng['until']) if ng and 'until' in ng else None)
    if not occ:
        gain, ratio = ctb_info(g, a, nid)
        cl = cd_left(g, n, 'ctb')
        out['ctb'] = dict(why=(f"Encore {R.pl(cl, 'tour')}" if cl > 0 else "Trop peu de troupes pour l'exiger"
                               if ratio < CTB_MIN else ''), g=gain, all=o == R.NEUTRAL)
        bl = bool(s and s.get('blocus'))
        if not bl:
            gn = g.geo.nodes[nid]
            food = BLOC_FOOD[gn['type']] + (BLOC_DEPOT if n.get('depot') else 0) + 4 * n['fort']
            out['blq'] = dict(why='' if ratio >= BLOC_MIN else "Trop peu de troupes pour investir la place",
                              t=TT.tours_left(g, g.t + food + BLOC_STARVE), dp=bool(n.get('depot')))
        else:
            out['bl'] = dict(food=TT.tours_left(g, s['since'] + s['food']), walled=walled(n))
    if a.get('hold') and a['state'] == 'idle':
        out['conq'] = 1
    return out


def view_passage(g, p, code):
    """Droits de passage entre le joueur et ce département : ps (il nous l'accorde), pg (nous le lui accordons) ;
    cl : ses terres nous sont fermées ; cg : les nôtres lui sont fermées."""
    if code == p:
        return {}
    out = {}
    if has_passage(g, p, code):
        out['ps'] = g.date_str(g.factions[code]['passage'][p])
    if has_passage(g, code, p):
        out['pg'] = g.date_str(g.factions[p]['passage'][code])
    if closed_to(g, p, code):
        out['cl'] = 1
    if closed_to(g, code, p):
        out['cg'] = 1
    return out


# ================================================================== IA
def ai_step(ai):
    """Tous les trois jours environ : barricades, garde bourgeoise, quartiers, réquisition, droits de passage."""
    g, code, f = ai.g, ai.code, ai.f
    res = f['res']
    wars = ai.wars()
    works = 0
    for a in list(g.armies.values()):
        if a['owner'] != code:
            continue
        nid = a['at_node']
        if nid is None or a['state'] != 'idle' or a.get('boat') or a['battle']:
            continue
        n = g.nodes[nid]
        if n['owner'] != code:
            continue
        threat = ai.threat_at(nid, 40) if wars else 0.0
        x = node_aa(n)
        if threat > 0:
            a['qrt'] = False
            dfn = g.node_defense_power(nid)
            # une place qui compte, menacée et sans remparts, se barricade (un chantier à la fois)
            typ = g.geo.nodes[nid]['type']
            if not works and 'bw' not in x and x.get('bar', 0) < 0.4 and threat > 0.5 * dfn \
                    and (typ != 'village' or n.get('depot') or threat > dfn) and (n['fort'] <= 0 or threat > 1.5 * dfn):
                _, _, bois, _ = fortify_info(g, a, nid)
                if res['bois'] >= bois + 80 and fortify(g, code, a)[0]:
                    works += 1
            # face à une menace sérieuse, les bourgeois prennent les armes
            if threat > 0.8 * dfn and 'gd' not in x and cd_left(g, n, 'garde') <= 0:
                if res['armes'] >= garde_info(n)[1] + ai.arms_floor()['armes']:
                    garde(g, code, a)
            continue
        # loin de l'ennemi, une armée éprouvée prend ses quartiers ; refaite, elle lève le camp
        men, mx = g.army_men(a), sum(r['max'] for r in a['regs']) or 1
        mor = sum(r['morale'] * r['n'] for r in a['regs']) / max(1.0, men)
        tired = men < 0.85 * mx or mor < 70
        if a.get('qrt'):
            if not tired or res['vivres'] < 120 or f.get('famine'):
                quarters(g, code, a, False)
        elif tired and not n['siege'] and res['vivres'] > 300 and not f.get('famine') and f['income']['vivres'] > -3:
            quarters(g, code, a, True)
        if a.get('morts') and not a.get('rg') and res['livres'] > 800:   # (une réserve pour la solde)
            relever(g, code, a)   # (la commande fait elle-même les contrôles)
        if tired and men < 0.9 * mx and not a.get('rg'):
            rangs(g, code, a, True)
    # disette : on réquisitionne la plus grosse place tranquille où campe une armée
    if f.get('famine') or (res['vivres'] < 100 and f['income']['vivres'] < 0):
        cands = [(g.nodes[a['at_node']].get('pop', 0), a) for a in g.armies.values()
                 if a['owner'] == code and a['state'] == 'idle' and a['at_node'] is not None and not a.get('boat')
                 and g.nodes[a['at_node']]['owner'] == code and not g.nodes[a['at_node']]['siege']
                 and g.nodes[a['at_node']]['stab'] >= 0.65 and cd_left(g, g.nodes[a['at_node']], 'req') <= 0]
        if cands:
            requisition(g, code, max(cands, key=lambda c: c[0])[1])
    ai_passage(ai, wars)


def ai_passage(ai, wars):
    """Demander le passage chez un voisin dont les terres sont fermées quand le contournement est trop long ou
    impossible (vers l'ennemi, ou vers une destination refusée naguère) ; retirer le sien à qui nous déteste."""
    from . import diplomacy as D
    g, code, f = ai.g, ai.code, ai.f
    for o in list(f.get('passage', {})):
        if f['passage'][o] > g.t and f['rel'].get(o, 0) < -25:
            revoke_passage(g, code, o)
    refused = getattr(ai, 'refused', {})
    for nid in [k for k, t in refused.items() if g.t - t > 90]:
        del refused[nid]   # vieux refus : oubliés
    if (not wars and not refused) or f['overlord'] or g.t < ai.cool.get(('aa', 'route'), -1):
        return
    ai.cool[('aa', 'route')] = g.t + 15
    start = ai.rally if getattr(ai, 'rally', None) is not None else g.capital_of(code)
    if start is None or g.nodes[start]['owner'] != code:
        return
    block = closed_owners(g, code)
    if not block:
        return
    goals = [g.capital_of(x) for x in wars[:2]]
    goals = [v for v in goals if g.nodes[v]['owner'] in wars]
    goals += sorted(refused, key=lambda v: -refused[v])[:2]
    for goal in goals:
        if g.nodes[goal]['owner'] in block:
            continue   # la destination elle-même est fermée : ce n'est pas un passage qu'il faut
        free = g.road_route(code, {start: 0.0}, goal, 22.0, False, 1, frozenset())
        if not free:
            continue
        r = g.road_route(code, {start: 0.0}, goal, 22.0, False, 1, block)
        if r and r[0] <= 1.3 * free[0]:
            continue   # le détour est court : pas besoin de demander
        for o in sorted({g.nodes[v]['owner'] for v in free[1]} & block):
            if g.t < ai.cool.get((o, 'passage'), -1):
                continue
            ai.cool[(o, 'passage')] = g.t + 120
            D.act(g, code, o, 'passage')


def ai_siege(ai, a, ratio):
    """Devant une place assiégée : rançonner avant de partir, ou affamer plutôt que d'attendre la brèche.
    True si la décision est prise (l'IA ne fait rien d'autre ce tour-ci)."""
    g, code = ai.g, ai.code
    nid = a['at_node']
    n = g.nodes[nid]
    s = n['siege']
    if not s or s['by'] != code or s.get('occupy'):
        return False
    if s.get('blocus'):
        if ratio < 0.6:
            return False   # secours trop fort : on se replie
        if s['dmg'] >= 0.7 and ratio > 2.5:
            g.assault(code, a['id'])
        return True
    dur = g.t - s.get('since', g.t)
    if (0.5 <= ratio < 0.6 or (ai.f['res']['livres'] < 300 and dur > 20 and ratio < 1.3)) \
            and cd_left(g, n, 'ctb') <= 0:
        if contribution(g, code, a)[0]:
            return True
    besiegers = [b for b in g.armies.values() if b['at_node'] == nid and b['owner'] == code and b['state'] == 'siege']
    if dur > 2 and n['fort'] >= 2 and 0.9 <= ratio < 3 \
            and not any(r['type'] == 'artillerie' for b in besiegers for r in b['regs']):
        if blockade(g, code, a)[0]:
            return True
    return False
