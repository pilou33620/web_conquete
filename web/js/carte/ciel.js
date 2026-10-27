// Le ciel de la carte vue du ciel (SPEC-CARTE-2D.md, chantier D) : la météo de chaque zone (averses, orages,
// brouillard, neige, tempête, canicule), la brume du matin sur les fleuves, l'heure du jour (voile du matin, du
// soir, de la nuit), puis les lumières de l'image (LUM, en « lighter ») : villes allumées, feux, incendies, coups
// de canon, et le phare de Cordouan. Un petit sélecteur d'heure se range sous les boutons de zoom.
import { AMB, HEURES, LUM, Z, setHeure, zoneDe } from './ambiance.js';
import { SPR, TAU, clamp, mod, sprite, surChemin } from './lib.js';
import { rayonPlace } from './guerre.js';
import { terre } from './terre.js';
import { IC, S as SU, etatVille, imageEnCache, resPour } from './villes.js';

sprite('fen', '255,214,140'); sprite('pluie', '64,74,88'); sprite('gaz', '226,236,255');
const hash2 = (i, j, k = 0) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
export const TEINTE_HEURE = { matin: '#f6dcc6', soir: '#f2c9a2', nuit: '#5a6b9e' };
const PLUIE = new Set(['pluie', 'orage', 'tempete']);
const NOM_H = { matin: 'Matin', midi: 'Midi', soir: 'Soir', nuit: 'Nuit' };
const ICONE_H = {
  matin: '<path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 6v3M5.5 9.5l2 2M18.5 9.5l-2 2"/>',
  midi: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  soir: '<path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 7v4M10 9l2 2 2-2"/>',
  nuit: '<path d="M16 15.5A6.5 6.5 0 0 1 9.5 6a6.5 6.5 0 1 0 6.5 9.5z"/>',
};

const eclaircir = (c, k) => { const v = parseInt(c.slice(1), 16); return '#' + [16, 8, 0].map(s => Math.round((v >> s & 255) + (255 - (v >> s & 255)) * k).toString(16).padStart(2, '0')).join(''); };

export class Ciel {
  constructor(map) {
    this.map = map;
    this.pool = { cote: [], interieur: [], montagne: [] };   // flocons, par zone
    this.flash = { cote: 0, interieur: 0, montagne: 0 };
    // les averses : des cellules de pluie de 7 à 17 km qui traversent la carte avec le vent
    this.averses = Array.from({ length: 64 }, (_, k) => ({ k, x0: hash2(k, 1, 103) * (map.W + 120), y0: hash2(k, 2, 103) * map.H, r: 7 + hash2(k, 3, 103) * 10, eclair: 0, bolt: null }));
    // la brume du matin : des nappes le long des grands fleuves
    this.brume = [];
    for (const r of map.m.rivers || []) if (r.rank <= 2) {
      let L = 0; for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      for (let s = 0; s < L; s += 2.2) { const h = hash2(s * 10 | 0, r.pts.length, 104); if (h < 0.3) continue; const p = surChemin(r.pts, s), a = h * 40; this.brume.push([p.x + Math.cos(a) * h * 1.5, p.y + Math.sin(a) * h * 1.5, h]); }
    }
    // le phare de Cordouan, sur son plateau de roches à l'entrée de l'estuaire
    let best = null;
    for (let dx = -3; dx <= 3; dx += 0.5) for (let dy = -3; dy <= 3; dy += 0.5) { const x = 54 + dx, y = 21 + dy; if (this.eau(x, y)) { const d = Math.hypot(dx, dy); if (!best || d < best.d) best = { x, y, d }; } }
    this.cordouan = best;
    this.fenetres = new Map();
    this.selecteur();
  }
  eau(x, y) { const mp = this.map, i = x | 0, j = y | 0; return i < 0 || j < 0 || i >= mp.W || j >= mp.H || mp.terrain[j * mp.W + i] <= 1; }

  // le sélecteur d'heure : quatre petits boutons en rang, à gauche du premier bouton du zoom (réglage d'affichage,
  // enregistré par setHeure) ; en haut, pour laisser le bas aux avis (#feed)
  selecteur() {
    const bar = typeof document !== 'undefined' && document.getElementById?.('zoombar');
    if (!bar || !document.createElement) return;
    const box = document.createElement('div');
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Heure du jour');
    box.style.cssText = 'position:absolute;right:calc(100% + 6px);top:0;display:flex;gap:3px';
    const maj = () => { for (const b of box.querySelectorAll('button')) { const on = b.dataset.h === AMB.heure; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); } };
    for (const h of HEURES) {
      const b = document.createElement('button');
      b.className = 'zb'; b.type = 'button'; b.dataset.h = h;
      b.setAttribute('aria-label', NOM_H[h]); b.title = `Heure : ${NOM_H[h].toLowerCase()}`;
      b.style.width = b.style.height = '34px';
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONE_H[h]}</svg>`;
      b.addEventListener('click', () => { setHeure(h); maj(); });
      box.appendChild(b);
    }
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.appendChild(box);
    this.box = box;
    maj();
  }

  // ---------------------------------------------------------------- l'image
  dessiner(ctx, dt, time) {
    const mp = this.map, st = mp.state, vivant = !mp.papierVu();   // (le style « époque » n'a ni brume, ni heure, ni lumières)
    if (!st) return;
    const z = mp.cam.z, d = mp.dpr, W = mp.vw * d, H = mp.vh * d;
    const [mx0, my0] = mp.toScreen(0, 0), [mx1, my1] = mp.toScreen(mp.W, mp.H);
    const X0 = Math.max(0, mx0), Y0 = Math.max(0, my0), X1 = Math.min(mp.vw, mx1), Y1 = Math.min(mp.vh, my1);
    if (X1 <= X0 || Y1 <= Y0) return;
    const [wx0, wy0] = mp.toWorld(0, 0), [wx1, wy1] = mp.toWorld(mp.vw, mp.vh);
    const monde = () => ctx.setTransform(z * d, 0, 0, z * d, (mp.vw / 2 - mp.cam.x * z) * d, (mp.vh / 2 - mp.cam.y * z) * d);
    const kind = zn => st.weather?.[zn]?.kind || 'soleil';
    const zones = this.zones(X0, Y0, X1, Y1);
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.beginPath(); ctx.rect(X0, Y0, X1 - X0, Y1 - Y0); ctx.clip();   // (le temps s'arrête au bord de la carte)
    // 1) les voiles de chaque zone, sur un calque en très basse résolution que le navigateur agrandit
    this.voiles(ctx, zones, kind, dt);
    // 2) brouillard en nappes, brume du matin sur les fleuves
    monde();
    const brouillard = Object.entries(zones).some(([zn, zr]) => zr[2] > zr[0] && zr[3] > zr[1] && kind(zn) === 'brouillard');
    // (de loin, le voile suffit : les nappes, des points de quelques pixels, coûteraient sans se voir)
    if (vivant && z >= 4 && (AMB.heure === 'matin' || brouillard)) {
      for (const [x, y, h] of this.brume) {
        if (x < wx0 - 6 || x > wx1 + 6 || y < wy0 - 6 || y > wy1 + 6) continue;
        const bz = kind(zoneDe(x, y)) === 'brouillard';
        if (AMB.heure !== 'matin' && !bz) continue;
        const r = 2 + h * 3; ctx.globalAlpha = (bz ? 0.5 : 0.36) * (0.6 + h * 0.4);
        ctx.drawImage(SPR.f, x - r + Math.sin(time * 0.02 + h * 9) * 0.4, y - r * 0.7, r * 2, r * 1.4);
      }
    }
    if (vivant && brouillard && z >= 4) {
      const pas = Math.max(3, (wx1 - wx0) / 22);
      for (let y = Math.floor(wy0 / pas) * pas; y < wy1 + pas; y += pas) for (let x = Math.floor(wx0 / pas) * pas; x < wx1 + pas; x += pas) {
        if (kind(zoneDe(x, y)) !== 'brouillard' || this.eau(x, y) && hash2(x | 0, y | 0, 131) < 0.5) continue;
        if (terre(mp).alt(x, y) > 0.3) continue;   // la brume reste dans les fonds, les coteaux et les sommets en sortent
        const h = hash2(x * 3 | 0, y * 3 | 0, 132), r = pas * (0.9 + h);
        ctx.globalAlpha = 0.3; ctx.drawImage(SPR.f, x - r + Math.sin(time * 0.015 + h * 9) * pas * 0.2, y - r * 0.7, r * 2, r * 1.4);
      }
    }
    ctx.globalAlpha = 1;
    // 3) les averses, qui passent avec le vent ; l'orage a ses éclairs, la tempête sa pluie couchée
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const a of this.averses) {
      let [px, py] = this.posAverse(a, time, 'pluie');
      if (py < wy0 - 26 || py > wy1 + 26) continue;
      const fort = kind(zoneDe(px, py)), k2 = PLUIE.has(fort) ? fort : null;
      if (!k2 || (k2 === 'pluie' && a.k % 3 === 0)) continue;   // (la pluie a moins d'averses que l'orage)
      if (k2 === 'tempete') [px, py] = this.posAverse(a, time, k2);
      const sx = (px - mp.cam.x) * z * d + W / 2, sy = (py - mp.cam.y) * z * d + H / 2, rx = a.r * 1.4 * z * d, ry = a.r * z * d;
      if (sx + rx < 0 || sx - rx > W || sy + ry < 0 || sy - ry > H) continue;
      ctx.globalAlpha = k2 === 'pluie' ? 0.5 : 0.72; ctx.drawImage(SPR.pluie, sx - rx, sy - ry, rx * 2, ry * 2); ctx.globalAlpha = 1;
      const n = clamp(Math.min(rx, W) * Math.min(ry, H) / (k2 === 'pluie' ? 700 : 450), 30, 700), dx = (k2 === 'tempete' ? -10 : -3) * d, dy = 11 * d;
      ctx.strokeStyle = 'rgba(215,224,236,.6)'; ctx.lineWidth = d; ctx.beginPath();
      for (let k = 0; k < n; k++) { const an = Math.random() * TAU, rr = Math.sqrt(Math.random()), x = sx + Math.cos(an) * rx * 0.8 * rr, y = sy + Math.sin(an) * ry * 0.8 * rr; ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); }
      ctx.stroke();
      if (k2 === 'orage') this.eclair(ctx, a, sx, sy, rx, ry, dt, px, py);
    }
    // 4) la neige qui tombe (flocons par zone, effacés au bord des zones voisines)
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.neige(ctx, zones, kind, dt, time);
    if (!vivant) { ctx.restore(); return; }
    // 5) l'heure : un voile de couleur sur toute la carte
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // (de loin, la carte sert à jouer : le voile s'allège pour que les noms et les chiffres restent lisibles)
    const teinte = TEINTE_HEURE[AMB.heure], fort = clamp((z - 2) / 16, 0.45, 1);
    if (teinte) {
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = eclaircir(teinte, 1 - fort); ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
      if (AMB.heure === 'nuit') { ctx.fillStyle = `rgba(8,12,34,${0.18 * fort})`; ctx.fillRect(0, 0, W, H); }
    }
    // 6) les lumières
    this.lumieres(ctx, monde, time, wx0, wy0, wx1, wy1);
    ctx.restore();
  }
  posAverse(a, t, k) { const v = k === 'tempete' ? 0.3 : 0.12, W = this.map.W; return [mod(a.x0 + t * v, W + 120) - 60, a.y0 + Math.sin(t * 0.003 + a.x0) * 8]; }
  // un éclair dans une cellule d'orage : la foudre zèbre la nuée, la nuée s'éclaire
  eclair(ctx, a, sx, sy, rx, ry, dt, px, py) {
    if (a.eclair <= 0 && Math.random() < dt * 0.12) {
      a.eclair = 0.3; const pts = []; let x = sx + (Math.random() - 0.5) * rx, y = sy - ry * 0.7;
      while (y < sy + ry * 0.6) { pts.push([x, y]); x += (Math.random() - 0.5) * rx * 0.18; y += ry * (0.08 + Math.random() * 0.1); }
      a.bolt = pts; this.flash[zoneDe(px, py)] = 0.22;
    }
    if (a.eclair <= 0) return;
    a.eclair -= dt;
    const al = clamp(a.eclair / 0.3, 0, 1) * (Math.random() < 0.3 ? 0.4 : 1);
    LUM.push({ x: px, y: py, r: a.r * 0.6, a: 0.5 * al, eclair: true, spr: 'trou' });
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al; ctx.strokeStyle = '#f4f0ff'; ctx.lineWidth = 2 * this.map.dpr; ctx.lineJoin = 'round';
    ctx.beginPath(); a.bolt.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore();
  }

  // zones : [x0, y0, x1, y1] (px) et bords intérieurs (gauche, droite, haut, bas) qui touchent une autre zone
  zones(X0, Y0, X1, Y1) {
    const mp = this.map, ym = clamp(mp.toScreen(0, mp.m.y_mont)[1], Y0, Y1), xc = clamp(mp.toScreen(mp.m.x_cote, 0)[0], X0, X1);
    return {
      montagne: [X0, ym, X1, Y1, 0, 0, ym > Y0, 0],
      cote: [X0, Y0, xc, ym, 0, xc < X1, 0, ym < Y1],
      interieur: [xc, Y0, X1, ym, xc > X0, 0, 0, ym < Y1],
    };
  }
  // les voiles de couleur, sur un calque à 1/40 : le lissage fond les limites entre zones sans couture droite
  voiles(ctx, zones, kind, dt) {
    const mp = this.map, K = 1 / 40, tw = Math.ceil(mp.vw * K) + 1, th = Math.ceil(mp.vh * K) + 1;
    const tint = this.tint || (this.tint = document.createElement('canvas'));
    if (tint.width !== tw || tint.height !== th) { tint.width = tw; tint.height = th; }
    const tg = tint.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, tw, th); tg.setTransform(K, 0, 0, K, 0, 0);
    let tinted = false;
    const ext = zr => [zr[4] ? zr[0] : zr[0] - 60, zr[6] ? zr[1] : zr[1] - 60, zr[5] ? zr[2] : zr[2] + 60, zr[7] ? zr[3] : zr[3] + 60];
    const veil = (zr, col) => { const [a, b, c, e] = ext(zr); tg.fillStyle = col; tg.fillRect(a, b, c - a, e - b); tinted = true; };
    for (const [zn, zr] of Object.entries(zones)) {
      if (zr[2] <= zr[0] || zr[3] <= zr[1]) continue;
      const k = kind(zn);
      if (k === 'pluie') veil(zr, 'rgba(40,52,70,0.1)');
      else if (k === 'orage') veil(zr, 'rgba(34,40,58,0.18)');
      else if (k === 'tempete') veil(zr, 'rgba(40,50,62,0.2)');
      else if (k === 'neige') veil(zr, 'rgba(240,246,255,0.22)');
      else if (k === 'brouillard') veil(zr, 'rgba(226,230,232,0.24)');
      else if (k === 'canicule') { veil(zr, 'rgba(255,170,70,0.09)'); veil(zr, 'rgba(255,244,222,0.06)'); }
      else if (k === 'nuages') veil(zr, 'rgba(60,70,90,0.06)');
      if (this.flash[zn] > 0) { veil(zr, `rgba(235,238,255,${this.flash[zn]})`); this.flash[zn] -= dt * 1.4; }
    }
    if (!tinted) return;
    const [X0, Y0] = [zones.cote[0], zones.cote[1]], X1 = zones.interieur[2], Y1 = zones.montagne[3];
    ctx.save(); ctx.setTransform(mp.dpr, 0, 0, mp.dpr, 0, 0);
    ctx.beginPath(); ctx.rect(X0, Y0, X1 - X0, Y1 - Y0); ctx.clip();   // le lissage ne déborde pas hors de la carte
    ctx.imageSmoothingEnabled = true; ctx.drawImage(tint, 0, 0, tw / K, th / K);
    ctx.restore();
  }
  // flocons : ils débordent un peu sur la zone voisine et s'y effacent progressivement
  neige(ctx, zones, kind, dt, time) {
    const F = 40, Hf = F / 2;
    for (const [zn, zr] of Object.entries(zones)) {
      if (kind(zn) !== 'neige' || zr[2] <= zr[0] || zr[3] <= zr[1]) continue;
      const [x0, y0, x1, y1, eL, eR, eT, eB] = zr;
      const rx = x0 - (eL ? Hf : 0), ry = y0 - (eT ? Hf : 0), rw = x1 + (eR ? Hf : 0) - rx, rh = y1 + (eB ? Hf : 0) - ry;
      const fade = (x, y) => Math.min(eL ? (x - x0 + Hf) / F : 1, eR ? (x1 + Hf - x) / F : 1, eT ? (y - y0 + Hf) / F : 1, eB ? (y1 + Hf - y) / F : 1);
      const P = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], pool = this.pool[zn];
      const cle = `${rx | 0},${ry | 0},${rw | 0},${rh | 0}`;
      if (pool.cle !== cle) { if (pool.cle && pool.rh < rh * 0.8) for (const p of pool) { p.x = rx + Math.random() * rw; p.y = ry + Math.random() * rh; } pool.cle = cle; pool.rh = rh; }
      const want = Math.min(360, rw * rh / 1e5 * 55);
      while (pool.length < want) pool.push({ x: rx + Math.random() * rw, y: ry + Math.random() * rh, r: 1 + Math.random() * 2, ph: Math.random() * 6 });
      pool.length = Math.min(pool.length, Math.ceil(want));
      for (const p of pool) {
        p.y += 40 * dt; p.x += Math.sin(time + p.ph) * 12 * dt;
        // (la zone a bougé ou grandi, zoom ou déplacement : le flocon reprend une place au hasard, sinon tous ceux
        // nés au bord d'une zone encore plate tomberaient ensemble, en rang)
        if (p.x < rx - 30 || p.x > rx + rw + 30 || p.y < ry - 30 || p.y > ry + rh + 30) { p.x = rx + Math.random() * rw; p.y = ry + Math.random() * rh; }
        else if (p.y > ry + rh) { p.y = ry - Math.random() * 20; p.x = rx + Math.random() * rw; }
        const b = Math.ceil(clamp(fade(p.x, p.y), 0, 1) * 4) - 1;
        if (b >= 0) { P[b].moveTo(p.x + p.r, p.y); P[b].arc(p.x, p.y, p.r, 0, TAU); }
      }
      ctx.fillStyle = '#ffffff';
      P.forEach((path, i) => { ctx.globalAlpha = 0.9 * (i + 1) / 4; ctx.fill(path); });
      ctx.globalAlpha = 1;
    }
  }
  // les villes s'allument (de loin un halo, de près des fenêtres), le phare de Cordouan tourne ; puis les feux,
  // lanternes, incendies et coups de canon de LUM. Les incendies et les éclairs se voient aussi de jour
  lumieres(ctx, monde, time, x0, y0, x1, y1) {
    const mp = this.map, st = mp.state, z = mp.cam.z, nuitV = AMB.heure === 'nuit', k = nuitV ? 1 : AMB.heure === 'soir' ? 0.55 : 0;
    monde(); ctx.globalCompositeOperation = 'lighter';
    if (k) {
      // (les camps qui ont l'éclairage au gaz : leurs villes, plus blanches, ont des réverbères réguliers dans les rues)
      if (this.gazSt !== st) { this.gazSt = st; this.gaz = new Set((st.factions || []).filter(f => f.mk?.includes('gaz')).map(f => f.code)); }
      for (const n of mp.nodes) {
        if (n.x < x0 - 3 || n.x > x1 + 3 || n.y < y0 - 3 || n.y > y1 + 3) continue;
        const ns = st.nodes[n.id], R = rayonPlace(n, ns), Rh = Math.max(R * 1.8, (n.type === 'village' ? 5 : 9) / z), gaz = n.type !== 'village' && this.gaz.has(ns.o);
        ctx.globalAlpha = 0.3 * k; ctx.drawImage(gaz ? SPR.gaz : SPR.lueur, n.x - Rh, n.y - Rh, Rh * 2, Rh * 2);
        if (z >= Z.PLAN) { const f = this.fenetresDe(n, ns, R, Math.max(0.004, 0.8 / z)); if (f) { ctx.globalAlpha = 0.85 * k; ctx.fillStyle = '#ffd58a'; ctx.fill(f); } }
        if (z >= Z.PLAN && gaz) { const f = this.reverberesDe(n, ns, Math.max(0.003, 0.7 / z)); if (f) { ctx.globalAlpha = 0.16 * k; ctx.fillStyle = '#c8d8ff'; ctx.fill(f[1]); ctx.globalAlpha = 0.9 * k; ctx.fillStyle = '#f4f8ff'; ctx.fill(f[0]); } }
      }
      const c = this.cordouan;
      if (c) {
        const Lb = 26, th = time * 0.6;
        for (const a of [th, th + Math.PI]) {
          const gr = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Lb);
          gr.addColorStop(0, `rgba(255,240,190,${0.55 * k})`); gr.addColorStop(1, 'rgba(255,240,190,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, Lb, a - 0.05, a + 0.05); ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = k; const rr = Math.max(0.3, 14 / z); ctx.drawImage(SPR.fen, c.x - rr, c.y - rr, rr * 2, rr * 2);
      }
    }
    const loin = clamp(z / 8, 0.4, 1);   // (de loin, les feux ne sont que des points : pas de taches blanches)
    for (const l of LUM) {
      if (!k && !l.jour && !l.eclair) continue;
      const r = Math.max(l.r, (l.spr === 'fen' || l.petit ? 3 : 5) / z);
      if (l.x + r * 3 < x0 || l.x - r * 3 > x1 || l.y + r * 3 < y0 || l.y - r * 3 > y1) continue;
      const f = 0.85 + 0.15 * Math.sin(time * 9 + l.x * 50);
      const al = clamp(l.a * (l.eclair ? 1 : l.jour ? Math.max(k, 0.5) : k) * f * loin, 0, 1);
      if (l.spr === 'fen') {
        // une lanterne : un point vif et son halo sur le sol (une flamme de chandelle se voit de loin la nuit)
        const h = Math.max(l.r * 2.5, 8 / z), c = Math.max(l.r * 0.5, 1.6 / z);
        ctx.globalAlpha = al * 0.5; ctx.drawImage(SPR.fen, l.x - h, l.y - h, h * 2, h * 2);
        ctx.globalAlpha = al; ctx.drawImage(SPR.fen, l.x - c, l.y - c, c * 2, c * 2); ctx.drawImage(SPR.fen, l.x - c * 0.6, l.y - c * 0.6, c * 1.2, c * 1.2);
        continue;
      }
      ctx.globalAlpha = al;
      ctx.drawImage(SPR[l.spr || 'lueur'], l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // les réverbères au gaz d'une ville : un tous les 70 m le long des rues de son plan (carte/villes.js, V.rues), d'un
  // seul tracé, et leur halo ; tant que le plan n'est pas peint, rien
  reverberesDe(n, ns, r) {
    const mp = this.map, p = imageEnCache(n, etatVille(n, ns, mp.state), resPour(mp.cam.z * mp.dpr / SU));
    if (!p?.V?.rues) return null;
    const k = 'g' + n.id;
    let f = this.fenetres.get(k);
    if (!f || f.V !== p.V || f.r !== r) {
      const pts = f?.V === p.V ? f.pts : reverberes(p.V, n.x, n.y), a = new Path2D(), b = new Path2D();
      for (const [x, y] of pts) { a.moveTo(x + r, y); a.arc(x, y, r, 0, TAU); b.moveTo(x + r * 3, y); b.arc(x, y, r * 3, 0, TAU); }
      f = { V: p.V, r, pts, path: [a, b] }; this.fenetres.set(k, f);
    }
    return f.path;
  }
  // les fenêtres éclairées d'une ville : celles de son plan (carte/villes.js, planCarte().lum), d'un seul tracé ;
  // tant que le plan n'est pas peint, rien que le halo
  fenetresDe(n, ns, R, r) {
    const mp = this.map, p = imageEnCache(n, etatVille(n, ns, mp.state), resPour(mp.cam.z * mp.dpr / SU));
    if (!p?.lum?.length) return null;
    let f = this.fenetres.get(n.id);
    if (!f || f.lum !== p.lum || f.r !== r) {
      const path = new Path2D();
      for (const [x, y] of p.lum) { path.moveTo(x + r, y); path.arc(x, y, r, 0, TAU); }
      f = { lum: p.lum, r, path }; this.fenetres.set(n.id, f);
      if (this.fenetres.size > 300) this.fenetres.delete(this.fenetres.keys().next().value);
    }
    return f.path;
  }
}

// les réverbères le long des rues d'un plan V (unités de l'intérieur, centre IC), en km autour de la place (x, y) : un
// tous les 13 unités (70 m), au même endroit d'une nuit à l'autre ; seulement entre les maisons (les rues d'un plan en
// damier passent aussi là où il n'a pas gardé d'îlot)
export function reverberes(V, x, y) {
  const out = [], bati = (u, v) => V.ilots.some(b => Math.abs(b.c[0] - u) < 24 && Math.abs(b.c[1] - v) < 24);
  for (const r of V.rues) for (let i = 1; i < r.pts.length; i++) {
    const [ax, ay] = r.pts[i - 1], [bx, by] = r.pts[i], l = Math.hypot(bx - ax, by - ay);
    for (let d = 6.5; d < l; d += 13) { const u = ax + (bx - ax) * d / l, v = ay + (by - ay) * d / l; if (bati(u, v)) out.push([x + (u - IC[0]) / SU, y + (v - IC[1]) / SU]); }
  }
  return out;
}
