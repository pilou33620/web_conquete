// Vue tactique : peinture du champ de bataille, vu de haut, à la manière d'un paysage peint : herbe aux nuances
// multiples, cultures striées selon la saison, chemins de terre à ornières, haies et murets en relief, arbres
// éclairés avec leur ombre, maisons en volume, eau avec berges et reflets, relief ombré (lumière du nord-ouest).
// Le fond est peint une fois : une image entière à basse résolution (aussi mini-carte et fond de secours),
// puis des tuiles plus fines à la demande selon le zoom (jusqu'à 16 pixels par mètre selon la qualité graphique).
// À chaque image ne sont plus dessinées que les unités et les effets. Les tués et les trous d'obus sont peints
// dans les tuiles déjà faites (décalcomanies). Motifs et silhouettes d'arbres : textures.js.
import { T, cellRemap, normSeason, hash, clamp, TAU, TILT, OMBRE, mixHex, vnoise, canvas } from './formes.js';
import { texture, texSize, treeSprite, softShadow, culture } from './textures.js';
import { profil } from './qualite.js';

const TS = 512;                         // côté d'une tuile, en pixels de l'écran
const LEVELS = [1, 2, 4, 8, 16];        // pixels (physiques) par mètre des tuiles, jusqu'au plus fin permis par la
const BASE = 0.5;                       // qualité graphique ; l'image entière est à BASE

function b64(s) {
  if (!s) return null;
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ------------------------------------------------------------------ palettes des saisons
// prairies (et herbe sèche), cultures (sous la neige en hiver), vignes, landes, sous-bois, feuillages, eau…
export const PALETTES = {
  printemps: {
    pre: ['#93c05c', '#88b955', '#9dc866', '#a5c86a'], herbeSec: '#b9c46c', champ: [['#b9c766', '#a9bd5c'], ['#a98b5e', '#977a52'], ['#e2d45e', '#d6c652'], ['#9fc25c', '#8fb350']],
    vigneSol: '#b5a27a', vigneRang: '#5d8f36', lande: '#a3a067', landeFleurs: ['#8f6a92', '#c9b648', '#6f7d48'], sousBois: '#4f7a38',
    arbres: ['#3d7a34', '#4b8a3b', '#5a9944'], arbreHi: 'rgba(170,215,110,0.55)', pins: ['#2f6136', '#3a6d3c'], marais: '#7fa37e', sable: '#e2d29c',
    roche: '#aaa491', rocheSombre: '#7d7867', eau: '#4f8cc6', eauBord: '#2f6297', eauHi: 'rgba(200,228,250,0.55)', route: '#d3be8f', routeBord: '#9c845a',
    chemin: '#c9b588', bati: '#c1b08e', toit: ['#b4513a', '#c0623e', '#a9472f'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  ete: {
    pre: ['#9cb456', '#91ab4f', '#a7bb60', '#98ad55'], herbeSec: '#c6b866', champ: [['#e6c56a', '#d8b65c'], ['#d9bd78', '#cbac66'], ['#c9a35c', '#b99352'], ['#b4b85e', '#a6aa54']],
    vigneSol: '#c4ab7c', vigneRang: '#4c7d2c', lande: '#ada060', landeFleurs: ['#9c6a8e', '#d8bf4a', '#857a48'], sousBois: '#46703a',
    arbres: ['#3f7a33', '#4c8a3a', '#5b9744'], arbreHi: 'rgba(160,200,100,0.5)', pins: ['#2b5a33', '#356638'], marais: '#87a37a', sable: '#ead7a0',
    roche: '#b2aa94', rocheSombre: '#857e6a', eau: '#4a88c2', eauBord: '#2c5e94', eauHi: 'rgba(210,235,250,0.55)', route: '#dcc89a', routeBord: '#a48a5c',
    chemin: '#d3be90', bati: '#c9b893', toit: ['#b85a3c', '#c4643a', '#a94a2a'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  automne: {
    pre: ['#8e9e58', '#859651', '#97a35e', '#8a9152'], herbeSec: '#ab9c5c', champ: [['#8c6a46', '#7c5c3c'], ['#a3825a', '#93744e'], ['#b89a64', '#a98b58'], ['#7f8a4c', '#717c44']],
    vigneSol: '#9e8460', vigneRang: '#a27a34', lande: '#93774f', landeFleurs: ['#a0522d', '#8a6a3a', '#6c6040'], sousBois: '#6a6234',
    arbres: ['#a8692a', '#c08a30', '#7c7a32', '#9a4a26'], arbreHi: 'rgba(240,200,110,0.45)', pins: ['#2f5a35', '#3a6439'], marais: '#7c8f6c', sable: '#dccb98',
    roche: '#a39d8a', rocheSombre: '#77715f', eau: '#4a7fb4', eauBord: '#2b5788', eauHi: 'rgba(200,222,240,0.5)', route: '#c2ab7c', routeBord: '#8a724c',
    chemin: '#b9a276', bati: '#b8a684', toit: ['#a94a2f', '#b85a3a', '#9a4229'], ardoise: ['#565d6c', '#4c5262'], neige: 0,
  },
  hiver: {
    pre: ['#e9edf0', '#e3e8ec', '#eef1f3', '#dfe5ea'], herbeSec: '#dfe5ea', champ: [['#e4e8ec', '#d3d9de'], ['#e8ebee', '#d8dde1'], ['#dde2e7', '#cdd3d9'], ['#e6eaee', '#d6dce1']],
    vigneSol: '#e3e7eb', vigneRang: '#5a4a3c', lande: '#dde2e2', landeFleurs: ['#8a8f86', '#a3a79c', '#7c8476'], sousBois: '#c9d0d0',
    arbres: ['#7d6d5e', '#8c7b6a', '#6e6052'], arbreHi: 'rgba(250,252,255,0.8)', pins: ['#2c4a3a', '#36543f'], marais: '#c5d0d2', sable: '#e8e6dc',
    roche: '#c9ccce', rocheSombre: '#8d9194', eau: '#6f8ea9', eauBord: '#4c6a84', eauHi: 'rgba(230,240,250,0.7)', route: '#d9d6cd', routeBord: '#9a958a',
    chemin: '#dedbd2', bati: '#d8d8d4', toit: ['#e9ecef', '#dfe3e6', '#f0f2f4'], ardoise: ['#d5dade', '#cdd2d6'], neige: 1,
  },
};

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
  // q : profil de qualité graphique (qualite.js) : niveau de tuiles le plus fin, nombre de tuiles gardées ;
  // flat : peinture pour la 3D (sans l'ombrage du relief ni les courbes de niveau : la lumière de la scène les remplace)
  constructor(m, q, { flat = false } = {}) {
    this.flat = flat;
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
    this.cache = new Map();      // motifs et silhouettes d'arbres (textures.js), bornés en mémoire par la qualité
    this.cacheBytes = 0;
    this.ombre = softShadow();
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
  // altitude adoucie (m) en (x, y) : interpolée entre les points tous les 5 m (prepShade)
  fineAt(x, y) {
    const st = this.fineStep, W = this.fineW, H = this.fineH;
    const fx = clamp(x / st - 0.5, 0, W - 1.001), fy = clamp(y / st - 0.5, 0, H - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, f = this.fine, k = j * W + i;
    return (f[k] * (1 - u) + f[k + 1] * u) * (1 - v) + (f[k + W] * (1 - u) + f[k + W + 1] * u) * v;
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
    const snow = this.pal.neige;
    for (const [id, reg] of this.regions.entries()) {
      reg.path = this.regionPath(id, jitterOf(reg.type), reg.box);
      const c = reg.cells[0], i = c % cols, j = (c / cols) | 0;
      // orientation des sillons : le long de la lanière quand la parcelle est allongée (axe principal des cases),
      // sinon un champ de direction lent, la moitié des parcelles tournées d'un quart
      let mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
      for (const q of reg.cells) { mx += q % cols; my += (q / cols) | 0; }
      mx /= reg.cells.length; my /= reg.cells.length;
      for (const q of reg.cells) { const dx = q % cols - mx, dy = ((q / cols) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const tr = sxx + syy, l1 = tr / 2 + Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy), l2 = tr - l1;
      const base = vnoise(i / 40, j / 40, S + 9) * Math.PI * 2;
      reg.angle = reg.cells.length > 3 && (l1 - l2) > 0.45 * tr ? 0.5 * Math.atan2(2 * sxy, sxx - syy) + (hash(reg.parcel, 4, S) - 0.5) * 0.08
        : base + (hash(reg.parcel, 3, S) < 0.4 ? Math.PI / 2 : 0) + (hash(reg.parcel, 4, S) - 0.5) * 0.5;
      reg.tone = (hash(reg.parcel, 5, S) * 4) | 0;
      // motif du sol : culture de la saison pour les champs, pré ou prairie de fauche, etc.
      const v = reg.type;
      reg.tex = v === T.CHAMP ? culture(this.season, hash(reg.parcel, 6, S))
        : v === T.PRE ? (snow ? 'neige' : hash(reg.parcel, 7, S) < 0.22 ? 'prairie' : 'herbe')
        : v === T.VIGNE ? 'vigne' : v === T.LANDE ? 'lande' : v === T.MARAIS ? 'marais' : v === T.SABLE ? 'sable' : v === T.ROCHE ? 'roche'
        : v === T.BOIS || v === T.FORET ? 'sousBois' : v === T.ROUTE || v === T.CHEMIN ? (snow ? 'neige' : 'herbe')
        : v === T.BARRICADE ? 'terre' : v === T.EAU || v === T.GUE ? 'eau' : 'cour';
      // décalage du motif d'une parcelle à l'autre : la répétition ne s'aligne pas
      reg.off = [hash(id, 8, S) * 97, hash(id, 9, S) * 97];
    }
    this.byId = this.regions.slice();   // région d'après son numéro (label), avant le tri
    // motifs dont cette carte se sert (préparés d'avance dans le temps libre : warm)
    this.kinds = [...new Set([snow ? 'neige' : 'herbe', 'terre', 'route', 'eau', ...this.regions.map(r => r.tex)])];
    // ordre de peinture : les sols d'abord, l'eau et le bâti ensuite
    const ORDER = [T.PRE, T.LANDE, T.SABLE, T.ROCHE, T.CHAMP, T.VIGNE, T.MARAIS, T.BOIS, T.FORET, T.ROUTE, T.CHEMIN, T.BATI, T.MUR, T.BRECHE, T.PORTE, T.BARRICADE, T.GUE, T.EAU];
    this.regions.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    this.prepTrees();
    this.prepShade();
    this.prepNuances();
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
  // arbres : futaie serrée en forêt, touffes dans les bois avec des clairières, buissons de lisière, arbres isolés
  // dans les prés, le long des haies et au bord de l'eau ; meules dans les chaumes.
  // kind : 'feuillu' | 'sapin' | 'parasol' | 'nu' (feuillu en hiver) | 'buisson' | 'peuplier' | 'meule'
  prepTrees() {
    const { cols, rows, cell, t } = this, S = this.seed, snow = this.pal.neige;
    this.treeGrid = new Array(cols * rows);
    const montagne = this.h.reduce((a, b) => Math.max(a, b), 0) > 55;
    const wood = v => v === T.BOIS || v === T.FORET;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const c = j * cols + i, v = t[c], list = [];
      const h = k => hash(i, j, S + k);
      let n = 0, r0 = 4, r1 = 7;
      if (v === T.FORET) { n = 7; r0 = 5; r1 = 8.5; }
      else if (v === T.BOIS) { n = 5; r0 = 4.5; r1 = 7.5; }
      else if ((v === T.PRE || v === T.CHAMP) && h(1) < 0.025) n = 1;
      else if (v === T.LANDE && h(2) < 0.12) { n = 1; r0 = 3; r1 = 5; }
      for (let k = 0; k < n; k++) {
        if (v === T.BOIS && h(10 + k) < 0.18) continue;   // clairières
        // dans les bois, le pied un peu plus au sud : la couronne, peinte au-dessus du pied, couvre alors la case
        const r = r0 + h(22 + k * 3) * (r1 - r0);
        const x = (i + 0.08 + h(20 + k * 3) * 0.84) * cell, y = (j + 0.08 + h(21 + k * 3) * 0.84) * cell + (wood(v) ? r * 0.7 : 0);
        // pins dans les landes et en montagne ; feuillus ailleurs (en hiver, ils sont nus)
        const kind = v === T.LANDE || (wood(v) && this.landesLike() && h(40 + k) < 0.85) ? 'parasol'
          : wood(v) && montagne && this.h[c] > 30 && h(40 + k) < 0.8 ? 'sapin' : snow ? 'nu' : 'feuillu';
        list.push({ x, y, r, ci: (h(30 + k) * 4) | 0, kind });
      }
      // lisière : buissons et jeunes arbres au bord du bois, du côté des champs
      if (wood(v)) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        const w = t[jj * cols + ii];
        if (wood(w) || w === T.EAU || w === T.GUE || w === T.ROUTE || w === T.BATI || w === T.MUR) continue;
        for (let k = 0; k < 2; k++) {
          const q = 50 + (di + 1) * 7 + (dj + 1) * 3 + k * 23;
          if (h(q) > 0.75) continue;
          const x = (i + 0.5 + di * 0.5 + (dj ? (h(q + 1) - 0.5) * 0.9 : 0)) * cell, y = (j + 0.5 + dj * 0.5 + (di ? (h(q + 2) - 0.5) * 0.9 : 0)) * cell;
          list.push({ x, y, r: 1.8 + h(q + 3) * 1.8, ci: (h(q + 4) * 4) | 0, kind: snow && h(q + 5) < 0.6 ? 'nu' : 'buisson' });
        }
      }
      // meules dans les chaumes, l'été et l'automne
      if (v === T.CHAMP && this.byId[this.label[c]]?.tex === 'chaume' && h(70) < 0.07)
        list.push({ x: (i + 0.2 + h(71) * 0.6) * cell, y: (j + 0.2 + h(72) * 0.6) * cell, r: 1.6 + h(73) * 0.6, kind: 'meule' });
      this.treeGrid[c] = list;
    }
    // haies : quelques arbres de haut jet ; bords des ruisseaux : peupliers
    for (const f of this.fences) if (f.kind === 'haie') for (const [k, p] of resample(f.pts, 9).entries()) {
      if (hash(p[0] | 0, p[1] | 0, S + 80) > 0.25) continue;
      this.addTree({ x: p[0], y: p[1], r: 3.2 + hash(k, 81, S) * 2.2, ci: (hash(k, 82, S) * 4) | 0, kind: snow ? 'nu' : 'feuillu' });
    }
    for (const rv of this.rivers) if ((rv.w || 12) < 60) for (const side of [-1, 1]) for (const [k, p] of resample(offsetPts(rv.pts, side * ((rv.w || 12) / 2 + 6)), 13).entries()) {
      if (hash(k, side + 90, S) > 0.3) continue;
      const v = this.at(p[0], p[1]);
      if (v !== T.PRE && v !== T.MARAIS && v !== T.CHAMP && v !== T.LANDE) continue;
      this.addTree({ x: p[0], y: p[1], r: 2.4 + hash(k, 91, S) * 1.2, ci: (hash(k, 92, S) * 4) | 0, kind: snow ? 'nu' : 'peuplier' });
    }
  }
  addTree(tr) {
    const i = Math.floor(tr.x / this.cell), j = Math.floor(tr.y / this.cell);
    if (i >= 0 && j >= 0 && i < this.cols && j < this.rows) this.treeGrid[j * this.cols + i].push(tr);
  }
  landesLike() {
    if (this._landes === undefined) {
      let l = 0, s = 0; for (const v of this.t) { if (v === T.LANDE) l++; if (v === T.SABLE) s++; }
      this._landes = (l + s) > this.t.length * 0.15;
    }
    return this._landes;
  }
  // ombrage du relief (lumière du nord-ouest, comme les ombres portées) : altitudes affinées à 5 m par
  // interpolation cubique, puis deux images douces, ombres et lumières, posées sur le sol
  prepShade() {
    const { cols, rows, cell, h } = this, F = 4, W = cols * F, H = rows * F;
    let hmin = 255, hmax = 0;
    for (const v of h) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
    this.hmin = hmin; this.hmax = hmax;
    // Catmull-Rom le long des lignes de la grille, puis des colonnes
    const cr = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    const hc = (i, j) => h[clamp(j, 0, rows - 1) * cols + clamp(i, 0, cols - 1)];
    const tmp = new Float32Array(W * rows), fine = new Float32Array(W * H);
    for (let j = 0; j < rows; j++) for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / F - 0.5, i = Math.floor(fx);
      tmp[j * W + x] = cr(hc(i - 1, j), hc(i, j), hc(i + 1, j), hc(i + 2, j), fx - i);
    }
    const tc = (x, j) => tmp[clamp(j, 0, rows - 1) * W + x];
    for (let y = 0; y < H; y++) {
      const fy = (y + 0.5) / F - 0.5, j = Math.floor(fy);
      for (let x = 0; x < W; x++) fine[y * W + x] = cr(tc(x, j - 1), tc(x, j), tc(x, j + 1), tc(x, j + 2), fy - j);
    }
    // les altitudes arrivent en mètres entiers : un flou (≈ 15 m) efface les marches qui strieraient l'ombrage
    for (let pass = 0; pass < 2; pass++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const src = fine.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let a = 0;
        for (let q = -2; q <= 2; q++) a += src[clamp(y + dy * q, 0, H - 1) * W + clamp(x + dx * q, 0, W - 1)];
        fine[y * W + x] = a / 5;
      }
    }
    // altitudes adoucies (une valeur tous les 5 m) : le relief de la vue 3D et la hauteur des troupes
    this.fine = fine; this.fineW = W; this.fineH = H; this.fineStep = cell / F;
    if (this.flat) return;
    const dark = canvas(W, H), lite = canvas(W, H);
    const gd = dark.getContext('2d'), gl = lite.getContext('2d');
    const id = gd.createImageData(W, H), il = gl.createImageData(W, H);
    const lx = -0.6, ly = -0.65, lz = 0.65, d0 = 2 * cell / F, snow = this.pal.neige;
    const ex = hmax - hmin > 40 ? 1.5 : 2.2;   // exagération du relief : quelques mètres doivent se lire
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const f = (a, b) => fine[clamp(b, 0, H - 1) * W + clamp(a, 0, W - 1)];
      const dx = (f(x + 1, y) - f(x - 1, y)) / d0 * ex, dy = (f(x, y + 1) - f(x, y - 1)) / d0 * ex;
      const nl = Math.hypot(dx, dy, 1), d = (-dx * lx - dy * ly + lz) / nl - lz;
      const k = (y * W + x) * 4;
      id.data[k] = 24; id.data[k + 1] = 32; id.data[k + 2] = 50; id.data[k + 3] = clamp(-d * (snow ? 280 : 380), 0, snow ? 105 : 150);
      il.data[k] = 255; il.data[k + 1] = 244; il.data[k + 2] = 212; il.data[k + 3] = clamp(d * 260, 0, 85);
    }
    gd.putImageData(id, 0, 0); gl.putImageData(il, 0, 0);
    this.shadeDark = dark; this.shadeLite = lite;
  }
  // nuances d'ensemble (une image à 10 m par pixel, adoucie à l'affichage) : herbe plus grasse dans les creux, plus
  // sèche sur les hauteurs, grandes taches qui cassent la répétition des motifs
  prepNuances() {
    const { cols, rows, t, h } = this, F = 2, W = cols * F, H = rows * F, S = this.seed, snow = this.pal.neige;
    const cv = canvas(W, H), g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    const range = Math.max(1, this.hmax - this.hmin);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = ((y / F) | 0) * cols + ((x / F) | 0), v = t[c];
      const k = v === T.PRE || v === T.LANDE ? 1 : v === T.CHAMP || v === T.VIGNE || v === T.MARAIS ? 0.45 : 0;
      if (!k) continue;
      const e = (vnoise(x / 9, y / 9, S + 50) - 0.5) * 1.3 + (vnoise(x / 2.5, y / 2.5, S + 51) - 0.5) * 0.5 + (0.5 - (h[c] - this.hmin) / range) * 0.4;
      const q = (y * W + x) * 4, col = snow ? [186, 200, 222] : e > 0 ? [52, 86, 26] : [214, 196, 110];
      d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2];
      d[q + 3] = 255 * k * (snow ? Math.min(0.2, Math.abs(e) * 0.25) : e > 0 ? Math.min(0.3, e * 0.42) : Math.min(0.28, -e * 0.4));
    }
    g.putImageData(img, 0, 0);
    this.nuances = cv;
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
  // motifs et silhouettes d'arbres (textures.js), gardés tant que la mémoire le permet ; on ne libère qu'après une
  // peinture (trim) : jamais un canevas en cours d'usage
  cached(key, make) {
    let e = this.cache.get(key);
    if (e) { this.cache.delete(key); this.cache.set(key, e); return e; }
    e = make();
    const cv = e.cv || e;
    this.cacheBytes += cv.width * cv.height * 4;
    this.cache.set(key, e);
    return e;
  }
  trim() {
    for (const [k, e] of this.cache) {
      if (this.cacheBytes <= this.q.textures) break;
      const cv = e.cv || e;
      this.cacheBytes -= cv.width * cv.height * 4;
      cv.width = cv.height = 0;   // Safari garde sinon la mémoire
      this.cache.delete(k);
    }
  }
  // motif d'un sol, peint à la densité de la tuile (s px/m), tourné de rot (radians) et décalé de off (m)
  pat(g, kind, s, rot = 0, off = null) {
    const p = g.createPattern(this.cached(`t|${kind}|${s}`, () => texture(kind, s, this.pal, this.season)), 'repeat');
    const m = new DOMMatrix();
    if (rot) m.rotateSelf(rot * 180 / Math.PI);
    if (off) m.translateSelf(off[0], off[1]);
    p.setTransform(m.scaleSelf(1 / s, 1 / s));
    return p;
  }
  paintCanvas(x0, y0, wm, hm, s) {
    const cv = canvas(wm * s, hm * s), g = cv.getContext('2d');
    this.paint(g, x0, y0, wm, hm, s);
    this.trim();
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
    // l'herbe partout d'abord (sous les routes, entre les parcelles) : les prés n'ont plus qu'une légère nuance
    g.fillStyle = this.pat(g, snow ? 'neige' : 'herbe', s);
    g.fillRect(x0 - 50, y0 - 50, wm + 100, hm + 100);
    // sols : motif de la nature du sol (culture de la saison, prairie de fauche…), nuance de la parcelle, tournière
    // d'herbe autour des champs et des vignes
    for (const r of this.regions) {
      if (!vis(r.box)) continue;
      const v = r.type, crop = v === T.CHAMP || v === T.VIGNE || r.tex === 'prairie';
      if (v === T.EAU || v === T.GUE || v === T.ROUTE || v === T.CHEMIN) continue;   // l'eau plus bas ; les routes sur l'herbe
      if (r.tex !== 'herbe' && r.tex !== 'neige') { g.fillStyle = this.pat(g, r.tex, s, crop ? r.angle : 0, r.off); g.fill(r.path); }
      if (v === T.PRE) { g.globalAlpha = 0.08; g.fillStyle = pal.pre[r.tone]; g.fill(r.path); g.globalAlpha = 1; }
      else if (v === T.CHAMP) { g.globalAlpha = 0.04 + (r.tone >> 1) * 0.04; g.fillStyle = r.tone & 1 ? '#fff8dc' : '#281e0a'; g.fill(r.path); g.globalAlpha = 1; }
      if (crop && s >= 0.9) {
        g.strokeStyle = mixHex(pal.pre[1], pal.herbeSec, 0.3); g.globalAlpha = 0.75; g.lineWidth = v === T.VIGNE ? 1.1 : 1.6; g.stroke(r.path);
        g.globalAlpha = 1;
        if (s < 2) { g.strokeStyle = 'rgba(70,56,30,0.2)'; g.lineWidth = 0.8 / s; g.stroke(r.path); }
      }
    }
    mark('sols');
    // grandes nuances (herbe grasse ou sèche), puis les rochers
    g.drawImage(this.nuances, 0, 0, this.W, this.H);
    this.paintCells(g, x0, y0, wm, hm, s, snow);
    mark('cases');
    // eau : berges de terre humide, eau claire sur les bords et plus sombre au milieu, ombre de la rive, reflets
    const bank = snow ? 'rgba(150,150,140,0.7)' : 'rgba(104,94,58,0.6)', shallow = snow ? '#9fb4c4' : mixHex(pal.eau, '#9db58a', 0.45);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of this.regions) { if ((r.type !== T.EAU && r.type !== T.GUE) || !vis(r.box)) continue; g.strokeStyle = bank; g.lineWidth = 4; g.stroke(r.path); }
    // (les cases d'eau débordent du lit jusqu'à ≈ 12 m : berges et bords clairs les recouvrent)
    for (const rv of this.riverPts) { g.strokeStyle = bank; g.lineWidth = rv.w + 26; strokePts(g, rv.pts); }
    const eau = this.pat(g, 'eau', s);
    for (const r of this.regions) {
      if ((r.type !== T.EAU && r.type !== T.GUE) || !vis(r.box)) continue;
      g.fillStyle = eau; g.fill(r.path);
      g.save(); g.clip(r.path);
      const gue = r.type === T.GUE;
      g.strokeStyle = gue ? mixHex(pal.eau, pal.sable, 0.5) : shallow; g.globalAlpha = gue ? 0.8 : 0.55; g.lineWidth = gue ? 30 : 7; g.stroke(r.path);
      g.globalAlpha = 0.3; g.strokeStyle = '#1c3040'; g.lineWidth = 2.4; g.translate(-0.9, -0.9); g.stroke(r.path);
      g.restore();
    }
    for (const rv of this.riverPts) {
      g.strokeStyle = shallow; g.lineWidth = rv.w + 20; strokePts(g, rv.pts);
      g.strokeStyle = eau; g.globalAlpha = 0.55; g.lineWidth = rv.w + 12; strokePts(g, rv.pts); g.globalAlpha = 1;
      g.strokeStyle = eau; g.lineWidth = rv.w * 0.85 + 4; strokePts(g, rv.pts);
      g.strokeStyle = 'rgba(16,40,72,0.16)'; g.lineWidth = rv.w * 0.42; strokePts(g, rv.pts);
    }
    if (s >= 0.9) {
      // reflets : un liseré clair le long de la rive éclairée, quelques rides au milieu
      for (const rv of this.riverPts) {
        g.strokeStyle = pal.eauHi; g.lineWidth = Math.max(0.8, rv.w * 0.06);
        strokePts(g, offsetPts(rv.pts, -rv.w * 0.36));
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(0.6, rv.w * 0.04);
        g.setLineDash([3, 9, 6, 17]); strokePts(g, offsetPts(rv.pts, rv.w * 0.08));
      }
      g.setLineDash([]);
      // gués : pierres dans l'eau claire
      for (const r of this.regions) {
        if (r.type !== T.GUE || !vis(r.box)) continue;
        for (const c of r.cells) for (let k = 0; k < 6; k++) {
          const x = (c % this.cols + hash(c, k, 3)) * this.cell, y = (((c / this.cols) | 0) + hash(c, k, 4)) * this.cell, rr = 0.8 + hash(c, k, 5) * 1.2;
          g.fillStyle = 'rgba(40,50,50,0.3)'; g.beginPath(); g.arc(x + 0.4, y + 0.3, rr, 0, TAU); g.fill();
          g.fillStyle = 'rgba(150,140,118,0.85)'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        }
      }
    }
    mark('eau');
    // chemins de terre : bas-côtés foulés, ornières, herbe au milieu ; routes : chaussée de terre battue et de gravier
    g.lineCap = 'round'; g.lineJoin = 'round';
    const verge = snow ? 'rgba(150,150,150,0.25)' : 'rgba(110,98,48,0.24)', terre = this.pat(g, 'terre', s), route = this.pat(g, 'route', s);
    for (const p of this.pathPts) { g.strokeStyle = verge; g.lineWidth = 6.5; strokePts(g, p); }
    for (const r of this.roadPts) { g.strokeStyle = verge; g.lineWidth = 13; strokePts(g, r); }
    for (const p of this.pathPts) { g.strokeStyle = 'rgba(90,70,40,0.3)'; g.lineWidth = 4.2; strokePts(g, p); }
    for (const p of this.pathPts) { g.strokeStyle = terre; g.lineWidth = 3.6; strokePts(g, p); }
    for (const r of this.roadPts) { g.strokeStyle = pal.routeBord; g.lineWidth = 9.4; strokePts(g, r); }
    for (const r of this.roadPts) { g.strokeStyle = route; g.lineWidth = 8.4; strokePts(g, r); }
    if (s >= 1.5) {
      g.strokeStyle = snow ? 'rgba(110,100,90,0.4)' : 'rgba(104,80,48,0.34)'; g.lineWidth = 0.5;
      for (const r of this.roadPts) { strokePts(g, offsetPts(r, -1.5)); strokePts(g, offsetPts(r, 1.5)); }
      for (const p of this.pathPts) { strokePts(g, offsetPts(p, -0.8)); strokePts(g, offsetPts(p, 0.8)); }
      g.strokeStyle = snow ? 'rgba(250,252,255,0.6)' : 'rgba(118,140,64,0.55)'; g.lineWidth = 0.45;
      for (const p of this.pathPts) strokePts(g, p);
      g.strokeStyle = 'rgba(255,250,232,0.14)'; g.lineWidth = 1.3;
      for (const r of this.roadPts) strokePts(g, r);
    }
    // ponts : ombre sur l'eau, tablier, parapets
    for (const b of this.bridges) {
      g.save(); g.translate(b.x + OMBRE[0] * 3, b.y + OMBRE[1] * 3); g.rotate(b.a);
      g.fillStyle = 'rgba(10,20,30,0.35)'; g.fillRect(-b.len / 2, -5, b.len, 10);
      g.restore();
      g.save(); g.translate(b.x, b.y); g.rotate(b.a);
      g.fillStyle = snow ? '#d9d9d6' : '#cdbf9e'; g.fillRect(-b.len / 2, -5, b.len, 10);
      g.fillStyle = '#9c8b6a'; g.fillRect(-b.len / 2, -5, b.len, 1.4); g.fillRect(-b.len / 2, 3.6, b.len, 1.4);
      g.fillStyle = 'rgba(255,250,230,0.5)'; g.fillRect(-b.len / 2, -5, b.len, 0.5);
      g.restore();
    }
    mark('routes');
    // relief : ombres et lumières douces ; de loin seulement, de légères courbes de niveau (en 3D : la lumière de la scène)
    if (!this.flat) {
      g.save();
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.shadeDark, 0, 0, this.W, this.H);
      g.drawImage(this.shadeLite, 0, 0, this.W, this.H);
      g.restore();
      if (s <= 1) {
        g.strokeStyle = snow ? 'rgba(90,100,120,0.14)' : 'rgba(110,78,40,0.12)'; g.lineWidth = Math.max(0.6, 0.9 / s);
        g.stroke(this.contours[0]);
        g.strokeStyle = snow ? 'rgba(90,100,120,0.24)' : 'rgba(110,78,40,0.22)'; g.lineWidth = Math.max(1, 1.5 / s);
        g.stroke(this.contours[1]);
      }
    }
    mark('relief');
    // décalcomanies : tués, trous d'obus (seulement sur le sol découvert : bare), sous tout ce qui est debout
    for (const d of this.decals) if (d.x > x0 - 10 && d.x < x0 + wm + 10 && d.y > y0 - 10 && d.y < y0 + hm + 10) paintDecal(g, d, s);
    // murs et remparts, haies et clôtures, puis arbres et maisons en volume
    this.paintWalls(g, s);
    this.paintFences(g, s);
    this.paintStanding(g, x0, y0, wm, hm, s);
    mark('debout');
  }
  // Le sol est-il découvert en (x, y) ? Ni bois, ni eau, ni bâti, ni sous la cime d'un arbre ou le toit d'une maison
  // tels qu'ils sont peints (vue cavalière : un arbre couvre le sol de son pied jusqu'à quelques rayons au nord).
  // Les tués et les trous d'obus ajoutés pendant la bataille sont peints par-dessus les tuiles déjà faites : hors
  // du sol découvert, ils marqueraient les cimes et les toits.
  bare(x, y) {
    const v = this.at(x, y);
    if (v === T.BOIS || v === T.FORET || v === T.EAU || v === T.GUE || v === T.BATI || v === T.MUR || v === T.PORTE) return false;
    const { cols, rows, cell } = this, i0 = Math.floor(x / cell), j0 = Math.floor(y / cell);
    // hauteur (en rayons) et demi-largeur de l'image de chaque sorte d'arbre
    const TOP = { sapin: 3.8, parasol: 3.4, peuplier: 5.2, buisson: 1.7, meule: 2.1 }, HALF = { peuplier: 0.8, parasol: 1.15 };
    for (let j = j0 - 1; j <= j0 + 2; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      for (const tr of this.treeGrid[j * cols + i]) {
        if (Math.abs(x - tr.x) < tr.r * (HALF[tr.kind] ?? 1.3) && y < tr.y + tr.r * 0.5 && y > tr.y - tr.r * (TOP[tr.kind] ?? 2.4)) return false;
      }
    }
    for (const b of this.buildings) {
      const m = Math.hypot(b.w, b.h) / 2 + 1, top = this.bHeight(b) + (b.kind === 'eglise' ? 40 : Math.min(b.w, b.h) * 0.7 / TILT);
      if (Math.abs(x - b.x) < m && y < b.y + m && y > b.y - m - top) return false;
    }
    return true;
  }
  // rochers : blocs éclairés au nord-ouest, leur ombre au sud-est
  paintCells(g, x0, y0, wm, hm, s, snow) {
    const { cols, rows, cell, t } = this, S = this.seed;
    const i0 = Math.max(0, Math.floor(x0 / cell) - 1), i1 = Math.min(cols - 1, Math.ceil((x0 + wm) / cell) + 1);
    const j0 = Math.max(0, Math.floor(y0 / cell) - 1), j1 = Math.min(rows - 1, Math.ceil((y0 + hm) / cell) + 1);
    const rocks = new Path2D(), rocksD = new Path2D(), rocksL = new Path2D();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * cols + i, h = k => hash(i, j, S + k);
      if (t[c] !== T.ROCHE || h(1) >= 0.7) continue;
      const x = (i + h(2)) * cell, y = (j + h(3)) * cell, r = 3 + h(4) * 6, a = h(5) * TAU;
      rocks.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      for (let k = 1; k < 6; k++) { const aa = a + k / 6 * TAU, rr = r * (0.7 + h(6 + k) * 0.4); rocks.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr); }
      rocks.closePath();
      rocksD.moveTo(x, y); rocksD.lineTo(x + r * 0.9, y + r * 0.2); rocksD.lineTo(x + r * 0.3, y + r * 0.9); rocksD.closePath();
      rocksL.moveTo(x, y); rocksL.lineTo(x - r * 0.75, y - r * 0.2); rocksL.lineTo(x - r * 0.2, y - r * 0.7); rocksL.closePath();
    }
    g.fillStyle = 'rgba(40,36,30,0.3)'; g.save(); g.translate(OMBRE[0] * 3, OMBRE[1] * 3); g.fill(rocks); g.restore();
    g.fillStyle = mixHex(this.pal.roche, '#ffffff', snow ? 0.6 : 0.15); g.fill(rocks);
    g.fillStyle = 'rgba(60,56,48,0.38)'; g.fill(rocksD);
    g.fillStyle = 'rgba(255,252,240,0.3)'; g.fill(rocksL);
  }
  // hauteur (m) d'un arbre, pour son ombre
  treeHeight(tr) { const k = tr.kind; return tr.r * (k === 'sapin' ? 3.2 : k === 'parasol' ? 2.6 : k === 'peuplier' ? 5 : k === 'buisson' || k === 'meule' ? 1.2 : 2.2); }
  // Objets debout (arbres, meules, maisons, église, moulin) en vue cavalière : l'ombre au sol d'abord (au sud-est),
  // puis les volumes du fond vers le devant. Le sol est écrasé à l'affichage (TILT) : les hauteurs sont peintes
  // divisées par TILT.
  paintStanding(g, x0, y0, wm, hm, s) {
    const { cols, rows, cell } = this, pal = this.pal, snow = pal.neige;
    const i0 = Math.max(0, Math.floor(x0 / cell) - 1), i1 = Math.min(cols - 1, Math.ceil((x0 + wm) / cell) + 1);
    const j0 = Math.max(0, Math.floor(y0 / cell) - 1), j1 = Math.min(rows - 1, Math.ceil((y0 + hm + 30) / cell) + 1);
    const items = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const tr of this.treeGrid[j * cols + i]) items.push(tr);
    const blds = this.buildings.filter(b => !(b.x < x0 - 60 || b.x > x0 + wm + 60 || b.y < y0 - 60 || b.y > y0 + hm + 90));
    if (s < 0.8) {
      // petite échelle (image entière) : ombres et couronnes groupées par couleur, sans tri, par paquets (un seul
      // chemin de milliers d'ellipses qui se chevauchent est très lent à remplir)
      for (let q0 = 0; q0 < items.length; q0 += 300) {
        const sh = new Path2D();
        for (const tr of items.slice(q0, q0 + 300)) {
          const hh = this.treeHeight(tr) * 0.6, cx = tr.x + OMBRE[0] * hh, cy = tr.y + OMBRE[1] * hh;
          sh.moveTo(cx + tr.r, cy); sh.ellipse(cx, cy, tr.r, tr.r * 0.75, 0, 0, TAU);
        }
        g.fillStyle = snow ? 'rgba(50,60,90,0.24)' : 'rgba(22,36,14,0.3)'; g.fill(sh);
      }
      for (const b of blds) this.buildingShadow(g, b);
      for (let q0 = 0; q0 < items.length; q0 += 300) {
        const crowns = pal.arbres.map(() => new Path2D()), pines = new Path2D(), hi = new Path2D();
        for (const tr of items.slice(q0, q0 + 300)) {
          if (tr.kind === 'meule') continue;
          const r = tr.r, y = tr.y - r * 1.0 / TILT;
          const p = tr.kind === 'sapin' || tr.kind === 'parasol' ? pines : crowns[tr.ci % crowns.length];
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
    // ombres douces des arbres, allongées vers le sud-est selon leur hauteur
    g.globalAlpha = snow ? 0.24 : 0.34;
    for (const tr of items) {
      const hh = this.treeHeight(tr) * 0.6, rx = tr.r * 1.15, ry = tr.r * 0.85;
      g.drawImage(this.ombre, tr.x + OMBRE[0] * hh - rx, tr.y + OMBRE[1] * hh - ry, rx * 2, ry * 2);
    }
    g.globalAlpha = 1;
    for (const b of blds) this.buildingShadow(g, b);
    const all = items.map(t => ({ y: t.y, t })).concat(blds.map(b => ({ y: b.y + Math.max(b.w, b.h) * 0.3, b })));
    all.sort((a, b) => a.y - b.y);
    for (const it of all) if (it.t) this.tree(g, it.t, s); else this.building(g, it.b, s);
  }
  // un arbre : son tronc, puis sa couronne (silhouette éclairée de textures.js, à la taille de la tuile)
  tree(g, tr, s) {
    const pal = this.pal, snow = pal.neige, { x, y, r, kind } = tr, k = 1 / TILT;
    if (kind === 'meule') { this.meule(g, tr); return; }
    const px = Math.max(3, Math.round(8 * s)), variant = tr.ci % 3;
    const col = kind === 'sapin' ? pal.pins[1] : kind === 'parasol' ? pal.pins[tr.ci % 2] : kind === 'nu' ? '#7d6d5e' : pal.arbres[tr.ci % pal.arbres.length];
    const sp = this.cached(`a|${kind}|${col}|${variant}|${px}`, () => treeSprite(kind, col, variant, px, snow));
    const m = r / px;   // mètres par pixel de la silhouette
    if (kind === 'sapin') { g.drawImage(sp.cv, x - sp.cx * m, y - sp.cy * m, sp.cv.width * m, sp.cv.height * m); return; }
    const th = (kind === 'parasol' ? r * 2.0 : kind === 'buisson' ? 0 : kind === 'peuplier' ? r * 0.6 : r * 0.38) * k;
    if (th) { const tw = r * (kind === 'parasol' ? 0.16 : 0.2); g.fillStyle = snow ? '#4a3c30' : '#5a4430'; g.fillRect(x - tw / 2, y - th - r * 0.3, tw, th + r * 0.3); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y - th - r * 0.3, tw / 2, th + r * 0.3); }
    const cy = y - th - r * (kind === 'buisson' ? 0.45 : kind === 'parasol' ? 0.15 : kind === 'peuplier' ? 1.9 : 0.62);
    g.drawImage(sp.cv, x - sp.cx * m, cy - sp.cy * m, sp.cv.width * m, sp.cv.height * m);
  }
  // meule de foin : un dôme de paille, clair au nord-ouest
  meule(g, { x, y, r }) {
    const snow = this.pal.neige, top = y - r * 1.5 / TILT;
    g.fillStyle = snow ? '#e4e7ea' : '#c8a659';
    g.beginPath(); g.moveTo(x - r, y); g.bezierCurveTo(x - r, top, x + r, top, x + r, y); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI); g.fill();
    g.fillStyle = snow ? 'rgba(150,160,180,0.35)' : 'rgba(110,80,30,0.35)';
    g.beginPath(); g.moveTo(x + r * 0.1, (y + top) / 2 - r * 0.2); g.bezierCurveTo(x + r * 0.7, top + r * 0.3, x + r, y - r * 0.4, x + r, y); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI / 2); g.closePath(); g.fill();
    g.fillStyle = snow ? 'rgba(255,255,255,0.7)' : 'rgba(255,238,180,0.55)';
    g.beginPath(); g.ellipse(x - r * 0.3, (y + top) / 2 - r * 0.3, r * 0.35, r * 0.5, -0.3, 0, TAU); g.fill();
  }
  // emprise d'un bâtiment : coins au sol, dans l'ordre
  corners(b) {
    const ca = Math.cos(b.a || 0), sa = Math.sin(b.a || 0), w = b.w / 2, h = b.h / 2;
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [b.x + u * ca - v * sa, b.y + u * sa + v * ca]);
  }
  bHeight(b) { return (b.kind === 'eglise' ? 10 : b.kind === 'moulin' ? 9 : b.kind === 'ferme' ? 5.5 : 5) / TILT; }
  buildingShadow(g, b) {
    const H = this.bHeight(b) * TILT * 1.3, dx = H * OMBRE[0], dy = H * OMBRE[1];   // le toit allonge l'ombre
    g.fillStyle = 'rgba(25,20,30,0.32)';
    if (b.kind === 'moulin') {
      const r = Math.max(b.w, b.h) / 2;
      g.beginPath(); g.ellipse(b.x + dx * 0.6, b.y + dy * 0.6, r * 1.4, r, 0.5, 0, TAU); g.fill(); return;
    }
    const c = this.corners(b);
    // enveloppe de l'emprise et de l'emprise décalée (assez juste pour une ombre)
    const hull = convexHull(c.concat(c.map(p => [p[0] + dx, p[1] + dy])));
    g.beginPath(); g.moveTo(hull[0][0], hull[0][1]); for (const p of hull.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill();
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
      g.fillStyle = mixHex(wall, '#000000', 0.18); g.fillRect(b.x - r, b.y - H, r * 2, H);
      g.fillStyle = wall; g.fillRect(b.x - r, b.y - H, r * 1.1, H);
      g.beginPath(); g.ellipse(b.x, b.y, r, r * 0.45, 0, 0, Math.PI); g.fill();
      g.fillStyle = roof; g.beginPath(); g.moveTo(b.x - r * 1.1, b.y - H); g.lineTo(b.x, b.y - H - r * 1.6); g.lineTo(b.x + r * 1.1, b.y - H); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(b.x, b.y - H - r * 1.6); g.lineTo(b.x + r * 1.1, b.y - H); g.lineTo(b.x + r * 0.1, b.y - H); g.closePath(); g.fill();
      g.save(); g.translate(b.x + r * 0.2, b.y - H - r * 0.2); g.rotate(b.a || 0.4);
      for (let q = 0; q < 4; q++) { g.rotate(Math.PI / 2); g.fillStyle = '#5a4630'; g.fillRect(-0.4, -r * 2.6, 0.8, r * 2.5); g.fillStyle = 'rgba(244,236,214,0.9)'; g.fillRect(0.4, -r * 2.5, r * 0.75, r * 1.9); }
      g.restore();
      return;
    }
    const c = this.corners(b);
    // murs tournés vers l'observateur (normale vers le bas de l'écran) ; éclairés s'ils regardent vers l'ouest
    const up = p => [p[0], p[1] - H];
    for (let q = 0; q < 4; q++) {
      const a = c[q], bb = c[(q + 1) % 4], nx = bb[1] - a[1], ny = -(bb[0] - a[0]);
      // la normale extérieure d'une arête parcourue dans le sens horaire est (dy, −dx)
      if (ny <= 0.01) continue;
      const lit = nx < 0;
      g.fillStyle = mixHex(wall, '#000000', lit ? 0.04 : 0.22);
      const A = up(a), B = up(bb);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(bb[0], bb[1]); g.lineTo(B[0], B[1]); g.lineTo(A[0], A[1]); g.closePath(); g.fill(); g.stroke();
      // soubassement plus sombre, porte et fenêtres sur les longs murs
      const L = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      if (s >= 2) { g.fillStyle = 'rgba(80,60,40,0.18)'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(bb[0], bb[1]); g.lineTo(bb[0], bb[1] - H * 0.12); g.lineTo(a[0], a[1] - H * 0.12); g.closePath(); g.fill(); }
      if (L > 8 && s >= 1.5) {
        for (let f = 0.22, n = 0; f < 0.9; f += 0.28, n++) {
          const fx = a[0] + (bb[0] - a[0]) * f, fy = a[1] + (bb[1] - a[1]) * f;
          const door = n === 1 && kind !== 'eglise' && L > 10;
          g.fillStyle = door ? '#5a4030' : '#34404c';
          if (door) g.fillRect(fx - 0.6, fy - H * 0.42, 1.2, H * 0.42);
          else g.fillRect(fx - 0.6, fy - H * 0.72, 1.2, H * 0.24);
          if (s >= 4 && !door) { g.fillStyle = snow ? '#9aa6ae' : '#5f7a68'; g.fillRect(fx - 1.1, fy - H * 0.72, 0.42, H * 0.24); g.fillRect(fx + 0.68, fy - H * 0.72, 0.42, H * 0.24); }
        }
      }
    }
    // toit à deux pans, faîtage dans la longueur : le pan tourné vers la lumière (nord-ouest) est clair
    const long = b.w >= b.h;
    const [p0, p1, p2, p3] = c.map(up);
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const rh = Math.min(b.w, b.h) * (montagne ? 0.55 : 0.4) / TILT;
    let r1, r2, planes;
    if (long) { r1 = mid(p0, p3); r2 = mid(p1, p2); planes = [[p0, p1], [p3, p2]]; }
    else { r1 = mid(p0, p1); r2 = mid(p3, p2); planes = [[p0, p3], [p1, p2]]; }
    const ridge0 = mid(r1, r2);
    r1 = [r1[0], r1[1] - rh]; r2 = [r2[0], r2[1] - rh];
    planes = planes.map(pl => [pl[0], pl[1], r2, r1]);
    // le pan dont le bord est le plus bas à l'écran est devant
    planes.sort((A, B) => (A[0][1] + A[1][1]) - (B[0][1] + B[1][1]));
    for (const pl of planes) {
      const e = mid(pl[0], pl[1]), nx = e[0] - ridge0[0], ny = e[1] - ridge0[1], lit = (-0.67 * nx - 0.74 * ny) > 0;
      g.fillStyle = snow ? (lit ? '#f6f8fa' : '#d6dde4') : mixHex(roof, lit ? '#fff4dc' : '#000000', lit ? 0.12 : 0.24);
      g.beginPath(); g.moveTo(pl[0][0], pl[0][1]); g.lineTo(pl[1][0], pl[1][1]); g.lineTo(pl[2][0], pl[2][1]); g.lineTo(pl[3][0], pl[3][1]); g.closePath(); g.fill(); g.stroke();
      if (s >= 4) {
        // tuiles : des rangs de l'égout au faîtage
        const n = Math.round(Math.hypot(pl[1][0] - pl[0][0], pl[1][1] - pl[0][1]) / 0.45);
        g.strokeStyle = snow ? 'rgba(160,170,180,0.35)' : 'rgba(60,24,14,0.28)'; g.lineWidth = 0.12; g.beginPath();
        for (let q = 1; q < n; q++) { const f = q / n; g.moveTo(pl[0][0] + (pl[1][0] - pl[0][0]) * f, pl[0][1] + (pl[1][1] - pl[0][1]) * f); g.lineTo(pl[3][0] + (pl[2][0] - pl[3][0]) * f, pl[3][1] + (pl[2][1] - pl[3][1]) * f); }
        g.stroke(); g.strokeStyle = 'rgba(60,44,26,0.7)'; g.lineWidth = Math.max(0.25, 0.6 / s);
      }
    }
    // faîtage clair
    g.strokeStyle = snow ? 'rgba(255,255,255,0.9)' : 'rgba(255,236,200,0.55)'; g.lineWidth = Math.max(0.3, 0.35);
    g.beginPath(); g.moveTo(r1[0], r1[1]); g.lineTo(r2[0], r2[1]); g.stroke();
    g.strokeStyle = 'rgba(60,44,26,0.7)'; g.lineWidth = Math.max(0.25, 0.6 / s);
    // pignons (triangles aux bouts)
    const gab = long ? [[p0, p3, r1], [p1, p2, r2]] : [[p0, p1, r1], [p3, p2, r2]];
    for (const [a, bb, r] of gab) {
      if (Math.max(a[1], bb[1]) < r[1] + 0.5) continue;
      g.fillStyle = mixHex(wall, '#000000', 0.12);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(bb[0], bb[1]); g.lineTo(r[0], r[1]); g.closePath(); g.fill(); g.stroke();
    }
    // cheminée
    if (kind !== 'eglise' && s >= 2 && Math.abs(k) % 3) {
      const f = 0.22 + (Math.abs(k) % 5) * 0.12, cx = r1[0] + (r2[0] - r1[0]) * f, cy = r1[1] + (r2[1] - r1[1]) * f, ch = 1.6 / TILT;
      g.fillStyle = mixHex(wall, '#000000', 0.25); g.fillRect(cx - 0.4, cy - ch, 0.8, ch + 0.4);
      g.fillStyle = mixHex(wall, '#ffffff', 0.1); g.fillRect(cx - 0.4, cy - ch, 0.4, ch + 0.4);
      g.fillStyle = '#3a2e26'; g.fillRect(cx - 0.45, cy - ch - 0.25, 0.9, 0.3);
    }
    // clocher de l'église, à un bout de la nef
    if (kind === 'eglise') {
      const ca = Math.cos(b.a || 0), sa = Math.sin(b.a || 0), tx = b.x - ca * (b.w / 2 + 3), ty = b.y - sa * (b.w / 2 + 3), tw = 6.5, TH = 22 / TILT;
      g.fillStyle = mixHex('#d9ccb0', '#000000', 0.2); g.fillRect(tx, ty - TH, tw / 2, TH); g.strokeRect(tx - tw / 2, ty - TH, tw, TH);
      g.fillStyle = '#d9ccb0'; g.fillRect(tx - tw / 2, ty - TH, tw / 2, TH);
      g.fillStyle = '#3b2c1c'; g.fillRect(tx - 1, ty - TH * 0.85, 2, TH * 0.12);
      g.fillStyle = snow ? '#eef1f4' : pal.ardoise[0];
      g.beginPath(); g.moveTo(tx - tw / 2 - 0.6, ty - TH); g.lineTo(tx, ty - TH - 9 / TILT); g.lineTo(tx + tw / 2 + 0.6, ty - TH); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(tx - tw / 2 - 0.6, ty - TH); g.lineTo(tx, ty - TH - 9 / TILT); g.lineTo(tx, ty - TH); g.closePath(); g.fill();
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

  // haies, murets et clôtures qui bordent champs et chemins, en relief : leur ombre au sud-est, puis le volume
  // (les hauteurs sont peintes divisées par TILT)
  paintFences(g, s) {
    const pal = this.pal, snow = pal.neige, k = 1 / TILT;
    const shift = (pts, dx, dy) => pts.map(p => [p[0] + dx, p[1] + dy]);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const f of this.fencePts) {
      if (f.kind === 'haie') {
        // haie vive d'environ 2 m : ombre portée, pied sombre, buissons éclairés
        g.strokeStyle = snow ? 'rgba(50,60,90,0.22)' : 'rgba(20,34,12,0.32)'; g.lineWidth = 3.4; strokePts(g, shift(f.pts, OMBRE[0] * 1.6, OMBRE[1] * 1.6));
        g.strokeStyle = snow ? '#5e6a5c' : mixHex(pal.arbres[0], '#000000', 0.35); g.lineWidth = 2.6; strokePts(g, f.pts);
        if (s >= 1) {
          for (const [q, p] of resample(f.pts, s >= 2 ? 1.4 : 2.4).entries()) {
            const ci = (hash(q, 2, p[1] | 0) * 3) | 0;
            this.tree(g, { x: p[0] + (hash(q, 3, p[0] | 0) - 0.5) * 0.6, y: p[1], r: 1.1 + hash(q, 1, p[0] | 0) * 0.7, ci, kind: snow && ci ? 'nu' : 'buisson' }, s);
          }
        } else { g.strokeStyle = snow ? '#6f7d6c' : pal.arbres[1]; g.lineWidth = 2.2; strokePts(g, shift(f.pts, 0, -1.2)); }
      } else if (f.kind === 'muret') {
        // muret de pierres sèches haut d'un mètre : ombre, face tournée vers nous, chaperon éclairé
        const top = shift(f.pts, 0, -k), stone = snow ? '#e6e6e2' : '#b9b09a';
        g.strokeStyle = 'rgba(30,26,20,0.3)'; g.lineWidth = 1.3; strokePts(g, shift(f.pts, OMBRE[0], OMBRE[1]));
        g.fillStyle = mixHex(stone, '#000000', 0.3);
        g.beginPath();
        for (let q = 1; q < f.pts.length; q++) { const a = f.pts[q - 1], b = f.pts[q]; g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0], b[1] - k); g.lineTo(a[0], a[1] - k); g.closePath(); }
        g.fill();
        if (s >= 4) { g.strokeStyle = 'rgba(255,250,235,0.35)'; g.lineWidth = 0.3; g.setLineDash([0.45, 0.35]); strokePts(g, shift(f.pts, 0, -0.5 * k)); g.setLineDash([]); }
        g.strokeStyle = stone; g.lineWidth = 0.7; strokePts(g, top);
      } else {
        // clôture de bois : ombre au sol, piquets, deux lisses
        g.strokeStyle = 'rgba(30,24,14,0.28)'; g.lineWidth = 0.25; strokePts(g, shift(f.pts, OMBRE[0] * 0.9, OMBRE[1] * 0.9));
        if (s >= 2) {
          g.fillStyle = snow ? '#4e4034' : '#5a4430';
          for (const p of resample(f.pts, 2.5)) g.fillRect(p[0] - 0.08, p[1] - 1.2 * k, 0.16, 1.2 * k);
          g.strokeStyle = snow ? '#8a7a68' : '#8a6a46'; g.lineWidth = 0.12;
          strokePts(g, shift(f.pts, 0, -0.55 * k)); strokePts(g, shift(f.pts, 0, -1.0 * k));
        } else { g.strokeStyle = snow ? 'rgba(90,76,60,0.8)' : 'rgba(110,84,52,0.85)'; g.lineWidth = 0.5; strokePts(g, shift(f.pts, 0, -0.8 * k)); }
      }
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
    this.q = q || profil();
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
    // d'abord les motifs du niveau (le premier usage d'un motif coûte de 30 à 150 ms) : un seul par appel, pour que
    // la première tuile de ce niveau ne les peigne pas tous d'un coup
    // (seulement s'il reste de la place : sinon le motif chasserait un autre motif du même niveau, sans fin)
    const kind = this.kinds.find(k => !this.cache.has(`t|${k}|${p.L}`));
    if (kind && this.cacheBytes + texSize(p.L) ** 2 * 4 <= this.q.textures) { this.cached(`t|${kind}|${p.L}`, () => texture(kind, p.L, this.pal, this.season)); this.trim(); return true; }
    // plus de place pour une tuile d'avance : elle chasserait une tuile visible, repeinte aussitôt, sans fin
    if (this.tiles.size >= this.q.tiles) { this.pending = null; return false; }
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
  // brèche ouverte au canon pendant la bataille ([mur, x, y, rayon]) : le rempart est repeint autour d'elle
  addBreach([wi, x, y, r]) {
    const w = this.walls[wi];
    if (!w) return;
    (w.breach = w.breach || []).push([x, y, r]);
    const m = r + 40, x0 = x - m, y0 = y - m;
    const cv = this.paintCanvas(x0, y0, 2 * m, 2 * m, BASE);
    this.base.getContext('2d').drawImage(cv, x0 * BASE, y0 * BASE);
    cv.width = cv.height = 0;
    for (const [k, t] of [...this.tiles]) {
      const L = Math.floor(k / 100000), j = Math.floor((k % 100000) / 1000), i = k % 1000, span = TS / L;
      if (x + m > i * span && x - m < (i + 1) * span && y + m > j * span && y - m < (j + 1) * span) { this.tiles.delete(k); t.width = t.height = 0; }
    }
  }
  // tués, chevaux, trous d'obus : peints dans le fond (tuiles faites et à venir)
  addDecals(list) {
    list = list.filter(d => this.bare(d.x, d.y));
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
    for (const e of this.cache.values()) { const cv = e.cv || e; cv.width = cv.height = 0; }
    this.cache.clear(); this.cacheBytes = 0;
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
function paintDecal(g, d, s) {
  const el = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); };
  g.save(); g.translate(d.x, d.y); g.rotate(d.a || 0);
  if (d.k === 'trou') {
    // entonnoir d'obus : terre rejetée tout autour, fond sombre
    const r = (d.r || 2.6) * 0.7;
    g.fillStyle = 'rgba(122,98,64,0.18)'; el(0, 0, r * 1.35, r * 1.1);
    g.fillStyle = 'rgba(84,62,38,0.26)'; el(0, 0, r, r * 0.8);
    g.fillStyle = 'rgba(42,30,18,0.24)'; el(r * 0.12, r * 0.1, r * 0.5, r * 0.4);
  } else if (d.k === 'cheval') {
    g.fillStyle = 'rgba(30,20,15,0.25)'; g.fillRect(-1.3 + 0.3, -0.5 + 0.3, 2.6, 1.0);
    g.fillStyle = d.c2 || '#5a3e26'; el(0, 0, 1.3, 0.5);
    if (s >= 4) {
      g.strokeStyle = d.c2 || '#5a3e26'; g.lineWidth = 0.16; g.lineCap = 'round'; g.beginPath();
      for (const [x, a] of [[-0.9, 0.5], [-0.6, 0.9], [0.8, 0.7], [1.0, 1.1]]) { g.moveTo(x, 0.3); g.lineTo(x + 0.2, a + 0.3); }
      g.stroke(); el(1.45, -0.15, 0.42, 0.2);
      g.fillStyle = '#2a1e14'; g.fillRect(-0.3, -0.45, 0.6, 0.5);
    }
  } else {
    // soldat tombé : jambes, habit aux couleurs du camp, buffleteries, tête, coiffure, fusil
    g.fillStyle = 'rgba(30,20,15,0.25)'; g.fillRect(-0.85 + 0.2, -0.3 + 0.2, 1.7, 0.6);
    if (s >= 4) {
      g.fillStyle = '#e4ddcc'; g.fillRect(-0.92, -0.24, 0.62, 0.2); g.fillRect(-0.92, 0.04, 0.62, 0.2);
      g.fillStyle = '#211a14'; g.fillRect(-1.02, -0.25, 0.16, 0.22); g.fillRect(-1.02, 0.03, 0.16, 0.22);
      g.fillStyle = d.c || '#555'; g.fillRect(-0.34, -0.32, 1.02, 0.64);
      g.strokeStyle = '#efe9da'; g.lineWidth = 0.07; g.beginPath(); g.moveTo(-0.3, -0.3); g.lineTo(0.62, 0.3); g.moveTo(-0.3, 0.3); g.lineTo(0.62, -0.3); g.stroke();
      g.fillStyle = '#e2b996'; el(0.84, 0, 0.17, 0.17);
      g.fillStyle = '#1f1b18'; el(1.12, 0.12, 0.2, 0.15);
      g.strokeStyle = '#4a3420'; g.lineWidth = 0.08; g.beginPath(); g.moveTo(-0.9, 0.62); g.lineTo(0.85, 0.82); g.stroke();
      g.strokeStyle = '#c9ccd0'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(0.85, 0.82); g.lineTo(1.25, 0.86); g.stroke();
    } else {
      g.fillStyle = d.c || '#555'; g.fillRect(-0.85, -0.3, 1.5, 0.6);
      g.fillStyle = '#2a2018'; g.beginPath(); g.arc(0.85, 0, 0.28, 0, TAU); g.fill();
      if (s >= 2) { g.strokeStyle = 'rgba(60,40,25,0.8)'; g.lineWidth = 0.12; g.beginPath(); g.moveTo(-1, 0.6); g.lineTo(0.8, 0.9); g.stroke(); }
    }
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
