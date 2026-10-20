// Vue tactique : l'herbe en relief (étape 9f). Autour de la caméra, des touffes de brins en volume, placées par la
// carte graphique : un lot d'instances dont chacune trouve sa place dans une grille centrée sur la vue (gl_InstanceID),
// un peu bousculée, à l'altitude du sol (texture des hauteurs de relief.js). Elles ne poussent que dans les prés et les
// landes (masques des sols de terrain.js), jamais sur les routes ni dans l'eau ; elles prennent la couleur du sol peint
// sous leur pied (la peinture de terrain.js : pas de raccord entre le sol et l'herbe, de loin elles s'y fondent),
// ondulent au vent, se couchent là où les troupes sont passées (piétinement) et reçoivent l'ombre des nuages et des
// collines (relief.js, ombrage). Rien de loin (on ne les verrait pas), rien en qualité Basse et Moyenne.
import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from './formes.js';

// par qualité (qualite.js, herbe) : demi-côté de la grille (m) et pas entre deux touffes (m)
export const HERBE = { 0: null, 1: { R: 45, sp: 0.75 }, 2: { R: 70, sp: 0.62 }, 3: { R: 95, sp: 0.55 } };
// touffes par côté de la grille
export const cote = cfg => Math.ceil(2 * cfg.R / cfg.sp);

// une touffe : sept brins (un triangle chacun), penchés vers l'extérieur, de hauteurs inégales (de 60 cm à 1 m : plus
// hauts que nature, comme chez Ultimate General, sans quoi on ne les verrait pas à la distance de jeu) ; uv.y : 0 au
// pied, 1 à la pointe
function touffe() {
  const pos = [], uv = [], nor = [], N = 7;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2 + (k % 2) * 0.4, r = 0.06 + (k % 3) * 0.06, h = 0.6 + ((k * 37) % 7) / 7 * 0.45, w = 0.09;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, lean = 0.18 + (k % 2) * 0.14;
    const tx = Math.cos(a) * (r + lean), tz = Math.sin(a) * (r + lean);
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;   // (en travers du brin)
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, tx, h, tz);
    uv.push(0, 0, 1, 0, 0.5, 1);
    for (let q = 0; q < 3; q++) nor.push(Math.cos(a) * 0.35, 0.94, Math.sin(a) * 0.35);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export class Herbe {
  // relief : Relief (uni : hauteurs, masques, peinture, vent, piétinement ; ombrage) ; q : profil de qualité
  constructor(relief, q) {
    this.r = relief;
    this.uni = { uGO: { value: new THREE.Vector2() }, uSp: { value: 0.6 }, uSide: { value: 1 }, uR: { value: 60 } };
    const geo = touffe(), mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const R = relief.uni;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni, { uHgt: R.uHgt, uHgtUV: R.uHgtUV, uMask: R.uMask, uMaskPx: R.uMaskPx, uSize: R.uSize, uBase: { value: relief.tex },
        uPiet: R.uPiet, uWind: R.uWind, uWindK: R.uWindK, uTime: R.uTime });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform vec2 uGO, uSize, uWind; uniform float uSp, uSide, uR, uTime, uWindK, uMaskPx; uniform vec4 uHgtUV;
          uniform sampler2D uHgt, uMask, uBase, uPiet;
          varying vec3 vCol; varying float vTip;
          float hh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`)
        .replace('#include <begin_vertex>', `
          // la case de cette touffe dans la grille, et sa place un peu bousculée (le même hasard pour une case du monde,
          // quand la grille suit la caméra : l'herbe ne bouge pas)
          float id = float(gl_InstanceID);
          vec2 cell = vec2(mod(id, uSide), floor(id / uSide)) - uSide * 0.5;
          vec2 wc = floor(uGO / uSp) + cell;
          vec2 p = (wc + vec2(hh(wc), hh(wc + 17.3))) * uSp;
          vec2 fuv = p / uSize;   // (uv : la place du sommet sur son brin, 1 à la pointe)
          // combien d'herbe : prés et landes (masques des sols : pré à gauche en rouge, lande en bleu), dans le champ
          vec2 mu = clamp(fuv, 0.0, 1.0) * vec2(0.5, 1.0); mu.x = clamp(mu.x, uMaskPx, 0.5 - uMaskPx);
          vec4 m = texture2D(uMask, mu);
          float g = (m.r + m.b * 0.8) * step(0.0, min(min(fuv.x, fuv.y), min(1.0 - fuv.x, 1.0 - fuv.y)));
          // couchée là où les troupes sont passées ; plus clairsemée et plus basse vers le bord de la grille
          float pt = clamp(texture2D(uPiet, clamp(fuv, 0.0, 1.0)).r, 0.0, 1.0);
          float d = length(p - uGO) / uR, edge = 1.0 - smoothstep(0.65, 1.0, d);
          float s = smoothstep(0.25, 0.6, g) * edge * (1.0 - 0.85 * pt) * (0.7 + 0.6 * hh(wc + 5.1));
          if (hh(wc + 9.7) > g * 1.15 + 0.05) s = 0.0;   // (les touffes se raréfient là où le pré cède la place)
          // près de l'œil, à peu près à leur taille vraie (elles ne cachent pas les jambes des hommes et des chevaux) ;
          // plus loin, plus hautes, sans quoi on ne les verrait plus
          float hg = texture2D(uHgt, p * uHgtUV.xy + uHgtUV.zw).r;
          s *= mix(0.5, 1.0, smoothstep(15.0, 90.0, distance(vec3(p.x, hg, p.y), cameraPosition)));
          float a = hh(wc + 3.3) * 6.2831853, ca = cos(a), sa = sin(a);
          vec3 transformed = vec3(ca * position.x - sa * position.z, position.y, sa * position.x + ca * position.z) * s;
          // le vent : la pointe ploie, par vagues qui traversent le pré
          float wave = sin(uTime * 1.6 + dot(p, uWind) * 0.22) * 0.5 + sin(uTime * 2.9 + dot(p, uWind.yx) * 0.5) * 0.2;
          transformed.xz += uWind * (wave * 0.6 + 0.4) * uWindK * 0.16 * uv.y * uv.y * s;
          transformed += vec3(p.x, hg - 0.02, p.y);
          // la couleur du sol peint sous le pied, plus sombre au pied, plus claire et plus jaune à la pointe
          vec3 base = texture2D(uBase, clamp(fuv, 0.0, 1.0)).rgb;
          vTip = uv.y;
          vCol = base * mix(0.4, 1.3, uv.y) * mix(vec3(1.0), vec3(1.12, 1.08, 0.78), uv.y * hh(wc + 1.9)) * (0.85 + 0.3 * hh(wc + 7.7));`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCol; varying float vTip;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vCol;');
    };
    mat.customProgramCacheKey = () => 'herbe';
    relief.ombrage(mat);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.geo = geo; this.mat = mat;
    this.setQuality(q);
  }
  setQuality(q) {
    this.cfg = HERBE[q.herbe ?? 0];
    if (!this.cfg) { this.geo.instanceCount = 0; return; }
    const n = cote(this.cfg);
    this.uni.uSide.value = n; this.uni.uSp.value = this.cfg.sp; this.uni.uR.value = this.cfg.R;
    this.n = n * n;
  }
  // fr : la caméra (camera.js) ; seulement d'assez près (au-delà de 260 m, une touffe fait moins d'un pixel ou deux)
  follow(fr) {
    const on = !!this.cfg && fr.dist < 260;
    this.mesh.visible = on;
    if (!on) return;
    this.geo.instanceCount = this.n;
    // la grille centrée un peu en avant de l'œil, vers la cible : là où l'herbe se voit
    const k = clamp(this.cfg.R / Math.max(1, Math.hypot(fr.T[0] - fr.E[0], fr.T[2] - fr.E[2])), 0, 1);
    this.uni.uGO.value.set(fr.E[0] + (fr.T[0] - fr.E[0]) * Math.max(k, 0.6), fr.E[2] + (fr.T[2] - fr.E[2]) * Math.max(k, 0.6));
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
