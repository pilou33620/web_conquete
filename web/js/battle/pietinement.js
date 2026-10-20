// Vue tactique : le sol qui garde la trace de la bataille (étape 9e). Une carte de piétinement couvre tout le champ
// (une texture d'environ 3 m par pixel, 2 m en Ultra) : chaque régiment qui marche, charge ou se bat y dépose une
// tache douce à la forme de sa formation, plus fort pour la cavalerie et l'artillerie, deux fois plus fort sous la
// pluie ; chaque trou d'obus y laisse une tache de terre retournée. relief.js la lit : le sol y tourne à la boue,
// les épis s'y couchent, la neige s'y efface.
// La carte est dessinée cinq fois par seconde (un quad instancié par régiment, en mélange additif) ; elle n'est pas
// enregistrée : une bataille rechargée repart d'un sol neuf.
import * as THREE from '../../vendor/three/three.module.js';
import { clsOf, clamp } from './formes.js';

// dépôt par seconde (part de la boue complète, 0 à 1) d'un régiment u qui se déplace à v m/s ; wet : temps de pluie.
// Un régiment de ligne qui passe une fois laisse environ un tiers de boue ; une charge de cavalerie, la moitié.
export function depot(u, v, wet = false) {
  if (!u || u.state === 'hors' || u._ghost) return 0;
  const cls = clsOf(u), men = clamp((u.men || 0) / 500, 0, 1.5);
  if (!men || cls === 'general') return 0;
  const fight = u.state === 'melee';
  if (v < 0.3 && !fight) return 0;
  const base = cls === 'cavalerie' ? 0.12 : cls === 'artillerie' || cls === 'chariot' ? 0.08 : 0.027;
  return base * (fight ? 0.6 : 1) * (cls === 'artillerie' || cls === 'chariot' ? 1 : men) * (wet ? 2 : 1);
}

const STEP = 0.2;   // s entre deux dessins de la carte
const CAP = 256;    // régiments et impacts dessinés en une fois

const VERT = `
  precision highp float;
  in vec3 position; in vec2 uv; in mat4 instanceMatrix; in float aK;
  uniform mat4 projectionMatrix;
  out vec2 vUv; out vec2 vW; out float vK;
  void main() {
    vec4 w = instanceMatrix * vec4(position, 1.0);
    vUv = uv; vW = w.xy; vK = aK;
    gl_Position = projectionMatrix * w;
  }`;
// une tache aux bords doux, à la forme d'un rectangle arrondi, bousculée par un bruit (le sol n'est jamais foulé
// régulièrement)
const FRAG = `
  precision highp float;
  in vec2 vUv; in vec2 vW; in float vK;
  out vec4 outColor;
  float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main() {
    vec2 q = abs(vUv - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.55, 1.0, q.x)) * (1.0 - smoothstep(0.55, 1.0, q.y));
    a *= 0.45 + 1.1 * n(vW * 0.12) * n(vW * 0.37 + 7.0);
    outColor = vec4(1.0, 1.0, 1.0, a * vK);
  }`;

export class Pietinement {
  // renderer : WebGLRenderer ; W, H : taille du champ (m) ; q : profil de qualité (ultra : 2 m par pixel)
  constructor(renderer, W, H, q) {
    this.r = renderer; this.W = W; this.H = H;
    const res = q?.fx >= 3 ? 2 : 3, w = Math.ceil(W / res), hh = Math.ceil(H / res);
    // demi-flottants si la carte sait y dessiner : les petits dépôts de chaque dessin ne se perdent pas dans l'arrondi
    const ext = renderer.extensions, half = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.rt = new THREE.WebGLRenderTarget(w, hh, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.cam = new THREE.OrthographicCamera(0, W, H, 0, -1, 1);   // (y du champ vers le haut de la texture : v = y / H)
    const geo = new THREE.PlaneGeometry(1, 1);
    this.k = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
    geo.setAttribute('aK', this.k);
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, CAP);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.t = 0; this.fresh = true;
    this.stamps = [];   // impacts en attente du prochain dessin : [x, y, r, k]
    this.m = new THREE.Matrix4(); this.qt = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.z = new THREE.Vector3(0, 0, 1);
  }
  get texture() { return this.rt.texture; }
  // un trou d'obus ou une explosion en (x, y), de rayon r m
  stamp(x, y, r, k = 0.55) { if (this.stamps.length < CAP) this.stamps.push([x, y, r, k]); }
  // units : les régiments (vue.js : x, y, dir, w, d, from, to) ; gap : intervalle entre deux relevés du serveur (s) ;
  // wet : pluie ; dt : temps écoulé (s) ; rate : secondes de bataille par seconde réelle (0 en pause)
  update(units, gap, wet, dt, rate) {
    this.t += dt * rate;
    if (this.t < STEP * Math.max(1, rate) && !this.fresh) return;
    const span = this.t; this.t = 0;
    let n = 0;
    const add = (x, y, a, sx, sy, k) => {
      if (n >= CAP || k <= 0) return;
      this.p.set(x, y, 0); this.qt.setFromAxisAngle(this.z, a); this.s.set(sx, sy, 1);
      this.mesh.setMatrixAt(n, this.m.compose(this.p, this.qt, this.s));
      this.k.array[n++] = Math.min(1, k);
    };
    for (const u of units) {
      if (!u.to || !u.from) continue;
      // (vitesse en m par seconde de bataille)
      const v = Math.hypot(u.to.x - u.from.x, u.to.y - u.from.y) / Math.max(0.05, gap * rate);
      // le long du sens (dir) : la profondeur de la formation ; en travers : son front
      add(u.x, u.y, u.dir || 0, (u.d || 10) + 6, (u.w || 20) + 6, depot(u, v, wet) * span);
    }
    for (const [x, y, r, k] of this.stamps.splice(0)) add(x, y, 0, r * 2.4, r * 2.4, k);
    this.k.needsUpdate = true;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = n > 0 || this.fresh;
  }
  // dessine les dépôts de ce pas dans la carte (avant le rendu de la scène)
  render() {
    if (!this.dirty) return;
    this.dirty = false;
    const r = this.r, prev = r.getRenderTarget(), auto = r.autoClear;
    r.setRenderTarget(this.rt);
    if (this.fresh) {
      const c = r.getClearColor(new THREE.Color()), a = r.getClearAlpha();
      r.setClearColor(0x000000, 0); r.clear(); r.setClearColor(c, a);
      this.fresh = false;
    }
    r.autoClear = false;
    r.render(this.scene, this.cam);
    r.autoClear = auto;
    r.setRenderTarget(prev);
  }
  // contexte WebGL rendu par Safari : la carte est vide, elle repart de zéro
  reset() { this.fresh = true; }
  dispose() { this.rt.dispose(); this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

// Ombre de régiment (étape 9h) : une tache large et très douce sous chaque formation, redessinée à chaque image dans
// une petite texture du champ (6 m par pixel) ; relief.js en assombrit le sol. À la vue d'ensemble, le bloc « pose » sur
// le sol au lieu de flotter.
export class OmbreRegiments {
  constructor(renderer, W, H) {
    this.r = renderer;
    this.rt = new THREE.WebGLRenderTarget(Math.ceil(W / 6), Math.ceil(H / 6), { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.cam = new THREE.OrthographicCamera(0, W, H, 0, -1, 1);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.k = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
    geo.setAttribute('aK', this.k);
    const frag = FRAG.replace('a *= 0.45 + 1.1 * n(vW * 0.12) * n(vW * 0.37 + 7.0);', 'a = a * a;');
    this.mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, CAP);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.qt = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.z = new THREE.Vector3(0, 0, 1);
  }
  get texture() { return this.rt.texture; }
  // units : les régiments vus (x, y, dir, w, d, _fade) ; dessine leurs ombres (avant le rendu de la scène)
  render(units) {
    let n = 0;
    for (const u of units) {
      if (n >= CAP || u.state === 'hors' || (u.men || 0) <= 0) continue;
      this.p.set(u.x, u.y, 0); this.qt.setFromAxisAngle(this.z, u.dir || 0); this.s.set((u.d || 10) + 10, (u.w || 20) + 10, 1);
      this.mesh.setMatrixAt(n, this.m.compose(this.p, this.qt, this.s));
      this.k.array[n++] = 0.55 * (u._fade ?? 1);
    }
    this.mesh.count = n; this.k.needsUpdate = true; this.mesh.instanceMatrix.needsUpdate = true;
    const r = this.r, prev = r.getRenderTarget(), c = r.getClearColor(new THREE.Color()), a = r.getClearAlpha();
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear();
    if (n) r.render(this.scene, this.cam);
    r.setClearColor(c, a); r.setRenderTarget(prev);
  }
  dispose() { this.rt.dispose(); this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}
