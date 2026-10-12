"""Raccord entre la campagne et les batailles tactiques.

- choix du mode d'une bataille du joueur (attente / manuel / auto) et réglage `settings['battles']` ;
- création d'une TacticalBattle depuis une bataille de campagne (`bt`), boucle tactique (tick), report du résultat
  sur les régiments puis `engine.end_battle` ;
- « Finir automatiquement » : la bataille jouée en accéléré par tick (budget de calcul ACCEL_BUDGET par appel),
  reprise du commandement (`resume`), et resolve_now pour la jouer d'un coup (essais, bancs) ;
- munitions (`ammo`, 0–100 %) et fatigue (`fat`, 0–100) persistantes des régiments en campagne ;
- sauvegarde, chargement et migration ; vues pour /api/state, /api/tactic et /api/tactic_map ; commandes `tac`.

Les crochets dans engine.py, views.py et server.py ne font qu'appeler ces fonctions.
"""
import math
import traceback
import zlib

from .. import rules as R
from .. import army_actions as AA
from . import units as U
from . import ai as AI
from .battle import TacticalBattle

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


# ================================================================== état de la partie
def ensure(g):
    """Champs propres aux batailles tactiques (nouvelle partie ou ancienne sauvegarde)."""
    if not hasattr(g, 'tactical') or g.tactical is None:
        g.tactical = {}
    if not hasattr(g, 'tac_done'):
        g.tac_done = {}
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


def campaign_tick(g, dt):
    """Recomplètement des munitions et fatigue des régiments, par pas de campagne (dt en jours)."""
    hot = {z: w['kind'] == 'canicule' for z, w in g.weather.items()}
    for a in g.armies.values():
        if a['state'] == 'battle':
            continue
        code = a['owner']
        st = a['state']
        if st in ('move', 'retreat'):
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
        place = dict(nid=bt['node'], name=gn['name'], type=gn['type'], fort=n['fort'], dmg=AA.breach(n),
                     bar=(n.get('aa') or {}).get('bar', 0.0), pop=int(n.get('pop', gn['pop0'])), x=gn['x'], y=gn['y'],
                     battle=True)
    techs = [g.factions[o]['techs'] if o in g.factions else [] for o in owners]
    gname = g.place_name(bt['x'], bt['y'])
    kind = 'Embuscade' if bt['ambush'] else ('Assaut' if bt['node'] is not None else 'Bataille')
    return dict(bid=bt['id'], seed=(zlib.crc32(bt['id'].encode()) ^ (g.seed * 2654435761)) & 0x7FFFFFFF,
                cx=bt['x'], cy=bt['y'], season=g.season(), weather=g.weather[zone]['kind'], year=g.date().year,
                place=place, att_angle=_att_angle(g, bt), owners=owners, names=[g.fname(o) for o in owners],
                colors=[R.FACTIONS[o]['color'] if o in R.FACTIONS else R.NEUTRAL_COLOR for o in owners],
                me=me, difficulty=g.difficulty, title=f"{kind} {gname}", place_name=gname, date=g.date_str(),
                fm_swift=[min(0.5, g.mod(o, 'fm_swift')) if o in g.factions else 0.0 for o in owners],
                art_cheval=['art_cheval' in t for t in techs], ambush=bt['ambush'], surprise=bt['surprise'],
                plans=[_side_plan(g, bt, si) for si in (0, 1)])


def _side_plan(g, bt, si):
    """Plan de bataille de campagne (rules.PLANS) de la plus grosse armée du camp : l'IA de combat le reprend."""
    best = None
    for aid in bt['sides'][si]['armies']:
        a = g.armies.get(aid)
        if a and (best is None or g.army_men(a) > g.army_men(best)):
            best = a
    return best.get('pl') if best else None


def make_units(g, bt, manual):
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
            ctrl = 'joueur' if manual and a['owner'] == g.player else 'ia'
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
            ctrl = 'joueur' if manual and o == g.player else 'ia'
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


def create(g, bt, manual=True):
    spec = make_spec(g, bt)
    if not manual:
        spec['me'] = None
    units = make_units(g, bt, manual)
    ai_sides = [s for s in (0, 1) if not any(u.side == s and u.ctrl == 'joueur' for u in units)]
    tb = TacticalBattle(g.geo, spec, units, ai_sides)
    for s in (0, 1):
        default_deploy(tb, s)
    tb.warm()
    return tb


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
    """Appelé par App.loop toutes les 0,1 s : fait avancer la bataille tactique en cours (à sa vitesse, ou en accéléré
    après « Finir automatiquement » : autant de pas que le permet ACCEL_BUDGET)."""
    ensure(g)
    if not g.tactical:
        return 0
    n = 0
    for bid, tb in list(g.tactical.items()):
        if bid not in g.battles:
            # paix signée ou place passée à un autre camp pendant la bataille : elle s'arrête sans vainqueur
            g.tactical.pop(bid, None)
            continue
        n += tb.run_for(ACCEL_BUDGET) if tb.accel else tb.advance(real_dt)
        if tb.phase == 'fin':
            finish(g, tb)
    return n


def resolve_now(g, tb):
    """Synchrone (essais, bancs) : « Finir automatiquement », puis toute la suite de la bataille d'un coup, sans budget
    de temps, et le report en campagne comme pour une bataille jouée."""
    if tb.phase != 'fin':
        if not tb.accel:
            tb.autofinish()
        tb.run_to_end()
    if g.tactical.get(tb.bid) is tb:
        finish(g, tb)


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
            if bid in g.battles:
                g.tactical[bid] = TacticalBattle.from_dict(g.geo, x)
        except Exception:
            traceback.print_exc()
            g.battles[bid]['mode'] = 'attente'   # bataille illisible : on redemande au joueur
    for bt in g.battles.values():
        if bt.get('mode') == 'manuel' and bt['id'] not in g.tactical:
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
    return tb.view(tb.me, since)


def map_view(g, bid):
    tb = find(g, bid)
    if not tb:
        return None
    return tb.map_view()


def on_speed(g, v):
    """Le joueur reprend la campagne : on oublie la bataille terminée. Refus si la campagne est figée."""
    ensure(g)
    if v > 0 and frozen(g):
        return False, ("Une bataille attend vos ordres : commandez-la ou laissez la résolution automatique."
                       if waiting(g) else "Une bataille est en cours sur le champ de bataille.")
    if v > 0:
        g.tac_done = {}
    return True, ''


def army_locked(g, aid):
    """Armée engagée dans une bataille manuelle : ses ordres se donnent sur le champ de bataille."""
    a = g.armies.get(aid) if aid else None
    if not a or not a.get('battle'):
        return False
    bt = g.battles.get(a['battle'])
    return bool(bt and bt.get('mode') == 'manuel')


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
    if sub == 'choose':
        bt = g.battles.get(body.get('bid'))
        if not bt or bt.get('mode') != 'attente':
            return dict(ok=False, msg='Aucune bataille en attente.')
        mode = body.get('mode')
        if mode == 'auto':
            bt['mode'] = 'auto'
            return dict(ok=True, msg='Le général commande : résolution automatique.')
        if mode != 'manuel':
            return dict(ok=False, msg='Mode inconnu.')
        if g.tactical:
            return dict(ok=False, msg='Une autre bataille est déjà en cours.')
        tb = create(g, bt, manual=True)
        if tb.me is None:
            bt['mode'] = 'auto'
            return dict(ok=False, msg="Vous n'avez pas de troupes dans cette bataille.")
        bt['mode'] = 'manuel'
        g.tactical[bt['id']] = tb
        g.tac_done = {}
        return dict(ok=True, msg='Déployez vos troupes.', bid=bt['id'])
    if sub == 'close':
        g.tac_done = {}
        return dict(ok=True)
    tb = next(iter(g.tactical.values()), None)
    if body.get('bid') and body.get('bid') in g.tactical:
        tb = g.tactical[body['bid']]
    if not tb:
        return dict(ok=False, msg='Aucune bataille en cours.')
    me = tb.me
    if sub == 'deploy':
        ok, msg = tb.deploy(me, list(body.get('units') or []), _num(body.get('x')), _num(body.get('y')),
                            None if body.get('dir') is None else _num(body.get('dir')), body.get('form'), who='joueur')
        return dict(ok=ok, msg=msg)
    if sub == 'start':
        ok, msg = tb.start()
        return dict(ok=ok, msg=msg)
    if sub == 'order':
        p = {k: body[k] for k in ('x', 'y', 'dir', 'target', 'form', 'run', 'mode', 'fire', 'value', 'v') if k in body}
        for k in ('x', 'y', 'dir'):
            if k in p and p[k] is not None:
                p[k] = _num(p[k])
        ok, msg = tb.order(me, list(body.get('units') or []), body.get('kind'), who='joueur', **p)
        return dict(ok=ok, msg=msg)
    if sub == 'speed':
        v = int(_num(body.get('v', 1)))
        if v not in (0, 1, 2, 4):
            return dict(ok=False, msg='Vitesse invalide.')
        if tb.accel:
            return dict(ok=False, msg='Vos officiers mènent la bataille au plus vite : reprenez le commandement pour '
                                      'régler la vitesse.')
        tb.speed = v
        return dict(ok=True)
    if sub == 'withdraw':
        ok, msg = tb.withdraw(me)
        return dict(ok=ok, msg=msg)
    if sub == 'autofinish':
        # la suite se joue en accéléré dans tick (le joueur la voit défiler et peut reprendre le commandement)
        ok, msg = tb.autofinish()
        if tb.phase == 'fin':
            finish(g, tb)
        return dict(ok=ok, msg=msg)
    if sub == 'resume':
        ok, msg = tb.resume()
        return dict(ok=ok, msg=msg)
    return dict(ok=False, msg='Commande de bataille inconnue.')


def _num(v):
    x = float(v)
    if not math.isfinite(x):
        raise ValueError('nombre invalide')
    return x
