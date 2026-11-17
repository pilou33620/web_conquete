// Outils partagés par la carte de campagne et l'interface : uniformes d'époque, nombres, texte échappé, couleurs.

// modèle de pièce d'une batterie selon sa génération d'armes (rules.ARMS['artillerie'] ; SPEC-TECH.md)
export const GUN_MODELS = ['ancien', 'ancien', 'gribeauval', 'valee', 'lahitte', 'bange', '75'];
// uniformes français d'époque (SPEC-3D.md, étape 8) : habit et culotte selon l'année de la bataille, l'arme et le
// régiment (dragons en vert de 1760 à 1860) ; le camp, lui, se lit aux revers. Gris-blanc sous
// Louis XIV, bleu national puis impérial, capote bleu foncé en 1870 ; pantalon garance dès 1829 ; artillerie bleu foncé
// (culotte bleue comprise, après 1760)
export function uniform(year, cls, name = '', kind = '') {
  const y = year || 1790, capote = y >= 1860;
  if (kind === 'milice') return { coat: '#7a6248', trous: '#5a4c3c' };
  const trous = y >= 1829 ? '#9e2b28' : cls === 'cavalerie' ? '#e8dcc0' : y < 1760 ? '#d9d3c3' : '#f3efe4';
  if (cls === 'artillerie') return { coat: '#1f2946', trous: y >= 1760 ? '#1f2946' : trous };
  if (cls === 'cavalerie' && !capote && y >= 1760 && /dragon/i.test(name)) return { coat: '#2f5b3d', trous };
  return { coat: y < 1760 ? '#d9d3c3' : y < 1805 ? '#2b3d7a' : !capote ? '#25366c' : '#2b3552', trous };
}

// nombres à la française
export const fmt = n => (Math.round(n) || 0).toLocaleString('fr-FR').replace(/^-/, '−');
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// vue cavalière : le sol est vu un peu de biais, les profondeurs (y) sont écrasées à l'écran
export const TILT = 0.8;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const TAU = Math.PI * 2;
// couleurs : « #rrggbb » → [r, g, b], [r, g, b] → « rgba(…) », mélange de deux couleurs (t = 0 : a, 1 : b)
export function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbStr(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
export function mixHex(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbStr([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
// lumière du soleil : elle vient du nord-ouest (en haut à gauche de l'écran) ; une chose haute de h mètres jette
// son ombre au sol jusqu'à (h × OMBRE[0], h × OMBRE[1]) mètres, vers le sud-est. Terrain, figurines et relief
// suivent la même lumière.
export const OMBRE = [0.62, 0.42];
