// Vue tactique : la bibliothèque des sols photo (étape 9b). Huit sols CC0 d'ambientCG (web/textures/sols/,
// LICENCE.txt) : pré, herbe sèche, lande, terre, chemin, route empierrée, sable, roche. Ils ne donnent pas la couleur
// du sol (c'est toujours la peinture de terrain.js : palette de la saison, parcelles, routes, eau, mini-carte) mais sa
// matière : touffes, mottes, cailloux, et leur relief fin qui accroche la lumière. relief.js les mêle selon les
// masques de terrain.js (solMask).
// Deux textures en tableau (une seule lecture pour huit sols) : couleur et hauteur (dans l'alpha), normales. 1024 px
// en Haute et Ultra, 512 en Basse et Moyenne (qualite.js, sols).
import * as THREE from '../../vendor/three/three.module.js';

// l'ordre des couches : celui des canaux des masques (terrain.js, solMask)
export const SOLS = ['pre', 'sec', 'lande', 'terre', 'chemin', 'route', 'sable', 'roche'];
// force de la matière de chaque sol (0 : la peinture seule) : l'herbe peinte a déjà ses nuances, la roche n'a qu'elle
export const FORCE = [0.75, 0.8, 0.85, 0.9, 0.85, 0.9, 0.7, 1.0];

const DIR = new URL('../../textures/sols/', import.meta.url).href;
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

function image(url) {
  return new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ko(new Error(url)); im.src = url; });
}
// pixels d'une image redimensionnée à n × n
function pixels(im, n, cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, n, n); g.drawImage(im, 0, 0, n, n);
  return g.getImageData(0, 0, n, n).data;
}

// charge les huit sols à n px ; null si une image manque (le sol reste alors peint seul, comme avant)
export async function chargerSols(n = 1024) {
  try {
    const ims = await Promise.all(SOLS.flatMap(s => ['couleur', 'normale', 'hauteur'].map(k => image(`${DIR}${s}_${k}.jpg`))));
    const L = SOLS.length, px = n * n, alb = new Uint8Array(px * 4 * L), nor = new Uint8Array(px * 4 * L), mean = [];
    const cv = document.createElement('canvas'); cv.width = cv.height = n;
    for (let l = 0; l < L; l++) {
      const c = pixels(ims[l * 3], n, cv), h = pixels(ims[l * 3 + 2], n, cv);
      const o = px * 4 * l;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < px * 4; k += 4) {
        alb[o + k] = c[k]; alb[o + k + 1] = c[k + 1]; alb[o + k + 2] = c[k + 2]; alb[o + k + 3] = h[k];
        if ((k & 60) === 0) { r += lin(c[k]); g += lin(c[k + 1]); b += lin(c[k + 2]); }   // (un pixel sur 16 suffit)
      }
      const m = px / 16; mean.push(new THREE.Vector3(r / m, g / m, b / m));
      nor.set(pixels(ims[l * 3 + 1], n, cv), o);
    }
    cv.width = cv.height = 0;   // (Safari garde sinon la mémoire du canevas)
    const tex = (data, srgb) => {
      const t = new THREE.DataArrayTexture(data, n, n, L);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.anisotropy = 4;
      // une fois sur la carte graphique, les pixels ne servent plus (32 Mo par texture en 1024 px) ; si Safari perd le
      // contexte WebGL, la vue recharge les sols
      t.onUpdate = () => { t.image.data = null; };
      t.needsUpdate = true;
      return t;
    };
    return { n, albedo: tex(alb, true), normales: tex(nor, false), mean, dispose() { this.albedo.dispose(); this.normales.dispose(); } };
  } catch (e) {
    console.warn('Sols photo indisponibles :', e.message);
    return null;
  }
}
