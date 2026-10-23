// Banc du lot de dessins de la carte (web/js/lot.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Moulins, voyageurs, habitants et drapeaux ne sont plus dessinés un à un mais mis en lot,
// un tracé par style et par rang dans la figure. Il faut que chaque figure garde son ordre (le toit sur le mur), que
// les points arrivent au bon endroit (déplacement, miroir des voyageurs qui vont à gauche) et que deux figures ne
// soient jamais reliées par un trait parasite.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeMatrix {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { Object.assign(this, { a, b, c, d, e, f }); }
  mul(o) { return new FakeMatrix(this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b, this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d, this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f); }
  translate(x, y) { return this.mul(new FakeMatrix(1, 0, 0, 1, x, y)); }
  scale(x, y) { return this.mul(new FakeMatrix(x, 0, 0, y, 0, 0)); }
  rotate(deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return this.mul(new FakeMatrix(c, s, -s, c, 0, 0)); }
}
class FakePath {
  constructor() { this.ops = []; }
  moveTo(...a) { this.ops.push(['M', ...a]); } lineTo(...a) { this.ops.push(['L', ...a]); }
  quadraticCurveTo(...a) { this.ops.push(['Q', ...a]); } closePath() { this.ops.push(['Z']); } ellipse(...a) { this.ops.push(['E', ...a]); }
}
globalThis.DOMMatrix = FakeMatrix;
globalThis.Path2D = FakePath;
const { Lot } = await import('../web/js/lot.js');

function fauxCtx() {
  const ops = [];
  return { ops, save() {}, restore() {}, fill(p) { ops.push(['fill', this.fillStyle, p]); }, stroke(p) { ops.push(['stroke', this.strokeStyle, this.lineWidth, p]); } };
}

test('deux figures : un tracé par style et par rang, dans l’ordre de chaque figure', () => {
  const lot = new Lot(), ctx = fauxCtx();
  for (const x of [0, 100]) {
    lot.next();
    lot.fillStyle = 'mur'; lot.fillRect(x, 0, 10, 10);
    lot.strokeStyle = 'trait'; lot.lineWidth = 2; lot.beginPath(); lot.moveTo(x, 0); lot.lineTo(x + 10, 0); lot.stroke();
    lot.fillStyle = 'toit'; lot.beginPath(); lot.moveTo(x, 0); lot.lineTo(x + 5, -5); lot.lineTo(x + 10, 0); lot.closePath(); lot.fill();
  }
  lot.flush(ctx);
  assert.deepEqual(ctx.ops.map(o => o[1]), ['mur', 'trait', 'toit']);
  assert.equal(ctx.ops[0][2].ops.filter(o => o[0] === 'M').length, 2);   // les deux murs dans le même tracé
  lot.flush(ctx);
  assert.equal(ctx.ops.length, 3);   // le lot repart vide
});

test('les points sont placés par le déplacement, et l’épaisseur suit l’échelle', () => {
  const lot = new Lot(), ctx = fauxCtx();
  lot.translate(10, 5); lot.scale(2, 2);
  lot.next(); lot.lineWidth = 1.5; lot.beginPath(); lot.moveTo(1, 2); lot.lineTo(3, 2); lot.stroke();
  lot.flush(ctx);
  assert.deepEqual(ctx.ops[0][3].ops, [['M', 12, 9], ['L', 16, 9]]);
  assert.equal(ctx.ops[0][2], 3);
});

test('dans un miroir, un arc part du point mirroir et tourne dans l’autre sens', () => {
  const lot = new Lot(), ctx = fauxCtx();
  lot.translate(50, 0); lot.scale(-1, 1);
  lot.next(); lot.beginPath(); lot.arc(10, 0, 4, 0, Math.PI / 2); lot.fill();
  lot.flush(ctx);
  const [, x, y, rx, ry, rot, a0, a1, ccw] = ctx.ops[0][2].ops.find(o => o[0] === 'E');
  const pt = a => [x + rx * Math.cos(a + rot), y + ry * Math.sin(a + rot)];
  assert.deepEqual([x, y], [40, 0]);
  assert.ok(Math.abs(pt(a0)[0] - 36) < 1e-9 && Math.abs(pt(a0)[1]) < 1e-9);   // le départ (14, 0) passe en (36, 0)
  assert.ok(Math.abs(pt(a1)[0] - 40) < 1e-9 && Math.abs(pt(a1)[1] - 4) < 1e-9);   // l'arrivée (10, 4) passe en (40, 4)
  assert.equal(ccw, true);
});

test('deux figures ne sont jamais reliées : chacune commence un nouveau morceau', () => {
  const lot = new Lot(), ctx = fauxCtx();
  for (const x of [0, 100]) { lot.next(); lot.beginPath(); lot.lineTo(x, 0); lot.lineTo(x, 9); lot.stroke(); }
  for (const x of [0, 100]) { lot.next(); lot.beginPath(); lot.arc(x, 0, 2, 0, Math.PI * 2); lot.fill(); }
  lot.flush(ctx);
  assert.deepEqual(ctx.ops[0][3].ops.map(o => o[0]).join(''), 'MLML');
  assert.deepEqual(ctx.ops[1][2].ops.map(o => o[0]).join(''), 'MEME');
});
