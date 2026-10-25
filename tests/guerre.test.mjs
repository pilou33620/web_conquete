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
