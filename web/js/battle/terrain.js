// Vue tactique : peinture du champ de bataille, vu de haut, dans le style de la carte illustrée.
// Le fond est peint une fois : une image entière à basse résolution (aussi mini-carte et fond de secours),
// puis des tuiles plus fines à la demande selon le zoom. À chaque image ne sont plus dessinées que les unités et
// les effets. Les tués et les trous d'obus sont peints dans les tuiles déjà faites (décalcomanies).
import { T, cellRemap, normSeason, hash, clamp, TAU, TILT } from './formes.js';

const TS = 512;                         // côté d'une tuile, en pixels de l'écran
const LEVELS = [1, 2, 4, 8, 16];        // pixels (physiques) par mètre des tuiles, jusqu'au plus fin permis par la
const BASE = 0.5;                       // qualité graphique ; l'image entière est à BASE

function b64(s) {
  if (!s) return null;
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbStr(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function mixHex(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbStr([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

// ------------------------------------------------------------------ palettes des saisons
// prairies, cultures (plusieurs tons de lanières), vignes, landes, sous-bois, feuillages, eau…
export const PALETTES = {
  printemps: {
    pre: ['#93c05c', '#88b955', '#9dc866', '#a5c86a'], champ: [['#b9c766', '#a9bd5c'], ['#a98b5e', '#977a52'], ['#e2d45e', '#d6c652'], ['#9fc25c', '#8fb350']],
    vigneSol: '#b5a27a', vigneRang: '#5d8f36', lande: '#a3a067', landeFleurs: ['#8f6a92', '#c9b648', '#6f7d48'], sousBois: '#4f7a38',
    arbres: ['#3d7a34', '#4b8a3b', '#5a9944'], arbreHi: 'rgba(170,215,110,0.55)', pins: ['#2f6136', '#3a6d3c'], marais: '#7fa37e', sable: '#e2d29c',
    roche: '#aaa491', rocheSombre: '#7d7867', eau: '#4f8cc6', eauBord: '#2f6297', eauHi: 'rgba(200,228,250,0.55)', route: '#d3be8f', routeBord: '#9c845a',
    chemin: '#c9b588', bati: '#c1b08e', toit: ['#b4513a', '#c0623e', '#a9472f'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  ete: {
    pre: ['#a9b964', '#9fb35c', '#b4c06c', '#a2b062'], champ: [['#e6c56a', '#d8b65c'], ['#d9bd78', '#cbac66'], ['#c9a35c', '#b99352'], ['#b4b85e', '#a6aa54']],
    vigneSol: '#c4ab7c', vigneRang: '#4c7d2c', lande: '#ada060', landeFleurs: ['#9c6a8e', '#d8bf4a', '#857a48'], sousBois: '#46703a',
    arbres: ['#356c2f', '#417a35', '#4f883e'], arbreHi: 'rgba(160,200,100,0.5)', pins: ['#2b5a33', '#356638'], marais: '#87a37a', sable: '#ead7a0',
    roche: '#b2aa94', rocheSombre: '#857e6a', eau: '#4a88c2', eauBord: '#2c5e94', eauHi: 'rgba(210,235,250,0.55)', route: '#dcc89a', routeBord: '#a48a5c',
    chemin: '#d3be90', bati: '#c9b893', toit: ['#b85a3c', '#c4643a', '#a94a2a'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  automne: {
    pre: ['#8e9e58', '#859651', '#97a35e', '#8a9152'], champ: [['#8c6a46', '#7c5c3c'], ['#a3825a', '#93744e'], ['#b89a64', '#a98b58'], ['#7f8a4c', '#717c44']],
    vigneSol: '#9e8460', vigneRang: '#b0602a', lande: '#93774f', landeFleurs: ['#a0522d', '#8a6a3a', '#6c6040'], sousBois: '#6a6234',
    arbres: ['#a8692a', '#c08a30', '#7c7a32', '#9a4a26'], arbreHi: 'rgba(240,200,110,0.45)', pins: ['#2f5a35', '#3a6439'], marais: '#7c8f6c', sable: '#dccb98',
    roche: '#a39d8a', rocheSombre: '#77715f', eau: '#4a7fb4', eauBord: '#2b5788', eauHi: 'rgba(200,222,240,0.5)', route: '#c2ab7c', routeBord: '#8a724c',
    chemin: '#b9a276', bati: '#b8a684', toit: ['#a94a2f', '#b85a3a', '#9a4229'], ardoise: ['#565d6c', '#4c5262'], neige: 0,
  },
  hiver: {
    pre: ['#e9edf0', '#e3e8ec', '#eef1f3', '#dfe5ea'], champ: [['#e4e8ec', '#d3d9de'], ['#e8ebee', '#d8dde1'], ['#dde2e7', '#cdd3d9'], ['#e6eaee', '#d6dce1']],
    vigneSol: '#e3e7eb', vigneRang: '#5a4a3c', lande: '#dde2e2', landeFleurs: ['#8a8f86', '#a3a79c', '#7c8476'], sousBois: '#c9d0d0',
    arbres: ['#7d6d5e', '#8c7b6a', '#6e6052'], arbreHi: 'rgba(250,252,255,0.8)', pins: ['#2c4a3a', '#36543f'], marais: '#c5d0d2', sable: '#e8e6dc',
    roche: '#c9ccce', rocheSombre: '#8d9194', eau: '#6f8ea9', eauBord: '#4c6a84', eauHi: 'rgba(230,240,250,0.7)', route: '#d9d6cd', routeBord: '#9a958a',
    chemin: '#dedbd2', bati: '#d8d8d4', toit: ['#e9ecef', '#dfe3e6', '#f0f2f4'], ardoise: ['#d5dade', '#cdd2d6'], neige: 1,
  },
};

// motifs (lanières, rangs de vigne, bruyères…) : un petit canevas par niveau de détail
function stripePattern(colors, s, period, furrow) {
  const h = Math.max(4, Math.round(period * s)), cv = canvas(8, h), g = cv.getContext('2d');
  const n = colors.length;
  for (let k = 0; k < n; k++) { g.fillStyle = colors[k]; g.fillRect(0, Math.round(h * k / n), 8, Math.ceil(h / n)); }
  if (furrow && s >= 0.9) {
    g.fillStyle = 'rgba(70,50,25,0.12)';
    const step = Math.max(2, Math.round(1.6 * s));
    for (let y = 0; y < h; y += step) g.fillRect(0, y, 8, Math.max(1, s * 0.3));
  }
  return cv;
}
function vinePattern(sol, rang, s, winter) {
  const sp = Math.max(3, Math.round(2.6 * s)), cv = canvas(Math.max(8, Math.round(6 * s)), sp), g = cv.getContext('2d');
  g.fillStyle = sol; g.fillRect(0, 0, cv.width, sp);
  g.fillStyle = rang;
  const th = Math.max(1, Math.round(s * (winter ? 0.25 : 1.3)));
  g.fillRect(0, Math.round(sp / 2 - th / 2), cv.width, th);
  if (s >= 2) {   // ceps feuillus, un tous les 1,2 m, éclairés par-dessus
    for (let x = 0; x < cv.width; x += Math.round(1.2 * s)) { g.beginPath(); g.arc(x + 0.5, sp / 2, Math.max(1, s * (winter ? 0.25 : 0.8)), 0, TAU); g.fill(); }
    if (!winter) { g.fillStyle = 'rgba(255,255,220,0.22)'; for (let x = 0; x < cv.width; x += Math.round(1.2 * s)) { g.beginPath(); g.arc(x, sp / 2 - s * 0.3, s * 0.35, 0, TAU); g.fill(); } }
  }
  return cv;
}
function dotsPattern(base, cols, s, density, rmin, rmax, seed) {
  const size = 128, cv = canvas(size, size), g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const n = Math.round(size * size / (s * s) * density);
  for (let k = 0; k < Math.min(n, 1400); k++) {
    const x = hash(k, 1, seed) * size, y = hash(k, 2, seed) * size, r = Math.max(0.6, (rmin + hash(k, 3, seed) * (rmax - rmin)) * s);
    g.fillStyle = cols[(hash(k, 4, seed) * cols.length) | 0];
    g.globalAlpha = 0.55 + hash(k, 5, seed) * 0.4;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    // le motif se répète : on recopie les points qui débordent
    if (x < r) { g.beginPath(); g.arc(x + size, y, r, 0, TAU); g.fill(); }
    if (y < r) { g.beginPath(); g.arc(x, y + size, r, 0, TAU); g.fill(); }
  }
  g.globalAlpha = 1;
  return cv;
}
function grainCanvas() {
  const size = 128, cv = canvas(size, size), g = cv.getContext('2d'), img = g.createImageData(size, size);
  for (let k = 0; k < size * size; k++) {
    const v = 200 + hash(k, 7) * 55 + (vnoise((k % size) / 9, ((k / size) | 0) / 9, 3) - 0.5) * 40;
    img.data[k * 4] = v; img.data[k * 4 + 1] = v * 0.97; img.data[k * 4 + 2] = v * 0.9; img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// Chaikin : adoucit une ligne brisée (fermée ou non)
function chaikin(pts, iters, closed) {
  for (let it = 0; it < iters; it++) {
    const out = [], n = pts.length;
    if (!closed) out.push(pts[0]);
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

export class Terrain {
  // q : profil de qualité graphique (qualite.js) : niveau de tuiles le plus fin, nombre de tuiles gardées
  constructor(m, q) {
    this.W = m.W || 3000; this.H = m.H || 2000; this.cell = m.cell || 20;
    this.cols = m.cols || Math.round(this.W / this.cell); this.rows = m.rows || Math.round(this.H / this.cell);
    const n = this.cols * this.rows, remap = cellRemap(m.types);
    const tr = b64(m.t), hr = b64(m.h);
    this.t = new Uint8Array(n); this.h = new Uint8Array(n);
    for (let c = 0; c < n; c++) { this.t[c] = tr ? remap[tr[c]] : T.PRE; this.h[c] = hr ? hr[c] : 0; }
    this.roads = (m.roads || []).filter(r => r && r.length > 1);
    // genre de chaque route (« route », « chemin »…) quand le moteur le donne
    this.roadKinds = (m.roads || []).map((r, k) => (m.road_kinds || [])[k] || 'route').filter((k, i) => m.roads[i] && m.roads[i].length > 1);
    this.fences = (m.fences || []).filter(f => f && f.pts && f.pts.length > 1);
    this.bridgesIn = m.bridges || null;
    this.heart = m.heart || null;
    this.region = m.region || '';
    this.rivers = (m.rivers || []).filter(r => r && r.pts && r.pts.length > 1);
    this.buildings = m.buildings || [];
    this.walls = (m.walls || []).filter(w => w && w.pts && w.pts.length > 1);
    this.place = m.place || null;
    this.seed = (m.seed | 0) || 1;
    this.season = normSeason(m.season);
    this.pal = PALETTES[this.season];
    this.tiles = new Map();
    this.setQuality(q);
    this.decals = [];
    this.patterns = new Map();
    this.grain = grainCanvas();
    this.prepare();
    this.base = this.paintCanvas(0, 0, this.W, this.H, BASE);
  }

  // ------------------------------------------------------------------ préparation (une fois)
  at(x, y) { return this.t[clamp(Math.floor(y / this.cell), 0, this.rows - 1) * this.cols + clamp(Math.floor(x / this.cell), 0, this.cols - 1)]; }
  heightAt(x, y) {
    const fx = clamp(x / this.cell - 0.5, 0, this.cols - 1.001), fy = clamp(y / this.cell - 0.5, 0, this.rows - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, C = this.cols, h = this.h;
    const a = h[j * C + i], b = h[j * C + i + 1], c = h[(j + 1) * C + i], d = h[(j + 1) * C + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  prepare() {
    const { cols, rows, cell, t } = this;
    // parcelles : Voronoï sur une grille irrégulière (≈ 120 m), orientation des sillons qui varie doucement
    const P = 6, pc = Math.ceil(cols / P) + 1, pr = Math.ceil(rows / P) + 1, S = this.seed;
    const seeds = [];
    for (let b = 0; b < pr; b++) for (let a = 0; a < pc; a++) seeds.push([(a + 0.1 + hash(a, b, S) * 0.8) * P, (b + 0.1 + hash(a, b, S + 1) * 0.8) * P]);
    const parcel = new Int32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a0 = Math.floor(i / P), b0 = Math.floor(j / P);
      let best = 1e9, bi = 0;
      for (let b = b0 - 1; b <= b0 + 1; b++) for (let a = a0 - 1; a <= a0 + 1; a++) {
        if (a < 0 || b < 0 || a >= pc || b >= pr) continue;
        const k = b * pc + a, d = (seeds[k][0] - i - 0.5) ** 2 + (seeds[k][1] - j - 0.5) ** 2;
        if (d < best) { best = d; bi = k; }
      }
      parcel[j * cols + i] = bi;
    }
    // régions : composantes connexes d'un même type (et d'une même parcelle pour les cultures et prés)
    const crop = v => v === T.CHAMP || v === T.VIGNE || v === T.PRE;
    const label = new Int32Array(cols * rows).fill(-1);
    this.regions = [];
    const stack = [];
    for (let c0 = 0; c0 < cols * rows; c0++) {
      if (label[c0] >= 0) continue;
      const v = t[c0], p = parcel[c0], id = this.regions.length;
      const reg = { type: v, parcel: crop(v) ? p : -1, cells: [], box: [1e9, 1e9, -1e9, -1e9] };
      label[c0] = id; stack.push(c0);
      while (stack.length) {
        const c = stack.pop(), i = c % cols, j = (c / cols) | 0;
        reg.cells.push(c);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
          const cc = jj * cols + ii;
          if (label[cc] >= 0 || t[cc] !== v || (reg.parcel >= 0 && parcel[cc] !== p)) continue;
          label[cc] = id; stack.push(cc);
        }
      }
      this.regions.push(reg);
    }
    this.label = label;
    const jitterOf = v => (v === T.CHAMP || v === T.VIGNE || v === T.PRE ? 2 : v === T.ROUTE || v === T.CHEMIN || v === T.BATI || v === T.MUR || v === T.BRECHE || v === T.PORTE || v === T.BARRICADE ? 0 : 5);
    for (const [id, reg] of this.regions.entries()) {
      reg.path = this.regionPath(id, jitterOf(reg.type), reg.box);
      const c = reg.cells[0], i = c % cols, j = (c / cols) | 0;
      // orientation des lanières : un champ de direction lent, et la moitié des parcelles tournées d'un quart
      const base = vnoise(i / 40, j / 40, S + 9) * Math.PI * 2;
      reg.angle = base + (hash(reg.parcel, 3, S) < 0.4 ? Math.PI / 2 : 0) + (hash(reg.parcel, 4, S) - 0.5) * 0.5;
      reg.tone = (hash(reg.parcel, 5, S) * 4) | 0;
    }
    // ordre de peinture : les sols d'abord, l'eau et le bâti ensuite
    const ORDER = [T.PRE, T.LANDE, T.SABLE, T.ROCHE, T.CHAMP, T.VIGNE, T.MARAIS, T.BOIS, T.FORET, T.ROUTE, T.CHEMIN, T.BATI, T.MUR, T.BRECHE, T.PORTE, T.BARRICADE, T.GUE, T.EAU];
    this.regions.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    this.prepTrees();
    this.prepShade();
    this.prepContours();
    this.prepPaths();
    this.prepCover();
  }
  // contour d'une région : arêtes des cases au bord, chaînées en boucles, un peu bousculées puis adoucies
  regionPath(id, jit, box) {
    const { cols, rows, cell, label } = this, W1 = cols + 1;
    const inR = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && label[j * cols + i] === id;
    const next = new Map();
    const add = (a, b) => { let l = next.get(a); if (!l) next.set(a, l = []); l.push(b); };
    const v = (i, j) => j * W1 + i;
    for (const c of this.regions[id].cells) {
      const i = c % cols, j = (c / cols) | 0;
      if (!inR(i, j - 1)) add(v(i, j), v(i + 1, j));
      if (!inR(i + 1, j)) add(v(i + 1, j), v(i + 1, j + 1));
      if (!inR(i, j + 1)) add(v(i + 1, j + 1), v(i, j + 1));
      if (!inR(i - 1, j)) add(v(i, j + 1), v(i, j));
    }
    const S = this.seed, path = new Path2D();
    const pos = k => {
      const i = k % W1, j = (k / W1) | 0;
      // au bord de la carte, on repousse le contour au-delà : pas de liseré arrondi le long du cadre
      let x = i === 0 ? -40 : i === cols ? this.W + 40 : i * cell, y = j === 0 ? -40 : j === rows ? this.H + 40 : j * cell;
      if (jit && i > 0 && j > 0 && i < cols && j < rows) { x += (hash(i, j, S + 21) - 0.5) * 2 * jit; y += (hash(i, j, S + 22) - 0.5) * 2 * jit; }
      return [x, y];
    };
    for (const start of [...next.keys()]) {
      let l = next.get(start);
      while (l && l.length) {
        const loop = [start];
        let cur = l.pop(), guard = 0;
        while (cur !== start && guard++ < 100000) {
          loop.push(cur);
          const nl = next.get(cur);
          if (!nl || !nl.length) break;
          cur = nl.pop();
        }
        if (loop.length < 3) { l = next.get(start); continue; }
        const pts = chaikin(loop.map(pos), jit ? 3 : 1, true);
        path.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]);
        path.closePath();
        for (const p of pts) { box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]); box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]); }
        l = next.get(start);
      }
    }
    return path;
  }
  // arbres : touffes dans les bois, futaie serrée en forêt, arbres isolés dans les prés et le long des chemins
  prepTrees() {
    const { cols, rows, cell, t } = this, S = this.seed;
    this.treeGrid = new Array(cols * rows);
    const montagne = this.h.reduce((a, b) => Math.max(a, b), 0) > 55;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const c = j * cols + i, v = t[c], list = [];
      const h = k => hash(i, j, S + k);
      let n = 0, r0 = 4, r1 = 7;
      if (v === T.FORET) { n = 5; r0 = 5; r1 = 8; }
      else if (v === T.BOIS) { n = 3; r0 = 4; r1 = 7; }
      else if ((v === T.PRE || v === T.CHAMP) && h(1) < 0.025) n = 1;
      else if (v === T.LANDE && h(2) < 0.12) { n = 1; r0 = 3; r1 = 5; }
      for (let k = 0; k < n; k++) {
        if (v === T.BOIS && h(10 + k) < 0.18) continue;   // clairières
        const x = (i + 0.08 + h(20 + k * 3) * 0.84) * cell, y = (j + 0.08 + h(21 + k * 3) * 0.84) * cell;
        const r = r0 + h(22 + k * 3) * (r1 - r0);
        // pins dans les landes et en montagne ; feuillus ailleurs (en hiver, ils sont nus)
        const isPine = v === T.LANDE || ((v === T.FORET || v === T.BOIS) && this.landesLike() && h(40 + k) < 0.85) ? 'parasol'
          : (v === T.FORET || v === T.BOIS) && montagne && this.h[c] > 30 && h(40 + k) < 0.8;
        list.push({ x, y, r, ci: (h(30 + k) * 4) | 0, pine: isPine });
      }
      this.treeGrid[c] = list;
    }
  }
  landesLike() {
    if (this._landes === undefined) {
      let l = 0, s = 0; for (const v of this.t) { if (v === T.LANDE) l++; if (v === T.SABLE) s++; }
      this._landes = (l + s) > this.t.length * 0.15;
    }
    return this._landes;
  }
  // ombrage du relief (lumière du nord-ouest) : deux petites images, ombres et lumières, agrandies en douceur
  prepShade() {
    const { cols, rows, cell, h } = this;
    const dark = canvas(cols, rows), lite = canvas(cols, rows);
    const gd = dark.getContext('2d'), gl = lite.getContext('2d');
    const id = gd.createImageData(cols, rows), il = gl.createImageData(cols, rows);
    const lx = -0.6, ly = -0.65, lz = 0.65;
    let hmin = 255, hmax = 0;
    for (const v of h) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
    this.hmin = hmin; this.hmax = hmax;
    const ex = 2.2;   // exagération du relief : quelques mètres doivent se lire
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const H = (a, b) => h[clamp(b, 0, rows - 1) * cols + clamp(a, 0, cols - 1)];
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell) * ex, dy = (H(i, j + 1) - H(i, j - 1)) / (2 * cell) * ex;
      const nl = Math.hypot(dx, dy, 1), d = (-dx * lx - dy * ly + lz) / nl - lz;
      const k = (j * cols + i) * 4;
      id.data[k] = 46; id.data[k + 1] = 36; id.data[k + 2] = 62; id.data[k + 3] = clamp(-d * 330, 0, 150);
      il.data[k] = 255; il.data[k + 1] = 246; il.data[k + 2] = 214; il.data[k + 3] = clamp(d * 260, 0, 90);
    }
    gd.putImageData(id, 0, 0); gl.putImageData(il, 0, 0);
    this.shadeDark = dark; this.shadeLite = lite;
  }
  // courbes de niveau (carrés en marche), une maîtresse sur quatre
  prepContours() {
    const { cols, rows, cell, h } = this;
    const range = this.hmax - this.hmin;
    this.contours = [new Path2D(), new Path2D()];
    if (range < 3) return;
    const step = range > 50 ? 5 : range > 20 ? 4 : 2;
    const cx = i => (i + 0.5) * cell;
    // chaque point de passage est repéré par l'arête de la grille qu'il coupe : les segments se chaînent
    // en lignes continues, adoucies ensuite
    for (let lv = Math.ceil(this.hmin / step) * step + 0.5; lv <= this.hmax; lv += step) {
      const p = this.contours[Math.round(lv - 0.5) / step % 4 === 0 ? 1 : 0];
      const pos = new Map(), adj = new Map();
      const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
      const H = (i, j) => h[j * cols + i];
      const cross = (id, i0, j0, i1, j1) => {
        const h0 = H(i0, j0), h1 = H(i1, j1);
        if ((h0 < lv) === (h1 < lv)) return false;
        if (!pos.has(id)) { const f = (lv - h0) / (h1 - h0); pos.set(id, [cx(i0) + (cx(i1) - cx(i0)) * f, cx(j0) + (cx(j1) - cx(j0)) * f]); }
        return true;
      };
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const top = (j * cols + i) * 2, bot = ((j + 1) * cols + i) * 2, left = (j * cols + i) * 2 + 1, right = (j * cols + i + 1) * 2 + 1;
        const e = [];
        if (cross(top, i, j, i + 1, j)) e.push(top);
        if (cross(right, i + 1, j, i + 1, j + 1)) e.push(right);
        if (cross(bot, i, j + 1, i + 1, j + 1)) e.push(bot);
        if (cross(left, i, j, i, j + 1)) e.push(left);
        if (e.length === 2) link(e[0], e[1]);
        else if (e.length === 4) { link(e[0], e[1]); link(e[2], e[3]); }
      }
      const used = new Set();
      const walk = start => {
        const line = [start]; used.add(start);
        let cur = start;
        for (;;) {
          const nx = (adj.get(cur) || []).find(q => !used.has(q));
          if (nx === undefined) break;
          used.add(nx); line.push(nx); cur = nx;
        }
        return line;
      };
      const ends = [...adj.keys()].filter(k => adj.get(k).length === 1);
      for (const k of ends.concat([...adj.keys()])) {
        if (used.has(k)) continue;
        const line = walk(k);
        if (line.length < 3) continue;
        const pts = chaikin(line.map(q => pos.get(q)), 2, false);
        p.moveTo(pts[0][0], pts[0][1]);
        for (let q = 1; q < pts.length; q++) p.lineTo(pts[q][0], pts[q][1]);
      }
    }
    // cotes des sommets (comme sur les cartes d'état-major)
    this.peaks = [];
    if (range >= 8) {
      for (let j = 3; j < rows - 3; j++) for (let i = 3; i < cols - 3; i++) {
        const v = h[j * cols + i];
        if (v < this.hmin + range * 0.55) continue;
        let top = true;
        for (let b = -6; b <= 6 && top; b++) for (let a = -6; a <= 6; a++) {
          const ii = i + a, jj = j + b;
          if (ii < 0 || jj < 0 || ii >= cols || jj >= rows || (a === 0 && b === 0)) continue;
          if (h[jj * cols + ii] > v || (h[jj * cols + ii] === v && (b < 0 || (b === 0 && a < 0)))) { top = false; break; }
        }
        if (top) this.peaks.push({ x: cx(i), y: cx(j), h: v });
      }
      this.peaks.sort((p, q) => q.h - p.h);
      this.peaks = this.peaks.slice(0, 4);
    }
  }
  // routes et rivières adoucies, chemins reconstitués à partir des cases, ponts
  prepPaths() {
    const sm = pts => chaikin(pts.map(p => [p[0], p[1]]), 2, false);
    this.roadPts = this.roads.map(sm);
    this.lanePts = this.roadPts.filter((r, k) => this.roadKinds[k] === 'chemin');
    this.roadPts = this.roadPts.filter((r, k) => this.roadKinds[k] !== 'chemin');
    this.fencePts = this.fences.map(f => ({ kind: f.kind, pts: f.pts }));
    this.riverPts = this.rivers.map(r => ({ w: r.w || 12, pts: sm(r.pts) }));
    const { cols, rows, cell, t } = this;
    const isPath = c => t[c] === T.CHEMIN;
    const linked = c => t[c] === T.CHEMIN || t[c] === T.ROUTE || t[c] === T.GUE || t[c] === T.PORTE;
    const nb = c => {
      const i = c % cols, j = (c / cols) | 0, out = [];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < cols && jj < rows && linked(jj * cols + ii)) out.push(jj * cols + ii); }
      for (const [di, dj] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        const cc = jj * cols + ii;
        if (linked(cc) && !linked(j * cols + ii) && !linked(jj * cols + i)) out.push(cc);   // diagonale seulement sans détour
      }
      return out;
    };
    const seen = new Set(), chains = [];
    const key = (a, b) => a < b ? a * 1e6 + b : b * 1e6 + a;
    for (let c = 0; c < cols * rows; c++) {
      if (!isPath(c)) continue;
      for (const n of nb(c)) {
        if (seen.has(key(c, n))) continue;
        // suit la chaîne tant qu'elle ne bifurque pas
        const chain = [c, n]; seen.add(key(c, n));
        let prev = c, cur = n;
        for (let g = 0; g < 2000; g++) {
          if (!isPath(cur)) break;
          const nx = nb(cur).filter(q => q !== prev);
          if (nx.length !== 1 || seen.has(key(cur, nx[0]))) break;
          seen.add(key(cur, nx[0])); chain.push(nx[0]); prev = cur; cur = nx[0];
        }
        chains.push(chain);
      }
    }
    this.pathPts = this.lanePts.length ? this.lanePts : chains.map(ch => chaikin(ch.map(c => [(c % cols + 0.5) * cell + (hash(c, 1, this.seed) - 0.5) * 5, (((c / cols) | 0) + 0.5) * cell + (hash(c, 2, this.seed) - 0.5) * 5]), 2, false));
    // ponts : là où une route croise une rivière
    this.bridges = [];
    // ponts donnés par le moteur, sinon calculés là où une route croise une rivière
    if (this.bridgesIn && this.bridgesIn.length) this.bridges = this.bridgesIn.map(b => ({ x: b.x, y: b.y, a: b.a || 0, len: b.len || 30 }));
    else
    for (const r of this.roadPts) for (const rv of this.riverPts) {
      for (let a = 1; a < r.length; a++) for (let b = 1; b < rv.pts.length; b++) {
        const p = segInter(r[a - 1], r[a], rv.pts[b - 1], rv.pts[b]);
        if (p && !this.bridges.some(q => Math.hypot(q.x - p[0], q.y - p[1]) < 30)) {
          this.bridges.push({ x: p[0], y: p[1], a: Math.atan2(r[a][1] - r[a - 1][1], r[a][0] - r[a - 1][0]), len: rv.w + 14 });
        }
      }
    }
    // portes : sur les cases PORTE, dans le sens de la route
    this.gates = [];
    for (let c = 0; c < cols * rows; c++) if (t[c] === T.PORTE) {
      const x = (c % cols + 0.5) * cell, y = (((c / cols) | 0) + 0.5) * cell;
      if (this.gates.some(g => Math.hypot(g.x - x, g.y - y) < 40)) continue;
      let a = 0, best = 1e9;
      for (const r of this.roadPts) for (let k = 1; k < r.length; k++) {
        const d = Math.hypot((r[k][0] + r[k - 1][0]) / 2 - x, (r[k][1] + r[k - 1][1]) / 2 - y);
        if (d < best) { best = d; a = Math.atan2(r[k][1] - r[k - 1][1], r[k][0] - r[k - 1][0]); }
      }
      this.gates.push({ x, y, a });
    }
  }
  // couverts (bois, bâti, murs), hauteurs et terrains lents : mis en évidence pendant le déploiement
  prepCover() {
    const { cols, rows, t, h } = this;
    const cv = canvas(cols, rows), g = cv.getContext('2d'), img = g.createImageData(cols, rows);
    const range = Math.max(1, this.hmax - this.hmin);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const c = j * cols + i, v = t[c], k = c * 4;
      let col = null, a = 0;
      if (v === T.BOIS || v === T.FORET) { col = [70, 170, 70]; a = v === T.FORET ? 170 : 140; }
      else if (v === T.BATI || v === T.MUR || v === T.PORTE || v === T.BRECHE) { col = [90, 140, 230]; a = 170; }
      else if (v === T.VIGNE || v === T.MARAIS) { col = [150, 200, 120]; a = 60; }
      else {
        // hauteur : plus haute que ses alentours (à 160 m) d'au moins 10 % du relief
        let m = 0, n = 0;
        for (let b = -8; b <= 8; b += 4) for (let a2 = -8; a2 <= 8; a2 += 4) { const ii = clamp(i + a2, 0, cols - 1), jj = clamp(j + b, 0, rows - 1); m += h[jj * cols + ii]; n++; }
        const rel = (h[c] - m / n) / range;
        if (rel > 0.06 && range >= 6) { col = [240, 190, 70]; a = clamp(rel * 900, 50, 160); }
      }
      if (col) { img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = a; }
    }
    g.putImageData(img, 0, 0);
    this.coverImg = cv;
  }

  // ------------------------------------------------------------------ peinture d'un rectangle du monde
  pattern(g, key, make) {
    let p = this.patterns.get(key);
    if (!p) { p = make(); this.patterns.set(key, p); }
    return g.createPattern(p, 'repeat');
  }
  paintCanvas(x0, y0, wm, hm, s) {
    const cv = canvas(wm * s, hm * s), g = cv.getContext('2d');
    this.paint(g, x0, y0, wm, hm, s);
    return cv;
  }
  paint(g, x0, y0, wm, hm, s) {
    const pal = this.pal, snow = pal.neige, S = this.seed;
    const W = () => g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    // mesure facultative du temps de chaque étape (this.prof = {} pour l'activer)
    let tm = performance.now();
    const mark = k => { if (!this.prof) return; const n = performance.now(); this.prof[k] = (this.prof[k] || 0) + n - tm; tm = n; };
    const vis = b => !(b[2] < x0 - 20 || b[0] > x0 + wm + 20 || b[3] < y0 - 20 || b[1] > y0 + hm + 20);
    g.imageSmoothingEnabled = true;
    W();
    g.fillStyle = pal.pre[0];
    g.fillRect(x0 - 50, y0 - 50, wm + 100, hm + 100);
    const lb = s < 0.8 ? 0 : s < 1.5 ? 1 : s < 3 ? 2 : 3;   // niveau de détail des motifs
    const sp = [0.5, 1, 2, 4][lb];
    // sols
    for (const r of this.regions) {
      if (!vis(r.box)) continue;
      const v = r.type;
      let fill = null, rot = 0;
      switch (v) {
        case T.PRE: fill = pal.pre[r.tone]; break;
        case T.CHAMP: {
          const cols = pal.champ[r.tone];
          fill = this.pattern(g, `champ${r.tone}|${lb}`, () => stripePattern([cols[0], cols[1], cols[0], mixHex(cols[0], cols[1], 0.5)], sp, 22, true));
          rot = r.angle; break;
        }
        case T.VIGNE: fill = this.pattern(g, `vigne|${lb}`, () => vinePattern(pal.vigneSol, pal.vigneRang, sp, snow)); rot = r.angle; break;
        case T.LANDE: fill = this.pattern(g, `lande|${lb}`, () => dotsPattern(pal.lande, pal.landeFleurs, sp, 0.09, 0.5, 1.4, 5)); break;
        case T.MARAIS: fill = this.pattern(g, `marais|${lb}`, () => dotsPattern(pal.marais, [snow ? '#b8c4c6' : '#5f8a5c', snow ? '#a9b8bd' : '#9fbf9a', '#6d97b3'], sp, 0.05, 0.6, 1.8, 6)); break;
        case T.SABLE: fill = this.pattern(g, `sable|${lb}`, () => stripePattern([pal.sable, mixHex(pal.sable, '#b89a60', 0.18), pal.sable], sp, 7, false)); rot = 0.4; break;
        case T.ROCHE: fill = this.pattern(g, `roche|${lb}`, () => dotsPattern(pal.roche, [pal.rocheSombre, mixHex(pal.roche, '#ffffff', 0.3)], sp, 0.04, 0.6, 2.4, 7)); break;
        case T.BOIS: case T.FORET: fill = pal.sousBois; break;
        case T.ROUTE: case T.CHEMIN: fill = pal.pre[1]; break;
        case T.BATI: case T.PORTE: fill = pal.bati; break;
        case T.MUR: case T.BRECHE: fill = pal.bati; break;
        case T.BARRICADE: fill = snow ? '#d9d4ca' : '#b49a72'; break;
        case T.GUE: case T.EAU: continue;   // plus bas
      }
      if (!fill) continue;
      if (typeof fill !== 'string' && fill) {
        const m = new DOMMatrix().rotateSelf(rot * 180 / Math.PI).scaleSelf(1 / s, 1 / s);
        fill.setTransform(m);
      }
      g.fillStyle = fill;
      g.fill(r.path);
      // bordure des parcelles : talus et sentiers entre les champs
      if ((v === T.CHAMP || v === T.VIGNE) && s >= 0.9) {
        g.strokeStyle = 'rgba(90,70,40,0.28)';
        g.lineWidth = 1.2 / s * (s >= 2 ? 1.5 : 1);
        g.stroke(r.path);
      }
    }
    mark('sols');
    // grain du papier
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.28;
    g.fillStyle = g.createPattern(this.grain, 'repeat');
    g.fillRect(0, 0, wm * s, hm * s);
    g.restore();
    W();
    mark('grain');
    // marais : mares et roseaux ; rochers
    this.paintCells(g, x0, y0, wm, hm, s, snow);
    mark('cases');
    // eau : étangs et rivières (rive sombre, eau, reflets)
    for (const r of this.regions) {
      if ((r.type !== T.EAU && r.type !== T.GUE) || !vis(r.box)) continue;
      g.fillStyle = pal.eauBord; g.fill(r.path);
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const rv of this.riverPts) { g.strokeStyle = pal.eauBord; g.lineWidth = rv.w + 6; strokePts(g, rv.pts); }
    g.save();
    for (const r of this.regions) {
      if ((r.type !== T.EAU && r.type !== T.GUE) || !vis(r.box)) continue;
      g.fillStyle = r.type === T.GUE ? mixHex(pal.eau, pal.sable, 0.35) : pal.eau;
      g.translate(1.5, 1.5); g.fill(r.path); g.translate(-1.5, -1.5);
    }
    for (const rv of this.riverPts) { g.strokeStyle = pal.eau; g.lineWidth = rv.w; strokePts(g, rv.pts); }
    g.restore();
    if (s >= 0.9) {
      // reflets : un liseré clair le long de la rive éclairée, quelques rides au milieu
      for (const rv of this.riverPts) {
        g.strokeStyle = pal.eauHi; g.lineWidth = Math.max(0.8, rv.w * 0.06);
        strokePts(g, offsetPts(rv.pts, -rv.w * 0.36));
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(0.6, rv.w * 0.04);
        g.setLineDash([3, 9, 6, 17]); strokePts(g, offsetPts(rv.pts, rv.w * 0.08));
      }
      g.setLineDash([]);
      // vaguelettes sur les étangs
      g.strokeStyle = pal.eauHi; g.lineWidth = 0.8;
      for (const r of this.regions) {
        if (r.type !== T.EAU || !vis(r.box)) continue;
        g.beginPath();
        for (const c of r.cells) {
          if (hash(c, 9, S) > 0.25) continue;
          const x = (c % this.cols + hash(c, 1, S)) * this.cell, y = (((c / this.cols) | 0) + hash(c, 2, S)) * this.cell;
          g.moveTo(x - 4, y); g.quadraticCurveTo(x - 2, y - 1.6, x, y); g.quadraticCurveTo(x + 2, y - 1.6, x + 4, y);
        }
        g.stroke();
      }
      // gués : pierres dans l'eau claire
      g.fillStyle = 'rgba(120,110,90,0.65)';
      for (const r of this.regions) {
        if (r.type !== T.GUE || !vis(r.box)) continue;
        for (const c of r.cells) for (let k = 0; k < 6; k++) {
          const x = (c % this.cols + hash(c, k, 3)) * this.cell, y = (((c / this.cols) | 0) + hash(c, k, 4)) * this.cell;
          g.beginPath(); g.arc(x, y, 0.8 + hash(c, k, 5) * 1.2, 0, TAU); g.fill();
        }
      }
    }
    mark('eau');
    // relief : ombres et lumières, puis courbes de niveau
    g.save();
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.shadeDark, 0, 0, this.W, this.H);
    g.drawImage(this.shadeLite, 0, 0, this.W, this.H);
    g.restore();
    g.strokeStyle = snow ? 'rgba(90,100,120,0.22)' : 'rgba(110,78,40,0.2)'; g.lineWidth = Math.max(0.6, 0.9 / s);
    g.stroke(this.contours[0]);
    g.strokeStyle = snow ? 'rgba(90,100,120,0.34)' : 'rgba(110,78,40,0.34)'; g.lineWidth = Math.max(1, 1.5 / s);
    g.stroke(this.contours[1]);
    mark('relief');
    // routes et chemins
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const p of this.pathPts) { g.strokeStyle = 'rgba(110,90,60,0.35)'; g.lineWidth = 5.5; strokePts(g, p); }
    for (const p of this.pathPts) { g.strokeStyle = pal.chemin; g.lineWidth = 3.6; strokePts(g, p); }
    for (const r of this.roadPts) { g.strokeStyle = pal.routeBord; g.lineWidth = 10; strokePts(g, r); }
    for (const r of this.roadPts) { g.strokeStyle = pal.route; g.lineWidth = 7.5; strokePts(g, r); }
    if (s >= 1.5) {   // ornières
      g.strokeStyle = 'rgba(120,96,60,0.28)'; g.lineWidth = 0.5;
      for (const r of this.roadPts) { strokePts(g, offsetPts(r, -1.6)); strokePts(g, offsetPts(r, 1.6)); }
    }
    // ponts
    for (const b of this.bridges) {
      g.save(); g.translate(b.x, b.y); g.rotate(b.a);
      g.fillStyle = 'rgba(20,30,40,0.35)'; g.fillRect(-b.len / 2 + 2, -4.5 + 3, b.len, 9);
      g.fillStyle = snow ? '#d9d9d6' : '#cdbf9e'; g.fillRect(-b.len / 2, -5, b.len, 10);
      g.fillStyle = '#9c8b6a'; g.fillRect(-b.len / 2, -5, b.len, 1.4); g.fillRect(-b.len / 2, 3.6, b.len, 1.4);
      g.restore();
    }
    mark('routes');
    // murs et remparts, puis arbres et maisons en volume
    this.paintWalls(g, s);
    this.paintStanding(g, x0, y0, wm, hm, s);
    mark('debout');
    // décalcomanies : tués, trous d'obus
    for (const d of this.decals) if (d.x > x0 - 10 && d.x < x0 + wm + 10 && d.y > y0 - 10 && d.y < y0 + hm + 10) paintDecal(g, d, s);
  }
  paintCells(g, x0, y0, wm, hm, s, snow) {
    const { cols, rows, cell, t } = this, S = this.seed;
    const i0 = Math.max(0, Math.floor(x0 / cell) - 1), i1 = Math.min(cols - 1, Math.ceil((x0 + wm) / cell) + 1);
    const j0 = Math.max(0, Math.floor(y0 / cell) - 1), j1 = Math.min(rows - 1, Math.ceil((y0 + hm) / cell) + 1);
    const pools = new Path2D(), reeds = new Path2D(), rocks = new Path2D(), rocksD = new Path2D();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * cols + i, v = t[c], h = k => hash(i, j, S + k);
      if (v === T.MARAIS) {
        if (h(1) < 0.55) { const x = (i + h(2)) * cell, y = (j + h(3)) * cell, a = 3 + h(4) * 5; pools.moveTo(x + a, y); pools.ellipse(x, y, a, a * 0.55, h(5) * 3, 0, TAU); }
        if (s >= 0.9) for (let k = 0; k < 5; k++) { const x = (i + h(10 + k)) * cell, y = (j + h(20 + k)) * cell; reeds.moveTo(x, y); reeds.lineTo(x - 0.7, y - 2.6); reeds.moveTo(x + 0.8, y); reeds.lineTo(x + 1.3, y - 2.3); }
      } else if (v === T.ROCHE && h(1) < 0.7) {
        const x = (i + h(2)) * cell, y = (j + h(3)) * cell, r = 3 + h(4) * 6, a = h(5) * TAU;
        rocks.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        for (let k = 1; k < 6; k++) { const aa = a + k / 6 * TAU, rr = r * (0.7 + h(6 + k) * 0.4); rocks.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr); }
        rocks.closePath();
        rocksD.moveTo(x, y); rocksD.lineTo(x + r * 0.9, y + r * 0.2); rocksD.lineTo(x + r * 0.3, y + r * 0.9); rocksD.closePath();
      }
    }
    g.fillStyle = snow ? 'rgba(150,175,190,0.8)' : 'rgba(80,130,160,0.75)'; g.fill(pools);
    g.strokeStyle = snow ? 'rgba(100,100,90,0.5)' : 'rgba(60,90,45,0.7)'; g.lineWidth = 0.5; g.stroke(reeds);
    g.fillStyle = 'rgba(40,36,30,0.25)'; g.save(); g.translate(1.6, 1.6); g.fill(rocks); g.restore();
    g.fillStyle = mixHex(this.pal.roche, '#ffffff', snow ? 0.6 : 0.15); g.fill(rocks);
    g.fillStyle = 'rgba(60,56,48,0.35)'; g.fill(rocksD);
  }
  // Objets debout (arbres, maisons, église, moulin) en vue cavalière : l'ombre au sol d'abord, puis les volumes
  // du fond vers le devant. Le sol est écrasé à l'affichage (TILT) : les hauteurs sont peintes divisées par TILT.
  paintStanding(g, x0, y0, wm, hm, s) {
    const { cols, rows, cell } = this, pal = this.pal, snow = pal.neige;
    const i0 = Math.max(0, Math.floor(x0 / cell) - 1), i1 = Math.min(cols - 1, Math.ceil((x0 + wm) / cell) + 1);
    const j0 = Math.max(0, Math.floor(y0 / cell) - 1), j1 = Math.min(rows - 1, Math.ceil((y0 + hm + 30) / cell) + 1);
    const items = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const tr of this.treeGrid[j * cols + i]) items.push(tr);
    const blds = this.buildings.filter(b => !(b.x < x0 - 60 || b.x > x0 + wm + 60 || b.y < y0 - 60 || b.y > y0 + hm + 90));
    // ombres portées (vers le nord-est : le soleil est au sud-ouest, derrière l'observateur) ; les chemins sont
    // remplis par paquets : un seul chemin de milliers d'ellipses qui se chevauchent est très lent à remplir
    g.fillStyle = snow ? 'rgba(50,60,90,0.24)' : 'rgba(22,36,14,0.3)';
    for (let q0 = 0; q0 < items.length; q0 += 300) {
      const sh = new Path2D();
      for (const tr of items.slice(q0, q0 + 300)) {
        const r = tr.r, hh = tr.pine === 'parasol' ? r * 2.2 : r * 1.4;
        sh.moveTo(tr.x + hh * 0.55 + r, tr.y - hh * 0.25); sh.ellipse(tr.x + hh * 0.55, tr.y - hh * 0.25, r, r * 0.75, 0, 0, TAU);
      }
      g.fill(sh);
    }
    for (const b of blds) this.buildingShadow(g, b);
    if (s < 0.8) {
      // petite échelle (image entière) : arbres groupés par couleur, sans tri, par paquets
      for (let q0 = 0; q0 < items.length; q0 += 300) {
        const crowns = pal.arbres.map(() => new Path2D()), pines = new Path2D(), hi = new Path2D();
        for (const tr of items.slice(q0, q0 + 300)) {
          const r = tr.r, y = tr.y - r * 1.0 / TILT;
          const p = tr.pine ? pines : crowns[tr.ci % crowns.length];
          p.moveTo(tr.x + r, y); p.arc(tr.x, y, r, 0, TAU);
          hi.moveTo(tr.x - r * 0.3 + r * 0.4, y - r * 0.3); hi.arc(tr.x - r * 0.3, y - r * 0.3, r * 0.4, 0, TAU);
        }
        pal.arbres.forEach((c, k) => { g.fillStyle = snow ? mixHex(c, '#d8dde0', 0.25) : c; g.fill(crowns[k]); });
        g.fillStyle = pal.pins[0]; g.fill(pines);
        g.fillStyle = pal.arbreHi; g.fill(hi);
      }
      for (const b of blds) this.building(g, b, s);
      return;
    }
    const all = items.map(t => ({ y: t.y, t })).concat(blds.map(b => ({ y: b.y + Math.max(b.w, b.h) * 0.3, b })));
    all.sort((a, b) => a.y - b.y);
    for (const it of all) if (it.t) this.tree(g, it.t, s); else this.building(g, it.b, s);
  }
  tree(g, tr, s) {
    const pal = this.pal, snow = pal.neige, { x, y, r } = tr, k = 1 / TILT;
    const trunk = snow ? '#4a3c30' : '#5a4430';
    if (tr.pine === 'parasol') {
      // pin maritime des Landes : long fût, houppier plat
      const th = r * 2.0 * k;
      g.fillStyle = trunk; g.fillRect(x - r * 0.1, y - th, r * 0.2, th);
      const cy = y - th - r * 0.2;
      g.fillStyle = mixHex(pal.pins[0], '#000000', 0.25); g.beginPath(); g.ellipse(x + r * 0.1, cy + r * 0.15, r * 1.05, r * 0.55, 0, 0, TAU); g.fill();
      g.fillStyle = pal.pins[tr.ci % 2]; g.beginPath(); g.ellipse(x, cy, r, r * 0.5, 0, 0, TAU); g.fill();
      g.fillStyle = snow ? 'rgba(250,252,255,0.9)' : 'rgba(150,190,110,0.45)'; g.beginPath(); g.ellipse(x - r * 0.25, cy - r * 0.18, r * 0.5, r * 0.22, 0, 0, TAU); g.fill();
      return;
    }
    if (tr.pine) {
      // sapin de montagne : cône en étages
      const th = r * 0.35 * k, H = r * 2.6 * k;
      g.fillStyle = trunk; g.fillRect(x - r * 0.1, y - th, r * 0.2, th);
      for (let q = 0; q < 3; q++) {
        const by = y - th - q * H * 0.26, w = r * (1 - q * 0.22), ty = by - H * 0.5;
        g.fillStyle = pal.pins[1]; g.beginPath(); g.moveTo(x - w, by); g.lineTo(x, ty); g.lineTo(x + w, by); g.closePath(); g.fill();
        g.fillStyle = mixHex(pal.pins[0], '#000000', 0.2); g.beginPath(); g.moveTo(x, ty); g.lineTo(x + w, by); g.lineTo(x + w * 0.1, by); g.closePath(); g.fill();
        if (snow) { g.fillStyle = 'rgba(248,250,252,0.92)'; g.beginPath(); g.moveTo(x - w * 0.55, by - H * 0.18); g.lineTo(x, ty); g.lineTo(x + w * 0.2, by - H * 0.22); g.closePath(); g.fill(); }
      }
      return;
    }
    const th = r * 0.55 * k, cy = y - th - r * 0.8;
    g.fillStyle = trunk; g.fillRect(x - r * 0.12, y - th - r * 0.3, r * 0.24, th + r * 0.3);
    if (snow) {
      // feuillu nu : branches et neige
      g.strokeStyle = 'rgba(80,64,50,0.9)'; g.lineWidth = Math.max(0.25, r * 0.07);
      g.beginPath();
      for (let q = 0; q < 7; q++) { const a = -Math.PI / 2 + (q - 3) * 0.42, l = r * (0.7 + hash(q, tr.ci, 3) * 0.4); g.moveTo(x, cy + r * 0.5); g.lineTo(x + Math.cos(a) * l, cy + r * 0.3 + Math.sin(a) * l); }
      g.stroke();
      g.fillStyle = 'rgba(140,120,100,0.35)'; g.beginPath(); g.arc(x, cy, r * 0.9, 0, TAU); g.fill();
      g.fillStyle = 'rgba(250,252,255,0.75)'; g.beginPath(); g.arc(x - r * 0.25, cy - r * 0.35, r * 0.4, 0, TAU); g.fill();
      return;
    }
    const base = pal.arbres[tr.ci % pal.arbres.length];
    // touffe en volume : masse sombre, puis boules éclairées en haut à gauche
    g.fillStyle = mixHex(base, '#000000', 0.28);
    g.beginPath(); g.arc(x + r * 0.1, cy + r * 0.12, r, 0, TAU); g.arc(x + r * 0.55, cy - r * 0.05, r * 0.7, 0, TAU); g.arc(x - r * 0.5, cy + r * 0.15, r * 0.68, 0, TAU); g.fill();
    g.fillStyle = base;
    g.beginPath(); g.arc(x - r * 0.08, cy - r * 0.08, r * 0.85, 0, TAU); g.arc(x + r * 0.42, cy - r * 0.3, r * 0.55, 0, TAU); g.arc(x - r * 0.52, cy, r * 0.5, 0, TAU); g.fill();
    g.fillStyle = pal.arbreHi;
    g.beginPath(); g.arc(x - r * 0.3, cy - r * 0.38, r * 0.42, 0, TAU); g.fill();
  }
  // emprise d'un bâtiment : coins au sol, dans l'ordre
  corners(b) {
    const ca = Math.cos(b.a || 0), sa = Math.sin(b.a || 0), w = b.w / 2, h = b.h / 2;
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [b.x + u * ca - v * sa, b.y + u * sa + v * ca]);
  }
  bHeight(b) { return (b.kind === 'eglise' ? 10 : b.kind === 'moulin' ? 9 : b.kind === 'ferme' ? 5.5 : 5) / TILT; }
  buildingShadow(g, b) {
    const H = this.bHeight(b) * TILT, dx = H * 0.7, dy = -H * 0.35;
    if (b.kind === 'moulin') {
      const r = Math.max(b.w, b.h) / 2;
      g.fillStyle = 'rgba(25,20,30,0.3)'; g.beginPath(); g.ellipse(b.x + dx, b.y + dy, r * 1.4, r, -0.3, 0, TAU); g.fill(); return;
    }
    const c = this.corners(b);
    g.fillStyle = 'rgba(25,20,30,0.3)';
    g.beginPath();
    // enveloppe de l'emprise et de l'emprise décalée (assez juste pour une ombre)
    const pts = c.concat(c.map(p => [p[0] + dx, p[1] + dy]));
    const hull = convexHull(pts);
    g.moveTo(hull[0][0], hull[0][1]); for (const p of hull.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill();
  }
  building(g, b, s) {
    const pal = this.pal, snow = pal.neige, kind = b.kind || 'maison';
    const H = this.bHeight(b), k = (b.x * 7 + b.y * 13) | 0;
    const montagne = this.hmax > 55;
    const walls = montagne ? ['#f2efe8', '#ebe6dc'] : this.landesLike() ? ['#f1ebdf', '#e9e1d0'] : ['#e8dcbc', '#dfd0aa', '#eadfc4'];
    const wall = kind === 'eglise' ? '#d9ccb0' : walls[Math.abs(k) % walls.length];
    const roofs = kind === 'eglise' || montagne ? pal.ardoise : pal.toit;
    const roof = roofs[Math.abs(k) % roofs.length];
    g.lineJoin = 'round'; g.lineWidth = Math.max(0.25, 0.6 / s); g.strokeStyle = 'rgba(60,44,26,0.7)';
    if (kind === 'moulin') {
      const r = Math.max(b.w, b.h) / 2;
      g.fillStyle = mixHex(wall, '#000000', 0.12); g.fillRect(b.x - r, b.y - H, r * 2, H);
      g.fillStyle = wall; g.fillRect(b.x - r, b.y - H, r * 1.1, H);
      g.beginPath(); g.ellipse(b.x, b.y, r, r * 0.45, 0, 0, Math.PI); g.fill();
      g.fillStyle = roof; g.beginPath(); g.moveTo(b.x - r * 1.1, b.y - H); g.lineTo(b.x, b.y - H - r * 1.6); g.lineTo(b.x + r * 1.1, b.y - H); g.closePath(); g.fill(); g.stroke();
      g.save(); g.translate(b.x + r * 0.2, b.y - H - r * 0.2); g.rotate(b.a || 0.4);
      for (let q = 0; q < 4; q++) { g.rotate(Math.PI / 2); g.fillStyle = '#5a4630'; g.fillRect(-0.4, -r * 2.6, 0.8, r * 2.5); g.fillStyle = 'rgba(244,236,214,0.9)'; g.fillRect(0.4, -r * 2.5, r * 0.75, r * 1.9); }
      g.restore();
      return;
    }
    const c = this.corners(b);
    // murs tournés vers l'observateur (normale vers le bas de l'écran)
    const up = p => [p[0], p[1] - H];
    for (let q = 0; q < 4; q++) {
      const a = c[q], bb = c[(q + 1) % 4], nx = bb[1] - a[1], ny = -(bb[0] - a[0]);
      // la normale extérieure d'une arête parcourue dans le sens horaire est (dy, −dx)
      if (ny <= 0.01) continue;
      const lit = nx < 0;
      g.fillStyle = mixHex(wall, '#000000', lit ? 0.02 : 0.2);
      const A = up(a), B = up(bb);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(bb[0], bb[1]); g.lineTo(B[0], B[1]); g.lineTo(A[0], A[1]); g.closePath(); g.fill(); g.stroke();
      // porte et fenêtres sur les longs murs
      const L = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      if (L > 8 && s >= 1.5) {
        g.fillStyle = '#3d4c5c';
        for (let f = 0.22; f < 0.9; f += 0.28) {
          const fx = a[0] + (bb[0] - a[0]) * f, fy = a[1] + (bb[1] - a[1]) * f;
          g.fillRect(fx - 0.6, fy - H * 0.72, 1.2, H * 0.24);
        }
      }
    }
    // toit à deux pans, faîtage dans la longueur
    const long = b.w >= b.h;
    const [p0, p1, p2, p3] = c.map(up);
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const rh = Math.min(b.w, b.h) * (montagne ? 0.55 : 0.4) / TILT;
    let r1, r2, planes;
    if (long) { r1 = mid(p0, p3); r2 = mid(p1, p2); planes = [[p0, p1, r2, r1], [p3, p2, r2, r1]]; }
    else { r1 = mid(p0, p1); r2 = mid(p3, p2); planes = [[p0, p3, r2, r1], [p1, p2, r2, r1]]; }
    r1 = [r1[0], r1[1] - rh]; r2 = [r2[0], r2[1] - rh];
    planes = planes.map(pl => [pl[0], pl[1], r2, r1]);
    // le pan dont le bord est le plus bas à l'écran est devant
    planes.sort((A, B) => (A[0][1] + A[1][1]) - (B[0][1] + B[1][1]));
    planes.forEach((pl, q) => {
      g.fillStyle = snow ? (q ? '#f4f6f8' : '#dde3e8') : mixHex(roof, q ? '#ffffff' : '#000000', q ? 0.1 : 0.2);
      g.beginPath(); g.moveTo(pl[0][0], pl[0][1]); g.lineTo(pl[1][0], pl[1][1]); g.lineTo(pl[2][0], pl[2][1]); g.lineTo(pl[3][0], pl[3][1]); g.closePath(); g.fill(); g.stroke();
    });
    // pignons (triangles aux bouts)
    const gab = long ? [[p0, p3, r1], [p1, p2, r2]] : [[p0, p1, r1], [p3, p2, r2]];
    for (const [a, bb, r] of gab) {
      if (Math.max(a[1], bb[1]) < r[1] + 0.5) continue;
      g.fillStyle = mixHex(wall, '#000000', 0.1);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(bb[0], bb[1]); g.lineTo(r[0], r[1]); g.closePath(); g.fill(); g.stroke();
    }
    // clocher de l'église, à un bout de la nef
    if (kind === 'eglise') {
      const ca = Math.cos(b.a || 0), sa = Math.sin(b.a || 0), tx = b.x - ca * (b.w / 2 + 3), ty = b.y - sa * (b.w / 2 + 3), tw = 6.5, TH = 22 / TILT;
      g.fillStyle = mixHex('#d9ccb0', '#000000', 0.18); g.fillRect(tx, ty - TH, tw / 2, TH); g.strokeRect(tx - tw / 2, ty - TH, tw, TH);
      g.fillStyle = '#d9ccb0'; g.fillRect(tx - tw / 2, ty - TH, tw / 2, TH);
      g.fillStyle = '#3b2c1c'; g.fillRect(tx - 1, ty - TH * 0.85, 2, TH * 0.12);
      g.fillStyle = snow ? '#eef1f4' : pal.ardoise[0];
      g.beginPath(); g.moveTo(tx - tw / 2 - 0.6, ty - TH); g.lineTo(tx, ty - TH - 9 / TILT); g.lineTo(tx + tw / 2 + 0.6, ty - TH); g.closePath(); g.fill(); g.stroke();
    }
  }
  paintWalls(g, s) {
    const pal = this.pal, snow = pal.neige;
    const breaches = this.walls.flatMap(w => (w.breach || []).map(b => ({ x: b[0], y: b[1], r: b[2] || 20 })));
    g.save();
    if (breaches.length) {
      // les brèches sont exclues du tracé des remparts
      const clip = new Path2D();
      clip.rect(-100, -100, this.W + 200, this.H + 200);
      for (const b of breaches) { clip.moveTo(b.x + b.r, b.y); clip.arc(b.x, b.y, b.r, 0, TAU, true); }
      g.clip(clip, 'evenodd');
    }
    g.lineJoin = 'miter'; g.lineCap = 'butt'; g.miterLimit = 3;
    // enceintes : rempart, enceinte bastionnée, ou mur de ville épais ; la largeur suit `thick` quand il est donné
    const small = w => { const xs = w.pts.map(p => p[0]), ys = w.pts.map(p => p[1]); return Math.max(...xs) - Math.min(...xs) < 160 && Math.max(...ys) - Math.min(...ys) < 160; };
    const fort = this.walls.filter(w => w.kind === 'rempart' || w.kind === 'bastion' || (w.kind === 'mur' && (w.thick || 0) >= 5));
    const th = w => clamp(w.thick || (w.kind === 'mur' ? 6 : 16), 4, 24);
    // fossé, puis talus extérieur (glacis clair), escarpe de pierre, terre-plein gazonné, parapet ; jamais sur l'eau
    const segs = fort.map(w => ({ w, parts: small(w) ? [w.pts] : this.splitDry(w.pts) }));
    const each = (f, skipMur = false) => { for (const { w, parts } of segs) { if (skipMur && w.kind === 'mur') continue; for (const pts of parts) f(w, pts); } };
    g.lineJoin = 'round';
    each((w, pts) => { g.strokeStyle = snow ? '#aab4b8' : '#7f8f62'; g.lineWidth = th(w) * 1.7; strokePts(g, pts); }, true);
    each((w, pts) => { g.strokeStyle = snow ? '#c5ccd0' : '#6d7d55'; g.lineWidth = th(w) * 1.3; strokePts(g, pts); }, true);
    each((w, pts) => { g.strokeStyle = 'rgba(20,20,26,0.4)'; g.lineWidth = th(w) * 0.9; g.save(); g.translate(2.5, 2.5); strokePts(g, pts); g.restore(); });
    each((w, pts) => { g.strokeStyle = snow ? '#e4e4e0' : '#d3c6a2'; g.lineWidth = th(w) * 0.85; strokePts(g, pts); });
    for (const w of fort) if (w.kind === 'bastion' && small(w)) { g.fillStyle = snow ? '#eef0f0' : '#9aab6c'; fillPts(g, w.pts); }
    each((w, pts) => { g.strokeStyle = w.kind === 'mur' ? (snow ? '#e8e8e4' : '#c9bb96') : snow ? '#f2f3f3' : '#9aab6c'; g.lineWidth = th(w) * 0.58; strokePts(g, pts); });
    each((w, pts) => { g.strokeStyle = snow ? '#d6d8d6' : '#c2b48e'; g.lineWidth = Math.max(1.4, th(w) * 0.12); strokePts(g, pts); });
    // créneaux : petites dents le long du mur de ville
    for (const w of fort) {
      if (w.kind !== 'mur') continue;
      g.fillStyle = snow ? '#b9b9b4' : '#a39472';
      for (const p of resample(w.pts, 3)) g.fillRect(p[0] - 0.6, p[1] - 0.6, 1.2, 1.2);
    }
    // murs de clôture
    for (const w of this.walls) {
      if (w.kind !== 'mur' || fort.includes(w)) continue;
      g.strokeStyle = 'rgba(25,20,30,0.3)'; g.lineWidth = 2.4; g.save(); g.translate(1, 1); strokePts(g, w.pts); g.restore();
      g.strokeStyle = snow ? '#f0f0ee' : '#d4c7a5'; g.lineWidth = 1.8; strokePts(g, w.pts);
    }
    // clôtures, haies et murets qui bordent champs et chemins
    for (const f of this.fencePts) {
      if (f.kind === 'haie') {
        g.strokeStyle = snow ? 'rgba(60,70,60,0.5)' : 'rgba(30,60,24,0.45)'; g.lineWidth = 4.2; g.lineCap = 'round'; strokePts(g, f.pts.map(p => [p[0] + 0.8, p[1] + 0.8]));
        g.fillStyle = snow ? '#6f7d6c' : this.pal.arbres[1];
        for (const [k, p] of resample(f.pts, 2.2).entries()) { g.beginPath(); g.arc(p[0] + (hash(k, 1, p[0] | 0) - 0.5), p[1] + (hash(k, 2, p[1] | 0) - 0.5), 1.5 + hash(k, 3, 7) * 0.8, 0, TAU); g.fill(); }
        if (snow) { g.fillStyle = 'rgba(250,252,255,0.8)'; for (const p of resample(f.pts, 3)) { g.beginPath(); g.arc(p[0] - 0.5, p[1] - 0.6, 0.8, 0, TAU); g.fill(); } }
      } else if (f.kind === 'muret') {
        g.strokeStyle = 'rgba(30,26,20,0.3)'; g.lineWidth = 1.8; g.save(); g.translate(0.6, 0.6); strokePts(g, f.pts); g.restore();
        g.strokeStyle = snow ? '#e6e6e2' : '#b9b09a'; g.lineWidth = 1.4; strokePts(g, f.pts);
        if (s >= 1.5) { g.strokeStyle = 'rgba(90,80,64,0.5)'; g.lineWidth = 0.25; g.setLineDash([0.9, 0.7]); strokePts(g, f.pts); g.setLineDash([]); }
      } else {
        // clôture de bois : lisses et piquets
        g.strokeStyle = snow ? 'rgba(90,76,60,0.8)' : 'rgba(110,84,52,0.85)'; g.lineWidth = 0.5; strokePts(g, f.pts);
        if (s >= 0.9) { g.fillStyle = '#5a4430'; for (const p of resample(f.pts, 3)) g.fillRect(p[0] - 0.35, p[1] - 0.35, 0.7, 0.7); }
      }
    }
    // barricades et tranchées. Les longs tracés sont des tranchées de siège : terre rejetée en parapet, fond sombre,
    // gabions (paniers de terre) sur la crête ; les courts, des barricades de charrettes et de poutres.
    // On ne les trace jamais sur l'eau.
    const hasBar = this.t.includes(T.BARRICADE);
    for (const w of this.walls) {
      if (w.kind !== 'barricade') continue;
      if (small(w) && hasBar) {
        // redoute : terre remuée, parapet en carré, gabions aux angles
        g.fillStyle = snow ? 'rgba(200,192,180,0.7)' : 'rgba(150,120,80,0.55)'; fillPts(g, w.pts);
        g.strokeStyle = snow ? '#d8d2c8' : '#9c7a4e'; g.lineWidth = 7; g.lineJoin = 'round'; strokePts(g, w.pts);
        g.strokeStyle = snow ? '#7d7468' : '#4d3b26'; g.lineWidth = 1.6; strokePts(g, w.pts);
        continue;
      }
      for (const pts of this.splitDry(w.pts, hasBar)) {
        if (pts.length < 2) continue;
        const len = pts.reduce((a, p, k) => k ? a + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0, 0);
        g.lineCap = 'round'; g.lineJoin = 'round';
        if (len > 70) {
          g.strokeStyle = snow ? 'rgba(150,140,128,0.5)' : 'rgba(120,92,58,0.45)'; g.lineWidth = 12; strokePts(g, pts);   // terre remuée
          g.strokeStyle = snow ? '#d8d2c8' : '#9c7a4e'; g.lineWidth = 7; strokePts(g, offsetPts(pts, -2));                 // parapet
          g.strokeStyle = snow ? '#7d7468' : '#4d3b26'; g.lineWidth = 2.6; strokePts(g, offsetPts(pts, 2.2));              // le fossé
          const gab = resample(offsetPts(pts, -3.2), 2.6);
          for (const [k, p] of gab.entries()) {
            g.fillStyle = 'rgba(40,28,16,0.45)'; g.beginPath(); g.arc(p[0] + 0.4, p[1] + 0.4, 1.2, 0, TAU); g.fill();
            g.fillStyle = k % 2 ? '#a88452' : '#b8955f'; g.beginPath(); g.arc(p[0], p[1] - 0.3, 1.05, 0, TAU); g.fill();
          }
        } else {
          g.strokeStyle = 'rgba(30,22,14,0.35)'; g.lineWidth = 4.5; g.save(); g.translate(1, 1); strokePts(g, pts); g.restore();
          g.strokeStyle = snow ? '#8d8070' : '#6e5134'; g.lineWidth = 3.5; strokePts(g, pts);
          g.strokeStyle = snow ? '#c9c1b5' : '#9a7650'; g.lineWidth = 1; g.setLineDash([2.5, 1.5]); strokePts(g, pts); g.setLineDash([]);
        }
      }
    }
    g.restore();
    // éboulis des brèches
    for (const b of breaches) {
      for (let k = 0; k < 46; k++) {
        const a = hash(k, 1, b.x) * TAU, r = Math.sqrt(hash(k, 2, b.y)) * b.r * 1.05;
        g.fillStyle = k % 3 ? (snow ? '#dcdcd8' : '#cbbd98') : '#8f8168';
        const sz = 1.2 + hash(k, 3, b.x) * 2.8;
        g.fillRect(b.x + Math.cos(a) * r - sz / 2, b.y + Math.sin(a) * r - sz / 2, sz, sz * 0.8);
      }
    }
    // portes de la ville
    for (const gt of this.gates) {
      g.save(); g.translate(gt.x, gt.y); g.rotate(gt.a);
      g.fillStyle = 'rgba(25,20,30,0.35)'; g.fillRect(-5, -11, 12, 24);
      g.fillStyle = snow ? '#e8eaec' : '#cdbf9c'; g.fillRect(-7, -12, 12, 24);
      g.fillStyle = '#4a3a2a'; g.fillRect(-7, -3, 12, 6);
      g.fillStyle = pal.ardoise[0]; g.fillRect(-5, -11, 8, 6); g.fillRect(-5, 5, 8, 6);
      g.restore();
    }
  }

  // découpe une ligne là où elle passe sur l'eau
  // (et, si onlyBar, là où la case n'est pas une barricade : le moteur laisse des trouées)
  splitDry(pts, onlyBar = false) {
    const out = [];
    let cur = [];
    for (const p of resample(pts, 4).concat([pts[pts.length - 1]])) {
      const t = this.at(p[0], p[1]);
      if (t === T.EAU || t === T.GUE || (onlyBar && t !== T.BARRICADE)) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }

  // ------------------------------------------------------------------ tuiles
  setQuality(q) {
    this.q = q || { level: 4, tiles: 64 };
    this.levels = LEVELS.filter(L => L <= this.q.level);
    // tuiles d'un niveau désormais trop fin : libérées tout de suite
    for (const [k, t] of this.tiles) if (Math.floor(k / 100000) > this.q.level) { this.tiles.delete(k); t.width = t.height = 0; }
    this.evict();
  }
  // niveau des tuiles : on accepte de les agrandir un peu (30 %) plutôt que d'en peindre quatre fois plus
  level(zp) { for (const L of this.levels) if (L >= zp * 0.75) return L; return this.levels[this.levels.length - 1]; }
  tileKey(L, i, j) { return L * 100000 + j * 1000 + i; }
  // dessine le fond visible ; budget : nombre de tuiles qu'on peut encore peindre à cette image
  draw(ctx, cam, vw, vh, dpr, budget = 2) {
    const zp = cam.z * dpr, L = this.level(zp);
    const x0 = cam.x - vw / 2 / cam.z, y0 = cam.y - vh / 2 / cam.z, x1 = cam.x + vw / 2 / cam.z, y1 = cam.y + vh / 2 / cam.z;
    ctx.imageSmoothingEnabled = true;
    // fond entier (secours) d'abord, sous les tuiles manquantes
    const span = TS / L;
    const i0 = Math.max(0, Math.floor(x0 / span)), i1 = Math.min(Math.ceil(this.W / span) - 1, Math.floor(x1 / span));
    const j0 = Math.max(0, Math.floor(y0 / span)), j1 = Math.min(Math.ceil(this.H / span) - 1, Math.floor(y1 / span));
    let missing = false, painted = 0;
    this.busy = false;
    const order = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) order.push([i, j, Math.hypot((i + 0.5) * span - cam.x, (j + 0.5) * span - cam.y)]);
    order.sort((a, b) => a[2] - b[2]);
    const draws = [];
    for (const [i, j] of order) {
      const k = this.tileKey(L, i, j);
      let tile = this.tiles.get(k);
      if (!tile && painted < budget) { tile = this.paintCanvas(i * span, j * span, span, span, L); tile._k = k; this.tiles.set(k, tile); painted++; this.busy = true; }
      if (tile) { this.tiles.delete(k); this.tiles.set(k, tile); draws.push([tile, i, j]); } else missing = true;
    }
    if (missing || !draws.length) {
      // l'image entière, agrandie, ou une tuile d'un autre niveau déjà prête
      ctx.drawImage(this.base, 0, 0, this.W * BASE, this.H * BASE, 0, 0, this.W, this.H);
      for (const L2 of this.levels) {
        if (L2 === L) continue;
        const sp2 = TS / L2;
        for (let j = Math.max(0, Math.floor(y0 / sp2)); j <= Math.floor(y1 / sp2); j++) for (let i = Math.max(0, Math.floor(x0 / sp2)); i <= Math.floor(x1 / sp2); i++) {
          const t2 = this.tiles.get(this.tileKey(L2, i, j));
          if (t2 && t2.width) ctx.drawImage(t2, i * sp2, j * sp2, sp2 + 0.6 / cam.z, sp2 + 0.6 / cam.z);
        }
      }
    }
    // léger recouvrement : pas de joint visible entre deux tuiles
    for (const [tile, i, j] of draws) ctx.drawImage(tile, i * span, j * span, span + 0.6 / cam.z, span + 0.6 / cam.z);
    this.pending = missing ? null : { L, span, i0: i0 - 1, i1: i1 + 1, j0: j0 - 1, j1: j1 + 1 };
    // éviction après le dessin : jamais une tuile de cette image (elles sont en fin de file)
    this.evict(Math.max(this.q.tiles, draws.length + 8));
    return missing;
  }
  // temps libre : peint d'avance une tuile voisine de la vue (rastérisée tout de suite), pour un défilement sans à-coup
  prefetch() {
    const p = this.pending;
    if (!p) return false;
    const ni = Math.ceil(this.W / p.span) - 1, nj = Math.ceil(this.H / p.span) - 1;
    for (let j = Math.max(0, p.j0); j <= Math.min(nj, p.j1); j++) for (let i = Math.max(0, p.i0); i <= Math.min(ni, p.i1); i++) {
      const k = this.tileKey(p.L, i, j);
      if (this.tiles.has(k)) continue;
      const tile = this.paintCanvas(i * p.span, j * p.span, p.span, p.span, p.L);
      tile.getContext('2d').getImageData(0, 0, 1, 1);
      this.busy = true;
      tile._k = k;
      // en tête de file : la première évincée si la vue part ailleurs
      const rest = [...this.tiles.entries()];
      this.tiles.clear(); this.tiles.set(k, tile); for (const [kk, t] of rest) this.tiles.set(kk, t);
      this.evict();
      return true;
    }
    this.pending = null;
    return false;
  }
  evict(max = this.q.tiles) {
    while (this.tiles.size > max) {
      const [k, t] = this.tiles.entries().next().value;
      this.tiles.delete(k);
      t.width = t.height = 0;   // Safari garde sinon la mémoire
    }
  }
  // tués, chevaux, trous d'obus : peints dans le fond (tuiles faites et à venir)
  addDecals(list) {
    if (!list.length) return;
    this.decals.push(...list);
    if (this.decals.length > 6000) this.decals.splice(0, this.decals.length - 6000);
    const paintInto = (cv, x0, y0, s) => {
      const g = cv.getContext('2d');
      g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
      for (const d of list) paintDecal(g, d, s);
    };
    paintInto(this.base, 0, 0, BASE);
    for (const t of this.tiles.values()) {
      const k = t._k, L = Math.floor(k / 100000), j = Math.floor((k % 100000) / 1000), i = k % 1000, span = TS / L;
      if (list.some(d => d.x > i * span - 10 && d.x < (i + 1) * span + 10 && d.y > j * span - 10 && d.y < (j + 1) * span + 10)) paintInto(t, i * span, j * span, L);
    }
  }
  dispose() {
    for (const t of this.tiles.values()) t.width = t.height = 0;
    this.tiles.clear();
    this.base.width = this.base.height = 0;
  }
}

function strokePts(g, pts) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
  g.stroke();
}
function fillPts(g, pts) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
  g.closePath(); g.fill();
}
function offsetPts(pts, d) {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - dy / l * d, p[1] + dx / l * d];
  });
}
function resample(pts, step) {
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k], L = Math.hypot(bx - ax, by - ay);
    for (let u = 0; u < L; u += step) out.push([ax + (bx - ax) * u / L, ay + (by - ay) * u / L]);
  }
  return out;
}
function segInter(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return null;
  const u = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const v = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [p1[0] + (p2[0] - p1[0]) * u, p1[1] + (p2[1] - p1[1]) * u] : null;
}
// toit à deux pans vu de haut : pan éclairé, pan à l'ombre, faîtage
function roofTop(g, w, h, roof, snow) {
  const lit = snow ? '#f4f6f8' : mixHex(roof, '#ffffff', 0.18), dark = snow ? '#d4dae0' : mixHex(roof, '#000000', 0.22);
  g.fillStyle = lit; g.fillRect(-w / 2, -h / 2, w, h / 2);
  g.fillStyle = dark; g.fillRect(-w / 2, 0, w, h / 2);
  if (snow) { g.fillStyle = mixHex(roof, '#ffffff', 0.4); g.fillRect(-w / 2, -h / 2, w, 0.6); g.fillRect(-w / 2, h / 2 - 0.6, w, 0.6); }
  // croupes : les bouts du toit en biais
  g.fillStyle = mixHex(snow ? '#e4e8ec' : roof, '#000000', 0.08);
  g.beginPath(); g.moveTo(-w / 2, -h / 2); g.lineTo(-w / 2 + h * 0.45, 0); g.lineTo(-w / 2, h / 2); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(w / 2, -h / 2); g.lineTo(w / 2 - h * 0.45, 0); g.lineTo(w / 2, h / 2); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(50,30,20,0.55)'; g.lineWidth = 0.45;
  g.beginPath(); g.moveTo(-w / 2 + h * 0.45, 0); g.lineTo(w / 2 - h * 0.45, 0); g.stroke();
  g.strokeRect(-w / 2, -h / 2, w, h);
}
function paintDecal(g, d, s) {
  g.save(); g.translate(d.x, d.y); g.rotate(d.a || 0);
  if (d.k === 'trou') {
    g.fillStyle = 'rgba(96,74,48,0.4)'; g.beginPath(); g.ellipse(0, 0, d.r || 2.6, (d.r || 2.6) * 0.8, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(60,44,28,0.35)'; g.beginPath(); g.ellipse(0.4, 0.3, (d.r || 2.6) * 0.5, (d.r || 2.6) * 0.4, 0, 0, TAU); g.fill();
  } else if (d.k === 'cheval') {
    g.fillStyle = 'rgba(30,20,15,0.25)'; g.fillRect(-1.3 + 0.3, -0.5 + 0.3, 2.6, 1.0);
    g.fillStyle = d.c2 || '#5a3e26'; g.beginPath(); g.ellipse(0, 0, 1.3, 0.5, 0, 0, TAU); g.fill();
  } else {
    // soldat tombé : habit aux couleurs du camp, tête, fusil
    g.fillStyle = 'rgba(30,20,15,0.25)'; g.fillRect(-0.85 + 0.2, -0.3 + 0.2, 1.7, 0.6);
    g.fillStyle = d.c || '#555'; g.fillRect(-0.85, -0.3, 1.5, 0.6);
    g.fillStyle = '#2a2018'; g.beginPath(); g.arc(0.85, 0, 0.28, 0, TAU); g.fill();
    if (s >= 2) { g.strokeStyle = 'rgba(60,40,25,0.8)'; g.lineWidth = 0.12; g.beginPath(); g.moveTo(-1, 0.6); g.lineTo(0.8, 0.9); g.stroke(); }
  }
  g.restore();
}

// enveloppe convexe (chaîne monotone)
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
