// Banc du relief et de la lumière (web/js/battle/horizon.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. L'ombre des collines et l'occlusion des vallées sortent de ces grilles : une direction
// inversée mettrait l'ombre du côté du soleil, une normale de travers éclairerait les pentes à l'envers, et rien ne
// planterait. Ici, sur une colline fabriquée, on vérifie le sens des horizons, des normales et de l'occlusion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizons, normales, DIRS } from '../web/js/battle/horizon.js';

const W = 1000, H = 600;
// une colline de 60 m en (500, 300), de 150 m de rayon
const hill = (x, y) => 60 * Math.exp(-((x - 500) ** 2 + (y - 300) ** 2) / 150 ** 2);
const hz = horizons(hill, W, H, 10);
const at = (arr, x, y, k) => arr[(Math.round(y / hz.G) * hz.nx + Math.round(x / hz.G)) * 4 + k];
const angle = (x, y, k) => at(k < 4 ? hz.a : hz.b, x, y, k & 3) / 255 * 90;

test('huit directions, une tous les 45°', () => {
  assert.equal(DIRS.length, 8);
  DIRS.forEach(([dx, dy], k) => assert.ok(Math.abs(Math.atan2(dy, dx) - (k <= 4 ? k : k - 8) * Math.PI / 4) < 1e-9, `direction ${k}`));
});

test('en plaine, l’horizon est plat et tout le ciel se voit', () => {
  const flat = horizons(() => 12, 300, 200, 10);
  assert.ok(flat.a.every(v => v === 0) && flat.b.every(v => v === 0));
  assert.ok(flat.ao.every(v => v === 1));
});

test('à l’ouest de la colline, l’horizon est haut vers l’est et bas vers l’ouest', () => {
  const est = angle(300, 300, 0), ouest = angle(300, 300, 4);
  assert.ok(est > 10, `vers la colline : ${est.toFixed(1)}°`);
  assert.ok(ouest < 1, `dos à la colline : ${ouest.toFixed(1)}°`);
  // au sud (y plus grand), la colline est vers le nord : direction 6 (0, −1)
  assert.ok(angle(500, 520, 6) > 8 && angle(500, 520, 2) < 1);
});

test('le sommet voit tout le ciel, le pied de la colline moins', () => {
  const ao = (x, y) => hz.ao[Math.round(y / hz.G) * hz.nx + Math.round(x / hz.G)];
  assert.ok(ao(500, 300) > 0.99, 'sommet');
  assert.ok(ao(330, 300) < ao(100, 300), 'pied de la colline');
});

test('les normales penchent vers l’extérieur de la colline, et sont verticales au sommet', () => {
  const nm = normales(hill, W, H, hz, 5);
  const n = (x, y) => { const k = (Math.round(y / nm.G) * nm.nx + Math.round(x / nm.G)) * 4; return [nm.data[k], nm.data[k + 1], nm.data[k + 2]]; };
  const [ex] = n(600, 300), [wx] = n(400, 300), [, sz] = n(500, 400), [tx, tz] = n(500, 300);
  assert.ok(ex > 0.1 && wx < -0.1, 'versant est vers +x, versant ouest vers −x');
  assert.ok(sz > 0.1, 'versant sud vers +y');
  assert.ok(Math.abs(tx) < 0.01 && Math.abs(tz) < 0.01, 'sommet');
  assert.ok(n(330, 300)[2] < 1, 'l’occlusion suit');
});
