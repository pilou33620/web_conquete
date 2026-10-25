// La guerre sur la carte vue du ciel (SPEC-CARTE-2D.md, chantier D), d'après l'état de la partie : colonnes de
// route et bivouacs des armées, traces de leur passage et villages pillés, réfugiés devant l'ennemi, sièges et
// batailles. On ne dessine que ce que l'état montre : une armée cachée par le brouillard n'a ni colonne ni traces.
// Les figures et la plupart des dessins viennent de la maquette (web/js/dev/carte/new.js et vivante.js).
import { C, E, T, RR, PG, TAU, SPR, avant, caisson, cavalier, cheval, clair, clamp, distPoly, fantassin, lerp, ligne,
         mod, piece, pietine, sombre, surChemin, tenue } from './lib.js';
import { LUM, U, Z, bivouac, nuit } from './ambiance.js';
import { S as SU, carteDe, etatVille, planDe } from './villes.js';

export const VENT = [0.004, -0.002];   // km/s : le vent d'ouest emporte les fumées vers l'est
const hash2 = (i, j, k = 0) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const pingpong = (s, L) => { const m = mod(s, 2 * L); return m < L ? m : 2 * L - m; };
const versMonde = (x, y, a, lx, ly) => [x + (lx * Math.cos(a) - ly * Math.sin(a)) * U, y + (lx * Math.sin(a) + ly * Math.cos(a)) * U];
const longueur = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
// le morceau [s0, s1] d'une polyligne
function cheminEntre(pts, s0, s1) {
  const out = []; let acc = 0; if (s1 <= s0) return out;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay), a = acc; acc += l;
    if (!l || acc < s0) continue; if (a > s1) break;
    const k0 = clamp((s0 - a) / l, 0, 1), k1 = clamp((s1 - a) / l, 0, 1);
    if (!out.length) out.push([lerp(ax, bx, k0), lerp(ay, by, k0)]);
    out.push([lerp(ax, bx, k1), lerp(ay, by, k1)]);
  }
  return out;
}
// parcourt une polyligne de s0 à s1 par pas réguliers : fn(x, y, angle, s)
function parPas(pts, s0, s1, pas, fn) {
  let acc = 0, s = s0;
  for (let i = 1; i < pts.length && s <= s1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay);
    if (!l) continue;
    const a = Math.atan2(by - ay, bx - ax);
    while (s <= acc + l && s <= s1) { const k = (s - acc) / l; fn(ax + (bx - ax) * k, ay + (by - ay) * k, a, s); s += pas; }
    acc += l;
  }
}

// ------------------------------------------------------------------ rayon d'une place
// rayon de la ville bâtie (km), d'après sa population, comme le plan des villes (carte/villes.js) : un village,
// 300 m ; Bordeaux, un kilomètre et demi
export const rayonPlace = (n, ns) => Math.round(clamp(46 + 1.55 * Math.sqrt(ns?.pop || n.pop0 || 700), 56, 262) / 8) * 8 / 180;
// rayon extérieur des remparts (km), d'après le mur du plan de la ville (carte/villes.js, V.rMur) et la forme de
// l'enceinte de map.js (walls : les bastions et les demi-lunes débordent le mur)
const MURS = new Map();
export function rayonMurs(map, n, ns) {
  const e = etatVille(n, ns, map.state), k = n.id + ':' + e.f + ':' + e.pop + ':' + e.d + ':' + e.annee;
  let r = MURS.get(k);
  if (r == null) {
    const V = planDe(carteDe(map.m), n, e), f = e.f;
    r = Math.max(rayonPlace(n, ns) * 1.1, V.rMur / SU * (f >= 4 ? 1.62 : f >= 3 ? 1.42 : 1.06));
    if (MURS.size > 400) MURS.clear();
    MURS.set(k, r);
  }
  return r;
}

// ------------------------------------------------------------------ la colonne de route
// La composition d'une armée en marche, de la tête à la queue, d'après ses régiments (regs : [id, type, hommes, …]) :
// avant-garde (cavalerie, à défaut les voltigeurs), état-major, bataillons par quatre avec officier, tambours et
// drapeau, artillerie attelée et ses servants, caissons, bagages, arrière-garde. Une figure vaut trois hommes.
// cls(type) : 'inf' | 'cavalerie' | 'artillerie' ; leger(type) : infanterie légère. Chaque élément porte sa distance
// à la tête (d, km) ; long : la longueur de la colonne.
const RANG_INF = { legere: 0, chasseurs: 0, ligne: 1, milice: 1, grenadiers: 2, garde: 3, sapeurs: 4 };
export function compoColonne(regs, cls, leger, gen) {
  const inf = [], cav = [], art = [], c = [];
  for (const r of regs) { const k = cls(r[1]); (k === 'cavalerie' ? cav : k === 'artillerie' ? art : inf).push(r); }
  inf.sort((p, q) => (RANG_INF[p[1]] ?? 1) - (RANG_INF[q[1]] ?? 1));
  const escadrons = (r, part) => { for (let k = 0, n = clamp(Math.round(r[2] / 25 * part), 1, 8); k < n; k++) c.push({ k: 'cav', t: r[1], r: k, gap: 1.4 }); };
  let nb = 0;
  const bataillon = r => {
    const b = nb++, rangs = clamp(Math.round(r[2] / 12), 3, 25), dr = Math.min(8, rangs >> 1);
    c.push({ k: 'off', t: r[1], b, gap: 3.5 }); c.push({ k: 'tambours', t: r[1], b, gap: 1.4 });
    for (let k = 0; k < rangs; k++) c.push({ k: 'rang', t: r[1], r: k, b, gap: 1.15, drapeau: k === dr });
  };
  // avant-garde
  if (cav.length) escadrons(cav[0], cav.length > 1 ? 1 : 0.5);
  else { const l = inf.findIndex(r => leger(r[1])); if (l >= 0) bataillon(inf.splice(l, 1)[0]); }
  c.push({ k: 'etat', gen: !!gen, gap: 3 });
  for (const r of inf) bataillon(r);
  for (const r of cav.slice(1, -1)) escadrons(r, 1);
  let pieces = 0;
  for (const r of art) for (let p = 0, n = clamp(Math.round(r[2] / 40), 1, 4); p < n; p++, pieces++) { c.push({ k: 'piece', t: r[1], gap: p ? 6 : 4 }); c.push({ k: 'servants', t: r[1], gap: 2 }); }
  for (let w = 0; w < Math.min(6, pieces); w++) c.push({ k: 'caisson', gap: 5 });
  const hommes = regs.reduce((s, r) => s + (r[2] || 0), 0);
  for (let w = 0, n = clamp(Math.round(hommes / 1500), 1, 6); w < n; w++) c.push({ k: 'bagage', w, gap: 5 });
  // arrière-garde : la cavalerie qui reste, sinon quelques rangs d'infanterie
  if (cav.length) escadrons(cav[cav.length - 1], cav.length > 1 ? 1 : 0.5);
  else if (inf.length) for (let k = 0; k < 3; k++) c.push({ k: 'rang', t: inf[inf.length - 1][1], r: k, b: -1, gap: 1.15 });
  let d = 0; for (const e of c) { d += e.gap * 5 * U; e.d = d; }
  return { liste: c, long: d };
}

// ------------------------------------------------------------------ la géométrie d'un siège
// Autour d'une place de rayon r (km), du côté de la terre : trois parallèles, quatre boyaux en zigzag qui les
// relient, cinq batteries, le camp des assiégeants en retrait, des foyers d'incendie dans la ville.
// mouille(x, y) : vrai sur l'eau (fleuve, estuaire, mer). Le côté de la terre est celui où il y a le moins d'eau.
export function geoSiege(x, y, r, mouille, id = 0) {
  let aT = 0, best = -1;
  for (let k = 0; k < 16; k++) {
    const a = k * TAU / 16; let sec = 0;
    for (let da = -0.9; da <= 0.9; da += 0.3) for (const d of [r + 0.6, r + 1.2, r + 2]) if (!mouille(x + Math.cos(a + da) * d, y + Math.sin(a + da) * d)) sec++;
    if (sec > best + 0.5) { best = sec; aT = a; }
  }
  const arc = (rr, a0, a1) => { const segs = []; let cur = []; for (let a = a0; a <= a1; a += 0.02) { const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (mouille(px, py)) { if (cur.length > 1) segs.push(cur); cur = []; } else cur.push([px, py]); } if (cur.length > 1) segs.push(cur); return segs; };
  const paralleles = [0.55, 0.9, 1.3].flatMap(d => arc(r + d, aT - 1.25, aT + 1.25));
  const boyaux = [-0.8, -0.3, 0.25, 0.75].map(da => { const pts = []; for (let k = 0; k <= 8; k++) { const rr = r + 1.45 - k * 0.12, a = aT + da + (k % 2 ? 0.05 : -0.05); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); } return pts; }).filter(p => !p.some(q => mouille(...q)));
  const batteries = [-0.9, -0.45, 0, 0.45, 0.9].map((da, k) => { const a = aT + da; return { x: x + Math.cos(a) * (r + 0.9), y: y + Math.sin(a) * (r + 0.9), a: a + Math.PI, tir: -k * 1.3 }; }).filter(b => !mouille(b.x, b.y));
  const feux = Array.from({ length: 7 }, (_, k) => { const a = hash2(k, id, 61) * TAU, d = Math.sqrt(hash2(k, id + 2, 61)) * r * 0.7; return [x + Math.cos(a) * d, y + Math.sin(a) * d]; });
  const camp = [], cx = x + Math.cos(aT) * (r + 2.3), cy = y + Math.sin(aT) * (r + 2.3);
  // (en rangs, avec des rues entre les compagnies ; pas tout à fait alignés)
  for (let q = 0; q < 10; q++) for (let w = 0; w < 6; w++) {
    if (hash2(q, w + id, 62) < 0.12) continue;
    const u = (q - 4.5) * 0.055 + (q >= 5 ? 0.04 : 0) + (hash2(q, w, 63) - 0.5) * 0.012, v = (w - 2.5) * 0.06 + (hash2(w, q, 64) - 0.5) * 0.012;
    const px = cx - Math.sin(aT) * u + Math.cos(aT) * v, py = cy + Math.cos(aT) * u + Math.sin(aT) * v;
    if (!mouille(px, py)) camp.push([px, py, q, w]);
  }
  return { x, y, r, aT, paralleles, boyaux, batteries, feux, camp, impacts: [] };
}

// ------------------------------------------------------------------ la densité de la vie (pour carte/vie.js)
// les zones de guerre de la dernière image : personne autour d'un siège ou d'une bataille, moins de monde devant
// l'ennemi. densiteGuerre(x, y) : de 0 (désert) à 1 (rien ne trouble la vie)
const ZONES = [];
export function densiteGuerre(x, y) {
  let d = 1;
  for (const z of ZONES) if (Math.abs(x - z.x) < z.r && Math.abs(y - z.y) < z.r && Math.hypot(x - z.x, y - z.y) < z.r) d = Math.min(d, z.d);
  return d;
}

// ------------------------------------------------------------------ petits dessins (unités de figure)
const LCIV = tenue('fr', 'civil');
const CIVILS = ['#7a6a4f', '#5d6b86', '#8a5a44', '#6e5c45', '#4f5a6a', '#9a4a3a'].map((h, i) => ({ L: Object.assign({}, LCIV, { tete: i % 2 ? 'coiffe' : 'rond' }), habit: h }));
function marcheur(g, k, pas, bagage) { const c = CIVILS[k % CIVILS.length]; fantassin(g, c.L, { role: 'h', habit: c.habit }, { legs: pas, arme: 'aucun' }); if (bagage) C(g, '#b9a37a', -2.1, 0, 1.4); }
function charrette(g, pas, boeufs, k) {
  for (const x of [-4, 4]) { RR(g, '#3a2a1b', x - 2, -3.7, 4, 1, 0.4); RR(g, '#3a2a1b', x - 2, 2.7, 4, 1, 0.4); }
  T(g, '#5b4127', 0.6, 6, 0, 10, 0); RR(g, '#8a6a45', -6.5, -2.9, 13, 5.8, 0.6);
  RR(g, ['#b8a27a', '#d6ba5c', '#6b8fb5'][k % 3], -5.5, -2.2, 10, 4.4, 0.5);
  for (const y of boeufs ? [-2.4, 2.4] : [0]) { g.save(); g.translate(15, y); cheval(g, boeufs ? '#d2bf95' : '#6b4a2c', { gait: pas, bob: 0 }); g.restore(); }
}
function vache(g, x, y, a, robe) { E(g, 'rgba(20,32,12,.42)', x + 1, y + 1.3, 4.3, 1.9, a); E(g, robe, x, y, 4.3, 1.9, a); E(g, sombre(robe, 0.1), x + Math.cos(a) * 4.6, y + Math.sin(a) * 4.6, 1.4, 0.95, a); }
function tente(g, c = '#ece6d4') { RR(g, 'rgba(20,20,10,.3)', -2.2, -1.2, 6, 4.2, 0.4); PG(g, clair(c, 0.06), [-3, -2, 3, -2, 3, 0, -3, 0]); PG(g, sombre(c, 0.14), [-3, 0, 3, 0, 3, 2, -3, 2]); T(g, sombre(c, 0.3), 0.35, -3, 0, 3, 0); }
function feuCamp(g, t, k) { C(g, '#5a5148', 0, 0, 1.8); C(g, '#2a211b', 0, 0, 1.3); const f = 1 + 0.25 * Math.sin(t * 9 + k); C(g, '#e2702a', 0, 0, 0.9 * f); C(g, '#ffd27a', 0, 0, 0.45 * f); }
function flamme(g, x, y, r, t, k) { const f = 1 + 0.2 * Math.sin(t * 11 + k) + 0.1 * Math.sin(t * 23 + k * 2); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.9; g.drawImage(SPR.fl, x - r * f, y - r * 1.25 * f, r * 2 * f, r * 2.5 * f); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
// réfugiés : charrette chargée des meubles, familles à pied, bêtes poussées devant, brouette
function refugie(g, sorte, pas, k) {
  if (sorte < 0.3) {
    charrette(g, pas, sorte < 0.12, k);
    RR(g, '#5b3d24', -5, -2, 3.2, 4, 0.3); RR(g, '#d9cfb4', -1.4, -2, 4, 4, 0.6); T(g, '#9a4a3a', 0.5, -1.4, 0, 2.6, 0); C(g, '#6b4a2c', 3.4, 1, 0.9);
    g.save(); g.translate(-12, 1.5); marcheur(g, k + 1, pas, true); g.restore();
  } else if (sorte < 0.55) {
    marcheur(g, k, pas, true); g.save(); g.translate(-4, 2.2); marcheur(g, k + 1, pas + 1, true); g.restore();
    g.save(); g.translate(-2.5, -2.3); g.scale(0.7, 0.7); marcheur(g, k + 2, pas * 1.3, false); g.restore();
  } else if (sorte < 0.75) {
    for (let m = 0; m < 3; m++) vache(g, 6 + m * 2, (m - 1) * 4, 0, m % 2 ? '#efe9dd' : '#c9a07a');
    marcheur(g, k, pas, false); T(g, '#6b4d31', 0.4, 0.4, 2, 5, 2.8);
  } else {
    RR(g, '#8a6a45', 1, -1.6, 5, 3.2, 0.5); RR(g, '#d9cfb4', 1.5, -1.2, 4, 2.4, 0.5); C(g, '#3a2a1b', 6.5, 0, 0.8); T(g, '#6b4d31', 0.4, 1, -1.4, -1, -1.6); T(g, '#6b4d31', 0.4, 1, 1.4, -1, 1.6);
    marcheur(g, k, pas, false);
  }
}
function debris(g, h) {
  if (h < 0.3) { E(g, '#5a4a3c', 0, 0, 5, 2, 0.2); E(g, '#4a3c30', 5, -0.6, 2, 0.9, 0.5); for (const [lx, ly] of [[2, 1.6], [-2, 1.6]]) T(g, '#3a2e24', 0.7, lx, ly, lx + 1, ly + 3); }
  else if (h < 0.6) { g.rotate(0.5); RR(g, '#7a5b3a', -6, -2.9, 12, 5.8, 0.6); RR(g, '#3a2a1b', 3, -3.7, 4, 1, 0.4); C(g, '#3a2a1b', -9, 3, 2.2); C(g, '#7a5b3a', -9, 3, 1.4); }
  else { RR(g, '#8a6a45', -1, -1, 2.4, 2, 0.4); C(g, '#1c1b1d', 3, 1, 1.1); T(g, '#5b4127', 0.5, -4, -2, 2, -3); }
}
// le drapeau d'un camp : sa couleur, une cravate blanche, qui flotte au vent (comme drapeau() de lib.js)
function drapeauCamp(g, col, x, y, t, r, petit) {
  const n = 8, long = petit ? 6.5 : 11, larg = petit ? 4 : 7, wa = -0.4 + Math.sin(t * 0.5 + r) * 0.1, ca = Math.cos(wa), sa = Math.sin(wa), nx = -sa, ny = ca;
  const bord = (s, o) => { const w = Math.sin(t * 6 - s * 5 + r * 9) * 1.1 * s; return [x + ca * long * s + nx * (o + w), y + sa * long * s + ny * (o + w)]; };
  const bande = (s0, s1, o0, o1, c) => {
    g.fillStyle = c; g.beginPath();
    for (let i = 0; i <= n; i++) { const p = bord(s0 + (s1 - s0) * i / n, o0); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }
    for (let i = n; i >= 0; i--) { const p = bord(s0 + (s1 - s0) * i / n, o1); g.lineTo(p[0], p[1]); }
    g.closePath(); g.fill();
  };
  g.save(); g.translate(1.8, 2.4); bande(0, 1, -larg / 2, larg / 2, 'rgba(20,20,10,.22)'); g.restore();
  bande(0, 1, -larg / 2, larg / 2, col); bande(0, 0.2, -larg / 2, larg / 2, '#f4f1ea'); bande(0.2, 1, -0.6, 0.6, clair(col, 0.45));
  C(g, '#3b2a1a', x, y, 0.55); C(g, '#d9b44a', x, y, 0.35);
}

// les tenues d'un camp : celles de la maquette, l'habit à la couleur du camp
const TYPE_TENUE = { garde: 'grenadiers', milice: 'milice' };
function teinteHabit(type, col) {
  switch (type) {
    case 'cavalerie': return sombre(col, 0.12);
    case 'artillerie': case 'mitrailleuses': return sombre(col, 0.35);
    case 'general': return sombre(col, 0.3);
    case 'legere': case 'chasseurs': return sombre(col, 0.2);
    default: return col;
  }
}

// ------------------------------------------------------------------ le calque
export class Guerre {
  constructor(map) {
    this.map = map;
    this.fx = [];            // fumées (comme Scene.fx de lib.js), en km
    this.eclairs = [];       // départs de coups et impacts : un éclair bref, allumé par ciel.js
    this.hist = new Map();   // par armée : la route parcourue, du nœud de départ de son arête vers l'arrière
    this.compos = new Map();
    this.looks = new Map();
    this.sieges = new Map();
    this.pilles = new Map(); // place → jour (state.t) où une armée ennemie est passée près d'elle
    this.batailles = new Map();
    this.prep = null;
    this.vu = new Map();
    this.pk = new Map();      // dernière route examinée pour les pillages, par armée
    // la vie des pays (carte/vie.js) se fait rare devant l'ennemi ; chargée à part, elle peut manquer
    import('./vie.js').then(V => V.ajouterDensite?.(densiteGuerre)).catch(() => {});     // dernier mouvement vu de chaque armée (temps, position) : à l'arrêt, les jambes s'arrêtent
  }

  // la scène du calque, aux conventions de la maquette (Scene de lib.js) : z en px par km, d la densité de l'écran
  scene(time) {
    const mp = this.map, z = mp.cam.z, d = mp.dpr, cx = mp.cam.x, cy = mp.cam.y, ox = mp.vw * d / 2, oy = mp.vh * d / 2, m = z * d;
    const hw = mp.vw / 2 / z, hh = mp.vh / 2 / z;
    return {
      z, d, cx, cy, time, fx: this.fx, max: 500,
      x0: cx - hw - 0.3, x1: cx + hw + 0.3, y0: cy - hh - 0.3, y1: cy + hh + 0.3,
      monde(g) { g.setTransform(m, 0, 0, m, -cx * m + ox, -cy * m + oy); },
      fig(g, x, y, a) { const c = Math.cos(a) * m, s = Math.sin(a) * m; g.setTransform(c, s, -s, c, (x - cx) * m + ox, (y - cy) * m + oy); },
    };
  }
  // place une figure : position en km, cap, puis dessin en unités de figure
  figK(sc, g, x, y, a, s = 1) { sc.fig(g, x, y, a); g.scale(U * s, U * s); g.lineCap = 'round'; }
  dans(sc, x, y, m = 0) { return x > sc.x0 - m && x < sc.x1 + m && y > sc.y0 - m && y < sc.y1 + m; }

  look(code, type) {
    const k = code + ':' + type;
    let L = this.looks.get(k);
    if (!L) {
      const col = this.map.colors[code] || '#8d8a7a';
      L = tenue('fr', TYPE_TENUE[type] || type);
      L.habit = teinteHabit(type, col); L.chabraque = L.habit; L.col = col;
      if (L.habits) L.habits = L.habits.map(h => mix2(h, col));
      this.looks.set(k, L);
    }
    return L;
  }
  fac(code) { return this.map.state?.factions?.find(f => f.code === code); }
  enGuerre(a, b) { return !!this.fac(a)?.wars?.includes(b); }
  ennemiDuJoueur(code) { const me = this.map.state?.me?.code; return code !== me && (this.fac(code)?.st === 'guerre' || this.enGuerre(code, me)); }
  // ce que voit le joueur (brouillard de guerre) : les cercles de vision de l'état
  visible(x, y) {
    const st = this.map.state;
    if (!this.map.fogOn || !st?.vis) return true;
    for (const [vx, vy, r] of st.vis) if (Math.abs(x - vx) < r && Math.abs(y - vy) < r && Math.hypot(x - vx, y - vy) < r) return true;
    return false;
  }

  // ---------------------------------------------------------------- les armées de l'image
  // pour chaque armée visible : la route derrière sa tête (vers l'arrière), sa colonne, son bivouac
  armeesDe(time) {
    const mp = this.map, st = mp.state;
    if (this.prep && this.prep.n === mp.frameNo) return this.prep.list;
    const list = [], seen = new Set();
    for (const d of mp.disp.values()) {
      const a = d.a; if (!a || a.rail || a.boat) continue;
      seen.add(a.id);
      const h = this.suivre(a);
      let back, head;
      if (d.anim && a.trl?.length > 1) {
        // tour par tour : l'armée parcourt sous nos yeux la marche du tour ; derrière elle, le trajet déjà fait
        const an = d.anim, done = cheminEntre(an.pts, 0, Math.min(1, an.t / an.dur) * an.len);
        back = [[d.x, d.y], ...done.reverse()];
      } else if (a.trl?.length > 1) back = a.trl.slice().reverse();   // tour par tour : la marche du tour, exacte
      else if (a.e && mp.edges[a.e[0]]) back = this.surArete(a.e, h.back);
      else if (a.n != null) { const n = mp.nodes[a.n]; back = [[n.x, n.y], ...h.back]; }
      else if (a.st === 'move' || a.st === 'retreat') back = [[d.x, d.y], [d.x - Math.cos(d.head) * 6, d.y - Math.sin(d.head) * 6]];   // à travers champs
      else back = [[d.x, d.y], ...h.back];
      head = back[0];
      let c = this.compos.get(a.id);
      const key = a.regs.map(r => r[1] + r[2]).join() + !!a.gen;
      if (!c || c.key !== key) { c = compoColonne(a.regs, t => unitCls(mp.rules, t), t => unitLight(mp.rules, t), a.gen); c.key = key; this.compos.set(a.id, c); }
      // en marche, ou arrêtée sur la route (pause, halte) : on le voit au mouvement de la tête
      const v = this.vu.get(a.id);
      if (!v || Math.hypot(v.x - head[0], v.y - head[1]) > 0.003) this.vu.set(a.id, { x: head[0], y: head[1], t: time });
      const marche = (a.st === 'move' || a.st === 'retreat') && time - (this.vu.get(a.id).t) < 1.5;
      list.push({ d, a, back, L: longueur(back), compo: c, marche, enRoute: a.st === 'move' || a.st === 'retreat' });
    }
    for (const id of [...this.hist.keys()]) if (!seen.has(id)) { this.hist.delete(id); this.compos.delete(id); this.vu.delete(id); }   // disparue dans le brouillard : ses traces aussi
    this.prep = { n: mp.frameNo, list };
    return list;
  }
  // la route parcourue : quand l'armée passe d'une arête à la suivante, l'arête finie s'ajoute derrière elle
  suivre(a) {
    const mp = this.map;
    let h = this.hist.get(a.id);
    if (!h) { h = { e: null, frm: null, back: [] }; this.hist.set(a.id, h); }
    // l'arête finie (l'armée est sur la suivante, ou arrivée au bout) s'ajoute derrière elle ; un saut (brouillard,
    // tour d'une armée étrangère) efface la route : on ne garde que ce qu'on a vu
    const finir = () => {
      const old = mp.edges[h.e], fin = h.frm === old.a ? old.b : old.a;
      if ((a.e ? a.e[1] : a.n) === fin) {
        h.back = [...(h.frm === old.a ? old.pts.slice().reverse() : old.pts.slice()), ...h.back];
        let L = 0, i = 1;
        for (; i < h.back.length && L < 46; i++) L += Math.hypot(h.back[i][0] - h.back[i - 1][0], h.back[i][1] - h.back[i - 1][1]);
        h.back.length = Math.min(h.back.length, i);
      } else h.back = [];
      h.e = h.frm = null; h.node = fin;
    };
    if (a.e && a.e[0] !== h.e) {
      if (h.e != null) finir();
      else if (h.node != null && a.e[1] !== h.node) h.back = [];
      h.e = a.e[0]; h.frm = a.e[1];
    } else if (!a.e && a.n != null && h.e != null) finir();
    return h;
  }
  // depuis la tête, sur son arête, jusqu'au nœud de départ, puis la route parcourue avant
  surArete(ae, before) {
    const e = this.map.edges[ae[0]], tot = e.cum[e.cum.length - 1] || 1, fromA = ae[1] === e.a;
    const s = clamp(fromA ? ae[2] : 1 - ae[2], 0, 1) * tot, [hx, hy] = this.map.edgePoint(e, s / tot), out = [[hx, hy]];
    if (fromA) { for (let i = e.pts.length - 1; i >= 0; i--) if (e.cum[i] < s) out.push(e.pts[i]); }
    else for (let i = 0; i < e.pts.length; i++) if (e.cum[i] > s) out.push(e.pts[i]);
    return out.concat(before);
  }

  // ---------------------------------------------------------------- au sol, sous les villes : traces, tranchées
  sol(ctx, time) {
    const mp = this.map, st = mp.state;
    ZONES.length = 0;
    if (!st || mp.era) return;
    const sc = this.scene(time), z = sc.z, g = ctx;
    // personne autour d'un siège ou d'une bataille, moins de monde devant l'ennemi (densiteGuerre)
    for (const n of mp.nodes) { const ns = st.nodes[n.id]; if (ns.sg && !ns.sg.occ) ZONES.push({ x: n.x, y: n.y, r: rayonMurs(this.map, n, ns) + 4, d: 0.06 }); }
    for (const b of st.battles) ZONES.push({ x: b.x, y: b.y, r: 5, d: 0.1 });
    for (const A of this.armeesDe(time)) if (A.enRoute && this.ennemiDuJoueur(A.a.o)) ZONES.push({ x: A.back[0][0], y: A.back[0][1], r: 12, d: 0.35 });
    g.save();
    if (z >= 6) for (const A of this.armeesDe(time)) this.traces(sc, g, A);
    if (z >= 6) for (const n of mp.nodes) {
      const ns = st.nodes[n.id]; if (!ns.sg || ns.sg.occ || ns.sg.bl) continue;
      const S = this.siegeDe(n, ns); if (!this.dans(sc, n.x, n.y, S.r + 3)) continue;
      this.siegeSol(sc, g, S);
    }
    if (z >= 18) for (const b of st.battles) {
      const B = this.batailleDe(b); if (!this.dans(sc, B.x, B.y, 2)) continue;
      sc.monde(g); for (let k = 0; k < 40; k++) pietine(g, B.x + B.ux * (hash2(k, 1, 106) - 0.5) * 2.2 + B.nx * (hash2(k, 2, 106) - 0.5) * 0.9, B.y + B.uy * (hash2(k, 1, 106) - 0.5) * 2.2 + B.ny * (hash2(k, 2, 106) - 0.5) * 0.9, 0.09, 0.05, B.a, 0.2);
    }
    g.restore();
  }
  // derrière la queue de la colonne : la route défoncée, les champs piétinés, des débris derrière l'ennemi
  traces(sc, g, A) {
    const z = sc.z, fin = Math.min(A.compo.long, A.L), tr = cheminEntre(A.back, fin, A.L);
    if (tr.length < 2) return;
    sc.monde(g); g.lineCap = 'round'; g.lineJoin = 'round';
    ligne(g, tr); g.strokeStyle = 'rgba(112,84,48,.42)'; g.lineWidth = Math.max(0.07, 3 / z); g.stroke();
    if (z < 18) return;
    const hostile = this.ennemiDuJoueur(A.a.o);
    parPas(tr, 0, 1e9, 0.09, (x, y, a, s) => {
      if (!this.dans(sc, x, y)) return;
      const k = (s + fin) * 11 | 0, ca = Math.cos(a), sa = Math.sin(a);
      for (const sg of [-1, 1]) { const o = 0.05 + hash2(k, sg, 104) * 0.12; pietine(g, x - sa * o * sg, y + ca * o * sg, 0.03 + hash2(k, 2, 104) * 0.03, 0.018, a, 0.22); }
      if (hostile && z >= Z.VIE && k % 6 === 0) { this.figK(sc, g, x - sa * 0.02, y + ca * 0.02, a + hash2(k, 3, 104) * 3); debris(g, hash2(k, 4, 104)); sc.monde(g); }
    });
  }

  // ---------------------------------------------------------------- les armées (à partir de Z.VIE)
  armees(ctx, time, vie = true) {
    const mp = this.map, st = mp.state; if (!st || mp.era) return;
    const sc = this.scene(time), g = ctx, list = this.armeesDe(time);
    if (!vie) {
      // de loin, le soir et la nuit : quelques feux autour des armées au bivouac
      if (bivouac()) for (const A of list) if (A.a.st !== 'battle' && this.dans(sc, A.d.x, A.d.y, 1)) for (let k = 0; k < 4; k++) LUM.push({ x: A.d.x + (hash2(k, 1, 125) - 0.5) * 0.8, y: A.d.y + 0.25 + (hash2(k, 2, 125) - 0.5) * 0.4, r: 0.05, a: 0.7, petit: true });
      return;
    }
    g.save();
    for (const A of list) {
      const a = A.a;
      if (a.st === 'battle' || a.st === 'siege') continue;   // la bataille et le siège les montrent
      g.globalAlpha = a.h ? 0.62 : 1;
      if (A.enRoute && !bivouac()) this.colonne(sc, g, A);
      else this.camp(sc, g, A);
      g.globalAlpha = 1;
    }
    this.refugies(sc, g, list);
    g.restore();
  }
  colonne(sc, g, A) {
    const t = sc.time, a = A.a, o = a.o, pas0 = A.marche ? t * 1.7 * TAU : null;
    const Lg = this.look(o, 'general'), Lart = this.look(o, 'artillerie'), col = Lg.col;
    for (const e of A.compo.liste) {
      if (e.d > A.L) break;   // la queue est encore dans la place
      const p = surChemin(A.back, e.d); if (!this.dans(sc, p.x, p.y, 0.1)) continue;
      const fa = p.a + Math.PI, nx = -Math.sin(fa), ny = Math.cos(fa), pas = pas0;
      const leg = k => pas == null ? null : pas + k;
      const at = (off, f) => { this.figK(sc, g, p.x + nx * off * U, p.y + ny * off * U, fa); f(); };
      switch (e.k) {
        case 'cav': { const L = this.look(o, e.t); for (const off of [-3.5, 3.5]) at(off, () => { cheval(g, L.chevaux[(e.r + (off > 0)) % 5], { gait: leg(off) == null ? null : leg(off) * 1.2, bob: 0 }); cavalier(g, L, { habit: L.habit }, { sabre: 0, bob: 0 }); }); break; }
        case 'etat':
          at(0, () => { cheval(g, Lg.chevaux[0], { gait: leg(0), bob: 0 }); cavalier(g, Lg, { gen: e.gen }, { sabre: 0, bob: 0 }); });
          at(-8, () => { cheval(g, '#6b4a2c', { gait: leg(1), bob: 0 }); cavalier(g, Lg, { fanion: true }, { sabre: 0, bob: 0 }); });
          sc.monde(g); g.save(); g.translate(p.x - nx * 8 * U, p.y - ny * 8 * U); g.scale(U, U); drapeauCamp(g, col, 0, 0, t, 2, true); g.restore();
          break;
        case 'off': { const L = this.look(o, e.t); at(4.5, () => { cheval(g, '#8b6a47', { gait: leg(0), bob: 0 }); cavalier(g, L, { officier: true }, { sabre: 0, bob: 0 }); }); break; }
        case 'tambours': { const L = this.look(o, e.t); for (const off of [-6, -2, 2, 6]) at(off, () => fantassin(g, L, { role: 'tambour', r: off }, { legs: leg(off), arme: 'tambour' })); break; }
        case 'rang': {
          const L = this.look(o, e.t);
          for (const off of [-6, -2, 2, 6]) at(off, () => fantassin(g, L, { role: e.drapeau && off === 2 ? 'drapeau' : 'h' }, { legs: leg(e.r * 0.35), arme: e.drapeau && off === 2 ? 'aucun' : 'epaule' }));
          if (e.drapeau) { sc.monde(g); g.save(); g.translate(p.x + nx * 2 * U, p.y + ny * 2 * U); g.scale(U, U); drapeauCamp(g, col, 0, 0, t, e.b, false); g.restore(); }
          break;
        }
        case 'piece': { const L = this.look(o, e.t); at(0, () => { g.save(); g.translate(18, 0); for (const y of [-2.7, 2.7]) { g.save(); g.translate(0, y); cheval(g, '#6b4a2c', { gait: leg(0), bob: 0 }); g.restore(); g.save(); g.translate(-11, y); cheval(g, '#54402e', { gait: leg(1), bob: 0 }); g.restore(); } g.restore(); g.save(); g.translate(-3, 0); avant(g, L); g.restore(); g.save(); g.translate(-13, 0); g.rotate(Math.PI); piece(g, L, { recul: 0 }); g.restore(); }); break; }
        case 'servants': { const L = this.look(o, e.t); for (const off of [-6.5, 6.5]) at(off, () => fantassin(g, L, { role: 'h' }, { legs: leg(off), arme: 'aucun' })); break; }
        case 'caisson': at(0, () => { g.save(); g.translate(17, 0); for (const y of [-2.7, 2.7]) { g.save(); g.translate(0, y); cheval(g, '#6b4a2c', { gait: leg(0), bob: 0 }); g.restore(); } g.restore(); caisson(g, { caisse: Lart.affut, bache: '#ece4cb' }); }); break;
        case 'bagage': at(0, () => charrette(g, pas ?? 0, false, e.w)); at(-7, () => marcheur(g, e.w + 2, pas ?? 0, true)); break;
      }
    }
  }
  // au soir (ou à l'arrêt) l'armée fait halte : tentes alignées le long de la route, feux de bivouac, faisceaux
  // d'armes, canons parqués, chevaux à la corde, une sentinelle
  camp(sc, g, A) {
    const t = sc.time, z = sc.z, a = A.a, o = a.o, long = A.compo.long;
    const Linf = this.look(o, 'ligne'), Lart = this.look(o, 'artillerie'), Lcav = this.look(o, 'cavalerie');
    let pts = A.back;
    if (a.n != null || A.L < long * 0.5) {
      // dans une place ou sans route derrière elle : le camp se dresse en dehors de la ville, au sud
      const n = a.n != null ? this.map.nodes[a.n] : null, ns = n && this.map.state.nodes[n.id];
      const k = (A.d.slot || 0) - ((A.d.slots || 1) - 1) / 2, x = (n ? n.x : A.back[0][0]) + k * long * 0.9, y = n ? n.y + rayonMurs(this.map, n, ns) + 0.25 : A.back[0][1];
      pts = [[x + long * 0.4, y], [x - long * 0.4, y]];
    }
    const L = Math.min(longueur(pts), long * 0.8);
    if (L <= 0) return;
    let k = 0;
    parPas(pts, 0, L, 0.028, (x, y, a2) => {
      const nx = -Math.sin(a2), ny = Math.cos(a2), kk = k++;
      if (kk % 6 === 0) {
        const fx = x + nx * 0.13, fy = y + ny * 0.13; LUM.push({ x: fx, y: fy, r: 0.04, a: 0.7, petit: true });
        if (this.dans(sc, fx, fy)) {
          if (Math.random() < 0.02) this.fumee(fx, fy, 0, 0, 0.003, 0.03, 6, 0.25);
          this.figK(sc, g, fx, fy, 0); feuCamp(g, t, kk);
          for (let m = 0; m < 5; m++) { const aa = m * 1.26 + kk; this.figK(sc, g, fx + Math.cos(aa) * 0.011, fy + Math.sin(aa) * 0.011, aa + Math.PI); fantassin(g, Linf, { role: 'h' }, { legs: null, arme: 'aucun' }); }
        }
      }
      if (!this.dans(sc, x, y, 0.3)) return;
      for (const off of [0.05, 0.085]) { this.figK(sc, g, x + nx * off, y + ny * off, a2, 1.4); tente(g); }
      if (kk % 4 === 1) { this.figK(sc, g, x + nx * 0.105, y + ny * 0.105, 0); for (let m = 0; m < 6; m++) { const aa = m * TAU / 6; T(g, '#4a3a2a', 0.4, 0, 0, Math.cos(aa) * 2.6, Math.sin(aa) * 2.6); } }   // faisceau de fusils
    });
    // les canons parqués, les chevaux à la corde, une sentinelle sur la route
    const p = surChemin(pts, L), nx = -Math.sin(p.a), ny = Math.cos(p.a);
    if (this.dans(sc, p.x, p.y, 0.4) && z >= Z.VIE) {
      const guns = Math.min(6, A.compo.liste.filter(e => e.k === 'piece').length);
      for (let m = 0; m < guns; m++) { this.figK(sc, g, p.x + nx * (0.05 + m * 0.02), p.y + ny * (0.05 + m * 0.02), p.a + Math.PI); piece(g, Lart, { recul: 0 }); }
      for (let m = 0; m < 8; m++) { this.figK(sc, g, p.x + nx * 0.14 + Math.cos(p.a) * m * 0.012, p.y + ny * 0.14 + Math.sin(p.a) * m * 0.012, p.a + Math.PI / 2); cheval(g, Lcav.chevaux[m % 5], { bob: 0 }); }
    }
    const q = surChemin(pts, 0), off = 0.03 + pingpong(t * 0.002, 0.05), qx = q.x - Math.cos(q.a) * off, qy = q.y - Math.sin(q.a) * off;
    if (this.dans(sc, qx, qy)) { this.figK(sc, g, qx, qy, q.a + (mod(t * 0.002, 0.1) < 0.05 ? Math.PI : 0)); fantassin(g, Linf, { role: 'h' }, { legs: t * 4, arme: 'epaule' }); }
  }
  // devant une armée ennemie du joueur, les gens fuient sur les routes avec ce qu'ils peuvent emporter
  refugies(sc, g, list) {
    const t = sc.time;
    for (const A of list) {
      if (!A.enRoute || !this.ennemiDuJoueur(A.a.o)) continue;
      const [hx, hy] = A.back[0], trace = A.back;
      if (Math.max(sc.x0 - hx, hx - sc.x1, sc.y0 - hy, hy - sc.y1) > 12) continue;
      this.map.edges.forEach((e, ie) => {
        if (e.water || e.box[2] < sc.x0 || e.box[0] > sc.x1 || e.box[3] < sc.y0 || e.box[1] > sc.y1) return;
        if (Math.max(e.box[0] - hx, hx - e.box[2], e.box[1] - hy, hy - e.box[3]) > 12) return;
        const L = e.cum[e.cum.length - 1];
        for (let k = 0, n = Math.ceil(L / 0.35); k < n; k++) {
          const s0 = hash2(ie, k, 51) * L, q = surChemin(e.pts, s0), d = Math.hypot(q.x - hx, q.y - hy);
          if (d > 12 || d < 0.6 || distPoly(trace, q.x, q.y) < 1.5) continue;   // ni trop loin, ni dans le dos de l'armée
          const q2 = surChemin(e.pts, Math.min(L, s0 + 0.2)), sens = Math.hypot(q2.x - hx, q2.y - hy) > d ? 1 : -1;
          const sorte = hash2(ie, k, 52), v = sorte < 0.3 ? 0.006 : 0.0035, p = surChemin(e.pts, mod(s0 + sens * v * t, L));
          if (!this.dans(sc, p.x, p.y)) continue;
          const a = p.a + (sens < 0 ? Math.PI : 0), cote = (hash2(ie, k, 53) - 0.5) * 0.02;
          this.figK(sc, g, p.x - Math.sin(a) * cote, p.y + Math.cos(a) * cote, a); refugie(g, sorte, t * 1.7 * TAU + k, k);
        }
      });
    }
  }

  // ---------------------------------------------------------------- les sièges
  siegeDe(n, ns) {
    const r = rayonMurs(this.map, n, ns), key = n.id + ':' + r.toFixed(2);
    let S = this.sieges.get(n.id);
    if (!S || S.key !== key) { S = geoSiege(n.x, n.y, r, (x, y) => this.mouille(x, y), n.id); S.key = key; this.sieges.set(n.id, S); }
    return S;
  }
  // sur l'eau : mer, estuaire, fleuve (terrain du kilomètre, et le tracé des rivières)
  mouille(x, y) {
    const mp = this.map, i = x | 0, j = y | 0;
    if (i < 0 || j < 0 || i >= mp.W || j >= mp.H || mp.terrain[j * mp.W + i] <= 1) return true;
    if (!this.rivs) this.rivs = (mp.m.rivers || []).filter(r => r.rank <= 3).map(r => { const xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]); return { pts: r.pts, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; });
    for (const r of this.rivs) if (x > r.bb[0] - 0.3 && x < r.bb[2] + 0.3 && y > r.bb[1] - 0.3 && y < r.bb[3] + 0.3 && distPoly(r.pts, x, y) < 0.2) return true;
    return false;
  }
  // tranchées : trois parallèles autour de la place, reliées par des boyaux en zigzag ; la terre remuée
  siegeSol(sc, g, s) {
    const z = sc.z;
    sc.monde(g); g.lineCap = 'round'; g.lineJoin = 'round';
    const lignes = [...s.paralleles, ...s.boyaux];
    for (const p of lignes) { ligne(g, p); g.strokeStyle = '#6e5636'; g.lineWidth = Math.max(0.05, 3 / z); g.stroke(); }
    for (const p of lignes) { ligne(g, p); g.strokeStyle = '#b99a66'; g.lineWidth = Math.max(0.036, 2.2 / z); g.stroke(); }
    for (const p of lignes) { ligne(g, p); g.strokeStyle = '#4d3b26'; g.lineWidth = Math.max(0.012, 0.9 / z); g.stroke(); }
    for (const b of s.batteries) { const ca = Math.cos(b.a), sa = Math.sin(b.a); T(g, '#8f7449', Math.max(0.05, 3 / z), b.x + ca * 0.02 - sa * 0.06, b.y + sa * 0.02 + ca * 0.06, b.x + ca * 0.02 + sa * 0.06, b.y + sa * 0.02 - ca * 0.06); }
    if (z >= 18) for (let k = 0; k < 60; k++) { const a = s.aT + (hash2(k, 1, 122) - 0.5) * 2.6, d = s.r + 0.3 + hash2(k, 2, 122) * 3; pietine(g, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 0.08, 0.05, a, 0.2); }
  }
  // le siège d'une place (appelé par drawNodes, par-dessus la ville) : camp, batteries qui tirent (d'autant plus
  // souvent que la brèche avance), incendies dans la place ; un blocus n'a que son camp
  siege(ctx, n, ns, time) {
    const mp = this.map, sg = ns.sg; if (!sg || sg.occ || mp.era) return;
    const sc = this.scene(time), z = sc.z, t = time, g = ctx, s = this.siegeDe(n, ns), noir = nuit();
    if (!this.dans(sc, s.x, s.y, s.r + 4)) return;
    ctx.save();
    const L = this.look(sg.by, 'artillerie');
    for (const [x, y, q, w] of s.camp) {
      if (q % 3 === 1 && w % 2) LUM.push({ x, y, r: 0.05, a: 0.9 });
      if (z < 30 || !this.dans(sc, x, y)) continue;
      this.figK(sc, g, x, y, s.aT + (hash2(q, w, 65) - 0.5) * 0.2, 1.4); if (q % 3 === 1 && w % 2) feuCamp(g, t, q + w); else tente(g);
    }
    if (!sg.bl) {
      const cadence = lerp(9, 3, clamp(sg.dmg, 0, 1));
      for (const b of s.batteries) {
        if (!noir && t - b.tir > cadence + (b.x * 7 % 2)) {
          b.tir = t; const ca = Math.cos(b.a), sa = Math.sin(b.a);
          for (const o of [-0.02, 0, 0.02]) { const px = b.x + ca * 0.04 - sa * o, py = b.y + sa * 0.04 + ca * o; this.fumee(px, py, ca * 0.004, sa * 0.004, 0.01, 0.1, 9, 0.5); this.eclairs.push({ x: px, y: py, t0: t }); }
          const a = hash2(t * 10 | 0, 1, 123) * TAU, d = Math.sqrt(hash2(t * 10 | 0, 2, 123)) * s.r * 0.8; s.impacts.push({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d, t0: t + 1.3 });
        }
        if (z >= 40 && this.dans(sc, b.x, b.y)) for (const o of [-6, 0, 6]) {
          const [px, py] = versMonde(b.x, b.y, b.a, -6, o); this.figK(sc, g, px, py, b.a); piece(g, L, { recul: Math.max(0, 2 - (t - b.tir) * 4) });
          if (z >= Z.VIE) { this.figK(sc, g, ...versMonde(b.x, b.y, b.a, -14, o + 2), b.a); fantassin(g, L, { role: 'h' }, { legs: null, arme: 'refouloir', ext: 0.5 + 0.5 * Math.sin(t * 2 + o) }); }
        }
      }
      s.impacts = s.impacts.filter(m => { if (t < m.t0) return true; this.fumee(m.x, m.y, 0, 0, 0.02, 0.16, 9, 0.4, 'n'); this.eclairs.push({ x: m.x, y: m.y, t0: t }); return false; });
      // la ville brûle par endroits, d'autant plus que la brèche avance
      const nf = Math.round(clamp(sg.dmg, 0, 1) * s.feux.length);
      for (let k = 0; k < nf; k++) {
        const [x, y] = s.feux[k];
        LUM.push({ x, y, r: 0.3, a: 0.5, jour: true });
        if (Math.random() < 0.06) this.fumee(x, y, 0, 0, 0.03, 0.3, 16, 0.42, 'n');
        if (z >= 18 && this.dans(sc, x, y)) { sc.monde(g); E(g, 'rgba(30,24,20,.55)', x, y, 0.06, 0.04, k); flamme(g, x, y, Math.max(0.018, 2.5 / z), t, k); }
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- les batailles
  // l'axe de la bataille : du camp 0 vers le camp 1 (d'après leurs armées), le front en travers
  batailleDe(b) {
    const mp = this.map, byId = new Map(mp.state.armies.map(a => [a.id, a]));
    const cen = b.sides.map(s => { const arr = s.armies.map(id => byId.get(id)).filter(Boolean); return arr.length ? [arr.reduce((t, a) => t + a.x, 0) / arr.length, arr.reduce((t, a) => t + a.y, 0) / arr.length] : null; });
    let th = cen[0] && cen[1] && Math.hypot(cen[1][0] - cen[0][0], cen[1][1] - cen[0][1]) > 0.05 ? Math.atan2(cen[1][1] - cen[0][1], cen[1][0] - cen[0][0]) : hash2(String(b.id).replace(/\D/g, '') | 0, 1, 95) * TAU;
    const old = this.batailles.get(b.id);
    if (old) th = old.th;   // l'axe ne tourne plus une fois la bataille engagée
    const nx = Math.cos(th), ny = Math.sin(th), a = th - Math.PI / 2;
    const B = { id: b.id, th, x: b.x, y: b.y, a, ux: Math.cos(a), uy: Math.sin(a), nx, ny, unites: [], key: '' };
    // les troupes de chaque camp d'après leur effectif par arme ; serrées à mesure que la bataille s'engage
    const key = b.sides.map(s => [s.mix?.inf, s.mix?.cavalerie, s.mix?.artillerie, s.mix?.milice].map(v => Math.round((v || 0) / 150)).join()).join('|');
    if (old && old.key === key) { Object.assign(old, { x: b.x, y: b.y }); return old; }
    B.key = key;
    b.sides.forEach((s, i) => {
      const sg = i ? 1 : -1, mx = s.mix || {}, inf = (mx.inf || 0) + (mx.milice || 0), nb = inf > 0 ? clamp(Math.round(inf / 450), 1, 6) : 0;
      const nc = mx.artillerie > 0 ? clamp(Math.round(mx.artillerie / 120), 1, 3) : 0, nv = mx.cavalerie > 0 ? clamp(Math.round(mx.cavalerie / 200), 1, 3) : 0;
      for (let k = 0; k < nb; k++) B.unites.push({ i, sg, k: 'bat', u: (k - (nb - 1) / 2) * 0.3, v: 1, type: k === 0 && nb > 2 ? 'grenadiers' : 'ligne', tir: -hash2(k, sg, 96) * 7 });
      for (let k = 0; k < nc; k++) B.unites.push({ i, sg, k: 'canons', u: (k - (nc - 1) / 2) * 0.55 + 0.15, v: 0.66, type: 'artillerie', tir: -hash2(k, sg, 97) * 5 });
      for (let k = 0; k < nv; k++) { const w = k % 2 ? 1 : -1; B.unites.push({ i, sg, k: 'cav', u: w * ((nb / 2) * 0.3 + 0.25 + (k >> 1) * 0.35), v: 1.5, type: 'cavalerie', ph: hash2(k, sg, 98) * 6 }); }
    });
    this.batailles.set(b.id, B);
    return B;
  }
  // de loin, le nuage de la bataille qui monte et dérive sous le vent ; de près les lignes face à face, les salves,
  // les batteries, les charges de cavalerie (phase « charge »), les tombés
  bataille(sc, g, b) {
    const B = this.batailleDe(b), z = sc.z, t = sc.time, noir = nuit();
    if (!noir) { sc.monde(g); for (let k = 0; k < 12; k++) { const d = mod(t * 0.02 + k * 0.35, 4.2), r = Math.max(0.5 + d * 0.55, 7 / z), x = B.x + (hash2(k, 1, 105) - 0.5) * 1.6 + d * 0.9, y = B.y + (hash2(k, 2, 105) - 0.5) * 0.8 - d * 0.45; g.globalAlpha = 0.34 * (1 - d / 4.2); g.drawImage(SPR.f, x - r, y - r, 2 * r, 2 * r); } g.globalAlpha = 1; }
    if (!this.dans(sc, B.x, B.y, 2.5)) return;
    const ph = b.phase || 'fusillade', ecart = ph === 'canonnade' ? 0.42 : ph === 'charge' ? 0.22 : 0.3, vie = z >= Z.VIE;
    for (const u of B.unites) {
      const s = b.sides[u.i], L = this.look(s.o, u.type);
      const charge = u.k === 'cav' && ph === 'charge' && !noir ? Math.max(0, Math.sin(t * 0.04 + u.ph)) * 0.18 * 3 : 0;
      const v = u.sg * Math.max(0.05, u.v * ecart - charge * 0.5);
      const x = B.x + B.ux * u.u + B.nx * v, y = B.y + B.uy * u.u + B.ny * v, face = Math.atan2(-u.sg * B.ny, -u.sg * B.nx), fx = Math.cos(face), fy = Math.sin(face);
      if (noir) { for (const o of [-0.1, 0.1]) LUM.push({ x: x - fx * 0.2 + B.ux * o, y: y - fy * 0.2 + B.uy * o, r: 0.05, a: 0.9 }); }
      else if ((u.k === 'canons' || (u.k === 'bat' && ph !== 'canonnade')) && t - u.tir > (u.k === 'canons' ? 5 : 7)) {
        u.tir = t; const w = u.k === 'canons' ? 0.08 : 0.26, nb = u.k === 'canons' ? 3 : 6;
        for (let i = 0; i < nb; i++) { const o = (i / (nb - 1) - 0.5) * w, px = x + fx * 0.015 - fy * o, py = y + fy * 0.015 + fx * o; this.fumee(px, py, fx * 0.003, fy * 0.003, 0.008, u.k === 'canons' ? 0.13 : 0.07, 9, 0.5); this.eclairs.push({ x: px, y: py, t0: t }); }
      }
      if (!vie || !this.dans(sc, x, y, 0.5)) continue;
      const tire = t - u.tir < 1.2, force = clamp(s.men / Math.max(1, s.men + s.lost), 0.35, 1);
      if (u.k === 'bat') { const n = Math.round(22 * force); for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) { this.figK(sc, g, ...versMonde(x, y, face, -r * 2.8, (i - (n - 1) / 2) * 2.5), face); fantassin(g, L, { role: 'h' }, { legs: null, arme: ph === 'charge' ? 'baio' : ph === 'canonnade' ? 'epaule' : tire ? 'joue' : 'recharge', ext: ph === 'charge' ? 0.6 : t * 3 + i }); } }
      else if (u.k === 'canons') for (const o of [-6, 0, 6]) { this.figK(sc, g, ...versMonde(x, y, face, 0, o), face); piece(g, L, { recul: tire ? 2 : 0 }); }
      else for (let r = 0; r < 2; r++) for (let i = 0; i < 10; i++) { this.figK(sc, g, ...versMonde(x, y, face, -r * 7, (i - 4.5) * 4.2), face); cheval(g, L.chevaux[(i + r) % 5], { gait: charge > 0.02 ? t * 14 + i : null, bob: 0 }); cavalier(g, L, { habit: L.habit }, { sabre: charge > 0.05 ? 1 : 0, bob: 0 }); }
    }
    // les tombés, de chaque camp à proportion de ses pertes
    if (vie) {
      const l0 = b.sides[0].lost || 0, l1 = b.sides[1].lost || 0, n = clamp(Math.round((l0 + l1) / 20), 4, 60), c0 = this.look(b.sides[0].o, 'ligne').habit, c1 = this.look(b.sides[1].o, 'ligne').habit;
      for (let k = 0; k < n; k++) {
        const x = B.x + B.ux * (hash2(k, 1, 107) - 0.5) * 1.4 + B.nx * (hash2(k, 2, 107) - 0.5) * 0.5, y = B.y + B.uy * (hash2(k, 1, 107) - 0.5) * 1.4 + B.ny * (hash2(k, 2, 107) - 0.5) * 0.5;
        if (!this.dans(sc, x, y)) continue;
        this.figK(sc, g, x, y, k * 2.1); E(g, hash2(k, 3, 107) * (l0 + l1) < l0 ? c0 : c1, 0, 0, 2.4, 1.1); C(g, '#e2b996', 2.4, 0, 0.7);
      }
    }
  }

  // ---------------------------------------------------------------- par-dessus : batailles, pillages, fumées
  dessus(ctx, dt, time) {
    const mp = this.map, st = mp.state; if (!st || mp.era) return;
    const sc = this.scene(time), g = ctx;
    ctx.save();
    for (const b of st.battles) this.bataille(sc, g, b);
    this.pillages(sc, g, st);
    // les fumées
    const [wx, wy] = VENT, amort = Math.exp(-dt * 1.6);
    this.fx = this.fx.filter(f => (f.age += dt) < f.life);
    sc.monde(g);
    for (const f of this.fx) {
      f.x += (f.vx + wx) * dt; f.y += (f.vy + wy) * dt; f.vx *= amort; f.vy *= amort;
      const p = f.age / f.life, r = lerp(f.r0, f.r1, 1 - (1 - p) ** 2);
      if (!this.dans(sc, f.x, f.y, r)) continue;
      g.globalAlpha = f.al * (p < 0.08 ? p / 0.08 : (1 - p) ** 1.3); g.drawImage(SPR[f.spr], f.x - r, f.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    // les éclairs des coups de canon et des salves : des lumières brèves, allumées par ciel.js
    this.eclairs = this.eclairs.filter(e => time - e.t0 < 0.2);
    for (const e of this.eclairs) LUM.push({ x: e.x, y: e.y, r: 0.04, a: 1 - (time - e.t0) / 0.2, eclair: true });
    ctx.restore();
  }
  fumee(x, y, vx, vy, r0, r1, life, al = 0.55, spr = 'f') { if (this.fx.length < 500) this.fx.push({ spr, x, y, vx, vy, r0, r1, life, age: 0, al }); }
  // les villages d'un camp en guerre avec une armée qui passe près d'eux brûlent quelques jours
  pillages(sc, g, st) {
    const mp = this.map, z = sc.z, t = sc.time;
    for (const A of this.armeesDe(t)) {
      const key = A.a.id + ':' + A.back.length + ':' + (A.a.e?.[0] ?? A.a.n);
      if (this.pk.get(A.a.id) === key) continue;
      this.pk.set(A.a.id, key);
      const tr = cheminEntre(A.back, Math.min(A.compo.long * 0.5, A.L), A.L);
      if (tr.length < 2) continue;
      for (const n of mp.nodes) {
        const ns = st.nodes[n.id];
        if (!(n.type === 'village' || (n.type === 'ville' && !ns.f)) || !this.enGuerre(A.a.o, ns.o) || this.pilles.has(n.id) && st.t - this.pilles.get(n.id) < 4) continue;
        if (Math.abs(n.x - A.back[0][0]) < 50 && Math.abs(n.y - A.back[0][1]) < 50 && distPoly(tr, n.x, n.y) < 3) this.pilles.set(n.id, st.t);
      }
    }
    for (const [id, t0] of this.pilles) {
      if (st.t - t0 > 4 || st.t < t0) { this.pilles.delete(id); continue; }
      const n = mp.nodes[id];
      if (!this.dans(sc, n.x, n.y, 2) || !this.visible(n.x, n.y)) continue;
      const r = rayonPlace(n, st.nodes[id]) * 0.6;
      for (let k = 0; k < 3; k++) {
        const x = n.x + (hash2(n.id, k, 120) - 0.5) * r * 2, y = n.y + (hash2(n.id, k, 121) - 0.5) * r * 2;
        LUM.push({ x, y, r: 0.25, a: 0.55, jour: true });
        if (Math.random() < 0.05) this.fumee(x, y, 0, 0, 0.02, 0.25, 14, 0.42, 'n');
        sc.monde(g);
        if (z >= 18) E(g, 'rgba(30,24,20,.55)', x, y, 0.05, 0.035, k);
        if (z >= 10) flamme(g, x, y, Math.max(0.015, 4 / z), t, k);
      }
      sc.monde(g); for (let q = 0; q < 4; q++) { const d = mod(t * 0.03 + q * 0.25, 1), rr = Math.max(0.25 + d * 0.9, (5 + d * 9) / z); g.globalAlpha = 0.65 * (1 - d); g.drawImage(SPR.n, n.x - rr + d * 1.8, n.y - rr - d * 0.9, rr * 2, rr * 2); } g.globalAlpha = 1;   // le panache noir, de loin
    }
  }
}

// (les habits de la milice prennent un peu de la couleur du camp)
function mix2(a, b) { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16), m = (x, y) => Math.round(x * 0.7 + y * 0.3); return '#' + [16, 8, 0].map(s => m(A >> s & 255, B >> s & 255).toString(16).padStart(2, '0')).join(''); }
// (comme unitCls et unitLight de map.js, sans dépendre de map.js)
const unitCls = (rules, t) => rules.units[t]?.cls || (t === 'cavalerie' || t === 'artillerie' ? t : 'inf');
const unitLight = (rules, t) => rules.units[t]?.light ?? t === 'legere';
