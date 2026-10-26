// Les villes vues du ciel (SPEC-CARTE-2D.md, chantier B) : le générateur de la maquette (web/js/dev/carte/new.js,
// profilVille, genererInterieur, peindreInterieur, planCarte) porté en module, branché sur l'état de la partie.
//   profilVille : ce que le générateur lit dans les données du jeu (taille, routes, eau, relief, pays, défenses) ;
//   genererInterieur : un modèle de plan par type de ville, ajusté au site, toujours le même pour une ville ;
//   peindreInterieur : la vue de l'intérieur ; planCarte : le plan dessiné sur la carte à partir de Z.PLAN.
// L'état (année, f, pop, d, sg.dmg, lv) choisit l'enceinte, la taille, les faubourgs, les ruines et les incendies.
import {
  toile, BATS, BOIS, C, E, HERBE, PAL, RR, T, TAU, aire, alea, arbre, bastions, bat, bois, chemin_, cheminee, clamp,
  coneF, decaler, decalerQuad, dessinerEnceinte, distPoly, lerp, ligne, mix, mod, parcelle, potager, remplirIlot, route, rue,
  sapin, touffes, tronc,
} from './lib.js';
import { AMB } from './ambiance.js';
import { enregistrer } from './rejeu.js';

export const hashS = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const hash2 = (i, j, k = 0) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const TT = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
const FEUILLES_VIGNE = { printemps: ['#8fbf5a', '#a3cc6a'], ete: ['#4f7a33', '#5d8a3c'], automne: ['#c9a032', '#b5552c', '#d7b448', '#9a3f28'], hiver: null };   // l'hiver, les ceps sont nus

// ---------- la carte du jeu (map.m : nodes, edges, rivers, terrain, W, H), lue une fois
const CARTES = new WeakMap();
export function carteDe(m) {
  let K = CARTES.get(m); if (K) return K;
  const GW = m.W, GH = m.H, TER = typeof m.terrain === 'string' ? Uint8Array.from(atob(m.terrain), c => c.charCodeAt(0)) : m.terrain;
  const ter = (x, y) => { const i = x | 0, j = y | 0; return i >= 0 && j >= 0 && i < GW && j < GH ? TER[j * GW + i] : 0; };
  const eauK = (x, y) => { const i = Math.floor(x - .5), j = Math.floor(y - .5), fx = x - .5 - i, fy = y - .5 - j, w = (a, b) => { const t = ter(a + .5, b + .5); return t === 0 || t === 1 ? 1 : 0; }; return lerp(lerp(w(i, j), w(i + 1, j), fx), lerp(w(i, j + 1), w(i + 1, j + 1), fx), fy); };
  let ALT = null;   // un relief approché d'après le terrain (le jeu n'a pas d'altitudes), pour l'ombrage de l'intérieur
  const alt = (x, y) => {
    if (!ALT) {
      ALT = new Float32Array(GW * GH);
      const HT = [-.1, -.05, .04, .1, .05, 0, .38, .9, 1.6, .14, .16];
      for (let k = 0; k < ALT.length; k++) ALT[k] = HT[TER[k]] + .06 * hash2(k % GW, k / GW | 0, 7);
      const tmp = new Float32Array(ALT.length);
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { let s = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x >= 0 && y >= 0 && x < GW && y < GH) { s += ALT[y * GW + x]; n++; } } tmp[j * GW + i] = s / n; }
        ALT.set(tmp);
      }
    }
    const i = clamp(Math.floor(x - .5), 0, GW - 2), j = clamp(Math.floor(y - .5), 0, GH - 2), fx = clamp(x - .5 - i, 0, 1), fy = clamp(y - .5 - j, 0, 1), a = ALT[j * GW + i], b = ALT[j * GW + i + 1], c = ALT[(j + 1) * GW + i], d = ALT[(j + 1) * GW + i + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };
  K = { m, GW, GH, ter, eauK, alt, noeud: new Map(m.nodes.map(n => [n.id, n])), yMont: m.y_mont ?? 1e9 };
  CARTES.set(m, K);
  return K;
}

// ---------- les styles de pays (d'après towns.js), toits vus de dessus
Object.assign(PAL, {
  bordelais: ['#c7653f', '#9c4b30', '#7a3a26'], perigord: ['#8a5a3e', '#6b432e', '#4f3123'], lauze: ['#8a8478', '#6a655c', '#4f4b44'],
  landes: ['#be6743', '#994f33', '#773c27'], agenais: ['#c25a33', '#9a4527', '#78351d'], bearn: ['#6a7282', '#4f5666', '#3c424e'], basque: ['#c04a32', '#973726', '#742a1c'],
});
const BASQUES = new Set(['Bayonne', 'Biarritz', 'Hendaye', 'Saint-Jean-de-Luz', 'Hasparren', 'Saint-Jean-Pied-de-Port', 'Mauléon', 'Ustaritz', 'Espelette', 'Cambo-les-Bains', 'Saint-Palais']);
const BASTIDES = new Set(['Libourne', 'Sainte-Foy-la-Grande', 'Sauveterre-de-Guyenne', 'Créon', 'Villeréal', 'Eymet', 'Domme', 'Lalinde', 'Villeneuve-sur-Lot', 'Monflanquin', 'Castillonnès', "Tournon-d'Agenais", 'Miramont', 'Cadillac', 'Sauveterre-de-Béarn', 'Navarrenx', 'Beaumont-du-Périgord', 'Villefranche-du-Périgord', 'Monpazier', 'Vianne', 'Hastingues']);
export function styleDe(n) {
  if (n.dept === '64') return BASQUES.has(n.name) || n.x < 75 ? 'basque' : 'bearn';
  return { '33': 'bordelais', '24': 'perigord', '40': 'landes', '47': 'agenais' }[n.dept] || 'bordelais';
}
export const STYLE_TXT = {
  bordelais: 'Bordelais : pierre blonde, tuiles canal orangées, chais', perigord: 'Périgord : pierre ocre, toits bruns très pentus, quelques lauzes',
  landes: 'Landes : maisons à colombages, tuiles canal, airiaux sous les chênes', agenais: 'Agenais : brique rose et tuiles canal',
  bearn: 'Béarn : murs blancs, ardoise des Pyrénées', basque: 'Pays basque : murs blancs, pans de bois rouges ou verts, tuiles canal',
};
export const TOITS_STYLE = { bordelais: [['bordelais', 1]], perigord: [['perigord', .82], ['lauze', .18]], landes: [['landes', 1]], agenais: [['agenais', 1]], bearn: [['bearn', 1]], basque: [['basque', 1]] };

// ---------- l'état de la partie qui compte pour une ville
// ns : st.nodes[id] ; st : l'état reçu (year, me)
export function etatVille(n, ns, st) {
  const sg = ns?.sg, lv = ns?.lv;
  return {
    annee: st?.year || AMB.annee || 1789,
    f: ns?.f ?? n.fort ?? 0, pop: ns?.pop || n.pop0 || 700, d: ns?.d || 0, o: ns?.o,
    dmg: sg && !sg.occ && !sg.bl ? sg.dmg || 0 : 0, deg: ns?.dg || 0, siege: !!sg && !sg.occ, blocus: !!(sg?.bl || ns?.bk),
    lv: lv ? lv[0] : null, lvAge: lv ? lv[1] : 0,
    famine: !!(st?.me?.famine && ns?.o && ns.o === st.me.code),
  };
}

// ---------- le profil d'une ville : ce que le générateur lit dans les données du jeu
export const S = 180, IW = 1000, IH = 760, IC = [500, 380];   // unités de l'intérieur par km ; taille de la scène
const loc = (n, x, y) => [IC[0] + (x - n.x) * S, IC[1] + (y - n.y) * S];
// le plan ne dépend de l'année que par ces seuils (murs abattus et gare après 1860), et de la population par paliers
const ere = a => (a >= 1860 ? 1860 : 1789);
const rayon = pop => Math.round(clamp(46 + 1.55 * Math.sqrt(pop), 56, 262) / 8) * 8;
export function profilVille(K, n, e = {}) {
  const pop0 = n.pop0 || 700, pop = e.pop || pop0, spec = n.spec || [], annee = ere(e.annee || 1789), f = e.f ?? n.fort ?? 0, d = e.d || 0;
  const R = rayon(pop);
  const routes = [];
  for (const ed of K.m.edges) {
    if (ed.a !== n.id && ed.b !== n.id) continue;
    const pts = ed.a === n.id ? ed.pts : ed.pts.slice().reverse(), p = pts.find(q => Math.hypot(q[0] - n.x, q[1] - n.y) > .9) || pts[pts.length - 1];
    const a = Math.atan2(p[1] - n.y, p[0] - n.x), autre = K.noeud.get(ed.a === n.id ? ed.b : ed.a);
    if (!routes.some(r => Math.abs(angDiff(r.a, a)) < .4)) routes.push({ a, royal: ed.royal, vers: autre?.name });
  }
  routes.sort((a, b) => (b.royal - a.royal));
  const rivs = [];
  for (const r of K.m.rivers) {
    const proches = r.pts.filter(q => Math.hypot(q[0] - n.x, q[1] - n.y) < 4.6);
    if (proches.length < 2 || !r.pts.some(q => Math.hypot(q[0] - n.x, q[1] - n.y) < 2.6)) continue;
    const i0 = r.pts.indexOf(proches[0]), i1 = r.pts.indexOf(proches[proches.length - 1]);
    rivs.push({ name: r.name, rank: r.rank, w: [0, 74, 34, 20, 13][r.rank] || 11, pts: r.pts.slice(Math.max(0, i0 - 1), i1 + 2).map(q => loc(n, ...q)) });
  }
  let mer = null; { let sx = 0, sy = 0, c = 0; for (let a = 0; a < TAU; a += TAU / 24) for (const dd of [1, 2, 3]) if (K.eauK(n.x + Math.cos(a) * dd, n.y + Math.sin(a) * dd) > .5) { sx += Math.cos(a) / dd; sy += Math.sin(a) / dd; c++; } if (c) mer = { a: Math.atan2(sy, sx), n: c }; }
  const comptes = new Array(11).fill(0); for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) comptes[K.ter(n.x + dx, n.y + dy)]++;
  const relief = (comptes[6] + comptes[7] * 2 + comptes[8] * 3) / 81;
  const style = styleDe(n), port = spec.includes('port') && (mer || rivs.some(r => r.rank <= 2));
  // le modèle suit la ville d'origine (pop0, fort) : il ne change pas en cours de partie
  let modele;
  if (n.type === 'fort' && (n.name.startsWith('Fort') || pop0 <= 450)) modele = 'fortin';
  else if (n.fort >= 3 && pop0 < 4000 && !port) modele = 'place';
  else if (BASTIDES.has(n.name)) modele = 'bastide';
  else if (n.type === 'capitale' || pop0 >= 6000) modele = 'grande';
  else if (n.type === 'fort') modele = 'castrum';
  else if (n.type === 'ville') modele = port && mer ? 'port' : 'ville';
  else if (relief > .55 || (n.dept === '64' && n.y > K.yMont - 25)) modele = 'montagne';
  else if (n.dept === '40' && comptes[3] + comptes[4] > 34) modele = 'airial';
  else if (routes.length <= 2) modele = 'rue';
  else modele = 'rond';
  // l'enceinte suit l'état (f) et l'époque : murs et tours, puis bastions ; après 1860, des cours à la place des murs
  const demoli = annee >= 1860 && f < 3 && (modele === 'grande' || modele === 'ville' || modele === 'port');
  const murs = modele === 'fortin' || modele === 'place' ? 'bastions' : demoli ? (n.fort > 0 || f > 0 ? 'cours' : null) : f >= 3 ? 'bastions' : f >= 1 ? 'medieval' : null;
  return {
    n, pop, spec, R, routes, rivs, mer, comptes, relief, style, port, modele, murs, annee, f, d, sd: hashS(n.slug || n.name),
    citadelle: f >= 2 && !['fortin', 'place'].includes(modele) && pop0 > 2000,
    fau: 1 + .18 * d, dfau: .08 * d,   // agrandissements : des faubourgs plus longs et plus serrés
  };
}
export const MODELES = {
  grande: 'Grande ville : vieille ville ronde serrée dans ses murs, faubourgs en damier au-delà, cathédrale, couvents, hôpital, place royale',
  ville: 'Ville close : rues rayonnantes vers les portes, boulevards en anneaux, église sur la grand-place',
  port: 'Port : quartiers tournés vers l’eau, quais, chais et magasins, navires amarrés',
  bastide: 'Bastide : ville neuve du Moyen Âge en damier, place centrale à cornières avec sa halle, église à l’écart de la place',
  place: 'Place forte : enceinte bastionnée, rues droites, casernes, arsenal',
  fortin: 'Fort isolé : tracé bastionné, casernes et poudrière, sans ville',
  castrum: 'Village castral : maisons serrées en anneaux sous le château',
  montagne: 'Village de montagne : maisons éparses suivant la pente, toits d’ardoise, terrasses',
  airial: 'Village landais : église au carrefour, airiaux (fermes sous les chênes) dans la pinède',
  rue: 'Village-rue : maisons des deux côtés de la route, jardins en lanières à l’arrière',
  rond: 'Bourg rond : maisons en anneaux autour de l’église et de la place',
};

// ---------- les dispositions : un modèle de plan par type de ville, ajusté au site (routes, eau, relief)
export function genererInterieur(K, Pf) {
  const R = alea(Pf.sd), n = Pf.n, Rv = Pf.R, ilots = [], rues = [], plus = [];
  // (à la vraie taille, en unités de 5,56 m : façades de 6 à 15 m sur 10 à 15 m de profondeur ; voir « Livré — bâtiments à
  // la vraie taille »)
  const V = { prof: 2.6, Pf, type: Rv > 190 ? 'grande' : Rv > 110 ? 'moyenne' : 'bourg', cfg: { larg: Rv > 190 ? [1.1, 2.2] : Rv > 110 ? [1.2, 2.5] : [1.4, 2.7], toits: TOITS_STYLE[Pf.style], riv: 0 }, ilots, rues, lieux: {}, cheminees: [], apres: [], plus };
  const eauL = (x, y) => K.eauK(n.x + (x - IC[0]) / S, n.y + (y - IC[1]) / S);
  // (loin de la boîte d'une rivière, loin de la rivière, sans calcul : un plan à la vraie taille en demande des milliers)
  const boites = Pf.rivs.map(r => [Math.min(...r.pts.map(p => p[0])), Math.min(...r.pts.map(p => p[1])), Math.max(...r.pts.map(p => p[0])), Math.max(...r.pts.map(p => p[1]))]);
  const pres = (x, y, m = 4) => Pf.rivs.some((r, i) => { const [x0, y0, x1, y1] = boites[i], e = r.w / 2 + m + 1e-6; return x > x0 - e && x < x1 + e && y > y0 - e && y < y1 + e && distPoly(r.pts, x, y) < r.w / 2 + m; }) || eauL(x, y) > .42;
  V.eau = (x, y) => pres(x, y, 0);
  const ajout = (q, o = {}) => {
    if (q.some(p => pres(p[0], p[1])) || pres((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, 6)) return null;   // (les maisons à 22 m de l'eau, derrière le quai)
    const c = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
    const b = Object.assign({ q, c, d: Math.hypot(c[0] - IC[0], c[1] - IC[1]), zone: 'ville', main: false, aire: Math.abs(aire(q)) }, o);
    ilots.push(b); return b;
  };
  const angRoutes = Pf.routes.map(r => r.a);
  const tourne = (a, u, v) => [Math.cos(a) * u - Math.sin(a) * v, Math.sin(a) * u + Math.cos(a) * v];
  // routes jusqu'au bord de la scène, un peu sinueuses
  V.routesL = Pf.routes.map((r, k) => { const pts = []; for (let d = 0; d <= 760; d += 20) { const a = r.a + .06 * Math.sin(d / 90 + k * 2.1 + Pf.sd % 7); pts.push([IC[0] + Math.cos(a) * d, IC[1] + Math.sin(a) * d]); } return { ...r, pts }; });
  // les anneaux autour de la place (R0 : son bord), d'îlots de pasR de profondeur et d'environ arc de long : en
  // s'éloignant de la place, une rue naît entre deux autres dès que l'îlot dépasserait 1,5 arc
  const polaire = (R0, R1, o = {}) => {
    const arc = o.arc || 16, pasR = o.pasR || 12, tord = o.tord ?? .3;
    let angs = angRoutes.slice();
    while (angs.length < 3) angs.push((angs[0] ?? 0) + TAU * (angs.length / 3) + .4);
    angs = angs.map(a => mod(a, TAU)).sort((a, b) => a - b);
    const rings = []; for (let r = R0; r < R1 - pasR * .6; r += pasR * (.85 + R() * .3)) rings.push(r); rings.push(R1);
    let A = angs.map((a, id) => ({ a, id, route: true, m0: 0 })), nid = A.length;
    const P = (m, s) => { const a = s.a + tord * Math.min(arc / rings[m], .33) * Math.sin(s.id * 1.7 + m * .9 + Pf.sd % 11), r = rings[m] * (1 + .06 * Math.sin(a * 3 + Pf.sd % 5)); return [IC[0] + Math.cos(a) * r, IC[1] + Math.sin(a) * r]; };
    const bandes = [];
    for (let m = 0; m < rings.length - 1; m++) {
      const rm = (rings[m] + rings[m + 1]) / 2, B = [];
      A.forEach((s, k) => { const a1 = k + 1 < A.length ? A[k + 1].a : A[0].a + TAU, n = Math.round((a1 - s.a) * rm / arc); B.push(s); for (let q = 1; q < n; q++) B.push({ a: s.a + (a1 - s.a) * q / n + (R() - .5) * .25 * arc / rm, id: nid++, route: false, m0: m }); });
      bandes.push(A = B);
      // (sommets dans le sens des îlots en damier : decalerQuad les rentre au lieu de les gonfler ; voir « Livré — B »)
      A.forEach((s, k) => { const t = A[(k + 1) % A.length]; ajout([P(m, t), P(m, s), P(m + 1, s), P(m + 1, t)], { main: s.route || t.route, zone: o.zone || 'ville', anneau: m, secteur: k, cotes: o.cotes }); });
    }
    for (const s of A) rues.push({ pts: rings.slice(s.m0).map((_, i) => P(s.m0 + i, s)), main: s.route });
    rings.forEach((_, m) => { const L = bandes[Math.min(m, bandes.length - 1)] || A; rues.push({ pts: [...L, L[0]].map(s => P(m, s)), anneau: true }); });
    return { rings };
  };
  const grille = (cx, cy, a, nx, ny, pas, o = {}) => {
    const P = (i, j) => { const [u, v] = tourne(a, (i - nx / 2) * pas, (j - ny / 2) * pas), jit = o.jit || 0; return [cx + u + (jit ? (hash2(i, j, Pf.sd) - .5) * jit : 0), cy + v + (jit ? (hash2(j, i, Pf.sd) - .5) * jit : 0)]; };
    const out = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], c = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
      if (o.garder && !o.garder(c, i, j)) continue;
      const b = ajout(q, { main: i === nx / 2 | 0 || i + 1 === (nx / 2 | 0) || j === (ny / 2 | 0) || j + 1 === (ny / 2 | 0), zone: o.zone || 'ville', gi: i, gj: j }); if (b) out.push(b);
    }
    // les rues le long des îlots gardés seulement (pas à travers la vieille ville, l'eau ou les champs)
    const garde = new Set(out.map(b => b.gi * 1000 + b.gj)), ok = (i, j) => garde.has(i * 1000 + j);
    const ligne = (n, pt, on, main) => { let pts = []; for (let k = 0; k <= n; k++) { if (k < n && on(k)) { if (!pts.length) pts.push(pt(k)); pts.push(pt(k + 1)); } else if (pts.length) { rues.push({ pts, main }); pts = []; } } };
    for (let i = 0; i <= nx; i++) ligne(ny, j => P(i, j), j => ok(i - 1, j) || ok(i, j), i === (nx / 2 | 0));
    for (let j = 0; j <= ny; j++) ligne(nx, i => P(i, j), i => ok(i, j - 1) || ok(i, j), j === (ny / 2 | 0));
    return { P, out };
  };
  const lePlusPres = (liste, x, y, filtre = () => true) => liste.filter(b => !b.role && filtre(b)).sort((a, b) => Math.hypot(a.c[0] - x, a.c[1] - y) - Math.hypot(b.c[0] - x, b.c[1] - y))[0];
  const role = (b, r) => { if (b) { b.role = r; V.lieux[r] = V.lieux[r] || { x: b.c[0], y: b.c[1] }; } return b; };
  const ruban = (route, d0, d1, prof = 12, seg = 8, o = {}) => {   // maisons le long d'une route, jardins derrière
    for (let d = d0; d < d1; d += seg * (.85 + R() * .3)) for (const s of [-1, 1]) {
      const p = (t, off) => { const a = route.a + .06 * Math.sin(t / 90); return [IC[0] + Math.cos(a) * t - Math.sin(a) * off * s, IC[1] + Math.sin(a) * t + Math.cos(a) * off * s]; };
      if (o.densite && R() > o.densite) continue;
      const q = s > 0 ? [p(d, 1.5), p(d + seg, 1.5), p(d + seg, prof), p(d, prof)] : [p(d + seg, 1.5), p(d, 1.5), p(d, prof), p(d + seg, prof)];
      ajout(q, { zone: 'faubourg', cotes: [true, false, false, false] });
    }
  };
  // --- un plan par modèle (fau, dfau : les agrandissements de la partie allongent et serrent les faubourgs)
  const m = Pf.modele, aMain = angRoutes[0] ?? 0, fau = Pf.fau || 1, dens = x => Math.min(1, x + (Pf.dfau || 0));
  if (m === 'grande') {
    // (le mur au même rayon qu'avant, la vieille ville jusqu'à 14 m de lui ; dans des bastions, au même rayon qu'avant)
    polaire(10, Rv * .58 + (Pf.murs === 'bastions' ? 0 : 5.5), { pasR: 12, arc: 16 });
    V.murLigne = Rv * .58 + 8; V.rPlace = 8.75;   // (la place royale : 97 m)
    const ax = Pf.rivs[0] ? Math.atan2(Pf.rivs[0].pts.at(-1)[1] - Pf.rivs[0].pts[0][1], Pf.rivs[0].pts.at(-1)[0] - Pf.rivs[0].pts[0][0]) : aMain;
    const n2 = Math.ceil(Rv * 2.1 / 17);
    grille(IC[0], IC[1], ax, n2, n2, 17, { jit: 3, garder: c => { const d = Math.hypot(c[0] - IC[0], c[1] - IC[1]); return d > V.murLigne + 6 && d < Rv * (1 + .1 * Math.sin(Math.atan2(c[1] - IC[1], c[0] - IC[0]) * 3)) + 12; } });   // (+ 12 : les coins des îlots au même rayon qu'avant)
    for (const r of Pf.routes) ruban(r, Rv + 10, Rv * 1.5 * fau, 12, 8, { densite: dens(Pf.annee >= 1860 ? .95 : .7) });
  } else if (m === 'ville' || m === 'port' || m === 'castrum' || m === 'rond' || m === 'montagne') {
    const r1 = m === 'montagne' ? Rv * .95 : Rv, R0 = m === 'castrum' ? 8 : m === 'ville' || m === 'port' ? 7 : 6;
    polaire(R0, m === 'montagne' || Pf.murs === 'bastions' ? r1 : r1 + 6.5, { pasR: m === 'rond' || m === 'castrum' ? 11 : m === 'montagne' ? 14 : 12, arc: m === 'montagne' ? 24 : 16, tord: m === 'montagne' ? .5 : .3, zone: m === 'montagne' ? 'faubourg' : 'ville', cotes: m === 'montagne' ? [true, true, true, true] : undefined });
    V.murLigne = r1 + 9; V.rPlace = R0 - 1.25;
    for (const r of Pf.routes) ruban(r, r1 + 12, r1 * (Pf.annee >= 1860 ? 1.7 : 1.4) * fau, 12, 8, { densite: dens(.75) });
  } else if (m === 'bastide' || m === 'place') {
    // (le damier garde son emprise, celle de 4 à 9 îlots de 170 à 180 m de côté)
    const n0 = clamp(Math.round(Rv / 19), 4, 9), p0 = m === 'place' ? 30 : 33, pas = m === 'place' ? 12 : 13, nx = Math.round(n0 * p0 / pas), ny = m === 'bastide' ? Math.round((n0 - 1) * p0 / pas) : nx;
    grille(IC[0], IC[1], aMain, nx, ny, pas);
    V.rect = { a: aMain, w: nx * pas, h: ny * pas };
    for (const r of Pf.routes) ruban(r, nx * pas * .75 + 34, nx * pas * 1.25 * fau, 12, 8, { densite: dens(.6) });
  } else if (m === 'rue') {
    const r = Pf.routes[0] || { a: 0 }, r2 = Pf.routes[1] || { a: r.a + Math.PI };
    ruban(r, 0, Rv * 1.5 * fau, 14); ruban(r2, 8, Rv * 1.5 * fau, 14);
  } else if (m === 'airial') {
    for (const r of Pf.routes) ruban(r, 22, 70 * fau, 12, 8, { densite: dens(.8) });
    for (let k = 0; k < 9; k++) { const a = R() * TAU, d = 120 + R() * 220; plus.push({ k: 'airial', x: IC[0] + Math.cos(a) * d, y: IC[1] + Math.sin(a) * d, a: R() * TAU }); }
  }
  // --- les lieux : place, église ou cathédrale, couvents, hôpital, casernes…
  const villes = ilots.filter(b => b.zone === 'ville');
  if (m === 'bastide' || m === 'place') {
    const c = lePlusPres(villes, IC[0], IC[1]); role(c, 'place');
    role(lePlusPres(villes, IC[0] + 13, IC[1] + 13, b => b !== c), 'eglise');
    if (m === 'place') { for (const b of villes.filter(b => !b.role).sort((a, b) => b.d - a.d).slice(0, 3)) role(b, 'caserne'); }
  } else if (m !== 'rue' && m !== 'airial' && m !== 'fortin') {
    V.placeCentre = true; V.lieux.place = { x: IC[0], y: IC[1] };
    // (le plus grand îlot du premier anneau qui reste, quand l'eau a pris ceux qui bordent la place)
    const cath = role(villes.filter(b => b.anneau != null).sort((a, b) => a.anneau - b.anneau || b.aire - a.aire)[0], m === 'grande' ? 'cathedrale' : 'eglise');
    if (cath && m === 'grande') { const nb = villes.find(b => !b.role && b.anneau === cath.anneau && Math.abs(b.secteur - cath.secteur) === 1); if (nb) { nb.role = 'parvis'; cath.voisin = nb; } }
    if (m === 'grande') {
      const libres = (d0, d1) => villes.filter(b => !b.role && b.d > Rv * d0 && b.d < Rv * d1);
      const parCle = (L, f) => L.map(b => [f(b), b]).sort((a, b) => a[0] - b[0]).map(x => x[1]);   // (la clé calculée une fois par îlot)
      for (let k = 0; k < 4; k++) { const ta = k * TAU / 4 + .6, l = parCle(libres(.25, .9), b => Math.abs(angDiff(Math.atan2(b.c[1] - IC[1], b.c[0] - IC[0]), ta))); role(l[0], k % 2 ? 'egliseDome' : 'eglise'); }
      role(libres(.4, .95)[2], 'couvent'); role(libres(.5, 1)[5], 'couvent');
      role(parCle(villes.filter(b => !b.role && Pf.rivs[0]), b => distPoly(Pf.rivs[0].pts, ...b.c))[0], Pf.port && Pf.n.type === 'capitale' ? 'royale' : 'hopital');
      role(libres(.6, 1.1).sort((a, b) => b.aire - a.aire)[0], 'jardin');
      for (const b of libres(.2, .55).filter((b, k) => k % 5 === 2).slice(0, 4)) role(b, 'hotel');
      for (const b of villes.filter(b => !b.role).sort((a, b) => b.d - a.d).slice(0, 2)) role(b, 'caserne');
    } else if (m === 'ville' || m === 'port') { role(villes.filter(b => !b.role && b.d > Rv * .5).sort((a, b) => b.aire - a.aire)[0], 'couvent'); }
  } else if (m === 'rue' || m === 'airial') {
    const b = ilots.filter(b => b.d < 80)[0]; if (b) { b.role = 'eglise'; V.lieux.eglise = { x: b.c[0], y: b.c[1] }; }
  }
  // --- les métiers de la ville
  const autour = (dmin, dmax, k) => { for (let t = 0; t < 40; t++) { const a = R() * TAU, d = dmin + R() * (dmax - dmin), x = IC[0] + Math.cos(a) * d, y = IC[1] + Math.sin(a) * d; if (!pres(x, y, 16) && !ilots.some(b => Math.hypot(b.c[0] - x, b.c[1] - y) < 40)) return { k, x, y, a: R() * TAU }; } return null; };
  const add = o => { if (o) plus.push(o); return o; };
  if (Pf.spec.includes('vin')) { for (let k = 0; k < 3; k++) add(autour(Rv + 60, Rv + 300, 'chateauVin')); V.lieux.vin = plus.find(p => p.k === 'chateauVin'); }
  if (Pf.spec.includes('bois')) V.lieux.bois = add(autour(Rv + 30, Rv + 140, 'scierie'));
  if (Pf.spec.includes('fer')) V.lieux.fer = add(autour(Rv + 30, Rv + 160, 'forge'));
  if (Pf.spec.includes('sel')) V.lieux.sel = add(autour(Rv + 20, Rv + 120, 'salines'));
  if (Pf.spec.includes('tabac')) for (let k = 0; k < 2; k++) V.lieux.tabac = add(autour(Rv + 30, Rv + 200, 'sechoir'));
  if (Pf.spec.includes('ble') || m === 'rond' || m === 'rue') for (let k = 0; k < 2; k++) V.lieux.ble = add(autour(Rv + 40, Rv + 220, 'moulin'));
  for (let k = 0; k < (Pf.n.type === 'village' ? 5 : 8); k++) add(autour(Rv + 50, 460, Pf.style === 'landes' ? 'airial' : 'ferme'));
  if (Pf.citadelle) {
    const Rc = Pf.n.type === 'capitale' ? 36 : 30, a = Pf.rivs[0] ? (Pf.mer ? Pf.mer.a : angRoutes[1] ?? 1) : (angRoutes[1] ?? 1) + .4, d = (V.murLigne || Rv) + Rc * .9;   // (400 ou 330 m)
    V.citadelle = bastions(IC[0] + Math.cos(a) * d, IC[1] + Math.sin(a) * d, 5, Rc, a + Math.PI); V.lieux.citadelle = { x: V.citadelle.C[0], y: V.citadelle.C[1] };
    for (const b of ilots) if (Math.hypot(b.c[0] - V.citadelle.C[0], b.c[1] - V.citadelle.C[1]) < Rc + 25) b.supprime = true;
  }
  if (Pf.murs === 'bastions') {
    // l'enceinte bastionnée prend tous les îlots de la ville : son rayon s'ajuste jusqu'à ce que la courtine les contienne
    // (des fronts d'environ 300 m, bastions de 80 m de face ; le terre-plein : 28 m)
    const N = m === 'fortin' ? 5 : clamp(Math.round(Rv / 8), 5, 32);
    const besoin = m === 'fortin' ? 22 : Math.max(60, ...ilots.filter(b => b.zone === 'ville' && !b.supprime).map(b => Math.max(...b.q.map(p => Math.hypot(p[0] - IC[0], p[1] - IC[1]))))) + 4;
    let Rb = besoin, interieur = 0;
    for (let k = 0; k < 30 && interieur < besoin; k++) { V.trace = bastions(IC[0], IC[1], N, Rb, aMain + Math.PI / N); interieur = Math.min(...V.trace.cotes.map(c => Math.hypot(c.GA[0] - IC[0], c.GA[1] - IC[1]))) - 5; Rb *= 1.05; }
    V.Rb = Rb / 1.05; V.murInt = interieur;
    for (const b of ilots) if (b.zone === 'ville' && Math.max(...b.q.map(p => Math.hypot(p[0] - IC[0], p[1] - IC[1]))) > interieur) b.supprime = true; else if (b.zone === 'faubourg' && b.d < Rb + 110) b.supprime = true;
    if (m === 'fortin') { plus.push({ k: 'fortin' }); V.lieux.place = { x: IC[0], y: IC[1] }; }
  }
  if (Pf.annee >= 1860 && Pf.pop > 3000) { const a = (angRoutes[1] ?? aMain) + .5, d = (V.murLigne || Rv) + 70; V.gare = { x: IC[0] + Math.cos(a) * d, y: IC[1] + Math.sin(a) * d, a: a + Math.PI / 2 }; V.lieux.gare = V.gare; for (const b of ilots) if (Math.hypot(b.c[0] - V.gare.x, b.c[1] - V.gare.y) < 30) b.supprime = true; }
  if (m === 'castrum') V.lieux.chateau = { x: IC[0], y: IC[1] };
  V.ilots = ilots.filter(b => !b.supprime);
  if (Pf.port) V.lieux.port = Pf.rivs[0] ? (() => { const p = Pf.rivs[0].pts.reduce((b, q) => Math.hypot(q[0] - IC[0], q[1] - IC[1]) < Math.hypot(b[0] - IC[0], b[1] - IC[1]) ? q : b); return { x: p[0], y: p[1] }; })() : { x: IC[0] + Math.cos(Pf.mer.a) * Rv * .9, y: IC[1] + Math.sin(Pf.mer.a) * Rv * .9 };
  // rayon du mur de ville (unités de l'intérieur) : la carte y pose les remparts de map.js (walls)
  const bord = Math.max(40, ...V.ilots.filter(b => b.zone === 'ville').map(b => Math.max(...b.q.map(p => Math.hypot(p[0] - IC[0], p[1] - IC[1])))));
  V.rMur = V.murInt ? V.murInt + 10 : V.rect ? Math.hypot(V.rect.w, V.rect.h) / 2 + 6 : V.murLigne && m !== 'montagne' ? V.murLigne : bord + 9;
  return V;
}

// ---------- ce que l'état de la partie abîme : maisons brûlées (incendie), ruines et toits crevés (siège)
// une carte îlot → 'brule' | 'ruine' | 'creve', toujours la même pour un même état
export function degats(V, e) {
  const out = new Map(), sd = V.Pf.sd, L = V.ilots.filter(b => b.role !== 'place' && b.role !== 'parvis' && b.role !== 'jardin');
  // ruines : celles du siège en cours (sg.dmg), et celles qui restent des combats passés tant qu'on n'a pas rebâti (dg)
  const pr = Math.max(e.dmg * .22, e.deg || 0), pc = Math.max(e.dmg * .6, Math.min(1, (e.deg || 0) * 1.4));
  if (pr > .01) L.forEach((b, i) => { const h = hash2(i, sd, 91); if (h < pr) out.set(b, 'ruine'); else if (h < pc) out.set(b, 'creve'); });
  if (e.lv === 'incendie' && L.length) {
    const c = L[hash2(sd, 7, 92) * L.length | 0].c, nb = Math.max(2, Math.ceil(L.length * .16));
    for (const b of L.slice().sort((a, b) => Math.hypot(a.c[0] - c[0], a.c[1] - c[1]) - Math.hypot(b.c[0] - c[0], b.c[1] - c[1])).slice(0, nb)) out.set(b, 'brule');
  }
  return out;
}
function peindreDegat(g, b, k, R) {
  const poly = decalerQuad(b.q, b.main ? 1.25 : .6); if (!poly) return;
  const [cx, cy] = b.c, r = Math.sqrt(b.aire) * .3;
  if (k === 'brule' || k === 'ruine') {
    chemin_(g, poly); g.fillStyle = k === 'brule' ? 'rgba(46,38,33,.9)' : 'rgba(140,128,110,.92)'; g.fill();
    for (let i = 0; i < 14; i++) C(g, k === 'brule' ? (R() < .5 ? '#5e534b' : '#1f1a17') : (R() < .5 ? '#a89c86' : '#776b5c'), cx + (R() - .5) * r * 2, cy + (R() - .5) * r * 2, .25 + R() * .5);
    if (k === 'brule') for (let i = 0; i < 5; i++) { const x = cx + (R() - .5) * r * 1.6, y = cy + (R() - .5) * r * 1.6, a = R() * TAU; T(g, '#14110f', .3, x, y, x + Math.cos(a) * 2, y + Math.sin(a) * 2); }
    g.strokeStyle = k === 'brule' ? '#2a231f' : '#8b826e'; g.lineWidth = .3; chemin_(g, poly); g.stroke();
  } else for (let i = 0; i < 3; i++) {   // toits crevés : des trous noirs, des tuiles tombées autour
    const t = R(), e = poly[R() * 4 | 0], f = poly[(poly.indexOf(e) + 1) % 4], x = lerp(e[0], f[0], t) * .8 + cx * .2, y = lerp(e[1], f[1], t) * .8 + cy * .2;
    E(g, '#231d19', x, y, .5 + R() * .5, .35 + R() * .3, R() * TAU);
    for (let j = 0; j < 4; j++) C(g, '#8f3f2e', x + (R() - .5) * 2, y + (R() - .5) * 2, .15);
  }
}

// ---------- peindre l'intérieur
function vigne(g, x, y, w, h, R, dir) {
  RR(g, '#a48d62', x, y, w, h, .5);
  g.strokeStyle = '#8a7650'; g.lineWidth = .5; g.beginPath();
  if (dir) for (let yy = y + 1.5; yy < y + h; yy += 3) { g.moveTo(x, yy); g.lineTo(x + w, yy); } else for (let xx = x + 1.5; xx < x + w; xx += 3) { g.moveTo(xx, y); g.lineTo(xx, y + h); }
  g.stroke();
  const F = FEUILLES_VIGNE[AMB.saison]; if (!F) return;
  // les ceps, un tracé par couleur de feuillage
  const r = AMB.saison === 'printemps' ? .45 : .65, P = F.map(() => []);
  for (let a = 1.5; a < (dir ? h : w); a += 3) for (let b = 1; b < (dir ? w : h); b += 1.6) P[R() * F.length | 0].push(dir ? x + b : x + a, dir ? y + a : y + b);
  F.forEach((c, i) => { g.fillStyle = c; g.beginPath(); for (let k = 0; k < P[i].length; k += 2) { g.moveTo(P[i][k] + r, P[i][k + 1]); g.arc(P[i][k], P[i][k + 1], r, 0, TAU); } g.fill(); });
}
function airial(g, x, y, a, R) {
  C(g, '#7aa659', x, y, 38); C(g, '#86b363', x - 4, y - 4, 26);
  for (let k = 0; k < 7; k++) { const t = R() * TAU, d = 16 + R() * 18; arbre(g, x + Math.cos(t) * d, y + Math.sin(t) * d, 5 + R() * 3, '#3f6b33'); }
  bat(g, [{ t: 'g', x: -12, y: -6, w: 24, h: 12, p: 'landes', h2: 1.6 }, cheminee(-7, -2), { t: 'g', x: 14, y: -4, w: 10, h: 8, p: 'landes', h2: 1.2 }, { t: 'c', x: -18, y: 8, r: 2.4, p: 'landes', h2: 1.2 }], x, y, a);
  C(g, '#857c6c', x + 10, y + 12, 1.6); C(g, '#3d5f86', x + 10, y + 12, .9);
}
export function navire(g, x, y, a, grand) {
  g.save(); g.translate(x, y); g.rotate(a); const L = grand ? 26 : 13;
  E(g, 'rgba(20,30,40,.3)', 1.5, 2, L / 2, L / 7); E(g, '#5b4127', 0, 0, L / 2, L / 7); E(g, '#8a6a45', 0, 0, L / 2 - 1.5, L / 7 - 1.2);
  for (const m of grand ? [-.28, 0, .28] : [0]) { C(g, '#3a2a1b', m * L, 0, .9); RR(g, '#ece4cc', m * L - .9, -L / 5, 1.8, L / 2.5, .4); }
  g.restore();
}
// e : etatVille (dégâts, crue) ; renvoie { c, k, deg } (deg : les îlots abîmés, pour les feux de la vue)
export function peindreInterieur(K, V, k, e = {}) { const it = peindreInterieurPas(K, V, k, e); let r; do r = it.next(); while (!r.done); return r.value; }
// la même peinture par petits pas (yield) : la vue de l'intérieur s'ouvre tout de suite et se peint en quelques images
export function* peindreInterieurPas(K, V, k, e = {}) {
  const Pf = V.Pf, n = Pf.n, cv = toile(Math.round(IW * k), Math.round(IH * k));
  const g0 = cv.getContext('2d'), R = alea(Pf.sd + 17); g0.scale(k, k);
  const [g, fin] = enregistrer(g0);   // (rejoué plus fin, par tuiles, quand on s'approche : interieur.js)
  V.cheminees.length = 0; V.apres.length = 0;
  g.fillStyle = HERBE; g.fillRect(0, 0, IW, IH);
  yield { c: cv, k };   // (le canevas, montré pendant qu'il se peint)
  const km = (x, y) => [n.x + (x - IC[0]) / S, n.y + (y - IC[1]) / S];
  // la campagne : parcelles selon le terrain du jeu sous chacune
  for (let y = 0; y < IH; y += 60 + R() * 30) { const h = 60 + R() * 30; for (let x = 0; x < IW;) {
    const w = 50 + R() * 80, t = K.ter(...km(x + w / 2, y + h / 2)), dir = R() < .5;
    if (t === TT.VIGNE || (Pf.spec.includes('vin') && R() < .45 && t === TT.PLAINE)) vigne(g, x + 1.2, y + 1.2, w - 2.4, h - 2.4, R, dir);
    else if (t === TT.FORET) { parcelle(g, { x: x + 1, y: y + 1, w: w - 2, h: h - 2, sol: 'pre', dir: 'h' }, R); if (Pf.style === 'landes' || n.dept === '33' && n.x < 110) { RR(g, '#bfae7a', x + 1, y + 1, w - 2, h - 2, 2); const p = []; for (let i = 0; i < w * h / 120; i++) p.push([x + R() * w, y + R() * h, 3 + R() * 2.5, R() < .5 ? '#2f5a33' : '#3d6b3b']); touffes(g, p); } else bois(g, x, y, w, h, R); }
    else if (t === TT.LANDE) { parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: 'friche', dir: dir ? 'h' : 'v' }, R); for (let i = 0; i < w * h / 500; i++) arbre(g, x + R() * w, y + R() * h, 3, '#2f5a33'); }
    else if (t === TT.MARAIS) { parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: 'pre', dir: 'h' }, R); for (let i = 0; i < 4; i++) E(g, '#5d8db0', x + R() * w, y + R() * h, 6 + R() * 8, 3 + R() * 4, R() * 3); }
    else if (t === TT.DUNES) RR(g, '#e3d3a3', x, y, w, h, 0);
    else if (t === TT.MONTAGNE || t === TT.HAUTE) { parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: R() < .6 ? 'pre' : 'friche', dir: 'h' }, R); for (let i = 0; i < 5; i++) sapin(g, x + R() * w, y + R() * h, 4 + R() * 2, '#25553c'); }
    else if (t !== TT.OCEAN && t !== TT.EAU) parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: ['chaume', 'ble', 'labour', 'pre', 'colza', 'pre', 'chaume'][R() * 7 | 0], dir: dir ? 'h' : 'v' }, R);
    x += w; yield; } }
  // l'ombrage du relief, éclairé du nord-ouest
  for (let y = 0; y < IH; y += 16) for (let x = 0; x < IW; x += 16) {
    const [a, b] = km(x, y), gx = K.alt(a + .15, b) - K.alt(a - .15, b), gy = K.alt(a, b + .15) - K.alt(a, b - .15), s = clamp((gx * .6 + gy * .8) * 6, -1, 1);
    if (Math.abs(s) > .02) { g.fillStyle = s > 0 ? `rgba(25,35,10,${s * .32})` : `rgba(255,248,215,${-s * .26})`; g.fillRect(x, y, 16, 16); }
  }
  const urbain = Pf.modele !== 'rue' && Pf.modele !== 'airial' && Pf.modele !== 'montagne';
  if (urbain && Pf.modele !== 'fortin') { g.beginPath(); for (let a = 0; a <= TAU + .01; a += .04) { const r = Math.max(...V.ilots.filter(b => b.zone === 'ville').map(b => { const d = Math.atan2(b.c[1] - IC[1], b.c[0] - IC[0]); return Math.abs(angDiff(d, a)) < .35 ? b.d + 8 : 0; }), 40); g.lineTo(IC[0] + Math.cos(a) * r, IC[1] + Math.sin(a) * r); } g.fillStyle = '#bfb498'; g.fill(); }
  // la mer, les étangs, l'estuaire (d'après la grille du jeu), puis les rivières (en crue, elles débordent)
  for (const [r, c] of [[11, '#e3d3a3'], [8.5, '#3d6ea6'], [6.5, '#4a7db8']]) { g.fillStyle = c; for (let y = 0; y < IH; y += 9) for (let x = 0; x < IW; x += 9) if (K.eauK(...km(x, y)) > (c === '#e3d3a3' ? .38 : .5)) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); } }
  const crue = e.lv === 'crue';
  for (const r of Pf.rivs) riviereL(g, r.pts, r.w * (crue ? 1.45 : 1), R);
  // l'enceinte avant les îlots : le fossé et le glacis passent sous les maisons du bord
  if (V.trace) {
    dessinerEnceinte(g, V.trace, { eau: !!Pf.port || Pf.rivs.length > 0, fosse: 3.2, interieur: '#bfb498', canons: true, portes: V.trace.cotes.map((c, i) => [i, Math.atan2(c.M[1] - IC[1], c.M[0] - IC[0])]).filter(([, a]) => Pf.routes.some(r => Math.abs(angDiff(a, r.a)) < Math.PI / V.trace.N)).map(([i]) => i) });
    if (Pf.modele === 'fortin') { RR(g, '#d9cda9', IC[0] - 7, IC[1] - 7, 14, 14, .3); bat(g, BATS.caserne().slice(2), IC[0], IC[1], 0, .15); bat(g, BATS.poudriere(), IC[0] + 12, IC[1] - 9, .6, .2); bat(g, BATS.egliseRomane(), IC[0] - 11, IC[1] + 11, 0, .14); }
  }
  // routes jusqu'à la ville (empierrées), rues
  for (const r of V.routesL) route(g, r.pts, r.royal ? 2.2 : 1.4);
  if (V.placeCentre) { C(g, '#c9bea6', IC[0], IC[1], V.rPlace + 1.25); }
  const segs = [[], []];   // (les rues, les grandes rues : d'un seul tracé chacune, sans joints visibles)
  for (const rr of V.rues) for (let i = 1; i < rr.pts.length; i++) {
    const a = rr.pts[i - 1], b = rr.pts[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (V.eau(mx, my) || !V.ilots.some(q => Math.hypot(q.c[0] - mx, q.c[1] - my) < 14)) continue;   // une rue ne va que là où il y a des maisons
    segs[rr.main ? 1 : 0].push(a, b);
  }
  const trace = (L, w, c) => { g.beginPath(); for (let i = 0; i < L.length; i += 2) { g.moveTo(L[i][0], L[i][1]); g.lineTo(L[i + 1][0], L[i + 1][1]); } g.lineCap = g.lineJoin = 'round'; g.lineWidth = w; g.strokeStyle = c; g.stroke(); };
  // (13 et 6 m ; le caniveau, le pavé, puis le milieu bombé un peu plus clair)
  if (urbain) for (const [k, c] of [[.25, '#8b826e'], [0, '#a69d88']]) for (const m of [0, 1]) trace(segs[m], (m ? 2.3 : 1.1) + k, c);
  if (urbain) for (const m of [0, 1]) trace(segs[m], m ? 1 : .5, 'rgba(232,224,204,.16)');
  else for (const m of [0, 1]) trace(segs[m], m ? 2 : 1, '#d9caa1');
  for (const r of V.routesL) if (urbain) { g.save(); g.beginPath(); g.arc(IC[0], IC[1], (V.murLigne || Pf.R) + 1, 0, TAU); g.clip(); rue(g, r.pts, 2.5); g.restore(); }
  // îlots, puis ce que la guerre et le feu en ont fait
  let nb = 0;
  for (const b of V.ilots) { remplirIlot(g, b, V, R); if (++nb % 12 === 0) yield; }
  for (const f of V.apres) f();
  const deg = degats(V, e);
  for (const [b, kd] of deg) peindreDegat(g, b, kd, R);
  if (V.placeCentre) {   // la grand-place : pavés, fontaine, halle ou statue
    C(g, '#d6ccb2', IC[0], IC[1], V.rPlace); g.strokeStyle = 'rgba(120,105,80,.25)'; g.lineWidth = .1; g.beginPath(); g.arc(IC[0], IC[1], V.rPlace - .15, 0, TAU); g.stroke();
    // (la statue sur son socle, 7 m, et sa grille ; ailleurs, la halle, 27 m)
    if (Pf.modele === 'grande') { C(g, 'rgba(20,20,10,.25)', IC[0] + .3, IC[1] + .4, 1.3); C(g, '#bdb39b', IC[0], IC[1], 1.3); g.strokeStyle = '#3a3530'; g.lineWidth = .06; g.stroke(); RR(g, '#a89c86', IC[0] - .6, IC[1] - .35, 1.2, .7, .1); E(g, '#3c4a45', IC[0], IC[1], .42, .16, Pf.routes[0]?.a || 0); C(g, '#3c4a45', IC[0], IC[1], .14); } else { bat(g, BATS.halle().slice(1), IC[0], IC[1], Pf.routes[0]?.a || 0, .1); }
  }
  // ponts là où une route ou une rue maîtresse passe l'eau
  for (const r of Pf.rivs) for (const rr of [...V.routesL.map(x => x.pts), ...V.rues.filter(x => x.main).map(x => x.pts)]) for (let i = 1; i < rr.length; i++) {
    const [x0, y0] = rr[i - 1], [x1, y1] = rr[i], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (distPoly(r.pts, mx, my) < 6) { const a = Math.atan2(y1 - y0, x1 - x0), L = r.w + 5; g.save(); g.translate(mx, my); g.rotate(a); RR(g, 'rgba(20,20,10,.35)', -L / 2 + .4, -1.2 + .5, L, 2.4, .4); RR(g, '#b8ad94', -L / 2, -1.2, L, 2.4, .4); RR(g, '#cfc3a2', -L / 2, -.8, L, 1.6, .3); for (let t = -L / 2 + 2; t < L / 2 - 1; t += 4) { E(g, '#9a907a', t, -1.4, .6, .3); E(g, '#9a907a', t, 1.4, .6, .3); } g.restore(); break; }   // (13 m de large)
  }
  // quais : la ville tournée vers l'eau (en crue, sous l'eau)
  if (Pf.port) for (const r of Pf.rivs.slice(0, 1)) for (const s of [-1, 1]) { const q = decaler(r.pts, s * (r.w / 2 + 2)); g.save(); g.beginPath(); g.arc(IC[0], IC[1], Pf.R * 1.15, 0, TAU); g.clip(); ligne(g, q); g.strokeStyle = '#a39b88'; g.lineWidth = 4; g.stroke(); g.strokeStyle = '#c9bfa7'; g.lineWidth = 2.4; g.stroke(); g.restore(); }
  if (crue) for (const r of Pf.rivs) { g.save(); g.beginPath(); g.arc(IC[0], IC[1], Pf.R * 1.3, 0, TAU); g.clip(); g.lineCap = 'round'; g.lineJoin = 'round'; ligne(g, r.pts); g.strokeStyle = 'rgba(92,128,160,.55)'; g.lineWidth = r.w * 1.45 + 34; g.stroke(); g.strokeStyle = 'rgba(74,120,180,.5)'; g.lineWidth = r.w * 1.45 + 18; g.stroke(); g.restore(); }
  // murailles
  if (Pf.murs === 'medieval' && V.murLigne && !V.rect) murMedieval(g, V);
  if (Pf.murs === 'medieval' && V.rect) murRect(g, V);
  if (Pf.murs === 'cours' && V.murLigne) { g.beginPath(); g.arc(IC[0], IC[1], V.murLigne, 0, TAU); g.strokeStyle = '#cdbf9f'; g.lineWidth = 6; g.stroke(); for (let a = 0; a < TAU; a += 1.8 / V.murLigne) for (const dr of [-2.2, 2.2]) { const x = IC[0] + Math.cos(a) * (V.murLigne + dr), y = IC[1] + Math.sin(a) * (V.murLigne + dr); if (!V.eau(x, y)) arbre(g, x, y, .9, BOIS[2]); } }   // (33 m, un arbre tous les 10 m)
  if (V.trace) V.lieux.remparts = V.lieux.remparts || { x: V.trace.V[0][0], y: V.trace.V[0][1] };
  if (V.citadelle) { dessinerEnceinte(g, V.citadelle, { eau: true, fosse: 2.6, canons: true, portes: [2] }); const C2 = V.citadelle.C; RR(g, '#d9cda9', C2[0] - 5, C2[1] - 5, 10, 10, .3); bat(g, BATS.caserne().slice(2), C2[0], C2[1], 0, .12); }
  if (Pf.modele === 'castrum') chateau(g);
  // métiers, fermes et moulins autour
  yield;
  // (à leur vraie taille, comme sur les cartes des batailles : terrain_ville.METIERS ; les vignes et les salines aux leurs)
  const ech = (x, y, k, f) => { g.save(); g.translate(x, y); g.scale(k, k); f(); g.restore(); };
  for (const p of V.plus) {
    if (p.k === 'airial') ech(p.x, p.y, .3, () => airial(g, 0, 0, p.a, R));
    else if (p.k === 'ferme') bat(g, Pf.style === 'bearn' || Pf.style === 'basque' ? [{ t: 'g', x: -14, y: -9, w: 28, h: 18, p: Pf.style, h2: 2 }, cheminee(-6, -3), { t: 'arbre', x: 22, y: -10, r: 6 }] : BATS.fermeCour().map(q => q.p === 'tuile' ? { ...q, p: TOITS_STYLE[Pf.style][0][0] } : q), p.x, p.y, p.a, Pf.style === 'bearn' || Pf.style === 'basque' ? .13 : .11);
    else if (p.k === 'chateauVin') { bat(g, [{ t: 'r', sol: 1, c: '#d2c8b0', x: -16, y: 2, w: 32, h: 14 }, { t: 'g', x: -16, y: -9, w: 32, h: 11, hip: 1, p: 'ardoise', h2: 2.6 }, { t: 'c', x: -18, y: -6, r: 3.6, p: 'ardoise', h2: 3.4 }, { t: 'c', x: 18, y: -6, r: 3.6, p: 'ardoise', h2: 3.4 }, { t: 'g', x: -22, y: 18, w: 44, h: 8, p: TOITS_STYLE[Pf.style][0][0], h2: 1.1 }], p.x, p.y, p.a, .14); for (let i = 0; i < 4; i++) vigne(g, p.x - 70 + (i % 2) * 74, p.y + (i < 2 ? -70 : 34), 66, 34, R, i % 2); }
    else if (p.k === 'scierie') ech(p.x, p.y, .14, () => { bat(g, [{ t: 'g', x: -12, y: -7, w: 24, h: 14, p: TOITS_STYLE[Pf.style][0][0], h2: 1.6 }], 0, 0, p.a); for (let i = 0; i < 6; i++) tronc(g, 18, -10 + i * 3.6, 40, -9 + i * 3.6); });
    else if (p.k === 'forge') ech(p.x, p.y, .14, () => { bat(g, [{ t: 'g', x: -14, y: -8, w: 28, h: 16, p: 'ardoise', h2: 2 }, { t: 'f', x: 6, y: -3, w: 4, h: 4, c: '#5a3d2c', h2: 4 }], 0, 0, p.a); for (let i = 0; i < 14; i++) C(g, '#3a3530', 20 + (R() - .5) * 16, 12 + (R() - .5) * 10, 1.4); });
    else if (p.k === 'salines') { for (let i = 0; i < 12; i++) { RR(g, '#e9ecef', p.x - 40 + (i % 4) * 20, p.y - 24 + (i / 4 | 0) * 16, 17, 13, 1); RR(g, '#c9d6de', p.x - 38 + (i % 4) * 20, p.y - 22 + (i / 4 | 0) * 16, 13, 9, 1); } }
    else if (p.k === 'sechoir') bat(g, [{ t: 'g', x: -20, y: -5, w: 40, h: 10, p: TOITS_STYLE[Pf.style][0][0], h2: 2 }], p.x, p.y, p.a, .14);
    else if (p.k === 'moulin') p.ailes = true;
  }
  if (V.gare) {
    g.save(); g.translate(V.gare.x, V.gare.y); g.rotate(V.gare.a);
    // (deux voies à 5,6 m d'entraxe, rails à 1,44 m, traverses en tirets)
    for (const s of [-1, 1]) { T(g, '#5b4a3a', .9, -IW, s * .5, IW, s * .5); g.setLineDash([.05, .06]); T(g, '#6b5a48', .48, -IW, s * .5, IW, s * .5); g.setLineDash([]); T(g, '#3a3a3a', .05, -IW, s * .5 - .13, IW, s * .5 - .13); T(g, '#3a3a3a', .05, -IW, s * .5 + .13, IW, s * .5 + .13); }
    g.restore(); bat(g, BATS.gare().slice(1), V.gare.x, V.gare.y, V.gare.a, .2);   // (87 m)
  }
  return { c: cv, k, deg, chem: V.cheminees.slice(), rec: fin() };
}
const chateau = g => bat(g, [{ t: 'f', x: -20, y: -14, w: 40, h: 28, c: '#b9b09a', h2: 2, bal: 1 }, { t: 'g', x: -16, y: -10, w: 26, h: 12, hip: 1, p: 'lauze', h2: 3 }, { t: 'c', x: -18, y: -12, r: 5, p: 'lauze', h2: 4.5 }, { t: 'c', x: 18, y: -12, r: 4.5, p: 'lauze', h2: 4 }, { t: 'c', x: 18, y: 12, r: 4.5, p: 'lauze', h2: 4 }, { t: 'p', x: 4, y: -2, w: 12, h: 12, p: 'lauze', h2: 6 }], IC[0], IC[1], .2, .25);   // (56 m)
function riviereL(g, pts, w) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  ligne(g, pts); g.strokeStyle = '#557f3e'; g.lineWidth = w + 18; g.stroke(); g.strokeStyle = '#4b7438'; g.lineWidth = w + 8; g.stroke();
  g.strokeStyle = '#355f97'; g.lineWidth = w; g.stroke(); g.strokeStyle = '#4a78b4'; g.lineWidth = w * .72; g.stroke();
  g.setLineDash([2.5, 11, 1.2, 9]); g.strokeStyle = 'rgba(160,195,235,.45)'; g.lineWidth = .9; g.stroke(); g.setLineDash([]);
}
function murMedieval(g, V) {
  const pts = []; for (let a = 0; a <= TAU + .001; a += .03) { const r = V.murLigne; pts.push([IC[0] + Math.cos(a) * r, IC[1] + Math.sin(a) * r, a]); }
  const portes = V.Pf.routes.map(r => pts.reduce((b, p) => Math.abs(angDiff(p[2], r.a)) < Math.abs(angDiff(b[2], r.a)) ? p : b));
  g.lineCap = 'round';
  // (les lices de 22 m, le mur de 3 m, une tour de 11 m tous les 50 m)
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (V.eau((x0 + x1) / 2, (y0 + y1) / 2)) continue; T(g, '#6e8a4a', 4, x0, y0, x1, y1); }
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (V.eau((x0 + x1) / 2, (y0 + y1) / 2)) continue; T(g, '#8f876f', .9, x0, y0, x1, y1); T(g, '#b5aa92', .55, x0, y0, x1, y1); }
  let acc = 0;
  for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); const [x, y] = pts[i]; if (acc > 9 && !V.eau(x, y) && portes.every(p => Math.hypot(p[0] - x, p[1] - y) > 4)) { acc = 0; C(g, 'rgba(20,20,10,.33)', x + .5, y + .7, 1); C(g, '#b5aa92', x, y, 1); coneF(g, x, y, .85, PAL[TOITS_STYLE[V.Pf.style][0][0]], 0); } }
  for (const [x, y, a] of portes) bat(g, [{ t: 'c', x: 0, y: -6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'c', x: 0, y: 6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'g', x: -4, y: -3, w: 8, h: 6, p: 'ardoise', hip: 1, h2: 2.2 }], x, y, a, .25);
  V.lieux.remparts = { x: portes[0]?.[0] ?? IC[0], y: portes[0]?.[1] ?? IC[1] };
}
function murRect(g, V) {
  const { a, w, h } = V.rect, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const x = u * (w / 2 + 3), y = v * (h / 2 + 3); return [IC[0] + Math.cos(a) * x - Math.sin(a) * y, IC[1] + Math.sin(a) * x + Math.cos(a) * y]; });
  chemin_(g, c); g.strokeStyle = '#6e8a4a'; g.lineWidth = 4; g.stroke(); chemin_(g, c); g.strokeStyle = '#8f876f'; g.lineWidth = .9; g.stroke(); g.strokeStyle = '#b5aa92'; g.lineWidth = .55; g.stroke();
  for (const [x, y] of c) { C(g, '#b5aa92', x, y, 1.3); coneF(g, x, y, 1.1, PAL[TOITS_STYLE[V.Pf.style][0][0]], 0); }
  V.lieux.remparts = { x: c[0][0], y: c[0][1] };
}

// ---------- ce que le générateur a lu (le panneau de la vue de l'intérieur)
export function lecture(Pf, V) {
  return [
    ['Plan', MODELES[Pf.modele]],
    ['Site', [Pf.rivs.length ? 'sur ' + [...new Set(Pf.rivs.map(r => r.name))].join(' et ') : null, Pf.mer ? 'au bord de l’eau (côte, étang ou estuaire)' : null, Pf.relief > .4 ? 'sur un relief marqué' : null].filter(Boolean).join(', ') || 'en plaine'],
    ['Routes', Pf.routes.length ? Pf.routes.map(r => (r.royal ? 'route royale' : 'chemin') + (r.vers ? ' vers ' + r.vers : '')).join(' ; ') : 'aucune'],
    ['Style', STYLE_TXT[Pf.style]],
    ['Taille', `${Math.round(Pf.pop).toLocaleString('fr-FR')} habitants : ${V.ilots.length} îlots`],
    ['Défenses', ({ medieval: 'mur et tours rondes', bastions: 'enceinte bastionnée, fossé, demi-lunes', cours: 'murs abattus, remplacés par des cours plantés (après 1860)' }[Pf.murs] || 'aucune') + (V.citadelle ? ', citadelle' : '')],
    ['Métiers', [Pf.port ? 'quais et navires' : null, Pf.spec.includes('vin') ? 'châteaux viticoles et chais' : null, Pf.spec.includes('bois') ? 'scierie et grumes' : null, Pf.spec.includes('fer') ? 'forges' : null, Pf.spec.includes('sel') ? 'salines' : null, Pf.spec.includes('tabac') ? 'séchoirs à tabac' : null, Pf.spec.includes('ble') ? 'moulins' : null, V.gare ? 'gare (après 1860)' : null].filter(Boolean).join(', ') || 'fermes alentour'],
  ];
}

// ---------- le plan d'une ville sur la carte (le même que l'intérieur, sans la campagne ni l'enceinte : les remparts
// de map.js, qui suivent l'état et la brèche, se posent dessus). Deux façons de le peindre : à plat (aplats de toits,
// comme la maquette) jusqu'à 1 pixel par unité, puis maison par maison (remplirIlot, sans le détail de l'intérieur) à 2.
// Caches bornés : les plans (V) par place et par état, les images par place, état et résolution, au total en pixels.
const PLANS = new Map(), IMAGES = new Map(), MAXPLANS = 300, MAXPIX = 14e6;   // (14 Mpx : environ 56 Mo de canevas)
let pix = 0;
const lru = (M, k) => { const v = M.get(k); if (v) { M.delete(k); M.set(k, v); } return v; };
export const cleVille = (n, e) => `${n.id}|${ere(e.annee || 1789)}|${e.f ?? n.fort}|${rayon(e.pop || n.pop0 || 700)}|${e.d || 0}`;
export function planDe(K, n, e) {
  const k = cleVille(n, e);
  let V = lru(PLANS, k);
  if (!V) {
    V = genererInterieur(K, profilVille(K, n, e));
    PLANS.set(k, V);
    while (PLANS.size > MAXPLANS) PLANS.delete(PLANS.keys().next().value);
  }
  return V;
}
// ce qui change l'image sans changer le plan : dégâts du siège (par dixièmes), incendie
const cleImage = (n, e) => cleVille(n, e) + `|${Math.round((e.dmg || 0) * 10)}|${Math.round((e.deg || 0) * 20)}|${e.lv === 'incendie' ? 1 : 0}`;
export const RES = [.125, .25, .5, 1, 2];
export function resPour(m) { for (const r of RES) if (r >= m * .8) return r; return RES[RES.length - 1]; }
// l'image du plan si elle est déjà peinte (à cette résolution, sinon à la plus proche)
export function imageEnCache(n, e, res) {
  const base = cleImage(n, e);
  const im = lru(IMAGES, base + '|' + res); if (im) return im;
  let best = null;
  for (const r of RES) { const o = IMAGES.get(base + '|' + r); if (o && (!best || Math.abs(Math.log(r / res)) < Math.abs(Math.log(best.res / res)))) best = o; }
  return best;
}
export function planCarte(K, n, e, res = .5) { const it = planCartePas(K, n, e, res); let r; do r = it.next(); while (!r.done); return r.value; }
// le même par petits pas (maison par maison, une trentaine de millisecondes pour Bordeaux) : towns.js l'étale sur
// plusieurs images ; l'image n'entre au cache qu'une fois finie
export function* planCartePas(K, n, e, res = .5) {
  const kk = cleImage(n, e) + '|' + res;
  let p = lru(IMAGES, kk); if (p) return p;
  const V = planDe(K, n, e), Pf = V.Pf, Rr = Math.min(Pf.R * 1.6, 380) + 20, R = alea(Pf.sd + 17);
  res = Math.min(res, 2048 / (Rr * 2));   // (pas de canevas de plus de 2048 pixels de côté)
  const c = toile(Math.max(1, Math.round(Rr * 2 * res)), Math.max(1, Math.round(Rr * 2 * res)));
  const g = c.getContext('2d'); g.scale(res, res); g.translate(Rr - IC[0], Rr - IC[1]);
  const urbain = Pf.modele !== 'rue' && Pf.modele !== 'airial' && Pf.modele !== 'montagne' && Pf.modele !== 'fortin';
  const deg = degats(V, e), detail = res >= 2;   // (maison par maison à 2 pixels par unité, 11 m, seulement)
  // le sol de la ville : îlots entiers et rues entre eux, pour que la campagne ne passe pas entre les maisons
  if (urbain) { g.fillStyle = g.strokeStyle = '#bfb498'; g.lineWidth = 3; g.lineJoin = 'round'; for (const b of V.ilots) if (b.zone === 'ville') { chemin_(g, b.q); g.fill(); g.stroke(); } }
  if (V.placeCentre) C(g, '#d6ccb2', IC[0], IC[1], V.rPlace);
  if (detail) {
    V.cheminees.length = 0; V.apres.length = 0;
    let nb = 0;
    for (const b of V.ilots) { remplirIlot(g, b, V, R, true); if (++nb % 10 === 0) yield; }
    for (const f of V.apres) f();
    for (const [b, kd] of deg) peindreDegat(g, b, kd, R);
    if (V.placeCentre) { C(g, '#d6ccb2', IC[0], IC[1], V.rPlace - .5); if (Pf.modele !== 'grande') bat(g, BATS.halle().slice(1), IC[0], IC[1], Pf.routes[0]?.a || 0, .1); }
    if (Pf.modele === 'castrum') chateau(g);
    if (Pf.modele === 'fortin') { RR(g, '#d9cda9', IC[0] - 7, IC[1] - 7, 14, 14, .3); bat(g, BATS.caserne().slice(2), IC[0], IC[1], 0, .15); bat(g, BATS.poudriere(), IC[0] + 12, IC[1] - 9, .6, .2); }
    if (V.gare) bat(g, BATS.gare().slice(1), V.gare.x, V.gare.y, V.gare.a, .2);
  } else {
    for (const b of V.ilots) {
      const q = decalerQuad(b.q, b.main ? 1.25 : .6); if (!q) continue;
      const P = PAL[b.role === 'cathedrale' || b.role === 'eglise' || b.role === 'egliseDome' ? 'ardoise' : TOITS_STYLE[Pf.style][0][0]], kd = deg.get(b);
      chemin_(g, q);
      g.fillStyle = kd === 'brule' ? '#3a302a' : kd === 'ruine' ? '#958a78' : b.zone === 'faubourg' ? mix(P[0], '#7aa659', .55) : b.role === 'place' || b.role === 'parvis' ? '#d6ccb2' : kd === 'creve' ? mix(P[0], '#231d19', .35) : P[0];
      g.fill();
      if (!kd && b.zone === 'ville' && b.aire > 80 && !b.role) { const inn = decalerQuad(q, 2.6); if (inn) { chemin_(g, inn); g.fillStyle = '#cdbf9f'; g.fill(); } }
      if (!kd && b.zone === 'faubourg') {   // les maisons du faubourg au bord de la rue, les jardins derrière
        g.fillStyle = P[0];
        (b.cotes || [true, false, false, false]).forEach((on, i) => {
          if (!on) return;
          const a = q[i], f = q[(i + 1) % 4], l = Math.hypot(f[0] - a[0], f[1] - a[1]) || 1; let nx = -(f[1] - a[1]) / l, ny = (f[0] - a[0]) / l;
          if ((b.c[0] - a[0]) * nx + (b.c[1] - a[1]) * ny < 0) { nx = -nx; ny = -ny; }
          const dp = Math.min(2.6, Math.sqrt(b.aire) * .35);
          chemin_(g, [a, f, [f[0] + nx * dp, f[1] + ny * dp], [a[0] + nx * dp, a[1] + ny * dp]]); g.fill();
        });
      }
    }
    if (Pf.modele === 'castrum' || Pf.modele === 'fortin') { RR(g, '#6a655c', IC[0] - 5, IC[1] - 3.5, 10, 7, .5); }
  }
  if (V.citadelle) { chemin_(g, V.citadelle.poly); g.fillStyle = '#9cb36e'; g.fill(); g.strokeStyle = '#b5aa92'; g.lineWidth = .8; g.stroke(); const C2 = V.citadelle.C; RR(g, '#d9cda9', C2[0] - 5, C2[1] - 5, 10, 10, .3); if (detail) bat(g, BATS.caserne().slice(2), C2[0], C2[1], 0, .12); }
  // le drapeau au clocher (ou à la citadelle, au château) ; les fenêtres pour la nuit, en km (ciel.js)
  const L = V.lieux, mat = L.cathedrale || L.eglise || L.citadelle || L.chateau || L.place || { x: IC[0], y: IC[1] };
  const lum = [];
  // (une fenêtre sur deux tous les 50 m de façade ; au plus 900, prises dans toute la ville)
  let nl = 0;
  for (const b of V.ilots) { if (b.role === 'place' || b.role === 'parvis' || deg.get(b) === 'brule' || deg.get(b) === 'ruine') continue; const q = decalerQuad(b.q, 2); if (!q) continue; for (let i = 0; i < q.length; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % q.length], l = Math.hypot(bx - ax, by - ay); for (let d = 4; d < l; d += 9) if (hash2(nl++, n.id, 41) < .45) lum.push([n.x + (ax + (bx - ax) * d / l - IC[0]) / S, n.y + (ay + (by - ay) * d / l - IC[1]) / S]); } }
  const pas = Math.ceil(lum.length / 900);
  p = { c, Rr, res, lum: lum.filter((_, i) => i % pas === 0), V, mat: [mat.x - IC[0], mat.y - IC[1]], px: c.width * c.height };
  IMAGES.set(kk, p); pix += p.px;
  while (pix > MAXPIX && IMAGES.size > 1) { const [k0, o] = IMAGES.entries().next().value; IMAGES.delete(k0); pix -= o.px; o.c.width = o.c.height = 0; }   // (Safari garde sinon la mémoire des canevas)
  return p;
}
export function viderPlans() { for (const o of IMAGES.values()) o.c.width = o.c.height = 0; IMAGES.clear(); PLANS.clear(); pix = 0; }
export const memoirePlans = () => ({ plans: PLANS.size, images: IMAGES.size, pixels: pix });
