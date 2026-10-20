// Vue tactique : ce que le relief fait à la lumière (étape 9c), calculé une fois par bataille, sur le processeur.
// - horizons : depuis chaque point d'une grille de G m, la hauteur de l'horizon (angle au-dessus de l'horizontale)
//   dans huit directions, jusqu'à 600 m. relief.js en tire l'ombre portée des collines quand le soleil est bas (le
//   soleil est caché si l'horizon de sa direction est plus haut que lui) et l'occlusion ambiante : les fonds de vallée
//   voient moins de ciel, ils sont plus sombres.
// - normales : la pente du sol à G m (le maillage n'a qu'une maille de 10 m), avec l'occlusion : les talus et les
//   ondulations accrochent la lumière.
// Fonctions pures (hAt : altitude de la scène en x, y) : tests/horizon.test.mjs.
import { clamp } from './formes.js';

// direction k : angle k × 45° dans le plan du terrain (x, puis y, qui est z dans la scène)
export const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
// pas de la marche vers l'horizon (en cases) : serrés près du point, de plus en plus lâches (jusqu'à 120 cases)
const STEPS = [1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64, 85, 120];
const Q = Math.PI / 2;

// grille de nx × ny points (le point i, j est en (i G, j G)) ; a, b : angles des directions 0-3 et 4-7 (octets, 255 :
// 90°) ; ao : part du ciel vue (1 en plaine, moins au fond d'une vallée ou au pied d'un talus)
export function horizons(hAt, W, H, G = 5) {
  const nx = Math.ceil(W / G) + 1, ny = Math.ceil(H / G) + 1, n = nx * ny;
  const h = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = hAt(Math.min(i * G, W), Math.min(j * G, H));
  const a = new Uint8Array(n * 4), b = new Uint8Array(n * 4), ao = new Float32Array(n);
  const len = DIRS.map(([dx, dy]) => G * Math.hypot(dx, dy));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i, h0 = h[c];
    let sky = 0;
    for (let k = 0; k < 8; k++) {
      const [dx, dy] = DIRS[k];
      let best = 0;
      for (const s of STEPS) {
        const ii = i + dx * s, jj = j + dy * s;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) break;   // (au-delà du champ, le terrain descend : rien ne cache)
        const t = (h[jj * nx + ii] - h0) / (s * len[k]);
        if (t > best) best = t;
      }
      const ang = Math.atan(best);
      (k < 4 ? a : b)[c * 4 + (k & 3)] = Math.round(ang / Q * 255);
      sky += Math.sin(ang);
    }
    ao[c] = 1 - sky / 8;
  }
  return { nx, ny, G, a, b, ao };
}

// normales du sol (x, z de la normale) et occlusion (lue dans hz, la grille des horizons) sur une grille de G m :
// quatre flottants par point (nx, nz, ao, 1)
export function normales(hAt, W, H, hz, G = 2.5) {
  const nx = Math.ceil(W / G) + 1, ny = Math.ceil(H / G) + 1, out = new Float32Array(nx * ny * 4), e = G;
  const aoAt = (x, y) => {
    const fx = clamp(x / hz.G, 0, hz.nx - 1.001), fy = clamp(y / hz.G, 0, hz.ny - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, A = hz.ao, k = j * hz.nx + i;
    return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + hz.nx] * (1 - u) + A[k + hz.nx + 1] * u) * v;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * G, y = j * G;
    const gx = (hAt(x + e, y) - hAt(x - e, y)) / (2 * e), gy = (hAt(x, y + e) - hAt(x, y - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gy), k = (j * nx + i) * 4;
    out[k] = -gx / l; out[k + 1] = -gy / l; out[k + 2] = aoAt(x, y); out[k + 3] = 1;
  }
  return { nx, ny, G, data: out };
}
