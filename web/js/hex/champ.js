// Le champ de bataille en plateau d'hexagones (SPEC-HEX.md), d'après la maquette validée (web/js/dev/bataille-hex.html) :
// même champ et même échelle que le moteur (3 000 × 2 000 m), un hexagone de 40 m prend le type de case majoritaire
// des cases de 20 m qu'il couvre (routes, chemins et gués mis à part : tracés à leur place) et leur hauteur moyenne
// (relief à moitié, pour que les calques 2D tombent juste). Les bâtiments sont plus détaillés que sur la maquette :
// chaque case bâtie de la ville porte sa maison, façade sur la rue, à la manière du pays ; les bâtiments isolés ont
// leurs vraies dimensions ; église, cathédrale, caserne, couvent, hôpital, halle, château, forge, moulins (ailes qui
// tournent) ont leur modèle. Toits crevés, incendies et ruines suivent l'état envoyé par le serveur (bati) ; brèches
// et barricades refont l'enceinte. Les troupes (hex/troupes3d.js) et les effets, la vie, l'interface (calques 2D)
// viennent par-dessus.
import { THREE, DEGRADE, Scene3D, Grille, lot, put, fige, jeter, transfere, boite, cyl, cone, sphere, ruban, hache, semer, rnd, entre, choix, toit, pavillon } from './moteur.js';
import * as M from './modeles.js';
import { CELL_NAMES } from '../battle/formes.js';

const SOL = {
  PRE: 0x84c450, CHAMP: 0xc9c65c, VIGNE: 0xb4b660, LANDE: 0xaaa762, BOIS: 0x6aa843, FORET: 0x4e8a34, MARAIS: 0x6f9e6a, EAU: 0xd2c88f, GUE: 0xd2c88f,
  ROUTE: 0xcfc3a3, CHEMIN: 0xd9c79a, BATI: 0xcfc3a3, MUR: 0xbfb39a, BRECHE: 0xa79a7a, PORTE: 0xcfc3a3, SABLE: 0xead9a2, ROCHE: 0x9c968c, BARRICADE: 0xb59a6a, VERGER: 0x8cc45a,
};
const EAU_Y = -0.5, REL = 0.5;   // relief : la moitié des hauteurs du moteur
const TRACES = new Set(['ROUTE', 'CHEMIN', 'GUE']);
const TOITS = { ardoise: 0x5b5866, chaume: 0xb89a5a, lauze: 0x7a7268 };
const NOBLE = new Set(['cathedrale', 'eglise', 'caserne', 'poudriere', 'hopital', 'couvent', 'hotel', 'halle', 'chateau', 'forge', 'scierie', 'sechoir', 'moulin']);

export class Champ {
  // canvas : canevas WebGL sous celui de la bataille ; m : carte du moteur (/api/tactic_map) ; terrain : battle/terrain.js
  constructor(canvas, m, terrain) {
    this.m = m; this.tr = terrain;
    this.sc = new Scene3D(canvas, { fond: 0x1b211a, ombreMax: 500 });
    const g = this.g = new Grille(terrain.W, terrain.H, 40);
    this.f = g.f; this.sc.soleil.shadow.normalBias = 0.4 * g.f;
    this.racine = new THREE.Group(); this.racine.scale.setScalar(g.f); this.sc.monde.add(this.racine);
    this.dept = (/\((\d\d)\)/.exec(m.region || '') || [])[1] || '33';
    this.st = M.style(this.dept);
    this.ailes = [];            // ailes des moulins : elles tournent
    this.objets = [];           // bâtiments : { cases, etat, bati(), grp }
    this.parCase = new Map();   // case → indices des bâtiments qui la couvrent
    this.etat = new Uint8Array(terrain.cols * terrain.rows);
    this.echantillonner();
    this.tuiles();
    const eau = new THREE.Mesh(new THREE.PlaneGeometry(terrain.W / g.f + 600, terrain.H / g.f + 600), new THREE.MeshToonMaterial({ color: 0x3fa6dc, gradientMap: DEGRADE, transparent: true, opacity: 0.72 }));
    eau.rotation.x = -Math.PI / 2; eau.position.set(terrain.W / g.f / 2, EAU_Y, terrain.H / g.f / 2); this.racine.add(eau);
    this.decor(); this.traces(); this.batiments(); this.murs(); this.barricades();
    this.ambiance(m.weather, m.season);
  }
  ambiance(meteo, saison) {
    const gris = meteo === 'pluie' || meteo === 'brouillard' || meteo === 'nuages' || meteo === 'orage' || meteo === 'tempete' || meteo === 'neige';
    const s = this.sc;
    s.ciel.intensity = gris ? 1.35 : 1.5; s.soleil.intensity = gris ? 2.1 : 2.6;
    s.soleil.color.set(gris ? 0xe6ecf0 : saison === 'automne' ? 0xffe2b8 : 0xfff0d4);
    s.sale = true;
  }
  u(m) { return m / this.f; }

  // ---------------------------------------------------------------- les hexagones
  echantillonner() {
    const { g, tr } = this, C = tr.cell, RK = g.RK;
    let h0 = 1e9;
    for (const t of g.liste) {
      const cnt = new Map(); let hs = 0, n = 0;
      for (let j = Math.floor((t.gy - RK) / C); j <= Math.floor((t.gy + RK) / C); j++) for (let i = Math.floor((t.gx - RK) / C); i <= Math.floor((t.gx + RK) / C); i++) {
        if (i < 0 || j < 0 || i >= tr.cols || j >= tr.rows || Math.hypot((i + 0.5) * C - t.gx, (j + 0.5) * C - t.gy) > RK + C * 0.5) continue;
        const c = j * tr.cols + i, k = CELL_NAMES[tr.t[c]] || 'PRE';
        cnt.set(k, (cnt.get(k) || 0) + (TRACES.has(k) ? 0.01 : 1)); hs += tr.h[c]; n++;
      }
      let b = 'PRE', bv = -1; for (const [k, v] of cnt) if (v > bv) { bv = v; b = k; }
      t.t = b; t.hm = n ? hs / n : 0; h0 = Math.min(h0, t.hm);
    }
    for (const t of g.liste) t.top = (t.hm - h0) * REL / this.f - (t.t === 'EAU' || t.t === 'GUE' ? 1.6 : 0);
    this.h0 = h0;
  }
  estEau(t) { return t.t === 'EAU' || t.t === 'GUE'; }
  sol(t) { return Math.max(t.top, EAU_Y + 0.1); }
  // hauteur du sol (m) sous un point du champ : les figures s'y posent, les calques 2D aussi
  hauteur(x, y) { const t = this.g.en(x, y); return t ? this.sol(t) * this.f : 0; }
  tuiles() {
    const { g } = this, L = lot(), saison = this.m.season, c = new THREE.Color();
    for (const t of g.liste) {
      const bas = -12, h = t.top - bas;
      const geo = put(L, cyl(g.R * 0.965, g.R, h, 6), SOL[t.t] || SOL.PRE, t.x, bas + h / 2, t.z, 0, 0);
      semer(t.q, t.r);
      c.set(SOL[t.t] || SOL.PRE).offsetHSL((rnd() - 0.5) * 0.015, 0, (rnd() - 0.5) * 0.05);
      if (saison === 'hiver' && !this.estEau(t)) c.lerp(new THREE.Color(0xf1f4f6), 0.35);
      else if (saison === 'automne' && (t.t === 'BOIS' || t.t === 'FORET' || t.t === 'PRE')) c.lerp(new THREE.Color(0xc98a3c), 0.2);
      else if ((saison === 'été' || saison === 'ete') && (t.t === 'CHAMP' || t.t === 'PRE')) c.lerp(new THREE.Color(0xd8c45a), 0.2);
      const nr = geo.attributes.normal, co = geo.attributes.color;
      for (let i = 0; i < co.count; i++) { const k = nr.getY(i) > 0.5 ? 1 : 0.62; co.setXYZ(i, c.r * k, c.g * k, c.b * k); }
    }
    fige(L, this.racine, { contour: false });
    // la grille : le contour de chaque hexagone (calque « Grille »)
    const p = [];
    for (const t of g.liste) for (let i = 0; i < 3; i++) { const a = Math.PI / 180 * (60 * i - 30), b = a + Math.PI / 3; p.push(t.x + g.R * Math.cos(a), t.top + 0.2, t.z + g.R * Math.sin(a), t.x + g.R * Math.cos(b), t.top + 0.2, t.z + g.R * Math.sin(b)); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    this.grille = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2b1d14, transparent: true, opacity: 0.35 }));
    this.grille.visible = false; this.racine.add(this.grille);
  }

  // ---------------------------------------------------------------- le décor des champs
  decor() {
    const { g } = this, L = lot(), R = g.R;
    for (const t of g.liste) {
      semer(t.q, t.r);
      const y = t.top, rr = (k = 0.62) => { const a = rnd() * Math.PI * 2, l = Math.sqrt(rnd()) * R * k; return [t.x + Math.cos(a) * l, t.z + Math.sin(a) * l]; };
      if (t.t === 'BOIS' || t.t === 'FORET') for (let i = 0, nb = t.t === 'FORET' ? 6 : 4; i < nb; i++) { const [x, z] = rr(); M.arbre(L, x, y, z, entre(0.85, 1.2), t.t === 'FORET' && (this.dept === '64' || rnd() < 0.4) ? 'sapin' : this.dept === '40' && rnd() < 0.6 ? 'pin' : 'feuillu'); }
      if (t.t === 'VERGER') for (let i = 0; i < 3; i++) { const [x, z] = rr(0.55); M.arbre(L, x, y, z, 1, 'fruitier'); }
      if (t.t === 'CHAMP') { const a = hache(t.q >> 2, t.r >> 2, 3) * Math.PI; for (let k = -2; k <= 2; k++) put(L, boite(14 - Math.abs(k) * 2.6, 0.3, 2.6), [0xe3c75b, 0xd6b24a, 0xbfae4f][(k + 9 + (t.q >> 2)) % 3], t.x + Math.sin(a) * k * 2.9, y + 0.15, t.z + Math.cos(a) * k * 2.9, a, 0); }
      if (t.t === 'VIGNE') { const a = hache(t.q >> 2, t.r >> 2, 4) * Math.PI; for (let k = -3; k <= 3; k++) put(L, boite(12 - Math.abs(k) * 1.7, 0.8, 0.55), 0x557a2e, t.x + Math.sin(a) * k * 1.7, y + 0.4, t.z + Math.cos(a) * k * 1.7, a, 0.1); }
      if (t.t === 'LANDE') for (let i = 0; i < 3; i++) { const [x, z] = rr(), b = sphere(entre(0.8, 1.2), 0); b.scale(1.3, 0.5, 1); put(L, b, 0x9a6f9e, x, y + 0.2, z, 0, 0.1); }
      if (t.t === 'MARAIS') for (let i = 0; i < 2; i++) { const [x, z] = rr(); put(L, cyl(entre(1.4, 2.2), entre(1.4, 2.2), 0.06, 9), 0x46a9dd, x, y + 0.04, z, 0, 0); for (let k = 0; k < 4; k++) put(L, cyl(0.06, 0.1, 1.3, 4), 0x9cae5a, x + entre(-2, 2), y + 0.65, z + entre(-2, 2), 0, 0); }
      if (t.t === 'ROCHE') for (let i = 0; i < 2; i++) { const [x, z] = rr(); put(L, sphere(entre(1.2, 2.4), 0), 0x8f8879, x, y + 0.6, z); }
      if (t.t === 'PRE' && rnd() < 0.18) { const [x, z] = rr(); put(L, sphere(0.9, 0), 0x5fa83c, x, y + 0.5, z); }
    }
    fige(L, this.racine);
  }

  // ---------------------------------------------------------------- routes, rivières, ponts, haies, clôtures
  traces() {
    const { g, tr } = this, L = lot(), W = lot(), sol = t => this.sol(t);
    tr.roads.forEach((pts, k) => {
      const kind = tr.roadKinds[k] || 'route', w = this.u(kind === 'royale' ? 9 : kind === 'route' ? 6.5 : 4) / 2;
      const p = g.suivre(pts, 2, 0.12, sol).map(([x, y, z]) => [x, y, z]);
      put(L, ruban(p.map(q => [q[0], q[1] - 0.02, q[2]]), w + 0.35), 0x6b5236, 0, 0, 0, 0, 0);
      put(L, ruban(p, w), kind === 'chemin' ? 0xd9c79a : 0xf1e4bd, 0, 0, 0, 0, 0);
    });
    for (const r of tr.rivers) {
      const p = g.suivre(r.pts, 2, 0.1, t => t.top).map(([x, y, z]) => [x, Math.max(y, EAU_Y + 0.1), z]), w = this.u(r.w) / 2;
      put(L, ruban(p.map(q => [q[0], q[1] - 0.03, q[2]]), w + 1), 0xdccf96, 0, 0, 0, 0, 0); put(W, ruban(p, w), 0x46a9dd, 0, 0, 0, 0, 0);
    }
    // ponts de pierre : tablier, parapets, piles
    for (const b of tr.bridgesIn || []) {
      const t = g.en(b.x, b.y), y = t ? Math.max(this.sol(t), 0.2) + 0.5 : 0.7, l = this.u(b.len), ry = -b.a, B = lot();
      put(B, boite(l, 0.5, this.u(7)), 0xc9bb98, 0, 0, 0, 0, 0.14);
      for (const s of [-1, 1]) put(B, boite(l, 0.6, 0.35), 0xbfb39a, 0, 0.5, s * this.u(3.3), 0, 0.08);
      for (let k = -1; k <= 1; k++) put(B, boite(0.9, 2.4, this.u(6)), 0xb9ad8f, k * l / 3, -1.2, 0, 0, 0.1);
      transfere(B, L, this.u(b.x), y, this.u(b.y), ry);
    }
    // haies (boules de verdure), clôtures et murets
    for (const hd of this.m.hedges || []) for (const [x, y, z] of g.suivre(hd, 1.6, 0, sol)) { semer(x * 10, z * 10); const b = sphere(entre(0.8, 1.05), 0); b.scale(1, 0.8, 1); put(L, b, choix([0x4f9a37, 0x5fae3e]), x, y + 0.7, z, 0, 0.12); }
    for (const fe of tr.fences) {
      const p = g.suivre(fe.pts, 3, 0, sol), muret = fe.kind === 'muret';
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, ay, az] = p[i], [bx, , bz] = p[i + 1], l = Math.hypot(bx - ax, bz - az), a = -Math.atan2(bz - az, bx - ax);
        put(L, boite(l, muret ? 0.7 : 0.5, muret ? 0.45 : 0.12), muret ? 0xbfb39a : 0x8a6a4a, (ax + bx) / 2, ay + (muret ? 0.35 : 0.45), (az + bz) / 2, a, muret ? 0.08 : 0);
        if (!muret) put(L, boite(0.18, 0.8, 0.18), 0x7a5233, ax, ay + 0.4, az, 0, 0);
      }
    }
    fige(L, this.racine, { ombre: false }); fige(W, this.racine, { ombre: false, contour: false });
  }

  // ---------------------------------------------------------------- les bâtiments
  // chaque objet bâti : ses cases (états du serveur), son lot selon l'état (0 intact, 1 touché, 2 en feu, 3 ruine)
  ajouter(cases, bati) {
    const k = this.objets.length, o = { cases, etat: 0, bati, grp: null };
    this.objets.push(o);
    for (const c of cases) { if (!this.parCase.has(c)) this.parCase.set(c, []); this.parCase.get(c).push(k); }
    this.refaire(o);
  }
  refaire(o) {
    jeter(o.grp);
    const L = lot(); semer(o.cases[0] || 0, 17); o.bati(L, o.etat);
    o.grp = fige(L, this.racine); this.sc.sale = true;
  }
  // état reçu du serveur : [[case, état], …]
  bati(etats) {
    const sales = new Set();
    for (const [c, e] of etats || []) {
      if (this.etat[c] === e) continue;
      this.etat[c] = e;
      for (const k of this.parCase.get(c) || []) sales.add(k);
    }
    for (const k of sales) { const o = this.objets[k]; const e = Math.max(...o.cases.map(c => this.etat[c] || 0)); if (e !== o.etat) { o.etat = e; this.refaire(o); } }
  }
  toitDe(kind) { return TOITS[kind] ?? undefined; }
  // une maison (ou un bâtiment simple) d'après l'état : touchée, toit noirci ; en feu, toit crevé ; ruine, murs bas
  maisonEtat(L, x, y, z, ry, etat, o) {
    const B = lot();
    if (etat >= 3) {   // ruine : pans de murs, poutres noircies
      const w = (o.w ?? 2.4) * (o.s ?? 1), d = (o.d ?? 2) * (o.s ?? 1);
      for (const [u, v, a] of [[0, d / 2, 0], [w / 2, 0, Math.PI / 2], [-w / 2, 0, Math.PI / 2]]) put(B, boite(a ? d * entre(0.5, 1) : w * entre(0.6, 1), entre(0.6, 1.6) * (o.s ?? 1), 0.3), 0x8a8070, u, 0.5, v, a, 0.08);
      for (let k = 0; k < 3; k++) put(B, boite(w * 0.8, 0.2, 0.2), 0x2a2522, entre(-w / 3, w / 3), 0.3, entre(-d / 3, d / 3), entre(0, 3), 0);
    } else M.maison(B, this.st, 0, 0, 0, { ...o, toitCol: etat >= 2 ? 0x2a2522 : etat === 1 ? 0x6a4a3a : o.toitCol });
    transfere(B, L, x, y, z, ry);
  }
  batiments() {
    const { g, tr } = this, C = tr.cell, T = tr.t, nomDe = c => CELL_NAMES[T[c]] || 'PRE';
    const sol = (x, y) => { const t = g.en(x, y); return t ? this.sol(t) : 0; };
    // les bâtiments isolés (fermes, granges, moulins…) : leurs vraies dimensions et leur orientation
    const pris = new Set();
    for (const b of tr.buildings) {
      const cases = [];
      for (let j = Math.floor((b.y - b.h / 2) / C); j <= Math.floor((b.y + b.h / 2) / C); j++) for (let i = Math.floor((b.x - b.w / 2) / C); i <= Math.floor((b.x + b.w / 2) / C); i++) if (i >= 0 && j >= 0 && i < tr.cols && j < tr.rows) { const c = j * tr.cols + i; if (nomDe(c) === 'BATI') { cases.push(c); pris.add(c); } }
      const x = this.u(b.x), z = this.u(b.y), y = sol(b.x, b.y), w = this.u(b.w), d = this.u(b.h), ry = -b.a, tc = this.toitDe(b.toit);
      this.ajouter(cases, (L, e) => this.isole(L, b.kind, x, y, z, ry, w, d, tc, e));
    }
    // la ville : les bâtiments du plan (batis), les grands chacun son modèle, les îlots une maison par case
    for (const b of this.m.batis || []) {
      const cases = (b.c || []).filter(c => !pris.has(c));
      if (!cases.length) continue;
      cases.forEach(c => pris.add(c));
      const tc = this.toitDe(b.toit);
      if (NOBLE.has(b.kind)) {
        // l'axe du bâtiment : celui de ses cases
        let mx = 0, my = 0; for (const c of cases) { mx += c % tr.cols; my += (c / tr.cols) | 0; } mx /= cases.length; my /= cases.length;
        let sxx = 0, syy = 0, sxy = 0; for (const c of cases) { const dx = c % tr.cols - mx, dy = ((c / tr.cols) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ext = this.u(Math.max(C, Math.sqrt(cases.length) * C * 1.1));
        const x = this.u((mx + 0.5) * C), z = this.u((my + 0.5) * C), y = sol((mx + 0.5) * C, (my + 0.5) * C);
        this.ajouter(cases, (L, e) => this.noble(L, b.kind, x, y, z, ang, ext, cases.length, tc, e));
      } else {
        // une maison par case, façade sur la rue (la case voisine qui n'est pas bâtie)
        for (const c of cases) {
          const i = c % tr.cols, j = (c / tr.cols) | 0, x = this.u((i + 0.5) * C), z = this.u((j + 0.5) * C), y = sol((i + 0.5) * C, (j + 0.5) * C);
          let ry = null;
          for (const [di, dj] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
            const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= tr.cols || jj >= tr.rows) continue;
            const n = nomDe(jj * tr.cols + ii); if (n !== 'BATI' && n !== 'MUR') { ry = Math.atan2(di, dj); break; }
          }
          const et = b.kind === 'ferme' ? 1 : 2 + (hache(i, j, 5) < 0.35 ? 1 : 0), ouverte = ry != null;
          this.ajouter([c], (L, e) => this.maisonEtat(L, x, y, z, ouverte ? ry : (hache(i, j, 6) * 4 | 0) * Math.PI / 2, e, { s: 3.1, w: 2.6, d: 2.4, etages: et, details: ouverte, toitCol: tc }));
        }
      }
    }
  }
  // un bâtiment isolé : w (le long de son axe) × d, unités du plateau ; ry tourne son axe
  isole(L, kind, x, y, z, ry, w, d, tc, etat) {
    if (kind === 'moulin') return this.moulin(L, x, y, z, ry, Math.max(w, d) / 2.4, etat);
    const s = Math.max(1, d / 2), lw = w / s;
    this.maisonEtat(L, x, y, z, ry, etat, { s, w: Math.max(2.2, lw), d: 2, etages: kind === 'ferme' ? 1 : 1 + (hache(x, z, 3) < 0.3 ? 1 : 0), toitCol: tc });
    w /= 2;
    if (kind === 'ferme' && etat < 3) {   // la cour de ferme : un fumier, une charrette, un arbre
      put(L, sphere(0.9, 0), 0x6b5a3a, x + Math.cos(ry) * (w + 2), y + 0.3, z - Math.sin(ry) * (w + 2), 0, 0.08);
      M.arbre(L, x - Math.cos(ry) * (w + 3), y, z + Math.sin(ry) * (w + 3) + 2, 0.8, 'fruitier');
    }
  }
  moulin(L, x, y, z, ry, s, etat) {
    if (etat >= 3) { this.maisonEtat(L, x, y, z, ry, 3, { s }); return; }
    const B = lot();
    put(B, cyl(0.95, 1.25, 3.4, 10), 0xeee6d2, 0, 1.7, 0, 0, 0.12); put(B, cone(1.2, 1.2, 10), etat >= 2 ? 0x2a2522 : 0x6e4a30, 0, 4, 0, 0, 0.1);
    transfere(B, L, x, y, z, ry, s);
    if (etat >= 2) return;
    // les ailes à part : un groupe qui tourne (image)
    const A = lot();
    for (let k = 0; k < 4; k++) { const b = boite(0.5, 2.6, 0.06); b.translate(0, 1.4, 0); b.rotateZ(k * Math.PI / 2); put(A, b, 0xf2ead8, 0, 0, 0, 0, 0.06); }
    const grp = fige(A, null); grp.scale.setScalar(s); grp.position.set(x + Math.sin(ry) * 1.3 * s, y + 3.3 * s, z + Math.cos(ry) * 1.3 * s); grp.rotation.y = ry;
    this.ailes.push(grp); this.racine.add(grp);
  }
  // les grands bâtiments : ext la longueur (unités du plateau), n le nombre de cases
  noble(L, kind, x, y, z, ang, ext, n, tc, etat) {
    const st = this.st, B = lot(), ry = Math.PI / 2 - ang;
    if (etat >= 3) { this.maisonEtat(L, x, y, z, ry, 3, { s: ext / 3, w: 2.6, d: 2.2 }); return; }
    switch (kind) {
      case 'cathedrale': M.cathedrale(B, 0, 0, 0, ext / 14); break;
      case 'eglise': M.eglise(B, st, 0, 0, 0, Math.max(1.6, ext / 6.5), this.dept); break;
      case 'chateau': M.chateau(B, st, 0, 0, 0, ext / 8); break;
      case 'halle': M.halle(B, st, 0, 0, Math.PI / 2, ext / 6.5); break;
      case 'couvent': {   // le cloître : quatre ailes autour d'un préau, une chapelle
        const s = ext / 9;
        for (const [u, v, a] of [[0, -3, 0], [0, 3, 0], [-3, 0, Math.PI / 2], [3, 0, Math.PI / 2]]) M.maison(B, st, u * s, v * s, a, { s, w: 6, d: 1.6, etages: 2, toitCol: tc });
        put(B, boite(4.2 * s, 0.1, 4.2 * s), 0x84c450, 0, 0.05, 0, 0, 0);
        M.eglise(B, st, 0, -6 * s, Math.PI / 2, s * 0.9, this.dept); break;
      }
      case 'hopital': { const s = ext / 9; M.maison(B, st, 0, 0, Math.PI / 2, { s, w: 8, d: 2.4, etages: 2, toitCol: tc }); M.eglise(B, st, -2.8 * s, 0, 0, s * 0.6, this.dept); break; }
      case 'caserne': { const s = ext / 9; M.maison(B, st, 0, 0, Math.PI / 2, { s, w: 8.6, d: 2.6, etages: 3, col: 0xe9dcc0, toitCol: tc ?? 0x5b5866 }); put(B, boite(4 * s, 0.1, 8 * s), 0xc9bc98, 2.8 * s, 0.05, 0, 0, 0); break; }
      case 'hotel': { const s = ext / 4.2; M.maison(B, st, 0, 0, Math.PI / 2, { s, w: 3.6, d: 2.6, etages: 3, col: 0xf3ead6, toitCol: tc ?? 0x5b5866 }); break; }
      case 'poudriere': { const s = ext / 4; put(B, boite(2.4 * s, 1.6 * s, 3 * s), 0xb9ad8f, 0, 0.8 * s, 0, 0, 0.14); pavillon(B, 2.8 * s, 3.4 * s, 1.2 * s, 0x6d6a75, 0, 1.6 * s, 0, 0, 0.12); break; }
      case 'forge': { const s = ext / 4; M.maison(B, st, 0, 0, Math.PI / 2, { s, w: 3, etages: 1, toitCol: tc }); put(B, cyl(0.35 * s, 0.5 * s, 4.2 * s, 8), 0xa8573a, 1.1 * s, 2.1 * s, -0.6 * s, 0, 0.1); break; }
      case 'scierie': { const s = ext / 4; M.maison(B, st, 0, 0, Math.PI / 2, { s, w: 3.4, etages: 1, details: false, col: 0x9c7a52, toitCol: tc }); for (let k = 0; k < 4; k++) { const b = cyl(0.3 * s, 0.3 * s, 2.6 * s, 6); b.rotateZ(Math.PI / 2); put(B, b, 0xa0703f, 0, 0.3 * s + (k >> 1) * 0.6 * s, (2 + (k & 1) * 0.6) * s, 0, 0.06); } break; }
      case 'sechoir': { const s = ext / 4; put(B, boite(2.6 * s, 3 * s, 2 * s), 0x8a6a4a, 0, 1.5 * s, 0, 0, 0.12); toit(B, 2.2 * s, 2.9 * s, 1.2 * s, tc ?? 0xb4513a, 0, 3 * s, 0, Math.PI / 2, 0.1); break; }
      case 'moulin': this.moulin(L, x, y, z, ry, ext / 4, etat); return;
      default: M.maison(B, st, 0, 0, Math.PI / 2, { s: ext / 4, etages: 2, toitCol: tc });
    }
    // touché ou en feu : quelques poutres noircies et des gravats au pied
    if (etat >= 1) for (let k = 0; k < 2 + etat * 2; k++) put(B, boite(entre(0.6, 1.4), entre(0.3, 0.7), entre(0.6, 1.2)), etat >= 2 ? 0x2a2522 : 0x8a8070, entre(-ext / 3, ext / 3), 0.3, entre(-ext / 3, ext / 3), entre(0, 3), 0.06);
    transfere(B, L, x, y, z, ry);
  }

  // ---------------------------------------------------------------- l'enceinte (refaite après une brèche) et les barricades
  murs() {
    jeter(this.grpMurs);
    const { g, tr } = this, L = lot(), sol = t => this.sol(t);
    for (const w of tr.walls) {
      const bastion = w.kind === 'bastion', palis = w.kind === 'palissade', breches = (w.breach || []).map(b => [b[0], b[1], b[2] || 20]);
      const pts = g.suivre(w.pts, 3, 0, sol), H = palis ? 1 : bastion ? this.u(6) : this.u(7), ep = palis ? 0.4 : this.u(w.thick ? Math.min(w.thick, 12) : 4);
      if (bastion && w.fosse) put(L, ruban(pts.map(p => [p[0], p[1] + 0.06, p[2]]), this.u(w.fosse) / 2 + ep), 0x5f8a4a, 0, 0, 0, 0, 0);   // fossé et glacis
      const ouvert = (x, z) => breches.some(([bx, by, r]) => Math.hypot(x * this.f - bx, z * this.f - by) < r);
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az), a = -Math.atan2(bz - az, bx - ax), y0 = Math.min(ay, by), mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (ouvert(mx, mz)) { semer(mx, mz); for (let k = 0; k < 3; k++) put(L, sphere(entre(0.8, 1.6), 0), 0xa79a7a, mx + entre(-2, 2), y0 + 0.3, mz + entre(-2, 2)); continue; }   // la brèche : des gravats
        if (palis) { put(L, boite(l + 0.2, 2.2, 0.45), 0x8a6a4a, mx, y0 + 1.1, mz, a, 0.12); continue; }
        put(L, boite(l + 0.4, H, ep), bastion ? 0xcdb98c : 0xc9bb98, mx, y0 + H / 2, mz, a, 0.18);
        if (bastion) put(L, boite(l + 0.4, 0.9, Math.min(ep, 1.4)), 0x8fae5a, mx, y0 + H + 0.2, mz, a, 0.1);
        else for (let k = -1; k <= 1; k += 2) put(L, boite(0.6, 0.6, 0.6), 0xc2b38f, mx + Math.cos(-a) * k * l / 4, y0 + H + 0.3, mz + Math.sin(-a) * k * l / 4, a, 0);   // merlons
      }
      for (const [x, y] of w.tours || []) { const t = g.en(x, y), yy = t ? sol(t) : 0, X = this.u(x), Z = this.u(y); put(L, cyl(1.9, 2.1, H + 2, 10), 0xc2b38f, X, yy + (H + 2) / 2, Z, 0, 0.18); put(L, cone(2.3, 2.6, 10), 0x6d6a75, X, yy + H + 3.3, Z, 0, 0.14); }
      // portes : deux tours de part et d'autre, ou un pavillon d'entrée à la Vauban
      const vues = [];
      for (const [x, y] of w.portes || []) {
        if (vues.some(([px, py]) => Math.hypot(px - x, py - y) < 45)) continue; vues.push([x, y]);
        const t = g.en(x, y), yy = t ? sol(t) : 0, X = this.u(x), Z = this.u(y);
        if (bastion) { put(L, boite(5, H + 1.4, 4), 0xd9c9a0, X, yy + (H + 1.4) / 2, Z, 0, 0.16); pavillon(L, 5.6, 4.6, 1.8, 0x5b5866, X, yy + H + 1.4, Z, 0, 0.12); }
        else for (const s of [-1, 1]) { put(L, cyl(1.4, 1.6, H + 2.4, 8), 0xc2b38f, X + s * 2.4, yy + (H + 2.4) / 2, Z, 0, 0.16); put(L, cone(1.8, 2.2, 8), 0x6d6a75, X + s * 2.4, yy + H + 3.5, Z, 0, 0.12); }
      }
    }
    // demi-lunes devant les courtines
    for (const dl of this.m.demi_lunes || []) {
      const p = g.suivre(dl, 3, 0, sol);
      for (let i = 0; i < p.length - 1; i++) { const [ax, ay, az] = p[i], [bx, , bz] = p[i + 1], l = Math.hypot(bx - ax, bz - az); put(L, boite(l + 0.4, this.u(5), this.u(4)), 0xc4b083, (ax + bx) / 2, ay + this.u(2.5), (az + bz) / 2, -Math.atan2(bz - az, bx - ax), 0.14); }
    }
    this.grpMurs = fige(L, this.racine); this.sc.sale = true;
  }
  barricades() {
    jeter(this.grpBarr);
    const { tr } = this, L = lot(), C = tr.cell, B = CELL_NAMES.indexOf('BARRICADE');
    for (let c = 0; c < tr.t.length; c++) {
      if (tr.t[c] !== B) continue;
      const i = c % tr.cols, j = (c / tr.cols) | 0, x = this.u((i + 0.5) * C), z = this.u((j + 0.5) * C), t = this.g.sous(x, z), y = t ? this.sol(t) : 0;
      semer(i, j);
      for (let k = 0; k < 3; k++) {   // charrettes renversées, tonneaux, planches et pieux
        const px = x + entre(-3, 3), pz = z + entre(-3, 3);
        if (rnd() < 0.4) { const b = boite(3, 1, 1.8); b.rotateZ(0.5); put(L, b, 0xb08a5a, px, y + 1, pz, rnd() * 3, 0.12); }
        else if (rnd() < 0.5) put(L, cyl(0.6, 0.6, 1.3, 8), 0x9c7a52, px, y + 0.65, pz, 0, 0.1);
        else put(L, boite(entre(3, 5), 1.6, 0.5), 0x8a6a4a, px, y + 0.8, pz, rnd() * 3, 0.12);
      }
    }
    this.grpBarr = fige(L, this.racine); this.sc.sale = true;
  }

  // ---------------------------------------------------------------- cratères (les tués : hex/troupes3d.js)
  cratere(x, y, r = 2.6) {
    const t = this.g.en(x, y); if (!t) return;
    if (!this.trous) {
      const geo = new THREE.CircleGeometry(1, 10); geo.rotateX(-Math.PI / 2);
      this.trous = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x4a3a28, transparent: true, opacity: 0.8, depthWrite: false }), 1500);
      this.trous.count = 0; this.trous.frustumCulled = false; this.racine.add(this.trous); this.nTrous = 0;
    }
    const m = new THREE.Matrix4().compose(new THREE.Vector3(this.u(x), this.sol(t) + 0.05, this.u(y)), new THREE.Quaternion(), new THREE.Vector3(this.u(r), 1, this.u(r)));
    this.trous.setMatrixAt(this.nTrous % 1500, m); this.nTrous++; this.trous.count = Math.min(this.nTrous, 1500); this.trous.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- chaque image
  image(cam, vw, vh, dpr, time) {
    for (const a of this.ailes) a.rotation.z = time * 0.9;
    this.sc.caler(cam, vw, vh, dpr);
    this.sc.rendre(true);
  }
  dispose() { this.sc.dispose(); }
}
