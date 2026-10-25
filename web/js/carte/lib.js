// Primitives de dessin vu de dessus des maquettes (web/js/dev/carte-vivante.html, battle/dev/maquette-2d.html) :
// formes, couleurs, figures (fantassins, cavaliers, pièces, chevaux), bâtiments, fumées. Reprises telles quelles pour
// que la carte de campagne dessine comme la maquette validée ; marche aussi dans un worker (OffscreenCanvas).
// (sous Node, pour les tests : ni document ni OffscreenCanvas, toile() rend null et les images d'avance sont sautées)
const toile = (w, h) => typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null;
const TAU = Math.PI * 2, PEAU = '#e2b996';
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, mod = (a, n) => ((a % n) + n) % n;
const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
function alea(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hx = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const MEMO = new Map();
function mix(a, b, k) {
  const key = a + b + k; let v = MEMO.get(key);
  if (!v) { const A = hx(a), B = hx(b); v = '#' + A.map((x, i) => Math.round(x + (B[i] - x) * k).toString(16).padStart(2, '0')).join(''); MEMO.set(key, v); }
  return v;
}
const sombre = (c, k = .25) => mix(c, '#000000', k), clair = (c, k = .25) => mix(c, '#ffffff', k);
function E(g, c, x, y, rx, ry, r = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, r, 0, TAU); g.fill(); }
function C(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function T(g, c, w, x1, y1, x2, y2) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
function RR(g, c, x, y, w, h, r) { g.fillStyle = c; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
function PG(g, c, p) { g.fillStyle = c; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); }
function ligne(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); }
function dup(P, x, y, m, fn) {
  fn(x, y); if (!P) return;
  const xs = [x], ys = [y];
  if (x < m) xs.push(x + P); if (x > P - m) xs.push(x - P);
  if (y < m) ys.push(y + P); if (y > P - m) ys.push(y - P);
  for (const a of xs) for (const b of ys) if (a !== x || b !== y) fn(a, b);
}

const SOLS = {
  chaume: { nom: 'Chaume', base: '#cfb87e', raie: '#bea86b', pas: 5, ep: 2 },
  ble: { nom: 'Blé mûr', base: '#d8bf6c', raie: '#c7aa55', pas: 4, ep: 1.7 },
  labour: { nom: 'Labour', base: '#6f4a31', raie: '#5b3b26', pas: 5, ep: 2.4 },
  pre: { nom: 'Pré', base: '#7aa659', raie: '#72a052', pas: 8, ep: 3.5 },
  colza: { nom: 'Colza levé', base: '#418d3e', raie: '#377d35', pas: 4, ep: 2 },
  friche: { nom: 'Friche', base: '#8e8b4e', raie: '#817e45', pas: 5, ep: 2.2 },
  jachere: { nom: 'Jachère', base: '#b9ad86', raie: '#aca079', pas: 8, ep: 2.5 },
};
const HERBE = '#6c984d', BOIS = ['#2f5e2c', '#3a6c34', '#45793c', '#2b5427', '#518644'], OMBRE = 'rgba(20,32,12,.42)';

function parcelle(g, p, R, P = 0) {
  const s = SOLS[p.sol], { x, y, w, h } = p;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = s.base; g.fillRect(x, y, w, h);
  g.globalAlpha = .2;
  for (let i = 0, n = w * h / 700; i < n; i++) {
    const c = R() < .5 ? clair(s.base, .14) : sombre(s.base, .12), rx = 8 + R() * 18, ry = 5 + R() * 12, r = R() * 3;
    dup(P, x + R() * w, y + R() * h, 30, (a, b) => E(g, c, a, b, rx, ry, r));
  }
  g.globalAlpha = 1;
  g.strokeStyle = s.raie; g.lineWidth = s.ep; g.beginPath();
  if (p.dir === 'h') for (let yy = y + s.pas / 2; yy < y + h; yy += s.pas) { g.moveTo(x, yy); g.lineTo(x + w, yy); }
  else for (let xx = x + s.pas / 2; xx < x + w; xx += s.pas) { g.moveTo(xx, y); g.lineTo(xx, y + h); }
  g.stroke();
  // menus détails de chaque culture
  const n = w * h * (p.det ?? 1), pt = (cnt, fn) => { for (let i = 0; i < cnt; i++) { const a = R(), b = R(), c = R(), d = R(); dup(P, x + a * w, y + b * h, 3, (u, v) => fn(u, v, c, d)); } };
  if (p.sol === 'pre') {
    pt(n / 40, (u, v, c, d) => E(g, c < .5 ? '#5f8f43' : '#86b363', u, v, .8 + d, .6 + d * .6, c * 3));
    pt(n / 380, (u, v, c) => C(g, c < .6 ? '#f4f1e4' : '#efd45a', u, v, .38));
  } else if (p.sol === 'labour') pt(n / 26, (u, v, c, d) => C(g, c < .5 ? '#7d5839' : '#4f331f', u, v, .4 + d * .6));
  else if (p.sol === 'chaume') pt(n / 45, (u, v, c) => { g.strokeStyle = c < .5 ? '#e4d3a0' : '#b39c60'; g.lineWidth = .35; g.beginPath(); g.moveTo(u, v); p.dir === 'h' ? g.lineTo(u + 1.6, v + .2) : g.lineTo(u + .2, v + 1.6); g.stroke(); });
  else if (p.sol === 'ble') pt(n / 36, (u, v, c) => C(g, c < .5 ? '#ead28a' : '#b9993f', u, v, .35));
  else if (p.sol === 'colza') pt(n / 34, (u, v, c, d) => C(g, c < .5 ? '#52a24c' : '#2f6e2e', u, v, .5 + d * .4));
  else pt(n / 40, (u, v, c, d) => E(g, c < .5 ? clair(s.base, .15) : sombre(s.base, .18), u, v, .9 + d, .6, c * 3));
  if (!P) {
    // tournières : la bande où l'attelage tourne, au bout des raies
    g.fillStyle = mix(s.base, s.raie, .5);
    if (p.dir === 'h') { g.fillRect(x, y, 5, h); g.fillRect(x + w - 5, y, 5, h); }
    else { g.fillRect(x, y, w, 5); g.fillRect(x, y + h - 5, w, 5); }
    g.strokeStyle = 'rgba(245,235,200,.3)'; g.lineWidth = 1.4; g.strokeRect(x + .7, y + .7, w - 1.4, h - 1.4);
  }
  g.restore();
}
function arbre(g, x, y, r, c) {
  C(g, OMBRE, x + 1.6, y + 2.2, r); C(g, c, x, y, r);
  g.globalAlpha = .28; C(g, '#a5cf7f', x - r * .32, y - r * .34, r * .5); g.globalAlpha = 1;
}
function touffes(g, pts) {   // ombres, puis houppiers, puis reflets : les arbres se recouvrent proprement
  for (const p of pts) C(g, OMBRE, p[0] + 2, p[1] + 2.6, p[2]);
  for (const p of pts) C(g, p[3], p[0], p[1], p[2]);
  g.globalAlpha = .26; for (const p of pts) C(g, '#a5cf7f', p[0] - p[2] * .32, p[1] - p[2] * .34, p[2] * .5); g.globalAlpha = 1;
}
function bois(g, x, y, w, h, R, pas = 9) {
  const pts = [];
  for (let yy = y + 4; yy < y + h - 2; yy += pas * .8) for (let xx = x + 4; xx < x + w - 2; xx += pas)
    pts.push([xx + (R() - .5) * pas, yy + (R() - .5) * pas, pas * .6 + R() * pas * .55, BOIS[R() * BOIS.length | 0]]);
  RR(g, '#284b24', x + 3, y + 3, w - 6, h - 6, 8);
  touffes(g, pts);
}
function haie(g, x1, y1, x2, y2, R) {
  const d = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / d, ny = (x2 - x1) / d;
  g.lineCap = 'round';
  T(g, 'rgba(20,32,12,.35)', 5.5, x1 + 1.6, y1 + 2.2, x2 + 1.6, y2 + 2.2); T(g, '#2c5628', 4.2, x1, y1, x2, y2);
  const pts = [];
  for (let s = 0; s < d; s += 4 + R() * 7) { const j = (R() - .5) * 1.6; pts.push([x1 + (x2 - x1) * s / d + nx * j, y1 + (y2 - y1) * s / d + ny * j, 2.6 + R() * 3.4, BOIS[R() * 5 | 0]]); }
  touffes(g, pts);
}
function chemin(g, pts, w = 7) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  ligne(g, pts); g.strokeStyle = '#d9caa1'; g.lineWidth = w; g.stroke();
  g.setLineDash([3.5, 3]); g.strokeStyle = '#bba981'; g.lineWidth = .9; g.stroke(); g.setLineDash([]);
}
function decaler(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - (b[1] - a[1]) / l * d, p[1] + (b[0] - a[0]) / l * d];
  });
}
function route(g, pts, w = 17) {
  const R = alea(Math.round(w * 100) + pts.length);
  g.lineCap = 'round'; g.lineJoin = 'round';
  ligne(g, pts); g.strokeStyle = '#5b7f3f'; g.lineWidth = w + 7; g.stroke();   // les fossés
  g.strokeStyle = '#7d9c55'; g.lineWidth = w + 4; g.stroke();                    // les accotements herbus
  g.strokeStyle = '#ad9a70'; g.lineWidth = w; g.stroke();
  g.strokeStyle = '#c6b388'; g.lineWidth = w * .8; g.stroke();
  g.strokeStyle = '#d3c299'; g.lineWidth = w * .3; g.stroke();                   // le bombement, plus clair au milieu
  for (const s of [-1, 1]) { ligne(g, decaler(pts, s * w * .24)); g.strokeStyle = 'rgba(120,96,60,.5)'; g.lineWidth = w * .09; g.stroke(); }   // ornières
  let acc = 0, borne = 30;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0); if (!l) continue;
    const ux = (x1 - x0) / l, uy = (y1 - y0) / l;
    for (let t = 0; t < l; t += 1.6) {
      for (let k = 0; k < 2; k++) { const o = (R() - .5) * w * .85; C(g, R() < .5 ? '#a8946a' : '#e0d2ab', x0 + ux * t - uy * o, y0 + uy * t + ux * o, .18 + R() * .22); }
      if (R() < .006) E(g, 'rgba(110,130,140,.45)', x0 + ux * t - uy * w * .2, y0 + uy * t + ux * w * .2, w * .14, w * .07, Math.atan2(uy, ux));   // flaque
      if ((acc += 1.6) > borne) { acc = 0; borne = 70; const bx = x0 + ux * t - uy * (w / 2 + 1.6), by = y0 + uy * t + ux * (w / 2 + 1.6); C(g, OMBRE, bx + .5, by + .7, .9); C(g, '#ebe5d6', bx, by, .8); C(g, '#c9c0aa', bx, by, .35); }
    }
  }
}
function rue(g, pts, w = 9) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  ligne(g, pts); g.strokeStyle = '#8b826e'; g.lineWidth = w + 1.4; g.stroke();
  g.strokeStyle = '#a69d88'; g.lineWidth = w; g.stroke();
  g.setLineDash([.9, .45]); g.strokeStyle = 'rgba(80,72,58,.35)'; g.lineWidth = .7;
  for (let o = -w / 2 + .8; o < w / 2 - .4; o += 1.2) { g.lineDashOffset = o * 3.3; ligne(g, decaler(pts, o)); g.stroke(); }
  g.setLineDash([]); g.lineDashOffset = 0;
  ligne(g, pts); g.strokeStyle = '#776f5e'; g.lineWidth = .6; g.stroke();
}
function riviere(g, pts, R) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  ligne(g, pts); g.strokeStyle = '#557f3e'; g.lineWidth = 46; g.stroke();
  g.strokeStyle = '#4b7438'; g.lineWidth = 34; g.stroke();
  g.strokeStyle = '#355f97'; g.lineWidth = 27; g.stroke();
  g.strokeStyle = '#4a78b4'; g.lineWidth = 19; g.stroke();
  g.setLineDash([2.5, 11, 1.2, 9]); g.strokeStyle = 'rgba(160,195,235,.45)'; g.lineWidth = 1.1; g.stroke();
  g.lineDashOffset = 9; g.translate(0, 4); ligne(g, pts); g.stroke(); g.translate(0, -4); g.setLineDash([]); g.lineDashOffset = 0;
  // ripisylve : arbres et roseaux le long des berges
  const t = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], d = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / d, ny = (x1 - x0) / d;
    if (R() < .45) { const s = R() < .5 ? 1 : -1, o = 20 + R() * 7; t.push([x1 + nx * o * s, y1 + ny * o * s, 3.5 + R() * 3.5, BOIS[R() * 5 | 0]]); }
    for (let k = 0; k < 3; k++) { const s = R() < .5 ? 1 : -1, o = 13.5 + R() * 2; C(g, R() < .5 ? '#6d9a4a' : '#3f6a33', x1 + nx * o * s + (R() - .5) * 8, y1 + ny * o * s, .6); }
  }
  touffes(g, t);
}
function pont(g, x, y, a) {
  g.save(); g.translate(x, y); g.rotate(a);
  RR(g, 'rgba(20,20,10,.35)', -26 + 1.5, -7 + 2.2, 52, 14, 2);
  RR(g, '#b8ad94', -26, -7, 52, 14, 2); RR(g, '#cfc3a2', -26, -4, 52, 8, 1);
  RR(g, '#8f856e', -26, -7, 52, 2.2, 1); RR(g, '#8f856e', -26, 4.8, 52, 2.2, 1);
  for (let i = -20; i <= 20; i += 10) { T(g, '#7d745f', .5, i, -7, i, -4.8); T(g, '#7d745f', .5, i, 4.8, i, 7); }
  g.restore();
}
function toit(g, x, y, w, h, type) {
  const c = type === 'tuile' ? ['#c45a43', '#9e4334', '#7d3429'] : ['#8193a6', '#66778a', '#4d5b6b'];
  RR(g, 'rgba(20,20,10,.35)', x + 2.4, y + 3, w, h, 1);
  if (w >= h) { RR(g, c[0], x, y, w, h / 2, 1); RR(g, c[1], x, y + h / 2, w, h / 2, 1); T(g, c[2], .9, x, y + h / 2, x + w, y + h / 2); }
  else { RR(g, c[0], x, y, w / 2, h, 1); RR(g, c[1], x + w / 2, y, w / 2, h, 1); T(g, c[2], .9, x + w / 2, y, x + w / 2, y + h); }
}
function ferme(g, cx, cy) {
  E(g, '#bdb197', cx, cy, 64, 37); E(g, '#c9bea6', cx - 6, cy - 4, 40, 20);
  g.setLineDash([2.5, 1.2]); g.strokeStyle = '#968d79'; g.lineWidth = 1.6; g.beginPath(); g.ellipse(cx, cy, 67, 40, 0, .3, TAU - .3); g.stroke(); g.setLineDash([]);
  toit(g, cx - 44, cy - 24, 34, 13, 'tuile'); toit(g, cx - 2, cy - 27, 38, 13, 'ardoise'); toit(g, cx - 10, cy + 2, 42, 13, 'ardoise'); toit(g, cx + 34, cy - 8, 13, 26, 'tuile');
  C(g, '#857c6c', cx - 26, cy + 12, 2.6); C(g, '#3d5f86', cx - 26, cy + 12, 1.4);   // puits
  C(g, OMBRE, cx + 54, cy + 22, 7); C(g, '#cbb062', cx + 52, cy + 20, 7); g.strokeStyle = '#a88f45'; g.lineWidth = .6; g.beginPath(); g.arc(cx + 52, cy + 20, 4.5, 0, TAU); g.stroke();   // meule
  RR(g, '#7a5a3a', cx + 18, cy + 20, 8, 4, 1); C(g, '#3a2a1b', cx + 19, cy + 24.5, 1.4); C(g, '#3a2a1b', cx + 25, cy + 24.5, 1.4);   // charrette
}
function mare(g, x, y) { E(g, '#4e7a3a', x, y, 17, 11); E(g, '#3a679f', x, y, 13.5, 8); E(g, 'rgba(160,195,235,.55)', x - 3, y - 2.5, 5, 1.6); }
function botte(g, x, y, r = 2.6) {
  E(g, OMBRE, x + 1.2, y + 1.6, r, r * .9); C(g, '#d6ba5c', x, y, r);
  g.strokeStyle = '#b49841'; g.lineWidth = .45; g.beginPath(); g.arc(x, y, r * .62, 0, TAU); g.stroke(); C(g, '#c2a54a', x, y, r * .25);
}
function moutons(g, x, y, R, n) {
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, px = x + (R() - .5) * 60, py = y + (R() - .5) * 36;
    E(g, OMBRE, px + 1, py + 1.3, 2, 1.3, a); E(g, '#f1efe6', px, py, 2, 1.25, a); C(g, '#2c2a28', px + Math.cos(a) * 2.1, py + Math.sin(a) * 2.1, .65);
  }
}
function cloture(g, x, y, w, h) {
  g.strokeStyle = '#e2d6b6'; g.lineWidth = .55; g.strokeRect(x, y, w, h);
  for (let i = 0; i <= w; i += 6) { C(g, '#9c8a66', x + i, y, .55); C(g, '#9c8a66', x + i, y + h, .55); }
  for (let i = 0; i <= h; i += 6) { C(g, '#9c8a66', x, y + i, .55); C(g, '#9c8a66', x + w, y + i, .55); }
}
function verger(g, p, R) {
  const pal = ['#4f8a41', '#5a9748', '#467e3a'], pts = [];
  for (let y = p.y + 9; y < p.y + p.h - 5; y += 14) for (let x = p.x + 9; x < p.x + p.w - 5; x += 14) pts.push([x + (R() - .5) * 1.5, y + (R() - .5) * 1.5, 3.8 + R() * 1.2, pal[R() * 3 | 0]]);
  touffes(g, pts);
}
function calvaire(g, x, y) { RR(g, OMBRE, x - 1.2, y - .6, 4, 4, .5); RR(g, '#a39b88', x - 2, y - 2, 4, 4, .5); T(g, '#3a3530', .7, x, y - 3.2, x, y + 3.2); T(g, '#3a3530', .7, x - 1.8, y - 1.2, x + 1.8, y - 1.2); }
function pietine(g, x, y, rx, ry, a, f = .16) { E(g, `rgba(105,80,45,${f})`, x, y, rx, ry, a); }
function cratere(g, x, y, r = 3.2, R = Math.random) {
  E(g, 'rgba(60,42,22,.22)', x, y, r * 2.2, r * 1.8, R() * 3);
  for (let i = 0; i < 9; i++) { const a = R() * TAU, d = r * (1.2 + R() * 1.6); C(g, R() < .5 ? '#6d5338' : '#4f3b27', x + Math.cos(a) * d, y + Math.sin(a) * d, .35 + R() * .5); }
  C(g, '#5a4330', x, y, r); C(g, '#3b2b1d', x + .3, y + .4, r * .55);
}

function tenue(side, type) {
  const fr = side === 'fr';
  const L = {
    habit: fr ? '#2f4f9c' : '#b8352c', revers: fr ? '#f1eee4' : '#efe3c2', culotte: fr ? '#e9e5d8' : '#e3dbc6',
    sac: fr ? '#8a6a45' : '#5e4c34', couv: fr ? '#c9c2b0' : '#8c8e7e', buff: '#f2efe6', epaul: fr ? '#f1eee4' : '#efe3c2',
    tete: 'shako', pompon: fr ? '#c8322b' : '#f2efe6', plume: null, sacOn: true, drap: fr ? 'tri' : 'croix',
    chevaux: ['#6b4a2c', '#3f2d1f', '#8b6a47', '#54402e', '#2e2119'], chabraque: fr ? '#2f4f9c' : '#b8352c', galon: '#f2efe6',
    affut: fr ? '#5f6b3e' : '#7d8b95', fut: '#b08a3e', caisse: fr ? '#5f6b3e' : '#7d8b95', bache: '#ece4cb',
  };
  switch (type) {
    case 'legere':
      if (fr) Object.assign(L, { habit: '#26407c', epaul: '#e3c23c', pompon: '#e3c23c', plume: '#3f8a3c' });
      else Object.assign(L, { habit: '#2f5a36', revers: '#1d2e20', buff: '#1a1a1a', culotte: '#2f3a32', pompon: '#1a1a1a', epaul: '#1d2e20' });
      break;
    case 'grenadiers': Object.assign(L, { tete: 'ourson', epaul: '#c8322b', plume: '#c8322b' }); break;
    case 'chasseurs': Object.assign(L, { tete: 'beret', habit: fr ? '#2d3e6e' : '#2f5a36', ceinture: '#b32a26', sacOn: false, epaul: fr ? '#2d3e6e' : '#2f5a36', culotte: fr ? '#3a4466' : '#2f3a32', revers: null }); break;
    case 'sapeurs': Object.assign(L, { tete: 'ourson', tablier: '#f4f0e4', epaul: '#c8322b', plume: '#c8322b' }); break;
    case 'milice': Object.assign(L, { tete: 'rond', habits: fr ? ['#5d6b86', '#6e5c45', '#4f5a6a', '#7d6d55', '#3f4c66'] : ['#7a5040', '#6b5a44', '#8a6a4a', '#5a4b3a', '#94443a'], sacOn: false, buff: null, epaul: null, revers: null, culotte: '#8d806a' }); break;
    case 'cavalerie': Object.assign(L, { tete: fr ? 'casque' : 'colback', habit: fr ? '#2f6a3e' : '#33467a', revers: fr ? '#e0c25a' : '#e5d6a8', chabraque: fr ? '#2f6a3e' : '#33467a', galon: fr ? '#e6c95c' : '#f0e6c8' }); break;
    case 'artillerie': Object.assign(L, { habit: fr ? '#2a3c6c' : '#2b3550', epaul: '#c8322b', sacOn: false }); break;
    case 'mitrailleuses': Object.assign(L, { tete: 'kepi', kepi: fr ? '#b8322b' : '#2f3440', habit: fr ? '#2b3d78' : '#2f3440', culotte: fr ? '#b8322b' : '#3a3e46', buff: null, epaul: fr ? '#2b3d78' : '#2f3440', revers: null, affut: '#4f5458', fut: '#36393d', mit: true, sacOn: false }); break;
    case 'general': Object.assign(L, { tete: 'bicorne', habit: fr ? '#24386e' : '#b8352c', epaul: '#e3c04f', plume: '#f4f1ea', chabraque: fr ? '#24386e' : '#2a2a3a', galon: '#e3c04f', chevaux: ['#e8e2d4', '#6b4a2c', '#3f2d1f', '#8b6a47'] }); break;
    case 'chariot': Object.assign(L, { habit: fr ? '#4a5878' : '#7a4a3a', sacOn: false }); break;
    case 'civil': Object.assign(L, { tete: 'rond', sacOn: false, buff: null, epaul: null, revers: null, culotte: '#6b5a44', habit: '#7a6a4f' }); break;
  }
  return L;
}

let GRAINE = 1;
function unite(o) {
  const u = Object.assign({ side: 'fr', type: 'ligne', form: 'ligne', state: 'repos', x: 0, y: 0, a: 0, n: 36, t: 0, ph: 0, pas: 0, alpha: 1, spread: 0, tEtat: 0 }, o);
  u.seed = o.seed ?? (GRAINE++ * 7919 + 13);
  u.P = { artillerie: 7, mitrailleuses: 6, legere: 4.6, chasseurs: 4.6, milice: 7.5 }[u.type] || 6;
  u.look = tenue(u.side, u.type); u.figs = placer(u);
  return u;
}
function placer(u) {
  const R = alea(u.seed), F = [], n = u.n, T = u.type, L = u.look;
  const H = o => { o.r = R(); o.jx = (R() - .5) * 52; o.jy = (R() - .5) * 40; o.dl = R() * .25; if (L.habits) o.habit = L.habits[R() * L.habits.length | 0]; F.push(o); return o; };
  if (T === 'artillerie' || T === 'mitrailleuses') {
    for (let i = 0; i < n; i++) {
      if (u.form === 'attelee') {
        const bx = -i * 46;
        H({ role: 'cheval', ox: bx + 18, oy: -2.7, i }); H({ role: 'cheval', ox: bx + 18, oy: 2.7, i, monte: true });
        H({ role: 'cheval', ox: bx + 7, oy: -2.7, i }); H({ role: 'cheval', ox: bx + 7, oy: 2.7, i, monte: true });
        H({ role: 'avant', ox: bx - 3, oy: 0, i }); H({ role: 'piece', ox: bx - 13, oy: 0, fa: Math.PI, i });
        H({ role: 'h', ox: bx - 5, oy: 7, i }); H({ role: 'h', ox: bx - 14, oy: 7, i }); H({ role: 'h', ox: bx - 10, oy: -7, i });
      } else {
        const oy = (i - (n - 1) / 2) * 24;
        H({ role: 'piece', ox: 0, oy, i });
        if (!u.rempart) { H({ role: 'avant', ox: -24, oy, fa: Math.PI, i }); H({ role: 'cheval', ox: -33, oy: oy - 2.7, fa: Math.PI, i }); H({ role: 'cheval', ox: -33, oy: oy + 2.7, fa: Math.PI, i, monte: true }); }
        H({ role: 'servant', job: 'refouloir', ox: u.rempart ? -1 : 3, oy: oy - 4.8, i }); H({ role: 'servant', job: 'pointeur', ox: -11, oy: oy + .6, i });
        H({ role: 'servant', ox: -3, oy: oy + 5.2, i }); if (!u.rempart) H({ role: 'servant', ox: -15, oy: oy - 5, i });
      }
    }
    return F;
  }
  if (T === 'general') { H({ role: 'cav', ox: 0, oy: 0, gen: true }); H({ role: 'cav', ox: -10, oy: -9 }); H({ role: 'cav', ox: -11, oy: 8, fanion: true }); H({ role: 'cav', ox: -21, oy: 0 }); return F; }
  if (T === 'chariot') {
    H({ role: 'cheval', ox: 17, oy: -2.7 }); H({ role: 'cheval', ox: 17, oy: 2.7, monte: true });
    H({ role: 'cheval', ox: 6, oy: -2.7 }); H({ role: 'cheval', ox: 6, oy: 2.7 }); H({ role: 'caisson', ox: -9, oy: 0 });
    return F;
  }
  if (T === 'cavalerie') {
    const files = u.form === 'colonne' ? 4 : Math.ceil(n / 2);
    for (let k = 0; k < n; k++) { const r = k / files | 0, f = k % files; H({ role: 'cav', ox: -r * 13, oy: (f - (files - 1) / 2) * 7, rang: r }); }
    H({ role: 'cav', ox: 9, oy: 0, officier: true, fanion: true });
    return F;
  }
  // infanterie
  if (u.form === 'carre') {
    const perFace = Math.ceil(n / 4), row = Math.ceil(perFace / 2), half = (row - 1) / 2 * 5 + 5.5;
    for (let face = 0; face < 4; face++) {
      const fa = face * Math.PI / 2, c = Math.cos(fa), s = Math.sin(fa);
      for (let r = 0; r < 2; r++) for (let k = 0; k < row; k++) {
        const lx = half - r * 4.6, ly = (k - (row - 1) / 2) * 5;
        H({ role: 'h', ox: lx * c - ly * s, oy: lx * s + ly * c, fa, rang: r });
      }
    }
    H({ role: 'drapeau', ox: 0, oy: 0 }); H({ role: 'officier', ox: 4, oy: -4 }); H({ role: 'tambour', ox: -4, oy: 4 });
    return F;
  }
  if (u.form === 'tirailleurs') {
    const Wd = u.large || 120, paires = Math.ceil(n / 2);
    for (let k = 0; k < n; k++) {
      const p = k >> 1, py = (paires > 1 ? p / (paires - 1) - .5 : 0) * Wd;
      H({ role: 'h', ox: (R() - .5) * 22 - (k & 1 ? 4 : 0), oy: py + (k & 1 ? 2.5 : 0) + (R() - .5) * 6, fa: (R() - .5) * .5, rang: 0, off: R() * u.P });
    }
    return F;
  }
  const col = u.form === 'colonne', rangs = col ? Math.ceil(n / 6) : (u.rangs || 3), files = Math.ceil(n / rangs), ep = T === 'sapeurs' ? 7 : 5.2;
  for (let k = 0; k < n; k++) {
    const r = k / files | 0, f = k % files;
    const o = H({ role: 'h', ox: -r * 5, oy: (f - (files - 1) / 2) * ep, rang: r, off: T === 'milice' ? R() * 1.4 : 0 });
    if (T === 'milice' && R() < .25) o.pique = true;
  }
  if (T !== 'sapeurs') {
    const centre = F.find(f => f.rang === Math.min(1, rangs - 1) && Math.abs(f.oy) < ep * .6);
    if (centre) centre.role = 'drapeau';
    H({ role: 'officier', ox: col ? 6 : -2, oy: col ? -(files + 1) / 2 * ep : (files + 1) / 2 * ep + 1 });
    H({ role: 'tambour', ox: -(rangs - 1) * 5 - 6, oy: col ? (files + 1) / 2 * ep : -(files - 1) / 2 * ep });
  }
  return F;
}
const BOUGE = { marche: 1, charge: 1, deroute: 1 };
const CHEVAL = new Set(['cav', 'cheval']);
function poseFig(u, f) {
  let ox = f.ox, oy = f.oy, fa = f.fa || 0;
  const t = u.t, st = u.state, p = { legs: null, arme: 'epaule', ext: 0, recul: 0, gait: null, sabre: 0, bob: 0 };
  const vehicule = f.role === 'piece' || f.role === 'avant' || f.role === 'caisson' || (f.role === 'cheval' && u.type !== 'cavalerie');
  if (vehicule) {
    if (f.role === 'piece' && st === 'feu') {
      const c = mod(t + u.ph + f.i * 1.37, u.P);
      p.recul = u.type === 'mitrailleuses' ? (c < 1.8 ? Math.random() * .45 : 0) : c < 1.1 ? 2.8 * (1 - c / 1.1) ** 2 : 0;
    }
    if (BOUGE[st]) p.gait = u.pas * TAU + f.r * 2; else p.bob = Math.sin(t * 1.1 + f.r * 20);
    if (f.monte && f.role === 'cheval') p.monte = true;
  } else if (f.role === 'servant') {
    p.arme = 'aucun';
    if (st === 'feu') {
      const c = mod(t + u.ph + f.i * 1.37, u.P);
      if (f.job === 'refouloir') { const k = c > 2 && c < 4.4 ? Math.sin(Math.PI * (c - 2) / 2.4) : 0; ox += k * 5; oy += k * 2.6; p.arme = 'refouloir'; p.ext = k; if (k > .05) p.legs = t * 9; }
      else if (f.job === 'pointeur') { p.arme = 'aucun'; ox += c > 4.6 && c < 6 ? -1.5 : 0; }
      else if (c < .35) { ox -= 1.4; }
    }
  } else if (CHEVAL.has(f.role)) {
    switch (st) {
      case 'repos': p.bob = Math.sin(t * 1.1 + f.r * 20); ox += Math.sin(t * .4 + f.r * 9) * .4; if (f.gen) p.lunette = mod(t + f.r * 5, 7) < 3.5; break;
      case 'marche': p.gait = u.pas * TAU + f.r * 2; break;
      case 'charge': p.gait = u.pas * TAU + f.r * 3; ox += Math.sin(t * 2.3 + f.r * 30) * 2; oy += Math.sin(t * 1.3 + f.r * 11) * .8; p.sabre = 1; break;
      case 'melee': {
        const s = Math.sin(t * (1.5 + f.r) + f.r * 40);
        ox += 4 + s * 5; oy += Math.cos(t * (1.1 + f.r * .7) + f.r * 9) * 5; fa += Math.sin(t * .9 + f.r * 7) * .9;
        p.gait = t * 12 + f.r * 7; p.sabre = 2; p.ext = Math.sin(t * 7 + f.r * 9); break;
      }
      case 'deroute': ox += f.jx * u.spread * 1.4; oy += f.jy * u.spread * 1.4; fa = Math.PI + (f.r - .5) * 1 + Math.sin(t * 1.5 + f.r * 9) * .2; p.gait = u.pas * TAU + f.r * 6; break;
    }
    if (f.role === 'cheval' && f.monte) p.monte = true;
  } else {
    switch (st) {
      case 'repos': p.arme = u.type === 'sapeurs' ? 'hache0' : 'sol'; ox += Math.sin(t * .7 + f.r * 9) * .25; break;
      case 'marche': p.legs = u.pas * TAU + f.r * .6; break;
      case 'charge': p.legs = u.pas * TAU + f.r * 6; p.arme = 'baio'; ox += Math.sin(t * 5 + f.r * 30) * 1.2; oy += Math.sin(t * 3.1 + f.r * 17) * .6; break;
      case 'feu': {
        if (f.role !== 'h' || f.pique || (u.form !== 'tirailleurs' && f.rang >= (u.form === 'carre' ? 1 : 2))) { p.arme = f.role === 'h' && !f.pique ? 'epaule' : 'sol'; break; }
        const c = mod(t + u.ph + f.dl + (f.off || 0), u.P);
        if (c < .45) p.arme = 'epaule';
        else if (c < 1.3) p.arme = 'joue';
        else if (c < 1.6) { p.arme = 'joue'; ox -= (1.6 - c) * 1.6; }
        else if (c < u.P - .7) { p.arme = 'recharge'; p.ext = c * 9; }
        else p.arme = 'epaule';
        if (u.form === 'tirailleurs') ox += Math.sin(t * .3 + f.r * 20) * 3;
        break;
      }
      case 'melee': {
        const s = Math.sin(t * (3 + f.r * 3) + f.r * 40);
        ox += 3 + s * 1.6 - (f.rang ? 1 : 0); oy += Math.sin(t * 1.7 + f.r * 13) * 1.6;
        fa += (f.r - .5) * .9 + Math.sin(t * 2 + f.r * 7) * .3; p.arme = 'baio'; p.ext = Math.max(0, s); if (s > .3) p.legs = t * 8; break;
      }
      case 'deroute': ox += f.jx * u.spread; oy += f.jy * u.spread; fa = Math.PI + (f.r - .5) * 1.2 + Math.sin(t * 2 + f.r * 9) * .25; p.legs = u.pas * TAU * 1.2 + f.r * 6; p.arme = f.r < .5 ? 'aucun' : 'epaule'; break;
      case 'travail': p.arme = 'hache'; p.ext = mod(t * 1.1 + f.r * 3, 1); break;
    }
    if (f.pique && p.arme !== 'aucun') p.arme = st === 'charge' || st === 'melee' ? 'pique' : 'piqueH';
    if (f.role === 'drapeau') p.arme = 'aucun';
    if (f.role === 'officier') p.arme = st === 'charge' || st === 'melee' ? 'epee+' : 'epee';
    if (f.role === 'tambour') p.arme = 'tambour';
  }
  const c = Math.cos(u.a), s = Math.sin(u.a);
  p.x = u.x + ox * c - oy * s; p.y = u.y + ox * s + oy * c; p.a = u.a + fa;
  return p;
}

function fusil(g, x1, y1, x2, y2, baio) {
  const xm = x1 + (x2 - x1) * .6, ym = y1 + (y2 - y1) * .6;
  T(g, '#6b4d31', .62, x1, y1, xm, ym); T(g, '#8d9196', .4, xm, ym, x2, y2);
  if (baio) { const d = Math.hypot(x2 - x1, y2 - y1); T(g, '#e2e6e9', .28, x2, y2, x2 + (x2 - x1) / d * 2.2, y2 + (y2 - y1) / d * 2.2); }
}
function bras(g, c, x1, y1, x2, y2) { T(g, c, 1.1, x1, y1, x2, y2); }
function tete(g, L, kind, f) {
  switch (kind) {
    case 'shako': C(g, '#1c1b1d', .2, 0, 1.18); E(g, '#0f0f10', 1.2, 0, .45, 1); C(g, f && f.role !== 'h' ? '#e3c04f' : L.pompon, .55, 0, .42); if (L.plume) E(g, L.plume, .2, -.1, 1.1, .32, -.3); break;
    case 'ourson': C(g, '#231a14', 0, 0, 1.65); for (let k = 0; k < 7; k++) C(g, '#2e231a', Math.cos(k * .9) * 1.3, Math.sin(k * .9) * 1.3, .55); C(g, L.plume || '#c8322b', -.5, -1.3, .5); break;
    case 'bicorne': C(g, PEAU, .6, 0, .7); E(g, '#1a1817', .05, 0, .95, 2.35); E(g, L.plume, -.15, 0, .55, 1.8); C(g, '#2b4ea0', .7, -1.2, .38); C(g, '#f4f1ea', .7, -1.2, .22); break;
    case 'casque': C(g, '#c9a34a', .1, 0, 1.15); T(g, '#151311', .75, .6, 0, -2.8, 0); C(g, '#a07f34', .95, 0, .35); break;
    case 'kepi': C(g, L.kepi, 0, 0, 1); g.strokeStyle = '#283a78'; g.lineWidth = .35; g.beginPath(); g.arc(0, 0, .95, 0, TAU); g.stroke(); E(g, '#151515', 1.05, 0, .4, .8); break;
    case 'beret': C(g, '#b32a26', 0, 0, 1.5); C(g, '#7e1a17', 0, 0, .25); break;
    case 'rond': C(g, '#4a3a28', 0, 0, 1.8); C(g, '#3a2b1c', 0, 0, 1.05); break;
    case 'coiffe': C(g, '#f2efe6', 0, 0, 1.25); C(g, '#d9d3c2', -.2, 0, .7); break;
    case 'colback': C(g, '#2a2018', 0, 0, 1.35); E(g, '#b8352c', -1.1, .6, .9, .4); break;
  }
}
function fantassin(g, L, f, p) {
  const hab = f.habit || L.habit;
  if (p.legs != null) {
    const o = Math.sin(p.legs) * 1.4;
    E(g, L.culotte, o + .2, -.95, 1.15, .55); E(g, L.culotte, -o + .2, .95, 1.15, .55);
    C(g, '#1d1a17', o + 1.2, -.95, .45); C(g, '#1d1a17', -o + 1.2, .95, .45);
  }
  if (L.sacOn && f.role !== 'officier') { RR(g, L.sac, -2.4, -1.45, 1.5, 2.9, .5); RR(g, L.couv, -2.75, -1.35, .7, 2.7, .35); }
  if (f.role === 'tambour') { C(g, '#f2efe6', .6, -2.6, 1.3); g.strokeStyle = hab; g.lineWidth = .35; g.beginPath(); g.arc(.6, -2.6, 1.3, 0, TAU); g.stroke(); }
  RR(g, hab, -1.35, -2.15, 2.7, 4.3, 1.2);
  if (L.revers) RR(g, L.revers, .55, -.75, .7, 1.5, .3);
  if (L.ceinture) RR(g, L.ceinture, -.2, -2.1, .7, 4.2, .3);
  if (L.buff && f.role !== 'officier') { g.strokeStyle = L.buff; g.lineWidth = .42; g.beginPath(); g.moveTo(-1.05, -1.75); g.lineTo(.9, 1.7); g.moveTo(-1.05, 1.75); g.lineTo(.9, -1.7); g.stroke(); }
  if (L.tablier) RR(g, L.tablier, .55, -1.35, 1, 2.7, .3);
  const ep = f.role === 'officier' || f.role === 'drapeau' ? '#e3c04f' : L.epaul;
  if (ep) { C(g, ep, -.1, -2, .62); C(g, ep, -.1, 2, .62); }
  switch (p.arme) {
    case 'joue': fusil(g, .4, 1.2, 7.4, .55, false); bras(g, hab, -.2, 1.9, .6, 1.25); bras(g, hab, 0, -1.9, 3.2, .6); C(g, PEAU, 3.3, .62, .45); break;
    case 'baio': { const e = p.ext * 2.2; fusil(g, -.6 + e, 1.5, 6.2 + e, .9, true); bras(g, hab, -.2, 1.9, .2 + e * .5, 1.5); bras(g, hab, 0, -1.9, 2.8 + e * .6, 1.1); break; }
    case 'epaule': fusil(g, 1, 2.05, -3, 2.45, true); bras(g, hab, -.2, 1.9, .9, 2.1); break;
    case 'recharge': { const r = Math.sin(p.ext) * 1.1 + 1.1; fusil(g, 1.6, .9, 3.4, 1.4, false); T(g, '#cfd3d6', .25, 3.4, 1.4, 3.4 + r * .6, 1.4 + r * .25); bras(g, hab, -.1, 1.9, 1.7, 1); bras(g, hab, 0, -1.9, 2.8 + r * .4, 1.3); break; }
    case 'sol': fusil(g, .4, 2.3, 1.7, 2.7, true); break;
    case 'hache0': T(g, '#6b4d31', .5, .2, 2.2, -2.5, 2.8); RR(g, '#9aa0a5', -3.3, 2.4, 1.2, 1.3, .3); break;
    case 'hache': {
      const k = p.ext < .55 ? -1.6 + p.ext / .55 * 2.7 : 1.1 - (p.ext - .55) / .45 * 2.7, ax = .4 + Math.cos(k * .55) * 4.6, ay = 1.4 + Math.sin(k * .55) * 4.6 - 1.6;
      bras(g, hab, -.2, 1.9, .6 + (ax - .4) * .3, 1.2); bras(g, hab, 0, -1.9, .8 + (ax - .4) * .3, .4);
      T(g, '#6b4d31', .5, .6, 1, ax, ay); RR(g, '#9aa0a5', ax - .5, ay - .9, 1.3, 1.8, .3); break;
    }
    case 'pique': T(g, '#7a5b3a', .45, -.5, 1.4, 8.5, 1); T(g, '#9aa0a5', .25, 8.5, .6, 9.7, .6); T(g, '#9aa0a5', .25, 8.5, 1.4, 9.7, 1.4); bras(g, hab, 0, 1.9, 1, 1.4); break;
    case 'piqueH': T(g, '#7a5b3a', .45, 1, 2.2, -4, 2.6); break;
    case 'refouloir': T(g, '#7a5b3a', .45, -3, 1.2, 4 + p.ext * 2, .4); C(g, '#2a2a2a', 4 + p.ext * 2, .4, .55); bras(g, hab, 0, 1.9, 1.2, 1); break;
    case 'epee': T(g, '#dfe3e6', .3, .4, 2.1, -2.4, 2.9); break;
    case 'epee+': bras(g, hab, -.1, 1.9, 1.6, 2.2); T(g, '#dfe3e6', .3, 1.6, 2.2, 6, 1.4); break;
    case 'tambour': { const b = Math.sin(f.r * 9 + performance.now() / 90); T(g, '#d9c49a', .25, .3, -1.6, 1 + b * .4, -2.4); T(g, '#d9c49a', .25, .3, -.6, 1 - b * .4, -2.2); break; }
  }
  if (f.role === 'drapeau') { C(g, '#5b4127', 1.2, 1.6, .5); C(g, '#d9b44a', 1.2, 1.6, .32); }
  tete(g, L, L.tete, f);
}
function cheval(g, c, p) {
  const mov = p.gait != null, st = mov ? Math.sin(p.gait) : 0, jambe = sombre(c, .35);
  if (mov) { E(g, jambe, 3.2 + st * 1.7, -1.65, 1.3, .45); E(g, jambe, 3.2 - st * 1.7, 1.65, 1.3, .45); E(g, jambe, -3.4 - st * 1.7, -1.6, 1.3, .45); E(g, jambe, -3.4 + st * 1.7, 1.6, 1.3, .45); }
  g.lineCap = 'round'; T(g, sombre(c, .5), 1.1, -5.1, 0, -7.6, mov ? st * .9 : p.bob * .4);
  E(g, c, 0, 0, 5.3, 2.05);
  g.globalAlpha = .22; E(g, '#ffffff', -.8, -.55, 3.2, .6); g.globalAlpha = 1;
  const hb = (mov ? Math.cos(p.gait * 2) * .45 : 0) + p.bob * .5;
  E(g, c, 5.2 + hb * .5, 0, 2.4, 1.05); E(g, sombre(c, .12), 7.3 + hb, 0, 1.35, .78);
  T(g, sombre(c, .55), .6, 3.4, 0, 6.3 + hb * .5, 0);
  C(g, sombre(c, .4), 6.7 + hb, -.55, .26); C(g, sombre(c, .4), 6.7 + hb, .55, .26);
}
function cavalier(g, L, f, p, postillon) {
  if (!postillon) { RR(g, L.chabraque, -3.4, -2.5, 4.6, 5, 1); g.strokeStyle = L.galon; g.lineWidth = .35; g.beginPath(); g.roundRect(-3.1, -2.2, 4, 4.4, .8); g.stroke(); }
  E(g, '#1b1816', .2, -2.15, 1.25, .55); E(g, '#1b1816', .2, 2.15, 1.25, .55);
  E(g, L.habit, -.4, 0, 1.45, 2.05);
  if (L.revers && !postillon) RR(g, L.revers, .4, -.6, .55, 1.2, .25);
  C(g, f.gen || f.officier ? '#e3c04f' : (L.epaul || L.habit), -.5, -1.8, .5); C(g, f.gen || f.officier ? '#e3c04f' : (L.epaul || L.habit), -.5, 1.8, .5);
  if (p.sabre) {
    const sa = p.sabre === 2 ? p.ext * 1.3 : -.2;
    bras(g, L.habit, -.3, 1.7, 1.4, 2.3); T(g, '#e3e7ea', .32, 1.4, 2.3, 1.4 + Math.cos(sa) * 6, 2.3 + Math.sin(sa) * 6);
  } else { bras(g, L.habit, -.2, 1.6, 1.4, .8); bras(g, L.habit, -.2, -1.6, 1.4, -.8); }
  if (p.lunette) { T(g, '#c9a34a', .55, .8, -.7, 3.8, -.5); if (mod(performance.now() / 1000, 1.4) < .12) C(g, '#fffbe6', 3.9, -.5, .8); }
  tete(g, L, postillon ? 'shako' : f.gen ? 'bicorne' : L.tete === 'bicorne' ? (f.fanion ? 'shako' : 'bicorne') : L.tete, f);
}
function piece(g, L, p) {
  const x = -p.recul;
  PG(g, sombre(L.affut, .12), [x - 1, -1.3, x - 11.5, -.75, x - 11.5, .75, x - 1, 1.3]);
  RR(g, '#3a2a1b', x - 2.3, -3.6, 4.6, 1.05, .4); RR(g, '#3a2a1b', x - 2.3, 2.55, 4.6, 1.05, .4);
  T(g, '#2b2b2b', .7, x, -3, x, 3);
  RR(g, L.affut, x - 3.2, -1.55, 4.4, 3.1, .6);
  if (L.mort) {
    RR(g, '#4a4036', x - 3, -2.4, 6, 4.8, .6); C(g, '#2c2f33', x + .4, 0, 2.2); C(g, '#141414', x + 1, 0, 1.2);
    return;
  }
  if (L.mit) {
    RR(g, '#2c2f33', x - 2.6, -1.25, 7.4, 2.5, .6);
    for (let i = -.8; i <= .8; i += .4) T(g, '#4a4e53', .14, x - 1.6, i, x + 4.6, i);
    T(g, '#8d9196', .4, x - 2.6, 1.3, x - 3.6, 2.1);
  } else {
    RR(g, L.fut, x - 2.6, -.78, 9, 1.56, .75); C(g, sombre(L.fut, .25), x + 6.2, 0, .86);
    g.globalAlpha = .35; T(g, '#ffffff', .3, x - 1.8, -.35, x + 5.5, -.35); g.globalAlpha = 1;
  }
  RR(g, sombre(L.affut, .2), x - 9.5, -.9, 2.4, 1.8, .3);
}
function avant(g, L) {
  RR(g, '#3a2a1b', -2.2, -3.7, 4.4, 1, .4); RR(g, '#3a2a1b', -2.2, 2.7, 4.4, 1, .4);
  RR(g, L.affut, -2.6, -2.3, 5.2, 4.6, .6); T(g, sombre(L.affut, .3), .3, -2.2, 0, 2.2, 0);
  T(g, '#5b4127', .5, 2.6, 0, 9, 0);
}
function caisson(g, L) {
  for (const [x, y] of [[-6, -3.9], [-6, 2.9], [5, -3.9], [5, 2.9]]) RR(g, '#3a2a1b', x - 2.2, y, 4.4, 1, .4);
  T(g, '#5b4127', .6, 8, 0, 15, 0);
  RR(g, L.caisse, -8.5, -3.2, 17, 6.4, 1);
  RR(g, L.bache, -8, -3.7, 14, 7.4, 2.8);
  g.globalAlpha = .16; RR(g, '#000000', -8, .2, 14, 3.5, 2); g.globalAlpha = 1;
  for (let i = 0; i < 5; i++) T(g, sombre(L.bache, .14), .4, -6 + i * 2.8, -3.5, -6 + i * 2.8, 3.5);
}
function corps(g, L, b) {   // un homme tombé
  E(g, L.culotte, -3.3, -.7, 1.8, .55); E(g, L.culotte, -3.3, .8, 1.8, .55);
  RR(g, b.habit || L.habit, -1.6, -2, 3.4, 4, 1.1);
  if (L.buff) { g.strokeStyle = L.buff; g.lineWidth = .4; g.beginPath(); g.moveTo(-1.3, -1.6); g.lineTo(1.4, 1.6); g.stroke(); }
  T(g, '#6b4d31', .55, 0, 3.4, 6.2, 4.2);
  tete(g, L, L.tete === 'bicorne' ? 'shako' : L.tete);
}
function drapeau(g, L, x, y, t, r, petit) {
  const n = 8, long = petit ? 6.5 : 11, larg = petit ? 4 : 7, wa = -.4 + Math.sin(t * .5 + r) * .1;
  const ca = Math.cos(wa), sa = Math.sin(wa), nx = -sa, ny = ca;
  const bord = (s, o) => { const w = Math.sin(t * 6 - s * 5 + r * 9) * 1.1 * s; return [x + ca * long * s + nx * (o + w), y + sa * long * s + ny * (o + w)]; };
  const bande = (s0, s1, o0, o1, c) => {
    g.fillStyle = c; g.beginPath();
    for (let i = 0; i <= n; i++) { const p = bord(s0 + (s1 - s0) * i / n, o0); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }
    for (let i = n; i >= 0; i--) { const p = bord(s0 + (s1 - s0) * i / n, o1); g.lineTo(p[0], p[1]); }
    g.closePath(); g.fill();
  };
  g.save(); g.translate(1.8, 2.4); bande(0, 1, -larg / 2, larg / 2, 'rgba(20,20,10,.22)'); g.restore();
  if (L.drap === 'tri') { bande(0, 1 / 3, -larg / 2, larg / 2, '#2b4ea0'); bande(1 / 3, 2 / 3, -larg / 2, larg / 2, '#f4f1ea'); bande(2 / 3, 1, -larg / 2, larg / 2, '#c8322b'); }
  else { bande(0, 1, -larg / 2, larg / 2, '#f4f1ea'); bande(0, 1, -.7, .7, '#c8322b'); bande(.42, .58, -larg / 2, larg / 2, '#c8322b'); }
  C(g, '#3b2a1a', x, y, .55); C(g, '#d9b44a', x, y, .35);
}

const SPR = {};
function sprite(nom, rgb) {
  const c = toile(64, 64), g = c?.getContext?.('2d'); if (!g) return;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(.55, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); SPR[nom] = c;
}
sprite('f', '244,242,234'); sprite('p', '214,196,152'); sprite('t', '120,94,60'); sprite('n', '62,58,54'); sprite('lueur', '255,150,50'); sprite('trou', '255,255,255');
if (toile(1, 1)?.getContext?.('2d')) {
  const c = toile(64, 64); const g = c.getContext('2d'), gr = g.createRadialGradient(32, 38, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,248,200,1)'); gr.addColorStop(.3, 'rgba(255,190,70,.95)'); gr.addColorStop(.65, 'rgba(235,90,20,.55)'); gr.addColorStop(1, 'rgba(180,30,10,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); SPR.fl = c;
}
function fumee(sc, x, y, vx, vy, r0, r1, life, al = .55, spr = 'f') { if (sc.fx.length < sc.max) sc.fx.push({ k: 'f', spr, x, y, vx, vy, r0, r1, life, age: 0, al }); }
function eclair(sc, x, y, a, s) { sc.fx.push({ k: 'e', x, y, a, s, life: .09, age: 0 }); }
function etincelle(sc, x, y) { sc.fx.push({ k: 's', x, y, life: .14, age: 0, a: Math.random() * TAU }); }
function terre(sc, x, y, n, v = 40) {
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = Math.random() * v; sc.fx.push({ k: 't', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0, vz: 15 + Math.random() * 30, life: 1.1, age: 0, c: Math.random() < .5 ? '#5b412b' : '#86683f', sz: .5 + Math.random() * 1 }); }
}
function copeaux(sc, x, y) { for (let i = 0; i < 3; i++) { const a = Math.random() * TAU; sc.fx.push({ k: 't', x, y, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14, z: 1, vz: 12 + Math.random() * 10, life: .8, age: 0, c: Math.random() < .5 ? '#d8c08a' : '#3f6a33', sz: .5 }); } }
function boulet(sc, x0, y0, x1, y1, h, cb) { sc.fx.push({ k: 'b', x0, y0, x1, y1, h, age: 0, life: Math.hypot(x1 - x0, y1 - y0) / 230 + .15, cb }); }
function ajouterCorps(sc, u, x, y) {
  if (sc.corps.length > sc.maxCorps) sc.corps.shift();
  sc.corps.push({ x: x + (Math.random() - .5) * 4, y: y + (Math.random() - .5) * 4, a: Math.random() * TAU, look: u.look, habit: u.look.habits ? u.look.habits[Math.random() * u.look.habits.length | 0] : null, age: 0 });
  if (sc.pertes) sc.pertes[u.side] += 1;
}
function figAuHasard(u) { const hs = u.figs.filter(f => f.role === 'h' || f.role === 'cav' || f.role === 'servant'); return poseFig(u, hs[Math.random() * hs.length | 0]); }
function cibleDe(u) { return Array.isArray(u.cible) ? u.cible[Math.random() * u.cible.length | 0] : u.cible; }
function impact(sc, x, y, cible, rebond, dx, dy) {
  if (sc.surImpact) sc.surImpact(x, y);
  terre(sc, x, y, 16, 46); fumee(sc, x, y, 0, 0, 2, 9, 2.4, .5, 't'); fumee(sc, x + 2, y - 1, 0, 0, 1.5, 7, 2, .4, 'p');
  if (sc.terr) cratere(sc.terr.g, x, y, 2.2 + Math.random() * 1.3); else sc.decals.push({ x, y, r: 2.2 + Math.random(), age: 0 });
  if (cible && Math.random() < .55) { const n = 1 + (Math.random() < .4); for (let i = 0; i < n; i++) { const p = figAuHasard(cible); if (Math.hypot(p.x - x, p.y - y) < 40) ajouterCorps(sc, cible, p.x, p.y); } }
  if (rebond && Math.random() < .6) boulet(sc, x, y, x + dx * 28, y + dy * 28, 5, () => { terre(sc, x + dx * 28, y + dy * 28, 6, 25); fumee(sc, x + dx * 28, y + dy * 28, 0, 0, 1.5, 5, 1.6, .4, 'p'); });
}
function tirs(sc, u, dt) {
  const t = u.t;
  if (u.type === 'artillerie') {
    for (const f of u.figs) {
      if (f.role !== 'piece') continue;
      const k = Math.floor((t + u.ph + f.i * 1.37) / u.P);
      if (f.k != null && k !== f.k) {
        const p = poseFig(u, f), ca = Math.cos(p.a), sa = Math.sin(p.a), mx = p.x + ca * 7, my = p.y + sa * 7;
        eclair(sc, mx, my, p.a, 3.4);
        for (let i = 0; i < 7; i++) fumee(sc, mx + ca * i * 2, my + sa * i * 2, ca * (14 + Math.random() * 18) + (Math.random() - .5) * 8, sa * (14 + Math.random() * 18) + (Math.random() - .5) * 8, 3, 13 + Math.random() * 9, 6 + Math.random() * 3, .6);
        fumee(sc, p.x, p.y, 0, 0, 3, 10, 2, .35, 'p');
        const v = u.viser && u.viser(), cible = v ? null : cibleDe(u);
        let tx, ty;
        if (v) { tx = v.x + (Math.random() - .5) * 9; ty = v.y + (Math.random() - .5) * 9; }
        else if (cible) { const q = figAuHasard(cible); tx = q.x + (Math.random() - .5) * 26; ty = q.y + (Math.random() - .5) * 26; }
        else { const d = u.portee || 75; tx = p.x + ca * d + (Math.random() - .5) * 18; ty = p.y + sa * d + (Math.random() - .5) * 18; }
        const dd = Math.hypot(tx - mx, ty - my);
        boulet(sc, mx, my, tx, ty, 10 + dd * .08, () => { impact(sc, tx, ty, cible, !v, (tx - mx) / dd, (ty - my) / dd); if (v) v.touche(tx, ty); });
      }
      f.k = k;
    }
    return;
  }
  if (u.type === 'mitrailleuses') {
    for (const f of u.figs) {
      if (f.role !== 'piece') continue;
      const c = mod(t + u.ph + f.i * 1.37, u.P);
      if (c < 1.8 && t - (f.last || -9) > .11) {
        f.last = t; const p = poseFig(u, f), ca = Math.cos(p.a), sa = Math.sin(p.a), mx = p.x + ca * 5, my = p.y + sa * 5;
        eclair(sc, mx, my, p.a, 1.7);
        if (Math.random() < .5) fumee(sc, mx, my, ca * 12, sa * 12, 1.5, 6, 3, .4);
        if (!u.cible && Math.random() < .7) { const d = u.portee || 75; terre(sc, p.x + ca * d + (Math.random() - .5) * 24, p.y + sa * d + (Math.random() - .5) * 30, 3, 14); }
      }
    }
    return;
  }
  for (const f of u.figs) {
    if (f.role !== 'h' || f.pique || (u.form !== 'tirailleurs' && f.rang >= (u.form === 'carre' ? 1 : 2))) continue;
    const k = Math.floor((t + u.ph + f.dl + (f.off || 0) - 1.3) / u.P);
    if (f.k != null && k !== f.k) {
      const p = poseFig(u, f), ca = Math.cos(p.a), sa = Math.sin(p.a), mx = p.x + ca * 7.6 - sa * .55, my = p.y + sa * 7.6 + ca * .55;
      eclair(sc, mx, my, p.a, 1.35);
      fumee(sc, mx, my, ca * 11, sa * 11, 2, 8 + f.r * 5, 5 + f.r * 3, .5);
      if (Math.random() < .4) fumee(sc, mx + ca * 4, my + sa * 4, ca * 8, sa * 8, 2, 7, 4.5, .4);
      const cible = cibleDe(u);
      if (cible && Math.random() < .045) { const q = figAuHasard(cible); ajouterCorps(sc, cible, q.x, q.y); }
    }
    f.k = k;
  }
}
function majUnite(sc, u, dt) {
  if (u.script) u.script(u, sc.time);
  if (u.state !== u.etat0) { u.etat0 = u.state; u.tEtat = 0; }
  u.t += dt; u.tEtat += dt;
  const cav = u.type === 'cavalerie' || u.type === 'general';
  const freq = { marche: cav ? 2 : 1.7, charge: cav ? 2.9 : 2.6, deroute: cav ? 2.9 : 2.8 }[u.state] || 1.6;
  u.pas += dt * freq;
  if (u.libre) {
    const v = { marche: cav ? 13 : u.type === 'chariot' || u.type === 'artillerie' || u.type === 'mitrailleuses' ? 10 : 8, charge: cav ? 34 : 18, deroute: cav ? 24 : 14 }[u.state] || 0;
    const dir = u.state === 'deroute' ? u.a + Math.PI : u.a;
    u.x += Math.cos(dir) * v * dt; u.y += Math.sin(dir) * v * dt;
    if (u.state === 'deroute') u.spread = Math.min(1, u.tEtat / 3);
  }
  if (u.state === 'feu') tirs(sc, u, dt);
  if (u.state === 'melee' && Math.random() < dt * 9) {
    const hs = u.figs.filter(f => f.role === 'h' || f.role === 'cav'), f = hs[Math.random() * hs.length | 0], p = poseFig(u, f);
    etincelle(sc, p.x + Math.cos(p.a) * 8, p.y + Math.sin(p.a) * 8);
    if (Math.random() < .5) fumee(sc, p.x, p.y, 0, 0, 2, 7, 1.6, .35, 'p');
    if (Math.random() < .05) ajouterCorps(sc, u, p.x, p.y);
  }
  if ((u.state === 'charge' || (u.state === 'marche' && (cav || u.type === 'chariot' || u.form === 'attelee'))) && Math.random() < dt * (u.state === 'charge' ? 14 : 5)) {
    const hs = u.figs.filter(f => CHEVAL.has(f.role) || f.role === 'h' || f.role === 'caisson'), p = poseFig(u, hs[Math.random() * hs.length | 0]);
    const dir = u.a + (u.state === 'deroute' ? 0 : Math.PI);
    fumee(sc, p.x + Math.cos(dir) * 6, p.y + Math.sin(dir) * 6, Math.cos(dir) * 4, Math.sin(dir) * 4, 2, cav && u.state === 'charge' ? 11 : 7, 2.6, .42, 'p');
  }
  if (u.state === 'travail') for (const f of u.figs) {
    const k = Math.floor(u.t * 1.1 + f.r * 3 - .55);   // le coup porte au bout de l'élan
    if (f.k != null && k !== f.k) { const p = poseFig(u, f); copeaux(sc, p.x + Math.cos(p.a) * 6, p.y + Math.sin(p.a) * 6); }
    f.k = k;
  }
}

class Scene {
  constructor(cv, o) {
    this.cv = cv; this.g = cv.getContext('2d');
    Object.assign(this, { fx: [], corps: [], decals: [], units: [], z: 2, cx: 0, cy: 0, time: 0, max: 400, maxCorps: 40, vent: [3.2, -1.6], visible: true }, o);
    this.resize();
  }
  resize() {
    const r = this.cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    this.d = d; this.cssW = Math.max(1, r.width); this.cssH = Math.max(1, r.height);
    this.cv.width = Math.round(this.cssW * d); this.cv.height = Math.round(this.cssH * d);
    this.W = this.cv.width; this.H = this.cv.height;
    if (this.surResize) this.surResize(this);
  }
  get m() { return this.z * this.d; }
  monde(g) { const m = this.m; g.setTransform(m, 0, 0, m, -this.cx * m + this.W / 2, -this.cy * m + this.H / 2); }
  fig(g, x, y, a) { const m = this.m, c = Math.cos(a) * m, s = Math.sin(a) * m; g.setTransform(c, s, -s, c, (x - this.cx) * m + this.W / 2, (y - this.cy) * m + this.H / 2); }
  step(dt) {
    this.time += dt;
    if (this.avant) this.avant(this, dt);
    for (const u of this.units) majUnite(this, u, dt);
    const [wx, wy] = this.vent, amort = Math.exp(-dt * 1.6);
    for (const f of this.fx) {
      f.age += dt;
      if (f.k === 'f' || f.k === 'm') { f.x += (f.vx + wx) * dt; f.y += (f.vy + wy) * dt; f.vx *= amort; f.vy *= amort; }
      else if (f.k === 't') { f.x += f.vx * dt; f.y += f.vy * dt; f.vz -= 70 * dt; f.z += f.vz * dt; if (f.z < 0) { f.z = 0; f.vx *= .2; f.vy *= .2; f.vz = 0; } }
      else if (f.k === 'b' && f.age >= f.life && f.cb) { const cb = f.cb; f.cb = null; cb(); }
    }
    this.fx = this.fx.filter(f => f.age < f.life);
    for (const b of this.corps) b.age += dt;
    for (const d of this.decals) d.age += dt;
    this.corps = this.corps.filter(b => b.age < 70); this.decals = this.decals.filter(d => d.age < 30);
  }
  draw() {
    const g = this.g, m = this.m, hw = this.W / 2 / m + 24, hh = this.H / 2 / m + 24;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true;
    this.sol(this, g);
    this.monde(g);
    for (const d of this.decals) { g.globalAlpha = Math.min(1, (30 - d.age) / 4); cratere(g, d.x, d.y, d.r, alea(d.x * 99 | 0)); }
    g.globalAlpha = 1; g.lineCap = 'round';
    for (const b of this.corps) { g.globalAlpha = Math.min(1, (70 - b.age) / 6); this.fig(g, b.x, b.y, b.a); corps(g, b.look, b); }
    g.globalAlpha = 1;
    if (this.sous) this.sous(this, g);
    // toutes les ombres d'abord, d'un seul tracé, puis les figures
    const poses = [];
    this.monde(g); g.globalAlpha = 1; g.fillStyle = 'rgba(30,26,10,.28)'; g.beginPath();
    for (const u of this.units) {
      const pu = []; poses.push(pu);
      for (const f of u.figs) {
        const p = poseFig(u, f); pu.push(p);
        p.vis = Math.abs(p.x - this.cx) < hw && Math.abs(p.y - this.cy) < hh;
        if (!p.vis || u.alpha < .05) continue;
        const big = CHEVAL.has(f.role) ? [6, 2.5] : f.role === 'caisson' ? [9.5, 4.4] : f.role === 'piece' ? [7, 3.4] : f.role === 'avant' ? [4, 3.6] : [2.4, 2.3];
        g.moveTo(p.x + 1.3 + big[0], p.y + 1.7); g.ellipse(p.x + 1.3, p.y + 1.7, big[0], big[1], p.a, 0, TAU);
      }
    }
    g.fill();
    this.units.forEach((u, i) => {
      g.globalAlpha = u.alpha;
      u.figs.forEach((f, j) => {
        const p = poses[i][j]; if (!p.vis) return;
        this.fig(g, p.x, p.y, p.a); g.lineCap = 'round';
        switch (f.role) {
          case 'cav': cheval(g, f.gen ? u.look.chevaux[0] : u.look.chevaux[(f.r * (u.look.chevaux.length - (u.type === 'general' ? 1 : 0)) | 0) + (u.type === 'general' ? 1 : 0)], p); cavalier(g, u.look, f, p); break;
          case 'cheval': cheval(g, u.look.chevaux[f.r * u.look.chevaux.length | 0], p); if (p.monte) cavalier(g, u.look, f, p, true); break;
          case 'piece': piece(g, u.look, p); break;
          case 'avant': avant(g, u.look); break;
          case 'caisson': caisson(g, u.look); break;
          default: fantassin(g, u.look, f, p);
        }
      });
    });
    g.globalAlpha = 1;
    if (this.dessus) this.dessus(this, g);
    this.monde(g);
    this.units.forEach((u, i) => {
      g.globalAlpha = u.alpha;
      u.figs.forEach((f, j) => { if ((f.role === 'drapeau' || f.fanion) && poses[i][j].vis) drapeau(g, u.look, poses[i][j].x, poses[i][j].y, u.t, f.r, !!f.fanion); });
    });
    g.globalAlpha = 1;
    for (const f of this.fx) {
      const p = f.age / f.life;
      if (f.k === 'f') {
        const r = lerp(f.r0, f.r1, 1 - (1 - p) ** 2), a = f.al * (p < .08 ? p / .08 : (1 - p) ** 1.3);
        g.globalAlpha = a; g.drawImage(SPR[f.spr], f.x - r, f.y - r, r * 2, r * 2);
      } else if (f.k === 'e') {
        const ca = Math.cos(f.a), sa = Math.sin(f.a), s = f.s;
        g.globalAlpha = .55; C(g, '#ffc864', f.x, f.y, s * 1.3);
        g.globalAlpha = 1; PG(g, '#fff6d2', [f.x + ca * s * 2.4, f.y + sa * s * 2.4, f.x - sa * s * .55, f.y + ca * s * .55, f.x + sa * s * .55, f.y - ca * s * .55]);
      } else if (f.k === 's') {
        g.globalAlpha = 1 - p; g.strokeStyle = '#fffbe8'; g.lineWidth = .35;
        g.beginPath(); for (let i = 0; i < 4; i++) { const a = f.a + i * TAU / 4; g.moveTo(f.x, f.y); g.lineTo(f.x + Math.cos(a) * 1.8, f.y + Math.sin(a) * 1.8); } g.stroke();
      } else if (f.k === 'm') { g.globalAlpha = (1 - p) * (.55 + .45 * Math.sin(f.age * 31 + f.x)); C(g, '#ffb347', f.x, f.y, .5); }
      else if (f.k === 't') { g.globalAlpha = Math.min(1, (1 - p) * 3); C(g, f.c, f.x, f.y - f.z * .4, f.sz); }
      else if (f.k === 'b') {
        const x = lerp(f.x0, f.x1, p), y = lerp(f.y0, f.y1, p), z = 4 * f.h * p * (1 - p);
        g.globalAlpha = .3; C(g, '#000000', x, y, 1.1); g.globalAlpha = 1; C(g, '#1d1d1d', x, y - z, 1.35);
      }
    }
    g.globalAlpha = 1;
    if (this.apres) this.apres(this, g);
  }
}

const DPR = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2), KT = DPR >= 2 ? 3 : 2.2;
function brancher(sc, Wd, Hd, pre, visites, debut) {
  const cv = sc.cv;
  sc.zB = () => [Math.max(sc.cssW / Wd, sc.cssH / Hd), sc.zMax || 4.5];
  sc.borner = () => {
    const [a, b] = sc.zB(); sc.z = clamp(sc.z, a, b);
    const hw = sc.cssW / 2 / sc.z, hh = sc.cssH / 2 / sc.z;
    sc.cx = clamp(sc.cx, hw, Wd - hw); sc.cy = clamp(sc.cy, hh, Hd - hh);
  };
  const boutons = [];
  sc.marquer = b => boutons.forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  const pts = new Map(); let pince = null, tap = null;
  const ecart = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    sc.suivi = null; sc.vol = null; sc.marquer(null);
    tap = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (pts.size === 2) pince = { d: ecart(), z: sc.z };
  });
  cv.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 1) { sc.cx -= (e.clientX - p.x) / sc.z; sc.cy -= (e.clientY - p.y) / sc.z; }
    p.x = e.clientX; p.y = e.clientY;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap = null;
    if (pts.size === 2 && pince) sc.z = pince.z * ecart() / pince.d;
    sc.borner();
  });
  const fin = e => {
    if (e.type === 'pointerup' && tap && sc.tap && performance.now() - tap.t < 500) {
      const r = cv.getBoundingClientRect();
      sc.tap(sc.cx + (e.clientX - r.left - sc.cssW / 2) / sc.z, sc.cy + (e.clientY - r.top - sc.cssH / 2) / sc.z);
    }
    tap = null; pts.delete(e.pointerId); pince = null;
  };
  cv.addEventListener('pointerup', fin); cv.addEventListener('pointercancel', fin);
  cv.addEventListener('wheel', e => { e.preventDefault(); sc.z *= Math.exp(-e.deltaY * .0015); sc.borner(); }, { passive: false });
  const voler = (x, y, z, puis) => { sc.vol = { x0: sc.cx, y0: sc.cy, z0: sc.z, x1: x, y1: y, z1: z, k: 0, puis }; };
  document.getElementById(pre + '-zplus').onclick = () => voler(sc.cx, sc.cy, sc.z * 1.4);
  document.getElementById(pre + '-zmoins').onclick = () => voler(sc.cx, sc.cy, sc.z / 1.4);
  document.getElementById(pre + '-zall').onclick = () => { sc.suivi = null; sc.marquer(null); voler(Wd / 2, Hd / 2, sc.zB()[0]); };
  const zone = document.getElementById(pre + '-visites');
  for (const [nom, x, y, z] of visites) {
    const b = document.createElement('button'); b.className = 'puce'; b.textContent = nom; b.setAttribute('aria-pressed', 'false');
    b.onclick = () => {
      sc.marquer(b); sc.suivi = null;
      const cible = typeof x === 'function' ? x() : null;   // une chose qui bouge : la caméra la suit
      if (typeof x !== 'function') voler(x, y, z); else if (cible) voler(cible.x, cible.y, z, cible);
    };
    b.lieu = x; boutons.push(b); zone.appendChild(b);
  }
  sc.majVisites = () => boutons.forEach(b => { b.hidden = typeof b.lieu === 'function' && !b.lieu(); });
  sc.surResize = s => { if (!s.pret) { s.pret = true; debut(s); } s.borner(); };
  sc.resize();
}
function camAnim(sc) {
  if (sc.suivi) { sc.cx = lerp(sc.cx, sc.suivi.x, .08); sc.cy = lerp(sc.cy, sc.suivi.y, .08); sc.borner(); }
  if (sc.vol) {
    const v = sc.vol; v.k = Math.min(1, v.k + 1 / 50); const e = ease(v.k);
    sc.cx = lerp(v.x0, v.x1, e); sc.cy = lerp(v.y0, v.y1, e); sc.z = lerp(v.z0, v.z1, e); sc.borner();
    if (v.k >= 1) { sc.vol = null; if (v.puis) sc.suivi = v.puis; }
  }
}
function surPoly(pts, x) { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return lerp(y0, y1, (x - x0) / (x1 - x0)); } return pts[pts.length - 1][1]; }
function distPoly(pts, x, y) {
  let d = 1e9;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, k = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    d = Math.min(d, Math.hypot(x - ax - k * dx, y - ay - k * dy));
  }
  return d;
}
function longueur(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
function surChemin(pts, s) {
  if (pts.length < 2) return { x: pts[0][0], y: pts[0][1], a: 0 };   // un seul point (armée arrêtée hors route)
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0);
    if (s <= l || i === pts.length - 1) { const k = clamp(s / l, 0, 1); return { x: lerp(x0, x1, k), y: lerp(y0, y1, k), a: Math.atan2(y1 - y0, x1 - x0) }; }
    s -= l;
  }
}
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * clamp(k, 0, 1);
const TOITS = { tuile: ['#c45a43', '#9e4334', '#7d3429'], ardoise: ['#8193a6', '#66778a', '#4d5b6b'], chaume: ['#c2a663', '#a08848', '#7e6a36'] };
function ruisseau(g, pts) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  ligne(g, pts); g.strokeStyle = '#4b7438'; g.lineWidth = 17; g.stroke();
  g.strokeStyle = '#355f97'; g.lineWidth = 9; g.stroke(); g.strokeStyle = '#4a78b4'; g.lineWidth = 6; g.stroke();
  g.setLineDash([1.6, 8, .8, 6]); g.strokeStyle = 'rgba(160,195,235,.45)'; g.lineWidth = .7; g.stroke(); g.setLineDash([]);
}
function potager(g, x, y, w, h, R, clos = true) {
  RR(g, '#6e4c33', x, y, w, h, 1);
  for (let yy = y + 2.5; yy < y + h - 1; yy += 3) for (let xx = x + 2; xx < x + w - 1; xx += 2.4) C(g, R() < .5 ? '#4f9a45' : '#6db35a', xx + (R() - .5) * .4, yy, .75);
  if (clos) cloture(g, x - 1.5, y - 1.5, w + 3, h + 3);
}
function epouvantail(g, x, y) {
  E(g, OMBRE, x + 1.5, y + 2, 4, 1.6); T(g, '#6b4d31', .7, x - 4.5, y, x + 4.5, y);
  RR(g, '#7a4a3a', x - 1.4, y - 1.6, 2.8, 3.2, .8); T(g, '#d9c27a', .4, x - 4.5, y, x - 5.6, y + .6); T(g, '#d9c27a', .4, x + 4.5, y, x + 5.6, y - .5);
  C(g, '#4a3a28', x, y, 1.7); C(g, '#3a2b1c', x, y, 1);
}
function charrue(g, x, y, a) {
  g.save(); g.translate(x, y); g.rotate(a);
  E(g, OMBRE, 1, 1.5, 6, 1.6); T(g, '#6b4d31', .6, -6, -.9, 2, -.3); T(g, '#6b4d31', .6, -6, .9, 2, .3); RR(g, '#8d9196', 2, -1, 2.6, 2, .4);
  g.restore();
}
function ruche(g, x, y) { E(g, OMBRE, x + .8, y + 1.1, 2, 1.8); C(g, '#d1b46a', x, y, 2); g.strokeStyle = '#a88f45'; g.lineWidth = .35; for (const r of [1.4, .8]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); } }
function tasBois(g, x, y) { RR(g, OMBRE, x - 3, y - .6, 8, 3.4, .4); RR(g, '#7a5634', x - 4, y - 1.6, 8, 3.2, .4); for (let i = 0; i < 4; i++) C(g, '#c9a878', x + 4, y - 1.1 + i * .75, .38); }
function linge(g, x, y) { T(g, '#dcd6c8', .25, x, y, x + 13, y + 1); ['#f2efe6', '#6b8fb5', '#c45a43', '#f2efe6'].forEach((c, i) => RR(g, c, x + 1 + i * 3, y + .1 + i * .07, 2.2, 2.4, .2)); }
function abreuvoir(g, x, y) { RR(g, OMBRE, x - 3, y - .5, 8, 3, .5); RR(g, '#8f856e', x - 4, y - 1.5, 8, 3, .5); RR(g, '#4a78b4', x - 3.4, y - 1, 6.8, 2, .4); }
function souche(g, x, y, r = 1.6) { C(g, OMBRE, x + .6, y + .8, r); C(g, '#7a5634', x, y, r); C(g, '#c9a878', x, y, r * .7); g.strokeStyle = '#a3845a'; g.lineWidth = .2; g.beginPath(); g.arc(x, y, r * .4, 0, TAU); g.stroke(); }
function tronc(g, x1, y1, x2, y2) { g.lineCap = 'round'; T(g, OMBRE, 2.4, x1 + 1, y1 + 1.4, x2 + 1, y2 + 1.4); T(g, '#5b4127', 2.2, x1, y1, x2, y2); T(g, '#7a5634', 1, x1, y1 - .4, x2, y2 - .4); C(g, '#c9a878', x2, y2, 1); }
function stere(g, x, y) { RR(g, OMBRE, x - 4, y - 2, 11, 6, .5); RR(g, '#5b4127', x - 5, y - 3, 10, 6, .5); for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) C(g, '#c9a878', x - 3.6 + i * 2.4, y - 1.4 + j * 2.8, .95); }
function charbonniere(g, x, y) { C(g, '#4d3f33', x, y, 10); C(g, '#3a2f28', x, y, 8); C(g, '#2a221d', x - 1, y - 1, 4); for (let i = 0; i < 8; i++) C(g, '#6b5a44', x + Math.cos(i) * 9.5, y + Math.sin(i) * 9.5, .7); }
function sapin(g, x, y, r, c) {
  const etoile = (ox, oy, rr, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16, q = i % 2 ? rr * .55 : rr; g.lineTo(ox + Math.cos(a) * q, oy + Math.sin(a) * q); } g.closePath(); g.fill(); };
  etoile(x + 1.8, y + 2.4, r, OMBRE); etoile(x, y, r, c); etoile(x - r * .12, y - r * .12, r * .6, clair(c, .15)); C(g, sombre(c, .2), x, y, r * .15);
}
function dessinMaison(g, m, t) {
  const { w, h } = m, c = TOITS[m.toit], ca = Math.cos(m.a), sa = Math.sin(m.a), ox = 2.4 * ca + 3 * sa, oy = -2.4 * sa + 3 * ca, hw = w / 2, hh = h / 2;
  if (m.etat < 3) {
    RR(g, 'rgba(20,20,10,.38)', -hw + ox, -hh + oy, w, h, 1);
    if (m.type === 'tour') {
      PG(g, c[0], [-hw, -hh, hw, -hh, 0, 0]); PG(g, clair(c[0], .1), [-hw, -hh, -hw, hh, 0, 0]); PG(g, c[1], [hw, -hh, hw, hh, 0, 0]); PG(g, sombre(c[1], .15), [-hw, hh, hw, hh, 0, 0]);
      C(g, '#e3c04f', 0, 0, .8);
    } else {
      RR(g, c[0], -hw, -hh, w, hh, 1); RR(g, c[1], -hw, 0, w, hh, 1);
      g.globalAlpha = .35; g.strokeStyle = c[2]; g.lineWidth = m.toit === 'chaume' ? .25 : .2; g.beginPath();
      for (let y = -hh + 1.4; y < hh - .5; y += m.toit === 'chaume' ? .9 : 1.5) { g.moveTo(-hw + .6, y); g.lineTo(hw - .6, y); }
      g.stroke(); g.globalAlpha = 1;
      T(g, c[2], .9, -hw, 0, hw, 0);
      if (m.type === 'eglise') { T(g, '#3a3530', .5, hw - 3, -1.6, hw - 3, 1.6); T(g, '#3a3530', .5, hw - 4.2, 0, hw - 1.8, 0); }
      else { RR(g, '#8a5a44', hw * .45 - 1.2, -hh * .5 - 1.2, 2.4, 2.4, .3); C(g, '#3a2a22', hw * .45, -hh * .5, .6); }
    }
    for (const tr of m.trous) {
      g.fillStyle = '#2a1f18'; g.beginPath(); tr.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
      for (const d of [-1.1, 0, 1.1]) T(g, '#6b4d31', .35, tr.x + d, tr.y - tr.r * .9, tr.x + d, tr.y + tr.r * .9);
      for (let i = 0; i < 5; i++) { const a = i * 1.3 + tr.r, d = tr.r * 1.25; RR(g, clair(c[0], .12), tr.x + Math.cos(a) * d - .4, tr.y + Math.sin(a) * d - .3, .8, .6, .1); }
    }
    if (m.feu) { g.globalAlpha = Math.min(.6, m.tFeu / 14); RR(g, '#1c0f08', -hw, -hh, w, h, 1); g.globalAlpha = 1; }
  } else {
    RR(g, '#2c2622', -hw, -hh, w, h, .5);
    g.globalAlpha = .6; E(g, '#58524c', -hw * .3, hh * .2, hw * .45, hh * .4); E(g, '#4a443e', hw * .4, -hh * .3, hw * .3, hh * .3); g.globalAlpha = 1;
    for (const p of m.poutres) T(g, '#16110d', .8, -hw * .8 + p, -hh * .7, hw * .7 - p, hh * .6);
    g.setLineDash([2 + m.r * 5, 1.6, 3, 1.2]); g.strokeStyle = '#b9ad95'; g.lineWidth = 1.5; g.strokeRect(-hw, -hh, w, h);
    g.setLineDash([]); g.strokeStyle = 'rgba(40,30,22,.7)'; g.lineWidth = .5; g.strokeRect(-hw + 1, -hh + 1, w - 2, h - 2);
    if (m.braise > 0) for (let i = 0; i < 6; i++) { g.globalAlpha = m.braise * (.5 + .5 * Math.sin(t * 4 + i * 2)); C(g, '#ff8a2a', m.foyers[i].x * .8, m.foyers[i].y * .8, .55); }
    g.globalAlpha = 1;
  }
}
function flammes(g, m, t) {
  const I = m.intensite; if (I <= 0) return;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = .55 * I; g.drawImage(SPR.lueur, -m.w * 1.2, -m.w * 1.2, m.w * 2.4, m.w * 2.4);
  g.globalAlpha = .9;
  for (const f of m.foyers) { const r = (3.6 + 1.8 * Math.sin(t * 11 + f.s) + .8 * Math.sin(t * 23 + f.s * 2)) * I * f.k; if (r > .2) g.drawImage(SPR.fl, f.x - r, f.y - r * 1.25, r * 2, r * 2.5); }
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}
const PAL = {
  tuile: ['#bf5a40', '#8f3f2e', '#6e3024'], canal: ['#dc9066', '#b56a46', '#94533a'], ardoise: ['#8696a8', '#5a697b', '#46525f'],
  zinc: ['#b5bec2', '#8d979c', '#6d767b'], plomb: ['#9aa3a5', '#6f777a', '#555c5f'], chaume: ['#c8ab66', '#9c8446', '#7a6634'],
};
const SOLEIL = [-.6, -.8], OMB = [1.5, 2];
function teinte(P, nx, ny) { const t = Math.round(clamp(.5 + .7 * (nx * SOLEIL[0] + ny * SOLEIL[1]), 0, 1) * 20) / 20; return mix(P[1], P[0], t); }
const teinteL = (P, nx, ny, a) => teinte(P, nx * Math.cos(a) - ny * Math.sin(a), nx * Math.sin(a) + ny * Math.cos(a));
function pignon(g, x, y, w, h, P, a, hip, canal) {
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
  if (canal) { g.strokeStyle = 'rgba(245,230,205,.6)'; g.lineWidth = .35; g.strokeRect(x + .2, y + .2, w - .4, h - .4); }   // la génoise
}
function pyramideF(g, x, y, w, h, P, a) {
  const cx = x + w / 2, cy = y + h / 2;
  PG(g, teinteL(P, 0, -1, a), [x, y, x + w, y, cx, cy]); PG(g, teinteL(P, 1, 0, a), [x + w, y, x + w, y + h, cx, cy]);
  PG(g, teinteL(P, 0, 1, a), [x + w, y + h, x, y + h, cx, cy]); PG(g, teinteL(P, -1, 0, a), [x, y + h, x, y, cx, cy]);
  g.strokeStyle = P[2]; g.lineWidth = .35; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.stroke();
  C(g, '#d9b44a', cx, cy, .55);
}
function coneF(g, x, y, r, P, a, a0 = 0, a1 = TAU, n = 16) {
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
function mansardeF(g, x, y, w, h, a) {
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
      const P = PAL[p.p || (p.t === 'k' ? 'canal' : 'tuile')], ax = p.ax || (p.w >= p.h ? 'x' : 'y');
      if (ax === 'x') pignon(g, p.x, p.y, p.w, p.h, P, a, p.hip, p.t === 'k');
      else { g.save(); g.translate(p.x + p.w / 2, p.y + p.h / 2); g.rotate(Math.PI / 2); pignon(g, -p.h / 2, -p.w / 2, p.h, p.w, P, a + Math.PI / 2, p.hip, p.t === 'k'); g.restore(); }
      break;
    }
    case 's': { const P = PAL[p.p || 'tuile']; g.fillStyle = teinteL(P, p.n[0], p.n[1], a); g.fillRect(p.x, p.y, p.w, p.h); g.strokeStyle = P[2]; g.lineWidth = .3; g.strokeRect(p.x, p.y, p.w, p.h); break; }
    case 'p': pyramideF(g, p.x, p.y, p.w, p.h, PAL[p.p || 'ardoise'], a); break;
    case 'c': coneF(g, p.x, p.y, p.r, PAL[p.p || 'ardoise'], a); C(g, '#d9b44a', p.x, p.y, .35); break;
    case 'abs': coneF(g, p.x, p.y, p.r, PAL[p.p || 'ardoise'], a, -Math.PI / 2, Math.PI / 2, 8); break;
    case 'd': domeF(g, p.x, p.y, p.r, PAL[p.p || 'plomb'], a); break;
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
function bat(g, parts, x, y, a = 0, s = 1) {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s); g.lineCap = 'round';
  const ca = Math.cos(a), sa = Math.sin(a);
  g.fillStyle = 'rgba(20,20,10,.32)'; g.beginPath();
  for (const p of parts) { if (p.sol || p.t === 'fn') continue; const h = p.h2 ?? 1; empreinte(g, p, (OMB[0] * ca + OMB[1] * sa) * h, (-OMB[0] * sa + OMB[1] * ca) * h); }
  g.fill();
  for (const p of parts) dessinPart(g, p, a);
  g.restore();
}
const croix = (x, y, s = 1) => ({ t: 'fn', fn: g => { T(g, '#3a3530', .45 * s, x, y - 1.8 * s, x, y + 1.8 * s); T(g, '#3a3530', .45 * s, x - 1.1 * s, y - .6 * s, x + 1.1 * s, y - .6 * s); } });
const cheminee = (x, y) => ({ t: 'f', x: x - .7, y: y - .7, w: 1.4, h: 1.4, c: '#7d4a3a', h2: 1.8 });
function parterre(x, y, w, h, R) {   // parterre de broderie : buis taillé en volutes sur gravier
  return { t: 'fn', fn: g => {
    RR(g, '#e3d8bb', x, y, w, h, .4); g.strokeStyle = '#3f6b35'; g.lineWidth = .7;
    g.strokeRect(x + .8, y + .8, w - 1.6, h - 1.6);
    for (let k = 0; k < 4; k++) { const cx = x + w * (k % 2 ? .72 : .28), cy = y + h * (k < 2 ? .3 : .7); g.beginPath(); g.ellipse(cx, cy, w * .16, h * .14, 0, 0, TAU); g.stroke(); g.beginPath(); g.arc(cx, cy, Math.min(w, h) * .05, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(x + w / 2, y + 1.5); g.bezierCurveTo(x + w * .3, y + h * .5, x + w * .7, y + h * .5, x + w / 2, y + h - 1.5); g.stroke();
    if (R) for (let i = 0; i < 6; i++) C(g, '#2f5a2c', x + 1 + (i % 3) * (w - 2) / 2, y + (i < 3 ? 1 : h - 1), .9);
  } };
}
const BATS = {
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
    const parts = [{ t: 'r', sol: 1, c: '#b9ae96', x: -32, y: 14, w: 64, h: 8 }, { t: 'fn', fn: g => { g.strokeStyle = 'rgba(80,70,55,.25)'; g.lineWidth = .2; for (let x = -32; x < 32; x += 1.4) T(g, 'rgba(80,70,55,.25)', .2, x, 14, x, 22); } }];
    let x = -30; const R = alea(3);
    for (let k = 0; k < 7; k++) {
      const w = 7 + R() * 2.5, d = 18 + R() * 5;
      parts.push({ t: 'g', x, y: 14 - d, w, h: d, ax: 'y', p: R() < .7 ? 'tuile' : 'ardoise', h2: 2.2 + R() * .6 });
      parts.push({ t: 'g', x: x + w / 2 - 1.5, y: 14 - d * .55, w: 3, h: 3, ax: 'y', p: 'tuile', h2: 2.4 }, cheminee(x + w * .5, 14 - d * .85));
      parts.push({ t: 'fn', fn: g => potager(g, x + .5, 14 - d - 12, w - 1, 10, R) });
      x += w + .2;
    }
    return parts;
  },
  hotel: () => [
    { t: 'r', sol: 1, c: '#b9ae96', x: -30, y: 26, w: 60, h: 8 },
    parterre(-26, -46, 24, 16, 1), parterre(2, -46, 24, 16, 1), { t: 'r', sol: 1, c: '#e3d8bb', x: -2, y: -46, w: 4, h: 34 },
    { t: 'fn', fn: g => { C(g, '#a89c86', 0, -28, 3.6); C(g, '#4a78b4', 0, -28, 2.7); for (let x = -26; x <= 26; x += 6) C(g, BOIS[2], x, -51, 2.4); } },
    { t: 'r', sol: 1, c: '#d2c8b0', x: -16, y: 3, w: 32, h: 21 },
    { t: 'f', x: -24, y: 24, w: 48, h: 2, c: '#c2b8a0', h2: 1.4 }, { t: 'g', x: -6, y: 20, w: 12, h: 7, hip: 1, p: 'ardoise', h2: 2 },
    { t: 'g', x: -24, y: 3, w: 8, h: 21, ax: 'y', p: 'ardoise', h2: 1.8 }, { t: 'g', x: 16, y: 3, w: 8, h: 21, ax: 'y', p: 'ardoise', h2: 1.8 },
    { t: 'g', x: -24, y: -9, w: 48, h: 12, hip: 1, p: 'ardoise', h2: 2.4 }, { t: 'g', x: -28, y: -11, w: 11, h: 15, hip: 1, p: 'ardoise', h2: 2.9 }, { t: 'g', x: 17, y: -11, w: 11, h: 15, hip: 1, p: 'ardoise', h2: 2.9 },
    cheminee(-10, -3), cheminee(10, -3),
  ],
  chateau: () => {
    const R = alea(8), parts = [
      { t: 'fn', fn: g => { RR(g, '#4a78b4', -50, -20, 100, 42, 2); RR(g, '#5a88c0', -48, -18, 96, 38, 2); } },   // douves
      { t: 'r', sol: 1, c: '#d2c8b0', x: -30, y: 6, w: 60, h: 30 }, { t: 'r', sol: 1, c: '#c9bfa7', x: -6, y: 18, w: 12, h: 26 },
      { t: 'fn', fn: g => { RR(g, '#4a78b4', -8, -98, 16, 50, 1); C(g, '#4a78b4', 0, -98, 10); } },   // le grand canal
      parterre(-46, -46, 40, 26, 1), parterre(6, -46, 40, 26, 1),
      { t: 'fn', fn: g => { const p = []; for (let y = -96; y < -54; y += 6) for (const x0 of [-70, 24]) for (let x = x0; x < x0 + 46; x += 6) p.push([x + (R() - .5) * 2, y + (R() - .5) * 2, 3.4 + R(), BOIS[R() * 5 | 0]]); touffes(g, p); for (let y = 46; y < 72; y += 6) { arbre(g, -12, y, 2.8, BOIS[2]); arbre(g, 12, y, 2.8, BOIS[2]); } } },
      { t: 'g', x: -40, y: 4, w: 12, h: 30, ax: 'y', p: 'ardoise', hip: 1, h2: 2.4 }, { t: 'g', x: 28, y: 4, w: 12, h: 30, ax: 'y', p: 'ardoise', hip: 1, h2: 2.4 },
      { t: 'g', x: -34, y: -10, w: 68, h: 15, hip: 1, p: 'ardoise', h2: 3 }, { t: 'g', x: -44, y: -14, w: 15, h: 20, hip: 1, p: 'ardoise', h2: 3.6 }, { t: 'g', x: 29, y: -14, w: 15, h: 20, hip: 1, p: 'ardoise', h2: 3.6 },
      { t: 'd', x: 0, y: -3, r: 9, p: 'ardoise', h2: 5.5 }, cheminee(-20, -2.5), cheminee(20, -2.5), cheminee(-36, -4), cheminee(36, -4),
      { t: 'fn', fn: g => { g.strokeStyle = '#2a2a2a'; g.lineWidth = .4; g.setLineDash([.6, .6]); T(g, '#2a2a2a', .4, -30, 36, 30, 36); g.setLineDash([]); } },
    ];
    return parts;
  },
  halle: () => [
    { t: 'r', sol: 1, c: '#d3c8ae', x: -36, y: -24, w: 72, h: 48 },
    { t: 'fn', fn: g => { const R = alea(6); for (let i = 0; i < 18; i++) { const x = -32 + (i % 9) * 8, y = i < 9 ? -20 : 17; RR(g, ['#c45a43', '#f2efe6', '#6b8fb5', '#e3c04f'][i % 4], x, y, 5, 3, .4); T(g, 'rgba(255,255,255,.6)', .3, x + 1, y, x + 1, y + 3); } for (let i = 0; i < 30; i++) C(g, ['#5d6b86', '#7a4a3a', '#f2efe6', '#6e5c45'][i % 4], -30 + R() * 60, (R() < .5 ? -15 : 13) + (R() - .5) * 4, .7); } },
    { t: 'g', x: -24, y: -13, w: 48, h: 26, p: 'tuile', hip: 1, h2: 1.8 },
    { t: 'fn', fn: g => { for (let x = -22; x <= 22; x += 6.3) { C(g, '#5b4127', x, -13.6, .5); C(g, '#5b4127', x, 13.6, .5); } } },
  ],
  moulinEau: () => [
    { t: 'fn', fn: g => { ruisseau(g, [[-60, 14], [-20, 10], [20, 12], [60, 8]]); g.lineWidth = 6; g.strokeStyle = '#4a78b4'; ligne(g, [[-60, -4], [-10, -6], [6, -6]]); g.stroke(); RR(g, '#857c6c', 5, -9, 2, 6, .3); } },
    { t: 'g', x: -6, y: -22, w: 22, h: 13, p: 'tuile', h2: 2.2 }, cheminee(10, -18),
    { t: 'fn', fn: g => { RR(g, '#5b4127', -4, -9, 7, 3.6, .4); for (let x = -3.4; x < 3; x += 1) T(g, '#3a2a1b', .3, x, -9, x, -5.4); } },
    { t: 'g', x: 18, y: -20, w: 10, h: 10, p: 'tuile', h2: 1.2 }, { t: 'arbre', x: -26, y: -20, r: 6, c: BOIS[1] }, { t: 'arbre', x: 32, y: 2, r: 5, c: '#5a9748' },
  ],
  caserne: () => {
    const R = alea(12), parts = [
      { t: 'r', sol: 1, c: '#d9cda9', x: -30, y: -14, w: 60, h: 30 },
      { t: 'fn', fn: g => { for (let r = 0; r < 3; r++) for (let k = 0; k < 12; k++) { C(g, '#2f4f9c', -14 + k * 2.4, -2 + r * 2.6, .75); C(g, '#1c1b1d', -14 + k * 2.4, -2 + r * 2.6, .38); } for (let i = 0; i < 6; i++) C(g, '#2f4f9c', -24 + R() * 10, 8 + R() * 5, .75); T(g, '#5b4127', .4, 22, 10, 22, 4); drapeau(g, { drap: 'tri' }, 22, 4, 1, 1, false); } },
      { t: 'g', x: -40, y: -26, w: 80, h: 12, hip: 1, p: 'ardoise', h2: 2.6 }, { t: 'g', x: -42, y: -14, w: 12, h: 32, ax: 'y', hip: 1, p: 'ardoise', h2: 2.6 }, { t: 'g', x: 30, y: -14, w: 12, h: 32, ax: 'y', hip: 1, p: 'ardoise', h2: 2.6 },
      { t: 'f', x: -30, y: 17, w: 60, h: 1.6, c: '#c2b8a0', h2: 1 }, { t: 'c', x: -2.5, y: 19, r: 1.5, p: 'ardoise', h2: 1.8 }, { t: 'c', x: 2.5, y: 19, r: 1.5, p: 'ardoise', h2: 1.8 },
    ];
    for (let x = -34; x <= 34; x += 8.5) parts.push(cheminee(x, -20));
    return parts;
  },
  haussmann: () => {
    const parts = [{ t: 'r', sol: 1, c: '#a7a59e', x: -60, y: 18, w: 120, h: 14 }, { t: 'r', sol: 1, c: '#a7a59e', x: -60, y: -36, w: 14, h: 54 }];
    parts.push({ t: 'fn', fn: g => { for (let x = -54; x < 60; x += 8) { arbre(g, x, 20, 2.6, BOIS[2]); arbre(g, x, 30, 2.6, BOIS[2]); } C(g, '#2f5a36', 30, 25, 1.2); } });
    let x = -45;
    while (x < 52) { const w = 9 + (x * 7 % 5); parts.push({ t: 'r', sol: 1, c: '#d8d2c4', x, y: 1, w: w - 1.5, h: 4 }, { t: 'm', x, y: 5, w, h: 12, h2: 3 }, { t: 'm', x, y: -15, w, h: 12, h2: 3 }); x += w + .3; }
    parts.push({ t: 'm', x: -46, y: -36, w: 12, h: 21, h2: 3 });
    return parts;
  },
  gare: () => [
    { t: 'fn', fn: g => {
      RR(g, '#8a8578', -62, -30, 124, 30, 0);
      for (let k = 0; k < 4; k++) { const y = -26 + k * 7; for (let x = -62; x < 62; x += 1.6) T(g, '#5b4a3a', .5, x, y - 1.3, x, y + 1.3); T(g, '#3a3a3a', .3, -62, y - .8, 62, y - .8); T(g, '#3a3a3a', .3, -62, y + .8, 62, y + .8); }
      RR(g, '#c9bfa7', -62, -2, 124, 4, 0);
    } },
    { t: 'v', x: -42, y: -30, w: 62, h: 28, h2: 2.6 },
    { t: 'fn', fn: g => { RR(g, '#1c1c1c', 26, -21, 9, 3.4, .8); C(g, '#2a2a2a', 34, -19.3, 1.4); RR(g, '#3a3a3a', 18, -21, 7, 3.4, .5); for (let i = 0; i < 3; i++) RR(g, '#5a6b4a', 40 + i * 9.5, -21.2, 8.6, 3.8, .6); g.globalAlpha = .7; g.drawImage(SPR.f, 32, -26, 9, 9); g.drawImage(SPR.f, 38, -28, 13, 13); g.globalAlpha = 1; } },
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
};
function bastions(cx, cy, N, Rb, rot) {
  const V = [], poly = [], ravs = [], cotes = [];
  for (let i = 0; i < N; i++) { const a = rot + i * TAU / N; V.push([cx + Math.cos(a) * Rb, cy + Math.sin(a) * Rb]); }
  for (let i = 0; i < N; i++) {
    const A = V[i], B = V[(i + 1) % N], L = Math.hypot(B[0] - A[0], B[1] - A[1]), M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const nl = Math.hypot(cx - M[0], cy - M[1]), nin = [(cx - M[0]) / nl, (cy - M[1]) / nl];
    const perp = L / (N <= 4 ? 8 : N === 5 ? 7 : 6), D = [M[0] + nin[0] * perp, M[1] + nin[1] * perp];
    const uA = [D[0] - A[0], D[1] - A[1]], lA = Math.hypot(...uA), uB = [D[0] - B[0], D[1] - B[1]], lB = Math.hypot(...uB);
    uA[0] /= lA; uA[1] /= lA; uB[0] /= lB; uB[1] /= lB;
    const FA = [A[0] + uA[0] * 2 * L / 7, A[1] + uA[1] * 2 * L / 7], FB = [B[0] + uB[0] * 2 * L / 7, B[1] + uB[1] * 2 * L / 7];
    const r = Math.hypot(FA[0] - FB[0], FA[1] - FB[1]), GA = [FB[0] + uB[0] * r, FB[1] + uB[1] * r], GB = [FA[0] + uA[0] * r, FA[1] + uA[1] * r];
    poly.push(FA, GA, GB, FB, B);
    const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], out = [-nin[0], -nin[1]];
    ravs.push({ apex: [M[0] + out[0] * L * .34, M[1] + out[1] * L * .34], b1: [M[0] + out[0] * L * .04 - u[0] * L * .2, M[1] + out[1] * L * .04 - u[1] * L * .2], b2: [M[0] + out[0] * L * .04 + u[0] * L * .2, M[1] + out[1] * L * .04 + u[1] * L * .2], M, out, u });
    cotes.push({ A, B, FA, FB, GA, GB, M, nin, porte: [(GA[0] + GB[0]) / 2, (GA[1] + GB[1]) / 2] });
  }
  return { V, poly, ravs, cotes, C: [cx, cy], N, Rb };
}
function chemin_(g, pts, ferme = true) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (ferme) g.closePath(); }
const LPIECE = { affut: '#5f6b3e', fut: '#b08a3e' };
function dessinerEnceinte(g, Tr, o = {}) {
  const fos = o.fosse || 22, [cx, cy] = Tr.C, poly = Tr.poly;
  const pousse = (p, d) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy); return [p[0] + dx / l * d, p[1] + dy / l * d]; };
  const env = []; Tr.V.forEach((v, i) => { env.push(pousse(v, fos + 14)); const r = Tr.ravs[i]; env.push([r.apex[0] + r.out[0] * 24, r.apex[1] + r.out[1] * 24]); });
  g.lineJoin = 'round'; g.lineCap = 'round';
  // le glacis descend en pente douce vers la campagne
  for (const [w, c] of [[120, 'rgba(250,245,215,.08)'], [90, 'rgba(250,245,215,.09)'], [60, 'rgba(250,245,215,.1)'], [32, 'rgba(250,245,215,.12)']]) { chemin_(g, env); g.strokeStyle = c; g.lineWidth = w; g.stroke(); }
  chemin_(g, env); g.fillStyle = '#93a865'; g.fill();
  g.save(); chemin_(g, env); g.clip(); g.strokeStyle = '#c7b98f'; g.lineWidth = 14; g.stroke(); g.restore();   // le chemin couvert
  chemin_(g, env); g.setLineDash([1, .9]); g.strokeStyle = '#5b4127'; g.lineWidth = .7; g.stroke(); g.setLineDash([]);   // sa palissade
  // fossés : ceux des demi-lunes, puis le grand
  const eauC = o.eau ? ['#355f97', '#4a78b4'] : ['#6f7d4a', '#7f8a55'];
  g.lineJoin = 'miter';
  for (const r of Tr.ravs) { chemin_(g, [r.b1, r.apex, r.b2]); g.strokeStyle = '#8f856e'; g.lineWidth = 29; g.stroke(); g.strokeStyle = eauC[0]; g.lineWidth = 26; g.stroke(); }
  chemin_(g, poly); g.strokeStyle = '#8f856e'; g.lineWidth = fos * 2 + 3; g.stroke(); g.strokeStyle = eauC[0]; g.lineWidth = fos * 2; g.stroke();
  g.strokeStyle = eauC[1]; g.lineWidth = fos * 2 - 6; g.stroke();
  if (o.eau) { g.setLineDash([6, 12]); g.strokeStyle = 'rgba(160,195,235,.6)'; g.lineWidth = .8; chemin_(g, env.map(p => pousse(p, -fos - 6))); g.stroke(); g.setLineDash([]); }
  // demi-lunes
  for (const r of Tr.ravs) {
    chemin_(g, [r.b1, r.apex, r.b2]); g.fillStyle = '#86a95f'; g.fill();
    const c = [(r.b1[0] + r.b2[0] + r.apex[0]) / 3, (r.b1[1] + r.b2[1] + r.apex[1]) / 3], k = .55;
    chemin_(g, [r.b1, r.apex, r.b2].map(p => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k])); g.fillStyle = '#9dbb72'; g.fill();
    chemin_(g, [r.b1, r.apex, r.b2]); g.strokeStyle = '#968c75'; g.lineWidth = 2.6; g.stroke(); g.strokeStyle = '#c2b79f'; g.lineWidth = 1.5; g.stroke();
  }
  // le corps de place : intérieur, talus, terre-plein, banquette, parapet, escarpe de pierre
  g.save(); chemin_(g, poly); g.fillStyle = o.interieur || '#9cb36e'; g.fill(); g.clip();
  for (const [w, c] of [[36, '#6f9450'], [32, '#89ad61'], [10.4, '#7f9e57'], [8.8, '#a7c37b']]) { chemin_(g, poly); g.strokeStyle = c; g.lineWidth = w; g.stroke(); }
  g.restore();
  chemin_(g, poly); g.strokeStyle = '#968c75'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#c2b79f'; g.lineWidth = 1.8; g.stroke();
  // guérites aux saillants
  for (const v of Tr.V) { const p = pousse(v, -2.5); C(g, '#c2b79f', p[0], p[1], 2.3); coneF(g, p[0], p[1], 1.8, PAL.ardoise, 0, 0, TAU, 10); }
  // portes : pont dormant sur le fossé, porte dans la courtine, passage dans la demi-lune
  for (const i of o.portes || []) {
    const c = Tr.cotes[i], r = Tr.ravs[i], a = Math.atan2(r.out[1], r.out[0]), p = c.porte;
    g.lineCap = 'butt'; T(g, '#b9ae96', 8, p[0] - r.out[0] * 20, p[1] - r.out[1] * 20, r.apex[0] + r.out[0] * 70, r.apex[1] + r.out[1] * 70);
    for (const [q0, q1] of [[p, [p[0] + r.out[0] * (fos + 2), p[1] + r.out[1] * (fos + 2)]], [[r.apex[0], r.apex[1]], [r.apex[0] + r.out[0] * 16, r.apex[1] + r.out[1] * 16]]]) { T(g, '#5b4127', 7.6, ...q0, ...q1); T(g, '#8a6a45', 6.4, ...q0, ...q1); for (let k = 0; k <= 1; k += .12) T(g, '#6b4d31', .25, q0[0] + (q1[0] - q0[0]) * k - r.u[0] * 3.2, q0[1] + (q1[1] - q0[1]) * k - r.u[1] * 3.2, q0[0] + (q1[0] - q0[0]) * k + r.u[0] * 3.2, q0[1] + (q1[1] - q0[1]) * k + r.u[1] * 3.2); }
    bat(g, [{ t: 'g', x: -7, y: -7, w: 10, h: 14, hip: 1, p: 'ardoise', h2: 2.4 }], p[0] - r.out[0] * 2, p[1] - r.out[1] * 2, a);
  }
  // canons en batterie sur les faces des bastions
  if (o.canons) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 30) continue;
    const u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; let n = [-u[1], u[0]];
    if ((cx - p[0]) * n[0] + (cy - p[1]) * n[1] < 0) n = [-n[0], -n[1]];
    for (const k of [.3, .7]) { const x = p[0] + u[0] * L * k + n[0] * 8, y = p[1] + u[1] * L * k + n[1] * 8; g.save(); g.translate(x, y); g.rotate(Math.atan2(-n[1], -n[0])); g.scale(.8, .8); piece(g, LPIECE, { recul: 0 }); g.restore(); }
  }
  return env;
}

function decalerQuad(q, w) {   // le quadrilatère rentré de w de chaque côté (îlot moins la moitié de la rue)
  const n = q.length, L = [];
  for (let k = 0; k < n; k++) {
    const a = q[k], b = q[(k + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
    L.push([a[0] + nx * w, a[1] + ny * w, dx, dy]);
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const [x1, y1, dx1, dy1] = L[(k + n - 1) % n], [x2, y2, dx2, dy2] = L[k], den = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(den) < 1e-6) return null;
    const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den; out.push([x1 + dx1 * t, y1 + dy1 * t]);
  }
  return out;
}
const aire = q => { let s = 0; for (let k = 0; k < q.length; k++) { const a = q[k], b = q[(k + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function toitParcelle(g, o, u, n, w, d, P) {
  const p1 = [o[0] + u[0] * w, o[1] + u[1] * w], m0 = [o[0] + n[0] * d / 2, o[1] + n[1] * d / 2], m1 = [p1[0] + n[0] * d / 2, p1[1] + n[1] * d / 2];
  const p2 = [p1[0] + n[0] * d, p1[1] + n[1] * d], p3 = [o[0] + n[0] * d, o[1] + n[1] * d];
  PG(g, teinte(P, -n[0], -n[1]), [o[0], o[1], p1[0], p1[1], m1[0], m1[1], m0[0], m0[1]]);
  PG(g, teinte(P, n[0], n[1]), [m0[0], m0[1], m1[0], m1[1], p2[0], p2[1], p3[0], p3[1]]);
  g.strokeStyle = P[2]; g.lineWidth = .4; g.beginPath(); g.moveTo(m0[0], m0[1]); g.lineTo(m1[0], m1[1]); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = .25; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(p3[0], p3[1]); g.stroke();
  return m0;
}
function remplirIlot(g, b, V, R) {
  const cfg = V.cfg, poly = decalerQuad(b.q, b.main ? 4.6 : 2.7); if (!poly) return;
  const fau = b.zone === 'faubourg', c = b.c;
  chemin_(g, poly); g.fillStyle = fau ? '#7a9a52' : '#cdbf9f'; g.fill();
  const edges = [0, 1, 2, 3].map(k => { const a = poly[k], e = poly[(k + 1) % 4], l = Math.hypot(e[0] - a[0], e[1] - a[1]), u = [(e[0] - a[0]) / l, (e[1] - a[1]) / l]; let n = [-u[1], u[0]]; if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]]; return { a, l, u, n }; });
  const angB = Math.atan2(edges[0].u[1], edges[0].u[0]), cote = Math.min(edges[0].l, edges[1].l);
  const sp = b.role;
  if (sp === 'place') {
    chemin_(g, poly); g.fillStyle = '#d6ccb2'; g.fill();
    g.save(); chemin_(g, poly); g.clip(); g.strokeStyle = 'rgba(120,105,80,.14)'; g.lineWidth = .3; for (let x = c[0] - 40; x < c[0] + 40; x += 2.6) { g.beginPath(); g.moveTo(x, c[1] - 40); g.lineTo(x + 8, c[1] + 40); g.stroke(); } g.restore();
    if (V.type === 'grande') { C(g, '#a89c86', c[0], c[1], 3.5); C(g, '#7d745f', c[0], c[1], 2); C(g, '#2c2f33', c[0], c[1], 1); bat(g, BATS.hotelDeVille(), c[0] + edges[0].n[0] * 8, c[1] + edges[0].n[1] * 8 - cote * .3, angB, cote / 60); }
    else { bat(g, BATS.halle().slice(1), c[0], c[1] + cote * .08, angB, cote / 75); C(g, '#a89c86', c[0] - cote * .32, c[1] + cote * .32, 2.8); C(g, '#4a78b4', c[0] - cote * .32, c[1] + cote * .32, 2); if (V.type === 'moyenne') bat(g, BATS.hotelDeVille(), c[0], c[1] - cote * .34, angB, cote / 70); }
    return;
  }
  if (b.zone === 'clos') {
    chemin_(g, poly); g.fillStyle = '#7c9a52'; g.fill();
    g.save(); chemin_(g, poly); g.clip();
    for (let i = 0; i < 3; i++) potager(g, c[0] - 14 + R() * 16, c[1] - 12 + R() * 14, 10 + R() * 6, 8 + R() * 4, R, false);
    for (let i = 0; i < 7; i++) arbre(g, c[0] + (R() - .5) * cote, c[1] + (R() - .5) * cote, 2.4 + R() * 1.6, R() < .5 ? '#5a9748' : BOIS[2]);
    g.restore(); g.strokeStyle = '#a39b88'; g.lineWidth = .8; chemin_(g, poly); g.stroke();
    return;
  }
  if (sp === 'parvis') { chemin_(g, poly); g.fillStyle = '#cfc5ad'; g.fill(); return; }
  if (sp === 'cathedrale' && b.voisin) {   // dessinée après les îlots, à cheval sur son parvis
    chemin_(g, poly); g.fillStyle = '#cfc5ad'; g.fill();
    const o = b.voisin.c, mx = (c[0] + o[0]) / 2, my = (c[1] + o[1]) / 2, L = Math.hypot(o[0] - c[0], o[1] - c[1]) + cote;
    V.apres.push(() => bat(g, BATS.cathedrale(), mx, my, Math.atan2(o[1] - c[1], o[0] - c[0]) * (o[0] > c[0] ? 1 : 1) + (o[0] < c[0] ? Math.PI : 0) * 0, L * .82 / 110));
    V.lieux.cathedrale = { x: mx, y: my };
    return;
  }
  if (sp === 'cathedrale' || sp === 'eglise' || sp === 'egliseDome') {
    chemin_(g, poly); g.fillStyle = '#cfc5ad'; g.fill();
    const parts = sp === 'cathedrale' ? BATS.cathedrale() : sp === 'eglise' ? (V.type === 'bourg' ? BATS.egliseRomane('ardoise') : BATS.cathedrale()) : BATS.egliseDome();
    const larg = sp === 'cathedrale' ? 110 : sp === 'eglise' ? (V.type === 'bourg' ? 40 : 112) : 58;
    if (V.type === 'bourg') { chemin_(g, poly); g.fillStyle = '#7aa659'; g.fill(); for (let i = 0; i < 16; i++) { const x = c[0] + (R() - .5) * cote * .7, y = c[1] + (R() < .5 ? -1 : 1) * cote * (.28 + R() * .1); T(g, '#5e5850', .4, x, y - 1.4, x, y + 1.4); T(g, '#5e5850', .4, x - .8, y - .6, x + .8, y - .6); } }
    bat(g, parts, c[0], c[1], angB, Math.min(edges[0].l, edges[2].l) * .9 / larg);
    V.lieux[sp] = V.lieux[sp] || { x: c[0], y: c[1] };
    return;
  }
  if (sp === 'jardin') {
    chemin_(g, poly); g.fillStyle = '#e3d8bb'; g.fill();
    const inn = decalerQuad(poly, 4); if (inn) { chemin_(g, inn); g.fillStyle = '#7aa659'; g.fill(); }
    g.save(); g.translate(c[0], c[1]); g.rotate(angB); for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) dessinPart(g, parterre(x * cote * .22 - cote * .18, y * cote * .2 - cote * .14, cote * .36, cote * .28), 0);
    C(g, '#a89c86', 0, 0, 4); C(g, '#4a78b4', 0, 0, 3); g.restore();
    for (const e of edges) for (let t = 3; t < e.l - 2; t += 5) arbre(g, e.a[0] + e.u[0] * t + e.n[0] * 2.5, e.a[1] + e.u[1] * t + e.n[1] * 2.5, 2, BOIS[2]);
    return;
  }
  if (sp === 'caserne') { chemin_(g, poly); g.fillStyle = '#d9cda9'; g.fill(); bat(g, BATS.caserne().slice(1), c[0], c[1], angB, cote / 92); return; }
  if (sp === 'hotel') { bat(g, BATS.hotel(), c[0], c[1], angB + Math.PI, cote / 92); return; }
  if (sp === 'couvent') {
    chemin_(g, poly); g.fillStyle = '#7aa659'; g.fill(); potager(g, c[0] + cote * .05, c[1] + cote * .12, cote * .32, cote * .26, R);
    const s = cote / 70;
    bat(g, [{ t: 'r', sol: 1, c: '#7aa659', x: -12, y: -12, w: 24, h: 24 }, { t: 'fn', fn: gg => { T(gg, '#e3d8bb', 1.2, -12, 0, 12, 0); T(gg, '#e3d8bb', 1.2, 0, -12, 0, 12); C(gg, '#a89c86', 0, 0, 1.6); } },
      { t: 'g', x: -18, y: -18, w: 36, h: 6, p: 'tuile', h2: 1.4 }, { t: 'g', x: -18, y: 12, w: 36, h: 6, p: 'tuile', h2: 1.4 }, { t: 'g', x: -18, y: -12, w: 6, h: 24, ax: 'y', p: 'tuile', h2: 1.4 }, { t: 'g', x: 12, y: -12, w: 6, h: 24, ax: 'y', p: 'tuile', h2: 1.4 },
      ...BATS.egliseRomane('ardoise').map(p => Object.assign({}, p, p.x != null ? { x: p.x - 4, y: p.y - 27 } : {})).filter(p => p.t !== 'fn')], c[0] - cote * .1, c[1] - cote * .02, angB, s);
    g.strokeStyle = '#a39b88'; g.lineWidth = 1; chemin_(g, poly); g.stroke();
    return;
  }
  if (sp === 'hopital') {
    chemin_(g, poly); g.fillStyle = '#d2c8b0'; g.fill();
    bat(g, [{ t: 'g', x: -26, y: -20, w: 52, h: 9, hip: 1, p: 'ardoise', h2: 2.2 }, { t: 'g', x: -26, y: 11, w: 52, h: 9, hip: 1, p: 'ardoise', h2: 2.2 }, { t: 'g', x: -26, y: -11, w: 9, h: 22, ax: 'y', p: 'ardoise', h2: 2.2 }, { t: 'g', x: 17, y: -11, w: 9, h: 22, ax: 'y', p: 'ardoise', h2: 2.2 }, { t: 'r', sol: 1, c: '#7aa659', x: -15, y: -9, w: 30, h: 18 }, { t: 'd', x: 0, y: 0, r: 4.5, p: 'plomb', h2: 3.4 }], c[0], c[1], angB, cote / 60);
    V.lieux.hopital = { x: c[0], y: c[1] };
    return;
  }
  // îlot ordinaire : une maison par parcelle le long de chaque rue, cour ou jardins au milieu
  if (!fau && b.aire > 900) { const inn = decalerQuad(poly, 12); if (inn && aire(inn) * Math.sign(aire(poly)) > 40) { chemin_(g, inn); g.fillStyle = b.aire > 2600 ? '#7c9a52' : '#cdbf9f'; g.fill(); for (let i = 0; i < 4; i++) arbre(g, c[0] + (R() - .5) * cote * .4, c[1] + (R() - .5) * cote * .4, 2.4 + R() * 2, BOIS[R() * 5 | 0]); } }
  const sides = fau ? edges.filter((e, k) => (b.cotes || [b.j === V.j0, b.i + 1 === V.i0, b.j + 1 === V.j0, b.i === V.i0])[k]) : edges;
  if (fau && !sides.length) sides.push(edges[(R() * 4) | 0]);
  const dmax = Math.min(cote * .36, V.prof || 11), parcelles = [];
  const royale = sp === 'royale';
  let dom = 'tuile'; { let r = R(); for (const [k, p] of cfg.toits) { if ((r -= p) < 0) { dom = k; break; } } }
  if (royale) { chemin_(g, poly); g.fillStyle = '#d6ccb2'; g.fill(); }
  for (const e of sides) {
    for (let t = 0; t < e.l - 1;) {
      let w = royale ? 7 : cfg.larg[0] + R() * (cfg.larg[1] - cfg.larg[0]); if (e.l - t - w < cfg.larg[0]) w = e.l - t;
      if (fau && R() < .25) { t += w; continue; }
      if (!royale && R() < .05) { t += w; continue; }
      const dp = royale ? 11 : dmax * (.75 + R() * .35);
      let pal = dom; if (R() < .12) { let r = R(); for (const [k, p] of cfg.toits) { if ((r -= p) < 0) { pal = k; break; } } }
      if (fau && V.type === 'bourg' && R() < .25) pal = 'chaume';
      if (royale) pal = 'ardoise';
      const P = royale ? PAL.ardoise : PAL[pal].map(x => mix(x, R() < .5 ? '#ffffff' : '#000000', R() * .08));
      parcelles.push([[e.a[0] + e.u[0] * t, e.a[1] + e.u[1] * t], e.u, e.n, w + .15, dp, P]);
      t += w;
    }
  }
  g.fillStyle = 'rgba(20,20,10,.3)';
  for (const [o, u, n, w, d] of parcelles) { const k = 1.2; g.beginPath(); g.moveTo(o[0] + OMB[0] * k, o[1] + OMB[1] * k); g.lineTo(o[0] + u[0] * w + OMB[0] * k, o[1] + u[1] * w + OMB[1] * k); g.lineTo(o[0] + u[0] * w + n[0] * d + OMB[0] * k, o[1] + u[1] * w + n[1] * d + OMB[1] * k); g.lineTo(o[0] + n[0] * d + OMB[0] * k, o[1] + n[1] * d + OMB[1] * k); g.fill(); }
  for (const p of parcelles) {
    const m0 = toitParcelle(g, ...p);
    if (R() < .45) { const [o, u, n, w] = p, x = m0[0] + u[0] * w * .8, y = m0[1] + u[1] * w * .8; RR(g, '#7d4a3a', x - .6, y - .6, 1.2, 1.2, .2); V.cheminees.push([x, y]); }
    if (fau && R() < .5) { const [o, u, n, w, d] = p; potager(g, o[0] + n[0] * (d + 3) + u[0] * 1, o[1] + n[1] * (d + 3) + u[1] * 1, Math.max(3, w - 2), 6, R, false); }
  }
  if (royale) { C(g, '#a89c86', c[0], c[1], 3); C(g, '#2c2f33', c[0], c[1], 1.4); V.lieux.royale = { x: c[0], y: c[1] }; }
}
export { toile, BATS, BOIS, BOUGE, C, CHEVAL, DPR, E, GRAINE, HERBE, KT, LPIECE, MEMO, OMB, OMBRE, PAL, PEAU, PG, RR, SOLEIL, SOLS, SPR, Scene, T, TAU, TOITS, abreuvoir, aire, ajouterCorps, alea, angLerp, arbre, avant, bastions, bat, bois, botte, boulet, brancher, bras, caisson, calvaire, camAnim, cavalier, charbonniere, charrue, chemin, chemin_, cheminee, cheval, cibleDe, clair, clamp, cloture, coneF, copeaux, corps, cratere, croix, decaler, decalerQuad, dessinMaison, dessinPart, dessinerEnceinte, distPoly, domeF, drapeau, dup, ease, eclair, empreinte, epouvantail, etincelle, fantassin, ferme, figAuHasard, flammes, fumee, fusil, haie, hx, impact, lerp, ligne, linge, longueur, majUnite, mansardeF, mare, mix, mod, moutons, parcelle, parterre, piece, pietine, pignon, placer, pont, poseFig, potager, pyramideF, remplirIlot, riviere, route, ruche, rue, ruisseau, sapin, sombre, souche, sprite, stere, surChemin, surPoly, tasBois, teinte, teinteL, tenue, terre, tete, tirs, toit, toitParcelle, touffes, tronc, unite, verger };
