// Ce que tous les calques de la carte vivante lisent (SPEC-CARTE-2D.md) : les échelles où chaque chose apparaît,
// la saison et la météo de la partie, l'heure du jour (réglage d'affichage), et la liste des lumières de l'image
// (feux, lanternes, fenêtres, incendies, éclairs), remplie par les calques et allumée par ciel.js après la nuit.

// zooms (pixels CSS par km) : de loin un signe, puis le plan des villes, les armées en colonnes (une bande de 600 hommes
// fait 22 px), la vie (« Livré — les figures lisibles » : les figures grossies y font 3,5 px la personne), le plus près
// (« Livré — la carte de campagne à la vraie taille » : 1 300 px/km au plus près)
export const Z = { PLAN: 18, COLONNES: 110, VIE: 110, MAX: 1300 };
// mètres par unité de dessin des figures, à la vraie taille (un fantassin fait 4,3 unités d'épaules, 0,65 m ; un
// cheval 16, 2,4 m) : la vue de l'intérieur (SPEC-CARTE-2D.md, « Livré — échelle réelle ») et la carte
export const FIG = 0.15;
// les figures lisibles : toutes grossies d'un même facteur k, pour qu'une personne (0,6 m) fasse au moins P px à l'écran ;
// k = 1 dès que la vraie taille suffit (pxm : pixels CSS par mètre). Les bâtiments, rues, routes et plans n'en changent pas.
export const P_FIG = 3.5;
export const kFig = pxm => Math.max(1, P_FIG / (0.6 * pxm));
// km par unité de dessin des figures sur la carte, grossies de K au zoom de l'image (echelle(z), à chaque image)
export let K = 1, U = FIG / 1000;
export const echelle = z => { K = kFig(z / 1000); U = K * FIG / 1000; };
// une figure de t unités fait-elle un pixel au zoom z : à la vraie taille (vraie : étals, enclos, maisons des chantiers,
// dessinés en unités de figure), grossie (vue : une personne toujours, de la vie)
export const vraie = (z, t) => z * FIG / 1000 * t >= 1;
export const vue = (z, t) => vraie(z * kFig(z / 1000), t);

export const SAISONS = ['printemps', 'ete', 'automne', 'hiver'];
// le serveur écrit « été »
export const saisonDe = s => (s === 'été' ? 'ete' : SAISONS.includes(s) ? s : 'printemps');

export const HEURES = ['matin', 'midi', 'soir', 'nuit'];
const lire = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };

// l'état partagé, mis à jour à chaque état reçu du serveur (majAmbiance) et par le réglage de l'heure
export const AMB = {
  saison: 'printemps',
  annee: 1789,
  heure: HEURES.includes(lire('conquete.heure', 'midi')) ? lire('conquete.heure', 'midi') : 'midi',
  meteo: { cote: 'soleil', interieur: 'soleil', montagne: 'soleil' },   // rules.WEATHER, par zone
  yMont: 1e9, xCote: -1e9,
  disette: [],   // [x, y, r] (km) : campagnes en friche autour des places en famine (le joueur) ou en disette (lv)
  mois: 2,       // 0 (janvier) à 11, lu dans la date de l'état
  crue: false,   // la Garonne et la Dordogne débordent : crue de l'état (flood) ou pluie de printemps
};
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const nuit = () => AMB.heure === 'nuit';
export const bivouac = () => AMB.heure === 'soir' || AMB.heure === 'nuit';

export function setHeure(h) {
  if (!HEURES.includes(h)) return;
  AMB.heure = h;
  try { localStorage.setItem('conquete.heure', h); } catch (e) { /* stockage indisponible */ }
}

// zone météo d'un point, comme game/engine.py zone_of
export const zoneDe = (x, y) => (y > AMB.yMont ? 'montagne' : x < AMB.xCote ? 'cote' : 'interieur');
export const meteoEn = (x, y) => AMB.meteo[zoneDe(x, y)] || 'soleil';

// renvoie vrai si ce qui est peint dans les tuiles a changé (saison, neige au sol)
export function majAmbiance(map, st) {
  if (map?.m) { AMB.yMont = map.m.y_mont ?? AMB.yMont; AMB.xCote = map.m.x_cote ?? AMB.xCote; }
  if (!st) return false;
  const avant = cleTuiles();
  AMB.saison = saisonDe(st.season);
  if (st.year) AMB.annee = st.year;
  for (const z of Object.keys(AMB.meteo)) AMB.meteo[z] = st.weather?.[z]?.kind || 'soleil';
  const m = MOIS.findIndex(x => st.date?.includes(' ' + x + ' '));
  if (m >= 0) AMB.mois = m;
  AMB.crue = !!st.flood;   // la grande crue, quand le serveur la tire (un printemps sur cinq environ) : la période de Game.flooded, celle des routes coupées ; pas la pluie du jour
  const R = { village: 3, fort: 3, ville: 4.5, capitale: 6 };
  AMB.disette = (map?.nodes || []).filter(n => { const ns = st.nodes?.[n.id]; return ns && (ns.lv?.[0] === 'disette' || (st.me?.famine && ns.o === st.me.code)); })
    .map(n => [n.x, n.y, R[n.type] || 3]);
  return cleTuiles() !== avant;
}
// ce dont dépend la peinture des tuiles : la saison, la neige tombée là où il neige, les friches, la crue, les brûlis
export const cleTuiles = () => AMB.saison + ':' + Object.entries(AMB.meteo).filter(([, k]) => k === 'neige').map(([z]) => z).join(',') + ':' + AMB.disette.map(d => d[0] + ',' + d[1]).join(';')
  + ':' + (AMB.crue ? 'crue' : '') + ':' + (AMB.mois >= FEU_MOIS[0] && AMB.mois <= FEU_MOIS[1] && anneeSeche(AMB.annee) ? AMB.annee + '-' + AMB.mois : '');
export const enDisette = (x, y) => AMB.disette.some(([px, py, r]) => (x - px) ** 2 + (y - py) ** 2 < r * r);

// lumières de l'image : { x, y (km), r (km), a (0-1), jour (visible aussi de jour : incendies, éclairs), spr ('lueur' | 'fen') }
export const LUM = [];

// ------------------------------------------------------------------ les feux des Landes
// Les étés secs (un sur trois environ), la pinède brûle : sur une grille de FEU_K km, un carré sur 48 a son feu de
// l'année (2 à 5 feux sur toute la forêt), allumé en juin, juillet ou août (mois tiré) ; les autres étés, aucun ; la parcelle reste noire jusqu'en novembre. Mêmes feux pour la même année, partout (tuiles des
// peintres et fumées de la carte). L'appelant vérifie la pinède (terre(map).pinede).
export const FEU_K = 7, FEU_MOIS = [5, 10];
const hash = (i, j, k) => { let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
export const anneeSeche = annee => hash(0, 0, annee * 7 + 9) < 1 / 3;
// le feu du carré (I, J) cette année : { x, y, r (km), m (mois) } ou null
export function feuDe(I, J, annee) {
  if (!anneeSeche(annee) || hash(I, J, annee * 7 + 3) > 1 / 48) return null;
  return { x: (I + 0.3 + 0.4 * hash(I, J, annee * 7 + 4)) * FEU_K, y: (J + 0.3 + 0.4 * hash(I, J, annee * 7 + 5)) * FEU_K, r: 0.5 + 1.1 * hash(I, J, annee * 7 + 6), m: FEU_MOIS[0] + (hash(I, J, annee * 7 + 1) * 3 | 0) };
}
// brûlé (x, y) ce mois-ci : 1 au cœur, de 0 à 1 sur la lisière roussie, 0 hors du feu (ou avant qu'il ne prenne)
export function brule(x, y, annee = AMB.annee, mois = AMB.mois) {
  if (mois < FEU_MOIS[0] || mois > FEU_MOIS[1]) return 0;
  const I = Math.floor(x / FEU_K), J = Math.floor(y / FEU_K), f = feuDe(I, J, annee);
  if (!f || f.m > mois) return 0;
  const dx = x - f.x, dy = y - f.y;
  if (Math.abs(dx) > f.r * 1.6 || Math.abs(dy) > f.r * 1.6) return 0;
  const a = Math.atan2(dy, dx), d = Math.hypot(dx, dy) / (f.r * (1 + 0.3 * Math.sin(a * 3 + I) + 0.15 * Math.sin(a * 7 + J)));
  return d < 1 ? 1 : d < 1.15 ? (1.15 - d) / 0.15 : 0;
}
