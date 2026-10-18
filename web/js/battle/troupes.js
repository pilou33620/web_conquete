// Vue tactique : les régiments en 3D. Chaque régiment est fait de petites figurines (un homme par figurine tant que
// le budget de la qualité le permet), en rangs serrés : trois rangs pour une ligne, le carré à quatre faces, les
// tirailleurs par deux ; porte-drapeau (le drapeau flotte), tambours, officiers, colonel. Coiffures de l'époque
// (tricorne, bicorne, shako, képi, bonnet à poil, chapeau rond des miliciens).
//
// Les figurines sont des modèles construits ici (formes arrondies de près, quelques boîtes de loin ; couleurs par
// sommet), dessinés par lots (un InstancedMesh par sorte et par version). Chaque instance ne porte que sa place dans le régiment (u le long du front, v vers
// l'avant), son sens, sa pose, sa phase et la couleur de son habit. La position, le sens et l'état de chaque régiment
// sont dans une petite texture de données mise à jour à chaque image ; le vertex shader place la figurine, lit
// l'altitude dans une texture du relief, anime les membres (attribut « os » de chaque sommet) et fait rouler la salve
// le long du front. Le travail de chaque image est donc proportionnel au nombre de régiments.
//
// Les hommes à pied sont au squelette des animations précalculées (Quaternius, CC0 : dev/cuire.mjs, web/anims/) :
// chaque os suit sa matrice, lue dans la texture des animations au geste choisi par gestes.js (attributs aGest et
// aMix, réécrits quand l'activité du régiment change), avec un fondu entre deux gestes. Chevaux, pièces et fanions
// gardent l'animation par le code.
// Les dispositions (layout) ne sont recalculées que quand un régiment change de forme, d'effectif (par 8 hommes) ou
// d'état.
import * as THREE from '../../vendor/three/three.module.js';
import { clsOf, isLight, isGeneral, isWagon, pieces, hash, clamp, uniform } from './formes.js';
import { activity, moves, pick, firing, serving, variety, rows, chooseDead, chooseLine, pushRing, matchSlots, foeOf, scrum, scaleAt } from './gestes.js';

export const POSES = { STAND: 0, AIM: 1, RUN: 2, MARCH: 3, RELOAD: 5, ROUT: 7 };
const { AIM, RUN, ROUT } = POSES;
export const SCALE = 1.6;   // les figurines sont grandies : l'emprise du jeu (1,2 m par file) se lit épaule contre épaule
const MAXU = 512;           // régiments au plus (largeur de la texture des régiments)
const DEAD = MAXU - 1;      // sa dernière colonne : les corps au sol (un régiment fictif à l'origine, de sens 0)

const SKIN = '#e2b996', HAT = '#1f1b18', WHITE = '#f3efe4', WOOD = '#6e5134', IRON = '#2c2c2a', GOLD = '#d6b65a', LEATHER = '#2a1f16';
// teinte d'une pièce (assemble) : 0 sa couleur, 1 l'habit (aCoat), 2 la robe du cheval, CAMP la couleur du camp (aFace :
// revers, retroussis, collet, parements, tapis de selle, cercle du tambour ; de loin, le plastron et la ceinture), qui
// distingue des camps tous en uniforme français
const CAMP = 3;
const AFFUT = '#5f6b3e', BRONZE = '#b08a3e';   // affûts peints en vert olive, pièces de bronze
const ROWS = 5;     // lignes de la texture des régiments (la 4e et la 5e : l'instant du dernier coup de chaque pièce)
// sortes de figurines et leur animation dans le vertex shader (null : homme à pied, au squelette de près ; FLAG :
// étoffe d'un drapeau)
const KINDS = { inf: null, gren: null, leger: null, milice: null, piquier: null, officier: null, tambour: null, drapeau: null, cavalier: null, chef: null, cav: 'HORSE', colonel: 'HORSE',
  attelage: 'HORSE', servant: null, canon: 'GUN', caisson: 'GUN', chariot: 'GUN', etoffe: 'FLAG', fanion: 'FLAG' };
// tache d'ombre douce au sol sous chaque figurine (largeur, profondeur, décalage vers l'avant, en m avant l'échelle)
const CONTACT = { FOOT: [0.8, 0.66, 0], HORSE: [1.0, 2.5, 0], GUN: [1.7, 3.0, -0.3] };
const ROBES = ['#6b4a2c', '#3f2d1f', '#8b6a47', '#54402e'];   // robes des chevaux (bai, bai brun, alezan, noir pangaré)
const FOOT = Object.keys(KINDS).filter(k => KINDS[k] === null);   // les hommes à pied, au squelette
const DIES = [...FOOT, 'cav'];   // qui peut tomber (un cavalier tué : son cheval couché, lui avec)
const BALL = 6;                  // hommes couchés au plus par un boulet
const STILL = [0, 0, 0, 0];      // aucune course à sa place (aMove)
// bâtiments : milieu du corps en avant de sa place et demi-longueur, en m avant l'échelle (mesurés sur les modèles) ;
// un homme : sa place. Le cavalier et le fanion d'un régiment monté suivent leur cheval ; une pièce compte son avant-train
const PUSH = { HORSE: [0.24, 1.25], GUN: [0.75, 2.15] };
const pushOf = (kind, def) => PUSH[/^(cavalier|chef|fanion)/.test(kind) ? 'HORSE' : def] ?? [0, 0];
const RIDER = 9;                 // pose (aAnim.x) du cavalier en selle : le shader lui donne le balancement de son cheval
// variété de la figurine i d'un régiment (gestes.js), tirée une fois par disposition
const varOf = (e, i, seed) => (e.vars ??= [])[i] ??= variety(seed, e.ids?.[i] ?? i);
// graine d'un régiment (variété de ses hommes)
const seedOf = id => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
// (l'habit : l'uniforme français de l'époque et de l'arme, formes.uniform ; un peu plus sombre pour les officiers)
const COATS = new Map();   // (couleur d'un habit, lue une fois : rebuild en peint des milliers)
function coatOf(kind, c, un, year) {
  // (le piquier d'une milice garde ses habits civils)
  const hex = uniform(year, clsOf(un), un.name, kind === 'piquier' && un.type === 'milice' ? 'milice' : kind).coat;
  c.copy(COATS.get(hex) ?? COATS.set(hex, new THREE.Color(hex)).get(hex));
  if (kind === 'officier' || kind === 'drapeau' || kind === 'colonel' || kind === 'chef') c.multiplyScalar(0.8);
  return c;
}
// la culotte (ou le pantalon) d'une sorte de figurine à cette époque, peinte dans son modèle
const breeches = (kind, year) => uniform(year, kind === 'servant' ? 'artillerie' : kind === 'cavalier' || kind === 'chef' ? 'cavalerie' : 'inf', '', kind).trous;
// attributs de chaque figurine (nombres par figurine) : place, pose, habit ; geste (aGest : geste et son début, geste
// d'avant et son début ; aMix : instant du fondu, vitesse, vitesse d'avant) ; course à sa place (aMove)
export const INSTANCE_ATTRS = { aSlot: 4, aAnim: 4, aCoat: 3, aFace: 3, aGest: 4, aMix: 4, aMove: 4 };
// os du squelette des animations Quaternius (CC0, dev/cuire.mjs) dans l'ordre de leur texture, puis ceux des gestes du
// fusil (RIG_EXTRA) : le fusil, le bras et l'avant-bras gauches qui le portent
export const RIG = { hips: 'DEF-hips', chest: 'DEF-spine.003', head: 'DEF-head', upperL: 'DEF-upper_arm.L', foreL: 'DEF-forearm.L',
  upperR: 'DEF-upper_arm.R', foreR: 'DEF-forearm.R', thighL: 'DEF-thigh.L', shinL: 'DEF-shin.L', footL: 'DEF-foot.L',
  thighR: 'DEF-thigh.R', shinR: 'DEF-shin.R', footR: 'DEF-foot.R' };
export const RIG_EXTRA = ['musket', 'carryUpper', 'carryFore'];
const RIG_BONES = Object.fromEntries([...Object.keys(RIG), ...RIG_EXTRA].map((k, i) => [k, i]));
RIG_BONES.pole = RIG_BONES.musket;   // la hampe du drapeau, portée comme le fusil
// les mêmes morceaux sur les os de toujours (0 corps, 1 et 2 jambes, 3 bras et fusil)
const OLD_BONES = { hips: 0, chest: 0, head: 0, upperL: 3, foreL: 3, upperR: 3, foreR: 3, thighL: 1, shinL: 1, footL: 1, thighR: 2, shinR: 2, footR: 2,
  musket: 3, carryUpper: 3, carryFore: 3, pole: 0 };

// coiffure selon l'époque et le type (comme la vue 2D d'avant)
export function headgear(kind, year) {
  if (kind === 'milice') return 'rond';
  if (kind === 'officier' || kind === 'drapeau' || kind === 'chef') return year < 1815 ? 'bicorne' : year < 1860 ? 'shako' : 'kepi';
  if (kind === 'gren') return year < 1860 ? 'ourson' : 'kepi';
  if (year < 1795) return 'tricorne';
  if (year < 1806) return kind === 'leger' ? 'shako' : 'bicorne';
  return year < 1860 ? 'shako' : 'kepi';
}

// animations précalculées (web/anims/soldat.*, dev/cuire.mjs) : { meta, data } ; null si elles manquent (les hommes
// restent alors dans leur pose de référence)
export async function loadAnims() {
  try {
    const [meta, buf] = await Promise.all([fetch(new URL('../../anims/soldat.json', import.meta.url)).then(r => r.json()),
      fetch(new URL('../../anims/soldat.bin', import.meta.url)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })]);
    if (buf.byteLength !== meta.rows * meta.bones.length * 12 * 2) throw new Error('taille inattendue');
    return { meta, data: new Uint16Array(buf) };
  } catch (e) {
    console.error('animations des troupes introuvables (web/anims/soldat.*) :', e);
    return null;
  }
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
    // piquiers : l'infanterie armée « mousquet et piques » (arme 0), vers 1700 un homme sur cinq, au centre du bataillon
    const pike = !cav && un.arm === 0 && (kind === 'inf' || kind === 'milice');
    if (un.form === 'carre' && !cav) {
      // carré : trois rangs par face, tournés vers l'extérieur ; drapeau, tambours et officiers au milieu
      const ranks = n > 60 ? 3 : 2, per4 = Math.max(2, Math.round(n / 4 / ranks)), s = w / 2;
      for (let f = 0; f < 4; f++) for (let r = 0; r < ranks; r++) for (let k = 0; k < per4; k++) {
        const t = (k + 0.5) / per4 * 2 - 1, e = s - r * Math.min(sp, sr);
        const [u0, v0] = [[t * e, e], [e, -t * e], [-t * e, -e], [-e, t * e]][f];
        push(u0, v0, pike && k % 5 === 2 ? 'piquier' : kind, f, 0, r);
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
        const kd = pike && Math.abs(k + 0.5 - files / 2) < files * 0.1 ? 'piquier' : kind;
        push((k + 0.5) * du - w / 2 + stag + (rnd(r * 300 + k) - 0.5) * du * jit, v0 - r * dv + (rnd(r * 300 + k + 7) - 0.5) * dv * jit, kd, 0, cav ? ((r * 3 + k) % 4) << 4 : 0, r);
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
// Repère d'une figurine : +Z devant, +X à sa gauche, les pieds en 0, un homme mesure 1,75 m. L'os peut être une fonction
// de la hauteur du sommet (genou, coude, taille : le morceau se plie entre deux os).
function assemble(parts) {
  const pos = [], nor = [], col = [], bone = [], part = [], uv = [], idx = [];
  for (const [g, color, b, tint] of parts) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, base = pos.length / 3;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b); bone.push(typeof b === 'function' ? b(p.getY(i)) : b); part.push(tint); uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
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

// sph : ellipsoïde de rayons (rx, ry, rz) centré en (x, y, z) ; lathe : profil tourné autour de l'axe vertical
// ([rayon, y] du bas vers le haut), aplati d'avant en arrière (sz)
const sph = (rx, ry, rz, x, y, z, w = 8, h = 6) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz).translate(x, y, z);
const lathe = (pts, n, sz = 1, x = 0, z = 0) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n).scale(1, 1, sz).translate(x, 0, z);
// l'autre face d'une surface sans épaisseur (bord de chapeau, basques) : triangles retournés, normales inversées
function flip(g) {
  const b = (g.index ? g.toNonIndexed() : g.clone()), p = b.attributes.position, n = b.attributes.normal;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, n]) {
    const t = [a.getX(i + 1), a.getY(i + 1), a.getZ(i + 1)];
    a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, ...t);
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return b;
}
// bord de chapeau autour de la calotte (rayon rin) : lift relève le bord entre `corners` pointes (3 : tricorne), la
// première devant ; sans pointes (0), un bord rond à plat
function brim(rin, rout, y0, lift, corners, n = 24) {
  const pos = [], idx = [];
  for (let k = 0; k <= n; k++) {
    const a = k / n * Math.PI * 2, c = corners ? Math.cos(corners * a) : 1, ro = rout + 0.025 * c * (corners ? 1 : 0), up = lift * (0.5 - 0.5 * c);
    pos.push(Math.sin(a) * rin, y0 + up * 0.2, Math.cos(a) * rin, Math.sin(a) * ro, y0 + up, Math.cos(a) * ro);
  }
  for (let k = 0; k < n; k++) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const both = (g, color, b = 0, tint = 0) => [[g, color, b, tint], [flip(g), color, b, tint]];

// coiffure (le haut de la tête en y = 1,68) ; dy la remonte (cavalier en selle)
function hat(type, kind, dy = 0) {
  const plume = kind === 'gren' || kind === 'tambour' ? '#c83a2a' : kind === 'leger' ? '#4f8a3a' : '#f1ece0';
  if (dy) return hat(type, kind).map(([g, ...r]) => [g.translate(0, dy, 0), ...r]);
  const cockade = [sph(0.025, 0.025, 0.012, 0.1, 1.73, 0.1, 6, 4), '#f1ece0', 0, 0];
  switch (type) {
    // tricorne : calotte basse, bord relevé entre trois pointes (une devant), cocarde
    case 'tricorne': return [[lathe([[0.1, 1.655], [0.1, 1.72], [0.08, 1.76], [0, 1.77]], 10), HAT, 0, 0], ...both(brim(0.098, 0.2, 1.665, 0.1, 3), HAT), cockade];
    // bicorne porté en bataille (pointes sur les côtés) : un croissant haut, cocarde sur le côté
    case 'bicorne': return [[sph(0.25, 0.14, 0.075, 0, 1.665, 0, 12, 5), HAT, 0, 0], [lathe([[0.1, 1.64], [0.1, 1.7], [0, 1.72]], 10), HAT, 0, 0],
      [sph(0.035, 0.035, 0.015, 0.12, 1.74, 0.07, 6, 4), '#2f4fa0', 0, 0]];
    case 'shako': return [[lathe([[0.1, 1.66], [0.112, 1.8], [0.118, 1.88], [0, 1.88]], 12), HAT, 0, 0],
      ...both(new THREE.CylinderGeometry(0.125, 0.125, 0.01, 10, 1, true, -Math.PI / 2, Math.PI).scale(1, 1, 0.9).translate(0, 1.675, 0.02), HAT),
      [sph(0.022, 0.07, 0.022, 0, 1.94, 0.09, 6, 4), plume, 0, 0], [sph(0.022, 0.022, 0.01, 0, 1.84, 0.115, 6, 4), GOLD, 0, 0]];
    case 'kepi': return [[lathe([[0.1, 1.655], [0.095, 1.73], [0.085, 1.79], [0, 1.79]], 10).translate(0, -1.655, 0).rotateX(-0.12).translate(0, 1.655, 0), '#1f2a44', 0, 0],
      ...both(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 10, 1, true, -Math.PI / 2, Math.PI).scale(1, 1, 0.8).translate(0, 1.67, 0.03), HAT)];
    // bonnet à poil : haut et rond, plumet sur le côté
    case 'ourson': return [[lathe([[0.11, 1.63], [0.14, 1.72], [0.145, 1.86], [0.12, 1.98], [0.06, 2.03], [0, 2.04]], 10), '#1a1612', 0, 0],
      [sph(0.025, 0.09, 0.025, 0.12, 1.9, 0.04, 6, 4), plume, 0, 0]];
    // chapeau rond des miliciens : calotte, bord large un peu tombant
    default: return [[lathe([[0.105, 1.66], [0.1, 1.76], [0.085, 1.8], [0, 1.81]], 10), '#3d2f22', 0, 0], ...both(brim(0.1, 0.21, 1.67, -0.02, 0), '#3d2f22')];
  }
}
// fantassin (et encadrement, servants des pièces, cavaliers pour la selle) : kind 'inf' | 'gren' | 'leger' | 'milice' |
// 'officier' | 'tambour' | 'drapeau' | 'servant' | 'cavalier' | 'chef' (officier supérieur à cheval). Formes arrondies (normales lisses) : jambes et bras effilés, habit en profil tourné aplati,
// basques, tête ronde ; buffleteries, revers, giberne et havresac en plaques
// rig : os du squelette des animations (RIG) au lieu des quatre os de toujours
function soldier(kind, year, rig = false) {
  const B = rig ? RIG_BONES : OLD_BONES;
  const leg = s => y => y > 0.53 ? B['thigh' + s] : y > 0.09 ? B['shin' + s] : B['foot' + s];
  const torso = y => y < 1.05 ? B.hips : B.chest;
  const rider = kind === 'cavalier' || kind === 'chef', officer = kind === 'officier' || kind === 'drapeau' || kind === 'chef';
  const trous = breeches(kind, year);
  const gaiter = rider ? '#15110d' : year < 1845 && !officer ? '#1d1916' : trous;   // (les cavaliers : bottes)
  const facing = kind === 'milice' ? '#5a4632' : WHITE;
  const armed = !officer && !rider && kind !== 'tambour' && kind !== 'servant';
  const limb = (r0, r1, y0, y1, x, n = 7) => new THREE.CylinderGeometry(r0, r1, y1 - y0, n, 1, true).translate(x, (y0 + y1) / 2, 0);
  const P = [];
  // jambes (os 1 à gauche, 2 à droite ; la hanche en y = 0,86) : culotte, guêtre, soulier
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const b = leg(side);
    P.push([limb(0.07, 0.062, 0.46, 0.9, s * 0.085), trous, b, 0], [limb(0.058, 0.05, 0.05, 0.47, s * 0.085), gaiter, b, 0],
      [sph(0.052, 0.035, 0.115, s * 0.085, 0.035, 0.035, 6, 4), '#15110d', b, 0]);
  }
  // habit : du bas des hanches aux épaules, aplati d'avant en arrière ; basques derrière (les deux faces)
  P.push([lathe([[0.135, 0.84], [0.15, 0.95], [0.142, 1.06], [0.162, 1.22], [0.172, 1.34], [0.15, 1.43], [0.06, 1.48]], 10, 0.72), shade(1), torso, 1]);
  P.push(...both(new THREE.CylinderGeometry(0.14, 0.19, 0.4, 8, 1, true, Math.PI / 2, Math.PI).scale(1, 1, 0.75).translate(0, 0.7, -0.01), shade(0.8), B.hips, 1));
  const fz = kind === 'milice' ? 0 : CAMP;   // (la milice en habits civils : son foulard seul porte la couleur du camp)
  if (year < 1860) P.push([new THREE.BoxGeometry(0.28, 0.05, 0.015).translate(0, 0.52, -0.15), facing, B.hips, fz],   // retroussis
    [new THREE.BoxGeometry(0.17, 0.4, 0.015).translate(0, 1.2, 0.118), facing, B.chest, fz]);                    // revers (pas sur la capote de 1870)
  P.push([limb(0.075, 0.095, 1.44, 1.5, 0, 8), WHITE, B.chest, CAMP]);                                            // collet (foulard), au-dessus des épaules
  P.push([limb(0.045, 0.05, 1.44, 1.5, 0, 6), SKIN, B.head, 0], [sph(0.088, 0.105, 0.095, 0, 1.585, 0.005), SKIN, B.head, 0]);   // cou, tête
  if (year < 1800) P.push([limb(0.022, 0.018, 1.42, 1.56, 0, 5).translate(0, 0, -0.09), '#3a2c20', B.head, 0]);   // la queue
  if (armed) {
    for (const r of [0.5, -0.5]) P.push([new THREE.BoxGeometry(0.05, 0.62, 0.012).rotateZ(r).translate(0, 1.13, 0.125), WHITE, B.chest, 0]);   // buffleteries
    P.push([sph(0.11, 0.07, 0.04, 0, 0.92, -0.135, 8, 4), LEATHER, B.hips, 0]);                                // giberne
    // havresac plat, la couverture roulée dessus
    if (kind !== 'milice') P.push([new THREE.BoxGeometry(0.24, 0.25, 0.07).translate(0, 1.19, -0.16), '#6b5236', B.chest, 0],
      [new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6).rotateZ(Math.PI / 2).translate(0, 1.345, -0.15), '#9a9488', B.chest, 0]);
  }
  if (kind === 'cavalier') P.push([new THREE.BoxGeometry(0.05, 0.62, 0.012).rotateZ(0.5).translate(0, 1.13, 0.125), WHITE, B.chest, 0]);   // baudrier
  if (officer) {
    P.push([limb(0.15, 0.15, 0.86, 0.92, 0, 10).scale(1, 1, 0.75), '#c9a24a', B.hips, 0]);                    // écharpe
    for (const s of [1, -1]) P.push([sph(0.07, 0.025, 0.06, s * 0.17, 1.44, 0, 6, 4), GOLD, B.chest, 0]);       // épaulettes
    if (kind === 'officier') P.push([limb(0.012, 0.008, 0.25, 1.0, 0, 4).rotateX(0.45).translate(0.2, 0.03, 0.2), '#c0c4c8', B.hips, 0]);   // épée
  }
  if (kind === 'tambour') P.push([new THREE.CylinderGeometry(0.15, 0.15, 0.22, 12).rotateZ(1.2).translate(0.18, 0.78, 0.13), '#e8dcc0', B.hips, 0],
    [new THREE.CylinderGeometry(0.155, 0.155, 0.05, 12).rotateZ(1.2).translate(0.18, 0.78, 0.13), shade(0.9), B.hips, CAMP]);   // caisse cerclée aux couleurs du camp
  if (kind === 'drapeau') P.push([limb(0.022, 0.022, 0.5, 3.6, 0.24, 5).translate(0, 0, 0.08), WOOD, B.pole, 0], [sph(0.045, 0.06, 0.045, 0.24, 3.64, 0.08, 6, 4), GOLD, B.pole, 0]);
  // le sabre tiré, dans la main droite, pour les gestes d'escrime des animations
  if (rig && (kind === 'officier' || rider)) P.push([limb(0.004, 0.014, 0.02, 0.8, -0.21, 4).translate(0, 0, 0.03), '#c8ccd0', B.foreR, 0], [box(0.1, 0.02, 0.03, -0.21, 0.81, 0.03), GOLD, B.foreR, 0]);
  P.push(...hat(headgear(kind, year), kind).map(([g, c, , t]) => [g, c, B.head, t]));
  // bras (l'épaule en y = 1,40, le coude en 1,15) : épaule, manche, parement, main ; le fusil dans la main gauche (os à
  // eux : voir RIG_EXTRA)
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const b = armed && side === 'L' ? y => y > 1.16 ? B.carryUpper : B.carryFore : y => y > 1.16 ? B['upper' + side] : B['fore' + side];
    P.push([sph(0.058, 0.06, 0.06, s * 0.19, 1.39, 0, 6, 4), shade(0.95), b, 1],
      [new THREE.CylinderGeometry(0.052, 0.044, 0.5, 7, 2, true).translate(s * 0.2, 1.15, 0), shade(0.9), b, 1],
      [limb(0.048, 0.05, 0.87, 0.94, s * 0.2), facing, b, fz], [sph(0.04, 0.045, 0.04, s * 0.2, 0.84, 0, 5, 4), SKIN, b, 0]);   // parement
  }
  // la pique (près de cinq mètres), portée par l'os du fusil comme la hampe du drapeau
  if (kind === 'piquier') P.push([limb(0.018, 0.015, 0.3, 4.9, 0.235, 5).translate(0, 0, 0.055), WOOD, B.musket, 0],
    [limb(0.003, 0.022, 4.9, 5.15, 0.235, 4).translate(0, 0, 0.055), '#b8bcc0', B.musket, 0]);
  else if (armed) P.push([new THREE.BoxGeometry(0.035, 0.5, 0.065).translate(0.235, 1.03, 0.05), WOOD, B.musket, 0],
    [limb(0.012, 0.012, 1.28, 2.2, 0.235, 5).translate(0, 0, 0.055), IRON, B.musket, 0], [limb(0.003, 0.009, 2.2, 2.55, 0.235, 4).translate(0, 0, 0.055), '#b8bcc0', B.musket, 0]);
  const g = assemble(P);
  if (rig) stocky(g, B);
  return g;
}
// allure d'Ultimate General (essai des animations) : tête et coiffure plus fortes, buste plus large, les bras écartés
// d'autant (vu d'en haut, la silhouette se lit mieux)
function stocky(g, B) {
  const p = g.attributes.position, n = g.attributes.normal, b = g.attributes.aBone;
  const arms = [B.upperL, B.foreL, B.upperR, B.foreR, B.carryUpper, B.carryFore];
  for (let i = 0; i < p.count; i++) {
    const bone = b.getX(i), x = p.getX(i);
    if (bone === B.head) p.setXYZ(i, x * 1.25, 1.44 + (p.getY(i) - 1.44) * 1.25, p.getZ(i) * 1.25);
    else if (bone === B.hips || bone === B.chest) { p.setX(i, x * 1.1); n.setX(i, n.getX(i) / 1.1); }
    else if (arms.includes(bone)) p.setX(i, x + Math.sign(x) * 0.017);
  }
  g.normalizeNormals();
}
// l'étoffe du drapeau, accrochée en haut de la hampe du porte-drapeau, flottant vers l'arrière ; l'étendard d'un
// cavalier (fanion de l'état-major) a sa hampe avec lui
function flagCloth(rider = false, rig = false) {
  if (rider) return assemble([[new THREE.PlaneGeometry(1.2, 0.85, 6, 2).rotateY(Math.PI / 2).translate(-0.3, 3.4, 0.08 - 0.6), shade(1), 4, 1],
    [box(0.04, 2.2, 0.04, -0.3, 2.75, 0.08), WOOD, 0, 0], [box(0.07, 0.1, 0.07, -0.3, 3.88, 0.08), GOLD, 0, 0]]);
  return assemble([[new THREE.PlaneGeometry(2, 1.4, 8, 3).rotateY(Math.PI / 2).translate(0.24, 2.85, 0.08 - 1), shade(1), rig ? RIG_BONES.pole : 4, 1]]);
}
// roue à rayons (le moyeu en (x, y, z), axe selon x)
function wheel(P, r, x, y, z) {
  P.push([new THREE.TorusGeometry(r - 0.03, 0.035, 4, 18).rotateY(Math.PI / 2).translate(x, y, z), '#6a5a3a', 0, 0]);
  for (let k = 0; k < 4; k++) P.push([new THREE.BoxGeometry(0.03, r * 2 - 0.08, 0.035).rotateX(k * Math.PI / 4).translate(x, y, z), '#7a6844', 0, 0]);
  P.push([new THREE.CylinderGeometry(0.09, 0.09, 0.16, 8).rotateZ(Math.PI / 2).translate(x, y, z), IRON, 0, 0]);
}
// pièce de campagne : fût de bronze galbé (bourrelet de bouche, culasse et bouton), affût à flasques qui descend vers
// la crosse, deux roues à rayons ; la bouche vers +Z
function gun() {
  const barrel = [[0, -1.1], [0.07, -1.09], [0.08, -1.04], [0.16, -1.0], [0.165, -0.84], [0.145, -0.82], [0.14, 0.25], [0.125, 0.28],
    [0.115, 0.95], [0.135, 1.0], [0.135, 1.06], [0.075, 1.07], [0.07, 1.0]];
  const P = [[lathe(barrel, 12).rotateX(Math.PI / 2).translate(0, 1.0, 0.52), BRONZE, 0, 0],
    [new THREE.CylinderGeometry(0.05, 0.05, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 1.0, 0.25), BRONZE, 0, 0]];   // tourillons
  for (const s of [1, -1]) {
    P.push([new THREE.BoxGeometry(0.07, 0.3, 1.95).rotateX(-0.25).translate(s * 0.17, 0.74, -0.4), AFFUT, 0, 0]);
    wheel(P, 0.62, s * 0.48, 0.62, 0.1);
  }
  P.push([new THREE.BoxGeometry(0.36, 0.12, 0.3).translate(0, 0.16, -1.4), AFFUT, 0, 0], [new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6).rotateZ(Math.PI / 2).translate(0, 0.62, 0.1), IRON, 0, 0]);
  return assemble(P);
}
// avant-train ou caisson à munitions (le timon vers +Z) ; wagon : chariot de munitions bâché, à quatre roues
function caisson(wagon) {
  const P = [];
  const wheels = z => { for (const s of [1, -1]) wheel(P, 0.58, s * 0.55, 0.58, z); P.push([new THREE.CylinderGeometry(0.045, 0.045, 1.15, 6).rotateZ(Math.PI / 2).translate(0, 0.58, z), IRON, 0, 0]); };
  if (wagon) {
    P.push([new THREE.BoxGeometry(1.0, 0.5, 2.4).translate(0, 1.05, 0), '#7a5a3a', 0, 0], [new THREE.CylinderGeometry(0.6, 0.6, 2.3, 12, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 1.3, 0), '#e8e0c8', 0, 0]);
    wheels(0.8); wheels(-0.8);
    P.push([new THREE.CylinderGeometry(0.03, 0.03, 1.8, 5).rotateX(Math.PI / 2).translate(0, 0.75, 2.0), WOOD, 0, 0]);
  } else {
    // coffre au couvercle bombé
    P.push([new THREE.BoxGeometry(0.9, 0.5, 1.1).translate(0, 0.98, 0), AFFUT, 0, 0],
      [new THREE.CylinderGeometry(0.46, 0.46, 1.12, 10, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 0.3, 1).translate(0, 1.23, 0), '#4c5632', 0, 0]);
    wheels(0);
    P.push([new THREE.CylinderGeometry(0.03, 0.03, 2.0, 5).rotateX(Math.PI / 2).translate(0, 0.72, 1.45), WOOD, 0, 0]);
  }
  return assemble(P);
}
// cheval (2,3 m de long, 1,55 m au garrot) en formes arrondies : corps en capsule, poitrail et croupe, encolure et tête
// effilées, jambes fines ; rider : 'cav' (cavalier), 'colonel' (officier supérieur, général) ou rien (cheval
// d'attelage, avec son collier). Os : 1 et 2 jambes avant (épaule en y = 0,85, z = 0,6), 5 et 6 arrière, 7 encolure,
// 8 bras du cavalier
function horse(rider, year) {
  const P = [], R = (k, g, b = 0) => [g, shade(k), b, 2];
  // un segment de cylindre effilé de a à b (points [x, y, z]), rayons ra puis rb
  const seg = (a, b, ra, rb, n = 8) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), h = d.length();
    const g = new THREE.CylinderGeometry(rb, ra, h, n, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  };
  P.push(R(1, new THREE.CapsuleGeometry(0.3, 0.95, 4, 10).rotateX(Math.PI / 2).scale(0.82, 1, 1).translate(0, 1.16, -0.02)));   // corps
  P.push(R(0.97, sph(0.25, 0.31, 0.27, 0, 1.2, 0.6)), R(1, sph(0.27, 0.3, 0.3, 0, 1.2, -0.55)));                                  // poitrail, croupe
  P.push(R(0.95, seg([0, 1.28, 0.72], [0, 1.86, 1.0], 0.19, 0.11).scale(0.75, 1, 1), 7));                                          // encolure
  P.push(R(0.9, seg([0, 1.93, 1.0], [0, 1.64, 1.4], 0.1, 0.065).scale(0.72, 1, 1), 7), R(0.88, sph(0.075, 0.1, 0.12, 0, 1.86, 1.1, 7, 5), 7),
    R(0.85, sph(0.06, 0.065, 0.07, 0, 1.62, 1.42, 6, 4), 7));                                                                       // tête, ganache, naseaux
  for (const s of [1, -1]) P.push(R(0.8, new THREE.ConeGeometry(0.03, 0.1, 4).translate(s * 0.05, 2.0, 0.98), 7));                // oreilles
  P.push([seg([0, 1.42, 0.78], [0, 1.98, 0.98], 0.05, 0.035, 5).scale(0.5, 1, 1).translate(0, 0.03, -0.06), '#1a1410', 7, 0]);  // crinière
  for (const [x, z, b, hind] of [[0.15, 0.6, 1, 0], [-0.15, 0.6, 2, 0], [0.15, -0.6, 5, 1], [-0.15, -0.6, 6, 1]]) {
    P.push(R(0.92, seg([x, 1.0, z], [x, 0.5, z - hind * 0.06], hind ? 0.12 : 0.09, 0.055), b), R(0.75, seg([x, 0.5, z - hind * 0.06], [x, 0.1, z], 0.045, 0.04, 6), b),
      [new THREE.CylinderGeometry(0.045, 0.055, 0.1, 6).translate(x, 0.05, z + 0.01), '#1a1410', b, 0]);
  }
  P.push([seg([0, 1.3, -0.82], [0, 0.62, -0.98], 0.07, 0.03, 6), '#1a1410', 0, 0]);                                                 // queue
  if (!rider) {
    // collier, sangle et dossière
    P.push([new THREE.TorusGeometry(0.17, 0.055, 5, 12).rotateX(-0.5).scale(0.85, 1, 1).translate(0, 1.42, 0.8), '#3a2a1a', 0, 0],
      [new THREE.TorusGeometry(0.29, 0.025, 4, 14).scale(0.86, 1.04, 1).translate(0, 1.15, 0.3), '#2a1e14', 0, 0],
      [new THREE.BoxGeometry(0.1, 0.03, 1.0).translate(0, 1.47, -0.15), '#2a1e14', 0, 0]);
    return assemble(P);
  }
  // cheval de selle : le tapis, à la couleur du camp ; le cavalier est une figurine à part, au squelette (cavalier, chef)
  P.push([new THREE.CylinderGeometry(0.315, 0.315, 0.55, 10, 1, true, Math.PI * 0.62, Math.PI * 0.76).rotateX(Math.PI / 2).scale(0.86, 1, 1).translate(0, 1.17, 0), shade(0.85), 0, CAMP]);   // tapis de selle
  return assemble(P);
}
// ------------------------------------------------------------------ versions de loin
// Quand une figurine ne fait que quelques pixels à l'écran, les formes arrondies ne se voient plus : une version en
// quelques boîtes, mêmes os, même hauteur, même coiffure en gros, au plus un tiers des sommets.
function farHat(type, dy = 0) {
  const P = (() => {
    switch (type) {
      case 'tricorne': return [[cyl(0.2, 0.22, 0.09, 3, 0, 1.71, 0.01), HAT]];
      case 'bicorne': return [[box(0.48, 0.16, 0.09, 0, 1.725, 0), HAT]];
      case 'shako': return [[cyl(0.115, 0.105, 0.22, 6, 0, 1.77, 0), HAT], [box(0.04, 0.13, 0.04, 0, 1.945, 0.08), '#f1ece0']];
      case 'kepi': return [[cyl(0.095, 0.105, 0.135, 6, 0, 1.72, 0), '#1f2a44']];
      case 'ourson': return [[cyl(0.14, 0.12, 0.41, 6, 0, 1.835, 0), '#1a1612']];
      default: return [[cyl(0.2, 0.2, 0.02, 6, 0, 1.67, 0), '#3d2f22'], [cyl(0.1, 0.1, 0.14, 6, 0, 1.74, 0), '#3d2f22']];
    }
  })();
  return P.map(([g, c]) => [g.translate(0, dy, 0), c, 0, 0]);
}
function farSoldier(kind, year, rig = false) {
  const B = rig ? RIG_BONES : OLD_BONES, rider = kind === 'cavalier' || kind === 'chef';
  const trous = breeches(kind, year);
  const officer = kind === 'officier' || kind === 'drapeau' || kind === 'chef', armed = !officer && !rider && kind !== 'tambour' && kind !== 'servant';
  // jambes : un bloc coupé à mi-hauteur, le haut à la cuisse, le milieu au tibia, le bas au pied (le genou plie)
  const P = [];
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) P.push([new THREE.BoxGeometry(0.13, 0.86, 0.14, 1, 2, 1).translate(s * 0.085, 0.43, 0), trous, y => y > 0.53 ? B['thigh' + side] : y > 0.09 ? B['shin' + side] : B['foot' + side], 0]);
  P.push([box(0.36, 0.74, 0.22, 0, 1.09, 0), shade(1), y => y < 1.05 ? B.hips : B.chest, 1], [box(0.17, 0.2, 0.18, 0, 1.57, 0), SKIN, B.head, 0],
    ...farHat(headgear(kind, year)).map(([g, c, , t]) => [g, c, B.head, t]));
  // le plastron à la couleur du camp (de loin, les revers ne font plus qu'un pixel), l'écharpe d'or des officiers ; une
  // ceinture à la couleur du camp tout autour de la taille : un régiment vu de dos (le nôtre, d'ordinaire) se lit aussi
  // bien que de face
  P.push([box(0.2, 0.36, 0.02, 0, 1.18, 0.115), officer ? GOLD : WHITE, B.chest, officer ? 0 : CAMP],
    [box(0.38, 0.1, 0.24, 0, 0.92, 0), WHITE, B.hips, CAMP]);
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const up = armed && side === 'L' ? B.carryUpper : B['upper' + side], fore = armed && side === 'L' ? B.carryFore : B['fore' + side];
    P.push([box(0.1, 0.56, 0.11, s * 0.22, 1.13, 0), shade(0.9), y => y > 1.16 ? up : fore, 1]);
  }
  // fusil et baïonnette, plus épais que nature pour faire un trait d'au moins un pixel de loin
  if (kind === 'piquier') P.push([box(0.07, 4.6, 0.07, 0.25, 2.6, 0.05), '#4a3a2c', B.musket, 0], [box(0.06, 0.3, 0.06, 0.25, 5.05, 0.05), '#c8ccd0', B.musket, 0]);
  else if (armed) P.push([box(0.1, 1.4, 0.08, 0.25, 1.5, 0.05), '#4a3a2c', B.musket, 0], [box(0.06, 0.36, 0.06, 0.25, 2.38, 0.05), '#c8ccd0', B.musket, 0]);
  if (kind === 'tambour') P.push([cyl(0.15, 0.15, 0.22, 6, 0.18, 0.78, 0.13, 0, 1.2), '#e8dcc0', B.hips, 0]);
  if (kind === 'drapeau') P.push([box(0.045, 3.1, 0.045, 0.24, 2.05, 0.08), WOOD, B.pole, 0]);
  if (rig && rider) P.push([box(0.03, 0.8, 0.03, -0.21, 0.42, 0.03), '#c8ccd0', B.foreR, 0]);   // le sabre, dans la main droite
  const g = assemble(P);
  if (rig) stocky(g, B);
  return g;
}
function farHorse(rider, year) {
  const R = (k, g, b = 0) => [g, shade(k), b, 2];
  const P = [R(1, box(0.46, 0.55, 1.6, 0, 1.16, 0)), R(0.95, box(0.22, 0.65, 0.3, 0, 1.58, 0.88, 0.5), 7), R(0.9, box(0.2, 0.22, 0.5, 0, 1.8, 1.22, 0.6), 7),
    [box(0.08, 0.6, 0.1, 0, 1.0, -0.85, 0.3), '#1a1410', 0, 0]];
  for (const [x, z, b] of [[0.15, 0.6, 1], [-0.15, 0.6, 2], [0.15, -0.6, 5], [-0.15, -0.6, 6]]) P.push(R(0.85, box(0.12, 0.9, 0.14, x, 0.45, z), b));
  if (rider) P.push([box(0.6, 0.08, 0.6, 0, 1.46, 0), shade(0.85), 0, CAMP]);   // tapis de selle (le cavalier est à part)
  return assemble(P);
}
function farGun() {
  const P = [[cyl(0.12, 0.15, 2.1, 6, 0, 1.0, 0.52, Math.PI / 2), BRONZE, 0, 0], [box(0.4, 0.3, 1.95, 0, 0.74, -0.4, -0.25), AFFUT, 0, 0], [box(0.36, 0.12, 0.3, 0, 0.16, -1.4), AFFUT, 0, 0]];
  for (const s of [1, -1]) P.push([cyl(0.62, 0.62, 0.08, 8, s * 0.48, 0.62, 0.1, 0, Math.PI / 2), '#6a5a3a', 0, 0]);
  return assemble(P);
}
function farCaisson(wagon) {
  const P = [];
  const wheels = z => { for (const s of [1, -1]) P.push([cyl(0.58, 0.58, 0.08, 8, s * 0.55, 0.58, z, 0, Math.PI / 2), '#6a5a3a', 0, 0]); };
  if (wagon) { P.push([box(1.0, 0.5, 2.4, 0, 1.05, 0), '#7a5a3a', 0, 0], [cyl(0.6, 0.6, 2.3, 6, 0, 1.3, 0, Math.PI / 2), '#e8e0c8', 0, 0], [box(0.06, 0.06, 1.8, 0, 0.75, 2.0), WOOD, 0, 0]); wheels(0.8); wheels(-0.8); }
  else { P.push([box(0.9, 0.5, 1.1, 0, 0.98, 0), AFFUT, 0, 0], [box(0.92, 0.12, 1.12, 0, 1.31, 0), '#4c5632', 0, 0], [box(0.06, 0.06, 2.0, 0, 0.72, 1.45), WOOD, 0, 0]); wheels(0); }
  return assemble(P);
}

// géométrie d'une sorte de figurine ; lod : 1 de près (formes arrondies), 0 de loin (quelques boîtes) ; rig : fantassin
// sur les os du squelette des animations (RIG)
export function model(kind, year, lod = 1, rig = false) {
  if (!lod) switch (kind) {
    case 'cav': case 'colonel': return farHorse(kind, year);
    case 'attelage': return farHorse(null, year);
    case 'canon': return farGun();
    case 'caisson': return farCaisson(false);
    case 'chariot': return farCaisson(true);
    case 'etoffe': case 'fanion': break;
    default: return farSoldier(kind, year, rig);
  }
  switch (kind) {
    case 'cav': case 'colonel': return horse(kind, year);
    case 'attelage': return horse(null, year);
    case 'canon': return gun();
    case 'caisson': return caisson(false);
    case 'chariot': return caisson(true);
    case 'etoffe': return flagCloth(false, rig);
    case 'fanion': return flagCloth(true);
    default: return soldier(kind, year, rig);
  }
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
attribute vec4 aMove;   // course à sa place : départ (u, v), début, durée (négative : au pas ; 0 : aucune)
attribute vec3 aCoat;   // couleur de l'habit
attribute vec3 aFace;   // couleur du camp (pièces de teinte CAMP)
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
// bâtiments (terrain.js, buildingGrid) : une figurine dont le corps (le cercle de rayon r autour de p) mord sur une
// maison en sort par le bord le plus proche (comme gestes.js, pushOut)
uniform sampler2D uBGrid, uBRect;
uniform vec4 uBox;      // origine de la grille (x, y), pas (0 : aucun bâtiment), colonnes
uniform vec2 uBDim;     // lignes de la grille, bâtiments
uniform vec2 uPush;     // sa sorte : milieu du corps en avant de sa place, demi-longueur (PUSH)
vec2 pushOut(vec2 p, float r) {
  ivec2 c = ivec2(floor((p - uBox.xy) / max(uBox.z, 1.0)));
  if (uBox.z <= 0.0 || c.x < 0 || c.y < 0 || c.x >= int(uBox.w) || c.y >= int(uBDim.x)) return p;
  vec4 ids = texelFetch(uBGrid, c, 0);
  for (int k = 0; k < 4; k++) {
    int i = int(ids[k]) - 1;
    if (i < 0) break;
    vec4 a = texelFetch(uBRect, ivec2(i, 0), 0), h = texelFetch(uBRect, ivec2(i, 1), 0) + r;
    float ca = cos(a.z), sa = sin(a.z);
    vec2 d = p - a.xy;
    float u = d.x * ca + d.y * sa, v = -d.x * sa + d.y * ca;
    if (abs(u) >= h.x || abs(v) >= h.y) continue;
    if (h.x - abs(u) < h.y - abs(v)) u = sign(u + 1e-6) * h.x; else v = sign(v + 1e-6) * h.y;
    p = a.xy + vec2(u * ca - v * sa, u * sa + v * ca);
  }
  return p;
}
#if defined(RIG)
attribute vec4 aGest;   // geste et son début, geste d'avant et son début (horloge des effets)
attribute vec4 aMix;    // instant du fondu, vitesse, vitesse d'avant
uniform float uTrot, uPas;   // gestes de la course (trot, pas)
uniform sampler2D uAnim;
uniform vec4 uClips[NCLIP];   // chaque geste : première ligne de la texture, images, en boucle
uniform float uFps;
vec4 R(int b, int f, int k) { return texelFetch(uAnim, ivec2(b * 3 + k, f), 0); }
// les trois lignes de la matrice de l'os b, dans le geste id commencé à t0 et joué à la vitesse sp
void bone(float id, float t0, float sp, int b, out vec4 r0, out vec4 r1, out vec4 r2) {
  vec4 c = uClips[int(id)];
  float n = c.y, fr = max(uFxT - t0, 0.0) * sp * uFps;
  fr = c.z > 0.5 ? mod(fr, n) : min(fr, n - 1.0);
  int f0 = int(c.x) + int(fr), f1 = int(c.x) + int(c.z > 0.5 ? mod(fr + 1.0, n) : min(fr + 1.0, n - 1.0));
  float a = fract(fr);
  r0 = mix(R(b, f0, 0), R(b, f1, 0), a); r1 = mix(R(b, f0, 1), R(b, f1, 1), a); r2 = mix(R(b, f0, 2), R(b, f1, 2), a);
}
#endif
`;
const VERT_POSE = `
  int ui = int(aSlot.w);
  vec4 u0 = texelFetch(uUnits, ivec2(ui, 0), 0);   // x, y, sens, opacité
  vec4 u1 = texelFetch(uUnits, ivec2(ui, 1), 0);   // allure (0 arrêt, 1 marche, 2 course), feu, début de la salve, durée
  vec4 u2 = texelFetch(uUnits, ivec2(ui, 2), 0);   // sens de la salve, front (m), tirailleurs
  vec4 u3 = texelFetch(uUnits, ivec2(ui, 3), 0), u4 = texelFetch(uUnits, ivec2(ui, 4), 0);   // dernier coup de chaque pièce
  float P = aAnim.x, ph = aAnim.y, rank = aAnim.w, slotV = aSlot.y, slotX = aSlot.x, face = aSlot.z;
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
  // course à sa place (nouvelle disposition) : sa place glisse du départ à l'arrivée ; en chemin il court (ou marche),
  // tourné vers sa route, puis reprend sa place face au front. Hommes, chevaux et leurs cavaliers, pièces
  float run = 0.0, runGait = aMove.w > 0.0 ? 2.0 : 1.0;   // (allure en chemin : trot ou galop, sinon le pas)
  if (aMove.w != 0.0) {
    float dur = abs(aMove.w), mt = clamp((uFxT - aMove.z) / dur, 0.0, 1.0);
    vec2 d = aSlot.xy - aMove.xy;
    slotX = mix(aMove.x, aSlot.x, mt); slotV = mix(aMove.y, aSlot.y, mt);
    run = smoothstep(0.0, 0.1, uFxT - aMove.z) * (1.0 - smoothstep(dur - 0.15, dur + 0.15, uFxT - aMove.z));
    // (dans le repère du régiment, u vers la gauche, v devant : la route fait l'angle atan(du, dv) avec le front)
    if (run > 0.0) face += (mod(atan(d.x, d.y) - face + 3.14159265, 6.28318531) - 3.14159265) * run;
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
#elif defined(HORSE)
  // cheval : la pose de la disposition porte la robe (× 16) et, en déroute, le galop (2) ; sinon l'allure du régiment.
  // Au pas, les jambes vont par paires en diagonale ; au galop, l'une après l'autre, le cheval se soulève.
  float gait = run > 0.5 ? runGait : mod(aAnim.x, 4.0) > 1.5 ? 2.0 : u1.x;   // (aAnim.x : P a pu prendre la pose de marche des fantassins)
  float fq = gait > 1.5 ? 11.0 : 6.5, am = gait > 1.5 ? 0.65 : gait > 0.5 ? 0.32 : 0.0, t = uTime * fq + ph;
  float aFL = sin(t) * am, aFR = sin(t + (gait > 1.5 ? 0.7 : 3.14)) * am, aHL = sin(t + (gait > 1.5 ? 2.2 : 3.14)) * am, aHR = sin(t + (gait > 1.5 ? 2.9 : 0.0)) * am;
  boneA = aBone == 1.0 ? aFL : aBone == 2.0 ? aFR : aBone == 5.0 ? aHL : aBone == 6.0 ? aHR : aBone == 7.0 ? sin(t) * am * 0.3 : aBone == 8.0 && gait > 1.5 ? 1.2 : 0.0;
  pivot = aBone == 1.0 || aBone == 2.0 ? vec2(0.85, 0.6) : aBone == 5.0 || aBone == 6.0 ? vec2(0.85, -0.6) : aBone == 7.0 ? vec2(1.4, 0.75) : vec2(2.2, 0.0);
  bob = gait > 1.5 ? abs(sin(t)) * 0.12 : gait > 0.5 ? abs(sin(t * 2.0)) * 0.03 : 0.0;
  // au choc d'une charge (u2.w : son instant), les chevaux du premier rang se cabrent un instant, sur leurs sabots
  // arrière (l'avant se lève, l'arrière reste au sol)
  float ri = uFxT - u2.w;
  if (rank == 0.0 && ri > 0.0 && ri < 1.2) { float rr = sin(3.14159 * ri / 1.2) * 0.55; lean = -rr; bob += 0.6 * sin(rr); boneA = aBone == 1.0 || aBone == 2.0 ? 0.9 * rr : boneA; }
  if (rank < -8.0) { boneA = 0.0; bob = 0.0; }   // cheval tué (rang −9 : voir kill)
#elif defined(RIG)
  // homme au squelette : la matrice de son os dans son geste, fondue avec celle du geste d'avant pendant 0,3 s
  int bi = int(aBone + 0.5);
  vec4 r0, r1, r2;
  bone(aGest.x, aGest.y, aMix.y, bi, r0, r1, r2);
  float bw = clamp((uFxT - aMix.x) / 0.3, 0.0, 1.0);
  if (bw < 1.0) {
    vec4 p0, p1, p2;
    bone(aGest.z, aGest.w, aMix.z, bi, p0, p1, p2);
    bw = smoothstep(0.0, 1.0, bw);
    r0 = mix(p0, r0, bw); r1 = mix(p1, r1, bw); r2 = mix(p2, r2, bw);
  }
  // cavalier (aAnim.x = 9, RIDER) : le balancement de son cheval (même formule que les chevaux, même phase), et il se
  // cabre avec lui au choc
  if (P > 8.5) {
    float g = run > 0.5 ? runGait : u1.x;   // (l'allure de son cheval, course à sa place comprise)
    float t = uTime * (g > 1.5 ? 11.0 : 6.5) + ph, ri = uFxT - u2.w;
    bob = g > 1.5 ? abs(sin(t)) * 0.12 : g > 0.5 ? abs(sin(t * 2.0)) * 0.03 : 0.0;
    if (rank == 0.0 && ri > 0.0 && ri < 1.2) { float rr = sin(3.14159 * ri / 1.2) * 0.55; lean = -rr; bob += 0.6 * sin(rr); }
  }
  // en course à sa place, un homme à pied trotte ou marche (le cavalier, lui, reste en selle)
  if (run > 0.0 && P < 8.5) {
    vec4 q0, q1, q2;
    bone(aMove.w > 0.0 ? uTrot : uPas, aMove.z, 1.0, bi, q0, q1, q2);
    r0 = mix(r0, q0, run); r1 = mix(r1, q1, run); r2 = mix(r2, q2, run);
  }
#else
  if (P == 3.0) { swing = sin(uTime * 8.2 + ph) * 0.38; bob = abs(sin(uTime * 8.2 + ph)) * 0.03; }
  else if (P == 2.0 || P == 7.0) { swing = sin(uTime * 13.0 + ph) * 0.65; bob = abs(sin(uTime * 13.0 + ph)) * 0.06; lean = 0.18; arm = P == 2.0 ? 1.25 : 0.35; }
  if (P == 1.0) arm = 1.55; else if (P == 5.0) arm = 0.45;
  boneA = aBone == 1.0 ? swing : aBone == 2.0 ? -swing : aBone == 3.0 ? arm : 0.0;
  if (aBone == 3.0) pivot = vec2(1.4, 0.0);
#endif
  float fa = u0.z + face, sa = sin(fa), ca = cos(fa);
  vec2 fw = vec2(cos(u0.z), sin(u0.z)), base = u0.xy + fw * slotV + vec2(-fw.y, fw.x) * slotX;
  // (un homme : sa place ; un cheval et son cavalier, une pièce et son avant-train : tout leur long)
  vec2 mid = base + vec2(ca, sa) * uPush.x * aAnim.z;
  base += pushOut(mid, uPush.y * aAnim.z) - mid;
  vFade = u0.w;
`;
// tourne un vecteur de la figurine : membre (sa matrice au squelette, sinon autour de son pivot), penché en avant, puis
// dans le sens de la figurine
const turn = (v, isPos) => `
#if defined(RIG)
  ${v} = ${isPos ? `vec3(dot(r0, vec4(${v}, 1.0)), dot(r1, vec4(${v}, 1.0)), dot(r2, vec4(${v}, 1.0)))` : `vec3(dot(r0.xyz, ${v}), dot(r1.xyz, ${v}), dot(r2.xyz, ${v}))`};
  ${v}.yz = pitch(${v}.yz, vec2(0.0), lean);   // (un cavalier qui se cabre avec son cheval)
#else
  ${v}.yz = pitch(${v}.yz, ${isPos ? 'pivot' : 'vec2(0.0)'}, boneA);
  ${v}.yz = pitch(${v}.yz, vec2(0.0), lean);
#endif
#if defined(HORSE)
  // cheval tué : couché sur le flanc, un quart de tour autour de sa longueur
  if (rank < -8.0) ${v} = vec3(-${v}.y${isPos ? ' + 1.0' : ''}, ${v}.x${isPos ? ' + 0.32' : ''}, ${v}.z);
#endif
  ${v} = vec3(${v}.x * sa + ${v}.z * ca, ${v}.y, -${v}.x * ca + ${v}.z * sa);`;

// version d'un régiment : 0 hors champ (rien à dessiner), 1 de loin, 2 de près. px : hauteur d'une figurine à l'écran
// (px CSS) ; entre les deux seuils, il garde sa version (pas de bascule à chaque image)
const NEAR_ON = 18, NEAR_OFF = 14;
export function lodOf(px, prev, visible) {
  if (!visible) return 0;
  return px > (prev === 2 ? NEAR_OFF : NEAR_ON) ? 2 : 1;
}

export class Troops {
  // relief : Relief (altitudes) ; q : profil de qualité ; year : année de la bataille (coiffures, uniformes) ; anims :
  // animations précalculées (loadAnims), null si elles manquent
  constructor(relief, q, year, anims = null) {
    this.relief = relief; this.q = q; this.year = year || 1800;
    this.group = new THREE.Group();
    this.index = new Map();     // id du régiment → colonne de la texture des régiments
    this.free = [];
    this.lays = new Map();      // id → {key, lay, un, lod}
    this.data = new Float32Array(MAXU * ROWS * 4);
    this.units = new THREE.DataTexture(this.data, MAXU, ROWS, THREE.RGBAFormat, THREE.FloatType);
    this.units.needsUpdate = true;
    const t = relief.t, hd = new Float32Array(t.fineW * t.fineH);
    for (let i = 0; i < hd.length; i++) hd[i] = (t.fine[i] - t.hmin) * relief.ex;
    this.heights = new THREE.DataTexture(hd, t.fineW, t.fineH, THREE.RedFormat, THREE.FloatType);
    this.heights.needsUpdate = true;
    // sans animations : une seule image, chaque os à sa place (matrice identité), pour tous les gestes
    const nb = Object.keys(RIG).length + RIG_EXTRA.length;
    const meta = anims?.meta ?? { fps: 24, rows: 1, clips: Object.fromEntries(['repos', 'parle', 'marche', 'trot', 'course', 'charge', 'joue', 'recharge', 'estoc'].map(c => [c, { row: 0, n: 1, loop: 1 }])) };
    const data = anims?.data ?? Uint16Array.from({ length: nb * 12 }, (_, i) => [0, 5, 10].includes(i % 12) ? 0x3c00 : 0);
    this.anim = new THREE.DataTexture(data, nb * 3, meta.rows, THREE.RGBAFormat, THREE.HalfFloatType);
    this.anim.needsUpdate = true;
    // bâtiments, pour en repousser les hommes et les chevaux (shader : pushOut)
    const bg = relief.t.buildingGrid?.();
    const tex = (d, w, h) => Object.assign(new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.FloatType), { needsUpdate: true });
    this.bgrid = bg ? tex(bg.cells, bg.cols, bg.rows) : tex(new Float32Array(4), 1, 1);
    this.brect = bg ? tex(bg.rects, bg.n, 2) : tex(new Float32Array(8), 1, 2);
    this.clipId = new Map(Object.keys(meta.clips).map((c, i) => [c, i]));
    this.clipLoop = Object.values(meta.clips).map(c => c.loop);
    this.uni = {
      uUnits: { value: this.units }, uHeight: { value: this.heights }, uHgt: { value: new THREE.Vector3(t.fineStep, t.fineW, t.fineH) },
      uTime: { value: 0 }, uFxT: { value: 0 }, uRobes: { value: ROBES.map(c => new THREE.Color(c)) },
      uBGrid: { value: this.bgrid }, uBRect: { value: this.brect }, uBox: { value: new THREE.Vector4(bg?.x0 ?? 0, bg?.y0 ?? 0, bg?.cell ?? 0, bg?.cols ?? 1) },
      uBDim: { value: new THREE.Vector2(bg?.rows ?? 1, bg?.n ?? 1) },
      uAnim: { value: this.anim }, uFps: { value: meta.fps }, uTrot: { value: this.clipId.get('trot') ?? 0 }, uPas: { value: this.clipId.get('pas') ?? 0 }, uClips: { value: Object.values(meta.clips).map(c => new THREE.Vector4(c.row, c.n, c.loop, 0)) },
    };
    this.kinds = new Map();     // sorte → {mesh, cap, n, slot, anim, coat}
    this.pattern = flagPattern(this.year);
    this.soft = new THREE.CanvasTexture(relief.t.ombre);
    this.contactMats = {};
    // chaque sorte en deux versions (« ~ » : de loin), sauf les drapeaux
    for (const [k, def] of Object.entries(KINDS)) {
      // (l'étoffe du porte-drapeau suit sa hampe, au squelette ; le fanion d'un cavalier suit son cheval)
      if (def === 'FLAG') { this.addKind(k, model(k, this.year, 1, k === 'etoffe'), this.pattern, k === 'etoffe' ? 'RIG' : null); continue; }
      this.addKind(k, model(k, this.year, 1, !def), null, def ?? 'RIG');
      this.addKind(k + '~', model(k, this.year, 0, !def), null, def ?? 'RIG');
    }
    this.frustum = new THREE.Frustum(); this.sphere = new THREE.Sphere(); this.m4 = new THREE.Matrix4();
    this.built = -1; this.pending = false;
    this.dead = [];             // corps au sol (anneau plafonné par la qualité) : {kind, x, y, a, t, size, coat, c, lod}
    this.data[DEAD * 4 + 3] = 1;
  }

  // def : 'RIG' (homme au squelette), 'HORSE' (cheval), 'GUN' (pièce, voiture) : leur animation dans le vertex shader
  addKind(kind, model, pattern = null, def = null) {
    // géométrie instanciée sans matrice par figurine (attributs : INSTANCE_ATTRS ; WebGL n'en permet que 16)
    const geo = new THREE.InstancedBufferGeometry().copy(model);
    model.dispose();
    const defines = def ? { [def]: '', NCLIP: this.uni.uClips.value.length } : {};
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: pattern ? THREE.DoubleSide : THREE.FrontSide });
    mat.defines = defines;
    const place = `vec3 transformed = position;
          ${pattern ? `
          // l'étoffe ondule, d'autant plus loin de la hampe
          float k = 0.08 - transformed.z;
          transformed.x += sin(uTime * 4.2 - k * 2.0 + ph) * 0.12 * k;` : ''}
          ${turn('transformed', true)}
          transformed.y += bob;
          transformed *= aAnim.z;
          transformed += vec3(base.x, hAt(base), base.y);`;
    const push = { value: new THREE.Vector2(...pushOf(kind, def)) };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni, { uPush: push });
      if (pattern) sh.uniforms.uPattern = { value: pattern };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_HEAD + (pattern ? 'varying vec2 vUv2;' : ''))
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERT_POSE}\n${turn('objectNormal', false)}`)
        .replace('#include <begin_vertex>', (pattern ? 'vUv2 = uv;\n' : '') + place)
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = aPart > 2.5 ? aFace * color.r : aPart > 1.5 ? uRobes[int(aAnim.x / 16.0) % 4] * color.r : mix(vColor.rgb, aCoat * color.r, aPart);\nvPart = aPart;' +
          // plus sombre vers les pieds : l'ombre des rangs, comme une occlusion ambiante (pas pour les étoffes)
          (pattern ? '' : '\nvColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 1.5, position.y));'));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade, vPart;' + (pattern ? '\nuniform sampler2D uPattern; varying vec2 vUv2;' : ''))
        // régiment deviné (plus en vue) : transparent en pointillés, sans tri
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vFade < 0.995 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFade) discard;`)
        .replace('#include <color_fragment>', pattern ? 'diffuseColor.rgb *= mix(vColor.rgb, vec3(0.95), texture2D(uPattern, vUv2).a * step(0.5, vPart));' : '#include <color_fragment>')
        // lumière enveloppante : le côté à l'ombre n'est pas noir, le passage est doux (figurines arrondies du prototype)
        .replace('#include <lights_lambert_pars_fragment>', THREE.ShaderChunk.lights_lambert_pars_fragment
          .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );', 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) * 0.6 + 0.4 );'));
    };
    mat.customProgramCacheKey = () => 'troupes-' + (pattern ? 'etoffe-' : '') + (def || 'homme');
    // passe d'ombre : la même mise en place des figurines
    const depth = new THREE.MeshDepthMaterial();
    depth.defines = defines;
    depth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni, { uPush: push });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD).replace('#include <begin_vertex>', VERT_POSE + place);
    };
    depth.customProgramCacheKey = () => 'troupes-ombre-' + (pattern ? 'etoffe-' : '') + (def || 'homme');
    const k = { geo, mat, depth, mesh: new THREE.Mesh(geo, mat), cap: 0, n: 0, buf: {}, rig: def === 'RIG', contactGeo: null, contact: null };
    k.mesh.frustumCulled = false; k.mesh.customDepthMaterial = depth; k.mesh.castShadow = !!this.castShadow;
    this.group.add(k.mesh);
    // ombre de contact : un carré posé au sol sous la figurine, qui suit sa place et son pas (pas pour les drapeaux, ni
    // pour les cavaliers : leur cheval a la sienne)
    if (!pattern && !/^(cavalier|chef)/.test(kind)) {
      const [cw, cd, cz] = CONTACT[def] ?? CONTACT.FOOT;
      k.contactGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(cw, cd).rotateX(-Math.PI / 2).translate(0, 0, cz));
      for (const a of ['aBone', 'aPart']) k.contactGeo.setAttribute(a, new THREE.Float32BufferAttribute(new Float32Array(4), 1));
      k.contact = new THREE.Mesh(k.contactGeo, this.contactMat(def));
      k.contact.frustumCulled = false; k.contact.renderOrder = 1;
      this.group.add(k.contact);
    }
    this.kinds.set(kind, k);
    this.grow(k, 256);
  }
  // tampons des figurines d'une sorte, agrandis en gardant leur contenu
  grow(k, cap) {
    // (Three borne les instances dessinées au nombre vu au premier rendu : dispose() l'oublie et libère les anciens tampons)
    k.geo.dispose(); k.contactGeo?.dispose();
    for (const [a, w] of Object.entries(INSTANCE_ATTRS)) {
      const b = new Float32Array(cap * w);
      if (k.buf[a]) b.set(k.buf[a]);
      k.buf[a] = b;
      k.geo.deleteAttribute(a);
      k.geo.setAttribute(a, new THREE.InstancedBufferAttribute(b, w).setUsage(THREE.DynamicDrawUsage));
      k.contactGeo?.setAttribute(a, k.geo.attributes[a]);   // les mêmes tampons
    }
    k.cap = cap;
  }
  // matériau des ombres de contact, un par animation (le servant et la pièce se déplacent en tirant)
  contactMat(def) {
    if (this.contactMats[def]) return this.contactMats[def];
    const m = new THREE.MeshBasicMaterial({ map: this.soft, color: '#000000', transparent: true, opacity: 0.65, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    if (def) m.defines = { [def]: '', NCLIP: this.uni.uClips.value.length };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uni, { uPush: { value: new THREE.Vector2(...pushOf('', def)) } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD).replace('#include <begin_vertex>', `${VERT_POSE}
          // chaque coin à l'altitude du sol sous lui : la tache épouse la pente (relief exagéré)
          vec2 cp = base + vec2(position.x * sa + position.z * ca, -position.x * ca + position.z * sa) * aAnim.z;
          #if defined(RIG)
            // au squelette, la tache suit les hanches (os 0) : un homme penché, un homme couché
            vec2 hp = vec2(r0.y * 0.92 + r0.w, r2.y * 0.92 + r2.w) * aAnim.z;
            cp += vec2(hp.x * sa + hp.y * ca, -hp.x * ca + hp.y * sa);
          #endif
          vec3 transformed = vec3(cp.x, hAt(cp) + 0.06, cp.y);`);
      // un régiment deviné n'a pas d'ombre ; un régiment qui s'efface la perd avec lui
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade, vPart;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= step(0.5, vFade) * vFade;');
    };
    m.customProgramCacheKey = () => 'troupes-contact-' + (def || 'homme');
    return (this.contactMats[def] = m);
  }

  // à chaque image : list, les régiments (hors combat exclus) ; colors, couleur de chaque camp ; time, horloge de
  // l'animation (s) ; fxT, horloge des effets (salves) ; fr, camera : la vue (camera.js, caméra de Three.js), pour la
  // version de chaque régiment
  update(list, colors, time, fxT, fr = null, camera = null) {
    this.uni.uTime.value = time; this.uni.uFxT.value = fxT; this.fxT = fxT;
    // hommes par figurine : autant qu'il faut pour tenir dans le budget de la qualité (par paliers de 25 % : la
    // disposition ne change pas à chaque perte)
    const men = list.reduce((a, u) => a + Math.min(u.men || 0, 480), 0), budget = this.q.troupes ?? 10000;
    const per = Math.pow(1.25, Math.max(0, Math.ceil(Math.log(men / budget) / Math.log(1.25))));
    const scale = SCALE * clamp(Math.sqrt(per), 1, 1.4);
    let dirty = this.per !== per;
    this.per = per;
    if (camera) { camera.updateMatrixWorld(); this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); }
    const seen = new Set();
    for (const un of list) {
      const id = String(un.id);
      seen.add(id);
      let i = this.index.get(id);
      if (i === undefined) { i = this.free.pop() ?? this.index.size; if (i >= DEAD) continue; this.index.set(id, i); dirty = true; }
      // distance (au bout le plus proche : une longue ligne vue de biais passe en version proche par ce bout) et hauteur
      // d'une figurine à l'écran ; la sphère, élargie avec la distance, fait entrer le régiment avant le bord de l'image
      let px = Infinity, vis = true;
      if (fr && camera) {
        const h = this.relief.heightAt(un.x, un.y), d = Math.max(1, Math.hypot(un.x - fr.E[0], h - fr.E[1], un.y - fr.E[2]) - Math.hypot(un.w || 10, un.d || 10) / 2);
        this.sphere.center.set(un.x, h + 1.5, un.y); this.sphere.radius = Math.hypot(un.w || 10, un.d || 10) / 2 + 15 + d * 0.15;
        vis = this.frustum.intersectsSphere(this.sphere); px = 1.75 * scale * fr.k / d;
      }
      // de loin, des figurines plus grandes (×k) et moins nombreuses (k² fois plus d'hommes chacune : gestes.js, scaleAt)
      let e = this.lays.get(id);
      const k = px === Infinity ? 1 : scaleAt(px, e?.k ?? 1);
      const key = `${un.form}|${un.state}|${Math.round((un.men || 0) / 8)}|${un.w | 0}|${un.d | 0}|${un.type}|${per}|${k}|${colors[un.side]}`;
      if (!e || e.key !== key) {
        const old = e;
        // (lost : les pertes pas encore tombées, en figurines de la nouvelle disposition)
        this.lays.set(id, e = { key, k, per: per * k * k, scale: scale * k, lay: layout(un, per * k * k, scale * k), un, lod: old?.lod ?? 0, act: old?.act, actT: old?.actT, impactT: old?.impactT, volT: old?.volT, vol: old?.vol, shotT: old?.shotT, shots: old?.shots, moving: old?.moving, fire: old?.fire, prev: old?.prev, switchT: old?.switchT, lost: (old?.lost ?? 0) * (old?.per ?? 1) / (per * k * k) });
        if (un.state === 'melee') this.scrum(e, un, list);
        if (old) this.relay(old, e);
        // un nouveau régiment est dessiné tout de suite ; une disposition qui change (pertes, palier de la vue de loin)
        // attend la prochaine reconstruction : au plus cinq par seconde
        if (old) this.pending = true; else dirty = true;
      } else e.un = un;
      un._figScale = e.scale / SCALE;   // (effets.js : la fumée de ses salves à l'échelle de ses figurines)
      // version : un régiment qui entre dans le champ est dessiné tout de suite ; les autres changements attendent la
      // prochaine reconstruction (au plus cinq par seconde)
      const lod = fr && camera ? lodOf(px * k, e.lod, vis) : 2;
      if (lod !== e.lod) { if (!e.lod) dirty = true; else this.pending = true; e.lod = lod; }
      // régiment : position, sens, opacité ; allure, feu, salve ; front, tirailleurs
      const moving = moves(un);
      const run = un.state === 'charge' || un.state === 'deroute', march = un.state === 'marche' || (moving && !run);
      // geste des hommes au squelette : réécrit quand l'activité du régiment change, qu'il tire une salve ou qu'elle
      // finit (sans reconstruire)
      const act = activity(un, moving), volT = un._volley?.t, shotT = Math.max(-99, ...Object.values(un._shots || {}));
      const busy = firing(un._volley, fxT) || serving(un._shots, fxT);
      if (e.act !== act || e.volT !== volT || e.shotT !== shotT || (e.fire && !busy)) {
        // ce qu'il faisait jusque-là : le geste d'avant de chacun, pour le fondu
        e.prev = e.act === undefined ? null : { act: e.act, actT: e.actT, volley: e.vol, shots: e.shots, moving: e.moving, now: fxT };
        e.switchT = fxT;
        if (e.act !== act) { if (e.act === 'charge' && act === 'melee') e.impactT = fxT; e.act = act; e.actT = fxT; }
        e.volT = volT; e.vol = un._volley; e.shotT = shotT; e.shots = { ...un._shots }; e.moving = moving; e.fire = busy;
        if (e.figs && !dirty) this.gestures(e, true);
      }
      const v = un._volley, o = i * 4, D = this.data, row = MAXU * 4;
      D[o] = un.x; D[o + 1] = un.y; D[o + 2] = un.dir; D[o + 3] = un._ghost ? 0.4 : un._fade ?? 1;
      D[row + o] = run ? 2 : march ? 1 : 0; D[row + o + 1] = un.state === 'feu' || un.state === 'recharge' ? 1 : 0;
      D[row + o + 2] = v ? v.t : -99; D[row + o + 3] = v ? v.dur : 1;
      D[2 * row + o] = v ? v.roll : 1; D[2 * row + o + 1] = Math.max(1, un.w); D[2 * row + o + 2] = un.form === 'tirailleurs' ? 1 : 0;
      D[2 * row + o + 3] = e.impactT ?? -99;   // choc de sa charge (les chevaux se cabrent)
      for (let q = 0; q < 8; q++) D[(3 + (q >> 2)) * row + o + (q & 3)] = un._shots?.[q] ?? -99;
    }
    for (const [id, i] of this.index) if (!seen.has(id)) { this.index.delete(id); this.lays.delete(id); this.free.push(i); dirty = true; }
    // corps : version de près ou de loin selon la distance, rien hors champ (revu deux fois par seconde)
    if (this.dead.length && fr && camera && time - (this.deadT ?? -9) > 0.5) {
      this.deadT = time;
      for (const b of this.dead) {
        this.sphere.center.set(b.x, this.relief.heightAt(b.x, b.y), b.y); this.sphere.radius = 3;
        const lod = lodOf(1.75 * scale * fr.k / Math.max(1, Math.hypot(b.x - fr.E[0], this.sphere.center.y - fr.E[1], b.y - fr.E[2])), b.lod, this.frustum.intersectsSphere(this.sphere));
        if (lod !== b.lod) { b.lod = lod; this.pending = true; }
      }
    }
    this.units.needsUpdate = true;
    if (dirty || (this.pending && time - this.built > 0.2)) { this.rebuild(colors, scale); this.built = time; this.pending = false; }
  }
  // toutes les figurines, rangées par sorte
  rebuild(colors, scale) {
    for (const k of this.kinds.values()) k.n = 0;
    const coat = new THREE.Color(), off = new THREE.Color(), tint = new THREE.Color();
    const FACE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    // face : sens imposé (servants), sinon celui de la face du carré ou du demi-tour
    // v : variété de l'homme (gestes.js) pour les figurines au squelette : place, sens, taille, nuance de l'habit
    // mv : sa course à sa place (aMove), ou rien ; pose : celle de la disposition, sinon imposée (cavalier : RIDER)
    const put = (kind, f, ui, carre, face = null, e = null, v = null, mv = null, pose = f[4]) => {
      const k = this.kinds.get(kind);
      if (!k) return;
      if (k.n >= k.cap) this.grow(k, k.cap * 2);
      const n = k.n++, rank = f[5], o = n * 4, { aSlot: S, aAnim: A, aCoat: C } = k.buf, w = k.rig && v;
      if (k.rig) e.figs.push([k, n, f, v, kind.replace('~', '')]);
      S[o] = f[0] + (w ? v.du : 0); S[o + 1] = f[1] + (w ? v.dv : 0); S[o + 2] = (face ?? f[7] ?? (carre && rank >= 0 ? FACE[f[3]] : f[3] === 2 ? Math.PI : 0)) + (w ? v.da : 0); S[o + 3] = ui;
      A[o] = pose; A[o + 1] = f[6]; A[o + 2] = (e?.scale ?? scale) * (w ? v.size : 1); A[o + 3] = rank;
      if (w) tint.copy(coat).offsetHSL(v.hue, v.sat, v.light);
      k.buf.aMove.set(mv ?? STILL, o);
      const c = w ? tint : coat;
      C[n * 3] = c.r; C[n * 3 + 1] = c.g; C[n * 3 + 2] = c.b;
      const F = k.buf.aFace; F[n * 3] = off.r; F[n * 3 + 1] = off.g; F[n * 3 + 2] = off.b;
    };
    for (const [id, e] of this.lays) {
      const { lay, un, lod } = e;
      e.figs = [];
      if (!lod) continue;
      const ui = this.index.get(id), carre = un.form === 'carre', far = lod === 1 ? '~' : '', seed = seedOf(id);
      off.set(colors[un.side] || '#888');
      for (const [i, f] of lay.entries()) {
        if (e.dead?.has(i)) continue;   // tombé (kill) : il est parmi les corps
        const v = varOf(e, i, seed), mv = e.moves?.[i];
        coatOf(f[2], coat, un, this.year);
        // l'écouvillon et le pointeur se tournent vers la pièce
        if (f[2] === 'servant' && (f[4] === 1 || f[4] === 3) && f[5] >= 200) put('servant' + far, [f[0], f[1], 'servant', 9, 0, f[5], f[6]], ui, false, f[0] < (Math.floor((f[5] - 200) / 10) - (pieces(un) - 1) / 2) * (un.w / Math.max(1, pieces(un))) ? Math.PI / 2 : -Math.PI / 2, e, v, mv);
        else put((f[2] === 'caisson' && f[4] === 1 ? 'chariot' : f[2]) + far, f, ui, carre, null, e, v, mv);
        // son cavalier, en selle (même place, même phase : il suit le balancement du cheval ; ni décalage, ni sens, ni
        // taille à lui : il est sur la selle)
        if (f[2] === 'cav' || f[2] === 'colonel') put((f[2] === 'cav' ? 'cavalier' : 'chef') + far, f, ui, carre, null, e, { ...v, du: 0, dv: 0, da: 0, size: 1 }, mv, RIDER);
        if (f[2] === 'drapeau') { coat.copy(off); put('etoffe', f, ui, carre, null, e, v, mv); }
        else if (f[5] === -3) { coat.copy(off); put('fanion', f, ui, carre, null, e, null, mv); }
      }
      this.gestures(e, false);
    }
    // les corps : leur geste (« mort », « projeté ») joué depuis l'instant de la chute, puis sa dernière image (couché) ;
    // un cheval tué, couché par le shader (rang −9), garde sa robe
    for (const b of this.dead) {
      const k = b.lod && this.kinds.get(b.kind + (b.lod === 1 ? '~' : ''));
      if (!k) continue;
      if (k.n >= k.cap) this.grow(k, k.cap * 2);
      const n = k.n++, o = n * 4, c = this.clipId.get(b.clip) ?? 0;
      k.buf.aSlot.set([b.y, b.x, b.a, DEAD], o); k.buf.aAnim.set([b.horse ? b.pose : 0, 0, scale * b.size, b.horse ? -9 : 0], o); k.buf.aCoat.set(b.coat, n * 3); k.buf.aFace.set(b.face ?? b.coat, n * 3);
      k.buf.aGest.set([c, b.t, c, b.t], o); k.buf.aMix.set([-99, 1, 1, 0], o); k.buf.aMove.set(STILL, o);
    }
    for (const k of this.kinds.values()) {
      // une sorte vide n'est ni dessinée ni envoyée (une plage vide renverrait tout le tableau à la carte graphique)
      k.geo.instanceCount = k.n; k.mesh.visible = k.n > 0;
      if (k.contact) { k.contactGeo.instanceCount = k.n; k.contact.visible = k.n > 0; }
      if (!k.n) continue;
      for (const a of Object.keys(INSTANCE_ATTRS)) { const at = k.geo.attributes[a]; at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, k.n * at.itemSize); }
    }
  }
  // gestes des hommes au squelette d'un régiment (aGest, aMix), selon son activité, leur rang, leur place le long du
  // front et sa dernière salve (gestes.js, pick). part : n'envoyer que leurs plages (sans reconstruction)
  gestures(e, part) {
    const span = new Map(), un = e.un, shape = { w: Math.max(1, un.w), form: un.form };
    const base = { ...shape, act: e.act, actT: e.actT ?? 0, now: this.fxT ?? 0, volley: un._volley, shots: un._shots, moving: e.moving }, prev = e.prev && { ...shape, ...e.prev };
    const id = ([name, t0]) => [this.clipId.get(name) ?? 0, t0], loop = c => this.clipLoop[c];
    // (l'homme est écrit dans les deux mêmes objets : pas de copie par homme)
    const man = (o, kind, f) => { o.kind = kind; o.rank = f[5]; o.u = f[0]; o.phase = f[6]; return o; };
    for (const [k, n, f, v, kind] of e.figs) {
      const kd = kind === 'etoffe' ? f[2] : kind;
      const [g, m] = rows(id(pick(man(base, kd, f))), prev && id(pick(man(prev, kd, f))), e.switchT ?? 0, v, loop);
      k.buf.aGest.set(g, n * 4); k.buf.aMix.set(m, n * 4);
      if (part) { const r = span.get(k); span.set(k, r ? [Math.min(r[0], n), Math.max(r[1], n)] : [n, n]); }
    }
    for (const [k, [a, b]] of span) for (const name of ['aGest', 'aMix']) {
      const at = k.geo.attributes[name];
      at.addUpdateRange(a * 4, (b - a + 1) * 4); at.needsUpdate = true;
    }
  }
  // un régiment perd n hommes : autant de figurines tombent et deviennent des corps à l'endroit et dans le sens de leur
  // chute, étalées sur 1,5 s : sous la mousqueterie, surtout le premier rang (« mort ») ; un boulet (line : sa
  // trajectoire [[u, v], [u, v]] dans le repère du régiment) couche au plus BALL hommes de la file qu'il traverse
  // (« projeté »), les autres pertes du relevé tombent comme sous la mousqueterie. Un cavalier tué :
  // son cheval couché. bare(x, y) : sol où un corps peut reposer (ni bâtiment ni eau) ; color : couleur du camp.
  // Renvoie les corps sortis de l'anneau (plafond de la qualité), à repeindre en taches au sol
  kill(un, n, bare, color, line = null) {
    const id = String(un.id), e = this.lays.get(id);
    if (!e || !this.per) return [];
    // (déjà tombés : exclus ; hommes par figurine : au moins effectif / figurines, car une batterie a un nombre fixe de
    // servants qui comptent chacun plusieurs hommes)
    const cand = e.lay.map((f, i) => [f, i]).filter(([f, i]) => DIES.includes(f[2]) && !e.dead?.has(i));
    e.lost = (e.lost ?? 0) + n / Math.max(e.per ?? this.per, (un.men || 0) / Math.max(1, cand.length));
    const k = Math.min(Math.floor(e.lost), cand.length);
    if (k < 1) return [];
    e.lost -= k;
    const seed = seedOf(id), c = Math.cos(un.dir), s = Math.sin(un.dir), col = new THREE.Color(), out = [], figs = cand.map(([f]) => f);
    const fc = new THREE.Color(color), face = [fc.r, fc.g, fc.b];   // (la couleur de son camp : ses revers)
    const ball = line ? chooseLine(figs, Math.min(k, BALL), ...line) : [], rest = cand.map((_, j) => j).filter(j => !ball.includes(j));
    const shot = chooseDead(rest.map(j => figs[j]), k - ball.length, seed + Math.round((this.fxT ?? 0) * 10)).map(r => rest[r]);
    for (const j of [...ball, ...shot]) {
      const [f, i] = cand[j], v = varOf(e, i, seed), uu = f[0] + v.du, vv = f[1] + v.dv, hit = ball.includes(j);
      (e.dead ??= new Set()).add(i);
      const x = un.x + c * vv - s * uu, y = un.y + s * vv + c * uu;
      if (!bare(x, y)) continue;
      coatOf(f[2], col, un, this.year).offsetHSL(v.hue, v.sat, v.light);
      const horse = f[2] === 'cav', cap = this.q.corps ?? 2500, gone = pushRing(this.dead, cap, { kind: f[2], horse, pose: f[4], clip: hit ? 'projete' : 'mort',
        x, y, a: un.dir + (f[3] === 2 ? Math.PI : 0) + v.da + (hash(i, 23, seed) - 0.5) * 1.2,
        t: (this.fxT ?? 0) + (hit ? 0 : hash(i, 29, seed) * 1.5), size: v.size, coat: [col.r, col.g, col.b], face, c: color, lod: 2 });
      // son cavalier, tombé à 1,2 m sur le côté
      const rx = x - s * 1.2, ry = y + c * 1.2;
      if (horse && bare(rx, ry)) gone.push(...pushRing(this.dead, cap, { kind: 'cavalier', clip: 'mort', x: rx, y: ry,
        a: un.dir + (hash(i, 37, seed) - 0.5) * 2, t: (this.fxT ?? 0) + 0.3, size: v.size, coat: [col.r, col.g, col.b], face, c: color, lod: 2 }));
      for (const old of gone) out.push({ k: old.horse ? 'cheval' : 'mort', x: old.x, y: old.y, a: old.a, c: old.c });
    }
    this.pending = true;   // (redessinés à la prochaine reconstruction, au plus cinq par seconde)
    return out;
  }
  // mêlée : les premiers rangs avancent vers l'adversaire et se tournent vers lui (gestes.js, foeOf, scrum : le sens
  // de chacun dans f[7])
  scrum(e, un, list) {
    const foe = foeOf(un, list);
    if (!foe) return;
    const c = Math.cos(un.dir), s = Math.sin(un.dir), dx = foe.x - un.x, dy = foe.y - un.y, l = Math.hypot(dx, dy) || 1;
    const dir = [(-s * dx + c * dy) / l, (c * dx + s * dy) / l], seed = seedOf(String(un.id));
    e.lay.forEach((f, i) => {
      if (!FOOT.includes(f[2])) return;
      const [a, b, face] = scrum(f[5], dir, hash(i, 31, seed));
      f[0] += a; f[1] += b; f[7] = face;
    });
  }
  // nouvelle disposition e d'un régiment (old : la précédente) : chaque homme garde son numéro (gestes.js, matchSlots :
  // même sorte, file par file, sans les tués), donc sa variété ; chacun (hommes, chevaux et leurs cavaliers, pièces)
  // court de là où il est jusqu'à sa nouvelle place (au trot ou au galop au-delà de 3 m, au pas sinon), à son délai
  relay(old, e) {
    const now = this.fxT ?? 0, seed = seedOf(String(e.un.id)), m = matchSlots(old.lay, e.lay, old.dead);
    let next = old.lay.reduce((a, _, i) => Math.max(a, old.ids?.[i] ?? i), -1) + 1;
    e.ids = []; e.moves = [];
    m.forEach((i, j) => {
      if (i < 0) { e.ids[j] = next++; return; }
      const id = old.ids?.[i] ?? i, v = variety(seed, id), f = e.lay[j];
      e.ids[j] = id;
      // là où il est : sur sa place d'avant, ou en chemin vers elle
      const g = old.lay[i], mv = old.moves?.[i], at = [g[0] + v.du, g[1] + v.dv];
      if (mv) { const t = clamp((now - mv[2]) / Math.abs(mv[3]), 0, 1); at[0] = mv[0] + (at[0] - mv[0]) * t; at[1] = mv[1] + (at[1] - mv[1]) * t; }
      const d = Math.hypot(f[0] + v.du - at[0], f[1] + v.dv - at[1]);
      // (un autre palier de la vue de loin ou un autre nombre d'hommes par figurine (qualité) ne change que l'échelle
      // et l'effectif des figurines : personne ne court)
      if (d > 0.3 && old.per === e.per) e.moves[j] = [at[0], at[1], now + v.delay, d > 3 ? d / 3 : -d / 1.4];
    });
  }
  // ombres portées des figurines (qualité Haute et Ultra) ; les ombres de contact restent dans tous les cas
  setShadows(on) {
    if (this.castShadow === on) return;
    this.castShadow = on;
    for (const k of this.kinds.values()) k.mesh.castShadow = on;
  }
  setQuality(q) { this.q = q; }
  dispose() {
    for (const k of this.kinds.values()) { k.geo.dispose(); k.mat.dispose(); k.depth.dispose(); k.contactGeo?.dispose(); }
    for (const m of Object.values(this.contactMats)) m.dispose();
    this.soft.dispose();
    this.units.dispose(); this.heights.dispose(); this.pattern.dispose(); this.anim.dispose(); this.bgrid.dispose(); this.brect.dispose();
  }
}
