// Mesure des aberrations des villes et des chemins sur la carte de campagne (rapport : analyse-villes-chemins.md).
// Pas un banc (node --test ne le prend pas) : un compte, sans affichage, sur une carte réelle exportée par carte_json.
//     bin/carte_json 2 > /tmp/c2.json && node tests/mesure-villes-chemins.mjs /tmp/c2.json
// A : les tracés des routes du moteur Rust (geo.rs, client_payload), communs à tous les rendus (plateau, carte 2D, passants).
// B : le plateau d'hexagones (hex/plateau.js, placer ; hex/carte-moteur.js, routesDe), en hexagones de 4 cases.
import { readFileSync } from 'node:fs';
import { Niveau, indexEn, routesDe } from '../web/js/hex/carte-moteur.js';
import { Plateau } from '../web/js/hex/plateau.js';

const m = JSON.parse(readFileSync(process.argv[2]));
const b64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
const W = m.W, H = m.H, terrain = b64(m.terrain), km = +(111.32 / m.KY).toFixed(2);
const nodes = m.nodes, edges = m.edges.filter(e => e.kind !== 'water');
const nom = n => nodes[n]?.name, out = [], ex = (k, v) => { if ((ex[k] ||= []).length < 4) ex[k].push(v); };
const ligne = (k, v, note = '') => out.push(`${k.padEnd(48)} ${String(v).padStart(7)}  ${note}`);
const ter = (x, y) => terrain[Math.floor(y) * W + Math.floor(x)] ?? 0;
const f1 = v => v.toFixed(1);
console.log(`carte ${process.argv[2]} : ${W} × ${H} cases de ${km} km, ${nodes.length} places, ${edges.length} routes`);

// ---------------------------------------------------------------- A. tracés des routes (geo.rs)
let bouts = 0, zig = 0, eau = 0, eauLong = 0, sansPontR = [0, 0, 0, 0], ponts = 0;
for (const e of edges) {
  const P = e.pts, A = nodes[e.a], B = nodes[e.b];
  if (Math.hypot(P[0][0] - A.x, P[0][1] - A.y) > 0.3 || Math.hypot(P.at(-1)[0] - B.x, P.at(-1)[1] - B.y) > 0.3) { bouts++; ex('bouts', `${nom(e.a)}–${nom(e.b)}`); }
  for (let i = 1; i < P.length - 1; i++) {
    const ax = P[i][0] - P[i - 1][0], ay = P[i][1] - P[i - 1][1], bx = P[i + 1][0] - P[i][0], by = P[i + 1][1] - P[i][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la > 0.05 && lb > 0.05 && (ax * bx + ay * by) / la / lb < -0.87) { zig++; ex('zig', `${nom(e.a)}–${nom(e.b)} (${f1(P[i][0])}, ${f1(P[i][1])})`); }
  }
  // sur l'eau (mer, étang, lac) : hors du premier et du dernier km (les ports), hors des bacs
  if (!e.ferry) {
    let run = 0, d = 0;
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i], l = Math.hypot(bx - ax, by - ay), nb = Math.ceil(l / 0.2);
      for (let s = 0; s < nb; s++, d += l / nb) {
        const x = ax + (bx - ax) * s / nb, y = ay + (by - ay) * s / nb, bord = d < 1 || e.len - d < 1;
        if (!bord && ter(x, y) <= 1) run += l / nb;
        else { if (run > 0.3) { eau++; if (run > 1) { eauLong++; ex('eau', `${nom(e.a)}–${nom(e.b)} (${f1(x)}, ${f1(y)}) ${f1(run)} cases`); } } run = 0; }
      }
    }
  }
}
// rivières franchies : intersection du tracé et des rivières ; pontée si un pont du serveur (bx, ponts) est à moins de 1,5 case
const inter = (p, q, r, s) => {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (!d) return null;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] : null;
};
const boite = P => [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))];
const rivs = m.rivers.map(r => ({ ...r, b: boite(r.pts) }));
for (const e of edges) {
  const b = boite(e.pts), pp = [...(e.bx != null ? [[e.bx, e.by]] : []), ...(e.ponts || [])];
  for (const r of rivs) {
    if (r.b[0] > b[2] || r.b[2] < b[0] || r.b[1] > b[3] || r.b[3] < b[1]) continue;
    for (let i = 1; i < e.pts.length; i++) for (let j = 1; j < r.pts.length; j++) {
      const x = inter(e.pts[i - 1], e.pts[i], r.pts[j - 1], r.pts[j]);
      if (!x) continue;
      if (Math.hypot(x[0] - nodes[e.a].x, x[1] - nodes[e.a].y) < 1.5 || Math.hypot(x[0] - nodes[e.b].x, x[1] - nodes[e.b].y) < 1.5) continue;   // (dans la ville)
      if (pp.some(p => Math.hypot(p[0] - x[0], p[1] - x[1]) < 1.5)) ponts++;
      else { sansPontR[r.rank]++; if (r.rank <= 2) ex('riv' + r.rank, `${nom(e.a)}–${nom(e.b)} × ${r.name} (${f1(x[0])}, ${f1(x[1])})`); }
    }
  }
}
// routes en double : deux routes qui vont côte à côte (0,05 à 0,5 case, parallèles) sur plus de 2 cases sans se confondre
const pas = 0.25, grille = new Map(), cle = (x, y) => `${Math.floor(x)},${Math.floor(y)}`, ech = [];
edges.forEach((e, k) => { for (let i = 1; i < e.pts.length; i++) {
  const [ax, ay] = e.pts[i - 1], [bx, by] = e.pts[i], l = Math.hypot(bx - ax, by - ay), nb = Math.max(1, Math.ceil(l / pas));
  for (let s = 0; s < nb; s++) { const p = { k, x: ax + (bx - ax) * s / nb, y: ay + (by - ay) * s / nb, dx: (bx - ax) / l, dy: (by - ay) / l }; ech.push(p); const c = cle(p.x, p.y); if (!grille.has(c)) grille.set(c, []); grille.get(c).push(p); }
} });
const doubles = new Map();
for (const p of ech) {
  let bon = false;
  const fx = Math.floor(p.x), fy = Math.floor(p.y);
  for (let a = -1; a <= 1 && !bon; a++) for (let b = -1; b <= 1 && !bon; b++) for (const q of grille.get(`${fx + a},${fy + b}`) || []) {
    if (q.k === p.k) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > 0.05 && d < 0.5 && Math.abs(p.dx * q.dx + p.dy * q.dy) > 0.95 && !(grille.get(cle(p.x, p.y)) || []).some(r => r.k === q.k && Math.hypot(r.x - p.x, r.y - p.y) < 0.03)) { bon = true; const kk = Math.min(p.k, q.k) + '|' + Math.max(p.k, q.k); doubles.set(kk, (doubles.get(kk) || 0) + pas); }
  }
}
const dbl = [...doubles].filter(([, l]) => l > 2 * 2);   // (compté des deux côtés)
for (const [kk, l] of dbl.sort((a, b) => b[1] - a[1])) { const [i, j] = kk.split('|').map(Number); ex('dbl', `${nom(edges[i].a)}–${nom(edges[i].b)} // ${nom(edges[j].a)}–${nom(edges[j].b)} : ${f1(l / 2)} cases`); }
out.push('A. tracés des routes (geo.rs)');
ligne('route qui ne part pas de sa place (> 0,3 case)', bouts);
ligne('aller-retour (virage de plus de 150°)', zig);
ligne('passage sur l’eau (> 0,3 case, hors bac et ports)', eau, `dont ${eauLong} de plus d’une case`);
ligne('rivière franchie avec pont du serveur', ponts);
ligne('rivière franchie sans pont (rang 1 / 2 / 3)', sansPontR.slice(1).join(' / '), '(rang 3 : gués possibles)');
ligne('routes en double (côte à côte > 2 cases)', dbl.length);

// ---------------------------------------------------------------- B. plateau d'hexagones (4 cases)
const mp = { W, H, terrain, playable: new Uint8Array(W * H).fill(1), m, nodes: m.nodes, edges: m.edges };
const N = new Niveau(mp, 4), g = N.g, pl = Object.create(Plateau.prototype);
pl.mp = mp; pl.placer(N);
let tombees = 0, deplacees = 0, loin = 0;
for (const n of nodes) {
  const p = N.places.get(n.id), h = indexEn(g, n.x, n.y);
  if (!p) { tombees++; ex('tombee', `${n.name} (${n.type})`); continue; }
  if (p.hex[0] !== h) { deplacees++; const t = g.liste[p.hex[0]], d = Math.hypot(t.gx - n.x, t.gy - n.y); if (d > 4) { loin++; ex('loin', `${n.name} ${f1(d * km)} km`); } }
}
const avant = !N.routes, { paires, sansPont } = N.routes || routesDe(N, m.edges, N.places);   // (avant : le plateau ne traçait pas de routes)
const sansPontV = avant ? new Set([...sansPont].filter(h => !N.ville.has(h))) : sansPont;
const liens = new Map(); for (const [a, b] of paires) for (const [x, y] of [[a, b], [b, a]]) { if (!liens.has(x)) liens.set(x, new Set()); liens.get(x).add(y); }
const coeurs = new Set([...N.places.values()].map(p => p.hex[0]));
let fermesRoute = 0, foret = 0, mont = 0, pontsP = 0, pontsVille = 0, culs = 0;
for (const [k, cle2] of N.campagne) if (liens.has(k)) { fermesRoute++; ex('ferme', `${cle2} (${f1(g.liste[k].gx)}, ${f1(g.liste[k].gy)})`); }
for (const [h, l] of liens) {
  if (N.foret[h] || N.arbres[h] >= 3) foret++;
  if (N.terrain[h] === 6) { mont++; ex('mont', `(${f1(g.liste[h].gx)}, ${f1(g.liste[h].gy)})`); }
  if (N.riviere[h] && !sansPontV.has(h)) { if (N.ville.has(h)) pontsVille++; else pontsP++; }
  if (l.size === 1 && !coeurs.has(h)) { culs++; ex('cul', `(${f1(g.liste[h].gx)}, ${f1(g.liste[h].gy)})`); }
}
out.push('B. plateau (hexagones de 4 cases)');
ligne('places non bâties (tombées)', tombees, `sur ${nodes.length}`);
ligne('places bâties hors de leur hexagone', deplacees, `dont ${loin} à plus de 4 cases`);
ligne('routes tracées par le plateau (paires)', avant ? 0 : paires.length, avant ? `(aucune ; ${paires.length} paires possibles)` : '');
ligne('ferme ou moulin sur une route', fermesRoute, `sur ${N.campagne.length}`);
ligne('route en forêt (arbres sur la route)', foret);
ligne('route dans un massif de montagne', mont);
ligne('pont du moteur hors des places', pontsP, `; sans pont (longée, bac) : ${[...sansPontV].filter(h => liens.has(h) && !N.ville.has(h)).length}`);
ligne('pont du moteur dans une place', pontsVille);
ligne('route qui finit dans le vide (cul-de-sac)', culs);
console.log(out.join('\n'));
for (const [k, v] of Object.entries(ex)) if (Array.isArray(v)) console.log(`  ex. ${k} : ${v.join(' ; ')}`);

// ---------------------------------------------------------------- C. carte classique (secours sans WebGL) : plans des villes
// carte/villes.js dessine les plans à l'échelle du km ; la carte ne dit pas au client la taille de ses cases (km_case de
// geo.rs) : sur l'Europe (5 km), un plan y est 5 fois trop grand. Compte des plans qui débordent sur celui d'une voisine.
{
  const ctx = new Proxy(function () {}, { get: (o, k) => (k === 'canvas' ? {} : k === Symbol.toPrimitive ? () => 0 : ctx), apply: () => ctx, set: () => true });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  globalThis.Path2D = class { moveTo() {} arc() {} lineTo() {} };
  const V = await import('../web/js/carte/villes.js'), K = V.carteDe(m);
  const r = nodes.map(n => V.profilVille(K, n, { annee: 1789 }).R / 180);   // (rayon du plan, en unités de la carte)
  let chev = 0;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
    if (d < r[i] + r[j]) { chev++; ex('chev', `${nodes[i].name}/${nodes[j].name} ${f1(d * km)} km pour ${f1((r[i] + r[j]) * km)} km de plans`); }
  }
  console.log('C. carte classique (sans WebGL)');
  console.log(`${'plans de ville qui se chevauchent (paires)'.padEnd(48)} ${String(chev).padStart(7)}  rayon médian ${f1(r.slice().sort((a, b) => a - b)[r.length >> 1] * km)} km`);
  console.log(`  ex. chev : ${(ex.chev || []).join(' ; ')}`);
}
