// Banc des tuiles de secours de la carte (web/js/map.js, drawFallback) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Tant qu'une tuile n'est pas peinte, la carte montre à sa place celles d'un autre niveau
// de zoom. S'il en manque une seule, il faut passer au niveau suivant : en dessiner une partie laissait des bandes
// noires dans la carte (vues sur PC en dézoomant).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Path2D = class { moveTo() {} lineTo() {} };
const { MapView } = await import('../web/js/map.js');

function fausseCarte(present, prevL = null) {
  const drawn = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, drawImage: t => drawn.push(t) };
  const map = Object.assign(Object.create(MapView.prototype), {
    prevL,
    getTile: (L, i, j) => (present(L, i, j) ? `${L}:${i}:${j}` : null),
  });
  return { map, ctx, drawn };
}

test('une tuile du niveau fin manque sur la 1re rangée : on passe à un autre niveau, en entier', () => {
  // tuile (0, 0) du niveau 8, qu'on vient de quitter pour le 16 (essayé en premier) : il y en faut 2×2, (0, 0) manque
  const { map, ctx, drawn } = fausseCarte((L, i, j) => L !== 16 || i !== 0 || j !== 0, 16);
  map.drawFallback(ctx, 8, 0, 0, 0, 0, 1);
  assert.ok(drawn.length > 0);
  assert.ok(drawn.every(t => !t.startsWith('16:')), drawn.join());
});

test('toutes les tuiles du niveau voisin sont là : elles couvrent la tuile', () => {
  const { map, ctx, drawn } = fausseCarte(() => true);
  map.drawFallback(ctx, 8, 0, 0, 0, 0, 1);
  assert.deepEqual(drawn, ['6:0:0']);
});
