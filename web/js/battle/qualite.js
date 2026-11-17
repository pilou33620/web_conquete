// Mémoire laissée aux figurines en cache (unites.js : cartes des régiments, armées de la carte), selon l'appareil :
// Safari sur iPad ne donne qu'environ 384 Mo à l'ensemble des canevas d'une page. Un niveau choisi autrefois dans
// l'ancien réglage « Qualité graphique » (localStorage 'conquete.bataille.qualite') est encore respecté.

const QUALITES = ['basse', 'moyenne', 'haute', 'ultra'];
const KEY = 'conquete.bataille.qualite';
// sprites : octets des figures en cache
const PROFILS = { basse: { sprites: 6e6 }, moyenne: { sprites: 12e6 }, haute: { sprites: 24e6 }, ultra: { sprites: 48e6 } };

// appareil : iPad (y compris ceux qui se disent Macintosh), iPhone, Android, ordinateur
function appareil() {
  const ua = navigator.userAgent || '', touch = (navigator.maxTouchPoints || 0) > 1;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  const petit = Math.min(screen.width || 1000, screen.height || 1000) < 600;
  const coeurs = navigator.hardwareConcurrency || 4, memoire = navigator.deviceMemory || 8;
  return { ios, touch, petit, coeurs, memoire, mobile: ios || /Android|Mobile/.test(ua) };
}
// choix selon l'appareil
function devine() {
  const a = appareil();
  if (a.mobile && a.petit) return a.memoire <= 2 ? 'basse' : a.memoire <= 4 ? 'moyenne' : 'haute';
  if (a.mobile || a.touch) return a.memoire <= 2 || a.coeurs <= 2 ? 'moyenne' : 'haute';
  return a.coeurs >= 8 && a.memoire >= 8 ? 'ultra' : 'haute';
}

let courant = null;
function lire() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch (e) { v = null; }
  const auto = !v || v.startsWith('auto-');
  const q = v ? v.replace(/^auto-/, '') : '';
  return { q: QUALITES.includes(q) ? q : devine(), auto };
}
export function qualite() { if (!courant) courant = lire(); return courant; }
export function profil(q = qualite().q) { return PROFILS[q] || PROFILS.haute; }
