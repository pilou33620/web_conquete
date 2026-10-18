#!/usr/bin/env python3
"""Banc d'équilibre de la campagne : des parties jouées par les IA seules (le camp du joueur aussi), sur des graines
fixes, pour comparer l'équilibre avant et après un changement de règles (SPEC-TECH.md, tasks/equilibre-reference.md).

Usage :  python3 outils/simuler.py --parties 3 --epoque 1790 --annees 30 --graine 1 --proc 3

Mesures, par partie puis en moyenne : erreurs, guerres déclarées et leur durée (mois), places de chaque camp à la fin
et écart entre le premier et le dernier, camps encore en vie, technologies trouvées, trésor et hommes sous les armes.
Environ 20 s de calcul par année de jeu et par partie sur le Raspberry Pi : --proc en joue plusieurs à la fois.
"""
import argparse
import os
import sys
import traceback
from multiprocessing import Pool

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tests'))


def play_month(g):
    """Un « Tour suivant » ; les décisions qui attendent le joueur (événements), c'est son IA qui les prend : le premier
    choix qu'il peut payer, comme les IA."""
    from game import events as E
    from game import turns as TT
    TT.go(g)
    for _ in range(3000):
        if g.tour['end'] is None:
            return
        for x in list(g.pending_ev):
            ok = [i for i, c in enumerate(x['choices']) if E.affordable(g, g.player, c['fx'])]
            E.resolve(g, x['id'], ok[0] if ok else len(x['choices']) - 1, auto=True)
        TT.advance(g, 1.0)
        if g.tour['stop']:
            TT.go(g)
    raise AssertionError('le tour des IA ne finit pas')


def simulate(seed, epoque='1790', mois=12, joueur='33'):
    """Une partie de `mois` tours jouée par les IA seules ; rend ses mesures (un dict)."""
    from fabrique import partie   # (charge la carte et coupe le journal des batailles)
    from game.ai import AI
    g = partie(joueur, epoque, seed=seed)
    g.ais[g.player] = AI(g, g.player)   # le camp du joueur joué par une IA, comme les autres
    codes = sorted(g.factions)
    pairs = [(a, b) for i, a in enumerate(codes) for b in codes[i + 1:]]
    starts = war_months = 0
    before = {p: g.at_war(*p) for p in pairs}
    err = None
    for _ in range(mois):
        try:
            play_month(g)
        except Exception:   # une erreur est une mesure : la partie s'arrête là, le banc continue
            err = traceback.format_exc(limit=3).strip().splitlines()[-1]
            break
        if g.over:
            break
        now = {p: g.at_war(*p) for p in pairs}
        starts += sum(1 for p in pairs if now[p] and not before[p])
        war_months += sum(now.values())
        before = now
    places = {c: sum(1 for n in g.nodes if n['owner'] == c) for c in codes}
    return dict(seed=seed, epoque=epoque, date=g.date_str(), err=err, guerres=starts,
                duree=round(war_months / starts, 1) if starts else 0.0, places=places,
                ecart=max(places.values()) - min(places.values()),
                vivants=sum(1 for c in codes if g.factions[c]['alive']),
                techs=round(sum(len(g.factions[c]['techs']) for c in codes) / len(codes), 1),
                tresor=round(sum(g.factions[c]['res']['livres'] for c in codes) / len(codes)),
                hommes=round(sum(g.army_men(a) for a in g.armies.values()) / len(codes)))


def _run(args):
    return simulate(*args)


def mean(rows, k):
    return round(sum(r[k] for r in rows) / len(rows), 1) if rows else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--parties', type=int, default=3)
    ap.add_argument('--epoque', default='1790', choices=['1700', '1790', '1813', '1870'])
    ap.add_argument('--annees', type=int, default=30)
    ap.add_argument('--graine', type=int, default=1, help='graine de la première partie (les suivantes : +1, +2…)')
    ap.add_argument('--proc', type=int, default=1, help='parties jouées en même temps')
    a = ap.parse_args()
    jobs = [(a.graine + i, a.epoque, a.annees * 12) for i in range(a.parties)]
    with Pool(max(1, a.proc)) as pool:
        rows = pool.map(_run, jobs)
    print(f"{a.parties} parties depuis {a.epoque}, {a.annees} ans, graines {a.graine} à {a.graine + a.parties - 1}")
    print('graine  fin                 guerres  durée  écart  vivants  techs  trésor  hommes  places / erreur')
    for r in rows:
        tail = r['err'] or ' '.join(f"{c}:{n}" for c, n in r['places'].items())
        print(f"{r['seed']:>6}  {r['date']:<18} {r['guerres']:>8} {r['duree']:>6} {r['ecart']:>6} {r['vivants']:>8} "
              f"{r['techs']:>6} {r['tresor']:>7} {r['hommes']:>7}  {tail}")
    print(f"moyenne {'':<18} {mean(rows, 'guerres'):>8} {mean(rows, 'duree'):>6} {mean(rows, 'ecart'):>6} "
          f"{mean(rows, 'vivants'):>8} {mean(rows, 'techs'):>6} {mean(rows, 'tresor'):>7} {mean(rows, 'hommes'):>7}  "
          f"erreurs : {sum(1 for r in rows if r['err'])}")


if __name__ == '__main__':
    main()
