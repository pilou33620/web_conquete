// Vue tactique : caméra verticale de la bataille vue de dessus (SPEC-2D § 1), maths pures (banc tests/camera.test.mjs).
// cam = {x, y} le point du terrain au centre de l'écran (m), z le zoom (pixels CSS par mètre) ; ni pivot ni inclinaison.
// vp = {vw, vh} la taille de l'écran (pixels CSS). Écran ↔ terrain :
//   sx = (x - cam.x) * z + vw / 2, sy = (y - cam.y) * z + vh / 2
import { clamp } from './formes.js';

// terrain → écran : [sx, sy, 1] (le 3e terme, la profondeur de la 3D, reste pour les appelants : toujours devant)
export function toScreen(cam, vp, x, y) { return [(x - cam.x) * cam.z + vp.vw / 2, (y - cam.y) * cam.z + vp.vh / 2, 1]; }
// écran → terrain
export function toWorld(cam, vp, sx, sy) { return [cam.x + (sx - vp.vw / 2) / cam.z, cam.y + (sy - vp.vh / 2) / cam.z]; }

// déplace la caméra pour que le point (wx, wy) du terrain soit sous le point (sx, sy) de l'écran (glisser, zoomer au doigt)
export function anchor(cam, vp, wx, wy, sx, sy) {
  cam.x = wx - (sx - vp.vw / 2) / cam.z;
  cam.y = wy - (sy - vp.vh / 2) / cam.z;
  return cam;
}

// bornes : zoom permis, centre dans le champ (à 100 m près : on voit ce qui est sous les barres de l'interface)
export function clampCam(cam, { W, H, minZ, maxZ }) {
  cam.z = clamp(cam.z, minZ, maxZ);
  cam.x = clamp(cam.x, -100, W + 100);
  cam.y = clamp(cam.y, -100, H + 100);
  return cam;
}
