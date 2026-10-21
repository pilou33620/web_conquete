#!/usr/bin/env node
// Précalcul du corps des fantassins de près (SPEC-SUITE E1). Lit le corps d'homme de Quaternius (Universal Base
// Characters, version gratuite « Standard », CC0 : https://quaternius.com, fichier Superhero_Male_FullBody.gltf et son
// .bin) et écrit web/anims/corps.json : le maillage allégé dans la pose de référence de nos figurines (debout, bras le
// long du corps : celle de dev/cuire.mjs), quatre os et quatre poids par sommet sur nos os (troupes.js, RIG), la zone
// de chaque sommet (peau, habit, culotte, guêtres, souliers) et les triangles.
//
//   node web/js/battle/dev/corps.mjs Superhero_Male_FullBody.gltf
//
// Le squelette de ces personnages est celui des animations déjà dans le jeu (Universal Animation Library, mêmes noms
// d'os d'Unreal) : le corps se pose donc sur nos gestes sans reciblage. Les 65 os sont ramenés à nos 13 (doigts sur
// l'avant-bras, clavicules sur la poitrine…). Le maillage (12 500 triangles) est allégé par regroupement des sommets
// sur une grille de CELL m, puis les têtes sont grossies comme celles des figurines faites par le code (stocky).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from '../../../vendor/three/three.core.js';
import { RIG } from '../troupes.js';

const CELL = 0.052;  // côté de la grille de regroupement (m) : autour de 1 400 triangles
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../anims');
const src = process.argv[2];
if (!src) { console.error('usage : node corps.mjs Superhero_Male_FullBody.gltf'); process.exit(2); }
const g = JSON.parse(fs.readFileSync(src, 'utf8'));
const buf = fs.readFileSync(path.join(path.dirname(src), g.buffers[0].uri));
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(i) {
  const a = g.accessors[i], v = g.bufferViews[a.bufferView], n = SIZE[a.type];
  const [fn, sz] = { 5126: ['readFloatLE', 4], 5123: ['readUInt16LE', 2], 5121: ['readUInt8', 1], 5125: ['readUInt32LE', 4] }[a.componentType];
  const off = (v.byteOffset || 0) + (a.byteOffset || 0), st = v.byteStride || n * sz, out = [];
  for (let k = 0; k < a.count; k++) { const e = []; for (let q = 0; q < n; q++) e.push(buf[fn](off + k * st + q * sz)); out.push(e); }
  return out;
}

// ------------------------------------------------------------------ squelette, pose de référence
const skin = g.skins[0], joints = skin.joints, names = joints.map(j => g.nodes[j].name);
const ibm = read(skin.inverseBindMatrices).map(e => new Matrix4().fromArray(e));
const parent = new Map();
g.nodes.forEach((nd, i) => (nd.children || []).forEach(c => parent.set(c, i)));
const W = new Map();
const world = i => {
  if (W.has(i)) return W.get(i);
  const nd = g.nodes[i], m = new Matrix4().compose(new Vector3(...(nd.translation || [0, 0, 0])), new Quaternion(...(nd.rotation || [0, 0, 0, 1])), new Vector3(...(nd.scale || [1, 1, 1])));
  if (parent.has(i)) m.premultiply(world(parent.get(i)));
  W.set(i, m); return m;
};
const jw = joints.map(world);
const posOf = n => new Vector3().setFromMatrixPosition(jw[names.indexOf(n)]);
// les bras, en croix au repos, baissés le long du corps (rotation autour de l'épaule, comme dev/cuire.mjs)
const lower = side => { const sh = posOf(`upperarm_${side}`); return new Matrix4().makeTranslation(sh.x, sh.y, sh.z).multiply(new Matrix4().makeRotationZ(side === 'l' ? -Math.PI / 2 : Math.PI / 2)).multiply(new Matrix4().makeTranslation(-sh.x, -sh.y, -sh.z)); };
const LOW = { l: lower('l'), r: lower('r') };
const armSide = n => (/^(upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)_/.test(n) ? n.slice(-1) : null);
const skinRef = names.map((n, j) => { const m = jw[j].clone().multiply(ibm[j]); const s = armSide(n); return s ? m.premultiply(LOW[s]) : m; });

// nos os (RIG, dans l'ordre de la texture des animations) pour chaque os de Quaternius
const B = Object.fromEntries(Object.keys(RIG).map((k, i) => [k, i]));
function ourBone(n) {
  const s = n.slice(-1), S = s === 'l' ? 'L' : 'R';
  if (n === 'root' || n === 'pelvis' || n === 'spine_01') return B.hips;
  if (/^(spine_02|spine_03|clavicle_)/.test(n)) return B.chest;
  if (n === 'neck_01' || n === 'Head') return B.head;
  if (n.startsWith('upperarm_')) return B['upper' + S];
  if (/^(lowerarm|hand|index|middle|pinky|ring|thumb)_/.test(n)) return B['fore' + S];
  if (n.startsWith('thigh_')) return B['thigh' + S];
  if (n.startsWith('calf_')) return B['shin' + S];
  if (/^(foot|ball)_/.test(n)) return B['foot' + S];
  throw new Error(`os inconnu : ${n}`);
}
const JB = names.map(ourBone);

// ------------------------------------------------------------------ maillage dans la pose de référence
const meshIdx = g.nodes.filter(nd => nd.skin !== undefined).map(nd => nd.mesh)
  .sort((a, b) => b - a).reduce((best, m) => (g.accessors[g.meshes[m].primitives[0].indices].count > g.accessors[g.meshes[best].primitives[0].indices].count ? m : best));
const verts = [], tris = [];
for (const pr of g.meshes[meshIdx].primitives) {
  const base = verts.length;
  const P = read(pr.attributes.POSITION), N = read(pr.attributes.NORMAL), J = read(pr.attributes.JOINTS_0), Wt = read(pr.attributes.WEIGHTS_0);
  P.forEach((p, k) => {
    const v = new Vector3(...p), nv = new Vector3(...N[k]), o = new Vector3(), on = new Vector3(), w = new Map();
    let ws = 0;
    for (let q = 0; q < 4; q++) {
      const wq = Wt[k][q];
      if (wq <= 0) continue;
      ws += wq;
      const S = skinRef[J[k][q]];
      o.addScaledVector(v.clone().applyMatrix4(S), wq);
      on.addScaledVector(nv.clone().transformDirection(S), wq);
      const b = JB[J[k][q]];
      w.set(b, (w.get(b) || 0) + wq);
    }
    o.divideScalar(ws || 1);
    verts.push({ p: o, n: on.normalize(), w, dom: J[k][Wt[k].indexOf(Math.max(...Wt[k]))] });
  });
  read(pr.indices).forEach((e, k) => { if (k % 3 === 0) tris.push([]); tris[tris.length - 1].push(base + e[0]); });
}
// à nos mesures : la hanche à 0,93 m comme nos figurines et le squelette des animations (le corps fait 1,82 m, nos
// figurines 1,75 m), centrée en z sur les hanches
const hip = posOf('thigh_l'), SC = 0.93 / hip.y;
for (const v of verts) { v.p.z -= hip.z; v.p.multiplyScalar(SC); }
let lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
for (const v of verts) { lo.min(v.p); hi.max(v.p); }
console.log(`corps d'origine : ${verts.length} sommets, ${tris.length} triangles ; ${(hi.x - lo.x).toFixed(2)} × ${(hi.y - lo.y).toFixed(2)} × ${(hi.z - lo.z).toFixed(2)} m`);
console.log(`épaule ${posOf('upperarm_l').toArray().map(x => x.toFixed(3))}, hanche ${posOf('thigh_l').toArray().map(x => x.toFixed(3))}, tête ${posOf('Head').toArray().map(x => x.toFixed(3))}`);

// ------------------------------------------------------------------ zones (couleurs : troupes.js les peint selon l'uniforme)
// 0 peau, 1 habit, 2 culotte, 3 guêtres, 4 souliers, 5 parements (le bas des manches, à la couleur du camp)
const wristY = posOf('hand_l').applyMatrix4(LOW.l).y * SC;
function zone(v) {
  const n = names[v.dom];
  if (n === 'neck_01' || n === 'Head' || /^(hand|index|middle|pinky|ring|thumb)_/.test(n)) return 0;
  if (n.startsWith('lowerarm_') && v.p.y < wristY + 0.08) return 5;
  if (/^(foot|ball)_/.test(n)) return 4;
  if (n.startsWith('calf_')) return v.p.y > 0.47 ? 2 : 3;
  if (n.startsWith('thigh_')) return 2;
  if (n === 'pelvis' || n === 'root') return v.p.y > 0.9 ? 1 : 2;
  return 1;
}

// ------------------------------------------------------------------ allègement : regroupement sur une grille
const cells = new Map(), map = new Array(verts.length);
verts.forEach((v, k) => {
  const z = zone(v), key = `${Math.floor(v.p.x / CELL)},${Math.floor(v.p.y / CELL)},${Math.floor(v.p.z / CELL)},${z === 0 ? 0 : 1}`;
  let c = cells.get(key);
  if (!c) { c = { p: new Vector3(), n: new Vector3(), w: new Map(), z: [0, 0, 0, 0, 0, 0], k: 0, id: cells.size }; cells.set(key, c); }
  c.p.add(v.p); c.n.add(v.n); c.k++; c.z[z] = (c.z[z] || 0) + 1;
  for (const [b, x] of v.w) c.w.set(b, (c.w.get(b) || 0) + x);
  map[k] = c.id;
});
const out = [...cells.values()];
const seen = new Set(), T = [];
for (const [a, b, c] of tris) {
  const A = map[a], Bv = map[b], C = map[c];
  if (A === Bv || Bv === C || A === C) continue;
  const key = [A, Bv, C].sort((x, y) => x - y).join(',');
  if (seen.has(key)) continue;
  seen.add(key); T.push(A, Bv, C);
}
// quatre os au plus par sommet ; la tête grossie comme les figurines faites par le code (×1,25 autour du cou)
const pos = [], nor = [], jo = [], we = [], zo = [];
for (const c of out) {
  c.p.divideScalar(c.k); c.n.normalize();
  const top = [...c.w.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4), s = top.reduce((a, [, x]) => a + x, 0) || 1;
  const wh = (c.w.get(B.head) || 0) / ([...c.w.values()].reduce((a, x) => a + x, 0) || 1);
  if (wh > 0) { const k = 1 + 0.25 * wh, y0 = 1.44; c.p.set(c.p.x * k, y0 + (c.p.y - y0) * k, c.p.z * k); }
  pos.push(...c.p.toArray().map(x => +x.toFixed(4))); nor.push(...c.n.toArray().map(x => +x.toFixed(3)));
  for (let q = 0; q < 4; q++) { jo.push(top[q] ? top[q][0] : 0); we.push(top[q] ? +(top[q][1] / s).toFixed(3) : 0); }
  zo.push(c.z.indexOf(Math.max(...c.z)));
}
// l'avant et l'arrière du torse (à hauteur de poitrine) : troupes.js y recale revers, buffleteries, giberne, havresac
let front = -1, back = 1;
for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i]) < 0.07 && pos[i + 1] > 1.05 && pos[i + 1] < 1.35) { front = Math.max(front, pos[i + 2]); back = Math.min(back, pos[i + 2]); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'corps.json'), JSON.stringify({ source: 'Quaternius, Universal Base Characters (CC0), Superhero_Male_FullBody', zones: ['peau', 'habit', 'culotte', 'guetres', 'souliers', 'parements'], front: +front.toFixed(3), back: +back.toFixed(3),
  pos, nor, joints: jo, weights: we, zone: zo, index: T }) + '\n');
console.log(`corps allégé : ${out.length} sommets, ${T.length / 3} triangles, poitrine de ${front.toFixed(3)} à ${back.toFixed(3)} m → ${path.join(OUT, 'corps.json')}`);
