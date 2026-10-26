// La vie des pays sur la carte de campagne (SPEC-CARTE-2D.md, chantier C), reprise de la maquette
// (web/js/dev/carte/new.js : vieDePres, BATEAUX ; vivante.js : vieDesPays, RELAIS, RADEAUX, PECHE, CARRELETS, SENTIERS,
// TRANSHUMANCES, MARCHES, FOIRES, VOLS, cordouan). Tout est tiré de la carte (même endroit, mêmes gens, mêmes bêtes) et
// animé en temps réel ; la densité des gens suit l'état de la partie (heure, météo, sièges, batailles, famine,
// épidémie, disette), les marchés, foires et brigands aussi. Purement décoratif : rien n'est montré que l'état ne montre.
import {
  C, E, T, RR, OMBRE, BOIS, PAL, SPR, TAU, PEAU, bat, cheminee, charbonniere, stere, charrue, cloture, pietine, coneF,
  cheval as cheval0, cavalier as cavalier0, fantassin as fantassin0, tenue, sombre, clamp, lerp, mod, surChemin, distPoly, ligne, fumee, sprite,
} from './lib.js';
import { AMB, U, Z, LUM, bivouac, meteoEn } from './ambiance.js';
import { carteDe, etatVille, planDe, rayon, S as S_INT, IC } from './villes.js';

const TT = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
export const hash2 = (i, j, k = 0) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const pingpong = (s, L) => { const m = mod(s, 2 * L); return m < L ? m : 2 * L - m; };
const versMonde = (x, y, a, lx, ly, s = 1) => [x + (lx * Math.cos(a) - ly * Math.sin(a)) * U * s, y + (lx * Math.sin(a) + ly * Math.cos(a)) * U * s];
function dansAnneau(r, x, y) { let d = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; } return d; }
const bboxOf = pts => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; };
const longueur = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
// rayon d'une place en km (profilVille de la maquette : R en unités de l'intérieur, 180 par km)
export const rayonPlace = n => rayon(n.pop0 || 700) / S_INT;
const BETES = { printemps: 1, ete: 1, automne: .8, hiver: .25 };   // l'hiver, les bêtes restent à l'étable
// la météo garde les gens chez eux
const METEO_D = { pluie: .6, orage: .35, tempete: .25, neige: .5, brouillard: .8, canicule: .7 };
export const ventDe = k => k === 'tempete' ? 3 : k === 'orage' ? 2.2 : k === 'pluie' ? 1.5 : k === 'brouillard' || k === 'canicule' ? .35 : 1;

// ---------- ce que la vie lit de la carte (preparer, une fois) et de l'état (majEtat, à chaque état qui change)
export const VIE = {
  pret: false, W: 0, H: 0, routes: [], relais: [], radeaux: [], peche: [], parcs: [], tchanquees: [], carrelets: [],
  sentiers: [], transhumances: [], vols: [], ports: [], bateaux: [], moulins: [], saline: new Set(), cordouan: null,
  marches: [], foires: [], brigands: [], foireRoutes: new Set(),
};
let MAP = null, TER = null, ALT = null, CELLNODE = null, NOEUDS = [], XC = -1e9;
let D_ETAT = null, MAL = null, CLE = '';
const PLUS = [];
const ter = (x, y) => { const i = x | 0, j = y | 0; return i >= 0 && j >= 0 && i < VIE.W && j < VIE.H ? TER[j * VIE.W + i] : 0; };
const eauK = (x, y) => { const i = Math.floor(x - .5), j = Math.floor(y - .5), fx = x - .5 - i, fy = y - .5 - j, w = (a, b) => { const t = ter(a + .5, b + .5); return t === 0 || t === 1 ? 1 : 0; }; return lerp(lerp(w(i, j), w(i + 1, j), fx), lerp(w(i, j + 1), w(i + 1, j + 1), fx), fy); };
const alt = (x, y) => { const W = VIE.W, i = clamp(Math.floor(x - .5), 0, W - 2), j = clamp(Math.floor(y - .5), 0, VIE.H - 2), fx = clamp(x - .5 - i, 0, 1), fy = clamp(y - .5 - j, 0, 1); return lerp(lerp(ALT[j * W + i], ALT[j * W + i + 1], fx), lerp(ALT[(j + 1) * W + i], ALT[(j + 1) * W + i + 1], fx), fy); };
const pinede = (x, y) => x < XC + 70 && y > 80 && y < 230;
// la neige au sol : sur les sommets selon la saison, partout là où il neige l'hiver (vivante.js neige, sans le grain)
export function neige(x, y) {
  const seuil = { printemps: 1.05, ete: 1.35, automne: 1.15, hiver: .7 }[AMB.saison];
  let n = clamp((alt(x, y) - seuil) / .3 + .3 * Math.sin(x * .21 + y * .13) + .2 * Math.sin(x * .11 - y * .29), 0, 1);
  if (AMB.saison === 'hiver' && meteoEn(x, y) === 'neige') n = Math.max(n, .85);
  return n;
}
const malheur = (x, y) => { const i = x | 0, j = y | 0; return MAL && i >= 0 && j >= 0 && i < VIE.W && j < VIE.H ? MAL[j * VIE.W + i] : 0; };   // 1 disette ou famine, 2 épidémie

// combien de monde reste dehors en (x, y), de 0 à 1 : moins la nuit et par mauvais temps, personne autour d'un siège ou
// d'une bataille, peu de monde dans les places affamées ou malades. Le chantier D ajoute les siennes (ajouterDensite).
export function densite(x, y) {
  let d = AMB.heure === 'nuit' ? .15 : AMB.heure === 'soir' ? .6 : 1;
  d *= METEO_D[meteoEn(x, y)] ?? 1;
  const i = x | 0, j = y | 0;
  if (D_ETAT && i >= 0 && j >= 0 && i < VIE.W && j < VIE.H) d = Math.min(d, D_ETAT[j * VIE.W + i]);
  for (const f of PLUS) d = Math.min(d, f(x, y));
  return d;
}
// fn(x, y) → 0 à 1 : une règle de plus (la plus basse l'emporte)
export const ajouterDensite = fn => { if (!PLUS.includes(fn)) PLUS.push(fn); };

export function preparer(map) {
  const W = map.W, H = map.H, m = map.m;
  Object.assign(VIE, { W, H });
  MAP = map; TER = map.terrain; CELLNODE = map.cellnode; NOEUDS = map.nodes; XC = m.x_cote ?? -1e9;
  // un relief approché d'après le terrain (le jeu n'a pas d'altitudes), comme la maquette
  ALT = new Float32Array(W * H);
  const HT = [-.1, -.05, .04, .1, .05, 0, .38, .9, 1.6, .14, .16];
  for (let k = 0; k < ALT.length; k++) ALT[k] = HT[TER[k]] + .06 * hash2(k % W, k / W | 0, 7);
  const tmp = new Float32Array(ALT.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x >= 0 && y >= 0 && x < W && y < H) { s += ALT[y * W + x]; n++; } } tmp[j * W + i] = s / n; }
    ALT.set(tmp);
  }
  const nom = s => NOEUDS.find(n => n.name === s);
  const waters = m.waters || [];
  const BASSIN = waters.find(w => w.name === "Bassin d'Arcachon"), ESTUAIRE = waters.find(w => w.name === 'Estuaire de la Gironde');
  // marais salants : le marais au bord de l'eau salée (océan, estuaire, bassin)
  VIE.saline = new Set();
  for (let j = 0; j < H; j++) for (let i = 0; i < Math.min(110, W); i++) {
    if (TER[j * W + i] !== TT.MARAIS || hash2(i, j, 91) > .6) continue;
    let sale = false;
    for (let dj = -2; dj <= 2 && !sale; dj++) for (let di = -2; di <= 2 && !sale; di++) {
      const x = i + di + .5, y = j + dj + .5, t = ter(x, y);
      sale = t === TT.OCEAN || (t === TT.EAU && ((ESTUAIRE && dansAnneau(ESTUAIRE.ring, x, y)) || (BASSIN && dansAnneau(BASSIN.ring, x, y))));
    }
    if (sale) VIE.saline.add(j * W + i);
  }
  // les routes (sans les voies d'eau ni les bacs), avec leur emprise
  VIE.routes = [];
  map.edges.forEach((e, ie) => {
    if (e.water || e.kind === 'water' || e.ferry || e.pts.length < 2) return;
    VIE.routes.push({ e, ie, pts: e.pts, L: longueur(e.pts), bb: bboxOf(e.pts), royal: !!e.royal, a: e.a, b: e.b });
  });
  // relais de poste : toutes les deux lieues et quelque sur les routes royales, hors des villes
  VIE.relais = [];
  for (const r of VIE.routes) {
    if (!r.royal) continue;
    for (let s = 4.5; s < r.L - 3; s += 9) { const p = surChemin(r.pts, s); if (!NOEUDS.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 2.2)) VIE.relais.push({ x: p.x, y: p.y, a: p.a, c: hash2(VIE.relais.length, 3, 95) < .5 ? 1 : -1 }); }
  }
  const rivers = m.rivers || [];
  VIE.radeaux = [];
  for (const r of rivers) if (['Adour', 'Gave de Pau', "Gave d'Oloron", 'Midouze', 'Leyre', 'Nive', "Gave d'Aspe"].includes(r.name)) { const L = longueur(r.pts); for (let k = 0; k < Math.ceil(L / 16); k++) VIE.radeaux.push({ pts: r.pts, L, bb: bboxOf(r.pts), s0: hash2(k, L * 10 | 0, 98) * L, v: .007 }); }
  // pêche : pinasses dans le bassin d'Arcachon, chaloupes devant Saint-Jean-de-Luz ; parcs à huîtres ; cabanes tchanquées
  VIE.peche = []; VIE.parcs = []; VIE.tchanquees = [];
  if (BASSIN) {
    const R = [...BASSIN.ring, BASSIN.ring[0]], [a, b, c, d] = bboxOf(BASSIN.ring);
    for (let k = 0; k < 900; k++) {
      const x = lerp(a, c, hash2(k, 1, 99)), y = lerp(b, d, hash2(k, 2, 99)); if (!dansAnneau(BASSIN.ring, x, y)) continue;
      const dr = distPoly(R, x, y);
      if (dr > .9 && VIE.peche.length < 10) VIE.peche.push({ x, y, r: .2 + hash2(k, 3, 99) * .2, ph: k, v: .005, pinasse: true });
      else if (dr > .25 && dr < .8 && VIE.parcs.length < 60 && hash2(k, 4, 99) < .4) VIE.parcs.push([x, y, hash2(k, 5, 99) * .6 - .3]);
      else if (dr > 1.6 && VIE.tchanquees.length < 2 && hash2(k, 6, 99) < .2) VIE.tchanquees.push([x, y]);
    }
  }
  const sjl = nom('Saint-Jean-de-Luz');
  if (sjl) for (let k = 0, q = 0; k < 200 && q < 5; k++) { const a = Math.PI * .8 + hash2(k, 1, 100) * 1.2, d = 1.5 + hash2(k, 2, 100) * 3.5, x = sjl.x + Math.cos(a) * d, y = sjl.y + Math.sin(a) * d; if (eauK(x, y) > .99) { VIE.peche.push({ x, y, r: .4, ph: k, v: .008, pinasse: false }); q++; } }
  // carrelets : cabanes sur pilotis et grands filets carrés au bord de l'estuaire
  VIE.carrelets = [];
  if (ESTUAIRE) {
    const R = [...ESTUAIRE.ring, ESTUAIRE.ring[0]];
    for (let i = 1; i < R.length; i++) {
      const [ax, ay] = R[i - 1], [bx, by] = R[i], l = Math.hypot(bx - ax, by - ay);
      for (let d = .8; d < l; d += 2.6) {
        const x = ax + (bx - ax) * d / l, y = ay + (by - ay) * d / l; let nx = -(by - ay) / l, ny = (bx - ax) / l;
        if (!dansAnneau(ESTUAIRE.ring, x + nx * .2, y + ny * .2)) { nx = -nx; ny = -ny; }
        VIE.carrelets.push({ x, y, a: Math.atan2(ny, nx), lev: hash2(i, d * 10 | 0, 100) * 9 });
      }
    }
  }
  // Cordouan, le phare de l'estuaire, en mer au large de Soulac
  VIE.cordouan = null;
  for (let dx = -3; dx <= 3; dx += .5) for (let dy = -3; dy <= 3; dy += .5) { const x = 54 + dx, y = 21 + dy; if (eauK(x, y) > .99) { const d = Math.hypot(dx, dy); if (!VIE.cordouan || d < VIE.cordouan.d) VIE.cordouan = { x, y, d }; } }
  // sentiers de contrebande : des villages basques et béarnais vers l'Espagne, par la montagne
  VIE.sentiers = ['Sare', 'Saint-Étienne-de-Baïgorry', 'Urdos'].map((s, q) => {
    const n = nom(s); if (!n) return null;
    const pts = [[n.x, n.y]]; let x = n.x, y = n.y;
    for (let k = 0; k < 30 && y < H - .8; k++) { x += Math.sin(k * .9 + q * 2) * .32; y += .4; pts.push([x, y]); }
    return { n, pts, L: longueur(pts), bb: bboxOf(pts), ph: q * 3.1 };
  }).filter(Boolean);
  // la transhumance : au printemps les troupeaux montent vers les estives, à l'automne ils descendent
  VIE.transhumances = [];
  for (const r of VIE.routes) {
    const A = NOEUDS[r.a], B = NOEUDS[r.b]; if (!A || !B || A.dept !== '64' || B.dept !== '64' || VIE.transhumances.length >= 10) continue;
    const dy = r.pts[r.pts.length - 1][1] - r.pts[0][1];
    if (Math.abs(dy) > r.L * .5 && r.L > 4) VIE.transhumances.push({ ie: r.ie, pts: r.pts, L: r.L, s0: hash2(r.ie, 1, 101) * r.L, haut: dy > 0 ? 1 : -1 });
  }
  VIE.vols = Array.from({ length: 16 }, (_, k) => ({ k, sorte: ['grues', 'palombes', 'mouettes', 'etourneaux'][k % 4], x: hash2(k, 1, 102) * W, y: hash2(k, 2, 102) * H, ph: hash2(k, 3, 102) * 99 }));
  VIE.ports = ['Bordeaux', 'Bayonne', 'La Teste-de-Buch', 'Saint-Jean-de-Luz', 'Blaye', 'Pauillac'].map(nom).filter(Boolean);
  // bateaux : gabares sur les grandes rivières, navires sur la route du cabotage
  VIE.bateaux = [];
  for (const r of rivers) if (r.rank <= 2) { const L = longueur(r.pts); for (let k = 0; k < Math.ceil(L / 14); k++) VIE.bateaux.push({ pts: r.pts, L, bb: bboxOf(r.pts), s0: hash2(k, r.rank, 5) * L, v: (hash2(k, 7, 5) < .5 ? -1 : 1) * .02, mer: false, ph: hash2(k, L | 0, 8) * 1000 }); }
  for (const w of m.ways || []) if (w.sea) { const L = longueur(w.pts); for (let k = 0; k < Math.ceil(L / 25); k++) VIE.bateaux.push({ pts: w.pts, L, bb: bboxOf(w.pts), s0: hash2(k, 9, 6) * L, v: (hash2(k, 8, 6) < .5 ? -1 : 1) * .04, mer: true, ph: 0 }); }
  // moulins à vent dans les champs autour des bourgs (vus de dessus, moulinVu)
  VIE.moulins = [];
  for (const n of NOEUDS) {
    const want = n.type === 'capitale' ? 3 : n.type === 'ville' ? 2 : hash2(n.id, 1, 71) < .55 ? 1 : 0;
    for (let k = 0, q = 0; k < 12 && q < want; k++) {
      const a = -Math.PI * (.55 + hash2(n.id, k, 72) * .42), r = (n.type === 'capitale' ? 3.2 : n.type === 'ville' ? 2.4 : 1.7) + hash2(n.id, k, 73) * 1.6;
      const x = n.x + Math.cos(a) * r, y = n.y + Math.sin(a) * r * .8, t = ter(x, y);
      if (t !== TT.PLAINE && t !== TT.COLLINES && t !== TT.VIGNE) continue;
      if (VIE.moulins.some(o => Math.hypot(o.x - x, o.y - y) < 1.3) || NOEUDS.some(o => Math.hypot(o.x - x, o.y - y) < 1.1)) continue;
      VIE.moulins.push({ x, y, ph: hash2(n.id, k, 74) * TAU, sp: .75 + hash2(n.id, k, 75) * .5 }); q++;
    }
  }
  VIE.pret = true; CLE = '';
  majEtat(null);
}

// l'état de la partie : densité par kilomètre (sièges, batailles, famine, épidémie, disette), marchés, foires, brigands
export function majEtat(st) {
  const W = VIE.W, H = VIE.H, ns = st?.nodes || [];
  let cle = `${st?.me?.code}|${st?.me?.famine ? 1 : 0}|`;
  for (const n of ns) if (n.sg || n.lv || n.sl) cle += `${n.id}:${n.o}:${n.sg ? 1 : 0}:${n.lv?.[0] || ''}:${n.sl?.some(s => s[0] === 'marche' && s[1] > 0) ? 1 : 0};`;
  for (const b of st?.battles || []) cle += `b${b.x},${b.y};`;
  if (cle === CLE && D_ETAT) return false;
  CLE = cle;
  D_ETAT = new Float32Array(W * H).fill(1); MAL = new Uint8Array(W * H);
  const me = st?.me?.code, famine = !!st?.me?.famine, parNoeud = [];
  for (const n of ns) {
    const lv = n.lv?.[0];
    parNoeud[n.id] = lv === 'epidemie' ? [.25, 2] : lv === 'disette' ? [.3, 1] : famine && n.o === me ? [.45, 1] : null;
  }
  for (let c = 0; c < W * H; c++) { const p = parNoeud[CELLNODE[c]]; if (p) { D_ETAT[c] = p[0]; MAL[c] = p[1]; } }
  const tampon = (x, y, r, v) => {
    for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(H - 1, y + r); j++) for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(W - 1, x + r); i++)
      if (Math.hypot(i + .5 - x, j + .5 - y) < r) D_ETAT[j * W + i] = Math.min(D_ETAT[j * W + i], v);
  };
  for (const n of ns) if (n.sg) { const g = NOEUDS[n.id]; if (g) tampon(g.x, g.y, rayonPlace(g) + 4, .06); }
  for (const b of st?.battles || []) tampon(b.x, b.y, 5, .1);
  // marchés : les places du joueur qui ont la chaîne du commerce ; foires : l'événement local
  VIE.marches = ns.filter(n => n.sl?.some(s => s[0] === 'marche' && s[1] > 0) && !n.sg && n.lv?.[0] !== 'disette' && n.lv?.[0] !== 'epidemie').map(n => {
    const g = NOEUDS[n.id]; if (!g) return null;
    // sur la grand-place du plan de la ville (villes.js), à défaut au centre
    let pl = null;
    try { pl = MAP && planDe(carteDe(MAP.m), g, etatVille(g, n, st)).lieux?.place; } catch (e) { /* plan indisponible */ }
    return { n: g, x: g.x + (pl ? (pl.x - IC[0]) / S_INT : 0), y: g.y + (pl ? (pl.y - IC[1]) / S_INT : 0) };
  }).filter(Boolean);
  VIE.foires = [];
  for (const n of ns) {
    if (n.lv?.[0] !== 'foire' || n.sg) continue;
    const g = NOEUDS[n.id]; if (!g) continue;
    // hors les murs, le long de la première route (royale d'abord)
    const r = VIE.routes.filter(r => r.a === g.id || r.b === g.id).sort((p, q) => q.royal - p.royal)[0];
    let a = 0;
    if (r) { const pts = r.a === g.id ? r.pts : r.pts.slice().reverse(), p = pts.find(q => Math.hypot(q[0] - g.x, q[1] - g.y) > .9) || pts[pts.length - 1]; a = Math.atan2(p[1] - g.y, p[0] - g.x) + .5; }
    const d = rayonPlace(g) * 1.2 + .15;
    VIE.foires.push({ n: g, x: g.x + Math.cos(a) * d, y: g.y + Math.sin(a) * d, a });
  }
  // les routes autour des foires sont plus passantes
  VIE.foireRoutes = new Set(VIE.routes.filter(r => VIE.foires.some(f => Math.hypot(Math.max(r.bb[0] - f.x, 0, f.x - r.bb[2]), Math.max(r.bb[1] - f.y, 0, f.y - r.bb[3])) < 12)).map(r => r.ie));
  // brigands : sur les routes qui partent d'une place où l'on en signale, une bande tous les quatre kilomètres
  VIE.brigands = [];
  const brig = new Set(ns.filter(n => n.lv?.[0] === 'brigands').map(n => n.id));
  for (const r of VIE.routes) {
    if (!brig.has(r.a) && !brig.has(r.b)) continue;
    for (let k = 0; k < Math.max(1, Math.round(r.L / 4)); k++) { const p = surChemin(r.pts, r.L * (k + .3 + hash2(r.ie, k, 140) * .4) / Math.max(1, Math.round(r.L / 4))); VIE.brigands.push({ x: p.x, y: p.y, a: p.a, k, c: hash2(r.ie, k, 141) < .5 ? 1 : -1, proie: hash2(r.ie, k, 142) < .45 }); }
  }
  return true;
}

// ---------- petits dessins, en unités de figure (U km), repris de la maquette
// De loin (moins d'un pixel par unité), les figures se dessinent en deux ou trois taches : les jambes, les bras, les
// fusils et les épaulettes n'y feraient pas un pixel, et coûteraient le gros de l'image au zoom de la vie.
let SIMPLE = false;
function fantassin(g, L, f, p) {
  if (!SIMPLE) return fantassin0(g, L, f, p);
  RR(g, f.habit || L.habit, -1.35, -2.15, 2.7, 4.3, 1.2); C(g, L.tete === 'coiffe' ? '#f2efe6' : '#3a2b1c', 0, 0, 1.3);
}
function cheval(g, c, p) {
  if (!SIMPLE) return cheval0(g, c, p);
  E(g, c, 0, 0, 5.3, 2.05); E(g, c, 5.8, 0, 2.4, 1.05);
}
function cavalier(g, L, f, p, postillon) {
  if (!SIMPLE) return cavalier0(g, L, f, p, postillon);
  E(g, f.habit || L.habit, -.4, 0, 1.45, 2.05); C(g, '#3a2b1c', 0, 0, 1);
}
const figK = (sc, g, x, y, a, s = 1) => { sc.fig(g, x, y, a); g.scale(U * s, U * s); g.lineCap = 'round'; };
const LCIV = tenue('fr', 'civil');
const CIVILS = ['#7a6a4f', '#5d6b86', '#8a5a44', '#6e5c45', '#4f5a6a', '#9a4a3a'].map((h, i) => ({ L: Object.assign({}, LCIV, { tete: i % 2 ? 'coiffe' : 'rond' }), habit: h }));
const LBRIG = Object.assign({}, LCIV, { tete: 'rond', culotte: '#3f3a32' });
let LDOU = null;   // les douaniers (tenue des chasseurs)
PAL.lauze ??= ['#8a8478', '#6a655c', '#4f4b44'];
if (!SPR.fen) sprite('fen', '255,214,140');   // (les lanternes de LUM ; ciel.js les allume)
function marcheur(g, k, pas, bagage) { const c = CIVILS[k % CIVILS.length]; fantassin(g, c.L, { role: 'h', habit: c.habit }, { legs: pas, arme: 'aucun' }); if (bagage) C(g, '#b9a37a', -2.1, 0, 1.4); }
function charrette(g, pas, boeufs, k) {
  if (!SIMPLE) for (const x of [-4, 4]) { RR(g, '#3a2a1b', x - 2, -3.7, 4, 1, .4); RR(g, '#3a2a1b', x - 2, 2.7, 4, 1, .4); }
  T(g, '#5b4127', .6, 6, 0, 10, 0); RR(g, '#8a6a45', -6.5, -2.9, 13, 5.8, .6);
  RR(g, ['#b8a27a', '#d6ba5c', '#6b8fb5'][k % 3], -5.5, -2.2, 10, 4.4, .5);
  for (const y of boeufs ? [-2.4, 2.4] : [0]) { g.save(); g.translate(15, y); cheval(g, boeufs ? '#d2bf95' : '#6b4a2c', { gait: pas, bob: 0 }); if (boeufs) { T(g, '#efe6cc', .35, 7.7, -.6, 8.3, -1.4); T(g, '#efe6cc', .35, 7.7, .6, 8.3, 1.4); } g.restore(); }
}
function diligence(g, pas) {
  for (const x of [-5, 5]) { RR(g, '#e3c04f', x - 2.2, -4.2, 4.4, 1, .4); RR(g, '#e3c04f', x - 2.2, 3.2, 4.4, 1, .4); }
  RR(g, '#2f4a3a', -7, -3.4, 14, 6.8, 1.2); RR(g, '#1c1b1d', -6, -2.8, 9, 5.6, 1); RR(g, '#b9a37a', -6.4, -2.4, 4, 4.8, .6);
  for (const x of [15, 26]) for (const y of [-2.6, 2.6]) { g.save(); g.translate(x, y); cheval(g, x === 15 ? '#6b4a2c' : '#3f2d1f', { gait: pas + x, bob: 0 }); g.restore(); }
}
function mallePoste(g, pas) {
  for (const x of [-5, 5]) { RR(g, '#1c1b1d', x - 2.2, -4.2, 4.4, 1, .4); RR(g, '#1c1b1d', x - 2.2, 3.2, 4.4, 1, .4); }
  RR(g, '#c9a12c', -7.5, -3.4, 15, 6.8, 1.2); RR(g, '#2a2a2e', -6.5, -2.6, 8, 5.2, .8); RR(g, '#7a6a4f', 2.5, -2.6, 4, 5.2, .5);   // caisse jaune, impériale bâchée, coffre des dépêches
  for (const x of [16, 27]) for (const y of [-2.6, 2.6]) { g.save(); g.translate(x, y); cheval(g, x === 16 ? '#6b4a2c' : '#8b6a47', { gait: pas * 1.5 + x + y, bob: 0 }); if (x === 16 && y < 0) cavalier(g, LCIV, { habit: '#2f4f9c' }, { sabre: 0, bob: 0 }, true); g.restore(); }
}
function convoiFunebre(g, pas) {
  RR(g, '#2a2420', -6, -2.6, 12, 5.2, .6); RR(g, '#5b4127', -4.5, -1.4, 9, 2.8, .4); T(g, '#efe6cc', .4, -1, 0, 2, 0); T(g, '#efe6cc', .4, 0, -1, 0, 1);
  g.save(); g.translate(13, 0); cheval(g, '#2e2119', { gait: pas * .6, bob: 0 }); g.restore();
  for (let m = 0; m < 3; m++) { g.save(); g.translate(-10 - m * 4, (m % 2 ? 1.5 : -1.5)); fantassin(g, CIVILS[m].L, { role: 'h', habit: '#1f1d1d' }, { legs: pas * .6 + m, arme: 'aucun' }); g.restore(); }
}
function mouton(g, x, y, a, c = '#efeade') { if (!SIMPLE) E(g, OMBRE, x + .8, y + 1, 1.9, 1.2, a); E(g, c, x, y, 1.9, 1.2, a); C(g, '#2c2a28', x + Math.cos(a) * 2, y + Math.sin(a) * 2, .6); }
function vache(g, x, y, a, robe) { E(g, OMBRE, x + 1, y + 1.3, 4.3, 1.9, a); E(g, robe, x, y, 4.3, 1.9, a); E(g, sombre(robe, .1), x + Math.cos(a) * 4.6, y + Math.sin(a) * 4.6, 1.4, .95, a); }
function chien(g, x, y, a, t) { E(g, 'rgba(20,20,10,.3)', x + .5, y + .7, 1.8, .8, a); E(g, '#3a2c22', x, y, 1.8, .75, a); C(g, '#2a1f18', x + Math.cos(a) * 1.9, y + Math.sin(a) * 1.9, .6); T(g, '#3a2c22', .4, x - Math.cos(a) * 1.7, y - Math.sin(a) * 1.7, x - Math.cos(a + Math.sin(t * 8) * .5) * 3, y - Math.sin(a + Math.sin(t * 8) * .5) * 3); }
const brebis = (g, c) => { if (SIMPLE) { E(g, c, -.3, 0, 1.9, 1.3); C(g, '#2c2a28', 1.9, 0, .6); return; } for (const [cx, cy] of [[-1, -.6], [-1, .6], [.4, -.7], [.4, .7], [-.3, 0]]) C(g, c, cx, cy, .9); C(g, '#2c2a28', 1.9, 0, .6); };
function etal(g, k) {
  const c = ['#c8322b', '#e3c04f', '#2f4f9c', '#3f8a3c', '#8a5a44'][k % 5];
  RR(g, 'rgba(20,20,10,.3)', -2.6, -1.6, 7, 5, .4); RR(g, c, -3.5, -2.5, 7, 5, .4);
  for (let i = 0; i < 3; i++) RR(g, '#f1eee4', -3.5 + .7 + i * 2.2, -2.5, 1, 5, 0);
  for (let i = 0; i < 4; i++) C(g, ['#d6ba5c', '#9a4a3a', '#6b8f3a', '#e8dcc0'][(k + i) % 4], -2.6 + i * 1.7, 3.4, .7);
}
function troupeauTrans(g, t, pas) {
  g.save(); g.translate(7, 0); marcheur(g, 4, pas, false); T(g, '#6b4d31', .4, .5, 1.8, 4.8, 2.6); g.restore();
  for (let m = 0; m < 46; m++) { const ox = -3 - (m % 9) * 2.6 - (m / 9 | 0) * 2.4 + Math.sin(t * 1.3 + m) * .4, oy = ((m * 7) % 11 - 5) * 1.15 + Math.sin(t + m * 2) * .3; mouton(g, ox, oy, Math.sin(t + m) * .3); }
  g.save(); g.translate(-30, 0); g.scale(.75, .75); cheval(g, '#7d7366', { gait: pas, bob: 0 }); RR(g, '#8a6a45', -2.5, -3.2, 5, 1.6, .4); RR(g, '#8a6a45', -2.5, 1.6, 5, 1.6, .4); g.restore();   // l'âne bâté
  chien(g, -12 + Math.sin(t * .7) * 4, -8, Math.sin(t) * .4, t); chien(g, -20 + Math.cos(t * .6) * 4, 8, Math.PI + Math.sin(t) * .4, t + 2);
  g.save(); g.translate(-37, 1); marcheur(g, 5, pas, true); g.restore();
}
// une bande de brigands au bord de la route, fusils pointés ; parfois une voiture arrêtée, ses voyageurs les mains levées
function brigands(g, t, proie) {
  for (let m = 0; m < 4; m++) { g.save(); g.translate(-6 + m * 4, 5 + (m % 2) * 2.5); g.rotate(-Math.PI / 2 + (m - 1.5) * .2); fantassin(g, LBRIG, { role: 'h', habit: ['#3a3530', '#4a4036', '#5a3f30', '#2e2a26'][m] }, { legs: null, arme: m === 1 || m === 2 ? 'joue' : 'epaule' }); g.restore(); }
  g.save(); g.translate(-14, 9); g.rotate(.4); cheval(g, '#3f2d1f', { bob: Math.sin(t * .8) }); g.restore();
  if (proie) {
    g.save(); g.translate(2, -1.5); diligence(g, 0); g.restore();
    for (let m = 0; m < 2; m++) { g.save(); g.translate(-1 + m * 4, 3); g.rotate(Math.PI / 2); marcheur(g, m + 1, 0, false); T(g, PEAU, .6, 0, -1.6, 1.8, -1.9); T(g, PEAU, .6, 0, 1.6, 1.8, 1.9); g.restore(); }
  }
}
// moulin vu d'en haut (new.js moulinVu) : les ailes tournent dans un plan vertical face au vent, on les voit de profil ;
// leur ombre au sol, une croix de biais, montre qu'elles tournent. En unités de l'intérieur (180 par km).
function moulinVu(g, x, y, t, wa = .35, L = 17, H = 12) {
  const dx = Math.cos(wa), dy = Math.sin(wa), px = -dy, py = dx, sx = .34, sy = .45;
  const hx0 = x - dx * 4.5, hy0 = y - dy * 4.5;
  const bras = [0, 1, 2, 3].map(k => t * .9 + k * Math.PI / 2);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(20,20,10,.34)'; g.lineWidth = 3.2; g.beginPath();
  for (const a of bras) { const u = L * Math.cos(a), h = H + L * Math.sin(a); g.moveTo(hx0 + sx * H, hy0 + sy * H); g.lineTo(hx0 + px * u + sx * h, hy0 + py * u + sy * h); }
  g.stroke();
  T(g, '#5b4127', 1, x, y, x + dx * 13, y + dy * 13);
  C(g, OMBRE, x + 3, y + 4, 7.5); C(g, '#d8cdb5', x, y, 7); coneF(g, x, y, 5.4, PAL.ardoise, 0);
  const us = bras.map(a => L * Math.cos(a)), u0 = Math.min(...us), u1 = Math.max(...us);
  T(g, '#4a3a28', 1.6, hx0 + px * u0, hy0 + py * u0, hx0 + px * u1, hy0 + py * u1);
  T(g, '#e8e0cc', .9, hx0 + px * u0, hy0 + py * u0, hx0 + px * u1, hy0 + py * u1);
  C(g, '#3a2a1b', hx0, hy0, 1.3);
}

// ---------- les travaux de la saison
function resinier(sc, g, x, y, t, h) {
  // le gemmeur au pied du pin, son pitey (l'échelle à un seul montant) appuyé au tronc, le pot de résine ; le houppier au-dessus
  figK(sc, g, x, y, h * 40);
  T(g, 'rgba(20,20,10,.33)', .7, 2.2, 1.6, 17, 21);
  T(g, '#8a6a45', .7, 2.2, 1.6, 8, 6); for (let r = 0; r < 5; r++) { const k = r / 5, px = lerp(2.2, 8, k), py = lerp(1.6, 6, k); T(g, '#6b4d31', .35, px - .4, py + .5, px + .4, py - .5); }
  const geste = Math.sin(t * 2.2 + h * 9) > .2;
  g.save(); g.translate(geste ? 3.2 : 1, geste ? 2.4 : .6); g.rotate(.65); marcheur(g, (h * 10) | 0, 0, false); g.restore();
  C(g, '#d9c27a', 6.6, 3.2, .55);
  C(g, OMBRE, 10, 8.6, 6.5); C(g, '#2f5a33', 8, 6, 6.5); C(g, '#3d6a3d', 6.8, 4.8, 3.2);
  if (h < .06) { g.save(); g.translate(-18, 6); charrette(g, 0, true, 0); for (const cx of [-3, 0, 3]) for (const cy of [-1.1, 1.1]) { C(g, '#6b4a2c', cx, cy, 1.15); C(g, '#3a2a1b', cx, cy, .5); } g.restore(); }   // les barriques de gemme
}
function loups(sc, g, x, y, t, h) {
  for (let m = 0; m < 4; m++) {
    const ph = t * .018 + h * 9 - m * .045, px = x + Math.cos(ph) * .22, py = y + Math.sin(ph * 1.3) * .14, a = Math.atan2(Math.cos(ph * 1.3) * .182, -Math.sin(ph) * .22);
    figK(sc, g, px, py, a); const st = Math.sin(t * 9 + m);
    E(g, 'rgba(20,20,10,.3)', .8, 1, 3.2, 1.3);
    for (const [lx, ly] of [[1.8, -.9], [1.8, .9], [-1.8, -.9], [-1.8, .9]]) E(g, '#5a5550', lx + st * .8 * Math.sign(lx * ly), ly, .7, .3);
    E(g, '#7d7770', 0, 0, 3.1, 1.15); E(g, '#8c867e', 3.3, 0, 1.2, .8); E(g, '#6a645d', 4.4, 0, .6, .4); T(g, '#6f6a63', .7, -2.8, 0, -4.8, Math.sin(t * 3 + m) * .4);
    C(g, '#5e5852', 3.4, -.55, .3); C(g, '#5e5852', 3.4, .55, .3);
    if (AMB.heure === 'nuit') LUM.push({ x: px + Math.cos(a) * .016, y: py + Math.sin(a) * .016, r: .006, a: .7, spr: 'fen' });
  }
}
function bucherons(sc, g, x, y, t, h) {
  const a = h * 20; figK(sc, g, x, y, a);
  charbonniere(g, 14, 8); stere(g, -10, 6);
  T(g, '#6b4d31', 1.4, -4, -8, 8, -11); for (const k of [0, 1, 2]) C(g, BOIS[k + 1], 6 + k * 1.5, -11 + k, 1.8);   // l'arbre abattu
  for (const [ox, oy, k] of [[0, 0, 0], [4.5, -4, 1]]) { g.save(); g.translate(ox, oy); fantassin(g, CIVILS[3 + k].L, { role: 'h', habit: CIVILS[3 + k].habit }, { legs: null, arme: 'hache', ext: mod(t * .9 + k * .5, 1) }); g.restore(); }
  if (sc.on && Math.random() < .04) { const [fx, fy] = versMonde(x, y, a, 14, 8); fumee(sc, fx, fy, 0, 0, .003, .03, 7, .3); }   // la charbonnière fume
}
function moisson(sc, g, x, y, t, h) {
  figK(sc, g, x, y, h * 7);
  for (let m = 0; m < 5; m++) { g.save(); g.translate(0, (m - 2) * 4.2); marcheur(g, m, 0, false); const s = Math.sin(t * 2.6 + m * .7); if (!SIMPLE) { T(g, '#6b4d31', .4, .5, 0, 3 + s, 2.8 * s); T(g, '#c9ccd0', .45, 3 + s, 2.8 * s, 4.6 + s, 2.8 * s - 1.5); } g.restore(); }   // les faucheurs
  // les gerbes, d'un seul tracé (leur ombre d'un autre)
  for (const [c, o] of SIMPLE ? [['#e3cd84', 0]] : [['rgba(40,30,15,.3)', .6], ['#e3cd84', 0]]) { g.fillStyle = c; g.beginPath(); for (let r = 0; r < 3; r++) for (let q = 0; q < 6; q++) { const gx = -7 - r * 6 + o, gy = (q - 2.5) * 4 + o; g.moveTo(gx + 1.3, gy); g.arc(gx, gy, 1.3, 0, TAU); } g.fill(); }
  for (let m = 0; m < 2; m++) { g.save(); g.translate(-4 - m * 6, -3 + m * 7); g.rotate(Math.PI); marcheur(g, m + 3, 0, false); g.restore(); }   // les lieuses
  g.save(); g.translate(-26, 2); g.rotate(Math.PI / 2); charrette(g, 0, true, 1); for (let q = 0; q < 6; q++) C(g, '#e3cd84', -4 + (q % 3) * 3.5, (q / 3 | 0) * 2.4 - 1.2, 1.4); g.restore();
}
function labour(sc, g, x, y, t, h) {
  const L = .32, u = t * .0025 + h * 9, s = pingpong(u, L), aller = mod(u, 2 * L) < L, a0 = h * 7;
  figK(sc, g, x + Math.cos(a0) * (s - L / 2), y + Math.sin(a0) * (s - L / 2), a0 + (aller ? 0 : Math.PI));
  const pas = t * 1.2 * TAU;
  for (const yy of [-2.4, 2.4]) { g.save(); g.translate(9, yy); cheval(g, '#d2bf95', { gait: pas + yy, bob: 0 }); T(g, '#efe6cc', .35, 7.7, -.6, 8.3, -1.4); T(g, '#efe6cc', .35, 7.7, .6, 8.3, 1.4); g.restore(); }
  T(g, '#5b4127', .5, 3, 0, 1, 0); charrue(g, 0, 0, 0); g.save(); g.translate(-6, 0); marcheur(g, 2, pas, false); g.restore();
  for (let m = 0; m < 4; m++) { const ox = -12 - m * 3 + Math.sin(t * 2 + m) * 1.5, oy = Math.cos(t * 1.7 + m * 2) * 3; g.strokeStyle = '#f4f2ea'; g.lineWidth = .5; g.beginPath(); g.moveTo(ox - 1, oy - 1.4); g.quadraticCurveTo(ox, oy - .2, ox + .5, oy); g.quadraticCurveTo(ox, oy + .2, ox - 1, oy + 1.4); g.stroke(); }   // les mouettes derrière la charrue
}
function vendanges(sc, g, x, y, t, h) {
  figK(sc, g, x, y, h < .2 ? Math.PI / 2 : 0);
  for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) { g.save(); g.translate((q - 1.5) * 6 + Math.sin(t * .3 + r + q) * .6, (r - 1) * 3); marcheur(g, r * 4 + q, 0, false); C(g, '#6a3a6a', 1.6, 1.4, .7); g.restore(); }   // coupeurs et leurs paniers
  for (let m = 0; m < 2; m++) { const s = pingpong(t * .8 + m * 7, 16) - 8; g.save(); g.translate(s, 7 + m * 2.2); marcheur(g, 9 + m, t * 7 + m, false); C(g, '#6b4a2c', -1.8, 0, 1.3); C(g, '#5a2f5a', -1.8, 0, .8); g.restore(); }   // porteurs à la hotte
  g.save(); g.translate(-14, 11); charrette(g, 0, true, 2); for (const cx of [-3.5, 0, 3.5]) { C(g, '#6b4a2c', cx, 0, 1.6); C(g, '#4a2747', cx, 0, 1.1); } g.restore();   // les comportes
}
function estive(sc, g, x, y, t, h) {
  figK(sc, g, x, y, h * 9);
  bat(g, [{ t: 'g', x: -6, y: -4, w: 12, h: 8, p: 'lauze', h2: 1.2 }], -16, -8, .3, 1);   // le cayolar, la cabane du berger
  g.strokeStyle = '#a39a88'; g.lineWidth = 1.1; g.beginPath(); g.arc(-17, 7, 6, 0, TAU); g.stroke();   // le parc de pierres sèches
  for (let m = 0; m < 30; m++) { const px = (hash2(m, h * 999 | 0, 140) - .5) * 44, py = (hash2(h * 999 | 0, m, 141) - .5) * 26; mouton(g, px + Math.sin(t * .05 + m) * 1.2, py + Math.cos(t * .04 + m) * .8, hash2(m, 3, 142) * TAU + Math.sin(t * .1 + m) * .3); }
  g.save(); g.translate(-8, 2); marcheur(g, 6, 0, false); g.restore(); chien(g, 14, -3, 2 + Math.sin(t * .5), t);
}
function paludiers(sc, g, i, j, t) {
  for (let m = 0; m < 2; m++) {
    const x = i + .3 + m * .3 + hash2(i, j, 110 + m) * .2, y = j + .3 + hash2(j, i, 112 + m) * .4, s = Math.sin(t * 1.4 + m * 2);
    if (ter(x, y) !== TT.MARAIS) continue;
    figK(sc, g, x, y, m * 2.2); marcheur(g, 7 + m, 0, false); T(g, '#8a6a45', .45, 1, 1, 6 + s * 2, 1.5); T(g, '#6b4d31', .7, 6 + s * 2, -.2, 6 + s * 2, 3.2);   // le las, le grand râteau
  }
}

// ---------- au plus près (z ≥ Z.VIE) : passants sur les routes, bêtes, travaux, transhumance, brigands
const VITESSE = { malle: .045, diligence: .03, cavalier: .025, charrette: .009, boeufs: .006, troupeau: .004, pieton: .0045, convoi: .004, mendiant: .003 };
function vieDePres(sc, g, x0, y0, x1, y1) {
  const t = sc.time, dans = (x, y) => x > x0 - .2 && x < x1 + .2 && y > y0 - .2 && y < y1 + .2, soir = bivouac();
  for (const r of VIE.routes) {
    const bb = r.bb; if (bb[2] < x0 - .2 || bb[0] > x1 + .2 || bb[3] < y0 - .2 || bb[1] > y1 + .2) continue;
    const L = r.L, ie = r.ie, n = Math.ceil(L / (r.royal ? 1.1 : 2.2) * (VIE.foireRoutes.has(ie) ? 1.6 : 1));
    for (let k = 0; k < n; k++) {
      const h = hash2(ie, k, 31), sens = h < .5 ? 1 : -1, sorte = hash2(ie, k, 32);
      let kind = r.royal ? (sorte < .05 ? 'malle' : sorte < .12 ? 'diligence' : sorte < .4 ? 'charrette' : sorte < .55 ? 'cavalier' : sorte < .62 ? 'troupeau' : 'pieton') : (sorte < .35 ? 'boeufs' : sorte < .5 ? 'troupeau' : sorte < .58 ? 'cavalier' : 'pieton');
      const p0 = surChemin(r.pts, h * L); if (hash2(ie, k, 34) > densite(p0.x, p0.y)) continue;   // pays déserté
      const mal = malheur(p0.x, p0.y);
      if (mal && sorte > .55) kind = mal === 2 && hash2(ie, k, 35) < .4 ? 'convoi' : 'mendiant';
      const p = surChemin(r.pts, mod(h * L + sens * VITESSE[kind] * t, L)); if (!dans(p.x, p.y)) continue;
      const a = p.a + (sens < 0 ? Math.PI : 0), cote = .012, x = p.x - Math.sin(a) * cote, y = p.y + Math.cos(a) * cote, pas = t * 1.7 * TAU + k;
      figK(sc, g, x, y, a);
      if (kind === 'troupeau') {
        marcheur(g, k, pas, false); T(g, '#6b4d31', .4, .4, 2, 5, 2.8);
        for (let m = 0; m < 9; m++) { const ox = -5 - (m % 3) * 3, oy = ((m / 3 | 0) - 1) * 2.6 + Math.sin(t * 2 + m) * .4; g.save(); g.translate(ox * 1.4 - 4, oy); brebis(g, '#f1efe6'); g.restore(); }
      } else if (kind === 'malle') mallePoste(g, pas);
      else if (kind === 'convoi') convoiFunebre(g, pas);
      else if (kind === 'mendiant') { fantassin(g, CIVILS[0].L, { role: 'h', habit: '#4a4338' }, { legs: pas * .6, arme: 'aucun' }); T(g, '#6b4d31', .4, 1, 1.6, 4.5, 2.2); }
      else if (kind === 'diligence') diligence(g, pas);
      else if (kind === 'charrette' || kind === 'boeufs') charrette(g, pas, kind === 'boeufs', k);
      else if (kind === 'cavalier') { cheval(g, ['#6b4a2c', '#3f2d1f', '#8b6a47'][k % 3], { gait: pas * 1.4, bob: 0 }); cavalier(g, LCIV, { habit: '#5d6b86' }, { sabre: 0, bob: 0 }); }
      else marcheur(g, k, pas, hash2(ie, k, 33) < .5);
      if (soir && (kind === 'malle' || kind === 'diligence')) { const [lx, ly] = versMonde(x, y, a, 8, 0); LUM.push({ x: lx, y: ly, r: .012, a: .8, spr: 'fen' }); }   // la lanterne
    }
  }
  if (AMB.saison === 'printemps' || AMB.saison === 'automne') for (const f of VIE.transhumances) {
    const sens = AMB.saison === 'automne' ? -f.haut : f.haut, p = surChemin(f.pts, mod(f.s0 + sens * .0028 * t, f.L));
    if (!dans(p.x, p.y) || hash2(f.ie, 2, 101) > densite(p.x, p.y) + .2) continue;
    figK(sc, g, p.x, p.y, p.a + (sens < 0 ? Math.PI : 0)); troupeauTrans(g, t, t * 1.7 * TAU);
  }
  for (const b of VIE.brigands) {
    if (!dans(b.x, b.y)) continue;
    figK(sc, g, b.x - Math.sin(b.a) * .006 * b.c, b.y + Math.cos(b.a) * .006 * b.c, b.a + (b.c < 0 ? Math.PI : 0)); brigands(g, t, b.proie && AMB.heure !== 'nuit');
  }
  // bêtes et travaux : chaque kilomètre de pays a les siens (même endroit, mêmes bêtes). De loin, les bêtes sont des
  // taches rangées par couleur et peintes d'un seul tracé chacune (taches, à la fin)
  const sa = AMB.saison, taches = new Map();
  const tache = (c, x, y, rx, ry, a) => { let l = taches.get(c); if (!l) taches.set(c, l = []); l.push(x, y, rx * U, ry * U, a); };
  for (let j = Math.max(0, Math.floor(y0)); j <= Math.min(VIE.H - 1, y1); j++) for (let i = Math.max(0, Math.floor(x0)); i <= Math.min(VIE.W - 1, x1); i++) {
    const tt = TER[j * VIE.W + i]; if (tt <= 1) continue;
    const cx = i + .5, cy = j + .5, dc = densite(cx, cy);
    if (hash2(i, j, 76) <= dc) {
      const h = hash2(i, j, 77), bx = i + .2 + hash2(i, j, 78) * .6, by = j + .2 + hash2(j, i, 79) * .6;
      const troupe = (n, fn) => { for (let m = 0; m < n; m++) { const ph = m * 2.1 + h * 9, x = bx + Math.cos(ph) * .03 + Math.sin(t * .05 + ph) * .02, y = by + Math.sin(ph * 1.3) * .025 + Math.cos(t * .04 + ph) * .015; if (dans(x, y)) fn(x, y, ph + t * .05, m); } };
      if ((tt === TT.PLAINE || tt === TT.COLLINES || tt === TT.MONTAGNE) && h < .22 * BETES[sa] && neige(cx, cy) < .5) {
        if (SIMPLE) { if (h < .1) troupe(5, (x, y, a, m) => { const robe = m % 2 ? '#efe9dd' : '#c9a07a'; tache(robe, x, y, 4.3, 1.9, a); tache(sombre(robe, .08), ...versMonde(x, y, a, 4.6, 0), 1.4, .95, a); }); else troupe(10, (x, y, a) => tache('#f1efe6', x, y, 1.9, 1.3, a)); }
        else if (h < .1) troupe(5, (x, y, a, m) => { figK(sc, g, x, y, a); const robe = m % 2 ? '#efe9dd' : '#c9a07a'; E(g, robe, 0, 0, 4.3, 1.9); E(g, '#3a2c22', -1.2, .5, 1.4, .9); E(g, sombre(robe, .08), 4.6 + Math.max(0, Math.sin(t + m)) * .8, 0, 1.4, .95); });
        else troupe(10, (x, y, a) => { figK(sc, g, x, y, a); brebis(g, '#f1efe6'); });
      } else if (tt === TT.FORET && h < .16) {
        const sanglier = h < .06;
        if (SIMPLE) troupe(sanglier ? 3 : 4, (x, y, a, m) => { tache(sanglier ? '#3a2c22' : m ? '#9a6a40' : '#8a5a34', x, y, sanglier ? 2.6 : 3.4, sanglier ? 1.3 : 1.2, a); if (!sanglier) tache('#7a4a2a', ...versMonde(x, y, a, 4.9, 0), .9, .55, a); });
        else troupe(sanglier ? 3 : 4, (x, y, a, m) => { figK(sc, g, x, y, a); if (sanglier) { E(g, '#3a2c22', 0, 0, 2.6, 1.3); E(g, '#2a1f18', 2.6, 0, 1, .7); } else { E(g, m ? '#9a6a40' : '#8a5a34', 0, 0, 3.4, 1.2); E(g, '#f1e6d0', -3, 0, .7, .6); T(g, '#8a5a34', .7, 2.6, 0, 4.6, 0); E(g, '#7a4a2a', 4.9, 0, .9, .55); if (!m) { T(g, '#5b3d24', .3, 4.9, -.4, 5.8, -1.6); T(g, '#5b3d24', .3, 4.9, .4, 5.8, 1.6); } } });
      } else if (tt === TT.LANDE && h < .14 && neige(cx, cy) < .5) {
        // le berger landais sur ses échasses : on voit surtout la longue ombre des échasses
        figK(sc, g, bx, by, h * 9);
        T(g, 'rgba(20,20,10,.35)', .5, 1, 1.4, 14, 18); T(g, 'rgba(20,20,10,.35)', .5, 1.5, .4, 15, 16.5); marcheur(g, 3, t * 2, false);
        if (SIMPLE) troupe(12, (x, y, a) => tache('#ece6d6', x + .02, y + .02, 1.9, 1.3, a)); else troupe(12, (x, y, a) => { figK(sc, g, x + .02, y + .02, a); brebis(g, '#ece6d6'); });
      } else if (tt === TT.MARAIS && h < .3) troupe(3, SIMPLE ? (x, y, a) => tache('#d9dcd8', x, y, 1.3, .55, a) : (x, y, a) => { figK(sc, g, x, y, a); E(g, '#d9dcd8', 0, 0, 1.3, .55); T(g, '#c9ccc8', .35, 1.2, 0, 2.6, 0); });   // hérons
      else if (tt === TT.VIGNE && h < .12 && (sa === 'printemps' || sa === 'ete')) troupe(4, (x, y, a, m) => { figK(sc, g, x, y, Math.PI / 2); marcheur(g, m, 0, false); });
    }
    if (hash2(i, j, 80) > dc) continue;
    const h = hash2(i, j, 81), bx = i + .25 + hash2(i, j, 82) * .5, by = j + .25 + hash2(j, i, 83) * .5;
    if (VIE.saline.has(j * VIE.W + i) && (sa === 'ete' || sa === 'automne') && h < .6) paludiers(sc, g, i, j, t);
    if (!dans(bx, by)) continue;
    if (tt === TT.FORET && pinede(bx, by)) { if (h < .22 && sa !== 'hiver') resinier(sc, g, bx, by, t, h); }
    else if (tt === TT.FORET) { if (sa === 'hiver' && h < .1) loups(sc, g, bx, by, t, h); else if (h > .88) bucherons(sc, g, bx, by, t, h); }
    else if ((tt === TT.PLAINE || tt === TT.COLLINES) && neige(bx, by) < .5 && !malheur(bx, by)) {
      if (sa === 'ete' && h < .22) moisson(sc, g, bx, by, t, h);
      else if ((sa === 'automne' || sa === 'printemps') && h > .8) labour(sc, g, bx, by, t, h);
    } else if (tt === TT.VIGNE && sa === 'automne' && h < .45 && !malheur(bx, by)) vendanges(sc, g, bx, by, t, h);
    else if ((tt === TT.MONTAGNE || tt === TT.HAUTE) && sa === 'ete' && h < .3 && neige(bx, by) < .5) estive(sc, g, bx, by, t, h);
  }
  if (taches.size) {
    sc.monde(g);
    for (const [c, l] of taches) { g.fillStyle = c; g.beginPath(); for (let k = 0; k < l.length; k += 5) { g.moveTo(l[k] + l[k + 2] * Math.cos(l[k + 4]), l[k + 1] + l[k + 2] * Math.sin(l[k + 4])); g.ellipse(l[k], l[k + 1], l[k + 2], l[k + 3], l[k + 4], 0, TAU); } g.fill(); }
  }
}

// ---------- l'eau : bateaux, bois flotté, pêcheurs, parcs à huîtres, cabanes tchanquées, carrelets
function eaux(sc, g, x0, y0, x1, y1, epoque) {
  const z = sc.z, t = sc.time, k = Math.max(.006, 2 / z), soir = bivouac(), tempete = k2 => meteoEn(k2.x, k2.y) === 'tempete';
  const vu = bb => !(bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1);
  if (z >= 40) {
    sc.monde(g);
    for (const [x, y, a] of VIE.parcs) { if (x < x0 || x > x1 || y < y0 || y > y1) continue; g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = 'rgba(196,204,186,.4)'; g.fillRect(-.16, -.08, .32, .16); g.strokeStyle = '#5e5440'; g.lineWidth = Math.max(.003, .6 / z); for (let u = -.15; u <= .151; u += .05) { g.beginPath(); g.moveTo(u, -.07); g.lineTo(u, .07); g.stroke(); } g.strokeRect(-.15, -.07, .3, .14); g.restore(); }
    for (const [x, y] of VIE.tchanquees) { if (x < x0 || x > x1 || y < y0 || y > y1) continue; figK(sc, g, x, y, .4, 1.4); for (const [lx, ly] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) T(g, 'rgba(20,30,40,.35)', .5, lx, ly, lx + 6, ly + 8); RR(g, '#8a6a45', -4, -4, 8, 8, .4); bat(g, [{ t: 'g', x: -3, y: -2.5, w: 6, h: 5, p: 'tuile', h2: 1 }], 0, 0, 0, 1); }
    for (const c of VIE.carrelets) { if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue; figK(sc, g, c.x, c.y, c.a, 1.3); T(g, 'rgba(20,30,40,.35)', .6, 2, 1.5, 15, 3.5); T(g, '#6b4d31', .9, 0, 0, 13, 0); RR(g, '#7a5634', -3, -3, 6, 6, .4); RR(g, '#b0503a', -2.4, -2.4, 4.8, 4.8, .3); const lev = Math.sin(t * .15 + c.lev) > .3; g.strokeStyle = lev ? '#d9d2bc' : 'rgba(60,70,70,.55)'; g.lineWidth = .3; g.strokeRect(13, -4, 8, 8); g.beginPath(); g.moveTo(13, -4); g.lineTo(21, 4); g.moveTo(21, -4); g.lineTo(13, 4); g.stroke(); if (lev) for (let m = 0; m < 3; m++) C(g, '#c9d6dd', 15 + m * 2.5, 1 + Math.sin(t * 5 + m), .35); }
  }
  // gabares et navires (dès Z.BATEAUX, à taille constante à l'écran jusqu'au plus près)
  for (const b of VIE.bateaux) {
    if (!vu(b.bb)) continue;
    const p = surChemin(b.pts, mod(b.s0 + t * b.v, b.L)); if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    if (b.mer && tempete(p)) continue;   // la tempête garde les navires au port
    const a = p.a + (b.v < 0 ? Math.PI : 0);
    sc.monde(g); g.save(); g.translate(p.x, p.y); g.rotate(a); g.scale(k, k);
    if (!b.mer && epoque?.vapeur?.(p.x, p.y, b.ph)) {   // (epoque.js) un vapeur à roues sur les fleuves d'un camp qui a les vapeurs
      E(g, 'rgba(20,30,40,.3)', 1.5, 2, 9, 2.4); E(g, '#2f2a26', 0, 0, 9, 2.4); RR(g, '#e8e0cc', -5, -1.4, 7, 2.8, .5);
      for (const s of [-1, 1]) { RR(g, '#5a3d22', -1.8, s * 2.2 - 1, 3.6, 2, .6); }
      C(g, '#7a2a22', 2.6, 0, .9); C(g, '#1c1b1d', 2.6, 0, .5);
      g.restore();
      if (sc.on && Math.random() < .08) fumee(sc, p.x + Math.cos(a) * 2.6 * k, p.y + Math.sin(a) * 2.6 * k, 0, 0, 1.2 * k, 5 * k, 4, .4, 'n');
    } else {
      E(g, 'rgba(20,30,40,.3)', 1.5, 2, b.mer ? 11 : 8, b.mer ? 3 : 2.2); E(g, '#5b4127', 0, 0, b.mer ? 11 : 8, b.mer ? 3 : 2.2); E(g, '#8a6a45', 0, 0, b.mer ? 9.5 : 6.6, b.mer ? 2 : 1.4);
      if (b.mer) for (const m of [-4, 0, 4]) RR(g, '#ece4cc', m - .8, -4.5, 1.6, 9, .4); else { RR(g, '#e0d2ab', -1, -3.6, 2, 7.2, .4); RR(g, '#b8a27a', -6, -1.2, 4, 2.4, .4); }
      g.restore();
    }
    if (soir) LUM.push({ x: p.x, y: p.y, r: .02, a: .7, spr: 'fen' });
  }
  if (z < 18) return;
  for (const b of VIE.peche) {
    const ang = t * b.v / b.r + b.ph, x = b.x + Math.cos(ang) * b.r, y = b.y + Math.sin(ang) * b.r * .6; if (x < x0 || x > x1 || y < y0 || y > y1 || tempete(b)) continue;
    const a = Math.atan2(Math.cos(ang) * .6, -Math.sin(ang));
    sc.monde(g); g.save(); g.translate(x, y); g.rotate(a); g.scale(k, k);
    for (let i = 0; i < 9; i++) { const aa = Math.PI * .5 + i / 8 * Math.PI; C(g, '#efe6cc', -6 + Math.cos(aa) * 7, Math.sin(aa) * 7, .45); }   // les flotteurs du filet
    E(g, 'rgba(20,30,40,.3)', 1.2, 1.6, b.pinasse ? 6 : 8, 1.8); E(g, b.pinasse ? '#2f4a5a' : '#5b4127', 0, 0, b.pinasse ? 6 : 8, 1.8); E(g, '#8a6a45', 0, 0, b.pinasse ? 5 : 7, 1.1);
    C(g, '#7a6a4f', -1.5, 0, .9); C(g, '#5d6b86', 2, 0, .9);
    g.restore();
    if (soir) LUM.push({ x, y, r: .02, a: .8, spr: 'fen' });
  }
  for (const r of VIE.radeaux) {
    if (!vu(r.bb)) continue;
    const p = surChemin(r.pts, mod(r.s0 + r.v * t, r.L)); if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    sc.monde(g); g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.scale(k, k);
    for (let m = 0; m < 3; m++) { RR(g, 'rgba(20,30,40,.3)', -4 - m * 11, -1.6, 10, 4.4, .6); for (let l = 0; l < 4; l++) RR(g, l % 2 ? '#7a5634' : '#8d6a44', -5 - m * 11, -2.2 + l * 1.1, 10, 1, .45); if (m) T(g, '#5b4127', .4, -m * 11 + 5, 0, -m * 11 + 6, 0); }
    g.save(); g.translate(2, 0); marcheur(g, 2, 0, false); T(g, '#6b4d31', .4, 0, 1, 7, 4); g.restore();   // le radelier et sa perche
    g.restore();
  }
}
function relaisPoste(sc, g, x0, y0, x1, y1) {
  for (const r of VIE.relais) {
    if (r.x < x0 - .2 || r.x > x1 + .2 || r.y < y0 - .2 || r.y > y1 + .2) continue;
    const nx = -Math.sin(r.a) * r.c, ny = Math.cos(r.a) * r.c, x = r.x + nx * .1, y = r.y + ny * .1, a = r.a + (r.c < 0 ? Math.PI : 0);
    sc.monde(g); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#cdbf9f'; g.fillRect(-.05, -.03, .1, .06); g.restore();
    bat(g, [{ t: 'g', x: -14, y: -9, w: 28, h: 7, p: 'tuile', h2: 1.6 }, cheminee(-8, -6), { t: 'g', x: 8, y: -2, w: 7, h: 12, p: 'tuile', h2: 1.3 }, { t: 'g', x: -14, y: 4, w: 16, h: 6, p: 'chaume', h2: 1.1 }], x, y, a, U * 1.1);
    if (sc.z >= Z.VIE) for (let m = 0; m < 4; m++) { if (hash2(m, r.x * 10 | 0, 96) > densite(x, y) + .3) continue; figK(sc, g, ...versMonde(x, y, a, -6 + m * 4, 1.5, 1.1), a + Math.PI / 2 + m * .3); cheval(g, ['#6b4a2c', '#8b6a47', '#3f2d1f', '#54402e'][m], { bob: 0 }); }   // les chevaux de relève dans la cour
    LUM.push({ x: r.x + nx * .06, y: r.y + ny * .06, r: .03, a: .8, spr: 'fen' });   // la lanterne du relais
  }
}
function contrebande(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time;
  for (const P of VIE.sentiers) {
    const [a, b, c, d] = P.bb; if (c < x0 || a > x1 || d < y0 || b > y1) continue;
    sc.monde(g); g.setLineDash([Math.max(.02, 3 / z), Math.max(.015, 2 / z)]); ligne(g, P.pts); g.strokeStyle = 'rgba(189,169,127,.85)'; g.lineWidth = Math.max(.008, .9 / z); g.stroke(); g.setLineDash([]);
    if (z < 60) continue;
    const u = t * .0035 + P.ph * 50, s = pingpong(u, P.L), dir = mod(u, 2 * P.L) < P.L ? 1 : -1;
    // les contrebandiers passent plutôt la nuit, et pas sous les yeux d'une armée
    if (hash2(P.ph * 9 | 0, 1, 143) < densite(P.pts[0][0], P.pts[0][1]) + (AMB.heure === 'nuit' ? .9 : .5)) for (let m = 0; m < 5; m++) {
      const q = surChemin(P.pts, clamp(s - dir * m * .014, 0, P.L)); if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1) continue;
      figK(sc, g, q.x, q.y, q.a + (dir < 0 ? Math.PI : 0)); const pas = t * 1.5 * TAU + m;
      if (m % 2) { cheval(g, '#5e4b3a', { gait: pas, bob: 0 }); RR(g, '#c9b48a', -2.4, -3.6, 4.8, 1.7, .4); RR(g, '#c9b48a', -2.4, 1.9, 4.8, 1.7, .4); T(g, '#6b4d31', .3, 0, -2, 0, 2); }   // mulets chargés de ballots
      else { fantassin(g, CIVILS[m].L, { role: 'h', habit: '#3a3530' }, { legs: pas, arme: 'aucun' }); C(g, '#2a2622', -.2, 0, 1.1); }   // le béret noir
    }
    // les douaniers font leur ronde au pied du sentier
    const qd = surChemin(P.pts, pingpong(t * .0018, Math.min(1.2, P.L)));
    LDOU ??= tenue('fr', 'chasseurs');
    if (qd.x > x0 && qd.x < x1 && qd.y > y0 && qd.y < y1) for (let m = 0; m < 2; m++) { figK(sc, g, qd.x + m * .006, qd.y + m * .004, qd.a); fantassin(g, LDOU, { role: 'h' }, { legs: t * 4 + m, arme: 'epaule' }); }
  }
}
function cordouan(sc, g) {
  const { x, y } = VIE.cordouan, k = Math.max(.012, 2.4 / sc.z);
  sc.monde(g);
  C(g, 'rgba(222,212,180,.55)', x, y, k * 3.2); C(g, 'rgba(160,150,128,.6)', x, y, k * 2.2);   // le plateau de roches et l'enceinte
  T(g, 'rgba(20,20,10,.3)', k * .9, x, y, x + k * 3, y + k * 4);   // la longue ombre de la tour
  C(g, '#9b917c', x, y, k * 1.5); C(g, '#efe9da', x, y, k); C(g, '#d9d2bf', x + k * .2, y + k * .2, k * .55); C(g, '#8696a8', x, y, k * .4);
}
function moulins(sc, g, x0, y0, x1, y1) {
  const t = sc.time;
  for (const m of VIE.moulins) {
    if (m.x < x0 - .2 || m.x > x1 + .2 || m.y < y0 - .2 || m.y > y1 + .2) continue;
    const w = ventDe(meteoEn(m.x, m.y));
    sc.monde(g); g.save(); g.translate(m.x, m.y); g.scale(1 / 180, 1 / 180);
    moulinVu(g, 0, 0, m.ph + t * m.sp * w * 1.4, sc.ventA);
    g.restore();
  }
}
// marchés sur la place des villes du joueur qui en ont un ; la foire hors les murs (vivante.js marches)
function marches(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time, peu = AMB.heure === 'nuit' ? 0 : AMB.heure === 'soir' ? .4 : 1;
  if (!peu) return;
  if (z >= 40) for (const { n, x: mx, y: my } of VIE.marches) {
    if (mx < x0 - 1 || mx > x1 + 1 || my < y0 - 1 || my > y1 + 1) continue;
    const pop = n.pop0 || 700, N = clamp(Math.round(4 + Math.sqrt(pop) / 4), 5, 26), R0 = Math.min(40, 14 + Math.sqrt(pop) / 6);
    figK(sc, g, mx, my, 0);
    for (let k = 0; k < N; k++) { const a = k * 2.4, d = R0 * (.3 + .7 * Math.sqrt((k + .5) / N)); g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(a + Math.PI / 2); etal(g, k); g.restore(); }
    const M = Math.round(N * 2 * peu * Math.min(1, densite(mx, my) * 2));
    for (let m = 0; m < M; m++) {
      const a = m * 2.17 + Math.sin(t * .05 + m) * .4, d = R0 * (.2 + Math.sqrt((m + .5) / (N * 2)) * 1.15), px = Math.cos(a) * d, py = Math.sin(a) * d;
      if (z >= Z.VIE) { g.save(); g.translate(px, py); g.rotate(a + Math.PI / 2 + Math.sin(t * .3 + m)); marcheur(g, m, t * 4 + m, m % 3 === 0); g.restore(); }
      else C(g, CIVILS[m % CIVILS.length].habit, px, py, Math.max(1.2, 1 / (z * U)));
    }
  }
  if (z < 30) return;
  for (const f of VIE.foires) {
    const { x, y, a, n } = f;
    if (x < x0 - .5 || x > x1 + .5 || y < y0 - .5 || y > y1 + .5) continue;
    sc.monde(g); pietine(g, x, y, .16, .1, a, .32);
    figK(sc, g, x, y, a);
    for (let q = 0; q < 3; q++) { const ox = (q - 1) * 20 - 8, oy = -8; cloture(g, ox, oy, 16, 12); for (let m = 0; m < 5; m++) { const mx = ox + 3 + (m % 3) * 5, my = oy + 3 + (m / 3 | 0) * 6; if (q === 0) vache(g, mx, my, m, m % 2 ? '#efe9dd' : '#c9a07a'); else if (q === 1) { g.save(); g.translate(mx, my); g.rotate(m); g.scale(.6, .6); cheval(g, ['#6b4a2c', '#8b6a47', '#3f2d1f'][m % 3], { bob: 0 }); g.restore(); } else for (let s2 = 0; s2 < 2; s2++) mouton(g, mx + s2 * 2, my + s2, m); } }
    for (let k = 0; k < 4; k++) { g.save(); g.translate(-20 + k * 13, 12); g.scale(1.4, 1.4); etal(g, k + 2); g.restore(); }
    for (let m = 0; m < 40 * peu; m++) { const px = (hash2(m, n.id, 124) - .5) * 60 + Math.sin(t * .1 + m) * 2, py = (hash2(n.id, m, 125) - .5) * 30 + 4; if (z >= Z.VIE) { g.save(); g.translate(px, py); g.rotate(m); marcheur(g, m, t * 4 + m, false); g.restore(); } else C(g, CIVILS[m % CIVILS.length].habit, px, py, Math.max(1.2, 1 / (z * U))); }
  }
}

// ---------- dans le ciel : fumées des cheminées, ombres des nuages, oiseaux
function fumees(sc, x0, y0, x1, y1) {
  if (!sc.on || sc.z < 14) return;
  const k = AMB.saison === 'hiver' ? 2 : AMB.saison === 'ete' ? .5 : 1;
  for (const n of NOEUDS) {
    if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
    const r = rayonPlace(n);
    if (Math.random() < .04 * (n.type === 'village' ? 1 : 3) * densite(n.x, n.y) * k) fumee(sc, n.x + (Math.random() - .5) * r, n.y + (Math.random() - .5) * r, 0, 0, .01, .07, 5, .3);
  }
}
function nuages(sc, g, x0, y0, x1, y1) {
  // seulement par beau temps, de jour : l'ombre des nuages qui passent glisse sur les pays
  if (AMB.heure === 'nuit') return;
  sc.monde(g); g.globalAlpha = .1;
  for (let k = 0; k < 14; k++) {
    const r = 9 + hash2(k, 1, 5) * 14, x = mod(hash2(k, 2, 5) * (VIE.W + 60) + sc.time * .05, VIE.W + 60) - 30, y = mod(hash2(k, 3, 5) * (VIE.H + 60) - sc.time * .02, VIE.H + 60) - 30;
    const mt = meteoEn(x, y); if (mt !== 'soleil' && mt !== 'nuages' && mt !== 'canicule') continue;
    if (x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1) g.drawImage(SPR.n, x - r, y - r * .7, r * 2, r * 1.4);
  }
  g.globalAlpha = 1;
}
// un oiseau : deux ailes en croissant, ajoutées au tracé p en pixels de l'écran
function oiseau(p, sc, x, y, a, s, fl) {
  const m = sc.m, ox = (x - sc.cx) * m + sc.W / 2, oy = (y - sc.cy) * m + sc.H / 2, c = Math.cos(a) * s * m, sn = Math.sin(a) * s * m;
  const P = (u, v) => [ox + u * c - v * sn, oy + u * sn + v * c];
  const [ax, ay] = P(-.5, -1 + fl * .4), [bx, by] = P(0, -.2), [cx, cy] = P(.35, 0), [dx, dy] = P(0, .2), [ex, ey] = P(-.5, 1 - fl * .4);
  p.moveTo(ax, ay); p.quadraticCurveTo(bx, by, cx, cy); p.quadraticCurveTo(dx, dy, ex, ey);
}
function oiseaux(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time, sa = AMB.saison, W = VIE.W, H = VIE.H; if (z < 4) return;
  const s = Math.max(U * 2.4, 2.2 / z), P = { '#3a3530': new Path2D(), '#5a5f6a': new Path2D(), '#f4f2ea': new Path2D(), '#2a2622': new Path2D() };
  const vu = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (const v of VIE.vols) {
    if (v.sorte === 'grues' && (sa === 'printemps' || sa === 'automne')) {
      const a = sa === 'printemps' ? -.75 : Math.PI - .75, cx = mod(v.x + Math.cos(a) * .06 * t, W + 100) - 50, cy = mod(v.y + Math.sin(a) * .06 * t, H + 100) - 50;
      if (!vu(cx, cy) && Math.hypot(cx - (x0 + x1) / 2, cy - (y0 + y1) / 2) > (x1 - x0) + s * 40) continue;
      for (let m = 0; m < 21; m++) { const r = Math.ceil(m / 2), sg = m % 2 ? 1 : -1, x = cx - Math.cos(a) * r * s * 2.2 - Math.sin(a) * sg * r * s * 1.8, y = cy - Math.sin(a) * r * s * 2.2 + Math.cos(a) * sg * r * s * 1.8; if (vu(x, y)) oiseau(P['#3a3530'], sc, x, y, a, s, Math.sin(t * 5 + m * .4)); }
    } else if (v.sorte === 'palombes' && sa === 'automne') {
      const a = Math.PI - .6, cx = mod(v.x + Math.cos(a) * .07 * t, 120) + 60, cy = mod(v.y + Math.sin(a) * .07 * t, 150) + 100;   // les palombes passent sur les Landes
      if (cx + s * 13 < x0 || cx - s * 13 > x1 || cy + s * 7 < y0 || cy - s * 7 > y1) continue;
      for (let m = 0; m < 60; m++) { const x = cx + (hash2(m, v.k, 130) - .5) * s * 26, y = cy + (hash2(v.k, m, 131) - .5) * s * 14; if (vu(x, y)) oiseau(P['#5a5f6a'], sc, x, y, a, s, Math.sin(t * 7 + m)); }
    } else if (v.sorte === 'mouettes') {
      const Pt = VIE.ports[v.k / 4 % VIE.ports.length | 0]; if (!Pt || Pt.x < x0 - 1 || Pt.x > x1 + 1 || Pt.y < y0 - 1 || Pt.y > y1 + 1) continue;
      for (let m = 0; m < 12; m++) { const ph = t * .05 + m * .52 + v.ph, r = .25 + (m % 4) * .1, x = Pt.x + Math.cos(ph) * r - .4, y = Pt.y + Math.sin(ph) * r * .7 - .3; if (vu(x, y)) oiseau(P['#f4f2ea'], sc, x, y, ph + Math.PI / 2, s, Math.sin(t * 3 + m) * .5); }
    } else if (v.sorte === 'etourneaux' && AMB.heure === 'soir' && VIE.saline.size) {
      const k0 = [...VIE.saline][v.k * 37 % VIE.saline.size], cx = k0 % W + .5, cy = (k0 / W | 0) + .5;
      if (cx < x0 - 1 || cx > x1 + 1 || cy < y0 - 1 || cy > y1 + 1) continue;
      for (let m = 0; m < 160; m++) { const ph = m * .7, x = cx + Math.sin(t * .4 + ph) * .35 + Math.sin(t * .23 + ph * 1.7) * .2, y = cy + Math.cos(t * .31 + ph * 1.3) * .22; if (vu(x, y)) oiseau(P['#2a2622'], sc, x, y, t + ph, s, Math.sin(t * 9 + m)); }
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0); g.lineCap = 'round'; g.lineWidth = Math.max(1, .28 * s * sc.m);
  for (const [c, p] of Object.entries(P)) { g.strokeStyle = c; g.stroke(p); }
}

// ---------- les deux passes de l'image. sc : la scène (monde, fig, z, m, time, fx, on) ; bornes en km
export const Z_BATEAUX = 10;
export function dessinerSol(sc, g, x0, y0, x1, y1, epoque) {
  const z = sc.z;
  SIMPLE = sc.m * U < 1;
  if (VIE.cordouan && z >= 2.5) cordouan(sc, g);
  if (z >= Z_BATEAUX) eaux(sc, g, x0, y0, x1, y1, epoque);
  if (z >= 30) { relaisPoste(sc, g, x0, y0, x1, y1); contrebande(sc, g, x0, y0, x1, y1); }
  if (z >= 40) moulins(sc, g, x0, y0, x1, y1);
  if (z >= Z.VIE) vieDePres(sc, g, x0, y0, x1, y1);
}
export function dessinerDessus(sc, g, x0, y0, x1, y1) {
  const z = sc.z;
  SIMPLE = sc.m * U < 1;
  if (z >= 30) marches(sc, g, x0, y0, x1, y1);
  fumees(sc, x0, y0, x1, y1);
  // les fumées (lib.js fumee) : avancent avec le vent, grossissent et pâlissent
  if (sc.fx.length) {
    sc.monde(g);
    for (const f of sc.fx) { const p = f.age / f.life, r = lerp(f.r0, f.r1, 1 - (1 - p) ** 2); g.globalAlpha = f.al * (p < .08 ? p / .08 : (1 - p) ** 1.3); g.drawImage(SPR[f.spr], f.x - r, f.y - r, r * 2, r * 2); }
    g.globalAlpha = 1;
  }
  nuages(sc, g, x0 - 25, y0 - 25, x1 + 25, y1 + 25);
  oiseaux(sc, g, x0, y0, x1, y1);
}
// avance les fumées de dt secondes, poussées par le vent (km/s)
export function avancer(sc, dt, wx, wy) {
  const amort = Math.exp(-dt * 1.6);
  for (const f of sc.fx) { f.age += dt; f.x += (f.vx + wx) * dt; f.y += (f.vy + wy) * dt; f.vx *= amort; f.vy *= amort; }
  if (sc.fx.some(f => f.age >= f.life)) sc.fx = sc.fx.filter(f => f.age < f.life);
}
