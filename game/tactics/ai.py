"""IA de combat de secours (en attendant celle de l'équipe IA, qui gardera ces deux signatures).

deploy(battle, side) : déploiement simple dans la zone (ligne d'infanterie, voltigeurs devant, canons sur la hauteur
                       ou en lisière, cavalerie aux ailes, état-major et chariot derrière ; dans la place pour le
                       défenseur d'une place) ;
think(battle, side, dt) : appelée toutes les 2 s de bataille ; l'assaillant avance et tire, le défenseur tient
                       la position ; carré face aux cavaliers, charges opportunes, ralliement, décrochage.
N'utilise que les ordres et les aides publics du moteur (voir l'aide-mémoire de battle.py), sans tricher sur la vue.
"""
import math

PERIOD = dict(facile=40.0, normal=20.0, difficile=12.0)   # réflexion « lourde » (s de bataille)


def _mem(battle, side):
    m = getattr(battle, 'ai_mem', None)
    if m is None:
        m = battle.ai_mem = {}
    return m.setdefault(side, dict(next=0.0, init=None))


def _front_point(battle, side, back=80.0):
    z = battle.zone(side)
    fd = battle.front_dir(side)
    cx, cy = (z[0] + z[2]) / 2, (z[1] + z[3]) / 2
    hw, hh = (z[2] - z[0]) / 2, (z[3] - z[1]) / 2
    reach = abs(math.cos(fd)) * hw + abs(math.sin(fd)) * hh
    return cx + math.cos(fd) * (reach - back), cy + math.sin(fd) * (reach - back), fd


def deploy(battle, side):
    us = battle.ai_units(side)
    if not us:
        return
    place = battle.place_info()
    by = dict(inf=[], light=[], cav=[], art=[], gen=[], wagon=[])
    for u in us:
        k = 'gen' if u.cls == 'general' else 'wagon' if u.cls == 'chariot' else 'art' if u.cls == 'artillerie' else \
            'cav' if u.cls == 'cavalerie' else 'light' if u.light else 'inf'
        by[k].append(u)
    if place and side == 1:
        # défense de la place : face à l'assaillant, dans les murs
        ax, ay, _ = _front_point(battle, 0, 0)
        fd = math.atan2(ay - place['y'], ax - place['x'])
        r = max(40.0, place['r'] * 0.75)
        fx, fy = place['x'] + math.cos(fd) * r, place['y'] + math.sin(fd) * r
        battle.deploy(side, [u.id for u in by['inf'] + by['light']], fx, fy, fd)
        battle.deploy(side, [u.id for u in by['art']], place['x'] + math.cos(fd) * r * 0.5,
                      place['y'] + math.sin(fd) * r * 0.5, fd, 'batterie')
        bx, by_ = place['x'] - math.cos(fd) * r * 0.4, place['y'] - math.sin(fd) * r * 0.4
        battle.deploy(side, [u.id for u in by['cav'] + by['gen'] + by['wagon']], bx, by_, fd)
        return
    fx, fy, fd = _front_point(battle, side, 120)
    px, py = -math.sin(fd), math.cos(fd)
    battle.deploy(side, [u.id for u in by['inf']], fx, fy, fd)
    if by['light']:
        battle.deploy(side, [u.id for u in by['light']], fx + math.cos(fd) * 70, fy + math.sin(fd) * 70, fd, 'tirailleurs')
    if by['art']:
        # canons : hauteur ou lisière proche du centre de la ligne
        ax, ay = fx - math.cos(fd) * 40, fy - math.sin(fd) * 40
        spot = battle.best_spot(ax, ay, 260, 'wood_edge', side, facing=fd, cls='artillerie')
        if spot == (ax, ay):
            spot = battle.best_spot(ax, ay, 260, 'height', side, cls='artillerie')
        battle.deploy(side, [u.id for u in by['art']], spot[0], spot[1], fd, 'batterie')
    width = sum(battle.ranges(u)[0] * 0 + 140 for u in by['inf']) / 2 + 120
    cav = by['cav']
    for k, u in enumerate(cav):
        s = 1 if k % 2 == 0 else -1
        battle.deploy(side, [u.id], fx + px * s * (width + 60 * (k // 2)) - math.cos(fd) * 120,
                      fy + py * s * (width + 60 * (k // 2)) - math.sin(fd) * 120, fd)
    battle.deploy(side, [u.id for u in by['gen']], fx - math.cos(fd) * 200, fy - math.sin(fd) * 200, fd)
    battle.deploy(side, [u.id for u in by['wagon']], fx - math.cos(fd) * 320, fy - math.sin(fd) * 320, fd)


def _nearest(u, foes, pred=None):
    best, bd = None, 1e18
    for e in foes:
        if pred and not pred(e):
            continue
        d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2
        if d < bd:
            best, bd = e, d
    return best, math.sqrt(bd)


def think(battle, side, dt):
    us = battle.ai_units(side)
    if not us or battle.phase != 'combat':
        return
    m = _mem(battle, side)
    if m['init'] is None:
        m['init'] = max(1.0, battle.strength(side))
    foes = battle.visible_enemies(side)
    valid_foes = [e for e in foes if e.valid]
    # réflexes (à chaque appel) : carré face aux cavaliers, ralliement
    for u in us:
        if u.state == 'deroute':
            battle.order(side, [u.id], 'rally')
            continue
        if u.cls == 'inf' and u.busy <= 0 and u.state not in ('melee', 'charge'):
            cav, d = _nearest(u, valid_foes, lambda e: e.cls == 'cavalerie')
            if cav is not None and d < 260 and u.form != 'carre' and battle.difficulty != 'facile':
                battle.order(side, [u.id], 'form', form='carre')
            elif u.form == 'carre' and (cav is None or d > 500):
                battle.order(side, [u.id], 'form', form='tirailleurs' if u.light else 'ligne')
    if battle.clock < m['next']:
        return
    m['next'] = battle.clock + PERIOD.get(battle.difficulty, 20.0)
    mine = battle.strength(side)
    attacker = side == 0
    obj = battle.objective()
    # décrocher quand tout est perdu (jamais pour le défenseur d'une place)
    if battle.withdrawing[side]:
        return
    if mine < 0.45 * m['init'] and battle.seen_strength(side) > 1.3 * mine and not (obj and side == 1):
        battle.withdraw(side)
        return
    valid = [u for u in us if u.valid]
    if not valid:
        return
    cx = sum(u.x for u in valid) / len(valid)
    cy = sum(u.y for u in valid) / len(valid)
    ez = battle.zone(1 - side)
    goal = obj if (obj and attacker) else ((ez[0] + ez[2]) / 2, (ez[1] + ez[3]) / 2)
    for u in us:
        if u.state in ('deroute', 'melee', 'charge', 'ralliement', 'hors'):
            continue
        if u.cls == 'general':
            if (u.x - cx) ** 2 + (u.y - cy) ** 2 > 250 ** 2:
                gx, gy = cx - math.cos(battle.front_dir(side)) * 120, cy - math.sin(battle.front_dir(side)) * 120
                battle.order(side, [u.id], 'move', x=gx, y=gy)
            continue
        if u.cls == 'chariot':
            if (u.x - cx) ** 2 + (u.y - cy) ** 2 > 350 ** 2:
                gx, gy = cx - math.cos(battle.front_dir(side)) * 220, cy - math.sin(battle.front_dir(side)) * 220
                battle.order(side, [u.id], 'move', x=gx, y=gy)
            continue
        e, mx, _ = battle.ranges(u)
        # cibles : l'infanterie ne court pas après les cavaliers (sauf tout près)
        tg, d = _nearest(u, valid_foes, lambda f: f.cls not in ('cavalerie', 'general', 'chariot'))
        if tg is None or u.cls == 'cavalerie':
            tg, d = _nearest(u, valid_foes)
        else:
            c2, d2 = _nearest(u, valid_foes, lambda f: f.cls == 'cavalerie')
            if c2 is not None and d2 < 150:
                tg, d = c2, d2
        if u.cls == 'cavalerie':
            def prey_ok(f):
                if f.state == 'deroute' or f.cls in ('artillerie', 'chariot') or f.form in ('attelee', 'tirailleurs'):
                    return True
                if f.form == 'carre' or f.cls == 'cavalerie':
                    return battle.difficulty == 'facile' and f.cls == 'cavalerie'
                if f.state == 'melee':
                    return True
                # de flanc ou de dos
                return math.cos(f.dir - math.atan2(u.y - f.y, u.x - f.x)) < 0.3 or battle.difficulty == 'facile'
            prey, pd = _nearest(u, foes, prey_ok)
            if prey is not None and pd < (450 if attacker else 300) and u.morale > 45:
                battle.order(side, [u.id], 'charge', target=prey.id)
            elif tg is not None and d > 520 and not u.path:
                # se porter à distance de charge, sur l'aile
                k = (d - 400) / d
                battle.order(side, [u.id], 'move', x=u.x + (tg.x - u.x) * k, y=u.y + (tg.y - u.y) * k,
                             dir=math.atan2(tg.y - u.y, tg.x - u.x))
            elif tg is None and attacker and not u.path:
                battle.order(side, [u.id], 'move', x=(u.x + goal[0]) / 2, y=(u.y + goal[1]) / 2)
            continue
        if tg is not None and attacker and u.cls == 'inf' and d > e * 2.5 + 150 and not u.path:
            # l'ennemi est encore loin : on avance droit devant, en gardant son rang
            fd = battle.front_dir(side)
            tx, ty = u.x + math.cos(fd) * 250, u.y + math.sin(fd) * 250
            if obj:
                tx, ty = u.x + (obj[0] - u.x) * 0.3, u.y + (obj[1] - u.y) * 0.3
            battle.order(side, [u.id], 'move', x=tx, y=ty, dir=math.atan2(tg.y - u.y, tg.x - u.x))
        elif tg is not None and attacker and u.cls == 'inf' and d > e * 2.5 + 150:
            pass
        elif tg is not None:
            if u.ammo < 1 and d < 220 and u.cls == 'inf' and u.morale > 40:
                battle.order(side, [u.id], 'charge', target=tg.id)
            elif attacker or d < mx * 1.1:
                if not (u.order and u.order.get('kind') == 'attack' and u.target == tg.id):
                    if attacker or u.cls == 'artillerie':
                        battle.order(side, [u.id], 'attack', target=tg.id)
                # à la baïonnette seulement contre un ennemi déjà éprouvé (ou au hasard pour une IA maladroite)
                weak = tg.men < 0.6 * u.men or tg.men < 0.55 * tg.men0
                if attacker and u.cls == 'inf' and d < 120 and tg.state != 'deroute' and u.morale > 55 and \
                        (weak if battle.difficulty != 'facile' else battle.rng.random() < 0.3):
                    battle.order(side, [u.id], 'charge', target=tg.id)
            elif u.cls == 'artillerie' and u.form != 'batterie' and not u.path:
                battle.order(side, [u.id], 'form', form='batterie')
        elif attacker and not u.path:
            # pas d'ennemi en vue : on marche vers l'objectif
            tx, ty = goal
            dd = math.hypot(tx - u.x, ty - u.y)
            if dd > 60:
                k = min(1.0, 300.0 / dd)
                battle.order(side, [u.id], 'move', x=u.x + (tx - u.x) * k, y=u.y + (ty - u.y) * k,
                             dir=math.atan2(ty - u.y, tx - u.x))
        elif not attacker and u.cls == 'artillerie' and u.form != 'batterie' and not u.path:
            battle.order(side, [u.id], 'form', form='batterie')
