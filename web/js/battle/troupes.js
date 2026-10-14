// Vue tactique : les régiments en 3D. Chaque régiment est fait de petites figurines (un homme par figurine tant que
// le budget de la qualité le permet), en rangs serrés : trois rangs pour une ligne, le carré à quatre faces, les
// tirailleurs par deux ; porte-drapeau (le drapeau flotte), tambours, officiers, colonel. Coiffures de l'époque
// (tricorne, bicorne, shako, képi, bonnet à poil, chapeau rond des miliciens).
//
// Les figurines sont des modèles simples construits ici (boîtes et cylindres, couleurs par sommet), dessinés par lots
// (un InstancedMesh par sorte). Chaque instance ne porte que sa place dans le régiment (u le long du front, v vers
// l'avant), son sens, sa pose, sa phase et la couleur de son habit. La position, le sens et l'état de chaque régiment
// sont dans une petite texture de données mise à jour à chaque image ; le vertex shader place la figurine, lit
// l'altitude dans une texture du relief, anime les membres (attribut « os » de chaque sommet : jambes, bras et fusil)
// et fait rouler la salve le long du front. Le travail de chaque image est donc proportionnel au nombre de régiments.
// Les dispositions (layout) ne sont recalculées que quand un régiment change de forme, d'effectif (par 8 hommes) ou
// d'état.
import * as THREE from '../../vendor/three/three.module.js';
import { clsOf, isLight, isGeneral, isWagon, pieces, hash, clamp } from './formes.js';

export const POSES = { STAND: 0, AIM: 1, RUN: 2, MARCH: 3, RELOAD: 5, ROUT: 7 };
const { AIM, RUN, ROUT } = POSES;
export const SCALE = 1.6;   // les figurines sont grandies : l'emprise du jeu (1,2 m par file) se lit épaule contre épaule
const MAXU = 512;           // régiments au plus (largeur de la texture des régiments)

const SKIN = '#e2b996', HAT = '#1f1b18', WHITE = '#f3efe4', WOOD = '#6e5134', IRON = '#2c2c2a', GOLD = '#d6b65a', LEATHER = '#2a1f16';
const AFFUT = '#5f6b3e', BRONZE = '#b08a3e';   // affûts peints en vert olive, pièces de bronze
const ROWS = 5;     // lignes de la texture des régiments (la 4e et la 5e : l'instant du dernier coup de chaque pièce)
const ROBES = ['#6b4a2c', '#3f2d1f', '#8b6a47', '#54402e'];   // robes des chevaux (bai, bai brun, alezan, noir pangaré)

// coiffure selon l'époque et le type (comme la vue 2D d'avant)
export function headgear(kind, year) {
  if (kind === 'milice') return 'rond';
  if (kind === 'officier' || kind === 'drapeau') return year < 1815 ? 'bicorne' : year < 1860 ? 'shako' : 'kepi';
  if (kind === 'gren') return year < 1860 ? 'ourson' : 'kepi';
  if (year < 1795) return 'tricorne';
  if (year < 1806) return kind === 'leger' ? 'shako' : 'bicorne';
  return year < 1860 ? 'shako' : 'kepi';
}

// ------------------------------------------------------------------ dispositions
// Figurines d'un régiment : [u, v, sorte, face, pose, rang, phase]. u le long du front (vers la droite), v vers
// l'avant, en m depuis le centre ; face : face du carré (0 devant, 1 à droite, 2 derrière, 3 à gauche) ou 2 (demi-tour) ;
// rang : 0, 1, 2… dans les rangs, −1 encadrement, −2 porte-drapeau, −3 étendard ; per : hommes par figurine.
export function layout(un, per = 1, scale = SCALE) {
  const sp = 0.62 * scale, sr = 0.95 * scale, w = un.w, d = un.d;
  const cls = clsOf(un), out = [], id = String(un.id).length * 97 + (un.men0 || 0) + (String(un.id).charCodeAt(0) || 0) * 7;
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
        push(u0, -d / 2 + 10, 'caisson', 2, 0);   // le timon vers ses chevaux, derrière
        push(u0 - 0.9, -d / 2 + 5.5, 'attelage', 2, (k % 4) << 4); push(u0 + 0.9, -d / 2 + 5.5, 'attelage', 2, ((k + 1) % 4) << 4);
      }
    }
  } else {
    const cav = cls === 'cavalerie';
    const kind = cav ? 'cav' : un.type === 'grenadiers' || un.type === 'garde' ? 'gren' : un.type === 'milice' ? 'milice' : isLight(un) ? 'leger' : 'inf';
    const n = clamp(Math.round((un.men || 0) / per), 4, cav ? 160 : 480);
    if (un.form === 'carre' && !cav) {
      // carré : trois rangs par face, tournés vers l'extérieur ; drapeau, tambours et officiers au milieu
      const ranks = n > 60 ? 3 : 2, per4 = Math.max(2, Math.round(n / 4 / ranks)), s = w / 2;
      for (let f = 0; f < 4; f++) for (let r = 0; r < ranks; r++) for (let k = 0; k < per4; k++) {
        const t = (k + 0.5) / per4 * 2 - 1, e = s - r * Math.min(sp, sr);
        const [u0, v0] = [[t * e, e], [e, -t * e], [-t * e, -e], [-e, t * e]][f];
        push(u0, v0, kind, f, 0, r);
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
  return out;
}

// ------------------------------------------------------------------ modèles
// Pièces assemblées en une géométrie : couleur par sommet, os (0 corps, 1 jambe gauche, 2 jambe droite, 3 bras et
// fusil, 4 étoffe du drapeau ; cheval : 1 et 2 jambes avant, 5 et 6 jambes arrière, 7 encolure, 8 bras du cavalier),
// teinte (1 : l'habit, couleur de l'instance ; 2 : la robe du cheval ; la couleur du sommet n'en donne que la nuance).
// Repère d'une figurine : +Z devant, +X à sa gauche, les pieds en 0, un homme mesure 1,75 m.
function assemble(parts) {
  const pos = [], nor = [], col = [], bone = [], part = [], uv = [], idx = [];
  for (const [g, color, b, tint] of parts) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, base = pos.length / 3;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b); bone.push(b); part.push(tint); uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aBone', new THREE.Float32BufferAttribute(bone, 1));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}
// boîte de taille (w, h, d), centrée en (x, y, z), tournée de (rx, ry, rz)
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
const cyl = (rt, rb, h, n, x, y, z, rx = 0, rz = 0) => new THREE.CylinderGeometry(rt, rb, h, n).rotateX(rx).rotateZ(rz).translate(x, y, z);
// nuance d'habit (la couleur vient de l'instance) : le rouge du sommet porte la nuance
const shade = k => new THREE.Color(k, k, k).getStyle();

function hat(type, kind, dy = 0) {
  const plume = kind === 'gren' || kind === 'tambour' ? '#c83a2a' : kind === 'leger' ? '#4f8a3a' : '#f1ece0';
  if (dy) return hat(type, kind).map(([g, ...r]) => [g.translate(0, dy, 0), ...r]);
  switch (type) {
    case 'tricorne': return [[cyl(0.2, 0.22, 0.08, 3, 0, 1.71, 0.01), HAT, 0, 0], [cyl(0.1, 0.11, 0.1, 8, 0, 1.74, 0), HAT, 0, 0]];
    case 'bicorne': return [[box(0.46, 0.15, 0.09, 0, 1.75, 0), HAT, 0, 0], [cyl(0.1, 0.11, 0.08, 8, 0, 1.71, 0), HAT, 0, 0], [box(0.05, 0.05, 0.02, 0.12, 1.77, 0.05), '#2f4fa0', 0, 0]];
    case 'shako': return [[cyl(0.12, 0.105, 0.22, 10, 0, 1.78, 0), HAT, 0, 0], [box(0.2, 0.02, 0.08, 0, 1.68, 0.11), HAT, 0, 0], [box(0.05, 0.13, 0.05, 0, 1.95, 0.07), plume, 0, 0]];
    case 'kepi': return [[cyl(0.1, 0.11, 0.12, 10, 0, 1.72, 0), '#1f2a44', 0, 0], [box(0.18, 0.02, 0.08, 0, 1.67, 0.1), HAT, 0, 0]];
    case 'ourson': return [[cyl(0.14, 0.12, 0.38, 10, 0, 1.83, 0), '#1a1612', 0, 0], [box(0.04, 0.16, 0.04, 0.12, 1.86, 0.04), plume, 0, 0]];
    default: return [[cyl(0.21, 0.21, 0.025, 12, 0, 1.68, 0), '#3d2f22', 0, 0], [cyl(0.11, 0.12, 0.14, 10, 0, 1.76, 0), '#3d2f22', 0, 0]];
  }
}
// fantassin (et encadrement, servants des pièces) : kind 'inf' | 'gren' | 'leger' | 'milice' | 'officier' | 'tambour' |
// 'drapeau' | 'servant'
function soldier(kind, year) {
  const trous = kind === 'milice' ? '#5a4c3c' : year >= 1830 ? '#8d929b' : WHITE;
  const officer = kind === 'officier' || kind === 'drapeau';
  const gaiter = year < 1845 && !officer ? '#1d1916' : trous;
  const facing = kind === 'milice' ? '#5a4632' : WHITE;
  const armed = !officer && kind !== 'tambour' && kind !== 'servant';
  const P = [];
  for (const [s, b] of [[1, 1], [-1, 2]]) {
    P.push([box(0.13, 0.42, 0.15, s * 0.09, 0.63, 0), trous, b, 0], [box(0.12, 0.42, 0.14, s * 0.09, 0.21, 0), gaiter, b, 0], [box(0.12, 0.06, 0.24, s * 0.09, 0.03, 0.04), '#15110d', b, 0]);
  }
  P.push([box(0.4, 0.62, 0.24, 0, 1.15, 0), shade(1), 0, 1]);                      // habit
  P.push([box(0.4, 0.38, 0.08, 0, 0.72, -0.09), shade(0.8), 0, 1]);                // basques
  P.push([box(0.36, 0.08, 0.02, 0, 0.58, -0.135), facing, 0, 0]);                  // retroussis
  P.push([box(0.2, 0.44, 0.02, 0, 1.2, 0.125), facing, 0, 0]);                     // revers
  P.push([box(0.18, 0.21, 0.2, 0, 1.565, 0.01), SKIN, 0, 0]);                      // tête
  if (year < 1800) P.push([box(0.08, 0.14, 0.05, 0, 1.47, -0.11), '#3a2c20', 0, 0]);   // la queue
  if (armed) {
    P.push([box(0.06, 0.74, 0.03, 0, 1.12, 0.13, 0, 0, 0.55), WHITE, 0, 0], [box(0.06, 0.74, 0.03, 0, 1.12, 0.135, 0, 0, -0.55), WHITE, 0, 0]);   // buffleteries
    P.push([box(0.22, 0.14, 0.08, 0, 0.92, -0.16), LEATHER, 0, 0]);                // giberne
    if (kind !== 'milice') P.push([box(0.32, 0.34, 0.12, 0, 1.2, -0.19), '#7a5a3a', 0, 0]);   // havresac
  }
  if (officer) {
    P.push([box(0.42, 0.08, 0.26, 0, 0.88, 0), '#c9a24a', 0, 0]);                  // ceinture
    for (const s of [1, -1]) P.push([box(0.12, 0.04, 0.14, s * 0.22, 1.47, 0), GOLD, 0, 0]);   // épaulettes
    if (kind === 'officier') P.push([box(0.03, 0.8, 0.03, 0.24, 0.62, -0.06, 0.45), '#c0c4c8', 0, 0]);   // épée
  }
  if (kind === 'tambour') P.push([cyl(0.16, 0.16, 0.24, 10, 0.2, 0.78, 0.12, 0, 1.2), '#e8dcc0', 0, 0], [cyl(0.165, 0.165, 0.05, 10, 0.2, 0.78, 0.12, 0, 1.2), shade(0.9), 0, 1]);
  if (kind === 'drapeau') P.push([box(0.045, 3.1, 0.045, 0.24, 2.05, 0.08), WOOD, 0, 0], [box(0.08, 0.12, 0.08, 0.24, 3.64, 0.08), GOLD, 0, 0]);
  P.push(...hat(headgear(kind, year), kind));
  // bras (os 3, l'épaule en y = 1,40) : manches, parements, mains ; le fusil dans la main gauche
  for (const s of [1, -1]) P.push([box(0.11, 0.56, 0.12, s * 0.26, 1.13, 0), shade(0.9), 3, 1], [box(0.115, 0.08, 0.125, s * 0.26, 0.88, 0), facing, 3, 0], [box(0.08, 0.09, 0.09, s * 0.26, 0.8, 0), SKIN, 3, 0]);
  if (armed) P.push([box(0.05, 0.55, 0.07, 0.3, 1.05, 0.06), WOOD, 3, 0], [box(0.03, 0.95, 0.035, 0.3, 1.75, 0.06), IRON, 3, 0], [box(0.015, 0.38, 0.02, 0.3, 2.4, 0.06), '#b8bcc0', 3, 0]);
  return assemble(P);
}
// l'étoffe du drapeau, accrochée en haut de la hampe du porte-drapeau, flottant vers l'arrière ; l'étendard d'un
// cavalier (fanion de l'état-major) a sa hampe avec lui
function flagCloth(rider = false) {
  if (rider) return assemble([[new THREE.PlaneGeometry(1.2, 0.85, 6, 2).rotateY(Math.PI / 2).translate(-0.3, 3.4, 0.08 - 0.6), shade(1), 4, 1],
    [box(0.04, 2.2, 0.04, -0.3, 2.75, 0.08), WOOD, 0, 0], [box(0.07, 0.1, 0.07, -0.3, 3.88, 0.08), GOLD, 0, 0]]);
  return assemble([[new THREE.PlaneGeometry(2, 1.4, 8, 3).rotateY(Math.PI / 2).translate(0.24, 2.85, 0.08 - 1), shade(1), 4, 1]]);
}
// pièce de campagne : fût de bronze, affût à flasques qui descend vers la crosse, deux roues ; la bouche vers +Z
function gun() {
  const P = [[cyl(0.11, 0.15, 2.1, 10, 0, 1.0, 0.55, Math.PI / 2), BRONZE, 0, 0], [cyl(0.17, 0.17, 0.12, 10, 0, 1.0, -0.5, Math.PI / 2), BRONZE, 0, 0]];
  for (const s of [1, -1]) {
    P.push([box(0.07, 0.32, 1.95, s * 0.17, 0.74, -0.4, -0.25), AFFUT, 0, 0]);
    P.push([cyl(0.62, 0.62, 0.08, 14, s * 0.48, 0.62, 0.1, 0, Math.PI / 2), '#6a5a3a', 0, 0], [cyl(0.12, 0.12, 0.14, 8, s * 0.48, 0.62, 0.1, 0, Math.PI / 2), IRON, 0, 0]);
  }
  P.push([box(0.36, 0.12, 0.3, 0, 0.16, -1.4), AFFUT, 0, 0], [box(1.0, 0.1, 0.12, 0, 0.62, 0.1), IRON, 0, 0]);
  return assemble(P);
}
// avant-train ou caisson à munitions (le timon vers +Z) ; wagon : chariot de munitions bâché, à quatre roues
function caisson(wagon) {
  const P = [];
  const wheels = z => { for (const s of [1, -1]) P.push([cyl(0.58, 0.58, 0.08, 14, s * 0.55, 0.58, z, 0, Math.PI / 2), '#6a5a3a', 0, 0]); P.push([box(1.15, 0.1, 0.1, 0, 0.58, z), IRON, 0, 0]); };
  if (wagon) {
    P.push([box(1.0, 0.5, 2.4, 0, 1.05, 0), '#7a5a3a', 0, 0], [cyl(0.6, 0.6, 2.3, 10, 0, 1.3, 0, Math.PI / 2), '#e8e0c8', 0, 0]);
    wheels(0.8); wheels(-0.8);
    P.push([box(0.06, 0.06, 1.8, 0, 0.75, 2.0), WOOD, 0, 0]);
  } else {
    P.push([box(0.9, 0.55, 1.1, 0, 1.0, 0), AFFUT, 0, 0], [box(0.95, 0.06, 1.15, 0, 1.3, 0), '#4c5632', 0, 0]);
    wheels(0);
    P.push([box(0.06, 0.06, 2.0, 0, 0.72, 1.45), WOOD, 0, 0]);
  }
  return assemble(P);
}
// cheval (2,3 m de long, 1,55 m au garrot) ; rider : 'cav' (cavalier), 'colonel' (officier supérieur, général) ou rien
// (cheval d'attelage, avec son collier)
function horse(rider, year) {
  const P = [], R = (k, ...g) => [box(...g), shade(k), 0, 2];
  P.push(R(1, 0.5, 0.58, 1.5, 0, 1.16, 0), R(0.95, 0.46, 0.5, 0.3, 0, 1.18, 0.78));          // corps, poitrail
  P.push([box(0.26, 0.72, 0.36, 0, 1.62, 0.95, -0.55), shade(0.95), 7, 2]);                  // encolure
  P.push([box(0.22, 0.24, 0.6, 0, 1.97, 1.22, 0.45), shade(0.9), 7, 2]);                     // tête
  P.push([box(0.06, 0.62, 0.12, 0, 1.78, 0.86, -0.55), '#1a1410', 7, 0]);                    // crinière
  for (const [x, z, b] of [[0.15, 0.6, 1], [-0.15, 0.6, 2], [0.15, -0.6, 5], [-0.15, -0.6, 6]]) {
    P.push([box(0.13, 0.5, 0.18, x, 0.62, z), shade(0.9), b, 2], [box(0.09, 0.42, 0.1, x, 0.24, z), shade(0.7), b, 2], [box(0.11, 0.07, 0.13, x, 0.035, z), '#1a1410', b, 0]);
  }
  P.push([box(0.1, 0.65, 0.12, 0, 1.0, -0.83, 0.25), '#1a1410', 0, 0]);                      // queue
  if (!rider) {
    P.push([box(0.52, 0.14, 0.14, 0, 1.55, 0.74), '#3a2a1a', 0, 0], [box(0.52, 0.08, 1.2, 0, 1.3, -0.1), '#2a1e14', 0, 0]);   // collier, harnais
    return assemble(P);
  }
  const col = rider === 'colonel', breeches = year >= 1830 ? '#8d929b' : '#e8dcc0';
  P.push([box(0.62, 0.08, 0.66, 0, 1.47, -0.05), shade(0.85), 0, 1]);                        // tapis de selle
  P.push([box(0.44, 0.14, 0.46, 0, 1.6, 0.12), breeches, 0, 0]);                             // cuisses
  for (const s of [1, -1]) P.push([box(0.12, 0.52, 0.15, s * 0.3, 1.34, 0.3), '#15110d', 0, 0]);   // bottes
  P.push([box(0.38, 0.58, 0.24, 0, 1.96, -0.02), shade(1), 0, 1]);                           // habit
  P.push([box(0.06, 0.66, 0.03, 0, 1.94, 0.11, 0, 0, 0.5), col ? '#c9a24a' : WHITE, 0, 0]);  // baudrier (écharpe dorée d'un officier)
  P.push([box(0.18, 0.21, 0.2, 0, 2.36, 0.01), SKIN, 0, 0]);
  if (col) for (const s of [1, -1]) P.push([box(0.12, 0.04, 0.14, s * 0.21, 2.25, -0.02), GOLD, 0, 0]);
  P.push(...hat(headgear(col ? 'officier' : 'cav', year), col ? 'officier' : 'cav', 0.795));
  // bras gauche tenant les rênes ; bras droit (os 8, l'épaule en y = 2,2) et le sabre, levé à la charge
  P.push([box(0.11, 0.45, 0.12, 0.25, 2.0, 0.14, -0.9), shade(0.9), 0, 1], [box(0.08, 0.09, 0.09, 0.25, 1.86, 0.32), SKIN, 0, 0]);
  P.push([box(0.11, 0.56, 0.12, -0.26, 1.94, 0), shade(0.9), 8, 1], [box(0.08, 0.09, 0.09, -0.26, 1.62, 0), SKIN, 8, 0]);
  P.push([box(0.035, 0.95, 0.02, -0.27, 2.14, 0.04), '#c8ccd0', 8, 0]);
  return assemble(P);
}
// motif blanc de l'étoffe : croix des drapeaux d'ordonnance (avant 1790), losange ensuite
function flagPattern(year) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  if (year < 1790) { g.fillRect(27, 0, 10, 48); g.fillRect(0, 19, 64, 10); }
  else { g.beginPath(); g.moveTo(32, 4); g.lineTo(58, 24); g.lineTo(32, 44); g.lineTo(6, 24); g.closePath(); g.fill(); }
  g.strokeStyle = 'rgba(214,182,90,1)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 61, 45);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ shader commun
// Ajouté au matériau Lambert : place et anime chaque figurine (voir l'en-tête). Les variables calculées au début (pose,
// angles, position) servent ensuite à tourner les normales puis les sommets.
const VERT_HEAD = `
attribute vec4 aSlot;   // u, v, sens (ajouté à celui du régiment), numéro du régiment
attribute vec4 aAnim;   // pose, phase, échelle, rang
attribute vec3 aCoat;   // couleur de l'habit
attribute float aBone, aPart;
uniform sampler2D uUnits, uHeight;
uniform vec3 uHgt;      // pas des altitudes (m), colonnes, lignes
uniform float uTime, uFxT;
uniform vec3 uRobes[4];
varying float vFade, vPart;
float hAt(vec2 p) {
  vec2 f = clamp(p / uHgt.x - 0.5, vec2(0.0), uHgt.yz - 1.001);
  ivec2 i = ivec2(floor(f)); vec2 t = f - vec2(i);
  float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeight, i + ivec2(0, 1), 0).r, d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
vec2 pitch(vec2 yz, vec2 o, float a) { vec2 q = yz - o; return o + vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a)); }
`;
const VERT_POSE = `
  int ui = int(aSlot.w);
  vec4 u0 = texelFetch(uUnits, ivec2(ui, 0), 0);   // x, y, sens, opacité
  vec4 u1 = texelFetch(uUnits, ivec2(ui, 1), 0);   // allure (0 arrêt, 1 marche, 2 course), feu, début de la salve, durée
  vec4 u2 = texelFetch(uUnits, ivec2(ui, 2), 0);   // sens de la salve, front (m), tirailleurs
  vec4 u3 = texelFetch(uUnits, ivec2(ui, 3), 0), u4 = texelFetch(uUnits, ivec2(ui, 4), 0);   // dernier coup de chaque pièce
  float P = aAnim.x, ph = aAnim.y, rank = aAnim.w, slotV = aSlot.y, crouch = 1.0;
  // pose : celle de la disposition (déroute, mêlée), sinon selon l'allure et la salve qui roule le long du front
  if (P == 0.0) {
    if (u1.x > 1.5) P = 2.0;
    else if (u1.x > 0.5) P = 3.0;
    else if (u2.z < 0.5 && rank >= 0.0 && rank < 2.0 && uFxT - u1.z < 8.0) {
      float t = uFxT - (u1.z + u1.w * (u2.x > 0.0 ? aSlot.x / u2.y + 0.5 : 0.5 - aSlot.x / u2.y));
      P = t > -0.7 && t < 0.15 ? 1.0 : t >= 0.15 && t < 5.0 ? 5.0 : 0.0;
    } else if (u2.z > 0.5 && rank == 0.0 && (u1.y > 0.5 || uFxT - u1.z < 8.0)) {
      float cyc = fract(uTime * 0.3 + ph * 0.37);
      P = cyc < 0.18 ? 1.0 : cyc < 0.62 ? 5.0 : 0.0;
    }
  }
  float swing = 0.0, arm = 0.0, bob = 0.0, lean = 0.0, boneA = 0.0;
  vec2 pivot = vec2(0.86, 0.0);
#if defined(GUN)
  // pièce : recul au départ du coup, puis on la remet en batterie
  if (rank >= 100.0) {
    int k = int(rank) - 100;
    float t = uFxT - (k < 4 ? u3[k] : u4[k - 4]);
    if (t >= 0.0 && t < 1.6) slotV -= (t < 0.06 ? t / 0.06 : 1.0 - (t - 0.06) / 1.54) * 1.4;
  }
#elif defined(CREW)
  // servants (rang 200 + 10 × pièce + rôle) : écouvillon (1), boulet (2), pointeur accroupi (3), boutefeu (4)
  if (rank >= 200.0) {
    int k = int((rank - 200.0) / 10.0);
    float role = mod(rank - 200.0, 10.0), t = uFxT - (k < 4 ? u3[k] : u4[k - 4]);
    if (t < 6.0 || u1.y > 0.5) {
      if (role == 1.0) arm = t > 0.4 && t < 3.5 ? 1.1 + sin(uTime * 3.0 + ph) * 0.35 : 0.0;
      else if (role == 2.0) { arm = 0.7; swing = sin(uTime * 6.0 + ph) * 0.35; slotV += sin(uTime * 1.4 + ph) * 1.2; }
      else if (role == 4.0) arm = t < 0.4 || t > 4.0 ? 1.7 : 0.3;
    }
    if (role == 3.0) crouch = 0.78;
  } else if (u1.x > 0.5) swing = sin(uTime * 8.2 + ph) * 0.38;
  boneA = aBone == 1.0 ? swing : aBone == 2.0 ? -swing : aBone == 3.0 ? arm : 0.0;
  if (aBone == 3.0) pivot = vec2(1.4, 0.0);
#elif defined(HORSE)
  // cheval : la pose de la disposition porte la robe (× 16) et, en déroute, le galop (2) ; sinon l'allure du régiment.
  // Au pas, les jambes vont par paires en diagonale ; au galop, l'une après l'autre, le cheval se soulève.
  float gait = mod(P, 4.0) > 1.5 ? 2.0 : u1.x;
  float fq = gait > 1.5 ? 11.0 : 6.5, am = gait > 1.5 ? 0.65 : gait > 0.5 ? 0.32 : 0.0, t = uTime * fq + ph;
  float aFL = sin(t) * am, aFR = sin(t + (gait > 1.5 ? 0.7 : 3.14)) * am, aHL = sin(t + (gait > 1.5 ? 2.2 : 3.14)) * am, aHR = sin(t + (gait > 1.5 ? 2.9 : 0.0)) * am;
  boneA = aBone == 1.0 ? aFL : aBone == 2.0 ? aFR : aBone == 5.0 ? aHL : aBone == 6.0 ? aHR : aBone == 7.0 ? sin(t) * am * 0.3 : aBone == 8.0 && gait > 1.5 ? 1.2 : 0.0;
  pivot = aBone == 1.0 || aBone == 2.0 ? vec2(0.85, 0.6) : aBone == 5.0 || aBone == 6.0 ? vec2(0.85, -0.6) : aBone == 7.0 ? vec2(1.4, 0.75) : vec2(2.2, 0.0);
  bob = gait > 1.5 ? abs(sin(t)) * 0.12 : gait > 0.5 ? abs(sin(t * 2.0)) * 0.03 : 0.0;
#else
  if (P == 3.0) { swing = sin(uTime * 8.2 + ph) * 0.38; bob = abs(sin(uTime * 8.2 + ph)) * 0.03; }
  else if (P == 2.0 || P == 7.0) { swing = sin(uTime * 13.0 + ph) * 0.65; bob = abs(sin(uTime * 13.0 + ph)) * 0.06; lean = 0.18; arm = P == 2.0 ? 1.25 : 0.35; }
  if (P == 1.0) arm = 1.55; else if (P == 5.0) arm = 0.45;
  boneA = aBone == 1.0 ? swing : aBone == 2.0 ? -swing : aBone == 3.0 ? arm : 0.0;
  if (aBone == 3.0) pivot = vec2(1.4, 0.0);
#endif
  float fa = u0.z + aSlot.z, sa = sin(fa), ca = cos(fa);
  vec2 fw = vec2(cos(u0.z), sin(u0.z)), base = u0.xy + fw * slotV + vec2(-fw.y, fw.x) * aSlot.x;
  vFade = u0.w;
`;
// tourne un vecteur de la figurine : membre (autour de son pivot), penché en avant, puis dans le sens de la figurine
const turn = (v, isPos) => `
  ${v}.yz = pitch(${v}.yz, ${isPos ? 'pivot' : 'vec2(0.0)'}, boneA);
  ${v}.yz = pitch(${v}.yz, vec2(0.0), lean);
  ${v} = vec3(${v}.x * sa + ${v}.z * ca, ${v}.y, -${v}.x * ca + ${v}.z * sa);`;

export class Troops {
  // relief : Relief (altitudes) ; q : profil de qualité ; year : année de la bataille (coiffures, uniformes)
  constructor(relief, q, year) {
    this.relief = relief; this.q = q; this.year = year || 1800;
    this.group = new THREE.Group();
    this.index = new Map();     // id du régiment → colonne de la texture des régiments
    this.free = [];
    this.lays = new Map();      // id → {key, lay}
    this.data = new Float32Array(MAXU * ROWS * 4);
    this.units = new THREE.DataTexture(this.data, MAXU, ROWS, THREE.RGBAFormat, THREE.FloatType);
    this.units.needsUpdate = true;
    const t = relief.t, hd = new Float32Array(t.fineW * t.fineH);
    for (let i = 0; i < hd.length; i++) hd[i] = (t.fine[i] - t.hmin) * relief.ex;
    this.heights = new THREE.DataTexture(hd, t.fineW, t.fineH, THREE.RedFormat, THREE.FloatType);
    this.heights.needsUpdate = true;
    this.uni = {
      uUnits: { value: this.units }, uHeight: { value: this.heights }, uHgt: { value: new THREE.Vector3(t.fineStep, t.fineW, t.fineH) },
      uTime: { value: 0 }, uFxT: { value: 0 }, uRobes: { value: ROBES.map(c => new THREE.Color(c)) },
    };
    this.kinds = new Map();     // sorte → {mesh, cap, n, slot, anim, coat}
    for (const k of ['inf', 'gren', 'leger', 'milice', 'officier', 'tambour', 'drapeau']) this.addKind(k, soldier(k, this.year));
    for (const k of ['cav', 'colonel']) this.addKind(k, horse(k, this.year), null, 'HORSE');
    this.addKind('attelage', horse(null, this.year), null, 'HORSE');
    this.addKind('servant', soldier('servant', this.year), null, 'CREW');
    this.addKind('canon', gun(), null, 'GUN');
    this.addKind('caisson', caisson(false), null, 'GUN');
    this.addKind('chariot', caisson(true), null, 'GUN');
    this.pattern = flagPattern(this.year);
    this.addKind('etoffe', flagCloth(), this.pattern);
    this.addKind('fanion', flagCloth(true), this.pattern);
    const soft = new THREE.CanvasTexture(relief.t.ombre);
    this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: soft, color: '#000000', transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), MAXU);
    this.blobs.count = 0; this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
    this.group.add(this.blobs);
  }

  // def : 'HORSE' (cheval), 'GUN' (pièce, voiture), 'CREW' (servant) : leur animation dans le vertex shader
  addKind(kind, geo, pattern = null, def = null) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: pattern ? THREE.DoubleSide : THREE.FrontSide });
    if (def) mat.defines = { [def]: '' };
    const place = `vec3 transformed = position;
          ${pattern ? `
          // l'étoffe ondule, d'autant plus loin de la hampe
          float k = 0.08 - transformed.z;
          transformed.x += sin(uTime * 4.2 - k * 2.0 + ph) * 0.12 * k;` : ''}
          ${turn('transformed', true)}
          transformed.y = transformed.y * crouch + bob;
          transformed *= aAnim.z;
          transformed += vec3(base.x, hAt(base), base.y);`;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni);
      if (pattern) sh.uniforms.uPattern = { value: pattern };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_HEAD + (pattern ? 'varying vec2 vUv2;' : ''))
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERT_POSE}\n${turn('objectNormal', false)}`)
        .replace('#include <begin_vertex>', (pattern ? 'vUv2 = uv;\n' : '') + place)
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = aPart > 1.5 ? uRobes[int(aAnim.x / 16.0) % 4] * color.r : mix(vColor.rgb, aCoat * color.r, aPart);\nvPart = aPart;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade, vPart;' + (pattern ? '\nuniform sampler2D uPattern; varying vec2 vUv2;' : ''))
        // régiment deviné (plus en vue) : transparent en pointillés, sans tri
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFade) discard;`)
        .replace('#include <color_fragment>', pattern ? 'diffuseColor.rgb *= mix(vColor.rgb, vec3(0.95), texture2D(uPattern, vUv2).a * step(0.5, vPart));' : '#include <color_fragment>');
    };
    mat.customProgramCacheKey = () => 'troupes-' + (pattern ? 'etoffe' : def || 'homme');
    // passe d'ombre : la même mise en place des figurines
    const depth = new THREE.MeshDepthMaterial();
    if (def) depth.defines = { [def]: '' };
    depth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD).replace('#include <begin_vertex>', VERT_POSE + place);
    };
    depth.customProgramCacheKey = () => 'troupes-ombre-' + (pattern ? 'etoffe' : def || 'homme');
    const k = { geo, mat, depth, mesh: null, cap: 0, n: 0, slot: null, anim: null, coat: null };
    this.kinds.set(kind, k);
    this.grow(k, 256);
  }
  grow(k, cap) {
    if (k.mesh) { this.group.remove(k.mesh); k.mesh.dispose(); }
    const slot = new Float32Array(cap * 4), anim = new Float32Array(cap * 4), coat = new Float32Array(cap * 3);
    if (k.slot) { slot.set(k.slot); anim.set(k.anim); coat.set(k.coat); }
    k.slot = slot; k.anim = anim; k.coat = coat; k.cap = cap;
    for (const a of ['aSlot', 'aAnim', 'aCoat']) k.geo.deleteAttribute(a);
    k.geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slot, 4).setUsage(THREE.DynamicDrawUsage));
    k.geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 4).setUsage(THREE.DynamicDrawUsage));
    k.geo.setAttribute('aCoat', new THREE.InstancedBufferAttribute(coat, 3).setUsage(THREE.DynamicDrawUsage));
    k.mesh = new THREE.InstancedMesh(k.geo, k.mat, cap);
    k.mesh.count = 0; k.mesh.frustumCulled = false;
    k.mesh.customDepthMaterial = k.depth; k.mesh.castShadow = !!this.castShadow;
    this.group.add(k.mesh);
  }

  // à chaque image : list, les régiments (hors combat exclus) ; colors, couleur de chaque camp ; time, horloge de
  // l'animation (s) ; fxT, horloge des effets (salves)
  update(list, colors, time, fxT) {
    this.uni.uTime.value = time; this.uni.uFxT.value = fxT;
    // hommes par figurine : autant qu'il faut pour tenir dans le budget de la qualité (par paliers de 25 % : la
    // disposition ne change pas à chaque perte)
    const men = list.reduce((a, u) => a + Math.min(u.men || 0, 480), 0), budget = this.q.troupes ?? this.q.figures * 2;
    const per = Math.pow(1.25, Math.max(0, Math.ceil(Math.log(men / budget) / Math.log(1.25))));
    const scale = SCALE * clamp(Math.sqrt(per), 1, 1.4);
    let dirty = this.per !== per;
    this.per = per;
    const seen = new Set();
    for (const un of list) {
      const id = String(un.id);
      seen.add(id);
      let i = this.index.get(id);
      if (i === undefined) { i = this.free.pop() ?? this.index.size; if (i >= MAXU) continue; this.index.set(id, i); dirty = true; }
      const key = `${un.form}|${un.state}|${Math.round((un.men || 0) / 8)}|${un.w | 0}|${un.d | 0}|${un.type}|${per}|${colors[un.side]}`;
      const e = this.lays.get(id);
      if (!e || e.key !== key) { this.lays.set(id, { key, lay: layout(un, per, scale), un }); dirty = true; } else e.un = un;
      // régiment : position, sens, opacité ; allure, feu, salve ; front, tirailleurs
      const moving = un.to && un.from && Math.hypot(un.to.x - un.from.x, un.to.y - un.from.y) > 0.3;
      const run = un.state === 'charge' || un.state === 'deroute', march = un.state === 'marche' || (moving && !run);
      const v = un._volley, o = i * 4, D = this.data, row = MAXU * 4;
      D[o] = un.x; D[o + 1] = un.y; D[o + 2] = un.dir; D[o + 3] = un._ghost ? 0.4 : un._fade ?? 1;
      D[row + o] = run ? 2 : march ? 1 : 0; D[row + o + 1] = un.state === 'feu' || un.state === 'recharge' ? 1 : 0;
      D[row + o + 2] = v ? v.t : -99; D[row + o + 3] = v ? v.dur : 1;
      D[2 * row + o] = v ? v.roll : 1; D[2 * row + o + 1] = Math.max(1, un.w); D[2 * row + o + 2] = un.form === 'tirailleurs' ? 1 : 0;
      for (let q = 0; q < 8; q++) D[(3 + (q >> 2)) * row + o + (q & 3)] = un._shots?.[q] ?? -99;
    }
    for (const [id, i] of this.index) if (!seen.has(id)) { this.index.delete(id); this.lays.delete(id); this.free.push(i); dirty = true; }
    this.units.needsUpdate = true;
    if (this.blobs.visible) this.drawBlobs(list);
    if (dirty) this.rebuild(colors, scale);
  }
  // toutes les figurines, rangées par sorte
  rebuild(colors, scale) {
    for (const k of this.kinds.values()) k.n = 0;
    const coat = new THREE.Color(), off = new THREE.Color();
    const FACE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    // face : sens imposé (servants), sinon celui de la face du carré ou du demi-tour
    const put = (kind, f, ui, carre, face = null) => {
      const k = this.kinds.get(kind);
      if (!k) return;
      if (k.n >= k.cap) this.grow(k, k.cap * 2);
      const n = k.n++, rank = f[5];
      k.slot.set([f[0], f[1], face ?? (carre && rank >= 0 ? FACE[f[3]] : f[3] === 2 ? Math.PI : 0), ui], n * 4);
      k.anim.set([f[4], f[6], scale, rank], n * 4);
      k.coat.set([coat.r, coat.g, coat.b], n * 3);
    };
    for (const [id, { lay, un }] of this.lays) {
      const ui = this.index.get(id), carre = un.form === 'carre';
      off.set(colors[un.side] || '#888');
      for (const f of lay) {
        coat.copy(off);
        if (f[2] === 'milice') coat.set('#7a6248');
        else if (f[2] === 'officier' || f[2] === 'drapeau' || f[2] === 'colonel') coat.multiplyScalar(0.8);
        else if (f[2] === 'servant') coat.multiplyScalar(0.6);   // habit sombre des artilleurs
        // l'écouvillon et le pointeur se tournent vers la pièce
        if (f[2] === 'servant' && (f[4] === 1 || f[4] === 3) && f[5] >= 200) put('servant', [f[0], f[1], 'servant', 9, 0, f[5], f[6]], ui, false, f[0] < (Math.floor((f[5] - 200) / 10) - (pieces(un) - 1) / 2) * (un.w / Math.max(1, pieces(un))) ? Math.PI / 2 : -Math.PI / 2);
        else put(f[2] === 'caisson' && f[4] === 1 ? 'chariot' : f[2], f, ui, carre);
        if (f[2] === 'drapeau') { coat.copy(off); put('etoffe', f, ui, carre); }
        else if (f[5] === -3) { coat.copy(off); put('fanion', f, ui, carre); }
      }
    }
    for (const k of this.kinds.values()) {
      k.mesh.count = k.n;
      for (const a of ['aSlot', 'aAnim', 'aCoat']) { const at = k.geo.attributes[a]; at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, k.n * at.itemSize); }
    }
  }
  // ombres portées des figurines (qualité Haute et Ultra) ; sinon une ombre douce sous chaque régiment (blobs)
  setShadows(on) {
    this.castShadow = on;
    for (const k of this.kinds.values()) k.mesh.castShadow = on;
    this.blobs.visible = !on;
  }
  // ombre douce sous chaque régiment : un panneau sombre posé au sol, à la taille de son emprise
  drawBlobs(list) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const un of list) {
      if (n >= this.blobs.instanceMatrix.count || un.state === 'deroute') continue;
      p.set(un.x, this.relief.heightAt(un.x, un.y) + 0.08, un.y);
      q.setFromAxisAngle(up, Math.PI / 2 - un.dir);
      this.blobs.setMatrixAt(n++, m.compose(p, q, s.set(Math.max(4, un.w) + 5, 1, Math.max(4, un.d) + 5)));
    }
    this.blobs.count = n; this.blobs.instanceMatrix.needsUpdate = true;
  }
  setQuality(q) { this.q = q; }
  dispose() {
    this.blobs.geometry.dispose(); this.blobs.material.dispose(); this.blobs.material.map.dispose();
    for (const k of this.kinds.values()) { k.geo.dispose(); k.mat.dispose(); k.depth.dispose(); k.mesh.dispose(); }
    this.units.dispose(); this.heights.dispose(); this.pattern.dispose();
  }
}
