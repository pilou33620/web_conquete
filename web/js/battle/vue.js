// Vue tactique : la bataille en 3D, plein écran. Deux canevas : la scène WebGL (Three.js) dessous, un calque 2D
// dessus qui reçoit les gestes et porte les fanions, les tracés au sol (projetés sur le relief) et les gestes en
// cours. Caméra orbitale (camera.js), boucle d'animation, interrogation du serveur (/api/tactic toutes les 120 ms)
// avec interpolation des positions. Les commandes (commandes.js) et l'interface (interface.js) s'y branchent.
import * as THREE from '../../vendor/three/three.module.js';
import { Terrain } from './terrain.js';
import { Relief } from './relief.js';
import { Troops, loadAnims } from './troupes.js';
import { Decor } from './decor.js';
import { drawBanners } from './fanions.js';
import { UnitArt } from './unites.js';
import { Effects } from './effets.js';
import { Controls } from './commandes.js';
import { BattleUI } from './interface.js';
import { frameOf, project, unproject, anchor, clampCam, FOV } from './camera.js';
import { emprise, clsOf, isGeneral, clamp, wrapAngle, TAU } from './formes.js';
import { profil, onQualite, Mesure, solPx } from './qualite.js';
import { chargerSols } from './sols.js';
import { Pietinement, OmbreRegiments } from './pietinement.js';
import { Herbe } from './herbe.js';
import { ApresRendu } from './apres.js';
import { Ciel } from './ciel.js';
import { champDeVision, OEIL } from './visibilite.js';
import { segDist } from './gestes.js';

const POLL_MS = 120;

export class BattleView {
  // api : {get(url), post(url, body)} ; root : élément qui recevra la vue
  constructor(api, root) {
    this.api = api;
    this.root = root;
    root.innerHTML = '';
    // qualité graphique (qualite.js) : densité du canevas, détail du terrain, zoom maximal, caches
    this.q = profil();
    this.glc = document.createElement('canvas');
    this.glc.className = 'bt-3d';
    this.cv = document.createElement('canvas');
    this.cv.className = 'bt-canvas';
    root.append(this.glc, this.cv);
    this.ctx = this.cv.getContext('2d');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.glc, antialias: !!this.q.aa, powerPreference: 'high-performance' });
    } catch (e) { console.error(e); this.renderer = null; }
    // après-rendu (apres.js) : tone mapping ACES, étalonnage de l'heure, vignettage, FXAA, halo, selon la qualité ;
    // en Basse, rendu direct avec le même ACES
    if (this.renderer) { this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.post = new ApresRendu(this.renderer); this.post.setQuality(this.q); }
    // contexte WebGL rendu par Safari (application remise au premier plan) : les niveaux de détail du sol sont repeints
    this.glc.addEventListener('webglcontextrestored', () => { this.relief?.setQuality(this.q, true); this.reloadSols(); this.piet?.reset(); });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV * 180 / Math.PI, 1, 1, 10000);
    this.mesure = new Mesure();
    this.art = new UnitArt(this.q);
    this.fx = new Effects(this.q);
    this.units = new Map();
    this.sel = new Set();
    this.orders = new Map();     // derniers ordres donnés (affichés jusqu'à l'arrivée)
    this.st = null;
    this.seq = 0;
    this.cam = { x: 1500, y: 1000, z: 0.5, yaw: 0 };   // cible au sol, zoom (px/m à la cible), cap (camera.js)
    this.camAnim = null;
    this.showCover = false;
    this.running = false;
    this.frameMs = [];
    this.lastFrame = performance.now();
    this.pollGap = POLL_MS;
    this.onExit = null;          // rappelée au retour à la carte de campagne
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._offQ = onQualite(() => this.setQuality());
    this.controls = new Controls(this);
    this.ui = new BattleUI(this);
  }

  // ------------------------------------------------------------------ ouverture et fermeture
  async load(bid) {
    this.bid = bid;
    // (les animations des troupes arrivent en même temps que la carte ; loadAnims ne lève jamais)
    // (les sols photo aussi : sans eux, le sol reste peint seul)
    const [m, anims, sols] = await Promise.all([this.api.get(`/api/tactic_map?bid=${encodeURIComponent(bid)}`), loadAnims(), chargerSols(solPx(this.q))]);
    if (!m || (!m.t && !m.W)) throw new Error('Carte de bataille indisponible');
    if (!this.renderer) throw new Error('WebGL indisponible');
    this.map = m;
    this.nBreach = m.nbreach || 0;
    this.terrain = new Terrain(m, this.q);
    this.relief = new Relief(this.terrain, this.q);
    this.relief.setSols(sols);
    this.relief.setup(this.scene);
    this.ciel = new Ciel(this.relief, this.q);
    this.scene.add(this.ciel.mesh);
    this.piet = new Pietinement(this.renderer, this.terrain.W, this.terrain.H, this.q);
    if (m.piet) this.piet.importer(m.piet);   // la boue d'avant (bataille rechargée)
    this.pietSent = 0;
    this.relief.uni.uPiet.value = this.piet.texture;
    this.ombreR = new OmbreRegiments(this.renderer, this.terrain.W, this.terrain.H);
    this.herbe = new Herbe(this.relief, this.q);
    this.scene.add(this.herbe.mesh);
    this.relief.uni.uOmbreR.value = this.ombreR.texture;
    this.troops = new Troops(this.relief, this.q, m.year, anims);
    this.scene.add(this.troops.group);
    this.fx.attach(this.scene, this.relief.heightAt);
    this.fx.marks = m.marks || [[], []];   // (poudre sans fumée de chaque camp)
    this.decor = new Decor(this.terrain, this.relief, this.q);
    this.scene.add(this.decor.group);
    this.setShadows();
    this.art.setYear(m.year);   // coiffures de l'époque
    this.W = this.terrain.W; this.H = this.terrain.H;
    this.cam = { x: this.W / 2, y: this.H / 2, z: this.fitZ(), yaw: 0 };
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
    this._offQ();
    this.controls.dispose();
    this.ui.dispose();
    this.terrain?.dispose();
    this.relief?.dispose(); this.ciel?.dispose(); this.losTex?.dispose();
    this.piet?.dispose(); this.ombreR?.dispose(); this.herbe?.dispose();
    this.troops?.dispose();
    this.decor?.dispose();
    this.art.clear();
    this.fx.dispose();
    // (Safari ne garde qu'une poignée de contextes WebGL : on rend celui-ci tout de suite)
    this.post?.dispose();
    this.renderer?.dispose(); this.renderer?.forceContextLoss();
    this.root.innerHTML = '';
  }
  // nouvelle qualité graphique (menu, bataille, ou mesure des images par seconde) : tout suit sans recharger
  setQuality() {
    this.q = profil();
    this.art.setQuality(this.q);
    this.fx.setQuality(this.q);
    this.terrain?.setQuality(this.q);
    this.relief?.setQuality(this.q);
    if (this.relief?.sols && this.relief.sols.n !== solPx(this.q)) this.reloadSols();
    this.troops?.setQuality(this.q);
    this.post?.setQuality(this.q);
    this.ciel?.setQuality(this.q);
    this.herbe?.setQuality(this.q);
    // le décor dépend de la richesse des effets (bois allégés, arbres plus simples) : reconstruit s'il en change
    if (this.decor && this.decor.q.fx !== this.q.fx) {
      this.scene.remove(this.decor.group); this.decor.dispose();
      this.decor = new Decor(this.terrain, this.relief, this.q);
      this.scene.add(this.decor.group);
    }
    if (this.relief) this.setShadows();
    this.resize();
    this.clampCam();
  }

  // sols photo rechargés (autre taille selon la qualité, ou contexte WebGL perdu puis rendu par Safari)
  async reloadSols() {
    if (!this.relief) return;
    const r = this.relief, sols = await chargerSols(solPx(this.q));
    if (r !== this.relief || r.disposed) { sols?.dispose(); return; }
    r.setSols(sols);
  }

  // ombres portées selon la qualité (fx : 0 aucune, 1 le décor, 2 et 3 aussi les troupes)
  setShadows() {
    const level = this.q.ombres ?? this.q.fx ?? 2;
    this.shadowLevel = level;
    this.relief.shadows(this.renderer, level);
    this.troops.setShadows(level >= 2);
    // (les matériaux déjà compilés doivent l'être de nouveau avec ou sans ombres)
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }

  // ------------------------------------------------------------------ serveur
  async poll() {
    if (!this.running || this.closing) return;
    const t0 = performance.now();
    let st = null;
    try { st = await this.api.get(`/api/tactic?bid=${encodeURIComponent(this.bid)}&since=${this.seq}`); } catch (e) { st = null; }
    if (!this.running || this.closing) return;
    if (st && st.units) {
      try { this.apply(st); } catch (e) { console.error(e); }
      this.lost = false;
    } else if (!this.lost) { this.lost = true; this.ui.toast('Liaison avec le serveur perdue…', 'bad'); }
    // en pause ou en fin de bataille, on interroge moins souvent (pas pendant l'accéléré : la bataille défile) ; une
    // commande achevée pendant la question peut rendre la réponse périmée (accéléré, reprise, vitesse) : on redemande
    const wait = this.cmdT > t0 ? 0 : st && st.phase === 'fin' ? 1500 : st && st.speed === 0 && st.phase !== 'deploiement' && !st.accel ? 400 : POLL_MS;
    this.pollT = setTimeout(() => this.poll(), Math.max(10, wait - (performance.now() - t0)));
  }
  async cmd(sub, body = {}) {
    let r;
    try { r = await this.api.post('/api/cmd', { cmd: 'tac', sub, bid: this.bid, ...body }); } catch (e) { r = { ok: false, msg: 'Serveur injoignable.' }; }
    this.cmdT = performance.now();
    if (r && !r.ok && r.msg) this.ui.toast(r.msg, 'bad');
    return r || { ok: false };
  }
  apply(st) {
    const now = performance.now();
    if (this.lastSnap) this.pollGap = this.pollGap * 0.7 + clamp(now - this.lastSnap, 60, 600) * 0.3;
    // secondes de bataille par seconde réelle (le piétinement suit le temps de la bataille : pause, ×2, accéléré)
    if (this.lastSnap && this.st && st.clock != null && this.st.clock != null) this.clockRate = clamp((st.clock - this.st.clock) / Math.max(0.03, (now - this.lastSnap) / 1000), 0, 400);
    this.lastSnap = now;
    const prev = this.st;
    this.st = st;
    // brèches ouvertes au canon depuis le chargement de la carte
    for (const b of (st.breaches || []).slice(this.nBreach || 0)) { this.terrain.addBreach(b); this.relief.invalidate(b[1], b[2], (b[3] || 20) + 40); this.breached = true; }
    if (this.breached) { this.breached = false; this.decor.walls(); }   // l'enceinte est reconstruite autour des brèches
    this.nBreach = Math.max(this.nBreach || 0, (st.breaches || []).length);
    this.seq = st.seq ?? this.seq;
    this.me = st.me ?? 0;
    this.colors = (st.sides || []).map((s, i) => s.color || (i ? '#3f6fb5' : '#b8352a'));
    // boulets de ce relevé : une perte sur leur trajectoire couche une file (casualties)
    this.balls = (st.fx || []).filter(f => f.k === 'canon' && f.x2 != null);
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
      if (s.side === this.me) {
        const o = this.orders.get(id);
        // arrivé, en déroute, ou ordre refusé / remplacé côté serveur (après 1,5 s de marge) : la flèche disparaît
        const same = o && (s.order === o.kind || (o.kind === 'volley_charge' && s.order === 'charge'));
        if (o && ((o.kind === 'move' && Math.hypot(s.x - o.x, s.y - o.y) < 12) || s.state === 'deroute' || (!same && now - o.t > 1500))) this.orders.delete(id);
      }
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
    if (this.fx.decals.length) {
      for (const d of this.fx.decals) if (d.k === 'trou') this.piet?.stamp(d.x, d.y, d.r || 2.6);
      this.relief.decals.add(this.terrain.addDecals(this.fx.decals.splice(0)));
    }
    this.ui.update(st, prev);
  }
  // tués laissés au sol, dans l'emprise de l'unité : ils tombent en 3D (troupes.js, kill) ; un boulet de ce relevé
  // qui a traversé le régiment couche la file sur sa trajectoire (repère du régiment : u le long du front, v vers
  // l'avant) ; les corps sortis de l'anneau sont peints
  casualties(u, n) {
    const c = Math.cos(u.dir), s = Math.sin(u.dir), loc = (x, y) => [-s * (x - u.x) + c * (y - u.y), c * (x - u.x) + s * (y - u.y)];
    const ball = (this.balls || []).find(f => segDist(u.x, u.y, f.x, f.y, f.x2, f.y2) < Math.hypot(u.w, u.d) / 2);
    const out = this.troops.kill(u, n, (x, y) => this.terrain.bare(x, y), this.colors[u.side] || '#666', ball && [loc(ball.x, ball.y), loc(ball.x2, ball.y2)]);
    // débris au fil des pertes (SPEC-SUITE F8) : chapeaux, fusils, havresacs près des tués, roues brisées près des pièces
    const art = clsOf(u) === 'artillerie';
    for (const d of out.slice()) {
      if (d.k !== 'mort' || Math.random() > (art ? 0.2 : 0.3)) continue;
      const a = Math.random() * TAU, r = 0.8 + Math.random() * 2.5;
      out.push({ k: art && Math.random() < 0.5 ? 'roue' : ['chapeau', 'fusil', 'sac'][(Math.random() * 3) | 0], x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r, a: Math.random() * TAU });
    }
    if (out.length) this.relief.decals.add(this.terrain.addDecals(out));
  }
  // la boue, envoyée au serveur toutes les 30 s de bataille environ (gardée avec la sauvegarde)
  sendPiet() {
    const c = this.st?.clock;
    if (c == null || !this.piet || this.st?.phase !== 'combat' || c - (this.pietSent || 0) < 30) return;
    this.pietSent = c;
    let png = null;
    try { png = this.piet.exporter(); } catch (e) { return; }
    this.api.post('/api/cmd', { cmd: 'tac', sub: 'piet', bid: this.bid, png }).catch(() => {});
  }
  nearest(x, y) {
    let best = null, bd = 40;
    for (const u of this.units.values()) { const d = Math.hypot(u.x - x, u.y - y); if (d < bd) { bd = d; best = u; } }
    return best;
  }

  // ------------------------------------------------------------------ caméra
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    this.dpr = dpr;
    const r = this.root.getBoundingClientRect();
    this.vw = r.width > 10 ? r.width : window.innerWidth; this.vh = r.height > 10 ? r.height : window.innerHeight;
    this.cv.width = Math.round(this.vw * dpr); this.cv.height = Math.round(this.vh * dpr);
    this.renderer?.setPixelRatio(dpr);
    this.renderer?.setSize(this.vw, this.vh, false);
    this.post?.setSize(this.vw * dpr, this.vh * dpr);
    if (this.terrain) this.clampCam();
  }
  // zoom qui montre tout le champ (vu de haut, il paraît un peu moins profond que large)
  fitZ() { return Math.min(this.vw / (this.W || 3000), this.vh / ((this.H || 2000) * 0.9)) * 0.95; }
  minZ() { return this.fitZ() * 0.7; }
  maxZ() { return this.q.maxZ; }
  // repère de la caméra pour l'état présent (recalculé seulement quand la caméra ou l'écran a changé)
  fr() {
    const c = this.cam, f = this._fr, yaw = c.yaw || 0;
    if (f && f.cx === c.x && f.cy === c.y && f.cz === c.z && f.cyaw === yaw && f.vw === this.vw && f.vh === this.vh) return f;
    const n = frameOf(c, this, this.relief.heightAt);
    n.cx = c.x; n.cy = c.y; n.cz = c.z; n.cyaw = yaw;
    return (this._fr = n);
  }
  // terrain → écran ([sx, sy, profondeur]) et écran → terrain, sur le relief
  toScreen = (x, y) => project(this.fr(), x, y, this.relief.heightAt(x, y));
  toWorld(sx, sy) { return unproject(this.fr(), sx, sy, this.relief.heightAt); }
  // point à dh m au-dessus du sol (fanions)
  toScreenH(x, y, dh) { return project(this.fr(), x, y, this.relief.heightAt(x, y) + dh); }
  clampCam() { clampCam(this.cam, { W: this.W, H: this.H, minZ: this.minZ(), maxZ: this.maxZ() }); }
  // yaw : cap d'arrivée (sinon le cap ne change pas)
  moveCam(x, y, z, dur = 600, yaw = null) {
    // la cible est ramenée dans les bornes dès le départ : pas de saut à l'arrivée
    const from = { ...this.cam, yaw: this.cam.yaw || 0 };
    this.cam = { x, y, z: clamp(z ?? from.z, this.minZ(), this.maxZ()), yaw: yaw ?? from.yaw };
    this.clampCam();
    const to = this.cam;
    this.cam = from;
    this.camAnim = { from, to, t0: performance.now(), dur };
  }
  // déplace la vue comme si le doigt passait de (px, py) à (sx, sy) : la carte suit le doigt, dans le repère de la
  // caméra (de droite à gauche le long du front de l'écran, de haut en bas vers l'horizon, raccourci par l'inclinaison)
  panBy(px, py, sx, sy) {
    const yaw = this.cam.yaw || 0, s = 1 / this.cam.z;
    const dx = (sx - px) * s, dy = (sy - py) * s / Math.max(0.35, Math.sin(this.fr().pitch));
    this.cam.x += Math.sin(yaw) * dy - Math.cos(yaw) * dx;
    this.cam.y += -Math.cos(yaw) * dy - Math.sin(yaw) * dx;
    this.camAnim = null;
    this.clampCam();
  }
  // zoom vers un point de l'écran : le point du terrain sous le doigt y reste
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z = clamp(this.cam.z * f, this.minZ(), this.maxZ());
    anchor(this.cam, this, this.relief.heightAt, wx, wy, sx, sy);
    this.camAnim = null;
    this.clampCam();
  }
  // cadre ses propres troupes, le regard tourné vers l'ennemi (ou, sans ennemi en vue, vers le centre du champ) ;
  // sans troupe, la zone de déploiement
  focusMine(dur = 900) {
    const mine = [...this.units.values()].filter(u => u.side === this.me && !u._ghost && u.state !== 'hors');
    if (!mine.length) { const z = this.st?.zone; if (z) this.moveCam((z[0] + z[2]) / 2, (z[1] + z[3]) / 2, 0.8, dur); return; }
    const x0 = Math.min(...mine.map(u => u.x)), x1 = Math.max(...mine.map(u => u.x));
    const y0 = Math.min(...mine.map(u => u.y)), y1 = Math.max(...mine.map(u => u.y));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const foe = [...this.units.values()].filter(u => u.side !== this.me && u.state !== 'hors');
    const tx = foe.length ? foe.reduce((a, u) => a + u.x, 0) / foe.length : this.W / 2;
    const ty = foe.length ? foe.reduce((a, u) => a + u.y, 0) / foe.length : this.H / 2;
    const d = Math.hypot(tx - cx, ty - cy) || 1, fx = (tx - cx) / d, fy = (ty - cy) / d;
    // assez près pour distinguer les régiments, toutes ses troupes dans le cadre
    const zz = clamp(Math.min(this.vw, this.vh * 1.3) / (Math.hypot(x1 - x0, y1 - y0) + 500), 0.6, 1.3);
    // les troupes dans le bas de l'image : la cible un peu en avant d'elles, vers l'ennemi
    const ahead = Math.min(d * 0.35, this.vh / zz * 0.25);
    this.moveCam(cx + fx * ahead, cy + fy * ahead, zz, dur, Math.atan2(fx, -fy));
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
      this.cam = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, z: Math.exp(lz), yaw: a.from.yaw + wrapAngle(a.to.yaw - a.from.yaw) * e };
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
      if (u.state === 'charge' && clsOf(u) === 'cavalerie' && !u._ghost && Math.hypot(u.to.x - u.from.x, u.to.y - u.from.y) > 2) this.fx.trail(u.x, u.y, u.dir, u.w, u._figScale);
    }
    const speed = this.st?.speed ?? 1;
    const w = this.st?.weather || this.map?.weather;
    this.piet?.update(this.units.values(), this.pollGap / 1000, w === 'pluie' || w === 'orage' || w === 'tempete', dt, this.clockRate ?? 18 * speed);
    this.fx.update(speed === 0 ? dt * 0.15 : dt * Math.min(1.6, 0.8 + speed * 0.2), this.st?.wind);
    this.relief?.tick(now);
    this.draw(dt, now / 1000);
    this.ui.frame(now);
    const ms = performance.now() - t0;
    this.frameMs.push(ms);
    this.drawMs = ms;
    // qualité automatique : on descend d'un cran si l'appareil peine (combat, sans geste ni tuiles en rafale)
    const calme = this.st?.phase === 'combat' && !this.controls.busy() && !this.camAnim && !this.detailBusy;
    this.mesure.image(dt * 1000, calme, now);
    if (this.frameMs.length > 120) this.frameMs.shift();
  }

  draw(dt, time) {
    if (!this.terrain || !this.renderer) return;
    const ctx = this.ctx, dpr = this.dpr, z = this.cam.z, fr = this.fr();
    // mesure facultative, poste par poste (this.prof = {} pour l'activer)
    let tm = performance.now();
    const mark = k => { if (!this.prof) return; const n = performance.now(); this.prof[k] = (this.prof[k] || 0) + n - tm; tm = n; };
    // la scène 3D
    const cam = this.camera;
    cam.aspect = this.vw / this.vh; cam.near = clamp(fr.dist * 0.02, 0.5, 50); cam.far = fr.dist * 6 + 9000;
    cam.updateProjectionMatrix();
    cam.position.set(fr.E[0], fr.E[1], fr.E[2]); cam.lookAt(fr.T[0], fr.T[1], fr.T[2]);
    this.relief.follow(fr);
    this.herbe?.follow(fr);
    this.decor.near(fr.dist); this.decor.lod(fr);
    // de loin, les figurines ne font que quelques pixels : leurs ombres ne se voient plus et coûteraient autant que
    // les figurines elles-mêmes (écart entre 600 et 700 m : pas de bascule à chaque image)
    if (this.shadowLevel >= 2) this.troops.setShadows(this.troops.castShadow ? fr.dist < 700 : fr.dist < 600);
    const deploy = this.st?.phase === 'deploiement';
    const hour = this.hourNum(), sky = { weather: this.st?.weather || this.map?.weather, light: this.st?.light ?? 1, hour, wind: this.st?.wind };
    const ciel = this.fx.ciel(sky, this.terrain.season);
    this.relief.postFog = this.post.actif;
    this.ciel.update(ciel, cam);
    const los = this.updateLos();
    this.relief.update(this.scene, fr.dist, los ? 0.42 : (deploy && this.showCover !== false) || this.showCover === true ? 0.42 + Math.sin(time * 2.2) * 0.1 : 0, ciel, time);
    this.fx.uni?.uTint.value.setRGB(...ciel.smoke);
    // (la fumée : claire et teintée par le soleil de son côté, bleutée du côté de l'ombre)
    if (this.fx.uni) { this.fx.uni.uSunDir.value.set(...ciel.sunDir).normalize(); this.fx.uni.uSunCol.value.setRGB(...ciel.sun); this.fx.uni.uShadeCol.value.setRGB(...ciel.hemiSky).multiplyScalar(0.62); }
    // sol plus fin autour de la caméra : un bloc par image (aucun pendant un pincement), deux si l'image est vite faite
    this.detailBusy = this.relief.updateDetail(this.renderer, this, this.controls.busy() ? 0 : this.drawMs < 12 ? 2 : 1);
    const all = [...this.units.values()].filter(u => u.state !== 'hors'), vis = all.filter(u => this.onScreen(u));
    this.troops.update(all, this.colors || [], time, this.fx.t, fr, cam);
    this.decor.clearings(all, performance.now());
    this.fx.render(fr, z);
    this.piet?.render();
    this.sendPiet();
    this.ombreR?.render(all);
    if (this.post.actif) { cam.updateMatrixWorld(); this.post.setBrume(ciel, this.relief.fogLin, cam); }
    this.post.render(this.scene, cam, ciel.grade, time, fr.dist);
    mark('scene');
    // le calque 2D
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    this.drawGround(ctx, time);
    mark('sol');
    const view = { toScreen: this.toScreen, z, vw: this.vw, vh: this.vh, dpr, fxT: this.fx.t, post: this.post.actif };
    this.fx.atmosphere(ctx, view, sky, dt, time);   // pluie, neige, éclairs, nuit
    this.drawLabels(ctx);
    this.bannerRects = drawBanners(ctx, this, vis, this.colors || [], { sel: this.sel, me: this.me, time });
    this.controls.drawOverlay(ctx, view, time);
    mark('fanions');
  }
  // ligne de vue (SPEC-SUITE F6, visibilite.js) : avec une seule unité choisie, ce qu'elle voit reste clair et le reste
  // s'assombrit. Le voile passe par la texture des couverts du sol (pas de texture en plus : le sol en a 15 sur 16) ;
  // recalculé quand l'unité change de case
  setLos(on) { this.losOn = !!on; if (!on) this.losKey = ''; }
  updateLos() {
    const r = this.relief, u = this.losOn && this.sel.size === 1 ? this.units.get([...this.sel][0]) : null;
    if (!u || !this.terrain) { if (r.uni.uCover.value !== r.cover) r.uni.uCover.value = r.cover; return false; }
    const t = this.terrain, i = clamp(Math.floor(u.x / t.cell), 0, t.cols - 1), j = clamp(Math.floor(u.y / t.cell), 0, t.rows - 1), c0 = j * t.cols + i;
    const cls = clsOf(u), eye = cls === 'cavalerie' || cls === 'general' ? 3.5 : cls === 'artillerie' ? 3 : OEIL, key = `${u.id}|${c0}`;
    if (key !== this.losKey) {
      this.losKey = key;
      const vu = champDeVision(t, c0, eye, Math.ceil(1600 / t.cell));
      if (!this.losCv) {
        this.losCv = document.createElement('canvas'); this.losCv.width = t.cols; this.losCv.height = t.rows;
        this.losTex = new THREE.CanvasTexture(this.losCv); this.losTex.flipY = false; this.losTex.colorSpace = THREE.SRGBColorSpace;
      }
      const g = this.losCv.getContext('2d'), img = g.createImageData(t.cols, t.rows);
      for (let k = 0; k < vu.length; k++) if (!vu[k]) { img.data[k * 4] = 12; img.data[k * 4 + 1] = 14; img.data[k * 4 + 2] = 20; img.data[k * 4 + 3] = 190; }
      g.putImageData(img, 0, 0);
      this.losTex.needsUpdate = true;
    }
    r.uni.uCover.value = this.losTex;
    return true;
  }
  onScreen(u) {
    const [sx, sy, depth] = this.toScreen(u.x, u.y), m = Math.max(u.w, u.d) * this.cam.z + 80;
    return depth > 0 && sx > -m && sy > -m && sx < this.vw + m && sy < this.vh + m;
  }
  hourNum() {
    const c = this.st?.clock;
    if (c != null) return 8 + c / 3600;
    const m = /(\d+)\s*h\s*(\d*)/.exec(this.st?.hour || '');
    return m ? +m[1] + (+m[2] || 0) / 60 : 12;
  }
  // tracé au sol : chaque segment est découpé (pas plus fin que nécessaire selon la distance de la caméra) et chaque
  // point projeté sur le relief ; le chemin est laissé ouvert dans ctx (stroke ou fill ensuite)
  groundPath(ctx, pts, closed = false) {
    const step = clamp(this.fr().dist / 120, 2, 40);
    ctx.beginPath();
    const n = pts.length, last = closed ? n : n - 1;
    let first = true;
    const at = (x, y) => { const [sx, sy] = this.toScreen(x, y); if (first) { ctx.moveTo(sx, sy); first = false; } else ctx.lineTo(sx, sy); };
    for (let k = 0; k < last; k++) {
      const a = pts[k], b = pts[(k + 1) % n], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let q = 0; q < m; q++) at(a[0] + (b[0] - a[0]) * q / m, a[1] + (b[1] - a[1]) * q / m);
    }
    if (closed) ctx.closePath(); else if (n) at(pts[n - 1][0], pts[n - 1][1]);
  }
  // emprise d'un régiment (rectangle tourné, agrandi de pad m), tracée au sol
  footprint(ctx, x, y, dir, w, d, pad = 0) {
    const c = Math.cos(dir), s = Math.sin(dir), W = w / 2 + pad, D = d / 2 + pad;
    const pts = [[-W, D], [W, D], [W, -D], [-W, -D]].map(([uu, vv]) => [x + c * vv - s * uu, y + s * vv + c * uu]);
    this.groundPath(ctx, pts, true);
    return pts;
  }
  arc(x, y, r, a0, a1) { const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * 12)), out = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } return out; }
  // au sol, sur le calque (projeté sur le relief) : zone de déploiement, portées, ralliement, ordres en cours, sélection,
  // objectif, cible survolée
  drawGround(ctx, time) {
    const st = this.st;
    const deploy = st?.phase === 'deploiement';
    if (deploy && st.zone) {
      const [x0, y0, x1, y1] = st.zone;
      this.groundPath(ctx, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
      ctx.fillStyle = 'rgba(230,201,127,0.12)'; ctx.fill();
      ctx.setLineDash([14, 9]); ctx.lineDashOffset = -time * 20;
      ctx.strokeStyle = 'rgba(255,226,150,0.95)'; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.setLineDash([]);
    }
    // portées de l'unité sélectionnée (efficace et maximale), dans son champ de tir
    if (this.sel.size === 1) {
      const u = this.units.get([...this.sel][0]);
      if (u && u.range && u.range[0] > 0 && clsOf(u) !== 'general') {
        const arc = Math.PI / 3;
        ctx.lineWidth = 1.6;
        for (const [r, a] of [[u.range[1], 0.35], [u.range[0], 0.7], [u.range[2], 0.6]]) {
          if (!r) continue;
          ctx.strokeStyle = r === u.range[2] ? `rgba(240,120,90,${a})` : `rgba(255,236,170,${a})`;
          ctx.setLineDash(r === u.range[1] ? [8, 6] : []);
          this.groundPath(ctx, [[u.x, u.y], ...this.arc(u.x, u.y, r, u.dir - arc, u.dir + arc)], true); ctx.stroke();
          if (r === u.range[0]) { ctx.fillStyle = 'rgba(255,236,170,0.08)'; ctx.fill(); }
        }
        ctx.setLineDash([]);
      }
    }
    // zone de ralliement autour de mes états-majors : un voile doré, son contour en pointillés qui tournent
    const rz = this.rallyZone();
    if (rz) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
      ctx.setLineDash([10, 8]); ctx.lineDashOffset = -time * 12;
      for (const g of rz.gens) {
        this.groundPath(ctx, this.arc(g.x, g.y, g.rally, 0, TAU), true);
        ctx.fillStyle = `rgba(255,226,150,${rz.picked ? 0.09 : 0.045})`; ctx.fill();
        ctx.strokeStyle = `rgba(255,226,150,${rz.picked ? 0.6 + 0.3 * pulse : 0.45})`; ctx.lineWidth = rz.picked ? 2.2 : 1.4; ctx.stroke();
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    // ordres en cours de mes unités : trajet pointillé et emplacement d'arrivée
    for (const u of this.units.values()) {
      if (u.side !== this.me || u._ghost || u.state === 'hors') continue;
      const o = this.orders.get(u.id);
      const selected = this.sel.has(u.id);
      const path = Array.isArray(u.path) && u.path.length ? u.path : null;
      if (o && o.kind === 'move' && o.x != null && Math.hypot(o.x - u.x, o.y - u.y) > 10) {
        ctx.strokeStyle = selected ? 'rgba(255,230,160,0.9)' : 'rgba(255,230,160,0.45)'; ctx.lineWidth = selected ? 2.2 : 1.4;
        ctx.setLineDash([6, 6]);
        this.groundPath(ctx, [[u.x, u.y], ...(path || [[o.x, o.y]])]); ctx.stroke();
        ctx.setLineDash([]);
        this.footprint(ctx, o.x, o.y, o.dir ?? Math.atan2(o.y - u.y, o.x - u.x), u.w, u.d, 1); ctx.stroke();
      }
      const tgt = o && (o.kind === 'attack' || o.kind === 'charge') ? this.units.get(String(o.target)) : u.target != null && selected ? this.units.get(String(u.target)) : null;
      if (tgt) {
        ctx.strokeStyle = o?.kind === 'charge' ? 'rgba(255,120,90,0.9)' : 'rgba(255,170,120,0.7)'; ctx.lineWidth = 2;
        this.groundPath(ctx, [[u.x, u.y], [tgt.x, tgt.y]]); ctx.stroke();
      }
      if (selected) {
        // un anneau lumineux à la forme de la formation (halo large et doux, puis le trait)
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,226,150,0.22)'; ctx.lineWidth = 9;
        this.footprint(ctx, u.x, u.y, u.dir, u.w, u.d, 7); ctx.stroke();
        ctx.fillStyle = 'rgba(255,226,150,0.12)'; ctx.strokeStyle = 'rgba(255,236,170,0.95)'; ctx.lineWidth = 2;
        this.footprint(ctx, u.x, u.y, u.dir, u.w, u.d, 4); ctx.fill(); ctx.stroke();
        // l'avant : une flèche
        const c = Math.cos(u.dir), s = Math.sin(u.dir), f = u.d / 2 + 8;
        this.groundPath(ctx, [[u.x + c * (f + 9), u.y + s * (f + 9)], [u.x + c * f - s * 6, u.y + s * f + c * 6], [u.x + c * f + s * 6, u.y + s * f - c * 6]], true);
        ctx.fillStyle = 'rgba(255,226,150,0.95)'; ctx.fill();
      }
    }
    // lignes de front (à la manière d'UGAR) : entre deux régiments ennemis au contact (feu, recharge, mêlée, charge), un ruban
    // qui ondule au sol, à la couleur de chaque camp de son côté
    const seen = new Set();
    ctx.lineCap = 'round';
    for (const u of this.units.values()) {
      if (u._ghost || u.target == null || !(u.state === 'feu' || u.state === 'recharge' || u.state === 'melee' || u.state === 'charge')) continue;
      const t = this.units.get(String(u.target));
      if (!t || t.side === u.side || t._ghost || t.state === 'hors') continue;
      const key = String(u.id) < String(t.id) ? `${u.id}|${t.id}` : `${t.id}|${u.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dx = t.x - u.x, dy = t.y - u.y, L = Math.hypot(dx, dy);
      if (L > 320 || L < 1) continue;
      const nx = dx / L, ny = dy / L, half = Math.max(u.w || 40, t.w || 40) * 0.55, mx = (u.x + t.x) / 2, my = (u.y + t.y) / 2;
      for (const [side, off] of [[u.side, -3], [t.side, 3]]) {
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const s = -half + 2 * half * k / 16, w = off + Math.sin(s * 0.07 + time * 2.2) * 2.5 * Math.sin(Math.PI * k / 16);
          pts.push([mx - ny * s + nx * w, my + nx * s + ny * w]);
        }
        ctx.strokeStyle = this.colors?.[side] || '#ccc'; ctx.globalAlpha = 0.85; ctx.lineWidth = 3.2;
        this.groundPath(ctx, pts); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // objectif d'un assaut : le cœur de la place (tenu hold_need secondes sans défenseur pour l'emporter)
    const obj = st?.objective || (this.map?.heart && this.map?.place ? this.map.heart : null);
    if (obj) {
      const r = 26, k = clamp((st?.hold || 0) / (st?.hold_need || 60), 0, 1);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,226,150,0.85)'; ctx.setLineDash([7, 5]);
      this.groundPath(ctx, this.arc(obj[0], obj[1], r + Math.sin(time * 2) * 2, 0, TAU), true); ctx.stroke(); ctx.setLineDash([]);
      if (k > 0) { ctx.strokeStyle = 'rgba(255,120,90,0.95)'; ctx.lineWidth = 5; this.groundPath(ctx, this.arc(obj[0], obj[1], r, -Math.PI / 2, -Math.PI / 2 + k * TAU)); ctx.stroke(); }
    }
    // cible survolée ou désignée
    const hov = this.controls.hover && this.units.get(this.controls.hover);
    if (hov && hov.side !== this.me) {
      ctx.strokeStyle = 'rgba(255,110,90,0.95)'; ctx.lineWidth = 2.2;
      this.footprint(ctx, hov.x, hov.y, hov.dir, hov.w, hov.d, 6); ctx.stroke();
    }
  }
  // ralliement : une troupe en déroute ne se reforme qu'auprès du général, loin de l'ennemi. Tant qu'une des miennes
  // fuit, la zone de ralliement autour de mes états-majors est montrée (plus nettement si un fuyard est choisi)
  rallyZone() {
    const mine = [...this.units.values()].filter(u => u.side === this.me && !u._ghost && u.state !== 'hors');
    const routed = mine.filter(u => u.state === 'deroute');
    const gens = mine.filter(g => isGeneral(g) && g.rally);
    return routed.length && gens.length ? { gens, picked: routed.some(u => this.sel.has(u.id)) } : null;
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
