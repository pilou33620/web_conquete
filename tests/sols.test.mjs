// Banc des sols photo (étape 9b : sols.js, terrain.js solParts, qualite.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le shader du sol lit huit parts dans deux masques et suppose qu'elles font 1 (0 sous
// l'eau) : une part oubliée laisserait un sol sans matière, une part en trop l'assombrirait, une faute de nom
// enverrait la roche dans un pré. Les fichiers d'images doivent aussi être là, avec leur licence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLS, FORCE } from '../web/js/battle/sols.js';
import { solParts } from '../web/js/battle/terrain.js';
import { T, CELL_NAMES } from '../web/js/battle/formes.js';
import { CULTURES } from '../web/js/battle/textures.js';
import { PROFILS, QUALITES, solPx } from '../web/js/battle/qualite.js';

const somme = p => Object.values(p).reduce((a, b) => a + b, 0);

test('huit sols, chacun avec sa force', () => {
  assert.equal(SOLS.length, 8, 'deux masques RGBA : huit canaux');
  assert.equal(FORCE.length, 8);
  assert.ok(FORCE.every(f => f > 0 && f <= 1));
});

test('chaque sorte de terrain a ses parts : elles font 1, sauf sous l’eau (0) et sur les routes (tracées à part)', () => {
  for (const name of CELL_NAMES) {
    const v = T[name], p = solParts(v, name === 'PRE' ? 'herbe' : '');
    if (v === T.ROUTE || v === T.CHEMIN) { assert.equal(p, null, name); continue; }
    for (const k of Object.keys(p)) assert.ok(SOLS.includes(k), `${name} : sol inconnu ${k}`);
    assert.ok(Math.abs(somme(p) - (v === T.EAU ? 0 : 1)) < 1e-9, `${name} : ${JSON.stringify(p)}`);
  }
});

test('toutes les cultures de toutes les saisons ont leurs parts', () => {
  for (const list of Object.values(CULTURES)) for (const [c] of list) {
    const p = solParts(T.CHAMP, c);
    assert.ok(Math.abs(somme(p) - 1) < 1e-9, c);
  }
  assert.ok(solParts(T.CHAMP, 'labour').terre === 1, 'un labour est de la terre');
  assert.ok(solParts(T.CHAMP, 'ble').sec === 1, 'le blé mûr est de l’herbe sèche');
});

test('les images des sols et leur licence sont là', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'textures', 'sols');
  for (const s of SOLS) for (const k of ['couleur', 'normale', 'hauteur']) assert.ok(fs.existsSync(path.join(dir, `${s}_${k}.jpg`)), `${s}_${k}.jpg`);
  const lic = fs.readFileSync(path.join(dir, 'LICENCE.txt'), 'utf8');
  assert.match(lic, /CC0/);
  for (const s of SOLS) assert.match(lic, new RegExp(`^\\s+${s}\\s`, 'm'), `licence : ${s}`);
});

test('qualités : après-rendu et sols photo montent avec le niveau', () => {
  const p = QUALITES.map(q => PROFILS[q]);
  for (let i = 1; i < p.length; i++) assert.ok(p[i].post >= p[i - 1].post && p[i].sols >= p[i - 1].sols, QUALITES[i]);
  assert.equal(PROFILS.basse.post, 0, 'Basse : rendu direct');
  assert.equal(solPx(PROFILS.basse), 512);
  assert.equal(solPx(PROFILS.haute), 1024);
});
