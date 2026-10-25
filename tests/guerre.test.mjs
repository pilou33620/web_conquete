// Banc de la guerre sur la carte (web/js/carte/guerre.js, SPEC-CARTE-2D.md chantier D) : node --test tests/
//
// POURQUOI CE BANC EXISTE. La colonne d'une armée se lit d'après ses régiments : une erreur d'ordre (les bagages en
// tête, l'artillerie sans caissons) ou de compte (un bataillon de trop) ne fait rien planter, elle se voit seulement
// au plus près. Le siège pose ses tranchées du côté de la terre, hors des murs : une parallèle dans le fleuve ou dans
// la ville passerait inaperçue de loin. Et la route parcourue d'une armée ne doit garder que ce qu'on a vu d'elle.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const rien = new Proxy({}, { get: (o, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return rien; } };
const { compoColonne, geoSiege, Guerre } = await import('../web/js/carte/guerre.js');

const CLS = { cavalerie: 'cavalerie', artillerie: 'artillerie', mitrailleuses: 'artillerie' };
const cls = t => CLS[t] || 'inf', leger = t => t === 'legere' || t === 'chasseurs';
const reg = (type, n) => ['r' + type + n, type, n, n];
const sortes = c => c.liste.map(e => e.k);

test('colonne : avant-garde, état-major, bataillons, artillerie, caissons, bagages, arrière-garde', () => {
  const c = compoColonne([reg('ligne', 300), reg('artillerie', 120), reg('ligne', 300), reg('cavalerie', 200), reg('cavalerie', 200)], cls, leger, { name: 'Moreau' });
  const k = sortes(c);
  const premier = s => k.indexOf(s), dernier = s => k.lastIndexOf(s);
  assert.equal(k[0], 'cav', 'la cavalerie ouvre la marche');
  assert.ok(premier('etat') === 8 && k.slice(0, 8).every(x => x === 'cav'), "l'état-major suit l'avant-garde (un régiment, huit rangs de deux)");
  assert.equal(c.liste[premier('etat')].gen, true, 'avec son général');
  assert.equal(k.filter(x => x === 'tambours').length, 2, 'un bataillon, ses tambours, par régiment de ligne');
  assert.equal(k.filter(x => x === 'off').length, 2);
  assert.equal(c.liste.filter(e => e.drapeau).length, 2, 'un drapeau par bataillon');
  assert.equal(k.filter(x => x === 'piece').length, 3, '120 artilleurs : trois pièces attelées');
  assert.equal(k.filter(x => x === 'caisson').length, 3, 'un caisson par pièce');
  assert.ok(premier('piece') > dernier('rang'), "l'artillerie marche derrière l'infanterie");
  assert.ok(premier('caisson') > dernier('piece') && premier('bagage') > dernier('caisson'), 'puis les caissons, puis les bagages');
  assert.equal(k[k.length - 1], 'cav', "la cavalerie ferme la marche (arrière-garde)");
  // chaque bataillon : 300 hommes, une figure pour trois, par rangs de quatre
  assert.equal(c.liste.filter(e => e.k === 'rang' && e.b === 0).length, 25);
  for (let i = 1; i < c.liste.length; i++) assert.ok(c.liste[i].d > c.liste[i - 1].d, 'chacun derrière le précédent');
  assert.equal(c.long, c.liste[c.liste.length - 1].d);
  assert.ok(c.long > 2 && c.long < 8, `une colonne de quelques kilomètres (${c.long.toFixed(2)} km)`);
});

test("colonne : sans cavalerie, les voltigeurs en tête et quelques rangs en arrière-garde ; l'effectif l'allonge", () => {
  const c = compoColonne([reg('ligne', 300), reg('legere', 240), reg('grenadiers', 200)], cls, leger, null);
  assert.equal(c.liste[0].k, 'off'); assert.equal(c.liste[0].t, 'legere', 'les voltigeurs ouvrent la marche');
  assert.equal(c.liste.find(e => e.k === 'etat').gen, false);
  const rangsInf = c.liste.filter(e => e.k === 'rang' && e.b >= 0).map(e => e.t);
  assert.ok(rangsInf.indexOf('grenadiers') > rangsInf.lastIndexOf('ligne'), 'la ligne, puis les grenadiers');
  const fin = c.liste.slice(-3);
  assert.ok(fin.every(e => e.k === 'rang' && e.b === -1), 'trois rangs en arrière-garde');
  assert.equal(c.liste.filter(e => e.k === 'piece').length, 0);
  const petite = compoColonne([reg('ligne', 90)], cls, leger, null), grande = compoColonne([reg('ligne', 300), reg('ligne', 300), reg('ligne', 300)], cls, leger, null);
  assert.ok(petite.long < c.long && c.long < grande.long, 'plus de monde, plus de route');
  assert.equal(petite.liste.filter(e => e.k === 'rang' && e.b === 0).length, 8, 'un bataillon réduit a moins de rangs');
});

test('siège : parallèles, boyaux, batteries et camp du côté de la terre, hors des murs, jamais dans l’eau', () => {
  const eau = (x, y) => x < 48.6;   // un fleuve à l'ouest de la place
  const s = geoSiege(50, 50, 1, eau, 7);
  assert.ok(Math.cos(s.aT) > 0.7, 'les travaux regardent la terre, à l’est');
  assert.ok(s.paralleles.length >= 3, 'trois parallèles');
  for (const p of s.paralleles) for (const [x, y] of p) {
    const d = Math.hypot(x - 50, y - 50);
    assert.ok(d > 1.5 && d < 2.4, 'hors des murs, à portée de canon'); assert.ok(!eau(x, y));
  }
  assert.equal(s.boyaux.length, 4);
  for (const b of s.boyaux) {
    assert.equal(b.length, 9);
    const r = b.map(([x, y]) => Math.hypot(x - 50, y - 50));
    for (let i = 1; i < r.length; i++) assert.ok(r[i] < r[i - 1], 'le boyau avance vers la place');
    const a = b.map(([x, y]) => Math.atan2(y - 50, x - 50));
    assert.ok(a.some((v, i) => i > 1 && Math.sign(v - a[i - 1]) !== Math.sign(a[i - 1] - a[i - 2])), 'en zigzag');
  }
  assert.equal(s.batteries.length, 5);
  for (const b of s.batteries) {
    assert.ok(!eau(b.x, b.y));
    const vers = Math.atan2(50 - b.y, 50 - b.x);
    assert.ok(Math.cos(vers - b.a) > 0.99, 'les pièces tirent sur la place');
  }
  assert.ok(s.camp.length > 30 && s.camp.every(([x, y]) => !eau(x, y) && Math.hypot(x - 50, y - 50) > 2.5), 'le camp en retrait des tranchées');
  assert.ok(s.feux.every(([x, y]) => Math.hypot(x - 50, y - 50) < 0.71), 'les incendies dans la ville');
  assert.deepEqual(geoSiege(50, 50, 1, eau, 7).paralleles, s.paralleles, 'même place, mêmes travaux');
  // une place sur une presqu'île : les tranchées s'arrêtent au bord de l'eau
  const presq = geoSiege(50, 50, 1, (x, y) => x < 48.6 || y < 48.8, 7);
  assert.ok(presq.paralleles.flat().every(([x, y]) => x >= 48.6 && y >= 48.8));
});

test("route parcourue : l'arête finie s'ajoute derrière l'armée, un saut l'efface", () => {
  const edge = (id, a, b, pts) => { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { id, a, b, pts, cum }; };
  const edges = [edge(0, 0, 1, [[0, 0], [5, 0], [10, 0]]), edge(1, 1, 2, [[10, 0], [10, 10]]), edge(2, 7, 8, [[50, 50], [60, 50]])];
  const map = { edges, edgePoint: (e, t) => { const s = t * e.cum[e.cum.length - 1]; let i = 1; while (i < e.cum.length - 1 && e.cum[i] < s) i++; const f = (s - e.cum[i - 1]) / (e.cum[i] - e.cum[i - 1]); return [e.pts[i - 1][0] + (e.pts[i][0] - e.pts[i - 1][0]) * f, e.pts[i - 1][1] + (e.pts[i][1] - e.pts[i - 1][1]) * f]; } };
  const G = new Guerre(map), a = { id: 'a1', e: [0, 0, 0.7], n: null };
  let h = G.suivre(a);
  assert.deepEqual(G.surArete(a.e, h.back), [[7, 0], [5, 0], [0, 0]], 'sur sa première arête : la route jusqu’au départ');
  a.e = [1, 1, 0.4]; h = G.suivre(a);
  assert.deepEqual(G.surArete(a.e, h.back), [[10, 4], [10, 0], [10, 0], [5, 0], [0, 0]], 'puis toute l’arête finie derrière elle');
  a.e = null; a.n = 2; h = G.suivre(a);
  assert.deepEqual(h.back[0], [10, 10], 'arrivée : la dernière arête aussi');
  a.n = null; a.e = [2, 7, 0.1]; h = G.suivre(a);
  assert.deepEqual(h.back, [], "un saut (l'armée a marché hors de vue) : on ne garde rien");
  // hors de l'état (brouillard) : armeesDe oublie sa route
  G.map.disp = new Map(); G.map.frameNo = 1;
  G.armeesDe(0);
  assert.equal(G.hist.size, 0);
});

// ------------------------------------------------------------------ l'arrière (chantier G)
const { ravitaillement, routeEntre, tombes, fermesAutour, JOURS } = await import('../web/js/carte/guerre.js');
// trois places sur une ligne : Libourne (ville, x 2) et un village (x 12) au joueur, Périgueux (ville, x 28) à l'ennemi ;
// le pays de chacune : x < 8, de 8 à 20, au-delà
function petiteCarte() {
  const edge = (id, a, b, pts) => { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { id, a, b, pts, cum }; };
  const W = 40, H = 5, cellnode = new Uint8Array(W * H).map((_, c) => (c % W) < 8 ? 0 : (c % W) < 20 ? 1 : 2);
  const nodes = [{ id: 0, name: 'Libourne', type: 'ville', x: 2, y: 2, pop0: 4000 }, { id: 1, name: 'Coutras', type: 'village', x: 12, y: 2, pop0: 800 }, { id: 2, name: 'Périgueux', type: 'ville', x: 28, y: 2, pop0: 6000 }];
  const edges = [edge(0, 0, 1, [[2, 2], [7, 2.5], [12, 2]]), edge(1, 1, 2, [[12, 2], [20, 2], [28, 2]])];
  const state = { me: { code: '33' }, factions: [{ code: '33', wars: ['24'] }, { code: '24', st: 'guerre', wars: ['33'] }], nodes: [{ id: 0, o: '33' }, { id: 1, o: '33' }, { id: 2, o: '24' }], armies: [], vis: [] };
  return { W, H, cellnode, terrain: new Uint8Array(W * H).fill(2), nodes, edges, state, disp: new Map(), frameNo: 0, rules: { units: {} }, colors: {}, fogOn: true,
    edgePoint: (e, t) => { const s = t * e.cum[e.cum.length - 1]; let i = 1; while (i < e.cum.length - 1 && e.cum[i] < s) i++; const f = (s - e.cum[i - 1]) / (e.cum[i] - e.cum[i - 1]); return [e.pts[i - 1][0] + (e.pts[i][0] - e.pts[i - 1][0]) * f, e.pts[i - 1][1] + (e.pts[i][1] - e.pts[i - 1][1]) * f]; } };
}

test('ravitaillement : du magasin, sinon de la place amie la plus proche ; en pays ennemi sans magasin, rien', () => {
  const map = petiteCarte(), st = map.state;
  assert.equal(ravitaillement(map, st, { x: 15, y: 2, dp: null }), 0, 'sur ses terres : la ville la plus proche (pas le village)');
  assert.equal(ravitaillement(map, st, { x: 24, y: 2, dp: null }), null, 'en pays ennemi : coupée');
  assert.equal(ravitaillement(map, st, { x: 24, y: 2, dp: 'Libourne' }), 0, 'son magasin la ravitaille');
  st.nodes[0].sg = { by: '24' };
  assert.equal(ravitaillement(map, st, { x: 15, y: 2, dp: null }), null, 'une place assiégée ne ravitaille personne');
  delete st.nodes[0].sg;
  assert.deepEqual(routeEntre(map, 0, 2), [[2, 2], [7, 2.5], [12, 2], [20, 2], [28, 2]], 'par les routes, de place en place');
  assert.equal(routeEntre(map, 0, 2, 20), null, 'trop loin');
});

test("convoi : des fourgons derrière l'armée ravitaillée, aucun derrière l'armée coupée (colonne maigre, sans bagages)", () => {
  const map = petiteCarte(), G = new Guerre(map), regs = [['r1', 'ligne', 600, 600], ['r2', 'ligne', 600, 600]];
  const armee = (id, frac, dp) => { const e = map.edges[1], [x, y] = map.edgePoint(e, frac); const a = { id, o: '33', x, y, e: [1, 1, frac], n: null, st: 'move', regs, dp }; map.disp.set(id, { a, x, y, head: 0 }); return a; };
  map.state.armies = [armee('ami', 0.3, null), armee('coupee', 0.8, null), armee('magasin', 0.85, 'Libourne')];
  map.frameNo = 1;
  const L = Object.fromEntries(G.armeesDe(0).map(A => [A.a.id, A]));
  assert.equal(L.ami.de, 0); assert.equal(L.ami.coupe, false);
  const R = G.routeRavit(L.ami);
  assert.deepEqual(R.pts[0], [2, 2], 'le convoi part de Libourne');
  assert.ok(R.n >= 2 && R.L > 10, 'et roule jusqu’à la queue de la colonne');
  assert.equal(L.coupee.de, null); assert.equal(L.coupee.coupe, true, 'coupée : ni convoi, ni bagages, une alerte');
  assert.equal(L.magasin.coupe, false); assert.ok(G.routeRavit(L.magasin).pts.length > 2, 'de son magasin, par la route');
  map.state.armies[0].o = '24';   // (l'ennemi : son ravitaillement est inconnu)
  map.frameNo = 2;
  assert.equal(G.armeesDe(0).find(A => A.a.id === 'ami').de, null);
});

test("champs de bataille, fermes, fêtes et recrues : mêmes tirages, d'après l'état", () => {
  assert.deepEqual(tombes(105.8, 107.7, 900), tombes(105.8, 107.7, 900), 'même champ, mêmes tombes');
  assert.ok(tombes(105.8, 107.7, 1500).length > tombes(105.8, 107.7, 300).length, 'plus de pertes, plus de tombes');
  assert.ok(tombes(105.8, 107.7, 1500).every(([x, y]) => Math.hypot(x - 105.8, y - 107.7) < 1));
  const map = petiteCarte(), f = fermesAutour(map, 24.5, 2.5);
  assert.deepEqual(fermesAutour(map, 24.5, 2.5), f, 'mêmes fermes au même endroit');
  assert.ok(f.length > 0 && f.length <= 3 && f.every(([x, y]) => Math.hypot(x - 24.5, y - 2.5) <= 1.8 && Math.hypot(x - 28, y - 2) > 0.4));
  const st = map.state, G = new Guerre(map);
  st.factions[0].lb = [1, 3]; st.factions[1].lb = [0, 3];
  st.nodes[1].q = [{ kind: 'unit', what: 'ligne' }]; st.nodes[0].q = [{ kind: 'build', what: 'fort' }];
  st.sites = [[20, 2.5, 5, 600, 400, '33', '24']];
  let ar = G.arriere();
  assert.equal(ar.fetes.get(0), 'fete', 'victoire : la fête dans les places du vainqueur');
  assert.equal(ar.fetes.get(2), undefined, "le deuil de l'ennemi, hors de vue, ne se voit pas");
  assert.deepEqual(ar.recrues.map(r => r.n.id), [1], 'les recrues vont à la place qui lève un régiment');
  assert.deepEqual(ar.recrues[0].routes.map(r => r.pts[r.pts.length - 1]), [[12, 2], [12, 2]], 'des villages voisins, par les routes, vers la place');
  assert.deepEqual(ar.sites[0].convois.map(c => c.pts[c.pts.length - 1]), [[2, 2], [28, 2]], 'les blessés de chaque camp vers sa ville la plus proche');
  map.state = Object.assign({}, st, { vis: [[28, 2, 5]], sites: [[20, 2.5, JOURS.blesses + 1, 600, 400, '33', '24']] });
  ar = G.arriere();
  assert.equal(ar.fetes.get(2), 'deuil', 'à portée de vue : en berne');
  assert.equal(ar.sites[0].convois.length, 0, 'passé un mois, plus de charrettes ; les tombes restent');
  assert.ok(ar.sites[0].tombes.length > 0);
});
