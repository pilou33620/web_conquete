#!/usr/bin/env python3
"""Banc de vitesse du mode France (géographie 3, 89 camps) : une partie neuve, N mois joués (« Tour suivant » ; le camp
du joueur joué par une IA comme dans outils/simuler.py, ses batailles réglées en « Automatique »), temps de calcul de
chaque mois (temps CPU du processus : la machine est souvent partagée, comparer avant et après au même moment).

Usage :  python3 outils/banc_france.py [--epoque 1790] [--mois 3] [--joueur 33] [--graine 1]
         [--avant 24]        (24 mois joués d'abord, sans mesure : la France après deux ans de guerres)
         [--sauve f.json]    (garde la partie à la fin, au format des sauvegardes, à reprendre avec --reprend f.json)
         [--profil 25]       (les 25 fonctions les plus coûteuses, cProfile, temps cumulé)

À la fin : guerres en cours (et toutes celles vues à la fin d'un mois), places qui ont changé de main, camps en vie
(le monde lointain doit rester vivant).
"""
import argparse
import cProfile
import os
import json
import pstats
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ['WEB_CONQUETE_NOLOG'] = '1'


def jouer_mois(g):
    """simuler.play_month, et les batailles qui attendent le choix du joueur réglées en « Automatique »."""
    from game import events as E
    from game import turns as TT
    from game.tactics import bridge as TB
    TT.go(g)
    for _ in range(3000):
        if g.tour['end'] is None or g.over:
            return
        for x in list(g.pending_ev):
            ok = [i for i, c in enumerate(x['choices']) if E.affordable(g, g.player, c['fx'])]
            E.resolve(g, x['id'], ok[0] if ok else len(x['choices']) - 1, auto=True)
        for bt in list(g.battles.values()):
            if bt.get('mode') == 'attente':
                TB.command(g, dict(sub='choose', bid=bt['id'], mode='auto'))
        TT.advance(g, 1.0)
        if g.tour['stop']:
            TT.go(g)
    raise AssertionError('le tour des IA ne finit pas')


VUES = set()   # guerres vues en cours à la fin d'un mois


def bilan(g, owners0):
    codes = sorted(g.factions)
    guerres = {(a, b) for i, a in enumerate(codes) for b in codes[i + 1:] if g.at_war(a, b)}
    VUES.update(guerres)
    pris = sum(1 for n, o in zip(g.nodes, owners0) if n['owner'] != o)
    vivants = sum(1 for f in g.factions.values() if f['alive'])
    return (f'{g.date_str()} : {len(guerres)} guerres en cours ({len(VUES)} vues), {pris} places ont changé de main, '
            f'{vivants} camps en vie')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--epoque', default='1790')
    ap.add_argument('--mois', type=int, default=3)
    ap.add_argument('--joueur', default='33')
    ap.add_argument('--graine', type=int, default=1)
    ap.add_argument('--avant', type=int, default=0)
    ap.add_argument('--sauve')
    ap.add_argument('--reprend')
    ap.add_argument('--profil', type=int, default=0)
    o = ap.parse_args()
    from game.ai import AI
    from game.geo import GeoMap
    from game.engine import Game
    from game import views as V
    if o.reprend:
        with open(o.reprend, encoding='utf-8') as f:
            data = json.load(f)
        data = data.get('game', data)
        g = V.from_dict(GeoMap(data.get('geo', 1)), data)
    else:
        g = Game(GeoMap(3), o.joueur, 'normal', o.graine, o.epoque)
    g.ais[g.player] = AI(g, g.player)
    owners0 = [n['owner'] for n in g.nodes]
    for _ in range(o.avant):
        jouer_mois(g)
        bilan(g, owners0)
    if o.avant:
        print('après', o.avant, 'mois :', bilan(g, owners0))
    prof = cProfile.Profile() if o.profil else None
    temps = []
    for _ in range(o.mois):
        t0 = time.process_time()
        if prof:
            prof.enable()
        jouer_mois(g)
        if prof:
            prof.disable()
        temps.append(time.process_time() - t0)
        bilan(g, owners0)
        print(f'{g.date_str()} : {temps[-1]:.2f} s', flush=True)
    print(f'moyenne {sum(temps) / len(temps):.2f} s par mois ;', bilan(g, owners0))
    if o.sauve:
        with open(o.sauve, 'w', encoding='utf-8') as f:
            json.dump(dict(game=V.to_dict(g)), f, ensure_ascii=False)
    if prof:
        pstats.Stats(prof).sort_stats('cumulative').print_stats(o.profil)
        pstats.Stats(prof).sort_stats('tottime').print_stats(o.profil)


if __name__ == '__main__':
    main()
