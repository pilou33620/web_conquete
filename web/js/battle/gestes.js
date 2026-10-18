// Vue tactique : les gestes des hommes. Logique pure, sans Three.js (bancs : tests/gestes.test.mjs). Les animations
// sont précalculées (dev/cuire.mjs, web/anims/soldat.*) ; troupes.js écrit dans les attributs de chaque figurine le
// geste choisi ici, et le vertex shader le joue.
import { hash, wrapAngle, clsOf } from './formes.js';

// geste d'un homme du rang selon l'activité de son régiment
const GESTE = { repos: 'repos', marche: 'marche', charge: 'charge', deroute: 'course', ralliement: 'trot', feu: 'joue', recharge: 'recharge', melee: 'estoc' };
// officiers, tambours, porte-drapeau : ni fusil en joue ni baïonnette
const CADRE = { repos: 'repos', marche: 'marche', charge: 'course', deroute: 'course', ralliement: 'trot', feu: 'repos', recharge: 'repos', melee: 'repos' };

// un régiment se déplace-t-il vers sa position suivante, ou tourne-t-il sur place (conversion) ? Ses hommes marchent
// alors, au lieu de glisser
export const moves = un => !!(un.from && un.to) && (Math.hypot(un.to.x - un.from.x, un.to.y - un.from.y) > 0.3 || Math.abs(wrapAngle(un.to.dir - un.from.dir)) > 0.05);

// activité d'un régiment : son état, ou la marche s'il se déplace sans charger ni se battre (le serveur fait avancer
// une charge et la met en mêlée dans le même pas : c'est le choc) ; fuyards arrêtés et régiment qui se reforme sur
// place (ralliement : 60 s sans bouger) : au repos
export function activity(un, moving) {
  const s = un.state;
  if (s === 'deroute' || s === 'ralliement') return moving ? s : 'repos';
  return moving && s !== 'charge' && s !== 'melee' ? 'marche' : s;
}

// geste d'une figurine (kind : sorte de troupes.js) pour une activité
export function gesture(act, kind) {
  const cadre = kind === 'officier' || kind === 'tambour' || kind === 'drapeau';
  if (kind === 'officier' && (act === 'repos' || act === 'feu' || act === 'recharge')) return 'parle';
  return (cadre ? CADRE : GESTE)[act] ?? 'repos';
}

// instant du coup dans « salve » et « salve-genou », et leur durée (s depuis leur début : épauler, viser, le coup,
// recharger ; dev/cuire.mjs)
export const SALVE_FEU = 0.7, SALVE_DUREE = 4.3;

// la salve se joue-t-elle encore à l'instant now (le dernier homme a fini de recharger après la fin du roulement) ?
export const firing = (volley, now) => !!volley && now <= volley.t + volley.dur + SALVE_DUREE;

// geste d'un homme et son début (horloge des effets) : [nom, début]. act, actT : activité du régiment et son début ;
// now : l'instant ; rank : son rang (0 le premier) ; u : sa place le long du front de largeur w ; phase : son décalage
// (s) dans les gestes en boucle ; volley : la dernière salve du régiment (effets.js : t, roll, dur) ; moving : le
// régiment se déplace
export function pick({ act, actT, now, kind, rank, u, w, form, phase, volley, moving, shots }) {
  const loop = name => [name, actT - phase];
  if (kind === 'servant') return serve(act, rank, now, shots, moving, loop);
  if (kind === 'cavalier' || kind === 'chef') return loop(act === 'charge' ? 'selle-sabre' : act === 'melee' ? 'selle-combo' : 'selle');
  if (kind === 'tambour') return loop(act === 'marche' || act === 'charge' || act === 'ralliement' ? 'tambour-marche' : act === 'deroute' ? 'course' : 'tambour');
  if (kind === 'officier' && act === 'melee') return loop('escrime');
  if (kind === 'officier' && (act === 'feu' || act === 'recharge')) return loop('garde');
  // piquiers (avant la baïonnette) : la pique dressée, comme la hampe du drapeau ; croisée (le geste du fusil) à la
  // charge, en mêlée et en carré, face à l'extérieur ; ils ne tirent pas
  if (kind === 'piquier') {
    if (act === 'melee') return loop(Math.floor(phase * 2) % 2 ? 'estoc' : 'poussee');
    if (act === 'charge') return loop('charge');
    if (form === 'carre' && act !== 'marche' && act !== 'deroute') return loop('joue');
    return loop(gesture(act, 'drapeau'));
  }
  // mêlée : estoc ou poussée selon l'homme, chacun à son rythme
  if (act === 'melee' && kind !== 'drapeau') return loop(Math.floor(phase * 2) % 2 ? 'estoc' : 'poussee');
  // (une salve tirée à l'arrêt se joue même si l'état n'est pas « feu » : la maquette tire sans changer d'état)
  const tir = act === 'feu' || act === 'recharge' || (act === 'repos' && firing(volley, now));
  if (kind === 'officier' || kind === 'drapeau' || !tir) return loop(gesture(act, kind));
  if (form === 'tirailleurs') return loop('feu-libre');
  if (rank >= 2 || rank < 0) return loop('repos');
  const genou = rank === 0 && form === 'ligne' && !moving;
  // la salve roule d'un bout à l'autre du front : chaque file tire à son tour
  if (firing(volley, now)) {
    const at = volley.t + volley.dur * (volley.roll > 0 ? u / w + 0.5 : 0.5 - u / w);
    return [genou ? 'salve-genou' : 'salve', at - SALVE_FEU];
  }
  return loop(act === 'recharge' ? 'recharge' : genou ? 'genou' : 'joue');
}

// servants d'une pièce (rang 200 + 10 × pièce + rôle : 1 écouvillon, 2 porteur, 3 pointeur, 4 boutefeu, 0 chef de
// pièce) : ils s'affairent SERVICE s après le dernier coup de leur pièce (shots : instant du dernier coup de chaque
// pièce, effets.js), le boutefeu touche la lumière à l'instant du coup ; en route, ils marchent
export const BOUTEFEU_FEU = 0.3;
const SERVICE = 8;
function serve(act, rank, now, shots, moving, loop) {
  if (rank < 200 || moving || (act !== 'repos' && act !== 'feu' && act !== 'recharge')) return loop(gesture(act, 'inf'));
  const k = Math.floor((rank - 200) / 10), role = (rank - 200) % 10, shot = shots?.[k] ?? -99;
  if (role === 4) return ['boutefeu', shot - BOUTEFEU_FEU];
  if (role === 3) return loop('pointer');
  if (act !== 'feu' && act !== 'recharge' && now - shot > SERVICE) return loop('repos');
  return loop(role === 1 ? 'refouler' : role === 2 ? 'porter' : 'parle');
}
// une pièce de la batterie est-elle encore en action à l'instant now ?
export const serving = (shots, now) => Object.values(shots || {}).some(t => now - t <= SERVICE);

// variété d'un homme, tirée une fois pour toutes (seed : son régiment ; i : son numéro) : place (m, le long du front et
// vers l'avant), sens (rad), taille, nuance de l'habit (teinte, saturation, clarté), rythme dans les gestes en boucle,
// délai (s) avant de changer de geste : les hommes ne sont pas des clones
export function variety(seed, i) {
  const r = k => hash(i, k, seed), c = k => r(k) - 0.5;
  return { du: c(1) * 0.3, dv: c(2) * 0.3, da: c(3) * 0.2, size: 0.95 + r(4) * 0.1, hue: c(5) * 0.02, sat: c(6) * 0.14,
    light: c(7) * 0.08, speed: 0.94 + r(8) * 0.12, delay: r(9) * 0.4 };
}

// attributs d'un homme : aGest (geste, son début, geste d'avant, son début) et aMix (instant du fondu, vitesses du geste
// et du geste d'avant). cur, prev : [numéro du geste, début] (prev null : pas de fondu) ; switchT : instant du
// changement, retardé du délai de l'homme ; v : sa variété ; loopOf(numéro) : geste en boucle (joué à son rythme)
export function rows(cur, prev, switchT, v, loopOf) {
  const sp = id => (loopOf(id) ? v.speed : 1), p = prev ?? cur;
  return [[cur[0], cur[1], p[0], p[1]], [prev ? switchT + v.delay : -99, sp(cur[0]), sp(p[0]), 0]];
}

// les k figurines qui tombent quand le régiment perd des hommes (figs : sa disposition, [u, v, sorte, …, rang]) : sous
// la mousqueterie, surtout le premier rang, puis le deuxième ; l'encadrement plus rarement. Tirage pondéré sans remise
// (la plus forte clé hash^(1/poids)), le même pour la même graine
export function chooseDead(figs, k, seed) {
  const weight = r => (r === 0 ? 3 : r === 1 ? 2 : r > 1 ? 1 : 0.5);
  return figs.map((f, i) => [Math.pow(hash(i, 17, seed) || 1e-9, 1 / weight(f[5])), i]).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i);
}

// file de cap éléments au plus : ajoute item ; renvoie les plus anciens qui en sortent (tous ceux de trop si cap a
// baissé : la qualité est descendue)
export function pushRing(ring, cap, item) {
  ring.push(item);
  return ring.splice(0, Math.max(0, ring.length - cap));
}

// distance du point (px, py) au segment de (ax, ay) à (bx, by)
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// les k figurines les plus proches de la trajectoire d'un boulet, du point a au point b ([u, v] dans le repère du
// régiment) : il couche une file
export function chooseLine(figs, k, a, b) {
  return figs.map((f, i) => [segDist(f[0], f[1], a[0], a[1], b[0], b[1]), i]).sort((p, q) => p[0] - q[0]).slice(0, k).map(([, i]) => i);
}

// d'une disposition à la suivante (figurines [u, v, sorte, …, rang]) : pour chaque nouvelle figurine, l'ancienne qui
// prend sa place, ou -1. Même sorte, file par file de gauche à droite (puis par rang) : celui de gauche reste à gauche,
// même quand le nombre de rangs change (ligne → colonne) ; skip : anciennes à écarter (les tués)
export function matchSlots(old, next, skip = new Set()) {
  const order = figs => (a, b) => figs[a][0] - figs[b][0] || figs[a][5] - figs[b][5];
  const A = {}, B = {}, m = next.map(() => -1);
  old.forEach((f, i) => { if (!skip.has(i)) (A[f[2]] ??= []).push(i); });
  next.forEach((f, j) => (B[f[2]] ??= []).push(j));
  for (const [kind, js] of Object.entries(B)) {
    const is = (A[kind] ?? []).sort(order(old));
    js.sort(order(next)).forEach((j, n) => { if (n < is.length) m[j] = is[n]; });
  }
  return m;
}

// un homme pris dans un bâtiment (rectangles orientés {x, y, w, h, a}, élargis de margin) en sort par le bord le plus
// proche ; dehors, il ne bouge pas. Le shader des troupes fait de même (troupes.js, pushOut)
export function pushOut(x, y, rects, margin) {
  for (const b of rects) {
    const ca = Math.cos(b.a || 0), sa = Math.sin(b.a || 0), dx = x - b.x, dy = y - b.y;
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca, hu = b.w / 2 + margin, hv = b.h / 2 + margin;
    if (Math.abs(u) >= hu || Math.abs(v) >= hv) continue;
    const [nu, nv] = hu - Math.abs(u) < hv - Math.abs(v) ? [Math.sign(u || 1) * hu, v] : [u, Math.sign(v || 1) * hv];
    x = b.x + nu * ca - nv * sa; y = b.y + nu * sa + nv * ca;
  }
  return [x, y];
}

// en mêlée, l'adversaire d'un régiment : le régiment ennemi en mêlée le plus proche (à moins de max m), ou null (le
// serveur ne donne la cible qu'à son propre camp)
export function foeOf(un, units, max = 120) {
  let best = null, bd = max;
  for (const e of units) {
    if (e.side === un.side || e.state !== 'melee') continue;
    const d = Math.hypot(e.x - un.x, e.y - un.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// mêlée : un homme de rang rank avance vers l'ennemi (dir : sa direction dans le repère du régiment, [du, dv] unitaire)
// et se tourne vers lui ; les premiers rangs se mêlent sur le front de contact sans traverser le régiment. r : son
// hasard (0 à 1). Renvoie [décalage u, décalage v, sens]
export function scrum(rank, dir, r) {
  const push = (rank === 0 ? 3 : rank === 1 ? 1.8 : rank === 2 ? 0.8 : 0) * (0.7 + 0.6 * r);
  return [dir[0] * push, dir[1] * push, Math.atan2(dir[0], dir[1]) + (r - 0.5) * 0.6];
}

// de loin, les figurines d'un régiment grossissent par paliers (×1 à ×3) pour faire au moins FIG_PX px de haut à
// l'écran ; elles sont alors moins nombreuses (k² hommes par figurine en plus). px : hauteur d'une figurine sans
// agrandissement ; prev : palier d'avant, gardé tant qu'il donne de 85 % à 125 % de la hauteur voulue (pas de bascule)
const PALIERS = [1, 1.25, 1.6, 2, 2.5, 3], FIG_PX = 12;
export function scaleAt(px, prev = 1) {
  const k = PALIERS.find(p => px * p >= FIG_PX) ?? PALIERS.at(-1);
  return k !== prev && PALIERS.includes(prev) && px * prev >= FIG_PX * 0.85 && px * prev <= FIG_PX * 1.25 ? prev : k;
}

// poudre sans fumée (poudre B de Vieille, 1886 ; SPEC-TECH.md) : l'infanterie la reçoit avec son fusil Lebel (arme 7),
// l'artillerie et les mitrailleuses dès que leur camp la fabrique (marque « sans_fumee », rules.VISUALS)
export function smokeless(un, marks) {
  if (clsOf(un) === 'artillerie') return !!marks?.[un.side]?.includes('sans_fumee');
  return clsOf(un) === 'inf' && (un.arm ?? 0) >= 7;
}
