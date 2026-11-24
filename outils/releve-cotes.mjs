// Relevé des côtes d'un théâtre sur la grille de cases du moteur : node outils/releve-cotes.mjs <id> [dossier des données]
// Relit <id>.json et places_<id>.json (game/data par défaut) et les remplit comme geo.rs (_generate : pays dans l'ordre des
// codes, trous bouchés, lacs, terres hors jeu ; une case est prise quand son centre est dans le contour), puis liste :
// - les passages connus (outils/theatres/<id>/carte.mjs, PASSAGES) coupés : un point hors de l'eau, ou les deux points sans
//   chemin d'eau en eau (4 voisins) ;
// - les mers enclavées : des eaux que rien ne relie au large (8 voisins, comme les flottes), sans lac de Natural Earth ;
// - les ports sans mouillage (aucune eau à 2 cases : marine::case_port) ou dont le mouillage ne mène pas au large, sauf
//   sur un lac (eaux intérieures : les Grands Lacs, le lac Nicaragua), listés à part avec leurs ports.
// Ne change rien ; sort en erreur s'il trouve un défaut. Les bras d'eau perdus à la conversion des contours en cases sont
// relevés (et creusés) par outils/theatre.mjs, qui seul a la grille fine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const [ID, DONNEES = path.join(ICI, '..', 'game', 'data')] = process.argv.slice(2);
if (!ID) { console.error('usage : node outils/releve-cotes.mjs <id> [dossier des données]'); process.exit(2); }
const geo = JSON.parse(fs.readFileSync(path.join(DONNEES, ID + '.json'), 'utf8'));
const places = JSON.parse(fs.readFileSync(path.join(DONNEES, `places_${ID}.json`), 'utf8'));
const CARTE = (await import(pathToFileURL(path.join(ICI, 'theatres', ID, 'carte.mjs')))).default;

const { lon0, lon1, lat0, lat1 } = geo.bounds, KM = geo.km_case || 1;
const KX = 111.32 * Math.cos((geo.lat_ref ?? 44.25) * Math.PI / 180) / KM, KY = 110.95 / KM;
const W = Math.ceil((lon1 - lon0) * KX), H = Math.ceil((lat1 - lat0) * KY), N = W * H;
const fx = lon => (lon - lon0) * KX, fy = lat => (lat1 - lat) * KY;
const caseDe = (lon, lat) => Math.floor(fy(lat)) * W + Math.floor(fx(lon));
// remplissage par le centre des cases (raster_ring de geo.rs)
function remplir(ring, cb) {
  const pts = ring.map(p => [fx(p[0]), fy(p[1])]), n = pts.length;
  const j0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1])))), j1 = Math.min(H - 1, Math.floor(Math.max(...pts.map(p => p[1]))) + 1);
  for (let j = j0; j <= j1; j++) {
    const yc = j + 0.5, xs = [];
    for (let k = 0; k < n; k++) { const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % n]; if ((y1 <= yc) !== (y2 <= yc)) xs.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1)); }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil(xs[q] - 0.5)); i <= Math.min(W - 1, Math.floor(xs[q + 1] - 0.5)); i++) cb(j * W + i);
  }
}
const voisins = (c, f, huit) => {
  const i = c % W, j = (c - i) / W;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if ((!di && !dj) || (!huit && di && dj)) continue;
    const a = i + di, b = j + dj;
    if (a >= 0 && b >= 0 && a < W && b < H) f(b * W + a);
  }
};
// 0 mer, 1 lac, 2 terre (pays ou hors jeu)
const T = new Uint8Array(N);
for (const code of Object.keys(geo.depts).sort()) for (const r of geo.depts[code].rings) remplir(r, c => { T[c] = 2; });
{
  const dehors = new Uint8Array(N), file = [];
  for (let c = 0; c < N; c++) { const i = c % W, j = (c - i) / W; if (!T[c] && (!i || !j || i === W - 1 || j === H - 1)) { dehors[c] = 1; file.push(c); } }
  for (let q = 0; q < file.length; q++) voisins(file[q], v => { if (!T[v] && !dehors[v]) { dehors[v] = 1; file.push(v); } });
  for (let t = 0; t < 4; t++) for (let c = 0; c < N; c++) if (!T[c] && !dehors[c]) { let pris = false; voisins(c, v => { pris ||= T[v] === 2; }); if (pris) T[c] = 2; }
}
for (const w of geo.waters) remplir(w.ring, c => { T[c] = 1; });
for (const l of geo.lands || []) remplir(l.ring, c => { if (T[c] !== 1) T[c] = 2; });
// le large : l'eau reliée au bord du cadre (8 voisins)
const large = new Uint8Array(N);
{
  const file = [];
  for (let c = 0; c < N; c++) { const i = c % W, j = (c - i) / W; if (T[c] < 2 && (!i || !j || i === W - 1 || j === H - 1)) { large[c] = 1; file.push(c); } }
  for (let q = 0; q < file.length; q++) voisins(file[q], v => { if (T[v] < 2 && !large[v]) { large[v] = 1; file.push(v); } }, true);
}
const defauts = [], ou = c => `${(lon0 + (c % W + 0.5) / KX).toFixed(2)},${(lat1 - (Math.floor(c / W) + 0.5) / KY).toFixed(2)}`;

// passages connus
for (const [nom, a, b] of CARTE.PASSAGES || []) {
  const ca = caseDe(...a), cb = caseDe(...b);
  if (T[ca] === 2 || T[cb] === 2) { defauts.push(`passage ${nom} : ${T[ca] === 2 ? 'le large' : 'le fond'} est à terre`); continue; }
  const vu = new Uint8Array(N), file = [ca]; vu[ca] = 1;
  for (let q = 0; q < file.length && !vu[cb]; q++) voisins(file[q], v => { if (T[v] < 2 && !vu[v]) { vu[v] = 1; file.push(v); } });
  if (!vu[cb]) defauts.push(`passage ${nom} : coupé`);
}
// eaux fermées (sans lien avec le large, 8 voisins) : un lac de Natural Earth en fait partie (les Grands Lacs, le lac
// Nicaragua : des eaux intérieures, où l'on navigue sans rejoindre la mer), sinon une mer enclavée (défaut)
const eauFermee = new Int32Array(N).fill(-1), lacs = []; // case → rang dans lacs ; lacs : { noms, cases, ports }
{
  const nomEau = new Int32Array(N).fill(-1);
  geo.waters.forEach((w, k) => remplir(w.ring, c => { nomEau[c] = k; }));
  for (let c0 = 0; c0 < N; c0++) {
    if (T[c0] === 2 || large[c0] || eauFermee[c0] >= 0) continue;
    const file = [c0], noms = new Set(); eauFermee[c0] = lacs.length;
    for (let q = 0; q < file.length; q++) {
      const k = nomEau[file[q]];
      if (T[file[q]] === 1 && k >= 0 && geo.waters[k].name !== 'Bras de mer') noms.add(geo.waters[k].name);
      voisins(file[q], v => { if (T[v] < 2 && eauFermee[v] < 0) { eauFermee[v] = lacs.length; file.push(v); } }, true);
    }
    lacs.push({ noms: [...noms].sort(), cases: file.length, ports: [] });
    if (!noms.size && file.some(c => !T[c])) defauts.push(`mer enclavée à ${ou(c0)} (${file.length} case${file.length > 1 ? 's' : ''})`);
  }
}
// ports
for (const [nom, lat, lon, code, , etiq] of places) {
  if (!etiq.includes('port')) continue;
  const x = Math.floor(fx(lon)), y = Math.floor(fy(lat));
  // (le mouillage de marine::case_port : la case d'eau la plus proche, la première trouvée à égalité)
  let best = -1, dmin = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = x + dx, j = y + dy, c = j * W + i;
    if ((dx || dy) && i >= 0 && j >= 0 && i < W && j < H && T[c] < 2 && dx * dx + dy * dy < dmin) { dmin = dx * dx + dy * dy; best = c; }
  }
  if (best < 0) defauts.push(`port ${nom}|${code} : pas d'eau à 2 cases`);
  else if (!large[best] && lacs[eauFermee[best]].noms.length) lacs[eauFermee[best]].ports.push(nom);
  else if (!large[best]) defauts.push(`port ${nom}|${code} : son mouillage (${ou(best)}) ne mène pas au large`);
}
console.log(`${ID} : ${W} × ${H} cases, ${(CARTE.PASSAGES || []).length} passages connus, ${places.filter(p => p[5].includes('port')).length} ports ; ${defauts.length} défaut(s)`);
for (const d of defauts) console.log('  ' + d);
for (const l of lacs.filter(l => l.ports.length))
  console.log(`  ports de lac (eaux intérieures de ${l.cases} cases : ${l.noms.join(', ')}) : ${l.ports.join(', ')}`);
process.exitCode = defauts.length ? 1 : 0;
