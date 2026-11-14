// Chevaux sans cavalier, blessés, brancardiers (web/js/battle/errants.js) : la logique, sans écran.
//   node --test tests/errants.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Errants, E } from '../web/js/battle/errants.js';

const morts = n => Array.from({ length: n }, (_, i) => ({ k: 'mort', x: 1500 + i, y: 1000 }));
const toujours = () => 0;        // le tirage le plus bas : chaque tué laisse un cheval ou un blessé qui rampe
const jamais = () => 0.999;

test('la cavalerie laisse des chevaux sans cavalier, pas plus de trente', () => {
  const e = new Errants(3000, 2000, toujours);
  e.pertes({ dir: 0, side: 0 }, morts(50), true);
  assert.equal(e.compte(E.CHEVAL), 30);
  assert.equal(e.blesses(), 0);
});
test('le hasard peut ne rien laisser ; les débris ne comptent pas', () => {
  const e = new Errants(3000, 2000, jamais);
  e.pertes({ dir: 0, side: 0 }, morts(20), false);
  e.pertes({ dir: 0, side: 0 }, [{ k: 'chapeau', x: 1, y: 1 }], false);
  assert.equal(e.liste.length, 0);
});
test('le cheval s’enfuit vers l’arrière, ralentit, puis broute', () => {
  const e = new Errants(3000, 2000, () => 0.5);   // (0,5 : ni écart de cap, ni dérive)
  e.liste.push({ k: E.CHEVAL, x: 1500, y: 1000, a: Math.PI, v: 9, age: 0, ph: 0, side: 0 });
  for (let i = 0; i < 10; i++) e.pas(1);
  const c = e.liste[0];
  assert.ok(c.x < 1500 - 80, 'il a galopé vers l’ouest');
  for (let i = 0; i < 60; i++) e.pas(1);
  const x = c.x; e.pas(5);
  assert.equal(c.v, 0); assert.equal(c.x, x, 'il broute sur place');
});
test('le blessé rampe, s’arrête, les brancardiers l’emportent', () => {
  const e = new Errants(3000, 2000, toujours);
  e.pertes({ dir: 0, side: 1 }, morts(1), false);
  assert.equal(e.compte(E.RAMPE), 1);
  for (let i = 0; i < 40; i++) e.pas(1);   // (vie : 25 s au tirage le plus bas)
  assert.equal(e.compte(E.GISANT), 1);
  assert.equal(e.compte(E.BRANCARD), 1, 'une équipe est partie le chercher');
  for (let i = 0; i < 600 && e.liste.length; i++) e.pas(0.5);
  assert.equal(e.liste.length, 0, 'le blessé est emporté, l’équipe rentrée');
});
test('en pause, rien ne bouge ; hors du champ, on disparaît', () => {
  const e = new Errants(3000, 2000, () => 0.5);
  e.liste.push({ k: E.BOITE, x: 5, y: 1000, a: Math.PI, v: 0.9, age: 0, ph: 0, vie: 99, side: 0 });
  e.pas(0); assert.equal(e.liste[0].x, 5);
  for (let i = 0; i < 60; i++) e.pas(1);
  assert.equal(e.liste.length, 0);
});
