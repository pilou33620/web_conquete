// Vue tactique en 2D (SPEC-2D.md § 3 « Décor », § 4) : ce qui est debout sur le champ de bataille, vu de dessus.
// sous (sous les troupes) : bâtiments d'époque selon la région et le siècle, îlots de maisons serrées le long des rues,
// enceintes (mur médiéval à tours rondes, tracé bastionné avec fossé, demi-lunes, chemin couvert et glacis ; portes,
// brèches en talus d'éboulis), ouvrages de siège, murets et clôtures, ponts, puis la vie des champs (bêtes, bergers,
// villageois qui fuient, charrettes à bœufs). dessus (au-dessus des troupes) : houppiers des bois, ajourés là où se
// tiennent des hommes, flammes des maisons, fumées (cheminées, incendies), braises, ailes des moulins.
// Le décor fixe est peint une fois dans des tuiles (512 px, par niveau de zoom ; une vue d'ensemble à 0,5 px/m toujours
// prête) ; chaque image ne fait que les poser, et ne dessine que ce qui bouge. Un bâtiment touché, en feu ou en ruine
// (bati, d'après le serveur : SPEC-2D § 5) fait repeindre le coin des tuiles qui le couvrent.
// Données : la carte du serveur (buildings et leur kind, walls, place ; s'il y en a, town, bastions) et ce que
// terrain.js en a tiré (cases, treeGrid, gates, bridges, fencePts, roadPts, palette de la saison). Sans bâtiments
// donnés, ils sont déduits des cases BATI ; sans enceinte donnée, des cases MUR, PORTE et BRECHE.
// Dessins : decor2d-dessin.js (repris de la maquette web/js/battle/dev/maquette-2d.html).
import { T as TY, hash, clamp, TAU, vnoise, canvas } from './formes.js';
import * as D from './decor2d-dessin.js';

const TPX = 512;                              // côté d'une tuile (px)
const NIVEAUX = [0.5, 1, 2, 4, 8, 16, 32];    // finesses des tuiles (px par mètre)
const VUE = 0.5;                              // la vue d'ensemble, peinte d'avance
const SEAU = 64;                              // grille de rangement des objets (m)
const ECH = D.ECH;
const VENT = [1.1, -0.35];                    // vent par défaut (m/s) quand la vue n'en donne pas

// ------------------------------------------------------------------ régions, époques
// contrée d'après le département (« plaine (33) ») : les toits en dépendent (SPEC-2D § 4)
const SUD = new Set('04 05 06 07 09 11 12 13 16 17 24 26 2A 2B 30 31 32 33 34 40 46 47 64 65 66 79 81 82 83 84 86'.split(' '));
const OUEST = new Set('14 22 27 29 35 44 49 50 53 56 61 72 76 85'.split(' '));
const NORD = new Set('02 08 59 60 62 75 77 78 80 91 92 93 94 95'.split(' '));
const COLOMBAGES = new Set('10 14 27 51 67 68 76'.split(' '));
export const departement = region => (/\((\w{1,3})\)/.exec(region || '') || [])[1] || '';
export function contree(region) {
  const d = departement(region);
  return SUD.has(d) ? 'sud' : OUEST.has(d) ? 'ouest' : NORD.has(d) ? 'nord' : 'centre';
}
// toit d'un bâtiment : ardoise au nord et en ville, tuile plate au centre, tuile canal au sud, chaume dans les
// campagnes de l'ouest (et un peu au centre) avant qu'il ne recule ; h : un tirage entre 0 et 1
export function toitDe(c, urbain, year, h, montagne = false) {
  if (c === 'sud') return 'canal';
  if (montagne || c === 'nord') return 'ardoise';
  if (c === 'ouest') return urbain ? 'ardoise' : h < (year < 1850 ? 0.45 : year < 1890 ? 0.25 : 0.08) ? 'chaume' : 'ardoise';
  return urbain ? (h < 0.65 ? 'ardoise' : 'tuile') : h < (year < 1850 ? 0.12 : 0.03) ? 'chaume' : 'tuile';
}
// modèle de la maquette pour un bâtiment ; la gare et les immeubles haussmanniens n'existent qu'après leur date
export const DATES = { gare: 1840, haussmann: 1853, egliseDome: 1630, chateau: 1600, caserne: 1690 };
const KINDS = { immeuble: 'haussmann', mairie: 'hotelDeVille', hotel_de_ville: 'hotelDeVille', hoteldeville: 'hotelDeVille', 'hôtel': 'hotel', 'château': 'chateau', 'hôpital': 'hopital', 'poudrière': 'poudriere', 'église': 'eglise', 'cathédrale': 'cathedrale' };

const BATI = TY.BATI, MURS = new Set([TY.MUR, TY.PORTE, TY.BRECHE]);
const BLOQUE = new Set([TY.EAU, TY.BOIS, TY.FORET, TY.BATI, TY.MUR, TY.MARAIS, TY.BARRICADE]);

// ------------------------------------------------------------------ outils
const pousse = (C, p, d) => { const dx = p[0] - C[0], dy = p[1] - C[1], l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * d, p[1] + dy / l * d]; };
const boiteDe = pts => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; };
const centre = pts => { const b = boiteDe(pts); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
const longueur = pts => pts.reduce((a, p, k) => k ? a + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0, 0);
function surChemin(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0);
    if (s <= l || i === pts.length - 1) { const k = clamp(s / (l || 1), 0, 1); return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, Math.atan2(y1 - y0, x1 - x0)]; }
    s -= l;
  }
  return [pts[0][0], pts[0][1], 0];
}
function decaler(pts, d) {
  return pts.map((p, k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [p[0] - (b[1] - a[1]) / l * d, p[1] + (b[0] - a[0]) / l * d]; });
}
function reechant(pts, pas) {
  const out = [];
  for (let k = 1; k < pts.length; k++) { const [ax, ay] = pts[k - 1], [bx, by] = pts[k], L = Math.hypot(bx - ax, by - ay); for (let u = 0; u < L; u += pas) out.push([ax + (bx - ax) * u / L, ay + (by - ay) * u / L]); }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * clamp(k, 0, 1);
const coupe = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export class Decor2D {
  // terrain : Terrain (terrain.js) ; map : la carte du serveur (/api/tactic_map) ; q : profil de qualité (qualite.js)
  constructor(terrain, map = {}, q = {}) {
    this.tr = terrain; this.m = map || {}; this.q = q || {};
    this.W = terrain.W; this.H = terrain.H; this.cell = terrain.cell; this.cols = terrain.cols; this.rows = terrain.rows;
    this.t = terrain.t;
    this.year = this.m.year || terrain.year || 1790;
    this.region = this.m.region || terrain.region || '';
    this.contree = contree(this.region);
    this.seed = (this.m.seed | 0) || terrain.seed || 1;
    this.pal = terrain.pal || { arbres: ['#3d7a34', '#4b8a3b', '#5a9944'], pins: ['#1f4a35', '#25553c'] };
    this.neige = !!this.pal.neige;
    this.montagne = (terrain.hmax ?? 0) > 55;
    this.ville = this.lireVille();
    this.etat = new Uint8Array(this.cols * this.rows);
    this.time = 0;
    this.mk = (w, h) => canvas(w, h);
    this.spr = D.sprites(this.mk);
    this.fumees = []; this.feux = new Map();
    this.couches = { sous: this.couche(), canopee: this.couche() };
    this.preparerBatiments();
    this.preparerArbres();
    this.objetsFixes();
    this.walls();
    this.peupler();
    // la vue d'ensemble est prête dès l'ouverture : rien n'apparaît par morceaux quand on dézoome
    for (const k of ['sous', 'canopee']) this.peindreVue(this.couches[k], k);
  }
  lireVille() {
    const tw = this.m.town, pl = this.m.place || this.tr.place;
    const c = tw && (Array.isArray(tw.centre) ? tw.centre : tw.centre ? [tw.centre.x, tw.centre.y] : [tw.x, tw.y]);
    if (tw && c && c[0] != null) return { type: tw.type || pl?.type || 'ville', x: c[0], y: c[1], r: tw.radius ?? tw.r ?? pl?.r ?? 150, siecle: tw.century ?? tw.siecle ?? null };
    if (pl) return { type: pl.type || 'village', x: pl.x, y: pl.y, r: pl.r || 120, siecle: null };
    return null;
  }
  at(x, y) { return this.t[clamp(Math.floor(y / this.cell), 0, this.rows - 1) * this.cols + clamp(Math.floor(x / this.cell), 0, this.cols - 1)]; }
  caseDe(x, y) { const i = Math.floor(x / this.cell), j = Math.floor(y / this.cell); return i < 0 || j < 0 || i >= this.cols || j >= this.rows ? -1 : j * this.cols + i; }
  urbain(x, y) { const v = this.ville; return !!v && v.type !== 'village' && Math.hypot(x - v.x, y - v.y) < v.r * 1.15; }

  // ------------------------------------------------------------------ bâtiments
  preparerBatiments() {
    const { cols, rows, cell, t } = this, n = cols * rows;
    // groupes de cases bâties (voisines par un côté)
    const comp = new Int32Array(n).fill(-1), taille = [];
    for (let c0 = 0; c0 < n; c0++) {
      if (t[c0] !== BATI || comp[c0] >= 0) continue;
      const id = taille.length, pile = [c0]; comp[c0] = id; let k = 0;
      while (pile.length) {
        const c = pile.pop(), i = c % cols; k++;
        for (const d of [c - cols, c + cols, i > 0 ? c - 1 : -1, i < cols - 1 ? c + 1 : -1]) if (d >= 0 && d < n && t[d] === BATI && comp[d] < 0) { comp[d] = id; pile.push(d); }
      }
      taille.push(k);
    }
    this.comp = comp; this.taille = taille;
    const src = (this.m.buildings && this.m.buildings.length ? this.m.buildings : this.tr.buildings) || [];
    const B = this.batiments = [];
    this.parCase = new Map();
    const occupe = new Uint8Array(n), maisons = new Uint16Array(n);
    const bourg = c => c >= 0 && t[c] === BATI && taille[comp[c]] >= (src.length ? 6 : 4);
    for (const b of src) { const c = this.caseDe(b.x, b.y); if (c >= 0 && (b.kind || 'maison') === 'maison') maisons[c]++; }
    if (src.length) {
      // les fermes à cour fermée ont leurs granges : l'annexe voisine n'est pas redessinée
      const grandes = src.filter(b => b.kind === 'ferme' && b.w >= 18);
      for (const b of src) {
        const kind = KINDS[b.kind] || b.kind || 'maison', c = this.caseDe(b.x, b.y);
        if (kind === 'maison' && bourg(c) && maisons[c] <= 1) continue;   // dans un bourg : l'îlot de sa case
        if (kind === 'ferme' && b.w < 18 && grandes.some(o => Math.hypot(o.x - b.x, o.y - b.y) < 45 && this.modele(o).cle === 'fermeCour')) continue;
        this.ajouter(Object.assign({}, b, { kind }), occupe);
      }
    } else {
      // sans bâtiments donnés : un petit groupe de cases est une maison ou une ferme, un grand un bourg (îlots) et
      // son église au plus près de son milieu
      const somme = taille.map(() => [0, 0, 0]);
      for (let c = 0; c < n; c++) if (comp[c] >= 0) { const s = somme[comp[c]]; s[0] += (c % cols + 0.5) * cell; s[1] += (((c / cols) | 0) + 0.5) * cell; s[2]++; }
      const grand = taille.indexOf(Math.max(0, ...taille));
      somme.forEach(([sx, sy, k], id) => {
        const x = sx / k, y = sy / k, a = hash(id, 3, this.seed) < 0.5 ? 0 : Math.PI / 2;
        if (k <= 3) this.ajouter({ x, y, w: k === 3 ? 24 : 14, h: k === 3 ? 12 : 9, a, kind: k === 3 ? 'ferme' : 'maison' }, occupe);
        else if (id === grand) {
          let best = -1, bd = 1e9;
          for (let c = 0; c < n; c++) if (comp[c] === id) { const d = Math.hypot((c % cols + 0.5) * cell - x, (((c / cols) | 0) + 0.5) * cell - y); if (d < bd) { bd = d; best = c; } }
          this.ajouter({ x: (best % cols + 0.5) * cell, y: (((best / cols) | 0) + 0.5) * cell, w: 26, h: 12, a: 0, kind: 'eglise' }, occupe);
        }
      });
    }
    // les îlots : chaque case d'un bourg qui n'est ni sous un grand bâtiment ni déjà garnie de maisons données
    for (let c = 0; c < n; c++) if (bourg(c) && !occupe[c] && maisons[c] <= 1) this.ajouterIlot(c);
    // une case bâtie sans rien dessus (cour de ferme) brûle avec le bâtiment le plus proche
    for (let c = 0; c < n; c++) {
      if (t[c] !== BATI || this.parCase.has(c)) continue;
      const x = (c % cols + 0.5) * cell, y = (((c / cols) | 0) + 0.5) * cell;
      let best = null, bd = 30;
      for (const b of B) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
      if (best) { best.cells.push(c); this.parCase.set(c, [best]); }
    }
    B.sort((a, b) => a.y - b.y);
  }
  // le modèle de la maquette d'un bâtiment donné : clé, volumes (unités), échelle (m par unité), palettes remplacées
  modele(b) {
    let kind = b.kind || 'maison';
    if ((kind === 'gare' || kind === 'haussmann') && this.year < DATES[kind]) kind = 'maison';   // pas avant leur date
    const c = this.contree, v = this.ville, h = hash(b.x | 0, b.y | 0, this.seed + 7), urb = this.urbain(b.x, b.y);
    const toit = toitDe(c, urb, this.year, h, this.montagne), remap = toit === 'tuile' ? null : { tuile: toit };
    let cle = kind, parts;
    switch (kind) {
      case 'eglise': {
        const grande = v && (v.type === 'capitale' || v.type === 'ville') && Math.hypot(b.x - v.x, b.y - v.y) < v.r * 0.4;
        cle = grande && (v.type === 'capitale' || h < 0.55) ? 'cathedrale' : v && v.type !== 'village' && this.year >= DATES.egliseDome && h < 0.5 ? 'egliseDome' : 'egliseRomane';
        parts = cle === 'egliseRomane' ? D.BATS.egliseRomane(c === 'sud' ? 'canal' : 'ardoise') : D.BATS[cle]();
        break;
      }
      case 'ferme':
        if (b.w >= 18) { cle = c === 'ouest' ? 'longere' : c === 'sud' ? 'mas' : 'fermeCour'; parts = cle === 'longere' ? D.BATS.longere(toit) : D.BATS[cle](); }
        else { cle = 'grange'; parts = D.BATS.maison(b.w / ECH, b.h / ECH, toit, D.alea(h * 1e9), true); }
        break;
      case 'moulin': cle = b.water ? 'moulinEau' : 'moulin'; parts = D.BATS[cle](); break;
      default:
        if (D.BATS[kind] && kind !== 'maison' && !(DATES[kind] && this.year < DATES[kind])) parts = D.BATS[kind]();
        else { cle = 'maison'; parts = D.BATS.maison(b.w / ECH, b.h / ECH, toit, D.alea(h * 1e9), false); }
    }
    const bx = D.boite(parts), natW = (bx[2] - bx[0]) * ECH;
    // les modèles gardent leurs proportions ; un bâtiment donné plus grand les agrandit (jusqu'au double)
    const s = cle === 'maison' || cle === 'grange' ? ECH : ECH * clamp((b.w || 0) / natW, 1, 2);
    return { cle, parts, s, boite: bx, remap: cle === 'maison' || cle === 'grange' || cle === 'longere' ? null : remap };
  }
  ajouter(src, occupe) {
    const md = this.modele(src), a = src.a || 0, s = md.s, [u0, v0, u1, v1] = md.boite;
    const b = { kind: src.kind, cle: md.cle, x: src.x, y: src.y, a, s, parts: md.parts, remap: md.remap, boite: md.boite, etat: 0, braise: 0, cells: [], seed: (hash(src.x | 0, src.y | 0, this.seed) * 2 ** 31) | 0 };
    const ca = Math.cos(a), sa = Math.sin(a), monde = (u, v) => [src.x + (u * ca - v * sa) * s, src.y + (u * sa + v * ca) * s];
    const coins = [monde(u0, v0), monde(u1, v0), monde(u1, v1), monde(u0, v1)];
    const bb = boiteDe(coins);
    b.bbox = [bb[0] - 8, bb[1] - 8, bb[2] + 10, bb[3] + 10];
    b.r = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2;
    // cases sous l'emprise : leur état est celui du bâtiment ; un grand bâtiment chasse les îlots de ses cases
    const dedans = (x, y, m) => { const dx = x - src.x, dy = y - src.y, u = (dx * ca + dy * sa) / s, v = (-dx * sa + dy * ca) / s; return u > u0 - m && u < u1 + m && v > v0 - m && v < v1 + m; };
    const cs = new Set([this.caseDe(src.x, src.y)]);
    for (let y = bb[1]; y <= bb[3]; y += 4) for (let x = bb[0]; x <= bb[2]; x += 4) if (dedans(x, y, 0)) cs.add(this.caseDe(x, y));
    for (const c of cs) {
      if (c < 0 || (this.t[c] !== BATI && c !== this.caseDe(src.x, src.y))) continue;
      b.cells.push(c);
      const l = this.parCase.get(c); if (l) l.push(b); else this.parCase.set(c, [b]);
      const cx = (c % this.cols + 0.5) * this.cell, cy = (((c / this.cols) | 0) + 0.5) * this.cell;
      if (b.cle !== 'maison' && (c === this.caseDe(src.x, src.y) || dedans(cx, cy, 2 / s))) occupe[c] = 1;
    }
    // cheminées (pour la fumée), foyers (pour les flammes), ailes
    const R = D.alea(b.seed);
    b.chem = md.parts.filter(p => p.chem).map(p => monde(p.x + p.w / 2, p.y + p.h / 2));
    const toits = md.parts.filter(p => !p.sol && p.t !== 'fn' && p.t !== 'arbre' && p.t !== 'r' && !p.chem);
    const aire = toits.reduce((a, p) => a + (p.r != null ? p.r * p.r * 3 : p.w * p.h), 0);
    b.foyers = [];
    for (let k = 0; k < clamp(Math.round(aire / 40), 5, 18) && toits.length; k++) {
      const p = toits[(R() * toits.length) | 0], [cx, cy, w, h] = p.r != null ? [p.x, p.y, p.r * 1.4, p.r * 1.4] : [p.x + p.w / 2, p.y + p.h / 2, p.w, p.h];
      b.foyers.push([cx + (R() - .5) * w * .8, cy + (R() - .5) * h * .7, R() * 20, .8 + R() * .6]);
    }
    b.ailes = md.cle === 'moulin';
    this.batiments.push(b);
    return b;
  }
  // une case d'un bourg : des maisons serrées le long des côtés qui donnent sur la rue (une par parcelle), une cour
  // au milieu ; au cœur d'un grand pâté, des corps de logis sur deux côtés. Repère : unités, centré sur la case
  ajouterIlot(c) {
    const { cols, cell, t } = this, i = c % cols, j = (c / cols) | 0, x = (i + 0.5) * cell, y = (j + 0.5) * cell;
    const S = cell / ECH, h = S / 2, R = D.alea((hash(i, j, this.seed + 11) * 2 ** 31) | 0);
    const nb = (di, dj) => { const ii = i + di, jj = j + dj; return ii < 0 || jj < 0 || ii >= cols || jj >= this.rows ? TY.PRE : t[jj * cols + ii]; };
    const rue = v => v !== BATI && !MURS.has(v);
    const cotes = { N: [[-h, -h], [1, 0], [0, 1], nb(0, -1)], E: [[h, -h], [0, 1], [-1, 0], nb(1, 0)], S: [[h, h], [-1, 0], [0, -1], nb(0, 1)], O: [[-h, h], [0, -1], [1, 0], nb(-1, 0)] };
    let fronts = Object.keys(cotes).filter(k => rue(cotes[k][3]));
    const coeur = !fronts.length;
    if (coeur) fronts = hash(i, j, this.seed + 12) < 0.5 ? ['N', 'S'] : ['E', 'O'];
    const prof = {}; for (const k of fronts) prof[k] = coeur ? 11 + R() * 3 : 14 + R() * 5;
    const v = this.ville, urb = this.urbain(x, y), dVille = v ? Math.hypot(x - v.x, y - v.y) / v.r : 9;
    // immeubles haussmanniens : dans le centre des villes, sur les rues, après 1853
    const haussmann = this.year >= DATES.haussmann && v && (v.type === 'ville' || v.type === 'capitale') && dVille < 0.55 && !coeur && fronts.some(k => cotes[k][3] === TY.ROUTE);
    const pignonSurRue = COLOMBAGES.has(departement(this.region)) && this.year < 1880;
    const dom = toitDe(this.contree, urb, this.year, hash(i >> 2, j >> 2, this.seed + 13), this.montagne);
    const parcelles = [], chem = [];
    for (const k of fronts) {
      const [o0, u, nn] = cotes[k], d = prof[k], L = S;
      const debut = { N: 'O', E: 'N', S: 'E', O: 'S' }[k], finK = { N: 'E', E: 'S', S: 'O', O: 'N' }[k];
      // (les côtés est et ouest laissent les coins aux rangées du nord et du sud)
      const t0 = (k === 'E' || k === 'O') && fronts.includes(debut) ? prof[debut] : 0;
      const t1 = L - ((k === 'E' || k === 'O') && fronts.includes(finK) ? prof[finK] : 0);
      for (let s = t0; s < t1 - 1;) {
        let w = haussmann ? 16 + R() * 6 : 10 + R() * 7;
        if (t1 - s - w < 8) w = t1 - s;
        if (!haussmann && !urb && R() < 0.08) { s += w; continue; }   // une dent creuse au village
        let key = dom; if (!haussmann && R() < 0.12) key = toitDe(this.contree, urb, this.year, R(), this.montagne);
        const o = [o0[0] + u[0] * s, o0[1] + u[1] * s], jit = R() < 0.5 ? '#ffffff' : '#000000', kj = R() * 0.08;
        const p = { o, u, n: nn, w: w + 0.15, d: d * (haussmann ? 1 : 0.85 + R() * 0.25), key, jit, kj, mans: haussmann, long: !(pignonSurRue && R() < 0.6) };
        parcelles.push(p);
        if (!haussmann && R() < 0.4) { const m = [o[0] + nn[0] * p.d / 2 + u[0] * p.w * 0.8, o[1] + nn[1] * p.d / 2 + u[1] * p.w * 0.8]; p.chem = m; chem.push([x + m[0] * ECH, y + m[1] * ECH]); }
        s += w;
      }
    }
    // un arbre ou deux dans la cour, quand il y a la place
    const arbres = fronts.length <= 2 && !coeur && !haussmann ? Array.from({ length: 1 + (R() < 0.5) }, () => [(R() - 0.5) * S * 0.4, (R() - 0.5) * S * 0.4, 2.6 + R() * 2, D.BOIS[(R() * 5) | 0]]) : [];
    const b = { kind: 'maison', cle: 'ilot', x, y, a: 0, s: ECH, parcelles, arbres, boite: [-h, -h, h, h], etat: 0, braise: 0, cells: [c], seed: (hash(i, j, this.seed + 14) * 2 ** 31) | 0, chem, bbox: [x - cell / 2 - 6, y - cell / 2 - 6, x + cell / 2 + 8, y + cell / 2 + 8], r: cell * 0.7 };
    b.foyers = parcelles.map(p => [p.o[0] + p.u[0] * p.w / 2 + p.n[0] * p.d / 2, p.o[1] + p.u[1] * p.w / 2 + p.n[1] * p.d / 2, R() * 20, .8 + R() * .6]);
    this.batiments.push(b);
    this.parCase.set(c, [b]);
    return b;
  }
  // dessin d'un bâtiment selon son état (0 intact, 1 touché, 2 en feu, 3 en ruine)
  dessiner(g, b) {
    const R = D.alea(b.seed), e = b.etat;
    if (b.cle === 'ilot') return this.dessinerIlot(g, b, R);
    const roof = (D.PAL[b.remap?.tuile || 'tuile'] || D.PAL.tuile)[0];
    if (e >= 1) { g.save(); g.translate(b.x, b.y); g.rotate(b.a); g.scale(b.s, b.s); D.debris(g, b.boite[2] - b.boite[0], b.boite[3] - b.boite[1], roof, D.alea(b.seed + 1)); g.restore(); }
    if (e === 3) { g.save(); g.translate(b.x, b.y); g.rotate(b.a); g.scale(b.s, b.s); D.ruines(g, b.parts, R); g.restore(); return; }
    D.bat(g, b.parts, b.x, b.y, b.a, b.s, b.remap);
    if (e >= 1) {
      g.save(); g.translate(b.x, b.y); g.rotate(b.a); g.scale(b.s, b.s);
      D.dessinTrous(g, D.trousParts(b.parts, 1 + ((b.seed >>> 3) % 3) + (e === 2 ? 1 : 0), D.alea(b.seed + 2)), roof);
      if (e === 2) D.voile(g, b.parts, '#1c0f08', 0.5);   // la charpente brûle : le toit noircit
      g.restore();
    }
  }
  dessinerIlot(g, b, R) {
    const e = b.etat, OMB = [1.8, 2.4];
    g.save(); g.translate(b.x, b.y); g.scale(b.s, b.s);
    const quad = p => { const { o, u, n, w, d } = p; return [o[0], o[1], o[0] + u[0] * w, o[1] + u[1] * w, o[0] + u[0] * w + n[0] * d, o[1] + u[1] * w + n[1] * d, o[0] + n[0] * d, o[1] + n[1] * d]; };
    if (e === 3) {
      for (const p of b.parcelles) {
        const q = quad(p);
        D.PG(g, '#2c2622', q);
        g.setLineDash([2 + R() * 5, 1.6, 3, 1.2]); g.strokeStyle = '#b9ad95'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(q[0], q[1]); for (let k = 2; k < 8; k += 2) g.lineTo(q[k], q[k + 1]); g.closePath(); g.stroke(); g.setLineDash([]);
        D.T(g, '#16110d', .8, q[0] * .8 + q[4] * .2, q[1] * .8 + q[5] * .2, q[0] * .25 + q[4] * .75, q[1] * .25 + q[5] * .75);
      }
      g.restore(); return;
    }
    // ombres d'un seul tracé, puis les toits
    g.fillStyle = 'rgba(20,20,10,.3)'; g.beginPath();
    for (const p of b.parcelles) { const q = quad(p); g.moveTo(q[0] + OMB[0], q[1] + OMB[1]); for (let k = 2; k < 8; k += 2) g.lineTo(q[k] + OMB[0], q[k + 1] + OMB[1]); g.closePath(); }
    g.fill();
    for (const [x, y, r, c] of b.arbres) D.arbre(g, x, y, r, this.neige ? D.mix(c, '#9a9488', .65) : c);
    for (const p of b.parcelles) {
      if (p.mans) { g.save(); g.translate(p.o[0], p.o[1]); g.transform(p.u[0], p.u[1], p.n[0], p.n[1], 0, 0); D.mansardeF(g, 0, 0, p.w, p.d, Math.atan2(p.u[1], p.u[0])); g.restore(); }
      else D.toitParcelle(g, p.o, p.u, p.n, p.w, p.d, D.PAL[p.key].map(c => D.mix(c, p.jit, p.kj)), p.long);
      if (p.chem) D.RR(g, '#7d4a3a', p.chem[0] - .7, p.chem[1] - .7, 1.4, 1.4, .2);
    }
    if (e >= 1 && b.parcelles.length) {
      const touchees = e === 2 ? b.parcelles : [b.parcelles[(b.seed >>> 2) % b.parcelles.length]];
      for (const p of touchees) {
        const cx = p.o[0] + p.u[0] * p.w / 2 + p.n[0] * p.d / 2, cy = p.o[1] + p.u[1] * p.w / 2 + p.n[1] * p.d / 2;
        D.dessinTrous(g, D.trous(1, 4, 4, R).map(tt => ({ x: tt.x + cx, y: tt.y + cy, r: tt.r, pts: tt.pts.map(([x, y]) => [x + cx, y + cy]) })), D.PAL[p.key][0]);
      }
      if (e === 2) { g.globalAlpha = .5; g.fillStyle = '#1c0f08'; g.beginPath(); for (const p of b.parcelles) { const q = quad(p); g.moveTo(q[0], q[1]); for (let k = 2; k < 8; k += 2) g.lineTo(q[k], q[k + 1]); g.closePath(); } g.fill(); g.globalAlpha = 1; }
    }
    g.restore();
  }
  // états des cases bâties reçus du serveur : [[case, état], …] (SPEC-2D § 5) ; l'incendie lui-même (où il prend,
  // combien de temps il dure) est décidé par le serveur : ici, on dessine et on anime
  bati(etats) {
    const n = this.etat.length;
    for (const [c, e] of etats || []) {
      if (!(c >= 0 && c < n) || this.etat[c] === e) continue;
      this.etat[c] = clamp(e | 0, 0, 3);
      for (const b of this.parCase.get(c) || []) this.majBatiment(b);
    }
  }
  majBatiment(b) {
    const es = b.cells.map(c => this.etat[c]), e = es.includes(2) ? 2 : Math.max(0, ...es), av = b.etat;
    if (e === av) return;
    b.etat = e;
    if (e === 2) this.feux.set(b, { t: 0, I: 0, fin: false });
    else { const f = this.feux.get(b); if (f) f.fin = true; }
    if (e === 3) b.braise = 1;
    this.invalider(b.bbox);
  }

  // ------------------------------------------------------------------ arbres (houppiers, au-dessus des troupes)
  preparerArbres() {
    const tg = this.tr.treeGrid || [], pal = this.pal, fx = this.q.fx ?? 2, S = this.seed;
    const garder = [0.45, 0.7, 1, 1][fx] ?? 1, plus = 1 / Math.sqrt(garder);
    const sc = Math.ceil(this.W / SEAU), sr = Math.ceil(this.H / SEAU);
    this.arbresSeau = Array.from({ length: sc * sr }, () => []);
    this.sc = sc; this.sr = sr;
    const bois = c => this.t[c] === TY.BOIS || this.t[c] === TY.FORET;
    const nuance = (c, x, y) => {
      if (this.neige) return D.mix(c, '#d8dde0', .25);
      const n = vnoise(x / 300, y / 300, S + 61), o = hash(x | 0, y | 0, 11);
      c = n > 0.62 ? D.mix(c, '#7f9a3a', .18) : n < 0.38 ? D.mix(c, '#2a5a52', .18) : c;   // nappes plus jaunes ou plus bleues
      return o < 0.1 ? D.mix(c, '#9fbf5a', .3) : o > 0.9 ? D.sombre(c, .25) : c;
    };
    tg.forEach((liste, c) => {
      const w = bois(c);
      for (const tr of liste || []) {
        if (w && hash(tr.x | 0, tr.y | 0, 7) > garder) continue;
        const k = tr.kind || 'feuillu', big = w && k !== 'buisson' && k !== 'nu' ? plus : 1;
        let col = k === 'sapin' || k === 'parasol' ? pal.pins[(tr.ci ?? 0) % pal.pins.length] : pal.arbres[(tr.ci ?? 0) % pal.arbres.length];
        if (k !== 'meule' && k !== 'nu') col = nuance(col, tr.x, tr.y);
        if (w && k !== 'meule') col = D.sombre(col, .12);
        const r = tr.r * (k === 'peuplier' ? 0.55 : 1) * big * (0.92 + hash(tr.x | 0, tr.y | 0, 5) * 0.16);
        const i = clamp(Math.floor(tr.x / SEAU), 0, sc - 1), j = clamp(Math.floor(tr.y / SEAU), 0, sr - 1);
        this.arbresSeau[j * sc + i].push([tr.x, tr.y, r, col, k === 'sapin' ? 'sapin' : k === 'meule' ? 'meule' : k === 'nu' ? 'nu' : 'rond']);
      }
    });
  }
  // trous du feuillage au-dessus des hommes : [x, y, dir, profondeur, front] pour chaque régiment sous les arbres
  clairieres(units) {
    const out = [];
    for (const u of units || []) {
      if (!u || u._ghost || u.state === 'hors') continue;
      const rout = u.state === 'deroute', hw = (Math.max(6, u.w || 0) / 2 + 5) * (rout ? 1.5 : 1), hd = (Math.max(6, u.d || 0) / 2 + 5) * (rout ? 1.8 : 1);
      const R = Math.hypot(hw, hd) + 8, i0 = Math.max(0, Math.floor((u.x - R) / SEAU)), i1 = Math.min(this.sc - 1, Math.floor((u.x + R) / SEAU));
      const j0 = Math.max(0, Math.floor((u.y - R) / SEAU)), j1 = Math.min(this.sr - 1, Math.floor((u.y + R) / SEAU));
      let sous = false;
      for (let j = j0; j <= j1 && !sous; j++) for (let i = i0; i <= i1 && !sous; i++) for (const a of this.arbresSeau[j * this.sc + i]) if (Math.abs(a[0] - u.x) < R + a[2] && Math.abs(a[1] - u.y) < R + a[2]) { sous = true; break; }
      if (sous) out.push([u.x, u.y, u.dir || 0, hd, hw]);
    }
    return out;
  }

  // ------------------------------------------------------------------ objets fixes : ponts, clôtures, ouvrages
  objetsFixes() {
    const tr = this.tr, neige = this.neige, F = this.fixes = [];
    const bridges = tr.bridges || this.m.bridges || [], kinds = this.m.bridges || [];
    bridges.forEach((br, k) => {
      const L = br.len || 30, bateaux = (br.kind || kinds[k]?.kind) === 'bateaux';
      F.push({ z: 2, bbox: [br.x - L / 2 - 8, br.y - L / 2 - 8, br.x + L / 2 + 8, br.y + L / 2 + 8], draw: g => {
        g.save(); g.translate(br.x, br.y); g.rotate(br.a || 0);
        if (bateaux) {   // pont de bateaux : des barques sous un tablier de planches
          for (let x = -L / 2 + 3; x < L / 2 - 1; x += 6) D.E(g, '#5b4127', x, 0, 2.2, 5.5);
          D.RR(g, '#a88a5e', -L / 2, -2.6, L, 5.2, .4); g.strokeStyle = '#7a5f3e'; g.lineWidth = .15; g.beginPath(); for (let x = -L / 2; x < L / 2; x += .8) { g.moveTo(x, -2.6); g.lineTo(x, 2.6); } g.stroke();
        } else {
          D.RR(g, 'rgba(20,20,10,.35)', -L / 2 + .8, -4.5 + 1.1, L, 9, 1); D.RR(g, neige ? '#dedbd2' : '#b8ad94', -L / 2, -4.5, L, 9, 1); D.RR(g, neige ? '#eceae4' : '#cfc3a2', -L / 2, -3, L, 6, .8);
          D.RR(g, '#8f856e', -L / 2, -4.5, L, 1.2, .5); D.RR(g, '#8f856e', -L / 2, 3.3, L, 1.2, .5);
          for (let x = -L / 2 + 6; x < L / 2 - 4; x += 7) { D.E(g, '#9a907a', x, -5, 1.2, .7); D.E(g, '#9a907a', x, 5, 1.2, .7); }
        }
        g.restore();
      } });
    });
    // (les haies sont peintes par le sol : ici les murets et les clôtures de bois)
    for (const f of tr.fencePts || this.m.fences || []) {
      if (f.kind === 'haie' || !f.pts || f.pts.length < 2) continue;
      const b = boiteDe(f.pts), pts = f.pts;
      F.push({ z: 1, bbox: [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3], draw: g => {
        g.lineCap = 'round'; g.lineJoin = 'round';
        if (f.kind === 'muret') { D.ligne(g, decaler(pts, .4)); g.strokeStyle = 'rgba(20,20,10,.3)'; g.lineWidth = .8; g.stroke(); D.ligne(g, pts); g.strokeStyle = neige ? '#e6e6e2' : '#a39a84'; g.lineWidth = .7; g.stroke(); g.strokeStyle = neige ? '#f4f4f2' : '#bfb6a0'; g.lineWidth = .35; g.stroke(); }
        else { D.ligne(g, pts); g.strokeStyle = '#8a6a46'; g.lineWidth = .14; g.stroke(); g.fillStyle = neige ? '#4e4034' : '#5a4430'; g.beginPath(); for (const p of reechant(pts, 2.5)) { g.moveTo(p[0] + .14, p[1]); g.arc(p[0], p[1], .14, 0, TAU); } g.fill(); }
      } });
    }
  }
  // ------------------------------------------------------------------ enceintes (refaites après une brèche)
  walls() {
    const tr = this.tr, liste = (tr.walls || this.m.walls || []).filter(w => w && w.pts && w.pts.length > 1);
    const breches = liste.flatMap(w => (w.breach || []).map(b => [b[0], b[1], b[2] || 20]));
    // brèches nouvelles : on repeint autour d'elles
    const vues = this._breches || [];
    for (const b of breches) if (!vues.some(o => o[0] === b[0] && o[1] === b[1])) this.invalider([b[0] - b[2] - 60, b[1] - b[2] - 60, b[0] + b[2] + 60, b[1] + b[2] + 60]);
    this._breches = breches;
    const portes = tr.gates || this.portesDesCases();
    const E = this.enceintes = [];
    for (const w of liste) {
      if (w.kind === 'barricade') { E.push(...this.barricade(w)); continue; }
      const pts = w.pts.slice(), ferme = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 5;
      if (ferme) pts.pop();
      const C = this.ville && Math.hypot(centre(pts)[0] - this.ville.x, centre(pts)[1] - this.ville.y) < 150 ? [this.ville.x, this.ville.y] : centre(pts);
      const br = (w.breach || []).map(b => [b[0], b[1], b[2] || 20]);
      const gs = portes.filter(p => pts.some(q => Math.hypot(q[0] - p.x, q[1] - p.y) < (w.thick || 20) + 25));
      E.push(...(w.kind === 'mur' && (w.thick || 0) < 30 ? this.murMedieval(pts, C, br, gs, ferme) : this.traceBastionne(pts, C, w, br, gs)));
    }
    if (!liste.some(w => w.kind !== 'barricade')) E.push(...this.mursDesCases(portes));
    this.ranger();
  }
  portesDesCases() {
    const out = [], { cols, cell, t } = this;
    for (let c = 0; c < t.length; c++) if (t[c] === TY.PORTE) {
      const x = (c % cols + 0.5) * cell, y = (((c / cols) | 0) + 0.5) * cell;
      if (!out.some(g => Math.hypot(g.x - x, g.y - y) < 40)) out.push({ x, y });
    }
    return out;
  }
  murMedieval(pts, C, breches, portes, ferme) {
    const neige = this.neige, bb = boiteDe(pts), bbox = [bb[0] - 30, bb[1] - 30, bb[2] + 30, bb[3] + 30];
    const toit = this.contree === 'sud' ? 'canal' : 'tuile';
    const trousDe = () => { const p = new Path2D(); p.rect(bbox[0] - 50, bbox[1] - 50, bbox[2] - bbox[0] + 100, bbox[3] - bbox[1] + 100); for (const [x, y, r] of breches) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); } for (const g of portes) { p.moveTo(g.x + 7, g.y); p.arc(g.x, g.y, 7, 0, TAU); } return p; };
    const tours = [], ligneP = ferme ? pts.concat([pts[0]]) : pts, secs = [];
    // (le mur s'arrête au bord de l'eau)
    let cur = [];
    for (const p of reechant(ligneP, 4)) { const v = this.at(p[0], p[1]); if (v === TY.EAU || v === TY.GUE) { if (cur.length > 1) secs.push(cur); cur = []; } else cur.push(p); }
    if (cur.length > 1) secs.push(cur);
    let acc = 0;
    for (const p of secs.flat()) { acc += 4; if (acc >= 44 && portes.every(g => Math.hypot(g.x - p[0], g.y - p[1]) > 16) && breches.every(([x, y, r]) => Math.hypot(x - p[0], y - p[1]) > r + 4)) { acc = 0; tours.push(p); } }
    return [
      { z: 0, bbox, draw: g => {   // le fossé sec au pied du mur, dehors
        g.save(); const dehors = new Path2D(); dehors.rect(bbox[0] - 50, bbox[1] - 50, bbox[2] - bbox[0] + 100, bbox[3] - bbox[1] + 100); D.trace(dehors, pts, true); g.clip(dehors, 'evenodd');
        g.beginPath(); for (const sg of secs) D.trace(g, sg.map(p => pousse(C, p, 6))); g.lineJoin = 'round'; g.strokeStyle = neige ? '#c9d1d4' : '#6e8a4a'; g.lineWidth = 12; g.stroke(); g.restore();
      } },
      { z: 4, bbox, draw: g => {
        g.save(); g.clip(trousDe(), 'evenodd'); g.lineJoin = 'round'; g.lineCap = 'butt';
        g.beginPath(); for (const sg of secs) D.trace(g, sg.map(p => pousse(C, p, .8))); g.strokeStyle = 'rgba(20,20,10,.3)'; g.lineWidth = 4.4; g.stroke();
        g.beginPath(); for (const sg of secs) D.trace(g, sg); g.strokeStyle = '#8f876f'; g.lineWidth = 4.4; g.stroke(); g.strokeStyle = neige ? '#e8e8e4' : '#b5aa92'; g.lineWidth = 3; g.stroke();
        g.setLineDash([1.2, 1]); g.strokeStyle = '#8f876f'; g.lineWidth = .6; g.stroke(); g.setLineDash([]);
        g.restore();
        for (const [x, y] of tours) { D.C(g, 'rgba(20,20,10,.33)', x + 1.4, y + 1.9, 5.2); D.C(g, '#b5aa92', x, y, 5.2); D.coneF(g, x, y, 4.4, D.PAL[toit], 0); }
        for (const p of portes) { const a = Math.atan2(p.y - C[1], p.x - C[0]); D.bat(g, [{ t: 'c', x: 0, y: -6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'c', x: 0, y: 6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'g', x: -4, y: -3, w: 8, h: 6, p: 'ardoise', hip: 1, h2: 2.2 }], p.x, p.y, a); }
        for (const b of breches) this.talus(g, pts, C, b, 6, 10);
      } },
    ];
  }
  // place forte : escarpe au bord extérieur de la bande des cases MUR, rempart gazonné en dedans, fossé, chemin couvert
  // et glacis au dehors ; demi-lunes devant les courtines quand le tracé a des bastions (pointes du tracé)
  traceBastionne(pts0, C, w, breches, portes) {
    const neige = this.neige, th = clamp(w.thick || 30, 8, 60), bastion = w.kind === 'bastion';
    const donne = this.m.bastions && (Array.isArray(this.m.bastions[0]) ? this.m.bastions : this.m.bastions.pts || this.m.bastions.poly);
    const tr = donne && donne.length > 2 ? donne.map(p => Array.isArray(p) ? p : [p.x, p.y]) : null;
    // (le tracé donné par la carte, s'il est bien celui de cette enceinte : il passe alors par l'escarpe)
    const esc = tr && Math.hypot(centre(tr)[0] - centre(pts0)[0], centre(tr)[1] - centre(pts0)[1]) < 100 ? tr : pts0.map(p => pousse(C, p, th / 2));
    const fos = bastion ? 22 : 16, env = esc.map(p => pousse(C, p, fos + 12)), bb = boiteDe(env), bbox = [bb[0] - 45, bb[1] - 45, bb[2] + 45, bb[3] + 45];
    // pointes des bastions : maxima du rayon ; demi-lunes au milieu des courtines
    const r = esc.map(p => Math.hypot(p[0] - C[0], p[1] - C[1])), rmin = Math.min(...r), n = esc.length, pointes = [];
    for (let k = 0; k < n; k++) { let m = true; for (let d = -3; d <= 3 && m; d++) if (d && r[(k + d + n) % n] > r[k]) m = false; if (m && r[k] - rmin > 12 && !pointes.some(q => Math.abs(q - k) < 3)) pointes.push(k); }
    const ravs = [];
    if (bastion && pointes.length >= 3) for (let q = 0; q < pointes.length; q++) {
      const a = pointes[q], b = pointes[(q + 1) % pointes.length], L = Math.hypot(esc[b][0] - esc[a][0], esc[b][1] - esc[a][1]);
      let k = a, best = 1e9; for (let s = a; s !== b; s = (s + 1) % n) if (r[s] < best) { best = r[s]; k = s; }
      const M = esc[k], l = Math.hypot(M[0] - C[0], M[1] - C[1]) || 1, out = [(M[0] - C[0]) / l, (M[1] - C[1]) / l], u = [-out[1], out[0]];
      const P = (d, s) => [M[0] + out[0] * d + u[0] * s, M[1] + out[1] * d + u[1] * s];
      ravs.push({ apex: P(fos + clamp(L * 0.15, 25, 70), 0), b1: P(fos * 0.75, -clamp(L * 0.13, 20, 55)), b2: P(fos * 0.75, clamp(L * 0.13, 20, 55)), out, M });
    }
    const eau = reechant(esc.concat([esc[0]]), 40).filter(p => { const v = this.at(...pousse(C, p, fos / 2)); return v === TY.EAU || v === TY.GUE; }).length >= 3;
    const coul = neige ? { glacis: '#e8ecee', cc: '#dcd8d0', fosse: ['#9aa4a8', '#b0babe'], dl: ['#e2e6e8', '#eef0f2'], rempart: ['#c9d1d4', '#dfe4e6', '#d2d8da', '#eef0f2'] }
      : { glacis: '#93a865', cc: '#c7b98f', fosse: eau ? ['#355f97', '#4a78b4'] : ['#6f7d4a', '#7f8a55'], dl: ['#86a95f', '#9dbb72'], rempart: ['#6f9450', '#89ad61', '#7f9e57', '#a7c37b'] };
    const grand = () => { const p = new Path2D(); p.rect(bbox[0] - 99, bbox[1] - 99, bbox[2] - bbox[0] + 198, bbox[3] - bbox[1] + 198); return p; };
    const horsBreches = () => { const p = grand(); for (const [x, y, rr] of breches) { p.moveTo(x + rr, y); p.arc(x, y, rr, 0, TAU); } return p; };
    const tri = (rv, d = 0) => [rv.b1, rv.apex, rv.b2].map(p => d ? [p[0] + rv.out[0] * d, p[1] + rv.out[1] * d] : p);
    return [
      { z: 0, bbox, draw: g => {
        g.save(); const dehors = grand(); D.trace(dehors, esc, true); g.clip(dehors, 'evenodd'); g.lineJoin = 'round'; g.lineCap = 'round';
        // le glacis descend en pente douce vers la campagne ; le chemin couvert et sa palissade
        for (const [lw, c] of [[70, 'rgba(250,245,215,.08)'], [52, 'rgba(250,245,215,.09)'], [34, 'rgba(250,245,215,.1)'], [18, 'rgba(250,245,215,.12)']]) {
          g.strokeStyle = c; g.lineWidth = lw; D.ligne(g, env, true); g.stroke(); for (const rv of ravs) { D.ligne(g, tri(rv, 12), true); g.stroke(); }
        }
        g.fillStyle = coul.glacis; D.ligne(g, env, true); g.fill(); for (const rv of ravs) { D.ligne(g, tri(rv, 12), true); g.fill(); }
        g.save(); D.ligne(g, env, true); g.clip(); g.strokeStyle = coul.cc; g.lineWidth = 10; D.ligne(g, env, true); g.stroke(); g.restore();
        D.ligne(g, env, true); g.setLineDash([1, .9]); g.strokeStyle = '#5b4127'; g.lineWidth = .5; g.stroke(); g.setLineDash([]);
        // fossés : ceux des demi-lunes, puis le grand
        g.lineJoin = 'miter';
        for (const rv of ravs) { D.ligne(g, tri(rv)); g.strokeStyle = '#8f856e'; g.lineWidth = 17; g.stroke(); g.strokeStyle = coul.fosse[0]; g.lineWidth = 15; g.stroke(); }
        D.ligne(g, esc, true); g.strokeStyle = '#8f856e'; g.lineWidth = fos * 2 + 2; g.stroke(); g.strokeStyle = coul.fosse[0]; g.lineWidth = fos * 2; g.stroke(); g.strokeStyle = coul.fosse[1]; g.lineWidth = fos * 2 - 6; g.stroke();
        for (const rv of ravs) {   // demi-lunes
          D.ligne(g, tri(rv), true); g.fillStyle = coul.dl[0]; g.fill();
          const c = [(rv.b1[0] + rv.b2[0] + rv.apex[0]) / 3, (rv.b1[1] + rv.b2[1] + rv.apex[1]) / 3];
          D.ligne(g, tri(rv).map(p => [c[0] + (p[0] - c[0]) * .55, c[1] + (p[1] - c[1]) * .55]), true); g.fillStyle = coul.dl[1]; g.fill();
          D.ligne(g, tri(rv), true); g.strokeStyle = '#968c75'; g.lineWidth = 2.2; g.stroke(); g.strokeStyle = '#c2b79f'; g.lineWidth = 1.2; g.stroke();
        }
        // portes : la route passe le fossé sur un pont dormant
        for (const p of portes) {
          const l = Math.hypot(p.x - C[0], p.y - C[1]) || 1, ra = [(p.x - C[0]) / l, (p.y - C[1]) / l], ro = p.a != null ? [Math.cos(p.a), Math.sin(p.a)] : ra, sg = Math.sign(ro[0] * ra[0] + ro[1] * ra[1]) || 1, o = [ro[0] * sg, ro[1] * sg], k = esc.reduce((bk, q, i) => Math.hypot(q[0] - p.x, q[1] - p.y) < Math.hypot(esc[bk][0] - p.x, esc[bk][1] - p.y) ? i : bk, 0), q = esc[k];
          g.lineCap = 'butt'; D.T(g, '#5b4127', 7.6, q[0] - o[0] * 2, q[1] - o[1] * 2, q[0] + o[0] * (fos + 3), q[1] + o[1] * (fos + 3)); D.T(g, '#8a6a45', 6.4, q[0] - o[0] * 2, q[1] - o[1] * 2, q[0] + o[0] * (fos + 3), q[1] + o[1] * (fos + 3));
        }
        g.restore();
      } },
      { z: 4, bbox, draw: g => {
        // le corps de place : talus, terre-plein, banquette, parapet (en dedans de l'escarpe), hors des brèches
        g.save(); g.clip(horsBreches(), 'evenodd'); D.ligne(g, esc, true); g.clip(); g.lineJoin = 'round';
        for (const [lw, c] of [[th * 2, coul.rempart[0]], [th * 2 - 6, coul.rempart[1]], [14, coul.rempart[2]], [11, coul.rempart[3]]]) { D.ligne(g, esc, true); g.strokeStyle = c; g.lineWidth = lw; g.stroke(); }
        g.restore();
        g.save(); g.clip(horsBreches(), 'evenodd'); D.ligne(g, esc, true); g.strokeStyle = '#968c75'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#c2b79f'; g.lineWidth = 1.8; g.stroke(); g.restore();
        // guérites aux saillants
        for (const k of pointes) { const p = pousse(C, esc[k], -2.5); D.C(g, '#c2b79f', p[0], p[1], 2.3); D.coneF(g, p[0], p[1], 1.8, D.PAL.ardoise, 0, 0, TAU, 10); }
        for (const p of portes) { const k = esc.reduce((bk, q, i) => Math.hypot(q[0] - p.x, q[1] - p.y) < Math.hypot(esc[bk][0] - p.x, esc[bk][1] - p.y) ? i : bk, 0), q = pousse(C, esc[k], -3); D.bat(g, [{ t: 'g', x: -7, y: -7, w: 10, h: 14, hip: 1, p: 'ardoise', h2: 2.4 }], q[0], q[1], Math.atan2(q[1] - C[1], q[0] - C[0]), 0.9); }
        for (const b of breches) this.talus(g, esc, C, b, th, fos);
      } },
    ];
  }
  // brèche : le parapet abattu, un talus d'éboulis du rempart jusqu'au fond du fossé (maquette)
  talus(g, ligneP, C, [x, y, r], th, fos) {
    const l = Math.hypot(x - C[0], y - C[1]) || 1, n = [(C[0] - x) / l, (C[1] - y) / l], u = [-n[1], n[0]];
    const p = (k, d) => [x + u[0] * r * k + n[0] * d, y + u[1] * r * k + n[1] * d];
    D.PG(g, this.neige ? '#d8d4ca' : '#a3967a', [...p(-.9, th * .6), ...p(.9, th * .6), ...p(1.1, -fos), ...p(-1.1, -fos)]);
    D.PG(g, this.neige ? '#c4bfb4' : '#8a7d63', [...p(-.65, th * .3), ...p(.65, th * .3), ...p(.85, -fos * .8), ...p(-.85, -fos * .8)]);
    const R = D.alea((x * 31 + y) | 0);
    for (let i = 0; i < 46; i++) { const q = p((R() - .5) * 1.9, -fos * .9 + R() * (fos + th * .6)); D.C(g, R() < .5 ? '#c2b79f' : '#6e6556', q[0], q[1], .5 + R() * .9); }
  }
  // ouvrages de siège (moteur : barricades, tranchées, redoutes)
  barricade(w) {
    const pts = w.pts, b = boiteDe(pts), bbox = [b[0] - 8, b[1] - 8, b[2] + 8, b[3] + 8], neige = this.neige;
    const petit = b[2] - b[0] < 160 && b[3] - b[1] < 160 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 5;
    const terre = neige ? '#d8d2c8' : '#a88f66';
    if (petit) return [{ z: 1, bbox, draw: g => {   // redoute : parapet de terre, son fossé dehors
      g.lineJoin = 'miter'; D.ligne(g, pts, true); g.strokeStyle = neige ? '#bfb8ac' : '#6e5134'; g.lineWidth = 8; g.stroke(); g.strokeStyle = terre; g.lineWidth = 5; g.stroke(); g.strokeStyle = neige ? '#ece8e0' : '#c2a878'; g.lineWidth = 1.6; g.stroke();
    } }];
    const bar = this.t.includes(TY.BARRICADE), morceaux = [];
    let cur = [];
    for (const p of reechant(pts, 4)) { const v = this.at(p[0], p[1]); if (v === TY.EAU || v === TY.GUE || (bar && v !== TY.BARRICADE)) { if (cur.length > 1) morceaux.push(cur); cur = []; } else cur.push(p); }
    if (cur.length > 1) morceaux.push(cur);
    return [{ z: 1, bbox, draw: g => {
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const m of morceaux) {
        if (longueur(m) > 70) {   // tranchée : parapet de terre rejetée, gabions sur la crête
          D.ligne(g, decaler(m, -2)); g.strokeStyle = terre; g.lineWidth = 4.5; g.stroke();
          D.ligne(g, m); g.strokeStyle = neige ? '#8d8070' : '#5e4630'; g.lineWidth = 2.4; g.stroke();
          g.fillStyle = '#6b4d31'; g.beginPath(); for (const p of reechant(decaler(m, -3.2), 2.6)) { g.moveTo(p[0] + 1, p[1]); g.arc(p[0], p[1], 1, 0, TAU); } g.fill();
          g.fillStyle = '#b8955f'; g.beginPath(); for (const p of reechant(decaler(m, -3.2), 2.6)) { g.moveTo(p[0] + .6, p[1]); g.arc(p[0], p[1], .6, 0, TAU); } g.fill();
        } else {   // charrettes renversées et poutres
          D.ligne(g, m); g.strokeStyle = neige ? '#8d8070' : '#6e5134'; g.lineWidth = 1.5; g.stroke();
          for (const p of reechant(m, 3)) D.T(g, '#9a7650', .5, p[0] - .9, p[1] - .9, p[0] + .9, p[1] + .9);
        }
      }
    } }];
  }
  // sans tracé donné : le mur suit les cases MUR, PORTE et BRECHE (un trait entre deux cases voisines)
  mursDesCases(portes) {
    const { cols, rows, cell, t } = this, seg = [], tours = [], ruines = [];
    const mur = c => t[c] === TY.MUR || t[c] === TY.PORTE;
    for (let c = 0; c < t.length; c++) {
      if (!MURS.has(t[c])) continue;
      const i = c % cols, j = (c / cols) | 0, x = (i + .5) * cell, y = (j + .5) * cell;
      if (t[c] === TY.BRECHE) { ruines.push([x, y, cell * .6]); continue; }
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        const d = jj * cols + ii;
        if (mur(d) && t[c] !== TY.PORTE && t[d] !== TY.PORTE && (!(di && dj) || (!mur(j * cols + ii) && !mur(jj * cols + i)))) seg.push([x, y, (ii + .5) * cell, (jj + .5) * cell]);
      }
      if (t[c] === TY.MUR && hash(i, j, this.seed + 17) < 0.22) tours.push([x, y]);
    }
    if (!seg.length && !ruines.length) return [];
    const C = this.ville ? [this.ville.x, this.ville.y] : [this.W / 2, this.H / 2];
    return [{ z: 4, bbox: [0, 0, this.W, this.H], cases: true, draw: g => {
      g.lineCap = 'round'; g.beginPath(); for (const [a, b, c, d] of seg) { g.moveTo(a, b); g.lineTo(c, d); }
      g.strokeStyle = '#8f876f'; g.lineWidth = 4.4; g.stroke(); g.strokeStyle = this.neige ? '#e8e8e4' : '#b5aa92'; g.lineWidth = 3; g.stroke();
      for (const [x, y] of tours) { D.C(g, '#b5aa92', x, y, 5); D.coneF(g, x, y, 4.2, D.PAL.tuile, 0); }
      for (const p of portes) D.bat(g, [{ t: 'c', x: 0, y: -6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'c', x: 0, y: 6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'g', x: -4, y: -3, w: 8, h: 6, p: 'ardoise', hip: 1, h2: 2.2 }], p.x, p.y, Math.atan2(p.y - C[1], p.x - C[0]));
      for (const b of ruines) this.talus(g, [], C, b, 6, 8);
    } }];
  }

  // ------------------------------------------------------------------ rangement et tuiles
  ranger() {
    const objets = [...this.enceintes.filter(o => o.z === 0), ...this.fixes.filter(o => o.z <= 2), ...this.batiments.map(b => ({ z: 3, bbox: b.bbox, b })), ...this.enceintes.filter(o => o.z === 4)];
    objets.sort((a, b) => a.z - b.z);
    const L = this.couches.sous;
    L.objets = objets; L.seaux = Array.from({ length: this.sc * this.sr }, () => []);
    objets.forEach((o, k) => {
      if (o.cases) return;   // (le mur des cases, posé partout : dessiné à part dans chaque tuile)
      const i0 = clamp(Math.floor(o.bbox[0] / SEAU), 0, this.sc - 1), i1 = clamp(Math.floor(o.bbox[2] / SEAU), 0, this.sc - 1);
      const j0 = clamp(Math.floor(o.bbox[1] / SEAU), 0, this.sr - 1), j1 = clamp(Math.floor(o.bbox[3] / SEAU), 0, this.sr - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) L.seaux[j * this.sc + i].push(k);
    });
    L.partout = objets.map((o, k) => o.cases ? k : -1).filter(k => k >= 0);
  }
  couche() { return { cache: new Map(), objets: [], seaux: [], partout: [] }; }
  occupe(nom, x0, y0, S) {
    const i0 = clamp(Math.floor(x0 / SEAU), 0, this.sc - 1), i1 = clamp(Math.floor((x0 + S - 0.01) / SEAU), 0, this.sc - 1);
    const j0 = clamp(Math.floor(y0 / SEAU), 0, this.sr - 1), j1 = clamp(Math.floor((y0 + S - 0.01) / SEAU), 0, this.sr - 1);
    if (x0 >= this.W || y0 >= this.H || x0 + S <= 0 || y0 + S <= 0) return false;
    if (nom === 'sous' && this.couches.sous.partout.length) return true;
    const s = nom === 'sous' ? this.couches.sous.seaux : this.arbresSeau, m = nom === 'canopee' ? 1 : 0;
    for (let j = Math.max(0, j0 - m); j <= Math.min(this.sr - 1, j1 + m); j++) for (let i = Math.max(0, i0 - m); i <= Math.min(this.sc - 1, i1 + m); i++) if (s[j * this.sc + i].length) return true;
    return false;
  }
  // peint le rectangle r (m) de la tuile tl
  peindre(nom, tl, r) {
    const g = tl.cv.getContext('2d'), L = tl.L;
    D.neige(this.neige);
    g.setTransform(L, 0, 0, L, -tl.x0 * L, -tl.y0 * L);
    g.save(); g.beginPath(); g.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]); g.clip(); g.clearRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    if (nom === 'sous') {
      const C = this.couches.sous, vus = new Set(C.partout);
      const i0 = clamp(Math.floor(r[0] / SEAU), 0, this.sc - 1), i1 = clamp(Math.floor(r[2] / SEAU), 0, this.sc - 1), j0 = clamp(Math.floor(r[1] / SEAU), 0, this.sr - 1), j1 = clamp(Math.floor(r[3] / SEAU), 0, this.sr - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const k of C.seaux[j * this.sc + i]) if (coupe(C.objets[k].bbox, r)) vus.add(k);
      for (const k of [...vus].sort((a, b) => a - b)) { const o = C.objets[k]; if (o.b) this.dessiner(g, o.b); else o.draw(g); }
    } else {
      const liste = [], m = 12;
      const i0 = clamp(Math.floor((r[0] - m) / SEAU), 0, this.sc - 1), i1 = clamp(Math.floor((r[2] + m) / SEAU), 0, this.sc - 1), j0 = clamp(Math.floor((r[1] - m) / SEAU), 0, this.sr - 1), j1 = clamp(Math.floor((r[3] + m) / SEAU), 0, this.sr - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const a of this.arbresSeau[j * this.sc + i]) if (a[0] + a[2] + 4 > r[0] && a[0] - a[2] < r[2] && a[1] + a[2] + 4 > r[1] && a[1] - a[2] < r[3]) liste.push(a);
      D.arbres(g, liste);
    }
    g.restore();
  }
  tuile(nom, L, i, j) {
    const C = this.couches[nom], cle = L + ':' + i + ':' + j;
    let tl = C.cache.get(cle);
    if (tl) { C.cache.delete(cle); C.cache.set(cle, tl); return tl; }   // (récente : en fin de liste)
    const S = TPX / L;
    if (!this.occupe(nom, i * S, j * S, S)) return null;
    tl = { cv: null, L, S, x0: i * S, y0: j * S, sale: null, neuve: true };
    C.cache.set(cle, tl);
    // mémoire bornée selon la qualité : les plus anciennes s'en vont (jamais la vue d'ensemble)
    const max = Math.max([10, 16, 26, 40][this.q.fx ?? 2] ?? 26, (this.visibles || 0) + 6);
    if (C.cache.size > max) for (const [k, o] of C.cache) { if (C.cache.size <= max) break; if (o.L !== VUE && o !== tl) { if (o.cv) o.cv.width = o.cv.height = 0; C.cache.delete(k); } }
    return tl;
  }
  peindreVue(C, nom) {
    const S = TPX / VUE;
    for (let j = 0; j * S < this.H; j++) for (let i = 0; i * S < this.W; i++) { const tl = this.tuile(nom, VUE, i, j); if (tl) this.finir(nom, tl); }
  }
  finir(nom, tl) {
    if (tl.neuve) { tl.cv = this.mk(TPX, TPX); tl.neuve = false; this.peindre(nom, tl, [tl.x0, tl.y0, tl.x0 + tl.S, tl.y0 + tl.S]); }
    if (tl.sale) { const s = tl.sale; tl.sale = null; this.peindre(nom, tl, s.reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])])); }
  }
  invalider(r) {
    for (const C of [this.couches.sous]) for (const tl of C.cache.values()) {
      if (!coupe(r, [tl.x0, tl.y0, tl.x0 + tl.S, tl.y0 + tl.S])) continue;
      (tl.sale = tl.sale || []).push(r);
    }
  }
  // pose les tuiles d'une couche sur g (pixels de l'écran) ; au plus quelques millisecondes de peinture par image : ce
  // qui n'est pas prêt est pris dans la vue d'ensemble
  poser(g, view, nom, budget) {
    const z = view.z, dpr = view.dpr || 1, need = z * dpr, maxL = Math.max(this.q.level ?? 16, 4) * 2;
    // la finesse la plus proche de celle de l'écran (en rapport), et pas plus fine que la qualité ne le permet
    let L = NIVEAUX.reduce((a, l) => Math.abs(Math.log(l / need)) < Math.abs(Math.log(a / need)) - 1e-9 ? l : a, NIVEAUX[0]); L = Math.min(L, maxL);
    const S = TPX / L, vw = view.vw, vh = view.vh, cx = view.cam.x, cy = view.cam.y;
    const x0 = cx - vw / 2 / z, y0 = cy - vh / 2 / z, x1 = cx + vw / 2 / z, y1 = cy + vh / 2 / z;
    const px = x => Math.round(dpr * (vw / 2 + (x - cx) * z)), py = y => Math.round(dpr * (vh / 2 + (y - cy) * z));
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true;
    const C = this.couches[nom], iL = NIVEAUX.indexOf(L), Lm = iL >= 3 ? NIVEAUX[iL - 2] : 0, Sm = TPX / Lm;
    this.visibles = (Math.ceil((x1 - x0) / S) + 1) * (Math.ceil((y1 - y0) / S) + 1) + (Lm ? (Math.ceil((x1 - x0) / Sm) + 1) * (Math.ceil((y1 - y0) / Sm) + 1) : 0);
    // de près, les tuiles quatre fois moins fines d'abord (peu nombreuses) : en attendant les fines, l'image reste nette
    if (Lm) for (let j = Math.max(0, Math.floor(y0 / Sm)); j * Sm < Math.min(y1, this.H); j++) for (let i = Math.max(0, Math.floor(x0 / Sm)); i * Sm < Math.min(x1, this.W); i++) {
      const tl = this.tuile(nom, Lm, i, j);
      if (tl && (tl.neuve || tl.sale) && performance.now() < budget.fin) this.finir(nom, tl);
    }
    for (let j = Math.max(0, Math.floor(y0 / S)); j * S < Math.min(y1, this.H); j++) for (let i = Math.max(0, Math.floor(x0 / S)); i * S < Math.min(x1, this.W); i++) {
      const tl = this.tuile(nom, L, i, j);
      if (!tl) continue;
      if ((tl.neuve || tl.sale) && (L === VUE || performance.now() < budget.fin)) this.finir(nom, tl);
      const dx = px(i * S), dy = py(j * S), dw = px((i + 1) * S) - dx, dh = py((j + 1) * S) - dy;
      if (tl.cv && !tl.neuve) { g.drawImage(tl.cv, dx, dy, dw, dh); continue; }
      // pas encore peinte : la même place dans une tuile moins fine déjà prête
      for (let k = NIVEAUX.indexOf(L) - 1; k >= 0; k--) {
        const l = NIVEAUX[k], s2 = TPX / l, v = C.cache.get(l + ':' + Math.floor(i * S / s2) + ':' + Math.floor(j * S / s2));
        if (v && v.cv && !v.neuve) { g.drawImage(v.cv, (i * S - v.x0) * l, (j * S - v.y0) * l, S * l, S * l, dx, dy, dw, dh); break; }
      }
    }
  }

  // ------------------------------------------------------------------ dessin de chaque image
  sous(ctx, view) {
    this.vue = view;
    const budget = { fin: performance.now() + (view.q?.fx ?? this.q.fx ?? 2) * 2 + 3 };
    this._budget = budget;
    this.poser(ctx, view, 'sous', budget);
    // la vie des champs
    view.monde(ctx);
    const s = D.ECH_VIE;
    for (const e of this.vie) {
      if ((e.alpha ?? 1) <= 0 || !view.visible(e.x, e.y, 20)) continue;
      ctx.globalAlpha = e.alpha ?? 1;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.a || 0); ctx.scale(s, s); D.bete(ctx, e, this.time); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  dessus(ctx, view, units) {
    if (units && !Array.isArray(units)) units = [...units];
    this.vue = view; this._units = units;
    const budget = this._budget && this._budget.fin > performance.now() ? this._budget : { fin: performance.now() + 3 };
    const trous = this.clairieres(units).filter(([x, y, , hd, hw]) => view.visible(x, y, hd + hw));
    let g = ctx;
    if (trous.length) {
      const w = Math.round(view.vw * (view.dpr || 1)), h = Math.round(view.vh * (view.dpr || 1));
      if (!this.tmp || this.tmp.width !== w || this.tmp.height !== h) { if (this.tmp) this.tmp.width = 0; this.tmp = this.mk(w, h); }
      g = this.tmp.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h);
    }
    this.poser(g, view, 'canopee', budget);
    if (trous.length) {
      // le feuillage s'ouvre au-dessus des hommes : trois rectangles arrondis de plus en plus grands, de moins en moins
      // effacés (un bord doux, quelques feuilles restent au milieu)
      view.monde(g); g.globalCompositeOperation = 'destination-out';
      for (const [x, y, a, hd, hw] of trous) {
        g.save(); g.translate(x, y); g.rotate(a);
        for (const [m, al] of [[7, .3], [3.5, .5], [0, .85]]) { g.globalAlpha = al; D.RR(g, '#fff', -hd - m, -hw - m, 2 * (hd + m), 2 * (hw + m), 3 + m); }
        g.restore();
      }
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.tmp, 0, 0);
    }
    view.monde(ctx);
    const t = this.time;
    // fumées : cheminées, incendies, ruines qui couvent
    for (const p of this.fumees) {
      if (p.k === 'm') continue;
      const k = p.age / p.life, r = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
      ctx.globalAlpha = p.al * Math.min(1, p.age * 3) * (1 - k);
      ctx.drawImage(this.spr[p.spr], p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    // flammes (lueur et langues de feu, en lumière ajoutée)
    ctx.globalCompositeOperation = 'lighter';
    for (const [b, f] of this.feux) {
      if (f.I <= 0.01 || !view.visible(b.x, b.y, b.r + 20)) continue;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.scale(b.s, b.s);
      const W = (b.boite[2] - b.boite[0]) * 1.3, cx = (b.boite[0] + b.boite[2]) / 2, cy = (b.boite[1] + b.boite[3]) / 2;
      ctx.globalAlpha = .35 * f.I; ctx.drawImage(this.spr.lueur, cx - W, cy - W, W * 2, W * 2);
      ctx.globalAlpha = .9;
      for (const [x, y, s, k] of b.foyers) { const r = (3.6 + 1.8 * Math.sin(t * 11 + s) + .8 * Math.sin(t * 23 + s * 2)) * f.I * k; if (r > .2) ctx.drawImage(this.spr.fl, x - r, y - r * 1.25, r * 2, r * 2.5); }
      ctx.restore();
    }
    // braises des ruines
    for (const b of this.batiments) {
      if (b.braise <= 0 || b.etat !== 3 || !view.visible(b.x, b.y, b.r)) continue;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.scale(b.s, b.s);
      for (let i = 0; i < Math.min(6, b.foyers.length); i++) { ctx.globalAlpha = b.braise * (.5 + .5 * Math.sin(t * 4 + i * 2)); D.C(ctx, '#ff8a2a', b.foyers[i][0] * .8, b.foyers[i][1] * .8, .6); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const p of this.fumees) if (p.k === 'm') { ctx.globalAlpha = clamp(1 - p.age / p.life, 0, 1); D.C(ctx, '#ffb04a', p.x, p.y, .35); }
    ctx.globalCompositeOperation = 'source-over';
    // ailes des moulins
    for (const b of this.batiments) {
      if (!b.ailes || b.etat >= 2 || !view.visible(b.x, b.y, 14)) continue;
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.s, b.s); D.ailes(ctx, t * .9 + (b.seed % 7)); ctx.restore();
    }
  }

  // ------------------------------------------------------------------ animation : feu, fumées, vie
  update(dt, vent = null) {
    dt = Math.min(dt || 0, 0.25);
    this.time += dt;
    const w = vent ? [vent[0] ?? vent.x ?? 0, vent[1] ?? vent.y ?? 0] : VENT, fx = this.q.fx ?? 2;
    const max = Math.min(160, (this.q.puffs ?? 2000) / 12), P = this.fumees, rnd = Math.random;
    const fumee = (x, y, r0, r1, life, al, spr) => { if (P.length < max) P.push({ k: 'f', spr, x, y, vx: (rnd() - .5) * .6, vy: (rnd() - .5) * .6, r0, r1, life, age: 0, al }); };
    const vis = this.vue ? (x, y, m) => this.vue.visible(x, y, m) : () => true;
    for (const [b, f] of this.feux) {
      f.t += dt;
      f.I = f.fin ? Math.max(0, f.I - dt / 3) : Math.min(1, f.t / 4);
      if (f.fin && f.I <= 0) { this.feux.delete(b); continue; }
      if (!vis(b.x, b.y, 120)) continue;
      const fo = () => { const [lx, ly] = b.foyers[(rnd() * b.foyers.length) | 0] || [0, 0], ca = Math.cos(b.a), sa = Math.sin(b.a); return [b.x + (lx * ca - ly * sa) * b.s, b.y + (lx * sa + ly * ca) * b.s]; };
      // colonne de fumée noire ; braises qui s'envolent
      if (rnd() < dt * 1.6 * f.I) { const [x, y] = fo(); fumee(x, y, 2, 7 + rnd() * 6, 7 + rnd() * 4, .48, 'n'); }
      if (rnd() < dt * 10 * f.I && P.length < max) { const [x, y] = fo(); P.push({ k: 'm', x, y, vx: (rnd() - .5) * 4, vy: (rnd() - .5) * 4, life: 1.4 + rnd(), age: 0 }); }
    }
    // (les cheminées ne fument que vues d'assez près pour qu'on le voie)
    const proche = fx >= 1 && this.vue && this.vue.z >= 1.2 && P.filter(p => p.al < .3).length < 40;
    for (const b of this.batiments) {
      if (b.etat === 3 && b.braise > 0) { b.braise = Math.max(0, b.braise - dt / 80); if (rnd() < dt * 1.2 * b.braise && vis(b.x, b.y, 60)) fumee(b.x, b.y, 1.5, 6.5, 6, .32, 'n'); }
      else if (proche && b.etat === 0 && b.chem.length && (b.seed & 3) === 0 && rnd() < dt * .25 && vis(b.x, b.y, 30)) { const [x, y] = b.chem[(rnd() * b.chem.length) | 0]; fumee(x, y, .3, 2.6, 4, .26, 'f'); }   // la cheminée fume
    }
    for (let k = P.length - 1; k >= 0; k--) {
      const p = P[k]; p.age += dt;
      if (p.age >= p.life) { P[k] = P[P.length - 1]; P.pop(); continue; }
      const dr = p.k === 'm' ? 1 : .6 + .4 * (p.age / p.life);   // la fumée prend le vent en montant
      p.x += (p.vx + w[0] * dr) * dt; p.y += (p.vy + w[1] * dr) * dt;
    }
    this.vivre(dt);
  }
  // les bêtes et les gens : placés une fois (selon la graine), puis ils paissent, suivent, fuient
  peupler() {
    const V = this.vie = [], fx = this.q.fx ?? 2, { cols, rows, cell, t } = this, S = this.seed;
    if (fx < 0) return;
    const v = this.ville, R = D.alea(S * 7 + 3);
    const pre = v2 => v2 === TY.PRE || v2 === TY.VERGER, landes = v2 => v2 === TY.LANDE;
    const loin = (x, y) => !v || Math.hypot(x - v.x, y - v.y) > v.r + 120;
    const sites = (ok, n, ecart) => {
      const out = [];
      for (let k = 0; k < 4000 && out.length < n; k++) {
        const i = 2 + ((R() * (cols - 4)) | 0), j = 2 + ((R() * (rows - 4)) | 0), x = (i + .5) * cell, y = (j + .5) * cell;
        let bon = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (ok(t[(j + dj) * cols + i + di])) bon++;
        if (bon >= 8 && loin(x, y) && out.every(([a, b]) => Math.hypot(a - x, b - y) > ecart)) out.push([x, y]);
      }
      return out;
    };
    const peu = [1, 2, 3, 4][fx] ?? 3;
    for (const [x, y] of sites(pre, peu, 300)) {
      const zone = [x - 32, y - 26, 64, 52];
      for (let i = 0, n = 4 + ((R() * 4) | 0); i < n; i++) V.push({ k: 'vache', x: x + (R() - .5) * 40, y: y + (R() - .5) * 30, a: R() * TAU, v: 0, zone, attente: R() * 5, robe: R() < .5 ? '#efe9dd' : '#c9a07a', tache: R() < .5 ? '#3a2c22' : '#8a5a3a', pas: 0 });
    }
    const [tp] = sites(landes, 1, 0).concat(sites(pre, 1, 0).filter(([x, y]) => V.every(e => Math.hypot(e.x - x, e.y - y) > 200)));
    if (tp && fx >= 1) {
      const berger = { k: 'berger', x: tp[0], y: tp[1], a: 0, v: 0, zone: [tp[0] - 40, tp[1] - 30, 80, 60], attente: 0, pas: 0 };
      V.push(berger);
      for (let i = 0; i < 8 + fx * 3; i++) V.push({ k: 'mouton', x: tp[0] + (R() - .5) * 20, y: tp[1] + (R() - .5) * 16, a: R() * TAU, v: 0, chef: berger, ox: (R() - .5) * 18, oy: (R() - .5) * 13, pas: 0 });
      V.push({ k: 'chien', chef: berger, ang: 0, x: tp[0], y: tp[1], a: 0, pas: 0 });
    }
    // poules devant les fermes ; canards sur l'eau la plus proche d'une ferme
    const fermes = this.batiments.filter(b => b.kind === 'ferme' && b.cle !== 'grange').slice(0, fx >= 2 ? 4 : fx);
    for (const b of fermes) for (let i = 0; i < 5; i++) { const x0 = b.x + (R() - .5) * 10, y0 = b.y + b.r * .6 + 4; V.push({ k: 'poule', x0, y0, x: x0, y: y0, a: R() * TAU, couleur: R() < .5 ? '#f3efe6' : '#a0643a' }); }
    if (fx >= 2) for (const b of fermes.slice(0, 2)) {
      let best = null, bd = 260;
      for (let dj = -12; dj <= 12; dj++) for (let di = -12; di <= 12; di++) { const c = this.caseDe(b.x + di * cell, b.y + dj * cell); if (c >= 0 && t[c] === TY.EAU) { const d = Math.hypot(di, dj) * cell; if (d < bd) { bd = d; best = c; } } }
      if (best != null) for (let i = 0; i < 4; i++) V.push({ k: 'canard', cx: (best % cols + .5) * cell, cy: (((best / cols) | 0) + .5) * cell, ang: R() * TAU, rr: 1.5 + R() * 3, x: 0, y: 0, a: 0 });
    }
    // charrettes à bœufs sur les routes
    const routes = (this.tr.roadPts || this.m.roads || []).filter(r => r && r.length > 1 && longueur(r) > 400).sort((a, b) => longueur(b) - longueur(a));
    for (const r of routes.slice(0, fx >= 2 ? 2 : fx >= 1 ? 1 : 0)) { const L = longueur(r); V.push({ k: 'charrette', pts: r, L, s: R() * L, sens: R() < .5 ? 1 : -1, lat: 2.2, x: 0, y: 0, a: 0, pas: 0, v: 1 }); }
    this.maxCivils = [6, 14, 24, 36][fx] ?? 24;
  }
  // un boulet tombe en (x, y) : les bêtes s'enfuient, les villageois quittent les maisons voisines
  fuir(x, y) {
    for (const e of this.vie) {
      if ((e.k === 'vache' || e.k === 'mouton' || e.k === 'berger' || e.k === 'chien') && Math.hypot(e.x - x, e.y - y) < 110) { e.peur = 3 + Math.random() * 2.5; e.fx = x; e.fy = y; }
    }
    const civils = this.vie.filter(e => e.k === 'civil').length;
    if (civils >= this.maxCivils) return;
    const pres = this.batiments.filter(b => b.etat < 2 && b.kind !== 'eglise' && Math.hypot(b.x - x, b.y - y) < 150 && Math.hypot(b.x - x, b.y - y) > 12);
    for (let k = 0; k < Math.min(3, this.maxCivils - civils) && pres.length; k++) {
      const b = pres[(Math.random() * pres.length) | 0], a = Math.atan2(b.y - y, b.x - x) + (Math.random() - .5) * .8;
      this.vie.push({ k: 'civil', x: b.x + Math.cos(a) * 6, y: b.y + Math.sin(a) * 6, a, cap: a, v: 2.6 + Math.random() * 1.6, vie: 26 + Math.random() * 10, pas: Math.random(), alpha: 0,
        habit: ['#7a6a4f', '#5d6b86', '#8a5a44', '#6e5c45', '#4f5a6a'][(Math.random() * 5) | 0], tete: Math.random() < .5 ? 'coiffe' : 'rond' });
    }
  }
  vivre(dt) {
    const V = this.vie, libre = (x, y) => x > 2 && y > 2 && x < this.W - 2 && y < this.H - 2 && !BLOQUE.has(this.at(x, y));
    // les bêtes s'écartent aussi des troupes (deux fois par seconde)
    this._tTroupes = (this._tTroupes || 0) - dt;
    if (this._tTroupes <= 0 && this._units) {
      this._tTroupes = 0.5;
      for (const e of V) if (e.k === 'vache' || e.k === 'mouton' || e.k === 'berger') for (const u of this._units) {
        if (!u || u._ghost) continue;
        const R = Math.max(u.w || 0, u.d || 0) / 2 + 35;
        if (Math.abs(u.x - e.x) < R && Math.abs(u.y - e.y) < R) { e.peur = Math.max(e.peur || 0, 2); e.fx = u.x; e.fy = u.y; break; }
      }
    }
    for (let k = V.length - 1; k >= 0; k--) {
      const e = V[k];
      switch (e.k) {
        case 'vache': case 'berger': {
          if (e.peur > 0) { e.peur -= dt; e.a = angLerp(e.a, Math.atan2(e.y - e.fy, e.x - e.fx), dt * 6); e.v = e.k === 'vache' ? 4.5 : 2.5; }
          else if (e.attente > 0) { e.attente -= dt; e.v = 0; }
          else {
            if (!e.but || Math.hypot(e.but[0] - e.x, e.but[1] - e.y) < 1.5) { e.but = [e.zone[0] + 5 + Math.random() * (e.zone[2] - 10), e.zone[1] + 5 + Math.random() * (e.zone[3] - 10)]; e.attente = 2 + Math.random() * 7; }
            e.a = angLerp(e.a, Math.atan2(e.but[1] - e.y, e.but[0] - e.x), dt * 2); e.v = e.k === 'vache' ? .6 : .9;
          }
          const nx = e.x + Math.cos(e.a) * e.v * dt, ny = e.y + Math.sin(e.a) * e.v * dt;
          if (libre(nx, ny)) { e.x = nx; e.y = ny; } else { e.a += 1.2; e.but = null; }
          if (!(e.peur > 0)) { e.x = clamp(e.x, e.zone[0] - 60, e.zone[0] + e.zone[2] + 60); e.y = clamp(e.y, e.zone[1] - 60, e.zone[1] + e.zone[3] + 60); }
          if (e.peur <= 0 && Math.hypot(e.x - (e.zone[0] + e.zone[2] / 2), e.y - (e.zone[1] + e.zone[3] / 2)) > 50) { e.zone = [e.x - e.zone[2] / 2, e.y - e.zone[3] / 2, e.zone[2], e.zone[3]]; }   // le troupeau paît là où il s'est arrêté
          e.pas += dt * e.v * .9; break;
        }
        case 'mouton': {
          const tx = e.chef.x + e.ox, ty = e.chef.y + e.oy, d = Math.hypot(tx - e.x, ty - e.y);
          if (e.peur > 0) { e.peur -= dt; e.a = angLerp(e.a, Math.atan2(e.y - e.fy, e.x - e.fx), dt * 8); e.v = 4; }
          else if (d > 1.2) { e.a = angLerp(e.a, Math.atan2(ty - e.y, tx - e.x), dt * 3); e.v = Math.min(d > 10 ? 3.5 : 1.2, d); }
          else e.v = 0;
          const nx = e.x + Math.cos(e.a) * e.v * dt, ny = e.y + Math.sin(e.a) * e.v * dt;
          if (libre(nx, ny)) { e.x = nx; e.y = ny; } else e.a += 1.2;
          e.pas += dt * e.v * 1.2; break;
        }
        case 'chien': e.ang += dt * .9; e.x = e.chef.x + Math.cos(e.ang) * 14; e.y = e.chef.y + Math.sin(e.ang) * 10; e.a = e.ang + Math.PI / 2; e.pas += dt * 3; e.v = 2; break;
        case 'poule': if (!e.tx || Math.random() < dt * .8) { e.tx = e.x0 + (Math.random() - .5) * 6; e.ty = e.y0 + (Math.random() - .5) * 3; }
          e.a = Math.atan2(e.ty - e.y, e.tx - e.x); { const d = Math.hypot(e.tx - e.x, e.ty - e.y); if (d > .15) { e.x += Math.cos(e.a) * Math.min(d, 2 * dt); e.y += Math.sin(e.a) * Math.min(d, 2 * dt); } } break;
        case 'canard': e.ang += dt * .15; e.x = e.cx + Math.cos(e.ang) * e.rr; e.y = e.cy + Math.sin(e.ang) * e.rr * .6; e.a = e.ang + Math.PI / 2; break;
        case 'charrette': {
          e.s += e.sens * dt * 1.1;
          if (e.s < 0 || e.s > e.L) { e.sens = -e.sens; e.s = clamp(e.s, 0, e.L); }
          const [x, y, a0] = surChemin(e.pts, e.s), a = a0 + (e.sens < 0 ? Math.PI : 0);
          e.x = x - Math.sin(a) * e.lat; e.y = y + Math.cos(a) * e.lat; e.a = a; e.pas += dt * .5; break;
        }
        case 'civil': {   // villageois qui fuient : droit devant, en contournant ce qui barre le chemin
          e.vie -= dt; e.age = (e.age || 0) + dt; e.alpha = clamp(Math.min(e.vie / 4, e.age * 2, 1), 0, 1);
          if (e.vie <= 0) { V.splice(k, 1); break; }
          e.a = angLerp(e.a, e.cap + Math.sin(this.time * .7 + e.pas * 9) * .3, dt * 2);
          const nx = e.x + Math.cos(e.a) * e.v * dt, ny = e.y + Math.sin(e.a) * e.v * dt;
          if (libre(nx, ny) || this.at(nx, ny) === BATI) { e.x = nx; e.y = ny; } else e.cap += (Math.random() < .5 ? 1 : -1) * .9;
          e.pas += dt * 1.6; break;
        }
      }
    }
  }
  // nouvelle qualité : les bois sont plus ou moins éclaircis, les tuiles repeintes (le feu et la vie continuent)
  setQuality(q) {
    const avant = this.q.fx ?? 2; this.q = q || {};
    if ((this.q.fx ?? 2) === avant) return;
    this.liberer(); this.preparerArbres(); this.ranger();
    for (const k of ['sous', 'canopee']) this.peindreVue(this.couches[k], k);
  }
  liberer() {
    for (const C of Object.values(this.couches)) { for (const tl of C.cache.values()) if (tl.cv) tl.cv.width = tl.cv.height = 0; C.cache.clear(); }
    if (this.tmp) { this.tmp.width = this.tmp.height = 0; this.tmp = null; }
  }
  dispose() { this.liberer(); this.fumees.length = 0; this.feux.clear(); this.vie.length = 0; }
}
