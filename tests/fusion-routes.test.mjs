// La carte de secours (sans WebGL) dessine en une seule les routes presque confondues (carte/fusion-routes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fusionRoutes, surTrace } from '../web/js/carte/fusion-routes.js';

// Paires de routes doublées : côte à côte (0,05 à 0,5 case de la plus proche, parallèles) sur plus de 2 cases, comme
// tests/mesure-villes-chemins.mjs, mais à la distance du tracé de l'autre (deux tracés confondus ne comptent pas).
function doubles(edges, traces) {
  const segs = new Map(), cle = (i, j) => i + ',' + j, routes = edges.map((e, k) => k).filter(k => edges[k].kind !== 'water' && !edges[k].ferry);
  for (const k of routes) for (let g = 1; g < traces[k].length; g++) {
    const [a, b] = [traces[k][g - 1], traces[k][g]];
    for (let i = Math.floor(Math.min(a[0], b[0])); i <= Math.floor(Math.max(a[0], b[0])); i++) for (let j = Math.floor(Math.min(a[1], b[1])); j <= Math.floor(Math.max(a[1], b[1])); j++) {
      const c = cle(i, j); if (!segs.has(c)) segs.set(c, []); segs.get(c).push([k, a, b]);
    }
  }
  const long = new Map();
  for (const k of routes) for (let g = 1; g < traces[k].length; g++) {
    const [a, b] = [traces[k][g - 1], traces[k][g]], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 0.25);
    for (let s = 0; s < n; s++) {
      const x = a[0] + (b[0] - a[0]) * s / n, y = a[1] + (b[1] - a[1]) * s / n, pres = new Map();   // autre route -> [distance, cosinus]
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const [q, c, d] of segs.get(cle(Math.floor(x) + di, Math.floor(y) + dj)) || []) {
        if (q === k) continue;
        const dx = d[0] - c[0], dy = d[1] - c[1], l = Math.hypot(dx, dy) || 1e-9, t = Math.min(1, Math.max(0, ((x - c[0]) * dx + (y - c[1]) * dy) / (l * l)));
        const e = Math.hypot(c[0] + dx * t - x, c[1] + dy * t - y);
        if (!pres.has(q) || e < pres.get(q)[0]) pres.set(q, [e, Math.abs(((b[0] - a[0]) * dx + (b[1] - a[1]) * dy) / L / l)]);
      }
      for (const [q, [e, cos]] of pres) if (e > 0.05 && e < 0.5 && cos > 0.95) { const kk = Math.min(k, q) + '|' + Math.max(k, q); long.set(kk, (long.get(kk) || 0) + L / n); }
    }
  }
  return [...long.values()].filter(l => l > 2 * 2).length;   // (compté des deux côtés)
}

test('deux routes parallèles à 400 m n’en font plus qu’une ; un croisement, un bac et les bouts ne bougent pas', () => {
  const edges = [
    { a: 0, b: 1, royal: true, pts: [[0, 0], [10, 0]] },
    { a: 0, b: 2, pts: [[0, 0], [1, 0.4], [9, 0.4], [10, 3]] },   // la longe à 400 m, puis s'en va
    { a: 3, b: 4, pts: [[5, -3], [5, 3]] },                        // la croise
    { a: 5, b: 6, ferry: true, pts: [[2, 0.3], [8, 0.3]] },
    { a: 7, b: 8, kind: 'water', pts: [[2, 0.2], [8, 0.2]] },
  ];
  assert.equal(doubles(edges, edges.map(e => e.pts)), 1);
  const t = fusionRoutes(edges);
  assert.equal(doubles(edges, t), 0);
  assert.deepEqual(t[0], edges[0].pts);
  assert.deepEqual([t[1][0], t[1].at(-1)], [[0, 0], [10, 3]], 'la route part et arrive à ses places');
  assert.ok(t[1].length >= 4 && t[1].every(p => p[0] >= 8.5 || Math.abs(p[1]) < 1e-9), 'elle suit la royale le long du tronc');
  assert.deepEqual([t[2], t[3], t[4]], [edges[2].pts, edges[3].pts, edges[4].pts]);
  assert.deepEqual(surTrace(t[1], 5, 0.4), { x: 5, y: 0 }, 'le pont va sur le tracé dessiné');
});

// La carte réelle de l’Aquitaine (moteur Rust, géographie 2 figée) : 10 paires doublées à environ 400 m avant (86 dans la
// mesure de tests/mesure-villes-chemins.mjs, qui compte aussi deux tracés confondus dont les échantillons sont décalés)
test('Aquitaine : la carte de secours ne dessine plus de routes doublées', () => {
  const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const m = JSON.parse(execFileSync('cargo', ['run', '-q', '-p', 'conquete', '--bin', 'carte_json', '--', '2'], { cwd: racine, maxBuffer: 64 << 20 }).toString());
  const avant = doubles(m.edges, m.edges.map(e => e.pts)), t = fusionRoutes(m.edges), apres = doubles(m.edges, t);
  assert.ok(avant >= 5, `${avant} paires doublées avant`);
  assert.equal(apres, 0, `${avant} paires doublées avant, ${apres} après`);
  m.edges.forEach((e, k) => assert.deepEqual([t[k][0], t[k].at(-1)], [e.pts[0], e.pts.at(-1)]));
});
