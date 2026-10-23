// Banc du raboutage des frontières de la carte (web/js/map.js, chainSegments) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les frontières sortent des carrés marchants en milliers de petits segments ; tracés un à
// un, ils coûtaient la moitié de chaque image. Raboutés, ils doivent garder tous leurs points, sans en perdre ni en
// doubler, et donner une ligne par contour.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakePath { constructor() { this.ops = []; } moveTo(x, y) { this.ops.push(['M', x, y]); } lineTo(x, y) { this.ops.push(['L', x, y]); } }
globalThis.Path2D = FakePath;
const { chainSegments } = await import('../web/js/map.js');

const P = k => [k, k * 10, k];   // un point sur l'arête k

test('une ligne ouverte part de son bout, dans le désordre et à l’envers', () => {
  const ops = chainSegments([[P(2), P(3)], [P(1), P(0)], [P(2), P(1)]]).ops;
  assert.deepEqual(ops.map(o => o[0]).join(''), 'MLLL');
  const ks = ops.map(o => o[1]);
  assert.ok(ks.join() === '0,1,2,3' || ks.join() === '3,2,1,0', ks.join());
});

test('une boucle et une ligne : deux tracés, chaque segment une fois', () => {
  const segs = [[P(0), P(1)], [P(1), P(2)], [P(2), P(0)], [P(5), P(6)], [P(7), P(6)]];
  const ops = chainSegments(segs).ops;
  assert.equal(ops.filter(o => o[0] === 'M').length, 2);
  assert.equal(ops.filter(o => o[0] === 'L').length, segs.length);
});
