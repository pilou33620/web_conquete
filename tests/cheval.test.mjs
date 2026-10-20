// Banc du cheval précalculé (web/anims/cheval.*, dev/cheval.mjs ; troupes.js le charge) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le shader lit les matrices des os par leur rang et les gestes par leur nom (troupes.js,
// HCLIPS) : un fichier recalculé avec d'autres gestes, d'autres os ou des poids mal normés déformerait tous les chevaux
// sans rien faire planter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'anims');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'cheval.json'), 'utf8'));
const bin = fs.readFileSync(path.join(dir, 'cheval.bin'));
const arr = (s, T) => { const b = Buffer.from(s, 'base64'); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };

test('les gestes dont le shader a besoin, dans les lignes de la texture', () => {
  for (const c of ['repos', 'repos2', 'broute', 'pas', 'galop', 'mort', 'ruade', 'touche']) {
    const k = meta.clips[c];
    assert.ok(k && k.n >= 2 && k.row + k.n <= meta.rows, c);
  }
  assert.equal(meta.clips.mort.loop, 0, 'la mort ne boucle pas');
  assert.equal(bin.byteLength, meta.rows * meta.bones.length * 12 * 2, 'trois texels de demi-flottants par os et par image');
});

test('le maillage : quatre os et des poids qui font 1 par sommet, des os qui existent', () => {
  const n = meta.mesh.n, j = arr(meta.mesh.j, Uint8Array), w = arr(meta.mesh.w, Float32Array), idx = arr(meta.mesh.idx, Uint16Array);
  assert.equal(j.length, n * 4); assert.equal(w.length, n * 4);
  for (let i = 0; i < n; i++) {
    const s = w[i * 4] + w[i * 4 + 1] + w[i * 4 + 2] + w[i * 4 + 3];
    assert.ok(Math.abs(s - 1) < 1e-3, `sommet ${i} : ${s}`);
    for (let q = 0; q < 4; q++) assert.ok(j[i * 4 + q] < meta.bones.length);
  }
  assert.ok(idx.every(k => k < n));
  assert.ok(idx.length / 3 < 4000, 'léger : des centaines de chevaux à l’écran');
});

test('à nos mesures : le dos à hauteur de selle, au milieu de la longueur', () => {
  const at = name => meta.os[meta.bones.indexOf(name)];
  const t2 = at('Torso2');
  assert.ok(Math.abs(t2[2]) < 0.01, 'milieu du dos en z = 0');
  assert.ok(t2[1] > 1.0 && t2[1] < 1.35, `dos à ${t2[1]} m`);
  assert.ok(at('Head')[2] > 0.5, 'la tête vers +Z');
});
