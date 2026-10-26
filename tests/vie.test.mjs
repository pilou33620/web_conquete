// Banc de la vie des pays (web/js/carte/vie.js, SPEC-CARTE-2D.md chantier C) : node --test tests/
//
// POURQUOI CE BANC EXISTE. La vie de la carte est tirée de la carte elle-même : la même route a les mêmes passants,
// le même pré les mêmes vaches, d'une image à l'autre et d'une partie à l'autre. Un Math.random glissé dans un tirage
// ferait sauter les figures à chaque image sans que rien ne plante. Et la densité doit suivre l'état de la partie :
// personne autour d'un siège ou d'une bataille, moins de monde la nuit, dans les places affamées ou malades.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// un contexte de dessin qui ne dessine rien et note où chaque figure est posée
function contexte(journal) {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'setTransform') return (...a) => journal && journal.push(a.map(v => +v.toFixed(6)).join(','));
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'getContext') return () => contexte(null);
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return contexte(null); } };
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} };
const { AMB, setHeure } = await import('../web/js/carte/ambiance.js');
const V = await import('../web/js/carte/vie.js');

// une petite carte : plaine, un bois, un marais, une lande ; trois bourgs reliés par deux routes (une royale)
function carte() {
  const W = 40, H = 30, terrain = new Uint8Array(W * H).fill(2), cellnode = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (i < 3) terrain[c] = 0; else if (i < 12 && j < 10) terrain[c] = 3; else if (i > 30) terrain[c] = 4; else if (j > 24) terrain[c] = 5;
    cellnode[c] = i < 14 ? 0 : i < 27 ? 1 : 2;
  }
  const nodes = [
    { id: 0, name: 'Aval', x: 8, y: 15, type: 'ville', dept: '33', pop0: 4000 },
    { id: 1, name: 'Milieu', x: 20, y: 15, type: 'village', dept: '33', pop0: 600 },
    { id: 2, name: 'Amont', x: 34, y: 15, type: 'capitale', dept: '33', pop0: 30000 },
  ];
  const edges = [
    { id: 0, a: 0, b: 1, royal: true, pts: [[8, 15], [14, 14.5], [20, 15]] },
    { id: 1, a: 1, b: 2, royal: false, pts: [[20, 15], [27, 16], [34, 15]] },
  ];
  return { W, H, terrain, cellnode, nodes, edges, m: { rivers: [], ways: [], waters: [], x_cote: -100, y_mont: 1e9 } };
}
const etat = (o = {}) => ({
  me: { code: '33', famine: false, ...o.me },
  nodes: [{ id: 0, o: '33' }, { id: 1, o: '40' }, { id: 2, o: '33' }].map(n => ({ ...n, ...(o.nodes?.[n.id] || {}) })),
  battles: o.battles || [],
});
// la scène, comme la monte ambient.js
const scene = (z, t) => ({
  fx: [], max: 400, ventA: 0, z, d: 1, m: z, cx: 20, cy: 15, W: 1280, H: 800, cssW: 1280, cssH: 800, time: t, on: false,
  monde(g) { const m = this.m; g.setTransform(m, 0, 0, m, -this.cx * m + this.W / 2, -this.cy * m + this.H / 2); },
  fig(g, x, y, a) { const m = this.m, c = Math.cos(a) * m, s = Math.sin(a) * m; g.setTransform(c, s, -s, c, (x - this.cx) * m + this.W / 2, (y - this.cy) * m + this.H / 2); },
});
const dessin = (t, saison = 'ete') => {
  AMB.saison = saison; const j = [], sc = scene(600, t);   // (de près : à la vraie taille, les charrettes font 3 px, les gens moins d'un)
  V.dessinerSol(sc, contexte(j), 0, 0, 40, 30, null); V.dessinerDessus(sc, contexte(j), 0, 0, 40, 30);
  return j;
};

test('mêmes gens, mêmes bêtes, au même endroit : le tirage ne dépend que de la carte et de l’heure', () => {
  setHeure('midi');
  V.preparer(carte()); V.majEtat(etat());
  const a = dessin(12.5), relais = JSON.stringify(V.VIE.relais), moulins = JSON.stringify(V.VIE.moulins);
  assert.ok(a.length > 200, `assez de figures posées (${a.length})`);
  V.preparer(carte()); V.majEtat(etat());
  assert.deepEqual(dessin(12.5), a, 'deux préparations, deux images au même instant : identiques');
  assert.equal(JSON.stringify(V.VIE.relais), relais); assert.equal(JSON.stringify(V.VIE.moulins), moulins);
  assert.notDeepEqual(dessin(14), a, 'et ça bouge avec le temps');
});

test('les saisons changent les travaux et les bêtes', () => {
  V.preparer(carte()); V.majEtat(etat());
  const n = Object.fromEntries(['printemps', 'ete', 'automne', 'hiver'].map(s => [s, dessin(3, s).length]));
  assert.ok(n.hiver < n.ete, `l’hiver, moins de monde dehors (${JSON.stringify(n)})`);
});

test('la densité suit l’heure, la météo et l’état de la partie', () => {
  V.preparer(carte());
  V.majEtat(etat()); setHeure('midi'); AMB.meteo.interieur = 'soleil';
  assert.equal(V.densite(20, 15), 1);
  setHeure('nuit'); assert.ok(V.densite(20, 15) < 0.2, 'la nuit, presque personne');
  setHeure('soir'); assert.ok(V.densite(20, 15) < 1 && V.densite(20, 15) > 0.2);
  setHeure('midi'); AMB.meteo.interieur = 'orage'; assert.ok(V.densite(20, 15) < 0.5, 'l’orage garde les gens chez eux');
  AMB.meteo.interieur = 'soleil';
  // un siège : la campagne autour de la place se vide, pas plus loin
  V.majEtat(etat({ nodes: { 1: { sg: { by: '40', dmg: 0.3 } } } }));
  assert.ok(V.densite(20, 15) < 0.1 && V.densite(22, 17) < 0.1, 'autour du siège');
  assert.equal(V.densite(34, 15), 1, 'loin du siège');
  // une bataille
  V.majEtat(etat({ battles: [{ x: 34, y: 15, phase: 'combat', sides: [] }] }));
  assert.ok(V.densite(33, 14) < 0.11); assert.equal(V.densite(8, 15), 1);
  // famine : seulement dans les places du joueur ; épidémie et disette : dans la place touchée
  V.majEtat(etat({ me: { famine: true } }));
  assert.ok(V.densite(8, 15) < 0.5 && V.densite(34, 15) < 0.5, 'places du joueur affamées');
  assert.equal(V.densite(20, 15), 1, 'la place d’un autre camp ne l’est pas');
  V.majEtat(etat({ nodes: { 2: { lv: ['epidemie', 4] }, 0: { lv: ['disette', 10] } } }));
  assert.ok(V.densite(34, 15) < 0.3 && V.densite(8, 15) < 0.4 && V.densite(20, 15) === 1);
  // une règle de plus (chantier D : devant une armée ennemie)
  V.ajouterDensite((x, y) => (Math.hypot(x - 20, y - 15) < 2 ? 0.35 : 1));
  assert.equal(V.densite(20, 15), 0.35);
});

test('brigands, marchés et foires viennent de l’état', () => {
  V.preparer(carte());
  V.majEtat(etat());
  assert.equal(V.VIE.brigands.length, 0); assert.equal(V.VIE.marches.length, 0); assert.equal(V.VIE.foires.length, 0);
  V.majEtat(etat({ nodes: { 1: { lv: ['brigands', 3] }, 2: { sl: [['marche', 1]] }, 0: { lv: ['foire', 2], sl: [['marche', 0]] } } }));
  assert.ok(V.VIE.brigands.length >= 2, 'des bandes sur les deux routes du bourg');
  assert.deepEqual(V.VIE.marches.map(m => m.n.id), [2], 'marché là où le commerce est bâti (niveau ≥ 1)');
  assert.deepEqual(V.VIE.foires.map(f => f.n.id), [0]);
  const f = V.VIE.foires[0];
  assert.ok(Math.hypot(f.x - 8, f.y - 15) > V.rayonPlace(V.VIE.foires[0].n), 'la foire se tient hors les murs');
  assert.ok(V.VIE.foireRoutes.has(0), 'les routes autour de la foire sont plus passantes');
});
