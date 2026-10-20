// Vue tactique : caméra orbitale de la bataille en 3D (maths pures, sans Three.js : banc tests/camera.test.mjs).
// L'état est celui de la vue 2D d'avant, plus le cap : {x, y} la cible au sol (m), z le zoom (pixels CSS par mètre à la
// cible), yaw le cap (0 = regard vers le nord, positif = vers l'est). La distance de l'œil se déduit du zoom, et
// l'inclinaison de la distance : en biais (50°) quand on voit tout le champ, presque à l'horizontale au ras des troupes.
// Repère 3D (celui de Three.js) : X = x du jeu, Y = altitude, Z = y du jeu (vers le sud) ; un mètre = une unité.
import { clamp } from './formes.js';

// Comme Ultimate General : un champ assez ouvert (la perspective se sent : les rangs proches sont plus grands que les
// lointains) et une vue en biais même de loin, où l'on voit le champ s'enfoncer vers l'horizon et la brume
export const FOV = 40 * Math.PI / 180;   // champ vertical
const P0 = 0.26, D0 = 20, P1 = 0.88, D1 = 3000;   // inclinaison (rad) au ras des troupes (20 m) et de très haut (3 km)
const CLEAR = 2;                                   // l'œil reste au moins à 2 m au-dessus du sol

const focal = vp => vp.vh / 2 / Math.tan(FOV / 2);
export const distOf = (z, vp) => focal(vp) / z;
export const zOf = (dist, vp) => focal(vp) / dist;
export const pitchAt = dist => P0 + (P1 - P0) * clamp(Math.log(dist / D0) / Math.log(D1 / D0), 0, 1);

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// repère de la caméra pour une image : œil E, cible T, axes F (regard), R (droite), U (haut), focale k (px)
export function frameOf(cam, vp, heightAt) {
  const dist = distOf(cam.z, vp), p = pitchAt(dist), yaw = cam.yaw || 0;
  const T = [cam.x, heightAt(cam.x, cam.y), cam.y];
  const E = [cam.x - Math.sin(yaw) * Math.cos(p) * dist, T[1] + Math.sin(p) * dist, cam.y + Math.cos(yaw) * Math.cos(p) * dist];
  E[1] = Math.max(E[1], heightAt(E[0], E[2]) + CLEAR);   // derrière une colline, l'œil passe au-dessus
  const F = norm([T[0] - E[0], T[1] - E[1], T[2] - E[2]]);
  const R = norm([-F[2], 0, F[0]]), U = cross(R, F);
  return { E, T, F, R, U, k: focal(vp), vw: vp.vw, vh: vp.vh, dist, pitch: p };
}

// terrain → écran : [sx, sy, profondeur] (profondeur ≤ 0 : derrière l'œil)
export function project(fr, x, y, h) {
  const { E, F, R, U, k } = fr, dx = x - E[0], dy = h - E[1], dz = y - E[2];
  const cz = dx * F[0] + dy * F[1] + dz * F[2];
  const c = cz > 0.01 ? k / cz : k / 0.01;
  return [fr.vw / 2 + (dx * R[0] + dy * R[1] + dz * R[2]) * c, fr.vh / 2 - (dx * U[0] + dy * U[1] + dz * U[2]) * c, cz];
}

// écran → terrain : marche le long du rayon jusqu'à passer sous le sol, puis affine par dichotomie. Au-dessus de
// l'horizon (ou au-delà de 30 km), un point lointain dans la direction du regard.
export function unproject(fr, sx, sy, heightAt) {
  const { E, F, R, U, k } = fr, a = (sx - fr.vw / 2) / k, b = -(sy - fr.vh / 2) / k;
  const d = norm([F[0] + R[0] * a + U[0] * b, F[1] + R[1] * a + U[1] * b, F[2] + R[2] * a + U[2] * b]);
  const above = t => E[1] + d[1] * t - heightAt(E[0] + d[0] * t, E[2] + d[2] * t);
  if (d[1] < 0) {
    let t0 = 0, t = 0.5;
    while (t < 30000) {
      if (above(t) <= 0) {
        for (let q = 0; q < 24; q++) { const m = (t0 + t) / 2; if (above(m) > 0) t0 = m; else t = m; }
        return [E[0] + d[0] * t, E[2] + d[2] * t];
      }
      t0 = t; t += Math.max(2, t * 0.02);
    }
  }
  const hl = Math.hypot(d[0], d[2]) || 1;
  return [E[0] + d[0] / hl * 4000, E[2] + d[2] / hl * 4000];
}

// déplace la cible pour que le point (wx, wy) du terrain soit sous le point (sx, sy) de l'écran (glisser, zoomer au
// doigt, pivoter autour du doigt) ; quelques passes suffisent, le relief variant peu d'une passe à l'autre
export function anchor(cam, vp, heightAt, wx, wy, sx, sy) {
  for (let q = 0; q < 4; q++) {
    const [ux, uy] = unproject(frameOf(cam, vp, heightAt), sx, sy, heightAt);
    cam.x += wx - ux; cam.y += wy - uy;
    if (Math.hypot(wx - ux, wy - uy) < 0.05) break;
  }
  return cam;
}

// bornes : zoom permis, cible dans le champ (à 100 m près : on voit ce qui est sous les barres de l'interface)
export function clampCam(cam, { W, H, minZ, maxZ }) {
  cam.z = clamp(cam.z, minZ, maxZ);
  cam.x = clamp(cam.x, -100, W + 100);
  cam.y = clamp(cam.y, -100, H + 100);
  return cam;
}
