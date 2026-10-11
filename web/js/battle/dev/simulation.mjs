// Maquette du moteur tactique, pour développer la vue de bataille sans le serveur Python.
// Génère une carte de bataille (relief, bois, champs, vignes, routes, rivière, village ou place forte) et fait
// bouger et tirer des unités. Rien ici n'est le vrai moteur : seulement de quoi tester le rendu et les commandes.
// Les réponses suivent le contrat commun (/api/tactic_map, /api/tactic, cmd 'tac').
import { T, emprise, clsOf, pieces, hash, clamp, wrapAngle, TAU } from '../formes.js';

const W = 3000, H = 2000, CELL = 20, COLS = 150, ROWS = 100;
const SPEED = { inf: 1.2, legere: 1.4, cavalerie: 2.5, artillerie: 1.5, general: 2.5 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, s, oct = 4) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { v += vnoise(x * f, y * f, s + o * 17) * a; n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function lineDist(px, py, pts) {
  let d = 1e9;
  for (let k = 1; k < pts.length; k++) d = Math.min(d, segDist(px, py, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]));
  return d;
}
const b64 = u8 => Buffer.from(u8).toString('base64');

export const SCENARIOS = {
  bocage: { name: 'Bataille de Saint-Aulaye', relief: 30, season: 'printemps', weather: 'nuages', camp: [93, 74] },
  landes: { name: 'Combat de Sabres', relief: 7, season: 'ete', weather: 'canicule', camp: [70, 150] },
  vignes: { name: 'Bataille de Castillon', relief: 30, season: 'automne', weather: 'pluie', camp: [86, 96] },
  montagne: { name: 'Combat du col d’Ispéguy', relief: 80, season: 'hiver', weather: 'neige', camp: [62, 262] },
  assaut: { name: 'Assaut de Blaye', relief: 12, season: 'ete', weather: 'soleil', camp: [72, 74], place: 'Blaye' },
};

// ------------------------------------------------------------------ carte
function genMap(scen, seed) {
  const R = rng(seed), S = SCENARIOS[scen] || SCENARIOS.bocage;
  const t = new Uint8Array(COLS * ROWS), hf = new Float32Array(COLS * ROWS);
  const idx = (i, j) => j * COLS + i;
  const cx = i => i * CELL + CELL / 2, cy = j => j * CELL + CELL / 2;
  const s = seed % 9973;
  // relief
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    const x = i / 32, y = j / 32;
    let h = fbm(x, y, s, 5);
    if (scen === 'montagne') {
      const vy = 1000 + 260 * Math.sin(cx(i) / 700 + 0.6);   // vallée sinueuse d'ouest en est
      const dv = Math.abs(cy(j) - vy);
      const ridge = 1 - Math.abs(2 * fbm(x * 1.4, y * 1.4, s + 5, 4) - 1);
      h = smooth(80, 760, dv) * (0.55 + ridge * 0.55) + h * 0.12;
    } else if (scen === 'vignes') {
      h = h * 0.75 + smooth(1500, 300, Math.abs(cy(j) - 760)) * 0.35 - smooth(1500, 1950, cy(j)) * 0.35;
    } else if (scen === 'bocage') {
      h = h * 0.9 + smooth(2400, 1800, cx(i)) * 0.15 * smooth(300, 900, cy(j));
    }
    hf[idx(i, j)] = Math.max(0, h);
  }
  let lo = 1e9, hi = -1e9;
  for (const v of hf) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const h = new Uint8Array(COLS * ROWS);
  for (let c = 0; c < h.length; c++) h[c] = Math.round((hf[c] - lo) / (hi - lo || 1) * S.relief);
  // parcelles (Voronoï sur une grille irrégulière de 6 cases)
  const P = 6, pc = Math.ceil(COLS / P) + 1, pr = Math.ceil(ROWS / P) + 1, seeds = [];
  for (let b = 0; b < pr; b++) for (let a = 0; a < pc; a++) seeds.push([(a + 0.15 + R() * 0.7) * P, (b + 0.15 + R() * 0.7) * P, R()]);
  const parcel = new Int32Array(COLS * ROWS);
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    const a0 = Math.floor(i / P), b0 = Math.floor(j / P);
    let best = 1e9, bi = 0;
    for (let b = b0 - 1; b <= b0 + 1; b++) for (let a = a0 - 1; a <= a0 + 1; a++) {
      if (a < 0 || b < 0 || a >= pc || b >= pr) continue;
      const k = b * pc + a, d = (seeds[k][0] - i) ** 2 + (seeds[k][1] - j) ** 2;
      if (d < best) { best = d; bi = k; }
    }
    parcel[idx(i, j)] = bi;
  }
  const crop = (weights, r) => { let acc = 0; for (const [k, w] of weights) { acc += w; if (r < acc) return k; } return weights[0][0]; };
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    const c = idx(i, j), pr0 = seeds[parcel[c]][2], x = i / 18, y = j / 18;
    const wood = fbm(x, y, s + 31, 4), wet = fbm(x * 0.8, y * 0.8, s + 47, 3), hh = h[c] / Math.max(1, S.relief);
    let v = T.PRE;
    if (scen === 'bocage') {
      v = crop([[T.PRE, 0.42], [T.CHAMP, 0.48], [T.LANDE, 0.1]], pr0);
      if (wood > 0.66) v = wood > 0.74 ? T.FORET : T.BOIS;
    } else if (scen === 'landes') {
      v = T.LANDE;
      if (wood > 0.52) v = T.FORET; else if (wood > 0.47) v = T.BOIS;
      if (wet > 0.6 && hh < 0.5) v = T.MARAIS;
      if (fbm(x * 1.6, y * 1.6, s + 61, 3) > 0.72) v = T.SABLE;
    } else if (scen === 'vignes') {
      v = hh > 0.38 ? crop([[T.VIGNE, 0.72], [T.CHAMP, 0.14], [T.PRE, 0.14]], pr0) : crop([[T.PRE, 0.5], [T.CHAMP, 0.4], [T.VIGNE, 0.1]], pr0);
      if (wood > 0.7) v = T.BOIS;
    } else if (scen === 'montagne') {
      v = hh > 0.88 ? T.ROCHE : hh > 0.45 ? (wood > 0.42 ? T.FORET : T.LANDE) : hh > 0.25 ? (wood > 0.55 ? T.BOIS : T.PRE) : crop([[T.PRE, 0.7], [T.CHAMP, 0.3]], pr0);
      if (hh > 0.74 && fbm(x * 2, y * 2, s + 71, 3) > 0.66) v = T.ROCHE;
    } else if (scen === 'assaut') {
      v = crop([[T.CHAMP, 0.45], [T.PRE, 0.4], [T.VIGNE, 0.15]], pr0);
      if (wood > 0.72) v = T.BOIS;
    }
    t[c] = v;
  }
  // haies du bocage : arbres le long de certaines limites de parcelles
  if (scen === 'bocage' || scen === 'vignes') {
    const hedge = new Uint8Array(COLS * ROWS);
    for (let j = 1; j < ROWS - 1; j++) for (let i = 1; i < COLS - 1; i++) {
      const c = idx(i, j), p = parcel[c];
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const q = parcel[idx(i + di, j + dj)];
        if (q !== p && hash(Math.min(p, q), Math.max(p, q), 5) < (scen === 'bocage' ? 0.3 : 0.12)) hedge[c] = 1;
      }
    }
    for (let c = 0; c < hedge.length; c++) if (hedge[c] && t[c] !== T.FORET) t[c] = T.BOIS;
  }
  // mares et étang
  const ponds = scen === 'landes' ? 4 : scen === 'montagne' ? 0 : 2;
  for (let k = 0; k < ponds; k++) {
    const pi = 20 + R() * 110, pj = 12 + R() * 76, rr = (scen === 'landes' && !k ? 7 : 2) + R() * 2;
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const d = Math.hypot((i - pi) * (1 + 0.3 * Math.sin(j)), j - pj);
      if (d < rr * (0.85 + 0.3 * vnoise(i / 3, j / 3, s + k))) t[idx(i, j)] = T.EAU;
      else if (d < rr + 1.6 && scen === 'landes' && t[idx(i, j)] !== T.EAU) t[idx(i, j)] = T.MARAIS;
    }
  }
  // rivière
  const rivers = [], roads = [], buildings = [], walls = [];
  const curve = (x0, y0, x1, y1, amp, wave, n = 40) => {
    const pts = [], ph = R() * 6;
    for (let k = 0; k <= n; k++) {
      const f = k / n, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
      const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny);
      const off = Math.sin(f * wave + ph) * amp + (fbm(f * 4, ph, s + 3, 3) - 0.5) * amp * 1.4;
      pts.push([Math.round(x + nx / l * off), Math.round(y + ny / l * off)]);
    }
    return pts;
  };
  let river = null;
  if (scen === 'bocage') river = { w: 26, pts: curve(2350, -40, 1650, 2040, 120, 5) };
  else if (scen === 'vignes') river = { w: 110, pts: curve(-40, 1840, 3040, 1760, 60, 3) };
  else if (scen === 'montagne') river = { w: 14, pts: (() => { const p = []; for (let x = -40; x <= 3040; x += 60) p.push([x, Math.round(1000 + 260 * Math.sin(x / 700 + 0.6) + 25 * Math.sin(x / 90))]); return p; })() };
  else if (scen === 'assaut') river = { w: 140, pts: curve(-40, 330, 3040, 380, 40, 2) };
  else if (scen === 'landes') river = { w: 12, pts: curve(900, -40, 1300, 2040, 160, 7) };
  if (river) {
    rivers.push(river);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const d = lineDist(cx(i), cy(j), river.pts);
      if (d < river.w / 2 + 6) t[idx(i, j)] = T.EAU;
      else if (d < river.w / 2 + 30 && (scen === 'bocage' || scen === 'landes') && t[idx(i, j)] === T.PRE && hash(i, j, 9) < 0.5) t[idx(i, j)] = T.MARAIS;
    }
    if (scen === 'vignes' || scen === 'assaut') rivers.push({ w: 9, pts: curve(2500, 2040, 2350, river.pts[30][1] + 20, 80, 4, 20) });
  }
  // routes
  const raster = (pts, w, v, keepWater = true) => {
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const c = idx(i, j);
      if (lineDist(cx(i), cy(j), pts) < w) {
        if (t[c] === T.EAU) { if (keepWater) t[c] = T.GUE; }
        else if (t[c] !== T.BATI && t[c] !== T.MUR) t[c] = v;
      }
    }
  };
  let village = null;
  if (scen === 'bocage') { roads.push(curve(-40, 820, 3040, 1180, 90, 3)); village = [1980, 1020]; }
  if (scen === 'landes') { roads.push(curve(-40, 1300, 3040, 900, 50, 2)); village = [2050, 1010]; }
  if (scen === 'vignes') { roads.push(curve(-40, 1500, 3040, 1350, 70, 3)); roads.push(curve(1600, 1430, 1750, -40, 60, 3, 25)); village = [1680, 1240]; }
  if (scen === 'montagne') { const p = []; for (let x = -40; x <= 3040; x += 60) p.push([x, Math.round(1000 + 260 * Math.sin(x / 700 + 0.6) + 60)]); roads.push(p); village = [1900, 1000 + 260 * Math.sin(1900 / 700 + 0.6) + 120]; }
  if (scen === 'assaut') { roads.push(curve(-40, 1020, 3040, 1000, 30, 2)); roads.push(curve(1600, 2040, 1600, 600, 30, 2, 20)); }
  for (const r of roads) raster(r, 7, T.ROUTE);
  // chemins (seulement dans la grille : le client les relie lui-même)
  const nch = scen === 'montagne' ? 2 : 4;
  for (let k = 0; k < nch; k++) {
    const a = [R() * W, R() < 0.5 ? -20 : H + 20], b = [R() * W, (R() * 0.6 + 0.2) * H];
    raster(curve(a[0], a[1], b[0], b[1], 60, 4, 30), 5, T.CHEMIN);
  }
  const addB = (x, y, w, hh, a, kind) => {
    buildings.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh), a: +a.toFixed(3), kind });
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let u = -w / 2; u <= w / 2; u += 6) for (let v = -hh / 2; v <= hh / 2; v += 6) {
      const i = Math.floor((x + u * ca - v * sa) / CELL), j = Math.floor((y + u * sa + v * ca) / CELL);
      if (i >= 0 && j >= 0 && i < COLS && j < ROWS) t[idx(i, j)] = T.BATI;
    }
  };
  const roadDir = (pts, x, y) => {
    let best = 1e9, a = 0;
    for (let k = 1; k < pts.length; k++) {
      const d = segDist(x, y, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      if (d < best) { best = d; a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]); }
    }
    return a;
  };
  // village : maisons le long de la route, église et enclos du cimetière
  if (village) {
    const road = roads[roads.length > 1 && scen === 'vignes' ? 0 : 0];
    let k = 0;
    for (let k2 = 1; k2 < road.length; k2++) {
      const [ax, ay] = road[k2 - 1], [bx, by] = road[k2], L = Math.hypot(bx - ax, by - ay), a = Math.atan2(by - ay, bx - ax);
      for (let u = 0; u < L; u += 17) {
        const x = ax + (bx - ax) * u / L, y = ay + (by - ay) * u / L;
        const dv = Math.hypot(x - village[0], y - village[1]);
        if (dv > 260) continue;
        for (const side of [-1, 1]) {
          if (hash(k++, 3, seed) < 0.18 + dv / 400) continue;
          const off = 15 + hash(k, 4, seed) * 6, nx = -Math.sin(a) * side, ny = Math.cos(a) * side;
          addB(x + nx * off, y + ny * off, 12 + hash(k, 5, seed) * 6, 8 + hash(k, 6, seed) * 3, a, 'maison');
        }
      }
    }
    const a = roadDir(road, village[0], village[1]);
    const ex = village[0] - Math.sin(a) * 48, ey = village[1] + Math.cos(a) * 48;
    addB(ex, ey, 30, 12, a, 'eglise');
    const ca = Math.cos(a), sa = Math.sin(a), rect = [];
    for (const [u, v] of [[-26, -14], [26, -14], [26, 22], [-26, 22], [-26, -14]]) rect.push([Math.round(ex + u * ca - v * sa), Math.round(ey + u * sa + v * ca)]);
    walls.push({ kind: 'mur', pts: rect, breach: [] });
    // moulin sur la hauteur la plus proche
    let best = -1, bc = 0;
    for (let c = 0; c < h.length; c++) {
      const i = c % COLS, j = (c / COLS) | 0;
      if (Math.hypot(cx(i) - village[0], cy(j) - village[1]) < 700 && t[c] !== T.EAU && h[c] > best) { best = h[c]; bc = c; }
    }
    if (scen !== 'montagne') addB(cx(bc % COLS), cy((bc / COLS) | 0), 9, 9, 0.4, 'moulin');
  }
  // fermes isolées, avec un mur de cour
  const nf = scen === 'assaut' ? 3 : 6;
  for (let k = 0, tries = 0; k < nf && tries < 400; tries++) {
    const i = 5 + Math.floor(R() * (COLS - 10)), j = 5 + Math.floor(R() * (ROWS - 10)), c = idx(i, j);
    if (![T.PRE, T.CHAMP, T.LANDE, T.VIGNE].includes(t[c])) continue;
    if (scen === 'assaut' && Math.hypot(cx(i) - 1600, cy(j) - 1000) < 520) continue;
    const a = R() * Math.PI;
    addB(cx(i), cy(j), 24, 10, a, 'ferme');
    addB(cx(i) + Math.cos(a + 1.57) * 16 + Math.cos(a) * 8, cy(j) + Math.sin(a + 1.57) * 16 + Math.sin(a) * 8, 10, 14, a, 'ferme');
    k++;
  }
  // place forte : rues, maisons, enceinte bastionnée avec brèche et portes, ouvrages de siège
  let place = null;
  if (scen === 'assaut') {
    const X = 1600, Y = 1000, Rr = 280;
    place = { name: S.place, x: X, y: Y };
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const d = Math.hypot(cx(i) - X, cy(j) - Y);
      if (d < Rr + 60 && t[idx(i, j)] !== T.EAU) t[idx(i, j)] = T.PRE;   // glacis
    }
    for (let gy = -230; gy <= 230; gy += 46) for (let gx = -230; gx <= 230; gx += 46) {
      if (Math.hypot(gx, gy) > 225) continue;
      if (Math.abs(gx) < 20 && Math.abs(gy) < 20) { addB(X + 6, Y - 18, 36, 14, 0, 'eglise'); continue; }
      if (Math.abs(gy) < 12 || Math.abs(gx) < 12) continue;   // grand-rues
      for (const [dx, dy, w, hh] of [[-9, -9, 16, 13], [9, -9, 14, 13], [-9, 9, 15, 12], [9, 9, 16, 12]]) {
        if (hash(gx + dx, gy + dy, 1) < 0.12) continue;
        addB(X + gx + dx, Y + gy + dy, w, hh, (hash(gx, gy, 2) < 0.5 ? 0 : Math.PI / 2), 'maison');
      }
    }
    const trace = [], n = 6;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + Math.PI / n;
      const P2 = (ang, rad) => [Math.round(X + Math.cos(ang) * rad), Math.round(Y + Math.sin(ang) * rad)];
      trace.push(P2(a - 0.2, Rr * 0.93), P2(a - 0.17, Rr), P2(a, Rr * 1.2), P2(a + 0.17, Rr), P2(a + 0.2, Rr * 0.93));
    }
    trace.push(trace[0]);
    const breachAng = Math.PI, bx = X + Math.cos(breachAng) * Rr * 0.88, by = Y + Math.sin(breachAng) * Rr * 0.88;
    walls.push({ kind: 'rempart', pts: trace, breach: [[Math.round(bx), Math.round(by), 26]] });
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + Math.PI / n;
      const P2 = (ang, rad) => [Math.round(X + Math.cos(ang) * rad), Math.round(Y + Math.sin(ang) * rad)];
      walls.push({ kind: 'bastion', pts: [P2(a - 0.2, Rr * 0.93), P2(a - 0.17, Rr), P2(a, Rr * 1.2), P2(a + 0.17, Rr), P2(a + 0.2, Rr * 0.93), P2(a, Rr * 0.86), P2(a - 0.2, Rr * 0.93)], breach: [] });
    }
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const c = idx(i, j), x = cx(i), y = cy(j);
      if (lineDist(x, y, trace) < 12) t[c] = t[c] === T.ROUTE ? T.PORTE : T.MUR;
      if (Math.hypot(x - bx, y - by) < 26) t[c] = T.BRECHE;
    }
    // tranchées de l'assiégeant : deux parallèles devant le front d'attaque, reliées par un boyau en zigzag
    for (const [r, span] of [[470, 0.2], [600, 0.26]]) {
      const pts = [];
      for (let a = Math.PI - span; a <= Math.PI + span + 1e-6; a += span / 6) pts.push([Math.round(X + Math.cos(a) * r), Math.round(Y + Math.sin(a) * r)]);
      walls.push({ kind: 'barricade', pts, breach: [] });
    }
    walls.push({ kind: 'barricade', pts: [[X - 600, Y + 30], [X - 570, Y - 25], [X - 530, Y + 25], [X - 500, Y - 20], [X - 470, Y + 10]], breach: [] });
    walls.push({ kind: 'barricade', pts: [[X + 360, Y - 30], [X + 372, Y + 34]], breach: [] });
  }
  return {
    W, H, cell: CELL, cols: COLS, rows: ROWS, t: b64(t), h: b64(h), roads, rivers, buildings, walls, place, seed,
    season: S.season, weather: S.weather, camp: { x: S.camp[0], y: S.camp[1] }, _t: t, _h: h,
  };
}

// ------------------------------------------------------------------ unités
const ORD = n => n === 1 ? '1er' : n + 'e';
const RANGES = { inf: [120, 230], legere: [130, 250], cavalerie: [30, 30], artillerie: [700, 1100, 300], general: [0, 0] };
function mkUnit(id, side, type, name, men, x, y, dir, extra = {}) {
  const cls = type === 'cavalerie' ? 'cavalerie' : type === 'artillerie' ? 'artillerie' : type === 'general' ? 'general' : 'inf';
  const light = type === 'legere' || type === 'chasseurs';
  const form = cls === 'artillerie' ? 'batterie' : light ? 'tirailleurs' : 'ligne';
  const ammo0 = cls === 'artillerie' ? 120 : cls === 'cavalerie' ? 20 : 60;
  const range = (RANGES[light ? 'legere' : cls] || RANGES.inf).slice();
  const u = { id, side, owner: side ? '24' : '33', type, cls, light, name, men, men0: men, x, y, dir, form, state: 'repos',
    morale: 70 + Math.round(hash(id.length, side, men) * 25), fat: Math.round(hash(men, 3) * 25), xp: Math.round(hash(men, 7, id.length) * 90),
    ammo: ammo0, ammo0, range, seen: false, target: null, fire: 'free', reload: 0, order: null, ...extra };
  if (type === 'milice') { u.morale = 50; u.xp = 5; }
  return u;
}
function genUnits(scen, map, R) {
  const units = [], t = map._t;
  const at = (x, y) => t[clamp(Math.floor(y / CELL), 0, ROWS - 1) * COLS + clamp(Math.floor(x / CELL), 0, COLS - 1)];
  const free = (x, y) => ![T.EAU, T.MUR, T.BATI].includes(at(x, y));
  // camp du joueur (0, assaillant) à l'ouest ; l'ennemi en face, ou dans la place
  const mine = [['ligne', 8], ['legere', 3], ['grenadiers', 1], ['cavalerie', 3], ['artillerie', 3], ['general', 1]];
  const theirs = scen === 'assaut'
    ? [['milice', 5], ['ligne', 5], ['artillerie', 3], ['grenadiers', 1], ['cavalerie', 1], ['general', 1]]
    : [['ligne', 7], ['legere', 3], ['chasseurs', 1], ['cavalerie', 3], ['artillerie', 3], ['general', 1]];
  let n = 0;
  const names = { ligne: k => `${ORD(k)} de ligne`, legere: k => `${ORD(k)} léger`, grenadiers: () => 'Grenadiers réunis', chasseurs: k => `${ORD(k)} chasseurs basques`,
    cavalerie: k => [`${ORD(k)} hussards`, `${ORD(k)} dragons`, `${ORD(k)} chasseurs à cheval`][k % 3], artillerie: k => `Batterie ${['Lamarque', 'Duroc', 'Sénarmont', 'Drouot'][k % 4]}`,
    general: () => 'État-major', milice: k => `Milice ${['de la ville', 'du faubourg', 'des quais', 'de Saint-Romain', 'bourgeoise'][k % 5]}` };
  const MEN = { ligne: 600, legere: 420, grenadiers: 380, chasseurs: 300, cavalerie: 300, artillerie: 160, general: 30, milice: 250 };
  const zone = [80, 160, 520, 1840];
  // ordre de bataille : tirailleurs devant, première et seconde lignes, batteries dans les intervalles,
  // cavalerie aux ailes, général en arrière au centre (côté ennemi : en miroir, vers l'est)
  const place = (side, list) => {
    const out = [];
    const X = x => side === 0 ? x : 2550 - (x - 80) * 0.9;
    const slots = { skirm: [], front: [], second: [], art: [], cav: [], gen: [] };
    for (const [type, cnt] of list) for (let q = 0; q < cnt; q++) {
      const k = type === 'legere' || type === 'chasseurs' ? 'skirm' : type === 'artillerie' ? 'art' : type === 'cavalerie' ? 'cav' : type === 'general' ? 'gen' : 'front';
      slots[k].push([type, q]);
    }
    while (slots.front.length > 5) slots.second.unshift(slots.front.pop());
    const lineX = { skirm: 495, front: 420, art: 455, second: 280, cav: 200, gen: 170 };
    for (const [k, arr] of Object.entries(slots)) {
      arr.forEach(([type, q], i) => {
        let y;
        if (k === 'cav') y = i % 2 ? 1640 - (i >> 1) * 260 : 360 + (i >> 1) * 260;
        else if (k === 'gen') y = 1000;
        else if (k === 'art') y = 320 + (i + 0.5) * 1360 / arr.length + 70;
        else y = 300 + (i + 0.5) * 1400 / arr.length;
        let x = X(lineX[k]) + (R() - 0.5) * 16, dir = side === 0 ? 0 : Math.PI;
        if (scen === 'assaut' && side === 1) {
          if (type === 'artillerie') { const a = Math.PI * (0.83 + q * 0.17); x = 1600 + Math.cos(a) * 300; y = 1000 + Math.sin(a) * 300; dir = a; }
          else if (type === 'milice' || type === 'grenadiers') { const a = Math.PI * (0.75 + q * 0.12); x = 1600 + Math.cos(a) * 230; y = 1000 + Math.sin(a) * 230; dir = a; }
          else { x = 1480 + (q % 3) * 80 + R() * 20; y = 860 + q * 70; }
        }
        if (side === 0) { x = clamp(x, zone[0] + 20, zone[2] - 20); y = clamp(y, zone[1] + 30, zone[3] - 30); }
        for (let tries = 0; tries < 30 && !free(x, y); tries++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 40; }
        const num = q + 1 + (side && type !== 'artillerie' ? 4 : side ? 2 : 0);
        const u = mkUnit((side ? 'e' : 'r') + (++n), side, type, names[type](num), Math.round(MEN[type] * (0.75 + R() * 0.25)), Math.round(x), Math.round(y), dir);
        if (type === 'milice') u.form = 'ligne';
        if (type === 'general') u.gen = side ? 'Général Lacoste' : 'Général Moreau';
        out.push(u);
      });
    }
    return out;
  };
  units.push(...place(0, mine), ...place(1, theirs));
  return { units, zone };
}

// ------------------------------------------------------------------ bataille
export class MockBattle {
  constructor(bid, opts = {}) {
    const parts = String(bid).split('-');
    this.bid = bid;
    this.scen = SCENARIOS[opts.scen] ? opts.scen : SCENARIOS[parts[0]] ? parts[0] : 'bocage';
    const S = SCENARIOS[this.scen];
    this.seed = strHash(bid);
    this.map = genMap(this.scen, this.seed);
    this.season = opts.season || parts[1] || S.season;
    this.weather = opts.weather || parts[2] || S.weather;
    this.map.season = this.season; this.map.weather = this.weather;
    this.R = rng(this.seed + 1);
    const g = genUnits(this.scen, this.map, this.R);
    this.units = g.units; this.zone = g.zone;
    this.phase = 'deploiement';
    this.speed = 0;
    this.clock = ((+opts.hour || +parts[3] || 8) - 8) * 3600;
    this.seq = 1;
    this.fx = [];
    this.logs = [];
    this.result = null;
    this.wind = [Math.cos(this.seed % 7) * (this.weather === 'tempete' ? 9 : 3), Math.sin(this.seed % 5) * 2];
    this.name = S.name;
    this.aiT = 0;
    // option « proche » : l'ennemi est déjà au contact (pour les captures de combat)
    if (opts.proche) for (const u of this.units) if (u.side === 1 && this.scen !== 'assaut') u.x -= +opts.proche || 1300;
    this.t0 = this.units.reduce((a, u) => (a[u.side] += u.men, a), [0, 0]);
  }
  cellAt(x, y) { return this.map._t[clamp(Math.floor(y / CELL), 0, ROWS - 1) * COLS + clamp(Math.floor(x / CELL), 0, COLS - 1)]; }
  log(txt) { this.logs.push({ seq: ++this.seq, txt }); if (this.logs.length > 200) this.logs.shift(); }
  addFx(f) { f.seq = ++this.seq; f.t = Math.round(this.clock * 10) / 10; this.fx.push(f); if (this.fx.length > 600) this.fx.splice(0, 100); }
  dusk() { return this.season === 'hiver' ? 17 : this.season === 'ete' || this.season === 'été' ? 20.5 : 19; }
  hourF() { return 8 + this.clock / 3600; }
  light() {
    const h = this.hourF(), d = this.dusk();
    return clamp(1 - smooth(d - 2, d + 0.6, h) * 0.75, 0.2, 1) * (h < 8.6 ? 0.85 + (h - 8) * 0.25 : 1);
  }
  viewRange() { return { brouillard: 250, pluie: 600, orage: 600, tempete: 500, neige: 800 }[this.weather] || 1300; }

  // ------------------------------------------------ commandes
  command(b) {
    const sub = b.sub;
    const mineIds = new Set((b.units || []).map(String));
    const sel = this.units.filter(u => u.side === 0 && mineIds.has(String(u.id)) && u.state !== 'hors');
    if (sub === 'choose') return { ok: true, msg: b.mode === 'auto' ? 'Résolution automatique.' : 'Vous prenez le commandement.' };
    if (sub === 'deploy') {
      if (this.phase !== 'deploiement') return { ok: false, msg: 'Le déploiement est terminé.' };
      const [zx0, zy0, zx1, zy1] = this.zone;
      const c = this.centroid(sel);
      for (const u of sel) {
        let x = (b.x ?? c[0]) + (sel.length > 1 ? u.x - c[0] : 0), y = (b.y ?? c[1]) + (sel.length > 1 ? u.y - c[1] : 0);
        if (sel.length > 1 && b.dir != null) {
          const da = b.dir - this.meanDir(sel), ox = u.x - c[0], oy = u.y - c[1];
          x = b.x + ox * Math.cos(da) - oy * Math.sin(da); y = b.y + ox * Math.sin(da) + oy * Math.cos(da);
        }
        u.x = Math.round(clamp(x, zx0, zx1)); u.y = Math.round(clamp(y, zy0, zy1));
        if (b.dir != null) u.dir = sel.length > 1 ? wrapAngle(u.dir + b.dir - this.meanDir(sel)) : b.dir;
        if (b.form) u.form = b.form;
      }
      return { ok: true, msg: '' };
    }
    if (sub === 'start') {
      if (this.phase !== 'deploiement') return { ok: false, msg: 'La bataille est déjà engagée.' };
      this.phase = 'combat'; this.speed = 1;
      this.log('La bataille est engagée. Les tambours battent la charge.');
      return { ok: true, msg: 'La bataille commence.' };
    }
    if (sub === 'speed') { this.speed = [0, 1, 2, 4].includes(+b.v) ? +b.v : 1; return { ok: true, msg: '' }; }
    if (sub === 'withdraw') { this.finish(1, true); return { ok: true, msg: 'Vos troupes décrochent.' }; }
    if (sub === 'autofinish') {
      if (this.phase !== 'combat') return { ok: false, msg: 'Le déploiement n’est pas terminé.' };
      // calcul automatique grossier : effectifs × moral de chaque camp, pertes réparties au prorata
      const force = s => this.units.filter(u => u.side === s && u.state !== 'hors').reduce((a, u) => a + u.men * u.morale * (u.state === 'deroute' ? 0.2 : 1), 0);
      const f0 = force(0), f1 = force(1), k = f0 / (f0 + f1 || 1);
      for (const u of this.units) if (u.state !== 'hors') u.men = Math.round(u.men * (1 - (u.side === 0 ? 1 - k : k) * 0.3));
      this.log('Le reste de la bataille est résolu automatiquement.');
      this.finish(k >= 0.5 ? 0 : 1, k < 0.5);
      return { ok: true, msg: '' };
    }
    if (sub === 'order') {
      const c = this.centroid(sel);
      for (const u of sel) {
        switch (b.kind) {
          case 'move': {
            let x = b.x, y = b.y;
            if (sel.length > 1) {
              const da = b.dir != null ? wrapAngle(b.dir - this.meanDir(sel)) : 0, ox = u.x - c[0], oy = u.y - c[1];
              x += ox * Math.cos(da) - oy * Math.sin(da); y += ox * Math.sin(da) + oy * Math.cos(da);
            }
            u.order = { kind: 'move', x: Math.round(x), y: Math.round(y), dir: b.dir ?? null, run: !!b.run };
            u.target = null; if (u.state !== 'deroute') u.state = 'marche';
            if (u.cls === 'artillerie' && u.form === 'batterie') { u.form = 'attelee'; u.busy = 60; }
            break;
          }
          case 'attack': case 'charge':
            u.order = { kind: b.kind, target: b.target }; u.target = b.target;
            if (b.kind === 'charge') { u.state = 'charge'; this.addFx({ k: 'charge', x: u.x, y: u.y, u: u.id }); this.log(`${u.name} charge !`); }
            break;
          case 'hold': u.order = { kind: 'hold' }; u.state = 'repos'; u.fire = 'free'; break;
          case 'fire': u.fire = b.fire === 'hold' || b.v === 'hold' ? 'hold' : 'free'; break;
          case 'form': if (b.form) { u.form = b.form; u.busy = 30; if (u.state !== 'deroute') u.state = 'repos'; u.order = null; } break;
          case 'rally': if (u.state === 'deroute') { u.state = 'ralliement'; u.morale = Math.max(u.morale, 30); this.log(`${u.name} tente de se rallier.`); } break;
          case 'retreat': u.order = { kind: 'retreat' }; u.state = 'marche'; break;
        }
      }
      return { ok: true, msg: '' };
    }
    return { ok: false, msg: 'Commande inconnue.' };
  }
  centroid(list) { const n = list.length || 1; return [list.reduce((a, u) => a + u.x, 0) / n, list.reduce((a, u) => a + u.y, 0) / n]; }
  meanDir(list) { const sx = list.reduce((a, u) => a + Math.cos(u.dir), 0), sy = list.reduce((a, u) => a + Math.sin(u.dir), 0); return Math.atan2(sy, sx); }

  // ------------------------------------------------ simulation (très simplifiée)
  advance(dtb) {
    if (this.phase !== 'combat') return;
    const step = 1;   // pas d'une seconde de bataille
    for (let s = 0; s < dtb && this.phase === 'combat'; s += step) this.tick(Math.min(step, dtb - s));
  }
  tick(dt) {
    this.clock += dt;
    const alive = this.units.filter(u => u.state !== 'hors');
    const byId = new Map(alive.map(u => [String(u.id), u]));
    const vr = this.viewRange();
    for (const u of alive) {
      const foes = alive.filter(e => e.side !== u.side && e.state !== 'deroute');
      // repérage par le camp adverse
      if (u.side === 1) {
        const inWood = [T.BOIS, T.FORET, T.BATI].includes(this.cellAt(u.x, u.y));
        u.seen = alive.some(m => m.side === 0 && Math.hypot(m.x - u.x, m.y - u.y) < (inWood ? 150 : vr)) || (u.lastFire && this.clock - u.lastFire < 60);
      }
      if (u.busy > 0) { u.busy -= dt; continue; }
      const cls = clsOf(u), terr = this.cellAt(u.x, u.y);
      const slow = terr === T.ROUTE ? 1.1 : [T.BOIS, T.MARAIS, T.VIGNE].includes(terr) ? 0.6 : terr === T.FORET ? 0.45 : 1;
      let sp = (u.light ? SPEED.legere : SPEED[cls] || 1.2) * slow * (1 - u.fat / 250);
      u.fat = clamp(u.fat + (u.state === 'marche' || u.state === 'charge' ? 0.02 : -0.01) * dt, 0, 100);
      if (u.state === 'deroute') {
        const ex = u.side === 0 ? -100 : W + 100;
        this.moveToward(u, ex, u.y + Math.sin(this.clock / 20 + u.x) * 50, sp * 1.6, dt);
        u.morale = Math.min(100, u.morale + 0.08 * dt);
        if (u.x < -40 || u.x > W + 40) { u.state = 'hors'; this.log(`${u.name} a quitté le champ de bataille.`); }
        if (u.morale > 45 && !foes.some(e => Math.hypot(e.x - u.x, e.y - u.y) < 400)) { u.state = 'repos'; u.order = null; this.log(`${u.name} s'est rallié.`); }
        continue;
      }
      if (u.state === 'ralliement') { u.morale += 0.4 * dt; if (u.morale > 40) { u.state = 'repos'; this.log(`${u.name} s'est rallié.`); } continue; }
      const o = u.order;
      let moving = false;
      if (o && o.kind === 'move') {
        if (u.cls === 'artillerie' && u.form !== 'attelee') { u.form = 'attelee'; u.busy = 40; continue; }
        moving = !this.moveToward(u, o.x, o.y, sp * (o.run ? 1.6 : 1), dt);
        if (!moving) {
          if (o.dir != null) u.dir = o.dir;
          u.order = null; u.state = 'repos';
          if (u.cls === 'artillerie') { u.form = 'batterie'; u.busy = 40; }
        } else u.state = 'marche';
      } else if (o && o.kind === 'retreat') {
        moving = true;
        this.moveToward(u, u.side === 0 ? -100 : W + 100, u.y, sp, dt);
        if (u.x < -30 || u.x > W + 30) { u.state = 'hors'; continue; }
      } else if (o && (o.kind === 'attack' || o.kind === 'charge')) {
        const tg = byId.get(String(o.target));
        if (!tg || tg.state === 'hors') { u.order = null; u.target = null; u.state = 'repos'; }
        else {
          const d = Math.hypot(tg.x - u.x, tg.y - u.y);
          if (o.kind === 'charge') {
            const csp = cls === 'cavalerie' ? 7 : 2.5;
            if (d > 20) { this.moveToward(u, tg.x, tg.y, csp * slow, dt); u.state = 'charge'; moving = true; if (cls === 'cavalerie' && this.R() < 0.4) this.addFx({ k: 'fumee', x: u.x, y: u.y, dust: 1 }); }
            else this.melee(u, tg);
          } else {
            const want = (u.range?.[0] || 100) * 0.85;
            if (d > want) { this.moveToward(u, tg.x, tg.y, sp, dt); u.state = 'marche'; moving = true; }
            else { u.dir = Math.atan2(tg.y - u.y, tg.x - u.x); }
          }
        }
      }
      if (u.state === 'melee') { u.meleeT = (u.meleeT || 0) - dt; if (u.meleeT <= 0) u.state = 'repos'; }
      // feu
      u.reload -= dt;
      if (u.reload <= 0 && u.fire !== 'hold' && u.ammo > 0 && cls !== 'general' && !(cls === 'artillerie' && u.form === 'attelee') && (!moving || u.form === 'tirailleurs')) {
        const maxR = cls === 'artillerie' ? u.range[1] : u.range[0] * 1.3;
        let best = null, bd = 1e9;
        for (const e of foes) {
          if (u.side === 0 && !e.seen) continue;
          const d = Math.hypot(e.x - u.x, e.y - u.y);
          if (d < maxR && d < bd && (!u.target || String(e.id) === String(u.target) || d < bd)) { best = e; bd = d; }
        }
        if (u.target && byId.get(String(u.target)) && Math.hypot(byId.get(String(u.target)).x - u.x, byId.get(String(u.target)).y - u.y) < maxR) { best = byId.get(String(u.target)); bd = Math.hypot(best.x - u.x, best.y - u.y); }
        if (best) this.fire(u, best, bd);
      }
      // moral
      if (u.morale < 25 && u.state !== 'deroute' && u.state !== 'hors') {
        u.state = 'deroute'; u.order = null; u.target = null;
        this.addFx({ k: 'deroute', x: u.x, y: u.y, u: u.id });
        this.log(`${u.name} est en déroute !`);
      }
      if (u.men < 15 && u.state !== 'hors') { u.state = 'hors'; this.log(`${u.name} est anéanti.`); }
    }
    // l'ennemi (IA de maquette) : avance vers le joueur, la cavalerie charge les unités ébranlées
    this.aiT -= dt;
    if (this.aiT <= 0) {
      this.aiT = 20;
      const mine = alive.filter(u => u.side === 0 && u.state !== 'hors' && u.state !== 'deroute');
      for (const e of alive.filter(u => u.side === 1 && !u.order && u.state !== 'deroute' && u.state !== 'hors')) {
        let near = null, nd = 1e9;
        for (const m of mine) { const d = Math.hypot(m.x - e.x, m.y - e.y); if (d < nd) { nd = d; near = m; } }
        if (!near) continue;
        if (e.cls === 'cavalerie' && nd < 900 && (near.morale < 55 || near.state === 'marche') && near.form !== 'carre' && this.R() < 0.5) {
          e.order = { kind: 'charge', target: near.id }; e.target = near.id; e.state = 'charge';
          this.addFx({ k: 'charge', x: e.x, y: e.y, u: e.id }); this.log(`La cavalerie ennemie (${e.name}) charge ${near.name} !`);
        } else if (e.cls === 'inf' && this.scen !== 'assaut' && nd < (this.clock > 300 ? 2600 : 1100) && this.R() < 0.4) {
          e.order = { kind: 'attack', target: near.id }; e.target = near.id;
        }
      }
    }
    // fin
    for (const side of [0, 1]) {
      const ok = this.units.some(u => u.side === side && u.state !== 'hors' && u.state !== 'deroute');
      if (!ok) { this.finish(1 - side, false); break; }
    }
    if (this.hourF() > this.dusk() + 0.5) this.finish(1, true);
  }
  moveToward(u, x, y, sp, dt) {
    const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy);
    if (d < 3) return true;
    const st = Math.min(d, sp * dt);
    let nx = u.x + dx / d * st, ny = u.y + dy / d * st;
    const c = this.cellAt(nx, ny);
    if (c === T.EAU || c === T.MUR) { nx = u.x + dy / d * st * 0.7; ny = u.y - dx / d * st * 0.7; }   // contourne grossièrement
    u.x = nx; u.y = ny;
    const want = Math.atan2(dy, dx);
    u.dir = u.dir + wrapAngle(want - u.dir) * Math.min(1, dt * 0.8);
    return false;
  }
  fire(u, e, d) {
    const cls = clsOf(u);
    u.ammo -= 1; u.lastFire = this.clock;
    u.dir = u.dir + wrapAngle(Math.atan2(e.y - u.y, e.x - u.x) - u.dir) * 0.6;
    const cover = [T.BOIS, T.FORET, T.BATI, T.MUR].includes(this.cellAt(e.x, e.y)) ? 0.45 : this.cellAt(e.x, e.y) === T.VIGNE ? 0.75 : 1;
    let loss = 0;
    if (cls === 'artillerie') {
      const grape = u.range[2] && d < u.range[2];
      const p = pieces(u);
      loss = (grape ? 4.5 : 1.2) * p * (e.form === 'colonne' || e.form === 'carre' ? 1.5 : e.form === 'tirailleurs' ? 0.4 : 1) * cover * (0.6 + this.R() * 0.8);
      const sx = e.x + (this.R() - 0.5) * 50, sy = e.y + (this.R() - 0.5) * 40;
      this.addFx({ k: grape ? 'mitraille' : 'canon', x: Math.round(u.x), y: Math.round(u.y), x2: Math.round(sx), y2: Math.round(sy), n: p, u: u.id });
      if (!grape) this.addFx({ k: 'impact', x: Math.round(sx), y: Math.round(sy), n: p });
      u.reload = 35 * (1 - u.xp / 400);
      if (this.R() < 0.03) this.addFx({ k: 'explosion', x: Math.round(e.x), y: Math.round(e.y) });
    } else if (cls === 'cavalerie') {
      return;
    } else {
      const front = { ligne: 1, tirailleurs: 0.6, colonne: 0.25, carre: 0.25 }[u.form] || 1;
      const shooters = u.men * front;
      const pr = clamp(u.range[0] / Math.max(30, d), 0.3, 1.6) * 0.022 * (0.7 + u.xp / 200) * (1 - u.fat / 200);
      loss = shooters * pr * cover * (this.weather === 'pluie' || this.weather === 'orage' ? 0.5 : 1);
      this.addFx({ k: 'salve', x: Math.round(u.x), y: Math.round(u.y), x2: Math.round(e.x), y2: Math.round(e.y), n: Math.round(shooters), u: u.id });
      u.reload = 25 * (1 - u.xp / 300);
    }
    loss = Math.min(e.men, Math.round(loss));
    e.men -= loss;
    e.morale = clamp(e.morale - loss / Math.max(1, e.men + loss) * 120 - 0.6, 0, 100);
    if (u.side === 0 && !u.saidFire) { u.saidFire = true; this.log(`${u.name} ouvre le feu sur ${e.name}.`); }
  }
  melee(u, e) {
    if (u.state !== 'melee') {
      u.state = 'melee'; u.meleeT = 20; e.state = e.state === 'deroute' ? 'deroute' : 'melee'; e.meleeT = 20;
      const sq = e.form === 'carre' && u.cls === 'cavalerie';
      const pu = u.men * (u.morale / 100) * (1 + u.xp / 100) * (u.cls === 'cavalerie' ? (sq ? 0.4 : 2.2) : 1.1);
      const pe = e.men * (e.morale / 100) * (1 + e.xp / 100) * (sq ? 2 : 1);
      const k = pu / (pu + pe);
      const le = Math.round(e.men * 0.25 * k), lu = Math.round(u.men * 0.2 * (1 - k));
      e.men -= le; u.men -= lu;
      e.morale -= 45 * k; u.morale -= 30 * (1 - k);
      this.log(sq ? `${u.name} se brise sur le carré de ${e.name}.` : `${u.name} enfonce ${e.name} !`);
      u.order = null; u.target = null;
    }
  }
  finish(winner, disengage) {
    if (this.phase === 'fin') return;
    this.phase = 'fin'; this.speed = 0;
    const lost = [0, 1].map(s => this.units.filter(u => u.side === s).reduce((a, u) => a + (u.men0 - u.men), 0));
    const win = winner === 0;
    this.result = {
      winner, disengage,
      title: disengage && !win ? 'Repli en bon ordre' : win ? 'Victoire !' : 'Défaite',
      lines: [win ? 'L’ennemi abandonne le terrain et ses blessés.' : disengage ? 'Vos troupes décrochent à la faveur du soir.' : 'Vos régiments refluent en désordre.',
        `Durée du combat : ${Math.round(this.clock / 60)} minutes.`],
      losses: [[lost[0], lost[1]]], prisoners: win ? Math.round(lost[1] * 0.18) : Math.round(lost[0] * 0.1), xp: win ? 8 : 4,
      units: this.units.filter(u => u.side === 0).map(u => ({ id: u.id, name: u.name, lost: u.men0 - u.men, xp: win ? 8 : 4 })),
    };
    this.log(this.result.title);
  }
  hourStr() { const h = this.hourF(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${hh} h ${String(mm).padStart(2, '0')}`; }

  // ------------------------------------------------ lecture
  state(since = 0) {
    const sides = [0, 1].map(s => {
      const us = this.units.filter(u => u.side === s);
      return { owner: s ? '24' : '33', name: s ? 'Périgord' : 'Gironde', color: s ? '#3f6fb5' : '#b8352a',
        men: us.reduce((a, u) => a + (u.state === 'hors' ? 0 : u.men), 0), men0: this.t0[s],
        morale: Math.round(us.reduce((a, u) => a + u.morale * u.men, 0) / Math.max(1, us.reduce((a, u) => a + u.men, 0))),
        routed: us.filter(u => u.state === 'deroute').length };
    });
    const units = this.units.filter(u => u.side === 0 || u.seen || this.phase === 'fin').map(u => {
      const [w, d] = emprise(u);
      return { id: u.id, side: u.side, type: u.type, cls: u.cls, light: u.light, name: u.name, men: u.men, men0: u.men0,
        x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10, dir: Math.round(u.dir * 1000) / 1000, form: u.form, state: u.state,
        morale: Math.round(u.morale), fat: Math.round(u.fat), xp: u.xp, ammo: u.ammo, ammo0: u.ammo0, range: u.range,
        w: Math.round(w), d: Math.round(d), target: u.target, seen: u.side === 0 ? this.units.some(e => e.side === 1 && Math.hypot(e.x - u.x, e.y - u.y) < 900) : true,
        fire: u.fire, order: u.order && u.order.kind === 'move' ? { kind: 'move', x: u.order.x, y: u.order.y, dir: u.order.dir } : u.order ? { kind: u.order.kind, target: u.order.target } : null };
    });
    return {
      bid: this.bid, seq: this.seq, phase: this.phase, speed: this.speed, clock: Math.round(this.clock), hour: this.hourStr(),
      weather: this.weather, season: this.season, light: Math.round(this.light() * 100) / 100, wind: this.wind, me: 0, sides,
      zone: this.phase === 'deploiement' ? this.zone : undefined, units,
      fx: this.fx.filter(f => f.seq > since), log: this.logs.filter(l => l.seq > since).map(l => l.txt),
      title: this.name, place: this.map.place ? this.map.place.name : null,
      result: this.result || undefined,
    };
  }
  mapPayload() { const { _t, _h, ...m } = this.map; return { ...m, bid: this.bid, title: this.name }; }
}
