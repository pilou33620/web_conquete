// Banc des sols photo (étape 9b : sols.js, qualite.js) : node --test tests/
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
import { PROFILS, QUALITES, solPx } from '../web/js/battle/qualite.js';

test('huit sols, chacun avec sa force', () => {
  assert.equal(SOLS.length, 8, 'deux masques RGBA : huit canaux');
  assert.equal(FORCE.length, 8);
  assert.ok(FORCE.every(f => f > 0 && f <= 1));
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
