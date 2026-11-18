// La carte de campagne en plateau d'hexagones (SPEC-HEX.md), dessinée par le moteur graphique commun web_engine
// (web/graphismes/rendu : scène, terrain et nature, saisons et neige, liserés des territoires, bâtiments d'époque).
// Ce fichier ne dessine rien lui-même : il traduit la carte et l'état du jeu pour le moteur, et cale sa caméra sur la
// caméra 2D du jeu. Les graphismes se modifient dans web_engine, jamais ici (outils/maj-graphismes.sh).
//
// - Carte : hex/carte-moteur.js met les cases de 1 km au format du moteur ; seule une fenêtre autour de la caméra est
//   bâtie, en hexagones de 4 km de près et plus grands de loin (niveaux de détail), refaite quand la vue en sort.
// - Caméra : le moteur a sa caméra en perspective et ses gestes ; ici sa caméra reçoit à chaque image la vue inclinée
//   orthographique du jeu (grille.js : K, C), si bien que les calques 2D (vie, armées, interface, map.js) tombent pile
//   sur le plateau. Son canevas (#carte) est sous celui du jeu, qui garde les gestes.
// - Rendu : la boucle du moteur continue d'animer, mais l'image n'est dessinée que par image(), appelée par la boucle
//   de map.js, et seulement quand quelque chose a changé.
import { K, C, SQ3, clamp } from './grille.js';
import { Niveau, choisirPas, cadrer, couvre, fenetre, indexEn } from './carte-moteur.js';

export { K, C };

// le moteur démarre à l'import de scene.js et dessine dans <canvas id="carte"> : posé sous la carte du jeu
// (rien dans les workers qui peignent les tuiles, peintre.js : ils importent map.js sans avoir de page)
const PAGE = typeof document !== 'undefined';
let cv = PAGE ? document.getElementById('carte') : null;
const carte2d = PAGE ? document.getElementById('map') : null;
if (!cv && carte2d) {
  cv = document.createElement('canvas'); cv.id = 'carte'; cv.setAttribute('aria-hidden', 'true');
  carte2d.parentNode.insertBefore(cv, carte2d);
}
// sans WebGL, scene.js échoue à l'import : la carte classique prend le relais (map.js, initPlateau)
let E = null;
if (PAGE) try {
  const [S, P, M] = await Promise.all(['scene', 'plateau', 'modeles'].map(m => import(`../../graphismes/rendu/${m}.js`)));
  const r = S.renderer, rendre = r.render.bind(r);
  r.render = () => {};   // la boucle du moteur ne dessine plus : image() le fait, caméra calée
  E = { S, P, M, rendre: () => rendre(S.scene, S.camera) };
  S.cam.auto = false;
} catch (e) {
  console.warn('Moteur graphique web_engine indisponible', e);
  cv?.remove(); cv = null;
}

const RANG = { capitale: 0, fort: 1, ville: 2, village: 3 };
const SAISON = { hiver: 0, printemps: 1, 'été': 2, ete: 2, automne: 3 };
// les bâtiments des places (catalogue de graphismes/rendu/modeles.js) : le cœur, puis les quartiers autour
const COEUR = { capitale: 'palais', ville: 'eglise', village: 'maison', fort: 'citadelle' };
const QUARTIERS = ['cathedrale', 'immeuble', 'marche', 'hotel_particulier', 'maison_pierre', 'theatre'];
const epoqueDe = an => an < 1750 ? 'ancien' : an < 1789 ? 'lumieres' : an < 1816 ? 'empire' : 'industrie';
const D = 400;   // recul de la caméra orthographique (unités du moteur)

export class Plateau {
  // mp : la carte (map.js) ; canvas : le canevas du moteur (#carte)
  constructor(mp, canvas) {
    if (!E) throw new Error('moteur graphique indisponible (WebGL)');
    this.mp = mp; this.cv = canvas;
    this.niveaux = new Map();     // pas → Niveau (la carte entière à ce niveau de détail)
    this.lieux = new Map();       // id de la place → { n, t, hex, cle } (t, hex : centres en unités du plateau, 10 par hexagone)
    this.g = { f: 4 / SQ3 / 10 }; // km par unité du plateau (combat.js, towns.js), au niveau en cours
    this.villes = new E.S.THREE.Group(); E.S.scene.add(this.villes);
    this.fen = null; this.saison = 2; this.neige = 0; this.era = null;
    this.fac = null; this.codes = null; this.colors = {};
    this.st = null; this.cleCam = ''; this.tCam = 0; this.tRendu = 0; this.sale = true;
  }

  niveau(pas) {
    let N = this.niveaux.get(pas);
    if (!N) { N = new Niveau(this.mp, pas); this.placer(N); this.niveaux.set(pas, N); }
    return N;
  }
  // chaque place sur son hexagone, les grandes villes sur quelques voisins ; de loin, seules les plus grandes
  placer(N) {
    const g = N.g, p = N.pas; N.places = new Map(); N.ville = new Set();
    const ordre = this.mp.nodes.slice().sort((a, b) => RANG[a.type] - RANG[b.type] || (b.pop0 || 0) - (a.pop0 || 0));
    for (const n of ordre) {
      if (n.type === 'village' && p > 8 || n.type === 'ville' && p > 16 && (n.pop0 || 0) < 20000) continue;
      let h = indexEn(g, n.x, n.y);
      if (h < 0) continue;
      const libres = k => g.voisins(g.liste[k]).map(v => v.i).filter(v => !N.ville.has(v) && !N.estEau(v));
      if (N.ville.has(h) || N.estEau(h)) h = libres(h).sort((a, b) => dist(g, a, n) - dist(g, b, n))[0] ?? -1;
      if (h < 0) continue;
      const nb = p >= 16 ? 0 : n.type === 'capitale' ? (n.pop0 > 50000 ? 6 : 2) : n.type === 'ville' && n.pop0 > 7000 ? 1 : 0;
      const hex = [h, ...libres(h).slice(0, nb)];
      for (const k of hex) N.ville.add(k);
      N.places.set(n.id, { n, hex });
    }
  }

  // ---------------------------------------------------------------- la fenêtre bâtie par le moteur
  batir(pas, cx, cy, l, h) {
    const N = this.niveau(pas), f = cadrer(N, cx, cy, l, h);
    this.N = N; this.fen = f; this.g.f = f.u / 10;
    this.C = fenetre(N, f, N.ville);
    E.P.construire(this.C);
    this.etatMoteur();
    this.lieuxDu(N);
    this.batirVilles();
    this.sale = true;
  }
  // centre d'un hexagone de la grille entière, en unités du moteur (grille entière : la fenêtre en est décalée de ox, oz)
  centre(N, k) { const t = N.g.liste[k]; return [t.x / 10, t.z / 10]; }
  local(k) { const G = this.N.g.cols, c = k % G - this.fen.c0, r = ((k / G) | 0) - this.fen.r0; return c >= 0 && r >= 0 && c < this.fen.l && r < this.fen.h ? r * this.fen.l + c : -1; }

  // ce que l'état change au plateau du moteur : saison, neige, territoires (liserés aux couleurs des camps)
  etatMoteur() {
    if (!this.C) return;
    const C = this.C, n = C.l * C.h, proprio = new Array(n).fill(-1), W = this.mp.W, royaumes = [];
    if (this.fac) {
      for (let i = 0; i < n; i++) {
        const k = C.gl(i), t = this.N.g.liste[k];
        if (!this.N.jeu[k] || this.N.estEau(k)) continue;
        const x = Math.floor(t.gx), y = Math.floor(t.gy);   // (le camp de la case de 1 km au centre de l'hexagone)
        if (x >= 0 && y >= 0 && x < W && y < this.mp.H) proprio[i] = this.fac[y * W + x];
      }
      this.codes.forEach((c, id) => royaumes.push({ id, couleur: this.colors[c] || '#999999' }));
    }
    E.P.majEtat({ cases: { arbres: C.arbres, foret: C.foret, proprio }, batiments: [], routes: [], forts: [], royaumes,
      saison: this.saison, meteo: { neige_sol: this.neige } });
    this.sale = true;
  }
  // les places de ce niveau (combat.js et guerre.js y posent sièges et batailles), en unités du plateau (10 par hexagone)
  lieuxDu(N) {
    for (const [id, p] of N.places) {
      const hex = p.hex.map(k => { const [x, z] = this.centre(N, k); return { x: x * 10, z: z * 10 }; });
      const ns = this.st?.nodes?.[id];
      this.lieux.set(id, { n: p.n, t: hex[0], hex, cle: this.cleLieu(ns), ns });
    }
    for (const id of [...this.lieux.keys()]) if (!N.places.has(id)) this.lieux.delete(id);
  }
  cleLieu(ns) { return ns ? `${ns.o}|${ns.f || 0}|${ns.lv?.[0] === 'incendie' ? 1 : 0}` : '-'; }
  majLieux(st) {
    if (!st) return;
    this.st = st;
    let change = false;
    for (const l of this.lieux.values()) {
      const ns = st.nodes?.[l.n.id], cle = this.cleLieu(ns);
      if (cle !== l.cle) { l.cle = cle; change = true; }
      l.ns = ns;
    }
    if (change && this.fen) this.batirVilles();
  }
  // les bâtiments des places de la fenêtre, aux couleurs du camp qui les tient et au style de l'année
  batirVilles() {
    for (const o of [...this.villes.children]) this.villes.remove(o);   // (géométries partagées, gardées par le cache du moteur)
    const N = this.N, f = this.fen, an = this.st?.year || this.mp.epoque?.year || 1700, epoque = epoqueDe(an);
    for (const [id, p] of N.places) {
      const loc = p.hex.map(k => this.local(k));
      if (loc[0] < 0) continue;
      const ns = this.lieux.get(id)?.ns, couleur = this.colors[ns?.o] || this.mp.rules?.neutral_color || '#8d8a7a', ruine = ns?.lv?.[0] === 'incendie';
      p.hex.forEach((k, j) => {
        if (loc[j] < 0) return;
        const cle = j === 0 ? COEUR[p.n.type] || 'maison' : ns?.f && j === 1 ? 'tour' : QUARTIERS[(j - 1) % QUARTIERS.length];
        const b = E.M.maillageBatiment({ cle, couleur, epoque, saison: this.saison, neige: this.neige, ruine: ruine && j === 0 });
        const [x, z] = this.centre(N, k);
        b.mesh.position.set(x - f.ox, E.P.dessus(loc[j]), z - f.oz);
        this.villes.add(b.mesh);
      });
    }
    this.sale = true;
  }

  // ---------------------------------------------------------------- ce que le jeu demande au plateau (map.js)
  // le camp qui tient chaque case de 1 km (indice dans codes) et les couleurs des camps
  territoire(cellFac, codes, colors) { this.fac = cellFac; this.codes = codes; this.colors = colors; this.etatMoteur(); if (this.fen) this.batirVilles(); }
  // saison ('hiver'…) et neige au sol : le moteur refait le décor
  colorer(saison, neige) {
    const s = SAISON[saison] ?? 2, n = neige ? 0.8 : 0;
    if (s === this.saison && n === this.neige) return;
    this.saison = s; this.neige = n;
    if (this.fen) { E.P.majSaison(s, n); this.batirVilles(); }
  }
  // la carte d'époque ('cassini', 'etatmajor' ou null) : le sol teinté au papier (map.js passe le canevas au sépia)
  papier(era) {
    if (era === this.era) return;
    this.era = era;
    E.P.MAT_SOL.color.set(era === 'cassini' ? 0xf3e6c4 : era ? 0xf7f0dc : 0xffffff);
    this.sale = true;
  }
  // shortcut: le paysage des siècles (pinèdes, marais drainés, vigne roussie, epoque.js 2c) n'a pas d'équivalent dans le
  // moteur web_engine ; à ajouter à la bibliothèque (graphismes/rendu/plateau.js) si on le veut sur le plateau
  paysage() {}
  // pas d'enceinte dessinée par le moteur sur la carte : les sièges se posent autour du rayon de la place
  murDe() { return null; }
  // rayon de la place sur le plateau, en km (les étiquettes, les camps et les tranchées se posent au-delà)
  rayon(n) {
    const l = this.lieux.get(n.id);
    return l ? (Math.max(...l.hex.map(h => Math.hypot(h.x - l.t.x, h.z - l.t.z))) / 10 + 0.95) * this.fen?.u || 0 : 0;
  }
  // hauteur du sol (km) sous un point du jeu : les calques 2D y posent ce qui est debout
  hauteur(x, y) {
    const f = this.fen;
    if (!f) return 0;
    const X = x / f.u - f.ox, Z = y / f.u - f.oz;
    return E.S.caseA(X, Z) < 0 ? 0 : Math.max(E.P.hauteurEn(X, Z), -0.15) * f.u;
  }

  // ---------------------------------------------------------------- chaque image (boucle de map.js)
  // la fenêtre suit la vue (refaite quand la vue en sort ou change de niveau de détail, une fois la caméra posée),
  // la caméra du moteur est calée sur celle du jeu, et l'image dessinée si quelque chose a changé
  image(cam, vw, vh, dpr, budget = 8, anim = false) {
    const now = performance.now(), cle = `${cam.x.toFixed(3)}|${cam.y.toFixed(3)}|${cam.z.toFixed(4)}|${vw}|${vh}`;
    if (cle !== this.cleCam) { this.cleCam = cle; this.tCam = now; this.sale = true; }
    const hx = vw / 2 / cam.z, hy = vh / 2 / (cam.z * K), v = [cam.x - hx, cam.x + hx, cam.y - hy, cam.y + hy];
    const voulu = choisirPas(vw, vh, cam.z, K), f = this.fen;
    const dehors = !f || !couvre(f, ...v), detail = f && voulu.pas < f.pas;   // (en zoomant, plus fin ; en dézoomant, la vue sort de la fenêtre)
    if (dehors || detail) {
      // pendant un geste on garde la fenêtre (sauf si la vue en sort tout entière) : on rebâtit quand la caméra se pose
      const loin = !f || v[1] < f.x0 || v[0] > f.x1 || v[3] < f.y0 || v[2] > f.y1;
      if (loin || now - this.tCam > 250) this.batir(voulu.pas, cam.x, cam.y, voulu.l, voulu.h);
    }
    if (!this.sale && !(anim && now - this.tRendu > 66) && now - this.tRendu < 250) return false;
    this.caler(cam, vw, vh);
    E.rendre();
    this.sale = false; this.tRendu = now;
    return true;
  }
  // la caméra du moteur : orthographique, inclinée de ELEV, centrée sur la caméra du jeu, à son échelle
  caler(cam, vw, vh) {
    const S = E.S, f = this.fen, z = cam.z * f.u, hw = vw / 2 / z, hh = vh / 2 / z, cx = cam.x / f.u - f.ox, cz = cam.y / f.u - f.oz, c = S.camera;
    c.position.set(cx, D * K, cz + D * C); c.up.set(0, 1, 0); c.lookAt(cx, 0, cz);
    c.projectionMatrix.makeOrthographic(-hw, hw, hh, -hh, 1, 2 * D);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.updateMatrixWorld();
    // le soleil et ses ombres suivent la vue (placés par la boucle du moteur d'après cam) ; pas de brume en vue de dessus
    Object.assign(S.cam, { x: cx, z: cz, l: Math.max(cx, 1e4), h: Math.max(cz, 1e4) });
    S.cam.d = S.cam.cible = clamp(Math.max(hw, hh / K), 6, 120);
    S.scene.fog.near = 1e5; S.scene.fog.far = 2e5;
  }
  pret() { return !!this.fen; }
  dispose() { E.S.scene.remove(this.villes); }
}
const dist = (g, k, n) => Math.hypot(g.liste[k].gx - n.x, g.liste[k].gy - n.y);
