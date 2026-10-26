// Banc de l'échelle réelle (SPEC-CARTE-2D.md, « Livré — échelle réelle ») : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les figures (gens, chevaux, charrettes, bateaux) se dessinent dans leur propre unité, posée
// sur le plan par un facteur ; un facteur oublié ou une figure dessinée dans une autre unité ne fait rien planter, mais
// rend les gens grands comme des maisons (avant ce lot, un passant de l'intérieur faisait 24 m). On mesure donc ce que
// chaque figure dessine vraiment, en mètres du monde. Et le plan rejoué de près (rejeu.js) doit dessiner ce qui touche
// la fenêtre, avec les bonnes couleurs, et rien d'autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { enregistrer, rejouer } = await import('../web/js/carte/rejeu.js');
const { fantassin, cheval, tenue } = await import('../web/js/carte/lib.js');
const { navire, S } = await import('../web/js/carte/villes.js');
const { charrette, ECH, NAV } = await import('../web/js/carte/interieur.js');

// un contexte qui ne dessine rien mais note les appels ; ses réglages sont des accesseurs, comme ceux d'un canevas
class Faux {
  constructor() { this.journal = []; this.r = {}; }
}
for (const k of ['save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'roundRect', 'closePath', 'fill', 'stroke', 'fillRect', 'setLineDash'])
  Faux.prototype[k] = function (...a) { this.journal.push([k, ...a]); };
for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'globalAlpha'])
  Object.defineProperty(Faux.prototype, k, { get() { return this.r[k] ?? (k === 'lineWidth' ? 1 : null); }, set(v) { this.r[k] = v; this.journal.push(['=' + k, v]); } });

// l'étendue de ce que dessine f, en unités de figure : [x0, y0, x1, y1]
function etendue(f) {
  const [g, fin] = enregistrer(new Faux()); f(g);
  const { BX } = fin(), e = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < BX.length; i += 6) if (Number.isFinite(BX[i]) && Number.isFinite(BX[i + 2])) { e[0] = Math.min(e[0], BX[i]); e[1] = Math.min(e[1], BX[i + 1]); e[2] = Math.max(e[2], BX[i + 2]); e[3] = Math.max(e[3], BX[i + 3]); }
  return e;
}
const metres = u => u * ECH * 1000 / S;   // unités de figure → unités du plan → mètres
const proche = (v, vrai, nom) => assert.ok(Math.abs(v / vrai - 1) < 0.3, `${nom} : ${v.toFixed(2)} m au lieu d'environ ${vrai} m`);

test('vue de l’intérieur : gens, chevaux, charrettes et bateaux à leur vraie taille (à 30 % près)', () => {
  const L = tenue('fr', 'civil');
  const p = etendue(g => fantassin(g, L, { role: 'h' }, { legs: 0, arme: 'aucun' }));
  proche(metres(p[3] - p[1]), 0.6, 'largeur d’épaules d’un passant');
  const c = etendue(g => cheval(g, '#6b4a2c', { gait: 0, bob: 0 }));
  proche(metres(c[2] - c[0]), 2.4, 'longueur d’un cheval');
  const a = etendue(g => charrette(g, 0));
  proche(metres(a[2] - a[0] - (c[2] - c[0])), 3.2, 'longueur de la charrette (sans le cheval)');
  proche(metres(a[3] - a[1]), 1.8, 'largeur de la charrette (roues comprises)');
  const n = etendue(g => navire(g, 0, 0, 0, false));
  proche(metres((n[2] - n[0]) * NAV), 20, 'longueur d’une gabare');
});

test('rejeu : seul ce qui touche la fenêtre se rejoue, avec ses réglages', () => {
  const [g, fin] = enregistrer(new Faux());
  g.fillStyle = 'rouge'; g.fillRect(0, 0, 10, 10);
  g.save(); g.translate(500, 0); g.fillStyle = 'bleu'; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill(); g.restore();
  g.fillStyle = 'vert';
  for (let i = 0; i < 100; i++) { g.beginPath(); g.rect(1000 + i, 1000, 1, 1); g.fill(); }   // (des morceaux entiers à sauter)
  g.strokeStyle = 'noir'; g.lineWidth = 2; g.beginPath(); g.moveTo(-100, 5); g.lineTo(0, 5); g.lineTo(100, 5); g.lineTo(600, 5); g.stroke();
  g.beginPath(); g.rect(4, 4, 1, 1); g.fill();
  const R = fin(), vers = (x0, y0, x1, y1) => { const h = new Faux(); rejouer(h, R, x0, y0, x1, y1); return h.journal; };
  const j = vers(-2, -2, 20, 20), noms = j.map(o => o[0]);
  assert.deepEqual(j.filter(o => o[0] === 'fillRect'), [['fillRect', 0, 0, 10, 10]]);
  assert.ok(!noms.includes('arc'), 'le disque à x = 500 est hors de la fenêtre');
  assert.equal(j.filter(o => o[0] === 'rect').length, 1, 'des carrés verts, seul celui de la fenêtre');
  assert.equal(j.findLast(o => o[0] === '=fillStyle')[1], 'vert', 'la couleur posée avant le dernier carré');
  assert.deepEqual(j.filter(o => o[0] === 'lineTo').map(o => o[1]), [0, 100], 'du long trait, les segments de la fenêtre seulement');
  assert.ok(noms.indexOf('save') < noms.indexOf('translate') && noms.includes('restore'), 'le repère se rejoue toujours');
  assert.ok(vers(495, -5, 505, 5).some(o => o[0] === 'arc'), 'le disque se rejoue dans sa fenêtre');
});
