// Vue tactique : la table des heures (étape 9a). Pour chaque heure de 5 h à 22 h : couleur et force du soleil, du
// ciel, de la brume, et l'étalonnage de l'image (balance des blancs, saturation, verts tirés vers le jaune,
// contraste, ombres bleutées, hautes lumières chaudes, vignettage), à la manière des ambiances d'Ultimate General
// (matin doré et brumeux, midi chaud et franc, couchant orangé, nuit bleue). La météo s'applique par-dessus.
// Une seule table pour la lumière de la bataille : effets.js (ciel, atmosphere) en tire la teinte de l'heure, la
// direction des ombres et les couleurs éteintes du soir. Fonctions pures : tests/heures.test.mjs.
import { clamp } from './formes.js';

// he : heure de la table ; sun : couleur du soleil (linéaire) et sunI sa force (× celle de la météo) ; sky : lumière
// du ciel (hémisphère) et skyI sa force ; fog : couleur de la brume et du fond (0 à 255, par beau temps) ;
// g : étalonnage (voir grade)
export const HEURES = [
  { he: 5, zen: [26, 34, 66], sun: [0.55, 0.52, 0.66], sunI: 0.22, sky: [0.5, 0.58, 0.85], skyI: 0.5, fog: [64, 74, 104],
    g: { expo: 1.0, temp: -0.5, sat: 0.7, vert: 0.4, contrast: 0.96, lift: [0.0, 0.01, 0.04], gain: [0.96, 0.98, 1.04], vig: 0.3 } },
  { he: 6.5, zen: [118, 138, 188], sun: [1.0, 0.64, 0.4], sunI: 0.72, sky: [0.86, 0.8, 0.86], skyI: 0.82, fog: [212, 190, 174],
    g: { expo: 1.02, temp: 0.75, sat: 0.86, vert: 0.45, contrast: 0.95, lift: [0.025, 0.018, 0.03], gain: [1.05, 1.0, 0.92], vig: 0.2 } },
  { he: 8, zen: [104, 146, 206], sun: [1.0, 0.86, 0.67], sunI: 0.95, sky: [0.84, 0.88, 0.97], skyI: 0.95, fog: [212, 212, 208],
    g: { expo: 1.02, temp: 0.45, sat: 1.22, vert: 0.3, contrast: 1.1, lift: [0.012, 0.012, 0.03], gain: [1.04, 1.0, 0.93], vig: 0.16 } },
  { he: 10, zen: [86, 138, 208], sun: [1.0, 0.93, 0.82], sunI: 1.0, sky: [0.8, 0.88, 1.0], skyI: 1.0, fog: [202, 214, 228],
    g: { expo: 1.02, temp: 0.3, sat: 1.34, vert: 0.25, contrast: 1.18, lift: [0.006, 0.008, 0.026], gain: [1.03, 1.0, 0.95], vig: 0.15 } },
  { he: 13, zen: [80, 132, 206], sun: [1.0, 0.95, 0.87], sunI: 1.0, sky: [0.8, 0.88, 1.0], skyI: 1.0, fog: [201, 216, 230],
    g: { expo: 1.0, temp: 0.24, sat: 1.36, vert: 0.25, contrast: 1.2, lift: [0.004, 0.008, 0.026], gain: [1.03, 1.0, 0.96], vig: 0.15 } },
  { he: 16, zen: [88, 138, 204], sun: [1.0, 0.92, 0.79], sunI: 1.0, sky: [0.81, 0.87, 0.99], skyI: 1.0, fog: [206, 213, 222],
    g: { expo: 1.02, temp: 0.34, sat: 1.34, vert: 0.25, contrast: 1.18, lift: [0.008, 0.008, 0.026], gain: [1.04, 1.0, 0.94], vig: 0.15 } },
  { he: 17.5, zen: [106, 136, 194], sun: [1.0, 0.84, 0.6], sunI: 0.95, sky: [0.84, 0.85, 0.94], skyI: 0.95, fog: [216, 206, 194],
    g: { expo: 1.03, temp: 0.6, sat: 1.28, vert: 0.3, contrast: 1.15, lift: [0.014, 0.01, 0.03], gain: [1.06, 1.0, 0.9], vig: 0.18 } },
  { he: 19, zen: [118, 116, 168], sun: [1.0, 0.6, 0.33], sunI: 0.68, sky: [0.84, 0.72, 0.76], skyI: 0.78, fog: [222, 170, 146],
    g: { expo: 1.05, temp: 0.85, sat: 1.18, vert: 0.35, contrast: 1.1, lift: [0.02, 0.01, 0.04], gain: [1.08, 0.98, 0.86], vig: 0.24 } },
  { he: 20, zen: [58, 58, 108], sun: [0.86, 0.46, 0.46], sunI: 0.34, sky: [0.52, 0.52, 0.76], skyI: 0.6, fog: [118, 100, 128],
    g: { expo: 1.06, temp: 0.05, sat: 0.78, vert: 0.45, contrast: 0.98, lift: [0.01, 0.01, 0.05], gain: [1.03, 0.97, 0.98], vig: 0.32 } },
  { he: 21, zen: [16, 22, 44], sun: [0.42, 0.48, 0.74], sunI: 0.12, sky: [0.36, 0.43, 0.72], skyI: 0.42, fog: [38, 48, 78],
    g: { expo: 1.1, temp: -0.6, sat: 0.55, vert: 0.5, contrast: 0.95, lift: [0.0, 0.012, 0.05], gain: [0.94, 0.98, 1.06], vig: 0.42 } },
  { he: 22, zen: [12, 18, 38], sun: [0.42, 0.48, 0.74], sunI: 0.1, sky: [0.34, 0.41, 0.7], skyI: 0.4, fog: [34, 44, 72],
    g: { expo: 1.1, temp: -0.6, sat: 0.52, vert: 0.5, contrast: 0.95, lift: [0.0, 0.012, 0.05], gain: [0.94, 0.98, 1.06], vig: 0.45 } },
];
// la brume à midi par beau temps : la couleur du ciel de chaque météo y est ramenée à l'heure

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
      return { he, sun: lerp3(a.sun, b.sun, t), sunI: lerp(a.sunI, b.sunI, t), sky: lerp3(a.sky, b.sky, t), skyI: lerp(a.skyI, b.skyI, t), fog: lerp3(a.fog, b.fog, t), zen: lerp3(a.zen, b.zen, t), g: lerpG(a.g, b.g, t) };
    }
  }
  return T[T.length - 1];
}
