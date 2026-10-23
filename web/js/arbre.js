// L'arbre des technologies d'une branche (SPEC-ARBRE.md, module arbre-ecran) : une case par technologie, en colonnes
// par étage (prérequis de la même branche seulement), des traits vers les prérequis, la fiche de la case choisie.
import { esc } from './battle/formes.js';
import { partTour, TOUR_DAYS } from './map.js';

export const CASE_W = 176, CASE_H = 66, GAP_X = 42, GAP_Y = 12;

// colonne, ligne de chaque technologie de la branche et traits (prérequis → technologie) ; pur, testé
export function arbrePlace(techs, branch) {
  const mine = techs.filter(t => t.branch === branch), byId = new Map(mine.map(t => [t.id, t]));
  const par = t => t.req.filter(q => byId.has(q));
  const col = new Map();
  const colOf = t => col.get(t.id) ?? col.set(t.id, par(t).length ? 1 + Math.max(...par(t).map(q => colOf(byId.get(q)))) : 0).get(t.id);
  mine.forEach(colOf);
  const cols = [];
  for (const t of mine) (cols[col.get(t.id)] ||= []).push(t);
  // rangées : la première colonne par coût, puis chaque colonne au rang moyen de ses parents (moins de croisements)
  const row = new Map();
  cols.forEach((c, i) => {
    const key = t => i ? par(t).reduce((s, q) => s + row.get(q), 0) / par(t).length : 0;
    c.sort((a, b) => key(a) - key(b) || a.cost - b.cost || a.id.localeCompare(b.id)).forEach((t, r) => row.set(t.id, r));
  });
  const traits = mine.flatMap(t => par(t).map(q => [q, t.id]));
  return { cases: mine.map(t => ({ id: t.id, col: col.get(t.id), row: row.get(t.id) })), traits, cols: cols.length,
    rows: Math.max(0, ...cols.map(c => c.length)) };
}

// une durée de recherche : en tours, et en années quand c'est long (12 tours par an)
export function dureeTxt(days) {
  const n = Math.round(days / TOUR_DAYS), ans = n / 12;
  return n < 12 ? partTour(days) : `${n} tours (${ans < 2 ? 'un an et plus' : `environ ${Math.round(ans)} ans`})`;
}

// dans une case : « 8 tours », « 14 ans »
const courte = days => { const n = Math.round(days / TOUR_DAYS); return n < 12 ? `${n} tour${n > 1 ? 's' : ''}` : `${Math.round(n / 12)} ans`; };
const fmt = n => Math.round(n).toLocaleString('fr-FR');

// le HTML d'un onglet : o = { techs, branch, labels (branche → nom), me (techs, research, res, tech_dates), year, sel }
export function arbreHtml(o) {
  const { techs, branch, labels, me, year } = o, byId = new Map(techs.map(t => [t.id, t]));
  const P = arbrePlace(techs, branch), cur = me.research[branch];
  const etat = t => me.techs.includes(t.id) ? 'done' : cur?.tech === t.id ? 'running' : t.req.every(q => me.techs.includes(q)) ? 'ready' : 'locked';
  const x = c => c.col * (CASE_W + GAP_X), y = c => c.row * (CASE_H + GAP_Y);
  const at = new Map(P.cases.map(c => [c.id, c]));
  const W = Math.max(1, P.cols) * (CASE_W + GAP_X) - GAP_X, H = Math.max(1, P.rows) * (CASE_H + GAP_Y) - GAP_Y;
  const traits = P.traits.map(([a, b]) => {
    const A = at.get(a), B = at.get(b), x1 = x(A) + CASE_W, y1 = y(A) + CASE_H / 2, x2 = x(B), y2 = y(B) + CASE_H / 2, m = (x1 + x2) / 2;
    return `<path class="${me.techs.includes(a) ? 'ok' : ''}" d="M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}"/>`;
  }).join('');
  const cases = P.cases.map(c => {
    const t = byId.get(c.id), e = etat(t);
    const ext = t.req.filter(q => byId.get(q).branch !== branch);
    const pied = e === 'done' ? 'Acquise' : e === 'running' ? `En cours, ${Math.round((1 - cur.left / cur.total) * 100)} %`
      : `${fmt(t.cost)} livres · ${courte(t.days)}`;
    return `<button class="tcase ${e}${o.sel === t.id ? ' sel' : ''}" data-act="techsel" data-v="${t.id}" style="left:${x(c)}px;top:${y(c)}px"
      aria-pressed="${o.sel === t.id}"><span class="tn">${esc(t.name)}</span>${ext.length ? `<span class="tx">${ext.map(q =>
        `<i class="${me.techs.includes(q) ? 'ok' : ''}">← ${esc(byId.get(q).name)}</i>`).join('')}</span>` : ''}<span class="tp">${pied}</span></button>`;
  }).join('');
  const curT = cur && byId.get(cur.tech);
  const head = curT ? `En cours : <b>${esc(curT.name)}</b>, prête ${o.toursTxt(cur.tn)}<div class="bar green"><i style="width:${Math.round((1 - cur.left / cur.total) * 100)}%"></i></div>`
    : 'Aucune recherche en cours dans cette branche.';
  return `<div class="arbre-cur">${head}</div>
    <div class="arbre" role="group" aria-label="Arbre : ${esc(labels[branch])}"><div class="arbre-in" style="width:${W}px;height:${H}px">
      <svg class="arbre-traits" width="${W}" height="${H}" aria-hidden="true">${traits}</svg>${cases}</div></div>
    ${fiche(o, byId, etat, cur)}`;
}

function fiche(o, byId, etat, cur) {
  const t = byId.get(o.sel);
  if (!t || t.branch !== o.branch) return '<p class="muted small">Touchez une case pour voir sa fiche et la lancer.</p>';
  const { me, labels, year } = o, e = etat(t), d = me.tech_dates?.[t.id];
  const reqs = t.req.map(q => byId.get(q)).map(q => `<li class="${me.techs.includes(q.id) ? 'ok' : 'manque'}">${me.techs.includes(q.id) ? '✓' : '✗'} ${esc(q.name)}${q.branch !== t.branch ? ` <span class="muted">(${esc(labels[q.branch].toLowerCase())})</span>` : ''}</li>`).join('');
  const avance = t.year - year;
  const hist = d ? `Découverte le ${esc(d[0])} (historiquement vers ${t.year}).`
    : `Historiquement vers ${t.year}${avance > 0 ? ` : vous auriez ${avance} ans d’avance` : avance < 0 ? ` : l’histoire l’a trouvée il y a ${-avance} ans` : ''}.`;
  let act = '';
  if (e === 'ready') {
    const why = cur ? 'Une recherche est déjà en cours dans cette branche.' : me.res.livres < t.cost ? 'Pas assez de livres.' : '';
    act = `<div class="row"><button class="btn primary" data-act="research" data-v="${t.id}" ${why ? 'disabled' : ''}>Rechercher</button>
      <span>${fmt(t.cost)} livres · ${dureeTxt(t.days)}</span>${why ? `<span class="muted small">${why}</span>` : ''}</div>`;
  } else if (e === 'locked') act = '<p class="muted small">Il manque des prérequis.</p>';
  return `<div class="tfiche"><h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p><p class="small">${hist}</p>
    ${reqs ? `<ul class="treq">${reqs}</ul>` : ''}${act}</div>`;
}
