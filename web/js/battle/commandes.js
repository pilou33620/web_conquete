// Vue tactique : gestes au doigt, à la souris et au clavier.
//  appui sur une de ses unités : la sélectionner (maj + clic : ajouter ou retirer ; nouvel appui : désélectionner)
//  appui long puis glisser : cadre de sélection (maj + glisser à la souris)
//  glisser depuis une de ses unités : tracer sa destination (flèche courbe et silhouette à l'arrivée) ;
//    pendant le déploiement, la déplacer directement dans la zone
//  unités sélectionnées : appui sur le sol pour y aller ; glisser depuis le sol pour fixer l'emplacement et
//    l'orientation de la ligne d'arrivée ; appui sur un ennemi pour l'attaquer (ou le charger après « Charger »)
//  un doigt ailleurs ou clic du milieu : déplacer la vue ; deux doigts : zoomer, déplacer et pivoter (en tournant les
//    doigts) ; molette : zoomer ; clic droit glissé : pivoter (clic droit sans glisser : ordre de marche ou d'attaque)
import { clsOf, clamp, wrapAngle, TAU } from './formes.js';
import { anchor } from './camera.js';

const LONG_MS = 480;

export class Controls {
  constructor(view) {
    this.v = view;
    this.pts = new Map();
    this.g = null;
    this.hover = null;
    this.targeting = null;    // 'charge' | 'vcharge' (salve puis baïonnette) | 'attack' : le prochain appui sur un ennemi donne cet ordre
    this.run = false;         // les prochains déplacements se font au galop (cavalerie) ou au pas de course
    this.pings = [];
    this.inertia = null;
    this.keys = new Set();
    this.lastTap = null;
    const cv = view.cv;
    this.h = {
      down: e => this.down(e), move: e => this.move(e), up: e => this.up(e), cancel: e => this.up(e, true),
      wheel: e => { e.preventDefault(); if (!this.v.relief) return; const [sx, sy] = this.pos(e); this.v.zoomAt(sx, sy, Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0022))); },
      ctx: e => e.preventDefault(),
      key: e => this.key(e, true), keyup: e => this.keys.delete(e.key),
    };
    cv.addEventListener('pointerdown', this.h.down);
    cv.addEventListener('pointermove', this.h.move);
    cv.addEventListener('pointerup', this.h.up);
    cv.addEventListener('pointercancel', this.h.cancel);
    cv.addEventListener('pointerleave', () => { if (!this.pts.size) this.hover = null; });
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
  busy() { return !!this.g && (this.g.mode === 'pinch' || this.g.mode === 'pan' || this.g.mode === 'rotate'); }
  deploying() { return this.v.st?.phase === 'deploiement'; }
  mineSel() { return [...this.v.sel].map(id => this.v.units.get(id)).filter(u => u && u.side === this.v.me && !u._ghost && u.state !== 'hors'); }

  // ------------------------------------------------------------------ pointeurs
  down(e) {
    const v = this.v;
    if (!v.relief) return;   // (la carte se charge encore)
    v.cv.setPointerCapture?.(e.pointerId);
    const [sx, sy] = this.pos(e);
    this.pts.set(e.pointerId, { x: sx, y: sy });
    this.inertia = null;
    v.ui.closeTransient?.();
    if (this.pts.size === 2) {
      clearTimeout(this.g?.longT);
      const [a, b] = [...this.pts.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.g = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: v.cam.z, w0: v.toWorld(cx, cy), a0: Math.atan2(b.y - a.y, b.x - a.x), yaw0: v.cam.yaw || 0, rot: false };
      return;
    }
    if (this.pts.size > 2) return;
    const touch = e.pointerType !== 'mouse';
    const hit = v.unitAt(sx, sy, touch ? 16 : 6);
    this.g = { mode: 'pending', sx, sy, x: sx, y: sy, t0: performance.now(), hit, touch, button: e.button, shift: e.shiftKey, w0: v.toWorld(sx, sy), vel: [0, 0] };
    if (e.button === 1 || e.button === 2) { this.g.mode = e.button === 1 ? 'pan' : 'rpending'; return; }
    this.g.longT = setTimeout(() => {
      if (this.g && this.g.mode === 'pending') {
        this.g.mode = 'box';
        try { navigator.vibrate?.(15); } catch (_) { /* rien */ }
      }
    }, LONG_MS);
  }
  move(e) {
    const v = this.v, [sx, sy] = this.pos(e);
    if (!v.relief) return;
    if (!this.pts.has(e.pointerId)) {
      // survol à la souris : désigne une cible
      if (e.pointerType === 'mouse') {
        const id = v.unitAt(sx, sy, 6);
        this.hover = id && v.units.get(id)?.side !== v.me && this.mineSel().length ? id : null;
        v.cv.classList.toggle('bt-target', !!this.hover || !!this.targeting);
      }
      return;
    }
    const p = this.pts.get(e.pointerId), px = p.x, py = p.y;
    p.x = sx; p.y = sy;
    const g = this.g;
    if (!g) return;
    if (g.mode === 'pinch') {
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
      v.cam.z = clamp(g.z0 * d / g.d0, v.minZ(), v.maxZ());
      // la rotation ne s'engage qu'au-delà de 7° : un simple pincement ne fait pas tourner la vue ; la carte tourne
      // ensuite avec les doigts
      if (!g.rot && Math.abs(wrapAngle(ang - g.a0)) > 0.12) { g.rot = true; g.a0 = ang; g.yaw0 = v.cam.yaw || 0; }
      if (g.rot) v.cam.yaw = g.yaw0 - wrapAngle(ang - g.a0);
      // le point du terrain pris entre les doigts reste entre eux
      anchor(v.cam, v, v.relief.heightAt, g.w0[0], g.w0[1], cx, cy);
      v.camAnim = null;
      v.clampCam();
      return;
    }
    g.x = sx; g.y = sy;
    const moved = Math.hypot(sx - g.sx, sy - g.sy);
    if (g.mode === 'pending' || g.mode === 'rpending') {
      if (moved < (g.touch ? 11 : 5)) return;
      clearTimeout(g.longT);
      const hitU = g.hit && v.units.get(g.hit), mine = hitU && hitU.side === v.me && !hitU._ghost;
      const sel = this.mineSel();
      if (g.mode === 'rpending') g.mode = 'rotate';
      else if (g.shift && !g.touch) g.mode = 'box';
      else if (mine && hitU.state !== 'deroute') {
        if (!v.sel.has(hitU.id)) { v.sel.clear(); v.sel.add(hitU.id); v.ui.selChanged(); }
        g.units = this.mineSel().map(u => u.id);
        g.mode = this.deploying() ? 'drag-unit' : 'order';
      } else if (sel.length && !g.hit) {
        g.units = sel.map(u => u.id);
        g.mode = 'order-line';
      } else g.mode = 'pan';
    }
    if (g.mode === 'rotate') {
      v.cam.yaw = (v.cam.yaw || 0) + (sx - px) * 0.006;   // vers la droite : on regarde à droite
      v.camAnim = null;
    }
    if (g.mode === 'pan') {
      v.panBy(px, py, sx, sy);
      const now = performance.now(), dtm = Math.max(1, now - (g.lt || now - 16));
      g.vel = [g.vel[0] * 0.6 + (sx - px) / dtm * 1000 * 0.4, g.vel[1] * 0.6 + (sy - py) / dtm * 1000 * 0.4];
      g.lt = now;
    }
    if (g.mode === 'order' || g.mode === 'drag-unit') {
      const id = v.unitAt(sx, sy, g.touch ? 14 : 6);
      this.hover = id && v.units.get(id)?.side !== v.me ? id : null;
    }
  }
  up(e, cancel = false) {
    const v = this.v;
    this.pts.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.mode === 'pinch') { if (this.pts.size === 0) this.g = null; else this.g = { mode: 'none' }; return; }
    if (this.pts.size) return;
    clearTimeout(g.longT);
    this.g = null;
    if (cancel) return;
    const [wx, wy] = v.toWorld(g.x, g.y);
    switch (g.mode) {
      case 'pending': this.tap(g); break;
      case 'rpending': this.rightTap(g); break;
      case 'rotate': break;
      case 'pan': if (Math.hypot(...g.vel) > 120) this.inertia = { vx: g.vel[0], vy: g.vel[1] }; break;
      case 'box': this.boxSelect(g); break;
      case 'drag-unit': {
        const [ox, oy] = [wx - g.w0[0], wy - g.w0[1]];
        const us = g.units.map(id => v.units.get(id)).filter(Boolean);
        const c = centroid(us);
        this.deploy(us, c[0] + ox, c[1] + oy, null);
        break;
      }
      case 'order': {
        const tgt = this.hover;
        this.hover = null;
        if (tgt) { this.order(this.targetKind(), { target: tgt }); break; }
        const us = g.units.map(id => v.units.get(id)).filter(Boolean), c = centroid(us);
        this.order('move', { x: wx, y: wy, dir: Math.atan2(wy - c[1], wx - c[0]) });
        break;
      }
      case 'order-line': {
        const [x0, y0] = g.w0, dir = Math.atan2(wy - y0, wx - x0);
        if (this.deploying()) this.deploy(this.mineSel(), x0, y0, dir);
        else this.order('move', { x: x0, y: y0, dir });
        break;
      }
    }
  }
  tap(g) {
    const v = this.v, hitU = g.hit && v.units.get(g.hit);
    const [wx, wy] = g.w0;
    const now = performance.now();
    const dbl = this.lastTap && now - this.lastTap.t < 320 && Math.hypot(g.sx - this.lastTap.x, g.sy - this.lastTap.y) < 30;
    this.lastTap = { t: now, x: g.sx, y: g.sy };
    if (hitU && hitU.side === v.me && !hitU._ghost) {
      if (this.targeting) { this.setTargeting(null); }
      if (g.shift) { if (v.sel.has(hitU.id)) v.sel.delete(hitU.id); else v.sel.add(hitU.id); }
      else if (dbl) { v.moveCam(hitU.x, hitU.y, Math.max(v.cam.z, 1.6), 500); v.sel.clear(); v.sel.add(hitU.id); }
      else if (v.sel.size === 1 && v.sel.has(hitU.id)) v.sel.clear();
      else { v.sel.clear(); v.sel.add(hitU.id); }
      v.ui.selChanged();
      return;
    }
    const sel = this.mineSel();
    if (hitU && hitU.side !== v.me) {
      if (sel.length && !this.deploying()) {
        this.order(this.targetKind(), { target: hitU.id });
        this.ping(hitU.x, hitU.y, 'rgba(255,120,90,');
      } else v.ui.inspect(hitU.id);
      return;
    }
    if (this.targeting) { this.setTargeting(null); v.ui.toast('Ordre annulé.'); return; }
    if (!sel.length) { v.ui.inspect(null); return; }
    if (this.deploying()) { this.deploy(sel, wx, wy, null); return; }
    const c = centroid(sel);
    this.order('move', { x: wx, y: wy, dir: sel.length === 1 && Math.hypot(wx - c[0], wy - c[1]) < 30 ? sel[0].dir : Math.atan2(wy - c[1], wx - c[0]) });
  }
  rightTap(g) {
    const v = this.v, sel = this.mineSel();
    if (!sel.length) return;
    const hitU = g.hit && v.units.get(g.hit);
    if (hitU && hitU.side !== v.me) { this.order('attack', { target: hitU.id }); return; }
    const [wx, wy] = g.w0, c = centroid(sel);
    if (this.deploying()) this.deploy(sel, wx, wy, null);
    else this.order('move', { x: wx, y: wy, dir: Math.atan2(wy - c[1], wx - c[0]) });
  }
  boxSelect(g) {
    const v = this.v;
    const x0 = Math.min(g.sx, g.x), x1 = Math.max(g.sx, g.x), y0 = Math.min(g.sy, g.y), y1 = Math.max(g.sy, g.y);
    if (x1 - x0 < 8 && y1 - y0 < 8) { if (g.hit) v.ui.inspect(g.hit); return; }
    if (!g.shift) v.sel.clear();
    for (const u of v.mine()) {
      const [sx, sy] = v.toScreen(u.x, u.y);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) v.sel.add(u.id);
    }
    v.ui.selChanged();
  }
  // l'ordre que donnera le prochain appui sur un ennemi
  targetKind() { return this.targeting === 'charge' ? 'charge' : this.targeting === 'vcharge' ? 'volley_charge' : 'attack'; }
  setTargeting(kind) {
    this.targeting = kind;
    this.v.cv.classList.toggle('bt-target', !!kind);
    this.v.ui.targetingChanged(kind);
  }

  // ------------------------------------------------------------------ ordres
  // destinations de chaque unité : la disposition relative est gardée, tournée avec la nouvelle orientation
  spread(us, x, y, dir) {
    const c = centroid(us);
    const mean = Math.atan2(us.reduce((a, u) => a + Math.sin(u.dir), 0), us.reduce((a, u) => a + Math.cos(u.dir), 0));
    const da = dir == null || us.length < 2 ? 0 : wrapAngle(dir - mean);
    return us.map(u => {
      const ox = u.x - c[0], oy = u.y - c[1];
      return { u, x: us.length > 1 ? x + ox * Math.cos(da) - oy * Math.sin(da) : x, y: us.length > 1 ? y + ox * Math.sin(da) + oy * Math.cos(da) : y, dir: dir == null ? u.dir : us.length > 1 ? wrapAngle(u.dir + da) : dir };
    });
  }
  order(kind, body = {}) {
    const v = this.v, us = this.mineSel();
    if (!us.length) return;
    // « Finir automatiquement » : vos officiers commandent ; un geste sur le terrain ne leur reprend pas la main
    if (v.st?.accel) { v.ui.toast('Vos officiers mènent la bataille : touchez « Reprendre le commandement » pour donner vos ordres.'); return; }
    if (kind === 'move') {
      for (const d of this.spread(us, body.x, body.y, body.dir)) v.orders.set(d.u.id, { kind: 'move', x: d.x, y: d.y, dir: d.dir, t: performance.now() });
      this.ping(body.x, body.y);
    } else if (kind === 'attack' || kind === 'charge' || kind === 'volley_charge') {
      for (const u of us) v.orders.set(u.id, { kind, target: body.target, t: performance.now() });
    } else for (const u of us) v.orders.delete(u.id);
    if (kind === 'charge' || this.targeting) this.setTargeting(null);
    v.cmd('order', { units: us.map(u => u.id), kind, ...(kind === 'move' && this.run ? { run: true } : {}), ...body });
    v.ui.ordered(kind, us, body);
  }
  deploy(us, x, y, dir) {
    const v = this.v, z = v.st?.zone;
    if (!us.length) return;
    const now = performance.now();
    let out = false;
    for (const d of this.spread(us, x, y, dir)) {
      let nx = d.x, ny = d.y;
      if (z) { const cx = clamp(nx, z[0], z[2]), cy = clamp(ny, z[1], z[3]); out = out || cx !== nx || cy !== ny; nx = cx; ny = cy; }
      Object.assign(d.u, { x: nx, y: ny, dir: d.dir, _pin: now });
      d.u.from = d.u.to = { x: nx, y: ny, dir: d.dir };
    }
    if (out) v.ui.toast('Hors de la zone de déploiement : l’unité reste à sa lisière.');
    v.cmd('deploy', { units: us.map(u => u.id), x, y, ...(dir != null ? { dir } : {}) });
    this.ping(x, y);
  }
  ping(x, y, col = 'rgba(255,226,150,') { this.pings.push({ x, y, t: performance.now(), col }); }

  // ------------------------------------------------------------------ clavier
  key(e, down) {
    if (!this.v.running || e.target?.closest?.('input, textarea, select')) return;
    const v = this.v, k = e.key;
    this.keys.add(k);
    if (k === ' ') { e.preventDefault(); v.ui.togglePause(); }
    else if (k === '1' || k === '2' || k === '4') v.ui.setSpeed(+k);
    else if (k === 'Escape') { if (this.targeting) this.setTargeting(null); else { v.sel.clear(); v.ui.selChanged(); } }
    else if ((k === 'a' || k === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); v.sel = new Set(v.mine().map(u => u.id)); v.ui.selChanged(); }
    else if (k === 'c' || k === 'C' || k === 'b' || k === 'B') v.ui.act('charge');
    else if (k === 'h' || k === 'H') v.ui.act('hold');
    else if (k === 'f' || k === 'F') v.ui.act('fire');
    else if (k === 'r' || k === 'R') v.ui.act('rally');
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
    // en traçant un ordre près du bord, la vue suit
    const g = this.g;
    if (g && (g.mode === 'order' || g.mode === 'drag-unit' || g.mode === 'order-line' || g.mode === 'box')) {
      const m = 36;
      kx += g.x < m ? -1 : g.x > v.vw - m ? 1 : 0;
      ky += g.y < m + 50 ? -1 : g.y > v.vh - m - 100 ? 1 : 0;
    }
    if (kx || ky) { v.panBy(0, 0, -kx * 520 * dt, -ky * 520 * dt); v.camAnim = null; }
  }

  // ------------------------------------------------------------------ dessin des gestes (écran)
  drawOverlay(ctx, view, time) {
    const v = this.v, g = this.g, now = performance.now();
    // échos d'un ordre
    this.pings = this.pings.filter(p => now - p.t < 700);
    for (const p of this.pings) {
      const k = (now - p.t) / 700, r = (8 + k * 26) / v.cam.z;
      ctx.strokeStyle = p.col + (1 - k) + ')'; ctx.lineWidth = 2.5;
      v.groundPath(ctx, v.arc(p.x, p.y, r, 0, TAU), true); ctx.stroke();
    }
    if (!g) return;
    if (g.mode === 'box') {
      ctx.fillStyle = 'rgba(230,201,127,0.12)'; ctx.strokeStyle = 'rgba(255,226,150,0.95)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(Math.min(g.sx, g.x), Math.min(g.sy, g.y), Math.abs(g.x - g.sx), Math.abs(g.y - g.sy));
      ctx.strokeRect(Math.min(g.sx, g.x), Math.min(g.sy, g.y), Math.abs(g.x - g.sx), Math.abs(g.y - g.sy));
      ctx.setLineDash([]);
      return;
    }
    if (g.mode !== 'order' && g.mode !== 'drag-unit' && g.mode !== 'order-line') return;
    const us = (g.units || []).map(id => v.units.get(id)).filter(Boolean);
    if (!us.length) return;
    const [wx, wy] = v.toWorld(g.x, g.y);
    const c = centroid(us);
    let dest, dir, from;
    if (g.mode === 'order-line') { dest = g.w0; dir = Math.atan2(wy - g.w0[1], wx - g.w0[0]); from = c; }
    else if (g.mode === 'drag-unit') { dest = [c[0] + wx - g.w0[0], c[1] + wy - g.w0[1]]; dir = null; from = c; }
    else { dest = [wx, wy]; dir = Math.atan2(wy - c[1], wx - c[0]); from = c; }
    const tgt = this.hover && v.units.get(this.hover);
    const enemy = tgt && tgt.side !== v.me;
    if (enemy) dest = [tgt.x, tgt.y];
    // flèche courbe : elle part dans le sens où l'unité regarde, puis s'infléchit vers l'arrivée (courbe tracée sur le
    // terrain, puis projetée sur le relief)
    const dw = Math.hypot(dest[0] - from[0], dest[1] - from[1]);
    const md = us.length === 1 ? us[0].dir : Math.atan2(dest[1] - from[1], dest[0] - from[0]);
    const cw = [from[0] + Math.cos(md) * dw * 0.4, from[1] + Math.sin(md) * dw * 0.4];
    const curve = Array.from({ length: 17 }, (_, i) => { const t = i / 16, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; return [a * from[0] + b * cw[0] + c * dest[0], a * from[1] + b * cw[1] + c * dest[1]]; });
    const [ax, ay] = v.toScreen(from[0], from[1]), [bx, by] = v.toScreen(dest[0], dest[1]);
    const d = Math.hypot(bx - ax, by - ay);
    const col = enemy ? (this.targeting === 'charge' || this.targeting === 'vcharge' ? '#ff7a5a' : '#ffae78') : '#ffe29a';
    if (g.mode !== 'drag-unit' && d > 12) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      v.groundPath(ctx, curve);
      ctx.strokeStyle = 'rgba(20,14,8,0.55)'; ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.stroke();
      const [cx, cy] = v.toScreen(curve[14][0], curve[14][1]), ang = Math.atan2(by - cy, bx - cx);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(ang) * 12, by + Math.sin(ang) * 12); ctx.lineTo(bx + Math.cos(ang + 2.4) * 14, by + Math.sin(ang + 2.4) * 14); ctx.lineTo(bx + Math.cos(ang - 2.4) * 14, by + Math.sin(ang - 2.4) * 14); ctx.closePath(); ctx.fill();
    }
    if (enemy) {
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      v.footprint(ctx, tgt.x, tgt.y, tgt.dir, tgt.w, tgt.d, 8); ctx.stroke();
      ctx.font = '600 15px "EB Garamond", Georgia, serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff3d6';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,24,40,0.8)';
      const label = this.targeting === 'charge' ? 'Charger !' : this.targeting === 'vcharge' ? 'Salve, puis baïonnette' : 'Attaquer';
      ctx.strokeText(label, bx, by - 28); ctx.fillText(label, bx, by - 28);
      return;
    }
    // silhouette fantôme de chaque régiment à l'arrivée : orientation et largeur du front
    const ghosts = this.spread(us, dest[0], dest[1], dir).map(dd => {
      const key = dd.u.id;
      g.ghosts = g.ghosts || new Map();
      let gh = g.ghosts.get(key);
      if (!gh) { gh = { ...dd.u, _ghost: true, _lay: null, state: 'repos' }; g.ghosts.set(key, gh); }
      gh.x = dd.x; gh.y = dd.y; gh.dir = dd.dir;
      return gh;
    });
    for (const gh of ghosts) {
      ctx.fillStyle = 'rgba(255,226,150,0.14)'; ctx.strokeStyle = 'rgba(255,226,150,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      const pts = v.footprint(ctx, gh.x, gh.y, gh.dir, gh.w, gh.d, 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#ffe29a'; ctx.lineWidth = 3.5;   // le front
      v.groundPath(ctx, [pts[0], pts[1]]); ctx.stroke();
    }
  }
}

function centroid(us) {
  const n = us.length || 1;
  return [us.reduce((a, u) => a + u.x, 0) / n, us.reduce((a, u) => a + u.y, 0) / n];
}
