// Vue tactique : l'après-rendu (étape 9a), écrit à la main, sans EffectComposer. La scène est rendue dans une texture
// flottante (demi-flottants), puis une passe plein écran fait, dans l'ordre :
//   anticrénelage FXAA (Haute ; en Ultra, la cible a son propre anticrénelage multi-échantillons) ;
//   profondeur de champ façon maquette (Ultra, à ras des troupes : le haut et le bas de l'image se floutent) ;
//   halo (bloom) léger des plein-soleil, des éclairs et de la neige (Haute et Ultra, en demi-résolution) ;
//   tone mapping ACES, passage en sRGB ;
//   étalonnage par une LUT 3D de 32³ calculée depuis la table des heures (heures.js), recalculée quand l'heure ou la
//   météo la changent à l'œil ;
//   vignettage (plus fort sous la pluie, la neige et la nuit), grain très léger (casse les aplats et les bandes).
// En qualité Basse, ou si la carte ne sait pas rendre dans une texture flottante, pas d'après-rendu : le rendu direct
// d'avant, avec le tone mapping ACES de Three.js (même courbe, même exposition) et sans LUT.
import * as THREE from '../../vendor/three/three.module.js';
import { lut, cleEtalonnage } from './heures.js';

const LUT_N = 32;

// le tone mapping ACES de Three.js (ajustement de Stephen Hill), exposition comprise : rendu direct et après-rendu
// donnent la même image avant étalonnage
const ACES = `
  vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 aces(vec3 c) {
    const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    return clamp(O * rrtOdt(I * (c * uExpo / 0.6)), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) { return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }`;

const VERT = `
  precision highp float;
  in vec3 position;
  out vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// halo : on garde ce qui dépasse le seuil (fondu doux), en demi-résolution, moyenne de 4 texels (pas de scintillement)
const BRIGHT = `
  precision highp float;
  uniform sampler2D tSrc; uniform vec2 uPx; uniform float uExpo;
  in vec2 vUv; out vec4 outColor;
  void main() {
    vec3 c = 0.25 * (texture(tSrc, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + uPx * vec2(1.0, -1.0)).rgb
      + texture(tSrc, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + uPx * vec2(1.0, 1.0)).rgb) * uExpo;
    float l = max(c.r, max(c.g, c.b)), k = clamp((l - 0.9) / 0.6, 0.0, 1.0);
    outColor = vec4(min(c * k * k, vec3(8.0)), 1.0);
  }`;
// flou gaussien séparable à 9 coups, en 5 lectures (filtrage linéaire)
const BLUR = `
  precision highp float;
  uniform sampler2D tSrc; uniform vec2 uDir;
  in vec2 vUv; out vec4 outColor;
  void main() {
    vec3 c = texture(tSrc, vUv).rgb * 0.2270270;
    c += (texture(tSrc, vUv + uDir * 1.3846154).rgb + texture(tSrc, vUv - uDir * 1.3846154).rgb) * 0.3162162;
    c += (texture(tSrc, vUv + uDir * 3.2307692).rgb + texture(tSrc, vUv - uDir * 3.2307692).rgb) * 0.0702703;
    outColor = vec4(c, 1.0);
  }`;

const FINAL = `
  precision highp float;
  precision highp sampler3D;
  uniform sampler2D tScene, tBloom; uniform sampler3D tLut;
  uniform vec2 uPx; uniform float uExpo, uVig, uBloom, uGrain, uTime, uTilt, uTiltY;
  in vec2 vUv; out vec4 outColor;
  ${ACES}
  float luma(vec3 c) { c = c / (1.0 + c); return dot(c, vec3(0.299, 0.587, 0.114)); }
  #ifdef FXAA
  // FXAA de Timothy Lottes (version « console », 9 lectures), sur la luminance d'une image déjà tassée
  vec3 fxaa(vec2 uv) {
    vec3 nw = texture(tScene, uv - uPx).rgb, ne = texture(tScene, uv + vec2(uPx.x, -uPx.y)).rgb;
    vec3 sw = texture(tScene, uv + vec2(-uPx.x, uPx.y)).rgb, se = texture(tScene, uv + uPx).rgb, m = texture(tScene, uv).rgb;
    float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(m);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    if (lMax - lMin < max(0.0312, lMax * 0.125)) return m;
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * uPx;
    vec3 a = 0.5 * (texture(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture(tScene, uv - dir * 0.5).rgb + texture(tScene, uv + dir * 0.5).rgb);
    float lB = luma(b);
    return lB < lMin || lB > lMax ? a : b;
  }
  #endif
  float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  void main() {
    #ifdef FXAA
    vec3 c = fxaa(vUv);
    #else
    vec3 c = texture(tScene, vUv).rgb;
    #endif
    #ifdef TILT
    // maquette : flou (disque de 8 lectures) qui croît loin de la bande nette, autour du tiers bas de l'image
    float coc = uTilt * smoothstep(0.12, 0.5, abs(vUv.y - uTiltY));
    if (coc > 0.02) {
      vec3 s = c;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398 + 0.39;
        s += texture(tScene, vUv + vec2(cos(a), sin(a)) * uPx * coc * (i % 2 == 0 ? 6.0 : 3.5)).rgb;
      }
      c = mix(c, s / 9.0, clamp(coc * 1.5, 0.0, 1.0));
    }
    #endif
    #ifdef BLOOM
    c += texture(tBloom, vUv).rgb * uBloom / max(uExpo, 0.01);
    #endif
    c = toSRGB(aces(c));
    // étalonnage (la LUT est lue au centre de ses cases)
    c = texture(tLut, c * ${((LUT_N - 1) / LUT_N).toFixed(6)} + ${(0.5 / LUT_N).toFixed(6)}).rgb;
    // vignettage : les bords plus sombres et un peu bleutés
    vec2 v = vUv * (1.0 - vUv);
    float vig = 1.0 - pow(clamp(v.x * v.y * 16.0, 0.0, 1.0), 0.28);
    c *= 1.0 - uVig * vig * vec3(1.0, 0.97, 0.9);
    c += (hash(gl_FragCoord.xy + fract(uTime) * 517.0) - 0.5) * uGrain;
    outColor = vec4(c, 1.0);
  }`;

// un triangle qui couvre l'écran
function triangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}
function pass(frag, uniforms, defines = {}) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
}

export class ApresRendu {
  // renderer : WebGLRenderer de la vue
  constructor(renderer) {
    this.r = renderer;
    this.niveau = 0;              // 0 : rendu direct ; 1 : LUT et vignettage ; 2 : + FXAA, halo ; 3 : + MSAA, maquette
    this.w = 1; this.h = 1;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(triangle());
    this.quad.frustumCulled = false;
    this.sc = new THREE.Scene(); this.sc.add(this.quad);
    this.lutTex = new THREE.Data3DTexture(new Uint8Array(LUT_N ** 3 * 4), LUT_N, LUT_N, LUT_N);
    this.lutTex.format = THREE.RGBAFormat; this.lutTex.type = THREE.UnsignedByteType;
    this.lutTex.minFilter = this.lutTex.magFilter = THREE.LinearFilter;
    this.lutTex.wrapS = this.lutTex.wrapT = this.lutTex.wrapR = THREE.ClampToEdgeWrapping;
    this.lutTex.unpackAlignment = 1;
    this.lutKey = '';
    this.uni = {
      tScene: { value: null }, tBloom: { value: null }, tLut: { value: this.lutTex }, uPx: { value: new THREE.Vector2() },
      uExpo: { value: 1 }, uVig: { value: 0.15 }, uBloom: { value: 0.35 }, uGrain: { value: 0.012 }, uTime: { value: 0 },
      uTilt: { value: 0 }, uTiltY: { value: 0.35 },
    };
    this.bright = pass(BRIGHT, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uExpo: this.uni.uExpo });
    this.blur = pass(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
  }
  // la carte sait-elle rendre dans une texture de demi-flottants (WebGL 2 avec EXT_color_buffer_float ou _half_float) ?
  static possible(renderer) {
    const ext = renderer.extensions;
    return ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
  }
  get actif() { return this.niveau > 0; }
  // q.post : 0 à 3 (qualite.js)
  setQuality(q) {
    const n = ApresRendu.possible(this.r) ? (q.post ?? 0) : 0;
    if (n === this.niveau && this.fin) return;
    this.niveau = n;
    this.fin?.dispose();
    const defines = {};
    if (n === 2) defines.FXAA = 1;
    if (n >= 2) defines.BLOOM = 1;
    if (n >= 3) defines.TILT = 1;
    this.fin = pass(FINAL, this.uni, defines);
    this.cibles();
  }
  // taille de l'image en pixels (celle du canevas WebGL)
  setSize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === this.w && h === this.h && this.rt) return;
    this.w = w; this.h = h;
    this.cibles();
  }
  cibles() {
    for (const t of [this.rt, this.ha, this.hb]) t?.dispose();
    this.rt = this.ha = this.hb = null;
    if (!this.actif) return;
    const o = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, { ...o, depthBuffer: true, samples: this.niveau >= 3 ? 4 : 0 });
    if (this.niveau >= 2) {
      const hw = Math.max(1, this.w >> 1), hh = Math.max(1, this.h >> 1);
      this.ha = new THREE.WebGLRenderTarget(hw, hh, { ...o, depthBuffer: false });
      this.hb = new THREE.WebGLRenderTarget(hw, hh, { ...o, depthBuffer: false });
    }
    this.uni.uPx.value.set(1 / this.w, 1 / this.h);
  }
  // étalonnage de l'heure (heures.js, grade) : la LUT n'est recalculée que s'il a changé à l'œil
  setGrade(G) {
    const key = cleEtalonnage(G);
    this.uni.uExpo.value = G.expo;
    this.uni.uVig.value = G.vig;
    if (key === this.lutKey) return;
    this.lutKey = key;
    this.lutTex.image.data.set(lut(G, LUT_N));
    this.lutTex.needsUpdate = true;
  }
  // G : étalonnage ; time : horloge (s) ; dist : distance de la caméra à sa cible (m), pour la maquette
  render(scene, camera, G, time = 0, dist = 1000) {
    const r = this.r;
    if (!this.actif) {
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = G.expo;
      r.render(scene, camera);
      return;
    }
    this.setGrade(G);
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    if (this.ha) {
      this.bright.uniforms.tSrc.value = this.rt.texture;
      this.bright.uniforms.uPx.value.set(0.5 / this.w, 0.5 / this.h);
      this.draw(this.bright, this.ha);
      for (const [src, dst, dx, dy] of [[this.ha, this.hb, 1, 0], [this.hb, this.ha, 0, 1]]) {
        this.blur.uniforms.tSrc.value = src.texture;
        this.blur.uniforms.uDir.value.set(dx * 1.6 / src.width, dy * 1.6 / src.height);
        this.draw(this.blur, dst);
      }
      this.uni.tBloom.value = this.ha.texture;
    }
    this.uni.tScene.value = this.rt.texture;
    this.uni.uTime.value = time;
    // maquette : seulement de près (moins de 260 m), de plus en plus fort jusqu'à 80 m
    this.uni.uTilt.value = Math.max(0, Math.min(1, (260 - dist) / 180));
    this.draw(this.fin, null);
  }
  draw(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.sc, this.cam);
  }
  dispose() {
    for (const t of [this.rt, this.ha, this.hb]) t?.dispose();
    this.fin?.dispose(); this.bright.dispose(); this.blur.dispose();
    this.quad.geometry.dispose(); this.lutTex.dispose();
  }
}
