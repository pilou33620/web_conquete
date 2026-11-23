#!/usr/bin/env node
// La géographie d'un « théâtre » (Europe, Amérique, Inde, théâtres commerciaux), à KM km la case. Écrit dans game/data
// <id>.json, places_<id>.json, pays_<id>.json, epoques_<id>.json et cultures_<id>.json.
//
// Usage :  node outils/theatre.mjs <id> <dossier node_modules> [--apercu carte.svg] [--sortie dossier]
// Sources, préparation du dossier de travail et interface d'un théâtre : outils/THEATRES.md. Déterministe : deux
// lancements, mêmes fichiers. Entrées écrites à la main (estimations) : outils/theatres/<id>/carte.mjs (cadre,
// frontières, fleuves, caractère des pays), villes.json (villes et ports de 1790), epoques.json (populations de 1700 à 1900).
//
// Méthode : tout passe par une grille fine (un tiers de case). Chaque maille de terre (pays Natural Earth)
// reçoit un pays d'époque d'après le pays d'aujourd'hui, sa région (Highcharts) ou une retouche de carte.mjs ; les
// contours sont ensuite retracés sur la grille et simplifiés arc par arc : deux pays voisins partagent exactement les
// mêmes points, il n'y a ni trou ni recouvrement. À la fin, l'outil refait le calcul du moteur (geo.rs : raster_ring,
// trous bouchés, lacs, terres hors jeu) à KM km et vérifie tout ce qu'il écrit ; il s'arrête au premier défaut.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const arg = o => process.argv.includes(o) ? process.argv[process.argv.indexOf(o) + 1] : null;
const [ID, NM] = process.argv.slice(2);
const APERCU = arg('--apercu'), DATA = arg('--sortie') || path.join(ICI, '..', 'game', 'data');
const stop = msg => { console.error('ERREUR : ' + msg); process.exit(1); };
if (!ID || !NM || !fs.existsSync(path.join(NM, 'world-atlas'))) stop('usage : node outils/theatre.mjs <id> <dossier node_modules> [--apercu carte.svg] [--sortie dossier] (voir outils/THEATRES.md)');
// les théâtres : numéro de géographie du moteur, initiale des codes de pays (deux lettres en Europe, sinon trois)
const THEATRES = { europe: [5, ''], amerique: [6, 'A'], inde: [7, 'I'], guinee: [8, 'G'], bresil: [9, 'B'], madagascar: [10, 'M'], indes_orientales: [11, 'O'] };
if (!THEATRES[ID]) stop(`théâtre inconnu : ${ID} (connus : ${Object.keys(THEATRES).join(', ')})`);
const DOSSIER = path.join(ICI, 'theatres', ID);
for (const f of ['carte.mjs', 'villes.json', 'epoques.json']) if (!fs.existsSync(path.join(DOSSIER, f))) stop(`il manque ${path.join(DOSSIER, f)}`);
if (!fs.existsSync(DATA)) stop(`dossier de sortie absent : ${DATA}`);
const CARTE = (await import(pathToFileURL(path.join(DOSSIER, 'carte.mjs')))).default;
const NE = path.join(NM, '..', 'natural-earth');
const lire = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const lireNE = f => {
  const p = path.join(NE, f.endsWith('.geojson') ? f : f + '.geojson');
  if (!fs.existsSync(p)) stop(`il manque ${p} (Natural Earth, voir outils/THEATRES.md)`);
  return lire(p).features.filter(x => x.geometry);
};

// ------------------------------------------------------------------ la carte du théâtre (carte.mjs)
const { ENTIERS, COUPES, DETROITS, FLEUVES, PAYS, CULTURES = {}, NOM_LAC = {}, PORTS_ADMIS = [] } = CARTE;
const { LON0, LON1, LAT0, LAT1, LAT_REF, KM } = CARTE.cadre || {};
if (CARTE.id !== ID || CARTE.geo !== THEATRES[ID][0]) stop(`carte.mjs : id ${CARTE.id} et geo ${CARTE.geo} attendus ${ID} et ${THEATRES[ID][0]}`);
if (![LON0, LON1, LAT0, LAT1, LAT_REF, KM].every(Number.isFinite) || LON0 >= LON1 || LAT0 >= LAT1 || LON0 < -180 || LON1 > 180 || LAT0 < -85 || LAT1 > 85) stop('carte.mjs : cadre { LON0, LON1, LAT0, LAT1, LAT_REF, KM } invalide');
if (!Array.isArray(CARTE.places) || !(CARTE.places[0] > 0 && CARTE.places[1] >= CARTE.places[0])) stop('carte.mjs : places [min, max] invalide');
if (!ENTIERS || !COUPES || !Array.isArray(DETROITS) || !Array.isArray(FLEUVES) || !PAYS) stop('carte.mjs : il faut ENTIERS, COUPES, DETROITS, FLEUVES et PAYS');
// la terre d'un pays Natural Earth absent de ENTIERS et de COUPES : carte.defaut (« ~Hors jeu » par exemple), sinon arrêt
const DEFAUT = CARTE.defaut || null;
const NE_LACS = ['ne_10m_lakes', ...(CARTE.NE?.lacs || [])], NE_RIVIERES = ['ne_10m_rivers_lake_centerlines', ...(CARTE.NE?.rivieres || [])];
const SORTIES = { carte: ID + '.json', places: `places_${ID}.json`, pays: `pays_${ID}.json`, epoques: `epoques_${ID}.json`, cultures: `cultures_${ID}.json` };

// ------------------------------------------------------------------ étendue et grilles
const KX = 111.32 * Math.cos(LAT_REF * Math.PI / 180), KY = 110.95; // comme geo.rs
const W = Math.ceil((LON1 - LON0) * KX / KM), H = Math.ceil((LAT1 - LAT0) * KY / KM); // cases de KM km
if (W * H > 1.3e6) console.warn(`ATTENTION : ${W} × ${H} = ${(W * H / 1e6).toFixed(2)} million de cases (plus de 1,3) : carte lente et lourde pour le moteur`);
const F = 3, GW = W * F, GH = H * F, N = GW * GH; // grille fine
const gx = lon => (lon - LON0) * KX / KM * F, gy = lat => (LAT1 - lat) * KY / KM * F;
const lonDe = x => LON0 + x * KM / F / KX, latDe = y => LAT1 - y * KM / F / KY;
const km = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY); // distance entre deux [lon, lat]
const dansCadre = p => p[0] >= LON0 && p[0] <= LON1 && p[1] >= LAT0 && p[1] <= LAT1;
const LAC_MIN_KM2 = 100; // lacs gardés (Natural Earth, hors retenues modernes)
const LIEN_KM = 6; // raccord entre deux tronçons de Natural Earth

// ------------------------------------------------------------------ les pays : le format des camps du jeu (rules.rs, FACTIONS)
// mods : seulement des clés que le moteur lit déjà ; cultures connues du moteur (rules.rs, CULTURES ; la France : les
// noms des départements)
const CLES_MODS = ['livres', 'vivres', 'fer', 'bois', 'recrues', 'trade', 'vin', 'industrie', 'port', 'upkeep', 'inf_power', 'cav_power', 'art_power', 'art_cost',
  'cav_cost', 'fort_bonus', 'road_speed', 'mountain', 'ambush', 'marsh_attr', 'stealth', 'attrition', 'research_speed', 'siege_speed', 'morale', 'diplo'];
const CULTURES_MOTEUR = ['britannique', 'allemande', 'russe', 'espagnole', 'portugaise', 'italienne', 'ottomane', 'scandinave', 'polonaise', 'neerlandaise', 'francaise'];
{
  const motif = THEATRES[ID][1] ? new RegExp(`^${THEATRES[ID][1]}[A-Z]{2}$`) : /^[A-Z]{2}$/;
  const textes = l => Array.isArray(l) && l.length && l.every(s => typeof s === 'string' && s.trim());
  for (const [k, c] of Object.entries(CULTURES)) {
    if (CULTURES_MOTEUR.includes(k)) stop(`CULTURES : « ${k} » existe déjà dans le moteur, ne pas la redéfinir`);
    if (!/^[a-z_]+$/.test(k) || !c || !textes(c.prenoms) || !textes(c.prenoms_f) || !textes(c.noms)) stop(`CULTURES : « ${k} » : clé en minuscules et listes prenoms, prenoms_f, noms non vides`);
  }
  for (const [c, p] of Object.entries(PAYS)) {
    if (!motif.test(c)) stop(`code de pays ${c} : ${THEATRES[ID][1] ? `trois majuscules commençant par ${THEATRES[ID][1]}` : 'deux majuscules'}`);
    if (!p || typeof p.name !== 'string' || !p.mods || !p.personality || !Array.isArray(p.pros) || !Array.isArray(p.cons)) stop(`${c} : il faut name, short, color, adj, title, pros, cons, mods, personality, specialty`);
    if (!CULTURES_MOTEUR.includes(p.culture) && !CULTURES[p.culture]) stop(`${c} : culture « ${p.culture} » inconnue (ni dans le moteur ni dans CULTURES)`);
    if (!Array.isArray(p.maisons) || p.maisons.length !== 8 || !textes(p.maisons)) stop(`${c} : il faut 8 maisons`);
    const m = p.moyens;
    if (!Array.isArray(m) || m.length !== 2 || !Array.isArray(m[0]) || m[0].length !== 4 || !m[0].every(v => Number.isFinite(v) && v >= 0) || !(m[1] > 0))
      stop(`${c} : moyens [[armée 1700, 1790, 1813, 1870], trésor] attendus, lu ${JSON.stringify(m)}`);
  }
}
const NOM_PAYS = Object.fromEntries(Object.entries(PAYS).map(([c, p]) => [c, p.name]));
// ------------------------------------------------------------------ outils de géométrie
function topo(f, objet) {
  const t = lire(f), tr = t.transform;
  const arcs = t.arcs.map(a => { let x = 0, y = 0; return a.map(p => tr ? [(x += p[0]) * tr.scale[0] + tr.translate[0], (y += p[1]) * tr.scale[1] + tr.translate[1]] : p); });
  const ring = ids => { const r = []; for (const i of ids) { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; r.push(...(r.length ? a.slice(1) : a)); } return r; };
  const o = objet ? t.objects[objet] : Object.values(t.objects)[0];
  return o.geometries.filter(g => g.arcs).map(g => ({ p: g.properties, polys: (g.type === 'Polygon' ? [g.arcs] : g.arcs).map(pl => pl.map(ring)) }));
}
// Remplit un polygone (anneaux [lon, lat], règle pair-impair : les trous comptent) sur une grille gw × gh ; cb(maille).
// Le même balayage que raster_ring de geo.rs : une maille est prise si son centre est dans le polygone.
function remplir(rings, fx, fy, gw, gh, cb) {
  const rows = new Map();
  for (const ring of rings) {
    for (let k = 0, n = ring.length; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      const x1 = fx(a[0]), y1 = fy(a[1]), x2 = fx(b[0]), y2 = fy(b[1]);
      if (y1 === y2) continue;
      const j0 = Math.max(0, Math.ceil(Math.min(y1, y2) - 0.5)), j1 = Math.min(gh - 1, Math.floor(Math.max(y1, y2) - 0.5));
      for (let j = j0; j <= j1; j++) {
        const yc = j + 0.5;
        if ((y1 <= yc) !== (y2 <= yc)) { let r = rows.get(j); if (!r) rows.set(j, r = []); r.push(x1 + (yc - y1) * (x2 - x1) / (y2 - y1)); }
      }
    }
  }
  for (const [j, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(gw - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = i0; i <= i1; i++) cb(j * gw + i);
    }
  }
}
// Douglas-Peucker (sans récursion profonde)
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const garde = new Uint8Array(pts.length); garde[0] = garde[pts.length - 1] = 1;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [a, b] = pile.pop();
    const [ax, ay] = pts[a], ux = pts[b][0] - ax, uy = pts[b][1] - ay, n = Math.hypot(ux, uy);
    let m = -1, im = -1;
    for (let i = a + 1; i < b; i++) {
      const d = n ? Math.abs(ux * (pts[i][1] - ay) - uy * (pts[i][0] - ax)) / n : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > m) { m = d; im = i; }
    }
    if (m > eps) { garde[im] = 1; pile.push([a, im], [im, b]); }
  }
  return pts.filter((_, i) => garde[i]);
}
const aire2 = r => { let s = 0; for (let k = 0, n = r.length; k < n; k++) { const a = r[k], b = r[(k + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const voisins4 = (c, f) => { const i = c % GW; if (i > 0) f(c - 1); if (i < GW - 1) f(c + 1); if (c >= GW) f(c - GW); if (c < N - GW) f(c + GW); };
const arr3 = v => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ 1. la grille des pays
const NOMS = ['']; // étiquette → code de pays ou « ~terre hors jeu » ; 0 : la mer
const etiq = code => { let k = NOMS.indexOf(code); if (k < 0) { k = NOMS.length; NOMS.push(code); } if (k >= 250) stop('plus de 250 pays et terres hors jeu'); return k; };
const L = new Uint8Array(N);
{
  const pays = topo(path.join(NM, 'world-atlas', 'countries-10m.json'), 'countries');
  const C = new Uint8Array(N), noms = [''];
  for (const g of pays) {
    const polys = g.polys.filter(pl => pl[0].some(p => p[0] > LON0 - 1 && p[0] < LON1 + 1 && p[1] > LAT0 - 1 && p[1] < LAT1 + 1));
    if (!polys.length) continue;
    noms.push(g.p.name);
    for (const pl of polys) remplir(pl, gx, gy, GW, GH, c => { C[c] = noms.length - 1; });
  }
  const vus = new Set(C);
  const sans = [...vus].filter(k => k && !ENTIERS[noms[k]] && !COUPES[noms[k]]).map(k => noms[k]).sort();
  if (sans.length && !DEFAUT) stop(`pays Natural Earth sans règle (ENTIERS, COUPES ou carte.defaut) : ${sans.join(', ')}`);
  if (sans.length) console.log(`pays Natural Earth sans règle, mis à « ${DEFAUT} » : ${sans.join(', ')}`);
  const regle = noms.map(n => ENTIERS[n] || (!COUPES[n] && DEFAUT));
  for (let c = 0; c < N; c++) if (C[c] && regle[C[c]]) L[c] = etiq(regle[C[c]]);
  for (const [nom, regle] of Object.entries(COUPES)) {
    const k = noms.indexOf(nom);
    if (k < 0) stop(`pays à couper absent de Natural Earth : ${nom}`);
    const R = new Uint16Array(N), regs = [''];
    if (regle.carte) {
      const vues = new Set();
      for (const g of topo(path.join(NM, '@highcharts', 'map-collection', 'countries', regle.carte + '.topo.json'))) {
        regs.push(g.p.name); vues.add(g.p.name);
        for (const pl of g.polys) remplir(pl, gx, gy, GW, GH, c => { R[c] = regs.length - 1; });
      }
      for (const r of Object.keys(regle.regions)) if (!vues.has(r)) stop(`région inconnue de la carte ${regle.carte} : ${r}`);
      // les mailles du pays hors de toute région (les deux sources ne se recouvrent pas au km près) : la région la plus proche
      const file = []; for (let c = 0; c < N; c++) if (R[c]) file.push(c);
      for (let q = 0; q < file.length; q++) voisins4(file[q], v => { if (!R[v]) { R[v] = R[file[q]]; file.push(v); } });
    }
    for (let c = 0; c < N; c++) {
      if (C[c] !== k) continue;
      const lon = lonDe(c % GW + 0.5), lat = latDe(Math.floor(c / GW) + 0.5), r = regs[R[c]];
      L[c] = etiq((regle.retouche && regle.retouche(lon, lat, r)) || (regle.regions && regle.regions[r]) || regle.defaut);
    }
  }
}
// détroits rouverts
for (const [, pts] of DETROITS) {
  const ray = 3.75 / KM * F;
  for (let k = 0; k + 1 < pts.length; k++) {
    const x1 = gx(pts[k][0]), y1 = gy(pts[k][1]), x2 = gx(pts[k + 1][0]), y2 = gy(pts[k + 1][1]), n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
    for (let s = 0; s <= n; s++) {
      const x = x1 + (x2 - x1) * s / n, y = y1 + (y2 - y1) * s / n;
      for (let j = Math.floor(y - ray); j <= Math.ceil(y + ray); j++) for (let i = Math.floor(x - ray); i <= Math.ceil(x + ray); i++)
        if (i >= 0 && i < GW && j >= 0 && j < GH && Math.hypot(i + 0.5 - x, j + 0.5 - y) <= ray) L[j * GW + i] = 0;
    }
  }
}
// ménage : composantes connexes de chaque étiquette. Une enclave sans côte, un liseré de quelques mailles collé à un
// voisin : au voisin ; un îlot de moins de 5 mailles (14 km²) : à la mer. Une poche de mer fermée : un lac (« waters »).
const POCHE = 255; NOMS[POCHE] = '~poche';
const poches = []; // [centre lon, lat, mailles]
{
  const vu = new Uint8Array(N);
  // la mer ouverte : celle qui touche le bord du cadre
  const file = [];
  for (let c = 0; c < N; c++) { const i = c % GW, j = (c - i) / GW; if (!L[c] && (i === 0 || j === 0 || i === GW - 1 || j === GH - 1)) { vu[c] = 1; file.push(c); } }
  for (let q = 0; q < file.length; q++) voisins4(file[q], v => { if (!L[v] && !vu[v]) { vu[v] = 1; file.push(v); } });
  for (let c0 = 0; c0 < N; c0++) {
    if (vu[c0]) continue;
    const e = L[c0], comp = [c0], bord = new Map(); vu[c0] = 1;
    for (let q = 0; q < comp.length; q++) voisins4(comp[q], v => { if (L[v] === e) { if (!vu[v]) { vu[v] = 1; comp.push(v); } } else bord.set(L[v], (bord.get(L[v]) || 0) + 1); });
    let vers = e;
    if (e === 0) {
      if (comp.length >= 9) { vers = POCHE; let sx = 0, sy = 0; for (const c of comp) { sx += c % GW; sy += Math.floor(c / GW); } poches.push([arr3(lonDe(sx / comp.length)), arr3(latDe(sy / comp.length)), comp.length]); }
      else vers = [...bord].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    } else {
      const terres = [...bord].filter(b => b[0] !== 0 && b[0] !== POCHE).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      if (!bord.has(0) && terres.length && comp.length < 600) vers = terres[0][0];
      else if (terres.length && comp.length < 6) vers = terres[0][0];
      else if (!terres.length && comp.length < 5) vers = 0;
    }
    if (vers !== e) for (const c of comp) L[c] = vers;
  }
}
// îles forcées (carte.mjs, ILES : [[lon, lat, code, nom], …]) : une île trop petite pour la grille, rendue à la mer
// ci-dessus, garde la case de KM km du point, entière (les 3 × 3 mailles de la case) : son contour est le carré de la
// case, dont raster_ring (geo.rs) prend le centre ; toutes les vérifications qui suivent la voient comme une terre.
{
  const forcees = [], deja = [];
  for (const [lon, lat, code, nom] of CARTE.ILES || []) {
    const i = Math.floor(gx(lon) / F), j = Math.floor(gy(lat) / F);
    if (!PAYS[code] || typeof nom !== 'string' || !(i >= 0 && i < W && j >= 0 && j < H)) stop(`ILES : [${lon}, ${lat}, ${code}, ${nom}] : pays inconnu, nom absent ou point hors du cadre`);
    const e = etiq(code), maille = (di, dj) => (j * F + dj) * GW + i * F + di;
    let avant = 0;
    for (let dj = 0; dj < F; dj++) for (let di = 0; di < F; di++) { avant += L[maille(di, dj)] === e; L[maille(di, dj)] = e; }
    (avant === F * F ? deja : forcees).push(`${nom} (${code})`);
  }
  if (forcees.length) console.log(`îles forcées (une case de terre) : ${forcees.join(', ')}`);
  if (deja.length) console.log(`ILES déjà à l'échelle de la grille (inutiles) : ${deja.join(', ')}`);
}

// ------------------------------------------------------------------ 2. des mailles aux contours
// Les arêtes entre deux étiquettes différentes forment des arcs (d'un nœud, où trois frontières se rejoignent, au
// suivant) ; chaque arc est simplifié une seule fois et sert aux deux voisins.
const EPS = 1.1; // tolérance de simplification, en mailles (1,8 km)
const contours = new Map(); // étiquette → anneaux [[lon, lat], …] (extérieurs seulement)
{
  const VW = GW + 1, lab = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? 0 : L[j * GW + i];
  const aH = (i, j) => i >= 0 && i < GW && j >= 0 && j <= GH && lab(i, j - 1) !== lab(i, j); // arête du sommet (i, j) vers (i+1, j)
  const aV = (i, j) => i >= 0 && i <= GW && j >= 0 && j < GH && lab(i - 1, j) !== lab(i, j); // … vers (i, j+1)
  const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const arete = (i, j, d) => d === 0 ? aH(i, j) : d === 1 ? aV(i, j) : d === 2 ? aH(i - 1, j) : aV(i, j - 1);
  const degre = (i, j) => arete(i, j, 0) + arete(i, j, 1) + arete(i, j, 2) + arete(i, j, 3);
  const faite = new Uint8Array(VW * (GH + 1)); // bit 0 : arête horizontale partie du sommet, bit 1 : verticale
  const marque = (i, j, d) => { if (d === 0) faite[j * VW + i] |= 1; else if (d === 1) faite[j * VW + i] |= 2; else if (d === 2) faite[j * VW + i - 1] |= 1; else faite[(j - 1) * VW + i] |= 2; };
  const estFaite = (i, j, d) => d === 0 ? faite[j * VW + i] & 1 : d === 1 ? faite[j * VW + i] & 2 : d === 2 ? faite[j * VW + i - 1] & 1 : faite[(j - 1) * VW + i] & 2;
  const cotes = (i, j, d) => d === 0 ? [lab(i, j - 1), lab(i, j)] : d === 1 ? [lab(i, j), lab(i - 1, j)] : d === 2 ? [lab(i - 1, j), lab(i - 1, j - 1)] : [lab(i - 1, j - 1), lab(i, j - 1)]; // [gauche, droite]
  const arcs = [];
  const suivre = (i0, j0, d0) => {
    const pts = [[i0, j0]], [g, dr] = cotes(i0, j0, d0);
    let i = i0, j = j0, d = d0;
    for (;;) {
      marque(i, j, d); i += DIR[d][0]; j += DIR[d][1]; pts.push([i, j]);
      if ((i === i0 && j === j0) || degre(i, j) !== 2) break;
      d = [0, 1, 2, 3].find(k => k !== (d + 2) % 4 && arete(i, j, k));
    }
    arcs.push({ pts, g, d: dr });
  };
  for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) { const n = degre(i, j); if (n && n !== 2) for (let d = 0; d < 4; d++) if (arete(i, j, d) && !estFaite(i, j, d)) suivre(i, j, d); }
  for (let j = 0; j <= GH; j++) for (let i = 0; i <= GW; i++) for (let d = 0; d < 2; d++) if (arete(i, j, d) && !estFaite(i, j, d)) suivre(i, j, d); // boucles sans nœud
  for (const a of arcs) {
    const p = a.pts;
    if (p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) { // boucle : coupée au point le plus loin du départ
      let m = 0, im = 0; for (let k = 1; k < p.length - 1; k++) { const d = Math.hypot(p[k][0] - p[0][0], p[k][1] - p[0][1]); if (d > m) { m = d; im = k; } }
      a.simple = [...rdp(p.slice(0, im + 1), EPS).slice(0, -1), ...rdp(p.slice(im), EPS)];
    } else a.simple = rdp(p, EPS);
  }
  // les anneaux de chaque étiquette : ses arcs mis bout à bout, l'étiquette toujours à gauche
  const cle = p => p[1] * VW + p[0];
  for (let e = 1; e < NOMS.length; e++) {
    if (!NOMS[e]) continue;
    const parts = new Map(); // sommet de départ → parcours
    for (const a of arcs) {
      const t = a.g === e ? { pts: a.simple, brut: a.pts } : a.d === e ? { pts: a.simple.slice().reverse(), brut: a.pts.slice().reverse() } : null;
      if (!t) continue;
      const k = cle(t.brut[0]); if (!parts.has(k)) parts.set(k, []); parts.get(k).push(t);
    }
    const rings = [];
    for (const liste of parts.values()) {
      while (liste.length) {
        let t = liste.pop(); const ring = [], brut = [], k0 = cle(t.brut[0]);
        for (;;) {
          ring.push(...t.pts.slice(0, -1)); brut.push(...t.brut.slice(0, -1));
          const k = cle(t.brut[t.brut.length - 1]);
          if (k === k0) break;
          const suite = parts.get(k);
          if (!suite || !suite.length) stop(`contour ouvert pour ${NOMS[e]}`);
          t = suite.pop();
        }
        // sens : étiquette à gauche et y vers le bas, un anneau extérieur a une aire signée négative ; les trous (lacs
        // fermés, déjà rendus à part) sont laissés : geo.rs remplit chaque anneau
        if (aire2(brut) < 0 && ring.length >= 3 && Math.abs(aire2(ring)) >= 6) rings.push(ring.map(p => [arr3(lonDe(p[0])), arr3(latDe(p[1]))]));
      }
    }
    rings.sort((a, b) => Math.abs(aire2(b)) - Math.abs(aire2(a)) || a[0][0] - b[0][0] || a[0][1] - b[0][1]);
    contours.set(e, rings);
  }
}
const CODES = NOMS.filter(c => c && c[0] !== '~').sort();
console.log(`grille ${W} × ${H} cases de ${KM} km ; ${CODES.length} pays : ${CODES.join(' ')}`);
if (poches.length) console.log('poches de mer fermées, rendues comme des lacs : ' + poches.map(p => `${p[0]},${p[1]} (${p[2]})`).join(' ; '));

// ------------------------------------------------------------------ 3. lacs
const waters = [];
{
  const vus = [];
  for (const f of NE_LACS) {
    for (const x of lireNE(f)) {
      const p = x.properties;
      if (p.featurecla === 'Reservoir' && !/Il.?men/.test((p.name_fr || '') + (p.name || ''))) continue; // retenues du XXe siècle
      for (const pl of x.geometry.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry.coordinates) {
        if (!pl[0].some(dansCadre)) continue;
        const r = pl[0].map(q => [Math.min(LON1, Math.max(LON0, q[0])), Math.min(LAT1, Math.max(LAT0, q[1]))]); // (l'Onega dépasse du cadre)
        const a = Math.abs(aire2(r.map(q => [q[0] * KX, q[1] * KY]))) / 2;
        if (a < LAC_MIN_KM2) continue;
        const c = [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length];
        if (vus.some(v => km(v, c) < 10)) continue; // le même lac dans les deux fichiers
        vus.push(c);
        let nom = p.name_fr || p.name || 'Lac'; // noms français de Natural Earth
        nom = NOM_LAC[nom] || (/^(Lac|Lagune|Loch|Lough|mer|étang)/.test(nom) ? nom : 'Lac ' + nom);
        const ring = rdp(r.map(q => [gx(q[0]), gy(q[1])]), 0.5).map(q => [arr3(lonDe(q[0])), arr3(latDe(q[1]))]);
        waters.push({ name: nom, ring, _a: a });
      }
    }
  }
  waters.sort((a, b) => b._a - a._a || a.ring[0][0] - b.ring[0][0]);
  for (const w of waters) delete w._a;
  for (const ring of contours.get(POCHE) || []) waters.push({ name: 'Bras de mer', ring });
}

// ------------------------------------------------------------------ 4. fleuves
const rivers = [];
{
  // le réseau de Natural Earth : un nœud par point, les bouts de ligne raccordés au point voisin d'une autre ligne (3 km)
  const X = [], Y = [], adj = [], ligneDe = [], noms = [], idx = new Map();
  const noeud = (p, l) => { const k = Math.round(p[0] * 1e4) + ':' + Math.round(p[1] * 1e4); let n = idx.get(k); if (n === undefined) { n = X.length; idx.set(k, n); X.push(p[0]); Y.push(p[1]); adj.push([]); ligneDe.push(l); } return n; };
  const lien = (a, b) => { if (a === b) return; const d = km([X[a], Y[a]], [X[b], Y[b]]); adj[a].push([b, d]); adj[b].push([a, d]); };
  const bouts = [];
  let nl = 0;
  for (const f of NE_RIVIERES) {
    for (const x of lireNE(f)) {
      for (const l of x.geometry.type === 'LineString' ? [x.geometry.coordinates] : x.geometry.coordinates) {
        if (!l.some(p => p[0] > LON0 - 3 && p[0] < LON1 + 3 && p[1] > LAT0 - 3 && p[1] < LAT1 + 3)) continue;
        if (/Canal|Csatorna|Kanal/i.test(x.properties.name || '')) continue; // les canaux raccourciraient les fleuves
        noms.push(x.properties.name || '?');
        const ns = l.map(p => noeud(p, nl));
        for (let k = 0; k + 1 < ns.length; k++) lien(ns[k], ns[k + 1]);
        bouts.push([ns[0], nl], [ns[ns.length - 1], nl]);
        nl++;
      }
    }
  }
  const casier = new Map(), cas = (x, y) => Math.floor(x / 0.05) + ':' + Math.floor(y / 0.05);
  for (let n = 0; n < X.length; n++) { const k = cas(X[n], Y[n]); if (!casier.has(k)) casier.set(k, []); casier.get(k).push(n); }
  for (const [b, l] of bouts) {
    let m = LIEN_KM, im = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const n of casier.get(cas(X[b] + dx * 0.05, Y[b] + dy * 0.05)) || []) {
      if (ligneDe[n] === l || n === b) continue;
      const d = km([X[b], Y[b]], [X[n], Y[n]]); if (d < m) { m = d; im = n; }
    }
    if (im >= 0) lien(b, im);
  }
  const proche = (p, re) => { let m = 1e9, im = -1; for (let n = 0; n < X.length; n++) { if (re && !re.test(noms[ligneDe[n]])) continue; const d = km(p, [X[n], Y[n]]); if (d < m) { m = d; im = n; } } return [im, m]; };
  const chemin = (a, b) => { // Dijkstra, tas binaire
    const dist = new Float64Array(X.length).fill(Infinity), prec = new Int32Array(X.length).fill(-1), tas = [[0, a]]; dist[a] = 0;
    const monte = i => { while (i > 0) { const p = (i - 1) >> 1; if (tas[p][0] <= tas[i][0]) break; [tas[p], tas[i]] = [tas[i], tas[p]]; i = p; } };
    const descend = i => { for (;;) { let m = i; const g = 2 * i + 1, d = g + 1; if (g < tas.length && tas[g][0] < tas[m][0]) m = g; if (d < tas.length && tas[d][0] < tas[m][0]) m = d; if (m === i) break; [tas[m], tas[i]] = [tas[i], tas[m]]; i = m; } };
    while (tas.length) {
      const [d, n] = tas[0]; const fin = tas.pop(); if (tas.length) { tas[0] = fin; descend(0); }
      if (d > dist[n]) continue;
      if (n === b) break;
      for (const [v, w] of adj[n]) if (d + w < dist[v]) { dist[v] = d + w; prec[v] = n; tas.push([d + w, v]); monte(tas.length - 1); }
    }
    if (dist[b] === Infinity) return null;
    const out = []; for (let n = b; n >= 0; n = prec[n]) out.push(n);
    return out.reverse();
  };
  const journal = [];
  for (const [nom, rang, a, b, re] of FLEUVES) {
    let pts, note = 'points écrits à la main';
    if (b) {
      const [na, da] = proche(a, re), [nb, db] = proche(b, re);
      if (da > 30 || db > 30) stop(`fleuve ${nom} : pas de tracé Natural Earth à moins de 30 km de la source (${da.toFixed(0)} km) ou de l'embouchure (${db.toFixed(0)} km)`);
      const ch = chemin(na, nb);
      if (!ch) stop(`fleuve ${nom} : la source et l'embouchure ne sont pas reliées dans Natural Earth`);
      pts = ch.map(n => [X[n], Y[n]]);
      note = [...new Set(ch.map(n => noms[ligneDe[n]]))].join('/');
    } else pts = a;
    // la partie dans le cadre (la plus longue), simplifiée à 1 km
    let best = [], cur = [];
    for (const p of [...pts, null]) { if (p && dansCadre(p)) cur.push(p); else { if (cur.length > best.length) best = cur; cur = []; } }
    if (best.length < 2) stop(`fleuve ${nom} : hors du cadre`);
    const coupe = best.length < pts.length;
    pts = rdp(best.map(p => [gx(p[0]), gy(p[1])]), 0.6).map(p => [arr3(lonDe(p[0])), arr3(latDe(p[1]))]);
    rivers.push({ name: nom, rank: rang, pts, _coupe: coupe });
    let long = 0; for (let k = 0; k + 1 < pts.length; k++) long += km(pts[k], pts[k + 1]);
    journal.push(`${nom} ${Math.round(long)} km [${note}]`);
  }
  // l'embouchure : à la mer (prolongée jusqu'à la première maille d'eau, 40 km au plus), à un confluent ou au bord du cadre
  const eau = (x, y) => { const i = Math.floor(x), j = Math.floor(y); return i < 0 || j < 0 || i >= GW || j >= GH || L[j * GW + i] === 0 || L[j * GW + i] === POCHE; };
  const dSeg = (p, a, b) => { const ux = (b[0] - a[0]) * KX, uy = (b[1] - a[1]) * KY, px = (p[0] - a[0]) * KX, py = (p[1] - a[1]) * KY, n = ux * ux + uy * uy, t = n ? Math.max(0, Math.min(1, (px * ux + py * uy) / n)) : 0; return Math.hypot(px - t * ux, py - t * uy); };
  const defauts = [];
  for (const r of rivers) {
    const fin = r.pts[r.pts.length - 1], x = gx(fin[0]), y = gy(fin[1]);
    let ok = eau(x, y) || r._coupe && (fin[0] < LON0 + 0.3 || fin[0] > LON1 - 0.3 || fin[1] < LAT0 + 0.3 || fin[1] > LAT1 - 0.3);
    if (!ok) for (const o of rivers) { if (o !== r) for (let k = 0; k + 1 < o.pts.length && !ok; k++) ok = dSeg(fin, o.pts[k], o.pts[k + 1]) < 8; }
    if (!ok) for (const lac of waters) { if (lac.ring.some(q => km(q, fin) < 8)) { ok = true; break; } }
    if (!ok) {
      let m = 24, cible = null;
      for (let j = Math.floor(y) - 24; j <= y + 24; j++) for (let i = Math.floor(x) - 24; i <= x + 24; i++) { const d = Math.hypot(i + 0.5 - x, j + 0.5 - y); if (d < m && eau(i, j)) { m = d; cible = [arr3(lonDe(i + 0.5)), arr3(latDe(j + 0.5))]; } }
      if (!cible) { defauts.push(`fleuve ${r.name} : il finit à ${fin} sans mer, lac ni confluent à moins de 40 km`); continue; }
      r.pts.push(cible);
    }
    // un fleuve ne traverse pas la mer : au plus quelques points d'estuaire
    const enMer = r.pts.slice(0, -1).filter(p => { const c = Math.floor(gy(p[1])) * GW + Math.floor(gx(p[0])); return L[c] === 0; }).length;
    if (enMer > 4 && enMer > r.pts.length * 0.1) defauts.push(`fleuve ${r.name} : ${enMer} points sur ${r.pts.length} en pleine mer`);
    if (!r.pts.every(dansCadre)) stop(`fleuve ${r.name} : hors du cadre`);
    delete r._coupe;
  }
  if (defauts.length) stop(defauts.join('\n         '));
  console.log(`${rivers.length} fleuves : ` + journal.join(' ; '));
}

// ------------------------------------------------------------------ 5. le fichier de la carte, et le calcul du moteur refait
for (const c of CODES) if (!NOM_PAYS[c]) stop(`pays sans nom : ${c}`);
for (const c of Object.keys(NOM_PAYS)) if (!CODES.includes(c)) stop(`pays sans territoire : ${c}`);
const geo = { bounds: { lon0: LON0, lon1: LON1, lat0: LAT0, lat1: LAT1 }, lat_ref: LAT_REF, km_case: KM, depts: {}, rivers, waters, lands: [] };
for (const c of CODES) geo.depts[c] = { name: NOM_PAYS[c], playable: true, rings: contours.get(NOMS.indexOf(c)) };
for (let e = 1; e < NOMS.length; e++) if (NOMS[e] && NOMS[e][0] === '~' && e !== POCHE) for (const ring of contours.get(e)) geo.lands.push({ name: NOMS[e].slice(1), ring });

// geo.rs, _generate, à 5 km : pays (dans l'ordre des codes), trous bouchés, lacs, terres hors jeu
const fx = lon => (lon - LON0) * KX / KM, fy = lat => (LAT1 - lat) * KY / KM, NC = W * H;
const dept = new Uint8Array(NC), eauC = new Uint8Array(NC), hors = new Uint8Array(NC);
CODES.forEach((c, k) => { for (const ring of geo.depts[c].rings) remplir([ring], fx, fy, W, H, m => { dept[m] = k + 1; }); });
let bouchees = 0;
{
  const v4 = (c, f) => { const i = c % W; if (i < W - 1) f(c + 1); if (i > 0) f(c - 1); if (c < NC - W) f(c + W); if (c >= W) f(c - W); };
  const dehors = new Uint8Array(NC), file = [];
  for (let c = 0; c < NC; c++) { const i = c % W, j = (c - i) / W; if (!dept[c] && (i === 0 || i === W - 1 || j === 0 || j === H - 1)) { dehors[c] = 1; file.push(c); } }
  for (let q = 0; q < file.length; q++) v4(file[q], v => { if (!dehors[v] && !dept[v]) { dehors[v] = 1; file.push(v); } });
  for (let t = 0; t < 4; t++) for (let c = 0; c < NC; c++) if (!dept[c] && !dehors[c]) { let pris = 0; v4(c, v => { if (!pris && dept[v]) pris = dept[v]; }); if (pris) { dept[c] = pris; bouchees++; } }
}
for (const w of waters) remplir([w.ring], fx, fy, W, H, m => { eauC[m] = 1; });
for (const l of geo.lands) remplir([l.ring], fx, fy, W, H, m => { hors[m] = 1; });
// 0 mer, 1 lac, 2 terre hors jeu, 3 + k : pays k
const caseDe = new Uint8Array(NC);
for (let c = 0; c < NC; c++) caseDe[c] = eauC[c] ? 1 : dept[c] ? 2 + dept[c] : hors[c] ? 2 : 0;
const aires = Object.fromEntries(CODES.map(c => [c, 0]));
let ecarts = 0, terres = 0;
for (let c = 0; c < NC; c++) {
  if (caseDe[c] > 2) aires[CODES[caseDe[c] - 3]]++;
  const ref = L[(Math.floor(c / W) * F + 1) * GW + (c % W) * F + 1], attendu = !ref || ref === POCHE ? 0 : NOMS[ref][0] === '~' ? 2 : 3 + CODES.indexOf(NOMS[ref]);
  if (attendu) terres++;
  if (!eauC[c] && attendu !== caseDe[c]) ecarts++;
}
console.log(`calcul du moteur refait : ${ecarts} cases sur ${terres} de terre diffèrent de la grille de départ (${(100 * ecarts / terres).toFixed(2)} %), ${bouchees} cases de trou bouchées`);
if (ecarts > terres * 0.02) stop('les contours simplifiés s\'écartent de plus de 2 % de la grille de départ');
const codeCase = (lon, lat) => { const i = Math.floor(fx(lon)), j = Math.floor(fy(lat)); if (i < 0 || j < 0 || i >= W || j >= H) return null; const v = caseDe[j * W + i]; return v > 2 ? CODES[v - 3] : v === 2 ? '~' : v === 1 ? 'lac' : 'mer'; };

// ------------------------------------------------------------------ 6. places
// [nom, lat, lon, pays, type, étiquettes, remparts, population de 1790], comme places_france.json
const ROLES = ['arsenal', 'commerce', 'peche'];
const ESPACE_KM = Number(process.env.ESPACE || CARTE.espace || 115); // un bourg GeoNames est ajouté quand aucune place du pays n'est plus près
const places = [];
const recap = {};
{
  const cites = createRequire(path.join(path.resolve(NM), '_.js'))('all-the-cities') // GeoNames (villes de plus de 1 000 habitants)
    .filter(c => dansCadre(c.loc.coordinates)).sort((a, b) => b.population - a.population || a.cityId - b.cityId);
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const parNom = new Map();
  for (const c of cites) { const k = norm(c.name); if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(c); }
  // la case du pays la plus proche d'un point, à 3 cases (15 km) au plus : [distance en cases, lon, lat du centre]
  const versPays = (lon, lat, code) => {
    if (codeCase(lon, lat) === code) return [0, lon, lat];
    const x = fx(lon), y = fy(lat), i0 = Math.floor(x), j0 = Math.floor(y); let m = 3.01, out = null;
    for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H || caseDe[j * W + i] !== 3 + CODES.indexOf(code)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y); if (d < m) { m = d; out = [d, LON0 + (i + 0.5) * KM / KX, LAT1 - (j + 0.5) * KM / KY]; }
    }
    return out;
  };
  const presDe = (lon, lat, r, quoi) => { const i0 = Math.floor(fx(lon)), j0 = Math.floor(fy(lat)); for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) if (i < 0 || j < 0 || i >= W || j >= H ? quoi(0) : quoi(caseDe[j * W + i])) return true; return false; };
  // [lat, lon] arrondis à 1e-4° ; si l'arrondi passe dans une case d'autre sorte (un bourg au rivage tombait en mer),
  // arrondis vers le centre de la case, qu'ils ne quittent pas. (Une case voisine du même pays reste admise : l'Europe.)
  const arr4 = (lon, lat) => {
    const o = Math.round(lon * 1e4) / 1e4, a = Math.round(lat * 1e4) / 1e4;
    if (codeCase(o, a) === codeCase(lon, lat)) return [a, o];
    const x = fx(lon), y = fy(lat);
    return [(y % 1 < 0.5 ? Math.floor : Math.ceil)(lat * 1e4) / 1e4, (x % 1 < 0.5 ? Math.ceil : Math.floor)(lon * 1e4) / 1e4];
  };
  const dRiv = p => { let m = 1e9; for (const r of rivers) for (const q of r.pts) m = Math.min(m, km(q, p)); return m; };
  const villes = lire(path.join(DOSSIER, 'villes.json'));
  const defauts = [], deplacees = [], portsLoin = [];
  for (const c of Object.keys(villes)) if (c !== '_note' && !CODES.includes(c)) stop(`villes.json : pays inconnu ${c}`);
  for (const code of CODES) {
    const liste = [];
    (villes[code] || []).forEach((ligne, rang) => {
      const [nom, geo, pop, spec, fort] = ligne.split('|').map(s => s.trim());
      let trouve = null;
      for (const alt of geo ? geo.split('/') : [nom]) {
        if (alt[0] === '@') { const [la, lo] = alt.slice(1).split(',').map(Number); const v = versPays(lo, la, code); if (v) trouve = v; }
        else for (const c of parNom.get(norm(alt)) || []) { const v = versPays(c.loc.coordinates[0], c.loc.coordinates[1], code); if (v && (!trouve || v[0] === 0 && trouve[0] > 0)) { trouve = v; if (v[0] === 0) break; } }
        if (trouve) break;
      }
      if (!trouve) {
        const ou = (geo || nom).split('/').flatMap(a => (parNom.get(norm(a)) || []).slice(0, 2).map(c => `${c.name} (${c.country}, ${codeCase(...c.loc.coordinates)})`));
        defauts.push(`${nom}|${code} introuvable dans GeoNames sous « ${geo || nom} »` + (ou.length ? ` ; homonymes ailleurs : ${ou.join(', ')}` : ''));
        return;
      }
      if (trouve[0] > 0) deplacees.push(`${nom}|${code} (${(trouve[0] * KM).toFixed(0)} km)`);
      const etiq = spec ? spec.split(/\s+/) : [];
      for (const e of etiq) if (e !== 'port' && !ROLES.includes(e)) stop(`villes.json : étiquette inconnue « ${e} » (${nom}|${code})`);
      if (etiq.some(e => ROLES.includes(e)) && !etiq.includes('port')) stop(`villes.json : ${nom}|${code} a un rôle de port sans l'étiquette port`);
      liste.push({ nom, lon: trouve[1], lat: trouve[2], pop: Math.round(Number(pop) * 1000), etiq, fort: Number(fort), rang });
    });
    if (!liste.length) { defauts.push(`${code} : aucune ville dans villes.json`); continue; }
    // types : la capitale, les 24 plus grandes et toute ville de 10 000 âmes sont des villes, le reste des bourgs
    const parPop = liste.slice(1).sort((a, b) => b.pop - a.pop || a.rang - b.rang);
    liste.forEach(v => { v.type = v.rang === 0 ? 'capitale' : parPop.indexOf(v) < 24 || v.pop >= 10000 ? 'ville' : 'village'; });
    for (const v of liste) {
      const cote = presDe(v.lon, v.lat, 1, t => t === 0);
      if (v.type !== 'village' && cote && !v.etiq.includes('port')) v.etiq.unshift('port'); // toute ville côtière est un port
      // (PORTS_ADMIS de carte.mjs : estuaires trop étroits pour la carte)
      if (v.etiq.includes('port') && !presDe(v.lon, v.lat, 5, t => t < 2) && dRiv([v.lon, v.lat]) > 12 && !PORTS_ADMIS.includes(v.nom + '|' + code)) portsLoin.push(`${v.nom}|${code}`);
    }
    // bourgs de complément : les villes d'aujourd'hui les plus peuplées, là où aucune place du pays n'est à moins de ESPACE_KM
    const k = 3 + CODES.indexOf(code), noms = new Set(liste.map(v => norm(v.nom)));
    for (const c of cites) {
      const [lon, lat] = c.loc.coordinates, i = Math.floor(fx(lon)), j = Math.floor(fy(lat));
      if (i < 0 || j < 0 || i >= W || j >= H || caseDe[j * W + i] !== k || noms.has(norm(c.name)) || !norm(c.name)) continue;
      if (liste.some(v => km([v.lon, v.lat], [lon, lat]) < ESPACE_KM)) continue;
      noms.add(norm(c.name));
      const pop = Math.round((800 + 3200 * Math.min(1, Math.max(0, (Math.log10(Math.max(c.population, 1000)) - 3) / 3))) / 100) * 100; // 800 à 4 000 âmes
      liste.push({ nom: c.name, lon, lat, pop, etiq: [], fort: 0, type: 'village', bourg: true });
    }
    for (const v of liste) places.push([v.nom, ...arr4(v.lon, v.lat), code, v.type, v.etiq, v.fort, v.pop]);
    recap[code] = { villes: liste.filter(v => v.type !== 'village').length, ports: liste.filter(v => v.etiq.includes('port')).length,
      bourgs: liste.filter(v => v.type === 'village').length, pop25: [liste[0], ...parPop.slice(0, 24)].reduce((s, v) => s + v.pop, 0), loin: 0, max: 0 };
    PAYS[code].capital = liste[0].nom;
  }
  if (defauts.length) stop(defauts.join('\n         '));
  if (deplacees.length) console.log(`places ramenées dans leur pays (contour simplifié, île ou rivage) : ${deplacees.join(', ')}`);
  if (portsLoin.length) stop('ports à plus de 25 km de la mer, d\'un lac ou d\'un fleuve de la carte : ' + portsLoin.join(', '));

  // vérifications
  const vus = new Set(), slugs = new Set();
  for (const p of places) {
    const [nom, lat, lon, code, type, etiq, fort, pop] = p, cle = nom + '|' + code;
    if (vus.has(cle)) stop(`doublon ${cle}`); vus.add(cle);
    if (!dansCadre([lon, lat])) stop(`${cle} hors du cadre`);
    if (codeCase(lon, lat) !== code) stop(`${cle} n'est pas dans son pays (case : ${codeCase(lon, lat)})`);
    if (!Number.isInteger(pop) || pop <= 0) stop(`${cle} : population ${pop}`);
    if (!['capitale', 'ville', 'village'].includes(type) || !(fort >= 0 && fort <= 4) || !Number.isInteger(fort)) stop(`${cle} : type ou remparts`);
    if (type === 'village' && !etiq.length && (pop < 100 || pop > 9999)) stop(`${cle} : bourg de ${pop} âmes`);
  }
  for (const code of CODES) {
    if (places.filter(p => p[3] === code && p[4] === 'capitale').length !== 1) stop(`${code} : il faut une capitale et une seule`);
    if (places.filter(p => p[3] === code).length < 3) stop(`${code} : moins de 3 places`);
  }
  // aucun point habité d'un pays à plus de 150 km d'une de ses places (habité : une ville GeoNames du pays à moins de 30 km)
  const habite = new Uint8Array(NC);
  for (const c of cites) { const [lon, lat] = c.loc.coordinates, i0 = Math.floor(fx(lon)), j0 = Math.floor(fy(lat)); if (i0 < 0 || j0 < 0 || i0 >= W || j0 >= H) continue; const k = caseDe[j0 * W + i0]; if (k < 3) continue;
    for (let j = Math.max(0, j0 - 6); j <= Math.min(H - 1, j0 + 6); j++) for (let i = Math.max(0, i0 - 6); i <= Math.min(W - 1, i0 + 6); i++) if (caseDe[j * W + i] === k && Math.hypot(i - i0, j - j0) <= 6) habite[j * W + i] = 1; }
  const parPays = Object.fromEntries(CODES.map(c => [c, places.filter(p => p[3] === c).map(p => [fx(p[2]), fy(p[1])])]));
  for (let c = 0; c < NC; c++) {
    if (caseDe[c] < 3) continue;
    const code = CODES[caseDe[c] - 3], x = c % W + 0.5, y = Math.floor(c / W) + 0.5; let m = 1e9;
    for (const q of parPays[code]) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < m) m = d; }
    if (m * KM > 150) { recap[code].loin++; if (habite[c]) stop(`${code} : un point habité (${lonDe(x * F).toFixed(2)}, ${latDe(y * F).toFixed(2)}) est à ${(m * KM).toFixed(0)} km de toute place`); }
    if (habite[c] && m * KM > recap[code].max) recap[code].max = m * KM;
  }
}

// ------------------------------------------------------------------ 7. époques
const epoques = {};
{
  const ETIQ = ['paix', 'guerres', 'ville', 'bourg', 'declin', 'grande_ville', 'capitale_fr', 'industrie', 'mines', 'grand_port', 'port_neuf', 'arsenal', 'ville_neuve', 'hivernants', 'thermes', 'bains', 'forges', 'gare'];
  const src = lire(path.join(DOSSIER, 'epoques.json')), pop = new Map(places.map(p => [p[0] + '|' + p[3], p[7]]));
  for (const [cle, pts] of Object.entries(src)) {
    if (cle === '_note') continue;
    const p0 = pop.get(cle);
    if (!p0) stop(`epoques.json : ${cle} n'est pas une place`);
    if (pts.length < 4 || pts.length > 8 || pts[0][0] !== 1700 || pts[pts.length - 1][0] !== 1900) stop(`epoques.json : ${cle} : 4 à 8 points, de 1700 à 1900`);
    pts.forEach((p, k) => { if (k && p[0] <= pts[k - 1][0] || !(p[1] > 0) || !ETIQ.includes(p[2])) stop(`epoques.json : ${cle} : point ${JSON.stringify(p)}`); });
    const p1790 = pts.find(p => p[0] === 1790);
    if (!p1790 || Math.round(p1790[1] * 1000) !== p0) stop(`epoques.json : ${cle} : la population de 1790 doit être celle de villes.json (${p0 / 1000})`);
    epoques[cle] = pts.map(p => [p[0], p[0] === 1790 ? 1.0 : Math.round(p[1] * 1000 / p0 * 1000) / 1000, p[2]]);
  }
}

// ------------------------------------------------------------------ 8. pays
{
  const hex = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
  const voisins = new Set();
  for (let c = 0; c < NC; c++) for (const v of [c + 1, c + W]) if (v < NC && caseDe[c] > 2 && caseDe[v] > 2 && caseDe[c] !== caseDe[v]) voisins.add([caseDe[c], caseDe[v]].sort((a, b) => a - b).join(','));
  for (const [c, p] of Object.entries(PAYS)) {
    if (!/^#[0-9a-f]{6}$/.test(p.color)) stop(`${c} : couleur ${p.color}`);
    for (const k of Object.keys(p.mods)) if (!CLES_MODS.includes(k)) stop(`${c} : le moteur ne lit pas le mod « ${k} »`);
    if (!['livres', 'vivres', 'fer', 'bois', 'armes', 'outils', 'recrues'].includes(p.specialty) || !['civil', 'militaire', 'industriel', 'agricole'].includes(p.personality.tech)) stop(`${c} : spécialité ou penchant`);
    if (p.short.length > 12 || !places.some(q => q[3] === c && q[4] === 'capitale' && q[0] === p.capital)) stop(`${c} : nom court ou capitale`);
  }
  const proches = [];
  for (const v of voisins) { const [a, b] = v.split(',').map(k => CODES[k - 3]), [x, y] = [hex(PAYS[a].color), hex(PAYS[b].color)]; if (Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 70) proches.push(`couleurs trop proches entre voisins : ${a} ${PAYS[a].color} et ${b} ${PAYS[b].color}`); }
  if (proches.length) stop(proches.join('\n         '));
}

// ------------------------------------------------------------------ sorties
const ecrire = (f, o) => { fs.writeFileSync(path.join(DATA, f), o); JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); return `${f} ${(o.length / 1024).toFixed(0)} Ko`; };
const tailles = [
  ecrire(SORTIES.carte, JSON.stringify(geo) + '\n'),
  ecrire(SORTIES.places, '[\n' + places.map(p => JSON.stringify(p)).join(',\n') + '\n]\n'),
  ecrire(SORTIES.pays, '{\n' + CODES.map(c => { // l'ordre des clés du jeu, quel que soit celui de carte.mjs
    const { name, short, capital, color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty, moyens, maisons, culture } = PAYS[c];
    return JSON.stringify(c) + ': ' + JSON.stringify({ name, short, capital, color, adj, title, pros, cons, mods, personality: { aggr, trade, expand, tech }, specialty, moyens, maisons, culture });
  }).join(',\n') + '\n}\n'),
  ecrire(SORTIES.epoques, '{\n' + Object.entries(epoques).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + '\n}\n'),
  ecrire(SORTIES.cultures, Object.keys(CULTURES).length ? '{\n' + Object.entries(CULTURES).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + '\n}\n' : '{}\n'),
];
if (APERCU) {
  const E = 2, X = lon => (fx(lon) * E).toFixed(1), Y = lat => (fy(lat) * E).toFixed(1), d = r => 'M' + r.map(p => X(p[0]) + ' ' + Y(p[1])).join('L') + 'Z';
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * E}" height="${H * E}" font-family="sans-serif"><rect width="100%" height="100%" fill="#cfe3f2"/>`;
  for (const l of geo.lands) s += `<path d="${d(l.ring)}" fill="#d9d6c8" stroke="#999" stroke-width=".5"/>`;
  for (const c of CODES) s += `<path d="${geo.depts[c].rings.map(d).join('')}" fill="${PAYS[c].color}" fill-opacity=".55" stroke="#333" stroke-width=".6"/>`;
  for (const w of waters) s += `<path d="${d(w.ring)}" fill="#8fbfe6" stroke="#4a86b8" stroke-width=".4"/>`;
  for (const r of rivers) s += `<path d="M${r.pts.map(p => X(p[0]) + ' ' + Y(p[1])).join('L')}" fill="none" stroke="#1d5fa8" stroke-width="${[0, 1.6, 1.1, 0.8][r.rank]}"/>`;
  for (const p of places) if (p[4] !== 'capitale') s += `<circle cx="${X(p[2])}" cy="${Y(p[1])}" r="${p[4] === 'village' ? 1.3 : 2.2}" fill="${p[5].includes('port') ? '#0b3d91' : p[4] === 'village' ? '#555' : '#b3261e'}"/>`
    + (process.env.NOMS ? `<text x="${+X(p[2]) + 3}" y="${+Y(p[1]) + 2}" font-size="5">${esc(p[0])}</text>` : '');
  for (const c of CODES) { const r = geo.depts[c].rings[0]; s += `<text x="${X(r.reduce((a, p) => a + p[0], 0) / r.length)}" y="${Y(r.reduce((a, p) => a + p[1], 0) / r.length)}" font-size="18" font-weight="bold" fill="#0007" text-anchor="middle">${c}</text>`; }
  for (const p of places) if (p[4] === 'capitale') s += `<circle cx="${X(p[2])}" cy="${Y(p[1])}" r="3.5" fill="#000" stroke="#fff"/><text x="${+X(p[2]) + 5}" y="${+Y(p[1]) + 4}" font-size="11" font-weight="bold" stroke="#fff" stroke-width="2.5" paint-order="stroke">${esc(p[0])}</text>`;
  fs.writeFileSync(APERCU, s + '</svg>\n');
  console.log('aperçu : ' + APERCU);
}
console.log(`\n${places.length} places, ${Object.keys(epoques).length} trajectoires d'époque, ${rivers.length} fleuves, ${waters.length} lacs, ${geo.lands.length} terres hors jeu`);
console.log('pays  villes  ports  bourgs  pop. des 25  aire (cases)  cases à > 150 km (désert)  place la plus loin d\'un lieu habité');
for (const c of CODES) { const r = recap[c]; console.log(`${c}  ${String(r.villes).padStart(6)} ${String(r.ports).padStart(6)} ${String(r.bourgs).padStart(7)} ${String(r.pop25).padStart(12)} ${String(aires[c]).padStart(13)} ${String(r.loin).padStart(12)} ${(r.max.toFixed(0) + ' km').padStart(22)}  ${PAYS[c].name}`); }
if (places.length < CARTE.places[0] || places.length > CARTE.places[1]) stop(`${places.length} places : on en vise ${CARTE.places[0]} à ${CARTE.places[1]} (régler carte.espace ou ESPACE, aujourd'hui ${ESPACE_KM} km)`);
console.log('écrit : ' + tailles.join(' ; '));
