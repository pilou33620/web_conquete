#!/usr/bin/env python3
"""Banc de l'IA de bataille : des batailles isolées jouées IA contre IA jusqu'au bout, sur des graines fixes, résumées
en un tableau court (pour comparer avant et après un changement de game/tactics/ai.py sans lire les journaux).

Usage :  python3 outils/banc_ia.py [--graines 2] [--proc 4] [--epoques 1700,1790,1813,1870] [--lieux bataille,forteresse]
         (lieux : bataille, forteresse, village : un village sans remparts, barricadé)
         [--tweak '{"normal": {"cav_opp": false}}']   (réglages d'essai : spec['ai_tweak'], pour les comparaisons A/B)
         [--journal 12]   (les 12 dernières notes du journal de chaque camp sous sa ligne, à filtrer avec grep)
         [--ordres '{"man": "enveloppement", "wing": "gauche", "ruse": "feinte"}']   (le camp du joueur mené selon ces
         ordres, « Donner mes ordres » : game/tactics/orders.py ; les clés absentes gardent leur valeur par défaut)

Par bataille : époque, lieu, camp du joueur (att : il attaque), vainqueur (A assaillant, D défenseur, - aucun), raison,
durée (min de bataille), pertes de chaque camp (% des hommes), temps de calcul (s), et les grands moments notés par
l'IA (ai_mem[...]['journal']) comptés par famille : contre-attaques, charges, tirailleurs, assauts, décrochages, brèches.
« Figée » : la bataille va au bout du temps sans que personne ne perde 10 %.
"""
import argparse
import json
import os
import sys
import time
from multiprocessing import Pool

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'tests'))

TROUPES = dict(ligne=4, legere=2, cavalerie=2, artillerie=2)
FAMILLES = [('ctr', ('contre-attaque', 'retour offensif', 'contre-charge')), ('chg', ('charge',)),
            ('tir', ('tirailleur', 'harcel')), ('ass', ('assaut', 'baïonnette')), ('déc', ('décroche', 'retraite')),
            ('brè', ('brèche', 'sortie', 'escalade'))]


def une(args):
    epoque, lieu, role, graine, tweak, nj, ordres = args
    args = args[:4]
    from fabrique import GEO
    from game.tactics import skirmish as S
    mes = dict(TROUPES)
    g, bid = S.new(GEO, dict(me='33', foe='24', era=epoque, kind=lieu, role=role, units=mes, seed=graine))
    while g is None and mes:   # (une arme que l'époque ou la garnison n'a pas : on l'enlève)
        mes.pop(next(iter(mes)))
        g, bid = S.new(GEO, dict(me='33', foe='24', era=epoque, kind=lieu, role=role, units=mes, seed=graine))
    if g is None:
        return dict(err=bid, cle=args)
    tb = g.tactical[bid]
    if tweak:
        from game.tactics import ai
        tb.spec['ai_tweak'] = json.loads(tweak)
        for s in tb.ai_sides:   # (les réglages du déploiement comptent aussi)
            ai.deploy(tb, s)
    t0 = time.process_time()
    try:
        if ordres:
            from game.tactics import orders as OR
            tb.spec['orders'] = [None, None]
            tb.spec['orders'][tb.me] = OR.clean(tb, tb.me, json.loads(ordres))
        tb.autofinish()
        if ordres:
            OR.setup(tb, tb.me, tb.spec['orders'][tb.me])
        tb.run_to_end()
    except Exception as e:   # (une erreur de l'IA est un résultat du banc, pas un plantage)
        return dict(err=f'{type(e).__name__}: {e}', cle=args)
    cpu = time.process_time() - t0
    r = tb._result()
    notes = [n[1].lower() for m in tb.ai_mem.values() if isinstance(m, dict) for n in m.get('journal', [])]
    cnt = {k: sum(any(w in n for w in mots) for n in notes) for k, mots in FAMILLES}
    pertes = [100 * r['lost'][s] / max(1, r['men0'][s]) for s in (0, 1)]
    return dict(cle=args, w='AD'[r['winner']] if r['winner'] in (0, 1) else '-', why=str(r['why'] or '')[:28],
                min=tb.clock / 60, pa=pertes[0], pd=pertes[1], cpu=cpu, cnt=cnt,
                figee=r['winner'] not in (0, 1) and max(pertes) < 10,
                jr=[f"  s{k[1:]} {n[1]}" for k, m in sorted(tb.ai_mem.items()) if isinstance(m, dict)
                    for n in m.get('journal', [])[-nj:]] if nj else [])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--graines', type=int, default=2)
    ap.add_argument('--proc', type=int, default=4)
    ap.add_argument('--epoques', default='1700,1790,1813,1870')
    ap.add_argument('--lieux', default='bataille,forteresse')
    ap.add_argument('--tweak', default='')
    ap.add_argument('--journal', type=int, default=0)
    ap.add_argument('--ordres', default='')
    a = ap.parse_args()
    jobs = [(e, l, r, s, a.tweak, a.journal, a.ordres) for e in a.epoques.split(',') for l in a.lieux.split(',') for r in ('att', 'def')
            for s in range(1, a.graines + 1)]
    with Pool(a.proc) as p:
        res = p.map(une, jobs)
    print(f"{'époque':6} {'lieu':10} {'rôle':4} gr  V raison                        min  pertA pertD   cpu  "
          + ' '.join(k for k, _ in FAMILLES))
    for r in res:
        e, l, ro, s = r['cle']
        if 'err' in r:
            print(f"{e:6} {l:10} {ro:4} {s:2}  ERREUR {r['err'][:90]}")
            continue
        print(f"{e:6} {l:10} {ro:4} {s:2}  {r['w']} {r['why']:28} {r['min']:5.0f} {r['pa']:5.0f} {r['pd']:5.0f} "
              f"{r['cpu']:5.1f}  " + ' '.join(f"{r['cnt'][k]:3}" for k, _ in FAMILLES) + ('  FIGÉE' if r['figee'] else ''))
        for t in r['jr']:
            print(t)
    ok = [r for r in res if 'err' not in r]
    if ok:
        n = len(ok)
        print(f"\n{n} batailles, {len(res) - n} erreurs ; vainqueur A {sum(r['w'] == 'A' for r in ok)}, "
              f"D {sum(r['w'] == 'D' for r in ok)}, aucun {sum(r['w'] == '-' for r in ok)} ; figées {sum(r['figee'] for r in ok)} ; "
              f"durée moy. {sum(r['min'] for r in ok) / n:.0f} min ; pertes moy. A {sum(r['pa'] for r in ok) / n:.0f} % "
              f"D {sum(r['pd'] for r in ok) / n:.0f} % ; cpu moy. {sum(r['cpu'] for r in ok) / n:.1f} s, max {max(r['cpu'] for r in ok):.1f} s")
        print('grands moments (total) : ' + ', '.join(f"{k} {sum(r['cnt'][k] for r in ok)}" for k, _ in FAMILLES))


if __name__ == '__main__':
    main()
