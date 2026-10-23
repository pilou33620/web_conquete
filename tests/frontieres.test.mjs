// Banc du raboutage des frontières de la carte (web/js/map.js, chainSegments, lineChunks) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les frontières sortent des carrés marchants en milliers de petits segments ; tracés un à
// un, ils coûtaient la moitié de chaque image. Raboutés, ils doivent garder tous leurs points, sans en perdre ni en
// doubler, et donner une ligne par contour ; découpés en morceaux, ils doivent se recouvrir d'un point (sans trou).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Path2D = class { moveTo() {} lineTo() {} };
const { chainSegments, lineChunks } = await import('../web/js/map.js');

const P = k => [k, k * 10, k];   // un point sur l'arête k

test('une ligne ouverte part de son bout, dans le désordre et à l’envers', () => {
  const lines = chainSegments([[P(2), P(3)], [P(1), P(0)], [P(2), P(1)]]);
  assert.equal(lines.length, 1);
  const xs = lines[0].map(p => p[0]).join();
  assert.ok(xs === '0,1,2,3' || xs === '3,2,1,0', xs);
});

test('une boucle et une ligne : deux tracés, chaque segment une fois', () => {
  const segs = [[P(0), P(1)], [P(1), P(2)], [P(2), P(0)], [P(5), P(6)], [P(7), P(6)]];
  const lines = chainSegments(segs);
  assert.equal(lines.length, 2);
  assert.equal(lines.reduce((n, l) => n + l.length - 1, 0), segs.length);
});

test('les morceaux se suivent sans trou, chacun avec son emprise', () => {
  const line = Array.from({ length: 100 }, (_, i) => [i, i % 7]);
  const parts = lineChunks([line]);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(c => [c.box[0], c.box[2]]), [[0, 48], [48, 96], [96, 99]]);
  assert.deepEqual(parts[0].box.slice(1).filter((v, k) => k !== 1), [0, 6]);
});
