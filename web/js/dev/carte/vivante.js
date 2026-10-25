// ---------- la carte vivante : saisons, heures, temps, métiers des pays, guerre, bêtes et oiseaux
// tout est tiré de la carte elle-même (même endroit, mêmes gens d'une image à l'autre) ; AMB est réglé par les boutons
sprite('fen', '255,214,140'); sprite('pluie', '64,74,88');
const lerpRGB = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const pingpong = (s, L) => { const m = mod(s, 2 * L); return m < L ? m : 2 * L - m; };
const versMonde = (x, y, a, lx, ly, s = 1) => [x + (lx * Math.cos(a) - ly * Math.sin(a)) * U * s, y + (lx * Math.sin(a) + ly * Math.cos(a)) * U * s];
function cheminEntre(pts, s0, s1) {
  const out = []; let acc = 0; if (s1 <= s0) return out;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay), a = acc; acc += l;
    if (!l || acc < s0) continue; if (a > s1) break;
    const k0 = clamp((s0 - a) / l, 0, 1), k1 = clamp((s1 - a) / l, 0, 1);
    if (!out.length) out.push([lerp(ax, bx, k0), lerp(ay, by, k0)]);
    out.push([lerp(ax, bx, k1), lerp(ay, by, k1)]);
  }
  return out;
}
function dansAnneau(r, x, y) { let d = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; } return d; }
const distBB = (b, p) => Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[2]), Math.max(b[1] - p.y, 0, p.y - b[3]));
// les lumières de l'image (feux, lanternes, éclairs), remplies pendant le dessin et allumées après la nuit
const LUM = [], ECLAIRS = [];

// ---------- les saisons
const TEINTE_S = { printemps: [[100, 150, 64], .22], ete: [[198, 178, 104], .2], automne: [[150, 116, 68], .22], hiver: [[134, 130, 112], .34] };
const VEGET = new Set([TT.PLAINE, TT.COLLINES, TT.VIGNE, TT.MARAIS, TT.LANDE, TT.MONTAGNE]);
const FEUILLUS_S = { printemps: [[86, 142, 62], .25], automne: [[130, 110, 52], .35], hiver: [[106, 96, 80], .55] };
function saisonner(c, t, x, y) {
  // l'hiver, haute montagne et montagne prennent la même base : la neige seule les distingue (sinon le liseré du terrain hachure la limite)
  let r = AMB.saison === 'hiver' && t === TT.HAUTE ? COUL_RGB[TT.MONTAGNE] : c;
  if (VEGET.has(t)) { const [cible, k] = TEINTE_S[AMB.saison]; r = lerpRGB(r, cible, k); }
  else if (t === TT.FORET && !pinede(x, y) && FEUILLUS_S[AMB.saison]) { const [cible, k] = FEUILLUS_S[AMB.saison]; r = lerpRGB(r, cible, k); }
  const n = t > 1 ? neige(x, y) * (t === TT.FORET && alt(x, y) < .3 ? .45 : 1) : 0;   // sous les bois de plaine, moins de neige
  if (n > 0) r = lerpRGB(r, [236, 239, 239], n * .78 * 1);
  return r;
}
// la neige : sur les sommets toute l'année ou presque, sur les Pyrénées l'hiver, partout quand il a neigé
function neige(x, y) {
  const a = alt(x, y), seuil = { printemps: 1.05, ete: 1.35, automne: 1.15, hiver: .7 }[AMB.saison];
  let n = clamp((a - seuil) / .3 + .3 * Math.sin(x * .21 + y * .13) + .2 * Math.sin(x * .11 - y * .29), 0, 1);   // la limite suit le relief, à peine ondulée
  if (AMB.temps === 'neige' && AMB.saison === 'hiver') n = Math.max(n, clamp(.85 + (bruitC(x * .35, y * .35, 5.1) - .5) * 1.1, 0, 1));
  return n;
}
const BOIS_S = { printemps: ['#4f8a3a', '#5e9a44', '#6aa64c', '#47803a', '#73ad55'], ete: BOIS, automne: ['#6f7a3a', '#8a7a34', '#5f6e32', '#7a6a3a', '#4f6a2c', '#7f6a30'], hiver: ['#8a7d6c', '#7f7262', '#948674', '#76695a', '#6a7058'] };
const boisSaison = h => { const P = BOIS_S[AMB.saison]; return P[(h * P.length) | 0]; };
Object.assign(SOLS, {
  ble_vert: { nom: 'Blé en herbe', base: '#79a94f', raie: '#6a9a44', pas: 4, ep: 1.6 },
  colza_fleur: { nom: 'Colza en fleur', base: '#cdbf4e', raie: '#bba940', pas: 4, ep: 1.6 },
  labour_frais: { nom: 'Labour frais', base: '#8c6c4c', raie: '#7a5c3f', pas: 5, ep: 2.4 },
  moisson: { nom: 'Blé moissonné', base: '#d6c182', raie: '#c3ab68', pas: 5, ep: 1.8 },
  pre_sec: { nom: 'Pré fauché', base: '#a3a865', raie: '#959a58', pas: 8, ep: 3 },
  labour_hiver: { nom: 'Labour d’hiver', base: '#8a7560', raie: '#79654f', pas: 5, ep: 2.4 },
  ble_hiver: { nom: 'Blé d’hiver levé', base: '#8a9a62', raie: '#7c8c56', pas: 4, ep: 1.6 },
  pre_hiver: { nom: 'Pré d’hiver', base: '#7f9460', raie: '#748956', pas: 8, ep: 3 },
  neige: { nom: 'Neige', base: '#e9ecea', raie: '#d5dad8', pas: 5, ep: 1.6 },
});
const SOL_SAISON = {
  printemps: { chaume: 'ble_vert', ble: 'ble_vert', colza: ['colza_fleur', 'ble_vert', 'pre'] },
  ete: { chaume: 'moisson', colza: 'chaume', labour: 'chaume', pre: 'pre_sec' },
  automne: { ble: ['labour_frais', 'chaume', 'ble_hiver'], colza: 'ble_hiver', labour: ['labour_frais', 'chaume'] },   // on laboure, on sème le blé d'hiver
  hiver: { chaume: ['labour_hiver', 'ble_hiver'], labour: ['labour_hiver', 'ble_hiver'], ble: 'ble_hiver', colza: 'ble_hiver', pre: 'pre_hiver', friche: 'pre_hiver' },
};
function solSaison(sol, x, y, hh) {
  if (neige(x, y) > .4) return 'neige';
  if (disette(x, y) && hh < .75) return 'friche';
  const s = SOL_SAISON[AMB.saison][sol] || sol;
  return Array.isArray(s) ? s[(hh * 7919 % 1) * s.length | 0] : s;
}
// les moyettes : les gerbes dressées en tas sur le chaume, en rangs
function gerbes(g, W, H, dir, R) {
  const hz = dir === 'h';
  for (let a = 6; a < (hz ? H : W) - 4; a += 9) for (let b = 5; b < (hz ? W : H) - 4; b += 7 + R() * 3) {
    const x = hz ? b : a, y = hz ? a : b;
    C(g, 'rgba(60,45,20,.3)', x + .9, y + 1.2, 1.5); C(g, '#e3cd84', x, y, 1.5); C(g, '#c9ad5c', x + .3, y + .3, .7);
  }
}
// le Périgord en disette : on lit le département de chaque kilomètre (mis en cache)
const DEPT_ID = Object.keys(GEO.depts), DEPT_CASE = new Int8Array(GW * GH).fill(-2);
function deptDe(x, y) {
  const i = clamp(x | 0, 0, GW - 1), j = clamp(y | 0, 0, GH - 1), k = j * GW + i;
  if (DEPT_CASE[k] === -2) { DEPT_CASE[k] = -1; DEPT_ID.forEach((id, q) => { const d = GEO.depts[id]; if (d.rings.some((r, m) => { const b = d.bbs[m]; return i + .5 >= b[0] && i + .5 <= b[2] && j + .5 >= b[1] && j + .5 <= b[3] && dansAnneau(r, i + .5, j + .5); })) DEPT_CASE[k] = q; }); }
  return DEPT_ID[DEPT_CASE[k]];
}
const disette = (x, y) => AMB.ev.disette && deptDe(x, y) === '24';
// combien de monde reste dehors : moins la nuit, presque personne autour d'un siège ou d'une bataille
function densite(x, y) {
  let d = AMB.heure === 'nuit' ? .15 : AMB.heure === 'soir' ? .6 : 1;
  if (AMB.ev.siege && SIEGE && Math.hypot(x - SIEGE.x, y - SIEGE.y) < SIEGE.r + 4) d = Math.min(d, .06);
  if (AMB.ev.bataille && BATAILLE && AMB.heure !== 'nuit' && Math.hypot(x - BATAILLE.x, y - BATAILLE.y) < 5) d = Math.min(d, .1);
  if (disette(x, y)) d = Math.min(d, .3);
  const en = ennemi(); if (en && Math.hypot(x - en.head.x, y - en.head.y) < 12) d = Math.min(d, .35);
  return d;
}

// ---------- les lieux de la vie : marais salants, relais, ports de pêche, sentiers, rivières à bois flotté
const BASSIN = GEO.waters.find(w => w.name === "Bassin d'Arcachon"), ESTUAIRE = GEO.waters.find(w => w.name === 'Estuaire de la Gironde');
const fermer = r => [...r, r[0]];
const SALINE = new Set();
for (let j = 0; j < GH; j++) for (let i = 0; i < 110; i++) {
  if (TER[j * GW + i] !== TT.MARAIS || hash2(i, j, 91) > .6) continue;
  let sale = false;
  for (let dj = -2; dj <= 2 && !sale; dj++) for (let di = -2; di <= 2 && !sale; di++) {
    const x = i + di + .5, y = j + dj + .5, t = ter(x, y);
    sale = t === TT.OCEAN || (t === TT.EAU && ((ESTUAIRE && dansAnneau(ESTUAIRE.ring, x, y)) || (BASSIN && dansAnneau(BASSIN.ring, x, y))));
  }
  if (sale) SALINE.add(j * GW + i);
}
function decorTuile(g, L, x0, y0, x1, y1) {
  if (L < 32) return;
  const s = AMB.saison, bw = .1, bh = .065, gap = .018;
  for (let j = Math.floor(y0) - 1; j <= y1; j++) for (let i = Math.floor(x0) - 1; i <= x1; i++) {
    if (!SALINE.has(j * GW + i)) continue;
    // les bassins du marais salant, entre leurs levées d'argile ; l'été le sel blanchit les œillets et monte en mulons
    for (let v = j + .08; v + bh < j + .92; v += bh + gap) for (let u = i + .08; u + bw < i + .92; u += bw + gap) {
      if (terOnde(u + bw / 2, v + bh / 2) !== TT.MARAIS) continue;
      const h = hash2(u * 97 | 0, v * 89 | 0, 93), sel = s === 'ete' || s === 'automne';
      g.fillStyle = '#9d916f'; g.fillRect(u - gap / 2, v - gap / 2, bw + gap, bh + gap);
      g.fillStyle = s === 'hiver' ? '#5f8496' : sel && h < .45 ? '#dfe6e3' : h < .7 ? '#a9c2c6' : '#8fb0bb'; g.fillRect(u, v, bw, bh);
      if (sel && h < .3) { C(g, 'rgba(30,30,20,.3)', u + bw * .8 + .006, v + bh / 2 + .008, .011); C(g, '#f7f6ef', u + bw * .8, v + bh / 2, .011); }
    }
    if (hash2(i, j, 94) < .5) bat(g, [{ t: 'g', x: -6, y: -3, w: 12, h: 6, p: 'tuile', h2: 1 }], i + .5, j + .95, 0, .006);   // la cabane du saunier
  }
}
// relais de poste : toutes les deux lieues et quelque sur les routes royales, hors des villes
const RELAIS = [];
GEO.edges.forEach(e => {
  if (!e.royal || e.ferry) return;
  const L = longueur(e.pts);
  for (let s = 4.5; s < L - 3; s += 9) { const p = surChemin(e.pts, s); if (!GEO.nodes.some(n => Math.hypot(n.x - p.x, n.y - p.y) < 2.2)) RELAIS.push({ x: p.x, y: p.y, a: p.a, c: hash2(RELAIS.length, 3, 95) < .5 ? 1 : -1 }); }
});
// bois flotté : les trains de bois des Pyrénées et des Landes descendent l'Adour, les gaves, la Midouze, la Leyre
const RADEAUX = [];
for (const r of GEO.rivers) if (['Adour', 'Gave de Pau', "Gave d'Oloron", 'Midouze', 'Leyre', 'Nive', "Gave d'Aspe"].includes(r.name)) { const L = longueur(r.pts); for (let k = 0; k < Math.ceil(L / 16); k++) RADEAUX.push({ pts: r.pts, L, s0: hash2(k, L * 10 | 0, 98) * L, v: .007 }); }
// pêche : pinasses dans le bassin d'Arcachon, chaloupes devant Saint-Jean-de-Luz ; parcs à huîtres ; cabanes tchanquées
const PECHE = [], PARCS = [], TCHANQUEES = [];
if (BASSIN) {
  const R = fermer(BASSIN.ring), [a, b, c, d] = BASSIN.bb;
  for (let k = 0; k < 900; k++) {
    const x = lerp(a, c, hash2(k, 1, 99)), y = lerp(b, d, hash2(k, 2, 99)); if (!dansAnneau(BASSIN.ring, x, y)) continue;
    const dr = distPoly(R, x, y);
    if (dr > .9 && PECHE.length < 10) PECHE.push({ x, y, r: .2 + hash2(k, 3, 99) * .2, ph: k, v: .005, pinasse: true });
    else if (dr > .25 && dr < .8 && PARCS.length < 60 && hash2(k, 4, 99) < .4) PARCS.push([x, y, hash2(k, 5, 99) * .6 - .3]);
    else if (dr > 1.6 && TCHANQUEES.length < 2 && hash2(k, 6, 99) < .2) TCHANQUEES.push([x, y]);
  }
}
{
  const n = GEO.nodes.find(x => x.name === 'Saint-Jean-de-Luz');
  if (n) for (let k = 0, m = 0; k < 200 && m < 5; k++) { const a = Math.PI * .8 + hash2(k, 1, 100) * 1.2, d = 1.5 + hash2(k, 2, 100) * 3.5, x = n.x + Math.cos(a) * d, y = n.y + Math.sin(a) * d; if (eauK(x, y) > .99) { PECHE.push({ x, y, r: .4, ph: k, v: .008, pinasse: false }); m++; } }
}
// carrelets : cabanes sur pilotis et grands filets carrés au bord de l'estuaire
const CARRELETS = [];
if (ESTUAIRE) {
  const R = fermer(ESTUAIRE.ring);
  for (let i = 1; i < R.length; i++) {
    const [ax, ay] = R[i - 1], [bx, by] = R[i], l = Math.hypot(bx - ax, by - ay);
    for (let d = .8; d < l; d += 2.6) {
      const x = ax + (bx - ax) * d / l, y = ay + (by - ay) * d / l; let nx = -(by - ay) / l, ny = (bx - ax) / l;
      if (!dansAnneau(ESTUAIRE.ring, x + nx * .2, y + ny * .2)) { nx = -nx; ny = -ny; }
      CARRELETS.push({ x, y, a: Math.atan2(ny, nx), lev: hash2(i, d * 10 | 0, 100) * 9 });
    }
  }
}
// Cordouan, le phare de l'estuaire, en mer au large de Soulac
const CORDOUAN = (() => { let best = null; for (let dx = -3; dx <= 3; dx += .5) for (let dy = -3; dy <= 3; dy += .5) { const x = 54 + dx, y = 21 + dy; if (eauK(x, y) > .99) { const d = Math.hypot(dx, dy); if (!best || d < best.d) best = { x, y, d }; } } return best; })();
// sentiers de contrebande : des villages basques et béarnais vers l'Espagne, par la montagne
const SENTIERS = ['Sare', 'Saint-Étienne-de-Baïgorry', 'Urdos'].map((nom, q) => {
  const n = GEO.nodes.find(x => x.name === nom); if (!n) return null;
  const pts = [[n.x, n.y]]; let x = n.x, y = n.y;
  for (let k = 0; k < 30 && y < GH - .8; k++) { x += Math.sin(k * .9 + q * 2) * .32; y += .4; pts.push([x, y]); }
  return { n, pts, L: longueur(pts), ph: q * 3.1 };
}).filter(Boolean);
// la transhumance : au printemps les troupeaux montent vers les estives, à l'automne ils descendent
const TRANSHUMANCES = [];
GEO.edges.forEach((e, ie) => {
  const A = NOEUD.get(e.a), B = NOEUD.get(e.b); if (e.ferry || !A || !B || A.dept !== '64' || B.dept !== '64' || TRANSHUMANCES.length >= 10) return;
  const dy = e.pts[e.pts.length - 1][1] - e.pts[0][1], L = longueur(e.pts);
  if (Math.abs(dy) > L * .5 && L > 4) TRANSHUMANCES.push({ ie, e, L, s0: hash2(ie, 1, 101) * L, haut: dy > 0 ? 1 : -1 });
});
const posTrans = (f, t) => { const sens = AMB.saison === 'automne' ? -f.haut : f.haut, p = surChemin(f.e.pts, mod(f.s0 + sens * .0028 * t, f.L)); return { x: p.x, y: p.y, a: p.a + (sens < 0 ? Math.PI : 0) }; };
// marchés et foires
const MARCHES = GEO.nodes.filter(n => n.type === 'ville' || n.type === 'capitale' || (n.type === 'village' && hash2(n.id, 3, 71) < .3));
const FOIRES = GEO.nodes.filter(n => ['Bazas', 'Saint-Sever', 'Mont-de-Marsan', "Aire-sur-l'Adour", 'Orthez', 'Sarlat', 'Langon'].includes(n.name));
// les vols d'oiseaux
const VOLS = Array.from({ length: 16 }, (_, k) => ({ k, sorte: ['grues', 'palombes', 'mouettes', 'etourneaux'][k % 4], x: hash2(k, 1, 102) * GW, y: hash2(k, 2, 102) * GH, ph: hash2(k, 3, 102) * 99 }));
const PORTS = ['Bordeaux', 'Bayonne', 'La Teste-de-Buch', 'Saint-Jean-de-Luz', 'Blaye', 'Pauillac'].map(n => GEO.nodes.find(x => x.name === n)).filter(Boolean);
const AVERSES = Array.from({ length: 7 }, (_, k) => ({ x0: hash2(k, 1, 103) * (GW + 120), y0: hash2(k, 2, 103) * GH, r: 7 + hash2(k, 3, 103) * 10 }));
const posAverse = (a, t) => ({ x: mod(a.x0 + t * .12, GW + 120) - 60, y: a.y0 + Math.sin(t * .003 + a.x0) * 8 });
const BRUME = [];
for (const r of GEO.rivers) if (r.rank <= 2) { const L = longueur(r.pts); for (let s = 0; s < L; s += 2.2) { const h = hash2(s * 10 | 0, r.pts.length, 104); if (h < .3) continue; const p = surChemin(r.pts, s), a = h * 40; BRUME.push([p.x + Math.cos(a) * h * 1.5, p.y + Math.sin(a) * h * 1.5, h]); } }

// ---------- la guerre : le siège de Bayonne, la bataille de Tonneins, l'armée ennemie
const SIEGE = (() => {
  const n = GEO.nodes.find(x => x.name === 'Bayonne'); if (!n) return null;
  const Pf = profilVille(n, 1789), r = Pf.R / S * 1.1, aT = (Pf.mer ? Pf.mer.a : Math.PI) + Math.PI;
  const mouille = (x, y) => eauK(x, y) > .4 || GEO.rivers.some(q => q.rank <= 3 && distBB(q.bb, { x, y }) < .3 && distPoly(q.pts, x, y) < .2);
  const arc = (rr, a0, a1) => { const segs = []; let cur = []; for (let a = a0; a <= a1; a += .02) { const x = n.x + Math.cos(a) * rr, y = n.y + Math.sin(a) * rr; if (mouille(x, y)) { if (cur.length > 1) segs.push(cur); cur = []; } else cur.push([x, y]); } if (cur.length > 1) segs.push(cur); return segs; };
  const paralleles = [.55, .9, 1.3].flatMap(d => arc(r + d, aT - 1.25, aT + 1.25));
  const boyaux = [-.8, -.3, .25, .75].map(da => { const pts = []; for (let k = 0; k <= 8; k++) { const rr = r + 1.45 - k * .12, a = aT + da + (k % 2 ? .05 : -.05); pts.push([n.x + Math.cos(a) * rr, n.y + Math.sin(a) * rr]); } return pts; }).filter(p => !p.some(q => mouille(...q)));
  const batteries = [-.9, -.45, 0, .45, .9].map((da, k) => { const a = aT + da, x = n.x + Math.cos(a) * (r + .9), y = n.y + Math.sin(a) * (r + .9); return { x, y, a: a + Math.PI, tir: -k * 1.3 }; }).filter(b => !mouille(b.x, b.y));
  const feux = Array.from({ length: 7 }, (_, k) => { const a = hash2(k, 1, 61) * TAU, d = Math.sqrt(hash2(k, 2, 61)) * r * .7; return [n.x + Math.cos(a) * d, n.y + Math.sin(a) * d]; });
  const camp = []; { const cx = n.x + Math.cos(aT) * (r + 2.3), cy = n.y + Math.sin(aT) * (r + 2.3); for (let q = 0; q < 10; q++) for (let w = 0; w < 6; w++) { const u = (q - 4.5) * .04, v = (w - 2.5) * .04, x = cx - Math.sin(aT) * u + Math.cos(aT) * v, y = cy + Math.cos(aT) * u + Math.sin(aT) * v; if (!mouille(x, y)) camp.push([x, y, q, w]); } }
  return { n, x: n.x, y: n.y, r, aT, paralleles, boyaux, batteries, feux, camp, impacts: [], L: tenue('co', 'artillerie'), Li: tenue('co', 'ligne') };
})();
const BATAILLE = (() => {
  const n = GEO.nodes.find(x => x.name === 'Tonneins'); if (!n) return null;
  let best = null;
  for (let a = 0; a < TAU; a += .3) for (const d of [2.4, 3, 3.6]) {
    const x = n.x + Math.cos(a) * d, y = n.y + Math.sin(a) * d; if (ter(x, y) !== TT.PLAINE) continue;
    const dr = Math.min(...GEO.rivers.filter(r => r.rank <= 2).map(r => distPoly(r.pts, x, y)));
    if (dr > 1.2 && (!best || dr > best.dr)) best = { x, y, dr };
  }
  return best && { x: best.x, y: best.y, a: .35 };
})();
const BAT_UNITES = [];
if (BATAILLE) for (const [side, sg] of [['fr', -1], ['co', 1]]) {
  for (let b = 0; b < 4; b++) BAT_UNITES.push({ side, sg, k: 'bat', u: (b - 1.5) * .3, v: sg * .3, L: tenue(side, b === 0 ? 'grenadiers' : 'ligne'), tir: -hash2(b, sg, 96) * 7 });
  for (const u of [-.3, .3]) BAT_UNITES.push({ side, sg, k: 'canons', u, v: sg * .2, L: tenue(side, 'artillerie'), tir: -hash2(u * 9, sg, 97) * 5 });
  for (const u of [-.85, .85]) BAT_UNITES.push({ side, sg, k: 'cav', u, v: sg * .45, L: tenue(side, 'cavalerie'), ph: hash2(u * 7, sg, 98) * 6 });
}
let EN_T = -1, EN = null;
function ennemi() {
  if (EN_T === CARTE.time) return EN; EN_T = CARTE.time;
  const a = AMB.ev.ennemi && ARMEES.find(x => x.side === 'co'); if (!a) return EN = null;
  const fin = Math.max(0, a.s - a.compo.long);
  return EN = { a, head: surChemin(a.pts, clamp(a.s, 0, a.L)), fin, trace: cheminEntre(a.pts, 0, fin) };
}
const PIL = { key: '', v: [] };
function villagesPilles() {
  const en = ennemi(); if (!en || en.trace.length < 2) return [];
  const key = (en.fin * 2 | 0) + ''; if (PIL.key === key) return PIL.v;
  PIL.key = key; PIL.v = GEO.nodes.filter(n => (n.type === 'village' || (n.type === 'ville' && !n.fort)) && distPoly(en.trace, n.x, n.y) < 3);
  return PIL.v;
}
const bivouac = () => AMB.heure === 'soir' || AMB.heure === 'nuit';

// ---------- petits dessins, en unités de figure (U km)
function mouton(g, x, y, a, c = '#efeade') { E(g, OMBRE, x + .8, y + 1, 1.9, 1.2, a); E(g, c, x, y, 1.9, 1.2, a); C(g, '#2c2a28', x + Math.cos(a) * 2, y + Math.sin(a) * 2, .6); }
function vache(g, x, y, a, robe) { E(g, OMBRE, x + 1, y + 1.3, 4.3, 1.9, a); E(g, robe, x, y, 4.3, 1.9, a); E(g, sombre(robe, .1), x + Math.cos(a) * 4.6, y + Math.sin(a) * 4.6, 1.4, .95, a); }
function chien(g, x, y, a, t) { E(g, 'rgba(20,20,10,.3)', x + .5, y + .7, 1.8, .8, a); E(g, '#3a2c22', x, y, 1.8, .75, a); C(g, '#2a1f18', x + Math.cos(a) * 1.9, y + Math.sin(a) * 1.9, .6); T(g, '#3a2c22', .4, x - Math.cos(a) * 1.7, y - Math.sin(a) * 1.7, x - Math.cos(a + Math.sin(t * 8) * .5) * 3, y - Math.sin(a + Math.sin(t * 8) * .5) * 3); }
function tente(g, c = '#ece6d4') { RR(g, 'rgba(20,20,10,.3)', -2.2, -1.2, 6, 4.2, .4); PG(g, clair(c, .06), [-3, -2, 3, -2, 3, 0, -3, 0]); PG(g, sombre(c, .14), [-3, 0, 3, 0, 3, 2, -3, 2]); T(g, sombre(c, .3), .35, -3, 0, 3, 0); }
function feuCamp(g, t, k) { C(g, '#5a5148', 0, 0, 1.8); C(g, '#2a211b', 0, 0, 1.3); const f = 1 + .25 * Math.sin(t * 9 + k); C(g, '#e2702a', 0, 0, .9 * f); C(g, '#ffd27a', 0, 0, .45 * f); }
function etal(g, k) {
  const c = ['#c8322b', '#e3c04f', '#2f4f9c', '#3f8a3c', '#8a5a44'][k % 5];
  RR(g, 'rgba(20,20,10,.3)', -2.6, -1.6, 7, 5, .4); RR(g, c, -3.5, -2.5, 7, 5, .4);
  for (let i = 0; i < 3; i++) RR(g, '#f1eee4', -3.5 + .7 + i * 2.2, -2.5, 1, 5, 0);
  for (let i = 0; i < 4; i++) C(g, ['#d6ba5c', '#9a4a3a', '#6b8f3a', '#e8dcc0'][(k + i) % 4], -2.6 + i * 1.7, 3.4, .7);
}
function mallePoste(g, pas) {
  for (const x of [-5, 5]) { RR(g, '#1c1b1d', x - 2.2, -4.2, 4.4, 1, .4); RR(g, '#1c1b1d', x - 2.2, 3.2, 4.4, 1, .4); }
  RR(g, '#c9a12c', -7.5, -3.4, 15, 6.8, 1.2); RR(g, '#2a2a2e', -6.5, -2.6, 8, 5.2, .8); RR(g, '#7a6a4f', 2.5, -2.6, 4, 5.2, .5);   // caisse jaune, impériale bâchée, coffre des dépêches
  for (const x of [16, 27]) for (const y of [-2.6, 2.6]) { g.save(); g.translate(x, y); cheval(g, x === 16 ? '#6b4a2c' : '#8b6a47', { gait: pas * 1.5 + x + y, bob: 0 }); if (x === 16 && y < 0) cavalier(g, LCIV, { habit: '#2f4f9c' }, { sabre: 0, bob: 0 }, true); g.restore(); }
}
function convoiFunebre(g, pas, k) {
  RR(g, '#2a2420', -6, -2.6, 12, 5.2, .6); RR(g, '#5b4127', -4.5, -1.4, 9, 2.8, .4); T(g, '#efe6cc', .4, -1, 0, 2, 0); T(g, '#efe6cc', .4, 0, -1, 0, 1);
  g.save(); g.translate(13, 0); cheval(g, '#2e2119', { gait: pas * .6, bob: 0 }); g.restore();
  for (let m = 0; m < 3; m++) { g.save(); g.translate(-10 - m * 4, (m % 2 ? 1.5 : -1.5)); fantassin(g, CIVILS[m].L, { role: 'h', habit: '#1f1d1d' }, { legs: pas * .6 + m, arme: 'aucun' }); g.restore(); }
}
// réfugiés : charrette chargée des meubles, familles à pied, bêtes poussées devant
function refugie(g, sorte, pas, k) {
  if (sorte < .3) {
    charrette(g, pas, sorte < .12, k);
    RR(g, '#5b3d24', -5, -2, 3.2, 4, .3); RR(g, '#d9cfb4', -1.4, -2, 4, 4, .6); T(g, '#9a4a3a', .5, -1.4, 0, 2.6, 0); C(g, '#6b4a2c', 3.4, 1, .9);   // armoire, matelas, chaise
    g.save(); g.translate(-12, 1.5); marcheur(g, k + 1, pas, true); g.restore();
  } else if (sorte < .55) {
    marcheur(g, k, pas, true); g.save(); g.translate(-4, 2.2); marcheur(g, k + 1, pas + 1, true); g.restore();
    g.save(); g.translate(-2.5, -2.3); g.scale(.7, .7); marcheur(g, k + 2, pas * 1.3, false); g.restore();
  } else if (sorte < .75) {
    for (let m = 0; m < 3; m++) vache(g, 6 + m * 2, (m - 1) * 4, 0, m % 2 ? '#efe9dd' : '#c9a07a');
    marcheur(g, k, pas, false); T(g, '#6b4d31', .4, .4, 2, 5, 2.8);
  } else {
    RR(g, '#8a6a45', 1, -1.6, 5, 3.2, .5); RR(g, '#d9cfb4', 1.5, -1.2, 4, 2.4, .5); C(g, '#3a2a1b', 6.5, 0, .8); T(g, '#6b4d31', .4, 1, -1.4, -1, -1.6); T(g, '#6b4d31', .4, 1, 1.4, -1, 1.6);   // la brouette
    marcheur(g, k, pas, false);
  }
}
function troupeauTrans(g, t, pas) {
  g.save(); g.translate(7, 0); marcheur(g, 4, pas, false); T(g, '#6b4d31', .4, .5, 1.8, 4.8, 2.6); g.restore();
  for (let m = 0; m < 46; m++) { const ox = -3 - (m % 9) * 2.6 - (m / 9 | 0) * 2.4 + Math.sin(t * 1.3 + m) * .4, oy = ((m * 7) % 11 - 5) * 1.15 + Math.sin(t + m * 2) * .3; mouton(g, ox, oy, Math.sin(t + m) * .3); }
  g.save(); g.translate(-30, 0); g.scale(.75, .75); cheval(g, '#7d7366', { gait: pas, bob: 0 }); RR(g, '#8a6a45', -2.5, -3.2, 5, 1.6, .4); RR(g, '#8a6a45', -2.5, 1.6, 5, 1.6, .4); g.restore();   // l'âne bâté
  chien(g, -12 + Math.sin(t * .7) * 4, -8, Math.sin(t) * .4, t); chien(g, -20 + Math.cos(t * .6) * 4, 8, Math.PI + Math.sin(t) * .4, t + 2);
  g.save(); g.translate(-37, 1); marcheur(g, 5, pas, true); g.restore();
}
function flamme(g, x, y, r, t, k) { const f = 1 + .2 * Math.sin(t * 11 + k) + .1 * Math.sin(t * 23 + k * 2); g.globalCompositeOperation = 'lighter'; g.globalAlpha = .9; g.drawImage(SPR.fl, x - r * f, y - r * 1.25 * f, r * 2 * f, r * 2.5 * f); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }

// ---------- sur les routes : réfugiés devant l'ennemi, transhumance (appelé par vieDePres pour chaque route)
function routesEnPlus(sc, g, e, ie, L, dans) {
  const t = sc.time, en = ennemi();
  if (en && distBB(e.bb, en.head) < 12) {
    for (let k = 0, n = Math.ceil(L / .35); k < n; k++) {
      const s0 = hash2(ie, k, 51) * L, q = surChemin(e.pts, s0), d = Math.hypot(q.x - en.head.x, q.y - en.head.y);
      if (d > 12 || d < .6 || distPoly(en.trace, q.x, q.y) < 1.5) continue;   // ni trop loin, ni dans le dos de l'armée
      const q2 = surChemin(e.pts, Math.min(L, s0 + .2)), sens = Math.hypot(q2.x - en.head.x, q2.y - en.head.y) > d ? 1 : -1;
      const sorte = hash2(ie, k, 52), v = sorte < .3 ? .006 : .0035, p = surChemin(e.pts, mod(s0 + sens * v * t, L)); if (!dans(p.x, p.y)) continue;
      const a = p.a + (sens < 0 ? Math.PI : 0), cote = (hash2(ie, k, 53) - .5) * .02;
      figK(sc, g, p.x - Math.sin(a) * cote, p.y + Math.cos(a) * cote, a); refugie(g, sorte, t * 1.7 * TAU + k, k);
    }
  }
  if (AMB.saison === 'printemps' || AMB.saison === 'automne') for (const f of TRANSHUMANCES) if (f.ie === ie) {
    const p = posTrans(f, t); if (!dans(p.x, p.y)) continue;
    figK(sc, g, p.x, p.y, p.a); troupeauTrans(g, t, t * 1.7 * TAU);
  }
}

// ---------- dans les pays : les travaux de la saison (appelé par vieDePres, au plus près)
function vieDesPays(sc, g, x0, y0, x1, y1, dans) {
  const t = sc.time, sa = AMB.saison;
  for (let j = Math.floor(y0); j <= y1; j++) for (let i = Math.floor(x0); i <= x1; i++) {
    const tt = ter(i + .5, j + .5); if (tt <= 1 || hash2(i, j, 80) > densite(i + .5, j + .5)) continue;
    const h = hash2(i, j, 81), bx = i + .25 + hash2(i, j, 82) * .5, by = j + .25 + hash2(j, i, 83) * .5;
    if (SALINE.has(j * GW + i) && (sa === 'ete' || sa === 'automne') && h < .6) paludiers(sc, g, i, j, t);
    if (!dans(bx, by)) continue;
    if (tt === TT.FORET && pinede(bx, by)) { if (h < .22 && sa !== 'hiver') resinier(sc, g, bx, by, t, h); }
    else if (tt === TT.FORET) { if (sa === 'hiver' && h < .1) loups(sc, g, bx, by, t, h); else if (h > .88) bucherons(sc, g, bx, by, t, h); }
    else if ((tt === TT.PLAINE || tt === TT.COLLINES) && neige(bx, by) < .5 && !disette(bx, by)) {
      if (sa === 'ete' && h < .22) moisson(sc, g, bx, by, t, h);
      else if ((sa === 'automne' || sa === 'printemps') && h > .8) labour(sc, g, bx, by, t, h);
    }
    else if (tt === TT.VIGNE && sa === 'automne' && h < .45) vendanges(sc, g, bx, by, t, h);
    else if ((tt === TT.MONTAGNE || tt === TT.HAUTE) && sa === 'ete' && h < .3 && neige(bx, by) < .5) estive(sc, g, bx, by, t, h);
  }
}
function resinier(sc, g, x, y, t, h) {
  // le gemmeur au pied du pin, son pitey (l'échelle à un seul montant) appuyé au tronc, le pot de résine ; le houppier au-dessus
  figK(sc, g, x, y, h * 40);
  T(g, 'rgba(20,20,10,.33)', .7, 2.2, 1.6, 17, 21);
  T(g, '#8a6a45', .7, 2.2, 1.6, 8, 6); for (let r = 0; r < 5; r++) { const k = r / 5, px = lerp(2.2, 8, k), py = lerp(1.6, 6, k); T(g, '#6b4d31', .35, px - .4, py + .5, px + .4, py - .5); }
  const geste = Math.sin(t * 2.2 + h * 9) > .2;
  g.save(); g.translate(geste ? 3.2 : 1, geste ? 2.4 : .6); g.rotate(.65); marcheur(g, (h * 10) | 0, 0, false); g.restore();
  C(g, '#d9c27a', 6.6, 3.2, .55);
  C(g, OMBRE, 10, 8.6, 6.5); C(g, '#2f5a33', 8, 6, 6.5); C(g, '#3d6a3d', 6.8, 4.8, 3.2);
  if (h < .06) { g.save(); g.translate(-18, 6); charrette(g, 0, true, 0); for (const cx of [-3, 0, 3]) for (const cy of [-1.1, 1.1]) { C(g, '#6b4a2c', cx, cy, 1.15); C(g, '#3a2a1b', cx, cy, .5); } g.restore(); }   // les barriques de gemme
}
function loups(sc, g, x, y, t, h) {
  for (let m = 0; m < 4; m++) {
    const ph = t * .018 + h * 9 - m * .045, px = x + Math.cos(ph) * .22, py = y + Math.sin(ph * 1.3) * .14, a = Math.atan2(Math.cos(ph * 1.3) * .182, -Math.sin(ph) * .22);
    figK(sc, g, px, py, a); const st = Math.sin(t * 9 + m);
    E(g, 'rgba(20,20,10,.3)', .8, 1, 3.2, 1.3);
    for (const [lx, ly] of [[1.8, -.9], [1.8, .9], [-1.8, -.9], [-1.8, .9]]) E(g, '#5a5550', lx + st * .8 * Math.sign(lx * ly), ly, .7, .3);
    E(g, '#7d7770', 0, 0, 3.1, 1.15); E(g, '#8c867e', 3.3, 0, 1.2, .8); E(g, '#6a645d', 4.4, 0, .6, .4); T(g, '#6f6a63', .7, -2.8, 0, -4.8, Math.sin(t * 3 + m) * .4);
    C(g, '#5e5852', 3.4, -.55, .3); C(g, '#5e5852', 3.4, .55, .3);
    if (AMB.heure === 'nuit') LUM.push({ x: px + Math.cos(a) * .016, y: py + Math.sin(a) * .016, r: .006, a: .7, spr: 'fen' });
  }
}
function bucherons(sc, g, x, y, t, h) {
  const a = h * 20; figK(sc, g, x, y, a);
  charbonniere(g, 14, 8); stere(g, -10, 6);
  T(g, '#6b4d31', 1.4, -4, -8, 8, -11); for (const k of [0, 1, 2]) C(g, BOIS[k + 1], 6 + k * 1.5, -11 + k, 1.8);   // l'arbre abattu
  for (const [ox, oy, k] of [[0, 0, 0], [4.5, -4, 1]]) { g.save(); g.translate(ox, oy); fantassin(g, CIVILS[3 + k].L, { role: 'h', habit: CIVILS[3 + k].habit }, { legs: null, arme: 'hache', ext: mod(t * .9 + k * .5, 1) }); g.restore(); }
  if (Math.random() < .04) { const [fx, fy] = versMonde(x, y, a, 14, 8); fumee(sc, fx, fy, 0, 0, .003, .03, 7, .3); }
}
function moisson(sc, g, x, y, t, h) {
  figK(sc, g, x, y, h * 7);
  for (let m = 0; m < 5; m++) { g.save(); g.translate(0, (m - 2) * 4.2); marcheur(g, m, 0, false); const s = Math.sin(t * 2.6 + m * .7); T(g, '#6b4d31', .4, .5, 0, 3 + s, 2.8 * s); T(g, '#c9ccd0', .45, 3 + s, 2.8 * s, 4.6 + s, 2.8 * s - 1.5); g.restore(); }   // les faucheurs
  for (let r = 0; r < 3; r++) for (let q = 0; q < 6; q++) { const gx = -7 - r * 6, gy = (q - 2.5) * 4; C(g, 'rgba(40,30,15,.3)', gx + .5, gy + .7, 1.3); C(g, '#e3cd84', gx, gy, 1.3); }
  for (let m = 0; m < 2; m++) { g.save(); g.translate(-4 - m * 6, -3 + m * 7); g.rotate(Math.PI); marcheur(g, m + 3, 0, false); g.restore(); }   // les lieuses
  g.save(); g.translate(-26, 2); g.rotate(Math.PI / 2); charrette(g, 0, true, 1); for (let q = 0; q < 6; q++) C(g, '#e3cd84', -4 + (q % 3) * 3.5, (q / 3 | 0) * 2.4 - 1.2, 1.4); g.restore();
}
function labour(sc, g, x, y, t, h) {
  const L = .32, u = t * .0025 + h * 9, s = pingpong(u, L), aller = mod(u, 2 * L) < L, a0 = h * 7;
  figK(sc, g, x + Math.cos(a0) * (s - L / 2), y + Math.sin(a0) * (s - L / 2), a0 + (aller ? 0 : Math.PI));
  const pas = t * 1.2 * TAU;
  for (const yy of [-2.4, 2.4]) { g.save(); g.translate(9, yy); cheval(g, '#d2bf95', { gait: pas + yy, bob: 0 }); T(g, '#efe6cc', .35, 7.7, -.6, 8.3, -1.4); T(g, '#efe6cc', .35, 7.7, .6, 8.3, 1.4); g.restore(); }
  T(g, '#5b4127', .5, 3, 0, 1, 0); charrue(g, 0, 0, 0); g.save(); g.translate(-6, 0); marcheur(g, 2, pas, false); g.restore();
  for (let m = 0; m < 4; m++) { const ox = -12 - m * 3 + Math.sin(t * 2 + m) * 1.5, oy = Math.cos(t * 1.7 + m * 2) * 3; g.strokeStyle = '#f4f2ea'; g.lineWidth = .5; g.beginPath(); g.moveTo(ox - 1, oy - 1.4); g.quadraticCurveTo(ox, oy - .2, ox + .5, oy); g.quadraticCurveTo(ox, oy + .2, ox - 1, oy + 1.4); g.stroke(); }   // les mouettes derrière la charrue
}
function vendanges(sc, g, x, y, t, h) {
  figK(sc, g, x, y, h < .2 ? Math.PI / 2 : 0);
  for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) { g.save(); g.translate((q - 1.5) * 6 + Math.sin(t * .3 + r + q) * .6, (r - 1) * 3); marcheur(g, r * 4 + q, 0, false); C(g, '#6a3a6a', 1.6, 1.4, .7); g.restore(); }   // coupeurs et leurs paniers
  for (let m = 0; m < 2; m++) { const s = pingpong(t * .8 + m * 7, 16) - 8; g.save(); g.translate(s, 7 + m * 2.2); marcheur(g, 9 + m, t * 7 + m, false); C(g, '#6b4a2c', -1.8, 0, 1.3); C(g, '#5a2f5a', -1.8, 0, .8); g.restore(); }   // porteurs à la hotte
  g.save(); g.translate(-14, 11); charrette(g, 0, true, 2); for (const cx of [-3.5, 0, 3.5]) { C(g, '#6b4a2c', cx, 0, 1.6); C(g, '#4a2747', cx, 0, 1.1); } g.restore();   // les comportes
}
function estive(sc, g, x, y, t, h) {
  figK(sc, g, x, y, h * 9);
  bat(g, [{ t: 'g', x: -6, y: -4, w: 12, h: 8, p: 'lauze', h2: 1.2 }], -16, -8, .3, 1);   // le cayolar, la cabane du berger
  g.strokeStyle = '#a39a88'; g.lineWidth = 1.1; g.beginPath(); g.arc(-17, 7, 6, 0, TAU); g.stroke();   // le parc de pierres sèches
  for (let m = 0; m < 30; m++) { const px = (hash2(m, h * 999 | 0, 140) - .5) * 44, py = (hash2(h * 999 | 0, m, 141) - .5) * 26; mouton(g, px + Math.sin(t * .05 + m) * 1.2, py + Math.cos(t * .04 + m) * .8, hash2(m, 3, 142) * TAU + Math.sin(t * .1 + m) * .3); }
  g.save(); g.translate(-8, 2); marcheur(g, 6, 0, false); g.restore(); chien(g, 14, -3, 2 + Math.sin(t * .5), t);
}
function paludiers(sc, g, i, j, t) {
  for (let m = 0; m < 2; m++) {
    const x = i + .3 + m * .3 + hash2(i, j, 110 + m) * .2, y = j + .3 + hash2(j, i, 112 + m) * .4, s = Math.sin(t * 1.4 + m * 2);
    if (terOnde(x, y) !== TT.MARAIS) continue;
    figK(sc, g, x, y, m * 2.2); marcheur(g, 7 + m, 0, false); T(g, '#8a6a45', .45, 1, 1, 6 + s * 2, 1.5); T(g, '#6b4d31', .7, 6 + s * 2, -.2, 6 + s * 2, 3.2);   // le las, le grand râteau
  }
}

// ---------- la guerre sur la carte
// traces de passage : route défoncée, champs piétinés, débris ; villages pillés derrière l'ennemi
function traces(sc, g, x0, y0, x1, y1) {
  const z = sc.z; if (z < 6) return;
  for (const a of ARMEES) {
    const fin = Math.min(a.s - a.compo.long, a.L), deb = Math.max(0, fin - 40); if (fin <= .2) continue;
    const tr = cheminEntre(a.pts, deb, fin); if (tr.length < 2) continue;
    sc.monde(g); g.lineCap = 'round'; g.lineJoin = 'round';
    ligne(g, tr); g.strokeStyle = 'rgba(112,84,48,.42)'; g.lineWidth = Math.max(.07, 3 / z); g.stroke();
    if (z < 18) continue;
    for (let s = Math.max(deb, 0); s < fin; s += .09) {
      const p = surChemin(a.pts, s); if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const k = s * 11 | 0;
      for (const sg of [-1, 1]) { const o = .05 + hash2(k, sg, 104) * .12; pietine(g, p.x - Math.sin(p.a) * o * sg, p.y + Math.cos(p.a) * o * sg, .03 + hash2(k, 2, 104) * .03, .018, p.a, .22); }
      if (a.side === 'co' && z >= VIE_Z && k % 6 === 0) { figK(sc, g, p.x - Math.sin(p.a) * .02, p.y + Math.cos(p.a) * .02, p.a + hash2(k, 3, 104) * 3); debris(g, hash2(k, 4, 104)); sc.monde(g); }
    }
  }
}
function debris(g, h) {
  if (h < .3) { E(g, '#5a4a3c', 0, 0, 5, 2, .2); E(g, '#4a3c30', 5, -.6, 2, .9, .5); for (const [lx, ly] of [[2, 1.6], [-2, 1.6]]) T(g, '#3a2e24', .7, lx, ly, lx + 1, ly + 3); }   // un cheval tombé
  else if (h < .6) { g.rotate(.5); RR(g, '#7a5b3a', -6, -2.9, 12, 5.8, .6); RR(g, '#3a2a1b', 3, -3.7, 4, 1, .4); C(g, '#3a2a1b', -9, 3, 2.2); C(g, '#7a5b3a', -9, 3, 1.4); }   // une charrette brisée, une roue à terre
  else { RR(g, '#8a6a45', -1, -1, 2.4, 2, .4); C(g, '#1c1b1d', 3, 1, 1.1); T(g, '#5b4127', .5, -4, -2, 2, -3); }   // sac, shako, fusil abandonnés
}
function pillages(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time;
  for (const n of villagesPilles()) {
    if (n.x < x0 - 2 || n.x > x1 + 2 || n.y < y0 - 2 || n.y > y1 + 2) continue;
    const r = profilVille(n, ANNEE).R / S * .6;
    for (let k = 0; k < 3; k++) {
      const x = n.x + (hash2(n.id, k, 120) - .5) * r * 2, y = n.y + (hash2(n.id, k, 121) - .5) * r * 2;
      LUM.push({ x, y, r: .25, a: .55, jour: true });
      if (Math.random() < .05) fumee(sc, x, y, 0, 0, .02, .25, 14, .42, 'n');
      sc.monde(g);
      if (z >= 18) E(g, 'rgba(30,24,20,.55)', x, y, .05, .035, k);
      if (z >= 10) flamme(g, x, y, Math.max(.015, 4 / z), t, k);
    }
    sc.monde(g); for (let q = 0; q < 4; q++) { const d = mod(t * .03 + q * .25, 1), rr = Math.max(.25 + d * .9, (5 + d * 9) / z); g.globalAlpha = .65 * (1 - d); g.drawImage(SPR.n, n.x - rr + d * 1.8, n.y - rr - d * .9, rr * 2, rr * 2); } g.globalAlpha = 1;   // le panache noir, de loin
  }
}
function siegeSol(sc, g) {
  const z = sc.z, s = SIEGE; if (z < 6) return;
  sc.monde(g); g.lineCap = 'round'; g.lineJoin = 'round';
  // tranchées : trois parallèles autour de la place, reliées par des boyaux en zigzag
  const lignes = [...s.paralleles, ...s.boyaux];
  for (const p of lignes) { ligne(g, p); g.strokeStyle = '#a08458'; g.lineWidth = Math.max(.035, 2.2 / z); g.stroke(); }
  for (const p of lignes) { ligne(g, p); g.strokeStyle = '#5d4932'; g.lineWidth = Math.max(.012, .9 / z); g.stroke(); }
  for (const b of s.batteries) { const ca = Math.cos(b.a), sa = Math.sin(b.a); T(g, '#8f7449', Math.max(.05, 3 / z), b.x + ca * .02 - sa * .06, b.y + sa * .02 + ca * .06, b.x + ca * .02 + sa * .06, b.y + sa * .02 - ca * .06); }
  if (z >= 18) for (let k = 0; k < 60; k++) { const a = s.aT + (hash2(k, 1, 122) - .5) * 2.6, d = s.r + .3 + hash2(k, 2, 122) * 3; pietine(g, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, .08, .05, a, .2); }
}
function siegeVie(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time, s = SIEGE, nuit = AMB.heure === 'nuit';
  // le camp des assiégeants, en retrait des tranchées
  for (const [x, y, q, w] of s.camp) {
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    if (z >= 30) { figK(sc, g, x, y, s.aT, 1.6); if (q % 3 === 1 && w % 2) feuCamp(g, t, q + w); else tente(g); }
    if (q % 3 === 1 && w % 2) LUM.push({ x, y, r: .05, a: .9 });
  }
  // les batteries tirent sur la place ; les boulets portent l'incendie dans la ville
  for (const b of s.batteries) {
    if (!nuit && t - b.tir > 5 + (b.x * 7 % 2)) {
      b.tir = t; const ca = Math.cos(b.a), sa = Math.sin(b.a);
      for (const o of [-.02, 0, .02]) { fumee(sc, b.x + ca * .04 - sa * o, b.y + sa * .04 + ca * o, ca * .004, sa * .004, .01, .1, 9, .5); ECLAIRS.push({ x: b.x + ca * .04 - sa * o, y: b.y + sa * .04 + ca * o, t0: t }); }
      const a = hash2(t * 10 | 0, 1, 123) * TAU, d = Math.sqrt(hash2(t * 10 | 0, 2, 123)) * s.r * .8; s.impacts.push({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d, t0: t + 1.3 });
    }
    if (z >= 40 && b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) for (const o of [-6, 0, 6]) { const [px, py] = versMonde(b.x, b.y, b.a, -6, o); figK(sc, g, px, py, b.a); piece(g, s.L, { recul: Math.max(0, 2 - (t - b.tir) * 4) }); if (z >= VIE_Z) { figK(sc, g, ...versMonde(b.x, b.y, b.a, -14, o + 2), b.a); fantassin(g, s.L, { role: 'h' }, { legs: null, arme: 'refouloir', ext: .5 + .5 * Math.sin(t * 2 + o) }); } }
  }
  s.impacts = s.impacts.filter(m => { if (t < m.t0) return true; fumee(sc, m.x, m.y, 0, 0, .02, .16, 9, .4, 'n'); ECLAIRS.push({ x: m.x, y: m.y, t0: t }); return false; });
  // la ville brûle par endroits : toits crevés, flammes, fumées noires
  for (const [k, [x, y]] of s.feux.entries()) {
    LUM.push({ x, y, r: .3, a: .5, jour: true });
    if (Math.random() < .06) fumee(sc, x, y, 0, 0, .03, .3, 16, .42, 'n');
    if (z >= 18 && x > x0 && x < x1 && y > y0 && y < y1) { sc.monde(g); E(g, 'rgba(30,24,20,.55)', x, y, .06, .04, k); flamme(g, x, y, Math.max(.018, 2.5 / z), t, k); }
  }
}
function bataille(sc, g, x0, y0, x1, y1) {
  const B = BATAILLE, z = sc.z, t = sc.time, nuit = AMB.heure === 'nuit', ux = Math.cos(B.a), uy = Math.sin(B.a), nx = -uy, ny = ux;
  // de loin : le nuage de la bataille, qui monte et dérive sous le vent
  if (!nuit) { sc.monde(g); for (let k = 0; k < 12; k++) { const d = mod(t * .02 + k * .35, 4.2), r = Math.max(.5 + d * .55, 7 / z), x = B.x + (hash2(k, 1, 105) - .5) * 1.6 + d * .9, y = B.y + (hash2(k, 2, 105) - .5) * .8 - d * .45; g.globalAlpha = .34 * (1 - d / 4.2); g.drawImage(SPR.f, x - r, y - r, 2 * r, 2 * r); } g.globalAlpha = 1; }
  if (z >= 18) { sc.monde(g); for (let k = 0; k < 40; k++) pietine(g, B.x + ux * (hash2(k, 1, 106) - .5) * 2.2 + nx * (hash2(k, 2, 106) - .5) * .9, B.y + uy * (hash2(k, 1, 106) - .5) * 2.2 + ny * (hash2(k, 2, 106) - .5) * .9, .09, .05, B.a, .2); }
  for (const u of BAT_UNITES) {
    const charge = u.k === 'cav' && !nuit ? Math.max(0, Math.sin(t * .04 + u.ph)) * .18 : 0, v = u.v - u.sg * charge;
    const x = B.x + ux * u.u + nx * v, y = B.y + uy * u.u + ny * v, face = Math.atan2(-u.sg * ny, -u.sg * nx), fx = Math.cos(face), fy = Math.sin(face);
    if (nuit) { for (const o of [-.1, .1]) LUM.push({ x: x - fx * .2 + ux * o, y: y - fy * .2 + uy * o, r: .05, a: .9 }); }
    else if (u.k !== 'cav' && t - u.tir > (u.k === 'canons' ? 5 : 7)) {
      u.tir = t; const w = u.k === 'canons' ? .08 : .26, nb = u.k === 'canons' ? 3 : 6;
      for (let i = 0; i < nb; i++) { const o = (i / (nb - 1) - .5) * w, px = x + fx * .015 - fy * o, py = y + fy * .015 + fx * o; fumee(sc, px, py, fx * .003, fy * .003, .008, u.k === 'canons' ? .13 : .07, 9, .5); ECLAIRS.push({ x: px, y: py, t0: t }); }
    }
    if (x < x0 - .5 || x > x1 + .5 || y < y0 - .5 || y > y1 + .5) continue;
    if (z < VIE_Z) {   // de loin : les bataillons en lignes, les batteries, les escadrons
      sc.fig(g, x, y, face); const e = Math.max(.02, 2 / z), c = u.side === 'fr' ? '#2f4f9c' : '#b8352c';
      if (u.k === 'bat') { RR(g, 'rgba(20,20,10,.3)', -e * .5 + .01, -.13 + .012, e, .26, e * .3); RR(g, c, -e * .5, -.13, e, .26, e * .3); RR(g, '#e9e5d8', -e * .5, -.13, e * .3, .26, 0); }
      else if (u.k === 'canons') for (const o of [-.03, 0, .03]) RR(g, '#3a3530', -e * .6, o - e * .25, e * 1.2, e * .5, e * .1);
      else { RR(g, 'rgba(20,20,10,.3)', -e + .01, -.06 + .012, e * 2, .12, e * .3); RR(g, clair(c, .15), -e, -.06, e * 2, .12, e * .3); }
      continue;
    }
    const tire = t - u.tir < 1.2;
    if (u.k === 'bat') for (let r = 0; r < 2; r++) for (let i = 0; i < 22; i++) { figK(sc, g, ...versMonde(x, y, face, -r * 2.8, (i - 10.5) * 2.5), face); fantassin(g, u.L, { role: 'h' }, { legs: null, arme: tire ? 'joue' : 'recharge', ext: t * 3 + i }); }
    else if (u.k === 'canons') for (const o of [-6, 0, 6]) { figK(sc, g, ...versMonde(x, y, face, 0, o), face); piece(g, u.L, { recul: tire ? 2 : 0 }); }
    else for (let r = 0; r < 2; r++) for (let i = 0; i < 10; i++) { figK(sc, g, ...versMonde(x, y, face, -r * 7, (i - 4.5) * 4.2), face); cheval(g, u.L.chevaux[(i + r) % 5], { gait: charge > .02 ? t * 14 + i : null, bob: 0 }); cavalier(g, u.L, { habit: u.L.habit }, { sabre: charge > .05 ? 1 : 0, bob: 0 }); }
  }
  if (z >= VIE_Z) for (let k = 0; k < 30; k++) { const x = B.x + ux * (hash2(k, 1, 107) - .5) * 1.4 + nx * (hash2(k, 2, 107) - .5) * .5, y = B.y + uy * (hash2(k, 1, 107) - .5) * 1.4 + ny * (hash2(k, 2, 107) - .5) * .5; if (x < x0 || x > x1 || y < y0 || y > y1) continue; figK(sc, g, x, y, k * 2.1); E(g, k % 2 ? '#2f4f9c' : '#b8352c', 0, 0, 2.4, 1.1); C(g, PEAU, 2.4, 0, .7); }   // les tombés
}
// au soir l'armée fait halte : tentes alignées le long de la route, feux de bivouac, faisceaux d'armes
function campArmee(sc, g, a, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time, C2 = a.compo;
  if (z < 14) pionArmee(sc, g, a);
  const s1 = clamp(a.s, 0, a.L), s0 = Math.max(0, s1 - C2.long * .8);
  let k = 0;
  for (let s = s0; s < s1; s += .028, k++) {
    const p = surChemin(a.pts, s), nx = -Math.sin(p.a), ny = Math.cos(p.a);
    if (k % 6 === 0) {
      const fx = p.x + nx * .13, fy = p.y + ny * .13; LUM.push({ x: fx, y: fy, r: .04, a: .7, petit: true });
      if (z >= 14 && fx > x0 && fx < x1 && fy > y0 && fy < y1) {
        if (Math.random() < .02) fumee(sc, fx, fy, 0, 0, .003, .03, 6, .25);
        figK(sc, g, fx, fy, 0); feuCamp(g, t, k);
        if (z >= VIE_Z) for (let m = 0; m < 5; m++) { const aa = m * 1.26 + k; figK(sc, g, fx + Math.cos(aa) * .011, fy + Math.sin(aa) * .011, aa + Math.PI); fantassin(g, C2.Linf, { role: 'h' }, { legs: null, arme: 'aucun' }); }
      }
    }
    if (z < 14 || p.x < x0 - .3 || p.x > x1 + .3 || p.y < y0 - .3 || p.y > y1 + .3) continue;
    for (const o of [.05, .085]) { figK(sc, g, p.x + nx * o, p.y + ny * o, p.a, 1.4); tente(g); }
    if (k % 4 === 1 && z >= VIE_Z) { figK(sc, g, p.x + nx * .105, p.y + ny * .105, 0); for (let m = 0; m < 6; m++) { const aa = m * TAU / 6; T(g, '#4a3a2a', .4, 0, 0, Math.cos(aa) * 2.6, Math.sin(aa) * 2.6); } }   // faisceau de fusils
  }
  // les canons parqués, les chevaux à la corde, une sentinelle sur la route
  if (z >= 40) {
    const p = surChemin(a.pts, s0), nx = -Math.sin(p.a), ny = Math.cos(p.a);
    for (let m = 0; m < 3; m++) { figK(sc, g, p.x + nx * (.05 + m * .02), p.y + ny * (.05 + m * .02), p.a + Math.PI); piece(g, C2.Lart, { recul: 0 }); }
    for (let m = 0; m < 8; m++) { figK(sc, g, p.x + nx * .14 + Math.cos(p.a) * m * .012, p.y + ny * .14 + Math.sin(p.a) * m * .012, p.a + Math.PI / 2); cheval(g, C2.Lcav.chevaux[m % 5], { bob: 0 }); }
    const q = surChemin(a.pts, Math.min(a.L, s1 + .03 + pingpong(t * .002, .05))); figK(sc, g, q.x, q.y, q.a); fantassin(g, C2.Linf, { role: 'h' }, { legs: t * 4, arme: 'epaule' });
  }
}

// ---------- la mer, les rivières, les ports
function peches(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time;
  if (z >= 40) {
    sc.monde(g);
    for (const [x, y, a] of PARCS) { if (x < x0 || x > x1 || y < y0 || y > y1) continue; g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = 'rgba(196,204,186,.4)'; g.fillRect(-.16, -.08, .32, .16); g.strokeStyle = '#5e5440'; g.lineWidth = Math.max(.003, .6 / z); for (let u = -.15; u <= .151; u += .05) { g.beginPath(); g.moveTo(u, -.07); g.lineTo(u, .07); g.stroke(); } g.strokeRect(-.15, -.07, .3, .14); g.restore(); }
    for (const [x, y] of TCHANQUEES) { if (x < x0 || x > x1 || y < y0 || y > y1) continue; figK(sc, g, x, y, .4, 1.4); for (const [lx, ly] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) T(g, 'rgba(20,30,40,.35)', .5, lx, ly, lx + 6, ly + 8); RR(g, '#8a6a45', -4, -4, 8, 8, .4); bat(g, [{ t: 'g', x: -3, y: -2.5, w: 6, h: 5, p: 'tuile', h2: 1 }], 0, 0, 0, 1); }
    for (const c of CARRELETS) { if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue; figK(sc, g, c.x, c.y, c.a, 1.3); T(g, 'rgba(20,30,40,.35)', .6, 2, 1.5, 15, 3.5); T(g, '#6b4d31', .9, 0, 0, 13, 0); RR(g, '#7a5634', -3, -3, 6, 6, .4); RR(g, '#b0503a', -2.4, -2.4, 4.8, 4.8, .3); const lev = Math.sin(t * .15 + c.lev) > .3; g.strokeStyle = lev ? '#d9d2bc' : 'rgba(60,70,70,.55)'; g.lineWidth = .3; g.strokeRect(13, -4, 8, 8); g.beginPath(); g.moveTo(13, -4); g.lineTo(21, 4); g.moveTo(21, -4); g.lineTo(13, 4); g.stroke(); if (lev) for (let m = 0; m < 3; m++) C(g, '#c9d6dd', 15 + m * 2.5, 1 + Math.sin(t * 5 + m), .35); }
  }
  if (z < 18) return;
  for (const b of PECHE) {
    const ang = t * b.v / b.r + b.ph, x = b.x + Math.cos(ang) * b.r, y = b.y + Math.sin(ang) * b.r * .6; if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const a = Math.atan2(Math.cos(ang) * .6, -Math.sin(ang)), k = Math.max(.006, 2 / z);
    sc.monde(g); g.save(); g.translate(x, y); g.rotate(a); g.scale(k, k);
    for (let i = 0; i < 9; i++) { const aa = Math.PI * .5 + i / 8 * Math.PI; C(g, '#efe6cc', -6 + Math.cos(aa) * 7, Math.sin(aa) * 7, .45); }   // les flotteurs du filet
    E(g, 'rgba(20,30,40,.3)', 1.2, 1.6, b.pinasse ? 6 : 8, 1.8); E(g, b.pinasse ? '#2f4a5a' : '#5b4127', 0, 0, b.pinasse ? 6 : 8, 1.8); E(g, '#8a6a45', 0, 0, b.pinasse ? 5 : 7, 1.1);
    C(g, '#7a6a4f', -1.5, 0, .9); C(g, '#5d6b86', 2, 0, .9);
    g.restore();
    if (bivouac()) LUM.push({ x, y, r: .02, a: .8, spr: 'fen' });
  }
  for (const r of RADEAUX) {
    const p = surChemin(r.pts, mod(r.s0 + r.v * t, r.L)); if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
    const k = Math.max(.006, 2 / z); sc.monde(g); g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.scale(k, k);
    for (let m = 0; m < 3; m++) { RR(g, 'rgba(20,30,40,.3)', -4 - m * 11, -1.6, 10, 4.4, .6); for (let l = 0; l < 4; l++) RR(g, l % 2 ? '#7a5634' : '#8d6a44', -5 - m * 11, -2.2 + l * 1.1, 10, 1, .45); if (m) T(g, '#5b4127', .4, -m * 11 + 5, 0, -m * 11 + 6, 0); }
    g.save(); g.translate(2, 0); marcheur(g, 2, 0, false); T(g, '#6b4d31', .4, 0, 1, 7, 4); g.restore();   // le radelier et sa perche
    g.restore();
  }
}
function relaisPoste(sc, g, x0, y0, x1, y1) {
  for (const r of RELAIS) {
    if (r.x < x0 - .2 || r.x > x1 + .2 || r.y < y0 - .2 || r.y > y1 + .2) continue;
    const nx = -Math.sin(r.a) * r.c, ny = Math.cos(r.a) * r.c, x = r.x + nx * .05, y = r.y + ny * .05, a = r.a + (r.c < 0 ? Math.PI : 0);
    sc.monde(g); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#cdbf9f'; g.fillRect(-.05, -.03, .1, .06); g.restore();
    bat(g, [{ t: 'g', x: -14, y: -9, w: 28, h: 7, p: 'tuile', h2: 1.6 }, cheminee(-8, -6), { t: 'g', x: 8, y: -2, w: 7, h: 12, p: 'tuile', h2: 1.3 }, { t: 'g', x: -14, y: 4, w: 16, h: 6, p: 'chaume', h2: 1.1 }], x, y, a, U * 1.1);
    if (sc.z >= VIE_Z) for (let m = 0; m < 4; m++) { figK(sc, g, ...versMonde(x, y, a, -6 + m * 4, 1.5, 1.1), a + Math.PI / 2 + m * .3); cheval(g, ['#6b4a2c', '#8b6a47', '#3f2d1f', '#54402e'][m], { bob: 0 }); }   // les chevaux de relève dans la cour
    LUM.push({ x: r.x + nx * .012, y: r.y + ny * .012, r: .03, a: .8, spr: 'fen' });   // la lanterne du relais
  }
}
function marches(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time;
  for (const n of MARCHES) {
    if (n.x < x0 - 1 || n.x > x1 + 1 || n.y < y0 - 1 || n.y > y1 + 1 || (AMB.ev.siege && SIEGE && n === SIEGE.n) || disette(n.x, n.y)) continue;
    const p = planCarte(n), pl = p.V.lieux.place || { x: IC[0], y: IC[1] }, cx = n.x + (pl.x - IC[0]) / S, cy = n.y + (pl.y - IC[1]) / S;
    const pop = n.pop0 || 700, N = clamp(Math.round(4 + Math.sqrt(pop) / 4), 5, 26), R0 = Math.min(40, 14 + Math.sqrt(pop) / 6);
    figK(sc, g, cx, cy, 0);
    for (let k = 0; k < N; k++) { const a = k * 2.4, d = R0 * (.3 + .7 * Math.sqrt((k + .5) / N)); g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(a + Math.PI / 2); etal(g, k); g.restore(); }
    const M = N * 2;
    for (let m = 0; m < M; m++) {
      const a = m * 2.17 + Math.sin(t * .05 + m) * .4, d = R0 * (.2 + Math.sqrt((m + .5) / M) * 1.15), px = Math.cos(a) * d, py = Math.sin(a) * d;
      if (z >= VIE_Z) { g.save(); g.translate(px, py); g.rotate(a + Math.PI / 2 + Math.sin(t * .3 + m)); marcheur(g, m, t * 4 + m, m % 3 === 0); g.restore(); }
      else C(g, CIVILS[m % CIVILS.length].habit, px, py, Math.max(1.2, 1 / (z * U)));
    }
  }
  if (z < 30) return;
  for (const n of FOIRES) {
    const Pf = profilVille(n, ANNEE), ro = Pf.routes[0], a = ro ? ro.a + .5 : 0, d = Pf.R / S * 1.2 + .15, x = n.x + Math.cos(a) * d, y = n.y + Math.sin(a) * d;
    if (x < x0 - .5 || x > x1 + .5 || y < y0 - .5 || y > y1 + .5) continue;
    sc.monde(g); pietine(g, x, y, .16, .1, a, .32);
    figK(sc, g, x, y, a);
    for (let q = 0; q < 3; q++) { const ox = (q - 1) * 20 - 8, oy = -8; cloture(g, ox, oy, 16, 12); for (let m = 0; m < 5; m++) { const mx = ox + 3 + (m % 3) * 5, my = oy + 3 + (m / 3 | 0) * 6; if (q === 0) vache(g, mx, my, m, m % 2 ? '#efe9dd' : '#c9a07a'); else if (q === 1) { g.save(); g.translate(mx, my); g.rotate(m); g.scale(.6, .6); cheval(g, ['#6b4a2c', '#8b6a47', '#3f2d1f'][m % 3], { bob: 0 }); g.restore(); } else for (let s2 = 0; s2 < 2; s2++) mouton(g, mx + s2 * 2, my + s2, m); } }
    for (let k = 0; k < 4; k++) { g.save(); g.translate(-20 + k * 13, 12); g.scale(1.4, 1.4); etal(g, k + 2); g.restore(); }
    for (let m = 0; m < 40; m++) { const px = (hash2(m, n.id, 124) - .5) * 60 + Math.sin(t * .1 + m) * 2, py = (hash2(n.id, m, 125) - .5) * 30 + 4; if (z >= VIE_Z) { g.save(); g.translate(px, py); g.rotate(m); marcheur(g, m, t * 4 + m, false); g.restore(); } else C(g, CIVILS[m % CIVILS.length].habit, px, py, Math.max(1.2, 1 / (z * U))); }
  }
}
function contrebande(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time;
  for (const P of SENTIERS) {
    const [a, b, c, d] = bboxOf(P.pts); if (c < x0 || a > x1 || d < y0 || b > y1) continue;
    sc.monde(g); g.setLineDash([Math.max(.02, 3 / z), Math.max(.015, 2 / z)]); ligne(g, P.pts); g.strokeStyle = 'rgba(189,169,127,.85)'; g.lineWidth = Math.max(.008, .9 / z); g.stroke(); g.setLineDash([]);
    if (z < 60) continue;
    const u = t * .0035 + P.ph * 50, s = pingpong(u, P.L), dir = mod(u, 2 * P.L) < P.L ? 1 : -1;
    for (let m = 0; m < 5; m++) {
      const q = surChemin(P.pts, clamp(s - dir * m * .014, 0, P.L)); if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1) continue;
      figK(sc, g, q.x, q.y, q.a + (dir < 0 ? Math.PI : 0)); const pas = t * 1.5 * TAU + m;
      if (m % 2) { cheval(g, '#5e4b3a', { gait: pas, bob: 0 }); RR(g, '#c9b48a', -2.4, -3.6, 4.8, 1.7, .4); RR(g, '#c9b48a', -2.4, 1.9, 4.8, 1.7, .4); T(g, '#6b4d31', .3, 0, -2, 0, 2); }   // mulets chargés de ballots
      else { fantassin(g, CIVILS[m].L, { role: 'h', habit: '#3a3530' }, { legs: pas, arme: 'aucun' }); C(g, '#2a2622', -.2, 0, 1.1); }   // le béret noir
    }
    // les douaniers font leur ronde au pied du sentier
    const qd = surChemin(P.pts, pingpong(t * .0018, Math.min(1.2, P.L)));
    if (qd.x > x0 && qd.x < x1 && qd.y > y0 && qd.y < y1) for (let m = 0; m < 2; m++) { figK(sc, g, qd.x + m * .006, qd.y + m * .004, qd.a); fantassin(g, tenue('fr', 'chasseurs'), { role: 'h' }, { legs: t * 4 + m, arme: 'epaule' }); }
  }
}
function cordouan(sc, g) {
  const { x, y } = CORDOUAN, z = sc.z, k = Math.max(.012, 2.4 / z);
  sc.monde(g);
  C(g, 'rgba(222,212,180,.55)', x, y, k * 3.2); C(g, 'rgba(160,150,128,.6)', x, y, k * 2.2);   // le plateau de roches et l'enceinte
  T(g, 'rgba(20,20,10,.3)', k * .9, x, y, x + k * 3, y + k * 4);   // la longue ombre de la tour
  C(g, '#9b917c', x, y, k * 1.5); C(g, '#efe9da', x, y, k); C(g, '#d9d2bf', x + k * .2, y + k * .2, k * .55); C(g, '#8696a8', x, y, k * .4);
}
function oiseaux(sc, g, x0, y0, x1, y1) {
  const z = sc.z, t = sc.time, sa = AMB.saison; if (z < 4) return;
  const s = Math.max(U * 2.4, 2.2 / z);
  const oiseau = (x, y, a, c, fl) => { if (x < x0 || x > x1 || y < y0 || y > y1) return; sc.fig(g, x, y, a); g.scale(s, s); g.strokeStyle = c; g.lineWidth = .28; g.beginPath(); g.moveTo(-.5, -1 + fl * .4); g.quadraticCurveTo(0, -.2, .35, 0); g.quadraticCurveTo(0, .2, -.5, 1 - fl * .4); g.stroke(); };
  for (const v of VOLS) {
    if (v.sorte === 'grues' && (sa === 'printemps' || sa === 'automne')) {
      const a = sa === 'printemps' ? -.75 : Math.PI - .75, cx = mod(v.x + Math.cos(a) * .06 * t, GW + 100) - 50, cy = mod(v.y + Math.sin(a) * .06 * t, GH + 100) - 50;
      for (let m = 0; m < 21; m++) { const r = Math.ceil(m / 2), sg = m % 2 ? 1 : -1; oiseau(cx - Math.cos(a) * r * s * 2.2 - Math.sin(a) * sg * r * s * 1.8, cy - Math.sin(a) * r * s * 2.2 + Math.cos(a) * sg * r * s * 1.8, a, '#3a3530', Math.sin(t * 5 + m * .4)); }
    } else if (v.sorte === 'palombes' && sa === 'automne') {
      const a = Math.PI - .6, cx = mod(v.x + Math.cos(a) * .07 * t, 120) + 60, cy = mod(v.y + Math.sin(a) * .07 * t, 150) + 100;   // les palombes passent sur les Landes
      for (let m = 0; m < 60; m++) oiseau(cx + (hash2(m, v.k, 130) - .5) * s * 26, cy + (hash2(v.k, m, 131) - .5) * s * 14, a, '#5a5f6a', Math.sin(t * 7 + m));
    } else if (v.sorte === 'mouettes') {
      const P = PORTS[v.k / 4 % PORTS.length | 0]; if (!P) continue;
      for (let m = 0; m < 12; m++) { const ph = t * .05 + m * .52 + v.ph, r = .25 + (m % 4) * .1; oiseau(P.x + Math.cos(ph) * r - .4, P.y + Math.sin(ph) * r * .7 - .3, ph + Math.PI / 2, '#f4f2ea', Math.sin(t * 3 + m) * .5); }
    } else if (v.sorte === 'etourneaux' && AMB.heure === 'soir' && SALINE.size) {
      const k0 = [...SALINE][v.k * 37 % SALINE.size], cx = k0 % GW + .5, cy = (k0 / GW | 0) + .5;
      for (let m = 0; m < 160; m++) { const ph = m * .7, ox = Math.sin(t * .4 + ph) * .35 + Math.sin(t * .23 + ph * 1.7) * .2, oy = Math.cos(t * .31 + ph * 1.3) * .22; oiseau(cx + ox, cy + oy, t + ph, '#2a2622', Math.sin(t * 9 + m)); }
    }
  }
}

// ---------- branchement sur la carte : sous les villes, au-dessus, puis l'air (brume, pluie, neige, nuit et lumières)
const sous0 = CARTE.sous, apres0 = CARTE.apres;
CARTE.sous = (sc, g) => {
  LUM.length = 0;
  const z = sc.z, x0 = sc.cx - sc.cssW / 2 / z - .5, x1 = sc.cx + sc.cssW / 2 / z + .5, y0 = sc.cy - sc.cssH / 2 / z - .5, y1 = sc.cy + sc.cssH / 2 / z + .5;
  traces(sc, g, x0, y0, x1, y1);
  if (AMB.ev.siege && SIEGE) siegeSol(sc, g);
  sous0(sc, g);
  peches(sc, g, x0, y0, x1, y1);
  if (z >= 30) relaisPoste(sc, g, x0, y0, x1, y1);
  if (AMB.ev.marche && z >= 40) marches(sc, g, x0, y0, x1, y1);
  if (z >= 30) contrebande(sc, g, x0, y0, x1, y1);
  if (AMB.ev.siege && SIEGE) siegeVie(sc, g, x0, y0, x1, y1);
  if (AMB.ev.bataille && BATAILLE) bataille(sc, g, x0, y0, x1, y1);
  if (AMB.ev.ennemi) pillages(sc, g, x0, y0, x1, y1);
  if (CORDOUAN && z >= 2.5) cordouan(sc, g);
  oiseaux(sc, g, x0, y0, x1, y1);
  sc.monde(g);
};
const TEINTE_HEURE = { matin: '#f6dcc6', soir: '#f2c9a2', nuit: '#5a6b9e' };
CARTE.apres = (sc, g) => { atmosphere(sc, g); apres0(sc, g); };
function atmosphere(sc, g) {
  const z = sc.z, t = sc.time, W = sc.W, H = sc.H, d = sc.d, x0 = sc.cx - sc.cssW / 2 / z - 3, x1 = sc.cx + sc.cssW / 2 / z + 3, y0 = sc.cy - sc.cssH / 2 / z - 3, y1 = sc.cy + sc.cssH / 2 / z + 3;
  sc.monde(g);
  // brume du matin sur les grands fleuves ; temps de brume : partout dans les bas-fonds
  if (AMB.heure === 'matin' || AMB.temps === 'brume') {
    for (const [x, y, h] of BRUME) { if (x < x0 - 4 || x > x1 + 4 || y < y0 - 4 || y > y1 + 4) continue; const r = 2 + h * 3; g.globalAlpha = (AMB.temps === 'brume' ? .5 : .36) * (.6 + h * .4); g.drawImage(SPR.f, x - r + Math.sin(t * .02 + h * 9) * .4, y - r * .7, r * 2, r * 1.4); }
    if (AMB.temps === 'brume') { const pas = Math.max(3, (x1 - x0) / 22); for (let y = Math.floor(y0 / pas) * pas; y < y1; y += pas) for (let x = Math.floor(x0 / pas) * pas; x < x1; x += pas) { if (alt(x, y) > .3) continue; const h = hash2(x * 3 | 0, y * 3 | 0, 132), r = pas * (.9 + h); g.globalAlpha = .3; g.drawImage(SPR.f, x - r + Math.sin(t * .015 + h * 9) * pas * .2, y - r * .7, r * 2, r * 1.4); } }
    g.globalAlpha = 1;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (AMB.temps === 'brume') { g.fillStyle = 'rgba(232,234,230,.26)'; g.fillRect(0, 0, W, H); }
  // averses : des cellules de pluie qui traversent la carte avec le vent
  if (AMB.temps === 'averses') {
    g.fillStyle = 'rgba(60,70,82,.12)'; g.fillRect(0, 0, W, H);
    for (const a of AVERSES) {
      const p = posAverse(a, t), sx = (p.x - sc.cx) * z * d + W / 2, sy = (p.y - sc.cy) * z * d + H / 2, rx = a.r * 1.4 * z * d, ry = a.r * z * d;
      if (sx + rx < 0 || sx - rx > W || sy + ry < 0 || sy - ry > H) continue;
      g.globalAlpha = .6; g.drawImage(SPR.pluie, sx - rx, sy - ry, rx * 2, ry * 2); g.globalAlpha = 1;
      const n = clamp(Math.min(rx, W) * Math.min(ry, H) / 500, 30, 700); g.strokeStyle = 'rgba(215,224,236,.6)'; g.lineWidth = d; g.beginPath();
      for (let k = 0; k < n; k++) { const an = Math.random() * TAU, rr = Math.sqrt(Math.random()), px = sx + Math.cos(an) * rx * .8 * rr, py = sy + Math.sin(an) * ry * .8 * rr; g.moveTo(px, py); g.lineTo(px - 3 * d, py + 11 * d); }
      g.stroke();
    }
  }
  // l'heure : un voile de couleur, puis les lumières
  const teinte = TEINTE_HEURE[AMB.heure];
  if (teinte) { g.globalCompositeOperation = 'multiply'; g.fillStyle = teinte; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; if (AMB.heure === 'nuit') { g.fillStyle = 'rgba(8,12,34,.18)'; g.fillRect(0, 0, W, H); } }
  const nuit = AMB.heure === 'nuit', soir = AMB.heure === 'soir', k = nuit ? 1 : soir ? .55 : 0;
  sc.monde(g); g.globalCompositeOperation = 'lighter';
  if (k) {
    // les villes s'allument : de loin un halo, de près les fenêtres le long des rues
    for (const n of GEO.nodes) {
      if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
      const R = profilVille(n, ANNEE).R / S, f = densite(n.x, n.y) > .2 || nuit ? 1 : .4;
      g.globalAlpha = .3 * k * f; g.drawImage(SPR.lueur, n.x - R * 1.8, n.y - R * 1.8, R * 3.6, R * 3.6);
      if (z >= 18) { const p = planCarte(n), r = Math.max(.004, .8 / z); g.globalAlpha = .85 * k; g.fillStyle = '#ffd58a'; g.beginPath(); for (const [lx, ly] of p.lum) { g.moveTo(lx + r, ly); g.arc(lx, ly, r, 0, TAU); } g.fill(); }
    }
    // le phare de Cordouan tourne
    if (CORDOUAN) { const { x, y } = CORDOUAN, Lb = 26, th = t * .6; for (const a of [th, th + Math.PI]) { const gr = g.createRadialGradient(x, y, 0, x, y, Lb); gr.addColorStop(0, `rgba(255,240,190,${.55 * k})`); gr.addColorStop(1, 'rgba(255,240,190,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.arc(x, y, Lb, a - .05, a + .05); g.closePath(); g.fill(); } g.globalAlpha = k; const rr = Math.max(.3, 14 / z); g.drawImage(SPR.fen, x - rr, y - rr, rr * 2, rr * 2); }
  }
  // feux, lanternes, incendies ; les éclairs des canons de jour comme de nuit
  for (const l of LUM) { if (!k && !l.jour) continue; const r = Math.max(l.r, (l.spr === 'fen' || l.petit ? 3 : 5) / z), f = .85 + .15 * Math.sin(t * 9 + l.x * 50); g.globalAlpha = l.a * (l.jour ? Math.max(k, .5) : k) * f; g.drawImage(SPR[l.spr || 'lueur'], l.x - r, l.y - r, r * 2, r * 2); }
  for (let i = ECLAIRS.length - 1; i >= 0; i--) { const e = ECLAIRS[i], a = 1 - (t - e.t0) / .2; if (a <= 0) { ECLAIRS.splice(i, 1); continue; } const r = Math.max(.04, 5 / z); g.globalAlpha = a; g.drawImage(SPR.lueur, e.x - r, e.y - r, r * 2, r * 2); }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  // la neige qui tombe
  if (AMB.temps === 'neige') { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = 'rgba(250,252,255,.85)'; g.beginPath(); for (let i = 0; i < 260; i++) { const h1 = hash2(i, 1, 133), h2 = hash2(i, 2, 133), h3 = hash2(i, 3, 133), x = mod(h1 * W + t * (12 + h3 * 18) * d + Math.sin(t + i) * 6 * d, W), y = mod(h2 * H + t * (26 + h3 * 30) * d, H), r = (1 + h3 * 1.4) * d; g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); } g.fill(); }
  sc.monde(g);
}

// ---------- les commandes : saison, heure, temps, événements, et des visites pour tout voir de près
const FONDS = new Map();
function majFond() {
  const key = AMB.saison + (AMB.temps === 'neige' ? '+n' : '');
  let c = FONDS.get(key);
  if (!c) { peindreFond(); c = document.createElement('canvas'); c.width = FOND.width; c.height = FOND.height; c.getContext('2d').drawImage(FOND, 0, 0); FONDS.set(key, c); }
  else FOND.getContext('2d').drawImage(c, 0, 0);
  CARTE.tuiles.clear();
}
const MOIS = { printemps: 'Mai 1789', ete: 'Juillet 1789', automne: 'Octobre 1789', hiver: 'Janvier 1790' }, NOM_S = { printemps: 'printemps', ete: 'été', automne: 'automne', hiver: 'hiver' }, NOM_H = { matin: 'le matin', midi: 'midi', soir: 'le soir', nuit: 'la nuit' };
function majDate() { const b = document.querySelector('#mode-carte .barre .date'); if (b) { b.querySelector('b').textContent = MOIS[AMB.saison]; b.querySelector('span').textContent = `Tour 14 · ${NOM_S[AMB.saison]} · ${NOM_H[AMB.heure]}`; } }
function regler(o) {
  const avant = AMB.saison + AMB.temps + AMB.ev.disette;
  if (o.ev) o = { ...o, ev: { ...AMB.ev, ...o.ev } };
  Object.assign(AMB, o);
  if (o.temps === 'neige') AMB.saison = 'hiver';
  if (o.saison && o.saison !== 'hiver' && AMB.temps === 'neige') AMB.temps = 'beau';
  if (AMB.saison + AMB.temps + AMB.ev.disette !== avant) majFond();
  for (const [grp, cle] of [['a-saison', 'saison'], ['a-heure', 'heure'], ['a-temps', 'temps']]) for (const b of document.querySelectorAll(`#${grp} button`)) b.setAttribute('aria-pressed', b.dataset.v === AMB[cle] ? 'true' : 'false');
  for (const b of document.querySelectorAll('#m-evts button')) b.setAttribute('aria-pressed', AMB.ev[b.dataset.v] ? 'true' : 'false');
  majDate();
}
for (const [grp, cle] of [['a-saison', 'saison'], ['a-heure', 'heure'], ['a-temps', 'temps']]) for (const b of document.querySelectorAll(`#${grp} button`)) b.onclick = () => regler({ [cle]: b.dataset.v });
for (const b of document.querySelectorAll('#m-evts button')) b.onclick = () => regler({ ev: Object.assign({}, AMB.ev, { [b.dataset.v]: !AMB.ev[b.dataset.v] }) });
// une chose qui bouge, que la caméra suit
const suivre = f => ({ get x() { return f().x; }, get y() { return f().y; } });
function cellule(pred, cx, cy) { for (let r = 0; r < 60; r++) for (let j = Math.floor(cy) - r; j <= cy + r; j++) for (let i = Math.floor(cx) - r; i <= cx + r; i++) { if (Math.max(Math.abs(i - Math.floor(cx)), Math.abs(j - Math.floor(cy))) !== r) continue; if (i >= 0 && j >= 0 && i < GW && j < GH && pred(i, j)) return { x: i + .25 + hash2(i, j, 82) * .5, y: j + .25 + hash2(j, i, 83) * .5 }; } return null; }
const nom = n => GEO.nodes.find(x => x.name === n);
const premierMalle = () => { for (const [ie, e] of GEO.edges.entries()) { if (!e.royal || e.ferry) continue; const L = e.L || (e.L = longueur(e.pts)), n = Math.ceil(L / 1.1 * (AMB.ev.marche ? 1.6 : 1)); for (let k = 0; k < n; k++) if (hash2(ie, k, 32) < .05 && hash2(ie, k, 34) <= .9) { const h = hash2(ie, k, 31), sens = h < .5 ? 1 : -1; return () => surChemin(e.pts, mod(h * L + sens * .045 * CARTE.time, L)); } } return null; };
const VISITES = [
  ['Le temps', [
    ['Brume sur la Garonne', { heure: 'matin', temps: 'beau' }, () => ({ x: 117, y: 116, z: 9 })],
    ['Averse sur les Landes', { temps: 'averses', heure: 'midi' }, () => { const a = AVERSES.reduce((b, c) => Math.abs(posAverse(c, CARTE.time).x - 110) < Math.abs(posAverse(b, CARTE.time).x - 110) ? c : b); return { suivi: suivre(() => posAverse(a, CARTE.time)), z: 5 }; }],
    ['Neige sur les Pyrénées', { saison: 'hiver', temps: 'beau', heure: 'midi' }, () => ({ x: 105, y: 300, z: 4.5 })],
    ['Hiver de neige', { temps: 'neige', heure: 'midi' }, () => ({ x: 200, y: 90, z: 14 })],
    ['Cordouan la nuit', { heure: 'nuit' }, () => CORDOUAN && { x: CORDOUAN.x + 6, y: CORDOUAN.y + 6, z: 9 }],
    ['Bordeaux la nuit', { heure: 'nuit' }, () => ({ x: 101.3, y: 104.5, z: 30 })],
    ['Vols d’oiseaux', { saison: 'automne', heure: 'midi' }, () => { const v = VOLS.find(v => v.sorte === 'palombes'); return { suivi: suivre(() => ({ x: mod(v.x + Math.cos(Math.PI - .6) * .07 * CARTE.time, 120) + 60, y: mod(v.y + Math.sin(Math.PI - .6) * .07 * CARTE.time, 150) + 100 })), z: 26 }; }],
  ]],
  ['Les pays', [
    ['Moisson', { saison: 'ete', heure: 'midi' }, () => cellule((i, j) => ter(i + .5, j + .5) === TT.PLAINE && hash2(i, j, 81) < .22 && hash2(i, j, 80) <= densite(i + .5, j + .5) && !disette(i + .5, j + .5), 110, 112), 240],
    ['Vendanges', { saison: 'automne', heure: 'midi' }, () => cellule((i, j) => ter(i + .5, j + .5) === TT.VIGNE && hash2(i, j, 81) < .45 && hash2(i, j, 80) <= densite(i + .5, j + .5), 134, 95), 240],
    ['Labours', { saison: 'automne', heure: 'midi' }, () => cellule((i, j) => ter(i + .5, j + .5) === TT.PLAINE && hash2(i, j, 81) > .8 && hash2(i, j, 80) <= densite(i + .5, j + .5), 160, 130), 240],
    ['Résiniers des Landes', { saison: 'ete', heure: 'midi' }, () => cellule((i, j) => ter(i + .5, j + .5) === TT.FORET && pinede(i + .5, j + .5) && hash2(i, j, 81) < .22 && hash2(i, j, 80) <= densite(i + .5, j + .5), 85, 170), 280],
    ['Marais salants', { saison: 'ete', heure: 'midi' }, () => { const k = [...SALINE][0]; return k != null && { x: k % GW + .5, y: (k / GW | 0) + .5, z: 70 }; }],
    ['Transhumance', { saison: 'printemps', heure: 'midi' }, () => { const f = TRANSHUMANCES[0]; return f && { suivi: suivre(() => posTrans(f, CARTE.time)), z: 230 }; }],
    ['Estives', { saison: 'ete', heure: 'midi' }, () => cellule((i, j) => (ter(i + .5, j + .5) === TT.MONTAGNE || ter(i + .5, j + .5) === TT.HAUTE) && hash2(i, j, 81) < .3 && neige(i + .5, j + .5) < .5 && hash2(i, j, 80) <= densite(i + .5, j + .5), 110, 300), 230],
    ['Loups', { saison: 'hiver', temps: 'beau', heure: 'midi' }, () => cellule((i, j) => ter(i + .5, j + .5) === TT.FORET && !pinede(i + .5, j + .5) && hash2(i, j, 81) < .1 && hash2(i, j, 80) <= densite(i + .5, j + .5), 220, 80), 230],
    ['Jour de marché', { heure: 'midi', ev: { marche: true } }, () => { const n = nom('Libourne'), p = planCarte(n), pl = p.V.lieux.place || { x: IC[0], y: IC[1] }; return { x: n.x + (pl.x - IC[0]) / S, y: n.y + (pl.y - IC[1]) / S, z: 200 }; }],
    ['Foire', { heure: 'midi', ev: { marche: true } }, () => { const n = FOIRES[0]; if (!n) return null; const Pf = profilVille(n, ANNEE), ro = Pf.routes[0], a = ro ? ro.a + .5 : 0, d = Pf.R / S * 1.2 + .15; return { x: n.x + Math.cos(a) * d, y: n.y + Math.sin(a) * d, z: 150 }; }],
    ['Malle-poste', { heure: 'midi' }, () => { const f = premierMalle(); return f && { suivi: suivre(f), z: 260 }; }],
    ['Relais de poste', { heure: 'midi' }, () => RELAIS[3] && { x: RELAIS[3].x, y: RELAIS[3].y, z: 200 }],
    ['Bois flotté', { heure: 'midi' }, () => { const r = RADEAUX[2] || RADEAUX[0]; return r && { suivi: suivre(() => surChemin(r.pts, mod(r.s0 + r.v * CARTE.time, r.L))), z: 160 }; }],
    ['Pêcheurs d’Arcachon', { heure: 'midi' }, () => { const b = PECHE[0]; return b && { x: b.x, y: b.y, z: 90 }; }],
    ['Carrelets de la Gironde', { heure: 'midi' }, () => CARRELETS[4] && { x: CARRELETS[4].x, y: CARRELETS[4].y, z: 140 }],
    ['Contrebandiers', { heure: 'midi' }, () => { const P = SENTIERS[0]; return P && { suivi: suivre(() => surChemin(P.pts, pingpong(CARTE.time * .0035 + P.ph * 50, P.L))), z: 240 }; }],
  ]],
  ['La guerre', [
    ['Bataille de Tonneins', { heure: 'midi', ev: { bataille: true } }, () => BATAILLE && { x: BATAILLE.x, y: BATAILLE.y, z: 26 }],
    ['La bataille de près', { heure: 'midi', ev: { bataille: true } }, () => BATAILLE && { x: BATAILLE.x, y: BATAILLE.y, z: 150 }],
    ['Siège de Bayonne', { heure: 'midi', ev: { siege: true } }, () => SIEGE && { x: SIEGE.x + Math.cos(SIEGE.aT) * 1.2, y: SIEGE.y + Math.sin(SIEGE.aT) * 1.2, z: 24 }],
    ['Les batteries', { heure: 'midi', ev: { siege: true } }, () => SIEGE?.batteries[2] && { x: SIEGE.batteries[2].x, y: SIEGE.batteries[2].y, z: 150 }],
    ['Réfugiés', { heure: 'midi', ev: { ennemi: true } }, () => { const a = ARMEES.find(x => x.side === 'co'); return a && { x: surChemin(a.pts, Math.min(a.L, a.s + 2.5)).x, y: surChemin(a.pts, Math.min(a.L, a.s + 2.5)).y, z: 190 }; }],
    ['Village pillé', { heure: 'midi', ev: { ennemi: true } }, () => { const v = villagesPilles()[0]; return v && { x: v.x, y: v.y, z: 40 }; }],
    ['Bivouac du soir', { heure: 'soir' }, () => { const a = ARMEES[0]; return { x: surChemin(a.pts, a.s - a.compo.long * .4).x, y: surChemin(a.pts, a.s - a.compo.long * .4).y, z: 170 }; }],
    ['Disette en Périgord', { saison: 'printemps', heure: 'midi', ev: { disette: true } }, () => ({ x: 205, y: 70, z: 40 })],
  ]],
];
{
  const zone = document.getElementById('m-vie');
  for (const [titre, liste] of VISITES) {
    const l = document.createElement('span'); l.className = 'lbl'; l.textContent = titre; zone.appendChild(l);
    for (const [nomV, reglage, ou, zz] of liste) {
      const b = document.createElement('button'); b.className = 'puce'; b.textContent = nomV;
      b.onclick = () => {
        regler({ temps: 'beau', ...reglage }); const c = ou(); if (!c) return;
        CARTE.marquer(null); CARTE.suivi = null;
        const z1 = c.z ?? zz, cible = c.suivi || c;
        CARTE.vol = { x0: CARTE.cx, y0: CARTE.cy, z0: CARTE.z, x1: cible.x, y1: cible.y, z1, k: 0, puis: c.suivi || null };
        for (const x of zone.querySelectorAll('button')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      };
      zone.appendChild(b);
    }
  }
}
majFond(); regler({});
