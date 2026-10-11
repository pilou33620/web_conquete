"""Actions d'une armée dans une place : fortification de fortune, quartiers, garde bourgeoise, réquisition ;
devant une place étrangère : traversée et droit de passage, ralliement négocié, contribution, blocus.

L'état propre à une place est rangé dans n['aa'] (travaux, solidité des barricades, garde, négociation, délais) ;
celui d'une armée dans a['tr'] (traverser), a['hold'] (halte devant une place), a['qrt'] (quartiers) ;
les droits de passage dans faction['passage'] = {bénéficiaire: échéance}.
"""
import math

from . import rules as R
from .geo import TERRAIN

# ------------------------------------------------------------------ fortification de fortune
BAR_WORK = dict(village=4000, fort=5000, ville=6000, capitale=9000)   # journées d'homme
BAR_BOIS = dict(village=40, fort=50, ville=60, capitale=90)
BAR_SAPEUR = 5          # un sapeur abat l'ouvrage de six fantassins
BAR_DAYS = (2.0, 20.0)  # durée des travaux, au plus court et au plus long
BAR_LEVEL = 0.8         # une place sans remparts barricadée vaut presque un mur d'enceinte (niveau 1)
RED_LEVEL = 0.3         # redoutes devant des remparts : petit bonus
RED_WORK = 0.6          # les redoutes demandent moins de travail
BAR_WEAR = 1 / 90       # usure par jour : environ trois mois
BAR_WET = 1.5           # pluie, orage, neige, tempête
BAR_WINTER = 1.3
BAR_SIEGE = 1.6         # la brèche s'ouvre plus vite que dans des remparts
BAR_GUN = 0.012         # usure par jour et par batterie ennemie qui tire dessus
BAR_REDO = 0.7          # on peut relever un ouvrage usé sous ce seuil
BAR_MIN = 0.25          # en dessous, l'ouvrage n'arrête plus personne (plus de siège)

# ------------------------------------------------------------------ quartiers
QRT_REPL = 0.03         # renforts en plus par jour (part de l'effectif)
QRT_FOOD = 0.6          # vivres consommés en plus (part de l'entretien)
QRT_STAB = 0.12         # ordre public visé en plus dans la place

# ------------------------------------------------------------------ garde bourgeoise
GARDE_DAYS = 60
GARDE_CD = 180          # délai entre deux levées dans la même place
GARDE_MM = 0.6          # milice en plus : part de la milice ordinaire…
GARDE_POP = 0.012       # … et des habitants
GARDE_MAX = 900
GARDE_ARMES = 0.15      # armes par homme armé
GARDE_PROD = 0.9        # production pendant que les bourgeois montent la garde

# ------------------------------------------------------------------ réquisition
REQ_CD = 120
REQ_STAB = 0.25
REQ = dict(vivres=(30, 0.012, 900), recrues=(10, 0.003, 300), livres=(0, 0.004, 400))   # (fixe, par habitant, plafond)

# ------------------------------------------------------------------ ralliement négocié
NEG_DAYS = dict(village=2, fort=4, ville=3, capitale=5)
NEG_BASE, NEG_POP, NEG_MIL = 40, 0.02, 1.0
NEG_CD = 30             # après un refus, les notables ne reçoivent plus pendant un mois

# ------------------------------------------------------------------ contribution
CTB_CD = 90
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
PASSAGE_DAYS = 365
INCIDENT_CD = 60        # un incident par armée et par département, au plus tous les deux mois
INCIDENT_REL = 10
INCIDENT_DAYS = 1.0     # présence continue sur ses terres (hors de ses places) qui vaut incident
NOTICE_CD = 60


def clamp(v, a, b):
    return max(a, min(b, v))


def node_aa(n):
    return n.get('aa') or {}


def aa(n):
    return n.setdefault('aa', {})


def cd_left(g, n, k):
    return max(0.0, node_aa(n).get('cd', {}).get(k, -1) - g.t)


def set_cd(g, n, k, days):
    aa(n).setdefault('cd', {})[k] = round(g.t + days, 2)


def place(g, nid):
    return g.geo.nodes[nid]['name']


def migrate(g):
    """Anciennes sauvegardes : ni travaux, ni droits de passage, ni quartiers."""
    for f in g.factions.values():
        f.setdefault('passage', {})
    for a in g.armies.values():
        for k in ('tr', 'hold', 'qrt'):
            a.setdefault(k, False)


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


def fort_eff(g, n):
    return (n['fort'] + works_level(n)) * (1 - breach(n))


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
def tick(g, dt):
    g._aa_dt = getattr(g, '_aa_dt', 0.0) + dt
    if g._aa_dt < 0.25:
        return
    dt, g._aa_dt = g._aa_dt, 0.0
    quarters_tick(g, dt)
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
    return True, f"La troupe élève des {works_name(n, kind)} à {place(g, nid)} ({days:.0f} j, {bois} bois)."


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
                       f"le temps qu'elles durent (environ trois mois).", *g.node_xy(nid), who=w['code'], important=True)


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
        return False, f"Les habitants ont rendu leurs armes il y a peu : encore {math.ceil(left)} jours."
    add, armes = garde_info(n)
    f = g.factions[code]
    if f['res']['armes'] < armes:
        return False, f"Il faut {armes} armes."
    f['res']['armes'] -= armes
    aa(n)['gd'] = dict(until=round(g.t + GARDE_DAYS, 2), add=add)
    n['milice_max'] += add
    n['milice'] += add
    set_cd(g, n, 'garde', GARDE_CD)
    g._dirty_income = True
    gname = g.unit_name(code, 'garde')[0].lower()
    return True, (f"{R.nb(add)} habitants de {place(g, nid)} prennent les armes ({gname}) pour {GARDE_DAYS} jours "
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
        return False, f"La place a déjà été réquisitionnée : encore {math.ceil(left)} jours."
    gain = req_info(n)
    f = g.factions[code]
    f['res']['vivres'] += gain['vivres']
    f['res']['livres'] += gain['livres']
    rec = int(g.add_recrues(code, gain['recrues']))
    n['stab'] = max(0.05, n['stab'] - REQ_STAB)
    set_cd(g, n, 'req', REQ_CD)
    got = [f"{gain['vivres']} vivres"] + ([f"{rec} recrues"] if rec else []) + \
        ([f"{gain['livres']} livres"] if gain['livres'] else [])
    return True, f"Réquisition à {place(g, nid)} : {', '.join(got)}. La population gronde (ordre public −{int(REQ_STAB * 100)} %)."


# ================================================================== 5. traverser, droit de passage
def has_passage(g, code, o):
    """o laisse-t-il passer les armées de code ?"""
    f = g.factions.get(o)
    return bool(f) and f.get('passage', {}).get(code, -1) > g.t


def route_level(g, a):
    """Places traversables par la route : 0 en conquérant (comme avant), 1 en traversant avec droit de passage,
    2 en traversant quitte à provoquer un incident (le joueur, prévenu, le confirme)."""
    if not a.get('tr') or a['state'] == 'retreat':
        return 0   # une retraite garde ses chemins d'avant
    return 2 if a['owner'] == g.player else 1


def arrive(g, a, nid):
    """Arrivée d'une armée sur une place ni à elle ni alliée. None : comme avant (rallier, assiéger, combattre) ;
    False : elle passe son chemin ; True : elle fait halte devant la place, sans l'attaquer."""
    if a['state'] == 'retreat' or not (a.get('tr') or a.get('hold')):
        return None
    n = g.nodes[nid]
    o, code = n['owner'], a['owner']
    war = o != R.NEUTRAL and g.at_war(code, o)
    if o in g.factions and not war and not has_passage(g, code, o):
        trespassed(g, a, o)             # entrer dans une de ses places sans y être invité
    if a['path'] and a.get('tr'):
        return None if war else False   # une place ennemie tenue barre la route ; neutres et voisins en paix se traversent
    if n['siege'] and n['siege']['by'] == code:
        return None                     # nos troupes l'investissent déjà : on se joint à elles
    a['path'] = []
    a['state'] = 'idle'
    if not a.get('hold'):
        a['hold'] = True
        if code == g.player:
            what = ("négociez, rançonnez, bloquez ou attaquez" if o == R.NEUTRAL or war else "en paix, elle n'y entre pas")
            g.log('armee', f"La {a['name']} fait halte devant {place(g, nid)} ({what}).", *g.node_xy(nid), who=code)
    return True


def trespass(g, code, path, target):
    """Départements en paix dont l'itinéraire traverse les terres sans droit de passage."""
    seen = set()

    def chk(nid):
        if nid is None:
            return
        o = g.nodes[nid]['owner']
        if o in g.factions and o != code and g.status(code, o) == 'paix' and not has_passage(g, code, o):
            seen.add(o)
    for leg in path:
        if leg['kind'] == 'road':
            chk(leg['to'])
        else:
            pts = leg['pts']
            for p in pts[::3] + pts[-1:]:
                chk(g.geo.node_of_cell(p[0], p[1]))
    if target and target.get('node') is not None:
        chk(target['node'])
    return sorted(seen)


def trespass_warning(g, code, a):
    who = trespass(g, code, a['path'], a['target'])
    if not who:
        return None
    names = ' et '.join(g.fname(o) for o in who)
    return (f"Cet itinéraire traverse les terres de {names} sans droit de passage : ce sera un incident diplomatique "
            f"(les relations se dégradent, et l'on peut vous déclarer la guerre). Passer quand même ?")


def on_peace_land(g, a, o):
    """Armée sur les terres d'un voisin en paix. True si elle y a droit de passage (rien à redire) ;
    sinon incident diplomatique (au plus un par armée et par voisin tous les deux mois)."""
    code = a['owner']
    if has_passage(g, code, o):
        if o == g.player and g.t >= a.setdefault('_ntc', {}).get(o, -1):
            a['_ntc'][o] = g.t + NOTICE_CD
            g.log('diplo', f"Des troupes {R.de(g.fname(code))} traversent vos terres (droit de passage).",
                  a['x'], a['y'], who=code)
        return True
    # une route qui frôle ses terres n'est pas une invasion : il faut y rester un jour entier
    vo, vt, acc = a.get('_vt') or (None, -9.0, 0.0)
    acc = acc + (g.t - vt) if vo == o and g.t - vt < 0.3 else 0.0
    a['_vt'] = [o, g.t, acc]
    if acc >= INCIDENT_DAYS:
        a['_vt'] = [o, g.t, 0.0]
        trespassed(g, a, o)
    return False


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
        g.log('diplo', f"Incident diplomatique : la {a['name']} entre sans droit de passage sur les terres "
                       f"{R.de(g.fname(o))} (relation −{int(pen)}).", a['x'], a['y'], who=o, important=True)
    elif o == g.player:
        g.log('diplo', f"Incident : des troupes {R.de(g.fname(code))} franchissent vos frontières sans droit de passage.",
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
    """Une armée à l'arrêt chez un voisin en paix peut y rester si elle a le droit de passage."""
    return o in g.factions and has_passage(g, a['owner'], o)


def grant_passage(g, grantor, grantee, days=PASSAGE_DAYS):
    g.factions[grantor].setdefault('passage', {})[grantee] = round(g.t + days, 2)
    g.log('diplo', f"{g.fname(grantor)} accorde le droit de passage à {g.fname(grantee)} jusqu'au "
                   f"{g.date_str(g.t + days)}.", who=grantor, important=g.player in (grantor, grantee))


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
    return price, NEG_DAYS[gn['type']], round(clamp(risk, 0.05, 0.6), 2)


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
        return False, f"Les notables ne vous recevront pas avant {math.ceil(left)} jours."
    price, days, risk = neg_info(g, a, nid)
    f = g.factions[code]
    if f['res']['livres'] < price:
        return False, f"Il faut {price} livres."
    f['res']['livres'] -= price
    aa(n)['ng'] = dict(by=code, army=a['id'], left=days, total=days, price=price, risk=risk)
    return True, (f"Pourparlers avec les notables {R.de(place(g, nid))} : {price} livres engagées, réponse dans "
                  f"{days} jours (risque de refus {int(risk * 100)} %).")


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
    ng['left'] -= dt
    if ng['left'] > 0:
        return
    del x['ng']
    if g.rng.random() < ng['risk']:
        f['res']['livres'] += ng['price']
        set_cd(g, n, 'neg', NEG_CD)
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
        return False, f"La place vient d'être rançonnée : encore {math.ceil(left)} jours."
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
    set_cd(g, n, 'ctb', CTB_CD)
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
                       f"Ses réserves dureront environ {food} jours.", gn['x'], gn['y'], who=code, important=True)
    elif code != g.player and o in g.factions:
        g.log('siege', f"Blocus {R.de(gn['name'])} par {g.fname(code)}.", gn['x'], gn['y'], who=code)
    return True, (f"Blocus {R.de(gn['name'])} : ni bombardement ni assaut, la place est coupée de tout. Ses réserves "
                  f"tiendront environ {food} jours, puis la faim et les désertions la pousseront à se rendre.")


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
    a['hold'] = False
    a['tr'] = False
    g.arrive_node(a, nid)
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
        gwhy = ("Déjà sous les armes" if 'gd' in x else f"Encore {math.ceil(gl)} j" if gl > 0
                else f"Il faut {armes} armes" if res['armes'] < armes else '')
        rl = cd_left(g, n, 'req')
        rq = req_info(n)
        food = sum(R.UNITS[r['type']]['upkeep_v'] * r['n'] / 100 for r in a['regs']) * QRT_FOOD * (1 + g.mod(code, 'upkeep'))
        return dict(own=1,
                    fort=dict(why=fwhy, k=kind, d=days, b=bois, s=round(cur, 2),
                              w=[round(w['left'], 1), round(w['total'], 1)] if w and w['by'] == a['id'] else None),
                    qrt=dict(on=bool(a.get('qrt')), why=why_s or '', food=round(food, 1)),
                    garde=dict(why=gwhy, add=add, armes=armes, days=GARDE_DAYS),
                    req=dict(why=why_s or (f"Encore {math.ceil(rl)} j" if rl > 0 else ''), g=rq,
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
        price, days, risk = neg_info(g, a, nid)
        ng = x.get('ng')
        nl = cd_left(g, n, 'neg')
        out['neg'] = dict(why=("Pourparlers en cours" if ng else f"Pas reçus avant {math.ceil(nl)} j" if nl > 0
                               else f"Il faut {price} livres" if res['livres'] < price else ''),
                          p=price, d=days, r=risk, w=[round(ng['left'], 1), ng['total']] if ng else None)
    if not occ:
        gain, ratio = ctb_info(g, a, nid)
        cl = cd_left(g, n, 'ctb')
        out['ctb'] = dict(why=(f"Encore {math.ceil(cl)} j" if cl > 0 else "Trop peu de troupes pour l'exiger"
                               if ratio < CTB_MIN else ''), g=gain, all=o == R.NEUTRAL)
        bl = bool(s and s.get('blocus'))
        if not bl:
            gn = g.geo.nodes[nid]
            food = BLOC_FOOD[gn['type']] + (BLOC_DEPOT if n.get('depot') else 0) + 4 * n['fort']
            out['blq'] = dict(why='' if ratio >= BLOC_MIN else "Trop peu de troupes pour investir la place",
                              d=food + BLOC_STARVE, dp=bool(n.get('depot')))
        else:
            out['bl'] = dict(food=max(0, int(s['food'] - (g.t - s['since']))), walled=walled(n))
    if a.get('hold') and a['state'] == 'idle':
        out['conq'] = 1
    return out


def view_passage(g, p, code):
    """Droits de passage entre le joueur et ce département : ps (il nous l'accorde), pg (nous le lui accordons)."""
    if code == p:
        return {}
    out = {}
    if has_passage(g, p, code):
        out['ps'] = g.date_str(g.factions[code]['passage'][p])
    if has_passage(g, code, p):
        out['pg'] = g.date_str(g.factions[p]['passage'][code])
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
    """Demander le passage chez un voisin en paix qui sépare de l'ennemi ; retirer le sien à qui nous déteste."""
    from . import diplomacy as D
    g, code, f = ai.g, ai.code, ai.f
    for o in list(f.get('passage', {})):
        if f['passage'][o] > g.t and f['rel'].get(o, 0) < -25:
            revoke_passage(g, code, o)
    if not wars or f['overlord'] or g.t < ai.cool.get(('aa', 'route'), -1):
        return
    ai.cool[('aa', 'route')] = g.t + 15
    start = ai.rally if getattr(ai, 'rally', None) is not None else g.capital_of(code)
    if start is None or g.nodes[start]['owner'] != code:
        return
    for x in wars[:2]:
        goal = g.capital_of(x)
        if g.nodes[goal]['owner'] != x:
            continue
        r2 = g.road_route(code, {start: 0.0}, goal, 22.0, False, tr=2)
        if not r2:
            continue
        r0 = g.road_route(code, {start: 0.0}, goal, 22.0, False)
        if r0 and r0[0] <= 1.3 * r2[0]:
            continue   # le détour par chez nous est court : pas besoin de demander
        for o in sorted({g.nodes[v]['owner'] for v in r2[1]}):
            if o not in g.factions or o in (code, x) or g.status(code, o) != 'paix' or has_passage(g, code, o):
                continue
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
