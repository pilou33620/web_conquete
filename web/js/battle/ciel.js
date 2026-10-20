// Vue tactique : le ciel (SPEC-SUITE, F1). Un dôme qui suit la caméra, dessiné avant tout le reste : dégradé de
// l'horizon (la couleur de la brume, pour que le lointain s'y fonde) au zénith, halo autour du soleil, couchant
// coloré, et des nuages qui défilent au vent. Les nuages sont tirés de la même image que leurs ombres au sol
// (relief.js) : une ombre passe sous un nuage. Couleurs de la table des heures (heures.js, ambiance).
// Sans texture en plus ; en Basse, pas de nuages.
import * as THREE from '../../vendor/three/three.module.js';

const NUAGE = 2400;   // période du motif des nuages (m), celle des ombres au sol (relief.js)
const HAUT = 1800;    // altitude des nuages (m) : leur place dans le ciel vu de la caméra

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = (modelMatrix * vec4(position, 0.0)).xyz;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;   // au fond de l'image
  }`;

const FRAG = `
  uniform vec3 uHor, uZen, uSunDir, uSunCol; uniform float uSunI, uCloudA, uNuages;
  uniform sampler2D uClouds; uniform vec2 uCloudOff;
  varying vec3 vDir;
  #include <common>
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    // dégradé : l'horizon s'éclaircit sur une bande basse, puis le bleu monte vers le zénith
    // (la caméra regarde rarement haut : le bleu doit venir vite au-dessus de la bande claire de l'horizon)
    vec3 c = mix(uHor, uZen, pow(smoothstep(0.0, 0.32, h), 0.6));
    // du côté du soleil, l'horizon se teinte de sa lumière (couchant), et un halo l'entoure
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * (pow(s, 6.0) * 0.28 * (1.0 - h) + pow(s, 60.0) * 0.35) * uSunI;
    c += uSunCol * smoothstep(0.9993, 0.9997, s) * 6.0 * uSunI;
    // nuages : le motif des ombres, projeté sur un plafond à HAUT m, qui s'efface vers l'horizon
    if (uNuages > 0.5 && d.y > 0.02) {
      vec2 p = d.xz / d.y * ${HAUT.toFixed(1)};
      float a = texture2D(uClouds, (p - uCloudOff) / ${NUAGE.toFixed(1)}).a;
      float b = texture2D(uClouds, (p * 0.47 - uCloudOff * 0.6) / ${NUAGE.toFixed(1)} + 0.37).a;
      // la couverture suit la météo : quelques bancs par beau temps, un ciel presque fermé sous les nuages
      float cov = clamp(uCloudA * 2.6, 0.0, 1.0), n = a * 0.65 + b * 0.45;
      float k = smoothstep(1.0 - cov * 0.75, 1.15 - cov * 0.6, n) * smoothstep(0.02, 0.22, d.y);
      // dessus éclairé (blanc chaud du côté du soleil), dessous gris bleuté
      vec3 lit = mix(uHor * 1.08, uSunCol * 1.15, 0.35 + 0.4 * pow(s, 3.0)) * (0.75 + 0.35 * uSunI);
      vec3 cl = mix(lit, uHor * vec3(0.72, 0.76, 0.84), clamp(b * 0.8, 0.0, 0.6));
      c = mix(c, cl, k * 0.85);
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Ciel {
  // relief : Relief (son image des nuages et leur défilement) ; q : profil de qualité
  constructor(relief, q) {
    this.uni = {
      uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() }, uSunI: { value: 1 }, uCloudA: relief.uni.uCloudA, uClouds: relief.uni.uClouds,
      uCloudOff: relief.uni.uCloudOff, uNuages: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uni, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.setQuality(q);
  }
  setQuality(q) { this.uni.uNuages.value = (q.post ?? 0) > 0 ? 1 : 0; }
  // amb : ambiance (heures.js) ; camera : la caméra de la vue
  update(amb, camera) {
    this.uni.uHor.value.setRGB(...amb.fog);
    this.uni.uZen.value.setRGB(...amb.zen);
    this.uni.uSunDir.value.set(...amb.sunDir).normalize();
    this.uni.uSunCol.value.setRGB(...amb.sun);
    this.uni.uSunI.value = Math.min(1.2, amb.sunI / 2.85);
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.5);
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
