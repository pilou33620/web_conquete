// Vue tactique 2D : les troupes vues de dessus (SPEC-2D.md § 4), d'après la maquette dev/maquette-2d.html dont on
// reprend le dessin des figures (fantassin, cheval, cavalier, pièce, avant-train, caisson, drapeau) et les poses.
// Une figure par homme tant que le budget de la qualité le permet (au-delà, une figure pour plusieurs), placée dans
// l'emprise de la formation (formes.js, emprise). Chaque figure est un sprite mis en cache (camp et type, rôle,
// image de la pose, taille en pixels), posé par drawImage ; les ombres d'un seul tracé ; de loin (figures de moins de
// 2 px), un bloc aux couleurs du camp, à la forme de la formation.
// Repère d'un régiment : ox vers l'avant (cos dir, sin dir), oy vers sa droite (−sin dir, cos dir), en mètres depuis
// son centre. Repère d'une figure (maquette) : l'avant vers +x, la droite vers +y, en unités de S mètres.
import { emprise, clsOf, isGeneral, isWagon, isLight, pieces, uniform, hash, clamp, TAU, canvas } from './formes.js';

export const S = 0.22;          // mètres par unité de dessin de la maquette (un homme fait 2,7 × 4,3 u, 0,6 × 0,95 m)
export const CAP = { inf: 480, cav: 240 };   // figures au plus par régiment (au-delà, une figure compte plusieurs hommes)
const TR = 1.2;                 // s : les hommes courent vers leur nouvelle place (nouvelle formation, pertes)
const BALL = 6;                 // hommes couchés au plus par un boulet
const PEAU = '#e2b996';

// rôles des figures (une sorte de sprite chacun)
export const R = { H: 0, PIQUE: 1, DRAPEAU: 2, OFFICIER: 3, TAMBOUR: 4, SERVANT: 5, CAV: 6, CAV_OFF: 7, CAV_GEN: 8, CHEVAL: 9, PIECE: 10, AVANT: 11, CAISSON: 12 };
const PIETON = r => r <= R.SERVANT, MONTURE = r => r >= R.CAV && r <= R.CHEVAL;
// qui peut tomber (kill) : les hommes, à pied ou à cheval
const TOMBE = r => r <= R.CAV_GEN;
// ce que tient la figure (maquette, fantassin)
const ARMES = ['epaule', 'joue', 'recharge', 'sol', 'baio', 'hache0', 'hache', 'pique', 'piqueH', 'refouloir', 'epee', 'epee+', 'tambour', 'aucun'];
const A = Object.fromEntries(ARMES.map((a, i) => [a, i]));
// boîte de chaque sprite (u) : [x0, y0, x1, y1] ; ombre au sol : demi-axes (u)
const BOITE = [];
const OMB = [];
for (let r = 0; r <= R.CAISSON; r++) {
  BOITE[r] = r <= R.SERVANT ? [-3.6, -4.2, 11, 3.8] : r <= R.CAV_GEN ? [-8.2, -4, 9.2, 8.6] : r === R.CHEVAL ? [-8.2, -3, 9, 3]
    : r === R.PIECE ? [-14.6, -4, 7.6, 4] : r === R.AVANT ? [-2.9, -4, 9.3, 4] : [-8.9, -4.2, 15.3, 4.2];
  OMB[r] = r <= R.SERVANT ? [2.4, 2.3] : r <= R.CHEVAL ? [6, 2.5] : r === R.PIECE ? [7, 3.4] : r === R.AVANT ? [4, 3.6] : [9.5, 4.4];
}

// ------------------------------------------------------------------ outils (maquette)
const mod = (a, n) => ((a % n) + n) % n;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
function alea(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const graine = id => [...String(id)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const hx = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const MEMO = new Map();
function mix(a, b, k) {
  const key = a + b + k; let v = MEMO.get(key);
  if (!v) { const P = hx(a), Q = hx(b); v = '#' + P.map((x, i) => Math.round(x + (Q[i] - x) * k).toString(16).padStart(2, '0')).join(''); MEMO.set(key, v); }
  return v;
}
const sombre = (c, k = 0.25) => mix(c, '#000000', k), clair = (c, k = 0.25) => mix(c, '#ffffff', k);
// couleur du camp en « #rrggbb » (le serveur l'envoie ainsi ; sinon un gris)
function hex6(c) {
  if (typeof c !== 'string') return '#666666';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
  return '#666666';
}
function E(g, c, x, y, rx, ry, r = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, r, 0, TAU); g.fill(); }
function C(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function T(g, c, w, x1, y1, x2, y2) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
function RR(g, c, x, y, w, h, r) { g.fillStyle = c; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill(); }
function PG(g, c, p) { g.fillStyle = c; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); }

// ------------------------------------------------------------------ tenues
// coiffure selon l'époque (comme unites.js) ; la cavalerie : casque à crinière
export function coiffure(kind, year) {
  if (kind === 'milice') return 'rond';
  if (kind === 'officier') return year < 1815 ? 'bicorne' : year < 1860 ? 'shako' : 'kepi';
  if (kind === 'gren') return year < 1860 ? 'ourson' : 'kepi';
  if (kind === 'cav') return year < 1760 ? 'tricorne' : year < 1870 ? 'casque' : 'kepi';
  if (year < 1795) return 'tricorne';
  if (year < 1806) return kind === 'leger' ? 'shako' : 'bicorne';
  return year < 1860 ? 'shako' : 'kepi';
}
// tenue d'un régiment (maquette, tenue) : la couleur du camp fait l'habit, pour que les deux camps se lisent ; le type
// en donne la nuance et les distinctives, l'année la coiffure et la culotte (garance dès 1829 : formes.uniform)
export function tenue(color, type, year) {
  const coat = hex6(color), cls = clsOf({ type });
  const kind = type === 'grenadiers' || type === 'garde' || type === 'sapeurs' ? 'gren' : type === 'milice' ? 'milice' : type === 'legere' || type === 'chasseurs' ? 'leger' : 'inf';
  const L = {
    habit: coat, revers: '#f1eee4', culotte: uniform(year, cls === 'cavalerie' ? 'cavalerie' : 'inf').trous,
    sac: '#7d5f3e', couv: '#bdb6a3', buff: '#f2efe6', epaul: '#f1eee4', tete: coiffure(kind, year), teteOff: coiffure('officier', year),
    pompon: clair(coat, 0.55), plume: null, sacOn: true, kepi: year >= 1829 ? '#a8302a' : sombre(coat, 0.2), drap: coat,
    chevaux: ['#6b4a2c', '#3f2d1f', '#8b6a47', '#54402e', '#2e2119'], chabraque: sombre(coat, 0.1), galon: '#f2efe6',
    affut: mix('#5f6b3e', coat, 0.25), fut: '#b08a3e', caisse: mix('#5f6b3e', coat, 0.25), bache: '#ece4cb',
  };
  switch (type) {
    case 'legere': Object.assign(L, { habit: sombre(coat, 0.15), epaul: '#e3c23c', pompon: '#e3c23c', plume: '#3f8a3c' }); break;
    case 'grenadiers': case 'garde': Object.assign(L, { epaul: '#c8322b', plume: '#c8322b' }); break;
    case 'chasseurs': Object.assign(L, { habit: sombre(coat, 0.3), ceinture: '#b32a26', sacOn: false, epaul: sombre(coat, 0.3), revers: null }); break;
    case 'sapeurs': Object.assign(L, { tablier: '#f4f0e4', epaul: '#c8322b', plume: '#c8322b' }); break;
    case 'milice': Object.assign(L, { habits: ['#5d6b86', '#6e5c45', '#7a5040', '#7d6d55', '#5a4b3a'].map(c => mix(c, coat, 0.4)), sacOn: false, buff: null, epaul: null, revers: null, culotte: '#8d806a' }); break;
    case 'cavalerie': Object.assign(L, { revers: '#e0c25a', galon: '#e6c95c' }); break;
    case 'artillerie': Object.assign(L, { habit: sombre(coat, 0.3), epaul: '#c8322b', sacOn: false }); break;
    case 'mitrailleuses': Object.assign(L, { tete: 'kepi', habit: sombre(coat, 0.25), buff: null, epaul: sombre(coat, 0.25), revers: null, affut: '#4f5458', fut: '#36393d', mit: true, sacOn: false }); break;
    case 'general': case 'etat_major': Object.assign(L, { tete: year < 1860 ? 'bicorne' : 'kepi', habit: sombre(coat, 0.2), epaul: '#e3c04f', plume: '#f4f1ea', chabraque: sombre(coat, 0.2), galon: '#e3c04f', chevaux: ['#e8e2d4', '#6b4a2c', '#3f2d1f', '#8b6a47'] }); break;
    case 'chariot': Object.assign(L, { habit: mix(coat, '#4a5878', 0.5), sacOn: false }); break;
  }
  if (cls === 'cavalerie' && type !== 'general') L.tete = coiffure('cav', year);
  if (cls === 'artillerie' && type !== 'mitrailleuses') L.tete = coiffure('inf', year);
  return L;
}

// ------------------------------------------------------------------ dispositions
// hommes par figure : autant qu'il faut pour tenir dans le budget (par paliers de 25 % : la disposition ne change pas
// à chaque perte), comme en 3D
export function hommesParFigure(men, budget) {
  return Math.pow(1.25, Math.max(0, Math.ceil(Math.log(Math.max(1, men) / Math.max(1, budget)) / Math.log(1.25))));
}
const capOf = u => (clsOf(u) === 'cavalerie' ? CAP.cav : CAP.inf);
// figures d'un régiment : {role, ox, oy, fa (cap propre), rang (0 devant ; −1 encadrement), r, jx, jy (éparpillement de
// la déroute, m), dl, off (décalage du feu, s), i (pièce), job, v (variante : habit, robe du cheval), fanion, monte}.
// per : hommes par figure ; fs : échelle des figures (grandies quand chacune compte plusieurs hommes)
export function disposition(u, per = 1, fs = 1) {
  const k = S * fs, [w0, d0] = emprise(u), w = u.w || w0, d = u.d || d0, cls = clsOf(u), type = u.type;
  const rnd = alea(graine(u.id ?? 0)), F = [];
  const H = (role, ox, oy, o) => { const f = { role, ox, oy, fa: 0, rang: -1, r: rnd(), jx: 0, jy: 0, dl: rnd() * 0.25, off: 0, i: 0, job: 0, v: 0, fanion: false, monte: false }; if (o) Object.assign(f, o); F.push(f); return f; };
  const robe = () => (rnd() * 5) | 0;
  if (isWagon(u)) {
    // chariot de munitions : quatre chevaux (le conducteur monté sur l'un), le caisson
    H(R.CHEVAL, 17 * k, -2.7 * k, { v: robe() }); H(R.CHEVAL, 17 * k, 2.7 * k, { v: robe(), monte: true });
    H(R.CHEVAL, 6 * k, -2.7 * k, { v: robe() }); H(R.CHEVAL, 6 * k, 2.7 * k, { v: robe() }); H(R.CAISSON, -9 * k, 0);
  } else if (isGeneral(u)) {
    // le général, son état-major et le fanion
    H(R.CAV_GEN, 0, 0, { v: 0 }); H(R.CAV_OFF, -10 * k, -9 * k, { v: 1 + ((rnd() * 3) | 0) });
    H(R.CAV_OFF, -11 * k, 8 * k, { v: 1 + ((rnd() * 3) | 0), fanion: true }); H(R.CAV, -21 * k, 0, { v: 1 + ((rnd() * 3) | 0) });
  } else if (cls === 'artillerie') {
    const p = pieces(u);
    if (u.form === 'attelee') {
      // en route : par pièce, deux paires de chevaux (un conducteur sur chaque paire), l'avant-train, la pièce en
      // remorque, la bouche vers l'arrière, et ses servants à pied
      const g = Math.max(50 * k, (d - 6) / p), x0 = d / 2 - 26 * k;
      for (let i = 0; i < p; i++) {
        const bx = x0 - i * g;
        H(R.CHEVAL, bx + 18 * k, -2.7 * k, { i, v: robe() }); H(R.CHEVAL, bx + 18 * k, 2.7 * k, { i, v: robe(), monte: true });
        H(R.CHEVAL, bx + 7 * k, -2.7 * k, { i, v: robe() }); H(R.CHEVAL, bx + 7 * k, 2.7 * k, { i, v: robe(), monte: true });
        H(R.AVANT, bx - 3 * k, 0, { i }); H(R.PIECE, bx - 13 * k, 0, { fa: Math.PI, i });
        H(R.SERVANT, bx - 5 * k, 7 * k, { i }); H(R.SERVANT, bx - 14 * k, 7 * k, { i }); H(R.SERVANT, bx - 10 * k, -7 * k, { i });
      }
    } else {
      // en batterie : la pièce au front, ses servants (écouvillon et refouloir, pointeur, pourvoyeurs), l'avant-train
      // et ses chevaux derrière ; sur un rempart, ni avant-train ni chevaux
      const mur = !!u.rempart, sp = w / p, x0 = mur ? 4 * k : 17 * k;
      for (let i = 0; i < p; i++) {
        const oy = (i - (p - 1) / 2) * sp;
        H(R.PIECE, x0, oy, { i });
        if (!mur) { H(R.AVANT, x0 - 24 * k, oy, { fa: Math.PI, i }); H(R.CHEVAL, x0 - 33 * k, oy - 2.7 * k, { fa: Math.PI, i, v: robe() }); H(R.CHEVAL, x0 - 33 * k, oy + 2.7 * k, { fa: Math.PI, i, v: robe(), monte: true }); }
        H(R.SERVANT, x0 + (mur ? -1 : 3) * k, oy - 4.8 * k, { i, job: 1 }); H(R.SERVANT, x0 - 11 * k, oy + 0.6 * k, { i, job: 2 });
        H(R.SERVANT, x0 - 3 * k, oy + 5.2 * k, { i }); if (!mur) H(R.SERVANT, x0 - 15 * k, oy - 5 * k, { i });
      }
    }
  } else if (cls === 'cavalerie') {
    // escadrons : files de chevaux épaule contre épaule, rangs d'une longueur de cheval ; l'officier et le fanion devant
    const n = clamp(Math.round((u.men || 0) / per), 1, CAP.cav), col = u.form === 'colonne';
    const files = clamp(Math.floor(w / (4.6 * k)), 1, n), ranks = Math.ceil(n / files), dy = w / files;
    const dv = Math.max(13 * k, Math.min(d / ranks, 18 * k)), front = (ranks - 1) / 2 * dv;
    for (let j = 0; j < n; j++) {
      const f = (j / ranks) | 0, r = j % ranks;
      H(R.CAV, front - r * dv, (f - (files - 1) / 2) * dy, { rang: r, v: robe() });
    }
    H(R.CAV_OFF, front + (col ? 14 : 12) * k, 0, { fanion: true, v: robe() });
  } else {
    const n = clamp(Math.round((u.men || 0) / per), 1, CAP.inf), sap = type === 'sapeurs', mil = type === 'milice';
    // piquiers : l'infanterie « mousquet et piques » (arme 0), un homme sur cinq au centre ; la milice en a quelques-uns
    const pike = u.arm === 0 && !isLight(u) && (type === 'ligne' || mil || !type);
    const hab = () => (rnd() * 5) | 0;
    if (u.form === 'maisons') {
      // dans les maisons : quelques hommes aux portes et aux fenêtres, tout autour ; le drapeau et l'officier au milieu
      const m = clamp(Math.round(n / 25), 4, 9), r = Math.max(w, d) * 0.42;
      for (let j = 0; j < m; j++) {
        const a = (j + rnd() * 0.5) / m * TAU, rr = r * (0.75 + rnd() * 0.3);
        H(R.H, Math.cos(a) * rr, Math.sin(a) * rr, { fa: a, rang: 0, off: rnd() * 4.6, v: hab() });
      }
      H(R.DRAPEAU, 0, 0, { rang: 0 }); H(R.OFFICIER, 3 * k, 3 * k);
    } else if (u.form === 'carre') {
      // carré : deux ou trois rangs par face, tournés vers l'extérieur ; drapeau, officier et tambour au milieu
      const ranks = n > 60 ? 3 : 2, m = n - 1, slots = 4 * ranks, dv = 4.6 * k, s = Math.max(w / 2, ranks * dv + 2 * k);
      for (let j = 0; j < m; j++) {
        const slot = j % slots, face = slot % 4, r = (slot / 4) | 0, idx = (j / slots) | 0, cnt = Math.ceil((m - slot) / slots);
        const t = (idx + 0.5) / cnt * 2 - 1, e = s - r * dv, lx = e, ly = t * (e - 0.6 * k * 5), fa = face * Math.PI / 2;
        const c = Math.cos(fa), sn = Math.sin(fa);
        H(pike && idx % 5 === 2 ? R.PIQUE : R.H, lx * c - ly * sn, lx * sn + ly * c, { fa, rang: r, v: hab() });
      }
      H(R.DRAPEAU, 0, 0, { rang: 0 }); H(R.OFFICIER, 4 * k, -4 * k); H(R.TAMBOUR, -4 * k, 4 * k);
    } else if (u.form === 'tirailleurs') {
      // tirailleurs : par deux, étalés sur le front, chacun à son rythme ; l'officier derrière
      const paires = Math.ceil(n / 2), prof = Math.min(d * 0.6, 14);
      for (let j = 0; j < n; j++) {
        const p = j >> 1, oy = (paires > 1 ? p / (paires - 1) - 0.5 : 0) * w * 0.92 + (j & 1 ? 2.5 * k : 0);
        const ox = (hash(p, 3, graine(u.id ?? 0)) - 0.5) * prof - (j & 1 ? 4 * k : 0);
        H(R.H, ox, oy + (rnd() - 0.5) * 6 * k, { fa: (rnd() - 0.5) * 0.5, rang: 0, off: rnd() * 4.6, v: hab() });
      }
      H(R.OFFICIER, -prof / 2 - 2, 0);
    } else {
      // ligne (deux ou trois rangs) ou colonne ; numérotés file après file : une perte ne déplace qu'un peu chacun
      const col = u.form === 'colonne', ep = (sap ? 7 : 5.2) * k;
      let ranks, files;
      if (col) { files = clamp(Math.round(w / ep), 2, n); ranks = Math.ceil(n / files); }
      else { ranks = Math.min(n, u.rangs || (n >= 36 ? 3 : 2)); files = Math.ceil(n / ranks); }
      const dy = w / files, dv = col ? clamp(d / ranks, 5 * k, 9 * k) : Math.min(5 * k, d / ranks), front = (ranks - 1) / 2 * dv;
      for (let j = 0; j < n; j++) {
        const f = (j / ranks) | 0, r = j % ranks, centre = Math.abs(f + 0.5 - files / 2) < files * 0.1;
        H((pike && centre) || (mil && rnd() < 0.25) ? R.PIQUE : R.H, front - r * dv + (mil ? rnd() * 1.4 * k : 0), (f - (files - 1) / 2) * dy, { rang: r, v: hab() });
      }
      if (!sap) {
        // le porte-drapeau au milieu du deuxième rang (à la place d'un homme), l'officier au flanc, le tambour derrière
        const rf = Math.min(1, ranks - 1);
        let best = -1;
        for (let j = 0; j < F.length; j++) if (F[j].rang === rf && (best < 0 || Math.abs(F[j].oy) < Math.abs(F[best].oy))) best = j;
        if (best >= 0) F[best].role = R.DRAPEAU;
        const rear = front - (ranks - 1) * dv;
        H(R.OFFICIER, col ? front + 6 * k : front - 2 * k, col ? -(files + 1) / 2 * dy : (files + 1) / 2 * dy + k);
        H(R.TAMBOUR, rear - 6 * k, col ? (files + 1) / 2 * dy : -(files - 1) / 2 * dy);
        if (n > 120) H(R.OFFICIER, rear - 7 * k, (files - 1) / 4 * dy);
      }
    }
  }
  // éparpillement de la déroute (chacun pour soi, bien au-delà de l'emprise) ; la cavalerie plus loin
  const sx = (24 + d * 1.5) * (cls === 'cavalerie' ? 1.4 : 1), sy = (16 + w * 0.4) * (cls === 'cavalerie' ? 1.4 : 1);
  for (const f of F) if (f.role <= R.CAV_GEN) { f.jx = (rnd() - 0.5) * sx; f.jy = (rnd() - 0.5) * sy; }
  return F;
}

// ------------------------------------------------------------------ poses
// une pose est codée en un entier (clé du sprite) : arme 4 bits, jambes 4 (0 : immobiles, 1 à 8 : image du pas),
// geste 3 (ext), allure 4 (0, ou 1 à 8), amplitude 2 (pas, trot, galop), sabre 2, recul 2, encolure 2, lunette, monté
const BOUGE = { marche: 1, charge: 1, deroute: 1, formation: 1, ralliement: 1 };
const q8 = (ph) => 1 + (Math.floor(mod(ph, TAU) / TAU * 8) & 7);
const q7 = v => clamp(Math.round(v * 7), 0, 7);
function code(arme, legs, ext, gait, amp, sabre, recul, bob, lun, monte) {
  return arme | legs << 4 | ext << 8 | gait << 11 | amp << 15 | sabre << 17 | recul << 19 | bob << 21 | lun << 23 | monte << 24;
}
function decode(c) {
  const arme = ARMES[c & 15], legs = (c >> 4) & 15, e = (c >> 8) & 7, gait = (c >> 11) & 15, sabre = (c >> 17) & 3;
  return {
    arme, legs: legs ? (legs - 1) / 8 * TAU : null, gait: gait ? (gait - 1) / 8 * TAU : null, amp: [1.1, 1.6, 2.2][(c >> 15) & 3], sabre,
    ext: arme === 'recharge' ? e / 8 * TAU : arme === 'hache' ? e / 8 : sabre === 2 || arme === 'tambour' ? e / 7 * 2 - 1 : e / 7,
    recul: ((c >> 19) & 3) / 3 * 2.8, bob: ((c >> 21) & 3) - 1, lunette: (c >> 23) & 1, monte: (c >> 24) & 1,
  };
}
// période du feu (s) et cadence des pas (pas par seconde) selon le type et l'état (maquette, majUnite)
const periode = type => ({ artillerie: 7, mitrailleuses: 6, legere: 4.6, chasseurs: 4.6, milice: 7.5 }[type] || 6);
function cadence(st, cav) { return { marche: cav ? 2.4 : 1.7, charge: cav ? 2.9 : 2.6, deroute: cav ? 2.9 : 2.8, formation: 1.7, ralliement: cav ? 1.6 : 1.5 }[st] || 1.6; }
// place de la figure dans le repère du régiment (dans PL), en chemin vers sa nouvelle place s'il y a lieu ; vrai s'il court
const PL = [0, 0];
function place(e, f, i, t) {
  PL[0] = f.ox; PL[1] = f.oy;
  const p = e.prev && t < e.t0 + TR ? e.prev[i] : null;
  if (!p) return false;
  const m = ease(clamp((t - e.t0) / TR, 0, 1)), dx = f.ox - p[0], dy = f.oy - p[1];
  PL[0] = p[0] + dx * m; PL[1] = p[1] + dy * m;
  return dx * dx + dy * dy > 0.25;
}
// pose de la figure f (n° i) du régiment u à l'instant t : position (m), cap, et code de la pose (o, réutilisé)
function poser(u, e, f, i, t, o) {
  const k = S * e.fs, st = u.state, role = f.role, P = e.P, cav = e.cav;
  const court = place(e, f, i, t);
  let ox = PL[0], oy = PL[1], fa = f.fa;
  const pas = t * cadence(st, cav) * TAU;
  let arme = A.epaule, legs = 0, ext = 0, gait = 0, amp = 0, sabre = 0, recul = 0, bob = 1, lun = 0;
  const monte = f.monte ? 1 : 0;
  if (role >= R.PIECE || (role === R.CHEVAL && !cav)) {
    // pièces, voitures et chevaux d'attelage
    if (role === R.PIECE && (st === 'feu' || st === 'recharge')) {
      const c = mod(t + e.ph + f.i * 1.37, P);
      // (le recul est dans le sprite : la pièce glisse sur son affût)
      recul = e.mit ? (c < 1.8 ? (hash(i, (t * 9) | 0, 5) * 1.5) | 0 : 0) : c < 1.1 ? Math.round(3 * (1 - c / 1.1) ** 2) : 0;
    }
    if (BOUGE[st] && st !== 'deroute') gait = q8(pas + f.r * 2);
    else bob = 1 + Math.round(Math.sin(t * 1.1 + f.r * 20));
  } else if (role === R.SERVANT && st !== 'deroute') {
    arme = A.aucun;
    if (st === 'feu' || st === 'recharge') {
      const c = mod(t + e.ph + f.i * 1.37, P);
      if (f.job === 1) { const x = c > 2 && c < 4.4 ? Math.sin(Math.PI * (c - 2) / 2.4) : 0; ox += x * 5 * k; oy += x * 2.6 * k; arme = A.refouloir; ext = q7(x); if (x > 0.05) legs = q8(t * 9); }
      else if (f.job === 2) { if (c > 4.6 && c < 6) ox -= 1.5 * k; }
      else if (c < 0.35) ox -= 1.4 * k;
    } else if (BOUGE[st]) legs = q8(pas + f.r * 6);
  } else if (MONTURE(role)) {
    switch (st) {
      case 'marche': case 'formation': case 'ralliement': gait = q8(pas + f.r * 2); amp = st === 'marche' ? 1 : 0; break;
      case 'charge': gait = q8(pas + f.r * 3); amp = 2; ox += Math.sin(t * 2.3 + f.r * 30) * 2 * k; oy += Math.sin(t * 1.3 + f.r * 11) * 0.8 * k; sabre = 1; break;
      case 'melee': {
        const s = Math.sin(t * (1.5 + f.r) + f.r * 40);
        ox += (4 + s * 5) * k; oy += Math.cos(t * (1.1 + f.r * 0.7) + f.r * 9) * 5 * k; fa += Math.sin(t * 0.9 + f.r * 7) * 0.9;
        gait = q8(t * 12 + f.r * 7); amp = 1; sabre = 2; ext = q7((Math.sin(t * 7 + f.r * 9) + 1) / 2); break;
      }
      case 'deroute': fa = Math.PI + (f.r - 0.5) + Math.sin(t * 1.5 + f.r * 9) * 0.2; gait = q8(pas + f.r * 6); amp = 2; break;
      default: bob = 1 + Math.round(Math.sin(t * 1.1 + f.r * 20)); ox += Math.sin(t * 0.4 + f.r * 9) * 0.4 * k; if (role === R.CAV_GEN) lun = mod(t + f.r * 5, 7) < 3.5 ? 1 : 0;
    }
  } else {
    switch (st) {
      case 'repos': arme = u.type === 'sapeurs' ? A.hache0 : A.sol; ox += Math.sin(t * 0.7 + f.r * 9) * 0.25 * k; break;
      case 'marche': case 'formation': legs = q8(pas + f.r * 0.6); break;
      case 'ralliement': if (e.spread > 0.02) legs = q8(pas + f.r * 6); else arme = A.sol; break;
      case 'charge': legs = q8(pas + f.r * 6); arme = A.baio; ox += Math.sin(t * 5 + f.r * 30) * 1.2 * k; oy += Math.sin(t * 3.1 + f.r * 17) * 0.6 * k; break;
      case 'feu': case 'recharge': {
        // au feu, les deux premiers rangs (le premier en carré, tous en tirailleurs) : épaule, joue, feu et recul, puis
        // la baguette ; en « recharge », tous à la baguette
        if (role !== R.H || (u.form !== 'tirailleurs' && f.rang >= (u.form === 'carre' ? 1 : 2))) { arme = role === R.H ? A.epaule : A.sol; break; }
        const c = st === 'recharge' ? 1.6 + mod(t + f.dl * 9, P - 2.3) : mod(t + e.ph + f.dl + f.off, P);
        if (c < 0.45) arme = A.epaule;
        else if (c < 1.3) arme = A.joue;
        else if (c < 1.6) { arme = A.joue; ox -= (1.6 - c) * 1.6 * k; }
        else if (c < P - 0.7) { arme = A.recharge; ext = Math.floor(mod(c * 9, TAU) / TAU * 8) & 7; }
        if (u.form === 'tirailleurs') ox += Math.sin(t * 0.3 + f.r * 20) * 3 * k;
        break;
      }
      case 'melee': {
        const s = Math.sin(t * (3 + f.r * 3) + f.r * 40);
        ox += (3 + s * 1.6 - (f.rang ? 1 : 0)) * k; oy += Math.sin(t * 1.7 + f.r * 13) * 1.6 * k;
        fa += (f.r - 0.5) * 0.9 + Math.sin(t * 2 + f.r * 7) * 0.3; arme = A.baio; ext = q7(Math.max(0, s)); if (s > 0.3) legs = q8(t * 8); break;
      }
      case 'deroute': fa = Math.PI + (f.r - 0.5) * 1.2 + Math.sin(t * 2 + f.r * 9) * 0.25; legs = q8(pas * 1.2 + f.r * 6); arme = f.r < 0.5 ? A.aucun : A.epaule; break;
    }
    if (role === R.PIQUE && arme !== A.aucun) arme = st === 'charge' || st === 'melee' ? A.pique : A.piqueH;
    if (role === R.DRAPEAU) arme = A.aucun;
    if (role === R.OFFICIER) arme = st === 'charge' || st === 'melee' ? A['epee+'] : A.epee;
    if (role === R.TAMBOUR) { arme = A.tambour; ext = q7((Math.sin(f.r * 9 + t * 11) + 1) / 2); }
  }
  // déroute et ralliement : chacun pour soi, loin de sa place, puis il y revient
  if (e.spread > 0 && TOMBE(role)) { ox += f.jx * e.spread; oy += f.jy * e.spread; }
  if (court && !legs && PIETON(role)) legs = q8(t * 9 + f.r * 6);
  if (court && !gait && MONTURE(role)) { gait = q8(t * 12 + f.r * 6); amp = 1; }
  const c = Math.cos(u.dir || 0), s = Math.sin(u.dir || 0);
  o.x = u.x + ox * c - oy * s; o.y = u.y + ox * s + oy * c; o.a = (u.dir || 0) + fa;
  o.code = code(arme, legs, ext, gait, amp, sabre, recul, bob, lun, monte);
  return o;
}

// ------------------------------------------------------------------ dessin des figures (maquette)
function fusil(g, x1, y1, x2, y2, baio) {
  const xm = x1 + (x2 - x1) * 0.6, ym = y1 + (y2 - y1) * 0.6;
  T(g, '#6b4d31', 0.62, x1, y1, xm, ym); T(g, '#8d9196', 0.4, xm, ym, x2, y2);
  if (baio) { const d = Math.hypot(x2 - x1, y2 - y1); T(g, '#e2e6e9', 0.28, x2, y2, x2 + (x2 - x1) / d * 2.2, y2 + (y2 - y1) / d * 2.2); }
}
function bras(g, c, x1, y1, x2, y2) { T(g, c, 1.1, x1, y1, x2, y2); }
function tete(g, L, kind, chef) {
  switch (kind) {
    case 'shako': C(g, '#1c1b1d', 0.2, 0, 1.18); E(g, '#0f0f10', 1.2, 0, 0.45, 1); C(g, chef ? '#e3c04f' : L.pompon, 0.55, 0, 0.42); if (L.plume) E(g, L.plume, 0.2, -0.1, 1.1, 0.32, -0.3); break;
    case 'ourson': C(g, '#231a14', 0, 0, 1.65); for (let k = 0; k < 7; k++) C(g, '#2e231a', Math.cos(k * 0.9) * 1.3, Math.sin(k * 0.9) * 1.3, 0.55); C(g, L.plume || '#c8322b', -0.5, -1.3, 0.5); break;
    case 'bicorne': C(g, PEAU, 0.6, 0, 0.7); E(g, '#1a1817', 0.05, 0, 0.95, 2.35); E(g, L.plume || '#2a2725', -0.15, 0, 0.55, 1.8); C(g, '#2b4ea0', 0.7, -1.2, 0.38); C(g, '#f4f1ea', 0.7, -1.2, 0.22); break;
    case 'tricorne': PG(g, '#1c1a18', [1.75, 0, -1.25, -1.8, -1.25, 1.8]); C(g, '#2a2622', 0.05, 0, 0.8); T(g, chef ? '#e3c04f' : '#e8e0c8', 0.18, 1.6, 0, -1.1, -1.6); T(g, chef ? '#e3c04f' : '#e8e0c8', 0.18, 1.6, 0, -1.1, 1.6); break;
    case 'casque': C(g, '#c9a34a', 0.1, 0, 1.15); T(g, '#151311', 0.75, 0.6, 0, -2.8, 0); C(g, '#a07f34', 0.95, 0, 0.35); break;
    case 'kepi': C(g, L.kepi, 0, 0, 1); g.strokeStyle = sombre(L.habit, 0.2); g.lineWidth = 0.35; g.beginPath(); g.arc(0, 0, 0.95, 0, TAU); g.stroke(); E(g, '#151515', 1.05, 0, 0.4, 0.8); break;
    case 'beret': C(g, '#b32a26', 0, 0, 1.5); C(g, '#7e1a17', 0, 0, 0.25); break;
    case 'rond': C(g, '#4a3a28', 0, 0, 1.8); C(g, '#3a2b1c', 0, 0, 1.05); break;
    case 'colback': C(g, '#2a2018', 0, 0, 1.35); E(g, '#b8352c', -1.1, 0.6, 0.9, 0.4); break;
  }
}
function fantassin(g, L, role, v, p) {
  const hab = L.habits ? L.habits[v % L.habits.length] : L.habit, chef = role === R.OFFICIER || role === R.DRAPEAU;
  if (p.legs != null) {
    const o = Math.sin(p.legs) * 1.4;
    E(g, L.culotte, o + 0.2, -0.95, 1.15, 0.55); E(g, L.culotte, -o + 0.2, 0.95, 1.15, 0.55);
    C(g, '#1d1a17', o + 1.2, -0.95, 0.45); C(g, '#1d1a17', -o + 1.2, 0.95, 0.45);
  }
  if (L.sacOn && role !== R.OFFICIER && role !== R.SERVANT) { RR(g, L.sac, -2.4, -1.45, 1.5, 2.9, 0.5); RR(g, L.couv, -2.75, -1.35, 0.7, 2.7, 0.35); }
  if (role === R.TAMBOUR) { C(g, '#f2efe6', 0.6, -2.6, 1.3); g.strokeStyle = hab; g.lineWidth = 0.35; g.beginPath(); g.arc(0.6, -2.6, 1.3, 0, TAU); g.stroke(); }
  RR(g, hab, -1.35, -2.15, 2.7, 4.3, 1.2);
  if (L.revers) RR(g, L.revers, 0.55, -0.75, 0.7, 1.5, 0.3);
  if (L.ceinture) RR(g, L.ceinture, -0.2, -2.1, 0.7, 4.2, 0.3);
  if (L.buff && role !== R.OFFICIER) { g.strokeStyle = L.buff; g.lineWidth = 0.42; g.beginPath(); g.moveTo(-1.05, -1.75); g.lineTo(0.9, 1.7); g.moveTo(-1.05, 1.75); g.lineTo(0.9, -1.7); g.stroke(); }
  if (L.tablier) RR(g, L.tablier, 0.55, -1.35, 1, 2.7, 0.3);
  const ep = chef ? '#e3c04f' : L.epaul;
  if (ep) { C(g, ep, -0.1, -2, 0.62); C(g, ep, -0.1, 2, 0.62); }
  switch (p.arme) {
    case 'joue': fusil(g, 0.4, 1.2, 7.4, 0.55, false); bras(g, hab, -0.2, 1.9, 0.6, 1.25); bras(g, hab, 0, -1.9, 3.2, 0.6); C(g, PEAU, 3.3, 0.62, 0.45); break;
    case 'baio': { const e = p.ext * 2.2; fusil(g, -0.6 + e, 1.5, 6.2 + e, 0.9, true); bras(g, hab, -0.2, 1.9, 0.2 + e * 0.5, 1.5); bras(g, hab, 0, -1.9, 2.8 + e * 0.6, 1.1); break; }
    case 'epaule': fusil(g, 1, 2.05, -3, 2.45, true); bras(g, hab, -0.2, 1.9, 0.9, 2.1); break;
    case 'recharge': { const r = Math.sin(p.ext) * 1.1 + 1.1; fusil(g, 1.6, 0.9, 3.4, 1.4, false); T(g, '#cfd3d6', 0.25, 3.4, 1.4, 3.4 + r * 0.6, 1.4 + r * 0.25); bras(g, hab, -0.1, 1.9, 1.7, 1); bras(g, hab, 0, -1.9, 2.8 + r * 0.4, 1.3); break; }
    case 'sol': fusil(g, 0.4, 2.3, 1.7, 2.7, true); break;
    case 'hache0': T(g, '#6b4d31', 0.5, 0.2, 2.2, -2.5, 2.8); RR(g, '#9aa0a5', -3.3, 2.4, 1.2, 1.3, 0.3); break;
    case 'hache': {
      const k = p.ext < 0.55 ? -1.6 + p.ext / 0.55 * 2.7 : 1.1 - (p.ext - 0.55) / 0.45 * 2.7, ax = 0.4 + Math.cos(k * 0.55) * 4.6, ay = 1.4 + Math.sin(k * 0.55) * 4.6 - 1.6;
      bras(g, hab, -0.2, 1.9, 0.6 + (ax - 0.4) * 0.3, 1.2); bras(g, hab, 0, -1.9, 0.8 + (ax - 0.4) * 0.3, 0.4);
      T(g, '#6b4d31', 0.5, 0.6, 1, ax, ay); RR(g, '#9aa0a5', ax - 0.5, ay - 0.9, 1.3, 1.8, 0.3); break;
    }
    case 'pique': T(g, '#7a5b3a', 0.45, -0.5, 1.4, 8.5, 1); T(g, '#9aa0a5', 0.25, 8.5, 0.6, 9.7, 0.6); T(g, '#9aa0a5', 0.25, 8.5, 1.4, 9.7, 1.4); bras(g, hab, 0, 1.9, 1, 1.4); break;
    case 'piqueH': T(g, '#7a5b3a', 0.45, 1, 2.2, -4, 2.6); break;
    case 'refouloir': T(g, '#7a5b3a', 0.45, -3, 1.2, 4 + p.ext * 2, 0.4); C(g, '#2a2a2a', 4 + p.ext * 2, 0.4, 0.55); bras(g, hab, 0, 1.9, 1.2, 1); break;
    case 'epee': T(g, '#dfe3e6', 0.3, 0.4, 2.1, -2.4, 2.9); break;
    case 'epee+': bras(g, hab, -0.1, 1.9, 1.6, 2.2); T(g, '#dfe3e6', 0.3, 1.6, 2.2, 6, 1.4); break;
    case 'tambour': { const b = p.ext; T(g, '#d9c49a', 0.25, 0.3, -1.6, 1 + b * 0.4, -2.4); T(g, '#d9c49a', 0.25, 0.3, -0.6, 1 - b * 0.4, -2.2); break; }
  }
  if (role === R.DRAPEAU) { C(g, '#5b4127', 1.2, 1.6, 0.5); C(g, '#d9b44a', 1.2, 1.6, 0.32); }
  tete(g, L, chef ? L.teteOff : L.tete, chef);
}
function cheval(g, c, p) {
  const mov = p.gait != null, st = mov ? Math.sin(p.gait) : 0, jambe = sombre(c, 0.35), a = p.amp;
  if (mov) { E(g, jambe, 3.2 + st * a, -1.65, 1.3, 0.45); E(g, jambe, 3.2 - st * a, 1.65, 1.3, 0.45); E(g, jambe, -3.4 - st * a, -1.6, 1.3, 0.45); E(g, jambe, -3.4 + st * a, 1.6, 1.3, 0.45); }
  g.lineCap = 'round'; T(g, sombre(c, 0.5), 1.1, -5.1, 0, -7.6, mov ? st * 0.9 : p.bob * 0.4);
  E(g, c, 0, 0, 5.3, 2.05);
  g.globalAlpha = 0.22; E(g, '#ffffff', -0.8, -0.55, 3.2, 0.6); g.globalAlpha = 1;
  const hb = (mov ? Math.cos(p.gait * 2) * 0.45 * a / 1.6 : 0) + p.bob * 0.5;
  E(g, c, 5.2 + hb * 0.5, 0, 2.4, 1.05); E(g, sombre(c, 0.12), 7.3 + hb, 0, 1.35, 0.78);
  T(g, sombre(c, 0.55), 0.6, 3.4, 0, 6.3 + hb * 0.5, 0);
  C(g, sombre(c, 0.4), 6.7 + hb, -0.55, 0.26); C(g, sombre(c, 0.4), 6.7 + hb, 0.55, 0.26);
}
function cavalier(g, L, role, p, postillon) {
  const chef = role === R.CAV_GEN || role === R.CAV_OFF;
  if (!postillon) { RR(g, L.chabraque, -3.4, -2.5, 4.6, 5, 1); g.strokeStyle = L.galon; g.lineWidth = 0.35; g.beginPath(); if (g.roundRect) g.roundRect(-3.1, -2.2, 4, 4.4, 0.8); else g.rect(-3.1, -2.2, 4, 4.4); g.stroke(); }
  E(g, '#1b1816', 0.2, -2.15, 1.25, 0.55); E(g, '#1b1816', 0.2, 2.15, 1.25, 0.55);
  E(g, L.habit, -0.4, 0, 1.45, 2.05);
  if (L.revers && !postillon) RR(g, L.revers, 0.4, -0.6, 0.55, 1.2, 0.25);
  const ep = chef ? '#e3c04f' : (L.epaul || L.habit);
  C(g, ep, -0.5, -1.8, 0.5); C(g, ep, -0.5, 1.8, 0.5);
  if (p.sabre) {
    const sa = p.sabre === 2 ? p.ext * 1.3 : -0.2;
    bras(g, L.habit, -0.3, 1.7, 1.4, 2.3); T(g, '#e3e7ea', 0.32, 1.4, 2.3, 1.4 + Math.cos(sa) * 6, 2.3 + Math.sin(sa) * 6);
  } else { bras(g, L.habit, -0.2, 1.6, 1.4, 0.8); bras(g, L.habit, -0.2, -1.6, 1.4, -0.8); }
  if (p.lunette) T(g, '#c9a34a', 0.55, 0.8, -0.7, 3.8, -0.5);
  tete(g, L, L.tete, chef);
}
function piece(g, L, p) {
  const x = -p.recul;
  PG(g, sombre(L.affut, 0.12), [x - 1, -1.3, x - 11.5, -0.75, x - 11.5, 0.75, x - 1, 1.3]);
  RR(g, '#3a2a1b', x - 2.3, -3.6, 4.6, 1.05, 0.4); RR(g, '#3a2a1b', x - 2.3, 2.55, 4.6, 1.05, 0.4);
  T(g, '#2b2b2b', 0.7, x, -3, x, 3);
  RR(g, L.affut, x - 3.2, -1.55, 4.4, 3.1, 0.6);
  if (L.mit) {
    RR(g, '#2c2f33', x - 2.6, -1.25, 7.4, 2.5, 0.6);
    for (let i = -0.8; i <= 0.8; i += 0.4) T(g, '#4a4e53', 0.14, x - 1.6, i, x + 4.6, i);
    T(g, '#8d9196', 0.4, x - 2.6, 1.3, x - 3.6, 2.1);
  } else {
    RR(g, L.fut, x - 2.6, -0.78, 9, 1.56, 0.75); C(g, sombre(L.fut, 0.25), x + 6.2, 0, 0.86);
    g.globalAlpha = 0.35; T(g, '#ffffff', 0.3, x - 1.8, -0.35, x + 5.5, -0.35); g.globalAlpha = 1;
  }
  RR(g, sombre(L.affut, 0.2), x - 9.5, -0.9, 2.4, 1.8, 0.3);
}
function avant(g, L) {
  RR(g, '#3a2a1b', -2.2, -3.7, 4.4, 1, 0.4); RR(g, '#3a2a1b', -2.2, 2.7, 4.4, 1, 0.4);
  RR(g, L.affut, -2.6, -2.3, 5.2, 4.6, 0.6); T(g, sombre(L.affut, 0.3), 0.3, -2.2, 0, 2.2, 0);
  T(g, '#5b4127', 0.5, 2.6, 0, 9, 0);
}
function caisson(g, L) {
  for (const [x, y] of [[-6, -3.9], [-6, 2.9], [5, -3.9], [5, 2.9]]) RR(g, '#3a2a1b', x - 2.2, y, 4.4, 1, 0.4);
  T(g, '#5b4127', 0.6, 8, 0, 15, 0);
  RR(g, L.caisse, -8.5, -3.2, 17, 6.4, 1);
  RR(g, L.bache, -8, -3.7, 14, 7.4, 2.8);
  g.globalAlpha = 0.16; RR(g, '#000000', -8, 0.2, 14, 3.5, 2); g.globalAlpha = 1;
  for (let i = 0; i < 5; i++) T(g, sombre(L.bache, 0.14), 0.4, -6 + i * 2.8, -3.5, -6 + i * 2.8, 3.5);
}
// drapeau (et fanion, petit) en (x, y), flottant au vent ; étoffe blanche à la croix aux couleurs du camp
function drapeau(g, L, x, y, t, r, petit) {
  const n = 8, long = petit ? 6.5 : 11, larg = petit ? 4 : 7, wa = -0.4 + Math.sin(t * 0.5 + r) * 0.1;
  const ca = Math.cos(wa), sa = Math.sin(wa), nx = -sa, ny = ca;
  const bord = (s, o) => { const w = Math.sin(t * 6 - s * 5 + r * 9) * 1.1 * s; return [x + ca * long * s + nx * (o + w), y + sa * long * s + ny * (o + w)]; };
  const bande = (s0, s1, o0, o1, c) => {
    g.fillStyle = c; g.beginPath();
    for (let i = 0; i <= n; i++) { const p = bord(s0 + (s1 - s0) * i / n, o0); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
    for (let i = n; i >= 0; i--) { const p = bord(s0 + (s1 - s0) * i / n, o1); g.lineTo(p[0], p[1]); }
    g.closePath(); g.fill();
  };
  g.save(); g.translate(1.8, 2.4); bande(0, 1, -larg / 2, larg / 2, 'rgba(20,20,10,.22)'); g.restore();
  bande(0, 1, -larg / 2, larg / 2, '#f4f1ea'); bande(0, 1, -0.8, 0.8, L.drap); bande(0.42, 0.58, -larg / 2, larg / 2, L.drap);
  C(g, '#3b2a1a', x, y, 0.55); C(g, '#d9b44a', x, y, 0.35);
}
// une figure dans son repère (u) : g est déjà posé
function peindre(g, L, role, v, p) {
  g.lineCap = 'round';
  switch (role) {
    case R.CAV: case R.CAV_OFF: case R.CAV_GEN: cheval(g, L.chevaux[v % L.chevaux.length], p); cavalier(g, L, role, p, false); break;
    case R.CHEVAL: cheval(g, L.chevaux[v % L.chevaux.length], p); if (p.monte) cavalier(g, L, role, p, true); break;
    case R.PIECE: piece(g, L, p); break;
    case R.AVANT: avant(g, L); break;
    case R.CAISSON: caisson(g, L); break;
    default: fantassin(g, L, role, v, p);
  }
}

// ------------------------------------------------------------------ le calque des troupes
// tailles des sprites : paliers de 15 % en pixels par unité ; caps : 64 sens, chaque sprite est peint déjà tourné (il
// est posé sans rotation ni, pour les petites figures, mise à l'échelle : c'est le plus rapide à poser)
const NIV0 = 12, PAS = Math.log(1.15), NA = 64;
const O = { x: 0, y: 0, a: 0, code: 0 };
const VOISINS = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1], [0, -2], [0, 2]];  // (pose de la figure en cours : réutilisée, pas d'objet par figure)

export class Troupes2D {
  // q : profil de qualité (qualite.js : troupes, sprites, ombres) ; year : année de la bataille (coiffures, culottes)
  constructor(q, year) {
    this.q = q || {}; this.year = year || 1800;
    this.cache = new Map();     // clé numérique → {cv, x, y, w, h, last}
    this.bytes = 0;
    this.looks = new Map();     // « couleur|type » → n° de tenue
    this.L = [];
    this.lays = new Map();      // id → disposition du régiment et son état
    this.frame = 0; this.t = 0; this.per = 1; this.fs = 1; this.builds = 0;
    this.buf = new Float64Array(4 * 1024);   // x, y, a, clé de chaque figure visible
  }
  setQuality(q) { this.q = q || {}; this.trim(true); }
  dispose() { for (const s of this.cache.values()) s.cv.width = s.cv.height = 0; this.cache.clear(); this.bytes = 0; this.lays.clear(); }
  look(color, type) {
    const key = color + '|' + type;
    let i = this.looks.get(key);
    // shortcut: 64 tenues au plus (clé des sprites) ; au-delà elles se partagent la dernière, à revoir s'il y a plus de 4 camps
    if (i === undefined) { i = Math.min(this.L.length, 63); this.L[i] = tenue(color, type, this.year); this.looks.set(key, i); }
    return i;
  }
  // disposition du régiment à jour (nouvelle formation, pertes, budget) ; les hommes courent de l'ancienne à la nouvelle
  entree(u, t) {
    const id = String(u.id), cls = clsOf(u), [w0, d0] = emprise(u);
    const key = `${u.form}|${Math.round((u.men || 0) / this.per)}|${(u.w || w0) | 0}|${(u.d || d0) | 0}|${u.type}|${this.per}|${u.rempart ? 1 : 0}|${u.pieces ?? ''}`;
    let e = this.lays.get(id);
    if (!e || e.key !== key) {
      const old = e, figs = disposition(u, this.per, this.fs);
      e = { key, figs, fs: this.fs, per: this.per, cav: cls === 'cavalerie' || isGeneral(u), mit: u.type === 'mitrailleuses', P: periode(u.type), ph: hash(graine(id), 7, 3) * 6,
        st: old?.st ?? u.state, stT: old?.stT ?? -99, prevSt: old?.prevSt, spread: 0, lost: (old?.lost ?? 0) * (old?.per ?? 1) / this.per, prev: null, t0: t, seen: this.frame };
      // (là où chacun est à cet instant, pour courir vers sa nouvelle place ; un autre budget ne fait courir personne)
      if (old && old.per === this.per) e.prev = old.figs.map((f, i) => { place(old, f, i, t); return [PL[0], PL[1]]; });
      this.lays.set(id, e);
    }
    if (e.st !== u.state) { e.prevSt = e.st; e.st = u.state; e.stT = t; }
    const dt = t - e.stT;
    e.spread = u.state === 'deroute' ? clamp(dt / 4, 0, 1) : u.state === 'ralliement' && e.prevSt === 'deroute' ? clamp(1 - dt / 4, 0, 1) : 0;
    e.seen = this.frame;
    u._figScale = e.fs;   // (effets.js : poussière et fumée à l'échelle de ses figures)
    return e;
  }
  // budget : hommes par figure pour tous les régiments de la bataille
  budget(list) {
    let men = 0;
    for (const u of list) men += Math.min(u.men || 0, capOf(u));
    this.per = hommesParFigure(men, this.q.troupes ?? 10000);
    this.fs = clamp(Math.sqrt(this.per), 1, 1.4);
  }
  // figures du régiment à l'instant t, dans le monde : [{x, y, a, role, rang}] (tests, kill, muzzles)
  figures(u, t = this.t) {
    const e = this.entree(u, t);
    return e.figs.map((f, i) => { poser(u, e, f, i, t, O); return { x: O.x, y: O.y, a: O.a, role: f.role, rang: f.rang }; });
  }
  // bouches à feu : [[x, y, cap], …] des fusils des rangs qui tirent, des pièces (vue.js les passe aux effets : _muzzles)
  muzzles(u, time = this.t) {
    const e = this.entree(u, time), out = [], k = S * e.fs, carre = u.form === 'carre', tir = u.form === 'tirailleurs';
    e.figs.forEach((f, i) => {
      let fx, fy;
      if (f.role === R.PIECE) { if (u.form === 'attelee') return; fx = (e.mit ? 5 : 7) * k; fy = 0; }
      else if (f.role === R.H && (tir || f.rang < (carre ? 1 : 2))) { fx = 7.6 * k; fy = 0.55 * k; }
      else return;
      poser(u, e, f, i, time, O);
      const c = Math.cos(O.a), s = Math.sin(O.a);
      out.push([O.x + c * fx - s * fy, O.y + s * fx + c * fy, O.a]);
    });
    return out;
  }
  // le régiment perd n hommes : autant de figures tombent (un boulet, ball = [[u, v], [u, v]] sa trajectoire dans le
  // repère du régiment, u vers la droite, v vers l'avant, couche au plus BALL hommes de la file traversée ; les autres,
  // surtout au premier rang). bare(x, y) : sol où un corps peut reposer ; color : couleur du camp. Renvoie les tués à
  // peindre au sol (Sol2D.stamp) : {k: 'mort' | 'cheval', x, y, a, c} ; un cavalier : son cheval et lui à côté
  kill(u, n, bare, color, ball = null) {
    const e = this.entree(u, this.t), cand = [];
    e.figs.forEach((f, i) => { if (TOMBE(f.role)) cand.push(i); });
    if (!cand.length || !(n > 0)) return [];
    e.lost += n / Math.max(e.per, (u.men || 0) / cand.length);
    const m = Math.min(Math.floor(e.lost), cand.length);
    if (m < 1) return [];
    e.lost -= m;
    const seed = graine(u.id ?? 0) + (e.kills = (e.kills || 0) + 1) * 131, pris = new Set();
    if (ball) {
      // (distance de chaque homme à la trajectoire, dans le repère u, v : u = oy, v = ox)
      const [[u1, v1], [u2, v2]] = ball, lx = u2 - u1, ly = v2 - v1, l2 = lx * lx + ly * ly || 1;
      const dist = i => { const f = e.figs[i], t = clamp(((f.oy - u1) * lx + (f.ox - v1) * ly) / l2, 0, 1); return Math.hypot(f.oy - u1 - lx * t, f.ox - v1 - ly * t); };
      cand.map(i => [dist(i), i]).sort((a, b) => a[0] - b[0]).slice(0, Math.min(m, BALL)).forEach(([dd, i]) => { if (dd < 4) pris.add(i); });
    }
    // sous la mousqueterie : au hasard, le premier rang d'abord
    const reste = cand.filter(i => !pris.has(i)).map(i => [hash(i, seed, 11) + Math.max(0, e.figs[i].rang) * 0.35, i]).sort((a, b) => a[0] - b[0]);
    for (const [, i] of reste) { if (pris.size >= m) break; pris.add(i); }
    const out = [], c = Math.cos(u.dir || 0), s = Math.sin(u.dir || 0);
    for (const i of pris) {
      const f = e.figs[i], ox = f.ox + f.jx * e.spread, oy = f.oy + f.jy * e.spread;
      const x = u.x + ox * c - oy * s, y = u.y + ox * s + oy * c, a = (u.dir || 0) + f.fa + (e.spread ? Math.PI : 0) + (hash(i, seed, 23) - 0.5) * 1.2;
      if (bare && !bare(x, y)) continue;
      if (MONTURE(f.role)) {
        out.push({ k: 'cheval', x, y, a, c: color });
        const rx = x - s * 1.2, ry = y + c * 1.2;
        if (!bare || bare(rx, ry)) out.push({ k: 'mort', x: rx, y: ry, a: (u.dir || 0) + (hash(i, seed, 37) - 0.5) * 2, c: color });
      } else out.push({ k: 'mort', x, y, a, c: color });
    }
    return out;
  }

  // ---------------------------------------------------------------- dessin
  // le sprite d'une figure (tenue, rôle, variante, pose, palier de taille, sens) ; null si le budget de l'image est épuisé
  sprite(look, role, v, c, b, ai) {
    const key = ((((c * 16 + role) * 8 + (v & 7)) * 64 + look) * 64 + b) * NA + ai;
    let s = this.cache.get(key);
    if (s) { s.last = this.frame; return s; }
    // (trop de sprites à peindre dans cette image : un sens ou un palier voisin déjà peint fait l'affaire)
    if (this.builds >= 48) {
      for (const [db, da] of VOISINS) {
        if (b + db < 0 || b + db > 63) continue;
        s = this.cache.get(key + db * NA - ai + ((ai + da + NA) % NA));
        if (s) { s.last = this.frame; return s; }
      }
      if (this.builds >= 160) return null;
    }
    this.builds++;
    // (la boîte de la figure tournée à son sens : la taille du canevas)
    const res = Math.pow(1.15, b - NIV0), [x0, y0, x1, y1] = BOITE[role], an = ai / NA * TAU, ca = Math.cos(an), sa = Math.sin(an);
    let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const X = x * ca - y * sa, Y = x * sa + y * ca;
      mx = Math.min(mx, X); my = Math.min(my, Y); Mx = Math.max(Mx, X); My = Math.max(My, Y);
    }
    const cv = canvas((Mx - mx) * res + 2, (My - my) * res + 2), g = cv.getContext('2d');
    g.setTransform(res * ca, res * sa, -res * sa, res * ca, 1 - mx * res, 1 - my * res);
    peindre(g, this.L[look], role, v, decode(c));
    s = { cv, ox: mx * res - 1, oy: my * res - 1, res, last: this.frame };
    this.cache.set(key, s); this.bytes += cv.width * cv.height * 4;
    return s;
  }
  // cache borné par la qualité : on oublie les sprites pas servis depuis le plus longtemps
  trim(force = false) {
    const max = this.q.sprites ?? 24e6;
    if (!force && this.bytes <= max && this.cache.size <= 6000) return;
    const all = [...this.cache.entries()].sort((a, b) => a[1].last - b[1].last);
    for (const [k, s] of all) {
      if (this.bytes <= max * 0.7 && this.cache.size <= 4500) break;
      if (s.last >= this.frame - 1 && !force) break;
      this.bytes -= s.cv.width * s.cv.height * 4; s.cv.width = s.cv.height = 0; this.cache.delete(k);
    }
  }
  // view : SPEC-2D § 2 ; units : régiments de vue.js ; colors[side] : couleur du camp ; time : s
  draw(ctx, view, units, colors, time) {
    this.frame++; this.t = time; this.builds = 0;
    const list = [];
    for (const u of units) if (u && u.state !== 'hors' && (u.men || 0) > 0) list.push(u);
    this.budget(list);
    view.monde(ctx);
    const m = ctx.getTransform(), A = m.a, ex = m.e, ey = m.f, cv = ctx.canvas;
    // (l'écran en mètres, avec une marge d'une figure)
    const X0 = (-ex) / A - 4, Y0 = (-ey) / A - 4, X1 = ((cv?.width ?? 1e9) - ex) / A + 4, Y1 = ((cv?.height ?? 1e9) - ey) / A + 4;
    const kpx = A * S * this.fs, bloc = view.z * S * this.fs * 5 < 2;
    const b = clamp(Math.round(Math.log(kpx) / PAS) + NIV0, 0, 63), ombres = (this.q.ombres ?? 2) >= 2 && !bloc && view.z * S * this.fs * 5 >= 4;
    // 1. poses de toutes les figures visibles (dans buf), régiment par régiment
    const vis = [];
    let n = 0;
    for (const u of list) {
      const e0 = this.lays.get(String(u.id)), r = Math.hypot(u.w || 30, u.d || 30) / 2 + (u.state === 'deroute' || e0?.spread ? 60 : 12);
      if (!view.visible(u.x, u.y, r)) continue;
      const e = this.entree(u, time), look = this.look(hex6(colors?.[u.side]), u.type), n0 = n;
      if (this.buf.length < (n + e.figs.length) * 4) { const nb = new Float64Array(Math.max(this.buf.length * 2, (n + e.figs.length) * 4)); nb.set(this.buf); this.buf = nb; }
      const B = this.buf;
      for (let i = 0; i < e.figs.length; i++) {
        const f = e.figs[i];
        poser(u, e, f, i, time, O);
        if (O.x < X0 || O.x > X1 || O.y < Y0 || O.y > Y1) continue;
        B[n * 4] = O.x; B[n * 4 + 1] = O.y; B[n * 4 + 2] = O.a; B[n * 4 + 3] = O.code * 16 + f.role + (f.v & 7) * 1e9;
        n++;
      }
      if (n > n0) vis.push([u, e, look, n0, n]);
    }
    const B = this.buf;
    if (bloc) {
      // 2'. de loin : chaque figure, un carré plein aux couleurs du camp ; ensemble, la forme de la formation
      const sz = Math.max(0.9 * this.fs, 1.6 / A * (view.dpr || 1));
      for (const [u, , , a, z] of vis) {
        ctx.globalAlpha = u._fade ?? 1; ctx.fillStyle = hex6(colors?.[u.side]); ctx.beginPath();
        for (let j = a; j < z; j++) ctx.rect(B[j * 4] - sz / 2, B[j * 4 + 1] - sz / 2, sz, sz);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.menage();
      return;
    }
    // 2. les ombres, d'un seul tracé (vers le sud-est, comme toute la lumière du nord-ouest). Petites figures : des
    // carrés (un homme ; trois le long d'un cheval ou d'une voiture), car des milliers d'ellipses coûtent dix fois plus
    // cher à remplir ; grandes (peu à l'écran) : les ellipses de la maquette
    if (ombres) {
      const k = S * this.fs, dx = 1.3 * k, dy = 1.7 * k, rond = kpx * 5 >= 30;
      ctx.fillStyle = 'rgba(30,26,10,.28)'; ctx.beginPath();
      for (const [u, , , a, z] of vis) {
        if (u._ghost) continue;
        for (let j = a; j < z; j++) {
          const role = (B[j * 4 + 3] % 1e9) % 16, o = OMB[role], x = B[j * 4] + dx, y = B[j * 4 + 1] + dy, an = B[j * 4 + 2];
          if (rond) { ctx.moveTo(x + o[0] * k, y); ctx.ellipse(x, y, o[0] * k, o[1] * k, an, 0, TAU); continue; }
          const h = o[1] * k * 0.85;
          if (role <= R.SERVANT) { ctx.rect(x - h, y - h, 2 * h, 2 * h); continue; }
          const ca = Math.cos(an) * o[0] * k * 0.6, sa = Math.sin(an) * o[0] * k * 0.6;
          for (let q = -1; q <= 1; q++) ctx.rect(x + ca * q - h, y + sa * q - h, 2 * h, 2 * h);
        }
      }
      ctx.fill();
    }
    // 3. les figures : un sprite chacune, déjà tourné à son cap ; posé au pixel près tant que les figures sont petites
    // (moins de 40 px : l'écart au palier ne se voit pas), à l'échelle exacte au-delà
    const flags = [], net = kpx * 5 < 40;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const [u, e, look, a, z] of vis) {
      ctx.globalAlpha = u._fade ?? 1;
      const K = A * S * e.fs;
      for (let j = a; j < z; j++) {
        const key = B[j * 4 + 3], v = Math.floor(key / 1e9), rc = key - v * 1e9, role = rc % 16, c = (rc - role) / 16;
        const s = this.sprite(look, role, v, c, b, Math.round(mod(B[j * 4 + 2], TAU) / TAU * NA) % NA);
        if (!s) continue;
        const px = A * B[j * 4] + ex, py = A * B[j * 4 + 1] + ey;
        if (net) ctx.drawImage(s.cv, Math.round(px + s.ox), Math.round(py + s.oy));
        else { const k = K / s.res; ctx.drawImage(s.cv, px + s.ox * k, py + s.oy * k, s.cv.width * k, s.cv.height * k); }
      }
      // drapeaux et fanions, au-dessus des figures
      if (K * 4 > 3) e.figs.forEach((f, i) => { if (f.role === R.DRAPEAU || f.fanion) flags.push([u, e, look, f, i]); });
    }
    for (const [u, e, look, f, i] of flags) {
      poser(u, e, f, i, time, O);
      if (O.x < X0 || O.x > X1 || O.y < Y0 || O.y > Y1) continue;
      const K = A * S * e.fs;
      ctx.globalAlpha = u._fade ?? 1;
      ctx.setTransform(K, 0, 0, K, A * O.x + ex, A * O.y + ey);
      drapeau(ctx, this.L[look], 0, 0, time, f.r * 9, f.role !== R.DRAPEAU);
    }
    ctx.globalAlpha = 1;
    view.monde(ctx);
    this.menage();
  }
  // ménage : sprites au-delà du budget, régiments disparus
  menage() {
    this.trim();
    if (this.frame % 300 === 0) for (const [id, e] of this.lays) if (e.seen < this.frame - 300) this.lays.delete(id);
  }
}
