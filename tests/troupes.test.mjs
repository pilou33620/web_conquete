// Banc des dispositions des troupes 3D (web/js/battle/troupes.js, layout) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Chaque figurine du champ de bataille est placée par layout() : rangs de la ligne, carré à
// quatre faces tournées vers l'extérieur, tirailleurs dispersés, déroute éparpillée, porte-drapeau au premier rang.
// Une erreur (un carré dont une face manque, des hommes hors de l'emprise, un drapeau absent) se voit mal à l'écran
// au milieu de milliers de figurines et ne fait rien planter. Ici on compte et on mesure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, POSES } from '../web/js/battle/troupes.js';

// régiment comme l'envoie le serveur (w, d : emprise en m)
const reg = (extra = {}) => ({ id: 'r1', type: 'ligne', cls: 'inf', men: 450, men0: 450, form: 'ligne', state: 'repos', w: 180, d: 12, ...extra });
// [u, v, sorte, face, pose, rang, phase]
const kinds = lay => lay.reduce((o, f) => { o[f[2]] = (o[f[2]] || 0) + 1; return o; }, {});

test('au-delà de 480 hommes, une figurine en compte plusieurs (plafond par régiment)', () => {
  const k = kinds(layout(reg({ men: 900, w: 360 }), 1));
  assert.equal(k.inf + k.drapeau, 480);
});

test('ligne : un homme par figurine, trois rangs, porte-drapeau au premier rang, tambours, officiers, colonel', () => {
  const lay = layout(reg(), 1), k = kinds(lay);
  assert.equal(k.drapeau, 1);
  assert.equal(k.tambour, 2);
  assert.equal(k.officier, 2);
  assert.equal(k.colonel, 1);
  assert.equal(k.inf + k.drapeau, 450, 'les 450 hommes sont là (le porte-drapeau en est un)');
  const ranks = new Set(lay.filter(f => f[5] >= 0).map(f => f[5]));
  assert.deepEqual([...ranks].sort(), [0, 1, 2]);
  const flag = lay.find(f => f[2] === 'drapeau');
  assert.ok(Math.abs(flag[0]) < 2, 'le drapeau est au milieu du front');
  // tous dans l'emprise (à un demi-intervalle près), sauf l'encadrement derrière
  for (const f of lay.filter(f => f[5] >= 0)) assert.ok(Math.abs(f[0]) <= 91 && Math.abs(f[1]) <= 6, `figurine en (${f[0]}, ${f[1]})`);
});

test('plus d’hommes que le budget : chaque figurine en compte plusieurs', () => {
  const k = kinds(layout(reg(), 4));
  assert.ok(k.inf + k.drapeau > 100 && k.inf + k.drapeau < 125);
});

test('carré : quatre faces tournées vers l’extérieur, drapeau au milieu', () => {
  const lay = layout(reg({ form: 'carre', w: 40, d: 40 }), 1);
  const faces = lay.filter(f => f[2] === 'inf');
  for (const fo of [0, 1, 2, 3]) assert.ok(faces.filter(f => f[3] === fo).length > 30, `face ${fo}`);
  // la face 0 regarde devant (v > 0), la face 2 derrière
  assert.ok(faces.filter(f => f[3] === 0).every(f => f[1] > 0));
  assert.ok(faces.filter(f => f[3] === 2).every(f => f[1] < 0));
  const flag = lay.find(f => f[2] === 'drapeau');
  assert.ok(Math.hypot(flag[0], flag[1]) < 3);
});

test('colonne : plus de rangs que de files, dans la profondeur de l’emprise', () => {
  const lay = layout(reg({ form: 'colonne', w: 30, d: 60 }), 1).filter(f => f[2] === 'inf');
  const ranks = new Set(lay.map(f => f[5]));
  assert.ok(ranks.size > 10);
  for (const f of lay) assert.ok(Math.abs(f[1]) <= 31);
});

test('tirailleurs : dispersés dans l’emprise', () => {
  const lay = layout(reg({ type: 'legere', form: 'tirailleurs', w: 250, d: 40, men: 300 }), 1).filter(f => f[2] === 'leger');
  assert.equal(lay.length, 300);
  const xs = lay.map(f => f[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 180, 'étalés sur le front');
  for (const f of lay) assert.ok(Math.abs(f[1]) <= 21);
});

test('déroute : éparpillés bien au-delà de l’emprise, dos à l’ennemi, en fuite', () => {
  const lay = layout(reg({ state: 'deroute' }), 1).filter(f => f[2] === 'inf');
  const ys = lay.map(f => f[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 30, 'dispersés en profondeur');
  assert.ok(lay.every(f => f[3] === 2 && f[4] === POSES.ROUT));
});

test('la disposition est la même d’une image à l’autre (pas de figurines qui sautent)', () => {
  assert.deepEqual(layout(reg(), 1), layout(reg(), 1));
});
