// Banc des découvertes (web/js/decouvertes.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Chaque technologie a sa vignette animée, tirée d'une dizaine de familles : une
// technologie sans famille ouvrirait une fenêtre vide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { famille } from '../web/js/decouvertes.js';

const FAMS = ['vapeur', 'canon', 'moisson', 'vigne', 'telegraphe', 'forge', 'phare', 'medecine', 'livre'];
test('chaque technologie a une famille de vignette', () => {
  assert.equal(famille({ id: 'chemins_fer', branch: 'civil' }), 'vapeur');
  assert.equal(famille({ id: 'chappe', branch: 'civil' }), 'telegraphe');
  assert.equal(famille({ id: 'greffe', branch: 'agricole' }), 'vigne');
  assert.equal(famille({ id: 'assolement', branch: 'agricole' }), 'moisson');
  assert.equal(famille({ id: 'lahitte', branch: 'militaire' }), 'canon');
  assert.equal(famille({ id: 'coke', branch: 'industriel' }), 'forge');
  assert.equal(famille({ id: 'fresnel', branch: 'industriel' }), 'phare');
  assert.equal(famille({ id: 'vaccine', branch: 'civil' }), 'medecine');
  assert.equal(famille({ id: 'ecoles', branch: 'civil' }), 'livre');
  for (const b of ['militaire', 'civil', 'industriel', 'agricole']) assert.ok(FAMS.includes(famille({ id: 'x', branch: b })));
});
