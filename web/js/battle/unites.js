// Vue tactique : les régiments en vue cavalière. Les soldats sont de petites silhouettes debout (une pour
// quelques hommes), rangées selon la formation et l'orientation ; cavaliers sur leurs chevaux ; batteries avec
// pièces, avant-trains et servants. Chaque silhouette est une petite image mise en cache (par camp, type, sens
// et taille à l'écran) : une image ne coûte qu'un drawImage par silhouette.
// Au-dessus de chaque régiment, un fanion de taille constante aux couleurs du camp porte l'effectif.
import { clsOf, isLight, isGeneral, isWagon, genName, pieces, hash, clamp, TAU, TILT } from './formes.js';

const SKIN = '#e2b996', HAT = '#1f1b18', WHITE = '#f3efe4', WOOD = '#6e5134', IRON = '#2c2c2a', BRONZE = '#a5843f';
const HORSES = ['#6b4a2c', '#3f2d1f', '#8b6a47', '#d9d2c4', '#54402e'];

function shadeHex(h, t) {
  const n = parseInt(h.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const to = t > 0 ? 255 : 0, k = Math.abs(t);
  return `rgb(${Math.round(r + (to - r) * k)},${Math.round(g + (to - g) * k)},${Math.round(b + (to - b) * k)})`;
}
// sens de la silhouette à l'écran : 0 = vers le bas (de face), 1 = vers la droite, 2 = vers le haut (de dos), 3 = vers la gauche
const facingOf = dir => { const c = Math.cos(dir), s = Math.sin(dir); return Math.abs(c) > Math.abs(s) * 0.9 ? (c > 0 ? 1 : 3) : (s > 0 ? 0 : 2); };

export class UnitArt {
  constructor() {
    this.sprites = new Map();
  }
  clear() { for (const s of this.sprites.values()) s.cv.width = s.cv.height = 0; this.sprites.clear(); }

  // ------------------------------------------------------------------ silhouettes en cache
  // kind : 'inf' | 'gren' | 'leger' | 'milice' | 'cav' | 'canon' | 'caisson' | 'officier'
  sprite(kind, color, face, H, pose = 0) {
    const hb = Math.max(4, Math.round(Math.log(H) / Math.log(1.1)));
    const key = `${kind}|${color}|${face}|${hb}|${pose}`;
    let sp = this.sprites.get(key);
    if (sp) { this.sprites.delete(key); this.sprites.set(key, sp); return sp; }   // le plus récemment servi passe en fin de file
    const h = Math.pow(1.1, hb);
    const wide = kind === 'cav' || kind === 'canon' || kind === 'caisson' || kind === 'attelage';
    const W = Math.ceil(h * (wide ? 2.0 : 0.95)), HH = Math.ceil(h * (wide ? 1.75 : 1.35));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = HH;
    const g = cv.getContext('2d');
    g.translate(W / 2, HH - 1);   // origine : les pieds
    const u = h / 10;
    if (kind === 'cav' || kind === 'attelage') this.horse(g, u, color, face, pose, kind === 'attelage');
    else if (kind === 'canon') this.gun(g, u, face);
    else if (kind === 'caisson') this.limber(g, u, face);
    else this.soldier(g, u, kind, color, face, pose);
    sp = { cv, ax: W / 2, ay: HH - 1, h };
    this.sprites.set(key, sp);
    if (this.sprites.size > 1500) { const [k] = this.sprites.keys(); this.sprites.delete(k); }
    return sp;
  }
  soldier(g, u, kind, color, face, pose) {
    const milice = kind === 'milice', officer = kind === 'officier';
    const coat = milice ? '#7a6248' : color, dark = shadeHex(coat, -0.35);
    const trous = milice ? '#5a4c3c' : kind === 'leger' ? shadeHex(color, -0.45) : WHITE;
    const prof = face === 1 || face === 3, sx = face === 3 ? -1 : 1;
    g.save(); g.scale(sx, 1);
    // pose 1 : en joue (fusil horizontal), pose 2 : course
    const run = pose === 2;
    // jambes
    g.fillStyle = trous;
    if (prof) { g.fillRect(-0.7 * u - (run ? 0.6 * u : 0), -4.2 * u, 0.9 * u, 4.2 * u); g.fillRect(0.1 * u + (run ? 0.5 * u : 0), -4.2 * u, 0.9 * u, 4.2 * u); }
    else { g.fillRect(-1.15 * u, -4.2 * u, 1 * u, 4.2 * u); g.fillRect(0.15 * u, -4.2 * u, 1 * u, 4.2 * u); }
    g.fillStyle = '#211a14';   // guêtres / souliers
    if (u > 0.7) { if (prof) g.fillRect(-0.8 * u, -0.8 * u, 2 * u, 0.8 * u); else { g.fillRect(-1.2 * u, -0.7 * u, 1.1 * u, 0.7 * u); g.fillRect(0.1 * u, -0.7 * u, 1.1 * u, 0.7 * u); } }
    // habit
    const bw = prof ? 2.3 * u : 3.1 * u;
    g.fillStyle = coat;
    g.beginPath(); g.moveTo(-bw / 2, -7.8 * u); g.lineTo(bw / 2, -7.8 * u); g.lineTo(bw / 2 + 0.3 * u, -3.6 * u); g.lineTo(-bw / 2 - 0.3 * u, -3.6 * u); g.closePath(); g.fill();
    g.fillStyle = dark; g.fillRect(prof ? 0.2 * u : bw / 2 - 0.7 * u, -7.6 * u, 0.6 * u, 3.6 * u);   // ombre du flanc
    if (face === 0 && !milice && u > 0.55) {   // buffleteries croisées
      g.strokeStyle = WHITE; g.lineWidth = Math.max(0.5, 0.45 * u);
      g.beginPath(); g.moveTo(-bw / 2 + 0.2 * u, -7.6 * u); g.lineTo(bw / 2 - 0.3 * u, -4.2 * u); g.moveTo(bw / 2 - 0.2 * u, -7.6 * u); g.lineTo(-bw / 2 + 0.3 * u, -4.2 * u); g.stroke();
    }
    if (face === 2 && !milice) { g.fillStyle = '#6a5038'; g.fillRect(-1 * u, -7.4 * u, 2 * u, 2.2 * u); g.fillStyle = WHITE; g.fillRect(-1 * u, -5.4 * u, 2 * u, 0.5 * u); }
    if (prof && !milice) { g.fillStyle = '#6a5038'; g.fillRect(-1.9 * u, -7.3 * u, 0.9 * u, 2 * u); }
    // tête et coiffure
    g.fillStyle = face === 2 ? '#4a3626' : SKIN;
    g.beginPath(); g.arc(prof ? 0.2 * u : 0, -8.6 * u, 0.95 * u, 0, TAU); g.fill();
    g.fillStyle = HAT;
    if (kind === 'gren') { g.beginPath(); g.ellipse(prof ? 0.1 * u : 0, -10.2 * u, 1.15 * u, 1.6 * u, 0, 0, TAU); g.fill(); }
    else if (milice) { g.fillStyle = '#3d2f22'; g.beginPath(); g.ellipse(0, -9.4 * u, 1.6 * u, 0.5 * u, 0, 0, TAU); g.fill(); g.fillRect(-0.8 * u, -10.3 * u, 1.6 * u, 1 * u); }
    else if (officer) { g.beginPath(); g.ellipse(0, -9.5 * u, prof ? 1.1 * u : 2 * u, 0.75 * u, 0, 0, TAU); g.fill(); g.fillStyle = '#d6b65a'; g.fillRect(-0.3 * u, -10 * u, 0.6 * u, 0.5 * u); }
    else {
      g.fillRect(-0.95 * u, -10.9 * u, 1.9 * u, 1.9 * u);   // shako
      g.fillStyle = kind === 'leger' ? '#5f9a46' : '#d23a2a'; g.fillRect(-0.3 * u, -11.6 * u, 0.6 * u, 0.8 * u);   // plumet
    }
    // fusil
    if (!officer) {
      g.strokeStyle = '#3b2a1a'; g.lineWidth = Math.max(0.5, 0.42 * u); g.lineCap = 'round';
      g.beginPath();
      if (pose === 1 && prof) { g.moveTo(-0.5 * u, -7 * u); g.lineTo(5 * u, -7.3 * u); }
      else if (prof) { g.moveTo(-0.4 * u, -4.5 * u); g.lineTo(1.9 * u, -11.4 * u); }
      else { g.moveTo(bw / 2 - 0.1 * u, -4 * u); g.lineTo(bw / 2 + 0.3 * u, -11.6 * u); }
      g.stroke();
      if (u > 0.9) { g.strokeStyle = '#c9ccd0'; g.lineWidth = Math.max(0.4, 0.25 * u); g.beginPath(); if (pose === 1 && prof) { g.moveTo(5 * u, -7.3 * u); g.lineTo(6.2 * u, -7.4 * u); } else if (prof) { g.moveTo(1.9 * u, -11.4 * u); g.lineTo(2.2 * u, -12.6 * u); } else { g.moveTo(bw / 2 + 0.3 * u, -11.6 * u); g.lineTo(bw / 2 + 0.35 * u, -12.8 * u); } g.stroke(); }
    } else {
      g.strokeStyle = '#d8dce0'; g.lineWidth = Math.max(0.4, 0.3 * u);
      g.beginPath(); g.moveTo(bw / 2, -6 * u); g.lineTo(bw / 2 + 2 * u, -9 * u); g.stroke();
    }
    g.restore();
  }
  horse(g, u, color, face, pose, harness) {
    const m = u * 10 / 1.8;   // pixels par mètre (l'homme debout mesure 1,80 m)
    const hc = HORSES[(pose >> 2) % HORSES.length], dark = shadeHex(hc, -0.35);
    const gallop = (pose & 3) === 2;
    if (face === 1 || face === 3) {
      g.save(); g.scale(face === 3 ? -1 : 1, 1);
      g.strokeStyle = dark; g.lineWidth = Math.max(0.7, 0.13 * m); g.lineCap = 'round';
      g.beginPath();
      const legs = gallop ? [[-0.85, -1.2], [-0.6, -0.3], [0.6, 0.9], [0.8, 1.3]] : [[-0.8, -0.8], [-0.6, -0.6], [0.6, 0.6], [0.8, 0.8]];
      for (const [a, b] of legs) { g.moveTo(a * m, -0.95 * m); g.lineTo(b * m, 0); }
      g.stroke();
      g.fillStyle = hc;
      g.beginPath(); g.ellipse(0, -1.15 * m, 1.0 * m, 0.38 * m, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(0.6 * m, -1.35 * m); g.lineTo(1.05 * m, -1.95 * m); g.lineTo(1.3 * m, -1.85 * m); g.lineTo(0.95 * m, -1.0 * m); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(1.35 * m, -1.78 * m, 0.34 * m, 0.15 * m, 0.5, 0, TAU); g.fill();
      g.strokeStyle = dark; g.lineWidth = Math.max(0.6, 0.12 * m);
      g.beginPath(); g.moveTo(-0.95 * m, -1.25 * m); g.quadraticCurveTo(-1.25 * m, -1.0 * m, -1.15 * m, -0.6 * m); g.stroke();
      g.fillStyle = dark; g.fillRect(-0.2 * m, -1.25 * m, 0.7 * m, 0.25 * m);
      if (harness) { g.strokeStyle = '#2a1e14'; g.lineWidth = Math.max(0.5, 0.06 * m); g.beginPath(); g.moveTo(-1 * m, -1.2 * m); g.lineTo(-2 * m, -1.0 * m); g.stroke(); }
      else this.rider(g, m, color, 1, gallop);
      g.restore();
    } else {
      // de face ou de dos : un cheval étroit, le cavalier au-dessus
      g.fillStyle = dark;
      g.fillRect(-0.32 * m, -0.95 * m, 0.14 * m, 0.95 * m); g.fillRect(0.18 * m, -0.95 * m, 0.14 * m, 0.95 * m);
      g.fillStyle = hc;
      g.beginPath(); g.ellipse(0, -1.2 * m, 0.42 * m, 0.5 * m, 0, 0, TAU); g.fill();
      if (face === 0) { g.beginPath(); g.ellipse(0, -1.55 * m, 0.17 * m, 0.38 * m, 0, 0, TAU); g.fill(); }
      else { g.strokeStyle = dark; g.lineWidth = Math.max(0.6, 0.1 * m); g.beginPath(); g.moveTo(0, -1.0 * m); g.lineTo(0, -0.55 * m); g.stroke(); }
      if (!harness) this.rider(g, m, color, face, gallop);
    }
  }
  rider(g, m, color, face, sabre) {
    const prof = face === 1;
    g.fillStyle = shadeHex(color, -0.3);
    g.fillRect(prof ? -0.05 * m : -0.32 * m, -1.45 * m, 0.22 * m, 0.4 * m);
    g.fillStyle = color;
    g.fillRect(prof ? -0.2 * m : -0.24 * m, -2.15 * m, prof ? 0.38 * m : 0.48 * m, 0.72 * m);
    g.fillStyle = SKIN; g.beginPath(); g.arc(0, -2.3 * m, 0.13 * m, 0, TAU); g.fill();
    g.fillStyle = '#c9a54a'; g.beginPath(); g.ellipse(0, -2.42 * m, 0.17 * m, 0.13 * m, 0, 0, TAU); g.fill();   // casque
    g.fillStyle = HAT; g.fillRect(-0.05 * m, -2.62 * m, 0.1 * m, 0.2 * m);
    g.strokeStyle = '#d8dce0'; g.lineWidth = Math.max(0.5, 0.05 * m);
    g.beginPath();
    if (sabre) { g.moveTo(0.15 * m, -1.9 * m); g.lineTo(0.75 * m, -2.6 * m); } else { g.moveTo(0.2 * m, -1.6 * m); g.lineTo(0.3 * m, -2.4 * m); }
    g.stroke();
  }
  gun(g, u, face) {
    const m = u * 10 / 1.8;
    if (face === 1 || face === 3) {
      g.save(); g.scale(face === 3 ? -1 : 1, 1);
      g.strokeStyle = WOOD; g.lineWidth = Math.max(0.8, 0.22 * m); g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, -0.7 * m); g.lineTo(-1.9 * m, -0.05 * m); g.stroke();   // flèche de l'affût
      g.strokeStyle = BRONZE; g.lineWidth = Math.max(1, 0.32 * m);
      g.beginPath(); g.moveTo(-0.4 * m, -1.0 * m); g.lineTo(1.5 * m, -1.08 * m); g.stroke();
      g.strokeStyle = '#3a2a1a'; g.lineWidth = Math.max(0.6, 0.1 * m);
      g.beginPath(); g.arc(0, -0.65 * m, 0.62 * m, 0, TAU); g.stroke();
      g.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 4; g.moveTo(Math.cos(a) * 0.6 * m, -0.65 * m + Math.sin(a) * 0.6 * m); g.lineTo(-Math.cos(a) * 0.6 * m, -0.65 * m - Math.sin(a) * 0.6 * m); } g.stroke();
      g.restore();
    } else {
      g.fillStyle = '#3a2a1a';
      g.fillRect(-0.75 * m, -1.25 * m, 0.13 * m, 1.25 * m); g.fillRect(0.62 * m, -1.25 * m, 0.13 * m, 1.25 * m);
      g.fillStyle = WOOD; g.fillRect(-0.6 * m, -0.9 * m, 1.2 * m, 0.25 * m);
      g.fillStyle = BRONZE; g.beginPath(); g.ellipse(0, -1.05 * m, 0.22 * m, face === 0 ? 0.22 * m : 0.5 * m, 0, 0, TAU); g.fill();
      if (face === 0) { g.fillStyle = IRON; g.beginPath(); g.arc(0, -1.05 * m, 0.1 * m, 0, TAU); g.fill(); }
    }
  }
  limber(g, u, face) {
    const m = u * 10 / 1.8;
    const prof = face === 1 || face === 3;
    g.fillStyle = '#3a2a1a';
    if (prof) { g.beginPath(); g.arc(0, -0.55 * m, 0.55 * m, 0, TAU); g.fill(); }
    else { g.fillRect(-0.7 * m, -1.1 * m, 0.12 * m, 1.1 * m); g.fillRect(0.58 * m, -1.1 * m, 0.12 * m, 1.1 * m); }
    g.fillStyle = '#6e5a3a'; g.fillRect(prof ? -0.7 * m : -0.55 * m, -1.35 * m, prof ? 1.4 * m : 1.1 * m, 0.6 * m);
    g.fillStyle = '#8c7450'; g.fillRect(prof ? -0.7 * m : -0.55 * m, -1.35 * m, prof ? 1.4 * m : 1.1 * m, 0.15 * m);
  }

  // ------------------------------------------------------------------ disposition des silhouettes
  // renvoie une liste [[u, v, kind, faceOffset, pose], …] en mètres dans le repère de l'unité : u le long du front,
  // v vers l'avant ; recalculée seulement quand l'effectif, la formation ou l'état changent
  layout(un, w, d, per = 4) {
    const cls = clsOf(un), key = `${un.form}|${un.state}|${Math.round(un.men / 8)}|${w | 0}|${d | 0}|${un.type}|${per}`;
    if (un._lay && un._layKey === key) return un._lay;
    const out = [], id = String(un.id).length * 97 + (un.men0 || 0);
    const rnd = k => hash(k, id, 41);
    const rout = un.state === 'deroute', melee = un.state === 'melee';
    if (isWagon(un)) {
      // chariot de munitions : deux chevaux, la voiture, le conducteur
      out.push([-1.4, 6, 'attelage', 0, 4], [1.4, 6, 'attelage', 0, 12], [0, -2, 'caisson', 0, 0], [0, -6, 'caisson', 0, 0], [2.6, 0, 'inf', 0, 0]);
    } else if (isGeneral(un)) {
      out.push([0, 0, 'cav', 0, 0]);
      for (let k = 0; k < 4; k++) out.push([(k - 1.5) * 7, -6 - (k % 2) * 4, 'cav', 0, k * 4]);
      out.push([11, -2, 'officier', 0, 0]);
    } else if (cls === 'artillerie') {
      const p = pieces(un);
      if (un.form === 'attelee') {
        for (let k = 0; k < p; k++) {
          const v0 = d / 2 - 4 - k * (d - 8) / Math.max(1, p);
          out.push([-1.6, v0, 'attelage', 0, 4], [1.6, v0, 'attelage', 0, 8], [-1.6, v0 - 5, 'attelage', 0, 0], [1.6, v0 - 5, 'attelage', 0, 4]);
          out.push([0, v0 - 10, 'caisson', 0, 0], [0, v0 - 15, 'canon', 2, 0], [3.5, v0 - 4, 'inf', 0, 0]);
        }
      } else {
        for (let k = 0; k < p; k++) {
          const u0 = (k - (p - 1) / 2) * (w / Math.max(1, p));
          out.push([u0, d / 2 - 5, 'canon', 0, 0]);
          for (const [du, dv] of [[-3.2, -2], [3.2, -2.4], [-2, -6], [2.4, -6.5]]) out.push([u0 + du, d / 2 - 5 + dv, 'inf', 0, 0]);
          out.push([u0, -d / 2 + 9, 'caisson', 0, 0], [u0 - 1.6, -d / 2 + 3, 'attelage', 2, 4], [u0 + 1.6, -d / 2 + 3, 'attelage', 2, 0]);
        }
      }
    } else {
      const cav = cls === 'cavalerie';
      const kind = cav ? 'cav' : un.type === 'grenadiers' || un.type === 'garde' ? 'gren' : un.type === 'milice' ? 'milice' : isLight(un) ? 'leger' : 'inf';
      let n = clamp(Math.round(un.men / (cav ? per * 1.4 : per)), 4, cav ? 90 : 220);
      const pose = cav && un.state === 'charge' ? 2 : 0;
      if (un.form === 'carre' && !cav) {
        const per4 = Math.max(2, Math.round(n / 4)), s = w / 2;
        for (let f = 0; f < 4; f++) for (let k = 0; k < per4; k++) {
          const t = (k + 0.5) / per4 * 2 - 1, rank = k % 2;
          const [u0, v0] = [[t * s, s - rank * 1.2], [s - rank * 1.2, -t * s], [-t * s, -s + rank * 1.2], [-s + rank * 1.2, t * s]][f];
          out.push([u0, v0, kind, f, 0]);   // f : face du carré, la silhouette regarde vers l'extérieur
        }
        out.push([0, 0, 'officier', 0, 0]);
      } else if (un.form === 'tirailleurs' && !cav) {
        for (let k = 0; k < n; k++) out.push([(rnd(k) - 0.5) * w, (rnd(k + 500) - 0.5) * d, kind, 0, rnd(k + 900) < 0.4 ? 1 : 0]);
      } else {
        const ranks = cav ? (un.form === 'colonne' ? Math.max(2, Math.round(d / 4)) : 2) : un.form === 'colonne' ? Math.max(3, Math.round(d / 1.6)) : Math.max(2, Math.round(d / 4));
        const files = Math.max(1, Math.ceil(n / ranks));
        const du = w / files, dv = d / ranks;
        for (let r = 0; r < ranks; r++) for (let k = 0; k < files && out.length < n; k++) {
          const jit = cav ? 0.4 : 0.15;
          out.push([(k + 0.5) * du - w / 2 + (rnd(r * 300 + k) - 0.5) * du * jit, d / 2 - (r + 0.5) * dv + (rnd(r * 300 + k + 7) - 0.5) * dv * jit, kind, 0, cav ? pose | ((r * 3 + k) % 5) << 2 : 0]);
        }
        if (!cav) out.push([-w / 2 - 1.5, 0, 'officier', 0, 0]);
      }
      // déroute : chacun pour soi, éparpillés vers l'arrière ; mêlée : les rangs se brouillent
      if (rout || melee) for (const [k, f] of out.entries()) {
        const sp = rout ? 3.5 : 1;
        f[0] = f[0] * (rout ? 1.6 : 1) + (rnd(k + 70) - 0.5) * 10 * sp; f[1] = f[1] * (rout ? 2 : 1) + (rnd(k + 80) - 0.5) * 10 * sp;
        if (rout) { f[3] = 2; f[4] = cav ? 2 : 2; }
      }
    }
    un._lay = out; un._layKey = key;
    return out;
  }

  // ------------------------------------------------------------------ dessin
  // view : {toScreen(x, y) → [sx, sy], z (px/m), dpr} ; units déjà interpolées (x, y, dir)
  draw(ctx, view, units, time, colors) {
    // hauteur d'un homme à l'écran (px) : jamais moins de 6,5 px, pour rester lisible de loin
    const z = view.z, H = Math.max(6.5, 1.8 * z * view.figScale);
    const list = units.slice().sort((a, b) => a.y - b.y);
    const blocks = z < 0.22;
    for (const un of list) {
      const col = colors[un.side] || '#888';
      const [w, d] = [un.w, un.d];
      const c = Math.cos(un.dir), s = Math.sin(un.dir);
      // repère : avant (c, s), front (−s, c)
      const P = (uu, vv) => view.toScreen(un.x + c * vv - s * uu, un.y + s * vv + c * uu);
      ctx.globalAlpha = un._ghost ? 0.4 : un._fade ?? 1;
      if (blocks) { this.drawBlock(ctx, un, P, w, d, col, z); continue; }
      // une silhouette pour 3 à 6 hommes selon la taille à l'écran : les rangs restent serrés sans trop dessiner
      const crowd = H / (1.8 * z * view.figScale);   // > 1 quand les silhouettes sont grossies au-delà de l'échelle
      const lay = this.layout(un, w, d, Math.round((H >= 16 ? 3 : H >= 8 ? 4 : 5) * clamp(crowd, 1, 3)));
      const face0 = facingOf(un.dir);
      const march = un.state === 'marche' || un.state === 'charge' || un.state === 'deroute';
      const items = [];
      for (const [k, f] of lay.entries()) {
        let [uu, vv, kind, fo, pose] = f;
        let face = face0;
        if (un.form === 'carre' && clsOf(un) === 'inf' && kind !== 'officier') face = facingOf(un.dir + [0, -Math.PI / 2, Math.PI, Math.PI / 2][fo]);
        else if (fo === 2) face = facingOf(un.dir + Math.PI);
        if (march) vv += Math.sin(time * 9 + k * 1.7) * 0.25;
        const [sx, sy] = P(uu, vv);
        items.push([sy, sx, kind, face, pose, k]);
      }
      items.sort((a, b) => a[0] - b[0]);
      const bob = march ? 1 : 0;
      for (const [sy, sx, kind, face, pose, k] of items) {
        const hh = kind === 'cav' || kind === 'attelage' ? H : H;
        const sp = this.sprite(kind, col, face, hh, kind === 'inf' && un.state === 'deroute' ? 2 : pose);
        const sc = hh / sp.h;
        const yb = bob ? Math.abs(Math.sin(time * 9 + k * 1.7)) * hh * 0.04 : 0;
        ctx.drawImage(sp.cv, sx - sp.ax * sc, sy - sp.ay * sc - yb, sp.cv.width * sc, sp.cv.height * sc);
      }
    }
    ctx.globalAlpha = 1;
  }
  // de loin : les rangs en traits épais (habits), liseré clair des buffleteries, ombre au sol
  drawBlock(ctx, un, P, w, d, col, z) {
    const cls = clsOf(un);
    if (un.state === 'deroute') {
      ctx.fillStyle = col;
      for (let k = 0; k < 14; k++) { const [sx, sy] = P((hash(k, 3, un.men0) - 0.5) * w * 1.6, (hash(k, 4, un.men0) - 0.5) * d * 3); ctx.fillRect(sx - 1, sy - 2, 2, 2.5); }
      return;
    }
    const corners = [P(-w / 2, d / 2), P(w / 2, d / 2), P(w / 2, -d / 2), P(-w / 2, -d / 2)];
    ctx.fillStyle = 'rgba(20,16,10,0.35)';
    ctx.beginPath(); corners.forEach(([x, y], k) => k ? ctx.lineTo(x + 1.2, y + 1.2) : ctx.moveTo(x + 1.2, y + 1.2)); ctx.closePath(); ctx.fill();
    if (un.form === 'carre' && cls === 'inf') {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, 2.6 * z);
      ctx.beginPath(); corners.forEach(([x, y], k) => k ? ctx.lineTo(x, y - 1) : ctx.moveTo(x, y - 1)); ctx.closePath(); ctx.stroke();
      return;
    }
    const ranks = cls === 'artillerie' ? 1 : un.form === 'colonne' ? Math.max(2, Math.round(d / 8)) : un.form === 'tirailleurs' ? 1 : 2;
    for (let r = 0; r < ranks; r++) {
      const v = d / 2 - (r + 0.5) * d / ranks;
      const [ax, ay] = P(-w / 2, v), [bx, by] = P(w / 2, v);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = cls === 'cavalerie' ? '#5a3e26' : shadeHex(col, -0.25); ctx.lineWidth = Math.max(1.6, (d / ranks) * z * 0.8 * TILT + 1.2);
      if (un.form === 'tirailleurs') ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, (d / ranks) * z * 0.5 * TILT + 0.6);
      ctx.beginPath(); ctx.moveTo(ax, ay - 1); ctx.lineTo(bx, by - 1); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (cls === 'artillerie') {
      ctx.fillStyle = IRON;
      const p = pieces(un);
      for (let k = 0; k < p; k++) { const [sx, sy] = P((k - (p - 1) / 2) * (w / p), d / 2 - 4); ctx.fillRect(sx - 1.2, sy - 1.6, 2.4, 2.4); }
    }
  }
  // empreinte au sol (sélection, survol, fantôme d'ordre)
  footprint(ctx, view, x, y, dir, w, d, pad = 0) {
    const c = Math.cos(dir), s = Math.sin(dir);
    const P = (uu, vv) => view.toScreen(x + c * vv - s * uu, y + s * vv + c * uu);
    const W = w / 2 + pad, D = d / 2 + pad;
    const pts = [P(-W, D), P(W, D), P(W, -D), P(-W, -D)];
    ctx.beginPath(); pts.forEach(([sx, sy], k) => k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)); ctx.closePath();
    return pts;
  }

  // ------------------------------------------------------------------ fanions (taille constante à l'écran)
  // renvoie les rectangles des fanions (pour toucher une unité par son fanion)
  banners(ctx, view, units, colors, opts) {
    const out = [];
    const list = units.filter(u => u.state !== 'hors').map(un => {
      const [sx, sy] = view.toScreen(un.x, un.y);
      const lift = Math.max(un.d * 0.5 * view.z * TILT, 0) + Math.max(22, 1.8 * view.z * view.figScale * 1.6);
      return { un, sx, sy, top: sy - lift };
    }).sort((a, b) => a.sx - b.sx);
    // évite que les fanions se chevauchent : on hisse un peu plus haut celui qui gêne
    const placed = [];
    for (const b of list) {
      const gen = isGeneral(b.un), bw = gen ? 30 : 50, bh = gen ? 30 : 19;
      let y = b.top;
      for (let tries = 0; tries < 4; tries++) {
        const hit = placed.find(p => Math.abs(p.x - b.sx) < (p.w + bw) / 2 + 2 && Math.abs(p.y - y) < (p.h + bh) / 2 + 2);
        if (!hit) break;
        y = hit.y - (hit.h + bh) / 2 - 3;
      }
      placed.push({ x: b.sx, y, w: bw, h: bh, b });
    }
    for (const p of placed) {
      const { un, sx, sy } = p.b, col = colors[un.side] || '#777';
      const sel = opts.sel.has(String(un.id)), mine = un.side === opts.me, ghost = un._ghost;
      ctx.globalAlpha = ghost ? 0.55 : 1;
      // hampe
      ctx.strokeStyle = 'rgba(30,22,12,0.75)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, p.y + p.h / 2); ctx.stroke();
      if (isGeneral(un)) {
        this.medallion(ctx, sx, p.y, col, un, sel);
      } else {
        const x0 = sx - p.w / 2, y0 = p.y - p.h / 2, rout = un.state === 'deroute' && !ghost;
        const wave = Math.sin(opts.time * (rout ? 7 : 3) + sx * 0.05) * (rout ? 2.4 : 1.2);
        ctx.fillStyle = 'rgba(8,14,24,0.35)'; ctx.fillRect(x0 + 2, y0 + 2, p.w, p.h);
        // en déroute : fanion décoloré et barré
        ctx.fillStyle = rout ? shadeHex(col, 0.45) : col;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + p.w / 2, y0 + wave, x0 + p.w, y0); ctx.lineTo(x0 + p.w, y0 + p.h); ctx.quadraticCurveTo(x0 + p.w / 2, y0 + p.h + wave, x0, y0 + p.h); ctx.closePath(); ctx.fill();
        if (rout) { ctx.save(); ctx.globalAlpha *= 0.55; ctx.fillStyle = '#6d6a64'; ctx.fill(); ctx.restore(); }
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0, y0, 17, p.h);
        ctx.strokeStyle = sel ? '#ffe39a' : mine ? 'rgba(230,201,127,0.9)' : 'rgba(255,255,255,0.45)'; ctx.lineWidth = sel ? 2.4 : 1;
        ctx.stroke();
        this.picto(ctx, clsOf(un), x0 + 8.5, p.y, '#fff8e6');
        ctx.fillStyle = '#fff8e6'; ctx.font = (rout ? 'italic ' : '') + '600 13px "EB Garamond", Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ghost ? '?' : un.men >= 1000 ? (un.men / 1000).toFixed(1).replace('.', ',') + 'k' : String(Math.round(un.men)), x0 + 17 + (p.w - 17) / 2, p.y + 1);
        if (rout) {   // la barre
          ctx.strokeStyle = '#ffe2c8'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x0 + 3, y0 + p.h - 3); ctx.lineTo(x0 + p.w - 3, y0 + 3); ctx.stroke();
          ctx.strokeStyle = '#b8352a'; ctx.lineWidth = 1; ctx.stroke();
        }
        // moral : un liseré sous le fanion (vert → rouge) pour ses propres troupes
        if (mine) {
          const m = clamp((un.morale ?? 70) / 100, 0, 1);
          ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0, y0 + p.h + 1, p.w, 3);
          ctx.fillStyle = m > 0.5 ? '#8fcf6b' : m > 0.3 ? '#e6c45a' : '#e0604f'; ctx.fillRect(x0, y0 + p.h + 1, p.w * m, 3);
        }
      }
      ctx.globalAlpha = 1;
      out.push({ id: String(un.id), x0: sx - p.w / 2 - 4, y0: p.y - p.h / 2 - 4, x1: sx + p.w / 2 + 4, y1: sy });
    }
    return out;
  }
  medallion(ctx, x, y, col, un, sel) {
    ctx.fillStyle = 'rgba(8,14,24,0.4)'; ctx.beginPath(); ctx.arc(x + 2, y + 2, 15, 0, TAU); ctx.fill();
    ctx.fillStyle = '#13233a'; ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
    ctx.strokeStyle = sel ? '#ffe39a' : '#c8a253'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.fill();
    // bicorne
    ctx.fillStyle = '#16120e';
    ctx.beginPath(); ctx.moveTo(x - 8, y + 2); ctx.quadraticCurveTo(x, y - 9, x + 8, y + 2); ctx.quadraticCurveTo(x, y - 1, x - 8, y + 2); ctx.fill();
    ctx.fillStyle = '#e6c97f'; ctx.beginPath(); ctx.arc(x, y - 3, 1.6, 0, TAU); ctx.fill();
    const name = (genName(un) || un.name || '').toUpperCase();
    ctx.font = '600 10.5px "EB Garamond", Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(name).width + 10;
    ctx.fillStyle = 'rgba(19,35,58,0.9)'; ctx.fillRect(x - tw / 2, y + 17, tw, 13);
    ctx.strokeStyle = 'rgba(200,162,83,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(x - tw / 2, y + 17, tw, 13);
    ctx.fillStyle = '#f1ead8'; ctx.fillText(name, x, y + 24);
  }
  // pictogramme du type : fusil, tête de cheval, canon
  picto(ctx, cls, x, y, col) {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    if (cls === 'cavalerie') {
      // tête de cheval de profil
      ctx.beginPath(); ctx.moveTo(-3.5, 6); ctx.lineTo(-3, -1); ctx.lineTo(-1.5, -5); ctx.lineTo(-0.5, -7); ctx.lineTo(0.5, -5.2); ctx.lineTo(4.5, -1.5);
      ctx.lineTo(4, 0.5); ctx.lineTo(1, -0.5); ctx.lineTo(1.5, 6); ctx.closePath(); ctx.fill();
    } else if (cls === 'artillerie') {
      ctx.beginPath(); ctx.arc(-1, 2.5, 3.2, 0, TAU); ctx.stroke();
      ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-3.5, 0.5); ctx.lineTo(5, -3.5); ctx.stroke();
    } else if (cls === 'chariot') {
      ctx.beginPath(); ctx.arc(0, 1, 4.5, 0, TAU); ctx.moveTo(-4.5, 1); ctx.lineTo(4.5, 1); ctx.moveTo(0, -3.5); ctx.lineTo(0, 5.5); ctx.stroke();
    } else if (cls === 'general') {
      ctx.beginPath(); ctx.moveTo(-5, 1); ctx.quadraticCurveTo(0, -7, 5, 1); ctx.quadraticCurveTo(0, -2, -5, 1); ctx.fill();
    } else {
      // fantassin : shako, tête, habit, fusil à l'épaule
      ctx.fillRect(-1.8, -7.5, 3.6, 2.6);
      ctx.beginPath(); ctx.arc(0, -3.6, 1.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-2.6, -1.8); ctx.lineTo(2.6, -1.8); ctx.lineTo(2.2, 6); ctx.lineTo(-2.2, 6); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(3.4, 5); ctx.lineTo(4.3, -8); ctx.stroke();
    }
    ctx.restore();
  }
}
