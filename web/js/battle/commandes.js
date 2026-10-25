// Vue tactique : gestes au doigt, à la souris et au clavier. Vos officiers commandent (« Donner mes ordres ») : les
// gestes ne servent qu'à regarder.
//  un doigt ou un clic glissé : déplacer la vue (avec élan) ; deux doigts : zoomer et déplacer ; molette : zoomer
//  (la vue est de dessus : elle ne pivote pas)
//  appui sur un régiment : sa fiche (le vôtre ou l'ennemi) ; appui sur le sol : la refermer
//  clavier : flèches ou ZQSD pour déplacer la vue, + et - pour zoomer, Échap pour refermer la fiche
import { clamp } from './formes.js';
import { anchor } from './camera.js';

export class Controls {
  constructor(view) {
    this.v = view;
    this.pts = new Map();
    this.g = null;
    this.hover = null;   // (vue.js : le régiment survolé est souligné ; personne ici)
    this.inertia = null;
    this.keys = new Set();
    const cv = view.cv;
    this.h = {
      down: e => this.down(e), move: e => this.move(e), up: e => this.up(e), cancel: e => this.up(e, true),
      wheel: e => { e.preventDefault(); if (!this.v.terrain) return; const [sx, sy] = this.pos(e); this.v.zoomAt(sx, sy, Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0022))); },
      ctx: e => e.preventDefault(),
      key: e => this.key(e), keyup: e => this.keys.delete(e.key),
    };
    cv.addEventListener('pointerdown', this.h.down);
    cv.addEventListener('pointermove', this.h.move);
    cv.addEventListener('pointerup', this.h.up);
    cv.addEventListener('pointercancel', this.h.cancel);
    cv.addEventListener('wheel', this.h.wheel, { passive: false });
    cv.addEventListener('contextmenu', this.h.ctx);
    window.addEventListener('keydown', this.h.key);
    window.addEventListener('keyup', this.h.keyup);
  }
  dispose() {
    window.removeEventListener('keydown', this.h.key);
    window.removeEventListener('keyup', this.h.keyup);
  }
  pos(e) { const r = this.v.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  busy() { return !!this.g && (this.g.mode === 'pinch' || this.g.mode === 'pan') || !!this.inertia; }

  // ------------------------------------------------------------------ pointeurs
  down(e) {
    const v = this.v;
    if (!v.terrain) return;   // (la carte se charge encore)
    v.cv.setPointerCapture?.(e.pointerId);
    const [sx, sy] = this.pos(e);
    this.pts.set(e.pointerId, { x: sx, y: sy });
    this.inertia = null;
    v.ui.closeTransient?.();
    if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.g = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: v.cam.z, w0: v.toWorld(cx, cy) };
      return;
    }
    if (this.pts.size > 2) return;
    this.g = { mode: e.button === 1 ? 'pan' : 'pending', sx, sy, x: sx, y: sy, touch: e.pointerType !== 'mouse', hit: v.unitAt(sx, sy, e.pointerType !== 'mouse' ? 16 : 6), vel: [0, 0] };
  }
  move(e) {
    const v = this.v, [sx, sy] = this.pos(e);
    if (!v.terrain || !this.pts.has(e.pointerId)) return;
    const p = this.pts.get(e.pointerId), px = p.x, py = p.y;
    p.x = sx; p.y = sy;
    const g = this.g;
    if (!g) return;
    if (g.mode === 'pinch') {
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      v.cam.z = clamp(g.z0 * d / g.d0, v.minZ(), v.maxZ());
      // le point du terrain pris entre les doigts reste entre eux
      anchor(v.cam, v, g.w0[0], g.w0[1], cx, cy);
      v.camAnim = null;
      v.clampCam();
      return;
    }
    g.x = sx; g.y = sy;
    if (g.mode === 'pending') {
      if (Math.hypot(sx - g.sx, sy - g.sy) < (g.touch ? 11 : 5)) return;
      g.mode = 'pan';
    }
    if (g.mode === 'pan') {
      v.panBy(px, py, sx, sy);
      const now = performance.now(), dtm = Math.max(1, now - (g.lt || now - 16));
      g.vel = [g.vel[0] * 0.6 + (sx - px) / dtm * 1000 * 0.4, g.vel[1] * 0.6 + (sy - py) / dtm * 1000 * 0.4];
      g.lt = now;
    }
  }
  up(e, cancel = false) {
    this.pts.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.mode === 'pinch') { this.g = this.pts.size ? { mode: 'none' } : null; return; }
    if (this.pts.size) return;
    this.g = null;
    if (cancel) return;
    if (g.mode === 'pending') this.v.ui.inspect(g.hit || null);
    else if (g.mode === 'pan' && Math.hypot(...g.vel) > 120) this.inertia = { vx: g.vel[0], vy: g.vel[1] };
  }

  // ------------------------------------------------------------------ clavier
  key(e) {
    if (!this.v.running || e.target?.closest?.('input, textarea, select')) return;
    const v = this.v, k = e.key;
    this.keys.add(k);
    if (k === 'Escape') v.ui.inspect(null);
    else if (k === '+' || k === '=') v.zoomAt(v.vw / 2, v.vh / 2, 1.25);
    else if (k === '-') v.zoomAt(v.vw / 2, v.vh / 2, 0.8);
  }
  tick(dt) {
    const v = this.v;
    if (this.inertia) {
      const iv = this.inertia;
      v.panBy(0, 0, iv.vx * dt, iv.vy * dt);
      const k = Math.exp(-dt * 4.5); iv.vx *= k; iv.vy *= k;
      if (Math.hypot(iv.vx, iv.vy) < 20) this.inertia = null;
    }
    let kx = 0, ky = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('q') || this.keys.has('a')) kx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) kx += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('z') || this.keys.has('w')) ky -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('s')) ky += 1;
    if (kx || ky) { v.panBy(0, 0, -kx * 520 * dt, -ky * 520 * dt); v.camAnim = null; }
  }
  drawOverlay() {}
}
