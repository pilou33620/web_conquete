// Banc des routes et des places du plateau d'hexagones (hex/carte-moteur.js routesDe, hex/plateau.js placer) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le plateau est dessiné par le moteur web_engine, qui trace une route de case en case
// (graphismes/rendu/routes.js) et pose un pont sur toute case de rivière où elle passe. Le jeu lui donne les routes en
// paires d'hexagones : une erreur ne plante rien mais se voit (analyse-villes-chemins.md) : routes absentes, route sur
// la mer, pont dans une ville ou le long de la rivière, ferme posée sur la route, ville de 60 km sur la carte de l'Europe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Niveau, indexEn, routesDe } from '../web/js/hex/carte-moteur.js';
import { Plateau } from '../web/js/hex/plateau.js';

// une carte de 40 × 40 km : la mer à l'ouest (x < 6), une plaine, un fleuve d'ouest en est à y = 20
function carte() {
  const W = 40, H = 40, terrain = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) terrain[j * W + i] = i < 6 ? 0 : 2;
  return { W, H, terrain, playable: new Uint8Array(W * H).fill(1), m: { rivers: [{ rank: 1, pts: [[6, 20.2], [39, 20.2]] }] } };
}
const liens = paires => { const L = new Map(); for (const [a, b] of paires) for (const [x, y] of [[a, b], [b, a]]) { if (!L.has(x)) L.set(x, new Set()); L.get(x).add(y); } return L; };
const relie = (L, a, b) => { const vu = new Set([a]), f = [a]; while (f.length) { const h = f.pop(); if (h === b) return true; for (const v of L.get(h) || []) if (!vu.has(v)) { vu.add(v); f.push(v); } } return false; };

test('routes du plateau : reliées, une seule fois, jamais sur la mer ; pont seulement là où le serveur en a un', () => {
  const mp = carte(), N = new Niveau(mp, 4), g = N.g;
  const nord = { a: 0, b: 1, royal: true, pts: [[21, 5], [21, 35]], bx: 21, by: 20.2 };   // franchit le fleuve sur un pont
  const gue = { a: 6, b: 7, royal: false, pts: [[33, 5], [33, 35]] };                     // le passe à gué (pas de pont du serveur)
  const quai = { a: 2, b: 3, royal: false, pts: [[10, 20.2], [37, 20.2]] };     // longe le fleuve, sur ses hexagones
  const mer = { a: 4, b: 5, royal: false, pts: [[10, 8], [1, 11], [10, 14]] };  // fait un crochet par la mer
  const routes = [nord, { ...nord }, quai, gue, mer, { kind: 'water', a: 8, b: 9, pts: [[21, 5], [1, 5]] }], places = new Map();
  for (const e of routes) for (const [id, [x, y]] of [[e.a, e.pts[0]], [e.b, e.pts.at(-1)]]) places.set(id, { hex: [indexEn(g, x, y)] });
  const { paires, sansPont } = routesDe(N, routes, places);
  // chaque paire une seule fois (la route en double ne se trace pas deux fois), entre voisins, à terre
  assert.equal(new Set(paires.map(([a, b]) => a + ',' + b)).size, paires.length);
  for (const [a, b] of paires) {
    assert.ok(g.voisins(g.liste[a]).some(v => v.i === b), 'paire de voisins');
    assert.ok(!N.estEau(a) && !N.estEau(b), 'route sur l’eau');
  }
  const L = liens(paires), h = (x, y) => indexEn(g, x, y);
  assert.ok(relie(L, h(21, 5), h(21, 35)));
  assert.equal(paires.find(p => p[0] === h(21, 5) || p[1] === h(21, 5))[2], 3);   // (route royale)
  // le pont : sur l'hexagone où la route du nord franchit le fleuve ; aucun au gué, ni sur ceux que la route du quai longe
  const surRiv = e => [...new Set(routesDe(N, [e], places).paires.flatMap(([a, b]) => [a, b]))].filter(k => N.riviere[k]);
  const croise = surRiv(nord), longe = surRiv(quai).filter(k => !croise.includes(k));
  assert.ok(croise.length >= 1 && croise.every(k => !sansPont.has(k)), 'pas de pont là où la route franchit le fleuve');
  assert.ok(surRiv(gue).length >= 1 && surRiv(gue).every(k => sansPont.has(k)), 'un pont au gué');
  assert.ok(longe.length >= 4 && longe.every(k => sansPont.has(k)), 'un pont le long du fleuve');
});

test('une route coupée par la mer ne laisse pas de bout dans le vide', () => {
  const mp = carte(), N = new Niveau(mp, 4), g = N.g, places = new Map([[0, { hex: [indexEn(g, 20, 30)] }], [1, { hex: [indexEn(g, 1, 30)] }]]);
  assert.equal(routesDe(N, [{ a: 0, b: 1, pts: [[20, 30], [1, 30]] }], places).paires.length, 0);   // (l'autre bout est dans la mer)
});

test('une route part de l’hexagone où sa place est bâtie, et pas de pont dans une place', () => {
  const mp = carte(), N = new Niveau(mp, 4), g = N.g;
  const ici = indexEn(g, 30, 20.2), ailleurs = g.voisins(g.liste[ici]).find(v => !N.riviere[v.i]).i;
  const places = new Map([[0, { hex: [ailleurs] }], [1, { hex: [indexEn(g, 30, 36)] }]]);
  const { paires, sansPont } = routesDe(N, [{ a: 0, b: 1, pts: [[30, 20.2], [30, 36]] }], places, new Set([ici]));
  assert.ok(relie(liens(paires), ailleurs, indexEn(g, 30, 36)));
  assert.ok(sansPont.has(ici));
});

test('sur la carte de l’Europe (cases de 5 km), une capitale tient son hexagone, sans quartiers sur les voisins', () => {
  const mp = carte(), pl = Object.create(Plateau.prototype);
  Object.assign(mp, { nodes: [{ id: 0, type: 'capitale', pop0: 500000, x: 25, y: 10 }, { id: 1, type: 'ville', pop0: 9000, x: 25, y: 30 }], edges: [] });
  pl.mp = mp;
  const quartiers = KY => { mp.m.KY = KY; const N = new Niveau(mp, 4); pl.placer(N); return [...N.places.values()].map(p => p.hex.length); };
  assert.deepEqual(quartiers(110.95), [7, 2]);   // (Aquitaine : hexagones de 4 km)
  assert.deepEqual(quartiers(22.19), [1, 1]);    // (Europe : hexagones de 20 km)
});

// La carte réelle de l'Aquitaine (moteur Rust) : les comptes de l'analyse ne reviennent pas
test('Aquitaine : ni ferme sur une route, ni pont dans une place, ni route qui finit dans le vide', () => {
  const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const m = JSON.parse(execFileSync('cargo', ['run', '-q', '-p', 'conquete', '--bin', 'carte_json', '--', '2'], { cwd: racine, maxBuffer: 64 << 20 }).toString());
  const W = m.W, H = m.H, terrain = Uint8Array.from(Buffer.from(m.terrain, 'base64'));
  const mp = { W, H, terrain, playable: new Uint8Array(W * H).fill(1), m, nodes: m.nodes, edges: m.edges }, N = new Niveau(mp, 4), pl = Object.create(Plateau.prototype);
  pl.mp = mp; pl.placer(N);
  const { paires, sansPont } = N.routes, L = liens(paires), coeurs = new Set([...N.places.values()].map(p => p.hex[0]));
  assert.ok(paires.length > 1000, `${paires.length} paires`);
  assert.equal(N.campagne.filter(([k]) => L.has(k)).length, 0, 'ferme ou moulin sur une route');
  assert.equal([...N.ville].filter(k => N.riviere[k] && L.has(k) && !sansPont.has(k)).length, 0, 'pont dans une place');
  assert.equal(paires.filter(([a, b]) => N.estEau(a) || N.estEau(b)).length, 0, 'route sur l’eau');
  assert.equal([...L].filter(([k, v]) => v.size === 1 && !coeurs.has(k)).length, 0, 'route qui finit dans le vide');
  assert.equal(m.nodes.filter(n => !N.places.has(n.id)).length, 0, 'place non bâtie');
});
