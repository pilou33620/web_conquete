// Banc du sol à plat (web/js/battle/sol2d.js, pietinement.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le sol est découpé en tuiles gardées en mémoire : sans borne, un iPad (Safari ne laisse
// qu'environ 384 Mo aux canevas d'une page) fermerait la page après quelques minutes de défilement. Un tué ou un
// cratère doit être peint dans les tuiles qu'il touche, et seulement celles-là, et rester dans celles peintes plus tard.
// La boue est enregistrée avec la bataille : sa carte réduite doit se relire à l'identique (ligne 0 au nord), sinon une
// bataille rechargée perdrait ses traces ou les verrait retournées.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// faux canevas : un contexte qui accepte tout et note les tracés de paintDecal (translate) et les drawImage
function fauxCanevas(w = 1, h = 1) {
  const cv = { width: w, height: h, log: [] };
  const ctx = new Proxy({ canvas: cv }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'translate' || k === 'drawImage') return (...a) => cv.log.push([k, ...a]);
      if (k === 'getImageData' || k === 'createImageData') return (w2, h2) => ({ data: new Uint8ClampedArray(w2 * h2 * 4) });
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  cv.getContext = () => ctx;
  return cv;
}
globalThis.document = { createElement: () => fauxCanevas() };

const { Sol2D, TS } = await import('../web/js/battle/sol2d.js');
const { Pietinement } = await import('../web/js/battle/pietinement.js');

// faux terrain : ce que Sol2D en lit
const terrain = () => ({
  W: 3000, H: 2000, base: fauxCanevas(1500, 1000), painted: 0,
  setQuality() {}, bare: () => true,
  paintInto(cv, x0, y0, wm, hm, s) { this.painted++; cv.log.length = 0; cv.zone = [x0, y0, wm, hm, s]; },
});
const vue = (x, y, z, vw = 1280, vh = 800) => ({ z, dpr: 1, vw, vh, cam: { x, y, z } });
const remplir = (sol, v) => { let n = 0; while (sol.draw(fauxCanevas().getContext(), v) && n < 1000) n++; };

test('niveaux : la puissance de deux la plus proche, bornée par la qualité ; l’image entière de loin', () => {
  const sol = new Sol2D(terrain(), { level: 8, textures: 8e6 });
  assert.equal(sol.niveau(0.3), 0);
  assert.equal(sol.niveau(1.3), 1);
  assert.equal(sol.niveau(3), 4);
  assert.equal(sol.niveau(40), 8);
});

test('la mémoire des tuiles reste bornée, jamais au détriment de l’image en cours', () => {
  const sol = new Sol2D(terrain(), { level: 16, textures: 8e6 });   // Basse : 24 Mo (24 tuiles)
  const cap = sol.max / (TS * TS * 4);
  for (let k = 0; k < 40; k++) {
    remplir(sol, vue(100 + k * 70, 300 + (k % 5) * 300, [1, 2, 3, 6][k % 4]));
    assert.ok(sol.tiles.size <= Math.max(cap, 12), `${sol.tiles.size} tuiles`);
  }
  // un écran plus grand que la borne : ses tuiles restent toutes (dépassement passager)
  const v = vue(1500, 1000, 6, 2732, 2048);
  remplir(sol, v);
  const vues = sol.tiles.size;
  assert.ok(vues > cap);
  assert.equal(sol.draw(fauxCanevas().getContext(), v), 0, 'rien à repeindre');
});

test('une tuile qui manque : repli sur une tuile plus grossière, quelques tuiles peintes par image', () => {
  const t = terrain(), sol = new Sol2D(t, { level: 16, textures: 32e6 });
  remplir(sol, vue(1500, 1000, 2));          // niveau 2
  t.paintInto = function (cv, x0, y0, wm, hm, s) { const a = performance.now(); while (performance.now() - a < 3); this.painted++; cv.log.length = 0; cv.zone = [x0, y0, wm, hm, s]; };
  const g = fauxCanevas().getContext();
  const left = sol.draw(g, vue(1500, 1000, 4));   // niveau 4 : pas encore peint
  assert.ok(left > 0);
  const replis = g.canvas.log.filter(c => c[0] === 'drawImage' && c[1].zone?.[4] === 2 && c.length === 10);
  assert.ok(replis.length > 0, 'des morceaux de tuiles du niveau 2');
});

test('stamp peint dans les tuiles touchées et seulement celles-là ; gardé pour les tuiles à venir', () => {
  const t = terrain(), sol = new Sol2D(t, { level: 16, textures: 32e6 });
  remplir(sol, vue(1500, 1000, 2));          // tuiles de 256 m
  const d = { k: 'corps', x: 1536 + 1, y: 1024 + 100, c: '#336' };   // juste à droite du bord x = 1536
  sol.stamp([d]);
  const touchees = [...sol.tiles.values()].filter(e => e.cv.log.some(c => c[0] === 'translate' && c[1] === d.x));
  assert.deepEqual(touchees.map(e => [e.i, e.j]).sort(), [[5, 4], [6, 4]], 'la tuile du point et sa voisine (le tué déborde)');
  // une tuile d'un autre niveau peinte plus tard reçoit le tué
  remplir(sol, vue(1540, 1124, 8));
  const fine = [...sol.tiles.values()].find(e => e.L === 8 && e.cv.zone[0] <= d.x && d.x < e.cv.zone[0] + TS / 8 && e.cv.zone[1] <= d.y && d.y < e.cv.zone[1] + TS / 8);
  assert.ok(fine.cv.log.some(c => c[0] === 'translate' && c[1] === d.x));
  // un cratère va aussi dans l'image entière ; le sol couvert (bare) n'en reçoit pas
  sol.stamp([{ k: 'trou', x: 200, y: 200, r: 3 }]);
  assert.ok(t.base.log.some(c => c[0] === 'translate' && c[1] === 200));
  t.bare = () => false;
  assert.equal(sol.stamp([{ k: 'trou', x: 300, y: 300 }]).length, 0);
});

test('invalidate : les tuiles du cercle seront repeintes, les autres restent', () => {
  const t = terrain(), sol = new Sol2D(t, { level: 16, textures: 32e6 });
  remplir(sol, vue(1500, 1000, 2));
  const avant = sol.tiles.size;
  sol.invalidate(1600, 1100, 30);            // dans la tuile (6, 4)
  assert.equal(sol.tiles.size, avant - 1);
  assert.ok(!sol.tiles.has('2|6|4'));
  const n = t.painted;
  remplir(sol, vue(1500, 1000, 2));
  assert.equal(t.painted, n + 1);
});

test('piétinement : la carte réduite se relit (ligne 0 au nord), les traces au bon endroit', () => {
  const a = new Pietinement(3000, 2000, { fx: 2 });
  const cav = { cls: 'cavalerie', men: 500, state: 'charge', x: 600, y: 300, dir: 0, w: 80, d: 80, from: { x: 0, y: 0 }, to: { x: 8, y: 0 } };
  for (let k = 0; k < 40; k++) a.update([cav], 1, false, 0.25, 1);
  a.stamp(2500, 1700, 4); a.update([], 1, false, 0.25, 1);
  const { px, w, h } = a.petite();
  assert.equal(w, 256); assert.equal(h, Math.round(256 * 2000 / 3000));
  const at = (x, y) => px[Math.floor(y / 2000 * h) * w + Math.floor(x / 3000 * w)];
  assert.ok(at(600, 300) > 150, `boue sous la charge : ${at(600, 300)}`);
  assert.ok(at(2500, 1700) > 0 && at(600, 1700) === 0 && at(2500, 300) === 0);
  const b = new Pietinement(3000, 2000, { fx: 2 });
  b.depuis(px, w, h);
  const again = b.petite().px;
  // (relue, la carte est adoucie : un peu d'écart sur les bords nets, presque rien en moyenne)
  let e = 0, s = 0; for (let i = 0; i < px.length; i++) { e = Math.max(e, Math.abs(px[i] - again[i])); s += Math.abs(px[i] - again[i]); }
  assert.ok(e <= 80 && s / px.length < 1, `écart ${e}, moyen ${(s / px.length).toFixed(2)}`);
  assert.ok(Math.abs(b.m[Math.floor(300 / 3) * b.w + 200] - a.m[Math.floor(300 / 3) * a.w + 200]) < 0.2);
});
