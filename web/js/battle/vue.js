// Vue tactique : le canevas plein écran de la bataille. Caméra en vue cavalière, boucle d'animation, interrogation
// du serveur (/api/tactic toutes les 120 ms) avec interpolation des positions, dessin du terrain, des unités,
// des effets et de l'atmosphère. Les commandes (commandes.js) et l'interface (interface.js) s'y branchent.
import { Terrain } from './terrain.js';
import { UnitArt } from './unites.js';
import { Effects } from './effets.js';
import { Controls } from './commandes.js';
import { BattleUI } from './interface.js';
import { emprise, clsOf, isGeneral, clamp, wrapAngle, hash, TAU, TILT } from './formes.js';

const POLL_MS = 120;
const MAX_Z = 6;

export class BattleView {
  // api : {get(url), post(url, body)} ; root : élément qui recevra la vue
  constructor(api, root) {
    this.api = api;
    this.root = root;
    root.innerHTML = '';
    this.cv = document.createElement('canvas');
    this.cv.className = 'bt-canvas';
    root.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.art = new UnitArt();
    this.fx = new Effects();
    this.units = new Map();
    this.sel = new Set();
    this.orders = new Map();     // derniers ordres donnés (affichés jusqu'à l'arrivée)
    this.st = null;
    this.seq = 0;
    this.cam = { x: 1500, y: 1000, z: 0.5 };
    this.camAnim = null;
    this.figScale = 3;           // les silhouettes sont grandies (×3) pour rester lisibles, comme les arbres
    this.showCover = false;
    this.running = false;
    this.frameMs = [];
    this.lastFrame = performance.now();
    this.pollGap = POLL_MS;
    this.onExit = null;          // rappelée au retour à la carte de campagne
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.controls = new Controls(this);
    this.ui = new BattleUI(this);
  }

  // ------------------------------------------------------------------ ouverture et fermeture
  async load(bid) {
    this.bid = bid;
    const m = await this.api.get(`/api/tactic_map?bid=${encodeURIComponent(bid)}`);
    if (!m || (!m.t && !m.W)) throw new Error('Carte de bataille indisponible');
    this.map = m;
    this.terrain = new Terrain(m);
    this.W = this.terrain.W; this.H = this.terrain.H;
    this.cam = { x: this.W / 2, y: this.H / 2, z: this.fitZ() };
    return m;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.poll();
    // une erreur dans une image ne doit pas arrêter l'animation
    const loop = t => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      try { this.frame(t); } catch (e) { if (!this.errShown) { this.errShown = true; console.error(e); } }
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.pollT);
  }
  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.ui.dispose();
    this.terrain?.dispose();
    this.art.clear();
    this.root.innerHTML = '';
  }

  // ------------------------------------------------------------------ serveur
  async poll() {
    if (!this.running) return;
    const t0 = performance.now();
    let st = null;
    try { st = await this.api.get(`/api/tactic?bid=${encodeURIComponent(this.bid)}&since=${this.seq}`); } catch (e) { st = null; }
    if (!this.running) return;
    if (st && st.units) {
      try { this.apply(st); } catch (e) { console.error(e); }
      this.lost = false;
    } else if (!this.lost) { this.lost = true; this.ui.toast('Liaison avec le serveur perdue…', 'bad'); }
    // en pause ou en fin de bataille, on interroge moins souvent
    const wait = st && st.phase === 'fin' ? 1500 : st && st.speed === 0 && st.phase !== 'deploiement' ? 400 : POLL_MS;
    this.pollT = setTimeout(() => this.poll(), Math.max(10, wait - (performance.now() - t0)));
  }
  async cmd(sub, body = {}) {
    let r;
    try { r = await this.api.post('/api/cmd', { cmd: 'tac', sub, bid: this.bid, ...body }); } catch (e) { r = { ok: false, msg: 'Serveur injoignable.' }; }
    if (r && !r.ok && r.msg) this.ui.toast(r.msg, 'bad');
    return r || { ok: false };
  }
  apply(st) {
    const now = performance.now();
    if (this.lastSnap) this.pollGap = this.pollGap * 0.7 + clamp(now - this.lastSnap, 60, 600) * 0.3;
    this.lastSnap = now;
    const prev = this.st;
    this.st = st;
    this.seq = st.seq ?? this.seq;
    this.me = st.me ?? 0;
    this.colors = (st.sides || []).map((s, i) => s.color || (i ? '#3f6fb5' : '#b8352a'));
    const seen = new Set();
    for (const s of st.units) {
      const id = String(s.id);
      seen.add(id);
      let u = this.units.get(id);
      const [w0, d0] = emprise(s);
      const w = s.w || w0, d = s.d || d0;
      if (!u) {
        u = { ...s, id, w, d, from: { x: s.x, y: s.y, dir: s.dir || 0 }, to: { x: s.x, y: s.y, dir: s.dir || 0 }, t0: now, dir: s.dir || 0 };
        this.units.set(id, u);
      } else {
        if (u.men > s.men && s.men >= 0 && this.terrain) this.casualties(u, u.men - s.men);
        const cur = { x: u.x, y: u.y, dir: u.dir };
        // pendant le déploiement, une unité qu'on vient de poser localement garde sa place jusqu'à confirmation
        const pin = u._pin && now - u._pin < 1500;
        Object.assign(u, s, { id, w, d });
        if (pin) { u.x = cur.x; u.y = cur.y; u.dir = cur.dir; continue; }
        u.from = cur;
        u.to = { x: s.x, y: s.y, dir: s.dir ?? cur.dir };
        u.t0 = now;
        if (Math.hypot(u.to.x - cur.x, u.to.y - cur.y) > 400) u.from = { ...u.to };   // saut (téléportation) : pas de glissade
        u.x = cur.x; u.y = cur.y; u.dir = cur.dir;
      }
      u.lastSeen = now; u._ghost = false;
      if (s.side === this.me) { const o = this.orders.get(id); if (o && o.kind === 'move' && Math.hypot(s.x - o.x, s.y - o.y) < 12) this.orders.delete(id); }
    }
    // ennemis qu'on ne voit plus : on garde leur dernière position connue un moment (« devinés »)
    for (const [id, u] of this.units) {
      if (seen.has(id)) continue;
      if (u.side === this.me || u.state === 'hors') { this.units.delete(id); this.sel.delete(id); continue; }
      if (!u._ghost) { u._ghost = true; u.ghostT = now; u.to = { x: u.x, y: u.y, dir: u.dir }; u.from = u.to; }
      if (now - u.ghostT > 60000) this.units.delete(id);
    }
    for (const id of [...this.sel]) { const u = this.units.get(id); if (!u || u.state === 'hors' || u.side !== this.me) this.sel.delete(id); }
    // effets depuis la dernière réponse, étalés sur l'intervalle selon leur instant
    const fxs = st.fx || [];
    if (fxs.length) {
      // (première réponse : on suppose un pas du serveur, 2 s de bataille ; l'échelle de temps n'intervient pas ici)
      const tA = prev?.clock ?? (st.clock ?? 0) - 2, tB = st.clock ?? tA + 2, span = Math.max(0.001, tB - tA);
      const gap = this.pollGap / 1000;
      for (const f of fxs.slice(prev ? -150 : -30)) {
        const k = f.t != null ? clamp((f.t - tA) / span, 0, 1) : Math.random();
        this.fx.push(f, f.u != null ? this.units.get(String(f.u)) : this.nearest(f.x, f.y), k * gap);
      }
    }
    if (this.fx.decals.length) { this.terrain.addDecals(this.fx.decals.splice(0)); }
    this.ui.update(st, prev);
  }
  // tués laissés au sol, dans l'emprise de l'unité
  casualties(u, n) {
    const c = Math.cos(u.dir), s = Math.sin(u.dir), col = this.colors[u.side] || '#666', cav = clsOf(u) === 'cavalerie';
    const k = Math.min(14, Math.ceil(n / 5)), out = [];
    for (let q = 0; q < k; q++) {
      const uu = (Math.random() - 0.5) * u.w, vv = (Math.random() - 0.5) * u.d - (u.state === 'marche' ? 4 : 0);
      out.push({ k: cav && q % 2 ? 'cheval' : 'mort', x: u.x + c * vv - s * uu, y: u.y + s * vv + c * uu, a: Math.random() * TAU, c: col });
    }
    this.terrain.addDecals(out);
  }
  nearest(x, y) {
    let best = null, bd = 40;
    for (const u of this.units.values()) { const d = Math.hypot(u.x - x, u.y - y); if (d < bd) { bd = d; best = u; } }
    return best;
  }

  // ------------------------------------------------------------------ caméra
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const r = this.root.getBoundingClientRect();
    this.vw = r.width > 10 ? r.width : window.innerWidth; this.vh = r.height > 10 ? r.height : window.innerHeight;
    this.cv.width = Math.round(this.vw * dpr); this.cv.height = Math.round(this.vh * dpr);
    if (this.terrain) this.clampCam();
  }
  fitZ() { return Math.min(this.vw / (this.W || 3000), this.vh / ((this.H || 2000) * TILT)) * 0.98; }
  minZ() { return this.fitZ() * 0.85; }
  toScreen = (x, y) => [(x - this.cam.x) * this.cam.z + this.vw / 2, (y - this.cam.y) * this.cam.z * TILT + this.vh / 2];
  toWorld(sx, sy) { return [(sx - this.vw / 2) / this.cam.z + this.cam.x, (sy - this.vh / 2) / (this.cam.z * TILT) + this.cam.y]; }
  // la caméra peut dépasser un peu les bords : de quoi voir ce qui est sous la barre du haut, le bandeau du
  // déploiement et la barre des unités
  clampCam() {
    const c = this.cam;
    c.z = clamp(c.z, this.minZ(), MAX_Z);
    const mx = this.vw / 2 / c.z, my = this.vh / 2 / (c.z * TILT);
    const top = (this.st?.phase === 'deploiement' ? 230 : 110) / (c.z * TILT), bottom = 150 / (c.z * TILT), side = 70 / c.z;
    c.x = mx * 2 >= this.W + side * 2 ? this.W / 2 : clamp(c.x, mx - side, this.W - mx + side);
    c.y = my * 2 >= this.H + top + bottom ? this.H / 2 + (bottom - top) / 2 : clamp(c.y, my - top, this.H - my + bottom);
  }
  moveCam(x, y, z, dur = 600) {
    // la cible est ramenée dans les bornes dès le départ : pas de saut à l'arrivée
    const from = { ...this.cam };
    this.cam = { x, y, z: clamp(z ?? from.z, this.minZ(), MAX_Z) };
    this.clampCam();
    const to = this.cam;
    this.cam = from;
    this.camAnim = { from, to, t0: performance.now(), dur };
  }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z = clamp(this.cam.z * f, this.minZ(), MAX_Z);
    this.cam.x = wx - (sx - this.vw / 2) / this.cam.z;
    this.cam.y = wy - (sy - this.vh / 2) / (this.cam.z * TILT);
    this.camAnim = null;
    this.clampCam();
  }
  // centre la caméra sur la zone de déploiement (ou sur ses troupes)
  // cadre ses propres troupes, le regard tourné vers l'ennemi (ou, sans ennemi en vue, vers le centre du champ)
  focusMine(dur = 900) {
    const mine = [...this.units.values()].filter(u => u.side === this.me && !u._ghost && u.state !== 'hors');
    if (!mine.length) { const z = this.st?.zone; if (z) this.moveCam((z[0] + z[2]) / 2, (z[1] + z[3]) / 2, 0.8, dur); return; }
    const x0 = Math.min(...mine.map(u => u.x)), x1 = Math.max(...mine.map(u => u.x));
    const y0 = Math.min(...mine.map(u => u.y)), y1 = Math.max(...mine.map(u => u.y));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const foe = [...this.units.values()].filter(u => u.side !== this.me && u.state !== 'hors');
    const tx = foe.length ? foe.reduce((a, u) => a + u.x, 0) / foe.length : this.W / 2;
    const ty = foe.length ? foe.reduce((a, u) => a + u.y, 0) / foe.length : this.H / 2;
    // assez près pour distinguer les régiments, toutes ses troupes dans le cadre
    const zz = clamp(Math.min(this.vw / (x1 - x0 + 500), (this.vh - 240) / ((y1 - y0 + 400) * TILT)), 0.6, 1.3);
    const sw = this.vw / zz, sh = this.vh / (zz * TILT);
    const d = Math.hypot(tx - cx, ty - cy) || 1;
    // les troupes restent dans le cadre : le décalage vers l'ennemi est borné par la place libre
    const fx = Math.max(0, sw / 2 - (x1 - x0) / 2 - 120), fy = Math.max(0, sh / 2 - (y1 - y0) / 2 - 160);
    const x = cx + clamp((tx - cx) / d * sw * 0.3, -fx, fx), y = cy + clamp((ty - cy) / d * sh * 0.3, -fy, fy);
    this.moveCam(x, y - (this.st?.phase === 'deploiement' ? 70 : 0) / (zz * TILT), zz, dur);
  }

  // ------------------------------------------------------------------ boucle
  frame(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const t0 = performance.now();
    // taille de l'écran changée sans événement (rotation de l'iPad, barre d'adresse) : on s'adapte
    if (Math.abs(this.root.clientWidth - this.vw) > 1 || Math.abs(this.root.clientHeight - this.vh) > 1) this.resize();
    if (this.camAnim) {
      const a = this.camAnim, k = Math.min(1, (now - a.t0) / a.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const lz = Math.log(a.from.z) + (Math.log(a.to.z) - Math.log(a.from.z)) * e;
      this.cam = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, z: Math.exp(lz) };
      if (k >= 1) { this.camAnim = null; this.clampCam(); }
    }
    this.controls.tick(dt);
    // interpolation entre deux réponses du serveur
    const span = Math.max(80, this.pollGap * 1.05);
    for (const u of this.units.values()) {
      if (!u.to) continue;
      const k = clamp((now - u.t0) / span, 0, 1);
      u.x = u.from.x + (u.to.x - u.from.x) * k;
      u.y = u.from.y + (u.to.y - u.from.y) * k;
      u.dir = u.from.dir + wrapAngle(u.to.dir - u.from.dir) * k;
      u._fade = u._ghost ? clamp(1 - (now - u.ghostT) / 60000, 0.25, 1) : 1;
      // poussière sous les sabots, seulement si la charge avance vraiment
      if (u.state === 'charge' && clsOf(u) === 'cavalerie' && !u._ghost && Math.hypot(u.to.x - u.from.x, u.to.y - u.from.y) > 2) this.fx.trail(u.x, u.y, u.dir, u.w);
    }
    const speed = this.st?.speed ?? 1;
    this.fx.update(speed === 0 ? dt * 0.15 : dt * Math.min(1.6, 0.8 + speed * 0.2), this.st?.wind);
    this.draw(dt, now / 1000);
    this.ui.frame(now);
    const ms = performance.now() - t0;
    this.frameMs.push(ms);
    // une image rapide, sans geste en cours : on avance la peinture des tuiles voisines
    if (ms < 7 && !this.controls.busy() && !this.camAnim && (this.idleN = (this.idleN || 0) + 1) % 3 === 0) this.terrain?.prefetch(); if (this.frameMs.length > 120) this.frameMs.shift();
  }

  draw(dt, time) {
    const ctx = this.ctx, dpr = this.dpr, cam = this.cam, z = cam.z;
    if (!this.terrain) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c1828';
    ctx.fillRect(0, 0, this.vw, this.vh);
    // monde : x → (x − cx)·z + vw/2 ; y → (y − cy)·z·TILT + vh/2
    const world = () => ctx.setTransform(dpr * z, 0, 0, dpr * z * TILT, dpr * (this.vw / 2 - cam.x * z), dpr * (this.vh / 2 - cam.y * z * TILT));
    world();
    // mesure facultative, poste par poste (this.prof = {} pour l'activer)
    let tm = performance.now();
    const mark = k => { if (!this.prof) return; const n = performance.now(); this.prof[k] = (this.prof[k] || 0) + n - tm; tm = n; };
    const pinching = this.controls.busy();
    this.terrain.draw(ctx, cam, this.vw, this.vh / TILT, dpr, pinching ? 0 : this.ui.entering ? 3 : 1);
    // cadre du champ de bataille
    ctx.strokeStyle = 'rgba(200,162,83,0.65)'; ctx.lineWidth = 2 / z; ctx.strokeRect(0, 0, this.W, this.H);
    mark('terrain');
    this.drawGround(ctx, z, time);
    mark('sol');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = { toScreen: this.toScreen, z, figScale: this.figScale, vw: this.vw, vh: this.vh, dpr };
    const vis = [...this.units.values()].filter(u => u.state !== 'hors' && this.onScreen(u));
    this.art.draw(ctx, view, vis, time, this.colors || []);
    mark('unites');
    this.fx.draw(ctx, view);
    mark('effets');
    const hour = this.hourNum();
    this.fx.atmosphere(ctx, view, { weather: this.st?.weather || this.map?.weather, light: this.st?.light ?? 1, hour, wind: this.st?.wind }, dt, time);
    mark('atmosphere');
    this.drawLabels(ctx);
    this.bannerRects = this.art.banners(ctx, view, vis, this.colors || [], { sel: this.sel, me: this.me, time });
    this.controls.drawOverlay(ctx, view, time);
    mark('fanions');
  }
  onScreen(u) {
    const [sx, sy] = this.toScreen(u.x, u.y), m = Math.max(u.w, u.d) * this.cam.z + 80;
    return sx > -m && sy > -m && sx < this.vw + m && sy < this.vh + m;
  }
  hourNum() {
    const c = this.st?.clock;
    if (c != null) return 8 + c / 3600;
    const m = /(\d+)\s*h\s*(\d*)/.exec(this.st?.hour || '');
    return m ? +m[1] + (+m[2] || 0) / 60 : 12;
  }
  // au sol (dans le repère du monde) : zone de déploiement, couverts, portées, empreintes, ordres en cours
  drawGround(ctx, z, time) {
    const st = this.st;
    const deploy = st?.phase === 'deploiement';
    if ((deploy && this.showCover !== false) || this.showCover === true) {
      ctx.save();
      ctx.globalAlpha = 0.42 + Math.sin(time * 2.2) * 0.1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.terrain.coverImg, 0, 0, this.W, this.H);
      ctx.restore();
    }
    if (deploy && st.zone) {
      const [x0, y0, x1, y1] = st.zone;
      ctx.fillStyle = 'rgba(230,201,127,0.12)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([14 / z, 9 / z]); ctx.lineDashOffset = -time * 20 / z;
      ctx.strokeStyle = 'rgba(255,226,150,0.95)'; ctx.lineWidth = 2.4 / z; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
    const art = this.art;
    const proj = { toScreen: (x, y) => [x, y] };   // déjà dans le repère du monde
    // portées de l'unité sélectionnée (efficace et maximale), dans son champ de tir
    if (this.sel.size === 1) {
      const u = this.units.get([...this.sel][0]);
      if (u && u.range && u.range[0] > 0 && clsOf(u) !== 'general') {
        const arc = Math.PI / 3;
        ctx.lineWidth = 1.6 / z;
        for (const [r, a] of [[u.range[1], 0.35], [u.range[0], 0.7], [u.range[2], 0.6]]) {
          if (!r) continue;
          ctx.strokeStyle = r === u.range[2] ? `rgba(240,120,90,${a})` : `rgba(255,236,170,${a})`;
          ctx.setLineDash(r === u.range[1] ? [8 / z, 6 / z] : []);
          ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.arc(u.x, u.y, r, u.dir - arc, u.dir + arc); ctx.closePath(); ctx.stroke();
          if (r === u.range[0]) { ctx.fillStyle = 'rgba(255,236,170,0.08)'; ctx.fill(); }
        }
        ctx.setLineDash([]);
      }
    }
    // ordres en cours de mes unités : trajet pointillé et emplacement d'arrivée
    for (const u of this.units.values()) {
      if (u.side !== this.me || u._ghost || u.state === 'hors') continue;
      const o = this.orders.get(u.id) || (u.order && typeof u.order === 'object' && u.order.kind === 'move' ? u.order : null);
      const selected = this.sel.has(u.id);
      const path = Array.isArray(u.path) && u.path.length ? u.path : null;
      if (o && o.kind === 'move' && o.x != null && Math.hypot(o.x - u.x, o.y - u.y) > 10) {
        ctx.strokeStyle = selected ? 'rgba(255,230,160,0.9)' : 'rgba(255,230,160,0.45)'; ctx.lineWidth = (selected ? 2.2 : 1.4) / z;
        ctx.setLineDash([6 / z, 6 / z]);
        ctx.beginPath(); ctx.moveTo(u.x, u.y);
        if (path) for (const p of path) ctx.lineTo(p[0], p[1]); else ctx.lineTo(o.x, o.y);
        ctx.stroke(); ctx.setLineDash([]);
        art.footprint(ctx, proj, o.x, o.y, o.dir ?? Math.atan2(o.y - u.y, o.x - u.x), u.w, u.d, 1);
        ctx.stroke();
      }
      const tgt = o && (o.kind === 'attack' || o.kind === 'charge') ? this.units.get(String(o.target)) : u.target != null && selected ? this.units.get(String(u.target)) : null;
      if (tgt) {
        ctx.strokeStyle = o?.kind === 'charge' ? 'rgba(255,120,90,0.9)' : 'rgba(255,170,120,0.7)'; ctx.lineWidth = 2 / z;
        ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
      }
      if (selected) {
        ctx.fillStyle = 'rgba(255,226,150,0.16)'; ctx.strokeStyle = 'rgba(255,226,150,0.95)'; ctx.lineWidth = 2 / z;
        art.footprint(ctx, proj, u.x, u.y, u.dir, u.w, u.d, 4); ctx.fill(); ctx.stroke();
        // l'avant : une flèche
        const c = Math.cos(u.dir), s = Math.sin(u.dir), f = u.d / 2 + 8;
        ctx.fillStyle = 'rgba(255,226,150,0.95)';
        ctx.beginPath(); ctx.moveTo(u.x + c * (f + 9), u.y + s * (f + 9)); ctx.lineTo(u.x + c * f - s * 6, u.y + s * f + c * 6); ctx.lineTo(u.x + c * f + s * 6, u.y + s * f - c * 6); ctx.closePath(); ctx.fill();
      }
    }
    // objectif d'un assaut : le cœur de la place (tenu hold_need secondes sans défenseur pour l'emporter)
    const obj = st?.objective || (this.map?.heart && this.map?.place ? this.map.heart : null);
    if (obj) {
      const r = 26, k = clamp((st?.hold || 0) / (st?.hold_need || 60), 0, 1);
      ctx.lineWidth = 3 / z; ctx.strokeStyle = 'rgba(255,226,150,0.85)'; ctx.setLineDash([7 / z, 5 / z]);
      ctx.beginPath(); ctx.arc(obj[0], obj[1], r + Math.sin(time * 2) * 2, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      if (k > 0) { ctx.strokeStyle = 'rgba(255,120,90,0.95)'; ctx.lineWidth = 5 / z; ctx.beginPath(); ctx.arc(obj[0], obj[1], r, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke(); }
    }
    // cible survolée ou désignée
    const hov = this.controls.hover && this.units.get(this.controls.hover);
    if (hov && hov.side !== this.me) {
      ctx.strokeStyle = 'rgba(255,110,90,0.95)'; ctx.lineWidth = 2.2 / z;
      art.footprint(ctx, proj, hov.x, hov.y, hov.dir, hov.w, hov.d, 6); ctx.stroke();
    }
  }
  // cotes des sommets et nom de la place, à la manière des cartes d'état-major
  drawLabels(ctx) {
    const t = this.terrain;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (this.cam.z > 0.35) for (const p of t.peaks || []) {
      const [sx, sy] = this.toScreen(p.x, p.y);
      ctx.font = 'italic 13px "EB Garamond", Georgia, serif';
      ctx.fillStyle = 'rgba(60,40,20,0.75)';
      ctx.fillText(`▲ cote ${p.h}`, sx, sy);
    }
    const name = this.map?.place?.name || this.st?.place;
    if (name && this.map?.place) {
      const [sx, sy] = this.toScreen(this.map.place.x, this.map.place.y - 330);
      ctx.font = '600 22px "IM Fell English", "EB Garamond", Georgia, serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(241,234,216,0.75)'; ctx.strokeText(name, sx, sy);
      ctx.fillStyle = '#3b2c1c'; ctx.fillText(name, sx, sy);
    }
  }
  // unités sous un point de l'écran : fanions d'abord (faciles à toucher), puis emprises
  unitAt(sx, sy, tol = 10) {
    for (const r of [...(this.bannerRects || [])].reverse()) if (sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1 + 6) return r.id;
    const [wx, wy] = this.toWorld(sx, sy);
    let best = null, bd = 1e9;
    for (const u of this.units.values()) {
      if (u.state === 'hors') continue;
      const c = Math.cos(u.dir), s = Math.sin(u.dir), dx = wx - u.x, dy = wy - u.y;
      const vv = dx * c + dy * s, uu = -dx * s + dy * c, m = tol / this.cam.z;
      const ex = Math.max(0, Math.abs(uu) - u.w / 2), ey = Math.max(0, Math.abs(vv) - u.d / 2 - 3);
      const d = Math.hypot(ex, ey);
      if (d <= m && d < bd) { bd = d; best = u.id; }
    }
    return best;
  }
  mine() { return [...this.units.values()].filter(u => u.side === this.me && !u._ghost && u.state !== 'hors'); }
}
