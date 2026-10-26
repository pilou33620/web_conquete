// Peintre des tuiles de l'intérieur (worker) : rejoue sur une tuile, à sa résolution, l'enregistrement de la peinture
// d'une ville (rejeu.js), hors du fil principal. Il reçoit l'enregistrement une fois ({ id, rec }), puis des demandes
// ({ id, cle, r, i, j, T } : la tuile (i, j) de T pixels à r pixels par unité) ; il rend { cle, bmp }.
// Il peint aussi la texture d'une ville à mesure qu'elle s'enregistre ({ id, tex, W, H, k, fin } : une tranche à rejouer
// telle quelle) et la rend ({ cle: 'tex|id|n', bmp, fin }) tous les quarts de seconde, puis finie.
import { rejouer, rejouerTout } from './rejeu.js';

const RECS = new Map();   // les derniers enregistrements (deux intérieurs, ou six plans de la carte)
let TEX = null, n = 0;   // la texture en cours
globalThis.onmessage = ({ data: d }) => {
  if (d.tex) {
    try {
      if (TEX?.id !== d.id) { if (TEX) TEX.c.width = TEX.c.height = 0; TEX = { id: d.id, c: new OffscreenCanvas(d.W, d.H), txt: [], img: [], t: performance.now() }; TEX.g = TEX.c.getContext('2d'); TEX.g.setTransform(d.k, 0, 0, d.k, 0, 0); }
      const T = TEX; T.txt.push(...d.tex.txt); T.img.push(...d.tex.img); rejouerTout(T.g, d.tex, T.txt, T.img);
      if (d.fin || performance.now() - T.t > 250) { T.t = performance.now(); const cle = `tex|${d.id}|${++n}`; createImageBitmap(T.c).then(bmp => { if (d.fin) T.c.width = T.c.height = 0; postMessage({ cle, bmp, fin: d.fin }, [bmp]); }).catch(() => postMessage({ cle: `tex|${d.id}|0`, ko: true })); if (d.fin) TEX = null; }
    } catch (e) { postMessage({ cle: `tex|${d.id}|0`, ko: true }); }
    return;
  }
  if (d.rec) { RECS.set(d.id, d.rec); while (RECS.size > (d.n || 2)) RECS.delete(RECS.keys().next().value); return; }   // (n : la carte en garde seize, ses places)
  const R = RECS.get(d.id);
  if (!R) { postMessage({ cle: d.cle }); return; }
  try {
    const c = new OffscreenCanvas(d.T, d.T), g = c.getContext('2d'), u = d.T / d.r;
    g.setTransform(d.r, 0, 0, d.r, -d.i * d.T, -d.j * d.T);
    rejouer(g, R, d.i * u, d.j * u, (d.i + 1) * u, (d.j + 1) * u);
    const bmp = c.transferToImageBitmap();
    postMessage({ cle: d.cle, bmp }, [bmp]);
  } catch (e) { postMessage({ cle: d.cle, ko: true }); }   // (pas de canevas 2D dans un worker : la vue peint elle-même)
};
