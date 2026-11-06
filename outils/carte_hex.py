"""Exporte la carte du jeu sur une grille d'hexagones pour la maquette web/js/dev/carte-hex.html.

Même échelle que le jeu : les positions restent en km (1 case de la géographie = 1 km), un hexagone fait
HEX_KM de large (d'un côté plat à l'autre). Chaque hexagone prend le terrain et le département majoritaires
des cases de 1 km qu'il couvre. Usage : python3 outils/carte_hex.py > web/js/dev/carte-hex-data.js
"""
import json
import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from game.geo import GeoMap, T_OCEAN  # noqa: E402

HEX_KM = 4.0
RK = HEX_KM / math.sqrt(3)          # rayon (centre → sommet), hexagones pointe en haut comme web_power
SIMPL = 0.6                         # km : pas minimal des rivières exportées


def main():
    g = GeoMap()
    cols = int(g.W / HEX_KM) + 1
    rows = int(g.H / (1.5 * RK)) + 1
    ter, dep, riv = [], [], []
    for row in range(rows):
        for col in range(cols):
            cx, cy = (col + 0.5 * (row & 1)) * HEX_KM, row * 1.5 * RK
            t, d, rv = Counter(), Counter(), 0
            for j in range(int(cy - RK), int(cy + RK) + 1):
                for i in range(int(cx - RK), int(cx + RK) + 1):
                    if math.hypot(i + .5 - cx, j + .5 - cy) > RK * .95:
                        continue
                    c = g.cell(i + .5, j + .5)
                    if c < 0:
                        t[T_OCEAN] += 1
                        continue
                    t[g.terrain[c]] += 1
                    d[g.dept[c]] += 1
                    if g.river[c]:
                        rv = min(rv or 9, g.river[c])
            ter.append(t.most_common(1)[0][0] if t else T_OCEAN)
            dep.append(d.most_common(1)[0][0] if d else 0)
            riv.append(rv)

    def km(lat, lon):
        x, y = g.xy(lat, lon)
        return [round(x, 2), round(y, 2)]

    rivers = []
    for r in g.src['rivers']:
        pts = []
        for lon, lat in r['pts']:
            p = km(lat, lon)
            if not pts or math.dist(p, pts[-1]) >= SIMPL:
                pts.append(p)
        rivers.append(dict(n=r['name'], k=r['rank'], p=pts))
    data = dict(
        hexKm=HEX_KM, cols=cols, rows=rows, W=g.W, H=g.H,
        ter=''.join(chr(48 + t) for t in ter),           # '0' océan … ':' vigne (game.geo T_*)
        dep=''.join(chr(64 + d) for d in dep),           # '@' hors de France, 'A' + index dans depts
        riv=''.join(str(r) for r in riv),                # 0 : sans rivière, sinon le rang le plus fort
        depts=g.dept_codes,
        nodes=[dict(n=n['name'], x=n['x'], y=n['y'], t=n['type'], d=n['dept'], f=n['fort'], p=n['pop0'])
               for n in g.nodes],
        roads=[dict(a=e['a'], b=e['b'], r=1 if e.get('royal') else 0, p=e['pts']) for e in g.edges],
        rivers=rivers,
    )
    sys.stdout.write('// Généré par outils/carte_hex.py : la géographie du jeu sur une grille d\'hexagones.\n')
    sys.stdout.write('const CARTE_HEX = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    main()
