// La ville de près sur le plateau (SPEC-HEX.md) : son vrai plan, le même que celui de la carte d'avant
// (carte/plan-organique.js par carte/villes.js : îlots et rues le long des vraies routes et rivières, faubourgs,
// quartiers selon l'ère, enceinte des remparts), monté en maquette à l'échelle : sol des rues et des îlots, maisons à
// deux versants, toits plats, cheminées, arbres des jardins, courtines et tours aux portes sur les routes. L'état de la
// partie l'abîme comme la carte d'avant (villes.js, degats) : îlots ruinés, toits crevés, maisons brûlées par
// l'incendie, brèches du siège. Plateau.image échange de près la ville « jouet » contre cette maquette.
import { THREE, MAT, hache } from './moteur.js';
import { carteDe, etatVille, planDe, planOrganique, degats, cleVille } from '../carte/villes.js';
import { primitives, TEINTES, QUARTIERS, ecart } from '../carte/plan-organique.js';

const VX = 1.6;   // les hauteurs un peu exagérées : vues de biais, les maisons à l'échelle s'écrasent
const NON_BATI = new Set(['place', 'jardin', 'maraichers', 'parc']);
const VUE = new THREE.Vector3(0, 0.83, 0.56);   // vers la caméra (moteur.js) : les faces qui s'en détournent sont omises
const ICO = new THREE.IcosahedronGeometry(1, 0).attributes.position.array;
export const cleMaquette = (n, e) => cleVille(n, e) + `|${Math.round((e.dmg || 0) * 10)}|${Math.round((e.deg || 0) * 20)}|${e.lv === 'incendie' ? 1 : 0}`;

// un tampon de triangles colorés, à faces plates ; les faces tournées vers le haut ou vers l'extérieur (sens)
class Tampon {
  constructor() { this.P = []; this.C = []; this.c = new THREE.Color(); }
  teinte(h) { return typeof h === 'number' ? this.c.setHex(h) : this.c.setStyle(h); }
  // triangle a b c (tableaux [x, y, z]) tourné vers s ([x, y, z]) ; omis s'il se détourne de la caméra
  tri(a, b, c, k, s) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * s[0] + ny * s[1] + nz * s[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    if (nx * VUE.x + ny * VUE.y + nz * VUE.z < -1e-9) return;
    this.P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.C.push(k.r, k.g, k.b);
  }
  quad(a, b, c, d, k, s) { this.tri(a, b, c, k, s); this.tri(a, c, d, k, s); }
  // un polygone horizontal (points [x, z]) à la hauteur y
  sol(pts, y, k) {
    if (pts.length < 3) return;
    const v = pts.map(p => new THREE.Vector2(p[0], p[1]));
    for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(v, [])) this.tri([pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[l][0], y, pts[l][1]], k, [0, 1, 0]);
  }
  // les murs d'un polygone de y0 à y1, tournés vers l'extérieur (centre cx, cz)
  murs(pts, y0, y1, k, cx, cz) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], k, [mx, 0, mz]);
    }
  }
  maillage() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, MAT); m.castShadow = m.receiveShadow = true;
    return m;
  }
}

// la maquette de la place n (état ns) : un générateur qui bâtit quelques îlots à chaque pas (Plateau.file) et rend
// { grp, cle, eglise, place } (km), ou null si la place n'a pas de plan (fortin)
export function* maquette(pl, n, ns) {
  const mp = pl.mp, g = pl.g, f = g.f, K = carteDe(mp.m), e = etatVille(n, ns, mp.state);
  const V = planDe(K, n, e), O = planOrganique(K, V, e);
  if (!O) return null;
  yield;
  const bati = O.ilots.filter(il => !NON_BATI.has(il.type)), deg = degats({ Pf: V.Pf, ilots: bati }, e);
  const T = new Tampon(), u = p => [p[0] / f, p[1] / f], H = h => h / f * VX;
  // la hauteur du plateau sous un point du plan (km) ; hors de la terre ferme du plateau (rivière peinte), rien
  const sol = (x, y) => { const t = g.en(x, y); return t ? Math.max(t.top, 0) : 0; };
  const mouille = (x, y) => pl.mouille(x / f, y / f, 0);
  const rue = T.teinte(O.rue || '#bfb498').clone();
  let k = 0;
  for (const il of O.ilots) {
    if (mouille(il.c[0], il.c[1])) continue;
    const y0 = sol(il.c[0], il.c[1]) + 0.15, kd = deg.get(il);
    // la rue sous l'îlot, puis le sol de son quartier (au-dessus des routes et de la teinte du territoire)
    if (il.pts) T.sol(il.pts.map(u), y0, rue);
    const Q = QUARTIERS[il.type] || QUARTIERS.vieux;
    T.sol(il.bloc.map(u), y0 + 0.012, T.teinte(kd === 'brule' ? '#4a3f37' : kd === 'ruine' ? '#a39782' : Q[1]));
    let ys = y0 + 0.024;
    for (const p of primitives(il, O)) {
      if (p[0] === 's') { T.sol(p[2].map(u), ys, T.teinte(p[1])); ys = Math.min(ys + 0.006, y0 + 0.06); }
      else if (p[0] === 't') {
        // maison à deux versants : murs, pignons, faîtage parallèle à la façade f0-f1
        const [, nom, f0, f1, b1, b0, h] = p, q = [f0, f1, b1, b0].map(u), cx = (q[0][0] + q[2][0]) / 2, cz = (q[0][1] + q[2][1]) / 2;
        const prof = Math.hypot(b0[0] - f0[0], b0[1] - f0[1]), h0 = hache(Math.round(f0[0] * 1e4), Math.round(f0[1] * 1e4), 5);
        const kh = kd === 'ruine' ? 0.35 : kd === 'brule' ? 0.7 : 1, y1 = y0 + H(h) * kh, yr = y1 + H(prof * 0.42) * 0.8;
        T.murs(q, y0, y1, T.teinte(kd === 'brule' ? 0x3a302a : kd === 'ruine' ? 0x9a8f7c : h0 < 0.5 ? 0xeee2c6 : 0xe2d2ae), cx, cz);
        if (kd === 'ruine' || kd === 'brule') continue;   // (sans toit)
        const pans = (TEINTES[nom] || TEINTES.tuile0).pans, r0 = [(q[0][0] + q[3][0]) / 2, yr, (q[0][1] + q[3][1]) / 2], r1 = [(q[1][0] + q[2][0]) / 2, yr, (q[1][1] + q[2][1]) / 2];
        const A = [q[0][0], y1, q[0][1]], B = [q[1][0], y1, q[1][1]], C = [q[2][0], y1, q[2][1]], D = [q[3][0], y1, q[3][1]];
        const crev = kd === 'creve' && h0 < 0.5, toit = T.teinte(crev ? '#3a2c25' : pans[5]).clone();
        T.tri(B, C, r1, T.teinte(0xe2d2ae), [r1[0] - cx, 0, r1[2] - cz]); T.tri(D, A, r0, T.teinte(0xe2d2ae), [r0[0] - cx, 0, r0[2] - cz]);
        T.quad(A, B, r1, r0, toit, [A[0] - D[0], 1, A[2] - D[2]]); T.quad(r0, r1, C, D, toit, [D[0] - A[0], 1, D[2] - A[2]]);
      } else if (p[0] === 'p') {
        // toit plat : un volume à la hauteur h
        const q = p[2].map(u), cx = q.reduce((s, a) => s + a[0], 0) / q.length, cz = q.reduce((s, a) => s + a[1], 0) / q.length;
        const kh = kd === 'ruine' ? 0.35 : kd === 'brule' ? 0.7 : 1, y1 = y0 + Math.max(H(p[3]), 0.02) * kh;
        if (p[3] > 0.002) T.murs(q, y0, y1, T.teinte(kd === 'brule' ? 0x3a302a : 0xd9cbb0), cx, cz);
        T.sol(q, y1, T.teinte(kd === 'brule' ? '#2e2622' : kd === 'ruine' ? '#8f8576' : p[1]));
      } else if (p[0] === 'c') {
        // cheminée d'usine
        const [, x, y, r, h] = p, [cx, cz] = u([x, y]), w = r / f, y1 = y0 + H(h);
        T.murs([[cx - w, cz - w], [cx + w, cz - w], [cx + w, cz + w], [cx - w, cz + w]], y0, y1, T.teinte(0x8c4a36), cx, cz);
        T.sol([[cx - w, cz - w], [cx + w, cz - w], [cx + w, cz + w], [cx - w, cz + w]], y1, T.teinte(0x2c2622));
      } else if (p[0] === 'a') {
        // arbre des jardins et des cours : un houppier à facettes
        const [, x, y, r, col] = p, [cx, cz] = u([x, y]), R = r / f, cy = y0 + R * 1.3, kc = T.teinte(col).clone();
        for (let i = 0; i < ICO.length; i += 9) {
          const v = j => [cx + ICO[i + j] * R, cy + ICO[i + j + 1] * R * 0.9, cz + ICO[i + j + 2] * R];
          T.tri(v(0), v(3), v(6), kc, [ICO[i] + ICO[i + 3] + ICO[i + 6], ICO[i + 1] + ICO[i + 4] + ICO[i + 7], ICO[i + 2] + ICO[i + 5] + ICO[i + 8]]);
        }
      }
    }
    if (++k % 60 === 0) yield;
  }
  // l'enceinte des remparts de la partie : courtines par tronçons de 20 m, ouvertes aux portes (les routes) et aux
  // brèches du siège, tours aux angles
  const mur = O.mur;
  if (mur && mur.kind === 'mur') {
    const L = mur.pts, ep = 0.006 / f, porte = (x, y) => O.axes.some(l => ecart(l, x, y) < 0.014), breche = e.dmg > 0.15 ? e.dmg * 0.35 : 0;
    const pierre = T.teinte(0xcfc3a6).clone(), haut = T.teinte(0xb3a78c).clone(), gravats = T.teinte(0x9a8f7c).clone();
    for (let i = 1; i < L.length; i++) {
      const a = L[i - 1], b = L[i], nb = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02));
      for (let j = 0; j < nb; j++) {
        const p = [a[0] + (b[0] - a[0]) * j / nb, a[1] + (b[1] - a[1]) * j / nb], q = [a[0] + (b[0] - a[0]) * (j + 1) / nb, a[1] + (b[1] - a[1]) * (j + 1) / nb];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        if (O.eau(mx, my) || mouille(mx, my) || porte(mx, my)) continue;
        const [px, pz] = u(p), [qx, qz] = u(q), dx = qx - px, dz = qz - pz, l = Math.hypot(dx, dz) || 1, nx = -dz / l * ep, nz = dx / l * ep;
        const y0 = sol(mx, my) + 0.15, cass = hache(mx * 97, my * 89, 3) < breche, y1 = y0 + H(cass ? 0.003 : 0.011);
        const poly = [[px + nx, pz + nz], [qx + nx, qz + nz], [qx - nx, qz - nz], [px - nx, pz - nz]];
        T.murs(poly, y0, y1, cass ? gravats : pierre, (px + qx) / 2, (pz + qz) / 2); T.sol(poly, y1, cass ? gravats : haut);
      }
      const [tx, tz] = u(a), r = 0.011 / f, y0 = sol(a[0], a[1]) + 0.15, y1 = y0 + H(0.017);
      if (O.eau(a[0], a[1]) || mouille(a[0], a[1])) continue;
      const hex = Array.from({ length: 8 }, (_, s) => [tx + Math.cos(s * Math.PI / 4) * r, tz + Math.sin(s * Math.PI / 4) * r]);
      T.murs(hex, y0, y1, pierre, tx, tz);
      for (let s = 0; s < 8; s++) T.tri([hex[s][0], y1, hex[s][1]], [hex[(s + 1) % 8][0], y1, hex[(s + 1) % 8][1]], [tx, y1 + r * 1.4, tz], T.teinte(0x6b7380), [hex[s][0] - tx, 1, hex[s][1] - tz]);
    }
  }
  const grp = new THREE.Group(); grp.add(T.maillage());
  const pres = t => O.ilots.filter(b => b.type === t).sort((a, b) => Math.hypot(a.c[0] - n.x, a.c[1] - n.y) - Math.hypot(b.c[0] - n.x, b.c[1] - n.y))[0]?.c;
  const place = pres('place') || [n.x, n.y];
  return { grp, cle: cleMaquette(n, e), eglise: pres('eglise') || place, place };
}
