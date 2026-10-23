// Bataille tactique : entrée et sortie depuis la carte de campagne.
// À l'entrée, la carte de campagne zoome vers le lieu du combat (map.moveTo, environ 1 s) pendant que le champ
// de bataille se charge et se peint ; puis la vue de bataille apparaît en fondu, plein écran, par-dessus, et sa
// caméra poursuit le mouvement jusqu'aux troupes du joueur. Pendant la bataille, la carte de campagne ne se
// redessine plus et le jeu ne l'interroge plus (main.js). Au retour : récapitulatif, fondu, dézoom de la campagne.
import { BattleView } from './vue.js';

const ZOOM_MS = 1000, FADE_MS = 700;
const NO_GL = 'Cet appareil ne peut pas afficher les batailles en 3D (WebGL 2 indisponible) : vos officiers mènent celle-ci, elle se résout automatiquement.';

// WebGL 2, sans quoi la vue de bataille ne peut pas s'afficher
let gl2 = null;
function hasGL2() {
  if (gl2 === null) try { const g = document.createElement('canvas').getContext('webgl2'); gl2 = !!g; g?.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { gl2 = false; }
  return gl2;
}

// la feuille de style de la bataille, chargée à la demande
let styleP = null;
function ensureStyle() {
  if (styleP) return styleP;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../../css/bataille.css', import.meta.url).href; l.dataset.bataille = '1';
  styleP = new Promise(r => { l.onload = l.onerror = r; setTimeout(r, 2000); });
  document.head.appendChild(l);
  return styleP;
}

export class Bataille {
  // map : la carte de campagne (MapView) ou null ; onStart / onEnd : suspendre / reprendre la campagne
  constructor({ api, map = null, onStart = null, onEnd = null, parent = null }) {
    this.api = api; this.map = map; this.onStart = onStart; this.onEnd = onEnd;
    this.parent = parent || document.getElementById('app') || document.body;
    this.view = null;
    this.active = false;
    this.closed = new Set();   // batailles dont le joueur a déjà vu la fin
    ensureStyle();
  }
  // faut-il ouvrir la vue pour cet état de campagne ?
  wants(tac) {
    if (!tac || tac.bid == null || this.active) return false;
    if (!hasGL2()) { this.withoutGL(tac); return false; }
    if (this.failedAt && performance.now() - this.failedAt < 15000) return false;   // échec récent : pas de boucle
    return !(this.closed.has(String(tac.bid)) && tac.phase === 'fin');
  }
  // tac : {bid, phase} ; st : état de campagne (pour trouver le lieu de la bataille)
  async enter(tac, st = null) {
    if (this.active) return;
    if (!hasGL2()) { this.withoutGL(tac); return; }
    this.active = true;
    this.bid = String(tac.bid);
    this.onStart && this.onStart();
    await ensureStyle();
    const root = document.createElement('div');
    root.className = 'bt-root';
    this.parent.appendChild(root);
    this.root = root;
    document.body.classList.add('en-bataille');
    const view = new BattleView(this.api, root);
    this.view = view;
    window.__btView = view;   // pour les essais (comme window.__ui)
    view.onExit = r => this.exit(r);
    const t0 = performance.now();
    // le lieu : la bataille de campagne, sinon le centre donné par la carte de bataille
    const bt = st?.battles?.find(b => String(b.id) === this.bid);
    let pos = bt ? [bt.x, bt.y] : null;
    const map = this.map;
    if (map) this.prevCam = { ...map.cam };
    const zoomTo = p => {
      if (!map || !p) return;
      map.moveTo(p[0], p[1], 26);
      if (map.camAnim) map.camAnim.dur = ZOOM_MS;
    };
    zoomTo(pos);
    // interrompue pendant l'ouverture (abort : nouvelle partie, chargement) : cette vue est déjà défaite, on s'arrête là
    const gone = () => this.view !== view;
    let ok = true;
    try { await view.load(this.bid); } catch (e) { ok = false; console.error(e); }
    if (gone()) return;
    if (!ok) { this.abort('La carte de cette bataille n’a pas pu être chargée.'); return; }
    if (!pos && view.map?.camp) { pos = [view.map.camp.x, view.map.camp.y]; zoomTo(pos); await wait(ZOOM_MS); }
    // le temps que la caméra de campagne arrive
    const left = ZOOM_MS - (performance.now() - t0);
    if (left > 0) await wait(left);
    if (gone()) return;
    // la vue de bataille prend le relais : elle part d'un peu plus loin et poursuit le zoom
    const fit = view.fitZ();
    view.cam = { x: view.W / 2, y: view.H / 2, z: fit * 0.62 };
    view.ui.entering = true;
    view.start();
    await waitFor(() => view.st, 2500);
    if (gone()) return;
    requestAnimationFrame(() => root.classList.add('on'));
    view.ui.cartouche();
    if (view.st) view.focusMine(1500); else view.moveCam(view.W / 2, view.H / 2, fit, 1500);
    await wait(FADE_MS + 100);
    if (gone()) return;
    this.suspendMap();
    view.ui.entering = false;
  }
  // retour à la campagne, avec le résultat (affiché par main.js / ui.js)
  async exit(result = null) {
    if (!this.active || this.leaving) return;
    this.leaving = true;
    const view = this.view;
    this.closed.add(this.bid);
    // la vue cesse d'interroger le serveur (qui va oublier la bataille : une dernière question tomberait dans le vide)
    view.closing = true;
    clearTimeout(view.pollT);
    const fin = view.st?.phase === 'fin';
    view.moveCam(view.cam.x, view.cam.y, view.cam.z * 0.7, FADE_MS);
    this.resumeMap();
    this.root.classList.remove('on');
    document.body.classList.remove('en-bataille');
    if (this.map && this.prevCam) { const p = this.prevCam; this.map.moveTo(p.x, p.y, Math.min(p.z, 8)); if (this.map.camAnim) this.map.camAnim.dur = ZOOM_MS; }
    await wait(FADE_MS);
    view.dispose();
    // le serveur oublie la bataille terminée (sous-commande « close »)
    if (fin) this.api.post('/api/cmd', { cmd: 'tac', sub: 'close', bid: this.bid }).catch(() => {});
    this.root.remove();
    this.view = null; this.root = null;
    this.active = false; this.leaving = false;
    this.onEnd && this.onEnd(result, this.bid);
  }
  // sans WebGL 2 : la bataille est confiée aux officiers (une fois), puis le serveur l'oublie quand elle est finie
  withoutGL(tac) {
    const bid = String(tac.bid);
    this.sansGL = this.sansGL || new Set();
    if (tac.phase === 'fin') {
      if (!this.sansGL.has('fin|' + bid)) { this.sansGL.add('fin|' + bid); this.api.post('/api/cmd', { cmd: 'tac', sub: 'close', bid }).catch(() => {}); }
      return;
    }
    if (this.sansGL.has(bid)) return;
    this.sansGL.add(bid);
    // ordres par défaut, bataille jouée au plus vite (serveur injoignable : on retentera à la prochaine interrogation)
    this.api.post('/api/cmd', { cmd: 'tac', sub: 'orders', bid, orders: {}, go: true, skip: true }).then(r => { if (!r?.ok) this.sansGL.delete(bid); }, () => this.sansGL.delete(bid));
    this.onEnd && this.onEnd(null, bid, NO_GL);
  }
  // interrompt sans animation (nouvelle partie, erreur)
  abort(msg) {
    if (msg) this.failedAt = performance.now();
    if (this.view) this.view.dispose();
    this.root?.remove();
    this.resumeMap();
    document.body.classList.remove('en-bataille');
    this.view = null; this.root = null; this.active = false; this.leaving = false;
    this.onEnd && this.onEnd(null, this.bid, msg);
  }
  // la carte de campagne cesse de se redessiner (elle est cachée) : l'iPad garde ses forces pour la bataille
  suspendMap() {
    const m = this.map;
    if (!m || m._btSusp) return;
    m._btSusp = true;
    m.frame = function (t) { this.lastFrame = t; requestAnimationFrame(tt => this.frame(tt)); };
  }
  resumeMap() {
    const m = this.map;
    if (!m || !m._btSusp) return;
    delete m.frame;
    m._btSusp = false;
    m.lastFrame = performance.now();
  }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms) { const t = performance.now(); while (!fn() && performance.now() - t < ms) await wait(40); }
