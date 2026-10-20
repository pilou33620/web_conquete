// Vue tactique : effets (fumée des salves, éclairs, boulets et ricochets, mitraille, explosions, éclats de terre,
// poussière des charges, débandade), puis l'atmosphère : ombres des nuages, brume de distance, pluie, neige,
// brouillard, orage, chaleur, et la lumière selon l'heure (matin doré, midi, crépuscule).
// Les effets vivent en mètres (x, y au sol, altitude) et sont rendus dans la scène 3D : les bouffées sont des panneaux
// tournés vers la caméra (une image de bouffée parmi quelques-unes, dans un atlas), triés du plus loin au plus près et
// cachés par le relief ; les éclairs s'ajoutent à la lumière ; boulets, éclats et mitraille sont de petits objets.
// Une salve roule le long du front : chaque file fait feu à son tour (éclair, puis une bouffée de fumée blanche
// épaisse qui grossit, monte et dérive avec le vent). Les troupes (troupes.js) lisent `un._volley` et `un._shots`
// pour mettre les hommes en joue au même instant et faire reculer les pièces.
// Fumée à la manière d'Ultimate General : des bouffées plus grosses et plus durables, qui s'étalent en largeur en
// vieillissant et se fondent en bancs le long des lignes ; chacune est ombrée comme une boule (claire et dorée du côté
// du soleil, plus sombre et bleutée à l'ombre) et s'estompe là où elle touche le sol, au lieu d'y laisser une arête.
import * as THREE from '../../vendor/three/three.module.js';
import { clamp, hash, TAU, canvas, pieces } from './formes.js';
import { smokeless } from './gestes.js';
import { ambiance } from './heures.js';

// fumée en volume : des boules douces qui se recouvrent, éclairées en haut à gauche (lumière du nord-ouest)
function puffSprite(rgb, shade, seed) {
  const s = 128, cv = canvas(s, s), g = cv.getContext('2d');
  const [r, gg, b] = rgb.split(',').map(Number), sh = [r * shade, gg * shade, b * shade];
  for (let k = 0; k < 9; k++) {
    const a = hash(k, 1, seed) * TAU, d = Math.sqrt(hash(k, 2, seed)) * s * 0.2, rr = s * (0.16 + hash(k, 3, seed) * 0.12);
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d * 0.85;
    const gr = g.createRadialGradient(x - rr * 0.35, y - rr * 0.4, rr * 0.1, x, y, rr);
    gr.addColorStop(0, `rgba(${rgb},0.95)`); gr.addColorStop(0.55, `rgba(${(r + sh[0]) / 2 | 0},${(gg + sh[1]) / 2 | 0},${(b + sh[2]) / 2 | 0},0.7)`);
    gr.addColorStop(1, `rgba(${sh[0] | 0},${sh[1] | 0},${sh[2] | 0},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  // fondu des bords : jamais de cercle net
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s / 2);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, s, s);
  return cv;
}
// éclair de bouche : cœur blanc, halo orangé
function flashSprite() {
  const s = 64, cv = canvas(s, s), g = cv.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,252,230,1)'); gr.addColorStop(0.18, 'rgba(255,226,140,0.95)'); gr.addColorStop(0.45, 'rgba(255,150,60,0.45)'); gr.addColorStop(1, 'rgba(255,110,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return cv;
}
function glowSprite(rgb) {
  const s = 64, cv = canvas(s, s), g = cv.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.4, `rgba(${rgb},0.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return cv;
}
export class Effects {
  // q : profil de qualité graphique (qualite.js) : nombre de fumées, richesse des effets (fx, 0 à 3)
  constructor(q) {
    this.q = q;
    this.puffs = [];      // fumées, poussières (x, y en m ; alt en m ; r rayon en m)
    this.flashes = [];    // éclairs de bouche, explosions (additifs)
    this.balls = [];      // boulets en vol
    this.streaks = [];    // mitraille
    this.bits = [];       // éclats de terre (retombent)
    this.queue = [];      // effets différés (étalés entre deux réponses du serveur, salves qui roulent)
    this.decals = [];     // à peindre au sol par la vue (trous, débris)
    this.white = [0, 1, 2, 3].map(k => puffSprite('246,244,238', 0.78, 31 + k));
    this.grey = [0, 1].map(k => puffSprite('132,126,118', 0.7, 51 + k));
    this.canon = [puffSprite('214,210,202', 0.72, 41)];   // fumée de canon : plus grise que celle des fusils (la 12e case de l'atlas)
    this.dust = [0, 1].map(k => puffSprite('184,158,114', 0.75, 71 + k));
    this.haze = [puffSprite('206,214,224', 0.7, 91)];   // poudre sans fumée : un voile bleuté qui se dissipe vite
    this.marks = [[], []];   // marques visibles de chaque camp (rules.VISUALS ; la vue les reçoit avec la carte)
    this.fire = glowSprite('255,190,90');
    this.flash = flashSprite();
    this.shade = glowSprite('0,0,0');
    this.rain = []; this.snow = [];
    this.bolt = null; this.flashT = 0; this.nextBolt = 4;
    this.t = 0;
  }
  setQuality(q) { this.q = q; }
  dispose() {
    this.puffs.length = 0; this.flashes.length = 0; this.bits.length = 0;
    for (const m of this.meshes || []) { m.geometry.dispose(); m.material.dispose(); m.dispose?.(); }
    this.atlas?.dispose();
  }

  // ------------------------------------------------------------------ rendu dans la scène 3D
  // heightAt : altitude du relief (m) ; les images des bouffées et des éclairs vont dans un atlas de 4 × 3 cases
  attach(scene, heightAt) {
    this.heightAt = heightAt;
    const sprites = [...this.white, ...this.grey, ...this.dust, this.fire, this.flash, ...this.haze, ...this.canon], C = 128;
    const at = canvas(4 * C, 3 * C), g = at.getContext('2d');
    this.cell = new Map();
    sprites.forEach((cv, i) => { g.drawImage(cv, (i % 4) * C, ((i / 4) | 0) * C, C, C); this.cell.set(cv, i); });
    this.atlas = new THREE.CanvasTexture(at);
    this.atlas.colorSpace = THREE.SRGBColorSpace; this.atlas.flipY = false;
    this.uni = { uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uTint: { value: new THREE.Color(1, 1, 1) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uShadeCol: { value: new THREE.Color(0.55, 0.6, 0.7) } };
    this.smoke = this.billboards(false, 3400);
    this.glow = this.billboards(true, 400);
    const dark = new THREE.MeshLambertMaterial({ color: '#1b1a18' });
    this.ballMesh = this.instanced(new THREE.SphereGeometry(0.28, 8, 6), dark, 200);
    this.bitMesh = this.instanced(new THREE.BoxGeometry(0.22, 0.18, 0.22), new THREE.MeshLambertMaterial({ color: '#46362a' }), 1200);
    this.streakGeo = new THREE.BufferGeometry();
    this.streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1200 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.streakLines = new THREE.LineSegments(this.streakGeo, new THREE.LineBasicMaterial({ color: '#463e32', transparent: true, opacity: 0.5 }));
    this.streakLines.frustumCulled = false;
    this.meshes = [this.smoke, this.glow, this.ballMesh, this.bitMesh, this.streakLines];
    for (const m of this.meshes) scene.add(m);
  }
  instanced(geo, mat, cap) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
  }
  // panneaux tournés vers la caméra : aP (x, altitude, y, rayon), aC (opacité, case de l'atlas, étalement en largeur,
  // altitude du sol au pied)
  billboards(additive, cap) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, depthWrite: false, fog: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aP; attribute vec4 aC; uniform vec3 uRight, uUp; varying float vAlpha, vY, vGround, vR; varying vec2 vQ;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (vec2(mod(aC.y, 4.0), floor(aC.y / 4.0)) + vec2(uv.x, 1.0 - uv.y)) / vec2(4.0, 3.0);\nvAlpha = aC.x; vQ = position.xy * 2.0;')
        .replace('#include <begin_vertex>', `vec3 transformed = aP.xyz + (uRight * position.x * max(aC.z, 1.0) + uUp * position.y) * aP.w * 2.0;
          vY = transformed.y; vGround = aC.w; vR = aP.w;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uTint, uSunDir, uSunCol, uShadeCol, uRight, uUp; varying float vAlpha, vY, vGround, vR; varying vec2 vQ;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.a *= vAlpha;
          ${additive ? 'diffuseColor.rgb *= uTint;' : `
          // ombrée comme une boule : la normale sur le panneau (vQ de −1 à 1), vers la caméra au centre
          vec3 fwd = normalize(cross(uRight, uUp));   // (vers la caméra)
          vec3 nb = normalize(uRight * vQ.x + uUp * vQ.y + fwd * sqrt(max(0.0, 1.0 - dot(vQ, vQ) * 0.7)));
          float li = clamp(dot(nb, uSunDir) * 0.5 + 0.55, 0.0, 1.0);
          diffuseColor.rgb *= mix(uShadeCol, uSunCol, li) * uTint * 1.15;
          // du volume : le dessous d'une bouffée plus sombre, son sommet plus clair
          diffuseColor.rgb *= mix(0.78, 1.06, smoothstep(-1.0, 0.8, vQ.y));
          // fondue dans le sol : s'efface là où elle le touche
          diffuseColor.a *= smoothstep(-0.2, vR * 0.45, vY - vGround);`}`);
    };
    mat.customProgramCacheKey = () => 'effets-' + additive;
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0; m.frustumCulled = false; m.renderOrder = additive ? 3 : 2;
    return m;
  }
  // à chaque image, avant le rendu : fr, repère de la caméra (camera.js) ; z, zoom (de très près, la fumée
  // s'éclaircit : on voit encore les hommes au travers)
  render(fr, z) {
    if (!this.smoke) return;
    const h = this.heightAt, E = fr.E;
    this.uni.uRight.value.set(fr.R[0], fr.R[1], fr.R[2]);
    this.uni.uUp.value.set(fr.U[0], fr.U[1], fr.U[2]);
    const thin = clamp(1.25 - z / 16, 0.55, 1);
    // opacité selon l'âge : apparaît vite, reste épaisse longtemps, s'efface à la fin
    const fade = p => { const k = p.t / p.life; return p.a * (k < 0.05 ? k / 0.05 : 1 - Math.pow((k - 0.05) / 0.95, p.imgs === this.white ? 1.8 : 0.8)); };
    // fumées, poussières : du plus loin au plus près (le mélange des transparences est alors juste)
    const P = this.puffs, n0 = Math.min(P.length, 3400), tmp = this.tmp = this.tmp?.length >= n0 * 9 ? this.tmp : new Float64Array(n0 * 9 + 900);
    const order = [];
    for (let i = 0, n = 0; i < P.length && n < n0; i++) {
      const p = P[i], a = fade(p) * (p.imgs === this.white ? thin : 1);
      if (a <= 0.01) continue;
      const g = h(p.x, p.y), y = g + p.alt + p.r * 0.7, o = n * 9;
      tmp[o] = (p.x - E[0]) ** 2 + (y - E[1]) ** 2 + (p.y - E[2]) ** 2;
      tmp[o + 1] = p.x; tmp[o + 2] = y; tmp[o + 3] = p.y; tmp[o + 4] = p.r; tmp[o + 5] = a; tmp[o + 6] = this.cell.get(p.img) ?? 0;
      // (la fumée des salves s'étale en largeur en vieillissant : les bouffées se fondent en un banc)
      tmp[o + 7] = p.imgs === this.white ? 1 + 0.6 * Math.min(1, p.t / p.life * 1.6) : 1; tmp[o + 8] = g;
      order.push(n++);
    }
    order.sort((a, b) => tmp[b * 9] - tmp[a * 9]);
    this.fill(this.smoke, order.length, (i, aP, aC) => { const o = order[i] * 9, j = i * 4; aP[j] = tmp[o + 1]; aP[j + 1] = tmp[o + 2]; aP[j + 2] = tmp[o + 3]; aP[j + 3] = tmp[o + 4]; aC[j] = tmp[o + 5]; aC[j + 1] = tmp[o + 6]; aC[j + 2] = tmp[o + 7]; aC[j + 3] = tmp[o + 8]; });
    // éclairs de bouche, feu des explosions
    const F = this.flashes, fc = this.cell.get(this.flash), xc = this.cell.get(this.fire);
    this.fill(this.glow, Math.min(F.length, 400), (i, aP, aC) => {
      const f = F[i], k = 1 - f.t / f.life, j = i * 4;
      aP[j] = f.x; aP[j + 1] = h(f.x, f.y) + f.alt; aP[j + 2] = f.y; aP[j + 3] = Math.max(0.8, f.r) * (0.6 + k * 0.6); aC[j] = k; aC[j + 1] = f.r > 20 ? xc : fc; aC[j + 2] = 1; aC[j + 3] = -1e4;
    });
    // boulets en l'air, éclats de terre
    const m4 = this.m4 || (this.m4 = new THREE.Matrix4());
    const nb = Math.min(this.balls.length, 200);
    for (let i = 0; i < nb; i++) {
      const b = this.balls[i], k = b.t / b.dur, x = b.x0 + (b.x1 - b.x0) * k, y = b.y0 + (b.y1 - b.y0) * k;
      this.ballMesh.setMatrixAt(i, m4.makeTranslation(x, h(x, y) + Math.sin(Math.PI * k) * b.h + 1, y));
    }
    this.ballMesh.count = nb; this.ballMesh.instanceMatrix.needsUpdate = true;
    const nt = Math.min(this.bits.length, 1200);
    for (let i = 0; i < nt; i++) { const b = this.bits[i]; this.bitMesh.setMatrixAt(i, m4.makeTranslation(b.x, h(b.x, b.y) + b.alt, b.y)); }
    this.bitMesh.count = nt; this.bitMesh.instanceMatrix.needsUpdate = true;
    // mitraille : de courts traits qui filent à un mètre du sol
    const ns = Math.min(this.streaks.length, 1200), pa = this.streakGeo.attributes.position;
    for (let i = 0; i < ns; i++) {
      const s = this.streaks[i], k = s.t / s.life, a = Math.max(0, k - 0.12), o = i * 6, A = pa.array;
      const ax = s.x + (s.x1 - s.x) * a, ay = s.y + (s.y1 - s.y) * a, bx = s.x + (s.x1 - s.x) * k, by = s.y + (s.y1 - s.y) * k;
      A[o] = ax; A[o + 1] = h(ax, ay) + 1; A[o + 2] = ay; A[o + 3] = bx; A[o + 4] = h(bx, by) + 1; A[o + 5] = by;
    }
    pa.needsUpdate = true; this.streakGeo.setDrawRange(0, ns * 2);
  }
  fill(mesh, n, set) {
    const aP = mesh.geometry.attributes.aP, aC = mesh.geometry.attributes.aC;
    for (let i = 0; i < n; i++) set(i, aP.array, aC.array);
    mesh.count = n;
    aP.needsUpdate = true; aC.needsUpdate = true;
  }
  // ------------------------------------------------------------------ effets envoyés par le serveur
  // f : {k, x, y, x2, y2, n, u} ; unit : l'unité qui l'a produit (pour le front d'une salve) ; delay en s
  push(f, unit, delay = 0) { this.queue.push({ f, unit, at: this.t + delay }); }
  spawn(f, un) {
    const k = f.k;
    if (k === 'salve') { if (un?.type === 'mitrailleuses') this.crackle(f, un); else this.volley(f, un); }
    else if (k === 'canon' || k === 'mitraille') this.cannon(f, un, k === 'mitraille');
    else if (k === 'impact') {
      // choc d'une charge (moteur, n = hommes qui chargent) ou point de chute (maquette) : poussière, une fois
      if (this.balls.some(b => Math.hypot(b.x1 - f.x, b.y1 - f.y) < 40)) return;
      const sc = un?._figScale ?? 1;
      if (f.n > 20) { for (let q = 0; q < 10; q++) { const a = q / 10 * TAU; this.addPuff(this.dust, f.x + Math.cos(a) * 14 * sc, f.y + Math.sin(a) * 9 * sc, sc, 4 * sc, 3, 0.45, 2.5, Math.cos(a) * 6, Math.sin(a) * 4, 1); } }
      else this.burst(f.x, f.y, 1, sc);
    }
    else if (k === 'explosion') this.explosion(f.x, f.y);
    else if (k === 'charge') { for (let q = 0; q < 6; q++) this.addPuff(this.dust, f.x + (Math.random() - 0.5) * 30, f.y + (Math.random() - 0.5) * 12, 0, 4, 2, 0.35, 3); }
    else if (k === 'deroute') { for (let q = 0; q < 5; q++) this.addPuff(this.dust, f.x + (Math.random() - 0.5) * 40, f.y + (Math.random() - 0.5) * 20, 0.5, 4, 3, 0.3, 3); }
    else if (k === 'fumee') this.addPuff(f.dust ? this.dust : this.white, f.x, f.y, 0, f.dust ? 5 : 6, 2, f.dust ? 0.3 : 0.4, 5);
  }
  // imgs : une famille de sprites (une variante tirée au hasard)
  addPuff(imgs, x, y, alt, r, grow, a, life, vx = 0, vy = 0, valt = 0) {
    // trop de particules : la poussière part d'abord, la fumée des salves reste
    const max = this.q?.puffs ?? 1400;
    if (this.puffs.length >= max) {
      const k = this.puffs.findIndex((p, i) => i < 300 && p.imgs !== this.white);
      this.puffs.splice(k >= 0 ? k : 0, 1);
    }
    this.puffs.push({ imgs, img: imgs[(Math.random() * imgs.length) | 0], x, y, alt, r, grow, a, life, t: 0, vx, vy, valt });
  }
  // salve : elle roule d'un bout à l'autre du front ; chaque file fait feu à son tour, éclair puis fumée
  volley(f, un) {
    let x = f.x, y = f.y, dir = Math.atan2((f.y2 ?? y + 1) - y, (f.x2 ?? x) - x), w = 60;
    if (un) { x = un.x; y = un.y; w = un.form === 'tirailleurs' ? un.w * 0.8 : un.w; dir = un.dir; }
    const c = Math.cos(dir), s = Math.sin(dir), front = (un?.d || 12) / 2 + 1.5;
    // salves rapprochées (vitesse ×2, ×4, feu roulant) : moins de fumée neuve, sinon elle devient une masse opaque
    const since = un ? this.t - (un._volley?.t ?? -99) : 99;
    const roll = Math.random() < 0.5 ? 1 : -1, dur = clamp(w / 150, 0.4, 1.4);
    if (un) un._volley = { t: this.t, roll, dur };
    const fx = this.q?.fx ?? 2;
    let n = Math.max(3, Math.round(clamp(Math.round(w / 3.2), 5, 48) * [0.45, 0.7, 1, 1.25][fx] * (since < 1.5 ? 0.3 : since < 4 ? 0.6 : 1)));
    // déjà un nuage épais devant ce front : on ne l'épaissit plus (sans vent, la fumée finirait en tache opaque)
    const R2 = Math.max(40, w * 0.6) ** 2;
    let near = 0;
    for (const p of this.puffs) if (p.imgs === this.white && (p.x - x) ** 2 + (p.y - y) ** 2 < R2) near++;
    if (near > n * 6) n = Math.min(n, 3);
    // (sc : échelle des figurines du régiment, troupes.js : de loin, elles grossissent, et leur fumée avec elles)
    const life = [22, 36, 48, 60][fx], sk = un?.form === 'tirailleurs', sc = un?._figScale ?? 1;
    const clean = !!un && smokeless(un, this.marks);
    for (let q = 0; q < n; q++) {
      const u = ((q + 0.2 + Math.random() * 0.6) / n - 0.5) * w;
      const at = sk ? Math.random() * 1.6 : (roll > 0 ? u / w + 0.5 : 0.5 - u / w) * dur + Math.random() * 0.05;
      const fwd = front + Math.random() * 2, px = x + c * fwd - s * u, py = y + s * fwd + c * u;
      this.queue.push({ fn: () => {
        this.flashes.push({ x: px + c * 1.2, y: py + s * 1.2, alt: 1.6 * sc, r: (2.2 + Math.random()) * sc, t: 0, life: 0.09 + Math.random() * 0.05 });
        const sp = 4 + Math.random() * 4;
        if (clean) {   // poudre B : l'éclair seul, et un voile à peine visible, un homme sur trois
          if (q % 3 === 0) this.addPuff(this.haze, px + c * 1.5, py + s * 1.5, 1.5 * sc, 2.5 * sc, 1.6, 0.14, 3 + Math.random() * 2, c * sp, s * sp, 0.1);
          return;
        }
        this.addPuff(this.white, px + c * 1.5, py + s * 1.5, 1.5 * sc, (5 + Math.random() * 3) * sc, 1.5 + Math.random() * 0.9, 0.78 + Math.random() * 0.17, life * (0.7 + Math.random() * 0.5), c * sp + (Math.random() - 0.5) * 2, s * sp + (Math.random() - 0.5) * 2, 0.08 + Math.random() * 0.12);
      }, at: this.t + at });
    }
  }
  // mitrailleuse : chaque pièce crache sa gerbe en crépitant (une rafale de petits éclairs à la bouche) ; un filet de
  // fumée, presque rien sans fumée. Les servants suivent (_shots : la manivelle tourne)
  crackle(f, un) {
    const p = pieces(un), w = un.w || 40, fc = Math.cos(un.dir), fs = Math.sin(un.dir), sc = un._figScale ?? 1;
    const clean = smokeless(un, this.marks), front = (un.d || 30) / 2 - 3;
    un._shots = un._shots || {};
    for (let q = 0; q < p; q++) {
      const u = p > 1 ? (q - (p - 1) / 2) * (w / p) : 0, px = un.x + fc * front - fs * u, py = un.y + fs * front + fc * u;
      const t0 = q * 0.1 + Math.random() * 0.1;
      this.queue.push({ fn: () => { un._shots[q] = this.t; }, at: this.t + t0 });
      for (let k = 0; k < 10; k++) this.queue.push({ fn: () => {
        this.flashes.push({ x: px + fc * 1.6, y: py + fs * 1.6, alt: sc, r: (1.2 + Math.random() * 0.6) * sc, t: 0, life: 0.05 });
        if (k % 3 === 0) this.addPuff(clean ? this.haze : this.white, px + fc * 2, py + fs * 2, sc, (clean ? 1.5 : 2.2) * sc, 1.4, clean ? 0.1 : 0.35, clean ? 2 : 8, fc * 6, fs * 6, 0.15);
      }, at: this.t + t0 + k * 0.14 });
    }
  }
  cannon(f, un, grape) {
    const dx = (f.x2 ?? f.x + 1) - f.x, dy = (f.y2 ?? f.y) - f.y, d = Math.hypot(dx, dy) || 1, c = dx / d, s = dy / d;
    // une bouche à feu par pièce, réparties sur le front de la batterie comme dans sa disposition (troupes.js) ; sans
    // la batterie, n (la maquette y met le nombre de pièces ; le serveur, les pertes infligées)
    const p = un ? pieces(un) : clamp(f.n || 1, 1, 8), fx = this.q?.fx ?? 2;
    const w = un ? un.w : 60, ux = un ? un.x : f.x, uy = un ? un.y : f.y;
    const fc = un ? Math.cos(un.dir) : c, fs = un ? Math.sin(un.dir) : s;
    const sc = un?._figScale ?? 1;   // (échelle des figurines de la batterie : sa fumée la suit)
    const clean = !!un && smokeless(un, this.marks);
    if (un) un._shots = un._shots || {};
    for (let q = 0; q < p; q++) {
      const u = p > 1 ? (q - (p - 1) / 2) * (w / p) : 0;
      const px = ux + fc * ((un?.d || 30) / 2 - 3) - fs * u, py = uy + fs * ((un?.d || 30) / 2 - 3) + fc * u;
      const at = q * 0.18 + Math.random() * 0.12;
      this.queue.push({ fn: () => {
        if (un) un._shots[q] = this.t;
        this.flashes.push({ x: px + fc * 3.5, y: py + fs * 3.5, alt: sc, r: (grape ? 7 : 6) * sc, t: 0, life: 0.2 });
        // la bouffée : poussée en avant, épaisse, qui s'élargit ; la poussière du souffle au ras du sol
        if (clean) this.addPuff(this.haze, px + fc * 5, py + fs * 5, 1.5 * sc, 4 * sc, 1.8, 0.18, 4 + Math.random() * 2, fc * 10, fs * 10, 0.2);
        // (une bouffée sur deux, grise, monte plus haut : la fumée de canon s'élève au-dessus de celle des fusils)
        else for (let k = 0; k < 4 + fx; k++) this.addPuff(k % 2 ? this.canon : this.white, px + fc * (4 + k * 4), py + fs * (4 + k * 4), (1.8 + k * 0.5) * sc, (4.5 + k * 1.5) * sc, 1.8, 0.78, [26, 40, 52, 64][fx] * (0.7 + Math.random() * 0.4), fc * (16 - k * 3) + (Math.random() - 0.5) * 3, fs * (16 - k * 3) + (Math.random() - 0.5) * 3, k % 2 ? 0.7 : 0.25);
        if (fx >= 1) for (let k = 0; k < 4; k++) { const a = Math.random() * TAU; this.addPuff(this.dust, px + Math.cos(a) * 2, py + Math.sin(a) * 2, 0.3 * sc, 2.5 * sc, 2.5, 0.35, 2.5, Math.cos(a) * 5 + fc * 3, Math.sin(a) * 5 + fs * 3, 0.4); }
        if (grape) {
          for (let k = 0; k < 14; k++) {
            const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.28, L = d * (0.75 + Math.random() * 0.35);
            this.streaks.push({ x: px, y: py, x1: px + Math.cos(a) * L, y1: py + Math.sin(a) * L, t: 0, life: 0.28 });
          }
          for (let k = 0; k < 5; k++) this.queue.push({ fn: () => this.burst(f.x2 + (Math.random() - 0.5) * 40, f.y2 + (Math.random() - 0.5) * 25, 0.5, sc), at: this.t + 0.25 });
        } else {
          const tx = (f.x2 ?? f.x) + (Math.random() - 0.5) * 30, ty = (f.y2 ?? f.y) + (Math.random() - 0.5) * 20;
          const dd = Math.hypot(tx - px, ty - py);
          this.balls.push({ x0: px, y0: py, x1: tx, y1: ty, t: 0, dur: clamp(dd / 900, 0.35, 1.6), h: dd * 0.04, bounce: 2, sc });
        }
      }, at: this.t + at });
    }
  }
  // point de chute : gerbe de terre (éclats qui retombent), poussière, trou
  burst(x, y, k = 1, sc = 1) {
    for (let q = 0; q < 2 * k + 2; q++) this.addPuff(this.dust, x + (Math.random() - 0.5) * 10 * sc, y + (Math.random() - 0.5) * 6 * sc, sc, (2.5 + Math.random() * 2.5) * sc, 3, 0.55, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, 3);
    const nb = [2, 4, 6, 8][this.q?.fx ?? 2] * k;
    for (let q = 0; q < nb; q++) { const a = Math.random() * TAU, v = (2 + Math.random() * 6) * sc; this.bits.push({ x, y, alt: 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, valt: (4 + Math.random() * 6) * Math.sqrt(sc), t: 0, life: 2 }); }
    // (le trou reste : à sa taille vraie, pas à l'échelle des figurines du moment)
    if (Math.random() < 0.6) this.decals.push({ k: 'trou', x, y, r: 1.4 + Math.random() * 1.2 * k, a: Math.random() * 3 });
  }
  explosion(x, y) {
    this.flashes.push({ x, y, alt: 2, r: 26, t: 0, life: 0.5 });
    for (let q = 0; q < 10; q++) this.addPuff([this.fire], x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 6, 2, 3 + Math.random() * 3, 3, 0.9, 0.8 + Math.random() * 0.6, 0, 0, 6);
    for (let q = 0; q < 14; q++) this.addPuff(this.grey, x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 8, 3, 4 + Math.random() * 4, 2.6, 0.8, 9 + Math.random() * 6, 0, 0, 2.5 + Math.random() * 2);
    for (let q = 0; q < 16; q++) { const a = Math.random() * TAU, L = 15 + Math.random() * 35; this.streaks.push({ x, y, x1: x + Math.cos(a) * L, y1: y + Math.sin(a) * L, t: 0, life: 0.45, dark: true }); }
    for (let q = 0; q < 24; q++) { const a = Math.random() * TAU, v = 6 + Math.random() * 14; this.bits.push({ x, y, alt: 1, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, valt: 8 + Math.random() * 14, t: 0, life: 3 }); }
    this.decals.push({ k: 'trou', x, y, r: 6, a: 0 });
  }
  // poussière sous les sabots d'une charge, fumée d'un village en feu…
  trail(x, y, dir, w, sc = 1) {
    if (Math.random() > [0.25, 0.4, 0.55, 0.7][this.q?.fx ?? 2]) return;
    const c = Math.cos(dir), s = Math.sin(dir), u = (Math.random() - 0.5) * w;
    this.addPuff(this.dust, x - c * 8 * sc - s * u, y - s * 8 * sc + c * u, 0.5 * sc, (2 + Math.random() * 2) * sc, 2.5, 0.4, 2 + Math.random() * 1.5, -c * 2, -s * 2, 0.5);
  }

  // ------------------------------------------------------------------ animation
  update(dt, wind) {
    this.t += dt;
    let wx = clamp(wind?.[0] ?? 1.5, -12, 12), wy = clamp(wind?.[1] ?? 0.5, -12, 12);
    // toujours une petite brise : la fumée finit par s'en aller
    const wl = Math.hypot(wx, wy);
    if (wl < 1.2) { const a = wl > 0.01 ? Math.atan2(wy, wx) : 0.4; wx = Math.cos(a) * 1.2; wy = Math.sin(a) * 1.2; }
    for (let q = this.queue.length - 1; q >= 0; q--) {
      const e = this.queue[q];
      if (e.at > this.t) continue;
      this.queue.splice(q, 1);
      if (e.fn) e.fn(); else this.spawn(e.f, e.unit);
    }
    const P = this.puffs, drag = Math.exp(-dt * 1.6);
    let n = 0;
    for (const p of P) {
      p.t += dt;
      if (p.t >= p.life) continue;
      p.vx *= drag; p.vy *= drag;
      // le vent emporte la fumée, d'autant plus qu'elle est montée
      const lift = 1.6 + Math.min(1.2, p.alt * 0.08);
      p.x += (p.vx + wx * lift) * dt; p.y += (p.vy + wy * lift) * dt; p.alt += p.valt * dt;
      p.r += p.grow * dt * (1 - p.t / p.life * 0.6);
      P[n++] = p;
    }
    P.length = n;
    this.flashes = this.flashes.filter(f => (f.t += dt) < f.life);
    this.streaks = this.streaks.filter(f => (f.t += dt) < f.life);
    let m = 0;
    for (const b of this.bits) {
      b.t += dt; b.valt -= 9.8 * dt; b.alt += b.valt * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.alt > 0 && b.t < b.life) this.bits[m++] = b;
    }
    this.bits.length = m;
    const still = [];
    for (const b of this.balls) {
      b.t += dt;
      if (b.t < b.dur) { still.push(b); continue; }
      this.burst(b.x1, b.y1, 0.8, b.sc);
      if (b.bounce > 0) {   // ricochet : repart plus bas, plus court
        const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
        still.push({ x0: b.x1, y0: b.y1, x1: b.x1 + dx * 0.22, y1: b.y1 + dy * 0.22, t: 0, dur: b.dur * 0.35, h: b.h * 0.18, bounce: b.bounce - 1, sc: b.sc });
      }
    }
    this.balls = still;
  }
  // ------------------------------------------------------------------ atmosphère
  // Lumière et ciel de la scène 3D pour l'état du ciel st ({weather, light, hour, wind}) et la saison, d'après la
  // table des heures (heures.js), avec l'éclair d'orage en cours
  ciel(st, season) {
    return ambiance(st, season, { flash: Math.max(0, this.flashT), clouds: this.q?.clouds !== false });
  }
  // st : {weather, light, hour (nombre), wind} ; view : caméra ; dt en s
  atmosphere(ctx, view, st, dt, time) {
    const vw = view.vw, vh = view.vh, w = st.weather || 'soleil';
    const wind = st.wind || [1.5, 0.5];
    const wet = w === 'pluie' || w === 'orage' || w === 'tempete';
    const L = clamp(st.light ?? 1, 0, 1), h = st.hour ?? 12;
    // (brouillard, brume de distance et lumière de l'heure : dans la scène 3D, voir ciel)
    const k = clamp((1 - L) / 0.8, 0, 1);
    // les bords de l'image un peu plus sombres ; davantage quand la nuit tombe (avec l'après-rendu, c'est lui qui
    // assombrit les bords, selon la table des heures)
    const vk = (this.q?.fx ?? 2) >= 3 ? 0.16 : 0;
    if (!view.post && (vk || k > 0.05)) {
      const vig = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.62);
      vig.addColorStop(0, 'rgba(12,18,40,0)'); vig.addColorStop(1, `rgba(12,18,40,${Math.max(vk, 0.55 * k)})`);
      ctx.fillStyle = vig; ctx.fillRect(0, 0, vw, vh);
    }
    // pluie
    if (wet) {
      const n = Math.round((w === 'pluie' ? 240 : 380) * [0.5, 0.75, 1, 1.3][this.q?.fx ?? 2]), ang = clamp(wind[0] * 0.05, -0.5, 0.5);
      while (this.rain.length < n) this.rain.push({ x: Math.random() * vw, y: Math.random() * vh, l: 10 + Math.random() * 14, v: 900 + Math.random() * 500 });
      this.rain.length = n;
      ctx.strokeStyle = 'rgba(210,225,240,0.38)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const r of this.rain) {
        r.y += r.v * dt; r.x += r.v * ang * dt;
        if (r.y > vh) { r.y = -r.l; r.x = Math.random() * vw; }
        if (r.x > vw) r.x -= vw; else if (r.x < 0) r.x += vw;
        ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - r.l * ang, r.y - r.l);
      }
      ctx.stroke();
    }
    // neige
    if (w === 'neige') {
      const n = Math.round(320 * [0.5, 0.75, 1, 1.3][this.q?.fx ?? 2]);
      while (this.snow.length < n) this.snow.push({ x: Math.random() * vw, y: Math.random() * vh, r: 0.8 + Math.random() * 2, v: 25 + Math.random() * 45, ph: Math.random() * 6 });
      this.snow.length = n;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (const f of this.snow) {
        f.y += f.v * dt; f.x += (Math.sin(time * 1.3 + f.ph) * 14 + wind[0] * 6) * dt;
        if (f.y > vh) { f.y = -4; f.x = Math.random() * vw; }
        if (f.x > vw) f.x -= vw; else if (f.x < 0) f.x += vw;
        ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(235,240,248,0.08)'; ctx.fillRect(0, 0, vw, vh);
    }
    // orage : éclairs
    if (w === 'orage' || w === 'tempete') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 9;
        this.flashT = 0.5;
        const pts = [[Math.random() * vw, -10]];
        for (let q = 0; q < 9; q++) { const p = pts[pts.length - 1]; pts.push([p[0] + (Math.random() - 0.5) * 90, p[1] + vh * 0.06 + Math.random() * vh * 0.05]); }
        this.bolt = pts;
      }
      if (this.flashT > 0) {
        this.flashT -= dt;
        const kk = this.flashT / 0.5, flick = kk > 0.6 || (kk > 0.25 && kk < 0.4) ? 1 : 0.3;
        ctx.fillStyle = `rgba(235,240,255,${0.45 * kk * flick})`; ctx.fillRect(0, 0, vw, vh);
        if (this.bolt && kk > 0.5) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.2; ctx.beginPath();
          this.bolt.forEach(([x, y], q) => q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
        }
      }
    }
    // canicule : air qui tremble au loin (voile clair en haut de l'écran)
    if (w === 'canicule') {
      const gr = ctx.createLinearGradient(0, 0, 0, vh * 0.5);
      gr.addColorStop(0, 'rgba(255,240,210,0.28)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, vw, vh * 0.5);
    }
  }
}
