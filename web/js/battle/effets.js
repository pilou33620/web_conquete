// Vue tactique : effets (fumée des salves, éclairs, boulets et ricochets, mitraille, explosions, éclats de terre,
// poussière des charges, débandade), puis l'atmosphère : ombres des nuages, brume de distance, pluie, neige,
// brouillard, orage, chaleur, et la lumière selon l'heure (matin doré, midi, crépuscule).
// Les effets vivent en mètres (x, y au sol, altitude) et sont rendus dans la scène 3D : les bouffées sont des panneaux
// tournés vers la caméra (une image de bouffée parmi quelques-unes, dans un atlas), triés du plus loin au plus près et
// cachés par le relief ; les éclairs s'ajoutent à la lumière ; boulets, éclats et mitraille sont de petits objets.
// Une salve roule le long du front : chaque file fait feu à son tour (éclair, puis une bouffée de fumée blanche
// épaisse qui grossit, monte et dérive avec le vent). Les troupes (troupes.js) lisent `un._volley` et `un._shots`
// pour mettre les hommes en joue au même instant et faire reculer les pièces.
import * as THREE from '../../vendor/three/three.module.js';
import { clamp, hash, TAU, canvas } from './formes.js';

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
    this.dust = [0, 1].map(k => puffSprite('184,158,114', 0.75, 71 + k));
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
    const sprites = [...this.white, ...this.grey, ...this.dust, this.fire, this.flash], C = 128;
    const at = canvas(4 * C, 3 * C), g = at.getContext('2d');
    this.cell = new Map();
    sprites.forEach((cv, i) => { g.drawImage(cv, (i % 4) * C, ((i / 4) | 0) * C, C, C); this.cell.set(cv, i); });
    this.atlas = new THREE.CanvasTexture(at);
    this.atlas.colorSpace = THREE.SRGBColorSpace; this.atlas.flipY = false;
    this.uni = { uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uTint: { value: new THREE.Color(1, 1, 1) } };
    this.smoke = this.billboards(false, 2600);
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
  // panneaux tournés vers la caméra : aP (x, altitude, y, rayon), aC (opacité, case de l'atlas)
  billboards(additive, cap) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, depthWrite: false, fog: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aP; attribute vec2 aC; uniform vec3 uRight, uUp; varying float vAlpha;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (vec2(mod(aC.y, 4.0), floor(aC.y / 4.0)) + vec2(uv.x, 1.0 - uv.y)) / vec2(4.0, 3.0);\nvAlpha = aC.x;')
        .replace('#include <begin_vertex>', 'vec3 transformed = aP.xyz + (uRight * position.x + uUp * position.y) * aP.w * 2.0;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTint; varying float vAlpha;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vAlpha;\ndiffuseColor.rgb *= uTint;');
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
    const P = this.puffs, n0 = Math.min(P.length, 2600), tmp = this.tmp = this.tmp?.length >= n0 * 7 ? this.tmp : new Float64Array(n0 * 7 + 700);
    const order = [];
    for (let i = 0, n = 0; i < P.length && n < n0; i++) {
      const p = P[i], a = fade(p) * (p.imgs === this.white ? thin : 1);
      if (a <= 0.01) continue;
      const y = h(p.x, p.y) + p.alt + p.r * 0.7, o = n * 7;
      tmp[o] = (p.x - E[0]) ** 2 + (y - E[1]) ** 2 + (p.y - E[2]) ** 2;
      tmp[o + 1] = p.x; tmp[o + 2] = y; tmp[o + 3] = p.y; tmp[o + 4] = p.r; tmp[o + 5] = a; tmp[o + 6] = this.cell.get(p.img) ?? 0;
      order.push(n++);
    }
    order.sort((a, b) => tmp[b * 7] - tmp[a * 7]);
    this.fill(this.smoke, order.length, (i, aP, aC) => { const o = order[i] * 7, j = i * 4; aP[j] = tmp[o + 1]; aP[j + 1] = tmp[o + 2]; aP[j + 2] = tmp[o + 3]; aP[j + 3] = tmp[o + 4]; aC[i * 2] = tmp[o + 5]; aC[i * 2 + 1] = tmp[o + 6]; });
    // éclairs de bouche, feu des explosions
    const F = this.flashes, fc = this.cell.get(this.flash), xc = this.cell.get(this.fire);
    this.fill(this.glow, Math.min(F.length, 400), (i, aP, aC) => {
      const f = F[i], k = 1 - f.t / f.life, j = i * 4;
      aP[j] = f.x; aP[j + 1] = h(f.x, f.y) + f.alt; aP[j + 2] = f.y; aP[j + 3] = Math.max(0.8, f.r) * (0.6 + k * 0.6); aC[i * 2] = k; aC[i * 2 + 1] = f.r > 20 ? xc : fc;
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
    if (k === 'salve') this.volley(f, un);
    else if (k === 'canon' || k === 'mitraille') this.cannon(f, un, k === 'mitraille');
    else if (k === 'impact') {
      // choc d'une charge (moteur, n = hommes qui chargent) ou point de chute (maquette) : poussière, une fois
      if (this.balls.some(b => Math.hypot(b.x1 - f.x, b.y1 - f.y) < 40)) return;
      if (f.n > 20) { for (let q = 0; q < 10; q++) { const a = q / 10 * TAU; this.addPuff(this.dust, f.x + Math.cos(a) * 14, f.y + Math.sin(a) * 9, 1, 4, 3, 0.45, 2.5, Math.cos(a) * 6, Math.sin(a) * 4, 1); } }
      else this.burst(f.x, f.y, 1);
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
    if (near > n * 4) n = Math.min(n, 3);
    const life = [16, 26, 34, 44][fx], sk = un?.form === 'tirailleurs';
    for (let q = 0; q < n; q++) {
      const u = ((q + 0.2 + Math.random() * 0.6) / n - 0.5) * w;
      const at = sk ? Math.random() * 1.6 : (roll > 0 ? u / w + 0.5 : 0.5 - u / w) * dur + Math.random() * 0.05;
      const fwd = front + Math.random() * 2, px = x + c * fwd - s * u, py = y + s * fwd + c * u;
      this.queue.push({ fn: () => {
        this.flashes.push({ x: px + c * 1.2, y: py + s * 1.2, alt: 1.6, r: 2.2 + Math.random(), t: 0, life: 0.09 + Math.random() * 0.05 });
        const sp = 4 + Math.random() * 4;
        this.addPuff(this.white, px + c * 1.5, py + s * 1.5, 1.5, 4 + Math.random() * 2.5, 1.2 + Math.random() * 0.8, 0.72 + Math.random() * 0.2, life * (0.7 + Math.random() * 0.5), c * sp + (Math.random() - 0.5) * 2, s * sp + (Math.random() - 0.5) * 2, 0.08 + Math.random() * 0.12);
      }, at: this.t + at });
    }
  }
  cannon(f, un, grape) {
    const dx = (f.x2 ?? f.x + 1) - f.x, dy = (f.y2 ?? f.y) - f.y, d = Math.hypot(dx, dy) || 1, c = dx / d, s = dy / d;
    // une bouche à feu par pièce, réparties sur le front de la batterie
    const p = clamp(f.n || 1, 1, 8), fx = this.q?.fx ?? 2;
    const w = un ? un.w : 60, ux = un ? un.x : f.x, uy = un ? un.y : f.y;
    const fc = un ? Math.cos(un.dir) : c, fs = un ? Math.sin(un.dir) : s;
    if (un) un._shots = un._shots || {};
    for (let q = 0; q < p; q++) {
      const u = p > 1 ? (q - (p - 1) / 2) * (w / p) : 0;
      const px = ux + fc * ((un?.d || 30) / 2 - 3) - fs * u, py = uy + fs * ((un?.d || 30) / 2 - 3) + fc * u;
      const at = q * 0.18 + Math.random() * 0.12;
      this.queue.push({ fn: () => {
        if (un) un._shots[q] = this.t;
        this.flashes.push({ x: px + fc * 3.5, y: py + fs * 3.5, alt: 1, r: grape ? 7 : 6, t: 0, life: 0.2 });
        // la bouffée : poussée en avant, épaisse, qui s'élargit ; la poussière du souffle au ras du sol
        for (let k = 0; k < 3 + fx; k++) this.addPuff(this.white, px + fc * (4 + k * 4), py + fs * (4 + k * 4), 1.5 + k * 0.3, 3.5 + k * 1.2, 1.4, 0.7, [18, 28, 36, 46][fx] * (0.7 + Math.random() * 0.4), fc * (16 - k * 3) + (Math.random() - 0.5) * 3, fs * (16 - k * 3) + (Math.random() - 0.5) * 3, 0.25);
        if (fx >= 1) for (let k = 0; k < 4; k++) { const a = Math.random() * TAU; this.addPuff(this.dust, px + Math.cos(a) * 2, py + Math.sin(a) * 2, 0.3, 2.5, 2.5, 0.35, 2.5, Math.cos(a) * 5 + fc * 3, Math.sin(a) * 5 + fs * 3, 0.4); }
        if (grape) {
          for (let k = 0; k < 14; k++) {
            const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.28, L = d * (0.75 + Math.random() * 0.35);
            this.streaks.push({ x: px, y: py, x1: px + Math.cos(a) * L, y1: py + Math.sin(a) * L, t: 0, life: 0.28 });
          }
          for (let k = 0; k < 5; k++) this.queue.push({ fn: () => this.burst(f.x2 + (Math.random() - 0.5) * 40, f.y2 + (Math.random() - 0.5) * 25, 0.5), at: this.t + 0.25 });
        } else {
          const tx = (f.x2 ?? f.x) + (Math.random() - 0.5) * 30, ty = (f.y2 ?? f.y) + (Math.random() - 0.5) * 20;
          const dd = Math.hypot(tx - px, ty - py);
          this.balls.push({ x0: px, y0: py, x1: tx, y1: ty, t: 0, dur: clamp(dd / 900, 0.35, 1.6), h: dd * 0.04, bounce: 2 });
        }
      }, at: this.t + at });
    }
  }
  // point de chute : gerbe de terre (éclats qui retombent), poussière, trou
  burst(x, y, k = 1) {
    for (let q = 0; q < 2 * k + 2; q++) this.addPuff(this.dust, x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 6, 1, 2.5 + Math.random() * 2.5, 3, 0.55, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, 3);
    const nb = [2, 4, 6, 8][this.q?.fx ?? 2] * k;
    for (let q = 0; q < nb; q++) { const a = Math.random() * TAU, v = 2 + Math.random() * 6; this.bits.push({ x, y, alt: 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, valt: 4 + Math.random() * 6, t: 0, life: 2 }); }
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
  trail(x, y, dir, w) {
    if (Math.random() > [0.25, 0.4, 0.55, 0.7][this.q?.fx ?? 2]) return;
    const c = Math.cos(dir), s = Math.sin(dir), u = (Math.random() - 0.5) * w;
    this.addPuff(this.dust, x - c * 8 - s * u, y - s * 8 + c * u, 0.5, 2 + Math.random() * 2, 2.5, 0.4, 2 + Math.random() * 1.5, -c * 2, -s * 2, 0.5);
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
      this.burst(b.x1, b.y1, 0.8);
      if (b.bounce > 0) {   // ricochet : repart plus bas, plus court
        const dx = b.x1 - b.x0, dy = b.y1 - b.y0;
        still.push({ x0: b.x1, y0: b.y1, x1: b.x1 + dx * 0.22, y1: b.y1 + dy * 0.22, t: 0, dur: b.dur * 0.35, h: b.h * 0.18, bounce: b.bounce - 1 });
      }
    }
    this.balls = still;
  }
  // ------------------------------------------------------------------ atmosphère (en coordonnées d'écran)
  // Couleur de la lumière (multipliée) : matin doré, midi neutre, couchant doré puis rose, nuit bleue (par brouillard :
  // grise) ; null à midi par beau temps
  tint(st) {
    const w = st.weather || 'soleil', L = clamp(st.light ?? 1, 0, 1), h = st.hour ?? 12, k = clamp((1 - L) / 0.8, 0, 1);
    let tint = null;
    if (L < 0.97) {
      tint = k < 0.35 ? mix3([255, 255, 255], [255, 216, 164], k / 0.35)
        : k < 0.65 ? mix3([255, 216, 164], [240, 172, 146], (k - 0.35) / 0.3)
        : mix3([240, 172, 146], [74, 84, 142], (k - 0.65) / 0.35);
    } else if (h < 9.8 && w !== 'brouillard') tint = mix3([255, 228, 188], [255, 255, 255], clamp((h - 8) / 1.8, 0, 1));
    else if (w === 'canicule') tint = [255, 232, 196];
    if (tint && w === 'brouillard') tint = mix3(tint, [235, 238, 242], 0.6);
    return tint;
  }
  // Lumière et ciel de la scène 3D pour l'état du ciel st ({weather, light, hour, wind}) et la saison : direction et
  // couleur du soleil (à l'est le matin, au sud à midi, bas à l'ouest le soir ; plus haut l'été), lumière du ciel,
  // couleur et portée de la brume, force des ombres des nuages, teinte de la fumée.
  ciel(st, season) {
    const w = st.weather || 'soleil', L = clamp(st.light ?? 1, 0, 1), h = st.hour ?? 12;
    const emax = ({ ete: 62, printemps: 47, automne: 40, hiver: 26 }[season] ?? 45) * Math.PI / 180;
    const el = Math.max(0.06, emax * Math.sin(Math.PI * clamp((h - 6) / 14, 0, 1))), az = (90 + (h - 6) * 15) * Math.PI / 180;
    const t = (this.tint(st) || [255, 255, 255]).map(v => v / 255);
    const wet = w === 'pluie' || w === 'orage' || w === 'tempete';
    const dull = wet || w === 'brouillard' || w === 'nuages' || w === 'neige';
    const sky = { soleil: [201, 216, 230], canicule: [218, 222, 226], nuages: [185, 195, 205], pluie: [155, 165, 176], orage: [138, 147, 160], tempete: [138, 147, 160], brouillard: [211, 215, 219], neige: [208, 214, 222] }[w] || [201, 216, 230];
    const night = [38, 48, 78], k = 1 - L;
    const fog = mix3(mix3(sky, sky.map((c, i) => c * t[i]), 0.7), night, k * 0.85).map(v => v / 255);
    return {
      sunDir: [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)], sun: t,
      // le ciel éclaire fort, bleuté : les ombres restent lisibles et teintées au lieu de noires
      sunI: ({ soleil: 2.2, canicule: 2.5, nuages: 1.3, neige: 1.05 }[w] ?? 0.7) * (0.25 + 0.75 * L),
      hemiSky: mix3([0.8, 0.88, 1], t, 0.4), hemiGround: [0.42, 0.38, 0.26], hemiI: (dull ? 2.35 : 2.05) * (0.35 + 0.65 * L) + this.flashT * 3,
      fog, fogNear: w === 'brouillard' ? 0.05 : wet ? 0.6 : 1, fogFar: w === 'brouillard' ? 0.15 : wet ? 0.6 : 1,
      cloudA: ({ soleil: 0.22, canicule: 0.14, nuages: 0.34, pluie: 0.3, orage: 0.38, tempete: 0.38 }[w] || 0) * L * (this.q?.clouds !== false ? 1 : 0),
      wind: st.wind || [1.5, 0.5],
      smoke: mix3([1, 1, 1], t, 0.6).map(v => v * (0.45 + 0.55 * L)),
    };
  }
  // st : {weather, light, hour (nombre), wind} ; view : caméra ; dt en s
  atmosphere(ctx, view, st, dt, time) {
    const vw = view.vw, vh = view.vh, w = st.weather || 'soleil';
    const wind = st.wind || [1.5, 0.5];
    const wet = w === 'pluie' || w === 'orage' || w === 'tempete';
    const L = clamp(st.light ?? 1, 0, 1), h = st.hour ?? 12;
    // (brouillard, brume de distance et lumière de l'heure : dans la scène 3D, voir ciel)
    const k = clamp((1 - L) / 0.8, 0, 1);
    // les bords de l'image un peu plus sombres ; davantage quand la nuit tombe
    const vk = (this.q?.fx ?? 2) >= 3 ? 0.16 : 0;
    if (vk || k > 0.05) {
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
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
