// Banc de web/js/dev/carte/assemble.mjs (outil des maquettes, portage de assemble.py) : node --test tests/
//
// Sur un petit jeu de blocs (les vrais blocs.json et geo.json ne sont pas dans le dépôt), l'outil doit écrire
// carte/lib.js et carte-et-villes.html comme le faisait assemble.py : les blocs voulus seulement, la première ligne du
// bloc DPR, les cinq retouches, et des remplacements sans motif spécial ($&). Les résultats attendus ont été écrits
// par assemble.py sur ce même jeu de blocs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUTIL = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js', 'dev', 'carte', 'assemble.mjs');

const SCENE = `function Scene(sc, b, V, p, g, inn, w, h, cote) {
  sc.zB = () => [Math.max(sc.cssW / Wd, sc.cssH / Hd), 4.5];
  const sides = fau ? edges.filter((e, k) => [b.j === V.j0, b.i + 1 === V.i0, b.j + 1 === V.j0, b.i === V.i0][k]);
  const dmax = Math.min(cote * .36, 11);
  chemin_(g, inn); g.fillStyle = '#7c9a52'; g.fill(); for (let i = 0; i < 4; i++) arbre(g);
  const n = w * h, pt = (cnt, fn) => 0;
}`;

/** Le jeu de blocs, dans un dossier neuf (celui d'où l'outil se lance : web/js/dev en vrai). */
export function fixture() {
  const d = mkdtempSync(join(tmpdir(), 'assemble-'));
  mkdirSync(join(d, 'carte'));
  const blocs = [
    { kind: 'stmt', code: "sprite('f', 1);", names: [] },
    { kind: 'stmt', code: '{ SPR.fl = 2; }', names: [] },
    { kind: 'stmt', code: 'autre();', names: [] },
    { kind: 'decl', code: 'const DPR = 1;\nconst KT = 2;', names: ['DPR', 'KT'] },
    { kind: 'decl', code: 'function inutile() {}', names: ['inutile'] },
    { kind: 'decl', code: SCENE, names: ['Scene'] },
    { kind: 'decl', code: "const clair = 'é𝄞 $& $1';", names: ['clair', 'x'] },
  ];
  writeFileSync(join(d, 'carte', 'blocs.json'), JSON.stringify({ blocks: blocs }));
  writeFileSync(join(d, 'carte', 'geo.json'), '{"geo": "$& $1 é𝄞"}\n');
  writeFileSync(join(d, 'carte', 'page.html'), '<script>const GEO = /*GEO*/;\n/*SCRIPT*/</script>\n');
  writeFileSync(join(d, 'carte', 'new.js'), 'const nouveau = 1;\n');
  writeFileSync(join(d, 'carte', 'vivante.js'), "const vivante = 'ü';\n");
  return d;
}

const LIB = `sprite('f', 1);
{ SPR.fl = 2; }
const DPR = 1;
function Scene(sc, b, V, p, g, inn, w, h, cote) {
  sc.zB = () => [Math.max(sc.cssW / Wd, sc.cssH / Hd), sc.zMax || 4.5];
  const sides = fau ? edges.filter((e, k) => (b.cotes || [b.j === V.j0, b.i + 1 === V.i0, b.j + 1 === V.j0, b.i === V.i0])[k]);
  const dmax = Math.min(cote * .36, V.prof || 11);
  chemin_(g, inn); g.fillStyle = b.aire > 2600 ? '#7c9a52' : '#cdbf9f'; g.fill(); for (let i = 0; i < 4; i++) arbre(g);
  const n = w * h * (p.det ?? 1), pt = (cnt, fn) => 0;
}
const clair = 'é𝄞 $& $1';`;

test('assemble.mjs écrit lib.js et la page comme assemble.py', () => {
  const d = fixture();
  const sortie = execFileSync('node', [OUTIL], { cwd: d, encoding: 'utf8' });
  assert.equal(readFileSync(join(d, 'carte', 'lib.js'), 'utf8'), LIB);
  const html = `<script>const GEO = {"geo": "$& $1 é𝄞"}\n;\n${LIB}\nconst nouveau = 1;\n\nconst vivante = 'ü';\n</script>\n`;
  assert.equal(readFileSync(join(d, 'carte-et-villes.html'), 'utf8'), html);
  assert.equal(sortie, `${[...html].length}\n`); // (len de Python, en caractères : 𝄞 compte pour un)
});
