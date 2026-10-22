// Valeurs chiffrées d'une troupe, à la manière d'Empire: Total War. Le serveur les calcule (game/tactics/stats.py) :
// on ne fait ici que les montrer. Chaque valeur : [base, expérience, général].
import { esc, fmt } from './battle/formes.js';

export const VALEURS = [   // clé, nom, abrégé, aide
  ['mel', 'Mêlée', 'Mêl.', 'Corps à corps : pertes infligées à la baïonnette ou au sabre. La même valeur frappe et tient (le moral se partage au rapport des forces). 40 : une ligne aguerrie.'],
  ['chg', 'Charge', 'Ch.', 'Choc de la charge à plein élan (110 m de galop, 45 m de course à pied). L’expérience n’y fait rien ; les chevaux essoufflés, le terrain et le flanc, si.'],
  ['pre', 'Précision', 'Préc.', 'Justesse du tir, par homme (par pièce pour les canons) : l’arme et l’expérience. La distance, la fumée et la pluie la font baisser.'],
  ['rec', 'Rechargement', 'Rech.', 'Secondes entre deux salves, troupe fraîche (fatigue : jusqu’à +25 %, salve ordonnée : +15 %).'],
  ['por', 'Portée', 'Portée', 'Portée efficace / maximale (mitraille), en mètres.'],
  ['mun', 'Munitions', 'Mun.', 'Dotation : cartouches par homme, coups par pièce.'],
  ['vit', 'Vitesse', 'Vit.', 'Au pas, en m/s, sur prairie (ligne ×0,8, colonne ×1,1, carré ×0,4).'],
  ['dis', 'Discipline', 'Disc.', 'Tenue sous le feu : le moral perdu à chaque homme tombé est divisé d’autant. Le général tout proche aide encore.'],
  ['car', 'Former le carré', 'Carré', 'Secondes pour former le carré devant la cavalerie (l’expérience et l’ordre mixte l’abrègent).'],
];
const SANS_BARRE = new Set(['rec', 'por', 'mun', 'vit', 'car']);
const num = (x, d = 0) => d ? x.toFixed(d).replace('.', ',').replace(/^-/, '−') : fmt(x);
const sg = (x, d) => (x > 0 ? '+' : '−') + num(Math.abs(x), d);

// total, puis l'expérience (laiton) et le général (vert) à part, comme les chevrons
export function valeur(k, v) {
  if (k === 'por') return `${fmt(v[0])} / ${fmt(v[1])} m${v[2] ? ` · mitr. ${fmt(v[2])}` : ''}`;
  if (k === 'mun') return fmt(v);
  const d = k === 'vit' ? 1 : 0, u = k === 'rec' || k === 'car' ? ' s' : '';
  return `${num(v[0] + v[1] + v[2], d)}${u}${v[1] ? `<small class="vl-x" title="Expérience">${sg(v[1], d)}</small>` : ''}${v[2] ? `<small class="vl-g" title="Général">${sg(v[2], d)}</small>` : ''}`;
}

// fiche d'un régiment (bataille) : nom, barre (base en papier, expérience en laiton, général en vert), valeur ;
// la barre pleine vaut 80 (un vétéran de cavalerie en mêlée, un fusil rayé de vétérans)
export function valeursHtml(s) {
  if (!s) return '';
  return `<div class="vl" aria-label="Valeurs du régiment">${VALEURS.filter(([k]) => s[k] != null).map(([k, nom, , aide]) => {
    const v = s[k], bar = SANS_BARRE.has(k) ? '<span></span>'
      : `<span class="vl-b">${v.map((x, i) => `<i class="${['', 'x', 'g'][i]}" style="width:${Math.max(0, Math.min(100, x / 0.8))}%"></i>`).join('')}</span>`;
    return `<span class="vl-n" title="${esc(aide)}">${nom}</span>${bar}<span class="vl-v">${valeur(k, v)}</span>`;
  }).join('')}</div>`;
}

// tableau comparatif (campagne) : rows = [[nom, valeurs], …] ; « — » quand l'arme n'a pas cette valeur ; la portée
// efficace seule (le panneau est étroit), la maximale et la mitraille dans la bulle
const cellule = (k, v) => v == null ? '<td>—</td>' : k === 'por' ? `<td title="${valeur(k, v)}">${fmt(v[0])} m</td>` : `<td>${valeur(k, v)}</td>`;
export function valeursTable(rows) {
  const ks = VALEURS.filter(([k]) => k !== 'mun' && rows.some(r => r[1]?.[k] != null));
  return `<table class="grid vl-tab"><thead><tr><th>Troupe</th>${ks.map(([, nom, ab, aide]) => `<th title="${esc(nom + ' : ' + aide)}">${ab}</th>`).join('')}</tr></thead><tbody>${rows.map(([nom, s]) => `<tr><td>${esc(nom)}</td>${ks.map(([k]) => cellule(k, s?.[k])).join('')}</tr>`).join('')}</tbody></table>`;
}
