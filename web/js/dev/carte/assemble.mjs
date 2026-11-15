// Assemble la maquette carte-et-villes.html (portage de assemble.py, même résultat) : les blocs voulus de
// carte/blocs.json (et leurs retouches) donnent carte/lib.js, puis page.html reçoit geo.json et le script.
//   cd web/js/dev && node carte/assemble.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const lire = f => readFileSync(f, 'utf8');
// str.replace de Python : toutes les occurrences, sans motif spécial ($&…) dans le remplacement
const remplace = (s, a, b) => s.split(a).join(b);
const verifie = (ok, quoi) => { if (!ok) throw new Error(`AssertionError : ${quoi}`); };

const B = JSON.parse(lire('carte/blocs.json')).blocks;
const VEUT = `TAU PEAU clamp lerp mod ease alea hx MEMO mix sombre clair E C T RR PG ligne dup
SOLS HERBE BOIS OMBRE parcelle arbre touffes bois haie chemin decaler route rue riviere pont toit ferme mare botte moutons cloture verger calvaire pietine cratere
tenue GRAINE unite placer BOUGE CHEVAL poseFig fusil bras tete fantassin cheval cavalier piece avant caisson corps drapeau
SPR sprite fumee eclair etincelle terre copeaux boulet ajouterCorps figAuHasard cibleDe impact tirs majUnite Scene
DPR KT
surPoly distPoly longueur surChemin angLerp TOITS ruisseau potager epouvantail charrue ruche tasBois linge abreuvoir souche tronc stere charbonniere sapin dessinMaison flammes
PAL SOLEIL OMB teinte teinteL pignon pyramideF coneF domeF mansardeF empreinte dessinPart bat croix cheminee parterre BATS
bastions chemin_ LPIECE dessinerEnceinte decalerQuad aire toitParcelle remplirIlot camAnim brancher`.split(/\s+/);
const veut = new Set(VEUT);
const out = [];
for (const b of B) {
  let code = b.code;
  if (b.kind === 'stmt') {
    if (code.startsWith("sprite('f'") || (code.startsWith('{') && code.includes('SPR.fl'))) out.push(code);
    continue;
  }
  if (b.names.some(n => veut.has(n))) {
    if (b.names.includes('DPR')) code = code.split('\n')[0];
    out.push(code);
  }
}
let lib = out.join('\n');
lib = remplace(lib, 'sc.zB = () => [Math.max(sc.cssW / Wd, sc.cssH / Hd), 4.5];', 'sc.zB = () => [Math.max(sc.cssW / Wd, sc.cssH / Hd), sc.zMax || 4.5];');
lib = remplace(lib, 'const sides = fau ? edges.filter((e, k) => [b.j === V.j0, b.i + 1 === V.i0, b.j + 1 === V.j0, b.i === V.i0][k])', 'const sides = fau ? edges.filter((e, k) => (b.cotes || [b.j === V.j0, b.i + 1 === V.i0, b.j + 1 === V.j0, b.i === V.i0])[k])');
lib = remplace(lib, 'const dmax = Math.min(cote * .36, 11)', 'const dmax = Math.min(cote * .36, V.prof || 11)');
lib = remplace(lib, "chemin_(g, inn); g.fillStyle = '#7c9a52'; g.fill(); for (let i = 0; i < 4; i++) arbre(", "chemin_(g, inn); g.fillStyle = b.aire > 2600 ? '#7c9a52' : '#cdbf9f'; g.fill(); for (let i = 0; i < 4; i++) arbre(");
lib = remplace(lib, 'const n = w * h, pt = (cnt, fn)', 'const n = w * h * (p.det ?? 1), pt = (cnt, fn)');
verifie(lib.includes('p.det ?? 1'), 'p.det ?? 1');
verifie(lib.includes('b.aire > 2600'), 'b.aire > 2600');
verifie(lib.includes('V.prof ||'), 'V.prof ||');
verifie(lib.includes('b.cotes ||') && lib.includes('sc.zMax'), 'b.cotes || et sc.zMax');
writeFileSync('carte/lib.js', lib);
const neuf = lire('carte/new.js') + '\n' + lire('carte/vivante.js');
const geo = lire('carte/geo.json');
let html = lire('carte/page.html');
html = remplace(remplace(html, '/*GEO*/', geo), '/*SCRIPT*/', lib + '\n' + neuf);
writeFileSync('carte-et-villes.html', html);
console.log([...html].length); // (len de Python : en caractères)
