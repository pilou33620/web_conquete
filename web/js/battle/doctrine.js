// Vue tactique : ce que chaque arme sait faire. Les ordres du panneau dépendent de l'arme choisie :
//  - l'infanterie de ligne tire à volonté ou en salve à bonne portée, ou charge à la baïonnette (avec ou sans salve) ;
//  - les grenadiers : une salve à bout portant, puis la baïonnette ;
//  - les voltigeurs et chasseurs harcèlent : ils tiraillent à portée efficace et se replient devant l'ennemi ;
//  - la cavalerie vit de la charge (et de la poursuite des fuyards) : elle ne tire pas ;
//  - l'artillerie choisit son projectile (boulet de loin, mitraille de près) et peut faire de la contre-batterie.
// Le moteur (battle.py, TacticalBattle.order) applique ces ordres : fire (mode free|volley|hold), charge,
// volley_charge, harass, cover, pursue, shot (mode auto|boulet|mitraille), counter (mode on|off), hold, rally, retreat.
import { clsOf, isLight, isGeneral, isWagon, esc } from './formes.js';

export const ORDER_LABEL = {
  move: 'En marche', attack: 'Attaque', charge: 'Charge', volley_charge: 'Salve puis baïonnette', harass: 'Harcèlement',
  hold: 'Tient sa position', retreat: 'Retraite',
};

// l'arme d'une unité
export function arme(u) {
  if (isGeneral(u)) return 'etat_major';
  if (isWagon(u)) return 'chariot';
  const c = clsOf(u);
  if (c === 'cavalerie') return 'cavalerie';
  if (c === 'artillerie') return 'artillerie';
  if (u.type === 'sapeurs') return 'sapeurs';
  if (isLight(u)) return 'tirailleurs';
  if (u.type === 'grenadiers') return 'grenadiers';
  return 'ligne';   // ligne, garde nationale, milice
}

// actions proposées, par arme (ordre d'affichage)
const ACTIONS = {
  ligne: ['feu', 'assaut', 'couvert', 'allure', 'tenir'],
  grenadiers: ['feu', 'assaut', 'couvert', 'allure', 'tenir'],
  tirailleurs: ['feu', 'harceler', 'couvert', 'allure', 'tenir'],
  sapeurs: ['feu', 'couvert', 'tenir'],
  cavalerie: ['charge', 'poursuite', 'allure', 'tenir'],
  artillerie: ['projectile', 'contrebatterie', 'feu', 'tenir'],
  etat_major: ['tenir'],
  chariot: [],
};

const AIDE = {
  ligne: 'La ligne fait des volées : à volonté, en salve à bonne portée (tout porte, mais on attend l’ordre), ou à la baïonnette.',
  grenadiers: 'Troupes d’élite : une salve à bout portant, puis la baïonnette. Ils tiennent mieux le corps à corps.',
  tirailleurs: 'Dispersés, ils harcèlent à distance et se replient devant l’ennemi ; ils craignent la cavalerie et la mêlée.',
  sapeurs: 'Peu faits pour le combat en rase campagne : à couvert, derrière les troupes de ligne.',
  cavalerie: 'La cavalerie vit de la charge : sur le flanc, sur les canons, sur les fuyards. Elle ne tire guère.',
  artillerie: 'Boulet de loin, mitraille de près (portée de mitraille affichée en éventail) ; la contre-batterie réduit d’abord les canons ennemis.',
  etat_major: 'Le général rallie les fuyards à son contact et soutient le moral des troupes proches.',
  chariot: 'Les munitions de l’armée : à garder à l’abri, près des régiments.',
};

export function armeOf(us) {
  const set = new Set(us.map(arme));
  return set.size === 1 ? [...set][0] : 'mix';
}

// ordres communs à toutes les unités choisies
function actionsOf(us) {
  let common = null;
  for (const u of us) {
    const a = ACTIONS[arme(u)] || [];
    common = common ? common.filter(x => a.includes(x)) : [...a];
  }
  return common || [];
}

export function aide(us) { return us.length ? AIDE[armeOf(us)] || '' : ''; }

const FIRE_MODES = [['free', 'À volonté', 'Chaque homme tire dès que l’ennemi est à bonne portée.'],
  ['volley', 'Salve', 'Feu de salve : on ne tire qu’à moins de 85 % de la portée efficace, d’un seul coup, un quart plus juste mais plus lent à recharger. Ménage les cartouches.'],
  ['hold', 'Cesser', 'Cessez le feu (on garde ses cartouches).']];
const SHOTS = [['auto', 'Au choix', 'Les pièces choisissent : mitraille à courte distance, boulet au-delà.'],
  ['boulet', 'Boulet', 'Boulet sur toute la portée, même à bout portant.'],
  ['mitraille', 'Mitraille', 'On attend l’ennemi à portée de mitraille : terrible à moins de 150 m, nulle au-delà.']];

// HTML des ordres propres à l'arme (data-a : l'interface les relie à act())
export function ordresHtml(us, ctx) {
  const acts = actionsOf(us);
  const all = f => us.every(f);
  const seg = (name, modes, cur) => `<div class="bp-row"><div class="bp-seg" role="group" aria-label="${esc(name)}">${modes.map(([m, l, t]) =>
    `<button data-a="${name}" data-m="${m}" class="${cur(m) ? 'on' : ''}" title="${esc(t)}">${esc(l)}</button>`).join('')}</div></div>`;
  let h = '', btns = '';
  const b = (a, label, title, cls = '', on = false) => `<button class="bt-btn ${cls} ${on ? 'on' : ''}" data-a="${a}" title="${esc(title)}">${label}</button>`;
  for (const a of acts) {
    switch (a) {
      case 'projectile':
        h += seg('shot', SHOTS, m => all(u => (u.shot || 'auto') === m));
        break;
      case 'feu': {
        const salve = all(u => arme(u) === 'ligne' || arme(u) === 'grenadiers');
        h += seg('fire', salve ? FIRE_MODES : FIRE_MODES.filter(m => m[0] !== 'volley'), m => all(u => (u.fire || 'free') === m));
        break;
      }
      case 'assaut':
        btns += b('vcharge', 'Salve + baïonnette', 'Approche, lâche une volée à bout portant, puis charge à la baïonnette. Touchez ensuite l’ennemi visé.', 'charge', ctx.targeting === 'vcharge');
        btns += b('charge', 'Baïonnette !', 'Charge à la baïonnette, sans tirer. Touchez ensuite l’ennemi visé.', 'charge', ctx.targeting === 'charge');
        break;
      case 'charge':
        btns += b('charge', 'Charger !', 'Lance les escadrons au galop sur l’ennemi que vous touchez : choc, flanc, canons et fuyards.', 'charge', ctx.targeting === 'charge');
        break;
      case 'poursuite':
        btns += b('pursue', 'Poursuivre', 'Court sus aux fuyards les plus proches (sabre dans le dos, prisonniers).');
        break;
      case 'harceler':
        btns += b('harass', 'Harceler', 'Tiraille à portée efficace et recule devant l’ennemi qui approche.', '', all(u => u.order === 'harass'));
        break;
      case 'couvert':
        btns += b('cover', 'Se couvrir', 'Gagne le meilleur couvert proche (bois, mur, haie).');
        break;
      case 'allure': {
        const cav = all(u => arme(u) === 'cavalerie');
        btns += b('gait', cav ? 'Au galop' : 'Pas de course', cav ? 'Les prochains déplacements se font au galop (les chevaux se fatiguent).' : 'Les prochains déplacements se font au pas de course (les hommes se fatiguent).', '', !!ctx.run);
        break;
      }
      case 'contrebatterie':
        btns += b('counter', 'Contre-batterie', 'Les pièces visent d’abord l’artillerie ennemie.', '', all(u => u.prio === 'artillerie'));
        break;
      case 'tenir':
        btns += b('hold', 'Tenir', 'Tient la position.', '', all(u => u.order === 'hold'));
        break;
      default:
    }
  }
  return { top: h, btns };
}
