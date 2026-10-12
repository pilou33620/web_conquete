// Vue tactique : les régiments en vue cavalière. Chaque régiment est fait de nombreuses petites figurines debout,
// en rangs serrés (trois rangs pour une ligne), avec son porte-drapeau (le drapeau flotte), ses tambours, ses
// officiers et son colonel à cheval ; cavaliers sur leurs chevaux ; batteries avec pièces, avant-trains et servants
// qui s'affairent. Les coiffures suivent l'époque (tricorne, bicorne, shako, képi, bonnet à poil). La marche est
// animée, les salves roulent le long du front (les hommes mettent en joue l'un après l'autre, puis rechargent),
// les pièces reculent au départ du coup.
// Chaque figurine est une petite image mise en cache (par camp, type, sens, pose et taille en pixels physiques :
// nette sur un écran Retina) ; une figurine ne coûte qu'un drawImage. Le cache est borné en mémoire par la qualité.
// Au-dessus de chaque régiment, un fanion de taille constante aux couleurs du camp porte l'effectif.
import { clsOf, isLight, isGeneral, isWagon, genName, pieces, hash, clamp, TAU, TILT, OMBRE, mixHex } from './formes.js';

const SKIN = '#e2b996', HAT = '#1f1b18', WHITE = '#f3efe4', WOOD = '#6e5134', IRON = '#2c2c2a', BRONZE = '#b08a3e', GOLD = '#d6b65a';
const AFFUT = '#5f6b3e';   // affûts peints en vert olive
const HORSES = ['#6b4a2c', '#3f2d1f', '#8b6a47', '#54402e'];
const dark = (c, k) => mixHex(c, '#000000', k), lite = (c, k) => mixHex(c, '#ffffff', k);

// sens de la figurine à l'écran : 0 = vers le bas (de face), 1 = vers la droite, 2 = vers le haut (de dos), 3 = vers la gauche
const facingOf = dir => { const c = Math.cos(dir), s = Math.sin(dir); return Math.abs(c) > Math.abs(s) * 0.9 ? (c > 0 ? 1 : 3) : (s > 0 ? 0 : 2); };
// poses de l'infanterie
const STAND = 0, AIM = 1, RUN = 2, MARCH = 3, RELOAD = 5, ROUT = 7;
// coiffure selon l'époque et le type
function headgear(kind, year) {
  if (kind === 'milice') return 'rond';
  if (kind === 'officier' || kind === 'drapeau') return year < 1815 ? 'bicorne' : year < 1860 ? 'shako' : 'kepi';
  if (kind === 'gren') return year < 1860 ? 'ourson' : 'kepi';
  if (year < 1795) return 'tricorne';
  if (year < 1806) return kind === 'leger' ? 'shako' : 'bicorne';
  return year < 1860 ? 'shako' : 'kepi';
}
// petit outil de dessin, en unités u (un homme debout mesure 10 u, les pieds en 0, la tête en haut)
function pen(g, u) {
  const path = pts => { g.beginPath(); g.moveTo(pts[0] * u, pts[1] * u); for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k] * u, pts[k + 1] * u); };
  return {
    r: (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x * u, y * u, w * u, h * u); },
    p: (c, ...pts) => { g.fillStyle = c; path(pts); g.closePath(); g.fill(); },
    l: (c, w, ...pts) => { g.strokeStyle = c; g.lineWidth = Math.max(0.6, w * u); path(pts); g.stroke(); },
    e: (c, x, y, rx, ry, rot = 0) => { g.fillStyle = c; g.beginPath(); g.ellipse(x * u, y * u, rx * u, ry * u, rot, 0, TAU); g.fill(); },
  };
}

export class UnitArt {
  // q : profil de qualité graphique (qualite.js)
  constructor(q) {
    this.sprites = new Map();
    this.bytes = 0;
    this.q = q;
    this.year = 1800;   // année de la bataille (coiffures) ; la vue la donne d'après la carte
  }
  setQuality(q) { this.q = q; this.trim(); }
  setYear(y) { if (y && y !== this.year) { this.year = y; this.clear(); } }
  clear() { for (const s of this.sprites.values()) s.cv.width = s.cv.height = 0; this.sprites.clear(); this.bytes = 0; }
  trim() {
    for (const [k, s] of this.sprites) {
      if (this.bytes <= (this.q?.sprites ?? 24e6)) break;
      this.bytes -= s.cv.width * s.cv.height * 4;
      s.cv.width = s.cv.height = 0;   // Safari garde sinon la mémoire
      this.sprites.delete(k);
    }
  }

  // ------------------------------------------------------------------ figurines en cache
  // kind : 'inf' | 'gren' | 'leger' | 'milice' | 'officier' | 'tambour' | 'drapeau' | 'servant' | 'cav' | 'colonel'
  //        | 'attelage' | 'canon' | 'caisson' ; H : hauteur d'un homme en pixels du canevas visé ; renvoie {cv, ax, ay, h} :
  // le canevas, l'ancre (les pieds) et la hauteur d'homme pour laquelle il est peint
  sprite(kind, color, face, H, pose = 0) {
    const hb = Math.max(4, Math.round(Math.log(H) / Math.log(1.08)));
    const key = `${kind}|${color}|${face}|${hb}|${pose}`;
    let sp = this.sprites.get(key);
    if (sp) { this.sprites.delete(key); this.sprites.set(key, sp); return sp; }   // le plus récemment servi passe en fin de file
    const h = Math.pow(1.08, hb);
    const wide = kind === 'cav' || kind === 'colonel' || kind === 'canon' || kind === 'caisson' || kind === 'attelage';
    // marge à droite et en bas pour l'ombre portée (vers le sud-est)
    const W = Math.ceil(h * (wide ? 2.4 : 1.25)), HH = Math.ceil(h * (wide ? 1.9 : 1.62));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = HH;
    const g = cv.getContext('2d');
    const ax = Math.round(W * (wide ? 0.44 : 0.36)), ay = Math.round(HH - h * (wide ? 0.2 : 0.22));
    g.translate(ax, ay);   // origine : les pieds
    const u = h / 10;
    if (kind === 'cav' || kind === 'colonel' || kind === 'attelage') this.horse(g, u, color, face, pose, kind);
    else if (kind === 'canon') this.gun(g, u, face);
    else if (kind === 'caisson') this.limber(g, u, face, pose);
    else this.soldier(g, u, kind, color, face, pose);
    sp = { cv, ax, ay, h };
    this.sprites.set(key, sp);
    this.bytes += W * HH * 4;
    if (this.bytes > (this.q?.sprites ?? 24e6)) this.trim();
    return sp;
  }
  // ombre portée au sol, allongée vers le sud-est (en bas à droite de l'écran)
  shadow(g, u, len, wid) {
    const a = Math.atan2(OMBRE[1] * TILT, OMBRE[0]);
    g.fillStyle = 'rgba(16,14,8,0.26)';
    g.beginPath(); g.ellipse(Math.cos(a) * len * u * 0.5, Math.sin(a) * len * u * 0.5, len * u * 0.55, wid * u, a, 0, TAU); g.fill();
  }
  soldier(g, u, kind, color, face, pose) {
    const P = pen(g, u), year = this.year;
    const milice = kind === 'milice', officer = kind === 'officier' || kind === 'drapeau', drum = kind === 'tambour', servant = kind === 'servant';
    const coat = milice ? '#7a6248' : officer ? dark(color, 0.1) : color;
    const coatD = dark(coat, 0.35), coatL = lite(coat, 0.16);
    const trous = milice ? '#5a4c3c' : year >= 1830 ? '#8d929b' : WHITE, trousD = dark(trous, 0.2);
    const gaiter = year < 1845 && !officer ? '#1d1916' : '#2a2420';
    const facing = milice ? '#5a4632' : WHITE;
    const prof = face === 1 || face === 3, back = face === 2;
    const fine = u >= 1.1;   // assez grand pour les petits détails
    this.shadow(g, u, 7, 1.1);
    if (face === 3) g.scale(-1, 1);
    // servant : pose 3, accroupi (le pointeur) ; ses autres poses (écouvillon, boulet, boutefeu) plus bas
    if (servant && pose === 3) g.scale(1, 0.78);
    const run = pose === RUN || pose === ROUT, march = pose === MARCH || pose === MARCH + 1;
    const stride = run ? 1.25 : march ? (pose === MARCH ? 0.8 : -0.8) : pose === AIM && prof ? 0.6 : 0;
    const lean = run && prof ? 0.5 : 0;
    // jambes (culottes blanches et guêtres noires, puis pantalons)
    if (prof) {
      const fx = stride * 1.3, bx = -stride * 1.3;
      for (const [x, sh] of [[bx, true], [fx, false]]) {
        P.l(sh ? trousD : trous, 0.95, lean * 0.6, -4.9, x * 0.55, -2.5, x, -0.35);
        P.l(gaiter, 0.85, x * 0.55, -2.5, x, -0.35);
        P.r('#15110d', x - 0.35, -0.5, 1.15, 0.5);
      }
    } else {
      const lf = march ? (pose === MARCH ? 0.7 : 0) : run ? 0.9 : 0, rf = march ? (pose === MARCH ? 0 : 0.7) : 0;
      P.r(trous, -1.15, -4.9, 1.0, 4.9 - lf); P.r(trous, 0.15, -4.9, 1.0, 4.9 - rf);
      P.r(trousD, 0.75, -4.9, 0.4, 4.9 - rf);
      P.r(gaiter, -1.15, -2.6, 1.0, 2.6 - lf); P.r(gaiter, 0.15, -2.6, 1.0, 2.6 - rf);
      P.r('#15110d', -1.2, -0.45 - lf, 1.1, 0.45); P.r('#15110d', 0.1, -0.45 - rf, 1.1, 0.45);
    }
    g.save(); if (lean) g.translate(lean * u, 0);
    // habit : corps, basques (retroussis clairs), ombre du flanc droit
    const bw = prof ? 2.3 : 3.1;
    if (prof) {
      P.p(coat, -1.15, -8.2, 1.1, -8.2, 1.25, -5.0, -0.9, -5.0, -1.5, -3.9, -1.0, -3.8);   // basque derrière
      if (!milice) P.p(facing, -1.45, -4.1, -1.0, -3.85, -0.75, -4.9);
      P.r(coatD, 0.35, -8.0, 0.75, 3.0);
    } else {
      P.p(coat, -bw / 2, -8.2, bw / 2, -8.2, bw / 2 + 0.25, -4.4, -bw / 2 - 0.25, -4.4);
      if (!milice && !back) { P.p(facing, -bw / 2 - 0.25, -4.4, -bw / 2 + 0.35, -4.4, -bw / 2 + 0.1, -5.4); P.p(facing, bw / 2 + 0.25, -4.4, bw / 2 - 0.35, -4.4, bw / 2 - 0.1, -5.4); }
      P.r(coatD, bw / 2 - 0.7, -8.0, 0.75, 3.6);
      if (back && !milice) P.p(facing, -0.9, -5.2, 0.9, -5.2, 0.6, -4.2, -0.6, -4.2);   // retroussis des basques
    }
    // revers du plastron, buffleteries, giberne, sac
    if (!milice && !servant) {
      if (face === 0) {
        if (fine && year < 1815 && !officer) P.p(facing, -0.55, -8.1, 0.55, -8.1, 0.4, -5.6, -0.4, -5.6);
        if (!officer) { P.l(WHITE, 0.42, -bw / 2 + 0.2, -8.0, bw / 2 - 0.3, -4.9); P.l(WHITE, 0.42, bw / 2 - 0.2, -8.0, -bw / 2 + 0.3, -4.9); }
      } else if (back) {
        P.r('#6a5038', -1.15, -7.7, 2.3, 2.5);                  // sac de peau
        P.r(dark('#6a5038', 0.3), 0.55, -7.7, 0.6, 2.5);
        P.e('#b9b2a0', 0, -7.9, 1.25, 0.42);                      // capote roulée
        P.r('#1d1916', -0.9, -5.4, 1.8, 0.75);                  // giberne
        if (!officer) { P.l(WHITE, 0.35, -1.2, -7.8, -0.6, -5.2); P.l(WHITE, 0.35, 1.2, -7.8, 0.6, -5.2); }
      } else {
        P.r('#6a5038', -1.95, -7.6, 0.95, 2.4);                 // sac vu de profil
        P.e('#b9b2a0', -1.45, -7.75, 0.6, 0.4);
        P.r('#1d1916', -1.5, -5.6, 0.75, 0.8);
        if (!officer) P.l(WHITE, 0.35, -0.7, -8.0, 0.8, -5.2);
      }
    }
    if (officer) {
      P.e(GOLD, -bw / 2 + 0.3, -8.0, 0.55, 0.28); if (!prof) P.e(GOLD, bw / 2 - 0.3, -8.0, 0.55, 0.28);   // épaulettes
      P.r('#c8b46a', -bw / 2 + 0.1, -5.6, bw - 0.2, 0.45);    // écharpe
    }
    // tambour : la caisse sur la cuisse gauche, cerclée aux couleurs du camp, les baguettes
    if (drum) {
      const dx = prof ? 0.9 : -0.9;
      P.r(color, dx - 1.0, -5.6, 2.0, 1.5); P.e('#efe9da', dx, -5.6, 1.0, 0.38);
      if (fine) { P.l('#efe9da', 0.18, dx - 0.9, -4.3, dx - 0.45, -5.4, dx, -4.3, dx + 0.45, -5.4, dx + 0.9, -4.3); }
      P.l(WOOD, 0.22, dx - 0.4, -6.6, dx - 0.1, -5.7); P.l(WOOD, 0.22, dx + 0.6, -6.8, dx + 0.25, -5.8);
    }
    // bras et fusil selon la pose
    const musket = !officer && !drum && !servant && pose !== ROUT;
    const brown = '#4a3420', steel = '#cfd3d8', sw = 0.42;
    const arm = (x1, y1, x2, y2) => { P.l(coat, 0.85, x1, y1, x2, y2); P.e(SKIN, x2, y2, 0.32, 0.32); };
    if (prof) {
      if (pose === AIM) {
        arm(0.2, -7.9, 1.9, -8.0); arm(-0.4, -7.8, 0.3, -7.2);
        if (musket) { P.l(brown, sw, -0.8, -7.4, 7.4, -8.3); P.l(steel, 0.18, 7.4, -8.3, 9.9, -8.55); }
      } else if (pose === RUN) {
        arm(0.3, -7.8, 1.5, -6.4); arm(-0.4, -7.8, 0.4, -5.6);
        if (musket) { P.l(brown, sw, -1.4, -5.3, 6.4, -7.1); P.l(steel, 0.18, 6.4, -7.1, 8.8, -7.6); }
      } else if (pose === RELOAD) {
        arm(0.3, -7.9, 1.6, -8.6); arm(-0.2, -7.8, 1.5, -5.5);
        if (musket) { P.l(brown, sw, 1.6, -0.2, 1.6, -8.9); P.l(steel, 0.12, 1.75, -8.9, 1.75, -11.3); }
      } else if (pose === ROUT) {
        arm(0.2, -7.9, 1.4, -9.4); arm(-0.3, -7.8, -1.5, -6.6);
      } else if (servant) {
        if (pose === 1) { arm(0.3, -7.8, 1.6, -6.9); arm(-0.3, -7.8, 0.6, -6.9); P.l(WOOD, 0.3, -2.5, -6.7, 7.5, -7.1); P.e('#2a2a2a', 7.6, -7.1, 0.45, 0.45); }   // écouvillon
        else if (pose === 2) { arm(0.3, -7.8, 1.2, -6.4); P.e(IRON, 1.6, -6.4, 0.6, 0.6); }                                                       // boulet porté
        else if (pose === 4) { arm(0.3, -7.9, 1.8, -9.6); P.l(WOOD, 0.22, 1.8, -9.6, 2.6, -11.6); P.e('#ff9a3a', 2.65, -11.7, 0.3, 0.3); }   // boutefeu
        else { arm(0.2, -7.9, 0.6, -5.2); arm(-0.4, -7.8, -0.6, -5.3); }
      } else if (officer && kind === 'officier') {
        arm(0.2, -7.9, 0.9, -6.0); P.l(steel, 0.2, 0.9, -6.0, 2.6 + (pose === RUN ? 1 : 0), -10.8);   // sabre levé
      } else if (kind === 'drapeau') {
        arm(0.3, -7.9, 0.9, -9.4); arm(-0.3, -7.8, 0.8, -7.0);
      } else {
        // l'arme sur l'épaule (en marche, au repos)
        arm(0.2, -7.9, 0.75, -5.6);
        if (musket) { P.l(brown, sw, 0.95, -4.6, -0.15, -13.3); P.l(steel, 0.16, -0.15, -13.3, -0.4, -15.4); }
      }
    } else {
      const sx = back ? -1 : 1;
      if (pose === AIM) {
        if (back) { arm(-1.4, -7.9, -2.1, -8.4); arm(1.4, -7.9, 1.2, -8.6); if (musket) P.l(brown, sw, 0.7, -8.4, 0.9, -9.5); }
        else { arm(-1.4, -7.9, -0.4, -7.5); arm(1.4, -7.9, 0.5, -7.2); if (musket) { P.l(brown, sw * 1.2, 0.55, -8.2, 0.2, -6.9); P.e(IRON, 0.18, -6.8, 0.3, 0.3); P.l(steel, 0.16, 0.1, -6.6, 0.0, -5.9); } }
      } else if (pose === RUN) {
        arm(-1.4, -7.9, -0.6, -5.8); arm(1.4, -7.9, 1.0, -6.0);
        if (musket) { if (back) { P.l(brown, sw, -0.4, -5.6, 0.2, -9.6); P.l(steel, 0.16, 0.2, -9.6, 0.3, -10.8); } else { P.l(brown, sw, 1.1, -6.2, 0.3, -3.5); P.l(steel, 0.16, 0.3, -3.5, 0.1, -2.2); } }
      } else if (pose === RELOAD) {
        arm(-1.4, -7.9, 0.2, -8.8); arm(1.4, -7.9, 0.5, -6.0);
        if (musket) { P.l(brown, sw, 0.5 * sx, back ? -9.0 : -0.2, 0.5 * sx, -8.9); P.l(steel, 0.12, 0.6 * sx, -8.9, 0.6 * sx, -11.3); }
      } else if (pose === ROUT) {
        arm(-1.4, -7.9, -2.0, -9.6); arm(1.4, -7.9, 2.0, -9.4);
      } else if (servant) {
        if (pose === 1) { arm(-1.4, -7.9, -0.8, -6.6); arm(1.4, -7.9, 0.8, -6.6); P.l(WOOD, 0.3, -2.8, -6.8, 2.8, -6.8); }
        else if (pose === 2) { arm(-1.4, -7.9, -0.4, -6.2); arm(1.4, -7.9, 0.4, -6.2); P.e(IRON, 0, -6.2, 0.6, 0.6); }
        else if (pose === 4) { arm(1.4, -7.9, 2.0, -9.6); P.l(WOOD, 0.22, 2.0, -9.6, 2.4, -11.6); P.e('#ff9a3a', 2.45, -11.7, 0.3, 0.3); arm(-1.4, -7.9, -1.6, -5.3); }
        else { arm(-1.4, -7.9, -1.6, -5.3); arm(1.4, -7.9, 1.6, -5.3); }
      } else if (officer && kind === 'officier') {
        arm(-1.4, -7.9, -1.6, -5.3); arm(1.4 * sx, -7.9, 2.0 * sx, -6.2); P.l(steel, 0.2, 2.0 * sx, -6.2, 2.4 * sx, -11.0);
      } else if (kind === 'drapeau') {
        arm(-1.4, -7.9, 0.1, -9.2); arm(1.4, -7.9, 0.2, -7.2);
      } else {
        arm(-1.4, -7.9, -1.6, -5.3); arm(1.4 * sx, -7.9, 1.7 * sx, -5.2);
        if (musket) { P.l(brown, sw, 1.75 * sx, -4.4, 1.9 * sx, -13.3); P.l(steel, 0.16, 1.9 * sx, -13.3, 1.95 * sx, -15.5); }
      }
    }
    // tête et coiffure
    const hx = prof ? 0.25 : 0;
    P.e(back ? '#4a3626' : SKIN, hx, -9.0, 0.85, 0.88);
    if (prof) P.e('#4a3626', hx - 0.45, -9.15, 0.5, 0.65);   // cheveux, queue
    if (!back && fine) P.e(dark(SKIN, 0.25), hx + (prof ? 0.7 : 0), -8.85, 0.12, 0.12);
    this.hat(P, headgear(servant ? 'inf' : kind, year), hx, prof, back, color, kind, fine);
    g.restore();
  }
  // coiffures : la tête est en (hx, −9)
  hat(P, type, hx, prof, back, color, kind, fine) {
    const plume = kind === 'gren' ? '#c83a2a' : kind === 'leger' ? '#4f8a3a' : kind === 'officier' || kind === 'drapeau' ? '#f1ece0' : kind === 'tambour' ? '#c83a2a' : lite(color, 0.35);
    switch (type) {
      case 'tricorne':
        if (prof) P.p(HAT, hx - 1.2, -9.4, hx - 0.3, -10.6, hx + 1.25, -9.7, hx + 0.6, -9.45);
        else P.p(HAT, hx - 1.55, -9.55, hx - 0.6, -10.55, hx, -10.25, hx + 0.6, -10.55, hx + 1.55, -9.55, hx, -9.2);
        if (fine) P.l('#e8e0c8', 0.12, hx - 1.5, -9.55, hx, -9.25, hx + 1.5, -9.55);
        break;
      case 'bicorne':
        if (prof) P.p(HAT, hx - 0.9, -9.5, hx - 0.5, -11.4, hx + 0.6, -11.3, hx + 0.9, -9.5);
        else P.p(HAT, hx - 1.8, -9.6, hx - 0.8, -10.6, hx + 0.8, -10.6, hx + 1.8, -9.6, hx, -9.75);
        if (fine && !back) P.e('#2f4fa0', hx + (prof ? 0.3 : 0.6), -10.2, 0.22, 0.22);
        break;
      case 'shako':
        P.p(HAT, hx - 0.85, -9.6, hx + 0.85, -9.6, hx + 0.95, -11.35, hx - 0.95, -11.35);
        P.r(dark(HAT, 0.3), hx - 0.85, -9.75, 1.7, 0.25);
        if (!back && !prof && fine) P.e(BRONZE, hx, -10.3, 0.35, 0.3);
        P.e(plume, hx + (prof ? 0.2 : 0), -11.7, 0.32, 0.55);
        break;
      case 'kepi':
        P.p(color === HAT ? '#7a2a22' : dark(color, 0.1), hx - 0.8, -9.55, hx + 0.8, -9.55, hx + 0.65, -10.6, hx - 0.85, -10.5);
        P.r('#1f2a44', hx - 0.82, -9.85, 1.64, 0.32);
        if (!back) P.p(HAT, hx - 0.6, -9.55, hx + (prof ? 1.3 : 0.6), -9.4, hx + 0.6, -9.55);
        break;
      case 'ourson':   // bonnet à poil des grenadiers
        P.e(HAT, hx, -10.7, 1.05, 1.7);
        if (fine) { P.e('#2c2622', hx - 0.35, -11.4, 0.4, 0.8); P.e(plume, hx + (prof ? -0.8 : 0.8), -11.1, 0.22, 0.7); }
        break;
      case 'rond':     // chapeau rond des miliciens
        P.e('#3d2f22', hx, -9.55, 1.6, 0.45); P.r('#3d2f22', hx - 0.75, -10.6, 1.5, 1.05);
        break;
    }
  }
  // cheval (et son cavalier) : pose & 3 = allure (0 au pas arrêté, 1 au pas, 2 au galop), (pose >> 2) & 3 = phase
  // de l'allure, pose >> 4 = robe
  horse(g, u, color, face, pose, kind) {
    const m = u * 10 / 1.75;   // pixels par mètre (l'homme debout mesure 1,75 m)
    const hc = HORSES[(pose >> 4) % HORSES.length], hd = dark(hc, 0.35), hl = lite(hc, 0.18);
    const gait = pose & 3, ph = (pose >> 2) & 3, harness = kind === 'attelage', colonel = kind === 'colonel';
    const P = pen(g, m);   // ici en mètres
    // ombre : le cheval est long
    g.fillStyle = 'rgba(16,14,8,0.26)';
    const a = Math.atan2(OMBRE[1] * TILT, OMBRE[0]);
    g.beginPath(); g.ellipse(Math.cos(a) * 1.1 * m, Math.sin(a) * 1.1 * m * 0.6, (face === 1 || face === 3 ? 1.9 : 1.2) * m, 0.42 * m, face === 1 || face === 3 ? 0.12 : a, 0, TAU); g.fill();
    // allures : angles (cuisse, canon) des quatre jambes, par phase
    const GAITS = [
      [[0, 0], [0, 0], [0, 0], [0, 0]],
      [[0.3, 0.1], [-0.25, 0], [0.2, 0], [-0.3, -0.25]],
      [[0.75, 0.9], [0.35, -0.2], [-0.6, -0.9], [-0.25, 0.4]],
    ];
    const legs = gait === 2 ? GAITS[2].map((l, k) => GAITS[2][(k + ph) % 4]) : gait === 1 ? GAITS[1].map((l, k) => (ph & 1 ? GAITS[1][3 - k] : l)) : GAITS[0];
    const lift = gait === 2 ? [0.08, 0.16, 0.04, 0.12][ph] : 0;
    if (face === 1 || face === 3) {
      g.save(); if (face === 3) g.scale(-1, 1); g.translate(0, -lift * m);
      // jambes : avant (x ≈ 0,7) et arrière (x ≈ −0,7), la paire du fond plus sombre
      const leg = (x, [a1, a2], far) => {
        const kx = x + Math.sin(a1) * 0.48, ky = -0.95 + Math.cos(a1) * 0.48, fx = kx + Math.sin(a2) * 0.5, fy = ky + Math.cos(a2) * 0.5;
        P.l(far ? dark(hd, 0.25) : hd, 0.15, x, -1.15, kx, ky, fx, fy);
        P.e('#1a1410', fx, fy, 0.09, 0.06);
      };
      leg(0.62, legs[1], true); leg(-0.72, legs[3], true);
      // queue, corps, poitrail, croupe, encolure, tête
      P.l(hd, 0.14, -1.0, -1.45, -1.25 - (gait === 2 ? 0.25 : 0), -1.2 + (gait === 2 ? -0.1 : 0.0), -1.2, -0.75 - (gait === 2 ? -0.3 : 0));
      P.e(hc, 0, -1.25, 1.02, 0.4);
      P.e(hc, 0.68, -1.3, 0.38, 0.38); P.e(hc, -0.72, -1.32, 0.4, 0.4);
      P.p(hc, 0.55, -1.55, 1.05, -2.15, 1.32, -2.05, 1.0, -1.25);
      P.e(hc, 1.42, -1.95, 0.36, 0.15, 0.6);
      P.l(hd, 0.08, 0.6, -1.62, 1.05, -2.2);   // crinière
      P.e(hl, -0.1, -1.5, 0.75, 0.12);         // lumière sur le dos
      P.e(dark(hc, 0.2), 0.1, -0.98, 0.8, 0.12);
      leg(0.75, legs[0], false); leg(-0.6, legs[2], false);
      if (harness) {
        P.l('#2a1e14', 0.06, 1.0, -1.85, -1.1, -1.3); P.r('#2a1e14', -0.25, -1.62, 0.5, 0.35);
      } else {
        // tapis de selle aux couleurs du camp, bordé de blanc
        P.p(color, -0.5, -1.62, 0.35, -1.62, 0.45, -1.05, -0.6, -1.05); P.l(WHITE, 0.05, 0.45, -1.05, -0.6, -1.05);
        this.rider(P, color, 1, gait === 2, colonel);
      }
      g.restore();
    } else {
      const back = face === 2;
      g.save(); g.translate(0, -lift * m);
      // jambes de devant (ou de derrière), le corps raccourci, la tête ou la queue
      const st = gait ? (ph & 1 ? 0.12 : -0.12) : 0;
      P.r(hd, -0.3, -1.0 + st, 0.15, 1.0 - st); P.r(hd, 0.15, -1.0 - st, 0.15, 1.0 + st);
      P.e(hc, 0, -1.25, 0.44, 0.52);
      if (back) { P.l(hd, 0.16, 0, -1.4, 0.05, -0.75); P.e(hl, -0.15, -1.45, 0.18, 0.2); }
      else { P.e(hc, 0, -1.62, 0.17, 0.4); P.e(hd, 0, -1.3, 0.12, 0.08); P.e(hl, -0.08, -1.75, 0.07, 0.18); }
      if (!harness) { P.r(color, -0.48, -1.62, 0.96, 0.4); this.rider(P, color, face, gait === 2, colonel); }
      g.restore();
    }
  }
  // cavalier, en mètres (P à l'échelle du mètre) ; sabre sur l'épaule, ou levé à la charge
  rider(P, color, face, charge, colonel) {
    const prof = face === 1, back = face === 2, year = this.year;
    const coat = colonel ? dark(color, 0.1) : color;
    if (prof) {
      P.l('#f1ece0', 0.13, 0, -1.66, 0.22, -1.32); P.l('#17120e', 0.12, 0.22, -1.32, 0.12, -0.98);   // culotte, botte
      P.p(coat, -0.2, -2.45, 0.2, -2.45, 0.24, -1.68, -0.24, -1.68);
      P.r(dark(coat, 0.35), 0.06, -2.4, 0.14, 0.7);
      if (!colonel) P.l(WHITE, 0.05, -0.18, -2.4, 0.18, -1.75);
      else P.e(GOLD, -0.12, -2.42, 0.13, 0.06);
      P.e(SKIN, 0.04, -2.62, 0.13, 0.13);
      P.l('#d8dce0', 0.035, 0.22, -2.0, charge ? 0.95 : 0.05, charge ? -2.9 : -2.95);
      P.l(coat, 0.1, 0.0, -2.35, 0.22, -2.0);
    } else {
      P.r('#17120e', -0.36, -1.62, 0.12, 0.62); P.r('#17120e', 0.24, -1.62, 0.12, 0.62);
      P.p(coat, -0.25, -2.45, 0.25, -2.45, 0.27, -1.66, -0.27, -1.66);
      if (!back && !colonel) { P.l(WHITE, 0.05, -0.22, -2.4, 0.22, -1.7); P.l(WHITE, 0.05, 0.22, -2.4, -0.22, -1.7); }
      if (colonel) { P.e(GOLD, -0.22, -2.42, 0.1, 0.05); P.e(GOLD, 0.22, -2.42, 0.1, 0.05); }
      P.e(back ? '#4a3626' : SKIN, 0, -2.62, 0.13, 0.13);
      P.l('#d8dce0', 0.035, 0.27, -2.0, charge ? 0.6 : 0.3, charge ? -2.95 : -2.95);
    }
    // casque à crinière (dragons), puis le colonel en bicorne ou en képi
    const hx = prof ? 0.04 : 0;
    if (colonel) {
      if (year < 1815) P.p(HAT, hx - 0.28, -2.68, hx - 0.12, -2.86, hx + 0.12, -2.86, hx + 0.28, -2.68);
      else P.r(HAT, hx - 0.13, -2.92, 0.26, 0.26);
    } else if (year < 1870) {
      P.e(BRONZE, hx, -2.72, 0.15, 0.12);
      P.l('#1a1410', 0.07, hx + 0.02, -2.82, hx - (prof ? 0.3 : 0.05), -2.6);
    } else P.r(dark(color, 0.2), hx - 0.13, -2.86, 0.26, 0.2);
  }
  // pièce d'artillerie : roues à rais, affût olive, tube de bronze éclairé
  gun(g, u, face) {
    const m = u * 10 / 1.75, P = pen(g, m);
    g.fillStyle = 'rgba(16,14,8,0.24)'; g.beginPath(); g.ellipse(0.5 * m, 0.15 * m, 1.9 * m, 0.4 * m, 0.15, 0, TAU); g.fill();
    if (face === 1 || face === 3) {
      g.save(); g.scale(face === 3 ? -1 : 1, 1);
      P.l(AFFUT, 0.24, 0.1, -0.75, -2.1, -0.08);            // flèche de l'affût
      P.l(dark(AFFUT, 0.3), 0.1, 0.1, -0.68, -2.1, -0.02);
      P.l(BRONZE, 0.34, -0.55, -1.02, 1.55, -1.1);         // tube
      P.l(lite(BRONZE, 0.35), 0.08, -0.5, -1.12, 1.5, -1.19);
      P.e(dark(BRONZE, 0.3), 1.6, -1.1, 0.07, 0.18);
      // roue : jante, rais, moyeu
      g.strokeStyle = '#3a2a1a'; g.lineWidth = Math.max(0.6, 0.09 * m);
      g.beginPath(); g.arc(0, -0.66 * m, 0.64 * m, 0, TAU); g.stroke();
      g.lineWidth = Math.max(0.5, 0.045 * m); g.beginPath();
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 6; g.moveTo(Math.cos(a) * 0.6 * m, -0.66 * m + Math.sin(a) * 0.6 * m); g.lineTo(-Math.cos(a) * 0.6 * m, -0.66 * m - Math.sin(a) * 0.6 * m); }
      g.stroke(); P.e('#2a1e14', 0, -0.66, 0.1, 0.1);
      g.restore();
    } else {
      P.r('#3a2a1a', -0.78, -1.3, 0.14, 1.3); P.r('#3a2a1a', 0.64, -1.3, 0.14, 1.3);
      P.r(AFFUT, -0.62, -0.95, 1.24, 0.3);
      if (face === 0) { P.e(BRONZE, 0, -1.06, 0.24, 0.24); P.e(IRON, 0, -1.06, 0.11, 0.11); }
      else { P.e(BRONZE, 0, -1.08, 0.22, 0.5); P.l(AFFUT, 0.22, 0, -0.95, 0, -0.2); }
    }
  }
  // avant-train (pose 0) ou caisson à munitions (pose 1)
  limber(g, u, face, pose) {
    const m = u * 10 / 1.75, P = pen(g, m), prof = face === 1 || face === 3, L = pose ? 1.9 : 1.2;
    g.fillStyle = 'rgba(16,14,8,0.24)'; g.beginPath(); g.ellipse(0.5 * m, 0.15 * m, (prof ? L : 0.9) * m, 0.4 * m, 0.15, 0, TAU); g.fill();
    const wheel = x => { g.strokeStyle = '#3a2a1a'; g.lineWidth = Math.max(0.6, 0.08 * m); g.beginPath(); g.arc(x * m, -0.55 * m, 0.52 * m, 0, TAU); g.stroke(); P.e('#2a1e14', x, -0.55, 0.08, 0.08); };
    if (prof) {
      if (pose) wheel(-1.1);
      P.r(AFFUT, -L * 0.6, -1.45, L * 1.2, 0.65); P.r(lite(AFFUT, 0.2), -L * 0.6, -1.45, L * 1.2, 0.15); P.r(dark(AFFUT, 0.3), -L * 0.6, -0.86, L * 1.2, 0.08);
      wheel(pose ? 1.0 : 0);
    } else {
      P.r('#3a2a1a', -0.72, -1.1, 0.12, 1.1); P.r('#3a2a1a', 0.6, -1.1, 0.12, 1.1);
      P.r(AFFUT, -0.6, -1.4, 1.2, 0.62); P.r(lite(AFFUT, 0.2), -0.6, -1.4, 1.2, 0.14);
    }
  }

  // ------------------------------------------------------------------ disposition des figurines
  // Renvoie une liste [[u, v, kind, faceOffset, pose, rang, phase], …] en mètres dans le repère de l'unité : u le long
  // du front, v vers l'avant ; rang : 0 pour le premier rang (il tire), −1 hors des rangs ; phase : décalage de
  // l'animation. sp, sr : écartement des files et des rangs (m), selon la taille des figurines à l'écran et le sens
  // du front ; per : hommes par figurine. Recalculée seulement quand l'effectif, la formation, l'état, les
  // écartements ou le nombre d'hommes par figurine changent.
  layout(un, w, d, sp, sr, per) {
    const cls = clsOf(un), key = `${un.form}|${un.state}|${Math.round(un.men / 8)}|${w | 0}|${d | 0}|${un.type}|${per}|${sp.toFixed(2)}|${sr.toFixed(2)}`;
    if (un._lay && un._layKey === key) return un._lay;
    const out = [], id = String(un.id).length * 97 + (un.men0 || 0) + (String(un.id).charCodeAt(0) || 0) * 7;
    const rnd = k => hash(k, id, 41);
    const rout = un.state === 'deroute', melee = un.state === 'melee';
    const push = (uu, vv, kind, fo = 0, pose = 0, rank = -1) => out.push([uu, vv, kind, fo, pose, rank, rnd(out.length + 300) * 6]);
    if (isWagon(un)) {
      // chariot de munitions : deux chevaux, la voiture, le conducteur
      push(-0.9, 5.5, 'attelage', 0, 1 << 4); push(0.9, 5.5, 'attelage', 0, 2 << 4); push(0, -1, 'caisson', 0, 1); push(1.6, 1.5, 'servant');
    } else if (isGeneral(un)) {
      push(0, 0, 'colonel');
      for (let k = 0; k < 5; k++) push((k - 2) * 4.5, -5 - (k % 2) * 3, 'cav', 0, (k % 4) << 4);
      push(7, -1, 'cav', 0, 1 << 4, -3);   // le fanion de l'état-major, à cheval
    } else if (cls === 'artillerie') {
      const p = pieces(un);
      if (un.form === 'attelee') {
        for (let k = 0; k < p; k++) {
          const v0 = d / 2 - 4 - k * (d - 8) / Math.max(1, p);
          for (const [du, dv, c] of [[-0.9, 0, 0], [0.9, 0, 1], [-0.9, -3, 2], [0.9, -3, 3]]) push(du, v0 + dv, 'attelage', 0, (c % 4) << 4);
          push(0, v0 - 6.5, 'caisson', 0, 0); push(0, v0 - 10, 'canon', 2, 0);
          push(2.4, v0 - 2, 'servant', 0, 0); push(-2.4, v0 - 8, 'servant', 0, 0);
        }
      } else {
        // en batterie : la pièce au front, six servants autour, l'avant-train et ses chevaux derrière
        for (let k = 0; k < p; k++) {
          const u0 = (k - (p - 1) / 2) * (w / Math.max(1, p)), v0 = d / 2 - 5;
          push(u0, v0, 'canon', 0, 0, 100 + k);
          for (const [du, dv, role] of [[-1.6, 1.8, 1], [1.6, 1.4, 4], [-1.4, -1.3, 2], [1.5, -1.7, 0], [0.4, -3.4, 3], [-0.6, -5.5, 2]]) push(u0 + du, v0 + dv, 'servant', 0, role, 200 + k * 10 + role);
          push(u0, -d / 2 + 10, 'caisson', 0, 0);
          push(u0 - 0.9, -d / 2 + 5.5, 'attelage', 2, (k % 4) << 4); push(u0 + 0.9, -d / 2 + 5.5, 'attelage', 2, ((k + 1) % 4) << 4);
        }
      }
    } else {
      const cav = cls === 'cavalerie';
      const kind = cav ? 'cav' : un.type === 'grenadiers' || un.type === 'garde' ? 'gren' : un.type === 'milice' ? 'milice' : isLight(un) ? 'leger' : 'inf';
      const n = clamp(Math.round(un.men / per), 4, cav ? 160 : 480);
      if (un.form === 'carre' && !cav) {
        // carré : trois rangs par face, tournés vers l'extérieur ; drapeau, tambours et officiers au milieu
        const ranks = n > 60 ? 3 : 2, per4 = Math.max(2, Math.round(n / 4 / ranks)), s = w / 2;
        for (let f = 0; f < 4; f++) for (let r = 0; r < ranks; r++) for (let k = 0; k < per4; k++) {
          const t = (k + 0.5) / per4 * 2 - 1, e = s - r * Math.min(sp, sr);
          const [u0, v0] = [[t * e, e], [e, -t * e], [-t * e, -e], [-e, t * e]][f];
          push(u0, v0, kind, f, 0, r);   // f : face du carré, la figurine regarde vers l'extérieur
        }
        push(0, 0, 'drapeau', 0, 0, -2); push(-2, -1.5, 'tambour'); push(2, 1, 'officier'); push(-1.5, 2, 'officier');
      } else if (un.form === 'tirailleurs' && !cav) {
        // tirailleurs : par deux, dispersés, chacun à son rythme
        for (let k = 0; k < n; k++) {
          const pair = k >> 1, uu = (rnd(pair) - 0.5) * w + (k & 1) * 1.1, vv = (rnd(pair + 500) - 0.5) * d;
          push(uu, vv, kind, 0, 0, 0);
        }
        push(0, -d / 2 - 2, 'officier');
      } else {
        // ligne (trois rangs serrés) ou colonne ; un peu de désordre naturel dans les rangs
        const col = un.form === 'colonne';
        const ranks = cav ? (col ? Math.max(2, Math.round(n / Math.max(2, Math.round(w / sp)))) : 2)
          : col ? Math.max(3, Math.ceil(n / Math.max(4, Math.round(w / sp)))) : n >= 36 ? 3 : 2;
        const files = Math.max(1, Math.ceil(n / ranks));
        const du = w / files, dv = cav ? sr * 2.4 : Math.min(d / ranks, sr);
        const v0 = d / 2 - dv * 0.5;
        for (let r = 0; r < ranks; r++) for (let k = 0; k < files && out.length < n; k++) {
          // les rangs de derrière décalés d'une demi-file : on voit les hommes entre les épaules du rang de devant
          const jit = cav ? 0.3 : 0.12, stag = cav || col ? 0 : (r & 1) * 0.5 * du;
          push((k + 0.5) * du - w / 2 + stag + (rnd(r * 300 + k) - 0.5) * du * jit, v0 - r * dv + (rnd(r * 300 + k + 7) - 0.5) * dv * jit, kind, 0, cav ? ((r * 3 + k) % 4) << 4 : 0, r);
        }
        const rear = v0 - ranks * dv;
        if (cav) {
          push(0, d / 2 + 3, 'colonel'); push(2.5, d / 2 + 1.6, 'cav', 0, 0, -3);   // l'étendard, à cheval
        } else {
          // porte-drapeau au milieu du premier rang (à la place d'un homme), tambours, officiers et colonel derrière
          const mid = out.reduce((b, f, i) => (f[5] === 0 && Math.abs(f[0]) < Math.abs(out[b][0]) ? i : b), 0);
          out[mid][2] = 'drapeau'; out[mid][5] = -2;
          push(-du * 2, rear - sr * 0.5, 'tambour'); push(du * 2, rear - sr * 0.6, 'tambour');
          for (const f of [-0.42, 0.42]) push(f * w, rear - sr * 0.6, 'officier');
          if (n > 60) push(0, rear - sr * 3, 'colonel');
          if (col) push(-w / 2 - sp, d / 2 - sr, 'officier');
        }
      }
      // déroute : chacun pour soi, éparpillés vers l'arrière ; mêlée : les rangs se brouillent
      if (rout || melee) for (const [k, f] of out.entries()) {
        const s = rout ? 3.5 : 1;
        f[0] = f[0] * (rout ? 1.6 : 1) + (rnd(k + 70) - 0.5) * 10 * s; f[1] = f[1] * (rout ? 2 : 1) + (rnd(k + 80) - 0.5) * 10 * s;
        if (rout) { f[3] = 2; f[4] = cav ? f[4] | 2 : ROUT; }
        else if (!cav && f[2] !== 'drapeau' && f[2] !== 'officier') f[4] = rnd(k + 90) < 0.5 ? RUN : AIM;
      }
    }
    un._lay = out; un._layKey = key;
    return out;
  }

  // ------------------------------------------------------------------ dessin
  // view : {toScreen(x, y) → [sx, sy], z (px/m), figScale, dpr, fxT (horloge des effets)} ; units déjà interpolées
  draw(ctx, view, units, time, colors) {
    // hauteur d'un homme à l'écran (px) : jamais moins de 6,5 px, pour rester lisible de loin
    const z = view.z, H = Math.max(6.5, 1.8 * z * view.figScale);
    const list = units.slice().sort((a, b) => a.y - b.y);
    if (z < 0.22) { for (const un of list) { ctx.globalAlpha = un._ghost ? 0.4 : un._fade ?? 1; this.drawBlock(ctx, un, view, colors[un.side] || '#888', z); } ctx.globalAlpha = 1; return; }
    // écartement des figurines (m) : une largeur d'homme à l'écran ; au-delà du budget de la qualité, chaque
    // figurine compte plus d'hommes
    const sp = 0.5 * H / z;
    let want = 0;
    for (const un of list) want += Math.min(un.men || 0, (un.w / sp + 2) * (clsOf(un) === 'cavalerie' ? 2 : un.form === 'colonne' ? Math.max(3, un.d / (sp * 0.7)) : un.form === 'carre' ? 12 : 3));
    // (par paliers de 25 % : le nombre d'hommes par figurine ne change pas à chaque image, ni la disposition)
    const crowd = Math.pow(1.25, Math.max(0, Math.ceil(Math.log(want / (this.q?.figures ?? 9000)) / Math.log(1.25))));
    for (const un of list) this.drawUnit(ctx, view, un, time, colors[un.side] || '#888', H, sp, crowd);
    ctx.globalAlpha = 1;
  }
  drawUnit(ctx, view, un, time, col, H, sp, crowd) {
    const z = view.z, dpr = view.dpr || 1, fxT = view.fxT ?? time, cls = clsOf(un), cav = cls === 'cavalerie';
    const { w, d } = un, c = Math.cos(un.dir), s = Math.sin(un.dir);
    // repère : avant (c, s), front (−s, c) ; la projection est affine : calculée ici sans passer par toScreen
    const [ox, oy] = view.toScreen(un.x, un.y), zt = z * TILT;
    ctx.globalAlpha = un._ghost ? 0.4 : un._fade ?? 1;
    // écartements à l'écran : côte à côte, une largeur d'homme ; l'un derrière l'autre (vers le haut de l'écran), les
    // têtes dépassent des épaules du rang de devant. Par paliers : pas de nouvelle disposition à chaque image.
    const step = x => Math.pow(1.1, Math.round(Math.log(x) / Math.log(1.1)));
    const nf = Math.hypot(s, c * TILT), nr = Math.hypot(c, s * TILT);
    // (front nord-sud, vu de côté : les files s'empilent à l'écran ; on les écarte d'un demi-homme pour que chacun
    // montre au moins sa tête et son buste)
    const spF = step(H * (0.45 * Math.abs(s) + 0.55 * Math.abs(c) * TILT) / nf / (z * nf)) * (cav ? 1.7 : 1);   // un cheval tient plus de place
    const spR = step(H * (0.55 * Math.abs(c) + 0.42 * Math.abs(s) * TILT) / nr / (z * nr));
    // hommes par figurine : autant qu'il faut pour remplir le front à l'écartement voulu, plus si le budget l'exige
    const slots = (w / spF + 1) * (cav ? 2 : un.form === 'colonne' ? Math.max(3, d / spR) : un.form === 'carre' ? 8 : 3);
    const per = Math.max(1, Math.round(Math.max(1, (un.men || 1) / slots) * crowd * 2) / 2);
    const lay = this.layout(un, w, d, spF, spR, per);
    const face0 = facingOf(un.dir);
    const moving = un.to && un.from && Math.hypot(un.to.x - un.from.x, un.to.y - un.from.y) > 0.3;
    const march = un.state === 'marche' || (moving && un.state !== 'charge' && un.state !== 'deroute');
    const run = un.state === 'charge' || un.state === 'deroute';
    const vol = un._volley, firing = vol && fxT - vol.t < 8;
    const shots = un._shots;
    const sk = un.form === 'tirailleurs', feu = un.state === 'feu' || un.state === 'recharge';
    const Hp = H * dpr, local = new Map(), items = [];
    for (const [k, f] of lay.entries()) {
      let [uu, vv, kind, fo, pose, rank, ph] = f;
      let face = face0;
      if (un.form === 'carre' && !cav && rank >= 0) face = facingOf(un.dir + [0, -Math.PI / 2, Math.PI, Math.PI / 2][fo]);
      else if (fo === 2) face = facingOf(un.dir + Math.PI);
      let bob = 0;
      if (kind === 'cav' || kind === 'colonel' || kind === 'attelage') {
        // allure des chevaux : au galop à la charge, au pas en marche
        const gait = run ? 2 : march ? 1 : 0;
        pose = (pose & ~15) | gait | ((((time * (gait === 2 ? 7 : 3)) + ph) | 0) & 3) << 2;
      } else if (kind === 'canon') {
        // recul au départ du coup, puis on remet la pièce en batterie
        const t = shots ? fxT - (shots[rank - 100] ?? -99) : 99;
        if (t >= 0 && t < 1.6) vv -= (t < 0.06 ? t / 0.06 : 1 - (t - 0.06) / 1.54) * 1.4;
      } else if (kind === 'servant' && rank >= 200) {
        // les servants s'affairent : écouvillon, boulet, pointage, boutefeu
        const t = shots ? fxT - (shots[((rank - 200) / 10) | 0] ?? -99) : 99, role = rank % 10;
        if (t < 6 || feu) pose = t < 0.4 ? (role === 4 ? 4 : 0) : role === 1 ? (t < 3.5 ? 1 : 0) : role === 2 ? ((time * 0.5 + ph) % 2 < 1.2 ? 2 : 0) : role === 3 ? 3 : role === 4 ? (t > 4 ? 4 : 0) : 0;
        else pose = role === 3 ? 3 : 0;
        if (pose === 2 && role === 2) vv += Math.sin(time * 1.4 + ph) * 1.2;
        face = role === 1 || role === 3 ? facingOf(un.dir + (uu < 0 ? Math.PI / 2 : -Math.PI / 2) * (role === 1 ? -1 : 1)) : face;
      } else if (pose !== ROUT && pose !== RUN && pose !== AIM) {
        if (run) { pose = RUN; bob = Math.abs(Math.sin(time * 11 + ph)) * 0.08; }
        else if (march) { pose = MARCH + (((time * 2.6 + ph) | 0) & 1); bob = Math.abs(Math.sin(time * 8.2 + ph)) * 0.035; }
        else if (rank >= 0 && rank < 2 && firing && !sk) {
          // la salve roule le long du front : chacun met en joue, tire à son tour, puis recharge
          const at = vol.t + vol.dur * (vol.roll > 0 ? uu / w + 0.5 : 0.5 - uu / w);
          const t = fxT - at;
          pose = t > -0.7 && t < 0.15 ? AIM : t >= 0.15 && t < 5 ? RELOAD : STAND;
        } else if (sk && (feu || firing) && rank === 0) {
          const cyc = (time * 0.3 + ph * 0.37) % 1;
          pose = cyc < 0.18 ? AIM : cyc < 0.62 ? RELOAD : STAND;
        }
      }
      items.push(oy + (s * vv + c * uu) * zt, ox + (c * vv - s * uu) * z, kind, face, pose, bob, rank);
    }
    // du fond vers le devant
    const n = items.length / 7, order = Array.from({ length: n }, (_, i) => i).sort((a, b) => items[a * 7] - items[b * 7]);
    for (const i of order) {
      const o = i * 7, sy = items[o], sx = items[o + 1], kind = items[o + 2], face = items[o + 3], pose = items[o + 4], bob = items[o + 5], rank = items[o + 6];
      const lk = kind + face + pose;   // (un seul chiffre pour le sens : pas d'ambiguïté)
      let spr = local.get(lk);
      if (!spr || !spr.cv.width) { spr = this.sprite(kind, col, face, Hp, pose); local.set(lk, spr); }   // (libérée par le cache entre-temps : repeinte)
      const sc = H / spr.h;   // pixels CSS par pixel de la figurine
      ctx.drawImage(spr.cv, sx - spr.ax * sc, sy - spr.ay * sc - bob * H, spr.cv.width * sc, spr.cv.height * sc);
      // drapeau du porte-drapeau, étendard d'un cavalier
      if (rank === -2) this.flag(ctx, sx, sy - bob * H, H, col, un, time, face, false);
      else if (rank === -3) this.flag(ctx, sx, sy - bob * H - H * 0.75, H, col, un, time, face, true);
    }
  }
  // drapeau qui flotte au vent : la hampe, l'étoffe en bandes ombrées selon l'ondulation ; avant 1790, la croix
  // blanche des drapeaux d'ordonnance ; ensuite un losange blanc au centre
  flag(ctx, x, y, H, col, un, time, face, small) {
    const pole = H * (small ? 1.7 : 2.6), fw = H * (small ? 0.7 : 1.3), fh = H * (small ? 0.48 : 0.85);
    const px = x + (face === 3 ? -H * 0.1 : face === 1 ? H * 0.12 : H * 0.03), top = y - pole;
    ctx.strokeStyle = '#3d2c1a'; ctx.lineWidth = Math.max(1, H * 0.045);
    ctx.beginPath(); ctx.moveTo(px, y - H * 0.55); ctx.lineTo(px, top); ctx.stroke();
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(px, top, Math.max(1, H * 0.05), 0, TAU); ctx.fill();
    const N = 6, sgn = Math.cos(un.dir) >= 0 ? -1 : 1, ph = time * 4.2 + (un.x + un.y) * 0.01;   // l'étoffe flotte vers l'arrière
    const wave = k => Math.sin(ph - k * 0.9) * fh * 0.16 * (k / N);
    for (let k = 0; k < N; k++) {
      const x0 = px + sgn * fw * k / N, x1 = px + sgn * fw * (k + 1) / N, w0 = wave(k), w1 = wave(k + 1);
      const shade = (w1 - w0) / (fh * 0.08);
      ctx.fillStyle = shade > 0 ? dark(col, Math.min(0.35, shade * 0.18)) : lite(col, Math.min(0.25, -shade * 0.14));
      ctx.beginPath(); ctx.moveTo(x0, top + w0); ctx.lineTo(x1, top + w1); ctx.lineTo(x1, top + fh + w1); ctx.lineTo(x0, top + fh + w0); ctx.closePath(); ctx.fill();
    }
    // motif blanc : croix (Ancien Régime) ou losange, qui suit l'ondulation
    ctx.fillStyle = 'rgba(246,242,232,0.92)';
    const at = (f, v) => [px + sgn * fw * f, top + v * fh + wave(f * N)];
    const poly = pts => { ctx.beginPath(); pts.forEach(([f, v], k) => { const [a, b] = at(f, v); if (k) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.closePath(); ctx.fill(); };
    if (this.year < 1790) { poly([[0.42, 0], [0.58, 0], [0.58, 1], [0.42, 1]]); poly([[0, 0.4], [1, 0.4], [1, 0.6], [0, 0.6]]); }
    else poly([[0.5, 0.08], [0.88, 0.5], [0.5, 0.92], [0.12, 0.5]]);
    // frange dorée
    ctx.strokeStyle = 'rgba(214,182,90,0.9)'; ctx.lineWidth = Math.max(0.8, H * 0.03);
    ctx.beginPath(); for (let k = 0; k <= N; k++) { const [a, b] = at(k / N, 0); if (k) ctx.lineTo(a, b); else ctx.moveTo(a, b); }
    for (let k = N; k >= 0; k--) { const [a, b] = at(k / N, 1); ctx.lineTo(a, b); } ctx.closePath(); ctx.stroke();
  }
  // de loin : les rangs en traits épais (habits), liseré clair des buffleteries, ombre au sol
  drawBlock(ctx, un, view, col, z) {
    const cls = clsOf(un), { w, d } = un, c = Math.cos(un.dir), s = Math.sin(un.dir);
    const P = (uu, vv) => view.toScreen(un.x + c * vv - s * uu, un.y + s * vv + c * uu);
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
      ctx.strokeStyle = cls === 'cavalerie' ? '#5a3e26' : dark(col, 0.25); ctx.lineWidth = Math.max(1.6, (d / ranks) * z * 0.8 * TILT + 1.2);
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
      // au-dessus des têtes et du drapeau du régiment
      const lift = Math.max(un.d * 0.5 * view.z * TILT, 0) + Math.max(22, 1.8 * view.z * view.figScale * 2.3);
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
        ctx.fillStyle = rout ? lite(col, 0.45) : col;
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
