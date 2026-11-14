// Les troupes de la bataille en figurines 3D sur le plateau (SPEC-HEX.md). La disposition des régiments, la course
// vers une nouvelle formation, les pas, le feu (épaule, joue, recul, baguette), la charge, la mêlée, la déroute et les
// pertes sont ceux des figures 2D (battle/troupes2d.js : preparer, poses, kill) : on ne pose ici que des figurines,
// une par figure, aux couleurs et à la tenue de l'époque (tenue). Rendu instancié : un maillage par modèle et par tenue,
// ses contours à part ; ce qui bouge est une pièce à part, que la pose fait pivoter : jambes (des hommes et des chevaux),
// fusil, bras armé du sabre ou de l'épée, refouloir des servants. Les tués restent couchés au sol.
import { THREE, MAT, CONT, lot, put, fusion, boite, cyl, cone, sphere, caillou, clamp } from './moteur.js';
import { R, tenue } from '../battle/troupes2d.js';
import { E } from '../battle/errants.js';

const H = 1.8;   // un homme, en mètres (la figurine est agrandie comme les figures 2D : fs)
const NOIR = 0x2a2522, CHAIR = 0xf0c9a0, CUIR = 0x6b4d31, BRONZE = 0xc9933c, BLANC = 0xf2efe6, POUDRE = 0xe9e5dc, BRUN = 0x3a2a1f, OR = 0xe8b94a, FER = 0x8d9196, CHAMOIS = 0xe3cf9f;
// (figurines du rendu doux, d'après dev/figurines.js : basques et retroussis, revers, buffleteries croisées, giberne,
// bras et parements, col, cheveux poudrés ou bruns, coiffures galonnées, guêtres et souliers, roues à rayons)
const tourne = (geo, rx = 0, rz = 0) => { if (rx) geo.rotateX(rx); if (rz) geo.rotateZ(rz); return geo; };
const clairDe = c => { const k = new THREE.Color(c); return k.r * 0.3 + k.g * 0.59 + k.b * 0.11; };

// ---------------------------------------------------------------- modèles (un mètre par unité, regard vers +x)
function coiffe(L, tete, col) {
  const y = 1.66;
  switch (tete) {
    case 'ourson': put(L, cyl(0.13, 0.16, 0.38, 10), NOIR, 0, y + 0.19, 0); put(L, boite(0.02, 0.15, 0.14), OR, 0.15, y + 0.1, 0); break;
    case 'shako': put(L, cyl(0.135, 0.115, 0.25, 10), NOIR, 0, y + 0.125, 0); put(L, boite(0.09, 0.02, 0.15), NOIR, 0.13, y + 0.02, 0); put(L, boite(0.02, 0.09, 0.08), OR, 0.125, y + 0.12, 0); break;
    case 'kepi': put(L, cyl(0.12, 0.125, 0.13, 10), 0xa8302a, 0, y + 0.07, 0); put(L, cyl(0.127, 0.127, 0.04, 10), NOIR, 0, y + 0.02, 0); put(L, boite(0.09, 0.02, 0.15), NOIR, 0.13, y + 0.01, 0); break;
    case 'casque': put(L, sphere(0.14, 1), BRONZE, 0, y + 0.04, 0); put(L, boite(0.26, 0.09, 0.04), NOIR, -0.02, y + 0.18, 0); put(L, boite(0.05, 0.3, 0.03), NOIR, -0.17, y + 0.02, 0); break;
    case 'rond': put(L, cyl(0.23, 0.23, 0.035, 12), 0x5b4632, 0, y + 0.02, 0); put(L, cyl(0.11, 0.12, 0.13, 10), 0x5b4632, 0, y + 0.09, 0); break;
    // le tricorne : trois cornes, un galon blanc, la calotte, la cocarde
    case 'tricorne': put(L, cyl(0.285, 0.285, 0.02, 3), BLANC, 0, y + 0.015, 0, Math.PI / 2); put(L, cyl(0.27, 0.27, 0.06, 3), NOIR, 0, y + 0.045, 0, Math.PI / 2); put(L, cyl(0.12, 0.125, 0.11, 10), NOIR, -0.01, y + 0.09, 0); put(L, caillou(0.03), BLANC, 0.15, y + 0.08, 0.1); break;
    default: put(L, boite(0.13, 0.2, 0.48), NOIR, 0, y + 0.1, 0); put(L, sphere(0.13, 1).scale(1, 0.55, 1), NOIR, 0, y + 0.03, 0); put(L, caillou(0.035), BLANC, 0.07, y + 0.13, 0.12);   // bicorne, porté en bataille
  }
  if (col) put(L, caillou(0.05), col, 0.04, y + 0.3, 0);   // pompon, plumet
}
// le buste d'un homme à pied ou à cheval, les pieds (ou la selle) à dy : basques, habit, veste, revers, buffleteries,
// épaulettes, col, tête et cheveux ; bras : les côtés (+1 droite, −1 gauche) dont le bras pend le long du corps
function buste(L, t, dy, bras, habit = t.habit) {
  const y = dy;
  put(L, boite(0.3, 0.3, 0.44), habit, -0.03, y + 0.9, 0);
  if (t.revers) for (const c of [-1, 1]) put(L, boite(0.03, 0.24, 0.14), t.revers, -0.18, y + 0.86, c * 0.12);   // retroussis
  put(L, boite(0.28, 0.46, 0.4), habit, 0, y + 1.24, 0);
  if (t.revers) { put(L, boite(0.02, 0.42, 0.15), CHAMOIS, 0.145, y + 1.12, 0); for (const c of [-1, 1]) put(L, boite(0.02, 0.3, 0.05), t.revers, 0.146, y + 1.3, c * 0.1); }
  if (t.buff) { for (const c of [-1, 1]) put(L, tourne(boite(0.02, 0.66, 0.045), c * 0.58), t.buff, 0.153, y + 1.22, 0); put(L, boite(0.08, 0.14, 0.22), NOIR, -0.17, y + 1.0, 0); }
  if (t.ceinture) put(L, boite(0.31, 0.07, 0.43), t.ceinture, 0, y + 1.04, 0);
  if (t.tablier) put(L, boite(0.02, 0.5, 0.3), t.tablier, 0.16, y + 0.98, 0);
  if (t.epaul) for (const c of [-1, 1]) put(L, boite(0.11, 0.04, 0.12), t.epaul, 0, y + 1.49, c * 0.2);
  for (const c of bras) { put(L, boite(0.1, 0.42, 0.1), habit, 0, y + 1.24, c * 0.25); put(L, boite(0.115, 0.08, 0.115), t.revers || habit, 0, y + 1.07, c * 0.25); put(L, caillou(0.055), CHAIR, 0.01, y + 1.0, c * 0.25); }
  put(L, boite(0.13, 0.05, 0.14), NOIR, 0, y + 1.49, 0);
  put(L, sphere(0.12, 1), CHAIR, 0.01, y + 1.57, 0);
}
// les cheveux : poudrés et noués en queue sous le tricorne et le bicorne, bruns et courts ensuite
function cheveux(L, tete, dy = 0, dx = 0) {
  const vieux = tete === 'tricorne' || tete === 'bicorne' || tete === 'ourson' || tete == null, c = vieux ? POUDRE : BRUN;
  put(L, sphere(0.112, 1), c, dx - 0.035, dy + 1.585, 0);
  if (vieux) { put(L, boite(0.05, 0.15, 0.055), c, dx - 0.13, dy + 1.5, 0); put(L, boite(0.055, 0.04, 0.06), NOIR, dx - 0.135, dy + 1.54, 0); }
}
function pieton(t, role) {
  const L = lot(), habit = t.habit;   // (les jambes sont à part : jambe(), elles marchent)
  // l'officier garde son bras droit pour l'épée (lame), le tambour ses deux bras pour les baguettes
  buste(L, t, 0, role === R.OFFICIER ? [-1] : role === R.TAMBOUR ? [] : [-1, 1]);
  if (role === R.OFFICIER) { put(L, boite(0.02, 0.07, 0.14), OR, 0.15, 1.44, 0); put(L, tourne(boite(0.03, 0.07, 0.44), 0.5), OR, 0.15, 1.1, 0); }   // hausse-col, écharpe
  if (t.sacOn && role === R.H) { put(L, boite(0.14, 0.32, 0.32), t.sac, -0.21, 1.22, 0); put(L, tourne(cyl(0.07, 0.07, 0.36, 8), Math.PI / 2), t.couv || 0xbdb6a3, -0.21, 1.43, 0); }
  const tete = role === R.OFFICIER ? t.teteOff : t.tete;
  cheveux(L, tete); coiffe(L, tete, t.plume || t.pompon);
  if (role === R.TAMBOUR) { put(L, tourne(cyl(0.15, 0.15, 0.22, 12), Math.PI / 2 - 0.3), BLANC, 0.2, 0.95, 0.1); for (const k of [-1, 1]) put(L, tourne(cyl(0.155, 0.155, 0.03, 12), Math.PI / 2 - 0.3), habit, 0.2 , 0.95 + k * 0.03, 0.1 + k * 0.1); }
  // le drapeau d'ordonnance : la croix blanche sur l'étoffe aux couleurs du régiment
  if (role === R.DRAPEAU) { put(L, cyl(0.025, 0.025, 2.7, 6), CUIR, 0.1, 1.35, 0.2); put(L, caillou(0.05), OR, 0.1, 2.74, 0.2); put(L, boite(0.02, 0.72, 1), t.drap || habit, 0.1, 2.28, 0.72); put(L, boite(0.026, 0.13, 1), BLANC, 0.1, 2.28, 0.72); put(L, boite(0.026, 0.72, 0.13), BLANC, 0.1, 2.28, 0.72); }
  return L;
}
function cheval(L, robe) {   // (les jambes sont à part : jambeCheval(), hanches à 0,86 m, elles trottent)
  const crin = new THREE.Color(robe).multiplyScalar(0.45);
  put(L, sphere(0.31, 1).scale(2.75, 1, 0.84), robe, 0, 1.15, 0);
  put(L, sphere(0.3, 1).scale(1, 1.02, 0.8), robe, 0.58, 1.2, 0); put(L, sphere(0.31, 1).scale(1.05, 1, 0.84), robe, -0.58, 1.19, 0);   // poitrail, croupe
  put(L, tourne(boite(0.36, 0.76, 0.28), 0, -0.55), robe, 0.95, 1.56, 0);
  put(L, tourne(boite(0.5, 0.22, 0.22), 0, -0.6), robe, 1.27, 1.84, 0); put(L, tourne(boite(0.16, 0.16, 0.19), 0, -0.6), crin, 1.44, 1.7, 0);   // tête, naseaux
  for (const c of [-1, 1]) put(L, boite(0.05, 0.11, 0.05), robe, 1.12, 2.02, c * 0.07);   // oreilles
  put(L, tourne(boite(0.07, 0.62, 0.06), 0, -0.55), crin, 0.86, 1.68, 0);   // crinière
  put(L, tourne(boite(0.1, 0.62, 0.1), 0, 0.3), crin, -0.95, 1.04, 0);   // queue
}
// le bras gauche tendu vers l'encolure et les rênes, de la main à la bouche du cheval (cavalier, postillon)
function renes(L, habit, z = -0.15) {
  const b = boite(0.09, 0.42, 0.09); b.rotateZ(-1.05); put(L, b, habit, 0.12, 1.86, z, 0, 0.02); put(L, caillou(0.05), CHAIR, 0.3, 1.76, z);
  const r = boite(0.95, 0.025, 0.025); r.rotateZ(-0.06); put(L, r, NOIR, 0.78, 1.74, z * 0.6, 0, 0);
}
// le postillon, monté sur le cheval de gauche de la paire (troupes2d : monte) : chapeau rond, rênes et fouet
function postillon(t) {
  const L = lot();
  put(L, boite(0.3, 0.6, 0.4), t.habit, -0.05, 1.82, 0, 0, 0.04);
  for (const k of [-1, 1]) { put(L, boite(0.18, 0.5, 0.12), t.culotte || BLANC, 0, 1.45, k * 0.3, 0, 0); put(L, boite(0.2, 0.3, 0.13), NOIR, 0.02, 1.12, k * 0.3, 0, 0); }
  put(L, sphere(0.12, 1), CHAIR, -0.05, 2.25, 0, 0, 0.03);
  const C = lot(); coiffe(C, 'rond'); greffer(L, C, -0.05, 0.62, 0);
  renes(L, t.habit, -0.15); renes(L, t.habit, 0.15);
  const f = boite(0.02, 0.9, 0.02); f.rotateZ(0.5); put(L, f, CUIR, 0.1, 2.25, 0.25, 0, 0);   // le fouet
  return L;
}
// le bras du tambour, l'épaule à l'origine : bras et baguette vers +y (la pose le fait battre)
function baguette(habit) { const L = lot(); put(L, boite(0.09, 0.42, 0.09), habit, 0, 0.21, 0, 0, 0.02); put(L, boite(0.025, 0.34, 0.025), 0xd8c08a, 0, 0.56, 0, 0, 0); return L; }
function cavalier(t, role) {
  const L = lot(), chef = role === R.CAV_GEN || role === R.CAV_OFF; cheval(L, t.chevaux?.[1] || 0x6b4a2c);
  renes(L, t.habit);
  put(L, boite(0.92, 0.07, 0.66), t.chabraque || t.habit, -0.05, 1.48, 0); put(L, boite(0.96, 0.03, 0.7), t.galon || BLANC, -0.05, 1.45, 0);
  // (le bras droit est le sabre : lame() ; le gauche tient les rênes)
  buste(L, t, 0.62, [], t.habit);
  for (const c of [-1, 1]) { put(L, boite(0.4, 0.14, 0.13), t.culotte || BLANC, 0.08, 1.5, c * 0.27); put(L, boite(0.14, 0.52, 0.14), NOIR, 0.2, 1.2, c * 0.31); }   // cuisses, bottes
  if (chef) { put(L, tourne(boite(0.03, 0.07, 0.44), 0.5), OR, 0.15, 1.72, 0); for (const c of [-1, 1]) put(L, boite(0.12, 0.05, 0.13), OR, 0, 2.11, c * 0.2); }
  const tete = chef ? t.teteOff || t.tete : t.tete, C = lot();
  cheveux(C, tete); coiffe(C, tete, t.plume); greffer(L, C, 0, 0.62, 0);
  const f = boite(0.05, 0.85, 0.07); f.rotateZ(-0.9); put(L, f, FER, -0.2, 1.25, -0.34);   // le fourreau, à gauche (le sabre : lame())
  if (role === R.CAV_GEN) { put(L, cyl(0.025, 0.025, 2.4, 6), CUIR, -0.4, 2.2, 0.3); put(L, boite(0.02, 0.56, 0.84), t.drap || t.habit, -0.4, 3.08, 0.72); put(L, boite(0.026, 0.11, 0.84), BLANC, -0.4, 3.08, 0.72); put(L, boite(0.026, 0.56, 0.11), BLANC, -0.4, 3.08, 0.72); }
  return L;
}
function attelage(t) { const L = lot(); cheval(L, t.chevaux?.[0] || 0x6b4a2c); return L; }
// une roue de bois cerclée de fer, dans le plan xy (l'essieu selon z), de rayon r
function roue(L, r, x, y, z) {
  put(L, tourne(cyl(r, r, 0.07, 16), Math.PI / 2), CUIR, x, y, z);
  put(L, new THREE.TorusGeometry(r * 0.96, 0.045, 6, 18), FER, x, y, z + Math.sign(z || 1) * 0.02);
  put(L, tourne(cyl(0.1, 0.1, 0.2, 8), Math.PI / 2), FER, x, y, z);
  for (let k = 0; k < 4; k++) put(L, tourne(boite(0.045, r * 1.8, 0.035), 0, k * Math.PI / 4), 0x7a5233, x, y, z + Math.sign(z || 1) * 0.03);
}
function piece(t) {
  const L = lot(), fut = t.mit ? 0x36393d : BRONZE, affut = t.affut || 0x5f6b3e;
  for (const k of [-1, 1]) roue(L, 0.55, 0, 0.55, k * 0.44);
  put(L, boite(0.12, 0.1, 0.84), affut, 0, 0.55, 0);   // essieu
  for (const k of [-1, 1]) put(L, tourne(boite(1.55, 0.2, 0.08), 0, 0.3), affut, -0.72, 0.5, k * 0.15);   // flasques
  put(L, boite(0.3, 0.1, 0.36), affut, -1.42, 0.3, 0); put(L, boite(0.06, 0.08, 0.3), FER, -1.52, 0.36, 0);   // crosse, anneau
  // le tube : renflé à la culasse, la bouche cerclée, le bouton de culasse, les tourillons
  put(L, tourne(cyl(0.11, 0.17, 1.8, 12), 0, -Math.PI / 2 + 0.04), fut, 0.35, 0.84, 0);
  put(L, tourne(cyl(0.135, 0.135, 0.07, 12), 0, -Math.PI / 2), fut, 1.24, 0.875, 0); put(L, sphere(0.085, 1), fut, -0.6, 0.8, 0);
  for (const k of [-1, 1]) put(L, boite(0.1, 0.05, 0.06), fut, 0.25, 0.84, k * 0.17);
  return L;
}
function voiture(t, bache) {
  const L = lot();
  put(L, boite(1.9, 0.6, 1), t.caisse || 0x5f6b3e, 0, 0.9, 0);
  if (bache) put(L, tourne(cyl(0.55, 0.55, 1.8, 12), 0, Math.PI / 2), t.bache || 0xece4cb, 0, 1.25, 0);
  for (const a of [-0.6, 0.6]) for (const k of [-1, 1]) roue(L, 0.42, a, 0.42, k * 0.55);
  return L;
}
// une jambe, la hanche à l'origine : elle pend vers le bas et pivote autour de la hanche (le pas)
// (culotte jusqu'au genou, guêtre dessous si g, soulier)
function jambe(col, g) {
  const L = lot();
  put(L, boite(0.12, g ? 0.44 : 0.78, 0.13), col, 0, g ? -0.22 : -0.39, 0);
  if (g) put(L, boite(0.115, 0.36, 0.125), g, 0, -0.6, 0);
  put(L, boite(0.21, 0.07, 0.12), NOIR, 0.04, -0.805, 0); return L;
}
// une jambe de cheval, la hanche à l'origine, et son sabot
function jambeCheval(robe) { const L = lot(); put(L, boite(0.14, 0.78, 0.14), robe, 0, -0.39, 0, 0, 0.03); put(L, boite(0.16, 0.08, 0.16), NOIR, 0, -0.82, 0, 0, 0); return L; }
// le bras armé, l'épaule à l'origine : bras, main, garde et lame vers +y ; la pose le fait pivoter autour de l'épaule
function lame(habit, long) {
  const L = lot(); put(L, boite(0.1, 0.48, 0.1), habit, 0, 0.24, 0, 0, 0.03); put(L, caillou(0.06), CHAIR, 0, 0.5, 0);
  put(L, boite(0.05, 0.04, 0.16), BRONZE, 0, 0.56, 0, 0, 0); put(L, boite(0.025, long, 0.06), 0xdfe3e6, 0, 0.58 + long / 2, 0, 0, 0.02); return L;
}
// le refouloir (l'écouvillon au bout), les mains à l'origine, la hampe vers +x
function refouloir() { const L = lot(); put(L, boite(1.7, 0.05, 0.05), CUIR, 0.75, 0, 0, 0, 0.02); const b = cyl(0.08, 0.08, 0.22, 6); b.rotateZ(Math.PI / 2); put(L, b, NOIR, 1.6, 0, 0, 0, 0.02); return L; }
// ajoute au lot L les pièces du lot J, décalées de (x, y, z)
function greffer(L, J, x, y, z) { for (const k of ['g', 'o']) for (const geo of J[k]) { geo.translate(x, y, z); L[k].push(geo); } }
// un homme entier (buste et jambes), pour ceux qui ne marchent pas au pas du régiment : blessés, brancardiers
function homme(t) { const L = pieton({ ...t, sacOn: false }, R.H); for (const c of [-1, 1]) greffer(L, jambe(t.culotte || BLANC, guetre(t)), 0, 0.84, c * 0.08); return L; }
// le brancard : deux hampes, la toile
function brancard() { const L = lot(); for (const c of [-1, 1]) put(L, boite(2.3, 0.05, 0.05), CUIR, 0, 0, c * 0.28); put(L, boite(1.8, 0.03, 0.54), 0xd9d2bd, 0, -0.01, 0); return L; }
function fusil() { const L = lot(); put(L, boite(0.07, 0.5, 0.05), CUIR, 0, -0.48, 0); put(L, boite(0.035, 1.0, 0.035), FER, 0, 0.22, 0); put(L, boite(0.016, 0.3, 0.016), 0xc8ccd0, 0, 0.87, 0); return L; }   // crosse, canon, baïonnette

const guetre = t => (t.tete === 'tricorne' ? BLANC : clairDe(t.culotte || BLANC) > 0.7 ? NOIR : null);

// ---------------------------------------------------------------- un maillage instancié
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
// jambes du cheval : [avant, côté (droite +), phase au pas et au trot (les diagonales, comme les figures 2D), au galop]
const JC = [[0.62, -0.17, 0, 0], [0.62, 0.17, Math.PI, 0.8], [-0.62, -0.17, Math.PI, Math.PI], [-0.62, 0.17, 0, Math.PI + 0.8]];

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
  // une pièce au point (fx, fy, fz) du repère de la figure (x, y, cap a, échelle s), tangage rz, tournée de da
  sous(cle, fab, x, y, a, s, fx, fy, fz, rz = 0, da = 0) {
    const c = Math.cos(a), sn = Math.sin(a);
    this.lotDe(cle, fab).poser(this.mat(x + (fx * c - fz * sn) * s, y + (fx * sn + fz * c) * s, a + da, s, fy * s, 0, rz));
  }
  // les quatre jambes d'un cheval qui marche, trotte ou galope (d.gait, d.amp : la phase et l'allure des figures 2D)
  jambesCheval(x, y, a, s, dy, d, robe) {
    const k = d.gait == null ? 0 : 0.22 * d.amp, gal = d.amp > 2, fab = () => jambeCheval(robe);
    for (const [fx, fz, pt, pg] of JC) this.sous('jc|' + robe, fab, x, y, a, s, fx, 0.86 + dy, fz, k && Math.sin(d.gait + (gal ? pg : pt)) * k);
  }
  // une image : units (vue.js), couleurs des camps, temps (s), visible(x, y, marge)
  image(units, colors, time, visible, errants) {
    for (const l of this.lots.values()) l.n = 0;
    const list = this.tr.preparer(units, time), fs = this.tr.fs;
    for (const u of list) {
      if ((u._fade ?? 1) < 0.5 || !visible(u.x, u.y, Math.max(u.w || 0, u.d || 0) + 20)) continue;
      const col = colors[u.side] || '#888', t = this.tenueDe(col, u.type), cle = col + '|' + u.type;
      this.tr.poses(u, time, (x, y, a, role, d, job, cyc) => {
        // le pas : la figure monte et descend ; au galop, plus fort ; à la charge, elle se penche
        const pas = d.legs != null ? Math.abs(Math.sin(d.legs)) * 0.07 : d.gait != null ? Math.abs(Math.sin(d.gait)) * 0.05 * d.amp : 0;
        const pench = u.state === "charge" ? -0.18 : 0, s = fs * 0.75;
        if (PIETONS.has(role)) {
          const lr = role === R.SERVANT ? R.H : role;
          // les servants : au coup, un mouvement de recul ; le pointeur, penché sur la culasse, jusqu'à ce qu'il s'écarte
          let rz = pench;
          if (role === R.SERVANT && cyc >= 0) rz = cyc < 0.6 ? 0.3 * (1 - cyc / 0.6) : job === 2 && cyc > 1.4 && cyc < 4.6 ? -0.55 : 0;
          // (le corps pivote aux hanches, pour rester sur ses jambes)
          this.sous('p' + lr + '|' + cle, () => pieton(t, lr), x, y, a, s, 0.84 * Math.sin(rz), pas + 0.84 * (1 - Math.cos(rz)), 0, rz);
          // les jambes : chacune balance d'avant en arrière au rythme du pas (d.legs, la phase du pas des figures 2D)
          const sw = d.legs != null ? Math.sin(d.legs) * 0.5 : 0, gu = guetre(t), cj = 'j|' + (t.culotte || BLANC) + '|' + gu;
          for (const c of [-1, 1]) this.sous(cj, () => jambe(t.culotte || BLANC, gu), x, y, a, s, 0, 0.84 + pas, c * 0.08, c * sw);
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
            if (fy > -9) this.sous('fusil', fusil, x, y, a, s, fx, fy + pas, fz, rz + pench);
          }
          // l'épée de l'officier : basse au repos ; levée à la charge, elle frappe dans la mêlée (d.ext)
          // le tambour bat : les deux baguettes, l'une après l'autre (d.ext)
          if (role === R.TAMBOUR) for (const c of [-1, 1]) this.sous('b|' + t.habit, () => baguette(t.habit), x, y, a, s, 0, 1.36 + pas, c * 0.18, Math.PI - 0.95 + (c > 0 ? 1 + d.ext : 1 - d.ext) * 0.3);   // (d.ext de −1 à 1)
          if (role === R.OFFICIER) this.sous('e|' + t.habit, () => lame(t.habit, 0.75), x, y, a, s, 0, 1.38 + pas, 0.2, d.arme === 'epee+' ? -0.5 - d.ext * 1.3 : Math.PI - 0.35);
          // le refouloir (servant n° 1) : poussé dans la bouche entre deux coups (d.ext), debout à côté de lui sinon
          if (role === R.SERVANT && job === 1) {
            if (d.arme === 'refouloir') { const da = 2.75, e = 0.25 + d.ext * 0.5; this.sous('r', refouloir, x, y, a, s, 0.25 + Math.cos(da) * e, 1.05 + pas, 0.15 + Math.sin(da) * e, -0.1, da); }
            else this.sous('r', refouloir, x, y, a, s, 0.1, 0.18, 0.3, Math.PI / 2);
          }
        } else if (MONTES.has(role)) {
          const robe = t.chevaux?.[1] || 0x6b4a2c;
          this.lotDe('c' + role + '|' + cle, () => cavalier(t, role)).poser(this.mat(x, y, a, s, pas * s, 0, pench * 0.5));
          this.jambesCheval(x, y, a, s, pas, d, robe);
          // le sabre : au fourreau (dans le modèle) ; tiré et levé à la charge, il frappe dans la mêlée (d.ext de −1 à 1)
          if (d.sabre) this.sous('e|' + t.habit + 'c', () => lame(t.habit, 0.9), x, y, a, s, -0.05, 2.06 + pas, 0.22, d.sabre === 2 ? -0.9 + d.ext * 0.9 : -1);
        } else if (role === R.CHEVAL) {
          this.lotDe('a|' + cle, () => attelage(t)).poser(this.mat(x, y, a, s, pas * s)); this.jambesCheval(x, y, a, s, pas, d, t.chevaux?.[0] || 0x6b4a2c);
          if (d.monte) this.lotDe('po|' + cle, () => postillon(t)).poser(this.mat(x, y, a, s, pas * s));
        }
        // la pièce recule au coup sur son affût, la bouche se relève
        else if (role === R.PIECE) { const r = d.recul * 0.12; this.lotDe('k|' + cle + (t.mit ? 'm' : ''), () => piece(t)).poser(this.mat(x - Math.cos(a) * r * s, y - Math.sin(a) * r * s, a, s, 0, 0, d.recul * 0.04)); }
        else if (role === R.AVANT || role === R.CAISSON) this.lotDe('v' + role + '|' + cle, () => voiture(t, role === R.CAISSON)).poser(this.mat(x, y, a, s * (role === R.AVANT ? 0.8 : 1), pas * s));
      });
    }
    if (errants) this.errants(errants, colors, visible);
    for (const l of this.lots.values()) l.fin();
  }
  // ce qui erre après les coups (battle/errants.js) : chevaux sans cavalier, blessés qui rampent ou boitent, gisants,
  // brancardiers et leur brancard
  errants(liste, colors, visible) {
    const s = this.tr.fs * 0.75;
    for (const e of liste) {
      if (!visible(e.x, e.y, 20)) continue;
      const col = colors[e.side] || '#888', t = this.tenueDe(col, 'ligne'), cle = col + '|ligne', c = Math.cos(e.a), sn = Math.sin(e.a);
      if (e.k === E.CHEVAL) {
        const robe = t.chevaux?.[0] || 0x6b4a2c, d = { gait: e.v ? e.ph : null, amp: e.v > 6 ? 2.6 : 1 }   /* (la robe du modèle : attelage) */, pas = e.v ? Math.abs(Math.sin(e.ph)) * 0.05 * d.amp : 0;
        // (il broute : l'encolure basse)
        this.lotDe('a|' + cle, () => attelage(t)).poser(this.mat(e.x, e.y, e.a, s, pas * s, 0, e.v ? 0 : -0.16));
        this.jambesCheval(e.x, e.y, e.a, s, pas, d, robe);
      } else if (e.k === E.BRANCARD) {
        // deux porteurs l'un derrière l'autre, le brancard entre eux (et le blessé dessus au retour)
        const pas = Math.abs(Math.sin(e.ph)) * 0.05;
        for (const k of [-1, 1]) this.lotDe('hm|' + cle, () => homme(t)).poser(this.mat(e.x + c * k * 1.15 * s, e.y + sn * k * 1.15 * s, e.a, s, pas * s));
        this.lotDe('br', brancard).poser(this.mat(e.x, e.y, e.a, s, 0.78 * s));
        if (e.charge) this.lotDe('hm|' + cle, () => homme(t)).poser(this.mat(e.x - c * 0.85 * s, e.y - sn * 0.85 * s, e.a, s, 0.98 * s, 0, -Math.PI / 2));
      } else {
        // à plat ventre, il se traîne ; couché sur le flanc, il attend ; debout, il s'en va en boitant, penché
        const rampe = e.k === E.RAMPE, gis = e.k === E.GISANT;
        this.lotDe('hm|' + cle, () => homme(t)).poser(this.mat(e.x, e.y, e.a, s, (rampe || gis ? 0.2 : Math.abs(Math.sin(e.ph)) * 0.06) * s,
          gis ? Math.PI / 2 : rampe ? Math.sin(e.ph) * 0.12 : 0, rampe ? -Math.PI / 2 : gis ? 0 : -0.2 + Math.sin(e.ph) * 0.06));
      }
    }
  }
  // les tués et les chevaux tombés (decals de troupes2d.kill) : couchés au sol, pour toute la bataille
  tomber(decals) {
    const fs = this.tr.fs * 0.75;
    for (const d of decals) {
      if (d.k !== 'mort' && d.k !== 'cheval') continue;
      const t = this.tenueDe(d.c || '#888', 'ligne'), cle = (d.k === 'cheval' ? 'h' : 'm') + (d.c || '');
      let l = this.morts.get(cle);
      if (!l) {
        const L = d.k === 'cheval' ? attelage(t) : pieton(t, R.H), robe = t.chevaux?.[0] || 0x6b4a2c;
        if (d.k === 'cheval') for (const [fx, fz] of JC) greffer(L, jambeCheval(robe), fx, 0.86, fz);
        else for (const c of [-1, 1]) greffer(L, jambe(t.culotte || BLANC, guetre(t)), 0, 0.84, c * 0.08);
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
