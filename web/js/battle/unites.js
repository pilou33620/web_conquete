// Vue tactique : petites figurines peintes (fantassin, cavalier, pièce, caisson) des cartes d'unités de la barre du
// bas, en cache (par camp, type, sens, pose et taille en pixels physiques : nettes sur un écran Retina), bornées en
// mémoire par la qualité. Les régiments du champ de bataille sont en 3D (troupes.js), leurs fanions dans fanions.js.
import { TAU, TILT, OMBRE, mixHex, uniform } from './formes.js';

const SKIN = '#e2b996', HAT = '#1f1b18', WHITE = '#f3efe4', WOOD = '#6e5134', IRON = '#2c2c2a', BRONZE = '#b08a3e', GOLD = '#d6b65a';
const AFFUT = '#5f6b3e';   // affûts peints en vert olive
const HORSES = ['#6b4a2c', '#3f2d1f', '#8b6a47', '#54402e'];
const dark = (c, k) => mixHex(c, '#000000', k), lite = (c, k) => mixHex(c, '#ffffff', k);

// sens d'une figurine : 0 = de face, 1 = de profil vers la droite, 2 = de dos, 3 = de profil vers la gauche
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
  // color : la couleur du camp (revers, tapis de selle, plumet) ; coat : l'habit (l'uniforme d'époque, formes.uniform)
  sprite(kind, color, face, H, pose = 0, coat = null) {
    const hb = Math.max(4, Math.round(Math.log(H) / Math.log(1.08)));
    const key = `${kind}|${color}|${coat}|${face}|${hb}|${pose}`;
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
    if (kind === 'cav' || kind === 'colonel' || kind === 'attelage') this.horse(g, u, color, face, pose, kind, coat);
    else if (kind === 'canon') this.gun(g, u, face);
    else if (kind === 'caisson') this.limber(g, u, face, pose);
    else this.soldier(g, u, kind, color, face, pose, coat);
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
  soldier(g, u, kind, color, face, pose, coatIn = null) {
    const P = pen(g, u), year = this.year;
    const milice = kind === 'milice', officer = kind === 'officier' || kind === 'drapeau', drum = kind === 'tambour', servant = kind === 'servant';
    const U = uniform(year, servant ? 'artillerie' : 'inf', '', kind), base = coatIn ?? U.coat;
    const coat = milice ? U.coat : officer ? dark(base, 0.1) : base;
    const coatD = dark(coat, 0.35), coatL = lite(coat, 0.16);
    const trous = U.trous, trousD = dark(trous, 0.2);
    const gaiter = year < 1845 && !officer ? '#1d1916' : '#2a2420';
    const facing = milice ? '#5a4632' : color;   // (les revers à la couleur du camp, comme en 3D)
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
  horse(g, u, color, face, pose, kind, coat = null) {
    const rc = coat ?? uniform(this.year, 'cavalerie', '', kind).coat;   // (l'habit du cavalier)
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
        this.rider(P, rc, 1, gait === 2, colonel);
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
      if (!harness) { P.r(color, -0.48, -1.62, 0.96, 0.4); this.rider(P, rc, face, gait === 2, colonel); }
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
}
