#!/usr/bin/env python3
"""Banc des guerres entre IA : traités, camps absorbés et armées immobiles des camps en guerre (SPEC-FRANCE.md,
« Guerres décisives et armées actives »).

Usage :  python3 outils/banc_guerres.py [--geo 3] [--epoque 1790] [--mois 36] [--graine 1]

Chaque année : camps en vie, disparus, guerres en cours, places prises d'un camp à l'autre, traités et absorptions
(avec les places qu'il restait au vaincu), plus petit et plus grand camp. Après chaque réflexion de son IA, chaque
armée restée au repos d'un camp en guerre est classée selon ce qui la retient (garde d'une place menacée, plus forte, égale ou plus faible
que la menace ; renforts ou quartiers ; exercice ; embuscade ; rien à prendre à sa portée) ; le bilan donne la part des
armées (en puissance) immobiles et la répartition de ces raisons.
"""
import argparse
import collections
import math
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'outils'))
os.environ['WEB_CONQUETE_NOLOG'] = '1'

TRAITES = []   # (date, vaincu, vainqueur, places restantes, absorbé ?)


def pourquoi(g, ai, a):
    """Ce qui retient au repos l'armée a (au repos, camp en guerre)."""
    if a['stance'] == 'embuscade':
        return 'embuscade'
    if any(r.get('drill') for r in a['regs']):
        return 'exercice'
    if a.get('rg'):
        return 'renforts en route'
    if a.get('qrt'):
        return 'quartiers'
    nid = a['at_node']
    if nid is not None and g.nodes[nid]['owner'] == ai.code:
        foes = ai.foes()
        if hasattr(ai, 'retranchee') and nid != g.capital_of(ai.code):   # (règle de la défense depuis le 09/11)
            foes = [e for e in foes if not ai.retranchee(e)]
        th = ai.threat_at(nid, 30, foes, {})
        if th > 0 and th > g.node_defense_power(nid, include_armies=False) * 0.8:
            k = g.army_power(a) / th
            return 'garde : plus forte' if k > 1.3 else 'garde : égale' if k > 0.75 else 'garde : plus faible'
    if g.army_men(a) < 0.45 * sum(r['max'] for r in a['regs']) or a['supply'] < 0.25:
        return 'se refait'
    return 'sans cible, au ralliement' if nid is not None and nid == ai.rally_node() else 'sans cible, ailleurs'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--geo', type=int, default=3)
    ap.add_argument('--epoque', default='1790')
    ap.add_argument('--mois', type=int, default=36)
    ap.add_argument('--graine', type=int, default=1)
    ap.add_argument('--joueur', default='33')
    o = ap.parse_args()
    from banc_france import jouer_mois
    from game.ai import AI
    from game.engine import Game
    from game.geo import GeoMap
    vieux_traite, vieux_cap = Game.treaty, Game.capitulate

    def traite(self, loser, winner, cap):
        TRAITES.append((self.date_str(), loser, winner, len(self.owned_nodes(loser)), False))
        return vieux_traite(self, loser, winner, cap)

    def capitule(self, loser, winner):
        if self.factions[loser]['alive']:
            TRAITES.append((self.date_str(), loser, winner, len(self.owned_nodes(loser)), True))
        return vieux_cap(self, loser, winner)
    Game.treaty, Game.capitulate = traite, capitule
    vieux_think = AI.army_think
    raisons = collections.Counter()

    def think(self, a, taken):
        vieux_think(self, a, taken)
        if a['id'] in self.g.armies and a['state'] != 'battle' and self.wars():
            p = self.g.army_power(a)
            raisons[None] += p
            if a['state'] == 'idle':
                raisons[pourquoi(self.g, self, a)] += p
    AI.army_think = think
    g = Game(GeoMap(o.geo), o.joueur, 'normal', o.graine, o.epoque)
    g.ais[g.player] = AI(g, g.player)
    codes = sorted(g.factions)
    prec, prises, guerres_mois, t_cpu = [n['owner'] for n in g.nodes], 0, 0, 0.0
    for m in range(1, o.mois + 1):
        t0 = time.process_time()
        jouer_mois(g)
        t_cpu += time.process_time() - t0
        now = [n['owner'] for n in g.nodes]
        prises += sum(1 for x, y in zip(prec, now) if x != y and x in g.factions and y in g.factions)
        prec = now
        guerres_mois += sum(1 for i, x in enumerate(codes) for y in codes[i + 1:] if g.at_war(x, y))
        if m % 12 == 0 or m == o.mois:
            vivants = [c for c in codes if g.factions[c]['alive']]
            taille = sorted(len(g.owned_nodes(c)) for c in vivants)
            guerres = sum(1 for i, x in enumerate(codes) for y in codes[i + 1:] if g.at_war(x, y))
            print(f'{g.date_str()} : {len(vivants)} camps en vie ({len(codes) - len(vivants)} disparus), {guerres} guerres '
                  f'en cours ({guerres_mois / m:.1f} en moyenne), {prises} places prises, '
                  f'{sum(1 for t in TRAITES if not t[4])} traités, {sum(1 for t in TRAITES if t[4])} absorbés, '
                  f'camps de {taille[0]} à {taille[-1]} places (médiane {taille[len(taille) // 2]}), '
                  f'{t_cpu / m:.2f} s par mois', flush=True)
    total = raisons.pop(None, 0.0)
    immobiles = sum(raisons.values())
    print(f'armées des camps en guerre restées au repos après une réflexion : {100 * immobiles / max(1.0, total):.0f} % '
          f'(en puissance)')
    for k, v in raisons.most_common():
        print(f'  {k} : {100 * v / max(1.0, immobiles):.0f} %')
    print('vaincus (places restantes à la chute du chef-lieu) :',
          ' '.join(f'{t[3]}{"*" if t[4] else ""}' for t in TRAITES), '(* absorbé)')


if __name__ == '__main__':
    main()
