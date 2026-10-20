// Banc de la ligne de vue du navigateur (web/js/battle/visibilite.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le mode « ligne de vue » montre ce que voit un régiment ; il doit dire la même chose que
// le moteur (game/tactics/battle.py, los), sinon le joueur verrait clair là où son régiment ne tire pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ligneDeVue, champDeVision } from '../web/js/battle/visibilite.js';
import { CELL_NAMES } from '../web/js/battle/formes.js';

const T = Object.fromEntries(CELL_NAMES.map((n, i) => [n, i]));
function grille(cols, rows, f) {
  const t = new Uint8Array(cols * rows), h = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const [tt, hh] = f(i, j); t[j * cols + i] = tt; h[j * cols + i] = hh; }
  return { cols, rows, t, h };
}

test('en rase campagne, tout se voit', () => {
  const g = grille(40, 10, () => [T.PRE ?? 0, 10]);
  assert.ok(ligneDeVue(g, 5 * 40 + 2, 5 * 40 + 37));
});

test('une crête coupe le regard, un bois épais aussi ; la lisière voit dehors', () => {
  const crete = grille(40, 10, i => [0, i === 20 ? 30 : 10]);
  assert.equal(ligneDeVue(crete, 5 * 40 + 2, 5 * 40 + 37), false);
  const bois = grille(40, 10, i => [i >= 15 && i <= 22 ? T.BOIS : 0, 10]);
  assert.equal(ligneDeVue(bois, 5 * 40 + 2, 5 * 40 + 37), false, 'huit cases de bois bouchent la vue');
  const lisiere = grille(40, 10, i => [i <= 3 ? T.BOIS : 0, 10]);
  assert.ok(ligneDeVue(lisiere, 5 * 40 + 2, 5 * 40 + 37), 'une troupe en lisière voit dehors');
  assert.equal(ligneDeVue(bois, 5 * 40 + 2, 5 * 40 + 37), ligneDeVue(bois, 5 * 40 + 37, 5 * 40 + 2), 'la même dans les deux sens');
});

test('le champ de vision : vu devant, caché derrière la crête, rien hors de portée', () => {
  const g = grille(60, 20, i => [0, i === 30 ? 40 : 10]);
  const c0 = 10 * 60 + 10, vu = champDeVision(g, c0, 2.5, 40);
  assert.equal(vu[10 * 60 + 25], 1);
  assert.equal(vu[10 * 60 + 45], 0);
  assert.equal(vu[10 * 60 + 59], 0, 'hors de portée');
});
