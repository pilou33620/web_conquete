// Vue tactique : la table des heures (étape 9a). Pour chaque heure de 5 h à 22 h : couleur et force du soleil, du
// ciel, de la brume, et l'étalonnage de l'image (balance des blancs, saturation, verts tirés vers le jaune,
// contraste, ombres bleutées, hautes lumières chaudes, vignettage), à la manière des ambiances d'Ultimate General
// (matin doré et brumeux, midi chaud et franc, couchant orangé, nuit bleue). La météo s'applique par-dessus.
// Une seule table remplace les calculs dispersés de l'éclairage ; effets.js (ciel) et apres.js (LUT) la lisent.
// Fonctions pures, sans Three.js : tests/heures.test.mjs.
import { clamp } from './formes.js';

// he : heure de la table ; sun : couleur du soleil (linéaire) et sunI sa force (× celle de la météo) ; sky : lumière
// du ciel (hémisphère) et skyI sa force ; fog : couleur de la brume et du fond (0 à 255, par beau temps) ;
// g : étalonnage (voir grade)
export const HEURES = [
  { he: 5, sun: [0.55, 0.52, 0.66], sunI: 0.22, sky: [0.5, 0.58, 0.85], skyI: 0.5, fog: [64, 74, 104],
    g: { expo: 1.0, temp: -0.5, sat: 0.7, vert: 0.4, contrast: 0.96, lift: [0.0, 0.01, 0.04], gain: [0.96, 0.98, 1.04], vig: 0.3 } },
  { he: 6.5, sun: [1.0, 0.64, 0.4], sunI: 0.72, sky: [0.86, 0.8, 0.86], skyI: 0.82, fog: [212, 190, 174],
    g: { expo: 1.02, temp: 0.75, sat: 0.86, vert: 0.45, contrast: 0.95, lift: [0.025, 0.018, 0.03], gain: [1.05, 1.0, 0.92], vig: 0.2 } },
  { he: 8, sun: [1.0, 0.86, 0.67], sunI: 0.95, sky: [0.84, 0.88, 0.97], skyI: 0.95, fog: [212, 212, 208],
    g: { expo: 1.02, temp: 0.45, sat: 1.22, vert: 0.3, contrast: 1.1, lift: [0.012, 0.012, 0.03], gain: [1.04, 1.0, 0.93], vig: 0.16 } },
  { he: 10, sun: [1.0, 0.93, 0.82], sunI: 1.0, sky: [0.8, 0.88, 1.0], skyI: 1.0, fog: [202, 214, 228],
    g: { expo: 1.02, temp: 0.3, sat: 1.34, vert: 0.25, contrast: 1.18, lift: [0.006, 0.008, 0.026], gain: [1.03, 1.0, 0.95], vig: 0.15 } },
  { he: 13, sun: [1.0, 0.95, 0.87], sunI: 1.0, sky: [0.8, 0.88, 1.0], skyI: 1.0, fog: [201, 216, 230],
    g: { expo: 1.0, temp: 0.24, sat: 1.36, vert: 0.25, contrast: 1.2, lift: [0.004, 0.008, 0.026], gain: [1.03, 1.0, 0.96], vig: 0.15 } },
  { he: 16, sun: [1.0, 0.92, 0.79], sunI: 1.0, sky: [0.81, 0.87, 0.99], skyI: 1.0, fog: [206, 213, 222],
    g: { expo: 1.02, temp: 0.34, sat: 1.34, vert: 0.25, contrast: 1.18, lift: [0.008, 0.008, 0.026], gain: [1.04, 1.0, 0.94], vig: 0.15 } },
  { he: 17.5, sun: [1.0, 0.84, 0.6], sunI: 0.95, sky: [0.84, 0.85, 0.94], skyI: 0.95, fog: [216, 206, 194],
    g: { expo: 1.03, temp: 0.6, sat: 1.28, vert: 0.3, contrast: 1.15, lift: [0.014, 0.01, 0.03], gain: [1.06, 1.0, 0.9], vig: 0.18 } },
  { he: 19, sun: [1.0, 0.6, 0.33], sunI: 0.68, sky: [0.84, 0.72, 0.76], skyI: 0.78, fog: [222, 170, 146],
    g: { expo: 1.05, temp: 0.85, sat: 1.18, vert: 0.35, contrast: 1.1, lift: [0.02, 0.01, 0.04], gain: [1.08, 0.98, 0.86], vig: 0.24 } },
  { he: 20, sun: [0.86, 0.46, 0.46], sunI: 0.34, sky: [0.52, 0.52, 0.76], skyI: 0.6, fog: [118, 100, 128],
    g: { expo: 1.06, temp: 0.05, sat: 0.78, vert: 0.45, contrast: 0.98, lift: [0.01, 0.01, 0.05], gain: [1.03, 0.97, 0.98], vig: 0.32 } },
  { he: 21, sun: [0.42, 0.48, 0.74], sunI: 0.12, sky: [0.36, 0.43, 0.72], skyI: 0.42, fog: [38, 48, 78],
    g: { expo: 1.1, temp: -0.6, sat: 0.55, vert: 0.5, contrast: 0.95, lift: [0.0, 0.012, 0.05], gain: [0.94, 0.98, 1.06], vig: 0.42 } },
  { he: 22, sun: [0.42, 0.48, 0.74], sunI: 0.1, sky: [0.34, 0.41, 0.7], skyI: 0.4, fog: [34, 44, 72],
    g: { expo: 1.1, temp: -0.6, sat: 0.52, vert: 0.5, contrast: 0.95, lift: [0.0, 0.012, 0.05], gain: [0.94, 0.98, 1.06], vig: 0.45 } },
];
// la brume à midi par beau temps : la couleur du ciel de chaque météo y est ramenée à l'heure
const NOON_FOG = [201, 216, 230];

// Météo : ciel (brume), force du soleil, ombres des nuages, et retouches de l'étalonnage (ajoutées, sauf sat et
// contrast multipliés)
export const METEO = {
  soleil: { sky: [201, 216, 230], sunI: 2.85, cloud: 0.22 },
  canicule: { sky: [218, 222, 226], sunI: 3.2, cloud: 0.14, g: { temp: 0.25, sat: 0.95, lift: [0.015, 0.01, 0], gain: [0.02, 0.01, -0.02] } },
  nuages: { sky: [185, 195, 205], sunI: 1.5, cloud: 0.34, g: { temp: -0.12, sat: 0.92, contrast: 0.97 } },
  pluie: { sky: [155, 165, 176], sunI: 0.7, cloud: 0.3, g: { temp: -0.28, sat: 0.8, contrast: 0.95, vig: 0.12, lift: [0, 0.005, 0.015] } },
  orage: { sky: [138, 147, 160], sunI: 0.7, cloud: 0.38, g: { expo: -0.06, temp: -0.32, sat: 0.76, vig: 0.18, lift: [0, 0.005, 0.02] } },
  tempete: { sky: [138, 147, 160], sunI: 0.7, cloud: 0.38, g: { expo: -0.06, temp: -0.32, sat: 0.76, vig: 0.18, lift: [0, 0.005, 0.02] } },
  brouillard: { sky: [211, 215, 219], sunI: 0.7, cloud: 0, g: { temp: -0.1, sat: 0.72, contrast: 0.88, vig: 0.05, lift: [0.035, 0.037, 0.04] } },
  neige: { sky: [208, 214, 222], sunI: 1.05, cloud: 0, g: { temp: -0.22, sat: 0.88, vig: 0.1, lift: [0, 0.01, 0.035] } },
};

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function lerpG(a, b, t) {
  const o = {};
  for (const k of Object.keys(a)) o[k] = Array.isArray(a[k]) ? lerp3(a[k], b[k], t) : lerp(a[k], b[k], t);
  return o;
}

// Heure de la table : celle de l'horloge le jour (le plein jour s'arrête à 17 h 30), puis le crépuscule suit la
// lumière du serveur (light : 1 en plein jour, 0,15 la nuit ; elle baisse pendant la dernière heure avant la nuit,
// plus tôt l'hiver), jusqu'à la nuit de 21 h. Sans saut quand la lumière commence à baisser.
export function heureEffective(hour, light = 1) {
  const day = clamp(hour ?? 12, 5, 17.5), k = clamp((1 - clamp(light ?? 1, 0, 1)) / 0.85, 0, 1);
  return day + (21 - day) * k;
}

// la ligne de la table à l'heure he, interpolée entre ses deux voisines
export function ligne(he) {
  const T = HEURES;
  if (he <= T[0].he) return T[0];
  for (let i = 1; i < T.length; i++) {
    if (he <= T[i].he) {
      const a = T[i - 1], b = T[i], t = (he - a.he) / (b.he - a.he);
      return { he, sun: lerp3(a.sun, b.sun, t), sunI: lerp(a.sunI, b.sunI, t), sky: lerp3(a.sky, b.sky, t), skyI: lerp(a.skyI, b.skyI, t), fog: lerp3(a.fog, b.fog, t), g: lerpG(a.g, b.g, t) };
    }
  }
  return T[T.length - 1];
}

// étalonnage de l'heure, retouché par la météo
export function etalonnage(he, weather = 'soleil') {
  const g = { ...ligne(he).g }, m = (METEO[weather] || METEO.soleil).g || {};
  for (const [k, v] of Object.entries(m)) {
    if (k === 'sat' || k === 'contrast') g[k] *= v;
    else if (Array.isArray(v)) g[k] = g[k].map((x, i) => x + v[i]);
    else g[k] += v;
  }
  return g;
}

// L'étalonnage d'une couleur (r, g, b entre 0 et 1, déjà passée en sRGB) : c'est ce que contient la LUT.
// temp : balance des blancs (+ chaud, − froid) ; vert : les verts vifs tirés vers le jaune ; sat : saturation ;
// contrast : autour d'un gris moyen ; lift : teinte ajoutée dans les ombres ; gain : teinte des hautes lumières.
// Avec temp = vert = 0, sat = contrast = 1, lift = 0 et gain = 1, la couleur ne change pas.
export function grade(r, g, b, G) {
  r *= 1 + 0.08 * G.temp; g *= 1 + 0.01 * G.temp; b *= 1 - 0.08 * G.temp;
  const gx = Math.max(0, g - Math.max(r, b)) * G.vert;
  g -= gx * 0.28; r += gx * 0.16;
  let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = l + (r - l) * G.sat; g = l + (g - l) * G.sat; b = l + (b - l) * G.sat;
  const P = 0.42;
  r = P + (r - P) * G.contrast; g = P + (g - P) * G.contrast; b = P + (b - P) * G.contrast;
  l = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b, 0, 1);
  const sh = (1 - l) * (1 - l), hi = l * l;
  r = (r + G.lift[0] * sh) * (1 + (G.gain[0] - 1) * hi);
  g = (g + G.lift[1] * sh) * (1 + (G.gain[1] - 1) * hi);
  b = (b + G.lift[2] * sh) * (1 + (G.gain[2] - 1) * hi);
  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
}

// La LUT 3D de l'étalonnage G : n³ cases RGBA (octets), r le plus rapide, puis g, puis b (l'ordre d'une texture 3D)
export function lut(G, n = 32) {
  const out = new Uint8Array(n * n * n * 4);
  let k = 0;
  for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
    const c = grade(ri / (n - 1), gi / (n - 1), bi / (n - 1), G);
    out[k++] = Math.round(c[0] * 255); out[k++] = Math.round(c[1] * 255); out[k++] = Math.round(c[2] * 255); out[k++] = 255;
  }
  return out;
}
// une clé qui ne change que si l'étalonnage change à l'œil (la LUT n'est recalculée qu'alors)
export function cleEtalonnage(G) {
  return Object.keys(G).sort().map(k => Array.isArray(G[k]) ? G[k].map(v => v.toFixed(3)).join(',') : G[k].toFixed(2)).join('|');
}

// Lumière et ciel de la scène pour l'état du ciel st ({weather, light, hour, wind}) et la saison : direction et
// couleur du soleil (à l'est le matin, au sud à midi, bas à l'ouest le soir ; plus haut l'été), lumière du ciel,
// couleur et portée de la brume, force des ombres des nuages, teinte de la fumée, étalonnage (grade).
// flash : éclair d'orage en cours (0 à 0,5) ; clouds : ombres des nuages permises par la qualité
export function ambiance(st, season, { flash = 0, clouds = true } = {}) {
  const w = METEO[st.weather] ? st.weather : 'soleil', M = METEO[w];
  const L = clamp(st.light ?? 1, 0, 1), h = st.hour ?? 12, he = heureEffective(h, L), row = ligne(he);
  const emax = ({ ete: 62, printemps: 47, automne: 40, hiver: 26 }[season] ?? 45) * Math.PI / 180;
  const el = Math.max(0.06, emax * Math.sin(Math.PI * clamp((h - 6) / 14, 0, 1))), az = (90 + (h - 6) * 15) * Math.PI / 180;
  const wet = w === 'pluie' || w === 'orage' || w === 'tempete';
  const dull = wet || w === 'brouillard' || w === 'nuages' || w === 'neige';
  // sous un ciel couvert, la lumière perd sa couleur (la moitié) ; la brume est le ciel de la météo, teinté par l'heure
  const lum = (row.sun[0] + row.sun[1] + row.sun[2]) / 3;
  const sun = dull ? lerp3(row.sun, [lum, lum, lum], 0.5) : row.sun;
  const fog = M.sky.map((c, i) => clamp(c * row.fog[i] / NOON_FOG[i], 0, 255) / 255);
  return {
    he, sunDir: [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)], sun,
    sunI: M.sunI * row.sunI,
    // le ciel éclaire, bleuté : les ombres restent teintées au lieu de noires ; par temps clair, le soleil l'emporte
    // nettement (sinon le relief, les nuages et l'ombre des collines ne se lisent pas), sous un ciel couvert c'est
    // la lumière diffuse
    hemiSky: dull ? lerp3(row.sky, [0.86, 0.88, 0.9], 0.4) : row.sky, hemiGround: [0.46, 0.4, 0.27],
    hemiI: (dull ? 2.15 : 1.5) * row.skyI + flash * 3,
    fog, fogNear: w === 'brouillard' ? 0.05 : wet ? 0.6 : 1, fogFar: w === 'brouillard' ? 0.15 : wet ? 0.6 : 1,
    cloudA: M.cloud * L * (clouds ? 1 : 0),
    wind: st.wind || [1.5, 0.5],
    smoke: lerp3([1, 1, 1], sun, 0.6).map(v => v * (0.45 + 0.55 * L)),
    grade: etalonnage(he, w),
  };
}
