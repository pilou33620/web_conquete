// Vue tactique : le sol qui garde la trace de la bataille (étape 9e). Une carte de piétinement couvre tout le champ
// (environ 3 m par pixel, 2 m en Ultra) : chaque régiment qui marche, charge ou se bat y dépose une tache douce à la
// forme de sa formation, plus fort pour la cavalerie et l'artillerie, deux fois plus fort sous la pluie ; chaque trou
// d'obus y laisse un peu de terre retournée. La carte est tenue en nombres (les petits dépôts de chaque pas ne se
// perdent pas dans l'arrondi) et recopiée dans un canevas, que Sol2D (sol2d.js) pose sur le sol à chaque image : une
// usure brune légère (maquette, pietine : 0,15) dès qu'une troupe est passée, plus sombre seulement là où beaucoup de
// régiments se sont battus longtemps (la carte s'y remplit de moins en moins vite).
// Elle est enregistrée avec la bataille (SPEC-SUITE F8) : une image réduite de 256 px de large, la boue en gris (la
// première ligne au nord), envoyée au serveur de temps en temps (exporter) et relue au rechargement (importer).
import { clsOf, clamp, vnoise, canvas } from './formes.js';

// dépôt par seconde (part de la boue complète, 0 à 1) d'un régiment u qui se déplace à v m/s ; wet : temps de pluie.
// Un régiment de ligne qui passe une fois laisse environ un tiers de boue ; une charge de cavalerie, la moitié.
export function depot(u, v, wet = false) {
  if (!u || u.state === 'hors' || u._ghost) return 0;
  const cls = clsOf(u), men = clamp((u.men || 0) / 500, 0, 1.5);
  if (!men || cls === 'general') return 0;
  const fight = u.state === 'melee';
  if (v < 0.3 && !fight) return 0;
  const base = cls === 'cavalerie' ? 0.12 : cls === 'artillerie' || cls === 'chariot' ? 0.08 : 0.027;
  return base * (fight ? 0.6 : 1) * (cls === 'artillerie' || cls === 'chariot' ? 1 : men) * (wet ? 2 : 1);
}

const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const STEP = 0.2;      // s entre deux dépôts
const CAP = 256;       // impacts gardés pour le prochain dépôt
const BOUE = [105, 80, 45];   // la terre foulée (maquette, pietine)
const TROU = 0.25;            // un trou d'obus ne foule pas plus que l'usure légère
// opacité de la terre foulée selon la boue (0 à 1) : 0,15 dès un passage (un tiers), jusqu'à 0,42 sous les combats longs
export const opacite = m => 0.15 * sm(0, 0.25, m) + 0.27 * sm(0.7, 1, m);

export class Pietinement {
  // W, H : taille du champ (m) ; q : profil de qualité (ultra : 2 m par pixel)
  constructor(W, H, q) {
    this.W = W; this.H = H; this.res = q?.fx >= 3 ? 2 : 3;
    const w = this.w = Math.ceil(W / this.res), h = this.h = Math.ceil(H / this.res);
    this.m = new Float32Array(w * h);
    // le sol n'est jamais foulé régulièrement : un bruit fixe module chaque dépôt
    this.n = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * this.res, y = (j + 0.5) * this.res;
      this.n[j * w + i] = 0.45 + 1.1 * vnoise(x * 0.12, y * 0.12, 11) * vnoise(x * 0.37 + 7, y * 0.37 + 7, 12);
    }
    this.t = 0; this.fresh = true;
    this.stamps = [];   // impacts en attente du prochain dépôt : [x, y, r, k]
    this.dirty = null;  // [i0, j0, i1, j1] : pixels à recopier dans le canevas
    this.canvas = typeof document !== 'undefined' ? canvas(w, h) : null;
    this.version = 0;   // change à chaque recopie (Sol2D n'a rien à faire sinon)
  }
  // un trou d'obus ou une explosion en (x, y), de rayon r m
  stamp(x, y, r, k = 0.15) { if (this.stamps.length < CAP) this.stamps.push([x, y, r, k]); }
  // units : les régiments (vue.js : x, y, dir, w, d, from, to) ; gap : intervalle entre deux relevés du serveur (s) ;
  // wet : pluie ; dt : temps écoulé (s) ; rate : secondes de bataille par seconde réelle (0 en pause)
  update(units, gap, wet, dt, rate) {
    this.t += dt * rate;
    if (this.t < STEP * Math.max(1, rate) && !this.fresh) return;
    const span = this.t; this.t = 0; this.fresh = false;
    for (const u of units) {
      if (!u.to || !u.from) continue;
      // (vitesse en m par seconde de bataille)
      const v = Math.hypot(u.to.x - u.from.x, u.to.y - u.from.y) / Math.max(0.05, gap * rate);
      // le long du sens (dir) : la profondeur de la formation ; en travers : son front
      this.tache(u.x, u.y, u.dir || 0, (u.d || 10) + 6, (u.w || 20) + 6, depot(u, v, wet) * span);
    }
    for (const [x, y, r, k] of this.stamps.splice(0)) this.tache(x, y, 0, r * 2, r * 2, k, TROU);
    this.peindre();
  }
  // tache aux bords doux, à la forme d'un rectangle arrondi (sx le long de a, sy en travers), de force k ; la carte n'y
  // dépasse pas top, et s'emplit d'autant moins vite qu'elle est pleine
  tache(x, y, a, sx, sy, k, top = 1) {
    if (!(k > 0)) return;
    const { w, h, res, m, n } = this, ca = Math.cos(a), sa = Math.sin(a), R = Math.hypot(sx, sy) / 2;
    const i0 = clamp(Math.floor((x - R) / res), 0, w - 1), i1 = clamp(Math.ceil((x + R) / res), 0, w - 1);
    const j0 = clamp(Math.floor((y - R) / res), 0, h - 1), j1 = clamp(Math.ceil((y + R) / res), 0, h - 1);
    if (i0 >= i1 || j0 >= j1) return;
    k = Math.min(1, k);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * res - x, dy = (j + 0.5) * res - y;
      const qu = Math.abs(dx * ca + dy * sa) / (sx / 2), qv = Math.abs(-dx * sa + dy * ca) / (sy / 2);
      if (qu >= 1 || qv >= 1) continue;
      const c = j * w + i;
      m[c] = Math.max(m[c], Math.min(top, m[c] + (1 - sm(0.55, 1, qu)) * (1 - sm(0.55, 1, qv)) * n[c] * k * (1 - 0.8 * m[c])));
    }
    const d = this.dirty;
    this.dirty = d ? [Math.min(d[0], i0), Math.min(d[1], j0), Math.max(d[2], i1), Math.max(d[3], j1)] : [i0, j0, i1, j1];
  }
  // recopie les pixels changés dans le canevas (terre foulée, opaque selon la boue : opacite)
  peindre() {
    const d = this.dirty;
    if (!d || !this.canvas) return;
    this.dirty = null;
    const g = this.canvas.getContext('2d'), w = this.w, iw = d[2] - d[0] + 1, ih = d[3] - d[1] + 1;
    const img = g.createImageData(iw, ih), px = img.data;
    for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) {
      const q = (j * iw + i) * 4;
      px[q] = BOUE[0]; px[q + 1] = BOUE[1]; px[q + 2] = BOUE[2]; px[q + 3] = opacite(this.m[(d[1] + j) * w + d[0] + i]) * 255;
    }
    g.putImageData(img, d[0], d[1]);
    this.version++;
  }
  // contexte graphique perdu : la carte en nombres reste, le canevas est refait
  reset() { this.dirty = [0, 0, this.w - 1, this.h - 1]; this.peindre(); }
  // la carte réduite : 256 px de large, la boue de 0 à 255, ligne 0 au nord (comme les anciennes sauvegardes)
  petite() {
    const w2 = 256, h2 = Math.max(1, Math.round(256 * this.H / this.W)), out = new Uint8ClampedArray(w2 * h2);
    for (let j = 0; j < h2; j++) for (let i = 0; i < w2; i++) {
      // (moyenne des pixels de la carte sous ce pixel)
      const a = Math.floor(i * this.w / w2), b = Math.max(a + 1, Math.floor((i + 1) * this.w / w2));
      const c = Math.floor(j * this.h / h2), e = Math.max(c + 1, Math.floor((j + 1) * this.h / h2));
      let s = 0;
      for (let y = c; y < e; y++) for (let x = a; x < b; x++) s += this.m[y * this.w + x];
      out[j * w2 + i] = Math.round(s / ((b - a) * (e - c)) * 255);
    }
    return { px: out, w: w2, h: h2 };
  }
  // relit une carte réduite (px : la boue de 0 à 255, w × h), adoucie
  depuis(px, w2, h2) {
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const fx = clamp((i + 0.5) * w2 / this.w - 0.5, 0, w2 - 1), fy = clamp((j + 0.5) * h2 / this.h - 0.5, 0, h2 - 1);
      const x = Math.min(w2 - 2, Math.floor(fx)), y = Math.min(h2 - 2, Math.floor(fy)), u = fx - x, v = fy - y;
      const at = (a, b) => px[clamp(b, 0, h2 - 1) * w2 + clamp(a, 0, w2 - 1)];
      this.m[j * this.w + i] = ((at(x, y) * (1 - u) + at(x + 1, y) * u) * (1 - v) + (at(x, y + 1) * (1 - u) + at(x + 1, y + 1) * u) * v) / 255;
    }
    this.fresh = false;
    this.reset();
  }
  // la carte réduite en image PNG, pour l'enregistrer avec la bataille
  exporter() {
    const { px, w, h } = this.petite(), cv = canvas(w, h), g = cv.getContext('2d'), img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = px[i]; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
  // relit une carte enregistrée (exporter) ; false si l'image est illisible
  importer(url) {
    if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) return Promise.resolve(false);
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { res(false); return; }
        const cv = canvas(w, h), g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h).data, px = new Uint8ClampedArray(w * h);
        for (let i = 0; i < w * h; i++) px[i] = d[i * 4];
        cv.width = cv.height = 0;
        this.depuis(px, w, h);
        res(true);
      };
      img.onerror = () => res(false);
      img.src = url;
    });
  }
  dispose() { if (this.canvas) this.canvas.width = this.canvas.height = 0; }
}
