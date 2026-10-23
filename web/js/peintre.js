// Peintre de tuiles (worker) : les tuiles détaillées de la carte de campagne, peintes par le processeur hors du fil
// principal, avec le code même de la carte (map.js renderTile). Il reçoit la carte une fois (init), son état à chaque
// changement (state : époque, saison, territoires, images de fond), puis des demandes de tuiles.
import { MapView, lineChunks } from './map.js';
import { Epoque } from './epoque.js';

let p = null, ready = false;
globalThis.onmessage = ({ data: d }) => {
  if (d.init) {
    try {
      // (en mémoire ordinaire : le processeur peint, la carte graphique n'a plus qu'à afficher l'image finie)
      p = Object.assign(Object.create(MapView.prototype), d.init, { pool: [], tileCtx: { willReadFrequently: true } });
      p.epoque = new Epoque(p);
      p.prepEdges(); p.buildLandPath();
      postMessage({ ready: !!new OffscreenCanvas(1, 1).getContext('2d') });
    } catch (e) { postMessage({ ready: false }); }
    return;
  }
  if (d.state) {
    const { marks, year, frontiers, ...s } = d.state;
    Object.assign(p, s);
    p.epoque.year = year;
    p.epoque.marks = Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, new Set(v)]));
    p.frontiers = frontiers.map(f => ({ code: f.code, parts: lineChunks(f.lines) }));
    ready = true;
    return;
  }
  // (sans état reçu, ou si la peinture échoue : réponse vide, la carte redemandera la tuile)
  if (!ready) { postMessage({ key: d.key, gen: -1 }); return; }
  try {
    const cv = p.renderTile(d.L, d.tx, d.ty), bmp = cv.transferToImageBitmap();
    p.pool.push(cv);
    postMessage({ key: d.key, gen: p.tileGen, bmp }, [bmp]);
  } catch (e) { postMessage({ key: d.key, gen: -1 }); }
};
