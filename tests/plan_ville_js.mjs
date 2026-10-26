// Le plan des villes vu par villes.js, pour tests/test_plan_ville.py (qui le compare au portage Python) :
//   node tests/plan_ville_js.mjs carte.json états.json  →  JSON sur la sortie
// carte.json : GeoMap().client_payload() ; états.json : [[id, année, f|null, pop|null, d], …]
// (sans arguments, sous node --test tests/*.mjs, il ne fait rien)
import fs from 'node:fs';
if (process.argv.length < 4) process.exit(0);
const ctx = new Proxy(function () {}, { get: (o, k) => (k === 'canvas' ? {} : k === Symbol.toPrimitive ? () => 0 : ctx), apply: () => ctx, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
globalThis.Path2D = class { moveTo() {} arc() {} lineTo() {} };
const V = await import('../web/js/carte/villes.js');
const [m, etats] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const K = V.carteDe(m), noeud = new Map(m.nodes.map(n => [n.id, n]));
const P = p => [p[0], p[1]];
const out = etats.map(([id, annee, f, pop, d]) => {
  const e = { annee }; if (f != null) e.f = f; if (pop != null) e.pop = pop; if (d) e.d = d;
  const Pf = V.profilVille(K, noeud.get(id), e), W = V.genererInterieur(K, Pf);
  const enc = t => t ? { poly: t.poly.map(P), ravs: t.ravs.map(r => [P(r.b1), P(r.apex), P(r.b2)]) } : null;
  return {
    modele: Pf.modele, murs: Pf.murs, R: Pf.R, routes: Pf.routes.map(r => r.a),
    ilots: W.ilots.map(b => ({ q: b.q.map(P), role: b.role || null, zone: b.zone, main: !!b.main, cotes: b.cotes || null })),
    rues: W.rues.length, trace: enc(W.trace), citadelle: enc(W.citadelle), rect: W.rect || null,
    murLigne: W.murLigne ?? null, rMur: W.rMur,
    plus: W.plus.map(p => ({ k: p.k, x: p.x ?? null, y: p.y ?? null, a: p.a ?? null })),
  };
});
process.stdout.write(JSON.stringify(out));
