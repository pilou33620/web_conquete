// Banc de la vue de bataille (web/js/battle/vue.js) : les lignes de front et le voile de la ligne de vue. node --test tests/
//
// POURQUOI CE BANC EXISTE. Vues de dessus, les lignes de front doivent rester calmes et lisibles : une bande par bord
// de régiment au contact, devant le bord tourné vers l'ennemi, de son côté du milieu, à la longueur de ce bord ; rien
// pour un régiment deviné, loin ou au repos. Le voile de la ligne de vue doit fondre ses bords (plus de marches de
// 20 m) sans assombrir ce qui est vu loin du bord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installer } from './dom.mjs';

installer();
const { fronts, voileDoux } = await import('../web/js/battle/vue.js');

const ligne = o => ({ id: 'a', side: 0, state: 'feu', target: 'b', x: 0, y: 0, dir: 0, w: 120, d: 12, ...o });

test('une bande par régiment au contact, devant son bord tourné vers l’autre, de son côté du milieu', () => {
  // deux lignes face à face sur l'axe des x, à 100 m : l'une tire (cible connue), l'autre non (le serveur tait sa cible)
  const a = ligne(), b = ligne({ id: 'b', side: 1, state: 'repos', target: null, x: 100, dir: Math.PI });
  const U = new Map([['a', a], ['b', b]]), get = id => U.get(id);
  const f = fronts(U.values(), get, 2);
  assert.equal(f.length, 2);
  for (const [u, band] of [[a, f.find(x => x.side === 0)], [b, f.find(x => x.side === 1)]]) {
    const mx = (band.x0 + band.x1) / 2, L = Math.hypot(band.x1 - band.x0, band.y1 - band.y0);
    assert.ok(Math.abs(band.x0 - band.x1) < 1e-9, 'parallèle au front (en travers de x)');
    assert.ok(Math.abs(mx - u.x) <= 50 && Math.abs(mx - u.x) >= 6 + 2 - 1e-9, `devant le bord, de son côté du milieu (${mx})`);
    assert.ok(Math.abs(L - 108) < 1e-6, 'à la longueur du front (90 %)');
    assert.ok((band.cx - mx) * (u === a ? 1 : -1) > 0 && Math.abs(band.cx - mx) < 7, 'à peine bombée vers l’ennemi');
  }
  // de flanc : la bande court le long du flanc tourné vers l'ennemi
  const c = ligne({ id: 'c', side: 1, state: 'repos', target: null, x: 0, y: 150 });
  a.target = 'c'; U.set('c', c);
  const g = fronts([a], get, 2)[0];
  assert.ok(Math.abs(g.y0 - g.y1) < 1e-9 && g.y0 > 60 && g.y0 < 75, `le long du flanc sud (${g.y0})`);
  assert.ok(Math.abs(Math.hypot(g.x1 - g.x0, 0) - 10.8) < 1e-6, 'à la profondeur du régiment');
  // mêlée : les bandes ne passent pas le milieu
  const m = fronts([ligne({ state: 'melee' })], () => ligne({ id: 'b', side: 1, x: 8, dir: Math.PI }), 4)[0];
  assert.ok((m.x0 + m.x1) / 2 < 4, 'de son côté du milieu');
});

test('pas de bande pour un régiment deviné, au repos, loin ou contre un ami', () => {
  const b = ligne({ id: 'b', side: 1, state: 'repos', target: null, x: 100, dir: Math.PI });
  const get = id => (id === 'b' ? b : null);
  assert.equal(fronts([ligne({ _ghost: true })], get, 2).length, 0);
  assert.equal(fronts([ligne({ state: 'marche' })], get, 2).length, 0);
  assert.equal(fronts([ligne({ x: -150 })], get, 2).length, 0, 'à plus de 200 m');
  assert.equal(fronts([ligne({ side: 1 })], get, 2).length, 0, 'un ami');
  assert.equal(fronts([ligne({ target: 'x' })], get, 2).length, 0, 'cible inconnue');
});

test('le voile de la ligne de vue a un bord fondu, plein loin du bord', () => {
  const cols = 20, rows = 10, vu = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < 10; i++) vu[j * cols + i] = 1;   // la moitié ouest est vue
  const { a, w, h } = voileDoux(vu, cols, rows);
  assert.equal(w, 80); assert.equal(h, 40);
  const ligneY = [...a.slice(20 * w, 21 * w)];
  assert.ok(ligneY[0] < 1e-6 && ligneY[w - 1] > 1 - 1e-6, 'vu à l’ouest, caché à l’est');
  for (let x = 1; x < w; x++) assert.ok(ligneY[x] >= ligneY[x - 1] - 1e-6, 'sans marche à rebours');
  const fondu = ligneY.filter(v => v > 0.02 && v < 0.98).length;
  assert.ok(fondu >= 8 && fondu <= 20, `un bord fondu sur environ deux cases (${fondu} pixels)`);
});
