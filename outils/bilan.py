#!/usr/bin/env python3
"""Bilan du journal des batailles (logs/batailles.jsonl, écrit par game/battle_log.py) : de quoi régler l'équilibre.

Usage :  python3 outils/bilan.py                 (tout le journal)
         python3 outils/bilan.py --depuis 2026-10-12   (seulement les batailles livrées depuis ce jour)
         python3 outils/bilan.py autre_journal.jsonl

Tableaux : assauts de places selon la fortification, brèches ouvertes au canon, batailles automatiques et commandées,
mode Bataille. Ne lit que le journal : aucune partie n'est lancée.
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(ROOT, 'logs', 'batailles.jsonl')


def load(path, since=None):
    out = []
    paths = [path]
    old = path.replace('.jsonl', '.1.jsonl')
    if path == DEFAULT and os.path.exists(old):
        paths.insert(0, old)
    for p in paths:
        if not os.path.exists(p):
            continue
        with open(p, encoding='utf-8') as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if since and r.get('ts', '') < since:
                    continue
                out.append(r)
    return out


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def mean100(xs):
    m = mean(list(xs))
    return None if m is None else 100 * m


def pct(k, n):
    return f"{100 * k / n:.0f} %" if n else '—'


def num(x, d=0):
    return '—' if x is None else f"{x:.{d}f}".replace('.', ',')


def table(title, head, rows):
    print(f"\n== {title}")
    if not rows:
        print('   (aucune bataille)')
        return
    w = [max(len(str(h)), *(len(str(r[i])) for r in rows)) for i, h in enumerate(head)]
    print('   ' + '  '.join(str(h).ljust(w[i]) for i, h in enumerate(head)))
    for r in rows:
        print('   ' + '  '.join(str(c).ljust(w[i]) for i, c in enumerate(r)))


def ratio(lost, i):
    """Pertes du camp i rapportées à son effectif de départ."""
    return lambda r: (r[lost][i] / r['men0'][i]) if r.get('men0') and r['men0'][i] else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('journal', nargs='?', default=DEFAULT)
    ap.add_argument('--depuis', help='date AAAA-MM-JJ : seulement les batailles livrées depuis ce jour')
    a = ap.parse_args()
    recs = load(a.journal, a.depuis)
    if not recs:
        print(f"Journal vide ou absent : {a.journal}. Jouez quelques batailles, puis relancez.")
        return 1
    camp = [r for r in recs if r.get('kind') == 'campagne']
    sk = [r for r in recs if r.get('kind') == 'bataille']
    print(f"{len(recs)} batailles : {len(camp)} de campagne "
          f"({sum(1 for r in camp if r.get('mode') == 'auto')} automatiques, "
          f"{sum(1 for r in camp if r.get('mode') == 'commandee')} commandées), {len(sk)} du mode Bataille.")

    # ---------------------------------------------------------------- assauts de places, selon la fortification
    rows = []
    for fort in sorted({(r['sides'][1].get('fort') or 0) for r in camp if r.get('assault') and r.get('sides')}):
        for mode in ('auto', 'commandee'):
            rs = [r for r in camp if r.get('assault') and r.get('sides') and (r['sides'][1].get('fort') or 0) == fort
                  and r.get('mode') == mode]
            if not rs:
                continue
            rows.append([fort, mode, len(rs), num(mean(r['sides'][1].get('guns') for r in rs), 1),
                         pct(sum(1 for r in rs if r.get('captured')), len(rs)),
                         num(mean(r['men0'][0] / max(1, r['men0'][1]) for r in rs), 2),
                         num(mean100(ratio('lost', 0)(r) for r in rs)), num(mean100(ratio('lost', 1)(r) for r in rs)),
                         num(mean(r.get('days') for r in rs), 2)])
    table('Assauts de places (campagne), selon le niveau de fortification',
          ['fort', 'mode', 'n', 'canons', 'prise', 'rapport forces', 'pertes att. %', 'pertes déf. %', 'jours'], rows)

    # ---------------------------------------------------------------- brèches au canon (batailles tactiques)
    tac = [r['tac'] for r in recs if r.get('tac') and r['tac'].get('place')]
    rows = []
    for fort in sorted({t['place']['fort'] for t in tac}):
        ts = [t for t in tac if t['place']['fort'] == fort]
        br = [t for t in ts if t.get('breaches')]
        nobr = [t for t in ts if not t.get('breaches')]
        won = lambda lst: sum(1 for t in lst if t.get('winner') == 0 and not t.get('disengage'))
        rows.append([fort, len(ts), num(mean(t.get('guns') for t in ts), 1), pct(len(br), len(ts)),
                     num(mean(t['breaches'][0][0] / 60 for t in br)), num(mean(len(t['breaches']) for t in br), 1),
                     f"{pct(won(br), len(br))} / {pct(won(nobr), len(nobr))}",
                     num(mean(t['clock'] / 60 for t in ts))])
    table('Brèches au canon (assauts joués sur le champ de bataille)',
          ['fort', 'n', 'canons rempart', 'avec brèche', '1re brèche (min)', 'brèches', 'prise avec / sans brèche',
           'durée (min)'], rows)

    # ---------------------------------------------------------------- automatique contre commandée
    rows = []
    for kind, test in (('rase campagne', lambda r: not r.get('assault')), ('assaut', lambda r: r.get('assault'))):
        for mode in ('auto', 'commandee'):
            rs = [r for r in camp if test(r) and r.get('mode') == mode and r.get('men0')]
            if not rs:
                continue
            rows.append([kind, mode, len(rs), pct(sum(1 for r in rs if r.get('winner') == 0), len(rs)),
                         pct(sum(1 for r in rs if r.get('disengage')), len(rs)),
                         num(mean(r['lost'][0] / max(1, r['lost'][1]) for r in rs), 2),
                         num(mean(r.get('prisoners') for r in rs))])
    table('Batailles automatiques et commandées (campagne)',
          ['bataille', 'mode', 'n', 'l’assaillant gagne', 'décrochage', 'pertes att./déf.', 'prisonniers'], rows)

    # ---------------------------------------------------------------- mode Bataille
    rows = []
    for kind in ('bataille', 'forteresse'):
        for role in ('att', 'def'):
            rs = [r for r in sk if (r.get('sk') or {}).get('kind') == kind and r['sk'].get('role') == role]
            if not rs:
                continue
            me = lambda r: r['tac'].get('me') or 0
            win = sum(1 for r in rs if r['tac'].get('winner') == me(r))
            rows.append([kind, 'attaque' if role == 'att' else 'défense', len(rs), pct(win, len(rs)),
                         num(mean(r['tac']['lost'][me(r)] for r in rs)), num(mean(r['tac']['lost'][1 - me(r)] for r in rs)),
                         pct(sum(1 for r in rs if r['tac'].get('accel')), len(rs)),
                         num(mean(r['tac']['clock'] / 60 for r in rs))])
    table('Mode Bataille (vue du joueur)',
          ['type', 'rôle', 'n', 'victoires', 'vos pertes', 'pertes ennemies', 'finies auto.', 'durée (min)'], rows)
    return 0


if __name__ == '__main__':
    sys.exit(main())
