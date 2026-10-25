// Vue tactique : le sol du champ de bataille, peint à plat vu de haut dans le style de Champs de Plaine (maquette
// dev/maquette-2d.html) : parcelles striées avec leurs tournières et leurs bottes, prés à touffes et fleurs, labours à
// mottes, haies bocagères en boules sombres, chemins de terre, routes royales empierrées (fossés, ornières, bornes,
// rangs d'ormes hors des villes), rues pavées en ville, rivières à ripisylve, collines lisibles par
// un ombrage doux éclairé du nord-ouest (d'après les altitudes du moteur), saisons et neige. Sol2D (sol2d.js) en fait
// des tuiles par niveau de zoom (paintInto) ; une image entière à basse résolution (base) sert de repli et de
// mini-carte. Ce qui est debout (arbres, maisons, remparts) est dessiné par le décor, d'après les données préparées ici
// (treeGrid, ponts, portes, tracés adoucis). Aussi : altitudes adoucies (fineAt), cotes des sommets, couverts.
// Motifs des sols : textures.js.
import { T, cellRemap, normSeason, hash, clamp, TAU, OMBRE, mixHex, vnoise, canvas } from './formes.js';
import { texture, culture, couleurs, mix, periode, BOIS } from './textures.js';
import { profil } from './qualite.js';

export const BASE = 0.5;   // pixels par mètre de l'image entière

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
    roche: '#aaa491', rocheSombre: '#7d7867', eau: '#4f8584', eauBord: '#34574f', eauHi: 'rgba(200,228,250,0.55)', route: '#c4a77e', routeBord: '#8f744c',
    chemin: '#c0a375', bati: '#c1b08e', toit: ['#b4513a', '#c0623e', '#a9472f'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  ete: {
    pre: ['#8fa64e', '#7c9545', '#9fad5c', '#88994a'], herbeSec: '#c1b46a', champ: [['#e6c56a', '#d8b65c'], ['#d9bd78', '#cbac66'], ['#c9a35c', '#b99352'], ['#b4b85e', '#a6aa54']],
    vigneSol: '#c4ab7c', vigneRang: '#4c7d2c', lande: '#ada060', landeFleurs: ['#9c6a8e', '#d8bf4a', '#857a48'], sousBois: '#46703a',
    arbres: ['#3f7a33', '#4c8a3a', '#5b9744'], arbreHi: 'rgba(160,200,100,0.5)', pins: ['#2b5a33', '#356638'], marais: '#87a37a', sable: '#ead7a0',
    roche: '#b2aa94', rocheSombre: '#857e6a', eau: '#4a8282', eauBord: '#32544d', eauHi: 'rgba(210,235,250,0.55)', route: '#c8a878', routeBord: '#957650',
    chemin: '#c8a671', bati: '#c9b893', toit: ['#b85a3c', '#c4643a', '#a94a2a'], ardoise: ['#5d6474', '#535a6a'], neige: 0,
  },
  automne: {
    pre: ['#8e9e58', '#859651', '#97a35e', '#8a9152'], herbeSec: '#ab9c5c', champ: [['#8c6a46', '#7c5c3c'], ['#a3825a', '#93744e'], ['#b89a64', '#a98b58'], ['#7f8a4c', '#717c44']],
    vigneSol: '#9e8460', vigneRang: '#a27a34', lande: '#93774f', landeFleurs: ['#a0522d', '#8a6a3a', '#6c6040'], sousBois: '#6a6234',
    arbres: ['#a8692a', '#c08a30', '#7c7a32', '#9a4a26'], arbreHi: 'rgba(240,200,110,0.45)', pins: ['#2f5a35', '#3a6439'], marais: '#7c8f6c', sable: '#dccb98',
    roche: '#a39d8a', rocheSombre: '#77715f', eau: '#4a7a7c', eauBord: '#30504b', eauHi: 'rgba(200,222,240,0.5)', route: '#b89e70', routeBord: '#806642',
    chemin: '#b39566', bati: '#b8a684', toit: ['#a94a2f', '#b85a3a', '#9a4229'], ardoise: ['#565d6c', '#4c5262'], neige: 0,
  },
  hiver: {
    pre: ['#e9edf0', '#e3e8ec', '#eef1f3', '#dfe5ea'], herbeSec: '#dfe5ea', champ: [['#e4e8ec', '#d3d9de'], ['#e8ebee', '#d8dde1'], ['#dde2e7', '#cdd3d9'], ['#e6eaee', '#d6dce1']],
    vigneSol: '#e3e7eb', vigneRang: '#5a4a3c', lande: '#dde2e2', landeFleurs: ['#8a8f86', '#a3a79c', '#7c8476'], sousBois: '#c9d0d0',
    arbres: ['#7d6d5e', '#8c7b6a', '#6e6052'], arbreHi: 'rgba(250,252,255,0.8)', pins: ['#2c4a3a', '#36543f'], marais: '#c5d0d2', sable: '#e8e6dc',
    roche: '#c9ccce', rocheSombre: '#8d9194', eau: '#6f8c92', eauBord: '#4c6a6c', eauHi: 'rgba(230,240,250,0.7)', route: '#d9d6cd', routeBord: '#9a958a',
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
    // l'époque (SPEC-SUITE J) : l'année et les marques des deux camps (rules.VISUALS) choisissent les cultures
    this.year = m.year || 1790; this.marks = m.marks || [[], []];
    const mk = k => this.marks.some(l => (l || []).includes(k));
    this.epoque = { mais: mk('mais') && /\((40|64)\)/.test(m.region || ''), foule: !mk('greffe') && this.year < 1885, pinsLignes: mk('landes1857') || this.year >= 1860 };
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
    // la ville (SPEC-2D § 6 : town, sinon la place) : ses rues sont pavées
    this.town = [m.town, m.place].find(o => o && o.r > 0 && o.x != null) || null;
    this.seed = (m.seed | 0) || 1;
    this.season = normSeason(m.season);
    this.pal = PALETTES[this.season];
    this.setQuality(q);
    this.cache = new Map();      // motifs et silhouettes d'arbres (textures.js), bornés en mémoire par la qualité
    this.cacheBytes = 0;
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
    const S = this.seed;
    // régions : composantes connexes d'un même type (les cultures, prés, vignes et vergers : en parcelles, prepParcelles)
    const crop = v => v === T.CHAMP || v === T.VIGNE || v === T.PRE || v === T.VERGER;
    const label = new Int32Array(cols * rows).fill(-1);
    this.regions = [];
    const stack = [];
    for (let c0 = 0; c0 < cols * rows; c0++) {
      if (label[c0] >= 0 || crop(t[c0])) continue;
      const v = t[c0], id = this.regions.length;
      const reg = { type: v, cells: [], box: [1e9, 1e9, -1e9, -1e9] };
      label[c0] = id; stack.push(c0);
      while (stack.length) {
        const c = stack.pop(), i = c % cols, j = (c / cols) | 0;
        reg.cells.push(c);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
          const cc = jj * cols + ii;
          if (label[cc] >= 0 || t[cc] !== v) continue;
          label[cc] = id; stack.push(cc);
        }
      }
      this.regions.push(reg);
    }
    this.label = label;
    const jitterOf = v => (v === T.ROUTE || v === T.CHEMIN || v === T.BATI || v === T.MUR || v === T.BRECHE || v === T.PORTE || v === T.BARRICADE ? 0 : 5);
    for (const [id, reg] of this.regions.entries()) {
      reg.path = this.regionPath(id, jitterOf(reg.type), reg.box);
      const v = reg.type;
      reg.tex = v === T.LANDE ? 'lande' : v === T.MARAIS ? 'marais' : v === T.SABLE ? 'sable' : v === T.ROCHE ? 'roche'
        : v === T.BOIS || v === T.FORET ? 'sousBois' : v === T.ROUTE || v === T.CHEMIN ? 'herbe'
        : v === T.BARRICADE ? 'terre' : v === T.EAU || v === T.GUE ? 'eau' : 'cour';
      // décalage du motif d'une région à l'autre : la répétition ne s'aligne pas
      reg.off = [hash(id, 8, S) * 97, hash(id, 9, S) * 97];
    }
    this.prepClotures();
    this.prepParcelles();
    // motifs dont cette carte se sert (préparés d'avance dans le temps libre : warm)
    this.kinds = [...new Set(['herbe', 'eau', 'pave', ...this.regions.map(r => r.tex), ...this.parcelles.map(p => p.tex)])];
    // ordre de peinture (après les parcelles) : les sols d'abord, l'eau et le bâti ensuite
    const ORDER = [T.LANDE, T.SABLE, T.ROCHE, T.MARAIS, T.BOIS, T.FORET, T.ROUTE, T.CHEMIN, T.BATI, T.MUR, T.BRECHE, T.PORTE, T.BARRICADE, T.GUE, T.EAU];
    this.regions.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    this.prepTrees();
    this.prepFine();
    this.prepNuances();
    this.prepPeaks();
    this.prepPaths();
    this.prepLaneTrees();
    this.prepCover();
    this.prepVille();
    this.prepRoutes();
    this.prepOrnements();
    this.prepOmbrage();
  }
  // parcelles, comme dans Champs de Plaine : les cases des cultures, prés, vignes et vergers découpées en rectangles.
  // Des blocs de 120 à 180 m sur 100 à 160 m (les rangs décalés d'une colonne à l'autre), recoupés en deux au meilleur
  // endroit tant qu'ils mêlent les sols du moteur ; un grand rectangle d'un seul sol l'est une fois sur deux (des
  // voisins qui tranchent). Chaque rectangle prend le sol qui y domine, sa culture, le sens de ses raies (le long du
  // grand côté) ; parcelOf : la parcelle de chaque case
  prepParcelles() {
    const { cols, rows, cell, t } = this, S = this.seed, C1 = cols + 1, R1 = rows + 1;
    const KL = [T.CHAMP, T.PRE, T.VIGNE, T.VERGER], NK = KL.length + 1;   // (le dernier : tout le reste)
    const sum = new Int32Array(NK * C1 * R1);   // sommes cumulées, par sol
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = KL.indexOf(t[j * cols + i]), kk = k < 0 ? NK - 1 : k;
      for (let q = 0, o = 0; q < NK; q++, o += C1 * R1) sum[o + (j + 1) * C1 + i + 1] = (kk === q) + sum[o + j * C1 + i + 1] + sum[o + (j + 1) * C1 + i] - sum[o + j * C1 + i];
    }
    // [sol dominant, cases d'un autre sol] du rectangle de cases [i0, i1[ × [j0, j1[
    const dom = (i0, j0, i1, j1) => {
      let b = -1, bk = 0;
      for (let q = 0, o = 0; q < NK; q++, o += C1 * R1) { const n = sum[o + j1 * C1 + i1] - sum[o + j0 * C1 + i1] - sum[o + j1 * C1 + i0] + sum[o + j0 * C1 + i0]; if (n > b) { b = n; bk = q; } }
      return [bk, (i1 - i0) * (j1 - j0) - b];
    };
    const out = this.parcelles = [], of = this.parcelOf = new Int32Array(cols * rows).fill(-1);
    const maize = this.epoque.mais && (this.season === 'ete' || this.season === 'automne');
    const leaf = (i0, j0, i1, j1, k) => {
      if (k === NK - 1) return;
      const id = out.length, v = KL[k], h = q => hash(id, q, S);
      // (au bord de la carte, la parcelle déborde : pas de tournière ni de liseré le long du cadre)
      const x = i0 ? i0 * cell : -40, y = j0 ? j0 * cell : -40, x1 = i1 < cols ? i1 * cell : this.W + 40, y1 = j1 < rows ? j1 * cell : this.H + 40;
      const w = x1 - x, hh = y1 - y, long = Math.max(w, hh) >= 1.4 * Math.min(w, hh);
      out.push({
        id, type: v, x, y, w, h: hh, box: [x, y, x1, y1],
        tex: v === T.CHAMP ? (maize && h(16) < 0.5 ? 'mais' : culture(this.season, h(6))) : v === T.PRE ? (h(7) < 0.25 ? 'prairie' : 'pre')
          : v === T.VIGNE ? (this.epoque.foule ? 'vigneFoule' : 'vigne') : 'pre',
        // raies le long de x (0) ou de y : le long du grand côté, au hasard pour un carré
        rot: (long ? hh > w : h(3) < 0.5) ? Math.PI / 2 : 0, off: (h(8) * 4) | 0, tone: (h(5) * 4) | 0,
      });
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) of[j * cols + i] = id;
    };
    const { V, H } = this.bordsClotures;
    const split = (i0, j0, i1, j1, d) => {
      const [k, bad] = dom(i0, j0, i1, j1);
      // la coupe (deux cases au moins de chaque côté) qui laisse le moins de cases d'un autre sol, une haie ou une clôture
      // qui la suit comptant pour un peu plus d'une demi-case ; prise si le rectangle mêle les sols, ou si une haie le
      // traverse (aux trois cinquièmes au moins)
      let bc = Infinity, cut = null, bh = 0;
      const essai = (c, h, span, cv) => { if (c - 0.6 * h < bc) { bc = c - 0.6 * h; cut = cv; bh = h / span; } };
      for (let i = i0 + 2; i <= i1 - 2; i++) { let h = 0; for (let j = j0; j < j1; j++) h += V[i * rows + j]; essai(dom(i0, j0, i, j1)[1] + dom(i, j0, i1, j1)[1], h, j1 - j0, [i, -1]); }
      for (let j = j0 + 2; j <= j1 - 2; j++) { let h = 0; for (let i = i0; i < i1; i++) h += H[j * cols + i]; essai(dom(i0, j0, i1, j)[1] + dom(i0, j, i1, j1)[1], h, i1 - i0, [-1, j]); }
      if (cut && ((bad > (i1 - i0) * (j1 - j0) * 0.12 && bc < bad * 0.8) || (bh >= 0.6 && bc <= bad))) {
        if (cut[0] >= 0) { split(i0, j0, cut[0], j1, d + 1); split(cut[0], j0, i1, j1, d + 1); return; }
        split(i0, j0, i1, cut[1], d + 1); split(i0, cut[1], i1, j1, d + 1); return;
      }
      if (k < NK - 1 && d < 2 && hash(i0 * 7 + j1, j0 * 7 + i1, S + 41) < 0.5) {
        const f = 0.4 + hash(i0, j0, S + 42) * 0.2;
        if (i1 - i0 >= 6 && i1 - i0 >= j1 - j0) { const c = Math.round(i0 + (i1 - i0) * f); leaf(i0, j0, c, j1, k); leaf(c, j0, i1, j1, k); return; }
        if (j1 - j0 >= 6) { const c = Math.round(j0 + (j1 - j0) * f); leaf(i0, j0, i1, c, k); leaf(i0, c, i1, j1, k); return; }
      }
      leaf(i0, j0, i1, j1, k);
    };
    for (let i0 = 0, a = 0; i0 < cols; a++) {
      const i1 = Math.min(cols, i0 + 6 + ((hash(a, 0, S + 43) * 4) | 0));
      for (let j0 = 0, b = 0; j0 < rows; b++) {
        const j1 = Math.min(rows, j0 + 5 + ((hash(a, b, S + 44) * 4) | 0));
        split(i0, j0, i1 > cols - 3 ? cols : i1, j1 > rows - 3 ? rows : j1, 0);
        j0 = j1 > rows - 3 ? rows : j1;
      }
      i0 = i1 > cols - 3 ? cols : i1;
    }
  }
  // haies, murets et clôtures : le moteur les pose sur une rangée de cases, au bord d'un îlot ; on les dessine sur le
  // bord des cases (du côté où le sol change), là où passe la limite des parcelles. bordsClotures : ces bords (V : x =
  // i × 20 m à la ligne j ; H : y = j × 20 m à la colonne i), que prepParcelles suit de préférence
  prepClotures() {
    const { cols, rows, cell, t } = this, V = new Uint8Array((cols + 1) * rows), H = new Uint8Array((rows + 1) * cols);
    const at = (i, j) => t[clamp(j, 0, rows - 1) * cols + clamp(i, 0, cols - 1)];
    this.fences = this.fences.map(f => {
      if (f.pts.length !== 2) return f;
      const [[ax, ay], [bx, by]] = f.pts, vert = Math.abs(ax - bx) < 1, hor = Math.abs(ay - by) < 1;
      if (vert === hor) return f;
      const i = Math.floor(ax / cell), j = Math.floor(ay / cell), n = Math.round(Math.abs(vert ? by - ay : bx - ax) / cell);
      const a = vert ? Math.min(j, Math.floor(by / cell)) : Math.min(i, Math.floor(bx / cell));
      let plus = 0, moins = 0;
      for (let q = a; q <= a + n; q++) {
        const c = vert ? at(i, q) : at(q, j);
        plus += (vert ? at(i + 1, q) : at(q, j + 1)) !== c; moins += (vert ? at(i - 1, q) : at(q, j - 1)) !== c;
      }
      const e = plus >= moins ? 1 : 0, o = (e - 0.5) * cell;   // (le bord des cases : + ou − une demi-case)
      for (let q = a; q <= a + n; q++) if (vert) V[(i + e) * rows + clamp(q, 0, rows - 1)] = 1; else H[(j + e) * cols + clamp(q, 0, cols - 1)] = 1;
      const lo = a * cell, hi = (a + n + 1) * cell;
      return { ...f, pts: vert ? [[ax + o, lo], [ax + o, hi]] : [[lo, ay + o], [hi, ay + o]] };
    });
    this.bordsClotures = { V, H };
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
      else if (v === T.VERGER) {
        // verger : des fruitiers bas en rangs, tous les 10 m (deux par case, quelques manques)
        for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.75]]) if (h(60 + dx * 4) > 0.1)
          list.push({ x: (i + dx) * cell + (h(61 + dx * 4) - 0.5) * 1.5, y: (j + dy) * cell + (h(62 + dx * 4) - 0.5) * 1.5, r: 2.1 + h(63 + dx * 4) * 0.8, ci: (h(64 + dx * 4) * 4) | 0, kind: snow ? 'nu' : 'feuillu' });
      }
      else if (v === T.LANDE && h(2) < 0.12) { n = 1; r0 = 3; r1 = 5; }
      for (let k = 0; k < n; k++) {
        if (v === T.BOIS && h(10 + k) < 0.18) continue;   // clairières
        // dans les bois, le pied un peu plus au sud : la couronne, peinte au-dessus du pied, couvre alors la case
        const r = r0 + h(22 + k * 3) * (r1 - r0);
        let x = (i + 0.08 + h(20 + k * 3) * 0.84) * cell, y = (j + 0.08 + h(21 + k * 3) * 0.84) * cell + (wood(v) ? r * 0.7 : 0);
        // après la loi de 1857, les pins des Landes sont semés en lignes : rangs tous les 6,7 m, un peu de jeu
        if (wood(v) && this.epoque.pinsLignes && this.landesLike()) { x = (i + ((k % 3) + 0.5) / 3) * cell + (h(20 + k * 3) - 0.5) * 1.2; y = (j + ((((k / 3) | 0) % 3) + 0.5) / 3) * cell + (h(21 + k * 3) - 0.5) * 1.2; }
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
      if (v === T.CHAMP && this.parcelles[this.parcelOf[c]]?.tex === 'chaume' && h(70) < 0.07)
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
  // rangs d'arbres le long des chemins creux (SPEC-CARTES C3.3, SPEC-SUITE F9) : un chemin sur deux, d'un côté ou des
  // deux, un chêne tous les 11 m environ, seulement sur prés, champs, landes et vergers. Du décor : les règles (couvert,
  // vue) restent celles des cases, comme pour les arbres isolés
  prepLaneTrees() {
    const S = this.seed, snow = this.pal.neige, ok = new Set([T.PRE, T.CHAMP, T.LANDE, T.VERGER]);
    (this.lanePts || []).forEach((pts, li) => {
      if (pts.length < 3 || hash(li, 101, S) > 0.5) return;
      const sides = hash(li, 102, S) < 0.4 ? [-1, 1] : [hash(li, 103, S) < 0.5 ? -1 : 1];
      for (const side of sides) for (const [k, p] of resample(offsetPts(pts, side * 5.5), 11).entries()) {
        if (hash(k, li * 7 + side, S + 104) < 0.18) continue;   // quelques manques
        if (!ok.has(this.at(p[0], p[1]))) continue;
        this.addTree({ x: p[0] + (hash(k, li, S + 105) - 0.5) * 1.5, y: p[1] + (hash(k, li, S + 106) - 0.5) * 1.5,
                       r: 2.8 + hash(k, li, S + 107) * 1.6, ci: (hash(k, li, S + 108) * 4) | 0, kind: snow ? 'nu' : 'feuillu' });
      }
    });
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
  // altitudes affinées à 5 m par interpolation cubique, puis adoucies : l'ombrage des collines
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
      const k = v === T.PRE || v === T.LANDE || v === T.VERGER ? 1 : v === T.CHAMP || v === T.VIGNE || v === T.MARAIS ? 0.45 : 0;
      if (!k) continue;
      const e = (vnoise(x / 9, y / 9, S + 50) - 0.5) * 1.3 + (vnoise(x / 2.5, y / 2.5, S + 51) - 0.5) * 0.5 + (0.5 - (h[c] - this.hmin) / range) * 0.4;
      const q = (y * W + x) * 4, col = snow ? [186, 200, 222] : e > 0 ? [52, 86, 26] : [214, 196, 110];
      d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2];
      d[q + 3] = 255 * k * (snow ? Math.min(0.1, Math.abs(e) * 0.12) : e > 0 ? Math.min(0.18, e * 0.25) : Math.min(0.16, -e * 0.24));
    }
    g.putImageData(img, 0, 0);
    this.nuances = cv;
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
      else if (v === T.VIGNE || v === T.MARAIS || v === T.VERGER) { col = [150, 200, 120]; a = 60; }
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

  // ------------------------------------------------------------------ ville, routes, ornements, ombrage (une fois)
  // cases de ville : dans le rayon d'une ville (pas d'un village), ou au cœur d'un bâti serré (12 cases bâties au
  // moins sur 7 × 7) ; une région de route (cases) surtout en ville y est pavée
  prepVille() {
    const { cols, rows, cell, t } = this, C1 = cols + 1, S = new Int32Array(C1 * (rows + 1)), u = new Uint8Array(cols * rows);
    const bati = v => v === T.BATI || v === T.MUR || v === T.PORTE || v === T.BRECHE;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) S[(j + 1) * C1 + i + 1] = (bati(t[j * cols + i]) ? 1 : 0) + S[j * C1 + i + 1] + S[(j + 1) * C1 + i] - S[j * C1 + i];
    const tw = this.town && this.town.type !== 'village' ? this.town : null;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = Math.max(0, i - 3), b = Math.max(0, j - 3), c = Math.min(cols, i + 4), d = Math.min(rows, j + 4);
      const n = S[d * C1 + c] - S[b * C1 + c] - S[d * C1 + a] + S[b * C1 + a];
      u[j * cols + i] = n >= 12 || (tw && Math.hypot((i + 0.5) * cell - tw.x, (j + 0.5) * cell - tw.y) < tw.r + 10) ? 1 : 0;
    }
    this.urbain = u;
    for (const r of this.regions) if (r.type === T.ROUTE) r.urb = r.cells.filter(c => u[c]).length * 2 > r.cells.length;
  }
  enVille(x, y) { return this.urbain[clamp(Math.floor(y / this.cell), 0, this.rows - 1) * this.cols + clamp(Math.floor(x / this.cell), 0, this.cols - 1)] === 1; }
  // routes coupées en tronçons : rue pavée en ville, route empierrée ailleurs (royale : plus large, rangs d'ormes)
  prepRoutes() {
    this.routes = [];
    this.roads.forEach((r, k) => {
      const kind = this.roadKinds[k];
      if (kind === 'chemin') return;
      const pts = chaikin(r.map(p => [p[0], p[1]]), 2, false);
      let cur = null;
      for (const p of resample(pts, 4).concat([pts[pts.length - 1]])) {
        const kk = kind === 'rue' || this.enVille(p[0], p[1]) ? 'rue' : kind === 'royale' ? 'royale' : 'route';
        if (!cur || cur.kind !== kk) { const prev = cur && cur.pts[cur.pts.length - 1]; cur = { kind: kk, w: LARGEUR[kk], pts: prev ? [prev] : [] }; this.routes.push(cur); }
        cur.pts.push(p);
      }
    });
    this.routes = this.routes.filter(r => r.pts.length > 1);
    for (const r of this.routes) r.box = boxOf(r.pts, r.w + 10);
    this.pathBox = this.pathPts.map(p => boxOf(p, 8));
    for (const rv of this.riverPts) rv.box = boxOf(rv.pts, rv.w + 40);
  }
  // ce qui est peint au sol le long des tracés : ormes des routes royales, ripisylve et roseaux, buissons des haies,
  // bornes, bottes de paille des chaumes ; points fixés une fois (les tuiles se raccordent)
  prepOrnements() {
    const S = this.seed, snow = this.pal.neige;
    const libre = (x, y) => { const v = this.at(x, y); return v === T.PRE || v === T.CHAMP || v === T.LANDE || v === T.VERGER || v === T.VIGNE || v === T.MARAIS || v === T.SABLE; };
    const loinDe = (x, y, d) => !this.bridges.some(b => Math.hypot(b.x - x, b.y - y) < b.len / 2 + d) && !this.gates.some(b => Math.hypot(b.x - x, b.y - y) < d + 10);
    const pres = (lines, x, y, d) => lines.some(q => distPts(q, x, y) < d);
    const feuille = c => snow ? mix(c, '#8a7a68', 0.75) : c;   // (en hiver, des branches nues)
    this.ormes = [];
    this.routes.forEach((r, ri) => {
      if (r.kind !== 'royale') return;
      for (const side of [-1, 1]) for (const [k, p] of resample(offsetPts(r.pts, side * (r.w / 2 + 5)), 15).entries()) {
        const h = q => hash(k, ri * 4 + side + 2, S + q);
        if (h(140) < 0.08 || !libre(p[0], p[1]) || !loinDe(p[0], p[1], 8)) continue;
        if (pres(this.routes.filter(q => q !== r).map(q => q.pts), p[0], p[1], 12) || pres(this.pathPts, p[0], p[1], 6)) continue;
        this.ormes.push([p[0] + (h(141) - 0.5) * 2, p[1] + (h(142) - 0.5) * 2, 3.2 + h(143), feuille(BOIS[2])]);
      }
    });
    this.ripi = []; this.roseaux = [];
    const routes = [...this.routes.map(r => r.pts), ...this.pathPts];
    this.riverPts.forEach((rv, ri) => {
      const petit = rv.w <= 10;
      for (const side of [-1, 1]) {
        for (const [k, p] of resample(offsetPts(rv.pts, side * (rv.w / 2 + (petit ? 6 : 11))), 10).entries()) {
          const h = q => hash(k, ri * 4 + side + 2, S + q);
          if (h(150) > 0.24 || !libre(p[0], p[1]) || !loinDe(p[0], p[1], 6) || pres(routes, p[0], p[1], 10)) continue;
          this.ripi.push([p[0] + (h(151) - 0.5) * 4, p[1] + (h(152) - 0.5) * 4, (petit ? 2.5 : 3.5) + h(153) * (petit ? 2 : 3.5), feuille(BOIS[(h(154) * 5) | 0])]);
        }
        for (const [k, p] of resample(offsetPts(rv.pts, side * (rv.w / 2 + (petit ? 2.5 : 5))), 3.3).entries()) {
          const h = q => hash(k, ri * 4 + side + 2, S + q), v = this.at(p[0], p[1]);
          if (v === T.ROUTE || v === T.BATI || v === T.MUR || v === T.PORTE || v === T.CHEMIN) continue;
          this.roseaux.push([p[0] + (h(160) - 0.5) * 3, p[1] + (h(161) - 0.5) * 2, snow ? '#9a8f78' : h(162) < 0.5 ? '#6d9a4a' : '#3f6a33']);
        }
      }
    });
    // haies bocagères : un liseré sombre, des boules serrées qui le débordent un peu
    this.haies = this.fencePts.filter(f => f.kind === 'haie').map((f, hi) => ({
      pts: f.pts, box: boxOf(f.pts, 12),
      b: resample(f.pts, 5).map((p, k) => { const h = q => hash(k, hi, S + q); return [p[0] + (h(170) - 0.5) * 2.4, p[1] + (h(171) - 0.5) * 1.6, 2.6 + h(172) * 3.4, feuille(BOIS[(h(173) * 5) | 0])]; }),
    }));
    this.bornes = [];
    for (const r of this.routes) if (r.kind !== 'rue') for (const [k, p] of resample(offsetPts(r.pts, r.w / 2 + 1.6), 70).entries()) if (k) this.bornes.push(p);
    this.bottes = [];
    if (!snow) for (let c = 0; c < this.t.length; c++) {
      const p = this.parcelles[this.parcelOf[c]];
      if (!p || p.tex !== 'chaume' || this.t[c] !== T.CHAMP || hash(p.id, 17, S) > 0.75 || hash(c, 18, S) > 0.1) continue;
      this.bottes.push([(c % this.cols + 0.2 + hash(c, 19, S) * 0.6) * this.cell, (((c / this.cols) | 0) + 0.2 + hash(c, 20, S) * 0.6) * this.cell, 2.3 + hash(c, 21, S) * 0.6]);
    }
  }
  // ombrage des collines (une image à 10 m par pixel, adoucie à l'affichage) : lumière du nord-ouest, les pentes au
  // soleil un peu dorées, celles à l'ombre un peu sombres ; rien sur le plat
  prepOmbrage() {
    const R = 10, w = Math.ceil(this.W / R), h = Math.ceil(this.H / R), cv = canvas(w, h), g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = (x + 0.5) * R, Y = (y + 0.5) * R;
      const gx = (this.fineAt(X + R, Y) - this.fineAt(X - R, Y)) / (2 * R), gy = (this.fineAt(X, Y + R) - this.fineAt(X, Y - R)) / (2 * R);
      const e = (gx + gy) * Math.SQRT1_2, q = (y * w + x) * 4, col = e > 0 ? [255, 246, 210] : [28, 38, 14];
      d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2]; d[q + 3] = 255 * clamp(Math.abs(e) * (e > 0 ? 2.2 : 2.8), 0, e > 0 ? 0.3 : 0.38);
    }
    g.putImageData(img, 0, 0);
    this.ombrage = cv;
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
  // prépare un motif du sol qui manque au rectangle (x0, y0, wm, hm) à s px/m (Sol2D : une chose par image, pas de
  // motif fait au milieu d'une tuile) ; avance : les motifs de toute la carte, tant que la mémoire le permet sans en
  // chasser d'autres. Renvoie true si un motif a été fait
  motif(x0, y0, wm, hm, s, avance = false) {
    const vis = b => !(b[2] < x0 - 20 || b[0] > x0 + wm + 20 || b[3] < y0 - 20 || b[1] > y0 + hm + 20);
    const kinds = avance ? this.kinds : new Set(['herbe', 'eau', 'pave', ...this.parcelles.filter(p => vis(p.box)).map(p => p.tex), ...this.regions.filter(r => vis(r.box)).map(r => r.tex)]);
    const P = Math.max(4, Math.round(periode(s) * s));
    for (const k of kinds) {
      const key = `t|${k}|${s}`, e = this.cache.get(key);
      if (e) { this.cache.delete(key); this.cache.set(key, e); continue; }   // (récemment servi : gardé)
      if (avance && this.cacheBytes + P * P * 4 > this.q.textures) return false;
      this.cached(key, () => texture(k, s, this.pal, this.season));
      return true;
    }
    return false;
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
    const pal = this.pal, snow = pal.neige, x1 = x0 + wm, y1 = y0 + hm;
    const W = () => g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    // mesure facultative du temps de chaque étape (this.prof = {} pour l'activer)
    let tm = performance.now();
    const mark = k => { if (!this.prof) return; const n = performance.now(); this.prof[k] = (this.prof[k] || 0) + n - tm; tm = n; };
    const vis = b => !(b[2] < x0 - 20 || b[0] > x1 + 20 || b[3] < y0 - 20 || b[1] > y1 + 20);
    const inR = (p, m) => p[0] > x0 - m && p[0] < x1 + m && p[1] > y0 - m && p[1] < y1 + m;
    const nv = c => snow ? mix(c, '#e8ecef', 0.72) : c;   // couleurs du sol sous la neige
    const saison = snow ? 'hiver' : this.season;
    g.imageSmoothingEnabled = true;
    W();
    // l'herbe partout d'abord (sous les routes, entre les parcelles)
    g.fillStyle = this.pat(g, 'herbe', s);
    g.fillRect(x0 - 50, y0 - 50, wm + 100, hm + 100);
    // parcelles (maquette, parcelle) : motif de la culture, raies dans le sens de la parcelle, tournières au bout des
    // raies, liseré clair ; l'herbe entre deux parcelles (1,2 m de chaque côté)
    const pats = new Map(), pat = (kind, rot, o) => { const k = kind + rot + o; let p = pats.get(k); if (!p) pats.set(k, p = this.pat(g, kind, s, rot, OFFS[o])); return p; };
    for (const p of this.parcelles) {
      if (!vis(p.box)) continue;
      const x = p.x + 1.2, y = p.y + 1.2, w = p.w - 2.4, h = p.h - 2.4;
      g.fillStyle = pat(p.tex, p.rot, p.off); g.fillRect(x, y, w, h);
      if (p.type === T.CHAMP && !snow) { g.globalAlpha = 0.03 + (p.tone >> 1) * 0.03; g.fillStyle = p.tone & 1 ? '#fff8dc' : '#281e0a'; g.fillRect(x, y, w, h); g.globalAlpha = 1; }
      if (p.type === T.VERGER) continue;
      const c = couleurs(p.tex, saison);
      g.fillStyle = mix(c.base, c.raie || c.base, 0.5);
      if (p.rot) { g.fillRect(x, y, w, 5); g.fillRect(x, y + h - 5, w, 5); } else { g.fillRect(x, y, 5, h); g.fillRect(x + w - 5, y, 5, h); }
      if (s >= 1) { g.strokeStyle = snow ? 'rgba(255,255,255,.35)' : 'rgba(245,235,200,.3)'; g.lineWidth = 1.4; g.strokeRect(x + 0.7, y + 0.7, w - 1.4, h - 1.4); }
    }
    mark('parcelles');
    // landes, bois, sables, cours… : motif du sol dans le contour de la région
    for (const r of this.regions) {
      if (!vis(r.box)) continue;
      const v = r.type;
      if (v === T.EAU || v === T.GUE || v === T.CHEMIN) continue;   // l'eau plus bas ; les chemins sur l'herbe
      if (v === T.ROUTE) { if (r.urb) { g.fillStyle = this.pat(g, 'pave', s); g.fill(r.path); } continue; }
      g.fillStyle = this.pat(g, r.tex, s, 0, r.off); g.fill(r.path);
      // (un trait du même motif couvre le liseré d'anticrénelage entre deux régions voisines)
      g.strokeStyle = g.fillStyle; g.lineWidth = 1.5 / s; g.stroke(r.path);
    }
    mark('sols');
    g.drawImage(this.nuances, 0, 0, this.W, this.H);
    this.paintCells(g, x0, y0, wm, hm, s, snow);
    for (const b of this.bottes) if (inR(b, 4)) botte(g, b[0], b[1], b[2]);
    mark('cases');
    // eau : étangs et cases d'eau (berge, bord profond), puis les rivières, couche par couche
    g.lineCap = 'round'; g.lineJoin = 'round';
    const eau = this.pat(g, 'eau', s), profond = snow ? '#4f6f86' : '#355f97';
    const eaux = this.regions.filter(r => (r.type === T.EAU || r.type === T.GUE) && vis(r.box));
    for (const r of eaux) { g.strokeStyle = nv('#4b7438'); g.lineWidth = 6; g.stroke(r.path); }
    for (const r of eaux) {
      g.fillStyle = eau; g.fill(r.path);
      g.save(); g.clip(r.path);
      if (r.type === T.GUE) { g.strokeStyle = 'rgba(190,175,130,.7)'; g.lineWidth = 30; } else { g.strokeStyle = profond; g.lineWidth = 7; }
      g.stroke(r.path); g.restore();
    }
    const rivs = this.riverPts.filter(rv => vis(rv.box));
    const couches = [[w => w > 10 ? w + 27 : 0, nv('#557f3e')], [w => w > 10 ? w + 15 : w * 2.1, nv('#4b7438')], [w => w > 10 ? w + 8 : w * 1.1, profond], [w => w > 10 ? w : w * 0.75, eau]];
    for (const [f, c] of couches) { g.strokeStyle = c; for (const rv of rivs) { const lw = f(rv.w); if (lw) { g.lineWidth = lw; strokePts(g, rv.pts); } } }
    if (s >= 1) {
      g.strokeStyle = 'rgba(160,195,235,.45)';
      for (const rv of rivs) {
        g.lineWidth = rv.w > 10 ? 1.1 : 0.7; g.setLineDash(rv.w > 10 ? [2.5, 11, 1.2, 9] : [1.6, 8, 0.8, 6]);
        strokePts(g, rv.pts); if (rv.w > 10) { g.lineDashOffset = 9; strokePts(g, offsetPts(rv.pts, rv.w * 0.2)); g.lineDashOffset = 0; }
      }
      g.setLineDash([]);
      // gués : pierres dans l'eau claire
      for (const r of eaux) {
        if (r.type !== T.GUE) continue;
        for (const c of r.cells) for (let k = 0; k < 6; k++) {
          const x = (c % this.cols + hash(c, k, 3)) * this.cell, y = (((c / this.cols) | 0) + hash(c, k, 4)) * this.cell, rr = 0.8 + hash(c, k, 5) * 1.2;
          g.fillStyle = 'rgba(40,50,50,0.3)'; g.beginPath(); g.arc(x + 0.4, y + 0.3, rr, 0, TAU); g.fill();
          g.fillStyle = 'rgba(150,140,118,0.85)'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
        }
      }
    }
    // roseaux et ripisylve
    for (const p of this.roseaux) if (inR(p, 1)) C(g, p[2], p[0], p[1], 0.6);
    touffes(g, this.ripi.filter(p => inR(p, 10)), snow);
    mark('eau');
    // chemins de terre : terre battue, raie d'herbe tiretée au milieu
    const chemins = this.pathPts.filter((p, k) => vis(this.pathBox[k]));
    g.strokeStyle = nv('#c9b98e'); g.lineWidth = 6; for (const p of chemins) strokePts(g, p);
    g.strokeStyle = nv('#d9caa1'); g.lineWidth = 5; for (const p of chemins) strokePts(g, p);
    if (s >= 1) { g.setLineDash([3.5, 3]); g.strokeStyle = nv('#bba981'); g.lineWidth = 0.9; for (const p of chemins) strokePts(g, p); g.setLineDash([]); }
    // routes empierrées (XVIIIe s.) : fossés, accotements herbus, chaussée de cailloutis bombée, ornières
    const rs = this.routes.filter(r => r.kind !== 'rue' && vis(r.box));
    for (const [dw, k, c] of [[7, 1, '#5b7f3f'], [4, 1, '#7d9c55'], [0, 1, '#ad9a70'], [0, 0.8, '#c6b388'], [0, 0.3, '#d3c299']]) {
      g.strokeStyle = nv(c); for (const r of rs) { g.lineWidth = r.w * k + dw; strokePts(g, r.pts); }
    }
    g.strokeStyle = 'rgba(120,96,60,.5)';
    for (const r of rs) { g.lineWidth = r.w * 0.09; strokePts(g, offsetPts(r.pts, -r.w * 0.24)); strokePts(g, offsetPts(r.pts, r.w * 0.24)); }
    if (s >= 2 && !snow) this.gravier(g, rs, x0, y0, x1, y1);
    for (const p of this.bornes) if (inR(p, 2)) { C(g, OMB, p[0] + 0.5, p[1] + 0.7, 0.9); C(g, '#ebe5d6', p[0], p[1], 0.8); C(g, '#c9c0aa', p[0], p[1], 0.35); }
    // rues pavées des villes : pavés de grès en rangs, caniveau au milieu
    const rues = this.routes.filter(r => r.kind === 'rue' && vis(r.box));
    g.strokeStyle = '#8b826e'; for (const r of rues) { g.lineWidth = r.w + 1.4; strokePts(g, r.pts); }
    g.strokeStyle = nv('#a69d88'); for (const r of rues) { g.lineWidth = r.w; strokePts(g, r.pts); }
    if (s >= 2) {
      g.setLineDash([0.9, 0.45]); g.strokeStyle = 'rgba(80,72,58,.35)'; g.lineWidth = 0.7;
      for (const r of rues) for (let o = -r.w / 2 + 0.8; o < r.w / 2 - 0.4; o += 1.2) { g.lineDashOffset = o * 3.3; strokePts(g, offsetPts(r.pts, o)); }
      g.setLineDash([]); g.lineDashOffset = 0;
    }
    g.strokeStyle = '#776f5e'; g.lineWidth = 0.6; for (const r of rues) strokePts(g, r.pts);
    // ormes des routes royales (les ponts : le décor, decor2d.js)
    touffes(g, this.ormes.filter(p => inR(p, 8)), snow);
    mark('routes');
    // fossés et glacis des remparts, haies, pied des murets et clôtures (debout : le décor)
    this.paintWalls(g);
    const haies = this.haies.filter(h => vis(h.box));
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(20,32,12,.35)'; g.lineWidth = 5.5; for (const h of haies) { g.save(); g.translate(1.6, 2.2); strokePts(g, h.pts); g.restore(); }
    g.strokeStyle = snow ? '#5a5444' : '#2c5628'; g.lineWidth = 4.2; for (const h of haies) strokePts(g, h.pts);
    touffes(g, haies.flatMap(h => h.b.filter(p => inR(p, 9))), snow);
    this.paintFences(g);
    // collines : l'ombrage par-dessus tout ce qui est au sol
    g.drawImage(this.ombrage, 0, 0, this.W, this.H);
    mark('debout');
  }
  // cailloutis et flaques des routes empierrées (de près)
  gravier(g, rs, x0, y0, x1, y1) {
    const S = this.seed, paths = [new Path2D(), new Path2D()];
    rs.forEach((r, ri) => {
      const p = r.pts, w = r.w;
      for (let i = 1; i < p.length; i++) {
        const [ax, ay] = p[i - 1], [bx, by] = p[i];
        if (Math.max(ax, bx) < x0 - w || Math.min(ax, bx) > x1 + w || Math.max(ay, by) < y0 - w || Math.min(ay, by) > y1 + w) continue;
        const l = Math.hypot(bx - ax, by - ay); if (!l) continue;
        const ux = (bx - ax) / l, uy = (by - ay) / l;
        for (let t = 0, n = 0; t < l; t += 1.6, n++) for (let k = 0; k < 2; k++) {
          const h = q => hash(i * 8 + n * 2 + k, ri, S + q), o = (h(1) - 0.5) * w * 0.85, x = ax + ux * t - uy * o, y = ay + uy * t + ux * o, rr = 0.18 + h(2) * 0.22;
          const P = paths[h(3) < 0.5 ? 0 : 1]; P.moveTo(x + rr, y); P.arc(x, y, rr, 0, TAU);
          if (k === 0 && h(4) < 0.006) E(g, 'rgba(110,130,140,.45)', ax + ux * t - uy * w * 0.2, ay + uy * t + ux * w * 0.2, w * 0.14, w * 0.07, Math.atan2(uy, ux));
        }
      }
    });
    g.fillStyle = '#a8946a'; g.fill(paths[0]); g.fillStyle = '#e0d2ab'; g.fill(paths[1]);
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
  // emprise d'un bâtiment : coins au sol, dans l'ordre
  corners(b) {
    const ca = Math.cos(b.a || 0), sa = Math.sin(b.a || 0), w = b.w / 2, h = b.h / 2;
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [b.x + u * ca - v * sa, b.y + u * sa + v * ca]);
  }
  // au pied des enceintes (debout : decor2d.js) : fossé et glacis des remparts (hors des brèches), terre remuée et fond
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
  // pied des murets et clôtures (debout : le décor), un peu assombri
  paintFences(g) {
    const snow = this.pal.neige;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = snow ? 'rgba(50,60,90,0.18)' : 'rgba(20,34,12,0.25)'; g.lineWidth = 1.4;
    for (const f of this.fencePts) if (f.kind !== 'haie') strokePts(g, f.pts);
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
  // (Sol2D.invalidate repeint ses tuiles, le décor l'enceinte)
  addBreach([wi, x, y, r]) {
    const w = this.walls[wi];
    if (!w) return;
    (w.breach = w.breach || []).push([x, y, r]);
    const m = r + 40, x0 = x - m, y0 = y - m;
    const cv = this.paintCanvas(x0, y0, 2 * m, 2 * m, BASE);
    this.base.getContext('2d').drawImage(cv, x0 * BASE, y0 * BASE);
    cv.width = cv.height = 0;
  }
  // tués, chevaux, trous d'obus : ceux qui tombent sur le sol découvert (Sol2D.stamp les peint)
  addDecals(list) { return list.filter(d => this.bare(d.x, d.y)); }
  dispose() {
    for (const e of this.cache.values()) { const cv = e.cv || e; cv.width = cv.height = 0; }
    this.cache.clear(); this.cacheBytes = 0;
    for (const cv of [this.base, this.nuances, this.ombrage, this.coverImg]) if (cv) cv.width = cv.height = 0;
  }
}

// ------------------------------------------------------------------ dessins de la maquette (vus de haut, en mètres)
const LARGEUR = { royale: 11, route: 8, rue: 8 };   // chaussée (m), sans fossés
const OFFS = [[0, 0], [23, 61], [51, 17], [77, 89]];   // décalages du motif d'une parcelle à l'autre (m)
const OMB = 'rgba(20,32,12,.42)';                   // ombre portée des arbres, bottes, bornes
function C(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function E(g, c, x, y, rx, ry, r = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, r, 0, TAU); g.fill(); }
function boxOf(pts, m) {
  const b = [1e9, 1e9, -1e9, -1e9];
  for (const p of pts) { b[0] = Math.min(b[0], p[0] - m); b[1] = Math.min(b[1], p[1] - m); b[2] = Math.max(b[2], p[0] + m); b[3] = Math.max(b[3], p[1] + m); }
  return b;
}
// distance de (x, y) à une ligne brisée
function distPts(pts, x, y) {
  let d = 1e9;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const u = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
    d = Math.min(d, Math.hypot(ax + dx * u - x, ay + dy * u - y));
  }
  return d;
}
// houppiers ronds [x, y, r, couleur] : les ombres, puis les houppiers, puis les reflets ; les arbres se recouvrent
// proprement (une passe par couleur)
function touffes(g, pts, snow) {
  if (!pts.length) return;
  const sh = new Path2D(), hi = new Path2D(), byC = new Map();
  for (const [x, y, r, c] of pts) {
    sh.moveTo(x + 2 + r, y + 2.6); sh.arc(x + 2, y + 2.6, r, 0, TAU);
    hi.moveTo(x - r * 0.32 + r * 0.5, y - r * 0.34); hi.arc(x - r * 0.32, y - r * 0.34, r * 0.5, 0, TAU);
    let p = byC.get(c); if (!p) byC.set(c, p = new Path2D());
    p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU);
  }
  g.fillStyle = OMB; g.fill(sh);
  for (const [c, p] of byC) { g.fillStyle = c; g.fill(p); }
  g.globalAlpha = snow ? 0.55 : 0.26; g.fillStyle = snow ? '#f4f6f8' : '#a5cf7f'; g.fill(hi); g.globalAlpha = 1;
}
function botte(g, x, y, r) {
  E(g, OMB, x + 1.2, y + 1.6, r, r * 0.9); C(g, '#d6ba5c', x, y, r);
  g.strokeStyle = '#b49841'; g.lineWidth = 0.45; g.beginPath(); g.arc(x, y, r * 0.62, 0, TAU); g.stroke(); C(g, '#c2a54a', x, y, r * 0.25);
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
// points tous les step m le long d'une ligne brisée (la distance court d'un segment à l'autre)
export function resample(pts, step) {
  const out = [];
  let u = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k], L = Math.hypot(bx - ax, by - ay);
    for (; u < L; u += step) out.push([ax + (bx - ax) * u / L, ay + (by - ay) * u / L]);
    u -= L;
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
    // cratère (maquette, cratere, en plus petit : un boulet creuse moins d'un mètre) : terre un peu noircie autour,
    // quelques mottes, entonnoir sombre
    const r = (d.r || 2.6) * 0.45, h = q => hash(d.x * 10 | 0, d.y * 10 | 0, q);
    g.fillStyle = 'rgba(60,42,22,.14)'; el(0, 0, r * 2, r * 1.7);
    for (let i = 0; i < 6; i++) {
      const a = h(i) * TAU, e = r * (1.3 + h(i + 20) * 1.2), m = r * (0.12 + h(i + 60) * 0.2);
      g.fillStyle = h(i + 40) < 0.5 ? '#7a5f42' : '#5e4730'; el(Math.cos(a) * e, Math.sin(a) * e, m, m);
    }
    g.fillStyle = '#5a4330'; el(0, 0, r, r);
    g.fillStyle = '#3b2b1d'; el(r * 0.12, r * 0.15, r * 0.55, r * 0.55);
  } else if (d.k === 'chapeau') {
    // débris (SPEC-SUITE F8) : un chapeau tombé, sa cocarde
    g.fillStyle = 'rgba(30,20,15,0.25)'; el(0.06, 0.05, 0.32, 0.22);
    g.fillStyle = '#1f1b18'; el(0, 0, 0.3, 0.2);
    g.fillStyle = '#c9b06a'; el(0.12, -0.05, 0.05, 0.05);
  } else if (d.k === 'fusil') {
    g.strokeStyle = 'rgba(30,20,15,0.3)'; g.lineWidth = 0.12; g.lineCap = 'round'; g.beginPath(); g.moveTo(-0.7, 0.06); g.lineTo(0.75, 0.06); g.stroke();
    g.strokeStyle = '#4a3420'; g.lineWidth = 0.09; g.beginPath(); g.moveTo(-0.72, 0); g.lineTo(0.2, 0); g.stroke();
    g.strokeStyle = '#7d7f80'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(0.2, 0); g.lineTo(0.78, 0); g.stroke();
  } else if (d.k === 'sac') {
    g.fillStyle = 'rgba(30,20,15,0.25)'; g.fillRect(-0.2, -0.13, 0.46, 0.34);
    g.fillStyle = '#7a5e3c'; g.fillRect(-0.24, -0.17, 0.44, 0.32);
    g.fillStyle = '#e4ddcc'; g.fillRect(-0.24, -0.04, 0.44, 0.04);
  } else if (d.k === 'roue') {
    // roue brisée près d'une pièce : jante ouverte, quelques rayons
    g.strokeStyle = '#4a3420'; g.lineWidth = 0.1; g.beginPath(); g.arc(0, 0, 0.6, 0.6, TAU - 0.4); g.stroke();
    g.lineWidth = 0.06; g.beginPath();
    for (let k = 0; k < 5; k++) { const a = 1 + k * 1.05; g.moveTo(0, 0); g.lineTo(Math.cos(a) * 0.6, Math.sin(a) * 0.6); }
    g.stroke(); g.fillStyle = '#2c2c2a'; el(0, 0, 0.1, 0.1);
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
