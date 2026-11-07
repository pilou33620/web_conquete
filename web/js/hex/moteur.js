// Le moteur du rendu en plateau d'hexagones (SPEC-HEX.md), repris de web_power (js/03-moteur-3d.js) : ombrage
// « cartoon » à trois tons, contours sombres (une copie gonflée de chaque pièce, faces arrière), lots de pièces fusionnés
// en un seul maillage. La scène vit SOUS le canevas 2D du jeu : la caméra est orthographique, inclinée d'un angle fixe,
// et calée sur la caméra 2D ({x, y, z} : centre en unités du jeu, z en pixels CSS par unité), si bien que le sol se
// projette par une simple affinité : sx = (x − cx)·z + vw/2, sy = (y − cy)·z·K + vh/2 − h·z·C. Les calques 2D (vie,
// armées, interface) dessinent avec ce même K (map.js, battle/vue.js) et tombent pile sur le plateau.
import * as THREE from '../../vendor/three/three.module.js';

export { THREE };
export const SQ3 = Math.sqrt(3);
// inclinaison de la caméra : direction (0, 0,83, 0,56) comme web_power (js/15-camera.js)
export const ELEV = Math.atan2(0.83, 0.56), K = Math.sin(ELEV), C = Math.cos(ELEV);

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function hache(x, y, s = 7) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function bruit(x, y, s = 7) {
  const xi = Math.floor(x), yi = Math.floor(y), u = (x - xi) ** 2 * (3 - 2 * (x - xi)), v = (y - yi) ** 2 * (3 - 2 * (y - yi));
  const a = hache(xi, yi, s), b = hache(xi + 1, yi, s), c = hache(xi, yi + 1, s), d = hache(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// hasard reproductible : semer(a, b) puis rnd() ; le même lieu donne toujours le même dessin
let g = 1;
export function rnd() { g = (g + 0x6D2B79F5) | 0; let t = Math.imul(g ^ (g >>> 15), 1 | g); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
export const semer = (a, b = 0) => { g = (Math.round(a * 7919) + Math.round(b * 104729) + 13) | 0; };
export const entre = (a, b) => a + rnd() * (b - a);
export const choix = l => l[(rnd() * l.length) | 0];

// ------------------------------------------------------------------ matériaux
const degrade = new THREE.DataTexture(new Uint8Array([105, 190, 255]), 3, 1, THREE.RedFormat);
degrade.minFilter = degrade.magFilter = THREE.NearestFilter; degrade.needsUpdate = true;
export const DEGRADE = degrade;
export const MAT = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: degrade });
export const CONT = new THREE.MeshBasicMaterial({ color: 0x24180f, side: THREE.BackSide });
export const PARTAGES = new Set([MAT, CONT]);

// ------------------------------------------------------------------ lots de pièces
// un lot : ses pièces (g) et leurs contours (o), fusionnés à la fin par fige()
export const lot = () => ({ g: [], o: [] });
const VA = new THREE.Vector3(), VB = new THREE.Vector3(), COUL = new THREE.Color();
// une pièce de couleur unie, tournée de ry, posée en (x, y, z) ; ep : épaisseur du contour (0 : sans contour)
export function put(L, geo, col, x = 0, y = 0, z = 0, ry = 0, ep = 0.26) {
  if (geo.index) geo = geo.toNonIndexed();
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  COUL.set(col);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = COUL.r; a[i * 3 + 1] = COUL.g; a[i * 3 + 2] = COUL.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  L.g.push(geo);
  if (ep) {
    const o = geo.clone(); o.computeBoundingBox(); o.boundingBox.getCenter(VA); o.boundingBox.getSize(VB);
    o.translate(-VA.x, -VA.y, -VA.z);
    o.scale((VB.x + 2 * ep) / Math.max(VB.x, 1e-3), (VB.y + 2 * ep) / Math.max(VB.y, 1e-3), (VB.z + 2 * ep) / Math.max(VB.z, 1e-3));
    o.translate(VA.x, VA.y, VA.z); o.deleteAttribute('color'); L.o.push(o);
  }
  return geo;
}
// verse le lot src dans L, tourné de ry puis posé en (x, y, z), à l'échelle s
export function transfere(src, L, x, y, z, ry = 0, s = 1) {
  for (const k of ['g', 'o']) for (const geo of src[k]) { if (s !== 1) geo.scale(s, s, s); if (ry) geo.rotateY(ry); geo.translate(x, y, z); L[k].push(geo); }
}
// fusion de géométries non indexées aux mêmes attributs (position, normal, color) : BufferGeometryUtils sans l'importer
export function fusion(geos) {
  if (!geos.length) return null;
  const noms = Object.keys(geos[0].attributes), out = new THREE.BufferGeometry();
  for (const k of noms) {
    const it = geos[0].attributes[k].itemSize;
    let n = 0; for (const geo of geos) n += geo.attributes[k].count;
    const arr = new Float32Array(n * it); let o = 0;
    for (const geo of geos) { arr.set(geo.attributes[k].array, o); o += geo.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, it));
  }
  for (const geo of geos) geo.dispose();
  return out;
}
// le lot devient un groupe : un maillage plein (ombres portées et reçues) et un maillage de contours
export function fige(L, parent, { mat = MAT, ombre = true, contour = true } = {}) {
  const grp = new THREE.Group();
  const geo = fusion(L.g);
  if (geo) { const m = new THREE.Mesh(geo, mat); m.castShadow = ombre; m.receiveShadow = true; grp.add(m); }
  const geoO = contour ? fusion(L.o) : (L.o.forEach(o => o.dispose()), null);
  if (geoO) grp.add(new THREE.Mesh(geoO, CONT));
  L.g = []; L.o = [];
  if (parent) parent.add(grp);
  return grp;
}
// libère un groupe et tout ce qu'il contient (sauf les matériaux partagés)
export function jeter(obj) {
  if (!obj) return;
  obj.parent?.remove(obj);
  obj.traverse(o => { o.geometry?.dispose(); if (o.material && !PARTAGES.has(o.material)) { o.material.map?.dispose(); o.material.dispose(); } });
}

// ------------------------------------------------------------------ formes
export const boite = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
export const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
export const sphere = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
// toit à deux pans : w de large (le pignon, selon x), d de long (le faîtage, selon z), h de haut ; posé sur y
// (le prisme de web_power était couché, la pointe vers +x : ici la pointe est en haut)
export function toit(L, w, d, h, col, x, y, z, ry = 0, ep = 0.2) {
  const p = cyl(1, 1, d, 3); p.rotateX(Math.PI / 2); p.rotateZ(Math.PI); p.scale(w / SQ3, h / 1.5, 1); p.translate(0, h / 3, 0);
  put(L, p, col, x, y, z, ry, ep);
}
// toit à quatre pans (pavillon) : une pyramide à base rectangulaire
export function pavillon(L, w, d, h, col, x, y, z, ry = 0, ep = 0.2) {
  const p = cone(Math.SQRT1_2, 1, 4); p.rotateY(Math.PI / 4); p.scale(w, h, d); p.translate(0, h / 2, 0);
  put(L, p, col, x, y, z, ry, ep);
}
// ruban posé sur le relief : points [x, y, z], demi-largeur larg ; normales vers le haut
export function ruban(pts, larg) {
  const pos = [];
  const perp = i => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1], pa = perp(i), pb = perp(i + 1);
    pos.push(A[0] + pa[0] * larg, A[1], A[2] + pa[1] * larg, B[0] + pb[0] * larg, B[1], B[2] + pb[1] * larg, A[0] - pa[0] * larg, A[1], A[2] - pa[1] * larg,
      A[0] - pa[0] * larg, A[1], A[2] - pa[1] * larg, B[0] + pb[0] * larg, B[1], B[2] + pb[1] * larg, B[0] - pb[0] * larg, B[1], B[2] - pb[1] * larg);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geo;
}

// ------------------------------------------------------------------ grille d'hexagones (pointe en haut, comme web_power)
// R : rayon d'un hexagone dans les unités du plateau (10, comme web_power) ; la grille couvre W × H unités du jeu avec des
// hexagones de `pas` unités du jeu d'un bord plat à l'autre. f = unités du jeu par unité du plateau.
export class Grille {
  constructor(W, H, pas) {
    this.R = 10; this.pas = pas; this.RK = pas / SQ3; this.f = this.RK / this.R;
    this.cols = Math.floor(W / pas) + 1; this.rows = Math.floor(H / (1.5 * this.RK)) + 1;
    this.T = new Map(); this.liste = [];
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
      const r = row, q = col - (row - (row & 1)) / 2;
      const t = { q, r, col, row, i: this.liste.length, x: this.R * SQ3 * (q + r / 2), z: this.R * 1.5 * r, top: 0 };
      t.gx = t.x * this.f; t.gy = t.z * this.f;   // le centre, en unités du jeu
      this.T.set(q + ',' + r, t); this.liste.push(t);
    }
  }
  get(q, r) { return this.T.get(q + ',' + r); }
  voisins(t) { const o = []; for (const [a, b] of DIRS) { const n = this.T.get((t.q + a) + ',' + (t.r + b)); if (n) o.push(n); } return o; }
  // l'hexagone sous un point du plateau (unités du plateau)
  sous(x, z) {
    const q = (SQ3 / 3 * x - z / 3) / this.R, r = (2 / 3 * z) / this.R, s = -q - r;
    let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return this.T.get(rq + ',' + rr);
  }
  // l'hexagone sous un point du jeu
  en(gx, gy) { return this.sous(gx / this.f, gy / this.f); }
  coin(t, i, k = 1) { const a = Math.PI / 180 * (60 * i - 30); return [t.x + this.R * k * Math.cos(a), t.z + this.R * k * Math.sin(a)]; }
  bordCommun(t, n) {
    const mx = (t.x + n.x) / 2, mz = (t.z + n.z) / 2;
    return [0, 1, 2, 3, 4, 5].map(i => this.coin(t, i)).sort((a, b) => Math.hypot(a[0] - mx, a[1] - mz) - Math.hypot(b[0] - mx, b[1] - mz)).slice(0, 2);
  }
  // une polyligne du jeu ([[x, y], …]) rééchantillonnée tous les `pas` unités du plateau, posée sur les hexagones
  suivre(pts, pas, dy, sol = t => t.top) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0] / this.f, az = pts[i][1] / this.f, bx = pts[i + 1][0] / this.f, bz = pts[i + 1][1] / this.f;
      const nb = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / pas));
      for (let s = i ? 1 : 0; s <= nb; s++) {
        const x = ax + (bx - ax) * s / nb, z = az + (bz - az) * s / nb, t = this.sous(x, z);
        out.push([x, (t ? sol(t) : 0) + dy, z, t]);
      }
    }
    return out;
  }
}
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// ------------------------------------------------------------------ la scène sous le canevas 2D
export class Scene3D {
  // canvas : le canevas WebGL (sous le canevas 2D) ; fond : couleur du vide ; ombreMax : demi-côté (unités du jeu) de la
  // zone où le soleil porte des ombres (au-delà, la carte vue de loin s'en passe)
  constructor(canvas, { fond = 0x1b211a, ombreMax = 200 } = {}) {
    this.cv = canvas; this.ombreMax = ombreMax;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(fond);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.ciel = new THREE.HemisphereLight(0xeef7ff, 0x7d8466, 1.5); this.scene.add(this.ciel);
    this.soleil = new THREE.DirectionalLight(0xfff0d4, 2.6); this.soleil.castShadow = true;
    this.soleil.shadow.mapSize.set(2048, 2048); this.soleil.shadow.bias = -0.0006; this.soleil.shadow.normalBias = 0.4;
    this.scene.add(this.soleil, this.soleil.target);
    this.monde = new THREE.Group(); this.scene.add(this.monde);
    this.sale = true; this.cle = '';
  }
  // cale la caméra 3D sur la caméra 2D : cam {x, y, z}, écran vw × vh (pixels CSS), dpr
  caler(cam, vw, vh, dpr) {
    const w = Math.round(vw * dpr), h = Math.round(vh * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.renderer.setPixelRatio(dpr); this.renderer.setSize(vw, vh, false); this.sale = true; }
    const cle = `${cam.x.toFixed(4)}|${cam.y.toFixed(4)}|${cam.z.toFixed(5)}|${vw}|${vh}`;
    if (cle === this.cle) return;
    this.cle = cle; this.sale = true;
    const hw = vw / 2 / cam.z, hh = vh / 2 / cam.z, c = this.cam;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    // la cible au sol est au centre de l'écran ; la caméra recule dans l'axe (0, sin e, cos e)
    c.position.set(cam.x + 0, 2000 * K, cam.y + 2000 * C); c.lookAt(cam.x, 0, cam.y);
    c.near = 1; c.far = 4000; c.updateProjectionMatrix();
    // le soleil du nord-ouest suit la vue ; ses ombres couvrent l'écran, au plus ombreMax de chaque côté
    const r = Math.min(this.ombreMax, Math.max(hw, hh / K) * 1.15), s = this.soleil, sc = s.shadow.camera;
    s.target.position.set(cam.x, 0, cam.y);
    s.position.set(cam.x - r * 0.9, r * 1.6, cam.y - r * 0.55);
    sc.left = -r * 1.2; sc.right = r * 1.2; sc.top = r * 1.2; sc.bottom = -r * 1.2; sc.near = 0.01; sc.far = r * 5; sc.updateProjectionMatrix();
  }
  rendre(force = false) {
    if (!this.sale && !force) return false;
    this.sale = false; this.renderer.render(this.scene, this.cam); return true;
  }
  vider() { for (const o of [...this.monde.children]) jeter(o); this.sale = true; }
  dispose() { this.vider(); this.renderer.dispose(); }
}

// projection écran ↔ jeu de la caméra inclinée (les calques 2D)
export const versEcran = (cam, vw, vh, x, y, h = 0) => [(x - cam.x) * cam.z + vw / 2, (y - cam.y) * cam.z * K + vh / 2 - h * cam.z * C];
export const versJeu = (cam, vw, vh, sx, sy) => [(sx - vw / 2) / cam.z + cam.x, (sy - vh / 2) / (cam.z * K) + cam.y];
