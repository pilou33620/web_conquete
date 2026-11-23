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
//   de map.js : à chaque image si les animations sont permises, sinon seulement quand quelque chose a changé.
// - Vie : celle du moteur (vie.js, faune.js, eau.js), dans son style : passants, charrettes, bêtes, travaux des champs,
//   bateaux, oiseaux, vagues ; la vie dessinée en 2D (carte/vie.js) ne sert plus qu'à la carte classique.
import { K, C, SQ3, clamp, hache } from './grille.js';
import { Niveau, choisirPas, cadrer, couvre, fenetre, indexEn, routesDe } from './carte-moteur.js';
import { AMB, meteoEn } from '../carte/ambiance.js';
import { Marine } from './marine.js';

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
let E = null, calage = null;
if (PAGE) try {
  // (vie : gens, bêtes, charrettes et bateaux du moteur ; faune : oiseaux migrateurs, poissons ; eau : vagues des côtes)
  // (monde : animerPose, les ailes des moulins, les drapeaux et les fumées des cheminées des bâtiments posés)
  // (SPEC-EMPIRE, P2) les étiquettes HTML du moteur (etiquettes.js, importé par monde.js et marine.js) prennent leur calque
  // #etiquettes à l'import et se posent après la caméra de la boucle du moteur : le calque d'abord, et la caméra recalée
  // sur celle du jeu avant elles (calage), sinon elles tomberaient à côté
  if (!document.getElementById('etiquettes')) { const d = document.createElement('div'); d.id = 'etiquettes'; carte2d?.after(d); }
  (await import('../../graphismes/rendu/scene.js')).apresCamera(() => calage?.());
  // (modernes, animations, toon : les habitants et les pièces mobiles des bâtiments des emplacements, SPEC-EMPIRE module 4)
  const [S, P, M, R, V, W, , , MO, A, T] = await Promise.all(['scene', 'plateau', 'modeles', 'routes', 'vie', 'monde', 'faune', 'eau', 'modernes', 'animations', 'toon']
    .map(m => import(`../../graphismes/rendu/${m}.js`)));
  const r = S.renderer, rendre = r.render.bind(r);
  r.render = () => {};   // la boucle du moteur ne dessine plus : image() le fait, caméra calée
  E = { S, P, M, R, V, W, MO, A, T, rendre: () => rendre(S.scene, S.camera), rendreScene: rendre };
  S.cam.auto = false;
  P.decorProgressif(6);   // (le décor se pose par morceaux de 6 ms par image : changer de vue n'arrête plus l'image)
  // (SPEC-EMPIRE, P2) la marine du moteur (marine.js, adaptée par hex/marine.js) ; sans elle, le plateau reste
  E.Mar = await import('../../graphismes/rendu/marine.js').catch(e => { console.warn('Marine de web_engine indisponible', e); return null; });
} catch (e) {
  console.warn('Moteur graphique web_engine indisponible', e);
  cv?.remove(); cv = null;
}

const RANG = { capitale: 0, fort: 1, ville: 2, village: 3 };
const SAISON = { hiver: 0, printemps: 1, 'été': 2, ete: 2, automne: 3 };
// seuls les bâtiments de web_engine qui ont un sens vus de haut sur la carte de campagne (on n'y bâtit pas une ville
// pièce à pièce) : grande ville (immeubles au cœur, maisons de pierre autour), petite ville, village, fort, et dans
// les campagnes des fermes et des moulins
const COEUR = { capitale: 'immeuble', ville: 'maison', village: 'cabane', fort: 'citadelle' };
const QUARTIERS = ['maison_pierre'];
const FERMES = 0.06, MOULINS = 0.02;   // part des hexagones cultivés qui portent une ferme, un moulin
const epoqueDe = an => an < 1750 ? 'ancien' : an < 1789 ? 'lumieres' : an < 1816 ? 'empire' : 'industrie';
const D = 400;   // recul de la caméra orthographique (unités du moteur)
// l'heure du jeu (carte/ambiance.js) dans le vocabulaire du moteur (vie.js, climat : qui est dehors, fenêtres, lucioles)
const HEURE = { matin: ['jour', 'aube', 0.3, 0], midi: ['jour', 'jour', 0, 0], soir: ['aube', 'crepuscule', 1, 0.2], nuit: ['nuit', 'nuit', 0, 1] };
const NIV_VILLE = { capitale: 4, fort: 2, ville: 3, village: 1 };
// (SPEC-EMPIRE, module 4) les bâtiments des emplacements qui se posent au bord de l'eau (côté +x du modèle, tourné vers elle)
const MER = new Set(['port', 'chantier_naval', 'cale_seche', 'phare']);
const PRES_PX = 90;   // largeur d'un hexagone à l'écran (px) à partir de laquelle les bâtiments des emplacements s'animent
const VIG = 128;      // côté des vignettes des bâtiments (px de l'image), pour le panneau de la place

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
    this.emp = []; this.sigEmp = ''; this.posesEmp = [];   // bâtiments des emplacements : [place, hexagone, clé, eau], leurs poses
    this.habitants = new E.S.THREE.Group(); E.S.scene.add(this.habitants);
    this.vies = new Map(); this.animSale = false;           // clé → modèle animé (modernes.js) des bâtiments à l'écran
    this.chantiers = new Map();                             // clé (avancement compris) → bâtiment en chantier posé (maillageEnChantier)
    this.vignettes = new Map();                             // clé, couleur, époque → image du bâtiment
    this.marine = E.Mar ? new Marine(this, E.Mar) : null;   // (SPEC-EMPIRE, P2 : flottes, blocus, comptoirs, balises)
    calage = () => { if (this.fen && this.camJeu) this.caler(...this.camJeu); };
  }

  niveau(pas, leger) {
    const cle = pas + (leger ? 'l' : '');
    let N = this.niveaux.get(cle);
    if (!N) { N = new Niveau(this.mp, pas, leger); this.placer(N); this.niveaux.set(cle, N); }
    return N;
  }
  // chaque place sur son hexagone, les grandes villes sur quelques voisins ; de loin, seules les plus grandes
  placer(N) {
    const g = N.g, p = N.pas, loin = N.leger; N.places = new Map(); N.ville = new Set();
    // des quartiers sur les voisins seulement quand l'hexagone est petit devant la ville : sur la carte de l'Europe (cases de
    // 5 km, hexagones de 20 km), Paris en couvrait 7 (60 km) et chaque ville de 7 000 âmes 2, prenant la place des voisines
    const quartiers = !loin && p * 111.32 / (this.mp.m?.KY || 111.32) <= 6;
    const ordre = this.mp.nodes.slice().sort((a, b) => RANG[a.type] - RANG[b.type] || (b.pop0 || 0) - (a.pop0 || 0));
    for (const n of ordre) {
      if (loin && (n.type === 'village' || n.type === 'ville' && (p > 4 || (n.pop0 || 0) < 7000))) continue;   // (de loin, les grandes seulement)
      let h = indexEn(g, n.x, n.y);
      if (h < 0) continue;
      const libres = k => g.voisins(g.liste[k]).map(v => v.i).filter(v => !N.ville.has(v) && !N.estEau(v));
      if (N.ville.has(h) || N.estEau(h)) h = libres(h).sort((a, b) => dist(g, a, n) - dist(g, b, n))[0] ?? -1;
      if (h < 0) continue;
      const nb = !quartiers ? 0 : n.type === 'capitale' ? (n.pop0 > 50000 ? 6 : 2) : n.type === 'ville' && n.pop0 > 7000 ? 1 : 0;
      const hex = [h, ...libres(h).slice(0, nb)];
      for (const k of hex) N.ville.add(k);
      N.places.set(n.id, { n, hex });
    }
    // les routes, d'hexagone en hexagone (sur les hexagones de 4 cases seulement : plus loin, ce ne serait que des traits)
    N.routes = p === 4 ? routesDe(N, this.mp.edges || [], N.places, N.ville) : { paires: [], sansPont: new Set() };
    const surRoute = new Set(N.routes.paires.flatMap(([a, b]) => [a, b]));
    // fermes et moulins dans les campagnes cultivées, à l'écart des places et des routes (de près seulement)
    N.campagne = [];
    if (!loin) for (const t of g.liste) {
      const k = t.i, r = hache(t.col, t.row, 31);
      if (r >= FERMES + MOULINS || !N.fertile[k] || N.riviere[k] || surRoute.has(k) || N.ville.has(k) || g.voisins(t).some(v => N.ville.has(v.i))) continue;
      N.campagne.push([k, r < FERMES ? 'ferme' : 'moulin']); N.ville.add(k);
    }
    // (SPEC-EMPIRE, module 4) les hexagones où poser les bâtiments des emplacements de chaque place : libres (ni place, ni
    // ferme, ni eau, ni rivière, ni route), autour d'elle puis un cran plus loin ; [hexagone, hexagone d'eau voisin ou −1]
    if (!loin) for (const p of N.places.values()) {
      const vu = new Set(p.hex), anneaux = [];
      let bord = p.hex;
      for (let r = 0; r < 2; r++) {
        const suivant = [];
        for (const k of bord) for (const v of g.voisins(g.liste[k])) if (!vu.has(v.i)) { vu.add(v.i); suivant.push(v.i); }
        anneaux.push(...suivant); bord = suivant;
      }
      p.autour = anneaux.filter(k => !N.ville.has(k) && !N.estEau(k) && !N.riviere[k] && !surRoute.has(k))
        .map(k => [k, g.voisins(g.liste[k]).find(v => N.estEau(v.i))?.i ?? -1]);
    }
  }
  // les bâtiments des emplacements des places, posés autour d'elles : [id de la place, hexagone, clé web_engine, hexagone
  // d'eau voisin ou −1, avancement du chantier (0 à 1) ou null s'il est achevé]. Seules les places dont la vue donne les
  // emplacements (`chains` : celles du joueur) en ont ; ceux du bord de l'eau d'abord, sur les hexagones qui la touchent. Un
  // chantier (file `q`, `kind: "slot"`) est placé comme le bâtiment qu'il sera (un niveau de plus : à la place de l'ancien).
  // De près seulement (hexagones de 4 cases, décor complet).
  emplacements() {
    const N = this.N, out = [], pris = new Set(), niv = this.mp.rules?.cities?.chains || {};
    if (!N || N.leger || !this.st?.nodes) return out;
    for (const [id, p] of N.places) {
      const ns = this.st.nodes[id], chs = ns?.chains;
      if (!chs || !p.autour) continue;
      const bats = [];
      for (const c of chs) {
        const q = ns.q?.find(e => e.kind === 'slot' && e.what === c.id);
        // (la clé du niveau en chantier : celle des règles ; la plantation a la denrée de la place, déjà dans c.bat)
        const bat = !q ? c.bat : c.id === 'plantation' || !c.niveau ? c.bat : niv[c.id]?.levels?.[q.lvl - 1]?.bat || c.bat;
        if (bat && (q || c.niveau > 0)) bats.push([bat, q ? Math.round(20 * (1 - q.left / (q.total || 1))) / 20 : null]);
      }
      bats.sort((a, b) => MER.has(b[0]) - MER.has(a[0]));
      const libres = p.autour.filter(([k]) => !pris.has(k));
      for (const [bat, av] of bats) {
        const j = MER.has(bat) ? Math.max(0, libres.findIndex(([, eau]) => eau >= 0)) : 0, h = libres.splice(j, 1)[0];
        if (!h) break;
        pris.add(h[0]); out.push([id, h[0], bat, MER.has(bat) ? h[1] : -1, av]);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- la fenêtre bâtie par le moteur
  batir(v, cx, cy) {
    const N = this.niveau(v.pas, v.leger), f = cadrer(N, cx, cy, v.l, v.h);
    this.N = N; this.fen = f; f.niv = v.niv; this.g.f = f.u / 10;
    const C = this.C = fenetre(N, f, N.ville, N.routes.sansPont), n = C.l * C.h;
    // (le moteur reçoit l'état avec la carte : il ne bâtit le décor qu'une fois, la moitié du temps d'arrêt quand la vue change)
    // les routes de la fenêtre (indices de la fenêtre) : le moteur les trace (routes.js) et n'y met pas de champs
    this.chemins = N.routes.paires.map(([a, b, niv]) => [this.local(a), this.local(b), niv]).filter(([a, b]) => a >= 0 && b >= 0);
    this.routes = this.chemins;
    if (N.leger) {
      // de loin, pas de parcelles : le moteur n'en trace pas sur une case où passe une route (routes de l'état, pas tracées)
      this.routes = [];
      for (let i = 0; i < n; i += 2) this.routes.push([i, Math.min(i + 1, n - 1)]);
    }
    E.P.construire(C, this.etatDuMoteur());
    E.R.majRoutes(this.chemins);   // (après l'état : le moteur pose les routes sur les hauteurs des cases)
    this.lieuxDu(N);
    this.batirVilles();
    this.marine?.maj(this.st, true);   // (SPEC-EMPIRE, P2 : les indices de case ont changé)
    this.sale = true;
  }
  // la vie du moteur (vie.js) : passants des places, charrettes des routes, travaux des champs, fermes et moulins, bêtes,
  // bateaux. Seulement de près (hexagones de 4 cases, décor complet) : de loin, on ne verrait pas les figures.
  majVie() {
    if (!this.C) return;
    const N = this.N, villes = [], batiments = [], an = this.st?.year || this.mp.epoque?.year || 1700;
    const proprio = o => Math.max(-1, this.codes?.indexOf?.(o) ?? -1);
    if (!N.leger) {
      for (const [id, p] of N.places) {
        const ns = this.lieux.get(id)?.ns, c = this.local(p.hex[0]);
        if (c < 0) continue;
        villes.push({ id, case: c, proprio: proprio(ns?.o), capitale: p.n.type === 'capitale', niveau: NIV_VILLE[p.n.type] || 1,
          pop: ns?.pop ?? p.n.pop0, assiegee: !!(ns?.sg || ns?.bk) });
        p.hex.forEach((k, j) => { const i = this.local(k); if (i >= 0) batiments.push({ id: id * 8 + j, cle: j ? 'maison_pierre' : COEUR[p.n.type] || 'maison', case: i, reste: 0, face: 0, ville: id, proprio: proprio(ns?.o) }); });
      }
      for (const [k, cle] of N.campagne) { const i = this.local(k); if (i >= 0) batiments.push({ id: 5e5 + k, cle, case: i, reste: 0, face: 0, proprio: -1 }); }
    }
    E.V.majVie({ batiments, villes, routes: N.leger ? [] : this.chemins.map(([a, b]) => [a, b]), saison: this.saison, tour: 0, mois: 0,
      epoque: { cle: epoqueDe(an) }, royaumes: (this.codes || []).map((c, id) => ({ id, couleur: this.colors[c] || '#999999' })),
      cases: { foret: this.C.foret, proprio: this.habite || [] }, meteo: { genre: 'soleil' } });
  }
  // l'heure et le temps qu'il fait sous la caméra, pour la vie du moteur
  majClimat(cam) {
    const c = E.V.climat, [heure, phase, aube, nuit] = HEURE[AMB.heure] || HEURE.midi, k = meteoEn(cam.x, cam.y);
    Object.assign(c, { heure, phase, aube, nuit, genre: k, pluie: ['pluie', 'orage', 'tempete'].includes(k), neige: k === 'neige',
      vent: k === 'tempete' ? 1.4 : k === 'orage' ? 1 : k === 'pluie' ? 0.6 : 0.3, gel: this.neige ? 0.6 : 0, saison: this.saison });
  }
  // centre d'un hexagone de la grille entière, en unités du moteur (grille entière : la fenêtre en est décalée de ox, oz)
  centre(N, k) { const t = N.g.liste[k]; return [t.x / 10, t.z / 10]; }
  local(k) { const G = this.N.g.cols, c = k % G - this.fen.c0, r = ((k / G) | 0) - this.fen.r0; return c >= 0 && r >= 0 && c < this.fen.l && r < this.fen.h ? r * this.fen.l + c : -1; }

  // ce que l'état change au plateau du moteur : saison, neige, territoires (liserés aux couleurs des camps)
  etatMoteur() { if (this.C) { E.P.majEtat(this.etatDuMoteur()); this.sale = true; } }
  etatDuMoteur() {
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
    // (les hexagones des places et des fermes sont bâtis : le moteur n'y met ni décor ni buisson sous le bâtiment)
    this.emp = this.emplacements(); this.sigEmp = this.emp.map(e => e[1]).join();
    const batiments = [...this.N.ville, ...this.emp.map(e => e[1])].map(k => ({ case: this.local(k) })).filter(b => b.case >= 0);
    // (pour la vie du moteur, une case de terre du jeu est habitée même sans camp : bêtes dans les prés, fleurs)
    this.habite = proprio.map((o, i) => o >= 0 ? o : this.N.jeu[C.gl(i)] && !this.N.estEau(C.gl(i)) ? 99 : -1);
    return { cases: { arbres: C.arbres, foret: C.foret, proprio }, batiments, routes: this.routes, forts: [], royaumes,
      saison: this.saison, meteo: { neige_sol: this.neige } };
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
  // (avec les bâtiments achevés de ses emplacements : la place n'est rebâtie que si ce qu'on y voit change)
  // (et ses chantiers, au vingtième près : refaite quand un chantier avance, pas à chaque état)
  cleLieu(ns) {
    return ns ? `${ns.o}|${ns.f || 0}|${ns.lv?.[0] === 'incendie' ? 1 : 0}|${ns.chains?.filter(c => c.niveau > 0).map(c => c.bat) || ''}|${ns.chains ? ns.q?.filter(e => e.kind === 'slot').map(e => `${e.what}${e.lvl}:${Math.round(20 * e.left / (e.total || 1))}`) || '' : ''}` : '-';
  }
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
    try { this.marine?.maj(st); } catch (e) { console.error('Marine', e); }   // (SPEC-EMPIRE, P2 : flottes et blocus de cet état ; une erreur du rendu n'arrête pas la page)
  }
  // les bâtiments des places de la fenêtre, aux couleurs du camp qui les tient et au style de l'année
  batirVilles() {
    for (const o of [...this.villes.children]) this.villes.remove(o);   // (géométries partagées, gardées par le cache du moteur)
    for (const id of this.poses || []) E.W.oublierPose(id);
    this.poses = [];
    // (ids numériques : le moteur en tire la phase des fumées et des drapeaux)
    const animer = (b, couleur) => { const id = 1e6 + this.poses.length; this.poses.push(id); E.W.animerPose(id, b.mesh, b.anim, couleur); };
    const N = this.N, f = this.fen, an = this.st?.year || this.mp.epoque?.year || 1700, epoque = epoqueDe(an);
    for (const [id, p] of N.places) {
      const loc = p.hex.map(k => this.local(k));
      if (loc[0] < 0) continue;
      const ns = this.lieux.get(id)?.ns, couleur = this.colors[ns?.o] || this.mp.rules?.neutral_color || '#8d8a7a', ruine = ns?.lv?.[0] === 'incendie';
      p.hex.forEach((k, j) => {
        if (loc[j] < 0) return;
        const cle = j === 0 ? COEUR[p.n.type] || 'maison' : QUARTIERS[(j - 1) % QUARTIERS.length];
        const b = E.M.maillageBatiment({ cle, couleur, epoque, saison: this.saison, neige: this.neige, ruine: ruine && j === 0 });
        const [x, z] = this.centre(N, k);
        b.mesh.position.set(x - f.ox, E.P.dessus(loc[j]), z - f.oz);
        this.villes.add(b.mesh); animer(b, couleur);
      });
    }
    for (const [k, cle] of N.campagne) {
      const i = this.local(k); if (i < 0) continue;
      const b = E.M.maillageBatiment({ cle, epoque, saison: this.saison, neige: this.neige }), [x, z] = this.centre(N, k);
      b.mesh.position.set(x - f.ox, E.P.dessus(i), z - f.oz);
      this.villes.add(b.mesh); animer(b, this.mp.rules?.neutral_color || '#8d8a7a');
    }
    // (SPEC-EMPIRE, module 4) les bâtiments des emplacements, comme le village d'essai de web_engine (batiments-empire.html) ;
    // quand leurs hexagones changent, le décor du moteur est refait dessous (majEtat), au plus quand un chantier commence
    // (sinon, rien que la liste : un chantier qui avance ou s'achève reste sur son hexagone)
    const emp = this.emplacements();
    if (emp.map(e => e[1]).join() !== this.sigEmp) this.etatMoteur(); else this.emp = emp;
    this.posesEmp = [];
    const chantiers = new Map();
    for (const [id, k, cle, eau, av] of this.emp) {
      const i = this.local(k); if (i < 0) continue;
      const ns = this.lieux.get(id)?.ns, couleur = this.colors[ns?.o] || this.mp.rules?.neutral_color || '#8d8a7a', ruine = ns?.lv?.[0] === 'incendie';
      const [x, z] = this.centre(N, k);
      // (le modèle a l'eau du côté +x : tourné vers l'hexagone d'eau voisin)
      const [ex, ez] = eau >= 0 ? this.centre(N, eau) : [x + 1, z], rot = Math.atan2(z - ez, ex - x);
      if (av != null) {
        // un chantier (animations.js maillageEnChantier : le bâtiment monté jusqu'à av, échafaudage et ouvriers) : gardé tant que
        // son avancement ne change pas, rebâti sinon (10 à 15 ms), jeté quand le chantier finit ou sort de la fenêtre
        const c = `${k}|${cle}|${couleur}|${epoque}|${this.saison}|${this.neige}|${av}`;
        let m = this.chantiers.get(c);
        const neuf = !m;
        if (neuf) { m = E.A.maillageEnChantier({ cle, couleur, epoque, saison: this.saison, neige: this.neige, av }); this.habitants.add(m.groupe); }
        m.groupe.position.set(x - f.ox, E.P.dessus(i), z - f.oz); m.groupe.rotation.y = rot;
        if (neuf) E.MO.animer(m);   // (après la pose : animer relève la place de ses fumées)
        chantiers.set(c, m);
        continue;
      }
      const b = E.M.maillageBatiment({ cle, couleur, epoque, saison: this.saison, neige: this.neige, ruine });
      b.mesh.position.set(x - f.ox, E.P.dessus(i), z - f.oz); b.mesh.rotation.y = rot;
      this.villes.add(b.mesh); animer(b, couleur);
      if (!ruine) this.posesEmp.push({ cle: `${k}|${cle}|${couleur}|${epoque}`, k, bat: cle, couleur, epoque, boites: b.boites, x, z, y: b.mesh.position.y, rot });
    }
    for (const [c, m] of this.chantiers) if (!chantiers.has(c)) E.T.jeter(m.groupe);
    this.chantiers = chantiers;
    this.animSale = true;
    this.majVie();
    this.sale = true;
  }
  // les habitants et les pièces mobiles des bâtiments des emplacements (animations.js de web_engine) : seulement de tout près
  // (hexagone d'au moins PRES_PX à l'écran), animations permises, et pour les bâtiments à l'écran ; chaque modèle est assemblé
  // une fois, un seul par image (10 à 15 ms chacun), et jeté quand il sort de la vue. Rend vrai s'il en reste à assembler.
  animes(cam, vw, vh, anim) {
    const N = this.N, voulu = new Map();
    if (anim && N && !N.leger && N.pas * cam.z >= PRES_PX) {
      const hx = vw / 2 / cam.z + N.pas, hy = vh / 2 / (cam.z * K) + N.pas;
      for (const p of this.posesEmp) {
        const t = N.g.liste[p.k];
        if (Math.abs(t.gx - cam.x) < hx && Math.abs(t.gy - cam.y) < hy) voulu.set(p.cle, p);
      }
    }
    for (const [cle, m] of this.vies) if (!voulu.has(cle)) { E.T.jeter(m.groupe); this.vies.delete(cle); }
    let budget = 1;
    for (const [cle, p] of voulu) {
      let m = this.vies.get(cle);
      if (!m) {
        if (!budget--) return true;
        m = E.MO.modele(E.A.animationsAncien(p.bat, p.epoque, p.boites, p.couleur), p.k);
        this.vies.set(cle, m); this.habitants.add(m.groupe); m.groupe.rotation.y = p.rot;
        m.groupe.position.set(p.x - this.fen.ox, p.y, p.z - this.fen.oz);
        E.MO.animer(m);
      } else m.groupe.position.set(p.x - this.fen.ox, p.y, p.z - this.fen.oz);   // (la fenêtre a pu être refaite : son origine bouge)
    }
    this.sale = true;
    return false;
  }

  // la vignette d'un bâtiment (clé web_engine) pour le panneau de la place : une image (data: PNG à fond transparent)
  // rendue par le moteur dans un coin de son canevas, aussitôt redessiné, et gardée ; null tant que le plateau n'est pas prêt,
  // undefined pour « plus tard » : deux nouvelles par tranche de 50 ms, la liste des chaînes se remplit sans figer la page
  vignette(cle, couleur = '#8d8a7a', an = 1700) {
    const epoque = epoqueDe(an), k = `${cle}|${couleur}|${epoque}`;
    if (this.vignettes.has(k)) return this.vignettes.get(k);
    const r = E.S.renderer, T = E.S.THREE, px = VIG, cote = px / r.getPixelRatio(), H = r.domElement.height;
    if (!this.fen || r.domElement.width < px || H < px) return null;
    const now = performance.now();
    if (now - (this.vigT || 0) > 50) { this.vigT = now; this.vigN = 0; }
    if (this.vigN++ >= 2) return undefined;
    if (!this.vigScene) {
      const sc = new T.Scene(), soleil = new T.DirectionalLight(0xfff0d4, 2.6);
      soleil.position.set(4, 8, 6); sc.add(new T.HemisphereLight(0xeef7ff, 0x7d8466, 1.5), soleil);
      this.vigScene = { sc, cam: new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 50) };
    }
    const { sc, cam } = this.vigScene, { mesh } = E.M.maillageBatiment({ cle, couleur, epoque });
    sc.add(mesh);
    const bb = new T.Box3().setFromObject(mesh), c = bb.getCenter(new T.Vector3()), R = bb.getSize(new T.Vector3()).length() / 2 * 0.9;
    Object.assign(cam, { left: -R, right: R, top: R, bottom: -R });
    cam.position.copy(c).add(new T.Vector3(1, 0.85, 1.25).setLength(20)); cam.lookAt(c); cam.updateProjectionMatrix();
    // deux rendus, sur fond noir puis blanc : leur écart donne la transparence (bords adoucis compris)
    const vp = r.getViewport(new T.Vector4()), ci = r.getScissor(new T.Vector4()), test = r.getScissorTest();
    r.setViewport(0, 0, cote, cote); r.setScissor(0, 0, cote, cote); r.setScissorTest(true);
    const [noir, blanc] = [0x000000, 0xffffff].map(fond => {
      sc.background = new T.Color(fond); E.rendreScene(sc, cam);
      const c2 = document.createElement('canvas'); c2.width = c2.height = px;
      const g = c2.getContext('2d', { willReadFrequently: true });
      g.drawImage(r.domElement, 0, H - px, px, px, 0, 0, px, px);
      return { c2, g, d: g.getImageData(0, 0, px, px) };
    });
    r.setViewport(vp); r.setScissor(ci); r.setScissorTest(test);
    sc.remove(mesh);
    const a = noir.d.data, b = blanc.d.data, bo = [px, px, 0, 0];
    for (let i = 0; i < a.length; i += 4) {
      const al = 1 - (b[i] - a[i] + b[i + 1] - a[i + 1] + b[i + 2] - a[i + 2]) / 765;
      for (let j = 0; j < 3; j++) a[i + j] = al > 0.01 ? Math.min(255, a[i + j] / al) : 0;
      a[i + 3] = Math.round(al * 255);
      if (al > 0.04) { const x = (i >> 2) % px, y = (i >> 2) / px | 0; bo[0] = Math.min(bo[0], x); bo[1] = Math.min(bo[1], y); bo[2] = Math.max(bo[2], x + 1); bo[3] = Math.max(bo[3], y + 1); }
    }
    noir.g.putImageData(noir.d, 0, 0);
    // recadrée sur le bâtiment, au carré
    const l = Math.max(bo[2] - bo[0], bo[3] - bo[1], 1), out = blanc.c2, g2 = blanc.g;
    g2.clearRect(0, 0, px, px);
    g2.drawImage(noir.c2, (bo[0] + bo[2] - l) / 2, (bo[1] + bo[3] - l) / 2, l, l, 0, 0, px, px);
    const url = out.toDataURL('image/png');
    this.vignettes.set(k, url);
    // (le canevas ne garde pas son image : la vue est redessinée avant que le navigateur ne la montre)
    queueMicrotask(() => { E.rendre(); this.sale = true; });
    return url;
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
    if (cle !== this.cleCam) { this.cleCam = cle; this.tCam = now; this.sale = true; this.animSale = true; }
    const hx = vw / 2 / cam.z, hy = vh / 2 / (cam.z * K), v = [cam.x - hx, cam.x + hx, cam.y - hy, cam.y + hy];
    const voulu = choisirPas(vw, vh, cam.z, K, this.mp.W, this.mp.H), f = this.fen;
    const dehors = !f || !couvre(f, ...v), detail = f && voulu.niv < f.niv;   // (en zoomant, plus fin ; en dézoomant, la vue sort de la fenêtre)
    if (dehors || detail) {
      // pendant un geste on garde la fenêtre (sauf si la vue en sort tout entière) : on rebâtit quand la caméra se pose
      const loin = !f || v[1] < f.x0 || v[0] > f.x1 || v[3] < f.y0 || v[2] > f.y1;
      // en dézoomant, la fenêtre est bâtie pour une vue 1,6 fois plus large (au même niveau de détail) : le cran suivant
      // tombe encore dedans, au lieu d'arrêter l'image une fois de plus
      const large = f && cam.z < f.z ? choisirPas(vw, vh, cam.z / 1.6, K, this.mp.W, this.mp.H) : voulu;
      if (loin || now - this.tCam > 250) { this.batir(large.niv === voulu.niv ? large : voulu, cam.x, cam.y); this.fen.z = cam.z; }
    }
    // animations permises : une image à chaque tour de la boucle (30 par seconde au plus en qualité légère), comme dans
    // les jeux de web_engine ; animations coupées (réglage, mouvement réduit) : seulement quand quelque chose a changé
    const pas = anim ? (E.S.qualite.niveau === 'leger' ? 30 : 0) : Infinity;
    if (this.animSale) this.animSale = this.animes(cam, vw, vh, anim);   // (la vue ou les bâtiments ont changé)
    if (E.P.decorEnCours()) this.sale = true;   // (le décor arrive par morceaux : chacun se montre)
    if (!this.sale && now - this.tRendu < pas) return false;
    this.majClimat(cam);
    this.camJeu = [{ x: cam.x, y: cam.y, z: cam.z }, vw, vh];   // (les étiquettes du moteur se posent avec, calage)
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
  dispose() { E.S.scene.remove(this.villes); E.S.scene.remove(this.habitants); }
}
const dist = (g, k, n) => Math.hypot(g.liste[k].gx - n.x, g.liste[k].gy - n.y);
