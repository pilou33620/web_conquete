// Banc du rendu en plateau d'hexagones (web/js/hex, SPEC-HEX.md) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le plateau 3D et les calques 2D (vie, armées, interface) doivent tomber au même endroit : la
// grille doit retrouver l'hexagone sous un point, et la projection inclinée (K) doit faire l'aller-retour exact entre
// l'écran et le terrain, sinon un toucher choisirait le mauvais régiment ou la mauvaise ville sans que rien ne plante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grille, K, versEcran, versJeu, THREE } from '../web/js/hex/moteur.js';
import { Plateau } from '../web/js/hex/plateau.js';
import { toScreen, toWorld, anchor } from '../web/js/battle/camera.js';

test('la grille retrouve l’hexagone sous chaque point', () => {
  const g = new Grille(272, 337, 4);
  for (let k = 0; k < 2000; k++) {
    const x = (k * 37.3) % 270 + 1, y = (k * 53.1) % 330 + 1, t = g.en(x, y);
    if (!t) continue;
    // le point est dans l'hexagone trouvé : au plus le rayon du centre, et plus près de lui que de tout voisin
    assert.ok(Math.hypot(t.gx - x, t.gy - y) <= g.RK + 1e-9);
    for (const v of g.voisins(t)) assert.ok(Math.hypot(t.gx - x, t.gy - y) <= Math.hypot(v.gx - x, v.gy - y) + 1e-9);
  }
  assert.equal(g.voisins(g.get(5, 5)).length, 6);
});

test('vue inclinée : aller-retour exact écran ↔ terrain', () => {
  const cam = { x: 120, y: 80, z: 7 };
  for (const [x, y] of [[0, 0], [120, 80], [200.5, 13.25]]) {
    const [sx, sy] = versEcran(cam, 1200, 800, x, y), [x2, y2] = versJeu(cam, 1200, 800, sx, sy);
    assert.ok(Math.abs(x2 - x) < 1e-9 && Math.abs(y2 - y) < 1e-9);
  }
  // le centre de la caméra est au centre de l'écran ; le sol est aplati de K sur la verticale
  assert.deepEqual(versEcran(cam, 1200, 800, 120, 80), [600, 400]);
  assert.ok(Math.abs(versEcran(cam, 1200, 800, 120, 90)[1] - (400 + 10 * 7 * K)) < 1e-9);
});

test('caméra des batailles avec l’aplatissement k', () => {
  const vp = { vw: 1000, vh: 700, k: K }, cam = { x: 1500, y: 1000, z: 0.8 };
  const [sx, sy] = toScreen(cam, vp, 1700, 1210), [x, y] = toWorld(cam, vp, sx, sy);
  assert.ok(Math.abs(x - 1700) < 1e-9 && Math.abs(y - 1210) < 1e-9);
  // l'ancrage garde le point du terrain sous le doigt
  anchor(cam, vp, 1700, 1210, 100, 650);
  const [ax, ay] = toScreen(cam, vp, 1700, 1210);
  assert.ok(Math.abs(ax - 100) < 1e-9 && Math.abs(ay - 650) < 1e-9);
  // sans k : la vue de dessus d'avant
  assert.deepEqual(toScreen({ x: 0, y: 0, z: 1 }, { vw: 10, vh: 10 }, 1, 1), [6, 6, 1]);
});

test('plateau : un canal daté paraît à son ouverture, seul son bloc est refait', () => {
  // un plateau sans WebGL : la grille, deux blocs bâtis, un canal de 1853 qui ne traverse que le premier
  const g = new Grille(40, 40, 4), p = Object.create(Plateau.prototype), a = { grp: 1 }, b = { grp: 1 };
  for (const t of g.liste) { t.t = 'plaine'; t.top = 0; t.bloc = t.gx < 20 ? a : b; }
  Object.assign(p, { g, eau: new Map(), lieux: new Map(), racine: new THREE.Group(), mp: { epoque: { year: 1790 } },
    canaux: [{ name: 'canal de la Marne au Rhin', rank: 3, year: 1853, pts: [[4, 6], [16, 30]] }] });
  const c = p.canaux[0];
  p.majCanaux();
  assert.equal(c.grp, undefined); assert.equal(p.eau.size, 0); assert.ok(!a.refaire && !b.refaire);
  p.mp.epoque.year = 1870; p.majCanaux();
  assert.equal(c.grp.length, 2); assert.ok(p.eau.size > 0 && p.racine.children.length === 2);
  assert.ok(a.refaire && !b.refaire);
  assert.ok([...c.eau.keys()].every(t => t.riv === 3));
  // l'année recule (l'aperçu d'un autre scénario) : le canal s'en va, l'eau aussi
  p.mp.epoque.year = 1790; p.majCanaux();
  assert.equal(c.grp, null); assert.equal(p.eau.size, 0); assert.equal(p.racine.children.length, 0);
  assert.ok([...c.eau.keys()].every(t => t.riv === undefined));
});
