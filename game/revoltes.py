"""Révoltes, brigands et partisans (SPEC-RELIGION.md, décisions 9 à 23) : des bandes armées posées sur les places,
qui ne sont pas des armées. Elles naissent de l'ordre public trop bas (insurgés), de la misère des campagnes
(brigands) ou de l'occupation (partisans) ; elles prennent des places (jamais un chef-lieu), pillent ou harcèlent ;
le camp les écrase avec une armée, les saigne avec ses garnisons, les apaise ou les amnistie ; l'ennemi les soutient.

    g.bandes = [dict(id, k, n, node, c, sp, why, nom, t0)]
      k     genre : 'rebelles' (insurgés), 'brigands', 'partisans'
      n     hommes ; node : la place où elle se tient
      c     camp visé (qu'elle combat ou pille) ; sp : camp qui la soutient (None)
      why   cause : impots, famine, guerre, religion, occupation, misere ; nom : son nom au journal
    a['chasse']   (IA) l'armée chasse cette bande : la réflexion militaire la laisse faire
"""
import math

from . import rules as R
from . import events as EV
from . import religion as RG
from .geo import TERRAIN

GENRES = {
    'rebelles': dict(nom='insurgés', puiss=0.5, max=3),
    'brigands': dict(nom='brigands', puiss=0.6, max=1),
    'partisans': dict(nom='partisans', puiss=0.8, max=2),
}
CAUSES = dict(impots="écrasée d'impôts", famine='affamée', guerre='lasse de la guerre', religion='persécutée pour sa foi',
              occupation="dressée contre l'occupant", misere='misérable')
INSURRECTION_STAB = 0.30   # sous cet ordre public, une place peut se soulever même avec une garnison
INSURRECTION_P = 0.5       # chance par mois et par place : (seuil − ordre public) × ceci
DISPERSE = 60              # sous ce nombre d'hommes, une bande se disperse
APAISER_L = 0.8            # livres par insurgé pour les apaiser
AMNISTIE_L = 0.5           # livres par brigand pour une amnistie (la moitié s'engage)
SOUTIEN = dict(livres=150, armes=50)
LEVER = dict(livres=120, armes=40)
LEVER_N = 250
BRIGANDS_P = 0.025         # chance par mois qu'une bande de brigands naisse chez un camp (avant guerre et famine)
PARTISANS_P = 0.04         # par mois et par place occupée, × (1 − ordre public)
CHASSE_JOURS = 45          # une armée de l'IA ne chasse pas une bande plus longtemps
CAV_K = 0.8                # la cavalerie chasse les bandes : puissance × (1 + 0,8 × part de cavalerie)
SOULEVER_STAB = 0.7

R.SPY.setdefault('soulever', dict(label='Soulever la population', cost=200, chance=0.5,
                                  desc="En guerre seulement : fait naître une bande d'insurgés si l'ordre public y est "
                                       "sous 70 %."))


# ------------------------------------------------------------------ carte
_VOIS = {}
_TERR = {}


def voisins(g, nid):
    """Places reliées à celle-ci par une route (calculé une fois par carte)."""
    v = _VOIS.get(id(g.geo))
    if v is None:
        v = _VOIS[id(g.geo)] = {}
        for e in g.geo.edges:
            v.setdefault(e['a'], []).append(e['b'])
            v.setdefault(e['b'], []).append(e['a'])
    return v.get(nid, ())


def terrain(g, nid):
    """Le pays autour d'une place (la place elle-même est souvent bâtie en plaine) : le plus sauvage à 3 km."""
    k = (id(g.geo), nid)
    t = _TERR.get(k)
    if t is None:
        gn = g.geo.nodes[nid]
        names = {TERRAIN[g.geo.terrain_at(gn['x'] + dx, gn['y'] + dy)][0]
                 for dx, dy in ((0, 0), (3, 0), (-3, 0), (0, 3), (0, -3))}
        t = _TERR[k] = next((x for x in ('Haute montagne', 'Montagne', 'Collines', 'Forêt', 'Marais', 'Lande') if x in names),
                            'Plaine')
    return t


def terrain_k(g, nid):
    t = terrain(g, nid)
    return 1.5 if t in ('Haute montagne', 'Montagne', 'Collines') else 1.3 if t in ('Forêt', 'Marais') else 1.0


def sauvage(g, nid):
    return terrain(g, nid) != 'Plaine'


# ------------------------------------------------------------------ bandes
def init(g):
    if not hasattr(g, 'bandes') or g.bandes is None:
        g.bandes = []


def puissance(g, b):
    return b['n'] * GENRES[b['k']]['puiss'] * terrain_k(g, b['node']) * (1.2 if b.get('sp') else 1.0)


def par_place(g):
    return {b['node']: b for b in getattr(g, 'bandes', ())}


def compte(g, k, c, sp=None):
    return sum(1 for b in g.bandes if b['k'] == k and b['c'] == c and (sp is None or b.get('sp') == sp))


def _nom(g, k, nid, why):
    v = g.geo.nodes[nid]['name']
    if k == 'brigands':
        return f"les brigands {R.de(v)}"
    if k == 'partisans':
        return f"les partisans {R.de(v)}"
    if why == 'religion':
        return f"les camisards {R.de(v)}" if g.date().year < 1760 else f"les insurgés {R.de(v)}"
    if why == 'famine':
        return f"la jacquerie {R.de(v)}"
    return f"les insurgés {R.de(v)}"


def _imp(g, b):
    return g.player in (b['c'], b.get('sp'))


def naitre(g, k, nid, n, c, why='misere', nom=None, sp=None):
    """Une bande naît sur une place ; renvoie la bande (None : déjà une bande sur cette place)."""
    if any(b['node'] == nid for b in g.bandes):
        return None
    b = dict(id=g.nid('b'), k=k, n=float(int(n)), node=nid, c=c, sp=sp, why=why, nom=nom or _nom(g, k, nid, why), t0=g.t)
    g.bandes.append(b)
    gn = g.geo.nodes[nid]
    what = {'rebelles': f"Insurrection à {gn['name']} : la population, {CAUSES.get(why, 'misérable')}, prend les armes",
            'brigands': f"Des brigands tiennent la campagne autour {R.de(gn['name'])}",
            'partisans': f"Des partisans prennent le maquis autour {R.de(gn['name'])}"}[k]
    if _imp(g, b):
        g.log('revolte', f"{what} ({R.nb(b['n'])} hommes, {b['nom']}).", gn['x'], gn['y'], who=c, important=True)
    return b


def fin(g, b, texte=None):
    if b in g.bandes:
        g.bandes.remove(b)
    for a in g.armies.values():
        if a.get('chasse') == b['id']:
            a.pop('chasse', None)
    if texte and _imp(g, b):
        gn = g.geo.nodes[b['node']]
        g.log('revolte', texte, gn['x'], gn['y'], who=b['c'], important=True)


def cause(g, n):
    """Pourquoi une place gronde (la plus lourde des raisons)."""
    f = g.factions[n['owner']]
    gn = g.geo.nodes[n['id']]
    if RG.stab_bonus(g, n) < -0.05:
        return 'religion'
    if f.get('famine'):
        return 'famine'
    if gn['dept'] != n['owner'] and n.get('assim', 1.0) < 0.5:
        return 'occupation'
    if f.get('weary', 0) > 50:
        return 'guerre'
    if f.get('tax', 0.5) > 0.6:
        return 'impots'
    return 'misere'


def menace(g, n, held=()):
    """Menace de révolte d'une de vos places : (niveau, cause) ou None (décision 24)."""
    gn = g.geo.nodes[n['id']]
    if gn['type'] == 'capitale' or n['stab'] >= 0.6:
        return None
    lvl = 'imminente' if n['stab'] < INSURRECTION_STAB else \
        'forte' if n['stab'] < 0.45 and not n['garrison'] and n['id'] not in held else 'faible'
    return [lvl, CAUSES[cause(g, n)]]


def _saigner(g, a, frac, moral=0.0):
    for r in a['regs']:
        r['n'] *= 1 - frac
        r['morale'] = max(5, r['morale'] - moral)
    g.prune(a)
    if not a['regs'] and a['state'] != 'battle':
        g.armies.pop(a['id'], None)


def _hostile(g, a, b):
    o = a['owner']
    return o == b['c'] or (b['c'] in g.factions and g.friendly(o, b['c']))


def combat(g, a, b):
    """Une armée arrêtée sur la place d'une bande la combat (décision 13)."""
    gn = g.geo.nodes[b['node']]
    tname = terrain(g, b['node'])
    men = sum(r['n'] for r in a['regs']) or 1.0
    cav = sum(r['n'] for r in a['regs'] if R.UNITS[r['type']]['cls'] == 'cavalerie') / men
    pa = g.army_power(a, tname) * (1 + CAV_K * cav)
    pb = max(1.0, puissance(g, b))
    ratio = pa / pb
    nom = b['nom'][0].upper() + b['nom'][1:]
    if ratio >= 1:
        tues = min(b['n'], b['n'] * 0.45 * ratio)
        _saigner(g, a, min(0.08, 0.08 * pb / pa))
        b['n'] -= tues
        if b['n'] < DISPERSE:
            txt = f"{nom} sont écrasés par la {a['name']} près {R.de(gn['name'])}."
            fin(g, b)
        else:
            txt = f"La {a['name']} disperse {b['nom']} près {R.de(gn['name'])} : {R.nb(tues)} hommes tués ou pris, le " \
                  f"reste s'enfuit."
            dest = [x for x in voisins(g, b['node']) if not any(c['node'] == x for c in g.bandes)]
            if dest:
                b['node'] = g.rng.choice(dest)
        a.pop('chasse', None)
    else:
        _saigner(g, a, 0.06, moral=10)
        b['n'] *= 0.85
        txt = f"La {a['name']} se heurte à {b['nom']} près {R.de(gn['name'])} et doit reculer."
    if g.player in (a['owner'], b['c'], b.get('sp')):
        g.log('revolte', txt, gn['x'], gn['y'], who=a['owner'], important=True)


def quotidien(g):
    """Chaque jour : les armées arrêtées sur la place d'une bande la combattent."""
    if not RG.ACTIF or not g.bandes:
        return
    lieux = par_place(g)
    for a in list(g.armies.values()):
        b = lieux.get(a['at_node'])
        if b is None or a['state'] not in ('idle', 'siege') or a.get('boat') or not _hostile(g, a, b) or b not in g.bandes:
            continue
        combat(g, a, b)
        lieux = par_place(g)


# ------------------------------------------------------------------ chaque mois
def _garnisons(g, b):
    """Contre-guérilla passive (décision 12) : la part de la bande que saignent les garnisons alentour."""
    c = b['c']
    tot = 0.0
    for nid in (b['node'], *voisins(g, b['node'])):
        n = g.nodes[nid]
        if n['owner'] == c or (c in g.factions and n['owner'] in g.factions and g.friendly(n['owner'], c)):
            tot += sum(r['n'] * (2 if R.UNITS[r['type']]['cls'] == 'cavalerie' else 1) for r in n['garrison'])
    if c in g.factions and 'gendarmerie' in g.factions[c]['techs']:
        tot *= 1.5
    return min(0.5, tot / (4 * max(1.0, b['n'])))


def _defense(g, nid):
    return g.node_defense_power(nid)


def _rebelles(g, b):
    n = g.nodes[b['node']]
    gn = g.geo.nodes[b['node']]
    c = b['c']
    if n['owner'] == c and gn['type'] != 'capitale' and not n['siege']:
        if puissance(g, b) > _defense(g, b['node']):
            home = gn['dept']
            back = home != c and home in g.factions and g.factions[home]['alive']
            n.update(owner=home if back else R.NEUTRAL, assim=1.0, depot=0, milice=n['milice_max'] * 0.6, stab=0.7,
                     queue=[], garrison=[])
            g._own_ver = getattr(g, '_own_ver', 0) + 1   # (cache des places de chaque camp, Game.owned_nodes)
            g._dirty_income = True
            b['n'] *= 0.8
            if _imp(g, b) or g.player == home:
                g.log('revolte', f"{b['nom'][0].upper() + b['nom'][1:]} s'emparent {R.de(gn['name'])} et chassent "
                                 f"les autorités ({g.fname(c)})" + (f" : la ville retourne à {g.fname(home)}." if back else "."),
                      gn['x'], gn['y'], who=c, important=True)
        else:
            b['n'] *= 0.7
    # marche vers la place voisine du camp visé la moins bien défendue (jamais un chef-lieu)
    occ = {x['node'] for x in g.bandes}
    cands = [x for x in voisins(g, b['node']) if g.nodes[x]['owner'] == c and x not in occ
             and g.geo.nodes[x]['type'] != 'capitale' and not g.nodes[x]['siege']]
    if cands:
        b['node'] = min(cands, key=lambda x: _defense(g, x) * (1.2 - g.nodes[x]['stab']) ** -1)


def _pille(g, b):
    n = g.nodes[b['node']]
    c = n['owner']
    if c not in g.factions:
        return
    b['c'] = c
    f = g.factions[c]
    vol = 0.3 * b['n']
    f['res']['livres'] = max(min(f['res']['livres'], 0.0), f['res']['livres'] - vol)
    until = g.t + 30
    for nid in (b['node'], *voisins(g, b['node'])):
        m = g.nodes[nid]
        if m['owner'] == c and g.geo.nodes[nid]['type'] != 'capitale':   # (le chef-lieu a sa maréchaussée)
            m['tm'] = [e for e in m.get('tm') or () if e.get('src') != 'brigands'] + \
                [dict(k='livres', v=-0.4, until=until, src='brigands')]
    gn = g.geo.nodes[b['node']]
    for a in g.armies.values():
        if a['owner'] == c and math.hypot(a['x'] - gn['x'], a['y'] - gn['y']) < 15:
            a['supply'] = max(0.0, a['supply'] - 0.15)
    g._dirty_income = True
    if c == g.player:
        g.log('revolte', f"{b['nom'][0].upper() + b['nom'][1:]} pillent les convois et les marchés : {R.nb(vol)} livres "
                         f"perdues, commerce des environs −40 % pour un tour.", gn['x'], gn['y'], who=c)


def _harcele(g, b):
    c = b['c']
    gn = g.geo.nodes[b['node']]
    for a in list(g.armies.values()):
        if a['owner'] == c and math.hypot(a['x'] - gn['x'], a['y'] - gn['y']) < 25 and a['state'] != 'battle':
            a['supply'] = max(0.0, a['supply'] - 0.3)
            _saigner(g, a, 0.02)
    n = g.nodes[b['node']]
    if n['owner'] == c:
        for r in n['garrison']:
            r['n'] *= 0.95
        n['tm'] = [e for e in n.get('tm') or () if e.get('src') != 'partisans'] + \
            [dict(k='prod', v=-0.5, until=g.t + 30, src='partisans')]
        g._dirty_income = True


def _marche(g, b, ok, poids=None):
    occ = {x['node'] for x in g.bandes}
    cands = [x for x in voisins(g, b['node']) if x not in occ and ok(x)]
    if cands:
        b['node'] = g.rng.choices(cands, [poids(x) for x in cands] if poids else None)[0]


def mensuel(g):
    """Chaque mois (Game.monthly) : les bandes agissent, grossissent ou fondent ; il en naît d'autres."""
    if not RG.ACTIF:
        return
    init(g)
    for b in list(g.bandes):
        cf = g.factions.get(b['c'])
        if cf is None or not cf['alive']:
            fin(g, b)
            continue
        if b['k'] == 'partisans' and not (b.get('sp') in g.factions and g.at_war(b['c'], b['sp'])):
            fin(g, b, f"La paix revenue, {b['nom']} rentrent chez eux.")
            continue
        n = g.nodes[b['node']]
        b['n'] *= 1 - _garnisons(g, b)
        if b['k'] == 'rebelles':
            b['n'] *= 1.10 if n['stab'] < 0.5 and n['owner'] == b['c'] else 0.85
            _rebelles(g, b)
        elif b['k'] == 'brigands':
            f = g.factions.get(n['owner'])
            dur = f is not None and (f.get('famine') or any(g.at_war(n['owner'], o) for o in g.factions
                                                             if o != n['owner'] and g.factions[o]['alive']))
            b['n'] *= 1.05 if dur else 0.9
            _pille(g, b)
            if g.rng.random() < 0.5:
                _marche(g, b, lambda x: g.nodes[x]['owner'] in g.factions, lambda x: 3 if sauvage(g, x) else 1)
        else:
            b['n'] *= 1.05
            _harcele(g, b)
            _marche(g, b, lambda x: g.nodes[x]['owner'] == b['c'] and g.geo.nodes[x]['dept'] == b['sp'])
        if b in g.bandes and b['n'] < DISPERSE:
            fin(g, b, f"{b['nom'][0].upper() + b['nom'][1:]} se dispersent.")
    _naissances(g)


def _naissances(g):
    """Insurrections, brigands et partisans du mois (décisions 9, 16, 18)."""
    rng = g.rng
    places = {}
    for n in g.nodes:
        if n['owner'] in g.factions:
            places.setdefault(n['owner'], []).append(n)
    occ = {b['node'] for b in g.bandes}
    for code, mine in places.items():
        f = g.factions[code]
        if not f['alive']:
            continue
        # insurrection : une au plus par camp et par mois
        if compte(g, 'rebelles', code) < GENRES['rebelles']['max']:
            k = 1 + g.mod(code, 'revolt')
            for n in mine:
                if n['stab'] >= INSURRECTION_STAB or n['siege'] or n['id'] in occ \
                        or g.geo.nodes[n['id']]['type'] == 'capitale':
                    continue
                if rng.random() < (INSURRECTION_STAB - n['stab']) * INSURRECTION_P * k:
                    men = max(80, min(1200, n.get('pop', 0) * 0.012 * (1 + 3 * (INSURRECTION_STAB - n['stab']))))
                    naitre(g, 'rebelles', n['id'], men, code, cause(g, n))
                    occ.add(n['id'])
                    break
        # brigands
        if compte(g, 'brigands', code) < GENRES['brigands']['max']:
            wars = any(g.at_war(code, o) for o in g.factions if o != code and g.factions[o]['alive'])
            avg = sum(n['stab'] for n in mine) / len(mine)
            p = BRIGANDS_P * (1 + 1.5 * wars + 1.5 * bool(f.get('famine')) + 2 * max(0.0, 0.7 - avg))
            if 'gendarmerie' in f['techs']:
                p *= 0.5
            if rng.random() < p:
                vil = [n for n in mine if g.geo.nodes[n['id']]['type'] != 'capitale' and not n['garrison']
                       and n['id'] not in occ]
                if vil:
                    n = rng.choices(vil, [(3 if sauvage(g, n['id']) else 1) * (3 if g.geo.nodes[n['id']]['type'] == 'village'
                                                                              else 1) for n in vil])[0]
                    naitre(g, 'brigands', n['id'], rng.randint(60, 200), code, 'misere')
                    occ.add(n['id'])
        # partisans dans les places occupées
        for n in mine:
            home = g.geo.nodes[n['id']]['dept']
            if home == code or n['id'] in occ or n.get('assim', 1.0) >= 0.5 or home not in g.factions \
                    or not g.factions[home]['alive'] or not g.at_war(code, home):
                continue
            if compte(g, 'partisans', code, home) < GENRES['partisans']['max'] \
                    and rng.random() < PARTISANS_P * (1 - n['stab']):
                naitre(g, 'partisans', n['id'], rng.randint(80, 300), code, 'occupation', sp=home)
                occ.add(n['id'])


# ------------------------------------------------------------------ actions
def _bande(g, bid):
    return next((b for b in g.bandes if b['id'] == bid), None)


def _payer(g, code, cost):
    r = g.factions[code]['res']
    if any(r.get(k, 0) < v for k, v in cost.items()):
        return False
    for k, v in cost.items():
        r[k] -= v
    return True


def prix(b):
    """Ce que coûte l'apaisement (insurgés) ou l'amnistie (brigands) de cette bande."""
    return round(b['n'] * (APAISER_L if b['k'] == 'rebelles' else AMNISTIE_L))


def apaiser(g, code, bid):
    """Apaiser des insurgés ou amnistier des brigands qui vous visent (décisions 14 et 17)."""
    b = _bande(g, bid)
    if not b:
        return False, "Bande introuvable."
    if b['c'] != code or b['k'] == 'partisans':
        return False, "Seul le camp visé peut apaiser des insurgés ou amnistier des brigands ; les partisans se combattent."
    if not _payer(g, code, dict(livres=prix(b))):
        return False, f"Il faut {prix(b)} livres."
    gn = g.geo.nodes[b['node']]
    if b['k'] == 'brigands':
        g.add_recrues(code, b['n'] * 0.5)
        fin(g, b)
        msg = f"Amnistie : {b['nom']} rendent les armes ; {R.nb(b['n'] * 0.5)} d'entre eux s'engagent."
    else:
        for nid in (b['node'], *voisins(g, b['node'])):
            n = g.nodes[nid]
            if n['owner'] == code:
                n['stab'] = min(1.0, n['stab'] + 0.10)
                if b['why'] == 'religion':
                    n['rgb'] = [0.10, g.t + RG.APAISE_JOURS]   # concession aux réformés de la région
        fin(g, b)
        msg = f"Concessions : {b['nom']} déposent les armes ; les places alentour se calment."
    if code == g.player:
        g.log('revolte', msg, gn['x'], gn['y'], who=code, important=True)
    return True, msg


def soutenir(g, code, bid):
    """Soutenir des insurgés ou des partisans chez un camp en guerre avec soi (décision 20)."""
    b = _bande(g, bid)
    if not b:
        return False, "Bande introuvable."
    if b['k'] == 'brigands' or b['c'] == code or b['c'] not in g.factions or not g.at_war(code, b['c']):
        return False, "On ne soutient que des insurgés ou des partisans chez un camp en guerre avec vous."
    if not _payer(g, code, SOUTIEN):
        return False, f"Il faut {SOUTIEN['livres']} livres et {SOUTIEN['armes']} armes."
    b['n'] *= 1.4
    b['sp'] = code
    rel = g.factions[b['c']]['rel']
    rel[code] = max(-100, rel[code] - 10)
    gn = g.geo.nodes[b['node']]
    if g.player in (code, b['c']):
        g.log('revolte', f"{g.fname(code)} arme {b['nom']} ({R.nb(b['n'])} hommes).", gn['x'], gn['y'], who=code,
              important=True)
    return True, f"Vous armez {b['nom']} : {R.nb(b['n'])} hommes."


def peut_lever(g, code, nid):
    n = g.nodes[nid]
    o = n['owner']
    if g.geo.nodes[nid]['dept'] != code or o == code or o not in g.factions or not g.at_war(code, o):
        return "On lève des partisans dans une de ses places d'origine occupée par un ennemi."
    if any(b['node'] == nid for b in g.bandes):
        return "Une bande tient déjà cette place."
    return None


def lever(g, code, nid):
    """Lever des partisans dans une de ses places d'origine occupée par l'ennemi (décision 19)."""
    why = peut_lever(g, code, nid)
    if why:
        return False, why
    if not _payer(g, code, LEVER):
        return False, f"Il faut {LEVER['livres']} livres et {LEVER['armes']} armes."
    b = naitre(g, 'partisans', nid, LEVER_N, g.nodes[nid]['owner'], 'occupation', sp=code)
    return True, f"{b['nom'][0].upper() + b['nom'][1:]} prennent le maquis ({LEVER_N} hommes)."


def fomenter(g, code, nid):
    """Mission d'espion réussie « Soulever la population » (décision 20)."""
    n = g.nodes[nid]
    gn = g.geo.nodes[nid]
    o = n['owner']
    if n['stab'] >= SOULEVER_STAB or gn['type'] == 'capitale' or o not in g.factions:
        if code == g.player:
            g.log('espion', f"Votre agent n'a pas pu soulever {gn['name']} : la population reste fidèle.", gn['x'], gn['y'])
        return
    n['stab'] = max(0.0, n['stab'] - 0.1)
    b = naitre(g, 'rebelles', nid, max(80, min(600, n.get('pop', 0) * 0.01)), o, cause(g, n), sp=code)
    if code == g.player:
        g.log('espion', f"Votre agent a soulevé {gn['name']}" + (f" : {b['nom']} prennent les armes." if b else "."),
              gn['x'], gn['y'], who=code, important=True)


def commande(g, code, v):
    """Commande du joueur : {action: apaiser | soutenir, id} ou {action: lever, node}."""
    if not isinstance(v, dict):
        return False, "Commande invalide."
    act = v.get('action')
    if act == 'apaiser':
        return apaiser(g, code, str(v.get('id')))
    if act == 'soutenir':
        return soutenir(g, code, str(v.get('id')))
    if act == 'lever' and isinstance(v.get('node'), int) and g.valid_node(v['node']):
        return lever(g, code, v['node'])
    return False, "Commande inconnue."


# ------------------------------------------------------------------ IA
def chasse(g, a):
    """L'armée chasse une bande encore en vie : la réflexion militaire de l'IA la laisse faire."""
    bid = a.get('chasse')
    if bid is None:
        return False
    b = next((b for b in g.bandes if b['id'] == bid), None)
    # (une bande qui a passé chez un autre camp, ou une chasse qui traîne : l'armée retourne à la guerre)
    if a['state'] == 'battle' or b is None or b['c'] != a['owner'] or g.t > a.get('chasse_t', 0):
        a.pop('chasse', None)
        return False
    return True


def ia(ai):
    """Tous les dix jours (AI.step) : politique religieuse (chaque année), chasse et apaisement des bandes, soutien
    des révoltes chez l'ennemi et partisans (décisions 21 à 23)."""
    g, code = ai.g, ai.code
    if not RG.ACTIF:
        return
    if g.t >= getattr(ai, 'rg_clock', 0):
        ai.rg_clock = g.t + 365
        RG.ia_culte(g, code, ai.pers['aggr'] > 0.6)
    if g.t < getattr(ai, 'rv_clock', 0):
        return
    ai.rv_clock = g.t + 10
    init(g)
    f = ai.f
    reserve = ai.reserve()
    libres = [a for a in g.armies.values() if a['owner'] == code and a['state'] == 'idle' and not a.get('boat')
              and not a.get('chasse')]
    for b in sorted((b for b in g.bandes if b['c'] == code), key=lambda b: (b['k'] != 'rebelles', -b['n'])):
        gn = g.geo.nodes[b['node']]
        chasseurs = [a for a in g.armies.values() if a.get('chasse') == b['id'] and chasse(g, a)]
        if chasseurs:
            for a in chasseurs:   # la bande a bougé : on la suit
                if a['state'] == 'idle' and a['at_node'] != b['node'] and not ai.go(a, b['node']):
                    a.pop('chasse', None)
            continue
        pb = puissance(g, b) * 1.3
        best = None
        for a in libres:
            d = math.hypot(a['x'] - gn['x'], a['y'] - gn['y'])
            if d < 120 and g.army_power(a) > pb and (best is None or d < best[0]):
                best = (d, a)
        if best and ai.go(best[1], b['node']):
            best[1]['chasse'], best[1]['chasse_t'] = b['id'], g.t + CHASSE_JOURS
            libres.remove(best[1])
        elif b['k'] != 'partisans' and f['res']['livres'] > 2 * prix(b) + reserve \
                and (b['k'] == 'brigands' or g.nodes[b['node']]['owner'] == code):
            apaiser(g, code, b['id'])
    # en tirer parti : soutenir les révoltes chez l'ennemi, lever des partisans, soulever ses places
    wars = ai.wars()
    if not wars or f['res']['livres'] < 1500 + reserve or ai.rng.random() > 0.2:
        return
    cands = [b for b in g.bandes if b['c'] in wars and b['k'] != 'brigands' and not b.get('sp')]
    if cands:
        soutenir(g, code, max(cands, key=lambda b: b['n'])['id'])
        return
    for n in g.nodes:
        if n['owner'] in wars and peut_lever(g, code, n['id']) is None:
            lever(g, code, n['id'])
            return
    cibles = [n for n in g.nodes if n['owner'] in wars and n['stab'] < 0.6
              and g.geo.nodes[n['id']]['type'] in ('ville', 'village')]
    if cibles:
        g.spy(code, min(cibles, key=lambda n: n['stab'])['id'], 'soulever')


# ------------------------------------------------------------------ vues
def vue(g, b):
    return dict(id=b['id'], k=b['k'], n=int(round(b['n'], -1)), c=b['c'], sp=b.get('sp'), why=CAUSES.get(b['why'], ''),
                nom=b['nom'], prix=prix(b))


def rules_payload():
    return dict(genres={k: v['nom'] for k, v in GENRES.items()}, soutien=SOUTIEN, lever=LEVER, lever_n=LEVER_N)


# ------------------------------------------------------------------ événements (décisions 7, 8 et 15)
def _b(n, why='misere', k='rebelles', nom=None):
    return dict(k=k, n=n, why=why, **({'nom': nom} if nom else {}))


def _reformes(g, code):
    """Le camp a-t-il des réformés (plus de 2 % de ses habitants) ?"""
    return RG.vue(g, code)['part'] > 0.02


def _contraint(g, code):
    return g.factions[code].get('culte') in ('contrainte', 'dragonnades') and _reformes(g, code)


HIST = [
    dict(id='convertis', date=(1700, 6, 1), who=('64',), title='Les nouveaux convertis du Béarn',
         text="Quinze ans après les dragonnades, les « nouveaux convertis » d'Orthez et de Salies s'assemblent en secret "
              "pour chanter les psaumes de Marot.",
         choices=[dict(label='Rappeler les dragons', fx=dict(culte='dragonnades'), ai=1),
                  dict(label='Fermer les yeux', fx=dict(culte='tolerance'), ai=1),
                  dict(label="S'en tenir à l'édit", fx=dict(), ai=2)]),
    dict(id='camisards', date=(1702, 7, 24), who=('30', '48', '07'), title='La guerre des Camisards',
         text="L'abbé du Chayla est tué au Pont-de-Montvert : les camisards de Roland et de Jean Cavalier tiennent les "
              "Cévennes et brûlent les églises.",
         choices=[dict(label='Envoyer les dragons de Montrevel', fx=dict(culte='dragonnades', regs=[['cavalerie', 1]],
                                                                        bande=_b(600, 'religion', nom='les camisards de Cavalier')), ai=2),
                  dict(label='Négocier avec Cavalier', fx=dict(res=dict(livres=-300), culte='tolerance'), ai=1),
                  dict(label='Laisser faire', fx=dict(bande=_b(1100, 'religion', nom='les camisards de Roland')), ai=1)]),
    dict(id='tard_avises', date=(1707, 5, 1), who=('46',), title='Les Tard-Avisés',
         text="Écrasés par la capitation et le dixième, les paysans du Quercy se soulèvent et marchent sur Cahors.",
         choices=[dict(label='Remettre une part des impôts', fx=dict(res=dict(livres=-350), stab=0.03), ai=2),
                  dict(label='Envoyer la maréchaussée', fx=dict(res=dict(livres=-100), bande=_b(450, 'impots', nom='les Tard-Avisés')), ai=1),
                  dict(label='Laisser faire', fx=dict(bande=_b(900, 'impots', nom='les Tard-Avisés')), ai=1)]),
    dict(id='mandrin', date=(1754, 6, 1), who=('38', '01', '26', '71', '63', '43'), title='Mandrin',
         text="Louis Mandrin et ses contrebandiers vendent tabac et indiennes à la barbe des fermiers généraux, sur les "
              "places des villes, au son du tambour.",
         choices=[dict(label='Mettre sa tête à prix', fx=dict(res=dict(livres=-200)), ai=2),
                  dict(label='Fermer les yeux', fx=dict(stab=0.02, bande=_b(250, k='brigands', nom='la bande de Mandrin')), ai=1)]),
    dict(id='calas', date=(1762, 3, 10), who=('31',), title="L'affaire Calas",
         text="Jean Calas, négociant protestant de Toulouse, est roué sur une fausse accusation. Voltaire s'indigne et "
              "l'Europe le suit.",
         choices=[dict(label='Réhabiliter Calas', fx=dict(culte='tolerance', glory=3, stab=-0.02), ai=1),
                  dict(label='Soutenir le parlement', fx=dict(stab=0.02, rel=-3), ai=1)]),
    dict(id='edit_tolerance', date=(1787, 11, 7), who=None, cond=_reformes, title="L'édit de tolérance",
         text="Louis XVI rend un état civil aux non-catholiques : les protestants peuvent se marier devant le juge et "
              "léguer leurs biens.",
         choices=[dict(label="Appliquer l'édit", fx=dict(culte='tolerance', stab=0.02), ai=3),
                  dict(label='Le laisser lettre morte', fx=dict(stab=-0.03), ai=1)]),
    dict(id='jacqueries', date=(1789, 7, 28), who=None, title='Les châteaux brûlent',
         text="Dans les campagnes {de_chef}, on brûle les terriers et l'on pille les châteaux pour en finir avec les "
              "droits seigneuriaux.",
         choices=[dict(label='Abolir les droits seigneuriaux sans attendre', fx=dict(res=dict(livres=-150), stab=0.03), ai=2),
                  dict(label='Envoyer la maréchaussée', fx=dict(bande=_b(300, 'famine')), ai=1),
                  dict(label="Laisser passer l'orage", fx=dict(bande=_b(600, 'famine')), ai=1)]),
    dict(id='constitution_civile', date=(1790, 7, 12), who=None, title='La Constitution civile du clergé',
         text="L'Assemblée fait des curés des fonctionnaires élus et vend les biens du clergé ; le pape condamne, la "
              "moitié des prêtres refuse le serment.",
         choices=[dict(label='Imposer le serment', fx=dict(culte='laique', res=dict(livres=250)), ai=2),
                  dict(label='Ménager les réfractaires', fx=dict(culte='tolerance', stab=0.02), ai=1)]),
    dict(id='emancipation', date=(1791, 9, 27), who=('33', '64', '67', '68', '57', '54'), title="L'émancipation des juifs",
         text="L'Assemblée fait des juifs des citoyens : négociants portugais de Bordeaux et de Bayonne, colporteurs et "
              "prêteurs d'Alsace et de Lorraine.",
         choices=[dict(label="L'appliquer", fx=dict(tmod=dict(trade=0.05), days=10 * 365), ai=2),
                  dict(label='La différer', fx=dict(stab=0.01), ai=1)]),
    dict(id='vendee', date=(1793, 3, 11), who=('85', '49', '44', '79'), title='La Vendée se soulève',
         text="La levée de 300 000 hommes met le feu au bocage : Cathelineau, Stofflet et Charette lèvent l'Armée "
              "catholique et royale.",
         choices=[dict(label='Envoyer les colonnes', fx=dict(regs=[['ligne', 2]], stab=-0.05,
                                                             bande=_b(1200, 'religion', nom="l'Armée catholique et royale")), ai=1),
                  dict(label='Suspendre la levée et rouvrir les églises', fx=dict(culte='tolerance', res=dict(recrues=-300),
                                                                                 bande=_b(500, 'religion', nom='les Vendéens')), ai=2),
                  dict(label='Laisser faire', fx=dict(bande=_b(2000, 'religion', nom="l'Armée catholique et royale")), ai=1)]),
    dict(id='chouannerie', date=(1794, 1, 15), who=('53', '35', '56', '22', '29', '50', '61', '72'), title='La chouannerie',
         text="Jean Chouan et Cadoudal tiennent les bocages : embuscades, diligences arrêtées, patriotes enlevés la nuit.",
         choices=[dict(label='Battre les haies avec la cavalerie', fx=dict(regs=[['cavalerie', 1]],
                                                                        bande=_b(400, 'religion', nom='les chouans')), ai=1),
                  dict(label='Amnistie et liberté du culte', fx=dict(culte='tolerance', res=dict(livres=-200)), ai=2),
                  dict(label='Laisser faire', fx=dict(bande=_b(800, 'religion', nom='les chouans')), ai=1)]),
    dict(id='concordat', date=(1801, 7, 15), who=None, title='Le Concordat',
         text="Bonaparte et Pie VII signent le Concordat : les églises rouvrent, l'État paie les évêques et les curés.",
         choices=[dict(label='Appliquer le Concordat', fx=dict(culte='concordat', stab=0.04), ai=3),
                  dict(label='Garder un clergé soumis', fx=dict(culte='laique'), ai=1)]),
    dict(id='demoiselles', date=(1829, 5, 1), who=('09',), title='La guerre des Demoiselles',
         text="Le nouveau code forestier interdit le bois mort et la pâture : déguisés en femmes, les paysans de l'Ariège "
              "chassent les gardes et les charbonniers.",
         choices=[dict(label="Rendre les droits d'usage", fx=dict(res=dict(livres=-200), stab=0.03), ai=2),
                  dict(label='Envoyer les gendarmes', fx=dict(bande=_b(300, k='brigands', nom='les Demoiselles')), ai=1)]),
    dict(id='canuts', date=(1831, 11, 21), who=('69',), title='La révolte des canuts',
         text="« Vivre en travaillant ou mourir en combattant » : les ouvriers de la soie se rendent maîtres de la "
              "Croix-Rousse.",
         choices=[dict(label='Accorder le tarif', fx=dict(res=dict(livres=-400), stab=0.03), ai=2),
                  dict(label="Envoyer l'armée", fx=dict(regs=[['ligne', 2]], bande=_b(900, nom='les canuts')), ai=1),
                  dict(label='Laisser faire', fx=dict(bande=_b(1400, nom='les canuts')), ai=1)]),
    dict(id='canuts2', date=(1834, 4, 9), who=('69',), title='La seconde révolte des canuts',
         text="Le procès des mutuellistes rallume la Croix-Rousse : six jours de barricades.",
         choices=[dict(label='Gracier les mutuellistes', fx=dict(res=dict(livres=-250), stab=0.02), ai=2),
                  dict(label='Écraser les barricades', fx=dict(stab=-0.04, bande=_b(600, nom='les canuts')), ai=1)]),
    dict(id='juin1848', date=(1848, 6, 23), who=('75',), title='Les journées de Juin',
         text="La fermeture des Ateliers nationaux jette les ouvriers sur les barricades du faubourg Saint-Antoine.",
         choices=[dict(label='Rouvrir les ateliers', fx=dict(res=dict(livres=-500), stab=0.03), ai=1),
                  dict(label='Confier la répression à Cavaignac', fx=dict(stab=-0.05, bande=_b(1000, nom='les insurgés de Juin')), ai=2)]),
    dict(id='communes', date=(1871, 3, 26), who=('75', '69', '13', '42', '11', '31', '87', '71'), title='La Commune {de_chef}',
         text="Après Paris, la ville proclame sa Commune : le drapeau rouge flotte sur l'hôtel de ville {de_chef}.",
         choices=[dict(label='Négocier avec les communards', fx=dict(res=dict(livres=-400), stab=-0.02, bande=_b(300, nom='les communards')), ai=1),
                  dict(label='Réprimer', fx=dict(regs=[['ligne', 1]], bande=_b(800, nom='les communards')), ai=2),
                  dict(label='Laisser faire', fx=dict(bande=_b(1500, nom='les communards')), ai=1)]),
    dict(id='ferry', date=(1880, 3, 29), who=None, title='Les décrets Ferry',
         text="Les jésuites et les congrégations sont dispersés ; l'école publique sera gratuite, obligatoire et laïque.",
         choices=[dict(label="Laïciser l'école", fx=dict(culte='laique', glory=2, stab=-0.02), ai=1),
                  dict(label="Ménager l'Église", fx=dict(culte='concordat', stab=0.02), ai=2)]),
]
RANDOM = [
    dict(id='desert', w=3, cond=_contraint, title='Une assemblée au Désert',
         text="Des centaines de réformés se sont réunis de nuit dans un vallon près {de_ville} pour entendre un pasteur "
              "venu de Lausanne.",
         choices=[dict(label='Disperser par les dragons', fx=dict(town_stab=-0.06, stab=0.01), ai=1),
                  dict(label='Arrêter le pasteur', fx=dict(res=dict(livres=-50), town_stab=-0.02), ai=1),
                  dict(label='Fermer les yeux', fx=dict(town_stab=0.04, stab=-0.01), ai=2)]),
]

if RG.ACTIF:
    EV.HIST.extend(HIST)
    EV.HIST.sort(key=lambda e: e['date'])
    EV.RANDOM.extend(RANDOM)
    EV.RANDOM_BY_ID.update({e['id']: e for e in RANDOM})


def decrire(g, code, fx):
    """Les effets « culte » et « bande » d'un événement, en clair (events.describe)."""
    out = []
    if fx.get('culte'):
        out.append(f"politique religieuse : {RG.nom(g, fx['culte']).lower()}")
    if fx.get('bande'):
        b = fx['bande']
        out.append(f"une bande de {R.nb(b['n'])} {GENRES[b['k']]['nom']} se lève")
    return out


def appliquer(g, code, fx):
    """Les effets « culte » et « bande » d'un événement (events.apply)."""
    if fx.get('culte') and fx['culte'] in RG.ouvertes(g):
        RG.set_culte(g, code, fx['culte'], force=True)
    if fx.get('bande') and RG.ACTIF:
        init(g)
        b = fx['bande']
        occ = {x['node'] for x in g.bandes}
        mine = [n for n in g.owned_nodes(code) if n['id'] not in occ and not n['siege']]
        chez = [n for n in mine if g.geo.nodes[n['id']]['dept'] == code] or mine
        if b['k'] == 'brigands':
            chez = [n for n in chez if g.geo.nodes[n['id']]['type'] == 'village'] or chez
        if chez:
            w = [1.3 - n['stab'] + (3 * n.get('rp', 0) if b['why'] == 'religion' else 0)
                 + (0.5 if g.geo.nodes[n['id']]['type'] == 'ville' else 0) for n in chez]
            n = g.rng.choices(chez, w)[0]
            naitre(g, b['k'], n['id'], b['n'], code, b['why'], b.get('nom'))
