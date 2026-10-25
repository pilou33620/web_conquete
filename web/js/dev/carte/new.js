// ---------- données réelles du jeu : carte de l'Aquitaine (game/geo.py, client_payload), un carreau = 1 km
const GEO = JSON.parse(document.getElementById('geo').textContent);
const TER = Uint8Array.from(atob(GEO.terrain), c => c.charCodeAt(0));
const GW = GEO.W, GH = GEO.H;
const ter = (x, y) => { const i = x | 0, j = y | 0; return i >= 0 && j >= 0 && i < GW && j < GH ? TER[j * GW + i] : 0; };
const TT = { OCEAN: 0, EAU: 1, PLAINE: 2, FORET: 3, LANDE: 4, MARAIS: 5, COLLINES: 6, MONTAGNE: 7, HAUTE: 8, DUNES: 9, VIGNE: 10 };
const NOMS_DEPT = Object.fromEntries(Object.entries(GEO.depts).map(([k, v]) => [k, v.name]));
const hashS = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const hash2 = (i, j, k = 0) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// un relief approché d'après le terrain (le jeu n'a pas d'altitudes) : il sert seulement à l'ombrage
const ALT = new Float32Array(GW * GH);
{
  const HT = [-.1, -.05, .04, .1, .05, 0, .38, .9, 1.6, .14, .16];
  for (let k = 0; k < ALT.length; k++) ALT[k] = HT[TER[k]] + .06 * hash2(k % GW, k / GW | 0, 7);
  const tmp = new Float32Array(ALT.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { let s = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x >= 0 && y >= 0 && x < GW && y < GH) { s += ALT[y * GW + x]; n++; } } tmp[j * GW + i] = s / n; }
    ALT.set(tmp);
  }
}
const alt = (x, y) => { const i = clamp(Math.floor(x - .5), 0, GW - 2), j = clamp(Math.floor(y - .5), 0, GH - 2), fx = clamp(x - .5 - i, 0, 1), fy = clamp(y - .5 - j, 0, 1), a = ALT[j * GW + i], b = ALT[j * GW + i + 1], c = ALT[(j + 1) * GW + i], d = ALT[(j + 1) * GW + i + 1]; return lerp(lerp(a, b, fx), lerp(c, d, fx), fy); };
const eauK = (x, y) => { const i = Math.floor(x - .5), j = Math.floor(y - .5), fx = x - .5 - i, fy = y - .5 - j, w = (a, b) => { const t = ter(a + .5, b + .5); return t === 0 || t === 1 ? 1 : 0; }; return lerp(lerp(w(i, j), w(i + 1, j), fx), lerp(w(i, j + 1), w(i + 1, j + 1), fx), fy); };
const bboxOf = pts => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; };
for (const l of [...GEO.edges, ...GEO.rivers]) l.bb = bboxOf(l.pts);
for (const w of GEO.waters) w.bb = bboxOf(w.ring);
for (const d of Object.values(GEO.depts)) d.bbs = d.rings.map(bboxOf);
const NOEUD = new Map(GEO.nodes.map(n => [n.id, n]));
// l'ambiance de la carte : saison, heure, temps et événements (réglés par les boutons, voir vivante.js)
const AMB = { saison: 'printemps', heure: 'midi', temps: 'beau', ev: { marche: true, siege: true, disette: true, bataille: true, ennemi: true } };
const FEUILLES_VIGNE = { printemps: ['#8fbf5a', '#a3cc6a'], ete: ['#4f7a33', '#5d8a3c'], automne: ['#c9a032', '#b5552c', '#d7b448', '#9a3f28'], hiver: null };   // l'hiver, les ceps sont nus
const LUMIERE_BOIS = { printemps: '#b5dc8a', ete: '#a5cf7f', automne: '#cfc07a', hiver: '#cfc6b8' };
const BETES = { printemps: 1, ete: 1, automne: .8, hiver: .25 };   // l'hiver, les bêtes restent à l'étable

// ---------- les styles de pays (d'après web/js/towns.js), toits vus de dessus
Object.assign(PAL, {
  bordelais: ['#c7653f', '#9c4b30', '#7a3a26'], perigord: ['#8a5a3e', '#6b432e', '#4f3123'], lauze: ['#8a8478', '#6a655c', '#4f4b44'],
  landes: ['#be6743', '#994f33', '#773c27'], agenais: ['#c25a33', '#9a4527', '#78351d'], bearn: ['#6a7282', '#4f5666', '#3c424e'], basque: ['#c04a32', '#973726', '#742a1c'],
});
const BASQUES = new Set(['Bayonne', 'Biarritz', 'Hendaye', 'Saint-Jean-de-Luz', 'Hasparren', 'Saint-Jean-Pied-de-Port', 'Mauléon', 'Ustaritz', 'Espelette', 'Cambo-les-Bains', 'Saint-Palais']);
const BASTIDES = new Set(['Libourne', 'Sainte-Foy-la-Grande', 'Sauveterre-de-Guyenne', 'Créon', 'Villeréal', 'Eymet', 'Domme', 'Lalinde', 'Villeneuve-sur-Lot', 'Monflanquin', 'Castillonnès', "Tournon-d'Agenais", 'Miramont', 'Cadillac', 'Sauveterre-de-Béarn', 'Navarrenx', 'Beaumont-du-Périgord', 'Villefranche-du-Périgord', 'Monpazier', 'Vianne', 'Hastingues']);
function styleDe(n) {
  if (n.dept === '64') return BASQUES.has(n.name) || n.x < 75 ? 'basque' : 'bearn';
  return { '33': 'bordelais', '24': n.y < 95 ? 'perigord' : 'perigord', '40': 'landes', '47': 'agenais' }[n.dept] || 'bordelais';
}
const STYLE_TXT = {
  bordelais: 'Bordelais : pierre blonde, tuiles canal orangées, chais', perigord: 'Périgord : pierre ocre, toits bruns très pentus, quelques lauzes',
  landes: 'Landes : maisons à colombages, tuiles canal, airiaux sous les chênes', agenais: 'Agenais : brique rose et tuiles canal',
  bearn: 'Béarn : murs blancs, ardoise des Pyrénées', basque: 'Pays basque : murs blancs, pans de bois rouges ou verts, tuiles canal',
};
const TOITS_STYLE = { bordelais: [['bordelais', 1]], perigord: [['perigord', .82], ['lauze', .18]], landes: [['landes', 1]], agenais: [['agenais', 1]], bearn: [['bearn', 1]], basque: [['basque', 1]] };

// ---------- le profil d'une ville : ce que le générateur lit dans les données du jeu
const S = 180, IW = 1000, IH = 760, IC = [500, 380];   // unités de l'intérieur par km ; taille de la scène
const loc = (n, x, y) => [IC[0] + (x - n.x) * S, IC[1] + (y - n.y) * S];
function profilVille(n, annee) {
  const pop = n.pop0 || 700, spec = n.spec || [];
  const R = clamp(46 + 1.55 * Math.sqrt(pop), 56, 262);
  const routes = [];
  for (const e of GEO.edges) {
    if (e.a !== n.id && e.b !== n.id) continue;
    const pts = e.a === n.id ? e.pts : e.pts.slice().reverse(), p = pts.find(q => Math.hypot(q[0] - n.x, q[1] - n.y) > .9) || pts[pts.length - 1];
    const a = Math.atan2(p[1] - n.y, p[0] - n.x), autre = NOEUD.get(e.a === n.id ? e.b : e.a);
    if (!routes.some(r => Math.abs(angDiff(r.a, a)) < .4)) routes.push({ a, royal: e.royal, vers: autre?.name });
  }
  routes.sort((a, b) => (b.royal - a.royal));
  const rivs = [];
  for (const r of GEO.rivers) {
    const proches = r.pts.filter(q => Math.hypot(q[0] - n.x, q[1] - n.y) < 4.6);
    if (proches.length < 2 || !r.pts.some(q => Math.hypot(q[0] - n.x, q[1] - n.y) < 2.6)) continue;
    const i0 = r.pts.indexOf(proches[0]), i1 = r.pts.indexOf(proches[proches.length - 1]);
    rivs.push({ name: r.name, rank: r.rank, w: [0, 74, 34, 20, 13][r.rank] || 11, pts: r.pts.slice(Math.max(0, i0 - 1), i1 + 2).map(q => loc(n, ...q)) });
  }
  let mer = null; { let sx = 0, sy = 0, c = 0; for (let a = 0; a < TAU; a += TAU / 24) for (const d of [1, 2, 3]) if (eauK(n.x + Math.cos(a) * d, n.y + Math.sin(a) * d) > .5) { sx += Math.cos(a) / d; sy += Math.sin(a) / d; c++; } if (c) mer = { a: Math.atan2(sy, sx), n: c }; }
  const comptes = new Array(11).fill(0); for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) comptes[ter(n.x + dx, n.y + dy)]++;
  const relief = (comptes[6] + comptes[7] * 2 + comptes[8] * 3) / 81;
  const style = styleDe(n), port = spec.includes('port') && (mer || rivs.some(r => r.rank <= 2));
  let modele;
  if (n.type === 'fort' && (n.name.startsWith('Fort') || pop <= 450)) modele = 'fortin';
  else if (n.fort >= 3 && pop < 4000 && !port) modele = 'place';
  else if (BASTIDES.has(n.name)) modele = 'bastide';
  else if (n.type === 'capitale' || pop >= 6000) modele = 'grande';
  else if (n.type === 'fort') modele = 'castrum';
  else if (n.type === 'ville') modele = port && mer ? 'port' : 'ville';
  else if (relief > .55 || (n.dept === '64' && n.y > GEO.y_mont - 25)) modele = 'montagne';
  else if (n.dept === '40' && comptes[3] + comptes[4] > 34) modele = 'airial';
  else if (routes.length <= 2) modele = 'rue';
  else modele = 'rond';
  const demoli = annee >= 1860 && n.fort < 3 && (modele === 'grande' || modele === 'ville' || modele === 'port');
  const murs = modele === 'fortin' || modele === 'place' ? 'bastions' : demoli ? 'cours' : n.fort >= 3 ? 'bastions' : n.fort >= 1 ? 'medieval' : modele === 'bastide' ? 'medieval' : null;
  return { n, pop, spec, R, routes, rivs, mer, comptes, relief, style, port, modele, murs, annee, sd: hashS(n.slug), citadelle: n.fort >= 2 && !['fortin', 'place'].includes(modele) && pop > 2000 };
}
const MODELES = {
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
function genererInterieur(Pf) {
  const R = alea(Pf.sd), n = Pf.n, Rv = Pf.R, ilots = [], rues = [], plus = [];
  const V = { prof: 14, Pf, type: Rv > 190 ? 'grande' : Rv > 110 ? 'moyenne' : 'bourg', cfg: { larg: Rv > 190 ? [4.5, 8] : Rv > 110 ? [5, 9] : [6, 11], toits: TOITS_STYLE[Pf.style], riv: 0 }, ilots, rues, lieux: {}, cheminees: [], apres: [], plus };
  const eauL = (x, y) => eauK(n.x + (x - IC[0]) / S, n.y + (y - IC[1]) / S);
  const pres = (x, y, m = 7) => Pf.rivs.some(r => distPoly(r.pts, x, y) < r.w / 2 + m) || eauL(x, y) > .42;
  V.eau = (x, y) => pres(x, y, 0);
  const ajout = (q, o = {}) => {
    if (q.some(p => pres(p[0], p[1])) || pres((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, 10)) return null;
    const c = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
    const b = Object.assign({ q, c, d: Math.hypot(c[0] - IC[0], c[1] - IC[1]), zone: 'ville', main: false, aire: Math.abs(aire(q)) }, o);
    ilots.push(b); return b;
  };
  const angRoutes = Pf.routes.map(r => r.a);
  const tourne = (a, u, v) => [Math.cos(a) * u - Math.sin(a) * v, Math.sin(a) * u + Math.cos(a) * v];
  // routes jusqu'au bord de la scène, un peu sinueuses
  V.routesL = Pf.routes.map((r, k) => { const pts = []; for (let d = 0; d <= 760; d += 20) { const a = r.a + .06 * Math.sin(d / 90 + k * 2.1 + Pf.sd % 7); pts.push([IC[0] + Math.cos(a) * d, IC[1] + Math.sin(a) * d]); } return { ...r, pts }; });
  const polaire = (R0, R1, o = {}) => {
    let angs = angRoutes.slice();
    while (angs.length < 3) angs.push((angs[0] ?? 0) + TAU * (angs.length / 3) + .4);
    angs = angs.map(a => mod(a, TAU)).sort((a, b) => a - b);
    const routesIdx = new Set(), full = [];
    for (let k = 0; k < angs.length; k++) {
      const a0 = angs[k], a1 = k + 1 < angs.length ? angs[k + 1] : angs[0] + TAU, nIns = Math.max(0, Math.round((a1 - a0) / (o.pasA || .55)) - 1);
      routesIdx.add(full.length); full.push(a0);
      for (let q = 1; q <= nIns; q++) full.push(a0 + (a1 - a0) * q / (nIns + 1) + (R() - .5) * .08);
    }
    const na = full.length; full.push(full[0] + TAU);
    const rings = []; for (let r = R0; r < R1 - (o.pasR || 34) * .6; r += (o.pasR || 34) * (.85 + R() * .3)) rings.push(r); rings.push(R1);
    const P = (m, k) => { const a = full[k] + (o.tord || .1) * Math.sin(k * 1.7 + m * .9 + Pf.sd % 11), r = rings[m] * (1 + .06 * Math.sin(full[k] * 3 + Pf.sd % 5)); return [IC[0] + Math.cos(a) * r, IC[1] + Math.sin(a) * r]; };
    for (let m = 0; m < rings.length - 1; m++) for (let k = 0; k < na; k++) {
      const main = routesIdx.has(k) || routesIdx.has((k + 1) % na);
      ajout([P(m, k), P(m, k + 1), P(m + 1, k + 1), P(m + 1, k)], { main, zone: o.zone || 'ville', anneau: m, secteur: k, cotes: o.cotes });
    }
    for (let k = 0; k < na; k++) rues.push({ pts: rings.map((r, m) => P(m, k)), main: routesIdx.has(k) });
    for (let m = 0; m < rings.length; m++) rues.push({ pts: Array.from({ length: na + 1 }, (_, k) => P(m, k)), anneau: true });
    return { rings, full, P, na };
  };
  const grille = (cx, cy, a, nx, ny, pas, o = {}) => {
    const P = (i, j) => { const [u, v] = tourne(a, (i - nx / 2) * pas, (j - ny / 2) * pas), jit = o.jit || 0; return [cx + u + (jit ? (hash2(i, j, Pf.sd) - .5) * jit : 0), cy + v + (jit ? (hash2(j, i, Pf.sd) - .5) * jit : 0)]; };
    const out = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], c = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
      if (o.garder && !o.garder(c, i, j)) continue;
      const b = ajout(q, { main: i === nx / 2 | 0 || i + 1 === (nx / 2 | 0) || j === (ny / 2 | 0) || j + 1 === (ny / 2 | 0), zone: o.zone || 'ville', gi: i, gj: j }); if (b) out.push(b);
    }
    for (let i = 0; i <= nx; i++) rues.push({ pts: [P(i, 0), P(i, ny)], main: i === (nx / 2 | 0) });
    for (let j = 0; j <= ny; j++) rues.push({ pts: [P(0, j), P(nx, j)], main: j === (ny / 2 | 0) });
    return { P, out };
  };
  const lePlusPres = (liste, x, y, filtre = () => true) => liste.filter(b => !b.role && filtre(b)).sort((a, b) => Math.hypot(a.c[0] - x, a.c[1] - y) - Math.hypot(b.c[0] - x, b.c[1] - y))[0];
  const role = (b, r) => { if (b) { b.role = r; V.lieux[r] = V.lieux[r] || { x: b.c[0], y: b.c[1] }; } return b; };
  const ruban = (route, d0, d1, prof = 42, seg = 34, o = {}) => {   // maisons le long d'une route, jardins derrière
    for (let d = d0; d < d1; d += seg * (.85 + R() * .3)) for (const s of [-1, 1]) {
      const p = (t, off) => { const a = route.a + .06 * Math.sin(t / 90); return [IC[0] + Math.cos(a) * t - Math.sin(a) * off * s, IC[1] + Math.sin(a) * t + Math.cos(a) * off * s]; };
      if (o.densite && R() > o.densite) continue;
      const q = s > 0 ? [p(d, 6), p(d + seg, 6), p(d + seg, prof), p(d, prof)] : [p(d + seg, 6), p(d, 6), p(d, prof), p(d + seg, prof)];
      ajout(q, { zone: 'faubourg', cotes: [true, false, false, false] });
    }
  };
  // --- un plan par modèle
  const m = Pf.modele, aMain = angRoutes[0] ?? 0;
  if (m === 'grande') {
    const pl = polaire(26, Rv * .58, { pasR: 24, pasA: .34 });
    V.murLigne = pl.rings[pl.rings.length - 1] + 8;
    const ax = Pf.rivs[0] ? Math.atan2(Pf.rivs[0].pts.at(-1)[1] - Pf.rivs[0].pts[0][1], Pf.rivs[0].pts.at(-1)[0] - Pf.rivs[0].pts[0][0]) : aMain;
    const n2 = Math.ceil(Rv * 2.1 / 34);
    grille(IC[0], IC[1], ax, n2, n2, 34, { jit: 7, garder: c => { const d = Math.hypot(c[0] - IC[0], c[1] - IC[1]); return d > V.murLigne + 16 && d < Rv * (1 + .1 * Math.sin(Math.atan2(c[1] - IC[1], c[0] - IC[0]) * 3)); } });
    for (const r of Pf.routes) ruban(r, Rv + 10, Rv * 1.5, 40, 30, { densite: Pf.annee >= 1860 ? .95 : .7 });
  } else if (m === 'ville' || m === 'port' || m === 'castrum' || m === 'rond' || m === 'montagne') {
    const r1 = m === 'montagne' ? Rv * .95 : Rv;
    polaire(m === 'castrum' ? 30 : 18, r1, { pasR: m === 'rond' || m === 'castrum' ? 22 : 26, pasA: m === 'montagne' ? .7 : .36, tord: m === 'montagne' ? .35 : .1, zone: m === 'montagne' ? 'faubourg' : 'ville', cotes: m === 'montagne' ? [true, true, true, true] : undefined });
    V.murLigne = r1 + 9;
    for (const r of Pf.routes) ruban(r, r1 + 12, r1 * (Pf.annee >= 1860 ? 1.7 : 1.4), 40, 32, { densite: .75 });
  } else if (m === 'bastide' || m === 'place') {
    const nx = clamp(Math.round(Rv / 19), 4, 9), pas = m === 'place' ? 30 : 33;
    grille(IC[0], IC[1], aMain, nx, nx - (m === 'bastide' ? 1 : 0), pas);
    V.rect = { a: aMain, w: nx * pas, h: (nx - (m === 'bastide' ? 1 : 0)) * pas };
    for (const r of Pf.routes) ruban(r, nx * pas * .75 + 34, nx * pas * 1.25, 40, 32, { densite: .6 });
  } else if (m === 'rue') {
    const r = Pf.routes[0] || { a: 0 }, r2 = Pf.routes[1] || { a: r.a + Math.PI };
    ruban(r, 0, Rv * 1.5, 46, 30); ruban(r2, 30, Rv * 1.5, 46, 30);
  } else if (m === 'airial') {
    for (const r of Pf.routes) ruban(r, 22, 70, 36, 30, { densite: .8 });
    for (let k = 0; k < 9; k++) { const a = R() * TAU, d = 120 + R() * 220; plus.push({ k: 'airial', x: IC[0] + Math.cos(a) * d, y: IC[1] + Math.sin(a) * d, a: R() * TAU }); }
  }
  // --- les lieux : place, église ou cathédrale, couvents, hôpital, casernes…
  const villes = ilots.filter(b => b.zone === 'ville');
  if (m === 'bastide' || m === 'place') {
    const c = lePlusPres(villes, IC[0], IC[1]); role(c, 'place');
    role(lePlusPres(villes, IC[0] + 30, IC[1] + 30, b => b !== c), m === 'place' ? 'eglise' : 'eglise');
    if (m === 'place') { for (const b of villes.filter(b => !b.role).sort((a, b) => b.d - a.d).slice(0, 3)) role(b, 'caserne'); }
  } else if (m !== 'rue' && m !== 'airial' && m !== 'fortin') {
    V.placeCentre = true; V.lieux.place = { x: IC[0], y: IC[1] };
    const cath = role(villes.filter(b => b.anneau === 0).sort((a, b) => b.aire - a.aire)[0], m === 'grande' ? 'cathedrale' : 'eglise');
    if (cath && m === 'grande') { const nb = villes.find(b => !b.role && b.anneau === 0 && Math.abs(b.secteur - cath.secteur) === 1); if (nb) { nb.role = 'parvis'; cath.voisin = nb; } }
    if (m === 'grande') {
      const libres = (d0, d1) => villes.filter(b => !b.role && b.d > Rv * d0 && b.d < Rv * d1);
      for (let k = 0; k < 4; k++) { const ta = k * TAU / 4 + .6, l = libres(.25, .9).sort((a, b) => Math.abs(angDiff(Math.atan2(a.c[1] - IC[1], a.c[0] - IC[0]), ta)) - Math.abs(angDiff(Math.atan2(b.c[1] - IC[1], b.c[0] - IC[0]), ta))); role(l[0], k % 2 ? 'egliseDome' : 'eglise'); }
      role(libres(.4, .95)[2], 'couvent'); role(libres(.5, 1)[5], 'couvent');
      role(villes.filter(b => !b.role && Pf.rivs[0]).sort((a, b) => distPoly(Pf.rivs[0].pts, ...a.c) - distPoly(Pf.rivs[0].pts, ...b.c))[0], Pf.port && Pf.n.type === 'capitale' ? 'royale' : 'hopital');
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
    const a = Pf.rivs[0] ? Math.atan2(Pf.rivs[0].pts[0][1] - IC[1], Pf.rivs[0].pts[0][0] - IC[0]) * 0 + (Pf.mer ? Pf.mer.a : angRoutes[1] ?? 1) : (angRoutes[1] ?? 1) + .4, d = (V.murLigne || Rv) + 60;
    V.citadelle = bastions(IC[0] + Math.cos(a) * d, IC[1] + Math.sin(a) * d, 5, Pf.n.type === 'capitale' ? 70 : 56, a + Math.PI); V.lieux.citadelle = { x: V.citadelle.C[0], y: V.citadelle.C[1] };
    for (const b of ilots) if (Math.hypot(b.c[0] - V.citadelle.C[0], b.c[1] - V.citadelle.C[1]) < 150) b.supprime = true;
  }
  if (Pf.murs === 'bastions') {
    const N = m === 'fortin' ? 5 : clamp(Math.round(Rv / 32), 5, 9);
    const besoin = m === 'fortin' ? 60 : Math.max(60, ...ilots.filter(b => b.zone === 'ville' && !b.supprime).map(b => Math.max(...b.q.map(p => Math.hypot(p[0] - IC[0], p[1] - IC[1]))))) + 4;
    let Rb = besoin, interieur = 0;
    for (let k = 0; k < 30 && interieur < besoin; k++) { V.trace = bastions(IC[0], IC[1], N, Rb, aMain + Math.PI / N); interieur = Math.min(...V.trace.cotes.map(c => Math.hypot(c.GA[0] - IC[0], c.GA[1] - IC[1]))) - 20; Rb *= 1.05; }
    for (const b of ilots) if (b.zone === 'ville' && Math.max(...b.q.map(p => Math.hypot(p[0] - IC[0], p[1] - IC[1]))) > interieur) b.supprime = true; else if (b.zone === 'faubourg' && b.d < Rb + 110) b.supprime = true;
    if (m === 'fortin') { plus.push({ k: 'fortin' }); V.lieux.place = { x: IC[0], y: IC[1] }; }
  }
  if (Pf.annee >= 1860 && Pf.pop > 3000) { const a = (angRoutes[1] ?? aMain) + .5, d = (V.murLigne || Rv) + 70; V.gare = { x: IC[0] + Math.cos(a) * d, y: IC[1] + Math.sin(a) * d, a: a + Math.PI / 2 }; V.lieux.gare = V.gare; for (const b of ilots) if (Math.hypot(b.c[0] - V.gare.x, b.c[1] - V.gare.y) < 80) b.supprime = true; }
  if (m === 'castrum') V.lieux.chateau = { x: IC[0], y: IC[1] };
  V.ilots = ilots.filter(b => !b.supprime);
  if (Pf.port) V.lieux.port = Pf.rivs[0] ? (() => { const p = Pf.rivs[0].pts.reduce((b, q) => Math.hypot(q[0] - IC[0], q[1] - IC[1]) < Math.hypot(b[0] - IC[0], b[1] - IC[1]) ? q : b); return { x: p[0], y: p[1] }; })() : { x: IC[0] + Math.cos(Pf.mer.a) * Rv * .9, y: IC[1] + Math.sin(Pf.mer.a) * Rv * .9 };
  return V;
}

// ---------- peindre l'intérieur
function vigne(g, x, y, w, h, R, dir) {
  RR(g, '#a48d62', x, y, w, h, .5);
  g.strokeStyle = '#8a7650'; g.lineWidth = .5; g.beginPath();
  if (dir) for (let yy = y + 1.5; yy < y + h; yy += 3) { g.moveTo(x, yy); g.lineTo(x + w, yy); } else for (let xx = x + 1.5; xx < x + w; xx += 3) { g.moveTo(xx, y); g.lineTo(xx, y + h); }
  g.stroke();
  const F = FEUILLES_VIGNE[AMB.saison]; if (!F) return;
  // les ceps, un tracé par couleur de feuillage
  const r = AMB.saison === 'printemps' ? .45 : .65, chemins = F.map(() => new Path2D());
  for (let a = 1.5; a < (dir ? h : w); a += 3) for (let b = 1; b < (dir ? w : h); b += 1.6) { const px = dir ? x + b : x + a, py = dir ? y + a : y + b, q = chemins[R() * F.length | 0]; q.moveTo(px + r, py); q.arc(px, py, r, 0, TAU); }
  F.forEach((c, i) => { g.fillStyle = c; g.fill(chemins[i]); });
}
function airial(g, x, y, a, R, style) {
  C(g, '#7aa659', x, y, 38); C(g, '#86b363', x - 4, y - 4, 26);
  for (let k = 0; k < 7; k++) { const t = R() * TAU, d = 16 + R() * 18; arbre(g, x + Math.cos(t) * d, y + Math.sin(t) * d, 5 + R() * 3, '#3f6b33'); }
  bat(g, [{ t: 'g', x: -12, y: -6, w: 24, h: 12, p: 'landes', h2: 1.6 }, cheminee(-7, -2), { t: 'g', x: 14, y: -4, w: 10, h: 8, p: 'landes', h2: 1.2 }, { t: 'c', x: -18, y: 8, r: 2.4, p: 'landes', h2: 1.2 }], x, y, a);
  C(g, '#857c6c', x + 10, y + 12, 1.6); C(g, '#3d5f86', x + 10, y + 12, .9);
}
function navire(g, x, y, a, grand) {
  g.save(); g.translate(x, y); g.rotate(a); const L = grand ? 26 : 13;
  E(g, 'rgba(20,30,40,.3)', 1.5, 2, L / 2, L / 7); E(g, '#5b4127', 0, 0, L / 2, L / 7); E(g, '#8a6a45', 0, 0, L / 2 - 1.5, L / 7 - 1.2);
  for (const m of grand ? [-.28, 0, .28] : [0]) { C(g, '#3a2a1b', m * L, 0, .9); RR(g, '#ece4cc', m * L - .9, -L / 5, 1.8, L / 2.5, .4); }
  g.restore();
}
function peindreInterieur(V, k) {
  const Pf = V.Pf, n = Pf.n, cv = document.createElement('canvas'); cv.width = Math.round(IW * k); cv.height = Math.round(IH * k);
  const g = cv.getContext('2d'), R = alea(Pf.sd + 17); g.scale(k, k);
  g.fillStyle = HERBE; g.fillRect(0, 0, IW, IH);
  const km = (x, y) => [n.x + (x - IC[0]) / S, n.y + (y - IC[1]) / S];
  // la campagne : parcelles selon le terrain du jeu sous chacune
  for (let y = 0; y < IH; y += 60 + R() * 30) { const h = 60 + R() * 30; for (let x = 0; x < IW;) {
    const w = 50 + R() * 80, t = ter(...km(x + w / 2, y + h / 2)), dir = R() < .5;
    if (t === TT.VIGNE || (Pf.spec.includes('vin') && R() < .45 && t === TT.PLAINE)) vigne(g, x + 1.2, y + 1.2, w - 2.4, h - 2.4, R, dir);
    else if (t === TT.FORET) { parcelle(g, { x: x + 1, y: y + 1, w: w - 2, h: h - 2, sol: 'pre', dir: 'h' }, R); if (Pf.style === 'landes' || n.dept === '33' && n.x < 110) { RR(g, '#bfae7a', x + 1, y + 1, w - 2, h - 2, 2); const p = []; for (let i = 0; i < w * h / 120; i++) p.push([x + R() * w, y + R() * h, 3 + R() * 2.5, R() < .5 ? '#2f5a33' : '#3d6b3b']); touffes(g, p); } else bois(g, x, y, w, h, R); }
    else if (t === TT.LANDE) { parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: 'friche', dir: dir ? 'h' : 'v' }, R); for (let i = 0; i < w * h / 500; i++) arbre(g, x + R() * w, y + R() * h, 3, '#2f5a33'); }
    else if (t === TT.MARAIS) { parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: 'pre', dir: 'h' }, R); for (let i = 0; i < 4; i++) E(g, '#5d8db0', x + R() * w, y + R() * h, 6 + R() * 8, 3 + R() * 4, R() * 3); }
    else if (t === TT.DUNES) RR(g, '#e3d3a3', x, y, w, h, 0);
    else if (t === TT.MONTAGNE || t === TT.HAUTE) { parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: R() < .6 ? 'pre' : 'friche', dir: 'h' }, R); for (let i = 0; i < 5; i++) sapin(g, x + R() * w, y + R() * h, 4 + R() * 2, '#25553c'); }
    else if (t !== TT.OCEAN && t !== TT.EAU) parcelle(g, { x: x + 1.2, y: y + 1.2, w: w - 2.4, h: h - 2.4, sol: ['chaume', 'ble', 'labour', 'pre', 'colza', 'pre', 'chaume'][R() * 7 | 0], dir: dir ? 'h' : 'v' }, R);
    x += w; } }
  // l'ombrage du relief, éclairé du nord-ouest
  for (let y = 0; y < IH; y += 16) for (let x = 0; x < IW; x += 16) {
    const [a, b] = km(x, y), gx = alt(a + .15, b) - alt(a - .15, b), gy = alt(a, b + .15) - alt(a, b - .15), s = clamp((gx * .6 + gy * .8) * 6, -1, 1);
    if (Math.abs(s) > .02) { g.fillStyle = s > 0 ? `rgba(25,35,10,${s * .32})` : `rgba(255,248,215,${-s * .26})`; g.fillRect(x, y, 16, 16); }
  }
  const urbain = Pf.modele !== 'rue' && Pf.modele !== 'airial' && Pf.modele !== 'montagne';
  if (urbain && Pf.modele !== 'fortin') { g.beginPath(); for (let a = 0; a <= TAU + .01; a += .04) { const r = Math.max(...V.ilots.filter(b => b.zone === 'ville').map(b => { const d = Math.atan2(b.c[1] - IC[1], b.c[0] - IC[0]); return Math.abs(angDiff(d, a)) < .35 ? b.d + 22 : 0; }), 40); g.lineTo(IC[0] + Math.cos(a) * r, IC[1] + Math.sin(a) * r); } g.fillStyle = '#bfb498'; g.fill(); }
  // la mer, les étangs, l'estuaire (d'après la grille du jeu), puis les rivières
  for (const [r, c] of [[11, '#e3d3a3'], [8.5, '#3d6ea6'], [6.5, '#4a7db8']]) { g.fillStyle = c; for (let y = 0; y < IH; y += 9) for (let x = 0; x < IW; x += 9) if (eauK(...km(x, y)) > (c === '#e3d3a3' ? .38 : .5)) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); } }
  for (const r of Pf.rivs) riviereL(g, r.pts, r.w, R);
  if (V.trace) {
    dessinerEnceinte(g, V.trace, { eau: !!Pf.port || Pf.rivs.length > 0, fosse: 20, interieur: '#bfb498', canons: true, portes: V.trace.cotes.map((c, i) => [i, Math.atan2(c.M[1] - IC[1], c.M[0] - IC[0])]).filter(([i, a]) => Pf.routes.some(r => Math.abs(angDiff(a, r.a)) < Math.PI / V.trace.N)).map(([i]) => i) });
    if (Pf.modele === 'fortin') { RR(g, '#d9cda9', IC[0] - 22, IC[1] - 22, 44, 44, 1); bat(g, BATS.caserne().slice(2), IC[0], IC[1], 0, .5); bat(g, BATS.poudriere(), IC[0] + 40, IC[1] - 30, .6, .7); bat(g, BATS.egliseRomane(), IC[0] - 36, IC[1] + 36, 0, .45); }
  }
  // routes jusqu'à la ville (empierrées), rues
  for (const r of V.routesL) route(g, r.pts, r.royal ? 11 : 8);
  if (V.placeCentre) { C(g, '#c9bea6', IC[0], IC[1], 24); }
  for (const rr of V.rues) for (let i = 1; i < rr.pts.length; i++) {
    const a = rr.pts[i - 1], b = rr.pts[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (V.eau(mx, my) || !V.ilots.some(q => Math.hypot(q.c[0] - mx, q.c[1] - my) < 34)) continue;   // une rue ne va que là où il y a des maisons
    if (urbain) rue(g, [a, b], rr.main ? 8 : 5); else chemin(g, [a, b], rr.main ? 7 : 4.5);
  }
  for (const r of V.routesL) if (urbain) { g.save(); g.beginPath(); g.arc(IC[0], IC[1], (V.murLigne || Pf.R) + 4, 0, TAU); g.clip(); rue(g, r.pts, 9); g.restore(); }
  // îlots
  for (const b of V.ilots) remplirIlot(g, b, V, R);
  for (const f of V.apres) f();
  if (V.placeCentre) {   // la grand-place : pavés, fontaine, halle ou statue
    C(g, '#d6ccb2', IC[0], IC[1], 22); g.strokeStyle = 'rgba(120,105,80,.18)'; g.lineWidth = .3; for (let r = 4; r < 22; r += 2.4) { g.beginPath(); g.arc(IC[0], IC[1], r, 0, TAU); g.stroke(); }
    if (Pf.modele === 'grande') { C(g, '#a89c86', IC[0], IC[1], 3.5); C(g, '#2c2f33', IC[0], IC[1], 1.4); } else { bat(g, BATS.halle().slice(1), IC[0], IC[1], Pf.routes[0]?.a || 0, .32); }
  }
  // ponts là où une route ou une rue maîtresse passe l'eau
  for (const r of Pf.rivs) for (const rr of [...V.routesL.map(x => x.pts), ...V.rues.filter(x => x.main).map(x => x.pts)]) for (let i = 1; i < rr.length; i++) {
    const [x0, y0] = rr[i - 1], [x1, y1] = rr[i], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (distPoly(r.pts, mx, my) < 6) { const a = Math.atan2(y1 - y0, x1 - x0), L = r.w + 16; g.save(); g.translate(mx, my); g.rotate(a); RR(g, 'rgba(20,20,10,.35)', -L / 2 + 1.5, -4.5 + 2, L, 9, 1.5); RR(g, '#b8ad94', -L / 2, -4.5, L, 9, 1.5); RR(g, '#cfc3a2', -L / 2, -3, L, 6, 1); for (let t = -L / 2 + 6; t < L / 2 - 4; t += 8) { E(g, '#9a907a', t, -5.2, 1.7, .9); E(g, '#9a907a', t, 5.2, 1.7, .9); } g.restore(); break; }
  }
  // quais : la ville tournée vers l'eau
  if (Pf.port) for (const r of Pf.rivs.slice(0, 1)) for (const s of [-1, 1]) { const q = decaler(r.pts, s * (r.w / 2 + 2)); g.save(); g.beginPath(); g.arc(IC[0], IC[1], Pf.R * 1.15, 0, TAU); g.clip(); ligne(g, q); g.strokeStyle = '#a39b88'; g.lineWidth = 4; g.stroke(); g.strokeStyle = '#c9bfa7'; g.lineWidth = 2.4; g.stroke(); g.restore(); }
  // murailles
  if (Pf.murs === 'medieval' && V.murLigne) murMedieval(g, V);
  if (Pf.murs === 'medieval' && V.rect) murRect(g, V);
  if (Pf.murs === 'cours' && V.murLigne) { g.beginPath(); g.arc(IC[0], IC[1], V.murLigne, 0, TAU); g.strokeStyle = '#cdbf9f'; g.lineWidth = 14; g.stroke(); for (let a = 0; a < TAU; a += .05) for (const dr of [-5, 5]) { const x = IC[0] + Math.cos(a) * (V.murLigne + dr), y = IC[1] + Math.sin(a) * (V.murLigne + dr); if (!V.eau(x, y)) arbre(g, x, y, 2.2, BOIS[2]); } }
  if (V.citadelle) { dessinerEnceinte(g, V.citadelle, { eau: true, fosse: 16, canons: true, portes: [2] }); const C2 = V.citadelle.C; RR(g, '#d9cda9', C2[0] - 15, C2[1] - 15, 30, 30, 1); bat(g, BATS.caserne().slice(2), C2[0], C2[1], 0, .45); }
  if (Pf.modele === 'castrum') { bat(g, [{ t: 'f', x: -20, y: -14, w: 40, h: 28, c: '#b9b09a', h2: 2, bal: 1 }, { t: 'g', x: -16, y: -10, w: 26, h: 12, hip: 1, p: 'lauze', h2: 3 }, { t: 'c', x: -18, y: -12, r: 5, p: 'lauze', h2: 4.5 }, { t: 'c', x: 18, y: -12, r: 4.5, p: 'lauze', h2: 4 }, { t: 'c', x: 18, y: 12, r: 4.5, p: 'lauze', h2: 4 }, { t: 'p', x: 4, y: -2, w: 12, h: 12, p: 'lauze', h2: 6 }], IC[0], IC[1], .2, .95); }
  // métiers, fermes et moulins autour
  for (const p of V.plus) {
    if (p.k === 'airial') airial(g, p.x, p.y, p.a, R, Pf.style);
    else if (p.k === 'ferme') bat(g, Pf.style === 'bearn' || Pf.style === 'basque' ? [{ t: 'g', x: -14, y: -9, w: 28, h: 18, p: Pf.style, h2: 2 }, cheminee(-6, -3), { t: 'arbre', x: 22, y: -10, r: 6 }] : BATS.fermeCour().map(q => q.p === 'tuile' ? { ...q, p: TOITS_STYLE[Pf.style][0][0] } : q), p.x, p.y, p.a, Pf.style === 'bearn' || Pf.style === 'basque' ? 1 : .7);
    else if (p.k === 'chateauVin') { bat(g, [{ t: 'r', sol: 1, c: '#d2c8b0', x: -16, y: 2, w: 32, h: 14 }, { t: 'g', x: -16, y: -9, w: 32, h: 11, hip: 1, p: 'ardoise', h2: 2.6 }, { t: 'c', x: -18, y: -6, r: 3.6, p: 'ardoise', h2: 3.4 }, { t: 'c', x: 18, y: -6, r: 3.6, p: 'ardoise', h2: 3.4 }, { t: 'g', x: -22, y: 18, w: 44, h: 8, p: TOITS_STYLE[Pf.style][0][0], h2: 1.1 }], p.x, p.y, p.a, 1); for (let i = 0; i < 4; i++) vigne(g, p.x - 70 + (i % 2) * 74, p.y + (i < 2 ? -70 : 34), 66, 34, R, i % 2); }
    else if (p.k === 'scierie') { bat(g, [{ t: 'g', x: -12, y: -7, w: 24, h: 14, p: TOITS_STYLE[Pf.style][0][0], h2: 1.6 }], p.x, p.y, p.a); for (let i = 0; i < 6; i++) tronc(g, p.x + 18, p.y - 10 + i * 3.6, p.x + 40, p.y - 9 + i * 3.6); }
    else if (p.k === 'forge') { bat(g, [{ t: 'g', x: -14, y: -8, w: 28, h: 16, p: 'ardoise', h2: 2 }, { t: 'f', x: 6, y: -3, w: 4, h: 4, c: '#5a3d2c', h2: 4 }], p.x, p.y, p.a); for (let i = 0; i < 14; i++) C(g, '#3a3530', p.x + 20 + (R() - .5) * 16, p.y + 12 + (R() - .5) * 10, 1.4); }
    else if (p.k === 'salines') { for (let i = 0; i < 12; i++) { RR(g, '#e9ecef', p.x - 40 + (i % 4) * 20, p.y - 24 + (i / 4 | 0) * 16, 17, 13, 1); RR(g, '#c9d6de', p.x - 38 + (i % 4) * 20, p.y - 22 + (i / 4 | 0) * 16, 13, 9, 1); } }
    else if (p.k === 'sechoir') bat(g, [{ t: 'g', x: -20, y: -5, w: 40, h: 10, p: TOITS_STYLE[Pf.style][0][0], h2: 2 }], p.x, p.y, p.a);
    else if (p.k === 'moulin') p.ailes = true;
  }
  if (V.gare) {
    g.save(); g.translate(V.gare.x, V.gare.y); g.rotate(V.gare.a);
    for (const s of [-1, 1]) { T(g, '#5b4a3a', 4, -IW, s * 4, IW, s * 4); for (let x = -IW; x < IW; x += 2) T(g, '#6b5a48', .6, x, s * 4 - 1.6, x, s * 4 + 1.6); T(g, '#3a3a3a', .35, -IW, s * 4 - .9, IW, s * 4 - .9); T(g, '#3a3a3a', .35, -IW, s * 4 + .9, IW, s * 4 + .9); }
    g.restore(); bat(g, BATS.gare().slice(1), V.gare.x, V.gare.y, V.gare.a, .55);
  }
  return { c: cv, k };
}
function riviereL(g, pts, w, R) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  ligne(g, pts); g.strokeStyle = '#557f3e'; g.lineWidth = w + 18; g.stroke(); g.strokeStyle = '#4b7438'; g.lineWidth = w + 8; g.stroke();
  g.strokeStyle = '#355f97'; g.lineWidth = w; g.stroke(); g.strokeStyle = '#4a78b4'; g.lineWidth = w * .72; g.stroke();
  g.setLineDash([2.5, 11, 1.2, 9]); g.strokeStyle = 'rgba(160,195,235,.45)'; g.lineWidth = .9; g.stroke(); g.setLineDash([]);
}
function murMedieval(g, V) {
  const pts = []; for (let a = 0; a <= TAU + .001; a += .03) { const r = V.murLigne; pts.push([IC[0] + Math.cos(a) * r, IC[1] + Math.sin(a) * r, a]); }
  const portes = V.Pf.routes.map(r => pts.reduce((b, p) => Math.abs(angDiff(p[2], r.a)) < Math.abs(angDiff(b[2], r.a)) ? p : b));
  g.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (V.eau((x0 + x1) / 2, (y0 + y1) / 2)) continue; T(g, '#6e8a4a', 16, x0, y0, x1, y1); }
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (V.eau((x0 + x1) / 2, (y0 + y1) / 2)) continue; T(g, '#8f876f', 4.4, x0, y0, x1, y1); T(g, '#b5aa92', 3, x0, y0, x1, y1); }
  let acc = 0;
  for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); const [x, y] = pts[i]; if (acc > 36 && !V.eau(x, y) && portes.every(p => Math.hypot(p[0] - x, p[1] - y) > 16)) { acc = 0; C(g, 'rgba(20,20,10,.33)', x + 2, y + 2.6, 4.6); C(g, '#b5aa92', x, y, 4.6); coneF(g, x, y, 3.9, PAL[TOITS_STYLE[V.Pf.style][0][0]], 0); } }
  for (const [x, y, a] of portes) bat(g, [{ t: 'c', x: 0, y: -6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'c', x: 0, y: 6, r: 4.6, p: 'ardoise', h2: 2.6 }, { t: 'g', x: -4, y: -3, w: 8, h: 6, p: 'ardoise', hip: 1, h2: 2.2 }], x, y, a);
  V.lieux.remparts = { x: portes[0]?.[0] ?? IC[0], y: portes[0]?.[1] ?? IC[1] };
}
function murRect(g, V) {
  const { a, w, h } = V.rect, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const x = u * (w / 2 + 10), y = v * (h / 2 + 10); return [IC[0] + Math.cos(a) * x - Math.sin(a) * y, IC[1] + Math.sin(a) * x + Math.cos(a) * y]; });
  chemin_(g, c); g.strokeStyle = '#6e8a4a'; g.lineWidth = 14; g.stroke(); chemin_(g, c); g.strokeStyle = '#8f876f'; g.lineWidth = 4.2; g.stroke(); g.strokeStyle = '#b5aa92'; g.lineWidth = 2.8; g.stroke();
  for (const [x, y] of c) { C(g, '#b5aa92', x, y, 5); coneF(g, x, y, 4.2, PAL[TOITS_STYLE[V.Pf.style][0][0]], 0); }
  V.lieux.remparts = { x: c[0][0], y: c[0][1] };
}

// ---------- la carte de campagne, même style
const mcv = document.getElementById('carte');
const NIVEAUX = [2, 4, 8, 16, 32, 64, 128, 256];
const TUILE = 512;
const CARTE = new Scene(mcv, {
  max: 700, tuiles: new Map(), zMax: 320, vent: [.004, -.002],
  sol(sc, g) {
    const m = sc.m, L = NIVEAUX.find(l => l >= m * .85) || 256, tk = TUILE / L;
    const x0 = sc.cx - sc.W / 2 / m, y0 = sc.cy - sc.H / 2 / m, x1 = x0 + sc.W / m, y1 = y0 + sc.H / m;
    g.fillStyle = '#4f86a8'; g.fillRect(0, 0, sc.W, sc.H);
    sc.monde(g);
    let neuves = 0; const t0 = performance.now();
    for (let tj = Math.floor(y0 / tk); tj * tk < y1; tj++) for (let ti = Math.floor(x0 / tk); ti * tk < x1; ti++) {
      const key = L + ':' + ti + ':' + tj; let t = sc.tuiles.get(key);
      // une tuile neuve au moins par image, d'autres tant qu'il reste du temps
      if (!t && (!neuves || performance.now() - t0 < 10)) { t = peindreTuile(L, ti, tj); sc.tuiles.set(key, t); neuves++; if (sc.tuiles.size > 90) sc.tuiles.delete(sc.tuiles.keys().next().value); }
      if (!t) { const Lb = NIVEAUX[Math.max(0, NIVEAUX.indexOf(L) - 2)], tb = TUILE / Lb, kb = Lb + ':' + Math.floor(ti * tk / tb) + ':' + Math.floor(tj * tk / tb), b = sc.tuiles.get(kb); if (b) { const ox = ti * tk - Math.floor(ti * tk / tb) * tb, oy = tj * tk - Math.floor(tj * tk / tb) * tb; g.drawImage(b, ox * Lb, oy * Lb, tk * Lb, tk * Lb, ti * tk, tj * tk, tk, tk); } sc.attente = true; continue; }
      g.drawImage(t, ti * tk, tj * tk, tk + .01, tk + .01);
    }
  },
});
// couleur de pays d'un carreau : des zones de quelques kilomètres, pas un damier
const bruitC = (i, j, s) => .5 + .25 * Math.sin(i * .31 + s) * Math.cos(j * .27 - s * .6) + .25 * Math.sin((i * .13 - j * .17) + s * 2.3);
const CHAMPS = ['chaume', 'ble', 'labour', 'pre', 'colza', 'friche', 'pre', 'chaume'];
const champDe = (i, j, h) => CHAMPS[Math.min(7, ((bruitC(i, j, 1.7) * .8 + h * .2) * 8) | 0)];
// les pays ne suivent pas la grille du jeu : chaque point lit le terrain un peu à côté, d'un décalage qui ondule
// (bords de bois, de landes et de côte sinueux au lieu de carrés d'un kilomètre)
const ondeX = (x, y) => .55 * Math.sin(x * 1.31 + Math.sin(y * .93) * 1.7) + .3 * Math.sin(y * 2.7 + x * .61) + .15 * Math.sin((x + y) * 5.3);
const ondeY = (x, y) => .55 * Math.sin(y * 1.17 + Math.sin(x * .87) * 1.7) + .3 * Math.sin(x * 2.9 - y * .57) + .15 * Math.sin((x - y) * 4.9);
const terOnde = (x, y) => ter(x + ondeX(x, y), y + ondeY(x, y));
const COUL = { 0: '#4f86a8', 1: '#4f86a8', 3: '#3a6834', 4: '#a39e68', 5: '#6f8f5a', 7: '#8f9a6a', 8: '#d9dcd8', 9: '#e3d3a3', 10: '#8f8456' };
const COUL_RGB = Object.fromEntries(Object.entries(COUL).map(([k, v]) => [k, hx(v)]));
const RGB_CHAMP = Object.fromEntries(Object.entries(SOLS).map(([k, v]) => [k, hx(v.base)]));
const pinede = (x, y) => x < GEO.x_cote + 70 && y > 80 && y < 230;
// la couleur d'un point de la carte : pays, ombrage du relief, sable au bord de l'eau
function couleurEn(x, y, pas) {
  const t = terOnde(x, y);
  let c = t === TT.FORET && pinede(x, y) ? [86, 112, 64] : COUL_RGB[t];
  if (!c) { const a = bruitC(x * .9, y * .9, 1.7), b = bruitC(x * .5, y * .5, 4.1); c = [lerp(lerp(206, 124, a), 196, b * .4), lerp(lerp(186, 166, a), 178, b * .4), lerp(lerp(122, 90, a), 120, b * .4)]; }
  if (t > 1 && (terOnde(x + pas * 1.5, y) <= 1 || terOnde(x - pas * 1.5, y) <= 1 || terOnde(x, y + pas * 1.5) <= 1 || terOnde(x, y - pas * 1.5) <= 1)) c = COUL_RGB[9];
  c = saisonner(c, t, x, y);
  let k = 1;
  if (t > 1) { const gx = alt(x + .5, y) - alt(x - .5, y), gy = alt(x, y + .5) - alt(x, y - .5); k = clamp(1 - (gx * .6 + gy * .8) * 2.6, .62, 1.3); }
  const v = t <= 1 ? 1 : .95 + .1 * bruitC(x * 1.2, y * 1.2, .4);
  return [c[0] * k * v, c[1] * k * v, c[2] * k * v, t];
}
// le fond peint de toute la carte, à 4 px par km, lissé à l'agrandissement
const FOND = document.createElement('canvas');
function peindreFond() {
  const P = 4; FOND.width = GW * P; FOND.height = GH * P;
  const g = FOND.getContext('2d'), img = g.createImageData(FOND.width, FOND.height);
  for (let j = 0; j < FOND.height; j++) for (let i = 0; i < FOND.width; i++) {
    const c = couleurEn((i + .5) / P, (j + .5) / P, 1 / P), o = (j * FOND.width + i) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
// parcelles en briques de tailles variées, sur des rangs qui ne suivent pas la grille du jeu
function parcelles(x0, y0, x1, y1, fn) {
  const hr = .78;
  for (let r = Math.floor(y0 / hr) - 1; r * hr < y1 + hr; r++) {
    const ya = r * hr + (hash2(r, 1, 9) - .5) * .12, yb = (r + 1) * hr + (hash2(r + 1, 1, 9) - .5) * .12;
    const lx = .62 + hash2(r, 3, 9) * .4, dec = hash2(r, 5, 9) * lx;
    for (let k = Math.floor((x0 - dec) / lx) - 1; k * lx + dec < x1 + lx; k++) {
      const xa = k * lx + dec + (hash2(r, k, 2) - .5) * lx * .5, xb = (k + 1) * lx + dec + (hash2(r, k + 1, 2) - .5) * lx * .5;
      fn(xa, ya, xb - xa, yb - ya, hash2(r, k, 7));
    }
  }
}
function peindreTuile(L, ti, tj) {
  const c = document.createElement('canvas'); c.width = c.height = TUILE;
  const g = c.getContext('2d'), tk = TUILE / L, x0 = ti * tk, y0 = tj * tk, x1 = x0 + tk, y1 = y0 + tk;
  g.scale(L, L); g.translate(-x0, -y0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
  const px = 1 / L, R = alea(ti * 7919 + tj * 104729 + L), u = .6 / Math.min(L, 64);
  if (L < 16) g.drawImage(FOND, x0 * 4, y0 * 4, tk * 4, tk * 4, x0, y0, tk, tk);
  else {
    // de près : un fond plus fin, puis les parcelles et les bois posés selon ce fond, bords adoucis
    // échantillons sur une grille absolue, avec une marge : les houppiers qui débordent d'une tuile sont les mêmes dans la voisine (pas de couture)
    const pas0 = Math.max(2 / L, 1 / 64), pas = Math.max(3 / L, 1 / 64), kp = (pas / pas0) ** 2, M = Math.ceil(.13 / pas) + 1;
    const gi0 = Math.floor(x0 / pas) - M, gj0 = Math.floor(y0 / pas) - M, n = Math.ceil(tk / pas) + 2 * M + 1, fin = document.createElement('canvas'); fin.width = fin.height = n;
    const fg = fin.getContext('2d'), img = fg.createImageData(n, n), masque = new Uint8Array(n * n), bois = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = gi0 + i, gj = gj0 + j, x = (gi + .5) * pas, y = (gj + .5) * pas, col = couleurEn(x, y, pas), o = (j * n + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      const t = col[3];
      if (t === TT.PLAINE || t === TT.COLLINES || t === TT.VIGNE) masque[j * n + i] = t === TT.VIGNE ? 2 : 1;
      if (t === TT.LANDE && hash2(gi, gj, L + 1) < .012 * (L / 16) ** 2 * kp) bois.push([x, y, true]);
      if (t === TT.FORET && hash2(gi, gj, L) < (pinede(x, y) ? .3 : .75) * (16 / L) ** 2 * 4 * kp) bois.push([x + (hash2(gj, gi, 3) - .5) * pas, y + (hash2(gi, gj, 4) - .5) * pas, pinede(x, y)]);
    }
    fg.putImageData(img, 0, 0);
    g.drawImage(fin, gi0 * pas, gj0 * pas, n * pas, n * pas);
    // parcelles, peintes à part puis découpées par le masque des champs (bords doux)
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = TUILE;
    const tg = tmp.getContext('2d'); tg.scale(L, L); tg.translate(-x0, -y0);
    const champ = (x, y) => { const i = clamp(Math.floor(x / pas) - gi0, 0, n - 1), j = clamp(Math.floor(y / pas) - gj0, 0, n - 1); return masque[j * n + i]; };
    if (L >= 32) parcelles(x0, y0, x1, y1, (x, y, w, h, hh) => {
      const m = champ(x + w / 2, y + h / 2); if (!m) return;
      tg.save(); tg.translate(x, y); tg.scale(u, u); const W = w / u, H = h / u;
      if (m === 2) vigne(tg, .6, .6, W - 1.2, H - 1.2, R, hh < .5);
      else { const sol = solSaison(champDe((x + w / 2) * 1.8, (y + h / 2) * 1.8, hh), x + w / 2, y + h / 2, hh), dir = hh * 13 % 1 < .5 ? 'h' : 'v'; parcelle(tg, { x: .7, y: .7, w: W - 1.4, h: H - 1.4, sol, dir, det: L >= 64 ? .4 : .7 }, R); if (sol === 'moisson') gerbes(tg, W, H, dir, R); }
      tg.restore();
      if (L >= 64 && hh < .04) bat(tg, [{ t: 'g', x: -6, y: -3, w: 12, h: 6, p: 'tuile', h2: 1 }], x + w * .3, y + h * .4, hh * 40, u * 2.2);   // une ferme isolée
    });
    const mc = document.createElement('canvas'); mc.width = mc.height = n; const mg = mc.getContext('2d'), mi = mg.createImageData(n, n);
    for (let k = 0; k < n * n; k++) { mi.data[k * 4 + 3] = masque[k] ? 255 : 0; }
    mg.putImageData(mi, 0, 0);
    tg.globalCompositeOperation = 'destination-in'; tg.setTransform(1, 0, 0, 1, 0, 0); tg.imageSmoothingEnabled = true;
    tg.drawImage(mc, (gi0 * pas - x0) * L, (gj0 * pas - y0) * L, n * pas * L, n * pas * L);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = .82; g.drawImage(tmp, 0, 0); g.restore();
    // bois : houppiers ronds là où le fond dit forêt, lisières sinueuses
    const pts = bois.map(([x, y, pin]) => [x, y, (pin ? .055 : .085) * (.75 + hash2(x * 50 | 0, y * 50 | 0) * .6), pin ? '#2f5a33' : boisSaison(hash2(x * 31 | 0, y * 17 | 0))]);
    // un seul tracé par couleur : des milliers de houppiers par tuile
    const disques = (col, liste, dx, dy, k) => { if (!liste.length) return; g.fillStyle = col; g.beginPath(); for (const p of liste) { const r = p[2] * k, x = p[0] + p[2] * dx, y = p[1] + p[2] * dy; g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); } g.fill(); };
    disques(OMBRE, pts.map(p => [p[0] + .025, p[1] + .033, p[2]]), 0, 0, 1);
    const parCoul = new Map(); for (const p of pts) { let l = parCoul.get(p[3]); if (!l) parCoul.set(p[3], l = []); l.push(p); }
    const nus = AMB.saison === 'hiver';
    for (const [col, l] of parCoul) { g.globalAlpha = nus && col !== '#2f5a33' ? .45 : 1; disques(col, l, 0, 0, nus && col !== '#2f5a33' ? .85 : 1); }
    g.globalAlpha = 1;
    g.globalAlpha = .26; disques(LUMIERE_BOIS[AMB.saison], nus ? pts.filter(p => p[3] === '#2f5a33') : pts, -.32, -.34, .5);
    g.globalAlpha = .7; disques('#f2f4f2', pts.filter(p => (!nus || p[3] === '#2f5a33') && neige(p[0], p[1]) > .5), -.2, -.25, .62); g.globalAlpha = 1;   // neige sur les houppiers
    decorTuile(g, L, x0, y0, x1, y1, R);
    // vagues au large
    g.strokeStyle = 'rgba(200,225,240,.35)'; g.lineWidth = px;
    for (let k = 0; k < tk * tk * .6; k++) { const x = x0 + R() * tk, y = y0 + R() * tk; if (terOnde(x, y) === 0) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 7 * px, y - 3 * px, x + 14 * px, y); g.stroke(); } }
  }
  const dedans = bb => bb[2] >= x0 - 1 && bb[0] <= x1 + 1 && bb[3] >= y0 - 1 && bb[1] <= y1 + 1;
  for (const w of GEO.waters) if (dedans(w.bb)) { chemin_(g, w.ring); g.fillStyle = '#4f86a8'; g.fill(); g.strokeStyle = '#e3d3a3'; g.lineWidth = Math.max(.08, 1.5 * px); g.stroke(); }
  // rivières
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of GEO.rivers) if (dedans(r.bb)) { const w = Math.max([0, .32, .16, .09, .06][r.rank] || .05, 1.3 * px); ligne(g, r.pts); g.strokeStyle = '#4b7438'; g.lineWidth = w + Math.max(.06, 2 * px); g.stroke(); g.strokeStyle = '#4a78b4'; g.lineWidth = w; g.stroke(); }
  // routes : royales empierrées (bordées d'arbres de près), chemins
  for (const e of GEO.edges) if (dedans(e.bb) && !e.ferry && (e.royal || L >= 8)) {
    const w = e.royal ? Math.max(.07, 2.6 * px) : Math.max(.04, 1.4 * px);
    if (e.royal && L >= 32) for (let i = 1; i < e.pts.length; i++) { const [a0, b0] = e.pts[i - 1], [a1, b1] = e.pts[i], l = Math.hypot(a1 - a0, b1 - b0), nx = -(b1 - b0) / l, ny = (a1 - a0) / l; for (let t = 0; t < l; t += .14) for (const s of [-1, 1]) arbre(g, a0 + (a1 - a0) * t / l + nx * s * (w + .03), b0 + (b1 - b0) * t / l + ny * s * (w + .03), .035, boisSaison(.4)); }
    ligne(g, e.pts); g.strokeStyle = e.royal ? '#8f7a55' : '#a8946a'; g.lineWidth = w + Math.max(.02, 1 * px); g.stroke(); g.strokeStyle = e.royal ? '#d9c79c' : '#cdb98a'; g.lineWidth = w; g.stroke();
  }
  // frontières des départements
  g.setLineDash([4 * px, 3 * px]);
  for (const [k, d] of Object.entries(GEO.depts)) d.rings.forEach((ring, q) => { if (!dedans(d.bbs[q])) return; chemin_(g, ring); g.strokeStyle = d.playable ? 'rgba(70,50,30,.55)' : 'rgba(70,50,30,.25)'; g.lineWidth = (d.playable ? 1.6 : 1) * px; g.stroke(); });
  g.setLineDash([]);
  return c;
}
// villes sur la carte : de loin un signe, de près le vrai plan de la ville (le même que l'intérieur)
const PLANS = new Map();
function planCarte(n) {
  let p = PLANS.get(n.id); if (p) return p;
  const Pf = profilVille(n, ANNEE), V = genererInterieur(Pf), res = 1.2, c = document.createElement('canvas'), Rr = Math.min(Pf.R * 1.6, 380);
  c.width = c.height = Math.round(Rr * 2 * res);
  const g = c.getContext('2d'); g.scale(res, res); g.translate(Rr - IC[0], Rr - IC[1]);
  for (const b of V.ilots) { const q = decalerQuad(b.q, b.main ? 4.6 : 2.7); if (!q) continue; const P = PAL[b.role === 'cathedrale' || b.role === 'eglise' ? 'ardoise' : TOITS_STYLE[Pf.style][0][0]]; chemin_(g, q); g.fillStyle = b.zone === 'faubourg' ? mix(P[0], '#7aa659', .55) : b.role === 'place' || b.role === 'parvis' ? '#d6ccb2' : P[0]; g.fill(); if (b.zone === 'ville' && b.aire > 600 && !b.role) { const inn = decalerQuad(q, 8); if (inn) { chemin_(g, inn); g.fillStyle = '#cdbf9f'; g.fill(); } } }
  if (V.placeCentre) C(g, '#d6ccb2', IC[0], IC[1], 22);
  if (V.murLigne && Pf.murs === 'medieval') { g.beginPath(); g.arc(IC[0], IC[1], V.murLigne, 0, TAU); g.strokeStyle = '#8f876f'; g.lineWidth = 5; g.stroke(); }
  if (V.trace) { chemin_(g, V.trace.poly); g.strokeStyle = '#6f9450'; g.lineWidth = 16; g.stroke(); g.strokeStyle = '#b5aa92'; g.lineWidth = 3.5; g.stroke(); }
  if (V.citadelle) { chemin_(g, V.citadelle.poly); g.fillStyle = '#9cb36e'; g.fill(); g.strokeStyle = '#b5aa92'; g.lineWidth = 3; g.stroke(); }
  // fenêtres pour la nuit : des points le long des façades des îlots, en km
  const lum = []; for (const b of V.ilots) { if (b.role === 'place' || b.role === 'parvis') continue; const q = decalerQuad(b.q, 6); if (!q) continue; for (let i = 0; i < q.length; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % q.length], l = Math.hypot(bx - ax, by - ay); for (let d = 4; d < l; d += 9) if (hash2(lum.length, n.id, 41) < .45) lum.push([n.x + (ax + (bx - ax) * d / l - IC[0]) / S, n.y + (ay + (by - ay) * d / l - IC[1]) / S]); } }
  p = { c, Rr, res, lum: lum.slice(0, 900), V }; PLANS.set(n.id, p); return p;
}
let ANNEE = 1789, choisie = null;
const TYPE_TXT = { capitale: 'Capitale', ville: 'Ville', village: 'Village', fort: 'Place forte' };
CARTE.sous = (sc, g) => {
  sc.monde(g);
  const z = sc.z, x0 = sc.cx - sc.cssW / 2 / z - 3, x1 = sc.cx + sc.cssW / 2 / z + 3, y0 = sc.cy - sc.cssH / 2 / z - 3, y1 = sc.cy + sc.cssH / 2 / z + 3;
  for (const n of GEO.nodes) {
    if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
    const rang = n.type === 'capitale' ? 3 : n.type === 'ville' || n.type === 'fort' ? 2 : 1;
    if (z >= 18) { const p = planCarte(n), s = 1 / (S * p.res); g.drawImage(p.c, n.x - p.Rr / S, n.y - p.Rr / S, p.c.width * s, p.c.height * s); }
    else if (z * (rang === 1 ? 1 : 2) > 3) {   // le signe : quelques toits autour du clocher
      const st = styleDe(n), P = PAL[TOITS_STYLE[st][0][0]], k = (rang === 3 ? 2.2 : rang === 2 ? 1.5 : 1) * Math.max(1, 6 / z) * .16, nb = rang === 3 ? 9 : rang === 2 ? 6 : 3;
      if (n.fort) { g.beginPath(); g.arc(n.x, n.y, k * 2.2, 0, TAU); g.strokeStyle = '#b5aa92'; g.lineWidth = k * .35; g.stroke(); }
      for (let i = 0; i < nb; i++) { const a = i * 2.4 + hash2(n.id, i) * .6, d = k * (.5 + (i % 3) * .5); g.save(); g.translate(n.x + Math.cos(a) * d, n.y + Math.sin(a) * d); g.rotate(a); g.fillStyle = 'rgba(20,20,10,.3)'; g.fillRect(-k * .45 + k * .08, -k * .28 + k * .1, k * .9, k * .56); g.fillStyle = P[0]; g.fillRect(-k * .45, -k * .28, k * .9, k * .28); g.fillStyle = P[1]; g.fillRect(-k * .45, 0, k * .9, k * .28); g.restore(); }
      C(g, '#6a7282', n.x, n.y, k * .42);
    }
  }
  // les nuages passent et leur ombre glisse sur les pays
  g.globalAlpha = .1;
  for (let k = 0; k < 14; k++) { const r = 9 + hash2(k, 1, 5) * 14, x = mod(hash2(k, 2, 5) * (GW + 60) + sc.time * .05, GW + 60) - 30, y = mod(hash2(k, 3, 5) * (GH + 60) - sc.time * .02, GH + 60) - 30; if (x + r > x0 && x - r < x1 && y + r > y0 && y - r < y1) g.drawImage(SPR.n, x - r, y - r * .7, r * 2, r * 1.4); }
  g.globalAlpha = 1;
  // bateaux : gabarres sur les rivières, navires sur l'estuaire et la côte (de près)
  if (z >= 18) for (const b of BATEAUX) {
    const p = surChemin(b.pts, mod(b.s0 + sc.time * b.v, b.L)); if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    g.save(); g.translate(p.x, p.y); g.rotate(p.a + (b.v < 0 ? Math.PI : 0)); const k = Math.max(.006, 2 / z); g.scale(k, k);
    E(g, 'rgba(20,30,40,.3)', 1.5, 2, b.mer ? 11 : 8, b.mer ? 3 : 2.2); E(g, '#5b4127', 0, 0, b.mer ? 11 : 8, b.mer ? 3 : 2.2); E(g, '#8a6a45', 0, 0, b.mer ? 9.5 : 6.6, b.mer ? 2 : 1.4);
    if (b.mer) for (const m of [-4, 0, 4]) RR(g, '#ece4cc', m - .8, -4.5, 1.6, 9, .4); else { RR(g, '#e0d2ab', -1, -3.6, 2, 7.2, .4); RR(g, '#b8a27a', -6, -1.2, 4, 2.4, .4); }
    g.restore();
  }
  // fumées des cheminées au-dessus des villes
  if (z >= 14) for (const n of GEO.nodes) { if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue; const r = profilVille(n, ANNEE).R / S; if (Math.random() < .04 * (n.type === 'village' ? 1 : 3) * densite(n.x, n.y) * (AMB.saison === 'hiver' ? 2 : AMB.saison === 'ete' ? .5 : 1)) fumee(sc, n.x + (Math.random() - .5) * r, n.y + (Math.random() - .5) * r, 0, 0, .01, .07, 5, .3); }
  if (z >= VIE_Z) vieDePres(sc, g, x0, y0, x1, y1);
  // armées : de loin un fanion et une courte file, de près la colonne de route homme par homme
  for (const a of ARMEES) {
    if (bivouac()) { campArmee(sc, g, a, x0, y0, x1, y1); continue; }
    if (z >= VIE_Z) { colonne(sc, g, a, x0, y0, x1, y1); continue; }
    pionArmee(sc, g, a);
  }
};
function pionArmee(sc, g, a) {
  const z = sc.z, p = surChemin(a.pts, clamp(a.s, 0, a.L));
  sc.fig(g, p.x, p.y, p.a);
  const k = Math.max(.015, 1.7 / z);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { C(g, 'rgba(20,20,10,.3)', -i * k * 1.2 + k * .2, s * k * .45 + k * .25, k * .42); C(g, a.c, -i * k * 1.2, s * k * .45, k * .42); C(g, '#1c1b1d', -i * k * 1.2 + k * .05, s * k * .45, k * .2); }
  sc.monde(g); g.save(); g.translate(p.x, p.y); g.scale(1.5 / z, 1.5 / z); drapeau(g, { drap: a.drap }, 0, 0, sc.time, a.s, false); g.restore();
}
const VIE_Z = 110, U = .0045;   // la vie n'apparaît qu'au plus près ; U : km par unité de dessin des figures
// place une figure : position en km, cap, puis dessin en unités de figure
const figK = (sc, g, x, y, a, s = 1) => { sc.fig(g, x, y, a); g.scale(U * s, U * s); g.lineCap = 'round'; };
const LCIV = tenue('fr', 'civil');
const CIVILS = ['#7a6a4f', '#5d6b86', '#8a5a44', '#6e5c45', '#4f5a6a', '#9a4a3a'].map((h, i) => ({ L: Object.assign({}, LCIV, { tete: i % 2 ? 'coiffe' : 'rond' }), habit: h }));
function marcheur(g, k, pas, bagage) { const c = CIVILS[k % CIVILS.length]; fantassin(g, c.L, { role: 'h', habit: c.habit }, { legs: pas, arme: 'aucun' }); if (bagage) C(g, '#b9a37a', -2.1, 0, 1.4); }
function charrette(g, pas, boeufs, k) {
  for (const x of [-4, 4]) { RR(g, '#3a2a1b', x - 2, -3.7, 4, 1, .4); RR(g, '#3a2a1b', x - 2, 2.7, 4, 1, .4); }
  T(g, '#5b4127', .6, 6, 0, 10, 0); RR(g, '#8a6a45', -6.5, -2.9, 13, 5.8, .6);
  RR(g, ['#b8a27a', '#d6ba5c', '#6b8fb5'][k % 3], -5.5, -2.2, 10, 4.4, .5);
  for (const y of boeufs ? [-2.4, 2.4] : [0]) { g.save(); g.translate(15, y); cheval(g, boeufs ? '#d2bf95' : '#6b4a2c', { gait: pas, bob: 0 }); if (boeufs) { T(g, '#efe6cc', .35, 7.7, -.6, 8.3, -1.4); T(g, '#efe6cc', .35, 7.7, .6, 8.3, 1.4); } g.restore(); }
}
function diligence(g, pas) {
  for (const x of [-5, 5]) { RR(g, '#e3c04f', x - 2.2, -4.2, 4.4, 1, .4); RR(g, '#e3c04f', x - 2.2, 3.2, 4.4, 1, .4); }
  RR(g, '#2f4a3a', -7, -3.4, 14, 6.8, 1.2); RR(g, '#1c1b1d', -6, -2.8, 9, 5.6, 1); RR(g, '#b9a37a', -6.4, -2.4, 4, 4.8, .6);
  for (const x of [15, 26]) for (const y of [-2.6, 2.6]) { g.save(); g.translate(x, y); cheval(g, x === 15 ? '#6b4a2c' : '#3f2d1f', { gait: pas + x, bob: 0 }); g.restore(); }
}
// gens sur les routes : on les tire de la route elle-même (même route, mêmes passants), ils vont et viennent
function vieDePres(sc, g, x0, y0, x1, y1) {
  const t = sc.time, dans = (x, y) => x > x0 - .2 && x < x1 + .2 && y > y0 - .2 && y < y1 + .2;
  GEO.edges.forEach((e, ie) => {
    if (e.ferry || e.bb[2] < x0 || e.bb[0] > x1 || e.bb[3] < y0 || e.bb[1] > y1) return;
    const L = e.L || (e.L = longueur(e.pts)), n = Math.ceil(L / (e.royal ? 1.1 : 2.2) * (AMB.ev.marche ? 1.6 : 1));
    for (let k = 0; k < n; k++) {
      const h = hash2(ie, k, 31), sens = h < .5 ? 1 : -1, sorte = hash2(ie, k, 32);
      let kind = e.royal ? (sorte < .05 ? 'malle' : sorte < .12 ? 'diligence' : sorte < .4 ? 'charrette' : sorte < .55 ? 'cavalier' : sorte < .62 ? 'troupeau' : 'pieton') : (sorte < .35 ? 'boeufs' : sorte < .5 ? 'troupeau' : sorte < .58 ? 'cavalier' : 'pieton');
      const p0 = surChemin(e.pts, h * L); if (hash2(ie, k, 34) > densite(p0.x, p0.y)) continue;   // pays déserté (siège, bataille, disette)
      if (disette(p0.x, p0.y) && sorte > .55) kind = hash2(ie, k, 35) < .4 ? 'convoi' : 'mendiant';
      const v = { malle: .045, diligence: .03, cavalier: .025, charrette: .009, boeufs: .006, troupeau: .004, pieton: .0045, convoi: .004, mendiant: .003 }[kind];
      const p = surChemin(e.pts, mod(h * L + sens * v * t, L)); if (!dans(p.x, p.y)) continue;
      const a = p.a + (sens < 0 ? Math.PI : 0), cote = .012, x = p.x - Math.sin(a) * cote, y = p.y + Math.cos(a) * cote, pas = t * 1.7 * TAU + k;
      if (kind === 'troupeau') {
        figK(sc, g, x, y, a); marcheur(g, k, pas, false); T(g, '#6b4d31', .4, .4, 2, 5, 2.8);
        for (let m = 0; m < 9; m++) { const ox = -5 - (m % 3) * 3 - Math.random() * 0, oy = ((m / 3 | 0) - 1) * 2.6 + Math.sin(t * 2 + m) * .4; g.save(); g.translate(ox * 1.4 - 4, oy); for (const [cx, cy] of [[-1, -.6], [-1, .6], [.4, -.7], [.4, .7], [-.3, 0]]) C(g, '#f1efe6', cx, cy, .9); C(g, '#2c2a28', 1.9, 0, .6); g.restore(); }
      } else {
        figK(sc, g, x, y, a);
        if (kind === 'malle') mallePoste(g, pas); else if (kind === 'convoi') convoiFunebre(g, pas, k); else if (kind === 'mendiant') { fantassin(g, CIVILS[0].L, { role: 'h', habit: '#4a4338' }, { legs: pas * .6, arme: 'aucun' }); T(g, '#6b4d31', .4, 1, 1.6, 4.5, 2.2); }
        else if (kind === 'diligence') diligence(g, pas); else if (kind === 'charrette' || kind === 'boeufs') charrette(g, pas, kind === 'boeufs', k);
        else if (kind === 'cavalier') { cheval(g, ['#6b4a2c', '#3f2d1f', '#8b6a47'][k % 3], { gait: pas * 1.4, bob: 0 }); cavalier(g, LCIV, { habit: '#5d6b86' }, { sabre: 0, bob: 0 }); }
        else marcheur(g, k, pas, hash2(ie, k, 33) < .5);
      }
    }
    routesEnPlus(sc, g, e, ie, L, dans);
  });
  // bêtes : chaque kilomètre de pays a les siennes (même endroit, mêmes bêtes), elles broutent ou passent
  for (let j = Math.floor(y0); j <= y1; j++) for (let i = Math.floor(x0); i <= x1; i++) {
    const tt = ter(i + .5, j + .5), h = hash2(i, j, 77); if (tt <= 1 || hash2(i, j, 76) > densite(i + .5, j + .5)) continue;
    const bx = i + .2 + hash2(i, j, 78) * .6, by = j + .2 + hash2(j, i, 79) * .6;
    const troupe = (n, fn) => { for (let m = 0; m < n; m++) { const ph = m * 2.1 + h * 9, x = bx + Math.cos(ph) * .03 + Math.sin(t * .05 + ph) * .02, y = by + Math.sin(ph * 1.3) * .025 + Math.cos(t * .04 + ph) * .015; if (dans(x, y)) fn(x, y, ph + t * .05, m); } };
    if ((tt === TT.PLAINE || tt === TT.COLLINES || tt === TT.MONTAGNE) && h < .22 * BETES[AMB.saison] && neige(i + .5, j + .5) < .5) {
      if (h < .1) troupe(5, (x, y, a, m) => { figK(sc, g, x, y, a); const robe = m % 2 ? '#efe9dd' : '#c9a07a'; E(g, robe, 0, 0, 4.3, 1.9); E(g, '#3a2c22', -1.2, .5, 1.4, .9); E(g, sombre(robe, .08), 4.6 + Math.max(0, Math.sin(t + m)) * .8, 0, 1.4, .95); });
      else troupe(10, (x, y, a) => { figK(sc, g, x, y, a); for (const [cx, cy] of [[-1, -.6], [-1, .6], [.4, -.7], [.4, .7], [-.3, 0]]) C(g, '#f1efe6', cx, cy, .9); C(g, '#2c2a28', 1.9, 0, .6); });
    } else if (tt === TT.FORET && h < .16) {
      const sanglier = h < .06;
      troupe(sanglier ? 3 : 4, (x, y, a, m) => { figK(sc, g, x, y, a); if (sanglier) { E(g, '#3a2c22', 0, 0, 2.6, 1.3); E(g, '#2a1f18', 2.6, 0, 1, .7); } else { E(g, m ? '#9a6a40' : '#8a5a34', 0, 0, 3.4, 1.2); E(g, '#f1e6d0', -3, 0, .7, .6); T(g, '#8a5a34', .7, 2.6, 0, 4.6, 0); E(g, '#7a4a2a', 4.9, 0, .9, .55); if (!m) { T(g, '#5b3d24', .3, 4.9, -.4, 5.8, -1.6); T(g, '#5b3d24', .3, 4.9, .4, 5.8, 1.6); } } });
    } else if (tt === TT.LANDE && h < .14) {
      // le berger landais sur ses échasses : on voit surtout la longue ombre des échasses
      figK(sc, g, bx, by, h * 9);
      T(g, 'rgba(20,20,10,.35)', .5, 1, 1.4, 14, 18); T(g, 'rgba(20,20,10,.35)', .5, 1.5, .4, 15, 16.5); marcheur(g, 3, t * 2, false);
      troupe(12, (x, y, a) => { figK(sc, g, x + .02, y + .02, a); for (const [cx, cy] of [[-1, -.6], [-1, .6], [.4, -.7], [.4, .7], [-.3, 0]]) C(g, '#ece6d6', cx, cy, .9); C(g, '#2c2a28', 1.9, 0, .6); });
    } else if (tt === TT.MARAIS && h < .3) troupe(3, (x, y, a) => { figK(sc, g, x, y, a); E(g, '#d9dcd8', 0, 0, 1.3, .55); T(g, '#c9ccc8', .35, 1.2, 0, 2.6, 0); });
    else if (tt === TT.VIGNE && h < .12 && (AMB.saison === 'printemps' || AMB.saison === 'ete')) troupe(4, (x, y, a, m) => { figK(sc, g, x, y, Math.PI / 2); marcheur(g, m, 0, false); });
  }
  vieDesPays(sc, g, x0, y0, x1, y1, dans);
}
// la colonne de route d'une armée : avant-garde de cavalerie, état-major, bataillons par quatre avec tambours et
// drapeau, artillerie attelée, caissons, bagages, arrière-garde ; chacun suit la route derrière la tête
function compoArmee(side) {
  const c = [];
  for (let r = 0; r < 4; r++) c.push({ k: 'cav', r, gap: 1.4 });
  c.push({ k: 'etat', gap: 3 });
  for (let b = 0; b < 4; b++) { c.push({ k: 'off', gap: 3.5 }); c.push({ k: 'tambours', gap: 1.4 }); for (let r = 0; r < 24; r++) c.push({ k: 'rang', r, b, gap: 1.15, drapeau: r === 8 }); }
  for (let p = 0; p < 3; p++) { c.push({ k: 'piece', gap: p ? 6 : 4 }); c.push({ k: 'servants', gap: 2 }); }
  for (let w = 0; w < 3; w++) c.push({ k: 'caisson', gap: 5 });
  for (let w = 0; w < 3; w++) c.push({ k: 'bagage', gap: 5, w });
  for (let r = 0; r < 3; r++) c.push({ k: 'cav', r, gap: 1.4 });
  let d = 0; for (const e of c) { d += e.gap * 5 * U; e.d = d; }
  return { liste: c, long: d, Linf: tenue(side, 'ligne'), Lcav: tenue(side, side === 'fr' ? 'cavalerie' : 'cavalerie'), Lart: tenue(side, 'artillerie'), Lgen: tenue(side, 'general'), Lgren: tenue(side, 'grenadiers') };
}
function colonne(sc, g, a, x0, y0, x1, y1) {
  const t = sc.time, C2 = a.compo;
  for (const e of C2.liste) {
    const s = a.s - e.d; if (s < 0 || s > a.L) continue;
    const p = surChemin(a.pts, s); if (p.x < x0 - .1 || p.x > x1 + .1 || p.y < y0 - .1 || p.y > y1 + .1) continue;
    const nx = -Math.sin(p.a), ny = Math.cos(p.a), pas = t * 1.7 * TAU, at = (o, f) => { figK(sc, g, p.x + nx * o * U, p.y + ny * o * U, p.a); f(); };
    switch (e.k) {
      case 'cav': for (const o of [-3.5, 3.5]) at(o, () => { cheval(g, C2.Lcav.chevaux[(e.r + (o > 0)) % 5], { gait: pas * 1.2 + o, bob: 0 }); cavalier(g, C2.Lcav, { habit: C2.Lcav.habit }, { sabre: 0, bob: 0 }); }); break;
      case 'etat': at(0, () => { cheval(g, C2.Lgen.chevaux[0], { gait: pas, bob: 0 }); cavalier(g, C2.Lgen, { gen: true }, { sabre: 0, bob: 0 }); }); at(-8, () => { cheval(g, '#6b4a2c', { gait: pas + 1, bob: 0 }); cavalier(g, C2.Lgen, { fanion: true }, { sabre: 0, bob: 0 }); }); sc.monde(g); g.save(); g.translate(p.x - nx * 8 * U, p.y - ny * 8 * U); g.scale(U, U); drapeau(g, C2.Linf, 0, 0, t, 2, true); g.restore(); break;
      case 'off': at(4.5, () => { cheval(g, '#8b6a47', { gait: pas, bob: 0 }); cavalier(g, C2.Linf, { officier: true }, { sabre: 0, bob: 0 }); }); break;
      case 'tambours': for (const o of [-6, -2, 2, 6]) at(o, () => fantassin(g, C2.Linf, { role: 'tambour' }, { legs: pas + o, arme: 'tambour' })); break;
      case 'rang': {
        const L2 = e.b === 0 ? C2.Lgren : C2.Linf;
        for (const o of [-6, -2, 2, 6]) at(o, () => fantassin(g, L2, { role: e.drapeau && o === 2 ? 'drapeau' : 'h' }, { legs: pas + e.r * .35, arme: e.drapeau && o === 2 ? 'aucun' : 'epaule' }));
        if (e.drapeau) { sc.monde(g); g.save(); g.translate(p.x + nx * 2 * U, p.y + ny * 2 * U); g.scale(U, U); drapeau(g, L2, 0, 0, t, e.b, false); g.restore(); }
        break;
      }
      case 'piece': at(0, () => { g.save(); g.translate(18, 0); for (const y of [-2.7, 2.7]) { g.save(); g.translate(0, y); cheval(g, '#6b4a2c', { gait: pas, bob: 0 }); g.restore(); g.save(); g.translate(-11, y); cheval(g, '#54402e', { gait: pas + 1, bob: 0 }); g.restore(); } g.restore(); g.save(); g.translate(-3, 0); avant(g, C2.Lart); g.restore(); g.save(); g.translate(-13, 0); g.rotate(Math.PI); piece(g, C2.Lart, { recul: 0 }); g.restore(); }); break;
      case 'servants': for (const o of [-6.5, 6.5]) at(o, () => fantassin(g, C2.Lart, { role: 'h' }, { legs: pas + o, arme: 'aucun' })); break;
      case 'caisson': at(0, () => { g.save(); g.translate(17, 0); for (const y of [-2.7, 2.7]) { g.save(); g.translate(0, y); cheval(g, '#6b4a2c', { gait: pas, bob: 0 }); g.restore(); } g.restore(); caisson(g, { caisse: C2.Lart.caisse, bache: '#ece4cb' }); }); break;
      case 'bagage': at(0, () => charrette(g, pas, false, e.w)); at(-7, () => marcheur(g, e.w + 2, pas, true)); break;
    }
  }
}
const BATEAUX = [];
for (const r of GEO.rivers) if (r.rank <= 2) { const L = longueur(r.pts); for (let k = 0; k < Math.ceil(L / 14); k++) BATEAUX.push({ pts: r.pts, L, s0: hash2(k, r.rank, 5) * L, v: (hash2(k, 7, 5) < .5 ? -1 : 1) * .02, mer: false }); }
for (const w of GEO.ways) if (w.sea) { const L = longueur(w.pts); for (let k = 0; k < Math.ceil(L / 25); k++) BATEAUX.push({ pts: w.pts, L, s0: hash2(k, 9, 6) * L, v: (hash2(k, 8, 6) < .5 ? -1 : 1) * .04, mer: true }); }
const ARMEES = [];
{
  const route = (a, b) => GEO.edges.find(e => (NOEUD.get(e.a)?.name === a && NOEUD.get(e.b)?.name === b) || (NOEUD.get(e.a)?.name === b && NOEUD.get(e.b)?.name === a));
  for (const [etapes, c, drap, side, part] of [[['Bordeaux', 'Libourne'], '#2f4f9c', 'tri', 'fr', 0], [['Mézin', 'Nérac', 'Agen'], '#b8352c', 'croix', 'co', .62], [['Dax', 'Bayonne'], '#2f4f9c', 'tri', 'fr', .35]]) {
    const pts = [];
    for (let i = 1; i < etapes.length; i++) { const a = etapes[i - 1], e = route(a, etapes[i]); if (!e) continue; pts.push(...(NOEUD.get(e.a)?.name === a ? e.pts : e.pts.slice().reverse())); }
    if (pts.length < 2) continue;
    const compo = compoArmee(side), L = longueur(pts);
    ARMEES.push({ pts, L, s: Math.max(compo.long + .3, L * part), v: .012, c, drap, compo, side, nom: side === 'fr' ? 'Armée de ' + etapes[0] : 'Armée coalisée' });
  }
}
// l'armée suivie par la caméra : la tête de colonne, à jour à chaque image
const suivreArmee = a => ({ get x() { return surChemin(a.pts, clamp(a.s - a.compo.long * .3, 0, a.L)).x; }, get y() { return surChemin(a.pts, clamp(a.s - a.compo.long * .3, 0, a.L)).y; } });
CARTE.avant = (sc, dt = 0) => { camAnim(sc); if (!bivouac()) for (const a of ARMEES) { a.s += a.v * dt; if (a.s > a.L + a.compo.long) a.s = a.compo.long + .3; } };
CARTE.apres = (sc, g) => {
  g.setTransform(sc.d, 0, 0, sc.d, 0, 0); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const n of GEO.nodes) {
    const rang = n.type === 'capitale' ? 3 : n.type === 'ville' || n.type === 'fort' ? 2 : 1;
    if ((rang === 1 && sc.z < 9) || (rang === 2 && sc.z < 3.2)) continue;
    const x = (n.x - sc.cx) * sc.z + sc.cssW / 2, y = (n.y - sc.cy) * sc.z + sc.cssH / 2 + (sc.z >= 18 ? -Math.min(profilVille(n, ANNEE).R * 1.1 / S * sc.z, 120) - 4 : 14 + rang * 2);
    if (x < -80 || x > sc.cssW + 80 || y < -20 || y > sc.cssH + 20) continue;
    g.font = `${rang === 3 ? 700 : 600} ${rang === 3 ? 17 : rang === 2 ? 14 : 12}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(250,246,232,.85)'; g.strokeText(n.name, x, y); g.fillStyle = n === choisie ? '#8a5a00' : '#2c2418'; g.fillText(n.name, x, y);
  }
};
CARTE.tap = (x, y) => {
  let best = null, bd = 1e9;
  for (const n of GEO.nodes) { const d = Math.hypot(n.x - x, n.y - y) * CARTE.z; if (d < bd) { bd = d; best = n; } }
  if (best && bd < 30) ouvrirFiche(best); else fermerFiche();
};
brancher(CARTE, GW, GH, 'm', [
  ['Bordeaux', 101.33, 104.54, 22], ['Bassin d’Arcachon', 70, 128, 6], ['Pays basque', 40, 268, 5], ['Périgord noir', 230, 105, 5], ['Agenais', 175, 175, 5], ['Béarn', 115, 280, 4.5], ['Mon armée sur la route', () => suivreArmee(ARMEES[0]), 0, 260], ['Bêtes et passants', 96, 110, 200], ['Toute l’Aquitaine', GW / 2, GH / 2, 1],
], sc => { sc.z = Math.max(sc.zB()[0], sc.cssW / 140); sc.cx = 120; sc.cy = 130; });

// ---------- fiche d'une ville, et l'intérieur
const fiche = document.getElementById('fiche');
function ouvrirFiche(n) {
  choisie = n; const Pf = profilVille(n, ANNEE);
  document.getElementById('f-nom').textContent = n.name;
  document.getElementById('f-sous').textContent = `${TYPE_TXT[n.type] || n.type} · ${NOMS_DEPT[n.dept] || n.dept} · ${(n.pop0 || 0).toLocaleString('fr-FR')} habitants`;
  document.getElementById('f-tags').innerHTML = [...(n.spec || []).map(s => ({ port: 'Port', vin: 'Vignoble', bois: 'Bois', fer: 'Forges', ble: 'Blé', sel: 'Sel', tabac: 'Tabac' }[s] || s)), n.fort >= 3 ? 'Place bastionnée' : n.fort >= 1 ? 'Murs' : null, n.star ? n.star[1] : null].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
  fiche.hidden = false;
}
function fermerFiche() { fiche.hidden = true; choisie = null; }
document.getElementById('f-fermer').onclick = fermerFiche;
const icv = document.getElementById('interieur');
const IS = new Scene(icv, {
  max: 500, vie: [], zMax: 4.5,
  sol(sc, g) { const t = sc.tv; if (!t) return; const m = sc.m, k = t.k; g.fillStyle = HERBE; g.fillRect(0, 0, sc.W, sc.H); g.drawImage(t.c, (sc.cx - sc.W / 2 / m) * k, (sc.cy - sc.H / 2 / m) * k, sc.W / m * k, sc.H / m * k, 0, 0, sc.W, sc.H); },
});
function montrerVille(n) {
  const Pf = profilVille(n, ANNEE), V = genererInterieur(Pf);
  IS.V = V; IS.tv = peindreInterieur(V, KT); IS.fx = [];
  // la vie : passants dans les rues, charrettes sur les routes, bateaux, fumées, bêtes aux prés
  const R = alea(Pf.sd + 3), vie = [];
  const rues = V.rues.filter(r => r.pts.length > 1), LCIV = tenue('fr', 'civil');
  for (let i = 0; i < clamp(Pf.pop / 90, 14, 90); i++) { const r = rues[R() * rues.length | 0]; if (!r) break; const L = longueur(r.pts); vie.push({ k: 'passant', pts: r.pts, L, s: R() * L, v: (R() < .5 ? -1 : 1) * (1.4 + R()), lat: (R() - .5) * 3, L2: Object.assign({}, LCIV, { tete: R() < .5 ? 'coiffe' : 'rond' }), habit: ['#7a6a4f', '#5d6b86', '#8a5a44', '#6e5c45', '#4f5a6a', '#9a4a3a'][R() * 6 | 0], x: 0, y: 0, a: 0, pas: R() }); }
  for (const r of V.routesL) for (let i = 0; i < 2; i++) vie.push({ k: 'charrette', pts: r.pts, L: longueur(r.pts), s: 40 + R() * 500, v: (R() < .5 ? -1 : 1) * 5, lat: 2.6, x: 0, y: 0, a: 0, pas: 0, c: ['#2f4a3a', '#5a3d24', '#3a2c22'][R() * 3 | 0] });
  for (const rv of Pf.rivs) { const L = longueur(rv.pts); for (let i = 0; i < (Pf.port ? 6 : 2); i++) vie.push({ k: 'bateau', pts: rv.pts, L, s: R() * L, v: (R() < .5 ? -1 : 1) * (2 + R() * 2), lat: (R() - .5) * rv.w * .5, grand: Pf.port && rv.rank <= 1 && R() < .5, x: 0, y: 0, a: 0 }); }
  if (Pf.mer && Pf.port) for (let i = 0; i < 6; i++) { const a = Pf.mer.a + (R() - .5) * .8, d = Pf.R * (1.1 + R() * .8); vie.push({ k: 'mouille', x: IC[0] + Math.cos(a) * d, y: IC[1] + Math.sin(a) * d, a: R() * TAU, grand: R() < .4 }); }
  if (V.lieux.place && V.placeCentre) for (let i = 0; i < 24; i++) vie.push({ k: 'badaud', x0: IC[0], y0: IC[1], x: IC[0] + (R() - .5) * 30, y: IC[1] + (R() - .5) * 30, a: R() * TAU, c: ['#5d6b86', '#7a4a3a', '#f2efe6', '#6e5c45', '#8a5a44', '#2f4f9c'][R() * 6 | 0] });
  for (let i = 0; i < 8; i++) { const a = R() * TAU, d = Pf.R + 90 + R() * 200, x = IC[0] + Math.cos(a) * d, y = IC[1] + Math.sin(a) * d; if (!V.eau(x, y)) vie.push({ k: 'vache', x, y, a: R() * TAU, zone: [x - 30, y - 20, 60, 40], attente: R() * 4, v: 0, robe: R() < .5 ? '#efe9dd' : '#c9a07a', tache: R() < .5 ? '#3a2c22' : '#8a5a3a', pas: 0 }); }
  IS.vie = vie; IS.fumees = V.cheminees.filter((c, i) => i % 7 === 0); IS.moulins = V.plus.filter(p => p.ailes);
  IS.z = Math.max(IS.zB ? IS.zB()[0] : 1, Math.min(4, IS.cssW / (Pf.R * 2.7))); IS.cx = IC[0]; IS.cy = IC[1]; IS.borner?.();
  document.getElementById('i-nom').textContent = n.name; document.getElementById('i-sous').textContent = `${TYPE_TXT[n.type] || n.type} · ${NOMS_DEPT[n.dept] || n.dept} · ${ANNEE}`;
  // ce que le générateur a lu
  const pts = [
    ['Plan', MODELES[Pf.modele]],
    ['Site', [Pf.rivs.length ? 'sur ' + Pf.rivs.map(r => r.name).join(' et ') : null, Pf.mer ? 'au bord de l’eau (côte, étang ou estuaire)' : null, Pf.relief > .4 ? 'sur un relief marqué' : null].filter(Boolean).join(', ') || 'en plaine'],
    ['Routes', Pf.routes.length ? Pf.routes.map(r => (r.royal ? 'route royale' : 'chemin') + (r.vers ? ' vers ' + r.vers : '')).join(' ; ') : 'aucune'],
    ['Style', STYLE_TXT[Pf.style]],
    ['Taille', `${Pf.pop.toLocaleString('fr-FR')} habitants : ${V.ilots.length} îlots`],
    ['Défenses', { medieval: 'mur et tours rondes', bastions: 'enceinte bastionnée, fossé, demi-lunes', cours: 'murs abattus, remplacés par des cours plantés (après 1860)' }[Pf.murs] || 'aucune' + (Pf.citadelle ? ', citadelle' : '')],
    ['Métiers', [Pf.port ? 'quais et navires' : null, Pf.spec.includes('vin') ? 'châteaux viticoles et chais' : null, Pf.spec.includes('bois') ? 'scierie et grumes' : null, Pf.spec.includes('fer') ? 'forges' : null, Pf.spec.includes('sel') ? 'salines' : null, Pf.spec.includes('tabac') ? 'séchoirs à tabac' : null, Pf.spec.includes('ble') ? 'moulins' : null, V.gare ? 'gare (après 1860)' : null].filter(Boolean).join(', ') || 'fermes alentour'],
  ];
  document.getElementById('lecture-ville').innerHTML = pts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  IS.majVisites?.();
}
IS.avant = (sc, dt = 0) => {
  camAnim(sc);
  for (const e of sc.vie) {
    if (e.pts) { e.s = mod(e.s + e.v * dt, e.L); const p = surChemin(e.pts, e.s), a = p.a + (e.v < 0 ? Math.PI : 0); e.x = p.x - Math.sin(a) * e.lat; e.y = p.y + Math.cos(a) * e.lat; e.a = a; e.pas = (e.pas || 0) + dt * 1.6; }
    else if (e.k === 'badaud') { if (!e.tx || Math.random() < dt * .3) { e.tx = e.x0 + (Math.random() - .5) * 36; e.ty = e.y0 + (Math.random() - .5) * 36; } const d = Math.hypot(e.tx - e.x, e.ty - e.y); if (d > .3) { e.a = Math.atan2(e.ty - e.y, e.tx - e.x); e.x += Math.cos(e.a) * Math.min(d, 2 * dt); e.y += Math.sin(e.a) * Math.min(d, 2 * dt); } }
    else if (e.k === 'vache') { if (e.attente > 0) { e.attente -= dt; e.v = 0; } else { if (!e.but || Math.hypot(e.but[0] - e.x, e.but[1] - e.y) < 2) { e.but = [e.zone[0] + Math.random() * e.zone[2], e.zone[1] + Math.random() * e.zone[3]]; e.attente = 2 + Math.random() * 6; } e.a = angLerp(e.a, Math.atan2(e.but[1] - e.y, e.but[0] - e.x), dt * 2); e.v = 1.5; e.x += Math.cos(e.a) * e.v * dt; e.y += Math.sin(e.a) * e.v * dt; } }
  }
  for (const [x, y] of sc.fumees || []) if (Math.random() < dt * .25) fumee(sc, x, y, 0, 0, .6, 4.5, 4, .28);
};
IS.sous = (sc, g) => {
  for (const e of sc.vie) {
    if (Math.abs(e.x - sc.cx) > sc.W / 2 / sc.m + 30 || Math.abs(e.y - sc.cy) > sc.H / 2 / sc.m + 30) continue;
    sc.fig(g, e.x, e.y, e.a); g.lineCap = 'round';
    if (e.k === 'passant') fantassin(g, e.L2, { role: 'h', habit: e.habit }, { legs: e.pas * TAU, arme: 'aucun' });
    else if (e.k === 'badaud') { C(g, e.c, 0, 0, .9); C(g, '#2a2420', .25, 0, .45); }
    else if (e.k === 'charrette') { cheval(g, '#6b4a2c', { gait: e.pas * TAU, bob: 0 }); g.save(); g.translate(-9, 0); RR(g, '#3a2a1b', -3, -3.6, 6, 1, .4); RR(g, '#3a2a1b', -3, 2.6, 6, 1, .4); RR(g, '#8a6a45', -4, -2.6, 8, 5.2, .6); RR(g, '#b8a27a', -3.4, -2, 3.4, 4, .4); g.restore(); }
    else if (e.k === 'bateau' || e.k === 'mouille') { g.setTransform(1, 0, 0, 1, 0, 0); sc.monde(g); navire(g, e.x, e.y, e.a, e.grand); }
    else if (e.k === 'vache') { E(g, e.robe, 0, 0, 4.3, 1.9); E(g, e.tache, -1.2, .5, 1.4, .9, .4); E(g, sombre(e.robe, .08), 4.6, 0, 1.4, .95); }
  }
};
// moulin vu d'en haut : les ailes tournent dans un plan vertical face au vent, on les voit donc de profil (une barre
// fine dont la longueur bat entre 0,71 L et L) ; c'est leur ombre au sol, une croix de biais, qui montre qu'elles tournent
function moulinVu(g, x, y, t, wa = .35, L = 17, H = 12) {
  const dx = Math.cos(wa), dy = Math.sin(wa), px = -dy, py = dx, sx = .34, sy = .45;
  const hx0 = x - dx * 4.5, hy0 = y - dy * 4.5;   // le moyeu, du côté du vent
  const bras = [0, 1, 2, 3].map(k => t * .9 + k * Math.PI / 2);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(20,20,10,.34)'; g.lineWidth = 3.2; g.beginPath();
  for (const a of bras) { const u = L * Math.cos(a), h = H + L * Math.sin(a); g.moveTo(hx0 + sx * H, hy0 + sy * H); g.lineTo(hx0 + px * u + sx * h, hy0 + py * u + sy * h); }
  g.stroke();
  T(g, '#5b4127', 1, x, y, x + dx * 13, y + dy * 13);   // la queue, sous le vent
  C(g, OMBRE, x + 3, y + 4, 7.5); C(g, '#d8cdb5', x, y, 7); coneF(g, x, y, 5.4, PAL.ardoise, 0);
  const us = bras.map(a => L * Math.cos(a)), u0 = Math.min(...us), u1 = Math.max(...us);
  T(g, '#4a3a28', 1.6, hx0 + px * u0, hy0 + py * u0, hx0 + px * u1, hy0 + py * u1);
  T(g, '#e8e0cc', .9, hx0 + px * u0, hy0 + py * u0, hx0 + px * u1, hy0 + py * u1);
  C(g, '#3a2a1b', hx0, hy0, 1.3);
}
IS.dessus = (sc, g) => { sc.monde(g); for (const p of sc.moulins || []) moulinVu(g, p.x, p.y, sc.time + p.x); };
brancher(IS, IW, IH, 'i', [
  ['La grand-place', () => IS.V?.lieux.place, 0, 3.2], ['L’église', () => IS.V?.lieux.eglise || IS.V?.lieux.cathedrale, 0, 3.4], ['Le port', () => IS.V?.lieux.port, 0, 2.6], ['Les remparts', () => IS.V?.lieux.remparts || (IS.V?.trace ? { x: IS.V.trace.V[0][0], y: IS.V.trace.V[0][1] } : null), 0, 2.6],
  ['La citadelle', () => IS.V?.lieux.citadelle, 0, 2.6], ['Le château', () => IS.V?.lieux.chateau, 0, 3.4], ['Les vignes', () => IS.V?.lieux.vin, 0, 2.4], ['La gare', () => IS.V?.lieux.gare, 0, 2.6], ['Les salines', () => IS.V?.lieux.sel, 0, 3], ['Les forges', () => IS.V?.lieux.fer, 0, 3],
], sc => { sc.z = Math.max(sc.zB()[0], sc.cssW / 640); sc.cx = IC[0]; sc.cy = IC[1]; });
const modes = { carte: document.getElementById('mode-carte'), ville: document.getElementById('mode-ville') };
function voir(mode) { modes.carte.hidden = mode !== 'carte'; modes.ville.hidden = mode !== 'ville'; requestAnimationFrame(() => { (mode === 'carte' ? CARTE : IS).resize(); }); }
document.getElementById('f-voir').onclick = () => { if (choisie) { montrerVille(choisie); voir('ville'); } };
document.getElementById('i-retour').onclick = () => voir('carte');
const EXEMPLES = ['Bordeaux', 'Bayonne', 'Blaye', 'Libourne', 'Sarlat', 'Saint-Émilion', 'Navarrenx', 'Fort Médoc', 'Beynac', 'La Teste-de-Buch', 'Salies-de-Béarn', 'Pau', 'Mimizan', 'Brantôme', 'Agen', 'Dax'];
{
  const zone = document.getElementById('exemples');
  for (const nom of EXEMPLES) { const n = GEO.nodes.find(x => x.name === nom); if (!n) continue; const b = document.createElement('button'); b.className = 'puce'; b.textContent = nom; b.onclick = () => { choisie = n; montrerVille(n); voir('ville'); document.getElementById('jeu-carte').scrollIntoView({ behavior: 'smooth', block: 'start' }); }; zone.appendChild(b); }
  const hasard = document.createElement('button'); hasard.className = 'puce'; hasard.textContent = 'Un village au hasard'; let k = 0;
  hasard.onclick = () => { const vs = GEO.nodes.filter(x => x.type === 'village'); const n = vs[(hashS('h' + (k++)) % vs.length)]; choisie = n; montrerVille(n); voir('ville'); document.getElementById('jeu-carte').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  zone.appendChild(hasard);
  for (const a of [1700, 1789, 1860]) { const b = document.getElementById('an-' + a); b.onclick = () => { ANNEE = a; PLANS.clear(); for (const x of [1700, 1789, 1860]) document.getElementById('an-' + x).setAttribute('aria-pressed', x === a ? 'true' : 'false'); if (!modes.ville.hidden && choisie) montrerVille(choisie); }; }
}
montrerVille(GEO.nodes.find(x => x.name === 'Bordeaux'));
voir('carte');
// ---------- boucle
let tPrec = performance.now();
const toutes = [CARTE, IS];
const ro = new ResizeObserver(() => toutes.forEach(s => { if (s.cv.offsetParent) { s.resize(); s.avant(s, 0); } })); ro.observe(mcv); ro.observe(icv);
function boucle(now) {
  const dt = Math.min(.05, (now - tPrec) / 1000); tPrec = now;
  for (const s of toutes) if (s.cv.offsetParent) { s.step(dt); s.draw(); }
  requestAnimationFrame(boucle);
}
requestAnimationFrame(boucle);
