// Banc de la caméra 3D des batailles (web/js/battle/camera.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Chaque geste passe par le passage écran → terrain (toucher un point du sol, tracer un
// ordre, viser un ennemi) et chaque fanion par le passage terrain → écran. Sur un relief et une caméra qui pivote,
// une erreur de signe ou un rayon qui traverse une colline enverrait les régiments au mauvais endroit sans que rien
// ne plante. Ici, sur une colline fabriquée, on vérifie l'aller-retour à 1 m et à 1 pixel près, à plusieurs caps et
// zooms, l'inclinaison qui suit le zoom et les bornes du champ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameOf, project, unproject, pitchAt, distOf, zOf, clampCam } from '../web/js/battle/camera.js';

// une colline de 40 m au milieu d'un champ de 3000 × 2000 m
const hill = (x, y) => 40 * Math.exp(-((x - 1500) ** 2 + (y - 1000) ** 2) / 400 ** 2);
const vp = { vw: 1200, vh: 800 };
const cams = [];
for (const yaw of [0, 1.1, 2.6, -2]) for (const z of [0.45, 1.5, 6, 20]) cams.push({ x: 1450, y: 1080, z, yaw });

test('l’inclinaison suit le zoom : de haut de loin, presque à l’horizontale de près', () => {
  assert.ok(pitchAt(3000) > pitchAt(300) && pitchAt(300) > pitchAt(30));
  // (comme Ultimate General : en biais même de loin, le champ s'enfonce vers l'horizon)
  assert.ok(pitchAt(3000) > 0.75 && pitchAt(3000) < 1.0, 'vue d’ensemble entre 43° et 57°');
  assert.ok(pitchAt(20) > 0.2 && pitchAt(20) < 0.45, 'au ras des troupes entre 12° et 25°');
});

test('zoom et distance se convertissent dans les deux sens', () => {
  for (const z of [0.3, 1, 4, 30]) assert.ok(Math.abs(zOf(distOf(z, vp), vp) - z) < 1e-9);
  assert.ok(distOf(0.5, vp) > distOf(5, vp), 'zoomer rapproche la caméra');
});

test('terrain → écran → terrain : à 1 m près, sur la colline, à tous les caps et zooms', () => {
  for (const cam of cams) {
    const fr = frameOf(cam, vp, hill);
    // points du sol autour de la cible, dans le champ de la caméra
    const span = vp.vw / cam.z * 0.4;
    for (const [du, dv] of [[0, 0], [-0.8, 0.3], [0.7, -0.5], [0.3, 0.9], [-0.4, -0.9]]) {
      const x = cam.x + du * span, y = cam.y + dv * span;
      const [sx, sy, depth] = project(fr, x, y, hill(x, y));
      if (depth <= 0 || sx < 0 || sy < 0 || sx > vp.vw || sy > vp.vh) continue;
      const [wx, wy] = unproject(fr, sx, sy, hill);
      assert.ok(Math.hypot(wx - x, wy - y) < 1, `cap ${cam.yaw}, zoom ${cam.z} : (${x | 0}, ${y | 0}) revient en (${wx | 0}, ${wy | 0})`);
    }
  }
});

test('écran → terrain → écran : à 1 pixel près sous l’horizon', () => {
  for (const cam of cams) {
    const fr = frameOf(cam, vp, hill);
    for (const [sx, sy] of [[600, 400], [100, 700], [1100, 650], [600, 780], [300, 450]]) {
      const [x, y] = unproject(fr, sx, sy, hill);
      const [px, py] = project(fr, x, y, hill(x, y));
      assert.ok(Math.hypot(px - sx, py - sy) < 1, `cap ${cam.yaw}, zoom ${cam.z} : (${sx}, ${sy}) revient en (${px | 0}, ${py | 0})`);
    }
  }
});

test('la cible est au centre de l’écran ; cap 0 : le nord est en haut', () => {
  const cam = { x: 1000, y: 800, z: 2, yaw: 0 }, fr = frameOf(cam, vp, hill);
  const [sx, sy] = project(fr, 1000, 800, hill(1000, 800));
  assert.ok(Math.abs(sx - 600) < 0.5 && Math.abs(sy - 400) < 0.5);
  const north = project(fr, 1000, 700, hill(1000, 700)), east = project(fr, 1100, 800, hill(1100, 800));
  assert.ok(north[1] < sy && Math.abs(north[0] - sx) < 1, 'le nord est au-dessus de la cible');
  assert.ok(east[0] > sx, 'l’est est à droite');
  // demi-tour : le nord passe en bas
  const fr2 = frameOf({ ...cam, yaw: Math.PI }, vp, hill);
  assert.ok(project(fr2, 1000, 700, hill(1000, 700))[1] > project(fr2, 1000, 800, hill(1000, 800))[1]);
});

test('au-dessus de l’horizon, le rayon donne un point lointain dans la direction du regard', () => {
  const cam = { x: 1500, y: 1900, z: 30, yaw: 0 }, fr = frameOf(cam, vp, hill);
  // (l'horizon est toujours un peu au-dessus du haut de l'écran : on vise plus haut que l'écran)
  const [x, y] = unproject(fr, 600, -900, hill);
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
  assert.ok(y < cam.y - 200, 'le point est loin devant (au nord)');
});

test('la caméra reste au-dessus du sol et sa cible dans le champ', () => {
  const fr = frameOf({ x: 1500, y: 1450, z: 40, yaw: Math.PI }, vp, hill);   // de près, dos à la colline
  assert.ok(fr.E[1] > hill(fr.E[0], fr.E[2]) + 1, 'l’œil n’est pas sous la colline');
  const c = clampCam({ x: -900, y: 5000, z: 99, yaw: 0 }, { W: 3000, H: 2000, minZ: 0.3, maxZ: 20 });
  assert.ok(c.x >= -150 && c.y <= 2150 && c.z === 20);
});

test('ancrer : le point visé reste sous le doigt après un zoom ou un pivot', async () => {
  const { anchor } = await import('../web/js/battle/camera.js');
  for (const cam of cams.slice(0, 8)) {
    const c = { ...cam }, fr = frameOf(c, vp, hill);
    const [wx, wy] = unproject(fr, 300, 600, hill);
    c.z *= 1.7; c.yaw += 0.4;
    anchor(c, vp, hill, wx, wy, 300, 600);
    const [ux, uy] = unproject(frameOf(c, vp, hill), 300, 600, hill);
    assert.ok(Math.hypot(ux - wx, uy - wy) < 1, `cap ${cam.yaw}, zoom ${cam.z}`);
  }
});
