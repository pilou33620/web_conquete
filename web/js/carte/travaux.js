// Les travaux et les métiers de la carte vue du ciel (SPEC-CARTE-2D.md, lot H), d'après l'état de la partie :
// faubourgs qui s'agrandissent et maisons qu'on répare (file d'une place du joueur), produits de sa spécialité sur
// les quais, cordons sanitaires des villes en épidémie, grands travaux (voies ferrées en chantier, routes des Ponts et
// Chaussées, chemins de halage), routes coupées par la crue, feux de forêt des Landes l'été. Tout est tiré de la carte
// (même endroit, mêmes ouvriers) ; appelé par carte/guerre.js (Guerre.dessus), au-dessus des villes.
import { C, E, T, RR, PG, TAU, SPR, bat, cheval, clamp, mod, stere, surChemin } from './lib.js';
import { AMB, LUM, U, Z, FEU_K, feuDe, vue } from './ambiance.js';
import { terre, LARG_RIVIERE } from './terre.js';
import { CIVILS, charrette, fantassin, flamme, phase, rayonMurs, rayonPlace, vache, versMonde } from './guerre.js';
import { site } from './villes.js';

// combien de jours les grands travaux d'une technologie restent en chantier après sa découverte (me.tech_dates)
export const GRANDS_TRAVAUX = { ponts_chaussees: 180, canal: 240 };
const hash2 = (i, j, k = 0) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const longueur = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
const MAISON = [{ t: 'g', x: -6, y: -3, w: 12, h: 6, p: 'tuile', h2: 1 }];

// l'état d'une maison du faubourg en chantier, d'après l'avancement p de l'agrandissement (0 à 1) : k de 0 à n - 1
// (de la porte vers la campagne) : 'finie', 'charpente' (murs montés, échafaudage) ou 'fondations'
export const etatMaison = (k, n, p) => k / n < p - 0.3 ? 'finie' : k / n < p ? 'charpente' : 'fondations';
// les produits d'une spécialité (rules.SPECIALTY) : ce qu'on empile sur le quai ou devant la porte, et la charge des
// charrettes
export const PRODUIT = {
  grand_vin: 'barrique', vin: 'barrique', eau_de_vie: 'barrique', negoce: 'barrique', resine: 'resine', sel: 'sel', peche: 'panier',
  prune: 'caisse', terroir: 'caisse', salaisons: 'caisse', ble: 'sac', betail: 'betail', textile: 'ballot', tabac: 'tabac', forge: 'fer',
};
const CHARGE = { barrique: '#7a5532', resine: '#4e3a26', sel: '#f2f0ea', panier: '#b79a62', caisse: '#c9a878', sac: '#d9c48e', ballot: '#e8e2d0', tabac: '#a47e3a', fer: '#55585c', betail: '#c9a07a' };
function produit(g, k, i) {
  switch (k) {
    case 'barrique': case 'resine': E(g, 'rgba(20,20,10,.3)', 0.4, 0.5, 2.2, 1.5); E(g, k === 'resine' ? '#4e3a26' : '#8a6038', 0, 0, 2.2, 1.5); T(g, '#3a2a1b', 0.3, -1, -1.4, -1, 1.4); T(g, '#3a2a1b', 0.3, 1, -1.4, 1, 1.4); if (k === 'resine') C(g, '#d6a440', 0, 0, 0.5); break;
    case 'sel': C(g, 'rgba(20,20,10,.25)', 0.6, 0.7, 2.4); C(g, '#e9e7df', 0, 0, 2.4); C(g, '#fbfaf6', -0.5, -0.5, 1.2); break;
    case 'panier': C(g, '#8a6d44', 0, 0, 1.6); C(g, '#b79a62', 0, 0, 1.3); C(g, i % 2 ? '#9fb2b8' : '#c7c9c2', 0, 0, 0.8); break;
    case 'fer': RR(g, '#33363a', -2.4, -0.9, 4.8, 1.8, 0.3); RR(g, '#5d6166', -2.2, -0.7, 4.4, 0.6, 0.2); break;
    case 'tabac': RR(g, '#6b5235', -2.6, -1.6, 5.2, 3.2, 0.3); for (let j = 0; j < 3; j++) E(g, '#a47e3a', -1.6 + j * 1.6, 0, 0.7, 1.3); break;
    case 'ballot': RR(g, '#cfc8b4', -2, -1.4, 4, 2.8, 0.6); T(g, '#7a6a4f', 0.3, -0.6, -1.4, -0.6, 1.4); T(g, '#7a6a4f', 0.3, 0.8, -1.4, 0.8, 1.4); break;
    default: RR(g, 'rgba(20,20,10,.25)', -1.4, -1, 3.4, 2.4, 0.5); RR(g, CHARGE[k] || '#c9a878', -1.7, -1.2, 3.4, 2.4, 0.5);
  }
}
// une charrette chargée (k : le produit)
function charge(g, pas, k) { charrette(g, pas, k === 'barrique' || k === 'fer', 0); for (let i = 0; i < 3; i++) { g.save(); g.translate(-6 + i * 6, 0); g.scale(1.4, 1.4); produit(g, k === 'betail' ? 'sac' : k, i); g.restore(); } }
// un ouvrier (k : son habit) qui pioche, frappe ou creuse ; ext : où en est son coup (0 à 1)
const ouvrier = (g, k, ext) => { const c = CIVILS[k % CIVILS.length]; fantassin(g, c.L, { role: 'h', habit: c.habit }, { legs: null, arme: 'hache', ext }); };
const brouette = (g, k, pas) => { RR(g, '#7a5634', 1, -1.6, 5, 3.2, 0.5); RR(g, k % 2 ? '#8c7b62' : '#9a9a92', 1.5, -1.2, 4, 2.4, 0.5); C(g, '#3a2a1b', 6.5, 0, 0.8); T(g, '#6b4d31', 0.4, 1, -1.4, -1, -1.6); T(g, '#6b4d31', 0.4, 1, 1.4, -1, 1.6); const c = CIVILS[k % CIVILS.length]; fantassin(g, c.L, { role: 'h', habit: c.habit }, { legs: pas, arme: 'aucun' }); };
const tasPierres = (g, x, y, s = 1) => { C(g, 'rgba(20,20,10,.3)', x + 0.6, y + 0.7, 3 * s); C(g, '#9a958a', x, y, 3 * s); C(g, '#b8b3a6', x - 0.8, y - 0.6, 1.6 * s); C(g, '#7f7a70', x + 1, y + 0.6, 1.1 * s); };
// une maison du faubourg : fondations (le plan des murs au cordeau), murs montés sous l'échafaudage et la charpente,
// ou finie (comme les fermes des fourrageurs)
function maison(g, etat) {
  if (etat === 'finie') { bat(g, MAISON, 0, 0, 0, 1); return; }
  RR(g, '#b6a888', -6.4, -3.4, 12.8, 6.8, 0.3);
  if (etat === 'fondations') { g.strokeStyle = '#8b7d62'; g.lineWidth = 0.9; g.strokeRect(-6, -3, 12, 6); T(g, '#8b7d62', 0.6, 0, -3, 0, 3); return; }
  RR(g, '#d7ccb2', -6, -3, 12, 6, 0.2); RR(g, '#bfb497', -5.2, -2.2, 10.4, 4.4, 0.2);
  for (let x = -5; x <= 5; x += 2) T(g, '#7a5a38', 0.45, x, -3, x, 3);   // les chevrons
  T(g, '#5f4429', 0.6, -6, 0, 6, 0);
  g.strokeStyle = '#8a6a45'; g.lineWidth = 0.35; g.strokeRect(-7.2, -4.2, 14.4, 8.4);   // l'échafaudage
  for (const [x, y] of [[-7.2, -4.2], [7.2, -4.2], [-7.2, 4.2], [7.2, 4.2], [0, -4.2], [0, 4.2]]) C(g, '#5f4429', x, y, 0.45);
}
// l'échafaudage d'une maison qu'on répare et ses toits crevés
function echafaudage(g) {
  RR(g, '#6e5a46', -5, -3, 10, 6, 0.3); RR(g, '#a3442f', -5, -3, 10, 2.6, 0.2); RR(g, '#3a2e24', 1, -1, 3, 3, 0.3);
  g.strokeStyle = '#a8865a'; g.lineWidth = 0.4; g.strokeRect(-6, -4, 12, 8); g.strokeRect(-5.4, -3.4, 10.8, 6.8);
  for (let x = -6; x <= 6; x += 3) { C(g, '#5f4429', x, -4, 0.45); C(g, '#5f4429', x, 4, 0.45); }
}
// la grue de bois à roue de carrier ; a : la flèche, qui tourne doucement
function grue(g, a) {
  g.strokeStyle = '#5f4429'; g.lineWidth = 0.6; g.beginPath(); g.arc(-2, 0, 2.2, 0, TAU); g.stroke();
  for (let k = 0; k < 4; k++) T(g, '#5f4429', 0.3, -2 + Math.cos(k * 0.8) * 2.2, Math.sin(k * 0.8) * 2.2, -2 - Math.cos(k * 0.8) * 2.2, -Math.sin(k * 0.8) * 2.2);
  RR(g, '#7a5634', -1, -1, 2, 2, 0.3);
  const fx = Math.cos(a) * 11, fy = Math.sin(a) * 11;
  T(g, 'rgba(20,20,10,.3)', 1.2, 1, 1.4, fx + 1, fy + 1.4); T(g, '#8a6a45', 1, 0, 0, fx, fy); T(g, '#3a2e24', 0.2, fx, fy, fx + 0.6, fy + 1.4); RR(g, '#9a958a', fx - 0.4, fy + 1.2, 2, 1.6, 0.3);
}
function barriere(g) { for (let k = 0; k < 6; k++) T(g, k % 2 ? '#f4f1ea' : '#b8352c', 0.9, 0, -6.5 + k * 2.2, 0, -4.3 + k * 2.2); C(g, '#3a2a1b', 0, -7, 0.8); C(g, '#3a2a1b', 0, 7, 0.8); }
function rouleau(g, pas) { RR(g, '#6f6b63', -1.6, -3.2, 3.2, 6.4, 1.4); T(g, '#5b4127', 0.6, 1.6, 0, 7, 0); for (const y of [-1.8, 1.8]) { g.save(); g.translate(11, y); cheval(g, '#6b4a2c', { gait: pas, bob: 0 }); g.restore(); } }

export class Travaux {
  constructor(G) { this.G = G; this.sorties = new Map(); this.coupures = null; this.feux = null; }
  // un dessin peint une fois par échelle (Guerre.tampon), puis posé d'un drawImage : bw, bh, sa demi-étendue en unités
  pose(sc, g, x, y, a, cle, bw, bh, fn) { if (vue(sc.z, 2 * Math.max(bw, bh))) this.G.poser(sc, g, x, y, a, this.G.tampon(sc, 'T|' + cle, bw, bh, fn)); }
  // (une personne ne fait jamais un pixel à la vraie taille : de la vie, un point d'un pixel de son habit)
  ouvrier(sc, g, x, y, a, k, t) { if (!vue(sc.z, 4.3)) return this.point(sc, g, x, y, CIVILS[k % CIVILS.length].habit); const q = Math.round(mod(t * 1.1 + k * 0.37, 1) * 6) % 6; this.pose(sc, g, x, y, a, `ouv|${k % 6}|${q}`, 7, 7, gg => ouvrier(gg, k % 6, q / 6)); }
  point(sc, g, x, y, c) { const d = 1 / sc.z; sc.monde(g); g.fillStyle = c; g.fillRect(x - d / 2, y - d / 2, d, d); }
  charge(sc, g, x, y, a, pas, k) { if (!vue(sc.z, 41)) return; const q = phase(pas); this.pose(sc, g, x, y, a, `ch|${k}|${q}`, 32, 8, gg => charge(gg, q, k)); }
  // les routes qui sortent d'une place, chacune depuis la place (km) ; mêmes pour toujours
  sortiesDe(n) {
    let s = this.sorties.get(n.id);
    if (!s) {
      s = this.G.map.edges.filter(e => (e.a === n.id || e.b === n.id) && !e.water && e.kind !== 'water' && !e.ferry && e.pts.length > 1)
        .map(e => { const pts = e.a === n.id ? e.pts : e.pts.slice().reverse(); return { pts, L: longueur(pts) }; }).filter(r => r.L > 0.8);
      this.sorties.set(n.id, s);
    }
    return s;
  }
  // relevé une fois par état reçu
  releve() {
    const G = this.G, mp = G.map, st = mp.state;
    if (this.r?.st === st) return this.r;
    const me = st.me?.code, r = this.r = { st, chantiers: [], produits: [], cordons: [], rails: [], routes: [], bornes: [], halage: [], berges: [] };
    for (const n of mp.nodes) {
      const ns = st.nodes[n.id];
      if (ns.lv?.[0] === 'epidemie' && !ns.sg) r.cordons.push({ n, ns, R: null });   // (le rayon des murs, à la première vue : le choléra touche toutes les villes)
      if (ns.sg) continue;
      const k = PRODUIT[n.star?.[0]];
      // la spécialité : partout (d'après ce que la place produit) ; le niveau de la chaîne, chez le joueur seulement
      if (ns.o !== me) { if (k) r.produits.push({ n, ns, k, lvl: 1, R: null }); continue; }
      for (const q of ns.q || []) if (q.kind === 'build' && (q.what === 'dev' || q.what === 'repar')) r.chantiers.push({ n, ns, k: q.what, p: clamp(1 - q.left / (q.total || 1), 0, 1), R: null });
      const sp = ns.sl?.find(x => x[0] === 'specialite')?.[1];
      if (sp > 0 && k) r.produits.push({ n, ns, k, lvl: sp, R: null });   // (le rayon des murs, à la première vue)
    }
    // les voies ferrées en chantier (de tous les camps : la carte les montre) : la tête du chantier et le remblai devant
    const secs = mp.m?.rails?.sections;
    if (secs && st.rails?.state) for (const [sid, kind, prog] of st.rails.state) {
      const sec = kind === 'chantier' && secs.find(x => x[0] === sid);
      if (!sec || !mp.railLine) continue;
      const pts = mp.railLine(sec), L = longueur(pts), s0 = clamp(prog, 0, 1) * L;
      r.rails.push({ pts, L, s0, tete: surChemin(pts, s0) });
    }
    // les grands travaux du joueur, quelques mois après la découverte : les routes royales qu'on empierre, puis leurs
    // bornes ; le chemin de halage de la Garonne et de la Dordogne qu'on creuse, puis fini et balisé
    const td = st.me?.tech_dates || {}, age = k => td[k] ? st.t - td[k][1] : null, chez = (x, y) => { const c = mp.cellnode?.[(y | 0) * mp.W + (x | 0)]; return c != null && c !== 255 && st.nodes[c]?.o === me; };
    const pc = age('ponts_chaussees');
    if (pc != null) for (const e of mp.edges) {
      if (!e.royal || e.water || e.ferry) continue;
      const L = e.cum[e.cum.length - 1];
      if (pc < GRANDS_TRAVAUX.ponts_chaussees) { for (let s = 2.5; s < L - 1; s += 5) { const p = surChemin(e.pts, s); if (chez(p.x, p.y)) r.routes.push(p); } }
      else for (let s = 0.5; s < L - 0.5; s += 1) { const p = surChemin(e.pts, s); if (chez(p.x, p.y)) r.bornes.push(p); }
    }
    const ca = age('canal');
    if (ca != null) for (const rv of mp.m?.rivers || []) {
      if (rv.rank !== 1 || !/Garonne|Dordogne/.test(rv.name || '')) continue;
      const w = LARG_RIVIERE[1] / 2 + 0.05, fini = ca >= GRANDS_TRAVAUX.canal;
      let cur = [];
      for (let i = 1; i < rv.pts.length; i++) {
        const [ax, ay] = rv.pts[i - 1], [bx, by] = rv.pts[i], l = Math.hypot(bx - ax, by - ay); if (!l) continue;
        const nx = -(by - ay) / l, ny = (bx - ax) / l;
        for (let s = 0; s < l; s += fini ? 0.5 : 4) {
          const x = ax + (bx - ax) * s / l + nx * w, y = ay + (by - ay) * s / l + ny * w;
          if (!chez(x, y)) { if (cur.length > 1) r.halage.push(cur); cur = []; continue; }
          if (fini) cur.push([x, y]); else r.berges.push({ x, y, a: Math.atan2(by - ay, bx - ax) });
        }
      }
      if (cur.length > 1) r.halage.push(cur);
    }
    if (ca != null && ca >= GRANDS_TRAVAUX.canal) r.balises = r.halage.flatMap(h => h.filter((_, i) => i % 4 === 2));
    return r;
  }
  // les routes que la crue coupe : la liste du serveur (st.cut, [arête, début, fin] des tronçons noyés en km le long du
  // tracé ; game/crue.py, même critère que terre.js inonde), qui ralentit aussi les armées. Relevée une fois par état
  coupuresDe() {
    const mp = this.G.map, st = mp.state;
    if (this.coupures?.st === st) return this.coupures.l;
    const l = (st?.cut || []).map(([id, s0, s]) => { const e = mp.edges[id], m = surChemin(e.pts, (s0 + s) / 2); return { x: m.x, y: m.y, a: m.a, l: s - s0, avant: surChemin(e.pts, Math.max(0, s0 - 0.06)) }; });
    this.coupures = { st, l };
    return l;
  }
  // les feux de la pinède ce mois-ci (ceux qui brûlent : allumés ce mois), sur toute la carte
  feuxDe() {
    const k = AMB.annee + ':' + AMB.mois;
    if (this.feux?.k === k) return this.feux.l;
    const mp = this.G.map, T = terre(mp), l = [];
    for (let J = 0; J * FEU_K < mp.H; J++) for (let I = 0; I * FEU_K < mp.W; I++) {
      const f = feuDe(I, J, AMB.annee);
      if (f && f.m === AMB.mois && T.pinede(f.x, f.y) && [3, 4].includes(T.ter(f.x, f.y))) l.push(f);
    }
    this.feux = { k, l };
    return l;
  }

  dessiner(sc, g) {
    const G = this.G, z = sc.z, t = sc.time, r = this.releve(), pas = t * 1.7 * TAU, vie = z >= Z.VIE;
    // les feux de forêt des Landes : le panache de loin, les flammes sur la lisière de près ; la nuit, la lueur
    for (const f of this.feuxDe()) {
      if (!G.dans(sc, f.x, f.y, f.r + 4)) continue;
      LUM.push({ x: f.x, y: f.y, r: f.r * 0.8, a: 0.5, jour: true });
      sc.monde(g);
      for (let q = 0; q < 5; q++) { const d = mod(t * 0.025 + q * 0.2, 1), rr = Math.max(f.r * 0.5 + d * 2.4, (6 + d * 12) / z); g.globalAlpha = 0.55 * (1 - d); g.drawImage(SPR.n, f.x - rr + d * 3, f.y - rr - d * 1.5, rr * 2, rr * 2); }
      g.globalAlpha = 1;
      if (z >= 10) for (let k = 0; k < 14; k++) {
        const a = k * TAU / 14 + Math.sin(k * 3.1) * 0.2, d = f.r * (1 + 0.3 * Math.sin(a * 3 + Math.floor(f.x / FEU_K)) + 0.15 * Math.sin(a * 7 + Math.floor(f.y / FEU_K))), x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
        if (!G.dans(sc, x, y, 0.1)) continue;
        flamme(g, x, y, Math.max(0.01, 4 / z), t, k);   // (des flammes de 10 m sur la lisière)
        if (z >= 18 && Math.random() < 0.01) G.fumee(x, y, 0, 0, 0.03, 0.25, 12, 0.4, 'n');
      }
    }
    if (z < Z.PLAN) return;
    // le cordon sanitaire : à chaque route, hors des murs, la barrière, les gardes, le drapeau jaune (dès le plan)
    for (const c of r.cordons) {
      const n = c.n; if (!G.dans(sc, n.x, n.y, 3)) continue;
      const R = c.R ??= rayonMurs(G.map, n, c.ns) + 0.12;
      const Lg = G.look(r.st.nodes[n.id].o, 'milice');
      for (const s of this.sortiesDe(n)) {
        if (s.L < R + 0.2) continue;
        const p = surChemin(s.pts, R), nx = -Math.sin(p.a), ny = Math.cos(p.a), fx = p.x + nx * 0.008, fy = p.y + ny * 0.008;
        if (!G.dans(sc, p.x, p.y, 0.1)) continue;
        LUM.push({ x: fx, y: fy, r: Math.max(0.005, 3 / z), a: 0.8, spr: 'fen' });
        const h = Math.max(0.0025, 5 / z);   // (le drapeau jaune, sa hampe de 4 m)
        sc.monde(g); T(g, '#3a2a1b', Math.max(0.002, 1 / z), fx, fy, fx, fy - h * 1.6); PG(g, '#e8c53a', [fx, fy - h * 1.6, fx + h * (1.3 + 0.1 * Math.sin(t * 4 + n.id)), fy - h * 1.25, fx, fy - h * 0.9]);
        if (!vie) continue;
        G.figK(sc, g, p.x, p.y, p.a, 3); barriere(g);   // (la barrière sur la route, 6 m)
        if (vue(z, 4.3)) for (const o of [-9, 9]) this.pose(sc, g, ...versMonde(p.x, p.y, p.a, -3, o), p.a, Lg.cle + '|garde', 5, 5, gg => fantassin(gg, Lg, { role: 'h' }, { legs: null, arme: 'epaule' }));
      }
    }
    if (z < 40) return;
    // les chantiers des places du joueur
    for (const c of r.chantiers) {
      const n = c.n; if (!G.dans(sc, n.x, n.y, 3)) continue;
      c.R ??= rayonMurs(G.map, n, c.ns);
      if (c.k === 'dev') {
        // le faubourg qui s'agrandit, le long de la première route : six maisons de la porte vers la campagne
        const s = this.sortiesDe(n)[0]; if (!s) continue;
        for (let k = 0; k < 6; k++) {
          const d = c.R + 0.03 + (k >> 1) * 0.014; if (d > s.L - 0.1) break;   // (des maisons de 12 m, à 10 m de la route)
          const p = surChemin(s.pts, d), sg = k % 2 ? 1 : -1, nx = -Math.sin(p.a), ny = Math.cos(p.a), x = p.x + nx * 0.01 * sg, y = p.y + ny * 0.01 * sg, et = etatMaison(k, 6, c.p);
          if (!G.dans(sc, x, y, 0.1)) continue;
          this.pose(sc, g, x, y, p.a, 'maison|' + et, 50, 30, gg => { gg.scale(6.5, 6.5); maison(gg, et); });
          if (et === 'finie') continue;
          this.pose(sc, g, x - nx * 0.006 * sg, y - ny * 0.006 * sg, p.a, 'tas|stere', 48, 15, gg => { gg.scale(3, 3); tasPierres(gg, -4, 0); stere(gg, 5, 0); });
          if (vie) for (let m = 0; m < 2; m++) this.ouvrier(sc, g, ...versMonde(x, y, p.a, -8 + m * 16, -sg * 9), p.a + Math.PI / 2, k * 2 + m, t);
        }
        if (vie) { const q = surChemin(s.pts, c.R + 0.02); this.charge(sc, g, q.x, q.y, q.a, null, 'sac'); }
      } else {
        // les réparations : échafaudages sur les maisons touchées, une grue, des charrettes de pierres par les routes
        const nb = 2 + Math.round(clamp(c.ns.dg || 0.2, 0, 1) * 8), rp = rayonPlace(n, c.ns) * 0.7;
        for (let k = 0; k < nb; k++) {
          const a = hash2(n.id, k, 170) * TAU, d = Math.sqrt(hash2(n.id, k, 171)) * rp, x = site(n)[0] + Math.cos(a) * d, y = site(n)[1] + Math.sin(a) * d;
          if (!G.dans(sc, x, y, 0.1)) continue;
          this.pose(sc, g, x, y, a, 'echaf', 40, 27, gg => { gg.scale(6, 6); echafaudage(gg); });   // (une maison de 10 m)
          if (k === 0) { G.figK(sc, g, x, y, 0, 5); grue(g, 0.6 + Math.sin(t * 0.2 + n.id) * 0.9); }
          if (vie) this.ouvrier(sc, g, ...versMonde(x, y, a, 0, 12), a, k, t);
        }
        if (vie) for (const s of this.sortiesDe(n).slice(0, 2)) {
          const L = Math.min(s.L, c.R + 1.5), p = surChemin(s.pts, L - mod(t * 0.0013 + n.id, L - c.R * 0.5));
          if (G.dans(sc, p.x, p.y)) this.charge(sc, g, p.x, p.y, p.a + Math.PI, pas, 'sel');   // (des pierres de taille, blanches)
        }
      }
    }
    // les produits de la spécialité : sur le quai du port, sinon devant la porte ; les charrettes qui les emportent
    for (const P of r.produits) {
      const n = P.n; if (!G.dans(sc, n.x, n.y, 4.5) || !G.visible(n.x, n.y)) continue;
      P.R ??= rayonMurs(G.map, n, P.ns);
      const s = this.sortiesDe(n)[1] || this.sortiesDe(n)[0], L = G.lieu(n, P.ns), q = L.port ? { x: L.port[0], y: L.port[1], a: 0 } : s ? surChemin(s.pts, P.R + 0.05) : null;
      if (!q) continue;
      if (P.k === 'betail') { for (let m = 0; m < 4 * P.lvl; m++) { const x = q.x + (m % 4 - 1.5) * 0.003, y = q.y + 0.008 + (m >> 2) * 0.003; if (G.dans(sc, x, y)) { G.figK(sc, g, x, y, m, 1.45); vache(g, 0, 0, 0, m % 2 ? '#efe9dd' : '#c9a07a'); } } }
      else if (G.dans(sc, q.x, q.y, 0.1)) this.pose(sc, g, q.x, q.y, q.a, `pile|${P.k}|${P.lvl}`, 16, 4.2 * P.lvl + 8, gg => { for (let m = 0; m < 6 * P.lvl; m++) { gg.save(); gg.translate((m % 6 - 2.5) * 5, (m / 6 | 0) * 4.2 + 5); produit(gg, P.k, m); gg.restore(); } });
      if (vie && s) for (let k = 0; k < P.lvl; k++) {
        const L2 = Math.min(s.L, P.R + 3), p = surChemin(s.pts, P.R + mod(t * 0.0013 + k * 1.1 + n.id, L2 - P.R));
        if (G.dans(sc, p.x, p.y)) this.charge(sc, g, p.x, p.y, p.a, pas + k, P.k);
      }
    }
    // les grands travaux : la voie ferrée qu'on pose (le remblai devant, les terrassiers à la tête, les rails empilés)
    for (const R of r.rails) {
      const { tete: h } = R;
      if (!G.dans(sc, h.x, h.y, 1.5) || !G.visible(h.x, h.y)) continue;
      const rem = [];
      for (let s = R.s0; s <= Math.min(R.L, R.s0 + 1.2); s += 0.1) { const p = surChemin(R.pts, s); rem.push([p.x, p.y]); }
      sc.monde(g); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); rem.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = 'rgba(120,92,58,.85)'; g.lineWidth = Math.max(0.01, 4 / z); g.stroke();   // (le remblai, 10 m)
      g.strokeStyle = 'rgba(160,128,84,.9)'; g.lineWidth = Math.max(0.005, 2 / z); g.stroke();
      if (!vie) continue;
      for (let k = 0; k < 8; k++) { const p = surChemin(R.pts, R.s0 + 0.02 + k * 0.02), sg = k % 2 ? 1 : -1; const [wx, wy] = versMonde(p.x, p.y, p.a, 0, sg * 4), wa = p.a + sg * Math.PI / 2; k % 3 === 2 ? this.pose(sc, g, wx, wy, wa, `brou|${k % 6}|${phase(pas)}`, 8, 5, gg => brouette(gg, k % 6, phase(pas))) : this.ouvrier(sc, g, wx, wy, wa, k, t); }
      const b = surChemin(R.pts, Math.max(0, R.s0 - 0.06)); G.figK(sc, g, ...versMonde(b.x, b.y, b.a, 0, 9), b.a);
      for (let k = 0; k < 5; k++) RR(g, '#5b4127', -6, -2.2 + k * 1.1, 12, 0.6, 0.2);   // les traverses empilées
      RR(g, '#4a4d52', -7, 4, 14, 0.5, 0.2); RR(g, '#4a4d52', -7, 5, 14, 0.5, 0.2);
    }
    // les routes royales qu'on empierre : tas de cailloux, cantonniers qui cassent la pierre, le rouleau ; puis les bornes
    for (const p of r.routes) {
      if (!G.dans(sc, p.x, p.y, 0.2) || !G.visible(p.x, p.y)) continue;
      const nx = -Math.sin(p.a), ny = Math.cos(p.a);
      this.pose(sc, g, p.x + Math.cos(p.a) * 0.03 + nx * 0.025, p.y + Math.sin(p.a) * 0.03 + ny * 0.025, p.a, 'cailloux', 17, 4, gg => { for (let k = -1; k <= 1; k++) tasPierres(gg, k * 6.7, 0, 0.8); });
      if (!vie) continue;
      for (let k = 0; k < 3; k++) this.ouvrier(sc, g, ...versMonde(p.x, p.y, p.a, k * 6, 9), p.a - Math.PI / 2, k, t);
      const o = (mod(t * 0.01, 0.2) < 0.1 ? mod(t * 0.01, 0.1) : 0.1 - mod(t * 0.01, 0.1)) - 0.05;
      this.pose(sc, g, p.x + Math.cos(p.a) * (0.06 + o), p.y + Math.sin(p.a) * (0.06 + o), p.a, 'rouleau|' + phase(pas), 20, 6, gg => rouleau(gg, phase(pas)));
    }
    // (les bornes de 27 cm, une par kilomètre au bord de la route, les balises : jamais un pixel à leur taille ; de la vie, un point)
    if (vie) for (const p of r.bornes) if (G.dans(sc, p.x, p.y)) this.point(sc, g, p.x - Math.sin(p.a) * 0.008, p.y + Math.cos(p.a) * 0.008, '#efe9dd');
    // le chemin de halage : de la terre remuée et des terrassiers, puis le chemin fini le long de la rive, balisé
    for (const b of r.berges) {
      if (!G.dans(sc, b.x, b.y, 0.2) || !G.visible(b.x, b.y)) continue;
      this.pose(sc, g, ...versMonde(b.x, b.y, b.a, 10.5, 0), b.a, 'terre', 14, 3, gg => { for (let k = 0; k < 4; k++) { C(gg, '#8a6d44', k * 7 - 10.5, 0, 2.6); C(gg, '#a3845a', k * 7 - 11.1, -0.6, 1.4); } });
      if (vie) for (let k = 0; k < 4; k++) { const [wx, wy] = versMonde(b.x, b.y, b.a, k * 7 + 3, 5), wa = b.a + Math.PI / 2; k % 2 ? this.pose(sc, g, wx, wy, wa, `brou|${k}|${phase(pas)}`, 8, 5, gg => brouette(gg, k, phase(pas))) : this.ouvrier(sc, g, wx, wy, wa, k, t); }
    }
    if (r.halage.length) {
      sc.monde(g); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(214,196,150,.85)'; g.lineWidth = Math.max(0.003, 1.5 / z);   // (le chemin de halage, 3 m)
      for (const h of r.halage) { g.beginPath(); h.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
      if (vie) for (const [x, y] of r.balises || []) if (G.dans(sc, x, y)) this.point(sc, g, x, y, '#c0392b');
    }
    // la crue coupe les routes : l'eau sur la chaussée ; de près, une charrette arrêtée devant
    for (const c of this.coupuresDe()) {
      if (!G.dans(sc, c.x, c.y, c.l)) continue;
      sc.monde(g); E(g, 'rgba(78,124,160,.9)', c.x, c.y, c.l / 2 + 0.03, Math.max(0.02, 4 / z), c.a);   // (l'eau sur 40 m de large)
      if (!vie) continue;
      const p = c.avant; if (vue(z, 41)) { G.figK(sc, g, p.x, p.y, p.a); charrette(g, null, true, 1); }
      G.figK(sc, g, ...versMonde(p.x, p.y, p.a, 4, 7), p.a); fantassin(g, CIVILS[1].L, { role: 'h', habit: CIVILS[1].habit }, { legs: null, arme: 'aucun' });
    }
  }
}
