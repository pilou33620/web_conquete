// Vue tactique : le sol du champ de bataille, peint vu de haut à la manière d'un paysage peint : herbe aux nuances
// multiples, cultures striées selon la saison, chemins de terre à ornières, eau avec berges et reflets, fossés et
// glacis, ombre douce au pied des arbres et des maisons. La vue 3D (relief.js) pose cette peinture sur le relief :
// une image entière à basse résolution (aussi mini-carte), puis des blocs plus fins autour de la caméra (paintInto).
// Ce qui est debout (arbres, maisons, remparts, haies) est en volume (decor.js), d'après les données préparées ici
// (treeGrid, ponts, portes, tracés adoucis). Aussi : altitudes adoucies (fineAt), cotes des sommets, couverts.
// Motifs des sols : textures.js.
import { T, cellRemap, normSeason, hash, clamp, TAU, OMBRE, mixHex, vnoise, canvas } from './formes.js';
import { texture, softShadow, culture, EPIS } from './textures.js';
import { profil } from './qualite.js';

const BASE = 0.5;   // pixels par mètre de l'image entière

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
    pre: ['#8aa75a', '#7a9a4c', '#98ae62', '#869f55'], herbeSec: '#b9b86c', champ: [['#b9c766', '#a9bd5c'], ['#a98b5e', '#977a52'], ['#e2d45e', '#d6c652'], ['#9fc25c', '#8fb350']],
    vigneSol: '#b5a27a', vigneRang: '#5d8f36', lande: '#a3a067', landeFleurs: ['#8f6a92', '#c9b648', '#6f7d48'], sousBois: '#4f7a38',
    arbres: ['#3d7a34', '#4b8a3b', '#5a9944'], arbreHi: 'rgba(170,215,110,0.55)', pins: ['#2f6136', '#3a6d3c'], marais: '#7fa37e', sable: '#e2d29c',
    roche: '#aaa491', rocheSombre: '#7d7867', eau: '#4f8cc6', eauBord: '#2f6297', eauHi: 'rgba(200,228,250,0.55)', route: '#c4a77e', routeBord: '#8f744c',
    chemin: '#c0a375', bati: '#c1b08e', toit: ['#b4513a', '#c0623e', '#a9472f'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  ete: {
    pre: ['#8fa64e', '#7c9545', '#9fad5c', '#88994a'], herbeSec: '#c1b46a', champ: [['#e6c56a', '#d8b65c'], ['#d9bd78', '#cbac66'], ['#c9a35c', '#b99352'], ['#b4b85e', '#a6aa54']],
    vigneSol: '#c4ab7c', vigneRang: '#4c7d2c', lande: '#ada060', landeFleurs: ['#9c6a8e', '#d8bf4a', '#857a48'], sousBois: '#46703a',
    arbres: ['#3f7a33', '#4c8a3a', '#5b9744'], arbreHi: 'rgba(160,200,100,0.5)', pins: ['#2b5a33', '#356638'], marais: '#87a37a', sable: '#ead7a0',
    roche: '#b2aa94', rocheSombre: '#857e6a', eau: '#4a88c2', eauBord: '#2c5e94', eauHi: 'rgba(210,235,250,0.55)', route: '#c8a878', routeBord: '#957650',
    chemin: '#c8a671', bati: '#c9b893', toit: ['#b85a3c', '#c4643a', '#a94a2a'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  automne: {
    pre: ['#8e9e58', '#859651', '#97a35e', '#8a9152'], herbeSec: '#ab9c5c', champ: [['#8c6a46', '#7c5c3c'], ['#a3825a', '#93744e'], ['#b89a64', '#a98b58'], ['#7f8a4c', '#717c44']],
    vigneSol: '#9e8460', vigneRang: '#a27a34', lande: '#93774f', landeFleurs: ['#a0522d', '#8a6a3a', '#6c6040'], sousBois: '#6a6234',
    arbres: ['#a8692a', '#c08a30', '#7c7a32', '#9a4a26'], arbreHi: 'rgba(240,200,110,0.45)', pins: ['#2f5a35', '#3a6439'], marais: '#7c8f6c', sable: '#dccb98',
    roche: '#a39d8a', rocheSombre: '#77715f', eau: '#4a7fb4', eauBord: '#2b5788', eauHi: 'rgba(200,222,240,0.5)', route: '#b89e70', routeBord: '#806642',
    chemin: '#b39566', bati: '#b8a684', toit: ['#a94a2f', '#b85a3a', '#9a4229'], ardoise: ['#565d6c', '#4c5262'], neige: 0,
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
  // q : profil de qualité graphique (qualite.js) : mémoire laissée aux motifs des sols
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
    this.setQuality(q);
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
    this.prepFine();
    this.prepNuances();
    this.prepPeaks();
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
  // altitudes affinées à 5 m par interpolation cubique, puis adoucies : le relief de la vue 3D et la hauteur des troupes
  prepFine() {
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
    this.fine = fine; this.fineW = W; this.fineH = H; this.fineStep = cell / F;
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
  // couleur et hauteur des cultures, pour les épis en relief (relief.js) : une image à `res` m par pixel, rgb la couleur
  // des pieds, a leur hauteur (255 : hmax m) ; les routes et chemins qui traversent les champs en sont ôtés ; rien
  // sous la neige
  cropMask(hmax, res = 2.5) {
    const w = Math.ceil(this.W / res), h = Math.ceil(this.H / res), out = new Uint8Array(w * h * 4);
    if (this.pal.neige) return { data: out, w, h };
    const col = canvas(w, h), hgt = canvas(w, h), gc = col.getContext('2d'), gh = hgt.getContext('2d');
    for (const g of [gc, gh]) g.setTransform(1 / res, 0, 0, 1 / res, 0, 0);
    for (const r of this.regions) {
      // champs, prés (herbe ou prairie de fauche) et landes ; pas les routes et chemins, qui ont aussi le motif d'herbe
      const e = EPIS[r.tex];
      if (!e || (r.type !== T.CHAMP && r.type !== T.PRE && r.type !== T.LANDE)) continue;
      gc.fillStyle = e[1] || (r.type === T.LANDE ? this.pal.lande : mixHex(this.pal.pre[r.tone ?? 0], this.pal.herbeSec, 0.15 + 0.35 * hash(r.parcel, 11, 7)));
      if (r.tex === 'mais' && this.season === 'automne') gc.fillStyle = '#c4aa64';
      gc.fill(r.path);
      const v = Math.round(e[0] / hmax * 255); gh.fillStyle = `rgb(${v},${v},${v})`; gh.fill(r.path);
    }
    gh.lineCap = 'round'; gh.lineJoin = 'round'; gh.strokeStyle = '#000';
    gh.lineWidth = 7; for (const p of this.pathPts) strokePts(gh, p);
    gh.lineWidth = 12; for (const r of this.roadPts) strokePts(gh, r);
    const c = gc.getImageData(0, 0, w, h).data, a = gh.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) { const k = i * 4; out[k] = c[k]; out[k + 1] = c[k + 1]; out[k + 2] = c[k + 2]; out[k + 3] = a[k]; }
    col.width = col.height = hgt.width = hgt.height = 0;   // (Safari garde sinon la mémoire des canevas)
    return { data: out, w, h };
  }
  // cotes des sommets (comme sur les cartes d'état-major), écrites sur le calque par la vue
  prepPeaks() {
    const { cols, rows, cell, h } = this;
    const range = this.hmax - this.hmin, cx = i => (i + 0.5) * cell;
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
  // peint un rectangle du monde dans un canevas déjà fait (à la bonne taille : wm·s × hm·s), sans en créer un neuf
  paintInto(cv, x0, y0, wm, hm, s) {
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.paint(g, x0, y0, wm, hm, s);
    this.trim();
    return cv;
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
      if (v === T.PRE) { g.globalAlpha = 0.16; g.fillStyle = pal.pre[r.tone]; g.fill(r.path); g.globalAlpha = 1; }
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
    // chemins de terre : larges, bas-côtés foulés aux bords fondus, ornières, herbe au milieu ; routes : chaussée de
    // terre battue et de gravier
    g.lineCap = 'round'; g.lineJoin = 'round';
    const verge = snow ? 'rgba(150,150,150,0.15)' : 'rgba(112,90,44,0.15)', terre = this.pat(g, 'terre', s), route = this.pat(g, 'route', s);
    g.strokeStyle = verge;
    for (const w of [9.5, 7.6]) for (const p of this.pathPts) { g.lineWidth = w; strokePts(g, p); }   // deux passes : un bord fondu
    for (const w of [16, 13]) for (const r of this.roadPts) { g.lineWidth = w; strokePts(g, r); }
    for (const p of this.pathPts) { g.strokeStyle = 'rgba(96,72,40,0.26)'; g.lineWidth = 5.8; strokePts(g, p); }
    for (const p of this.pathPts) { g.strokeStyle = terre; g.lineWidth = 5; strokePts(g, p); }
    for (const r of this.roadPts) { g.strokeStyle = pal.routeBord; g.lineWidth = 10.2; strokePts(g, r); }
    for (const r of this.roadPts) { g.strokeStyle = route; g.lineWidth = 9.2; strokePts(g, r); }
    if (s >= 1.5) {
      g.strokeStyle = snow ? 'rgba(110,100,90,0.4)' : 'rgba(96,70,40,0.4)'; g.lineWidth = 0.6;
      for (const r of this.roadPts) { strokePts(g, offsetPts(r, -1.6)); strokePts(g, offsetPts(r, 1.6)); }
      for (const p of this.pathPts) { strokePts(g, offsetPts(p, -1.2)); strokePts(g, offsetPts(p, 1.2)); }
      g.strokeStyle = snow ? 'rgba(250,252,255,0.6)' : 'rgba(112,136,60,0.55)'; g.lineWidth = 0.9;
      for (const p of this.pathPts) strokePts(g, p);
      g.strokeStyle = 'rgba(255,250,232,0.14)'; g.lineWidth = 1.3;
      for (const r of this.roadPts) strokePts(g, r);
    }
    // (ponts : en volume, decor.js)
    mark('routes');
    // au pied de ce qui est debout (en volume : decor.js) : fossés, glacis, terre remuée, pied des haies, ombre douce
    this.paintWalls(g);
    this.paintFences(g);
    this.paintStanding(g, x0, y0, wm, hm);
    mark('debout');
  }
  // bâtiments rangés pour le shader des troupes, qui en repousse les hommes et les chevaux (troupes.js, pushOut) : une
  // grille de cell m sur leur emprise, au plus 4 bâtiments par case (numéro + 1 ; 0 : aucun) ; rects, deux lignes :
  // centre et angle, puis demi-côtés élargis de margin. null sans bâtiment
  buildingGrid(cell = 8, margin = 0.5) {
    const B = this.buildings;
    if (!B.length) return null;
    const R = b => Math.hypot(b.w, b.h) / 2 + margin;
    const x0 = Math.min(...B.map(b => b.x - R(b))), y0 = Math.min(...B.map(b => b.y - R(b)));
    const cols = Math.ceil((Math.max(...B.map(b => b.x + R(b))) - x0) / cell) + 1, rows = Math.ceil((Math.max(...B.map(b => b.y + R(b))) - y0) / cell) + 1;
    const cells = new Float32Array(cols * rows * 4), rects = new Float32Array(B.length * 8);
    let full = 0;
    B.forEach((b, i) => {
      rects.set([b.x, b.y, b.a || 0, 0], i * 4); rects.set([b.w / 2 + margin, b.h / 2 + margin, 0, 0], (B.length + i) * 4);
      const r = R(b);
      for (let cy = Math.floor((b.y - r - y0) / cell); cy <= Math.floor((b.y + r - y0) / cell); cy++) {
        for (let cx = Math.floor((b.x - r - x0) / cell); cx <= Math.floor((b.x + r - x0) / cell); cx++) {
          const o = (cy * cols + cx) * 4;
          let k = 0;
          while (k < 4 && cells[o + k]) k++;
          if (k < 4) cells[o + k] = i + 1; else full++;
        }
      }
    });
    // shortcut: 4 bâtiments au plus par case (un texel RGBA) ; le cinquième se traverse. Deux textures si ça arrive
    if (full) console.warn(`bâtiments : ${full} cases de ${cell} m déjà pleines, des troupes pourront traverser un bâtiment`);
    return { cell, x0, y0, cols, rows, cells, rects, n: B.length };
  }
  // Le sol est-il découvert en (x, y) ? Ni bois, ni eau, ni bâti, ni dans l'emprise d'une maison : les tués et les
  // trous d'obus ne se posent que là
  bare(x, y) {
    const v = this.at(x, y);
    if (v === T.BOIS || v === T.FORET || v === T.EAU || v === T.GUE || v === T.BATI || v === T.MUR || v === T.PORTE) return false;
    return !this.buildings.some(b => Math.hypot(x - b.x, y - b.y) < Math.hypot(b.w, b.h) / 2 + 1);
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
  // ombre douce au pied des arbres et des maisons (en volume : decor.js)
  paintStanding(g, x0, y0, wm, hm) {
    const { cols, rows, cell } = this, snow = this.pal.neige;
    const i0 = Math.max(0, Math.floor(x0 / cell) - 1), i1 = Math.min(cols - 1, Math.ceil((x0 + wm) / cell) + 1);
    const j0 = Math.max(0, Math.floor(y0 / cell) - 1), j1 = Math.min(rows - 1, Math.ceil((y0 + hm + 30) / cell) + 1);
    g.globalAlpha = snow ? 0.2 : 0.3;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const tr of this.treeGrid[j * cols + i]) { const rr = tr.r * 1.1; g.drawImage(this.ombre, tr.x - rr, tr.y - rr * 0.9, rr * 2, rr * 1.8); }
    for (const b of this.buildings) {
      if (b.x < x0 - 60 || b.x > x0 + wm + 60 || b.y < y0 - 60 || b.y > y0 + hm + 90) continue;
      const rr = Math.max(b.w, b.h) * 0.75 + 2; g.drawImage(this.ombre, b.x - rr, b.y - rr, rr * 2, rr * 2);
    }
    g.globalAlpha = 1;
  }
  // emprise d'un bâtiment : coins au sol, dans l'ordre
  corners(b) {
    const ca = Math.cos(b.a || 0), sa = Math.sin(b.a || 0), w = b.w / 2, h = b.h / 2;
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [b.x + u * ca - v * sa, b.y + u * sa + v * ca]);
  }
  // au pied des enceintes (en volume : decor.js) : fossé et glacis des remparts (hors des brèches), terre remuée et fond
  // des tranchées, jamais sur l'eau
  paintWalls(g) {
    const snow = this.pal.neige;
    const breaches = this.walls.flatMap(w => (w.breach || []).map(b => ({ x: b[0], y: b[1], r: b[2] || 20 })));
    g.save();
    if (breaches.length) {
      const clip = new Path2D();
      clip.rect(-100, -100, this.W + 200, this.H + 200);
      for (const b of breaches) { clip.moveTo(b.x + b.r, b.y); clip.arc(b.x, b.y, b.r, 0, TAU, true); }
      g.clip(clip, 'evenodd');
    }
    const small = w => { const xs = w.pts.map(p => p[0]), ys = w.pts.map(p => p[1]); return Math.max(...xs) - Math.min(...xs) < 160 && Math.max(...ys) - Math.min(...ys) < 160; };
    const th = w => clamp(w.thick || 16, 4, 24);
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const w of this.walls) {
      if (w.kind !== 'rempart' && w.kind !== 'bastion') continue;
      for (const pts of small(w) ? [w.pts] : this.splitDry(w.pts)) {
        g.strokeStyle = snow ? '#aab4b8' : '#7f8f62'; g.lineWidth = th(w) * 1.7; strokePts(g, pts);
        g.strokeStyle = snow ? '#c5ccd0' : '#6d7d55'; g.lineWidth = th(w) * 1.3; strokePts(g, pts);
      }
    }
    const hasBar = this.t.includes(T.BARRICADE);
    for (const w of this.walls) {
      if (w.kind !== 'barricade' || (small(w) && hasBar)) continue;
      for (const pts of this.splitDry(w.pts, hasBar)) {
        if (pts.length < 2) continue;
        g.strokeStyle = snow ? 'rgba(150,140,128,0.5)' : 'rgba(120,92,58,0.45)'; g.lineWidth = 12; strokePts(g, pts);
        g.strokeStyle = snow ? '#7d7468' : '#4d3b26'; g.lineWidth = 2.6; strokePts(g, offsetPts(pts, 2.2));
      }
    }
    g.restore();
  }
  // pied des haies, murets et clôtures (en volume : decor.js), un peu assombri
  paintFences(g) {
    const snow = this.pal.neige;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const f of this.fencePts) { g.strokeStyle = snow ? 'rgba(50,60,90,0.18)' : 'rgba(20,34,12,0.25)'; g.lineWidth = f.kind === 'haie' ? 3.2 : 1.4; strokePts(g, f.pts); }
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
  setQuality(q) { this.q = q || profil(); if (this.cache) this.trim(); }   // (le constructeur l'appelle avant le cache)
  // brèche ouverte au canon pendant la bataille ([mur, x, y, rayon]) : l'image entière est repeinte autour d'elle
  // (relief.js repeint ses blocs, decor.js l'enceinte)
  addBreach([wi, x, y, r]) {
    const w = this.walls[wi];
    if (!w) return;
    (w.breach = w.breach || []).push([x, y, r]);
    const m = r + 40, x0 = x - m, y0 = y - m;
    const cv = this.paintCanvas(x0, y0, 2 * m, 2 * m, BASE);
    this.base.getContext('2d').drawImage(cv, x0 * BASE, y0 * BASE);
    cv.width = cv.height = 0;
  }
  // tués, chevaux, trous d'obus : ceux qui tombent sur le sol découvert (relief.js les pose sur le relief)
  addDecals(list) { return list.filter(d => this.bare(d.x, d.y)); }
  dispose() {
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
export function offsetPts(pts, d) {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - dy / l * d, p[1] + dx / l * d];
  });
}
export function resample(pts, step) {
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
export function paintDecal(g, d, s) {
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
