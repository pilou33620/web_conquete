// Les troupes de la bataille en figurines 3D sur le plateau (SPEC-HEX.md). La disposition des régiments, la course
// vers une nouvelle formation, les pas, le feu (épaule, joue, recul, baguette), la charge, la mêlée, la déroute et les
// pertes sont ceux des figures 2D (battle/troupes2d.js : preparer, poses, kill) : on ne pose ici que des figurines,
// une par figure, aux couleurs et à la tenue de l'époque (tenue). Rendu instancié : un maillage par modèle et par tenue,
// ses contours à part ; le fusil est une pièce à part, que la pose lève ou abaisse. Les tués restent couchés au sol.
import { THREE, MAT, CONT, lot, put, fusion, boite, cyl, cone, sphere, clamp } from './moteur.js';
import { R, tenue } from '../battle/troupes2d.js';

const H = 1.8;   // un homme, en mètres (la figurine est agrandie comme les figures 2D : fs)
const NOIR = 0x2a2522, CHAIR = 0xf0c9a0, CUIR = 0x6b4d31, BRONZE = 0xb9893a, BLANC = 0xf2efe6;

// ---------------------------------------------------------------- modèles (un mètre par unité, regard vers +x)
function coiffe(L, tete, col) {
  const y = 1.66;
  switch (tete) {
    case 'ourson': put(L, cyl(0.13, 0.16, 0.36, 8), NOIR, 0, y + 0.18, 0, 0, 0.03); break;
    case 'shako': put(L, cyl(0.13, 0.11, 0.24, 8), NOIR, 0, y + 0.12, 0, 0, 0.03); put(L, boite(0.08, 0.02, 0.14), NOIR, 0.12, y + 0.02, 0, 0, 0); break;
    case 'kepi': put(L, cyl(0.12, 0.12, 0.13, 8), 0xa8302a, 0, y + 0.07, 0, 0, 0.03); put(L, boite(0.08, 0.02, 0.14), NOIR, 0.12, y + 0.01, 0, 0, 0); break;
    case 'casque': put(L, sphere(0.14, 1), BRONZE, 0, y + 0.04, 0, 0, 0.03); put(L, boite(0.24, 0.08, 0.04), NOIR, -0.02, y + 0.17, 0, 0, 0); break;
    case 'rond': put(L, cyl(0.22, 0.22, 0.04, 10), 0x5b4632, 0, y + 0.02, 0, 0, 0.02); put(L, cyl(0.11, 0.12, 0.12, 8), 0x5b4632, 0, y + 0.09, 0, 0, 0); break;
    case 'tricorne': put(L, cone(0.26, 0.14, 3), NOIR, 0, y + 0.06, 0, Math.PI / 2, 0.03); break;
    default: put(L, boite(0.16, 0.13, 0.42), NOIR, 0, y + 0.05, 0, 0, 0.03);   // bicorne, porté en bataille
  }
  if (col) put(L, sphere(0.04, 0), col, 0.04, y + 0.28, 0, 0, 0);   // pompon, plumet
}
function pieton(t, role) {
  const L = lot(), habit = t.habit;   // (les jambes sont à part : jambe(), elles marchent)
  put(L, boite(0.3, 0.62, 0.42), habit, 0, 1.13, 0, 0, 0.04);
  if (t.revers) put(L, boite(0.02, 0.4, 0.16), t.revers, 0.16, 1.2, 0, 0, 0);
  if (t.buff) { const b = boite(0.02, 0.7, 0.05); b.rotateX(0.6); put(L, b, t.buff, 0.16, 1.13, 0, 0, 0); }
  if (t.sacOn && role === R.H) put(L, boite(0.14, 0.32, 0.32), t.sac, -0.2, 1.18, 0, 0, 0.03);
  put(L, sphere(0.12, 1), CHAIR, 0, 1.55, 0, 0, 0.03);
  coiffe(L, role === R.OFFICIER ? t.teteOff : t.tete, t.plume || t.pompon);
  if (role === R.TAMBOUR) { const d = cyl(0.14, 0.14, 0.2, 10); d.rotateX(Math.PI / 2); put(L, d, BLANC, 0.18, 0.95, 0.12, 0, 0.03); }
  if (role === R.DRAPEAU) { put(L, cyl(0.025, 0.025, 2.6, 5), CUIR, 0.1, 1.3, 0.2, 0, 0); put(L, boite(0.02, 0.6, 0.9), t.drap || habit, 0.1, 2.25, 0.66, 0, 0.02); put(L, boite(0.025, 0.25, 0.35), BLANC, 0.1, 2.25, 0.66, 0, 0); }
  return L;
}
function cheval(L, robe) {
  put(L, boite(1.7, 0.62, 0.52), robe, 0, 1.15, 0, 0, 0.04);
  for (const [a, b] of [[0.62, 0.17], [0.62, -0.17], [-0.62, 0.17], [-0.62, -0.17]]) put(L, boite(0.14, 0.86, 0.14), robe, a, 0.43, b, 0, 0);
  const cou = boite(0.42, 0.72, 0.32); cou.rotateZ(-0.55); put(L, cou, robe, 0.95, 1.55, 0, 0, 0.04);
  put(L, boite(0.56, 0.26, 0.24), robe, 1.25, 1.83, 0, 0, 0.03);
  put(L, boite(0.12, 0.6, 0.08), NOIR, -0.92, 1.05, 0, 0, 0);   // queue
}
function cavalier(t, role) {
  const L = lot(); cheval(L, t.chevaux?.[1] || 0x6b4a2c);
  put(L, boite(0.9, 0.06, 0.62), t.chabraque || t.habit, -0.05, 1.48, 0, 0, 0);
  put(L, boite(0.3, 0.62, 0.42), t.habit, -0.05, 1.82, 0, 0, 0.04);
  put(L, boite(0.18, 0.5, 0.12), t.culotte || BLANC, 0, 1.45, 0.3, 0, 0); put(L, boite(0.18, 0.5, 0.12), t.culotte || BLANC, 0, 1.45, -0.3, 0, 0);
  put(L, sphere(0.12, 1), CHAIR, -0.05, 2.25, 0, 0, 0.03);
  const C = lot(); coiffe(C, role === R.CAV_GEN || role === R.CAV_OFF ? t.teteOff || t.tete : t.tete, t.plume); for (const g of C.g) { g.translate(-0.05, 0.62, 0); L.g.push(g); } for (const o of C.o) { o.translate(-0.05, 0.62, 0); L.o.push(o); }
  if (role === R.CAV_GEN) { put(L, cyl(0.025, 0.025, 2.4, 5), CUIR, -0.4, 2.2, 0.3, 0, 0); put(L, boite(0.02, 0.5, 0.8), t.drap || t.habit, -0.4, 3.1, 0.7, 0, 0.02); }
  return L;
}
function attelage(t) { const L = lot(); cheval(L, t.chevaux?.[0] || 0x6b4a2c); return L; }
function piece(t) {
  const L = lot();
  for (const k of [-1, 1]) { const r = cyl(0.55, 0.55, 0.08, 12); r.rotateX(Math.PI / 2); put(L, r, CUIR, 0, 0.55, k * 0.42, 0, 0.03); }
  const f = cyl(0.12, 0.17, 1.8, 10); f.rotateZ(Math.PI / 2); put(L, f, t.mit ? 0x36393d : BRONZE, 0.35, 0.82, 0, 0, 0.04);
  const fl = boite(1.6, 0.18, 0.3); fl.rotateZ(0.3); put(L, fl, t.affut || 0x5f6b3e, -0.75, 0.48, 0, 0, 0.03);
  return L;
}
function voiture(t, bache) {
  const L = lot();
  put(L, boite(1.9, 0.6, 1), t.caisse || 0x5f6b3e, 0, 0.9, 0, 0, 0.04);
  if (bache) { const b = cyl(0.55, 0.55, 1.8, 8); b.rotateZ(Math.PI / 2); put(L, b, t.bache || 0xece4cb, 0, 1.25, 0, 0, 0.03); }
  for (const a of [-0.6, 0.6]) for (const k of [-1, 1]) { const r = cyl(0.42, 0.42, 0.08, 10); r.rotateX(Math.PI / 2); put(L, r, CUIR, a, 0.42, k * 0.55, 0, 0.03); }
  return L;
}
// une jambe, la hanche à l'origine : elle pend vers le bas et pivote autour de la hanche (le pas)
function jambe(col) { const L = lot(); put(L, boite(0.11, 0.84, 0.12), col, 0, -0.42, 0, 0, 0.03); return L; }
function fusil() { const L = lot(); put(L, boite(0.05, 1.45, 0.05), CUIR, 0, 0, 0, 0, 0.02); put(L, boite(0.02, 0.35, 0.02), 0xc8ccd0, 0, 0.88, 0, 0, 0); return L; }

// ---------------------------------------------------------------- un maillage instancié (et ses contours)
class Lot3D {
  constructor(parent, L, cap = 256) { this.parent = parent; this.geo = fusion(L.g); this.geoO = fusion(L.o); this.cap = 0; this.n = 0; this.agrandir(cap); }
  agrandir(cap) {
    for (const m of [this.m, this.mo]) if (m) { this.parent.remove(m); m.dispose(); }
    this.cap = cap;
    this.m = new THREE.InstancedMesh(this.geo, MAT, cap); this.m.castShadow = true; this.m.receiveShadow = true;
    this.mo = this.geoO ? new THREE.InstancedMesh(this.geoO, CONT, cap) : null;
    for (const m of [this.m, this.mo]) if (m) { m.frustumCulled = false; m.count = 0; this.parent.add(m); }
  }
  poser(mat) {
    if (this.n >= this.cap) { const old = this.m.instanceMatrix.array.slice(0, this.n * 16); this.agrandir(this.cap * 2); this.m.instanceMatrix.array.set(old); this.mo?.instanceMatrix.array.set(old); }
    this.m.setMatrixAt(this.n, mat); this.mo?.setMatrixAt(this.n, mat); this.n++;
  }
  fin() { for (const m of [this.m, this.mo]) if (m) { m.count = this.n; m.instanceMatrix.needsUpdate = true; } }
  dispose() { for (const m of [this.m, this.mo]) if (m) { this.parent.remove(m); m.dispose(); } this.geo?.dispose(); this.geoO?.dispose(); }
}

const MT = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), EU = new THREE.Euler(0, 0, 0, 'YXZ');
const PIETONS = new Set([R.H, R.PIQUE, R.DRAPEAU, R.OFFICIER, R.TAMBOUR, R.SERVANT]);
const MONTES = new Set([R.CAV, R.CAV_OFF, R.CAV_GEN]);

export class Troupes3D {
  // champ : hex/champ.js (sol, scène) ; troupes : battle/troupes2d.js (dispositions, poses, pertes) ; year : tenues
  constructor(champ, troupes, year) {
    this.champ = champ; this.tr = troupes; this.year = year || 1790;
    this.grp = new THREE.Group(); champ.sc.monde.add(this.grp);
    this.lots = new Map();       // clé (modèle | tenue) → Lot3D
    this.tenues = new Map();
    this.morts = new Map();      // tués couchés : clé de couleur → Lot3D (jamais vidés)
  }
  tenueDe(col, type) { const k = col + '|' + type; let t = this.tenues.get(k); if (!t) { t = tenue(col, type, this.year); this.tenues.set(k, t); } return t; }
  lotDe(cle, fab) { let l = this.lots.get(cle); if (!l) { l = new Lot3D(this.grp, fab()); this.lots.set(cle, l); } return l; }
  // pose une matrice : (x, y) au sol en mètres, cap a, échelle s, hauteur en plus dy, inclinaisons rx (roulis) et rz (tangage)
  mat(x, y, a, s, dy = 0, rx = 0, rz = 0) {
    P.set(x, this.champ.hauteur(x, y) + dy, y); EU.set(rx, -a, rz); Q.setFromEuler(EU); SC.set(s, s, s);
    return MT.compose(P, Q, SC);
  }
  // une image : units (vue.js), couleurs des camps, temps (s), visible(x, y, marge)
  image(units, colors, time, visible) {
    for (const l of this.lots.values()) l.n = 0;
    const list = this.tr.preparer(units, time), fs = this.tr.fs;
    for (const u of list) {
      if ((u._fade ?? 1) < 0.5 || !visible(u.x, u.y, Math.max(u.w || 0, u.d || 0) + 20)) continue;
      const col = colors[u.side] || '#888', t = this.tenueDe(col, u.type), cle = col + '|' + u.type;
      this.tr.poses(u, time, (x, y, a, role, d) => {
        // le pas : la figure monte et descend ; au galop, plus fort ; à la charge, elle se penche
        const pas = d.legs != null ? Math.abs(Math.sin(d.legs)) * 0.07 : d.gait != null ? Math.abs(Math.sin(d.gait)) * 0.05 * d.amp : 0;
        const pench = u.state === "charge" ? -0.18 : 0, s = fs * 0.75;
        if (PIETONS.has(role)) {
          const lr = role === R.SERVANT ? R.H : role;
          this.lotDe('p' + lr + '|' + cle, () => pieton(t, lr)).poser(this.mat(x, y, a, s, pas * s, 0, pench));
          // les jambes : chacune balance d'avant en arrière au rythme du pas (d.legs, la phase du pas des figures 2D)
          const sw = d.legs != null ? Math.sin(d.legs) * 0.5 : 0, cj = 'j|' + (t.culotte || BLANC), sa = Math.sin(a), ca = Math.cos(a);
          for (const c of [-1, 1]) this.lotDe(cj, () => jambe(t.culotte || BLANC)).poser(this.mat(x - sa * c * 0.07 * s, y + ca * c * 0.07 * s, a, s, (0.84 + pas) * s, 0, c * sw));
          // le fusil selon la pose : à l'épaule, en joue, baïonnette en avant, à la baguette, posé
          if (role === R.H || role === R.PIQUE) {
            let fx = 0.05, fy = 1.3, fz = 0.22, rz = 0;
            switch (d.arme) {
              case 'joue': fx = 0.45 - d.recul * 0.05; fy = 1.45; fz = 0.08; rz = -Math.PI / 2; break;
              case 'baio': case 'pique': fx = 0.55; fy = 1.1; fz = 0.12; rz = -Math.PI / 2 + 0.15; break;
              case 'recharge': fx = 0.25; fy = 0.95; fz = 0.05; break;
              case 'sol': case 'hache0': fx = 0.05; fy = 0.72; fz = 0.25; break;
              case 'aucun': fy = -99; break;
            }
            if (fy > -9) {
              const c = Math.cos(a), sn = Math.sin(a), wx = x + (fx * c - fz * sn) * s, wy = y + (fx * sn + fz * c) * s;
              this.lotDe('fusil', fusil).poser(this.mat(wx, wy, a, s, (fy + pas) * s, 0, rz + pench));
            }
          }
        } else if (MONTES.has(role)) this.lotDe('c' + role + '|' + cle, () => cavalier(t, role)).poser(this.mat(x, y, a, s, pas * s, 0, pench * 0.5));
        else if (role === R.CHEVAL) this.lotDe('a|' + cle, () => attelage(t)).poser(this.mat(x, y, a, s, pas * s));
        else if (role === R.PIECE) { const r = d.recul * 0.12; this.lotDe('k|' + cle + (t.mit ? 'm' : ''), () => piece(t)).poser(this.mat(x - Math.cos(a) * r * s, y - Math.sin(a) * r * s, a, s)); }
        else if (role === R.AVANT || role === R.CAISSON) this.lotDe('v' + role + '|' + cle, () => voiture(t, role === R.CAISSON)).poser(this.mat(x, y, a, s * (role === R.AVANT ? 0.8 : 1), pas * s));
      });
    }
    for (const l of this.lots.values()) l.fin();
  }
  // les tués et les chevaux tombés (decals de troupes2d.kill) : couchés au sol, pour toute la bataille
  tomber(decals) {
    const fs = this.tr.fs * 0.75;
    for (const d of decals) {
      if (d.k !== 'mort' && d.k !== 'cheval') continue;
      const t = this.tenueDe(d.c || '#888', 'ligne'), cle = (d.k === 'cheval' ? 'h' : 'm') + (d.c || '');
      let l = this.morts.get(cle);
      if (!l) {
        const L = d.k === 'cheval' ? attelage(t) : pieton(t, R.H);
        if (d.k !== 'cheval') for (const c of [-1, 1]) { const J = jambe(t.culotte || BLANC); for (const k of ['g', 'o']) for (const geo of J[k]) { geo.translate(0, 0.84, c * 0.07); L[k].push(geo); } }
        l = new Lot3D(this.grp, L, 64); this.morts.set(cle, l);
      }
      if (l.n >= 4000) continue;
      // couché sur le flanc : roulis d'un quart de tour, posé un peu plus bas
      l.poser(this.mat(d.x, d.y, d.a || 0, fs, (d.k === 'cheval' ? 0.3 : 0.15) * fs, Math.PI / 2, 0)); l.fin();
    }
  }
  dispose() { for (const l of [...this.lots.values(), ...this.morts.values()]) l.dispose(); this.lots.clear(); this.morts.clear(); this.champ.sc.monde.remove(this.grp); }
}
export { clamp };
