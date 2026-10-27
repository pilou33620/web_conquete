// Banc du rejeu de la peinture (rejeu.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les plans des villes et l'intérieur se peignent une fois en s'enregistrant, puis se rejouent
// nets, par tuiles, de près (dans un worker, peintre-tuiles.js). Le rejeu doit dessiner ce qui touche la fenêtre, avec
// les bonnes couleurs, et rien d'autre ; les tranches de la texture, tout, dans l'ordre.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { enregistrer, rejouer, rejouerTout } = await import('../web/js/carte/rejeu.js');

// un contexte qui ne dessine rien mais note les appels ; ses réglages sont des accesseurs, comme ceux d'un canevas
class Faux {
  constructor() { this.journal = []; this.r = {}; }
}
for (const k of ['save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'roundRect', 'closePath', 'fill', 'stroke', 'fillRect', 'setLineDash'])
  Faux.prototype[k] = function (...a) { this.journal.push([k, ...a]); };
for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'globalAlpha'])
  Object.defineProperty(Faux.prototype, k, { get() { return this.r[k] ?? (k === 'lineWidth' ? 1 : null); }, set(v) { this.r[k] = v; this.journal.push(['=' + k, v]); } });

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

test('rejeu : un tracé de plusieurs taches ne rejoue que celles de la fenêtre ; les tranches rejouent tout, dans l’ordre', () => {
  const f = new Faux(), [g, fin, tranche] = enregistrer(f), T = [];
  g.fillStyle = 'brun'; g.beginPath();
  for (const x of [0, 300, 600]) { g.moveTo(x + 2, 0); g.arc(x, 0, 2, 0, 7); }
  g.fill(); T.push(tranche());
  g.lineWidth = 3; g.strokeStyle = 'noir'; g.beginPath(); g.moveTo(0, 50); g.lineTo(9, 50); g.moveTo(300, 50); g.lineTo(309, 50); g.stroke(); T.push(tranche());
  const h = new Faux(); rejouer(h, fin(), 290, -10, 320, 60);
  assert.deepEqual(h.journal.filter(o => o[0] === 'arc').map(o => o[1]), [300], 'des trois taches, celle de la fenêtre');
  assert.deepEqual(h.journal.filter(o => o[0] === 'moveTo').map(o => o[1]), [302, 300], 'et du trait, son morceau');
  const t = new Faux(), txt = [], img = [];
  for (const x of T) { txt.push(...x.txt); rejouerTout(t, x, txt, img); }
  assert.deepEqual(t.journal, f.journal, 'les tranches rejouent tous les appels, dans l’ordre');
});

