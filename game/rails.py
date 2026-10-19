"""Voies ferrées (SPEC-TECH.md, phase 2a) : les tronçons des lignes historiques (rules.RAIL_LINES), leurs chantiers, ce
qu'ils rapportent, le train et le sabotage.

Un tronçon va d'une ville à la suivante d'une ligne, par la route la plus courte (routes royales d'abord). Il
n'appartient à personne : un camp s'en sert s'il est achevé, pas coupé, et si ses deux villes sont à lui ou à un allié.
L'état de chacun est dans g.rails = {id: dict(done, cut)} (sauvegardé) ; un chantier est un élément de la file d'une
des deux villes (kind 'rail').
"""
import heapq

from . import rules as R

_SECTIONS = {}   # carte → tronçons (calculés une fois)


def _path(geo, a, b):
    """Arêtes de la route la plus courte de a à b (km, les routes royales comptant un peu moins), sans eau."""
    dist, prev, heap = {a: 0.0}, {}, [(0.0, a)]
    while heap:
        d, n = heapq.heappop(heap)
        if n == b:
            break
        if d > dist.get(n, 1e18):
            continue
        for eid in geo.adj[n]:
            e = geo.edges[eid]
            if e.get('kind') == 'water':
                continue
            m = e['b'] if e['a'] == n else e['a']
            nd = d + e['len'] / (1.15 if e.get('royal') else 1.0)
            if nd < dist.get(m, 1e18):
                dist[m], prev[m] = nd, (n, eid)
                heapq.heappush(heap, (nd, m))
    if b not in prev:
        return []
    out, n = [], b
    while n != a:
        n, eid = prev[n]
        out.append(eid)
    return out[::-1]


def sections(geo):
    """Tronçons des lignes : {id: dict(id, a, b, edges, km, line, year)} ; id « a-b » (numéros des villes)."""
    if id(geo) in _SECTIONS:
        return _SECTIONS[id(geo)]
    out = {}
    for name, towns, _ in R.RAIL_LINES:
        for (ta, _), (tb, year) in zip(towns, towns[1:]):
            a, b = geo.by_name[ta], geo.by_name[tb]
            sid = f'{min(a, b)}-{max(a, b)}'
            if sid in out:
                continue
            edges = _path(geo, a, b)
            out[sid] = dict(id=sid, a=a, b=b, edges=edges, km=round(sum(geo.edges[e]['len'] for e in edges), 1),
                            line=name, year=year)
    _SECTIONS[id(geo)] = out
    return out


def exits():
    """Sorties des lignes vers le bord de la carte : [(ville, (vers, direction))] (dessinées seulement)."""
    return [(t, (to, d)) for _, _, ex in R.RAIL_LINES for t, to, d in ex]


# ------------------------------------------------------------------ réseau et chantiers
RAIL_MAX_WORKS = 2   # chantiers de voie ferrée menés en même temps par un camp


def _owned(g, code, sec):
    return g.nodes[sec['a']]['owner'] == code and g.nodes[sec['b']]['owner'] == code


def network(g, code):
    """Villes reliées au réseau de ce camp : son chef-lieu, et les villes des tronçons achevés qu'il tient en entier."""
    out = {g.capital_of(code)}
    for sid, st in g.rails.items():
        sec = sections(g.geo).get(sid)
        if sec and st.get('done') and _owned(g, code, sec):
            out |= {sec['a'], sec['b']}
    return out


def works(g, code):
    return [sid for sid, st in g.rails.items() if not st.get('done') and st.get('by') == code]


def openable(g, code, sid):
    """(possible, raison) : ce camp peut-il ouvrir le chantier de ce tronçon ?"""
    sec = sections(g.geo).get(sid)
    if sec is None:
        return False, "Tronçon inconnu."
    if 'chemins_fer' not in g.factions[code]['techs']:
        return False, "Technologie requise : Chemins de fer."
    if sid in g.rails:
        return False, "Voie déjà construite." if g.rails[sid].get('done') else "Chantier déjà en cours."
    if not _owned(g, code, sec):
        return False, "Les deux villes doivent être à vous."
    if not {sec['a'], sec['b']} & network(g, code):
        return False, "Le réseau part de votre chef-lieu : reliez d'abord l'une des deux villes."
    if len(works(g, code)) >= RAIL_MAX_WORKS:
        return False, f"Déjà {RAIL_MAX_WORKS} chantiers de voie ferrée en cours."
    return True, ''


def cost(g, code, sid):
    """Prix et durée (jours de travail à industrie moyenne) d'un tronçon pour ce camp : le ciment les réduit aussi."""
    km = sections(g.geo)[sid]['km']
    return g.build_cost(code, {r: v * km for r, v in R.RAIL_KM_COST.items()}), g.build_days(code, km * R.RAIL_KM_DAYS)


def start(g, code, sid):
    ok, why = openable(g, code, sid)
    if not ok:
        return False, why
    price, days = cost(g, code, sid)
    if not g.can_pay(code, price):
        return False, "Ressources insuffisantes."
    g.pay(code, price)
    g.rails[sid] = dict(done=False, cut=None, by=code, left=days, total=days)
    sec = sections(g.geo)[sid]
    return True, f"Chantier de la voie {g.geo.nodes[sec['a']]['name']}–{g.geo.nodes[sec['b']]['name']} lancé."


def industry_k(g, code):
    """Vitesse des chantiers : l'industrie du camp comparée à celle des camps en vie (× 0,5 à 2)."""
    alive = [f['income'].get('industrie', 0.0) for f in g.factions.values() if f['alive']]
    mean = sum(alive) / max(1, len(alive))
    return max(0.5, min(2.0, g.factions[code]['income'].get('industrie', 0.0) / max(1e-6, mean)))


def tick(g, w):
    """Fait avancer les chantiers de w jours de travail (Game.update_queues) ; un chantier dont une ville est perdue ou
    assiégée attend."""
    for sid, st in g.rails.items():
        if st.get('done'):
            continue
        sec, code = sections(g.geo)[sid], st['by']
        if code not in g.factions or not g.factions[code]['alive'] or not _owned(g, code, sec) \
                or g.nodes[sec['a']]['siege'] or g.nodes[sec['b']]['siege']:
            continue
        st['left'] -= w * industry_k(g, code)
        if st['left'] <= 1e-6:
            g.rails[sid] = dict(done=True, cut=None)
            g._dirty_income = True
            a, b = g.geo.nodes[sec['a']], g.geo.nodes[sec['b']]
            g.log('rail', f"La voie ferrée {a['name']}–{b['name']} est ouverte : les deux villes gagnent en industrie et "
                          f"en commerce.", (a['x'] + b['x']) / 2, (a['y'] + b['y']) / 2, who=code, important=code == g.player)


# ------------------------------------------------------------------ ce que les lignes rapportent
_BY_TOWN = {}


def by_town(geo):
    """{ville: [tronçons qui la desservent]}"""
    if id(geo) not in _BY_TOWN:
        out = {}
        for sid, sec in sections(geo).items():
            out.setdefault(sec['a'], []).append(sid)
            out.setdefault(sec['b'], []).append(sid)
        _BY_TOWN[id(geo)] = out
    return _BY_TOWN[id(geo)]


def open_(g, sid):
    """Achevé et pas coupé."""
    st = g.rails.get(sid)
    return bool(st and st.get('done') and not (st.get('cut') and g.t < st['cut']))


def usable(g, code, sid):
    """Ce camp peut-il s'en servir ? Ouvert, et ses deux villes à lui ou à un allié."""
    if not open_(g, sid):
        return False
    sec = sections(g.geo)[sid]
    return g.friendly(code, g.nodes[sec['a']]['owner']) and g.friendly(code, g.nodes[sec['b']]['owner'])


def town_bonus(g, nid):
    """Industrie et commerce en plus pour une ville desservie par des tronçons ouverts (à qui qu'ils soient)."""
    k = sum(1 for sid in by_town(g.geo).get(nid, ()) if open_(g, sid))
    return min(R.RAIL_TOWN_MAX, R.RAIL_TOWN_BONUS * k)


def near_station(g, code, x, y):
    """Une gare utilisable par ce camp est-elle à moins de RAIL_STATION_KM ?"""
    r2 = R.RAIL_STATION_KM ** 2
    for nid, sids in by_town(g.geo).items():
        gn = g.geo.nodes[nid]
        if (gn['x'] - x) ** 2 + (gn['y'] - y) ** 2 <= r2 and any(usable(g, code, sid) for sid in sids):
            return True
    return False
