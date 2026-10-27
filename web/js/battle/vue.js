// Vue tactique : la bataille vue de dessus (SPEC-2D), plein écran, sur un seul canevas 2D. À chaque image, dans
// l'ordre : le sol (sol2d.js : terrain, tués, cratères et piétinement), le décor au sol (decor2d.js : bâtiments,
// enceintes, ponts, vie des champs), les troupes (troupes2d.js), le décor au-dessus (houppiers ajourés au-dessus des
// hommes, flammes), le voile de la ligne de vue, les effets puis l'atmosphère (effets.js), enfin l'interface : tracés
// des ordres, portées, anneau du régiment inspecté, lignes de front, objectif, étiquettes, fanions (fanions.js).
// Caméra verticale (camera.js), boucle d'animation, interrogation du serveur (/api/tactic toutes les 120 ms) avec
// interpolation des positions. Les commandes (commandes.js) et l'interface (interface.js) s'y branchent.
import { Terrain } from './terrain.js';
import { Sol2D } from './sol2d.js';
import { Troupes2D } from './troupes2d.js';
import { Decor2D } from './decor2d.js';
import { drawBanners } from './fanions.js';
import { UnitArt } from './unites.js';
import { Effects } from './effets.js';
import { Controls } from './commandes.js';
import { BattleUI } from './interface.js';
import * as camera from './camera.js';
import { emprise, clsOf, isGeneral, clamp, wrapAngle, segDist, TAU, hexRgb, rgbStr } from './formes.js';
import { profil, onQualite, Mesure } from './qualite.js';
import { Pietinement } from './pietinement.js';
import { champDeVision, OEIL } from './visibilite.js';

const POLL_MS = 120;
const CONTACT = new Set(['feu', 'recharge', 'melee', 'charge']);

// lignes de front, vues de dessus : pour chaque paire de régiments ennemis au contact (l'un feu, recharge, mêlée ou
// charge sur l'autre, centres à moins de 200 m ; le serveur ne dit pas la cible des ennemis), une bande à peine
// bombée le long du bord de chaque emprise qui fait face à l'autre (le front, les arrières ou un flanc), un peu au
// dehors et de son côté du milieu ; elle suit le régiment, pas la direction de l'adversaire : calme. Une bande par bord.
// gap : écart (m) entre le bord et la bande ; get(id) : l'unité. [{ side, x0, y0, x1, y1, cx, cy }] en m (les deux
// bouts et le point de contrôle de la courbe)
export function fronts(units, get, gap) {
  const out = [], vus = new Set();
  const bande = (u, t, L) => {
    // repère du régiment : vers l'avant (c, s) sur d / 2, le long du front (-s, c) sur w / 2 ; le bord tourné vers t
    const c = Math.cos(u.dir || 0), s = Math.sin(u.dir || 0), w = (u.w || 40) / 2, d = (u.d || 10) / 2, dx = t.x - u.x, dy = t.y - u.y;
    const av = (dx * c + dy * s) / L, fl = (dy * c - dx * s) / L, face = Math.abs(av) >= Math.abs(fl);
    const sg = Math.sign(face ? av : fl) || 1, key = `${u.id}|${face ? 'a' : 'f'}${sg}`;
    if (vus.has(key)) return;
    vus.add(key);
    const [ox, oy] = face ? [c * sg, s * sg] : [-s * sg, c * sg];
    const off = Math.min((face ? d : w) + gap, (L / 2 - 0.5) / Math.abs(face ? av : fl)), hl = (face ? w : d) * 0.9;
    const mx = u.x + ox * off, my = u.y + oy * off;
    out.push({ side: u.side, x0: mx - oy * hl, y0: my + ox * hl, x1: mx + oy * hl, y1: my - ox * hl, cx: mx + ox * hl * 0.06, cy: my + oy * hl * 0.06 });
  };
  for (const u of units) {
    if (u._ghost || u.target == null || !CONTACT.has(u.state)) continue;
    const t = get(String(u.target));
    if (!t || t.side === u.side || t._ghost || t.state === 'hors') continue;
    const L = Math.hypot(t.x - u.x, t.y - u.y);
    if (L > 200 || L < 1) continue;
    bande(u, t, L); bande(t, u, L);
  }
  return out;
}

// le voile de la ligne de vue, adouci : chaque case (vu[k] : 0 cachée) devient F × F pixels, puis deux passes d'un
// flou en boîte de rayon r : un bord fondu sur environ deux cases. { a (0 vu à 1 caché), w, h }
export function voileDoux(vu, cols, rows, F = 4, r = 4) {
  const w = cols * F, h = rows * F, a = new Float32Array(w * h), b = new Float32Array(w * h), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) { const o = y * w, j = ((y / F) | 0) * cols; for (let x = 0; x < w; x++) a[o + x] = vu[j + ((x / F) | 0)] ? 0 : 1; }
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += a[o + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) { b[o + x] = s * k; s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { a[y * w + x] = s * k; s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; }
    }
  }
  return { a, w, h };
}

export class BattleView {
  // api : {get(url), post(url, body)} ; root : élément qui recevra la vue
  constructor(api, root) {
    this.api = api;
    this.root = root;
    root.innerHTML = '';
    // qualité graphique (qualite.js) : densité du canevas, figures, fumée, détail du décor, mémoire des tuiles
    this.q = profil();
    this.cv = document.createElement('canvas');
    this.cv.className = 'bt-canvas';
    root.append(this.cv);
    // (le sol couvre tout le canevas : pas de transparence à composer)
    this.ctx = this.cv.getContext('2d', { alpha: false });
    this.mesure = new Mesure();
    this.art = new UnitArt(this.q);
    this.fx = new Effects(this.q);
    this.units = new Map();
    this.sel = new Set();
    this.orders = new Map();     // derniers ordres donnés (affichés jusqu'à l'arrivée)
    this.st = null;
    this.seq = 0;
    this.cam = { x: 1500, y: 1000, z: 0.5 };   // centre de l'écran sur le terrain (m), zoom (px/m) (camera.js)
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
    const m = await this.api.get(`/api/tactic_map?bid=${encodeURIComponent(bid)}`);
    if (!m || (!m.t && !m.W)) throw new Error('Carte de bataille indisponible');
    this.map = m;
    this.nBreach = m.nbreach || 0;
    this.terrain = new Terrain(m, this.q);
    this.W = this.terrain.W; this.H = this.terrain.H;
    this.piet = new Pietinement(this.W, this.H, this.q);
    if (m.piet) this.piet.importer(m.piet);   // la boue d'avant (bataille rechargée)
    this.pietSent = 0;
    this.sol = new Sol2D(this.terrain, this.q, this.piet);
    this.troupes = new Troupes2D(this.q, m.year);
    this.decor = new Decor2D(this.terrain, m, this.q);
    if (m.bati?.length) this.decor.bati(m.bati);   // toits crevés, feux et ruines d'avant (bataille rechargée)
    for (const b of m.barr || []) this.terrain.addBarricade(b);   // barricades d'avant (leurs cases sont déjà dans t)
    this.nBarr = (m.barr || []).length;
    if (this.nBarr) this.decor.walls();
    this.fx.marks = m.marks || [[], []];   // (poudre sans fumée de chaque camp)
    this.art.setYear(m.year);   // coiffures de l'époque
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
    this._offQ();
    this.controls.dispose();
    this.ui.dispose();
    this.terrain?.dispose(); this.sol?.dispose(); this.piet?.dispose();
    this.troupes?.dispose(); this.decor?.dispose();
    this.art.clear();
    this.fx.dispose();
    // (Safari compte la mémoire des canevas : on la rend tout de suite)
    this.cv.width = this.cv.height = 0;
    if (this.losCv) this.losCv.width = this.losCv.height = 0;
    this.root.innerHTML = '';
  }
  // nouvelle qualité graphique (menu, bataille, ou mesure des images par seconde) : tout suit sans recharger
  setQuality() {
    this.q = profil();
    this.art.setQuality(this.q);
    this.fx.setQuality(this.q);
    this.sol?.setQuality(this.q);   // (et celle du terrain)
    this.troupes?.setQuality(this.q);
    this.decor?.setQuality(this.q);
    this.resize();
    this.clampCam();
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
    // brèches ouvertes au canon depuis le chargement de la carte : le sol est repeint autour, l'enceinte refaite
    for (const b of (st.breaches || []).slice(this.nBreach || 0)) { this.terrain.addBreach(b); this.sol.invalidate(b[1], b[2], (b[3] || 20) + 40); this.breached = true; }
    if (this.breached) { this.breached = false; this.decor.walls(); }
    this.nBreach = Math.max(this.nBreach || 0, (st.breaches || []).length);
    // barricades dressées ou renversées depuis le dernier relevé : les cases (passage, sol), le décor
    const nBarr = (st.barr || []).length;
    for (const b of (st.barr || []).slice(this.nBarr || 0)) this.terrain.addBarricade(b);
    if (st.barr_t?.length || nBarr > (this.nBarr || 0)) {
      this.nBarr = Math.max(this.nBarr || 0, nBarr);
      const xy = (st.barr_t || []).map(([c, t]) => this.terrain.setCell(c, t));
      this.decor.walls();   // (d'après les cases à jour)
      for (const [x, y] of xy) { this.sol.invalidate(x, y, 40); this.decor.invalider([x - 30, y - 30, x + 30, y + 30]); }
    }
    // bâtiments touchés, en feu, en ruine depuis le dernier relevé
    if (st.bati?.length) this.decor.bati(st.bati);
    this.seq = st.seq ?? this.seq;
    this.me = st.me ?? 0;
    this.colors = (st.sides || []).map((s, i) => s.color || (i ? '#3f6fb5' : '#b8352a'));
    // boulets de ce relevé : une perte sur leur trajectoire couche une file (casualties)
    this.balls = (st.fx || []).filter(f => f.k === 'canon' && f.x2 != null);
    // secondes de bataille depuis le relevé d'avant : un déplacement plus rapide qu'un galop est un saut (redéploiement,
    // ennemi revu ailleurs), sans glissade ni traînée de boue
    const dtB = prev?.clock != null && st.clock != null ? st.clock - prev.clock : 0;
    const seen = new Set();
    for (const s of st.units) {
      const id = String(s.id);
      seen.add(id);
      let u = this.units.get(id);
      const [w0, d0] = emprise(s);
      const w = s.w || w0, d = s.d || d0;
      // (s.rempart : une batterie du défenseur sur les murs, dessinée sans avant-train ni chevaux ; recopiée avec le reste)
      if (!u) {
        u = { ...s, id, w, d, from: { x: s.x, y: s.y, dir: s.dir || 0 }, to: { x: s.x, y: s.y, dir: s.dir || 0 }, t0: now, dir: s.dir || 0 };
        this.units.set(id, u);
      } else {
        if (u.men > s.men && s.men >= 0 && this.terrain) this.casualties(u, u.men - s.men);
        const cur = { x: u.x, y: u.y, dir: u.dir };
        // pendant le déploiement, une unité qu'on vient de poser localement garde sa place jusqu'à confirmation
        const pin = u._pin && now - u._pin < 1500;
        Object.assign(u, s, { id, w, d, rempart: !!s.rempart });
        if (pin) { u.x = cur.x; u.y = cur.y; u.dir = cur.dir; continue; }
        u.from = cur;
        u.to = { x: s.x, y: s.y, dir: s.dir ?? cur.dir };
        u.t0 = now;
        const dd = Math.hypot(u.to.x - cur.x, u.to.y - cur.y);
        if (dd > 400 || (dtB > 0 && dd > 15 * dtB + 20)) u.from = { ...u.to };
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
    if (st.mode !== 'ordres') for (const id of [...this.sel]) { const u = this.units.get(id); if (!u || u.state === 'hors' || u.side !== this.me) this.sel.delete(id); }
    // effets depuis la dernière réponse, étalés sur l'intervalle selon leur instant
    const fxs = st.fx || [];
    if (fxs.length) {
      // (première réponse : on suppose un pas du serveur, 2 s de bataille ; l'échelle de temps n'intervient pas ici)
      const tA = prev?.clock ?? (st.clock ?? 0) - 2, tB = st.clock ?? tA + 2, span = Math.max(0.001, tB - tA);
      const gap = this.pollGap / 1000, time = now / 1000;
      for (const f of fxs.slice(prev ? -150 : -30)) {
        const k = f.t != null ? clamp((f.t - tA) / span, 0, 1) : Math.random(), un = f.u != null ? this.units.get(String(f.u)) : this.nearest(f.x, f.y);
        // les éclairs et la fumée partent des bouches à feu des figures
        if (un && (f.k === 'salve' || f.k === 'canon' || f.k === 'mitraille')) un._muzzles = this.troupes.muzzles(un, time);
        this.fx.push(f, un, k * gap);
        // bêtes et villageois fuient les points de chute (le boulet arrive un peu après le coup)
        if ((f.k === 'canon' || f.k === 'mitraille') && f.x2 != null) this.fx.later(k * gap + 0.6, () => this.decor.fuir(f.x2, f.y2));
        else if (f.k === 'explosion') this.fx.later(k * gap, () => this.decor.fuir(f.x, f.y));
      }
    }
    this.stampFx();
    this.ui.update(st, prev);
  }
  // cratères des effets, peints au sol une fois pour toutes ; les trous remuent aussi la terre (piétinement)
  stampFx() {
    if (!this.fx.decals.length) return;
    const list = this.fx.decals.splice(0);
    for (const d of list) if (d.k === 'trou') this.piet.stamp(d.x, d.y, d.r || 2.6);
    this.sol.stamp(list);
  }
  // tués laissés au sol, dans l'emprise de l'unité (troupes2d.js, kill) : un boulet de ce relevé qui a traversé le
  // régiment couche la file sur sa trajectoire (repère du régiment : u le long du front, v vers l'avant) ; tous sont
  // peints au sol
  casualties(u, n) {
    const c = Math.cos(u.dir), s = Math.sin(u.dir), loc = (x, y) => [-s * (x - u.x) + c * (y - u.y), c * (x - u.x) + s * (y - u.y)];
    const ball = (this.balls || []).find(f => segDist(u.x, u.y, f.x, f.y, f.x2, f.y2) < Math.hypot(u.w, u.d) / 2);
    const out = this.troupes.kill(u, n, (x, y) => this.terrain.bare(x, y), this.colors[u.side] || '#666', ball && [loc(ball.x, ball.y), loc(ball.x2, ball.y2)]);
    // débris au fil des pertes (SPEC-SUITE F8) : chapeaux, fusils, havresacs près des tués, roues brisées près des pièces
    const art = clsOf(u) === 'artillerie';
    for (const d of out.slice()) {
      if (d.k !== 'mort' || Math.random() > (art ? 0.2 : 0.3)) continue;
      const a = Math.random() * TAU, r = 0.8 + Math.random() * 2.5;
      out.push({ k: art && Math.random() < 0.5 ? 'roue' : ['chapeau', 'fusil', 'sac'][(Math.random() * 3) | 0], x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r, a: Math.random() * TAU });
    }
    if (out.length) this.sol.stamp(out);
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
    if (this.terrain) this.clampCam();
  }
  // zoom qui montre tout le champ
  fitZ() { return Math.min(this.vw / (this.W || 3000), this.vh / (this.H || 2000)) * 0.95; }
  minZ() { return this.fitZ() * 0.7; }
  // mi-distance (la première maquette, maquette-2d.html : les soldats en rangs, les drapeaux, la fumée) : 2,5 px par mètre,
  // un peu moins sur un petit écran (au moins 250 m dans sa plus petite dimension) ; l'ouverture et la caméra qui suit l'action
  miZ() { return clamp(Math.min(2.5, Math.min(this.vw, this.vh) / 250), this.fitZ(), this.maxZ()); }
  maxZ() { return this.q.maxZ; }
  // terrain → écran ([sx, sy, 1]) et écran → terrain
  toScreen = (x, y) => camera.toScreen(this.cam, this, x, y);
  toWorld(sx, sy) { return camera.toWorld(this.cam, this, sx, sy); }
  // le pied de la hampe d'un fanion : au bord nord de l'emprise du régiment (au plus 40 px au-dessus de son centre)
  toScreenH(u) {
    const [sx, sy] = this.toScreen(u.x, u.y), c = Math.abs(Math.cos(u.dir || 0)), s = Math.abs(Math.sin(u.dir || 0));
    return [sx, sy - Math.min(40, (s * (u.d || 10) + c * (u.w || 20)) / 2 * this.cam.z) - 4, 1];
  }
  clampCam() { camera.clampCam(this.cam, { W: this.W, H: this.H, minZ: this.minZ(), maxZ: this.maxZ() }); }
  moveCam(x, y, z, dur = 600) {
    // la cible est ramenée dans les bornes dès le départ : pas de saut à l'arrivée
    const from = { ...this.cam };
    this.cam = { x, y, z: clamp(z ?? from.z, this.minZ(), this.maxZ()) };
    this.clampCam();
    const to = this.cam;
    this.cam = from;
    this.camAnim = { from, to, t0: performance.now(), dur };
  }
  // déplace la vue comme si le doigt passait de (px, py) à (sx, sy) : la carte suit le doigt
  panBy(px, py, sx, sy) {
    this.cam.x -= (sx - px) / this.cam.z;
    this.cam.y -= (sy - py) / this.cam.z;
    this.camAnim = null;
    this.clampCam();
  }
  // zoom vers un point de l'écran : le point du terrain sous le doigt y reste
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z = clamp(this.cam.z * f, this.minZ(), this.maxZ());
    camera.anchor(this.cam, this, wx, wy, sx, sy);
    this.camAnim = null;
    this.clampCam();
  }
  // cadre ses propres troupes, un peu en avant vers l'ennemi (ou, sans ennemi en vue, vers le centre du champ) ;
  // sans troupe, la zone de déploiement
  focusMine(dur = 900) {
    const mine = this.mine();
    if (!mine.length) { const z = this.st?.zone; if (z) this.moveCam((z[0] + z[2]) / 2, (z[1] + z[3]) / 2, 0.8, dur); return; }
    const x0 = Math.min(...mine.map(u => u.x)), x1 = Math.max(...mine.map(u => u.x));
    const y0 = Math.min(...mine.map(u => u.y)), y1 = Math.max(...mine.map(u => u.y));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const foe = [...this.units.values()].filter(u => u.side !== this.me && u.state !== 'hors');
    const tx = foe.length ? foe.reduce((a, u) => a + u.x, 0) / foe.length : this.W / 2;
    const ty = foe.length ? foe.reduce((a, u) => a + u.y, 0) / foe.length : this.H / 2;
    const d = Math.hypot(tx - cx, ty - cy) || 1, fx = (tx - cx) / d, fy = (ty - cy) / d;
    // à mi-distance, le centre de ses troupes (la vue d'ensemble en dézoomant)
    const zz = this.miZ();
    const ahead = Math.min(d * 0.25, Math.min(this.vw, this.vh) / zz * 0.2);
    this.moveCam(cx + fx * ahead, cy + fy * ahead, zz, dur);
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
      // (dans les maisons, à l'abri des regards : ses hommes à soi la voient pâlie)
      u._fade = u._ghost ? clamp(1 - (now - u.ghostT) / 60000, 0.25, 1) : u.side === this.me && u.form === 'maisons' && !u.seen ? 0.55 : 1;
      // poussière sous les sabots, seulement si la charge avance vraiment
      if (u.state === 'charge' && clsOf(u) === 'cavalerie' && !u._ghost && Math.hypot(u.to.x - u.from.x, u.to.y - u.from.y) > 2) this.fx.trail(u.x, u.y, u.dir, u.w, u._figScale);
    }
    const speed = this.st?.speed ?? 1;
    const w = this.st?.weather || this.map?.weather;
    // (la boue ne vient que du combat : les placements du déploiement ne foulent rien)
    if (this.st?.phase === 'combat') this.piet?.update(this.units.values(), this.pollGap / 1000, w === 'pluie' || w === 'orage' || w === 'tempete', dt, this.clockRate ?? 18 * speed);
    const fdt = speed === 0 ? dt * 0.15 : dt * Math.min(1.6, 0.8 + speed * 0.2);
    this.fx.update(fdt, this.st?.wind);
    this.decor?.update(fdt, this.st?.wind);
    if (this.terrain) this.stampFx();
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
  // la caméra pour les calques (SPEC-2D § 2) : chacun dessine en mètres après view.monde(ctx)
  vue(time, dt) {
    const { dpr, vw, vh } = this, cam = { ...this.cam }, z = cam.z, ox = vw / 2 - cam.x * z, oy = vh / 2 - cam.y * z;
    const x0 = cam.x - vw / 2 / z, x1 = cam.x + vw / 2 / z, y0 = cam.y - vh / 2 / z, y1 = cam.y + vh / 2 / z;
    return {
      z, dpr, vw, vh, cam, time, dt, q: this.q,
      monde: ctx => ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy),
      toScreen: (x, y) => [x * z + ox, y * z + oy, 1],
      visible: (x, y, m = 0) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m,
    };
  }

  draw(dt, time) {
    if (!this.terrain) return;
    const ctx = this.ctx, dpr = this.dpr, view = this.vue(time, dt);
    // mesure facultative, poste par poste (this.prof = {} pour l'activer)
    let tm = performance.now();
    const mark = k => { if (!this.prof) return; const n = performance.now(); this.prof[k] = (this.prof[k] || 0) + n - tm; tm = n; };
    // 1. le sol ; tuiles encore à peindre : la mesure des images par seconde attend
    this.detailBusy = this.sol.draw(ctx, view) > 0;
    mark('sol');
    // 2. le décor au sol
    this.decor.sous(ctx, view);
    mark('decor');
    // 3. les troupes ; 4. le décor au-dessus d'elles
    const all = [...this.units.values()].filter(u => u.state !== 'hors');
    this.troupes.draw(ctx, view, all, this.colors || [], time);
    mark('troupes');
    this.decor.dessus(ctx, view, all);
    this.drawLos(ctx, view);
    mark('dessus');
    // 5. les effets, puis la lumière de l'heure, la pluie, la neige, la nuit
    this.fx.draw(ctx, view);
    const sky = { weather: this.st?.weather || this.map?.weather, light: this.st?.light ?? 1, hour: this.hourNum(), wind: this.st?.wind, season: this.terrain.season };
    this.fx.atmosphere(ctx, view, sky, dt, time);
    mark('effets');
    this.sendPiet();
    // 6. l'interface
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    this.drawGround(ctx, time);
    this.drawLabels(ctx);
    this.bannerRects = drawBanners(ctx, this, all.filter(u => this.onScreen(u)), this.colors || [], { sel: this.sel, me: this.me, time });
    this.controls.drawOverlay(ctx, view, time);
    mark('interface');
  }
  // ligne de vue (SPEC-SUITE F6, visibilite.js) : avec une seule unité choisie, ce qu'elle ne voit pas s'assombrit,
  // un voile à basse définition au bord fondu (voileDoux), lissé par l'agrandissement ; recalculé quand l'unité change
  // de case
  setLos(on) { this.losOn = !!on; if (!on) this.losKey = ''; }
  drawLos(ctx, view) {
    const u = this.losOn && this.sel.size === 1 ? this.units.get([...this.sel][0]) : null;
    if (!u) return;
    const t = this.terrain, i = clamp(Math.floor(u.x / t.cell), 0, t.cols - 1), j = clamp(Math.floor(u.y / t.cell), 0, t.rows - 1), c0 = j * t.cols + i;
    const cls = clsOf(u), eye = cls === 'cavalerie' || cls === 'general' ? 3.5 : cls === 'artillerie' ? 3 : OEIL, key = `${u.id}|${c0}`;
    if (key !== this.losKey) {
      this.losKey = key;
      const { a, w, h } = voileDoux(champDeVision(t, c0, eye, Math.ceil(1600 / t.cell)), t.cols, t.rows);
      if (!this.losCv) { this.losCv = document.createElement('canvas'); this.losCv.width = w; this.losCv.height = h; }
      const g = this.losCv.getContext('2d'), img = g.createImageData(w, h), px = img.data;
      for (let k = 0; k < a.length; k++) { px[k * 4] = 12; px[k * 4 + 1] = 14; px[k * 4 + 2] = 20; px[k * 4 + 3] = a[k] * 150; }
      g.putImageData(img, 0, 0);
    }
    view.monde(ctx);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.losCv, 0, 0, t.cols * t.cell, t.rows * t.cell);
  }
  onScreen(u) {
    const [sx, sy] = this.toScreen(u.x, u.y), m = Math.max(u.w, u.d) * this.cam.z + 80;
    return sx > -m && sy > -m && sx < this.vw + m && sy < this.vh + m;
  }
  hourNum() {
    const c = this.st?.clock;
    if (c != null) return 8 + (c + (this.st.h_off || 0)) / 3600;   // (h_off : « Donner mes ordres », l’heure de l’attaque)
    const m = /(\d+)\s*h\s*(\d*)/.exec(this.st?.hour || '');
    return m ? +m[1] + (+m[2] || 0) / 60 : 12;
  }
  // tracé au sol, en pixels d'écran ; le chemin est laissé ouvert dans ctx (stroke ou fill ensuite)
  groundPath(ctx, pts, closed = false) {
    ctx.beginPath();
    pts.forEach(([x, y], k) => { const [sx, sy] = this.toScreen(x, y); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
    if (closed) ctx.closePath();
  }
  // emprise d'un régiment (rectangle tourné, agrandi de pad m), tracée au sol
  footprint(ctx, x, y, dir, w, d, pad = 0) {
    const c = Math.cos(dir), s = Math.sin(dir), W = w / 2 + pad, D = d / 2 + pad;
    const pts = [[-W, D], [W, D], [W, -D], [-W, -D]].map(([uu, vv]) => [x + c * vv - s * uu, y + s * vv + c * uu]);
    this.groundPath(ctx, pts, true);
    return pts;
  }
  arc(x, y, r, a0, a1) { const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * 12)), out = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } return out; }
  // au sol, sur le calque : zone de déploiement, flèches de la manœuvre (ordres.js), portées, ralliement, ordres en
  // cours, anneau du régiment choisi, lignes de front, objectif, cible survolée
  drawGround(ctx, time) {
    const st = this.st;
    const deploy = st?.phase === 'deploiement';
    // « Couverts » (commandée à la main) : bois, bâti et hauteurs en couleurs, qui battent doucement
    const cov = this.terrain?.coverImg;
    if (cov && ((deploy && this.showCover !== false) || this.showCover === true)) {
      const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(this.W, this.H);
      ctx.globalAlpha = 0.42 + Math.sin(time * 2.2) * 0.1;
      ctx.drawImage(cov, x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1;
    }
    if (deploy && st.zone) {
      const [x0, y0, x1, y1] = st.zone;
      this.groundPath(ctx, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
      ctx.fillStyle = 'rgba(230,201,127,0.12)'; ctx.fill();
      ctx.setLineDash([14, 9]); ctx.lineDashOffset = -time * 20;
      ctx.strokeStyle = 'rgba(255,226,150,0.95)'; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.setLineDash([]);
    }
    this.ui.ordres.drawGround(ctx, time);
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
      // (sur ordres, le régiment inspecté peut être ennemi : son anneau seulement)
      if (u._ghost || u.state === 'hors' || (u.side !== this.me && !this.sel.has(u.id))) continue;
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
    // lignes de front (fronts) : une bande calme à la couleur du camp, qui s'efface aux deux bouts, sur un liseré sombre
    // qui la détache du sol ; rien quand elle ferait moins de 8 px
    const z = this.cam.z, lw = clamp(1.6 + z * 0.35, 2.5, 5);
    ctx.lineCap = 'butt';
    for (const f of fronts(this.units.values(), id => this.units.get(id), 1.5 + 5 / z)) {
      const [ax, ay] = this.toScreen(f.x0, f.y0), [bx, by] = this.toScreen(f.x1, f.y1), [qx, qy] = this.toScreen(f.cx, f.cy);
      if (Math.hypot(bx - ax, by - ay) < 8) continue;
      const rgb = hexRgb(this.colors?.[f.side] || (f.side ? '#3f6fb5' : '#b8352a'));
      for (const [col, a, l] of [[[20, 16, 10], 0.3, lw + 2.5], [rgb, 0.9, lw]]) {
        const gr = ctx.createLinearGradient(ax, ay, bx, by);
        gr.addColorStop(0, rgbStr(col, 0)); gr.addColorStop(0.22, rgbStr(col, a)); gr.addColorStop(0.78, rgbStr(col, a)); gr.addColorStop(1, rgbStr(col, 0));
        ctx.strokeStyle = gr; ctx.lineWidth = l;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(qx, qy, bx, by); ctx.stroke();
      }
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
