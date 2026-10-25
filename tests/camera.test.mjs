// Banc de la caméra des batailles vues de dessus (web/js/battle/camera.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Chaque geste passe par le passage écran → terrain (toucher un régiment, zoomer sous le
// doigt) et chaque fanion par le passage terrain → écran. Une erreur de signe enverrait le zoom ou le toucher au
// mauvais endroit sans que rien ne plante. Ici : l'aller-retour exact, le centre de l'écran, l'ancrage sous le doigt
// et les bornes du champ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, toWorld, anchor, clampCam } from '../web/js/battle/camera.js';

const vp = { vw: 1200, vh: 800 };
const cams = [];
for (const z of [0.3, 1, 4, 30]) cams.push({ x: 1450, y: 1080, z });

test('terrain → écran → terrain, et retour, sans écart', () => {
  for (const cam of cams) for (const [x, y] of [[1450, 1080], [0, 0], [2999, 1999], [1200, 1500]]) {
    const [sx, sy, d] = toScreen(cam, vp, x, y), [wx, wy] = toWorld(cam, vp, sx, sy);
    assert.equal(d, 1);
    assert.ok(Math.hypot(wx - x, wy - y) < 1e-9, `zoom ${cam.z}`);
  }
});

test('le centre de la caméra est au milieu de l’écran ; le nord en haut, l’est à droite ; z pixels par mètre', () => {
  const cam = { x: 500, y: 700, z: 2 };
  assert.deepEqual(toScreen(cam, vp, 500, 700), [600, 400, 1]);
  const [ex] = toScreen(cam, vp, 510, 700), [, ny] = toScreen(cam, vp, 500, 690);
  assert.equal(ex, 620);
  assert.equal(ny, 380);
});

test('ancrer : le point visé reste sous le doigt après un zoom', () => {
  for (const cam of cams) {
    const [wx, wy] = toWorld(cam, vp, 200, 650);
    cam.z *= 1.7;
    anchor(cam, vp, wx, wy, 200, 650);
    const [sx, sy] = toScreen(cam, vp, wx, wy);
    assert.ok(Math.abs(sx - 200) < 1e-6 && Math.abs(sy - 650) < 1e-6);
  }
});

test('bornes : zoom permis et centre dans le champ', () => {
  const c = clampCam({ x: -900, y: 5000, z: 99 }, { W: 3000, H: 2000, minZ: 0.2, maxZ: 30 });
  assert.deepEqual(c, { x: -100, y: 2100, z: 30 });
  assert.equal(clampCam({ x: 1, y: 1, z: 0.01 }, { W: 3000, H: 2000, minZ: 0.2, maxZ: 30 }).z, 0.2);
});
