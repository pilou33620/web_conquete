// Banc des modèles 3D des figurines (web/js/battle/troupes.js, model) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les figurines sont construites par le code et animées par le vertex shader d'après l'« os »
// de chaque sommet (jambes, bras et fusil, encolure, étoffe du drapeau). Un sommet rattaché au mauvais os, une
// figurine tournée à l'envers ou deux fois trop grande ne font rien planter : ils se voient mal au milieu de milliers
// de soldats. Ici on mesure chaque sorte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { model, lodOf, RIG, RIG_EXTRA } from '../web/js/battle/troupes.js';

// os permis par sorte (0 corps, 1-2 jambes, 3 bras et fusil, 4 étoffe ; cheval : 1-2 et 5-6 jambes, 7 encolure,
// 8 bras du cavalier) et hauteur attendue (m, avant l'échelle des figurines ; sans les bras, le fusil ni le sabre)
const FOOT = [0, 1, 2, 3], HORSE = [0, 1, 2, 5, 6, 7];
const SORTES = {
  inf: [FOOT, 1.7, 2.0], gren: [FOOT, 1.9, 2.3], leger: [FOOT, 1.7, 2.1], milice: [FOOT, 1.7, 2.0], servant: [FOOT, 1.7, 2.0],
  officier: [FOOT, 1.7, 2.0], tambour: [FOOT, 1.7, 2.0], drapeau: [FOOT, 3.4, 3.9],
  cav: [[...HORSE, 8], 2.3, 2.9], colonel: [[...HORSE, 8], 2.3, 2.9], attelage: [HORSE, 1.8, 2.3],
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
  for (const kind of ['inf', 'gren', 'milice', 'officier', 'tambour', 'drapeau']) {
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
