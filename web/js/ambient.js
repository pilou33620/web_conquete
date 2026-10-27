// Vie de la carte de campagne (SPEC-CARTE-2D.md, chantier C). La vie des pays vient de la maquette, portée dans
// carte/vie.js : passants, voitures et bêtes sur les routes et dans les pays, travaux de la saison, bateaux, pêcheurs,
// relais, marchés et foires, contrebandiers, moulins, fumées, ombres des nuages, oiseaux, Cordouan. Restent ici le
// branchement sur la carte (deux passes : sous les villes, au-dessus), l'écume et les reflets de la mer, le courant
// des fleuves et les trains des voies ferrées. Purement décoratif : animé en temps réel (même partie en pause),
// dessiné seulement pour ce qui est à l'écran, au zoom où on le distingue. Animations coupées (ou mouvement réduit) :
// la vie reste dessinée, immobile.
import { clamp } from './battle/formes.js';
import { VIE, preparer, majEtat, dessinerSol, dessinerDessus, avancer, ventDe } from './carte/vie.js';
import { meteoEn } from './carte/ambiance.js';
const T = { OCEAN: 0 };
const TAU = Math.PI * 2;
const frac = v => v - Math.floor(v);
function hash(i, j, k = 0) {
  let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// trains d'époque, de profil (l'avant vers +x, le rail en y = 0, longueur s px) : la locomotive à vapeur, son tender, une voiture
function roue(ctx, x, r, a, rayons) {
  ctx.fillStyle = '#1a1612'; ctx.beginPath(); ctx.arc(x, -r, r, 0, TAU); ctx.fill();
  if (!rayons) return;
  ctx.strokeStyle = '#6a5a48'; ctx.lineWidth = Math.max(0.6, r * 0.18);
  ctx.beginPath(); ctx.arc(x, -r, r * 0.82, 0, TAU);
  for (let k = 0; k < 3; k++) { const c = Math.cos(a + k * 1.047) * r * 0.8, d = Math.sin(a + k * 1.047) * r * 0.8; ctx.moveTo(x - c, -r - d); ctx.lineTo(x + c, -r + d); }
  ctx.stroke();
}
export function locomotive(ctx, s, time, corps = '#2f4a34') {
  const a = time * 9, R = s * 0.15, fin = s >= 16;
  ctx.fillStyle = '#1a1612'; ctx.fillRect(-s * 0.48, -s * 0.2, s * 0.94, s * 0.06);                        // châssis
  ctx.fillStyle = '#9a2a1e'; ctx.fillRect(s * 0.44, -s * 0.24, s * 0.06, s * 0.12);                         // traverse rouge, tampons
  ctx.fillStyle = corps; ctx.fillRect(-s * 0.2, -s * 0.44, s * 0.56, s * 0.25);                             // chaudière
  ctx.fillStyle = '#22201c'; ctx.fillRect(s * 0.32, -s * 0.44, s * 0.1, s * 0.25);                          // boîte à fumée
  ctx.fillStyle = '#22201c';                                                                                // cheminée évasée (en tulipe)
  ctx.beginPath(); ctx.moveTo(s * 0.34, -s * 0.44); ctx.lineTo(s * 0.3, -s * 0.68); ctx.lineTo(s * 0.46, -s * 0.68); ctx.lineTo(s * 0.4, -s * 0.44); ctx.fill();
  ctx.fillStyle = '#c8a24a'; ctx.beginPath(); ctx.arc(s * 0.08, -s * 0.44, s * 0.07, Math.PI, TAU); ctx.fill();   // dôme de laiton
  ctx.fillStyle = corps; ctx.fillRect(-s * 0.48, -s * 0.64, s * 0.28, s * 0.46);                            // cabine
  ctx.fillStyle = '#22201c'; ctx.fillRect(-s * 0.51, -s * 0.68, s * 0.34, s * 0.05);                        // son toit
  ctx.fillStyle = '#e8d8a8'; ctx.fillRect(-s * 0.4, -s * 0.58, s * 0.12, s * 0.12);                         // fenêtre
  if (fin) { ctx.fillStyle = '#c8a24a'; for (const x of [-0.1, 0.14]) ctx.fillRect(x * s, -s * 0.44, s * 0.025, s * 0.25); }   // cerclages
  roue(ctx, s * 0.38, s * 0.07, a * 2, false); roue(ctx, -s * 0.36, s * 0.07, a * 2, false);               // petites roues
  roue(ctx, -s * 0.08, R, a, fin); roue(ctx, s * 0.2, R, a, fin);                                           // grandes roues motrices
  const cx = Math.cos(a) * R * 0.55, cy = Math.sin(a) * R * 0.55;                                           // la bielle d'accouplement
  ctx.strokeStyle = '#b8b0a0'; ctx.lineWidth = Math.max(0.8, s * 0.035);
  ctx.beginPath(); ctx.moveTo(-s * 0.08 + cx, -R + cy); ctx.lineTo(s * 0.2 + cx, -R + cy); ctx.stroke();
}
export function tender(ctx, s, corps = '#2f4a34') {
  ctx.fillStyle = '#1a1612'; ctx.fillRect(-s * 0.3, -s * 0.18, s * 0.6, s * 0.05);
  ctx.fillStyle = corps; ctx.fillRect(-s * 0.28, -s * 0.4, s * 0.56, s * 0.24);
  ctx.fillStyle = '#121010'; ctx.beginPath(); ctx.ellipse(0, -s * 0.4, s * 0.24, s * 0.07, 0, Math.PI, TAU); ctx.fill();   // le charbon
  roue(ctx, -s * 0.16, s * 0.08, 0, false); roue(ctx, s * 0.16, s * 0.08, 0, false);
}
export function voiture(ctx, s, corps) {   // voiture à compartiments, toit bombé, fenêtres ; ou wagon couvert
  ctx.fillStyle = '#1a1612'; ctx.fillRect(-s * 0.44, -s * 0.18, s * 0.88, s * 0.05);
  ctx.fillStyle = corps; ctx.fillRect(-s * 0.42, -s * 0.5, s * 0.84, s * 0.34);
  ctx.fillStyle = '#3a3430'; ctx.beginPath(); ctx.ellipse(0, -s * 0.5, s * 0.44, s * 0.06, 0, Math.PI, TAU); ctx.fill();
  ctx.fillStyle = '#e8d8a8'; for (const x of [-0.3, -0.06, 0.18]) ctx.fillRect(x * s, -s * 0.44, s * 0.12, s * 0.12);
  roue(ctx, -s * 0.26, s * 0.08, 0, false); roue(ctx, s * 0.26, s * 0.08, 0, false);
}

// les mêmes, vus du ciel (l'avant vers +x, longueur s px, la voie en y = 0) : chaudière, dôme et cheminée, cabine ; le
// tender et son charbon ; une voiture de voyageurs (toit) ou un wagon de marchandises (planches ; charge 0 à 2 : charbon,
// grumes, bâche)
function caisse(ctx, s, l, w, c) { ctx.fillStyle = 'rgba(20,20,10,.28)'; ctx.fillRect(-l / 2 + s * 0.03, -w / 2 + s * 0.04, l, w); ctx.fillStyle = c; ctx.fillRect(-l / 2, -w / 2, l, w); }
export function locoDessus(ctx, s, corps = '#2f4a34') {
  caisse(ctx, s, s * 0.92, s * 0.28, '#1a1612');                                                            // tablier
  ctx.fillStyle = corps; ctx.beginPath(); ctx.roundRect(-s * 0.2, -s * 0.1, s * 0.6, s * 0.2, s * 0.08); ctx.fill();   // chaudière
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(-s * 0.18, -s * 0.075, s * 0.56, s * 0.035);
  ctx.fillStyle = '#c8a24a'; ctx.beginPath(); ctx.arc(s * 0.06, 0, s * 0.05, 0, TAU); ctx.fill();          // dôme de laiton
  ctx.fillStyle = '#22201c'; ctx.beginPath(); ctx.arc(s * 0.32, 0, s * 0.06, 0, TAU); ctx.fill();          // cheminée
  ctx.fillStyle = '#0a0908'; ctx.beginPath(); ctx.arc(s * 0.32, 0, s * 0.032, 0, TAU); ctx.fill();
  ctx.fillStyle = corps; ctx.fillRect(-s * 0.46, -s * 0.14, s * 0.26, s * 0.28);                            // cabine
  ctx.fillStyle = '#22201c'; ctx.fillRect(-s * 0.44, -s * 0.12, s * 0.22, s * 0.24);                        // son toit
  ctx.fillStyle = '#9a2a1e'; ctx.fillRect(s * 0.44, -s * 0.13, s * 0.04, s * 0.26);                         // traverse rouge
}
export function tenderDessus(ctx, s, corps = '#2f4a34') {
  caisse(ctx, s, s * 0.6, s * 0.26, corps);
  ctx.fillStyle = '#121010'; ctx.beginPath(); ctx.roundRect(-s * 0.23, -s * 0.09, s * 0.46, s * 0.18, s * 0.05); ctx.fill();   // le charbon
  ctx.fillStyle = 'rgba(200,200,210,.25)'; for (const [x, y] of [[-0.12, -0.03], [0.05, 0.04], [0.14, -0.04]]) ctx.fillRect(x * s, y * s, s * 0.03, s * 0.02);
}
export function voitureDessus(ctx, s, corps, charge = null) {
  caisse(ctx, s, s * 0.88, s * 0.28, corps);
  if (charge == null) {   // toit bombé, clair au faîte, lanternes de toit
    ctx.fillStyle = '#3a3430'; ctx.fillRect(-s * 0.42, -s * 0.11, s * 0.84, s * 0.22);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(-s * 0.42, -s * 0.02, s * 0.84, s * 0.04);
    ctx.fillStyle = '#d8cfb8'; for (const x of [-0.27, -0.09, 0.09, 0.27]) { ctx.beginPath(); ctx.arc(x * s, 0, s * 0.022, 0, TAU); ctx.fill(); }
    return;
  }
  ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = Math.max(0.5, s * 0.012);   // planches, et le chargement : charbon, grumes, bâche
  ctx.beginPath(); for (const x of [-0.3, -0.15, 0, 0.15, 0.3]) { ctx.moveTo(x * s, -s * 0.14); ctx.lineTo(x * s, s * 0.14); } ctx.stroke();
  const k = charge % 3;
  ctx.fillStyle = ['#151313', '#8a6a45', '#c9c0a4'][k]; ctx.beginPath(); ctx.roundRect(-s * 0.36, -s * 0.09, s * 0.72, s * 0.18, s * (k === 2 ? 0.07 : 0.02)); ctx.fill();
}

export class Ambient {
  constructor(map) {
    this.map = map;
    let saved = null;
    try { saved = localStorage.getItem('conquete.anim'); } catch (e) { /* stockage indisponible */ }
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* API absente */ }
    this.on = saved ? saved !== '0' : !reduced;
    this.t = 0;   // l'horloge de la vie : n'avance que si les animations sont permises
    // la scène vue par carte/vie.js (comme la Scene de la maquette) : monde en km, figures orientées, fumées
    this.sc = {
      fx: [], max: 400, ventA: Math.atan2(-0.002, 0.004),
      monde(g) { const m = this.m; g.setTransform(m, 0, 0, m, -this.cx * m + this.W / 2, -this.cy * m + this.H / 2); },
      fig(g, x, y, a) { const m = this.m, c = Math.cos(a) * m, s = Math.sin(a) * m; g.setTransform(c, s, -s, c, (x - this.cx) * m + this.W / 2, (y - this.cy) * m + this.H / 2); },
    };
    this.build();
    preparer(map);
  }

  setOn(v) {
    this.on = v;
    try { localStorage.setItem('conquete.anim', v ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  }

  // ------------------------------------------------------------------ préparation (une fois)
  build() {
    const mp = this.map, W = mp.W, H = mp.H, ter = mp.terrain, m = mp.m;
    // distance à la terre, en mer (pour l'écume, les barques, les reflets)
    const N = W * H, dist = new Int16Array(N).fill(-1), q = [];
    for (let c = 0; c < N; c++) if (ter[c] !== T.OCEAN) { dist[c] = 0; q.push(c); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], i = c % W, j = (c / W) | 0, d = dist[c] + 1;
      if (d > 40) continue;
      for (const n of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1]) if (n >= 0 && dist[n] < 0) { dist[n] = d; q.push(n); }
    }
    this.foam = []; this.glints = [];
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
      }
      if (d >= 1 && hash(i, j, 82) < 0.05) this.glints.push({ x: i + hash(i, j, 83), y: j + hash(i, j, 84), ph: hash(i, j, 86) * TAU, sp: 0.6 + hash(i, j, 87) * 0.8 });
    }
    // courant des fleuves : tirets clairs qui descendent vers l'embouchure (les tracés vont de la source à la mer) ; en
    // morceaux de 48 pas avec leur emprise, comme les rivières des tuiles (map.js, lineChunks) : chaque image ne trace que
    // ceux de la vue (s : la longueur de la rivière avant le morceau, pour que les tirets se suivent)
    this.flows = [];
    m.rivers.filter(r => r.rank <= 2).forEach((r, k) => {
      let s = 0;
      for (let a = 0; a < r.pts.length - 1; a += 48) {
        const pts = r.pts.slice(a, a + 49), p = new Path2D(), xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        pts.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y));
        this.flows.push({ p, rank: r.rank, ph: hash(k, 7, 95) * 10, s, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
        for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
    });
  }

  // ------------------------------------------------------------------ outils
  view(margin) {
    const mp = this.map, z = mp.cam.z;
    const mx = margin / z;
    return [mp.cam.x - mp.vw / 2 / z - mx, mp.cam.y - mp.vh / 2 / z - mx, mp.cam.x + mp.vw / 2 / z + mx, mp.cam.y + mp.vh / 2 / z + mx];
  }
  scr(x, y) {
    const mp = this.map, c = mp.cam;
    return [(x - c.x) * c.z + mp.vw / 2, (y - c.y) * c.z + mp.vh / 2];
  }

  // la scène de cette image (l'horloge avance de dt) ; renvoie les bornes de la vue en km, à un demi-kilomètre près
  scene(dt) {
    const mp = this.map, c = mp.cam, d = mp.dpr, sc = this.sc;
    if (this.on) this.t += dt;
    Object.assign(sc, { z: c.z, d, m: c.z * d, cx: c.x, cy: c.y, W: mp.vw * d, H: mp.vh * d, cssW: mp.vw, cssH: mp.vh, time: this.t, on: this.on });
    const hw = mp.vw / 2 / c.z + 0.5, hh = mp.vh / 2 / c.z + 0.5;
    return [c.x - hw, c.y - hh, c.x + hw, c.y + hh];
  }

  // ------------------------------------------------------------------ sous les villes et les armées
  under(ctx, dt, time, st) {
    const z = this.map.cam.z, zoom = this.map.zooming();   // (pendant un zoom, les petites figures qui bougent attendent)
    if (st !== this.st) { this.st = st; majEtat(st); }
    const [x0, y0, x1, y1] = this.scene(dt), sc = this.sc;
    if (this.on) {
      if (z >= 3.5 && z < 18 && !zoom) this.drawFlows(ctx, this.t);   // (de plus près, la rivière peinte par les tuiles suffit)
      if (z >= 3) this.drawSea(ctx, this.t);
      const w = ventDe(meteoEn(this.map.cam.x, this.map.cam.y));
      avancer(sc, dt, 0.004 * w, -0.002 * w);
    }
    ctx.save();
    dessinerSol(sc, ctx, x0, y0, x1, y1, this.map.epoque);
    ctx.restore();
  }

  // ------------------------------------------------------------------ au-dessus des villes (marchés, fumées, nuages, oiseaux)
  over(ctx, dt, time, st) {
    const [x0, y0, x1, y1] = this.scene(0);
    ctx.save();
    dessinerDessus(this.sc, ctx, x0, y0, x1, y1);
    ctx.restore();
  }

  drawFlows(ctx, time) {
    const mp = this.map, z = mp.cam.z, dpr = mp.dpr;
    const ox = mp.vw / 2 - mp.cam.x * z, oy = mp.vh / 2 - mp.cam.y * z;
    ctx.save();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(226,242,255,0.55)';
    const [x0, y0, x1, y1] = this.view(10);
    for (const f of this.flows) {
      if (f.box[0] > x1 || f.box[2] < x0 || f.box[1] > y1 || f.box[3] < y0) continue;
      const w = Math.max(f.rank === 1 ? 0.75 : 0.42, (f.rank === 1 ? 3.2 : 2.1) / z) * 0.3;
      const d = Math.max(0.5, 9 / z);
      ctx.lineWidth = w;
      ctx.setLineDash([d * 0.5, d * 1.6]);
      ctx.lineDashOffset = -(time * (f.rank === 1 ? 0.55 : 0.4) + f.ph) % (d * 2.1 * 1000) + f.s;
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

  // trains : sur chaque voie ouverte (et ses sorties vers le bord), un convoi va et vient, locomotive et panache devant.
  // Vu du ciel, de dessus, voitures ou wagons, le panache laissé en arrière et poussé par le vent ; sur la carte d'époque,
  // de profil
  drawTrains(ctx, time, st) {   // (appelé par la carte après les voies, pour rouler dessus)
    const mp = this.map, R = st && st.rails, secs = mp.m.rails, z = mp.cam.z;
    if (!this.on || z < 3.5 || !R || !secs) return;
    const ciel = !mp.papierVu?.(), [x0, y0, x1, y1] = this.view(40), s = Math.max(clamp(z * 1.4, 12, 28), ciel ? z * 0.12 : 0);   // (plus large que le trait de la voie)
    const byId = mp.railSecs || (mp.railSecs = new Map(secs.sections.map(x => [x[0], x])));
    const lines = [], served = new Set();
    for (const [sid, kind] of R.state) {
      if (kind !== 'fait') continue;
      const sec = byId.get(sid);
      if (!sec) continue;
      lines.push([sid, mp.railLine(sec)]); served.add(sec[1]); served.add(sec[2]);
    }
    for (const [nid, , dir] of secs.exits) if (served.has(nid)) lines.push([`x${nid}`, mp.railExit(nid, dir)]);
    const wn = Math.hypot(0.004, 0.002), wx = 0.004 / wn, wy = -0.002 / wn;   // le vent d'ouest (carte/guerre.js, VENT)
    for (const [key, pts] of lines) {
      const b = pts.box || [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      const cum = pts.cum || [0, Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])];   // (une sortie : deux points)
      let kh = 0;
      for (let i = 0; i < key.length; i++) kh = (kh * 31 + key.charCodeAt(i)) | 0;
      const L = cum[cum.length - 1], h = hash(kh, key.length, 7);   // (chaque voie a son propre horaire)
      // aller (0 à 1), halte en gare, retour, halte : 0,6 km par seconde. null : en gare
      const marche = tm => { const u = frac(tm / (L / 0.6 * 2.4) + h) * 2.4; return u > 2.3 || (u > 1 && u < 1.2) ? null : u > 1 ? [1 - (u - 1.2) / 1.1, true] : [u, false]; };
      const m0 = marche(time);
      if (!m0) continue;
      const at = (d, back) => {   // point et direction à la distance d le long de la voie
        d = clamp(d, 0, L);
        let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const k = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1e-9), p = pts[i - 1], q = pts[i];
        return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, Math.atan2(q[1] - p[1], q[0] - p[0]) + (back ? Math.PI : 0)];
      };
      const [f, back] = m0, head = f * L, gap = s * 1.05 / z, fret = kh & 4;
      for (let w = 4; w >= 0; w--) {   // voitures derrière, le tender, la locomotive en dernier (dessus)
        const [x, y, a] = at(back ? head + w * gap : head - w * gap, back), [sx, sy] = this.scr(x, y), flip = !ciel && Math.cos(a) < 0;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(flip ? a + Math.PI : a); ctx.scale(flip ? -1 : 1, 1);   // (de profil, toujours debout)
        const corps = ['#6e3a24', '#b8923a', '#4a5a72'][(w + (kh & 3)) % 3];
        if (ciel) { if (!w) locoDessus(ctx, s); else if (w === 1) tenderDessus(ctx, s); else voitureDessus(ctx, s, fret ? ['#5a4632', '#6e3a24', '#4f4a44'][(w + (kh & 255)) % 3] : corps, fret ? (w + (kh >> 3 & 7)) % 3 : null); }
        else if (!w) locomotive(ctx, s, time); else if (w === 1) { ctx.translate(s * 0.1, 0); tender(ctx, s); }
        else voiture(ctx, s, corps);
        ctx.restore();
      }
      if (!ciel) {
        for (let q = 0; q < 4; q++) {   // le panache sort de la cheminée, traîne derrière et monte
          const u = frac(time * 1.4 + q / 4), [px, py] = this.scr(...at(back ? head - s * 0.38 / z + u * gap * 1.6 : head + s * 0.38 / z - u * gap * 1.6, back).slice(0, 2));
          ctx.fillStyle = `rgba(238,234,226,${0.6 * (1 - u)})`;
          ctx.beginPath(); ctx.arc(px, py - s * (0.72 + u * 0.4), s * (0.1 + u * 0.22), 0, TAU); ctx.fill();
        }
        continue;
      }
      // vu du ciel : chaque bouffée part de la cheminée où était la locomotive, grossit, pâlit et dérive sous le vent
      for (let q = 0; q < 7; q++) {
        const u = frac(time * 0.8 + q / 7), m = marche(time - u * 1.25);
        if (!m) continue;
        const [px, py] = this.scr(...at(m[0] * L + (m[1] ? -1 : 1) * s * 0.32 / z, m[1]).slice(0, 2)), d = u * s * 1.4;
        ctx.fillStyle = `rgba(${u < 0.15 ? '120,116,110' : '240,237,230'},${0.75 * (1 - u)})`;
        ctx.beginPath(); ctx.arc(px + wx * d, py + wy * d, s * (0.07 + u * 0.3), 0, TAU); ctx.fill();
      }
    }
  }
}
