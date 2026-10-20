// Banc de la carte selon l'époque (web/js/epoque.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le drapeau des villes, la coiffure des passants et les vignes malades suivent l'année de
// la partie : une borne décalée d'un an mettrait le tricolore sous Louis XIV ou laisserait les vignes saines en 1880.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drapeauEpoque, coiffeEpoque, phylloxera } from '../web/js/epoque.js';

test('le drapeau de chaque époque', () => {
  assert.equal(drapeauEpoque(1700), 'roi');
  assert.equal(drapeauEpoque(1789), 'roi');
  assert.equal(drapeauEpoque(1790), 'tricolore');
  assert.equal(drapeauEpoque(1814), 'tricolore');
  assert.equal(drapeauEpoque(1815), 'blanc');
  assert.equal(drapeauEpoque(1829), 'blanc');
  assert.equal(drapeauEpoque(1830), 'tricolore');
  assert.equal(drapeauEpoque(1899), 'tricolore');
});

test('les passants changent de chapeau', () => {
  assert.equal(coiffeEpoque(1750), 'tricorne');
  assert.equal(coiffeEpoque(1805), 'bicorne');
  assert.equal(coiffeEpoque(1860), 'haut');
});

test('le phylloxéra frappe de 1875 aux plants greffés', () => {
  assert.equal(phylloxera(1870, new Set()), false);
  assert.equal(phylloxera(1880, new Set()), true);
  assert.equal(phylloxera(1880, new Set(['greffe'])), false);
  assert.equal(phylloxera(1880, null), true);
});
