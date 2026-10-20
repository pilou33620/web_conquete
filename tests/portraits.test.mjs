// Banc des portraits des régiments (web/js/portraits.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les cartes en portrait de la bataille et celles de la campagne tirent leur figure de la
// même règle : un régiment doit avoir la même figure des deux côtés (piquiers avant la baïonnette, pièce de son
// époque, cavalier pour le général).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureKind, traitsGeneral } from '../web/js/portraits.js';

test('la figure suit l’arme, le type et l’époque', () => {
  assert.equal(figureKind({ cls: 'inf', type: 'ligne', arm: 0 }), 'piquier');
  assert.equal(figureKind({ cls: 'inf', type: 'ligne', arm: 2 }), 'inf');
  assert.equal(figureKind({ cls: 'inf', type: 'legere', light: true, arm: 2 }), 'leger');
  assert.equal(figureKind({ cls: 'inf', type: 'grenadiers', arm: 2 }), 'gren');
  assert.equal(figureKind({ cls: 'inf', type: 'milice', arm: 2 }), 'milice');
  assert.equal(figureKind({ cls: 'cavalerie', type: 'cavalerie' }), 'cav');
  assert.equal(figureKind({ cls: 'inf', type: 'ligne', general: true }), 'cav');
  assert.equal(figureKind({ cls: 'artillerie', type: 'artillerie', arm: 2 }), 'canon.gribeauval');
  assert.equal(figureKind({ cls: 'artillerie', type: 'artillerie', arm: 99 }), 'canon.75');
  assert.equal(figureKind({ cls: 'artillerie', type: 'mitrailleuses', arm: 5 }), 'canon.reffye');
});

test('portrait d’un général : la coiffure suit l’époque, le visage suit le nom', () => {
  assert.equal(traitsGeneral('Lamothe', 1700).coiffe, 'tricorne');
  assert.equal(traitsGeneral('Lamothe', 1700).cheveux, 'perruque');
  assert.equal(traitsGeneral('Lamothe', 1805).coiffe, 'bicorne');
  assert.equal(traitsGeneral('Lamothe', 1870).coiffe, 'kepi');
  assert.deepEqual(traitsGeneral('Lamothe', 1805), traitsGeneral('Lamothe', 1805), 'le même général garde son visage');
  const v = new Set(['Lamothe', 'Duroc', 'Ney', 'Lannes', 'Murat', 'Soult', 'Suchet', 'Bessières'].map(n => JSON.stringify(traitsGeneral(n, 1870))));
  assert.ok(v.size >= 4, 'des visages variés');
});
