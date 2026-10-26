// Peintre des tuiles de l'intérieur (worker) : rejoue sur une tuile, à sa résolution, l'enregistrement de la peinture
// d'une ville (rejeu.js), hors du fil principal. Il reçoit l'enregistrement une fois ({ id, rec }), puis des demandes
// ({ id, cle, r, i, j, T } : la tuile (i, j) de T pixels à r pixels par unité) ; il rend { cle, bmp }.
import { rejouer } from './rejeu.js';

const RECS = new Map();   // les deux derniers enregistrements
globalThis.onmessage = ({ data: d }) => {
  if (d.rec) { RECS.set(d.id, d.rec); while (RECS.size > 2) RECS.delete(RECS.keys().next().value); return; }
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
