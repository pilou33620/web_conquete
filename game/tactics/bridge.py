"""Raccord entre la campagne et les batailles tactiques.

- choix du mode d'une bataille du joueur (attente / ordres / auto) et réglage `settings['battles']` ;
- création d'une TacticalBattle depuis une bataille de campagne (`bt`), boucle tactique (tick), report du résultat
  sur les régiments puis `engine.end_battle` ;
- anciennes sauvegardes : une bataille commandée en cours s'achève en accéléré (« Finir automatiquement », budget de
  calcul ACCEL_BUDGET par appel de tick) ; pas encore engagée, elle redemande son mode ;
- munitions (`ammo`, 0–100 %) et fatigue (`fat`, 0–100) persistantes des régiments en campagne ;
- « Donner mes ordres » (orders.py) : la bataille créée sans commandement, le joueur choisit ses ordres sur le champ
  de bataille (ses troupes s'y redéploient à chaque choix), puis ses officiers la livrent sous ses yeux, vue de dessus,
  à l'allure REPLAY_RATE (une trentaine de secondes), en s'arrêtant au moment décisif s'il l'a demandé ;
- sauvegarde, chargement et migration ; vues pour /api/state, /api/tactic et /api/tactic_map ; commandes `tac`.

Les crochets dans engine.py, views.py et server.py ne font qu'appeler ces fonctions.
"""
import math
import traceback
import zlib

from .. import rules as R
from .. import army_actions as AA
from .. import turns as TT
from . import units as U
from . import ai as AI
from . import orders as OR
from . import stats as ST
from . import terrain as TR
from .battle import TacticalBattle, valid_piet, ACCEL_FX, ACCEL_LEVEL
from .terrain import COLS, ROWS, CELL

SETTINGS = ('demander', 'auto', 'auto_petites')
SMALL_MEN = 600            # escarmouche : moins de 600 hommes en tout…
MILICE_COMPANY = 400       # la milice d'une place se bat par compagnies de 400 hommes au plus

# munitions consommées par jour de bataille automatique (% de la dotation), selon la phase et l'arme
AUTO_AMMO = {'canonnade': dict(artillerie=80, inf=10, cavalerie=0),
             'fusillade': dict(artillerie=50, inf=70, cavalerie=15),
             'charge': dict(artillerie=30, inf=40, cavalerie=25)}
AUTO_FAT = 40              # fatigue par jour de bataille automatique
# « Finir automatiquement » : une bataille accélérée avance par pas DT ordinaires tant que dure ce budget de calcul, à
# chaque appel de tick (toutes les 0,1 s, sous le verrou du serveur : les requêtes attendent au plus autant)
ACCEL_BUDGET = 0.045
# « Donner mes ordres » : secondes de bataille par seconde réelle (une escarmouche de 2 h défile en 18 s, une bataille
# de 6 h en 40 s) ; au-delà de REPLAY_LONG secondes à l'écran, deux fois plus vite (quatre au-delà de REPLAY_LONGER), ou
# à la vitesse choisie (×2, ×4)
REPLAY_RATE, REPLAY_LONG, REPLAY_LONGER = 400.0, 25.0, 40.0
# le bandeau du film raconte les grands gestes, pas l'intendance
DULL = ("s'abrite", 'ne voit rien', "change d'emplacement", 'recomplète', 'relève', 'premier contact')


# ================================================================== état de la partie
def ensure(g):
    """Champs propres aux batailles tactiques (nouvelle partie ou ancienne sauvegarde)."""
    if not hasattr(g, 'tactical') or g.tactical is None:
        g.tactical = {}
    if not hasattr(g, 'tac_done'):
        g.tac_done = {}
    if not hasattr(g, 'tac_preview'):
        g.tac_preview = {}   # (la bataille préparée pour le plan de la fenêtre de bataille : jamais enregistrée)
    st = getattr(g, 'settings', None)
    if not isinstance(st, dict):
        g.settings = st = {}
    if st.get('battles') not in SETTINGS:
        st['battles'] = 'demander'


def waiting(g):
    return any(bt.get('mode') == 'attente' for bt in g.battles.values())


def frozen(g):
    """La campagne est figée : bataille tactique en cours, ou bataille en attente du choix du joueur."""
    return bool(getattr(g, 'tactical', None)) or waiting(g)


def involves_player(g, bt):
    p = g.player
    for s in bt['sides']:
        if s['owner'] == p:
            return True
        if any(g.armies.get(aid, {}).get('owner') == p for aid in s['armies']):
            return True
    return False


def small_battle(g, bt):
    men = sum(s['men0'] for s in bt['sides'])
    if men < SMALL_MEN:
        return True
    d = bt['sides'][1]
    if d['node'] is not None and not d['armies'] and g.geo.nodes[d['node']]['type'] == 'village' \
            and not g.nodes[d['node']]['garrison']:
        return True   # contre la seule milice d'un village
    return False


def on_battle_start(g, bt):
    """Appelé par engine.start_battle : la bataille du joueur attend son choix, les autres se jouent seules."""
    ensure(g)
    mode = 'auto'
    if involves_player(g, bt) and g.player not in getattr(g, 'ais', {}) and not g.over:
        st = g.settings['battles']
        if st == 'demander' or (st == 'auto_petites' and not small_battle(g, bt)):
            mode = 'attente'
    bt['mode'] = mode
    if mode == 'attente':
        g.speed_idx = 0


def is_auto(bt):
    return bt.get('mode', 'auto') == 'auto'


# ================================================================== munitions et fatigue en campagne
def reg_k(r, cls=None):
    """Effet modéré de la fatigue et des munitions sur la puissance d'un régiment (bataille automatique)."""
    k = 1 - 0.15 * r.get('fat', 0.0) / 100
    cls = cls or R.UNITS.get(r['type'], {}).get('cls', 'inf')
    if cls in ('inf', 'artillerie'):
        k *= 0.75 + 0.25 * r.get('ammo', 100.0) / 100
    return k


def march_k(a):
    """La fatigue ralentit la marche (au plus −25 %)."""
    regs = a['regs']
    if not regs:
        return 1.0
    men = sum(r['n'] for r in regs) or 1.0
    fat = sum(r.get('fat', 0.0) * r['n'] for r in regs) / men
    return 1 - 0.25 * fat / 100


def army_tick(g, a, dt, hot):
    """Munitions et fatigue d'une armée sur dt jours (pas de la campagne, ou jours de marche du tour du joueur)."""
    if a['state'] == 'battle':
        return
    code = a['owner']
    st = a['state']
    if st in ('move', 'retreat') and not g.paused(a):
        off = a.get('mode') == 'champs' or not a.get('onroad')
        d = 12 if st == 'retreat' else (10 if off else 4)
        if hot.get(g.zone_of(a['x'], a['y'])):
            d *= 1.5
    elif a.get('qrt'):
        d = -25
    else:
        d = -15
    nd = g.geo.node_of_cell(a['x'], a['y'])
    home = nd is not None and g.friendly(code, g.nodes[nd]['owner'])
    if home or a.get('depot') is not None or a.get('boat'):
        refill = 10
    elif a.get('supply', 1.0) >= 0.35:
        refill = 3
    else:
        refill = 0   # en territoire ennemi, coupé du ravitaillement
    for r in a['regs']:
        r['fat'] = min(100.0, max(0.0, r.get('fat', 0.0) + d * dt))
        if refill:
            r['ammo'] = min(100.0, r.get('ammo', 100.0) + refill * dt)


def campaign_tick(g, dt):
    """Recomplètement des munitions et fatigue des régiments, par pas de campagne (dt en jours)."""
    hot = {z: w['kind'] == 'canicule' for z, w in g.weather.items()}
    for a in g.armies.values():
        army_tick(g, a, dt, hot)
    for n in g.nodes:
        if n['garrison'] and not n['siege']:
            for r in n['garrison']:
                if r.get('ammo', 100.0) < 100 or r.get('fat', 0.0) > 0:
                    r['ammo'] = min(100.0, r.get('ammo', 100.0) + 10 * dt)
                    r['fat'] = max(0.0, r.get('fat', 0.0) - 20 * dt)


def auto_battle_tick(g, bt, dt):
    """Une bataille automatique use aussi les munitions et fatigue les hommes."""
    rates = AUTO_AMMO.get(bt.get('phase', 'fusillade'), AUTO_AMMO['fusillade'])
    for si in (0, 1):
        regs = [r for _, r, _ in g.side_units(bt, si)]
        nd = bt['sides'][si]['node']
        if nd is not None:
            regs += g.nodes[nd]['garrison']
        for r in regs:
            cls = R.UNITS.get(r['type'], {}).get('cls', 'inf')
            r['ammo'] = max(0.0, r.get('ammo', 100.0) - rates.get(cls, 0) * dt)
            r['fat'] = min(100.0, r.get('fat', 0.0) + AUTO_FAT * dt)


# ================================================================== création d'une bataille tactique
def _att_angle(g, bt):
    """Direction (vue du centre de la bataille) d'où vient l'assaillant."""
    att = [g.armies[aid] for aid in bt['sides'][0]['armies'] if aid in g.armies]
    for a in att:
        dx, dy = a['x'] - bt['x'], a['y'] - bt['y']
        if dx * dx + dy * dy > 0.04:
            return math.atan2(dy, dx)
    if att:
        cap = g.capital_of(att[0]['owner']) if att[0]['owner'] in g.factions else None
        if cap is not None:
            cx, cy = g.node_xy(cap)
            if (cx - bt['x']) ** 2 + (cy - bt['y']) ** 2 > 0.01:
                return math.atan2(cy - bt['y'], cx - bt['x'])
    return (zlib.crc32(bt['id'].encode()) % 628) / 100.0


def make_spec(g, bt):
    zone = g.zone_of(bt['x'], bt['y'])
    owners = [s['owner'] for s in bt['sides']]
    me = None
    for si, s in enumerate(bt['sides']):
        if s['owner'] == g.player or any(g.armies.get(aid, {}).get('owner') == g.player for aid in s['armies']):
            me = si
    place = None
    if bt['node'] is not None:
        n = g.nodes[bt['node']]
        gn = g.geo.nodes[bt['node']]
        att = bt['sides'][0]['owner']   # (la dynamite de l'assaillant : une brèche de plus, tactics/terrain.py)
        place = dict(nid=bt['node'], name=gn['name'], type=gn['type'], fort=n['fort'], dmg=AA.breach(n),
                     dyn=int(g.mod(att, 'breach')) if att in g.factions else 0,
                     bar=(n.get('aa') or {}).get('bar', 0.0), pop=int(n.get('pop', gn['pop0'])), x=gn['x'], y=gn['y'],
                     battle=True, d=n.get('dev', 0), deg=round(n.get('deg', 0.0), 3))
    lieu = None   # (bataille rangée tout près d'un lieu : son état, pour dessiner la ville de son plan, terrain_ville)
    if place is None:
        d, nid = min((math.hypot(gn['x'] - bt['x'], gn['y'] - bt['y']), gn['id']) for gn in g.geo.nodes)
        if d < 1.3:
            n = g.nodes[nid]
            lieu = dict(nid=nid, f=n['fort'], pop=int(n.get('pop', g.geo.nodes[nid]['pop0'])), d=n.get('dev', 0))
    techs = [g.factions[o]['techs'] if o in g.factions else [] for o in owners]
    gname = g.place_name(bt['x'], bt['y'])
    kind = 'Embuscade' if bt['ambush'] else ('Assaut' if bt['node'] is not None else 'Bataille')
    return dict(bid=bt['id'], seed=(zlib.crc32(bt['id'].encode()) ^ (g.seed * 2654435761)) & 0x7FFFFFFF,
                cx=bt['x'], cy=bt['y'], season=g.season(), weather=g.weather[zone]['kind'], year=g.date().year,
                place=place, att_angle=_att_angle(g, bt), owners=owners, names=[g.fname(o) for o in owners],
                colors=[R.FACTIONS[o]['color'] if o in R.FACTIONS else R.NEUTRAL_COLOR for o in owners],
                me=me, difficulty=g.difficulty, title=f"{kind} {gname}", place_name=gname, date=g.date_str(),
                fm_swift=[min(0.5, g.mod(o, 'fm_swift')) if o in g.factions else 0.0 for o in owners],
                art_cheval=['art_cheval' in t for t in techs], marks=[R.marks(t) for t in techs],
                # technologies de combat (feu de rang, ordre mixte, cuirassiers… : stats.TECH_MODS), appliquées par battle.py
                tech=[{k: g.mod(o, k) for k in ST.TECH_MODS if g.mod(o, k)} if o in g.factions else {} for o in owners],
                # SPEC-TECH.md : ballon (portée de vue du général), retranchements, obus à la mélinite
                balloon=[g.mod(o, 'balloon') if o in g.factions else 0 for o in owners],
                entrench=[g.mod(o, 'entrench') if o in g.factions else 0.0 for o in owners],
                shell=[g.mod(o, 'shell') if o in g.factions else 0.0 for o in owners], ambush=bt['ambush'], surprise=bt['surprise'],
                # SPEC-ARBRE.md : les régiments qui n'ont pas tout appris (manœuvres, armes) ont leurs propres effets
                umd=_umd(g, bt),
                plans=[_side_plan(g, bt, si) for si in (0, 1)], lieu=lieu,
                carte=TR.VERSION)   # (version du générateur de la carte : une sauvegarde la refabrique à l'identique)


def _umd(g, bt):
    """Effets de technologie des régiments en retard sur leur camp (engine.reg_lag) : id → effets, comme spec['tech']
    plus entrench et shell."""
    out = {}
    for si, side in enumerate(bt['sides']):
        regs = [(o, r) for o, r, _ in g.side_units(bt, si)]
        if side['node'] is not None:
            n = g.nodes[side['node']]
            regs += [(n['owner'], r) for r in n['garrison']]
        for o, r in regs:
            if g.reg_lag(o, r):
                md = g.reg_mods(o, r)
                out[r['id']] = {k: md[k] for k in (*ST.TECH_MODS, 'entrench', 'shell') if md.get(k)}
    return out


def _side_plan(g, bt, si):
    """Plan de bataille de campagne (rules.PLANS) de la plus grosse armée du camp : l'IA de combat le reprend."""
    best = None
    for aid in bt['sides'][si]['armies']:
        a = g.armies.get(aid)
        if a and (best is None or g.army_men(a) > g.army_men(best)):
            best = a
    return best.get('pl') if best else None


def make_units(g, bt):
    units = []
    count = {}

    def name_for(owner, typ):
        k = (owner, typ)
        count[k] = count.get(k, 0) + 1
        return U.unit_name(g, owner, typ, count[k])

    for si, side in enumerate(bt['sides']):
        for aid in side['armies']:
            a = g.armies.get(aid)
            if not a or not a['regs']:
                continue
            ctrl = 'ia'
            gen = a.get('gen')
            gname = a['name'] + (f" ({g.gen_title(gen)})" if gen else '')
            for r in a['regs']:
                u = U.from_reg(r, si, a['owner'], name_for(a['owner'], r['type']), army=aid, ctrl=ctrl)
                u.group, u.gname = aid, gname
                units.append(u)
            if gen:
                u = U.general('g' + aid, si, a['owner'], gen, aid, ctrl)
                u.name = g.gen_title(gen)
                u.group, u.gname = aid, gname
                units.append(u)
            u = U.wagon('w' + aid, si, a['owner'], aid, f"Chariot de munitions ({a['name']})", ctrl)
            u.group, u.gname = aid, gname
            units.append(u)
        nid = side['node']
        if nid is not None:
            n = g.nodes[nid]
            o = n['owner']
            pname = g.geo.nodes[nid]['name']
            grp = f'p{nid}'
            ctrl = 'ia'
            for r in n['garrison']:
                u = U.from_reg(r, si, o, name_for(o, r['type']), army=None, src='garnison', nid=nid, ctrl=ctrl)
                u.group, u.gname = grp, f"Garnison de {pname}"
                units.append(u)
            mil = n['milice']
            if mil >= 5:
                k = max(1, int(math.ceil(mil / MILICE_COMPANY)))
                fort = AA.fort_eff(g, n)
                mor = min(100.0, 55 + 15 * fort)
                arm = g.arm_level(o, 'inf')
                for i in range(k):
                    uid = f'm{nid}' if i == 0 else f'm{nid}-{i + 1}'
                    nm = f"Milice de {pname}" if k == 1 else f"Milice de {pname} ({i + 1})"
                    u = U.milice(uid, si, o, mil / k, mor, arm, nm, nid, ctrl)
                    u.group, u.gname = grp, f"Garnison de {pname}"
                    units.append(u)
            # les canons du rempart : une batterie fixe par niveau de fortification
            k = g.fort_guns(n)
            for i in range(k):
                nm = f"Canons du rempart de {pname}" if k == 1 else f"Canons du rempart de {pname} ({i + 1})"
                u = U.from_reg(g.fort_gun_reg(n, i), si, o, nm, army=None, src='rempart', nid=nid, ctrl=ctrl)
                u.form = 'batterie'
                u.group, u.gname = grp, f"Garnison de {pname}"
                units.append(u)
    return units


def create_orders(g, bt):
    """« Donner mes ordres » : la bataille sans commandement du joueur ; l'ennemi se déploie, puis le camp du joueur
    selon les ordres par défaut (il les change ensuite : set_orders)."""
    spec = make_spec(g, bt)
    me = spec['me']
    if me is None:
        return None
    spec['mode'] = 'ordres'
    spec['orders'] = [None, None]
    lv = [g.difficulty, g.difficulty]
    lv[me] = ACCEL_LEVEL   # (ses officiers : une IA correcte, quelle que soit la difficulté de l'adversaire)
    spec['ai_levels'] = lv
    units = make_units(g, bt)
    tb = TacticalBattle(g.geo, spec, units, [0, 1])
    default_deploy(tb, 1 - me)
    spec['orders'][me] = OR.defaults(tb, me)
    default_deploy(tb, me)
    tb.warm()
    return tb


PLAN_STEP = 2   # le plan de la fenêtre de bataille : une case sur deux (75 × 50 pour 3 × 2 km)


def plan_view(tb):
    """Le plan de la position ennemie (fenêtre de bataille) : le terrain en petites cases, vos troupes, les zones des
    deux armées, et l'ennemi tel que vos éclaireurs le voient s'ils sont assez nombreux (orders.scouting)."""
    me = tb.me
    tb._update_vision()
    cols, rows = COLS // PLAN_STEP, ROWS // PLAN_STEP
    t = ''.join(chr(97 + tb.t[j * PLAN_STEP * COLS + i * PLAN_STEP]) for j in range(rows) for i in range(cols))
    seen = tb.seen_by[me] if OR.scouting(tb, me) >= 0.15 else set()
    units = []
    for u in tb.units:
        if not u.alive or u.cls in ('chariot', 'general') or not (u.side == me or u.id in seen):
            continue
        w, d = U.footprint(u)
        units.append(dict(s=u.side, c=u.cls, x=round(u.x), y=round(u.y), r=round(u.dir, 2), w=round(w), d=round(d)))
    return dict(cols=cols, rows=rows, cell=CELL * PLAN_STEP, t=t, units=units, me=me,
                seen=bool(seen), zones=[tb.ai_zone(0), tb.ai_zone(1)], colors=tb.spec['colors'],
                place=bool(tb.place_info()))


def _livres(g, tb):
    o = tb.spec['owners'][tb.me]
    return g.factions[o]['res']['livres'] if o in g.factions else None


def orders_view(g, tb):
    """La fenêtre des ordres : les choix (et ce qui les verrouille), les ordres en cours, l'avis, les éclaireurs."""
    me = tb.me
    o = OR.of(tb, me) or {}
    return dict(groups=OR.groups(tb, me, _livres(g, tb)), tabs=OR.TABS, orders=o, advice=OR.advise(tb, me, o),
                report=OR.report(tb, me), place=bool(tb.place_info()), side=me, arrows=OR.arrows(tb, me, o))


def set_orders(g, tb, raw, go=False, skip=False):
    """Le joueur change ses ordres : ses troupes se redéploient selon eux ; go : la bataille commence ; skip : elle se
    joue au plus vite (appareil sans 3D)."""
    me = tb.me
    if tb.phase != 'deploiement' or tb.spec.get('mode') != 'ordres':
        return dict(ok=False, msg='La bataille est déjà engagée.')
    o = OR.clean(tb, me, raw, _livres(g, tb))
    tb.spec['orders'][me] = o
    default_deploy(tb, me)
    if not go:
        return dict(ok=True, ordres=orders_view(g, tb))
    if o.get('ruse') == 'deserteurs':
        g.factions[tb.spec['owners'][me]]['res']['livres'] -= OR.FEINT_COST
    ok, msg = tb.start()
    if not ok:
        return dict(ok=False, msg=msg)
    OR.setup(tb, me, o)
    if o.get('ruse') == 'deserteurs':
        AI.shift_reserve(tb, 1 - me, OR.wing_sign(o), "des déserteurs annoncent l'attaque sur l'aile : la réserve "
                                                       "et la cavalerie s'y portent.")
    tb.replay = dict(real=0.0, k=1, skip=skip)
    tb.log("Vos officiers engagent la bataille selon vos ordres.")
    return dict(ok=True, msg='La bataille commence.')


def default_deploy(tb, side):
    """Déploiement de départ (l'IA de secours, pour toutes les unités du camp, que le joueur retouchera)."""
    saved = {u.id: u.ctrl for u in tb.units if u.side == side}
    for u in tb.units:
        if u.side == side:
            u.ctrl = 'ia'
    try:
        AI.deploy(tb, side)
    finally:
        for u in tb.units:
            if u.id in saved:
                u.ctrl = saved[u.id]
    # unités oubliées : au centre de la zone
    z = tb.zone(side)
    rest = [u.id for u in tb.units if u.side == side and u.x == 0.0 and u.y == 0.0]
    if rest:
        tb.deploy(side, rest, (z[0] + z[2]) / 2, (z[1] + z[3]) / 2, who='any')


# ================================================================== boucle et fin
def tick(g, real_dt):
    """Appelé par App.loop toutes les 0,1 s : fait avancer la bataille tactique en cours (à l'allure du film, ou en
    accéléré : autant de pas que le permet ACCEL_BUDGET)."""
    ensure(g)
    if not g.tactical:
        return 0
    n = 0
    for bid, tb in list(g.tactical.items()):
        if bid not in g.battles:
            # paix signée ou place passée à un autre camp pendant la bataille : elle s'arrête sans vainqueur
            g.tactical.pop(bid, None)
            continue
        n += advance(tb, real_dt)
        if tb.phase == 'fin':
            finish(g, tb)
    return n


def advance(tb, real_dt):
    """La bataille avance à l'allure du film (ou au plus vite après « Passer », ou en accéléré) ; rien tant que le
    joueur donne ses ordres ou qu'il doit répondre au moment décisif."""
    rp = tb.replay
    if tb.replay is None:
        return tb.run_for(ACCEL_BUDGET) if tb.accel else 0
    if tb.phase != 'combat' or tb.ask:
        return 0
    rp['real'] = rp.get('real', 0.0) + real_dt
    if rp.get('skip'):
        return tb.run_for(ACCEL_BUDGET)
    rate = REPLAY_RATE * max(rp.get('k', 1), 4 if rp['real'] > REPLAY_LONGER else 2 if rp['real'] > REPLAY_LONG else 1)
    # (un serveur qui peine ne prend pas plus d'une seconde de retard : le film ralentit plutôt que de sauter)
    rp['until'] = min(max(rp.get('until', tb.clock), tb.clock) + real_dt * rate, tb.clock + rate)
    return tb.run_for(ACCEL_BUDGET, rp['until'])


def finish(g, tb):
    """Reporte le résultat sur les régiments de campagne, puis engine.end_battle comme une bataille automatique."""
    bid = tb.bid
    g.tactical.pop(bid, None)
    g.tac_done = {bid: tb}
    bt = g.battles.get(bid)
    res = tb.result
    if not bt or not res:
        return
    winner = res['winner']
    disengage = bool(res['disengage'])
    loser = 1 - winner
    if disengage and loser == 1 and bt['sides'][1]['node'] is not None:
        disengage = False   # le défenseur d'une place qui décroche l'abandonne
    mil = {}
    for u in tb.units:
        r_ = res['units'].get(u.id)
        if r_ is None:
            continue
        if u.src == 'milice':
            mil[u.nid] = mil.get(u.nid, 0.0) + max(0.0, r_['men'])
            continue
        if u.src == 'general':
            a = g.armies.get(u.army)
            if a and r_['wounded'] and a.get('gen') and g.rng.random() < 0.5:
                old = g.gen_title(a['gen'])
                a['gen'] = g.new_general(a['owner'])
                if a['owner'] == g.player:
                    g.log('armee', f"Le {old[0].lower() + old[1:]} est tombé au combat. Le colonel {a['gen']['name']} "
                                   f"prend la tête de la {a['name']}.", a['x'], a['y'], who=a['owner'], important=True)
            continue
        if u.src == 'chariot':
            continue
        regs = g.nodes[u.nid]['garrison'] if u.src == 'garnison' else (g.armies.get(u.army) or {}).get('regs', [])
        reg = next((r for r in regs if r['id'] == u.id), None)
        if reg is None:
            continue
        reg['n'] = max(0.0, r_['men'])
        if u.owner in g.factions and g.mod(u.owner, 'wounded'):   # Croix-Rouge : rendus par end_battle
            reg['wnd'] = max(0.0, r_['lost'] - r_.get('captured', 0)) * g.mod(u.owner, 'wounded')   # (pas les prisonniers)
        reg['morale'] = max(5.0, min(100.0, r_['morale']))
        gain = r_['xp'] - (8 if u.side == winner else 0)   # end_battle donne +8 aux vainqueurs
        reg['xp'] = min(100.0, reg['xp'] + max(0.0, gain))
        reg['ammo'] = max(0.0, min(100.0, r_['ammo']))
        reg['fat'] = max(0.0, min(100.0, r_['fat']))
    for nid, men in mil.items():
        g.nodes[nid]['milice'] = men
    for si in (0, 1):
        bt['sides'][si]['lost'] += res['lost'][si]
        nd = bt['sides'][si]['node']
        if nd is not None:
            g.nodes[nd]['garrison'] = [r for r in g.nodes[nd]['garrison'] if r['n'] >= 5]
        for aid in list(bt['sides'][si]['armies']):
            a = g.armies.get(aid)
            if not a:
                bt['sides'][si]['armies'].remove(aid)
                continue
            a['regs'] = [r for r in a['regs'] if r['n'] >= 5]
            if not a['regs']:
                bt['sides'][si]['armies'].remove(aid)
                del g.armies[aid]
    # la poursuite et les prisonniers ont déjà eu lieu sur le champ de bataille : la campagne reprend ce décompte
    # (res['prisoners'][i] : hommes du camp i faits prisonniers) au lieu de recalculer les siens
    bt['tac'] = dict(prisoners=[int(res['prisoners'][0]), int(res['prisoners'][1])])
    nd = next((s['node'] for s in bt['sides'] if s['node'] is not None), None)
    if nd is not None:
        # les maisons touchées, brûlées, en ruine restent après la bataille (les ruines d'avant y sont déjà comptées)
        n, old = g.nodes[nd], g.nodes[nd].get('deg', 0.0)
        g.damage_town(n, max(0.0, (tb.degats_ville() - old) / max(1e-6, 1 - old)))
    g.end_battle(bt, winner, disengage)
    # le mois s'était arrêté sur cette bataille : la raison affichée dit maintenant son issue
    tr = getattr(g, 'tour', None)
    stop = tr.get('stop') if isinstance(tr, dict) else None
    if isinstance(stop, dict) and stop.get('sel') == ['battle', bt['id']] and tb.me is not None:
        issue = ('Victoire' if winner == tb.me else 'Défaite') if not disengage else \
            ("L'ennemi décroche" if winner == tb.me else 'Retraite')
        stop['text'] = f"{issue} — {tb.spec.get('title') or 'bataille'}. À vous de jouer."
        stop['sel'] = None
    g.speed_idx = 0
    if TT.planning(g):
        TT.settle(g)   # tour par tour : l'armée battue se replie tout de suite


# ================================================================== sauvegarde
def save_into(g, d):
    ensure(g)
    d['settings'] = dict(g.settings)
    d['tactical'] = {bid: tb.to_dict() for bid, tb in g.tactical.items()}


def load_from(g, d):
    g.settings = dict(d.get('settings') or {})
    g.tactical = {}
    g.tac_done = {}
    ensure(g)
    for bid, x in (d.get('tactical') or {}).items():
        try:
            if bid not in g.battles:
                continue
            tb = TacticalBattle.from_dict(g.geo, x)
            if tb.spec.get('mode') != 'ordres':
                # une bataille commandée d'avant « Donner mes ordres » : engagée, les officiers l'achèvent ; sinon, le
                # joueur choisit de nouveau
                if tb.phase == 'deploiement':
                    continue
                tb.autofinish()
            g.tactical[bid] = tb
        except Exception:
            traceback.print_exc()
            g.battles[bid]['mode'] = 'attente'   # bataille illisible : on redemande au joueur
    for bt in g.battles.values():
        if bt.get('mode') in ('ordres', 'manuel') and bt['id'] not in g.tactical:
            bt['mode'] = 'attente'


def migrate(g):
    """Anciennes sauvegardes : munitions pleines, hommes frais, batailles automatiques."""
    ensure(g)
    for a in g.armies.values():
        for r in a['regs']:
            r.setdefault('ammo', 100.0)
            r.setdefault('fat', 0.0)
    for n in g.nodes:
        for r in n['garrison']:
            r.setdefault('ammo', 100.0)
            r.setdefault('fat', 0.0)
    for bt in g.battles.values():
        bt.setdefault('mode', 'auto')


# ================================================================== vues et commandes
def tac_view(g):
    ensure(g)
    for bid, tb in g.tactical.items():
        return dict(bid=bid, phase=tb.phase, title=tb.spec.get('title'))
    for bid, tb in g.tac_done.items():
        return dict(bid=bid, phase='fin', title=tb.spec.get('title'))
    return None


def find(g, bid):
    ensure(g)
    if bid in g.tactical:
        return g.tactical[bid]
    if bid in g.tac_done:
        return g.tac_done[bid]
    if not bid:
        for tb in list(g.tactical.values()) + list(g.tac_done.values()):
            return tb
    return None


def battle_view(g, bid, since=0):
    tb = find(g, bid)
    if not tb:
        return None
    v = tb.view(tb.me, since)
    if tb.spec.get('mode') == 'ordres':
        v['mode'] = 'ordres'
        if tb.phase == 'deploiement' and not since:
            v['ordres'] = orders_view(g, tb)
        if tb.replay is not None:
            v['replay'] = dict(k=tb.replay.get('k', 1), skip=bool(tb.replay.get('skip')))
            if tb.ask and tb.ask.get('side') == tb.me:
                v['ask'] = dict(text=tb.ask['text'], key=tb.ask['key'])
            mem = tb.ai_mem.get(f's{tb.me}') or {}
            v['notes'] = [txt for t, txt in (mem.get('journal') or [])[-12:] if not any(k in txt for k in DULL)][-4:]
            v['fx'] = v['fx'][-ACCEL_FX:]   # (la bataille défile vite : les derniers effets suffisent)
    for d in v['units']:   # valeurs chiffrées de mes troupes (stats.py) ; l'ennemi reste dans le brouillard
        u = tb.by_id.get(d['id'])
        if u is not None and (tb.me is None or u.side == tb.me):
            d['stats'] = ST.of_unit(u, tb)
            if u.cls == 'artillerie' and tb.is_wood(u.x, u.y):
                d['camo'] = 1   # (canons camouflés dans un bois : le panneau du régiment le dit)
    return v


def map_view(g, bid):
    tb = find(g, bid)
    if not tb:
        return None
    return tb.map_view()


def on_speed(g, v):
    """Le joueur reprend la campagne : on oublie la bataille terminée. Refus si la campagne est figée."""
    ensure(g)
    a = AA.asking(g) if v > 0 else None
    if a:
        return False, f"La {a['name']} attend vos ordres devant {AA.place(g, a['ask']['node'])}."
    if v > 0 and frozen(g):
        return False, ("Une bataille attend vos ordres : commandez-la ou laissez la résolution automatique."
                       if waiting(g) else "Une bataille est en cours sur le champ de bataille.")
    if v > 0:
        g.tac_done = {}
    return True, ''


def army_locked(g, aid):
    """Armée engagée dans une bataille sur ordres : ses ordres se donnent sur le champ de bataille."""
    a = g.armies.get(aid) if aid else None
    if not a or not a.get('battle'):
        return False
    bt = g.battles.get(a['battle'])
    return bool(bt and bt.get('mode') in ('ordres', 'manuel'))


def command(g, body):
    """Sous-commandes `tac` (contrat, § 6). Renvoie {ok, msg}."""
    ensure(g)
    sub = body.get('sub')
    if sub == 'settings':
        v = body.get('battles')
        if v not in SETTINGS:
            return dict(ok=False, msg='Réglage inconnu.')
        g.settings['battles'] = v
        return dict(ok=True, msg={'demander': 'Toujours demander avant une bataille.',
                                  'auto': 'Batailles toujours résolues automatiquement.',
                                  'auto_petites': 'Escarmouches résolues automatiquement.'}[v])
    if sub == 'preview':
        # la fenêtre de bataille s'ouvre : la bataille se prépare (carte, ennemi déployé) pour en montrer le plan
        bt = g.battles.get(body.get('bid'))
        if not bt or bt.get('mode') != 'attente':
            return dict(ok=False, msg='Aucune bataille en attente.')
        tb = g.tac_preview.get(bt['id']) or create_orders(g, bt)
        if tb is None:
            return dict(ok=False, msg="Vous n'avez pas de troupes dans cette bataille.")
        g.tac_preview = {bt['id']: tb}
        return dict(ok=True, plan=plan_view(tb))
    if sub == 'choose':
        bt = g.battles.get(body.get('bid'))
        if not bt or bt.get('mode') != 'attente':
            return dict(ok=False, msg='Aucune bataille en attente.')
        mode = body.get('mode')
        pre = g.tac_preview.pop(bt['id'], None)
        if mode == 'auto':
            bt['mode'] = 'auto'
            if TT.planning(g):
                TT.settle(g)   # tour par tour : le général règle la bataille sur-le-champ, puis les marches suspendues reprennent
                return dict(ok=True, msg='Le général a commandé la bataille.')
            return dict(ok=True, msg='Le général commande : résolution automatique.')
        if mode != 'ordres':
            return dict(ok=False, msg='Mode inconnu.')
        if g.tactical:
            return dict(ok=False, msg='Une autre bataille est déjà en cours.')
        tb = pre or create_orders(g, bt)
        if tb is None:
            bt['mode'] = 'auto'
            return dict(ok=False, msg="Vous n'avez pas de troupes dans cette bataille.")
        bt['mode'] = 'ordres'
        g.tactical[bt['id']] = tb
        g.tac_done = {}
        return dict(ok=True, msg='Donnez vos ordres.', bid=bt['id'])
    if sub == 'close':
        g.tac_done = {}
        return dict(ok=True)
    tb = next(iter(g.tactical.values()), None)
    if body.get('bid') and body.get('bid') in g.tactical:
        tb = g.tactical[body['bid']]
    if not tb:
        return dict(ok=False, msg='Aucune bataille en cours.')
    if sub == 'piet':
        # la boue laissée par les troupes, gardée avec la bataille (SPEC-SUITE F8) : rien d'autre ne la lit
        png = body.get('png')
        if not valid_piet(png):
            return dict(ok=False, msg='Image invalide.')
        tb.piet = png
        return dict(ok=True)
    if tb.spec.get('mode') != 'ordres':
        return dict(ok=False, msg='Vos officiers achèvent cette bataille.')   # (ancienne sauvegarde, en accéléré)
    if sub == 'orders':
        return set_orders(g, tb, body.get('orders'), bool(body.get('go')), bool(body.get('skip')))
    if sub == 'cancel':
        # retour à la fenêtre de bataille : la bataille n'a pas commencé, on l'oublie
        if tb.phase != 'deploiement':
            return dict(ok=False, msg='La bataille est déjà engagée.')
        g.tactical.pop(tb.bid, None)
        bt = g.battles.get(tb.bid)
        if bt:
            bt['mode'] = 'attente'
        return dict(ok=True)
    if sub == 'answer':
        ok = OR.answer(tb, 'go' if body.get('v') == 'go' else 'wait')
        return dict(ok=ok, msg='' if ok else 'Aucune question en attente.')
    if sub == 'replay':
        if tb.replay is None:
            return dict(ok=False, msg="La bataille n'est pas engagée.")
        if body.get('k') in (1, 2, 4):
            tb.replay['k'] = body['k']
        if body.get('skip'):
            tb.replay['skip'] = True
            if tb.ask:
                OR.answer(tb, 'go')
        return dict(ok=True)
    return dict(ok=False, msg='Commande de bataille inconnue.')
