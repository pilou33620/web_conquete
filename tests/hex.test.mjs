// Banc du rendu en plateau d'hexagones (web/js/hex, SPEC-HEX.md) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le plateau 3D et les calques 2D (vie, armées, interface) doivent tomber au même endroit : la
// grille doit retrouver l'hexagone sous un point, et la projection inclinée (K) doit faire l'aller-retour exact entre
// l'écran et le terrain, sinon un toucher choisirait le mauvais régiment ou la mauvaise ville sans que rien ne plante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grille, K, versEcran, versJeu } from '../web/js/hex/moteur.js';
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

// Les remparts s'ouvrent là où les routes les traversent (modeles.js, enceinte) : sans cela une route de la carte passe
// à travers un mur plein et la porte est dessinée à côté, sans que rien ne plante.
test('remparts : aucune route ne traverse un mur, une tour ou un bastion', async () => {
  const { enceinte, lot } = await import('../web/js/hex/modeles.js').then(async M => ({ enceinte: M.enceinte, lot: (await import('../web/js/hex/moteur.js')).lot }));
  let vus = 0;
  for (const [rad, nb] of [[7.5, 1], [19, 2], [27, 2], [34, 2]]) for (let niveau = 1; niveau <= 4; niveau++) for (let g = 0; g < 12; g++) {
    // des routes droites du cœur vers le dehors, un point tous les 0,8
    const routes = [];
    for (let k = 0; k < nb; k++) { const a = g * 0.53 + k * (1.9 + g * 0.11), b = a + 0.25 * Math.sin(g + k); for (let d = 0; d < rad * 1.6; d += 0.8) routes.push([Math.cos(a) * 2 + Math.cos(b) * d, Math.sin(a) * 2 + Math.sin(b) * d, k === 0]); }
    const L = lot(); enceinte(L, niveau, rad, routes);
    for (const geo of [...L.g, ...L.o]) {
      const p = geo.attributes.position; let bas = Infinity, haut = -Infinity;
      for (let i = 0; i < p.count; i++) { bas = Math.min(bas, p.getY(i)); haut = Math.max(haut, p.getY(i)); }
      if (bas > 0.5 || haut < 1) continue;   // (le fossé, plat, et le parapet, posé sur le mur, ne barrent rien)
      for (let i = 0; i < p.count; i += 3) {
        const [x1, z1, x2, z2, x3, z3] = [p.getX(i), p.getZ(i), p.getX(i + 1), p.getZ(i + 1), p.getX(i + 2), p.getZ(i + 2)], aire = (x2 - x1) * (z3 - z1) - (x3 - x1) * (z2 - z1);
        if (Math.abs(aire) < 1e-9) continue;
        for (const [x, z] of routes) {
          const u = ((x - x1) * (z3 - z1) - (x3 - x1) * (z - z1)) / aire, v = ((x2 - x1) * (z - z1) - (x - x1) * (z2 - z1)) / aire;
          assert.ok(!(u > 1e-6 && v > 1e-6 && u + v < 1 - 1e-6), `route sous un ouvrage (rayon ${rad}, niveau ${niveau}, tirage ${g})`);
        }
        vus++;
      }
    }
  }
  assert.ok(vus > 1000);
});
