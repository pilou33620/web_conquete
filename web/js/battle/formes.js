// Vue tactique : constantes partagées par le rendu, les commandes, l'interface et la maquette de développement.
// Types de cases du champ de bataille, emprise au sol des formations, libellés en français.

// Types de case, dans l'ordre du contrat (§ 3). Si le serveur envoie `types: {PRE: 0, …}`, cette table est remplacée.
// BARRICADE (17) : ouvrages de fortune, ajoutés par le moteur.
export const CELL_NAMES = ['PRE', 'CHAMP', 'VIGNE', 'LANDE', 'BOIS', 'FORET', 'MARAIS', 'EAU', 'GUE', 'ROUTE', 'CHEMIN',
  'BATI', 'MUR', 'BRECHE', 'PORTE', 'SABLE', 'ROCHE', 'BARRICADE', 'VERGER'];   // (VERGER : SPEC-CARTES.md)
export const T = Object.fromEntries(CELL_NAMES.map((k, i) => [k, i]));

// table de correspondance : code reçu → code du client (identité, sauf si le serveur a numéroté autrement).
// `types` est soit la liste des noms dans l'ordre des codes (moteur), soit un objet {nom: code}.
export function cellRemap(types) {
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) map[i] = i < CELL_NAMES.length ? i : T.PRE;
  if (Array.isArray(types)) {
    types.forEach((name, code) => { const k = T[String(name).toUpperCase().replace(/^T_/, '')]; if (k !== undefined && code < 256) map[code] = k; });
  } else if (types && typeof types === 'object') {
    for (const [name, code] of Object.entries(types)) {
      const k = T[String(name).toUpperCase().replace(/^T_/, '')];
      if (k !== undefined && code >= 0 && code < 256) map[code] = k;
    }
  }
  return map;
}

export const CLS_OF_TYPE = { cavalerie: 'cavalerie', artillerie: 'artillerie', mitrailleuses: 'artillerie', general: 'general', etat_major: 'general', chariot: 'chariot' };
export const clsOf = u => u.cls || CLS_OF_TYPE[u.type] || 'inf';
export const isLight = u => u.light ?? (u.type === 'legere' || u.type === 'chasseurs');
export const isGeneral = u => u.type === 'general' || u.cls === 'general' || u.cls === 'etat_major';
export const isWagon = u => u.type === 'chariot' || u.cls === 'chariot';
// nom du général : champ `gen` (objet {name, trait…} du moteur, ou texte)
export const genName = u => (u.gen && typeof u.gen === 'object' ? u.gen.name : u.gen) || '';

export const TYPE_LABEL = {
  ligne: 'Infanterie de ligne', legere: 'Infanterie légère', grenadiers: 'Grenadiers', chasseurs: 'Chasseurs',
  sapeurs: 'Sapeurs', garde: 'Garde nationale', cavalerie: 'Cavalerie', artillerie: 'Artillerie', mitrailleuses: 'Mitrailleuses', milice: 'Milice',
  general: 'État-major', chariot: 'Chariot de munitions',
};
export const FORM_LABEL = { ligne: 'Ligne', colonne: 'Colonne', carre: 'Carré', tirailleurs: 'Tirailleurs', batterie: 'En batterie', attelee: 'Attelée', maisons: 'Dans les maisons' };
export const FORM_HELP = {
  ligne: 'Tout le front tire ; fragile face aux charges.',
  colonne: 'Marche vite et charge ; offre une belle cible au canon.',
  carre: 'Brise les charges de cavalerie ; le canon y fait des ravages.',
  tirailleurs: 'Dispersés : esquivent les boulets, feu plus faible.',
  batterie: 'Pièces dételées, prêtes à tirer.',
  attelee: 'Pièces attelées : se déplacent, ne tirent pas.',
};
export const FORMS = { inf: ['ligne', 'colonne', 'carre', 'tirailleurs'], cavalerie: ['ligne', 'colonne'], artillerie: ['batterie', 'attelee'], general: [], chariot: [] };
export const STATE_LABEL = {
  repos: 'En position', marche: 'En marche', feu: 'Fait feu', recharge: 'Recharge', charge: 'Charge !', melee: 'Corps à corps',
  deroute: 'En déroute', ralliement: 'Se rallie', hors: 'Hors de combat', formation: 'Change de formation',
};
export const SEASON_LABEL = { printemps: 'Printemps', ete: 'Été', 'été': 'Été', automne: 'Automne', hiver: 'Hiver' };
export const WEATHER_LABEL = {
  soleil: 'Soleil', nuages: 'Nuageux', pluie: 'Pluie', orage: 'Orage', tempete: 'Tempête', neige: 'Neige',
  brouillard: 'Brouillard', canicule: 'Canicule',
};
export const normSeason = s => (s === 'été' ? 'ete' : SEASON_LABEL[s] ? s : 'printemps');

// pièces d'une batterie : 8 au complet, moins avec les pertes
// modèle de pièce d'une batterie selon sa génération d'armes (rules.ARMS['artillerie'] ; SPEC-TECH.md)
export const GUN_MODELS = ['ancien', 'ancien', 'gribeauval', 'valee', 'lahitte', 'bange', '75'];
export const gunModel = u => u.type === 'mitrailleuses' ? 'reffye' : GUN_MODELS[clamp(u.arm ?? 0, 0, GUN_MODELS.length - 1)];
// pièces d'une batterie (le serveur les envoie ; sinon d'après ses pertes) : huit canons, ou six mitrailleuses
export const pieces = u => { const full = u.type === 'mitrailleuses' ? 6 : 8; return u.pieces != null ? Math.max(1, Math.min(full, Math.round(u.pieces))) : Math.max(1, Math.min(full, Math.round(full * (u.men || 0) / Math.max(1, u.men0 || u.men || 1)))); };

// emprise au sol (m) : largeur du front × profondeur (contrat § 4) ; elle rétrécit avec les pertes
export function emprise(u) {
  const cls = clsOf(u), men = Math.max(1, u.men || 0), form = u.form;
  if (isGeneral(u)) return [26, 16];
  if (isWagon(u)) return [8, 18];
  if (cls === 'artillerie') {
    const p = pieces(u);
    return form === 'attelee' ? [22, 30 + 9 * p] : [Math.max(14, 10 * p), 30];
  }
  if (cls === 'cavalerie') {
    const k = men / 250;
    return form === 'colonne' ? [30, Math.max(16, 70 * k)] : [Math.max(14, 100 * k), 15];
  }
  const k = men / 300;
  switch (form) {
    case 'colonne': return [Math.max(14, 40 * Math.sqrt(k)), Math.max(12, 50 * Math.sqrt(k))];
    case 'carre': { const s = Math.max(14, 45 * Math.sqrt(k)); return [s, s]; }
    case 'tirailleurs': return [Math.max(30, 220 * k), 30];
    case 'maisons': return [40, 40];
    default: return [Math.max(10, 120 * k), 12];
  }
}

// uniformes français d'époque (SPEC-3D.md, étape 8) : habit et culotte selon l'année de la bataille, l'arme et le
// régiment (dragons en vert de 1760 à 1860) ; le camp, lui, se lit aux revers. Gris-blanc sous
// Louis XIV, bleu national puis impérial, capote bleu foncé en 1870 ; pantalon garance dès 1829 ; artillerie bleu foncé
// (culotte bleue comprise, après 1760)
export function uniform(year, cls, name = '', kind = '') {
  const y = year || 1790, capote = y >= 1860;
  if (kind === 'milice') return { coat: '#7a6248', trous: '#5a4c3c' };
  const trous = y >= 1829 ? '#9e2b28' : cls === 'cavalerie' ? '#e8dcc0' : y < 1760 ? '#d9d3c3' : '#f3efe4';
  if (cls === 'artillerie') return { coat: '#1f2946', trous: y >= 1760 ? '#1f2946' : trous };
  if (cls === 'cavalerie' && !capote && y >= 1760 && /dragon/i.test(name)) return { coat: '#2f5b3d', trous };
  return { coat: y < 1760 ? '#d9d3c3' : y < 1805 ? '#2b3d7a' : !capote ? '#25366c' : '#2b3552', trous };
}

// nombre d'étoiles d'expérience (0 à 5)
export const stars = xp => Math.max(0, Math.min(5, Math.round((xp || 0) / 20)));
// nombres à la française
export const fmt = n => (Math.round(n) || 0).toLocaleString('fr-FR').replace(/^-/, '−');
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// vue cavalière : le sol est vu un peu de biais, les profondeurs (y) sont écrasées à l'écran
export const TILT = 0.8;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const TAU = Math.PI * 2;
export function hash(i, j, k = 0) {
  let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
// bruit de valeur lissé (0 à 1), continu en x et y
export function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// couleurs : « #rrggbb » → [r, g, b], [r, g, b] → « rgba(…) », mélange de deux couleurs (t = 0 : a, 1 : b)
export function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbStr(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
export function mixHex(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbStr([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
// lumière du soleil : elle vient du nord-ouest (en haut à gauche de l'écran) ; une chose haute de h mètres jette
// son ombre au sol jusqu'à (h × OMBRE[0], h × OMBRE[1]) mètres, vers le sud-est. Terrain, figurines et relief
// suivent la même lumière.
export const OMBRE = [0.62, 0.42];
// angle ramené dans ]−π, π]
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}
// distance du point (px, py) au segment de a à b
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
