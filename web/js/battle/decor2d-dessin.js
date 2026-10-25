// Vue tactique en 2D : les dessins du décor, repris de la maquette (web/js/battle/dev/maquette-2d.html) : outils de
// tracé, bâtiments d'époque vus de dessus (listes de volumes éclairés du nord-ouest : BATS, bat, pignon, mansardeF,
// domeF…), toits des îlots (toitParcelle), maisons touchées, en feu et en ruine (dessinMaison), arbres (touffes,
// sapins), bêtes et villageois, ailes de moulin, et les petites images des fumées et des flammes.
// Les bâtiments sont dessinés dans le repère de la maquette (une unité vaut ECH m), les bêtes et les gens dans celui
// des figures (une unité vaut 40 cm, comme les soldats de la maquette).
import { TAU, clamp } from './formes.js';

export const ECH = 0.5, ECH_VIE = 0.4;
export const OMBRE = 'rgba(20,32,12,.42)';
export const BOIS = ['#2f5e2c', '#3a6c34', '#45793c', '#2b5427', '#518644'];

// ---------- outils (maquette)
export function alea(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hx = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const MEMO = new Map();
export function mix(a, b, k) {
  const key = a + b + k; let v = MEMO.get(key);
  if (!v) { const A = hx(a), B = hx(b); v = '#' + A.map((x, i) => Math.round(x + (B[i] - x) * k).toString(16).padStart(2, '0')).join(''); MEMO.set(key, v); }
  return v;
}
export const sombre = (c, k = .25) => mix(c, '#000000', k), clair = (c, k = .25) => mix(c, '#ffffff', k);
export function E(g, c, x, y, rx, ry, r = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, r, 0, TAU); g.fill(); }
export function C(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
export function T(g, c, w, x1, y1, x2, y2) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
export function RR(g, c, x, y, w, h, r) { g.fillStyle = c; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill(); }
export function PG(g, c, p) { g.fillStyle = c; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); }
export function trace(g, pts, ferme = false) { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); if (ferme) g.closePath(); }
export function ligne(g, pts, ferme = false) { g.beginPath(); trace(g, pts, ferme); }

// ---------- toits : palettes [clair, sombre, trait], ombrées selon le pan (lumière du nord-ouest)
const PAL0 = {
  tuile: ['#bf5a40', '#8f3f2e', '#6e3024'], canal: ['#dc9066', '#b56a46', '#94533a'], ardoise: ['#8696a8', '#5a697b', '#46525f'],
  zinc: ['#b5bec2', '#8d979c', '#6d767b'], plomb: ['#9aa3a5', '#6f777a', '#555c5f'], chaume: ['#c8ab66', '#9c8446', '#7a6634'],
  pierre: ['#e2d8c0', '#b3a88f', '#8f876f'],   // (tour de moulin)
  // les toits des pays (web/js/carte/villes.js) : la ville d'une bataille sur son plan a ceux de « Voir l'intérieur »
  bordelais: ['#c7653f', '#9c4b30', '#7a3a26'], perigord: ['#8a5a3e', '#6b432e', '#4f3123'], lauze: ['#8a8478', '#6a655c', '#4f4b44'],
  landes: ['#be6743', '#994f33', '#773c27'], agenais: ['#c25a33', '#9a4527', '#78351d'], bearn: ['#6a7282', '#4f5666', '#3c424e'], basque: ['#c04a32', '#973726', '#742a1c'],
};
const PALN = Object.fromEntries(Object.entries(PAL0).map(([k, P]) => [k, [mix(P[0], '#f4f6f8', .75), mix(P[1], '#dfe4e8', .7), P[2]]]));
export let PAL = PAL0;
let REMAP = null;   // palettes d'un bâtiment remplacées (la tuile canal au sud…), le temps de le dessiner
export function neige(on) { PAL = on ? PALN : PAL0; }
const pal = k => PAL[(REMAP && REMAP[k]) || k] || PAL.tuile;
const SOLEIL = [-.6, -.8], OMB = [1.5, 2];
export function teinte(P, nx, ny) { const t = Math.round(clamp(.5 + .7 * (nx * SOLEIL[0] + ny * SOLEIL[1]), 0, 1) * 20) / 20; return mix(P[1], P[0], t); }
const teinteL = (P, nx, ny, a) => teinte(P, nx * Math.cos(a) - ny * Math.sin(a), nx * Math.sin(a) + ny * Math.cos(a));
export function pignon(g, x, y, w, h, P, a, hip, canal) {
  const m = y + h / 2, i = Math.min(h / 2, w / 2), top = teinteL(P, 0, -1, a), bot = teinteL(P, 0, 1, a);
  if (!hip) { g.fillStyle = top; g.fillRect(x, y, w, h / 2); g.fillStyle = bot; g.fillRect(x, m, w, h / 2); }
  else {
    PG(g, top, [x, y, x + w, y, x + w - i, m, x + i, m]); PG(g, bot, [x, y + h, x + w, y + h, x + w - i, m, x + i, m]);
    PG(g, teinteL(P, -1, 0, a), [x, y, x + i, m, x, y + h]); PG(g, teinteL(P, 1, 0, a), [x + w, y, x + w - i, m, x + w, y + h]);
  }
  g.globalAlpha = .26; g.strokeStyle = P[2]; g.lineWidth = .18; g.beginPath();
  if (canal) for (let xx = x + .6; xx < x + w; xx += .85) { g.moveTo(xx, y); g.lineTo(xx, y + h); }   // tuiles canal : des rangs du faîtage à l'égout
  else for (let yy = y + .9; yy < y + h; yy += 1.1) { if (Math.abs(yy - m) > .3) { g.moveTo(x, yy); g.lineTo(x + w, yy); } }
  g.stroke(); g.globalAlpha = 1;
  g.strokeStyle = P[2]; g.lineWidth = .45; g.beginPath();
  if (hip) { g.moveTo(x + i, m); g.lineTo(x + w - i, m); g.moveTo(x, y); g.lineTo(x + i, m); g.lineTo(x, y + h); g.moveTo(x + w, y); g.lineTo(x + w - i, m); g.lineTo(x + w, y + h); }
  else { g.moveTo(x, m); g.lineTo(x + w, m); }
  g.stroke();
  // le faîtage accroche la lumière du côté du pan éclairé, l'égout du pan à l'ombre se marque : on lit deux pentes
  const k = .8 * Math.cos(a) - .6 * Math.sin(a) > 0 ? -1 : 1, e = Math.min(hip ? i : 0, w / 2);
  T(g, clair(P[0], .35), .22, x + e, m + k * .32, x + w - e, m + k * .32);
  g.globalAlpha = .45; T(g, P[2], .3, x, k < 0 ? y + h - .15 : y + .15, x + w, k < 0 ? y + h - .15 : y + .15); g.globalAlpha = 1;
  if (canal) { g.strokeStyle = 'rgba(245,230,205,.6)'; g.lineWidth = .35; g.strokeRect(x + .2, y + .2, w - .4, h - .4); }   // la génoise
}
function pyramideF(g, x, y, w, h, P, a) {
  const cx = x + w / 2, cy = y + h / 2;
  PG(g, teinteL(P, 0, -1, a), [x, y, x + w, y, cx, cy]); PG(g, teinteL(P, 1, 0, a), [x + w, y, x + w, y + h, cx, cy]);
  PG(g, teinteL(P, 0, 1, a), [x + w, y + h, x, y + h, cx, cy]); PG(g, teinteL(P, -1, 0, a), [x, y + h, x, y, cx, cy]);
  g.strokeStyle = P[2]; g.lineWidth = .35; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.stroke();
  C(g, '#d9b44a', cx, cy, .55);
}
export function coneF(g, x, y, r, P, a, a0 = 0, a1 = TAU, n = 16) {
  for (let k = 0; k < n; k++) {
    const t0 = a0 + (a1 - a0) * k / n, t1 = a0 + (a1 - a0) * (k + 1) / n, tm = (t0 + t1) / 2;
    PG(g, teinteL(P, Math.cos(tm), Math.sin(tm), a), [x, y, x + Math.cos(t0) * r, y + Math.sin(t0) * r, x + Math.cos(t1) * r + .05, y + Math.sin(t1) * r + .05]);
  }
}
function domeF(g, x, y, r, P, a) {
  coneF(g, x, y, r, P, a, 0, TAU, 24);
  g.strokeStyle = P[2]; g.lineWidth = .3; g.beginPath(); for (let k = 0; k < 12; k++) { const t = k * TAU / 12; g.moveTo(x + Math.cos(t) * r * .3, y + Math.sin(t) * r * .3); g.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r); } g.stroke();
  g.beginPath(); g.arc(x, y, r * .62, 0, TAU); g.stroke();
  C(g, '#d8cdb5', x, y, r * .28); coneF(g, x, y, r * .2, P, a, 0, TAU, 8); C(g, '#d9b44a', x, y, r * .07 + .2);
}
export function mansardeF(g, x, y, w, h, a) {
  const i = Math.min(2.6, w / 4, h / 4), P = PAL.ardoise, Z = PAL.zinc;
  PG(g, teinteL(P, 0, -1, a), [x, y, x + w, y, x + w - i, y + i, x + i, y + i]); PG(g, teinteL(P, 0, 1, a), [x, y + h, x + w, y + h, x + w - i, y + h - i, x + i, y + h - i]);
  PG(g, teinteL(P, -1, 0, a), [x, y, x + i, y + i, x + i, y + h - i, x, y + h]); PG(g, teinteL(P, 1, 0, a), [x + w, y, x + w - i, y + i, x + w - i, y + h - i, x + w, y + h]);
  g.fillStyle = Z[0]; g.fillRect(x + i, y + i, w - 2 * i, h - 2 * i);
  for (let xx = x + i + 1.2; xx < x + w - i - 1; xx += 3) { RR(g, Z[0], xx, y + .5, 1.3, 1.4, .2); RR(g, Z[0], xx, y + h - 1.9, 1.3, 1.4, .2); }   // lucarnes
  for (let xx = x + i + 2; xx < x + w - i - 1; xx += 5.5) { RR(g, '#8a5a44', xx, y + i - .5, 2.2, 1, .2); RR(g, '#8a5a44', xx, y + h - i - .5, 2.2, 1, .2); }   // souches de cheminée
}
function empreinte(g, p, dx, dy) {
  switch (p.t) {
    case 'c': case 'd': case 'arbre': g.moveTo(p.x + dx + p.r, p.y + dy); g.arc(p.x + dx, p.y + dy, p.r, 0, TAU); break;
    case 'abs': g.moveTo(p.x + dx, p.y + dy - p.r); g.arc(p.x + dx, p.y + dy, p.r, -Math.PI / 2, Math.PI / 2); g.closePath(); break;
    case 'poly': g.moveTo(p.pts[0] + dx, p.pts[1] + dy); for (let i = 2; i < p.pts.length; i += 2) g.lineTo(p.pts[i] + dx, p.pts[i + 1] + dy); g.closePath(); break;
    case 'fn': break;
    default: g.rect(p.x + dx, p.y + dy, p.w, p.h);
  }
}
function dessinPart(g, p, a) {
  switch (p.t) {
    case 'r': RR(g, p.c, p.x, p.y, p.w, p.h, p.rr || 0); break;
    case 'poly': PG(g, p.c, p.pts); break;
    case 'g': case 'k': {
      const k0 = p.p || (p.t === 'k' ? 'canal' : 'tuile'), key = (REMAP && REMAP[k0]) || k0, P = PAL[key] || PAL.tuile, ax = p.ax || (p.w >= p.h ? 'x' : 'y'), canal = p.t === 'k' || key === 'canal';
      if (ax === 'x') pignon(g, p.x, p.y, p.w, p.h, P, a, p.hip, canal);
      else { g.save(); g.translate(p.x + p.w / 2, p.y + p.h / 2); g.rotate(Math.PI / 2); pignon(g, -p.h / 2, -p.w / 2, p.h, p.w, P, a + Math.PI / 2, p.hip, canal); g.restore(); }
      break;
    }
    case 's': { const P = pal(p.p || 'tuile'); g.fillStyle = teinteL(P, p.n[0], p.n[1], a); g.fillRect(p.x, p.y, p.w, p.h); g.strokeStyle = P[2]; g.lineWidth = .3; g.strokeRect(p.x, p.y, p.w, p.h); break; }
    case 'p': pyramideF(g, p.x, p.y, p.w, p.h, pal(p.p || 'ardoise'), a); break;
    case 'c': coneF(g, p.x, p.y, p.r, pal(p.p || 'ardoise'), a); C(g, '#d9b44a', p.x, p.y, .35); break;
    case 'abs': coneF(g, p.x, p.y, p.r, pal(p.p || 'ardoise'), a, -Math.PI / 2, Math.PI / 2, 8); break;
    case 'd': domeF(g, p.x, p.y, p.r, pal(p.p || 'plomb'), a); break;
    case 'm': mansardeF(g, p.x, p.y, p.w, p.h, a); break;
    case 'f': RR(g, p.c, p.x, p.y, p.w, p.h, .3); if (p.bal) { g.strokeStyle = clair(p.c, .25); g.lineWidth = .5; g.strokeRect(p.x + .5, p.y + .5, p.w - 1, p.h - 1); } break;
    case 'v': {
      RR(g, '#9fb9c6', p.x, p.y, p.w, p.h, .4); g.fillStyle = '#c3d7df'; g.fillRect(p.x, p.y, p.w, p.h * .35);
      g.strokeStyle = '#5d6e76'; g.lineWidth = .3; g.beginPath(); for (let x = p.x + 2; x < p.x + p.w; x += 2.4) { g.moveTo(x, p.y); g.lineTo(x, p.y + p.h); } g.moveTo(p.x, p.y + p.h / 2); g.lineTo(p.x + p.w, p.y + p.h / 2); g.stroke(); break;
    }
    case 'arbre': C(g, p.c || BOIS[2], p.x, p.y, p.r); g.globalAlpha = .28; C(g, '#a5cf7f', p.x - p.r * .32, p.y - p.r * .34, p.r * .5); g.globalAlpha = 1; break;
    case 'fn': p.fn(g, a); break;
  }
}
// dessine un bâtiment (liste de volumes) en (x, y), tourné de a, à l'échelle s ; les ombres d'abord, d'un seul tracé ;
// remap : palettes remplacées ({tuile: 'canal'} au sud)
export function bat(g, parts, x, y, a = 0, s = 1, remap = null) {
  REMAP = remap;
  g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s); g.lineCap = 'round';
  const ca = Math.cos(a), sa = Math.sin(a);
  g.fillStyle = 'rgba(20,20,10,.32)'; g.beginPath();
  for (const p of parts) { if (p.sol || p.t === 'fn') continue; const h = p.h2 ?? 1; empreinte(g, p, (OMB[0] * ca + OMB[1] * sa) * h, (-OMB[0] * sa + OMB[1] * ca) * h); }
  g.fill();
  for (const p of parts) dessinPart(g, p, a);
  g.restore();
  REMAP = null;
}
// emprise d'un bâtiment (unités de la maquette) : boîte des volumes, sans les sols ni les dessins libres (tout : avec
// les sols et les dessins qui disent leur emprise, les parterres)
export function boite(parts, tout = false) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of parts) {
    if (tout ? p.t === 'fn' && p.w == null : p.sol || p.t === 'fn' || p.t === 'arbre') continue;
    const [a, b, c, d] = p.r != null ? [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r] : p.pts ? [Math.min(...p.pts.filter((v, i) => !(i % 2))), Math.min(...p.pts.filter((v, i) => i % 2)), Math.max(...p.pts.filter((v, i) => !(i % 2))), Math.max(...p.pts.filter((v, i) => i % 2))] : [p.x, p.y, p.x + p.w, p.y + p.h];
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  }
  return x0 < x1 ? [x0, y0, x1, y1] : [-5, -5, 5, 5];
}

// ---------- petits dessins
export function arbre(g, x, y, r, c) {
  C(g, OMBRE, x + 1.6, y + 2.2, r); C(g, c, x, y, r);
  g.globalAlpha = .28; C(g, '#a5cf7f', x - r * .32, y - r * .34, r * .5); g.globalAlpha = 1;
}
export function cloture(g, x, y, w, h) {
  g.strokeStyle = '#e2d6b6'; g.lineWidth = .55; g.strokeRect(x, y, w, h);
  for (let i = 0; i <= w; i += 6) { C(g, '#9c8a66', x + i, y, .55); C(g, '#9c8a66', x + i, y + h, .55); }
  for (let i = 0; i <= h; i += 6) { C(g, '#9c8a66', x, y + i, .55); C(g, '#9c8a66', x + w, y + i, .55); }
}
export function potager(g, x, y, w, h, R, clos = true) {
  RR(g, '#6e4c33', x, y, w, h, 1);
  for (let yy = y + 2.5; yy < y + h - 1; yy += 3) for (let xx = x + 2; xx < x + w - 1; xx += 2.4) C(g, R() < .5 ? '#4f9a45' : '#6db35a', xx + (R() - .5) * .4, yy, .75);
  if (clos) cloture(g, x - 1.5, y - 1.5, w + 3, h + 3);
}
export function mare(g, x, y) { E(g, '#4e7a3a', x, y, 17, 11); E(g, '#3a679f', x, y, 13.5, 8); E(g, 'rgba(160,195,235,.55)', x - 3, y - 2.5, 5, 1.6); }
export function botte(g, x, y, r = 2.6) {
  E(g, OMBRE, x + 1.2, y + 1.6, r, r * .9); C(g, '#d6ba5c', x, y, r);
  g.strokeStyle = '#b49841'; g.lineWidth = .45; g.beginPath(); g.arc(x, y, r * .62, 0, TAU); g.stroke(); C(g, '#c2a54a', x, y, r * .25);
}
const croix = (x, y, s = 1) => ({ t: 'fn', fn: g => { T(g, '#3a3530', .45 * s, x, y - 1.8 * s, x, y + 1.8 * s); T(g, '#3a3530', .45 * s, x - 1.1 * s, y - .6 * s, x + 1.1 * s, y - .6 * s); } });
const cheminee = (x, y) => ({ t: 'f', x: x - .7, y: y - .7, w: 1.4, h: 1.4, c: '#7d4a3a', h2: 1.8, chem: 1 });
function parterre(x, y, w, h, R) {   // parterre de broderie : buis taillé en volutes sur gravier
  return { t: 'fn', x, y, w, h, fn: g => {
    RR(g, '#e3d8bb', x, y, w, h, .4); g.strokeStyle = '#3f6b35'; g.lineWidth = .7;
    g.strokeRect(x + .8, y + .8, w - 1.6, h - 1.6);
    for (let k = 0; k < 4; k++) { const cx = x + w * (k % 2 ? .72 : .28), cy = y + h * (k < 2 ? .3 : .7); g.beginPath(); g.ellipse(cx, cy, w * .16, h * .14, 0, 0, TAU); g.stroke(); g.beginPath(); g.arc(cx, cy, Math.min(w, h) * .05, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(x + w / 2, y + 1.5); g.bezierCurveTo(x + w * .3, y + h * .5, x + w * .7, y + h * .5, x + w / 2, y + h - 1.5); g.stroke();
    if (R) for (let i = 0; i < 6; i++) C(g, '#2f5a2c', x + 1 + (i % 3) * (w - 2) / 2, y + (i < 3 ? 1 : h - 1), .9);
  } };
}
function gazon(x, y, w, h) {   // parterre de gazon : un tapis vert bordé de gravier, des ifs taillés aux coins
  return { t: 'fn', x, y, w, h, fn: g => {
    RR(g, '#e3d8bb', x, y, w, h, .4); RR(g, '#7aa659', x + 1.6, y + 1.6, w - 3.2, h - 3.2, .3); RR(g, '#86b264', x + 3.2, y + 3.2, w - 6.4, h - 6.4, .3);
    for (const [a, b] of [[x + 1, y + 1], [x + w - 1, y + 1], [x + 1, y + h - 1], [x + w - 1, y + h - 1]]) C(g, '#2f5a2c', a, b, .9);
  } };
}
function fruitiers(x, y, w, h, R) {   // potager et fruitiers en espalier (le jardin d'un hôtel plus modeste)
  return { t: 'fn', x, y, w, h, fn: g => {
    RR(g, '#e3d8bb', x, y, w, h, .4); potager(g, x + 1.5, y + 1.5, w * .55 - 2, h - 3, R, false);
    for (let yy = y + 3; yy < y + h - 1; yy += 5) for (let xx = x + w * .6 + 1.5; xx < x + w - 1; xx += 5) arbre(g, xx, yy, 1.9, '#5f9a48');
  } };
}
function drapeau(g, x, y) { RR(g, '#2b4ea0', x, y - 1.6, 1.3, 1.6, 0); RR(g, '#f4f1ea', x + 1.3, y - 1.6, 1.3, 1.6, 0); RR(g, '#c8322b', x + 2.6, y - 1.6, 1.3, 1.6, 0); }

// ---------- bâtiments d'époque (maquette) ; repère : unités de la maquette, centrés sur le bâtiment
export const BATS = {
  egliseRomane: (p = 'ardoise') => [
    ...[-14, -8, -2].flatMap(x => [{ t: 'f', x, y: -7.3, w: 1.6, h: 1.5, c: '#a89c86', h2: .8 }, { t: 'f', x, y: 5.8, w: 1.6, h: 1.5, c: '#a89c86', h2: .8 }]),
    { t: 'g', x: -18, y: -6, w: 22, h: 12, p, h2: 1.6 }, { t: 'g', x: 4, y: -4.5, w: 6.5, h: 9, p, h2: 1.4 }, { t: 'abs', x: 10.5, y: 0, r: 4.5, p, h2: 1.3 },
    { t: 'p', x: -27, y: -5, w: 10, h: 10, p: 'ardoise', h2: 4 }, croix(-22, 0),
  ],
  cathedrale: () => {
    const P = 'ardoise', parts = [
      { t: 's', x: -40, y: -15, w: 46, h: 6, n: [0, -1], p: 'plomb', h2: 1.6 }, { t: 's', x: -40, y: 9, w: 46, h: 6, n: [0, 1], p: 'plomb', h2: 1.6 },
      { t: 's', x: 19, y: -15, w: 16, h: 6, n: [0, -1], p: 'plomb', h2: 1.6 }, { t: 's', x: 19, y: 9, w: 16, h: 6, n: [0, 1], p: 'plomb', h2: 1.6 },
      ...[-60, -30, 0, 30, 60].map(d => ({ t: 'c', x: 35 + Math.cos(d * Math.PI / 180) * 16, y: Math.sin(d * Math.PI / 180) * 16, r: 4.4, p: 'plomb', h2: 1.4 })),
      { t: 'abs', x: 35, y: 0, r: 15, p: 'plomb', h2: 1.6 },
    ];
    for (let x = -36; x <= 32; x += 6) if (x < 4 || x > 18) for (const s of [-1, 1]) parts.push({ t: 'f', x: x - .4, y: s < 0 ? -16.5 : 9, w: .8, h: 7.5, c: '#c9bfa7', h2: 2.2 }, { t: 'f', x: x - .9, y: s < 0 ? -17.4 : 15.2, w: 1.8, h: 2.2, c: '#b3a88f', h2: 2.4 });
    parts.push({ t: 'g', x: -40, y: -9, w: 46, h: 18, p: P, h2: 2.8 }, { t: 'g', x: 19, y: -9, w: 16, h: 18, p: P, h2: 2.8 }, { t: 'abs', x: 35, y: 0, r: 9, p: P, h2: 2.8 },
      { t: 'g', x: 6, y: -26, w: 13, h: 52, ax: 'y', p: P, h2: 2.8 }, { t: 'c', x: 12.5, y: 0, r: 3.4, p: 'plomb', h2: 8 },
      { t: 'f', x: -52, y: -5, w: 12, h: 10, c: '#c2b8a0', h2: 4 }, { t: 'f', x: -53, y: -17, w: 13, h: 13, c: '#b9b09a', h2: 6.5, bal: 1 }, { t: 'f', x: -53, y: 4, w: 13, h: 13, c: '#b9b09a', h2: 6.5, bal: 1 },
      { t: 'fn', fn: g => { for (const [x, y] of [[-52, -16], [-41, -16], [-52, -5], [-41, -5], [-52, 5], [-41, 5], [-52, 16], [-41, 16]]) C(g, '#d8cdb5', x, y, .7); } });
    return parts;
  },
  egliseDome: () => [
    { t: 'g', x: -30, y: -8, w: 34, h: 16, p: 'ardoise', h2: 2.4 }, { t: 'g', x: -4, y: -20, w: 16, h: 40, ax: 'y', p: 'ardoise', h2: 2.4 },
    { t: 'g', x: 12, y: -7, w: 10, h: 14, p: 'ardoise', h2: 2.2 }, { t: 'abs', x: 22, y: 0, r: 7, p: 'ardoise', h2: 2.2 },
    { t: 'f', x: -36, y: -11, w: 7, h: 22, c: '#cdc3ab', h2: 3.4, bal: 1 }, { t: 'd', x: 4, y: 0, r: 10, p: 'plomb', h2: 6 },
  ],
  fermeCour: () => [
    { t: 'r', sol: 1, c: '#bdb197', x: -22, y: -18, w: 44, h: 36 },
    { t: 'fn', fn: g => { E(g, '#5a4330', 2, 3, 8, 5); E(g, '#7a5a3a', 1, 2, 5.5, 3.2); for (const [x, y] of [[-12, 8], [-9, 10], [12, -9]]) C(g, '#f3efe6', x, y, .6); } },
    { t: 'g', x: -20, y: -27, w: 38, h: 9, p: 'tuile', h2: 1.6 }, cheminee(-14, -22.5), cheminee(10, -22.5),
    { t: 'g', x: -31, y: -20, w: 11, h: 42, ax: 'y', p: 'tuile', h2: 2.2 }, { t: 'g', x: 20, y: -27, w: 10, h: 38, ax: 'y', p: 'tuile', h2: 1.5 },
    { t: 'g', x: -20, y: 18, w: 24, h: 8, p: 'tuile', h2: 1.3 }, { t: 'g', x: 5, y: 17, w: 9, h: 10, hip: 1, p: 'tuile', h2: 1.8 },
    { t: 'f', x: 14, y: 21, w: 16, h: 2, c: '#b3a88f', h2: .8 }, { t: 'c', x: 26, y: 15, r: 4, p: 'tuile', h2: 2.6 },
    { t: 'fn', fn: g => { mare(g, 40, 22); botte(g, -38, 26); botte(g, -42, 21); } },
    { t: 'arbre', x: 38, y: -26, r: 6.5, c: BOIS[2] }, { t: 'arbre', x: 44, y: -14, r: 5, c: BOIS[4] },
  ],
  longere: (p = 'ardoise') => [
    { t: 'fn', fn: (g) => { potager(g, -22, 9, 20, 12, alea(4)); C(g, '#857c6c', 18, 10, 2.2); C(g, '#3d5f86', 18, 10, 1.2); } },
    { t: 'f', x: -30, y: -5.6, w: 2.4, h: 11.2, c: '#9a9182', h2: 1.7 }, { t: 'f', x: 27.6, y: -5.6, w: 2.4, h: 11.2, c: '#9a9182', h2: 1.7 },
    { t: 'g', x: -28, y: -5, w: 56, h: 10, p, h2: 1.4 }, cheminee(-26.5, 0), cheminee(26.5, 0), cheminee(2, -2),
    { t: 's', x: -8, y: 5, w: 12, h: 4, n: [0, 1], p, h2: .9 },
    { t: 'arbre', x: 34, y: -12, r: 6, c: BOIS[1] }, { t: 'arbre', x: -36, y: 10, r: 5, c: '#5a9748' },
  ],
  mas: () => [
    { t: 'r', sol: 1, c: '#d8c9a3', x: -16, y: 6, w: 26, h: 9, rr: 1 },
    ...[-30, -24, -18, -12, -6, 0, 6, 12, 18].map(x => ({ t: 'arbre', x, y: -16, r: 1.9, c: '#24452a', h2: 4 })),
    { t: 'k', x: -14, y: -7, w: 20, h: 12, h2: 1.6 }, { t: 'k', x: 6, y: -5, w: 12, h: 10, h2: 1.3 }, { t: 'k', x: -21, y: -4, w: 8, h: 9, h2: 1 },
    cheminee(-3, -2.5), { t: 'arbre', x: 20, y: 12, r: 9, c: '#4f7f3c', h2: 1.6 },
    ...[[-30, 14], [-24, 20], [-36, 22], [-30, 26]].map(([x, y]) => ({ t: 'arbre', x, y, r: 2.6, c: '#8a9a6a' })),
    { t: 'fn', fn: g => { C(g, '#857c6c', 14, -9, 2.2); C(g, '#3d5f86', 14, -9, 1.2); } },
  ],
  colombages: () => {
    const parts = [];
    let x = -30; const R = alea(3);
    for (let k = 0; k < 7; k++) {
      const w = 7 + R() * 2.5, d = 18 + R() * 5;
      parts.push({ t: 'g', x, y: 14 - d, w, h: d, ax: 'y', p: R() < .7 ? 'tuile' : 'ardoise', h2: 2.2 + R() * .6 });
      parts.push({ t: 'g', x: x + w / 2 - 1.5, y: 14 - d * .55, w: 3, h: 3, ax: 'y', p: 'tuile', h2: 2.4 }, cheminee(x + w * .5, 14 - d * .85));
      x += w + .2;
    }
    return parts;
  },
  // jardin : 0 parterres de broderie (un seul hôtel par ville), 1 parterres de gazon, 2 potager et fruitiers
  hotel: (jardin = 0) => [
    ...[-26, 2].map(x => jardin === 1 ? gazon(x, -46, 24, 16) : jardin === 2 ? fruitiers(x, -46, 24, 16, alea(x + 40)) : parterre(x, -46, 24, 16, 1)), { t: 'r', sol: 1, c: '#e3d8bb', x: -2, y: -46, w: 4, h: 34 },
    { t: 'fn', fn: g => { C(g, '#a89c86', 0, -28, 3.6); C(g, '#4a78b4', 0, -28, 2.7); for (let x = -26; x <= 26; x += 6) C(g, BOIS[2], x, -51, 2.4); } },
    { t: 'r', sol: 1, c: '#d2c8b0', x: -16, y: 3, w: 32, h: 21 },
    { t: 'f', x: -24, y: 24, w: 48, h: 2, c: '#c2b8a0', h2: 1.4 }, { t: 'g', x: -6, y: 20, w: 12, h: 7, hip: 1, p: 'ardoise', h2: 2 },
    { t: 'g', x: -24, y: 3, w: 8, h: 21, ax: 'y', p: 'ardoise', h2: 1.8 }, { t: 'g', x: 16, y: 3, w: 8, h: 21, ax: 'y', p: 'ardoise', h2: 1.8 },
    { t: 'g', x: -24, y: -9, w: 48, h: 12, hip: 1, p: 'ardoise', h2: 2.4 }, { t: 'g', x: -28, y: -11, w: 11, h: 15, hip: 1, p: 'ardoise', h2: 2.9 }, { t: 'g', x: 17, y: -11, w: 11, h: 15, hip: 1, p: 'ardoise', h2: 2.9 },
    cheminee(-10, -3), cheminee(10, -3),
  ],
  chateau: () => {
    const R = alea(8);
    return [
      { t: 'fn', fn: g => { RR(g, '#4a78b4', -50, -20, 100, 42, 2); RR(g, '#5a88c0', -48, -18, 96, 38, 2); } },   // douves
      { t: 'r', sol: 1, c: '#d2c8b0', x: -30, y: 6, w: 60, h: 30 }, { t: 'r', sol: 1, c: '#c9bfa7', x: -6, y: 18, w: 12, h: 26 },
      parterre(-46, -46, 40, 26, 1), parterre(6, -46, 40, 26, 1),
      { t: 'fn', fn: g => { for (let y = 46; y < 72; y += 6) { arbre(g, -12, y, 2.8, BOIS[2]); arbre(g, 12, y, 2.8, BOIS[2]); } for (let i = 0; i < 10; i++) arbre(g, -70 + R() * 20, -90 + R() * 30, 3.4, BOIS[i % 5]); } },
      { t: 'g', x: -40, y: 4, w: 12, h: 30, ax: 'y', p: 'ardoise', hip: 1, h2: 2.4 }, { t: 'g', x: 28, y: 4, w: 12, h: 30, ax: 'y', p: 'ardoise', hip: 1, h2: 2.4 },
      { t: 'g', x: -34, y: -10, w: 68, h: 15, hip: 1, p: 'ardoise', h2: 3 }, { t: 'g', x: -44, y: -14, w: 15, h: 20, hip: 1, p: 'ardoise', h2: 3.6 }, { t: 'g', x: 29, y: -14, w: 15, h: 20, hip: 1, p: 'ardoise', h2: 3.6 },
      { t: 'd', x: 0, y: -3, r: 9, p: 'ardoise', h2: 5.5 }, cheminee(-20, -2.5), cheminee(20, -2.5), cheminee(-36, -4), cheminee(36, -4),
    ];
  },
  halle: () => [
    { t: 'r', sol: 1, c: '#d3c8ae', x: -36, y: -24, w: 72, h: 48 },
    { t: 'fn', fn: g => { const R = alea(6); for (let i = 0; i < 18; i++) { const x = -32 + (i % 9) * 8, y = i < 9 ? -20 : 17; RR(g, ['#c45a43', '#f2efe6', '#6b8fb5', '#e3c04f'][i % 4], x, y, 5, 3, .4); T(g, 'rgba(255,255,255,.6)', .3, x + 1, y, x + 1, y + 3); } for (let i = 0; i < 30; i++) C(g, ['#5d6b86', '#7a4a3a', '#f2efe6', '#6e5c45'][i % 4], -30 + R() * 60, (R() < .5 ? -15 : 13) + (R() - .5) * 4, .7); } },
    { t: 'g', x: -24, y: -13, w: 48, h: 26, p: 'tuile', hip: 1, h2: 1.8 },
    { t: 'fn', fn: g => { for (let x = -22; x <= 22; x += 6.3) { C(g, '#5b4127', x, -13.6, .5); C(g, '#5b4127', x, 13.6, .5); } } },
  ],
  // (le bief et la roue ; la rivière elle-même est peinte par le sol)
  moulinEau: () => [
    { t: 'g', x: -6, y: -22, w: 22, h: 13, p: 'tuile', h2: 2.2 }, cheminee(10, -18),
    { t: 'fn', fn: g => { RR(g, '#4a78b4', -14, -8, 22, 4, .5); RR(g, '#5b4127', -4, -9, 7, 3.6, .4); T(g, '#3a2a1b', .35, -4, -8.8, 3, -8.8); T(g, '#3a2a1b', .35, -4, -5.6, 3, -5.6); } },   // (les aubes : roue)
    { t: 'g', x: 18, y: -20, w: 10, h: 10, p: 'tuile', h2: 1.2 }, { t: 'arbre', x: -22, y: -20, r: 6, c: BOIS[1] },
  ],
  caserne: () => {
    const parts = [
      { t: 'r', sol: 1, c: '#d9cda9', x: -30, y: -14, w: 60, h: 30 },
      { t: 'fn', fn: g => { T(g, '#5b4127', .4, 22, 10, 22, 4); drapeau(g, 22, 4); } },
      { t: 'g', x: -40, y: -26, w: 80, h: 12, hip: 1, p: 'ardoise', h2: 2.6 }, { t: 'g', x: -42, y: -14, w: 12, h: 32, ax: 'y', hip: 1, p: 'ardoise', h2: 2.6 }, { t: 'g', x: 30, y: -14, w: 12, h: 32, ax: 'y', hip: 1, p: 'ardoise', h2: 2.6 },
      { t: 'f', x: -30, y: 17, w: 60, h: 1.6, c: '#c2b8a0', h2: 1 }, { t: 'c', x: -2.5, y: 19, r: 1.5, p: 'ardoise', h2: 1.8 }, { t: 'c', x: 2.5, y: 19, r: 1.5, p: 'ardoise', h2: 1.8 },
    ];
    for (let x = -34; x <= 34; x += 8.5) parts.push(cheminee(x, -20));
    return parts;
  },
  haussmann: () => {
    const parts = [];
    let x = -45;
    while (x < 52) { const w = 9 + (x * 7 % 5); parts.push({ t: 'r', sol: 1, c: '#d8d2c4', x, y: 1, w: w - 1.5, h: 4 }, { t: 'm', x, y: 5, w, h: 12, h2: 3 }, { t: 'm', x, y: -15, w, h: 12, h2: 3 }); x += w + .3; }
    return parts;
  },
  gare: () => [
    { t: 'fn', fn: g => {
      RR(g, '#8a8578', -62, -30, 124, 30, 0);
      for (let k = 0; k < 4; k++) { const y = -26 + k * 7; for (let x = -62; x < 62; x += 1.6) T(g, '#5b4a3a', .5, x, y - 1.3, x, y + 1.3); T(g, '#3a3a3a', .3, -62, y - .8, 62, y - .8); T(g, '#3a3a3a', .3, -62, y + .8, 62, y + .8); }
      RR(g, '#c9bfa7', -62, -2, 124, 4, 0);
    } },
    { t: 'v', x: -42, y: -30, w: 62, h: 28, h2: 2.6 },
    { t: 'fn', fn: g => { RR(g, '#1c1c1c', 26, -21, 9, 3.4, .8); C(g, '#2a2a2a', 34, -19.3, 1.4); RR(g, '#3a3a3a', 18, -21, 7, 3.4, .5); for (let i = 0; i < 3; i++) RR(g, '#5a6b4a', 40 + i * 9.5, -21.2, 8.6, 3.8, .6); } },
    { t: 'g', x: -44, y: 2, w: 66, h: 12, hip: 1, p: 'ardoise', h2: 2.4 }, { t: 'g', x: -50, y: 0, w: 12, h: 16, hip: 1, p: 'ardoise', h2: 2.8 }, { t: 'g', x: 16, y: 0, w: 12, h: 16, hip: 1, p: 'ardoise', h2: 2.8 },
    { t: 'f', x: -16, y: 3, w: 10, h: 3, c: '#e3d8bb', h2: 3.4 }, { t: 'r', sol: 1, c: '#c9bfa7', x: -50, y: 16, w: 78, h: 12 },
  ],
  hotelDeVille: () => [
    { t: 'g', x: -20, y: -6, w: 40, h: 12, hip: 1, p: 'ardoise', h2: 2.4 }, { t: 'g', x: -24, y: -8, w: 9, h: 16, hip: 1, p: 'ardoise', h2: 2.8 }, { t: 'g', x: 15, y: -8, w: 9, h: 16, hip: 1, p: 'ardoise', h2: 2.8 },
    { t: 'p', x: -4, y: -4, w: 8, h: 8, p: 'ardoise', h2: 5.5 },   // le beffroi
  ],
  poudriere: () => [
    { t: 'fn', fn: g => { g.strokeStyle = '#a39b88'; g.lineWidth = 1.2; g.strokeRect(-15, -11, 30, 22); } },
    ...[-6, 0, 6].flatMap(x => [{ t: 'f', x: x - .8, y: -7.6, w: 1.6, h: 2, c: '#a89c86', h2: 1 }, { t: 'f', x: x - .8, y: 5.6, w: 1.6, h: 2, c: '#a89c86', h2: 1 }]),
    { t: 'g', x: -10, y: -6, w: 20, h: 12, p: 'tuile', h2: 1.8 },
  ],
  couvent: () => [
    { t: 'r', sol: 1, c: '#7aa659', x: -12, y: -12, w: 24, h: 24 }, { t: 'fn', fn: g => { T(g, '#e3d8bb', 1.2, -12, 0, 12, 0); T(g, '#e3d8bb', 1.2, 0, -12, 0, 12); C(g, '#a89c86', 0, 0, 1.6); } },
    { t: 'g', x: -18, y: -18, w: 36, h: 6, p: 'tuile', h2: 1.4 }, { t: 'g', x: -18, y: 12, w: 36, h: 6, p: 'tuile', h2: 1.4 }, { t: 'g', x: -18, y: -12, w: 6, h: 24, ax: 'y', p: 'tuile', h2: 1.4 }, { t: 'g', x: 12, y: -12, w: 6, h: 24, ax: 'y', p: 'tuile', h2: 1.4 },
    ...BATS.egliseRomane('ardoise').filter(p => p.t !== 'fn').map(p => Object.assign({}, p, { x: p.x - 4, y: p.y - 27 })),
  ],
  hopital: () => [
    { t: 'g', x: -26, y: -20, w: 52, h: 9, hip: 1, p: 'ardoise', h2: 2.2 }, { t: 'g', x: -26, y: 11, w: 52, h: 9, hip: 1, p: 'ardoise', h2: 2.2 }, { t: 'g', x: -26, y: -11, w: 9, h: 22, ax: 'y', p: 'ardoise', h2: 2.2 }, { t: 'g', x: 17, y: -11, w: 9, h: 22, ax: 'y', p: 'ardoise', h2: 2.2 },
    { t: 'r', sol: 1, c: '#7aa659', x: -15, y: -9, w: 30, h: 18 }, { t: 'd', x: 0, y: 0, r: 4.5, p: 'plomb', h2: 3.4 },
  ],
  // moulin à vent : la tour de pierre, un peu en cône, et son toit tournant ; les ailes et la queue : ailes
  moulin: () => [{ t: 'c', x: 0, y: 0, r: 7, p: 'pierre', h2: 3 }, { t: 'c', x: 0, y: 0, r: 5.4, p: 'ardoise', h2: .3 }],
  // maison (ou grange) seule : un toit à deux pans de w × h unités, une cheminée
  maison: (w, h, p, R, grange) => {
    const parts = [{ t: 'g', x: -w / 2, y: -h / 2, w, h, p, h2: 1.6, hip: !grange && R() < .2 }];
    if (!grange) parts.push(cheminee(w * .25 * (R() < .5 ? -1 : 1), -h * .22));
    return parts;
  },
};

// ---------- toits des îlots (maquette) : une parcelle le long de la rue (o : coin sur la rue, u : le long de la rue,
// n : vers l'intérieur de l'îlot) ; long : le faîtage parallèle à la rue, sinon pignon sur rue (colombages)
export function toitParcelle(g, o, u, n, w, d, P, long = true) {
  if (!long) {   // pignon sur rue : faîtage perpendiculaire à la rue
    const q = (a, b) => [o[0] + u[0] * a + n[0] * b, o[1] + u[1] * a + n[1] * b];
    const A = q(0, 0), B = q(w / 2, 0), Cc = q(w / 2, d), D = q(0, d), B2 = q(w, 0), C2 = q(w, d);
    PG(g, teinte(P, -u[0], -u[1]), [...A, ...B, ...Cc, ...D]); PG(g, teinte(P, u[0], u[1]), [...B, ...B2, ...C2, ...Cc]);
    g.strokeStyle = P[2]; g.lineWidth = .4; g.beginPath(); g.moveTo(B[0], B[1]); g.lineTo(Cc[0], Cc[1]); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = .25; g.beginPath(); g.moveTo(B2[0], B2[1]); g.lineTo(C2[0], C2[1]); g.stroke();
    return q(w / 2, d * .3);
  }
  const p1 = [o[0] + u[0] * w, o[1] + u[1] * w], m0 = [o[0] + n[0] * d / 2, o[1] + n[1] * d / 2], m1 = [p1[0] + n[0] * d / 2, p1[1] + n[1] * d / 2];
  const p2 = [p1[0] + n[0] * d, p1[1] + n[1] * d], p3 = [o[0] + n[0] * d, o[1] + n[1] * d];
  PG(g, teinte(P, -n[0], -n[1]), [o[0], o[1], p1[0], p1[1], m1[0], m1[1], m0[0], m0[1]]);
  PG(g, teinte(P, n[0], n[1]), [m0[0], m0[1], m1[0], m1[1], p2[0], p2[1], p3[0], p3[1]]);
  g.strokeStyle = P[2]; g.lineWidth = .4; g.beginPath(); g.moveTo(m0[0], m0[1]); g.lineTo(m1[0], m1[1]); g.stroke();
  const k = n[0] * SOLEIL[0] + n[1] * SOLEIL[1] > 0 ? .32 : -.32;   // (le faîtage accroche la lumière, côté éclairé)
  T(g, clair(P[0], .35), .22, m0[0] + n[0] * k, m0[1] + n[1] * k, m1[0] + n[0] * k, m1[1] + n[1] * k);
  g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = .25; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(p3[0], p3[1]); g.stroke();
  return m0;
}

// ---------- dégâts (maquette : toucher, dessinMaison) ; repère local du bâtiment, emprise w × h (unités)
// trous du toit : polygones déchiquetés, chevrons à nu, tuiles éclatées autour
export function trous(n, w, h, R) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const tx = (R() - .5) * Math.max(0, w - 5), ty = (R() - .5) * Math.max(0, h - 4), r = 1.8 + R() * 1.4, pts = [];
    for (let i = 0; i < 7; i++) { const a = i * TAU / 7, q = r * (.7 + R() * .5); pts.push([tx + Math.cos(a) * q, ty + Math.sin(a) * q]); }
    out.push({ x: tx, y: ty, r, pts });
  }
  return out;
}
export function dessinTrous(g, liste, c) {
  for (const tr of liste) {
    g.fillStyle = '#2a1f18'; ligne(g, tr.pts, true); g.fill();
    for (const d of [-1.1, 0, 1.1]) T(g, '#6b4d31', .35, tr.x + d, tr.y - tr.r * .9, tr.x + d, tr.y + tr.r * .9);
    for (let i = 0; i < 5; i++) { const a = i * 1.3 + tr.r, d = tr.r * 1.25; RR(g, clair(c, .12), tr.x + Math.cos(a) * d - .4, tr.y + Math.sin(a) * d - .3, .8, .6, .1); }
  }
}
// gravats autour d'un bâtiment touché (repère local, unités)
export function debris(g, w, h, c, R) {
  for (let i = 0; i < 12; i++) {
    const a = R() * TAU, d = Math.max(w, h) * (.4 + R() * .5);
    g.fillStyle = R() < .6 ? c : '#a89c86'; g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d * Math.min(1, h / w + .3)); g.rotate(R() * 3); g.fillRect(-.5, -.35, 1, .7); g.restore();
  }
}
// ruine : intérieur noirci, murs écroulés (trait discontinu), poutres tombées
export function ruine(g, w, h, R) {
  const hw = w / 2, hh = h / 2;
  RR(g, '#2c2622', -hw, -hh, w, h, .5);
  g.globalAlpha = .6; E(g, '#58524c', -hw * .3, hh * .2, hw * .45, hh * .4); E(g, '#4a443e', hw * .4, -hh * .3, hw * .3, hh * .3); g.globalAlpha = 1;
  for (let k = 0; k < 3; k++) { const p = R() * 3; T(g, '#16110d', .8, -hw * .8 + p, -hh * .7, hw * .7 - p, hh * .6); }
  g.setLineDash([2 + R() * 5, 1.6, 3, 1.2]); g.strokeStyle = '#b9ad95'; g.lineWidth = 1.5; g.strokeRect(-hw, -hh, w, h);
  g.setLineDash([]); g.strokeStyle = 'rgba(40,30,22,.7)'; g.lineWidth = .5; g.strokeRect(-hw + 1, -hh + 1, w - 2, h - 2);
}

// ---------- arbres (maquette : touffes, sapin) : par paquets d'une couleur, en un seul tracé chacun
// liste : [x, y, r, couleur, sorte] ; sorte : 'sapin', 'nu', 'meule', sinon une couronne ronde
export function arbres(g, liste, ombre = OMBRE) {
  const parCouleur = new Map(), sapins = new Map(), nus = [], meules = [];
  g.fillStyle = ombre; g.beginPath();
  for (const [x, y, r, c, k] of liste) {
    if (k === 'nu') { nus.push([x, y, r]); continue; }
    const ox = x + 1.2 + r * .15, oy = y + 1.6 + r * .2;
    if (k === 'sapin') etoile(g, ox, oy, r); else { g.moveTo(ox + r, oy); g.arc(ox, oy, r, 0, TAU); }
    const m = k === 'sapin' ? sapins : k === 'meule' ? null : parCouleur;
    if (m) { let l = m.get(c); if (!l) m.set(c, l = []); l.push([x, y, r]); } else meules.push([x, y, r]);
  }
  g.fill();
  for (const [c, l] of parCouleur) { g.fillStyle = c; g.beginPath(); for (const [x, y, r] of l) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); } g.fill(); }
  g.globalAlpha = .26; g.fillStyle = '#a5cf7f'; g.beginPath();
  for (const l of parCouleur.values()) for (const [x, y, r] of l) { const rr = r * .5, cx = x - r * .32, cy = y - r * .34; g.moveTo(cx + rr, cy); g.arc(cx, cy, rr, 0, TAU); }
  g.fill(); g.globalAlpha = 1;
  for (const [c, l] of sapins) {
    g.fillStyle = c; g.beginPath(); for (const [x, y, r] of l) etoile(g, x, y, r); g.fill();
    g.fillStyle = clair(c, .15); g.beginPath(); for (const [x, y, r] of l) etoile(g, x - r * .12, y - r * .12, r * .6); g.fill();
  }
  for (const [x, y, r] of meules) botte(g, x, y, r);
  if (nus.length) {   // arbres nus de l'hiver : le tronc et ses branches vus d'en haut
    // (un voile de ramilles, quelques maîtresses branches, le tronc)
    g.globalAlpha = .28; g.fillStyle = '#7d7064'; g.beginPath(); for (const [x, y, r] of nus) { g.moveTo(x + r * .85, y); g.arc(x, y, r * .85, 0, TAU); } g.fill();
    g.globalAlpha = .6; g.strokeStyle = '#5e5044'; g.lineCap = 'round'; g.lineWidth = .22; g.beginPath();
    for (const [x, y, r] of nus) for (let k = 0; k < 5; k++) { const a = k * 1.26 + x, l = r * (.55 + (k % 3) * .12); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
    g.stroke(); g.globalAlpha = 1; g.fillStyle = '#4a3c30'; g.beginPath(); for (const [x, y] of nus) { g.moveTo(x + .45, y); g.arc(x, y, .45, 0, TAU); } g.fill();
  }
}
function etoile(g, x, y, r) { for (let i = 0; i < 16; i++) { const a = i * TAU / 16, q = i % 2 ? r * .55 : r; if (i) g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); else g.moveTo(x + q, y); } g.closePath(); }

// ---------- moulin à vent vu d'en haut (maquette : moulinVu) ; repère du moulin, unités de la maquette
// Les ailes tournent dans un plan vertical face au vent : de dessus on les voit de profil, une barre fine en travers du
// vent dont la demi-longueur est le plus grand |L cos(t + k·90°)| des quatre bras (elle bat entre 0,71 L et L) ; c'est
// leur ombre au sol (soleil du nord-ouest : un bout d'aile à la hauteur h tombe à h·(sx, sy) du pied) qui montre qu'elles
// tournent, une croix de biais. t : angle des ailes ; wa : là où va le vent (la queue y pointe, le moyeu à l'opposé) ;
// r : rayon de la tour, L : longueur d'un bras, H : hauteur du moyeu
export function ailes(g, t, wa, r = 7, L = 17, H = 12) {
  const dx = Math.cos(wa), dy = Math.sin(wa), px = -dy, py = dx, sx = .34, sy = .45, hx = -dx * 4.5, hy = -dy * 4.5;
  const bras = [0, 1, 2, 3].map(k => t + k * Math.PI / 2);
  g.lineCap = 'round';
  g.save(); g.beginPath(); g.rect(-60, -60, 120, 120); g.moveTo(r, 0); g.arc(0, 0, r, 0, TAU); g.clip('evenodd');   // (pas sur la tour)
  g.strokeStyle = 'rgba(20,20,10,.3)'; g.lineWidth = 3.2; g.beginPath();
  for (const a of bras) { const u = L * Math.cos(a), h = H + L * Math.sin(a); g.moveTo(hx + sx * H, hy + sy * H); g.lineTo(hx + px * u + sx * h, hy + py * u + sy * h); }
  g.stroke(); g.restore();
  T(g, '#5b4127', 1, 0, 0, dx * 13, dy * 13);   // la queue, sous le vent
  const m = L * Math.max(...bras.map(a => Math.abs(Math.cos(a)))), x0 = hx - px * m, y0 = hy - py * m, x1 = hx + px * m, y1 = hy + py * m;
  T(g, '#4a3a28', 1.6, x0, y0, x1, y1); T(g, '#e8e0cc', .9, x0, y0, x1, y1);
  g.strokeStyle = '#7a5f3e'; g.lineWidth = .22; g.beginPath();   // (le treillis, de profil : ses barreaux)
  for (let s = 3.2; s < m - .8; s += 2.2) for (const k of [-1, 1]) { const x = hx + px * s * k, y = hy + py * s * k; g.moveTo(x - dx * .7, y - dy * .7); g.lineTo(x + dx * .7, y + dy * .7); }
  g.stroke();
  C(g, '#3a2a1b', hx, hy, 1.3);
}
// roue d'un moulin à eau (moulinEau) : verticale, dans le sens du bief, donc vue de profil, un rectangle mince ; les aubes
// du dessus défilent quand elle tourne (t : son angle)
export function roue(g, t, x0 = -4, y0 = -8.8, x1 = 3, y1 = -5.6) {
  const r = (x1 - x0) / 2, cx = (x0 + x1) / 2;
  g.strokeStyle = '#3a2a1b'; g.lineWidth = .3; g.beginPath();
  for (let k = 0; k < 12; k++) { const a = t + k * TAU / 12; if (Math.sin(a) < 0) continue; const x = cx + r * Math.cos(a); g.moveTo(x, y0); g.lineTo(x, y1); }
  g.stroke();
}

// ---------- la vie des champs (maquette : dessinVie) ; repère de la bête, unités des figures, l'avant vers +x
function civil(g, habit, tete, legs) {
  if (legs != null) { const o = Math.sin(legs) * 1.4; E(g, '#6b5a44', o + .2, -.95, 1.15, .55); E(g, '#6b5a44', -o + .2, .95, 1.15, .55); C(g, '#1d1a17', o + 1.2, -.95, .45); C(g, '#1d1a17', -o + 1.2, .95, .45); }
  RR(g, habit, -1.35, -2.15, 2.7, 4.3, 1.2);
  if (tete === 'coiffe') { C(g, '#f2efe6', 0, 0, 1.25); C(g, '#d9d3c2', -.2, 0, .7); } else { C(g, '#4a3a28', 0, 0, 1.8); C(g, '#3a2b1c', 0, 0, 1.05); }
}
function boeuf(g, robe, mv) {
  for (const [x, y, s] of [[2.6, -1.6, 1], [2.6, 1.6, -1], [-2.6, -1.5, -1], [-2.6, 1.5, 1]]) E(g, sombre(robe, .4), x + mv * s, y, .9, .4);
  E(g, robe, 0, 0, 4.3, 1.9); E(g, sombre(robe, .08), 4.6, 0, 1.4, .95); T(g, '#efe6cc', .35, 5.3, -.8, 5.8, -1.5); T(g, '#efe6cc', .35, 5.3, .8, 5.8, 1.5);
}
const TAILLE = { vache: [4.6, 2], mouton: [2, 1.4], charrette: [14, 4], poule: [.8, .6], canard: [.9, .6], chien: [1.8, .8] };
export function bete(g, e, t) {
  const sz = TAILLE[e.k] || [2.2, 2.1];
  if (e.k !== 'canard') E(g, OMBRE, 1, 1.4, sz[0], sz[1]);
  g.lineCap = 'round';
  const mv = e.v > .3 ? Math.sin(e.pas * TAU) : 0;
  switch (e.k) {
    case 'vache': {
      if (e.v > .3) for (const [x, y, s] of [[2.6, -1.6, 1], [2.6, 1.6, -1], [-2.6, -1.5, -1], [-2.6, 1.5, 1]]) E(g, sombre(e.robe, .4), x + mv * s, y, .9, .4);
      T(g, sombre(e.robe, .4), .5, -4.2, 0, -6, mv * .5);
      E(g, e.robe, 0, 0, 4.3, 1.9); E(g, e.tache, -1.2, .5, 1.4, .9, .4); E(g, e.tache, 1.7, -.6, 1, .7, -.3);
      const tb = e.v > .3 ? 0 : Math.max(0, Math.sin(t * .8 + e.x)) * .8;   // la tête baisse pour brouter
      E(g, sombre(e.robe, .08), 4.6 + tb, 0, 1.4, .95); T(g, '#efe6cc', .35, 5.3 + tb, -.8, 5.8 + tb, -1.5); T(g, '#efe6cc', .35, 5.3 + tb, .8, 5.8 + tb, 1.5); break;
    }
    case 'mouton': for (const [x, y] of [[-1, -.6], [-1, .6], [.4, -.7], [.4, .7], [-.3, 0]]) C(g, '#f1efe6', x, y, .9); C(g, '#2c2a28', 1.9, 0, .6); break;
    case 'chien': T(g, '#6b4a2c', .35, -1.6, 0, -2.6, mv * .5 + Math.sin(t * 9) * .4); E(g, '#6b4a2c', 0, 0, 1.7, .75); C(g, '#5a3d24', 1.8, 0, .6); break;
    case 'poule': E(g, e.couleur, 0, 0, .75, .5); C(g, '#d33a2a', .65 + Math.max(0, Math.sin(t * 6 + e.x0)) * .3, 0, .22); break;
    case 'canard': E(g, '#f5f2ea', 0, 0, .9, .5); C(g, '#2f6b3a', .75, 0, .36); break;
    case 'berger': civil(g, '#6b5a44', 'rond', e.v > .3 ? e.pas * TAU : null); T(g, '#6b4d31', .4, .4, 2, 5, 2.8); break;
    case 'civil': civil(g, e.habit, e.tete, e.pas * TAU); C(g, '#b9a37a', -2.1, 0, 1.4); break;
    case 'charrette': {   // charrette à bœufs : deux bœufs sous le joug, le bouvier à côté
      for (const x of [-4, 4]) { RR(g, '#3a2a1b', x - 2, -3.7, 4, 1, .4); RR(g, '#3a2a1b', x - 2, 2.7, 4, 1, .4); }
      T(g, '#5b4127', .6, 6, 0, 10, 0); RR(g, '#8a6a45', -6.5, -2.9, 13, 5.8, .6);
      RR(g, '#b8a27a', -5.5, -2.2, 4, 4.4, .5); RR(g, '#d6ba5c', -1, -2.3, 3.5, 2.2, .4); RR(g, '#c45a43', -1, .2, 3.6, 2, .4); C(g, '#6e5134', 4.2, 0, 1.4);
      for (const y of [-2.4, 2.4]) { g.save(); g.translate(15, y); g.scale(1, .8); boeuf(g, '#b08a5a', mv * .5); g.restore(); }
      T(g, '#6b4d31', .7, 11, -4.6, 11, 4.6);
      g.save(); g.translate(13, 6); civil(g, '#6e5c45', 'rond', e.pas * TAU); g.restore(); break;
    }
  }
}

// ---------- petites images (maquette : sprite) : fumées pâle et noire, lueur, flamme, braise
export function sprites(mk) {
  const S = {};
  const rond = (nom, rgb) => {
    const c = mk(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(.55, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); S[nom] = c;
  };
  rond('f', '244,242,234'); rond('n', '62,58,54'); rond('lueur', '255,150,50'); rond('braise', '255,140,40');
  {
    const c = mk(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 38, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,248,200,1)'); gr.addColorStop(.3, 'rgba(255,190,70,.95)'); gr.addColorStop(.65, 'rgba(235,90,20,.55)'); gr.addColorStop(1, 'rgba(180,30,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); S.fl = c;
  }
  return S;
}

// ---------- dégâts d'un bâtiment fait de volumes : les toits seuls sont noircis, crevés ou ruinés (pas la cour)
const toitDe = p => !p.sol && p.t !== 'fn' && p.t !== 'arbre' && p.t !== 'r' && p.t !== 'poly' && !p.chem;
export function voile(g, parts, c = '#1c0f08', al = .5) {
  g.globalAlpha = al; g.fillStyle = c; g.beginPath();
  for (const p of parts) if (toitDe(p)) empreinte(g, p, 0, 0);
  g.fill(); g.globalAlpha = 1;
}
export function trousParts(parts, n, R) {
  const toits = parts.filter(p => toitDe(p) && (p.w || p.r * 2) > 5), out = [];
  for (let k = 0; k < n && toits.length; k++) {
    const p = toits[(R() * toits.length) | 0], [cx, cy, w, h] = p.r != null ? [p.x, p.y, p.r * 1.4, p.r * 1.4] : [p.x + p.w / 2, p.y + p.h / 2, p.w, p.h];
    for (const t of trous(1, w, h, R)) { t.x += cx; t.y += cy; t.pts = t.pts.map(([x, y]) => [x + cx, y + cy]); out.push(t); }
  }
  return out;
}
export function ruines(g, parts, R) {
  for (const p of parts) {
    if (!toitDe(p)) continue;
    g.save();
    if (p.r != null) { g.translate(p.x, p.y); ruine(g, p.r * 1.7, p.r * 1.7, R); }
    else if (p.w > 2.5 && p.h > 2.5) { g.translate(p.x + p.w / 2, p.y + p.h / 2); ruine(g, p.w, p.h, R); }
    g.restore();
  }
}
