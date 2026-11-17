// La bataille par stratégie (SPEC-BATAILLE.md, « Contrat pour la page ») : ce que les fenêtres et le panneau montrent
// d'une bataille, d'après l'état du serveur. Rien que du HTML, sans interface autour : ui.js le pose et envoie les
// commandes (tac choose, tac pursue, apercu). C : { rules, names (camp → nom), nodes (carte), me (code du joueur) }.
import { esc } from './battle/formes.js';
import { armeSvg } from './icons.js';

const fmt = n => (Math.round(n) || 0).toLocaleString('fr-FR').replace(/^-/, '−');
const fois = v => '×' + String(Math.round(v * 100) / 100).replace('.', ',');
const perte = n => (Math.round(n) > 0 ? '−' + fmt(n) : '0');
const pct = v => Math.round(v * 100) + ' %';
const OUVRAGE = { fort: 'Fort', remparts: 'Remparts', barricade: 'Barricades', redoute: 'Redoute' };
const SORT = { blesse: 'blessé', tue: 'tué', pris: 'fait prisonnier' };

export const nomCamp = (C, o) => C.names?.[o] || C.rules.factions?.[o]?.name || 'Les insurgés';
const couleur = (C, o) => C.rules.factions?.[o]?.color || '#8d8a7a';
const nomStrat = (C, id) => C.rules.strats?.[id]?.label || id || '';

// le titre d'une bataille : « Embuscade », « Assaut de Blaye », « Bataille »
export function titreBataille(C, b) {
  const lieu = b.node != null ? C.nodes[b.node]?.name : null;
  return (b.amb ? 'Embuscade' : lieu ? (b.moi === 1 ? 'Défense' : 'Assaut') : 'Bataille') + (lieu ? ' — ' + esc(lieu) : '');
}

// les effectifs par arme : une ligne par arme présente (icône, nom, hommes)
export function armesHtml(C, armes) {
  const L = C.rules.armes || {};
  const l = Object.keys(L).filter(k => armes?.[k] > 0);
  return l.length ? `<dl class="bt-armes">${l.map(k => `<dt>${armeSvg(k)} ${esc(L[k])}</dt><dd>${fmt(armes[k])}</dd>`).join('')}</dl>` : '';
}

// un camp : son nom, son rôle, ses hommes et ses armes ; extra : ce qui s'ajoute dessous (général, renforts, pertes)
function campHtml(C, o, role, men, armes, extra = '') {
  return `<div class="bt-camp" style="--c:${couleur(C, o)}"><b>${esc(nomCamp(C, o))}</b><small>${role} · ${fmt(men)} hommes</small>${armesHtml(C, armes)}${extra}</div>`;
}
function campsBataille(C, b, pertes = false) {
  return `<div class="bt-forces">${b.sides.map((s, i) => {
    const gens = (s.tac || []).filter(t => t.gen).map(t => `${t.gen.rank} ${t.gen.name}`);
    const extra = (gens.length ? `<small>${esc(gens.join(', '))}</small>` : '') + (s.renf?.length ? `<small>Renforts : ${esc(s.renf.join(', '))}</small>` : '')
      + (s.strat ? `<small>Stratégie : <b>${esc(nomStrat(C, s.strat))}</b></small>` : '')
      + (pertes ? `<small>Pertes : <b>${fmt(s.lost)}</b> · moral ${fmt(s.mor)}</small>` : '');
    return campHtml(C, s.o, (i ? 'Défense' : 'Attaque') + (b.moi === i ? ' (vous)' : ''), s.men, s.armes, extra);
  }).join('')}</div>`;
}

// situation, terrain, météo, ouvrage : la ligne sous le titre
export function contexteHtml(C, b) {
  const S = C.rules.situations?.[b.sit], W = C.rules.weather?.[b.meteo], o = b.ouvrage;
  const role = !S ? '' : b.moi === 1 ? S.def : b.moi === 0 ? S.att : S.label;
  const l = [role, b.terrain, b.river >= 2 ? 'rivière à franchir' : b.river ? 'rivière' : '', b.land ? 'débarquement sous le feu' : '', W ? `${W.icon || ''} ${W.label}`.trim() : ''].filter(Boolean);
  const ouv = o ? `<p class="bt-ouvrage"><b>${OUVRAGE[o.type] || esc(o.type)}</b> (défenseur : ${esc(nomCamp(C, b.sides[o.camp]?.o))}) : force ${fois(1 + (o.niv || 0))}${o.breche > 0 ? `, brèche ouverte à ${pct(o.breche)}` : ''}.</p>` : '';
  return `<p class="m-sub">${l.map(esc).join(' · ')}.${S ? ' ' + esc(S.desc) : ''}</p>${ouv}`;
}

// la stratégie présélectionnée : celle que le joueur a touchée, sinon celle du général, sinon la première permise
export function stratChoisie(b, voulue) {
  const ok = (b.choix || []).filter(c => !c.why).map(c => c.id);
  return ok.includes(voulue) ? voulue : ok.includes(b.defaut) ? b.defaut : ok[0] || null;
}

// la fenêtre du choix (mode « attente ») : les deux camps, la reconnaissance, les stratégies permises et les autres
// grisées avec leur raison, « Livrer bataille » et « Laisser faire le général »
export function choixHtml(C, b, voulue) {
  const R = C.rules, sel = stratChoisie(b, voulue), S = R.situations?.[b.sit];
  const adverses = S ? (b.moi === 1 ? S.s_att : S.s_def) : [];
  const reco = b.reco ? `<p class="bt-reco"><b>Reconnaissance</b> : l’ennemi préparerait « ${esc(nomStrat(C, b.reco.strat))} » (renseignement sûr à ${pct(b.reco.p)}).</p>`
    : '<p class="bt-reco muted">Aucune reconnaissance : ni cavalerie ni espion pour deviner le plan ennemi.</p>';
  const tech = id => R.techs?.find?.(t => t.id === id)?.name || id;
  const btns = (b.choix || []).map(({ id, why }) => {
    const s = R.strats?.[id] || { label: id, desc: '', m: {}, bat: [], pertes: 1 };
    const bat = (s.bat || []).filter(k => adverses.includes(k)).map(k => nomStrat(C, k));
    const effets = Object.entries(s.m || {}).filter(([, v]) => v !== 1).map(([k, v]) => `${(R.armes?.[k] || k).toLowerCase()} ${fois(v)}`);
    const face = b.reco && (s.bat || []).includes(b.reco.strat) ? '<em class="bon">Contre le plan annoncé (+20 %)</em>'
      : b.reco && (R.strats?.[b.reco.strat]?.bat || []).includes(id) ? '<em class="mauvais">Contrée par le plan annoncé</em>' : '';
    return `<button class="btn ev-choice bt-strat" role="radio" aria-checked="${id === sel}" data-act="strat-pick" data-v="${esc(id)}"${why ? ' disabled' : ''}>
      <b>${esc(s.label)}${id === b.defaut ? ' <i>· le choix de votre général</i>' : ''}</b>
      <small>${esc(why || s.desc)}</small>${why ? '' : `<em>${bat.length ? 'Contre : ' + esc(bat.join(', ')) : 'Ne contre rien ici'}${effets.length ? ' · ' + esc(effets.join(', ')) : ''}${s.pertes !== 1 ? ` · vos pertes ${fois(s.pertes)}` : ''}${s.tech ? ` · découverte : ${esc(tech(s.tech))}` : ''}</em>${face}`}</button>`;
  }).join('');
  return `<h2 class="m-title" id="m-title">${titreBataille(C, b)}</h2>${contexteHtml(C, b)}${campsBataille(C, b)}${reco}
    <div class="section-t">Votre stratégie</div><div class="ev-choices bt-strats" role="radiogroup" aria-label="Votre stratégie">${btns}</div>
    <div class="btns bt-go"><button class="btn primary" data-act="tac-choose" data-id="${esc(b.id)}" data-v="${esc(sel || '')}"${sel ? '' : ' disabled'}>Livrer bataille${sel ? ' : ' + esc(nomStrat(C, sel)) : ''}</button>
      <button class="btn" data-act="tac-choose" data-id="${esc(b.id)}" data-v="auto">Laisser faire le général</button></div>
    <p class="muted small">La campagne reste en pause tant que vous n’avez pas choisi. Réglage dans le menu ☰.</p>`;
}

// le journal par phase (lignes des phases finies) et ce qui a pesé ; camps : les deux propriétaires [assaillant, défenseur]
export function journalHtml(C, journal, pese, camps) {
  // (c : le camp que le fait avantage ; sans camp, le temps qu'il fait ou le terrain : une pastille neutre)
  const nom = i => esc(nomCamp(C, camps[i])), pastille = c => `<i class="bt-dot" style="background:${c === 0 || c === 1 ? couleur(C, camps[c]) : '#8d8a7a'}"></i>`;
  const lignes = (journal || []).map(j => `<tr><th>${esc(C.rules.phases?.[j.ph] || j.ph)}</th><td>${perte(j.l?.[0])}</td><td>${perte(j.l?.[1])}</td>
    <td class="bt-note">${(j.w || []).map(w => `<span>${pastille(w.c)}${esc(w.t)}</span>`).join('')}</td></tr>`).join('');
  const table = lignes ? `<table class="grid bt-journal"><thead><tr><th>Phase</th><th>${nom(0)}</th><th>${nom(1)}</th><th>Ce qui s’est passé</th></tr></thead><tbody>${lignes}</tbody></table>` : '';
  const poids = (pese || []).length ? `<div class="bt-pese"><b>Ce qui a pesé</b><ul>${pese.map(p => `<li>${pastille(p.c)}${esc(p.t)}${p.c === 0 || p.c === 1 ? ` <span class="muted">(${nom(p.c)})</span>` : ''}</li>`).join('')}</ul></div>` : '';
  return table + poids;
}

// la fenêtre de la poursuite (mode « poursuite ») : la bataille est gagnée, la stratégie ennemie est révélée
export function poursuiteHtml(C, b) {
  const w = b.fin?.w ?? b.moi, P = C.rules.poursuite || {}, perdant = b.sides[1 - w], repli = !!b.fin?.repli;
  return `<h2 class="m-title" id="m-title">Victoire${b.node != null && C.nodes[b.node] ? ' — ' + esc(C.nodes[b.node].name) : ''}</h2>
    <p class="m-sub">Vaincu : ${esc(nomCamp(C, perdant.o))}, ${repli ? 'qui décroche en bon ordre' : 'rompu, en fuite'}. Sa stratégie : « ${esc(nomStrat(C, perdant.strat))} » ; la vôtre : « ${esc(nomStrat(C, b.sides[w].strat))} ».</p>
    ${campsBataille(C, b, true)}${journalHtml(C, b.journal, b.pese, b.sides.map(s => s.o))}
    <div class="section-t">Poursuivre l’ennemi ?</div>
    <div class="ev-choices"><button class="btn primary ev-choice" data-act="tac-pursue" data-id="${esc(b.id)}" data-v="1"><b>Poursuivre</b><small>Votre cavalerie sabre les fuyards : ${pct((P.cav || 0.05) * (repli ? 1 : 2))} des vaincus de plus hors de combat, mais vos hommes s’épuisent (fatigue +${fmt(P.fatigue || 35)}).</small></button>
      <button class="btn ev-choice" data-act="tac-pursue" data-id="${esc(b.id)}" data-v="0"><b>Laisser partir</b><small>Vous tenez le terrain, vos troupes soufflent.</small></button></div>`;
}

// le résultat d'une bataille (événement battle_end) : pertes, prisonniers, prises, sort des généraux, journal
export function resultatHtml(C, ev) {
  const camps = [ev.a, ev.d], lieu = ev.node != null ? C.nodes[ev.node]?.name : null;
  const titre = ev.win === true ? 'Victoire' : ev.win === false ? (ev.repli ? 'Retraite' : 'Défaite') : 'Bataille terminée';
  const vq = ev.w != null ? camps[ev.w] : null;
  const strats = ev.strats ? `<p class="bt-reco">Stratégies : ${camps.map((o, i) => `${esc(nomCamp(C, o))}, « ${esc(nomStrat(C, ev.strats[i]) || 'aucune')} »`).join(' ; ')}.</p>` : '';
  const pr = ev.prises || {}, prises = [pr.drapeaux ? `${fmt(pr.drapeaux)} ${pr.drapeaux > 1 ? 'drapeaux' : 'drapeau'}` : '', pr.canons ? `${fmt(pr.canons)} ${pr.canons > 1 ? 'canons' : 'canon'}` : ''].filter(Boolean);
  const gens = (ev.generaux || []).map(([c, n, s]) => `<li>${esc(n)} (${esc(nomCamp(C, camps[c]))}) : ${SORT[s] || esc(s)}</li>`).join('');
  return `<h2 class="m-title" id="m-title">${titre}${lieu ? ' — ' + esc(lieu) : ''}</h2>
    <p class="m-sub">${vq != null ? `Vainqueur : ${esc(nomCamp(C, vq))} ; vaincu : ${esc(nomCamp(C, camps[1 - ev.w]))}${ev.repli ? ', qui décroche en bon ordre' : ''}` : 'Sans vainqueur'}${ev.poursuite ? ' ; le vainqueur poursuit' : ''}.</p>
    <dl class="kv bt-bilan"><dt>Pertes : ${esc(nomCamp(C, ev.a))} (attaque)</dt><dd>${fmt(ev.la)}</dd><dt>Pertes : ${esc(nomCamp(C, ev.d))} (défense)</dt><dd>${fmt(ev.ld)}</dd>
      ${ev.prisonniers ? `<dt>Prisonniers</dt><dd>${fmt(ev.prisonniers)}</dd>` : ''}${prises.length ? `<dt>Prises${vq != null ? ' (' + esc(nomCamp(C, vq)) + ')' : ''}</dt><dd>${prises.join(', ')}</dd>` : ''}</dl>
    ${gens ? `<div class="bt-pese"><b>Généraux</b><ul>${gens}</ul></div>` : ''}${strats}${journalHtml(C, ev.journal, ev.pese, camps)}
    <div class="btns"><button class="btn primary" data-act="close-modal">Continuer</button>${ev.x != null ? `<button class="btn" data-act="goto" data-x="${ev.x}" data-y="${ev.y}">Voir le lieu</button>` : ''}</div>`;
}

// l'aperçu avant d'attaquer (commande apercu) : rapport de forces, situation, terrain, effectifs des deux camps
export function apercuHtml(C, r, lui) {
  if (!r || !r.ok) return '';
  const S = C.rules.situations?.[r.sit], k = r.ratio || 0;
  return `<div class="bt-apercu"><div class="bt-rapport"><span>Rapport de forces : <b>${String(Math.round(k * 10) / 10).replace('.', ',')} contre 1</b>, ${esc(r.mot || '')}${r.sur ? '' : ' <i>(estimé)</i>'}</span>
      <span class="bt-jauge" aria-hidden="true"><i style="width:${Math.round(100 * k / (1 + k))}%"></i></span></div>
    <div class="bh">${esc([S?.att || S?.label, r.terrain].filter(Boolean).join(' · '))}</div>
    <div class="bt-forces">${campHtml(C, C.me, 'Vous', r.moi.men, r.moi.armes)}${campHtml(C, lui, r.sur ? 'L’ennemi' : 'L’ennemi (estimé)', r.lui.men, r.lui.armes)}</div></div>`;
}
