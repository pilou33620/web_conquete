// Vue tactique : le décor du champ de bataille en 3D (arbres ; maisons, église, moulins, ponts, portes ; remparts,
// tranchées, haies, murets, clôtures), d'après les données de la carte et ce que terrain.js en a déduit (treeGrid,
// bridges, gates…). Modèles simples construits ici, couleurs de la saison.
//
// Arbres : un lot par sorte (feuillu, pin parasol, sapin, peuplier, buisson, arbre nu, meule) et par zone de 750 m,
// pour que seules les zones vues soient envoyées à la carte graphique ; la couronne prend la couleur de l'arbre
// (instanceColor), le tronc est à part. En qualité basse, une partie des arbres des bois est omise. La couronne est
// faite de touffes arrondies (normales lisses), plus sombres dessous ; une zone proche de la caméra a des touffes plus
// fines. Dans les bois, sous un régiment, la couronne s'efface (masque des clairières) : on voit les troupes.
// Étape 9d : dans les bois, les couronnes sont plus larges (plus encore quand la qualité éclaircit les bois) et se
// touchent : une canopée continue au toit bosselé ; leur teinte suit un bruit à grande échelle (un bois a des nappes
// plus jaunes ou plus bleues), avec quelques arbres plus clairs ou plus sombres. Le feuillage (feuillage) a une
// lumière enveloppante, laisse passer le soleil à contre-jour, et se balance au vent.
// Bâti (maisons et fermes à toit à deux pans, église et clocher, moulins, ponts, portes de ville) : une seule
// géométrie fixe, couleurs par sommet ; murs enfoncés sous le sol au pied, pour ne jamais flotter sur une pente.
// Enceintes et clôtures (remparts et bastions, murs de ville crénelés, murs de clôture, tranchées et gabions,
// barricades, redoutes, haies, murets, clôtures de bois) : des bandes extrudées le long de leur tracé, qui suivent le
// relief, coupées sur l'eau, aux portes et aux brèches (reconstruites à chaque brèche ouverte, avec leurs éboulis).
import * as THREE from '../../vendor/three/three.module.js';
import { hash, clamp, T, vnoise } from './formes.js';
import { resample, offsetPts } from './terrain.js';

const ZONE = 750, CL = 4;   // côté d'une zone d'arbres ; pixel du masque des clairières (m)
const NEAR_ON = 300, NEAR_OFF = 360;   // une zone à moins de 300 m de l'œil prend ses touffes fines (elle les garde jusqu'à 360 m)
const TRUNK = '#5a4430', BARE = '#7d6d5e';

// géométries d'une sorte d'arbre, pour un rayon de couronne de 1 (l'instance les met à l'échelle) : [couronne, tronc]
// detail : finesse de la touffe centrale (0 ou 1 ; les autres restent à 0 : la passe d'ombre les dessine aussi) ;
// lumps : nombre de touffes d'un feuillu (1, 3 ou 5 selon la qualité)
function crownGeo(kind, detail, lumps = 5) {
  // une touffe : ellipsoïde bosselé de rayons (sx, sy, sz), centré en (cx, y, cz) ; normale de l'ellipsoïde (lisse :
  // l'icosaèdre de Three.js n'a pas de sommets partagés) ; plus sombre dessous et vers le cœur de la couronne
  const ico = (sx, sy, sz, y, seed, cx = 0, cz = 0, det = detail) => {
    const g = new THREE.IcosahedronGeometry(1, det), p = g.attributes.position, nor = [], col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), yy = p.getY(i), z = p.getZ(i), k = 0.88 + 0.24 * hash((x * 7) | 0, (z * 7) | 0, seed + ((yy * 7) | 0));
      p.setXYZ(i, x * sx * k + cx, yy * sy * k + y, z * sz * k + cz);
      const n = new THREE.Vector3(x / sx, yy / sy, z / sz).normalize();
      nor.push(n.x, n.y, n.z);
      const out = (x * cx + z * cz) > 0 || (!cx && !cz) ? 1 : 0.9;
      const c = (0.62 + 0.38 * (yy * 0.5 + 0.5)) * out + (hash(i, 3, seed) - 0.5) * 0.1;
      col.push(c, c, c);
    }
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  };
  // couronne de feuillu : une touffe au cœur, d'autres autour et au sommet
  const LUMPS = [[0.72, 0.62, 0.72, 1.5, 0, 0], [0.52, 0.48, 0.52, 1.42, 0.48, 0.12], [0.5, 0.46, 0.5, 1.36, -0.32, 0.42], [0.5, 0.46, 0.5, 1.46, -0.26, -0.44], [0.46, 0.42, 0.46, 2.0, 0.06, -0.04]];
  const clump = (s, dy, seed, n = lumps) => n === 1 ? ico(s, 0.85 * s, s, 1.55 * s + dy, seed)
    : merge(LUMPS.slice(0, n === 3 ? 3 : 5).map(([a, b, c, y, x, z], i) => ico(a * s * (n === 3 ? 1.12 : 1), b * s * (n === 3 ? 1.12 : 1), c * s * (n === 3 ? 1.12 : 1), y * s + dy, seed + i, x * s, z * s, i ? 0 : detail)));
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
    case 'parasol': return [lumps === 1 ? ico(1.15, 0.42, 1.15, 2.25, 31) : merge([ico(0.85, 0.36, 0.85, 2.25, 31), ico(0.55, 0.3, 0.55, 2.2, 32, 0.55, 0.2, 0), ico(0.55, 0.3, 0.55, 2.3, 33, -0.45, -0.35, 0)]), trunk(0.06, 0.1, 2.1)];
    case 'peuplier': return [lumps === 1 ? ico(0.42, 2.1, 0.42, 2.6, 41) : merge([ico(0.42, 1.3, 0.42, 2.2, 41), ico(0.36, 1.1, 0.36, 3.3, 42, 0.04, 0.05, 0), ico(0.3, 0.8, 0.3, 4.1, 43, 0, 0, 0)]), trunk(0.06, 0.09, 0.9)];
    case 'buisson': return [lumps === 1 ? ico(1, 0.75, 1, 0.6, 51) : merge([ico(0.75, 0.6, 0.75, 0.55, 51), ico(0.55, 0.45, 0.55, 0.5, 52, 0.5, 0.2, 0), ico(0.5, 0.42, 0.5, 0.5, 53, -0.4, -0.35, 0)]), null];
    case 'meule': return [shaded(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.3, 1).toNonIndexed(), 1, 0.75), null];
    case 'nu': {
      // arbre nu de l'hiver : le tronc et quelques branches
      const parts = [trunk(0.08, 0.12, 1.6)];
      for (let k = 0; k < 5; k++) parts.push(new THREE.CylinderGeometry(0.025, 0.05, 1.1, 4).translate(0, 0.55, 0).rotateZ(0.75).rotateY(k * 1.26 + 0.3).translate(0, 1.1 + (k % 2) * 0.35, 0));
      return [null, merge(parts.map(g => g.toNonIndexed()))];
    }
    default: return [clump(1, 0, 21), trunk(0.09, 0.13, 1)];
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

// au ras des troupes, un arbre entre la caméra et sa cible s'efface en pointillés : il ne cache plus la vue (uNear :
// distance de la cible, 60 m au plus, la vue d'ensemble n'est pas touchée)
const NEAR = { value: 60 };
function nearFade(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNear = NEAR;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNear;').replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > smoothstep(uNear * 0.5, uNear * 0.92, vViewPosition.z)) discard;`);
  };
  mat.customProgramCacheKey = () => 'decor-pres';
  return mat;
}
// feuillage : lumière enveloppante (le côté à l'ombre d'une couronne n'est pas noir), soleil qui traverse les feuilles
// quand on le regarde à contre-jour, balancement au vent (plus fort vers le haut de la couronne, d'autant plus que le
// vent souffle ; uni : uTime, uWind, uWindK de relief.js)
function feuillage(mat, uni) {
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, { uTime: uni.uTime, uWind: uni.uWind, uWindK: uni.uWindK });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uWindK; uniform vec2 uWind; varying vec3 vLeaf;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeaf = position * 4.5;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          vLeaf += ip * 0.37;
          float ph = dot(ip.xz, vec2(0.071, 0.113));
          float sway = (sin(uTime * 1.3 + ph) + 0.45 * sin(uTime * 2.7 + ph * 1.9)) * uWindK * 0.035 * max(position.y - 0.7, 0.0);
          // le vent de la scène, ramené dans le repère de l'arbre (tourné et mis à l'échelle par son instance)
          mat3 imv = mat3(instanceMatrix);
          transformed += transpose(imv) * vec3(uWind.x, 0.0, uWind.y) / dot(imv[0], imv[0]) * sway * length(imv[0]);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLeaf;
        float lhash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float lnoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(lhash(i), lhash(i + vec3(1, 0, 0)), f.x), mix(lhash(i + vec3(0, 1, 0)), lhash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(lhash(i + vec3(0, 0, 1)), lhash(i + vec3(1, 0, 1)), f.x), mix(lhash(i + vec3(0, 1, 1)), lhash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
      // grappes de feuilles : des creux plus sombres entre des touffes plus claires (deux octaves de bruit)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lf = lnoise(vLeaf) * 0.6 + lnoise(vLeaf * 2.7) * 0.4;
        diffuseColor.rgb *= 0.35 + 1.1 * smoothstep(0.2, 0.8, lf);`)
      .replace('#include <lights_lambert_pars_fragment>', THREE.ShaderChunk.lights_lambert_pars_fragment
      .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );', 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) * 0.8 + 0.2 );')
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        'reflectedLight.directDiffuse += (irradiance + directLight.color * 0.3 * pow(saturate(-dot(geometryViewDir, directLight.direction)), 3.0)) * BRDF_Lambert( material.diffuseColor );'));
  };
  mat.customProgramCacheKey = () => key.call(mat) + '|feuillage';
  return mat;
}
// sous un régiment, la couronne rétrécit jusqu'à disparaître (le tronc reste) : uClear, masque des clairières, lu à
// l'emplacement de l'arbre (sa translation d'instance) ; aussi pour la passe d'ombre
function clearable(mat, uni, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform sampler2D uClear; uniform vec2 uField;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          transformed *= 1.0 - texture2D(uClear, vec2(instanceMatrix[3][0], instanceMatrix[3][2]) / uField).r;
        #endif`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
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

// bâtisseur de bandes extrudées et de petites pièces posées sur le relief (triangles sans index, couleur par face)
class Builder {
  constructor(heightAt) { this.h = heightAt; this.pos = []; this.col = []; }
  tri(a, b, c, color) { this.pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b); }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  // bande le long de pts : section trapézoïdale (wb au pied, wt au sommet, haute de ht), enfoncée d'un mètre sous le
  // sol ; bump : sommet irrégulier (haies) ; lift : la bande flotte à lift m (lisses d'une clôture)
  ribbon(pts, wb, wt, ht, side, top, bump = 0, lift = 0) {
    if (pts.length < 2) return;
    const cs = new THREE.Color(side), ct = new THREE.Color(top), n = pts.length, N = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      N.push([-dy / l, dx / l]);
    }
    const at = (i, s, w, y) => [pts[i][0] + N[i][0] * s * w / 2, y, pts[i][1] + N[i][1] * s * w / 2];
    const g = i => this.h(pts[i][0], pts[i][1]) + lift;
    const H = i => g(i) + ht + (bump ? (hash(pts[i][0] | 0, pts[i][1] | 0, 17) - 0.5) * 2 * bump : 0);
    const base = i => lift ? g(i) : g(i) - 1;
    for (let i = 0; i < n - 1; i++) {
      const j = i + 1;
      const BL = [at(i, 1, wb, base(i)), at(j, 1, wb, base(j))], BR = [at(i, -1, wb, base(i)), at(j, -1, wb, base(j))];
      const TL = [at(i, 1, wt, H(i)), at(j, 1, wt, H(j))], TR = [at(i, -1, wt, H(i)), at(j, -1, wt, H(j))];
      this.quad(BL[0], TL[0], TL[1], BL[1], cs);
      this.quad(BR[1], TR[1], TR[0], BR[0], cs);
      // (dessus d'une haie bosselée : une nuance par tronçon, vue de haut elle n'est pas d'un seul vert)
      this.quad(TL[0], TR[0], TR[1], TL[1], bump ? ct.clone().multiplyScalar(0.84 + hash(pts[i][0] | 0, pts[i][1] | 0, 19) * 0.32) : ct);
    }
    // bouts
    for (const [i, s] of [[0, 1], [n - 1, -1]]) {
      const bl = at(i, 1, wb, base(i)), br = at(i, -1, wb, base(i)), tl = at(i, 1, wt, H(i)), tr = at(i, -1, wt, H(i));
      if (s > 0) this.quad(br, tr, tl, bl, cs); else this.quad(bl, tl, tr, br, cs);
    }
  }
  // boîte (largeur w, hauteur ht, profondeur d) posée en (x, y), son centre à cy m au-dessus du sol
  box(x, y, w, ht, d, cy, color) {
    const g = new THREE.BoxGeometry(w, ht, d).rotateY(hash(x | 0, y | 0, 23) * 3).translate(x, this.h(x, y) + cy, y).toNonIndexed();
    this.add(g, color);
  }
  cyl(x, y, r, ht, cy, color) { this.add(new THREE.CylinderGeometry(r, r, ht, 7).translate(x, this.h(x, y) + cy, y).toNonIndexed(), color); }
  // dalle (polygone fermé) à ht m au-dessus du sol : la plate-forme d'un bastion
  slab(pts, ht, color) {
    const c = new THREE.Color(color), cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length, y = this.h(cx, cy) + ht;
    for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; this.tri([cx, y, cy], [b[0], y, b[1]], [a[0], y, a[1]], c); }
  }
  add(g, color) {
    const c = new THREE.Color(color), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { this.pos.push(p.getX(i), p.getY(i), p.getZ(i)); this.col.push(c.r, c.g, c.b); }
    g.dispose();
  }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

export class Decor {
  // terrain : Terrain (treeGrid, palette) ; relief : Relief (altitudes) ; q : profil de qualité
  constructor(terrain, relief, q) {
    this.t = terrain; this.r = relief; this.q = q;
    this.group = new THREE.Group();
    this.disposables = [];
    const cw = Math.ceil(terrain.W / CL), ch = Math.ceil(terrain.H / CL);
    this.clear = new THREE.DataTexture(new Uint8Array(cw * ch), cw, ch, THREE.RedFormat, THREE.UnsignedByteType);
    this.clear.unpackAlignment = 1; this.clear.minFilter = this.clear.magFilter = THREE.LinearFilter; this.clear.needsUpdate = true;
    this.clearUni = { uClear: { value: this.clear }, uField: { value: new THREE.Vector2(terrain.W, terrain.H) } };
    this.disposables.push(this.clear);
    this.zones = [];   // [{x, y, near, far, isNear}] : les deux finesses de couronne de chaque lot
    this.trees();
    this.built();
    this.walls();
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
        // (les arbres des bois à part : eux seuls s'effacent au-dessus des troupes, un arbre isolé garde sa couronne)
        const key = `${Math.floor(tr.x / ZONE)},${Math.floor(tr.y / ZONE)}|${tr.kind}|${deep && tr.kind !== 'nu' ? 'cime' : ''}|${wood ? 'bois' : ''}`;
        let z = zones.get(key); if (!z) zones.set(key, z = []);
        z.push(tr);
      }
    });
    const geos = new Map(), lumps = [1, 3, 5, 5][fx];
    // (nuages et collines : ombrage de relief.js)
    const crownMat = this.r.ombrage(feuillage(nearFade(new THREE.MeshLambertMaterial({ vertexColors: true })), this.r.uni));
    const woodMat = this.r.ombrage(feuillage(clearable(nearFade(new THREE.MeshLambertMaterial({ vertexColors: true })), this.clearUni, 'decor-cime'), this.r.uni));
    const woodDepth = clearable(new THREE.MeshDepthMaterial(), this.clearUni, 'decor-cime-ombre');
    this.disposables.push(woodMat, woodDepth);
    const trunkMat = this.r.ombrage(nearFade(new THREE.MeshLambertMaterial({ color: snow ? '#4a3c30' : TRUNK })));
    const bareMat = this.r.ombrage(nearFade(new THREE.MeshLambertMaterial({ color: BARE })));
    this.disposables.push(crownMat, trunkMat, bareMat);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const geo = (kind, detail) => {
      const k = kind + detail;
      if (!geos.has(k)) { const g = crownGeo(kind, detail, lumps); geos.set(k, g); this.disposables.push(...g.filter(Boolean)); }
      return geos.get(k);
    };
    for (const [key, list] of zones) {
      const [zk, kind, cime, bois] = key.split('|'), [zx, zy] = zk.split(',').map(Number), cm = bois ? woodMat : crownMat;
      // dans les bois, des couronnes qui se touchent : plus larges, d'autant plus que la qualité a ôté des arbres
      const big = bois && kind !== 'buisson' && kind !== 'nu' ? 1.2 / Math.sqrt(keep) : 1;
      const [crown, trunk] = geo(kind, 0), fine = fx >= 2 && kind !== 'sapin' && kind !== 'meule' && kind !== 'nu' ? geo(kind, 1)[0] : null;
      // like : un lot déjà placé dont on reprend les matrices et les teintes (la couronne fine d'une zone)
      const mk = (g, mat, tint, like = null) => {
        const mesh = new THREE.InstancedMesh(g, mat, list.length);
        if (like) { mesh.instanceMatrix = like.instanceMatrix; mesh.instanceColor = like.instanceColor; }
        else list.forEach((tr, i) => {
          p.set(tr.x, this.r.heightAt(tr.x, tr.y) - 0.1, tr.y);
          q.setFromAxisAngle(up, hash(tr.x | 0, tr.y | 0, 3) * Math.PI * 2);
          const r = tr.r * (0.92 + hash(tr.x | 0, tr.y | 0, 5) * 0.16) * big;
          mesh.setMatrixAt(i, m.compose(p, q, s.set(r, r, r)));
          if (tint) mesh.setColorAt(i, tint(tr, col));
        });
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        if (mat === woodMat) mesh.customDepthMaterial = woodDepth;
        this.group.add(mesh);
        return mesh;
      };
      const tint = (tr, c) => {
        c.set(kind === 'sapin' || kind === 'parasol' ? pal.pins[(tr.ci ?? 0) % pal.pins.length] : kind === 'meule' ? (snow ? '#e4e7ea' : '#c8a659') : pal.arbres[(tr.ci ?? 0) % pal.arbres.length]);
        if (snow && kind !== 'meule') c.lerp(new THREE.Color('#d8dde0'), 0.25);
        if (kind !== 'meule' && !snow) {
          // nappes : plus jaune ou plus bleu selon un bruit de 300 m ; un arbre sur dix plus clair, un sur dix plus sombre
          const n = vnoise(tr.x / 300, tr.y / 300, 61) - 0.5, o = hash(tr.x | 0, tr.y | 0, 11);
          c.r *= 1 + n * 0.3; c.b *= 1 - n * 0.35;
          if (o < 0.1) c.lerp(new THREE.Color('#9fbf5a'), 0.35); else if (o > 0.9) c.multiplyScalar(0.72);
        }
        // (dans les bois, un peu plus sombre : vu de haut, un bois est une masse)
        return c.multiplyScalar((0.86 + hash(tr.x | 0, tr.y | 0, 9) * 0.28) * (bois ? 0.82 : 1));
      };
      if (crown) {
        const far = mk(crown, cm, tint), near = fine && mk(fine, cm, null, far);
        if (near) { near.visible = false; this.zones.push({ x: (zx + 0.5) * ZONE, y: (zy + 0.5) * ZONE, near, far, isNear: false }); }
      }
      if (trunk && !cime) mk(trunk, kind === 'nu' ? bareMat : trunkMat, null);
    }
  }
  // finesse des couronnes : les zones proches de l'œil (fr : camera.js) prennent leurs touffes fines
  lod(fr) {
    for (const z of this.zones) {
      const d = Math.hypot(Math.max(0, Math.abs(fr.E[0] - z.x) - ZONE / 2), Math.max(0, Math.abs(fr.E[2] - z.y) - ZONE / 2), fr.E[1] - fr.T[1]);
      const on = d < (z.isNear ? NEAR_OFF : NEAR_ON);
      if (on !== z.isNear) { z.isNear = on; z.near.visible = on; z.far.visible = !on; }
    }
  }
  // clairières : sous l'emprise de chaque régiment vu (et une marge), la couronne des arbres s'efface ; le masque (4 m
  // par pixel) est refait trois fois par seconde au plus
  clearings(list, now) {
    if (now - (this.clearT || 0) < 300) return;
    this.clearT = now;
    const d = this.clear.image.data, w = this.clear.image.width, h = this.clear.image.height;
    d.fill(0);
    for (const un of list) {
      if (un._ghost) continue;
      const rout = un.state === 'deroute', hw = (Math.max(6, un.w || 0) / 2 + 8) * (rout ? 1.6 : 1), hd = (Math.max(6, un.d || 0) / 2 + 8) * (rout ? 2 : 1);
      const ca = Math.cos(un.dir || 0), sa = Math.sin(un.dir || 0), R = Math.hypot(hw, hd);
      const i0 = Math.max(0, Math.floor((un.x - R) / CL)), i1 = Math.min(w - 1, Math.ceil((un.x + R) / CL));
      const j0 = Math.max(0, Math.floor((un.y - R) / CL)), j1 = Math.min(h - 1, Math.ceil((un.y + R) / CL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        // dans le repère du régiment : le long du front, vers l'avant (son sens)
        const dx = (i + 0.5) * CL - un.x, dy = (j + 0.5) * CL - un.y;
        if (Math.abs(-dx * sa + dy * ca) <= hw && Math.abs(dx * ca + dy * sa) <= hd) d[j * w + i] = 255;
      }
    }
    this.clear.needsUpdate = true;
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
    const mat = this.r.ombrage(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }
  // ------------------------------------------------------------------ enceintes, ouvrages, haies
  walls() {
    if (this.wallMesh) { this.group.remove(this.wallMesh); this.wallMesh.geometry.dispose(); this.wallMesh = null; }
    const t = this.t, pal = t.pal, snow = pal.neige, B = new Builder(this.r.heightAt);
    const small = w => { const xs = w.pts.map(p => p[0]), ys = w.pts.map(p => p[1]); return Math.max(...xs) - Math.min(...xs) < 160 && Math.max(...ys) - Math.min(...ys) < 160; };
    const th = w => clamp(w.thick || (w.kind === 'mur' ? 6 : 16), 4, 24);
    const breaches = t.walls.flatMap(w => (w.breach || []).map(b => [b[0], b[1], b[2] || 20]));
    // trous dans les enceintes : brèches et portes de la ville
    const holes = breaches.concat(t.gates.map(g => [g.x, g.y, 9]));
    const cut = pts => { const out = []; let cur = []; for (const p of resample(pts, 3).concat([pts[pts.length - 1]])) { if (holes.some(([x, y, r]) => Math.hypot(p[0] - x, p[1] - y) < r)) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(p); } if (cur.length > 1) out.push(cur); return out; };
    const stone = snow ? '#e4e4e0' : '#d3c6a2', grass = snow ? '#f2f3f3' : '#9aab6c', earth = snow ? '#d8d2c8' : '#9c7a4e';
    const hasBar = t.t.includes(T.BARRICADE);
    for (const w of t.walls) {
      const fort = w.kind === 'rempart' || w.kind === 'bastion' || (w.kind === 'mur' && (w.thick || 0) >= 5);
      if (fort) {
        const W = th(w), parts = small(w) ? [w.pts] : t.splitDry(w.pts);
        for (const p0 of parts) for (const pts of cut(p0)) {
          if (w.kind === 'mur') {
            // mur de ville : maçonnerie de 7 m, créneaux tous les 3 m
            B.ribbon(pts, W * 0.95, W * 0.8, 7, stone, snow ? '#e8e8e4' : '#c9bb96');
            for (const p of resample(pts, 3)) B.box(p[0], p[1], 1.2, 1.4, 1.2, 7.6, '#c2b48e');
          } else {
            // rempart : escarpe de pierre, terre-plein gazonné, parapet au milieu
            B.ribbon(pts, W * 0.9, W * 0.62, 6, stone, grass);
            B.ribbon(pts, Math.max(1.4, W * 0.12), Math.max(1, W * 0.1), 7.3, '#c2b48e', '#c2b48e');
          }
        }
        if (w.kind === 'bastion' && small(w) && !breaches.length) B.slab(w.pts, 6, grass);
      } else if (w.kind === 'mur') {
        for (const pts of cut(w.pts)) B.ribbon(pts, 0.8, 0.7, 2, snow ? '#f0f0ee' : '#d4c7a5', '#bfb28f');
      } else if (w.kind === 'barricade') {
        if (small(w) && hasBar) { B.ribbon(w.pts.concat([w.pts[0]]), 5, 2.5, 1.8, earth, earth); continue; }   // redoute
        for (const pts of t.splitDry(w.pts, hasBar)) {
          if (pts.length < 2) continue;
          const len = pts.reduce((a, p, k) => k ? a + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0, 0);
          if (len > 70) {
            // tranchée de siège : parapet de terre rejetée, gabions sur la crête
            B.ribbon(offsetPts(pts, -2), 4.5, 2, 1.4, earth, earth);
            for (const [k, p] of resample(offsetPts(pts, -3.2), 2.6).entries()) B.cyl(p[0], p[1], 1.05, 1.2, 1.3, k % 2 ? '#a88452' : '#b8955f');
          } else B.ribbon(pts, 1.4, 1.1, 1.7, snow ? '#8d8070' : '#6e5134', snow ? '#c9c1b5' : '#9a7650');   // charrettes et poutres
        }
      }
    }
    // éboulis des brèches
    for (const [x, y, r] of breaches) for (let k = 0; k < 40; k++) {
      const a = hash(k, 1, x) * Math.PI * 2, d = Math.sqrt(hash(k, 2, y)) * r * 1.05, sz = 1.2 + hash(k, 3, x) * 2.8;
      B.box(x + Math.cos(a) * d, y + Math.sin(a) * d, sz, sz * 0.6, sz * 0.8, sz * 0.3, k % 3 ? stone : '#8f8168');
    }
    // haies, murets, clôtures de bois : construites une fois, à part (une brèche ne touche pas ces clôtures)
    const geo = B.geometry();
    if (!this.wallMat) { this.wallMat = this.r.ombrage(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); this.disposables.push(this.wallMat); }
    if (geo) {
      this.wallMesh = new THREE.Mesh(geo, this.wallMat);
      this.wallMesh.castShadow = this.wallMesh.receiveShadow = true;
      this.group.add(this.wallMesh);
    }
    if (!this.fencesDone) { this.fencesDone = true; this.fences(); }
  }
  fences() {
    const t = this.t, pal = t.pal, snow = pal.neige, B = new Builder(this.r.heightAt), BH = new Builder(this.r.heightAt);
    const hedge = snow ? '#5e6a5c' : new THREE.Color(pal.arbres[0]).multiplyScalar(0.7).getStyle();
    const tones = snow ? ['#d9dee0', '#c9d0d0'] : [pal.arbres[0], pal.arbres[1], pal.arbres[2] || pal.arbres[0]].map(c => new THREE.Color(c).multiplyScalar(0.8).getStyle());
    const fx = this.q.fx ?? 2, h = this.r.heightAt;
    for (const f of t.fencePts) {
      // bord bosselé tous les 1,6 m (resample ne garde pas le dernier point : il est rajouté)
      if (f.kind === 'haie') {
        BH.ribbon(resample(f.pts, 1.6).concat([f.pts[f.pts.length - 1]]), 1.8, 1.25, 2.1, hedge, snow ? '#e8ecee' : new THREE.Color(pal.arbres[1]).multiplyScalar(0.85).getStyle(), 0.45);
        // (SPEC-SUITE F7) des touffes de feuillage sur la bande, comme les couronnes des bois, et de loin en loin un
        // arbre têtard qui dépasse ; en Moyenne et au-delà
        if (fx < 1) continue;
        for (const [k, q] of resample(f.pts, fx >= 2 ? 2.2 : 3.4).entries()) {
          const hx = hash(q[0] | 0, q[1] | 0, 41), r = 0.75 + hx * 0.45, y = h(q[0], q[1]) + 1.55 + hx * 0.4;
          BH.add(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.8, 1).rotateY(hx * 6).translate(q[0], y, q[1]), tones[k % tones.length]);
          if (hash(q[0] | 0, q[1] | 0, 43) < 0.045) {
            B.cyl(q[0], q[1], 0.16, 3.2, 1.6, '#5a4430');
            BH.add(new THREE.IcosahedronGeometry(1.5, 1).scale(1, 0.85, 1).translate(q[0], h(q[0], q[1]) + 3.7, q[1]), tones[(k + 1) % tones.length]);
          }
        }
      }
      else if (f.kind === 'muret') B.ribbon(f.pts, 0.65, 0.55, 1, snow ? '#e6e6e2' : '#a39a84', snow ? '#f4f4f2' : '#b9b09a');
      else {
        for (const p of resample(f.pts, 2.5)) B.box(p[0], p[1], 0.14, 1.25, 0.14, 0.62, snow ? '#4e4034' : '#5a4430');
        for (const y of [0.55, 1.0]) B.ribbon(f.pts, 0.08, 0.08, 0.08, '#8a6a46', '#8a6a46', 0, y);
      }
    }
    const hg = BH.geometry();
    if (hg) {
      // les haies : un feuillage (lumière enveloppante, grappes de feuilles, contre-jour), pas une pierre peinte en vert
      this.hedgeMat = this.r.ombrage(feuillage(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), this.r.uni));
      this.disposables.push(this.hedgeMat);
      this.hedgeMesh = new THREE.Mesh(hg, this.hedgeMat);
      this.hedgeMesh.castShadow = this.hedgeMesh.receiveShadow = true;
      this.group.add(this.hedgeMesh);
    }
    const geo = B.geometry();
    if (!geo) return;
    this.fenceMesh = new THREE.Mesh(geo, this.wallMat);
    this.fenceMesh.castShadow = this.fenceMesh.receiveShadow = true;
    this.group.add(this.fenceMesh);
  }
  // distance de la caméra à sa cible (m), à chaque image
  near(dist) { NEAR.value = Math.min(60, dist); }
  setQuality(q) { this.q = q; }
  dispose() {
    this.wallMesh?.geometry.dispose(); this.fenceMesh?.geometry.dispose(); this.hedgeMesh?.geometry.dispose(); for (const d of this.disposables) d.dispose(); for (const o of this.group.children) o.dispose?.(); }
}
