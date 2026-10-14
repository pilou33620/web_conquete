// Vue tactique : le décor du champ de bataille en 3D (arbres ; maisons, église, moulins, ponts, portes ; remparts,
// tranchées, haies, murets, clôtures), d'après les données de la carte et ce que terrain.js en a déduit (treeGrid,
// bridges, gates…). Modèles simples construits ici, couleurs de la saison.
//
// Arbres : un lot par sorte (feuillu, pin parasol, sapin, peuplier, buisson, arbre nu, meule) et par zone de 750 m,
// pour que seules les zones vues soient envoyées à la carte graphique ; la couronne prend la couleur de l'arbre
// (instanceColor), le tronc est à part. En qualité basse, une partie des arbres des bois est omise.
// Bâti (maisons et fermes à toit à deux pans, église et clocher, moulins, ponts, portes de ville) : une seule
// géométrie fixe, couleurs par sommet ; murs enfoncés sous le sol au pied, pour ne jamais flotter sur une pente.
import * as THREE from '../../vendor/three/three.module.js';
import { hash, clamp } from './formes.js';

const ZONE = 750;
const TRUNK = '#5a4430', BARE = '#7d6d5e';

// géométries d'une sorte d'arbre, pour un rayon de couronne de 1 (l'instance les met à l'échelle) : [couronne, tronc]
function crownGeo(kind, detail) {
  const ico = (sx, sy, sz, y, seed) => {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      // couronne bosselée, plus sombre dessous
      const x = p.getX(i), yy = p.getY(i), z = p.getZ(i), k = 0.86 + 0.28 * hash((x * 7) | 0, (z * 7) | 0, seed + ((yy * 7) | 0));
      p.setXYZ(i, x * sx * k, yy * sy * k + y, z * sz * k);
      const c = 0.72 + 0.28 * (yy * 0.5 + 0.5) + (hash(i, 3, seed) - 0.5) * 0.12;
      col.push(c, c, c);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  const shaded = (g, top = 1, bottom = 0.7) => {
    const p = g.attributes.position, col = [];
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
    for (let i = 0; i < p.count; i++) { const c = bottom + (top - bottom) * (p.getY(i) - y0) / Math.max(1e-3, y1 - y0); col.push(c, c, c); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  };
  const trunk = (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 5).translate(0, h / 2, 0);
  switch (kind) {
    case 'sapin': return [merge([new THREE.ConeGeometry(0.75, 1.3, 7).translate(0, 1.15, 0), new THREE.ConeGeometry(0.6, 1.15, 7).translate(0, 1.8, 0), new THREE.ConeGeometry(0.42, 0.95, 7).translate(0, 2.45, 0)].map(g => shaded(g.toNonIndexed()))), trunk(0.07, 0.1, 0.8)];
    case 'parasol': return [ico(1.15, 0.42, 1.15, 2.25, 31), trunk(0.06, 0.1, 2.1)];
    case 'peuplier': return [ico(0.42, 2.1, 0.42, 2.6, 41), trunk(0.06, 0.09, 0.9)];
    case 'buisson': return [ico(1, 0.75, 1, 0.6, 51), null];
    case 'meule': return [shaded(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.3, 1).toNonIndexed(), 1, 0.75), null];
    case 'nu': {
      // arbre nu de l'hiver : le tronc et quelques branches
      const parts = [trunk(0.08, 0.12, 1.6)];
      for (let k = 0; k < 5; k++) parts.push(new THREE.CylinderGeometry(0.025, 0.05, 1.1, 4).translate(0, 0.55, 0).rotateZ(0.75).rotateY(k * 1.26 + 0.3).translate(0, 1.1 + (k % 2) * 0.35, 0));
      return [null, merge(parts.map(g => g.toNonIndexed()))];
    }
    default: return [ico(1, 0.85, 1, 1.55, 21), trunk(0.09, 0.13, 1)];
  }
}
// géométries (sans index) réunies en une
function merge(list) {
  const out = new THREE.BufferGeometry(), names = ['position', 'normal', 'color'].filter(n => list[0].attributes[n]);
  for (const n of names) {
    const size = list[0].attributes[n].itemSize, arr = new Float32Array(list.reduce((a, g) => a + g.attributes[n].count * size, 0));
    let o = 0;
    for (const g of list) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  for (const g of list) g.dispose();
  return out;
}

// toit à deux pans (longueur L le long de x, largeur D, hauteur h), posé en y = 0 ; gables : seulement les pignons
function gable(L, D, h, gables = false) {
  const x = L / 2, z = D / 2, v = [];
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  const A = [-x, 0, -z], B = [x, 0, -z], C = [x, 0, z], E = [-x, 0, z], R0 = [-x, h, 0], R1 = [x, h, 0];
  if (gables) { tri(A, E, R0); tri(C, B, R1); }
  else { tri(A, R0, R1); tri(A, R1, B); tri(E, C, R1); tri(E, R1, R0); tri(A, B, R1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
// couleur unie par sommet
function paint(g, c) {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}

export class Decor {
  // terrain : Terrain (treeGrid, palette) ; relief : Relief (altitudes) ; q : profil de qualité
  constructor(terrain, relief, q) {
    this.t = terrain; this.r = relief; this.q = q;
    this.group = new THREE.Group();
    this.disposables = [];
    this.trees();
    this.built();
  }
  trees() {
    const t = this.t, pal = t.pal, snow = pal.neige, fx = this.q.fx ?? 2;
    // bois et forêts allégés selon la qualité (les arbres isolés et les lisières restent)
    const keep = [0.45, 0.7, 1, 1][fx];
    const zones = new Map();   // "zone|sorte" → [arbres]
    const W = t.cols, isWood = c => c >= 0 && c < t.t.length && (t.t[c] === 4 || t.t[c] === 5);   // BOIS, FORET
    t.treeGrid.forEach((list, c) => {
      const wood = isWood(c);
      // au cœur d'un bois (entouré de bois), on ne voit jamais les troncs
      const deep = wood && isWood(c - 1) && isWood(c + 1) && isWood(c - W) && isWood(c + W);
      for (const tr of list) {
        if (wood && hash(tr.x | 0, tr.y | 0, 7) > keep) continue;
        const key = `${Math.floor(tr.x / ZONE)},${Math.floor(tr.y / ZONE)}|${tr.kind}${deep && tr.kind !== 'nu' ? '|cime' : ''}`;
        let z = zones.get(key); if (!z) zones.set(key, z = []);
        z.push(tr);
      }
    });
    const geos = new Map(), detail = fx >= 2 ? 1 : 0;
    const crownMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const trunkMat = new THREE.MeshLambertMaterial({ color: snow ? '#4a3c30' : TRUNK });
    const bareMat = new THREE.MeshLambertMaterial({ color: BARE });
    this.disposables.push(crownMat, trunkMat, bareMat);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const [key, list] of zones) {
      const [, kind, cime] = key.split('|');
      if (!geos.has(kind)) { const g = crownGeo(kind, detail); geos.set(kind, g); this.disposables.push(...g.filter(Boolean)); }
      const [crown, trunk] = geos.get(kind);
      const mk = (geo, mat, tint) => {
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((tr, i) => {
          p.set(tr.x, this.r.heightAt(tr.x, tr.y) - 0.1, tr.y);
          q.setFromAxisAngle(up, hash(tr.x | 0, tr.y | 0, 3) * Math.PI * 2);
          const r = tr.r * (0.92 + hash(tr.x | 0, tr.y | 0, 5) * 0.16);
          mesh.setMatrixAt(i, m.compose(p, q, s.set(r, r, r)));
          if (tint) mesh.setColorAt(i, tint(tr, col));
        });
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      };
      if (crown) mk(crown, crownMat, (tr, c) => {
        c.set(kind === 'sapin' || kind === 'parasol' ? pal.pins[(tr.ci ?? 0) % pal.pins.length] : kind === 'meule' ? (snow ? '#e4e7ea' : '#c8a659') : pal.arbres[(tr.ci ?? 0) % pal.arbres.length]);
        if (snow && kind !== 'meule') c.lerp(new THREE.Color('#d8dde0'), 0.25);
        return c.multiplyScalar(0.9 + hash(tr.x | 0, tr.y | 0, 9) * 0.2);
      });
      if (trunk && !cime) mk(trunk, kind === 'nu' ? bareMat : trunkMat, null);
    }
  }
  // ------------------------------------------------------------------ bâti
  built() {
    const t = this.t, pal = t.pal, snow = pal.neige, h = this.r.heightAt;
    const montagne = t.hmax > 55, landes = t.landesLike();
    const WALLS = montagne ? ['#f2efe8', '#ebe6dc'] : landes ? ['#f1ebdf', '#e9e1d0'] : ['#e8dcbc', '#dfd0aa', '#eadfc4'];
    const P = [];   // [géométrie, couleur]
    // pièce posée sur le terrain : (u, v) dans le repère du bâtiment (u le long de w), tournée de a, y depuis le pied
    const place = (g, b, u, v, y) => g.rotateY(-(b.a || 0)).translate(b.x + u * Math.cos(b.a || 0) - v * Math.sin(b.a || 0), y, b.y + u * Math.sin(b.a || 0) + v * Math.cos(b.a || 0));
    for (const b of t.buildings) {
      const kind = b.kind || 'maison', k = Math.abs((b.x * 7 + b.y * 13) | 0);
      const ground = Math.min(...t.corners(b).map(([x, y]) => h(x, y)), h(b.x, b.y));
      const H = kind === 'eglise' ? 10 : kind === 'moulin' ? 9 : kind === 'ferme' ? 5.5 : 5;
      const wall = kind === 'eglise' ? '#d9ccb0' : WALLS[k % WALLS.length];
      const roof = snow ? '#eef1f4' : (kind === 'eglise' || montagne ? pal.ardoise : pal.toit)[k % (kind === 'eglise' || montagne ? pal.ardoise : pal.toit).length];
      if (kind === 'moulin') {
        const r = Math.max(b.w, b.h) / 2;
        P.push([place(new THREE.CylinderGeometry(r * 0.85, r, H + 1, 10), b, 0, 0, ground + H / 2 - 0.5), wall]);
        P.push([place(new THREE.ConeGeometry(r * 1.05, r * 1.6, 10), b, 0, 0, ground + H + r * 0.8), roof]);
        // ailes : quatre bras de bois et leurs toiles, face au vent du nord-ouest
        for (let q = 0; q < 4; q++) {
          const a = q * Math.PI / 2 + 0.4;
          P.push([place(new THREE.BoxGeometry(0.3, r * 2.5, 0.2).translate(0, r * 1.25, 0).rotateZ(a).translate(0, 0, r + 0.4), b, 0, 0, ground + H - 0.5), '#5a4630']);
          P.push([place(new THREE.BoxGeometry(r * 0.75, r * 1.9, 0.06).translate(r * 0.42, r * 1.45, 0).rotateZ(a).translate(0, 0, r + 0.5), b, 0, 0, ground + H - 0.5), '#ece4d0']);
        }
        continue;
      }
      // murs (enfoncés d'un mètre), toit à deux pans dans la longueur, pignons
      const long = b.w >= b.h, L = Math.max(b.w, b.h), D = Math.min(b.w, b.h), rh = D * (montagne ? 0.55 : 0.4);
      P.push([place(new THREE.BoxGeometry(b.w, H + 1, b.h), b, 0, 0, ground + (H - 1) / 2), wall]);
      const roofG = gable(L + 0.6, D + 0.6, rh);
      if (!long) roofG.rotateY(Math.PI / 2);
      P.push([place(roofG, b, 0, 0, ground + H), roof]);
      const gab = gable(L - 0.02, D, rh * 0.97, true);
      if (!long) gab.rotateY(Math.PI / 2);
      P.push([place(gab, b, 0, 0, ground + H), wall]);
      // fenêtres et porte sur les longs murs
      if (kind !== 'eglise') for (const side of [1, -1]) for (let f = -1; f <= 1; f++) {
        const door = f === 0 && side === 1, along = f * L * 0.28;
        const g = new THREE.BoxGeometry(door ? 1.1 : 0.9, door ? 2.1 : 1.1, 0.08);
        const [u, v] = long ? [along, side * (b.h / 2 + 0.02)] : [side * (b.w / 2 + 0.02), along];
        if (!long) g.rotateY(Math.PI / 2);
        P.push([place(g, b, u, v, ground + (door ? 1.05 : H * 0.62)), door ? '#5a4030' : '#34404c']);
      }
      if (kind !== 'eglise' && k % 3) P.push([place(new THREE.BoxGeometry(0.7, 1.8, 0.7), b, (long ? 1 : 0) * L * 0.25, (long ? 0 : 1) * L * 0.25, ground + H + rh * 0.6), '#8a7a66']);
      if (kind === 'eglise') {
        // clocher carré à un bout de la nef, flèche d'ardoise
        const tu = -(b.w / 2 + 3.2);
        P.push([place(new THREE.BoxGeometry(6.5, 23, 6.5), b, tu, 0, ground + 10.5), '#d9ccb0']);
        P.push([place(new THREE.ConeGeometry(4.9, 10, 4).rotateY(Math.PI / 4), b, tu, 0, ground + 27), snow ? '#eef1f4' : pal.ardoise[0]]);
        P.push([place(new THREE.BoxGeometry(1.4, 2.4, 6.6), b, tu, 0, ground + 17), '#3b2c1c']);
      }
    }
    // ponts : tablier de pierre et parapets, au-dessus de l'eau
    for (const br of t.bridges) {
      const b = { x: br.x, y: br.y, a: br.a }, y = Math.max(h(br.x - Math.cos(br.a) * br.len / 2, br.y - Math.sin(br.a) * br.len / 2), h(br.x + Math.cos(br.a) * br.len / 2, br.y + Math.sin(br.a) * br.len / 2)) + 0.4;
      P.push([place(new THREE.BoxGeometry(br.len, 1.2, 9), b, 0, 0, y - 0.3), snow ? '#d9d9d6' : '#cdbf9e']);
      for (const s of [1, -1]) P.push([place(new THREE.BoxGeometry(br.len, 0.9, 0.6), b, 0, s * 4.4, y + 0.6), '#9c8b6a']);
    }
    // portes de ville : deux tours de part et d'autre de la route, le linteau au-dessus
    for (const gt of t.gates) {
      const b = { x: gt.x, y: gt.y, a: gt.a + Math.PI / 2 }, y = h(gt.x, gt.y);
      for (const s of [1, -1]) P.push([place(new THREE.BoxGeometry(5, 10, 7), b, s * 5, 0, y + 4.5), snow ? '#e8eaec' : '#cdbf9c'], [place(new THREE.ConeGeometry(4.2, 4, 4).rotateY(Math.PI / 4), b, s * 5, 0, y + 11.5), snow ? '#eef1f4' : pal.ardoise[0]]);
      P.push([place(new THREE.BoxGeometry(5.2, 3, 7), b, 0, 0, y + 8), snow ? '#e8eaec' : '#c4b592']);
    }
    if (!P.length) return;
    const geo = merge(P.map(([g, c]) => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return paint(n, c); }));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(geo, mat);
    this.group.add(new THREE.Mesh(geo, mat));
  }
  setQuality(q) { this.q = q; }
  dispose() { for (const d of this.disposables) d.dispose(); for (const o of this.group.children) o.dispose?.(); }
}
