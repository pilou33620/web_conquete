// Petite vie de la carte : moulins qui tournent dans les champs, moulins à eau, fumées des cheminées, vols d'oiseaux,
// mouettes, gabares sur les fleuves et navires au large, barques de pêche, charrettes et cavaliers sur les routes,
// troupeaux (et bergers landais sur leurs échasses), écume sur la côte, reflets sur l'océan, courant des fleuves,
// phare de Cordouan. Purement décoratif : animé en temps réel (même partie en pause), sans lien avec la simulation,
// et dessiné seulement pour ce qui est à l'écran, au zoom où on le distingue.
import { clamp } from './battle/formes.js';
const T = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
const TAU = Math.PI * 2;
const frac = v => v - Math.floor(v);
function hash(i, j, k = 0) {
  let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
// polyligne avec longueurs cumulées : position et direction à une abscisse donnée
function polyline(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
function along(pl, s) {
  const { pts, cum } = pl;
  s = clamp(s, 0, pl.len);
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
  const i = Math.max(1, lo), seg = (cum[i] - cum[i - 1]) || 1e-9, f = (s - cum[i - 1]) / seg;
  const p = pts[i - 1], q = pts[i];
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, Math.atan2(q[1] - p[1], q[0] - p[0])];
}

export class Ambient {
  constructor(map) {
    this.map = map;
    let saved = null;
    try { saved = localStorage.getItem('conquete.anim'); } catch (e) { /* stockage indisponible */ }
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* API absente */ }
    this.on = saved ? saved !== '0' : !reduced;
    this.flocks = [];
    this.build();
  }

  setOn(v) {
    this.on = v;
    try { localStorage.setItem('conquete.anim', v ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  }

  // ------------------------------------------------------------------ préparation (une fois)
  build() {
    const mp = this.map, W = mp.W, H = mp.H, ter = mp.terrain, m = mp.m;
    const tAt = (x, y) => { const i = Math.floor(x), j = Math.floor(y); return i < 0 || j < 0 || i >= W || j >= H ? -1 : ter[j * W + i]; };
    this.tAt = tAt;
    // distance à la terre, en mer (pour l'écume, les barques, les reflets)
    const N = W * H, dist = new Int16Array(N).fill(-1), q = [];
    for (let c = 0; c < N; c++) if (ter[c] !== T.OCEAN) { dist[c] = 0; q.push(c); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0, d = dist[c] + 1;
      if (d > 40) continue;
      for (const n of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1]) if (n >= 0 && dist[n] < 0) { dist[n] = d; q.push(n); }
    }
    this.foam = []; this.glints = []; this.fishers = []; const gullSpots = [];
    for (let c = 0; c < N; c++) {
      if (ter[c] !== T.OCEAN) continue;
      const i = c % W, j = (c / W) | 0, d = dist[c] < 0 ? 41 : dist[c];
      if (d === 1) {
        // direction de la terre la plus proche (la vague roule vers elle)
        let dx = 0, dy = 0;
        if (i < W - 1 && ter[c + 1] !== T.OCEAN) dx += 1;
        if (i > 0 && ter[c - 1] !== T.OCEAN) dx -= 1;
        if (j < H - 1 && ter[c + W] !== T.OCEAN) dy += 1;
        if (j > 0 && ter[c - W] !== T.OCEAN) dy -= 1;
        const L = Math.hypot(dx, dy);
        if (L) this.foam.push({ x: i + 0.5, y: j + 0.5, dx: dx / L, dy: dy / L, ph: hash(i, j, 81) });
        if (hash(i, j, 85) < 0.045) gullSpots.push([i + 0.5, j + 0.5]);
      }
      if (d >= 1 && hash(i, j, 82) < 0.05) this.glints.push({ x: i + hash(i, j, 83), y: j + hash(i, j, 84), ph: hash(i, j, 86) * TAU, sp: 0.6 + hash(i, j, 87) * 0.8 });
      if (d >= 2 && d <= 5 && hash(i, j, 88) < 0.012) this.fishers.push({ x: i + 0.5, y: j + 0.5, ph: hash(i, j, 89) * TAU, r: 0.3 + hash(i, j, 90) * 0.5 });
    }
    // mouettes : quelques rondes au-dessus du rivage et des ports
    this.gulls = gullSpots.filter((_, k) => k % 3 === 0).map((p, k) => ({ x: p[0] - 1, y: p[1], n: 2 + (k % 3), r: 0.6 + hash(k, 3, 91) * 0.7, ph: hash(k, 4, 92) * TAU, sp: (hash(k, 5, 93) < 0.5 ? -1 : 1) * (0.35 + hash(k, 6, 94) * 0.3) }));
    // moulins à vent : dans les champs autour des bourgs
    this.mills = [];
    for (const n of mp.nodes) {
      const want = n.type === 'capitale' ? 3 : n.type === 'ville' ? 2 : hash(n.id, 1, 71) < 0.55 ? 1 : 0;
      let placed = 0;
      for (let k = 0; k < 12 && placed < want; k++) {
        // en haut à gauche du bourg : ni sur son nom, ni sur l'effectif de sa garnison
        const a = -Math.PI * (0.55 + hash(n.id, k, 72) * 0.42), r = (n.type === 'capitale' ? 3.2 : n.type === 'ville' ? 2.4 : 1.7) + hash(n.id, k, 73) * 1.6;
        const x = n.x + Math.cos(a) * r, y = n.y + Math.sin(a) * r * 0.8;
        const t = tAt(x, y);
        if (t !== T.PLAINE && t !== T.COLLINES && t !== T.VIGNE) continue;
        if (this.mills.some(o => Math.hypot(o.x - x, o.y - y) < 1.3) || mp.nodes.some(o => Math.hypot(o.x - x, o.y - y) < 1.1)) continue;
        this.mills.push({ x, y, ph: hash(n.id, k, 74) * TAU, sp: 0.75 + hash(n.id, k, 75) * 0.5 });
        placed++;
      }
    }
    // moulins à eau : sur la rivière, au bord des bourgs qu'elle traverse
    this.wmills = [];
    for (const n of mp.nodes) {
      if (n.type === 'capitale' || hash(n.id, 2, 76) > 0.55) continue;
      let best = null;
      for (const r of m.rivers) {
        for (let k = 1; k < r.pts.length; k++) {
          const p = r.pts[k], dd = Math.hypot(p[0] - n.x, p[1] - n.y);
          if (dd > 0.9 && dd < 2.6 && (!best || dd < best.d)) {
            const pp = r.pts[k - 1];
            best = { d: dd, x: p[0], y: p[1], a: Math.atan2(p[1] - pp[1], p[0] - pp[0]), rank: r.rank };
          }
        }
      }
      if (best) this.wmills.push({ ...best, ph: hash(n.id, 3, 77) * TAU });
    }
    // gabares sur les fleuves navigables, navires sur la route du cabotage
    this.boats = [];
    (m.ways || []).forEach((w, wi) => {
      const pl = polyline(w.pts);
      if (pl.len < 2) return;
      const n = w.sea ? 3 : clamp(Math.round(pl.len / 30), 1, 3);
      for (let k = 0; k < n; k++) {
        this.boats.push({ pl, sea: w.sea, s0: hash(wi, k, 78) * pl.len * 2, sp: (w.sea ? 0.5 : 0.22) + hash(wi, k, 79) * 0.12, ph: hash(wi, k, 80) * TAU });
      }
    });
    // courant des fleuves : tirets clairs qui descendent vers l'embouchure (les tracés vont de la source à la mer)
    this.flows = m.rivers.filter(r => r.rank <= 2).map((r, k) => {
      const p = new Path2D();
      r.pts.forEach((pt, i) => i ? p.lineTo(pt[0], pt[1]) : p.moveTo(pt[0], pt[1]));
      return { p, rank: r.rank, ph: hash(k, 7, 95) * 10 };
    });
    // voyageurs sur les routes : charrettes, cavaliers, colporteurs
    this.travellers = [];
    mp.edges.forEach((e, ei) => {
      if (e.water || e.ferry) return;
      const len = Math.hypot(e.B[0] - e.A[0], e.B[1] - e.A[1]);
      if (len < 3) return;
      const n = (e.royal ? 1 : 0) + (hash(ei, 1, 96) < (e.royal ? 0.6 : 0.4) ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const kind = hash(ei, k, 97);
        const sp = kind < 0.45 ? 0.16 : kind < 0.7 ? 0.38 : 0.1;   // km par seconde : charrette, cavalier, piéton
        this.travellers.push({ e, kind: kind < 0.45 ? 'cart' : kind < 0.7 ? 'rider' : 'walker', dur: len / sp, ph: hash(ei, k, 98), back: hash(ei, k, 99) < 0.5, load: hash(ei, k, 100) });
      }
    });
    // troupeaux : moutons dans les landes (avec leur berger sur échasses), vaches dans les prés, brebis en montagne
    this.herds = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const t = ter[j * W + i], h = hash(i, j, 101);
      let kind = null;
      if (t === T.LANDE && h < 0.012) kind = 'landes';
      else if (t === T.PLAINE && h < 0.007) kind = 'vaches';
      else if ((t === T.MONTAGNE || t === T.COLLINES) && h < 0.009) kind = 'brebis';
      if (!kind) continue;
      const n = kind === 'vaches' ? 3 + ((hash(i, j, 102) * 3) | 0) : 5 + ((hash(i, j, 102) * 6) | 0);
      const beasts = [];
      for (let k = 0; k < n; k++) beasts.push([(hash(i, j, 110 + k) - 0.5) * 0.7, (hash(i, j, 130 + k) - 0.5) * 0.45, hash(i, j, 150 + k) * TAU, hash(i, j, 170 + k) < 0.2]);
      this.herds.push({ x: i + 0.5, y: j + 0.5, kind, beasts, ph: hash(i, j, 103) * TAU });
    }
    // phare de Cordouan, au large de l'estuaire de la Gironde
    const sea = (m.ways || []).find(w => w.sea);
    this.light = null;
    if (sea) {
      const [ex, ey] = sea.pts[0];
      let best = null;
      for (let j = Math.floor(ey) - 10; j <= ey + 10; j++) for (let i = Math.floor(ex) - 14; i <= ex + 4; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const c = j * W + i;
        if (ter[c] !== T.OCEAN || dist[c] < 2 || dist[c] > 4) continue;
        const d = Math.hypot(i + 0.5 - (ex - 7), j + 0.5 - (ey + 3));
        if (!best || d < best.d) best = { d, x: i + 0.5, y: j + 0.5 };
      }
      if (best) this.light = best;
    }
  }

  // ------------------------------------------------------------------ outils
  zoneOf(x, y) {
    const m = this.map.m;
    return y > m.y_mont ? 'montagne' : x < m.x_cote ? 'cote' : 'interieur';
  }
  wind(x, y, st) {
    // force du vent selon le temps qu'il fait dans la région
    const k = st?.weather?.[this.zoneOf(x, y)]?.kind;
    return k === 'tempete' ? 3 : k === 'orage' ? 2.2 : k === 'pluie' ? 1.5 : k === 'brouillard' || k === 'canicule' ? 0.35 : 1;
  }
  view(margin) {
    const mp = this.map, z = mp.cam.z;
    const mx = margin / z;
    return [mp.cam.x - mp.vw / 2 / z - mx, mp.cam.y - mp.vh / 2 / z - mx, mp.cam.x + mp.vw / 2 / z + mx, mp.cam.y + mp.vh / 2 / z + mx];
  }
  scr(x, y) {
    const mp = this.map, c = mp.cam;
    return [(x - c.x) * c.z + mp.vw / 2, (y - c.y) * c.z + mp.vh / 2];
  }

  // ------------------------------------------------------------------ sous les villes et les armées
  under(ctx, dt, time, st) {
    if (!this.on) return;
    const z = this.map.cam.z;
    if (z >= 3.5) this.drawFlows(ctx, time);
    if (z >= 3) this.drawSea(ctx, time);
    this.drawLight(ctx, time);
    if (z >= 6.5) this.drawWaterMills(ctx, time);
    if (z >= 3.6) this.drawMills(ctx, time, st);
    if (z >= 7) this.drawHerds(ctx, time);
    if (z >= 5.5) this.drawTravellers(ctx, time);
    if (z >= 3) this.drawBoats(ctx, time, st);
  }

  // ------------------------------------------------------------------ au-dessus de tout (fumées, oiseaux)
  over(ctx, dt, time, st) {
    if (!this.on) return;
    const z = this.map.cam.z;
    if (z >= 3.2) this.drawSmoke(ctx, time, st);
    if (z >= 4) this.drawGulls(ctx, time);
    this.drawFlocks(ctx, dt, time, st);
  }

  drawFlows(ctx, time) {
    const mp = this.map, z = mp.cam.z, dpr = mp.dpr;
    const ox = mp.vw / 2 - mp.cam.x * z, oy = mp.vh / 2 - mp.cam.y * z;
    ctx.save();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(226,242,255,0.55)';
    for (const f of this.flows) {
      const w = Math.max(f.rank === 1 ? 0.75 : 0.42, (f.rank === 1 ? 3.2 : 2.1) / z) * 0.3;
      const d = Math.max(0.5, 9 / z);
      ctx.lineWidth = w;
      ctx.setLineDash([d * 0.5, d * 1.6]);
      ctx.lineDashOffset = -(time * (f.rank === 1 ? 0.55 : 0.4) + f.ph) % (d * 2.1 * 1000);
      ctx.stroke(f.p);
    }
    ctx.restore();
  }

  drawSea(ctx, time) {
    const z = this.map.cam.z;
    const [x0, y0, x1, y1] = this.view(20);
    // écume : chaque vague roule vers la plage puis s'efface
    if (z >= 4) {
      const P = [new Path2D(), new Path2D(), new Path2D()];
      for (const f of this.foam) {
        if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
        const u = frac(time * 0.16 + f.ph);
        const a = Math.sin(u * Math.PI);
        const b = Math.min(2, (a * 3) | 0);
        const cx = f.x + f.dx * (u * 0.8 - 0.3), cy = f.y + f.dy * (u * 0.8 - 0.3);
        const [sx, sy] = this.scr(cx, cy);
        const L = z * 0.45, px = -f.dy * L, py = f.dx * L;
        P[b].moveTo(sx - px, sy - py);
        P[b].quadraticCurveTo(sx + f.dx * z * 0.12, sy + f.dy * z * 0.12, sx + px, sy + py);
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = clamp(z * 0.12, 1, 2.6);
      P.forEach((p, k) => { ctx.strokeStyle = `rgba(250,253,255,${0.18 + k * 0.25})`; ctx.stroke(p); });
    }
    // reflets du soleil : de brefs scintillements sur l'eau
    ctx.fillStyle = '#fffdf2';
    for (const g of this.glints) {
      if (g.x < x0 || g.x > x1 || g.y < y0 || g.y > y1) continue;
      const a = Math.pow(Math.max(0, Math.sin(time * g.sp + g.ph)), 14);
      if (a < 0.08) continue;
      const [sx, sy] = this.scr(g.x, g.y), r = clamp(z * 0.22, 1.5, 4) * a;
      ctx.globalAlpha = a * 0.9;
      ctx.beginPath();
      ctx.moveTo(sx - r * 2.2, sy); ctx.lineTo(sx, sy - r * 0.45); ctx.lineTo(sx + r * 2.2, sy); ctx.lineTo(sx, sy + r * 0.45);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawLight(ctx, time) {
    const L = this.light;
    if (!L) return;
    const z = this.map.cam.z;
    if (z < 2.2) return;
    const [sx, sy] = this.scr(L.x, L.y);
    if (sx < -200 || sy < -200 || sx > this.map.vw + 200 || sy > this.map.vh + 200) return;
    const s = clamp(z * 1.8, 13, 40);
    // faisceau tournant
    const a = time * 0.8, len = clamp(z * 7, 40, 170), top = sy - s * 0.95;
    ctx.save();
    for (const k of [0, Math.PI]) {
      const dx = Math.cos(a + k), dy = Math.sin(a + k) * 0.55;
      const gr = ctx.createLinearGradient(sx, top, sx + dx * len, top + dy * len);
      gr.addColorStop(0, 'rgba(255,244,190,0.42)'); gr.addColorStop(1, 'rgba(255,244,190,0)');
      ctx.fillStyle = gr;
      const px = -dy * len * 0.13, py = dx * len * 0.13;
      ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx + dx * len + px, top + dy * len + py); ctx.lineTo(sx + dx * len - px, top + dy * len - py); ctx.closePath(); ctx.fill();
    }
    // rocher, tour et lanterne
    ctx.fillStyle = 'rgba(20,30,40,0.35)'; ctx.beginPath(); ctx.ellipse(sx + s * 0.12, sy + s * 0.05, s * 0.42, s * 0.13, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a8270'; ctx.beginPath(); ctx.ellipse(sx, sy, s * 0.36, s * 0.12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f4efe2'; ctx.strokeStyle = '#4a4232'; ctx.lineWidth = Math.max(0.8, s * 0.04);
    ctx.beginPath(); ctx.moveTo(sx - s * 0.16, sy); ctx.lineTo(sx - s * 0.09, sy - s * 0.85); ctx.lineTo(sx + s * 0.09, sy - s * 0.85); ctx.lineTo(sx + s * 0.16, sy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#b4513a'; ctx.fillRect(sx - s * 0.12, sy - s * 0.5, s * 0.24, s * 0.08);
    const glow = 0.75 + 0.25 * Math.sin(time * 5);
    ctx.fillStyle = `rgba(255,226,120,${glow})`; ctx.beginPath(); ctx.arc(sx, top, s * 0.11, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3b3326'; ctx.beginPath(); ctx.moveTo(sx - s * 0.1, top - s * 0.08); ctx.lineTo(sx, top - s * 0.2); ctx.lineTo(sx + s * 0.1, top - s * 0.08); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawMills(ctx, time, st) {
    const z = this.map.cam.z, [x0, y0, x1, y1] = this.view(40);
    const s = clamp(z * 1.15, 10, 28);
    for (const m of this.mills) {
      if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1) continue;
      const [sx, sy] = this.scr(m.x, m.y);
      const a = m.ph + time * m.sp * this.wind(m.x, m.y, st) * 1.4;
      this.windmill(ctx, sx, sy, s, a);
    }
  }

  windmill(ctx, sx, sy, s, a) {
    ctx.fillStyle = 'rgba(30,24,14,0.25)';
    ctx.beginPath(); ctx.ellipse(sx + s * 0.16, sy + s * 0.03, s * 0.3, s * 0.09, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(0.8, s * 0.045); ctx.strokeStyle = '#5c4b30';
    ctx.fillStyle = '#efe6cf';
    ctx.beginPath(); ctx.moveTo(sx - s * 0.18, sy); ctx.lineTo(sx - s * 0.12, sy - s * 0.6); ctx.lineTo(sx + s * 0.12, sy - s * 0.6); ctx.lineTo(sx + s * 0.18, sy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6b4a2e'; ctx.fillRect(sx - s * 0.045, sy - s * 0.17, s * 0.09, s * 0.17);
    ctx.fillStyle = '#9a4f34';
    ctx.beginPath(); ctx.moveTo(sx - s * 0.16, sy - s * 0.58); ctx.lineTo(sx, sy - s * 0.82); ctx.lineTo(sx + s * 0.16, sy - s * 0.58); ctx.closePath(); ctx.fill(); ctx.stroke();
    // ailes
    const hx = sx, hy = sy - s * 0.6, R = s * 0.62, w = s * 0.12;
    ctx.save();
    ctx.translate(hx, hy);
    for (let k = 0; k < 4; k++) {
      const ang = a + k * Math.PI / 2, c = Math.cos(ang), sn = Math.sin(ang);
      ctx.fillStyle = 'rgba(246,240,224,0.95)';
      ctx.beginPath();
      ctx.moveTo(c * R * 0.2, sn * R * 0.2); ctx.lineTo(c * R, sn * R);
      ctx.lineTo(c * R - sn * w, sn * R + c * w); ctx.lineTo(c * R * 0.2 - sn * w, sn * R * 0.2 + c * w);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(74,51,32,0.7)'; ctx.lineWidth = Math.max(0.5, s * 0.02); ctx.stroke();
      ctx.strokeStyle = '#4a3320'; ctx.lineWidth = Math.max(0.9, s * 0.04);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(c * R, sn * R); ctx.stroke();
    }
    ctx.fillStyle = '#4a3320'; ctx.beginPath(); ctx.arc(0, 0, Math.max(1, s * 0.05), 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawWaterMills(ctx, time) {
    const z = this.map.cam.z, [x0, y0, x1, y1] = this.view(40);
    const s = clamp(z * 1.1, 10, 28);
    for (const w of this.wmills) {
      if (w.x < x0 || w.x > x1 || w.y < y0 || w.y > y1) continue;
      const [sx, sy] = this.scr(w.x, w.y);
      // la maison sur la rive, la roue dans le courant
      const nx = -Math.sin(w.a), ny = Math.cos(w.a);
      const side = ny < 0 ? -1 : 1;
      const hx = sx + nx * s * 0.55 * side, hy = sy + ny * s * 0.55 * side;
      ctx.fillStyle = 'rgba(30,24,14,0.3)'; ctx.fillRect(hx - s * 0.3 + 1.5, hy - s * 0.2 + 2, s * 0.6, s * 0.36);
      ctx.fillStyle = '#efe6cf'; ctx.fillRect(hx - s * 0.3, hy - s * 0.2, s * 0.6, s * 0.36);
      ctx.fillStyle = '#a9472f';
      ctx.beginPath(); ctx.moveTo(hx - s * 0.36, hy - s * 0.18); ctx.lineTo(hx, hy - s * 0.46); ctx.lineTo(hx + s * 0.36, hy - s * 0.18); ctx.closePath(); ctx.fill();
      const r = s * 0.28, a = w.ph + time * 1.6;
      ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
      ctx.lineWidth = Math.max(0.7, s * 0.04);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const b = a + k * Math.PI / 3; ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(b) * r * 1.15, sy + Math.sin(b) * r * 1.15); }
      ctx.stroke();
      // remous
      ctx.strokeStyle = `rgba(235,247,255,${0.35 + 0.25 * Math.sin(time * 4 + w.ph)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy + r * 0.2, r * 1.35, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    }
  }

  drawHerds(ctx, time) {
    const z = this.map.cam.z, [x0, y0, x1, y1] = this.view(30);
    const r = clamp(z * 0.1, 1.6, 4.2);
    const wool = new Path2D(), dark = new Path2D(), brown = new Path2D(), heads = new Path2D();
    const shepherds = [];
    for (const h of this.herds) {
      if (h.x < x0 || h.x > x1 || h.y < y0 || h.y > y1) continue;
      // le troupeau dérive lentement en broutant
      const hx = h.x + Math.sin(time * 0.05 + h.ph) * 0.25, hy = h.y + Math.cos(time * 0.04 + h.ph) * 0.15;
      for (const [dx, dy, ph, odd] of h.beasts) {
        const x = hx + dx + Math.sin(time * 0.3 + ph) * 0.03, y = hy + dy + Math.cos(time * 0.23 + ph) * 0.02;
        const [sx, sy] = this.scr(x, y);
        const big = h.kind === 'vaches' ? 1.5 : 1;
        const body = h.kind === 'vaches' ? (odd ? wool : brown) : odd ? dark : wool;
        body.moveTo(sx + r * big * 1.3, sy); body.ellipse(sx, sy, r * big * 1.3, r * big * 0.85, 0, 0, TAU);
        const f = Math.cos(ph) < 0 ? -1 : 1, nod = Math.sin(time * 0.9 + ph * 3) > 0.6 ? r * 0.5 : 0;
        heads.moveTo(sx + f * r * big * 1.5 + r * 0.5, sy - r * 0.3 + nod); heads.arc(sx + f * r * big * 1.5, sy - r * 0.3 + nod, r * 0.5 * big, 0, TAU);
      }
      if (h.kind === 'landes' && z >= 9) shepherds.push([hx - 0.5, hy - 0.2, h.ph]);
    }
    ctx.fillStyle = 'rgba(30,24,14,0.25)';
    ctx.save(); ctx.translate(1, 1.2); ctx.fill(wool); ctx.fill(brown); ctx.fill(dark); ctx.restore();
    ctx.fillStyle = '#f4f0e4'; ctx.fill(wool);
    ctx.fillStyle = '#8a5a34'; ctx.fill(brown);
    ctx.fillStyle = '#4a4036'; ctx.fill(dark);
    ctx.fillStyle = '#2e261c'; ctx.fill(heads);
    // bergers landais, perchés sur leurs échasses
    const s = clamp(z * 0.9, 8, 22);
    for (const [x, y, ph] of shepherds) {
      const [sx, sy] = this.scr(x + Math.sin(time * 0.05 + ph) * 0.2, y);
      const step = Math.sin(time * 2 + ph) * s * 0.08;
      ctx.strokeStyle = '#4a3320'; ctx.lineWidth = Math.max(1, s * 0.05); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx - s * 0.05, sy - s * 0.5); ctx.lineTo(sx - s * 0.1 - step, sy); ctx.moveTo(sx + s * 0.05, sy - s * 0.5); ctx.lineTo(sx + s * 0.1 + step, sy);
      ctx.moveTo(sx + s * 0.18, sy - s * 0.95); ctx.lineTo(sx + s * 0.24, sy - s * 0.15); ctx.stroke();
      ctx.fillStyle = '#5b4a36'; ctx.fillRect(sx - s * 0.09, sy - s * 0.88, s * 0.18, s * 0.38);
      ctx.fillStyle = '#e8d2b0'; ctx.beginPath(); ctx.arc(sx, sy - s * 0.95, s * 0.08, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2e261c'; ctx.beginPath(); ctx.ellipse(sx, sy - s * 1.02, s * 0.12, s * 0.04, 0, 0, TAU); ctx.fill();
    }
  }

  drawTravellers(ctx, time) {
    const mp = this.map, z = mp.cam.z, [x0, y0, x1, y1] = this.view(30);
    const s = clamp(z * 0.95, 9, 22);
    for (const t of this.travellers) {
      const e = t.e;
      if (Math.max(e.A[0], e.B[0]) < x0 || Math.min(e.A[0], e.B[0]) > x1 || Math.max(e.A[1], e.B[1]) < y0 || Math.min(e.A[1], e.B[1]) > y1) continue;
      // va-et-vient d'un bout à l'autre de la route, avec une halte au bourg
      const u = frac(time / (t.dur * 2.3) + t.ph) * 2.3;
      if (u > 2.15 || (u > 1 && u < 1.15)) continue;
      let f = u <= 1 ? u : u - 1.15;
      if ((u > 1) !== t.back) f = 1 - f;
      f = 0.06 + f * 0.88;
      const [x, y] = mp.edgePoint(e, f);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const tg = mp.edgeTangent(e, f);
      const dir = (tg[0] >= 0) !== ((u > 1) !== t.back) ? 1 : -1;
      const [sx, sy] = this.scr(x, y);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(dir, 1);
      if (t.kind === 'cart') this.cart(ctx, s, time, t.load);
      else if (t.kind === 'rider') this.horse(ctx, s, time * 2.4, true);
      else this.walker(ctx, s, time, t.load);
      ctx.restore();
    }
  }

  // trains : sur chaque voie ouverte (et ses sorties vers le bord), un convoi va et vient, locomotive et panache devant
  drawTrains(ctx, time, st) {   // (appelé par la carte après les voies, pour rouler dessus)
    const mp = this.map, R = st && st.rails, secs = mp.m.rails;
    if (!this.on || mp.cam.z < 3.5 || !R || !secs) return;
    const [x0, y0, x1, y1] = this.view(40), s = clamp(mp.cam.z * 1.1, 10, 24);   // (plus large que le trait de la voie)
    const byId = mp.railSecs || (mp.railSecs = new Map(secs.sections.map(x => [x[0], x])));
    const lines = [], served = new Set();
    for (const [sid, kind] of R.state) {
      if (kind !== 'fait') continue;
      const sec = byId.get(sid);
      if (!sec) continue;
      lines.push([sid, mp.railLine(sec)]); served.add(sec[1]); served.add(sec[2]);
    }
    for (const [nid, , dir] of secs.exits) if (served.has(nid)) lines.push([`x${nid}`, mp.railExit(nid, dir)]);
    for (const [key, pts] of lines) {
      const b = pts.box || [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      const cum = pts.cum || [0, Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])];   // (une sortie : deux points)
      let kh = 0;
      for (let i = 0; i < key.length; i++) kh = (kh * 31 + key.charCodeAt(i)) | 0;
      const L = cum[cum.length - 1], h = hash(kh, key.length, 7);   // (chaque voie a son propre horaire)
      // aller (0 à 1), halte en gare, retour, halte : 0,6 km par seconde
      const u = frac(time / (L / 0.6 * 2.4) + h) * 2.4;
      if (u > 2.3 || (u > 1 && u < 1.2)) continue;
      const back = u > 1, f = back ? 1 - (u - 1.2) / 1.1 : u;
      const at = d => {   // point et direction à la distance d le long de la voie
        d = clamp(d, 0, L);
        let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const k = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1e-9), p = pts[i - 1], q = pts[i];
        return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, Math.atan2(q[1] - p[1], q[0] - p[0]) + (back ? Math.PI : 0)];
      };
      const head = f * L, gap = s * 1.05 / mp.cam.z;
      for (let w = 3; w >= 0; w--) {   // wagons derrière, la locomotive en dernier (dessus)
        const [x, y, a] = at(back ? head + w * gap : head - w * gap), [sx, sy] = this.scr(x, y);
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
        ctx.fillStyle = w ? ['#8a3a28', '#4a5a72', '#6e5a30'][w - 1] : '#1a1814';
        ctx.fillRect(-s * 0.48, -s * 0.24, s * 0.96, s * 0.48);
        ctx.strokeStyle = '#f2ece0'; ctx.lineWidth = 1; ctx.strokeRect(-s * 0.48, -s * 0.24, s * 0.96, s * 0.48);
        ctx.restore();
        if (!w) for (let q = 0; q < 3; q++) {   // le panache, qui traîne derrière et monte
          const [px, py] = this.scr(...at(back ? head + (q + 0.5) * gap : head - (q + 0.5) * gap).slice(0, 2));
          ctx.fillStyle = `rgba(238,234,226,${0.5 - q * 0.13})`;
          ctx.beginPath(); ctx.arc(px, py - s * (0.5 + q * 0.2), s * (0.2 + q * 0.1), 0, TAU); ctx.fill();
        }
      }
    }
  }

  horse(ctx, s, time, rider) {
    const leg = Math.sin(time * 6) * s * 0.08;
    ctx.fillStyle = 'rgba(30,24,14,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.32, s * 0.06, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = Math.max(0.8, s * 0.05); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.15, -s * 0.2); ctx.lineTo(s * 0.17 + leg, 0); ctx.moveTo(s * 0.1, -s * 0.2); ctx.lineTo(s * 0.08 - leg, 0);
    ctx.moveTo(-s * 0.15, -s * 0.2); ctx.lineTo(-s * 0.17 - leg, 0); ctx.moveTo(-s * 0.1, -s * 0.2); ctx.lineTo(-s * 0.08 + leg, 0);
    ctx.stroke();
    ctx.fillStyle = '#7a4a2a';
    ctx.beginPath(); ctx.ellipse(0, -s * 0.25, s * 0.22, s * 0.09, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s * 0.16, -s * 0.3); ctx.lineTo(s * 0.28, -s * 0.44); ctx.lineTo(s * 0.34, -s * 0.38); ctx.lineTo(s * 0.22, -s * 0.24); ctx.closePath(); ctx.fill();
    if (rider) {
      ctx.fillStyle = '#2c3a5a'; ctx.fillRect(-s * 0.06, -s * 0.52, s * 0.12, s * 0.2);
      ctx.fillStyle = '#e8d2b0'; ctx.beginPath(); ctx.arc(0, -s * 0.58, s * 0.06, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1e1a16'; ctx.fillRect(-s * 0.08, -s * 0.66, s * 0.16, s * 0.04);
    }
  }

  cart(ctx, s, time, load) {
    ctx.save(); ctx.translate(s * 0.32, 0); this.horse(ctx, s * 0.85, time, false); ctx.restore();
    ctx.strokeStyle = '#4a3320'; ctx.lineWidth = Math.max(0.7, s * 0.03);
    ctx.beginPath(); ctx.moveTo(s * 0.02, -s * 0.2); ctx.lineTo(s * 0.18, -s * 0.24); ctx.stroke();
    ctx.fillStyle = 'rgba(30,24,14,0.25)'; ctx.beginPath(); ctx.ellipse(-s * 0.18, 0, s * 0.26, s * 0.06, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5c3d'; ctx.fillRect(-s * 0.4, -s * 0.3, s * 0.42, s * 0.14);
    // chargement : foin, tonneaux de vin ou sacs de grain
    if (load < 0.4) { ctx.fillStyle = '#d9c56e'; ctx.beginPath(); ctx.ellipse(-s * 0.19, -s * 0.34, s * 0.22, s * 0.12, 0, Math.PI, TAU); ctx.fill(); }
    else if (load < 0.75) { ctx.fillStyle = '#7a4f2a'; for (const dx of [-0.32, -0.19, -0.06]) { ctx.beginPath(); ctx.ellipse(dx * s, -s * 0.36, s * 0.06, s * 0.07, 0, 0, TAU); ctx.fill(); } }
    else { ctx.fillStyle = '#e6dcc0'; ctx.fillRect(-s * 0.36, -s * 0.42, s * 0.3, s * 0.12); }
    const a = time * 4;
    ctx.strokeStyle = '#3b2814'; ctx.lineWidth = Math.max(0.8, s * 0.04);
    ctx.beginPath(); ctx.arc(-s * 0.19, -s * 0.12, s * 0.1, 0, TAU);
    ctx.moveTo(-s * 0.19 + Math.cos(a) * s * 0.1, -s * 0.12 + Math.sin(a) * s * 0.1); ctx.lineTo(-s * 0.19 - Math.cos(a) * s * 0.1, -s * 0.12 - Math.sin(a) * s * 0.1);
    ctx.stroke();
  }

  walker(ctx, s, time, load) {
    const step = Math.sin(time * 7) * s * 0.06;
    ctx.fillStyle = 'rgba(30,24,14,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.1, s * 0.035, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3b2c1c'; ctx.lineWidth = Math.max(0.8, s * 0.045); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -s * 0.18); ctx.lineTo(step, 0); ctx.moveTo(0, -s * 0.18); ctx.lineTo(-step, 0); ctx.stroke();
    ctx.fillStyle = load < 0.5 ? '#8b3a2a' : '#5a6a3a'; ctx.fillRect(-s * 0.05, -s * 0.36, s * 0.1, s * 0.19);
    ctx.fillStyle = '#e8d2b0'; ctx.beginPath(); ctx.arc(0, -s * 0.41, s * 0.05, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d9c9a0'; ctx.beginPath(); ctx.arc(-s * 0.08, -s * 0.33, s * 0.07, 0, TAU); ctx.fill();   // baluchon
  }

  drawBoats(ctx, time, st) {
    const z = this.map.cam.z, [x0, y0, x1, y1] = this.view(40);
    for (const b of this.boats) {
      // aller (vers la mer) puis retour, sans fin
      const s2 = frac((b.s0 + time * b.sp) / (b.pl.len * 2)) * b.pl.len * 2;
      const back = s2 > b.pl.len, s = back ? b.pl.len * 2 - s2 : s2;
      const [x, y, a] = along(b.pl, s);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const head = back ? a + Math.PI : a;
      const [sx, sy] = this.scr(x, y);
      const size = b.sea ? clamp(z * 2, 16, 46) : clamp(z * 1.3, 11, 30);
      this.sailboat(ctx, sx, sy, size, head, time + b.ph, b.sea, this.wind(x, y, st));
    }
    // barques de pêche au large, qui dansent sur la houle
    if (z >= 4.5) {
      const s = clamp(z * 1.1, 9, 22);
      for (const f of this.fishers) {
        if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
        const x = f.x + Math.cos(time * 0.05 + f.ph) * f.r, y = f.y + Math.sin(time * 0.05 + f.ph) * f.r * 0.6;
        const [sx, sy] = this.scr(x, y);
        this.fishing(ctx, sx, sy, s, time + f.ph * 3);
      }
    }
  }

  sailboat(ctx, sx, sy, s, head, t, sea, wind) {
    // sillage (vu de dessus), puis le bateau de profil comme les autres dessins de la carte
    const hx = Math.cos(head), hy = Math.sin(head);
    ctx.strokeStyle = 'rgba(240,250,255,0.55)'; ctx.lineWidth = Math.max(0.8, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(sx - hx * s * 0.3, sy - hy * s * 0.3); ctx.lineTo(sx - hx * s * 0.9 - hy * s * 0.18, sy - hy * s * 0.9 + hx * s * 0.18);
    ctx.moveTo(sx - hx * s * 0.3, sy - hy * s * 0.3); ctx.lineTo(sx - hx * s * 0.9 + hy * s * 0.18, sy - hy * s * 0.9 - hx * s * 0.18);
    ctx.stroke();
    const roll = Math.sin(t * 1.7) * 0.06 * Math.min(2, wind), bob = Math.sin(t * 2.3) * s * 0.03;
    ctx.save();
    ctx.translate(sx, sy + bob);
    ctx.rotate(roll);
    ctx.scale(hx < 0 ? -1 : 1, 1);
    ctx.fillStyle = 'rgba(10,30,50,0.25)'; ctx.beginPath(); ctx.ellipse(0, s * 0.04, s * 0.46, s * 0.07, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = sea ? '#5e3b22' : '#7a5230'; ctx.strokeStyle = '#2e1d10'; ctx.lineWidth = Math.max(0.7, s * 0.03);
    ctx.beginPath(); ctx.moveTo(-s * 0.45, -s * 0.12); ctx.lineTo(s * 0.48, -s * 0.12); ctx.lineTo(s * 0.32, s * 0.02); ctx.lineTo(-s * 0.36, s * 0.02); ctx.closePath(); ctx.fill(); ctx.stroke();
    const bulge = s * 0.06 * Math.min(2, wind);
    const mast = (mx, h, w) => {
      ctx.strokeStyle = '#3b2814'; ctx.beginPath(); ctx.moveTo(mx, -s * 0.12); ctx.lineTo(mx, -s * 0.12 - h); ctx.stroke();
      ctx.fillStyle = '#f6efdc'; ctx.strokeStyle = 'rgba(80,60,40,0.6)';
      ctx.beginPath();
      ctx.moveTo(mx - w / 2, -s * 0.12 - h * 0.92); ctx.quadraticCurveTo(mx + bulge, -s * 0.12 - h * 0.6, mx - w / 2, -s * 0.12 - h * 0.25);
      ctx.lineTo(mx + w / 2, -s * 0.12 - h * 0.25); ctx.quadraticCurveTo(mx + w / 2 + bulge, -s * 0.12 - h * 0.6, mx + w / 2, -s * 0.12 - h * 0.92);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    if (sea) {
      mast(-s * 0.12, s * 0.62, s * 0.3); mast(s * 0.18, s * 0.72, s * 0.34);
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(s * 0.18, -s * 0.84); ctx.lineTo(s * 0.18 - s * 0.16, -s * 0.86 + Math.sin(t * 6) * s * 0.02); ctx.lineTo(s * 0.18, -s * 0.8); ctx.fill();
    } else mast(0, s * 0.62, s * 0.36);
    ctx.restore();
  }

  fishing(ctx, sx, sy, s, t) {
    const roll = Math.sin(t * 1.3) * 0.12, bob = Math.sin(t * 1.9) * s * 0.05;
    ctx.save();
    ctx.translate(sx, sy + bob); ctx.rotate(roll);
    ctx.fillStyle = 'rgba(10,30,50,0.25)'; ctx.beginPath(); ctx.ellipse(0, s * 0.04, s * 0.32, s * 0.06, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6b4a2e'; ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.1); ctx.lineTo(s * 0.3, -s * 0.1); ctx.lineTo(s * 0.2, 0); ctx.lineTo(-s * 0.22, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3b2814'; ctx.lineWidth = Math.max(0.7, s * 0.04);
    ctx.beginPath(); ctx.moveTo(0, -s * 0.1); ctx.lineTo(0, -s * 0.6); ctx.stroke();
    ctx.fillStyle = '#c96f3b'; ctx.beginPath(); ctx.moveTo(0, -s * 0.58); ctx.lineTo(s * 0.26, -s * 0.16); ctx.lineTo(0, -s * 0.14); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawSmoke(ctx, time, st) {
    const mp = this.map, z = mp.cam.z;
    const winter = mp.season === 'hiver';
    const P = [new Path2D(), new Path2D(), new Path2D()], D = [new Path2D(), new Path2D(), new Path2D()];
    const fires = [];
    for (const n of mp.nodes) {
      const [x, y] = this.scr(n.x, n.y);
      if (x < -60 || y < -100 || x > mp.vw + 60 || y > mp.vh + 40) continue;
      const ns = st?.nodes?.[n.id];
      const siege = !!ns?.sg;
      if (n.type === 'village' && z < 5 && !siege) continue;
      const s = mp.nodeSize(n);
      const chim = n.type === 'capitale' ? 3 : n.type === 'ville' ? 2 : 1;
      const w = this.wind(n.x, n.y, st);
      for (let c = 0; c < chim + (siege ? 1 : 0); c++) {
        const seed = hash(n.id, c, 120);
        const bx = x + (seed - 0.5) * s * 0.5, by = y - s * (0.2 + hash(n.id, c, 121) * 0.15);
        const big = siege && c === chim;   // la place assiégée brûle
        const puffs = big ? 6 : winter ? 5 : 4;
        for (let k = 0; k < puffs; k++) {
          const u = frac(time * (big ? 0.28 : 0.16) + seed * 7 + k / puffs);
          const rise = (big ? 1.8 : 1.15) * s;
          const px = bx + u * u * s * 0.9 * w + Math.sin(u * 7 + seed * 9) * s * 0.05;
          const py = by - u * rise / Math.max(1, w * 0.7);
          const r = s * (big ? 0.08 + u * 0.3 : 0.04 + u * 0.13);
          const a = (1 - u) * Math.min(1, u * 6);
          const bucket = Math.min(2, (a * 3) | 0);
          const path = (big ? D : P)[bucket];
          path.moveTo(px + r, py); path.arc(px, py, r, 0, TAU);
        }
        if (big) fires.push([bx, by + s * 0.05, s]);
      }
    }
    const k = winter ? 1.35 : 1;
    P.forEach((p, i) => { ctx.fillStyle = `rgba(238,236,230,${(0.2 + i * 0.16) * k})`; ctx.fill(p); });
    D.forEach((p, i) => { ctx.fillStyle = `rgba(70,64,58,${0.14 + i * 0.12})`; ctx.fill(p); });
    for (const [x, y, s] of fires) {
      const f = 0.6 + 0.4 * Math.sin(time * 13 + x) * Math.sin(time * 7.3 + y);
      ctx.fillStyle = `rgba(255,140,40,${0.55 * f})`;
      ctx.beginPath(); ctx.ellipse(x, y, s * 0.12 * (1 + f * 0.3), s * 0.18 * (1 + f * 0.4), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,226,120,${0.7 * f})`;
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.03, s * 0.06, s * 0.1, 0, 0, TAU); ctx.fill();
    }
  }

  bird(path, x, y, w, flap) {
    const tip = y - flap * w * 0.55;
    path.moveTo(x - w, tip);
    path.quadraticCurveTo(x - w * 0.45, y - w * 0.4 + flap * w * 0.1, x, y);
    path.quadraticCurveTo(x + w * 0.45, y - w * 0.4 + flap * w * 0.1, x + w, tip);
  }

  drawGulls(ctx, time) {
    const z = this.map.cam.z, [x0, y0, x1, y1] = this.view(40);
    const w = clamp(z * 0.4, 3.5, 8);
    const p = new Path2D();
    for (const g of this.gulls) {
      if (g.x < x0 - 2 || g.x > x1 + 2 || g.y < y0 - 2 || g.y > y1 + 2) continue;
      for (let k = 0; k < g.n; k++) {
        const a = g.ph + k * TAU / g.n + time * g.sp;
        const [sx, sy] = this.scr(g.x + Math.cos(a) * g.r, g.y + Math.sin(a) * g.r * 0.6);
        this.bird(p, sx, sy, w, Math.sin(time * 5 + k * 2 + g.ph) * 0.7);
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(40,50,60,0.45)'; ctx.lineWidth = 3; ctx.stroke(p);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke(p);
  }

  // vols d'oiseaux en V qui traversent l'écran ; plus nombreux aux saisons des migrations
  drawFlocks(ctx, dt, time, st) {
    const mp = this.map, z = mp.cam.z;
    const R = Math.hypot(mp.vw, mp.vh) / 2 / z;
    const season = mp.season;
    const rate = season === 'automne' || season === 'printemps' ? 1 / 9 : 1 / 18;
    if (this.flocks.length < 3 && Math.random() < dt * rate) {
      const ang = (season === 'automne' ? Math.PI * 0.6 : season === 'printemps' ? -Math.PI * 0.4 : Math.random() * TAU) + (Math.random() - 0.5) * 0.9;
      const dx = Math.cos(ang), dy = Math.sin(ang), off = (Math.random() - 0.5) * R * 1.4;
      const n = 5 + ((Math.random() * 7) | 0);
      this.flocks.push({ x: mp.cam.x - dx * R * 1.1 - dy * off, y: mp.cam.y - dy * R * 1.1 + dx * off, dx, dy,
                         v: (45 + Math.random() * 30) / z, trav: 0, max: R * 2.4, n, ph: Math.random() * TAU, migr: season === 'automne' || season === 'printemps' });
    }
    const p = new Path2D();
    const w = 5.5;
    this.flocks = this.flocks.filter(f => {
      f.x += f.dx * f.v * dt; f.y += f.dy * f.v * dt; f.trav += f.v * dt;
      if (f.trav > f.max) return false;
      const [cx, cy] = this.scr(f.x, f.y);
      const sdx = f.dx, sdy = f.dy;
      for (let k = 0; k < f.n; k++) {
        const rank = Math.ceil(k / 2), side = k % 2 ? 1 : -1, sp = f.migr ? 13 : 10;
        const back = rank * sp, lat = side * rank * sp * 0.75;
        const wob = Math.sin(time * 1.3 + k * 1.7 + f.ph) * 2;
        const bx = cx - sdx * back - sdy * (lat + wob), by = cy - sdy * back + sdx * (lat + wob);
        this.bird(p, bx, by, w, Math.sin(time * 9 + k * 0.9 + f.ph));
      }
      return true;
    });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(28,26,22,0.75)'; ctx.lineWidth = 1.5;
    ctx.stroke(p);
  }
}
