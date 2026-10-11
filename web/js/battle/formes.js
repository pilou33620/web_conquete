// Vue tactique : constantes partagées par le rendu, les commandes, l'interface et la maquette de développement.
// Types de cases du champ de bataille, emprise au sol des formations, libellés en français.

// Types de case, dans l'ordre du contrat (§ 3). Si le serveur envoie `types: {PRE: 0, …}`, cette table est remplacée.
export const CELL_NAMES = ['PRE', 'CHAMP', 'VIGNE', 'LANDE', 'BOIS', 'FORET', 'MARAIS', 'EAU', 'GUE', 'ROUTE', 'CHEMIN',
  'BATI', 'MUR', 'BRECHE', 'PORTE', 'SABLE', 'ROCHE'];
export const T = Object.fromEntries(CELL_NAMES.map((k, i) => [k, i]));

// table de correspondance : code reçu → code du client (identité, sauf si le serveur a numéroté autrement)
export function cellRemap(types) {
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) map[i] = i < CELL_NAMES.length ? i : T.PRE;
  if (types && typeof types === 'object') {
    for (const [name, code] of Object.entries(types)) {
      const k = T[String(name).toUpperCase().replace(/^T_/, '')];
      if (k !== undefined && code >= 0 && code < 256) map[code] = k;
    }
  }
  return map;
}

export const CLS_OF_TYPE = { cavalerie: 'cavalerie', artillerie: 'artillerie', general: 'general', etat_major: 'general' };
export const clsOf = u => u.cls || CLS_OF_TYPE[u.type] || 'inf';
export const isLight = u => u.light ?? (u.type === 'legere' || u.type === 'chasseurs');
export const isGeneral = u => u.type === 'general' || u.cls === 'general' || u.cls === 'etat_major';

export const TYPE_LABEL = {
  ligne: 'Infanterie de ligne', legere: 'Infanterie légère', grenadiers: 'Grenadiers', chasseurs: 'Chasseurs',
  sapeurs: 'Sapeurs', garde: 'Garde nationale', cavalerie: 'Cavalerie', artillerie: 'Artillerie', milice: 'Milice',
  general: 'État-major',
};
export const FORM_LABEL = { ligne: 'Ligne', colonne: 'Colonne', carre: 'Carré', tirailleurs: 'Tirailleurs', batterie: 'En batterie', attelee: 'Attelée' };
export const FORM_HELP = {
  ligne: 'Tout le front tire ; fragile face aux charges.',
  colonne: 'Marche vite et charge ; offre une belle cible au canon.',
  carre: 'Brise les charges de cavalerie ; le canon y fait des ravages.',
  tirailleurs: 'Dispersés : esquivent les boulets, feu plus faible.',
  batterie: 'Pièces dételées, prêtes à tirer.',
  attelee: 'Pièces attelées : se déplacent, ne tirent pas.',
};
export const FORMS = { inf: ['ligne', 'colonne', 'carre', 'tirailleurs'], cavalerie: ['ligne', 'colonne'], artillerie: ['batterie', 'attelee'], general: [] };
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
export const pieces = u => Math.max(1, Math.min(8, Math.round(8 * (u.men || 0) / Math.max(1, u.men0 || u.men || 1))));

// emprise au sol (m) : largeur du front × profondeur (contrat § 4) ; elle rétrécit avec les pertes
export function emprise(u) {
  const cls = clsOf(u), men = Math.max(1, u.men || 0), form = u.form;
  if (isGeneral(u)) return [26, 16];
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
    default: return [Math.max(10, 120 * k), 12];
  }
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
// angle ramené dans ]−π, π]
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}
