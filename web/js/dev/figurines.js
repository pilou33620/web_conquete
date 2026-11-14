// Figurines « douces » des maquettes (carte-douce.html, bataille-douce.html) : soldats du XVIIIe siècle en volumes simples,
// couleurs par sommet, une géométrie fusionnée par sorte de figurine (pour des InstancedMesh).
// Repère : la figurine regarde vers +x, y vers le haut, en mètres (un homme : 1,75 m).
import * as THREE from 'three';

const CHAIR = 0xf2c9a2, BLANC = 0xf4f1e6, BLANC2 = 0xe6dfcb, CHAMOIS = 0xe3cf9f, NOIR = 0x262321, CUIR = 0x6e4a2c, BOIS = 0x7a5233,
  FER = 0x8d9196, BRONZE = 0xc9933c, OR = 0xe8b94a, POUDRE = 0xe9e5dc, AFFUT = 0x5f6b52;
export const ROBES = [0x7a4a2a, 0x9a5a30, 0x3a2c24, 0xb8b2a6, 0x5e4030];   // bai, alezan, noir, gris, bai brun

const BOX = new THREE.BoxGeometry(1, 1, 1), SPH = new THREE.IcosahedronGeometry(.5, 1), SPH0 = new THREE.IcosahedronGeometry(.5, 0),   // SPH0 : petites pièces, moins de sommets
  CYL = new THREE.CylinderGeometry(.5, .5, 1, 10),
  TRI = new THREE.CylinderGeometry(.5, .5, 1, 3), BONNET = new THREE.CylinderGeometry(.42, .5, 1, 10), FUT = new THREE.CylinderGeometry(.3, .5, 1, 10),
  ROUE = new THREE.CylinderGeometry(.5, .5, 1, 16), JANTE = new THREE.TorusGeometry(.47, .045, 6, 18);
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();

class Fig {
  constructor() { this.P = []; this.N = []; this.C = []; this.J = []; this.jambe = [0, 0]; }   // jambe : (sens, hauteur du pivot) des pièces qui marchent
  // une pièce : géométrie de base, couleur, position, échelle (sx, sy, sz), rotation (rx, ry, rz)
  p(geo, col, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)));
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = new THREE.Color(col);
    for (let i = 0; i < p.length; i += 3) { this.P.push(p[i], p[i + 1], p[i + 2]); this.N.push(n[i], n[i + 1], n[i + 2]); this.C.push(c.r, c.g, c.b); this.J.push(...this.jambe); }
    g.dispose(); return this;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aJambe', new THREE.Float32BufferAttribute(this.J, 2));
    g.computeBoundingSphere(); return g;
  }
}

// --- morceaux
function tete(f, y, coiffe, dx = 0) {
  f.p(BOX, NOIR, dx, y - .14, 0, .13, .06, .14)                            // col noir
    .p(SPH, CHAIR, dx + .01, y, 0, .27, .29, .26)
    .p(SPH, POUDRE, dx - .05, y + .02, 0, .22, .24, .27)                    // perruque poudrée
    .p(BOX, POUDRE, dx - .13, y - .07, 0, .05, .16, .06).p(BOX, NOIR, dx - .14, y - .02, 0, .055, .04, .065);   // queue et ruban
  const h = y + .13;
  if (coiffe === 'bonnet') f.p(BONNET, NOIR, dx, h + .16, 0, .3, .4, .3).p(BOX, OR, dx + .14, h + .08, 0, .02, .16, .14);
  else if (coiffe === 'bicorne') f.p(BOX, NOIR, dx, h + .06, 0, .13, .2, .5).p(SPH, NOIR, dx, h, 0, .26, .14, .26).p(SPH0, BLANC, dx + .06, h + .08, .12, .07, .07, .03);
  else if (coiffe === 'rond') f.p(CYL, 0x4a3828, dx, h - .02, 0, .5, .03, .5).p(CYL, 0x4a3828, dx, h + .05, 0, .25, .14, .25);
  else f.p(TRI, BLANC, dx, h - .03, 0, .58, .02, .58, 0, Math.PI / 2).p(TRI, NOIR, dx, h, 0, .55, .07, .55, 0, Math.PI / 2)   // tricorne galonné
    .p(CYL, NOIR, dx - .01, h + .05, 0, .24, .12, .24).p(SPH0, BLANC, dx + .15, h + .03, .1, .05, .05, .03);
}
function corps(f, coat, y0 = 0) {
  f.jambe = [1, y0 + .55]; f.p(BOX, NOIR, .03, y0 + .04, .1, .24, .08, .12).p(BOX, BLANC, 0, y0 + .3, .1, .13, .44, .13);    // soulier et guêtre
  f.jambe = [-1, y0 + .55]; f.p(BOX, NOIR, .03, y0 + .04, -.1, .24, .08, .12).p(BOX, BLANC, 0, y0 + .3, -.1, .13, .44, .13);
  f.jambe = [0, 0]; f
    .p(BOX, BLANC2, 0, y0 + .6, 0, .2, .2, .34)                                                                // culotte
    .p(BOX, coat, -.02, y0 + .62, 0, .3, .34, .42).p(BOX, BLANC, -.17, y0 + .58, .11, .03, .28, .14).p(BOX, BLANC, -.17, y0 + .58, -.11, .03, .28, .14)   // basques et retroussis
    .p(BOX, coat, 0, y0 + 1.0, 0, .28, .44, .38)                                                               // habit
    .p(BOX, CHAMOIS, .14, y0 + .88, 0, .02, .44, .15)                                                          // veste
    .p(BOX, BLANC, .145, y0 + 1.06, .1, .02, .3, .05).p(BOX, BLANC, .145, y0 + 1.06, -.1, .02, .3, .05)       // revers
    .p(BOX, BLANC, .152, y0 + .98, 0, .02, .62, .045, .58).p(BOX, BLANC, .152, y0 + .98, 0, .02, .62, .045, -.58)   // buffleteries croisées
    .p(BOX, NOIR, -.17, y0 + .8, 0, .08, .14, .24)                                                            // giberne
    .p(BOX, 0xb89a6a, -.18, y0 + 1.04, 0, .1, .22, .26);                                                      // havresac
}
function bras(f, coat, cote, y0 = 0, dx = 0) {   // bras le long du corps ; cote = +1 (droite) ou −1 (gauche)
  const z = .245 * cote;
  f.p(BOX, coat, dx, y0 + .98, z, .11, .42, .11).p(BOX, BLANC, dx, y0 + .79, z * 1.02, .13, .09, .13).p(SPH0, CHAIR, dx + .01, y0 + .71, z * 1.03, .12, .12, .12);
}
function fusil(f, x, y, z) {
  f.p(BOX, BOIS, x, y + .2, z, .07, .4, .05).p(BOX, FER, x, y + .8, z, .035, .9, .035).p(BOX, FER, x, y + 1.36, z, .015, .26, .015);
}

// --- figurines
function fantassin(coat, coiffe, arme) {
  const f = new Fig(); corps(f, coat); bras(f, coat, -1);
  if (arme === 'drapeau') {
    bras(f, coat, 1, 0, .06);
    f.p(CYL, BOIS, .1, 1.35, .3, .05, 2.7, .05).p(SPH0, OR, .1, 2.74, .3, .08, .14, .08)
      .p(BOX, coat, .1, 2.3, .82, .02, .74, 1.02).p(BOX, BLANC, .1, 2.3, .82, .026, .13, 1.02).p(BOX, BLANC, .1, 2.3, .82, .026, .74, .13);   // drapeau d'ordonnance : croix blanche
  } else if (arme === 'tambour') {
    bras(f, coat, 1, 0, .08);
    f.p(CYL, BLANC, .16, .74, -.1, .3, .22, .3, Math.PI / 2 - .3).p(CYL, coat, .16, .74, -.1, .31, .06, .31, Math.PI / 2 - .3)
      .p(BOX, BOIS, .2, .9, .02, .02, .26, .02, .6).p(BOX, BOIS, .22, .9, -.2, .02, .26, .02, -.6);
  } else if (arme === 'epee') {   // officier : hausse-col doré, écharpe, épée levée
    f.p(BOX, OR, .15, 1.18, 0, .02, .07, .14).p(BOX, OR, .15, .86, 0, .03, .07, .4, .5);
    f.p(BOX, coat, .04, 1.1, .25, .11, .3, .11, 0, 0, -.9).p(SPH0, CHAIR, .18, 1.22, .26, .11, .11, .11).p(BOX, FER, .3, 1.55, .27, .02, .75, .03, 0, 0, -.35).p(BOX, OR, .2, 1.2, .27, .04, .03, .12);
  } else if (arme === 'refouloir') {
    bras(f, coat, 1); f.p(CYL, BOIS, .3, 1.05, .3, .04, 2.2, .04, 0, 0, -.75).p(CYL, NOIR, 1.05, 1.82, .3, .1, .22, .1, 0, 0, -.75);
  } else { bras(f, coat, 1); fusil(f, .04, .5, .3); }
  tete(f, 1.39, coiffe);
  return f.geo();
}
function cheval(f, robe, coat) {
  const crin = new THREE.Color(robe).multiplyScalar(.45).getHex();
  f.p(SPH, robe, 0, 1.06, 0, 1.15, .56, .46).p(SPH, robe, .38, 1.1, 0, .55, .56, .44).p(SPH, robe, -.38, 1.1, 0, .6, .56, .46)
    .p(BOX, robe, .58, 1.42, 0, .22, .58, .2, 0, 0, -.55).p(BOX, robe, .84, 1.62, 0, .42, .17, .17, 0, 0, -.75).p(BOX, crin, .97, 1.5, 0, .14, .13, .15, 0, 0, -.75)
    .p(BOX, robe, .72, 1.8, .05, .04, .1, .04).p(BOX, robe, .72, 1.8, -.05, .04, .1, .04)
    .p(BOX, crin, .52, 1.5, 0, .06, .5, .05, 0, 0, -.55).p(BOX, crin, -.68, .95, 0, .08, .48, .08, 0, 0, .35);
  for (const [x, z] of [[.4, .13], [.4, -.13], [-.4, .13], [-.4, -.13]]) { f.jambe = [Math.sign(x * z), .75]; f.p(BOX, robe, x, .42, z, .09, .64, .09).p(BOX, NOIR, x + .01, .035, z, .1, .07, .1); }   // au trot : jambes en diagonale
  f.jambe = [0, 0];
  f.p(BOX, coat, -.04, 1.33, 0, .58, .07, .66).p(BOX, BLANC, -.04, 1.3, 0, .6, .04, .68);   // tapis de selle
}
function cavalier(coat, coiffe, robe, general) {
  const f = new Fig(); cheval(f, robe, coat);
  f.p(BOX, BLANC2, .06, 1.43, .17, .38, .12, .12).p(BOX, BLANC2, .06, 1.43, -.17, .38, .12, .12)
    .p(BOX, NOIR, .14, 1.15, .22, .13, .5, .13).p(BOX, NOIR, .14, 1.15, -.22, .13, .5, .13)                  // bottes
    .p(BOX, coat, -.1, 1.5, 0, .2, .24, .4).p(BOX, coat, -.02, 1.7, 0, .27, .42, .36)
    .p(BOX, BLANC, .125, 1.72, .09, .02, .3, .05).p(BOX, BLANC, .125, 1.72, -.09, .02, .3, .05)
    .p(BOX, coat, .06, 1.66, -.24, .26, .1, .1, 0, 0, -.4).p(SPH0, CHAIR, .2, 1.62, -.24, .11, .11, .11);     // bras gauche aux rênes
  if (general) {
    f.p(BOX, OR, .14, 1.62, 0, .03, .08, .42, .5).p(BOX, OR, -.02, 1.92, .2, .12, .04, .1).p(BOX, OR, -.02, 1.92, -.2, .12, .04, .1)
      .p(BOX, coat, .06, 1.78, .25, .11, .3, .11, 0, 0, -.6).p(SPH0, CHAIR, .18, 1.9, .26, .11, .11, .11).p(BOX, 0x2a2a2a, .3, 1.98, .26, .05, .05, .26);   // lunette
    tete(f, 2.06, coiffe, -.02); f.p(SPH, BLANC, -.04, 2.33, 0, .16, .2, .14);                               // plumet
  } else {
    f.p(BOX, coat, .03, 1.82, .25, .11, .32, .11, 0, 0, -.5).p(SPH0, CHAIR, .13, 1.98, .26, .11, .11, .11).p(BOX, FER, .26, 2.32, .27, .025, .78, .03, 0, 0, -.42);   // sabre levé
    tete(f, 2.06, coiffe === 'bonnet' ? 'tricorne' : coiffe, -.02);
  }
  return f.geo();
}
function canon() {
  const f = new Fig();
  for (const z of [.44, -.44]) {
    f.p(ROUE, BOIS, 0, .5, z, .96, .07, .96, Math.PI / 2).p(JANTE, FER, 0, .5, z * 1.06, 1, 1, 1).p(CYL, FER, 0, .5, z, .18, .22, .18, Math.PI / 2);
    for (let k = 0; k < 4; k++) f.p(BOX, BOIS, 0, .5, z * 1.02, .04, .86, .03, 0, 0, k * Math.PI / 4);
  }
  f.p(BOX, AFFUT, -.42, .56, .15, 1.45, .22, .08, 0, 0, .28).p(BOX, AFFUT, -.42, .56, -.15, 1.45, .22, .08, 0, 0, .28)
    .p(BOX, AFFUT, 0, .5, 0, .12, .1, .82).p(BOX, AFFUT, -1.1, .2, 0, .3, .1, .36).p(BOX, FER, -1.2, .27, 0, .06, .08, .3)
    .p(FUT, BRONZE, .32, .8, 0, .26, 1.5, .26, 0, 0, -Math.PI / 2 + .04).p(CYL, BRONZE, 1.06, .83, 0, .25, .07, .25, 0, 0, -Math.PI / 2).p(SPH0, BRONZE, -.46, .78, 0, .16, .16, .16)
    .p(BOX, BRONZE, .2, .8, .13, .1, .04, .05).p(BOX, BRONZE, .2, .8, -.13, .1, .04, .05);
  return f.geo();
}
function chariot() {
  const f = new Fig();
  f.p(BOX, 0x9c7a52, 0, .95, 0, 2.2, .5, 1.1).p(CYL, BLANC2, 0, 1.25, 0, 1.1, 2.2, .9, 0, 0, Math.PI / 2).p(BOX, 0x9c7a52, 1.5, .7, 0, 1.1, .06, .08);
  for (const x of [-.7, .7]) for (const z of [.6, -.6]) f.p(ROUE, BOIS, x, .45, z, .86, .08, .86, Math.PI / 2).p(JANTE, FER, x, .45, z * 1.04, .9, .9, .9);
  return f.geo();
}

// cache : une géométrie par sorte et par couleur d'habit
const CACHE = new Map();
export function figurine(sorte, coat = 0xc0392b, coiffe = 'tricorne', robe = ROBES[0]) {
  const c = new THREE.Color(coat).getHex(), k = [sorte, c, coiffe, robe].join('|');
  if (!CACHE.has(k)) CACHE.set(k,
    sorte === 'cavalier' ? cavalier(c, coiffe, robe, false) : sorte === 'general' ? cavalier(c, coiffe, robe, true) :
    sorte === 'canon' ? canon() : sorte === 'chariot' ? chariot() :
    fantassin(c, coiffe, { fusilier: 'fusil', grenadier: 'fusil', drapeau: 'drapeau', tambour: 'tambour', officier: 'epee', artilleur: 'refouloir' }[sorte] || 'fusil'));
  return CACHE.get(k);
}
// coiffure selon l'époque : tricorne jusqu'aux années 1780, bicorne ensuite ; bonnet à poil des grenadiers
export const coiffeDe = (annee, type) => type === 'grenadiers' || type === 'sapeurs' ? 'bonnet' : type === 'milice' ? 'rond' : annee < 1786 ? 'tricorne' : 'bicorne';
export const MAT_FIG = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: 0 });
// les jambes balancent autour de la hanche selon aPas (phase, amplitude) de chaque instance ; sans aPas (amplitude 0), la figurine reste immobile
MAT_FIG.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aJambe;\nattribute vec2 aPas;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
    if (aJambe.x != 0.0) {
      float an = aJambe.x * sin(aPas.x) * aPas.y, co = cos(an), si = sin(an);
      vec2 p = vec2(transformed.x, transformed.y - aJambe.y);
      transformed.xy = vec2(p.x * co - p.y * si, p.x * si + p.y * co + aJambe.y);
    }`);
};
