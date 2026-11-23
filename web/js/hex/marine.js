// La marine sur le plateau (SPEC-EMPIRE, modules 2 et 3, page P2) : traduit l'état du jeu pour graphismes/rendu/marine.js
// de web_engine, qui dessine tout (navires, flottes, bataille navale, blocus, comptoirs, balises des routes maritimes).
// Ce fichier ne dessine rien et n'importe pas three.js (testé par tests/marine.test.mjs).
//
// - Cases : le jeu compte en cases [x, y] (1 km en Aquitaine, 5 km sur les théâtres et la carte Monde) ; marine.js compte
//   en indices de case du moteur, ceux de la fenêtre que le plateau a bâtie autour de la caméra (hex/plateau.js). Une
//   flotte hors de la fenêtre n'est pas montrée ; une case de mer tombée sur un hexagone de terre (côte, estuaire) passe
//   à l'hexagone d'eau voisin le plus proche.
// - Camps : marine.js numérote les royaumes, le joueur est le 0 (ses armées embarquent sous nos yeux) ; 99 : sans camp.
// - Ports : les places portuaires de la fenêtre et leur bâtiment `port` (chaîne `port`, module 4) : marine.js y range
//   les flottes à quai, flanc au quai ; un blocus {flotte, ville, lieu} devient {par, ville, case} (case : l'hexagone de
//   la place, les navires du blocus mouillent en arc devant elle).
// - Mois joué : une flotte qui a changé de case (ordre du joueur, tour des IA) la parcourt par un chemin d'hexagones
//   d'eau (jouerMoisMarine), une bataille navale réglée sans le joueur y tonne ; l'état suivant n'est posé (majMarine)
//   qu'à la fin de l'animation, sans quoi les navires coulés disparaîtraient avant de couler.
// - Commerce (module 7, pages P3 et P4) : comptoirs de l'état (marchands et camp de chacun, disputé), routes commerciales
//   (`routes_mer` : chemins de cases → hexagones de la fenêtre, coupées en rouge), traversées de tous les camps (vue
//   `departs` / `arrivees` du moteur, chacune jouée une fois) : une flotte qu'on voyait gagne la balise de sa route et
//   s'éloigne vers l'horizon (ordre `route`), une autre part de la balise (`departs` de jouerMoisMarine) ; une flotte qui
//   arrive surgit de l'horizon (`arrivees`) ; balises et flottes vont du côté du théâtre de destination (carte Monde :
//   `md.theatres`) ; un marchand pris par un corsaire (le joueur l'est ou le subit : événement `corsaire` du moteur) se
//   joue en abordage (`abordages`).
// - Une flotte qui sort de la fenêtre ou y entre suit son chemin jusqu'au bord (cases négatives, `sortie` / `entree`).
import { indexEn } from './carte-moteur.js';
import { DIRS } from './grille.js';

export const epoqueDe = an => an < 1750 ? 'ancien' : an < 1789 ? 'lumieres' : an < 1816 ? 'empire' : 'industrie';
const DUREE = 2800;   // ms : le mois des flottes (comme les armées, map.js setState : 0,8 à 3,5 s)

// les voisins d'un hexagone de la grille entière (indices), par le calcul (comme carte-moteur.js routesDe)
function vois(g, h) {
  const t = g.liste[h], o = [];
  for (const [a, b] of DIRS) { const r = t.r + b, c = t.q + a + (r - (r & 1)) / 2; if (r >= 0 && r < g.rows && c >= 0 && c < g.cols) o.push(r * g.cols + c); }
  return o;
}

// L'hexagone (grille entière du niveau N) d'une case de mer [x, y] du jeu : celui de son centre s'il est d'eau, sinon le
// voisin d'eau le plus proche (sinon celui du centre) ; −1 hors de la grille.
export function hexEau(N, x, y) {
  const cx = x + 0.5, cy = y + 0.5, h = indexEn(N.g, cx, cy);
  if (h < 0 || N.estEau(h)) return h;
  let best = h, bd = Infinity;
  for (const v of vois(N.g, h)) {
    const t = N.g.liste[v], d = Math.hypot(t.gx - cx, t.gy - cy);
    if (N.estEau(v) && d < bd) { bd = d; best = v; }
  }
  return best;
}

// Un chemin d'hexagones d'eau de a à b (grille entière, a et b compris), en largeur, borné à `max` hexagones visités ;
// null s'il n'y en a pas (la flotte saute alors à sa case).
export function trajetEau(N, a, b, max = 4000) {
  if (a === b) return [a];
  const prev = new Map([[a, -1]]), file = [a];
  for (let i = 0; i < file.length && prev.size < max; i++) {
    for (const v of vois(N.g, file[i])) {
      if (prev.has(v) || (v !== b && !N.estEau(v))) continue;
      prev.set(v, file[i]);
      if (v === b) { const ch = []; for (let k = b; k >= 0; k = prev.get(k)) ch.unshift(k); return ch; }
      file.push(v);
    }
  }
  return null;
}

// La direction [dx, dz] (x vers la droite, z vers le bas, comme les cases) du centre du théâtre de la carte Monde
// (md.theatres, cadre [x, y, largeur, hauteur]) qui contient la case b, vue de la case a ; null sans théâtre (Aquitaine, Europe).
export function versTheatre(md, a, b) {
  const t = b && (md.theatres || []).find(({ cadre: [x, y, w, h] }) => b[0] >= x && b[0] < x + w && b[1] >= y && b[1] < y + h);
  return t ? [t.cadre[0] + t.cadre[2] / 2 - a[0], t.cadre[1] + t.cadre[3] / 2 - a[1]] : null;
}
const route = (md, id) => (md.routes_mer || []).find(r => r.id === id);

// Les numéros des camps pour marine.js : le joueur 0, les autres dans l'ordre de rules.factions, « neutre » 99.
export function numeros(rules, me) {
  const ids = new Map(me ? [[me, 0]] : []);
  for (const c of Object.keys(rules?.factions || {})) if (!ids.has(c)) ids.set(c, ids.size + (me ? 0 : 1));
  ids.set('neutre', 99);
  return ids;
}

// L'état de marine.js d'après l'état du jeu st (sans st.me : l'écran de départ, seulement balises et comptoirs).
// ctx : { N (niveau du plateau), local(k) (hexagone de la grille entière → indice de la fenêtre, ou −1), places (id de la
// place → son hexagone, grille entière), md (la carte : nodes, sorties, comptoirs), rules, couleurs (camp → couleur),
// masque (ids de flottes cachées : la scène de bataille navale les remplace) }.
// Chaque flotte garde son hexagone de la grille entière en _h (les mouvements du mois en partent) ; celles hors de la fenêtre
// sont dans `dehors` ([{ id, proprio, _h }] : pour les voir sortir ou entrer, à retirer avant majMarine).
export function etatMarine(st, ctx) {
  const { N, local, places, md, rules, couleurs = {}, masque } = ctx, me = st?.me?.code || null;
  const ids = numeros(rules, me), num = o => ids.get(o) ?? 99;
  const royaumes = [...ids].filter(([, id]) => id !== 99).map(([c, id]) => ({ id, couleur: couleurs[c] || rules?.factions?.[c]?.color || '#999999', joueur: id === 0, techs_liste: [] }));
  const ici = (x, y) => local(hexEau(N, x, y));
  // les places portuaires de la fenêtre, et leur port s'il est bâti (ou en chantier : reste 1)
  const villes = [], batiments = [];
  for (const n of md.nodes) {
    if (!(n.spec || []).includes('port')) continue;
    const h = places.get(n.id), c = h == null ? -1 : local(h);
    if (c < 0) continue;
    villes.push({ id: n.id, case: c });
    const ns = st?.nodes?.[n.id], lv = (ns?.sl || []).find(s => s[0] === 'port')?.[1];
    if (lv != null) batiments.push({ id: n.id, cle: 'port', case: c, ville: n.id, proprio: num(ns.o), reste: lv > 0 ? 0 : 1, face: 0 });
  }
  const flottes = [], dehors = [];
  for (const f of st?.flottes || []) {
    if (masque?.has(f.id)) continue;
    const h = hexEau(N, f.case[0], f.case[1]), c = local(h);
    if (c < 0) { if (h >= 0) dehors.push({ id: f.id, proprio: num(f.proprio), _h: h }); continue; }
    const chemin = [];
    for (const [x, y] of f.chemin || []) { const k = ici(x, y); if (k >= 0 && k !== c && k !== chemin[chemin.length - 1]) chemin.push(k); }
    // (ordre `route` pendant qu'elle gagne la case de départ : marine.js la cacherait aussitôt ; elle navigue comme une autre)
    flottes.push({ id: f.id, proprio: num(f.proprio), case: c, navires: f.navires, chemin, a_quai: f.a_quai, armee: f.armee, ordre: f.ordre === 'route' ? '' : f.ordre || '', _h: h });
  }
  const blocus = [];
  for (const b of st?.blocus || []) {
    const f = flottes.find(x => x.id === b.flotte), h = places.get(b.ville), c = h == null ? -1 : local(h);
    if (f && c >= 0) blocus.push({ par: f.proprio, ville: b.ville, case: c });
  }
  const armees = [];
  for (const a of st?.armies || []) { const c = local(indexEn(N.g, a.x, a.y)); if (c >= 0) armees.push({ id: a.id, proprio: num(a.o), case: c }); }
  // les flottes qu'on voyait et qui viennent de prendre la mer (ctx.partis : id → départ de la vue, {proprio, case, route,
  // navires}) : sur la case de départ de la route (la balise), ordre `route` (marine.js les mène à la balise, vers l'horizon
  // du théâtre de destination, puis les cache)
  for (const [id, d] of ctx.partis || []) {
    const h = hexEau(N, d.case[0], d.case[1]), c = local(h), r = route(md, d.route), vers = versTheatre(md, d.case, r?.vers);
    if (c >= 0) flottes.push({ id, proprio: num(d.proprio), case: c, navires: d.navires, chemin: [], armee: d.armee, ordre: 'route', sortie: c, ...(vers && { vers }), _h: h });
    else if (h >= 0) dehors.push({ id, proprio: num(d.proprio), _h: h });   // (balise hors de la fenêtre : elle y va, et sort de la vue)
  }
  // comptoirs : ceux de l'état (marchands, disputé), sinon ceux de la carte, libres (écran de départ) ; balises des routes
  // vers les autres théâtres ; routes commerciales
  const comptoirs = (st?.comptoirs ? st.comptoirs.map(c => ({ id: c.id, case: ici(c.case[0], c.case[1]), denree: c.denree, navires: c.navires.map(n => ({ proprio: num(n.proprio) })), dispute: !!c.dispute }))
    : (md.comptoirs || []).map(c => ({ id: c.id, case: ici(c.x, c.y), denree: c.denree, navires: [] }))).filter(c => c.case >= 0);
  const sorties = [];
  for (const s of md.sorties || []) {
    const c = ici(s.case[0], s.case[1]), vers = versTheatre(md, s.case, route(md, s.route)?.vers);
    if (c >= 0) sorties.push({ case: c, nom: s.nom, ...(vers && { vers }) });
  }
  return { royaumes, villes, batiments, flottes, dehors, blocus, armees, comptoirs, sorties, routes_mer: routesMer(st?.routes_mer, ici, num),
    epoque: { cle: epoqueDe(st?.year || md.epoque?.year || 1700) }, joueur: { techs: st?.me?.techs || [] } };
}

// Les routes commerciales de la vue pour marine.js : chaque chemin de cases → hexagones d'eau de la fenêtre (sans doublon
// à la suite) ; une route qui sort de la fenêtre et y revient se coupe en morceaux (id#k), sinon le ruban couperait les terres.
export function routesMer(routes, ici, num) {
  const out = [];
  for (const r of routes || []) {
    let bout = [], k = 0;
    const fin = () => { if (bout.length >= 2) out.push({ id: `${r.id}#${k++}`, chemin: bout, proprio: num(r.proprio), coupee: r.coupee || null }); bout = []; };
    for (const [x, y] of r.chemin || []) {
      const c = ici(x, y);
      if (c < 0) fin();
      else if (c !== bout[bout.length - 1]) bout.push(c);
    }
    fin();
  }
  return out;
}

// Les scènes du commerce d'un état pour jouerMoisMarine. arrivees : les arrivées de la vue (moteur) pas encore jouées, dont
// la flotte est dans la fenêtre : elle surgit par la balise de sa case d'arrivée, du côté du théâtre d'où elle vient ;
// departs : les départs pas encore joués d'une flotte qu'on ne voyait pas (sinon : ctx.partis), depuis la balise de sa route,
// vers le théâtre de destination ; abordages : événements `corsaire` du moteur (commerce.rs) : le corsaire fond sur la case
// de la route pillée la plus proche de lui. etat : celui de marine.js (flottes de la fenêtre).
export function scenesCommerce(st, etat, ctx, { arrivees: arr = [], departs: dep = [] } = {}) {
  const { N, local, md, rules } = ctx, ids = numeros(rules, st?.me?.code), ici = (x, y) => local(hexEau(N, x, y));
  const arrivees = [], abordages = [], departs = [];
  for (const a of arr) {
    if (!etat.flottes.some(f => f.id === a.id)) continue;
    const s = ici(a.case[0], a.case[1]), vers = versTheatre(md, a.case, route(md, a.route)?.de);
    arrivees.push({ flotte: a.id, ...(s >= 0 && { sortie: s }), ...(vers && { vers }) });
  }
  for (const d of dep) {
    const c = ici(d.case[0], d.case[1]), vers = versTheatre(md, d.case, route(md, d.route)?.vers);
    const armee = (st?.en_mer || []).find(e => e.id === d.id)?.armee?.effectif || 0;
    if (c >= 0) departs.push({ case: c, proprio: ids.get(d.proprio) ?? 99, navires: d.navires, sortie: c, ...(vers && { vers }), armee });
  }
  for (const e of st?.events || []) {
    const f = e.corsaire && (st.flottes || []).find(x => x.id === e.corsaire);
    if (!f || !etat.flottes.some(x => x.id === f.id)) continue;
    const ch = (st.routes_mer || []).find(r => r.id === e.route)?.chemin || [f.case];
    const [x, y] = ch.reduce((m, p) => Math.hypot(p[0] - f.case[0], p[1] - f.case[1]) < Math.hypot(m[0] - f.case[0], m[1] - f.case[1]) ? p : m);
    const c = ici(x, y);
    if (c >= 0) abordages.push({ flotte: f.id, case: c, proprio: ids.get(e.victime) ?? 99 });
  }
  return { arrivees, abordages, departs };
}

// Les mouvements du mois pour jouerMoisMarine : chaque flotte (de la fenêtre ou de `dehors`) qui a changé d'hexagone depuis
// `avant` (id → hexagone de la grille entière), le long d'un chemin d'eau. Celle qui sort de la fenêtre va jusqu'au bord
// (trajet terminé par −1, sortie : [dx, dz] de son pas vers le dehors), celle qui y entre paraît au bord (trajet commencé
// par −1, entree : [dx, dz] vers le dehors d'où elle vient) ; celle qui passe et repasse le bord ne montre que le morceau
// où elle finit (ou, si elle finit dehors, celui où elle commence).
export function mouvements(avant, etat, N, local, dehors = []) {
  const out = [];
  for (const f of [...etat.flottes, ...dehors]) {
    const h0 = avant.get(f.id);
    if (h0 == null || h0 === f._h || (local(h0) < 0 && local(f._h) < 0)) continue;   // (dehors avant et après : pas cherché)
    const t = trajetEau(N, h0, f._h), l = t?.map(local);
    if (!t) continue;
    let b = l.length - 1;
    if (l[b] < 0) { b = l.findIndex(k => k >= 0); if (b < 0) continue; while (b + 1 < l.length && l[b + 1] >= 0) b++; }
    let a = b;
    while (a > 0 && l[a - 1] >= 0) a--;
    const dir = (i, j) => { const p = N.g.liste[t[i]], q = N.g.liste[t[j]]; return [q.x - p.x, q.z - p.z]; };
    const m = { flotte: true, armee: f.id, proprio: f.proprio, trajet: l.slice(a, b + 1) };
    if (a > 0) { m.trajet.unshift(-1); m.entree = dir(a, a - 1); }
    if (b < l.length - 1) { m.trajet.push(-1); m.sortie = dir(b, b + 1); }
    out.push(m);
  }
  return out;
}

// La marine du plateau : reçoit les états du jeu, les traduit, et les passe à marine.js (M : le module de web_engine).
export class Marine {
  constructor(plateau, M) {
    this.p = plateau; this.M = M;
    this.hex = new Map();        // flotte → son hexagone (grille entière) au dernier état, dans la fenêtre ou hors d'elle
    this.masque = new Set();     // flottes cachées pendant la scène d'une bataille navale (flottes.js)
    this.ignorer = new Set();    // batailles navales que la page montre elle-même (flottes.js) : pas de canonnade du mois
    this.sig = ''; this.attente = null; this.t = 0; this.st = null;
    this.vus = new Set();        // départs et arrivées de la vue déjà joués (`id|route|d` ou `|a`), oubliés quand la vue ne les donne plus
    this.partis = new Map();     // flottes qu'on voyait et qui viennent de prendre la mer : id → { d (départ de la vue), t } (montrées le temps du départ)
  }
  ctx() {
    const p = this.p;
    return { N: p.N, local: k => (k < 0 ? -1 : p.local(k)), places: new Map([...p.N.places].map(([id, q]) => [id, q.hex[0]])),
      md: p.mp.m, rules: p.mp.rules, couleurs: p.mp.colors, masque: this.masque, partis: new Map([...this.partis].map(([id, o]) => [id, o.d])) };
  }
  // un nouvel état du jeu (map.setState → plateau.majLieux) ; refaire : la fenêtre a été rebâtie, tout se repose sans
  // animation (les indices de case ont changé)
  maj(st, refaire = false) {
    if (!this.p.C || !st) return;
    const premier = !this.st, joue = !premier && !refaire;   // (le premier état porte tout le journal : rien à rejouer)
    this.st = st;
    // traversées (vue `departs` / `arrivees`, tous les camps) : chacune jouée une fois, pas au premier état (rechargement) ;
    // une flotte qu'on voyait et qui part gagne la balise puis l'horizon (partis, montrée 20 s au plus), une autre part de la balise
    const now = performance.now(), cle = (d, k) => `${d.id}|${d.route}|${k}`, ctx0 = this.ctx();
    const neufs = k => (st[k === 'd' ? 'departs' : 'arrivees'] || []).filter(d => joue && !this.vus.has(cle(d, k)));
    const departs = [];
    for (const d of neufs('d')) {
      const h = this.hex.get(d.id);
      if (h != null && ctx0.local(h) >= 0) this.partis.set(d.id, { d: { ...d, armee: (st.en_mer || []).find(e => e.id === d.id)?.armee }, t: now });
      else departs.push(d);
    }
    const arrivent = neufs('a');
    this.vus = new Set([...(st.departs || []).map(d => cle(d, 'd')), ...(st.arrivees || []).map(d => cle(d, 'a'))]);
    for (const [id, o] of this.partis) if ((st.flottes || []).some(f => f.id === id) || now - o.t > 20000) this.partis.delete(id);
    const ctx = this.ctx(), { dehors, ...etat } = etatMarine(st, ctx);
    const mv = refaire ? [] : mouvements(this.hex, etat, ctx.N, ctx.local, dehors), ids = numeros(ctx.rules, st.me?.code);
    const combats = !joue ? [] : (st.events || []).filter(e => e.kind === 'battle_end' && e.naval && e.x != null && !this.ignorer.has(String(e.bid)))
      .map(e => ({ case: ctx.local(hexEau(ctx.N, Math.floor(e.x), Math.floor(e.y))), attaquant: ids.get(e.a) ?? 99, defenseur: ids.get(e.d) ?? 99, etape: 1 }))
      .filter(c => c.case >= 0);
    const sc = joue ? scenesCommerce(st, etat, ctx, { arrivees: arrivent, departs }) : { arrivees: [], abordages: [], departs: [] };
    this.hex = new Map([...etat.flottes, ...dehors].map(f => [f.id, f._h]));
    if (refaire) { clearTimeout(this.t); this.attente = null; }
    if (mv.length || combats.length || sc.arrivees.length || sc.abordages.length || sc.departs.length) {
      this.M.jouerMoisMarine({ mouvements: mv, combats, ...sc }, etat, DUREE);
      clearTimeout(this.t);
      this.attente = etat;
      this.t = setTimeout(() => { this.poser(this.attente); this.attente = null; }, DUREE + 500);
    } else if (this.attente) this.attente = etat;   // (le mois se joue encore : l'état attend sa fin)
    else this.poser(etat);
    this.p.sale = true;
  }
  poser(etat) {
    const sig = JSON.stringify(etat);
    if (sig === this.sig) return;
    this.sig = sig;
    this.M.majMarine(etat);
    this.p.sale = true;
  }
  // là où marine.js pose la flotte de la case [x, y] (le centre de son hexagone d'eau), en unités du jeu : la sélection
  // et le toucher de la page tombent sur le navire (null sans plateau bâti)
  lieu(x, y) {
    const N = this.p.N, h = N ? hexEau(N, x, y) : -1;
    return h < 0 ? null : [N.g.liste[h].gx, N.g.liste[h].gy];
  }
  // flottes cachées (scène de bataille navale) : l'état se repose aussitôt sans elles
  cacher(ids) { this.masque = new Set(ids); this.sig = ''; if (this.st) this.maj(this.st, true); }
  // la scène d'une bataille navale (marine.js sceneNavale) : o.x, o.y (case du jeu), camps [{ o (camp), navires }], phase,
  // vent, coules, pris ; null l'efface
  scene(o) {
    if (!o) { this.M.sceneNavale(null); this.p.sale = true; return; }
    const ctx = this.ctx(), c = ctx.local(hexEau(ctx.N, Math.floor(o.x), Math.floor(o.y)));
    if (c < 0) return;
    const ids = numeros(ctx.rules, this.st?.me?.code);
    this.M.sceneNavale({ case: c, phase: o.phase, vent: o.vent, coules: o.coules, pris: o.pris, epoque: epoqueDe(this.st?.year || 1700),
      camps: o.camps.map(k => ({ proprio: ids.get(k.o) ?? 99, navires: k.navires })) });
    this.p.sale = true;
  }
}
