// Les modèles du plateau (SPEC-HEX.md), en unités du plateau (un hexagone : rayon 10, comme web_power) : maisons à la
// manière de chaque pays (pierre blonde et tuiles du Bordelais, pierre ocre et toits bruns pentus du Périgord,
// colombages des Landes, brique de l'Agenais, murs blancs, volets rouges et ardoise du Béarn), avec portes, fenêtres,
// volets, cheminées ; églises romanes ou clocher-mur béarnais, cathédrale gothique, halle de bastide, château, moulins,
// enceintes selon le niveau des remparts (mur à tours, remparts épais, tracé bastionné, Vauban), quais et barques,
// arbres. Les fenêtres et les portes sont des plaques sans contour : peu de sommets pour beaucoup de détail.
import { THREE, put, lot, fige, transfere, boite, cyl, cone, sphere, toit, pavillon, rnd, entre, choix, semer, SQ3 } from './moteur.js';

// murs, toits, volets, pente des toits ; repris de towns.js (STYLE) et complétés
export const STYLES = {
  '33': { murs: [0xefe4c8, 0xe8dab8, 0xf3ead6, 0xe3d2ad], toits: [0xb4513a, 0xc0623e, 0xa9472f, 0xb85a3c], pente: 0.5, volets: [0x7d8f9a, 0xe9e2cf, 0x6d8b74] },
  '24': { murs: [0xead39b, 0xe2c98a, 0xefdcaa, 0xdcc184], toits: [0x7a4a33, 0x8a5638, 0x6e4030, 0x80503a], pente: 0.95, volets: [0x7a5a3a, 0x6d7f5a] },
  '40': { murs: [0xf3ede1, 0xefe7d8, 0xf6f1e6], toits: [0xb8603f, 0xa8573a, 0xc06a48], pente: 0.45, bois: 0x6b4a2e, volets: [0x2f6b4a, 0x8c2f24] },
  '47': { murs: [0xe8c7a6, 0xdcb08e, 0xefd2b4, 0xe4bd98], toits: [0xb5532f, 0xc4643a, 0xa94a2a], pente: 0.42, volets: [0x6d8b9a, 0x9a8a6a] },
  '64': { murs: [0xf7f4ee, 0xffffff, 0xf2eee6], toits: [0x5a6070, 0x4c5262, 0x666c7a], pente: 0.85, bois: 0x8c2f24, volets: [0x8c2f24, 0x2f5a3a] },
};
// (toute la France, SPEC-FRANCE.md) les grandes régions : murs, toits, pente, pans de bois, volets
Object.assign(STYLES, {
  nord: { murs: [0xa85a40, 0xb4664a, 0x9c5038, 0xc07656], toits: [0x5d5552, 0x6a5f58, 0x8a4a36], pente: 0.75, volets: [0xe9e2cf, 0x3f5a46] },
  normandie: { murs: [0xf3ecdc, 0xefe6d2, 0xf6f1e4], toits: [0x5b5866, 0x8f7a52, 0x6a6672], pente: 1.0, bois: 0x5a3a24, volets: [0x6b3a2a, 0x3f5a46] },
  bretagne: { murs: [0xb8b2a6, 0xc4beb2, 0xaaa498], toits: [0x4f5562, 0x5a6070, 0x464c58], pente: 0.95, volets: [0x2f5f8a, 0xe9e2cf] },
  loire: { murs: [0xf4efe2, 0xefe9da, 0xf8f4ea], toits: [0x5b6170, 0x525866, 0x666c7a], pente: 0.95, volets: [0xe9e2cf, 0x7d8f9a] },
  alsace: { murs: [0xf0d9a0, 0xe7b9a0, 0xc9d9e3, 0xf2e6c8], toits: [0xa0472f, 0xb05236, 0x943f2a], pente: 1.25, bois: 0x5e3b24, volets: [0x3f6a46, 0x8c2f24] },
  lorraine: { murs: [0xe2d4b6, 0xd9c9a8, 0xe8dcc2], toits: [0xb05a40, 0xa65238, 0xbc6648], pente: 0.42, volets: [0x7a6a4a, 0x6d7f8a] },
  bourgogne: { murs: [0xdcc8a0, 0xd2bc92, 0xe4d2ae], toits: [0x9a5a3a, 0x7e4a30, 0xb8763e], pente: 1.0, volets: [0x7a5a3a, 0x5a6a4a] },
  alpes: { murs: [0xcfc6b5, 0xd8d0c0, 0xc4baa8], toits: [0x6e6a66, 0x5e5a56, 0x7a746c], pente: 0.8, bois: 0x6b4a2e, volets: [0x6b4a2e, 0x3f5a46] },
  provence: { murs: [0xe8c58a, 0xf0d6a8, 0xe2b878, 0xf2dcb4], toits: [0xc7643f, 0xd0724a, 0xbc5a38], pente: 0.33, volets: [0x5a8a9a, 0x7a9a5a, 0x9a6a8a] },
  auvergne: { murs: [0x9a9184, 0xa69e90, 0x8e8578], toits: [0x5a5550, 0x4e4a46, 0x66605a], pente: 0.95, volets: [0x6b4a2e, 0x5a6a4a] },
  charentes: { murs: [0xf1ead8, 0xece3ce, 0xf5efe0], toits: [0xbf6a45, 0xc87650, 0xb4603c], pente: 0.35, volets: [0x7d9aa6, 0x9ab08a] },
  toulouse: { murs: [0xd99a7a, 0xcf8c6a, 0xe2a888], toits: [0xb5583a, 0xc0623e, 0xa94a2f], pente: 0.4, volets: [0x6d8b9a, 0x9a8a6a] },
});
const REGION = {};
for (const [r, cs] of Object.entries({
  nord: '59 62 80 02 60', normandie: '76 27 14 50 61', bretagne: '29 22 56 35', alsace: '67 68',
  loire: '75 78 77 28 45 41 37 18 36 49 72 53 44 85', lorraine: '57 54 55 88 51 52 10 08',
  bourgogne: '21 71 58 89 25 39 70', alpes: '69 01 38 42 73 74 26 07 05', provence: '13 83 84 06 04 30 34 11 66 20',
  auvergne: '63 15 43 48 12 19 23 87 03', charentes: '79 86 16 17', toulouse: '31 32 82 81 46 09 65',
})) for (const c of cs.split(' ')) REGION[c] = r;
export const style = d => STYLES[d] || STYLES[REGION[d]] || STYLES['33'];
const VITRE = 0x3d4a5a, PORTE = 0x5a3a24, PIERRE = 0xd9ccb0, PIERRE2 = 0xc9bb98, ARDOISE = 0x5b5866, BRIQUE = 0xa8573a, BOIS = 0x7a5233;

// une plaque (fenêtre, porte, poutre) plaquée contre une façade : centre (x, y, z), normale tournée de a autour de y
function plaque(L, w, h, col, x, y, z, a) {
  const p = new THREE.PlaneGeometry(w, h); p.rotateY(a); put(L, p, col, x, y, z, 0, 0);
}
// détails d'une façade de largeur w, au repère local (avant vers +z), à la distance d/2 du centre, tournée de a
function facade(L, st, w, d, h, etages, a, porte, colomb) {
  const ca = Math.cos(a), sa = Math.sin(a), o = d / 2 + 0.03;
  const at = (u, v) => [ca * u + sa * o, v, -sa * u + ca * o];   // u le long de la façade, v en hauteur
  const nf = Math.max(1, Math.round(w / 1.1)), vol = st.volets ? choix(st.volets) : null;
  for (let e = 0; e < etages; e++) for (let k = 0; k < nf; k++) {
    const u = (k + 0.5 - nf / 2) * (w / nf), v = (e + 0.58) * (h / etages);
    if (porte && e === 0 && k === (nf >> 1)) { const [x, y, z] = at(u, 0.48 * Math.min(1.6, h / etages)); plaque(L, 0.46, 0.95, PORTE, x, y, z, a); continue; }
    const [x, y, z] = at(u, v); plaque(L, 0.34, 0.44, VITRE, x, y, z, a);
    if (vol) { for (const s of [-1, 1]) { const [vx, vy, vz] = at(u + s * 0.26, v); plaque(L, 0.15, 0.46, vol, vx + ca * 0.005, vy, vz - sa * 0.005, a); } }
  }
  if (colomb) {   // pans de bois : poteaux, sablières, écharpes
    for (let k = 0; k <= nf; k++) { const [x, y, z] = at((k / nf - 0.5) * w, h / 2); plaque(L, 0.09, h, colomb, x, y, z, a); }
    for (let e = 1; e <= etages; e++) { const [x, y, z] = at(0, e * h / etages - 0.05); plaque(L, w, 0.09, colomb, x, y, z, a); }
  }
}
// une maison : s l'échelle, etages (1 à 3), au repère local (façade principale vers +z) puis tournée de ry
export function maison(L, st, x, z, ry, { s = 1, etages = 1, w = 2.4, d = 2.0, details = true, col, toitCol } = {}) {
  const M = lot(), hh = 1.25 * etages, pente = st.pente, mur = col ?? choix(st.murs), tc = toitCol ?? choix(st.toits);
  put(M, boite(w, hh, d), mur, 0, hh / 2, 0, 0, 0.12);
  // toit : le faîtage dans le sens de la longueur ; les pays de pente forte (Périgord, Béarn) ont des toits hauts
  toit(M, d + 0.25, w + 0.3, d * pente * 0.6 + 0.35, tc, 0, hh, 0, Math.PI / 2, 0.12);
  if (details) {
    facade(M, st, w, d, hh, etages, 0, true, st.bois && rnd() < 0.7 ? st.bois : null);
    facade(M, st, d, w, hh, etages, Math.PI / 2, false, null);
    facade(M, st, d, w, hh, etages, -Math.PI / 2, false, null);
    if (rnd() < 0.8) put(M, boite(0.32, 0.9, 0.32), rnd() < 0.5 ? PIERRE2 : BRIQUE, w * 0.28, hh + w * pente * 0.35 + 0.25, -d * 0.18, 0, 0.08);
  }
  transfere(M, L, x, 0, z, ry, s);
}
// église : nef, chevet, clocher (flèche d'ardoise) ; en Béarn et au Pays basque, un clocher-mur ou un clocher-porche
export function eglise(L, st, x, z, ry, s = 1, dept = '33') {
  const M = lot(), mur = dept === '64' ? 0xf2eee6 : PIERRE, tc = dept === '64' ? ARDOISE : choix(st.toits);
  put(M, boite(2.4, 2.4, 5.2), mur, 0, 1.2, 0, 0, 0.14);
  toit(M, 2.8, 5.4, 1.6, tc, 0, 2.4, 0, 0, 0.12);
  const ab = cyl(1.2, 1.2, 2.2, 10, 1, false); put(M, ab, mur, 0, 1.1, -2.6, 0, 0.12);
  const ca = cone(1.35, 1.1, 10); put(M, ca, tc, 0, 2.75, -2.6, 0, 0.1);
  plaque(M, 0.8, 1.3, PORTE, 0, 0.66, dept === '64' ? 2.68 : 2.78, 0);
  if (dept === '64') put(M, new THREE.CircleGeometry(0.36, 12), VITRE, 0, 1.75, 2.63, 0, 0);
  for (const zz of [-1.2, 0.4, 1.8]) for (const sx of [-1, 1]) plaque(M, 0.3, 0.8, VITRE, sx * 1.23, 1.4, zz, sx * Math.PI / 2);
  if (dept === '64') {   // clocher-mur à baies
    put(M, boite(2.4, 2.6, 0.5), mur, 0, 3.6 + 0.3, 2.4, 0, 0.12);
    for (const u of [-0.55, 0.55]) plaque(M, 0.42, 0.7, 0x2a2522, u, 4.1, 2.66, 0);
    toit(M, 0.8, 2.6, 0.6, tc, 0, 4.9 + 0.3, 2.4, Math.PI / 2, 0.1);
  } else {
    put(M, boite(1.5, 4.4, 1.5), mur, 0, 2.2, 2.0, 0, 0.14);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) plaque(M, 0.4, 0.7, 0x2a2522, Math.sin(a) * 0.77, 3.7, 2.0 + Math.cos(a) * 0.77, a);
    put(M, cone(1.1, dept === '24' ? 1.6 : 2.6, 4), dept === '24' ? choix(st.toits) : ARDOISE, 0, 4.4 + (dept === '24' ? 0.8 : 1.3), 2.0, Math.PI / 4, 0.1);
  }
  transfere(M, L, x, 0, z, ry, s);
}
// cathédrale gothique : nef haute et bas-côtés, contreforts, deux tours de façade, flèche à la croisée, rose
export function cathedrale(L, x, z, ry, s = 1) {
  const M = lot();
  put(M, boite(3.6, 4.6, 10), 0xeee3c8, 0, 2.3, 0, 0, 0.16); toit(M, 4, 10.2, 2.2, ARDOISE, 0, 4.6, 0, 0, 0.14);
  for (const sx of [-1, 1]) {
    put(M, boite(1.6, 2.6, 9), 0xe6d9bb, sx * 2.6, 1.3, 0, 0, 0.14); toit(M, 1.9, 9.2, 0.8, ARDOISE, sx * 2.6, 2.6, 0, 0, 0.1);
    for (let k = -3; k <= 3; k++) { const b = boite(0.4, 3.4, 0.5); b.rotateZ(sx * 0.25); put(M, b, 0xd9ccb0, sx * 3.5, 1.9, k * 1.35, 0, 0.08); plaque(M, 0.42, 1.4, VITRE, sx * 1.81, 3.3, k * 1.35 + 0.6, sx * Math.PI / 2); }
  }
  put(M, boite(6.6, 3.2, 3.2), 0xeee3c8, 0, 1.6, -3.2, 0, 0.14); toit(M, 3.4, 6.8, 1.6, ARDOISE, 0, 3.2, -3.2, Math.PI / 2, 0.12);   // transept
  const chev = cyl(1.8, 1.8, 4, 12, 1, false); put(M, chev, 0xeee3c8, 0, 2, -5.6, 0, 0.14); put(M, cone(2, 1.6, 12), ARDOISE, 0, 4.8, -5.6, 0, 0.12);
  for (const sx of [-1, 1]) {
    put(M, boite(2, 8, 2), 0xeee3c8, sx * 1.5, 4, 5.4, 0, 0.16);
    for (let e = 0; e < 3; e++) plaque(M, 0.5, 1.2, VITRE, sx * 1.5, 2.4 + e * 2.2, 6.43, 0);
    put(M, cone(1.3, 3.4, 4), ARDOISE, sx * 1.5, 9.7, 5.4, Math.PI / 4, 0.12);
  }
  put(M, new THREE.CircleGeometry(0.95, 16), 0x4a5a80, 0, 4.6, 5.03, 0, 0);
  for (const u of [-1.5, 0, 1.5]) plaque(M, 0.9, 1.8, PORTE, u, 0.9, 6.43 - (u ? 0 : 1.42), 0);
  put(M, boite(0.9, 1.6, 0.9), 0xeee3c8, 0, 6.2, -3.2, 0, 0.1); put(M, cone(0.7, 3.6, 8), ARDOISE, 0, 8.8, -3.2, 0, 0.1);
  transfere(M, L, x, 0, z, ry, s);
}
// halle de bastide : un grand toit sur des piliers de pierre
export function halle(L, st, x, z, ry, s = 1) {
  const M = lot();
  for (const u of [-2.4, -0.8, 0.8, 2.4]) for (const v of [-1.4, 1.4]) put(M, boite(0.42, 1.8, 0.42), PIERRE, u, 0.9, v, 0, 0.08);
  put(M, boite(5.6, 0.3, 3.4), BOIS, 0, 1.9, 0, 0, 0.08);
  pavillon(M, 6.6, 4.4, 2, choix(st.toits), 0, 2, 0, 0, 0.12);
  transfere(M, L, x, 0, z, ry, s);
}
// château : donjon et tours rondes coiffées de poivrières, courtines
export function chateau(L, st, x, z, ry, s = 1) {
  const M = lot();
  put(M, boite(3, 5.4, 3), PIERRE, 0, 2.7, 0, 0, 0.14); toit(M, 3.3, 3.3, 1.6, ARDOISE, 0, 5.4, 0, 0, 0.12);
  for (let k = 0; k < 2; k++) plaque(M, 0.4, 0.6, VITRE, 0, 2 + k * 1.7, 1.53, 0);
  for (const [u, v] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { put(M, cyl(0.9, 1, 4, 10), PIERRE, u, 2, v, 0, 0.12); put(M, cone(1.15, 2, 10), ARDOISE, u, 5, v, 0, 0.1); }
  for (const [u, v, a] of [[0, -3, 0], [0, 3, 0], [-3, 0, Math.PI / 2], [3, 0, Math.PI / 2]]) put(M, boite(6, 2.4, 0.6), PIERRE2, u, 1.2, v, a, 0.1);
  plaque(M, 1, 1.4, PORTE, 0, 0.7, 3.31, 0);
  transfere(M, L, x, 0, z, ry, s);
}
// moulin à vent : tour ronde, chapeau, quatre ailes
// tournantes : un tableau où mettre les ailes, à part (un groupe à faire tourner, rotation.z) ; sinon elles sont figées
export function moulin(L, x, z, ry, s = 1, angle = 0.4, tournantes = null, y = 0) {
  const M = lot();
  put(M, cyl(0.95, 1.25, 3.4, 10), 0xeee6d2, 0, 1.7, 0, 0, 0.12); put(M, cone(1.2, 1.2, 10), 0x6e4a30, 0, 4, 0, 0, 0.1);
  plaque(M, 0.5, 0.9, PORTE, 0, 0.45, 1.26, 0);
  const A = tournantes ? lot() : M;
  for (let k = 0; k < 4; k++) { const b = boite(0.5, 2.6, 0.06); b.translate(0, 1.4, 0); b.rotateZ(angle + k * Math.PI / 2); put(A, b, 0xf2ead8, 0, tournantes ? 0 : 3.3, tournantes ? 0 : 1.3, 0, 0.06); }
  transfere(M, L, x, y, z, ry, s);
  if (tournantes) {
    const grp = fige(A, null); grp.scale.setScalar(s); grp.rotation.y = ry; grp.userData.ph = angle;
    grp.position.set(x + Math.sin(ry) * 1.3 * s, y + 3.3 * s, z + Math.cos(ry) * 1.3 * s); tournantes.push(grp);
  }
}
// arbres : feuillu, pin maritime (tronc nu, houppier plat), sapin, peuplier, fruitier
export function arbre(L, x, y, z, s = 1, sorte = 'feuillu', teinte) {
  if (sorte === 'pin') { put(L, cyl(0.22 * s, 0.32 * s, 3.4 * s, 5), 0x8a5a3a, x, y + 1.7 * s, z); const p = sphere(1.7 * s, 0); p.scale(1, 0.45, 1); put(L, p, teinte ?? choix([0x4f7d3a, 0x5c8a40]), x, y + 3.7 * s, z); return; }
  if (sorte === 'sapin') { put(L, cyl(0.3 * s, 0.4 * s, 1.4 * s, 5), BOIS, x, y + 0.7 * s, z); put(L, cone(1.9 * s, 3 * s, 6), teinte ?? 0x3e7f34, x, y + 2.6 * s, z); put(L, cone(1.4 * s, 2.4 * s, 6), 0x4c9440, x, y + 4 * s, z); return; }
  if (sorte === 'peuplier') { put(L, cyl(0.18 * s, 0.24 * s, 1.2 * s, 5), BOIS, x, y + 0.6 * s, z); const p = sphere(0.9 * s, 0); p.scale(1, 2.6, 1); put(L, p, teinte ?? 0x6aa844, x, y + 3 * s, z); return; }
  if (sorte === 'fruitier') { put(L, cyl(0.18 * s, 0.24 * s, 1 * s, 5), BOIS, x, y + 0.5 * s, z); put(L, sphere(1.1 * s, 0), teinte ?? 0x6fb447, x, y + 1.5 * s, z); return; }
  put(L, cyl(0.3 * s, 0.4 * s, 1.4 * s, 5), BOIS, x, y + 0.7 * s, z);
  put(L, sphere(1.9 * s, 0), teinte ?? choix([0x5fae3e, 0x74b83f, 0x4f9a37]), x, y + 2.9 * s, z);
}
// barque (gabare de la Garonne, pinasse d'Arcachon) : coque, mât, voile
export function barque(L, x, y, z, ry, s = 1, voile = true) {
  const M = lot(), c = boite(1.1, 0.5, 3.4); put(M, c, 0x6b4a30, 0, 0.25, 0, 0, 0.08);
  put(M, cone(0.55, 1, 4), 0x6b4a30, 0, 0.25, 2.1, 0, 0.06);
  if (voile) { put(M, cyl(0.06, 0.06, 3, 5), BOIS, 0, 1.6, 0.3, 0, 0); put(M, boite(0.05, 1.8, 1.6), 0xefe6cf, 0, 1.9, -0.3, 0, 0.05); }
  transfere(M, L, x, y, z, ry, s);
}
// fanion aux couleurs d'un camp : hampe et étoffe
export function fanion(L, col, x, y, z, h = 7) {
  put(L, cyl(0.12, 0.15, h, 6), BOIS, x, y + h / 2, z, 0, 0.1);
  put(L, boite(2.6, 1.6, 0.14), col, x + 1.35, y + h - 0.9, z, 0, 0.12);
}

// ------------------------------------------------------------------ enceintes
// enceinte en anneau de rayon rad autour de (0, 0) selon le niveau des remparts (1 à 4) ; portes tournées vers `portes`
// (angles des routes qui entrent). 1 : mur et tours rondes ; 2 : remparts épais, tours plus hautes ; 3 : tracé bastionné
// avec fossé ; 4 : bastions, demi-lunes et glacis à la Vauban.
export function enceinte(L, niveau, rad, portes = []) {
  const n = niveau >= 3 ? 5 + (rad > 12 ? 1 : 0) : 8, H = niveau >= 2 ? 1.9 : 1.4, ep = niveau >= 2 ? 1.1 : 0.7;
  const coins = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + Math.PI / n; return [Math.cos(a) * rad, Math.sin(a) * rad, a]; });
  const porteA = a => portes.some(p => Math.abs(Math.atan2(Math.sin(a - p), Math.cos(a - p))) < Math.PI / n * 0.55);
  if (niveau >= 3) {   // fossé (et glacis) : un anneau plus sombre au pied
    const fos = new THREE.RingGeometry(rad * 0.98, rad * (niveau >= 4 ? 1.42 : 1.26), n * 4); fos.rotateX(-Math.PI / 2);
    put(L, fos, niveau >= 4 ? 0x6f9a52 : 0x5f8a4a, 0, 0.04, 0, Math.PI / n, 0);
  }
  for (let i = 0; i < n; i++) {
    const [ax, az] = coins[i], [bx, bz] = coins[(i + 1) % n], l = Math.hypot(bx - ax, bz - az), a = -Math.atan2(bz - az, bx - ax);
    const mid = Math.atan2((az + bz) / 2, (ax + bx) / 2), mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (porteA(mid)) {   // la porte : deux tours de part et d'autre, un passage
      for (const k of [-1, 1]) { const px = mx + Math.cos(-a) * k * 1.4, pz = mz + Math.sin(-a) * k * 1.4; put(L, cyl(0.8, 0.9, H + 1.2, 8), PIERRE, px, (H + 1.2) / 2, pz, 0, 0.12); put(L, cone(1, 1.3, 8), ARDOISE, px, H + 1.85, pz, 0, 0.1); }
      const lm = l / 2 - 2.2, u = (l / 2 + 2.2) / 2;
      if (lm > 0.3) for (const k of [-1, 1]) put(L, boite(lm, H, ep), niveau >= 3 ? 0xcdb98c : PIERRE2, mx + Math.cos(-a) * k * u, H / 2, mz + Math.sin(-a) * k * u, a, 0.12);
    } else put(L, boite(l + 0.2, H, ep), niveau >= 3 ? 0xcdb98c : PIERRE2, mx, H / 2, mz, a, 0.14);
    if (niveau >= 3) {   // le bastion : une pointe de flèche au saillant, parapet gazonné
      const b = cone(2.4, H + 0.2, 4); put(L, b, 0xc4b083, ax * 1.06, (H + 0.2) / 2, az * 1.06, -coins[i][2] + Math.PI / 4, 0.14);
      put(L, boite(l + 0.2, 0.4, ep * 0.7), 0x8fae5a, mx, H + 0.2, mz, a, 0.08);
      if (niveau >= 4) { const dl = cone(1.8, H * 0.8, 3); put(L, dl, 0xc4b083, Math.cos(mid) * rad * 1.22, H * 0.4, Math.sin(mid) * rad * 1.22, -mid + Math.PI / 2, 0.12); }
    } else {
      put(L, cyl(0.85, 0.95, H + 0.9, 10), PIERRE, ax, (H + 0.9) / 2, az, 0, 0.12);
      if (niveau >= 2) put(L, cone(1.1, 1.4, 10), ARDOISE, ax, H + 1.6, az, 0, 0.1);
      else for (let k = 0; k < 4; k++) put(L, boite(0.3, 0.3, 0.3), PIERRE, ax + Math.cos(k * 1.57) * 0.7, H + 1.05, az + Math.sin(k * 1.57) * 0.7, 0, 0);   // merlons
    }
  }
}
// fort en étoile isolé (Fort Médoc, Fort de Socoa…) : cinq bastions, casernement, poudrière
export function fortEtoile(L, x, z, s = 1) {
  const M = lot(), sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 5 * i - Math.PI / 2, r = i % 2 ? 3.6 : 6.4; i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const trou = new THREE.Path(); for (let i = 0; i < 5; i++) { const a = Math.PI * 2 / 5 * i - Math.PI / 2; i ? trou.lineTo(Math.cos(a) * 2.6, Math.sin(a) * 2.6) : trou.moveTo(Math.cos(a) * 2.6, Math.sin(a) * 2.6); }
  sh.holes.push(trou);
  const e = new THREE.ExtrudeGeometry(sh, { depth: 1.7, bevelEnabled: false }); e.rotateX(-Math.PI / 2);
  put(M, e, 0xc2b38f, 0, 0, 0, 0, 0.16);
  const fos = new THREE.RingGeometry(6.2, 7.6, 30); fos.rotateX(-Math.PI / 2); put(M, fos, 0x5f8a4a, 0, 0.03, 0, 0, 0);
  put(M, cyl(2.7, 2.7, 0.2, 5), 0xa79a76, 0, 0.1, 0, 0, 0);
  put(M, boite(2.6, 1.4, 1.2), 0xe9dcc0, 0, 0.7, 0.4, 0, 0.1); toit(M, 1.4, 2.8, 0.9, ARDOISE, 0, 1.4, 0.4, Math.PI / 2, 0.1);
  plaque(M, 0.3, 0.6, PORTE, 0, 0.35, 1.03, 0); for (const u of [-0.8, 0.8]) plaque(M, 0.3, 0.35, VITRE, u, 0.8, 1.03, 0);
  put(M, boite(1, 0.8, 1), 0xb9ad8f, -1.4, 0.4, -1.2, 0, 0.08); pavillon(M, 1.2, 1.2, 0.7, ARDOISE, -1.4, 0.8, -1.2, 0, 0.08);
  transfere(M, L, x, 0, z, 0, s);
}
// quai de pierre le long d'une rive (longueur l, tourné de ry), avec des barques amarrées
export function quai(L, x, y, z, ry, l = 8, nb = 2) {
  const M = lot();
  put(M, boite(l, 0.5, 1.4), PIERRE2, 0, 0.25, 0, 0, 0.1);
  for (let k = 0; k < nb; k++) barque(M, (k + 0.5 - nb / 2) * (l / nb), -0.6, 1.6, Math.PI / 2 + entre(-0.15, 0.15), 0.9, rnd() < 0.6);
  for (let k = 0; k < 3; k++) put(M, boite(0.6, 0.6, 0.6), choix([0x9c7a52, 0x8a6a4a]), entre(-l / 2, l / 2), 0.8, entre(-0.4, 0.3), 0, 0.06);   // barriques
  transfere(M, L, x, y, z, ry);
}
export { semer, rnd, entre, choix, SQ3 };
