// Banc du générateur des villes (web/js/carte/villes.js) : node --test tests/
//
// POURQUOI CE BANC EXISTE. Le plan d'une ville est tiré au hasard, mais d'une graine qui ne dépend que de la ville :
// il doit être le même à chaque ouverture (la carte et l'intérieur montrent la même ville), et deux villes ne doivent
// jamais partager le même. Le modèle de plan (bastide en damier, place bastionnée, village de montagne…) se lit dans
// les données du jeu : on vérifie quelques villes connues. L'état de la partie change l'enceinte, pas le modèle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// faux canevas : un contexte qui accepte tout (lib.js peint ses sprites au chargement)
const ctx = new Proxy(function () {}, { get: (o, k) => (k === 'canvas' ? {} : k === Symbol.toPrimitive ? () => 0 : ctx), apply: () => ctx, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
globalThis.Path2D = class { moveTo() {} arc() {} lineTo() {} };
const V = await import('../web/js/carte/villes.js');

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; from game.geo import GeoMap; sys.stdout.write(json.dumps(GeoMap().client_payload()))'], { cwd: racine, maxBuffer: 64 << 20 }).toString());
const K = V.carteDe(m);
const nom = x => m.nodes.find(n => n.name === x);
const plan = (n, e = {}) => V.genererInterieur(K, V.profilVille(K, n, { annee: 1789, ...e }));
const signature = P => P.ilots.map(b => b.q.map(p => p.map(v => v.toFixed(1)).join(',')).join(';')).join('|');

test('le plan d’une ville est toujours le même', () => {
  for (const x of ['Bordeaux', 'Bayonne', 'Libourne', 'Sarlat']) assert.equal(signature(plan(nom(x))), signature(plan(nom(x))), x);
});

test('deux villes ne partagent jamais le même plan', () => {
  const vus = new Map();
  for (const n of m.nodes) {
    const s = signature(plan(n));
    assert.ok(s.length > 0 || n.type === 'fort', `${n.name} : aucun îlot`);
    if (s) { assert.ok(!vus.has(s), `${n.name} a le plan de ${vus.get(s)}`); vus.set(s, n.name); }
  }
});

test('le modèle de plan se lit dans les données du jeu', () => {
  const modele = x => V.profilVille(K, nom(x), { annee: 1789 }).modele;
  assert.equal(modele('Bordeaux'), 'grande');
  assert.equal(modele('Libourne'), 'bastide');   // bastide en damier
  assert.equal(modele('Navarrenx'), 'place');
  assert.equal(modele('Beynac'), 'castrum');
  assert.equal(modele('Laruns'), 'montagne');
  assert.equal(modele('Sabres'), 'airial');
  const lib = plan(nom('Libourne'));
  assert.ok(lib.rect && lib.ilots.filter(b => b.gi != null).length >= 12, 'Libourne : un damier');
  // Bayonne : place à la Vauban, enceinte bastionnée ajustée aux îlots, citadelle
  const b = plan(nom('Bayonne'), { f: 3 });
  assert.equal(b.Pf.murs, 'bastions');
  assert.ok(b.trace && b.citadelle, 'Bayonne : enceinte et citadelle');
  for (const il of b.ilots.filter(i => i.zone === 'ville')) for (const p of il.q) assert.ok(Math.hypot(p[0] - 500, p[1] - 380) <= b.murInt + 1e-6, 'un îlot hors de l’enceinte');
  // un village des Pyrénées
  const mont = m.nodes.filter(n => n.type === 'village' && n.dept === '64' && n.y > m.y_mont - 25);
  assert.ok(mont.length > 0 && mont.every(n => ['montagne', 'bastide'].includes(V.profilVille(K, n, {}).modele)), 'villages de montagne');
  // les villages des Landes dans la pinède : des airiaux
  assert.ok(m.nodes.some(n => n.dept === '40' && V.profilVille(K, n, {}).modele === 'airial'));
});

test('l’état de la partie change l’enceinte et la taille, pas le modèle', () => {
  const n = nom('Libourne');
  const sans = V.profilVille(K, n, { f: 0, annee: 1789 }), murs = V.profilVille(K, n, { f: 1, annee: 1789 }), bast = V.profilVille(K, n, { f: 3, annee: 1789 });
  assert.equal(sans.murs, null); assert.equal(murs.murs, 'medieval'); assert.equal(bast.murs, 'bastions');
  assert.equal(new Set([sans.modele, murs.modele, bast.modele]).size, 1);
  const bx = nom('Bordeaux');
  assert.equal(V.profilVille(K, bx, { f: 2, annee: 1870 }).murs, 'cours');
  assert.ok(plan(bx, { annee: 1870, f: 2 }).gare, 'la gare après 1860');
  assert.ok(!plan(bx, { f: 2 }).gare);
  assert.ok(V.profilVille(K, n, { pop: 30000 }).R > V.profilVille(K, n, { pop: 8000 }).R);
  const peu = plan(n, { d: 0 }).ilots.filter(b => b.zone === 'faubourg').length, plus = plan(n, { d: 3 }).ilots.filter(b => b.zone === 'faubourg').length;
  assert.ok(plus > peu, `faubourgs : ${peu} puis ${plus}`);
});

test('siège et incendie : des îlots abîmés, toujours les mêmes', () => {
  const p = plan(nom('Bayonne'), { f: 3 });
  assert.equal(V.degats(p, {}).size, 0);
  const a = V.degats(p, { dmg: .6 }), b = V.degats(p, { dmg: .6 });
  assert.ok(a.size > 0 && [...a.keys()].every(x => b.get(x) === a.get(x)));
  assert.ok([...V.degats(p, { lv: 'incendie' }).values()].every(k => k === 'brule'));
});

test('les images des plans restent bornées en mémoire', () => {
  V.viderPlans();
  for (const n of m.nodes) V.planCarte(K, n, { annee: 1789 }, .5);
  const mem = V.memoirePlans();
  assert.ok(mem.pixels <= 14e6 && mem.plans <= 300, JSON.stringify(mem));
});
