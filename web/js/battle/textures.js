// Vue tactique : motifs du sol, dans le style de Champs de Plaine (maquette dev/maquette-2d.html, parcelle).
// Un motif est un petit canevas qui se répète sans joint (période P m, les marques qui touchent un bord sont recopiées
// de l'autre côté : dup) : aplat de la culture, grandes taches plus claires ou plus sombres, raies régulières le long de
// x (la tuile les tourne dans le sens de la parcelle), puis les menus détails (touffes et fleurs des prés, mottes des
// labours, pailles du chaume, épis du blé, ceps…). Peint à la densité de la tuile (L pixels par mètre). Sous la neige,
// les mêmes motifs pâlis, des touffes qui percent. Aussi : les couleurs de chaque sol (tournières), les outils de
// couleur de la maquette (mix, alea) et l'ombre douce.
import { TAU, canvas } from './formes.js';

// ------------------------------------------------------------------ outils de la maquette
const hx = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const MEMO = new Map();
// mélange de deux couleurs #rrggbb (k : part de b), en #rrggbb : se laisse remélanger
export function mix(a, b, k) {
  const key = a + b + k; let v = MEMO.get(key);
  if (!v) { const A = hx(a), B = hx(b); v = '#' + A.map((x, i) => Math.round(x + (B[i] - x) * k).toString(16).padStart(2, '0')).join(''); MEMO.set(key, v); }
  return v;
}
export const sombre = (c, k = 0.25) => mix(c, '#000000', k), clair = (c, k = 0.25) => mix(c, '#ffffff', k);
// tirage pseudo-aléatoire déterministe (mulberry32) : une même graine, les mêmes marques d'une tuile à l'autre
export function alea(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function E(g, c, x, y, rx, ry, r = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, r, 0, TAU); g.fill(); }
function C(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
// répète un dessin de l'autre côté du motif (période P) quand il touche un bord
function dup(P, x, y, m, fn) {
  fn(x, y);
  const xs = [x], ys = [y];
  if (x < m) xs.push(x + P); if (x > P - m) xs.push(x - P);
  if (y < m) ys.push(y + P); if (y > P - m) ys.push(y - P);
  for (const a of xs) for (const b of ys) if (a !== x || b !== y) fn(a, b);
}

// ------------------------------------------------------------------ les sols
export const HERBE = '#6c984d', NEIGE = '#e9edf0', BOIS = ['#2f5e2c', '#3a6c34', '#45793c', '#2b5427', '#518644'];
// base : aplat ; raie : couleur des raies (null : aucune), pas et ep : leur écartement et leur largeur (m) ; les pas
// divisent 40 m (la période des motifs fins) : pas de joint
export const SOLS = {
  chaume: { base: '#cfb87e', raie: '#bea86b', pas: 5, ep: 2 },
  ble: { base: '#d8bf6c', raie: '#c7aa55', pas: 4, ep: 1.7 },
  labour: { base: '#6f4a31', raie: '#5b3b26', pas: 5, ep: 2.4 },
  pre: { base: '#7aa659', raie: '#72a052', pas: 8, ep: 3.5 },
  colza: { base: '#418d3e', raie: '#377d35', pas: 4, ep: 2 },
  friche: { base: '#8e8b4e', raie: '#817e45', pas: 5, ep: 2.2 },
  jachere: { base: '#b9ad86', raie: '#aca079', pas: 8, ep: 2.5 },
  bleVert: { base: '#5f9a47', raie: '#558d3f', pas: 4, ep: 1.6 },
  avoine: { base: '#a8b064', raie: '#99a157', pas: 4, ep: 1.6 },
  semis: { base: '#7a5638', raie: '#664530', pas: 5, ep: 2.2 },
  mais: { base: '#5f8d3e', raie: '#4a7631', pas: 5, ep: 2.6 },
  prairie: { base: '#86ad5f', raie: '#7ba354', pas: 8, ep: 3 },
  vigne: { base: '#b5a27a', raie: '#a39066', pas: 2.5, ep: 1.1 },
  vigneFoule: { base: '#b5a27a' }, herbe: { base: HERBE }, lande: { base: '#8f8a55' }, marais: { base: '#6e9468' },
  sable: { base: '#ddcb94' }, roche: { base: '#aaa491' }, sousBois: { base: '#284b24' }, terre: { base: '#d9caa1' },
  route: { base: '#c6b388' }, eau: { base: '#4a78b4' }, cour: { base: '#bfb498' }, pave: { base: '#a69d88' },
};
// couleurs d'un sol selon la saison (mêmes champs que SOLS)
export function couleurs(kind, season) {
  const s = SOLS[kind] || SOLS.herbe, o = { ...s };
  const vert = kind === 'pre' || kind === 'herbe' || kind === 'prairie';
  if (vert && season === 'ete') { o.base = mix(s.base, '#b9b060', 0.18); if (s.raie) o.raie = mix(s.raie, '#b9b060', 0.18); }
  if (vert && season === 'automne') { o.base = mix(s.base, '#a0965a', 0.25); if (s.raie) o.raie = mix(s.raie, '#a0965a', 0.25); }
  if (kind === 'mais' && season === 'automne') { o.base = '#b49a5e'; o.raie = '#9c8450'; }
  if (season === 'hiver') {
    const k = kind === 'eau' ? 0 : kind === 'sousBois' ? 0.55 : kind === 'route' || kind === 'terre' || kind === 'pave' ? 0.7 : vert ? 0.9 : 0.84;
    o.base = kind === 'eau' ? mix(s.base, '#8fa6b8', 0.35) : mix(s.base, NEIGE, k);
    // (les raies : des creux à peine bleutés, la terre d'un labour y perce un peu)
    if (s.raie) o.raie = mix(mix(o.base, '#a9b6c4', vert ? 0.2 : 0.35), s.raie, kind === 'labour' || kind === 'semis' ? 0.22 : 0.08);
  }
  return o;
}

// ------------------------------------------------------------------ cultures selon la saison
// [culture, poids] ; une parcelle tire sa culture d'après son numéro
export const CULTURES = {
  printemps: [['bleVert', 30], ['colza', 12], ['avoine', 14], ['labour', 18], ['prairie', 18], ['jachere', 8]],
  ete: [['ble', 26], ['chaume', 22], ['labour', 12], ['avoine', 8], ['mais', 8], ['colza', 8], ['friche', 8], ['jachere', 8]],
  automne: [['labour', 34], ['chaume', 22], ['mais', 12], ['semis', 18], ['colza', 8], ['friche', 6]],
  hiver: [['labour', 55], ['chaume', 35], ['friche', 10]],
};
export function culture(season, r) {
  const list = CULTURES[season] || CULTURES.printemps, tot = list.reduce((a, c) => a + c[1], 0);
  let x = r * tot;
  for (const [c, w] of list) { x -= w; if (x <= 0) return c; }
  return list[0][0];
}

// ------------------------------------------------------------------ motifs
// période du motif (m) : 80 m de loin, 40 m de près (la mémoire d'un motif à 16 px/m reste sous 2 Mo)
export const periode = L => (L <= 4 ? 80 : 40);

// kind : nature du sol (SOLS) ; L : px/m ; pal : palette de la saison (terrain.js) ; season : printemps, ete…
export function texture(kind, L, pal, season) {
  const P = periode(L), size = Math.max(4, Math.round(P * L)), snow = !!pal.neige;
  const cv = canvas(size, size), g = cv.getContext('2d');
  g.setTransform(size / P, 0, 0, size / P, 0, 0);
  const s = couleurs(kind, snow ? 'hiver' : season), R = alea(7 + kind.length * 131 + kind.charCodeAt(0) * 17 + Math.round(L * 8));
  g.fillStyle = s.base; g.fillRect(0, 0, P, P);
  // grandes taches douces
  g.globalAlpha = kind === 'eau' ? 0.12 : snow ? 0.08 : 0.2;
  for (let i = 0, n = P * P / 700; i < n; i++) {
    const c = R() < 0.5 ? clair(s.base, 0.14) : sombre(s.base, 0.12), rx = 8 + R() * 18, ry = 5 + R() * 12, r = R() * 3;
    dup(P, R() * P, R() * P, 30, (a, b) => E(g, c, a, b, rx, ry, r));
  }
  g.globalAlpha = 1;
  // raies le long de x (trop serrées pour la densité : leur teinte moyenne, sans moirure)
  if (s.raie && s.pas * L < 3) { g.globalAlpha = s.ep / s.pas; g.fillStyle = s.raie; g.fillRect(0, 0, P, P); g.globalAlpha = 1; }
  else if (s.raie) {
    g.strokeStyle = s.raie; g.lineWidth = s.ep; g.beginPath();
    for (let y = s.pas / 2; y < P; y += s.pas) { g.moveTo(-1, y); g.lineTo(P + 1, y); }
    g.stroke();
  }
  if (L < 1.5) return cv;   // (les détails ne feraient pas un pixel)
  const n = P * P, pt = (cnt, fn, m = 3) => { for (let i = 0; i < cnt; i++) { const a = R(), b = R(), c = R(), d = R(); dup(P, a * P, b * P, m, (u, v) => fn(u, v, c, d)); } };
  if (snow) {
    // neige : quelques touffes et chaumes qui percent, scintillement de près
    if (kind !== 'eau' && kind !== 'route' && kind !== 'pave') pt(n / 60, (u, v, c) => E(g, c < 0.5 ? 'rgba(110,104,84,.45)' : 'rgba(150,140,110,.4)', u, v, 0.5, 0.3, c * 3));
    if (L >= 8) pt(n / 30, (u, v) => C(g, 'rgba(255,255,255,.9)', u, v, 0.07));
    return cv;
  }
  switch (kind) {
    case 'pre': case 'prairie': case 'herbe':
      pt(n / (kind === 'herbe' ? 30 : 40), (u, v, c, d) => E(g, c < 0.5 ? sombre(s.base, 0.13) : clair(s.base, 0.14), u, v, 0.8 + d, 0.6 + d * 0.6, c * 3));
      if (season !== 'automne') pt(n / (kind === 'herbe' ? 1800 : 800), (u, v, c) => C(g, c < 0.6 ? '#f4f1e4' : season === 'printemps' && c > 0.85 ? '#b79ad0' : '#efd45a', u, v, 0.38));
      break;
    case 'labour': case 'semis':
      pt(n / 26, (u, v, c, d) => C(g, c < 0.5 ? clair(s.base, 0.12) : sombre(s.base, 0.2), u, v, 0.4 + d * 0.6));
      if (kind === 'semis') { g.fillStyle = 'rgba(110,150,70,.6)'; for (let y = s.pas; y < P; y += s.pas) g.fillRect(0, y - 0.15, P, 0.3); }
      break;
    case 'chaume': pt(n / 45, (u, v, c) => { g.strokeStyle = c < 0.5 ? '#e4d3a0' : '#b39c60'; g.lineWidth = 0.35; g.beginPath(); g.moveTo(u, v); g.lineTo(u + 1.6, v + 0.2); g.stroke(); }); break;
    case 'ble': pt(n / 36, (u, v, c) => C(g, c < 0.5 ? '#ead28a' : '#b9993f', u, v, 0.35)); break;
    case 'colza': case 'bleVert': pt(n / 34, (u, v, c, d) => C(g, c < 0.5 ? clair(s.base, 0.15) : sombre(s.base, 0.22), u, v, 0.5 + d * 0.4)); break;
    case 'mais':
      // pieds de maïs sur les raies
      for (let y = s.pas / 2; y < P; y += s.pas) for (let x = 0.4; x < P; x += 0.8) C(g, R() < 0.5 ? clair(s.raie, 0.12) : sombre(s.raie, 0.15), x, y + (R() - 0.5) * 0.3, 0.45);
      break;
    case 'vigne':
      // ceps en rangs, ombrés au sud-est
      for (let y = s.pas / 2; y < P; y += s.pas) for (let x = 0.45; x < P; x += 0.9) {
        const c = season === 'automne' ? mix('#6f8a3a', '#c9a040', R() * 0.7) : R() < 0.5 ? '#4f7d33' : '#5d8f3c';
        C(g, 'rgba(60,48,30,.35)', x + 0.25, y + 0.3, 0.55); C(g, c, x, y, 0.5);
      }
      break;
    case 'vigneFoule': pt(n / 1.4, (u, v, c) => { C(g, 'rgba(60,48,30,.35)', u + 0.25, v + 0.3, 0.5); C(g, season === 'automne' ? mix('#6f8a3a', '#c9a040', c) : c < 0.5 ? '#4f7d33' : '#5d8f3c', u, v, 0.45); }); break;
    case 'friche': case 'jachere': pt(n / 40, (u, v, c, d) => E(g, c < 0.5 ? clair(s.base, 0.15) : sombre(s.base, 0.18), u, v, 0.9 + d, 0.6, c * 3)); break;
    case 'lande':
      pt(n / 20, (u, v, c, d) => C(g, c < 0.2 ? '#8f6a92' : c < 0.3 ? '#c9b648' : c < 0.7 ? '#6f7d48' : sombre(s.base, 0.2), u, v, 0.5 + d * 0.7));
      break;
    case 'marais':
      pt(n / 160, (u, v, c, d) => E(g, 'rgba(74,120,150,.55)', u, v, 2 + d * 3, 1.2 + d * 1.5, c * 3), 6);
      pt(n / 8, (u, v, c) => { g.strokeStyle = c < 0.5 ? '#3f6a33' : '#8a9a5a'; g.lineWidth = 0.18; g.beginPath(); g.moveTo(u, v); g.lineTo(u + (c - 0.5) * 0.6, v - 0.9); g.stroke(); });
      break;
    case 'sousBois': pt(n / 14, (u, v, c, d) => E(g, c < 0.5 ? '#335d2d' : '#22401f', u, v, 1, 0.6, d * 3)); break;
    case 'sable': pt(n / 12, (u, v, c) => C(g, c < 0.5 ? clair(s.base, 0.2) : sombre(s.base, 0.12), u, v, 0.2)); break;
    case 'roche': pt(n / 30, (u, v, c, d) => E(g, c < 0.5 ? '#8c8676' : '#c4bea9', u, v, 0.6 + d * 1.4, 0.4 + d, c * 3)); break;
    case 'terre': case 'route': case 'cour': pt(n / 6, (u, v, c, d) => C(g, c < 0.5 ? sombre(s.base, 0.14) : clair(s.base, 0.18), u, v, 0.12 + d * 0.18)); break;
    case 'pave': {
      // pavés de grès en rangs décalés (1,25 m : 32 ou 64 rangs par période)
      g.strokeStyle = 'rgba(80,72,58,.35)'; g.lineWidth = 0.7;
      for (let y = 0.625, k = 0; y < P; y += 1.25, k++) { g.setLineDash([0.8, 0.45]); g.lineDashOffset = (k % 3) * 0.42; g.beginPath(); g.moveTo(0, y); g.lineTo(P, y); g.stroke(); }
      g.setLineDash([]); g.lineDashOffset = 0;
      break;
    }
    case 'eau':
      g.strokeStyle = 'rgba(160,195,235,.4)'; g.lineWidth = 0.4;
      pt(n / 50, (u, v, c) => { g.beginPath(); g.moveTo(u, v); g.lineTo(u + 1.5 + c * 3, v); g.stroke(); }, 5);
      break;
  }
  return cv;
}
