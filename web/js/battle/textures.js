// Vue tactique : motifs du terrain, peints une fois par niveau de détail.
// Un motif est un petit canevas qui se répète sans joint (bruit périodique) : herbe aux nuances multiples, blé
// doré strié, chaumes, labours, maïs, vigne en rangs, lande, marais, sable, roche, sous-bois, terre des chemins,
// eau, pavés. Il est peint à la densité de la tuile (L pixels par mètre) : de loin, des nuances seulement ; de
// près, brins d'herbe, épis, mottes, cailloux et fleurs. Les cultures ont leurs rangs le long de x : la tuile les
// tourne dans le sens de la parcelle. Aussi : l'ombre douce posée au pied des arbres et des maisons.
import { hash, clamp, TAU, hexRgb, canvas } from './formes.js';

// ------------------------------------------------------------------ bruit périodique
// grille de n × n valeurs aléatoires, interpolée en douceur sur size pixels : se répète sans joint
function lattice(size, n, seed) {
  const g = new Float32Array(n * n), out = new Float32Array(size * size), cell = size / n;
  for (let k = 0; k < n * n; k++) g[k] = hash(k % n, (k / n) | 0, seed);
  for (let y = 0; y < size; y++) {
    const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty), j0 = (iy % n) * n, j1 = ((iy + 1) % n) * n;
    for (let x = 0; x < size; x++) {
      const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx), i0 = ix % n, i1 = (ix + 1) % n;
      const a = g[j0 + i0], b = g[j0 + i1], c = g[j1 + i0], d = g[j1 + i1];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}
// somme de couches de bruit centrées sur 0 ; layers : [[taille du grain en m, amplitude], …] ; L : px/m.
// Un grain de moins de 1,5 pixel ne se verrait pas : la couche est sautée.
function noise(size, L, layers, seed) {
  const out = new Float32Array(size * size);
  layers.forEach(([m, a], q) => {
    if (m * L < 1.5) return;
    const n = Math.max(1, Math.round(size / (m * L))), l = lattice(size, n, seed + q * 31);
    for (let k = 0; k < out.length; k++) out[k] += (l[k] - 0.5) * 2 * a;
  });
  return out;
}
// remplit le motif : couleur de base, éclaircie ou assombrie par v, mêlée à une autre couleur selon mix (0 à 1)
function paintBase(size, base, v, alt = null, mix = null) {
  const cv = canvas(size, size), g = cv.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let k = 0; k < size * size; k++) {
    let r = base[0], gg = base[1], b = base[2];
    if (mix) { const t = mix[k]; r += (alt[0] - r) * t; gg += (alt[1] - gg) * t; b += (alt[2] - b) * t; }
    const f = 1 + v[k];
    d[k * 4] = r * f; d[k * 4 + 1] = gg * f; d[k * 4 + 2] = b * f; d[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}
// fonction du bruit → mélange (0 à 1) : seuil doux
const ramp = (v, lo, hi, max = 1) => { const o = new Float32Array(v.length); for (let k = 0; k < v.length; k++) o[k] = clamp((v[k] - lo) / (hi - lo), 0, 1) * max; return o; };
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
// rangs (le long de x) : profil périodique en y ; period en m, prof : fonction de la phase (0 à 1) → −1 à 1
function rows(v, size, L, period, amp, prof = p => Math.sin(p * TAU)) {
  if (period * L < 2) return;                                // trop fins pour se voir
  const n = Math.max(1, Math.round(size / (period * L)));   // un nombre entier de rangs : pas de joint
  for (let y = 0; y < size; y++) { const a = prof((y * n / size) % 1) * amp; for (let x = 0; x < size; x++) v[y * size + x] += a; }
}
// petites marques semées au hasard (brins, épis, cailloux, fleurs), regroupées par couleur ; recopiées de l'autre
// côté quand elles débordent : le motif reste sans joint
function strew(g, size, count, seed, colors, mark, margin = 10) {
  const paths = colors.map(() => new Path2D());
  for (let k = 0; k < count; k++) {
    const x = hash(k, 1, seed) * size, y = hash(k, 2, seed) * size, p = paths[(hash(k, 3, seed) * colors.length) | 0];
    mark(p, x, y, k);
    const dx = x < margin ? size : x > size - margin ? -size : 0, dy = y < margin ? size : y > size - margin ? -size : 0;
    if (dx) mark(p, x + dx, y, k);
    if (dy) mark(p, x, y + dy, k);
    if (dx && dy) mark(p, x + dx, y + dy, k);
  }
  colors.forEach((c, i) => { if (c.fill) { g.fillStyle = c.fill; g.fill(paths[i]); } else { g.strokeStyle = c.stroke; g.lineWidth = c.w; g.stroke(paths[i]); } });
}
const blade = (L, len0, len1, seed) => (p, x, y, k) => {
  const l = (len0 + hash(k, 4, seed) * (len1 - len0)) * L, a = -Math.PI / 2 + (hash(k, 5, seed) - 0.5) * 0.9;
  p.moveTo(x, y); p.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
};
const dot = (r0, r1, seed) => (p, x, y, k) => { const r = r0 + hash(k, 6, seed) * (r1 - r0); p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); };

// ------------------------------------------------------------------ cultures selon la saison
// [culture, poids] ; une parcelle tire sa culture d'après son numéro
export const CULTURES = {
  printemps: [['bleVert', 38], ['avoine', 18], ['labour', 22], ['prairie', 22]],
  ete: [['ble', 34], ['chaume', 14], ['avoine', 14], ['mais', 12], ['bleVert', 8], ['prairie', 18]],   // l'or alterne avec des verts
  automne: [['labour', 40], ['chaume', 24], ['mais', 14], ['semis', 22]],
  hiver: [['labour', 60], ['chaume', 40]],
};
export function culture(season, r) {
  const list = CULTURES[season] || CULTURES.printemps, tot = list.reduce((a, c) => a + c[1], 0);
  let x = r * tot;
  for (const [c, w] of list) { x -= w; if (x <= 0) return c; }
  return list[0][0];
}

// ------------------------------------------------------------------ motifs
// taille du motif : assez grande pour que la répétition ne se voie pas (128 à 64 m de côté selon le niveau)
const texSize = L => (L <= 1 ? 128 : L <= 4 ? 256 : 512);

// kind : nature du sol ; L : px/m ; pal : palette de la saison (terrain.js) ; season : printemps, ete…
export function texture(kind, L, pal, season) {
  const size = texSize(L), S = 7 + kind.length * 13 + kind.charCodeAt(0), snow = !!pal.neige;
  const fine = L >= 4, tres = L >= 8;
  const n = layers => noise(size, L, layers, S);
  switch (kind) {
    case 'herbe': case 'prairie': {
      const base = hexRgb(pal.pre[0]), dry = hexRgb(pal.herbeSec || pal.pre[2]);
      const v = n([[16, 0.06], [4.5, 0.08], [1.3, 0.09], [0.35, 0.09], [0.1, 0.07]]);
      if (kind === 'prairie' && !snow) rows(v, size, L, 2.2, 0.04);   // andains de la fauche
      const mix = ramp(n([[9, 1], [2.5, 0.5]]), -0.1, 0.9, kind === 'prairie' ? 0.75 : 0.5);
      const cv = paintBase(size, kind === 'prairie' ? mixc(base, dry, 0.35) : base, v, dry, mix), g = cv.getContext('2d');
      if (snow) { neigeDetails(g, size, L, S); return cv; }
      if (fine) {
        const w = Math.max(0.6, 0.035 * L);
        strew(g, size, Math.min(14000, size * size / (tres ? 18 : 34)), S, [{ stroke: css(mul(base, 0.62), 0.6), w }, { stroke: css(mixc(mul(base, 1.22), [235, 225, 150], 0.3), 0.55), w }, { stroke: css(mul(dry, 0.85), 0.5), w }, { stroke: css(mul(base, 0.8), 0.5), w }], blade(L, 0.1, kind === 'prairie' ? 0.4 : 0.26, S));
      }
      if (tres) {
        const fl = { printemps: [['#f4f1e6', '#e8d04a', '#a58ac2'], 0.5], ete: [['#f1e6a0', '#e8d04a'], 0.15], automne: [['#efe9dc'], 0.04] }[season];
        if (fl) strew(g, size, Math.round(size * size / (L * L) * fl[1]), S + 9, fl[0].map(c => ({ fill: c })), dot(0.03 * L, 0.06 * L, S));
      }
      return cv;
    }
    case 'neige': {
      const v = n([[12, 0.03], [3, 0.03], [0.7, 0.02]]);
      const cv = paintBase(size, hexRgb(pal.pre[0]), v, [206, 218, 232], ramp(n([[7, 1]]), 0, 0.8, 0.5)), g = cv.getContext('2d');
      neigeDetails(g, size, L, S);
      return cv;
    }
    case 'ble': case 'bleVert': case 'avoine': case 'chaume': case 'semis': case 'labour': case 'mais':
      return crop(kind, size, L, pal, season, S, n);
    case 'vigneFoule': {
      // la vigne « en foule » d'avant le phylloxéra (SPEC-SUITE J) : des ceps plantés serrés et sans ordre, provignés
      const soil = hexRgb(pal.vigneSol), leaf = hexRgb(pal.vigneRang), v = n([[8, 0.05], [1.5, 0.06], [0.3, 0.06]]);
      const cv = paintBase(size, soil, v), g = cv.getContext('2d');
      if (snow) return cv;
      // (de loin, les ceps ne feraient qu'un point : un voile de feuillage, moucheté)
      if (L < 4) { g.fillStyle = css(leaf, 0.62); g.fillRect(0, 0, size, size); }
      const count = Math.min(16000, Math.round(size * size / (L * L) * (L < 4 ? 0.4 : 0.95)));
      for (let k = 0; k < count; k++) {
        const x = hash(k, 11, S) * size, y = hash(k, 12, S) * size, rr = (0.28 + hash(k, 13, S) * 0.2) * L;
        const c = season === 'automne' ? mixc(leaf, [205, 160, 60], hash(k, 14, S) * 0.6) : mixc(leaf, mul(leaf, 0.8), hash(k, 14, S));
        g.fillStyle = css(mul(soil, 0.7), 0.6); g.beginPath(); g.arc(x + rr * 0.3, y + rr * 0.35, rr, 0, TAU); g.fill();
        g.fillStyle = css(c); g.beginPath(); g.arc(x, y, rr * 0.85, 0, TAU); g.fill();
      }
      return cv;
    }
    case 'vigne': {
      const soil = hexRgb(pal.vigneSol), v = n([[8, 0.05], [1.5, 0.06], [0.3, 0.06]]);
      const cv = paintBase(size, soil, v), g = cv.getContext('2d');
      const nr = Math.max(1, Math.round(size / (2.1 * L))), sp = size / nr, leaf = hexRgb(pal.vigneRang);
      for (let r = 0; r < nr; r++) {
        const y = (r + 0.5) * sp;
        if (snow) {   // hiver : ceps taillés, fil de fer
          g.strokeStyle = 'rgba(70,58,44,0.6)'; g.lineWidth = Math.max(0.5, 0.05 * L); g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke();
          g.fillStyle = '#5a4a3c'; for (let x = 0; x < size; x += 1.2 * L) { g.beginPath(); g.arc(x, y, Math.max(0.6, 0.1 * L), 0, TAU); g.fill(); }
          continue;
        }
        // ombre du rang (au sud-est), puis le feuillage en touffes éclairées par-dessus
        g.fillStyle = css(mul(soil, 0.72), 0.7); g.fillRect(0, y - 0.15 * L, size, 0.75 * L);
        if (L < 4) { g.fillStyle = css(leaf); g.fillRect(0, y - 0.45 * L, size, 0.85 * L); g.fillStyle = css(mul(leaf, 1.2), 0.6); g.fillRect(0, y - 0.45 * L, size, 0.3 * L); continue; }
        const step = size / Math.round(size / (0.32 * L)), k0 = r * 997;
        for (let x0 = 0; x0 < size; x0 += step) for (const x of [x0, x0 - size, x0 + size]) {
          if (x < -L || x > size + L) continue;   // recopie de l'autre côté : pas de joint
          const q = k0 + x0 | 0, rr = (0.3 + hash(q, 1, S) * 0.18) * L, yy = y + (hash(q, 2, S) - 0.5) * 0.25 * L;
          const c = season === 'automne' ? mixc(leaf, [205, 160, 60], hash(q, 3, S) * 0.6) : mixc(leaf, mul(leaf, 0.8), hash(q, 3, S));
          g.fillStyle = css(mul(c, 0.7)); g.beginPath(); g.arc(x, yy + rr * 0.15, rr, 0, TAU); g.fill();
          g.fillStyle = css(c); g.beginPath(); g.arc(x - rr * 0.15, yy - rr * 0.12, rr * 0.8, 0, TAU); g.fill();
          if (fine) { g.fillStyle = css(mixc(c, [240, 240, 190], 0.35), 0.8); g.beginPath(); g.arc(x - rr * 0.35, yy - rr * 0.35, rr * 0.35, 0, TAU); g.fill(); }
        }
      }
      return cv;
    }
    case 'lande': {
      const base = hexRgb(pal.lande), fl = pal.landeFleurs.map(hexRgb);
      const v = n([[7, 0.07], [1.8, 0.1], [0.45, 0.09], [0.12, 0.06]]);
      const cv = paintBase(size, base, v, fl[0], ramp(n([[3.5, 1], [1, 0.4]]), 0.1, 0.9, snow ? 0.12 : 0.25)), g = cv.getContext('2d');
      if (L >= 2) {   // touffes de bruyère et d'ajonc, ombrées au sud-est
        const count = Math.min(9000, Math.round(size * size / (L * L) * 0.9)), r0 = Math.max(0.6, 0.1 * L), r1 = Math.max(1, 0.28 * L);
        strew(g, size, count, S + 3, [{ fill: 'rgba(40,36,20,0.28)' }], (p, x, y, k) => { const r = r0 + hash(k, 6, S) * (r1 - r0); p.moveTo(x + r * 1.25, y + r * 0.3); p.arc(x + r * 0.25, y + r * 0.3, r, 0, TAU); });
        strew(g, size, count, S + 3, [...fl, mul(base, 0.75)].map(c => ({ fill: css(mixc(snow ? mixc(c, [240, 244, 248], 0.5) : c, base, 0.3), 0.85) })), dot(r0, r1, S));
      }
      return cv;
    }
    case 'marais': {
      const base = hexRgb(pal.marais), v = n([[6, 0.06], [1.2, 0.08], [0.3, 0.06]]);
      const wet = snow ? [214, 226, 236] : [96, 128, 140];
      const cv = paintBase(size, base, v, wet, ramp(n([[5, 1], [1.4, 0.5]]), 0.25, 0.6, 0.85)), g = cv.getContext('2d');
      if (L >= 2) strew(g, size, Math.min(7000, Math.round(size * size / (L * L) * 1.2)), S, [{ stroke: snow ? 'rgba(120,110,90,0.6)' : 'rgba(58,86,40,0.7)', w: Math.max(0.5, 0.04 * L) }, { stroke: snow ? 'rgba(160,150,120,0.5)' : 'rgba(140,150,80,0.6)', w: Math.max(0.5, 0.04 * L) }], blade(L, 0.3, 0.8, S));
      return cv;
    }
    case 'sable': {
      const v = n([[9, 0.04], [2, 0.03], [0.25, 0.04]]);
      rows(v, size, L, 0.9, 0.035, p => Math.sin(p * TAU) ** 3);   // rides du vent
      return paintBase(size, hexRgb(pal.sable), v);
    }
    case 'roche': {
      const v = n([[6, 0.1], [1.6, 0.12], [0.4, 0.1], [0.1, 0.06]]);
      const cv = paintBase(size, hexRgb(pal.roche), v, hexRgb(pal.rocheSombre), ramp(n([[2.5, 1]]), 0.3, 0.8, 0.6)), g = cv.getContext('2d');
      if (fine) strew(g, size, Math.round(size * size / (L * L) * 0.05), S, [{ stroke: 'rgba(60,56,48,0.45)', w: Math.max(0.6, 0.04 * L) }], (p, x, y, k) => { p.moveTo(x, y); let a = hash(k, 7, S) * TAU, xx = x, yy = y; for (let q = 0; q < 4; q++) { a += (hash(k, q, S + 1) - 0.5) * 1.6; xx += Math.cos(a) * 0.5 * L; yy += Math.sin(a) * 0.5 * L; p.lineTo(xx, yy); } }, 2.2 * L);
      return cv;
    }
    case 'sousBois': {
      const base = hexRgb(pal.sousBois), v = n([[5, 0.12], [1.2, 0.12], [0.3, 0.1]]);
      const cv = paintBase(size, base, v, snow ? [226, 230, 232] : [104, 88, 56], ramp(n([[3, 1]]), 0, 0.8, 0.5)), g = cv.getContext('2d');
      if (fine) strew(g, size, Math.round(size * size / (L * L) * 0.6), S, [{ fill: snow ? 'rgba(120,110,95,0.4)' : 'rgba(120,96,52,0.5)' }, { fill: snow ? 'rgba(250,252,255,0.6)' : 'rgba(80,110,50,0.6)' }], dot(0.06 * L, 0.16 * L, S));
      return cv;
    }
    case 'terre': case 'route': {
      const base = hexRgb(kind === 'route' ? pal.route : pal.chemin);
      const v = n([[7, 0.05], [1.8, 0.06], [0.4, 0.07], [0.1, 0.07]]);
      const cv = paintBase(size, base, v, mul(base, 0.82), ramp(n([[3, 1]]), 0.2, 0.9, 0.55)), g = cv.getContext('2d');
      if (fine) {   // gravier et cailloux, avec leur ombre
        const count = Math.round(size * size / (L * L) * (kind === 'route' ? 3 : 1.2)), r0 = 0.02 * L, r1 = (tres ? 0.07 : 0.05) * L;
        strew(g, size, count, S, [{ fill: css(mul(base, 0.6), 0.5) }], (p, x, y, k) => { const r = r0 + hash(k, 6, S) * (r1 - r0); p.moveTo(x + r * 1.3, y + r * 0.3); p.arc(x + r * 0.3, y + r * 0.3, r, 0, TAU); });
        strew(g, size, count, S, [{ fill: css(mul(base, 1.12)) }, { fill: css(mixc(base, [150, 150, 150], 0.5)) }], dot(r0, r1, S));
      }
      return cv;
    }
    case 'eau': {
      const v = n([[12, 0.04], [3, 0.04], [0.8, 0.03]]);
      rows(v, size, L, 1.6, 0.03);
      const cv = paintBase(size, hexRgb(pal.eau), v), g = cv.getContext('2d');
      if (L >= 2) strew(g, size, Math.round(size * size / (L * L) * 0.03), S, [{ stroke: 'rgba(235,245,255,0.35)', w: Math.max(0.6, 0.06 * L) }], (p, x, y, k) => { const l = (0.6 + hash(k, 4, S) * 1.4) * L; p.moveTo(x, y); p.quadraticCurveTo(x + l / 2, y - 0.08 * L, x + l, y); });
      return cv;
    }
    case 'cour': {   // sol des villages et des cours : terre battue, pavés de près
      const base = hexRgb(pal.bati), v = n([[5, 0.05], [1, 0.06], [0.25, 0.05]]);
      const cv = paintBase(size, base, v), g = cv.getContext('2d');
      if (tres && !snow) {
        const st = 0.4 * L;
        g.strokeStyle = css(mul(base, 0.72), 0.55); g.lineWidth = Math.max(0.6, 0.04 * L);
        for (let y = 0; y < size; y += st) for (let x = ((y / st) % 2) * st / 2; x < size; x += st) { g.beginPath(); g.roundRect(x, y, st * 0.92, st * 0.9, st * 0.3); g.stroke(); }
      }
      return cv;
    }
  }
  return paintBase(size, hexRgb(pal.pre[0]), n([[4, 0.05]]));
}
// neige : touffes qui percent et scintillement de près
function neigeDetails(g, size, L, S) {
  if (L >= 4) strew(g, size, Math.round(size * size / 500), S, [{ stroke: 'rgba(110,104,84,0.5)', w: Math.max(0.5, 0.03 * L) }], blade(L, 0.08, 0.2, S));
  if (L >= 8) strew(g, size, Math.round(size * size / 260), S + 1, [{ fill: 'rgba(255,255,255,0.95)' }, { fill: 'rgba(190,206,228,0.5)' }], dot(0.015 * L, 0.03 * L, S));
}
// épis en relief (relief.js) : hauteur (m) et couleur des pieds de chaque culture ; le reste est à ras du sol
export const EPIS = { ble: [1.0, '#c9a54f'], avoine: [0.85, '#a7b865'], bleVert: [0.6, '#86ab4e'], mais: [1.3, '#4c762e'], chaume: [0.2, '#cfbd88'], prairie: [0.4, null],
  herbe: [0.35, null], lande: [0.4, null] };   // (prés et landes : couleur prise dans la palette de la saison)
// cultures : rangs le long de x
const CROP = {
  ble: { base: '#c9a54f', alt: '#a98a43', rows: 0.3, band: 3.2 },
  bleVert: { base: '#86ab4e', alt: '#a3bd60', rows: 0.22, band: 2.8 },
  avoine: { base: '#a7b865', alt: '#bdc274', rows: 0.22, band: 2.4 },
  chaume: { base: '#cfbd88', alt: '#b9a571', rows: 0.24, band: 1.9 },
  semis: { base: '#8f6c48', alt: '#7c8c4a', rows: 0.7, band: 6 },
  labour: { base: '#8c6a47', alt: '#74573a', rows: 0.75, band: 9 },
  mais: { base: '#a0805a', alt: '#8e7050', rows: 0.8, band: 7 },
};
function crop(kind, size, L, pal, season, S, n) {
  const C = CROP[kind], snow = !!pal.neige;
  let base = hexRgb(C.base), alt = hexRgb(C.alt);
  if (snow) { base = hexRgb(pal.champ[0][0]); alt = [214, 222, 232]; }
  if (kind === 'mais' && season === 'automne') { base = [176, 150, 98]; alt = [160, 132, 84]; }
  const v = n([[14, 0.05], [3.5, 0.04], [0.9, 0.05], [0.22, 0.07]]);
  rows(v, size, L, C.band, kind === 'labour' || kind === 'semis' ? 0.03 : 0.05);
  // sillons : crête claire, creux sombre (la neige reste dans les creux)
  const furrow = kind === 'labour' || kind === 'semis';
  if (furrow) rows(v, size, L, C.rows, snow ? 0.07 : 0.17, p => (p < 0.5 ? 1 - 4 * Math.abs(p - 0.25) : -1 + 4 * Math.abs(p - 0.75)) * (snow ? -1 : 1));
  else if (C.rows * L >= 2) rows(v, size, L, C.rows, 0.06);
  const cv = paintBase(size, base, v, alt, ramp(n([[10, 1], [2.5, 0.5]]), -0.2, 1, 0.7)), g = cv.getContext('2d');
  if (snow) { neigeDetails(g, size, L, S); return cv; }
  const nr = Math.max(1, Math.round(size / (C.rows * L))), sp = size / nr;
  if (kind === 'mais' && L < 4) {
    const leaf = season === 'automne' ? [196, 170, 100] : [76, 118, 46];
    g.fillStyle = css(leaf, 0.75); for (let r = 0; r < nr; r++) g.fillRect(0, (r + 0.2) * sp, size, sp * 0.55);
  } else if (kind === 'mais') {
    // pieds de maïs en rangs : touffes de feuilles en étoile
    const leaf = season === 'automne' ? [196, 170, 100] : [76, 118, 46];
    g.fillStyle = css(mul(base, 0.7), 0.6); for (let r = 0; r < nr; r++) g.fillRect(0, (r + 0.5) * sp, size, 0.25 * L);
    const step = size / Math.round(size / (0.28 * L));
    g.lineWidth = Math.max(0.6, 0.07 * L); g.lineCap = 'round';
    for (let r = 0; r < nr; r++) for (let x = 0; x < size; x += step) {
      const q = r * 4099 + x | 0, cy = (r + 0.5) * sp, R = (0.22 + hash(q, 2, S) * 0.1) * L;
      g.strokeStyle = css(mixc(leaf, mul(leaf, 0.75), hash(q, 3, S)));
      g.beginPath();
      for (const cx of [x, x - size]) for (let a = 0; a < 5; a++) { const an = hash(q, 4 + a, S) * TAU; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R * 0.8); }
      g.stroke();
    }
  } else if (kind === 'semis' && L >= 2) {
    g.fillStyle = 'rgba(120,150,70,0.55)'; for (let r = 0; r < nr; r++) g.fillRect(0, (r + 0.25) * sp, size, Math.max(0.6, 0.06 * L));
  }
  if (L >= 4 && (kind === 'ble' || kind === 'bleVert' || kind === 'avoine' || kind === 'chaume')) {
    // épis et tiges : marques courtes, claires au sommet, sombres entre les pieds
    const lite = kind === 'ble' ? [236, 210, 138] : kind === 'chaume' ? [238, 226, 184] : mixc(base, [230, 240, 160], 0.4);
    const dark = mul(base, kind === 'chaume' ? 0.72 : 0.62), w = Math.max(0.6, 0.03 * L);
    strew(g, size, Math.min(12000, size * size / (L >= 8 ? 22 : 34)), S + 5, [{ stroke: css(dark, 0.5), w }, { stroke: css(lite, 0.6), w }, { stroke: css(mixc(lite, base, 0.5), 0.5), w }], blade(L, 0.06, kind === 'chaume' ? 0.1 : 0.18, S));
  }
  return cv;
}

// ------------------------------------------------------------------ arbres
// kind : 'feuillu' | 'buisson' | 'peuplier' | 'sapin' | 'parasol' | 'nu' ; col : couleur du feuillage ; px : rayon de la
// couronne en pixels pour un arbre de 8 m de rayon (la tuile met à l'échelle) ; renvoie {cv, cx, cy, px} : le
// ombre douce (ellipse floue), pour les arbres et les meules
export function softShadow() {
  const s = 64, cv = canvas(s, s), g = cv.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return cv;
}
