// Vue tactique : le relief du champ de bataille en 3D. Un seul maillage : une maille de 10 m dans le champ, plus
// lâche au-delà (le terrain se prolonge sur 2 km et se perd dans la brume, ses altitudes celles du bord). Le sol est
// peint par terrain.js (en mode « à plat ») ; hors du champ, il passe à une herbe sans détail. Un liseré doré marque
// le bord du champ. Ciel, brume et lumières de la scène sont ici aussi.
//
// Finesse du sol : l'image entière (0,5 px/m) en secours, et autour de la caméra des niveaux plus fins (2, 4, 8,
// 16 px/m selon la qualité). Chaque niveau est une texture de 4 × 4 blocs de 512 px qui suit la caméra : un bloc qui
// sort d'un côté est repeint de l'autre (adressage torique), quelques blocs par image. Mémoire fixe (16 Mo par
// niveau). Pour chaque pixel, le shader prend le niveau le plus fin qui est peint à cet endroit et pas plus fin que
// l'écran (sans quoi il scintillerait).
//
// Tués, chevaux et trous d'obus : de petits panneaux posés sur le relief (un lot par sorte), pas repeints dans le sol.
import * as THREE from '../../vendor/three/three.module.js';
import { clamp, hash, canvas } from './formes.js';
import { paintDecal } from './terrain.js';

const STEP = 10, OUT = 2000, OUT_STEP = 125;   // maille dans le champ, prolongement au-delà, maille du prolongement
const TS = 512, N = 4;                         // côté d'un bloc (px), blocs par côté d'un niveau de détail
const LEVELS = [2, 4, 8, 16];                  // niveaux de détail possibles (px/m)

// ombres des nuages : taches douces et périodiques (le motif couvre environ 1,5 km)
function cloudTexture() {
  const s = 256, cv = canvas(s, s), g = cv.getContext('2d'), img = g.createImageData(s, s), P = 8;
  const pn = (x, y, p, seed) => {   // bruit périodique de période p cases
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const h = (i, j) => hash(((i % p) + p) % p, ((j % p) + p) % p, seed);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const v = pn(x / s * P, y / s * P, P, 11) * 0.65 + pn(x / s * P * 2, y / s * P * 2, P * 2, 12) * 0.35;
    const k = (y * s + x) * 4, a = clamp((v - 0.5) / 0.22, 0, 1);
    img.data[k] = 22; img.data[k + 1] = 30; img.data[k + 2] = 44; img.data[k + 3] = a * a * (3 - 2 * a) * 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// abscisses du maillage : [−OUT, 0[ par OUT_STEP, [0, L] par STEP, ]L, L + OUT] par OUT_STEP
function ticks(L) {
  const out = [];
  for (let x = -OUT; x < 0; x += OUT_STEP) out.push(x);
  for (let x = 0; x < L; x += STEP) out.push(x);
  out.push(L);
  for (let x = L + OUT_STEP; x <= L + OUT; x += OUT_STEP) out.push(x);
  return out;
}

export class Relief {
  // terrain : Terrain (peint à plat) ; q : profil de qualité graphique
  constructor(terrain, q) {
    this.t = terrain; this.q = q;
    this.W = terrain.W; this.H = terrain.H;
    // exagération du relief, comme l'ombrage de la vue 2D : quelques mètres de dénivelé doivent se lire
    this.ex = terrain.hmax - terrain.hmin > 40 ? 1.5 : 2.2;
    this.group = new THREE.Group();
    this.tex = new THREE.CanvasTexture(terrain.base);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = false;
    this.tex.anisotropy = 4;
    this.cover = new THREE.CanvasTexture(terrain.coverImg);
    this.cover.colorSpace = THREE.SRGBColorSpace;
    this.cover.flipY = false;
    this.uni = {
      uOuter: { value: new THREE.Color() }, uSize: { value: new THREE.Vector2(this.W, this.H) },
      uCover: { value: this.cover }, uCoverA: { value: 0 },
      uClouds: { value: null }, uCloudA: { value: 0 }, uCloudOff: { value: new THREE.Vector2() },
      uLv0: { value: null }, uLv1: { value: null }, uLv2: { value: null }, uLv3: { value: null }, uSpan: { value: new THREE.Vector4() }, uSlots: { value: Array.from({ length: N * N * 4 }, () => new THREE.Vector2(-1e4, -1e4)) },
    };
    this.clouds = new THREE.CanvasTexture(cloudTexture());
    this.clouds.wrapS = this.clouds.wrapT = THREE.RepeatWrapping;
    this.uni.uClouds.value = this.clouds;
    this.scratch = canvas(TS, TS);
    this.scratchTex = new THREE.CanvasTexture(this.scratch);
    this.scratchTex.colorSpace = THREE.SRGBColorSpace;
    this.scratchTex.flipY = false;
    this.setQuality(q);
    this.mesh = new THREE.Mesh(this.geometry(), this.material());
    this.group.add(this.mesh);
    this.decals = new Decals(this);
    // lumière : ciel et sol (hémisphère), soleil
    this.hemi = new THREE.HemisphereLight('#dfe8f2', '#5b5a3a', 1.7);
    this.sun = new THREE.DirectionalLight('#fff4e2', 2.2);
    this.sunDir = new THREE.Vector3(-0.55, 0.75, 0.45).normalize();   // vers le soleil (ciel la remplace)
    this.sun.position.copy(this.sunDir).multiplyScalar(2500);
    this.group.add(this.hemi, this.sun, this.sun.target);
    this.mesh.receiveShadow = true;
  }
  // altitude de la scène (m, 0 au plus bas du champ) ; hors du champ, celle du bord
  heightAt = (x, y) => (this.t.fineAt(clamp(x, 0, this.W), clamp(y, 0, this.H)) - this.t.hmin) * this.ex;

  geometry() {
    const xs = ticks(this.W), ys = ticks(this.H), nx = xs.length, ny = ys.length;
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = xs[i], y = ys[j];
      // au-delà du champ, le terrain descend un peu en s'éloignant : l'horizon ne se découpe pas en marche
      const out = Math.hypot(Math.max(0, -x, x - this.W), Math.max(0, -y, y - this.H));
      pos[k * 3] = x; pos[k * 3 + 1] = this.heightAt(x, y) - out * 0.03; pos[k * 3 + 2] = y;
      uv[k * 2] = x / this.W; uv[k * 2 + 1] = y / this.H;
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let n = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }
  material() {
    const m = new THREE.MeshLambertMaterial({ map: this.tex });
    const pal = this.t.pal;
    this.uni.uOuter.value.set(pal.neige ? '#dde3e8' : pal.pre[1]).multiplyScalar(pal.neige ? 0.95 : 0.82);
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = position.xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uOuter; uniform vec2 uSize; uniform sampler2D uCover; uniform float uCoverA;
          uniform sampler2D uClouds; uniform float uCloudA; uniform vec2 uCloudOff;
          // (quatre textures séparées : un tableau de textures se mêlait à uCover dans l'attribution des unités)
          uniform sampler2D uLv0, uLv1, uLv2, uLv3; uniform vec4 uSpan; uniform vec2 uSlots[${N * N * 4}];
          varying vec2 vWorld;
          // un niveau de détail en p (m) : sa couleur, et ok = 1 si le bloc de p y est peint
          vec4 lvl(sampler2D t, float span, int base, vec2 p, out float ok) {
            ok = 0.0;
            if (span <= 0.0) return vec4(0.0);
            vec2 b = floor(p / span), s = mod(b, ${N}.0);
            ok = all(equal(uSlots[base + int(s.x) + ${N} * int(s.y)], b)) ? 1.0 : 0.0;
            return texture(t, fract(p / (span * ${N}.0)));
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          // niveaux de détail, du plus grossier au plus fin : chacun recouvre le précédent là où il est peint, et
          // seulement s'il n'est pas plus fin que l'écran (texels par pixel : texels/m × m/pixel)
          float mpp = length(fwidth(vWorld)), ok;
          vec4 c;
          ${LEVELS.map((L, i) => `c = lvl(uLv${i}, uSpan[${i}], ${i * N * N}, vWorld, ok);
          diffuseColor.rgb = mix(diffuseColor.rgb, c.rgb, ok * (1.0 - smoothstep(1.2, 2.2, ${TS}.0 / max(uSpan[${i}], 1e-3) * mpp)));`).join('\n          ')}
          // couverts (déploiement) : bois, bâti, hauteurs (plus appuyés que sur la carte 2D : la lumière les adoucit)
          vec4 cv = texture(uCover, vMapUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, cv.rgb, min(0.85, cv.a * uCoverA * 2.4));
          // ombres des nuages qui passent, poussées par le vent (le motif se répète tous les 1 536 m)
          diffuseColor.rgb *= 1.0 - texture(uClouds, (vWorld - uCloudOff) / 1536.0).a * uCloudA;
          // hors du champ : une herbe sans détail ; au bord, un liseré doré d'environ un pixel et demi
          vec2 m = min(vMapUv, 1.0 - vMapUv) * uSize;
          float e = min(m.x, m.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, uOuter, smoothstep(0.0, 40.0, -e));
          float w = fwidth(e) * 1.5;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.70, 0.36), (1.0 - smoothstep(w * 0.5, w, abs(e))) * 0.8);`);
    };
    return m;
  }

  // ------------------------------------------------------------------ niveaux de détail du sol
  // force : tout repeindre (contexte WebGL rendu : les niveaux sont revenus vides) ; sinon seulement si le sol le plus
  // fin permis change
  setQuality(q, force = false) {
    const same = this.levels && this.q.level === q.level;
    this.q = q;
    if (same && !force) return;
    for (const l of this.levels || []) l?.tex.dispose();
    this.levels = LEVELS.map(L => L <= q.level ? { L, span: TS / L, slots: new Array(N * N).fill(null), tex: this.levelTex() } : null);
    this.levels.forEach((l, i) => { this.uni[`uLv${i}`].value = l ? l.tex : this.tex; });   // (niveau absent : jamais lu, uSpan = 0)
    this.uni.uSpan.value.set(...this.levels.map(l => l ? l.span : 0));
    for (const v of this.uni.uSlots.value) v.set(-1e4, -1e4);
  }
  levelTex() {
    const t = new THREE.DataTexture(null, TS * N, TS * N);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.source.dataReady = false;   // réservée sur la carte graphique sans données : les blocs y sont copiés un à un
    t.needsUpdate = true;
    return t;
  }
  // peint au plus `budget` blocs manquants : ceux qu'on voit à l'écran d'abord, les niveaux grossiers avant les fins (un
  // bloc grossier couvre 64 fois plus de terrain qu'un fin pour le même prix : la vue s'améliore partout, puis s'affine),
  // les plus proches du sol vu au bas de l'écran (là où la caméra est la plus proche) ; les niveaux plus fins que
  // nécessaire pour la vue sont sautés
  updateDetail(renderer, view, budget) {
    if (budget <= 0) return false;
    const [gx, gy] = view.toWorld(view.vw / 2, view.vh * 0.72);
    const near = view.toScreen(gx, gy)[2];                                    // distance de ce point à l'œil (m)
    const need = clamp(view.fr().k / Math.max(1, near) * view.dpr * 2, 1, 16);   // px/m utiles au plus près
    const todo = [];
    this.levels.forEach((l, li) => {
      if (!l || l.L > need * 1.5) return;
      const bx0 = Math.floor(gx / l.span - N / 2 + 0.5), by0 = Math.floor(gy / l.span - N / 2 + 0.5);
      const maxX = Math.ceil(this.W / l.span) - 1, maxY = Math.ceil(this.H / l.span) - 1;
      for (let by = by0; by < by0 + N; by++) for (let bx = bx0; bx < bx0 + N; bx++) {
        if (bx < 0 || by < 0 || bx > maxX || by > maxY) continue;
        const si = (bx % N) + N * (by % N), s = l.slots[si];
        if (s && s[0] === bx && s[1] === by) continue;
        const [sx, sy, depth] = view.toScreen((bx + 0.5) * l.span, (by + 0.5) * l.span);
        const seen = depth > 0 && sx > -view.vw * 0.5 && sx < view.vw * 1.5 && sy > -view.vh * 0.5 && sy < view.vh * 1.5;
        todo.push({ li, bx, by, si, d: (seen ? 0 : 1000) + li * 10 + Math.hypot((bx + 0.5) * l.span - gx, (by + 0.5) * l.span - gy) / l.span });
      }
    });
    todo.sort((a, b) => a.d - b.d);
    for (const b of todo.slice(0, budget)) this.paintBlock(renderer, b.li, b.bx, b.by, b.si);
    return todo.length > 0;
  }
  paintBlock(renderer, li, bx, by, si) {
    const l = this.levels[li];
    this.t.paintInto(this.scratch, bx * l.span, by * l.span, l.span, l.span, l.L);
    // (le canevas n'est jamais une texture de la scène : ses pixels sont envoyés droit dans le niveau)
    renderer.copyTextureToTexture(this.scratchTex, l.tex, null, new THREE.Vector2((si % N) * TS, Math.floor(si / N) * TS));
    l.slots[si] = [bx, by];
    this.uni.uSlots.value[li * N * N + si].set(bx, by);
  }
  // une brèche : les blocs qui la touchent sont à repeindre, l'image entière aussi
  invalidate(x, y, r) {
    this.levels.forEach((l, li) => {
      if (!l) return;
      l.slots.forEach((s, si) => {
        if (!s || x + r < s[0] * l.span || x - r > (s[0] + 1) * l.span || y + r < s[1] * l.span || y - r > (s[1] + 1) * l.span) return;
        l.slots[si] = null; this.uni.uSlots.value[li * N * N + si].set(-1e4, -1e4);
      });
    });
    this.dirty();
  }

  // ombres portées du soleil (qualité : 0 aucune, 1 décor seulement, 2 et 3 décor et troupes), carte de 1024 à 4096 px
  shadows(renderer, level) {
    renderer.shadowMap.enabled = level > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = level > 0;
    if (level > 0) {
      const size = [0, 1024, 2048, 4096][level];
      if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    }
  }
  // le cadre des ombres suit la cible de la caméra (plus grand de loin), calé sur les texels pour ne pas scintiller
  follow(fr) {
    if (!this.sun.castShadow) return;
    const S = clamp(fr.dist * 0.9, 70, 1400), sh = this.sun.shadow, c = sh.camera, step = 2 * S / sh.mapSize.x;
    const tx = Math.round(fr.T[0] / step) * step, tz = Math.round(fr.T[2] / step) * step, d = this.sunDir;
    this.sun.target.position.set(tx, fr.T[1], tz);
    this.sun.position.set(tx + d.x * 2500, fr.T[1] + d.y * 2500, tz + d.z * 2500);
    if (c.right !== S) { c.left = -S; c.right = S; c.top = S; c.bottom = -S; c.near = 100; c.far = 5000; c.updateProjectionMatrix(); }
  }
  // ciel, brume (selon la distance de la caméra : le champ reste net, le prolongement s'y perd)
  setup(scene) {
    const sky = new THREE.Color('#cbd8e4');
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 1000, 8000);
    scene.add(this.group);
  }
  // coverA : opacité du voile des couverts (0 : caché) ; sky : lumière et ciel (Effects.ciel) ; time : horloge (s)
  update(scene, dist, coverA = 0, sky = null, time = 0) {
    this.uni.uCoverA.value = coverA;
    if (!sky) return;
    this.sunDir.set(...sky.sunDir).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(2500).add(this.sun.target.position); this.sun.color.setRGB(...sky.sun); this.sun.intensity = sky.sunI;
    this.hemi.color.setRGB(...sky.hemiSky); this.hemi.groundColor.setRGB(...sky.hemiGround); this.hemi.intensity = sky.hemiI;
    scene.background.setRGB(...sky.fog); scene.fog.color.setRGB(...sky.fog);
    scene.fog.near = (dist * 0.8 + 600) * sky.fogNear;
    scene.fog.far = (dist * 3 + 5000) * sky.fogFar;
    this.uni.uCloudA.value = sky.cloudA;
    this.uni.uCloudOff.value.set(time * (3 + sky.wind[0] * 2.5), time * (1 + sky.wind[1] * 2.5));
  }
  // l'image entière a été repeinte (brèche) : renvoyée à la carte graphique, une fois par seconde au plus
  dirty() { this.isDirty = true; }
  tick(now) {
    if (this.isDirty && now - (this.upT || 0) > 1000) { this.tex.needsUpdate = true; this.isDirty = false; this.upT = now; }
  }
  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose(); this.cover.dispose(); this.scratchTex.dispose(); this.clouds.dispose();
    for (const l of this.levels) l?.tex.dispose();
    this.decals.dispose();
  }
}

// ------------------------------------------------------------------ tués et trous d'obus
// Un lot de panneaux par sorte (soldat tombé d'un camp, cheval, trou d'obus), peints une fois par terrain.js
// (paintDecal) dans une petite image ; au-delà de 3000 panneaux d'une sorte, les plus anciens sont réutilisés.
const DS = 3, DPX = 128, CAP = 3000, R0 = 1.48;   // côté de l'image (m), en pixels ; rayon du trou d'obus peint
class Decals {
  constructor(relief) { this.r = relief; this.sets = new Map(); }
  add(list) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const d of list) {
      const key = d.k === 'mort' ? `mort|${d.c}` : d.k, set = this.sets.get(key) || this.make(key, d);
      const k = d.k === 'trou' ? (d.r || 2.6) / R0 : 1;
      p.set(d.x, this.r.heightAt(d.x, d.y) + 0.06, d.y);
      q.setFromAxisAngle(up, -(d.a || 0));   // (le dessin tourne de x vers y ; autour de l'axe vertical, c'est −a)
      set.mesh.setMatrixAt(set.n % CAP, m.compose(p, q, sc.set(DS * k, 1, DS * k)));
      set.n++;
      set.mesh.count = Math.min(set.n, CAP);
      set.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  make(key, d) {
    const cv = canvas(DPX, DPX), g = cv.getContext('2d'), s = DPX / DS;
    g.setTransform(s, 0, 0, s, 0, 0);
    paintDecal(g, { ...d, x: DS / 2, y: DS / 2, a: 0, r: R0 }, s);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const mesh = new THREE.InstancedMesh(geo, mat, CAP);
    mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1;
    this.r.group.add(mesh);
    const set = { mesh, tex, n: 0 };
    this.sets.set(key, set);
    return set;
  }
  dispose() { for (const s of this.sets.values()) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.tex.dispose(); s.mesh.dispose(); } this.sets.clear(); }
}
