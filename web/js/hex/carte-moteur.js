// La carte du jeu (cases de 1 km : map.terrain, map.dept, map.rivers…) mise au format de carte du moteur commun
// web_engine (graphismes/rendu/plateau.js, celui du serveur de web_royaumes : l, h, terrain, riviere, fertile, arbres,
// foret, rivieres…). Sans three.js : testé par tests/hex.test.mjs.
//
// Le moteur est fait pour des cartes de quelques milliers de cases, toutes bâties d'un coup (décor par case). La France
// d'un coup, le décor (arbres, parcelles) coûte cher : le plateau ne bâtit qu'une fenêtre autour de la caméra. La
// géographie doit rester lisible de loin (côtes, fleuves, pays) : les hexagones gardent donc la taille des anciennes
// versions du jeu (4 cases d'un bord plat à l'autre) aussi longtemps que possible ; de loin c'est le décor qui s'allège
// (NIVEAUX : un arbre par hexagone de forêt, pas de parcelles, les massifs restent), et les hexagones ne grossissent
// qu'en dernier (l'Europe entière : 8 cases).
import { Grille, SQ3, bruit } from './grille.js';

// du plus fin au plus large : taille des hexagones, décor allégé ?, cases bâties au plus par le moteur
export const NIVEAUX = [{ pas: 4, leger: false, max: 1500 }, { pas: 4, leger: true, max: 12000 }, { pas: 8, leger: true, max: 12000 }, { pas: 16, leger: true, max: 12000 }];
const MARGE = 1.5;            // la fenêtre couvre l'écran × MARGE : on peut glisser un peu sans rebâtir
// terrains du jeu (map.js, T) → terrains du moteur : 0 mer, 1 haut-fond, 2 lac, 3 sable, 4 plaine, 5 colline, 6 montagne
const T = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
const VERS = [0, 2, 4, 4, 4, 4, 5, 6, 6, 3, 4];
// rivières montrées selon la taille des hexagones (rang 1 : les fleuves)
const RANG_MAX = { 4: 3, 8: 3, 16: 2 };

// l'hexagone (indice ligne × colonnes + colonne) sous un point du jeu, ou −1 hors de la grille
export function indexEn(g, x, y) {
  const px = x / g.f, pz = y / g.f, q = (SQ3 / 3 * px - pz / 3) / g.R, r = (2 / 3 * pz) / g.R, s = -q - r;
  let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  const col = rq + (rr - (rr & 1)) / 2;
  return col < 0 || rr < 0 || col >= g.cols || rr >= g.rows ? -1 : rr * g.cols + col;
}

// Un niveau de détail : toute la carte du jeu en hexagones de `pas` km, au vocabulaire du moteur.
// mp : { W, H, terrain, playable, m: { rivers } } (la carte de map.js)
export class Niveau {
  constructor(mp, pas, leger = false) {
    const g = this.g = new Grille(mp.W, mp.H, pas), n = g.liste.length, W = mp.W, H = mp.H;
    this.pas = pas; this.leger = leger; this.u = pas / SQ3;   // u : km par unité du moteur (rayon d'un hexagone = 1)
    const cnt = new Uint16Array(n * 11), jeu = new Uint16Array(n), terre = new Uint16Array(n);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const h = indexEn(g, i + 0.5, j + 0.5); if (h < 0) continue;
      const c = j * W + i, k = mp.terrain[c];
      cnt[h * 11 + k]++;
      if (k > T.EAU) { terre[h]++; jeu[h] += mp.playable[c] ? 1 : 0; }
    }
    const ter = this.terrain = new Uint8Array(n), arbres = this.arbres = new Uint8Array(n), foret = this.foret = new Uint8Array(n);
    const fertile = this.fertile = new Uint8Array(n); this.jeu = new Uint8Array(n); this.riviere = new Uint8Array(n);
    for (let h = 0; h < n; h++) {
      let b = 0, bv = -1, tot = 0;
      for (let k = 0; k < 11; k++) { const v = cnt[h * 11 + k]; tot += v; if (v > bv) { bv = v; b = k; } }
      if (!tot) b = T.OCEAN;   // (hors de la carte : la mer)
      const t = g.liste[h], bois = tot ? (cnt[h * 11 + T.FORET] + cnt[h * 11 + T.LANDE] * 0.5) / tot : 0;
      ter[h] = VERS[b];
      this.jeu[h] = terre[h] > 0 && jeu[h] * 2 >= terre[h] ? 1 : 0;
      if (ter[h] < 3) continue;
      fertile[h] = b === T.PLAINE || b === T.VIGNE ? 1 : 0;
      foret[h] = b === T.FORET || bois > 0.6 ? 1 : 0;
      // arbres comptés par le moteur (0 à 6 par case) : la part des bois, et quelques arbres épars dans les prés
      arbres[h] = b === T.FORET ? 6 : b === T.LANDE ? 3 : Math.min(6, Math.round(bois * 6 + (bruit(t.col * 0.4, t.row * 0.4, 9) > 0.7 ? 1 : 0)));
      if (b === T.MARAIS) arbres[h] = Math.max(arbres[h], 1);
      if (leger) arbres[h] = foret[h];   // (de loin, un arbre par hexagone de forêt : ce sont eux qui coûtent)
    }
    // la côte : la mer au bord des terres devient haut-fond (le sable sous l'eau translucide)
    for (let h = 0; h < n; h++) if (ter[h] === 0 && g.voisins(g.liste[h]).some(v => ter[v.i] >= 3)) ter[h] = 1;
    // les rivières : chaînes d'hexagones voisins, d'amont en aval ; les vallées qu'elles traversent sont mises à plat
    this.rivieres = [];
    const rmax = RANG_MAX[pas] ?? 1;
    for (const rv of mp.m.rivers || []) {
      if (rv.rank > rmax) continue;
      const ch = [];
      for (let a = 0; a < rv.pts.length - 1; a++) {
        const [ax, ay] = rv.pts[a], [bx, by] = rv.pts[a + 1], nb = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (pas / 4)));
        for (let s = a ? 1 : 0; s <= nb; s++) {
          const h = indexEn(g, ax + (bx - ax) * s / nb, ay + (by - ay) * s / nb);
          if (h >= 0 && h !== ch[ch.length - 1]) ch.push(h);
        }
      }
      for (const h of ch) if (ter[h] >= 3) { this.riviere[h] = 1; fertile[h] = 0; if (ter[h] === 6) ter[h] = rv.rank < 3 ? 4 : 5; }
      if (ch.length > 1) this.rivieres.push(ch);
    }
  }
  estEau(h) { return this.terrain[h] < 3; }
}

// Le niveau de détail pour un écran de vw × vh px à z px par case (vue aplatie de k sur la verticale) sur une carte de
// W × H cases : le plus fin dont la fenêtre tient dans son maximum de cases. Rend { niv, pas, leger, l, h } (rang dans
// NIVEAUX, colonnes et lignes de la fenêtre).
export function choisirPas(vw, vh, z, k, W = Infinity, H = Infinity) {
  for (let niv = 0; niv < NIVEAUX.length; niv++) {
    const { pas, leger, max } = NIVEAUX[niv], d = dims(pas, vw, vh, z, k);
    d.l = Math.min(d.l, Math.floor(W / pas) + 1); d.h = Math.min(d.h, Math.floor(H / (1.5 * pas / SQ3)) + 1);
    if (d.l * d.h <= max || niv === NIVEAUX.length - 1) return { niv, pas, leger, ...d };
  }
}
function dims(pas, vw, vh, z, k) {
  const u = pas / SQ3;
  return { l: Math.max(12, Math.ceil(MARGE * vw / z / pas) + 2), h: Math.max(12, Math.ceil(MARGE * vh / (z * k) / (1.5 * u)) + 2) };
}

// La fenêtre de l colonnes × h lignes centrée sur (cx, cy) km, dans la grille du niveau N : première colonne c0, première
// ligne r0 (paire : le décalage des lignes impaires reste celui de la grille entière), et son emprise en km.
export function cadrer(N, cx, cy, l, h) {
  const g = N.g, u = N.u;
  l = Math.min(l, g.cols); h = Math.min(h, g.rows);
  const c0 = Math.max(0, Math.min(g.cols - l, Math.round(cx / N.pas - l / 2)));
  let r0 = Math.max(0, Math.min(g.rows - h, Math.round(cy / (1.5 * u) - h / 2)));
  r0 -= r0 & 1;
  return { pas: N.pas, u, c0, r0, l, h, ox: SQ3 * c0, oz: 1.5 * r0,
    x0: N.pas * (c0 - 0.5), x1: N.pas * (c0 + l), y0: 1.5 * u * r0 - u, y1: 1.5 * u * (r0 + h - 1) + u,
    bordX0: c0 === 0, bordX1: c0 + l >= g.cols, bordY0: r0 === 0, bordY1: r0 + h >= g.rows };
}
// la fenêtre f couvre-t-elle la vue (x0, x1, y0, y1 km) ? (aux bords de la carte, ce qui dépasse ne compte pas)
export function couvre(f, x0, x1, y0, y1) {
  return (f.bordX0 || x0 >= f.x0) && (f.bordX1 || x1 <= f.x1) && (f.bordY0 || y0 >= f.y0) && (f.bordY1 || y1 <= f.y1);
}

// La carte du moteur pour la fenêtre f du niveau N (indices de la fenêtre : ligne × l + colonne). ville : les hexagones
// des places (on y bâtit : ni arbres, ni champs). gl(i) : l'hexagone de la grille entière sous la case i de la fenêtre.
export function fenetre(N, f, ville = new Set()) {
  const { c0, r0, l, h } = f, n = l * h, G = N.g.cols;
  const gl = i => (r0 + ((i / l) | 0)) * G + c0 + (i % l);
  const C = { l, h, version: 1, terrain: new Array(n), riviere: new Array(n), fertile: new Array(n), poissons: new Array(n).fill(0),
    gisement: new Array(n).fill(null), arbres: new Array(n), foret: new Array(n), rivieres: [], gl };
  for (let i = 0; i < n; i++) {
    const k = gl(i), v = ville.has(k);
    C.terrain[i] = v && N.terrain[k] >= 3 ? 4 : N.terrain[k];
    C.riviere[i] = N.riviere[k]; C.fertile[i] = v ? 0 : N.fertile[k];
    C.arbres[i] = v ? 0 : N.arbres[k]; C.foret[i] = v ? 0 : N.foret[k];
  }
  // les rivières coupées au bord de la fenêtre
  const loc = k => { const c = k % G - c0, r = ((k / G) | 0) - r0; return c >= 0 && r >= 0 && c < l && r < h ? r * l + c : -1; };
  for (const ch of N.rivieres) {
    let cur = [];
    for (const k of ch) { const i = loc(k); if (i >= 0) cur.push(i); else { if (cur.length > 1) C.rivieres.push(cur); cur = []; } }
    if (cur.length > 1) C.rivieres.push(cur);
  }
  return C;
}
