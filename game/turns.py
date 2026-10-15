"""Tour par tour, mois par mois (à la Civilization ou Empire : Total War), bâti sur la simulation continue.

Un tour = un mois, en deux temps :

1. **Le tour du joueur** (phase « ordres ») : la date ne bouge pas, et chaque ordre s'exécute tout de suite.
   Une armée qui reçoit un ordre de marche part aussitôt, sous vos yeux, et avance jusqu'à épuiser ses jours de
   marche du mois (march_days : tout le mois) ou jusqu'à rencontrer l'ennemi ; si la route est plus longue, elle
   la reprend d'elle-même au tour suivant. Une bataille qu'elle déclenche se livre sur-le-champ (jouée sur le champ de
   bataille, ou réglée par le général : resolve_battle_now), un assaut aussi. Les achats, constructions, recherches
   et décisions de gouvernement sont payés tout de suite ; les travaux, eux, avancent avec le temps.
2. **Le tour des IA** (« Tour suivant ») : le mois est calculé d'un coup, aussi vite que possible (une ou deux
   secondes), par tranches de BUDGET secondes pour que le serveur réponde encore au navigateur : les IA marchent,
   négocient et se battent, les travaux et les sièges avancent, les revenus tombent. Vos armées, qui ont déjà joué,
   restent en place (Game.paused). Tout s'arrête au 1er du mois suivant, à 0 h : les batailles encore en cours sont
   réglées, les jours de marche sont rendus (begin_turn) et c'est de nouveau à vous.

Le tour des IA ne s'interrompt que si le joueur doit choisir, comme dans Total War :
- une bataille où il a une armée ou une place attend son choix (la livrer ou la laisser au général) ;
- une décision l'attend (événement historique ou local) ;
- la partie est finie.
Le choix fait (bataille réglée, décision prise), le tour des IA reprend tout seul. Le reste (armée ennemie sur ses
terres, siège, guerre, proposition, nouvelle époque, traité) n'arrête plus rien : c'est dans le récapitulatif.

Pendant le tour des IA, le journal est relu pas à pas pour préparer le récapitulatif du mois (batailles, places prises
ou perdues, constructions, découvertes, revenus), affiché au début du tour suivant.

Le temps se compte en tours (SPEC-TOURS.md) : la production avance d'un tour de travail par mois (work), les durées
finissent au début d'un tour du joueur et lui laissent des tours entiers (deadline), l'écran dit « au prochain tour »,
« dans N tours » (tours_left, ready_in, eta).

Le temps réel d'origine (vitesses ×½ à ×30) reste disponible : tour['on'] = False.
"""
import calendar
import datetime
import math
import re
import time

from . import rules as R

BUDGET = 0.25         # secondes de calcul du tour des IA par appel (la boucle du serveur appelle toutes les 0,1 s)
MARCH_FRAC = 1.0       # part du mois qu'une armée peut marcher pendant le tour du joueur (1 : tout le mois, comme les IA)
MARCH_STEP = 0.1       # jours : pas de la marche instantanée (rencontres examinées à chaque pas, contact à 2,6 km)
RETREAT_DAYS = 4.0     # jours de marche d'une armée battue qui se replie, tout de suite, pendant le tour du joueur
TRAIL_PTS = 90         # points gardés du trajet d'une marche, pour l'animer dans le navigateur
FOE_MIN_MEN = 150     # récapitulatif : un parti de moins de 150 hommes (éclaireurs, fourrageurs) sur vos terres n'y est pas
PRIORITY = ['fin', 'decision', 'bataille']
MAX_ITEMS = 30        # par rubrique du récapitulatif
_DIPLO = re.compile(r"guerre|paix|alliance|trêve|soumi|vassal|traité")   # pas les accords de commerce ni les échanges
_BUILT = re.compile(r"^(Fin des travaux à |Magasin aux vivres construit à )|( terminées à | s'agrandit )")


def new_state(on=True):
    """État du tour par tour, enregistré dans la sauvegarde (Game.tour)."""
    return dict(on=on, end=None, stop=None, seen=None, acc=None, recap=None)


def migrate(g):
    """Anciennes sauvegardes (avant le tour par tour) : elles passent au tour par tour, comme les nouvelles parties.
    Le réglage avancé du menu rend le temps réel."""
    tr = getattr(g, 'tour', None)
    if not isinstance(tr, dict):
        tr = g.tour = new_state()
    for k, v in new_state().items():
        tr.setdefault(k, v)
    if not isinstance(tr['seen'], dict) or set(tr['seen']) != {'bt', 'ev'}:
        tr['seen'] = None
    for k in ('pace', 'last', 'mem'):
        tr.pop(k, None)   # (ancien rythme du tour des IA, anciennes interruptions : le mois se calcule d'un coup)
    if tr['end'] is not None and tr['end'] <= g.t - 1e-6:
        tr['end'] = None   # échéance dépassée (sauvegarde bricolée) : on attend les ordres
    for a in g.armies.values():
        a.setdefault('mp', None)
    # échéances d'avant les tours (en plein milieu d'un mois) : ramenées au début du tour suivant
    up = lambda t: t if t <= g.t else turn_start_after(g, t)   # (déjà échue : elle le reste)
    for f in g.factions.values():
        for d in (f['truce'], f.get('passage') or {}):
            for k in d:
                d[k] = up(d[k])
    for x in g.proposals:
        x['expires'] = up(x['expires'])
    for x in g.pending_ev:
        x['until'] = up(x['until'])
    for n in g.nodes:
        for e in n.get('tm') or ():
            e['until'] = up(e['until'])


# ================================================================== calendrier
def month_end(g, t=None, k=1):
    """Échéance du tour : le 1er du mois suivant (ou du k-ième mois après celui de t), à 0 h, en jours depuis le début de
    la partie."""
    d = g.date(t)
    y, m = divmod(d.month - 1 + k, 12)
    return float(datetime.date(d.year + y, m + 1, 1).toordinal() - g.start_ord)


def month_days(g, end):
    """Longueur du mois qui s'achève à l'échéance."""
    d = g.date(end - 1)
    return calendar.monthrange(d.year, d.month)[1]


def phase(g):
    """'ordres' (carte figée, on attend « Fin du mois »), 'cours' (le mois se joue) ou 'arret' (interrompu)."""
    tr = g.tour
    if tr['end'] is None:
        return 'ordres'
    return 'cours' if g.speed_idx else 'arret'


# ================================================================== le temps en tours (SPEC-TOURS.md)
TOUR_DAYS = 30.0   # jours de travail d'un tour, quelle que soit la longueur du mois (règle A : capacité par tour)


def work(g, dt):
    """Jours de travail du pas de dt jours qui vient de s'écouler (g.t est à sa fin) : un mois entier en fait TOUR_DAYS,
    février comme mars. (Le dernier pas du mois franchit minuit : il compte dans le mois où il a commencé.)"""
    d = g.date(g.t - dt)
    return dt * TOUR_DAYS / calendar.monthrange(d.year, d.month)[1]


def ready_in(g, work_left):
    """Dans combien de tours est prêt ce qui demande encore work_left jours de travail, à la capacité d'un tour par
    mois (1 : au prochain tour ; 0 : rien à faire). Le tour en cours n'a plus que ce qui reste du mois."""
    if work_left <= 1e-6:
        return 0
    d = g.date()
    cap = (month_end(g) - g.t) * TOUR_DAYS / calendar.monthrange(d.year, d.month)[1]
    return 1 if work_left <= cap + 1e-6 else 1 + math.ceil((work_left - cap) / TOUR_DAYS - 1e-6)


def deadline(g, n, *who):
    """Échéance d'une durée de n tours (règle B) : le début d'un tour du joueur, qui garde n tours entiers. Pendant son
    tour, ce tour compte (n = 1 : jusqu'à la fin du mois) ; ailleurs (tour des IA, temps réel), à partir du suivant.
    who : les camps concernés ; sans le joueur, n mois à partir de maintenant (les IA gardent leur rythme d'avant)."""
    n = max(1, int(n))
    if who and g.player not in who:
        return g.t + n * TOUR_DAYS
    fresh = planning(g) or g.t <= month_end(g, k=0) + 1e-6   # (au début d'un tour, même au dernier pas des IA)
    return month_end(g, k=n if fresh else n + 1)


def turn_start_after(g, t):
    """Le début de tour (1er du mois, 0 h) à t ou juste après : ce qu'une échéance en jours devient en tours."""
    start = month_end(g, t, 0)
    return start if t <= start + 1e-6 else month_end(g, t)


def part_tour(days):
    """Une durée en jours de travail, en tours, pour les messages (comme partTour dans web/js/map.js)."""
    x = days / TOUR_DAYS
    return 'moins d\'un tour' if x < 0.9 else R.pl(max(1, int(x + 0.5)), 'tour')


def tours_left(g, until):
    """Dans combien de tours ce qui finit à `until` est fait (1 : au prochain tour ; 0 : déjà fait)."""
    if until <= g.t + 1e-6:
        return 0
    a, b = g.date(), g.date(until - 1e-6)
    return (b.year - a.year) * 12 + b.month - a.month + 1


# ================================================================== le tour du joueur : tout s'exécute tout de suite
def planning(g):
    """Vrai pendant le tour du joueur (tour par tour, avant « Tour suivant ») : les ordres s'exécutent aussitôt."""
    return g.tour['on'] and g.tour['end'] is None and not g.over


def march_days(g):
    """Jours de marche d'une armée par tour."""
    return round(month_days(g, month_end(g)) * MARCH_FRAC, 2)


def march_left(g, a):
    """Jours de marche qui restent à cette armée ce tour."""
    return march_days(g) if a.get('mp') is None else max(0.0, a['mp'])


def eta(g, a):
    """Dans combien de tours l'armée arrive au bout de sa route (estimation : longueur du chemin et vitesse du moment ;
    1 : au prochain tour), ou None sans route."""
    if not a['path']:
        return None
    km, x, y = 0.0, a['x'], a['y']
    for leg in a['path']:
        if leg['kind'] == 'road':
            km += g.geo.edges[leg['e']]['len'] - leg['pos']
            x, y = g.node_xy(leg['to'])
        else:
            for px, py in leg['pts'][leg['i']:]:
                km += math.hypot(px - x, py - y)
                x, y = px, py
    days = km / max(0.5, g.army_speed(a)) - (march_left(g, a) if planning(g) else 0.0)
    return max(1, math.ceil(days / march_days(g) - 1e-6))


def begin_turn(g):
    """Début du tour du joueur : les armées retrouvent tous leurs jours de marche, et celles qui avaient une longue
    route la reprennent là où elles s'étaient arrêtées."""
    for a in g.armies.values():
        a['trail'] = None
        a['mp'] = None
        a['rt'] = False
    settle(g)


def lock_reason(g):
    """Pourquoi le joueur ne peut pas donner d'ordre de marche maintenant, ou None."""
    from .tactics import bridge as TB
    if not g.tour['on'] or g.over:
        return None
    if g.tour['end'] is not None:
        return "C'est le tour des IA : vos armées ont déjà joué ce mois-ci. Attendez le mois suivant."
    if TB.frozen(g):
        return "Réglez d'abord la bataille en cours."
    return None


def march_now(g, a, days=None):
    """L'armée du joueur marche tout de suite, dans la limite de ses jours de marche (ou de `days` : retraite forcée), en
    s'arrêtant au contact de l'ennemi, devant une place à assiéger ou quand la route est finie. Le temps est virtuel : la
    date de la campagne ne bouge pas, mais délais de grâce, saisons et rencontres s'écoulent comme pendant la marche.
    Renvoie le nombre de jours de marche employés."""
    from .tactics import bridge as TB
    aid = a['id']
    mp0 = march_left(g, a)
    left = mp0 if days is None else days
    spent = 0.0
    t0 = g.t
    hot = {z: w['kind'] == 'canicule' for z, w in g.weather.items()}
    trail = [(a['x'], a['y'])]
    fought = False
    a.pop('took', None)   # (une place ralliée plus tôt ne compte que pour la marche où elle l'a été)
    try:
        for _ in range(int(40 / MARCH_STEP)):
            if left <= 1e-6 or aid not in g.armies or a['state'] not in ('move', 'retreat') or not a['path']:
                break
            dt = min(MARCH_STEP, left)
            x0, y0, n0 = a['x'], a['y'], len(a['path'])
            rem = g.move_army(a, dt)
            used = max(0.0, dt - rem)
            moved = (a['x'], a['y']) != (x0, y0) or len(a['path']) != n0
            if not moved and used <= 1e-9:
                break   # bloquée (rien ne se passe) : on n'insiste pas
            used = used if used > 1e-9 else dt
            left -= used
            spent += used
            g.t += max(used, 1e-4)
            if (a['x'], a['y']) != (x0, y0):
                trail.append((a['x'], a['y']))
            TB.army_tick(g, a, used, hot)   # la marche fatigue les hommes comme pendant le tour des IA
            g.update_hidden()
            g.detect_contacts(only=aid)
            if aid in g.armies and (a['state'] == 'battle' or a.pop('took', False)):
                fought = True   # attaquer, être arrêté au contact ou rallier une place termine la marche du tour
                break
    finally:
        g.restore_clock(t0)
        if aid in g.armies and days is None:
            a['mp'] = 0.0 if fought else round(max(0.0, mp0 - spent), 3)   # (même si la marche a échoué en chemin)
    if aid in g.armies:
        if len(trail) > TRAIL_PTS:
            k = (len(trail) - 1) / (TRAIL_PTS - 1)
            trail = [trail[round(i * k)] for i in range(TRAIL_PTS)]
        if len(trail) > 1:
            a['trail'] = [[round(x, 1), round(y, 1)] for x, y in trail]
            a['tn'] = a.get('tn', 0) + 1
    return spent


def settle(g):
    """Après un ordre du joueur : ses armées en marche partent (ou continuent) tout de suite, celles qui battent en
    retraite se replient, puis les batailles que cela a déclenchées et que le général règle seul sont réglées.
    Renvoie les jours de marche employés par armée."""
    out = {}
    if not planning(g):
        return out
    from .tactics import bridge as TB
    for a in list(g.armies.values()):
        if a['owner'] == g.player and a['state'] == 'move' and a['path'] and march_left(g, a) > 1e-6:
            if TB.frozen(g):
                break   # une bataille attend le joueur : les autres armées ne bougent pas avant qu'elle soit réglée
            out[a['id']] = march_now(g, a)
    resolve_autos(g)
    for a in list(g.armies.values()):
        if a['owner'] == g.player and a['state'] == 'retreat' and a['path'] and not a.get('rt') and not TB.frozen(g):
            march_now(g, a, RETREAT_DAYS)   # une armée en retraite se replie tout de suite, une fois par tour…
            if a['id'] in g.armies:
                a['rt'] = True
                a['mp'] = 0.0               # … et n'a plus de marche ce tour
    resolve_autos(g)
    return out


def resolve_autos(g):
    """Batailles automatiques (réglage « toujours automatique », ou choix du joueur) : réglées sur-le-champ."""
    from .tactics import bridge as TB
    if not planning(g):
        return
    for bt in list(g.battles.values()):
        if TB.is_auto(bt) and bt['id'] in g.battles:
            g.resolve_battle_now(bt)


# ================================================================== commandes
def command(g, action, value=None):
    tr = g.tour
    if action == 'mode':
        on = bool(value)
        if on == tr['on']:
            return True, None
        g.speed_idx = 0
        tr.update(on=on, end=None, stop=None, acc=None)
        for a in g.armies.values():
            a['mp'] = None
            a['trail'] = None
            a['rt'] = False
        return True, ('Tour par tour : donnez vos ordres (ils s’exécutent tout de suite), puis « Tour suivant ».' if on else
                      'Temps réel : choisissez une vitesse en haut. Le jeu est en pause.')
    if not tr['on']:
        return False, 'La partie se joue en temps réel (menu ☰, réglages avancés).'
    if g.over:
        return False, 'La partie est terminée.'
    if action == 'go':
        return go(g)
    return False, 'Commande inconnue.'


def go(g):
    """« Fin du mois » (début du déroulement) ou « Continuer le mois » (après une interruption ou un arrêt)."""
    tr = g.tour
    if g.over or not tr['on']:
        return False, 'La partie est terminée.' if g.over else 'La partie se joue en temps réel.'
    if tr['end'] is None:
        tr['end'] = month_end(g)
        tr['recap'] = None
        tr['acc'] = _new_acc(g)
    tr['stop'] = None
    # tout ce qui existe déjà (ordres donnés pendant la pause, alertes vues) n'interrompt pas le tour
    tr['seen'] = _scan(g)
    g.speed_idx = 1
    return True, None


# ================================================================== déroulement
def advance(g, real_dt):
    """Remplace Game.advance en mode tour : joue le mois aussi vite que possible, BUDGET secondes de calcul par appel
    (real_dt ne sert plus), et s'arrête pile à l'échéance ou sur une alerte."""
    from .engine import SUBSTEP
    tr = g.tour
    if g.over:
        return
    if not g.speed_idx:
        if tr['end'] is None or not _settled(g):
            return
        go(g)   # le choix est fait : le tour des IA reprend tout seul
    if tr['end'] is None:
        go(g)   # le temps lancé autrement que par « Fin du mois » (script, ancienne commande) : le mois se joue
    until = time.monotonic() + BUDGET
    while not g.over and g.speed_idx and time.monotonic() < until:
        sub = SUBSTEP if g.battles else SUBSTEP * 2
        rem = tr['end'] - g.t
        seq0 = g.seq
        if rem <= sub + 1e-6:
            # dernier pas : on franchit minuit pour que le 1er du mois se joue (revenus, bilan, sauvegarde)…
            g.step(max(rem, 0.0) + 1e-9)
            g.t = tr['end']   # … et l'on s'arrête pile au 1er, à 0 h
            watch(g, rem, seq0)
            finish(g)
            return
        g.step(sub)
        watch(g, sub, seq0)


def finish(g):
    tr = g.tour
    g.speed_idx = 0
    tr['recap'] = _recap(g)
    tr.update(end=None, stop=None, acc=None)
    for bt in list(g.battles.values()):
        # (batailles automatiques qui duraient encore au 1er du mois : réglées, pour que le tour du joueur parte net)
        from .tactics import bridge as TB
        if TB.is_auto(bt) and bt['id'] in g.battles:
            g.resolve_battle_now(bt)
    begin_turn(g)


def watch(g, dt, seq0):
    """Après chaque pas : relit le journal pour le récapitulatif, et arrête le tour des IA seulement si le joueur doit
    choisir (bataille, décision) ou si la partie est finie."""
    tr = g.tour
    if tr['acc']:
        _accumulate(g, dt)
    old = tr['seen'] or _scan(g)
    cur = _scan(g)
    tr['seen'] = cur
    cands = _candidates(g, old, cur)
    if g.over:
        cands.insert(0, dict(kind='fin', text=g.over.get('text', 'La partie est terminée.') if isinstance(g.over, dict)
                             else 'La partie est terminée.'))
    if not cands:
        if not g.speed_idx:
            g.speed_idx = 1   # un grand moment (époque, traité…) arrête le temps réel, pas le tour des IA : il va au récap
        return
    cands.sort(key=lambda c: PRIORITY.index(c['kind']))
    best = cands[0]
    g.speed_idx = 0
    tr['stop'] = dict(kind=best['kind'], text=best['text'], x=best.get('x'), y=best.get('y'), sel=best.get('sel'),
                      ev=best.get('ev'), next=[c['ev'] for c in cands[1:] if c['kind'] == 'decision'],
                      more=len(cands) - 1, date=g.date_str())
    if tr['acc']:
        tr['acc']['stops'] += 1


def _settled(g):
    """La raison de l'arrêt a disparu (bataille réglée ou jouée, décision prise) : le tour des IA peut reprendre seul.
    (Game.advance ne vient pas jusqu'ici tant qu'une bataille attend le joueur ou se livre sur le champ de bataille.)"""
    st = g.tour['stop']
    if not st or st['kind'] == 'fin' or (st['kind'] == 'decision' and not st.get('ev')):
        return False   # (partie chargée en plein tour des IA : on attend « Continuer »)
    if st['kind'] == 'decision':
        if any(x['id'] == st['ev'] for x in g.pending_ev):
            return False
        nxt = [x for x in g.pending_ev if x['id'] in st.get('next', ())]
        if nxt:   # d'autres décisions arrivées au même moment : le tour s'arrête aussi sur chacune
            x = nxt[0]
            st.update(ev=x['id'], text=f"Une décision vous attend : {x['title']}.", next=[y['id'] for y in nxt[1:]],
                      more=len(nxt) - 1)
            return False
    return True


def _scan(g):
    """Ce qui peut interrompre le tour, à cet instant (comparé d'un pas à l'autre) : les batailles qui attendent le
    choix du joueur, les décisions qui l'attendent."""
    return dict(bt=sorted(b['id'] for b in g.battles.values() if b.get('mode') == 'attente'),
                ev=[x['id'] for x in g.pending_ev])


def _candidates(g, old, cur):
    out = []
    for pid in cur['ev']:
        x = next((e for e in g.pending_ev if e['id'] == pid), None)
        if x and pid not in old['ev']:
            xy = g.node_xy(x['town']) if x.get('town') is not None else (None, None)
            out.append(dict(kind='decision', text=f"Une décision vous attend : {x['title']}.", x=xy[0], y=xy[1],
                            sel='event', ev=pid))
    for bid in cur['bt']:
        bt = g.battles.get(bid)
        if not bt or bid in old['bt']:
            continue
        owners = [s['owner'] for s in bt['sides']]
        kind = 'Embuscade' if bt.get('ambush') else ('Assaut' if bt['node'] is not None else 'Bataille')
        txt = f"{kind} {g.place_name(bt['x'], bt['y'])} : {g.fname(owners[0])} attaque {g.fname(owners[1])}."
        out.append(dict(kind='bataille', text=txt, x=bt['x'], y=bt['y'], sel=['battle', bid]))
    return out


def _where(g, x, y):
    """« près de Bazas », ou « à Bazas » quand on y est (place_name dit alors « de Bazas »)."""
    w = g.place_name(x, y)
    return w if w.startswith('près') else 'à ' + g.geo.nodes[g.nearest_node(x, y)]['name']



# ================================================================== récapitulatif du mois
def _new_acc(g):
    f = g.factions[g.player]
    return dict(t0=round(g.t, 3), date0=g.date_str(), seq=g.seq, own=[n['id'] for n in g.owned_nodes(g.player)],
                inc={r: 0.0 for r in R.RESOURCES}, res0={r: round(v, 1) for r, v in f['res'].items()},
                battles=[], built=[], techs=[], facts=[], levied=0, stops=0)


def _item(e):
    return dict(text=e['text'], x=e.get('x'), y=e.get('y'))


def _accumulate(g, dt):
    acc = g.tour['acc']
    f = g.factions[g.player]
    for r in acc['inc']:
        acc['inc'][r] += f['income'].get(r, 0.0) * dt
    if g.seq <= acc['seq']:
        return
    # seules les dernières lignes sont nouvelles (le journal est dans l'ordre) : on ne relit pas tout
    evs = g.events
    i = len(evs)
    while i > 0 and evs[i - 1]['seq'] > acc['seq']:
        i -= 1
    for e in evs[i:]:
        if e['seq'] <= acc['seq']:
            continue
        k, txt = e['kind'], e['text']
        if k == 'battle_end':
            lst, it = acc['battles'], dict(_item(e), win=e.get('win'))
        elif k == 'eco' and _BUILT.search(txt):
            lst, it = acc['built'], _item(e)
        elif k == 'armee' and txt.startswith('Régiment levé'):
            acc['levied'] += 1
            continue
        elif k == 'tech' and txt.startswith('Découverte'):
            lst, it = acc['techs'], _item(e)
        elif e.get('important') and (k in ('capitulation', 'epoque', 'revolte', 'fin', 'siege')
                                     or (k == 'diplo' and _DIPLO.search(txt))
                                     or (k == 'evenement' and 'Une décision vous attend' not in txt)):
            lst, it = acc['facts'], _item(e)
        else:
            continue
        if len(lst) < MAX_ITEMS:
            lst.append(it)
    acc['seq'] = g.seq


def _recap(g):
    acc = g.tour.get('acc')
    if not acc:
        return None
    p = g.player
    f = g.factions[p]
    before, now = set(acc['own']), {n['id'] for n in g.owned_nodes(p)}

    def places(ids):
        return [dict(id=i, name=g.geo.nodes[i]['name'], x=g.geo.nodes[i]['x'], y=g.geo.nodes[i]['y'])
                for i in sorted(ids, key=lambda i: g.geo.nodes[i]['name'])][:MAX_ITEMS]
    seen = g.visible_armies(p)[0]
    foes = []   # armées ennemies (visibles) sur vos terres au début de votre tour
    for a in g.armies.values():
        o = a['owner']
        if o == p or o not in g.factions or a['id'] not in seen or not g.at_war(o, p) or g.army_men(a) < FOE_MIN_MEN:
            continue
        nd = g.geo.node_of_cell(a['x'], a['y'])
        if nd is not None and g.nodes[nd]['owner'] == p and len(foes) < MAX_ITEMS:
            foes.append(dict(id=a['id'], x=a['x'], y=a['y'], text=f"Armée ennemie sur vos terres ({g.fname(o)}, "
                             f"{int(g.army_men(a))} hommes), {_where(g, a['x'], a['y'])}."))
    d = g.date(g.t - 1)   # le mois qui s'achève
    return dict(id=f"{g.seed}-{acc['t0']}-{round(g.t, 3)}", title=f"Bilan {R.de(R.MONTHS[d.month - 1])} {d.year}",
                period=f"du {acc['date0']} au {g.date_str()}", battles=acc['battles'], built=acc['built'],
                techs=acc['techs'], facts=acc['facts'], foes=foes, levied=acc['levied'], gained=places(now - before),
                lost=places(before - now), inc={r: round(v, 1) for r, v in acc['inc'].items()},
                res={r: round(f['res'][r] - acc['res0'].get(r, 0), 1) for r in R.RESOURCES}, stops=acc['stops'])


# ================================================================== vue
def view(g):
    tr = g.tour
    ph = phase(g)
    out = dict(on=tr['on'], phase=ph, recap=tr['recap'], march=march_days(g) if tr['on'] else None)
    if not tr['on']:
        return out
    end = tr['end'] if tr['end'] is not None else month_end(g)
    n = month_days(g, end)
    out.update(end=g.date_str(end), prog=round(max(0.0, min(1.0, (g.t - (end - n)) / n)), 4),
               stop=tr['stop'] if ph == 'arret' else None)
    return out
