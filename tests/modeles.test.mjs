// Banc des modèles 3D des figurines (web/js/battle/troupes.js, model) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les figurines sont construites par le code et animées par le vertex shader d'après l'« os »
// de chaque sommet (jambes, bras et fusil, encolure, étoffe du drapeau). Un sommet rattaché au mauvais os, une
// figurine tournée à l'envers ou deux fois trop grande ne font rien planter : ils se voient mal au milieu de milliers
// de soldats. Ici on mesure chaque sorte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../web/vendor/three/three.module.js';
import { model, lodOf, RIG, RIG_EXTRA, INSTANCE_ATTRS, Troops } from '../web/js/battle/troupes.js';
import { uniform } from '../web/js/battle/formes.js';

// os permis par sorte (0 corps, 1-2 jambes, 3 bras et fusil, 4 étoffe ; cheval : 1-2 et 5-6 jambes, 7 encolure,
// 8 bras du cavalier) et hauteur attendue (m, avant l'échelle des figurines ; sans les bras, le fusil ni le sabre)
const FOOT = [0, 1, 2, 3], HORSE = [0, 1, 2, 5, 6, 7];
const SORTES = {
  inf: [FOOT, 1.7, 2.0], gren: [FOOT, 1.9, 2.3], leger: [FOOT, 1.7, 2.1], milice: [FOOT, 1.7, 2.0], servant: [FOOT, 1.7, 2.0],
  officier: [FOOT, 1.7, 2.0], tambour: [FOOT, 1.7, 2.0], drapeau: [FOOT, 3.4, 3.9],
  // (le cavalier est une figurine à part, au squelette : le cheval n'a que sa selle)
  cav: [HORSE, 1.8, 2.3], colonel: [HORSE, 1.8, 2.3], attelage: [HORSE, 1.8, 2.3],
  canon: [[0], 1.0, 1.5], caisson: [[0], 1.1, 1.6], chariot: [[0], 1.7, 2.2],
};

const stats = g => {
  const p = g.attributes.position, b = g.attributes.aBone;
  let y0 = Infinity, y1 = -Infinity;
  const bones = new Set();
  for (let i = 0; i < p.count; i++) {
    const bone = b.getX(i);
    bones.add(bone); y0 = Math.min(y0, p.getY(i));
    if (bone !== 3 && bone !== 8) y1 = Math.max(y1, p.getY(i));
  }
  return { y0, y1, bones, n: p.count };
};

for (const [kind, [bones, hmin, hmax]] of Object.entries(SORTES)) {
  test(`${kind} : os de la sorte, pieds au sol, hauteur plausible`, () => {
    const s = stats(model(kind, 1790));
    for (const b of s.bones) assert.ok(bones.includes(b), `os ${b} inattendu`);
    assert.ok(Math.abs(s.y0) < 0.03, `pieds en y = ${s.y0.toFixed(3)}`);
    assert.ok(s.y1 >= hmin && s.y1 <= hmax, `hauteur ${s.y1.toFixed(2)} m`);
  });
}

test('les figurines regardent vers +Z : pieds, tête du cheval et bouche du canon devant', () => {
  // les sommets du bas (les pieds) d'un fantassin dépassent vers l'avant
  const g = model('inf', 1790), p = g.attributes.position;
  let z = 0, n = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.06) { z += p.getZ(i); n++; }
  assert.ok(z / n > 0.01, `pieds en z moyen ${(z / n).toFixed(3)}`);
  // cheval et canon : plus longs devant que derrière
  for (const kind of ['attelage', 'canon']) {
    const q = model(kind, 1790).attributes.position;
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < q.count; i++) { z0 = Math.min(z0, q.getZ(i)); z1 = Math.max(z1, q.getZ(i)); }
    assert.ok(z1 > -z0, `${kind} : de ${z0.toFixed(2)} à ${z1.toFixed(2)}`);
  }
});

test('les coiffures suivent l’époque (tricorne, bicorne, shako : la figurine grandit)', () => {
  const h = y => stats(model('inf', y)).y1;
  assert.ok(h(1830) > h(1790) + 0.05, 'le shako est plus haut que le tricorne');
});

test('hommes et chevaux sont arrondis : des centaines de directions de normales (des pavés en ont quelques dizaines)', () => {
  for (const kind of ['inf', 'gren', 'leger', 'milice', 'servant', 'officier', 'tambour', 'drapeau', 'cav', 'colonel', 'attelage']) {
    const n = model(kind, 1790).attributes.normal, dirs = new Set();
    for (let i = 0; i < n.count; i++) dirs.add([n.getX(i), n.getY(i), n.getZ(i)].map(c => Math.round(c * 10)).join());
    assert.ok(dirs.size >= 100, `${kind} : ${dirs.size} directions de normales`);
  }
});

test('version de loin : mêmes os, même hauteur, pieds au sol, au plus un tiers des sommets', () => {
  for (const kind of Object.keys(SORTES)) {
    const near = stats(model(kind, 1790, 1)), far = stats(model(kind, 1790, 0));
    assert.deepEqual([...far.bones].sort(), [...near.bones].sort(), `${kind} : os`);
    assert.ok(Math.abs(far.y1 - near.y1) / near.y1 < 0.05, `${kind} : ${far.y1.toFixed(2)} m de loin, ${near.y1.toFixed(2)} m de près`);
    assert.ok(Math.abs(far.y0) < 0.03, `${kind} : pieds en y = ${far.y0.toFixed(3)}`);
    assert.ok(far.n * 3 <= near.n, `${kind} : ${far.n} sommets de loin, ${near.n} de près`);
  }
});

test('choix de la version : hors champ, de loin, de près, avec une marge contre les bascules', () => {
  assert.equal(lodOf(40, 2, false), 0, 'hors champ : rien');
  assert.equal(lodOf(40, 0, true), 2);
  assert.equal(lodOf(10, 2, true), 1);
  // entre les deux seuils, la version reste celle d'avant
  const mid = 16;
  assert.equal(lodOf(mid, 2, true), 2);
  assert.equal(lodOf(mid, 1, true), 1);
  assert.equal(lodOf(mid, 0, true), 1, 'en rentrant dans le champ, de loin');
});

test('essai des animations : fantassins sur les os du squelette, dans l’ordre de web/anims/soldat.json', () => {
  const names = [...Object.keys(RIG), ...RIG_EXTRA], id = Object.fromEntries(names.map((k, i) => [k, i]));
  const meta = JSON.parse(fs.readFileSync(new URL('../web/anims/soldat.json', import.meta.url)));
  assert.deepEqual(meta.bones, names, 'relancer dev/cuire.mjs');
  for (const kind of ['inf', 'gren', 'milice', 'piquier', 'officier', 'tambour', 'drapeau', 'servant', 'cavalier', 'chef']) {
    const g = model(kind, 1790, 1, true), p = g.attributes.position, b = g.attributes.aBone;
    for (let i = 0; i < p.count; i++) {
      const bone = b.getX(i), y = p.getY(i);
      assert.ok(Number.isInteger(bone) && bone >= 0 && bone < names.length, `${kind} : os ${bone}`);
      if (bone === id.thighL || bone === id.thighR) assert.ok(y > 0.53, `${kind} : cuisse sous le genou (y = ${y.toFixed(2)})`);
      if (bone === id.shinL || bone === id.shinR) assert.ok(y <= 0.53 && y > 0.09, `${kind} : tibia en y = ${y.toFixed(2)}`);
    }
  }
  // sans le squelette, les os de toujours
  const old = new Set(model('inf', 1790).attributes.aBone.array);
  assert.deepEqual([...old].sort(), [0, 1, 2, 3]);
});

test('au plus 16 attributs par sommet (limite de WebGL), gestes compris', () => {
  // attributs lus par le shader des figurines au squelette : ceux du modèle (sans uv, lu par les seules étoffes), puis
  // un emplacement par attribut d'instance (au plus 4 nombres chacun)
  const g = model('inf', 1790, 1, true), own = Object.keys(g.attributes).filter(a => a !== 'uv');
  const slots = own.length + Object.values(INSTANCE_ATTRS).reduce((a, n) => a + Math.ceil(n / 4), 0);
  assert.ok(slots <= 16, `${slots} emplacements : ${own.join(', ')}, ${Object.keys(INSTANCE_ATTRS).join(', ')}`);
  assert.ok('aGest' in INSTANCE_ATTRS && 'aMix' in INSTANCE_ATTRS, 'attributs des gestes');
});

test('au squelette, la version de loin a les mêmes os et la même hauteur que celle de près', () => {
  const names = [...Object.keys(RIG), ...RIG_EXTRA], id = Object.fromEntries(names.map((k, i) => [k, i]));
  const limbs = new Set(['upperL', 'foreL', 'upperR', 'foreR', 'musket', 'carryUpper', 'carryFore'].map(k => id[k]));
  const rigStats = g => {
    const p = g.attributes.position, b = g.attributes.aBone, bones = new Set();
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < p.count; i++) {
      bones.add(b.getX(i)); y0 = Math.min(y0, p.getY(i));
      if (!limbs.has(b.getX(i))) y1 = Math.max(y1, p.getY(i));
    }
    return { y0, y1, bones, n: p.count };
  };
  for (const kind of ['inf', 'gren', 'leger', 'milice', 'piquier', 'officier', 'tambour', 'drapeau', 'cavalier', 'chef']) {
    const near = rigStats(model(kind, 1790, 1, true)), far = rigStats(model(kind, 1790, 0, true));
    for (const b of far.bones) assert.ok(near.bones.has(b), `${kind} : os ${names[b]} de loin seulement`);
    for (const k of ['thighL', 'shinL', 'chest', 'head']) assert.ok(far.bones.has(id[k]), `${kind} : pas d'os ${k} de loin`);
    assert.ok(Math.abs(far.y1 - near.y1) / near.y1 < 0.05, `${kind} : ${far.y1.toFixed(2)} m de loin, ${near.y1.toFixed(2)} m de près`);
    assert.ok(Math.abs(far.y0) < 0.03, `${kind} : pieds en y = ${far.y0.toFixed(3)}`);
    assert.ok(far.n * 3 <= near.n, `${kind} : ${far.n} sommets de loin, ${near.n} de près`);
  }
  // l'étoffe du drapeau suit la hampe (os du fusil)
  assert.deepEqual([...new Set(model('etoffe', 1790, 1, true).attributes.aBone.array)], [id.musket]);
});

test('étape 8 : chaque homme porte la couleur de son camp (revers, collet, parements ; de loin, le plastron), chaque cheval sur son tapis', () => {
  const tints = g => new Set(g.attributes.aPart.array);
  for (const kind of ['inf', 'gren', 'leger', 'milice', 'officier', 'tambour', 'drapeau', 'servant', 'cavalier', 'chef'])
    for (const year of [1700, 1790, 1813, 1870])
      for (const lod of [0, 1]) assert.ok(tints(model(kind, year, lod, true)).has(3), `${kind} ${year} ${lod ? 'de près' : 'de loin'}`);   // (model : 0 de loin, 1 de près)
  for (const kind of ['cav', 'colonel']) for (const lod of [0, 1]) assert.ok(tints(model(kind, 1790, lod, true)).has(3), `${kind} : tapis de selle`);
  assert.ok('aFace' in INSTANCE_ATTRS, 'la couleur du camp, par figurine');
});

test('étape 8 : la capote de 1870 n’a ni revers ni retroussis (collet et parements seulement)', () => {
  const faces = g => g.attributes.aPart.array.filter(t => t === 3).length;
  assert.ok(faces(model('inf', 1870, 1, true)) < faces(model('inf', 1813, 1, true)));
});

test('étape 8 : uniformes français d’époque (palette)', () => {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const blue = h => { const [r, g, b] = rgb(h); return b > r && b >= g; };
  const red = h => { const [r, g, b] = rgb(h); return r > 1.5 * g && r > 1.5 * b; };
  const light = h => rgb(h).every(c => c > 190);
  assert.ok(light(uniform(1700, 'inf', '1er Ligne', 'inf').coat), '1700 : justaucorps gris-blanc');
  for (const y of [1790, 1813, 1870]) assert.ok(blue(uniform(y, 'inf', '1er Ligne', 'inf').coat), `${y} : bleu`);
  assert.ok(red(uniform(1870, 'inf', '1er Ligne', 'inf').trous), '1870 : pantalon garance');
  assert.ok(light(uniform(1813, 'inf', '1er Ligne', 'inf').trous), '1813 : culotte blanche');
  for (const y of [1700, 1790, 1813, 1870]) {
    const art = rgb(uniform(y, 'artillerie', '1re Batterie', 'servant').coat);
    assert.ok(art[2] > art[0] && art.reduce((a, c) => a + c) < 240, `${y} : artillerie bleu foncé`);
    for (const k of ['inf', 'gren', 'leger', 'officier', 'tambour', 'drapeau']) assert.ok(!red(uniform(y, 'inf', '', k).coat), `${y} ${k} : pas rouge`);
  }
  for (const y of [1790, 1813]) { const [r, g, b] = rgb(uniform(y, 'cavalerie', '1er dragons', 'cav').coat); assert.ok(g > r && g > b, `${y} : dragons verts`); }
  assert.ok(blue(uniform(1870, 'cavalerie', '1er dragons', 'cav').coat), '1870 : dragons comme l’infanterie');
  assert.ok(blue(uniform(1790, 'cavalerie', '3e hussards', 'cav').coat), 'hussards comme l’infanterie');
  assert.equal(uniform(1790, 'inf', '', 'milice').coat, '#7a6248', 'la milice, en habits civils');
  // années limites : Louis XIV jusqu'en 1759, l'habit bleu dès 1760, la capote en 1860, le pantalon garance dès 1829
  assert.ok(light(uniform(1759, 'inf', '', 'inf').coat) && blue(uniform(1760, 'inf', '', 'inf').coat));
  assert.ok(!red(uniform(1828, 'inf', '', 'inf').trous) && red(uniform(1829, 'inf', '', 'inf').trous));
  assert.notEqual(uniform(1859, 'inf', '', 'inf').coat, uniform(1860, 'inf', '', 'inf').coat, 'la capote en 1860');
  assert.ok(!(rgb(uniform(1700, 'cavalerie', '1er dragons', 'cav').coat)[1] > rgb(uniform(1700, 'cavalerie', '1er dragons', 'cav').coat)[0]), 'pas de dragons verts en 1700');
  assert.ok(blue(uniform(1790, 'artillerie', '', 'servant').trous), 'artillerie : culotte bleue');
});

test('étape 8 : deux camps, le même habit, des revers différents (figurines et corps)', () => {
  const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : () => ({ addColorStop() {} }), set: (o, k, v) => (o[k] = v, true) });
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const t = { fineW: 4, fineH: 4, fine: new Float32Array(16), hmin: 0, W: 4000, H: 4000, buildingGrid: () => null, ombre: { width: 8, height: 8 } };
  const tr = new Troops({ t, ex: 1, heightAt: () => 0 }, { troupes: 10000, corps: 2500, fx: 2 }, 1790, null);
  const colors = ['#b8352a', '#3f6fb5'];
  const un = (id, side) => ({ id, side, type: 'ligne', name: `${id}e de ligne`, form: 'ligne', state: 'repos', men: 120, men0: 120, x: 500 + id * 200, y: 500, dir: 0, w: 60, d: 6 });
  const cav = { id: 3, side: 0, type: 'cavalerie', name: '1er dragons', form: 'ligne', state: 'repos', men: 60, men0: 60, x: 300, y: 800, dir: 0, w: 40, d: 6 };
  tr.update([un(1, 0), un(2, 1), cav], colors, 0, 0);
  for (const e of tr.lays.values()) e.lod = 2;
  tr.rebuild(colors, 1.6);
  const k = tr.kinds.get('inf'), side = i => tr.index.get('1') === k.buf.aSlot[i * 4 + 3] ? 0 : 1;
  const mean = (a, s) => { let n = 0; const m = [0, 0, 0]; for (let i = 0; i < k.n; i++) if (side(i) === s) { n++; for (let c = 0; c < 3; c++) m[c] += a[i * 3 + c]; } return m.map(x => x / n); };
  const c0 = mean(k.buf.aCoat, 0), c1 = mean(k.buf.aCoat, 1);
  assert.ok(c0[2] > c0[0] && c1[2] > c1[0], 'habit bleu des deux côtés en 1790');
  assert.ok(Math.abs(c0[2] - c1[2]) < 0.05 && Math.abs(c0[0] - c1[0]) < 0.05, 'le même habit');
  const f0 = mean(k.buf.aFace, 0), f1 = mean(k.buf.aFace, 1);
  assert.ok(f0[0] > f0[2] && f1[2] > f1[0], 'revers rouges d’un côté, bleus de l’autre');
  // le cavalier : l'habit vert des dragons (pas la couleur du camp) ; son cheval : le tapis à la couleur du camp
  const rider = tr.kinds.get('cavalier'), horse = tr.kinds.get('cav');
  assert.ok(rider.n > 0 && rider.buf.aCoat[1] > rider.buf.aCoat[0] && rider.buf.aCoat[1] > rider.buf.aCoat[2], 'cavalier en vert');
  assert.ok(horse.buf.aFace[0] > horse.buf.aFace[2], 'tapis rouge (Gironde)');
  tr.kill({ ...un(1, 0), men: 120 }, 10, () => true, colors[0]);
  assert.ok(tr.dead.length && tr.dead.every(b => b.coat[2] > b.coat[0] && b.face[0] > b.face[2]), 'les corps gardent l’habit et les revers de leur camp');
  for (const b of tr.dead) b.lod = 2;
  tr.rebuild(colors, 1.6);
  const n = k.n - 1;   // (les corps à la suite des vivants)
  assert.ok(k.buf.aFace[n * 3] > k.buf.aFace[n * 3 + 2] && k.buf.aCoat[n * 3 + 2] > k.buf.aCoat[n * 3], 'corps redessinés : revers du camp, habit bleu');
});

test('tampons agrandis en pleine bataille : toutes les figurines sont dessinées, pas seulement celles du premier rendu', () => {
  // (Three retient au premier rendu le nombre d'instances d'une InstancedBufferGeometry et n'en dessine jamais plus,
  // sauf si la géométrie est libérée : son WebGLGeometries l'oublie alors, three.module.js r186)
  const geo = new THREE.InstancedBufferGeometry(), k = { geo, buf: {}, contactGeo: null };
  Troops.prototype.grow.call(null, k, 256);
  k.buf.aSlot[4] = 7;
  let freed = 0;
  geo.addEventListener('dispose', () => freed++);
  Troops.prototype.grow.call(null, k, 512);
  assert.equal(freed, 1, 'géométrie libérée');
  assert.equal(geo.attributes.aSlot.count, 512);
  assert.equal(k.buf.aSlot[4], 7, 'contenu gardé');
});

test('une pièce par génération d’artillerie, de près et de loin (SPEC-TECH.md)', async () => {
  const { gunModel } = await import('../web/js/battle/formes.js');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(arm => gunModel({ cls: 'artillerie', arm })),
    ['ancien', 'ancien', 'gribeauval', 'valee', 'lahitte', 'bange', '75']);
  assert.equal(gunModel({ cls: 'artillerie' }), 'ancien', 'sans arme connue : la plus ancienne');
  const box = g => { g.computeBoundingBox(); return g.boundingBox; };
  const sig = g => [g.attributes.position.count, [...new Set(Array.from(g.attributes.color.array, x => x.toFixed(3)))].join()].join('|');
  const seen = new Set();
  for (const v of ['ancien', 'gribeauval', 'valee', 'lahitte', 'bange', '75']) {
    for (const lod of [1, 0]) {
      const g = model('canon', 1790, lod, false, v);
      assert.ok(g.attributes.position.count > 0, `${v} ${lod}`);
      if (lod) { assert.ok(!seen.has(sig(g)), `${v} : une pièce à elle`); seen.add(sig(g)); }
    }
    assert.ok(model('caisson', 1790, 1, false, v).attributes.position.count > 0);
  }
  const L = v => { const b = box(model('canon', 1790, 1, false, v)); return b.max.z - b.min.z; };
  assert.ok(L('ancien') > L('gribeauval'), 'le long fût de bronze d’avant Gribeauval');
  const b75 = box(model('canon', 1790, 1, false, '75')), bg = box(model('canon', 1790, 1, false, 'gribeauval'));
  assert.ok(b75.max.y > bg.max.y, 'le bouclier du 75 dépasse le tube');
});
