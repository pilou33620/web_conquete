// Banc des gestes de la vue tactique (web/js/battle/commandes.js) : la ligne d'arrivée du clic droit glissé et la
// formation gardée du clic droit simple. node --test tests/
//
// POURQUOI CE BANC EXISTE. Façon Total War, la ligne tracée de gauche à droite à l'écran fait face vers le haut ; les
// unités s'y rangent dans l'ordre où elles sont déjà (sans se croiser), et une ligne trop courte les met en rangs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineSlots, spread } from '../web/js/battle/commandes.js';

const u = (id, x, y, o = {}) => ({ id, x, y, dir: 0, w: 100, d: 12, ...o });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);

test('ligne de gauche à droite : face vers le haut, front sur la ligne, rangées dans leur ordre actuel', () => {
  // B est à gauche de A aujourd'hui : il prend la place de gauche
  const s = lineSlots([u('A', 300, 500), u('B', -200, 500)], [0, 0], [400, 0]);
  assert.deepEqual(s.map(d => d.u.id), ['B', 'A']);
  for (const d of s) { near(d.dir, -Math.PI / 2); near(d.y, 6); }   // le front (y = 0) sur la ligne
  // la longueur de la ligne règle la largeur du front : les deux unités en occupent les bouts
  near(s[0].x, 50); near(s[1].x, 350);
});

test('ligne tracée dans l’autre sens : elles font face vers le bas, toujours sans se croiser', () => {
  const s = lineSlots([u('A', 300, 0), u('B', 0, 0)], [400, 100], [0, 100]);
  for (const d of s) near(d.dir, Math.PI / 2);
  assert.deepEqual(s.map(d => d.u.id), ['A', 'B']);   // de a (à droite) vers b : A d'abord
  assert.ok(s[0].x > s[1].x);
});

test('ligne trop courte : un deuxième rang derrière le premier', () => {
  const s = lineSlots([u('A', 0, 0), u('B', 50, 0), u('C', 100, 0)], [0, 0], [220, 0]);
  const r1 = s.filter(d => d.y < 10), r2 = s.filter(d => d.y > 10);
  assert.equal(r1.length, 2); assert.equal(r2.length, 1);
  near(r1[1].x - r1[0].x, 110);                       // côte à côte, à l'intervalle minimal
  near(r2[0].y, 12 + 10 + 6);                          // derrière, en arrière de la profondeur du premier rang
  assert.equal(r2[0].u.id, 'C');
});

test('une unité seule : au milieu de la ligne', () => {
  const [d] = lineSlots([u('A', 0, 0)], [0, 0], [0, 300]);
  near(d.x, -6); near(d.y, 150); near(d.dir, 0);      // ligne vers le bas : face à droite (gauche du tracé)
});

test('clic droit simple : formation translatée au point et tournée vers la marche', () => {
  // deux unités côte à côte face au nord ; on les envoie vers l'est
  const us = [u('A', -60, 0, { dir: -Math.PI / 2 }), u('B', 60, 0, { dir: -Math.PI / 2 })];
  const s = spread(us, 1000, 0, 0);
  for (const d of s) { near(d.dir, 0); near(d.x, 1000); }
  near(s[0].y, -60); near(s[1].y, 60);                 // A à gauche de la marche (nord), B à droite
});
