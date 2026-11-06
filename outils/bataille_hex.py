"""Exporte une bataille du jeu sur une grille d'hexagones pour la maquette web/js/dev/bataille-hex.html.

Même échelle que le jeu : le champ de bataille garde ses 3 000 × 2 000 m et ses positions en mètres ; un hexagone fait
HEX_M de large. Chaque hexagone prend le type de case majoritaire des cases de 20 m qu'il couvre (routes, chemins et gués
mis à part : ils sont tracés à leur place) et leur hauteur moyenne. La bataille vient du mode Bataille (skirmish.new).
Usage : python3 outils/bataille_hex.py [graine] > web/js/dev/bataille-hex-data.js
"""
import json
import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from game import rules as R  # noqa: E402
from game.geo import GeoMap  # noqa: E402
from game.tactics import skirmish as SK  # noqa: E402
from game.tactics import terrain as TT  # noqa: E402

HEX_M = 40.0
RK = HEX_M / math.sqrt(3)
TRACES = (TT.T_ROUTE, TT.T_CHEMIN, TT.T_GUE)   # tracés à part : l'hexagone prend le terrain d'à côté


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    g, bid = SK.new(GeoMap(), dict(me='33', era='1790', kind='bataille', seed=seed, mode='manuel',
                                   units=dict(ligne=3, cavalerie=1, artillerie=2, legere=1, grenadiers=1)))
    assert g, bid
    tb = g.tactical[bid]
    m = tb.map
    cols, rows = int(TT.W / HEX_M) + 1, int(TT.H / (1.5 * RK)) + 1
    ter, hau = [], []
    for row in range(rows):
        for col in range(cols):
            cx, cy = (col + .5 * (row & 1)) * HEX_M, row * 1.5 * RK
            t, hs = Counter(), []
            for j in range(int((cy - RK) // TT.CELL), int((cy + RK) // TT.CELL) + 1):
                for i in range(int((cx - RK) // TT.CELL), int((cx + RK) // TT.CELL) + 1):
                    if not (0 <= i < TT.COLS and 0 <= j < TT.ROWS):
                        continue
                    if math.hypot((i + .5) * TT.CELL - cx, (j + .5) * TT.CELL - cy) > RK + TT.CELL * .5:
                        continue
                    c = j * TT.COLS + i
                    hs.append(m.h[c])
                    t[m.t[c]] += 1
            fond = Counter({k: v for k, v in t.items() if k not in TRACES})
            ter.append((fond or t or Counter({TT.T_PRE: 1})).most_common(1)[0][0])
            hau.append(round(sum(hs) / len(hs)) if hs else 0)
    r1 = lambda p: [round(p[0]), round(p[1])]
    sides = [s['owner'] for s in tb.spec['sides']] if 'sides' in tb.spec else sorted({u.owner for u in tb.units})
    data = dict(
        hexM=HEX_M, cols=cols, rows=rows, W=TT.W, H=TT.H,
        ter=''.join(chr(65 + t) for t in ter),            # 'A' + type de case (terrain.TYPE_NAMES)
        h=hau, types=TT.TYPE_NAMES, labels=TT.TYPE_LABEL,
        roads=[dict(k=k, p=[r1(p) for p in r['pts']]) for k, r in zip([r['kind'] for r in m.roads], m.roads)],
        rivers=[dict(w=r['w'], p=[r1(p) for p in r['pts']]) for r in m.rivers],
        batis=[dict(k=b['kind'], x=b['x'], y=b['y'], n=len(b['c'])) for b in m.batis],
        walls=[[r1(p) for p in w['pts']] if isinstance(w, dict) else [r1(p) for p in w] for w in m.walls],
        hedges=[[r1(p) for p in hd] for hd in m.hedges],
        town=m.town, place=m.place and m.place['name'], region=m.region, date=tb.spec.get('date'), season=tb.spec['season'], weather=tb.spec['weather'],
        sides=sides, units=[u.view(True, False) for u in tb.units],
        factions={k: dict(nom=f['name'], col=f['color']) for k, f in R.FACTIONS.items()},
    )
    sys.stdout.write("// Généré par outils/bataille_hex.py : une bataille du jeu sur une grille d'hexagones.\n")
    sys.stdout.write('const BATAILLE_HEX = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    main()
