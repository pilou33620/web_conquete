// Vue tactique : effets (fumée des salves, éclairs, boulets et ricochets, mitraille, explosions, poussière des
// charges, débandade), puis l'atmosphère : ombres des nuages, pluie, neige, brouillard, orage, chaleur, et la
// lumière selon l'heure (matin doré, midi, crépuscule). Tout est dessiné en coordonnées d'écran à partir de
// positions du monde (mètres) ; les fumées ont aussi une altitude qui les fait monter à l'écran.
import { clamp, hash, TAU, TILT } from './formes.js';

const MAX_PUFFS = 1400;
function puffSprite(rgb, soft = 0.5) {
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(soft, `rgba(${rgb},0.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return cv;
}
// texture de brume : bruit doux qui se répète
function fogTexture() {
  const s = 256, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  for (let k = 0; k < 70; k++) {
    const x = hash(k, 1, 77) * s, y = hash(k, 2, 77) * s, r = 30 + hash(k, 3, 77) * 70, a = 0.05 + hash(k, 4, 77) * 0.12;
    for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, `rgba(235,238,240,${a})`); gr.addColorStop(1, 'rgba(235,238,240,0)');
      g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
  return cv;
}

export class Effects {
  constructor() {
    this.puffs = [];      // fumées, poussières (x, y en m ; alt en m ; r rayon en m)
    this.flashes = [];    // éclairs de bouche, explosions (additifs)
    this.balls = [];      // boulets en vol
    this.streaks = [];    // mitraille
    this.queue = [];      // effets différés (étalés entre deux réponses du serveur)
    this.decals = [];     // à peindre au sol par la vue (trous, débris)
    this.white = puffSprite('246,244,238', 0.45);
    this.grey = puffSprite('120,116,110', 0.4);
    this.dust = puffSprite('176,150,108', 0.35);
    this.fire = puffSprite('255,190,90', 0.25);
    this.fog = null;
    this.rain = []; this.snow = [];
    this.bolt = null; this.flashT = 0; this.nextBolt = 4;
    this.t = 0;
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
  addPuff(img, x, y, alt, r, grow, a, life, vx = 0, vy = 0, valt = 0) {
    // trop de particules : la poussière part d'abord, la fumée des salves reste
    if (this.puffs.length >= MAX_PUFFS) {
      const k = this.puffs.findIndex((p, i) => i < 300 && p.img !== this.white);
      this.puffs.splice(k >= 0 ? k : 0, 1);
    }
    this.puffs.push({ img, x, y, alt, r, grow, a, life, t: 0, vx, vy, valt, seed: Math.random() });
  }
  // salve : un ruban de fumée le long du front, des éclairs de bouche
  volley(f, un) {
    let x = f.x, y = f.y, dir = Math.atan2((f.y2 ?? y + 1) - y, (f.x2 ?? x) - x), w = 60;
    if (un) { x = un.x; y = un.y; w = un.form === 'tirailleurs' ? un.w * 0.8 : un.w; dir = un.dir; }
    const c = Math.cos(dir), s = Math.sin(dir), front = (un?.d || 12) / 2 + 2;
    // salves rapprochées (vitesse ×2, ×4, feu roulant) : moins de fumée neuve, sinon elle devient une masse opaque
    const since = un ? this.t - (un._lastVolley ?? -99) : 99;
    if (un) un._lastVolley = this.t;
    let n = Math.max(3, Math.round(clamp(Math.round(w / 3.5), 5, 44) * (since < 1.5 ? 0.25 : since < 4 ? 0.5 : 1)));
    // déjà un nuage épais devant ce front : on ne l'épaissit plus (sans vent, la fumée finirait en tache opaque)
    const R2 = Math.max(40, w * 0.6) ** 2;
    let near = 0;
    for (const p of this.puffs) if (p.img === this.white && (p.x - x) ** 2 + (p.y - y) ** 2 < R2) near++;
    if (near > n * 2.5) n = Math.min(n, 2);
    for (let q = 0; q < n; q++) {
      const u = (q + Math.random() * 0.8) / n * w - w / 2, fwd = front + Math.random() * 6;
      const px = x + c * fwd - s * u, py = y + s * fwd + c * u;
      const sp = 3 + Math.random() * 3;
      this.addPuff(this.white, px, py, 3, 5 + Math.random() * 7, 1.6 + Math.random() * 2, 0.35 + Math.random() * 0.2, 11 + Math.random() * 8, c * sp * 1.6 + (Math.random() - 0.5) * 3, s * sp * 1.6 + (Math.random() - 0.5) * 3, 0.1 + Math.random() * 0.2);
      if (Math.random() < 0.7) this.flashes.push({ x: px + c * 3, y: py + s * 3, alt: 4, r: 4 + Math.random() * 2, t: 0, life: 0.12 + Math.random() * 0.08 });
    }
  }
  cannon(f, un, grape) {
    const dx = (f.x2 ?? f.x + 1) - f.x, dy = (f.y2 ?? f.y) - f.y, d = Math.hypot(dx, dy) || 1, c = dx / d, s = dy / d;
    // une bouche à feu par pièce, réparties sur le front de la batterie
    const p = clamp(f.n || 1, 1, 8);
    const w = un ? un.w : 60, ux = un ? un.x : f.x, uy = un ? un.y : f.y;
    const fc = un ? Math.cos(un.dir) : c, fs = un ? Math.sin(un.dir) : s;
    for (let q = 0; q < p; q++) {
      const u = p > 1 ? (q - (p - 1) / 2) * (w / p) : 0;
      const px = ux + fc * ((un?.d || 30) / 2 - 3) - fs * u, py = uy + fs * ((un?.d || 30) / 2 - 3) + fc * u;
      const at = q * 0.07 + Math.random() * 0.05;
      this.queue.push({ fn: () => {
        this.flashes.push({ x: px + fc * 3, y: py + fs * 3, alt: 1, r: grape ? 5 : 4, t: 0, life: 0.18 });
        for (let k = 0; k < 3; k++) this.addPuff(this.white, px + fc * (5 + k * 6), py + fs * (5 + k * 6), 3, 5 + k * 1.5, 1.5, 0.5, 12 + Math.random() * 8, fc * (10 - k * 2), fs * (10 - k * 2), 0.2);
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
  burst(x, y, k = 1) {
    for (let q = 0; q < 2 * k + 2; q++) this.addPuff(this.dust, x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 6, 1, 3 + Math.random() * 3, 3.5, 0.75, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, 3);
    if (Math.random() < 0.6) this.decals.push({ k: 'trou', x, y, r: 1.4 + Math.random() * 1.2 * k, a: Math.random() * 3 });
  }
  explosion(x, y) {
    this.flashes.push({ x, y, alt: 2, r: 26, t: 0, life: 0.5 });
    for (let q = 0; q < 10; q++) this.addPuff(this.fire, x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 6, 2, 3 + Math.random() * 3, 3, 0.9, 0.8 + Math.random() * 0.6, 0, 0, 6);
    for (let q = 0; q < 14; q++) this.addPuff(this.grey, x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 8, 3, 4 + Math.random() * 4, 2.6, 0.8, 9 + Math.random() * 6, 0, 0, 2.5 + Math.random() * 2);
    for (let q = 0; q < 16; q++) { const a = Math.random() * TAU, L = 15 + Math.random() * 35; this.streaks.push({ x, y, x1: x + Math.cos(a) * L, y1: y + Math.sin(a) * L, t: 0, life: 0.45, dark: true }); }
    this.decals.push({ k: 'trou', x, y, r: 6, a: 0 });
  }
  // poussière sous les sabots d'une charge, fumée d'un village en feu…
  trail(x, y, dir, w) {
    if (Math.random() > 0.5) return;
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
    const P = this.puffs;
    let n = 0;
    for (const p of P) {
      p.t += dt;
      if (p.t >= p.life) continue;
      const drag = Math.exp(-dt * 1.6);
      p.vx *= drag; p.vy *= drag;
      p.x += (p.vx + wx * 2.2) * dt; p.y += (p.vy + wy * 2.2) * dt; p.alt += p.valt * dt;   // le vent emporte la fumée
      p.r += p.grow * dt * (1 - p.t / p.life * 0.6);
      P[n++] = p;
    }
    P.length = n;
    this.flashes = this.flashes.filter(f => (f.t += dt) < f.life);
    this.streaks = this.streaks.filter(f => (f.t += dt) < f.life);
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
  // fumées et éclairs (au-dessus des unités)
  draw(ctx, view) {
    const z = view.z;
    for (const p of this.puffs) {
      const k = p.t / p.life, a = p.a * (k < 0.06 ? k / 0.06 : 1 - Math.pow((k - 0.06) / 0.94, 0.8));
      if (a <= 0.01) continue;
      const [sx, sy] = view.toScreen(p.x, p.y), r = p.r * z;
      if (sx < -r * 2 || sy < -r * 2 || sx > view.vw + r * 2 || sy > view.vh + r * 2) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(p.img, sx - r, sy - r * TILT - p.alt * z, r * 2, r * 2 * TILT);
    }
    ctx.globalAlpha = 1;
    // boulets : ombre au sol et boulet en l'air
    for (const b of this.balls) {
      const k = b.t / b.dur, x = b.x0 + (b.x1 - b.x0) * k, y = b.y0 + (b.y1 - b.y0) * k, alt = Math.sin(Math.PI * k) * b.h + 1;
      const [sx, sy] = view.toScreen(x, y), r = Math.max(1.4, 0.6 * z);
      ctx.fillStyle = 'rgba(20,16,10,0.35)'; ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1b1a18'; ctx.beginPath(); ctx.arc(sx, sy - alt * z, r, 0, TAU); ctx.fill();
    }
    ctx.lineCap = 'round';
    for (const s of this.streaks) {
      const k = s.t / s.life, [ax, ay] = view.toScreen(s.x + (s.x1 - s.x) * Math.max(0, k - 0.12), s.y + (s.y1 - s.y) * Math.max(0, k - 0.12)), [bx, by] = view.toScreen(s.x + (s.x1 - s.x) * k, s.y + (s.y1 - s.y) * k);
      ctx.strokeStyle = s.dark ? 'rgba(50,40,30,0.7)' : 'rgba(70,62,50,0.32)'; ctx.lineWidth = s.dark ? 1.6 : 0.8;
      ctx.beginPath(); ctx.moveTo(ax, ay - z); ctx.lineTo(bx, by - z); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const k = 1 - f.t / f.life, [sx, sy] = view.toScreen(f.x, f.y), r = Math.max(2.5, f.r * z) * (0.6 + k * 0.6);
      ctx.globalAlpha = k;
      ctx.drawImage(this.fire, sx - r, sy - r - f.alt * z, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ atmosphère (en coordonnées d'écran)
  // st : {weather, light, hour (nombre), wind} ; view : caméra ; dt en s
  atmosphere(ctx, view, st, dt, time) {
    const vw = view.vw, vh = view.vh, w = st.weather || 'soleil';
    const wind = st.wind || [1.5, 0.5];
    const wet = w === 'pluie' || w === 'orage' || w === 'tempete';
    // ombres des nuages qui passent (ancrées au sol)
    const nClouds = w === 'soleil' || w === 'canicule' ? 3 : w === 'brouillard' || w === 'neige' ? 0 : 7;
    if (nClouds) {
      ctx.globalAlpha = wet ? 0.22 : 0.16;
      for (let k = 0; k < nClouds; k++) {
        const R = 280 + hash(k, 1, 5) * 320;
        const x = ((hash(k, 2, 5) * 4200 + time * (4 + wind[0] * 3)) % 4600) - 800, y = ((hash(k, 3, 5) * 3000 + time * wind[1] * 2) % 3200) - 600;
        const [sx, sy] = view.toScreen(x, y), r = R * view.z;
        if (sx + r < 0 || sx - r > vw || sy + r < 0 || sy - r > vh) continue;
        ctx.drawImage(this.grey, sx - r, sy - r * 0.6, r * 2, r * 1.2);
      }
      ctx.globalAlpha = 1;
    }
    // brouillard, brume du matin
    const mist = w === 'brouillard' ? 1 : (st.hour < 9.5 && (w === 'soleil' || w === 'nuages')) ? 0.2 * clamp((9.5 - st.hour) / 1.5, 0, 1) : w === 'pluie' || w === 'neige' ? 0.25 : 0;
    if (mist > 0) {
      this.fog = this.fog || fogTexture();
      ctx.fillStyle = `rgba(226,230,234,${0.38 * mist})`; ctx.fillRect(0, 0, vw, vh);
      const pat = ctx.createPattern(this.fog, 'repeat');
      for (let layer = 0; layer < 2; layer++) {
        const sc = (layer ? 3.2 : 2.2) * clamp(view.z, 0.4, 2), ox = (time * (6 + layer * 4) * (wind[0] >= 0 ? 1 : -1)) % (256 * sc), oy = layer * 90;
        const [cx, cy] = view.toScreen(0, 0);
        pat.setTransform(new DOMMatrix().translateSelf(cx * (layer ? 0.6 : 0.8) + ox, cy * 0.7 + oy).scaleSelf(sc, sc * 0.6));
        ctx.globalAlpha = (layer ? 0.75 : 0.95) * mist;
        ctx.fillStyle = pat; ctx.fillRect(0, 0, vw, vh);
      }
      ctx.globalAlpha = 1;
    }
    // lumière : matin doré, midi neutre, couchant doré puis rose, nuit bleue (sauf par brouillard : gris)
    const L = clamp(st.light ?? 1, 0, 1), h = st.hour ?? 12;
    let tint = null;
    const k = clamp((1 - L) / 0.8, 0, 1);
    if (L < 0.97) {
      tint = k < 0.35 ? mix3([255, 255, 255], [255, 214, 158], k / 0.35)
        : k < 0.65 ? mix3([255, 214, 158], [236, 156, 132], (k - 0.35) / 0.3)
        : mix3([236, 156, 132], [74, 84, 142], (k - 0.65) / 0.35);
    } else if (h < 9.8 && w !== 'brouillard') tint = mix3([255, 232, 196], [255, 255, 255], clamp((h - 8) / 1.8, 0, 1));
    else if (w === 'canicule') tint = [255, 232, 196];
    if (tint && w === 'brouillard') tint = mix3(tint, [235, 238, 242], 0.6);
    if (tint) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0})`; ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (L < 0.95) {
      // lueur du couchant à l'ouest, puis ombre qui gagne les bords
      const glow = ctx.createLinearGradient(0, 0, vw * 0.8, vh * 0.3);
      glow.addColorStop(0, `rgba(255,170,90,${0.28 * Math.sin(Math.PI * Math.min(1, k * 1.2))})`); glow.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, vw, vh);
      const vig = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.62);
      vig.addColorStop(0, 'rgba(12,18,40,0)'); vig.addColorStop(1, `rgba(12,18,40,${0.55 * k})`);
      ctx.fillStyle = vig; ctx.fillRect(0, 0, vw, vh);
    }
    if (wet) { ctx.fillStyle = 'rgba(30,40,58,0.16)'; ctx.fillRect(0, 0, vw, vh); }
    // pluie
    if (wet) {
      const n = w === 'pluie' ? 240 : 380, ang = clamp(wind[0] * 0.05, -0.5, 0.5);
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
      const n = 320;
      while (this.snow.length < n) this.snow.push({ x: Math.random() * vw, y: Math.random() * vh, r: 0.8 + Math.random() * 2, v: 25 + Math.random() * 45, ph: Math.random() * 6 });
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
        for (let k = 0; k < 9; k++) { const p = pts[pts.length - 1]; pts.push([p[0] + (Math.random() - 0.5) * 90, p[1] + vh * 0.06 + Math.random() * vh * 0.05]); }
        this.bolt = pts;
      }
      if (this.flashT > 0) {
        this.flashT -= dt;
        const k = this.flashT / 0.5, flick = k > 0.6 || (k > 0.25 && k < 0.4) ? 1 : 0.3;
        ctx.fillStyle = `rgba(235,240,255,${0.45 * k * flick})`; ctx.fillRect(0, 0, vw, vh);
        if (this.bolt && k > 0.5) {
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
