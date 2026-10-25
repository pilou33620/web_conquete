// Banc des travaux de la carte (web/js/carte/travaux.js, SPEC-CARTE-2D.md lot H) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Les chantiers, les produits, les cordons et les grands travaux se lisent dans l'état de la
// partie (file des places du joueur, spécialité, événements locaux, dates des découvertes, voies ferrées) : une erreur
// de lecture ne fait rien planter, elle montre seulement un chantier chez l'ennemi ou rien du tout, au plus près. Et
// la crue ne doit couper que des routes qui passent dans les prés noyés du fleuve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ctx = new Proxy(function () {}, { get: (o, k) => (k === 'canvas' ? {} : k === Symbol.toPrimitive ? () => 0 : ctx), apply: () => ctx, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
globalThis.Path2D = class { moveTo() {} arc() {} lineTo() {} };
const { Travaux, etatMaison, PRODUIT, GRANDS_TRAVAUX } = await import('../web/js/carte/travaux.js');
const { AMB } = await import('../web/js/carte/ambiance.js');
const { reverberes } = await import('../web/js/carte/ciel.js');
const { IC, S } = await import('../web/js/carte/villes.js');

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; from game.geo import GeoMap; sys.stdout.write(json.dumps(GeoMap().client_payload()))'], { cwd: racine, maxBuffer: 64 << 20 }).toString());
const dec = s => Uint8Array.from(Buffer.from(s, 'base64'));
const edges = m.edges.map(e => { const cum = [0]; for (let i = 1; i < e.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1])); return { ...e, cum }; });
const nom = x => m.nodes.find(n => n.name === x);
const B = nom('Bordeaux'), Lib = nom('Libourne'), Per = nom('Périgueux');
function carte(st) {
  return { W: m.W, H: m.H, m, terrain: dec(m.terrain), cellnode: dec(m.cellnode), nodes: m.nodes, edges, state: st, railLine: () => [[10, 10], [20, 10]] };
}
function etat() {
  const nodes = m.nodes.map(n => ({ id: n.id, o: n.dept === '33' ? '33' : n.dept, f: n.fort, d: 0, pop: n.pop0 }));
  return { t: 400, year: 1800, me: { code: '33', tech_dates: {} }, factions: [], nodes };
}
const chez = (map, x, y) => map.state.nodes[map.cellnode[(y | 0) * m.W + (x | 0)]]?.o === '33';

test('une maison du faubourg après l’autre : fondations, charpente, finie, de la porte vers la campagne', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(k => etatMaison(k, 6, 0)), Array(6).fill('fondations'));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(k => etatMaison(k, 6, 0.6)), ['finie', 'finie', 'charpente', 'charpente', 'fondations', 'fondations']);
  assert.ok([0, 1, 2, 3, 4, 5].every(k => etatMaison(k, 6, 1.3) === 'finie'));
});

test('chantiers et produits des places du joueur, cordons de toutes les villes en épidémie', () => {
  const st = etat(), map = carte(st), W = new Travaux({ map });
  Object.assign(st.nodes[B.id], { q: [{ kind: 'unit', what: 'ligne', left: 3, total: 9 }, { kind: 'build', what: 'dev', left: 10, total: 40 }, { kind: 'build', what: 'repar', left: 30, total: 30 }], sl: [['marche', 1], ['specialite', 2]], dg: 0.2 });
  Object.assign(st.nodes[Per.id], { q: [{ kind: 'build', what: 'dev', left: 1, total: 40 }], sl: [['specialite', 3]], lv: ['epidemie', 4] });
  st.nodes[Lib.id].lv = ['epidemie', 12];
  const r = W.releve();
  assert.deepEqual(r.chantiers.map(c => [c.n.name, c.k, c.p]), [['Bordeaux', 'dev', 0.75], ['Bordeaux', 'repar', 0]], 'la file de ses places : agrandissement et réparations (pas la levée)');
  assert.deepEqual(r.produits.map(p => [p.n.name, p.k, p.lvl]), [['Bordeaux', 'barrique', 2]], 'les grands crus : des barriques ; pas chez l’ennemi');
  assert.deepEqual(r.cordons.map(c => c.n.name).sort(), ['Libourne', 'Périgueux'], 'le cordon sanitaire se voit partout');
  assert.ok(r.cordons.every(c => c.R == null), 'le rayon des murs, seulement à la première vue');
  assert.ok(W.sortiesDe(B).length >= 3 && W.sortiesDe(B).every(s => Math.hypot(s.pts[0][0] - B.x, s.pts[0][1] - B.y) < 0.01), 'les routes qui partent de la place');
  assert.equal(W.releve(), r, 'relevé une fois par état');
  st.nodes[B.id].sg = { by: '24', dmg: 0.2 }; map.state = Object.assign({}, st);
  assert.equal(W.releve().chantiers.length, 0, 'une place assiégée ne bâtit pas');
  assert.ok(Object.keys(PRODUIT).length >= 14);
});

test('grands travaux : routes royales empierrées puis bornées, chemin de halage creusé puis fini, chez le joueur seulement', () => {
  const st = etat(), map = carte(st), W = new Travaux({ map });
  st.me.tech_dates = { ponts_chaussees: ['', st.t - 30], canal: ['', st.t - 30] };
  st.rails = { state: [['s1', 'chantier', 0.3, '24'], ['s2', 'fait', 1, null]] };
  m.rails = { sections: [['s1', 0, 1, []], ['s2', 0, 1, []]] };
  let r = W.releve();
  assert.ok(r.routes.length > 3 && r.routes.every(p => chez(map, p.x, p.y)), `des chantiers sur les routes royales de la Gironde (${r.routes.length})`);
  assert.equal(r.bornes.length, 0);
  assert.ok(r.berges.length > 3 && r.berges.every(p => chez(map, p.x, p.y)), 'le halage en chantier le long du fleuve');
  assert.equal(r.halage.length, 0);
  assert.equal(r.rails.length, 1, 'la voie en chantier (de tout camp)'); assert.ok(Math.abs(r.rails[0].tete.x - 13) < 1e-9, 'la tête du chantier, au tiers');
  map.state = Object.assign({}, st, { t: st.t + Math.max(...Object.values(GRANDS_TRAVAUX)) });
  r = W.releve();
  assert.equal(r.routes.length, 0); assert.ok(r.bornes.length > r.routes.length && r.bornes.every(p => chez(map, p.x, p.y)), 'finies : les bornes');
  assert.ok(r.halage.length > 0 && r.halage.every(h => h.every(([x, y]) => chez(map, x, y))) && r.balises.length > 0, 'fini : le chemin de halage, balisé');
  map.state = Object.assign({}, st, { me: { code: '33', tech_dates: {} } });
  r = W.releve();
  assert.equal(r.routes.length + r.bornes.length + r.berges.length + r.halage.length, 0, 'sans la découverte, rien');
  delete m.rails;
});

test('la crue coupe les routes dans les prés noyés du fleuve, loin des places ; sans crue, rien', () => {
  const st = etat(), map = carte(st), W = new Travaux({ map });
  AMB.crue = false;
  assert.deepEqual(W.coupuresDe(), []);
  AMB.crue = true;
  const c = W.coupuresDe();
  assert.ok(c.length > 0, 'quelques routes coupées');
  const fleuves = m.rivers.filter(r => r.rank === 1 && /Garonne|Dordogne/.test(r.name)).flatMap(r => r.pts);
  for (const k of c) {
    assert.ok(fleuves.some(([x, y]) => Math.hypot(x - k.x, y - k.y) < 4), 'au bord de la Garonne ou de la Dordogne');
    assert.ok(m.nodes.every(n => Math.hypot(n.x - k.x, n.y - k.y) > 0.5), 'pas dans une place');
    assert.ok(k.l >= 0.24);
  }
  assert.equal(W.coupuresDe(), c, 'une fois par crue');
  AMB.crue = false;
});

test('les réverbères au gaz : réguliers le long des rues, seulement entre les maisons', () => {
  const V = { rues: [{ pts: [[IC[0] - 65, IC[1]], [IC[0] + 65, IC[1]]] }], ilots: [{ c: [IC[0] - 40, IC[1] + 10] }] };
  const l = reverberes(V, 100, 50);
  assert.ok(l.length >= 3 && l.length <= 5, `${l.length} réverbères, du côté des maisons`);
  for (let i = 1; i < l.length; i++) assert.ok(Math.abs(l[i][0] - l[i - 1][0] - 13 / S) < 1e-9, 'tous les 70 m');
  assert.ok(l.every(([x, y]) => x < 100 && Math.abs(y - 50) < 1e-9));
});
