// Rendu de la carte illustrée de l'Aquitaine (canvas 2D, coordonnées monde en km)
const TILE = 256;
const LEVELS = [2, 4, 8, 16, 32];
const T = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
const TCOL = {
  0: [62, 118, 182], 1: [74, 139, 208], 2: [150, 194, 82], 3: [86, 140, 62], 4: [176, 174, 104], 5: [118, 160, 128],
  6: [140, 178, 80], 7: [150, 156, 128], 8: [214, 218, 214], 9: [226, 212, 160], 10: [150, 170, 86],
};
const PLAYABLE = ['33', '24', '40', '47', '64'];

function b64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function hash(i, j, k = 0) {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgb(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function lighten(h, t) { return rgb(mix(hexRgb(h), [255, 255, 255], t)); }
function darken(h, t) { return rgb(mix(hexRgb(h), [0, 0, 0], t)); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class MapView {
  constructor(canvas, payload) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    const m = payload.map;
    this.rules = payload.rules;
    this.m = m;
    this.W = m.W; this.H = m.H;
    this.terrain = b64(m.terrain); this.dept = b64(m.dept); this.cellnode = b64(m.cellnode); this.river = b64(m.river);
    this.nodes = m.nodes; this.edges = m.edges;
    this.depts = m.depts; this.deptCodes = m.dept_codes;
    this.cam = { x: m.W / 2, y: m.H / 2, z: 2 };
    this.camAnim = null;
    this.tiles = new Map();
    this.tileOrder = [];
    this.state = null;
    this.owners = null;
    this.ownersKey = '';
    this.selection = null;
    this.disp = new Map();
    this.particles = [];
    this.wx = { cote: [], interieur: [], montagne: [] };
    this.flash = { cote: 0, interieur: 0, montagne: 0 };
    this.season = 'printemps';
    this.highlightDept = null;
    this.fogOn = true;
    try { this.fogOn = localStorage.getItem('conquete.fog') !== '0'; } catch (e) { /* stockage indisponible */ }
    this.colors = {};
    for (const [c, f] of Object.entries(this.rules.factions)) this.colors[c] = f.color;
    this.colors.neutre = this.rules.neutral_color;
    this.playable = new Uint8Array(this.W * this.H);
    for (let c = 0; c < this.W * this.H; c++) {
      const d = this.dept[c];
      this.playable[c] = d > 0 && PLAYABLE.includes(this.deptCodes[d - 1]) && this.terrain[c] > 1 ? 1 : 0;
    }
    this.prepEdges();
    this.buildBases();
    this.buildLandPath();
    this.buildProxy();
    this.buildFieldCells();
    this.fillCanvas = document.createElement('canvas');
    this.fillCanvas.width = this.W; this.fillCanvas.height = this.H;
    this.frontiers = [];
    this.showPreview();
    this.lastFrame = performance.now();
    this.resize();
    for (let ty = 0; ty * 128 < this.H; ty++) for (let tx = 0; tx * 128 < this.W; tx++) this.getTile(2, tx, ty, true);
    this.fitAll(true);
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    requestAnimationFrame(t => this.frame(t));
  }

  // ------------------------------------------------------------------ préparation
  prepEdges() {
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      e.A = [A.x, A.y]; e.B = [B.x, B.y];
      if (e.kind === 'water') {
        // voie d'eau : polyligne le long du fleuve ou de la côte
        e.water = true;
        e.cum = [0];
        for (let i = 1; i < e.pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]));
        e.C = [(A.x + B.x) / 2, (A.y + B.y) / 2];
        continue;
      }
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
      const off = e.rrank ? 0 : (hash(e.a, e.b, 5) - 0.5) * 0.16 * L;
      e.C = [(A.x + B.x) / 2 - dy / L * off, (A.y + B.y) / 2 + dx / L * off];
    }
    // voies navigables découpées en tronçons avec leur emprise : chaque tuile ne trace que ce qui la traverse
    this.wayPaths = [];
    for (const w of this.m.ways || []) {
      for (let i = 0; i < w.pts.length - 1; i += 8) {
        const seg = w.pts.slice(i, i + 9);
        const p = new Path2D();
        seg.forEach((q, k) => k ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]));
        const xs = seg.map(q => q[0]), ys = seg.map(q => q[1]);
        this.wayPaths.push({ sea: w.sea, p, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      }
    }
  }
  waterSeg(e, t) {
    const total = e.cum[e.cum.length - 1] || 1, s = clamp(t, 0, 1) * total;
    let i = 1;
    while (i < e.cum.length - 1 && e.cum[i] < s) i++;
    const seg = (e.cum[i] - e.cum[i - 1]) || 1e-9, f = (s - e.cum[i - 1]) / seg;
    const p = e.pts[i - 1], q = e.pts[i];
    return [[p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], [q[0] - p[0], q[1] - p[1]]];
  }
  edgePoint(e, t) {
    if (e.water) return this.waterSeg(e, t)[0];
    const u = 1 - t;
    return [u * u * e.A[0] + 2 * u * t * e.C[0] + t * t * e.B[0], u * u * e.A[1] + 2 * u * t * e.C[1] + t * t * e.B[1]];
  }
  edgeTangent(e, t) {
    if (e.water) return this.waterSeg(e, t)[1];
    return [2 * (1 - t) * (e.C[0] - e.A[0]) + 2 * t * (e.B[0] - e.C[0]), 2 * (1 - t) * (e.C[1] - e.A[1]) + 2 * t * (e.B[1] - e.C[1])];
  }
  pointFrom(e, frm, f) { return this.edgePoint(e, frm === e.a ? f : 1 - f); }

  buildBases() {
    const W = this.W, H = this.H, N = W * H;
    // distance à la côte côté mer
    const dist = new Int16Array(N).fill(-1);
    const q = [];
    for (let c = 0; c < N; c++) if (this.terrain[c] !== T.OCEAN) { dist[c] = 0; q.push(c); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0, d = dist[c] + 1;
      if (d > 40) continue;
      const nb = [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1];
      for (const n of nb) if (n >= 0 && dist[n] < 0) { dist[n] = d; q.push(n); }
    }
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    this.landCanvas = mk(); this.oceanCanvas = mk(); this.outMask = mk();
    const L = this.landCanvas.getContext('2d').createImageData(W, H);
    const O = this.oceanCanvas.getContext('2d').createImageData(W, H);
    const M = this.outMask.getContext('2d').createImageData(W, H);
    const shallow = [88, 150, 206], deep = [36, 86, 150], sand = [228, 214, 160];
    for (let c = 0; c < N; c++) {
      const i = c % W, j = (c / W) | 0, t = this.terrain[c];
      const n = vnoise(i / 9, j / 9, 3) * 0.6 + vnoise(i / 3, j / 3, 4) * 0.4;
      let col;
      if (t === T.OCEAN) {
        const d = dist[c] < 0 ? 40 : dist[c];
        const oc = mix(shallow, deep, Math.min(1, d / 22));
        O.data.set([oc[0], oc[1], oc[2], 255], c * 4);
        col = d <= 1 ? sand : oc;
      } else {
        col = TCOL[t].slice();
        const k = (n - 0.5) * 0.16;
        col = k > 0 ? mix(col, [255, 250, 220], k) : mix(col, [20, 40, 10], -k);
        if (t === T.EAU) col = TCOL[1];
        O.data.set([shallow[0], shallow[1], shallow[2], 255], c * 4);
      }
      L.data.set([col[0], col[1], col[2], 255], c * 4);
      if (t > T.EAU && !this.playable[c]) M.data.set([44, 42, 36, 120], c * 4);
    }
    this.landCanvas.getContext('2d').putImageData(L, 0, 0);
    this.oceanCanvas.getContext('2d').putImageData(O, 0, 0);
    this.outMask.getContext('2d').putImageData(M, 0, 0);
    // grain de papier
    this.grain = document.createElement('canvas');
    this.grain.width = this.grain.height = 128;
    const gctx = this.grain.getContext('2d');
    const gd = gctx.createImageData(128, 128);
    for (let k = 0; k < 128 * 128; k++) {
      const v = 205 + hash(k, 77) * 50;
      gd.data.set([v, v, v * 0.97, 255], k * 4);
    }
    gctx.putImageData(gd, 0, 0);
  }

  buildLandPath() {
    const p = new Path2D();
    for (const d of Object.values(this.depts)) {
      for (const r of d.rings) {
        p.moveTo(r[0][0], r[0][1]);
        for (let k = 1; k < r.length; k++) p.lineTo(r[k][0], r[k][1]);
        p.closePath();
      }
    }
    p.rect(4, this.m.y_spain, this.W, this.H - this.m.y_spain + 2);
    this.landPath = p;
    this.waterPath = new Path2D();
    for (const w of this.m.waters) {
      const r = w.ring;
      this.waterPath.moveTo(r[0][0], r[0][1]);
      for (let k = 1; k < r.length; k++) this.waterPath.lineTo(r[k][0], r[k][1]);
      this.waterPath.closePath();
    }
    this.deptPaths = {};
    for (const [code, d] of Object.entries(this.depts)) {
      if (!d.playable) continue;
      const pp = new Path2D();
      for (const r of d.rings) {
        pp.moveTo(r[0][0], r[0][1]);
        for (let k = 1; k < r.length; k++) pp.lineTo(r[k][0], r[k][1]);
        pp.closePath();
      }
      this.deptPaths[code] = pp;
    }
    this.riverPaths = this.m.rivers.map(r => {
      const pp = new Path2D();
      pp.moveTo(r.pts[0][0], r.pts[0][1]);
      for (let k = 1; k < r.pts.length; k++) pp.lineTo(r.pts[k][0], r.pts[k][1]);
      return { rank: r.rank, p: pp, name: r.name };
    });
  }

  buildProxy() {
    // chaque cellule non jouable pointe vers la cellule jouable la plus proche (frontières seulement entre camps)
    const W = this.W, H = this.H, N = W * H;
    const proxy = new Int32Array(N).fill(-1);
    const q = [];
    for (let c = 0; c < N; c++) if (this.playable[c] && this.cellnode[c] !== 255) { proxy[c] = c; q.push(c); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0;
      const nb = [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1];
      for (const n of nb) if (n >= 0 && proxy[n] < 0) { proxy[n] = proxy[c]; q.push(n); }
    }
    this.proxy = proxy;
  }

  buildFieldCells() {
    // parcelles cultivées autour des bourgs
    this.fieldAngle = new Float32Array(this.W * this.H).fill(-99);
    for (const n of this.nodes) {
      const r = n.type === 'capitale' ? 5 : n.type === 'ville' ? 4 : 3;
      const ang = hash(n.id, 9) * Math.PI;
      for (let j = Math.floor(n.y - r); j <= n.y + r; j++) {
        for (let i = Math.floor(n.x - r); i <= n.x + r; i++) {
          if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
          const c = j * this.W + i;
          const d = Math.hypot(i + 0.5 - n.x, j + 0.5 - n.y);
          if (d < r && d > 0.6 && (this.terrain[c] === T.PLAINE || this.terrain[c] === T.COLLINES)) this.fieldAngle[c] = ang;
        }
      }
    }
  }

  showPreview() {
    // état initial (avant le choix du département) : chefs-lieux et villes à leur département
    this.state = null;
    this.disp.clear();
    this.preview = { nodes: this.nodes.map(n => ({ id: n.id, o: (n.type === 'capitale' || n.type === 'ville') ? n.dept : 'neutre', f: n.fort, d: 0 })),
                     me: { code: null }, armies: [], battles: [] };
    this.owners = this.preview.nodes.map(n => n.o);
    this.ownersKey = '';
    this.rebuildTerritory();
  }

  // ------------------------------------------------------------------ caméra
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.vw = w; this.vh = h;
  }
  minZoom() { return Math.min(this.vw / this.W, this.vh / this.H) * 0.8; }

  armyScreen(d) {
    let [x, y] = this.toScreen(d.x, d.y);
    const a = d.a;
    if (a && a.n != null && a.st !== 'battle') {
      const n = this.nodes[a.n];
      const s = this.nodeSize(n);
      const z = this.cam.z;
      const k = d.slot || 0;
      y += s * 0.5 + (z >= 5.5 ? clamp(z * 2.3, 22, 66) * 0.5 + 18 : 22);
      x += (k - (d.slots - 1) / 2) * (z >= 5.5 ? Math.min(6, d.a.regs.length) * clamp(z * 2.3, 22, 66) * 1.25 + 20 : 56);
    }
    return [x, y];
  }
  fitAll(instant, left = 0, top = 60) {
    const aw = this.vw - left, ah = this.vh - top;
    const z = Math.min(aw / this.W, ah / this.H) * 0.96;
    const cx = this.W / 2 - (left / 2) / z, cy = this.H / 2 - (top / 2) / z + 4;
    this.moveTo(cx, cy, z, instant);
  }
  moveTo(x, y, z, instant = false) {
    z = clamp(z ?? this.cam.z, this.minZoom(), 26);
    if (instant) { this.cam = { x, y, z }; this.camAnim = null; return; }
    this.camAnim = { from: { ...this.cam }, to: { x, y, z }, t0: performance.now(), dur: 650 };
  }
  toScreen(x, y) { return [(x - this.cam.x) * this.cam.z + this.vw / 2, (y - this.cam.y) * this.cam.z + this.vh / 2]; }
  toWorld(sx, sy) { return [(sx - this.vw / 2) / this.cam.z + this.cam.x, (sy - this.vh / 2) / this.cam.z + this.cam.y]; }
  clampCam() {
    const c = this.cam;
    c.z = clamp(c.z, this.minZoom(), 26);
    const mx = this.vw / 2 / c.z, my = this.vh / 2 / c.z;
    c.x = clamp(c.x, Math.min(mx - 30, this.W / 2), Math.max(this.W - mx + 30, this.W / 2));
    c.y = clamp(c.y, Math.min(my - 40, this.H / 2), Math.max(this.H - my + 30, this.H / 2));
  }

  // ------------------------------------------------------------------ entrées
  bindInput() {
    // Gestes unifiés souris / doigt / stylet (Pointer Events)
    //  appui court : sélection          double appui : zoom avant      appui à deux doigts : zoom arrière
    //  glisser : déplacer la carte (avec élan)   pincer : zoomer
    //  glisser depuis une de vos armées : tracer son itinéraire
    //  appui long (ou clic droit) : envoyer l'armée sélectionnée à cet endroit
    const cv = this.cv;
    const pts = new Map();
    let g = null, lastTap = null, lastPen = -1e9;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const info = (sx, sy, type) => { const [x, y] = this.toWorld(sx, sy); return { x, y, sx, sy, type, hit: this.hitTest(sx, sy, type) }; };
    const vib = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* rien */ } };
    const clearLong = () => { if (g && g.longT) { clearTimeout(g.longT); g.longT = null; } };

    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (g && g.type && g.type !== 'mouse') return;
      const [sx, sy] = pos(e);
      this.onContext && this.onContext(info(sx, sy, 'mouse'));
    });

    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const now = performance.now();
      if (e.pointerType === 'pen') lastPen = now;
      else if (e.pointerType === 'touch' && now - lastPen < 900) return; // paume posée pendant l'usage du stylet
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* pointeur synthétique */ }
      const [sx, sy] = pos(e);
      pts.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });
      this.camAnim = null;
      this.inertia = null;
      if (pts.size === 1) {
        const hit = this.hitTest(sx, sy, e.pointerType);
        const dragArmy = hit && hit.kind === 'army' && this.canDragArmy && this.canDragArmy(hit.id) ? hit.id : null;
        g = { kind: 'press', sx, sy, t0: now, type: e.pointerType, cx: this.cam.x, cy: this.cam.y, moved: false, dragArmy,
              samples: [[now, sx, sy]] };
        g.longT = setTimeout(() => {
          if (g && g.kind === 'press' && !g.moved) {
            g.kind = 'long';
            vib(18);
            this.onLongPress && this.onLongPress(info(g.sx, g.sy, g.type));
          }
        }, 520);
      } else if (pts.size === 2) {
        clearLong();
        const [a, b] = [...pts.values()];
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        g = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.cam.z, w: this.toWorld(mid[0], mid[1]),
              mid0: mid, t0: now, moved: false, type: 'touch' };
        this.dragTrail = null;
        this.onGesture && this.onGesture();
      }
    });

    cv.addEventListener('pointermove', e => {
      const [sx, sy] = pos(e);
      if (!pts.has(e.pointerId)) {
        // survol : souris, ou stylet qui approche de l'écran (Apple Pencil, stylets Android)
        if (e.pointerType === 'pen') lastPen = performance.now();
        if (e.pointerType !== 'touch') { this.hover = [sx, sy]; this.hoverType = e.pointerType; }
        return;
      }
      const p = pts.get(e.pointerId);
      p.x = sx; p.y = sy;
      if (!g) return;
      if (g.kind === 'pinch') {
        if (pts.size < 2) return;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        if (Math.abs(d - g.d0) > 12 || Math.hypot(mid[0] - g.mid0[0], mid[1] - g.mid0[1]) > 12) g.moved = true;
        this.cam.z = clamp(g.z0 * d / g.d0, this.minZoom(), 26);
        this.cam.x = g.w[0] - (mid[0] - this.vw / 2) / this.cam.z;
        this.cam.y = g.w[1] - (mid[1] - this.vh / 2) / this.cam.z;
        this.clampCam();
        return;
      }
      if (g.kind === 'long') return;
      const dx = sx - g.sx, dy = sy - g.sy;
      if (g.kind === 'twotap') {
        if (Math.hypot(dx, dy) > 10) { g.kind = 'pan'; g.moved = true; g.cx = this.cam.x - dx / this.cam.z; g.cy = this.cam.y - dy / this.cam.z; }
        else return;
      }
      const thr = g.type === 'mouse' ? 5 : g.type === 'pen' ? 6 : 10;
      if (!g.moved && Math.hypot(dx, dy) > thr) {
        g.moved = true;
        clearLong();
        if (g.dragArmy) {
          g.kind = 'route';
          this.dragTrail = { army: g.dragArmy, pts: [this.toWorld(g.sx, g.sy)], end: [sx, sy], hit: null, type: g.type };
          this.onGesture && this.onGesture();
        } else {
          g.kind = 'pan';
          cv.classList.add('dragging');
          this.onGesture && this.onGesture();
        }
      }
      if (g.kind === 'pan') {
        this.cam.x = g.cx - dx / this.cam.z;
        this.cam.y = g.cy - dy / this.cam.z;
        this.clampCam();
        g.samples.push([performance.now(), sx, sy]);
        if (g.samples.length > 6) g.samples.shift();
      } else if (g.kind === 'route') {
        const w = this.toWorld(sx, sy);
        const tr = this.dragTrail.pts, last = tr[tr.length - 1];
        if (Math.hypot(w[0] - last[0], w[1] - last[1]) * this.cam.z > 7) tr.push(w);
        this.dragTrail.end = [sx, sy];
        this.dragTrail.hit = this.hitTest(sx, sy, g.type);
      }
    });

    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const [sx, sy] = pos(e);
      pts.delete(e.pointerId);
      cv.classList.remove('dragging');
      if (!g) return;
      const now = performance.now();
      const cancel = e.type === 'pointercancel';
      if (g.kind === 'pinch') {
        if (pts.size === 2) {
          // trois doigts -> deux : on repart des deux restants pour que le zoom ne saute pas
          const [a, b] = [...pts.values()];
          const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
          Object.assign(g, { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.cam.z, w: this.toWorld(mid[0], mid[1]), mid0: mid });
        } else if (pts.size === 1) {
          const [p] = [...pts.values()];
          const quick = !g.moved && now - g.t0 < 300;
          g = { kind: quick ? 'twotap' : 'pan', sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y, moved: !quick, type: 'touch',
                samples: [[now, p.x, p.y]], t0: g.t0, mid0: g.mid0 };
        } else if (pts.size === 0) {
          if (!g.moved && now - g.t0 < 300 && !cancel) this.zoomAt(g.mid0[0], g.mid0[1], 1 / 1.8);
          g = null;
        }
        return;
      }
      if (pts.size > 0) return;
      clearLong();
      if (g.kind === 'twotap') {
        if (!cancel && now - g.t0 < 450) this.zoomAt(g.mid0[0], g.mid0[1], 1 / 1.8);
        g = null;
        return;
      }
      if (g.kind === 'press' && !cancel) {
        const ev = info(sx, sy, g.type);
        if (lastTap && now - lastTap.t < 330 && Math.hypot(sx - lastTap.sx, sy - lastTap.sy) < 36) {
          lastTap = null;
          this.onDoubleTap && this.onDoubleTap(ev);
          this.zoomAt(sx, sy, 1.9);
        } else {
          lastTap = { t: now, sx, sy };
          this.onTap && this.onTap(ev);
        }
      } else if (g.kind === 'pan') {
        const s = g.samples;
        if (s.length >= 2 && g.type !== 'mouse') {
          const a = s[0], b = s[s.length - 1], dts = (b[0] - a[0]) / 1000;
          if (dts > 0 && now - b[0] < 140) {
            const vx = (b[1] - a[1]) / dts, vy = (b[2] - a[2]) / dts;
            if (Math.hypot(vx, vy) > 300) this.inertia = { vx, vy };
          }
        }
      } else if (g.kind === 'route') {
        const tr = this.dragTrail;
        this.dragTrail = null;
        if (tr && !cancel) {
          tr.pts.push(this.toWorld(sx, sy));
          this.onDragOrder && this.onDragOrder({ army: tr.army, trail: tr.pts, end: info(sx, sy, g.type), type: g.type });
        }
      }
      g = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', e => { if (!pts.has(e.pointerId)) this.hover = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.camAnim = null;
      this.inertia = null;
      const [sx, sy] = pos(e);
      const w = this.toWorld(sx, sy);
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      this.cam.z = clamp(this.cam.z * f, this.minZoom(), 26);
      this.cam.x = w[0] - (sx - this.vw / 2) / this.cam.z;
      this.cam.y = w[1] - (sy - this.vh / 2) / this.cam.z;
      this.clampCam();
    }, { passive: false });
  }

  zoomBy(f) {
    this.moveTo(this.cam.x, this.cam.y, this.cam.z * f);
  }

  zoomAt(sx, sy, f) {
    const w = this.toWorld(sx, sy);
    const z = clamp(this.cam.z * f, this.minZoom(), 26);
    this.moveTo(w[0] - (sx - this.vw / 2) / z, w[1] - (sy - this.vh / 2) / z, z);
  }

  // opt.skipArmy(a) : ignore ces armées (ordre de marche : ses propres jetons ne doivent pas masquer la ville dessous)
  hitTest(sx, sy, type = 'mouse', opt = {}) {
    const z = this.cam.z;
    const pad = type === 'touch' ? 12 : type === 'pen' ? 3 : 0;
    let best = null;
    const st = this.state || this.preview;
    for (const a of st.armies) {
      const d = this.disp.get(a.id);
      if (!d || (opt.skipArmy && opt.skipArmy(a))) continue;
      const [x, y] = this.armyScreen(d);
      const r = (z >= 5.5 ? Math.max(20, z * 2.4) : 22) + pad;
      const dd = Math.hypot(sx - x, sy - y);
      if (dd < r && (!best || dd < best.d)) best = { kind: 'army', id: a.id, d: dd };
    }
    if (best) return best;
    for (const b of st.battles) {
      const [x, y] = this.toScreen(b.x, b.y);
      const dd = Math.hypot(sx - x, sy - y - 26);
      if (dd < 20 + pad && b.node == null) return { kind: 'battle', id: b.id };
    }
    for (const n of this.nodes) {
      const [x, y] = this.toScreen(n.x, n.y);
      const r = this.nodeSize(n) / 2 + 7 + pad;
      const dd = Math.hypot(sx - x, sy - y);
      if (dd < r && (!best || dd < best.d)) best = { kind: 'node', id: n.id, d: dd };
    }
    return best;
  }

  // tracé en cours (glisser depuis une armée) et carte de survol
  drawGesture(ctx) {
    const tr = this.dragTrail;
    if (tr) {
      const d = this.disp.get(tr.army);
      const sp = tr.pts.map(p => this.toScreen(p[0], p[1]));
      if (d) sp[0] = this.armyScreen(d);
      sp.push(tr.end);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); sp.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = 'rgba(19,35,58,0.75)'; ctx.lineWidth = 8; ctx.stroke();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = '#bfe39a'; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash([]);
      const [ex, ey] = tr.end;
      if (tr.hit && tr.hit.kind === 'node') {
        const n = this.nodes[tr.hit.id];
        const [nx, ny] = this.toScreen(n.x, n.y);
        ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(nx, ny, this.nodeSize(n) * 0.7 + 8, 0, Math.PI * 2); ctx.stroke();
        this.hoverCard(ctx, nx, ny - this.nodeSize(n) * 0.7 - 14, [n.name], true);
      } else {
        ctx.fillStyle = '#bfe39a';
        ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#13233a'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (!this.hover || this.hoverType === 'touch') return;
    const [hx, hy] = this.hover;
    const hit = this.hitTest(hx, hy, this.hoverType);
    if (!hit) return;
    const st = this.state || this.preview;
    const F = this.rules.factions;
    const own = c => c === 'neutre' ? 'indépendant' : (F[c] ? F[c].name : c);
    let lines = null;
    if (hit.kind === 'node') {
      const n = this.nodes[hit.id], ns = st.nodes[hit.id];
      const t = { capitale: 'Chef-lieu', ville: 'Ville', village: 'Village', fort: 'Place forte' }[n.type];
      const men = ns.m != null ? ns.m + (ns.g ? ns.g.reduce((s, r) => s + r[2], 0) : (ns.gm || 0)) : null;
      lines = [n.name, `${t}, ${own(ns.o)}`];
      if (men != null) lines.push(`Défenseurs : ${fmtMen(men)}`);
      if (ns.sg) lines.push(`Siège : ${Math.round(ns.sg.dmg * 100)} %`);
    } else if (hit.kind === 'army') {
      const a = st.armies.find(x => x.id === hit.id);
      if (a) lines = [a.name, `${own(a.o)}, ${fmtMen(a.men)} hommes`];
    } else if (hit.kind === 'battle') {
      const b = st.battles.find(x => x.id === hit.id);
      if (b) lines = [b.amb ? 'Embuscade' : 'Bataille', `${fmtMen(b.sides[0].men)} contre ${fmtMen(b.sides[1].men)}`];
    }
    if (lines) this.hoverCard(ctx, hx + 16, hy + 22, lines, false);
  }

  hoverCard(ctx, x, y, lines, centered) {
    ctx.save();
    ctx.font = '600 14px "EB Garamond", Georgia, serif';
    const w = Math.max(...lines.map((l, i) => { ctx.font = `${i ? 400 : 600} 14px "EB Garamond", Georgia, serif`; return ctx.measureText(l).width; })) + 18;
    const h = lines.length * 18 + 10;
    let bx = centered ? x - w / 2 : x, by = centered ? y - h : y;
    bx = clamp(bx, 6, this.vw - w - 6);
    by = clamp(by, 6, this.vh - h - 6);
    ctx.fillStyle = 'rgba(12,24,40,0.94)';
    roundRect(ctx, bx, by, w, h, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(200,162,83,0.7)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = `${i ? 400 : 600} 14px "EB Garamond", Georgia, serif`;
      ctx.fillStyle = i ? '#c9c0a8' : '#f1ead8';
      ctx.fillText(l, bx + 9, by + 6 + i * 18);
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------ état serveur
  setState(st) {
    const prev = this.state;
    this.state = st;
    // la neige des sommets est peinte dans les tuiles : on les repeint en entrant ou en sortant de l'hiver
    if ((st.season === 'hiver') !== (this.season === 'hiver')) this.invalidateTiles();
    this.season = st.season;
    const key = st.nodes.map(n => n.o).join(',');
    if (key !== this.ownersKey) {
      this.ownersKey = key;
      this.owners = st.nodes.map(n => n.o);
      this.rebuildTerritory();
    }
    // pertes en bataille -> chiffres flottants
    const prevB = new Map((prev?.battles || []).map(b => [b.id, b]));
    for (const b of st.battles) {
      const pb = prevB.get(b.id);
      for (let i = 0; i < 2; i++) {
        const lost = b.sides[i].lost - (pb ? pb.sides[i].lost : 0);
        if (lost >= 3) {
          this.particles.push({ type: 'num', x: b.x + (i ? 0.9 : -0.9) + (Math.random() - 0.5), y: b.y - 0.6, life: 0, max: 1.4,
                                text: `−${Math.round(lost)}`, color: this.colors[b.sides[i].o] || '#ddd' });
        }
      }
    }
    // en bataille, chaque armée fait face à l'ennemi
    const byId = new Map(st.armies.map(a => [a.id, a]));
    const face = new Map();
    for (const b of st.battles) {
      const cen = b.sides.map(s => {
        const arr = s.armies.map(id => byId.get(id)).filter(Boolean);
        if (!arr.length) return null;
        return [arr.reduce((t, a) => t + a.x, 0) / arr.length, arr.reduce((t, a) => t + a.y, 0) / arr.length];
      });
      b.sides.forEach((s, i) => {
        for (const id of s.armies) {
          const a = byId.get(id);
          if (!a) continue;
          let tgt = cen[1 - i] || [b.x, b.y];
          if (Math.hypot(tgt[0] - a.x, tgt[1] - a.y) < 0.05) tgt = [b.x + (i ? -1 : 1), b.y];
          face.set(id, Math.atan2(tgt[1] - a.y, tgt[0] - a.x));
        }
      });
    }
    const seen = new Set();
    for (const a of st.armies) {
      seen.add(a.id);
      let tx = a.x, ty = a.y, head = null;
      if (a.e) {
        const e = this.edges[a.e[0]];
        [tx, ty] = this.pointFrom(e, a.e[1], a.e[2]);
        const t = a.e[1] === e.a ? a.e[2] : 1 - a.e[2];
        const tg = this.edgeTangent(e, t);
        head = Math.atan2(tg[1], tg[0]) + (a.e[1] === e.a ? 0 : Math.PI);
      } else if (a.path && a.path.length) {
        const leg = a.path[0];
        if (leg.pts && leg.pts.length > 1) head = Math.atan2(leg.pts[1][1] - a.y, leg.pts[1][0] - a.x);
        else if (leg.e != null) {
          const e = this.edges[leg.e];
          const p0 = this.pointFrom(e, leg.frm, 0.02);
          head = Math.atan2(p0[1] - a.y, p0[0] - a.x);
        }
      }
      if (face.has(a.id)) head = face.get(a.id);  // en bataille : face à l'ennemi
      let d = this.disp.get(a.id);
      if (!d) {
        d = { x: tx, y: ty, tx, ty, head: head ?? -Math.PI / 2 };
        this.disp.set(a.id, d);
      } else {
        if (head == null && Math.hypot(tx - d.tx, ty - d.ty) > 0.05) head = Math.atan2(ty - d.ty, tx - d.tx);
        d.tx = tx; d.ty = ty;
        if (Math.hypot(d.x - tx, d.y - ty) > 25) { d.x = tx; d.y = ty; }
      }
      if (head != null) d.thead = head;
      d.a = a;
    }
    for (const id of [...this.disp.keys()]) if (!seen.has(id)) this.disp.delete(id);
    for (const z of Object.keys(this.wx)) {
      const kind = st.weather[z]?.kind;
      if (this.wx[z].kind !== kind) this.wx[z] = Object.assign([], { kind });
    }
  }

  rebuildTerritory() {
    const W = this.W, H = this.H, N = W * H;
    const own = new Array(N);
    const codes = Object.keys(this.rules.factions);
    const idx = new Int8Array(N).fill(-1);
    for (let c = 0; c < N; c++) {
      const p = this.proxy[c];
      if (p < 0) continue;
      const o = this.owners[this.cellnode[p]];
      idx[c] = codes.indexOf(o);
    }
    // remplissage
    const fctx = this.fillCanvas.getContext('2d');
    const img = fctx.createImageData(W, H);
    const cols = codes.map(c => hexRgb(this.colors[c]));
    for (let c = 0; c < N; c++) {
      if (!this.playable[c] || idx[c] < 0) continue;
      const k = cols[idx[c]];
      img.data.set([k[0], k[1], k[2], 62], c * 4);
    }
    fctx.putImageData(img, 0, 0);
    // frontières (carrés marchants sur un champ lissé)
    this.frontiers = [];
    const f = new Float32Array(N), g = new Float32Array(N);
    for (let ci = 0; ci < codes.length; ci++) {
      let any = false;
      for (let c = 0; c < N; c++) { f[c] = idx[c] === ci ? 1 : 0; if (f[c]) any = true; }
      if (!any) continue;
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          let s = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < W && jj < H) { s += f[jj * W + ii]; n++; }
          }
          g[j * W + i] = s / n;
        }
        f.set(g);
      }
      const path = new Path2D();
      const L = 0.5;
      for (let j = 0; j < H - 1; j++) {
        for (let i = 0; i < W - 1; i++) {
          const a = f[j * W + i], b = f[j * W + i + 1], c = f[(j + 1) * W + i + 1], d = f[(j + 1) * W + i];
          const id = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
          if (id === 0 || id === 15) continue;
          const x = i + 0.5, y = j + 0.5;
          const top = () => [x + (L - a) / (b - a), y];
          const right = () => [x + 1, y + (L - b) / (c - b)];
          const bottom = () => [x + (L - d) / (c - d), y + 1];
          const left = () => [x, y + (L - a) / (d - a)];
          const pc = j * W + i;
          if (!this.playable[pc] && !this.playable[pc + 1] && !this.playable[pc + W] && !this.playable[pc + W + 1]) continue;
          const seg = (p, q) => { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); };
          switch (id) {
            case 1: case 14: seg(left(), bottom()); break;
            case 2: case 13: seg(bottom(), right()); break;
            case 3: case 12: seg(left(), right()); break;
            case 4: case 11: seg(top(), right()); break;
            case 5: seg(left(), top()); seg(bottom(), right()); break;
            case 6: case 9: seg(top(), bottom()); break;
            case 7: case 8: seg(left(), top()); break;
            case 10: seg(top(), right()); seg(left(), bottom()); break;
          }
        }
      }
      this.frontiers.push({ code: codes[ci], path });
    }
  }

  // ------------------------------------------------------------------ tuiles
  level() {
    const want = this.cam.z * this.dpr;
    for (const L of LEVELS) if (L >= want * 0.85) return L;
    return LEVELS[LEVELS.length - 1];
  }

  getTile(L, tx, ty, allowRender) {
    const key = `${L}:${tx}:${ty}`;
    let t = this.tiles.get(key);
    if (t) return t;
    if (!allowRender) return null;
    t = this.renderTile(L, tx, ty);
    this.tiles.set(key, t);
    this.tileOrder.push(key);
    if (this.tileOrder.length > 140) {
      const old = this.tileOrder.shift();
      this.tiles.delete(old);
    }
    return t;
  }

  invalidateTiles() { this.tiles.clear(); this.tileOrder = []; }

  drawSub(g, img, x0, y0, span) {
    // dessine la portion [x0, x0+span] de l'image (1 px = 1 km) sur la tuile, en restant dans les bornes
    const sx = Math.max(0, x0), sy = Math.max(0, y0);
    const ex = Math.min(img.width, x0 + span), ey = Math.min(img.height, y0 + span);
    if (ex <= sx || ey <= sy) return;
    const k = TILE / span;
    g.drawImage(img, sx, sy, ex - sx, ey - sy, (sx - x0) * k, (sy - y0) * k, (ex - sx) * k, (ey - sy) * k);
  }

  renderTile(L, tx, ty) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = TILE;
    const g = cv.getContext('2d');
    const span = TILE / L, x0 = tx * span, y0 = ty * span;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#2b5c99';
    g.fillRect(0, 0, TILE, TILE);
    this.drawSub(g, this.oceanCanvas, x0, y0, span);
    const W = (px) => g.setTransform(L, 0, 0, L, -x0 * L, -y0 * L);
    W();
    const i0 = Math.max(0, Math.floor(x0) - 2), i1 = Math.min(this.W - 1, Math.ceil(x0 + span) + 2);
    const j0 = Math.max(0, Math.floor(y0) - 2), j1 = Math.min(this.H - 1, Math.ceil(y0 + span) + 2);
    // vagues
    if (L >= 4) {
      g.strokeStyle = 'rgba(220,240,255,0.32)';
      g.lineWidth = Math.max(0.07, 0.8 / L);
      g.beginPath();
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * this.W + i;
        if (this.terrain[c] !== T.OCEAN) continue;
        if (hash(i, j, 31) < 0.22) {
          const x = i + hash(i, j, 32), y = j + hash(i, j, 33);
          g.moveTo(x - 0.35, y); g.quadraticCurveTo(x - 0.17, y - 0.16, x, y); g.quadraticCurveTo(x + 0.17, y - 0.16, x + 0.35, y);
        }
      }
      g.stroke();
    }
    // terres
    g.save();
    g.clip(this.landPath, 'nonzero');
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSub(g, this.landCanvas, x0, y0, span);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.45;
    const pat = g.createPattern(this.grain, 'repeat');
    g.fillStyle = pat;
    g.fillRect(0, 0, TILE, TILE);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    W();
    if (L >= 4) this.decorate(g, L, i0, i1, j0, j1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSub(g, this.outMask, x0, y0, span);
    W();
    g.restore();
    W();
    // eaux intérieures
    g.fillStyle = '#4a8bd0';
    g.fill(this.waterPath);
    g.strokeStyle = '#2d5d98';
    g.lineWidth = Math.max(0.12, 1 / L);
    g.stroke(this.waterPath);
    // rivières
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of this.riverPaths) {
      const w = r.rank === 1 ? 0.75 : r.rank === 2 ? 0.42 : 0.26;
      const mn = r.rank === 1 ? 3.2 : r.rank === 2 ? 2.1 : 1.3;
      const ww = Math.max(w, mn / L);
      g.strokeStyle = '#2b5c97'; g.lineWidth = ww + 1.6 / L; g.stroke(r.p);
      g.strokeStyle = '#5c9ee0'; g.lineWidth = ww; g.stroke(r.p);
      if (L >= 8) { g.strokeStyle = 'rgba(178,215,246,0.7)'; g.lineWidth = ww * 0.28; g.stroke(r.p); }
    }
    // voies navigables (fleuves à gabares) et route du cabotage
    for (const w of this.wayPaths) {
      const bx = w.box;
      if (bx[2] < x0 - 1 || bx[0] > x0 + span + 1 || bx[3] < y0 - 1 || bx[1] > y0 + span + 1) continue;
      if (w.sea) {
        g.strokeStyle = 'rgba(235,246,255,0.55)';
        g.lineWidth = Math.max(0.12, 1.1 / L);
        const d = Math.max(0.6, 5 / L);
        g.setLineDash([d * 0.5, d]);
      } else {
        if (L < 4) continue;
        g.strokeStyle = 'rgba(232,244,255,0.75)';
        g.lineWidth = Math.max(0.08, 0.9 / L);
        const d = Math.max(0.5, 4 / L);
        g.setLineDash([d * 1.4, d]);
      }
      g.stroke(w.p);
    }
    g.setLineDash([]);
    // limites des départements
    g.save();
    g.strokeStyle = 'rgba(62,44,24,0.55)';
    g.lineWidth = Math.max(0.16, 1.3 / L);
    const dl = Math.max(0.8, 6 / L);
    g.setLineDash([dl, dl * 0.7]);
    for (const p of Object.values(this.deptPaths)) g.stroke(p);
    g.restore();
    // routes
    this.drawRoads(g, L, x0, y0, span);
    return cv;
  }

  drawRoads(g, L, x0, y0, span) {
    const vis = e => {
      const minx = Math.min(e.A[0], e.B[0], e.C[0]), maxx = Math.max(e.A[0], e.B[0], e.C[0]);
      const miny = Math.min(e.A[1], e.B[1], e.C[1]), maxy = Math.max(e.A[1], e.B[1], e.C[1]);
      return maxx > x0 - 1 && minx < x0 + span + 1 && maxy > y0 - 1 && miny < y0 + span + 1;
    };
    const es = this.edges.filter(e => !e.water && vis(e));
    g.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (const e of es) {
        const royal = e.royal;
        let w = royal ? 0.5 : 0.3;
        w = Math.max(w, (royal ? 2.4 : 1.4) / L);
        if (pass === 0) { g.strokeStyle = royal ? '#8a5c3d' : 'rgba(128,86,58,0.85)'; g.lineWidth = w + 1.3 / L; }
        else { g.strokeStyle = royal ? '#e2b48a' : '#d4a97f'; g.lineWidth = w; }
        g.globalAlpha = royal || L >= 8 ? 1 : 0.6;
        if (e.ferry) { g.setLineDash([w * 2, w * 1.6]); } else g.setLineDash([]);
        g.beginPath();
        g.moveTo(e.A[0], e.A[1]);
        g.quadraticCurveTo(e.C[0], e.C[1], e.B[0], e.B[1]);
        g.stroke();
      }
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    // ponts et bacs
    for (const e of es) {
      if (e.cx == null) continue;
      const dx = e.B[0] - e.A[0], dy = e.B[1] - e.A[1], Ld = Math.hypot(dx, dy) || 1;
      const ux = dx / Ld, uy = dy / Ld;
      const len = Math.max(e.rrank === 1 ? 1.2 : 0.8, 7 / L), wid = Math.max(0.5, 3.2 / L);
      g.save();
      g.translate(e.cx, e.cy);
      g.rotate(Math.atan2(uy, ux));
      if (e.ferry) {
        g.fillStyle = '#6b4a2e';
        g.beginPath(); g.ellipse(0, 0, len * 0.45, wid * 0.4, 0, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#4a3320';
        g.fillRect(-len / 2 - 0.05, -wid / 2 - 0.08, len + 0.1, wid + 0.16);
        g.fillStyle = '#b48656';
        g.fillRect(-len / 2, -wid / 2, len, wid);
        if (L >= 8) {
          g.strokeStyle = 'rgba(60,40,22,0.7)'; g.lineWidth = 0.6 / L;
          g.beginPath();
          for (let s = -len / 2 + len / 7; s < len / 2; s += len / 7) { g.moveTo(s, -wid / 2); g.lineTo(s, wid / 2); }
          g.stroke();
        }
      }
      g.restore();
    }
  }

  decorate(g, L, i0, i1, j0, j1) {
    const W = this.W;
    const big = L >= 8;
    const trees = { sh: new Path2D(), c: [new Path2D(), new Path2D(), new Path2D()], hi: new Path2D() };
    const pines = new Path2D();
    const shrubs = [new Path2D(), new Path2D()];
    const pools = new Path2D();
    const reeds = new Path2D();
    const vines = new Path2D();
    const dunes = new Path2D();
    const hillL = new Path2D(), hillD = new Path2D();
    const peaks = [];
    const fields = [];
    const circle = (p, x, y, r) => { p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2); };
    const treeSc = L >= 16 ? 1 : L >= 8 ? 1.25 : 1.9;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * W + i;
        const t = this.terrain[c];
        if (t <= T.EAU) continue;
        const h = (k) => hash(i, j, k);
        if (t === T.FORET) {
          const n = L >= 16 ? 5 : L >= 8 ? 3 : 2;
          for (let k = 0; k < n; k++) {
            const x = i + h(k * 3 + 1), y = j + h(k * 3 + 2), r = (0.26 + h(k * 3 + 3) * 0.14) * treeSc;
            trees.sh.moveTo(x + r * 0.45 + r, y + r * 0.5); trees.sh.ellipse(x + r * 0.45, y + r * 0.5, r, r * 0.62, 0, 0, Math.PI * 2);
            circle(trees.c[(h(k + 40) * 3) | 0], x, y, r);
            if (big) circle(trees.hi, x - r * 0.32, y - r * 0.34, r * 0.42);
          }
        } else if (t === T.LANDE) {
          if (big) for (let k = 0; k < 4; k++) circle(shrubs[k & 1], i + h(k + 1), j + h(k + 6), 0.09 + h(k + 11) * 0.05);
          if (h(20) < 0.35) {
            const x = i + h(21), y = j + h(22), r = 0.22 * treeSc;
            trees.sh.moveTo(x + r * 1.4, y + r * 0.5); trees.sh.ellipse(x + r * 0.4, y + r * 0.5, r, r * 0.6, 0, 0, Math.PI * 2);
            circle(pines, x, y, r);
          }
        } else if (t === T.MARAIS) {
          if (h(1) < 0.6) {
            const x = i + h(2), y = j + h(3);
            pools.moveTo(x + 0.34, y); pools.ellipse(x, y, 0.34, 0.16, h(4) * 0.6, 0, Math.PI * 2);
          }
          if (big) for (let k = 0; k < 3; k++) {
            const x = i + h(k + 10), y = j + h(k + 14);
            reeds.moveTo(x, y); reeds.lineTo(x - 0.04, y - 0.22); reeds.moveTo(x + 0.06, y); reeds.lineTo(x + 0.1, y - 0.2);
          }
        } else if (t === T.COLLINES) {
          if (h(1) < 0.32) {
            const x = i + h(2), y = j + h(3), r = 0.6 + h(4) * 0.4;
            hillL.moveTo(x - r, y); hillL.quadraticCurveTo(x - r * 0.5, y - r * 0.75, x, y - r * 0.55);
            hillD.moveTo(x, y - r * 0.55); hillD.quadraticCurveTo(x + r * 0.5, y - r * 0.4, x + r, y);
          }
        } else if (t === T.MONTAGNE || t === T.HAUTE) {
          if (h(1) < (t === T.HAUTE ? 0.9 : 0.62)) peaks.push([i + h(2), j + h(3) + 0.4, (t === T.HAUTE ? 1.25 : 0.85) + h(4) * 0.55, t === T.HAUTE]);
        } else if (t === T.VIGNE) {
          if (L >= 8) {
            const ang = 0.45;
            for (let r = 0; r < 4; r++) {
              const y = j + 0.15 + r * 0.24;
              for (let k = 0; k < 5; k++) {
                const x = i + 0.08 + k * 0.2 + (r % 2) * 0.1;
                vines.moveTo(x + 0.055, y + (x - i) * ang * 0.1); vines.arc(x, y + (x - i) * ang * 0.1, 0.055, 0, Math.PI * 2);
              }
            }
          }
        } else if (t === T.DUNES) {
          if (h(1) < 0.7) {
            const x = i + h(2) * 0.6, y = j + h(3);
            dunes.moveTo(x, y); dunes.quadraticCurveTo(x + 0.2, y - 0.18, x + 0.4, y); dunes.quadraticCurveTo(x + 0.6, y + 0.18, x + 0.8, y);
          }
        }
        if ((t === T.PLAINE || t === T.COLLINES) && this.fieldAngle[c] > -50 && L >= 8) {
          const n = 2;
          for (let k = 0; k < n; k++) {
            if (h(60 + k) < 0.25) continue;
            fields.push([i + h(61 + k * 4), j + h(62 + k * 4), 0.45 + h(63 + k * 4) * 0.35, 0.3 + h(64 + k * 4) * 0.25,
                         this.fieldAngle[c], (h(70 + k) * 5) | 0]);
          }
        } else if (t === T.PLAINE && h(50) < 0.05) {
          const x = i + h(51), y = j + h(52), r = 0.2 * treeSc;
          trees.sh.moveTo(x + r * 1.4, y + r * 0.5); trees.sh.ellipse(x + r * 0.4, y + r * 0.5, r, r * 0.6, 0, 0, Math.PI * 2);
          circle(trees.c[1], x, y, r);
        }
      }
    }
    // parcelles
    const fcol = ['#d9c56e', '#c7a95a', '#a3c45a', '#b98f5f', '#e1d28c'];
    for (const [x, y, w, hgt, ang, ci] of fields) {
      g.save();
      g.translate(x, y); g.rotate(ang);
      g.fillStyle = fcol[ci];
      g.fillRect(-w / 2, -hgt / 2, w, hgt);
      g.strokeStyle = 'rgba(90,70,30,0.35)'; g.lineWidth = 0.6 / L;
      g.strokeRect(-w / 2, -hgt / 2, w, hgt);
      if (L >= 16 && ci !== 2) {
        g.beginPath();
        for (let s = -w / 2 + 0.06; s < w / 2; s += 0.07) { g.moveTo(s, -hgt / 2); g.lineTo(s, hgt / 2); }
        g.strokeStyle = 'rgba(110,80,40,0.22)'; g.stroke();
      }
      g.restore();
    }
    g.lineCap = 'round';
    g.fillStyle = 'rgba(96,82,44,0.45)'; g.fill(shrubs[0]);
    g.fillStyle = 'rgba(128,84,110,0.45)'; g.fill(shrubs[1]);
    g.fillStyle = 'rgba(92,150,180,0.85)'; g.fill(pools);
    g.strokeStyle = 'rgba(60,96,120,0.6)'; g.lineWidth = 0.6 / L; g.stroke(pools);
    g.strokeStyle = 'rgba(70,98,52,0.8)'; g.lineWidth = Math.max(0.03, 0.7 / L); g.stroke(reeds);
    g.fillStyle = 'rgba(56,84,30,0.8)'; g.fill(vines);
    g.strokeStyle = 'rgba(176,150,96,0.7)'; g.lineWidth = Math.max(0.05, 0.8 / L); g.stroke(dunes);
    g.lineWidth = Math.max(0.1, 1.2 / L);
    g.strokeStyle = 'rgba(206,224,150,0.85)'; g.stroke(hillL);
    g.strokeStyle = 'rgba(78,104,44,0.75)'; g.stroke(hillD);
    g.fillStyle = 'rgba(18,40,14,0.32)'; g.fill(trees.sh);
    g.fillStyle = '#2f6a2d'; g.fill(trees.c[0]);
    g.fillStyle = '#3f7c35'; g.fill(trees.c[1]);
    g.fillStyle = '#4b8c3b'; g.fill(trees.c[2]);
    g.fillStyle = '#34603a'; g.fill(pines);
    if (big) { g.fillStyle = 'rgba(140,196,96,0.55)'; g.fill(trees.hi); }
    // sommets
    const winter = this.season === 'hiver';
    for (const [x, y, s, high] of peaks) {
      const hgt = s * 0.95, half = s * 0.62;
      g.fillStyle = 'rgba(30,30,20,0.25)';
      g.beginPath(); g.moveTo(x, y - hgt); g.lineTo(x + half * 1.35, y + 0.08); g.lineTo(x + half * 0.2, y + 0.08); g.fill();
      g.fillStyle = '#c3c2a7';
      g.beginPath(); g.moveTo(x - half, y); g.lineTo(x, y - hgt); g.lineTo(x + 0.08, y); g.fill();
      g.fillStyle = '#7f826c';
      g.beginPath(); g.moveTo(x, y - hgt); g.lineTo(x + half, y); g.lineTo(x + 0.08, y); g.fill();
      if (high || winter) {
        const k = high ? 0.42 : 0.3;
        g.fillStyle = '#f6f7f5';
        g.beginPath(); g.moveTo(x, y - hgt); g.lineTo(x - half * k, y - hgt * (1 - k)); g.lineTo(x - half * k * 0.2, y - hgt * (1 - k * 0.8));
        g.lineTo(x + half * k * 0.4, y - hgt * (1 - k)); g.lineTo(x + half * k, y - hgt * (1 - k)); g.closePath(); g.fill();
      }
      if (L >= 8) {
        g.strokeStyle = 'rgba(50,50,36,0.55)'; g.lineWidth = 0.6 / L;
        g.beginPath(); g.moveTo(x - half, y); g.lineTo(x, y - hgt); g.lineTo(x + half, y); g.stroke();
      }
    }
  }

  // ------------------------------------------------------------------ dessin
  frame(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.camAnim) {
      const a = this.camAnim, k = Math.min(1, (now - a.t0) / a.dur), e = 1 - Math.pow(1 - k, 3);
      const lz = Math.log(a.from.z) + (Math.log(a.to.z) - Math.log(a.from.z)) * e;
      this.cam = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, z: Math.exp(lz) };
      if (k >= 1) this.camAnim = null;
    }
    if (this.inertia) {
      const iv = this.inertia;
      this.cam.x -= iv.vx * dt / this.cam.z;
      this.cam.y -= iv.vy * dt / this.cam.z;
      const k = Math.exp(-dt * 4.5);
      iv.vx *= k; iv.vy *= k;
      this.clampCam();
      if (Math.hypot(iv.vx, iv.vy) < 25) this.inertia = null;
    }
    if (this.dragTrail && this.dragTrail.end) {
      const [ex, ey] = this.dragTrail.end, m = 46, v = 420 * dt / this.cam.z;
      const ddx = ex < m ? -1 : ex > this.vw - m ? 1 : 0, ddy = ey < m + 60 ? -1 : ey > this.vh - m ? 1 : 0;
      if (ddx || ddy) { this.cam.x += ddx * v; this.cam.y += ddy * v; this.clampCam(); }
    }
    for (const d of this.disp.values()) {
      const f = 1 - Math.exp(-dt * 7);
      d.x += (d.tx - d.x) * f;
      d.y += (d.ty - d.y) * f;
      if (d.thead != null) {
        let dh = d.thead - d.head;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        d.head += dh * Math.min(1, dt * 5);
      }
    }
    this.draw(dt, now / 1000);
    this.drawFog();
    requestAnimationFrame(t => this.frame(t));
  }

  draw(dt, time) {
    const ctx = this.ctx, dpr = this.dpr, z = this.cam.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c1828';
    ctx.fillRect(0, 0, this.vw, this.vh);
    const [wx0, wy0] = this.toWorld(0, 0), [wx1, wy1] = this.toWorld(this.vw, this.vh);
    // fond rapide
    ctx.imageSmoothingEnabled = true;
    const ox = this.vw / 2 - this.cam.x * z, oy = this.vh / 2 - this.cam.y * z;
    // tuiles
    const L = this.level();
    const span = TILE / L;
    let budget = 3;
    const tx0 = Math.floor(Math.max(0, wx0) / span), tx1 = Math.floor((Math.min(this.W, wx1) - 0.001) / span);
    const ty0 = Math.floor(Math.max(0, wy0) / span), ty1 = Math.floor((Math.min(this.H, wy1) - 0.001) / span);
    const lowL = LEVELS[0], lowSpan = TILE / lowL;
    // feuille de carte
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(ox + 6, oy + 8, this.W * z, this.H * z);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, this.W * z, this.H * z); ctx.clip();
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        let t = this.getTile(L, tx, ty, false);
        if (!t && budget > 0) { t = this.getTile(L, tx, ty, true); budget--; }
        const dx = ox + tx * span * z, dy = oy + ty * span * z, ds = span * z;
        if (t) {
          ctx.drawImage(t, dx, dy, ds + 0.6, ds + 0.6);
        } else {
          const ltx = Math.floor(tx * span / lowSpan), lty = Math.floor(ty * span / lowSpan);
          const lt = this.getTile(lowL, ltx, lty, true);
          const sx = (tx * span - ltx * lowSpan) * lowL, sy = (ty * span - lty * lowSpan) * lowL, ss = span * lowL;
          ctx.drawImage(lt, sx, sy, ss, ss, dx, dy, ds + 0.6, ds + 0.6);
        }
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,162,83,0.8)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(ox - 4, oy - 4, this.W * z + 8, this.H * z + 8);
    ctx.strokeStyle = 'rgba(200,162,83,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(ox - 8, oy - 8, this.W * z + 16, this.H * z + 16);
    // territoires
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(this.fillCanvas, ox, oy, this.W * z, this.H * z);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (this.highlightDept && this.deptPaths[this.highlightDept]) {
      const col = this.colors[this.highlightDept];
      ctx.fillStyle = col; ctx.globalAlpha = 0.28 + 0.1 * Math.sin(time * 3);
      ctx.fill(this.deptPaths[this.highlightDept]);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.6, 4 / z);
      ctx.stroke(this.deptPaths[this.highlightDept]);
    }
    for (const fr of this.frontiers) {
      const col = this.colors[fr.code];
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.2; ctx.lineWidth = Math.max(1.6, 14 / z); ctx.stroke(fr.path);
      ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(0.8, 7 / z); ctx.stroke(fr.path);
      ctx.globalAlpha = 1; ctx.lineWidth = Math.max(0.3, 3 / z); ctx.stroke(fr.path);
      ctx.strokeStyle = lighten(col, 0.6); ctx.globalAlpha = 0.9; ctx.lineWidth = Math.max(0.1, 1 / z); ctx.stroke(fr.path);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSeasonTint(ctx);
    if (!this.state) { this.drawNodes(ctx, time, this.preview); this.drawGesture(ctx); return; }
    this.drawNodes(ctx, time, this.state);
    this.drawPaths(ctx);
    this.drawArmies(ctx, time);
    this.drawBattles(ctx, dt, time);
    this.drawParticles(ctx, dt);
    this.drawWeather(ctx, dt, time);
    this.drawGesture(ctx);
  }

  drawFog() {
    // brouillard de guerre : on ne voit que ce que voient vos villes, vos armées, vos alliés et vos espions.
    // Il est peint en basse résolution sur un calque séparé, que le navigateur agrandit et superpose à la carte.
    const el = this.fogEl || (this.fogEl = document.getElementById('fog'));
    if (!el) return;
    const st = this.state;
    const startEl = this.startEl || (this.startEl = document.getElementById('start'));
    const on = this.fogOn && st && st.vis && !(startEl && !startEl.hidden);
    const k = 0.25;
    const w = Math.max(1, Math.ceil(this.vw * k)), h = Math.max(1, Math.ceil(this.vh * k));
    const c = this.cam;
    const sig = on ? `${w}x${h}|${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(3)}|${st.t}|${st.vis.length}` : 'off';
    if (sig === this.fogSig) return;
    this.fogSig = sig;
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    const g = el.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    if (!on) return;
    if (!this.holeSprite) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const gg = cv.getContext('2d'), gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.75, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
      this.holeSprite = cv;
    }
    const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(this.W, this.H);
    g.fillStyle = 'rgba(20,17,12,0.42)';
    g.fillRect(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of st.vis) {
      const [sx, sy] = this.toScreen(x, y);
      const R = r * c.z * k * 1.1;
      if (sx * k + R < 0 || sy * k + R < 0 || sx * k - R > w || sy * k - R > h) continue;
      g.drawImage(this.holeSprite, sx * k - R, sy * k - R, 2 * R, 2 * R);
    }
    g.globalCompositeOperation = 'source-over';
  }

  anchor(ctx, x, y, s, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = s * 0.34;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45); ctx.lineTo(0, s * 0.45);
      ctx.moveTo(-s * 0.28, -s * 0.2); ctx.lineTo(s * 0.28, -s * 0.2);
      ctx.moveTo(-s * 0.42, s * 0.12); ctx.quadraticCurveTo(-s * 0.3, s * 0.48, 0, s * 0.45); ctx.quadraticCurveTo(s * 0.3, s * 0.48, s * 0.42, s * 0.12);
    };
    path(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = s * 0.14; path(); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -s * 0.5, s * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  eye(ctx, x, y, s, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(14,20,30,.85)';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.quadraticCurveTo(0, -s * 0.42, s * 0.5, 0); ctx.quadraticCurveTo(0, s * 0.42, -s * 0.5, 0); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, s * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawSeasonTint(ctx) {
    const tint = { hiver: 'rgba(214,228,248,0.17)', automne: 'rgba(222,140,60,0.07)', 'été': 'rgba(255,232,140,0.05)' }[this.season];
    if (tint) {
      const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(this.W, this.H);
      ctx.fillStyle = tint; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  nodeSize(n) {
    const z = this.cam.z;
    if (n.type === 'capitale') return clamp(z * 2.6, 22, 70);
    if (n.type === 'ville') return clamp(z * 1.9, 15, 50);
    if (n.type === 'fort') return clamp(z * 1.6, 13, 42);
    return clamp(z * 1.25, 9, 34);
  }

  drawNodes(ctx, time, st) {
    const z = this.cam.z;
    const labels = [];
    for (const n of this.nodes) {
      const [x, y] = this.toScreen(n.x, n.y);
      const s = this.nodeSize(n);
      if (x < -s - 80 || y < -s - 40 || x > this.vw + s + 80 || y > this.vh + s + 40) continue;
      const ns = st.nodes[n.id];
      const col = this.colors[ns.o] || '#999';
      const sel = this.selection && this.selection.kind === 'node' && this.selection.id === n.id;
      ctx.save();
      ctx.translate(x, y);
      // halo
      ctx.fillStyle = col;
      ctx.globalAlpha = ns.o === 'neutre' ? 0.18 : 0.42;
      ctx.beginPath(); ctx.ellipse(0, s * 0.12, s * 0.62, s * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      if (sel) {
        ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(0, s * 0.12, s * 0.72 + 3, s * 0.5 + 3, 0, 0, Math.PI * 2); ctx.stroke();
      }
      if (n.type === 'capitale') this.iconStar(ctx, s, 5, col, true);
      else if (n.type === 'fort') this.iconStar(ctx, s, 4, col, false);
      else if (n.type === 'ville') this.iconTown(ctx, s, col, n.id);
      else this.iconVillage(ctx, s, col, n.id, ns.o);
      // siège
      if (ns.sg) {
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.62 + 4, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = this.colors[ns.sg.by] || '#f80'; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.62 + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, ns.sg.dmg)); ctx.stroke();
      }
      if (n.quai && (z >= 3.2 || ns.bk)) this.anchor(ctx, -s * 0.62, s * 0.3, clamp(s * 0.36, 7, 13), ns.bk ? '#ff8a6a' : '#cfe8ff');
      if (ns.intel || ns.spy) this.eye(ctx, s * 0.62, -s * 0.5, clamp(s * 0.4, 9, 14), ns.intel ? '#f3d98e' : 'rgba(243,217,142,0.6)');
      ctx.restore();
      const showLabel = n.type === 'capitale' || (n.type !== 'village' && z >= 2.3) || z >= 4.8 || sel;
      if (showLabel) labels.push([n, x, y, s, ns]);
    }
    // étiquettes (les plus importantes d'abord, sans chevauchement)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const prio = { capitale: 0, ville: 1, fort: 2, village: 3 };
    labels.sort((a, b) => prio[a[0].type] - prio[b[0].type]);
    const placed = [];
    for (const [n, x, y, s, ns] of labels) {
      const fs = n.type === 'capitale' ? clamp(13 + z * 0.5, 15, 21) : n.type === 'village' ? clamp(10 + z * 0.25, 11, 15) : clamp(11 + z * 0.4, 13, 18);
      ctx.font = `${n.type === 'capitale' ? 600 : 500} ${fs}px "EB Garamond", Georgia, serif`;
      const ty = y + s * 0.5 + 2;
      const tw = ctx.measureText(n.name).width;
      const box = [x - tw / 2 - 2, ty, x + tw / 2 + 2, ty + fs];
      const isSel = this.selection && this.selection.kind === 'node' && this.selection.id === n.id;
      if (n.type !== 'capitale' && !isSel && placed.some(b => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      placed.push(box);
      ctx.strokeStyle = 'rgba(28,22,14,0.85)'; ctx.lineWidth = 3.2;
      ctx.strokeText(n.name, x, ty);
      ctx.fillStyle = n.type === 'capitale' ? '#ffeab0' : '#fbf6e6';
      ctx.fillText(n.name, x, ty);
      // garnison
      const men = ns.m != null ? ns.m + (ns.g ? ns.g.reduce((a, r) => a + r[2], 0) : (ns.gm || 0)) : null;
      if (men != null && (z >= 3.2 || n.type === 'capitale')) {
        const txt = String(Math.round(men));
        ctx.font = `600 ${fs - 2}px "EB Garamond", Georgia, serif`;
        const w = ctx.measureText(txt).width + 10;
        const bx = x + s * 0.5 + 2, by = y - s * 0.45;
        ctx.fillStyle = 'rgba(19,35,58,0.88)';
        roundRect(ctx, bx, by, w, fs + 1, 4); ctx.fill();
        ctx.strokeStyle = this.colors[ns.o] || '#999'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#f1ead8'; ctx.textAlign = 'left';
        ctx.fillText(txt, bx + 5, by + 0.5);
        ctx.textAlign = 'center';
      }
      if (ns.q && ns.q.length && z >= 3) {
        ctx.fillStyle = '#e6c97f';
        ctx.beginPath(); ctx.arc(x - s * 0.55 - 4, y - s * 0.35, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  flag(ctx, x, y, h, col) {
    ctx.strokeStyle = '#3b2c1c'; ctx.lineWidth = Math.max(1, h * 0.07);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.62, y - h * 0.82); ctx.lineTo(x, y - h * 0.62); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8; ctx.stroke();
  }

  iconStar(ctx, s, k, col, capital) {
    const R = s * 0.5, r = R * 0.62;
    const star = (R1, R2) => {
      ctx.beginPath();
      for (let i = 0; i < k * 2; i++) {
        const a = -Math.PI / 2 + i * Math.PI / k, rr = i % 2 ? R2 : R1;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8);
      }
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(30,24,14,0.3)'; ctx.save(); ctx.translate(2, 3); star(R, r); ctx.fill(); ctx.restore();
    star(R, r); ctx.fillStyle = '#c9b78d'; ctx.fill(); ctx.strokeStyle = '#5c4b30'; ctx.lineWidth = Math.max(1, s * 0.04); ctx.stroke();
    star(R * 0.74, r * 0.74); ctx.fillStyle = '#e4d5ad'; ctx.fill(); ctx.strokeStyle = 'rgba(92,75,48,0.6)'; ctx.stroke();
    // bâtiments
    const b = s * (capital ? 0.2 : 0.14);
    ctx.fillStyle = '#efe7d2'; ctx.fillRect(-b, -b * 0.7, b * 2, b * 1.3);
    ctx.fillStyle = darken(col, 0.15); ctx.fillRect(-b * 1.1, -b * 1.05, b * 2.2, b * 0.45);
    ctx.strokeStyle = '#5c4b30'; ctx.lineWidth = 0.8; ctx.strokeRect(-b, -b * 0.7, b * 2, b * 1.3);
    this.flag(ctx, b * 0.2, -b * 1.05, s * (capital ? 0.42 : 0.36), col);
  }

  iconTown(ctx, s, col, id) {
    const R = s * 0.45;
    ctx.fillStyle = 'rgba(30,24,14,0.3)'; ctx.beginPath(); ctx.ellipse(2, 3, R, R * 0.78, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d6c69d'; ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.78, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5c4b30'; ctx.lineWidth = Math.max(1.2, s * 0.06); ctx.stroke();
    // tours
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3 + 0.3;
      ctx.fillStyle = '#b9a67c';
      ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R * 0.78, s * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5c4b30'; ctx.lineWidth = 0.8; ctx.stroke();
    }
    const roofs = [[-0.18, -0.08], [0.12, -0.14], [-0.02, 0.12], [0.2, 0.1]];
    for (const [dx, dy] of roofs) {
      const x = dx * s, y = dy * s, w = s * 0.17, h = s * 0.12;
      ctx.fillStyle = '#f1e9d6'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = '#b4513a'; ctx.fillRect(x - w / 2, y - h / 2, w, h * 0.45);
    }
    this.flag(ctx, 0, -s * 0.1, s * 0.4, col);
  }

  iconVillage(ctx, s, col, id, owner) {
    const houses = [[-0.22, 0.05], [0.18, -0.06], [0, 0.22], [0.26, 0.24]];
    for (let k = 0; k < (s > 16 ? 4 : 3); k++) {
      const [dx, dy] = houses[k];
      const x = dx * s, y = dy * s, w = s * 0.3, h = s * 0.2;
      ctx.fillStyle = 'rgba(30,24,14,0.3)'; ctx.fillRect(x - w / 2 + 1.5, y - h / 2 + 2, w, h);
      ctx.fillStyle = '#f0e8d4'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = '#a9472f';
      ctx.beginPath(); ctx.moveTo(x - w / 2 - 1, y - h / 2 + 1); ctx.lineTo(x, y - h / 2 - h * 0.7); ctx.lineTo(x + w / 2 + 1, y - h / 2 + 1); ctx.fill();
    }
    if (owner !== 'neutre') this.flag(ctx, -s * 0.05, -s * 0.12, s * 0.5, col);
    else this.flag(ctx, -s * 0.05, -s * 0.12, s * 0.42, '#e9e4d4');
  }

  drawPaths(ctx) {
    const sel = this.selection;
    if (!sel || sel.kind !== 'army') return;
    const a = this.state.armies.find(x => x.id === sel.id);
    if (!a || !a.path || !a.path.length) return;
    const d = this.disp.get(a.id);
    if (!d) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // tronçons : terre (jaune ou vert) et eau (bleu clair, en gabare)
    const segs = [];
    let cur = { water: false, pts: [[d.x, d.y]] };
    for (const leg of a.path) {
      let water = false, add = [];
      if (leg.e != null) {
        const e = this.edges[leg.e];
        water = !!e.water;
        const f0 = leg.pos / Math.max(0.01, e.len), nseg = water ? 48 : 14;
        for (let k = 1; k <= nseg; k++) add.push(this.pointFrom(e, leg.frm, f0 + (1 - f0) * k / nseg));
      } else if (leg.pts) add = leg.pts.slice(1);
      if (water !== cur.water) {
        const lastP = cur.pts[cur.pts.length - 1];
        segs.push(cur);
        cur = { water, pts: [lastP] };
      }
      cur.pts.push(...add);
    }
    segs.push(cur);
    let last = null;
    for (const sg of segs) {
      if (sg.pts.length < 2) continue;
      const sp = sg.pts.map(p => this.toScreen(p[0], p[1]));
      ctx.beginPath(); sp.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = 'rgba(19,35,58,0.7)'; ctx.lineWidth = 6; ctx.stroke();
      ctx.setLineDash(sg.water ? [4, 6] : [9, 7]);
      ctx.strokeStyle = sg.water ? '#bfe6ff' : a.md === 'champs' ? '#bfe39a' : '#f1d58a'; ctx.lineWidth = 3; ctx.stroke();
      ctx.setLineDash([]);
      last = sp[sp.length - 1];
    }
    if (!last) { ctx.restore(); return; }
    this.flag(ctx, last[0], last[1], 22, this.colors[a.o]);
    ctx.restore();
  }

  drawArmies(ctx, time) {
    const z = this.cam.z, st = this.state;
    const detailed = z >= 5.5;
    const list = [...this.disp.values()].sort((p, q) => p.y - q.y);
    const atNode = {};
    for (const d of list) if (d.a.n != null && d.a.st !== 'battle') (atNode[d.a.n] = atNode[d.a.n] || []).push(d);
    for (const arr of Object.values(atNode)) arr.forEach((d, i) => { d.slot = i; d.slots = arr.length; });
    for (const d of list) {
      const a = d.a;
      const [x, y] = this.armyScreen(d);
      if (x < -80 || y < -80 || x > this.vw + 80 || y > this.vh + 80) continue;
      const col = this.colors[a.o] || '#999';
      const sel = this.selection && this.selection.kind === 'army' && this.selection.id === a.id;
      ctx.save();
      ctx.translate(x, y);
      if (a.h) ctx.globalAlpha = 0.62;
      if (a.boat && a.n == null) this.drawBoat(ctx, a, d, col, sel, time);
      else if (detailed) this.drawFormation(ctx, a, d, col, sel, time);
      else this.drawToken(ctx, a, d, col, sel, time);
      ctx.restore();
    }
  }

  drawToken(ctx, a, d, col, sel, time) {
    const w = 46, h = 24;
    if (sel) { ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 4, 30, 18, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; roundRect(ctx, -w / 2 + 2, -h / 2 + 3, w, h, 5); ctx.fill();
    ctx.fillStyle = col; roundRect(ctx, -w / 2, -h / 2, w, h, 5); ctx.fill();
    ctx.strokeStyle = a.h ? '#ffffff' : lighten(col, 0.55); ctx.lineWidth = 1.6;
    if (a.h) ctx.setLineDash([3, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    // flèche de marche
    if (a.st === 'move' || a.st === 'retreat') {
      ctx.save(); ctx.rotate(d.head);
      ctx.fillStyle = a.st === 'retreat' ? '#ffb3a6' : '#fff4d0';
      ctx.beginPath(); ctx.moveTo(w / 2 + 9, 0); ctx.lineTo(w / 2 + 2, -5); ctx.lineTo(w / 2 + 2, 5); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#fffaf0';
    ctx.font = '700 14px "EB Garamond", Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtMen(a.men), 0, 0.5);
    // types
    const types = {};
    for (const r of a.regs) types[r[1]] = (types[r[1]] || 0) + 1;
    const order = ['ligne', 'legere', 'cavalerie', 'artillerie'];
    let px = -((Object.keys(types).length - 1) * 8) / 2;
    for (const t of order) {
      if (!types[t]) continue;
      ctx.fillStyle = '#13233a';
      ctx.beginPath(); ctx.arc(px, h / 2 + 5, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = { ligne: '#f1ead8', legere: '#bfe39a', cavalerie: '#e6c97f', artillerie: '#ff9a7a' }[t];
      ctx.beginPath(); ctx.arc(px, h / 2 + 5, 2.8, 0, Math.PI * 2); ctx.fill();
      px += 8;
    }
    if (a.st === 'battle') {
      ctx.strokeStyle = 'rgba(255,120,80,' + (0.5 + 0.5 * Math.sin(time * 8)) + ')';
      ctx.lineWidth = 2; roundRect(ctx, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 7); ctx.stroke();
    }
  }

  formationLayout(a, bw, bd, gap) {
    // placement des blocs dans le repère de l'armée (l'avant est vers le haut, y négatif)
    const regs = a.regs;
    const inf = regs.filter(r => r[1] === 'ligne' || r[1] === 'legere');
    const cav = regs.filter(r => r[1] === 'cavalerie');
    const art = regs.filter(r => r[1] === 'artillerie');
    const fm = a.fm || 'ligne';
    const out = [];
    const row = (list, y, spacing, jitter = 0) => {
      const w = list.length * (bw + spacing) - spacing;
      list.forEach((r, k) => {
        const jx = jitter ? (hash(k, list.length, 7) - 0.5) * jitter : 0, jy = jitter ? (hash(k, list.length, 8) - 0.5) * jitter : 0;
        out.push({ r, x: -w / 2 + k * (bw + spacing) + bw / 2 + jx, y: y + jy, rot: 0 });
      });
    };
    const chunk = (list, n) => { const res = []; for (let k = 0; k < list.length; k += n) res.push(list.slice(k, k + n)); return res; };
    if (fm === 'carre' && inf.length) {
      // carré creux : l'infanterie fait face de tous côtés, canons et cavaliers à l'abri au centre
      const perSide = Math.max(1, Math.ceil(inf.length / 4));
      const S = perSide * (bw + gap) + bd;
      inf.forEach((r, k) => {
        const side = k % 4, idx = Math.floor(k / 4);
        const off = -((perSide - 1) * (bw + gap)) / 2 + idx * (bw + gap);
        const rot = side * Math.PI / 2;
        const cx = Math.sin(rot) * S / 2 + Math.cos(rot) * off, cy = -Math.cos(rot) * S / 2 + Math.sin(rot) * off;
        out.push({ r, x: cx, y: cy, rot });
      });
      const inner = [...art, ...cav];
      const small = 0.55;
      inner.forEach((r, k) => {
        const n = inner.length, w = n * (bw * small + 3) - 3;
        out.push({ r, x: -w / 2 + k * (bw * small + 3) + bw * small / 2, y: 0, rot: 0, scale: small });
      });
    } else if (fm === 'colonne') {
      // colonnes d'attaque : deux bataillons de front, en profondeur
      let y = 0;
      for (const line of chunk(inf, 2)) { row(line, y, gap * 0.6); y += bd + gap * 0.8; }
      const cavRows = chunk(cav, 2);
      for (const line of cavRows) { row(line, y + gap, gap * 3); y += bd + gap * 1.6; }
      if (art.length) { row(art, y + gap * 1.5, gap); }
    } else if (fm === 'tirailleurs') {
      // ordre dispersé : un large rideau irrégulier
      row(inf, 0, gap * 2.8, bd * 0.9);
      if (cav.length) row(cav, bd + gap * 3.2, gap * 4);
      if (art.length) row(art, (cav.length ? 2 : 1) * (bd + gap * 3.2), gap);
    } else {
      // ligne : cavalerie aux ailes, artillerie en second rang
      const front = [...cav.slice(0, Math.ceil(cav.length / 2)), ...inf, ...cav.slice(Math.ceil(cav.length / 2))];
      let y = 0;
      for (const line of chunk(front, 6)) { row(line, y, gap); y += bd + gap * 2.4; }
      for (const line of chunk(art, 6)) { row(line, y, gap); y += bd + gap * 2.4; }
    }
    return out;
  }

  drawFormation(ctx, a, d, col, sel, time) {
    const z = this.cam.z;
    const bw = clamp(z * 2.3, 22, 66), bd = bw * 0.38, gap = bw * 0.2;
    const blocks = this.formationLayout(a, bw, bd, gap);
    if (!blocks.length) return;
    // recentre la formation sur la position de l'armée
    const xs = blocks.map(b => b.x), ys = blocks.map(b => b.y);
    const minx = Math.min(...xs) - bw / 2, maxx = Math.max(...xs) + bw / 2, miny = Math.min(...ys) - bd / 2, maxy = Math.max(...ys) + bd / 2;
    const cy = (miny + maxy) / 2 - (a.fm === 'carre' ? 0 : bd * 0.3);
    ctx.save();
    ctx.rotate(d.head + Math.PI / 2);
    ctx.translate(0, -cy);
    if (sel) {
      ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse((minx + maxx) / 2, (miny + maxy) / 2, (maxx - minx) / 2 + 12, (maxy - miny) / 2 + 10, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const fighting = a.st === 'battle';
    const labels = [];
    blocks.forEach((b, k) => {
      const r = b.r, sc = b.scale || 1;
      const jx = fighting ? (Math.sin(time * 9 + k * 1.7) * 0.8) : 0;
      const frac = clamp(r[2] / r[3], 0.08, 1);
      ctx.save();
      ctx.translate(b.x + jx, b.y);
      ctx.rotate(b.rot);
      ctx.scale(sc, sc);
      ctx.translate(-bw / 2, -bd / 2);
      if (r[1] === 'artillerie') this.drawGuns(ctx, bw, bd, col, frac);
      else if (r[1] === 'cavalerie') this.drawHorse(ctx, bw, bd, col, frac);
      else this.drawFoot(ctx, bw, bd, col, frac, r[1] === 'legere' || a.fm === 'tirailleurs');
      if (fighting && Math.random() < 0.18) {
        ctx.fillStyle = 'rgba(255,226,140,0.95)';
        ctx.beginPath(); ctx.arc(Math.random() * bw, -2, Math.max(1.5, bw * 0.05), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(240,240,235,0.5)';
        ctx.beginPath(); ctx.arc(Math.random() * bw, -bd * 0.4, bw * 0.12, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (sc === 1) labels.push([b.x + jx, b.y - bd / 2 - 3 - cy, r[2]]);
    });
    ctx.restore();
    // chiffres au-dessus des blocs (non tournés)
    ctx.font = `700 ${clamp(bw * 0.42, 10, 16)}px "EB Garamond", Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const ca = Math.cos(d.head + Math.PI / 2), sa = Math.sin(d.head + Math.PI / 2);
    for (const [lx, ly, n] of labels) {
      const X = lx * ca - ly * sa, Y = lx * sa + ly * ca;
      ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = 3;
      ctx.strokeText(String(n), X, Y - 4);
      ctx.fillStyle = '#fff6dc';
      ctx.fillText(String(n), X, Y - 4);
    }
    if (z >= 7 && (sel || a.o === this.state.me.code)) {
      ctx.font = `italic 500 ${clamp(z * 0.6 + 5, 11, 15)}px "EB Garamond", Georgia, serif`;
      ctx.textBaseline = 'top';
      const th = d.head + Math.PI / 2;
      const ty = 0.5 * (Math.abs(Math.sin(th)) * (maxx - minx) + Math.abs(Math.cos(th)) * (maxy - miny)) + 12;
      const gen = a.gen ? ` · ${a.gen.name}` : '';
      const fmLab = a.fm && a.fm !== 'ligne' ? ` · ${this.rules.formations[a.fm].label.toLowerCase()}` : '';
      const txt = a.name + gen + fmLab;
      ctx.strokeStyle = 'rgba(14,20,30,.8)'; ctx.lineWidth = 3;
      ctx.strokeText(txt, 0, ty); ctx.fillStyle = '#f1ead8'; ctx.fillText(txt, 0, ty);
    }
  }

  drawBoat(ctx, a, d, col, sel, time) {
    // gabares : coque, voile carrée aux couleurs du département, effectif
    const z = this.cam.z;
    const s = clamp(z * 2.4, 22, 54);
    const n = clamp(Math.ceil(a.regs.length / 2), 1, 3);
    const bob = Math.sin(time * 2.4) * s * 0.03;
    if (sel) { ctx.strokeStyle = '#f3d98e'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.9 + n * 4, s * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); }
    const flip = Math.cos(d.head) < 0 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      ctx.save();
      ctx.translate((k - (n - 1) / 2) * s * 0.42 * flip, (k % 2 ? s * 0.18 : -s * 0.05) + bob * (k % 2 ? -1 : 1));
      ctx.scale(flip, 1);
      // sillage
      ctx.strokeStyle = 'rgba(235,246,255,0.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.2); ctx.lineTo(-s * 0.85, s * 0.28); ctx.moveTo(-s * 0.5, s * 0.26); ctx.lineTo(-s * 0.8, s * 0.38); ctx.stroke();
      // coque
      ctx.fillStyle = '#5b3d22';
      ctx.beginPath(); ctx.moveTo(-s * 0.5, s * 0.08); ctx.lineTo(s * 0.5, s * 0.08); ctx.lineTo(s * 0.36, s * 0.3); ctx.lineTo(-s * 0.4, s * 0.3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2f1f10'; ctx.lineWidth = 1; ctx.stroke();
      // mât et voile
      ctx.strokeStyle = '#3b2a18'; ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath(); ctx.moveTo(0, s * 0.08); ctx.lineTo(0, -s * 0.48); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(-s * 0.22, -s * 0.42); ctx.quadraticCurveTo(-s * 0.02, -s * 0.15, -s * 0.24, s * 0.02); ctx.lineTo(s * 0.24, s * 0.02); ctx.quadraticCurveTo(s * 0.36, -s * 0.15, s * 0.22, -s * 0.42); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = lighten(col, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.font = `700 ${clamp(s * 0.36, 12, 17)}px "EB Garamond", Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(14,20,30,.85)'; ctx.lineWidth = 3;
    const txt = fmtMen(a.men);
    ctx.strokeText(txt, 0, s * 0.38); ctx.fillStyle = '#fffaf0'; ctx.fillText(txt, 0, s * 0.38);
    if (a.fire) {
      ctx.fillStyle = `rgba(255,140,80,${0.5 + 0.5 * Math.sin(time * 10)})`;
      ctx.beginPath(); ctx.arc(s * 0.3, -s * 0.5, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawFoot(ctx, bw, bd, col, frac, light) {
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(2, 2.5, bw, bd);
    ctx.fillStyle = darken(col, 0.35); ctx.fillRect(0, 0, bw, bd);
    const cols = Math.max(4, Math.round(bw / 4.2)), rows = light ? 2 : 3;
    const n = Math.round(cols * rows * frac);
    const dx = bw / cols, dy = bd / rows, r = Math.min(dx, dy) * 0.36;
    const c1 = col, c2 = lighten(col, 0.4);
    let k = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (k++ >= n) continue;
      const x = dx * (i + 0.5) + (light ? (hash(i, j) - 0.5) * dx * 0.5 : 0), y = dy * (j + 0.5);
      ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = lighten(col, 0.6); ctx.lineWidth = 1; ctx.strokeRect(0, 0, bw, bd);
  }

  drawHorse(ctx, bw, bd, col, frac) {
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(2, 2.5, bw, bd);
    const cols = Math.max(3, Math.round(bw / 6.5)), rows = 2;
    const n = Math.round(cols * rows * frac);
    const dx = bw / cols, dy = bd / rows;
    let k = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (k++ >= n) continue;
      const x = dx * (i + 0.5), y = dy * (j + 0.5);
      ctx.fillStyle = '#6a4a2c'; ctx.beginPath(); ctx.ellipse(x, y, dx * 0.24, dy * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - dy * 0.05, Math.min(dx, dy) * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = lighten(col, 0.55); ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(0, 0, bw, bd); ctx.setLineDash([]);
  }

  drawGuns(ctx, bw, bd, col, frac) {
    const n = Math.max(1, Math.round(3 * frac));
    for (let k = 0; k < n; k++) {
      const x = bw * (k + 0.5) / 3;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - bw * 0.06 + 2, -bd * 0.2 + 2, bw * 0.12, bd * 0.9);
      ctx.fillStyle = '#2a2a28'; ctx.fillRect(x - bw * 0.045, -bd * 0.25, bw * 0.09, bd * 0.8);
      ctx.fillStyle = '#6b4a2c';
      ctx.beginPath(); ctx.arc(x - bw * 0.09, bd * 0.42, bd * 0.2, 0, Math.PI * 2); ctx.arc(x + bw * 0.09, bd * 0.42, bd * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, bd * 0.85, bd * 0.15, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawBattles(ctx, dt, time) {
    const z = this.cam.z;
    for (const b of this.state.battles) {
      const [x, y] = this.toScreen(b.x, b.y);
      if (x < -100 || y < -100 || x > this.vw + 100 || y > this.vh + 100) continue;
      // fumée
      if (Math.random() < dt * 9) {
        const r = 1.6;
        this.particles.push({ type: 'smoke', x: b.x + (Math.random() - 0.5) * r * 2, y: b.y + (Math.random() - 0.5) * r * 1.4,
                              life: 0, max: 2.2 + Math.random(), size: 0.5 + Math.random() * 0.6 });
      }
      if (Math.random() < dt * 14) {
        this.particles.push({ type: 'spark', x: b.x + (Math.random() - 0.5) * 2.4, y: b.y + (Math.random() - 0.5) * 1.6, life: 0, max: 0.15 });
      }
      if (z < 5.5) {
        ctx.save();
        ctx.translate(x, y - 26);
        const pulse = 1 + 0.12 * Math.sin(time * 6);
        ctx.fillStyle = 'rgba(19,35,58,0.9)';
        ctx.beginPath(); ctx.arc(0, 0, 14 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = b.amb ? '#bfe39a' : '#ff9a7a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = '#f1ead8'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawParticles(ctx, dt) {
    const z = this.cam.z;
    const keep = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life > p.max) continue;
      keep.push(p);
      const k = p.life / p.max;
      if (p.type === 'smoke') {
        const [x, y] = this.toScreen(p.x + k * 0.6, p.y - k * 0.4);
        const r = (p.size + k * 1.2) * z;
        ctx.fillStyle = `rgba(232,232,226,${0.5 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(x, y, Math.max(3, r), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'spark') {
        const [x, y] = this.toScreen(p.x, p.y);
        ctx.fillStyle = `rgba(255,214,120,${1 - k})`;
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, z * 0.12), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'num') {
        const [x, y] = this.toScreen(p.x, p.y);
        ctx.font = `700 ${clamp(10 + z * 0.5, 13, 20)}px "EB Garamond", Georgia, serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1 - k * k;
        ctx.strokeStyle = 'rgba(10,10,10,.85)'; ctx.lineWidth = 3;
        ctx.strokeText(p.text, x, y - k * 34);
        ctx.fillStyle = '#ffd2c7'; ctx.fillText(p.text, x, y - k * 34);
        ctx.globalAlpha = 1;
      } else if (p.type === 'coin') {
        const e = k < 0 ? 0 : k * k * (3 - 2 * k);
        const x0 = p.x, y0 = p.y, x1 = p.x1, y1 = p.y1;
        const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - Math.hypot(x1 - x0, y1 - y0) * 0.35;
        const u = 1 - e;
        const wx = u * u * x0 + 2 * u * e * cx + e * e * x1, wy = u * u * y0 + 2 * u * e * cy + e * e * y1;
        const [x, y] = this.toScreen(wx, wy);
        const r = clamp(z * 0.5, 4, 9);
        ctx.fillStyle = '#7a5a12'; ctx.beginPath(); ctx.arc(x + 1, y + 1, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8c34f'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }
    this.particles = keep.slice(-600);
  }

  spawnCoins(owner) {
    if (!this.state) return;
    const cap = this.nodes.find(n => n.type === 'capitale' && this.state.nodes[n.id].o === owner && n.dept === owner)
      || this.nodes.find(n => this.state.nodes[n.id].o === owner);
    if (!cap) return;
    const mine = this.nodes.filter(n => this.state.nodes[n.id].o === owner && n.id !== cap.id);
    mine.sort(() => Math.random() - 0.5);
    mine.slice(0, 26).forEach((n, i) => {
      this.particles.push({ type: 'coin', x: n.x, y: n.y, x1: cap.x, y1: cap.y, life: -i * 0.07, max: 1.5 });
    });
  }

  drawWeather(ctx, dt, time) {
    const st = this.state;
    const [mx0, my0] = this.toScreen(0, 0), [mx1, my1] = this.toScreen(this.W, this.H);
    const X0 = Math.max(0, mx0), Y0 = Math.max(0, my0), X1 = Math.min(this.vw, mx1), Y1 = Math.min(this.vh, my1);
    const ym = clamp(this.toScreen(0, this.m.y_mont)[1], Y0, Y1);
    const xc = clamp(this.toScreen(this.m.x_cote, 0)[0], X0, X1);
    const zones = {
      montagne: [X0, ym, X1 - X0, Y1 - ym],
      cote: [X0, Y0, xc - X0, ym - Y0],
      interieur: [xc, Y0, X1 - xc, ym - Y0],
    };
    for (const [zn, rect] of Object.entries(zones)) {
      const [rx, ry, rw, rh] = rect;
      if (rw <= 0 || rh <= 0) continue;
      const kind = st.weather[zn]?.kind;
      if (!kind) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
      const pool = this.wx[zn];
      const area = rw * rh / 1e5;
      if (kind === 'pluie' || kind === 'orage' || kind === 'tempete') {
        const want = Math.min(420, area * (kind === 'pluie' ? 60 : 95));
        while (pool.length < want) pool.push({ x: rx + Math.random() * rw, y: ry + Math.random() * rh, l: 8 + Math.random() * 10 });
        pool.length = Math.min(pool.length, Math.ceil(want));
        const vx = kind === 'tempete' ? -260 : -60, vy = 620;
        ctx.strokeStyle = 'rgba(205,222,240,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const p of pool) {
          p.x += vx * dt; p.y += vy * dt;
          if (p.y > ry + rh) { p.y = ry - 10; p.x = rx + Math.random() * (rw + 200); }
          if (p.x < rx - 50) p.x += rw + 100;
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + vx * 0.02, p.y + p.l);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(40,52,70,0.12)'; ctx.fillRect(rx, ry, rw, rh);
        if (kind === 'orage') {
          if (Math.random() < dt * 0.35) this.flash[zn] = 0.4;
          if (this.flash[zn] > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash[zn]})`; ctx.fillRect(rx, ry, rw, rh); this.flash[zn] -= dt * 1.6; }
        }
      } else if (kind === 'neige') {
        const want = Math.min(360, area * 55);
        while (pool.length < want) pool.push({ x: rx + Math.random() * rw, y: ry + Math.random() * rh, r: 1 + Math.random() * 2, ph: Math.random() * 6 });
        pool.length = Math.min(pool.length, Math.ceil(want));
        ctx.fillStyle = 'rgba(240,246,255,0.22)'; ctx.fillRect(rx, ry, rw, rh);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        for (const p of pool) {
          p.y += 40 * dt; p.x += Math.sin(time + p.ph) * 12 * dt;
          if (p.y > ry + rh) { p.y = ry - 4; p.x = rx + Math.random() * rw; }
          ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        }
        ctx.fill();
      } else if (kind === 'brouillard') {
        const want = 9;
        while (pool.length < want) pool.push({ x: Math.random(), y: Math.random(), r: 0.25 + Math.random() * 0.3, v: 0.004 + Math.random() * 0.006 });
        ctx.fillStyle = 'rgba(232,236,240,0.2)'; ctx.fillRect(rx, ry, rw, rh);
        for (const p of pool) {
          p.x += p.v * dt; if (p.x > 1.3) p.x = -0.3;
          const cx = rx + p.x * rw, cy = ry + p.y * rh, R = p.r * Math.max(rw, rh);
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
          gr.addColorStop(0, 'rgba(240,242,245,0.42)'); gr.addColorStop(1, 'rgba(240,242,245,0)');
          ctx.fillStyle = gr; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        }
      } else if (kind === 'canicule') {
        ctx.fillStyle = 'rgba(255,170,70,0.09)'; ctx.fillRect(rx, ry, rw, rh);
      } else if (kind === 'nuages') {
        ctx.fillStyle = 'rgba(60,70,90,0.06)'; ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
export function fmtMen(n) {
  n = Math.round(n);
  return n >= 1000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, '0')}` : String(n);
}
