// Vue tactique : réglage « Qualité graphique » des batailles en 3D (Basse, Moyenne, Haute, Ultra).
// Chaque niveau fixe la finesse de l'image (densité de pixels, anticrénelage), le détail du sol, le zoom le plus
// rapproché, le nombre de figurines et de fumées, la richesse du décor, les ombres, et la mémoire laissée aux caches
// (Safari sur iPad ne donne qu'environ 384 Mo à l'ensemble des canevas d'une page).
// Au premier lancement, le niveau est choisi selon l'appareil, puis ajusté d'après les images par seconde
// mesurées pendant la première bataille (on ne fait que descendre). Un choix fait à la main n'est plus touché.
// Enregistré dans localStorage ('conquete.bataille.qualite' : « haute », ou « auto-haute » tant qu'il est automatique).

export const QUALITES = ['basse', 'moyenne', 'haute', 'ultra'];
export const QUALITE_LABEL = { basse: 'Basse', moyenne: 'Moyenne', haute: 'Haute', ultra: 'Ultra' };
export const QUALITE_AIDE = {
  basse: 'Pour les appareils anciens : image moins fine, peu de fumée, bois allégés, sans ombres.',
  moyenne: 'Bon compromis pour les tablettes et téléphones modestes : ombres du décor, moins de figurines.',
  haute: 'Écran Retina, sol détaillé, ombres des troupes (iPad récent).',
  ultra: 'Tout au maximum, pour les ordinateurs.',
};
const KEY = 'conquete.bataille.qualite';

// dpr : densité maximale de l'image ; aa : anticrénelage (choisi à l'ouverture de la bataille) ; level : sol le plus
// fin (pixels par mètre) ; maxZ : zoom le plus rapproché (pixels CSS par mètre) ; troupes : figurines au plus (au-delà,
// chacune compte plusieurs hommes) ; puffs : fumées et poussières ; fx : richesse des effets et du décor (0 à 3 : bois
// allégés, arbres plus simples, moins de fumée) ; ombres : 0 aucune, 1 le décor, 2 aussi les troupes, 3 plus fines ;
// clouds : ombres des nuages ; textures : octets des motifs du sol ; sprites : octets des figurines des cartes d'unités
export const PROFILS = {
  basse: { dpr: 1, aa: false, level: 4, maxZ: 25, troupes: 3000, puffs: 420, fx: 0, ombres: 0, clouds: false, textures: 8e6, sprites: 6e6 },
  moyenne: { dpr: 1.5, aa: false, level: 8, maxZ: 32, troupes: 6000, puffs: 800, fx: 1, ombres: 1, clouds: true, textures: 20e6, sprites: 12e6 },
  haute: { dpr: 2, aa: false, level: 16, maxZ: 40, troupes: 10000, puffs: 1400, fx: 2, ombres: 2, clouds: true, textures: 32e6, sprites: 24e6 },
  ultra: { dpr: 2.5, aa: true, level: 16, maxZ: 45, troupes: 20000, puffs: 2400, fx: 3, ombres: 3, clouds: true, textures: 48e6, sprites: 48e6 },
};

// appareil : iPad (y compris ceux qui se disent Macintosh), iPhone, Android, ordinateur
function appareil() {
  const ua = navigator.userAgent || '', touch = (navigator.maxTouchPoints || 0) > 1;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  const petit = Math.min(screen.width || 1000, screen.height || 1000) < 600;
  const coeurs = navigator.hardwareConcurrency || 4, memoire = navigator.deviceMemory || 8;
  return { ios, touch, petit, coeurs, memoire, mobile: ios || /Android|Mobile/.test(ua) };
}
// premier choix, avant toute mesure
export function devine() {
  const a = appareil();
  // (un téléphone a peu de pixels à remplir : la qualité Haute lui va, sauf petite mémoire ; Safari ne donne pas
  // deviceMemory : c'est la mesure des images par seconde qui corrige)
  if (a.mobile && a.petit) return a.memoire <= 2 ? 'basse' : a.memoire <= 4 ? 'moyenne' : 'haute';
  if (a.mobile || a.touch) return a.memoire <= 2 || a.coeurs <= 2 ? 'moyenne' : 'haute';
  return a.coeurs >= 8 && a.memoire >= 8 ? 'ultra' : 'haute';
}

let courant = null;
const ecoutes = new Set();
function lire() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch (e) { v = null; }
  const auto = !v || v.startsWith('auto-');
  const q = v ? v.replace(/^auto-/, '') : '';
  return { q: QUALITES.includes(q) ? q : devine(), auto };
}
export function qualite() { if (!courant) courant = lire(); return courant; }
export function profil(q = qualite().q) { return PROFILS[q] || PROFILS.haute; }
// choix à la main (menu ☰ ou bataille) ; auto : choix automatique (mesure des images par seconde)
export function setQualite(q, auto = false) {
  if (!QUALITES.includes(q)) return;
  courant = { q, auto };
  try { localStorage.setItem(KEY, (auto ? 'auto-' : '') + q); } catch (e) { /* stockage indisponible : réglage pour cette fois */ }
  for (const f of ecoutes) { try { f(courant); } catch (e) { console.error(e); } }
}
export function onQualite(f) { ecoutes.add(f); return () => ecoutes.delete(f); }

// Mesure des images par seconde pendant la bataille : sur 5 s de combat sans geste ni peinture du sol en
// rafale, si la moitié des images dépasse 38 ms (moins de 26 images/s), on descend d'un niveau. Seulement tant
// que le réglage est automatique, et deux fois au plus par bataille. (Un iPhone ou un iPad en mode économie
// d'énergie bride l'affichage à 30 images/s, soit 33 ms : ce n'est pas une raison de descendre.)
export class Mesure {
  constructor() { this.dts = []; this.t0 = 0; this.descentes = 0; }
  // dt : intervalle entre deux images (ms) ; calme : rien d'exceptionnel à cette image
  image(dt, calme, now) {
    const c = qualite();
    if (!c.auto || this.descentes >= 2 || document.hidden) { this.dts.length = 0; return null; }
    if (!calme || dt > 400) { this.dts.length = 0; this.t0 = now; return null; }
    if (!this.dts.length) this.t0 = now;
    this.dts.push(dt);
    if (now - this.t0 < 5000) return null;
    const s = this.dts.slice().sort((a, b) => a - b), med = s[s.length >> 1];
    this.dts.length = 0;
    const i = QUALITES.indexOf(c.q);
    if (med > 38 && i > 0) { this.descentes++; setQualite(QUALITES[i - 1], true); return QUALITES[i - 1]; }
    return null;
  }
}
