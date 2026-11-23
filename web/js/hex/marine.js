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
// Chaque flotte garde son hexagone de la grille entière en _h (les mouvements du mois en partent).
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
  const flottes = [];
  for (const f of st?.flottes || []) {
    if (masque?.has(f.id)) continue;
    const h = hexEau(N, f.case[0], f.case[1]), c = local(h);
    if (c < 0) continue;
    const chemin = [];
    for (const [x, y] of f.chemin || []) { const k = ici(x, y); if (k >= 0 && k !== c && k !== chemin[chemin.length - 1]) chemin.push(k); }
    flottes.push({ id: f.id, proprio: num(f.proprio), case: c, navires: f.navires, chemin, a_quai: f.a_quai, armee: f.armee, ordre: f.ordre || '', _h: h });
  }
  const blocus = [];
  for (const b of st?.blocus || []) {
    const f = flottes.find(x => x.id === b.flotte), h = places.get(b.ville), c = h == null ? -1 : local(h);
    if (f && c >= 0) blocus.push({ par: f.proprio, ville: b.ville, case: c });
  }
  const armees = [];
  for (const a of st?.armies || []) { const c = local(indexEn(N.g, a.x, a.y)); if (c >= 0) armees.push({ id: a.id, proprio: num(a.o), case: c }); }
  // comptoirs : libres en attendant la vue du commerce (module 7) ; balises des routes vers les autres théâtres
  const comptoirs = (md.comptoirs || []).map(c => ({ id: c.id, case: ici(c.x, c.y), denree: c.denree, navires: [] })).filter(c => c.case >= 0);
  const sorties = (md.sorties || []).map(s => ({ case: ici(s.case[0], s.case[1]), nom: s.nom })).filter(s => s.case >= 0);
  return { royaumes, villes, batiments, flottes, blocus, armees, comptoirs, sorties,
    epoque: { cle: epoqueDe(st?.year || md.epoque?.year || 1700) }, joueur: { techs: st?.me?.techs || [] } };
}

// Les mouvements du mois pour jouerMoisMarine : chaque flotte qui a changé d'hexagone depuis `avant` (id → hexagone de la
// grille entière), le long d'un chemin d'eau tenu dans la fenêtre.
export function mouvements(avant, etat, N, local) {
  const out = [];
  for (const f of etat.flottes) {
    const h0 = avant.get(f.id);
    if (h0 == null || h0 === f._h) continue;
    const t = (trajetEau(N, h0, f._h) || []).map(local);
    if (t.length > 1 && t.every(k => k >= 0)) out.push({ flotte: true, armee: f.id, proprio: f.proprio, trajet: t });
  }
  return out;
}

// La marine du plateau : reçoit les états du jeu, les traduit, et les passe à marine.js (M : le module de web_engine).
export class Marine {
  constructor(plateau, M) {
    this.p = plateau; this.M = M;
    this.hex = new Map();        // flotte → son hexagone (grille entière) au dernier état
    this.masque = new Set();     // flottes cachées pendant la scène d'une bataille navale (flottes.js)
    this.ignorer = new Set();    // batailles navales que la page montre elle-même (flottes.js) : pas de canonnade du mois
    this.sig = ''; this.attente = null; this.t = 0; this.st = null;
  }
  ctx() {
    const p = this.p;
    return { N: p.N, local: k => (k < 0 ? -1 : p.local(k)), places: new Map([...p.N.places].map(([id, q]) => [id, q.hex[0]])),
      md: p.mp.m, rules: p.mp.rules, couleurs: p.mp.colors, masque: this.masque };
  }
  // un nouvel état du jeu (map.setState → plateau.majLieux) ; refaire : la fenêtre a été rebâtie, tout se repose sans
  // animation (les indices de case ont changé)
  maj(st, refaire = false) {
    if (!this.p.C || !st) return;
    this.st = st;
    const ctx = this.ctx(), etat = etatMarine(st, ctx);
    const mv = refaire ? [] : mouvements(this.hex, etat, ctx.N, ctx.local), ids = numeros(ctx.rules, st.me?.code);
    const combats = refaire ? [] : (st.events || []).filter(e => e.kind === 'battle_end' && e.naval && e.x != null && !this.ignorer.has(String(e.bid)))
      .map(e => ({ case: ctx.local(hexEau(ctx.N, Math.floor(e.x), Math.floor(e.y))), attaquant: ids.get(e.a) ?? 99, defenseur: ids.get(e.d) ?? 99, etape: 1 }))
      .filter(c => c.case >= 0);
    this.hex = new Map(etat.flottes.map(f => [f.id, f._h]));
    if (refaire) { clearTimeout(this.t); this.attente = null; }
    if (mv.length || combats.length) {
      this.M.jouerMoisMarine({ mouvements: mv, combats }, etat, DUREE);
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
