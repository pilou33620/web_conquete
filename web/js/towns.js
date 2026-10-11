// Villes et villages en vue cavalière : maisons, église ou cathédrale, citadelle, aux couleurs de chaque pays
// (pierre blonde et tuiles du Bordelais, toits bruns du Périgord, colombages des Landes, brique de l'Agenais,
// murs blancs et ardoise du Béarn). Chaque place est peinte une fois dans une petite image mise en cache ;
// à chaque image ne s'ajoutent que l'animation : drapeau au clocher, habitants qui vont et viennent, pigeons.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(i, j, k = 0) {
  let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// murs, toits, et particularités par département
const STYLE = {
  '33': { walls: ['#efe4c8', '#e8dab8', '#f3ead6', '#e3d2ad'], roofs: ['#b4513a', '#c0623e', '#a9472f', '#b85a3c'], pitch: 0.55 },
  '24': { walls: ['#ead39b', '#e2c98a', '#efdcaa', '#dcc184'], roofs: ['#7a4a33', '#8a5638', '#6e4030', '#80503a'], pitch: 0.85 },
  '40': { walls: ['#f3ede1', '#efe7d8', '#f6f1e6'], roofs: ['#b8603f', '#a8573a', '#c06a48'], pitch: 0.5, timber: '#6b4a2e' },
  '47': { walls: ['#e8c7a6', '#dcb08e', '#efd2b4', '#e4bd98'], roofs: ['#b5532f', '#c4643a', '#a94a2a'], pitch: 0.45 },
  '64': { walls: ['#f7f4ee', '#ffffff', '#f2eee6'], roofs: ['#5a6070', '#4c5262', '#666c7a'], pitch: 0.8, timber: '#8c2f24' },
};
const STONE = '#d9ccb0', DARK = '#3b2c1c';

export class TownArt {
  constructor(map) {
    this.map = map;
    this.cache = new Map();
  }

  // nombre de maisons : selon la population et les agrandissements
  houses(n, dev) {
    const p = n.pop0 || 500;
    if (n.type === 'capitale') return 13 + Math.min(7, Math.round(Math.log10(p / 5000) * 4)) + dev * 2;
    if (n.type === 'ville') return 6 + Math.min(6, Math.round(Math.log10(p / 1500) * 5)) + dev * 2;
    if (n.type === 'fort') return 2;
    return 3 + Math.min(2, Math.round(p / 900)) + dev;
  }

  // image de la place (mise en cache par taille, agrandissement et saison)
  sprite(n, s, dev, winter) {
    const dpr = this.map.dpr || 1;
    const b = Math.round(Math.log(s) / Math.log(1.09));   // paliers de taille : le cache reste petit
    const S = Math.pow(1.09, b);
    const key = `${n.id}|${b}|${dev}|${winter ? 1 : 0}|${dpr}`;
    let sp = this.cache.get(key);
    if (sp) { this.cache.delete(key); this.cache.set(key, sp); return sp; }
    const W = Math.ceil(S * 1.7), H = Math.ceil(S * 1.75);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, W / 2 * dpr, H * 0.62 * dpr);   // origine : le centre de la place
    const meta = this.paint(g, n, S, dev, winter);
    sp = { cv, W, H, S, meta };
    this.cache.set(key, sp);
    while (this.cache.size > 260) {
      const [k, old] = this.cache.entries().next().value;
      this.cache.delete(k);
      old.cv.width = old.cv.height = 0;   // Safari garde sinon la mémoire des canevas
    }
    return sp;
  }

  clear() {
    for (const sp of this.cache.values()) sp.cv.width = sp.cv.height = 0;
    this.cache.clear();
  }

  // ------------------------------------------------------------------ peinture de la place (une fois)
  paint(g, n, s, dev, winter) {
    const st = STYLE[n.dept] || STYLE['33'];
    const id = n.id;
    const lw = Math.max(0.6, s * 0.018);
    const big = n.type === 'capitale', town = n.type === 'ville', fort = n.type === 'fort';
    // sol de la place : terre battue et pavés
    g.fillStyle = 'rgba(30,24,14,0.22)';
    g.beginPath(); g.ellipse(s * 0.04, s * 0.1, s * (big ? 0.6 : 0.52), s * (big ? 0.36 : 0.3), 0, 0, TAU); g.fill();
    g.fillStyle = fort ? '#cbbf9f' : '#d8c9a2';
    g.beginPath(); g.ellipse(0, s * 0.06, s * (big ? 0.56 : 0.48), s * (big ? 0.32 : 0.26), 0, 0, TAU); g.fill();
    // bâtiments, du fond vers le devant
    const items = [];
    const nh = this.houses(n, dev);
    const rx = s * (big ? 0.5 : town ? 0.44 : 0.36), ry = s * (big ? 0.27 : 0.22);
    // le monument au fond, au centre
    let mon;
    if (big) mon = { kind: 'cathedrale', x: -s * 0.04, y: -s * 0.06 };
    else if (fort) mon = { kind: 'citadelle', x: 0, y: -s * 0.02 };
    else mon = { kind: 'eglise', x: (hash(id, 1, 5) - 0.5) * s * 0.16, y: -s * 0.08 };
    items.push(mon);
    if (big) items.push({ kind: 'hotel', x: s * 0.24, y: -s * 0.02 });
    const pts = [];
    for (let k = 0; pts.length < nh && k < nh * 12; k++) {
      const a = hash(id, k, 11) * TAU, r = Math.sqrt(0.18 + hash(id, k, 12) * 0.82);
      const x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r + s * 0.05;
      const w = s * (big ? 0.15 : town ? 0.17 : 0.2) * (0.8 + hash(id, k, 13) * 0.45);
      if (items.some(o => Math.abs(o.x - x) < (o.kind === 'maison' ? (o.w + w) * 0.42 : s * 0.15) && Math.abs(o.y - y) < s * 0.07)) continue;
      const it = { kind: 'maison', x, y, w, k };
      items.push(it); pts.push(it);
    }
    items.sort((a, b) => a.y - b.y);
    let pole = null;
    for (const it of items) {
      if (it.kind === 'maison') this.house(g, it.x, it.y, it.w, s, st, id, it.k, winter, lw);
      else if (it.kind === 'eglise') pole = this.church(g, it.x, it.y, s, st, winter, lw, town);
      else if (it.kind === 'cathedrale') pole = this.cathedral(g, it.x, it.y, s, st, winter, lw);
      else if (it.kind === 'citadelle') pole = this.citadel(g, it.x, it.y, s, winter, lw);
      else if (it.kind === 'hotel') this.townHall(g, it.x, it.y, s, st, winter, lw);
    }
    // une rue devant les maisons, pour les passants
    return { pole, street: [s * -0.3, s * 0.3, s * 0.27] };
  }

  // maison : façade, pignon latéral en biais, toit, porte et fenêtres
  house(g, x, y, w, s, st, id, k, winter, lw) {
    const h = w * (0.55 + hash(id, k, 21) * 0.25), d = w * 0.42, dx = d * 0.62, dy = d * 0.38;
    const wall = st.walls[(hash(id, k, 22) * st.walls.length) | 0], roof = st.roofs[(hash(id, k, 23) * st.roofs.length) | 0];
    const rh = w * st.pitch * 0.62;
    g.lineWidth = lw; g.strokeStyle = 'rgba(60,44,26,0.75)'; g.lineJoin = 'round';
    // côté
    g.fillStyle = shade(wall, -0.18);
    g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + dx, y - dy); g.lineTo(x + w / 2 + dx, y - h - dy); g.lineTo(x + w / 2, y - h); g.closePath(); g.fill(); g.stroke();
    // façade
    g.fillStyle = wall; g.fillRect(x - w / 2, y - h, w, h); g.strokeRect(x - w / 2, y - h, w, h);
    if (st.timber && w > 7) {
      g.strokeStyle = st.timber; g.lineWidth = Math.max(0.5, w * 0.04);
      g.beginPath();
      g.moveTo(x - w / 2, y - h * 0.5); g.lineTo(x + w / 2, y - h * 0.5);
      g.moveTo(x - w * 0.18, y - h); g.lineTo(x - w * 0.18, y); g.moveTo(x + w * 0.2, y - h); g.lineTo(x + w * 0.2, y - h * 0.5);
      g.moveTo(x - w / 2, y - h); g.lineTo(x - w * 0.18, y - h * 0.5);
      g.stroke();
      g.strokeStyle = 'rgba(60,44,26,0.75)'; g.lineWidth = lw;
    }
    // toit à deux pans, faîtage parallèle à la façade
    const pad = w * 0.07;
    g.fillStyle = roof;
    g.beginPath();
    g.moveTo(x - w / 2 - pad, y - h); g.lineTo(x + w / 2 + pad, y - h);
    g.lineTo(x + w / 2 + dx * 0.5 + pad, y - h - rh - dy * 0.5); g.lineTo(x - w / 2 + dx * 0.5 - pad * 0.3, y - h - rh - dy * 0.5);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = shade(roof, -0.22);
    g.beginPath();
    g.moveTo(x + w / 2 + pad, y - h); g.lineTo(x + w / 2 + dx + pad * 0.6, y - h - dy); g.lineTo(x + w / 2 + dx * 0.5 + pad, y - h - rh - dy * 0.5);
    g.closePath(); g.fill(); g.stroke();
    if (winter) {
      g.fillStyle = 'rgba(250,252,255,0.92)';
      g.beginPath();
      g.moveTo(x - w / 2 + dx * 0.5 - pad * 0.3, y - h - rh - dy * 0.5); g.lineTo(x + w / 2 + dx * 0.5 + pad, y - h - rh - dy * 0.5);
      g.lineTo(x + w / 2 + dx * 0.3 + pad, y - h - rh * 0.55 - dy * 0.3); g.lineTo(x - w / 2 + dx * 0.3 - pad * 0.3, y - h - rh * 0.55 - dy * 0.3);
      g.closePath(); g.fill();
    }
    // porte et fenêtres
    if (w > 6) {
      g.fillStyle = '#5a3d22';
      const dw = w * 0.16;
      g.fillRect(x - dw / 2 + (hash(id, k, 24) - 0.5) * w * 0.4, y - h * 0.45, dw, h * 0.45);
      g.fillStyle = '#3d4c5c';
      const ww = w * 0.12;
      g.fillRect(x - w * 0.34, y - h * 0.72, ww, ww * 1.1);
      g.fillRect(x + w * 0.22, y - h * 0.72, ww, ww * 1.1);
    }
    // cheminée
    if (w > 5 && hash(id, k, 25) < 0.7) {
      g.fillStyle = shade(wall, -0.3);
      const cx = x + w * (0.1 + hash(id, k, 26) * 0.25);
      g.fillRect(cx, y - h - rh * 0.9 - dy * 0.3, w * 0.07, rh * 0.45);
    }
  }

  // église de village (clocher-mur ou clocher à flèche) ; renvoie la position du mât du drapeau
  church(g, x, y, s, st, winter, lw, town) {
    const k = town ? 1.25 : 1;
    const w = s * 0.24 * k, h = s * 0.14 * k, d = w * 0.3, dx = d * 0.62, dy = d * 0.38;
    const roof = st.roofs[0], stone = st.timber && !town ? '#efe7d6' : STONE;
    g.lineWidth = lw; g.strokeStyle = 'rgba(60,44,26,0.8)';
    // nef
    g.fillStyle = shade(stone, -0.15);
    g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + dx, y - dy); g.lineTo(x + w / 2 + dx, y - h - dy); g.lineTo(x + w / 2, y - h); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = stone; g.fillRect(x - w / 2, y - h, w, h); g.strokeRect(x - w / 2, y - h, w, h);
    g.fillStyle = roof;
    g.beginPath(); g.moveTo(x - w / 2 - 1, y - h); g.lineTo(x + w / 2 + 1, y - h); g.lineTo(x + w / 2 + dx * 0.5, y - h - h * 0.6 - dy * 0.5); g.lineTo(x - w / 2 + dx * 0.5, y - h - h * 0.6 - dy * 0.5); g.closePath(); g.fill(); g.stroke();
    if (winter) { g.fillStyle = 'rgba(250,252,255,0.9)'; g.fillRect(x - w / 2 + dx * 0.5, y - h - h * 0.6 - dy * 0.5, w, h * 0.22); }
    // clocher à l'avant de la nef
    const tx = x - w * 0.3, tw = w * 0.3, th = h * (town ? 2.5 : 2.1);
    g.fillStyle = stone; g.fillRect(tx - tw / 2, y - th, tw, th); g.strokeRect(tx - tw / 2, y - th, tw, th);
    g.fillStyle = shade(stone, -0.15); g.fillRect(tx + tw / 2, y - th - dy * 0.3, tw * 0.3, th);
    // baie des cloches
    g.fillStyle = '#3b2c1c';
    g.beginPath(); g.ellipse(tx, y - th * 0.78, tw * 0.18, tw * 0.26, 0, 0, TAU); g.fill();
    // flèche
    const sh = th * (st.pitch > 0.7 ? 0.9 : 0.7);
    g.fillStyle = st.roofs[st.roofs.length > 2 ? 2 : 0];
    g.beginPath(); g.moveTo(tx - tw / 2 - 1, y - th); g.lineTo(tx, y - th - sh); g.lineTo(tx + tw / 2 + 1, y - th); g.closePath(); g.fill(); g.stroke();
    if (winter) { g.fillStyle = 'rgba(250,252,255,0.9)'; g.beginPath(); g.moveTo(tx - tw * 0.2, y - th - sh * 0.6); g.lineTo(tx, y - th - sh); g.lineTo(tx + tw * 0.2, y - th - sh * 0.6); g.fill(); }
    // porche et rosace
    g.fillStyle = '#5a3d22';
    g.beginPath(); g.moveTo(tx - tw * 0.2, y); g.lineTo(tx - tw * 0.2, y - h * 0.45); g.quadraticCurveTo(tx, y - h * 0.65, tx + tw * 0.2, y - h * 0.45); g.lineTo(tx + tw * 0.2, y); g.fill();
    return [tx, y - th - sh];
  }

  // cathédrale à deux tours, nef longue, transept et grande rosace
  cathedral(g, x, y, s, st, winter, lw) {
    const w = s * 0.42, h = s * 0.2, d = w * 0.22, dx = d * 0.62, dy = d * 0.38;
    g.lineWidth = lw; g.strokeStyle = 'rgba(60,44,26,0.85)';
    const stone = '#e2d6b8';
    g.fillStyle = shade(stone, -0.15);
    g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + dx, y - dy); g.lineTo(x + w / 2 + dx, y - h - dy); g.lineTo(x + w / 2, y - h); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = stone; g.fillRect(x - w / 2, y - h, w, h); g.strokeRect(x - w / 2, y - h, w, h);
    // arcs-boutants
    g.strokeStyle = 'rgba(60,44,26,0.6)';
    g.beginPath();
    for (let i = 1; i < 5; i++) { const bx = x - w / 2 + w * i / 5; g.moveTo(bx, y); g.lineTo(bx, y - h); }
    g.stroke();
    g.strokeStyle = 'rgba(60,44,26,0.85)';
    g.fillStyle = '#6f7480';   // toit d'ardoise
    g.beginPath(); g.moveTo(x - w / 2 - 1, y - h); g.lineTo(x + w / 2 + 1, y - h); g.lineTo(x + w / 2 + dx * 0.5, y - h * 1.7 - dy * 0.5); g.lineTo(x - w / 2 + dx * 0.5, y - h * 1.7 - dy * 0.5); g.closePath(); g.fill(); g.stroke();
    if (winter) { g.fillStyle = 'rgba(250,252,255,0.9)'; g.fillRect(x - w / 2 + dx * 0.5, y - h * 1.7 - dy * 0.5, w, h * 0.25); }
    // deux tours de façade
    const tw = w * 0.17, th = h * 2.7;
    for (const tx of [x - w / 2 + tw * 0.5, x - w / 2 + tw * 2.1]) {
      g.fillStyle = stone; g.fillRect(tx - tw / 2, y - th, tw, th); g.strokeRect(tx - tw / 2, y - th, tw, th);
      g.fillStyle = '#3b2c1c';
      g.fillRect(tx - tw * 0.18, y - th * 0.85, tw * 0.36, th * 0.16);
      g.fillStyle = '#6f7480';
      g.beginPath(); g.moveTo(tx - tw / 2 - 1, y - th); g.lineTo(tx, y - th - th * 0.55); g.lineTo(tx + tw / 2 + 1, y - th); g.closePath(); g.fill(); g.stroke();
    }
    // rosace entre les tours
    const rx = x - w / 2 + tw * 1.3;
    g.fillStyle = '#c58b3a'; g.beginPath(); g.arc(rx, y - h * 1.2, tw * 0.32, 0, TAU); g.fill();
    g.fillStyle = '#5a3d22';
    g.beginPath(); g.moveTo(rx - tw * 0.3, y); g.lineTo(rx - tw * 0.3, y - h * 0.55); g.quadraticCurveTo(rx, y - h * 0.85, rx + tw * 0.3, y - h * 0.55); g.lineTo(rx + tw * 0.3, y); g.fill();
    // flèche de croisée
    const cx = x + w * 0.18;
    g.fillStyle = '#6f7480';
    g.beginPath(); g.moveTo(cx - tw * 0.3, y - h * 1.65); g.lineTo(cx, y - h * 3.1); g.lineTo(cx + tw * 0.3, y - h * 1.65); g.closePath(); g.fill(); g.stroke();
    return [x - w / 2 + tw * 2.1, y - th - th * 0.55];
  }

  // hôtel de ville ou palais : façade classique à fronton, toit d'ardoise
  townHall(g, x, y, s, st, winter, lw) {
    const w = s * 0.26, h = s * 0.13, d = w * 0.25, dx = d * 0.62, dy = d * 0.38;
    g.lineWidth = lw; g.strokeStyle = 'rgba(60,44,26,0.8)';
    g.fillStyle = shade('#efe4c8', -0.15);
    g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + dx, y - dy); g.lineTo(x + w / 2 + dx, y - h - dy); g.lineTo(x + w / 2, y - h); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#f1e8d0'; g.fillRect(x - w / 2, y - h, w, h); g.strokeRect(x - w / 2, y - h, w, h);
    g.fillStyle = '#3d4c5c';
    for (let i = 0; i < 5; i++) g.fillRect(x - w / 2 + w * (0.08 + i * 0.19), y - h * 0.8, w * 0.07, h * 0.3);
    g.fillStyle = '#5c6470';
    g.beginPath(); g.moveTo(x - w / 2 - 1, y - h); g.lineTo(x + w / 2 + 1, y - h); g.lineTo(x + w / 2 + dx * 0.5 - w * 0.05, y - h * 1.55 - dy * 0.5); g.lineTo(x - w / 2 + dx * 0.5 + w * 0.05, y - h * 1.55 - dy * 0.5); g.closePath(); g.fill(); g.stroke();
    if (winter) { g.fillStyle = 'rgba(250,252,255,0.9)'; g.fillRect(x - w / 2 + dx * 0.5 + w * 0.05, y - h * 1.55 - dy * 0.5, w * 0.9, h * 0.2); }
    // fronton
    g.fillStyle = '#e8dcc0';
    g.beginPath(); g.moveTo(x - w * 0.18, y - h); g.lineTo(x, y - h * 1.4); g.lineTo(x + w * 0.18, y - h); g.closePath(); g.fill(); g.stroke();
  }

  // citadelle : donjon carré crénelé sur sa butte
  citadel(g, x, y, s, winter, lw) {
    const w = s * 0.28, h = s * 0.3, d = w * 0.35, dx = d * 0.62, dy = d * 0.38;
    g.lineWidth = lw; g.strokeStyle = 'rgba(50,40,26,0.85)';
    g.fillStyle = '#a99d82';
    g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + dx, y - dy); g.lineTo(x + w / 2 + dx, y - h - dy); g.lineTo(x + w / 2, y - h); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#c9bd9e'; g.fillRect(x - w / 2, y - h, w, h); g.strokeRect(x - w / 2, y - h, w, h);
    // créneaux
    const m = w / 7;
    g.fillStyle = '#c9bd9e';
    for (let i = 0; i < 7; i += 2) { g.fillRect(x - w / 2 + i * m, y - h - m, m, m); g.strokeRect(x - w / 2 + i * m, y - h - m, m, m); }
    g.fillStyle = '#3b2c1c';
    g.fillRect(x - w * 0.07, y - h * 0.62, w * 0.14, h * 0.2);
    g.beginPath(); g.moveTo(x - w * 0.15, y); g.lineTo(x - w * 0.15, y - h * 0.3); g.quadraticCurveTo(x, y - h * 0.42, x + w * 0.15, y - h * 0.3); g.lineTo(x + w * 0.15, y); g.fill();
    if (winter) { g.fillStyle = 'rgba(250,252,255,0.9)'; for (let i = 0; i < 7; i += 2) g.fillRect(x - w / 2 + i * m, y - h - m, m, m * 0.35); }
    return [x, y - h - m];
  }

  // ------------------------------------------------------------------ à chaque image
  draw(ctx, n, s, col, ns, time, owner) {
    const mp = this.map;
    const dev = (ns && ns.d) || 0, winter = mp.season === 'hiver';
    const sp = this.sprite(n, s, dev, winter);
    const k = s / sp.S;
    ctx.drawImage(sp.cv, -sp.W / 2 * k, -sp.H * 0.62 * k, sp.W * k, sp.H * k);
    const [px, py] = sp.meta.pole || [0, -s * 0.3];
    // drapeau du maître de la place, au sommet du clocher, de la tour ou du donjon
    const neutral = owner === 'neutre';
    mp.flag(ctx, px * k, py * k + 1, clamp(s * (n.type === 'village' ? 0.32 : 0.28), 7, 24), neutral ? '#e9e4d4' : col);
    const amb = mp.ambient;
    if (!amb || !amb.on) return;
    const z = mp.cam.z;
    // habitants qui vont et viennent dans la rue, devant les maisons
    if (z >= 8 && n.type !== 'fort') {
      const [x0, x1, yy] = sp.meta.street.map(v => v * k);
      const nb = n.type === 'capitale' ? 6 : n.type === 'ville' ? 4 : 2;
      const fs = clamp(s * 0.075, 2.2, 5);
      for (let i = 0; i < nb; i++) {
        const sp2 = 0.05 + hash(n.id, i, 41) * 0.06;
        const u = (time * sp2 + hash(n.id, i, 42)) % 2, f = u < 1 ? u : 2 - u;
        const x = x0 + (x1 - x0) * f, y = yy + (hash(n.id, i, 43) - 0.5) * s * 0.06;
        const step = Math.sin(time * 9 + i * 2) * fs * 0.35;
        ctx.strokeStyle = DARK; ctx.lineWidth = Math.max(0.6, fs * 0.25); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y - fs); ctx.lineTo(x + step, y); ctx.moveTo(x, y - fs); ctx.lineTo(x - step, y); ctx.stroke();
        ctx.fillStyle = ['#8b3a2a', '#2c3a5a', '#5a6a3a', '#7a5a2a'][(hash(n.id, i, 44) * 4) | 0];
        ctx.fillRect(x - fs * 0.3, y - fs * 2, fs * 0.6, fs * 1.1);
        ctx.fillStyle = '#e8d2b0'; ctx.beginPath(); ctx.arc(x, y - fs * 2.3, fs * 0.32, 0, TAU); ctx.fill();
      }
    }
    // pigeons qui tournent autour du clocher
    if (z >= 7 && n.type !== 'fort' && hash(n.id, 3, 45) < 0.6) {
      const cx = px * k, cy = py * k + s * 0.08, R = s * 0.22;
      ctx.strokeStyle = 'rgba(40,40,44,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = time * 0.9 + i * 2.1 + n.id;
        const bx = cx + Math.cos(a) * R, by = cy + Math.sin(a) * R * 0.35, w = clamp(s * 0.035, 1.5, 3), fl = Math.sin(time * 12 + i) * w * 0.5;
        ctx.moveTo(bx - w, by - fl); ctx.quadraticCurveTo(bx - w * 0.4, by - w * 0.4, bx, by); ctx.quadraticCurveTo(bx + w * 0.4, by - w * 0.4, bx + w, by - fl);
      }
      ctx.stroke();
    }
  }
}

function shade(hex, t) {
  const v = parseInt(hex.slice(1), 16);
  let r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const to = t < 0 ? 0 : 255, a = Math.abs(t);
  r = Math.round(r + (to - r) * a); g = Math.round(g + (to - g) * a); b = Math.round(b + (to - b) * a);
  return `rgb(${r},${g},${b})`;
}
