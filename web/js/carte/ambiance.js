// Ce que tous les calques de la carte vivante lisent (SPEC-CARTE-2D.md) : les échelles où chaque chose apparaît,
// la saison et la météo de la partie, l'heure du jour (réglage d'affichage), et la liste des lumières de l'image
// (feux, lanternes, fenêtres, incendies, éclairs), remplie par les calques et allumée par ciel.js après la nuit.

// zooms (pixels CSS par km) : de loin un signe, puis le plan des villes, puis la vie, puis le plus près
export const Z = { PLAN: 18, VIE: 110, MAX: 320 };
// km par unité de dessin des figures (hommes, chevaux, charrettes) : la même échelle que la maquette
export const U = 0.0045;

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
};
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
  return cleTuiles() !== avant;
}
// ce dont dépend la peinture des tuiles : la saison, et la neige tombée là où il neige
export const cleTuiles = () => AMB.saison + ':' + Object.entries(AMB.meteo).filter(([, k]) => k === 'neige').map(([z]) => z).join(',');

// lumières de l'image : { x, y (km), r (km), a (0-1), jour (visible aussi de jour : incendies, éclairs), spr ('lueur' | 'fen') }
export const LUM = [];
