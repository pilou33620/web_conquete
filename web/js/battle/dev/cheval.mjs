#!/usr/bin/env node
// Précalcul du cheval des batailles. Lit le cheval animé de Quaternius (Ultimate Animated Animal Pack, CC0 :
// https://quaternius.com, fichier Horse.gltf de la version gratuite) et écrit :
//   web/anims/cheval.bin  : image par image, la matrice de peau de chaque os (3 × 4, demi-flottants), une ligne de
//                           texture par image, comme web/anims/soldat.bin ;
//   web/anims/cheval.json : les gestes (première ligne, images, en boucle), le maillage (positions de la pose de
//                           référence, normales, quatre os et quatre poids par sommet, matériau de chaque sommet,
//                           triangles) et la place de chaque os au repos (le dos : la selle et le cavalier).
//
//   node web/js/battle/dev/cheval.mjs Horse.gltf
//
// Le cheval est ramené à nos mesures (2,05 m du sabot au bout des oreilles, 1,55 m au garrot comme le cheval fait par
// le code, les sabots en y = 0, la tête vers +Z) : la mise
// à l'échelle est comprise dans les matrices, le maillage reste dans son repère d'origine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3, DataUtils } from '../../../vendor/three/three.core.js';

const FPS = 24, HAUT = 2.05;
// gestes gardés : [nom chez Quaternius, nom dans le jeu, en boucle]
const GESTES = [['Idle', 'repos', 1], ['Idle_2', 'repos2', 1], ['Idle_Headlow', 'broute', 1], ['Walk', 'pas', 1], ['Gallop', 'galop', 1],
  ['Death', 'mort', 0], ['Attack_Kick', 'ruade', 0], ['Idle_HitReact1', 'touche', 0]];
// matériaux de Quaternius → [sorte, nuance] : 2 la robe du cheval (nuance × couleur de la robe), 0 couleur fixe
const MATS = { Main: [2, 1], Main_Dark: [2, 0.62], Main_Light: [2, 1.3], Hooves: [0, '#2a241e'], Hair: [3, 1], Muzzle: [0, '#2a1d14'],
  Eye_White: [0, '#cfcabe'], Eye_Black: [0, '#0b0a09'] };

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) { console.error('usage : node cheval.mjs Horse.gltf'); process.exit(1); }
const g = JSON.parse(fs.readFileSync(src, 'utf8'));
const buf = Buffer.from(g.buffers[0].uri.split(',')[1], 'base64');
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(i) {
  const a = g.accessors[i], v = g.bufferViews[a.bufferView], n = SIZE[a.type];
  const [fn, sz] = { 5126: ['readFloatLE', 4], 5123: ['readUInt16LE', 2], 5121: ['readUInt8', 1], 5125: ['readUInt32LE', 4] }[a.componentType];
  const off = (v.byteOffset || 0) + (a.byteOffset || 0), st = v.byteStride || n * sz, out = [];
  for (let k = 0; k < a.count; k++) { const e = []; for (let q = 0; q < n; q++) e.push(buf[fn](off + k * st + q * sz)); out.push(e); }
  return out;
}

// ------------------------------------------------------------------ squelette
const skin = g.skins[0], joints = skin.joints, ibm = read(skin.inverseBindMatrices).map(e => new Matrix4().fromArray(e));
const parent = new Map();
g.nodes.forEach((nd, i) => (nd.children || []).forEach(c => parent.set(c, i)));
const rest = g.nodes.map(nd => ({ t: new Vector3(...(nd.translation || [0, 0, 0])), r: new Quaternion(...(nd.rotation || [0, 0, 0, 1])), s: new Vector3(...(nd.scale || [1, 1, 1])) }));
function worlds(pose) {
  const W = new Map();
  const get = i => {
    if (W.has(i)) return W.get(i);
    const p = pose[i], m = new Matrix4().compose(p.t, p.r, p.s);
    if (parent.has(i)) m.premultiply(get(parent.get(i)));
    W.set(i, m); return m;
  };
  return joints.map(get);
}
const skinMats = pose => worlds(pose).map((w, j) => w.clone().multiply(ibm[j]));

// ------------------------------------------------------------------ maillage
const mesh = g.meshes[g.nodes.findIndex(nd => nd.skin !== undefined) >= 0 ? g.nodes.find(nd => nd.skin !== undefined).mesh : 0];
const P = [], N = [], J = [], Wt = [], M = [], I = [];
for (const pr of mesh.primitives) {
  const base = P.length / 3, mat = g.materials[pr.material].name;
  const pos = read(pr.attributes.POSITION), nor = read(pr.attributes.NORMAL), jo = read(pr.attributes.JOINTS_0), we = read(pr.attributes.WEIGHTS_0);
  pos.forEach((p, k) => { P.push(...p); N.push(...nor[k]); J.push(...jo[k]); const w = we[k], s = w[0] + w[1] + w[2] + w[3] || 1; Wt.push(...w.map(x => x / s)); M.push(Object.keys(MATS).indexOf(mat)); });
  const idx = pr.indices !== undefined ? read(pr.indices).map(e => e[0]) : pos.map((_, k) => k);
  idx.forEach(k => I.push(base + k));
}
// mise à nos mesures : la pose de repos dépliée par la peau, ramenée à HAUT m de haut, sabots à 0, centrée en x et z
const restSkin = skinMats(rest);
const at = (k, S) => { const v = new Vector3(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]), o = new Vector3(); for (let q = 0; q < 4; q++) if (Wt[k * 4 + q] > 0) o.addScaledVector(v.clone().applyMatrix4(S[J[k * 4 + q]]), Wt[k * 4 + q]); return o; };
const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
for (let k = 0; k < P.length / 3; k++) { const v = at(k, restSkin); lo.min(v); hi.max(v); }
const sc = HAUT / (hi.y - lo.y);
// (en long, le milieu du dos, os « Torso2 », en z = 0 : la selle et le cavalier y sont, comme sur le cheval fait par le code)
const t2 = new Vector3().setFromMatrixPosition(worlds(rest)[joints.findIndex(j => g.nodes[j].name === 'Torso2')]);
const FIX = new Matrix4().makeTranslation(-(lo.x + hi.x) / 2 * sc, -lo.y * sc, -t2.z * sc).multiply(new Matrix4().makeScale(sc, sc, sc));
console.log(`cheval : ${(P.length / 3)} sommets, ${I.length / 3} triangles ; ${((hi.x - lo.x) * sc).toFixed(2)} × ${((hi.y - lo.y) * sc).toFixed(2)} × ${((hi.z - lo.z) * sc).toFixed(2)} m`);

// ------------------------------------------------------------------ gestes
function sample(anim, t) {
  const pose = rest.map(p => ({ t: p.t.clone(), r: p.r.clone(), s: p.s.clone() }));
  for (const ch of anim.channels) {
    const sp = anim.samplers[ch.sampler], ti = sp._t ??= read(sp.input).map(e => e[0]), vo = sp._v ??= read(sp.output);
    let k = 0; while (k < ti.length - 2 && ti[k + 1] <= t) k++;
    const a = ti.length > 1 ? Math.min(1, Math.max(0, (t - ti[k]) / ((ti[k + 1] - ti[k]) || 1))) : 0, k1 = Math.min(k + 1, ti.length - 1);
    const p = pose[ch.target.node], v0 = vo[k], v1 = vo[k1];
    if (ch.target.path === 'rotation') p.r.set(...v0).slerp(new Quaternion(...v1), a);
    else if (ch.target.path === 'translation') p.t.set(...v0).lerp(new Vector3(...v1), a);
    else if (ch.target.path === 'scale') p.s.set(...v0).lerp(new Vector3(...v1), a);
  }
  return pose;
}
const clips = {}, rows = [];
for (const [qn, name, loop] of GESTES) {
  const anim = g.animations.find(a => a.name === qn);
  if (!anim) { console.warn(`geste absent : ${qn}`); continue; }
  const dur = Math.max(...anim.samplers.map(s => Math.max(...read(s.input).map(e => e[0])))), n = Math.max(2, Math.round(dur * FPS) + (loop ? 0 : 1));
  clips[name] = { row: rows.length, n, loop };
  for (let f = 0; f < n; f++) {
    const S = skinMats(sample(anim, loop ? f / n * dur : Math.min(dur, f / FPS)));
    rows.push(S.map(m => FIX.clone().multiply(m)));
  }
}
// texture : une ligne par image, 3 texels RGBA (les trois premières lignes de la matrice) par os
const nb = joints.length, data = new Uint16Array(rows.length * nb * 12);
rows.forEach((S, r) => S.forEach((m, b) => {
  const e = m.elements;   // (colonne par colonne)
  for (let k = 0; k < 3; k++) for (let c = 0; c < 4; c++) data[(r * nb + b) * 12 + k * 4 + c] = DataUtils.toHalfFloat(e[c * 4 + k]);
}));
// la place de chaque os en pose de repos, à nos mesures (la selle et le cavalier se posent sur le dos)
const osPos = worlds(rest).map(w => new Vector3().setFromMatrixPosition(FIX.clone().multiply(w)).toArray().map(v => +v.toFixed(3)));
const b64 = a => Buffer.from(a.buffer).toString('base64');
const out = path.resolve(here, '../../../anims');
fs.writeFileSync(path.join(out, 'cheval.bin'), Buffer.from(data.buffer));
fs.writeFileSync(path.join(out, 'cheval.json'), JSON.stringify({
  fps: FPS, bones: joints.map(j => g.nodes[j].name), rows: rows.length, clips, mats: Object.entries(MATS),
  os: osPos, fix: FIX.elements.map(v => +v.toFixed(6)),
  mesh: { n: P.length / 3, pos: b64(new Float32Array(P)), nor: b64(new Float32Array(N)), j: b64(new Uint8Array(J)), w: b64(new Float32Array(Wt)), m: b64(new Uint8Array(M)), idx: b64(new Uint16Array(I)) },
}));
console.log(`${rows.length} images, ${nb} os ; gestes : ${Object.keys(clips).join(', ')}`);
