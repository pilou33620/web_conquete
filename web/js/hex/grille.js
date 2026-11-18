// La géométrie du plateau d'hexagones, sans three.js (testée par tests/hex.test.mjs) : la grille du jeu (pointe en haut,
// lignes impaires décalées, comme la grille de web_engine, graphismes/rendu/scene.js) et la projection de la caméra
// inclinée que partagent le rendu 3D (hex/plateau.js, sur le moteur web_engine) et les calques 2D (map.js). Le sol se
// projette par une simple affinité : sx = (x − cx)·z + vw/2, sy = (y − cy)·z·K + vh/2 − h·z·C.
export const SQ3 = Math.sqrt(3);
// inclinaison de la caméra : direction (0, 0,83, 0,56) comme web_power (js/15-camera.js)
export const ELEV = Math.atan2(0.83, 0.56), K = Math.sin(ELEV), C = Math.cos(ELEV);

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function hache(x, y, s = 7) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function bruit(x, y, s = 7) {
  const xi = Math.floor(x), yi = Math.floor(y), u = (x - xi) ** 2 * (3 - 2 * (x - xi)), v = (y - yi) ** 2 * (3 - 2 * (y - yi));
  const a = hache(xi, yi, s), b = hache(xi + 1, yi, s), c = hache(xi, yi + 1, s), d = hache(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ------------------------------------------------------------------ grille d'hexagones (pointe en haut, comme web_power)
// R : rayon d'un hexagone dans les unités du plateau (10, comme web_power) ; la grille couvre W × H unités du jeu avec des
// hexagones de `pas` unités du jeu d'un bord plat à l'autre. f = unités du jeu par unité du plateau.
export class Grille {
  constructor(W, H, pas) {
    this.R = 10; this.pas = pas; this.RK = pas / SQ3; this.f = this.RK / this.R;
    this.cols = Math.floor(W / pas) + 1; this.rows = Math.floor(H / (1.5 * this.RK)) + 1;
    this.T = new Map(); this.liste = [];
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
      const r = row, q = col - (row - (row & 1)) / 2;
      const t = { q, r, col, row, i: this.liste.length, x: this.R * SQ3 * (q + r / 2), z: this.R * 1.5 * r, top: 0 };
      t.gx = t.x * this.f; t.gy = t.z * this.f;   // le centre, en unités du jeu
      this.T.set(q + ',' + r, t); this.liste.push(t);
    }
  }
  get(q, r) { return this.T.get(q + ',' + r); }
  voisins(t) { const o = []; for (const [a, b] of DIRS) { const n = this.T.get((t.q + a) + ',' + (t.r + b)); if (n) o.push(n); } return o; }
  // l'hexagone sous un point du plateau (unités du plateau)
  sous(x, z) {
    const q = (SQ3 / 3 * x - z / 3) / this.R, r = (2 / 3 * z) / this.R, s = -q - r;
    let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return this.T.get(rq + ',' + rr);
  }
  // l'hexagone sous un point du jeu
  en(gx, gy) { return this.sous(gx / this.f, gy / this.f); }
  coin(t, i, k = 1) { const a = Math.PI / 180 * (60 * i - 30); return [t.x + this.R * k * Math.cos(a), t.z + this.R * k * Math.sin(a)]; }
  bordCommun(t, n) {
    const mx = (t.x + n.x) / 2, mz = (t.z + n.z) / 2;
    return [0, 1, 2, 3, 4, 5].map(i => this.coin(t, i)).sort((a, b) => Math.hypot(a[0] - mx, a[1] - mz) - Math.hypot(b[0] - mx, b[1] - mz)).slice(0, 2);
  }
  // une polyligne du jeu ([[x, y], …]) rééchantillonnée tous les `pas` unités du plateau, posée sur les hexagones
  suivre(pts, pas, dy, sol = t => t.top) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0] / this.f, az = pts[i][1] / this.f, bx = pts[i + 1][0] / this.f, bz = pts[i + 1][1] / this.f;
      const nb = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / pas));
      for (let s = i ? 1 : 0; s <= nb; s++) {
        const x = ax + (bx - ax) * s / nb, z = az + (bz - az) * s / nb, t = this.sous(x, z);
        out.push([x, (t ? sol(t) : 0) + dy, z, t]);
      }
    }
    return out;
  }
}
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// projection écran ↔ jeu de la caméra inclinée (les calques 2D)
export const versEcran = (cam, vw, vh, x, y, h = 0) => [(x - cam.x) * cam.z + vw / 2, (y - cam.y) * cam.z * K + vh / 2 - h * cam.z * C];
export const versJeu = (cam, vw, vh, sx, sy) => [(sx - vw / 2) / cam.z + cam.x, (sy - vh / 2) / (cam.z * K) + cam.y];
