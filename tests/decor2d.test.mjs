// Décor de la vue de dessus (web/js/battle/decor2d.js, SPEC-2D § 3 et 4) : node --test tests/decor2d.test.mjs
// Sans navigateur : un faux canevas 2D (chaque appel est noté) et un petit terrain fait à la main. On vérifie que les
// bâtiments sont déduits des cases bâties quand la carte n'en donne pas, que la gare et les immeubles haussmanniens
// attendent leur date, que les toits suivent la région, que les états reçus du serveur (touché, en feu, en ruine) se
// voient, que le feuillage s'ouvre au-dessus des hommes, que les brèches refont l'enceinte, et que les bêtes fuient.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from '../web/js/battle/formes.js';

// ---------- faux canevas
function contexte() {
  const appels = [];
  return new Proxy({ appels }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData' || k === 'createImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => { appels.push(k); };
    },
    set(o, k, v) { o[k] = v; if (k === 'globalCompositeOperation') appels.push('gco:' + v); return true; },
  });
}
globalThis.document = { createElement: () => { const g = contexte(); return { width: 0, height: 0, getContext: () => g }; } };
globalThis.Path2D = class { rect() {} moveTo() {} lineTo() {} arc() {} closePath() {} };
const { Decor2D, contree, toitDe } = await import('../web/js/battle/decor2d.js');

// ---------- terrain : un pré de 1200 × 800 m, un bourg coupé par deux rues, une maison seule, une forêt
const COLS = 60, ROWS = 40, CELL = 20;
function terrain() {
  const t = new Uint8Array(COLS * ROWS).fill(T.PRE), set = (i, j, v) => { t[j * COLS + i] = v; };
  for (let j = 14; j <= 21; j++) for (let i = 18; i <= 28; i++) set(i, j, j === 17 || i === 23 ? T.ROUTE : T.BATI);
  set(5, 30, T.BATI);
  const treeGrid = Array.from({ length: COLS * ROWS }, () => []);
  for (let j = 4; j <= 12; j++) for (let i = 40; i <= 55; i++) {
    set(i, j, T.FORET);
    for (let k = 0; k < 5; k++) treeGrid[j * COLS + i].push({ x: (i + 0.2 + k * 0.15) * CELL, y: (j + 0.5) * CELL, r: 6, ci: k % 3, kind: 'feuillu' });
  }
  return { W: COLS * CELL, H: ROWS * CELL, cell: CELL, cols: COLS, rows: ROWS, t, treeGrid, gates: [], bridges: [], fencePts: [], walls: [],
    pal: { arbres: ['#3d7a34', '#4b8a3b', '#5a9944'], pins: ['#2f6136', '#3a6d3c'] }, roadPts: [[[0, 350], [1200, 350]]] };
}
const cellule = (i, j) => j * COLS + i;
function vue(x, y, z) {
  return { z, dpr: 1, vw: 800, vh: 600, cam: { x, y }, time: 0, dt: 1 / 60, q: { fx: 2 },
    monde(g) { g.setTransform(z, 0, 0, z, 400 - x * z, 300 - y * z); },
    toScreen(px, py) { return [(px - x) * z + 400, (py - y) * z + 300, 1]; },
    visible(px, py, m = 0) { const [sx, sy] = this.toScreen(px, py); return sx > -m * z && sy > -m * z && sx < 800 + m * z && sy < 600 + m * z; } };
}
const Q = { fx: 2, level: 16, puffs: 2000 };

test('sans bâtiments ni champs nouveaux : bâtiments déduits des cases BATI, tout se dessine', () => {
  const tr = terrain(), d = new Decor2D(tr, {}, Q);
  const cles = d.batiments.map(b => b.cle);
  assert.ok(cles.includes('egliseRomane'), 'une église au milieu du bourg');
  assert.ok(cles.filter(c => c === 'ilot').length >= 30, 'les cases du bourg sont des îlots de maisons');
  const seule = d.batiments.find(b => b.cells.includes(cellule(5, 30)));
  assert.equal(seule?.cle, 'maison', 'une case isolée est une maison');
  for (let c = 0; c < tr.t.length; c++) if (tr.t[c] === T.BATI) assert.ok(d.parCase.has(c), `case bâtie ${c} sans bâtiment`);
  // les maisons des îlots s'alignent le long des rues : une case au bord de la rue a des parcelles de ce côté
  const bord = d.batiments.find(b => b.cle === 'ilot' && b.cells[0] === cellule(20, 16));
  assert.ok(bord.parcelles.some(p => p.n[1] === -1), 'rangée de maisons face à la rue du sud');
  const ctx = contexte(), v = vue(470, 350, 3);
  d.update(1 / 60); d.sous(ctx, v); d.dessus(ctx, v, []);
  assert.ok(ctx.appels.includes('drawImage'), 'les tuiles sont posées');
  d.dispose();
});

test('gare après 1840, immeubles haussmanniens après 1853 seulement', () => {
  const tr = terrain(), b = [{ x: 110, y: 610, w: 30, h: 14, a: 0, kind: 'gare' }, { x: 470, y: 270, w: 26, h: 12, a: 0, kind: 'eglise' }];
  const place = { name: 'X', x: 470, y: 350, r: 150, type: 'ville' };
  const cle = year => new Decor2D(tr, { year, buildings: b, place }, Q).batiments.find(o => o.cells.includes(cellule(5, 30))).cle;
  assert.equal(cle(1790), 'maison');
  assert.equal(cle(1839), 'maison');
  assert.equal(cle(1850), 'gare');
  const mansardes = year => new Decor2D(tr, { year, buildings: b, place }, Q).batiments.filter(o => o.cle === 'ilot').flatMap(o => o.parcelles).filter(p => p.mans).length;
  assert.equal(mansardes(1790), 0);
  assert.equal(mansardes(1852), 0);
  assert.ok(mansardes(1870) > 0, 'des combles mansardés au centre de la ville');
});

test('toits : canal au sud, ardoise au nord et en ville, chaume dans les campagnes de l\'ouest', () => {
  assert.equal(contree('plaine (13)'), 'sud');
  assert.equal(contree('bocage (29)'), 'ouest');
  assert.equal(contree('plaine (59)'), 'nord');
  assert.equal(contree('plaine (45)'), 'centre');
  assert.equal(contree(''), 'centre');
  assert.equal(toitDe('sud', true, 1800, 0.1), 'canal');
  assert.equal(toitDe('nord', false, 1800, 0.1), 'ardoise');
  assert.equal(toitDe('ouest', false, 1790, 0.1), 'chaume');
  assert.equal(toitDe('ouest', true, 1790, 0.1), 'ardoise');
  assert.equal(toitDe('ouest', false, 1910, 0.1), 'ardoise');
  assert.equal(toitDe('centre', false, 1800, 0.5), 'tuile');
  const cles = region => new Set(new Decor2D(terrain(), { region }, Q).batiments.filter(o => o.cle === 'ilot').flatMap(o => o.parcelles).map(p => p.key));
  assert.deepEqual([...cles('garrigue (13)')], ['canal']);
  assert.deepEqual([...cles('plaine (59)')], ['ardoise']);
});

test('états reçus du serveur : touché, en feu (flammes, fumée), ruine qui couve', () => {
  const tr = terrain(), d = new Decor2D(tr, {}, Q), c = cellule(20, 16), b = d.parCase.get(c)[0], v = vue(b.x, b.y, 6);
  const ctx = contexte();
  for (let k = 0; k < 30; k++) d.sous(ctx, v);   // les tuiles de près sont peintes
  const tuiles = [...d.couches.sous.cache.values()].filter(tl => tl.L !== 0.5 && tl.cv && !tl.neuve);
  assert.ok(tuiles.length > 0);
  d.bati([[c, 1], [-1, 2], [1e9, 2], [cellule(0, 0), 2]]);   // (hors carte, ou case sans bâtiment : sans effet)
  assert.equal(b.etat, 1);
  assert.ok(tuiles.some(tl => tl.sale), 'la tuile sous le bâtiment est à repeindre');
  assert.equal(d.feux.size, 0);
  d.bati([[c, 2]]);
  assert.equal(b.etat, 2);
  assert.ok(d.feux.has(b));
  for (let k = 0; k < 50; k++) d.update(0.1);
  assert.equal(d.feux.get(b).I, 1, 'le feu a pris toute sa force');
  assert.ok(d.fumees.length > 0, 'fumée noire et braises');
  const g = contexte(); d.dessus(g, v, []);
  assert.ok(g.appels.includes('gco:lighter'), 'flammes en lumière ajoutée');
  d.bati([[c, 3]]);
  assert.equal(b.etat, 3);
  assert.equal(b.braise, 1);
  for (let k = 0; k < 40; k++) d.update(0.1);
  assert.ok(!d.feux.has(b), 'les flammes se sont éteintes');
  assert.ok(b.braise > 0 && b.braise < 1, 'la ruine couve encore');
  // un grand bâtiment : son état est celui de ses cases (en feu si l'une brûle)
  const egl = d.batiments.find(o => o.cle === 'egliseRomane');
  d.bati([[egl.cells[0], 2]]);
  assert.equal(egl.etat, 2);
});

test('le feuillage s\'ouvre au-dessus des régiments dans les bois, pas ailleurs', () => {
  const d = new Decor2D(terrain(), {}, Q);
  const bois = { x: 960, y: 170, w: 60, d: 10, dir: 0.4, state: 'marche' }, champ = { x: 200, y: 700, w: 60, d: 10, dir: 0 };
  assert.equal(d.clairieres([bois]).length, 1);
  assert.equal(d.clairieres([champ]).length, 0);
  assert.equal(d.clairieres([{ ...bois, _ghost: true }]).length, 0, 'un régiment qu\'on ne voit plus ne trahit pas sa place');
  const [, , a, hd, hw] = d.clairieres([bois])[0];
  assert.equal(a, 0.4); assert.ok(hw > 30 && hd > 5, 'le trou couvre le front et la profondeur');
  const ctx = contexte(), v = vue(960, 170, 4);
  d.dessus(ctx, v, [bois]);
  assert.ok(d.tmp, 'calque du feuillage à part');
  assert.ok(d.tmp.getContext('2d').appels.includes('gco:destination-out'), 'trous découpés dans le feuillage');
  const ctx2 = contexte(); d.dessus(ctx2, v, [champ]);
  assert.ok(!ctx2.appels.includes('gco:destination-out'));
});

test('enceintes : mur médiéval, tracé bastionné, brèche refaite ; sans tracé, le mur suit les cases MUR', () => {
  const tr = terrain(), anneau = (r, n, bosse) => Array.from({ length: n + 1 }, (_, k) => { const a = k / n * Math.PI * 2, rr = r + (bosse && k % 18 === 9 ? 40 : 0); return [470 + Math.cos(a) * rr, 350 + Math.sin(a) * rr]; });
  tr.walls = [{ pts: anneau(160, 72), kind: 'mur', thick: 22, breach: [] }, { pts: anneau(240, 72, true), kind: 'bastion', thick: 42, breach: [] }];
  const d = new Decor2D(tr, { place: { x: 470, y: 350, r: 140, type: 'ville' } }, Q);
  assert.equal(d.enceintes.length, 4, 'deux couches (au sol, murs) par enceinte');
  const ctx = contexte(), v = vue(470, 190, 3);
  for (let k = 0; k < 20; k++) d.sous(ctx, v);
  const pres = [...d.couches.sous.cache.values()].filter(tl => tl.cv && tl.x0 <= 470 && tl.x0 + tl.S >= 470 && tl.y0 <= 190 && tl.y0 + tl.S >= 190);
  assert.ok(pres.length);
  for (const tl of pres) tl.sale = null;
  tr.walls[0].breach.push([470, 190, 20]);
  d.walls();
  assert.ok(pres.every(tl => tl.sale), 'repeint autour de la brèche');
  d.sous(contexte(), v);
  // sans tracé donné
  const t2 = terrain();
  for (let i = 30; i <= 36; i++) t2.t[cellule(i, 30)] = i === 33 ? T.PORTE : i === 35 ? T.BRECHE : T.MUR;
  const d2 = new Decor2D(t2, {}, Q);
  assert.equal(d2.enceintes.length, 1);
  assert.ok(d2.enceintes[0].cases);
  d2.sous(contexte(), vue(660, 610, 3));
});

test('bêtes et villageois fuient les boulets', () => {
  const d = new Decor2D(terrain(), { place: { x: 470, y: 350, r: 120, type: 'village' } }, Q);
  const vache = d.vie.find(e => e.k === 'vache');
  assert.ok(vache, 'des vaches au pré');
  assert.ok(d.vie.some(e => e.k === 'charrette'), 'une charrette sur la route');
  const x0 = vache.x, y0 = vache.y;
  d.fuir(x0 + 15, y0);
  assert.ok(vache.peur > 0);
  for (let k = 0; k < 20; k++) d.update(0.1);
  assert.ok(vache.x < x0 - 2, 'la vache s\'éloigne du coup');
  d.fuir(470, 290);
  const civils = d.vie.filter(e => e.k === 'civil');
  assert.ok(civils.length > 0, 'les villageois sortent');
  for (let k = 0; k < 40; k++) d.fuir(470, 290);
  assert.ok(d.vie.filter(e => e.k === 'civil').length <= d.maxCivils, 'nombre borné');
  for (let k = 0; k < 400; k++) d.update(0.1);
  assert.equal(d.vie.filter(e => e.k === 'civil').length, 0, 'ils sont partis');
  const ctx = contexte(); d.sous(ctx, vue(x0, y0, 5));
});

test('moulin vu de dessus : ailes de profil en travers du vent, queue sous le vent, ombre en croix qui tourne', async () => {
  const D = await import('../web/js/battle/decor2d-dessin.js');
  const traits = (t, wa) => {   // les segments tracés (moveTo puis lineTo)
    const segs = []; let p = null;
    const g = new Proxy({}, { get: (o, k) => k in o ? o[k] : k === 'moveTo' ? (x, y) => { p = [x, y]; } : k === 'lineTo' ? (x, y) => { segs.push([...p, x, y]); p = [x, y]; } : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
    D.ailes(g, t, wa);
    return segs;
  };
  const L = 17, wa = 0.6, dx = Math.cos(wa), dy = Math.sin(wa);
  for (const t of [0, 0.3, Math.PI / 4, 1.2]) {
    const s = traits(t, wa);
    assert.ok(s.some(([x0, y0, x1, y1]) => x0 === 0 && y0 === 0 && Math.abs(x1 - dx * 13) < 1e-9 && Math.abs(y1 - dy * 13) < 1e-9), 'la queue pointe sous le vent');
    // la barre des ailes : perpendiculaire au vent, demi-longueur entre 0,71 L et L
    const barre = s.find(([x0, y0, x1, y1]) => Math.hypot(x1 - x0, y1 - y0) > L && Math.abs((x1 - x0) * dx + (y1 - y0) * dy) < 1e-9);
    assert.ok(barre, 'une barre en travers du vent');
    const m = Math.hypot(barre[2] - barre[0], barre[3] - barre[1]) / 2;
    assert.ok(m >= L * Math.SQRT1_2 - 1e-9 && m <= L + 1e-9);
    assert.ok(Math.abs(m - L * Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t)))) < 1e-9);
  }
  // l'ombre : quatre bras partis du même point, qui changent quand les ailes tournent
  const ombre = t => traits(t, wa).slice(0, 4);
  assert.equal(new Set(ombre(0).map(([x, y]) => x.toFixed(6) + y.toFixed(6))).size, 1);
  assert.notDeepEqual(ombre(0), ombre(0.4));
});

test('couvents, hôtels, hôpitaux, casernes donnés case par case : un seul modèle par îlot ; jardins dans les cœurs d\'îlot', () => {
  const tr = terrain(), b = [];
  for (let j = 18; j <= 21; j++) for (let i = 24; i <= 28; i++) b.push({ x: (i + .5) * CELL, y: (j + .5) * CELL, w: 17, h: 12, a: 0, kind: 'hotel' });
  for (let j = 14; j <= 16; j++) for (let i = 24; i <= 28; i++) b.push({ x: (i + .5) * CELL, y: (j + .5) * CELL, w: 17, h: 12, a: 0, kind: 'couvent' });
  const d = new Decor2D(tr, { buildings: b, place: { x: 470, y: 350, r: 150, type: 'ville' } }, Q);
  const hotels = d.batiments.filter(o => o.kind === 'hotel'), couvents = d.batiments.filter(o => o.kind === 'couvent');
  assert.equal(hotels.length, 1, 'un hôtel pour l\'îlot');
  assert.equal(couvents.length, 1, 'un couvent pour l\'îlot');
  for (let j = 18; j <= 21; j++) for (let i = 24; i <= 28; i++) assert.deepEqual(d.parCase.get(cellule(i, j)), [hotels[0]], 'ses cases brûlent avec lui');
  const [x0, y0, x1, y1] = hotels[0].bbox;
  assert.ok(x0 > 23 * CELL - 12 && x1 < 29 * CELL + 12 && y0 > 17 * CELL - 12 && y1 < 22 * CELL + 12, 'à la mesure de son îlot, jardin compris');
  // un cœur d'îlot (des prés entourés de maisons) : potager, verger ou cour, quelle que soit la graine
  let jardins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const t2 = terrain(); t2.t[cellule(20, 19)] = t2.t[cellule(20, 20)] = T.PRE;
    const d0 = new Decor2D(terrain(), { seed, place: { x: 470, y: 350, r: 150, type: 'ville' } }, Q), d1 = new Decor2D(t2, { seed, place: { x: 470, y: 350, r: 150, type: 'ville' } }, Q);
    jardins += d1.fixes.length - d0.fixes.length;
    d1.sous(contexte(), vue(410, 390, 6));
  }
  assert.ok(jardins >= 4, 'des jardins dans les cœurs d\'îlot');
});
