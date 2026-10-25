// La terre de la carte de campagne vue du ciel (SPEC-CARTE-2D, chantier A) : la peinture des tuiles de la maquette
// validée (web/js/dev/carte/new.js : couleurEn, peindreFond, parcelles, peindreTuile ; vivante.js : saisonner, neige,
// solSaison, gerbes, boisSaison, marais salants), sur les données du jeu. Peinte par map.js renderTile, dans les
// workers (peintre.js) comme sur le fil principal. Ce qui change d'une tuile à l'autre vient d'une grille absolue :
// pas de couture entre deux tuiles voisines.
import { SOLS, BOIS, OMBRE, TAU, alea, bat, clamp, lerp, hx, mix, sombre, clair, toile } from './lib.js';
import { AMB, zoneDe } from './ambiance.js';

export const TT = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
export const hash2 = (i, j, k = 0) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
// couleur de pays : des zones de quelques kilomètres, pas un damier
export const bruitC = (i, j, s) => .5 + .25 * Math.sin(i * .31 + s) * Math.cos(j * .27 - s * .6) + .25 * Math.sin((i * .13 - j * .17) + s * 2.3);
const CHAMPS = ['chaume', 'ble', 'labour', 'pre', 'colza', 'friche', 'pre', 'chaume'];
export const champDe = (i, j, h) => CHAMPS[Math.min(7, ((bruitC(i, j, 1.7) * .8 + h * .2) * 8) | 0)];
// les pays ne suivent pas la grille du jeu : chaque point lit le terrain un peu à côté, d'un décalage qui ondule
const ondeX = (x, y) => .55 * Math.sin(x * 1.31 + Math.sin(y * .93) * 1.7) + .3 * Math.sin(y * 2.7 + x * .61) + .15 * Math.sin((x + y) * 5.3);
const ondeY = (x, y) => .55 * Math.sin(y * 1.17 + Math.sin(x * .87) * 1.7) + .3 * Math.sin(x * 2.9 - y * .57) + .15 * Math.sin((x - y) * 4.9);
export const EAU = '#4f86a8', SABLE = '#e3d3a3';
const COUL = { 0: EAU, 1: EAU, 3: '#3a6834', 4: '#a39e68', 5: '#6f8f5a', 7: '#8f9a6a', 8: '#d9dcd8', 9: SABLE, 10: '#8f8456' };
const COUL_RGB = Object.fromEntries(Object.entries(COUL).map(([k, v]) => [k, hx(v)]));
const PIN = [86, 112, 64], PIN_HEX = '#2f5a33';

// ---------- les saisons
const TEINTE_S = { printemps: [[100, 150, 64], .22], ete: [[198, 178, 104], .2], automne: [[150, 116, 68], .22], hiver: [[134, 130, 112], .34] };
const VEGET = new Set([TT.PLAINE, TT.COLLINES, TT.VIGNE, TT.MARAIS, TT.LANDE, TT.MONTAGNE]);
const FEUILLUS_S = { printemps: [[86, 142, 62], .25], automne: [[130, 110, 52], .35], hiver: [[106, 96, 80], .55] };
export const BOIS_S = { printemps: ['#4f8a3a', '#5e9a44', '#6aa64c', '#47803a', '#73ad55'], ete: BOIS, automne: ['#6f7a3a', '#8a7a34', '#5f6e32', '#7a6a3a', '#4f6a2c', '#7f6a30'], hiver: ['#8a7d6c', '#7f7262', '#948674', '#76695a', '#6a7058'] };
export const boisSaison = h => { const P = BOIS_S[AMB.saison] || BOIS; return P[(h * P.length) | 0]; };
const FEUILLES_VIGNE = { printemps: ['#8fbf5a', '#a3cc6a'], ete: ['#4f7a33', '#5d8a3c'], automne: ['#c9a032', '#b5552c', '#d7b448', '#9a3f28'], hiver: null };   // l'hiver, les ceps sont nus
const FEUILLES_PHYLLOXERA = ['#8a6a3a', '#9a7444', '#6f5a36'];
const LUMIERE_BOIS = { printemps: '#b5dc8a', ete: '#a5cf7f', automne: '#cfc07a', hiver: '#cfc6b8' };
Object.assign(SOLS, {
  ble_vert: { nom: 'Blé en herbe', base: '#79a94f', raie: '#6a9a44', pas: 4, ep: 1.6 },
  colza_fleur: { nom: 'Colza en fleur', base: '#cdbf4e', raie: '#bba940', pas: 4, ep: 1.6 },
  labour_frais: { nom: 'Labour frais', base: '#8c6c4c', raie: '#7a5c3f', pas: 5, ep: 2.4 },
  moisson: { nom: 'Blé moissonné', base: '#d6c182', raie: '#c3ab68', pas: 5, ep: 1.8 },
  pre_sec: { nom: 'Pré fauché', base: '#a3a865', raie: '#959a58', pas: 8, ep: 3 },
  labour_hiver: { nom: 'Labour d’hiver', base: '#8a7560', raie: '#79654f', pas: 5, ep: 2.4 },
  ble_hiver: { nom: 'Blé d’hiver levé', base: '#8a9a62', raie: '#7c8c56', pas: 4, ep: 1.6 },
  pre_hiver: { nom: 'Pré d’hiver', base: '#7f9460', raie: '#748956', pas: 8, ep: 3 },
  neige: { nom: 'Neige', base: '#e9ecea', raie: '#d5dad8', pas: 5, ep: 1.6 },
  // (epoque.js) le maïs de Chalosse et du Béarn ; luzerne et betterave de l'assolement
  mais: { nom: 'Maïs', base: '#a9b84e', raie: '#93a33f', pas: 4, ep: 1.8 },
  luzerne: { nom: 'Luzerne', base: '#8ea65a', raie: '#7f9850', pas: 6, ep: 2.4 },
  betterave: { nom: 'Betterave', base: '#6f9448', raie: '#5e823d', pas: 5, ep: 2.2 },
});
const SOL_SAISON = {
  printemps: { chaume: 'ble_vert', ble: 'ble_vert', colza: ['colza_fleur', 'ble_vert', 'pre'] },
  ete: { chaume: 'moisson', colza: 'chaume', labour: 'chaume', pre: 'pre_sec' },
  automne: { ble: ['labour_frais', 'chaume', 'ble_hiver'], colza: 'ble_hiver', labour: ['labour_frais', 'chaume'] },   // on laboure, on sème le blé d'hiver
  hiver: { chaume: ['labour_hiver', 'ble_hiver'], labour: ['labour_hiver', 'ble_hiver'], ble: 'ble_hiver', colza: 'ble_hiver', pre: 'pre_hiver', friche: 'pre_hiver' },
};
// la culture d'une parcelle à cette saison (hh : son tirage), sans la neige
export function solSaison(sol, saison, hh) {
  const s = SOL_SAISON[saison]?.[sol] || sol;
  return Array.isArray(s) ? s[(hh * 7919 % 1) * s.length | 0] : s;
}
// la limite des neiges (relief approché, 0 en plaine, 1,6 sur les sommets) : sur les sommets presque toute l'année
export const SEUIL_NEIGE = { printemps: 1.05, ete: 1.35, automne: 1.15, hiver: .7 };
// part de neige au sol d'après l'altitude, la saison et la neige qui tombe là ; la limite suit le relief, ondulée de
// bruits à basse fréquence seulement (un bruit fin hachurait la limite en damier)
export function neigeAu(a, x, y, saison, tombe) {
  let n = clamp((a - SEUIL_NEIGE[saison]) / .3 + .3 * Math.sin(x * .21 + y * .13) + .2 * Math.sin(x * .11 - y * .29), 0, 1);
  if (tombe) n = Math.max(n, clamp(.85 + (bruitC(x * .35, y * .35, 5.1) - .5) * 1.1, 0, 1));
  return n;
}

// toiles de travail, réutilisées d'une tuile à l'autre (une par worker)
let TOILE = null, MASQUE = null, TMP = null;
const toileDe = (c, n) => { if (!c) return toile(n, n); if (c.width !== n) { c.width = n; c.height = n; } return c; };

// le relief et les marais salants, d'après la carte du jeu (une fois par carte : sur map._terre)
export const terre = map => map._terre || (map._terre = new Terre(map));
export class Terre {
  constructor(map) {
    const W = this.W = map.W, H = this.H = map.H, TER = this.TER = map.terrain;
    this.xCote = map.m?.x_cote ?? 72;
    // un relief approché d'après le terrain (le jeu n'a pas d'altitudes) : ombrage et limite des neiges
    const HT = [-.1, -.05, .04, .1, .05, 0, .38, .9, 1.6, .14, .16], ALT = this.ALT = new Float32Array(W * H), tmp = new Float32Array(W * H);
    for (let k = 0; k < ALT.length; k++) ALT[k] = HT[TER[k]] + .06 * hash2(k % W, k / W | 0, 7);
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x >= 0 && y >= 0 && x < W && y < H) { s += ALT[y * W + x]; n++; } } tmp[j * W + i] = s / n; }
      ALT.set(tmp);
    }
    // marais salants : les marais au bord de l'océan, de l'estuaire et du bassin d'Arcachon
    const dans = (r, x, y) => { let d = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; } return d; };
    const sales = (map.m?.waters || []).filter(w => /Arcachon|Gironde/.test(w.name || ''));
    this.SALINE = new Set();
    for (let j = 0; j < H; j++) for (let i = 0; i < Math.min(W, 110); i++) {
      if (TER[j * W + i] !== TT.MARAIS || hash2(i, j, 91) > .6) continue;
      let sale = false;
      for (let dj = -2; dj <= 2 && !sale; dj++) for (let di = -2; di <= 2 && !sale; di++) {
        const x = i + di + .5, y = j + dj + .5, t = this.ter(x, y);
        sale = t === TT.OCEAN || (t === TT.EAU && sales.some(w => dans(w.ring, x, y)));
      }
      if (sale) this.SALINE.add(j * W + i);
    }
    this.DEPT = map.dept; this.codes = map.deptCodes || [];
    this.c3 = [0, 0, 0]; this.TO = null;
  }
  // code du département d'un point ('33', '64'…)
  dept(x, y) { const i = x | 0, j = y | 0; return i >= 0 && j >= 0 && i < this.W && j < this.H && this.DEPT ? this.codes[this.DEPT[j * this.W + i] - 1] : undefined; }
  ter(x, y) { const i = x | 0, j = y | 0; return i >= 0 && j >= 0 && i < this.W && j < this.H ? this.TER[j * this.W + i] : 0; }
  terOnde(x, y) { return this.ter(x + ondeX(x, y), y + ondeY(x, y)); }
  // de près, une ondulation de plus, fine : les lisières restent sinueuses au lieu de lignes droites
  terOndeFin(x, y) { return this.ter(x + ondeX(x, y) + .05 * Math.sin(x * 13.7 + y * 5.1) + .025 * Math.sin(y * 29 - x * 11), y + ondeY(x, y) + .05 * Math.sin(y * 12.9 - x * 4.3) + .025 * Math.sin(x * 27 + y * 13)); }
  alt(x, y) {
    const W = this.W, A = this.ALT, i = clamp(Math.floor(x - .5), 0, W - 2), j = clamp(Math.floor(y - .5), 0, this.H - 2), fx = clamp(x - .5 - i, 0, 1), fy = clamp(y - .5 - j, 0, 1), k = j * W + i;
    return lerp(lerp(A[k], A[k + 1], fx), lerp(A[k + W], A[k + W + 1], fx), fy);
  }
  // la pinède des Landes (pins), le reste en feuillus ; limite ondulée, sans ligne droite
  pinede(x, y) { const u = x + 2.5 * Math.sin(y * .083) + 1.5 * Math.sin(y * .21 + x * .05), v = y + 2.5 * Math.sin(x * .071) + 1.5 * Math.sin(x * .19 - y * .04); return u < this.xCote + 70 && v > 80 && v < 230; }
  // il neige là (météo de la zone, AMB) ; les limites des zones ondulent sur quelques kilomètres
  tombe(x, y) { return AMB.meteo[zoneDe(x + 6 * Math.sin(y * .05) + 3 * Math.sin(y * .17 + 1), y + 6 * Math.sin(x * .045) + 3 * Math.sin(x * .15 + 2))] === 'neige'; }
  neige(x, y) { return neigeAu(this.alt(x, y), x, y, AMB.saison, this.tombe(x, y)); }
  // les couleurs d'une grille de n × n points ((gi + ½) × pas km) : pays, saison, neige, sable au bord de l'eau,
  // ombrage du relief. Écrites dans data (RVBA) ; le terrain de chaque point dans tg
  grille(gi0, gj0, n, pas, data, tg, blanc) {
    // le terrain ondulé d'abord, avec un point de bord : le sable se lit chez les voisins
    const m = n + 2, to = this.TO && this.TO.length >= m * m ? this.TO : (this.TO = new Uint8Array(m * m));
    const onde = pas < .05 ? (x, y) => this.terOndeFin(x, y) : (x, y) => this.terOnde(x, y);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { const x = (gi0 + i - .5) * pas, y = (gj0 + j - .5) * pas; to[j * m + i] = onde(x, y); }
    const sa = AMB.saison, neigeT = Object.values(AMB.meteo).includes('neige'), c = this.c3, hiver = sa === 'hiver';
    const TS = TEINTE_S[sa], FS = FEUILLUS_S[sa];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (gi0 + i + .5) * pas, y = (gj0 + j + .5) * pas, q = (j + 1) * m + i + 1, t = to[q], o = (j * n + i) * 4;
      tg[j * n + i] = t; data[o + 3] = 255;
      if (t <= 1) { data[o] = 79; data[o + 1] = 134; data[o + 2] = 168; continue; }
      const pin = t === TT.FORET && this.pinede(x, y);
      let s = pin ? PIN : COUL_RGB[t];
      if (to[q - 1] <= 1 || to[q + 1] <= 1 || to[q - m] <= 1 || to[q + m] <= 1 || to[q - m - 1] <= 1 || to[q - m + 1] <= 1 || to[q + m - 1] <= 1 || to[q + m + 1] <= 1) s = COUL_RGB[9];
      else if (hiver && t === TT.HAUTE) s = COUL_RGB[TT.MONTAGNE];   // l'hiver, la neige seule distingue haute montagne et montagne
      if (s) { c[0] = s[0]; c[1] = s[1]; c[2] = s[2]; }
      else { const a = bruitC(x * .9, y * .9, 1.7), b = bruitC(x * .5, y * .5, 4.1) * .4; c[0] = lerp(lerp(206, 124, a), 196, b); c[1] = lerp(lerp(186, 166, a), 178, b); c[2] = lerp(lerp(122, 90, a), 120, b); }
      const ts = VEGET.has(t) ? TS : t === TT.FORET && !pin ? FS : null;
      if (ts) { const [v, k] = ts; c[0] = lerp(c[0], v[0], k); c[1] = lerp(c[1], v[1], k); c[2] = lerp(c[2], v[2], k); }
      const a = this.alt(x, y);
      const nn = neigeAu(a, x, y, sa, neigeT && this.tombe(x, y)) * (t === TT.FORET && a < .3 ? .45 : 1) * .78;   // sous les bois de plaine, moins de neige
      if (nn > 0) { c[0] = lerp(c[0], 236, nn); c[1] = lerp(c[1], 239, nn); c[2] = lerp(c[2], 239, nn); if (blanc) blanc[j * n + i] = nn; }
      const gx = this.alt(x + .5, y) - this.alt(x - .5, y), gy = this.alt(x, y + .5) - this.alt(x, y - .5);
      const k = clamp(1 - (gx * .6 + gy * .8) * 2.6, .62, 1.3) * (.95 + .1 * bruitC(x * 1.2, y * 1.2, .4));
      data[o] = c[0] * k; data[o + 1] = c[1] * k; data[o + 2] = c[2] * k;
    }
  }
  // le fond de toute la carte, à R pixels par km (map.js paintLand), lissé à l'agrandissement
  fond(cv, R) {
    cv.width = this.W * R; cv.height = this.H * R;
    const g = cv.getContext('2d'), img = g.createImageData(cv.width, cv.height);
    this.grilleGrande(0, 0, cv.width, cv.height, 1 / R, img.data);
    g.putImageData(img, 0, 0);
  }
  // une grille rectangulaire, par bandes carrées (grille)
  grilleGrande(gi0, gj0, w, h, pas, data) {
    const B = 64, d = new Uint8ClampedArray(B * B * 4), tg = new Uint8Array(B * B);
    for (let bj = 0; bj < h; bj += B) for (let bi = 0; bi < w; bi += B) {
      this.grille(gi0 + bi, gj0 + bj, B, pas, d, tg);
      for (let j = 0; j < B && bj + j < h; j++) { const n = Math.min(B, w - bi); data.set(d.subarray(j * B * 4, (j * B + n) * 4), ((bj + j) * w + bi) * 4); }
    }
  }
  // l'aspect d'un milieu de zoom (6 à 12 px/km) : la grille seule, un point tous les deux pixels
  moyen(g, L, x0, y0, span) {
    const pas = 2 / L, gi0 = Math.floor(x0 / pas) - 1, gj0 = Math.floor(y0 / pas) - 1, n = Math.ceil(span / pas) + 3;
    const fin = TOILE = toileDe(TOILE, n), fg = fin.getContext('2d', { willReadFrequently: true }), img = fg.createImageData(n, n);
    this.grille(gi0, gj0, n, pas, img.data, new Uint8Array(n * n));
    fg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(fin, gi0 * pas, gj0 * pas, n * pas, n * pas);
  }

  // de près (L ≥ 16 px/km) : un fond plus fin, les parcelles, les bois, les marais salants, les vagues.
  // g est en km (la transformation de la tuile) ; at(i, j) : marques d'époque du camp qui tient la case (epoque.js)
  detail(g, L, x0, y0, span, at = () => null, phyllo = () => false) {
    const x1 = x0 + span, y1 = y0 + span, px = 1 / L, sa = AMB.saison, nus = sa === 'hiver';
    // échantillons sur une grille absolue, avec une marge : les houppiers qui débordent d'une tuile sont les mêmes
    // dans la voisine. Densités par km², les mêmes à tous les niveaux (au plus un arbre par échantillon)
    const pas = 3 / L, M = Math.ceil(.13 / pas) + 1, a2 = pas * pas;
    const gi0 = Math.floor(x0 / pas) - M, gj0 = Math.floor(y0 / pas) - M, n = Math.ceil(span / pas) + 2 * M + 1;
    const fin = TOILE = toileDe(TOILE, n), fg = fin.getContext('2d', { willReadFrequently: true }), img = fg.createImageData(n, n), data = img.data;
    const masque = new Uint8Array(n * n), bois = [], tg = new Uint8Array(n * n), blanc = this.BLANC = new Float32Array(n * n);
    this.grille(gi0, gj0, n, pas, data, tg, blanc);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = gi0 + i, gj = gj0 + j, x = (gi + .5) * pas, y = (gj + .5) * pas, t = tg[j * n + i];
      if (t === TT.PLAINE || t === TT.COLLINES || t === TT.VIGNE) masque[j * n + i] = t === TT.VIGNE ? 2 : 1;
      else if (t === TT.LANDE) {
        // (epoque.js) les semis de pins, puis la loi de 1857, font de la lande une forêt de pins
        const mk = at(x | 0, y | 0), D = mk?.has('landes1857') ? 110 : mk?.has('pins') ? 45 : 10;
        if (hash2(gi, gj, L + 1) < D * a2) bois.push([x + (hash2(gj, gi, 5) - .5) * pas, y + (hash2(gi, gj, 6) - .5) * pas, true]);
      } else if (t === TT.FORET) {
        const pin = this.pinede(x, y);
        if (hash2(gi, gj, L) < (pin ? 76 : 190) * a2) bois.push([x + (hash2(gj, gi, 3) - .5) * pas, y + (hash2(gi, gj, 4) - .5) * pas, pin]);
      } else if (t === TT.MARAIS && at(x | 0, y | 0)?.has('drainage') && hash2(x | 0, y | 0, 96) < .8) masque[j * n + i] = 1;   // marais drainés : des prés
    }
    fg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(fin, gi0 * pas, gj0 * pas, n * pas, n * pas);
    // parcelles en briques, peintes à part puis découpées par le masque des champs (bords doux)
    if (L >= 24) {
      const tmp = TMP = toileDe(TMP, g.canvas.width), tg = tmp.getContext('2d');
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, tmp.width, tmp.height);
      tg.setTransform(L, 0, 0, L, -x0 * L, -y0 * L);
      peindreParcelles(this, tg, L, x0, y0, x1, y1, at, phyllo);
      const mc = MASQUE = toileDe(MASQUE, n), mg = mc.getContext('2d'), mi = mg.createImageData(n, n);
      // la neige au sol couvre les parcelles comme le reste, d'une limite douce qui suit le relief (et non parcelle
      // par parcelle) ; les parcelles tout à fait sous la neige sont peintes en neige (peindreParcelles)
      if (blanc.some(v => v > 0)) {
        for (let k = 0; k < n * n; k++) { const o = k * 4; mi.data[o] = 236; mi.data[o + 1] = 239; mi.data[o + 2] = 239; mi.data[o + 3] = blanc[k] * 255; }
        mg.putImageData(mi, 0, 0);
        tg.imageSmoothingEnabled = true; tg.drawImage(mc, gi0 * pas, gj0 * pas, n * pas, n * pas);
      }
      for (let k = 0; k < n * n; k++) mi.data[k * 4 + 3] = masque[k] ? 255 : 0;
      mg.putImageData(mi, 0, 0);
      tg.globalCompositeOperation = 'destination-in'; tg.imageSmoothingEnabled = true;
      tg.drawImage(mc, gi0 * pas, gj0 * pas, n * pas, n * pas);
      tg.globalCompositeOperation = 'source-over';
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = .82; g.drawImage(tmp, 0, 0); g.restore();
    }
    // bois : houppiers ronds là où le fond dit forêt, lisières sinueuses ; un seul tracé par couleur
    const pts = bois.map(([x, y, pin]) => [x, y, (pin ? .055 : .085) * (.75 + hash2(x * 50 | 0, y * 50 | 0) * .6), pin ? PIN_HEX : boisSaison(hash2(x * 31 | 0, y * 17 | 0)), pin]);
    const disques = (col, liste, dx, dy, k) => {
      if (!liste.length) return;
      g.fillStyle = col; g.beginPath();
      for (const p of liste) { const r = p[2] * k, x = p[0] + p[2] * dx, y = p[1] + p[2] * dy; g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
      g.fill();
    };
    g.fillStyle = OMBRE; g.beginPath();
    for (const p of pts) { const x = p[0] + .025, y = p[1] + .033; g.moveTo(x + p[2], y); g.arc(x, y, p[2], 0, TAU); }
    g.fill();
    const parCoul = new Map(); for (const p of pts) { let l = parCoul.get(p[3]); if (!l) parCoul.set(p[3], l = []); l.push(p); }
    // l'hiver, les feuillus sont nus : des houppiers clairsemés, à travers lesquels on voit le sol
    for (const [col, l] of parCoul) { const nu = nus && col !== PIN_HEX; g.globalAlpha = nu ? .45 : 1; disques(col, l, 0, 0, nu ? .85 : 1); }
    g.globalAlpha = .26; disques(LUMIERE_BOIS[sa], nus ? pts.filter(p => p[4]) : pts, -.32, -.34, .5);
    const blancs = pts.filter(p => (!nus || p[4]) && this.neige(p[0], p[1]) > .5);
    g.globalAlpha = .7; disques('#f2f4f2', blancs, -.2, -.25, .62); g.globalAlpha = 1;   // neige sur les houppiers
    if (L >= 24) this.salines(g, x0, y0, x1, y1);
    // vagues au large : sur une grille d'un km, la même d'une tuile à l'autre
    g.strokeStyle = 'rgba(200,225,240,.35)'; g.lineWidth = px; g.beginPath();
    for (let j = Math.floor(y0) - 1; j <= y1; j++) for (let i = Math.floor(x0) - 1; i <= x1; i++) {
      if (hash2(i, j, 97) > .6) continue;
      const x = i + hash2(i, j, 98), y = j + hash2(i, j, 99);
      if (this.terOnde(x, y) !== 0) continue;
      g.moveTo(x, y); g.quadraticCurveTo(x + 7 * px, y - 3 * px, x + 14 * px, y);
    }
    g.stroke();
  }

  // les bassins du marais salant, entre leurs levées d'argile ; l'été le sel blanchit les œillets et monte en mulons
  salines(g, x0, y0, x1, y1) {
    const s = AMB.saison, bw = .1, bh = .065, gap = .018, sel = s === 'ete' || s === 'automne';
    const levees = new Path2D(), eau = [new Path2D(), new Path2D(), new Path2D()], mulO = new Path2D(), mul = new Path2D(), cabanes = [];
    let vu = false;
    for (let j = Math.floor(y0) - 1; j <= y1; j++) for (let i = Math.floor(x0) - 1; i <= x1; i++) {
      if (!this.SALINE.has(j * this.W + i)) continue;
      vu = true;
      for (let v = j + .08; v + bh < j + .92; v += bh + gap) for (let u = i + .08; u + bw < i + .92; u += bw + gap) {
        if (this.terOnde(u + bw / 2, v + bh / 2) !== TT.MARAIS) continue;
        const h = hash2(u * 97 | 0, v * 89 | 0, 93);
        levees.rect(u - gap / 2, v - gap / 2, bw + gap, bh + gap);
        eau[s === 'hiver' ? 2 : sel && h < .45 ? 0 : h < .7 ? 1 : 2].rect(u, v, bw, bh);
        if (sel && h < .3) { const x = u + bw * .8, y = v + bh / 2; mulO.moveTo(x + .017, y + .008); mulO.arc(x + .006, y + .008, .011, 0, TAU); mul.moveTo(x + .011, y); mul.arc(x, y, .011, 0, TAU); }
      }
      if (hash2(i, j, 94) < .5) cabanes.push([i + .5, j + .95]);   // la cabane du saunier
    }
    if (!vu) return;
    g.fillStyle = '#9d916f'; g.fill(levees);
    ['#dfe6e3', '#a9c2c6', s === 'hiver' ? '#5f8496' : '#8fb0bb'].forEach((c, k) => { g.fillStyle = c; g.fill(eau[k]); });
    g.fillStyle = 'rgba(30,30,20,.3)'; g.fill(mulO); g.fillStyle = '#f7f6ef'; g.fill(mul);
    for (const [x, y] of cabanes) bat(g, [{ t: 'g', x: -6, y: -3, w: 12, h: 6, p: 'tuile', h2: 1 }], x, y, 0, .006);
  }

  // les arbres des routes royales, de près : un rang de chaque côté (map.js drawRoads)
  arbresRoyaux(g, routes, w) {
    const r = .035, col = boisSaison(.4), ombre = new Path2D(), houp = new Path2D(), lum = new Path2D();
    for (const pts of routes) for (let i = 1; i < pts.length; i++) {
      const [a0, b0] = pts[i - 1], [a1, b1] = pts[i], l = Math.hypot(a1 - a0, b1 - b0);
      if (!l) continue;
      const nx = -(b1 - b0) / l, ny = (a1 - a0) / l;
      for (let t = 0; t < l; t += .14) for (const s of [-1, 1]) {
        const x = a0 + (a1 - a0) * t / l + nx * s * (w + .03), y = b0 + (b1 - b0) * t / l + ny * s * (w + .03);
        ombre.moveTo(x + r * 1.7, y + r * .9); ombre.arc(x + r * .7, y + r * .9, r, 0, TAU);
        houp.moveTo(x + r, y); houp.arc(x, y, r, 0, TAU);
        lum.moveTo(x - r * .32 + r * .5, y - r * .34); lum.arc(x - r * .32, y - r * .34, r * .5, 0, TAU);
      }
    }
    const nu = AMB.saison === 'hiver';
    g.fillStyle = OMBRE; g.fill(ombre);
    g.globalAlpha = nu ? .45 : 1; g.fillStyle = col; g.fill(houp);
    if (!nu) { g.globalAlpha = .28; g.fillStyle = '#a5cf7f'; g.fill(lum); }
    g.globalAlpha = 1;
  }
}

// parcelles en briques de tailles variées, sur des rangs qui ne suivent pas la grille du jeu
export function parcelles(x0, y0, x1, y1, fn) {
  const hr = .78;
  for (let r = Math.floor(y0 / hr) - 1; r * hr < y1 + hr; r++) {
    const ya = r * hr + (hash2(r, 1, 9) - .5) * .12, yb = (r + 1) * hr + (hash2(r + 1, 1, 9) - .5) * .12;
    const lx = .62 + hash2(r, 3, 9) * .4, dec = hash2(r, 5, 9) * lx;
    for (let k = Math.floor((x0 - dec) / lx) - 1; k * lx + dec < x1 + lx; k++) {
      const xa = k * lx + dec + (hash2(r, k, 2) - .5) * lx * .5, xb = (k + 1) * lx + dec + (hash2(r, k + 1, 2) - .5) * lx * .5;
      if (xb < x0 || xa > x1 || yb < y0 || ya > y1) continue;
      fn(xa, ya, xb - xa, yb - ya, hash2(r, k, 7), r, k);
    }
  }
}

// la peinture des parcelles de lib.js (parcelle, vigne, gerbes), groupée : un tracé par culture et par couleur au
// lieu de centaines de remplissages par parcelle. Unités de la maquette : u km (1 unité = 0,6 px jusqu'à 64 px/km)
function peindreParcelles(T, g, L, x0, y0, x1, y1, at, phyllo) {
  const u = .6 / Math.min(L, 64), det = L >= 64 ? .4 : .7, sa = AMB.saison;
  const lots = new Map(), fermes = [];
  const lot = sol => { let l = lots.get(sol); if (!l) lots.set(sol, l = { rects: new Path2D(), tr: new Map() }); return l; };
  const tr = (l, k) => { let p = l.tr.get(k); if (!p) l.tr.set(k, p = new Path2D()); return p; };
  // (les menus détails font moins de deux pixels jusqu'à 64 px/km : des carrés, bien moins chers que des disques)
  const carres = L * u < 1.5;
  const disque = carres ? (p, x, y, r) => p.rect(x - r, y - r, 2 * r, 2 * r) : (p, x, y, r) => { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); };
  const ovale = (p, x, y, rx, ry, a) => { if (carres) { p.rect(x - rx * .8, y - ry * .8, rx * 1.6, ry * 1.6); return; } p.moveTo(x + rx * Math.cos(a), y + rx * Math.sin(a)); p.ellipse(x, y, rx, ry, a, 0, TAU); };
  const grain = (p, x, y, rx, ry, a) => { p.moveTo(x + rx * Math.cos(a), y + rx * Math.sin(a)); p.ellipse(x, y, rx, ry, a, 0, TAU); };
  parcelles(x0, y0, x1, y1, (x, y, w, h, hh, r, k) => {
    const cx = x + w / 2, cy = y + h / 2, t = T.terOnde(cx, cy), mk = at(cx | 0, cy | 0);
    const champ = t === TT.PLAINE || t === TT.COLLINES || (t === TT.MARAIS && mk?.has('drainage'));
    if (!champ && t !== TT.VIGNE) return;
    const R = alea(r * 7919 + k * 104729 + 17);
    if (t === TT.VIGNE) {
      // la vigne : rangs de ceps, un tracé par couleur de feuillage
      const l = lot('vigne'), vx = x + .6 * u, vy = y + .6 * u, vw = w - 1.2 * u, vh = h - 1.2 * u, dir = hh < .5, e = 3 * u;
      l.rects.rect(vx, vy, vw, vh);
      const rg = tr(l, 's|#8a7650|' + .5 * u);
      if (dir) for (let yy = vy + 1.5 * u; yy < vy + vh; yy += e) { rg.moveTo(vx, yy); rg.lineTo(vx + vw, yy); }
      else for (let xx = vx + 1.5 * u; xx < vx + vw; xx += e) { rg.moveTo(xx, vy); rg.lineTo(xx, vy + vh); }
      const F = phyllo(cx, cy) && hh * 31 % 1 < .7 ? FEUILLES_PHYLLOXERA : FEUILLES_VIGNE[sa];
      if (!F || T.neige(cx, cy) > .6) return;
      // (les ceps en pointillés ronds : des bouts de rang de 2 à 6 ceps par couleur, au lieu d'un disque par cep)
      const rr = (sa === 'printemps' ? .45 : .65) * u, pc = 1.6 * u, ch = F.map(c => tr(l, 'd|' + c + '|' + 2 * rr + '|' + pc)), fin = dir ? vw : vh;
      for (let a = 1.5 * u; a < (dir ? vh : vw); a += e) for (let b = u; b < fin;) {
        const k = Math.min(2 + (R() * 5 | 0), Math.floor((fin - b) / pc) + 1), b1 = b + (k - 1) * pc + pc * .01, p = ch[R() * F.length | 0];
        if (dir) { p.moveTo(vx + b, vy + a); p.lineTo(vx + b1, vy + a); } else { p.moveTo(vx + a, vy + b); p.lineTo(vx + a, vy + b1); }
        b += k * pc;
      }
      return;
    }
    // la culture : champDe, puis l'époque (maïs, assolement) et la saison
    let sol = champDe(cx * 1.8, cy * 1.8, hh);
    const dc = T.dept(cx, cy);
    if (mk?.has('mais') && (dc === '40' || dc === '64') && hh * 17 % 1 < .5) sol = 'mais';
    else if (mk?.has('assolement') && hh * 23 % 1 < .35) sol = hh * 29 % 1 < .5 ? 'luzerne' : 'betterave';
    sol = T.neige(cx, cy) > .95 ? 'neige' : solSaison(sol, sa, hh);
    const s = SOLS[sol], l = lot(sol), dirH = hh * 13 % 1 < .5;
    const px0 = x + .7 * u, py0 = y + .7 * u, pw = w - 1.4 * u, ph = h - 1.4 * u, W = pw / u, H = ph / u;
    l.rects.rect(px0, py0, pw, ph);
    // grain du sol
    const tc = tr(l, 'a|' + clair(s.base, .14)), ts = tr(l, 'a|' + sombre(s.base, .12));
    for (let i = 0, nn = W * H / 700; i < nn; i++) { const p = R() < .5 ? tc : ts, rx = (8 + R() * 18) * u, ry = (5 + R() * 12) * u, a = R() * 3; grain(p, px0 + R() * pw, py0 + R() * ph, rx, ry, a); }
    // raies
    const rg = tr(l, 's|' + s.raie + '|' + s.ep * u), e = s.pas * u;
    if (dirH) for (let yy = py0 + e / 2; yy < py0 + ph; yy += e) { rg.moveTo(px0, yy); rg.lineTo(px0 + pw, yy); }
    else for (let xx = px0 + e / 2; xx < px0 + pw; xx += e) { rg.moveTo(xx, py0); rg.lineTo(xx, py0 + ph); }
    // menus détails de chaque culture
    const nd = W * H * det, pt = (cnt, fn) => { for (let i = 0; i < cnt; i++) { const a = R(), b = R(), c = R(), d = R(); fn(px0 + a * pw, py0 + b * ph, c, d); } };
    if (sol === 'pre') {
      const p1 = tr(l, 'f|#5f8f43'), p2 = tr(l, 'f|#86b363'), f1 = tr(l, 'f|#f4f1e4'), f2 = tr(l, 'f|#efd45a');
      pt(nd / 40, (x, y, c, d) => ovale(c < .5 ? p1 : p2, x, y, (.8 + d) * u, (.6 + d * .6) * u, c * 3));
      pt(nd / 380, (x, y, c) => disque(c < .6 ? f1 : f2, x, y, .38 * u));
    } else if (sol === 'labour') { const p1 = tr(l, 'f|#7d5839'), p2 = tr(l, 'f|#4f331f'); pt(nd / 26, (x, y, c, d) => disque(c < .5 ? p1 : p2, x, y, (.4 + d * .6) * u)); }
    else if (sol === 'chaume') { const p1 = tr(l, 's|#e4d3a0|' + .35 * u), p2 = tr(l, 's|#b39c60|' + .35 * u); pt(nd / 45, (x, y, c) => { const p = c < .5 ? p1 : p2; p.moveTo(x, y); dirH ? p.lineTo(x + 1.6 * u, y + .2 * u) : p.lineTo(x + .2 * u, y + 1.6 * u); }); }
    else if (sol === 'ble') { const p1 = tr(l, 'f|#ead28a'), p2 = tr(l, 'f|#b9993f'); pt(nd / 36, (x, y, c) => disque(c < .5 ? p1 : p2, x, y, .35 * u)); }
    else if (sol === 'colza') { const p1 = tr(l, 'f|#52a24c'), p2 = tr(l, 'f|#2f6e2e'); pt(nd / 34, (x, y, c, d) => disque(c < .5 ? p1 : p2, x, y, (.5 + d * .4) * u)); }
    else { const p1 = tr(l, 'f|' + clair(s.base, .15)), p2 = tr(l, 'f|' + sombre(s.base, .18)); pt(nd / 40, (x, y, c, d) => ovale(c < .5 ? p1 : p2, x, y, (.9 + d) * u, .6 * u, c * 3)); }
    // tournières : la bande où l'attelage tourne, au bout des raies ; un liseré clair
    const tn = tr(l, 'g|' + mix(s.base, s.raie, .5)), b5 = 5 * u;
    if (dirH) { tn.rect(px0, py0, b5, ph); tn.rect(px0 + pw - b5, py0, b5, ph); } else { tn.rect(px0, py0, pw, b5); tn.rect(px0, py0 + ph - b5, pw, b5); }
    tr(l, 'h|rgba(245,235,200,.3)|' + 1.4 * u).rect(px0 + .7 * u, py0 + .7 * u, pw - 1.4 * u, ph - 1.4 * u);
    // les moyettes : les gerbes dressées en tas sur le chaume, en rangs
    if (sol === 'moisson') {
      const o = tr(l, 'm|rgba(60,45,20,.3)'), m1 = tr(l, 'm|#e3cd84'), m2 = tr(l, 'm|#c9ad5c'), WW = w / u, HH = h / u;
      for (let a = 6; a < (dirH ? HH : WW) - 4; a += 9) for (let b = 5; b < (dirH ? WW : HH) - 4; b += 7 + R() * 3) {
        const gx = x + (dirH ? b : a) * u, gy = y + (dirH ? a : b) * u;
        disque(o, gx + .9 * u, gy + 1.2 * u, 1.5 * u); disque(m1, gx, gy, 1.5 * u); disque(m2, gx + .3 * u, gy + .3 * u, .7 * u);
      }
    }
    if (L >= 48 && hh < .04) fermes.push([x + w * .3, y + h * .4, hh * 40]);   // une ferme isolée
  });
  // une culture après l'autre : le sol, découpé à ses parcelles, puis ses tracés
  for (const [sol, l] of lots) {
    g.fillStyle = sol === 'vigne' ? '#a48d62' : SOLS[sol].base; g.fill(l.rects);
    g.save(); g.clip(l.rects);
    for (const [k, p] of l.tr) {
      const [op, c, lw] = k.split('|');
      if (op === 'a') { g.globalAlpha = .2; g.fillStyle = c; g.fill(p); g.globalAlpha = 1; }
      else if (op === 'f') { g.fillStyle = c; g.fill(p); }
      else if (op === 's') { g.strokeStyle = c; g.lineWidth = +lw; g.stroke(p); }
      else if (op === 'd') { g.lineCap = 'round'; g.setLineDash([0, +k.split('|')[3]]); g.strokeStyle = c; g.lineWidth = +lw; g.stroke(p); g.setLineDash([]); g.lineCap = 'butt'; }
    }
    g.restore();
    for (const [k, p] of l.tr) {
      const [op, c, lw] = k.split('|');
      if (op === 'g' || op === 'm') { g.fillStyle = c; g.fill(p); }
      else if (op === 'h') { g.strokeStyle = c; g.lineWidth = +lw; g.stroke(p); }
    }
  }
  for (const [x, y, a] of fermes) bat(g, [{ t: 'g', x: -6, y: -3, w: 12, h: 6, p: 'tuile', h2: 1 }], x, y, a, u * 2.2);
}
