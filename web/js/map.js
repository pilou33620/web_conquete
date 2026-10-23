// Rendu de la carte illustrée de l'Aquitaine (canvas 2D, coordonnées monde en km)
import { Ambient, locomotive, voiture } from './ambient.js';
import { clamp, hexRgb } from './battle/formes.js';
import { TownArt } from './towns.js';
import { UnitArt } from './battle/unites.js';
import { profil } from './battle/qualite.js';
import { uniform } from './battle/formes.js';
import { figureKind, portraitGeneral } from './portraits.js';
import { Epoque, phylloxera, styleCarte, startTechs, startRails } from './epoque.js';
const TILE = 256;
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgb(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
// niveaux de détail des tuiles (pixels par km) : une échelle fine, pour qu'une tuile ne soit jamais beaucoup
// réduite à l'écran (sinon il en faut des centaines pour couvrir un grand écran d'iPad)
const LEVELS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const T = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
// teintes du terrain, comme la carte de campagne d'Ultimate General : herbe olive et dorée, sous-bois sombre,
// landes ocre ; l'hiver, du givre en plaine et de la neige en montagne ; l'automne, des prés roussis
const TCOL = {
  0: [40, 108, 118], 1: [72, 140, 146], 2: [156, 156, 76], 3: [78, 94, 44], 4: [160, 146, 88], 5: [104, 124, 82],
  6: [150, 148, 76], 7: [134, 128, 100], 8: [226, 228, 224], 9: [216, 200, 148], 10: [150, 144, 72],
};
const GIVRE = [198, 200, 190], NEIGE = [238, 240, 242], ROUX = [176, 140, 72];
function teinte(t, saison) {
  const c = TCOL[t];
  if (saison === 'hiver') return t === T.MONTAGNE || t === T.HAUTE ? mix(c, NEIGE, t === T.HAUTE ? 1 : 0.75) : t === T.FORET ? mix(c, [70, 76, 62], 0.5) : mix(c, GIVRE, 0.55);
  if (saison === 'automne') return t === T.FORET ? mix(c, [96, 82, 40], 0.4) : t <= T.EAU ? c : mix(c, ROUX, 0.28);
  return c;
}
// les cartes d'époque (SPEC-SUITE H3) : papier, lavis et encre. Cassini sobre (bois verts, le reste au papier) ;
// l'état-major aux couleurs de ses minutes au 1/40 000 (bois vert-jaune, vignes lie-de-vin, eaux bleues)
const PAPIER = {
  cassini: { papier: [234, 224, 196], mer: [212, 218, 204], merLarge: [222, 224, 206], ligne: [88, 114, 128], encre: [58, 46, 32],
    hach: [104, 76, 48], bois: 'rgba(150,170,112,0.92)', pins: 'rgba(122,142,96,0.95)', vigne: 'rgba(120,96,70,0.16)',
    t: { 1: [192, 208, 202], 3: [184, 192, 148], 4: [228, 216, 180], 5: [208, 216, 198], 9: [234, 220, 180], 10: [228, 214, 188] } },
  etatmajor: { papier: [240, 233, 214], mer: [184, 208, 214], merLarge: [200, 218, 220], ligne: [62, 104, 136], encre: [40, 36, 34],
    hach: [72, 62, 52], bois: 'rgba(184,198,108,0.92)', pins: 'rgba(150,170,96,0.95)', vigne: 'rgba(168,100,146,0.36)',
    t: { 1: [164, 198, 212], 3: [204, 212, 150], 4: [232, 224, 190], 5: [190, 214, 204], 9: [238, 224, 178], 10: [236, 224, 216] } },
};
// relief : altitude de départ de chaque terrain, lissée ensuite (plaines basses, coteaux, montagnes)
const BASEH = [0, 0, 0.12, 0.2, 0.08, 0.02, 0.48, 1.0, 1.65, 0.32, 0.24];
const RL = 2;   // la couche des terres est peinte à 2 pixels par km : un relief ombré plus net
// flou en boîte séparable (rayon r), sur place
function boxBlur(f, W, H, r) {
  const tmp = new Float32Array(f.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < W) { s += f[j * W + ii]; n++; } }
    tmp[j * W + i] = s / n;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < H) { s += tmp[jj * W + i]; n++; } }
    f[j * W + i] = s / n;
  }
}
const PLAYABLE = ['33', '24', '40', '47', '64'];

// segments [[x, y, clé], [x, y, clé]] des carrés marchants, raboutés en lignes continues ([[x, y], …]) : des
// milliers de bouts séparés, chacun à extrémités rondes, coûtaient la moitié du rendu (4 traits par frontière)
export function chainSegments(segs) {
  const adj = new Map(), used = new Uint8Array(segs.length), lines = [];
  segs.forEach(([p, q], s) => { for (const k of [p[2], q[2]]) { const l = adj.get(k); if (l) l.push(s); else adj.set(k, [s]); } });
  const walk = (s, from) => {
    let [p, q] = segs[s];
    if (p[2] !== from) [p, q] = [q, p];
    const line = [[p[0], p[1]]];
    lines.push(line);
    for (;;) {
      used[s] = 1; line.push([q[0], q[1]]);
      s = adj.get(q[2]).find(t => !used[t]);
      if (s === undefined) return;
      q = segs[s][0][2] === q[2] ? segs[s][1] : segs[s][0];
    }
  };
  // d'abord les lignes ouvertes (là où le tracé sort des départements jouables), puis les boucles
  for (const [k, l] of adj) if (l.length === 1 && !used[l[0]]) walk(l[0], k);
  for (let s = 0; s < segs.length; s++) if (!used[s]) walk(s, segs[s][0][2]);
  return lines;
}
// les lignes en morceaux de 48 pas, avec leur emprise : chaque tuile ne trace que les morceaux qui la traversent
export function lineChunks(lines) {
  const out = [];
  for (const l of lines) for (let a = 0; a < l.length - 1; a += 48) {
    const pts = l.slice(a, a + 49), p = new Path2D();
    pts.forEach(([x, y], k) => (k ? p.lineTo(x, y) : p.moveTo(x, y)));
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    out.push({ p, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  return out;
}

function b64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function hash(i, j, k = 0) {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// éclaircir / assombrir une couleur : mis en cache, appelés pour chaque bloc de régiment à chaque image
const shadeCache = new Map();
function shade(h, t, to) {
  const k = h + to + t;
  let v = shadeCache.get(k);
  if (v === undefined) { v = rgb(mix(hexRgb(h), to ? [255, 255, 255] : [0, 0, 0], t)); if (shadeCache.size > 500) shadeCache.clear(); shadeCache.set(k, v); }
  return v;
}
function lighten(h, t) { return shade(h, t, 1); }
function darken(h, t) { return shade(h, t, 0); }
// arme d'un type de régiment ('inf', 'cavalerie', 'artillerie') et ordre dispersé, d'après les règles (repli pour les anciennes règles)
export const unitCls = (rules, t) => rules.units[t]?.cls || (t === 'cavalerie' || t === 'artillerie' ? t : 'inf');
export const unitLight = (rules, t) => rules.units[t]?.light ?? t === 'legere';
const CLS_ORDER = { inf: 0, cavalerie: 1, artillerie: 2 };
const TYPE_DOT = { ligne: '#f1ead8', legere: '#bfe39a', grenadiers: '#9fb8e8', chasseurs: '#7fd6b0', sapeurs: '#d6a878', garde: '#f0b8c8', cavalerie: '#e6c97f', artillerie: '#ff9a7a' };

export class MapView {
  constructor(canvas, payload) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    const m = payload.map;
    this.rules = payload.rules;
    this.m = m;
    this.W = m.W; this.H = m.H;
    this.terrain = b64(m.terrain); this.dept = b64(m.dept); this.cellnode = b64(m.cellnode); this.river = b64(m.river);
    this.nodes = m.nodes; this.edges = m.edges;
    this.depts = m.depts; this.deptCodes = m.dept_codes;
    this.cam = { x: m.W / 2, y: m.H / 2, z: 2 };
    this.camAnim = null;
    this.tiles = new Map();       // tuiles détaillées, de la moins récemment vue à la plus récente
    this.baseTiles = new Map();   // tuiles du niveau le plus bas : jamais évincées, elles servent de fond de secours
    this.tileLimit = 160;
    this.tileGen = 0;             // génération des territoires peints dans les tuiles
    this.pool = [];               // canevas des tuiles évincées, à réutiliser
    this.frameNo = 0;
    this.curL = 0;                // niveau affiché (figé pendant un pincement ou un zoom animé)
    this.zoomT = 0;               // dernier changement de zoom
    this.lastZ = 0;
    this.state = null;
    this.owners = null;
    this.ownersKey = '';
    this.selection = null;
    this.disp = new Map();
    this.particles = [];
    this.twCache = new Map();   // largeurs des étiquettes, par police et texte
    this.wallCache = new Map();   // tracés des remparts, par niveau, taille, brèche et ville
    // les polices du web arrivent après les premiers dessins : les largeurs mesurées avant sont fausses
    try { document.fonts?.addEventListener?.('loadingdone', () => this.twCache.clear()); } catch (e) { /* API absente */ }
    this.wx = { cote: [], interieur: [], montagne: [] };
    this.flash = { cote: 0, interieur: 0, montagne: 0 };
    this.season = 'printemps';
    this.highlightDept = null;
    this.fogOn = true;
    try { this.fogOn = localStorage.getItem('conquete.fog') !== '0'; } catch (e) { /* stockage indisponible */ }
    this.colors = {};
    for (const [c, f] of Object.entries(this.rules.factions)) this.colors[c] = f.color;
    this.colors.neutre = this.rules.neutral_color;
    this.epoque = new Epoque(this);   // la carte selon l'époque (epoque.js)
    // style de la carte (SPEC-SUITE H3) : « ugar » (à la manière d'Ultimate General) ou « epoque » (Cassini, puis état-major)
    this.style = 'ugar';
    try { if (localStorage.getItem('conquete.carte.style') === 'epoque') this.style = 'epoque'; } catch (e) { /* stockage indisponible */ }
    this.playable = new Uint8Array(this.W * this.H);
    for (let c = 0; c < this.W * this.H; c++) {
      const d = this.dept[c];
      this.playable[c] = d > 0 && PLAYABLE.includes(this.deptCodes[d - 1]) && this.terrain[c] > 1 ? 1 : 0;
    }
    this.prepEdges();
    this.buildBases();
    this.buildLandPath();
    this.buildProxy();
    this.buildFieldCells();
    this.buildWaterNames();
    this.ambient = new Ambient(this);
    this.towns = new TownArt(this);
    this.fillCanvas = document.createElement('canvas');
    this.frontiers = [];
    this.showPreview();
    this.lastFrame = performance.now();
    this.resize();
    for (let ty = 0; ty * 128 < this.H; ty++) for (let tx = 0; tx * 128 < this.W; tx++) this.getTile(LEVELS[0], tx, ty, true);
    this.fitAll(true);
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    requestAnimationFrame(t => this.frame(t));
  }

  // largeur d'un texte dans la police courante du contexte (mise en cache)
  textW(ctx, txt) {
    const k = ctx.font + '|' + txt;
    let w = this.twCache.get(k);
    if (w === undefined) { w = ctx.measureText(txt).width; if (this.twCache.size > 3000) this.twCache.clear(); this.twCache.set(k, w); }
    return w;
  }

  // ------------------------------------------------------------------ préparation
  prepEdges() {
    // chaque arête est une polyligne : voie d'eau le long du fleuve ou de la côte, route le long de son tracé
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      e.A = [A.x, A.y]; e.B = [B.x, B.y];
      e.water = e.kind === 'water';
      e.cum = [0];
      for (let i = 1; i < e.pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]));
      const xs = e.pts.map(q => q[0]), ys = e.pts.map(q => q[1]);
      e.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (e.water) continue;
      e.path = new Path2D();
      e.pts.forEach((q, k) => k ? e.path.lineTo(q[0], q[1]) : e.path.moveTo(q[0], q[1]));
      if (e.bx != null) {    // le pont suit le segment du tracé qui franchit l'eau
        let best = 1e9;
        for (let i = 1; i < e.pts.length; i++) {
          const [p, q] = [e.pts[i - 1], e.pts[i]], d = Math.hypot((p[0] + q[0]) / 2 - e.bx, (p[1] + q[1]) / 2 - e.by);
          if (d < best) { best = d; e.bang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
        }
      }
    }
    // voies navigables découpées en tronçons avec leur emprise : chaque tuile ne trace que ce qui la traverse
    this.wayPaths = [];
    for (const w of this.m.ways || []) {
      for (let i = 0; i < w.pts.length - 1; i += 8) {
        const seg = w.pts.slice(i, i + 9);
        const p = new Path2D();
        seg.forEach((q, k) => k ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]));
        const xs = seg.map(q => q[0]), ys = seg.map(q => q[1]);
        this.wayPaths.push({ sea: w.sea, p, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      }
    }
  }
  polySeg(e, t) {
    const total = e.cum[e.cum.length - 1] || 1, s = clamp(t, 0, 1) * total;
    let i = 1;
    while (i < e.cum.length - 1 && e.cum[i] < s) i++;
    const seg = (e.cum[i] - e.cum[i - 1]) || 1e-9, f = (s - e.cum[i - 1]) / seg;
    const p = e.pts[i - 1], q = e.pts[i];
    return [[p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], [q[0] - p[0], q[1] - p[1]]];
  }
  edgePoint(e, t) { return this.polySeg(e, t)[0]; }
  edgeTangent(e, t) { return this.polySeg(e, t)[1]; }
  pointFrom(e, frm, f) { return this.edgePoint(e, frm === e.a ? f : 1 - f); }

  buildBases() {
    const W = this.W, H = this.H, N = W * H;
    // distance à la côte côté mer
    // distance à la côte côté mer : chanfrein en deux passes (diagonales comprises), proche de la vraie distance,
    // puis lissée ; une simple distance en croix dessinait des marches en escalier dans le dégradé de l'océan
    const big = 1e4, df = new Float32Array(N);
    for (let c = 0; c < N; c++) df[c] = this.terrain[c] !== T.OCEAN ? 0 : big;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (!df[c]) continue;
      let v = df[c];
      if (i > 0) v = Math.min(v, df[c - 1] + 1);
      if (j > 0) { v = Math.min(v, df[c - W] + 1); if (i > 0) v = Math.min(v, df[c - W - 1] + 1.414); if (i < W - 1) v = Math.min(v, df[c - W + 1] + 1.414); }
      df[c] = v;
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      const c = j * W + i;
      if (!df[c]) continue;
      let v = df[c];
      if (i < W - 1) v = Math.min(v, df[c + 1] + 1);
      if (j < H - 1) { v = Math.min(v, df[c + W] + 1); if (i < W - 1) v = Math.min(v, df[c + W + 1] + 1.414); if (i > 0) v = Math.min(v, df[c + W - 1] + 1.414); }
      df[c] = v;
    }
    const dsm = new Float32Array(N);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let sum = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < W && jj < H) { sum += Math.min(40, df[jj * W + ii]); n++; }
      }
      dsm[j * W + i] = sum / n;
    }
    this.oceanDist = df;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    this.oceanCanvas = mk(W, H);
    this.oceanDsm = dsm;
    this.paintOcean();
    // altitude lissée, avec un peu de détail (plus dans les reliefs)
    const hf = new Float32Array(N);
    for (let c = 0; c < N; c++) hf[c] = BASEH[this.terrain[c]] ?? 0.1;
    for (let k = 0; k < 3; k++) boxBlur(hf, W, H, 2);
    for (let c = 0; c < N; c++) {
      if (this.terrain[c] <= T.EAU) continue;
      const i = c % W, j = (c / W) | 0;
      hf[c] += (vnoise(i / 4, j / 4, 21) - 0.5) * (0.05 + hf[c] * 0.45) + (vnoise(i / 1.6, j / 1.6, 22) - 0.5) * (0.02 + hf[c] * 0.16);
    }
    this.hgt = hf;
    this.landCanvas = mk(W * RL, H * RL);
    this.paintLand();
    // grain de papier
    this.grain = document.createElement('canvas');
    this.grain.width = this.grain.height = 128;
    const gctx = this.grain.getContext('2d');
    const gd = gctx.createImageData(128, 128);
    for (let k = 0; k < 128 * 128; k++) {
      const v = 205 + hash(k, 77) * 50;
      gd.data.set([v, v, v * 0.97, 255], k * 4);
    }
    gctx.putImageData(gd, 0, 0);
  }

  // mer turquoise, claire sur les hauts-fonds, profonde au large (ou lavis pâle des cartes d'époque)
  paintOcean() {
    const N = this.W * this.H, dsm = this.oceanDsm, P = PAPIER[this.styleEra()];
    const g = this.oceanCanvas.getContext('2d'), O = g.createImageData(this.W, this.H);
    const shallow = P ? P.mer : [70, 150, 148], deep = P ? P.merLarge : [28, 88, 108];
    for (let c = 0; c < N; c++) {
      const oc = this.terrain[c] === T.OCEAN ? mix(shallow, deep, Math.min(1, Math.max(0, dsm[c] - 0.6) / 18)) : shallow;
      O.data.set([oc[0], oc[1], oc[2], 255], c * 4);
    }
    g.putImageData(O, 0, 0);
  }

  // style de carte en vigueur : null (Ultimate General), 'cassini' ou 'etatmajor' (d'après l'année de la partie)
  styleEra() { return styleCarte(this.style, this.epoque.year); }

  setStyle(v) {
    this.style = v === 'epoque' ? 'epoque' : 'ugar';
    try { localStorage.setItem('conquete.carte.style', this.style); } catch (e) { /* stockage indisponible */ }
    this.repaint();
  }

  // tout ce que le style peint dans les couches et les tuiles
  repaint() { this.paintOcean(); this.paintLand(); this.invalidateTiles(); this.vig = null; }

  // couleur des terres, ombrées par un soleil du nord-ouest (repeinte quand la saison change)
  paintLand() {
    const P = PAPIER[this.era = this.styleEra()];
    const W = this.W, H = this.H, hf = this.hgt, R = RL, WR = W * R, HR = H * R;
    const g = this.landCanvas.getContext('2d'), img = g.createImageData(WR, HR), data = img.data;
    const hAt = (x, y) => {
      const u = clamp(x - 0.5, 0, W - 1.001), v = clamp(y - 0.5, 0, H - 1.001), i = u | 0, j = v | 0, fx = u - i, fy = v - j, c = j * W + i;
      const a = hf[c], b = hf[c + 1], d = hf[c + W], e = hf[c + W + 1];
      return a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy;
    };
    // (les cartes d'époque ignorent les saisons : la gravure est la même en janvier et en août)
    const cols = Object.keys(TCOL).map(t => P ? P.t[t] || P.papier : teinte(+t, this.season));
    const lx = -0.55, ly = -0.62, lz = 0.56, flat = lz / Math.hypot(lx, ly, lz), K = 3.2;
    const sand = P ? P.t[T.DUNES] : this.season === 'hiver' ? [214, 208, 186] : [222, 206, 156];
    for (let sy = 0; sy < HR; sy++) {
      const y = (sy + 0.5) / R, j = Math.min(H - 1, y | 0);
      for (let sx = 0; sx < WR; sx++) {
        const x = (sx + 0.5) / R, i = Math.min(W - 1, x | 0), c = j * W + i, t = this.terrain[c];
        let col;
        if (t === T.OCEAN) col = this.oceanDist[c] <= 1 ? sand : cols[T.OCEAN];
        else if (t === T.EAU) col = cols[T.EAU];
        else if (P) {
          // papier taché par endroits ; les versants à l'ombre lavés de bistre (les hachures sont dans les tuiles)
          const n = vnoise(x / 9, y / 9, 3) * 0.6 + vnoise(x / 3, y / 3, 4) * 0.4;
          col = mix(cols[t], n > 0.5 ? [250, 246, 230] : [196, 180, 146], Math.abs(n - 0.5) * 0.3);
          const gx = (hAt(x + 0.5, y) - hAt(x - 0.5, y)) * K, gy = (hAt(x, y + 0.5) - hAt(x, y - 0.5)) * K;
          const s = clamp((-gx * lx - gy * ly + lz) / Math.hypot(gx, gy, 1) / Math.hypot(lx, ly, lz) / flat, 0.5, 1.2);
          if (s < 1) col = mix(col, P.hach, (1 - s) * 0.6);
        }
        else {
          col = cols[t];
          const n = vnoise(x / 9, y / 9, 3) * 0.6 + vnoise(x / 3, y / 3, 4) * 0.4, k = (n - 0.5) * 0.2;
          col = k > 0 ? mix(col, [236, 226, 170], k) : mix(col, [34, 44, 14], -k);
          const h = hAt(x, y);
          // coteaux plus secs et dorés, fonds humides plus verts
          if (t !== T.FORET && t < T.MONTAGNE) col = h > 0.3 ? mix(col, [184, 164, 98], Math.min(0.3, (h - 0.3) * 0.6)) : mix(col, [96, 128, 60], Math.min(0.18, (0.3 - h) * 0.5));
          const gx = (hAt(x + 0.5, y) - hAt(x - 0.5, y)) * K, gy = (hAt(x, y + 0.5) - hAt(x, y - 0.5)) * K;
          const s = clamp((-gx * lx - gy * ly + lz) / Math.hypot(gx, gy, 1) / Math.hypot(lx, ly, lz) / flat, 0.5, 1.32);
          col = s < 1 ? mix(col, [22, 30, 30], (1 - s) * 0.95) : mix(col, [255, 246, 214], (s - 1) * 0.55);
        }
        const o = (sy * WR + sx) * 4;
        data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  buildLandPath() {
    const p = new Path2D();
    for (const d of Object.values(this.depts)) {
      for (const r of d.rings) {
        p.moveTo(r[0][0], r[0][1]);
        for (let k = 1; k < r.length; k++) p.lineTo(r[k][0], r[k][1]);
        p.closePath();
      }
    }
    p.rect(4, this.m.y_spain, this.W, this.H - this.m.y_spain + 2);
    this.landPath = p;
    this.waterPath = new Path2D();
    for (const w of this.m.waters) {
      const r = w.ring;
      this.waterPath.moveTo(r[0][0], r[0][1]);
      for (let k = 1; k < r.length; k++) this.waterPath.lineTo(r[k][0], r[k][1]);
      this.waterPath.closePath();
    }
    this.deptPaths = {};
    for (const [code, d] of Object.entries(this.depts)) {
      if (!d.playable) continue;
      const pp = new Path2D();
      for (const r of d.rings) {
        pp.moveTo(r[0][0], r[0][1]);
        for (let k = 1; k < r.length; k++) pp.lineTo(r[k][0], r[k][1]);
        pp.closePath();
      }
      this.deptPaths[code] = pp;
    }
    // tout sauf les départements jouables (règle pair-impair : la carte entière, trouée par chacun d'eux)
    this.outPath = new Path2D();
    this.outPath.rect(-2, -2, this.W + 4, this.H + 4);
    for (const pp of Object.values(this.deptPaths)) this.outPath.addPath(pp);
    this.riverPaths = this.m.rivers.map(r => {
      const pp = new Path2D();
      pp.moveTo(r.pts[0][0], r.pts[0][1]);
      for (let k = 1; k < r.pts.length; k++) pp.lineTo(r.pts[k][0], r.pts[k][1]);
      return { rank: r.rank, p: pp, name: r.name };
    });
  }

  buildProxy() {
    // chaque cellule non jouable pointe vers la cellule jouable la plus proche (frontières seulement entre camps)
    const W = this.W, H = this.H, N = W * H;
    const proxy = new Int32Array(N).fill(-1);
    const q = [];
    for (let c = 0; c < N; c++) if (this.playable[c] && this.cellnode[c] !== 255) { proxy[c] = c; q.push(c); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0;
      const nb = [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1];
      for (const n of nb) if (n >= 0 && proxy[n] < 0) { proxy[n] = proxy[c]; q.push(n); }
    }
    this.proxy = proxy;
  }

  buildFieldCells() {
    // parcelles cultivées autour des bourgs
    this.fieldAngle = new Float32Array(this.W * this.H).fill(-99);
    for (const n of this.nodes) {
      const r = n.type === 'capitale' ? 5 : n.type === 'ville' ? 4 : 3;
      const ang = hash(n.id, 9) * Math.PI;
      for (let j = Math.floor(n.y - r); j <= n.y + r; j++) {
        for (let i = Math.floor(n.x - r); i <= n.x + r; i++) {
          if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
          const c = j * this.W + i;
          const d = Math.hypot(i + 0.5 - n.x, j + 0.5 - n.y);
          if (d < r && d > 0.6 && (this.terrain[c] === T.PLAINE || this.terrain[c] === T.COLLINES)) this.fieldAngle[c] = ang;
        }
      }
    }
  }

  // noms des eaux, gravés sur la carte : l'océan le long de la côte, les fleuves sur leur cours, étangs et estuaire
  buildWaterNames() {
    const W = this.W, H = this.H;
    const coastAt = j => { let i = 0; while (i < W && this.terrain[j * W + i] === T.OCEAN) i++; return i; };
    const sea = [];
    for (const [f, txt] of [[0.36, 'Océan Atlantique'], [0.8, 'Golfe de Gascogne']]) {
      const j = Math.round(H * f), x = coastAt(j) * 0.48;
      if (x > 8) sea.push({ x, y: j, txt, vertical: f < 0.5 });
    }
    // chaque fleuve : son plus long tracé, nommé en son milieu
    const best = new Map();
    for (const r of this.m.rivers) {
      let len = 0;
      for (let k = 1; k < r.pts.length; k++) len += Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1]);
      if (!best.has(r.name) || best.get(r.name).len < len) best.set(r.name, { r, len });
    }
    const rivers = [];
    for (const { r, len } of best.values()) {
      if (len < 25) continue;
      let s = len / 2, k = 1;
      for (; k < r.pts.length; k++) {
        const sl = Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1]);
        if (s <= sl) break;
        s -= sl;
      }
      const p = r.pts[k - 1], q = r.pts[Math.min(k, r.pts.length - 1)];
      let a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
      rivers.push({ x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, a, txt: r.name, rank: r.rank });
    }
    const lakes = this.m.waters.map(w => {
      const xs = w.ring.map(p => p[0]), ys = w.ring.map(p => p[1]);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, txt: w.name, big: /Estuaire|Bassin/.test(w.name) };
    });
    this.waterNames = { sea, rivers, lakes };
  }

  drawWaterNames(ctx) {
    const z = this.cam.z, wn = this.waterNames, P = PAPIER[this.era];
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const spaced = t => t.toLocaleUpperCase('fr-FR').split('').join('\u200a');
    // la mer : de grandes capitales espacées, gravées dans l'eau
    const fs = clamp(z * 5.5, 13, 34);
    ctx.font = `italic 600 ${fs}px "EB Garamond", Georgia, serif`;
    for (const s of wn.sea) {
      const [x, y] = this.toScreen(s.x, s.y);
      if (x < -300 || y < -300 || x > this.vw + 300 || y > this.vh + 300) continue;
      ctx.save(); ctx.translate(x, y); if (s.vertical) ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = P ? rgb(P.ligne, 0.7) : 'rgba(16,52,60,0.5)'; ctx.fillText(spaced(s.txt), 0, 0);
      ctx.restore();
    }
    // fleuves, étangs, estuaire
    const ink = P ? rgb(P.ligne) : 'rgba(24,58,62,0.82)', halo = P ? 'rgba(240,234,214,0.6)' : 'rgba(214,226,200,0.45)';
    for (const r of wn.rivers) {
      if (z < (r.rank === 1 ? 2.4 : r.rank === 2 ? 4.5 : 7.5)) continue;
      const [x, y] = this.toScreen(r.x, r.y);
      if (x < -100 || y < -40 || x > this.vw + 100 || y > this.vh + 40) continue;
      const f = r.rank === 1 ? clamp(10 + z * 0.6, 12, 18) : clamp(9 + z * 0.45, 11, 15);
      ctx.font = `italic 600 ${f}px "EB Garamond", Georgia, serif`;
      ctx.save(); ctx.translate(x, y); ctx.rotate(r.a); ctx.translate(0, -f * 0.75);
      ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.strokeText(r.txt, 0, 0);
      ctx.fillStyle = ink; ctx.fillText(r.txt, 0, 0);
      ctx.restore();
    }
    for (const l of wn.lakes) {
      if (z < (l.big ? 3 : 5.5)) continue;
      const [x, y] = this.toScreen(l.x, l.y);
      if (x < -100 || y < -40 || x > this.vw + 100 || y > this.vh + 40) continue;
      ctx.font = `italic 600 ${clamp(9 + z * 0.5, 11, 17)}px "EB Garamond", Georgia, serif`;
      ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.strokeText(l.txt, x, y);
      ctx.fillStyle = ink; ctx.fillText(l.txt, x, y);
    }
    ctx.restore();
  }

  // vignettage : les bords de l'écran s'assombrissent, comme sous l'objectif d'Ultimate General
  drawVignette(ctx) {
    const w = this.vw, h = this.vh;
    if (!this.vig || this.vig.w !== w || this.vig.h !== h) {
      // peint une fois dans une image à la taille de l'écran : recalculer le dégradé coûtait 8 ms par image
      // (sur une carte d'époque, des bords roussis de vieux papier)
      const cv = document.createElement('canvas'), g = cv.getContext('2d');
      cv.width = this.cv.width; cv.height = this.cv.height; g.scale(this.dpr, this.dpr);
      const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.hypot(w, h) * 0.58);
      gr.addColorStop(0, this.era ? 'rgba(120,84,40,0)' : 'rgba(10,12,10,0)'); gr.addColorStop(1, this.era ? 'rgba(120,84,40,0.34)' : 'rgba(10,12,10,0.42)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      this.vig = { w, h, cv };
    }
    ctx.drawImage(this.vig.cv, 0, 0, w, h);
  }

  showPreview(scen) {
    // état initial (avant le choix du département) : chefs-lieux et villes à leur département, dans le paysage de
    // l'époque choisie (scen : clé de rules.scenarios) : ce qu'y ont changé les technologies déjà connues, les voies
    // ferrées déjà ouvertes, le drapeau et le style de carte de l'année
    if (scen) this.previewScen = scen;
    const sc = this.rules.scenarios?.[this.previewScen || this.rules.scenario_order?.[0]] || {};
    const known = startTechs(this.rules, sc), year = sc.year || 1790;
    const mk = Object.entries(this.rules.visuals || {}).filter(([, v]) => known.has(v.tech)).map(([k]) => k);
    this.state = null;
    this.disp.clear();
    this.preview = { nodes: this.nodes.map(n => ({ id: n.id, o: (n.type === 'capitale' || n.type === 'ville') ? n.dept : 'neutre', f: n.fort, d: 0 })),
                     me: { code: null }, armies: [], battles: [], year,
                     factions: Object.keys(this.rules.factions).map(code => ({ code, mk })),
                     rails: { state: startRails(this.m.rails, year).map(sid => [sid, 'fait', 1, null]) } };
    this.owners = this.preview.nodes.map(n => n.o);
    this.ownersKey = '';
    this.rebuildTerritory();
    if (this.epoque.update(this.preview)) this.invalidateTiles();
    if (this.styleEra() !== this.era) this.repaint();
  }

  // ------------------------------------------------------------------ caméra
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.vw = w; this.vh = h;
  }
  minZoom() { return Math.min(this.vw / this.W, this.vh / this.H) * 0.8; }

  armyScreen(d) {
    let [x, y] = this.toScreen(d.x, d.y);
    const a = d.a;
    if (a && a.n != null && a.st !== 'battle') {
      const n = this.nodes[a.n];
      const s = this.nodeSize(n);
      const z = this.cam.z;
      const k = d.slot || 0;
      // une armée qui assiège se tient au-delà des remparts et de l'anneau de siège : la brèche reste visible
      const below = a.st !== 'siege' ? s * 0.5 : z >= 5.5 ? this.siegeRadius(n, s) + 4 : Math.max(s * 0.5, this.siegeRadius(n, s) - 8);
      // l'armée se range sous le nom de la place : ses chiffres de régiments ne doivent pas le recouvrir
      const name = a.st !== 'siege' ? this.labelFs(n) + 4 : 0;
      if (z >= 5.5) {
        const bw = clamp(z * 2.3, 22, 66), bd = bw * 0.38, rows = Math.max(1, Math.ceil(a.regs.length / 6));
        y += below + name + clamp(bw * 0.42, 10, 16) + 8 + (rows > 1 ? (rows - 1) * bd * 1.4 : 0) + bd * 0.5;
      } else y += below + name + 14;
      x += (k - (d.slots - 1) / 2) * (z >= 5.5 ? Math.min(6, d.a.regs.length) * clamp(z * 2.3, 22, 66) * 1.25 + 20 : 56);
    }
    return [x, y];
  }
  // rayon extérieur des remparts et de l'anneau de siège d'une place (voir walls() et drawNodes())
  siegeRadius(n, s) {
    const f = this.state?.nodes[n.id]?.f || 0;
    const R = s * 0.62 + 2, lw = clamp(s * 0.03 * (1 + f * 0.5), 1.3, 6);
    const outer = !f ? 0 : f <= 2 ? R + lw : f >= 4 ? R * 1.62 : R * 1.42;
    return Math.max(s * 0.62 + 4, outer + 4) + 3;
  }

  fitAll(instant, left = 0, top = 60) {
    const aw = this.vw - left, ah = this.vh - top;
    const z = Math.min(aw / this.W, ah / this.H) * 0.96;
    const cx = this.W / 2 - (left / 2) / z, cy = this.H / 2 - (top / 2) / z + 4;
    this.moveTo(cx, cy, z, instant);
  }
  moveTo(x, y, z, instant = false, dur = 650) {
    z = clamp(z ?? this.cam.z, this.minZoom(), 26);
    if (instant) { this.cam = { x, y, z }; this.camAnim = null; return; }
    this.camAnim = { from: { ...this.cam }, to: { x, y, z }, t0: performance.now(), dur };
  }
  toScreen(x, y) { return [(x - this.cam.x) * this.cam.z + this.vw / 2, (y - this.cam.y) * this.cam.z + this.vh / 2]; }
  toWorld(sx, sy) { return [(sx - this.vw / 2) / this.cam.z + this.cam.x, (sy - this.vh / 2) / this.cam.z + this.cam.y]; }
  clampCam() {
    const c = this.cam;
    c.z = clamp(c.z, this.minZoom(), 26);
    const mx = this.vw / 2 / c.z, my = this.vh / 2 / c.z;
    c.x = clamp(c.x, Math.min(mx - 30, this.W / 2), Math.max(this.W - mx + 30, this.W / 2));
    c.y = clamp(c.y, Math.min(my - 40, this.H / 2), Math.max(this.H - my + 30, this.H / 2));
  }

  // ------------------------------------------------------------------ entrées
  bindInput() {
    // Gestes unifiés souris / doigt / stylet (Pointer Events)
    //  appui court : sélection          double appui : zoom avant      appui à deux doigts : zoom arrière
    //  glisser : déplacer la carte (avec élan)   pincer : zoomer
    //  glisser depuis une de vos armées : tracer son itinéraire
    //  appui long (ou clic droit) : envoyer l'armée sélectionnée à cet endroit
    const cv = this.cv;
    const pts = new Map();
    let g = null, lastTap = null, lastPen = -1e9;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const info = (sx, sy, type) => { const [x, y] = this.toWorld(sx, sy); return { x, y, sx, sy, type, hit: this.hitTest(sx, sy, type) }; };
    const vib = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* rien */ } };
    const clearLong = () => { if (g && g.longT) { clearTimeout(g.longT); g.longT = null; } };

    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (g && g.type && g.type !== 'mouse') return;
      const [sx, sy] = pos(e);
      this.onContext && this.onContext(info(sx, sy, 'mouse'));
    });

    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const now = performance.now();
      if (e.pointerType === 'pen') lastPen = now;
      else if (e.pointerType === 'touch' && now - lastPen < 900) return; // paume posée pendant l'usage du stylet
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* pointeur synthétique */ }
      const [sx, sy] = pos(e);
      pts.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });
      this.camAnim = null;
      this.inertia = null;
      if (pts.size === 1) {
        const hit = this.hitTest(sx, sy, e.pointerType);
        const dragArmy = hit && hit.kind === 'army' && this.canDragArmy && this.canDragArmy(hit.id) ? hit.id : null;
        g = { kind: 'press', sx, sy, t0: now, type: e.pointerType, cx: this.cam.x, cy: this.cam.y, moved: false, dragArmy,
              samples: [[now, sx, sy]] };
        g.longT = setTimeout(() => {
          if (g && g.kind === 'press' && !g.moved) {
            g.kind = 'long';
            vib(18);
            this.onLongPress && this.onLongPress(info(g.sx, g.sy, g.type));
          }
        }, 520);
      } else if (pts.size === 2) {
        clearLong();
        const [a, b] = [...pts.values()];
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.cam.z, w: this.toWorld(mid[0], mid[1]),
              mid0: mid, t0: now, moved: false, type: 'touch' };
        this.dragTrail = null;
        this.onGesture && this.onGesture();
      }
    });

    cv.addEventListener('pointermove', e => {
      const [sx, sy] = pos(e);
      if (!pts.has(e.pointerId)) {
        // survol : souris, ou stylet qui approche de l'écran (Apple Pencil, stylets Android)
        if (e.pointerType === 'pen') lastPen = performance.now();
        if (e.pointerType !== 'touch') { this.hover = [sx, sy]; this.hoverType = e.pointerType; }
        return;
      }
      const p = pts.get(e.pointerId);
      p.x = sx; p.y = sy;
      if (!g) return;
      if (g.kind === 'pinch') {
        if (pts.size < 2) return;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        if (Math.abs(d - g.d0) > 12 || Math.hypot(mid[0] - g.mid0[0], mid[1] - g.mid0[1]) > 12) g.moved = true;
        this.cam.z = clamp(g.z0 * d / g.d0, this.minZoom(), 26);
        this.cam.x = g.w[0] - (mid[0] - this.vw / 2) / this.cam.z;
        this.cam.y = g.w[1] - (mid[1] - this.vh / 2) / this.cam.z;
        this.clampCam();
        return;
      }
      if (g.kind === 'long') return;
      const dx = sx - g.sx, dy = sy - g.sy;
      if (g.kind === 'twotap') {
        if (Math.hypot(dx, dy) > 10) { g.kind = 'pan'; g.moved = true; g.cx = this.cam.x - dx / this.cam.z; g.cy = this.cam.y - dy / this.cam.z; }
        else return;
      }
      const thr = g.type === 'mouse' ? 5 : g.type === 'pen' ? 6 : 10;
      if (!g.moved && Math.hypot(dx, dy) > thr) {
        g.moved = true;
        clearLong();
        if (g.dragArmy) {
          g.kind = 'route';
          this.dragTrail = { army: g.dragArmy, pts: [this.toWorld(g.sx, g.sy)], end: [sx, sy], hit: null, type: g.type };
          this.onGesture && this.onGesture();
        } else {
          g.kind = 'pan';
          cv.classList.add('dragging');
          this.onGesture && this.onGesture();
        }
      }
      if (g.kind === 'pan') {
        this.cam.x = g.cx - dx / this.cam.z;
        this.cam.y = g.cy - dy / this.cam.z;
        this.clampCam();
        g.samples.push([performance.now(), sx, sy]);
        if (g.samples.length > 6) g.samples.shift();
      } else if (g.kind === 'route') {
        const w = this.toWorld(sx, sy);
        const tr = this.dragTrail.pts, last = tr[tr.length - 1];
        if (Math.hypot(w[0] - last[0], w[1] - last[1]) * this.cam.z > 7) tr.push(w);
        this.dragTrail.end = [sx, sy];
        this.dragTrail.hit = this.hitTest(sx, sy, g.type);
      }
    });

    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const [sx, sy] = pos(e);
      pts.delete(e.pointerId);
      cv.classList.remove('dragging');
      if (!g) return;
      const now = performance.now();
      const cancel = e.type === 'pointercancel';
      if (g.kind === 'pinch') {
        if (pts.size === 2) {
          // trois doigts -> deux : on repart des deux restants pour que le zoom ne saute pas
          const [a, b] = [...pts.values()];
          const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
          Object.assign(g, { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.cam.z, w: this.toWorld(mid[0], mid[1]), mid0: mid });
        } else if (pts.size === 1) {
          const [p] = [...pts.values()];
          const quick = !g.moved && now - g.t0 < 300;
          g = { kind: quick ? 'twotap' : 'pan', sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y, moved: !quick, type: 'touch',
                samples: [[now, p.x, p.y]], t0: g.t0, mid0: g.mid0 };
        } else if (pts.size === 0) {
          if (!g.moved && now - g.t0 < 300 && !cancel) this.zoomAt(g.mid0[0], g.mid0[1], 1 / 1.8);
          g = null;
        }
        return;
      }
      if (pts.size > 0) return;
      clearLong();
      if (g.kind === 'twotap') {
        if (!cancel && now - g.t0 < 450) this.zoomAt(g.mid0[0], g.mid0[1], 1 / 1.8);
        g = null;
        return;
      }
      if (g.kind === 'press' && !cancel) {
        const ev = info(sx, sy, g.type);
        if (lastTap && now - lastTap.t < 330 && Math.hypot(sx - lastTap.sx, sy - lastTap.sy) < 36) {
          lastTap = null;
          this.onDoubleTap && this.onDoubleTap(ev);
          this.zoomAt(sx, sy, 1.9);
        } else {
          lastTap = { t: now, sx, sy };
          this.onTap && this.onTap(ev);
        }
      } else if (g.kind === 'pan') {
        const s = g.samples;
        if (s.length >= 2 && g.type !== 'mouse') {
          const a = s[0], b = s[s.length - 1], dts = (b[0] - a[0]) / 1000;
          if (dts > 0 && now - b[0] < 140) {
            const vx = (b[1] - a[1]) / dts, vy = (b[2] - a[2]) / dts;
            if (Math.hypot(vx, vy) > 300) this.inertia = { vx, vy };
          }
        }
      } else if (g.kind === 'route') {
        const tr = this.dragTrail;
        this.dragTrail = null;
        if (tr && !cancel) {
          tr.pts.push(this.toWorld(sx, sy));
          this.onDragOrder && this.onDragOrder({ army: tr.army, trail: tr.pts, end: info(sx, sy, g.type), type: g.type });
        }
      }
      g = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', e => { if (!pts.has(e.pointerId)) this.hover = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.camAnim = null;
      this.inertia = null;
      const [sx, sy] = pos(e);
      const w = this.toWorld(sx, sy);
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      this.cam.z = clamp(this.cam.z * f, this.minZoom(), 26);
      this.cam.x = w[0] - (sx - this.vw / 2) / this.cam.z;
      this.cam.y = w[1] - (sy - this.vh / 2) / this.cam.z;
      this.clampCam();
    }, { passive: false });
  }

  zoomBy(f) {
    this.moveTo(this.cam.x, this.cam.y, this.cam.z * f);
  }

  zoomAt(sx, sy, f) {
    const w = this.toWorld(sx, sy);
    const z = clamp(this.cam.z * f, this.minZoom(), 26);
    this.moveTo(w[0] - (sx - this.vw / 2) / z, w[1] - (sy - this.vh / 2) / z, z);
  }

  // opt.skipArmy(a) : ignore ces armées (ordre de marche : ses propres jetons ne doivent pas masquer la ville dessous)
  hitTest(sx, sy, type = 'mouse', opt = {}) {
    const z = this.cam.z;
    const pad = type === 'touch' ? 12 : type === 'pen' ? 3 : 0;
    let best = null;
    const st = this.state || this.preview;
    for (const a of st.armies) {
      const d = this.disp.get(a.id);
      if (!d || (opt.skipArmy && opt.skipArmy(a))) continue;
      const [x, y] = this.armyScreen(d);
      const r = (z >= 5.5 ? Math.max(20, z * 2.4) : 22) + pad;
      const dd = Math.hypot(sx - x, sy - y);
      if (dd < r && (!best || dd < best.d)) best = { kind: 'army', id: a.id, d: dd, a };
    }
    if (best) {
      // une armée (de passage, ou rangée sous sa ville) ne doit pas rendre une autre place inaccessible : le cœur de
      // l'icône d'une place reste à la place (Villenave-d'Ornon sous l'armée de Bordeaux)
      for (const n of this.nodes) {
        if (n.id === best.a.n && best.a.st !== 'move' && best.a.st !== 'retreat') continue;
        const [x, y] = this.toScreen(n.x, n.y);
        if (Math.hypot(sx - x, sy - y) < this.nodeSize(n) * 0.4) return { kind: 'node', id: n.id, d: 0 };
      }
    }
    if (best) return { kind: best.kind, id: best.id, d: best.d };
    for (const b of st.battles) {
      const [x, y] = this.toScreen(b.x, b.y);
      const dd = Math.hypot(sx - x, sy - y - 26);
      if (dd < 20 + pad && b.node == null) return { kind: 'battle', id: b.id };
    }
    for (const n of this.nodes) {
      const [x, y] = this.toScreen(n.x, n.y);
      const r = this.nodeSize(n) / 2 + 7 + pad;
      const dd = Math.hypot(sx - x, sy - y);
      if (dd < r && (!best || dd < best.d)) best = { kind: 'node', id: n.id, d: dd };
    }
    return best;
  }

  // tracé en cours (glisser depuis une armée) et carte de survol
  drawGesture(ctx) {
    const tr = this.dragTrail;
    if (tr) {
      const d = this.disp.get(tr.army);
      const sp = tr.pts.map(p => this.toScreen(p[0], p[1]));
      if (d) sp[0] = this.armyScreen(d);
      sp.push(tr.end);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); sp.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = 'rgba(32,35,38,0.75)'; ctx.lineWidth = 8; ctx.stroke();
      ctx.setLineDash(this.trMode ? [3, 8] : [10, 8]);
      ctx.strokeStyle = this.trMode ? '#f6efdc' : '#bfe39a'; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash([]);
      const [ex, ey] = tr.end;
      if (tr.hit && tr.hit.kind === 'node') {
        const n = this.nodes[tr.hit.id];
        const [nx, ny] = this.toScreen(n.x, n.y);
        ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(nx, ny, this.nodeSize(n) * 0.7 + 8, 0, Math.PI * 2); ctx.stroke();
        this.hoverCard(ctx, nx, ny - this.nodeSize(n) * 0.7 - 14, [n.name], true);
      } else {
        ctx.fillStyle = '#bfe39a';
        ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#202326'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (!this.hover || this.hoverType === 'touch') return;
    const [hx, hy] = this.hover;
    const hit = this.hitTest(hx, hy, this.hoverType);
    if (!hit) return;
    const st = this.state || this.preview;
    const F = this.rules.factions;
    const own = c => c === 'neutre' ? 'indépendant' : (F[c] ? F[c].name : c);
    let lines = null;
    if (hit.kind === 'node') {
      const n = this.nodes[hit.id], ns = st.nodes[hit.id];
      const t = { capitale: 'Chef-lieu', ville: 'Ville', village: 'Village', fort: 'Place forte' }[n.type];
      const men = ns.m != null ? ns.m + (ns.g ? ns.g.reduce((s, r) => s + r[2], 0) : (ns.gm || 0)) : null;
      lines = [n.name, `${t}, ${own(ns.o)}${ns.pop ? ` · ${fmtMen(ns.pop)} hab.` : ""}`];
      if (n.star) lines.push(`★ ${n.star[1]}`);
      if (ns.dp) lines.push('Magasin aux vivres');
      if (men != null) lines.push(`Défenseurs : ${fmtMen(men)}`);
      if (ns.bar != null) lines.push(`${ns.f > 0 ? 'Redoutes' : 'Barricades'} : ${Math.round(ns.bar * 100)} %`);
      if (ns.sg) lines.push(ns.sg.bl ? `Blocus : famine ${Math.round(ns.sg.dmg * 100)} %` : `Siège : ${Math.round(ns.sg.dmg * 100)} %`);
    } else if (hit.kind === 'army') {
      const a = st.armies.find(x => x.id === hit.id);
      if (a) {
        lines = [a.name, `${own(a.o)}, ${fmtMen(a.men)} hommes`];
        if (a.qr) lines.push('En quartiers');
        if (a.wn?.includes('faim')) lines.push('Vivres épuisés');
        if (a.wn?.includes('solde')) lines.push('Solde impayée');
      }
    } else if (hit.kind === 'battle') {
      const b = st.battles.find(x => x.id === hit.id);
      if (b) lines = [b.amb ? 'Embuscade' : 'Bataille', `${fmtMen(b.sides[0].men)} contre ${fmtMen(b.sides[1].men)}`];
    }
    if (lines) this.hoverCard(ctx, hx + 16, hy + 22, lines, false);
  }

  hoverCard(ctx, x, y, lines, centered) {
    ctx.save();
    ctx.font = '600 14px "EB Garamond", Georgia, serif';
    const w = Math.max(...lines.map((l, i) => { ctx.font = `${i ? 400 : 600} 14px "EB Garamond", Georgia, serif`; return ctx.measureText(l).width; })) + 18;
    const h = lines.length * 18 + 10;
    let bx = centered ? x - w / 2 : x, by = centered ? y - h : y;
    bx = clamp(bx, 6, this.vw - w - 6);
    by = clamp(by, 6, this.vh - h - 6);
    ctx.fillStyle = 'rgba(12,24,40,0.94)';
    roundRect(ctx, bx, by, w, h, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(200,162,83,0.7)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = `${i ? 400 : 600} 14px "EB Garamond", Georgia, serif`;
      ctx.fillStyle = i ? '#c9c0a8' : '#f1ead8';
      ctx.fillText(l, bx + 9, by + 6 + i * 18);
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------ état serveur
  setState(st) {
    const prev = this.state;
    this.state = st;
    // le givre, la neige et les prés roussis sont peints dans les tuiles : on les repeint quand la saison change
    const peinte = s => (s === 'hiver' || s === 'automne' ? s : '');
    if (peinte(st.season) !== peinte(this.season)) { this.season = st.season; this.paintLand(); this.invalidateTiles(); }
    this.season = st.season;
    const key = st.nodes.map(n => n.o).join(',');
    if (key !== this.ownersKey) {
      this.ownersKey = key;
      this.owners = st.nodes.map(n => n.o);
      this.rebuildTerritory();
    }
    // ce que les technologies de chaque camp ont changé au paysage est peint dans les tuiles (epoque.js)
    if (this.epoque.update(st)) this.invalidateTiles();
    if (this.styleEra() !== this.era) this.repaint();   // (la carte d'état-major succède à celle de Cassini en 1818)
    // pertes en bataille -> chiffres flottants
    const prevB = new Map((prev?.battles || []).map(b => [b.id, b]));
    for (const b of st.battles) {
      const pb = prevB.get(b.id);
      for (let i = 0; i < 2; i++) {
        const lost = b.sides[i].lost - (pb ? pb.sides[i].lost : 0);
        if (lost >= 3) {
          this.particles.push({ type: 'num', x: b.x + (i ? 0.9 : -0.9) + (Math.random() - 0.5), y: b.y - 0.6, life: 0, max: 1.4,
                                text: `−${Math.round(lost)}`, color: this.colors[b.sides[i].o] || '#ddd' });
        }
      }
    }
    // en bataille, chaque armée fait face à l'ennemi
    const byId = new Map(st.armies.map(a => [a.id, a]));
    const face = new Map();
    for (const b of st.battles) {
      const cen = b.sides.map(s => {
        const arr = s.armies.map(id => byId.get(id)).filter(Boolean);
        if (!arr.length) return null;
        return [arr.reduce((t, a) => t + a.x, 0) / arr.length, arr.reduce((t, a) => t + a.y, 0) / arr.length];
      });
      b.sides.forEach((s, i) => {
        for (const id of s.armies) {
          const a = byId.get(id);
          if (!a) continue;
          let tgt = cen[1 - i] || [b.x, b.y];
          if (Math.hypot(tgt[0] - a.x, tgt[1] - a.y) < 0.05) tgt = [b.x + (i ? -1 : 1), b.y];
          face.set(id, Math.atan2(tgt[1] - a.y, tgt[0] - a.x));
        }
      });
    }
    const seen = new Set();
    for (const a of st.armies) {
      seen.add(a.id);
      let tx = a.x, ty = a.y, head = null;
      if (a.e) {
        const e = this.edges[a.e[0]];
        [tx, ty] = this.pointFrom(e, a.e[1], a.e[2]);
        const t = a.e[1] === e.a ? a.e[2] : 1 - a.e[2];
        const tg = this.edgeTangent(e, t);
        head = Math.atan2(tg[1], tg[0]) + (a.e[1] === e.a ? 0 : Math.PI);
      } else if (a.path && a.path.length) {
        const leg = a.path[0];
        if (leg.pts && leg.pts.length > 1) head = Math.atan2(leg.pts[1][1] - a.y, leg.pts[1][0] - a.x);
        else if (leg.e != null) {
          const e = this.edges[leg.e];
          const p0 = this.pointFrom(e, leg.frm, 0.02);
          head = Math.atan2(p0[1] - a.y, p0[0] - a.x);
        }
      }
      if (face.has(a.id)) head = face.get(a.id);  // en bataille : face à l'ennemi
      else if (a.n != null && a.st !== 'move' && a.st !== 'retreat') head = -Math.PI / 2;   // rangée sous la place, face à elle (et aux remparts au siège)
      let d = this.disp.get(a.id);
      if (!d) {
        d = { x: tx, y: ty, tx, ty, head: head ?? -Math.PI / 2, tn: a.tn ?? 0 };
        this.disp.set(a.id, d);
      } else {
        if (head == null && Math.hypot(tx - d.tx, ty - d.ty) > 0.05) head = Math.atan2(ty - d.ty, tx - d.tx);
        d.tx = tx; d.ty = ty;
        if (a.trl && a.trl.length > 1 && a.tn != null && a.tn !== d.tn) {
          // tour par tour : la marche vient d'avoir lieu, l'armée la parcourt sous nos yeux
          d.tn = a.tn;
          let len = 0;
          for (let i = 1; i < a.trl.length; i++) len += Math.hypot(a.trl[i][0] - a.trl[i - 1][0], a.trl[i][1] - a.trl[i - 1][1]);
          d.anim = { pts: a.trl, len, t: 0, dur: Math.max(0.8, Math.min(3.5, len / 90)) };
          d.x = a.trl[0][0]; d.y = a.trl[0][1];
        } else if (!d.anim && Math.hypot(d.x - tx, d.y - ty) > 25) { d.x = tx; d.y = ty; }
      }
      if (head != null) d.thead = head;
      d.a = a;
    }
    for (const id of [...this.disp.keys()]) if (!seen.has(id)) this.disp.delete(id);
    for (const z of Object.keys(this.wx)) {
      const kind = st.weather[z]?.kind;
      if (this.wx[z].kind !== kind) this.wx[z] = Object.assign([], { kind });
    }
  }

  rebuildTerritory() {
    const W = this.W, H = this.H, N = W * H;
    const codes = Object.keys(this.rules.factions);
    const idx = new Int8Array(N).fill(-1);
    for (let c = 0; c < N; c++) {
      const p = this.proxy[c];
      if (p < 0) continue;
      const o = this.owners[this.cellnode[p]];
      idx[c] = codes.indexOf(o);
    }
    // frontières (carrés marchants sur un champ lissé)
    this.frontiers = [];
    const fields = codes.map(() => null);
    const g = new Float32Array(N);
    for (let ci = 0; ci < codes.length; ci++) {
      const f = new Float32Array(N);
      let any = false;
      for (let c = 0; c < N; c++) { f[c] = idx[c] === ci ? 1 : 0; if (f[c]) any = true; }
      if (!any) continue;
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          let s = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < W && jj < H) { s += f[jj * W + ii]; n++; }
          }
          g[j * W + i] = s / n;
        }
        f.set(g);
      }
      fields[ci] = f;
      const segs = [];
      const seg = (p, q) => segs.push([p, q]);
      const L = 0.5;
      for (let j = 0; j < H - 1; j++) {
        for (let i = 0; i < W - 1; i++) {
          const a = f[j * W + i], b = f[j * W + i + 1], c = f[(j + 1) * W + i + 1], d = f[(j + 1) * W + i];
          const id = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
          if (id === 0 || id === 15) continue;
          const x = i + 0.5, y = j + 0.5;
          const pc = j * W + i;
          // (le 3e terme désigne l'arête de la grille : les cases voisines y posent exactement le même point)
          const top = () => [x + (L - a) / (b - a), y, pc * 2];
          const right = () => [x + 1, y + (L - b) / (c - b), (pc + 1) * 2 + 1];
          const bottom = () => [x + (L - d) / (c - d), y + 1, (pc + W) * 2];
          const left = () => [x, y + (L - a) / (d - a), pc * 2 + 1];
          if (!this.playable[pc] && !this.playable[pc + 1] && !this.playable[pc + W] && !this.playable[pc + W + 1]) continue;
          switch (id) {
            case 1: case 14: seg(left(), bottom()); break;
            case 2: case 13: seg(bottom(), right()); break;
            case 3: case 12: seg(left(), right()); break;
            case 4: case 11: seg(top(), right()); break;
            case 5: seg(left(), top()); seg(bottom(), right()); break;
            case 6: case 9: seg(top(), bottom()); break;
            case 7: case 8: seg(left(), top()); break;
            case 10: seg(top(), right()); seg(left(), bottom()); break;
          }
        }
      }
      this.frontiers.push({ code: codes[ci], parts: lineChunks(chainSegments(segs)) });
    }
    this.tileGen++;
    this.cellFac = idx; this.facCodes = codes;   // (le camp qui tient chaque case : le paysage de son époque, epoque.js)
    this.paintTerritory(idx, fields, codes);
  }

  // remplissage des territoires, en sous-cases : il suit le même champ lissé que les frontières, donc colle au trait
  // au lieu de dessiner des marches d'escalier d'1 km (le littoral et les limites du jeu sont lissés de même)
  paintTerritory(idx, fields, codes) {
    const W = this.W, H = this.H, R = 3, FW = W * R, FH = H * R;
    const cv = this.fillCanvas;
    if (cv.width !== FW || cv.height !== FH) { cv.width = FW; cv.height = FH; }
    const fctx = cv.getContext('2d');
    const img = fctx.createImageData(FW, FH), data = img.data;
    const cols = codes.map(c => hexRgb(this.colors[c]));
    const pl = this.playable;
    for (let sy = 0; sy < FH; sy++) {
      const v = (sy + 0.5) / R - 0.5, j = clamp(Math.floor(v), 0, H - 2), fy = clamp(v - j, 0, 1);
      for (let sx = 0; sx < FW; sx++) {
        const u = (sx + 0.5) / R - 0.5, i = clamp(Math.floor(u), 0, W - 2), fx = clamp(u - i, 0, 1);
        const c00 = j * W + i, c10 = c00 + 1, c01 = c00 + W, c11 = c01 + 1;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const pv = pl[c00] * w00 + pl[c10] * w10 + pl[c01] * w01 + pl[c11] * w11;
        if (pv < 0.3) continue;
        let best = -1, bv = 0;
        for (const k of [idx[c00], idx[c10], idx[c01], idx[c11]]) {
          if (k < 0 || k === best || !fields[k]) continue;
          const f = fields[k], val = f[c00] * w00 + f[c10] * w10 + f[c01] * w01 + f[c11] * w11;
          if (val > bv) { bv = val; best = k; }
        }
        if (best < 0) continue;
        const a = Math.min(clamp((bv - 0.5) * 10 + 0.5, 0, 1), clamp((pv - 0.5) * 4 + 0.5, 0, 1));
        if (a <= 0) continue;
        const o = (sy * FW + sx) * 4, k = cols[best];
        data[o] = k[0]; data[o + 1] = k[1]; data[o + 2] = k[2]; data[o + 3] = 44 * a;
      }
    }
    fctx.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------------ tuiles
  // niveau voulu pour le zoom : le plus petit qui ne soit pas agrandi de plus de 10 % à l'écran,
  // avec une marge pour ne pas basculer d'un niveau à l'autre au moindre mouvement
  level() {
    const want = this.cam.z * this.dpr, cur = this.curL;
    if (cur && want / cur >= 0.78 && want / cur <= 1.12) return cur;
    for (const L of LEVELS) if (L >= want * 0.91) return L;
    return LEVELS[LEVELS.length - 1];
  }

  getTile(L, tx, ty, allowRender) {
    const key = `${L}:${tx}:${ty}`;
    if (L === LEVELS[0]) {
      let b = this.baseTiles.get(key);
      if (allowRender && (!b || b.gen !== this.tileGen)) { if (b) this.pool.push(b); b = this.renderTile(L, tx, ty); this.baseTiles.set(key, b); }
      return b || null;
    }
    let t = this.tiles.get(key);
    // (une tuile d'avant le dernier changement de camp reste affichée tant que la neuve n'est pas peinte)
    if (t && (t.gen === this.tileGen || !allowRender)) {
      // vue à l'instant : elle passe en fin de file (la plus récente)
      this.tiles.delete(key); this.tiles.set(key, t);
      t.seen = this.frameNo;
      return t;
    }
    if (!allowRender) return null;
    if (t) { this.tiles.delete(key); this.pool.push(t); }
    t = this.renderTile(L, tx, ty);
    t.seen = this.frameNo;
    this.tiles.set(key, t);
    // les plus anciennes partent, jamais celles affichées à cette image. Leur canevas sert à la prochaine tuile :
    // jamais détruit, il ne laisse ni tuiles blanches sur Safari (iPad), ni tuiles noires sur Chrome (PC), qui
    // effaçait parfois un canevas détruit pendant qu'il s'affichait encore
    for (const [k, old] of this.tiles) {
      if (this.tiles.size <= this.tileLimit || old.seen === this.frameNo) break;
      this.tiles.delete(k);
      this.pool.push(old);
    }
    return t;
  }

  invalidateTiles() {
    for (const m of [this.tiles, this.baseTiles]) { this.pool.push(...m.values()); m.clear(); }
  }

  // portion manquante d'une tuile : on la recouvre avec les tuiles déjà prêtes d'un autre niveau
  // (celui qu'on quitte en zoomant, sinon le plus proche), à défaut avec le fond du niveau le plus bas
  drawFallback(ctx, L, tx, ty, ox, oy, z) {
    const span = TILE / L, x0 = tx * span, y0 = ty * span;
    const order = LEVELS.filter(l => l !== L && l !== LEVELS[0]).sort((a, b) => Math.abs(Math.log(a / L)) - Math.abs(Math.log(b / L)));
    if (this.prevL && this.prevL !== L && this.prevL !== LEVELS[0]) order.unshift(this.prevL);
    order.push(LEVELS[0]);
    for (const Lo of order) {
      const so = TILE / Lo;
      const i0 = Math.floor(x0 / so), i1 = Math.floor((x0 + span - 1e-6) / so), j0 = Math.floor(y0 / so), j1 = Math.floor((y0 + span - 1e-6) / so);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 16) continue;
      const parts = [];
      for (let j = j0; j <= j1 && parts; j++) for (let i = i0; i <= i1; i++) {
        const t = this.getTile(Lo, i, j, Lo === LEVELS[0]);
        if (!t) { parts.length = 0; break; }
        parts.push([t, i, j]);
      }
      if (!parts.length) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(ox + x0 * z, oy + y0 * z, span * z + 0.6, span * z + 0.6); ctx.clip();
      for (const [t, i, j] of parts) ctx.drawImage(t, ox + i * so * z, oy + j * so * z, so * z + 0.6, so * z + 0.6);
      ctx.restore();
      return;
    }
  }

  drawSub(g, img, x0, y0, span, R = 1) {
    // dessine la portion [x0, x0+span] de l'image (R px = 1 km) sur la tuile, en restant dans les bornes
    const sx = Math.max(0, x0), sy = Math.max(0, y0);
    const ex = Math.min(img.width / R, x0 + span), ey = Math.min(img.height / R, y0 + span);
    if (ex <= sx || ey <= sy) return;
    const k = TILE / span;
    g.drawImage(img, sx * R, sy * R, (ex - sx) * R, (ey - sy) * R, (sx - x0) * k, (sy - y0) * k, (ex - sx) * k, (ey - sy) * k);
  }

  renderTile(L, tx, ty) {
    const cv = this.pool.pop() || Object.assign(document.createElement('canvas'), { width: TILE, height: TILE });
    const g = cv.getContext('2d');
    g.save();   // (le canevas resservira : son état revient à zéro à la fin ; le fond opaque efface l'ancienne tuile)
    const span = TILE / L, x0 = tx * span, y0 = ty * span;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const P = PAPIER[this.era];
    g.fillStyle = P ? rgb(P.mer) : '#1f5c6c';
    g.fillRect(0, 0, TILE, TILE);
    this.drawSub(g, this.oceanCanvas, x0, y0, span);
    const W = (px) => g.setTransform(L, 0, 0, L, -x0 * L, -y0 * L);
    W();
    const i0 = Math.max(0, Math.floor(x0) - 2), i1 = Math.min(this.W - 1, Math.ceil(x0 + span) + 2);
    const j0 = Math.max(0, Math.floor(y0) - 2), j1 = Math.min(this.H - 1, Math.ceil(y0 + span) + 2);
    // vagues
    if (L >= 4 && !P) {
      g.strokeStyle = 'rgba(214,240,232,0.22)';
      g.lineWidth = Math.max(0.07, 0.8 / L);
      g.beginPath();
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * this.W + i;
        if (this.terrain[c] !== T.OCEAN) continue;
        if (hash(i, j, 31) < 0.22) {
          const x = i + hash(i, j, 32), y = j + hash(i, j, 33);
          g.moveTo(x - 0.35, y); g.quadraticCurveTo(x - 0.17, y - 0.16, x, y); g.quadraticCurveTo(x + 0.17, y - 0.16, x + 0.35, y);
        }
      }
      g.stroke();
    }
    // côte : un liseré d'écume, puis la tranche de terre brune sous le rivage (les terres ont de l'épaisseur)
    const bank = Math.max(0.07, 2.4 / L);
    g.lineJoin = 'round';
    if (P) {
      // carte gravée : les côtes ourlées de lignes d'eau, de plus en plus espacées vers le large
      const line = Math.max(0.04, 0.95 / L), step = Math.max(0.1, 2.6 / L);
      for (let k = 5; k >= 1; k--) {
        const r = step * k * (1 + k * 0.3);
        g.strokeStyle = rgb(P.ligne, 0.3 + 0.12 * (5 - k)); g.lineWidth = 2 * r + line; g.stroke(this.landPath);
        g.strokeStyle = rgb(P.mer); g.lineWidth = 2 * r - line; g.stroke(this.landPath);
      }
    } else {
    g.strokeStyle = 'rgba(226,244,232,0.5)'; g.lineWidth = bank * 2.6; g.stroke(this.landPath);
    g.save(); g.translate(bank * 0.25, bank);
    g.fillStyle = '#4b3b27'; g.fill(this.landPath, 'nonzero');
    g.restore();
    }
    // terres
    g.save();
    g.clip(this.landPath, 'nonzero');
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSub(g, this.landCanvas, x0, y0, span, RL);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = P ? 0.4 : 0.3;
    const pat = g.createPattern(this.grain, 'repeat');
    g.fillStyle = pat;
    g.fillRect(0, 0, TILE, TILE);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    W();
    if (L >= 4) this.decorate(g, L, i0, i1, j0, j1);
    // hors du jeu : voile sombre suivant le tracé exact des départements (et non les cases d'1 km)
    g.fillStyle = P ? 'rgba(110,96,74,0.3)' : 'rgba(30,32,30,0.5)';
    g.fill(this.outPath, 'evenodd');
    g.restore();
    W();
    // le trait de côte, à l'encre
    if (P) { g.strokeStyle = rgb(P.encre, 0.85); g.lineWidth = Math.max(0.04, 1.1 / L); g.stroke(this.landPath); }
    // eaux intérieures
    if (P) {
      g.fillStyle = rgb(P.t[T.EAU]); g.fill(this.waterPath);
      g.strokeStyle = rgb(P.ligne, 0.9); g.lineWidth = Math.max(0.04, 0.9 / L); g.stroke(this.waterPath);
    } else {
    g.strokeStyle = '#4b3b27';
    g.lineWidth = Math.max(0.12, 2.6 / L);
    g.stroke(this.waterPath);
    g.fillStyle = '#4f9a98';
    g.fill(this.waterPath);
    g.strokeStyle = 'rgba(226,244,232,0.35)';
    g.lineWidth = Math.max(0.05, 0.9 / L);
    g.stroke(this.waterPath);
    }
    // rivières
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of this.riverPaths) {
      const w = r.rank === 1 ? 0.75 : r.rank === 2 ? 0.42 : 0.26;
      const mn = r.rank === 1 ? 3.2 : r.rank === 2 ? 2.1 : 1.3;
      const ww = Math.max(w, mn / L);
      if (P) {
        // à l'encre bleue : les fleuves en deux traits, les rivières d'un seul
        g.strokeStyle = rgb(P.ligne, 0.95); g.lineWidth = r.rank === 1 ? ww * 0.8 + 1.4 / L : ww * 0.45; g.stroke(r.p);
        if (r.rank === 1) { g.strokeStyle = rgb(P.t[T.EAU]); g.lineWidth = ww * 0.8; g.stroke(r.p); }
        continue;
      }
      // berges brunes, eau vert-de-gris, reflet clair au milieu
      g.strokeStyle = 'rgba(70,58,36,0.85)'; g.lineWidth = ww + 2 / L; g.stroke(r.p);
      g.strokeStyle = '#6aa3a0'; g.lineWidth = ww; g.stroke(r.p);
      if (L >= 8) { g.strokeStyle = 'rgba(190,226,218,0.55)'; g.lineWidth = ww * 0.3; g.stroke(r.p); }
    }
    // voies navigables (fleuves à gabares) et route du cabotage
    for (const w of this.wayPaths) {
      const bx = w.box;
      if (bx[2] < x0 - 1 || bx[0] > x0 + span + 1 || bx[3] < y0 - 1 || bx[1] > y0 + span + 1) continue;
      if (w.sea) {
        g.strokeStyle = P ? rgb(P.ligne, 0.55) : 'rgba(235,246,255,0.55)';
        g.lineWidth = Math.max(0.12, 1.1 / L);
        const d = Math.max(0.6, 5 / L);
        g.setLineDash([d * 0.5, d]);
      } else {
        if (L < 4) continue;
        g.strokeStyle = P ? rgb(P.ligne, 0.7) : 'rgba(232,244,255,0.75)';
        g.lineWidth = Math.max(0.08, 0.9 / L);
        const d = Math.max(0.5, 4 / L);
        g.setLineDash([d * 1.4, d]);
      }
      g.stroke(w.p);
    }
    g.setLineDash([]);
    // limites des départements
    g.save();
    g.strokeStyle = P ? rgb(P.encre, 0.6) : 'rgba(62,44,24,0.55)';
    g.lineWidth = Math.max(0.16, 1.3 / L);
    const dl = Math.max(0.8, 6 / L);
    g.setLineDash(P ? [dl, dl * 0.35, dl * 0.12, dl * 0.35] : [dl, dl * 0.7]);   // (trait-point des limites gravées)
    for (const p of Object.values(this.deptPaths)) g.stroke(p);
    g.restore();
    // routes
    this.drawRoads(g, L, x0, y0, span);
    // territoires, puis frontières (au zoom de ce niveau)
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSub(g, this.fillCanvas, x0, y0, span, 3);
    W();
    const z = L * 0.88 / this.dpr;   // (le zoom moyen auquel s'affiche ce niveau : voir level)
    g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash([]);
    const m = Math.max(1.4, 11 / z), bx0 = x0 - m, by0 = y0 - m, bx1 = x0 + span + m, by1 = y0 + span + m;
    for (const fr of this.frontiers) {
      const path = new Path2D();
      for (const c of fr.parts) if (c.box[0] < bx1 && c.box[2] > bx0 && c.box[1] < by1 && c.box[3] > by0) path.addPath(c.p);
      const col = this.colors[fr.code];
      g.strokeStyle = col;
      g.globalAlpha = 0.16; g.lineWidth = Math.max(1.4, 11 / z); g.stroke(path);
      g.globalAlpha = 0.35; g.lineWidth = Math.max(0.7, 5.5 / z); g.stroke(path);
      g.globalAlpha = 0.95; g.lineWidth = Math.max(0.25, 2.4 / z); g.stroke(path);
      g.strokeStyle = lighten(col, 0.6); g.globalAlpha = 0.7; g.lineWidth = Math.max(0.08, 0.8 / z); g.stroke(path);
      g.globalAlpha = 1;
    }
    g.restore();
    cv.gen = this.tileGen;
    return cv;
  }

  drawRoads(g, L, x0, y0, span) {
    const vis = ({ box: b }) => b[2] > x0 - 1 && b[0] < x0 + span + 1 && b[3] > y0 - 1 && b[1] < y0 + span + 1;
    const es = this.edges.filter(e => !e.water && vis(e)), P = PAPIER[this.era];
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const e of es) {
        const royal = e.royal;
        let w = royal ? 0.34 : 0.2;
        w = Math.max(w, (royal ? 2.1 : 1.2) / L);
        if (pass === 0) { g.strokeStyle = P ? rgb(P.encre, 0.85) : 'rgba(74,60,36,0.6)'; g.lineWidth = w + 1.2 / L; }
        else { g.strokeStyle = P ? (royal && this.era === 'etatmajor' ? '#dcae6a' : rgb(P.papier)) : royal ? '#e8d8a8' : '#d6c497'; g.lineWidth = w; }
        g.globalAlpha = royal || L >= 8 ? 1 : 0.6;
        if (e.ferry) { g.setLineDash([w * 2, w * 1.6]); } else g.setLineDash([]);
        g.stroke(e.path);
      }
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    // ponts et bacs
    for (const e of es) {
      if (e.bx == null) continue;
      const len = Math.max(e.rrank === 1 ? 1.2 : 0.8, 7 / L), wid = Math.max(0.5, 3.2 / L);
      g.save();
      g.translate(e.bx, e.by);
      g.rotate(e.bang);
      if (e.ferry) {
        g.fillStyle = '#6b4a2e';
        g.beginPath(); g.ellipse(0, 0, len * 0.45, wid * 0.4, 0, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#4a3320';
        g.fillRect(-len / 2 - 0.05, -wid / 2 - 0.08, len + 0.1, wid + 0.16);
        g.fillStyle = '#b48656';
        g.fillRect(-len / 2, -wid / 2, len, wid);
        if (L >= 8) {
          g.strokeStyle = 'rgba(60,40,22,0.7)'; g.lineWidth = 0.6 / L;
          g.beginPath();
          for (let s = -len / 2 + len / 7; s < len / 2; s += len / 7) { g.moveTo(s, -wid / 2); g.lineTo(s, wid / 2); }
          g.stroke();
        }
      }
      g.restore();
    }
  }

  decorate(g, L, i0, i1, j0, j1) {
    const W = this.W, P = PAPIER[this.era], hach = new Path2D(), hf = this.hgt;
    const big = L >= 8;
    const trees = { sh: new Path2D(), c: [new Path2D(), new Path2D(), new Path2D(), new Path2D()], lit: new Path2D(), hi: new Path2D() };
    const pines = new Path2D();
    const shrubs = [new Path2D(), new Path2D()];
    const pools = new Path2D();
    const reeds = new Path2D();
    const dunes = new Path2D();
    const hillL = new Path2D(), hillD = new Path2D();
    const peaks = [];
    const fields = [];
    const circle = (p, x, y, r) => { p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2); };
    const treeSc = L >= 16 ? 1 : L >= 8 ? 1.25 : 1.9;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * W + i;
        const t = this.terrain[c];
        if (t <= T.EAU) continue;
        const h = (k) => hash(i, j, k);
        if (P && i > 0 && j > 0 && i < W - 1 && j < this.H - 1) {
          // hachures : de courts traits dans le sens de la pente, d'autant plus serrés que le versant est raide
          const gx = (hf[c + 1] - hf[c - 1]) * 0.5, gy = (hf[c + W] - hf[c - W]) * 0.5, m = Math.hypot(gx, gy);
          const n = Math.min(big ? 9 : 5, Math.floor((m - 0.03) * (big ? 70 : 40) + h(199)));   // (rien sur les plaines : pente < 0,03)
          if (n > 0) {
            const ux = gx / m, uy = gy / m, len = clamp(0.5 - m * 2, 0.18, 0.42);
            for (let k = 0; k < n; k++) {
              const x = i + h(200 + k), y = j + h(220 + k), l = len * (0.7 + h(240 + k) * 0.5);
              hach.moveTo(x - ux * l * 0.5, y - uy * l * 0.5); hach.lineTo(x + ux * l * 0.5, y + uy * l * 0.5);
            }
          }
        }
        if (t === T.FORET) {
          // une futaie dense de houppiers ronds : ombre portée au sud-est, côté éclairé au nord-ouest
          const n = L >= 16 ? 7 : L >= 8 ? 5 : 3;
          for (let k = 0; k < n; k++) {
            const x = i + h(k * 3 + 1), y = j + h(k * 3 + 2), r = (0.22 + h(k * 3 + 3) * 0.14) * treeSc;
            trees.sh.moveTo(x + r * 0.5 + r, y + r * 0.55); trees.sh.ellipse(x + r * 0.5, y + r * 0.55, r, r * 0.7, 0, 0, Math.PI * 2);
            const v = h(k + 40);
            circle(trees.c[v < 0.06 ? 3 : (v * 3) | 0], x, y, r);
            circle(trees.lit, x - r * 0.26, y - r * 0.28, r * 0.62);
            if (big) circle(trees.hi, x - r * 0.4, y - r * 0.44, r * 0.26);
          }
        } else if (t === T.LANDE) {
          // (epoque.js) les semis de pins, puis la loi de 1857, font de la lande rase une forêt de pins
          const mk = this.epoque.at(i, j), np = mk?.has('landes1857') ? 4 : mk?.has('pins') ? 2 : 1, pp = mk?.has('landes1857') ? 0.95 : mk?.has('pins') ? 0.7 : 0.35;
          if (big && np === 1) for (let k = 0; k < 4; k++) circle(shrubs[k & 1], i + h(k + 1), j + h(k + 6), 0.09 + h(k + 11) * 0.05);
          for (let k = 0; k < np; k++) if (h(20 + k * 5) < pp) {
            const x = i + h(21 + k * 5), y = j + h(22 + k * 5), r = 0.22 * treeSc;
            trees.sh.moveTo(x + r * 1.4, y + r * 0.5); trees.sh.ellipse(x + r * 0.4, y + r * 0.5, r, r * 0.6, 0, 0, Math.PI * 2);
            circle(pines, x, y, r);
          }
        } else if (t === T.MARAIS) {
          if (h(1) < (this.epoque.at(i, j)?.has('drainage') ? 0.2 : 0.6)) {   // drainés, les marais n'ont plus que quelques mares
            const x = i + h(2), y = j + h(3);
            pools.moveTo(x + 0.34, y); pools.ellipse(x, y, 0.34, 0.16, h(4) * 0.6, 0, Math.PI * 2);
          }
          if (big) for (let k = 0; k < 3; k++) {
            const x = i + h(k + 10), y = j + h(k + 14);
            reeds.moveTo(x, y); reeds.lineTo(x - 0.04, y - 0.22); reeds.moveTo(x + 0.06, y); reeds.lineTo(x + 0.1, y - 0.2);
          }
        } else if (t === T.COLLINES) {
          if (!P && h(1) < 0.32) {
            const x = i + h(2), y = j + h(3), r = 0.6 + h(4) * 0.4;
            hillL.moveTo(x - r, y); hillL.quadraticCurveTo(x - r * 0.5, y - r * 0.75, x, y - r * 0.55);
            hillD.moveTo(x, y - r * 0.55); hillD.quadraticCurveTo(x + r * 0.5, y - r * 0.4, x + r, y);
          }
        } else if (t === T.MONTAGNE || t === T.HAUTE) {
          if (!P && h(1) < (t === T.HAUTE ? 0.9 : 0.62)) peaks.push([i + h(2), j + h(3) + 0.4, (t === T.HAUTE ? 1.25 : 0.85) + h(4) * 0.55, t === T.HAUTE]);
        } else if (t === T.DUNES) {
          if (h(1) < 0.7) {
            const x = i + h(2) * 0.6, y = j + h(3);
            dunes.moveTo(x, y); dunes.quadraticCurveTo(x + 0.2, y - 0.18, x + 0.4, y); dunes.quadraticCurveTo(x + 0.6, y + 0.18, x + 0.8, y);
          }
        }
        if ((t === T.PLAINE || t === T.COLLINES) && this.fieldAngle[c] > -50 && L >= 8 && !P) {
          const n = 2;
          for (let k = 0; k < n; k++) {
            if (h(60 + k) < 0.25) continue;
            // (epoque.js) maïs de Chalosse et du Béarn, prairies et cultures variées de l'assolement
            const mk = this.epoque.at(i, j), dc = this.deptCodes[this.dept[c] - 1];
            const extra = mk?.has('mais') && (dc === '40' || dc === '64') && h(72 + k) < 0.5 ? 5 : mk?.has('assolement') && h(73 + k) < 0.35 ? 6 + ((h(74 + k) * 2) | 0) : -1;
            fields.push([i + h(61 + k * 4), j + h(62 + k * 4), 0.45 + h(63 + k * 4) * 0.35, 0.3 + h(64 + k * 4) * 0.25,
                         this.fieldAngle[c], extra >= 0 ? extra : (h(70 + k) * 5) | 0]);
          }
        } else if (t === T.PLAINE && h(50) < 0.05) {
          const x = i + h(51), y = j + h(52), r = 0.2 * treeSc;
          trees.sh.moveTo(x + r * 1.4, y + r * 0.5); trees.sh.ellipse(x + r * 0.4, y + r * 0.5, r, r * 0.6, 0, 0, Math.PI * 2);
          circle(trees.c[1], x, y, r);
        }
      }
    }
    // parcelles
    const fcol = this.season === 'hiver' ? ['#b9b39c', '#a89c80', '#c4c2b4', '#9c8a6c', '#cfcbbd']
      : ['#cfb563', '#bb9e55', '#9ea24f', '#ad8656', '#d8c47c', '#a9b84e', '#8ea65a', '#c7a46c'];   // (5 : maïs ; 6, 7 : luzerne, betterave)
    for (const [x, y, w, hgt, ang, ci] of fields) {
      g.save();
      g.translate(x, y); g.rotate(ang);
      g.fillStyle = fcol[ci];
      g.fillRect(-w / 2, -hgt / 2, w, hgt);
      g.strokeStyle = 'rgba(70,56,26,0.4)'; g.lineWidth = 0.7 / L;
      g.strokeRect(-w / 2, -hgt / 2, w, hgt);
      if (L >= 16 && ci !== 2) {
        g.beginPath();
        for (let s = -w / 2 + 0.06; s < w / 2; s += 0.07) { g.moveTo(s, -hgt / 2); g.lineTo(s, hgt / 2); }
        g.strokeStyle = 'rgba(110,80,40,0.22)'; g.stroke();
      }
      g.restore();
    }
    g.lineCap = 'round';
    g.fillStyle = 'rgba(96,82,44,0.45)'; g.fill(shrubs[0]);
    g.fillStyle = 'rgba(128,84,110,0.45)'; g.fill(shrubs[1]);
    g.fillStyle = P ? rgb(P.t[T.EAU]) : 'rgba(84,140,132,0.85)'; g.fill(pools);
    g.strokeStyle = P ? rgb(P.ligne, 0.8) : 'rgba(58,70,44,0.6)'; g.lineWidth = 0.6 / L; g.stroke(pools);
    g.strokeStyle = P ? rgb(P.ligne, 0.7) : 'rgba(70,98,52,0.8)'; g.lineWidth = Math.max(0.03, 0.7 / L); g.stroke(reeds);
    this.vineyards(g, L, i0, i1, j0, j1, P);
    if (P) {
      g.strokeStyle = rgb(P.hach, 0.75); g.lineWidth = Math.max(0.025, 0.75 / L); g.stroke(hach);
      // bois en petits arbres cernés d'encre, sans ombre ni reflet
      g.strokeStyle = rgb(P.encre, 0.75); g.lineWidth = Math.max(0.02, 0.6 / L);
      for (const p of trees.c) { g.fillStyle = P.bois; g.fill(p); g.stroke(p); }
      g.fillStyle = P.pins; g.fill(pines); g.stroke(pines);
      return;
    }
    g.strokeStyle = 'rgba(176,150,96,0.7)'; g.lineWidth = Math.max(0.05, 0.8 / L); g.stroke(dunes);
    g.lineWidth = Math.max(0.1, 1.2 / L);
    g.strokeStyle = 'rgba(214,206,150,0.35)'; g.stroke(hillL);
    g.strokeStyle = 'rgba(60,70,34,0.3)'; g.stroke(hillD);
    const winter = this.season === 'hiver', autumn = this.season === 'automne';
    const crowns = winter ? ['#2b3727', '#33402d', '#3c4833', '#4a4a3c'] : autumn ? ['#4a5424', '#62602a', '#77592a', '#8c4a22'] : ['#30431d', '#3b5121', '#475e25', '#7d7a2c'];
    g.fillStyle = 'rgba(14,22,8,0.45)'; g.fill(trees.sh);
    crowns.forEach((c, k) => { g.fillStyle = c; g.fill(trees.c[k]); });
    g.fillStyle = winter ? 'rgba(222,228,230,0.55)' : autumn ? 'rgba(178,150,70,0.6)' : 'rgba(104,128,50,0.75)'; g.fill(trees.lit);
    g.fillStyle = winter ? '#283326' : '#2c4022'; g.fill(pines);
    if (big) { g.fillStyle = winter ? 'rgba(250,252,255,0.75)' : 'rgba(176,190,96,0.5)'; g.fill(trees.hi); }
    // sommets
    for (const [x, y, s, high] of peaks) {
      const hgt = s * 0.95, half = s * 0.62;
      g.fillStyle = 'rgba(30,30,20,0.25)';
      g.beginPath(); g.moveTo(x, y - hgt); g.lineTo(x + half * 1.35, y + 0.08); g.lineTo(x + half * 0.2, y + 0.08); g.fill();
      g.fillStyle = '#c3c2a7';
      g.beginPath(); g.moveTo(x - half, y); g.lineTo(x, y - hgt); g.lineTo(x + 0.08, y); g.fill();
      g.fillStyle = '#7f826c';
      g.beginPath(); g.moveTo(x, y - hgt); g.lineTo(x + half, y); g.lineTo(x + 0.08, y); g.fill();
      if (high || winter) {
        const k = high ? 0.42 : 0.3;
        g.fillStyle = '#f6f7f5';
        g.beginPath(); g.moveTo(x, y - hgt); g.lineTo(x - half * k, y - hgt * (1 - k)); g.lineTo(x - half * k * 0.2, y - hgt * (1 - k * 0.8));
        g.lineTo(x + half * k * 0.4, y - hgt * (1 - k)); g.lineTo(x + half * k, y - hgt * (1 - k)); g.closePath(); g.fill();
      }
      if (L >= 8) {
        g.strokeStyle = 'rgba(50,50,36,0.55)'; g.lineWidth = 0.6 / L;
        g.beginPath(); g.moveTo(x - half, y); g.lineTo(x, y - hgt); g.lineTo(x + half, y); g.stroke();
      }
    }
  }

  // part de vigne autour d'un point (interpolée entre les centres des cases d'1 km)
  vineAt(x, y) {
    const u = x - 0.5, v = y - 0.5, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
    const at = (a, b) => (a < 0 || b < 0 || a >= this.W || b >= this.H) ? 0 : this.terrain[b * this.W + a] === T.VIGNE ? 1 : 0;
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // vignobles : un patchwork de parcelles sur une grille inclinée, sans rapport avec les cases du terrain,
  // aux rangs orientés parcelle par parcelle. La lisière suit un champ lissé et bruité : plus de marches d'escalier.
  vineyards(g, L, i0, i1, j0, j1, pap) {
    const S = 0.62, th = 0.38, ca = Math.cos(th), sa = Math.sin(th);
    let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity;
    for (const [x, y] of [[i0, j0], [i1 + 1, j0], [i0, j1 + 1], [i1 + 1, j1 + 1]]) {
      const p = (x * ca + y * sa) / S, q = (-x * sa + y * ca) / S;
      pmin = Math.min(pmin, p); pmax = Math.max(pmax, p); qmin = Math.min(qmin, q); qmax = Math.max(qmax, q);
    }
    const tones = pap ? [pap.vigne] : ['rgba(122,156,64,0.34)', 'rgba(168,156,92,0.3)', 'rgba(108,146,58,0.3)', 'rgba(176,170,104,0.26)', 'rgba(136,164,70,0.22)'];
    const plots = tones.map(() => new Path2D()), brown = new Path2D();
    const rows = new Path2D();
    const sp = Math.max(0.085, 2.4 / L), half = S * 0.5 - Math.max(0.025, 0.8 / L);
    const P = (cx, cy, u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
    for (let q = Math.floor(qmin) - 1; q <= qmax; q++) {
      for (let p = Math.floor(pmin) - 1; p <= pmax; p++) {
        const h = k => hash(p, q, 900 + k);
        const pc = p + 0.5 + (h(1) - 0.5) * 0.16, qc = q + 0.5 + (h(2) - 0.5) * 0.16;
        const cx = (pc * ca - qc * sa) * S, cy = (pc * sa + qc * ca) * S;
        if (cx < i0 - 1 || cx > i1 + 2 || cy < j0 - 1 || cy > j1 + 2) continue;
        const m = this.vineAt(cx, cy) + (vnoise(cx * 0.8, cy * 0.8, 41) - 0.5) * 0.55;
        if (m < 0.5 || h(7) < 0.1) continue;   // quelques parcelles en friche ou en prés
        // vers la lisière, les parcelles rapetissent : le vignoble se fond dans la campagne
        const edge = clamp((m - 0.5) / 0.3, 0.45, 1);
        const hw = half * (0.72 + h(3) * 0.3) * edge, hh = half * (0.72 + h(4) * 0.3) * edge;
        // (epoque.js) de 1875 aux plants greffés, le phylloxéra roussit les parcelles
        const pl = phylloxera(this.epoque.year, this.epoque.at(clamp(Math.floor(cx), 0, this.W - 1), clamp(Math.floor(cy), 0, this.H - 1))) && h(8) < 0.7 ? brown : plots[(h(5) * tones.length) | 0];
        const c0 = P(cx, cy, -hw, -hh);
        pl.moveTo(c0[0], c0[1]);
        for (const [u, v] of [[hw, -hh], [hw, hh], [-hw, hh]]) { const c = P(cx, cy, u, v); pl.lineTo(c[0], c[1]); }
        pl.closePath();
        if (L < 8) continue;
        const along = h(6) < 0.5;
        const lim = along ? hh : hw, len = along ? hw : hh;
        for (let t = -lim + sp * 0.5; t < lim; t += sp) {
          const a = along ? P(cx, cy, -len, t) : P(cx, cy, t, -len), b = along ? P(cx, cy, len, t) : P(cx, cy, t, len);
          rows.moveTo(a[0], a[1]); rows.lineTo(b[0], b[1]);
        }
      }
    }
    plots.forEach((pl, k) => { g.fillStyle = tones[k]; g.fill(pl); });
    g.fillStyle = 'rgba(150,104,56,0.42)'; g.fill(brown);
    if (L >= 8) {
      g.lineCap = 'round';
      g.strokeStyle = pap ? rgb(pap.encre, 0.45) : 'rgba(58,92,34,0.5)'; g.lineWidth = Math.max(0.03, 0.9 / L);
      if (pap) g.setLineDash([Math.max(0.02, 0.8 / L), sp * 0.7]);   // (des ceps pointés, comme sur les gravures)
      g.stroke(rows);
      g.setLineDash([]);
    }
  }

  // ------------------------------------------------------------------ dessin
  frame(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.camAnim) {
      const a = this.camAnim, k = Math.min(1, (now - a.t0) / a.dur), e = 1 - Math.pow(1 - k, 3);
      const lz = Math.log(a.from.z) + (Math.log(a.to.z) - Math.log(a.from.z)) * e;
      this.cam = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, z: Math.exp(lz) };
      if (k >= 1) this.camAnim = null;
    }
    if (this.inertia) {
      const iv = this.inertia;
      this.cam.x -= iv.vx * dt / this.cam.z;
      this.cam.y -= iv.vy * dt / this.cam.z;
      const k = Math.exp(-dt * 4.5);
      iv.vx *= k; iv.vy *= k;
      this.clampCam();
      if (Math.hypot(iv.vx, iv.vy) < 25) this.inertia = null;
    }
    if (this.dragTrail && this.dragTrail.end) {
      const [ex, ey] = this.dragTrail.end, m = 46, v = 420 * dt / this.cam.z;
      const ddx = ex < m ? -1 : ex > this.vw - m ? 1 : 0, ddy = ey < m + 60 ? -1 : ey > this.vh - m ? 1 : 0;
      if (ddx || ddy) { this.cam.x += ddx * v; this.cam.y += ddy * v; this.clampCam(); }
    }
    for (const d of this.disp.values()) {
      if (d.anim) {
        // marche instantanée du tour : on suit le trajet à vitesse constante
        const an = d.anim;
        an.t += dt;
        const k = Math.min(1, an.t / an.dur);
        let want = k * an.len, i = 1;
        for (; i < an.pts.length; i++) {
          const sl = Math.hypot(an.pts[i][0] - an.pts[i - 1][0], an.pts[i][1] - an.pts[i - 1][1]);
          if (want <= sl || i === an.pts.length - 1) {
            const f = sl > 0 ? Math.min(1, want / sl) : 1;
            d.x = an.pts[i - 1][0] + (an.pts[i][0] - an.pts[i - 1][0]) * f;
            d.y = an.pts[i - 1][1] + (an.pts[i][1] - an.pts[i - 1][1]) * f;
            if (sl > 0.01) d.thead = Math.atan2(an.pts[i][1] - an.pts[i - 1][1], an.pts[i][0] - an.pts[i - 1][0]);
            break;
          }
          want -= sl;
        }
        if (k >= 1) d.anim = null;
      } else {
        const f = 1 - Math.exp(-dt * 7);
        d.x += (d.tx - d.x) * f;
        d.y += (d.ty - d.y) * f;
      }
      if (d.thead != null) {
        let dh = d.thead - d.head;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        d.head += dh * Math.min(1, dt * 5);
      }
    }
    const t0 = performance.now();
    this.draw(dt, now / 1000);
    this.drawFog();
    if (location.hash.includes('fps')) this.drawFps(t0, performance.now() - t0);
    requestAnimationFrame(t => this.frame(t));
  }

  // compteur (adresse terminée par #fps) : images par seconde et temps de dessin du processeur. Si le dessin est
  // court et les images rares, c'est la carte graphique qui peine
  drawFps(t0, ms) {
    const f = this.fps || (this.fps = { t: t0, dt: 0.016, ms });
    f.dt += ((t0 - f.t) / 1000 - f.dt) * 0.05; f.ms += (ms - f.ms) * 0.05; f.t = t0;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(this.vw - 310, 8, 302, 26);
    ctx.fillStyle = '#f1ead8'; ctx.font = '600 14px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${(1 / f.dt).toFixed(0)} img/s · dessin ${f.ms.toFixed(1)} ms · ${this.tiles.size} tuiles`, this.vw - 302, 21);
  }

  draw(dt, time) {
    const ctx = this.ctx, dpr = this.dpr, z = this.cam.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#141618';
    ctx.fillRect(0, 0, this.vw, this.vh);
    const [wx0, wy0] = this.toWorld(0, 0), [wx1, wy1] = this.toWorld(this.vw, this.vh);
    // fond rapide
    ctx.imageSmoothingEnabled = true;
    const ox = this.vw / 2 - this.cam.x * z, oy = this.vh / 2 - this.cam.y * z;
    // tuiles. Pendant un pincement ou un zoom animé, on garde le niveau en cours (agrandi ou réduit) au lieu
    // d'en repeindre un nouveau à chaque palier ; le bon niveau se peint quand le zoom se pose
    const now = performance.now();
    this.frameNo++;
    if (z !== this.lastZ) { this.zoomT = now; this.lastZ = z; }
    const want = this.level();
    if (!this.curL) this.curL = want;
    else if (want !== this.curL) {
      const sc = z * dpr / this.curL;
      if (now - this.zoomT > 180 || sc < 0.55 || sc > 1.9) { this.prevL = this.curL; this.curL = want; }
    }
    const L = this.curL;
    const span = TILE / L;
    const tx0 = Math.floor(Math.max(0, wx0) / span), tx1 = Math.floor((Math.min(this.W, wx1) - 0.001) / span);
    const ty0 = Math.floor(Math.max(0, wy0) / span), ty1 = Math.floor((Math.min(this.H, wy1) - 0.001) / span);
    const nVis = Math.max(0, tx1 - tx0 + 1) * Math.max(0, ty1 - ty0 + 1);
    this.tileLimit = clamp(Math.ceil(nVis * 1.6) + 24, 160, 320);
    // tuiles à peindre, du centre vers les bords, dans un budget de temps par image (au moins une)
    const missing = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (this.getTile(L, tx, ty, false)?.gen !== this.tileGen) missing.push([tx, ty]);
    if (missing.length) {
      const cx = (wx0 + wx1) / 2 / span - 0.5, cy = (wy0 + wy1) / 2 / span - 0.5;
      missing.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      // (6 au plus : la carte graphique les peint après coup, le chronomètre ne voit pas tout son travail)
      for (const [k, [tx, ty]] of missing.entries()) {
        this.getTile(L, tx, ty, true);
        if (performance.now() - now > 6 || k >= 5) break;
      }
    } else if (now - this.zoomT > 300 && this.tiles.size + 12 < this.tileLimit) {
      // tout est prêt : on prépare une tuile de la couronne autour de l'écran, pour les déplacements
      for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
        if (tx < 0 || ty < 0 || tx * span >= this.W || ty * span >= this.H || this.getTile(L, tx, ty, false)) continue;
        this.getTile(L, tx, ty, true); ty = ty1 + 2; break;
      }
    }
    // feuille de carte
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    // (seules ses deux bandes dépassent de la carte opaque : la peindre entière coûtait un plein écran par image)
    ctx.fillRect(ox + this.W * z, oy + 8, 6, this.H * z);
    ctx.fillRect(ox + 6, oy + this.H * z, this.W * z - 6, 8);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, this.W * z, this.H * z); ctx.clip();
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.getTile(L, tx, ty, false);
        const dx = ox + tx * span * z, dy = oy + ty * span * z, ds = span * z;
        if (t) ctx.drawImage(t, dx, dy, ds + 0.6, ds + 0.6);
        else this.drawFallback(ctx, L, tx, ty, ox, oy, z);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(150,142,116,0.7)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(ox - 4, oy - 4, this.W * z + 8, this.H * z + 8);
    ctx.strokeStyle = 'rgba(150,142,116,0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(ox - 8, oy - 8, this.W * z + 16, this.H * z + 16);
    // territoires
    // (le voile et les frontières sont peints dans les tuiles : retracés à chaque image, ils en coûtaient le tiers)
    ctx.save();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (this.highlightDept && this.deptPaths[this.highlightDept]) {
      const col = this.colors[this.highlightDept];
      ctx.fillStyle = col; ctx.globalAlpha = 0.28 + 0.1 * Math.sin(time * 3);
      ctx.fill(this.deptPaths[this.highlightDept]);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.6, 4 / z);
      ctx.stroke(this.deptPaths[this.highlightDept]);
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSeasonTint(ctx);
    this.now = time;
    const st = this.state || this.preview;
    this.ambient.under(ctx, dt, time, this.state);
    this.drawWaterNames(ctx);
    if (!this.state) {
      // (l'écran de départ : la carte de l'époque choisie, voies ferrées et trains compris)
      this.drawRails(ctx, st); this.ambient.drawTrains(ctx, time, st); this.epoque.draw(ctx, time, st);
      this.drawNodes(ctx, time, st); this.drawBattles(ctx, dt, time); this.drawParticles(ctx, dt);   // (la bataille de la cinématique, intro.js)
      for (const t of st.tokens || []) {
        const [x, y] = this.toScreen(t.x, t.y);
        ctx.save(); ctx.translate(x, y); this.drawToken(ctx, t, t, this.colors[t.o] || '#999', false, time); ctx.restore();
      }
      this.ambient.over(ctx, dt, time, null); this.drawVignette(ctx); this.drawGesture(ctx); return;
    }
    this.drawRails(ctx, st);
    this.ambient.drawTrains(ctx, time, st);
    this.epoque.draw(ctx, time, st);
    this.drawNodes(ctx, time, st);
    this.drawPaths(ctx);
    this.drawArmies(ctx, time);
    this.drawBattles(ctx, dt, time);
    this.drawParticles(ctx, dt);
    // éclats d'or des découvertes (decouvertes.js) : trois anneaux qui s'ouvrent sur le chef-lieu
    if (this.flashes?.length) {
      const nowMs = performance.now();
      this.flashes = this.flashes.filter(f => nowMs - f.t0 < 2600);
      for (const f of this.flashes) {
        const [x, y] = this.toScreen(f.x, f.y), age = (nowMs - f.t0) / 2600;
        for (let k = 0; k < 3; k++) {
          const u = Math.max(0, Math.min(1, age * 1.4 - k * 0.18));
          if (u <= 0 || u >= 1) continue;
          ctx.strokeStyle = `rgba(243,217,142,${0.9 * (1 - u)})`; ctx.lineWidth = 3 * (1 - u) + 1;
          ctx.beginPath(); ctx.arc(x, y, 12 + u * 90, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    this.ambient.over(ctx, dt, time, st);
    this.drawWeather(ctx, dt, time);
    this.drawVignette(ctx);
    this.drawGesture(ctx);
  }

  drawFog() {
    // brouillard de guerre : on ne voit que ce que voient vos villes, vos armées, vos alliés et vos espions.
    // Il est peint en basse résolution sur un calque séparé, que le navigateur agrandit et superpose à la carte.
    const el = this.fogEl || (this.fogEl = document.getElementById('fog'));
    if (!el) return;
    const st = this.state;
    const startEl = this.startEl || (this.startEl = document.getElementById('start'));
    const on = this.fogOn && st && st.vis && !(startEl && !startEl.hidden);
    const k = 0.25;
    const w = Math.max(1, Math.ceil(this.vw * k)), h = Math.max(1, Math.ceil(this.vh * k));
    const c = this.cam;
    const sig = on ? `${w}x${h}|${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(3)}|${st.t}|${st.vis.length}` : 'off';
    if (sig === this.fogSig) return;
    this.fogSig = sig;
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    const g = el.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    if (!on) return;
    if (!this.holeSprite) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const gg = cv.getContext('2d'), gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.75, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
      this.holeSprite = cv;
    }
    const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(this.W, this.H);
    g.fillStyle = this.era ? 'rgba(96,74,44,0.36)' : 'rgba(20,17,12,0.42)';   // (sur le papier, un lavis de sépia)
    g.fillRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of st.vis) {
      const [sx, sy] = this.toScreen(x, y);
      const R = r * c.z * k * 1.1;
      if (sx * k + R < 0 || sy * k + R < 0 || sx * k - R > w || sy * k - R > h) continue;
      g.drawImage(this.holeSprite, sx * k - R, sy * k - R, 2 * R, 2 * R);
    }
    g.globalCompositeOperation = 'source-over';
  }

  anchor(ctx, x, y, s, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = s * 0.34;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45); ctx.lineTo(0, s * 0.45);
      ctx.moveTo(-s * 0.28, -s * 0.2); ctx.lineTo(s * 0.28, -s * 0.2);
      ctx.moveTo(-s * 0.42, s * 0.12); ctx.quadraticCurveTo(-s * 0.3, s * 0.48, 0, s * 0.45); ctx.quadraticCurveTo(s * 0.3, s * 0.48, s * 0.42, s * 0.12);
    };
    path(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = s * 0.14; path(); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // magasin aux vivres : un petit tonneau cerclé
  depot(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(14,20,30,.85)';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.52, s * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a0723f'; ctx.strokeStyle = '#3b2814'; ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.38, s * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#e6c97f'; ctx.lineWidth = Math.max(0.8, s * 0.07);
    ctx.beginPath(); ctx.moveTo(-s * 0.36, -s * 0.2); ctx.lineTo(s * 0.36, -s * 0.2); ctx.moveTo(-s * 0.36, s * 0.2); ctx.lineTo(s * 0.36, s * 0.2); ctx.stroke();
    ctx.restore();
  }

  eye(ctx, x, y, s, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(14,20,30,.85)';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.quadraticCurveTo(0, -s * 0.42, s * 0.5, 0); ctx.quadraticCurveTo(0, s * 0.42, -s * 0.5, 0); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, s * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // événement local en attente d'une décision : un sceau de cire qui palpite
  evMark(ctx, x, y, s, time) {
    const k = 1 + 0.12 * Math.sin(time / 260);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(14,20,30,.85)';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.62 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b8352a'; ctx.strokeStyle = '#e6c97f'; ctx.lineWidth = Math.max(1, s * 0.09);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.48 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fbf6e6'; ctx.font = `700 ${Math.round(s * 0.7)}px Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', 0, s * 0.04);
    ctx.restore();
  }

  drawSeasonTint(ctx) {
    this.epoque.teinte(ctx);
    const tint = this.era ? null : { hiver: 'rgba(214,228,248,0.17)', automne: 'rgba(222,140,60,0.07)', 'été': 'rgba(255,232,140,0.05)' }[this.season];
    if (tint) {
      const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(this.W, this.H);
      ctx.fillStyle = tint; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  nodeSize(n) {
    const ns = this.state && this.state.nodes[n.id];
    return this.baseSize(n) * (1 + 0.1 * ((ns && ns.d) || 0));   // une ville agrandie s'étale
  }

  baseSize(n) {
    const z = this.cam.z;
    if (n.type === 'capitale') return clamp(z * 3, 22, 84);
    if (n.type === 'ville') return clamp(z * 2.2, 15, 60);
    if (n.type === 'fort') return clamp(z * 1.8, 13, 48);
    return clamp(z * 1.5, 9, 40);
  }

  // taille du nom d'une place sur la carte
  labelFs(n) {
    const z = this.cam.z;
    return n.type === 'capitale' ? clamp(13 + z * 0.5, 15, 21) : n.type === 'village' ? clamp(10 + z * 0.25, 11, 15) : clamp(11 + z * 0.4, 13, 18);
  }

  drawNodes(ctx, time, st) {
    const z = this.cam.z;
    const labels = [];
    // armées en quartiers : quelques tentes autour de la place (couleur de leur camp)
    const camp = new Map();
    for (const a of st.armies) if (a.qr && a.n != null && a.st === 'idle') camp.set(a.n, a.o);
    for (const n of this.nodes) {
      const [x, y] = this.toScreen(n.x, n.y);
      const s = this.nodeSize(n);
      if (x < -s - 80 || y < -s - 40 || x > this.vw + s + 80 || y > this.vh + s + 40) continue;
      const ns = st.nodes[n.id];
      const col = this.colors[ns.o] || '#999';
      const sel = this.selection && this.selection.kind === 'node' && this.selection.id === n.id;
      ctx.save();
      ctx.translate(x, y);
      // halo
      ctx.fillStyle = col;
      ctx.globalAlpha = ns.o === 'neutre' ? 0.18 : 0.42;
      ctx.beginPath(); ctx.ellipse(0, s * 0.12, s * 0.62, s * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      if (sel) {
        ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(0, s * 0.12, s * 0.72 + 3, s * 0.5 + 3, 0, 0, Math.PI * 2); ctx.stroke();
      }
      const wallR = ns.f > 0 ? this.walls(ctx, s, ns.f, n.id, ns.sg && !ns.sg.occ && !ns.sg.bl ? ns.sg.dmg : 0) : 0;
      const worksR = ns.bar != null || ns.bw ? this.works(ctx, s, ns.f, n.id, ns.bar || 0, ns.bw, wallR) : 0;
      if (camp.has(n.id) && z >= 2.8) this.tents(ctx, s, n.id, this.colors[camp.get(n.id)] || col);
      this.towns.draw(ctx, n, s, col, ns, time, ns.o);
      // siège
      if (ns.sg && ns.sg.bl) this.blockadeRing(ctx, Math.max(s * 0.62 + 6, wallR + 6, worksR + 5), ns.sg, n.id);
      else if (ns.sg) {
        const sr = Math.max(s * 0.62 + 4, wallR + 4, worksR + 3);
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = this.colors[ns.sg.by] || '#f80'; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.arc(0, 0, sr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, ns.sg.dmg)); ctx.stroke();
      }
      if (n.quai && (z >= 3.2 || ns.bk)) this.anchor(ctx, -s * 0.62, s * 0.3, clamp(s * 0.36, 7, 13), ns.bk ? '#ff8a6a' : '#cfe8ff');
      if (ns.dp && z >= 3.2) this.depot(ctx, s * 0.62, s * 0.32, clamp(s * 0.34, 7, 12));
      if (ns.intel || ns.spy) this.eye(ctx, s * 0.62, -s * 0.5, clamp(s * 0.4, 9, 14), ns.intel ? '#f3d98e' : 'rgba(243,217,142,0.6)');
      if (ns.bw) this.worksBar(ctx, s, ns.bw[0]);
      if (ns.ev) this.evMark(ctx, -s * 0.6, -s * 0.55, clamp(s * 0.45, 10, 15), time);   // décision locale en attente
      ctx.restore();
      const showLabel = n.type === 'capitale' || (n.type !== 'village' && z >= 2.3) || z >= 4.8 || sel;
      if (showLabel) labels.push([n, x, y, s, ns]);
    }
    // étiquettes (les plus importantes d'abord, sans chevauchement)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const prio = { capitale: 0, ville: 1, fort: 2, village: 3 };
    labels.sort((a, b) => prio[a[0].type] - prio[b[0].type]);
    const placed = [];
    const P = PAPIER[this.era];
    for (const [n, x, y, s, ns] of labels) {
      // (carte d'époque : les villages en italique bas-de-casse, comme les gravaient Cassini et l'état-major)
      const fs = this.labelFs(n), fc = Math.round(fs * 0.8), vil = P && n.type === 'village', name = vil ? n.name : n.name.toLocaleUpperCase('fr-FR');
      ctx.font = `${vil ? 'italic 500' : n.type === 'capitale' ? 700 : 600} ${vil ? fc + 2 : fc}px "EB Garamond", Georgia, serif`;
      const ty = y + s * 0.5 + 3, ph = fc + 6;
      const tw = this.textW(ctx, name);
      const box = [x - tw / 2 - 9, ty, x + tw / 2 + 6, ty + ph];
      const isSel = this.selection && this.selection.kind === 'node' && this.selection.id === n.id;
      if (n.type !== 'capitale' && !isSel && placed.some(b => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      placed.push(box);
      if (P) {
        // le nom gravé à l'encre sur le papier, souligné d'un filet aux couleurs du camp qui tient la place
        ctx.strokeStyle = 'rgba(244,236,214,0.85)'; ctx.lineWidth = 3.5; ctx.strokeText(name, x, ty + 3.5);
        ctx.fillStyle = rgb(P.encre); ctx.fillText(name, x, ty + 3.5);
        if (!vil || isSel) { ctx.fillStyle = isSel ? '#b8862e' : this.colors[ns.o] || '#999'; ctx.fillRect(x - tw / 2, ty + fc + 5, tw, isSel ? 2.5 : 1.8); }
      } else if (n.type === 'village' && !isSel) {
        // un village : son nom seul, en capitales cernées de sombre (les plaques sont pour les villes et les forts)
        ctx.strokeStyle = 'rgba(24,26,22,0.8)'; ctx.lineWidth = 3;
        ctx.strokeText(name, x, ty + 3.5); ctx.fillStyle = '#eeebe2'; ctx.fillText(name, x, ty + 3.5);
      } else {
      // plaque d'ardoise, liseré à gauche aux couleurs du camp qui tient la place
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; roundRect(ctx, box[0] + 1.5, ty + 2, box[2] - box[0], ph, 3); ctx.fill();
      ctx.fillStyle = isSel ? 'rgba(52,56,60,0.95)' : 'rgba(30,33,36,0.88)'; roundRect(ctx, box[0], ty, box[2] - box[0], ph, 3); ctx.fill();
      ctx.strokeStyle = isSel ? '#e6c97f' : 'rgba(150,150,140,0.45)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = this.colors[ns.o] || '#999'; ctx.fillRect(box[0] + 1, ty + 1, 3.5, ph - 2);
      ctx.fillStyle = n.type === 'capitale' ? '#f0d48a' : '#eeebe2';
      ctx.fillText(name, x - 1.5, ty + 3.5);
      }
      // garnison
      const men = ns.m != null ? ns.m + (ns.g ? ns.g.reduce((a, r) => a + r[2], 0) : (ns.gm || 0)) : null;
      if (men != null && (z >= 3.2 || n.type === 'capitale')) {
        const txt = String(Math.round(men));
        ctx.font = `600 ${fs - 2}px "EB Garamond", Georgia, serif`;
        const w = this.textW(ctx, txt) + 10;
        const bx = x + s * 0.5 + 2, by = y - s * 0.45;
        ctx.fillStyle = 'rgba(32,35,38,0.88)';
        roundRect(ctx, bx, by, w, fs + 1, 4); ctx.fill();
        ctx.strokeStyle = this.colors[ns.o] || '#999'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#f1ead8'; ctx.textAlign = 'left';
        ctx.fillText(txt, bx + 5, by + 0.5);
        ctx.textAlign = 'center';
      }
      if (ns.q && ns.q.length && z >= 3) {
        ctx.fillStyle = '#e6c97f';
        ctx.beginPath(); ctx.arc(x - s * 0.55 - 4, y - s * 0.35, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // enceinte autour d'une place, selon son niveau : mur d'enceinte flanqué de tours (1), remparts épais (2),
  // tracé bastionné en pointes de flèche (3), bastions et demi-lunes à la Vauban (4).
  // Pendant un siège, la brèche s'ouvre à mesure que les canons travaillent. Retourne le rayon extérieur de l'ouvrage.
  walls(ctx, s, f, id, dmg) {
    // le tracé ne dépend que du niveau, de la taille, de la brèche et de la ville : on le garde en cache (Path2D)
    s = Math.round(s * 2) / 2;
    const db = dmg > 0.02 ? Math.round(dmg * 50) / 50 : 0;
    const key = `${f}|${s}|${db}|${id}`;
    let w = this.wallCache.get(key);
    if (!w) {
      w = this.wallGeom(s, f, id, db);
      if (this.wallCache.size > 400) this.wallCache.clear();
      this.wallCache.set(key, w);
    }
    const dark = 'rgba(28,22,14,0.9)', stone = f >= 4 ? '#f2e6c4' : '#e6d9b3';
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'; ctx.miterLimit = 6;
    for (const [w2, c] of [[w.lw + 2.6, dark], [w.lw, stone]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w2; ctx.stroke(w.ring);
      if (w.lunes) { ctx.lineWidth = w2 * 0.7; ctx.stroke(w.lunes); }
    }
    if (w.towersDark) {
      ctx.fillStyle = dark; ctx.fill(w.towersDark);
      ctx.fillStyle = stone; ctx.fill(w.towers);
    }
    if (w.rubble) { ctx.fillStyle = 'rgba(110,95,72,0.95)'; ctx.fill(w.rubble); }
    return w.outer;
  }

  // Fortification de fortune, dessinée autour de la place : sans remparts, une palissade de pieux appointés,
  // des gabions et un fossé ; devant des remparts, quelques redoutes de terre. Les pieux tombent avec l'usure ;
  // pendant les travaux, ils se dressent à mesure (bw = [avancement, jours, sorte]). Retourne le rayon extérieur.
  works(ctx, s, f, id, str, bw, wallR) {
    const TAU = Math.PI * 2, sq = 0.86, a0 = (id * 2.399) % TAU;
    const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r * sq];
    const keep = bw ? Math.max(str, bw[0]) : str;     // part des pieux encore debout
    const up = i => hash(id, i, 7) < keep;
    ctx.save();
    ctx.lineCap = 'round';
    if (f <= 0) {
      const R = s * 0.62 + 4, N = clamp(Math.round(R * 0.75), 14, 34);
      const len = clamp(s * 0.2, 4, 11), lw = clamp(s * 0.055, 1.5, 3.4);
      // fossé
      ctx.strokeStyle = `rgba(58,42,22,${0.35 + 0.4 * keep})`; ctx.lineWidth = clamp(s * 0.07, 2, 4.5);
      ctx.beginPath(); ctx.ellipse(0, 0, R + len + 3, (R + len + 3) * sq, 0, 0, TAU); ctx.stroke();
      // lices : deux traverses qui tiennent les pieux
      ctx.strokeStyle = `rgba(110,80,44,${0.5 + 0.4 * keep})`; ctx.lineWidth = Math.max(1, lw * 0.6);
      ctx.beginPath(); ctx.ellipse(0, 0, R + len * 0.35, (R + len * 0.35) * sq, 0, 0, TAU); ctx.stroke();
      // palissade : pieux penchés vers l'extérieur, la pointe claire
      for (const [w, c] of [[lw + 1.6, 'rgba(36,26,14,0.85)'], [lw, '#9b7444']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          if (!up(i)) continue;
          const a = a0 + i * TAU / N, [x1, y1] = P(a, R - 1), [x2, y2] = P(a + 0.04, R + len);
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#e2c890';
      for (let i = 0; i < N; i++) {
        if (!up(i)) continue;
        const [x, y] = P(a0 + i * TAU / N + 0.04, R + len);
        ctx.beginPath(); ctx.arc(x, y, lw * 0.45, 0, TAU); ctx.fill();
      }
      // gabions (paniers d'osier remplis de terre) aux entrées
      const gr = clamp(s * 0.1, 2.6, 6.5);
      for (let k = 0; k < 4; k++) {
        if (!up(100 + k)) continue;
        const [x, y] = P(a0 + (k + 0.5) * TAU / 4, R + len * 0.4);
        for (const dx of [-gr * 1.05, gr * 1.05]) {
          ctx.fillStyle = 'rgba(36,26,14,0.85)'; ctx.beginPath(); ctx.arc(x + dx, y, gr + 1, 0, TAU); ctx.fill();
          ctx.fillStyle = '#c4a46a'; ctx.beginPath(); ctx.arc(x + dx, y, gr, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(90,64,32,0.9)'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(x + dx - gr * 0.7, y); ctx.lineTo(x + dx + gr * 0.7, y);
          ctx.moveTo(x + dx, y - gr * 0.7); ctx.lineTo(x + dx, y + gr * 0.7); ctx.stroke();
        }
      }
      ctx.restore();
      return R + len + 3;
    }
    // redoutes : petits ouvrages de terre en pointe, devant l'enceinte
    const R = Math.max(wallR, s * 0.62) + clamp(s * 0.12, 4, 9), d = clamp(s * 0.14, 4, 10);
    for (let k = 0; k < 4; k++) {
      if (!up(200 + k)) continue;
      const a = a0 + (k + 0.25) * TAU / 4;
      const [cx, cy] = P(a, R), [tx, ty] = P(a, R + d), [lx, ly] = P(a - 0.3, R - d * 0.2), [rx, ry] = P(a + 0.3, R - d * 0.2);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(tx, ty); ctx.lineTo(rx, ry); ctx.quadraticCurveTo(cx, cy, lx, ly);
      ctx.fillStyle = '#a88a56'; ctx.fill();
      ctx.strokeStyle = 'rgba(36,26,14,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.strokeStyle = '#7d5f35'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(...P(a, R + d * 1.35)); ctx.stroke();
    }
    ctx.restore();
    return R + d;
  }

  // barre d'avancement des travaux, au-dessus de la place
  worksBar(ctx, s, frac) {
    const w = clamp(s * 1.1, 20, 54), h = 5, y = -s * 0.78 - 8;
    ctx.fillStyle = 'rgba(32,35,38,0.88)'; roundRect(ctx, -w / 2 - 1.5, y - 1.5, w + 3, h + 3, 3); ctx.fill();
    ctx.fillStyle = '#c9a25a'; ctx.fillRect(-w / 2, y, w * clamp(frac, 0.04, 1), h);
    ctx.strokeStyle = 'rgba(243,217,142,0.7)'; ctx.lineWidth = 0.8; ctx.strokeRect(-w / 2, y, w, h);
  }

  // blocus : un cordon de postes en pointillé, aux couleurs de l'assiégeant, sans brèche ; la faim en arc fin
  blockadeRing(ctx, r, sg, id) {
    const TAU = Math.PI * 2, col = this.colors[sg.by] || '#f80';
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.strokeStyle = 'rgba(20,14,8,.7)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = '#f3e7c6'; ctx.lineWidth = 3.4; ctx.stroke();
    ctx.lineDashOffset = 6; ctx.setLineDash([6, 6]);
    ctx.strokeStyle = col; ctx.lineWidth = 3.4; ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // postes de garde sur les routes de la place
    const n = 6, a0 = (id * 2.399) % TAU, p = 4;
    for (let k = 0; k < n; k++) {
      const a = a0 + k * TAU / n, x = Math.cos(a) * r, y = Math.sin(a) * r;
      ctx.fillStyle = 'rgba(20,14,8,0.9)'; ctx.fillRect(x - p - 1.2, y - p - 1.2, 2 * p + 2.4, 2 * p + 2.4);
      ctx.fillStyle = col; ctx.fillRect(x - p, y - p, 2 * p, 2 * p);
      ctx.fillStyle = '#f3e7c6'; ctx.fillRect(x - p * 0.35, y - p * 0.35, p * 0.7, p * 0.7);
    }
    // la faim gagne : arc intérieur
    ctx.strokeStyle = 'rgba(20,14,8,.6)'; ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.arc(0, 0, r - 5.5, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.03, sg.dmg)); ctx.stroke();
    ctx.strokeStyle = '#e8c070'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // tentes d'une armée en quartiers
  tents(ctx, s, id, col) {
    const TAU = Math.PI * 2, a0 = (id * 1.7) % TAU, R = s * 0.82 + 4, t = clamp(s * 0.13, 3.5, 8);
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k + 0.5) * TAU / 4 + 0.35, x = Math.cos(a) * R, y = Math.sin(a) * R * 0.86;
      ctx.fillStyle = 'rgba(30,24,14,0.3)';
      ctx.beginPath(); ctx.moveTo(x - t + 1.5, y + 2); ctx.lineTo(x + 1.5, y - t * 1.1 + 2); ctx.lineTo(x + t + 1.5, y + 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - t, y); ctx.lineTo(x, y - t * 1.1); ctx.lineTo(x + t, y); ctx.closePath();
      ctx.fillStyle = '#efe6cf'; ctx.fill();
      ctx.strokeStyle = '#5c4b30'; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - t * 1.1); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x, y - t * 1.1); ctx.lineTo(x + t * 0.55, y - t * 0.95); ctx.lineTo(x, y - t * 0.8); ctx.fill();
    }
  }

  // géométrie d'une enceinte (voir walls) : chemins prêts à tracer et rayon extérieur
  wallGeom(s, f, id, dmg) {
    const R = s * 0.62 + 2, sq = 0.86, TAU = Math.PI * 2;
    const a0 = (id * 2.399) % TAU;   // orientation propre à chaque ville : la brèche y reste au même endroit
    const half = dmg > 0.02 ? Math.PI * 0.5 * Math.min(1, dmg) : 0;
    const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r * sq];
    const inGap = (x, y) => {
      if (!half) return false;
      const d = Math.abs((((Math.atan2(y / sq, x) - a0) % TAU) + TAU * 1.5) % TAU - Math.PI);
      return d < half;
    };
    const lw = clamp(s * 0.03 * (1 + f * 0.5), 1.3, 6);
    const ring = [], towers = [], lunes = [];
    let outer;
    if (f <= 2) {
      const N = 12;
      for (let i = 0; i <= N; i++) ring.push(P(a0 + i * TAU / N, R));
      for (let i = 0; i < N; i += f === 1 ? 3 : 2) towers.push(ring[i]);
      outer = R + lw;
    } else {
      const m = f >= 4 ? 6 : 5, w = Math.PI / m * 0.42;
      for (let k = 0; k < m; k++) {
        const a = a0 + (k + 0.5) * TAU / m;
        ring.push(P(a - w, R), P(a - w, R * 1.13), P(a, R * 1.42), P(a + w, R * 1.13), P(a + w, R));
      }
      ring.push(ring[0]);
      outer = R * 1.42;
      if (f >= 4) {
        const d = Math.PI / m * 0.32;
        for (let k = 0; k < m; k++) {
          const a = a0 + k * TAU / m;
          lunes.push([P(a - d, R * 1.22), P(a, R * 1.62), P(a + d, R * 1.22)]);
        }
        outer = R * 1.62;
      }
    }
    const trace = (path, pts, closedSkip) => {
      let pen = false;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        if (closedSkip && inGap((x1 + x2) / 2, (y1 + y2) / 2)) { pen = false; continue; }
        if (!pen) { path.moveTo(x1, y1); pen = true; }
        path.lineTo(x2, y2);
      }
    };
    const g = { lw, outer, ring: new Path2D(), lunes: null, towers: null, towersDark: null, rubble: null };
    trace(g.ring, ring, true);
    const lu = lunes.filter(t => !inGap(t[1][0], t[1][1]));
    if (lu.length) { g.lunes = new Path2D(); for (const t of lu) trace(g.lunes, t, false); }
    const tw = towers.filter(([x, y]) => !inGap(x, y));
    if (tw.length) {
      const r = lw * (f === 1 ? 0.95 : 1.25);
      g.towers = new Path2D(); g.towersDark = new Path2D();
      for (const [x, y] of tw) {
        g.towersDark.moveTo(x + r + 1.3, y); g.towersDark.arc(x, y, r + 1.3, 0, TAU);
        g.towers.moveTo(x + r, y); g.towers.arc(x, y, r, 0, TAU);
      }
    }
    if (half) {
      // éboulis dans la brèche
      g.rubble = new Path2D();
      const k = Math.ceil(4 + dmg * 6), rr = Math.max(1, lw * 0.5);
      for (let i = 0; i < k; i++) {
        const a = a0 + (i / (k - 1) - 0.5) * half * 1.5;
        const [x, y] = P(a, R * (0.98 + ((i * 7) % 5) * 0.06));
        g.rubble.moveTo(x + rr, y); g.rubble.arc(x, y, rr, 0, TAU);
      }
    }
    return g;
  }

  // drapeau qui flotte au vent (chaque place a son propre rythme, d'après sa position à l'écran)
  flag(ctx, x, y, h, col) {
    ctx.strokeStyle = '#3b2c1c'; ctx.lineWidth = Math.max(1, h * 0.07);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    ctx.fillStyle = col;
    const m = ctx.getTransform();
    const ph = (this.now || 0) * 4.2 + m.e * 0.031 + m.f * 0.017, on = this.ambient?.on;
    const a = on ? Math.sin(ph) * h * 0.07 : 0, b = on ? Math.sin(ph - 1.4) * h * 0.06 : 0, w = h * (on ? 0.6 + Math.sin(ph * 0.5) * 0.03 : 0.62);
    ctx.beginPath(); ctx.moveTo(x, y - h);
    ctx.quadraticCurveTo(x + w * 0.5, y - h + a, x + w, y - h * 0.82 + b);
    ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.64 + a, x, y - h * 0.62);
    ctx.closePath();
    // (epoque.js) le drapeau de l'époque, bordé de la couleur du maître de la place
    if (this.state && h >= 9) { this.epoque.etoffe(ctx, x, y - h, w, h * 0.38, col); return; }
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8; ctx.stroke();
  }

  // ------------------------------------------------------------------ voies ferrées (SPEC-TECH.md, phase 2a)
  // tracé d'un tronçon, de sa ville a à sa ville b, le long des courbes des routes (calculé une fois)
  railLine(sec) {
    this.railPts = this.railPts || new Map();
    let pts = this.railPts.get(sec[0]);
    if (pts) return pts;
    pts = [];
    let n = sec[1];
    for (const eid of sec[3]) {
      const e = this.edges[eid];
      for (let k = pts.length ? 1 : 0; k <= 12; k++) pts.push(this.pointFrom(e, n, k / 12));
      n = e.a === n ? e.b : e.a;
    }
    // (emprise et longueurs cumulées, calculées une fois : la carte ne dessine que les voies à l'écran, les trains s'en
    // servent pour avancer)
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    pts.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    pts.cum = [0];
    for (let i = 1; i < pts.length; i++) pts.cum.push(pts.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.railPts.set(sec[0], pts);
    return pts;
  }
  // sortie d'une ligne vers le bord : droit vers le bord de la carte, dans la direction de la ville suivante (hors carte)
  railExit(nid, dir) {
    const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0], NE: [0.7, -0.7], SE: [0.7, 0.7], NO: [-0.7, -0.7], SO: [-0.7, 0.7] };
    const n = this.nodes[nid], [dx, dy] = DIR[dir] || DIR.N;
    const tx = dx > 0 ? (this.W - n.x) / dx : dx < 0 ? -n.x / dx : Infinity, ty = dy > 0 ? (this.H - n.y) / dy : dy < 0 ? -n.y / dy : Infinity;
    const t = Math.min(tx, ty);
    return [[n.x, n.y], [n.x + dx * t, n.y + dy * t]];
  }
  // voie ferrée de carte : trait sombre, tirets clairs dedans ; un chantier : la part faite, puis des pointillés ; une
  // voie coupée : une croix rouge au milieu ; les gares ; les sorties vers le bord de la carte
  drawRails(ctx, st) {
    const R = st && st.rails, secs = this.m.rails && this.m.rails.sections;
    if (!R || !secs || !R.state.length) return;
    const z = this.cam.z, w = clamp(z * 0.9, 2, 5);
    const [vx0, vy0] = this.toWorld(-40, -40), [vx1, vy1] = this.toWorld(this.vw + 40, this.vh + 40);
    const seen = b => !(b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1);
    const byId = this.railSecs || (this.railSecs = new Map(secs.map(s => [s[0], s])));
    const stroke = (pts, part) => {
      if (pts.length < 2) return;
      ctx.beginPath(); pts.forEach((p, i) => { const q = this.toScreen(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      if (part === 'plan') { ctx.setLineDash([2, 5]); ctx.strokeStyle = 'rgba(42,36,32,0.75)'; ctx.lineWidth = Math.max(1, w * 0.45); ctx.stroke(); ctx.setLineDash([]); return; }
      ctx.strokeStyle = '#2a2420'; ctx.lineWidth = w; ctx.stroke();
      ctx.setLineDash([w * 2, w * 2]); ctx.strokeStyle = '#efe6d0'; ctx.lineWidth = w * 0.5; ctx.stroke(); ctx.setLineDash([]);
    };
    const served = new Set();
    ctx.save(); ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (const [sid, kind, prog] of R.state) {
      const sec = byId.get(sid);
      if (!sec) continue;
      const pts = this.railLine(sec);
      served.add(sec[1]); served.add(sec[2]);   // (gares et sorties : même hors de l'écran, elles en dépendent)
      if (!seen(pts.box)) continue;
      if (kind === 'chantier') {
        const k = Math.max(1, Math.round(prog * (pts.length - 1)));
        stroke(pts.slice(0, k + 1)); stroke(pts.slice(k), 'plan');
        continue;
      }
      stroke(pts);
      if (kind === 'coupe') {
        const m = pts[pts.length >> 1], q = this.toScreen(m[0], m[1]), r = w * 2.2;
        ctx.strokeStyle = '#d23a2a'; ctx.lineWidth = Math.max(2, w * 0.8);
        ctx.beginPath(); ctx.moveTo(q[0] - r, q[1] - r); ctx.lineTo(q[0] + r, q[1] + r); ctx.moveTo(q[0] + r, q[1] - r); ctx.lineTo(q[0] - r, q[1] + r); ctx.stroke();
      }
    }
    for (const [nid, , dir] of this.m.rails.exits) if (served.has(nid)) stroke(this.railExit(nid, dir));
    // gares : un petit bâtiment à côté de chaque ville desservie
    if (z >= 1.6) for (const nid of served) {
      const n = this.nodes[nid], [x, y] = this.toScreen(n.x, n.y), s = clamp(z * 1.6, 6, 12);
      const gx = x - s * 2.6, gy = y + s * 0.6;   // (en bas à gauche : l'effectif de la ville est à droite)
      ctx.fillStyle = '#7a3b2a'; ctx.fillRect(gx, gy, s * 1.3, s * 0.7);
      ctx.fillStyle = '#4a2a1e'; ctx.beginPath(); ctx.moveTo(gx - s * 0.1, gy); ctx.lineTo(gx + s * 0.65, gy - s * 0.5); ctx.lineTo(gx + s * 1.4, gy); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawPaths(ctx) {
    const sel = this.selection;
    if (!sel || sel.kind !== 'army') return;
    const a = this.state.armies.find(x => x.id === sel.id);
    if (!a || !a.path || !a.path.length) return;
    const d = this.disp.get(a.id);
    if (!d) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // tronçons : terre (jaune ou vert) et eau (bleu clair, en gabare)
    const segs = [];
    let cur = { water: false, pts: [[d.x, d.y]] };
    for (const leg of a.path) {
      let water = false, add = [];
      if (leg.e != null) {
        const e = this.edges[leg.e];
        water = e.water ? true : leg.r ? 'rail' : false;   // (en train : un trait de rail)
        const f0 = leg.pos / Math.max(0.01, e.len), nseg = water === true ? 48 : 14;
        for (let k = 1; k <= nseg; k++) add.push(this.pointFrom(e, leg.frm, f0 + (1 - f0) * k / nseg));
      } else if (leg.pts) add = leg.pts.slice(1);
      if (water !== cur.water) {
        const lastP = cur.pts[cur.pts.length - 1];
        segs.push(cur);
        cur = { water, pts: [lastP] };
      }
      cur.pts.push(...add);
    }
    segs.push(cur);
    let last = null;
    for (const sg of segs) {
      if (sg.pts.length < 2) continue;
      const sp = sg.pts.map(p => this.toScreen(p[0], p[1]));
      ctx.beginPath(); sp.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = 'rgba(32,35,38,0.7)'; ctx.lineWidth = 6; ctx.stroke();
      ctx.setLineDash(sg.water === 'rail' ? [14, 4] : sg.water ? [4, 6] : a.tr ? [2, 7] : [9, 7]);
      ctx.strokeStyle = sg.water === 'rail' ? '#f3f0ea' : sg.water ? '#bfe6ff' : a.tr ? '#f6efdc' : a.md === 'champs' ? '#bfe39a' : '#f1d58a'; ctx.lineWidth = 3; ctx.stroke();
      ctx.setLineDash([]);
      last = sp[sp.length - 1];
    }
    if (!last) { ctx.restore(); return; }
    this.flag(ctx, last[0], last[1], 22, a.tr ? '#f6efdc' : this.colors[a.o]);   // en traversant : halte, drapeau blanc
    // terres fermées : détour, ou sortie dans le délai de grâce
    const note = a.cl ? `sortie des terres ${a.cl[1] > 0 ? `(${a.cl[1] <= 1 ? 'ce tour' : a.cl[1] + ' tours'})` : '(délai écoulé)'}` : a.dt && a.dt.length ? `détour (terres fermées : ${a.dt.join(', ')})` : '';
    if (note) {
      ctx.font = 'italic 600 13px "EB Garamond", Georgia, serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(32,35,38,0.85)'; ctx.strokeText(note, last[0] + 9, last[1] + 9);
      ctx.fillStyle = a.cl ? '#ffb3a6' : '#f6efdc'; ctx.fillText(note, last[0] + 9, last[1] + 9);
    }
    ctx.restore();
  }

  drawArmies(ctx, time) {
    const z = this.cam.z, st = this.state;
    const detailed = z >= 5.5;
    const list = [...this.disp.values()].sort((p, q) => p.y - q.y);
    const atNode = {};
    for (const d of list) if (d.a.n != null && d.a.st !== 'battle') (atNode[d.a.n] = atNode[d.a.n] || []).push(d);
    for (const arr of Object.values(atNode)) arr.forEach((d, i) => { d.slot = i; d.slots = arr.length; });
    this.armyLabels = [];
    for (const d of list) {
      const a = d.a;
      const [x, y] = this.armyScreen(d);
      if (x < -80 || y < -80 || x > this.vw + 80 || y > this.vh + 80) continue;
      const col = this.colors[a.o] || '#999';
      const sel = this.selection && this.selection.kind === 'army' && this.selection.id === a.id;
      ctx.save();
      ctx.translate(x, y);
      if (a.h) ctx.globalAlpha = 0.62;
      if (a.rail && a.n == null) this.drawTrain(ctx, a, d, col, sel, time);
      else if (a.boat && a.n == null) this.drawBoat(ctx, a, d, col, sel, time);
      else if (detailed) this.drawFormation(ctx, a, d, col, sel, time);
      else this.drawToken(ctx, a, d, col, sel, time);
      ctx.restore();
    }
    this.drawArmyLabels(ctx);
  }

  drawToken(ctx, a, d, col, sel, time) {
    const w = 50, h = 22;
    if (sel) { ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 4, 32, 18, 0, 0, Math.PI * 2); ctx.stroke(); }
    // fanion du camp sur sa hampe, qui flotte au vent
    const fx = -w / 2 + 6, top = -h / 2 - 22, wave = Math.sin(time * 3 + (+String(a.id).replace(/\D/g, '') || 0)) * 1.6;
    ctx.strokeStyle = '#3a2e20'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(fx, -h / 2); ctx.lineTo(fx, top); ctx.stroke();
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fx, top); ctx.quadraticCurveTo(fx + 9, top - 2 + wave, fx + 18, top + 1 + wave);
    ctx.lineTo(fx + 18, top + 10 + wave); ctx.quadraticCurveTo(fx + 9, top + 8 + wave, fx, top + 11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = lighten(col, 0.5); ctx.fillRect(fx + 1, top + 4.5, 15, 1.4);
    // plaque d'ardoise, liseré du camp à gauche
    ctx.fillStyle = 'rgba(0,0,0,.4)'; roundRect(ctx, -w / 2 + 2, -h / 2 + 3, w, h, 3); ctx.fill();
    ctx.fillStyle = 'rgba(32,35,38,0.94)'; roundRect(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.strokeStyle = a.h ? '#ffffff' : 'rgba(150,150,140,0.55)'; ctx.lineWidth = 1.2;
    if (a.h) ctx.setLineDash([3, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.fillRect(-w / 2 + 1, -h / 2 + 1, 5, h - 2);
    // flèche de marche
    if (a.st === 'move' || a.st === 'retreat') {
      ctx.save(); ctx.rotate(d.head);
      ctx.fillStyle = a.st === 'retreat' ? '#ffb3a6' : '#fff4d0';
      ctx.beginPath(); ctx.moveTo(w / 2 + 9, 0); ctx.lineTo(w / 2 + 2, -5); ctx.lineTo(w / 2 + 2, 5); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#eeebe2';
    ctx.font = '700 14px "EB Garamond", Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtMen(a.men), 2.5, 0.5);
    // types
    const types = {};
    for (const r of a.regs) types[r[1]] = (types[r[1]] || 0) + 1;
    const order = Object.keys(types).sort((p, q) => CLS_ORDER[unitCls(this.rules, p)] - CLS_ORDER[unitCls(this.rules, q)] || this.rules.unit_order.indexOf(p) - this.rules.unit_order.indexOf(q));
    let px = -((Object.keys(types).length - 1) * 8) / 2;
    for (const t of order) {
      if (!types[t]) continue;
      ctx.fillStyle = '#202326';
      ctx.beginPath(); ctx.arc(px, h / 2 + 5, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = TYPE_DOT[t] || TYPE_DOT[unitCls(this.rules, t) === 'inf' ? 'ligne' : unitCls(this.rules, t)];
      ctx.beginPath(); ctx.arc(px, h / 2 + 5, 2.8, 0, Math.PI * 2); ctx.fill();
      px += 8;
    }
    if (a.wn?.length) this.warnMark(ctx, w / 2 - 1, -h / 2 + 1);
    if (a.st === 'battle') {
      ctx.strokeStyle = 'rgba(255,120,80,' + (0.5 + 0.5 * Math.sin(time * 8)) + ')';
      ctx.lineWidth = 2; roundRect(ctx, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 7); ctx.stroke();
    }
    // le général : son portrait en médaillon, à droite de la plaque (à partir d'un zoom moyen)
    if (a.gen && this.cam.z >= 2.6) this.medallion(ctx, a, col, w / 2 + 15, -3, 15);
  }
  // médaillon du général d'une armée (portraits.js), centré en (x, y), de rayon r
  medallion(ctx, a, col, x, y, r) {
    const cv = portraitGeneral(a.gen.name, this.state?.year || 1790, col);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x + 1.5, y + 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(cv, x - r, y - r, 2 * r, 2 * r);
  }
  // l'imagier des figurines (unites.js) : les mêmes que les cartes de régiment, à l'uniforme de l'année
  figArt() {
    if (!this.art) this.art = new UnitArt(profil());
    const y = this.state?.year || 1790;
    if (this.art.year !== y) { this.art.year = y; this.art.sprites.clear(); }
    return this.art;
  }

  formationLayout(a, bw, bd, gap) {
    // placement des blocs dans le repère de l'armée (l'avant est vers le haut, y négatif)
    const regs = a.regs;
    const inf = regs.filter(r => unitCls(this.rules, r[1]) === 'inf');
    const cav = regs.filter(r => unitCls(this.rules, r[1]) === 'cavalerie');
    const art = regs.filter(r => unitCls(this.rules, r[1]) === 'artillerie');
    const fm = a.fm || 'ligne';
    const out = [];
    const row = (list, y, spacing, jitter = 0) => {
      const w = list.length * (bw + spacing) - spacing;
      list.forEach((r, k) => {
        const jx = jitter ? (hash(k, list.length, 7) - 0.5) * jitter : 0, jy = jitter ? (hash(k, list.length, 8) - 0.5) * jitter : 0;
        out.push({ r, x: -w / 2 + k * (bw + spacing) + bw / 2 + jx, y: y + jy, rot: 0 });
      });
    };
    const chunk = (list, n) => { const res = []; for (let k = 0; k < list.length; k += n) res.push(list.slice(k, k + n)); return res; };
    if (fm === 'carre' && inf.length) {
      // carré creux : l'infanterie fait face de tous côtés, canons et cavaliers à l'abri au centre
      const perSide = Math.max(1, Math.ceil(inf.length / 4));
      const S = perSide * (bw + gap) + bd;
      inf.forEach((r, k) => {
        const side = k % 4, idx = Math.floor(k / 4);
        const off = -((perSide - 1) * (bw + gap)) / 2 + idx * (bw + gap);
        const rot = side * Math.PI / 2;
        const cx = Math.sin(rot) * S / 2 + Math.cos(rot) * off, cy = -Math.cos(rot) * S / 2 + Math.sin(rot) * off;
        out.push({ r, x: cx, y: cy, rot });
      });
      const inner = [...art, ...cav];
      const small = 0.55;
      inner.forEach((r, k) => {
        const n = inner.length, w = n * (bw * small + 3) - 3;
        out.push({ r, x: -w / 2 + k * (bw * small + 3) + bw * small / 2, y: 0, rot: 0, scale: small });
      });
    } else if (fm === 'colonne') {
      // colonnes d'attaque : deux bataillons de front, en profondeur
      let y = 0;
      for (const line of chunk(inf, 2)) { row(line, y, gap * 0.6); y += bd + gap * 0.8; }
      const cavRows = chunk(cav, 2);
      for (const line of cavRows) { row(line, y + gap, gap * 3); y += bd + gap * 1.6; }
      if (art.length) { row(art, y + gap * 1.5, gap); }
    } else if (fm === 'tirailleurs') {
      // ordre dispersé : un large rideau irrégulier
      row(inf, 0, gap * 2.8, bd * 0.9);
      if (cav.length) row(cav, bd + gap * 3.2, gap * 4);
      if (art.length) row(art, (cav.length ? 2 : 1) * (bd + gap * 3.2), gap);
    } else {
      // ligne : cavalerie aux ailes, artillerie en second rang
      const front = [...cav.slice(0, Math.ceil(cav.length / 2)), ...inf, ...cav.slice(Math.ceil(cav.length / 2))];
      let y = 0;
      for (const line of chunk(front, 6)) { row(line, y, gap); y += bd + gap * 2.4; }
      for (const line of chunk(art, 6)) { row(line, y, gap); y += bd + gap * 2.4; }
    }
    return out;
  }

  drawFormation(ctx, a, d, col, sel, time) {
    const z = this.cam.z;
    const bw = clamp(z * 2.3, 22, 66), bd = bw * 0.38, gap = bw * 0.2;
    const blocks = this.formationLayout(a, bw, bd, gap);
    if (!blocks.length) return;
    // recentre la formation sur la position de l'armée
    const xs = blocks.map(b => b.x), ys = blocks.map(b => b.y);
    const minx = Math.min(...xs) - bw / 2, maxx = Math.max(...xs) + bw / 2, miny = Math.min(...ys) - bd / 2, maxy = Math.max(...ys) + bd / 2;
    const cy = (miny + maxy) / 2 - (a.fm === 'carre' ? 0 : bd * 0.3);
    ctx.save();
    ctx.rotate(d.head + Math.PI / 2);
    ctx.translate(0, -cy);
    if (sel) {
      ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse((minx + maxx) / 2, (miny + maxy) / 2, (maxx - minx) / 2 + 12, (maxy - miny) / 2 + 10, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const fighting = a.st === 'battle';
    const labels = [];
    const figs = [];   // figurines debout (G3), placées dans le repère tourné, dessinées ensuite droites
    blocks.forEach((b, k) => {
      const r = b.r, sc = b.scale || 1;
      const jx = fighting ? (Math.sin(time * 9 + k * 1.7) * 0.8) : 0;
      const frac = clamp(r[2] / r[3], 0.08, 1);
      ctx.save();
      ctx.translate(b.x + jx, b.y);
      ctx.rotate(b.rot);
      ctx.scale(sc, sc);
      ctx.translate(-bw / 2, -bd / 2);
      const uc = unitCls(this.rules, r[1]);
      // l'emprise au sol, en ombre légère ; dessus, les hommes en figurines debout, rangées sur l'emprise
      ctx.fillStyle = 'rgba(20,24,16,.22)'; ctx.fillRect(1.5, 2, bw, bd);
      ctx.fillStyle = col; ctx.globalAlpha *= 0.28; ctx.fillRect(0, 0, bw, bd); ctx.globalAlpha /= 0.28;
      const light = unitLight(this.rules, r[1]) || a.fm === 'tirailleurs';
      const kind = figureKind({ cls: uc, type: r[1], light, arm: r[6] ?? 1 });
      const per = uc === 'artillerie' ? Math.max(1, Math.round(3 * frac)) : Math.max(2, Math.round((uc === 'cavalerie' ? bw / 11 : bw / 7) * (light ? 1 : 2) * frac));
      const rows = uc === 'artillerie' || uc === 'cavalerie' || light ? 1 : 2, cols = Math.ceil(per / rows), m = ctx.getTransform();
      for (let q = 0; q < per; q++) {
        const i = q % cols, j = (q / cols) | 0;
        const lx = bw * (i + 0.5) / cols + (light ? (hash(k, q, 3) - 0.5) * bw / cols * 0.6 : 0), ly = bd * (rows === 1 ? 0.55 : 0.3 + 0.45 * j);
        figs.push({ x: (m.a * lx + m.c * ly + m.e) / this.dpr, y: (m.b * lx + m.d * ly + m.f) / this.dpr, kind, cls: uc, name: this.rules.units[r[1]]?.name || '' });
      }
      if (fighting && Math.random() < 0.18) {
        ctx.fillStyle = 'rgba(255,226,140,0.95)';
        ctx.beginPath(); ctx.arc(Math.random() * bw, -2, Math.max(1.5, bw * 0.05), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(240,240,235,0.5)';
        ctx.beginPath(); ctx.arc(Math.random() * bw, -bd * 0.4, bw * 0.12, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (sc === 1) labels.push([b.x + jx, b.y - bd / 2 - 3 - cy, r[2]]);
    });
    ctx.restore();
    // les figurines, debout face à l'écran, des plus lointaines aux plus proches
    if (figs.length) {
      const art = this.figArt(), H = clamp(bw * 0.36, 9, 24), m0 = ctx.getTransform();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      figs.sort((p, q) => p.y - q.y);
      for (const f of figs) {
        const h = f.kind === 'cav' ? H * 0.95 : f.kind.startsWith('canon') ? H * 0.85 : H;
        const sp = art.sprite(f.kind, col, f.kind === 'cav' || f.kind.startsWith('canon') ? 1 : 0, Math.round(h), 0, uniform(art.year, f.cls, f.name).coat), sc = h / sp.h;
        ctx.drawImage(sp.cv, f.x - sp.ax * sc, f.y - sp.ay * sc, sp.cv.width * sc, sp.cv.height * sc);
      }
      ctx.setTransform(m0);
    }
    // chiffres au-dessus des blocs (non tournés)
    ctx.font = `700 ${clamp(bw * 0.42, 10, 16)}px "EB Garamond", Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const ca = Math.cos(d.head + Math.PI / 2), sa = Math.sin(d.head + Math.PI / 2);
    // bas de la formation à l'écran (blocs tournés et chiffres compris) : le nom de l'armée se place dessous
    let bottom = 0;
    const rad = Math.hypot(bw, bd) / 2;
    for (const b of blocks) bottom = Math.max(bottom, b.x * sa + (b.y - cy) * ca + rad * (b.scale || 1));
    for (const [lx, ly, n] of labels) {
      const X = lx * ca - ly * sa, Y = lx * sa + ly * ca;
      bottom = Math.max(bottom, Y - 4);
      ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = 3;
      ctx.strokeText(String(n), X, Y - 4);
      ctx.fillStyle = '#fff6dc';
      ctx.fillText(String(n), X, Y - 4);
    }
    // le général en médaillon, à gauche de la formation (au-dessus, il cacherait le nom de la place)
    if (a.gen) {
      let left = 0, y0 = 1e9, y1 = -1e9;
      for (const b of blocks) {
        const X = b.x * ca - (b.y - cy) * sa, Y = b.x * sa + (b.y - cy) * ca;
        left = Math.min(left, X - rad * (b.scale || 1)); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
      const r = clamp(bw * 0.38, 13, 22);
      this.medallion(ctx, a, col, left - r - 6, (y0 + y1) / 2, r);
    }
    if (z >= 7 && (sel || a.o === this.state.me.code)) {
      const gen = a.gen ? ` · ${a.gen.name}` : '';
      const fmLab = a.fm && a.fm !== 'ligne' ? ` · ${this.rules.formations[a.fm].label.toLowerCase()}` : '';
      // dessiné après toutes les armées, pour ne pas disparaître sous les chiffres d'une voisine
      const m = ctx.getTransform();
      this.armyLabels.push({ x: m.e / this.dpr, y: m.f / this.dpr + bottom + 6, txt: a.name + gen + fmLab, warn: !!a.wn?.length, alpha: ctx.globalAlpha });
    }
  }

  // noms des armées (grand zoom) : sous les chiffres des régiments, sur un léger fond pour rester lisibles
  drawArmyLabels(ctx) {
    const z = this.cam.z;
    ctx.save();
    ctx.font = `italic 500 ${clamp(z * 0.6 + 5, 11, 15)}px "EB Garamond", Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const fs = clamp(z * 0.6 + 5, 11, 15);
    for (const l of this.armyLabels) {
      const w = this.textW(ctx, l.txt);
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = 'rgba(14,20,30,0.5)';
      roundRect(ctx, l.x - w / 2 - 5, l.y - 1, w + 10, fs + 4, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(14,20,30,.8)'; ctx.lineWidth = 3;
      ctx.strokeText(l.txt, l.x, l.y); ctx.fillStyle = '#f1ead8'; ctx.fillText(l.txt, l.x, l.y);
      if (l.warn) this.warnMark(ctx, l.x + w / 2 + 9, l.y + 7);
    }
    ctx.restore();
    this.armyLabels.length = 0;
  }

  // armée qui déserte (solde impayée, vivres épuisés) : petit point d'exclamation rouge
  warnMark(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = '#c0392b'; ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff4e8'; ctx.font = '700 10px "EB Garamond", Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y + 0.5);
    ctx.restore();
  }

  // une armée dans un train : la locomotive et son panache, des wagons aux couleurs du camp, l'effectif
  drawTrain(ctx, a, d, col, sel, time) {
    const s = clamp(this.cam.z * 2.4, 22, 54), n = clamp(Math.ceil(a.regs.length / 2), 1, 4);
    ctx.save();
    ctx.rotate(Math.cos(d.head) < 0 ? d.head + Math.PI : d.head);
    const dir = Math.cos(d.head) < 0 ? -1 : 1;
    if (sel) { ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5; ctx.strokeRect(-s * 0.4 * (n + 1) / 2 - 3, -s * 0.22, s * 0.4 * (n + 1) + 6, s * 0.44); }
    for (let k = n; k >= 0; k--) {   // de profil : la locomotive devant, des wagons aux couleurs du camp
      ctx.save(); ctx.translate((k - n / 2) * s * 0.42 * -dir, s * 0.12); ctx.scale(dir, 1);
      if (k) voiture(ctx, s * 0.4, col); else locomotive(ctx, s * 0.4, time);
      ctx.restore();
      if (!k) for (let q = 0; q < 3; q++) { ctx.fillStyle = `rgba(236,232,224,${0.55 - q * 0.15})`; ctx.beginPath(); ctx.arc((n / 2 * s * 0.42 + s * 0.15 - (q + 1) * s * 0.14) * dir, -s * (0.2 + q * 0.06) + Math.sin(time * 3 + q) * 2, s * (0.07 + q * 0.03), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    ctx.font = `700 ${clamp(s * 0.36, 12, 17)}px "EB Garamond", Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = 3;
    const txt = fmtMen(a.men);
    ctx.strokeText(txt, 0, s * 0.3); ctx.fillStyle = '#fffaf0'; ctx.fillText(txt, 0, s * 0.3);
  }

  drawBoat(ctx, a, d, col, sel, time) {
    // gabares : coque, voile carrée aux couleurs du département, effectif
    const z = this.cam.z;
    const s = clamp(z * 2.4, 22, 54);
    const n = clamp(Math.ceil(a.regs.length / 2), 1, 3);
    const bob = Math.sin(time * 2.4) * s * 0.03;
    if (sel) { ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.9 + n * 4, s * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); }
    const flip = Math.cos(d.head) < 0 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      ctx.save();
      ctx.translate((k - (n - 1) / 2) * s * 0.42 * flip, (k % 2 ? s * 0.18 : -s * 0.05) + bob * (k % 2 ? -1 : 1));
      ctx.scale(flip, 1);
      // sillage
      ctx.strokeStyle = 'rgba(235,246,255,0.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.2); ctx.lineTo(-s * 0.85, s * 0.28); ctx.moveTo(-s * 0.5, s * 0.26); ctx.lineTo(-s * 0.8, s * 0.38); ctx.stroke();
      // coque
      ctx.fillStyle = '#5b3d22';
      ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.08); ctx.lineTo(s * 0.5, s * 0.08); ctx.lineTo(s * 0.36, s * 0.3); ctx.lineTo(-s * 0.4, s * 0.3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2f1f10'; ctx.lineWidth = 1; ctx.stroke();
      // mât et voile
      ctx.strokeStyle = '#3b2a18'; ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath(); ctx.moveTo(0, s * 0.08); ctx.lineTo(0, -s * 0.48); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(-s * 0.22, -s * 0.42); ctx.quadraticCurveTo(-s * 0.02, -s * 0.15, -s * 0.24, s * 0.02); ctx.lineTo(s * 0.24, s * 0.02); ctx.quadraticCurveTo(s * 0.36, -s * 0.15, s * 0.22, -s * 0.42); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = lighten(col, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.font = `700 ${clamp(s * 0.36, 12, 17)}px "EB Garamond", Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = 3;
    const txt = fmtMen(a.men);
    ctx.strokeText(txt, 0, s * 0.38); ctx.fillStyle = '#fffaf0'; ctx.fillText(txt, 0, s * 0.38);
    if (a.fire) {
      ctx.fillStyle = `rgba(255,140,80,${0.5 + 0.5 * Math.sin(time * 10)})`;
      ctx.beginPath(); ctx.arc(s * 0.3, -s * 0.5, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawFoot(ctx, bw, bd, col, frac, light, heavy = false) {
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(2, 2.5, bw, bd);
    ctx.fillStyle = darken(col, 0.35); ctx.fillRect(0, 0, bw, bd);
    const cols = Math.max(4, Math.round(bw / 4.2)), rows = light ? 2 : 3;
    const n = Math.round(cols * rows * frac);
    const dx = bw / cols, dy = bd / rows, r = Math.min(dx, dy) * 0.36;
    const c1 = col, c2 = heavy ? '#2a1f16' : lighten(col, 0.4);   // grenadiers : hauts bonnets à poil sombres
    let k = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (k++ >= n) continue;
      const x = dx * (i + 0.5) + (light ? (hash(i, j) - 0.5) * dx * 0.5 : 0), y = dy * (j + 0.5);
      ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c2; ctx.beginPath();
      if (heavy) ctx.ellipse(x, y - r * 0.35, r * 0.5, r * 0.75, 0, 0, Math.PI * 2); else ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = lighten(col, 0.6); ctx.lineWidth = 1; ctx.strokeRect(0, 0, bw, bd);
  }

  drawHorse(ctx, bw, bd, col, frac) {
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(2, 2.5, bw, bd);
    const cols = Math.max(3, Math.round(bw / 6.5)), rows = 2;
    const n = Math.round(cols * rows * frac);
    const dx = bw / cols, dy = bd / rows;
    let k = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (k++ >= n) continue;
      const x = dx * (i + 0.5), y = dy * (j + 0.5);
      ctx.fillStyle = '#6a4a2c'; ctx.beginPath(); ctx.ellipse(x, y, dx * 0.24, dy * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - dy * 0.05, Math.min(dx, dy) * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = lighten(col, 0.55); ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(0, 0, bw, bd); ctx.setLineDash([]);
  }

  drawGuns(ctx, bw, bd, col, frac) {
    const n = Math.max(1, Math.round(3 * frac));
    for (let k = 0; k < n; k++) {
      const x = bw * (k + 0.5) / 3;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - bw * 0.06 + 2, -bd * 0.2 + 2, bw * 0.12, bd * 0.9);
      ctx.fillStyle = '#2a2a28'; ctx.fillRect(x - bw * 0.045, -bd * 0.25, bw * 0.09, bd * 0.8);
      ctx.fillStyle = '#6b4a2c';
      ctx.beginPath(); ctx.arc(x - bw * 0.09, bd * 0.42, bd * 0.2, 0, Math.PI * 2); ctx.arc(x + bw * 0.09, bd * 0.42, bd * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, bd * 0.85, bd * 0.15, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawBattles(ctx, dt, time) {
    const z = this.cam.z;
    for (const b of (this.state || this.preview).battles) {
      const [x, y] = this.toScreen(b.x, b.y);
      if (x < -100 || y < -100 || x > this.vw + 100 || y > this.vh + 100) continue;
      // fumée
      if (Math.random() < dt * 9) {
        const r = 1.6;
        this.particles.push({ type: 'smoke', x: b.x + (Math.random() - 0.5) * r * 2, y: b.y + (Math.random() - 0.5) * r * 1.4,
                              life: 0, max: 2.2 + Math.random(), size: 0.5 + Math.random() * 0.6 });
      }
      if (Math.random() < dt * 14) {
        this.particles.push({ type: 'spark', x: b.x + (Math.random() - 0.5) * 2.4, y: b.y + (Math.random() - 0.5) * 1.6, life: 0, max: 0.15 });
      }
      if (z < 5.5) {
        ctx.save();
        ctx.translate(x, y - 26);
        const pulse = 1 + 0.12 * Math.sin(time * 6);
        ctx.fillStyle = 'rgba(32,35,38,0.9)';
        ctx.beginPath(); ctx.arc(0, 0, 14 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = b.amb ? '#bfe39a' : '#ff9a7a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = '#f1ead8'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawParticles(ctx, dt) {
    const z = this.cam.z;
    const keep = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life > p.max) continue;
      keep.push(p);
      const k = p.life / p.max;
      if (p.type === 'smoke') {
        const [x, y] = this.toScreen(p.x + k * 0.6, p.y - k * 0.4);
        const r = (p.size + k * 1.2) * z;
        ctx.fillStyle = `rgba(232,232,226,${0.5 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(x, y, Math.max(3, r), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'spark') {
        const [x, y] = this.toScreen(p.x, p.y);
        ctx.fillStyle = `rgba(255,214,120,${1 - k})`;
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, z * 0.12), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'num') {
        const [x, y] = this.toScreen(p.x, p.y);
        ctx.font = `700 ${clamp(10 + z * 0.5, 13, 20)}px "EB Garamond", Georgia, serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1 - k * k;
        ctx.strokeStyle = 'rgba(10,10,10,.85)'; ctx.lineWidth = 3;
        ctx.strokeText(p.text, x, y - k * 34);
        ctx.fillStyle = '#ffd2c7'; ctx.fillText(p.text, x, y - k * 34);
        ctx.globalAlpha = 1;
      } else if (p.type === 'coin') {
        const e = k < 0 ? 0 : k * k * (3 - 2 * k);
        const x0 = p.x, y0 = p.y, x1 = p.x1, y1 = p.y1;
        const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - Math.hypot(x1 - x0, y1 - y0) * 0.35;
        const u = 1 - e;
        const wx = u * u * x0 + 2 * u * e * cx + e * e * x1, wy = u * u * y0 + 2 * u * e * cy + e * e * y1;
        const [x, y] = this.toScreen(wx, wy);
        const r = clamp(z * 0.5, 4, 9);
        ctx.fillStyle = '#7a5a12'; ctx.beginPath(); ctx.arc(x + 1, y + 1, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8c34f'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }
    this.particles = keep.slice(-600);
  }

  spawnCoins(owner) {
    if (!this.state) return;
    const cap = this.nodes.find(n => n.type === 'capitale' && this.state.nodes[n.id].o === owner && n.dept === owner)
      || this.nodes.find(n => this.state.nodes[n.id].o === owner);
    if (!cap) return;
    const mine = this.nodes.filter(n => this.state.nodes[n.id].o === owner && n.id !== cap.id);
    mine.sort(() => Math.random() - 0.5);
    mine.slice(0, 26).forEach((n, i) => {
      this.particles.push({ type: 'coin', x: n.x, y: n.y, x1: cap.x, y1: cap.y, life: -i * 0.07, max: 1.5 });
    });
  }

  drawWeather(ctx, dt, time) {
    const st = this.state;
    const [mx0, my0] = this.toScreen(0, 0), [mx1, my1] = this.toScreen(this.W, this.H);
    const X0 = Math.max(0, mx0), Y0 = Math.max(0, my0), X1 = Math.min(this.vw, mx1), Y1 = Math.min(this.vh, my1);
    if (X1 <= X0 || Y1 <= Y0) return;
    const ym = clamp(this.toScreen(0, this.m.y_mont)[1], Y0, Y1);
    const xc = clamp(this.toScreen(this.m.x_cote, 0)[0], X0, X1);
    // zones : [x0, y0, x1, y1] et bords intérieurs (gauche, droite, haut, bas) qui touchent une autre zone
    const zones = {
      montagne: [X0, ym, X1, Y1, 0, 0, ym > Y0, 0],
      cote: [X0, Y0, xc, ym, 0, xc < X1, 0, ym < Y1],
      interieur: [xc, Y0, X1, ym, xc > X0, 0, 0, ym < Y1],
    };
    // Les voiles de couleur sont peints sur un calque en très basse résolution que le navigateur agrandit :
    // le lissage fond les limites entre zones sur une quarantaine de pixels, sans couture droite.
    const K = 1 / 40;
    const tw = Math.ceil(this.vw * K) + 1, th = Math.ceil(this.vh * K) + 1;
    const tint = this.wxTint || (this.wxTint = document.createElement('canvas'));
    if (tint.width !== tw || tint.height !== th) { tint.width = tw; tint.height = th; }
    const tg = tint.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, tw, th);
    tg.setTransform(K, 0, 0, K, 0, 0);
    let tinted = false;
    // vers l'extérieur de la carte, le voile déborde : la découpe au bord de la carte reste franche
    const ext = zr => [zr[4] ? zr[0] : zr[0] - 60, zr[6] ? zr[1] : zr[1] - 60, zr[5] ? zr[2] : zr[2] + 60, zr[7] ? zr[3] : zr[3] + 60];
    const veil = (zr, col) => { const [a, b, c, d] = ext(zr); tg.fillStyle = col; tg.fillRect(a, b, c - a, d - b); tinted = true; };
    const live = Object.entries(zones).filter(([zn, zr]) => zr[2] > zr[0] && zr[3] > zr[1] && st.weather[zn]?.kind);
    // 1) voiles (calque basse résolution)
    for (const [zn, zr] of live) {
      const kind = st.weather[zn].kind;
      if (kind === 'pluie' || kind === 'orage' || kind === 'tempete') {
        veil(zr, 'rgba(40,52,70,0.12)');
        if (kind === 'orage') {
          if (Math.random() < dt * 0.35) this.flash[zn] = 0.4;
          if (this.flash[zn] > 0) { veil(zr, `rgba(255,255,255,${this.flash[zn]})`); this.flash[zn] -= dt * 1.6; }
        }
      } else if (kind === 'neige') veil(zr, 'rgba(240,246,255,0.22)');
      else if (kind === 'brouillard') {
        // voile discret et nappes peu blanches : sous le brouillard de guerre, les cercles de vision
        // ne doivent pas ressortir comme des disques éclatants
        const pool = this.wx[zn];
        while (pool.length < 9) pool.push({ x: Math.random(), y: Math.random(), r: 0.25 + Math.random() * 0.3, v: 0.004 + Math.random() * 0.006 });
        veil(zr, 'rgba(214,220,228,0.12)');
        const [x0, y0, x1, y1] = zr, zw = x1 - x0, zh = y1 - y0, [ea, eb, ec, ed] = ext(zr);
        tg.save();
        tg.beginPath(); tg.rect(ea, eb, ec - ea, ed - eb); tg.clip();
        for (const p of pool) {
          p.x += p.v * dt; if (p.x > 1.3) p.x = -0.3;
          const cx = x0 + p.x * zw, cy = y0 + p.y * zh, R = p.r * Math.max(zw, zh);
          const gr = tg.createRadialGradient(cx, cy, 0, cx, cy, R);
          gr.addColorStop(0, 'rgba(224,228,234,0.24)'); gr.addColorStop(1, 'rgba(224,228,234,0)');
          tg.fillStyle = gr; tg.fillRect(cx - R, cy - R, R * 2, R * 2);
        }
        tg.restore();
      } else if (kind === 'canicule') veil(zr, 'rgba(255,170,70,0.09)');
      else if (kind === 'nuages') veil(zr, 'rgba(60,70,90,0.06)');
    }
    if (tinted) {
      ctx.save();
      ctx.beginPath(); ctx.rect(X0, Y0, X1 - X0, Y1 - Y0); ctx.clip();   // le lissage ne déborde pas hors de la carte
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tint, 0, 0, tw / K, th / K);
      ctx.restore();
    }
    // 2) gouttes et flocons : ils débordent un peu sur la zone voisine et s'y effacent progressivement
    const F = 40, Hf = F / 2;
    for (const [zn, zr] of live) {
      const kind = st.weather[zn].kind;
      const rain = kind === 'pluie' || kind === 'orage' || kind === 'tempete';
      if (!rain && kind !== 'neige') continue;
      const [x0, y0, x1, y1, eL, eR, eT, eB] = zr;
      const rx = x0 - (eL ? Hf : 0), ry = y0 - (eT ? Hf : 0), rw = x1 + (eR ? Hf : 0) - rx, rh = y1 + (eB ? Hf : 0) - ry;
      const fade = (x, y) => Math.min(eL ? (x - x0 + Hf) / F : 1, eR ? (x1 + Hf - x) / F : 1, eT ? (y - y0 + Hf) / F : 1, eB ? (y1 + Hf - y) / F : 1);
      const bucket = (x, y) => Math.ceil(clamp(fade(x, y), 0, 1) * 4) - 1;   // 4 niveaux d'opacité, -1 : invisible
      const P = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      const pool = this.wx[zn];
      const area = rw * rh / 1e5;
      ctx.save();
      ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
      if (rain) {
        const want = Math.min(420, area * (kind === 'pluie' ? 60 : 95));
        while (pool.length < want) pool.push({ x: rx + Math.random() * rw, y: ry + Math.random() * rh, l: 8 + Math.random() * 10 });
        pool.length = Math.min(pool.length, Math.ceil(want));
        const vx = kind === 'tempete' ? -260 : -60, vy = 620;
        for (const p of pool) {
          p.x += vx * dt; p.y += vy * dt;
          if (p.y > ry + rh) { p.y = ry - 10; p.x = rx + Math.random() * (rw + 200); }
          if (p.x < rx - 50) p.x += rw + 100;
          const b = bucket(p.x, p.y);
          if (b >= 0) { P[b].moveTo(p.x, p.y); P[b].lineTo(p.x + vx * 0.02, p.y + p.l); }
        }
        ctx.strokeStyle = 'rgb(205,222,240)'; ctx.lineWidth = 1;
        P.forEach((path, i) => { ctx.globalAlpha = 0.45 * (i + 1) / 4; ctx.stroke(path); });
      } else {
        const want = Math.min(360, area * 55);
        while (pool.length < want) pool.push({ x: rx + Math.random() * rw, y: ry + Math.random() * rh, r: 1 + Math.random() * 2, ph: Math.random() * 6 });
        pool.length = Math.min(pool.length, Math.ceil(want));
        for (const p of pool) {
          p.y += 40 * dt; p.x += Math.sin(time + p.ph) * 12 * dt;
          if (p.y > ry + rh) { p.y = ry - 4; p.x = rx + Math.random() * rw; }
          const b = bucket(p.x, p.y);
          if (b >= 0) { P[b].moveTo(p.x + p.r, p.y); P[b].arc(p.x, p.y, p.r, 0, Math.PI * 2); }
        }
        ctx.fillStyle = '#ffffff';
        P.forEach((path, i) => { ctx.globalAlpha = 0.9 * (i + 1) / 4; ctx.fill(path); });
      }
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
export function fmtMen(n) {
  n = Math.round(n);
  return n >= 1000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, '0')}` : String(n);
}

// le temps en tours (1 tour = 1 mois) : « au prochain tour », « dans 3 tours »
export function toursTxt(n) {
  n = Math.round(n);
  return n <= 0 ? 'ce tour-ci' : n === 1 ? 'au prochain tour' : `dans ${n} tours`;
}

// une durée en jours de travail, en part de tour (un tour = TOUR_DAYS jours de travail, game/turns.py) :
// « ⅕ de tour » (un régiment de 6 jours), « 1 tour », « 2 tours ½ »
export const TOUR_DAYS = 30;
const PARTS = [[1 / 6, '⅙'], [1 / 5, '⅕'], [1 / 4, '¼'], [1 / 3, '⅓'], [2 / 5, '⅖'], [1 / 2, '½'], [3 / 5, '⅗'], [2 / 3, '⅔'], [3 / 4, '¾'], [4 / 5, '⅘']];
export function partTour(days) {
  const x = days / TOUR_DAYS;
  let whole = Math.floor(x + 1e-9);
  let f = x - whole, part = '';
  if (f >= 0.9) whole++;
  else if (f >= 1 / 12 || !whole) part = PARTS.reduce((b, p) => Math.abs(p[0] - f) < Math.abs(b[0] - f) ? p : b)[1];
  if (!whole) return part === '½' ? '½ tour' : `${part} de tour`;
  return `${whole} ${whole > 1 ? 'tours' : 'tour'}${part ? ' ' + part : ''}`;
}
