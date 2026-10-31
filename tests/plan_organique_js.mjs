// Le plan organique des villes vu par villes.js (planOrganique), pour tests/test_plan_organique.py (qui le compare au
// portage Python) :  node tests/plan_organique_js.mjs carte.json états.json  →  JSON sur la sortie
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
const out = etats.map(([id, annee, f, pop, d]) => {
  const e = { annee }; if (f != null) e.f = f; if (pop != null) e.pop = pop; if (d) e.d = d;
  const O = V.planOrganique(K, V.genererInterieur(K, V.profilVille(K, noeud.get(id), e)), e);
  return O && {
    ilots: O.ilots.map(({ pts, bloc, kinds, type, c, graine, sec, boite }) => ({ pts, bloc, kinds, type, c, graine, sec, boite })),
    mur: O.mur && { pts: O.mur.pts, kind: O.mur.kind, demi: O.mur.demi },
    axes: O.axes.map(({ pts, ws, demi, kind }) => ({ pts, ws, demi, kind })), boite: O.boite,
  };
});
process.stdout.write(JSON.stringify(out));
