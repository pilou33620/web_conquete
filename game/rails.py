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
