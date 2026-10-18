#!/usr/bin/env node
// Précalcul des animations des fantassins. Lit les animations de Quaternius (Universal Animation Library 1 et 2, CC0 :
// https://quaternius.com, versions « Standard » gratuites, fichiers glb pour Godot) et écrit, image par image, la
// transformation de chaque os de RIG (troupes.js) depuis la pose de nos figurines (debout, bras le long du corps) :
// web/anims/soldat.bin (matrices 3 × 4 en demi-flottants, une ligne de texture par image) et web/anims/soldat.json.
//
//   node web/js/battle/dev/cuire.mjs AnimationLibrary_Godot_Standard.glb UAL2_Standard.glb
//
// Le squelette de Quaternius a la taille et le sens de nos figurines (1,75 m, face vers +Z, la gauche vers +X) : seuls
// les bras, en croix au repos, sont baissés pour la pose de référence. La bibliothèque 2 a le même squelette, avec les
// noms d'os d'Unreal (UE).
//
// Le fusil et le bras gauche qui le porte ont leurs os à eux (RIG_EXTRA) : portés contre la poitrine dans les
// animations de la bibliothèque, placés ici pour les gestes du fusil (en joue, croisez la baïonnette, recharge, estoc),
// les deux mains posées dessus par cinématique inverse. Le tireur à genoux a les jambes de « Fixing_Kneeling » et le
// buste droit du repos, abaissé d'autant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3, DataUtils } from '../../../vendor/three/three.core.js';
import { RIG, RIG_EXTRA } from '../troupes.js';
import { SALVE_FEU } from '../gestes.js';

const FPS = 24;
// ------------------------------------------------------------------ gestes du fusil
// la figurine dans sa pose de référence (troupes.js, soldier) : épaules, coudes, mains, crosse du fusil (vertical)
const P = (x, y, z) => new Vector3(x, y, z);
const SH = { L: P(0.2, 1.4, 0), R: P(-0.2, 1.4, 0) }, ELBOW = 1.15, HAND = 0.84, BUTT = P(0.235, 0.78, 0.055), UP = P(0, 1, 0), DOWN = P(0, -1, 0);
// déplacement rigide qui porte le point a0 (direction d0) en a1 (direction d1)
const place = (a0, d0, a1, d1) => new Matrix4().makeTranslation(a1.x, a1.y, a1.z)
  .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(d0, d1.clone().normalize())))
  .multiply(new Matrix4().makeTranslation(-a0.x, -a0.y, -a0.z));
// bras à deux os de l'épaule sh à la main hand (tendu au plus), le coude vers pole → [bras, avant-bras]
function arm(side, sh, hand, pole) {
  const L1 = SH.L.y - ELBOW, L2 = ELBOW - HAND, v = hand.clone().sub(sh), d = Math.min(v.length(), (L1 + L2) * 0.999);
  v.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const p = pole.clone().addScaledVector(v, -pole.dot(v)).normalize();
  const elbow = sh.clone().addScaledVector(v, a).addScaledVector(p, h), wrist = sh.clone().addScaledVector(v, d);
  const s0 = SH[side], e0 = P(s0.x, ELBOW, s0.z);
  return [place(s0, DOWN, sh, elbow.clone().sub(sh)), place(e0, DOWN, elbow, wrist.clone().sub(elbow))];
}
// le fusil : crosse en butt, canon vers dir ; main gauche à kl m de la crosse le long du fusil, main droite à kr m (ou
// au point kr)
function hold(M, butt, dir, kl, kr, poleL = P(0.5, -1, -0.2), poleR = P(-1, -0.6, -0.3)) {
  dir = dir.clone().normalize();
  const along = k => butt.clone().addScaledVector(dir, k);
  M.musket = place(BUTT, UP, butt, dir);
  [M.carryUpper, M.carryFore] = arm('L', SH.L.clone().applyMatrix4(M.chest), along(kl), poleL);
  [M.upperR, M.foreR] = arm('R', SH.R.clone().applyMatrix4(M.chest), kr instanceof Vector3 ? kr : along(kr), poleR);
}
const inChest = (M, x, y, z) => P(x, y, z).applyMatrix4(M.chest);
// en joue : la crosse au creux de l'épaule droite, le canon à l'horizontale
const AIM = M => hold(M, inChest(M, -0.12, 1.36, 0.08), P(0.04, -0.02, 1), 0.5, 0.17);
// croisez la baïonnette : la crosse à la hanche droite, la pointe en avant, un peu relevée
const BAYONET = M => hold(M, inChest(M, -0.08, 1.0, 0), P(0.08, 0.3, 1), 0.48, 0.1);
// recharge : la crosse au sol devant soi, la main gauche tient le canon ; la droite déchire la cartouche, la verse, puis
// bourre deux fois avec la baguette (instants en s, point de la main)
const RAM = [[0, -0.06, 1.5, 0.2], [0.6, -0.06, 1.5, 0.2], [0.9, 0.02, 1.5, 0.22], [1.2, 0.02, 1.78, 0.2], [1.5, 0.02, 1.5, 0.22],
  [1.8, 0.02, 1.78, 0.2], [2.1, 0.02, 1.5, 0.22], [2.4, -0.06, 1.5, 0.2]];
const key = (K, t) => {
  let i = 0;
  while (i < K.length - 2 && K[i + 1][0] <= t) i++;
  const [t0, ...a] = K[i], [t1, ...b] = K[i + 1], f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return P(...a.map((v, j) => v + (b[j] - v) * f));
};
const RELOAD = (M, t) => hold(M, P(0.08, 0.02, 0.3), P(0, 1, -0.07), 1.0, key(RAM, t % 2.4));
// estoc : on pousse la baïonnette en avant, puis on la ramène
const THRUST = (M, t) => hold(M, inChest(M, -0.08, 1.05, 0.3 * Math.sin(Math.PI * Math.min(1, (t % 0.9) / 0.6))), P(0.05, 0.15, 1), 0.48, 0.1);
// le coup part : la crosse recule dans l'épaule, le canon se relève, puis revient en joue
const FIRE = (M, t) => { const k = Math.max(0, 1 - t / 0.25); hold(M, inChest(M, -0.12, 1.36, 0.08 - 0.05 * k), P(0.04, -0.02 + 0.25 * k, 1), 0.5, 0.17); };
// tambour : les baguettes battent la caisse portée à la ceinture, n coups de chaque main par boucle de L s (la boucle
// se raccorde)
const drum = (L, n) => (M, t) => {
  const hit = k => P(0.12 - k * 0.08, 0.95 + 0.12 * Math.max(0, Math.sin(2 * Math.PI * n * t / L + k * Math.PI)), 0.26).applyMatrix4(M.hips);
  [M.upperL, M.foreL] = arm('L', SH.L.clone().applyMatrix4(M.chest), hit(0), P(0.5, -1, -0.2));
  [M.upperR, M.foreR] = arm('R', SH.R.clone().applyMatrix4(M.chest), hit(1), P(-1, -0.6, -0.3));
};
// geste en plusieurs temps : [[durée, geste], …] ; d'un temps au suivant, fondu de TR s (le temps de lever l'arme)
const TR = 0.3, REST = () => {};
const copy = M => Object.fromEntries(Object.entries(M).map(([k, m]) => [k, m.clone()]));
const seq = steps => (M, t) => {
  let i = 0, t0 = 0;
  while (i < steps.length - 1 && t >= t0 + steps[i][0]) t0 += steps[i++][0];
  const A = copy(M);
  steps[i][1](A, t - t0);
  let w = i > 0 && t - t0 < TR ? (t - t0) / TR : 1;
  if (w >= 1) { Object.assign(M, A); return; }
  const B = copy(M);
  steps[i - 1][1](B, steps[i - 1][0]);
  w = w * w * (3 - 2 * w);
  for (const k of Object.keys(M)) M[k].elements = B[k].elements.map((b, j) => b * (1 - w) + A[k].elements[j] * w);
};
// salve : épauler, viser, le coup (à SALVE_FEU s, gestes.js), recharger, l'arme sur l'épaule ; à genoux, le premier rang
// garde l'arme en main pendant que les autres rechargent
const SALVE = [[0.35, REST], [0.35, AIM], [0.25, FIRE], [0.45, AIM], [2.4, RELOAD], [0.5, REST]];
const SALVE_GENOU = [[0.35, REST], [0.35, AIM], [0.25, FIRE], [0.45, AIM], [2.9, REST]];
if (SALVE[0][0] + SALVE[1][0] !== SALVE_FEU || SALVE_GENOU[0][0] + SALVE_GENOU[1][0] !== SALVE_FEU) throw new Error('instant du coup');

// nom chez nous → animation de la bibliothèque (src), en boucle, durée (len, sinon celle de src), geste du fusil
// (hold), jambes d'une autre animation à l'image donnée (legs)
const CLIPS = {
  repos: { src: 'Idle_Loop', loop: 1 }, parle: { src: 'Idle_Talking_Loop', loop: 1 }, marche: { src: 'Walk_Formal_Loop', loop: 1 },
  pas: { src: 'Walk_Loop', loop: 1 }, trot: { src: 'Jog_Fwd_Loop', loop: 1 }, course: { src: 'Sprint_Loop', loop: 1 },
  joue: { src: 'Idle_Loop', loop: 1, hold: AIM }, genou: { src: 'Idle_Loop', loop: 1, hold: AIM, legs: ['Fixing_Kneeling', 24] },
  recharge: { src: 'Idle_Loop', loop: 1, len: 2.4, hold: RELOAD }, charge: { src: 'Sprint_Loop', loop: 1, hold: BAYONET },
  estoc: { src: 'Punch_Jab', loop: 1, len: 0.9, hold: THRUST }, poussee: { src: 'Push_Loop', loop: 1, hold: BAYONET },
  mort: { src: 'Death01', loop: 0 }, touche: { src: 'Hit_Chest', loop: 0 }, tete: { src: 'Hit_Head', loop: 0 },
  projete: { src: 'Hit_Knockback', loop: 0 }, sabre: { src: 'Sword_Attack', loop: 0 }, garde: { src: 'Sword_Idle', loop: 1 },
  combo: { src: 'Sword_Regular_Combo', loop: 0 },
  salve: { src: 'Idle_Loop', loop: 0, len: 4.3, hold: seq(SALVE) },
  'salve-genou': { src: 'Idle_Loop', loop: 0, len: 4.3, hold: seq(SALVE_GENOU), legs: ['Fixing_Kneeling', 24] },
  'feu-libre': { src: 'Idle_Loop', loop: 1, len: 4.4, hold: seq([[0.5, REST], [0.6, AIM], [0.25, FIRE], [0.35, AIM], [2.4, RELOAD], [0.3, REST]]) },
  tambour: { src: 'Idle_Loop', loop: 1, hold: drum(2.5, 5) }, 'tambour-marche': { src: 'Walk_Formal_Loop', loop: 1, hold: drum(4 / 3, 2) },
};

const UE = { 'DEF-hips': 'pelvis', 'DEF-spine.003': 'spine_03', 'DEF-head': 'Head', 'DEF-upper_arm.L': 'upperarm_l', 'DEF-forearm.L': 'lowerarm_l',
  'DEF-upper_arm.R': 'upperarm_r', 'DEF-forearm.R': 'lowerarm_r', 'DEF-thigh.L': 'thigh_l', 'DEF-shin.L': 'calf_l', 'DEF-foot.L': 'foot_l',
  'DEF-thigh.R': 'thigh_r', 'DEF-shin.R': 'calf_r', 'DEF-foot.R': 'foot_r' };

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../anims');
const files = process.argv.slice(2);
if (!files.length) { console.error('usage : node cuire.mjs bibliotheque.glb [bibliotheque2.glb]'); process.exit(2); }

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} : pas un glb`);
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = b.subarray(20 + jl + 8);
  const N = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  const acc = i => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], n = N[a.type];
    if (a.componentType !== 5126 || a.sparse || (v.byteStride && v.byteStride !== n * 4)) throw new Error(`${file} : accesseur ${i} non géré`);
    const o = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
    return new Float32Array(bin.buffer.slice(o, o + a.count * n * 4));
  };
  const parent = [];
  j.nodes.forEach((nd, i) => (nd.children || []).forEach(c => { parent[c] = i; }));
  const byName = new Map(j.nodes.map((nd, i) => [nd.name, i]));
  const anims = new Map((j.animations || []).map(a => [a.name, a]));
  // nœud de chaque os de RIG, sous son nom Rigify (DEF-…) ou Unreal
  const bones = Object.values(RIG).map(n => {
    const i = byName.get(n) ?? byName.get(UE[n]);
    if (i == null) throw new Error(`${file} : os ${n} absent`);
    return i;
  });
  return { j, acc, parent, byName, anims, bones };
}

// pose d'un fichier à l'instant t de l'animation a (null : la pose de repos) → matrice monde de chaque nœud demandé
function poser(g, a, t) {
  const trs = g.j.nodes.map(nd => ({ t: new Vector3(...(nd.translation || [0, 0, 0])), r: new Quaternion(...(nd.rotation || [0, 0, 0, 1])), s: new Vector3(...(nd.scale || [1, 1, 1])) }));
  for (const ch of a?.channels || []) {
    const sm = a.samplers[ch.sampler];
    if (sm.interpolation === 'CUBICSPLINE') throw new Error(`${a.name} : interpolation non gérée`);
    const T = sm._in ||= g.acc(sm.input), V = sm._out ||= g.acc(sm.output);
    let k = 0;
    while (k < T.length - 2 && T[k + 1] <= t) k++;
    const f = sm.interpolation === 'STEP' || T.length < 2 ? 0 : Math.min(1, Math.max(0, (t - T[k]) / (T[k + 1] - T[k] || 1)));
    const p = trs[ch.target.node], path = ch.target.path, n = path === 'rotation' ? 4 : 3;
    if (path === 'rotation') p.r.fromArray(V, k * 4).slerp(new Quaternion().fromArray(V, Math.min(k + 1, T.length - 1) * 4), f);
    else if (path === 'translation' || path === 'scale') {
      const v = path === 'translation' ? p.t : p.s;
      v.fromArray(V, k * n).lerp(new Vector3().fromArray(V, Math.min(k + 1, T.length - 1) * n), f);
    }
  }
  const memo = new Map();
  const world = i => {
    if (memo.has(i)) return memo.get(i);
    const m = new Matrix4().compose(trs[i].t, trs[i].r, trs[i].s);
    if (g.parent[i] != null) m.premultiply(world(g.parent[i]));
    memo.set(i, m);
    return m;
  };
  return world;
}

const libs = files.map(readGlb), K = Object.keys(RIG);
// pose de référence de chaque fichier : celle du repos, les bras baissés le long du corps (rotation autour de l'épaule)
const restOf = g => poser(g, null, 0);
for (const g of libs) {
  const rest = restOf(g);
  g.refInv = K.map((k, b) => {
    const m = rest(g.bones[b]).clone(), side = /[LR]$/.exec(k)?.[0];
    if (side && /upper|fore/.test(k)) {
      const sh = new Vector3().setFromMatrixPosition(rest(g.bones[K.indexOf('upper' + side)]));
      m.premultiply(new Matrix4().makeTranslation(sh.x, sh.y, sh.z).multiply(new Matrix4().makeRotationZ(side === 'L' ? -Math.PI / 2 : Math.PI / 2)).multiply(new Matrix4().makeTranslation(-sh.x, -sh.y, -sh.z)));
    }
    return m.invert();
  });
}

// animation src d'une bibliothèque : sa durée, et la matrice de chaque os de RIG à l'instant t
function source(src) {
  const g = libs.find(l => l.anims.has(src));
  if (!g) throw new Error(`animation ${src} introuvable`);
  const a = g.anims.get(src), dur = Math.max(...a.samplers.map(s => g.j.accessors[s.input].max[0]));
  return { dur, at: t => { const world = poser(g, a, t); return Object.fromEntries(K.map((k, b) => [k, world(g.bones[b]).clone().multiply(g.refInv[b])])); } };
}
const UPPER = ['hips', 'chest', 'head', 'upperL', 'foreL', 'upperR', 'foreR'], HIP = P(0, 0.92, 0);
const NAMES = [...K, ...RIG_EXTRA], rows = [], clips = {};
for (const [name, { src, loop, len, hold: gesture, legs }] of Object.entries(CLIPS)) {
  const S = source(src), dur = len ?? S.dur;
  const n = loop ? Math.max(1, Math.round(dur * FPS)) : Math.floor(dur * FPS) + 1;
  const kneel = legs && source(legs[0]).at(legs[1] / FPS);
  clips[name] = { row: rows.length, n, loop };
  for (let k = 0; k < n; k++) {
    const t = Math.min(k / FPS, dur), M = S.at(loop || gesture ? t % S.dur : Math.min(t, S.dur));
    if (kneel) {
      // le haut du corps descend avec les hanches ; les jambes sont celles de l'autre animation
      const d = HIP.clone().applyMatrix4(kneel.hips).sub(HIP.clone().applyMatrix4(M.hips)), T = new Matrix4().makeTranslation(d.x, d.y, d.z);
      for (const b of K) M[b] = UPPER.includes(b) ? M[b].premultiply(T) : kneel[b].clone();
    }
    for (const b of RIG_EXTRA) M[b] = M.chest.clone();   // le fusil porté contre la poitrine
    gesture?.(M, t);
    const row = [];
    for (const b of NAMES) {
      const e = M[b].elements;   // (colonnes) : on écrit les trois premières lignes
      row.push(e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]);
    }
    if (!row.every(Number.isFinite)) throw new Error(`${name} : image ${k} invalide`);
    rows.push(row);
  }
}
// contrôle : au repos, chaque os hors des bras est à sa place de référence (matrice identité)
for (const g of libs) {
  const rest = restOf(g), I = new Matrix4().elements;
  K.forEach((k, b) => {
    const e = rest(g.bones[b]).clone().multiply(g.refInv[b]).elements;
    if (!/upper|fore/.test(k) && e.some((v, i) => Math.abs(v - I[i]) > 1e-4)) throw new Error(`référence fausse : ${k}`);
  });
}

fs.mkdirSync(OUT, { recursive: true });
const half = new Uint16Array(rows.length * rows[0].length);
rows.flat().forEach((v, i) => { half[i] = DataUtils.toHalfFloat(v); });
fs.writeFileSync(path.join(OUT, 'soldat.bin'), Buffer.from(half.buffer));
fs.writeFileSync(path.join(OUT, 'soldat.json'), JSON.stringify({ fps: FPS, bones: NAMES, rows: rows.length, clips }, null, 1) + '\n');
console.log(`${Object.keys(clips).length} animations, ${rows.length} images, ${(half.byteLength / 1024).toFixed(0)} Ko → ${OUT}`);
