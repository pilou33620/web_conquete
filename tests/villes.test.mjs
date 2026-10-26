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
  for (const il of b.ilots.filter(i => i.zone === 'ville' && !i.hors)) for (const p of il.q) assert.ok(Math.hypot(p[0] - b.C[0], p[1] - b.C[1]) <= b.murInt + 1e-6, 'un îlot hors de l’enceinte');
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

// la vraie taille, mesurée sur ce que le plan dessine (SPEC-CARTE-2D.md, « Livré — bâtiments à la vraie taille ») : un
// faux contexte relève les pans des toits (deux par maison : façade × demi-profondeur) et l'échelle des édifices
const L = await import('../web/js/carte/lib.js');
const releve = () => {
  const t = { quads: [], echelles: [], sous: [], fillStyle: '' };
  return new Proxy(t, {
    get: (o, k) => k in o ? o[k] : k === 'beginPath' ? () => { o.sous = []; } : k === 'moveTo' ? (x, y) => o.sous.push([[x, y]]) : k === 'lineTo' ? (x, y) => o.sous.at(-1)?.push([x, y])
      : k === 'fill' ? () => { if (!['rgba(20,20,10,.3)', '#7c9a52'].includes(o.fillStyle)) o.quads.push(...o.sous.filter(q => q.length === 4)); } : k === 'scale' ? s => o.echelles.push(s) : () => {},
    set: (o, k, v) => { o[k] = v; return true; },
  });
};
const longueurModele = parts => { const xs = parts.filter(p => typeof p.x === 'number').flatMap(p => [p.x - (p.r || 0), p.x + (p.w ?? p.r ?? 0)]); return Math.max(...xs) - Math.min(...xs); };
test('les bâtiments à leur vraie taille : rues, façades, îlots, places, cathédrale', () => {
  const M = 1000 / V.S, med = a => a.sort((x, y) => x - y)[a.length >> 1], d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) * M;
  const P = plan(nom('Bordeaux')), R = L.alea(7), g = releve();
  const ordinaires = P.ilots.filter(b => b.zone === 'ville' && !b.role && b.anneau != null);
  for (const b of ordinaires.slice(0, 150)) L.remplirIlot(g, b, P, R);
  const facade = med(g.quads.map(q => d(q[0], q[1]))), prof = 2 * med(g.quads.map(q => d(q[1], q[2])));
  assert.ok(facade >= 6 && facade <= 15, `façades : ${facade.toFixed(1)} m`);
  assert.ok(prof >= 8 && prof <= 16, `profondeur des maisons : ${prof.toFixed(1)} m`);
  const ilot = med(ordinaires.map(b => Math.sqrt(b.aire) * M));
  assert.ok(ilot >= 40 && ilot <= 100, `îlots : ${ilot.toFixed(0)} m`);
  // les rues : l'écart entre deux îlots voisins d'un même anneau, rentrés chacun de la moitié de la rue
  const rue = main => med(ordinaires.filter(b => b.main === main).flatMap(b => {
    const v = ordinaires.find(c => c.anneau === b.anneau && c.secteur === b.secteur + 1 && c.main === main); if (!v) return [];
    const A = L.decalerQuad(b.q, main ? 1.25 : .6), B = L.decalerQuad(v.q, main ? 1.25 : .6); if (!A || !B) return [];
    return [Math.min(...B.map(p => L.distPoly([...A, A[0]], p[0], p[1]))) * M];
  }));
  assert.ok(rue(false) >= 5 && rue(false) <= 8, `rues : ${rue(false).toFixed(1)} m`);
  assert.ok(rue(true) >= 10 && rue(true) <= 20, `grandes rues : ${rue(true).toFixed(1)} m`);
  assert.ok(P.rPlace * 2 * M >= 50 && P.rPlace * 2 * M <= 120, `la place royale : ${(P.rPlace * 2 * M).toFixed(0)} m`);
  const pl = plan(nom('Libourne')).ilots.find(b => b.role === 'place'), cote = Math.min(d(pl.q[0], pl.q[1]), d(pl.q[1], pl.q[2]));
  assert.ok(cote >= 40 && cote <= 120, `la place de la bastide : ${cote.toFixed(0)} m`);
  // la cathédrale, posée après les îlots à cheval sur son parvis (Saint-André : 124 m)
  const cath = P.ilots.find(b => b.role === 'cathedrale'), gc = releve(); P.apres.length = 0;
  L.remplirIlot(gc, cath, P, R); P.apres.forEach(f => f());
  const lc = gc.echelles[0] * longueurModele(L.BATS.cathedrale()) * M;
  assert.ok(lc >= 100 && lc <= 135, `la cathédrale : ${lc.toFixed(0)} m`);
  // l'église d'un village
  const B = plan(nom('Belin')), eg = B.ilots.find(b => b.role === 'eglise'), ge = releve();
  L.remplirIlot(ge, eg, B, R);
  const le = ge.echelles[0] * longueurModele(L.BATS.egliseRomane()) * M;
  assert.ok(le >= 20 && le <= 40, `l’église du village : ${le.toFixed(0)} m`);
});

test('le mur de la carte suit le tracé du plan : bastide, tracé bastionné, citadelle ; jamais dans l’eau', () => {
  const sec = (W, f) => f.murs.flat().every(([x, y]) => !W.eau(x + W.C[0], y + W.C[1]));
  const L = plan(nom('Libourne'), { f: 1 }), lib = V.formeMur(L), { a, w, h } = L.rect;
  assert.ok(lib.murs.length >= 1 && sec(L, lib), 'Libourne : le rectangle, coupé par l’Isle');
  for (const [x, y] of lib.murs.flat()) { const u = Math.abs(Math.cos(a) * x + Math.sin(a) * y), v = Math.abs(-Math.sin(a) * x + Math.cos(a) * y); assert.ok(Math.abs(u - w / 2 - 3) < 1e-6 || Math.abs(v - h / 2 - 3) < 1e-6, 'sur le rectangle de la bastide'); }
  const bay = plan(nom('Bayonne'), { f: 4 }), fb = V.formeMur(bay);
  assert.ok(bay.trace && bay.citadelle && sec(bay, fb));
  assert.ok(fb.ext[1] >= fb.ext[0] && fb.ext[0] > bay.rMur && fb.lunes.length, 'les bastions (et la citadelle) puis les demi-lunes débordent le mur');
  const bx = plan(nom('Bordeaux'), { f: 2 }), fx = V.formeMur(bx);   // (le mur rond, au bord de la Garonne)
  assert.ok(sec(bx, fx) && fx.murs.flat().some(([x, y]) => Math.abs(Math.hypot(x, y) - bx.rMur) < 1e-6));
});

test('les villes denses dans leurs murs, collées à leur fleuve', () => {
  const CL = new Set(V.CLOS), M = 1000 / 180;
  for (const x of ['Bordeaux', 'Bayonne', 'Libourne', 'Agen']) {
    const W = plan(nom(x)), C = W.C, dedans = W.ilots.filter(b => b.zone === 'ville' && !b.hors && b.d < W.rMur), ha = Math.PI * (W.rMur * M) ** 2 / 1e4;
    assert.ok(dedans.filter(b => CL.has(b.role)).length <= Math.max(3, dedans.length * .08), `${x} : quelques cours et jardins dans les murs`);
    assert.ok(Array.from({ length: 72 }, (_, i) => i * Math.PI / 36).some(a => W.eau(C[0] + Math.cos(a) * (W.rMur + 30), C[1] + Math.sin(a) * (W.rMur + 30))), `${x} : l’eau à moins de 170 m des murs`);
    assert.ok(W.Pf.pop / ha > 150 && W.Pf.pop / ha < 600, `${x} : ${(W.Pf.pop / ha).toFixed(0)} habitants par hectare dans les murs`);
  }
  assert.ok(Math.hypot(...plan(nom('Bayonne')).Pf.o) * M > 1000, 'Bayonne descend à l’Adour');
  assert.deepEqual(plan(nom('Belin')).Pf.o, [0, 0], 'les villages restent au nœud');
});
