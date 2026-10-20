// Banc du piétinement (web/js/battle/pietinement.js, depot) : node --test tests/
//
// POURQUOI CE BANC EXISTE. La boue doit venir des troupes qui bougent ou se battent, pas des régiments au repos ni des
// généraux, et marquer plus sous les sabots et les roues que sous les pieds : une erreur ici couvrirait le champ de
// boue dès le déploiement, ou n'en laisserait jamais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depot } from '../web/js/battle/pietinement.js';

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
