// Vue tactique : le relief du champ de bataille en 3D. Un seul maillage : une maille de 10 m dans le champ, plus
// lâche au-delà (le terrain se prolonge sur 2 km et se perd dans la brume, ses altitudes celles du bord). Le sol est
// peint par terrain.js (en mode « à plat ») ; hors du champ, il passe à une herbe sans détail. Un liseré doré marque
// le bord du champ. Ciel, brume et lumières de la scène sont ici aussi.
import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from './formes.js';

const STEP = 10, OUT = 2000, OUT_STEP = 125;   // maille dans le champ, prolongement au-delà, maille du prolongement

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
    this.mesh = new THREE.Mesh(this.geometry(), this.material());
    this.group.add(this.mesh);
    // lumière : ciel et sol (hémisphère), soleil
    this.hemi = new THREE.HemisphereLight('#dfe8f2', '#5b5a3a', 1.7);
    this.sun = new THREE.DirectionalLight('#fff4e2', 2.2);
    this.sun.position.set(-0.55, 0.75, 0.45);   // (direction seulement) le soleil au sud-ouest, haut sur l'horizon
    this.group.add(this.hemi, this.sun);
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
    this.outer = new THREE.Color(pal.neige ? '#dde3e8' : pal.pre[1]).multiplyScalar(pal.neige ? 0.95 : 0.82);
    m.onBeforeCompile = sh => {
      sh.uniforms.uOuter = { value: this.outer };
      sh.uniforms.uSize = { value: new THREE.Vector2(this.W, this.H) };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uOuter;\nuniform vec2 uSize;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          // hors du champ : une herbe sans détail ; au bord, un liseré doré d'environ un pixel et demi
          vec2 m = min(vMapUv, 1.0 - vMapUv) * uSize;
          float e = min(m.x, m.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, uOuter, smoothstep(0.0, 40.0, -e));
          float w = fwidth(e) * 1.5;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.70, 0.36), (1.0 - smoothstep(w * 0.5, w, abs(e))) * 0.8);`);
    };
    return m;
  }
  // ciel, brume (selon la distance de la caméra : le champ reste net, le prolongement s'y perd)
  setup(scene) {
    const sky = new THREE.Color('#cbd8e4');
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 1000, 8000);
    scene.add(this.group);
  }
  update(scene, dist) {
    scene.fog.near = dist * 0.8 + 600;
    scene.fog.far = dist * 3 + 5000;
  }
  // le sol a été repeint (tués, trous d'obus, brèche) : la texture est renvoyée à la carte graphique, une fois par
  // seconde au plus (une image entière à chaque tué coûterait trop)
  dirty() { this.isDirty = true; }
  tick(now) {
    if (this.isDirty && now - (this.upT || 0) > 1000) { this.tex.needsUpdate = true; this.isDirty = false; this.upT = now; }
  }
  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose();
  }
}
