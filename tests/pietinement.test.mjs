// Banc du piétinement (web/js/battle/pietinement.js, depot) : node --test tests/
//
// POURQUOI CE BANC EXISTE. La boue doit venir des troupes qui bougent ou se battent, pas des régiments au repos ni des
// généraux, et marquer plus sous les sabots et les roues que sous les pieds : une erreur ici couvrirait le champ de
// boue dès le déploiement, ou n'en laisserait jamais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depot, opacite, Pietinement } from '../web/js/battle/pietinement.js';

const inf = { cls: 'inf', men: 500, state: 'marche' };

test('au repos, pas de boue ; en marche, un régiment de ligne en laisse un tiers en passant', () => {
  assert.equal(depot({ ...inf, state: 'repos' }, 0), 0);
  const r = depot(inf, 1.2);
  assert.ok(r > 0);
  const passage = (10 + 6) / 1.2;   // profondeur de la formation et marge de la tache, à 1,2 m/s
  assert.ok(r * passage > 0.25 && r * passage < 0.5, `${(r * passage).toFixed(2)}`);
});

test('la cavalerie et l’artillerie marquent plus ; la pluie double ; ni général, ni régiment disparu', () => {
  assert.ok(depot({ ...inf, cls: 'cavalerie' }, 4) > depot(inf, 1.2) * 3);
  assert.ok(depot({ ...inf, cls: 'artillerie', men: 80 }, 1) > depot(inf, 1.2));
  assert.equal(depot(inf, 1.2, true), depot(inf, 1.2) * 2);
  assert.equal(depot({ ...inf, cls: 'general' }, 3), 0);
  assert.equal(depot({ ...inf, state: 'hors' }, 1.2), 0);
  assert.equal(depot({ ...inf, _ghost: true }, 1.2), 0);
});

test('la mêlée foule le sol même sur place ; un petit régiment marque moins', () => {
  assert.ok(depot({ ...inf, state: 'melee' }, 0) > 0);
  assert.ok(depot({ ...inf, men: 100 }, 1.2) < depot(inf, 1.2));
});

test('la terre foulée : légère après un passage, sombre seulement sous un long combat ; les trous restent légers', () => {
  assert.ok(Math.abs(opacite(1 / 3) - 0.15) < 0.01 && opacite(0) === 0 && opacite(1) > 0.4);
  const p = new Pietinement(3000, 2000, { fx: 2 }), at = (x, y) => p.m[Math.floor(y / p.res) * p.w + Math.floor(x / p.res)];
  // un régiment de ligne qui passe (1,2 m/s) ; deux qui se battent cinq minutes
  for (let x = 100; x < 400; x += 0.24) p.update([{ ...inf, x, y: 300, dir: 0, w: 120, d: 10, from: { x: 0, y: 0 }, to: { x: 1.2, y: 0 } }], 1, false, 0.2, 1);
  const melee = { ...inf, state: 'melee', x: 1500, y: 1000, dir: 0, w: 120, d: 10, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
  for (let k = 0; k < 1500; k++) p.update([melee, melee], 1, false, 0.2, 1);
  assert.ok(opacite(at(250, 300)) < 0.2, `un passage : ${opacite(at(250, 300)).toFixed(2)}`);
  assert.ok(opacite(at(1500, 1000)) > 0.3, `un long combat : ${opacite(at(1500, 1000)).toFixed(2)}`);
  // cent obus au même endroit
  for (let k = 0; k < 100; k++) { p.stamp(2500, 1500, 2); p.update([], 1, false, 0.2, 1); }
  assert.ok(at(2500, 1500) > 0 && at(2500, 1500) <= 0.25);
});
