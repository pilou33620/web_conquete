// Maquette de la carte de campagne en vue inclinée, comme Ultimate General (SPEC-SUITE G4). Ce n'est pas encore le
// jeu : une page à part (js/dev/carte3d.html) pour juger l'allure et mesurer le coût sur l'iPad avant d'aller plus
// loin. Elle reprend la peinture des terres de la carte 2D (map.js : couleurs, relief ombré, saisons) comme texture
// d'un relief en volume, avec fleuves et routes peints dessus, des forêts d'arbres instanciés, les places dessinées
// par towns.js debout sur des panneaux, leurs noms sur des plaques d'ardoise, un ciel et une brume lointaine.
// Caméra : glisser pour se déplacer, molette ou pincement pour zoomer (la vue se couche en zoomant), clic droit glissé
// pour pivoter. Les clics du jeu (villes, armées) ne sont pas encore branchés.
import * as THREE from '../vendor/three/three.module.js';
import { MapView } from './map.js';
import { TownArt } from './towns.js';

const T = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8 };
const KM = 1;            // une unité de la scène = 1 km
const HZ = 1.1;          // exagération du relief (km par unité d'altitude de map.js)

function b64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
const hash = (i, j, k = 0) => { let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

export class Carte3D {
  constructor(canvas, payload, season = 'printemps') {
    this.cv = canvas;
    const m = payload.map;
    this.m = m; this.W = m.W; this.H = m.H;
    // la peinture des terres de la carte 2D, sans la carte 2D (ses tuiles, ses gestes, son animation)
    const land = Object.create(MapView.prototype);
    Object.assign(land, { W: m.W, H: m.H, terrain: b64(m.terrain), season });
    MapView.prototype.buildBases.call(land);
    this.land = land;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#b9cad4');
    this.scene.fog = new THREE.Fog('#c9d4d6', 120, 420);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    this.scene.add(new THREE.HemisphereLight('#dfe8f2', '#5b5a3a', 1.5));
    const sun = new THREE.DirectionalLight('#fff2dc', 2.4); sun.position.set(-120, 200, -90); this.scene.add(sun);
    this.terrain();
    this.forests();
    this.places();
    this.cam = { x: m.W * 0.45, y: m.H * 0.4, dist: 140, yaw: 0 };
    this.bind();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.frames = []; this.last = performance.now();
    const loop = t => { requestAnimationFrame(loop); this.frame(t); };
    requestAnimationFrame(loop);
  }
  // altitude de la scène en (x, y) km (interpolée)
  hAt(x, y) {
    const { W, H } = this, hf = this.land.hgt;
    const u = Math.max(0, Math.min(W - 1.001, x - 0.5)), v = Math.max(0, Math.min(H - 1.001, y - 0.5)), i = u | 0, j = v | 0, fx = u - i, fy = v - j, c = j * W + i;
    const a = hf[c], b = hf[c + 1], d = hf[c + W], e = hf[c + W + 1];
    const h = a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy;
    return this.land.terrain[c] === T.OCEAN ? -0.06 : h * HZ;
  }
  // le relief : un maillage d'un sommet par demi-km, la peinture des terres, fleuves et routes par-dessus
  terrain() {
    const { W, H, m } = this, S = 2, nx = W * S + 1, ny = H * S + 1;
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = i / S, y = j / S;
      pos[k * 3] = x; pos[k * 3 + 1] = this.hAt(x, y); pos[k * 3 + 2] = y;
      uv[k * 2] = x / W; uv[k * 2 + 1] = 1 - y / H;
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let n = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    // la texture : la peinture des terres (2 px par km), agrandie à 8 px par km pour y peindre fleuves et routes
    const R = 8, cv = document.createElement('canvas'); cv.width = W * R; cv.height = H * R;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true; c.drawImage(this.land.landCanvas, 0, 0, W * R, H * R);
    c.setTransform(R, 0, 0, R, 0, 0); c.lineCap = c.lineJoin = 'round';
    for (const r of m.rivers) {
      c.beginPath(); r.pts.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.strokeStyle = 'rgba(70,58,36,0.8)'; c.lineWidth = r.rank === 1 ? 1.1 : 0.6; c.stroke();
      c.strokeStyle = '#6aa3a0'; c.lineWidth = r.rank === 1 ? 0.75 : 0.38; c.stroke();
    }
    for (const w of m.waters) { c.beginPath(); w.ring.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fillStyle = '#4f9a98'; c.fill(); }
    for (const e of m.edges) {
      if (e.kind === 'water') continue;
      const A = m.nodes[e.a], B = m.nodes[e.b];
      c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y);
      c.strokeStyle = 'rgba(74,60,36,0.55)'; c.lineWidth = e.royal ? 0.42 : 0.26; c.stroke();
      c.strokeStyle = e.royal ? '#e8d8a8' : '#d6c497'; c.lineWidth = e.royal ? 0.26 : 0.15; c.stroke();
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    this.ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(this.ground);
    // la mer, plate, sous les terres
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, H * 3).rotateX(-Math.PI / 2).translate(W / 2, -0.04, H / 2), new THREE.MeshLambertMaterial({ color: '#2a7a84' }));
    this.scene.add(sea);
  }
  // les forêts : des houppiers ronds instanciés, trois par km² de forêt, quelques-uns dans les landes
  forests() {
    const { W, H } = this, tr = this.land.terrain, list = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const t = tr[j * W + i], n = t === T.FORET ? 3 : t === T.LANDE ? 1 : 0;
      for (let k = 0; k < n; k++) { if (t === T.LANDE && hash(i, j, 9) > 0.35) continue; list.push([i + hash(i, j, k * 3 + 1), j + hash(i, j, k * 3 + 2), 0.16 + hash(i, j, k * 3 + 3) * 0.1, t === T.LANDE]); }
    }
    const geo = new THREE.IcosahedronGeometry(1, 0).scale(1, 1.15, 1);   // (20 triangles : il y en a des dizaines de milliers)
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length), M = new THREE.Matrix4(), col = new THREE.Color();
    const tones = ['#30431d', '#3b5121', '#475e25', '#2c4022'];
    list.forEach(([x, y, r, pin], k) => {
      M.makeScale(r, r * (pin ? 1.6 : 1), r).setPosition(x, this.hAt(x, y) + r * 0.9, y);
      mesh.setMatrixAt(k, M); mesh.setColorAt(k, col.set(pin ? tones[3] : tones[k % 3]));
    });
    this.scene.add(mesh);
    this.trees = list.length;
  }
  // les places : leur dessin de towns.js debout sur un panneau, et leur nom sur une plaque
  places() {
    const art = new TownArt({ dpr: 2 });
    this.labels = [];
    for (const n of this.m.nodes) {
      const s = n.type === 'capitale' ? 70 : n.type === 'ville' ? 52 : n.type === 'fort' ? 44 : 34;
      const sp = art.sprite(n, s, 0, false);
      const tex = new THREE.CanvasTexture(sp.cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      const k = (n.type === 'capitale' ? 3.2 : n.type === 'ville' ? 2.4 : 1.6) / sp.S;
      spr.scale.set(sp.W * k, sp.H * k, 1);
      spr.center.set(0.5, 0.38);
      spr.position.set(n.x, this.hAt(n.x, n.y) + 0.05, n.y);
      this.scene.add(spr);
      if (n.type !== 'village') this.labels.push({ n, el: this.plaque(n) });
    }
  }
  plaque(n) {
    const el = document.createElement('div');
    el.className = 'c3-plaque' + (n.type === 'capitale' ? ' cap' : '');
    el.textContent = n.name.toLocaleUpperCase('fr-FR');
    document.body.append(el);
    return el;
  }
  bind() {
    const cv = this.cv;
    let drag = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.b === 2) { this.cam.yaw += dx * 0.005; return; }
      const k = this.cam.dist / 600, c = Math.cos(this.cam.yaw), s = Math.sin(this.cam.yaw);
      this.cam.x -= (dx * c - dy * s) * k; this.cam.y -= (dx * s + dy * c) * k;
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.dist = Math.max(8, Math.min(420, this.cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  }
  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  frame(t) {
    const dt = t - this.last; this.last = t;
    this.frames.push(dt); if (this.frames.length > 60) this.frames.shift();
    const c = this.cam;
    // la vue se couche en zoomant : 62° d'inclinaison de loin, 30° de près
    const pitch = (30 + 32 * Math.min(1, (c.dist - 8) / 260)) * Math.PI / 180;
    const tx = c.x, tz = c.y, ty = this.hAt(c.x, c.y);
    this.camera.position.set(tx - Math.sin(c.yaw) * Math.cos(pitch) * c.dist, ty + Math.sin(pitch) * c.dist, tz + Math.cos(c.yaw) * Math.cos(pitch) * c.dist);
    this.camera.lookAt(tx, ty, tz);
    this.scene.fog.near = c.dist * 0.9; this.scene.fog.far = c.dist * 3.2;
    this.renderer.render(this.scene, this.camera);
    // plaques des noms, au-dessus des places vues
    const v = new THREE.Vector3(), w = this.cv.clientWidth, h = this.cv.clientHeight;
    for (const l of this.labels) {
      v.set(l.n.x, this.hAt(l.n.x, l.n.y), l.n.y).project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (l.n.type === 'capitale' || c.dist < 160);
      l.el.style.display = on ? '' : 'none';
      if (on) l.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h + 8}px) translateX(-50%)`;
    }
    if (this.onStats) {
      const ms = this.frames.reduce((a, b) => a + b, 0) / this.frames.length, info = this.renderer.info.render;
      this.onStats(`${Math.round(1000 / ms)} images/s · ${info.calls} appels · ${Math.round(info.triangles / 1000)} k triangles · ${this.trees} arbres`);
    }
  }
}
