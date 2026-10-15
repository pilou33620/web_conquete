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
   négocient et se battent, les travaux et les sièges avancent, les revenus tombent. Vos armées, qui ont déjà joué, restent en place (Game.paused). Tout s'arrête au 1er du mois suivant, à 0 h :
   les batailles encore en cours sont réglées, les jours de marche sont rendus (begin_turn) et c'est de nouveau à vous.

Le tour des IA s'interrompt aux moments clés pour laisser le joueur réagir, puis reprend avec « Continuer » :
- une bataille commence et concerne ses armées ou ses places, ou se livre près de lui (à vue, à moins de 25 km) ;
- une armée ennemie (150 hommes ou plus, et visible) entre sur ses terres ;
- un siège ou un blocus commence sur une de ses places, ou par une de ses armées ;
- une décision l'attend (événement historique ou local), une proposition importante (paix, alliance, soumission),
  une déclaration de guerre ;
- un grand moment arrête toujours le temps (nouvelle époque, traité, capitulation, fin de partie).
Jamais deux fois pour la même bataille, le même siège ou la même décision, et un délai minimal (en jours de jeu)
sépare deux interruptions du même genre.

Pendant le tour des IA, le journal est relu pas à pas pour préparer le récapitulatif du mois (batailles, places prises
ou perdues, constructions, découvertes, revenus), affiché au début du tour suivant.

Le temps réel d'origine (vitesses ×½ à ×30) reste disponible : tour['on'] = False.
"""
import calendar
import datetime
import re
import time

from . import rules as R

BUDGET = 0.25         # secondes de calcul du tour des IA par appel (la boucle du serveur appelle toutes les 0,1 s)
MARCH_FRAC = 1.0       # part du mois qu'une armée peut marcher pendant le tour du joueur (1 : tout le mois, comme les IA)
MARCH_STEP = 0.1       # jours : pas de la marche instantanée (rencontres examinées à chaque pas, contact à 2,6 km)
RETREAT_DAYS = 4.0     # jours de marche d'une armée battue qui se replie, tout de suite, pendant le tour du joueur
TRAIL_PTS = 90         # points gardés du trajet d'une marche, pour l'animer dans le navigateur
# délai minimal, en jours de jeu, entre deux interruptions du même genre (0 : toujours)
COOLDOWN = dict(bataille=1.5, siege=2.0, entree=4.0, diplo=1.0, guerre=0.0, decision=0.0, grand=0.0, fin=0.0)
# la même armée ennemie n'interrompt pas deux fois en 20 jours (va-et-vient sur la frontière), ni la même proposition
# du même camp en 45 jours (une IA lasse de la guerre propose la paix toutes les deux semaines)
AGAIN = dict(a=20.0, p=45.0, l=4.0)   # l : un même lieu (assauts répétés, siège qui suit la bataille) pendant 4 jours
ENTRY_MIN_MEN = 150   # un parti de moins de 150 hommes (éclaireurs, fourrageurs) n'arrête pas le temps
NEAR_KM = 25.0        # une bataille entre d'autres camps interrompt si elle se livre à moins de 25 km de vous et à vue
PRIORITY = ['fin', 'decision', 'guerre', 'grand', 'siege', 'bataille', 'entree', 'diplo']
BIG_PROPOSALS = ('paix', 'alliance', 'soumission')
MAX_ITEMS = 30        # par rubrique du récapitulatif
_DIPLO = re.compile(r"guerre|paix|alliance|trêve|soumi|vassal|traité")   # pas les accords de commerce ni les échanges
_BUILT = re.compile(r"^(Fin des travaux à |Magasin aux vivres construit à )|( terminées à | s'agrandit )")


def new_state(on=True):
    """État du tour par tour, enregistré dans la sauvegarde (Game.tour)."""
    return dict(on=on, end=None, stop=None, last={}, seen=None, mem={}, acc=None, recap=None)


def migrate(g):
    """Anciennes sauvegardes (avant le tour par tour) : elles passent au tour par tour, comme les nouvelles parties.
    Le réglage avancé du menu rend le temps réel."""
    tr = getattr(g, 'tour', None)
    if not isinstance(tr, dict):
        tr = g.tour = new_state()
    for k, v in new_state().items():
        tr.setdefault(k, v)
    if not isinstance(tr['seen'], dict) or set(tr['seen']) != {'bt', 'sg', 'inn', 'ev', 'pr', 'war'}:
        tr['seen'] = None
    tr.pop('pace', None)   # (ancien rythme du tour des IA : le mois se calcule maintenant d'un coup)
    if tr['end'] is not None and tr['end'] <= g.t - 1e-6:
        tr['end'] = None   # échéance dépassée (sauvegarde bricolée) : on attend les ordres
    for a in g.armies.values():
        a.setdefault('mp', None)


# ================================================================== calendrier
def month_end(g):
    """Échéance du tour : le 1er du mois suivant, à 0 h (en jours depuis le début de la partie)."""
    d = g.date()
    nxt = datetime.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return float(nxt.toordinal() - g.start_ord)


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
            if aid in g.armies and a['state'] == 'battle':
                fought = True   # attaquer ou être arrêté au contact termine la marche du tour
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
    if action == 'stop':
        return halt(g)
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


def halt(g):
    tr = g.tour
    if tr['end'] is None or not g.speed_idx:
        return True, None
    g.speed_idx = 0
    tr['stop'] = dict(kind='arret', text='Vous avez arrêté le temps.', x=None, y=None, date=g.date_str())
    return True, None


# ================================================================== déroulement
def advance(g, real_dt):
    """Remplace Game.advance en mode tour : joue le mois aussi vite que possible, BUDGET secondes de calcul par appel
    (real_dt ne sert plus), et s'arrête pile à l'échéance ou sur une alerte."""
    from .engine import SUBSTEP
    tr = g.tour
    if g.over or not g.speed_idx:
        return
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
    """Après chaque pas : relit le journal pour le récapitulatif et cherche une raison d'interrompre le tour."""
    tr = g.tour
    if tr['acc']:
        _accumulate(g, dt)
    old = tr['seen'] or _scan(g)
    cur = _scan(g)
    tr['seen'] = cur
    cands = _candidates(g, old, cur, seq0)
    stopped = not g.speed_idx   # un grand moment (époque, traité, décision…) a déjà arrêté le temps
    if g.over:
        cands.insert(0, dict(kind='fin', text=g.over.get('text', 'La partie est terminée.') if isinstance(g.over, dict)
                             else 'La partie est terminée.'))
    if not cands and not stopped:
        return
    # (une bataille du joueur arrête elle-même le temps, le temps de choisir : c'est elle, la raison)
    if stopped and not any(c['kind'] in ('fin', 'decision', 'bataille') for c in cands):
        # la raison d'un grand moment est la dernière nouvelle importante du journal
        ev = next((e for e in reversed(g.events) if e['seq'] > seq0 and e.get('important')), None) \
            or next((e for e in reversed(g.events) if e['seq'] > seq0), None)
        cands.append(dict(kind='grand', text=ev['text'] if ev else 'Le temps s’arrête.',
                          x=ev.get('x') if ev else None, y=ev.get('y') if ev else None))
    cands.sort(key=lambda c: PRIORITY.index(c['kind']))
    best = cands[0]
    if not stopped and g.t - tr['last'].get(best['kind'], -1e9) < COOLDOWN[best['kind']]:
        # trop tôt après une interruption du même genre : on cherche une autre raison, sinon on continue
        best = next((c for c in cands if g.t - tr['last'].get(c['kind'], -1e9) >= COOLDOWN[c['kind']]), None)
        if best is None:
            return
    tr['last'][best['kind']] = round(g.t, 3)
    g.speed_idx = 0
    tr['stop'] = dict(kind=best['kind'], text=best['text'], x=best.get('x'), y=best.get('y'),
                      sel=best.get('sel'), more=len(cands) - 1, date=g.date_str())
    if tr['acc']:
        tr['acc']['stops'] += 1


def _scan(g):
    """Ce qui peut interrompre le tour, à cet instant (comparé d'un pas à l'autre)."""
    p = g.player
    sieges = []
    for n in g.nodes:
        s = n['siege']
        if s and not s.get('occupy') and (n['owner'] == p or s['by'] == p):
            sieges.append(f"{n['id']}:{s['by']}:{'b' if s.get('blocus') else 's'}")
    inside = []
    for a in g.armies.values():
        o = a['owner']
        if o == p or o not in g.factions or not g.at_war(o, p) or not a['regs']:
            continue
        nd = g.geo.node_of_cell(a['x'], a['y'])
        if nd is not None and g.nodes[nd]['owner'] == p:
            inside.append(a['id'])
    return dict(bt=sorted(g.battles), sg=sieges, inn=inside, ev=[x['id'] for x in g.pending_ev],
                pr=[x['id'] for x in g.proposals],
                war=[c for c in g.factions if c != p and g.factions[c]['alive'] and g.at_war(c, p)])


def _candidates(g, old, cur, seq0):
    p = g.player
    out = []
    new = {}
    for k in cur:
        before = set(old.get(k, ()))
        new[k] = [v for v in cur[k] if v not in before]
    for pid in new['ev']:
        x = next((e for e in g.pending_ev if e['id'] == pid), None)
        if x:
            xy = g.node_xy(x['town']) if x.get('town') is not None else (None, None)
            out.append(dict(kind='decision', text=f"Une décision vous attend : {x['title']}.", x=xy[0], y=xy[1],
                            sel='event'))
    for c in new['war']:
        ev = next((e for e in reversed(g.events) if e['seq'] > seq0 and e['kind'] == 'diplo' and 'guerre' in e['text']
                   and g.fname(c) in e['text']), None)
        out.append(dict(kind='guerre', text=ev['text'] if ev else f"Vous voici en guerre avec {g.fname(c)} !"))
    mem = g.tour['mem']
    for k in list(mem):
        if g.t - mem[k] > AGAIN[k[0]] or (k[0] == 'a' and k[2:] not in g.armies):
            del mem[k]
    for pid in new['pr']:
        x = next((e for e in g.proposals if e['id'] == pid), None)
        if x and x['action'] in BIG_PROPOSALS and f"p:{x['frm']}:{x['action']}" not in mem:
            mem[f"p:{x['frm']}:{x['action']}"] = round(g.t, 2)
            what = dict(paix='vous propose la paix', alliance='vous propose une alliance',
                        soumission='exige votre soumission')[x['action']]
            out.append(dict(kind='diplo', text=f"{g.fname(x['frm'])} {what}."))
    for key in new['sg']:
        nid, by, kind = key.split(':')
        nid = int(nid)
        gn = g.geo.nodes[nid]
        if not _fresh_place(g, nid):
            continue
        if by == p:
            txt = f"Vos troupes {'bloquent' if kind == 'b' else 'assiègent'} {gn['name']}."
        else:
            txt = f"{'Blocus' if kind == 'b' else 'Siège'} {R.de(gn['name'])} par {g.fname(by)} !"
        out.append(dict(kind='siege', text=txt, x=gn['x'], y=gn['y'], sel=['node', nid]))
    if new['bt']:
        vis = None
        for bid in new['bt']:
            bt = g.battles.get(bid)
            if not bt:
                continue
            owners = [s['owner'] for s in bt['sides']]
            # vos armées ou vos places ; les batailles de vos alliés et des autres, seulement près de vous et à vue
            mine = p in owners or (bt['node'] is not None and g.nodes[bt['node']]['owner'] == p)
            if not mine:
                if vis is None:
                    vis = g.vision_sources(p)[1]
                if not _near(g, bt['x'], bt['y'], vis):
                    continue
            if not _fresh_place(g, bt['node'] if bt['node'] is not None else g.nearest_node(bt['x'], bt['y'])):
                continue
            kind = 'Embuscade' if bt.get('ambush') else ('Assaut' if bt['node'] is not None else 'Bataille')
            txt = f"{kind} {g.place_name(bt['x'], bt['y'])} : {g.fname(owners[0])} attaque {g.fname(owners[1])}."
            out.append(dict(kind='bataille', text=txt, x=bt['x'], y=bt['y'], sel=['battle', bid]))
    fresh = [aid for aid in new['inn'] if 'a:' + aid not in mem and g.army_men(g.armies[aid]) >= ENTRY_MIN_MEN]
    if fresh:
        seen = g.visible_armies(p)[0]
        for aid in fresh:
            if aid not in seen:
                # une armée cachée (embuscade, brouillard) ne se trahit pas : on la guettera au pas suivant
                cur['inn'].remove(aid)
                continue
            mem['a:' + aid] = round(g.t, 2)
            a = g.armies[aid]
            out.append(dict(kind='entree', text=f"Une armée ennemie ({g.fname(a['owner'])}, {int(g.army_men(a))} hommes) "
                            f"entre sur vos terres, {_where(g, a['x'], a['y'])}.", x=a['x'], y=a['y'], sel=['army', aid]))
    return out


def _fresh_place(g, nid):
    """Un lieu n'interrompt qu'une fois en quelques jours : assauts répétés, siège qui suit la bataille."""
    k = f'l:{nid}'
    if k in g.tour['mem']:
        return False
    g.tour['mem'][k] = round(g.t, 2)
    return True


def _where(g, x, y):
    """« près de Bazas », ou « à Bazas » quand on y est (place_name dit alors « de Bazas »)."""
    w = g.place_name(x, y)
    return w if w.startswith('près') else 'à ' + g.geo.nodes[g.nearest_node(x, y)]['name']


def _near(g, x, y, vis):
    """Une bataille d'autres camps qui se livre à vue et près de vos places ou de vos armées."""
    if not any((x - vx) ** 2 + (y - vy) ** 2 <= r * r for vx, vy, r in vis):
        return False
    pts = [g.node_xy(n['id']) for n in g.owned_nodes(g.player)]
    pts += [(a['x'], a['y']) for a in g.armies.values() if a['owner'] == g.player]
    return any((x - px) ** 2 + (y - py) ** 2 <= NEAR_KM * NEAR_KM for px, py in pts)


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
                                     or (k == 'diplo' and _DIPLO.search(txt) and 'répondez' not in txt)
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
    d = g.date(g.t - 1)   # le mois qui s'achève
    return dict(id=f"{g.seed}-{acc['t0']}-{round(g.t, 3)}", title=f"Bilan {R.de(R.MONTHS[d.month - 1])} {d.year}",
                period=f"du {acc['date0']} au {g.date_str()}", battles=acc['battles'], built=acc['built'],
                techs=acc['techs'], facts=acc['facts'], levied=acc['levied'], gained=places(now - before),
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
