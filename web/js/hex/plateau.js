// La carte de campagne en plateau d'hexagones (SPEC-HEX.md), d'après la maquette validée (web/js/dev/carte-hex.html) :
// même géographie et même échelle que le jeu, un hexagone de 4 km d'un bord plat à l'autre prend le terrain, le
// département et la rivière majoritaires des cases de 1 km qu'il couvre (map.terrain, map.dept, map.river) ; rivières
// (map.rivers) et routes (map.edges) à leur vraie place, vallées mises à plat. Les villes et les villages sont bâtis
// d'après l'état de la partie (camp qui les tient, remparts, agrandissements, siège) : plus grands et plus détaillés que
// sur la maquette, à la manière de leur pays. Les territoires sont une teinte des hexagones et un liseré aux couleurs du
// camp. Tout le reste (vie des pays, armées, interface, ciel) reste dessiné par les calques 2D au-dessus (map.js).
import { THREE, DEGRADE, Scene3D, Grille, lot, put, fige, jeter, transfere, boite, cyl, cone, sphere, ruban, hache, bruit, semer, rnd, entre, choix, K, C } from './moteur.js';
import * as M from './modeles.js';
import { phylloxera } from '../epoque.js';

const GEO = ['mer', 'eau', 'plaine', 'foret', 'lande', 'marais', 'colline', 'montagne', 'haute', 'dunes', 'vigne'];
// couleurs et hauteurs (unités du plateau ; le relief reste bas pour que les calques 2D tombent juste)
const TERR = {
  mer: { nom: 'Océan', col: 0x1d5a86, h: -4, eau: 1 }, cote: { nom: 'Côte', col: 0xe6d49a, h: -2, eau: 1 }, eau: { nom: 'Étang, estuaire', col: 0xd2c88f, h: -2, eau: 1 },
  plaine: { nom: 'Plaine cultivée', col: 0xc9c65c, h: 0 }, prairie: { nom: 'Prairie', col: 0x84c450, h: 0 }, foret: { nom: 'Forêt', col: 0x5d9b3a, h: 0.15 },
  lande: { nom: 'Lande de pins', col: 0xaaa762, h: 0.1 }, marais: { nom: 'Marais', col: 0x6f9e6a, h: -0.1 }, colline: { nom: 'Collines', col: 0xa2b65a, h: 1.1 },
  montagne: { nom: 'Montagne', col: 0x8f8879, h: 2 }, haute: { nom: 'Haute montagne', col: 0xa29b8e, h: 3 }, dunes: { nom: 'Dunes', col: 0xead9a2, h: 0.35 },
  vigne: { nom: 'Vignoble', col: 0xb4b660, h: 0.12 }, ville: { nom: 'Ville', col: 0xd6cbab, h: 0.25 },
};
const EAU_Y = -0.7, PARCHEMIN = new THREE.Color(0xdcc79a), NEIGE = new THREE.Color(0xf1f4f6), ROUX = new THREE.Color(0xc98a3c), BLOND = new THREE.Color(0xd8c45a);
// le paysage des siècles (epoque.js, 2c) : pinède semée sur la lande, marais drainé, vigne roussie par le phylloxéra
const PINEDE = new THREE.Color(0x6f9445), DRAINE = new THREE.Color(0x8fbf58), ROUSSI = new THREE.Color(0x9c7a48);
// la carte d'époque (map.js, majPapier) : les teintes au lavis de Cassini (papier, bois gris-vert), puis de l'état-major
const PAPIER = {
  cassini: { fond: 0xeadfbf, foret: 0xa9b388, lande: 0xd9cfa6, marais: 0xb9c2a2, vigne: 0xd8c9a6, prairie: 0xe2dcb4, colline: 0xdcd0a8, montagne: 0xc9bb9a, haute: 0xe6e0d0, ville: 0xd7b9a0, cote: 0xe6dcb6, eau: 0xb7c3bc, mer: 0x9fb4b4, dunes: 0xeee2c0 },
  etatmajor: { fond: 0xf0e8cc, foret: 0x9fc27c, lande: 0xd8d6a0, marais: 0xa7c6b4, vigne: 0xcfa6c0, prairie: 0xcfe0a2, colline: 0xe0d4ac, montagne: 0xd2c2a2, haute: 0xeae6dc, ville: 0xe1a796, cote: 0xeee2bc, eau: 0x96c6dc, mer: 0x86b8d6, dunes: 0xf2e6c4 },
};
const RANG = { capitale: 0, fort: 1, ville: 2, village: 3 };
const MAXB = 90, MAXL = 260, Z_LIEUX = 3;   // blocs du décor et places bâtis au plus ; zoom (px/km) dès lequel on bâtit les places

export class Plateau {
  // mp : la carte (map.js) ; canvas : le canevas WebGL posé sous le sien
  constructor(mp, canvas) {
    this.mp = mp;
    this.sc = new Scene3D(canvas, { fond: 0x141618, ombreMax: 70 });
    const g = this.g = new Grille(mp.W, mp.H, 4);
    this.sc.soleil.shadow.normalBias = 0.4 * g.f;
    this.racine = new THREE.Group(); this.racine.scale.setScalar(g.f); this.sc.monde.add(this.racine);
    this.ailes = [];             // ailes des moulins : elles tournent (image)
    this.lieux = new Map();      // id de la place → { n, t (hexagones), grp, cle }
    this.file = [];              // ce qui reste à bâtir, un peu à chaque image
    this.saison = null;
    this.echantillonner();
    this.placerLieux();
    this.rivieres();
    for (const t of g.liste) t.top = TERR[t.t].h + (t.t === 'montagne' || t.t === 'haute' ? (hache(t.q, t.r, 9) - 0.5) * 0.8 : 0);
    this.tuiles();
    const eau = new THREE.Mesh(new THREE.PlaneGeometry(mp.W / g.f + 400, mp.H / g.f + 400), new THREE.MeshToonMaterial({ color: 0x3fa6dc, gradientMap: DEGRADE, transparent: true, opacity: 0.72 }));
    eau.rotation.x = -Math.PI / 2; eau.position.set(mp.W / g.f / 2, EAU_Y, mp.H / g.f / 2); eau.receiveShadow = true; this.racine.add(eau);
    // le décor des pays et les routes se bâtissent par paquets ; les places, d'après l'état de la partie
    // (par morceaux, que le paysage des siècles refait un à un : paysage)
    // (toute la France : par blocs de 16 × 16 hexagones, bâtis quand la caméra s'en approche, libérés loin d'elle : voir)
    const blocs = new Map();
    for (const t of g.liste) {
      const k = (t.row >> 4) * 4096 + (t.col >> 4);
      let m = blocs.get(k);
      if (!m) blocs.set(k, m = { liste: [], grp: null, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, vu: 0 });
      m.liste.push(t); m.x0 = Math.min(m.x0, t.gx); m.x1 = Math.max(m.x1, t.gx); m.y0 = Math.min(m.y0, t.gy); m.y1 = Math.max(m.y1, t.gy);
    }
    this.morceaux = [...blocs.values()];
    this.file.push(() => this.routes());
  }

  // ---------------------------------------------------------------- la géographie, hexagone par hexagone
  echantillonner() {
    const { mp, g } = this, W = mp.W, H = mp.H, RK = g.RK;
    const cases = []; let n = 0;
    for (const t of g.liste) {
      const ter = new Map(), dep = new Map(); let riv = 0, jeu = 0, terre = 0;
      const c0 = n;
      for (let j = Math.floor(t.gy - RK); j <= Math.floor(t.gy + RK); j++) for (let i = Math.floor(t.gx - RK); i <= Math.floor(t.gx + RK); i++) {
        if (Math.hypot(i + 0.5 - t.gx, j + 0.5 - t.gy) > RK * 0.95) continue;
        if (i < 0 || j < 0 || i >= W || j >= H) { ter.set(0, (ter.get(0) || 0) + 1); continue; }
        const c = j * W + i, k = mp.terrain[c];
        ter.set(k, (ter.get(k) || 0) + 1); dep.set(mp.dept[c], (dep.get(mp.dept[c]) || 0) + 1);
        if (mp.river[c]) riv = Math.min(riv || 9, mp.river[c]);
        if (k > 1) { terre++; jeu += mp.playable[c]; }
        cases.push(c); n++;
      }
      t.cases = [c0, n];
      const maj = m => { let b = 0, bv = -1; for (const [k, v] of m) if (v > bv) { bv = v; b = k; } return b; };
      t.t = GEO[maj(ter)] || 'mer';
      if (t.t === 'plaine' && bruit(t.col * 0.35, t.row * 0.35) > 0.56) t.t = 'prairie';
      t.g0 = t.t;
      const di = maj(dep); t.dep = di > 0 ? mp.deptCodes[di - 1] : '';
      t.jeu = terre > 0 && jeu * 2 >= terre;
      t.rivC = riv;
    }
    this.cases = Int32Array.from(cases);
    for (const t of g.liste) if (t.t === 'mer' && g.voisins(t).some(v => !TERR[v.t].eau)) t.t = 'cote';
  }
  estEau(t) { return !!TERR[t.t].eau; }

  // chaque place sur son hexagone ; les grandes villes s'étendent sur les voisins
  placerLieux() {
    const { mp, g } = this;
    const ordre = mp.nodes.slice().sort((a, b) => RANG[a.type] - RANG[b.type] || (b.pop0 || 0) - (a.pop0 || 0));
    for (const n of ordre) {
      let t = g.en(n.x, n.y);
      if (!t) continue;
      if (t.lieu || this.estEau(t)) t = g.voisins(t).filter(v => !v.lieu && !this.estEau(v)).sort((a, b) => Math.hypot(a.gx - n.x, a.gy - n.y) - Math.hypot(b.gx - n.x, b.gy - n.y))[0] || t;
      if (t.lieu) continue;
      const nb = n.type === 'capitale' ? (n.pop0 > 50000 ? 6 : 2) : n.type === 'ville' && n.pop0 > 7000 ? 1 : 0;
      const hex = [t], libres = g.voisins(t).filter(v => !v.lieu && !this.estEau(v)).sort((a, b) => hache(a.q, a.r, 3) - hache(b.q, b.r, 3));
      hex.push(...libres.slice(0, nb));
      hex.forEach((h, i) => { h.lieu = n; h.coeur = i === 0; if (n.type !== 'village') h.t = 'ville'; });
      this.lieux.set(n.id, { n, t, hex, grp: null, cle: '' });
    }
  }

  // les rivières du jeu : les vallées qu'elles traversent sont à plat
  rivieres() {
    const { mp, g } = this;
    this.rivs = []; this.eau = new Map();
    // (et les canaux ouverts dès 1700, Midi, Briare, Orléans, comme de petites rivières : le plateau est bâti une fois, les
    // canaux plus jeunes n'y sont pas dessinés ; map.js prepEdges a noté leur année)
    const canaux = (mp.m.ways || []).filter(w => w.year && w.year <= 1700).map(w => ({ name: w.name, rank: 3, pts: w.pts }));
    for (const rv of [...mp.m.rivers, ...canaux]) {
      const pts = rv.pts;
      for (let i = 0; i < pts.length; i++) {
        const t = g.en(pts[i][0], pts[i][1]);
        if (!t || this.estEau(t)) continue;
        t.riv = Math.min(t.riv || 9, rv.rank);
        if (t.t === 'colline' || t.t === 'montagne' || t.t === 'haute') t.t = rv.rank < 3 || t.t === 'colline' ? 'prairie' : 'colline';
      }
      this.rivs.push(rv);
      // les points de la rivière, hexagone par hexagone, avec la demi-largeur peinte (eau et berges) : rien ne s'y bâtit
      for (const [x, , z, t] of g.suivre(pts, 1.5, 0)) if (t) { const [w, b] = this.largeur(rv.rank, t.t === 'ville'); if (!this.eau.has(t.i)) this.eau.set(t.i, []); this.eau.get(t.i).push([x, z, w + b]); }
    }
    // les étangs et les lacs trop petits pour faire un hexagone d'eau : une mare par case d'eau de 1 km (decor), où rien
    // ne se bâtit non plus
    for (let c = 0; c < mp.W * mp.H; c++) {
      if (mp.terrain[c] !== 1) continue;
      const x = (c % mp.W + 0.5) / g.f, z = (Math.floor(c / mp.W) + 0.5) / g.f, t = g.sous(x, z);
      if (!t || this.estEau(t)) continue;
      (t.etangs ||= []).push([x, z]);
      if (!this.eau.has(t.i)) this.eau.set(t.i, []); this.eau.get(t.i).push([x, z, 3.2]);
    }
  }
  // un point du plateau (unités du plateau) dans l'eau ou sur une rivière et ses berges, à marge près ?
  mouille(x, z, marge = 1.4) {
    const t = this.g.sous(x, z);
    if (!t || this.estEau(t)) return true;
    for (const h of [t, ...this.g.voisins(t)]) for (const [px, pz, w] of this.eau.get(h.i) || []) if (Math.hypot(x - px, z - pz) < w + marge) return true;
    return false;
  }
  // demi-largeurs (unités du plateau) de l'eau et de la berge d'une rivière de ce rang ; en ville, l'eau entre des quais
  largeur(rank, ville) { const w = [0, 1.9, 1.3, 0.85][rank] || 0.85; return ville ? [w * 0.45, 0.35] : [w, 1]; }
  // une rivière passe-t-elle sur l'hexagone ou un voisin ?
  pres(t) { return this.eau.has(t.i) || this.g.voisins(t).some(h => this.eau.has(h.i)); }

  // ---------------------------------------------------------------- les tuiles (un seul maillage, recoloré selon la saison)
  tuiles() {
    const { g } = this, L = lot();
    this.base = [];
    for (const t of g.liste) {
      const d = TERR[t.t], bas = -8, h = t.top - bas;
      put(L, cyl(g.R * 0.965, g.R, h, 6), d.col, t.x, bas + h / 2, t.z, 0, 0);
      semer(t.q, t.r);
      const c = new THREE.Color(d.col).offsetHSL((rnd() - 0.5) * 0.015, 0, (rnd() - 0.5) * 0.05);
      if (!t.jeu && !this.estEau(t)) c.lerp(PARCHEMIN, 0.55);
      this.base.push(c);
    }
    this.grpTuiles = fige(L, this.racine, { contour: false });
    this.colorer('printemps', false);
  }
  // les tuiles à la saison : neige l'hiver (partout en montagne, en plaine s'il a neigé), roux l'automne, blé mûr l'été
  colorer(saison = this.sais, neige = this.neige) {
    this.sais = saison; this.neige = neige;
    const cle = saison + (neige ? '+' : '') + '|' + (this.versionPays || 0) + '|' + (this.era || '');
    if (cle === this.saison) return;
    this.saison = cle;
    const geo = this.grpTuiles.children[0].geometry, co = geo.attributes.color, nr = geo.attributes.normal, n = co.count / this.g.liste.length, c = new THREE.Color();
    this.g.liste.forEach((t, i) => {
      c.copy(this.base[i]);
      if (this.era) c.lerp(new THREE.Color(PAPIER[this.era][t.t] ?? PAPIER[this.era].fond), 0.82);
      const p = this.sigPays(t);
      if (p) c.lerp(t.t === 'lande' ? PINEDE : t.t === 'marais' ? DRAINE : t.t === 'vigne' ? ROUSSI : c, t.t === 'lande' ? p * 0.22 : t.t === 'vigne' ? 0.3 : t.t === 'marais' ? 0.45 : 0);
      if (!this.estEau(t)) {
        if (saison === 'hiver') c.lerp(NEIGE, t.t === 'haute' || t.t === 'montagne' ? 0.8 : neige ? 0.6 : 0.12);
        else if (saison === 'automne' && (t.t === 'foret' || t.t === 'prairie' || t.t === 'colline')) c.lerp(ROUX, 0.22);
        else if ((saison === 'été' || saison === 'ete') && (t.t === 'plaine' || t.t === 'prairie')) c.lerp(BLOND, 0.22);
        else if (t.t === 'haute') c.lerp(NEIGE, 0.5);
      }
      for (let k = i * n; k < (i + 1) * n; k++) { const f = nr.getY(k) > 0.5 ? 1 : 0.62; co.setXYZ(k, c.r * f, c.g * f, c.b * f); }
    });
    co.needsUpdate = true; this.sc.sale = true;
  }

  // la carte d'époque : 'cassini', 'etatmajor' ou null (les couleurs de la nature)
  papier(era) { if (era !== this.era) { this.era = era; this.colorer(); this.sc.sale = true; } }

  // ---------------------------------------------------------------- le paysage des siècles (epoque.js, 2c)
  // les marques du camp qui tient l'hexagone (territoire) : le paysage suit le maître, comme sur la carte d'avant
  marques(t) { return t.fac >= 0 && this.codes ? this.mp.epoque.of(this.codes[t.fac]) : null; }
  // ce que l'époque change à l'hexagone (0 : rien) ; le décor bâti le garde dans t.pays
  sigPays(t) {
    const m = this.marques(t);
    switch (t.t) {
      case 'lande': return m?.has('landes1857') ? 2 : m?.has('pins') ? 1 : 0;
      case 'marais': return m?.has('drainage') ? 1 : 0;
      case 'vigne': return phylloxera(this.mp.epoque.year, m) ? 1 : 0;
      case 'plaine': return (m?.has('mais') && (t.dep === '40' || t.dep === '64') ? 1 : 0) + (m?.has('assolement') ? 2 : 0);
      default: return 0;
    }
  }
  // après un changement des marques, de l'année ou des territoires : les morceaux du décor qui ont changé sont refaits
  // (le neuf bâti avant que l'ancien parte : rien ne clignote), les tuiles recolorées
  paysage() {
    if (!this.morceaux) return;
    let n = 0;
    for (const m of this.morceaux) {
      if (!m.grp || m.attente || m.liste.every(t => (t.pays || 0) === this.sigPays(t))) continue;
      m.attente = true; n++;
      this.file.push(() => { m.attente = false; const old = m.grp; m.grp = this.decor(m.liste); jeter(old); });
    }
    if (n || this.versionPays === undefined) { this.versionPays = (this.versionPays || 0) + 1; this.colorer(); }
  }

  // ---------------------------------------------------------------- le décor des pays
  decor(liste) {
    const { g } = this, L = lot(), R = g.R, tourn = [];
    for (const t of liste) {
      t.pays = this.sigPays(t);   // (ce que l'époque a changé à l'hexagone, au moment de son décor : paysage)
      // les étangs : l'eau (assez large pour que deux cases voisines se rejoignent), sa grève, des roseaux
      if (t.etangs) for (const [x, z] of t.etangs) {
        semer(x * 7 | 0, z * 7 | 0);
        put(L, cyl(3.5, 3.6, 0.08, 12), 0xcfc690, x, t.top + 0.03, z, rnd(), 0);
        put(L, cyl(3.15, 3.15, 0.1, 12), 0x46a9dd, x, t.top + 0.06, z, rnd(), 0);
        for (let k = 0; k < 3; k++) { const a = rnd() * 6.3; put(L, cyl(0.06, 0.1, 1.1, 4), 0x9cae5a, x + Math.cos(a) * 3.3, t.top + 0.55, z + Math.sin(a) * 3.3, 0, 0); }
      }
      if (t.lieu || this.estEau(t)) { if (t.t === 'cote') { semer(t.q, t.r); if (rnd() < 0.2) put(L, sphere(entre(0.8, 1.4), 0), 0x9b958a, t.x + entre(-4, 4), t.top + 0.6, t.z + entre(-4, 4)); } continue; }
      semer(t.q, t.r);
      const fane = !t.jeu, y = t.top, peu = t.riv ? 0.5 : 1, pays = t.pays;
      const pres = this.pres(t);
      const rr = (k = 0.62) => {   // un point de l'hexagone, hors de la rivière (cinq essais)
        for (let n = 0; ; n++) { const a = rnd() * Math.PI * 2, l = Math.sqrt(rnd()) * R * k, p = [t.x + Math.cos(a) * l, t.z + Math.sin(a) * l]; if (n >= 4 || !pres || !this.mouille(p[0], p[1], 1)) return p; }
      };
      const col = c => (fane ? new THREE.Color(c).lerp(PARCHEMIN, 0.5) : c);
      if (t.t === 'foret') for (let i = 0, nb = (6 + (rnd() * 3 | 0)) * peu; i < nb; i++) { const [x, z] = rr(); M.arbre(L, x, y, z, entre(0.8, 1.25), t.dep === '64' || rnd() < 0.3 ? 'sapin' : 'feuillu', fane ? 0x9aa070 : undefined); }
      if (t.t === 'lande') {   // pins maritimes, bruyère, une parc à brebis, de loin en loin une maison de résinier
        // (les semis de pins, puis la loi de 1857, font de la lande rase une forêt de pins : deux, puis trois fois plus)
        for (let i = 0, nb = (4 + (rnd() * 3 | 0)) * peu * [1, 2, 3][pays]; i < nb; i++) { const [x, z] = rr(pays ? 0.8 : 0.62); M.arbre(L, x, y, z, entre(0.8, 1.15) * (pays === 2 ? 1.1 : 1), 'pin'); }
        for (let i = 0; i < 2 - pays; i++) { const [x, z] = rr(), b = sphere(entre(0.8, 1.2), 0); b.scale(1.3, 0.5, 1); put(L, b, col(0x9a6f9e), x, y + 0.2, z, 0, 0.1); }
        if (rnd() < 0.12) { const [x, z] = rr(0.4); M.maison(L, M.style('40'), x, z, rnd() * 6, { s: 0.7 }); }
      }
      if (t.t === 'marais') {
        // drainé, le marais n'a plus qu'une mare : des prés coupés de fossés, une rangée de peupliers
        for (let i = 0; i < (pays ? 1 : 3); i++) {
          const [x, z] = rr(), r = pays ? 0.6 : 1; put(L, cyl(entre(1.4, 2.4) * r, entre(1.4, 2.4) * r, 0.06, 9), 0x46a9dd, x, y + 0.04, z, 0, 0);
          for (let k = 0; k < 4; k++) put(L, cyl(0.06, 0.1, 1.3, 4), 0x9cae5a, x + entre(-2, 2), y + 0.65, z + entre(-2, 2), 0, 0);
        }
        if (pays) {
          const a = hache(t.q >> 1, t.r >> 1, 6) * Math.PI;
          for (let k = -2; k <= 2; k++) put(L, boite(12 - Math.abs(k) * 2, 0.04, 0.22), 0x3f93c4, t.x + Math.cos(a + Math.PI / 2) * k * 2.6, y + 0.03, t.z - Math.sin(a + Math.PI / 2) * k * 2.6, a, 0);
          for (let k = 0; k < 3; k++) { const [x, z] = rr(0.7); M.arbre(L, x, y, z, 0.7, 'peuplier'); }
        }
      }
      if (t.t === 'colline') {
        for (let i = 0; i < 2; i++) { const [x, z] = rr(), b = sphere(entre(3, 4.4), 1); b.scale(1, 0.38, 1); put(L, b, col(0x97ad52), x, y, z, 0, 0.2); }
        if (rnd() < 0.15 && t.jeu) { const [x, z] = rr(0.4); M.moulin(L, x, z, rnd() * 6, 0.8, rnd(), tourn, y); }
        else if (rnd() < 0.4) { const [x, z] = rr(); M.arbre(L, x, y + 0.6, z, 0.9); }
      }
      if (t.t === 'montagne' || t.t === 'haute') for (let i = 0, nb = 1 + (rnd() * 2 | 0); i < nb; i++) {
        const hh = t.t === 'haute' ? 1.35 : 1, [x, z] = i ? rr() : [t.x + entre(-1, 1), t.z + entre(-1, 1)], s = (i ? entre(0.6, 0.8) : entre(1, 1.2)) * hh;
        put(L, cone(6 * s, 9 * s, 5), col(0x8a8173), x, y + 4.5 * s, z, rnd() * 2);
        const k = t.t === 'haute' ? 0.62 : 0.43; put(L, cone(6 * s * k, 9 * s * k, 5), 0xf7f5ee, x, y + 9 * s - 4.5 * s * k, z, 0, 0.12);
        if (t.t === 'montagne' && rnd() < 0.5) { const [ax, az] = rr(); M.arbre(L, ax, y, az, 0.8, 'sapin'); }
      }
      if (t.t === 'plaine' && !t.riv) {   // champs en lanières, et parfois une ferme à cour avec sa haie
        const a = hache(t.q >> 1, t.r >> 1, 3) * Math.PI;
        // (le maïs de Chalosse et du Béarn, haut et vert ; la luzerne et la betterave de l'assolement)
        for (let i = 0; i < 4 + (pays & 2 ? 1 : 0); i++) {
          const [x, z] = rr(), mais = pays & 1 && i % 2 === 0, cul = mais ? 0x8fae3e : choix(pays & 2 ? [0xe3c75b, 0xa9c457, 0x7f9c4f, 0x4f8a3a, 0xb6a46a] : [0xe3c75b, 0xd6b24a, 0xa9c457, 0xc9a55a]), h = mais ? 1.1 : 0.5;
          put(L, boite(entre(3, 5), h, entre(1.6, 2.6)), col(cul), x, y + h / 2, z, a + entre(-0.2, 0.2), 0.15);
          if (mais) for (let k = -1; k <= 1; k++) put(L, boite(entre(3, 4.6), 0.12, 0.12), 0xd6c25a, x + Math.sin(a) * k * 0.6, y + h + 0.06, z + Math.cos(a) * k * 0.6, a, 0);   // panicules
        }
        if (t.jeu && rnd() < 0.3) this.ferme(L, t, rr(0.45));
      }
      if (t.t === 'prairie') {
        if (!t.riv && rnd() < 0.5) { const [x, z] = rr(); M.arbre(L, x, y, z, 0.8); }
        if (t.riv) for (let i = 0; i < 3; i++) { const [x, z] = rr(0.7); M.arbre(L, x, y, z, 0.75, 'peuplier'); }   // peupliers au bord de l'eau
        if (t.jeu && !t.riv && rnd() < 0.25) this.ferme(L, t, rr(0.45));
      }
      if (t.t === 'vigne') {   // rangs de vigne, et un chai
        const a = hache(t.q >> 1, t.r >> 1, 4) * Math.PI;
        // (de 1875 aux plants greffés, le phylloxéra roussit les rangs ; certains sont arrachés)
        for (let k = -3; k <= 3; k++) { const mal = pays && hache(t.q + k, t.r, 8) < 0.7; if (mal && hache(t.q, t.r + k, 9) < 0.25) continue; put(L, boite(11 - Math.abs(k) * 1.6, mal ? 0.5 : 0.7, 0.55), col(mal ? 0x9a7444 : 0x557a2e), t.x + Math.cos(a + Math.PI / 2) * k * 1.6, y + (mal ? 0.25 : 0.35), t.z - Math.sin(a + Math.PI / 2) * k * 1.6, a, 0.12); }
        if (t.jeu && rnd() < 0.25) { const [x, z] = rr(0.5); M.maison(L, M.style(t.dep), x, z, a, { s: 0.8, w: 3.2, etages: 1 }); }
      }
      if (t.t === 'dunes') for (let i = 0; i < 2; i++) { const [x, z] = rr(), b = sphere(entre(2.4, 3.4), 1); b.scale(1.4, 0.35, 0.8); put(L, b, 0xf0e2b0, x, y, z, rnd() * 3, 0.15); }
    }
    const grp = fige(L, this.racine); this.tourner(grp, tourn);
    return grp;
  }
  // ferme à cour : logis, grange, haie, un arbre
  ferme(L, t, [x, z]) {
    const st = M.style(t.dep), a = (rnd() * 4 | 0) * Math.PI / 2, F = lot();
    M.maison(F, st, 0, 0, 0, { s: 0.75, etages: 1 + (rnd() < 0.3 ? 1 : 0) });
    M.maison(F, st, 2.6, -1.4, Math.PI / 2, { s: 0.75, w: 3.2, d: 1.8, details: false, col: 0xd9c7a0 });
    for (let k = -2; k <= 2; k++) put(F, sphere(0.55, 0), 0x4f9a37, k * 1.1, 0.35, 2.6, 0, 0.08);
    M.arbre(F, -2.4, 0, -1.6, 0.6, 'fruitier');
    transfere(F, L, x, t.top, z, a);
  }

  // ---------------------------------------------------------------- routes et rivières
  routes() {
    const { mp, g } = this, L = lot(), sol = t => Math.max(t.top, 0);
    const lieu = t => t && t.t === 'ville';
    for (const e of mp.edges) {
      const royal = e.royal, w = royal ? 0.62 : 0.36;
      let run = [];
      const fin = () => {
        if (run.length > 1) { put(L, ruban(run.map(p => [p[0], p[1] - 0.02, p[2]]), w + 0.3), 0x6b5236, 0, 0, 0, 0, 0); put(L, ruban(run, w), royal ? 0xf1e4bd : 0xd9c79a, 0, 0, 0, 0, 0); }
        run = [];
      };
      for (const [x, y, z, t] of g.suivre(e.pts, 1.2, 0.24, sol)) {
        if (!t || this.estEau(t)) { fin(); continue; }
        run.push([x, lieu(t) ? t.top + 0.06 : y, z]);
      }
      fin();
      // les ormes des routes royales
      if (royal) { const pts = g.suivre(e.pts, 9, 0, sol); semer(e.id, 5); for (const [x, y, z, t] of pts) if (t && !t.lieu && !this.estEau(t) && rnd() < 0.5) M.arbre(L, x + entre(-1.6, 1.6), y, z + entre(-1.6, 1.6), 0.55); }
    }
    const R = lot();
    for (const rv of this.rivs) {
      // un tronçon par largeur : la rivière se resserre entre les quais de pierre en traversant une ville
      let run = [], ville = false;
      const fin = () => {
        if (run.length > 1) { const [w, b] = this.largeur(rv.rank, ville); put(L, ruban(run.map(p => [p[0], p[1] - 0.03, p[2]]), w + b), ville ? 0xbfb39a : 0xdccf96, 0, 0, 0, 0, 0); put(R, ruban(run, w), 0x46a9dd, 0, 0, 0, 0, 0); }
        run = run.length ? [run[run.length - 1]] : [];
      };
      for (const [x, y, z, t] of g.suivre(rv.pts, 0.8, 0.1)) {
        if (!t || this.estEau(t)) { fin(); run = []; continue; }
        const v = t.t === 'ville';
        if (v !== ville) { run.push([x, y, z]); fin(); ville = v; }
        run.push([x, y, z]);
      }
      fin();
    }
    fige(L, this.racine, { ombre: false }); fige(R, this.racine, { ombre: false });
  }

  // ---------------------------------------------------------------- les places, d'après l'état
  cleLieu(ns) { return ns ? `${ns.o}|${ns.f || 0}|${ns.d || 0}|${ns.sg ? Math.round((ns.sg.dmg || 0) * 3) : 0}|${ns.lv?.[0] === 'incendie' ? 1 : 0}|${Math.round((ns.dg || 0) * 5)}|${(this.mp.state?.year || 0) >= 1830 ? 1 : 0}` : '-'; }
  majLieux(st) {
    if (!st) return;
    for (const [id, l] of this.lieux) {
      const ns = st.nodes[id], cle = this.cleLieu(ns);
      l.cle = cle; l.ns = ns;   // (bâtie quand on la voit : voir)
    }
  }
  // ce que la caméra voit (km, avec une marge) : les blocs du décor et les places à l'écran se bâtissent, par petits pas ;
  // au-delà de MAXB blocs et MAXL places bâtis, les plus anciens hors de vue sont libérés. De loin (trop de blocs à
  // l'écran), les tuiles seules.
  voir(cam, vw, vh) {
    const now = performance.now(), m0 = 6, hx = vw / 2 / cam.z + m0, hy = vh / 2 / (cam.z * K) + m0;
    const x0 = cam.x - hx, x1 = cam.x + hx, y0 = cam.y - hy, y1 = cam.y + hy;
    const vus = this.morceaux.filter(m => m.x1 > x0 && m.x0 < x1 && m.y1 > y0 && m.y0 < y1);
    if (vus.length <= MAXB) for (const m of vus) {
      m.vu = now;
      if (!m.grp && !m.attente) { m.attente = true; this.file.push(() => { m.attente = false; if (!m.grp) m.grp = this.decor(m.liste); }); }
    }
    const bati = this.morceaux.filter(m => m.grp && m.vu !== now).sort((a, b) => a.vu - b.vu);
    for (let n = this.morceaux.filter(m => m.grp).length; n > MAXB && bati.length; n--) { const m = bati.shift(); jeter(m.grp); m.grp = null; this.sc.sale = true; }
    if (cam.z >= Z_LIEUX) for (const l of this.lieux.values()) {
      if (l.n.x < x0 - 8 || l.n.x > x1 + 8 || l.n.y < y0 - 8 || l.n.y > y1 + 8) continue;
      l.vu = now;
      if (l.cle && l.bati !== l.cle && !l.attente) {
        l.attente = true;
        this.file.push(() => { l.attente = false; l.bati = l.cle; jeter(l.grp); const L = this.batirLieu(l, l.ns); l.grp = fige(L, this.racine); this.tourner(l.grp, L.tourn); this.sc.sale = true; });
      }
    }
    const places = [...this.lieux.values()].filter(l => l.grp && l.vu !== now).sort((a, b) => a.vu - b.vu);
    for (let n = places.length + [...this.lieux.values()].filter(l => l.grp && l.vu === now).length; n > MAXL && places.length; n--) { const l = places.shift(); jeter(l.grp); l.grp = null; l.bati = null; this.sc.sale = true; }
  }
  batirLieu(l, ns) {
    const { mp, g } = this, n = l.n, t0 = l.t, st = M.style(n.dept), L = lot();
    const f = ns?.f || 0, dev = ns?.d || 0, dmg = ns?.sg ? ns.sg.dmg || 0 : 0;
    L.tourn = [];
    semer(n.id, 11);
    // les routes qui entrent : leurs angles (portes, rues)
    const angles = mp.edges.filter(e => e.a === n.id || e.b === n.id).map(e => { const p = e.a === n.id ? e.pts[Math.min(1, e.pts.length - 1)] : e.pts[Math.max(0, e.pts.length - 2)]; return Math.atan2(p[1] - n.y, p[0] - n.x); });
    const rues = angles.length ? angles : [0, 2.1, 4.2];
    // les routes qui entrent, suivies depuis la place (unités du plateau, tous les 2,25) : les rangs de maisons les longent
    const voies = mp.edges.filter(e => e.a === n.id || e.b === n.id).map(e => g.suivre(e.a === n.id ? e.pts : e.pts.slice().reverse(), 2.25, 0).map(p => [p[0], p[2]]).filter(p => Math.hypot(p[0] - t0.x, p[1] - t0.z) < 26));
    // et toutes celles qui passent près (rien ne se bâtit dessus)
    const pres = [];
    for (const e of mp.edges) { if (!e.pts.some(p => Math.hypot(p[0] / g.f - t0.x, p[1] / g.f - t0.z) < 34)) continue; for (const [x, , z] of g.suivre(e.pts, 0.8, 0)) if (Math.hypot(x - t0.x, z - t0.z) < 30) pres.push([x, z]); }
    const surRue = (x, z) => pres.some(([px, pz]) => (px - x) * (px - x) + (pz - z) * (pz - z) < 2.3);
    // ce que l'état abîme (comme la carte d'avant, villes.js degats) : maisons brûlées par l'incendie, ruines du siège en
    // cours et des combats passés (dg), toits noircis par le canon
    const feu = ns?.lv?.[0] === 'incendie', deg = Math.max(dmg * 0.22, ns?.dg || 0);
    const ruine = () => dmg > 0.3 && rnd() < dmg * 0.5;
    const brule = 0x3a3230;
    const etat = () => { const r = rnd(); return feu && r < 0.35 ? 'brule' : r < deg + (feu ? 0.35 : 0) && r >= (feu ? 0.35 : 0) ? 'ruine' : null; };
    // une maison, ou ce qu'il en reste
    const bat = (x, z, ry, o) => {
      const e = etat();
      if (e === 'ruine') {   // les murs restent, à mi-hauteur, un pignon debout ; des gravats dedans
        const R = lot(), s = o.s || 1, w = 2.4, d = 2.0, h = 0.7;
        for (const [a, b, l] of [[0, d / 2, w], [0, -d / 2, w], [w / 2, 0, d], [-w / 2, 0, d]]) put(R, boite(a ? 0.18 : l, h, a ? l : 0.18), 0xcfc2a6, a, h / 2, b, 0, 0.06);
        put(R, boite(0.18, 1.6, d), 0xcfc2a6, w / 2, 0.8, 0, 0, 0.06);
        put(R, boite(w - 0.3, 0.25, d - 0.3), 0x8f8472, 0, 0.12, 0, 0, 0);
        transfere(R, L, x, 0, z, ry, s); return;
      }
      M.maison(L, st, x, z, ry, e === 'brule' ? { ...o, col: 0x4a3f37, toitCol: 0x231d1a, details: false } : o);
    };
    const y0 = t0.top;
    // rien dans l'eau : le centre (église, place) va au plus près du milieu sur la terre ferme, les maisons mouillées sautent
    const sec = (x, z, m) => !this.mouille(t0.x + x, t0.z + z, m);
    let ox = 0, oz = 0;
    if (!sec(0, 0, 3.5)) search: for (let r = 2; r <= 8; r += 2) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (sec(Math.cos(a) * r, Math.sin(a) * r, 3.5)) { ox = Math.cos(a) * r; oz = Math.sin(a) * r; break search; } }
    const cx0 = t0.x + ox, cz0 = t0.z + oz;
    const posees = [];   // les maisons déjà bâties (unités du plateau) : deux maisons ne se posent pas l'une sur l'autre
    const libre = (x, z, t, rayonVide) => g.sous(x, z) === t && Math.hypot(x - cx0, z - cz0) >= rayonVide && !surRue(x, z)
      && !this.mouille(x, z, 1) && posees.every(([px, pz]) => Math.hypot(px - x, pz - z) > 2);
    const poser = (x, z, etagesMax) => {
      // la façade regarde la rue la plus proche
      const a = Math.atan2(z - t0.z, x - t0.x), r = rues.reduce((b, rr) => (Math.abs(Math.sin(a - rr)) < Math.abs(Math.sin(a - b)) ? rr : b), rues[0]);
      const et = 1 + ((rnd() * etagesMax) | 0), rui = ruine();
      bat(x - t0.x, z - t0.z, -r + (Math.sin(a - r) > 0 ? Math.PI : 0), { s: entre(0.88, 0.98), etages: et, toitCol: rui ? brule : undefined });
      posees.push([x, z]);
    };
    // sur une grille fine de l'hexagone t, au plus près du centre, jusqu'à n maisons au sec ; rend celles qui manquent
    const combler = (t, n, etagesMax, rayonVide) => {
      const fins = [];
      for (let u = -9.6; u <= 9.6; u += 1.2) for (let v = -9.6; v <= 9.6; v += 1.2) fins.push([t.x + u, t.z + v]);
      fins.sort((a, b) => Math.hypot(a[0] - t0.x, a[1] - t0.z) - Math.hypot(b[0] - t0.x, b[1] - t0.z));
      for (const [x, z] of fins) { if (n <= 0) break; if (libre(x, z, t, rayonVide)) { poser(x, z, etagesMax); n--; } }
      return n;
    };
    // les maisons de l'hexagone t : leur nombre est celui d'une ville sans rivière ; celles que l'eau chasse se rebâtissent
    // au sec ailleurs dans l'hexagone ; rend celles qui n'y ont pas trouvé de place
    // les rangs de maisons serrées, façade sur la rue, le long des routes qui entrent (leur vrai tracé), un second rang
    // derrière ; au plus près de la place d'abord ; jusqu'à n maisons, rend celles qui manquent
    const rangs = (t, n, etagesMax, rayonVide, prof = 2, s = 0.92) => {
      for (let i = 1; i < 12 && n > 0; i++) for (const v of voies) {
        if (i >= v.length) continue;
        const [ax, az] = v[i - 1], [bx, bz] = v[i], l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l, r = Math.atan2(uz, ux);
        for (const cote of [1, -1]) for (let k = 0; k < prof && n > 0; k++) {
          const lat = cote * (1.9 + k * 2.3), x = bx - uz * lat, z = bz + ux * lat;
          if (!libre(x, z, t, rayonVide)) continue;
          bat(x - t0.x, z - t0.z, -r + (cote > 0 ? Math.PI : 0), { s, etages: 1 + ((rnd() * etagesMax) | 0), toitCol: ruine() ? brule : undefined });
          posees.push([x, z]); n--;
        }
      }
      return n;
    };
    // le tour de la place : des maisons qui la regardent
    const tourPlace = (n, etagesMax, rayon) => {
      for (let i = 0, nb = Math.floor(2 * Math.PI * rayon / 2.3); i < nb && n > 0; i++) {
        const a = i / nb * 2 * Math.PI, x = cx0 + Math.cos(a) * rayon, z = cz0 + Math.sin(a) * rayon;
        if (!libre(x, z, t0, rayon - 0.1)) continue;
        bat(x - t0.x, z - t0.z, -a - Math.PI / 2, { s: 0.92, etages: 1 + ((rnd() * etagesMax) | 0), toitCol: ruine() ? brule : undefined });
        posees.push([x, z]); n--;
      }
      return n;
    };
    const maisons = (t, dens, etagesMax, rayonVide) => {
      const cands = [];
      for (let u = -9; u <= 9; u += 2.4) for (let v = -9; v <= 9; v += 2.4) {
        const x = t.x + u + (hache(u * 10 + t.q, v * 10 + t.r, 2) - 0.5) * 1.2, z = t.z + v + (hache(v * 10 + t.q, u * 10 + t.r, 4) - 0.5) * 1.2;
        // (la place garde son vide ; les rues et la densité partent du centre de la ville, là où entrent les routes)
        const dc = Math.hypot(x - t0.x, z - t0.z);
        if (g.sous(x, z) !== t || Math.hypot(x - cx0, z - cz0) < rayonVide || surRue(x, z) || rnd() > dens * (1 - dc / 40)) continue;
        cands.push([x, z]);
      }
      // (autant de maisons qu'avant : d'abord le tour de la place et les rangs le long des rues, puis le reste entre elles)
      let a = cands.length;
      if (t === t0 && rayonVide) a = tourPlace(a, etagesMax, rayonVide + 1);
      a = rangs(t, a, etagesMax, rayonVide);
      let reste = 0;
      for (const [x, z] of cands.slice(cands.length - a)) {
        const p = [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].find(([a, b]) => libre(x + a, z + b, t, rayonVide));
        if (p) poser(x + p[0], z + p[1], etagesMax); else reste++;
      }
      return reste ? combler(t, reste, etagesMax, rayonVide) : 0;
    };
    if (n.type === 'fort') {
      M.fortEtoile(L, 0, 0, 1.1);   // (le drapeau, qui flotte, est dessiné en 2D : towns.js, animer)
    } else if (n.type === 'village') {
      // le village : ses maisons le long de la route, de part et d'autre de l'église, puis quelques-unes à l'écart
      let nbv = rangs(t0, 4 + Math.min(4, Math.round((n.pop0 || 600) / 400)) + dev * 2, 2, 2.2, 1, 0.85);
      for (let k = 0, nb = nbv; k < nb; k++) {
        // (au sec : jusqu'à huit essais, un peu plus loin à chaque fois)
        let hx = 0, hz = 0, a = 0, ok = false;
        for (let e = 0; e < 8 && !ok; e++) { a = rnd() * Math.PI * 2; const r = entre(2.6, 6.2 + e * 0.6); hx = ox + Math.cos(a) * r; hz = oz + Math.sin(a) * r; ok = libre(t0.x + hx, t0.z + hz, t0, 2.2); }
        if (!ok) continue;
        posees.push([t0.x + hx, t0.z + hz]);
        bat(hx, hz, -a + Math.PI / 2 + entre(-0.3, 0.3), { s: 0.85, etages: rnd() < 0.2 ? 2 : 1, toitCol: ruine() ? brule : undefined });
      }
      M.eglise(L, st, ox, oz, rnd() * 6, 0.65, n.dept);
      for (let k = 0; k < 3; k++) { const a = rnd() * 6.3, r = entre(6.5, 8.5), ax = ox + Math.cos(a) * r, az = oz + Math.sin(a) * r; if (sec(ax, az, 1) && !surRue(t0.x + ax, t0.z + az)) M.arbre(L, ax, 0, az, 0.7, 'fruitier'); }
      if (rnd() < 0.35) { const mx = entre(-7, 7), mz = entre(-7, 7); if (sec(mx, mz, 1.5) && !surRue(t0.x + mx, t0.z + mz)) M.moulin(L, mx, mz, rnd() * 6, 0.75, rnd(), L.tourn); }
      if (f) M.enceinte(L, Math.min(f, 2), 7.5, angles);
    } else {
      // la ville : place au centre (église ou cathédrale, halle, fontaine), rues vers les routes, maisons serrées au cœur,
      // faubourgs plus lâches sur les hexagones voisins, enceinte selon les remparts
      const cap = n.type === 'capitale', P = lot();   // (la place du centre, posée au sec : ox, oz)
      put(P, cyl(3.4, 3.4, 0.08, 16), 0xc9bc98, 0, 0.04, 0, 0, 0);
      put(P, cyl(0.5, 0.6, 0.6, 10), 0xb9ad8f, 0, 0.3, 1.6, 0, 0.08); put(P, cyl(0.15, 0.15, 1, 6), 0x46a9dd, 0, 0.9, 1.6, 0, 0);
      if (n.name === 'Pau') M.chateau(P, st, -0.6, -1.2, 0, 0.75);
      else if (cap || (n.pop0 || 0) > 12000) M.cathedrale(P, 0, -0.6, 0, 0.6);
      else M.eglise(P, st, -0.4, -0.8, 0, 0.85, n.dept);
      if ((n.dept === '47' || n.dept === '24' || !cap) && sec(ox + 2.4, oz + 2.1, 1.5)) M.halle(P, st, 2.4, 2.1, Math.PI / 2, 0.5);
      transfere(P, L, ox, 0, oz);
      let manque = maisons(t0, cap ? 1.0 : 0.95, cap ? 3 : 2, 3.6);
      for (const t of l.hex.slice(1)) manque += maisons(t, 0.62 + dev * 0.08, cap ? 2 : 1, 0);
      if (!l.hex.slice(1).length && dev) manque += maisons(t0, 0.3 * dev, 1, 7.5);
      // une ville que l'eau serre : ce qui n'a pas trouvé place déborde en faubourg sur les hexagones voisins libres
      if (manque > 0) for (const h of new Set(l.hex.flatMap(x => g.voisins(x)))) { if (manque <= 0) break; if (!h.lieu && !this.estEau(h)) manque = combler(h, manque, 1, 0); }
      if (f) {   // l'enceinte entoure le cœur et les faubourgs voisins : centrée sur eux
        const cx = l.hex.reduce((a, h) => a + h.x, 0) / l.hex.length - t0.x, cz = l.hex.reduce((a, h) => a + h.z, 0) / l.hex.length - t0.z;
        const rad = Math.max(...l.hex.map(h => Math.hypot(h.x - t0.x - cx, h.z - t0.z - cz))) + 9.5, E = lot();
        M.enceinte(E, f, rad, angles);
        for (const k of ['g', 'o']) for (const geo of E[k]) { geo.translate(cx, 0, cz); L[k].push(geo); }
      }
      if ((n.quai || (n.spec || []).includes('port')) && n.type !== 'fort') {
        const eau = g.voisins(t0).find(v => this.estEau(v)) || l.hex.find(h => h.riv);
        if (eau) { const a = Math.atan2(eau.z - t0.z, eau.x - t0.x); M.quai(L, Math.cos(a) * 8.6, 0, Math.sin(a) * 8.6, -a + Math.PI / 2, 9, 3); }
      }
      // l'industrie du XIXe siècle : une cheminée d'usine dans les villes des forges
      if (this.cleLieu(ns).endsWith('|1') && ((n.spec || []).includes('fer') || (n.spec || []).includes('forge'))) put(L, cyl(0.4, 0.6, 7, 8), 0xa8573a, 6, 3.5, -5, 0, 0.1);
    }
    // posé sur l'hexagone central
    for (const k of ['g', 'o']) for (const geo of L[k]) geo.translate(t0.x, y0, t0.z);
    for (const a of L.tourn) a.position.add(new THREE.Vector3(t0.x, y0, t0.z));
    return L;
  }
  // rayon de la place sur le plateau, en km (les étiquettes se posent dessous)
  // (jusqu'au bord de l'enceinte : rayon des faubourgs + 9,5, batirLieu ; les camps et les tranchées se posent au-delà)
  rayon(n) { const l = this.lieux.get(n.id); return l ? (Math.max(...l.hex.map(h => Math.hypot(h.x - l.t.x, h.z - l.t.z))) + 9.5) * this.g.f : 0; }

  // ---------------------------------------------------------------- territoires : teinte et liseré aux couleurs des camps
  territoire(cellFac, codes, colors) {
    const { g } = this, T = lot(), B = lot();
    this.codes = codes;
    for (const t of g.liste) {
      t.fac = -1;
      if (!t.jeu || this.estEau(t)) continue;
      const cnt = new Map();
      for (let k = t.cases[0]; k < t.cases[1]; k++) { const f = cellFac[this.cases[k]]; if (f >= 0) cnt.set(f, (cnt.get(f) || 0) + 1); }
      let b = -1, bv = 0; for (const [f, v] of cnt) if (v > bv) { bv = v; b = f; }
      t.fac = b;
    }
    for (const t of g.liste) {
      if (t.fac < 0) continue;
      const col = colors[codes[t.fac]] || '#999';
      put(T, cyl(g.R * 0.97, g.R * 0.97, 0.08, 6), col, t.x, Math.max(t.top, 0) + 0.12, t.z, 0, 0);
      for (const v of g.voisins(t)) {
        if (v.fac === t.fac || this.estEau(v)) continue;
        const [a, b] = g.bordCommun(t, v), y = Math.max(t.top, 0) + 0.2, ins = p => [p[0] + (t.x - p[0]) * 0.1, y, p[1] + (t.z - p[1]) * 0.1];
        put(B, ruban([ins(a), ins(b)], 0.6), col, 0, 0, 0, 0, 0);
      }
    }
    jeter(this.grpTeinte); jeter(this.grpBords);
    const geo = T.g.length ? (fige(T, null, { contour: false }).children[0]) : null;
    if (geo) { geo.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false }); geo.castShadow = geo.receiveShadow = false; this.grpTeinte = new THREE.Group(); this.grpTeinte.add(geo); this.racine.add(this.grpTeinte); }
    this.grpBords = fige(B, this.racine, { ombre: false, contour: false });
    this.sc.sale = true;
  }


  // ---------------------------------------------------------------- chaque image
  // hauteur du sol (km) sous un point du jeu : les calques 2D y posent ce qui est debout
  hauteur(x, y) { const t = this.g.en(x, y); return t ? Math.max(t.top, EAU_Y) * this.g.f : 0; }
  // bâtit un peu de ce qui reste (budget en ms), cale la caméra et dessine si quelque chose a changé
  // les ailes de moulin d'un groupe bâti : elles tournent avec lui (et partent avec lui quand il est refait)
  tourner(grp, ailes) { for (const a of ailes) { grp.add(a); this.ailes.push(a); } }
  // anim : la vie de la carte est animée (ambient.on)
  image(cam, vw, vh, dpr, budget = 8, anim = false) {
    const t0 = performance.now();
    this.voir(cam, vw, vh);
    while (this.file.length && performance.now() - t0 < budget) { this.file.shift()(); this.sc.sale = true; }
    // les moulins tournent quand on les distingue : le plateau se redessine alors 15 fois par seconde, pas plus
    if (anim && cam.z >= 15 && this.ailes.length && t0 - (this.tAiles || 0) > 66) {
      this.tAiles = t0; this.ailes = this.ailes.filter(a => a.parent?.parent);   // (celles des groupes refaits sont parties)
      for (const a of this.ailes) a.rotation.z = a.userData.ph + t0 / 1000 * 0.9;
      this.sc.sale = true;
    }
    this.sc.caler(cam, vw, vh, dpr);
    return this.sc.rendre();
  }
  pret() { return !this.file.length; }
  dispose() { this.sc.dispose(); }
}
